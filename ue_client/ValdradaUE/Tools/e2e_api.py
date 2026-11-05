"""The Python API's ground truth and actors against a renderer, end to end: what the deck's two demos do, as checks.

  labels/  a taxi on autopilot from W 120th St and Amsterdam Ave with an RGB, a semantic, an instance, a depth and a
           bounding box camera behind it (one sensor group); every saved frame's instance plane must decode to the label
           rows' ids, every row's box must hold its pixels, and the API taxi in front of a second camera must be named
  actors/  at Lenox Ave and 125th St: vehicles spawned on autopilot, walkers with route controllers, a taxi taken over
           and braked under direct control; every actor must move as asked and come back in the labels with its id
  wheels/  a taxi that has driven, seen from its side: its near wheels must fill the discs at its hubs
  lamps/   at night, a taxi and an SUV seen from 6 m in front: their headlamps must light pixels on the car itself
  --core-log: the core's log; a frame the core failed while the test ran fails it (a failed frame sends the renderer no
           state: 0.7.0's first package drew no road user for 80 s after its smoke test, a train car back in range)

    python3 ue_client/ValdradaUE/Tools/e2e_api.py --port 2010 --out <dir> [--frames 60] [--core-log <core.log>]

Exit 0 when every check passes; the failures are listed otherwise (and in <out>/e2e_api.json).
"""
import argparse
import json
import math
import os
import random
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', '..', '..', 'PythonAPI'))   # run from a source checkout
import valdrada  # noqa: E402
from valdrada import Location, Rotation, Transform, VehicleControl  # noqa: E402

AMST_120 = (40.80955, -73.95905)
LENOX_125 = (40.80765, -73.94518)
UPTOWN = 61.0          # the avenues' heading (yaw, degrees counter-clockwise from east)
DT = 1.0 / 20.0
WALKABLE = {'sidewalk', 'plaza', 'path', 'brick', 'footpath'}
ID_INV, ID_MOD = 5029001, 1 << 24


def fwd(yaw, d):
    v = Rotation(yaw=yaw).get_forward_vector()
    return Location(v.x * d, v.y * d, 0)


