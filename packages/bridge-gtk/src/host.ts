import { createJsonLineWriter } from '@nandomo/bridge-runtime/native-updates';
// nandomo · bridge-gtk · host process manager.
//
// Spawns the Rust GTK host binary as a child process and translates
// imperative widget operations into line-delimited JSON commands on
// stdin. Receives events back from the host on stdout (also
// line-delimited JSON) and dispatches them to the registered handler
// registry.
//
// Protocol (commands from JS → host, on stdin):
//
//   {"cmd":"create",   "id":<n>, "kind":<string>, "props":{...}}
//   {"cmd":"set",      "id":<n>, "prop":<string>, "value":<any>}
//   {"cmd":"add_child","parent":<n>, "child":<n>}
//   {"cmd":"remove_child","parent":<n>, "child":<n>}
//   {"cmd":"connect",  "id":<n>, "signal":<string>, "handler":<n>}
//   {"cmd":"destroy",  "id":<n>}
//
// Protocol (events from host → JS, on stdout):
//
//   {"event":"ready"}                                            // host is alive
//   {"event":"signal","id":<n>,"signal":<string>,"handler":<n>} // widget signal
//   {"event":"change","id":<n>,"signal":<string>,"value":<...>} // property change
//   {"event":"log","level":"info|warn|error","message":<string>}// host log
//   {"event":"exit","code":<n>}                                  // process exit
//
// Why an IpcTransport abstraction? So tests can drive the same
// command/event flow without spawning a real process. The default
// `StdioIpcTransport` spawns the binary; `InMemoryIpcTransport`
// accumulates commands in memory and lets the test inject events.
//
// The Host class itself is the bridge between the user's spec tree
// (via render.ts) and the transport. It maintains the widget-id
// counter and a parent→children map so add_child knows which child
// ids belong to which parents.

import { spawn, type ChildProcess, type StdioOptions } from 'node:child_process';
import { resolve, isAbsolute } from 'node:path';
import { existsSync, accessSync, constants as fsConstants } from 'node:fs';
import { WIDGET_REF_BRAND, type WidgetRef } from './primitives/types.js';
import type { HandlerRegistry } from './handlers.js';

// ─── Public types ─────────────────────────────────────────────────────────────

/** A command sent from JS → host. */
export type Command =
  | { cmd: 'create'; id: number; kind: string; props: Record<string, unknown> }
  | { cmd: 'set'; id: number; prop: string; value: unknown }
  | { cmd: 'add_child'; parent: number; child: number }
  | { cmd: 'remove_child'; parent: number; child: number }
  | { cmd: 'connect'; id: number; signal: string; handler: number }
  | { cmd: 'destroy'; id: number }
  | { cmd: 'reorder'; parent: number; children: number[] }
  | { cmd: 'inspect'; id: number; properties: string[]; request: number }
  | { cmd: 'invoke'; id: number; signal: string; request: number };

