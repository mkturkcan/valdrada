#!/usr/bin/env bash
# Valdrada with the Unreal Engine 5 renderer: starts the headless core (the simulation and the Python API on port 2000)
# and the Unreal renderer connected to it, and stops both when either exits or on Ctrl+C.
#
#   ./ValdradaUE.sh                              core on 127.0.0.1:2000 and the renderer in a 1280x720 window
#   ./ValdradaUE.sh --res 1920x1080 --quality cinematic
#   ./ValdradaUE.sh --offscreen --gpu 1          no window (servers, containers); the renderer on the second GPU
#   ./ValdradaUE.sh --core-only --host 0.0.0.0   only the core, reachable from other machines
#   ./ValdradaUE.sh --renderer-only --core-host 10.0.0.5
#   ./ValdradaUE.sh -- -ExecCmds="stat fps"      arguments after -- go to Unreal unchanged
#
# Options:
#   --port N              the API port (default 2000); the renderer connects to the same port
#   --host ADDR           the address the core listens on (default 127.0.0.1)
#   --core-host ADDR      with --renderer-only: the core to connect to (default 127.0.0.1)
#   --res WxH             the window and the default RGB camera size (default 1280x720)
#   --quality Q           low, medium, high (default) or cinematic: the renderer's tier and the core's crowd detail
#   --offscreen           render without a window (Unreal's -RenderOffScreen)
#   --fullscreen          a full screen window instead of a framed one
#   --gpu N               the GPU the renderer uses (Unreal's -graphicsadapter=N, 0 = the first)
#   --time T              day (default), golden, dusk or night
#   --start-lat L --start-lon L   where the city streams in first (default W 120th St & Amsterdam Ave)
#   --seed N              the simulation's random seed (default 1)
#   --pedestrians P       photoreal (default) or procedural
#   --core-only           start only the core
#   --renderer-only       start only the renderer
#   --log-dir DIR         where core.log and renderer.log go (default ./logs next to this script)
#   --verbose             log every API request in core.log
set -uo pipefail
ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
CORE="$ROOT/core"
RENDERER="$ROOT/renderer"
PORT=2000; HOST=127.0.0.1; CORE_HOST=127.0.0.1; RES=1280x720; QUALITY=high; OFFSCREEN=0; FULLSCREEN=0; GPU=
TIME=day; LAT=40.80955; LON=-73.95905; SEED=1; PEDS=photoreal; MODE=both; LOGDIR="$ROOT/logs"; VERBOSE=0; EXTRA=()

usage() { sed -n 2,31p "$0" | sed 's/^# \{0,1\}//'; }
need() { [ $# -ge 2 ] && [ -n "$2" ] || { echo "ValdradaUE: $1 needs a value" >&2; exit 2; }; }
while [ $# -gt 0 ]; do
  case $1 in
    --port) need "$@"; PORT=$2; shift ;;
    --host) need "$@"; HOST=$2; shift ;;
    --core-host) need "$@"; CORE_HOST=$2; shift ;;
    --res) need "$@"; RES=$2; shift ;;
    --quality) need "$@"; QUALITY=$2; shift ;;
    --offscreen) OFFSCREEN=1 ;;
    --fullscreen) FULLSCREEN=1 ;;
    --gpu) need "$@"; GPU=$2; shift ;;
    --time) need "$@"; TIME=$2; shift ;;
    --start-lat) need "$@"; LAT=$2; shift ;;
    --start-lon) need "$@"; LON=$2; shift ;;
    --seed) need "$@"; SEED=$2; shift ;;
    --pedestrians) need "$@"; PEDS=$2; shift ;;
    --core-only) MODE=core ;;
    --renderer-only) MODE=renderer ;;
    --log-dir) need "$@"; LOGDIR=$2; shift ;;
    --verbose) VERBOSE=1 ;;
    -h|--help) usage; exit 0 ;;
    --) shift; EXTRA=("$@"); break ;;
    *) echo "ValdradaUE: unknown option $1 (--help lists them)" >&2; exit 2 ;;
  esac
  shift
