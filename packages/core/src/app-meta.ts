/**
 * AppMeta = declarative application identity plus optional platform
 * declarations. It is data only: nothing here generates manifests, installers,
 * desktop entries or browser globals. There is no process-global metadata
 * registry. Native declarations do not automatically generate an Android manifest.
 */

import type { ComponentTarget } from './define-component.js';
import { isThemeDefinition, type ThemeDefinition } from './theme.js';

/** Rendering targets; Compose currently has an Android host. */
export const COMPONENT_TARGETS: readonly ComponentTarget[] = Object.freeze(['html', 'qml', 'gtk', 'compose']);

export function isComponentTarget(value: unknown): value is ComponentTarget {
  return typeof value === 'string' && (COMPONENT_TARGETS as readonly string[]).includes(value);
}

export type OgType = 'website' | 'article' | 'profile' | 'music.song' | 'video.movie' | 'book';
export type WebDisplay =
  | 'fullscreen'
  | 'standalone'
  | 'minimal-ui'
  | 'browser'
  | 'browser-compact';
export type WebOrientation =
  | 'any'
  | 'natural'
  | 'landscape'
  | 'landscape-primary'
  | 'landscape-secondary'
  | 'portrait'
  | 'portrait-primary'
  | 'portrait-secondary';
export type StatusBarStyle = 'default' | 'light' | 'dark' | 'black' | 'black-translucent';

export interface WebPlatformMeta {
  readonly ogType?: OgType;
  readonly ogImage?: string;
  readonly display?: WebDisplay;
  readonly orientation?: WebOrientation;
}

export interface LinuxPlatformMeta {
  readonly categories?: readonly string[];
  readonly terminal?: boolean;
  readonly mimeType?: string | readonly string[];
}

export interface WindowsPlatformMeta {
  readonly appId?: string;
}

export interface MacPlatformMeta {
  readonly bundleId?: string;
}

export interface MobilePlatformMeta {
  readonly capability?: string;
  readonly statusBarStyle?: StatusBarStyle;
}

/** Legacy platform declarations, preserved as optional data. */
export interface AppPlatformMeta {
  readonly web?: WebPlatformMeta;
  readonly linux?: LinuxPlatformMeta;
  readonly windows?: WindowsPlatformMeta;
  readonly mac?: MacPlatformMeta;
  readonly mobile?: MobilePlatformMeta;
}

export interface AppIcons {
  readonly svg?: string;
  readonly png_192?: string;
  readonly png_512?: string;
  readonly ico?: string;
  readonly icns?: string;
}

/** Input of `defineAppMeta()`. Legacy fields keep a compatible meaning. */
export interface AppMetaConfig {
  /** Reverse-DNS-ish identity, e.g. `dev.nandomo.app`. */
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly shortName?: string;
  readonly description?: string;
  /** CSS color, used by consumers such as the web `theme-color`. */
  readonly color?: string;
  readonly icons?: AppIcons;
  readonly platforms?: AppPlatformMeta;
}

/** Brand: only `defineAppMeta()` produces a usable AppMeta. */
const APP_META: unique symbol = Symbol('nandomo.app.meta');

/** Detached, deeply frozen snapshot produced by `defineAppMeta()`. */
export interface AppMeta {
  /** Non-enumerable brand: only `defineAppMeta()` produces a valid AppMeta. */
  readonly [APP_META]: true;
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly shortName?: string;
  readonly description?: string;
  readonly color?: string;
  readonly icons?: Readonly<AppIcons>;
  readonly platforms: Readonly<AppPlatformMeta>;
}

export function isAppMeta(value: unknown): value is AppMeta {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Partial<AppMeta>)[APP_META] === true
  );
}

export interface ProjectConfig<T extends ThemeDefinition | undefined = ThemeDefinition> {
  /** Non-empty, known, duplicate-free list of `ComponentTarget`s. */
  readonly targets: readonly ComponentTarget[];
  readonly app: AppMetaConfig | AppMeta;
  readonly theme?: T;
}

/** Detached, frozen result of `defineProject()`. */
export interface Project<T extends ThemeDefinition = ThemeDefinition> {
  readonly targets: readonly ComponentTarget[];
  readonly app: AppMeta;
  readonly theme?: T;
}

