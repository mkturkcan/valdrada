#!/usr/bin/env python3
"""Check an installed ValdradaUE package end to end: with its launcher running (./ValdradaUE.sh --offscreen), load two
places, render RGB and depth from a Python client, save the RGB frames and time each step.

  ./ValdradaUE.sh --offscreen --port 2000 &          (in the installed folder)
  python3 smoke_test.py --package <installed folder> --port 2000 --out smoke/

Fails (exit 1) when a camera returns no frame or an all-black one. The package's own PythonAPI/ is used, so nothing
needs to be installed.
"""
import argparse, os, sys, time


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--package', required=True, help='the installed folder (holds PythonAPI/)')
    ap.add_argument('--port', type=int, default=2000)
    ap.add_argument('--out', default='smoke')
    ap.add_argument('--ticks', type=int, default=6)
    a = ap.parse_args()
    sys.path.insert(0, os.path.join(os.path.abspath(a.package), 'PythonAPI'))
    import valdrada
    from valdrada import Location, Rotation, Transform
    os.makedirs(a.out, exist_ok=True)
    t0 = time.time()
    client = valdrada.Client('127.0.0.1', a.port)
    world = client.get_world(); m = world.get_map(); lib = world.get_blueprint_library()
    world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=0.05))
    bad = 0
    for name, (lat, lon) in {'amsterdam120': (40.80955, -73.95905), 'timessq': (40.7580, -73.9855)}.items():
        here = m.geolocation_to_location(lat, lon)
        # (over the street: 70 m back along the lane nearest the place and 25 m up, looking along it. The fixed pose 60 m
        # off both axes at 45 m looked out from under Columbia's lawns, 46.9 m up on the measured ground by Amsterdam
        # Avenue and 120th Street, and a corner pose over the ground stood inside the blocks. The core answers for the
        # lanes of the tiles it holds: the place is loaded before its lane is asked)
        t = time.time()
        pose = Transform(Location(here.x - 60, here.y - 60, 45), Rotation(pitch=-25, yaw=45))
        world.get_spectator().set_transform(pose); world.wait_until_loaded()
        wp = m.get_waypoint(here, max_distance=150.0)   # (Times Square's point lies in the plaza, 30 m from any lane)
        if wp:
            g, f = wp.transform.location, wp.transform.get_forward_vector()
            pose = Transform(Location(g.x - f.x * 70, g.y - f.y * 70, g.z + 25), Rotation(pitch=-20, yaw=wp.transform.rotation.yaw))
            world.get_spectator().set_transform(pose); world.wait_until_loaded()
        tl = time.time() - t
        cams = {k: world.spawn_actor(lib.find(bp), pose) for k, bp in (('rgb', 'sensor.camera.rgb'), ('depth', 'sensor.camera.depth'))}
        got = {k: [] for k in cams}
        for k, c in cams.items():
            c.listen(lambda im, k=k: got[k].append(im))
        ticks = []
        for _ in range(a.ticks):
            t = time.time(); world.tick(); ticks.append(round(time.time() - t, 2))
        mean = None
        if got['rgb']:
            im = got['rgb'][-1]
            im.save_to_disk(os.path.join(a.out, f'{name}_rgb.png'))
            raw = bytes(im.raw_data)[0::97]
            mean = sum(raw) / max(1, len(raw))
        ok = bool(got['rgb']) and bool(got['depth']) and mean is not None and mean > 2
        bad += not ok
        print(f'{name}: loaded in {tl:.1f} s; ticks {ticks} s; rgb {len(got["rgb"])}, depth {len(got["depth"])} frames; '
              f'mean rgb byte {mean if mean is None else round(mean, 1)}{"" if ok else "  FAILED"}', flush=True)
        for c in cams.values():
            c.destroy()
    print(f'total {time.time() - t0:.1f} s; {"ok" if not bad else "FAILED"}')
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
