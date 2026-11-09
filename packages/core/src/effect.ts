import type { ReactiveNode, Watcher } from "./runtime.js";
import { enqueueWatcher, withActiveSub } from "./runtime.js";
import { ownCleanup } from './scope.js';

/**
 * Handle returned by `effect()`.
 *   - `dispose()` marks the effect as cancelled, disconnects every source,
 *     and runs any user cleanup.
 */
export interface EffectHandle {
  dispose(): void;
}

class EffectInstance implements Watcher, ReactiveNode {
  private _sources: Set<ReactiveNode> = new Set();
  private _userCleanup: (() => void) | null = null;
  _disposed = false;
  private _cancelled = false;
  private _running = false;

  constructor(private readonly _fn: () => void | (() => void)) {}

  _addSource(source: ReactiveNode): void { this._sources.add(source); }

  /** Initial run — invoked synchronously by `effect()`. */
  run(): void {
    if (this._cancelled || this._disposed) return;
    this._execute();
  }

  /**
   * Called by source `set()`. Effects re-run synchronously (no microtask —
   * per ARCH recon §1.5, mirroring Rust `effect.rs:39-43`). To coalesce
   * multiple sync sets, use `batch(fn)`.
   */
  schedule(): void {
    if (this._cancelled || this._disposed) return;
    if (this._running) return; // re-entrant guard
    enqueueWatcher(this, () => {
      if (!this._disposed && !this._running) this._execute();
    });
  }

  _runFromNotify(): void {
    this.schedule();
  }

  /** Execute `fn` once with tracking. */
  private _execute(): void {
    if (this._cancelled || this._disposed) return;

    // Run prior cleanup if the user returned one last time.
    if (this._userCleanup) {
      const c = this._userCleanup;
      this._userCleanup = null;
      try {
        c();
      } catch {
        /* swallow — effect re-runs should not be aborted by cleanup errors */
      }
      if (this._cancelled) return;
    }

    // Disconnect from old sources so we can rebuild the dep set.
    for (const src of this._sources) src._removeWatcher(this);
    this._sources.clear();

    this._running = true;
    try {
      const maybeCleanup = withActiveSub(this, () => this._fn());
      if (typeof maybeCleanup === "function") {
        this._userCleanup = maybeCleanup;
      }
    } finally {
      this._running = false;
    }
  }

  _removeWatcher(_w: Watcher): void {
    void _w;
  }

  dispose(): void {
    if (this._disposed) return;
    // Set both flags: `_cancelled` blocks any in-flight re-run queued by
    // a synchronous notify, `_disposed` is the long-term signal for sources
    // to prune us. Per ARCH recon §1.4 — fixes the Mocha bug at
    // `qcomputed.ts:19-28` and `HANDOVER.md:422`.
    this._cancelled = true;
    this._disposed = true;

    if (this._userCleanup) {
      const c = this._userCleanup;
      this._userCleanup = null;
      try {
        c();
      } catch {
        /* swallow — disposal must always succeed */
      }
    }
    for (const src of this._sources) src._removeWatcher(this);
    this._sources.clear();
  }
}

/**
 * Create an effect. Runs `fn` immediately with tracking, then re-runs it
 * synchronously whenever a tracked source changes (per ARCH recon §1.5).
 *
 * If `fn` returns a function, that function is invoked before the next
 * re-run and on `dispose()`.
 *
 * To coalesce multiple sync `set()`s into a single effect re-run, wrap
 * them in `batch(fn)`.
 */
export function effect(fn: () => void | (() => void)): EffectHandle {
  const instance = new EffectInstance(fn);
  ownCleanup(() => instance.dispose());
  try { instance.run(); } catch (error) { instance.dispose(); throw error; }
  return {
    dispose: () => instance.dispose(),
  };
}