const ICON_KEYS = ['svg', 'png_192', 'png_512', 'ico', 'icns'] as const;
const WEB_KEYS = ['ogType', 'ogImage', 'display', 'orientation'] as const;
const LINUX_KEYS = ['categories', 'terminal', 'mimeType'] as const;
const WINDOWS_KEYS = ['appId'] as const;
const MAC_KEYS = ['bundleId'] as const;
const MOBILE_KEYS = ['capability', 'statusBarStyle'] as const;
const PLATFORM_KEYS = ['web', 'linux', 'windows', 'mac', 'mobile'] as const;
const META_KEYS = [
  'id', 'name', 'version', 'shortName', 'description', 'color', 'icons', 'platforms',
] as const;
const PROJECT_KEYS = ['targets', 'app', 'theme'] as const;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+-]*$/;
const BUNDLE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;
const TOKEN_RE = /^[A-Za-z0-9][A-Za-z0-9._+/-]*$/;
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const FN_COLOR_RE = /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([0-9A-Za-z.,%\s/+-]*\)$/;
const MAX_TEXT = 2048;

const OG_TYPES: readonly string[] = [
  'website', 'article', 'profile', 'music.song', 'video.movie', 'book',
];
const WEB_DISPLAYS: readonly string[] = [
  'fullscreen', 'standalone', 'minimal-ui', 'browser', 'browser-compact',
];
const WEB_ORIENTATIONS: readonly string[] = [
  'any', 'natural', 'landscape', 'landscape-primary', 'landscape-secondary',
  'portrait', 'portrait-primary', 'portrait-secondary',
];
const STATUS_BAR_STYLES: readonly string[] = ['default', 'light', 'dark', 'black', 'black-translucent'];

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  const type = typeof value;
  if (type !== 'object') return `a ${type}`;
  const name = (value as object).constructor?.name;
  return name && name !== 'Object' ? `a ${name} instance` : 'an object';
}

function label(path: string): string {
  return `[nandomo/core] app meta${path ? ` ${path}` : ''}`;
}

function assertPlainObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label(path)} must be a plain object, got ${describe(value)}`);
  }
  const proto = Object.getPrototypeOf(value) as unknown;
  if (proto !== Object.prototype && proto !== null) {
    throw new TypeError(`${label(path)} must be a plain object, got ${describe(value)}`);
  }
  for (const key of Object.keys(value)) {
    if (!('value' in Object.getOwnPropertyDescriptor(value, key)!)) {
      throw new TypeError(`${label(path ? `${path}.${key}` : key)} must be data, not an accessor`);
    }
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(value: Record<string, unknown>, keys: readonly string[], path: string): void {
  for (const key of Object.keys(value)) {
    if (!keys.includes(key)) throw new TypeError(`${label(path)} does not accept "${key}"`);
  }
}

function assertText(value: unknown, path: string, max = MAX_TEXT): string {
  if (typeof value !== 'string') {
    throw new TypeError(`${label(path)} must be a string, got ${describe(value)}`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError(`${label(path)} must not be empty`);
  if (value.length > max) throw new TypeError(`${label(path)} must have at most ${max} characters`);
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`${label(path)} must not contain control characters`);
  }
  return trimmed;
}

function assertEnum(value: unknown, allowed: readonly string[], path: string): string {
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new TypeError(
      `${label(path)} must be one of ${allowed.join(', ')}; got ${JSON.stringify(value) ?? describe(value)}`,
    );
  }
  return value;
}

function assertPattern(value: unknown, re: RegExp, path: string): string {
  const text = assertText(value, path);
  if (!re.test(text)) throw new TypeError(`${label(path)} has an unexpected format: ${JSON.stringify(text)}`);
  return text;
}

function assertStringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label(path)} must be an array of strings, got ${describe(value)}`);
  }
  const out: string[] = [];
  for (const [index, entry] of value.entries()) {
    const text = assertText(entry, `${path}[${index}]`, 256);
    if (out.includes(text)) throw new TypeError(`${label(path)} repeats "${text}"`);
    out.push(text);
  }
  return out;
}

function assertBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') {
    throw new TypeError(`${label(path)} must be a boolean, got ${describe(value)}`);
  }
  return value;
}

