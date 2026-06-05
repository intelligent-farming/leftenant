import { i18n } from '@lingui/core';
import { useLingui } from '@lingui/react';

import { messages as en, type MessageKey } from './messages/en';
import { messages as es } from './messages/es';
import { messages as it } from './messages/it';
import { messages as fr } from './messages/fr';
import { messages as de } from './messages/de';
import { messages as pt } from './messages/pt';

export type Locale = 'en' | 'es' | 'it' | 'fr' | 'de' | 'pt';

/**
 * Locales presented in the settings dropdown. The label is the language's
 * own endonym (what a native speaker calls it) so the menu reads correctly
 * regardless of the currently active locale.
 */
export const SUPPORTED_LOCALES: ReadonlyArray<{ code: Locale; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'it', label: 'Italiano' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
  { code: 'pt', label: 'Português' },
];

i18n.load({ en, es, it, fr, de, pt });

/**
 * Activate a locale. Components consuming i18n via `useLingui()` re-render
 * automatically.
 */
export function activateLocale(locale: Locale): void {
  i18n.activate(locale);
}

/**
 * Pick the best default locale on first run, before the user has chosen one.
 * Honours the browser's `navigator.language` when it matches a supported
 * locale; otherwise falls back to English.
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'en';
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const base = candidate.toLowerCase().split('-')[0];
    const hit = SUPPORTED_LOCALES.find((l) => l.code === base);
    if (hit) return hit.code;
  }
  return 'en';
}

export { i18n };

/**
 * Translation hook used inside components. Returns a `t()` function whose
 * `id` argument is typed to the known message-catalog keys so a typo or a
 * missing key fails at compile time.
 *
 * Components that call `t()` re-render automatically when the active locale
 * changes — this is what `useLingui()` provides under the hood.
 */
export function useT(): (id: MessageKey, values?: Record<string, unknown>) => string {
  const { i18n: ctx } = useLingui();
  return (id, values) => ctx._(id, values);
}

export type { MessageKey };
