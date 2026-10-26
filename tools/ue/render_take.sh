#!/usr/bin/bash
# R1C (lane C, 2026-10-11): render a take in Unreal from its shot name (see tools/ue/render_take.py for the inputs, the
# world and take caches, the output layout and the exit codes).
#   tools/ue/render_take.sh <shot> [--frames a-b] [--out <root>] [--gpu-pci 01] [--rebuild-world] [--rebuild-take] [--keep-raw] [--take-path]
# Default (2026-10-25): a whole shot whose queue is in the cooked persistent city (ue_cache/persist/cooked/shots.txt,
# written by tools/ue/persist_cook.sh) renders there (tools/ue/persist_render.py --cooked, about a minute to the first
# frame, no world or take assembled) into the same clip layout; --frames, the take path's own options or --take-path
# keep the take path (tools/ue/render_take.py).
set -u
source /data0/projectnyc_aux/env.sh
cd "$(dirname "$0")/../.."
SHOT=${1:-}; OUT=client/shots/valdrada/ue; GPU=01; TAKE=0; ARGS=()
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --take-path) TAKE=1 ;;
    --out) OUT=$2; ARGS+=("$1" "$2"); shift ;;
    --gpu-pci) GPU=$2; ARGS+=("$1" "$2"); shift ;;
    *) TAKE=1; ARGS+=("$1") ;;
  esac
  shift
done
if [ $TAKE = 0 ] && grep -qx "$SHOT" /data0/projectnyc_aux/ue_cache/persist/cooked/shots.txt 2>/dev/null; then
  exec python3 tools/ue/persist_render.py "$SHOT" --cooked --gpu-pci "$GPU" --clips "$OUT"
fi
exec python3 tools/ue/render_take.py "$SHOT" "${ARGS[@]}"
