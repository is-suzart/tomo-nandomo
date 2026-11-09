/**
 * Lifecycle hooks. Per ARCH recon §3.2 / §5.1: lifecycle is just two
 * optional methods on the component class. The bridge calls them
 * directly after constructing / before disposing the instance. No
 * decorator-based registration, no module-scoped stack.
 *
 * We keep `onMount` / `onUnmount` exported for codebases that prefer the
 * imperative, side-effecting form inside a class body — but they simply
 * forward to `instance.onMount?.()` / `instance.onUnmount?.()`. They MUST
 * be called inside a constructor where `this` is the component instance.
 *
 * This shape is deliberately simple: it removes the meta-object scanning
 * and "marker fields" anti-patterns from Mocha-legacy (see recon §5.2).
 */

export type Cleanup = () => void;
export type MountHook = () => void | Cleanup;
export type UnmountHook = () => void;

/**
 * Optional lifecycle interface. A class that wants lifecycle hooks can
 * implement either method; the bridge will detect them with duck typing.
 */
export interface ComponentLifecycle {
  onMount?(): void | Cleanup;
  onUnmount?(): void;
}

/**
 * Register an `onMount` callback via instance method. Intended to be
 * called inside the constructor of a `@Component`-decorated class:
 *
 * ```ts
 * @Component({ name: "Counter" })
 * class Counter {
 *   constructor() { onMount(this, () => console.log("mounted")); }
 * }
 * ```
 */
export function onMount(
  instance: { onMount?: () => void | Cleanup },
  fn: MountHook,
): void {
  const prev = instance.onMount;
  instance.onMount = () => {
    const a = prev?.();
    const b = fn();
    // Last non-undefined wins as the returned cleanup.
    if (typeof b === "function") return b;
    return a;
  };
}

/**
 * Register an `onUnmount` callback. Same calling convention as `onMount`.
 */
export function onUnmount(
  instance: { onUnmount?: () => void },
  fn: UnmountHook,
): void {
  const prev = instance.onUnmount;
  instance.onUnmount = () => {
    prev?.();
    fn();
  };
}

/** Bridge helper — run mount hooks for an instance, collecting cleanups. */
export function runMount(instance: ComponentLifecycle): Cleanup[] {
  const cleanups: Cleanup[] = [];
  if (typeof instance.onMount === "function") {
    const maybeCleanup = instance.onMount();
    if (typeof maybeCleanup === "function") cleanups.push(maybeCleanup);
  }
  return cleanups;
}

/** Bridge helper — run unmount hooks for an instance. */
export function runUnmount(instance: ComponentLifecycle): void {
  if (typeof instance.onUnmount === "function") {
    instance.onUnmount();
  }
}
