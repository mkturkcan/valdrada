# Building the Unreal Engine 5 client

This guide builds [ValdradaUE](ue-client.md) from the repository: the renderer application for Linux and Windows,
its cooked content, the core bundle, and the release files that `fetch_valdrada_ue.py` downloads. Users of the
release need none of it. The reference machine is the development server: Ubuntu 22.04, 128 hardware threads, about
1 TB of RAM, three NVIDIA RTX 6000 Ada GPUs and Unreal Engine 5.8.3 built from source. Every time and size below was
measured there unless it says otherwise.

## What is built

| Part | Source | Built by |
|---|---|---|
| The core | `core/`, `tools/core/serve.mjs`, the client's simulation modules in `client/src/`, the compiled tiles | `ue_client/packaging/core_bundle.py` (copies files; nothing is compiled) |
| The renderer | `ue_client/ValdradaUE/`: the game module and the plugins `ValdradaRender` (the render protocol, actor pools, sensors) and `ValdradaCells` (the cells' kit instances) | Unreal Build Tool and BuildCookRun (`build_linux.sh`, `package_linux.sh`, `windows/package_windows.ps1`) |
| The city's content | the Unreal packages of the city build: `/Game/CCB` (1 km blocks), `/Game/CF` (far chunks), `/Game/Kit`, `/Game/Lib`, `/Game/MatLib`, `/Game/Tex`, `/Game/Bx`, `/Game/Client` | `tools/ue/city_build.py`, then cooked with the renderer |
| The city manifest, the class table and the kit tables | `ue_client/ValdradaUE/Data/city.json` (which level draws each block and far chunk, which table each 128 m cell assembles), `Data/classes.json` (the segmentation class of each block mesh) and the `.vcel` tables city.json names | `ue_client/ValdradaUE/Tools/make_manifests.py`; the tables are written by the city build |
| The release files | all of the above | `ue_client/packaging/ue_release.py` |

## Requirements

| Component | Linux | Windows |
|---|---|---|
| Engine | Unreal Engine 5.8.3 built from source | Unreal Engine 5.8.3 from the Epic Games Launcher, or built from source |
| Compiler | the engine's own clang toolchain, installed by `Setup.sh` | Visual Studio 2022 17.14 (MSVC 14.44.35211 or later) or Visual Studio 2026 18 (MSVC 14.50.35723 or later); Windows SDK 10.0.22621.0 |
| Memory | the compiles run 32 parallel actions by default (`VUE_JOBS`); the cook's peak is given below | as on Linux |
| Disk | the engine built from source, 558 GiB with its intermediates; 177 GiB for a Shipping release (cooked files 108, project intermediates 14, staging 26, archive 26, release files 3 beyond the archive's, which are hard links), 237 GiB with the Development package too; the city build's content besides | the engine, and the content and outputs as on Linux |
| Tools | Python 3.8 or later, `xz`, `tar` | Python 3.8 or later, PowerShell 5.1 or later |

The compiler versions are the engine's: its `Engine/Config/Windows/Windows_SDK.json` lists the preferred and banned
MSVC versions and the suggested Visual Studio components; `ue_client/packaging/windows/ValdradaUE.vsconfig`
holds those components for the Visual Studio Installer's "Import configuration".

## The engine

**Linux.** Build the engine from source as described in [Rendering in Unreal Engine 5](unreal.md#get-unreal-engine-58)
(clone the `5.8.3-release` branch, `Setup.sh`, `GenerateProjectFiles.sh`, `make UnrealEditor`, then the helper
targets one at a time). The editor build took 16 minutes on the reference machine. Set `UE_ROOT` to the engine
folder. Unreal Build Tool runs one instance per engine: every script here passes `-WaitMutex`, so a build waits for
another one instead of failing.

**Windows.** Either install Unreal Engine 5.8 from the Epic Games Launcher (Library, Engine Versions, add 5.8, with
the Windows target platform in its options) or build it from source with `Setup.bat`,
`GenerateProjectFiles.bat` and the `UnrealEditor` target in Visual Studio (Development Editor, Win64). A launcher engine
compiles only the project and its plugins and links the engine's precompiled libraries, which saves the engine build;
it cannot build a target that changes the engine's build environment (for instance a Shipping build with logging), for
which a source build is needed.

## The city's content

The renderer draws the city build of [The whole city](unreal.md#the-whole-city): every 128 m cell of the five-borough
compile baked headless, merged into one package per 1 km block, plus the far library. `tools/ue/city_build.py` makes it
in the Unreal project `client/tools/ar34/export/ue_project`:

```bash
UE_V2=1 UE_CITY_DIR=<cache>/city_v2 UE_BAKE_NAME=cityv2 python3 tools/ue/city_build.py run --pages 6
python3 ue_client/ValdradaUE/Tools/make_manifests.py --city <cache>/city_v2      # Data/city.json, Data/classes.json
python3 ue_client/ValdradaUE/Tools/make_tiers.py        # Data/tiers.json, the four graphics tiers
python3 ue_client/ValdradaUE/Tools/cook_list.py         # the cook takes only the levels city.json names
```

The first build of the five boroughs took 11 h 20 min on the reference machine (56,819 cells baked on three GPUs,
981 block packages, 1,958 far packages). `ue_client/ValdradaUE/Content` must then hold that project's packages: on
the development machine it is a symbolic link to the city build's `Content/`. `make_manifests.py` lists only levels and
tables that exist; the current city names 981 block levels, 3,682 far levels and 56,582 kit tables (15.46 GB of
`.vcel` files).
The project's `Content/` keeps every earlier build of a block and far package beside the current one (for 0.6.0, 401
stale block levels and 4,242 stale far packages); `cook_list.py` writes the levels of `Data/city.json` into the "Map"
primary asset type of `Config/DefaultGame.ini` as specific assets, so the cook takes those alone (0.6.0: 981 block and
3,651 far levels).

A Windows machine needs the same uncooked packages under `ue_client\ValdradaUE\Content`, as a real folder.
`export_content.py` lists exactly the packages the last Linux cook cooked (no stale levels of the city build) and packs
them for the transfer:

```bash
python3 ue_client/packaging/export_content.py --tar ValdradaUE-content.tar     # on Linux, after package_linux.sh
```

```powershell
tar -xf ValdradaUE-content.tar -C ue_client\ValdradaUE\Content                   # on Windows (tar.exe ships with Windows 10 and 11)
```

For the current city that is 204,380 files and 24.60 GB (the cooked set's sources; the city build's folders hold more,
older levels included).

## Packaging settings

`ue_client/packaging/config/DefaultGame.packaging.ini` is the block of packaging settings appended to the project's
`Config/DefaultGame.ini`; the packaging scripts refuse to cook without its marker line. What it sets, and why:

**IoStore containers in partitions.** The content is cooked into IoStore containers (`.utoc` and `.ucas`, with a small
`.pak` per chunk for the files that are not packages), Oodle compressed, without the Zen store so that the cooked files
can be measured and deleted. `MaxIoStorePartitionSizeMB=1900` cuts every `.ucas` into files of at most 1,900 MB
(`pakchunk1-Linux.ucas`, `pakchunk1-Linux_s1.ucas`, ...), which the engine mounts as one container. Every file then
fits GitHub's 2 GiB limit per release asset (and Hugging Face's 50 GB limit per file) and is downloaded as it is, with
no assembly step. One package larger than the partition size stops the packaging with "Chunk is too large"; no package
of the city comes near 1,900 MB.

**Chunks by folder.** The asset manager assigns the levels to chunks by folder: chunk 0 holds the engine, the client's
maps and everything the city shares (`MatLib`, `Tex`, `Kit`, `Lib`, `Bx`: a primary asset type of priority 100, so a
package that several chunks reference is stored once, in chunk 0), chunk 1 the near city's blocks (`/Game/CCB`) and
chunk 2 the far city (`/Game/CF`).

**What is cooked.** The client streams its levels by name from `Data/city.json`, so no package references them, and
the cooker lists only `.uasset` files in `DirectoriesToAlwaysCook`, never maps. The levels are therefore primary assets
of the type `Map` with the cook rule `AlwaysCook`, a type that must not be editor-only (the asset manager cooks no
editor-only type). The folders the renderer loads from by path at run time are cooked whole: `/Game/Kit` and `/Game/Lib`
(the parts the kit tables name), `/Game/Client` (the fleet's meshes), `/Game/Bx` (the film material and the night
parameters), and from the engine `/Engine/EngineSky/VolumetricClouds` (the cloud material) and `/Engine/BasicShapes` (the
stand-ins for walkers and trains).

Three engine behaviours were found on a throwaway C++ project before the settings were applied to ValdradaUE, and the
scripts work round them: the cooker writes the chunk manifests with Windows path separators, which BuildCookRun on a
Linux host matches against no staged file (every package then lands in `pakchunk0`), so `package_linux.sh` cooks,
rewrites `Metadata/ChunkManifest/pakchunk*.txt` with forward slashes and stages with `-skipcook`; commandlets ignore the
engine's percentage of shader compile threads to leave free, so the scripts pass an absolute count
(`NumUnusedShaderCompilingThreads`, half the hardware threads by default, `VUE_SCW_UNUSED`); and BuildCookRun writes its
logs under `~/Library/Logs` on Linux unless `uebp_LogFolder` is set, which the scripts point at their output folder.

## Linux

```bash
export UE_ROOT=~/UE_5.8
bash ue_client/packaging/build_linux.sh                  # the editor target, then the game in Development and Shipping
VUE_COOK_PROCESSES=4 VUE_COOK_MAX_USED_MB=60000 \
bash ue_client/packaging/package_linux.sh Shipping       # cook, stage, IoStore, package, archive
bash ue_client/packaging/package_linux.sh Development --stage-only   # with logging and the console, from the same cook
```

`build_linux.sh` builds the editor target (the cook loads the project's modules into the editor) with
`-NoEngineChanges`, then the game target, which is monolithic: its first build compiles the engine's runtime modules
into the project's `Intermediate/Build/Linux/x64/ValdradaUE` (11 GiB for Development and Shipping), and later builds
compile only what changed. `package_linux.sh` refuses to start when less memory is
available than `VUE_MIN_FREE_GB` (150 GB by default), writes UAT's log to `out/logs/package_<Config>_<time>.log` and
the cook's and UnrealPak's logs to `out/logs/uat_<Config>_<time>/`, and records every stage's time in `out/times.tsv`
and the sizes in `out/package_<Config>.json`. The packaged application lands in `out/archive/<Config>/Linux/`. The cooked
files (`ValdradaUE/Saved/Cooked/Linux`) stay for the next package of the other configuration; `--clean` deletes them
and the staging folder once the archive is copied out.

Measured on the reference machine:

| Stage | Throwaway C++ project (2 maps, 8 textures) | ValdradaUE |
|---|---|---|
| Editor target | 15 s | 23 s |
| Game target, Development, first build (engine runtime modules, 957 actions at 32 parallel) | 486 s | 483 s (958 actions) |
| Game target, Shipping, first build (920 actions) | 394 s | 443 s (921 actions) |
| Cook, first (global shaders for Vulkan SM6 included) | under 200 s | 495 s with four cook processes |
| Cook again (every cook is a full cook; the derived data is cached) | 17 s | 447 s |
| Stage, IoStore, package, archive | 10 s | 157 to 159 s (Development); 1,001 to 1,018 s (Shipping, whose distribution build compresses harder) |
| Cooked content | 0.55 GB | 114.06 GB (204,888 packages) |
| Packaged application | 1.01 GB (Development) | 31.10 GB (Development), 27.33 GB (Shipping) |

The city's cook runs best with several cook processes: one process cooked 2,256 packages in its first four minutes (about
2.5 a second, five cores busy), while four (`VUE_COOK_PROCESSES=4 VUE_COOK_MAX_USED_MB=60000`, a director and three
workers that share the packages) cooked all 204,888 in 495 s. Both ran with the derived data cache the city build had
filled (its meshes' Nanite data and its materials' Vulkan shaders); a machine with an empty cache builds those first.
During the cook the machine's available memory fell from 454 GB to 313 GB at its lowest (sampled every 30 s, with
other jobs running), which bounds what the four processes used; the director alone peaked at 42 GB resident.

The Shipping package's content is 27.0 GB in 26 files: chunk 0 (the engine, the client and the shared libraries) 1.42 GB,
chunk 1 (the near city) 18.37 GB in 11 partitions, chunk 2 (the far city) 7.23 GB in 5, the global container 3 MB. The largest file is a
1,900 MiB partition (1,992,287,280 bytes), so every file is a single GitHub release asset.

## Windows

Unreal Engine builds Windows applications only on Windows. The steps below produce `out\archive\Shipping\Windows\` on a
Windows machine; `ue_client\packaging\windows\package_windows.ps1` runs the build and package steps and checks the
prerequisites first.

1. Install Visual Studio 2022 17.14 or later with the components of `ue_client\packaging\windows\ValdradaUE.vsconfig`
   (Visual Studio Installer, More, Import configuration): the workloads "Desktop development with C++", "Game
   development with C++" and ".NET desktop development", MSVC 14.44 for x64, the Windows 11 SDK 10.0.22621.0, the .NET
   Framework 4.6.2 targeting pack, and the Unreal Engine IDE and debugger components.
2. Install Unreal Engine 5.8 (see [The engine](#the-engine)); note its folder, for instance `C:\Program Files\Epic
   Games\UE_5.8` or `C:\UE_5.8`.
3. Install Python 3.8 or later and Git, then clone the repository:
   `git clone https://github.com/mkturkcan/valdrada.git` and `cd valdrada`.
4. Put the city's content in `ue_client\ValdradaUE\Content` (see [The city's content](#the-citys-content)) and copy
   `ue_client\ValdradaUE\Data\city.json` from the Linux machine if the repository's copy is older than the content.
5. Check the setup: `powershell -ExecutionPolicy Bypass -File ue_client\packaging\windows\package_windows.ps1 -UERoot
   C:\UE_5.8 -CheckOnly`. It checks the engine version, Visual Studio and MSVC, the Windows SDK, the packaging block and
   the content folders.
6. Optional, to build or debug in the IDE: generate the Visual Studio solution with `"C:\UE_5.8\Engine\Build\BatchFiles\RunUBT.bat"
   -projectfiles -project="%CD%\ue_client\ValdradaUE\ValdradaUE.uproject" -game -progress` (or the .uproject's context
   menu, "Generate Visual Studio project files"). The script does not need it.
7. Build, cook and package: `powershell -ExecutionPolicy Bypass -File ue_client\packaging\windows\package_windows.ps1
   -UERoot C:\UE_5.8`. It builds `ValdradaUEEditor` (Win64, Development) and `ValdradaUE` (Win64, Shipping), then runs

   ```
   RunUAT.bat BuildCookRun -project=<repo>\ue_client\ValdradaUE\ValdradaUE.uproject -target=ValdradaUE -platform=Win64
       -clientconfig=Shipping -unattended -utf8output -nop4 -nocompileeditor -skipbuild -cook -manifests
   RunUAT.bat BuildCookRun ... -skipcook -stage -package -pak -iostore -compressed -manifests -prereqs -nodebuginfo
       -distribution -archive -archivedirectory=<repo>\ue_client\packaging\out\archive\Shipping
   ```

   and writes `out\package_Shipping.json` with the sizes. `-prereqs` stages the Visual C++ runtime installer, which the
   application's start program runs on machines without it.
8. Make the release files, either on the Windows machine
   (`python ue_client\packaging\ue_release.py --version <v> --platform win64 --app ue_client\packaging\out\archive\Shipping\Windows --core <core bundle> --out <release folder>`,
   with a core bundle made by `core_bundle.py --platform win64`) or, simpler, by copying `out\archive\Shipping\Windows`
   to the Linux machine and running the same command there, where the tables and the core's tiles already are.

What could not be verified on the development machine, which has no Windows: the PowerShell scripts (the packaging
script and the launcher) have not been run; the Windows cook's time and size; whether a launcher engine (5.8 with a
changelist other than the source build's) loads the city's packages without resaving (packages saved by an engine
build are readable by the same or a later build of 5.8, so a launcher 5.8.3 is expected to load them); and the
Direct3D 12 renderer's look against the Vulkan one. The Windows cook starts with an empty derived data cache, so it
also builds every Nanite mesh and compiles every shader for Direct3D 12; on the reference machine the warm Linux cook
of the same content took 495 s with four cook processes.

## The core bundle

```bash
python3 ue_client/packaging/core_bundle.py --platform linux --out out/core_linux --node-local <node-v24.19.0-linux-x64>
python3 ue_client/packaging/core_bundle.py --platform win64 --out out/core_win64        # downloads node-v24.19.0-win-x64.zip
```

The bundle is the files the core loads and reads, in the repository's layout, with a Node runtime: the list comes from
a trace of the core serving the Python examples (240 modules, the tiles, the fleet's `.glb` files for their dimensions,
the crowd's manifests). Whole folders are copied where the core reads by computed paths (every tile, `data/`,
`fonts/`, `client/src/`), so that any place in the city works. It also holds the cell and far-chunk indices of the city
build the content was cooked from (`app/cellcache/`), which the launcher passes to the core in `VALDRADA_CELLCACHE`.
Node's archive is checked against the `SHASUMS256.txt` of its release. Measured for Linux: 5,530 files and 3,707 MB
(tiles 3,290 MB, the fleet's models 160 MB, Node 126 MB, the rest 131 MB), assembled in 5 s; the `tar.xz` of it is 737 MB
(42 s with `xz -T32`) and unpacks with Python's `tarfile` in 40 s. Run from the bundle in a clean environment, the core
opened no file outside it.

## Release files

```bash
python3 ue_client/packaging/ue_release.py --version <v> --platform linux --app out/archive/Shipping/Linux --core out/core_linux --out out/release/<v>
python3 ue_client/packaging/ue_release.py --version <v> --platform win64 --app <copied archive>/Windows --core out/core_win64 --out out/release/<v>
```

`ue_release.py` writes, for one platform, the base archive (the launcher, the README and licences, the Python package,
`fetch_valdrada_ue.py` and the renderer without its content), the core archive, every content file as it is, the kit
tables named by `city.json` as one `tar.xz` shared by both platforms (15.46 GB of tables in 1,828 MB, 72 s), the
manifest and the checksums. A file over the part size (1,900 MiB) would be published in byte-range parts, which
`fetch_valdrada_ue.py` joins and checks; with the IoStore partitions none is. A run that finds an archive's inputs
unchanged keeps it.

`fetch_valdrada_ue.py` was checked end to end against a release of the throwaway project with the real core and tables
(18 files, 3.14 GB): downloaded through `file://` URLs, checked, unpacked and installed in 183 s; `--verify` passed; the
launcher then started the core from the installed folder (ready in 3.8 s) and stopped it and the renderer on Ctrl+C
and when the renderer was killed. The Linux release of ValdradaUE itself (29 files, 29.68 GB, staged by `ue_release.py` in 108 s) was installed
with `--from-dir` in 186 s (46.5 GB) and run through the launcher on one RTX 6000 Ada: the Shipping renderer attached
to the core, loaded the cells round W 120th St and Amsterdam Ave in 58.5 s and returned RGB and depth frames from a
Python client at 0.25 s a tick (1280 × 720), with 13.1 GB resident and 15.3 GB of GPU memory.

To check a staged release as a user gets it, install it from the release folder and run it:

```bash
python3 out/release/<v>/fetch_valdrada_ue.py --version <v> --from-dir out/release/<v> --dest ~/vue_check
~/vue_check/ValdradaUE.sh --offscreen &
python3 ue_client/packaging/smoke_test.py --package ~/vue_check --port 2000 --out smoke/
kill %1
```

`smoke_test.py` loads two places, renders RGB and depth frames, saves the RGB ones and fails on a missing or black frame.

## Publishing

Where each file lives: the GitHub release `v<version>` of `mkturkcan/valdrada` holds every file (each under 2 GiB, which
the IoStore partitions guarantee), next to the three.js build's archives; the Hugging Face dataset
`mehmetkeremturkcan/valdrada-ue` mirrors them flat, one tag per version, for `fetch_valdrada_ue.py --mirror
huggingface`. The release chain's step `release_bx/ue_publish.sh` uploads both after the main chain's `publish.sh`:

```bash
UE_VERSION=<v> UE_REL=ue_client/packaging/out/release/<v> bash release_bx/ue_publish.sh --dry-run
UE_VERSION=<v> UE_REL=ue_client/packaging/out/release/<v> UE_PUBLISH_CONFIRM=yes bash release_bx/ue_publish.sh
```

Its steps are `preflight` (every file present, under 2 GiB and matching its SHA256, no forbidden text, the logins),
`ghupload` (the assets, four at a time with `--clobber`; a missing release is created as a draft), `hfrepo` (creates the
dataset, private unless `HF_UE_PUBLIC=1`), `hfupload` (the files that are missing or differ, in commits of eight),
`hfverify` and `hftag`. A finished step is skipped on the next run; without `--dry-run` the script refuses to run unless
`UE_PUBLISH_CONFIRM=yes` is set.

## Licensing

The packaged renderer contains Unreal Engine code and is distributed in object code under the Unreal Engine End User
License Agreement (<https://www.unrealengine.com/eula>), which also asks for the notice that `UNREAL_ENGINE_NOTICE.md`
carries in every package. The agreement does not cover the editor or the engine's source, which are never
distributed. The repository's code, including `ue_client/` and the packaging scripts, stays MIT; the compiled city
and the models keep the licences of [LICENSING.md](licensing.md).
