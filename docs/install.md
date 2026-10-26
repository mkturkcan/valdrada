# Installation

This guide covers what Valdrada needs, how to install it on Windows and on Linux, how to run it on a Linux server
without a display, the errors people meet most often, and how to build the release archive. For the shortest path to a
first frame, see the [quick start](quickstart.md).

## Requirements

| Component | Requirement |
|---|---|
| GPU | WebGL2 through Direct3D 11 (Windows) or Vulkan (Linux); a discrete GPU is recommended. The server used about 3 GB of GPU memory at 1280 × 720. Tested on an NVIDIA RTX 3060 Laptop GPU (Windows 11) and an RTX 6000 Ada (Ubuntu 22.04) |
| Driver | A current vendor driver. On Linux the NVIDIA driver must provide its Vulkan ICD (tested with driver 580) |
| Memory | 16 GB of RAM; the page's JavaScript heap may grow to 8 GB |
| Disk | Release archives 2.5 GB, 5.9 GB extracted. Source checkout with the downloaded tiles, models and textures 3.8 GB more; compiling the tiles needs about 2.4 GB of raw downloads |
| Node.js | 22.12 or later with npm, for a source checkout and for the Linux server (tested with 24.19) |
| Python | 3.8 or later for the `valdrada` package; `numpy` is optional and used by most examples |
| Downloads | `huggingface_hub` 1.0 or later for the `hf` command: `pip install -U "huggingface_hub>=1.0"` |

The Python package has no required dependencies and runs on any machine that can reach the server over TCP.

## Windows