function assertColor(value: unknown, path: string): string {
  const text = assertText(value, path, 128);
  if (!HEX_COLOR_RE.test(text) && !FN_COLOR_RE.test(text)) {
    throw new TypeError(
      `${label(path)} must be a hex color (#rgb, #rgba, #rrggbb, #rrggbbaa) or a functional color such as oklch(...); got ${JSON.stringify(text)}`,
    );
  }
  return text;
}

function optional<T>(
  source: Record<string, unknown>,
  key: string,
  path: string,
  parse: (value: unknown, path: string) => T,
): T | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  return parse(value, path);
}

function parseIcons(value: unknown, path: string): Readonly<AppIcons> {
  const source = assertPlainObject(value, path);
  assertKnownKeys(source, ICON_KEYS, path);
  const icons: Record<string, string> = {};
  for (const key of ICON_KEYS) {
    const parsed = optional(source, key, `${path}.${key}`, assertText);
    if (parsed !== undefined) icons[key] = parsed;
  }
  return Object.freeze(icons) as Readonly<AppIcons>;
}

function parsePlatforms(value: unknown, path: string): Readonly<AppPlatformMeta> {
  const source = assertPlainObject(value, path);
  assertKnownKeys(source, PLATFORM_KEYS, path);
  const platforms: Record<string, unknown> = {};

  const web = optional(source, 'web', `${path}.web`, (raw, at) => {
    const record = assertPlainObject(raw, at);
    assertKnownKeys(record, WEB_KEYS, at);
    const out: Record<string, unknown> = {};
    const ogType = optional(record, 'ogType', `${at}.ogType`, (v, p) => assertEnum(v, OG_TYPES, p));
    const ogImage = optional(record, 'ogImage', `${at}.ogImage`, assertText);
    const display = optional(record, 'display', `${at}.display`, (v, p) => assertEnum(v, WEB_DISPLAYS, p));
    const orientation = optional(record, 'orientation', `${at}.orientation`, (v, p) =>
      assertEnum(v, WEB_ORIENTATIONS, p));
    if (ogType !== undefined) out.ogType = ogType;
    if (ogImage !== undefined) out.ogImage = ogImage;
    if (display !== undefined) out.display = display;
    if (orientation !== undefined) out.orientation = orientation;
    return Object.freeze(out);
  });

  const linux = optional(source, 'linux', `${path}.linux`, (raw, at) => {
    const record = assertPlainObject(raw, at);
    assertKnownKeys(record, LINUX_KEYS, at);
    const out: Record<string, unknown> = {};
    const categories = optional(record, 'categories', `${at}.categories`, assertStringArray);
    const terminal = optional(record, 'terminal', `${at}.terminal`, assertBoolean);
    const mimeType = optional(record, 'mimeType', `${at}.mimeType`, (v, p) =>
      typeof v === 'string' ? assertText(v, p) : assertStringArray(v, p));
    if (categories !== undefined) out.categories = Object.freeze(categories);
    if (terminal !== undefined) out.terminal = terminal;
    if (mimeType !== undefined) out.mimeType = typeof mimeType === 'string' ? mimeType : Object.freeze(mimeType);
    return Object.freeze(out);
  });

  const windows = optional(source, 'windows', `${path}.windows`, (raw, at) => {
    const record = assertPlainObject(raw, at);
    assertKnownKeys(record, WINDOWS_KEYS, at);
    const appId = optional(record, 'appId', `${at}.appId`, (v, p) => assertPattern(v, ID_RE, p));
    return Object.freeze(appId === undefined ? {} : { appId });
  });

  const mac = optional(source, 'mac', `${path}.mac`, (raw, at) => {
    const record = assertPlainObject(raw, at);
    assertKnownKeys(record, MAC_KEYS, at);
    const bundleId = optional(record, 'bundleId', `${at}.bundleId`, (v, p) =>
      assertPattern(v, BUNDLE_RE, p));
    return Object.freeze(bundleId === undefined ? {} : { bundleId });
  });

  const mobile = optional(source, 'mobile', `${path}.mobile`, (raw, at) => {
    const record = assertPlainObject(raw, at);
    assertKnownKeys(record, MOBILE_KEYS, at);
    const out: Record<string, unknown> = {};
    const capability = optional(record, 'capability', `${at}.capability`, (v, p) =>
      assertPattern(v, TOKEN_RE, p));
    const statusBarStyle = optional(record, 'statusBarStyle', `${at}.statusBarStyle`, (v, p) =>
      assertEnum(v, STATUS_BAR_STYLES, p));
    if (capability !== undefined) out.capability = capability;
    if (statusBarStyle !== undefined) out.statusBarStyle = statusBarStyle;
    return Object.freeze(out);
  });

  if (web !== undefined) platforms.web = web;
  if (linux !== undefined) platforms.linux = linux;
  if (windows !== undefined) platforms.windows = windows;
  if (mac !== undefined) platforms.mac = mac;
  if (mobile !== undefined) platforms.mobile = mobile;
  return Object.freeze(platforms) as Readonly<AppPlatformMeta>;
}

