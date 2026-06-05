# Leftenant

Browser-based field provisioning tool for ChirpStack. Onboard one LoRaWAN device or a thousand of the same model with the same fluency: pick the model, application, and device profile once, then loop — scan QR, submit, wait for the green light, next device. Runs in a browser on the same LAN as the ChirpStack instance and talks to it over the `chirpstack-rest-api` gateway and MQTT-over-WSS.

## Quick start

```bash
npm install
npm start
```

Opens `http://localhost:4173` in your default browser. The first screen is the
connection wizard; fill in your ChirpStack REST URL, API key, tenant UUID, and
MQTT WSS URL. The MQTT username/password fields are optional and only needed
for non-anonymous Mosquitto brokers.

## Why port 4173?

ChirpStack default ports vary by deployment but typically:

| Service | Port |
|---|---|
| ChirpStack admin UI | 8080 |
| ChirpStack REST API | 8090 |
| Mosquitto MQTT | 1883 |
| Mosquitto WSS | 9001 |
| Leftenant | 4173 (override with `PORT=…`) |


## Scripts

| Script | What it does |
|---|---|
| `npm start` | Webpack dev server with HMR on port 4173 |
| `npm run build` | Production bundle to `dist/` |
| `npm run typecheck` | TypeScript type-check (the build uses `transpileOnly` for speed) |

## ChirpStack-side setup

These three steps happen on the ChirpStack VM, one time per deployment, before
the first Leftenant run.

### 1. Enable a WebSocket listener on Mosquitto

Leftenant subscribes to MQTT topics from the browser, so Mosquitto needs a
WebSocket listener in addition to its default `:1883` MQTT listener. Add to
`/etc/mosquitto/mosquitto.conf`:

```
listener 9001
protocol websockets
# For LAN-only deployments. For production, swap for proper auth and TLS.
allow_anonymous true
```

Restart Mosquitto. Leftenant will connect to `ws://<host>:9001`.

### 2. Allow CORS on the chirpstack-rest-api service

Leftenant talks to ChirpStack via the `chirpstack-rest-api` gateway (typically
on port `:8090` in the standard docker-compose) — **not** the gRPC service on
`:8080`. Configure CORS on the REST gateway's service config (env vars in
docker-compose, flags in systemd, etc. — the exact form depends on your
deployment) to allow the origin that serves the Leftenant SPA, e.g.
`http://leftenant.local`.

### 3. Mint an API key

In the ChirpStack admin UI: **Tenant → API Keys → Add**. Copy the token;
Leftenant prompts for it on first run and stores it in `localStorage`. The
key is a delegation of operator authority, scoped to the tenant — see the
"Security" note below for the threat model.

### Security model in brief

The SPA holds the ChirpStack API key in `localStorage` and talks directly to
ChirpStack and Mosquitto. No backend. This is acceptable because Leftenant
runs on the operator's private network — the same threat model as the
ChirpStack admin UI itself. If multi-user deployment ever becomes a real
requirement, slip a thin backend service in front; until then, the simpler
architecture wins.

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

## Status

What's currently working:

- Connection wizard with REST + MQTT URL probes
- Session setup (catalog / manual / existing-profile modes)
- Camera-based QR scanner with vendor identification
- Tesseract OCR fallback for label-only devices
- Live MQTT join feed with vendor lookup
- Per-session submission history with audio feedback

What's queued:

- Verification listener — confirming each submitted device actually joined the
  network, by subscribing to ChirpStack's per-device join events and updating
  the session table from "Created" to "Verified".
- CSV export of session history for handing off to customers or filing with
  deployment records.
