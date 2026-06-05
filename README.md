<img src="src/assets/leftenant-logo-full.png" alt="Leftenant" width="320" alt="Leftenant">

Browser-based field provisioning tool for ChirpStack. Provisions LoRaWAN devices in batches against a single model, application, and device profile. Runs in a browser on the same LAN as the ChirpStack instance and communicates with it via the `chirpstack-rest-api` gateway and MQTT-over-WSS.

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
WebSocket listener in addition to its default `:1883` MQTT listener. The
stock `chirpstack-docker` deployment does **not** include this listener —
its bundled `mosquitto.conf` only opens `1883`, and its `docker-compose.yml`
only publishes `1883:1883`.

In your `chirpstack-docker` checkout, edit
`configuration/mosquitto/config/mosquitto.conf` and append:

```
listener 9001
protocol websockets
# For LAN-only deployments. For production, swap for proper auth and TLS.
allow_anonymous true
```

Then publish the new port from the `mosquitto` service in
`docker-compose.yml`:

```yaml
mosquitto:
  image: eclipse-mosquitto:2
  ports:
    - "1883:1883"
    - "9001:9001"   # add this
```

Apply with `docker compose up -d` (a plain `restart` won't pick up the new
port mapping). Leftenant will connect to `ws://<host>:9001`.

> Host-install (non-Docker) Mosquitto: add the same `listener 9001` block to
> `/etc/mosquitto/mosquitto.conf` and `systemctl restart mosquitto` instead.

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
key is scoped to the tenant — see the security model section below.

### Security model

The SPA stores the ChirpStack API key in `localStorage` and calls ChirpStack
and Mosquitto directly. There is no backend. This assumes Leftenant runs on
the operator's private network, the same trust boundary as the ChirpStack
admin UI.

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

Currently working:

- Connection wizard with REST + MQTT URL probes
- Session setup (catalog / manual / existing-profile modes)
- Camera-based QR scanner with vendor identification
- Tesseract OCR fallback for label-only devices
- Live MQTT join feed with vendor lookup
- Per-session submission history with audio feedback

Roadmap:

- Verification listener — confirming each submitted device actually joined the
  network, by subscribing to ChirpStack's per-device join events and updating
  the session table from "Created" to "Verified".
- CSV export of session history for handing off to customers or filing with
  deployment records.
