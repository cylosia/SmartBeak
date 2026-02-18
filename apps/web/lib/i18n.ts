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

// P1-SECURITY FIX: Removed module-level mutable `currentLocale` variable.
// In Next.js SSR, modules are loaded once and shared across all concurrent
// requests. A mutable singleton locale means one request calling setLocale()
// would corrupt the locale for all concurrent requests (request-context pollution).
// Since only 'en' is supported, the locale is now a read-only constant.
const DEFAULT_LOCALE: Locale = 'en';

/**
 * @deprecated setLocale() is a no-op. With a single supported locale ('en'),
 * locale switching is not needed. When multi-locale support is added, use a
 * request-scoped context (e.g., React Context or Next.js cookies) instead of
 * module-level mutable state to avoid SSR request-context pollution.
 */
export function setLocale(_locale: Locale): void {
  // Intentional no-op: see comment above on SSR singleton pollution.
}

/**
 * Get the active locale.
 */
export function getLocale(): Locale {
  return DEFAULT_LOCALE;
}

/**
 * Escape a string for safe use as a literal in a RegExp pattern.
 * P1-SECURITY FIX: `paramKey` from caller-supplied params could contain
 * regex metacharacters (e.g., "." or "+"), causing incorrect matches or ReDoS.
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  let current: string | NestedRecord = translations[DEFAULT_LOCALE];

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
      // P1-SECURITY FIX: Escape paramKey before building the RegExp to prevent
      // regex injection via caller-supplied parameter names.
      result = result.replace(new RegExp(`\\{\\{${escapeRegExp(paramKey)}\\}\\}`, 'g'), String(value));
    }
  }

  return result;
}

/**
 * Format a number as USD currency.
 * Uses Intl.NumberFormat for locale-aware formatting.
 * Currently hardcoded to en-US / USD; locale parameter reserved for future use.
 */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Format a Date (or ISO string) using en-US locale.
 * Replaces bare toLocaleDateString() calls to ensure consistent MM/DD/YYYY output.
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('en-US').format(d);
}

/**
 * React hook for translations (returns the t function bound to current locale).
 * Simple wrapper for consistency with react-i18next API shape,
 * making future migration straightforward.
 */
export function useTranslation() {
  return { t, locale: DEFAULT_LOCALE, setLocale, formatCurrency, formatDate };
}