**Release.** Download `Valdrada-0.6.0-win64.zip`, `Valdrada-0.6.0-win64-tiles.zip`,
`Valdrada-0.6.0-win64-terrain1.zip` and `Valdrada-0.6.0-win64-terrain2.zip` from the
[releases page](https://github.com/mkturkcan/valdrada/releases) and extract them into the same place: all hold the
folder `Valdrada_0.6.0_win64`, the second only its `Content/tiles/` and the last two only its `Content/data/terrain_p1/`
(the measured ground, read with `?terrain=p1`; the server runs without them). The folder contains:

| Path | Contents |
|---|---|
| `Valdrada.exe` | the server: a window, or no window with `--headless`; TCP API on port 2000 |
| `StartServer.bat`, `StartServer_Headless.bat` | launchers that pass their arguments on to `Valdrada.exe` |
| `Content/` | the built client and the compiled city |
| `PythonAPI/` | the `valdrada` package (source and wheel) and the examples |
| `Docs/` | getting started, the Python API reference and the wire protocol |

Start the server by double-clicking `StartServer.bat`, or from a terminal with options:

```
Valdrada.exe --port 2000 --res 1280x720 --time day --pedestrians procedural
```

Install the Python package from the same folder:

```
pip install PythonAPI\dist\valdrada-0.1.0-py3-none-any.whl numpy
```

On laptops with two GPUs the server requests the discrete one. If Windows asks whether `Valdrada.exe` may use the
network, local connections work without allowing it; allow it only to accept clients from other machines
(`--host 0.0.0.0`).

**Source.** Install [Node.js](https://nodejs.org/) 22.12 or later and [Git for Windows](https://git-scm.com/), then
follow option B of the [quick start](quickstart.md) in Git Bash.

## Linux

The release archive contains a Windows executable only. On Linux the server runs from a source checkout: npm installs
the Electron runtime, which loads either the release's built `Content/` or a development server.

```bash
git clone https://github.com/mkturkcan/valdrada.git
cd valdrada
(cd server && npm install)
ls server/node_modules/electron/dist/electron        # the runtime; if missing: (cd server && node node_modules/electron/install.js)
pip install -U "huggingface_hub>=1.0"
hf download mehmetkeremturkcan/valdrada --repo-type dataset --revision v0.6.0 --include "Content/*" --local-dir .
cd server
env -u ELECTRON_RUN_AS_NODE npx electron . --content ../Content
```

The arguments after `.` are the server's options (port, resolution, time of day; see below) and Chromium flags.
To work on the code instead, install the client as in option B of the quick start and pass
`--dev-url=http://127.0.0.1:5219` instead of `--content ../Content`.

## Running headless on a Linux server

A server without a display runs the same command with Chromium's headless platform and ANGLE on Vulkan. The GPU
still renders every frame.

```bash
cd server
nohup env -u ELECTRON_RUN_AS_NODE npx electron . --content ../Content --headless \
    --ozone-platform=headless --use-angle=vulkan --enable-features=Vulkan \
    --port 2000 --res 1280x720 --pedestrians procedural > server.log 2>&1 &
```

What you should see in `server.log`: `listening on 127.0.0.1:2000` at once, then
`world ready in 52.9 s (api 0.1.0)` or similar. A line `vkCreateInstance() failed: -7` may appear before it; it is
harmless when the check below names your GPU. To confirm that the GPU renders:

```bash
python -c "import valdrada; print(valdrada.Client('127.0.0.1', 2000).get_server_info()['gpu'])"
```

The answer should name the GPU, for example `ANGLE (NVIDIA, Vulkan 1.4.312 (NVIDIA NVIDIA RTX 6000 Ada Generation ...))`.
`SwiftShader` means the page fell back to software rendering, which works but is far too slow for data collection;
check the driver's Vulkan support (`vulkaninfo --summary`).

**Choosing a GPU.** On a machine with several GPUs, Chromium takes the first Vulkan device in the list of the Mesa
device-select layer. `DRI_PRIME` with the PCI address of a GPU puts that GPU first:

```bash
nvidia-smi --query-gpu=index,pci.bus_id --format=csv,noheader     # e.g. "0, 00000000:01:00.0"
DRI_PRIME=pci-0000_01_00_0 nohup env -u ELECTRON_RUN_AS_NODE npx electron . --content ../Content --headless \
    --ozone-platform=headless --use-angle=vulkan --enable-features=Vulkan --port 2000 > server.log 2>&1 &
```

Several servers can share a machine with different `--port` values, one GPU each.

**Clients on other machines.** The API has no authentication. Prefer an SSH tunnel from the client machine,
`ssh -N -L 2000:127.0.0.1:2000 user@server`, and connect to `127.0.0.1:2000`. `--host 0.0.0.0` accepts connections
from any address and is only for trusted networks.

**Stopping.** `kill <pid>` with the process id that `nohup` printed (or `pgrep -af "electron . --content"`).

## Server options

| Option | Default | Meaning |
|---|---|---|
| `--port`, `--host` | 2000, 127.0.0.1 | the API socket |
| `--res WxH` | 1280x720 | render size, and the size of every RGB camera |
| `--time` | day | `day`, `golden`, `dusk` or `night` at start |
| `--quality` | high | `medium` renders cheaper frames |
| `--start-lat`, `--start-lon` | 40.80955, -73.95905 | where the city streams in first (W 120th St and Amsterdam Ave) |
| `--pedestrians` | photoreal | `procedural` uses the built-in pedestrians. Use it for datasets and for training or testing models: the photoreal set contains MetaHuman-derived components whose licence forbids those uses ([licensing](licensing.md)) |
| `--headless` | off | no window |
| `--content DIR` | `Content/` next to the executable | the built client and the city to serve |
| `--dev-url=URL` | | load the client from a development server; a URL must use the `=` form |
| `--log FILE`, `--verbose` | | write the server log to a file; print the page's messages |

## Common errors

| Symptom | Cause and fix |
|---|---|
| `ConnectionError: no Valdrada server on 127.0.0.1:2000` | The server is not running, listens on another port, or a firewall blocks the port. Check the server log for `listening on`. |
| `TimeoutError: the server did not finish loading within 300 s` | The first start compiles shaders; start the client again once the server log shows `world ready`. If it never does, check the GPU (see above) and run with `--verbose`. |
| Electron prints Node.js output or exits at once | `ELECTRON_RUN_AS_NODE` is set in the environment (some editors set it in their terminals). Start with `env -u ELECTRON_RUN_AS_NODE` (Linux, Git Bash) or `set ELECTRON_RUN_AS_NODE=` first (Windows `cmd`); the release launchers clear it. |
| `server/node_modules/electron/dist/` is missing after `npm install` | npm skipped Electron's install script: run `node node_modules/electron/install.js` in `server/`. |
| Electron exits with an error about a missing shared library | Install the system package that provides that library (the usual Chromium runtime libraries). |
| The server window shows the wrong page, or `--dev-url` is ignored | The URL was passed as `--dev-url http://...`; Chromium opens a bare URL as a page. Use `--dev-url=http://127.0.0.1:5219`. |
| `KeyError: "no blueprint 'walker.pedestrian.0003'"` | The server runs with `--pedestrians procedural`, which has one walker blueprint. Pick walkers with `lib.filter("walker.pedestrian.*")`. |
| `TimeoutError: world.tick: no answer from the simulator within 60 s` | Many or large label cameras make a step slow. Raise the limit with `client.set_timeout(120.0)`. |
| `TypeError: float() argument must be a string or a real number, not 'NoneType'` right after `set_autopilot(True)` | A defect of the 0.2.0 server, fixed in 0.2.1: a vehicle spawned through the API lost its position when switched to autopilot. Use the 0.2.1 release or the current source; with 0.2.0, drive API vehicles with `apply_control`. |
| `hf: command not found` | `pip install -U "huggingface_hub>=1.0"`; older versions call the command `huggingface-cli`. |
| The client shows an empty city, the browser console lists 404s for `/tiles/` | The tiles, models and textures are not in `client/public/`: repeat the download and the `mv` of option B. |
| `JavaScript heap out of memory` while compiling the tiles | Give Node more memory: `NODE_OPTIONS=--max-old-space-size=24576 npm run compile -- --boro 1,2,3,4,5` (the five-borough compile peaks at 17.7 GB resident). |
| `Address already in use` | Another server holds the port: pick another with `--port`. |

## Building the release archive

`server/build.mjs` assembles the release folder: it packages the Electron server, runs the production build of the
client into `Content/` with every runtime asset, copies `PythonAPI/` and builds its wheel when `uv` is installed, and
writes the launchers, `Docs/` and the legal files. It needs the compiled tiles in `client/public/tiles/`,
`npm install` in the top folder, `client/` and `server/`, and access to github.com, from which the packager
downloads the Electron runtime of the target platform.

```bash
node server/build.mjs --platform win32 --link --zip
```

| Option | Effect |
|---|---|
| `--platform win32` or `linux` | the target; `linux` builds a Linux x64 server, which has not been tested for a release |
| `--link` | hardlink `Content/` instead of copying it (same volume only) |
| `--skip-content` | keep `Content/` from the previous build |
| `--zip` | also write `release/Valdrada-<version>-<platform>.zip` |
| `--out DIR` | the output directory (default `release/`) |

For 0.6.0 the folder held 10,191 files (10.4 GB) and one archive of it was 4,113.9 MiB, over the 2 GiB that
GitHub accepts for a release asset, so the release is published as four archives: the second holds `Content/tiles/` and
the third and fourth `Content/data/terrain_p1/`. To check a Windows build on Linux, serve its `Content/` with the
Linux runtime, as in the headless section, and run an example against it.