/** An event sent from host → JS. */
export type HostEvent =
  | { event: 'result'; request: number; value: unknown; error?: string }
  | { event: 'ready' }
  | { event: 'signal'; id: number; signal: string; handler: number }
  | { event: 'change'; id: number; signal: string; value: unknown; handler?: number }
  | { event: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { event: 'exit'; code: number };

/** Abstract transport — sends commands and receives events. */
export interface IpcTransport {
  /** Send one command to the host. Returns when the bytes are written. */
  send(cmd: Command): Promise<void>;
  /** Subscribe to host events. Returns an unsubscribe function. */
  onEvent(handler: (ev: HostEvent) => void): () => void;
  /** Shut the transport down. */
  close(): Promise<void>;
  /** True if the transport is alive. */
  isAlive(): boolean;
}

/** Default options for `startHost`. */
export interface StartHostOptions {
  /**
   * Path to the bridge-gtk-host binary. Defaults to
   * `BRIDGE_GTK_HOST_PATH` env, then
   * `./packages/bridge-gtk-host/target/release/bridge-gtk-host`
   * relative to CWD.
   */
  binaryPath?: string;
  /** Custom transport (tests inject an InMemoryIpcTransport). */
  transport?: IpcTransport;
  /**
   * Auto-respond to `event: ready` (default true). When the host
   * emits `ready`, the Host class resolves its `whenReady()` promise.
   * Set false in tests that drive the protocol synthetically.
   */
  handleReady?: boolean;
  /**
   * Stdout/stderr handler (default: print to console with a prefix).
   * Tests can capture for assertions.
   */
  logHandler?: (line: string, stream: 'stdout' | 'stderr') => void;
}

/** Public Host interface — what render.ts talks to. */
export interface GtkHost {
  /** Allocate a new widget id. */
  allocId(): number;
  /** Look up the id of a previously-allocated widget kind (for tests). */
  nextWidgetId(): number;
  /** Allocate a widget in the host: returns a WidgetRef the JS side can track. */
  create(kind: string, props: Record<string, unknown>): WidgetRef;
  /** Set a property on an existing widget. */
  set(id: number, prop: string, value: unknown): Promise<void>;
  /** Reparent a child under a parent. */
  addChild(parent: number, child: number): Promise<void>;
  /** Remove a child from a parent. */
  removeChild(parent: number, child: number): Promise<void>;
  /** Connect a GTK signal to a registered handler. */
  connect(id: number, signal: string, handler: number): Promise<void>;
  /** Destroy a widget in the host. */
  destroy(id: number): Promise<void>;
  reorder(parent: number, children: number[]): Promise<void>;
  inspect(id: number, properties: string[]): Promise<Record<string, unknown>>;
  invoke(id: number, signal: string): Promise<void>;
  /** Resolves once the host has emitted `event: ready`. */
  whenReady(): Promise<void>;
  /** Shut down the host process. */
  shutdown(): Promise<void>;
  /** True if the host process is alive. */
  isAlive(): boolean;
  /** Access to the underlying transport (advanced). */
  readonly transport: IpcTransport;
  /** Set the handler registry used to look up callbacks on signal events. */
  setHandlerRegistry(handlers: HandlerRegistry): void;
  /** Number of pending async sends (debug). */
  pendingSends(): number;
}

// ─── StdioIpcTransport ─────────────────────────────────────────────────────────

/**
 * Spawn the bridge-gtk-host binary and pipe commands/events over stdio.
 *
 * Line-delimited JSON. Newlines between frames. The transport doesn't
 * attempt any framing beyond that (no length prefix, no escape — we
 * forbid embedded newlines in string values at the protocol layer).
 */
export class StdioIpcTransport implements IpcTransport {
  private child: ChildProcess | null;
  private buf = '';
  private handlers = new Set<(ev: HostEvent) => void>();
  private alive = true;
  private readonly writer: ReturnType<typeof createJsonLineWriter>;

  constructor(binaryPath: string, logHandler?: (line: string, stream: 'stdout' | 'stderr') => void) {
    const child = spawn(binaryPath, [], {
      stdio: ['pipe', 'pipe', 'pipe'] as StdioOptions,
    });
    this.child = child;
    this.writer = createJsonLineWriter(lines => new Promise<void>((resolve, reject) => {
      if (!this.alive || !child.stdin?.writable) { reject(new Error('[bridge-gtk] host stdin is not writable')); return; }
      child.stdin.write(lines, 'utf8', error => error ? reject(error) : resolve());
    }));

    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => this.handleStdout(chunk, logHandler));
    child.stderr?.on('data', (chunk: string) => this.handleStderr(chunk, logHandler));

    child.on('exit', (code) => {
      this.alive = false;
      this.writer.cancel(new Error('[bridge-gtk] host exited'));
      const ev: HostEvent = { event: 'exit', code: code ?? 0 };
      for (const h of this.handlers) h(ev);
    });
    child.stdin?.on('error', err => {
      this.writer.cancel(err);
      if (this.alive) { this.alive = false; for (const handler of this.handlers) handler({ event: 'exit', code: 1 }); }
      logHandler?.(String(err), 'stderr');
    });
    child.on('error', (err) => {
      this.alive = false;
      this.writer.cancel(err);
      for (const handler of this.handlers) handler({ event: 'exit', code: 1 });
      if (typeof console !== 'undefined') {
        console.error('[bridge-gtk] host process error:', err);
      }
    });
  }

  private handleStdout(chunk: string, logHandler?: (line: string, stream: 'stdout' | 'stderr') => void): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as HostEvent;
        if (parsed.event === 'exit') this.alive = false;
        for (const h of this.handlers) h(parsed);
      } catch (err) {
        if (logHandler) logHandler(`[malformed] ${line}`, 'stderr');
        if (typeof console !== 'undefined') {
          console.error('[bridge-gtk] failed to parse host line:', line, err);
        }
      }
    }
  }

  private handleStderr(chunk: string, logHandler?: (line: string, stream: 'stdout' | 'stderr') => void): void {
    if (logHandler) {
      // Pass through verbatim; the host prefixes its own lines.
      logHandler(chunk, 'stderr');
    } else if (typeof console !== 'undefined') {
      process.stderr.write(`[gtk-host] ${chunk}`);
    }
  }

  async send(cmd: Command): Promise<void> {
    if (!this.alive || !this.child?.stdin?.writable) {
      throw new Error('[bridge-gtk] host stdin is not writable');
    }
    return this.writer.send(cmd);
  }

  onEvent(handler: (ev: HostEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  async close(): Promise<void> {
    if (!this.alive) return;
    const child = this.child;
    if (!child) return;
    await this.writer.flush().catch(() => {});
    if (!this.alive || child.exitCode !== null || child.signalCode !== null) {
      this.writer.cancel(new Error('[bridge-gtk] transport closed'));
      this.child = null;
      return;
    }
    try {
      child.stdin?.end();
    } catch {
      // already closed
    }
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* already dead */ }
        resolve();
      }, 1500);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    });
    this.alive = false;
    this.writer.cancel(new Error('[bridge-gtk] transport closed'));
    this.child = null;
  }

  isAlive(): boolean {
    return this.alive;
  }
}

