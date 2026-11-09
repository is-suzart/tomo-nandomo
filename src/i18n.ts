import { createTranslator, normalizeLocale, resolveLocale, type Catalogs } from '@nandomo/core';
import { ptBR } from './locales/pt-BR.js';
import { en } from './locales/en.js';

/** Authored UI only: book titles, authors and paths stay untouched. */
export const catalogs: Catalogs = { 'pt-BR': ptBR, en };

export const FALLBACK_LOCALE = 'en';
/** The language the catalog keys are written in. */
export const SOURCE_LOCALE = 'pt-BR';

/** `C`/`POSIX` are accepted and fall back; they never pick a language. */
export function detectOsLocale(
  env: Record<string, string | undefined> = typeof process === 'undefined' ? {} : process.env,
): string | null {
  const effective = env.LC_ALL || env.LC_MESSAGES || env.LANG;
  if (effective && !normalizeLocale(effective)) return effective;
  return env.LANGUAGE?.split(':').find(locale => !!resolveLocale(locale, Object.keys(catalogs), '')) || effective || null;
}

export const i18n = createTranslator({
  catalogs,
  locale: detectOsLocale(),
  fallback: FALLBACK_LOCALE,
  source: SOURCE_LOCALE,
});

/** Translate a UI string. Missing keys fall back to the key itself. */
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.t(key, params);
}

/** Human-readable language name for a voice grouping header. */
export function languageName(lang: string): string {
  const base = lang.split('-')[0] ?? lang;
  try {
    const names = new Intl.DisplayNames([i18n.locale()], { type: 'language' });
    return names.of(base) ?? lang;
  } catch {
    return lang;
  }
}
