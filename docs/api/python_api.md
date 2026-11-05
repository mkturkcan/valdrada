# `valdrada` Python API reference (0.1.0)

`pip install PythonAPI/dist/valdrada-0.1.0-py3-none-any.whl`. Pure Python 3.8+; numpy is optional (`to_numpy()`,
`instance_ids()`, `mask()`, depth as `.npy` or `.png`, `util.draw_boxes_rgb`). Modelled on CARLA's `carla` package: the
same objects and verbs, where the NYC simulator has them. The
[tutorials](https://mkturkcan.github.io/valdrada/tutorials/) show the API at work.

## Client

```python
client = valdrada.Client(host="127.0.0.1", port=2000, timeout=120.0)   # retries the connection for up to `timeout` s
client.set_timeout(seconds)
client.get_server_info()      # api_version, resolution, gpu, fps, frame, settings, geo origin
client.get_server_version(); client.get_client_version()
client.wait_until_ready(timeout=300)   # the first start compiles shaders: 1-2 minutes
world = client.get_world()             # waits for ready
client.close()                          # also a context manager: `with valdrada.Client() as client:`
```

## World

| call | what it does |
|---|---|
| `get_settings()` / `apply_settings(WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))` | Synchronous mode (default) advances only on `tick()`. Asynchronous mode runs on real time. |
| `tick(seconds=None) -> int` | One fixed step; returns the frame number. Every listening sensor that is due on this step has delivered its data before it returns. `seconds` bounds the wait for the answer (default: the client timeout). `world.last_tick["timing"]` breaks the milliseconds down. |
| `wait_until_loaded(timeout=180)` | Renders (time frozen) until the tiles and buildings around the spectator are in. |
| `get_snapshot()` | Frame, timestamp, and every API actor's transform and velocity. |
| `get_map()` | `Map` |
| `get_spectator()` | the viewpoint: where the city streams in, and the window's view when there is no camera |
| `get_blueprint_library()` | `BlueprintLibrary` (`find(id)`, `filter("vehicle.*")`) |
| `spawn_actor(bp, transform, attach_to=None)` / `try_spawn_actor(...)` | vehicles and walkers are set on the ground under `transform.location` |
| `get_actors(filter=None)` / `get_actor(id)` | `ActorList` / `Actor` |
| `set_weather(WeatherParameters(time_of_day, rain))` / `get_weather()` | `"day"`, `"golden"`, `"dusk"`, `"night"`; rain 0-1; presets `WeatherParameters.Day`, `.Golden`, `.Dusk`, `.Night`, `.RainyDay`, `.RainyNight` |
| `set_ambient_traffic(vehicles=None, walkers=None)` / `get_ambient_traffic()` | the background population kept around the spectator (620 / 520). 0 empties the streets. API actors are never counted or removed. |
| `get_traffic_light_state(heading)` | `TrafficLightState(state, time_left, cycle, axis)`. Every signal runs one 40 s cycle. |
| `get_semantic_classes()` | `[{id, name, rgb, isthing}]`, a Cityscapes-compatible table |
| `start_take(actor, name="api_take")` / `stop_take(path=None) -> dict` | Records the run of a vehicle or walker and the view on every tick as a take: 30 frames a second, each with the camera `[x, y, z, qx, qy, qz, qw, fov_y]` and the body `[x, y, z, heading, speed, flags]` in the client's internal frame (x east, y up, z south). `stop_take` returns it and writes it as JSON to `path`. A shot in `tools/ad/shots.json` that names a take is replayed by `tools/ad/record.mjs` and the offline export. |

## Blueprints

- `vehicle.<kind>`, 17 kinds of the NYC fleet: `taxi`, `taxi2` (the current TLC cab), `lincoln`, `suv`, `charger`,
  `impala`, `mercedes`, `mini`, `van`, `boxtruck`, `police`, `ambulance`, `minibus`, `firetruck`, `model3` (Tesla
  Model 3), `auditt` (Audi TT) and `mustang` (a 1966 Mustang convertible; in traffic it only stands parked). Attributes:
  `class`, `width`, `height`, `length`, `color` (`"r,g,b"`), `role_name`, and `capacity` (how many of that kind can
  exist at once; a spawn beyond it fails with `pool_full`).
- `walker.pedestrian.0000` .. `0036`: 37 outfits. Attributes: `name`, `gender`, `age`, `build`, `uniform`, `speed`,
  `outfit` (a bit mask: 1 coat, 2 hoodie, 4 backpack, 8 bag, 16 phone, 32 umbrella). These photoreal pedestrians contain
  MetaHuman-derived components, which may not be used to build or enhance a dataset or to train or test AI models
  (LICENSING.md). With the server option
  `--pedestrians procedural` the library instead holds one blueprint, `walker.pedestrian.procedural`, the built-in
  procedural pedestrian.
- `walker.pedestrian.0037` .. `0085`: 49 bodies from the Microsoft Rocketbox Avatar Library (MIT), with the same
  attributes; they walk the same clips as the outfits above. The server option `--pedestrians procedural` leaves them
  out.
- `controller.ai.walker`: attach to a walker. Attribute: `max_speed` (m/s, default 1.4).
- `sensor.camera.rgb`, `.semantic_segmentation`, `.instance_segmentation`, `.depth`, `.bounding_boxes`. Attributes:
  - `fov`: horizontal field of view in degrees; default 90.
  - `image_size_x` / `image_size_y`: label cameras; default the server's `--res`. RGB always renders at `--res`.
  - `sensor_tick`: seconds between frames; 0 (the default) means every tick.
  - `amodal`: how many of the largest objects also get an amodal box and an occlusion value. Each costs about 5 ms; default 0.
  - `min_pixels`: the smallest visible area, in pixels, that gets a label; default 30.
  - `exposure_mode` (`auto` or `manual`) and `exposure_compensation` (EV): the RGB camera's exposure; default `auto`, 0.
  - `render_mode`: `raster` (the default) or `pathtrace`, the RGB frame from the renderer's path tracer with
    `samples_per_pixel` samples (default 64), denoised; served by the Unreal Engine 5 client, the three.js build renders
    every frame by rasterisation.

  Cameras with the same parent, transform, `fov` and image size share one capture per tick.

## Actors

| class | calls |
|---|---|
| `Actor` | `id, type_id, parent, attributes, bounding_box, is_alive`, `get_transform()`, `get_location()`, `set_transform(t)`, `set_location(l)`, `get_velocity()`, `get_speed()`, `set_target_velocity(v)`, `destroy()` (also destroys the sensors and controllers attached to it) |
| `Vehicle` | `apply_control(VehicleControl(throttle, steer, brake, hand_brake, reverse))`, for a vehicle not on autopilot. `steer` > 0 turns right, up to 35° at the wheels. `get_control()`, `set_autopilot(True, route=["left", "straight", "right"])`: the traffic simulation drives it, with signals, car following and yielding to walkers, taking the listed turns at the next junctions (`off_road` if it is not within 12 m of a lane it may drive). `get_obstacle_ahead(max_distance=30, width=2.2)`: the nearest walker or vehicle in its path. Spawned with `role_name` `hero` (or `physics` `arcade`), it drives with the play mode's dynamics: the steering lock falls with speed (34° standing, about 5° at 30 m/s), the tyres' grip caps the yaw rate, and kerbs, buildings, street furniture, parked and moving cars and pedestrians stop it. |
| `Walker` | `apply_control(WalkerControl(direction, speed))`, with direction a world-frame vector and speed in m/s; it cancels an AI controller's route. Spawned with `role_name` `hero` (or `physics` `arcade`), it collides with buildings, street furniture and cars and steps up kerbs. |
| `Spectator` | `follow(actor, mode=None)`: the view rides the play mode's camera on a vehicle (`"chase"`, `"bonnet"`) or a walker (`"third"`, `"first"`); the streaming centre and any camera attached to the spectator move with it on every tick. `unfollow()` leaves the spectator where the camera was. |
| `WalkerAIController` | `start()`, `stop()`, `go_to_location(loc, direct=False) -> path` (`no_route` if there is none; `direct=True` walks a straight line), `set_max_speed(v)`, `get_state()` (`stopped`, `idle`, `walking`, `arrived`). Routes run over sidewalks and crosswalks; walkers wait at the kerb for a WALK long enough to cross and for no car in the way. |
| `Sensor` | `listen(callback)` (the callback runs on the network thread, before `tick()` returns), `stop()`, `is_listening` |

An attached actor follows its parent: its location offset (x forward, y left, z up) turns with the parent's yaw, its
yaw adds to the parent's, and its pitch and roll are its own. `get_transform()` of a sensor returns its world pose;
`set_transform()` of an attached sensor sets its offset.

## Sensor data

| class | from | notes |
|---|---|---|
| `Image` | rgb | `raw_data` RGBA; `to_numpy()` (H x W x 4); `save_to_disk(path, alpha=False)` (PNG) |
| `SemanticSegmentationImage` | semantic | class ids; `to_numpy()`; `colorize()` (palette RGB bytes); `save_to_disk(path, colorize=True)` (palette PNG, or the raw ids) |
| `InstanceSegmentationImage` | instance | `labels: [ObjectLabel]` (and everything `BoundingBoxes` has); `instance_ids()` (the decoded ids, 0 for background and stuff); `mask(label_or_id)`; `save_to_disk(path, labels=True)` (the instance codes as PNG, and the labels as JSON next to it) |
| `DepthImage` | depth | float32 metres along the camera's view axis; `depth_max` where there is no geometry (sky); `to_numpy()`, `to_array()`; `save_to_disk(path)`: by extension `.npy` or `.pfm` (exact), or `.png` (16-bit millimetres, saturating at 65.535 m) |
| `BoundingBoxes` | bounding_boxes | `labels`; `camera` (the intrinsics `K` and the renderer's view of the camera, see the wire protocol); `filter(classes=None, min_area=0, actors_only=False)`; `to_dict()`; `save_to_disk(path)` (JSON) |

`ObjectLabel` fields:

- `id`, `class_id`, `class_name`;
- `actor_id`: the API actor, or 0 for the background city;
- `bbox`: `[x, y, w, h]` in pixels from the top-left corner, around the visible pixels only;
- `area`: the number of visible pixels; `truncated`: the visible box touches the image border;
- `amodal_bbox`, `occlusion`: with `amodal > 0`, the box of the whole object including its occluded part, and
  1 - visible / amodal area;
- `location`, `yaw`, `extent`: the object's 3D pose in the world frame. `location` is the point on the ground below the
  object's centre, `extent` holds the half sizes (x along the heading, y across it, z up) and `yaw` the heading in
  degrees. Vehicles carry all three, pedestrians `location` and `extent`, trees and street furniture `location` alone,
  and buildings none of them.

Every sensor event also carries `frame`, `timestamp`, `transform` (the sensor's world pose), `width`, `height` and `fov`.

## Map

| call | returns |
|---|---|
| `get_spawn_points(center, radius=150, spacing=30)` | transforms on lane centres, facing the direction of travel, every `spacing` m along each lane (`center` defaults to the spectator) |
| `get_waypoint(location, heading=None, max_distance=30)` | `Waypoint(road_id, lane_id, s, transform, lane_width, lanes, is_junction, road_class, oneway, speed_limit)`; `.next(d)` |
| `get_junctions(center, radius=120)` | `Junction(id, location, signalized, arms=[JunctionArm(road_id, heading, lanes, oneway, road_class)])`, nearest first; junctions of three or more arms |
| `plan_walk_route(start, end)` | `(length, [Location])` over sidewalks and crosswalks |
| `get_surface(location)` | `{height, kind, road}` (`kind`: sidewalk, curb, asphalt, gutter, busred, paint, grass...) |
| `geolocation_to_location(lat, lon)` / `transform_to_geolocation(loc)` | WGS84 conversions |

## Geometry

`Vector3D`, `Location` (with `+ - * /`, `length`, `distance`, `distance_2d`, `dot`, `cross`, `make_unit_vector`),
`Rotation(pitch, yaw, roll)` (`get_forward_vector`, `get_right_vector`, `get_up_vector`, `matrix`),
`Transform(location, rotation)` (`transform_point`, `inverse_transform_point`, `get_matrix`, `get_inverse_matrix`),
`BoundingBox(location, extent, rotation)` (`get_local_vertices`, `get_world_vertices(transform)`), `GeoLocation`.

## Utilities (`valdrada.util`)

- `camera_intrinsics(width, height, fov)`: the 3 x 3 K matrix.
- `project_point(point, camera_transform, width, height, fov)` and `project_bbox(actor_transform, bbox, camera_transform,
  width, height, fov)`: 3D to pixels.
- `CocoWriter(classes, thing_only=True)`: `add(file_name, labels, width, height, frame=0, min_area=0)` per frame, then
  `save(path)`. The categories are the given classes (the table of `get_semantic_classes()` or a subset of it), by
  default only those with instances. Visible boxes go in `bbox`; `instance_id`, `truncated`, and where present
  `amodal_bbox`, `occlusion` and `actor_id` are extra keys of each annotation.
- `draw_boxes_rgb(image, labels, color_of=None, thickness=2)`: an RGB array with boxes drawn (needs numpy).
- `png.write_png(path, width, height, data, channels=4, bitdepth=8)`: a PNG writer with no dependencies (in
  `valdrada.png`).

## Performance

The server renders with a full post chain (TAA, SSAO, bloom) on the GPU the OS gives Chromium; ask for the discrete one.

Setup:

- Hardware: release build on Windows 11 with an NVIDIA RTX 3060 Laptop GPU (Direct3D 11 through ANGLE).
- Scene: W 120th St & Amsterdam Ave, with one autopilot vehicle and ambient traffic.
- Settings: 1280 × 720, synchronous mode, fixed step 0.05 s.
- Measurement: `PythonAPI/examples/benchmark.py` (60 ticks per configuration, after 5 warm-up ticks), the second of two
  consecutive runs (the first absorbs the server's first shader compiles).

| Sensor configuration | ms / step | × real time |
|---|---:|---:|
| none | 54 | 0.93 |
| RGB | 67 | 0.75 |
| depth | 90 | 0.56 |
| RGB + semantic + instance, one pose | 152 | 0.33 |
| RGB + semantic + instance, amodal boxes for 8 objects | 219 | 0.23 |
| RGB + semantic + instance, plus a vehicle-mounted RGB camera | 201 | 0.25 |

Rules of thumb:

- The first RGB camera is the PRIMARY view. Its image is the tick's own frame, and the window shows it.
- Every further camera pose costs one more rendered frame per tick. Co-locate cameras where you can.
- Label cameras cost render time for their passes; use `sensor_tick` to run them less often than the simulation steps.
- `server --quality medium` renders cheaper frames.
