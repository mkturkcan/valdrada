// Valdrada EXTERNAL CONTROL API — the in-page half (loaded by main.js under ?api=1).
//
// A client (PythonAPI/valdrada, or anything that speaks docs/api/protocol.md) sends requests to the host process
// (server/main.js: TCP -> Electron IPC -> window.boundlessHost). This module executes them against the live simulation
// and pushes sensor data back as events. Without a host (a harness or the browser console), `window.__API.call(method,
// params)` runs the same handlers and events queue on `window.__API.events`.
//
// FRAMES (the whole API speaks these; three.js is only used inside this file):
//   world:  ENU metres from the project origin (shared/geo.js LAT0/LON0): x = east, y = north, z = up.
//   rotation (pitch, yaw, roll) in degrees: yaw counter-clockwise from east, pitch nose-up positive, roll right-side-down
//           positive. A camera looks along its +x (forward).
//   attachments: a child's relative location is in its parent's body frame, x forward, y left, z up (right-handed).
// three.js: x = east, y = up, z = south. toThree / fromThree convert.
//
// TIME: the page runs the record mode's fixed-step simulation (main.js ?record semantics). In synchronous mode (the
// default, like CARLA's synchronous_mode) the world advances only on world.tick; asynchronous mode free-runs.
import * as THREE from 'three';
import { project, unproject, LAT0, LON0 } from '../shared/geo.js';
import { signalState, walkTimeLeft } from '../sim/signals.js';
// CONTROL (docs/notes/ar34-control.md): the play mode's bodies, follow camera and take recorder for API heroes
import { CarBody, WalkerBody, FollowCam, TakeRecorder, makeProbe } from '../game/control.js';
import { st38PushOut } from '../city/stations/subEnt38.js';   // DK04: walkers on a route keep out of the subway stair heads
// DK04 (2026-11-04, `?dk04=0` as before): see placeWalker
const DK04 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('dk04') === '0');

export const API_VERSION = '0.1.0';
const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// ------------------------------------------------------------------ frames
const toThree = (l) => new THREE.Vector3(l.x ?? 0, l.z ?? 0, -(l.y ?? 0));
const fromThree = (v) => ({ x: +v.x.toFixed(4), y: +(-v.z).toFixed(4), z: +v.y.toFixed(4) });
// heading: API yaw (deg, CCW from east) <-> three model yaw (rad; a model faces +z, forward = (sin h, cos h) in x/z)
const yawToH = (yawDeg) => Math.atan2(Math.cos(yawDeg * D2R), -Math.sin(yawDeg * D2R));
const hToYaw = (h) => Math.atan2(-Math.cos(h), Math.sin(h)) * R2D;
const wrap180 = (a) => { a = ((a + 180) % 360 + 360) % 360 - 180; return a; };
// camera orientation for an API rotation (a three camera looks down its -z)
function camQuat(rot) {
  const psi = (rot.yaw ?? 0) * D2R, th = (rot.pitch ?? 0) * D2R, ph = (rot.roll ?? 0) * D2R;
  const yc = Math.atan2(-Math.cos(psi), Math.sin(psi));
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(th, yc, -ph, 'YXZ'));
}
const hfovToVfov = (hfovDeg, aspect) => 2 * Math.atan(Math.tan((hfovDeg * D2R) / 2) / aspect) * R2D;
// surface kinds a pedestrian may stand on without stopping traffic (world/assemble.js sections)
const FOOTWAY = /^(sidewalk|curb|grass|path|brick|warn|warnIron)$/;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (v === undefined || v === null || !isFinite(+v) ? d : +v);

class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const need = (cond, code, msg) => { if (!cond) throw new ApiError(code, msg); };

