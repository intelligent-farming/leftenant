import { useSettings } from './settings';

/**
 * Deployment-injected configuration. A containerized deployment (e.g. the
 * intelligent-farming-stack docker-compose) writes `/config.json` next to the
 * built app so Leftenant can boot already pointed at ChirpStack with a minted
 * API key — no manual first-run wizard.
 *
 * The file is optional: when absent (the normal `npm start` / static-host case)
 * `hydrateRuntimeConfig` is a no-op and the wizard runs as before.
 */
export interface RuntimeConfig {
  chirpStackUrl?: string;
  apiKey?: string;
  mqttUrl?: string;
  mqttUsername?: string;
  mqttPassword?: string;
  tenantId?: string;
  /**
   * ChirpStack Gateway Bridge host the gateway forwards to — resolved
   * server-side by docker-entrypoint.sh (the browser can't see the host's LAN
   * IP). Seeded independently of the API key so even an otherwise unconfigured
   * deployment gives the Add-Gateway wizard a correct default.
   */
  gatewayBridgeHost?: string;
}

/**
 * Seed the settings store from `/config.json` on first run. Call once before the
 * first render. Does nothing if the operator already configured the tool (wizard
 * or a previous hydration), if no config file is served, or if the file lacks the
 * minimum (API key + tenant) needed to be useful.
 */
export async function hydrateRuntimeConfig(): Promise<void> {
  if (useSettings.getState().configured) return;

  let config: RuntimeConfig;
  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) return; // 404 => not a provisioned deployment
    config = (await res.json()) as RuntimeConfig;
  } catch {
    // No /config.json, or the dev server returned the SPA shell (HTML) instead
    // of JSON — either way, fall through to the first-run wizard.
    return;
  }

  const current = useSettings.getState();

  // Seed the Gateway Bridge host regardless of whether a full ChirpStack config
  // is present — it's useful to the Add-Gateway wizard on its own, and the
  // operator can still override it. Don't clobber a value they already set.
  if (config.gatewayBridgeHost && !current.gatewayBridgeHost) {
    current.setSettings({ gatewayBridgeHost: config.gatewayBridgeHost });
  }

  if (!config.apiKey || !config.tenantId) return;

  current.setSettings({
    chirpStackUrl: config.chirpStackUrl ?? current.chirpStackUrl,
    apiKey: config.apiKey,
    mqttUrl: config.mqttUrl ?? current.mqttUrl,
    mqttUsername: config.mqttUsername,
    mqttPassword: config.mqttPassword,
    tenantId: config.tenantId,
    configured: true,
  });
}