/**
 * Validate the author input and return a detached, deeply frozen snapshot. The
 * input is never mutated. Invalid or foreign values are rejected even when a
 * JavaScript caller bypasses TypeScript.
 */
export function defineAppMeta(config: AppMetaConfig): AppMeta {
  const source = assertPlainObject(config, '');
  assertKnownKeys(source, META_KEYS, '');

  const id = assertPattern(source.id, ID_RE, 'id');
  if (id.length > 255) throw new TypeError(`${label('id')} must have at most 255 characters`);
  const name = assertText(source.name, 'name', 128);
  const version = assertPattern(source.version, VERSION_RE, 'version');
  if (version.length > 64) throw new TypeError(`${label('version')} must have at most 64 characters`);
  const shortName = optional(source, 'shortName', 'shortName', (v, p) => assertText(v, p, 128));
  const description = optional(source, 'description', 'description', assertText);
  const color = optional(source, 'color', 'color', assertColor);
  const icons = optional(source, 'icons', 'icons', parseIcons);
  const platforms =
    source.platforms === undefined
      ? Object.freeze({})
      : optional(source, 'platforms', 'platforms', parsePlatforms)!;

  const meta = { id, name, version } as Record<string, unknown>;
  if (shortName !== undefined) meta.shortName = shortName;
  if (description !== undefined) meta.description = description;
  if (color !== undefined) meta.color = color;
  if (icons !== undefined) meta.icons = icons;
  meta.platforms = platforms;
  Object.defineProperty(meta, APP_META, { value: true, enumerable: false });
  return Object.freeze(meta) as unknown as AppMeta;
}

function parseTargets(value: unknown): readonly ComponentTarget[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label('targets')} must be an array, got ${describe(value)}`);
  }
  if (value.length === 0) throw new TypeError(`${label('targets')} must list at least one target`);
  const seen = new Set<string>();
  return Array.from(value, (entry, index) => {
    if (!isComponentTarget(entry)) {
      throw new TypeError(
        `${label(`targets[${index}]`)} must be one of ${COMPONENT_TARGETS.join(', ')}; got ${JSON.stringify(entry) ?? describe(entry)}`,
      );
    }
    if (seen.has(entry)) throw new TypeError(`${label('targets')} repeats "${entry}"`);
    seen.add(entry);
    return entry;
  });
}

/**
 * Programmatic project config helper: targets + app identity + optional theme.
 *
 * It does NOT prune imports, discover config files, generate manifests,
 * installers or desktop entries, and it does not add a mobile or SSR target.
 */
export function defineProject<const T extends ThemeDefinition | undefined = undefined>(
  config: ProjectConfig<T>,
): Project<Exclude<T, undefined>> {
  const source = assertPlainObject(config, '');
  assertKnownKeys(source, PROJECT_KEYS, '');
  const targets = Object.freeze(parseTargets(source.targets));
  if (source.app === undefined) throw new TypeError(`${label('project')} requires an app`);
  const app = defineAppMeta(source.app as AppMetaConfig);
  let theme: ThemeDefinition | undefined;
  if (source.theme !== undefined) {
    if (!isThemeDefinition(source.theme)) {
      throw new TypeError('[nandomo/core] project theme must be a definition created by defineTheme()');
    }
    theme = source.theme;
  }
  const project: Record<string, unknown> = { targets, app };
  if (theme !== undefined) project.theme = theme;
  return Object.freeze(project) as unknown as Project<Exclude<T, undefined>>;
}
