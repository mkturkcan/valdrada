<p align="center"><img src="docs/assets/figures/hero.jpg" alt="A simulator frame at W 125th St and Lenox Ave in Harlem, with its semantic segmentation and depth" width="100%"></p>

# Valdrada

Valdrada is a city-scale digital twin of New York City compiled from
public municipal records. It combines a
real-time WebGL2 renderer, lane-level traffic and pedestrian simulation, pixel-exact perception ground truth and a
client–server API modelled on CARLA. It is intended for synthetic data generation, closed-loop scenario simulation and
streetscape studies in which every modelled element can be traced to a public record.

| | |
|---|---|
| Coverage | All five boroughs: Manhattan, the Bronx, Brooklyn, Queens and Staten Island, 1,085,937 buildings in 3,532 tiles of 512 m and 261 far tiles of 2,048 m |
| Buildings | Every footprint of NYC Building Footprints, gap-filled from OpenStreetMap and joined to PLUTO (use, class, floors, year) and to facade-inspection filings (wall material); facade typologies with procedural architectural detail; landmarks with dedicated models |
| Streets | NYC Street Centerline (CSCL): widths, lane counts, direction, speed limits and grade separation become the carriageway, kerbs, sidewalks, markings and a routable lane graph |
| Street furniture | Street trees, hydrants, bus shelters, LinkNYC kiosks, bicycle racks and subway entrances placed from their records; signals at junctions derived from the street network; lamps, signage and street furniture generated along the kerbs |
| Areas modelled in detail | 125th Street from Twelfth Avenue to the Harlem River: facades, storefront signs, street furniture and street life, the Riverside Drive and Manhattan Valley viaducts, the Park Avenue Viaduct, the 1 train's 125th Street station and the bridge approaches at the Harlem River. Central Park: relief, water bodies, 16,951 trees in 33 species groups, bridges, Bethesda Terrace, Belvedere Castle and the other landmarks. Hunters Point's waterfront, Times Square, Bryant Park and Columbia's Morningside campus. Midtown's towers rebuilt near the camera by a tower kit, among them 111 West 57th and 53 West 53rd. The Metropolitan Museum of Art, the American Museum of Natural History with the Rose Center and the Gilder Center, and the Guggenheim on their footprints. The Statue of Liberty on Liberty Island |
| Streaming | Binary tiles streamed around the camera at full detail, with coarser far-field tiles beyond |
| Simulation | IDM car following on the lane graph with signal phases and turn planning; pedestrians on the sidewalk graph with signal-aware crossings; vehicles of the NYC fleet: taxis, private cars, MTA buses on their routes, school buses, police, postal, sanitation and delivery vehicles, vans, box trucks and emergency vehicles; the 1 train on the Manhattan Valley viaduct and Metro-North on the Park Avenue tracks |
| Sensors | RGB; semantic segmentation (Cityscapes-compatible classes); instance segmentation with visible and amodal boxes, occlusion ratios and 3D poses; metric depth |
| Interfaces | Interactive browser client; simulation server with a TCP API and a Python client (synchronous stepping, actor control, sensors, map queries); export of a recorded take to OpenUSD, rendered offline in Blender Cycles and Unreal Engine 5; the whole city built into Unreal Engine 5 once, for shots that need only their take and their render; a packaged Unreal Engine 5 renderer for the simulation server and its Python API |

Links:

- Documentation: <https://mkturkcan.github.io/valdrada/>
- Videos: <https://mkturkcan.github.io/valdrada/media/>
- Demo in the browser (WebGL2): <https://huggingface.co/spaces/mehmetkeremturkcan/valdrada>
- Compiled city, models and textures: <https://huggingface.co/datasets/mehmetkeremturkcan/valdrada>
- Simulation server for Windows x64, compiled city included: <https://github.com/mkturkcan/valdrada/releases>
- Unreal Engine 5 client for Linux x86-64: <https://mkturkcan.github.io/valdrada/ue-client/>

## How it works

![From public records to ground truth: records, compiled tiles, the real-time render and its labels for one block of Harlem](docs/assets/figures/pipeline.jpg)

A Node.js compiler reads the city's records and writes binary tiles. Building footprints are joined to tax lots and
facade filings and classified into facade typologies. Street centrelines become carriageways, kerbs, crosswalks, lane
paint and the lane and sidewalk graphs. The client streams the tiles around the camera, dresses the facades, simulates
vehicles and pedestrians, and renders every frame together with its labels.

