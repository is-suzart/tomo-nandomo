/**
 * Shared reactive runtime primitives. No DOM, no Node-specific APIs.
 *
 * The reactive graph:
 *   - `Signal<T>` and `Computed<T>` are *sources*. They hold a Set<Watcher>
 *     of every subscriber.
 *   - `effect()` returns a Watcher (an EffectInstance) that runs its `fn`
 *     with tracking, then re-runs when any tracked source notifies.
 *   - Sources notify by calling `Watcher#schedule()`. Effects re-run
 *     synchronously (per ARCH recon §1.5). To coalesce multiple sync sets,
 *     wrap them in `batch(fn)`.
 *   - `Computed` nodes mark themselves dirty on notify and only recompute on
 *     next read.
 */

/** Implemented by EffectInstance and ComputedNode. */
export interface Watcher {
  readonly _computed?: boolean;
  _addSource(source: ReactiveNode): void;
  /** Called by a source after `set()`. Implementation decides scheduling. */
  schedule(): void;
  /** Internal — direct re-run (used for tests; effects usually schedule). */
  _runFromNotify(): void;
  /** True after `dispose()`. Sources prune watchers with this flag set. */
  _disposed: boolean;
}

/** Implemented by SignalNode and ComputedNode. */
export interface ReactiveNode {
  /** A watcher is removing itself from our subscriber set. */
  _removeWatcher(w: Watcher): void;
}

/**
 * Module-scoped "active subscriber" pointer. While a watcher (effect or
 * computed) is running its `fn`, this holds the watcher so signal/computed
 * reads can register themselves as a dependency.
 *
 * Stack discipline: `withActiveSub` saves/restores so nested runs (e.g. an
 * effect that triggers a computed read) work correctly.
 */
let activeSub: Watcher | null = null;

export function getActiveSub(): Watcher | null {
  return activeSub;
}

export function withActiveSub<T>(sub: Watcher | null, fn: () => T): T {
  const prev = activeSub;
  activeSub = sub;
  try {
    return fn();
  } finally {
    activeSub = prev;
  }
}

// Notifications are synchronous transactions: derived values settle before effects.
let transactionDepth = 0;
let flushing = false;
const derivedJobs = new Map<Watcher, () => void>();
const effectJobs = new Map<Watcher, () => void>();
const listenerJobs = new Map<object, () => void>();

export function enqueueWatcher(watcher: Watcher, run: () => void): void {
  (watcher._computed ? derivedJobs : effectJobs).set(watcher, run);
  if (!transactionDepth && !flushing) flushNotifications();
}

export function enqueueListener(key: object, run: () => void): void {
  listenerJobs.set(key, run);
}

export function notificationTransaction<T>(fn: () => T): T {
  transactionDepth++;
  try { return fn(); }
  finally {
    transactionDepth--;
    if (!transactionDepth && !flushing) flushNotifications();
  }
}

function flushNotifications(): void {
  flushing = true;
  const errors: unknown[] = [];
  try {
    while (derivedJobs.size || effectJobs.size || listenerJobs.size) {
      const queue = derivedJobs.size ? derivedJobs : effectJobs.size ? effectJobs : listenerJobs;
      const [key, run] = queue.entries().next().value!;
      queue.delete(key as Watcher);
      try { run(); } catch (error) { errors.push(error); }
    }
  } finally { flushing = false; }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, '[nandomo/core] notification failures');
}
