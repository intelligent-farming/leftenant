// Browser adapter for `@intelligent-farming/lorawan-codec-normalization`.
//
// That package's registry is Node/fs-based — its `codecScript()` reads codec.js
// off disk, which can't run in the browser, and it ships no browser entry. But
// the package *does* ship every codec under `codecs/<vendor>/<device>/`, so we
// bundle those files at build time with webpack's `require.context`:
//   - codec.js  → raw source string (via the `asset/source` rule in
//                 webpack.config.js that matches codecs/**/codec.js)
//   - device.json → parsed JSON (webpack's built-in handling)
//
// The registry's vendor/device folder ids are identical to the upstream TTN
// catalog's vendor/device ids across the entire registry, so a TTN catalog hit
// maps straight to a registry folder with no translation table.

interface DeviceJson {
  vendor: string;
  device: string;
  /** Scaffolded-but-unauthored device — its codec.js is only a stub. */
  draft?: boolean;
  /** Normalized telemetry paths this device's codec emits (e.g. `soil.moisture`). */
  provides?: string[];
}

const codecCtx = require.context(
  '@intelligent-farming/lorawan-codec-normalization/codecs',
  true,
  /\/codec\.js$/,
);
const deviceCtx = require.context(
  '@intelligent-farming/lorawan-codec-normalization/codecs',
  true,
  /\/device\.json$/,
);

/** A webpack module may expose its value directly or under `default`. */
const unwrap = <T,>(mod: unknown): T =>
  (mod && typeof mod === 'object' && 'default' in (mod as object)
    ? (mod as { default: T }).default
    : (mod as T));

const keyOf = (vendor: string, device: string) => `${vendor}/${device}`.toLowerCase();

interface NormalizedEntry {
  /** Raw codec.js source text, ready to install into a ChirpStack profile. */
  codec: string;
  /** Normalized telemetry paths the codec emits, from device.json `provides`. */
  provides: string[];
}

// "vendor/device" (lowercase) → codec + provides. Built once at import.
const entryByKey = ((): Map<string, NormalizedEntry> => {
  // device.json carries the `provides` list and the `draft` flag. Drafts ship
  // only a stub codec — the published package currently has none, but honour
  // the contract and skip them so callers fall back to TTN, the same thing the
  // Node `codecScript()` does (it throws for a draft).
  const info = new Map<string, DeviceJson>();
  for (const k of deviceCtx.keys()) {
    const d = unwrap<DeviceJson>(deviceCtx(k));
    if (d?.vendor && d.device) info.set(keyOf(d.vendor, d.device), d);
  }

  const map = new Map<string, NormalizedEntry>();
  for (const k of codecCtx.keys()) {
    // k looks like "./abeeway/abeeway-compact-tracker/codec.js"
    const [vendor, device] = k.replace(/^\.\//, '').split('/');
    if (!vendor || !device) continue;
    const key = keyOf(vendor, device);
    const d = info.get(key);
    if (d?.draft) continue;
    map.set(key, { codec: unwrap<string>(codecCtx(k)), provides: d?.provides ?? [] });
  }
  return map;
})();

/**
 * Normalized codec.js source for a device, keyed on its TTN vendor/device ids
 * (case-insensitive). Returns `null` when the registry has no non-draft codec
 * for the device — the signal to fall back to the upstream TTN codec.
 */
export function normalizedCodecFor(vendor: string, device: string): string | null {
  return entryByKey.get(keyOf(vendor, device))?.codec ?? null;
}

/**
 * Normalized telemetry paths a device's codec emits (its device.json `provides`,
 * e.g. `soil.moisture`, `air.temperature`). Returns `null` when the registry has
 * no non-draft codec for the device, and `[]` when it has one that declares no
 * provides. Keyed on the TTN vendor/device ids (case-insensitive).
 */
export function normalizedProvidesFor(vendor: string, device: string): string[] | null {
  const entry = entryByKey.get(keyOf(vendor, device));
  return entry ? entry.provides : null;
}
