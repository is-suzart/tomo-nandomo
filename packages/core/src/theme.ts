/**
 * Theme = author-defined appearance tokens. Not a design system, not a
 * component library, not a platform-selection mechanism and not UX logic.
 *
 * A definition is data: `{ light, dark }` records of nested plain objects with
 * string or finite-number leaves. `defineTheme()` snapshots + deep-freezes the
 * author input (never mutating it); `createTheme()` builds isolated reactive
 * state per call. There is no global theme and no automatic detection.
 */

import { computed } from './computed.js';
import { ownCleanup } from './scope.js';
import { signal } from './signal.js';

export type ThemeMode = 'light' | 'dark';

/** What the author asked for. `system` means "follow the explicit host hint". */
export type ThemeModePreference = ThemeMode | 'system';

export type ThemeTokenValue = string | number;

/** Recursive plain record. Arrays, class instances and functions are rejected. */
export type ThemeTokens = {
  readonly [key: string]: ThemeTokenValue | ThemeTokens;
};

/** Readable binding. Changes go through the validated theme methods. */
export interface ThemeReader<T> {
  (): T;
  peek(): T;
}

export type ThemeSnapshot<T> = {
  readonly [K in keyof T]: T[K] extends ThemeTokens ? ThemeSnapshot<T[K]> : T[K];
};

/**
 * Value-agnostic shape of a token record: same keys, same nesting, leaves are
 * any string or finite number. Used to force light/dark to have the same shape.
 */
export type ThemeShape<T> = {
  [K in keyof T]: T[K] extends ThemeTokens ? ThemeShape<T[K]> : ThemeTokenValue;
};

/** Brand: only `defineTheme()` produces a usable definition. */
const THEME_DEFINITION: unique symbol = Symbol('nandomo.theme.definition');

export interface ThemeDefinition<T extends ThemeTokens = ThemeTokens> {
  /** Non-enumerable brand: only `defineTheme()` produces a valid definition. */
  readonly [THEME_DEFINITION]: true;
  readonly light: ThemeSnapshot<T>;
  readonly dark: ThemeSnapshot<T>;
}

export function isThemeDefinition(value: unknown): value is ThemeDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<ThemeDefinition>)[THEME_DEFINITION] === true
  );
}

export interface CreateThemeOptions {
  /** Initial desired mode. Defaults to `system`. */
  readonly mode?: ThemeModePreference;
  /**
   * Initial system hint. There is no browser/native lookup: the host (or the
   * application) calls `setSystemMode()` explicitly. Defaults to `light`.
   */
  readonly systemMode?: ThemeMode;
}

export interface Theme<T extends ThemeTokens = ThemeTokens> {
  /** Desired mode (light/dark/system). Readable in reactive contexts. */
  readonly mode: ThemeReader<ThemeModePreference>;
  /** Desired mode resolved through the explicit system hint. */
  readonly resolvedMode: ThemeReader<ThemeMode>;
  /** Frozen token record for the resolved mode. */
  readonly tokens: ThemeReader<ThemeSnapshot<T>>;
  setMode(mode: ThemeModePreference): void;
  setSystemMode(mode: ThemeMode): void;
  /** Idempotent. Discards the computeds owned by this theme. */
  dispose(): void;
  readonly disposed: boolean;
}

const DEFINITION_KEYS = new Set(['light', 'dark']);

/** Snapshot + deep-freeze the author input into a detached plain record. */
function snapshotTokens(value: unknown, path: string, seen: Set<object>): ThemeTokens {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(
      `[nandomo/core] theme${path} must be a plain token object, got ${describe(value)}`,
    );
  }
  if (Array.isArray(value)) {
    throw new TypeError(`[nandomo/core] theme${path} must be a plain token object, got an array`);
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(
      `[nandomo/core] theme${path} must be a plain token object, got ${describe(value)}`,
    );
  }
  if (seen.has(value as object)) {
    throw new TypeError(`[nandomo/core] theme${path} contains a cycle`);
  }
  seen.add(value as object);
  const out: Record<string, ThemeTokenValue | ThemeTokens> = {};
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const childPath = `${path}.${key}`;
    if (!key.trim()) throw new TypeError(`[nandomo/core] theme${path} has an empty token name`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) {
      throw new TypeError(`[nandomo/core] theme${childPath} must be data, not an accessor`);
    }
    const child: unknown = descriptor.value;
    if (typeof child === 'string') {
      defineToken(out, key, child);
    } else if (typeof child === 'number') {
      if (!Number.isFinite(child)) {
        throw new TypeError(
          `[nandomo/core] theme${childPath} must be a finite number, got ${String(child)}`,
        );
      }
      defineToken(out, key, child);
    } else if (typeof child === 'object' && child !== null) {
      defineToken(out, key, snapshotTokens(child, childPath, seen));
    } else {
      throw new TypeError(
        `[nandomo/core] theme${childPath} must be a string, a finite number or a nested token group, got ${describe(child)}`,
      );
    }
  }
  seen.delete(value as object);
  return Object.freeze(out);
}

/** `__proto__` is a setter on plain objects: define own properties instead. */
function defineToken(
  target: Record<string, ThemeTokenValue | ThemeTokens>,
  key: string,
  value: ThemeTokenValue | ThemeTokens,
): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: false,
    configurable: false,
  });
}