done
[[ $PORT =~ ^[0-9]+$ ]] || { echo "ValdradaUE: --port must be a number" >&2; exit 2; }
[[ $RES =~ ^[0-9]+x[0-9]+$ ]] || { echo "ValdradaUE: --res must be WxH, e.g. 1280x720" >&2; exit 2; }
case $QUALITY in
  low) TIER=low; CORE_Q=medium ;; medium) TIER=medium; CORE_Q=medium ;;
  high) TIER=high; CORE_Q=high ;; cinematic) TIER=cinematic; CORE_Q=high ;;
  *) echo "ValdradaUE: --quality is low, medium, high or cinematic" >&2; exit 2 ;;
esac
mkdir -p "$LOGDIR"
unset ELECTRON_RUN_AS_NODE
ulimit -c 0 2>/dev/null || true

say() { echo "[ValdradaUE $(date +%H:%M:%S)] $*"; }
CORE_PID=; REND_PID=

alive() { [ -n "$1" ] && kill -0 "$1" 2>/dev/null; }
stop_pid() {   # stop_pid <pid> <name> <grace seconds>
  local pid=$1 name=$2 grace=$3 i
  alive "$pid" || return 0
  kill -TERM "$pid" 2>/dev/null
  for ((i = 0; i < grace * 10; i++)); do alive "$pid" || { say "$name stopped"; return 0; }; sleep 0.1; done
  say "$name did not stop in $grace s: killed"
  kill -KILL "$pid" 2>/dev/null
}
STOPPING=0
shutdown() {
  [ $STOPPING = 1 ] && return
  STOPPING=1
  stop_pid "$REND_PID" renderer 15
  stop_pid "$CORE_PID" core 5
}
trap 'shutdown; exit 130' INT
trap 'shutdown; exit 143' TERM
trap 'shutdown' EXIT

start_core() {
  local node="$CORE/node/bin/node"
  [ -x "$node" ] || { echo "ValdradaUE: no core at $CORE (download the core archive: python3 fetch_valdrada_ue.py)" >&2; exit 1; }
  [ -d "$CORE/app/client/public/tiles" ] || { echo "ValdradaUE: the city's tiles are missing in $CORE/app/client/public/tiles" >&2; exit 1; }
  : > "$LOGDIR/core.log"
  local args=(--port "$PORT" --host "$HOST" --res "$RES" --quality "$CORE_Q" --time "$TIME" --start-lat "$LAT" --start-lon "$LON"
              --seed "$SEED" --pedestrians "$PEDS" --log "$LOGDIR/core.log")
  [ $VERBOSE = 1 ] && args+=(--verbose)
  # the city's ground as the renderer's blocks have it: the measured terrain on the cells the city was baked on it (the
  # list ships with the core), the highways' decks with it; elsewhere the flat compile (a core without the list stays flat)
  local ground=()
  [ -f "$CORE/app/client/public/data/terrain_cells.json" ] && ground=(TERRAIN_P1=1 HHP_P2=1 "TERRAIN_P1_CELLS=$CORE/app/client/public/data/terrain_cells.json")
  # (the tiles on the measured ground laid once when the release was built: tools/core/tile_cache.mjs)
  [ -d "$CORE/app/cache/tiles" ] && ground+=("VALDRADA_TILE_CACHE=$CORE/app/cache/tiles")
  env "${ground[@]}" VALDRADA_CELLCACHE="$CORE/app/cellcache" "$node" "$CORE/app/tools/core/serve.mjs" "${args[@]}" > "$LOGDIR/core.out" 2>&1 &
  CORE_PID=$!
  say "core starting (pid $CORE_PID, $HOST:$PORT, log $LOGDIR/core.log)"
  local i
  for ((i = 0; i < 1200; i++)); do
    alive "$CORE_PID" || { echo "ValdradaUE: the core exited during start:" >&2; tail -20 "$LOGDIR/core.out" >&2; exit 1; }
    grep -q "world ready" "$LOGDIR/core.log" 2>/dev/null && break
    grep -q "ERROR cannot listen" "$LOGDIR/core.log" 2>/dev/null && { echo "ValdradaUE: port $PORT is in use (another server running? use --port)" >&2; exit 1; }
    sleep 0.1
  done
  say "core ready: $(grep -o 'world ready in [0-9.]* s' "$LOGDIR/core.log" | tail -1)"
}

