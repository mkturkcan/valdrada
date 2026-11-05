// Records a take's actors frame by frame from the headless world: every vehicle and walker within `radius` of the take's
// lens path, with stable ids, the poses the page's models write into their instance storage, and the per-vehicle state
// the page's renderer derives from motion (sim/fleet24.js installFleet24: wheel spin, steering, brake, blinkers, the
// articulated bus's bend, the lamp mask), mirrored here per actor so every renderer draws the same lamps.
import * as THREE from 'three';
import { KIND24, R1D_FLEET_FNS } from '../../client/src/sim/fleet24.js';
import { signalState } from '../../client/src/sim/signals.js';
import { TRAIN_KINDS } from './format.mjs';

const { hash, paintFor } = R1D_FLEET_FNS;
export const L = { HEAD: 1, TAIL: 2, BRAKE: 4, BLINKL: 8, BLINKR: 16, SIREN: 32 };   // fleet24 L_* lamp bits
const SIG_CODE = { R: 0, A: 1, G: 2 };
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const r7 = (v) => Math.round(v * 1e7) / 1e7;

export class TrackRecorder {
  constructor(W, { radius = 250, pathPts = [], night = 0, dt = 1 / 30 } = {}) {
    this.W = W; this.radius = radius; this.pathPts = pathPts; this.night = night; this.dt = dt;
    this.ids = new WeakMap(); this.nextId = 1; this.trainIds = new Map();
    this.kinds = Object.keys(W.kinds);   // kind index -> name (header.vehicleKinds)
    this.kindIx = new Map(this.kinds.map((k, i) => [k, i]));
    this.actors = new Map();             // id -> static record (header.actors)
    this.vstate = new Map();             // id -> mirrored fleet24 SlotState
    this.wprev = new Map();              // walker id -> [x, z] last frame
    this.frames = []; this.camera = []; this.simTime = []; this.lightFrames = [];
    this._m = new THREE.Matrix4(); this._p = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._s = new THREE.Vector3(); this._e = new THREE.Euler();
    this.signalList = null;
    this.parked = null;
  }
  idOf(o) { let id = this.ids.get(o); if (!id) { id = this.nextId++; this.ids.set(o, id); } return id; }
  near(x, z) {
    const R2 = this.radius * this.radius;
    for (const [a, b] of this.pathPts) if ((a - x) ** 2 + (b - z) ** 2 <= R2) return true;
    return false;
  }
  _paint(kind, color, seed) {
    const col = new Float32Array(3), paint = new Float32Array(4), c = new THREE.Color(color);
    paintFor(KIND24[kind]?.palette || 'car', c.r, c.g, c.b, seed, col, paint);
    return { col: [r4(col[0]), r4(col[1]), r4(col[2])], metal: r4(paint[0]), grime: r4(paint[1]), rough: r4(paint[2]) };
  }
  // the static set, once: signalised junctions and parked vehicles near the path
  snapshotStatic() {
    const T = this.W.traffic;
    this.signalList = [];
    for (const k of T.signals.keys()) {
      const [x, z] = k.split('_').map(Number);
      if (this.near(x, z)) this.signalList.push({ key: k, x, z });
    }
    this.parked = [];
    for (const [tile, recs] of T.parkedRecs) for (const r of recs) {
      if (!this.near(r.x, r.z)) continue;
      this._m.fromArray(r.m).decompose(this._p, this._q, this._s);
      const seed = hash(Math.round(this._p.x * 10), Math.round(this._p.z * 10));   // fleet24: a parked body's seed is its place
      this.parked.push({ id: this.nextId++, kind: r.kind, tile, x: r4(this._p.x), y: r4(this._p.y), z: r4(this._p.z), q: [r4(this._q.x), r4(this._q.y), r4(this._q.z), r4(this._q.w)], seed: r4(seed), ...this._paint(r.kind, r.color, seed) });
    }
    return { signals: this.signalList.length, parked: this.parked.length };
  }
  // one frame, after the world's step of `dt` (0 for a take's first frame)
  capture(dt) {
    const W = this.W, T = W.traffic, cam = W.camera;
    if (!this.signalList) this.snapshotStatic();
    cam.updateMatrixWorld();
    cam.matrixWorld.decompose(this._p, this._q, this._s);
    this.camera.push([r4(this._p.x), r4(this._p.y), r4(this._p.z), r7(this._q.x), r7(this._q.y), r7(this._q.z), r7(this._q.w), r4(cam.fov)]);
    this.simTime.push(+T.time.toFixed(6));
    const veh = [], walk = [];
    // ---- vehicles (moving pools)
    for (const car of T.cars) {
      const P = T.pools[car.kind];
      if (!P) continue;
      const A = P.mb.instanceMatrix.array, o = car.idx * 16;
      const x = A[o + 12], y = A[o + 13], z = A[o + 14];
      if (!this.near(x, z)) continue;
      const id = this.idOf(car);
      this._m.fromArray(A, o).decompose(this._p, this._q, this._s);
      const K = W.kinds[car.kind];
      let a = this.actors.get(id);
      if (!a) {
        // a stable seed per vehicle (the page keys it on the storage slot, which changes when a car is moved down a slot)
        const seed = hash(id, car.kind.length * 131 + 7);
        a = { id, type: 'vehicle', kind: car.kind, seed: r4(seed), color: car.color, ...this._paint(car.kind, car.color, seed), f0: this.frames.length, f1: this.frames.length };
        this.actors.set(id, a);
      }
      a.f1 = this.frames.length;
      const s = this._vehState(id, K, A, o, x, z, dt, a.seed);
      let lamps = 0;
      if (this.night > 0.35) lamps |= L.HEAD | L.TAIL;
      if (s.brake > 0) lamps |= L.BRAKE;
      if (s.blinkL > 0) lamps |= L.BLINKL;
      if (s.blinkR > 0) lamps |= L.BLINKR;
      if (/^(police|nypd|ambulance|firetruck)$/.test(car.kind) && a.seed < 0.18) lamps |= L.SIREN;
      const flags = (car._parkT > 0 ? 1 : 0) | (car.kind === 'bus' || /^mta/.test(car.kind) ? 2 : 0);
      veh.push({ id, x, y, z, q: [this._q.x, this._q.y, this._q.z, this._q.w], v: Math.max(0, car.v || 0), spin: s.spin, steer: s.steer, bend: s.bend, lamps, flags, kind: this.kindIx.get(car.kind) ?? 65535 });
    }
    // ---- walkers
    if (W.peds) {
      const M = W.rig.mesh.instanceMatrix.array;
      for (const p of W.peds.peds) {
        const o = p.idx * 16, x = M[o + 12], z = M[o + 14];
        if (!this.near(x, z)) continue;
        const id = this.idOf(p);
        this._m.fromArray(M, o).decompose(this._p, this._q, this._s);
        this._e.setFromQuaternion(this._q, 'YXZ');
        let a = this.actors.get(id);
        if (!a) {
          // (speed: the walk speed the walker model gave the rig, m/s; phase0: the phase it gave with it, which seeds the
          // crowd's first clip time; col: the outerwear colour, linear, which the crowd uses as the top's tint)
          const RS = W.rig.st;
          a = { id, type: 'walker', variant: p.skin ?? 0, outfit: p.mask | 0, bagTone: r4(p.bagTone || 0), umbTone: r4(p.umbTone || 0), color: p.color ? (typeof p.color === 'number' ? p.color : p.color.getHex?.() ?? 0) : 0,
            col: p.color && p.color.isColor ? [r4(p.color.r), r4(p.color.g), r4(p.color.b)] : null, speed: r4(RS.base[p.idx] / 4.4), phase0: r4(RS.ph0[p.idx]), f0: this.frames.length, f1: this.frames.length };
          this.actors.set(id, a);
        }
        a.f1 = this.frames.length;
        const pr = this.wprev.get(id);
        const v = pr && dt > 0 ? Math.hypot(x - pr[0], z - pr[1]) / dt : 0;
        this.wprev.set(id, [x, z]);
        const g = W.rig.gait(p.idx);
        walk.push({ id, x, y: this._p.y, z, yaw: this._e.y, v, phase: g.phase, hz: g.hz, sxz: this._s.x, sy: this._s.y, amp: g.amp, pose: p.seat ? (p.pose | 0) : 0, pace: g.pace });
      }
    }
    // ---- signal heads: north-south axis (servesEW false) in bits 0-1, east-west in bits 2-3 (R 0, A 1, G 2)
    const ns = SIG_CODE[signalState(T.time, false)], ew = SIG_CODE[signalState(T.time, true)];
    const sig = new Uint8Array(this.signalList.length).fill(ns | (ew << 2));
    // ---- train cars on the drawn track (sim/trains.js carsAt at the sim clock, with the take's cue shift), nearer than
    // the radius + 300 m (a train is long and seen from far; tools/ar34/export/harvest.mjs takes the same margin)
    const train = [];
    if (W.trains) {
      const R2 = (this.radius + 300) ** 2;
      for (const c of W.trains.carsAt(W.ENV.time.value)) {
        if (!this.pathPts.some(([a, b]) => (a - c.x) ** 2 + (b - c.z) ** 2 <= R2)) continue;
        const key = `${c.sv}:${c.k}:${c.i}`;
        let id = this.trainIds.get(key);
        if (!id) { id = this.nextId++; this.trainIds.set(key, id); }
        // (a car keeps its id when it comes back in range; the API drops the records of actors out of range, render.mjs)
        let a = this.actors.get(id);
        if (!a) {
          a = { id, type: 'train', key, service: c.sv, run: c.k, car: c.i, kind: c.kind, num: c.num, dest: c.dest, f0: this.frames.length, f1: this.frames.length };
          this.actors.set(id, a);
        }
        a.f1 = this.frames.length;
        const L = c.lamps || [0, 0, 0, 0];
        train.push({ id, x: c.x, y: c.y, z: c.z, yaw: c.yaw, ta: c.trucks[0], tb: c.trucks[1], roll: c.roll % (Math.PI * 2), doors: +c.doors || 0, v: c.v || 0,
          lamps: (L[0] ? 1 : 0) | (L[1] ? 2 : 0) | (L[2] ? 4 : 0) | (L[3] ? 8 : 0), kind: Math.max(0, TRAIN_KINDS.indexOf(c.kind)),
          flags: (c.rev ? 1 : 0) | (c.last ? 2 : 0) | (c.enc ? 4 : 0) | (c.clipNear ? 8 : 0), side: c.doorSide < 0 ? -1 : 1, num: c.num | 0, dest: c.dest | 0 });
      }
    }
    this.frames.push({ veh, walk, sig, train });
    // the HL24 headlamp beams as the page draws them this frame (sim/carlights.js: the nearest twelve moving cars at night),
    // in harvest_lights.mjs pageFrame's record: position, target, intensity, colour, angle, penumbra, distance
    const spots = [];
    W.scene.traverse((Lt) => {
      if (!Lt.isSpotLight || Lt.name === 'cl26Sentinel' || !Lt.visible || !(Lt.intensity > 0)) return;
      Lt.updateMatrixWorld(); Lt.target.updateMatrixWorld();
      const p = Lt.getWorldPosition(this._p.clone()), t = Lt.target.getWorldPosition(this._p.clone());
      spots.push({ p: p.toArray(), t: t.toArray(), i: Lt.intensity, c: [Lt.color.r, Lt.color.g, Lt.color.b], a: Lt.angle, pe: Lt.penumbra, d: Lt.distance });
    });
    this.lightFrames.push({ spots });
    return { veh: veh.length, walk: walk.length, train: train.length };
  }
  // fleet24 installFleet24's per-slot motion state, per actor here
  _vehState(id, K, A, o, x, z, dt, seed) {
    let S = this.vstate.get(id);
    if (!S) { S = { x: 0, z: 0, yaw: 0, spin: 0, v: 0, steer: 0, brake: 0, blinkL: 0, blinkR: 0, rx: 0, rz: 0, ok: 0, bend: 0 }; this.vstate.set(id, S); }
    const hubR = K?.meta?.hubs?.[0]?.r || 0.34, wb = K?.meta?.wheelbase || 2.8, R = K?.rear || null;
    const yaw = Math.atan2(A[o + 8], A[o + 10]);
    const still = !(dt > 0);
    if (still && S.ok) { /* a dt = 0 frame keeps everything */ }
    else if (S.ok) {
      const d = Math.hypot(x - S.x, z - S.z);
      if (d > 4) S.ok = 0;
      else {
        S.spin = (S.spin + d / hubR) % (Math.PI * 2);
        const vNow = d / dt, acc = (vNow - S.v) / dt;
        S.v += (vNow - S.v) * Math.min(1, dt * 6);
        let dy = yaw - S.yaw;
        if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
        const target = S.v > 0.5 ? Math.max(-0.6, Math.min(0.6, Math.atan(wb * (dy / dt) / S.v))) : S.steer;
        S.steer += (target - S.steer) * Math.min(1, dt * 5);
        S.brake = acc < -1.4 || S.v < 0.4 ? 0.5 : Math.max(0, S.brake - dt);
        if (S.steer > 0.12) S.blinkL = 1.2; else S.blinkL = Math.max(0, S.blinkL - dt);
        if (S.steer < -0.12) S.blinkR = 1.2; else S.blinkR = Math.max(0, S.blinkR - dt);
      }
    }
    let fresh = false;
    if (!S.ok) { S.ok = 1; S.v = 0; S.steer = 0; S.brake = 0; S.blinkL = S.blinkR = 0; S.spin = seed * 6.28; fresh = true; }
    S.x = x; S.z = z; S.yaw = yaw;
    let art = 0;
    if (R) {
      const fl = Math.hypot(A[o + 8], A[o + 10]) || 1, fx = A[o + 8] / fl, fz = A[o + 10] / fl;
      const hx = x + fx * R.pivot[2], hz = z + fz * R.pivot[2];
      if (fresh) { S.rx = hx - fx * R.tow; S.rz = hz - fz * R.tow; }
      else if (!still) {
        const ddx = hx - S.rx, ddz = hz - S.rz, dd = Math.hypot(ddx, ddz);
        if (dd > 1e-6) { S.rx = hx - (ddx / dd) * R.tow; S.rz = hz - (ddz / dd) * R.tow; }
      }
      let da = Math.atan2(hx - S.rx, hz - S.rz) - yaw;
      da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
      art = Math.max(-0.75, Math.min(0.75, da));
      if (Math.abs(da) > 0.75) { S.rx = hx - Math.sin(yaw + art) * R.tow; S.rz = hz - Math.cos(yaw + art) * R.tow; }
    }
    S.bend = art;
    return S;
  }
  header(extra = {}) {
    const W = this.W;
    return {
      format: 'actor-tracks', version: 1,
      ...extra,
      coords: { frame: 'world', x: 'east', y: 'up', z: 'south', units: 'm', yawZero: '+z', unreal: 'UE = (x, z, y) * 100 cm' },
      frames: this.frames.length,
      simTime: this.simTime,
      camera: { fields: ['x', 'y', 'z', 'qx', 'qy', 'qz', 'qw', 'fovV'], rows: this.camera },
      vehicleKinds: this.kinds.map((k) => ({ kind: k, size: W.kinds[k].size, wheelbase: W.kinds[k].meta?.wheelbase ?? null, hubs: (W.kinds[k].meta?.hubs || []).map((h) => ({ id: h.id, p: h.p, r: h.r })), articulated: W.kinds[k].rear ? { pivot: W.kinds[k].rear.pivot, tow: W.kinds[k].rear.tow } : null, palette: KIND24[k]?.palette || 'car' })),
      signals: { cycle: 40, axes: 'ns: bits 0-1 (servesEW false, the car travels mostly along z), ew: bits 2-3; R 0, A 1, G 2', list: this.signalList },
      trainKinds: TRAIN_KINDS,
      trainCue: W.trains && W.trains.status.cue ? (({ ms, ...c }) => c)(W.trains.status.cue) : null,   // (without its wall-clock time)
      parked: this.parked,
      actors: [...this.actors.values()],
    };
  }
}
