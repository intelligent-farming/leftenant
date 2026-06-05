import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { activateLocale, detectBrowserLocale } from './i18n';
import { useSettings } from './state/settings';

// Activate i18n synchronously before the first render so `i18n._('id')` calls
// during initial render resolve to actual translations rather than raw IDs.
// `LocaleProvider` re-activates reactively when the user changes language.
activateLocale(useSettings.getState().locale ?? detectBrowserLocale());

const container = document.getElementById('root');
if (!container) throw new Error('#root element missing from index.html');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
