import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@lingui/react';

import { useSettings } from '../state/settings';
import { activateLocale, detectBrowserLocale, i18n, type Locale } from './index';

interface LocaleProviderProps {
  children: ReactNode;
}

/**
 * Activates the user's preferred locale on the `@lingui/core` singleton and
 * exposes it to the tree via `@lingui/react`'s `I18nProvider`.
 *
 * Resolution order:
 *   1. Explicit pick saved in settings (`useSettings(s => s.locale)`)
 *   2. Browser `navigator.language` matching a supported locale
 *   3. English fallback
 */
export function LocaleProvider({ children }: LocaleProviderProps) {
  const saved = useSettings((s) => s.locale);
  const locale: Locale = saved ?? detectBrowserLocale();

  // Activate on mount and whenever the saved locale changes. `i18n.activate`
  // is what triggers `useLingui()` subscribers to re-render with the new
  // translations.
  useEffect(() => {
    activateLocale(locale);
  }, [locale]);

  return <I18nProvider i18n={i18n}>{children}</I18nProvider>;
}
