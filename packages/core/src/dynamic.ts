import { batch } from './batch.js';
import { effect, type EffectHandle } from './effect.js';
import { signal, type Signal } from './signal.js';
import { withActiveSub } from './runtime.js';
import { Scope } from './scope.js';

export type ListKey = string | number;
export interface ForProps<T> {
  each: () => readonly T[];
  by: (item: T) => ListKey;
  /** Called once per key. Read item()/index() in bindings to receive updates. */
  children: (item: () => T, index: () => number) => unknown;
}
export interface ShowProps {
  when: () => unknown;
  children: () => unknown;
  fallback?: () => unknown;
}
export interface DynamicNode<T = unknown> {
  readonly __dynamic: true;
  /** Route swaps release the previous page before mounting names reused by the next. */
  readonly disposeBeforeMount?: boolean;
  readonly kind: 'for' | 'show';
  readonly props: ForProps<T> | ShowProps;
}
export function For<T>(props: ForProps<T>): DynamicNode<T> { return { __dynamic: true, kind: 'for', props }; }
export function Show(props: ShowProps): DynamicNode { return { __dynamic: true, kind: 'show', props }; }
export function isDynamicNode(value: unknown): value is DynamicNode {
  return typeof value === 'object' && value !== null && (value as DynamicNode).__dynamic === true;
}
export interface RegionAdapter<H> {
  mount(tree: unknown): H;
  order(handles: readonly H[]): void;
  remove(handle: H): void;
}

/** One reconciliation policy for all bridges; adapters only manage native nodes. */
export function mountDynamicRegion<H, T = unknown>(node: DynamicNode<T>, adapter: RegionAdapter<H>): { dispose(): void } {
  type Record = { handle: H; item: Signal<unknown>; index: Signal<number>; scope: Scope };
  let records = new Map<ListKey, Record>();
  let disposed = false;
  let watcher: EffectHandle | undefined;
  function release(record: Record) {
    try { record.scope.dispose(); } finally { adapter.remove(record.handle); }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    watcher?.dispose();
    const errors: unknown[] = [];
    for (const record of records.values()) { try { release(record); } catch (error) { errors.push(error); } }
    records.clear();
    if (errors.length) throw new AggregateError(errors, 'Dynamic region cleanup failed');
  }
  try {
    watcher = effect(() => {
      const props = node.props;
      const items = node.kind === 'for' ? (props as ForProps<unknown>).each() : [Boolean((props as ShowProps).when())];
      const keys = items.map(item => node.kind === 'for' ? (props as ForProps<unknown>).by(item) : item ? 'shown' : 'fallback');
      const unique = new Set<ListKey>();
      for (const key of keys) {
        if ((typeof key !== 'string' && typeof key !== 'number') || (typeof key === 'number' && !Number.isFinite(key))) throw new Error('[nandomo] List keys must be finite numbers or strings');
        if (unique.has(key)) throw new Error(`[nandomo] Duplicate list key: ${key}`);
        unique.add(key);
      }
      if (node.disposeBeforeMount) {
        for (const [key, record] of records) {
          if (!unique.has(key)) { records.delete(key); release(record); }
        }
      }
      const created: Record[] = [];
      const next = new Map<ListKey, Record>();
      try {
        items.forEach((value, index) => {
          const key = keys[index]!;
          let record = records.get(key);
          if (!record) {
            const item = signal(value), position = signal(index), scope = new Scope();
            try {
              const handle = withActiveSub(null, () => scope.run(() => {
                const tree = node.kind === 'for' ? (props as ForProps<unknown>).children(item, position)
                  : value ? (props as ShowProps).children() : (props as ShowProps).fallback?.();
                return adapter.mount(tree);
              }));
              record = { handle, item, index: position, scope };
              created.push(record);
            } catch (error) { try { scope.dispose(); } catch {} throw error; }
          }
          next.set(key, record);
        });
        adapter.order([...next.values()].map(record => record.handle));
      } catch (error) {
        for (const record of created) { try { release(record); } catch {} }
        throw error;
      }
      const old = records;
      records = next;
      batch(() => {
        items.forEach((value, index) => {
          const record = next.get(keys[index]!)!;
          record.item.set(value); record.index.set(index);
        });
        const errors: unknown[] = [];
        for (const [key, record] of old) if (!next.has(key)) { try { release(record); } catch (error) { errors.push(error); } }
        if (errors.length) throw new AggregateError(errors, 'Dynamic region removal failed');
      });
    });
    return { dispose };
  } catch (error) { try { dispose(); } catch {} throw error; }
}
