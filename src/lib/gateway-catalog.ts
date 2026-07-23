// Browser adapter for `@intelligent-farming/lorawan-gateway-catalog`.
//
// Like lib/codec-normalization.ts, the catalog's registry is Node/fs-based —
// `configScript()`/`gateways()`/`region()` read files off disk and can't run in
// the browser. But the package ships every profile under
// gateways/<vendor>/<model>/ plus the region channel plans under
// definitions/regions/, and it exposes a **pure** rendering layer
// (dist/render.js — no fs). So we:
//   - bundle gateway.json (parsed), config/*.tmpl.* (raw source, via the
//     asset/source webpack rules), and walkthrough.md (raw) with require.context
//   - bundle definitions/regions/*.json (parsed)
//   - call the pure renderConfig/buildRenderParams to produce paste-ready config
//
// OUI detection is reimplemented here over the bundled profile OUIs (the same
// prefix match the catalog's detect.ts does), reusing lib/oui.ts for the IEEE
// org name rather than pulling a second copy of the registry.

import {
  renderConfig,
  buildRenderParams,
} from '@intelligent-farming/lorawan-gateway-catalog/dist/render';
import type {
  GatewayInfo,
  RegionInfo,
  PacketForwarder,
  ConnectionParams,
} from '@intelligent-farming/lorawan-gateway-catalog';
import { rawLookup } from './oui';

/** A matched gateway model for operator disambiguation. */
export interface GatewayCandidate {
  vendor: string;
  model: string;
  name: string;
}

/** Result of {@link detectGatewayCandidates}. */
export interface GatewayDetection {
  /** Matched OUI prefix (uppercase), or null. */
  oui: string | null;
  /** Resolved catalog vendor slug, or null when zero/ambiguous. */
  vendor: string | null;
  /** Registered IEEE organization name, when the bundled registry knows it. */
  ouiName?: string;
  /** Candidate models to disambiguate (empty when nothing matched). */
  candidates: GatewayCandidate[];
}

const gatewayJsonCtx = require.context(
  '@intelligent-farming/lorawan-gateway-catalog/gateways',
  true,
  /\/gateway\.json$/,
);
const templateCtx = require.context(
  '@intelligent-farming/lorawan-gateway-catalog/gateways',
  true,
  /\/config\/.+\.tmpl\.(json|conf)$/,
);
const walkthroughCtx = require.context(
  '@intelligent-farming/lorawan-gateway-catalog/gateways',
  true,
  /\/walkthrough\.md$/,
);
const regionCtx = require.context(
  '@intelligent-farming/lorawan-gateway-catalog/definitions/regions',
  false,
  /\.json$/,
);

/** A webpack module may expose its value directly or under `default`. */
const unwrap = <T,>(mod: unknown): T =>
  mod && typeof mod === 'object' && 'default' in (mod as object)
    ? (mod as { default: T }).default
    : (mod as T);

const keyOf = (vendor: string, model: string) => `${vendor}/${model}`.toLowerCase();
const normHex = (s: string) => s.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();

interface CatalogEntry {
  info: GatewayInfo;
  /** Raw template text per packet forwarder. */
  templates: Partial<Record<PacketForwarder, string>>;
  /** Raw walkthrough.md text, when present. */
  walkthrough: string | null;
}

const regionById: Map<string, RegionInfo> = (() => {
  const map = new Map<string, RegionInfo>();
  for (const k of regionCtx.keys()) {
    const r = unwrap<RegionInfo>(regionCtx(k));
    if (r?.id) map.set(r.id, r);
  }
  return map;
})();

/** Forwarder id from a template file name (…/semtech-udp.tmpl.json). */
function forwarderOf(fileName: string): PacketForwarder | null {
  if (fileName.endsWith('semtech-udp.tmpl.json')) return 'semtech-udp';
  if (fileName.endsWith('basics-station.tmpl.conf')) return 'basics-station';
  return null;
}

