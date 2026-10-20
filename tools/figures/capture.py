"""Render the stills behind the README figures and the documentation site, through the Python API.

    Valdrada.exe --headless --res 2880x1620          (release build; or `npm run dev` in server/)
    python tools/figures/capture.py --out docs/assets/figures/raw [--only hero_harlem,sensors]

Per shot: weather, spectator placement (the city streams around it), wait for the tiles, sensors at the pose, then
`--ticks` synchronous steps so TAA converges and the facade dresser settles; the last frame of each sensor is kept.
Poses use the client's world frame (x east, z south, metres; client/src/shared/geo.js), as camera point,
look-at point and pitch in radians, the convention of the tools/bshot.mjs presets. Heights are above the street.

Outputs per shot: <name>_rgb.png; with labels: <name>_semantic.png (class palette), <name>_instance.png +
<name>_instance.json (per-object labels), <name>_depth.png (colour-mapped) + <name>_depth.npy, classes.json.
"""
import argparse
import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "PythonAPI"))
import valdrada  # noqa: E402
from valdrada import Location, Rotation, Transform, WeatherParameters  # noqa: E402

STREET = 3.4          # street datum of the flat compile (roadbed 3.385 m, walk 3.52 m)

# name: camera (x, z, height), look-at (x, z), pitch (rad), horizontal fov (deg), time, rain, labels, extra traffic
SHOTS = {
    # hero banners: the city at scale
    "hero_harlem":   dict(cam=(1650, -4450, 430), look=(-700, 2600), pitch=-0.20, fov=62, time="golden"),
    "hero_crowns":   dict(cam=(-1011, 3938, 210), look=(-1011, 3278), pitch=0.02, fov=70, time="golden"),
    "hero_esb":      dict(cam=(-779, 4301, 250), look=(-1222, 3856), pitch=0.10, fov=60, time="dusk"),
    # the pipeline figure: 125th St & Lenox Ave, high oblique
    "lenox_oblique": dict(cam=(2094, -2609, 150), look=(2167, -2740), pitch=-0.78, fov=58, time="day", labels=True),
    # the sensor figure: the pole camera of PythonAPI/examples/intersection_120_amsterdam.py
    "sensors":       dict(geo=(40.80955, -73.95905), offset=(-14, -14, 6.5), yaw=45, pitch_deg=-20, fov=90, time="day",
                          labels=True, traffic=(10, 24)),
    # gallery
    "g_lenox":       dict(cam=(2140.9, -2755.7, 2.6), look=(2210.2, -2742.5), pitch=0.062, fov=80, time="day"),
    "g_fifth":       dict(geo=(40.75341, -73.98103), height=3.0, yaw_client=2.635, pitch=0.18, fov=75, time="golden",
                          labels=True),
    "g_timessq":     dict(cam=(-1233, 2834, 4.0), look=(-1290, 2978), pitch=0.20, fov=80, time="night"),
    "g_brownstones": dict(cam=(2047, -2431, 1.8), look=(2062, -2424), pitch=-0.05, fov=72, time="day"),
    "hero_125th":    dict(cam=(2010, -2828, 38), look=(2560, -2520), pitch=-0.13, fov=70, time="golden"),
    "g_columbia":    dict(geo=(40.80712, -73.96232), height=1.7, yaw_client=-0.361, pitch=0.08, fov=72, time="golden"),
    "g_el":          dict(cam=(1003, 8251, 1.7), look=(1046, 8210), pitch=0.06, fov=80, time="day", rain=0.8),
    "g_amsterdam":   dict(cam=(1043, -2952, 12), look=(1010, -2917), pitch=-0.36, fov=80, time="day", traffic=(6, 30)),
}


def pose(m, s):
    if "geo" in s:
        base = m.geolocation_to_location(*s["geo"])
        if "offset" in s:
            dx, dy, dz = s["offset"]
            return Transform(Location(base.x + dx, base.y + dy, STREET + dz), Rotation(pitch=s["pitch_deg"], yaw=s["yaw"]))
        yaw = 90.0 + math.degrees(s["yaw_client"])            # client yaw: 0 = north, CCW positive
        return Transform(Location(base.x, base.y, STREET + s["height"]), Rotation(pitch=math.degrees(s["pitch"]), yaw=yaw))
    (cx, cz, h), (tx, tz) = s["cam"], s["look"]
    yaw = math.degrees(math.atan2(cz - tz, tx - cx))        # ENU: y north = -z
    return Transform(Location(cx, -cz, STREET + h), Rotation(pitch=math.degrees(s["pitch"]), yaw=yaw))


def turbo(x):
    """Turbo colour map for x in [0, 1] -> uint8 RGB (numpy). Polynomial fit of Turbo by Anton Mikhailov (Google, 2019),
    Apache-2.0."""
    import numpy as np
    x = np.clip(x, 0.0, 1.0)
    r = 0.13572138 + x * (4.61539260 + x * (-42.66032258 + x * (132.13108234 + x * (-152.94239396 + x * 59.28637943))))
    g = 0.09140261 + x * (2.19418839 + x * (4.84296658 + x * (-14.18503333 + x * (4.27729857 + x * 2.82956604))))
    b = 0.10667330 + x * (12.64194608 + x * (-60.58204836 + x * (110.36276771 + x * (-89.90310912 + x * 27.34824973))))
    return (np.clip(np.stack([r, g, b], -1), 0, 1) * 255 + 0.5).astype(np.uint8)


