#!/usr/bin/env sh
set -e

CONFIG=/data/options.json
export HA_BASE_URL="$(jq -r '.ha_url' "$CONFIG")"
export HA_TOKEN="$(jq -r '.ha_token' "$CONFIG")"
export PORT=3002

if [ -z "$HA_TOKEN" ]; then
  echo "[ha_dashboard] ERROR: ha_token is empty — set a Long-Lived Access Token in the add-on Configuration tab."
  exit 1
fi

echo "[ha_dashboard] starting on :$PORT  ->  HA at $HA_BASE_URL"
exec node api/index.js
