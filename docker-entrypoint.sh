#!/bin/sh
# SPDX-License-Identifier: AGPL-3.0-or-later
# Copyright (C) 2026 Intelligent Farming Foundation
#
# Materialize /usr/share/nginx/html/config.json before nginx starts.
# Priority:
#   1. /shared/config.json written by a provisioner (waited for, with a timeout).
#   2. LEFTENANT_* env vars (standalone container, no provisioner).
#   3. Nothing — the app falls back to its first-run wizard.
#
# Regardless of path, we also inject a `gatewayBridgeHost` — the host a physical
# gateway should forward LoRaWAN packets to (the ChirpStack Gateway Bridge). The
# browser can't discover the host's LAN IP, so it must be resolved here:
#   - LEFTENANT_GATEWAY_BRIDGE_HOST if set — the reliable path, and REQUIRED for a
#     bridged/compose deployment where the container only sees its docker IP
#     (172.x), not the host's LAN IP.
#   - otherwise best-effort auto-detect of this host's primary IPv4 (correct when
#     the container uses host networking / is itself the LAN host).
set -e

WEBROOT=/usr/share/nginx/html
SHARED_CONFIG=/shared/config.json
WAIT_SECONDS="${CONFIG_WAIT_SECONDS:-60}"

# Resolve the Gateway Bridge host: explicit override, else this host's primary
# outbound IPv4 (via `ip route get`, falling back to `hostname -i`).
detect_bridge_host() {
    if [ -n "$LEFTENANT_GATEWAY_BRIDGE_HOST" ]; then
        printf '%s' "$LEFTENANT_GATEWAY_BRIDGE_HOST"
        return
    fi
    _ip=$(ip -4 route get 1.1.1.1 2>/dev/null \
        | awk '{ for (i = 1; i <= NF; i++) if ($i == "src") { print $(i + 1); exit } }')
    [ -z "$_ip" ] && _ip=$(hostname -i 2>/dev/null | awk '{ print $1 }')
    printf '%s' "$_ip"
}

BRIDGE_HOST=$(detect_bridge_host)

# Insert "gatewayBridgeHost" into an existing config.json when it lacks one.
# The object's opening brace is always the first character (line 1), so replace
# the first `{` on line 1 — portable across busybox / GNU / BSD sed.
inject_bridge_host() {
    [ -n "$BRIDGE_HOST" ] || return 0
    if ! grep -q 'gatewayBridgeHost' "$WEBROOT/config.json"; then
        sed -i "1s/{/{\"gatewayBridgeHost\":\"${BRIDGE_HOST}\",/" "$WEBROOT/config.json"
        echo "leftenant: injected gatewayBridgeHost=${BRIDGE_HOST}"
    fi
}

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
    inject_bridge_host
elif [ -n "$LEFTENANT_API_KEY" ] && [ -n "$LEFTENANT_TENANT_ID" ]; then
    cat > "$WEBROOT/config.json" <<EOF
{
  "chirpStackUrl": "${LEFTENANT_CHIRPSTACK_URL:-http://localhost:8090}",
  "apiKey": "${LEFTENANT_API_KEY}",
  "mqttUrl": "${LEFTENANT_MQTT_URL:-ws://localhost:9001}",
  "tenantId": "${LEFTENANT_TENANT_ID}",
  "gatewayBridgeHost": "${BRIDGE_HOST}"
}
EOF
    echo "leftenant: seeded config.json from LEFTENANT_* env (gatewayBridgeHost=${BRIDGE_HOST})"
elif [ -n "$BRIDGE_HOST" ]; then
    # No full config, but still hand the wizard a sensible bridge-host default.
    # hydrateRuntimeConfig seeds only gatewayBridgeHost from this and leaves the
    # app unconfigured, so the first-run wizard still runs.
    cat > "$WEBROOT/config.json" <<EOF
{
  "gatewayBridgeHost": "${BRIDGE_HOST}"
}
EOF
    echo "leftenant: no injected config; wizard will run (gatewayBridgeHost=${BRIDGE_HOST})"
else
    # No config and no detectable host — ensure no stale file lingers.
    rm -f "$WEBROOT/config.json"
    echo "leftenant: no injected config; starting unconfigured (wizard)"
fi

exec "$@"
