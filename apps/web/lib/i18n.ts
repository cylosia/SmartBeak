/**
 * i18n Configuration
 *
 * Lightweight i18n setup using a simple JSON-based approach.
 * This provides the foundation for future internationalization
 * without adding heavy dependencies.
 *
 * Usage:
 *   import { t, useTranslation } from '../lib/i18n';
 *   const label = t('nav.portfolio'); // "Portfolio"
 *
 * To add a new language:
 *   1. Create apps/web/public/locales/{lang}/common.json
 *   2. Add the language to SUPPORTED_LOCALES below
 */

import en from '../public/locales/en/common.json';

type NestedRecord = { [key: string]: string | NestedRecord };

const SUPPORTED_LOCALES = ['en'] as const;
type Locale = typeof SUPPORTED_LOCALES[number];

const translations: Record<Locale, NestedRecord> = {
  en: en as NestedRecord,
};

let currentLocale: Locale = 'en';

/**
 * Set the active locale
 */
export function setLocale(locale: Locale): void {
  if (SUPPORTED_LOCALES.includes(locale)) {
    currentLocale = locale;
  }
}

/**
 * Get the active locale
 */
export function getLocale(): Locale {
  return currentLocale;
}

/**
 * Translate a dot-separated key path.
 *
 * Supports simple interpolation: t('publish.createCount', { count: 3 })
 *
 * @param key - Dot-separated key (e.g., 'nav.portfolio')
 * @param params - Optional interpolation values
 * @returns Translated string, or the key itself if not found
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let current: string | NestedRecord = translations[currentLocale];

  for (const part of parts) {
    if (typeof current !== 'object' || current === null) {
      return key;
    }
    current = current[part] as string | NestedRecord;
  }

  if (typeof current !== 'string') {
    return key;
  }

  let result = current;
  if (params) {
    for (const [paramKey, value] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\{${paramKey}\\}\\}`, 'g'), String(value));
    }
  }

  return result;
}

/**
 * React hook for translations (returns the t function bound to current locale).
 * Simple wrapper for consistency with react-i18next API shape,
 * making future migration straightforward.
 */
export function useTranslation() {
  return { t, locale: currentLocale, setLocale };
}
