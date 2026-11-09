import { submitNativeUpdate } from './host.js';
import { createWireValueCache } from '@nandomo/bridge-runtime/native-updates';
// nandomo · bridge-gtk · render() entry point.
//
// Walks the spec tree once, allocating widgets in the host process
// (via the GtkHost abstraction). The reactive layer is the same as
// bridge-web: a top-level effect for reads made while building the spec,
// plus isolated per-prop effects for reactive prop values.
//
// `dispose()` shuts down the host process and unsubscribes all
// effects.

import { isInputRef, isOutputRef, effect, type EffectHandle, isDefinedComponentRef, isDynamicNode, mountDynamicRegion, isDialogNode, readDialogBinding, requestDialogClose, type DialogNode, type LayoutNode } from '@nandomo/core';
import { mountGtkLayout } from './layout.js';
import {
  isSpecNode,
  type SpecNode,
} from './primitives/types.js';
import {
  COMPONENT_REF_BRAND,
  isComponentRef,
  type ComponentRef,
} from './component-ref.js';
import { createHandlerRegistry, type HandlerRegistry } from './handlers.js';
import { provideGtkStorage } from './capabilities.js';
import {
  startHost,
  type GtkHost,
  type StartHostOptions,
} from './host.js';

// Re-exports so callers can grab the same ComponentRef helpers
// jsx-runtime uses.
export {
  COMPONENT_REF_BRAND,
  createComponentRef,
  isComponentRef,
  type ComponentRef,
} from './component-ref.js';

// ─── Event-prop mapping ──────────────────────────────────────────────────────
//
// onXxx JSX prop → GTK signal name. Kept small for v0; bridges for more
// signals can be added by extending this table. Mirrors bridge-web.
const EVENT_MAP: Record<string, string> = {
  onTap: 'clicked',
  onClick: 'clicked',
  onChange: 'changed',
  onInput: 'changed',
  onSubmit: 'activate',
  onToggle: 'toggled',
};

const EVENT_PROP_RE = /^on[A-Z]/;

// ─── Kind → GTK widget class (debug label only — host owns the mapping) ──────
//
// The Rust host keeps its own `kind → gtk4::Widget*` table. JS doesn't
// need to know the exact widget type — just declare intent with a kind.
const KNOWN_KINDS = new Set([
  'Window',
  'Scroll',
  'Stack',
  'View',
  'Container',
  'Button',
  'CheckButton',
  'Text',
  'RichText',
  'Select',
  'Input',
  'Image',
  'Icon',
  'Slider',
  'Switch',
  'Spinner',
  'FileChooser',
  'MenuBar',
]);

// ─── Kind → native signal for `onChange` ─────────────────────────────────────
//
// The generic map sends `changed`, which only Entry/ComboBoxText emit. The
// native controls expose their own signals, so the kind decides.
const KIND_CHANGE_SIGNAL: Record<string, string> = {
  Slider: 'value-changed',
  Switch: 'notify::active',
  FileChooser: 'response',
  MenuBar: 'activate',
};

// ─── Options + RootHandle ────────────────────────────────────────────────────

export interface RenderOptions extends StartHostOptions {
  /**
   * Path of the GTK binary. Defaults to
   * `./packages/bridge-gtk-host/target/release/bridge-gtk-host`
   * relative to CWD, or `$BRIDGE_GTK_HOST_PATH` if set.
   *
   * Tests can pass `transport: new InMemoryIpcTransport()` to skip
   * the spawn entirely.
   */
  binaryPath?: string;
  /**
   * When true (default), render() auto-registers the bridge's default
   * capabilities (Storage) on its first call.
   */
  provideDefaults?: boolean;
  /**
   * Skip the effect-rebuild-on-change reactivity (default: enabled).
   * Disabling this is useful for tests that want to drive re-renders
   * by recreating the host manually.
   */
  enableReactivity?: boolean;
}