// "vendor/model" (lowercase) → entry. Built once at import. Drafts are skipped
// (the published package ships none; honour the contract like the codec adapter).
const entryByKey: Map<string, CatalogEntry> = (() => {
  const map = new Map<string, CatalogEntry>();

  for (const k of gatewayJsonCtx.keys()) {
    const info = unwrap<GatewayInfo>(gatewayJsonCtx(k));
    if (!info?.vendor || !info.model || info.draft) continue;
    map.set(keyOf(info.vendor, info.model), { info, templates: {}, walkthrough: null });
  }

  for (const k of templateCtx.keys()) {
    // k like "./rakwireless/rak7268/config/semtech-udp.tmpl.json"
    const parts = k.replace(/^\.\//, '').split('/');
    const [vendor, model] = parts;
    const entry = map.get(keyOf(vendor, model));
    if (!entry) continue; // draft or unknown
    const fw = forwarderOf(k);
    if (fw) entry.templates[fw] = unwrap<string>(templateCtx(k));
  }

  for (const k of walkthroughCtx.keys()) {
    const parts = k.replace(/^\.\//, '').split('/');
    const [vendor, model] = parts;
    const entry = map.get(keyOf(vendor, model));
    if (entry) entry.walkthrough = unwrap<string>(walkthroughCtx(k));
  }

  return map;
})();

/** All authored region channel plans (sorted by id). */
export function catalogRegions(): RegionInfo[] {
  return [...regionById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** All authored gateway profiles (drafts excluded), sorted by vendor/model. */
export function gatewayCatalog(): GatewayInfo[] {
  return [...entryByKey.values()]
    .map((e) => e.info)
    .sort((a, b) => keyOf(a.vendor, a.model).localeCompare(keyOf(b.vendor, b.model)));
}

/** One profile's metadata, or null when unknown/draft. Case-insensitive. */
export function gatewayInfo(vendor: string, model: string): GatewayInfo | null {
  return entryByKey.get(keyOf(vendor, model))?.info ?? null;
}

/** Raw walkthrough markdown for a profile, or null. Case-insensitive. */
export function gatewayWalkthrough(vendor: string, model: string): string | null {
  return entryByKey.get(keyOf(vendor, model))?.walkthrough ?? null;
}

/**
 * Browser twin of the catalog's Node `configScript`: render paste-ready
 * packet-forwarder config for a model, merging the region channel plan with the
 * connection params. Pure — no fs. Throws with the same guards as `configScript`.
 */
export function renderGatewayConfig(
  vendor: string,
  model: string,
  opts: { forwarder: PacketForwarder; region: string; connection: ConnectionParams },
): string {
  const entry = entryByKey.get(keyOf(vendor, model));
  if (!entry) throw new Error(`unknown gateway ${keyOf(vendor, model)}`);
  const { info } = entry;
  if (!info.packetForwarders.includes(opts.forwarder)) {
    throw new Error(
      `${info.vendor}/${info.model} does not support ${opts.forwarder} (supports: ${info.packetForwarders.join(', ')})`,
    );
  }
  if (!info.regions.includes(opts.region)) {
    throw new Error(
      `${info.vendor}/${info.model} is not authored for region ${opts.region} (authored: ${info.regions.join(', ')})`,
    );
  }
  const region = regionById.get(opts.region);
  if (!region) throw new Error(`unknown region ${opts.region}`);
  const template = entry.templates[opts.forwarder];
  if (!template) throw new Error(`${info.vendor}/${info.model} has no ${opts.forwarder} template bundled`);
  const params = buildRenderParams(opts.forwarder, region, opts.connection);
  return renderConfig(template, params);
}

/**
 * Detect the vendor + candidate models from a scanned Gateway EUI (or an OUI
 * prefix). OUI resolves the vendor; the operator (or the scanned model string)
 * picks the exact model. Prefix match is symmetric, mirroring the catalog's
 * detect.ts.
 */
export function detectGatewayCandidates(euiOrOui: string): GatewayDetection {
  const h = normHex(euiOrOui);
  const candidates: GatewayCandidate[] = [];
  let matchedPrefix: string | null = null;
  for (const { info } of entryByKey.values()) {
    for (const o of info.oui) {
      const oo = normHex(o);
      if (h && (h.startsWith(oo) || oo.startsWith(h))) {
        candidates.push({ vendor: info.vendor, model: info.model, name: info.name });
        if (!matchedPrefix) matchedPrefix = oo;
        break;
      }
    }
  }
  const vendors = new Set(candidates.map((c) => c.vendor));
  const ieee = h.length === 16 ? rawLookup(h) : undefined;
  return {
    oui: matchedPrefix ?? ieee?.oui ?? null,
    vendor: vendors.size === 1 ? [...vendors][0] : null,
    ouiName: ieee?.name,
    candidates,
  };
}
