import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { activateLocale, detectBrowserLocale } from './i18n';
import { useSettings } from './state/settings';
import { hydrateRuntimeConfig } from './state/runtime-config';

async function bootstrap() {
  // If the deployment injected a /config.json (e.g. the intelligent-farming-stack
  // docker-compose provisioned a ChirpStack tenant + API key), seed the settings
  // store from it before the first render so the operator skips the wizard. A
  // no-op for plain `npm start` / static hosting (no config.json served).
  await hydrateRuntimeConfig();

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
}

void bootstrap();
