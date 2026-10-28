#!/bin/bash
# A cooked Linux build of the persistent city level (docs/notes/ue-persistent-city.md): L_City and what it streams,
# the shots' sequences and their Movie Render Queue settings (/Game/City/Shots, /Game/City/MRQ), Development, staged
# with paks under ue_cache/persist/cooked/stage; renders load cooked packages instead of the derived-data cache.
# The project has no editor target of its own (it runs the engine's editor), so the cook runs the editor's cook
# commandlet directly and BuildCookRun only builds the game and stages. (-cookdir takes folders on disk, not /Game paths;
# /Game/Kit is cooked whole: the cells reference its meshes only by path, from their tables. Nanite's fallback meshes are
# stripped (bGenerateNaniteFallbackMeshes=False, ~3 GB of classic buffers at the cinematic reach) except where a mesh has a
# translucent section, which Nanite draws from the fallback: those 53,628 meshes keep theirs (GenerateFallback Enabled,
# set by ValdradaNaniteFacades -keepfallback; without it the cook lost the water and the glass))
#   tools/ue/persist_cook.sh [--skipbuild | --stage-only]   (PC_STAGE_DIR: stage there instead of cooked/stage, as tools/city/city.py does
#   before swapping it in, so a running cooked render keeps its files; PC_COOK_FULL=1: every package again, e.g. after a cook setting
#   the incremental cook does not track, as bGenerateNaniteFallbackMeshes)
set -u
source /data0/projectnyc_aux/env.sh
HERE=$(cd "$(dirname "$0")" && pwd)
PROJECT=$(cd "$HERE/../../client/tools/ar34/export/ue_project" && pwd)/BoundlessUE.uproject
OUT=/data0/projectnyc_aux/ue_cache/persist/cooked
UE=/data0/projectnyc_aux/ue/UE_5.8
B=-build; [ "${1:-}" = --skipbuild ] && B=-skipbuild
export uebp_LogFolder=$OUT/logs/uat_$(date +%Y%m%d-%H%M%S); mkdir -p "$uebp_LogFolder"
t0=$(date +%s)
STAGE_ONLY=0; [ "${1:-}" = --stage-only ] && STAGE_ONLY=1 && B=-skipbuild
if [ $B = -build ]; then
  $UE/Engine/Build/BatchFiles/RunUAT.sh BuildCookRun -project="$PROJECT" -platform=Linux -clientconfig=Development -unattended -utf8output -nop4 \
    -nocompileeditor -build -ubtargs="-NoUBA" -skipcook -skipstage || exit 3
fi
t1=$(date +%s)
# (the packed facades' material copies made again from their instances first: a library binding run by any lane
# re-parents an instance and, before bd_tilefac.py skipped them, its '_nan' copy; ValdradaNaniteFacades -refreshvariants, ~40 s)
# (the meshes made since the last cook: a translucent or water section keeps its Nanite fallback, which the cook strips
# elsewhere; without it a rebuilt block's water drew black and wrote no depth. ValdradaNaniteFacades -keepfallback -known=)
[ $STAGE_ONLY = 1 ] || env "UE-LocalDataCachePath=/data0/projectnyc_aux/ue/ddc" "UE-SharedDataCachePath=None" $UE/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" -run=ValdradaNaniteFacades -keepfallback -known=$OUT/keepfallback_known.txt -list=/dev/null -out=$OUT/logs/keepfallback.json -unattended -nosplash -nullrhi > $OUT/logs/keepfallback.log 2>&1 || { echo "keepfallback failed"; exit 7; }
[ $STAGE_ONLY = 1 ] || env "UE-LocalDataCachePath=/data0/projectnyc_aux/ue/ddc" "UE-SharedDataCachePath=None" $UE/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" -run=ValdradaNaniteFacades -refreshvariants -list=/dev/null -out=$OUT/logs/refreshvariants.json -unattended -nosplash -nullrhi > $OUT/logs/refreshvariants.log 2>&1 || { echo "refreshvariants failed"; exit 6; }
[ $STAGE_ONLY = 1 ] || env "UE-LocalDataCachePath=/data0/projectnyc_aux/ue/ddc" "UE-SharedDataCachePath=None" $UE/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" -run=cook -targetplatform=Linux \
  -map=/Game/City/L_City+/MovieRenderPipeline/MoviePipelineEntryMap -cookdir=$(dirname "$PROJECT")/Content/City/Shots -cookdir=$(dirname "$PROJECT")/Content/City/MRQ -cookdir=$(dirname "$PROJECT")/Content/Kit ${PC_COOK_FULL:+-forcecookall} $([ -n "${PC_COOK_FULL:-}" ] || echo -cookincremental) -CookProcessCount=${PC_COOK_PROCESSES:-6} \
  -ini:Engine:[/Script/LinuxTargetPlatform.LinuxTargetSettings]:bGenerateNaniteFallbackMeshes=False -ini:Editor:[CookSettings]:MemoryMaxUsedPhysical=81920 -ini:Editor:[CookSettings]:MemoryMinFreePhysical=0 \
  -unattended -nosplash -nullrhi -stdout -FullStdOutLogOutput > $OUT/logs/cook_last.log 2>&1
# (the commandlet exits 1 over logged errors that do not stop it, e.g. the shared asset registry cache's renames)
[ $STAGE_ONLY = 1 ] || grep -q "LogCook: Display: Done!" $OUT/logs/cook_last.log || { echo "cook failed"; exit 4; }
t2=$(date +%s)
$UE/Engine/Build/BatchFiles/RunUAT.sh BuildCookRun -project="$PROJECT" -platform=Linux -clientconfig=Development -unattended -utf8output -nop4 \
  -nocompileeditor -skipbuild -skipcook -stage -pak -iostore -stagingdirectory=${PC_STAGE_DIR:-$OUT/stage} -nodebuginfo || exit 5
# the shots whose queue is now cooked (tools/ue/render_take.sh renders those here by default)
ls "$(dirname "$PROJECT")/Content/City/MRQ" | sed -n 's/^Q_\([A-Za-z0-9]*\)\.uasset$/\1/p' | sort > $OUT/shots.txt
echo "persist_cook ok: build $((t1-t0)) s, cook $((t2-t1)) s, stage $(( $(date +%s)-t2 )) s"