/**
 * In-memory transport for tests. Accumulates commands into an array
 * the test can inspect; lets the test inject events via `emit`.
 */
export class InMemoryIpcTransport implements IpcTransport {
  private commands: Command[] = [];
  private handlers = new Set<(ev: HostEvent) => void>();
  private aliveFlag = true;

  async send(cmd: Command): Promise<void> {
    if (!this.aliveFlag) throw new Error('[bridge-gtk] transport is closed');
    this.commands.push(cmd);
  }

  onEvent(handler: (ev: HostEvent) => void): () => void {
    this.handlers.add(handler);
    return () => { this.handlers.delete(handler); };
  }

  /** Inject an event from the test. */
  emit(ev: HostEvent): void {
    if (ev.event === 'exit') this.aliveFlag = false;
    for (const h of this.handlers) h(ev);
  }

  /** Return a snapshot of all sent commands and clear the buffer. */
  drainCommands(): Command[] {
    const out = this.commands;
    this.commands = [];
    return out;
  }

  /** View commands without clearing. */
  commandsSnapshot(): readonly Command[] {
    return this.commands.slice();
  }

  async close(): Promise<void> {
    this.aliveFlag = false;
  }

  isAlive(): boolean {
    return this.aliveFlag;
  }
}

// ─── Host ─────────────────────────────────────────────────────────────────────

/**
 * The GtkHost is the JS-side façade. Render() talks to it; it talks
 * to the transport. The host owns:
 *   - the widget-id counter
 *   - the parent→children map (so add_child gets the right ids)
 *   - the handler registry reference (to look up callbacks on events)
 */
class GtkHostImpl implements GtkHost {
  // The host reserves id 1 for the root ApplicationWindow (created
  // implicitly when the GTK context spins up). User-created widgets
  // start at id 2 — keeps the protocol in lockstep with the host's
  // internal allocation.
  private nextIdNum = 2;
  private children = new Map<number, Set<number>>();
  private handlers: HandlerRegistry | null = null;
  private readyResolvers: Array<{ resolve(): void; reject(error: Error): void }> = [];
  private closedError: Error | null = null;
  private shutdownPromise: Promise<void> | null = null;
  private ready = false;
  private pending = 0;
  private requestId = 0;
  private requests = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  // String properties that need quoting when serialized for GTK;
  // not used here — the host decodes JSON natively.

  constructor(public readonly transport: IpcTransport, private readonly opts: StartHostOptions) {
    transport.onEvent((ev) => this.handleEvent(ev));
  }

  setHandlerRegistry(handlers: HandlerRegistry): void {
    this.handlers = handlers;
  }

  allocId(): number {
    return this.nextIdNum++;
  }

  nextWidgetId(): number {
    return this.nextIdNum;
  }

  create(kind: string, props: Record<string, unknown>): WidgetRef {
    const id = this.allocId();
    const ref: WidgetRef = {
      [WIDGET_REF_BRAND]: true,
      id,
      kind,
      props,
      cleanups: [],
    };
    this.pending++;
    void this.transport.send({ cmd: 'create', id, kind, props }).catch(error => {
      this.handleEvent({ event: 'log', level: 'error', message: String(error) });
    }).finally(() => {
      this.pending--;
    });
    return ref;
  }

  async set(id: number, prop: string, value: unknown): Promise<void> {
    await this.transport.send({ cmd: 'set', id, prop, value });
  }