export interface RootHandle {
  dispose(): void;
  readonly closed: Promise<void>;
  /** Force a re-walk of the spec tree right now (test seam). */
  rerender(): void;
  /** Access the host (advanced — for diagnostics + tests). */
  readonly host: GtkHost;
  readonly handlerRegistry: HandlerRegistry;
  object(name: string): { inspect(properties: string[]): Promise<Record<string, unknown>>; set(property: string, value: unknown): Promise<void>; invoke(signal: string): Promise<void> };

}

function ensureDefaultCapabilities(): void {
  // `provideCapability` is idempotent (overwrites) and `provideGtkStorage`
  // simply constructs a fresh in-memory impl each call — no need for
  // a module-scoped "already provided" flag. Calling this on every
  // render() lets tests reset the capability registry between cases
  // without breaking the auto-provide contract.
  try {
    provideGtkStorage();
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.warn('[nandomo/bridge-gtk] default Storage provider fell back:', err);
    }
  }
}

// ─── Public render() ─────────────────────────────────────────────────────────

export function render(spec: () => unknown, opts: RenderOptions = {}): RootHandle {
  if (typeof spec !== 'function') {
    throw new TypeError('[nandomo/bridge-gtk] render(): spec must be a function returning a spec tree');
  }

  if (opts.provideDefaults !== false) {
    ensureDefaultCapabilities();
  }

  const handlers = createHandlerRegistry();
  const host = startHost(opts);
  host.setHandlerRegistry(handlers);

  // Mounted tree state. We track the root widget id (id 1 — the
  // ApplicationWindow the host creates on `ready`).
  // We don't actually need to send a create for the root — the host
  // emits `ready` once its built the initial ApplicationWindow and
  // reserved id 1 for it.
  let mounted: MountedRoot | null = null;
  let disposed = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });

  const teardown = (): void => {
    if (mounted) {
      for (const c of mounted.cleanups) {
        try { c(); } catch (err) {
          if (typeof console !== 'undefined') console.error('[bridge-gtk] cleanup:', err);
        }
      }
      mounted = null;
    }
  };

  const mount = (): void => {
    teardown();
    const tree = spec();
    const m = new MountedRoot();
    mounted = m;
    mountInto(tree, m, { host, handlers, parent: 1 /* the Window id */, cleanups: m.cleanups });
  };

  // The reactive plumbing — same shape as bridge-web: spec() inside
  // an effect tracks signal/computed reads and re-runs on changes.
  // Only reads captured here rebuild the root. Reactive props and dynamic
  // regions own their effects and update without rebuilding this tree.
  let rootEffect: EffectHandle | null = null;
  try {
  if (opts.enableReactivity !== false) {
    rootEffect = effect(() => {
      mount();
    });
  } else {
    mount();
  }

  } catch (error) {
    disposed = true;
    teardown(); handlers.clear();
    void host.shutdown().finally(resolveClosed);
    throw error;
  }
  const unsubscribeExit = host.transport.onEvent(event => {
    if (event.event !== 'exit' || disposed) return;
    disposed = true;
    rootEffect?.dispose(); teardown(); handlers.clear(); unsubscribeExit();
    resolveClosed();
  });

  const handle: RootHandle = {
    closed,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      try { rootEffect?.dispose(); } catch { /* ignore */ }
      teardown();
      handlers.clear();
      unsubscribeExit();
      void host.shutdown().finally(resolveClosed);
    },
    rerender(): void {
      if (disposed) throw new Error('GTK root disposed');
      mount();
    },
    host,
    handlerRegistry: handlers,
    object(name) {
      const find = () => {
        if (disposed) throw new Error('GTK root disposed');
        for (const [id, entry] of mounted?.widgets ?? []) if (entry.props.objectName === name) return id;
        throw new Error(`Unknown GTK objectName: ${name}`);
      };
      return { inspect: async properties => host.inspect(find(), properties),
        set: async (property, value) => host.set(find(), property, value),
        invoke: async signal => host.invoke(find(), signal) };
    },
  };

  // Wait for host to be ready before resolving. Tests with custom
  // transports that don't emit `ready` (e.g. they just inject commands)
  // skip this by setting `handleReady: false` (implicit in InMemory
  // transport — see host.ts).
  void host.whenReady().then(() => {
    // First mount after the host is up — fires effects + allocates
    // initial widget ids. If `enableReactivity` is off, we already
    // mounted above; this is a no-op.
    if (opts.enableReactivity === false) return;
    // Otherwise the effect ran synchronously above (before the host
    // was ready), so the create commands were buffered behind the
    // ready event — we don't re-run here. Render is already done.
  }).catch(() => { if (!disposed) handle.dispose(); });

  return handle;
}

