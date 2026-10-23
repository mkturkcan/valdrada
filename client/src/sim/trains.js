// TRAINS (AR34, docs/notes/ar34-trains.md): the 1 train on the Manhattan Valley Viaduct and Metro-North on the Park Avenue
// Viaduct, as timetabled runs: every train's position is a closed-form function of the sim clock (ENV.time, which the
// recorder steps by a fixed dt), so a take is repeatable and nothing integrates frame by frame.
//   * a run: approach at line speed, brake at the service rate to the stopping mark, dwell (doors open ~2.5 s after the
//     stop, close before the dwell ends), accelerate at the published rate to line speed; wheels turn by distance / radius;
//   * consists: the 1 = two 5-car R62A units (10 cars); Metro-North = M7A (Harlem, Hudson) or M8 (New Haven) married
//     pairs, 6-10 cars by the hour;
//   * headways by the hour (?time= day 13:00, golden 18:15, dusk 19:15, night 23:00; or ?trainhour=H), a deterministic
//     jitter per train;
//   * drawing: one InstancedMesh per material class per car type and LOD (LOD0 within 45 m: interior, gaskets, flutes),
//     door leaves, trucks (they follow the curves), wheelsets, coupling gaps; cars beyond the modelled track are not drawn;
//   * record mode: window.__SET_PATH is wrapped; a take's path phases the timetable so that a train is in frame during
//     the take, with no car entering or leaving the drawn track inside the frame (?trcue=0: off).
// Flags: ?trains=0 (none; main.js hook), ?trcue=0, ?trlod=0|1 (force a LOD), ?trainhour=H, ?trmix=m7a|m8 (look-dev).
// Debug: window.__TRAINS (status, perf), window.__TRAINS_AT(t) (cars at sim time t).
import * as THREE from 'three';
import { ENV } from '../world/materials.js';
import { project } from '../shared/geo.js';
import { carModel, doorSlots, numOffset, destOffset } from '../city/trains/models.js';
import { trainMats, trainMatsUpdate, DESTS } from '../city/trains/mats.js';
import { SPECS } from '../city/trains/cars.js';
import { MV, P as mvP } from '../city/vk/mvv.js';
import { TRACKS } from '../city/w125eData.js';
import { COLLIDERS } from '../city/colliders.js';
import { HA_ON, haAnchors, haDeckShift } from '../world/haAnchor.js';   // P1 TERRAIN (`?terrain=p1`): the trains on the decks' LiDAR heights
import { haInit } from '../world/heightAuthority.js';
if (HA_ON) await Promise.all([haInit(), haAnchors()]);

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
const MPH = 0.44704;
const C29 = Math.cos((29 * Math.PI) / 180), S29 = Math.sin((29 * Math.PI) / 180);
const toUV = (x, z) => [C29 * x + S29 * z, S29 * x - C29 * z];
const toXZ = (u, v) => [C29 * u + S29 * v, S29 * u - C29 * v];
const frac = (x) => x - Math.floor(x);
const hash = (a, b = 0) => frac(Math.sin(a * 127.1 + b * 311.7 + 17.3) * 43758.5453);

