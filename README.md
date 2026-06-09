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
- Camera-based QR scanner with vendor identification
- Tesseract OCR fallback for label-only devices
- Live join monitor — polls ChirpStack's REST API for each provisioned
  device's first contact and flips its row from "Waiting" to "Joined",
  promoting the submission from "Created" to "Verified"