// ------------------------------------------------------------------ the module
export function initApi(ctx) {
  const { engine, streamer, traffic, peds, sky, weather, cam } = ctx;
  const perc = () => window.__PERC || null;
  const rig = peds ? peds.rig : null;

  const settings = { synchronous_mode: true, fixed_delta_seconds: 0.05, max_substep: 0.1, idle_nap_ms: 0 };
  let frame = 0, simTime = 0;
  let busy = false;              // a tick / capture is in flight: the per-frame hooks leave the camera alone
  let freeRun = false;           // asynchronous mode
  let rainSet = 0;               // world.set_weather rain (weather.js keeps it in its GFX block)
  const events = [];             // hostless mode: queued events for window.__API.events
  const host = window.boundlessHost || null;

  // ---------------------------------------------------------------- actors
  let nextId = 100;
  const actors = new Map();
  const spectator = {
    id: 1, type_id: 'spectator', kind: 'spectator',
    loc: fromThree(cam.center), rot: { pitch: -14, yaw: 90, roll: 0 },
  };
  actors.set(1, spectator);
  if (traffic) traffic.apiCount = 0;
  if (peds) peds.apiCount = 0;
  // CONTROL: a vehicle or walker spawned with role_name 'hero' (or physics 'arcade') moves with the play mode's bodies:
  // arcade car dynamics with kerb / building / furniture / car collisions, a walker that collides; spectator.follow puts
  // the view on one with the play mode's cameras; world.start_take / stop_take record a run as a take (tools/ad/takes.mjs)
  const PP = makeProbe({ streamer, traffic, peds });
  const follow = { id: 0, mode: 'chase', cam: null };
  let takeRec = null;
  const heroAttr = (attrs) => attrs.role_name === 'hero' || attrs.physics === 'arcade';

  // ---------------------------------------------------------------- blueprints
  const vehicleKinds = traffic ? Object.keys(traffic.pools || {}) : [];
  const vehDims = (kind) => traffic?.vehDims?.[kind] || [1.9, 1.5, 4.7];   // [w, h, l]
  const vehClass = (kind) => (kind === 'bus' || kind === 'minibus' ? 'bus'
    : /sprinter|ambulance|vwvan|van|truck|firetruck|carlacola|cybertruck/i.test(kind) ? 'truck' : 'car');
  const variants = rig?.A?.variants || [];
  const SENSORS = {
    'sensor.camera.rgb': { outputs: ['rgb'] },
    'sensor.camera.semantic_segmentation': { outputs: ['semantic'] },
    'sensor.camera.instance_segmentation': { outputs: ['instance', 'labels'] },
    'sensor.camera.depth': { outputs: ['depth'] },
    'sensor.camera.bounding_boxes': { outputs: ['labels'] },
  };
  function blueprints() {
    const [W, H] = drawSize();
    const cams = Object.keys(SENSORS).map((id) => ({
      id, tags: ['sensor', 'camera'],
      attributes: { image_size_x: W, image_size_y: H, fov: 90, sensor_tick: 0, amodal: 0, min_pixels: 30,
        ...(id === 'sensor.camera.rgb' ? { exposure_mode: 'auto', exposure_compensation: 0, render_mode: 'raster', samples_per_pixel: 64 } : {}) },
    }));
    return [
      ...vehicleKinds.map((k) => {
        const [w, h, l] = vehDims(k);
        return { id: `vehicle.${k}`, tags: ['vehicle', vehClass(k)], attributes: { class: vehClass(k), width: w, height: h, length: l, color: '', role_name: '', capacity: traffic.pools[k].cap } };
      }),
      ...variants.map((v, i) => ({
        id: `walker.pedestrian.${String(i).padStart(4, '0')}`, tags: ['walker', 'pedestrian', v.age || 'adult', v.gender || ''],
        attributes: { name: v.name, gender: v.gender || '', age: v.age || 'adult', build: v.build || 'regular', uniform: v.uniform || '', speed: 1.3, role_name: '' },
      })),
      // procedural mannequins (server --pedestrians procedural): one blueprint, no third-party assets
      ...(peds && !variants.length ? [{ id: 'walker.pedestrian.procedural', tags: ['walker', 'pedestrian', 'procedural'],
        attributes: { name: 'procedural', gender: '', age: 'adult', build: 'regular', uniform: '', speed: 1.3, role_name: '' } }] : []),
      { id: 'controller.ai.walker', tags: ['controller', 'walker'], attributes: { max_speed: 1.4 } },
      ...cams,
    ];
  }

  // ---------------------------------------------------------------- ground + lanes
  const groundAt = (x3, z3, fallback) => {
    const s = streamer.surfaceAt ? streamer.surfaceAt(x3, z3) : null;
    if (s !== null && s !== undefined && isFinite(s)) return s;
    const t = streamer.terrainAt(x3, z3);
    return t !== null && isFinite(t) ? t : fallback;
  };
  const surfInfo = (x3, z3) => (streamer.surfaceInfoAt ? streamer.surfaceInfoAt(x3, z3, 0.3) : null);
  // nearest lane edge to a three-space point: { e, d, dist, s (sample), side } — brute force over the loaded graph (a
  // few thousand edges; the API calls it per manual car per frame and for map queries)
  function nearestEdge(x, z, maxDist = 40) {
    if (!traffic) return null;
    let best = null, bd = maxDist * maxDist;
    for (const e of traffic.edges.values()) {
      if (e.minor) continue;
      const P = e.pts;
      for (let i = 1; i < P.length; i++) {
        const ax = P[i - 1][0], az = P[i - 1][2], bx = P[i][0], bz = P[i][2];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const px = ax + dx * t, pz = az + dz * t;
        const d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < bd) { bd = d2; best = { e, d: e.cum[i - 1] + Math.sqrt(L2) * t, dist: Math.sqrt(d2) }; }
      }
    }
    return best;
  }
  const lanesFor = (e) => (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2)));
  // where a (lane, dir) sits on an edge at d: three position + heading h
  function lanePose(e, d, dir, lane) {
    const sA = traffic.sampleEdge(e, d - 1.7), sB = traffic.sampleEdge(e, d + 1.7), s = traffic.sampleEdge(e, d);
    let hx = (sB.x - sA.x) * dir, hz = (sB.z - sA.z) * dir;
    const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const off = traffic._laneOffsetAt(e, { dir }, lane);
    return { x: s.x - hz * off, y: s.y, z: s.z + hx * off, h: Math.atan2(hx, hz) };
  }
  // put a car (API or not) on the lane nearest its pose: e, d, dir, lane
  function snapCarToLane(car, x, z, h, maxDist = 12) {
    const ne = nearestEdge(x, z, maxDist);
    if (!ne) return false;
    const e = ne.e;
    const s = traffic.sampleEdge(e, ne.d);
    const dir = (Math.sin(h) * s.dirx + Math.cos(h) * s.dirz) >= 0 ? 1 : -1;
    if (e.oneway !== 0 && dir !== e.oneway && !car.manual) return false;
    // which lane: the lane centre nearest the signed lateral offset (right of travel positive)
    const hx = s.dirx * dir, hz = s.dirz * dir;
    const lat = -(x - s.x) * hz + (z - s.z) * hx;
    let lane = 0, bl = 1e9;
    for (let k = 0; k < lanesFor(e); k++) { const o = traffic._laneOffsetAt(e, { dir }, k); if (Math.abs(o - lat) < bl) { bl = Math.abs(o - lat); lane = k; } }
    if (car.e && car.e !== e && car.e.cars) car.e.cars.delete(car);
    car.e = e; car.d = ne.d; car.dir = dir; car.lane = lane; car.laneF = lane;
    e.cars.add(car);
    return true;
  }

  // ---------------------------------------------------------------- transforms
  function actorTransform(a) {
    if (a.kind === 'spectator') return { location: { ...a.loc }, rotation: { ...a.rot } };
    if (a.kind === 'vehicle') {
      const p = a.car._pose;
      if (!p) return { location: { ...a.st.loc }, rotation: { pitch: 0, yaw: a.st.yaw, roll: 0 } };
      return {
        location: fromThree(new THREE.Vector3(p[0], p[1], p[2])),
        rotation: { pitch: +(-(a.car._pitch || 0) * R2D).toFixed(3), yaw: +wrap180(hToYaw(p[3])).toFixed(3), roll: +((a.car._roll || 0) * R2D).toFixed(3) },
      };
    }
    if (a.kind === 'walker') {
      const m = new THREE.Matrix4(); peds.mesh.getMatrixAt(a.ped.idx, m);
      const v = new THREE.Vector3().setFromMatrixPosition(m);
      const yaw = a.ped.manual ? a.st.yaw : hToYaw(a.ped.yaw ?? 0);
      return { location: fromThree(v), rotation: { pitch: 0, yaw: +wrap180(yaw).toFixed(3), roll: 0 } };
    }
    if (a.kind === 'sensor') return sensorWorld(a);
    if (a.kind === 'controller') return actors.has(a.parent) ? actorTransform(actors.get(a.parent)) : { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 } };
    return { location: { x: 0, y: 0, z: 0 }, rotation: { pitch: 0, yaw: 0, roll: 0 } };
  }
  // compose a child transform (x fwd, y left, z up; yaw/pitch/roll relative to the parent's heading) onto its parent
  function compose(parentT, rel) {
    const psi = parentT.rotation.yaw * D2R;
    const c = Math.cos(psi), s = Math.sin(psi);
    const rl = rel.location || {}, rr = rel.rotation || {};
    return {
      location: {
        x: parentT.location.x + c * (rl.x || 0) - s * (rl.y || 0),
        y: parentT.location.y + s * (rl.x || 0) + c * (rl.y || 0),
        z: parentT.location.z + (rl.z || 0),
      },
      rotation: { pitch: rr.pitch || 0, yaw: wrap180(parentT.rotation.yaw + (rr.yaw || 0)), roll: rr.roll || 0 },
    };
  }
  function sensorWorld(a) {
    if (a.parent && actors.has(a.parent)) return compose(actorTransform(actors.get(a.parent)), a.rel);
    return { location: { ...a.rel.location }, rotation: { pitch: a.rel.rotation.pitch || 0, yaw: a.rel.rotation.yaw || 0, roll: a.rel.rotation.roll || 0 } };
  }
  function velocityOf(a) {
    if (a.kind === 'vehicle') {
      const yaw = actorTransform(a).rotation.yaw * D2R, v = a.car.manual ? a.st.v : (a.car.v || 0);
      return { x: +(Math.cos(yaw) * v).toFixed(4), y: +(Math.sin(yaw) * v).toFixed(4), z: 0 };
    }
    if (a.kind === 'walker') {
      const yaw = actorTransform(a).rotation.yaw * D2R, v = a.ped.manual ? a.st.speed : ((a.ped.waiting || a.ped.stand > 0) ? 0 : a.ped.v || 0);
      return { x: +(Math.cos(yaw) * v).toFixed(4), y: +(Math.sin(yaw) * v).toFixed(4), z: 0 };
    }
    return { x: 0, y: 0, z: 0 };
  }
  function bboxOf(a) {
    if (a.kind === 'vehicle') { const [w, h, l] = vehDims(a.car.kind); return { extent: { x: l / 2, y: w / 2, z: h / 2 }, location: { x: 0, y: 0, z: h / 2 } }; }
    if (a.kind === 'walker') return { extent: { x: 0.2, y: 0.28, z: 0.875 }, location: { x: 0, y: 0, z: 0.875 } };
    return { extent: { x: 0, y: 0, z: 0 }, location: { x: 0, y: 0, z: 0 } };
  }
  function describe(a) {
    const out = { id: a.id, type_id: a.type_id, parent: a.parent || 0, attributes: a.attributes || {} };
    if (a.kind !== 'controller') { out.transform = actorTransform(a); out.velocity = velocityOf(a); }
    if (a.kind === 'vehicle' || a.kind === 'walker') out.bounding_box = bboxOf(a);
    if (a.kind === 'vehicle') out.autopilot = !a.car.manual;
    return out;
  }
  const actorOf = (id, kind) => {
    const a = actors.get(id | 0);
    need(a, 'no_such_actor', `no actor with id ${id}`);
    if (kind) need(a.kind === kind, 'wrong_actor_type', `actor ${id} is a ${a.type_id}, not a ${kind}`);
    return a;
  };

  // ---------------------------------------------------------------- spawning
  // the background cars a new API car would stand on, taken off the road: spawned on an occupied point the two were drawn
  // in one place, and the car behind drove on through the API car (it follows leaders ahead of its own front). Boxes
  // 0.5 m longer and 0.3 m wider each side than the bodies, on the same level
  function clearSpawn(kind, x, y, z, h) {
    const box = (cx, cz, hh, k) => { const [w, , l] = vehDims(k); return { c: [cx, cz], f: [Math.sin(hh), Math.cos(hh)], r: [Math.cos(hh), -Math.sin(hh)], hw: w / 2 + 0.3, hl: l / 2 + 0.5 }; };
    const over = (P, Q) => [P.f, P.r, Q.f, Q.r].every((ax) => {
      const d = Math.abs((Q.c[0] - P.c[0]) * ax[0] + (Q.c[1] - P.c[1]) * ax[1]);
      const rad = (B) => B.hl * Math.abs(B.f[0] * ax[0] + B.f[1] * ax[1]) + B.hw * Math.abs(B.r[0] * ax[0] + B.r[1] * ax[1]);
      return d <= rad(P) + rad(Q);
    });
    const A = box(x, z, h, kind);
    let n = 0;
    for (let i = traffic.cars.length - 1; i >= 0; i--) {
      const c = traffic.cars[i], p = c._pose;
      if (c.api || !p || Math.abs(p[1] - y) > 3 || Math.hypot(p[0] - x, p[2] - z) > 30) continue;
      if (over(A, box(p[0], p[2], p[3], c.kind))) { traffic._remove(i); n++; }
    }
    return n;
  }
  function spawnVehicle(bpId, attrs, T) {
    need(traffic, 'no_traffic', 'the traffic simulation is not running');
    const kind = bpId.slice('vehicle.'.length);
    const pool = traffic.pools[kind];
    need(pool, 'unknown_blueprint', `unknown vehicle blueprint ${bpId}`);
    need(pool.n < pool.cap, 'pool_full', `no free ${kind} slot (${pool.cap} in use)`);
    const p3 = toThree(T.location);
    const h = yawToH(T.rotation.yaw || 0);
    const y = groundAt(p3.x, p3.z, p3.y);
    clearSpawn(kind, p3.x, y, p3.z, h);
    let color = 0xffffff;
    if (attrs.color) {
      const c = String(attrs.color).split(',').map(Number);
      if (c.length === 3 && c.every(isFinite)) color = (c[0] << 16) | (c[1] << 8) | c[2];
    } else color = [0x1b1d21, 0xe9e9e6, 0x6d737a, 0x14233b, 0x7a1512, 0x2a3a2a][Math.floor(Math.random() * 6)];
    if (/taxi/.test(kind) && !attrs.color) color = 0xf7b500;
    const id = nextId++;
    const car = { api: id, manual: true, kind, color, idx: pool.n++, v: 0, e: { cars: new Set() }, d: 0, dir: 1, lane: 0, laneF: 0, _lfv: 0, __percUid: `api${id}` };   // _lfv: the lane-change spring's rate (sim/traffic.js TW26); undefined made every API car's pose NaN on autopilot
    traffic._c.set(color);
    pool.mb.setColorAt(car.idx, traffic._c);
    pool.mb.instanceColor.needsUpdate = true;
    pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
    for (const m of pool.mx) m.count = pool.mb.count;
    traffic.cars.push(car);
    traffic.apiCount++;
    const a = {
      id, type_id: bpId, kind: 'vehicle', car, attributes: { ...attrs, color: `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}` },
      control: { throttle: 0, steer: 0, brake: 0, hand_brake: false, reverse: false },
      st: { x: p3.x, y, z: p3.z, h, v: 0, yawRate: 0, targetV: null, loc: T.location, yaw: T.rotation.yaw || 0 },
    };
    traffic._placeCar(car, p3.x, y + 0.002, p3.z, h, 1 / 30);
    snapCarToLane(car, p3.x, p3.z, h, 12);
    if (heroAttr(attrs)) { a.body = new CarBody(PP, { car, x: p3.x, z: p3.z, h }); a.body.y = y; }
    actors.set(id, a);
    return a;
  }
  function spawnWalker(bpId, attrs, T) {
    need(peds, 'no_walkers', 'the pedestrian simulation is not running');
    const procedural = bpId === 'walker.pedestrian.procedural' && !variants.length;
    const vi = procedural ? -1 : parseInt(bpId.split('.').pop(), 10);
    need(procedural || (isFinite(vi) && vi >= 0 && vi < variants.length), 'unknown_blueprint', `unknown walker blueprint ${bpId}`);
    need(peds.peds.length < peds.cap, 'pool_full', 'no free walker slot');
    const pi = rig.pool ? rig.pool.indexOf(vi) : -1;
    const skin = pi >= 0 ? (pi + 0.5) / rig.pool.length : Math.random();
    const p3 = toThree(T.location);
    const y = groundAt(p3.x, p3.z, p3.y);
    const id = nextId++;
    const speed = num(attrs.speed, 1.3);
    const col = new THREE.Color().setHSL(Math.random(), 0.05 + Math.random() * 0.1, 0.08 + Math.random() * 0.25);
    const ped = {
      api: id, manual: true, e: null, d: 0, dir: 1, v: speed, lat: 0,
      phase: Math.random() * 10, idx: peds.peds.length, skin, build: 1, amp: 1,
      mask: num(attrs.outfit, 1), bagTone: Math.random(), umbTone: Math.random(), __percUid: `api${id}`,
    };
    peds.peds.push(ped);
    peds.mesh.setColorAt(ped.idx, col);
    ped.color = col.clone();
    peds.mesh.instanceColor.needsUpdate = true;
    rig.setAnim(ped.idx, ped.phase, speed * 4.4, 1, skin);
    rig.setStyle(ped.idx, ped.mask, ped.bagTone, ped.umbTone);
    peds.mesh.count = peds.peds.length;
    peds.apiCount++;
    const a = {
      id, type_id: bpId, kind: 'walker', ped, attributes: { ...attrs, name: variants[vi]?.name || '' },
      control: { direction: { x: 0, y: 0, z: 0 }, speed: 0, jump: false },
      st: { x: p3.x, y, z: p3.z, yaw: T.rotation.yaw || 0, speed: 0, maxSpeed: speed },
      route: null,
    };
    if (heroAttr(attrs)) a.body = new WalkerBody(PP, { ped, x: p3.x, z: p3.z, h: yawToH(a.st.yaw) });
    actors.set(id, a);
    placeWalker(a, 0);
    return a;
  }
  function spawnSensor(bpId, attrs, T, parent) {
    need(SENSORS[bpId], 'unknown_blueprint', `unknown sensor blueprint ${bpId}`);
    if (parent) actorOf(parent);
    const [W, H] = drawSize();
    const id = nextId++;
    const a = {
      id, type_id: bpId, kind: 'sensor', parent: parent || 0, rel: T, listening: false,
      attributes: {
        image_size_x: num(attrs.image_size_x, W) | 0, image_size_y: num(attrs.image_size_y, H) | 0,
        fov: num(attrs.fov, 90), sensor_tick: num(attrs.sensor_tick, 0),
        amodal: num(attrs.amodal, 0) | 0, min_pixels: num(attrs.min_pixels, 30) | 0,
        role_name: attrs.role_name || '',
      },
      outputs: SENSORS[bpId].outputs, lastT: -1e9,
    };
    if (bpId === 'sensor.camera.rgb') {
      // RGB renders through the full post chain at the window's resolution (the server's --res)
      a.attributes.image_size_x = W; a.attributes.image_size_y = H;
      // as CARLA's camera: metered per frame (auto) or the time of day's fixed exposure (manual), plus a compensation in
      // EV (a renderer client applies them; the page's own frame keeps its fixed exposure)
      a.attributes.exposure_mode = attrs.exposure_mode === 'manual' ? 'manual' : 'auto';
      a.attributes.exposure_compensation = num(attrs.exposure_compensation, 0);
    }
    actors.set(id, a);
    return a;
  }
  function spawnController(bpId, attrs, parent) {
    need(bpId === 'controller.ai.walker', 'unknown_blueprint', `unknown controller ${bpId}`);
    const w = actorOf(parent, 'walker');
    const id = nextId++;
    const a = { id, type_id: bpId, kind: 'controller', parent: w.id, attributes: { ...attrs }, state: 'stopped', maxSpeed: num(attrs.max_speed, 1.4) };
    w.ai = a;
    actors.set(id, a);
    return a;
  }
  function destroy(id) {
    const a = actors.get(id | 0);
    if (!a || a.kind === 'spectator') return false;
    // children first (sensors / controllers attached to it)
    for (const c of [...actors.values()]) if (c.parent === a.id) destroy(c.id);
    if (a.kind === 'vehicle') {
      const ci = traffic.cars.indexOf(a.car);
      if (ci >= 0) { if (!a.car.e?.cars) a.car.e = { cars: new Set() }; traffic._remove(ci); }
      traffic.apiCount = Math.max(0, traffic.apiCount - 1);
    } else if (a.kind === 'walker') {
      const i = peds.peds.indexOf(a.ped);
      if (i >= 0) peds._remove(i);
      peds.apiCount = Math.max(0, peds.apiCount - 1);
    }
    actors.delete(a.id);
    return true;
  }

  // ---------------------------------------------------------------- per-frame physics
  // manual vehicle: a kinematic bicycle model on the road surface. steer > 0 turns RIGHT (like CARLA).
  function stepVehicle(a, dt) {
    const c = a.control, s = a.st, car = a.car;
    if (a.body && s.targetV === null) {
      const b = a.body;
      b.step(c, dt); b.place(dt);
      s.x = b.x; s.y = b.y; s.z = b.z; s.h = b.h; s.v = b.v;
      return;
    }
    const [, , len] = vehDims(car.kind);
    const wheelbase = Math.max(2.2, len * 0.6);
    if (s.targetV !== null) s.v = s.targetV;
    else {
      const gear = c.reverse ? -1 : 1;
      const vmax = c.reverse ? 6 : 38;
      let acc = gear * clamp(c.throttle, 0, 1) * 3.4 * Math.max(0, 1 - Math.abs(s.v) / vmax);
      const brake = clamp(c.brake, 0, 1) * 8.0 + (c.hand_brake ? 9 : 0) + 0.25 + 0.0004 * s.v * s.v;
      const sv = Math.sign(s.v);
      let v = s.v + acc * dt;
      if (sv !== 0) { const dv = brake * dt; v = Math.abs(v) <= dv && Math.sign(v) === sv ? 0 : v - sv * dv; }
      if (sv !== 0 && Math.sign(v) === -sv && acc * sv >= 0) v = 0;   // braking never reverses the car
      s.v = v;
    }
    const delta = -clamp(c.steer, -1, 1) * 35 * D2R;                   // left positive in ENU
    const yawRate = (s.v / wheelbase) * Math.tan(delta);
    // integrate in ENU (psi = API yaw), then back to three
    let psi = hToYaw(s.h) * D2R;
    psi += yawRate * dt;
    const ex = Math.cos(psi), ny = Math.sin(psi);
    s.x += ex * s.v * dt;
    s.z += -ny * s.v * dt;
    s.h = yawToH(psi * R2D);
    s.y = groundAt(s.x, s.z, s.y);
    car.v = Math.abs(s.v);
    traffic._placeCar(car, s.x, s.y + 0.002, s.z, s.h, Math.max(dt, 1e-3));
    if (dt > 0) snapCarToLane(car, s.x, s.z, s.h, 8);
  }
  function placeWalker(a, dt) {
    const s = a.st, p = a.ped;
    // route following (controller.ai.walker go_to_location)
    if (a.route && a.route.pts.length) {
      const R = a.route;
      let tx = R.pts[R.i][0], tz = R.pts[R.i][1];
      let dx = tx - s.x, dz = tz - s.z, dist = Math.hypot(dx, dz);
      while (dist < 0.35 && R.i < R.pts.length - 1) { R.i++; tx = R.pts[R.i][0]; tz = R.pts[R.i][1]; dx = tx - s.x; dz = tz - s.z; dist = Math.hypot(dx, dz); }
      if (dist < 0.35 && R.i >= R.pts.length - 1) { a.route = null; s.speed = 0; if (a.ai) a.ai.state = 'arrived'; }
      else {
        let sp = Math.min(R.speed, dist / Math.max(dt, 1e-3));
        // A LEG OVER THE CARRIAGEWAY is a crossing (as sim/peds.js): wait at the kerb for a WALK long enough to finish
        // it (+5 s of amber and all-red) and for no car in the way; once on it, stand behind a car that is right ahead
        if (R.legI !== R.i) {
          R.legI = R.i; R.onLeg = false;
          const si = surfInfo((s.x + tx) / 2, (s.z + tz) / 2);
          R.legRoad = !!(si && si.road) && dist > 5;
        }
        if (R.legRoad && dt > 0) {
          if (!R.onLeg) {
            let go = true;
            const sig = (peds.signals || []).some(([sx, sz]) => Math.abs(sx - s.x) < 14 && Math.abs(sz - s.z) < 14);
            if (sig) go = walkTimeLeft(traffic ? traffic.time : 0, Math.abs(dx) > Math.abs(dz)) + 5 >= dist / Math.max(0.5, R.speed);
            if (go && peds._carInPath && peds._carInPath(s.x, s.z, tx, tz)) go = false;
            if (go) R.onLeg = true; else sp = 0;
          } else if ((R.chk = (R.chk || 0) - dt) <= 0) {
            R.chk = 0.25;
            R.blocked = !!(peds._carInPath && peds._carInPath(s.x, s.z, s.x + (dx / dist) * 1.6, s.z + (dz / dist) * 1.6));
          }
          if (R.onLeg && R.blocked) sp = 0;
        }
        a.control = { direction: { x: dx / dist, y: -dz / dist, z: 0 }, speed: sp, jump: false };
      }
    }
    const c = a.control;
    const dl = Math.hypot(c.direction.x || 0, c.direction.y || 0);
    if (a.body) {
      // CONTROL: the hero walker collides (buildings, furniture, cars); ENU direction -> three (x, -y)
      const b = a.body, sp = a.route || dl > 1e-6 ? clamp(num(c.speed, 0), 0, 6) : 0;
      if (dt > 0) b.step({ dx: dl > 1e-6 ? c.direction.x : 0, dz: dl > 1e-6 ? -c.direction.y : 0, speed: sp }, dt);
      b.place();
      s.x = b.x; s.y = b.y; s.z = b.z; s.yaw = wrap180(hToYaw(b.h)); s.speed = b.v;
      p.yaw = b.h;
      return;
    }
    const speed = a.route || dl > 1e-6 ? clamp(num(c.speed, 0), 0, 12) : 0;
    s.speed = speed;
    if (dl > 1e-6 && dt > 0) {
      const ux = c.direction.x / dl, uy = c.direction.y / dl;
      s.x += ux * speed * dt;
      s.z += -uy * speed * dt;
      // DK04: a walker on a route slides along a subway stair head instead of through it (the sidewalk graph runs through)
      if (DK04 && a.route) { const q = st38PushOut(s.x, s.z); if (q) { s.x = q[0]; s.z = q[1]; } }
      // turn toward the walking direction at <= 300 deg/s (as sim/peds.js does)
      const want = Math.atan2(uy, ux) * R2D;
      let d = wrap180(want - s.yaw);
      const m = 300 * dt;
      s.yaw = wrap180(s.yaw + (Math.abs(d) <= m ? d : Math.sign(d) * m));
    }
    s.y = groundAt(s.x, s.z, s.y);
    const h = yawToH(s.yaw);
    p.yaw = h;
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, h, 0)), new THREE.Vector3(1, 0.92 + ((p.idx * 29) % 10) / 55, 1));
    peds.mesh.setMatrixAt(p.idx, m4);
    if (rig.st) rig.st.speed[p.idx] = Math.max(0.3, speed);
    rig.setAmp(p.idx, speed > 0.08 ? 1 : 0);
  }

  // ---------------------------------------------------------------- camera
  const drawSize = () => { const v = new THREE.Vector2(); engine.renderer.getDrawingBufferSize(v); return [v.x | 0, v.y | 0]; };
  // The PRIMARY camera is the view the server window shows and the one a tick's own frame renders, so its RGB comes
  // straight off that frame and its labels need no camera switch: the first listening RGB camera, else the first
  // listening camera of any kind, else the first RGB camera, else the spectator.
  function primarySensor() {
    let rgbL = null, anyL = null, rgb = null;
    for (const a of actors.values()) {          // insertion order is id order
      if (a.kind !== 'sensor') continue;
      const isRgb = a.type_id === 'sensor.camera.rgb';
      if (isRgb && a.listening && !rgbL) rgbL = a;
      if (a.listening && !anyL) anyL = a;
      if (isRgb && !rgb) rgb = a;
    }
    return rgbL || anyL || rgb;
  }
  // a camera pose; the vertical fov follows from the horizontal one at the image's aspect
  function poseFor(T, hfov, aspect) {
    return { p: toThree(T.location), q: camQuat(T.rotation), fov: hfovToVfov(hfov, aspect), aspect };
  }
  const winAspect = () => { const [W, H] = drawSize(); return W / H; };
  // what the window renders: the primary camera at the window's shape (a label camera of another shape is a switch)
  function viewPose() {
    const pr = primarySensor();
    if (pr) return poseFor(sensorWorld(pr), pr.attributes.fov, winAspect());
    return poseFor({ location: spectator.loc, rotation: spectator.rot }, 90, winAspect());
  }
  const samePose = (pose) => {
    const c = engine.camera;
    return pose.p.distanceTo(c.position) < 1e-4 && 1 - Math.abs(pose.q.dot(c.quaternion)) < 1e-9
      && Math.abs(pose.fov - c.fov) < 1e-4 && Math.abs(pose.aspect - c.aspect) < 1e-6;
  };
  function updateCamera() {
    cam.center.copy(toThree(spectator.loc));
    cam.pose = viewPose();
    cam.apply(cam.pose);
  }

  // ---------------------------------------------------------------- per-camera temporal state
  // The TAA history (core/engine.js TAAPass: histA / histB and the view-projection they were rendered with) and the
  // engine's still/moving detector (_still, _pp, _pq) describe ONE view. An RGB camera switch parks the current view's
  // state and swaps in the new view's own, so every RGB camera converges as if it were the only one and the primary view
  // comes back to its own history. (Resetting the TAA on every switch left multi-camera RGB aliased, and every switch
  // read as camera motion, which kept the jitter off.)
  const temporal = new Map();   // view key -> parked state
  let activeView = 'primary';
  function swapView(key) {
    const T = engine.taa;
    if (!T || key === activeView) return;
    temporal.set(activeView, {
      histA: T.histA, histB: T.histB, prevVP: T.prevVP.clone(), first: T._first,
      still: engine._still, pp: engine._pp ? engine._pp.clone() : null, pq: engine._pq ? engine._pq.clone() : null, used: frame,
    });
    const W = T.histA.width, H = T.histA.height;
    let s = temporal.get(key);
    if (s && (s.histA.width !== W || s.histA.height !== H)) { s.histA.dispose(); s.histB.dispose(); s = null; }
    if (!s) {
      const mk = () => new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
      s = { histA: mk(), histB: mk(), prevVP: new THREE.Matrix4(), first: true, still: 1, pp: null, pq: null };
    }
    temporal.delete(key);
    T.histA = s.histA; T.histB = s.histB; T.prevVP.copy(s.prevVP); T._first = s.first;
    engine._still = s.still;
    // a new view starts out still at its own pose; a known one compares against where it last rendered
    if (engine._pp) engine._pp.copy(s.pp || engine.camera.position);
    if (engine._pq) engine._pq.copy(s.pq || engine.camera.quaternion);
    activeView = key;
  }

  // ---------------------------------------------------------------- CONTROL: follow camera, takes
  // a body-like view of any vehicle / walker actor (the hero's own body, else its sim pose) for the camera and the recorder
  function takeBody(a) {
    if (a.body) return a.body;
    const T = actorTransform(a), p3 = toThree(T.location), v = Math.hypot(velocityOf(a).x, velocityOf(a).y);
    const kind = a.kind === 'vehicle' ? a.car.kind : null;
    const hh = kind ? traffic.carHalf({ kind }) : [0.3, 0.3];
    return { x: p3.x, y: p3.y, z: p3.z, h: yawToH(T.rotation.yaw), v, hw: hh[0], hl: hh[1], ht: (traffic.vehDims?.[kind] || [0, 1.5])[1], car: a.car, kind, hidden: false,
      pose() { return [this.x, this.y, this.z, this.h, this.v, 0]; } };
  }
  function followStep(dt) {
    const a = actors.get(follow.id);
    if (!follow.cam) follow.cam = new FollowCam(engine, PP);
    const F = follow.cam, b = takeBody(a);
    F.auto = true;
    if (a.kind === 'vehicle') { F.mode = follow.mode === 'bonnet' ? 'bonnet' : 'chase'; F.car(b, dt); }
    else { F.mode = follow.mode === 'first' ? 'first' : 'third'; F.walker(b, dt); if (a.body) a.body.place(); }
    // the camera the follow wrote -> the spectator's API transform (camQuat's inverse)
    const c = engine.camera, e = new THREE.Euler().setFromQuaternion(c.quaternion, 'YXZ');
    spectator.loc = fromThree(c.position);
    spectator.rot = { pitch: +(e.x * R2D).toFixed(4), yaw: +(Math.atan2(Math.cos(e.y), -Math.sin(e.y)) * R2D).toFixed(4), roll: +(-e.z * R2D).toFixed(4) };
  }

  // ---------------------------------------------------------------- frame hooks (main.js onFrame)
  // Between ticks in synchronous mode nothing moves. world.apply_settings(idle_nap_ms=N) lets the loop nap N ms between
  // idle frames (core/engine.js idleNap): the window, the tile stream and the dresser keep going at a few fps and the
  // GPU rests while the client works. Off by default: on the RTX laptop it saved power but not time (the first frame
  // after a nap came late about half the time). Every handler that needs frames sets busy and wakes the loop first.
  engine.idleNap = () => (settings.synchronous_mode && !busy ? settings.idle_nap_ms : 0);
  function preStep(dt) {
    if (dt > 0) for (const a of actors.values()) if (a.kind === 'vehicle' && a.car.manual) stepVehicle(a, dt);
    if (!busy) { cam.center.copy(toThree(spectator.loc)); cam.pose = viewPose(); }
  }
  function postStep(dt) {
    let any = false;
    const X = traffic ? (traffic._crossers || (traffic._crossers = [])) : null;
    for (const a of actors.values()) {
      if (a.kind !== 'walker' || !a.ped.manual) continue;
      placeWalker(a, dt);
      any = true;
      // a walker off the footway (roadway, crosswalk paint, gutter, bus lane) stops the cars (traffic.js _pedGap)
      if (X) { const si = surfInfo(a.st.x, a.st.z); if (!si || !FOOTWAY.test(si.kind || '')) X.push(a.st.x, a.st.z); }
    }
    if (any) peds.mesh.instanceMatrix.needsUpdate = true;
    // CONTROL: the spectator rides the play mode's follow camera on its actor (after the bodies moved this frame)
    if (follow.id && dt > 0 && actors.has(follow.id)) followStep(dt);
    // attached cameras follow their parent AFTER the sims moved it this frame; in a tick's own frame too, so what that
    // frame renders is already the primary camera's post-step view
    if (!busy || stepWait) updateCamera();
    if (takeRec && dt > 0 && actors.has(takeRec.id)) takeRec.rec.sample(dt, takeBody(actors.get(takeRec.id)));
    if (stepWait && dt > 0) { const r = stepWait; stepWait = null; r(); }
  }

  // ---------------------------------------------------------------- stepping
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // the RGBA of the next beauty frame the engine draws, read back in that frame's own task (core/engine.js _grab)
  // (a process that draws nothing, the headless core with its renderer gone: no image, the RGB sensor skips the tick)
  const grab = () => (engine.headless ? Promise.resolve(null) : new Promise((res, rej) => { engine._grab = { res, rej }; }));
  // One fixed step is ONE engine frame. main.js consumes the pending dt in its next frame, whose postStep resolves
  // stepWait; the awaiting code resumes (a microtask) once that frame's rAF callback, render included, has returned.
  // main.js's own promise resolves a frame later: the fallback if the frame body threw before postStep.
  let stepWait = null;
  function advance(dt) {
    if (!(dt > 0)) return nextFrame();
    const done = new Promise((r) => { stepWait = r; });
    return Promise.race([done, window.__advance(dt)]).finally(() => { stepWait = null; });
  }
  // the listening sensors due at sim time t (sensor_tick 0: every tick)
  const dueSensors = (t) => [...actors.values()].filter((a) => a.kind === 'sensor' && a.listening && t - a.lastT >= a.attributes.sensor_tick - 1e-6);
  async function tick(params = {}) {
    need(settings.synchronous_mode, 'not_synchronous', 'world.tick needs synchronous mode (world.apply_settings)');
    const dt = num(params.dt, settings.fixed_delta_seconds);
    const t0 = performance.now();
    let timing = null;
    busy = true;
    engine.wake?.();
    try {
      updateCamera();
      const due = dueSensors(simTime + dt);
      // the primary RGB camera's image is the step's own frame, read back in its task
      const pr = primarySensor();
      const stepRgb = pr && pr.type_id === 'sensor.camera.rgb' && due.includes(pr) && !(perc() && perc().group) ? grab() : null;
      await advance(dt);
      frame++; simTime += dt;
      // where the tick's time went (ms): the step frame, then one entry per sensor group
      timing = { step_ms: +(performance.now() - t0).toFixed(1), sensors: [] };
      await runSensors(due, stepRgb, timing.sensors);
      timing.total_ms = +(performance.now() - t0).toFixed(1);
    } finally { busy = false; engine._grab = null; }
    return { frame, timestamp: +simTime.toFixed(6), timing };
  }
  // asynchronous mode: main.js free-runs the sim on real time (window.__FREERUN); sensors fire on their own clock
  let asyncLoop = null;
  function setAsync(on) {
    freeRun = on;
    window.__FREERUN_ON = on;
    engine.wake?.();
    if (on && !asyncLoop) {
      let last = performance.now();
      asyncLoop = setInterval(async () => {
        if (!freeRun || busy) return;
        const now = performance.now();
        simTime += Math.min(0.1, (now - last) / 1000); last = now;
        frame++;
        const due = dueSensors(simTime);
        if (due.length) { busy = true; window.__FREERUN_ON = false; try { await runSensors(due, null); } finally { busy = false; window.__FREERUN_ON = freeRun; } }
      }, 16);
    } else if (!on && asyncLoop) { clearInterval(asyncLoop); asyncLoop = null; }
  }

  // ---------------------------------------------------------------- sensors
  const flipRows = (src, W, H, bpp) => {
    const out = new Uint8Array(W * H * bpp), row = W * bpp;
    for (let y = 0; y < H; y++) out.set(src.subarray((H - 1 - y) * row, (H - y) * row), y * row);
    return out;
  };
  // class colour -> class id (the semantic pass writes the palette colour): a 16 MB table indexed by the 24-bit
  // colour, built once; a Map lookup per pixel cost 15 ms a frame at 1280x720
  let colorToClass = null;
  function classPlane(buf, W, H) {
    if (!colorToClass) {
      colorToClass = new Uint8Array(1 << 24);
      for (const c of perc().classes) colorToClass[(c.rgb[0] << 16) | (c.rgb[1] << 8) | c.rgb[2]] = c.id;
    }
    const out = new Uint8Array(W * H), L = colorToClass;
    for (let y = 0; y < H; y++) {
      const s = (H - 1 - y) * W * 4, o = y * W;
      for (let x = 0; x < W; x++) { const i = s + x * 4; out[o + x] = L[(buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]]; }
    }
    return out;
  }
  function depthPlane(buf, W, H, maxM) {
    const out = new Float32Array(W * H), k = maxM / 16777215;
    for (let y = 0; y < H; y++) {
      const s = (H - 1 - y) * W * 4, o = y * W;
      for (let x = 0; x < W; x++) { const i = s + x * 4; out[o + x] = ((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]) * k; }
    }
    return out;
  }
  // map a perception label row to its API actor (keys veh:<kind>:api<id> / ped:api<id>)
  function labelActor(key) {
    const m = /api(\d+)$/.exec(key || '');
    return m && actors.has(+m[1]) ? +m[1] : 0;
  }
  function labelsOut(labels, T) {
    const inst = labels.instances.map((r) => {
      const o = {
        id: r.id, class_id: r.class_id, class: r.class, actor_id: labelActor(r.key),
        bbox: r.bbox, area: r.area, truncated: r.truncated,
      };
      if (r.amodal_bbox) { o.amodal_bbox = r.amodal_bbox; o.occlusion = r.occlusion ?? 0; }
      if (r.pose && r.pose.pos) {
        const p = r.pose.pos;
        o.location = fromThree(new THREE.Vector3(p[0], p[1], p[2]));
        if (r.pose.yaw !== undefined) o.yaw = +wrap180(hToYaw(r.pose.yaw)).toFixed(3);
        if (r.pose.dims) o.extent = { x: r.pose.dims[2] / 2, y: r.pose.dims[0] / 2, z: r.pose.dims[1] / 2 };
      }
      return o;
    });
    return { camera: labels.camera, sensor_transform: T, instances: inst, classes: labels.classes };
  }
  // One capture per group of sensors that share a pose (same parent, relative transform, fov and image size).
  // The PRIMARY camera's group goes first: the tick's own frame was rendered from its pose, so every per-camera cull
  // (instancer, crowd, fleet) already matches it, and its RGB is that frame. Any other pose is a camera switch. The culls
  // follow engine.camera in the next frame's sim update (ApiCam applies the pose before traffic and peds update), so ONE
  // dt = 0 frame is enough (film-8 API test: label passes read without it drew the road users culled for the OTHER
  // camera). A label-only group runs that frame without drawing it (engine.skipDraw); an RGB group draws it with its own
  // TAA history swapped in, and that frame is its image.
  // The headless core with a renderer client attached (core/api/render.mjs, docs/specs/render-protocol.md): one
  // render.capture per group, the primary group first, each answered with its planes in the protocol's own formats (rows
  // top to bottom, class ids, metres), so nothing is converted here; labels go through labelsOut as the page's do.
  async function renderClientSensors(P, ordered, pr, tlog) {
    for (const [, g] of ordered) {
      const lead = g[0];
      const T = sensorWorld(lead);
      const W = lead.attributes.image_size_x, H = lead.attributes.image_size_y;
      const outs = [...new Set(g.flatMap((a) => a.outputs))];
      const t0 = performance.now();
      let r;
      try {
        r = await P.group({ frame, t: simTime, primary: g.includes(pr), sensors: g.map((a) => a.id), outputs: outs, width: W, height: H, fov: lead.attributes.fov,
          transform: T, pose: poseFor(T, lead.attributes.fov, W / H), amodal: Math.max(0, ...g.map((a) => a.attributes.amodal || 0)),
          min_pixels: Math.min(...g.map((a) => a.attributes.min_pixels || 30)),
          exposure: (({ attributes: x }) => ({ mode: x.exposure_mode || 'auto', compensation: x.exposure_compensation || 0 }))(g.find((a) => a.type_id === 'sensor.camera.rgb') || lead),
          // (render_mode 'pathtrace': the renderer's path tracer, samples_per_pixel samples, for a renderer that has one)
          ...(((x) => (x && x.attributes.render_mode === 'pathtrace' ? { mode: 'pathtrace', spp: x.attributes.samples_per_pixel || 64 } : {}))(g.find((a) => a.type_id === 'sensor.camera.rgb'))) });
      } catch (e) {
        if (tlog) tlog.push({ sensors: g.map((a) => a.id), error: e.code || 'internal' });
        continue;
      }
      for (const a of g) {
        const meta = { event: 'sensor', sensor: a.id, type_id: a.type_id, frame, timestamp: +simTime.toFixed(6), transform: T, width: r.width || W, height: r.height || H, fov: a.attributes.fov };
        let blob = null;
        if (a.type_id === 'sensor.camera.rgb') { blob = r.planes.rgb; meta.format = 'rgba8'; }
        else if (a.type_id === 'sensor.camera.semantic_segmentation') { blob = r.planes.semantic; meta.format = 'class_u8'; }
        else if (a.type_id === 'sensor.camera.instance_segmentation') { blob = r.planes.instance; meta.format = 'instance_rgba8'; if (r.labels) meta.labels = labelsOut(r.labels, T); }
        else if (a.type_id === 'sensor.camera.depth') { blob = r.planes.depth; meta.format = 'depth_f32'; meta.depth_max = r.depth_max; }
        else if (a.type_id === 'sensor.camera.bounding_boxes') { meta.format = 'labels'; if (r.labels) meta.labels = labelsOut(r.labels, T); else continue; }
        if (a.type_id !== 'sensor.camera.bounding_boxes' && !blob) continue;
        a.lastT = simTime;
        emit(a.owner, meta, blob ? [blob] : []);
      }
      if (tlog) tlog.push({ sensors: g.map((a) => a.id), switch: !g.includes(pr), render_ms: r.ms, renderer: r.timing || null, total_ms: +(performance.now() - t0).toFixed(1) });
    }
  }
  async function runSensors(live, stepRgb, tlog = null) {
    live = live.filter((a) => a.listening && actors.has(a.id));
    if (!live.length) return;
    const P = perc();
    const groups = new Map();
    for (const a of live) {
      const key = JSON.stringify([a.parent, a.rel, a.attributes.fov, a.attributes.image_size_x, a.attributes.image_size_y]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const pr = primarySensor();
    const primaryPose = viewPose();
    const ordered = [...groups.entries()].sort(([, g1], [, g2]) => (g2.includes(pr) ? 1 : 0) - (g1.includes(pr) ? 1 : 0));
    if (P && P.group) return renderClientSensors(P, ordered, pr, tlog);
    try {
      for (const [key, g] of ordered) {
        const lead = g[0];
        const T = sensorWorld(lead);
        const W = lead.attributes.image_size_x, H = lead.attributes.image_size_y;
        const pose = poseFor(T, lead.attributes.fov, W / H);
        const outs = new Set(g.flatMap((a) => a.outputs));
        const same = samePose(pose);
        let tg = performance.now();
        const lg = tlog ? { sensors: g.map((a) => a.id), switch: !same } : null;
        const lap = (k) => { if (!lg) return; const n = performance.now(); lg[k] = +(n - tg).toFixed(1); tg = n; };
        // cam.pose too: the capture spans engine frames, and ApiCam.update re-applies cam.pose on every one of them
        cam.pose = pose;
        cam.apply(pose);
        let rgb = null;
        if (!same) {
          if (outs.has('rgb')) { swapView(key); rgb = await grab(); }
          else { engine.skipDraw = true; await nextFrame(); }
        } else if (outs.has('rgb')) {
          rgb = (g.includes(pr) && stepRgb ? await stepRgb : null) || await grab();
        }
        lap(same ? 'rgb_ms' : 'switch_ms');
        const needLabels = outs.has('labels') || outs.has('instance');
        const amodal = Math.max(0, ...g.map((a) => a.attributes.amodal || 0));
        const cap = P && (needLabels || outs.has('semantic') || outs.has('depth')) ? await P.capture({
          raw: true, sync: true, size: [W, H], frame, t: simTime,
          minpx: Math.min(...g.map((a) => a.attributes.min_pixels || 30)),
          amodalmax: amodal, amodal, amodalbuildings: amodal ? 2 : 0,
          want: { rgb: 0, labels: needLabels ? 1 : 0, instance: outs.has('instance') ? 1 : 0, semantic: outs.has('semantic') ? 1 : 0, depth: outs.has('depth') ? 1 : 0, depth_vis: 0, amodal: 0, panel: 0 },
        }) : null;
        lap('labels_ms');
        if (lg && cap && cap.timing) lg.labels = cap.timing;
        for (const a of g) {
          const meta = { event: 'sensor', sensor: a.id, type_id: a.type_id, frame, timestamp: +simTime.toFixed(6), transform: T, width: W, height: H, fov: a.attributes.fov };
          let blob = null;
          if (a.type_id === 'sensor.camera.rgb') {
            if (!rgb) continue;
            meta.width = rgb.W; meta.height = rgb.H; meta.format = 'rgba8';
            blob = flipRows(rgb.px, rgb.W, rgb.H, 4);
          } else if (!cap) {
            continue;
          } else if (a.type_id === 'sensor.camera.semantic_segmentation') {
            meta.format = 'class_u8';
            blob = classPlane(cap.raw.semantic, W, H);
          } else if (a.type_id === 'sensor.camera.instance_segmentation') {
            meta.format = 'instance_rgba8';
            meta.labels = labelsOut(cap.labels, T);
            blob = flipRows(cap.raw.instance, W, H, 4);
          } else if (a.type_id === 'sensor.camera.depth') {
            meta.format = 'depth_f32';
            meta.depth_max = cap.labels.depth.max_m;
            blob = new Uint8Array(depthPlane(cap.raw.depth, W, H, cap.labels.depth.max_m).buffer);
          } else if (a.type_id === 'sensor.camera.bounding_boxes') {
            meta.format = 'labels';
            meta.labels = labelsOut(cap.labels, T);
          }
          a.lastT = simTime;
          emit(a.owner, meta, blob ? [blob] : []);
        }
        lap('encode_send_ms');
        if (lg) tlog.push(lg);
      }
    } finally {
      // back to the view the window renders: its pose and its own TAA history
      cam.pose = primaryPose;
      cam.apply(primaryPose);
      swapView('primary');
      engine.skipDraw = false;
      for (const [k, s] of temporal) if (frame - s.used > 200) { s.histA.dispose(); s.histB.dispose(); temporal.delete(k); }
    }
    updateCamera();
  }

  // ---------------------------------------------------------------- walk routing (controller.ai.walker)
  // graph: every sidewalk edge of sim/peds.js (both directions) plus CROSSING links from each edge end to the two
  // nearest other edge ends 5-34 m away (the same rule peds.js uses at corners), A* over it.
  function walkRoute(from3, to3) {
    const E = peds.walkEdges.filter((e) => !e.dead && e.pts && e.pts.length >= 2 && e.len >= 3);
    const nodes = [];      // [x, z]
    const key = new Map();
    const nodeAt = (x, z) => { const k = `${Math.round(x * 2)}_${Math.round(z * 2)}`; let i = key.get(k); if (i === undefined) { i = nodes.length; nodes.push([x, z]); key.set(k, i); } return i; };
    const adj = [];
    const link = (i, j, w, pts) => { (adj[i] || (adj[i] = [])).push({ j, w, pts }); };
    const ends = [];
    for (const e of E) {
      const A = e.pts[0], B = e.pts[e.pts.length - 1];
      const ia = nodeAt(A[0], A[2]), ib = nodeAt(B[0], B[2]);
      const pts = e.pts.map((q) => [q[0], q[2]]);
      link(ia, ib, e.len, pts); link(ib, ia, e.len, pts.slice().reverse());
      ends.push(ia, ib);
    }
    const uniq = [...new Set(ends)];
    for (const i of uniq) {
      const [x, z] = nodes[i];
      const c = [];
      for (const j of uniq) { if (j === i) continue; const d2 = (nodes[j][0] - x) ** 2 + (nodes[j][1] - z) ** 2; if (d2 > 25 && d2 < 34 * 34) c.push([d2, j]); }
      c.sort((p, q) => p[0] - q[0]);
      for (const [d2, j] of c.slice(0, 2)) { const w = Math.sqrt(d2) * 1.15; link(i, j, w, [[x, z], nodes[j]]); link(j, i, w, [nodes[j], [x, z]]); }
    }
    // snap start / goal to the nearest point on any edge polyline
    const snap = (x, z) => {
      let best = null, bd = 1e18;
      for (const e of E) for (let k = 1; k < e.pts.length; k++) {
        const ax = e.pts[k - 1][0], az = e.pts[k - 1][2], bx = e.pts[k][0], bz = e.pts[k][2];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const t = clamp(((x - ax) * dx + (z - az) * dz) / L2, 0, 1);
        const px = ax + dx * t, pz = az + dz * t, d2 = (x - px) ** 2 + (z - pz) ** 2;
        if (d2 < bd) { bd = d2; best = { e, k, px, pz, dist: Math.sqrt(d2) }; }
      }
      return best;
    };
    const s = snap(from3.x, from3.z), g = snap(to3.x, to3.z);
    if (!s || !g) return null;
    // start/goal join the graph at their edge's two end nodes
    const S = nodes.length; nodes.push([s.px, s.pz]);
    const G = nodes.length; nodes.push([g.px, g.pz]);
    const joinEdge = (n, sn, back) => {
      const e = sn.e, A = e.pts[0], B = e.pts[e.pts.length - 1];
      const ia = key.get(`${Math.round(A[0] * 2)}_${Math.round(A[2] * 2)}`), ib = key.get(`${Math.round(B[0] * 2)}_${Math.round(B[2] * 2)}`);
      const toA = [[sn.px, sn.pz], ...e.pts.slice(0, sn.k).reverse().map((q) => [q[0], q[2]])];
      const toB = [[sn.px, sn.pz], ...e.pts.slice(sn.k).map((q) => [q[0], q[2]])];
      const len = (pts) => pts.reduce((acc, q, i) => (i ? acc + Math.hypot(q[0] - pts[i - 1][0], q[1] - pts[i - 1][1]) : 0), 0);
      if (!back) { link(n, ia, len(toA), toA); link(n, ib, len(toB), toB); }
      else { link(ia, n, len(toA), toA.slice().reverse()); link(ib, n, len(toB), toB.slice().reverse()); }
    };
    joinEdge(S, s, false); joinEdge(G, g, true);
    if (s.e === g.e) { const direct = [[s.px, s.pz], [g.px, g.pz]]; link(S, G, Math.hypot(s.px - g.px, s.pz - g.pz), direct); }
    // A*
    const hN = (i) => Math.hypot(nodes[i][0] - nodes[G][0], nodes[i][1] - nodes[G][1]);
    const dist = new Map([[S, 0]]), prev = new Map();
    const open = [[hN(S), S]];
    const closed = new Set();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, u] = open.splice(bi, 1)[0];
      if (u === G) break;
      if (closed.has(u)) continue;
      closed.add(u);
      for (const { j, w, pts } of adj[u] || []) {
        const nd = dist.get(u) + w;
        if (nd < (dist.get(j) ?? Infinity)) { dist.set(j, nd); prev.set(j, { u, pts }); open.push([nd + hN(j), j]); }
      }
      if (closed.size > 20000) break;
    }
    if (!prev.has(G)) return null;
    const chain = [];
    for (let v = G; v !== S; v = prev.get(v).u) chain.push(prev.get(v).pts);
    const out = [[from3.x, from3.z]];
    for (const seg of chain.reverse()) for (const q of seg) { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 0.2) out.push(q); }
    out.push([to3.x, to3.z]);
    return { pts: out, length: dist.get(G) + s.dist + g.dist };
  }

  // ---------------------------------------------------------------- map queries
  function waypointOut(e, d, dir, lane) {
    const p = lanePose(e, d, dir, lane);
    const inJunction = d < (e.mouthA || 0) || d > e.len - (e.mouthB || 0);
    return {
      id: `${e.id}:${dir}:${lane}:${d.toFixed(2)}`, road_id: e.id, lane_id: dir > 0 ? lane + 1 : -(lane + 1), s: +d.toFixed(3),
      transform: { location: fromThree(new THREE.Vector3(p.x, p.y, p.z)), rotation: { pitch: 0, yaw: +wrap180(hToYaw(p.h)).toFixed(3), roll: 0 } },
      lane_width: +Math.min(3.4, Math.max(3, e.width - 0.6) / Math.max(1, e.lanes)).toFixed(2), lanes: lanesFor(e),
      is_junction: inJunction, road_class: e.rclass, oneway: e.oneway !== 0, speed_limit: +(e.speed * 3.6).toFixed(1),
    };
  }
  const parseWp = (id) => {
    const [eid, dir, lane, d] = String(id).split(':').map(Number);
    const e = traffic.edges.get(eid);
    need(e, 'no_such_waypoint', `waypoint ${id} is not on a loaded road`);
    return { e, dir, lane, d };
  };
  function waypointNext(id, distance) {
    const { e, dir, lane, d } = parseWp(id);
    const nd = d + dir * distance;
    if (nd >= 0 && nd <= e.len) return [waypointOut(e, nd, dir, lane)];
    // past the end: every onward edge from the node (straight, turns) at the remaining distance
    const rem = dir > 0 ? nd - e.len : -nd;
    const nodeKey = dir > 0 ? e.b : e.a;
    const n = traffic.junction?.get(nodeKey) ?? traffic.nodes.get(nodeKey);
    if (!n) return [];
    const out = [];
    for (const o of n.out) {
      const ne = traffic.edges.get(o.id);
      if (!ne || ne === e || (ne.oneway !== 0 && o.dir !== ne.oneway)) continue;
      const ld = lanesFor(ne);
      const dd = o.dir > 0 ? Math.min(ne.len, rem) : Math.max(0, ne.len - rem);
      out.push(waypointOut(ne, dd, o.dir, Math.min(lane, ld - 1)));
    }
    return out;
  }
  function spawnPoints(center, radius, spacing) {
    const c3 = toThree(center);
    const out = [];
    for (const e of traffic.edges.values()) {
      if (e.minor || e.len < 20) continue;
      const mid = traffic.sampleEdge(e, e.len / 2);
      if (Math.hypot(mid.x - c3.x, mid.z - c3.z) > radius + e.len / 2) continue;
      for (const dir of e.oneway !== 0 ? [e.oneway] : [1, -1]) {
        for (let lane = 0; lane < lanesFor(e); lane++) {
          for (let d = (e.mouthA || 0) + 8; d < e.len - (e.mouthB || 0) - 8; d += spacing) {
            const p = lanePose(e, d, dir, lane);
            if (Math.hypot(p.x - c3.x, p.z - c3.z) > radius) continue;
            out.push({ location: fromThree(new THREE.Vector3(p.x, p.y + 0.3, p.z)), rotation: { pitch: 0, yaw: +wrap180(hToYaw(p.h)).toFixed(3), roll: 0 } });
          }
        }
      }
    }
    return out;
  }
  function junctions(center, radius) {
    const c3 = toThree(center);
    const out = [];
    const seen = new Set();
    for (const [k, n] of traffic.nodes) {
      const g = traffic.junction?.get(k) || n;
      if (seen.has(g)) continue;
      seen.add(g);
      const keys = g.keys || [k];
      const pts = keys.map((kk) => kk.split('_').map(Number));
      const x = pts.reduce((a, p) => a + p[0], 0) / pts.length, z = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      if (Math.hypot(x - c3.x, z - c3.z) > radius) continue;
      const arms = [];
      for (const o of g.out) {
        const e = traffic.edges.get(o.id);
        if (!e) continue;
        const s = traffic.sampleEdge(e, o.dir > 0 ? 2 : e.len - 2);
        arms.push({ road_id: e.id, heading: +wrap180(hToYaw(Math.atan2(s.dirx * o.dir, s.dirz * o.dir))).toFixed(1), lanes: e.lanes, oneway: e.oneway !== 0, road_class: e.rclass });
      }
      if (arms.length < 3) continue;
      const signalized = keys.some((kk) => traffic.signals.has(kk));
      out.push({ id: keys[0], location: fromThree(new THREE.Vector3(x, groundAt(x, z, 0), z)), signalized, arms });
    }
    out.sort((a, b) => Math.hypot(a.location.x - center.x, a.location.y - center.y) - Math.hypot(b.location.x - center.x, b.location.y - center.y));
    return out;
  }
  function lightState(heading) {
    const h = yawToH(heading);
    const servesEW = Math.abs(Math.sin(h)) > Math.abs(Math.cos(h));
    const t = traffic ? traffic.time : 0;
    const c = ((t % 40) + 40) % 40;
    const st = signalState(t, servesEW);
    // seconds left in the current state of this approach (40 s cycle: NS G 0-15 A -18 R -20, EW G 20-35 A -38 R -40)
    const edges = servesEW ? [20, 35, 38, 60] : [15, 18, 40, 55];
    const nextEdge = edges.find((b) => b > c) ?? 40;
    return { state: { G: 'green', A: 'yellow', R: 'red' }[st], time_left: +(nextEdge - c).toFixed(2), cycle: 40, axis: servesEW ? 'east_west' : 'north_south' };
  }

  // ---------------------------------------------------------------- ambient population
  function setAmbient(v, w) {
    if (traffic && v !== undefined && v !== null) {
      traffic.target = Math.max(0, v | 0);
      for (let i = traffic.cars.length - 1; i >= 0 && traffic.cars.length - traffic.apiCount > traffic.target; i--) if (!traffic.cars[i].api) traffic._remove(i);
    }
    if (peds && w !== undefined && w !== null) {
      peds.target = Math.max(0, w | 0);
      for (let i = peds.peds.length - 1; i >= 0 && peds.peds.length - peds.apiCount > peds.target; i--) if (!peds.peds[i].api) peds._remove(i);
      if (peds.traffic) peds.traffic._crossers = [];
    }
    return { vehicles: traffic ? traffic.target : 0, walkers: peds ? peds.target : 0 };
  }

  // ---------------------------------------------------------------- handlers
  let gpuName = null;   // the renderer ANGLE picked (the server asks Chromium for the high-performance GPU)
  const gpu = () => {
    if (gpuName === null) {
      try {
        const gl = engine.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        gpuName = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
      } catch { gpuName = '?'; }
    }
    return gpuName;
  };
  const H = {
    'server.info': () => {
      const [W, H0] = drawSize();
      return {
        api_version: API_VERSION, engine: 'valdrada', map: 'NYC', frame, timestamp: simTime,
        synchronous_mode: settings.synchronous_mode, fixed_delta_seconds: settings.fixed_delta_seconds,
        resolution: [W, H0], gpu: gpu(), fps: +(engine.fps || 0).toFixed(1), geo_origin: { lat: LAT0, lon: LON0 },
        vehicles: vehicleKinds.length, walker_variants: variants.length,
      };
    },
    'world.get_settings': () => ({ ...settings }),
    'world.apply_settings': (p) => {
      if (p.fixed_delta_seconds !== undefined && p.fixed_delta_seconds !== null) settings.fixed_delta_seconds = clamp(+p.fixed_delta_seconds, 0.001, 0.5);
      if (p.synchronous_mode !== undefined) { settings.synchronous_mode = !!p.synchronous_mode; setAsync(!settings.synchronous_mode); }
      if (p.idle_nap_ms !== undefined && p.idle_nap_ms !== null) { settings.idle_nap_ms = clamp(+p.idle_nap_ms || 0, 0, 1000); engine.wake?.(); }
      return { ...settings, frame };
    },
    'world.tick': (p) => tick(p),
    'world.wait_until_loaded': async (p) => {
      const t0 = performance.now(), limit = num(p.timeout, 120) * 1000;
      let quiet = 0, last = '';
      busy = true;
      engine.wake?.();
      try {
        updateCamera();
        while (performance.now() - t0 < limit) {
          await nextFrame();
          const s = window.__RECSTAT ? window.__RECSTAT() : { idle: streamer.idle(), near: 0, macro: 0, dressQ: 0 };
          const key = `${s.near}|${s.macro}|${s.dressActive}`;
          quiet = s.idle && s.dressQ === 0 && key === last && (!streamer.readyUnder || streamer.readyUnder()) ? quiet + 1 : 0;
          last = key;
          if (quiet >= 10) return { loaded: true, seconds: +((performance.now() - t0) / 1000).toFixed(1), tiles: s.near, macro: s.macro };
        }
        return { loaded: false, seconds: +((performance.now() - t0) / 1000).toFixed(1) };
      } finally { busy = false; }
    },
    'world.get_snapshot': () => ({
      frame, timestamp: simTime,
      actors: [...actors.values()].filter((a) => a.kind !== 'controller').map((a) => ({ id: a.id, type_id: a.type_id, transform: actorTransform(a), velocity: velocityOf(a) })),
    }),
    'world.get_blueprints': () => blueprints(),
    'world.get_actors': (p) => [...actors.values()].filter((a) => !p.filter || new RegExp('^' + String(p.filter).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(a.type_id)).map(describe),
    'world.get_actor': (p) => describe(actorOf(p.id)),
    'world.spawn_actor': (p, owner) => {
      const bp = String(p.blueprint || '');
      const attrs = p.attributes || {};
      const T = { location: { x: 0, y: 0, z: 0, ...(p.transform?.location || {}) }, rotation: { pitch: 0, yaw: 0, roll: 0, ...(p.transform?.rotation || {}) } };
      let a;
      if (bp.startsWith('vehicle.')) a = spawnVehicle(bp, attrs, T);
      else if (bp.startsWith('walker.pedestrian.')) a = spawnWalker(bp, attrs, T);
      else if (bp.startsWith('sensor.')) a = spawnSensor(bp, attrs, T, p.attach_to | 0);
      else if (bp.startsWith('controller.')) a = spawnController(bp, attrs, p.attach_to | 0);
      else throw new ApiError('unknown_blueprint', `unknown blueprint ${bp}`);
      a.owner = owner;
      if (!busy) updateCamera();
      return describe(a);
    },
    'world.destroy_actor': (p) => ({ destroyed: destroy(p.id) }),
    'world.set_weather': (p) => {
      if (p.time_of_day) { need(['day', 'golden', 'dusk', 'night'].includes(p.time_of_day), 'bad_weather', 'time_of_day is day, golden, dusk or night'); sky.apply(p.time_of_day); }
      if (p.rain !== undefined && weather) { rainSet = clamp(+p.rain, 0, 1); weather.set(rainSet); }
      return { time_of_day: sky.mode, rain: rainSet };
    },
    'world.get_weather': () => ({ time_of_day: sky.mode, rain: rainSet }),
    'world.set_ambient_traffic': (p) => setAmbient(p.vehicles, p.walkers),
    'world.get_ambient_traffic': () => ({ vehicles: traffic ? traffic.target : 0, walkers: peds ? peds.target : 0, vehicles_now: traffic ? traffic.cars.length - traffic.apiCount : 0, walkers_now: peds ? peds.peds.length - peds.apiCount : 0 }),
    'world.get_traffic_light_state': (p) => lightState(num(p.heading, 0)),
    'actor.get_transform': (p) => actorTransform(actorOf(p.id)),
    'actor.get_velocity': (p) => velocityOf(actorOf(p.id)),
    'actor.get_bounding_box': (p) => bboxOf(actorOf(p.id)),
    'actor.set_transform': (p) => {
      const a = actorOf(p.id);
      const T = p.transform || {};
      if (a.kind === 'spectator') {
        a.loc = { ...a.loc, ...(T.location || {}) }; a.rot = { ...a.rot, ...(T.rotation || {}) };
      } else if (a.kind === 'sensor') {
        a.rel = { location: { ...a.rel.location, ...(T.location || {}) }, rotation: { ...a.rel.rotation, ...(T.rotation || {}) } };
      } else if (a.kind === 'vehicle') {
        const p3 = toThree({ ...actorTransform(a).location, ...(T.location || {}) });
        const yaw = T.rotation?.yaw ?? actorTransform(a).rotation.yaw;
        Object.assign(a.st, { x: p3.x, z: p3.z, y: groundAt(p3.x, p3.z, p3.y), h: yawToH(yaw) });
        if (a.body) a.body.teleport(a.st.x, a.st.z, a.st.h);
        traffic._placeCar(a.car, a.st.x, a.st.y + 0.002, a.st.z, a.st.h, 1 / 30);
        if (!a.car.manual) { a.car.manual = true; snapCarToLane(a.car, a.st.x, a.st.z, a.st.h); a.car.manual = false; }
        else snapCarToLane(a.car, a.st.x, a.st.z, a.st.h, 8);
      } else if (a.kind === 'walker') {
        const p3 = toThree({ ...actorTransform(a).location, ...(T.location || {}) });
        Object.assign(a.st, { x: p3.x, z: p3.z, yaw: T.rotation?.yaw ?? a.st.yaw });
        if (a.body) a.body.teleport(p3.x, p3.z, yawToH(a.st.yaw));
        if (!a.ped.manual) { a.ped.manual = true; }
        placeWalker(a, 0);
        peds.mesh.instanceMatrix.needsUpdate = true;
      }
      if (!busy) updateCamera();
      return actorTransform(a);
    },
    'actor.set_target_velocity': (p) => {
      const a = actorOf(p.id);
      const v = p.velocity || {};
      if (a.kind === 'vehicle') { need(a.car.manual, 'autopilot', 'turn the autopilot off first'); a.st.targetV = Math.hypot(v.x || 0, v.y || 0) * (p.reverse ? -1 : 1); if (Math.hypot(v.x || 0, v.y || 0) > 0.01) a.st.h = yawToH(Math.atan2(v.y || 0, v.x || 0) * R2D); }
      else if (a.kind === 'walker') { const s = Math.hypot(v.x || 0, v.y || 0); a.control = { direction: { x: (v.x || 0) / (s || 1), y: (v.y || 0) / (s || 1), z: 0 }, speed: s, jump: false }; a.route = null; }
      return velocityOf(a);
    },
    'vehicle.apply_control': (p) => {
      const a = actorOf(p.id, 'vehicle');
      need(a.car.manual, 'autopilot', `vehicle ${a.id} is on autopilot; set_autopilot(False) first`);
      const c = a.control;
      for (const k of ['throttle', 'steer', 'brake']) if (p[k] !== undefined) c[k] = +p[k];
      for (const k of ['hand_brake', 'reverse']) if (p[k] !== undefined) c[k] = !!p[k];
      a.st.targetV = null;
      return { ...c };
    },
    'vehicle.get_control': (p) => ({ ...actorOf(p.id, 'vehicle').control }),
    // CONTROL: the view follows an actor with the play mode's cameras (chase / bonnet for a vehicle, third / first person
    // for a walker); id 0 stops following (the spectator stays where the follow left it)
    'spectator.follow': (p) => {
      const id = p.id | 0;
      if (id) { const a = actorOf(id); need(a.kind === 'vehicle' || a.kind === 'walker', 'wrong_actor_type', 'only a vehicle or a walker can be followed'); }
      follow.id = id; follow.mode = String(p.mode || (id && actors.get(id).kind === 'walker' ? 'third' : 'chase'));
      if (follow.cam) { follow.cam.head = null; follow.cam.yaw = 0; }
      if (id) { const a = actors.get(id), b = takeBody(a); if (!follow.cam) follow.cam = new FollowCam(engine, PP); follow.cam.yaw = b.h + Math.PI; follow.cam.head = b.h; followStep(1 / 30); if (!busy) updateCamera(); }
      return { following: id, mode: follow.mode };
    },
    // CONTROL: record the run of an actor (and the view) as a take: per tick the camera and the actor's pose, resampled
    // to 30 fps; stop_take returns it (tools/ad/takes.mjs reads the same JSON for record.mjs and the export's harvest)
    'world.start_take': (p) => {
      const a = actorOf(p.id);
      need(a.kind === 'vehicle' || a.kind === 'walker', 'wrong_actor_type', 'a take records a vehicle or a walker');
      takeRec = { id: a.id, rec: new TakeRecorder(engine, { name: String(p.name || 'api_take'), mode: a.kind === 'vehicle' ? 'drive' : 'walk', kind: a.kind === 'vehicle' ? a.car.kind : undefined, time: sky.mode }) };
      return { recording: a.id };
    },
    'world.stop_take': () => {
      need(takeRec, 'no_take', 'no take is being recorded');
      const T = takeRec.rec.finish({ source: 'api' });
      takeRec = null;
      return T || { frames: 0 };
    },
    // the nearest road user in this car's path — CARLA's sensor.other.obstacle as a query: every walker and vehicle in
    // the city (ambient or API) inside a corridor `width` wide ahead of the front bumper, up to `max_distance`
    'vehicle.get_obstacle_ahead': (p) => {
      const a = actorOf(p.id, 'vehicle');
      const q = a.car._pose;
      if (!q) return null;
      const maxD = clamp(num(p.max_distance, 30), 1, 150), halfW = clamp(num(p.width, 2.2), 0.5, 8) / 2;
      const fx = Math.sin(q[3]), fz = Math.cos(q[3]);
      const half = vehDims(a.car.kind)[2] / 2;
      let best = null;
      const consider = (x, z, r, kind, id, v) => {
        const rx = x - q[0], rz = z - q[2];
        const along = rx * fx + rz * fz;
        if (along < half - 0.5 || along > half + maxD + r) return;
        if (Math.abs(rx * fz - rz * fx) > halfW + r) return;
        const d = along - half - r;
        if (!best || d < best.distance) best = { distance: +Math.max(0, d).toFixed(3), kind, actor_id: id, speed: +(v || 0).toFixed(3) };
      };
      for (const c of traffic.cars) {
        if (c === a.car || !c._pose) continue;
        consider(c._pose[0], c._pose[2], (vehDims(c.kind)[2] / 2) * 0.9, 'vehicle', c.api || 0, c.manual ? (actors.get(c.api)?.st?.v || 0) : c.v);
      }
      const M = peds.mesh.instanceMatrix.array;
      for (const w of peds.peds) consider(M[w.idx * 16 + 12], M[w.idx * 16 + 14], 0.35, 'walker', w.api || 0, 0);
      return best;
    },
    'vehicle.set_autopilot': (p) => {
      const a = actorOf(p.id, 'vehicle');
      const car = a.car;
      if (p.enabled) {
        const tr = actorTransform(a);
        const p3 = toThree(tr.location);
        car.manual = false;
        const ok = snapCarToLane(car, p3.x, p3.z, yawToH(tr.rotation.yaw), 12);
        if (!ok) { car.manual = true; throw new ApiError('off_road', `vehicle ${a.id} is not within 12 m of a lane it can drive`); }
        // DK04: the towed rear axle (sim/traffic.js _placeCar VT29) starts from the car's own heading, so the body swings
        // onto its lane instead of taking the lane's heading in one step
        if (DK04) {
          const h0 = yawToH(tr.rotation.yaw), lr0 = car._lr || (car._lr = Math.max(1.25, Math.min(3.4, 0.56 * traffic.carHalf(car)[1])));
          car._yawL = h0; car._rear = [p3.x - Math.sin(h0) * lr0, p3.z - Math.cos(h0) * lr0];
        }
        car.v = Math.max(car.v || 0, Math.abs(a.st.v));
        car.next = null; car.turn = null; car.dead = false; car._lfv = 0;
        car.routePlan = Array.isArray(p.route) ? p.route.map((s) => String(s).toLowerCase()) : null;
      } else {
        const tr = actorTransform(a);
        const p3 = toThree(tr.location);
        car.manual = true; car.turn = null; car.next = null;
        Object.assign(a.st, { x: p3.x, y: groundAt(p3.x, p3.z, p3.y), z: p3.z, h: yawToH(tr.rotation.yaw), v: car.v || 0, targetV: null });
        if (a.body) { a.body.teleport(a.st.x, a.st.z, a.st.h); a.body.v = a.st.v; }
        a.control = { throttle: 0, steer: 0, brake: 0, hand_brake: false, reverse: false };
      }
      return { autopilot: !car.manual, route: car.routePlan || null };
    },
    'walker.apply_control': (p) => {
      const a = actorOf(p.id, 'walker');
      a.ped.manual = true;
      a.route = null;
      if (a.ai) a.ai.state = 'stopped';
      const d = p.direction || {};
      a.control = { direction: { x: +d.x || 0, y: +d.y || 0, z: 0 }, speed: num(p.speed, 1.3), jump: !!p.jump };
      return { ...a.control };
    },
    'walker_ai.start': (p) => {
      const c = actorOf(p.id, 'controller');
      c.state = 'idle';
      return { state: c.state };
    },
    'walker_ai.stop': (p) => {
      const c = actorOf(p.id, 'controller');
      const w = actorOf(c.parent, 'walker');
      w.route = null; w.control = { direction: { x: 0, y: 0, z: 0 }, speed: 0, jump: false };
      c.state = 'stopped';
      return { state: c.state };
    },
    'walker_ai.set_max_speed': (p) => {
      const c = actorOf(p.id, 'controller');
      c.maxSpeed = clamp(num(p.speed, 1.4), 0.1, 6);
      const w = actorOf(c.parent, 'walker');
      if (w.route) w.route.speed = c.maxSpeed;
      return { max_speed: c.maxSpeed };
    },
    'walker_ai.go_to_location': (p) => {
      const c = actorOf(p.id, 'controller');
      const w = actorOf(c.parent, 'walker');
      const from = new THREE.Vector3(w.st.x, 0, w.st.z);
      const to = toThree(p.location || {});
      const r = p.direct ? { pts: [[from.x, from.z], [to.x, to.z]], length: Math.hypot(to.x - from.x, to.z - from.z) } : walkRoute(from, to);
      need(r, 'no_route', 'no walkable route between those points (are the tiles loaded?)');
      w.ped.manual = true;
      w.route = { pts: r.pts, i: 0, speed: c.maxSpeed };
      c.state = 'walking';
      return { state: c.state, length: +r.length.toFixed(2), path: r.pts.map(([x, z]) => fromThree(new THREE.Vector3(x, groundAt(x, z, 0), z))) };
    },
    'walker_ai.get_state': (p) => ({ state: actorOf(p.id, 'controller').state }),
    'sensor.listen': (p, owner) => { const a = actorOf(p.id, 'sensor'); a.listening = true; a.owner = owner; return { listening: true }; },
    'sensor.stop': (p) => { const a = actorOf(p.id, 'sensor'); a.listening = false; return { listening: false }; },
    'map.info': () => ({ name: 'NYC', geo_origin: { lat: LAT0, lon: LON0 }, frame: 'ENU metres: x east, y north, z up', tiles_loaded: streamer.stats?.near ?? 0 }),
    'map.get_spawn_points': (p) => spawnPoints(p.center || fromThree(cam.center), num(p.radius, 150), num(p.spacing, 30)),
    'map.get_waypoint': (p) => {
      const p3 = toThree(p.location || {});
      const ne = nearestEdge(p3.x, p3.z, num(p.max_distance, 30));
      if (!ne) return null;
      const e = ne.e, s = traffic.sampleEdge(e, ne.d);
      const h = p.heading !== undefined ? yawToH(+p.heading) : null;
      let dir = h === null ? (e.oneway || 1) : ((Math.sin(h) * s.dirx + Math.cos(h) * s.dirz) >= 0 ? 1 : -1);
      if (e.oneway !== 0) dir = e.oneway;
      const tmp = { manual: true };
      snapCarToLane(tmp, p3.x, p3.z, yawToH(hToYaw(Math.atan2(s.dirx * dir, s.dirz * dir))), 1e9);
      if (tmp.e) tmp.e.cars.delete(tmp);
      return waypointOut(e, ne.d, dir, Math.min(tmp.lane ?? 0, lanesFor(e) - 1));
    },
    'map.waypoint_next': (p) => waypointNext(p.id, num(p.distance, 5)),
    'map.get_junctions': (p) => junctions(p.center || fromThree(cam.center), num(p.radius, 120)),
    'map.plan_walk_route': (p) => {
      const r = walkRoute(toThree(p.start || {}), toThree(p.end || {}));
      need(r, 'no_route', 'no walkable route between those points (are the tiles loaded?)');
      return { length: +r.length.toFixed(2), path: r.pts.map(([x, z]) => fromThree(new THREE.Vector3(x, groundAt(x, z, 0), z))) };
    },
    'map.get_surface': (p) => {
      const p3 = toThree(p.location || {});
      const si = surfInfo(p3.x, p3.z);
      return { height: groundAt(p3.x, p3.z, null), kind: si ? si.kind : null, road: si ? !!si.road : null };
    },
    'map.get_semantic_classes': () => (perc() ? perc().classes : []),
    'geo.to_location': (p) => { const [x, z] = project(+p.lon, +p.lat); return fromThree(new THREE.Vector3(x, num(p.alt, 0), z)); },
    'geo.to_geolocation': (p) => { const [lon, lat] = unproject(+p.x || 0, -(+p.y || 0)); return { lat: +lat.toFixed(7), lon: +lon.toFixed(7), alt: +(+p.z || 0).toFixed(3) }; },
  };

  async function handle(method, params, owner = 0) {
    const fn = H[method];
    if (!fn) throw new ApiError('unknown_method', `unknown method ${method}`);
    return fn(params || {}, owner);
  }
  function emit(owner, meta, blobs) {
    if (host) host.emit({ ...meta, cid: owner || 0 }, blobs);
    else { events.push({ meta, blobs }); if (events.length > 64) events.shift(); }
  }
  if (host) {
    host.onRequest(async (req) => {
      try {
        const result = await handle(req.method, req.params, req.cid);
        host.respond({ cid: req.cid, id: req.id, result: result === undefined ? null : result });
      } catch (e) {
        host.respond({ cid: req.cid, id: req.id, error: { code: e.code || 'internal', message: String(e.message || e) } });
        if (!e.code) console.error('[api]', req.method, e);
      }
    });
    host.onDisconnect?.((cid) => {
      // a client went away: its sensors stop streaming (actors stay, as in CARLA)
      for (const a of actors.values()) if (a.kind === 'sensor' && a.owner === cid) a.listening = false;
    });
    host.ready?.({ api_version: API_VERSION });
  }
  window.__API = { call: (m, p) => handle(m, p, 0), events, actors, version: API_VERSION,
    // for a renderer client of the headless core (core/api/render.mjs): the API's frame and clock, and every listening
    // camera's pose in the renderer's frame (its streaming and actor region)
    clock: () => ({ frame, simTime }),
    cameras: () => [...actors.values()].filter((a) => a.kind === 'sensor' && a.listening).map((a) => {
      const W = a.attributes.image_size_x, H = a.attributes.image_size_y;
      return { id: a.id, ...poseFor(sensorWorld(a), a.attributes.fov, W / H), width: W, height: H };
    }) };
  updateCamera();
  console.log(`[api] Valdrada API ${API_VERSION} ready (${host ? 'host connected' : 'no host: window.__API'})`);
  return { preStep, postStep };
}
