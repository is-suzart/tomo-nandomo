import { effect } from './effect.js';
import { isInputRef, isOutputRef, type InputRef, type OutputRef } from './inputs.js';
import { withActiveSub } from './runtime.js';
import { Scope } from './scope.js';

export type ComponentTarget = 'html' | 'qml' | 'gtk' | 'compose';

export interface SetupContext {
  onMount(fn: () => void | (() => void)): void;
  onUnmount(fn: () => void): void;
}

export type ComponentProps<S> = {
  [K in keyof S as S[K] extends InputRef<unknown> | OutputRef<unknown> ? K : never]?:
    S[K] extends InputRef<infer V> ? V | (() => V) :
    S[K] extends OutputRef<infer V> ? (value: V) => void : never;
};

export interface ComponentOptions<S extends object, P extends Partial<Record<ComponentTarget, unknown>>> {
  name: string;
  setup(context: SetupContext): S;
  platforms?: { [K in keyof P]: { setup(state: S, context: SetupContext): P[K] } };
  views: { [K in ComponentTarget]?: (state: S, platform: K extends keyof P ? P[K] : undefined) => unknown };
}

export interface DefinedComponent<S extends object, P extends Partial<Record<ComponentTarget, unknown>>> {
  (props: ComponentProps<S>): DefinedComponentRef;
  readonly definition: ComponentOptions<S, P>;
}

export interface DefinedComponentRef {
  readonly __definedComponent: true;
  instantiate(target: ComponentTarget): ComponentInstance;
}

export interface ComponentInstance {
  view(): unknown;
  mount(): void;
  dispose(): void;
}

export function isDefinedComponentRef(value: unknown): value is DefinedComponentRef {
  return typeof value === 'object' && value !== null &&
    (value as Partial<DefinedComponentRef>).__definedComponent === true;
}

/** Setup/state is created only when the bridge mounts a reference. */
export function defineComponent<S extends object, P extends Partial<Record<ComponentTarget, unknown>> = {}>(
  options: ComponentOptions<S, P>,
): DefinedComponent<S, P> {
  if (!options.name.trim()) throw new Error('[nandomo/core] Component name is required');
  const component = (props: ComponentProps<S>): DefinedComponentRef => ({
    __definedComponent: true,
    instantiate(target) {
      const view = options.views[target];
      if (!view) throw new Error(`[nandomo/core] ${options.name} has no ${target} view`);
      const scope = new Scope();
      const mounts: Array<() => void | (() => void)> = [];
      let mounted = false;
      let disposed = false;
      const context: SetupContext = {
        onMount: fn => { mounts.push(fn); },
        onUnmount: fn => scope.own(fn),
      };
      try {
        const state = scope.run(() => withActiveSub(null, () => options.setup(context)));
        scope.run(() => withActiveSub(null, () => {
          for (const [key, value] of Object.entries(props)) {
            const field: unknown = (state as Record<string, unknown>)[key];
            if (isInputRef(field)) {
              if (typeof value === 'function') {
                effect(() => field.set((value as () => unknown)()));
              } else field.set(value);
            } else if (isOutputRef(field)) {
              if (typeof value !== 'function') {
                throw new TypeError(`[nandomo/core] ${options.name}.${key} must be an output handler`);
              }
              scope.own(field.subscribe(value as (value: unknown) => void));
            } else {
              throw new Error(`[nandomo/core] Unknown prop ${options.name}.${key}`);
            }
          }
        }));
        const platform = options.platforms?.[target as keyof P];
        const platformState = scope.run(() => withActiveSub(null, () => platform?.setup(state, context)));
        return {
          view: () => scope.run(() => withActiveSub(null, () =>
            view(state, platformState as never))),
          mount() {
            if (mounted || disposed) return;
            mounted = true;
            scope.run(() => withActiveSub(null, () => {
              for (const fn of mounts.splice(0)) {
                const cleanup = fn();
                if (typeof cleanup === 'function') scope.own(cleanup);
              }
            }));
          },
          dispose() { disposed = true; scope.dispose(); },
        };
      } catch (error) {
        try { scope.dispose(); } catch { /* preserve the setup error */ }
        throw error;
      }
    },
  });
  return Object.assign(component, { definition: options });
}