// ─── Mounting ─────────────────────────────────────────────────────────────────

interface MountCtx {
  host: GtkHost;
  handlers: HandlerRegistry;
  parent: number;
  cleanups: Array<() => void>;
}

/**
 * Tracks the mount tree for one render() call. The widget-id → kind
 * map is mostly for debugging / diagnostics.
 */
class MountedRoot {
  readonly cleanups: Array<() => void> = [];
  readonly widgets = new Map<number, { kind: string; props: Record<string, unknown> }>();
}

function mountInto(
  node: unknown,
  root: MountedRoot,
  ctx: MountCtx,
): number | void {
  if (node == null || node === false || node === true) return;

  if (Array.isArray(node)) {
    for (const child of node) mountInto(child, root, ctx);
    return;
  }

  if (isDefinedComponentRef(node)) {
    const instance = node.instantiate('gtk');
    const cleanups: Array<() => void> = [];
    try {
      mountInto(instance.view(), root, { ...ctx, cleanups });
      instance.mount();
      ctx.cleanups.push(() => { try { instance.dispose(); } finally { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); } });
    } catch (error) {
      try { instance.dispose(); } catch {}
      for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch {} }
      throw error;
    }
    return;
  }
  if (isDynamicNode(node)) {
    const container = ctx.host.create('View', {});
    submitNativeUpdate(ctx.host, ctx.host.addChild(ctx.parent, container.id));
    let region: ReturnType<typeof mountDynamicRegion>;
    const previousOrder = createWireValueCache();
    try { region = mountDynamicRegion(node, {
      mount(tree) {
        const wrapper = ctx.host.create('View', {});
        const cleanups: Array<() => void> = [];
        submitNativeUpdate(ctx.host, ctx.host.addChild(container.id, wrapper.id));
        try { mountInto(tree, root, { ...ctx, parent: wrapper.id, cleanups }); }
        catch (error) { for (const cleanup of cleanups.reverse()) { try { cleanup(); } catch {} } submitNativeUpdate(ctx.host, ctx.host.removeChild(container.id, wrapper.id)); submitNativeUpdate(ctx.host, ctx.host.destroy(wrapper.id)); throw error; }
        const present = tree !== undefined && tree !== null && tree !== false && !(Array.isArray(tree) && tree.length === 0);
        return { id: wrapper.id, cleanups, present };
      },
      order(handles) {
        // Empty Show branches and empty lists must not reserve Box spacing.
        const visible = handles.some(handle => handle.present);
        const ids = handles.map(handle => handle.id);
        if (previousOrder.changed('visible', visible)) submitNativeUpdate(ctx.host, ctx.host.set(container.id, 'visible', visible));
        if (previousOrder.changed('order', ids)) submitNativeUpdate(ctx.host, ctx.host.reorder(container.id, ids));
      },
      remove(handle) {
        for (const cleanup of handle.cleanups.splice(0).reverse()) { try { cleanup(); } catch (error) { console.error(error); } }
        if (ctx.host.isAlive()) { submitNativeUpdate(ctx.host, ctx.host.removeChild(container.id, handle.id)); submitNativeUpdate(ctx.host, ctx.host.destroy(handle.id)); }
      },
    }); } catch (error) {
      if (ctx.host.isAlive()) { submitNativeUpdate(ctx.host, ctx.host.removeChild(ctx.parent, container.id)); submitNativeUpdate(ctx.host, ctx.host.destroy(container.id)); }
      throw error;
    }
    ctx.cleanups.push(() => {
      try { region.dispose(); } finally { if (ctx.host.isAlive()) { submitNativeUpdate(ctx.host, ctx.host.removeChild(ctx.parent, container.id)); submitNativeUpdate(ctx.host, ctx.host.destroy(container.id)); } }
    });
    return;
  }
  if (isDialogNode(node)) {
    mountDialog(node, root, ctx);
    return;
  }

  if (isComponentRef(node)) {
    mountComponent(node, root, ctx);
    return;
  }

  if (!isSpecNode(node)) {
    return mountInto({ __spec: true, kind: 'Text', props: { value: String(node) } }, root, ctx);
  }
  if (node.kind === 'ui:Flex' || node.kind === 'ui:Div') {
    const mounted = mountGtkLayout(node as LayoutNode, ctx.host, (parent, children, cleanups) => {
      mountInto(children, root, { ...ctx, parent, cleanups });
    });
    root.widgets.set(mounted.id, { kind: node.kind, props: node.props });
    ctx.cleanups.push(() => {
      if (ctx.host.isAlive()) submitNativeUpdate(ctx.host, ctx.host.removeChild(ctx.parent, mounted.id));
      try { for (const cleanup of mounted.cleanups) cleanup(); }
      finally {
        root.widgets.delete(mounted.id);
      }
    });
    submitNativeUpdate(ctx.host, ctx.host.addChild(ctx.parent, mounted.id));
    return;
  }

  const spec = node.kind.startsWith('gtk:') ? { ...node, kind: node.kind.slice(4) } : node;
  if (!KNOWN_KINDS.has(spec.kind)) {
    throw new Error(`[nandomo/bridge-gtk] unknown spec kind: ${spec.kind}`);
  }

  // Special case: Window creates the root, but the host already owns
  // the ApplicationWindow — treat it as a no-op reparent.
  if (spec.kind === 'Window') {
    applyPropsToRoot(spec, root, ctx);
    return;
  }

  const initialProps = Object.fromEntries(Object.entries(spec.props).filter(([key, value]) => key !== 'children' && key !== 'ref' && key !== 'objectName' && typeof value !== 'function'));
  const ref = ctx.host.create(spec.kind, initialProps);
  root.widgets.set(ref.id, { kind: spec.kind, props: spec.props });
  const cleanups: Array<() => void> = [];
  ctx.cleanups.push(() => {
    for (const cleanup of cleanups.splice(0).reverse()) { try { cleanup(); } catch (error) { console.error(error); } }
    root.widgets.delete(ref.id);
    if (ctx.host.isAlive()) { submitNativeUpdate(ctx.host, ctx.host.removeChild(ctx.parent, ref.id)); submitNativeUpdate(ctx.host, ctx.host.destroy(ref.id)); }
  });
  applyProps(ref.id, spec.kind, spec.props, root, { ...ctx, cleanups });
  submitNativeUpdate(ctx.host, ctx.host.addChild(ctx.parent, ref.id));
}

