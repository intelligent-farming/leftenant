// Per-vendor "where do I find the DevEUI?" hints for the scan screen.
//
// Where the DevEUI is physically printed varies by vendor: some encode it in a
// TR005 QR code on the device, some print it on the label only, and budget
// hardware often hides it on a paper leaflet in the box while the on-device QR
// encodes nothing useful (see the scan-screen "no credentials" path). A short
// hint up front saves the operator hunting for it.
//
// This table is meant to grow from field experience. Keys are TTN catalog
// slugs — the same `vendor` / `device` values stored on the active session
// (see ActiveSession). A `vendor/device` entry wins over a bare `vendor` one.
// When a model isn't listed, the scan screen falls back to a generic hint, so
// it's safe to leave this sparse rather than guess at hardware we haven't seen.

/** Where the operator physically finds the DevEUI for a given model. */
export type DeviceIdLocation = 'qr' | 'label' | 'leaflet';

export interface DeviceHint {
  location: DeviceIdLocation;
  /**
   * Whether the on-device QR follows the LoRa Alliance TR005 format and
   * actually carries the DevEUI/JoinEUI/AppKey. `false` means the QR is a bare
   * serial or URL and the operator must type the credentials in by hand.
   */
  encodesTr005: boolean;
}

// Verified against real hardware before adding an entry. Examples of the shape:
//   'dragino': { location: 'label', encodesTr005: true },
//   'acme/budget-soil-v1': { location: 'leaflet', encodesTr005: false },
const HINTS: Readonly<Record<string, DeviceHint>> = {};

/**
 * Look up the hint for a model. Prefers a `vendor/device` entry, then a bare
 * `vendor` entry. Returns `undefined` when nothing is curated — callers should
 * fall back to a generic hint.
 */
export const lookupDeviceHint = (vendor?: string, device?: string): DeviceHint | undefined => {
  if (!vendor) return undefined;
  if (device) {
    const exact = HINTS[`${vendor}/${device}`];
    if (exact) return exact;
  }
  return HINTS[vendor];
};
