# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Intelligent Farming Foundation
#
# Build the SPA, then serve the static bundle with nginx. At container start the
# entrypoint materializes /config.json from a mounted /shared/config.json (written
# by a provisioner) or from LEFTENANT_* env vars, so the app can boot pre-configured
# without a rebuild. See docker-entrypoint.sh and src/state/runtime-config.ts.

# ── build ────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npm run build

# ── serve ──────────────────────────────────────────────────────────────────--
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY docker-entrypoint.sh /docker-entrypoint-leftenant.sh
RUN chmod +x /docker-entrypoint-leftenant.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-leftenant.sh"]
CMD ["nginx", "-g", "daemon off;"]