function assertSameShape(light: ThemeTokens, dark: ThemeTokens, path: string): void {
  const lightKeys = Object.keys(light);
  const darkKeys = new Set(Object.keys(dark));
  for (const key of lightKeys) {
    if (!darkKeys.has(key)) {
      throw new TypeError(`[nandomo/core] theme${path} is missing token "${key}" in the dark definition`);
    }
  }
  const lightSet = new Set(lightKeys);
  for (const key of Object.keys(dark)) {
    if (!lightSet.has(key)) {
      throw new TypeError(`[nandomo/core] theme${path} has token "${key}" only in the dark definition`);
    }
  }
  for (const key of lightKeys) {
    const a = light[key]!;
    const b = dark[key]!;
    if ((typeof a === 'object') !== (typeof b === 'object')) {
      throw new TypeError(`[nandomo/core] theme${path}.${key} must stay a token group or a leaf in both definitions`);
    }
    if (typeof a === 'object' && typeof b === 'object') assertSameShape(a, b, `${path}.${key}`);
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type !== 'object') return `a ${type}`;
  const name = (value as object).constructor?.name;
  return name && name !== 'Object' ? `a ${name} instance` : 'an object';
}

/**
 * Validate, snapshot and deep-freeze `{ light, dark }`. Both definitions must
 * have the same token shape. TypeScript checks required keys and groups;
 * runtime validation also rejects extra keys in either definition.
 */
export function defineTheme<
  const Light extends ThemeTokens,
  const Dark extends ThemeShape<Light> & ThemeTokens,
>(definition: { light: Light; dark: Dark }): ThemeDefinition<Light | Dark> {
  if (typeof definition !== 'object' || definition === null || Array.isArray(definition)) {
    throw new TypeError(`[nandomo/core] defineTheme expects { light, dark }, got ${describe(definition)}`);
  }
  for (const key of Object.keys(definition)) {
    if (!DEFINITION_KEYS.has(key)) {
      throw new TypeError(
        `[nandomo/core] defineTheme does not accept "${key}"; expected light and dark`,
      );
    }
  }
  const light = snapshotTokens((definition as { light?: unknown }).light, '.light', new Set());
  const dark = snapshotTokens((definition as { dark?: unknown }).dark, '.dark', new Set());
  assertSameShape(light, dark, ' light/dark');
  const frozen = { light, dark } as { light: Light | Dark; dark: Light | Dark };
  Object.defineProperty(frozen, THEME_DEFINITION, { value: true, enumerable: false });
  return Object.freeze(frozen) as unknown as ThemeDefinition<Light | Dark>;
}

function assertMode(mode: unknown, path: string): asserts mode is ThemeMode {
  if (mode !== 'light' && mode !== 'dark') {
    throw new TypeError(
      `[nandomo/core] theme${path} must be "light" or "dark", got ${JSON.stringify(mode) ?? String(mode)}`,
    );
  }
}

function assertPreference(mode: unknown, path: string): asserts mode is ThemeModePreference {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    throw new TypeError(
      `[nandomo/core] theme${path} must be "light", "dark" or "system", got ${JSON.stringify(mode) ?? String(mode)}`,
    );
  }
}

/**
 * Isolated reactive state for one definition. Two calls never share signals, so
 * several roots (or the same component mounted twice) stay independent.
 */
export function createTheme<const D extends ThemeDefinition>(
  definition: D,
  options: CreateThemeOptions = {},
): Theme<D['light']> {
  if (!isThemeDefinition(definition)) {
    throw new TypeError('[nandomo/core] createTheme expects a definition created by defineTheme()');
  }
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError(`[nandomo/core] createTheme options must be an object, got ${describe(options)}`);
  }
  const initial = options.mode === undefined ? 'system' : options.mode;
  const hint = options.systemMode === undefined ? 'light' : options.systemMode;
  assertPreference(initial, ' initial mode');
  assertMode(hint, ' initial system mode');

  const mode = signal<ThemeModePreference>(initial).with_name('theme.mode');
  const systemMode = signal<ThemeMode>(hint).with_name('theme.systemMode');
  const resolvedMode = computed<ThemeMode>(() => {
    const desired = mode();
    return desired === 'system' ? systemMode() : desired;
  });
  const tokens = computed<ThemeSnapshot<D['light']>>(
    () => (resolvedMode() === 'dark' ? definition.dark : definition.light) as ThemeSnapshot<D['light']>,
  );

  let disposed = false;
  const assertLive = (): void => {
    if (disposed) throw new Error('[nandomo/core] theme was disposed; create a new one instead of reusing it');
  };
  const reader = <T>(source: { (): T; peek(): T }): ThemeReader<T> => Object.freeze(
    Object.assign(() => { assertLive(); return source(); }, {
      peek: () => { assertLive(); return source.peek(); },
    }),
  );
  const theme: Theme<D['light']> = {
    mode: reader(mode),
    resolvedMode: reader(resolvedMode),
    tokens: reader(tokens),
    setMode(next: ThemeModePreference): void {
      assertLive();
      assertPreference(next, ' setMode() argument');
      mode.set(next);
    },
    setSystemMode(next: ThemeMode): void {
      assertLive();
      assertMode(next, ' setSystemMode() argument');
      systemMode.set(next);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      tokens.dispose();
      resolvedMode.dispose();
    },
    get disposed(): boolean {
      return disposed;
    },
  };
  // Inside a component setup the scope owns the theme; outside it the author
  // calls dispose() (or keeps it for the app lifetime).
  ownCleanup(() => theme.dispose());
  return theme;
}
