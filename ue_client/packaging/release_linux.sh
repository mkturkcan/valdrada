#!/usr/bin/env bash
# The Linux release of ValdradaUE in one run: compile, cook and package Shipping, assemble the core bundle, and stage
# the release files with their manifest. Nothing is uploaded (release_bx/ue_publish.sh does that, on the owner's word).
#
#   bash release_linux.sh 0.5.0                     -> $VUE_OUT/release/0.5.0/ (ValdradaUE-0.5.0-linux.json and its files)
#   bash release_linux.sh 0.5.0 --skip-build        the binaries are built already
#   bash release_linux.sh 0.5.0 --stage-only        re-stage the last cook (package_linux.sh --stage-only)
#
# Environment: as common.sh (UE_ROOT, VUE_PROJECT, VUE_OUT ...); NODE_LOCAL, an extracted node-v24.19.0-linux-x64
# folder to copy instead of downloading Node; VALDRADA_CELLCACHE_SRC, the city build whose cell indices the core ships
# (default /data0/projectnyc_aux/cellcache).
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
VERSION=${1:?usage: release_linux.sh <version> [--skip-build] [--stage-only]}; shift
BUILD=1; PKG_ARGS=()
for a in "$@"; do
  case $a in
    --skip-build) BUILD=0 ;;
    --stage-only) PKG_ARGS+=(--stage-only) ;;
    *) die "unknown argument $a" ;;
  esac
done
REL="$VUE_OUT/release/$VERSION"
NODE_LOCAL=${NODE_LOCAL:-/data0/projectnyc_aux/node/node-v24.19.0-linux-x64}
[ $BUILD = 1 ] && { bash "$PKG_DIR/build_linux.sh" Shipping || die "build"; }
bash "$PKG_DIR/package_linux.sh" Shipping "${PKG_ARGS[@]}" || die "package"
NODE_ARG=(); [ -d "$NODE_LOCAL" ] && NODE_ARG=(--node-local "$NODE_LOCAL")
# (VUE_CORE_REPO: the checkout the core's code and data come from, the release's own tree; this checkout by default)
timed "core-bundle-linux" python3 "$PKG_DIR/core_bundle.py" --platform linux --out "$VUE_OUT/core_linux" "${NODE_ARG[@]}" --repo "${VUE_CORE_REPO:-$(cd "$PKG_DIR/../.." && pwd)}" \
  --cellcache "${VALDRADA_CELLCACHE_SRC:-/data0/projectnyc_aux/cellcache}" || die "core bundle"
timed "release-files-linux" python3 "$PKG_DIR/ue_release.py" --version "$VERSION" --platform linux \
  --app "$VUE_OUT/archive/Shipping/Linux" --core "$VUE_OUT/core_linux" --out "$REL" \
  --city-json "$(dirname "$VUE_PROJECT")/Data/city.json" --project-name "$VUE_NAME" || die "release files"
say "staged: $REL"
say "check:   UE_VERSION=$VERSION UE_REL=$REL bash /data0/projectnyc_aux/release_bx/ue_publish.sh --dry-run"
