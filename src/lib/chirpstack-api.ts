// REST client for ChirpStack v4's chirpstack-rest-api gateway.
//
// ChirpStack splits its API into two services in the standard docker-compose:
//   - `chirpstack`        (port 8080) — gRPC + admin UI
//   - `chirpstack-rest-api` (port 8090) — grpc-gateway translating REST/JSON
//
// Leftenant talks to the REST gateway: simpler CORS, direct browser fetch,
// no gRPC-Web bundle. The chirpstack-device-onboarding npm package is still
// useful for Node CLI tooling — it's just not consumed by the SPA.

/* -------------------------------------------------------------------------- */
/* Public types — same shape as the Node onboarding package                    */
/* -------------------------------------------------------------------------- */

export interface ChirpStackConnection {
  /** REST gateway URL, e.g. `http://chirpstack.local:8090`. */
  chirpStackUrl: string;
  apiKey: string;
}

export interface ApplicationSummary {
  id: string;
  name: string;
  description: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListApplicationsInput {
  tenantId: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListApplicationsResult {
  totalCount: number;
  result: ApplicationSummary[];
}

export interface CreateApplicationInput {
  tenantId: string;
  name: string;
  description?: string;
  tags?: Record<string, string>;
}

export interface DeviceProfileSummary {
  id: string;
  name: string;
  region: string;
  macVersion: string;
  regParamsRevision: string;
  supportsOtaa: boolean;
  supportsClassB: boolean;
  supportsClassC: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ListDeviceProfilesInput {
  tenantId: string;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface ListDeviceProfilesResult {
  totalCount: number;
  result: DeviceProfileSummary[];
}

export interface CreateDeviceProfileInput {
  tenantId: string;
  name: string;
  description?: string;
  region: string;
  macVersion: string;
  regParamsRevision: string;
  supportsOtaa: boolean;
  supportsClassB?: boolean;
  supportsClassC?: boolean;
  classBTimeout?: number;
  classCTimeout?: number;
  payloadCodecRuntime?: 'NONE' | 'JS' | 'CAYENNE_LPP';
  payloadCodecScript?: string;
  adrAlgorithmId?: string;
  uplinkInterval?: number;
  deviceStatusReqInterval?: number;
  flushQueueOnActivate?: boolean;
  tags?: Record<string, string>;
}

export interface CreateDeviceInput {
  devEui: string;
  name: string;
  applicationId: string;
  deviceProfileId: string;
  description?: string;
  joinEui?: string;
  skipFcntCheck?: boolean;
  isDisabled?: boolean;
  tags?: Record<string, string>;
  variables?: Record<string, string>;
  /** OTAA keys — when supplied, a second `POST /devices/{devEui}/keys` follows; on failure the device record is rolled back. */
  keys?: { nwkKey: string; appKey?: string };
}

export interface ChirpStackClient {
  listApplications(input: ListApplicationsInput): Promise<ListApplicationsResult>;
  createApplication(input: CreateApplicationInput): Promise<{ id: string }>;
  listDeviceProfiles(input: ListDeviceProfilesInput): Promise<ListDeviceProfilesResult>;
  createDeviceProfile(input: CreateDeviceProfileInput): Promise<{ id: string }>;
  createDevice(input: CreateDeviceInput): Promise<void>;
  close(): void;
}

/** Thrown when the REST gateway returns a non-2xx response. */
export class ChirpStackApiError extends Error {
  /** HTTP status code (also matches the gRPC-status field in the JSON body when present). */
  readonly code: number;
  /** Which API call produced the error — e.g. `"POST /api/applications"`. */
  readonly method: string;
  /** Parsed error body, when JSON. */
  readonly cause?: unknown;
  constructor(method: string, code: number, message: string, cause?: unknown) {
    super(`${method}: HTTP ${code} — ${message}`);
    this.name = 'ChirpStackApiError';
    this.code = code;
    this.method = method;
    this.cause = cause;
  }
}

/* -------------------------------------------------------------------------- */
/* Client factory                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_PROFILE = {
  payloadCodecRuntime: 'NONE' as const,
  payloadCodecScript: '',
  adrAlgorithmId: 'default',
  uplinkInterval: 3600,
  deviceStatusReqInterval: 1,
  flushQueueOnActivate: true,
};

export const createChirpStackClient = (settings: ChirpStackConnection): ChirpStackClient => {
  const base = settings.chirpStackUrl.replace(/\/+$/, '');
  // ChirpStack's REST gateway accepts the standard `Authorization: Bearer …`
  // header directly (the gateway recognizes it and forwards as gRPC metadata
  // internally).
  const authHeader = `Bearer ${settings.apiKey}`;

  const request = async <T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    init: { body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
  ): Promise<T> => {
    let url = `${base}${path}`;
    if (init.query) {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(init.query)) {
        if (v !== undefined && v !== '') params.set(k, String(v));
      }
      const qs = params.toString();
      if (qs) url += `?${qs}`;
    }
    const headers: Record<string, string> = {
      Accept: 'application/json',
      Authorization: authHeader,
    };
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      });
    } catch (err) {
      // Network / CORS failures don't return a Response at all.
      throw new ChirpStackApiError(
        `${method} ${path}`, 0,
        err instanceof Error ? err.message : 'network error',
        err,
      );
    }
    if (!res.ok) {
      let body: unknown;
      let msg = res.statusText;
      try {
        body = await res.json();
        if (body && typeof body === 'object' && 'message' in body && typeof body.message === 'string') {
          msg = body.message;
        }
      } catch { /* not JSON */ }
      throw new ChirpStackApiError(`${method} ${path}`, res.status, msg, body);
    }
    if (res.status === 204) return undefined as T;
    if (res.headers.get('content-length') === '0') return undefined as T;
    try { return (await res.json()) as T; }
    catch { return undefined as T; }
  };

