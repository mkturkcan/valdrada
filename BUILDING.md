# Building from source

This document covers the interactive client, the city compiler, the simulation server and the Python package. The
reference platform is Windows 11 x64 with Node.js 24 and an NVIDIA RTX 3060 Laptop GPU. The client and compiler are
platform-independent. Commands are written for a POSIX shell; on Windows, use Git Bash.

## Requirements

| Component | Requirement |
|---|---|
| Client, compiler, server | Node.js ≥ 22.12 and npm (Vite 8) |
| Rendering | A WebGL2-capable browser and GPU; a discrete GPU is recommended |
| Binary banks | About 3.1 GB of disk; compiling the tiles needs about 3.3 GB more for raw downloads and a 6 GB Node heap |
| Python API | Python ≥ 3.8; `numpy` optional; [uv](https://docs.astral.sh/uv/) optional (wheel builds) |
| Downloads | `huggingface_hub` ≥ 1.0 for the `hf` command (`pip install -U huggingface_hub`; tested with 2.0) |

## Dependencies

```
git clone https://github.com/mkturkcan/valdrada.git
cd valdrada
npm install                        # three.js, postprocessing, n8ao (shared by client/ and src/)
(cd client && npm install)    # Vite, earcut, ez-tree
(cd server && npm install)         # Electron runtime and packager; simulation server only
```

Recent npm releases may skip dependency install scripts. If `server/node_modules/electron/dist/` is missing after
the install, run `node node_modules/electron/install.js` in `server/`. Release builds do not need this step, because
the packager fetches the runtime itself.

## Binary banks: tiles, models and textures

Three binary banks under `client/public/` are not under version control. The Hugging Face dataset
`mehmetkeremturkcan/valdrada` distributes them (folder `Content/`):

| Folder | Contents |
|---|---|
| `tiles/` | the compiled city |
| `models/` | vehicles, pedestrians, props |
| `textures/` | PBR sets, sky HDRIs, the city-scale sky-occlusion bake `cityao.*` |

The smaller banks (`basis/`, `data/`, `fonts/`, `luts/`, `settings/`) are committed.

### Download (recommended)

```
hf download mehmetkeremturkcan/valdrada --repo-type dataset --revision v0.6.1 \
    --include "Content/tiles/*" --include "Content/models/*" --include "Content/textures/*" --local-dir .cache/hf
mv .cache/hf/Content/tiles .cache/hf/Content/models .cache/hf/Content/textures client/public/
```

This fetches 3,738 files (3.1 GB). While the dataset is private, run `hf auth login` first with an account that has
access.

### Compile the tiles from public records

The models and textures come from the download in any case (omit `Content/tiles/*` from the command above). The
tiles and the occlusion bake can be rebuilt from the public sources:

```
cd client
npm run fetch -- --boro 1,2,3,4,5      # NYC Open Data and NY State open data -> data/raw/ (cached)
npm run compile -- --boro 1,2,3,4,5    # -> public/tiles/, public/textures/cityao.*
```

Boroughs are 1 Manhattan, 2 the Bronx, 3 Brooklyn, 4 Queens and 5 Staten Island. `fetch` pages through the Socrata
endpoints listed in [client/DATA_SOURCES.md](client/DATA_SOURCES.md) and skips cached files. `compile` writes 3,532
near tiles (512 m), 261 far-field tiles (2,048 m), the bridge alignments and the occlusion bake; the five-borough
compile peaks at 17.7 GB resident, and the npm script gives Node a 24 GB heap.

The inputs below are optional. The compiler uses each one when it is present in `client/data/raw/`. The
published tiles were compiled with all of them.

| Input | How to obtain | Effect |
|---|---|---|
| `osm_buildings_<boro>.json` | `node tools/osm_fetch.mjs <boro>` (Overpass; OpenStreetMap, ODbL) | footprints absent from the city file |
| `osm_columbia.xml` | `curl -o data/raw/osm_columbia.xml "https://api.openstreetmap.org/api/0.6/map?bbox=-73.9648,40.8045,-73.9575,40.8112"`, then `node tools/pipeline/columbia.mjs` | Columbia campus micro-map: lawns, walks, steps, monuments, terrace grades |
| `bus_lanes.json` | NYC Open Data, *Bus Lanes – Local Streets* (`ycrg-ses3`), JSON rows | red bus lanes |
| `watertanks_bins.json`, `greenroofs_tnc.csv`, `solar_nyserda.json`, `roofpedia_NY_{green,solar}.geojson` | DOB water-tank inspections, TNC green-roof inventory, NYSERDA distributed solar, Roofpedia; formats in `tools/pipeline/rooftops.mjs` | rooftop water tanks, green roofs, solar arrays |
| `park_elev_<boro>.json` | `node tools/pipeline/fetch_elev.mjs --boro <n>` (USGS 3DEP) | park relief; used only with `TERRAIN=real` (the default compile is flat) |

The derived files in `client/public/data/` are committed: the campus features, the elevated-rail structures and
the CityGML landmark meshes. Regenerating them is optional; see the headers of `tools/pipeline/columbia.mjs`,
`elevated.mjs` and `extract3d.mjs`.

`tools/assets/` contains the scripts that built the vehicle and pedestrian banks: retargeting, texture baking and NYC
liveries. Rerunning them requires the CARLA 0.10.0 release, the 100STYLE archive and an Unreal-asset extraction step
that is not part of this repository.

## Interactive client

```
cd client
npm run dev                          # http://127.0.0.1:5219
```

Controls and URL parameters are listed in [client/README.md](client/README.md).

## Simulation server from source

The server is an Electron host. It loads the client with `?api=1`, steps it on request and serves the TCP API
(default port 2000).

```
(cd client && npm run dev)      # terminal 1: client at :5219
(cd server && npm run dev)           # terminal 2: server on 127.0.0.1:2000, page from the dev server
pip install -e PythonAPI             # terminal 3
python PythonAPI/examples/quickstart.py
```

Server options: `--port`, `--host`, `--res WxH`, `--headless`, `--content <dir>`, `--time day|golden|dusk|night`,
`--quality high|medium`, `--pedestrians photoreal|procedural`, `--start-lat/--start-lon` and `--verbose`. A URL
option must use the `=` form, for example `--dev-url=http://127.0.0.1:5219`. `--pedestrians procedural` renders the
built-in pedestrians instead of the photoreal bank; use it for frames meant as AI training data (LICENSING.md).

## Release build

```
node server/build.mjs [--link] [--zip] [--skip-content] [--platform linux] [--out <dir>]
```

The command produces `release/Valdrada_<version>_<platform>/` in four steps:

1. Package the server with `@electron/packager`.
2. Run the Vite production build and assemble `Content/`, which holds the built client and every runtime asset
   (`tools/package.mjs --content-only`).
3. Copy `PythonAPI/` and build its wheel when `uv` is available.
4. Write `Docs/`, the launchers (`StartServer[_Headless].bat|.sh`), the legal files and `RELEASE.json`.

Options:

- `--link` hardlinks `Content/` instead of copying it; the output must be on the same volume.
- `--skip-content` keeps `Content/` from the previous build.
- `--zip` also writes `release/Valdrada-<version>-<platform>.zip`: the release folder with `Content/`, as
  published on GitHub Releases (about 2 GB for Windows x64; GitHub limits one release asset to 2 GiB).
- `--platform linux` cross-packages a Linux x64 server. It downloads that Electron runtime once. It has not been
  tested for this release.

## Python package

```
pip install -e PythonAPI                          # editable install from source
uv build --wheel PythonAPI                        # -> PythonAPI/dist/valdrada-<version>-py3-none-any.whl
```

The package has no required dependencies. `numpy` enables the array accessors (`to_numpy`, `instance_ids`, `mask`).

## Static web package

```
node tools/package.mjs [--zip] [--link] [--verify]
```

This writes `dist-package/`: the built client, its runtime assets and a dependency-free static server
(`start.cmd` / `start.sh`). The client fetches `/settings/graphics.json` from the server root, so serve the package
at a root path, not a sub-path.

## Tests

```
(cd client && npm test)         # geometry and tiling invariants (tools/tests/geometry.mjs, 81 checks)
```

## Documentation site and figures

```
pip install "mkdocs>=1.6,<2" "mkdocs-material>=9.5,<10"
mkdocs serve                         # http://127.0.0.1:8000, rebuilds on save
mkdocs build --strict                # -> site/
```

The site is `docs/` with `mkdocs.yml`. `.github/workflows/docs.yml` publishes it to GitHub Pages once Pages is
enabled for the repository (Source: GitHub Actions).

`tools/figures/` regenerates the figures in `docs/assets/figures/`. The steps run in this order:

1. `capture.py` renders the stills through the Python API, against a server started with `--res 2880x1620`.
2. `depthvis.py` colour-maps the captured depth.
3. `maps.mjs` and `citymap.mjs` draw the plans. They need the compiled tiles, and `maps.mjs` also needs the raw
   downloads.
4. `compose.mjs` lays out each figure and renders it with headless Chromium.

The architecture diagram is a draw.io file, `docs/assets/figures/src/architecture.drawio`. After editing it in
draw.io, render it with the draw.io viewer in headless Chromium:

```
node tools/figures/drawio.mjs docs/assets/figures/src/architecture.drawio \
    --svg docs/assets/figures/architecture.svg --png docs/assets/figures/architecture.png --scale 3
```

The images and console transcripts of the tutorials (`docs/assets/tutorials/`) are the outputs of the scripts in
`PythonAPI/examples/tutorials/`. One command runs them all and converts the outputs; with `--server` it starts that
server headless at 1280 × 720 and stops it afterwards, and without it the scripts use a server that is already
listening:

```
bash tools/figures/tutorial_images.sh --server release/Valdrada_0.6.1_win64/Valdrada.exe [--python python]
```

## Offline rendering in Blender

The export reads a take of the film recorder (`tools/ad/shots.mjs`) from the running client and writes OpenUSD that
Blender 4.5 (Cycles), Unreal Engine 5.8 or another USD renderer reads. The tools are in
`client/tools/ar34/export/`; the Python steps need `usd-core`, `numpy` and `pillow`. The film-detail street trees
and the window interiors are in the dataset's `Blender/` folder; point `BXTREES_ASSETS` at the downloaded
`Blender/bxtrees2` and pass `--winrooms` the downloaded `Blender/bxwin/rooms_atlas.png`. The guides
`docs/blender-cycles.md` and `docs/unreal.md` give the full steps for each renderer.

```
hf download mehmetkeremturkcan/valdrada --repo-type dataset --revision v0.6.1 \
    --include "Blender/bxtrees2/*" --include "Blender/bxwin/*" --local-dir .cache/hf
export BXTREES_ASSETS=$PWD/.cache/hf/Blender/bxtrees2 BXTREES2_TEX=$PWD/.cache/hf/Blender/bxtrees2/tex
node client/tools/ar34/export/harvest.mjs --shots <shot> --frames 0,54,107 --out <harvest dir>   # 1. harvest
uv run --no-project --with usd-core --with numpy --with pillow \
    python client/tools/ar34/export/usd_write.py --in <harvest dir> --out <usd dir>          # 2. USD layers
blender -b --factory-startup --python client/tools/ar34/export/blender_take.py -- \
    --usd <usd dir>/<shot>.usda --frames 0-107 --outdir <frames dir> \
    --winrooms .cache/hf/Blender/bxwin/rooms_atlas.png                                            # 3. Cycles frames
UE_ROOT=<engine> python3 client/tools/ar34/export/ue_take.py --usd <usd dir>/<shot>.usda \
    --outdir <frames dir> --work <work dir> --cine                                                # or Unreal frames
```

## Coordinate frames

- **Client and tiles.** Metres, with x east and z south; +y is up. Tiles are 512 m squares on the projected plane
  (`client/src/shared/geo.js`).
- **Python API.** ENU metres (x east, y north, z up) from 40.7831 N, 73.9712 W. Rotations are pitch, yaw and roll in
  degrees, with yaw counter-clockwise from east. Attachment offsets are x forward, y left, z up.
