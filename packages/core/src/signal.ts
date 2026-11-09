import type { ReactiveNode, Watcher } from "./runtime.js";
import { enqueueListener, notificationTransaction, getActiveSub } from "./runtime.js";

/**
 * Reactive container. Callable reads track; `.peek()` reads without tracking;
 * `.set()` / `.update()` notify subscribers synchronously (no microtask).
 *
 * Semantics (per ARCH recon §1.1, §1.2, §1.6, §1.9):
 *   - Equality: `Object.is` (strict). No `equals` option.
 *   - Tracking: `signal()` tracks; `signal.peek()` does not.
 *   - Dedup: a watcher is added to `_watchers` at most once per signal —
 *     repeated reads in the same run are a no-op after the first.
 *   - Prune: dead (disposed) watchers are removed on next `set`.
 *   - Notify: synchronous. Effects re-run immediately. Use `batch(fn)` to
 *     coalesce multiple sync sets into one effect re-run.
 *   - Identity: each `signal()` call returns a fresh node with a unique id.
 *     `with_name(name)` is a builder for debugging / devtools.
 */
export interface Signal<T> {
  /** Read + track (subscribes the active watcher). */
  (): T;
  /** Read without subscribing. */
  peek(): T;
  /** Replace the value (skips notify when `Object.is(prev, next)`). */
  set(next: T): void;
  /** Functional update — equivalent to `set(fn(read()))`. */
  update(fn: (prev: T) => T): void;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: (value: T, previous: T) => void): () => void;
  /** Builder: stamp a debug name + return the same signal. */
  with_name(name: string): Signal<T>;
  /** Stable id for devtools. */
  readonly id: number;
  /** Debug name (set via `.with_name`). */
  readonly name: string | undefined;
  /** Number of live subscribers — used by tests + devtools. */
  readonly subscriberCount: number;
}

/** Increments per `signal()` call. Cloned signals share the same id. */
let __signalId = 0;

class SignalNode<T> implements ReactiveNode {
  /** Watchers that depend on this signal. Deduplicated by identity. */
  private _watchers: Set<Watcher> = new Set();
  /** External subscribers (e.g. from `subscribe(fn)`). Deduplicated by fn. */
  private _externalListeners: Set<(v: T, prev: T) => void> = new Set();
  /** True iff `_value` changed since the last drain (batch only). */
  private _pending = false;
  private _previous!: T;
  readonly id: number;
  name: string | undefined;

  constructor(private _value: T) {
    this.id = ++__signalId;
  }

  /** Read + track. */
  read(): T {
    const sub = getActiveSub();
    if (sub) {
      this._watchers.add(sub);
      sub._addSource(this);
    }
    return this._value;
  }

  /** Read without tracking. */
  peek(): T {
    return this._value;
  }

  /** Replace and notify synchronously (when changed). */
  set(next: T): void {
    if (Object.is(this._value, next)) return;
    const prev = this._value;
    this._value = next;
    notificationTransaction(() => {
      if (!this._pending) {
        this._pending = true;
        this._previous = prev;
        enqueueListener(this, () => {
          const previous = this._previous;
          const next = this._value;
          this._pending = false;
          if (!Object.is(next, previous)) {
            for (const listener of Array.from(this._externalListeners)) listener(next, previous);
          }
        });
      }
      this._prune();
      for (const watcher of Array.from(this._watchers)) watcher.schedule();
    });
  }

  /** Functional update. */
  update(fn: (prev: T) => T): void {
    this.set(fn(this._value));
  }

  /**
   * External subscription — fires after internal watchers
   * (effects / computeds) have re-run. Batches emit the final and initial values. Returns an unsubscribe function.
   *
   * Use this from non-reactive contexts (e.g. `model()` wiring its
   * `<name>Change` output). Inside an effect, prefer `signal()` to register
   * a tracked dep.
   */
  subscribe(fn: (value: T, previous: T) => void): () => void {
    this._externalListeners.add(fn);
    return () => {
      this._externalListeners.delete(fn);
    };
  }

  /** Prune dead watchers. */
  private _prune(): void {
    for (const w of Array.from(this._watchers)) {
      if (w._disposed) this._watchers.delete(w);
    }
  }

  // --- ReactiveNode --------------------------------------------------------

  _removeWatcher(w: Watcher): void {
    this._watchers.delete(w);
  }

  /** Number of live subscribers — used by tests + devtools. */
  get subscriberCount(): number {
    this._prune();
    return this._watchers.size;
  }
}

export function signal<T>(initial: T): Signal<T> {
  const node = new SignalNode<T>(initial);
  const callable = (() => node.read()) as Signal<T>;
  callable.peek = () => node.peek();
  callable.set = (next: T) => node.set(next);
  callable.update = (fn: (prev: T) => T) => node.update(fn);
  callable.subscribe = (fn: (value: T, previous: T) => void) =>
    node.subscribe(fn);
  callable.with_name = (name: string): Signal<T> => {
    node.name = name;
    return callable;
  };
  Object.defineProperty(callable, "id", {
    get: () => node.id,
    enumerable: true,
  });
  Object.defineProperty(callable, "name", {
    get: () => node.name,
    enumerable: true,
  });
  Object.defineProperty(callable, "subscriberCount", {
    get: () => node.subscriberCount,
    enumerable: true,
  });
  return callable;
}
