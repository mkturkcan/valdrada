# Development and quality checks

Valdrada changes in small steps that each stay reversible and measurable. Three mechanisms keep a change from
breaking the city: every visible change sits behind a URL flag that turns it off, recorded takes pass automated render
gates before anyone uses them, and a release passes its own gates before it is published. This page describes each
mechanism and the commands that run it. All commands run from the top of a source checkout.

## Features behind URL flags

There is no central flag registry: each module reads `location.search` itself. A new feature is on by default and is
turned off with its tag set to `0`, which restores the previous behaviour exactly:

```js
// city/groundFix38.js
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const GF38 = !(Q && Q.get('gf38') === '0');
```

Tags are two letters and the round number, for example `?gf38=0` (the ground fill on 125th Street), `?st38=0` (the
subway entrances) and `?tn38=0` (junction turns kept on the carriageway). A feature that is off by default tests for
`=== '1'` instead (`?bxtrees=1`). The flag is named in the file's comment and in the commit subject, so a regression
can be bisected by turning flags off in the URL, for example `http://127.0.0.1:5219/?gf38=0&tn38=0`, without
checking out older code. Node tools that import a module have no `location`, so every flag is on there.

The measured ground is off by default in 0.6.2. `?terrain=p1` lays the city on the 2017 bare earth LiDAR through a
height authority (client/src/world/heightAuthority.js), with the ground graded to every paving edge and the parks'
woodland from the LiDAR canopy; the data set shipped in `client/public/data/terrain_p1` covers the five boroughs (4.9 GB,
3,625 files), and `?terrainData=<folder under data/>` reads another set. `?hhp=1` adds the highways: the Henry Hudson
Parkway from 72nd to 135th Street as designed alignments with its structures, the FDR Drive's covered and stacked
stretches as one structure each, and with `?terrain=p1` the shores from mapped polygons. With `?terrain=p1` the seawall
kit sweeps the shore walls as coursed granite or concrete with copings, rails and fittings (`?seawall=0`). The
`terrain=p1&hhp=1` pair is the combination the Manhattan videos were rendered with. Their parts can be turned off one at
a time under the same rule (`?terrainGrade=0`, `?vegp1=0`, `?hhpkit=0`), and the data they read
(`client/public/data/terrain_p1`, `terrain_p1a`, `terrain_grade`, `veg_p1` and `hhp_p2`) ships in the dataset's
`Content/data/`. The flagged ground is built in the page tile by tile and is meant for offline renders through the cell
bake: served from the 0.5.2 release folder on an RTX 6000 Ada, a view of Central Park's west side took about 14 minutes
to become ready and drew under two frames a second while it settled. Parts that are on by default, as other new
features are: the marina kit, docks, gangways, pilings and moored boats from the mapped dock lines (`?marina=0`); the
Central Park drives built on their smoothed centrelines (`?cpDrives=0`); and one placement rule that keeps trees and
street furniture out of buildings and carriageways (`?placeGuard=0`). Node tools and the cell bake take the environment
variables named in each module (`TERRAIN_P1=1`, `HHP_P2=1`, `MARINA=0`, `SEAWALL=0`, `tools/cells/bake.mjs --terrain p1
--hhp`).

## Tests

```bash
(cd client && npm test)                          # geometry and tiling invariants, 81 checks
python -m unittest discover -s PythonAPI/tests        # the Python package; offline
VALDRADA_TEST_PORT=2000 python -m unittest discover -s PythonAPI/tests   # adds the tests that need a running server
```

`npm test` needs the compiled tiles. It checks wall winding and, on sampled tiles, that terrain heights are finite,
building rings are counter-clockwise and triangulable, roads do not sink into the terrain and bridge decks are finite
with clearance under them. It exits 1 on any failure.

## Render gates

Rendering defects (z-fighting, shimmering, pop-in, black blocks from non-finite pixels, vehicles off the road, a camera
passing through geometry) are hard to see in single frames, so the film tools check every recorded take. A take is
the sequence of frames of one camera path (a shot in `tools/ad/shots.json`), recorded by `tools/ad/record.mjs` into
`client/shots/ad/clips/<shot>/`. Each harness renders on a GPU lane (`GPU_LANE=n` uses GPU (n − 1) mod the
number of GPUs; jobs on one lane queue on a lock, see `tools/gpulock.mjs`) and stops at a deadline
(`tools/harness_guard.mjs`, exit 124).

