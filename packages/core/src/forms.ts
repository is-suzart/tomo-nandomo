import { signal, type Signal } from './signal.js';
import { computed, type Computed } from './computed.js';
import { batch } from './batch.js';
import { ownCleanup } from './scope.js';

/** Scalar fields keep snapshots and equality predictable; collections are out of scope. */
export type FieldValue = string | number | boolean | null;
export interface FieldConfig<T extends FieldValue, V> {
  initial: T;
  validate?: (value: T, values: Readonly<V>) => readonly string[];
}
export interface FormField<T extends FieldValue> {
  value: Signal<T>;
  touched: Signal<boolean>;
  dirty: Computed<boolean>;
  errors: Computed<readonly string[]>;
  touch(): void;
}
export type SubmitResult<T> = { status: 'submitted'; value: T } | { status: 'invalid' | 'busy' | 'cancelled' };

/** Flat scalar form state, independent of controls and presentation. */
function createForm<V extends Record<string, FieldValue>>(
  config: { [K in keyof V]: FieldConfig<V[K], V> },
) {
  const keys = Object.keys(config) as Array<keyof V>;
  const initialValues = Object.fromEntries(keys.map(key => [key, config[key].initial])) as unknown as V;
  for (const value of Object.values(initialValues)) {
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('[nandomo/forms] Fields must be scalar');
  }
  const fields = Object.create(null) as { [K in keyof V]: FormField<V[K]> };
  let disposed = false;
  let generation = 0;
  let active: AbortController | undefined;
  const resources: Array<{ dispose(): void }> = [];
  const submitting = signal(false);
  const submitError = signal<unknown>(null);
  const ensure = () => { if (disposed) throw new Error('[nandomo/forms] Form disposed'); };
  const values = computed(() => Object.freeze(Object.fromEntries(keys.map(key => [key, fields[key].value()]))) as Readonly<V>);
  resources.push(values);
  for (const key of keys) {
    const initial = initialValues[key];
    const value = signal(initial);
    const touched = signal(false);
    const dirty = computed(() => !Object.is(value(), initial));
    const errors = computed<readonly string[]>(() => config[key].validate?.(value(), values()) ?? []);
    resources.push(dirty, errors);
    fields[key] = { value, touched, dirty, errors, touch() { ensure(); touched.set(true); } };
  }
  const valid = computed(() => keys.every(key => fields[key].errors().length === 0));
  const dirty = computed(() => keys.some(key => fields[key].dirty()));
  resources.push(valid, dirty);
  const cancel = () => { generation++; active?.abort(); active = undefined; submitting.set(false); };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cancel();
    for (const resource of resources.reverse()) resource.dispose();
  };
  ownCleanup(dispose);
  const validate = () => {
    ensure();
    batch(() => { for (const key of keys) fields[key].touched.set(true); });
    return valid.peek();
  };
  return {
    fields, values, valid, dirty, submitting, submitError,
    validate,
    reset() {
      ensure();
      batch(() => {
        cancel(); submitError.set(null);
        for (const key of keys) { fields[key].value.set(initialValues[key]); fields[key].touched.set(false); }
      });
    },
    async submit<T>(handler: (values: Readonly<V>, signal: AbortSignal) => T | Promise<T>): Promise<SubmitResult<T>> {
      ensure();
      if (submitting.peek()) return { status: 'busy' };
      if (!validate()) return { status: 'invalid' };
      const snapshot = Object.freeze({ ...values.peek() });
      const controller = new AbortController();
      active = controller;
      const token = ++generation;
      batch(() => { submitting.set(true); submitError.set(null); });
      try {
        const value = await handler(snapshot, controller.signal);
        return token === generation ? { status: 'submitted', value } : { status: 'cancelled' };
      } catch (error) {
        if (token !== generation) return { status: 'cancelled' };
        submitError.set(error);
        throw error;
      } finally {
        if (token === generation) { active = undefined; submitting.set(false); }
      }
    },
    dispose,
  };
}

type Widen<T> = T extends string ? string : T extends number ? number : T extends boolean ? boolean : T;
type Values<V> = { [K in keyof V]: Widen<V[K]> };

/** Creates a form; inferred scalar literals are widened for editable fields. */
export function formSignals<V extends Record<string, FieldValue>>(
  config: { [K in keyof V]: FieldConfig<Values<V>[K] & FieldValue, Values<V>> },
) {
  return createForm<Values<V>>(config);
}
