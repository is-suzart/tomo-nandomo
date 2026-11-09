/**
 * Stack-independent translation: locale resolution, interpolation and plural
 * forms over plain catalogs. No network, no machine translation, no Qt.
 */
import { signal, type Signal } from './signal.js';

/** A string, or one form per CLDR plural category (`one`, `other`, ...). */
export type TranslationValue = string | ({ one?: string } & Record<string, string>);
export type Catalog = Record<string, TranslationValue>;
export type Catalogs = Record<string, Catalog>;

export const DEFAULT_LOCALE = 'en';

/** `C`/`POSIX` carry no language: they fall back instead of guessing. */
export function normalizeLocale(raw?: string | null): string | null {
  const base = (String(raw ?? '').trim().split('.')[0] ?? '').split('@')[0]?.replace(/_/g, '-') ?? '';
  if (!base || /^(?:c|posix)$/i.test(base)) return null;
  try { return Intl.getCanonicalLocales(base)[0] ?? null; } catch { return null; }

}

/** Exact match, then same language, then the fallback locale. */
export function resolveLocale(
  raw: string | null | undefined,
  available: readonly string[],
  fallback: string = DEFAULT_LOCALE,
): string {
  const locales = [...new Set([...available, fallback])];
  const wanted = normalizeLocale(raw);
  if (wanted) {
    if (locales.includes(wanted)) return wanted;
    const language = wanted.split('-')[0];
    const candidates = locales.filter(locale => normalizeLocale(locale)?.split('-')[0] === language);
    const script = new Intl.Locale(wanted).maximize().script;
    const partial = candidates.find(locale => new Intl.Locale(locale).maximize().script === script) ?? candidates[0];
    if (partial) return partial;
  }
  return fallback;
}

export function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : match,
  );
}

function pluralForm(locale: string, count: number): string {
  try {
    return new Intl.PluralRules(locale).select(count);
  } catch {
    return count === 1 ? 'one' : 'other';
  }
}

function lookup(catalogs: Catalogs, locale: string, fallback: string, key: string, source?: string): TranslationValue | undefined {
  // A sparse source catalog (the language the keys are written in) shows the key
  // itself instead of leaking another language.
  if (locale === source) return catalogs[locale]?.[key];
  return catalogs[locale]?.[key] ?? (locale === fallback ? undefined : catalogs[fallback]?.[key]);
}

/** Missing keys fall back to the source key itself, so nothing renders blank. */
export function translate(
  catalogs: Catalogs,
  locale: string,
  fallback: string,
  key: string,
  params?: Record<string, string | number>,
  /** Language the keys are authored in; a sparse catalog stays in that language. */
  source?: string,
): string {
  const value = lookup(catalogs, locale, fallback, key, source);
  if (value === undefined) return interpolate(key, params);
  if (typeof value === 'string') return interpolate(value, params);
  const count = Number(params?.count ?? 0);
  return interpolate(value[pluralForm(locale, count)] ?? value.other ?? value.one ?? key, params);
}

export interface TranslatorOptions {
  catalogs: Catalogs;
  /** OS locale, e.g. `pt_BR.UTF-8`, `C`, `en_US`. */
  locale?: string | null;
  fallback?: string;
  /** Locale the keys are authored in; defaults to the fallback locale. */
  source?: string;
}

export interface Translator {
  /** Current locale; reactive through `localeRef`. */
  readonly locale: () => string;
  /** Signal holding the locale: feed it to `computed`/`effect` for live updates. */
  readonly localeRef: Signal<string>;
  readonly fallback: string;
  readonly available: () => readonly string[];
  setLocale(locale: string | null | undefined): void;
  t(key: string, params?: Record<string, string | number>): string;
}

export function createTranslator(options: TranslatorOptions): Translator {
  const fallback = options.fallback ?? DEFAULT_LOCALE;
  const source = options.source ?? fallback;
  const available = Object.keys(options.catalogs);
  const localeRef = signal(resolveLocale(options.locale, available, fallback));
  return {
    locale: () => localeRef(),
    localeRef,
    fallback,
    available: () => available,
    setLocale: (locale) => localeRef.set(resolveLocale(locale, available, fallback)),
    t: (key, params) => translate(options.catalogs, localeRef(), fallback, key, params, source),
  };
}