**While recording.** `record.mjs` logs, per take: `FROZEN` (the render loop stopped; the page is reloaded),
`INVALID` (no tiles under the lens), `RE-SHOT` (frames with a black half, recorded again), `LENS-INSIDE` (the lens
inside a walker or vehicle), `CAR-JUMP` (a vehicle in view moved further than its speed allows), `CAR-OVERLAP` (two
vehicle bodies in view overlap by 0.1 m or more), `CAR-OFFROAD` (a moving vehicle's wheel or body centre on a sidewalk,
median, planting bed or plaza) and `REFLECTION-DROPOUT` (a water mirror losing its reflection). These lines do not set
the exit code; the clearance audit below is the vehicle gate. After every take of 8 frames or more the recorder runs
the artifact scan and prints `*** QA FAILED` and exits 3 when it fails.

**Artifact scan.** `tools/ad/qa_scan.py` looks for transient black blocks, the signature of a non-finite pixel spread
by the post-processing chain, and runs the temporal checks:

```bash
python3 tools/ad/qa_scan.py client/shots/ad/clips t7ArchSoffit [--out <dir>] [--json <file>]
```

It exits 2 for a black block, 3 for a temporal failure and 0 otherwise. Isolated pops are written as review strips
(frames k − 1, k, k + 1) for a person to look at.

**Temporal scan.** `tools/ad/temporal_scan.py` compares each frame with its neighbours in cells. A take fails (exit 3)
on z-fighting or shimmer (5 or more cells of 80 px changing over 3 levels on slow surfaces in 5 or more frames), on
alternation (a cell toggling frame by frame), on a level-of-detail switch in view, on a pop that coincides with a logged
shadow, probe or capture event, and on a reflection dropout. `--fine` adds the 40 px test used for offline renders
(6 or more cells over 6 levels in 8 or more frames).

```bash
python3 tools/ad/temporal_scan.py client/shots/ad/clips t7ArchSoffit --fine
```

**Clearance audit.** `tools/ad/clearance.mjs` replays a take and walks the lens path in steps of at most 8 cm. A shot
fails (exit 3) when the path crosses drawn geometry, passes closer than 0.6 m to it, when two vehicle bodies overlap by
0.15 m or more in view, or when a moving vehicle leaves the carriageway in view. The report and stills go to
`client/shots/ar34/film/clearance/<label>/`.

```bash
node tools/ad/clearance.mjs --shot t7ArchSoffit
```

**Ground gaps.** `tools/qa/ground_gaps.mjs` rebuilds the drawn ground of a set of tiles and exits 1 when bare terrain
shows between walks, roadways and plazas (a cluster of 0.25 m² or more, or ground more than 0.5 m below the road).

**Offline renders.** The Blender batch (`client/tools/ar34/export/bx_render_all.mjs`, see
[Rendering in Blender Cycles](blender-cycles.md)) gates each Cycles shot. The USD writer exits 4 when coplanar surface
pairs that would z-fight remain in view, unless it runs with `--coplanar warn`, as the batch runs it. The batch stops a
shot right after the USD when more than 100 coplanar pairs remain in view (stage `usd-check`), and after three preview
frames at 8 samples when they differ from the web take (stage `preview-check`), before the full take uses a GPU. After
the take, four checks must pass: colour and lightness against the web take of the same shot (`cyc_vs_web.py`), the
temporal scan with `--fine`, at most 100 unresolved coplanar pairs in view (`bx_fix.json`), and tree crowns without
flicker (`bx_leafcheck.py`). A failing take is marked in its `status.json` and in the batch summary. With
`--target ue` the batch renders the same shots with Unreal Engine 5 ([Rendering in Unreal Engine 5](unreal.md)) through
the same gates, and `ue_check.py` compares each Unreal frame region by region with the web and Cycles takes. After the
summary, `frontend_coverage.py` reports for every shot's USD which material families each renderer draws with its own
builder and which fall back to the preview surface ([One city, three renderers](architecture.md)).

## Release gates

A release is staged from the committed state of the development tree and published only after these checks pass:

| Gate | What it checks |
|---|---|
| Drift | the public tree matches the development tree's committed state file by file |
| Content | every staged text file is scanned for terms and material that must not be published, and fails the release on a match |
| Build | the production build of the client has no dynamic import left unbundled (a 404 at run time) |
| Size | the archive is under GitHub's 2 GiB limit for a release asset |
| Start | the built server starts, reports its version, reaches `world ready` and runs `PythonAPI/examples/quickstart.py` to the end |
| Page | the built `Content/`, served as the web demo serves it, loads in headless Chromium with no console error and no failed request |
| Checksums | `SHA256SUMS` for the archive and the wheel |
| Live | after publishing, files fetched from the web demo match the release's `Content/` by hash |