function mountDialog(node: DialogNode, root: MountedRoot, ctx: MountCtx): void {
  const props = node.props;
  // GTK's native modal surface is a window, not an in-window backdrop.
  if (props.objectName && [...root.widgets.values()].some(widget => widget.props.objectName === props.objectName)) {
    throw new Error(`[nandomo/gtk] Duplicate objectName: ${props.objectName}`);
  }
  const ref = ctx.host.create('Dialog', {});
  const cleanups: Array<() => void> = [];
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    // Hide first, while the opener and descendants still exist.
    if (ctx.host.isAlive()) submitNativeUpdate(ctx.host, ctx.host.set(ref.id, 'open', false));
    for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
    root.widgets.delete(ref.id);
    if (ctx.host.isAlive()) submitNativeUpdate(ctx.host, ctx.host.destroy(ref.id));
  };
  root.widgets.set(ref.id, { kind: 'Dialog', props: { objectName: props.objectName } });
  try {
    const handler = ctx.handlers.register(reason => requestDialogClose(props, reason as 'escape' | 'outside' | 'dismiss'));
    cleanups.push(() => ctx.handlers.unregister(handler));
    submitNativeUpdate(ctx.host, ctx.host.connect(ref.id, 'dialog-request', handler));
    const content = ctx.host.create('View', { spacing: 12 });
    cleanups.push(() => { if (ctx.host.isAlive()) submitNativeUpdate(ctx.host, ctx.host.destroy(content.id)); });
    submitNativeUpdate(ctx.host, ctx.host.addChild(ref.id, content.id));
    mountInto(props.children, root, { ...ctx, parent: content.id, cleanups });
    submitNativeUpdate(ctx.host, ctx.host.addChild(ctx.parent, ref.id));
    if (props.initialFocus) {
      const target = [...root.widgets].find(([, widget]) => widget.props.objectName === props.initialFocus);
      if (!target) throw new Error(`[nandomo/gtk] Unknown Dialog.initialFocus: ${props.initialFocus}`);
      submitNativeUpdate(ctx.host, ctx.host.set(ref.id, 'initial-focus', target[0]));
    }
    const previous = createWireValueCache();
    const title = effect(() => { const next=readDialogBinding(props.title); if(previous.changed('title',next))submitNativeUpdate(ctx.host, ctx.host.set(ref.id, 'title', next)); });
    cleanups.push(() => title.dispose());
    const open = effect(() => {
      if (readDialogBinding(props.closeOnOutside ?? false)) throw new Error('[nandomo/gtk] Dialog.closeOnOutside is unsupported by native GTK modal windows');
      const next = readDialogBinding(props.open);
      if(previous.changed('open',next))submitNativeUpdate(ctx.host, ctx.host.set(ref.id, 'open', next));
    });
    cleanups.push(() => open.dispose());
    ctx.cleanups.push(cleanup);
  } catch (error) { cleanup(); throw error; }
}

