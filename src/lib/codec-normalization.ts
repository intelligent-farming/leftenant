// Browser adapter for `@intelligent-farming/lorawan-codec-normalization`.
//
// That package's registry is Node/fs-based — its `codecScript()` reads codec.js
// off disk, which can't run in the browser. Two pieces are bundled instead:
//   - dist/device-index.json → which devices are authored (non-draft); the
//                 same index drives model search in `lib/device-catalog.ts`
//   - codecs/<vendor>/<device>/codec.js → raw source strings, via webpack's
//                 `require.context` and the `asset/source` rule in
//                 webpack.config.js
//
// The registry's vendor/device folder ids are identical to the upstream TTN
// catalog's vendor/device ids across the entire registry, so a TTN catalog hit
// maps straight to a registry folder with no translation table.

import deviceIndex from '@intelligent-farming/lorawan-codec-normalization/dist/device-index.json';
import type { DeviceIndexEntry } from '@intelligent-farming/lorawan-codec-normalization';

const codecCtx = require.context(
  '@intelligent-farming/lorawan-codec-normalization/codecs',
  true,
  /\/codec\.js$/,
);

/** A webpack module may expose its value directly or under `default`. */
const unwrap = <T,>(mod: unknown): T =>
  (mod && typeof mod === 'object' && 'default' in (mod as object)
    ? (mod as { default: T }).default
    : (mod as T));

const keyOf = (vendor: string, device: string) => `${vendor}/${device}`.toLowerCase();

// "vendor/device" (lowercase) → codec.js source. Built once at import. The
// index lists only authored devices, so a draft's stub codec.js is skipped and
// callers fall back to TTN, the same thing the Node `codecScript()` does (it
// throws for a draft).
const codecByKey = ((): Map<string, string> => {
  const authored = new Set((deviceIndex as DeviceIndexEntry[]).map((e) => keyOf(e.vendor, e.device)));
  const map = new Map<string, string>();
  for (const k of codecCtx.keys()) {
    // k looks like "./abeeway/abeeway-compact-tracker/codec.js"
    const [vendor, device] = k.replace(/^\.\//, '').split('/');
    if (!vendor || !device) continue;
    const key = keyOf(vendor, device);
    if (authored.has(key)) map.set(key, unwrap<string>(codecCtx(k)));
  }
  return map;
})();

/**
 * Normalized codec.js source for a device, keyed on its TTN vendor/device ids
 * (case-insensitive). Returns `null` when the registry has no non-draft codec
 * for the device — the signal to fall back to the upstream TTN codec.
 */
export function normalizedCodecFor(vendor: string, device: string): string | null {
  return codecByKey.get(keyOf(vendor, device)) ?? null;
}
