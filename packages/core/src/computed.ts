import type { ReactiveNode, Watcher } from './runtime.js';
import { enqueueWatcher, getActiveSub, withActiveSub } from './runtime.js';
import { ownCleanup } from './scope.js';

export interface Computed<T> {
  (): T;
  peek(): T;
  dispose(): void;
}

class ComputedNode<T> implements Watcher, ReactiveNode {
  readonly _computed = true;
  private _value!: T;
  private _sources = new Set<ReactiveNode>();
  private _watchers = new Set<Watcher>();
  private _initialized = false;
  private _dirty = true;
  private _running = false;
  _disposed = false;

  constructor(private readonly _fn: () => T) {}
  _addSource(source: ReactiveNode): void { this._sources.add(source); }

  read(): T {
    const value = this.peek();
    const sub = getActiveSub();
    if (sub && sub !== this) {
      this._watchers.add(sub);
      sub._addSource(this);
    }
    return value;
  }

  peek(): T {
    if (this._disposed) throw new Error('[nandomo/core] computed read after dispose()');
    if (this._running) throw new Error('[nandomo/core] circular computed dependency');
    if (this._dirty) this._recompute();
    return this._value;
  }

  private _recompute(): void {
    for (const source of this._sources) source._removeWatcher(this);
    this._sources.clear();
    this._running = true;
    try {
      const next = withActiveSub(this, this._fn);
      const changed = this._initialized && !Object.is(next, this._value);
      this._value = next;
      this._initialized = true;
      this._dirty = false;
      if (changed) {
        for (const watcher of Array.from(this._watchers)) {
          if (!watcher._disposed && watcher !== getActiveSub()) watcher.schedule();
        }
      }
    } finally { this._running = false; }
  }

  schedule(): void {
    if (this._disposed || this._dirty) return;
    this._dirty = true;
    // Invalidate derived descendants immediately so reads within a batch stay fresh.
    for (const watcher of Array.from(this._watchers)) {
      if (watcher._computed) watcher.schedule();
    }
    if (this._watchers.size) enqueueWatcher(this, () => {
      if (!this._disposed && this._dirty) this._recompute();
    });
  }

  _runFromNotify(): void { this.schedule(); }
  _removeWatcher(watcher: Watcher): void { this._watchers.delete(watcher); }
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    for (const source of this._sources) source._removeWatcher(this);
    this._sources.clear();
    this._watchers.clear();
  }
}

export function computed<T>(fn: () => T): Computed<T> {
  const node = new ComputedNode(fn);
  ownCleanup(() => node.dispose());
  const callable = (() => node.read()) as Computed<T>;
  callable.peek = () => node.peek();
  callable.dispose = () => node.dispose();
  return callable;
}
