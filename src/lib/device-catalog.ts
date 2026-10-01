// Device-model search for the session-setup catalog picker.
//
// The primary source is the lorawan-codec-normalization registry: every device
// with a normalized codec, searched by name, vendor, device id, sensors,
// categories, and the normalized values it provides (so "soil moisture" or
// "air.temperature" find devices by what they measure). ttn-to-chirpstack is
// ancillary: it supplies each device's ChirpStack profile (regions, MAC
// version, classes) when TTN has one, and contributes secondary results for
// devices TTN knows that have no normalized codec.
//
// A normalized device with no TTN profile (`regions: null`) is still pickable;
// the caller builds a standard profile for the selected region instead.

import * as ttn from '@intelligent-farming/ttn-to-chirpstack/browser';
import deviceIndex from '@intelligent-farming/lorawan-codec-normalization/dist/device-index.json';
import type { DeviceIndexEntry } from '@intelligent-farming/lorawan-codec-normalization';

export interface CatalogModel {
  vendor: string;
  device: string;
  name: string;
  /**
   * TTN region keys the device's TTN profile supports, or `null` when TTN has
   * no profile for it — the caller then builds a standard profile.
   */
  regions: string[] | null;
  /** True when lorawan-codec-normalization has a codec for the device. */
  normalized: boolean;
  /** Normalized values the codec emits (device.json `provides`); [] if not normalized. */
  provides: string[];
}

const INDEX = deviceIndex as DeviceIndexEntry[];

const keyOf = (vendor: string, device: string) => `${vendor}/${device}`.toLowerCase();

const NORMALIZED_KEYS = new Set(INDEX.map((e) => keyOf(e.vendor, e.device)));

/** TTN catalog entry for a registry device, via its TTN provenance link. */
const ttnInfoFor = (e: DeviceIndexEntry): ttn.DeviceInfo | null =>
  e.ttn ? ttn.deviceInfo(e.ttn.vendor, e.ttn.device) : null;

// Searchable text per registry entry, split into weighted fields. Dotted
// provides paths are also split into segments so "temperature" matches
// "air.temperature". The TTN description carries brand names the registry
// lacks (Makerfabs devices are described as "The AgroSense ...").
interface Indexed {
  entry: DeviceIndexEntry;
  regions: string[] | null;
  identity: string;   // name + device id — weight 3
  vendor: string;     // weight 2
  measures: string;   // sensors, categories, provides, TTN description — weight 1
}

const tokens = (s: string): string[] => s.toLowerCase().split(/[\s/]+/).filter(Boolean);

const INDEXED: Indexed[] = INDEX.map((entry) => {
  const info = ttnInfoFor(entry);
  return {
    entry,
    regions: info && info.regions.length > 0 ? info.regions : null,
    identity: `${entry.name} ${entry.device}`.toLowerCase(),
    vendor: entry.vendor.toLowerCase(),
    measures: [
      ...entry.sensors,
      ...entry.categories,
      ...entry.provides,
      ...entry.provides.flatMap((p) => p.split('.')),
      info?.description ?? '',
    ].join(' ').toLowerCase(),
  };
});

/** Score one entry against query tokens; 0 when any token matches nothing. */
const score = (ix: Indexed, terms: string[]): number => {
  let total = 0;
  for (const term of terms) {
    if (ix.identity.includes(term)) total += 3;
    else if (ix.vendor.includes(term)) total += 2;
    else if (ix.measures.includes(term)) total += 1;
    else return 0;
  }
  return total;
};

const toModel = (ix: Indexed): CatalogModel => ({
  vendor: ix.entry.vendor,
  device: ix.entry.device,
  name: ix.entry.name,
  regions: ix.regions,
  normalized: true,
  provides: ix.entry.provides,
});

/**
 * Search device models. Normalized devices come first, ranked by where the
 * query matched (name/id, then vendor, then what the device measures); every
 * query word must match somewhere. TTN-only devices fill the remaining slots.
 */
export function searchModels(query: string, limit = 20): CatalogModel[] {
  const terms = tokens(query);
  if (terms.length === 0) return [];

  const primary = INDEXED
    .map((ix) => ({ ix, s: score(ix, terms) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.ix.entry.name.localeCompare(b.ix.entry.name))
    .slice(0, limit)
    .map((r) => toModel(r.ix));

  if (primary.length >= limit) return primary;

  const secondary: CatalogModel[] = [];
  for (const hit of ttn.searchHits(query, limit * 2)) {
    if (primary.length + secondary.length >= limit) break;
    if (NORMALIZED_KEYS.has(keyOf(hit.vendor, hit.device))) continue;
    secondary.push({
      vendor: hit.vendor,
      device: hit.device,
      name: hit.name,
      regions: hit.regions,
      normalized: false,
      provides: [],
    });
  }
  return [...primary, ...secondary];
}
