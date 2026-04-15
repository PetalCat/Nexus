#!/usr/bin/env bash
# Phase 1 exit-criteria benchmark: measure HLS segment delivery through
# the Nexus HLS stream proxy route. Takes a Jellyfin item ID and a Nexus
# session cookie, fetches the master manifest + the first segment, and
# prints size/time/throughput.
#
# Usage:
#   NEXUS_URL=http://127.0.0.1:8585 \
#   JELLYFIN_ITEM_ID=<item-guid> \
#   NEXUS_SESSION_COOKIE=<cookie-value> \
#   ./scripts/benchmark-proxy.sh
#
# Requires: curl, awk, grep. No other dependencies.
set -euo pipefail

NEXUS_URL="${NEXUS_URL:-http://127.0.0.1:8585}"
ITEM_ID="${JELLYFIN_ITEM_ID:-}"
COOKIE="${NEXUS_SESSION_COOKIE:-}"

if [[ -z "$ITEM_ID" || -z "$COOKIE" ]]; then
  echo "usage: set JELLYFIN_ITEM_ID and NEXUS_SESSION_COOKIE" >&2
  echo "  NEXUS_URL defaults to http://127.0.0.1:8585" >&2
  exit 2
fi

MASTER_URL="${NEXUS_URL}/api/stream/jellyfin/${ITEM_ID}/master.m3u8"

echo "== fetch master.m3u8 =="
echo "url: $MASTER_URL"
curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /tmp/master.m3u8 \
  -w "http_code: %{http_code}\ntime_total: %{time_total}s\n" \
  "$MASTER_URL"

SEGMENT_REL=$(grep -E '^[^#].*\.(ts|m4s|mp4)' /tmp/master.m3u8 | head -1 || true)
if [[ -z "$SEGMENT_REL" ]]; then
  echo "no segment found in manifest — check the URL, cookie, and that the item is playable" >&2
  exit 3
fi

case "$SEGMENT_REL" in
  /*)  SEGMENT_URL="${NEXUS_URL}${SEGMENT_REL}" ;;
  http://*|https://*) SEGMENT_URL="$SEGMENT_REL" ;;
  *)   SEGMENT_URL="${NEXUS_URL}/api/stream/jellyfin/${ITEM_ID}/${SEGMENT_REL}" ;;
esac

echo
echo "== fetch first segment =="
echo "url: $SEGMENT_URL"
curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /tmp/segment.bin \
  -w "http_code: %{http_code}\nsize: %{size_download} bytes\ntime: %{time_total}s\nspeed: %{speed_download} B/s\n" \
  "$SEGMENT_URL"

SPEED_BPS=$(curl -sSL \
  -H "Cookie: nexus_session=${COOKIE}" \
  -o /dev/null \
  -w "%{speed_download}" \
  "$SEGMENT_URL")

echo
awk "BEGIN { printf \"throughput: %.2f MB/s\\n\", $SPEED_BPS / 1024 / 1024 }"
