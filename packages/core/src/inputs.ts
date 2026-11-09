/**
 * `input`, `output`, `model` — parent/child communication primitives.
 *
 * Shape mirrors Mocha-legacy `core/src/inputs.ts:1-180` verbatim:
 *   - `InputRef<T>` is a brand + reactive value + subscribe + the underlying
 *     `property` (so the bridge can wire it).
 *   - `OutputRef<T>` is a brand + emit + subscribe.
 *   - `ModelRef<T>` combines the two with the `change` output.
 *   - Type guards use the same brand symbols (`__input`, `__output`,
 *     `__model`).
 */

import type { Signal } from "./signal.js";
import { signal } from "./signal.js";

export interface InputRef<T> {
  readonly __input: true;
  /** Read the current value. */
  readonly value: T;
  /** Set the current value. Triggers `subscribe` listeners. */
  set(next: T): void;
  /** Subscribe to changes. Returns an unsubscribe function. */
  subscribe(fn: (value: T, previous: T) => void): () => void;
  /** Underlying Signal — exposed for bridge wiring. */
  readonly property: Signal<T>;
}

export interface OutputRef<T> {
  readonly __output: true;
  /** Emit a value to all subscribers. */
  emit(value: T): void;
  /** Subscribe to the output. Returns an unsubscribe function. */
  subscribe(fn: (value: T) => void): () => void;
}

export interface ModelRef<T> {
  readonly __model: true;
  readonly value: T;
  set(next: T): void;
  subscribe(fn: (value: T, previous: T) => void): () => void;
  /** The `+Change` output that fires when the child writes a new value. */
  readonly change: OutputRef<T>;
  /** Underlying Signal — exposed for bridge wiring. */
  readonly property: Signal<T>;
}

// --- Type guards ------------------------------------------------------------

export function isInputRef(v: unknown): v is InputRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __input?: unknown }).__input === true
  );
}

export function isOutputRef(v: unknown): v is OutputRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __output?: unknown }).__output === true
  );
}

export function isModelRef(v: unknown): v is ModelRef<unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { __model?: unknown }).__model === true
  );
}

// --- Factories --------------------------------------------------------------

/**
 * Create an input field. Receives a value from the parent component.
 * Backed by a `Signal<T>` so it integrates with the reactive graph.
 *
 * @example
 * ```ts
 * class Child {
 *   name = input<string>("default");
 *   age = input(0);
 * }
 * ```
 */
export function input<T>(defaultValue?: T): InputRef<T> {
  const prop = signal<T>(defaultValue as T);
  const ref: InputRef<T> = {
    __input: true,
    property: prop,
    get value(): T {
      return prop();
    },
    set(next: T): void {
      prop.set(next);
    },
    subscribe(fn): () => void {
      return prop.subscribe(fn);
    },
  };
  return ref;
}

/**
 * Create an output event. Emits values to the parent component.
 *
 * @example
 * ```ts
 * class Child {
 *   clicked = output<{ id: string }>();
 *   handleClick(id: string) { this.clicked.emit({ id }); }
 * }
 * ```
 */
export function output<T = void>(): OutputRef<T> {
  const listeners = new Set<(v: T) => void>();
  const ref: OutputRef<T> = {
    __output: true,
    emit(value: T): void {
      for (const l of Array.from(listeners)) l(value);
    },
    subscribe(fn): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return ref;
}

/**
 * Create a two-way model binding. Combines an input + an output named
 * `<name>Change`. The `change` output fires whenever `.set()` writes a new
 * value (via a subscribe-on-property wiring).
 *
 * @example
 * ```ts
 * class Child {
 *   value = model<string>("");
 * }
 *
 * // Parent template:
 * // <Child [(value)]="parentValue" />
 * ```
 */
export function model<T>(defaultValue?: T): ModelRef<T> {
  const prop = signal<T>(defaultValue as T);
  const change = output<T>();
  // Mirror Mocha inputs.ts:162 — connect prop.changed to change.emit.
  // We use `subscribe` so the wiring lives entirely outside the reactive
  // graph (no extra effect overhead).
  const unsubscribe = prop.subscribe((value: T) => {
    change.emit(value);
  });

  const ref: ModelRef<T> = {
    __model: true,
    property: prop,
    change,
    get value(): T {
      return prop();
    },
    set(next: T): void {
      prop.set(next);
    },
    subscribe(fn): () => void {
      return prop.subscribe(fn);
    },
  };
  // Expose disposer so a bridge-level cleanup can break the wiring.
  // (Not part of the public API — the model ref self-cleans when garbage-
  // collected, since `subscribe` stores the listener on the prop node.)
  void unsubscribe;
  return ref;
}