  async addChild(parent: number, child: number): Promise<void> {
    if (!this.children.has(parent)) this.children.set(parent, new Set());
    this.children.get(parent)!.add(child);
    await this.transport.send({ cmd: 'add_child', parent, child });
  }

  async removeChild(parent: number, child: number): Promise<void> {
    const set = this.children.get(parent);
    if (set) { set.delete(child); if (!set.size) this.children.delete(parent); }
    await this.transport.send({ cmd: 'remove_child', parent, child });
  }

  async connect(id: number, signal: string, handler: number): Promise<void> {
    await this.transport.send({ cmd: 'connect', id, signal, handler });
  }

  async destroy(id: number): Promise<void> {
    this.children.delete(id);
    for (const children of this.children.values()) children.delete(id);
    await this.transport.send({ cmd: 'destroy', id });
  }

  async reorder(parent: number, children: number[]): Promise<void> {
    await this.transport.send({ cmd: 'reorder', parent, children });
  }
  private request(command: { cmd: 'inspect'; id: number; properties: string[] } | { cmd: 'invoke'; id: number; signal: string }): Promise<unknown> {
    if (this.closedError || !this.isAlive()) return Promise.reject(this.closedError ?? new Error('GTK host closed'));
    const request = this.requestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.requests.delete(request); reject(new Error('GTK native request timed out')); }, 5000);
      this.requests.set(request, { resolve, reject, timer });
      void this.transport.send({ ...command, request }).catch(error => {
        clearTimeout(timer); this.requests.delete(request); reject(error);
      });
    });
  }
  inspect(id: number, properties: string[]): Promise<Record<string, unknown>> {
    return this.request({ cmd: 'inspect', id, properties }) as Promise<Record<string, unknown>>;
  }
  async invoke(id: number, signal: string): Promise<void> { await this.request({ cmd: 'invoke', id, signal }); }

  whenReady(): Promise<void> {
    if (this.closedError) return Promise.reject(this.closedError);
    if (this.ready) return Promise.resolve();
    return new Promise<void>((resolve, reject) => { this.readyResolvers.push({ resolve, reject }); });
  }

  private cancelPending(error: Error): void {
    this.closedError = error;
    for (const request of this.requests.values()) { clearTimeout(request.timer); request.reject(error); }
    this.requests.clear();
    for (const waiter of this.readyResolvers.splice(0)) waiter.reject(error);
    this.children.clear();
  }

  shutdown(): Promise<void> {
    if (this.shutdownPromise) return this.shutdownPromise;
    this.cancelPending(new Error('GTK host closed'));
    this.shutdownPromise = this.transport.close();
    return this.shutdownPromise;
  }

  isAlive(): boolean {
    return this.transport.isAlive();
  }

  pendingSends(): number {
    return this.pending;
  }

  private handleEvent(ev: HostEvent): void {
    switch (ev.event) {
      case 'result': {
        const request = this.requests.get(ev.request);
        if (request) { clearTimeout(request.timer); this.requests.delete(ev.request);
          if (ev.error) request.reject(new Error(ev.error)); else request.resolve(ev.value); }
        return;
      }
      case 'ready':
        if (!this.ready) {
          this.ready = true;
          for (const r of this.readyResolvers) r.resolve();
          this.readyResolvers = [];
        }
        return;
      case 'signal': {
        const fn = this.handlers?.get(ev.handler) ?? null;
        if (fn) {
          try {
            fn();
          } catch (err) {
            if (typeof console !== 'undefined') {
              console.error('[bridge-gtk] handler error:', err);
            }
          }
        }
        // A handler that is gone means the widget was replaced or destroyed
        // while GTK still had a pending signal — expected during a re-render.
        return;
      }
      case 'change': {
        // `handler` is absent for broadcast events (file-drop, key-pressed,
        // window-size). Never fall back to 0 — that is a real handler id and
        // would call the first registered onClick (e.g. "open file").
        const fn = ev.handler == null ? null : this.handlers?.get(ev.handler);
        if (fn) { try { fn(ev.value); } catch (error) { console.error('[bridge-gtk] handler error:', error); } }
        return;
      }
      case 'log': {
        const line = `[gtk-host] [${ev.level}] ${ev.message}`;
        if (this.opts.logHandler) this.opts.logHandler(line, 'stderr');
        else if (typeof console !== 'undefined') {
          if (ev.level === 'error') console.error(line);
          else if (ev.level === 'warn') console.warn(line);
          else console.log(line);
        }
        return;
      }
      case 'exit': {
        this.cancelPending(new Error(`GTK host exited (${ev.code})`));
        if (ev.code !== 0) {
          const line = `[bridge-gtk] host exited with code ${ev.code}`;
          if (this.opts.logHandler) this.opts.logHandler(line, 'stderr');
          else if (typeof console !== 'undefined') {
            console.error(line);
          }
        }
        return;
      }
    }
  }
}

