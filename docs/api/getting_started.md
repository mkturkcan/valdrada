# Getting started with Valdrada

Valdrada is the Valdrada digital twin of New York City as a simulation server. Like CARLA, the server renders
and simulates, and your code drives it over TCP through a Python API: you spawn and control vehicles and pedestrians,
attach cameras, step the world, and read back images, segmentation, depth and bounding boxes.

The Windows x64 release, `Valdrada-0.6.1-win64.zip` and `Valdrada-0.6.1-win64-tiles.zip` on the GitHub release
page, holds the server, the compiled city (`Content/`, its tiles in the second archive) and the Python package. Extract
both archives into the same place; the commands below run in the extracted folder `Valdrada_0.6.1_win64`.

## Start the server

On Windows, double-click `StartServer.bat` (a window that shows the simulation) or `StartServer_Headless.bat` (no
window; the GPU still renders). Both pass their arguments on to `Valdrada.exe`, which can also be started directly:

```
Valdrada.exe --port 2000 --res 1280x720 --time day
Valdrada.exe --headless
```

| option | default | |
|---|---|---|
| `--port` / `--host` | 2000 / 127.0.0.1 | the API socket (use `--host 0.0.0.0` to accept other machines) |
| `--res WxH` | 1280x720 | the render and RGB camera resolution |
| `--start-lat` / `--start-lon` | 40.80955, -73.95905 | where the city streams in first (W 120th St & Amsterdam Ave) |
| `--time` | day | `day`, `golden`, `dusk`, `night` |
| `--quality` | high | `medium` renders cheaper frames |
| `--headless` | off | hide the window |
| `--pedestrians` | photoreal | `procedural`: built-in pedestrians instead of the photoreal bank, whose MetaHuman-derived components may not be used to build or enhance a dataset or to train or test AI models (`LICENSING.md`) |
| `--content DIR` | `Content/` next to the executable | the built client and the compiled city to serve |
| `--log FILE` / `--verbose` | | server log |

The first start compiles shaders and streams the city: allow a minute or two. `server.status` answers at once, and
`Client.get_world()` waits until the simulator has booted.

## Install the Python package

```
pip install PythonAPI/dist/valdrada-0.1.0-py3-none-any.whl
pip install numpy          # optional: arrays, masks and drawing
```

The package needs Python 3.8 or later and nothing else. From a source checkout, `pip install -e PythonAPI` installs
it in place; the example scripts also run without it, since they add `PythonAPI/` to the import path themselves.

## A first script

```python
import valdrada

client = valdrada.Client("127.0.0.1", 2000)      # retries until the server accepts the connection
world = client.get_world()
m = world.get_map()
here = m.geolocation_to_location(40.80955, -73.95905)     # W 120th St & Amsterdam Ave
world.wait_until_loaded()                                  # the tiles around the spectator
print(m.get_junctions(center=here, radius=60)[0])
```

The city streams in around the spectator (`world.get_spectator()`), and map queries see only what has loaded. To work
somewhere else, move the spectator there and call `world.wait_until_loaded()` again.

## Synchronous stepping

The server starts in synchronous mode: the world advances one fixed step per `world.tick()` and waits in between.
When `tick()` returns, every listening sensor that was due on that step has delivered its data.

```python
from valdrada import Location, Rotation, Transform

settings = world.get_settings()
world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))
lib = world.get_blueprint_library()
car = world.spawn_actor(lib.find("vehicle.taxi2"), m.get_spawn_points(center=here, radius=100)[0])
car.set_autopilot(True)
cam = world.spawn_actor(lib.find("sensor.camera.rgb"), Transform(Location(-6, 0, 3), Rotation(pitch=-12)), attach_to=car)
cam.listen(lambda image: image.save_to_disk(f"_out/{image.frame:06d}.png"))
for _ in range(200):
    world.tick()
cam.destroy()
car.destroy()
world.apply_settings(settings)
```

Actors stay in the world until they are destroyed, also after the client disconnects; destroy what a script spawns.

## Tutorials and examples

The [tutorials](https://mkturkcan.github.io/valdrada/tutorials/) go step by step from a first connection to a
recorded dataset: cameras, segmentation, depth, bounding boxes, dataset recording and actor control, with one script
each in `PythonAPI/examples/tutorials/`. The other examples:

| script | shows |
|---|---|
| `PythonAPI/examples/quickstart.py` | a taxi on autopilot with a chase camera, frames saved to `_out/` |
| `PythonAPI/examples/intersection_120_amsterdam.py` | a scripted scenario at W 120th St & Amsterdam Ave. A taxi under direct control stops for the light and for anyone in its path. Autopilot cars make planned turns. AI pedestrians cross, and one walks under direct control. A pole camera writes RGB, semantic and instance images and a COCO file; a dashcam rides along. |
| `PythonAPI/examples/generate_traffic.py` | fills an area with autopilot traffic and wandering pedestrians |
| `PythonAPI/examples/benchmark.py` | seconds per tick for common sensor setups on your machine |

## What the city is

- **Geometry:** New York City compiled from public records. Buildings are NYC Building Footprints with their roof
  heights, joined to the PLUTO tax lots and the facade inspection filings; streets are the NYC Street Centerline with
  its widths, lane counts, directions and speed limits, from which the compiler builds the carriageways, kerbs,
  sidewalks and lane paint. Street trees, hydrants, bus shelters, kiosks, bicycle racks and subway entrances are
  placed from their records. Streets carry signals, lanes, parking and the city's ambient traffic and pedestrians.
- **Storefronts:** some shops are modelled on their real frontage, for example Hartley Chemist and Appletree Market at
  W 120th St & Amsterdam Ave.
- **Coordinates:** ENU metres from 40.7831 N, 73.9712 W: x east, y north, z up. Rotations are in degrees: yaw
  counter-clockwise from east, pitch nose-up. An attached actor's transform is relative to its parent (x forward,
  y left, z up).

See [python_api.md](python_api.md) for the full API and [protocol.md](protocol.md) for the wire protocol, which any
language can speak.
