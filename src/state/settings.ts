import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Connection settings the operator provides on first run. Persisted to
 * localStorage so the same machine doesn't have to reconfigure.
 *
 * Security note: the API key lives in localStorage. That's acceptable for a
 * single-operator, same-VM-as-ChirpStack deployment (see DESIGN.md). It is
 * NOT acceptable for multi-user / public-internet deployments — those would
 * need a backend session layer.
 */
export interface ConnectionSettings {
  /** ChirpStack HTTP / gRPC-Web endpoint, e.g. `http://chirpstack.local:8090`. */
  chirpStackUrl: string;
  /** API key minted in the ChirpStack admin UI. */
  apiKey: string;
  /** Mosquitto WSS endpoint, e.g. `ws://chirpstack.local:9001`. */
  mqttUrl: string;
  /** Optional MQTT username/password for non-anonymous brokers. */
  mqttUsername?: string;
  mqttPassword?: string;
  /** Tenant UUID — populated after a successful connection test. */
  tenantId?: string;
  /** Whether the user has completed the first-run wizard at least once. */
  configured: boolean;
  /**
   * Theme override. `'system'` (default) follows the OS dark-mode setting via
   * `prefers-color-scheme`; `'light'` / `'dark'` pin the mode explicitly.
   */
  themeMode?: 'system' | 'light' | 'dark';
}

interface SettingsState extends ConnectionSettings {
  setSettings: (patch: Partial<ConnectionSettings>) => void;
  reset: () => void;
}

const initial: ConnectionSettings = {
  chirpStackUrl: 'http://localhost:8090',
  apiKey: '',
  mqttUrl: 'ws://localhost:9001',
  configured: false,
  themeMode: 'system',
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...initial,
      setSettings: (patch) => set((s) => ({ ...s, ...patch })),
      reset: () => set(initial),
    }),
    {
      name: 'leftenant.settings',
      storage: createJSONStorage(() => localStorage),
      // Bump on default-value changes that should override existing persisted
      // state. v2 = ChirpStack URL default switched from :8080 → :8090. Older
      // persisted state is discarded on first load and the user re-runs the
      // wizard with the right defaults.
      version: 2,
    },
  ),
);
