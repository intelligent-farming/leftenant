// Browser-friendly wrapper around @intelligent-farming/oui-registry.
//
// The shared package ships a 1.8 MB JSON snapshot of the IEEE OUI registry.
// In Node, the package can load it via `fs.readFileSync`; in the browser, we
// import the JSON directly so webpack bundles it. This file is the one
// allowed import path — every other module in the SPA should use the bound
// helpers re-exported below.

import ouisData from '@intelligent-farming/oui-registry/data/ouis.json';
import { lookup as registryLookup, type OuiRegistry, type VendorInfo as RegistryVendor } from '@intelligent-farming/oui-registry';
import {
  createParser,
  detectVendor as decoderDetectVendor,
  type ParseOptions,
  type QrParseResult,
  type VendorInfo,
} from '@intelligent-farming/lorawan-qr-decoder';

/** The bundled OUI registry, ready for `lookup()` and the QR decoder. */
export const ouiRegistry: OuiRegistry = ouisData as OuiRegistry;

/** Pre-bound QR parser that uses the bundled OUI registry. */
export const parseQr = createParser({ ouiRegistry });

/**
 * Identify the vendor of a 16-char hex DevEUI using the bundled registry.
 * Returns the LoRaWAN-decoder's enriched {@link VendorInfo} (with the
 * `knownLorawanVendor` flag and `id` slug) when matched.
 */
export const detectVendor = (devEui: string): VendorInfo | undefined =>
  decoderDetectVendor(devEui, ouiRegistry);

/** Lookup the raw IEEE registry entry without the LoRaWAN slug enrichment. */
export const rawLookup = (devEui: string): RegistryVendor | undefined =>
  registryLookup(ouiRegistry, devEui);

// Re-export types so feature code doesn't have to import from two packages.
export type { OuiRegistry, ParseOptions, QrParseResult, VendorInfo };