  return {
    listApplications: async (input) => {
      type Row = { id: string; name: string; description: string; createdAt?: string; updatedAt?: string };
      const out = await request<{ totalCount: number; result: Row[] }>(
        'GET', '/api/applications',
        { query: { tenantId: input.tenantId, limit: input.limit ?? 100, offset: input.offset ?? 0, search: input.search } },
      );
      return {
        totalCount: out.totalCount ?? 0,
        result: (out.result ?? []).map((a) => ({
          id: a.id,
          name: a.name,
          description: a.description ?? '',
          createdAt: a.createdAt ? new Date(a.createdAt) : undefined,
          updatedAt: a.updatedAt ? new Date(a.updatedAt) : undefined,
        })),
      };
    },

    createApplication: async (input) => {
      const out = await request<{ id: string }>('POST', '/api/applications', {
        body: {
          application: {
            tenantId: input.tenantId,
            name: input.name,
            description: input.description ?? '',
            tags: input.tags ?? {},
          },
        },
      });
      return { id: out.id };
    },

    listDeviceProfiles: async (input) => {
      type Row = {
        id: string; name: string; region: string; macVersion: string;
        regParamsRevision: string; supportsOtaa: boolean;
        supportsClassB?: boolean; supportsClassC?: boolean;
        createdAt?: string; updatedAt?: string;
      };
      const out = await request<{ totalCount: number; result: Row[] }>(
        'GET', '/api/device-profiles',
        { query: { tenantId: input.tenantId, limit: input.limit ?? 100, offset: input.offset ?? 0, search: input.search } },
      );
      return {
        totalCount: out.totalCount ?? 0,
        result: (out.result ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          region: p.region,
          macVersion: p.macVersion,
          regParamsRevision: p.regParamsRevision,
          supportsOtaa: p.supportsOtaa,
          supportsClassB: !!p.supportsClassB,
          supportsClassC: !!p.supportsClassC,
          createdAt: p.createdAt ? new Date(p.createdAt) : undefined,
          updatedAt: p.updatedAt ? new Date(p.updatedAt) : undefined,
        })),
      };
    },

    createDeviceProfile: async (input) => {
      const out = await request<{ id: string }>('POST', '/api/device-profiles', {
        body: {
          deviceProfile: {
            tenantId: input.tenantId,
            name: input.name,
            description: input.description ?? '',
            region: input.region,
            macVersion: input.macVersion,
            regParamsRevision: input.regParamsRevision,
            supportsOtaa: input.supportsOtaa,
            supportsClassB: input.supportsClassB ?? false,
            supportsClassC: input.supportsClassC ?? false,
            ...(input.classBTimeout != null ? { classBTimeout: input.classBTimeout } : {}),
            ...(input.classCTimeout != null ? { classCTimeout: input.classCTimeout } : {}),
            payloadCodecRuntime: input.payloadCodecRuntime ?? DEFAULT_PROFILE.payloadCodecRuntime,
            payloadCodecScript: input.payloadCodecScript ?? DEFAULT_PROFILE.payloadCodecScript,
            adrAlgorithmId: input.adrAlgorithmId ?? DEFAULT_PROFILE.adrAlgorithmId,
            uplinkInterval: input.uplinkInterval ?? DEFAULT_PROFILE.uplinkInterval,
            deviceStatusReqInterval: input.deviceStatusReqInterval ?? DEFAULT_PROFILE.deviceStatusReqInterval,
            flushQueueOnActivate: input.flushQueueOnActivate ?? DEFAULT_PROFILE.flushQueueOnActivate,
            tags: input.tags ?? {},
          },
        },
      });
      return { id: out.id };
    },

    createDevice: async (input) => {
      await request<unknown>('POST', '/api/devices', {
        body: {
          device: {
            devEui: input.devEui,
            name: input.name,
            applicationId: input.applicationId,
            deviceProfileId: input.deviceProfileId,
            description: input.description ?? '',
            joinEui: input.joinEui ?? '',
            skipFcntCheck: input.skipFcntCheck ?? false,
            isDisabled: input.isDisabled ?? false,
            tags: input.tags ?? {},
            variables: input.variables ?? {},
          },
        },
      });

      if (!input.keys) return;

      // Then provision OTAA keys. On failure, roll back the device record
      // so the caller never sees a half-provisioned device.
      try {
        await request<unknown>('POST', `/api/devices/${encodeURIComponent(input.devEui)}/keys`, {
          body: {
            deviceKeys: {
              devEui: input.devEui,
              nwkKey: input.keys.nwkKey,
              ...(input.keys.appKey ? { appKey: input.keys.appKey } : {}),
            },
          },
        });
      } catch (err) {
        try { await request<unknown>('DELETE', `/api/devices/${encodeURIComponent(input.devEui)}`); }
        catch { /* swallow rollback error; the original is more useful */ }
        throw err;
      }
    },

    close: () => { /* nothing to clean up for fetch-based client */ },
  };
};

