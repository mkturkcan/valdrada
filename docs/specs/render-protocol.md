# Render protocol (valdrada.render/0, 2026-10-11)

What a renderer client (the three.js build, the Unreal plugin, later Blender) implements so that the headless core can
answer the Python API's sensors. The core simulates and serves docs/api/protocol.md (`tools/core/serve.mjs`,
`core/api/`); it draws nothing. A renderer holds the city's packages, draws the core's state at a tick from the cameras
the core names, and returns pixels and labels, which the core hands to the Python client as the protocol's `sensor`
events. The Python API does not change. Everything below is drawn from what `client/src/api/bridge.js` does inside the
page today, where simulation, API and renderer share one process.

Until a renderer is attached the core answers `sensor.listen` with the error `needs_renderer`; sensors can still be
spawned, attached and moved (their poses are the core's).

## 1. Roles

| | the core | a renderer client |
|---|---|---|
| owns | the simulation (traffic, walkers, signals, trains, boats, API actors and their bodies), the clock, the actor table, the API, the streaming manager's decisions | the packages (cells, chunks, landmarks), materials per tier, the frame, its temporal history (TAA), the culls and levels of detail it draws |
| never | loads a mesh or draws | creates, moves or reclassifies content; runs a simulation step |
| per tick | steps, then sends the state and the captures due | draws the state exactly (no extrapolation), returns the captures |

One core serves any number of Python clients and at most one renderer per sensor group (section 5); a second
renderer may serve other groups (a three.js window for the spectator, Unreal for a cinematic camera).

## 2. Transport and handshake

The framing of docs/api/protocol.md (`[u32 big-endian length N][u8 kind][N-1 bytes]`, kind 1 JSON, kind 2 binary blob)
on the same port. A renderer identifies itself with its first request:

```json
-> {"id": 1, "method": "render.hello", "params": {"protocol": "valdrada.render/0", "renderer": "unreal", "version": "...",
    "outputs": ["rgb", "semantic", "instance", "depth", "labels"], "max_size": [3840, 2160], "tier": "cinematic", "amodal": true}}
<- {"id": 1, "result": {"protocol": "valdrada.render/0", "api_version": "0.1.0", "geo_origin": {"lat": 40.7831, "lon": -73.9712},
    "frame": 1520, "timestamp": 76.0, "classes": [...], "vehicle_kinds": [...], "walker_variants": [...], "env": {...}, "load": {...}}}
```

`classes` is the segmentation table (`map.get_semantic_classes`: id, name, rgb, isthing; perception/segRender.js
`CLASS_ROWS`). `vehicle_kinds` and `walker_variants` are the asset keys the state's records index (the fleet's kinds,
docs/specs/actor-tracks.md `vehicleKinds`; the crowd's variants, models/peds24 manifests). After the hello the core
pushes `render.*` events to the renderer and the renderer answers captures with requests of its own (sections 4-6).
The renderer's frame of reference is the tiles': metres, x east, y up, z south.

## 3. Load sets

The core's streaming manager (`core/streaming/stream.mjs`, docs/specs/load-set.md) decides what is resident and drawn
round the cameras: the API's view and every listening camera. On every change:

```json
<- {"event": "render.load", "frame": 1520, "centre": [x, y, z], "tier": "high",
    "cells": ["8_-23", ...], "chunks": ["L4_3_-12", ...], "fading": [["L5_1_-6", 0.4, 1]], "landmarks": [...], "tiles": ["2_-6", ...]}
-> {"id": 7, "method": "render.loaded", "params": {"frame": 1520, "pending": 0, "resident": {"cells": 49, "chunks": 212}}}
```

The keys and the fade rule are load-set.md's. `tiles` is the near ring the page's streamer holds today (512 m tiles
round the spectator), for a renderer that still draws tiles. `world.wait_until_loaded` answers once the core's ring is
in and every attached renderer reports `pending` 0 for 10 consecutive frames (bridge.js: streamer idle, the dresser
queue empty, the ring unchanged, the tile under the spectator ready).

## 4. Per-tick state

After every step (`world.tick`, a `world.wait_until_loaded` frame, an asynchronous frame) the core sends the state the
renderer draws:

```json
<- {"event": "render.state", "frame": 1521, "timestamp": 76.05, "dt": 0.05,
    "env": {"time_of_day": "night", "night": 1.0, "rain": 0.4, "clock": 76.05},
    "view": {"pos": [x, y, z], "quat": [qx, qy, qz, qw], "fov_y_deg": 58.7, "aspect": 1.7778},
    "actors": {"add": [...], "remove": [...]}, "blobs": 1}
<- [blob: one ATRK v1 frame block]
```

- The blob is one frame block of docs/specs/actor-tracks.md: every vehicle (52 bytes: pose, speed, wheel spin,
  steering, bend, lamps, kind), walker (44 bytes: pose, yaw, gait phase, amplitude, pace), signal state byte and train
  car (72 bytes) the renderer may draw, API actors included. `actors.add` carries the static fields of actors first
  seen this tick, as the take header's `actors` does (a vehicle's seed, paint and finish; a walker's variant, outfit
  bits, tint, speed and phase0; a train car's key), and the parked vehicles and signal heads when they enter the ring;
  `actors.remove` the ids that left. A take is these states recorded, so a renderer that replays takes already reads
  this.
- `env.clock` is the shared shader and closed-form clock (world/materials.js `ENV.time`): the Lake's boats, the
  fountains and the water are functions of it, and the renderer evaluates them itself (tools/core/tracks_to_boats.mjs
  shows they reproduce the page's to 0.1 mm). `night` is world/sky.js's night factor (lamps, windows, headlamps);
  `time_of_day` and `rain` are `world.set_weather`'s.
- `view` is what bridge.js `viewPose` renders in the server window: the primary camera (section 5) at the window's
  shape, else the spectator. A renderer with a window shows it.
- Ids are the core's; a road user drawn by a renderer carries its id so labels can name it (bridge.js keys
  `veh:<kind>:api<id>` and `ped:api<id>` for API actors, the take's actor ids for the rest).

## 5. Sensor requests

When listening sensors are due at a tick (`sensor_tick` 0: every tick; else when `timestamp - last >= sensor_tick`),
the core sends one capture per group after that tick's state. A group is the sensors that share a pose: the same
parent, relative transform, horizontal fov and image size (bridge.js `runSensors`).

```json
<- {"event": "render.capture", "frame": 1521, "timestamp": 76.05, "capture": 33, "primary": true,
    "sensors": [110, 111], "outputs": ["rgb", "semantic"], "width": 1280, "height": 720, "fov": 90,
    "transform": {"location": {...}, "rotation": {...}},
    "camera": {"pos": [x, y, z], "quat": [qx, qy, qz, qw], "fov_y_deg": 58.72, "aspect": 1.7778, "near": 0.4, "far": 20000},
    "amodal": 0, "min_pixels": 30}
```

- `transform` is the group's pose in the API frame (x east, y north, z up; attachments composed onto the parent as
  protocol.md says); `camera` the same camera in the renderer's frame (bridge.js `poseFor`: `toThree`, `camQuat`, the
  vertical fov from the horizontal one at the image's aspect).
- The primary group is the view (the first listening RGB camera, else the first listening camera, else the first RGB
  camera, else the spectator). Its RGB is the tick's own frame; it goes first.
- Any other pose is a camera switch: the renderer's per-camera culls (instances, crowd, fleet levels) follow the capture
  camera for one frame of dt 0 before it draws (bridge.js needed it: labels read without it showed road users culled for
  the other camera); an RGB group renders with its own temporal history swapped in (each RGB camera converges as if it
  were the only one); a group without RGB renders its label passes without drawing the beauty frame.
- `outputs`: `rgb` (the beauty frame through the tier's full post chain), `semantic`, `instance`, `depth`, `labels`
  (boxes and poses); `amodal` > 0 also measures each thing's full box and occlusion.

## 6. Returns

The renderer answers each capture with one request and the output planes as blobs, in the order of `outputs`:

```json
-> {"id": 41, "method": "render.result", "params": {"capture": 33, "frame": 1521, "width": 1280, "height": 720,
    "outputs": ["rgb", "semantic"], "labels": null, "depth_max": null, "timing": {"rgb_ms": 4.1, "labels_ms": 0}}, "blobs": 2}
-> [blob: rgba8]  [blob: class_u8]
```

| output | blob (protocol.md formats, rows top to bottom) |
|---|---|
| `rgb` | `rgba8`: W x H x 4 |
| `semantic` | `class_u8`: one class id per pixel |
| `instance` | `instance_rgba8`: `code = r + g*256 + b*65536`, id = `code * 5029001 mod 2^24`, 0 for background and stuff |
| `depth` | `depth_f32` little-endian, metres along the view axis; `depth_max` in params marks pixels with no geometry |
| `labels` | no blob: `labels` in params |

`labels` = `{camera, instances, classes}` as the perception pass gives them (`camera`: K, fov_y_deg, aspect, near, far,
lonlat, pos, quat, yaw, pitch, roll; each instance: id, class_id, class, key, bbox, area, truncated, amodal_bbox and
occlusion when measured, and pose {pos, yaw, dims} in the renderer's frame). The core turns them into the protocol's
form (bridge.js `labelsOut`: `actor_id` from the key, `location`, `yaw`, `extent` in the API frame, `sensor_transform`),
then emits one `sensor` event per sensor of the group to the client that owns it, every event of a tick before that
tick's `world.tick` answer, and adds the timings to the tick's `timing.sensors`.

## 7. Asynchronous mode

The core free-runs on real time and sends `render.state` at its own rate; sensors fire on their own `sensor_tick`
clock (bridge.js `setAsync`). A renderer draws the latest state; captures carry the frame they were taken at.

## 8. Errors and versions

A renderer that cannot serve an output answers `render.result` with `{"error": {"code": "unsupported_output"}}` for that
capture; the core passes `needs_renderer` to the client when no attached renderer serves a sensor's outputs. Fields are
added, never repurposed; a breaking change bumps `valdrada.render/<n>`, and the hello names the version both sides
speak.

## 9. Where each part lives today

| protocol | in the page today (one process) | in the core |
|---|---|---|
| `render.state` | the sims write their instance storage; the frame draws it | core/sim/world.mjs step; the take recorder's records (core/tracks/recorder.mjs) |
| `render.load` | the page's streamer and dresser round `ApiCam.center`; `?lod16=1` the manager | core/world/streamer.mjs (tiles); core/streaming/stream.mjs (cells, chunks) |
| `render.capture` | bridge.js `dueSensors`, `primarySensor`, `poseFor`, the groups of `runSensors` | the same code: bridge.js runs in the core (core/api/session.mjs) |
| the primary RGB | `engine._grab` of the tick's own frame | |
| a camera switch | `cam.apply`, `swapView` (TAA history), `engine.skipDraw` | |
| `render.result` planes | perception/segRender.js `capture` (raw planes, labels), bridge.js `flipRows`, `classPlane`, `depthPlane` | |
| labels to API form | bridge.js `labelsOut`, `labelActor` | bridge.js (the core) |
| `needs_renderer` | | core/api/session.mjs |

So the three.js renderer client is the page with its own sims off, drawing `render.state` (its replay path for player
takes already places bodies from records, src/game/control.js `createReplay`) and serving `render.capture` with the
code above; the Unreal plugin implements the same messages over the socket.

## 10. Implementations (2026-10-17)

- The core: `core/api/render.mjs` (the hub: hello, state, load, capture, result; one per core process) behind
  `core/api/session.mjs`; `client/src/api/bridge.js` hands each sensor group to the attached renderer
  (`renderClientSensors`, one `render.capture` per group, the primary group first) and exposes the API frame and the
  listening cameras to the hub (`window.__API.clock`, `window.__API.cameras`). The state's records are the take
  recorder's (`core/tracks/recorder.mjs`, `core/tracks/format.mjs` `frameBlock`) over a region of 300 m round the view
  and every listening camera (`VALDRADA_RENDER_RADIUS`); API actors keep their API ids, the recorder's own start at
  1,000,000. The load sets are the streaming manager's at the renderer's tier, residency taken as immediate.
- Fields this version adds, as section 8 allows: `render.load` `seq` (echoed by `render.loaded`; an answer to an older
  load set is ignored) and `cells_missing` (grid cells lane A has not baked); `render.state` `signals` (the junctions
  whose state bytes the frame block carries, in that order, sent when the list changes); a parked vehicle's `actors.add`
  record `{id, type: "parked", kind, kind_index, x, y, z, q, seed, col, metal, grime, rough}`; the hello's answer `view`,
  `train_kinds` and `formats`; `render.capture` `exposure` `{mode: "auto" | "manual", compensation}` from the group's RGB
  camera (its attributes `exposure_mode` and `exposure_compensation`, EV).
- The Unreal renderer: `ue_client/ValdradaUE` (the plugin ValdradaRender; its notes are the plugin's sources).
  Since 0.5.1 it also reads fields of `render.capture` that the core does not send, used by the replay of a recorded take
  (`tools/core/replay.mjs`): `mode` (`lumen`, the default, or `pathtrace`, Unreal's path tracer in place of the raster
  frame), `spp` (the path tracer's samples a frame), `denoise` (its denoiser on the last sample, default true), `warm`
  (the frames rendered before the one read) and `burst` (those frames in one engine tick); and it serves two more
  outputs, `albedo` and `normal`, the guides of a denoiser run outside the renderer (`tools/core/oidn_worker.py`).