/**
 * For the Window case the host has already created id=1 (the
 * ApplicationWindow). We just apply any props to it directly.
 */
function applyPropsToRoot(spec: SpecNode, root: MountedRoot, ctx: MountCtx): void {
  root.widgets.set(1, { kind: 'Window', props: spec.props });
  applyProps(1, 'Window', spec.props, root, ctx);
}

/**
 * Walks props for a widget, allocating widget-specific effects for
 * reactive (function-valued) props and registering event handlers.
 *
 * - Reactive function prop: `effect(() => host.set(id, key, fn()))`
 *   so any signal read inside `fn()` re-runs the prop update.
 * - Event prop: `handlers.register(fn)` returns an id we wire into
 *   `host.connect(id, signal, handlerId)`.
 * - Literal prop: `host.set(id, key, value)` once.
 */
function applyProps(
  id: number,
  kind: string,
  props: Record<string, unknown>,
  root: MountedRoot,
  ctx: MountCtx,
): void {
  // `children` is handled by the parent (creates child widgets and
  // reparents them). Don't try to set it as a property.
  //
  // `class` → `cssClasses`: GTK has no `class` property, so passing it
  // verbatim made the host answer "Unknown GTK property: class" and drop
  // the widget from the registry. `style` is a web-only concept and is
  // dropped here for the same reason.
  const propEntries: Array<[string, unknown]> = Object.entries(props)
    .filter(([k]) => k !== 'children' && k !== 'objectName' && k !== 'ref' && k !== 'style')
    .map(([k, v]) => [k === 'class' ? 'cssClasses' : k, v]);

  // A FileChooser must open only after its response handler is connected,
  // otherwise the dialog would answer an event nobody listens to yet.
  let deferredOpen: { value: unknown } | null = null;

  for (const [key, value] of propEntries) {
    if (EVENT_PROP_RE.test(key)) {
      const signalName = key === 'onChange' && KIND_CHANGE_SIGNAL[kind]
        ? KIND_CHANGE_SIGNAL[kind]
        : EVENT_MAP[key];
      if (signalName === undefined) {
        // Unknown event — silently ignore, matching bridge-web's policy.
        continue;
      }
      if (typeof value === 'function') {
        const handlerId = ctx.handlers.register(value as (...a: unknown[]) => unknown);
        submitNativeUpdate(ctx.host, ctx.host.connect(id, signalName, handlerId));
        ctx.cleanups.push(() => ctx.handlers.unregister(handlerId));
      } else if (value != null) {
        throw new TypeError(
          `[nandomo/bridge-gtk] event handler "${key}" must be a function, got ${typeof value}`,
        );
      }
      continue;
    }

    if (kind === 'FileChooser' && key === 'open') {
      deferredOpen = { value };
      continue;
    }

    if (typeof value === 'function') {
      // Reactive prop — wrap in effect.
      const fn = value as () => unknown;
      const previous = createWireValueCache();
      const eff = effect(() => {
        const resolved = fn();
        // Strip callbacks from the effect body so the bridge-gtk host
        // doesn't choke — most signals don't expect functions.
        const next = stripCallbacks(resolved);
        if (previous.changed(key, next)) submitNativeUpdate(ctx.host, ctx.host.set(id, key, next));
      });
      ctx.cleanups.push(() => eff.dispose());
      continue;
    }

    // Static prop — set once.
    submitNativeUpdate(ctx.host, ctx.host.set(id, key, value));
  }

  if (deferredOpen) {
    const { value } = deferredOpen;
    if (typeof value === 'function') {
      const fn = value as () => unknown;
      const previous = createWireValueCache();
      const eff = effect(() => {
        const next = Boolean(fn());
        if (previous.changed('open', next)) submitNativeUpdate(ctx.host, ctx.host.set(id, 'open', next));
      });
      ctx.cleanups.push(() => eff.dispose());
    } else {
      submitNativeUpdate(ctx.host, ctx.host.set(id, 'open', Boolean(value)));
    }
  }

  // Children: recurse with this widget as parent. Text and Input are
  // leaf widgets — their children are the textual value, NOT nested
  // widgets. We treat the children as a (reactive) value update
  // instead of a sub-tree mount.
  if (kind === 'Text') {
    const children = props.children;
    if (children == null) return;
    if (typeof children === 'function') {
      const fn = children as () => unknown;
      const previous = createWireValueCache();
      const eff = effect(() => {
        const value = String(fn() ?? '');
        if (previous.changed('text', value)) submitNativeUpdate(ctx.host, ctx.host.set(id, 'text', value));
      });
      ctx.cleanups.push(() => eff.dispose());
    } else {
      submitNativeUpdate(ctx.host, ctx.host.set(id, 'text', String(children)));
    }
    return;
  }

  const children = props.children;
  if (children == null) return;

  if (typeof children === 'function') {
    const fn = children as () => unknown;
    let childCleanups: Array<() => void> = [];
    // A child function that resolves to a plain string/number/boolean is a
    // label. Remounting it on every change would destroy and recreate the
    // widget; instead keep one Text widget and update its text.
    let textChild: number | null = null;
    const previousText = createWireValueCache();

    const dropTextChild = (): void => {
      if (textChild === null) return;
      const child = textChild;
      textChild = null;
      root.widgets.delete(child);
      if (ctx.host.isAlive()) {
        submitNativeUpdate(ctx.host, ctx.host.removeChild(id, child));
        submitNativeUpdate(ctx.host, ctx.host.destroy(child));
      }
    };

    const childEffect = effect(() => {
      const value = fn();
      const isPrimitive = typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

      if (isPrimitive) {
        for (const cleanup of childCleanups.splice(0).reverse()) cleanup();
        if (textChild === null) {
          const ref = ctx.host.create('Text', {});
          textChild = ref.id;
          root.widgets.set(ref.id, { kind: 'Text', props: {} });
          submitNativeUpdate(ctx.host, ctx.host.addChild(id, ref.id));
        }
        const text = String(value);
        if (previousText.changed('text', text)) submitNativeUpdate(ctx.host, ctx.host.set(textChild, 'text', text));
        return;
      }

      dropTextChild();
      previousText.forget('text');
      for (const cleanup of childCleanups.splice(0).reverse()) cleanup();
      try { mountInto(value, root, { ...ctx, parent: id, cleanups: childCleanups }); }
      catch (error) { for (const cleanup of childCleanups.splice(0).reverse()) { try { cleanup(); } catch {} } throw error; }
    });
    ctx.cleanups.push(() => {
      childEffect.dispose();
      for (const cleanup of childCleanups.splice(0).reverse()) cleanup();
      dropTextChild();
    });
    return;
  }

  mountInto(children, root, { ...ctx, parent: id });
}