start_renderer() {
  # the game binary itself, not Unreal's start script (renderer/ValdradaUE.sh runs the binary as its child, so a stop
  # signal sent to the script would leave the game running)
  local exe
  exe=$(ls "$RENDERER"/ValdradaUE/Binaries/Linux/ValdradaUE-Linux-Shipping "$RENDERER"/ValdradaUE/Binaries/Linux/ValdradaUE \
        "$RENDERER"/ValdradaUE/Binaries/Linux/ValdradaUE-Linux-* 2>/dev/null | grep -v -E '\.(debug|sym)$' | head -1)
  [ -n "$exe" ] || { echo "ValdradaUE: no renderer in $RENDERER/ValdradaUE/Binaries/Linux (download the base archive and the content: python3 fetch_valdrada_ue.py)" >&2; exit 1; }
  [ -x "$exe" ] || chmod +x "$exe"
  local w=${RES%x*} h=${RES#*x} host=$CORE_HOST
  [ "$MODE" = both ] && host=127.0.0.1
  [ "$MODE" = both ] && [ "$HOST" != 127.0.0.1 ] && [ "$HOST" != 0.0.0.0 ] && host=$HOST
  local args=(-ValdradaHost="$host" -ValdradaPort="$PORT" -ValdradaTier="$TIER" -ResX="$w" -ResY="$h"
              -abslog="$LOGDIR/renderer.log" -nosplash -nosound -unattended)
  [ -d "$RENDERER/ValdradaUE/Data/tables" ] && args+=(-ValdradaTables=Data/tables)
  if [ $OFFSCREEN = 1 ]; then args+=(-RenderOffScreen); elif [ $FULLSCREEN = 1 ]; then args+=(-fullscreen); else args+=(-windowed); fi
  [ -n "$GPU" ] && args+=(-graphicsadapter="$GPU")
  # Linux: with the NVIDIA driver installed, give Vulkan its ICD only, so that a software device (Mesa's llvmpipe) is never
  # picked or counted by --gpu (VK_ICD_FILENAMES set by the user is kept)
  if [ -z "${VK_ICD_FILENAMES:-}" ] && [ -f /usr/share/vulkan/icd.d/nvidia_icd.json ]; then
    export VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/nvidia_icd.json
  fi
  "$exe" ValdradaUE "${args[@]}" "${EXTRA[@]}" > "$LOGDIR/renderer.out" 2>&1 &
  REND_PID=$!
  say "renderer started (pid $REND_PID, tier $TIER, ${w}x${h}$([ $OFFSCREEN = 1 ] && echo ', off screen'), log $LOGDIR/renderer.log)"
}

case $MODE in
  both) start_core; start_renderer ;;
  core) start_core ;;
  renderer) start_renderer ;;
esac
[ "$MODE" = renderer ] || say "connect with: import valdrada; client = valdrada.Client(\"localhost\", $PORT)"
say "Ctrl+C stops $([ "$MODE" = both ] && echo both || echo it)"

# wait until either process exits, then stop the other
rc=0
while :; do
  if [ -n "$CORE_PID" ] && ! alive "$CORE_PID"; then wait "$CORE_PID" 2>/dev/null; rc=$?; say "the core exited (code $rc)"; break; fi
  if [ -n "$REND_PID" ] && ! alive "$REND_PID"; then wait "$REND_PID" 2>/dev/null; rc=$?; say "the renderer exited (code $rc)"; break; fi
  sleep 0.5
done
shutdown
exit $rc