/* -------------------------------------------------------------------------- */
/* High-level helpers                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Probe ChirpStack by listing applications for the configured tenant.
 * A successful call proves the REST gateway routing, CORS, and the API key
 * are all working end-to-end.
 */
export const probeConnection = async (
  settings: ChirpStackConnection,
  tenantId: string,
): Promise<{ applicationCount: number }> => {
  const client = createChirpStackClient(settings);
  try {
    const out = await client.listApplications({ tenantId, limit: 1 });
    return { applicationCount: out.totalCount };
  } finally {
    client.close();
  }
};

/** Page through every application in a tenant. */
export const listAllApplications = async (
  client: ChirpStackClient,
  tenantId: string,
): Promise<ApplicationSummary[]> => {
  const out: ApplicationSummary[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await client.listApplications({ tenantId, limit, offset });
    out.push(...page.result);
    if (out.length >= page.totalCount || page.result.length === 0) break;
    offset += limit;
  }
  return out;
};

/** Page through every device profile in a tenant. */
export const listAllDeviceProfiles = async (
  client: ChirpStackClient,
  tenantId: string,
): Promise<DeviceProfileSummary[]> => {
  const out: DeviceProfileSummary[] = [];
  let offset = 0;
  const limit = 100;
  for (;;) {
    const page = await client.listDeviceProfiles({ tenantId, limit, offset });
    out.push(...page.result);
    if (out.length >= page.totalCount || page.result.length === 0) break;
    offset += limit;
  }
  return out;
};

/**
 * Look up an existing device profile by name within a tenant, and create
 * one from a TTN-derived shape if no match exists. Matching key is
 * (name, region) — region is part of the key because ChirpStack profiles
 * are region-scoped.
 */
export const ensureDeviceProfile = async (
  client: ChirpStackClient,
  tenantId: string,
  ttnProfile: {
    region: string; macVersion: string; regParamsRevision: string;
    supportsOtaa: boolean; supportsClassB: boolean; supportsClassC: boolean;
    classBTimeout?: number; classCTimeout?: number;
    payloadCodecRuntime: 'NONE' | 'JS' | 'CAYENNE_LPP'; payloadCodecScript?: string;
    name: string; description: string;
  },
  profileName: string,
): Promise<{ id: string; name: string; created: boolean }> => {
  const list = await client.listDeviceProfiles({
    tenantId, search: profileName, limit: 100,
  });
  const match = list.result.find(
    (p) => p.name === profileName && p.region === ttnProfile.region,
  );
  if (match) return { id: match.id, name: match.name, created: false };

  const { id } = await client.createDeviceProfile({
    tenantId,
    name: profileName,
    description: ttnProfile.description,
    region: ttnProfile.region,
    macVersion: ttnProfile.macVersion,
    regParamsRevision: ttnProfile.regParamsRevision,
    supportsOtaa: ttnProfile.supportsOtaa,
    supportsClassB: ttnProfile.supportsClassB,
    supportsClassC: ttnProfile.supportsClassC,
    classBTimeout: ttnProfile.classBTimeout,
    classCTimeout: ttnProfile.classCTimeout,
    payloadCodecRuntime: ttnProfile.payloadCodecRuntime,
    payloadCodecScript: ttnProfile.payloadCodecScript,
    tags: { source: 'leftenant', vendorModel: profileName },
  });
  return { id, name: profileName, created: true };
};

/**
 * Naming convention for auto-created device profiles. Same shape across every
 * session so `ensureDeviceProfile` can find existing matches deterministically.
 *
 * Format: `<device-slug> — <chirpstack-region>`
 * Example: `lds02 — US915`, `dragino-la66-usb-adapter-v2 — US915`
 *
 * The vendor prefix used to be part of this convention but bled "custom" /
 * "existing" sentinels into operator-facing profile names. The device slug
 * itself carries enough identity — catalog slugs are unique within the
 * curated catalog, and manual-mode operators typically encode the vendor
 * into the model name they type.
 */
export const profileNameFor = (device: string, chirpstackRegion: string): string =>
  `${device} — ${chirpstackRegion}`;