The same city renders in three engines. The three.js client is where the city is authored and simulated; a recorded
take of a camera path is exported to OpenUSD, and Blender Cycles and Unreal Engine 5 render that export with the same
geometry, traffic, trees and light, each with its own materials for the families it supports. The documentation
describes the design ([One city, three renderers](https://mkturkcan.github.io/valdrada/architecture/)) and takes
one shot through each offline renderer ([Blender Cycles](https://mkturkcan.github.io/valdrada/blender-cycles/),
[Unreal Engine 5](https://mkturkcan.github.io/valdrada/unreal/)). For Unreal, the whole city can also be built once:
every 128 m cell is baked by the client into a table of kit instances and its own meshes, imported by 1 km block over a
shared material library, and a shot is a cut of that build
([The whole city](https://mkturkcan.github.io/valdrada/unreal/#the-whole-city)).

## Quick start

**Binary release (Windows x64).** Download `Valdrada-<version>-win64.zip` and `Valdrada-<version>-win64-tiles.zip`
from Releases (the server, and the compiled city's tiles), and since 0.6.0 `-terrain1.zip` and `-terrain2.zip` for the
measured ground; extract them into the same folder, start the server and run an example:

```
StartServer.bat
pip install PythonAPI/dist/valdrada-0.1.0-py3-none-any.whl
python PythonAPI/examples/intersection_120_amsterdam.py
```

**From source.** See [BUILDING.md](BUILDING.md). In short:

```
npm install && (cd client && npm install)
# binary banks (tiles, models, textures): download, or compile the tiles (BUILDING.md)
hf download mehmetkeremturkcan/valdrada --repo-type dataset --revision v0.6.1 \
    --include "Content/tiles/*" --include "Content/models/*" --include "Content/textures/*" --local-dir .cache/hf
mv .cache/hf/Content/tiles .cache/hf/Content/models .cache/hf/Content/textures client/public/
cd client && npm run dev        # http://127.0.0.1:5219
```

## Python API

```python
import valdrada
from valdrada import Location, Rotation, Transform

client = valdrada.Client("127.0.0.1", 2000)
world = client.get_world()
world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))

# tiles stream around the spectator: place it, then wait for the area to load
m = world.get_map()
here = m.geolocation_to_location(40.80955, -73.95905)            # W 120th St & Amsterdam Ave
world.get_spectator().set_transform(Transform(here + Location(-40, -40, 35), Rotation(pitch=-30, yaw=45)))
world.wait_until_loaded()

lib = world.get_blueprint_library()
junction = m.get_junctions(center=here, radius=60)[0]
taxi = world.spawn_actor(lib.find("vehicle.taxi2"), m.get_spawn_points(center=junction.location, radius=90)[0])
taxi.set_autopilot(True, route=["straight", "right"])

# instance segmentation with per-object labels (visible and amodal boxes, occlusion, 3D pose), behind the taxi
bp = lib.find("sensor.camera.instance_segmentation")
bp.set_attribute("amodal", 8)                    # amodal box and occlusion for the 8 largest objects
cam = world.spawn_actor(bp, Transform(Location(-6.5, 0, 3.0), Rotation(pitch=-12)), attach_to=taxi)
cam.listen(lambda image: print(image.frame, [(l.class_name, l.bbox, l.occlusion) for l in image.labels]))

for _ in range(100):
    world.tick()
```

Frames are ENU metres (x east, y north, z up); attachment offsets are x forward, y left, z up. The
[tutorials](https://mkturkcan.github.io/valdrada/tutorials/) go from a first connection to a recorded dataset, with
one script per step in [PythonAPI/examples/tutorials/](PythonAPI/examples/tutorials/). The full reference is in
[docs/api/python_api.md](docs/api/python_api.md); the language-independent wire protocol is in
[docs/api/protocol.md](docs/api/protocol.md).

![RGB, semantic segmentation, instance segmentation with visible and amodal boxes, and depth for one step at W 120th St and Amsterdam Ave](docs/assets/figures/sensors.jpg)

## Unreal Engine 5 client

ValdradaUE is Valdrada with an Unreal Engine 5 renderer, packaged so that it runs without compiling anything. A
launcher starts the headless core (the simulation and the Python API on port 2000) and the renderer connected to it;
the Python code above runs against it unchanged.

```bash
curl -LO https://github.com/mkturkcan/valdrada/releases/download/v0.6.1/fetch_valdrada_ue.py
python3 fetch_valdrada_ue.py --version 0.6.1   # downloads, checks and assembles the release for this system
./ValdradaUE.sh                                # Windows: ValdradaUE.bat
```

The [guide](https://mkturkcan.github.io/valdrada/ue-client/) gives the requirements, the options and what the
renderer serves so far; [building it from source](https://mkturkcan.github.io/valdrada/ue-client-build/) covers the
engine, the city's content, cooking, chunking and publishing on Linux and Windows. The renderer is distributed under
the Unreal Engine End User License Agreement; the repository's code stays MIT.
Release 0.6.1 provides the Linux x86-64 build (33 files, 30.7 GB to download, 47.5 GB installed) with four graphics
tiers (`--quality low`, `medium`, `high` or `cinematic`). The Windows x64 build is made from source as the build guide
describes.

## Coverage

![Every building of the five boroughs shaded by height, with the tile grid and the streaming radii around a camera in Harlem](docs/assets/figures/coverage.jpg)

## Architecture and repository layout

![Public records are compiled into binary tiles; the client streams, simulates and renders them inside the simulation server, which the Python API drives over TCP](docs/assets/figures/architecture.png)

```
client/            renderer, simulation and perception client (three.js, Vite)
  src/                  engine, streaming, materials, traffic, pedestrians, perception, API bridge
  tools/pipeline/       city compiler: NYC Open Data -> binary tiles
  tools/ar34/export/    take export to OpenUSD; the Blender Cycles and Unreal Engine 5 renderers
  src/lod/              the persistent skyline tier (?lod16=1)
  tools/                asset builders (vehicles, trees, vegetation, materials, Central Park), tile probes and audits
  public/               LUTs, fonts, data; tiles, models and textures are downloaded (BUILDING.md)
src/                    building-generator library shared with the client (@nyc alias); index.html is its demo
core/                   the simulation core shared by the client and the headless tools: streaming, fleet, takes
server/                 simulation server (Electron): TCP API, content serving, release builder
ue_client/              ValdradaUE: the Unreal Engine 5 renderer client (project, plugins) and its packaging and release scripts
PythonAPI/              `valdrada` Python client, examples
space/                  the Hugging Face Space: static server for the dataset's Content/
tools/                  figures, web packaging, headless rendering, film recorder and render QA, perception export, asset build scripts
  ue/                   the whole city in Unreal Engine 5: the city build, the material library, the cell actor plugin, render_take
  cells/ lod/ core/     the cell baker and export, the far levels and backdrop, the take and actor tools
docs/                   documentation site, API reference, wire protocol, rendering techniques, building typologies
```

## Gallery

![Six frames from the simulator: Fifth Avenue, 125th Street, Times Square at night, Harlem brownstones, Williamsburg in the rain and Columbia's Low Library](docs/assets/figures/gallery.jpg)

The figures in this README are generated by `tools/figures/` from renders of the simulator and from the compiled tiles;
the architecture diagram is a draw.io file in `docs/assets/figures/src/`.

## Licensing

- **Code:** MIT ([LICENSE](LICENSE)).
- **Documentation and figures:** CC BY 4.0.
- **Compiled city:** ODbL 1.0, because it contains data derived from OpenStreetMap. Images and labels rendered from it
  may be used under any terms with the attribution "© OpenStreetMap contributors".
- **Vehicle, prop and pedestrian models:** CC BY 4.0, from the CARLA Simulator; the Rocketbox pedestrian set
  (`models/peds24/rb27/`) is MIT, from the Microsoft Rocketbox Avatar Library. The NYC buses, service and delivery
  vehicles and the street trees are original models (CC BY 4.0); two vehicle bodies, the Angel of the Waters and the
  Statue of Liberty derive from CC BY 4.0 scans and models credited in ACKNOWLEDGEMENTS.md.
- **Textures and skies:** CC0, from Poly Haven and ambientCG. **Typefaces:** SIL OFL 1.1 and Apache 2.0.
- **Unreal Engine 5 client:** the source in `ue_client/` is MIT; the packaged renderer is built with Unreal Engine and
  distributed in object code under the Unreal Engine End User License Agreement.

The photoreal pedestrians contain components created with Epic Games' MetaHuman. The MetaHuman licence does not allow
using MetaHuman characters to build or enhance a database or to train or test AI models. For datasets, training and
evaluation, start the server with `--pedestrians procedural`, which uses the built-in procedural pedestrians instead.

[LICENSING.md](LICENSING.md) gives the licence of every component, including the MetaHuman notice.
[ACKNOWLEDGEMENTS.md](ACKNOWLEDGEMENTS.md) lists the required attributions, and
[client/DATA_SOURCES.md](client/DATA_SOURCES.md) documents every source dataset.

## Citation

Valdrada is developed and maintained by Mehmet Kerem Turkcan. If you use Valdrada, the compiled city or imagery
rendered with it, please cite Valdrada itself:

```bibtex
@software{turkcan2026valdrada,
  author  = {Turkcan, Mehmet Kerem},
  title   = {{Valdrada}: a real-data, real-time digital twin of New York City},
  year    = {2026},
  version = {0.6.1},
  url     = {https://github.com/mkturkcan/valdrada}
}
```