// ---------------------------------------------------------------------------------------------- paths
// a path: world points (x, y, z) every ~2 m with cumulative length; at(s) -> position + unit tangent
class Path {
  constructor(pts) {
    this.p = pts; this.s = [0];
    for (let i = 1; i < pts.length; i++) this.s.push(this.s[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1], pts[i][2] - pts[i - 1][2]));
    this.L = this.s[this.s.length - 1];
  }
  at(s, out = { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0 }) {
    const S = this.s, P = this.p, n = S.length;
    if (s <= 0) { this._seg(0, s - S[0], out); return out; }
    if (s >= this.L) { this._seg(n - 2, s - S[n - 2], out); return out; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
    this._seg(lo, s - S[lo], out);
    return out;
  }
  _seg(i, d, out) {
    const a = this.p[i], b = this.p[i + 1], L = this.s[i + 1] - this.s[i] || 1;
    const tx = (b[0] - a[0]) / L, ty = (b[1] - a[1]) / L, tz = (b[2] - a[2]) / L;
    out.x = a[0] + tx * d; out.y = a[1] + ty * d; out.z = a[2] + tz * d; out.tx = tx; out.ty = ty; out.tz = tz;
  }
  // arc length of the point nearest to (x, z)
  sAt(x, z) {
    let best = 1e18, bs = 0;
    for (let i = 0; i + 1 < this.p.length; i++) {
      const a = this.p[i], b = this.p[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2)), px = a[0] + dx * t, pz = a[2] + dz * t;
      const d = (px - x) ** 2 + (pz - z) ** 2;
      if (d < best) { best = d; bs = this.s[i] + t * Math.sqrt(L2); }
    }
    return bs;
  }
}
// centripetal Catmull-Rom through 2D points, resampled every `step` m
function smooth2(pts, step = 2) {
  const out = [];
  const P = [pts[0], ...pts, pts[pts.length - 1]];
  for (let i = 1; i + 2 < P.length; i++) {
    const p0 = P[i - 1], p1 = P[i], p2 = P[i + 1], p3 = P[i + 2];
    const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

// ---------------------------------------------------------------------------------------------- the lines
// Manhattan Valley Viaduct (vk/mvv.js frame): straight along u; track centres l = MV.tracks; top of rail MV.RAIL.
// Northbound (uptown, +u) on the east track, southbound on the west; side platforms outside the tracks (MV.plat).
function mvvLines() {
  const mk = (l, dir) => {
    const ua = dir > 0 ? MV.u0 - 12 - 400 : MV.u1 + 12 + 400, ub = dir > 0 ? MV.u1 + 12 + 400 : MV.u0 - 12 - 400;
    const a = mvP(ua, l, MV.RAIL), b = mvP(ub, l, MV.RAIL);
    // (P1 TERRAIN: the rail on the viaduct's LiDAR deck, every 10 m)
    const path = new Path(HA_ON ? Array.from({ length: Math.round(Math.abs(ub - ua) / 10) + 1 }, (_, k) => {
      const u = ua + ((ub - ua) * k) / Math.round(Math.abs(ub - ua) / 10), p = mvP(u, l, MV.RAIL);
      p[1] += haDeckShift('irt_mvv', u, p[0], p[2]);
      return p;
    }) : [a, b]);
    const sOfU = (u) => (u - ua) * dir;
    return {
      path, dir,
      // drawn: the deck from abutment end to abutment end
      sVis: [sOfU(dir > 0 ? MV.u0 - 12 : MV.u1 + 12), sOfU(dir > 0 ? MV.u1 + 12 : MV.u0 - 12)],
      sStop: sOfU(dir > 0 ? MV.plat.u1 - 0.9 : MV.plat.u0 + 0.9),
      // the station's enclosure (walls and roofs over both platforms): a car inside it shows only through its windows
      enc: [Math.min(sOfU(MV.plat.u0), sOfU(MV.plat.u1)), Math.max(sOfU(MV.plat.u0), sOfU(MV.plat.u1))],
      side: dir > 0 ? [-MV.A[1], MV.A[0]] : [MV.A[1], -MV.A[0]],       // the platform's side (world x, z): +l north, -l south
    };
  };
  const NB = mk(MV.tracks[MV.tracks.length - 1], 1), SB = mk(MV.tracks[0], -1);
  NB.id = 'mvvN'; SB.id = 'mvvS';
  return { NB, SB };
}
// Park Avenue Viaduct (w125eData.js TRACKS, west to east; the rail 7.0 m over the street at y 10.38, vk/park.js PK.RAIL):
// south of the OSM ways the tracks run straight on to the viaduct's modelled end at v 2100 (110th St); north to the
// Harlem River lift bridge's abutment.
const PARK_RAIL = 3.38 + 7.0, PARK_VS = 2100;
function parkLines() {
  const uv = TRACKS.map((t) => t.map(([x, z]) => toUV(x, z)));
  const VN = Math.min(...uv.map((t) => t[t.length - 1][1])) - 1;
  const lines = uv.map((t, i) => {
    const pts = [[t[0][0], PARK_VS - 300], [t[0][0], PARK_VS], ...t.filter((p) => p[1] > PARK_VS + 1 && p[1] < VN + 200)];
    const sm = smooth2(pts, 2).map(([u, v]) => { const [x, z] = toXZ(u, v); return [x, PARK_RAIL + (HA_ON ? haDeckShift('park', v, x, z) : 0), z]; });
    return { i, pts: sm, VN };
  });
  const mk = (i, dir) => {
    const L = lines[i], pts = dir > 0 ? L.pts : [...L.pts].reverse();
    const path = new Path(pts);
    const sAtV = (v) => { const [x0, z0] = toXZ(uvAt(uv[i], v), v); return path.sAt(x0, z0); };
    // the platforms: v 3337 .. 3596 (OSM ways 180750913/14); west island between tracks 0-1, east island between 2-3
    const sv0 = sAtV(PARK_VS + 0.5), sv1 = sAtV(L.VN - 0.5);
    return {
      id: `park${i}${dir > 0 ? 'N' : 'S'}`,
      path, dir, sVis: [Math.min(sv0, sv1), Math.max(sv0, sv1)],
      sStop: sAtV(dir > 0 ? 3595.0 : 3338.2),
      side: (i === 0 || i === 2) ? [C29, S29] : [-C29, -S29],   // tracks 0 and 2 have their platform to the east (+u)
    };
  };
  return { mk };
}
function uvAt(T, v) {
  if (v <= T[0][1]) return T[0][0];
  for (let k = 0; k + 1 < T.length; k++) { const a = T[k], b = T[k + 1]; if (v <= b[1]) return a[0] + ((b[0] - a[0]) * (v - a[1])) / (b[1] - a[1]); }
  return T[T.length - 1][0];
}

// ---------------------------------------------------------------------------------------------- the timetable
const HOUR = (() => {
  const h = Q.get('trainhour'); if (h !== null && isFinite(+h)) return +h;
  const t = Q.get('time');
  return { day: 13, noon: 12, golden: 18.25, dusk: 19.25, night: 23, morning: 8.5 }[t] ?? (isFinite(+t) && t !== null && t !== '' ? +t : 13);
})();
// the 1 (NYCT weekday): peaks ~4.5 min, midday 6, evening 8, late night 20; Metro-North at Harlem-125th (all three lines)
// per direction: PM peak northbound ~15/h, the other direction ~7/h, midday ~7/h, evening ~4/h, night ~1.5/h
function headway1(h) { return h >= 6.5 && h < 9.5 ? 270 : h >= 9.5 && h < 16 ? 360 : h >= 16 && h < 19.5 ? 270 : h >= 19.5 && h < 23 ? 480 : 1200; }
function headwayMN(h, dir) {
  const pmPeak = h >= 16 && h < 19.5, amPeak = h >= 6.5 && h < 9.5;
  if (pmPeak) return dir > 0 ? 240 : 510;
  if (amPeak) return dir < 0 ? 240 : 510;
  return h >= 9.5 && h < 16 ? 510 : h >= 19.5 && h < 23.5 ? 900 : 2400;
}
const MN_LINES = [
  { line: 'New Haven', kind: 'm8', share: 0.42, dests: [3, 4], track: { 1: 2, '-1': 1 } },
  { line: 'Harlem', kind: 'm7a', share: 0.34, dests: [2], track: { 1: 3, '-1': 0 } },
  { line: 'Hudson', kind: 'm7a', share: 0.24, dests: [1, 5], track: { 1: 2, '-1': 1 } },
];
const peak = (h) => (h >= 6.5 && h < 9.5) || (h >= 16 && h < 19.5);
const MIX = Q.get('trmix');      // a look-dev override: every Metro-North train an M7A (Harlem) or an M8 (New Haven)
function mnTrain(k, dir) {
  const r = hash(k, dir * 7.7);
  let acc = 0, L = MN_LINES[0];
  for (const l of MN_LINES) { acc += l.share; if (r <= acc) { L = l; break; } }
  if (MIX === 'm7a') L = MN_LINES[1]; else if (MIX === 'm8') L = MN_LINES[0];
  const cars = peak(HOUR) ? (L.line === 'Hudson' ? 8 : 10) : (L.line === 'New Haven' ? 8 : 6);
  return { kind: L.kind, line: L.line, cars, track: L.track[dir], dest: dir < 0 ? 0 : L.dests[Math.floor(hash(k, 3.3) * L.dests.length)] };
}
// a run's kinematics, `t` relative to the moment the train stops at the platform
function runAt(R, t) {
  const { vin, b, a, vmax, dwell } = R;
  if (t < 0) {
    const tb = vin / b;
    if (-t <= tb) return { s: -0.5 * b * t * t, v: -b * t };
    return { s: -(vin * vin) / (2 * b) - vin * (-t - tb), v: vin };
  }
  if (t <= dwell) return { s: 0, v: 0 };
  const t2 = t - dwell, ta = vmax / a;
  if (t2 <= ta) return { s: 0.5 * a * t2 * t2, v: a * t2 };
  return { s: (vmax * vmax) / (2 * a) + vmax * (t2 - ta), v: vmax };
}
// the doors (platform side): open 2.5 s after the stop over 2.2 s, close from dwell - 5 over 3 s
function doorsAt(R, t) {
  if (t < 2.5 || t > R.dwell) return 0;
  const o = Math.min(1, (t - 2.5) / 2.2), c = Math.min(1, Math.max(0, (t - (R.dwell - 5)) / 3));
  const f = Math.min(o, 1 - c);
  return f * f * (3 - 2 * f);
}
// the time (relative to the stop) at which the run's front is at s - sStop = ds (monotonic outside the dwell)
function timeAtDs(R, ds) {
  if (ds < 0) {
    const db = (R.vin * R.vin) / (2 * R.b);
    if (-ds <= db) return -Math.sqrt((2 * -ds) / R.b);
    return -(R.vin / R.b) - (-ds - db) / R.vin;
  }
  const da = (R.vmax * R.vmax) / (2 * R.a);
  if (ds <= da) return R.dwell + Math.sqrt((2 * ds) / R.a);
  return R.dwell + R.vmax / R.a + (ds - da) / R.vmax;
}

// the lines' rails as point lists (tools/terrain/anchor_gate.mjs holds them over the ground)
export function trainLines() {
  const out = [];
  try { const { NB, SB } = mvvLines(); for (const L of [NB, SB]) out.push({ id: L.id, pts: (L.path.p || []).filter((_, i) => L.path.s[i] >= L.sVis[0] && L.path.s[i] <= L.sVis[1]) }); } catch { /* none */ }
  try { const PL = parkLines(); for (const i of [0, 1, 2, 3]) { const L = PL.mk(i, 1); out.push({ id: L.id, pts: (L.path.p || []).filter((_, k) => L.path.s[k] >= L.sVis[0] && L.path.s[k] <= L.sVis[1]) }); } } catch { /* none */ }
  return out;
}
// ---------------------------------------------------------------------------------------------- services
function buildServices() {
  const out = [];
  try {
    const { NB, SB } = mvvLines();
    // R62A: 2.5 mph/s, 3.0 mph/s full service (a normal stop ~2.6), max 55 mph; ~30 mph over the viaduct (assumed)
    for (const [ln, dir] of [[NB, 1], [SB, -1]]) {
      out.push({ id: `1${dir > 0 ? 'N' : 'S'}`, route: '1', ln, lines: [ln], dir, head: headway1(HOUR), phase: dir > 0 ? 37 : 151,
        R: { vin: 30 * MPH, b: 2.6 * MPH, a: 2.5 * MPH, vmax: 32 * MPH, dwell: 28 },
        consist: () => ({ kind: 'r62a', cars: 10 }) });
    }
  } catch (e) { console.warn('[trains] Manhattan Valley line unavailable', e); }
  try {
    const PL = parkLines();
    const ln = { 1: {}, '-1': {} };
    for (const dir of [1, -1]) for (const i of [0, 1, 2, 3]) ln[dir][i] = PL.mk(i, dir);
    // M7A: 2 mph/s; M8 similar; ~35-45 mph over the viaduct (assumed), a ~45 s stop at Harlem-125th
    for (const dir of [1, -1]) {
      out.push({ id: `MN${dir > 0 ? 'N' : 'S'}`, route: 'MN', lnOf: (c) => ln[dir][c.track], lines: Object.values(ln[dir]), dir, head: headwayMN(HOUR, dir), phase: dir > 0 ? 95 : 260,
        R: { vin: 35 * MPH, b: 2.0 * MPH, a: 1.9 * MPH, vmax: 45 * MPH, dwell: 45 },
        consist: (k) => mnTrain(k, dir) });
    }
  } catch (e) { console.warn('[trains] Park Avenue line unavailable', e); }
  return out;
}

// ---------------------------------------------------------------------------------------------- the trains at a time
const _o = { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0 }, _o2 = { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0 };
// every car of every train on the drawn track at sim time t: [{ kind, car pose, trucks, wheels, doors, lamps, ... }]
export function carsAt(SV, t, shift = null) {
  const out = [];
  for (const sv of SV) {
    const head = sv.head, ph = sv.phase + (shift?.[sv.id] || 0);
    // the window of stop times whose runs can be on the drawn track now (generous: 900 s either side)
    const k0 = Math.floor((t - 900 - ph) / head) - 1, k1 = Math.ceil((t + 900 - ph) / head) + 1;
    for (let k = k0; k <= k1; k++) {
      const T = ph + k * head + (hash(k, sv.dir * 3.1) - 0.5) * 0.3 * head;
      const tr = t - T;
      if (tr < -600 || tr > 600) continue;
      const c = sv.consist(k), ln = sv.lnOf ? sv.lnOf(c) : sv.ln;
      if (!ln) continue;
      const S = SPECS[c.kind], R = sv.R, run = runAt(R, tr), front = ln.sStop + run.s;
      const Ltr = c.cars * S.LC;
      if (front < ln.sVis[0] || front - Ltr > ln.sVis[1]) continue;
      const doors = doorsAt(R, tr);
      for (let i = 0; i < c.cars; i++) {
        const sc = front - S.LC * (i + 0.5);          // the car's middle
        const sa = sc + S.truckX, sb = sc - S.truckX;
        if (sb - S.LB / 2 + S.truckX < ln.sVis[0] || sa + S.LB / 2 - S.truckX > ln.sVis[1]) continue;   // off the drawn track
        ln.path.at(sa, _o); ln.path.at(sb, _o2);
        const ax = _o.x, ay = _o.y, az = _o.z, bx = _o2.x, by = _o2.y, bz = _o2.z;
        const dx = ax - bx, dz = az - bz, dl = Math.hypot(dx, dz) || 1;
        // married pairs (Metro-North): the second car of a pair turned (cab ends out); R62A all forward
        const rev = c.kind !== 'r62a' && i % 2 === 1;
        const fx = dx / dl, fz = dz / dl;
        const yaw = Math.atan2(-fz, fx) + (rev ? Math.PI : 0);
        // lamps: the train's front shows white, its rear red; a reversed car's +x end looks backward
        const first = i === 0, last = i === c.cars - 1;
        let fw = 0, fr = 0, rw = 0, rr = 0;
        if (first) { if (!rev) fw = 1; else rw = 1; }
        if (last) { if (!rev) rr = 1; else fr = 1; }
        // which local side faces the platform: local +z in world = (sin yaw, cos yaw)
        const sz = Math.sin(yaw) * ln.side[0] + Math.cos(yaw) * ln.side[1] > 0 ? 1 : -1;
        out.push({
          sv: sv.id, k, kind: c.kind, i, rev, x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2, yaw,
          trucks: [[ax, ay, az, Math.atan2(-_o.tz, _o.tx) + (rev ? Math.PI : 0)], [bx, by, bz, Math.atan2(-_o2.tz, _o2.tx) + (rev ? Math.PI : 0)]],
          roll: (front - S.LC * i) / S.wheelR * (rev ? 1 : -1),
          doors, doorSide: sz, lamps: [fw, fr, rw, rr], last, num: (k * 7 + i * 3 + (sv.dir > 0 ? 0 : 5)) & 31, dest: c.dest ?? 0, v: run.v,
          clipNear: front - S.LC * i > ln.sVis[1] - 12 || front - S.LC * (i + 1) < ln.sVis[0] + 12,
          enc: !!ln.enc && sc > ln.enc[0] && sc < ln.enc[1], lk: ln.id, s: sc,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- drawing
const KINDS = ['r62a', 'm7a', 'm8'];
const CAP = { r62a: 48, m7a: 64, m8: 64 };
const LOD0_D = 45;
function mkInst(geo, mat, cap, extra) {
  const g = geo.clone();
  if (extra) for (const [name, size] of extra) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.InstancedMesh(g, mat, cap);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false;
  const k = mat.name || '';
  m.castShadow = !/glass|lamps|signs|lit|interior|decals/.test(k);
  m.receiveShadow = !/lamps|signs|lit/.test(k);
  m.name = 'trains:' + k;
  if (/glass/.test(k)) m.renderOrder = 2;
  return m;
}
function setsFor(kind, M, root) {
  const m = carModel(kind), S = m.spec, cap = CAP[kind], slots = doorSlots(S).length * 2;
  const extraOf = (k) => (k === 'lamps' ? [['iLampA', 4], ['iLampB', 4]] : k === 'signs' || k === 'decals' ? [['iUvo', 4]] : null);
  const grp = (geos, n) => Object.entries(geos).filter(([k]) => M[k]).map(([k, geo]) => { const im = mkInst(geo, M[k], n, extraOf(k)); root.add(im); return { k, im }; });
  return {
    kind, S, m,
    lod: [grp(m.lod[0], cap), grp(m.lod[1], cap)],
    door: grp(m.door.geos, cap * slots),
    truck: grp(m.truck, cap * 2),
    wheel: grp(m.wheel, cap * 4),
    gap: grp(m.gap, cap),
  };
}

export function initTrains(engine, streamer = null, opts = {}) {
  if (Q.get('trains') === '0') return null;
  const scene = engine.scene, M = trainMats();
  const root = new THREE.Group(); root.name = 'trains'; root.matrixAutoUpdate = false;
  scene.add(root);
  const SV = buildServices();
  const sets = {}; for (const k of KINDS) sets[k] = setsFor(k, M, root);
  const status = { services: SV.map((s) => ({ id: s.id, head: s.head })), hour: HOUR, cars: 0, drawn: [0, 0], calls: 0, tris: 0, ms: 0, cue: null, last: -1 };
  const shift = {};
  // FL36 (teaser 7 re-shoot, t7ValleyTrain f12-13: a near car's roof unit appeared at the 45 m switch): the film
  // (`filmlod=1`, offline) draws every car at LOD0; `?trlod=` still wins
  const forceLod = Q.get('trlod') !== null ? Q.get('trlod') : (Q.get('filmlod') === '1' ? '0' : null);
  const mtx = new THREE.Matrix4(), m2 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), eu = new THREE.Euler();
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
  const RY = new THREE.Matrix4().makeRotationY(Math.PI), mw = new THREE.Matrix4(), mr = new THREE.Matrix4();
  let lastT = null, lastCam = '';
  function update(cam) {
    const t = ENV.time.value + (opts.t0 || 0);
    const ck = cam ? cam.matrixWorld.elements.join(',') : '';
    if (t === lastT && ck === lastCam) return;
    lastT = t; lastCam = ck;
    const t0 = performance.now();
    trainMatsUpdate();
    // ==== R1D (CORE, docs/notes/arch-r1-d.md): ?replay: the take's train cars (src/replay/coreReplay.js) in place of the timetable's
    const r1dCars = typeof window !== 'undefined' && window.__REPLAY && window.__REPLAY.trainCarsAt ? window.__REPLAY.trainCarsAt(t) : null;
    const cars = r1dCars || carsAt(SV, t, shift);
    // ==== R1D end
    if (cam) { cam.updateMatrixWorld(); pv.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); frustum.setFromProjectionMatrix(pv); }
    const cp = cam ? cam.position : new THREE.Vector3(1e9, 0, 0);
    const cnt = {};
    for (const k of KINDS) cnt[k] = { lod: [0, 0], door: 0, truck: 0, wheel: 0, gap: 0 };
    let drawn0 = 0, drawn1 = 0;
    for (const c of cars) {
      const st = sets[c.kind], S = st.S, n = cnt[c.kind];
      const d = Math.hypot(c.x - cp.x, c.y + 2 - cp.y, c.z - cp.z);
      if (d > 3000) continue;
      sph.center.set(c.x, c.y + S.H / 2, c.z); sph.radius = S.LB / 2 + 2;
      if (cam && d > 150 && !frustum.intersectsSphere(sph)) continue;
      const L = forceLod !== null ? +forceLod : d < LOD0_D ? 0 : 1;
      if (n.lod[L] >= CAP[c.kind]) continue;
      // the body
      q.setFromEuler(eu.set(0, c.yaw, 0)); pos.set(c.x, c.y, c.z); mtx.compose(pos, q, scl);
      const li = n.lod[L]++;
      for (const { k, im } of st.lod[L]) {
        im.setMatrixAt(li, mtx);
        if (k === 'lamps') { im.geometry.getAttribute('iLampA').setXYZW(li, ...c.lamps); im.geometry.getAttribute('iLampB').setXYZW(li, c.doors > 0.05 ? 1 : 0, 1, 0, 0); }
        else if (k === 'signs' || k === 'decals') { const [nu, nv] = numOffset(S, c.kind === 'r62a' ? c.num : c.num & 7); im.geometry.getAttribute('iUvo').setXYZW(li, nu, nv, 0, destOffset(c.dest)); }
      }
      if (L === 0) drawn0++; else drawn1++;
      // doors (both sides; the platform side slides open)
      const lw = S.doorW / S.leaves;
      for (const [x, dir] of doorSlots(S)) for (const sg of [1, -1]) {
        const f = sg === c.doorSide ? c.doors : 0;
        m2.makeTranslation(x + dir * lw * f * 0.98, 0, sg * (S.W / 2 - 0.022));
        if (sg < 0) m2.multiply(RY);
        m2.premultiply(mtx);
        const di = n.door++;
        for (const { im } of st.door) im.setMatrixAt(di, m2);
      }
      // trucks and wheelsets (on the curve: each truck along the track at its pivot)
      const ti0 = n.truck;
      c.trucks.forEach(([tx, ty, tz, tyaw]) => {
        q.setFromEuler(eu.set(0, tyaw, 0)); pos.set(tx, ty, tz); m2.compose(pos, q, scl);
        const ti = n.truck++;
        for (const { im } of st.truck) im.setMatrixAt(ti, m2);
        for (const ax of [-S.wheelBase / 2, S.wheelBase / 2]) {
          const w = mw.makeTranslation(ax, S.wheelR, 0).multiply(mr.makeRotationZ(c.roll));
          w.premultiply(m2);
          const wi = n.wheel++;
          for (const { im } of st.wheel) im.setMatrixAt(wi, w);
        }
      });
      void ti0;
      // the coupling gap behind this car (not behind the last)
      if (!c.last) {
        const gx = -S.LC / 2 * (c.rev ? -1 : 1);
        m2.makeTranslation(gx, 0, 0).premultiply(mtx);
        const gi = n.gap++;
        for (const { im } of st.gap) im.setMatrixAt(gi, m2);
      }
    }
    // counts, upload flags
    let calls = 0, tris = 0;
    for (const k of KINDS) {
      const st = sets[k], n = cnt[k];
      const fin = (arr, count) => { for (const { im } of arr) { im.count = count; if (count) { im.instanceMatrix.needsUpdate = true; for (const a of ['iLampA', 'iLampB', 'iUvo']) { const at = im.geometry.getAttribute(a); if (at) at.needsUpdate = true; } calls++; tris += count * (im.geometry.getAttribute('position').count / 3); } im.visible = count > 0; } };
      fin(st.lod[0], n.lod[0]); fin(st.lod[1], n.lod[1]); fin(st.door, n.door); fin(st.truck, n.truck); fin(st.wheel, n.wheel); fin(st.gap, n.gap);
    }
    status.cars = cars.length; status.drawn = [drawn0, drawn1]; status.calls = calls; status.tris = Math.round(tris); status.t = +t.toFixed(3);
    status.ms = +(performance.now() - t0).toFixed(2);
  }
  // the hook: an always-drawn empty trigger mesh arms a one-shot scene.onBeforeRender, so the instances are written
  // before the next render of the scene projects them (the vg36 pattern: never inside a pass)
  const camera = () => engine.camera || null;
  let armed = false, trigN = 0, updN = 0, warned = 0;
  const arm = () => {
    if (armed) return;
    armed = true;
    const orig = scene.onBeforeRender;
    scene.onBeforeRender = function (r, s, c, rt) {
      scene.onBeforeRender = orig;
      armed = false;
      const main = c && (c === camera() || (!camera() && c.isPerspectiveCamera && c.fov > 5 && c.fov < 89 && Math.abs(c.aspect - innerWidth / innerHeight) < 0.05));
      if (main) { updN = trigN; try { update(c); } catch (e) { if (warned++ < 3) console.warn('[trains]', e); } }
      orig.call(this, r, s, c, rt);
      if (!main) arm();
    };
  };
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const trig = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  trig.frustumCulled = false; trig.name = 'trains:trigger'; trig.renderOrder = -1000;
  trig.onBeforeRender = (r, s, cam) => {
    if (camera() && cam !== camera()) return;
    trigN++;
    if (armed && trigN - updN > 3) armed = false;
    arm();
  };
  root.add(trig);
  // ------------------------------------------------------------------ the take director (record mode)
  // a take's path phases each service near it so that a train is in frame through the take and no car crosses an end
  // of the drawn track inside the frame. Deterministic: the path and the sim clock at its install decide.
  const cueOn = Q.get('trcue') !== '0';
  function cue(path) {
    try {
      if (!path || !path.keys || !(path.duration < 1000)) return null;
      const tc0 = performance.now();
      const keys = path.keys.map((k) => { const [x, z] = project(k.p[0], k.p[1]); const g = path.abs ? 0 : groundY(x, z); return new THREE.Vector3(x, k.p[2] + g, z); });
      const looks = path.keys.map((k) => { const src = k.look || k.p; const [x, z] = project(src[0], src[1]); const g = path.abs ? 0 : groundY(x, z); return new THREE.Vector3(x, (k.look ? k.look[2] : k.p[2]) + g, z); });
      const cv = new THREE.CatmullRomCurve3(keys, false, 'catmullrom', path.tension ?? 0.5), lv = new THREE.CatmullRomCurve3(looks, false, 'catmullrom', path.tension ?? 0.5);
      const cam = new THREE.PerspectiveCamera(path.fov || engine.camera?.fov || 58, (innerWidth || 16) / (innerHeight || 9), 0.4, 5000);
      const t0 = ENV.time.value + (opts.t0 || 0), dur = path.duration, N = 10;
      const poses = [];
      for (let i = 0; i <= N; i++) {
        const u = i / N, p = cv.getPointAt(u), l = lv.getPointAt(u);
        cam.position.copy(p); cam.lookAt(l); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
        const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        poses.push({ t: t0 + dur * u, f, p: p.clone() });
      }
      // what each pose can see of each line: track points every 6 m at the cars' mid and roof heights, in the frustum,
      // within 700 m and not behind a building prism (city/colliders.js: footprints and the kit boxes)
      const STEP = 6, vis = new Map();
      const tp = { x: 0, y: 0, z: 0, tx: 1, ty: 0, tz: 0 }, dir3 = new THREE.Vector3(), tgt = new THREE.Vector3();
      let rays = 0;
      for (const sv of SV) for (const ln of sv.lines || []) {
        if (vis.has(ln.id)) continue;
        const N = Math.ceil((ln.sVis[1] - ln.sVis[0]) / STEP) + 1, tabs = [];
        for (const P of poses) {
          const v = new Uint8Array(N);
          for (let i = 0; i < N; i++) {
            ln.path.at(ln.sVis[0] + i * STEP, tp);
            for (const h of [1.7, 3.3]) {
              tgt.set(tp.x, tp.y + h, tp.z);
              const d = tgt.distanceTo(P.p);
              if (d > 700 || !P.f.containsPoint(tgt)) continue;
              dir3.subVectors(tgt, P.p).normalize(); rays++;
              const hit = COLLIDERS.raycast(P.p, dir3, d);
              if (!hit || hit.dist > d - 4) v[i]++;
            }
          }
          tabs.push(v);
        }
        vis.set(ln.id, { tabs, s0: ln.sVis[0], N });
      }
      const seen = (c, pi) => {
        const V = vis.get(c.lk); if (!V) return 0;
        const i0 = Math.round((c.s - V.s0) / STEP); let n = 0;
        for (let i = i0 - 2; i <= i0 + 2; i++) if (i >= 0 && i < V.N) n += V.tabs[pi][i];
        return n / 10;
      };
      const res = {};
      const anyVis = (sv) => (sv.lines || []).some((ln) => { const V = vis.get(ln.id); return V && V.tabs.some((t) => t.some((x) => x > 0)); });
      for (const sv of SV) {
        if (!anyVis(sv)) continue;            // nothing of this service's track is in sight on this path
        let best = null;
        for (let d = 0; d < sv.head; d += 2) {
          const sh = { [sv.id]: d };
          let score = 0, bad = 0;
          poses.forEach((P, pi) => {
            for (const c of carsAt([sv], P.t, sh)) {
              const S = SPECS[c.kind], sp = new THREE.Sphere(new THREE.Vector3(c.x, c.y + S.H / 2, c.z), S.LB / 2);
              const dist = sp.center.distanceTo(P.p);
              if (dist > 700 || !P.f.intersectsSphere(sp)) continue;
              if (dist < 6) { bad += 50; continue; }      // a car through the lens: never
              const w = seen(c, pi);
              if (c.clipNear && w > 0) bad += 5;
              score += w * Math.min(1, 60 / dist) * (c.v > 0.5 ? 1.3 : 1) * (c.enc ? 0.15 : 1);
            }
          });
          const val = score - bad * 2;
          if (!best || val > best.val + 1e-9) best = { d, val: +val.toFixed(3), score: +score.toFixed(3), bad };
        }
        if (best && best.score > 0.05) { shift[sv.id] = best.d; res[sv.id] = best; }
      }
      res.rays = rays;
      status.cue = { t0: +t0.toFixed(2), dur, res, ms: +(performance.now() - tc0).toFixed(1) };
      lastT = null;
      return status.cue;
    } catch (e) { console.warn('[trains] cue', e); return null; }
  }
  const groundY = (x, z) => { try { const g = streamer?.terrainAt?.(x, z); return g !== null && isFinite(g) ? g : 3.5; } catch { return 3.5; } };
  if (cueOn && typeof window !== 'undefined') {
    const wrap = () => {
      const f = window.__SET_PATH;
      if (typeof f !== 'function' || f.__trains) return false;
      const w = (p) => { const r = f(p); cue(p); return r; };
      w.__trains = true; window.__SET_PATH = w;
      return true;
    };
    if (!wrap()) { let n = 0; const iv = setInterval(() => { if (wrap() || ++n > 600) clearInterval(iv); }, 500); }
  }
  const api = { update, status, cue, shift, services: SV, sets, carsAt: (t) => carsAt(SV, t, shift), root, THREE, ENV };
  if (typeof window !== 'undefined') { window.__TRAINS = api; window.__TRAINS_AT = (t) => carsAt(SV, t ?? ENV.time.value, shift); }
  console.log(`[trains] ${SV.length} services (hour ${HOUR}): ${SV.map((s) => `${s.id} every ${s.head} s`).join(', ')}`);
  return api;
}
void DESTS;