def populate(world, m, center, n_veh, n_walk, rng):
    lib = world.get_blueprint_library()
    vbps = [b for b in lib.filter("vehicle.*") if b.id not in ("vehicle.firetruck", "vehicle.ambulance", "vehicle.police")]
    wbps = list(lib.filter("walker.pedestrian.*"))
    actors = []
    sps = m.get_spawn_points(center=center, radius=90, spacing=14)
    rng.shuffle(sps)
    for sp in sps[:n_veh]:
        v = world.try_spawn_actor(rng.choice(vbps), sp)
        if v is not None:
            v.set_autopilot(True)
            actors.append(v)
    corners = []
    for j in m.get_junctions(center=center, radius=60):
        for arm in j.arms:
            for side in (-1, 1):
                h = math.radians(arm.heading + side * 45)
                corners.append(j.location + Location(13 * math.cos(h), 13 * math.sin(h), 0))
    for _ in range(n_walk if corners else 0):
        start = rng.choice(corners) + Location(rng.uniform(-2.5, 2.5), rng.uniform(-2.5, 2.5), 0)
        w = world.try_spawn_actor(rng.choice(wbps), Transform(start))
        if w is None:
            continue
        ai = world.spawn_actor(lib.find("controller.ai.walker"), Transform(), attach_to=w)
        ai.start()
        ai.set_max_speed(rng.uniform(1.1, 1.5))
        try:
            ai.go_to_location(rng.choice(corners))
        except valdrada.ValdradaError:
            pass
        actors += [ai, w]
    return actors


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=2000)
    ap.add_argument("--out", default="docs/assets/figures/raw")
    ap.add_argument("--only", default=None, help="comma-separated shot names")
    ap.add_argument("--ticks", type=int, default=48, help="steps per shot before the kept frame")
    ap.add_argument("--warm", type=int, default=120, help="extra steps when a shot adds traffic")
    ap.add_argument("--seed", type=int, default=3)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    rng = random.Random(a.seed)

    client = valdrada.Client(a.host, a.port)
    client.set_timeout(300.0)
    world = client.get_world()
    world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))
    m = world.get_map()
    lib = world.get_blueprint_library()
    names = a.only.split(",") if a.only else list(SHOTS)
    classes_saved = False

    for name in names:
        s = SHOTS[name]
        tf = pose(m, s)
        world.set_weather(WeatherParameters(s.get("time", "day"), s.get("rain", 0.0)))
        world.get_spectator().set_transform(tf)
        world.wait_until_loaded()
        actors = populate(world, m, tf.location, *s["traffic"], rng) if s.get("traffic") else []
        for _ in range(a.warm if actors else 0):
            world.tick()

        kinds = ["rgb"] + (["semantic_segmentation", "instance_segmentation", "depth"] if s.get("labels") else [])
        latest, sensors = {}, []
        for k in kinds:
            bp = lib.find("sensor.camera." + k)
            bp.set_attribute("fov", s["fov"])
            if k == "instance_segmentation":
                bp.set_attribute("amodal", 12)
            cam = world.spawn_actor(bp, tf)
            cam.listen(lambda d, k=k: latest.__setitem__(k, d))
            sensors.append(cam)
        for _ in range(a.ticks):
            world.tick()

        base = os.path.join(a.out, name)
        latest["rgb"].save_to_disk(base + "_rgb.png")
        if s.get("labels"):
            sem = latest["semantic_segmentation"]
            sem.save_to_disk(base + "_semantic.png")
            latest["instance_segmentation"].save_to_disk(base + "_instance.png")
            dep = latest["depth"]
            d = dep.to_numpy()
            import numpy as np
            np.save(base + "_depth.npy", d.astype(np.float32))
            x = np.log1p(np.clip(d, 0.5, 400.0)) / np.log1p(400.0)                 # log scale, 0.5 .. 400 m
            rgb = turbo(1.0 - x)
            rgb[d >= dep.depth_max * 0.99] = (18, 22, 30)                         # sky
            valdrada.png.write_png(base + "_depth.png", dep.width, dep.height, rgb.tobytes(), 3)
            if not classes_saved:
                with open(os.path.join(a.out, "classes.json"), "w", encoding="utf-8") as f:
                    json.dump(sem.classes or valdrada.SemanticSegmentationImage.classes, f, indent=1)
                classes_saved = True
        print(f"{name}: {latest['rgb'].width}x{latest['rgb'].height}"
              + (f", {len(latest['instance_segmentation'].labels)} labelled objects" if s.get("labels") else ""), flush=True)
        for cam in sensors:
            cam.stop()
            cam.destroy()
        for act in reversed(actors):
            act.destroy()


if __name__ == "__main__":
    main()
