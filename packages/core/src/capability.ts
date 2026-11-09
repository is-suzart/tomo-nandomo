/**
 * Capability tokens. A bridge defines a capability with `defineCapability()`
 * and registers an implementation with `provideCapability()`. Components
 * consume it with `inject()`.
 *
 * The token is a plain object carrying an internal Symbol brand + a
 * human-readable `name`. The `unique symbol` type from the contract is
 * satisfied at the type level via the `Capability<T>` interface.
 */

declare const CapabilityBrand: unique symbol;

export interface Capability<T> {
  readonly [CapabilityBrand]: T;
  readonly name: string;
}

/** Module-scoped registry of provided implementations. */
const registry = new Map<Capability<unknown>, unknown>();

/**
 * Define a capability token. Call once per capability, export the result.
 */
export function defineCapability<T>(name: string): Capability<T> {
  const brand = Symbol(`capability:${name}`);
  // The `Capability<T>` brand is a type-level `unique symbol` — we satisfy
  // it at runtime by using a fresh Symbol as a hidden property key.
  const token = { [brand]: null, name } as unknown as Capability<T>;
  return token;
}

/**
 * Register an implementation. Called by the bridge during initialization.
 * Re-providing the same capability overwrites the previous impl.
 */
export function provideCapability<T>(cap: Capability<T>, impl: T): void {
  registry.set(cap, impl);
}

/**
 * Resolve an implementation. Throws a clear error if the bridge never
 * provided one for the active runtime.
 */
export function inject<T>(cap: Capability<T>): T {
  if (registry.has(cap)) {
    return registry.get(cap) as T;
  }
  throw new Error(
    `[nandomo/core] Capability "${cap.name}" was not provided. ` +
      `Make sure the active bridge calls provideCapability() during initialization.`,
  );
}

/** Test helper — drop every registered capability. Not part of the contract. */
export function _resetCapabilities(): void {
  registry.clear();
}
