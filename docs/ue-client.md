# The Unreal Engine 5 client

ValdradaUE is Valdrada built as a downloadable Unreal Engine 5 application. Like CARLA, it is started from a launcher and
driven from Python; nothing has to be compiled. It runs as two processes. The headless core (a bundled Node runtime)
holds the city model and the simulation (traffic, pedestrians, signals, trains) and serves the Python API on port
2000. The renderer, an Unreal Engine 5 application, connects to the core on the same port, streams the city's cells round
the cameras the core names, draws the core's state at every tick and returns the camera images, which the core hands to
the Python client. Scripts written for the three.js build run unchanged against it: the API and the wire protocol
([protocol.md](api/protocol.md)) are the same, and only the renderer differs. How the renderer and the core talk is
specified in [render-protocol.md](https://github.com/mkturkcan/valdrada/blob/main/docs/specs/render-protocol.md).

For building the application and its content from source, see [Building the Unreal Engine 5 client](ue-client-build.md).

## System requirements

| Component | Requirement |
|---|---|
| Operating system | Linux x86-64 (tested on Ubuntu 22.04, kernel 6.8). Release 0.6.0 ships the Linux build only; on Windows 10/11 x64 the client is built from source as the [build guide](ue-client-build.md#windows) describes |
| GPU | A GPU with hardware ray tracing and 64-bit atomics for Nanite and Lumen: NVIDIA RTX (Turing or newer) or AMD Radeon RX 6000 or newer. Tested on NVIDIA RTX 6000 Ada (48 GB): with two places loaded at 1280 × 720 the GPU's memory peaked at 7.6 GiB with `--quality low` and 13.4 GiB with `--quality high` |
| Driver | Linux: the NVIDIA proprietary driver with its Vulkan ICD (tested with 580.159.03). Windows: a current vendor driver with Direct3D 12 |
| Memory | 16 GB or more: in a run at 1280 × 720 with two places loaded, the renderer held 13.1 GB and the core 0.8 GB |
| Disk | Linux: 47.0 GB installed (the renderer's content 27.6 GB, the kit tables 15.5 GB, the core with the city's tiles 3.7 GB); the download is kept until the install has finished, and the script asks for 78 GB free |
| Python | 3.8 or later for the `valdrada` package; `numpy` is optional and used by most examples |
| Network | The download, 30.2 GB in 32 files for Linux; afterwards none, unless the core and the renderer run on different machines |

The core alone (`--core-only`) needs no GPU: it simulates, answers map queries and moves actors, and answers sensor
requests with the error `needs_renderer` until a renderer is attached.

## Download and verify

The current Unreal client is release 0.6.0. A release consists
of a manifest, `ValdradaUE-<version>-<platform>.json`, and the files it lists, published as assets of the [GitHub
release](https://github.com/mkturkcan/valdrada/releases) and mirrored in the Hugging Face dataset
`mehmetkeremturkcan/valdrada-ue`. `fetch_valdrada_ue.py`, published with them, downloads every file, resumes
interrupted downloads, checks each file against the SHA256 of the manifest, joins files that were published in parts
and unpacks the archives. It needs Python 3.8 or later and nothing else.

```bash
curl -LO https://github.com/mkturkcan/valdrada/releases/download/v0.6.0/fetch_valdrada_ue.py
python3 fetch_valdrada_ue.py --version 0.6.0       # for this system, into ./ValdradaUE-0.6.0-<platform>
python3 fetch_valdrada_ue.py --version 0.6.0 --dest ~/ValdradaUE
python3 fetch_valdrada_ue.py --version 0.6.0 --mirror huggingface  # from the Hugging Face copy
```

On Windows, once a Windows build is published (release 0.6.0 has none; build it as the [build guide](ue-client-build.md#windows)
describes), in PowerShell:

```powershell
Invoke-WebRequest https://github.com/mkturkcan/valdrada/releases/download/v0.6.0/fetch_valdrada_ue.py -OutFile fetch_valdrada_ue.py
python fetch_valdrada_ue.py --version <version>
```

The script checks the free disk space first. Files that fail their check are downloaded again on the next run; nothing
that fails a check is installed. Files downloaded by hand (into one folder, all of those the manifest names) are
checked and installed with `--from-dir <folder>`; `sha256sum -c ValdradaUE-<version>-<platform>-SHA256SUMS.txt` checks
them without installing. After installing, `python3 fetch_valdrada_ue.py --verify --dest <folder>` checks the content
files again.

| File | Contents |
|---|---|
| `ValdradaUE-<v>-<platform>.json` | the manifest: every file, its size and SHA256, where it is installed |
| `ValdradaUE-<v>-<platform>-base.tar.gz` (Windows: `.zip`) | the launcher, the Python package and examples, the licences, and the renderer application without its content |
| `ValdradaUE-<v>-<platform>-core.tar.xz` (Windows: `.zip`) | the headless core with its Node runtime and the compiled city's tiles |
| `ValdradaUE-<v>-<platform>-pakchunk<N>-<Platform>.*`, `...-global.*` | the renderer's cooked content: Unreal IoStore containers in partitions of at most 1,900 MiB |
| `ValdradaUE-<v>-tables.tar.xz` | the kit tables the renderer assembles the buildings' parts from (shared by both platforms) |
| `ValdradaUE-<v>-<platform>-SHA256SUMS.txt` | the checksums, for checking by hand |

The installed folder:

| Path | Contents |
|---|---|
| `ValdradaUE.sh`, `ValdradaUE.bat` | the launcher |
| `core/` | the core: `node/` (Node.js 24.19.0) and `app/` (the simulation, the API server and the city's tiles) |
| `renderer/` | the Unreal Engine application; its content in `renderer/ValdradaUE/Content/Paks/`, the city manifest and the kit tables in `renderer/ValdradaUE/Data/` |
| `PythonAPI/` | the `valdrada` package and the examples |
| `logs/` | the last run's `core.log`, the renderer's console output `renderer.out`, and `renderer.log` from a renderer built with logging (the Development package) |

## Run

```bash
./ValdradaUE.sh                                    # Windows: ValdradaUE.bat
```

The launcher starts the core, waits until its world is ready, starts the renderer connected to it, and stops both when
either exits, on Ctrl+C or on SIGTERM. Measured on Linux with an RTX 6000 Ada in release 0.6.0's smoke test
(`ue_client/packaging/smoke_test.py`, installed release, `--quality low`): the core was ready in 3.6 s, the renderer
attached 11 s after the launcher started it, `world.wait_until_loaded()` returned 4.7 s after the camera was placed at W 120th St and Amsterdam Ave and 4.0 s after it moved to Times Square, and the first tick with an
RGB and a depth camera at 1280 × 720 took 2.4 to 2.6 s and the following ones 0.16 to 0.39 s.

| Option | Default | |
|---|---|---|
| `--port N` | 2000 | the API port; the renderer connects to the same port |
| `--host ADDR` | 127.0.0.1 | the address the core listens on (`0.0.0.0` to accept other machines) |
| `--res WxH` | 1280x720 | the window and the default RGB camera size |
| `--quality Q` | high | `low`, `medium`, `high` or `cinematic`: the renderer's graphics tier (the console variables of `Data/tiers.json`, made from the persistent city's `tools/ue/persist_tiers.json`: streaming pools, virtual shadow maps, Lumen, ray tracing, view distance) and the core's crowd detail |
| `--offscreen` | off | render without a window (servers, containers) |
| `--fullscreen` | off | a full screen window |
| `--gpu N` | | the GPU the renderer uses (0 is the first) |
| `--time T` | day | `day`, `golden`, `dusk` or `night` |
| `--start-lat`, `--start-lon` | 40.80955, -73.95905 | where the city streams in first (W 120th St and Amsterdam Ave) |
| `--seed N` | 1 | the simulation's random seed |
| `--pedestrians P` | photoreal | `procedural` for the built-in pedestrian variants |
| `--core-only` | | start only the core |
| `--renderer-only` | | start only the renderer; `--core-host ADDR` names the core |
| `--log-dir DIR` | `logs/` | where the logs go |
| `-- <arguments>` | | passed to Unreal unchanged |

The core and the renderer can run on different machines: `./ValdradaUE.sh --core-only --host 0.0.0.0` on one, and
`./ValdradaUE.sh --renderer-only --core-host <address>` on the other; Python clients connect to the core.

## Connect from Python

```bash
pip install ./PythonAPI
pip install numpy          # optional
python PythonAPI/examples/quickstart.py
```

```python
import valdrada

client = valdrada.Client("localhost", 2000)
world = client.get_world()
m = world.get_map()
here = m.geolocation_to_location(40.80955, -73.95905)
world.wait_until_loaded()            # the core's cells and the renderer's
lib = world.get_blueprint_library()
car = world.spawn_actor(lib.find("vehicle.taxi2"), m.get_spawn_points(center=here, radius=100)[0])
car.set_autopilot(True)
cam = world.spawn_actor(lib.find("sensor.camera.rgb"), valdrada.Transform(valdrada.Location(-6, 0, 3), valdrada.Rotation(pitch=-12)), attach_to=car)
cam.listen(lambda image: image.save_to_disk(f"_out/{image.frame:06d}.png"))
for _ in range(200):
    world.tick()
```

The examples of the three.js build (`quickstart.py`, `intersection_120_amsterdam.py`, `generate_traffic.py`,
`benchmark.py`, the tutorials) run as they are, within the sensor outputs listed below. [Getting
started](api/getting_started.md) and the [Python API reference](api/python_api.md) apply unchanged.
`world.wait_until_loaded()` returns once the core's cells are in and the renderer reports nothing pending.

## Differences from the three.js build

The simulation, the actors, the map queries and the API are the core's and therefore identical. What differs is what
the renderer draws and which sensor outputs it serves.

| | three.js build | Unreal Engine 5 build (this release) |
|---|---|---|
| RGB camera | yes | yes: Lumen, Nanite, virtual shadow maps, hardware ray tracing |
| Depth camera | yes | yes |
| Semantic segmentation | yes | yes, except the ground: roads, sidewalks and kerbs are one mesh and return the unlabelled class |
| Instance segmentation, boxes and poses | yes | not yet: the request is answered with `unsupported_output` |
| City | the five boroughs, streamed as 512 m tiles | the five boroughs: 1 km blocks of 128 m cells near the cameras, far chunks of 1 to 8 km beyond |
| Vehicles | the modelled fleet | the fleet's meshes for all 23 kinds, drawn rigid: wheels do not turn and lamps are not lit |
| Pedestrians | photoreal or procedural bodies | capsule stand-ins |
| Trains | the modelled sets | boxes of the cars' size |
| Time of day | day, golden, dusk, night | the same four; at night windows and lamp heads glow, but street lamps cast no light |
| Rain | drawn | not drawn |
| Platforms | Windows x64 (Electron), Linux | Linux x86-64; Windows x64 when built as in the [build guide](ue-client-build.md#windows) |

## Problems

| Problem | Fix |
|---|---|
| `port 2000 is in use` | Another server runs: stop it, or start with `--port 2001` and connect to that port |
| The renderer exits at once on Linux | Install the NVIDIA driver's Vulkan component (`vulkaninfo` lists the GPU); see `logs/renderer.out` and `logs/renderer.log` |
| Sensors answer `needs_renderer` | The renderer is not connected: `logs/core.log` names each renderer that attaches; see the renderer's logs, or start without `--core-only` |
| Sensors answer `unsupported_output` | The output is not served by this renderer yet (see the table above) |
| A download keeps failing its check | Run the script again: it resumes and fetches failed files anew; `--mirror huggingface` uses the other copy |

## Licensing

The renderer in `renderer/` is built with Unreal Engine and is distributed in object code under the Unreal Engine End
User License Agreement (<https://www.unrealengine.com/eula>); `UNREAL_ENGINE_NOTICE.md` in the package holds the notice
the agreement asks for. The repository's code, including the launcher, the core and the renderer's source, is MIT
licensed; the compiled city and the models keep the licences listed in [LICENSING.md](licensing.md).
