# Rendering in Unreal Engine 5

A shot exported to OpenUSD for [Blender Cycles](blender-cycles.md) can also be rendered with Unreal Engine 5.8: the
same USD, imported with Unreal's USD Stage importer and rendered with Lumen, hardware ray tracing and Movie Render
Queue. A 108 frame take renders in about 5 minutes including the import (0.13 to 0.23 s a frame, against 6.9 to
8.5 s a frame in Cycles), and the cinematic preset adds temporal accumulation, depth of field and a film look. How the two renderers share the export is
described in [One city, three renderers](architecture.md).

The whole city can also be built into Unreal once, so that a shot needs only its take and its render: see
[The whole city](#the-whole-city). Those tools are published as they run on the machine they were developed on. A
packaged Unreal Engine 5 renderer for the simulation and the Python API, which needs no engine installed, is described
in [The Unreal Engine 5 client](ue-client.md).

This guide installs the engine, prepares the project and the material sets, renders `t7ArchSoffit` (the shot of the
Cycles guide), gives the measured times and lists the known limits. The commands are written for a Linux shell.

## What you need

| Item | Requirement |
|---|---|
| Operating system | Linux x86-64; the takes below were rendered on Ubuntu 22.04 |
| GPU | an NVIDIA RTX GPU with the proprietary driver and Vulkan (tested on RTX 6000 Ada, 48 GB, driver 580) |
| Engine | Unreal Engine 5.8 (tested with 5.8.3 built from source) |
| Disk | about 200 GB for the engine built from source (197 GB measured); the take's harvest and USD as in the Cycles guide |
| Export tools | a source checkout with the client, Playwright's Chromium, Python 3.8 or later and uv, as in the [Cycles guide](blender-cycles.md#what-you-need) |
| Assets | the street tree set `Blender/bxtrees2` from the dataset, and the CC0 material sets (below) |

## Get Unreal Engine 5.8

The engine is licensed by Epic Games under the Unreal Engine End User License Agreement
(<https://www.unrealengine.com/eula>). Linking accounts and accepting the agreement are steps you take yourself, under
your own Epic Games account.

**Linux, from source.** Epic publishes the source in the private `EpicGames/UnrealEngine` repository on GitHub. To get
access, sign in at epicgames.com, link your GitHub account under your account's apps and accounts settings, accept the
licence agreement there, and accept the invitation to the EpicGames organisation that GitHub then sends. Then:

```bash
git clone --depth 1 --branch 5.8.3-release https://github.com/EpicGames/UnrealEngine.git UE_5.8
cd UE_5.8
./Setup.sh
./GenerateProjectFiles.sh
make UnrealEditor
for t in ShaderCompileWorker UnrealPak CrashReportClient InterchangeWorker; do make $t; done
export UE_ROOT=$PWD
```

`Setup.sh` downloads the engine's binary dependencies. The editor target builds every engine plugin, including the
ones the project needs (USD importer, Movie Render Queue, Python scripting, editor and sequencer scripting), so the
project has no build of its own. The helper targets are built one at a time because the build tool runs one instance
per engine. On a machine with 128 hardware threads the editor build took 16 minutes.

**Windows, from the launcher.** The Epic Games Launcher installs a binary build: Unreal Engine, Library, Engine
Versions, add version 5.8. Set `UE_ROOT` to the installed engine folder. `ue_take.py` starts the editor from
`Engine/Binaries/Win64` on Windows and from `Engine/Binaries/Linux` elsewhere. The take scripts have been tested on Linux
only; on Windows the engine renders with Direct3D 12 instead of Vulkan, so expect small differences and report
problems.

## The project

`client/tools/ar34/export/ue_project/` is the Unreal project the takes use:

| File | Contents |
|---|---|
| `BoundlessUE.uproject` | the plugins: USD importer, Movie Render Pipeline, Python script plugin, editor scripting utilities, sequencer scripting |
| `Config/DefaultEngine.ini` | Lumen, Nanite, virtual shadow maps, MegaLights for the street lamps, hardware ray tracing on Vulkan SM6 |
| `Python/ue_masters.py` | the master materials, one per material family of the export, as Custom HLSL nodes, built into `/Game/Bx/` on the first import |
| `Python/ue_foliage.py` | the masters of the tree set: geometry leaves, alpha-tested leaf cards and bark |

`Content/`, `Saved/`, `Intermediate/` and `DerivedDataCache/` are generated and kept out of git. Nothing in the project
needs to be opened by hand: `ue_take.py` runs the editor in its command line mode for the import and the engine in
`-game` mode for the render. Set these variables in every shell you use below:

```bash
export UE_ROOT=~/UE_5.8                 # the engine
export BXUE_DDC=~/bx/ue_ddc             # a writable folder for the engine's local derived data cache
export BXTREES_ASSETS=$PWD/.cache/hf/Blender/bxtrees2
```

The tree set comes from the dataset, as in the Cycles guide:

```bash
hf download mehmetkeremturkcan/valdrada --repo-type dataset --revision v0.6.2 --include "Blender/bxtrees2/*" --local-dir .cache/hf
```

## Fetch the CC0 material sets

Unreal draws the asphalt, the sidewalks, the kerbs, the walls by material and the viaducts' steel with 13 CC0 material
sets from Poly Haven at 4K, layered over the export's own materials. `tools/assets/fetch_hq.py` downloads them (371 MB)
and writes `hq.json`, which records for each set its source page, licence, real size in metres, files and mean albedo:

```bash
uv run --no-project --with pillow --with numpy python tools/assets/fetch_hq.py --out ~/bx/hq
```

Then point the takes at the sets with `export BXUE_HQ=~/bx/hq/hq.json` (otherwise `"manifest"` under `"hq"` in
`client/tools/ar34/export/ue_families.json` is used, which names the folder of the development machine). That
table maps each pbrLib set, ground kind, viaduct
layer and facade wall class to its set. A take rendered without the sets, or with `BXUE_NOHQ=1`, uses the export's own
textures.

## Export the shot

The Unreal take renders the USD that the Cycles guide writes. Follow its sections
[Capture the shot](blender-cycles.md#capture-the-shot) and [Write the USD](blender-cycles.md#write-the-usd), with
`BXTREES_ASSETS` set as above, so that `~/bx/u/t7ArchSoffit.usda` exists. A USD already rendered with Cycles needs no
new export.

## Render the take

```bash
python3 client/tools/ar34/export/ue_take.py --usd ~/bx/u/t7ArchSoffit.usda \
    --outdir ~/bx/ue/t7ArchSoffit --work ~/bx/ue_work/t7ArchSoffit --res 2560x1440 --gpu 0
```

The script runs three stages, each in its own process:

1. **Prep.** `ue_prep.py` writes the take's Unreal layer: the per-vertex data packed into UV sets, the moving vehicles,
   trains and signal lenses as animated transforms, and `ue_t7ArchSoffit.json` with the materials' tags.
2. **Import.** `UnrealEditor-Cmd` builds the master materials when they are missing, imports the stage into
   `/Game/Takes/t7ArchSoffit/` (Nanite meshes, actors, the camera and the moving sets as Level Sequence tracks), makes
   each tagged material an instance of its family's master, sets up the sun, the sky, the street and vehicle lamps and
   the film look, and writes the Movie Render Queue job. A fingerprint of the take's layers is kept beside the import, so
   rendering the same USD again reuses it (`--reimport` imports it again).
3. **Render.** The engine renders the frames off screen into `~/bx/ue/t7ArchSoffit/frame_%05d.jpg`, with the planar
   depth in `_depth/` and the regions of the data pass in `_ue/regions/`. `take_ue.json` in the same folder records the
   times of every stage; the logs of the stages (`prep.log`, `import.log`, `render.log`) are in the work folder.

`--gpu` picks the Vulkan device. Existing frames are kept unless `--overwrite` is given. `--light web` replaces the
physical light (the default, shared with Cycles through `phys_light.json`) by the rig calibrated against the web takes,
and `--treewind 0` freezes the trees' wind.

**The cinematic preset.** `--cine` renders 8 temporal samples per frame over a 180 degree shutter centred on the frame,
with depth of field on the subject at f/2.8 (`--fstop`), the client's bloom, film grain (`--grain`), a deeper vignette,
light volumetric fog by day (`--fog`) and the analytic haze at night:

```bash
python3 client/tools/ar34/export/ue_take.py --usd ~/bx/u/t7ArchSoffit.usda \
    --outdir ~/bx/ue/t7ArchSoffit --work ~/bx/ue_work/t7ArchSoffit --res 2560x1440 --gpu 0 --cine
ffmpeg -framerate 30 -i ~/bx/ue/t7ArchSoffit/frame_%05d.jpg -c:v libx264 -crf 16 -pix_fmt yuv420p ~/bx/t7ArchSoffit_ue.mp4
```

![Frame 54 of t7ArchSoffit rendered with Unreal Engine 5.8 and the cinematic preset, at 1280 × 720](assets/guide/unreal_frame.jpg)

**Batches.** `bx_render_all.mjs` renders a list of shots with Unreal and the same checks as the Cycles takes. It writes
the harvest and the USD when a shot has none, or reuses a Cycles batch's with `--usdfrom <work dir>`:

```bash
node client/tools/ar34/export/bx_render_all.mjs --target ue --shots t7ArchSoffit --gpus 0 \
    --work ~/bx/ue_batch --clips ~/bx/ue_takes --nopreview --nocut --uetake " --cine"
```

The value of `--uetake` (extra `ue_take.py` options) begins with a space so that it is not read as an option of the
batch. `--cycref <dir>` names the root of physical Cycles takes of the same shots, which `ue_check.py` then compares
region by region. After the summary the batch prints the [coverage report](architecture.md#what-needs-work-per-renderer)
of every shot's USD.

## Times

Measured on RTX 6000 Ada GPUs at 2560 × 1440, 108 frame takes with the bxtrees2 trees:

| Stage | Default | Cinematic (`--cine`) |
|---|---|---|
| Prep | 9 to 20 s | 9 to 20 s |
| Import, first time | 146 to 389 s | 146 to 389 s |
| Import, the same USD again | 40 to 95 s | 40 to 95 s |
| Render, per frame | 0.13 to 0.23 s | 1.05 to 1.25 s |
| Whole take | 4.7 to 5.6 min | 5.5 to 13 min |

For `t7ArchSoffit` with `--cine`: prep 20 s, import 364 s, the render 178 s (the first frame 43 s with the engine start
and 48 warm-up frames, then a median of 1.14 s a frame) and 67 s to write the frames. The first take on a machine also
compiles the engine's global shaders and builds the tree set's Nanite meshes (about 4.5 minutes); the derived data cache
keeps both. For comparison, the physical light Cycles takes of the same shots needed 6.9 to 8.5 s a frame.

## Known limits

| Limit | Detail |
|---|---|
| Contiguous takes | Render a take's frames as one range. A render that jumped from frame 0 to frame 54 has hung the GPU, so final batches use `--nopreview`, whose three preview frames are not contiguous. |
| Walkers and wind outside ray tracing | The walkers' skinned meshes are left out of the ray tracing scene and the trees' wind is not evaluated for ray tracing: Lumen lights and reflects the scene without the walkers (the sun's shadow maps still cast their shadows) and sees the crowns at rest. Both changes, with async compute off, stopped a GPU hang during takes. `BXUE_RTDYN=1` restores them, for tests. |
| Sign lights | At night the lit signs and shop interiors light their surroundings as rect lights. One shot lost the GPU device three times with them and was rendered with `BXUE_EMITK=0`, which turns them off. |
| Linux only | See [Get Unreal Engine 5.8](#get-unreal-engine-58). |

## The whole city

`tools/ue/` builds every cell of the compiled city into the Unreal project once and renders shots from that build. The
city is cut into 128 m cells, 56,512 over the 3,532 tiles of the five-borough compile and 307 more where the bridges
land outside it. The client bakes each cell headless (`tools/cells/bake.mjs --kitrec`): the parts of the dressed
buildings and of the tower kit become rows of a table of kit instances (part, transform, tint, texture offset and the
heights the masters read), and what is left (ground, roads, terrain, the tile massing) becomes the cell's own meshes.
A building is drawn by one cell only, the one under its centre. Every material record carries a key of its content,
and each key is one material instance of a shared library (`tools/ue/matlib.py`), bound once. The cells' own meshes
are merged by material into one package per 1 km block (`tools/ue/block_merge.py`), and a C++ actor
(`tools/ue/plugins/ValdradaCells`) spawns a cell's kit instances from its table when its level loads. The far city is
a quadtree of chunks from 1 km to 8 km, with each 8 km square's water, the landmarks and the bridges in 1 km pieces,
prepared and imported once.

```bash
UE_V2=1 UE_CITY_DIR=<cache>/city_v2 UE_BAKE_NAME=cityv2 python3 tools/ue/city_build.py run --pages 6
```

`run` bakes the cells on the GPUs in the background and builds each block as its cells are baked, then the far library.
Every step is keyed by its content, so a run after an edit of the generator redoes only the cells and blocks the edit
changed; a material or master change rebinds the library instead. The stages can also be run one at a time (`cells`,
`bake`, `build`, `far`).

A shot is then a cut of that build: its near cells rounded out to whole 1 km blocks and, over the rest, the far chunks
its frames ask for. Nothing is built for it but its take (the actors, the light and the sequence, from the shot in
`tools/ad/shots.json`):

```bash
UE_CITY=1 UE_KITCELLS=1 UE_CITY_DIR=<cache>/city_v2 bash tools/ue/render_take.sh lfAerial125 --preset cine2f
UE_CITY=1 UE_KITCELLS=1 UE_CITY_DIR=<cache>/city_v2 bash tools/ue/render_take.sh lfAerial125 --preset cine2f --frames 600-2025 --gpu-pci 41
```

**Frame ranges.** `--frames a-b` renders frames a to b-1 as a job of its own, with its own lock, its world cut from the
cells of its own frames, so the ranges of one long shot render in parallel on several GPUs; each range writes its
frames under `f<a>-<b>/` in the output root. The presets are in `tools/ue/render_take*.json`: `cine2f` renders
2560 × 1440 with 8 spatial samples a frame, ray-traced sun shadows, a 1 GB Nanite streaming pool and the aerial
perspective at full strength from 6 km. `cine2h` is `cine2f` with Unreal's temporal super resolution (TSR) as the
anti-aliasing over those 8 samples: on frames 1050 to 1090 of `lfBroadway125`, a lens skimming the towers, the pixels
that flip against both neighbouring frames (reprojected through depth) fell from 1.7 % to 0.11 %, at the same 2.3 s a
frame.

**Measured.** On the development machine (128 hardware threads, three RTX 6000 Ada GPUs, Unreal Engine 5.8.3) the
first build of the five boroughs took 11 h 20 min: the 56,819 cells were baked in 7 h 41 min on the three GPUs while
the blocks were built, which left 56,582 cells with content in 981 block packages, and the far library holds 1,958
packages. Eighteen renders with `cine2f` on 2026-10-16 cut worlds of 1,952 to 5,600 cells and 398 to 1,344 far
packages; the take took 100 to 2,287 s to build, the first frame 303 to 1,560 s (the engine's start, the world's load
and the warm-up), and then a median of 1.30 to 2.90 s a frame. The 115 s aerial `lfAerial125` (3,450 frames) was
rendered as the ranges 0-600, 600-2025 and 2025-3450.

**Limits.** These scripts were written for the development machine and have only run there: their defaults name its
folders (`/data0/projectnyc_aux/...`, 46 files), and the cell cache, the Unreal caches and the project's imported
packages took 522 GB, 419 GB and 284 GB there, earlier builds included. The city's Unreal build is not distributed;
the dataset holds the compiled tiles it is made from.

## Credits in films

A film rendered with Unreal Engine that has credits must carry the notices of the Unreal Engine End User License
Agreement in its credits, with the film's title and the current year:

```text
<Title> uses Unreal® Engine. Unreal® is a trademark or registered trademark of Epic Games, Inc. in the United States
of America and elsewhere.
Unreal® Engine, Copyright 1998 – 2026, Epic Games, Inc. All rights reserved.
```

## Common problems

| Problem | Fix |
|---|---|
| The render exits at once with Vulkan errors in `render.log` | Install the NVIDIA driver's Vulkan component; `ue_take.py` selects NVIDIA's Vulkan driver when `/usr/share/vulkan/icd.d/nvidia_icd.json` exists. |
| `core option ... missing in this engine` | The engine is not 5.8: the import refuses an engine whose USD importer or Movie Render Queue lacks an option the take needs. |
| Materials render flat or white | The masters were not built: look for `[bxue]` errors in `import.log` in the work folder. |
| Plain asphalt and walls | The CC0 sets were not fetched, or neither `BXUE_HQ` nor `hq.manifest` in `ue_families.json` points to `hq.json`. |
| The trees are the client's | `BXTREES_ASSETS` was not set when the USD was written. |
