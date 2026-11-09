/** Ownership for effects/resources created by a component instance. */
export class Scope {
  private cleanups: Array<() => void> = [];
  private disposed = false;

  own(cleanup: () => void): void {
    if (this.disposed) cleanup();
    else this.cleanups.push(cleanup);
  }

  run<T>(fn: () => T): T {
    if (this.disposed) throw new Error('[nandomo/core] Component scope is disposed');
    const previous = activeScope;
    activeScope = this;
    try { return fn(); } finally { activeScope = previous; }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const errors: unknown[] = [];
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try { cleanup(); } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, 'Component cleanup failed');
  }
}

let activeScope: Scope | null = null;

export function ownCleanup(cleanup: () => void): void {
  activeScope?.own(cleanup);
}
