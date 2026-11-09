/**
 * `@Component({ name })` — standard ES class decorator (TS 5+).
 *
 * Attaches `__componentName` as static metadata on the class. Bridges
 * read this for DevTools / debugging.
 *
 * Per ARCH recon §3, the lifecycle hooks are optional methods on the
 * class (`onMount?()` / `onUnmount?()`). The bridge invokes them
 * directly. The decorator doesn't wrap the constructor or track any
 * instance state — it's just a marker.
 */

export interface ComponentConfig {
  name: string;
}

export const COMPONENT_NAME = "__componentName" as const;

export function Component(config: ComponentConfig): ClassDecorator {
  return (target: Function): void => {
    (target as unknown as Record<string, unknown>)[COMPONENT_NAME] =
      config.name;
  };
}
