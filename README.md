<img src="src/assets/leftenant-logo-full.png" alt="Leftenant" width="320">

Browser-based device provisioning tool for ChirpStack. Provisions LoRaWAN devices in batches against a single model, application, and device profile. Runs in a browser on the same LAN as the ChirpStack instance and communicates with it over the `chirpstack-rest-api` gateway.

## Quick start

```bash
npm install
npm start
```

Opens `http://localhost:4173` in your default browser. The first screen is the
connection wizard; fill in your ChirpStack REST URL, API key, and tenant UUID.

## Why port 4173?

ChirpStack default ports vary by deployment but typically:

| Service | Port |
|---|---|
| ChirpStack admin UI | 8080 |
| ChirpStack REST API | 8090 |
| Leftenant | 4173 (override with `PORT=…`) |


## Scripts

| Script | What it does |
|---|---|
| `npm start` | Webpack dev server with HMR on port 4173 |
| `npm run build` | Production bundle to `dist/` |
| `npm run typecheck` | TypeScript type-check (the build uses `transpileOnly` for speed) |

## ChirpStack-side setup

These two steps happen on the ChirpStack VM, one time per deployment, before
the first Leftenant run.

### 1. Allow CORS on the chirpstack-rest-api service

Leftenant talks to ChirpStack via the `chirpstack-rest-api` gateway (typically
on port `:8090` in the standard docker-compose) — **not** the gRPC service on
`:8080`. Configure CORS on the REST gateway's service config (env vars in
docker-compose, flags in systemd, etc. — the exact form depends on your
deployment) to allow the origin that serves the Leftenant SPA, e.g.
`http://leftenant.local`.

### 2. Mint an API key

In the ChirpStack admin UI: **Tenant → API Keys → Add**. Copy the token;
Leftenant prompts for it on first run and stores it in `localStorage`. The
key is scoped to the tenant — see the security model section below.

### Security model

The SPA stores the ChirpStack API key in `localStorage` and calls the
`chirpstack-rest-api` gateway directly. There is no backend. This assumes
Leftenant runs on the operator's private network, the same trust boundary as
the ChirpStack admin UI.

## Project layout

```
src/
├── index.tsx          ── React entry
├── App.tsx            ── Top-level routing + theme + first-run gate
├── theme.ts           ── MUI theme
├── state/             ── Zustand stores (settings + session)
├── pages/             ── Route-level screens
├── components/        ── Reusable UI primitives
├── hooks/             ── React hooks
└── lib/               ── Adapter glue around the IF library ecosystem
```

## Features

- Connection wizard with a live REST connection probe
- Session setup (catalog / manual / existing-profile modes)
- Catalog codec resolution — a normalized codec from
  `@intelligent-farming/lorawan-codec-normalization` is used when one exists for
  the device, falling back to the upstream `ttn-to-chirpstack` codec otherwise.
  The resolved codec is shown in an editable field before the session starts.
- Camera-based QR scanner with vendor identification
- Tesseract OCR fallback for label-only devices
- Live join monitor — polls ChirpStack's REST API for each provisioned
  device's first contact and flips its row from "Waiting" to "Joined",
  promoting the submission from "Created" to "Verified"
- Add-Gateway wizard — connect a physical LoRaWAN gateway to ChirpStack (scan
  the Gateway EUI, pick the model, get a paste-ready packet-forwarder config,
  register the gateway, watch it come online). See [Add a gateway](#add-a-gateway).

## Add a gateway

Route `/gateway` (linked from Home) runs a four-step wizard that connects a
physical LoRaWAN gateway to ChirpStack. It uses
[`@intelligent-farming/lorawan-gateway-catalog`](https://github.com/intelligent-farming/lorawan-gateway-catalog)
for the per-model profiles (admin facts, packet-forwarder config templates,
walkthroughs) and identifies the vendor from the scanned EUI via
`@intelligent-farming/oui-registry`.

The wizard does two independent things:

1. **Points the gateway at ChirpStack (generate + guide).** It renders the
   connection settings and a paste-ready `global_conf.json` / `station.conf` from
   the model's template, with your Gateway Bridge host, ports, EUI, and region
   channel plan filled in. Leftenant **cannot push this into the gateway** — the
   box is on the LAN behind a vendor-specific admin UI/SSH — so it shows the
   values and the model's walkthrough for you to apply. How you apply them
   depends on the gateway: a **form** UI (Dragino, Milesight, RAK WisGateOS —
   enter Server Address + ports), a **JSON-paste** UI (MultiTech mPower — paste
   the config), or a **file/SSH** flow (Kerlink, etc. — write the config to the
   forwarder path).
2. **Registers the gateway in ChirpStack.** "Add to ChirpStack" calls
   `POST /api/gateways` for the configured tenant, then the wizard polls
   `GET /api/gateways/{id}` for `lastSeenAt` and flips the status to online once
   the gateway reports.

### Gateway Bridge host

The config's server address is the ChirpStack **Gateway Bridge** host (Semtech
UDP `:1700` / Basics Station `:3001`) — a **different** endpoint from the REST
API (`:8090`) Leftenant otherwise uses, and a gateway can never reach
`localhost`. It is resolved, in order, from: the `gatewayBridgeHost` setting
(seeded from `/config.json` — the `intelligent-farming-stack` setup detects the
host's LAN IP and writes it there), then `window.location.hostname`, then the
ChirpStack URL host. The field is editable in the wizard.