// ─── Module-level singleton ──────────────────────────────────────────────────

/**
 * Walk up from `start` looking for a directory containing
 * `pnpm-workspace.yaml`. Returns that directory or null. Used to find
 * the workspace root regardless of which package the user runs `pnpm` from.
 */
function findWorkspaceRoot(start: string): string | null {
  let dir = resolve(start);
  // Stop at filesystem root.
  while (true) {
    try {
      accessSync(resolve(dir, 'pnpm-workspace.yaml'), fsConstants.F_OK);
      return dir;
    } catch {
      // not here
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return null; // hit root
    dir = parent;
  }
}

/**
 * Find the bridge-gtk-host binary. Tries:
 *   1. opts.binaryPath (call-site override)
 *   2. process.env.BRIDGE_GTK_HOST_PATH
 *   3. workspaceRoot/packages/bridge-gtk-host/target/release/bridge-gtk-host
 *   4. workspaceRoot/packages/bridge-gtk-host/target/debug/bridge-gtk-host
 *   5. ./packages/bridge-gtk-host/target/{release,debug}/bridge-gtk-host (relative to CWD)
 *
 * Workspace root is found by walking up from cwd to a directory containing
 * `pnpm-workspace.yaml`. This way the bridge works no matter which package
 * the user runs `pnpm` from.
 */
export function resolveHostBinaryPath(override?: string): string {
  const candidates: string[] = [];
  if (override) candidates.push(override);
  if (process.env.BRIDGE_GTK_HOST_PATH) candidates.push(process.env.BRIDGE_GTK_HOST_PATH);

  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (workspaceRoot) {
    candidates.push(
      resolve(workspaceRoot, 'host/target/release/bridge-gtk-host'),
      resolve(workspaceRoot, 'host/target/debug/bridge-gtk-host'),
      resolve(workspaceRoot, 'packages/bridge-gtk-host/target/release/bridge-gtk-host'),
      resolve(workspaceRoot, 'packages/bridge-gtk-host/target/debug/bridge-gtk-host'),
    );
  }

  // Fallback: relative to cwd or system install
  candidates.push(
    resolve(process.cwd(), 'host/target/release/bridge-gtk-host'),
    resolve(process.cwd(), 'host/target/debug/bridge-gtk-host'),
    resolve(process.cwd(), 'packages/bridge-gtk-host/target/release/bridge-gtk-host'),
    resolve(process.cwd(), 'packages/bridge-gtk-host/target/debug/bridge-gtk-host'),
    '/usr/lib/tomo/bridge-gtk-host',
    '/usr/bin/bridge-gtk-host',
  );

  for (const p of candidates) {
    try {
      accessSync(p, fsConstants.X_OK);
      return isAbsolute(p) ? p : resolve(p);
    } catch {
      // not here
    }
  }
  throw new Error(
    `[bridge-gtk] could not locate host binary. Tried:\n  - ${candidates.join('\n  - ')}\n` +
      `Build it with \`cargo build --release\` inside packages/bridge-gtk-host/.`,
  );
}

/**
 * Spawn a host process (or attach to a custom transport) and return
 * a GtkHost instance.
 */
export function startHost(opts: StartHostOptions = {}): GtkHost {
  let transport: IpcTransport;
  if (opts.transport) {
    transport = opts.transport;
  } else {
    const bin = resolveHostBinaryPath(opts.binaryPath);
    if (!existsSync(bin)) {
      throw new Error(
        `[bridge-gtk] host binary not found at ${bin}. ` +
          `Run \`cargo build --release\` inside packages/bridge-gtk-host/ first.`,
      );
    }
    transport = new StdioIpcTransport(bin, opts.logHandler);
  }
  return new GtkHostImpl(transport, { ...opts, handleReady: opts.handleReady ?? true });
}


/** Owned reactive writes can outlive a closing host; imperative APIs still reject. */
export function submitNativeUpdate(host: GtkHost, operation: Promise<void>): void {
  void operation.catch(error => {
    if (host.isAlive()) console.error('[bridge-gtk] native update failed:', error);
  });
}