/**
 * Strip function values from a prop value before sending to the
 * host. GTK properties are GObject values; functions don't survive
 * JSON serialization. Component code that puts functions in non-event
 * props is misuse — but we don't want it to crash.
 */
function stripCallbacks(value: unknown): unknown {
  if (typeof value === 'function') return undefined;
  if (Array.isArray(value)) return value.map(stripCallbacks);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripCallbacks(v);
    }
    return out;
  }
  return value;
}

// ─── Component composition ───────────────────────────────────────────────────

interface ComponentClass {
  new (): ComponentInstance;
}
interface ComponentInstance {
  view?: () => unknown;
  onMount?: () => void | (() => void);
  onUnmount?: () => void;
}

function mountComponent(ref: ComponentRef, root: MountedRoot, ctx: MountCtx): void {
  const instance = new (ref.ctor as ComponentClass)();
  const cleanups: Array<() => void> = [];

  // Wire inputs/outputs the same way bridge-web does.
  for (const key of Object.keys(ref.props)) {
    if (key === 'children') continue;
    const value = ref.props[key];
    const field = (instance as unknown as Record<string, unknown>)[key];
    if (field == null) continue;

    if (isInputRef(field)) {
      if (typeof value === 'function') {
        const inputRef = field;
        const eff = effect(() => {
          inputRef.set((value as () => unknown)() as never);
        });
        cleanups.push(() => eff.dispose());
      } else {
        field.set(value as never);
      }
      continue;
    }

    if (isOutputRef(field)) {
      if (typeof value === 'function') {
        const unsub = field.subscribe(value as (v: unknown) => void);
        cleanups.push(unsub);
      } else if (value != null) {
        throw new TypeError(
          `[nandomo/bridge-gtk] output handler "${key}" must be a function, got ${typeof value}`,
        );
      }
      continue;
    }
  }

  // Recurse into the instance's view() with the same parent.
  const viewFn = instance.view;
  if (typeof viewFn !== 'function') {
    throw new Error(
      `[nandomo/bridge-gtk] component class is missing view() — bridge expects every @Component to define it`,
    );
  }
  mountInto(viewFn.call(instance), root, ctx);

  // Drain lifecycle hooks.
  const lifecycleCleanups = runLifecycleMount(instance);
  for (const c of lifecycleCleanups) cleanups.push(c);
  cleanups.push(() => runLifecycleUnmount(instance));

  for (const c of cleanups) ctx.cleanups.push(c);
}

function runLifecycleMount(instance: ComponentInstance): Array<() => void> {
  const fn = instance.onMount;
  if (typeof fn !== 'function') return [];
  const maybe = fn.call(instance);
  return typeof maybe === 'function' ? [maybe] : [];
}

function runLifecycleUnmount(instance: ComponentInstance): void {
  const fn = instance.onUnmount;
  if (typeof fn === 'function') fn.call(instance);
}