def save_png(path, w, h, rgb):
    try:
        import numpy as np
        from PIL import Image
        Image.fromarray(np.asarray(rgb, dtype=np.uint8).reshape(h, w, 3)).save(path)
    except ImportError:
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--host', default='127.0.0.1')
    ap.add_argument('--port', type=int, default=2010)
    ap.add_argument('--out', required=True)
    ap.add_argument('--frames', type=int, default=60)
    ap.add_argument('--every', type=int, default=10)
    ap.add_argument('--actor-frames', type=int, default=200, help='ticks the actors run (a red light holds a car for a while)')
    ap.add_argument('--only', default='', help='labels, actors, wheels or lamps (all by default)')
    ap.add_argument('--core-log', default='', help="the core's log: its failed frames during the test fail it")
    a = ap.parse_args()
    log0 = os.path.getsize(a.core_log) if a.core_log and os.path.exists(a.core_log) else None
    import numpy as np
    random.seed(7)
    os.makedirs(a.out, exist_ok=True)
    fails, report = [], {'labels': {}, 'actors': {}}

    def check(ok, what):
        print(('ok   ' if ok else 'FAIL ') + what, flush=True)
        if not ok:
            fails.append(what)
        return ok

    client = valdrada.Client(a.host, a.port)
    client.set_timeout(600.0)
    world = client.get_world()
    # a headless core serves sensors once a renderer client has attached (e2e_check.py)
    t = time.time()
    while True:
        info = client.get_server_info()
        if info.get('engine') != 'valdrada-core' or info.get('renderer') or time.time() - t > 900:
            break
        time.sleep(2)
    report['renderer'] = info.get('renderer') or info.get('gpu')
    check(bool(report['renderer']), f'a renderer attached ({report["renderer"]}, {time.time() - t:.0f} s)')
    original = world.get_settings()
    world.apply_settings(valdrada.WorldSettings(synchronous_mode=True, fixed_delta_seconds=DT))
    m = world.get_map()
    lib = world.get_blueprint_library()
    classes = {c['id']: c for c in (m if hasattr(m, 'get_semantic_classes') else world).get_semantic_classes()}
    spawned = []

    def spawn(bp, tr, **kw):
        x = world.try_spawn_actor(bp, tr, **kw)
        if x is not None:
            spawned.append(x)
        return x

    def at_size(mask, h, w):
        # a label camera's mask at another camera's size, nearest (the RGB camera renders at the server's resolution)
        return mask[(np.arange(h) * mask.shape[0]) // h][:, (np.arange(w) * mask.shape[1]) // w]

    try:
        # ---------------------------------------------------------------- labels
        if a.only in ('', 'labels'):
            d = os.path.join(a.out, 'labels'); os.makedirs(d, exist_ok=True)
            here = m.geolocation_to_location(*AMST_120)
            world.get_spectator().set_transform(Transform(here + Location(0, 0, 30), Rotation(pitch=-50)))
            t0 = time.time(); world.wait_until_loaded(); report['labels']['load_s'] = round(time.time() - t0, 1)
            sp = m.get_spawn_points(center=here, radius=120, spacing=8)
            check(len(sp) > 0, f'spawn points near W 120th and Amsterdam ({len(sp)})')
            taxi = spawn(lib.find('vehicle.taxi2'), sp[0])
            check(taxi is not None, 'taxi spawned')
            taxi.set_autopilot(True)
            rel = Transform(Location(-6.5, 0, 2.6), Rotation(pitch=-10))
            latest = {}
            for kind in ('rgb', 'semantic_segmentation', 'instance_segmentation', 'depth', 'bounding_boxes'):
                bp = lib.find('sensor.camera.' + kind)
                bp.set_attribute('image_size_x', 1280); bp.set_attribute('image_size_y', 720); bp.set_attribute('fov', 90)
                if kind in ('instance_segmentation', 'bounding_boxes'):
                    bp.set_attribute('amodal', 4)
                cam = spawn(bp, rel, attach_to=taxi)
                cam.listen(lambda im, k=kind: latest.__setitem__(k, im))
            # a second camera looking back at the taxi: the API taxi must come back in its labels with its id
            back = lib.find('sensor.camera.instance_segmentation')
            back.set_attribute('image_size_x', 960); back.set_attribute('image_size_y', 540); back.set_attribute('fov', 70)
            bcam = spawn(back, Transform(Location(14, 0, 3.0), Rotation(yaw=180, pitch=-8)), attach_to=taxi)
            bcam.listen(lambda im: latest.__setitem__('back', im))
            seen_taxi, frames, rows_total, bad_decode, bad_box, times = 0, 0, 0, 0, 0, []
            ground = np.zeros(256, np.int64)   # (the semantic planes' classes: the road and the sidewalk under a taxi in a street)
            for f in range(a.frames):
                t = time.time(); world.tick(); times.append(time.time() - t)
                inst, bb, rgb, sem = latest.pop('instance_segmentation', None), latest.pop('bounding_boxes', None), latest.pop('rgb', None), latest.pop('semantic_segmentation', None)
                bk = latest.pop('back', None)
                if sem is not None:
                    ground += np.bincount(np.frombuffer(bytes(sem.raw_data), dtype=np.uint8), minlength=256)
                latest.pop('depth', None)
                if bk is not None and any(r.actor_id == taxi.id for r in bk.labels):
                    seen_taxi += 1
                if inst is None:
                    continue
                frames += 1
                rows = inst.labels
                rows_total += len(rows)
                px = np.frombuffer(bytes(inst.raw_data), dtype=np.uint8).reshape(inst.height, inst.width, 4)
                code = px[..., 0].astype(np.int64) | (px[..., 1].astype(np.int64) << 8) | (px[..., 2].astype(np.int64) << 16)
                ids = set(int(c * ID_INV % ID_MOD) for c in np.unique(code) if c)
                row_ids = set(r.id for r in rows)
                # every row is in the plane; codes without a row are things under min_pixels
                bad_decode += len(row_ids - ids)
                for r in rows:
                    x, y, w, h = r.bbox
                    c = (r.id * 3635641) % ID_MOD
                    n = int((code[y:y + h, x:x + w] == c).sum())
                    if n != r.area:
                        bad_box += 1
                if f % a.every == 0 or f == a.frames - 1:
                    if rgb is not None:
                        rgb.save_to_disk(os.path.join(d, f'rgb_{f:04d}.png'))
                    if sem is not None and classes:
                        s = np.frombuffer(bytes(sem.raw_data), dtype=np.uint8).reshape(sem.height, sem.width)
                        lut = np.zeros((256, 3), np.uint8)
                        for cid, c in classes.items():
                            lut[cid] = c['rgb']
                        save_png(os.path.join(d, f'sem_{f:04d}.png'), sem.width, sem.height, lut[s])
                    rng = np.random.default_rng(1)
                    pal = rng.integers(40, 255, (4096, 3), dtype=np.uint8); pal[0] = 0
                    save_png(os.path.join(d, f'inst_{f:04d}.png'), inst.width, inst.height, pal[(code % 4093) * (code > 0)])
                    json.dump(inst.to_dict(), open(os.path.join(d, f'labels_{f:04d}.json'), 'w'), indent=1)
                    if bb is not None:
                        json.dump(bb.to_dict(), open(os.path.join(d, f'boxes_{f:04d}.json'), 'w'), indent=1)
            report['labels'].update(frames=frames, rows=rows_total, taxi_seen=seen_taxi, tick_s=[round(min(times), 3), round(sorted(times)[len(times) // 2], 3), round(max(times), 3)])
            check(frames >= a.frames * 0.9, f'instance frames {frames} of {a.frames}')
            check(rows_total > 0, f'label rows in the frames: {rows_total}')
            check(bad_decode == 0, f'every label row in its instance plane ({bad_decode} missing)')
            check(bad_box == 0, f'every row\'s area inside its box ({bad_box} differ)')
            check(seen_taxi >= frames * 0.5, f'the API taxi named in the back camera\'s labels in {seen_taxi} of {frames} frames')
            share = {k: round(100.0 * float(ground[c]) / max(1, int(ground.sum())), 1) for k, c in (('unlabelled', 0), ('road', 3), ('sidewalk', 4))}
            report['labels']['semantic_share'] = share
            check(share['road'] > 5 and share['sidewalk'] > 1, f'the ground classed in the semantic planes (road {share["road"]} %, sidewalk {share["sidewalk"]} %, unlabelled {share["unlabelled"]} %)')
            # a path-traced frame (render_mode pathtrace, a renderer with a path tracer)
            pt = lib.find('sensor.camera.rgb')
            pt.set_attribute('image_size_x', 960); pt.set_attribute('image_size_y', 540); pt.set_attribute('fov', 75)
            pt.set_attribute('render_mode', 'pathtrace'); pt.set_attribute('samples_per_pixel', 32)
            pcam = spawn(pt, Transform(Location(-9, 3, 4.0), Rotation(yaw=-15, pitch=-12)), attach_to=taxi)
            pcam.listen(lambda im: latest.__setitem__('pt', im))
            taxi.set_autopilot(False); taxi.apply_control(VehicleControl(brake=1.0))
            t = time.time(); got = None
            for _ in range(3):
                world.tick()
                got = latest.pop('pt', None) or got
            report['labels']['pathtrace_s'] = round(time.time() - t, 1)
            if got is not None:
                px_pt = np.frombuffer(bytes(got.raw_data), dtype=np.uint8).reshape(got.height, got.width, 4)[..., :3]
                got.save_to_disk(os.path.join(d, 'pathtrace.png'))
                report['labels']['pathtrace_mean'] = round(float(px_pt.mean()), 1)
            check(got is not None and report['labels'].get('pathtrace_mean', 0) > 10, f'a path-traced frame ({report["labels"].get("pathtrace_mean")} mean, {report["labels"]["pathtrace_s"]} s for 3 ticks)')
            # a walker close up: its body drawn (an instance row with its id and a body's area), dressed (its textures: inside
            # its pixels the colourfulness, Hasler and Susstrunk's, of the default material's grey body is ~7 in the shade,
            # this walker's outfit ~18; or the luminance's mean gradient over its mean, smooth shading ~0.06), and its frames
            # saved
            wbps = list(lib.filter('walker.pedestrian.*'))
            spot = None
            for r in range(6, 60, 3):
                for k in range(16):
                    p = here + Location(r * math.cos(k * math.pi / 8), r * math.sin(k * math.pi / 8), 0)
                    srf = m.get_surface(p)
                    if srf.get('kind') in WALKABLE:
                        spot = Location(p.x, p.y, srf.get('height', here.z)); break
                if spot:
                    break
            closeup, dressed = None, None
            if spot and wbps:
                wk = spawn(wbps[0], Transform(spot + Location(0, 0, 0.05), Rotation(yaw=180)))
                cb = lib.find('sensor.camera.instance_segmentation')
                cb.set_attribute('image_size_x', 960); cb.set_attribute('image_size_y', 540); cb.set_attribute('fov', 50)
                cr = lib.find('sensor.camera.rgb'); cr.set_attribute('fov', 50)
                eye = Transform(spot + Location(4.0, 0, 1.5), Rotation(yaw=180, pitch=-6))
                for bp in (cb, cr):
                    c2 = spawn(bp, eye)
                    c2.listen(lambda im, k=bp.id: latest.__setitem__('close_' + k, im))
                for _ in range(4):
                    world.tick()
                ci, cg = latest.pop('close_sensor.camera.instance_segmentation', None), latest.pop('close_sensor.camera.rgb', None)
                if cg is not None:
                    cg.save_to_disk(os.path.join(d, 'walker_close.png'))
                if ci is not None:
                    ci.save_to_disk(os.path.join(d, 'walker_close_inst.png'))
                if ci is not None and wk is not None:
                    row = next((r for r in ci.labels if r.actor_id == wk.id), None)
                    closeup = row.area if row else 0
                    if row and cg is not None:
                        px = np.frombuffer(bytes(ci.raw_data), dtype=np.uint8).reshape(ci.height, ci.width, 4)
                        code = px[..., 0].astype(np.int64) | (px[..., 1].astype(np.int64) << 8) | (px[..., 2].astype(np.int64) << 16)
                        body = (code * ID_INV % ID_MOD) == row.id
                        body &= np.roll(body, 3, 0) & np.roll(body, -3, 0) & np.roll(body, 3, 1) & np.roll(body, -3, 1)   # (not its outline)
                        rgb = np.frombuffer(bytes(cg.raw_data), dtype=np.uint8).reshape(cg.height, cg.width, 4)[..., :3].astype(np.float32)
                        body = at_size(body, cg.height, cg.width)
                        if body.sum() > 500:
                            lum = rgb.mean(-1)
                            gy, gx = np.gradient(lum)
                            px = rgb[body]
                            rg, yb = px[:, 0] - px[:, 1], 0.5 * (px[:, 0] + px[:, 1]) - px[:, 2]
                            dressed = {'detail': round(float(np.hypot(gx, gy)[body].mean() / max(1.0, lum[body].mean())), 3),
                                       'colourful': round(float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean())), 2)}
            report['labels']['walker_close_px'] = closeup
            report['labels']['walker_close_detail'] = dressed
            check(bool(closeup) and closeup > 2000, f'a walker 4 m from the camera drawn and labelled with its id ({closeup} px)')
            check(dressed is not None and (dressed['colourful'] > 11 or dressed['detail'] > 0.1),
                  f'the walker dressed: its textures drawn ({dressed}; the default material\'s grey body: colourful ~7, detail ~0.06)')
            for x in spawned[::-1]:
                try:
                    x.destroy()
                except Exception:
                    pass
            spawned.clear()

        # ---------------------------------------------------------------- actors
        if a.only in ('', 'actors'):
            d = os.path.join(a.out, 'actors'); os.makedirs(d, exist_ok=True)
            # (the junctions of tiles the core has loaded: the place first)
            here2 = m.geolocation_to_location(*LENOX_125)
            world.get_spectator().set_transform(Transform(here2 + Location(0, 0, 40), Rotation(pitch=-60, yaw=UPTOWN)))
            world.wait_until_loaded()
            J = m.get_junctions(center=here2, radius=80)[0].location
            eye = J - fwd(UPTOWN, 46) + fwd(UPTOWN - 90, 26) + Location(0, 0, 30)
            yaw = math.degrees(math.atan2(J.y - eye.y, J.x - eye.x))
            pitch = -math.degrees(math.atan2(eye.z - J.z, math.hypot(J.x - eye.x, J.y - eye.y)))
            world.get_spectator().set_transform(Transform(eye, Rotation(pitch=pitch, yaw=yaw)))
            t0 = time.time(); world.wait_until_loaded(); report['actors']['load_s'] = round(time.time() - t0, 1)
            latest = {}
            for kind in ('rgb', 'instance_segmentation'):
                bp = lib.find('sensor.camera.' + kind)
                bp.set_attribute('image_size_x', 1280); bp.set_attribute('image_size_y', 720); bp.set_attribute('fov', 62)
                cam = spawn(bp, Transform(eye, Rotation(pitch=pitch, yaw=yaw)))
                cam.listen(lambda im, k=kind: latest.__setitem__(k, im))
            sps = sorted(m.get_spawn_points(center=J, radius=120, spacing=9), key=lambda t: t.location.distance(J))
            vbps = list(lib.filter('vehicle.*'))
            cars = []
            for t in sps[:24]:
                c = spawn(random.choice(vbps), t)
                if c is not None:
                    c.set_autopilot(True); cars.append(c)
            check(len(cars) >= 12, f'vehicles spawned on autopilot: {len(cars)}')
            pts = [J + Location(i, j, 0) for i in range(-60, 61, 3) for j in range(-60, 61, 3) if 10 < (J + Location(i, j, 0)).distance_2d(J) < 62]
            random.shuffle(pts)
            wbps = list(lib.filter('walker.pedestrian.*'))
            ai_bp = lib.find('controller.ai.walker')
            walkers = []
            for p in pts:
                if len(walkers) >= 24:
                    break
                s = m.get_surface(p)
                if s.get('kind') not in WALKABLE:
                    continue
                w = spawn(random.choice(wbps), Transform(Location(p.x, p.y, s.get('height', J.z) + 0.05), Rotation(yaw=random.uniform(0, 360))))
                if w is None:
                    continue
                ai = spawn(ai_bp, Transform(), attach_to=w)
                if ai is None:
                    continue
                ai.start(); ai.set_max_speed(random.uniform(1.1, 1.6))
                ai.go_to_location(J + fwd(random.uniform(0, 360), random.uniform(45, 110)))
                walkers.append(w)
            check(len(walkers) >= 12, f'walkers spawned with route controllers: {len(walkers)}')
            start = {x.id: x.get_location() for x in cars + walkers}
            named, frames = set(), 0
            for f in range(a.actor_frames):
                world.tick()
                inst, rgb = latest.pop('instance_segmentation', None), latest.pop('rgb', None)
                if inst is not None:
                    frames += 1
                    named |= set(r.actor_id for r in inst.labels if r.actor_id)
                if rgb is not None and (f % (a.every * 3) == 0 or f == a.actor_frames - 1):
                    rgb.save_to_disk(os.path.join(d, f'rgb_{f:04d}.png'))
            moved_c = sum(1 for c in cars if c.get_location().distance(start[c.id]) > 2.0)
            moved_w = sum(1 for w in walkers if w.get_location().distance(start[w.id]) > 1.0)
            api_ids = set(start)
            report['actors'].update(cars=len(cars), walkers=len(walkers), cars_moved=moved_c, walkers_moved=moved_w, named=len(named & api_ids), frames=frames)
            check(moved_c >= len(cars) * 0.4, f'vehicles that moved on autopilot in {a.actor_frames} ticks: {moved_c} of {len(cars)}')
            check(moved_w >= len(walkers) * 0.5, f'walkers that moved on their routes: {moved_w} of {len(walkers)}')
            check(len(named & api_ids) >= 6, f'API actors named in the labels: {len(named & api_ids)}')
            # direct control: the first car taken over and braked to a stop
            if cars:
                c = cars[0]
                c.set_autopilot(False)
                c.apply_control(VehicleControl(throttle=0.0, brake=1.0))
                for _ in range(int(3 / DT)):
                    world.tick()
                check(c.get_speed() < 0.5, f'a taken-over car braked to a stop ({c.get_speed():.2f} m/s)')
        # ---------------------------------------------------------------- wheels
        if a.only in ('', 'wheels'):
            # a taxi that has driven (its wheels spun) seen square from its left at 5 m: the discs where its two near wheels
            # stand (their hubs and radii, Data/fleet.json) must be its own instance pixels; empty arches or the shrunk
            # tyres orbiting the hubs (wheels cut in the model's normalised frame) leave them open
            d = os.path.join(a.out, 'wheels'); os.makedirs(d, exist_ok=True)
            here = m.geolocation_to_location(*AMST_120)
            world.get_spectator().set_transform(Transform(here + Location(0, 0, 30), Rotation(pitch=-50)))
            world.wait_until_loaded()
            fleet = json.load(open(os.path.join(HERE, '..', 'Data', 'fleet.json')))['kinds']
            hubs = [w for w in (fleet.get('lincoln') or {}).get('wheels') or [] if w.get('p') and w['p'][0] > 0]   # (x left: the left pair)
            sp = m.get_spawn_points(center=here, radius=120, spacing=8)
            sp = sp[len(sp) // 3:] + sp[:len(sp) // 3]
            best, tries = None, 0
            W, H, FOV, D, CH = 1280, 720, 90.0, 5.0, 0.9
            f = (W / 2) / math.tan(math.radians(FOV / 2))
            for t in sp:
                if tries >= 4 or (best and best['min_cover'] >= 0.8) or not hubs:
                    break
                car = spawn(lib.find('vehicle.taxi2'), t)
                if car is None:
                    continue
                tries += 1
                car.set_autopilot(True)
                for _ in range(60):
                    world.tick()
                car.set_autopilot(False)
                car.apply_control(VehicleControl(throttle=0.0, brake=1.0))
                latest, cams = {}, []
                for ck in ('rgb', 'instance_segmentation'):
                    bp = lib.find('sensor.camera.' + ck)
                    bp.set_attribute('image_size_x', W); bp.set_attribute('image_size_y', H); bp.set_attribute('fov', FOV)
                    cam = spawn(bp, Transform(Location(0, -D, CH), Rotation(yaw=90)), attach_to=car)
                    cam.listen(lambda im, k=ck: latest.__setitem__(k, im))
                    cams.append(cam)
                for _ in range(30):
                    world.tick()
                rgb, ins = latest.get('rgb'), latest.get('instance_segmentation')
                row = next((r for r in ins.labels if r.actor_id == car.id), None) if ins is not None else None
                if row is not None:
                    px = np.frombuffer(bytes(ins.raw_data), dtype=np.uint8).reshape(ins.height, ins.width, 4)
                    code = px[..., 0].astype(np.int64) | (px[..., 1].astype(np.int64) << 8) | (px[..., 2].astype(np.int64) << 16)
                    mask = (code * ID_INV % ID_MOD) == row.id
                    yy, xx = np.mgrid[0:ins.height, 0:ins.width]
                    sx, sy = ins.width / W, ins.height / H
                    covers = None
                    for sgn in (-1, 1):   # (the car's front to either side of the frame, the same for both wheels)
                        cs = []
                        for h in hubs:
                            depth = D - h['p'][0]
                            rr, v = f * h['r'] / depth * 0.9, H / 2 + f * (CH - h['p'][1]) / depth
                            u = W / 2 + sgn * f * h['p'][2] / depth
                            disc = ((xx / sx - u) ** 2 + (yy / sy - v) ** 2) <= rr * rr
                            cs.append(round(float(mask[disc].mean()), 3) if disc.sum() else 0.0)
                        if covers is None or min(cs) > min(covers):
                            covers = cs
                    if best is None or min(covers) > best['min_cover']:
                        best = {'covers': covers, 'min_cover': min(covers), 'try': tries, 'speed': round(car.get_speed(), 2)}
                        if rgb is not None:
                            rgb.save_to_disk(os.path.join(d, 'wheels_side.png'))
                for x in cams + [car]:
                    try:
                        x.destroy()
                    except Exception:
                        pass
                    if x in spawned:
                        spawned.remove(x)
            report['wheels'] = best
            check(best is not None and best['min_cover'] >= 0.8, f"a taxi's near wheels in their arches (the hub discs' share of its pixels: {best and best['covers']}, {tries} spawn points)")
        # ---------------------------------------------------------------- lamps
        if a.only in ('', 'lamps'):
            # at night a car's headlamps lit (the record's lamp mask through the renderer's lamp material): a camera 6 m in
            # front of a taxi, the brightest pixels inside the taxi's own instance pixels; then an SUV, whose headlamps sit
            # behind an inner lens (its lampInner part, lit with the lamps); the next spawn point while traffic hides the car
            d = os.path.join(a.out, 'lamps'); os.makedirs(d, exist_ok=True)
            here = m.geolocation_to_location(*AMST_120)
            world.get_spectator().set_transform(Transform(here + Location(0, 0, 30), Rotation(pitch=-50)))
            world.set_weather(valdrada.WeatherParameters('night'))
            world.wait_until_loaded()
            sp = m.get_spawn_points(center=here, radius=120, spacing=8)
            sp = sp[len(sp) // 2:] + sp[:len(sp) // 2]
            report['lamps'] = {}
            for kind, name in (('taxi2', 'taxi'), ('suv', 'SUV')):
                bp_car = lib.find('vehicle.' + kind)
                best, tries = None, 0
                for t in sp:
                    if tries >= 5 or (best and best['car_px'] > 40000):
                        break
                    car = spawn(bp_car, t) if bp_car is not None else None
                    if car is None:
                        continue
                    tries += 1
                    latest, cams = {}, []
                    eye = Transform(Location(6.0, 0, 1.3), Rotation(yaw=180, pitch=-5))
                    for ck in ('rgb', 'instance_segmentation'):
                        bp = lib.find('sensor.camera.' + ck)
                        if ck != 'rgb':
                            bp.set_attribute('image_size_x', 960); bp.set_attribute('image_size_y', 540)
                        bp.set_attribute('fov', 60)
                        cam = spawn(bp, eye, attach_to=car)
                        cam.listen(lambda im, k=ck: latest.__setitem__(k, im))
                        cams.append(cam)
                    for _ in range(6):
                        world.tick()
                    rgb, ins = latest.get('rgb'), latest.get('instance_segmentation')
                    if rgb is not None:
                        rgb.save_to_disk(os.path.join(d, f'night_{kind}_{tries}.png'))
                    row = next((r for r in ins.labels if r.actor_id == car.id), None) if ins is not None else None
                    if row and rgb is not None:
                        px = np.frombuffer(bytes(ins.raw_data), dtype=np.uint8).reshape(ins.height, ins.width, 4)
                        code = px[..., 0].astype(np.int64) | (px[..., 1].astype(np.int64) << 8) | (px[..., 2].astype(np.int64) << 16)
                        lum = np.frombuffer(bytes(rgb.raw_data), dtype=np.uint8).reshape(rgb.height, rgb.width, 4)[..., :3].astype(np.float32).mean(-1)
                        body = at_size((code * ID_INV % ID_MOD) == row.id, rgb.height, rgb.width)
                        if body.sum() > 500 and (best is None or body.sum() > best['car_px']):
                            # (the lamps by the car's own brightness: 150 or more and four times its median; the cooked
                            # client's exposure leaves the lit cores just under 220)
                            best = {'car_px': int(body.sum()), 'median_lum': round(float(np.median(lum[body])), 1), 'try': tries,
                                    'lit_px': int((lum[body] >= max(150.0, 4.0 * float(np.median(lum[body])))).sum())}
                    for x in cams + [car]:
                        try:
                            x.destroy()
                        except Exception:
                            pass
                        if x in spawned:
                            spawned.remove(x)
                report['lamps'][kind] = best
                lit = best['lit_px'] if best else None
                check(lit is not None and lit >= 30, f"{'a taxi' if kind == 'taxi2' else 'an ' + name}'s headlamps lit at night ({lit} pixels on the car at four times its median brightness, {best and best['car_px']} px of it seen, {tries} spawn points)")
            world.set_weather(valdrada.WeatherParameters('day'))
    finally:
        for x in sorted(spawned, key=lambda q: 0 if q.type_id.startswith(('sensor.', 'controller.')) else 1):
            try:
                x.destroy()
            except Exception:
                pass
        world.apply_settings(original)
    if a.core_log:
        failed = None
        if log0 is not None and os.path.exists(a.core_log):
            with open(a.core_log, errors='replace') as f:
                f.seek(log0)
                failed = [ln.strip() for ln in f if 'frame failed' in ln]
        report['core_frames_failed'] = None if failed is None else len(failed)
        check(failed == [], f"the core stepped every frame ({'no core log' if failed is None else len(failed)} failed{': ' + failed[0][:160] if failed else ''})")
    report['fails'] = fails
    json.dump(report, open(os.path.join(a.out, 'e2e_api.json'), 'w'), indent=1)
    print(json.dumps(report), flush=True)
    sys.exit(1 if fails else 0)


if __name__ == '__main__':
    main()
