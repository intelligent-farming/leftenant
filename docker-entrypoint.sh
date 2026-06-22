#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Intelligent Farming Foundation
#
# Materialize /usr/share/nginx/html/config.json before nginx starts.
# Priority:
#   1. /shared/config.json written by a provisioner (waited for, with a timeout).
#   2. LEFTENANT_* env vars (standalone container, no provisioner).
#   3. Nothing — the app falls back to its first-run wizard.
set -e

WEBROOT=/usr/share/nginx/html
SHARED_CONFIG=/shared/config.json
WAIT_SECONDS="${CONFIG_WAIT_SECONDS:-60}"

if [ -d /shared ]; then
    i=0
    while [ ! -f "$SHARED_CONFIG" ] && [ "$i" -lt "$WAIT_SECONDS" ]; do
        echo "leftenant: waiting for $SHARED_CONFIG ($i/${WAIT_SECONDS})"
        i=$((i + 1))
        sleep 1
    done
fi

if [ -f "$SHARED_CONFIG" ]; then
    cp "$SHARED_CONFIG" "$WEBROOT/config.json"
    echo "leftenant: seeded config.json from $SHARED_CONFIG"
elif [ -n "$LEFTENANT_API_KEY" ] && [ -n "$LEFTENANT_TENANT_ID" ]; then
    cat > "$WEBROOT/config.json" <<EOF
{
  "chirpStackUrl": "${LEFTENANT_CHIRPSTACK_URL:-http://localhost:8090}",
  "apiKey": "${LEFTENANT_API_KEY}",
  "mqttUrl": "${LEFTENANT_MQTT_URL:-ws://localhost:9001}",
  "tenantId": "${LEFTENANT_TENANT_ID}"
}
EOF
    echo "leftenant: seeded config.json from LEFTENANT_* env"
else
    # No injected config — ensure no stale file lingers so the app shows the wizard.
    rm -f "$WEBROOT/config.json"
    echo "leftenant: no injected config; starting unconfigured (wizard)"
fi

exec "$@"
