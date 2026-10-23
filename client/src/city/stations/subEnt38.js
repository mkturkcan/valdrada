// ST38 (STATIONS2, docs/notes/ar34-stations2.md): the subway entrances on 125th Street at Lenox Avenue (the 2 3) and at
// St Nicholas Avenue (the A C B D) as built, and the sidewalk at the Lenox corners. `?st38=0` restores the earlier state
// (pk/pkStreet.js subway(): a stair head centred on each MTA point, open toward 125th Street, and the bare ground between
// the compiled sidewalk and the buildings).
//
// PLACES. The MTA's entrance points (data.ny.gov i9wp-a4ja "MTA Subway Entrances and Exits: 2024"; the pipeline's copy
// client/data/raw/subway.csv) give each entrance's station, type and corner. At Lenox the points of the east stairs lie
// 0.2 m from the compiled kerb, so a stair centred on them stood half in the roadway. Each stair here runs along its kerb
// with its kerb-side face 0.45 m off the compiled kerb; along the kerb it sits where the 2024 orthophoto puts it (the NE
// stair: its ends 1.3 m north and 4.25 m south of the MTA point, 5.54 m
// over all; the SE stair's north end 2.8 m north of its point), the NW and SW stairs as their east twins and the
// orthophoto. Every Lenox stair is closed toward 125th Street (its station sign and a double-sided digital display on
// that end) and opens away from it; the globes stand on the building side, one at the closed end and one by the mouth.
// The St Nicholas stairs stand on their points (3.9-6.0 m off the kerb; the two west of the avenue moved 1.07 m off the
// building line, whose face is 0.45 m from their points), open away from 125th Street, globes at the mouth; the elevator stands 0.6 m off 125th Street's kerb, its doors toward the corner, in a green frame.
// FORM. A granite plinth round three sides, the green steel railing on it (posts, rails, pickets, a frieze), the station
// sign on the closed end ("125 Street Station" and the direction), "Subway" plates on the sides, the stair itself down
// through a hole cut in the walk: risers 178 mm, treads 279 mm with yellow nosings, glazed tile walls, handrails, the
// stair running on under the walk to a lit landing.
import { haLiftSoon } from '../../world/haAnchor.js';   // P1 TERRAIN (`?terrain=p1`): the stair heads' colliders on the lifted walk
import * as THREE from 'three';
import { Model, cyl, rbox, plane, lathe, rod } from '../pk/pkGeo.js';
import { COLLIDERS } from '../colliders.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const ST38 = !(Q && Q.get('st38') === '0');

export const ENT38 = [
  {"id":"lenA","x":2148.795,"z":-2733.544,"yaw":-0.5237,"L":5.54,"W":2.45,"lines":"23","dir":"Downtown & Brooklyn","display":1,"bside":-1,"globes":"lenox","mta":[40.8076973,-73.9457523]},
  {"id":"lenB","x":2165.215,"z":-2763.052,"yaw":2.6505,"L":5.54,"W":2.45,"lines":"23","dir":"Downtown & Brooklyn","display":1,"bside":1,"globes":"lenox","mta":[40.8079975,-73.94553]},
  {"id":"lenC","x":2189.022,"z":-2751.755,"yaw":2.6326,"L":5.54,"W":2.45,"lines":"23","dir":"Uptown & The Bronx","display":1,"bside":-1,"globes":"lenox","mta":[40.8078903,-73.9452282]},
  {"id":"lenD","x":2171.943,"z":-2720.678,"yaw":-0.4958,"L":5.54,"W":2.45,"lines":"23","dir":"Uptown & The Bronx","display":1,"bside":1,"globes":"lenox","mta":[40.8075694,-73.9454604]},
  {"id":"snS1","x":1544.778,"z":-3061.537,"yaw":-0.5034,"L":5.54,"W":2.45,"lines":"ACBD","dir":"","display":0,"bside":-1,"globes":"curbside","mta":[40.8106533,-73.9528842]},
  {"id":"snS2","x":1567.47,"z":-3101.668,"yaw":2.6399,"L":5.54,"W":2.45,"lines":"ACBD","dir":"","display":0,"bside":1,"globes":"curbside","mta":[40.8110144,-73.952615],"note":"Elevator across 125 St"},
  {"id":"snS3","x":1568.505,"z":-3047.628,"yaw":-0.5042,"L":5.54,"W":2.45,"lines":"ACBD","dir":"","display":0,"bside":1,"globes":"curbside","mta":[40.8105235,-73.9525916]},
  {"id":"snS4","x":1590.488,"z":-3088.314,"yaw":2.6374,"L":5.54,"W":2.45,"lines":"ACBD","dir":"","display":1,"bside":-1,"globes":"curbside","mta":[40.8108896,-73.9523308],"note":"Elevator across 125 St"},
  {"id":"snEL","kind":"elev","x":1546.868,"z":-3074.867,"yaw":1.0696,"lines":"ACBD","frame":"green","mta":[40.8107815,-73.9528525]},
];
// the walk fill: the planimetric sidewalk (NYC Planimetric Database: Sidewalk) minus the compiled surfaces and the
// building footprints at the four Lenox Avenue corners, grown 4 cm under its neighbours; world [x, z] rings
export const FILL38 = [
  {"ext":[[2124.961,-2783.295],[2161.402,-2763.032],[2162.829,-2763.97],[2176.773,-2790.04],[2167.976,-2790.04],[2155.138,-2766.753],[2124.959,-2783.424]],"holes":[]},
  {"ext":[[2124.961,-2749.019],[2140.291,-2740.522],[2140.291,-2740.522],[2140.291,-2740.522],[2140.291,-2740.521],[2140.292,-2740.521],[2140.292,-2740.521],[2140.292,-2740.521],[2140.292,-2740.521],[2140.292,-2740.521],[2140.292,-2740.52],[2140.292,-2740.52],[2140.292,-2740.52],[2140.292,-2740.52],[2140.292,-2740.52],[2140.292,-2740.519],[2140.292,-2740.519],[2140.292,-2740.519],[2140.201,-2740.356],[2140.31,-2740.285],[2140.073,-2739.7],[2140.247,-2739.602],[2140.248,-2739.597],[2139.46,-2738.198],[2139.053,-2737.2],[2131.047,-2723.26],[2127.337,-2716.672],[2124.96,-2712.37],[2124.96,-2699.96],[2126.472,-2699.96],[2147.283,-2735.999],[2146.553,-2737.428],[2124.96,-2749.435]],"holes":[]},
  {"ext":[[2191.788,-2747.174],[2195.087,-2745.34],[2206.148,-2765.341],[2209.828,-2772.001],[2215.04,-2781.421],[2215.04,-2790.04],[2212.32,-2790.039],[2192.961,-2754.217],[2192.319,-2752.811],[2191.87,-2750.01],[2191.305,-2748.601]],"holes":[]},
  {"ext":[[2168.935,-2699.96],[2178.668,-2717.621],[2178.668,-2717.621],[2178.668,-2717.621],[2178.669,-2717.621],[2178.669,-2717.622],[2178.669,-2717.622],[2178.669,-2717.622],[2178.669,-2717.622],[2178.669,-2717.622],[2178.67,-2717.622],[2178.67,-2717.622],[2178.67,-2717.622],[2178.815,-2717.627],[2179.472,-2718.809],[2176.807,-2720.29],[2175.376,-2720.048],[2164.156,-2699.96]],"holes":[]},
];

// the stair's section (model frame: x across, z along with +z the mouth, y up from the walk)
export const RISE = 0.178, RUN = 0.279, PLINTH = 0.25, LAND = 0.35, NSTEP = 24, LANDING = 1.6;
const SIDEWALK_Y = 3.52;
const rot = (yaw, lx, lz) => [lx * Math.cos(yaw) + lz * Math.sin(yaw), -lx * Math.sin(yaw) + lz * Math.cos(yaw)];
export const toWorld = (e, lx, lz) => { const [dx, dz] = rot(e.yaw, lx, lz); return [e.x + dx, e.z + dz]; };
export const toLocal = (e, x, z) => { const dx = x - e.x, dz = z - e.z, c = Math.cos(e.yaw), s = Math.sin(e.yaw); return [dx * c - dz * s, dx * s + dz * c]; };
// the opening cut out of the walk (model frame)
const holeOf = (e) => ({ x0: -e.W / 2 + PLINTH, x1: e.W / 2 - PLINTH, z0: -e.L / 2 + PLINTH, z1: e.L / 2 - LAND });
// a footprint test for the furniture this part drops (the stair heads it replaces and anything standing in the way)
export function st38Inside(x, z, pad = 0.3) {
  if (!ST38) return false;
  for (const e of ENT38) {
    const [lx, lz] = toLocal(e, x, z), W = e.kind === 'elev' ? 2.46 : e.W, L = e.kind === 'elev' ? 2.76 : e.L;
    if (Math.abs(lx) < W / 2 + pad && Math.abs(lz) < L / 2 + pad + (e.kind === 'elev' ? 1.1 : 0)) return true;
  }
  return false;
}
// the old stair heads (pk rows of kind 'subway' / the elevator kiosk) within 9 m of one of these entrances' MTA points
const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const MTA_XZ = ENT38.map((e) => [(e.mta[1] - LON0) * M_LON, -(e.mta[0] - LAT0) * M_LAT]);
export function st38Replaces(x, z) { return ST38 && MTA_XZ.some(([mx, mz]) => Math.hypot(x - mx, z - mz) < 1.5); }
// the pk rows: [kind, x, z, yaw, p]
export function st38Rows() {
  if (!ST38) return [];
  return ENT38.map((e) => e.kind === 'elev'
    ? ['subElev', e.x, e.z, e.yaw, { lines: e.lines, frame: e.frame }]
    : ['sub38', e.x, e.z, e.yaw, { L: e.L, W: e.W, lines: e.lines, dir: e.dir, display: e.display, bside: e.bside, globes: e.globes, note: e.note || '', adv: Math.round(Math.abs(e.x)) % 6, len: 12 }]);
}

// ---------------------------------------------------------------- the tile's walk: the fill, then the openings
const WALK = ['sidewalk', 'plaza', 'brick', 'path', 'gravel', 'warn', 'warnIron', 'grass', 'grassU'];
// clip a convex polygon [[x, y, z], ...] by the half-plane f(p) >= 0 (f linear in x, z)
function clipPoly(P, f) {
  const out = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length], fa = f(a), fb = f(b);
    if (fa >= 0) out.push(a);
    if ((fa >= 0) !== (fb >= 0)) { const t = fa / (fa - fb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]); }
  }
  return out;
}
function fan(P, out) { for (let i = 1; i + 1 < P.length; i++) out.push(...P[0], ...P[i], ...P[i + 1]); }
// cut the rectangle (model frame of e, tile-local coordinates) out of a section's triangles
function cutRect(arr, e, ox, oz, H) {
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw), ex = e.x - ox, ez = e.z - oz;
  const lu = (p) => (p[0] - ex) * c - (p[2] - ez) * s, lv = (p) => (p[0] - ex) * s + (p[2] - ez) * c;
  const planes = [(p) => H.x0 - lu(p), (p) => lu(p) - H.x1, (p) => H.z0 - lv(p), (p) => lv(p) - H.z1];   // >= 0: outside that edge
  const out = [];
  let cut = 0;
  for (let i = 0; i + 8 < arr.length; i += 9) {
    const T = [[arr[i], arr[i + 1], arr[i + 2]], [arr[i + 3], arr[i + 4], arr[i + 5]], [arr[i + 6], arr[i + 7], arr[i + 8]]];
    const us = T.map(lu), vs = T.map(lv);
    if (Math.max(...us) <= H.x0 || Math.min(...us) >= H.x1 || Math.max(...vs) <= H.z0 || Math.min(...vs) >= H.z1) { for (const p of T) out.push(...p); continue; }
    cut++;
    let rest = T;
    for (const f of planes) {
      const piece = clipPoly(rest, f);
      if (piece.length >= 3) fan(piece, out);
      rest = clipPoly(rest, (p) => -f(p));
      if (rest.length < 3) break;
    }
  }
  return cut ? Float32Array.from(out) : arr;
}
// the fill rings as tile-local triangles at the walk's height (earcut-free: the rings are convex-decomposed by THREE)
function fillTris(ox, oz) {
  const out = [];
  for (const F of FILL38) {
    const xs = F.ext.map((p) => p[0]), zs = F.ext.map((p) => p[1]);
    if (Math.max(...xs) < ox || Math.min(...xs) > ox + 512 || Math.max(...zs) < oz || Math.min(...zs) > oz + 512) continue;
    const ring = F.ext.map(([x, z]) => new THREE.Vector2(x, z)), holes = F.holes.map((h) => h.map(([x, z]) => new THREE.Vector2(x, z)));
    const tri = THREE.ShapeUtils.triangulateShape(ring, holes), all = [...ring, ...holes.flat()];
    for (const [a, b, c] of tri) {
      // up-facing order: (q - p) x (r - p) with y up is negative shoelace in (x, z)
      const A = all[a], B = all[b], C = all[c], sh = (B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y);
      const P = sh < 0 ? [A, B, C] : [A, C, B];
      // a triangle in this tile by its centroid (the next tile takes the rest)
      const cx = (A.x + B.x + C.x) / 3, cz = (A.y + B.y + C.y) / 3;
      if (cx < ox || cx >= ox + 512 || cz < oz || cz >= oz + 512) continue;
      for (const p of P) out.push(p.x - ox, SIDEWALK_Y, p.y - oz);
    }
  }
  return out;
}
const _coll = new Set();
// a world triangle [[x, y, z] x 3] with the openings (st38Apply's tile.st38Holes) cut out of it: null when it touches
// none, else the pieces outside them as triangles (world/assemble.js, the drawn ground grid)
export function st38ClipTri(T, holes) {
  let pieces = null;
  for (const h of holes) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
    const lu = (p) => (p[0] - h.x) * c - (p[2] - h.z) * s, lv = (p) => (p[0] - h.x) * s + (p[2] - h.z) * c;
    const cur = pieces || [T], next = [];
    let hit = false;
    for (const P of cur) {
      const us = P.map(lu), vs = P.map(lv);
      if (Math.max(...us) <= h.x0 || Math.min(...us) >= h.x1 || Math.max(...vs) <= h.z0 || Math.min(...vs) >= h.z1) { next.push(P); continue; }
      hit = true;
      let rest = P;
      for (const f of [(p) => h.x0 - lu(p), (p) => lu(p) - h.x1, (p) => h.z0 - lv(p), (p) => lv(p) - h.z1]) {
        const piece = clipPoly(rest, f);
        for (let k = 1; k + 1 < piece.length; k++) next.push([piece[0], piece[k], piece[k + 1]]);
        rest = clipPoly(rest, (p) => -f(p));
        if (rest.length < 3) break;
      }
    }
    if (hit || pieces) pieces = next;
  }
  return pieces;
}
export function st38Apply(tile, ox, oz) {
  if (!ST38 || !tile || !tile.S || tile.st38Done) return;
  tile.st38Done = true;
  const fill = fillTris(ox, oz);
  if (fill.length) {
    const sw = tile.S.sidewalk || new Float32Array(0), n = new Float32Array(sw.length + fill.length);
    n.set(sw, 0); n.set(fill, sw.length);
    tile.S.sidewalk = n;
  }
  const holes = [];
  for (const e of ENT38) {
    if (e.x < ox - 8 || e.x > ox + 520 || e.z < oz - 8 || e.z > oz + 520) continue;
    // the walkers go round every head (sim/peds.js: a 'kit31' prism of 4 m2 or more on the walk is never walked through)
    if (!_coll.has(e.id)) {
      _coll.add(e.id);
      const el = e.kind === 'elev';
      // (P1 TERRAIN: on the lifted walk; flag off, at once)
      // (under the flag the box reaches 0.2 m under the lifted walk: the walk's own lift round the head varies by a few cm)
      haLiftSoon(e.x, e.z, (dy) => { const lo = dy ? 0.2 : 0; try { COLLIDERS.addBox('kit31', { x: e.x, y: SIDEWALK_Y + dy + 0.7 - lo / 2, z: e.z, hw: (el ? 2.3 : e.W) / 2 + 0.05, hh: 0.7 + lo / 2, hd: (el ? 2.6 : e.L) / 2 + 0.05, rotY: -e.yaw }); } catch { /* colliders not loaded */ } });
    }
    if (e.kind === 'elev') continue;
    const H = holeOf(e);
    for (const k of WALK) if (tile.S[k] && tile.S[k].length) tile.S[k] = cutRect(tile.S[k], e, ox, oz, H);
    // the drawn ground grid is cut to the same opening (world/assemble.js st38ClipTri), nothing else of it moves
    holes.push({ x: e.x, z: e.z, yaw: e.yaw, ...H });
  }
  if (holes.length) tile.st38Holes = (tile.st38Holes || []).concat(holes);
  if (typeof window !== 'undefined') { const W = (window.__st38 = window.__st38 || { tiles: 0, fill: 0, holes: 0 }); W.tiles++; W.fill += fill.length / 9; W.holes += holes.length; }
}

// ---------------------------------------------------------------- the islands' corners (every tile, world/assemble.js)
// The compiled roadway leaves a rectangular cut round each median and traffic island while the island's walk ends in a
// rounded or chamfered nose: the corners between them carry no surface, and the ground grid (drawn 0.12-0.27 m under the
// sections) showed there as a sunken rectangle round every nose (Lenox Avenue at 125th Street, the owner on t8LenoxDive).
// Each such gap is paved at the road's level: on a 0.5 m raster, the cells no section covers, within 1 m of a roadway and
// of a raised surface, in clusters that touch the roadway (a tree pit, walled off by its kerb, never does), grown by one
// cell under their neighbours (under the road 3 mm down, under a walk or an island 0.13 m down: both hide it), as roadway. `?st38=0` leaves them.
const GF_R = 0.5, GF_N = Math.round(512 / GF_R);
const GF_ROAD = ['asphalt', 'gutter', 'busred'], GF_COVER = ['paintW', 'paintY', 'paintG', 'curb', 'sidewalk', 'grass', 'grassU', 'path', 'brick', 'plaza', 'gravel', 'warn', 'warnIron', 'rbal', 'rtop', 'rsteel', 'rwall', 'apron'];   // rail (RL36) and the shore aprons (SA37) are no gap either
const GF_RAISED = new Set(['curb', 'sidewalk']);   // street islands and walks (a park's lawns and paths keep their ground)
export function st38GapFill(tile) {
  if (!ST38 || !tile || !tile.S || tile.gf38Done) return 0;
  tile.gf38Done = true;
  const N = GF_N, R = GF_R, roadY = new Float32Array(N * N).fill(NaN), cov = new Uint8Array(N * N), raised = new Uint8Array(N * N);
  let nRoad = 0, nRaised = 0;
  const ras = (a, cb) => {   // scanline: per row the triangle's span at the cells' centre line, y from the plane
    for (let t = 0; t + 8 < a.length; t += 9) {
      const ax = a[t], ay = a[t + 1], az = a[t + 2], bx = a[t + 3], by = a[t + 4], bz = a[t + 5], cx = a[t + 6], cy = a[t + 7], cz = a[t + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) / R - 0.5)), j1 = Math.min(N - 1, Math.floor(Math.max(az, bz, cz) / R - 0.5));
      for (let j = j0; j <= j1; j++) {
        const z = (j + 0.5) * R;
        let xa = Infinity, xb = -Infinity;
        for (const [px, pz, qx, qz] of [[ax, az, bx, bz], [bx, bz, cx, cz], [cx, cz, ax, az]]) {
          if ((pz <= z && qz >= z) || (qz <= z && pz >= z)) {
            if (pz === qz) { xa = Math.min(xa, px, qx); xb = Math.max(xb, px, qx); }
            else { const x = px + ((z - pz) / (qz - pz)) * (qx - px); if (x < xa) xa = x; if (x > xb) xb = x; }
          }
        }
        if (xa > xb) continue;
        const i0 = Math.max(0, Math.ceil(xa / R - 0.5)), i1 = Math.min(N - 1, Math.floor(xb / R - 0.5));
        for (let i = i0; i <= i1; i++) {
          const x = (i + 0.5) * R, w1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
          cb(j * N + i, w1 * ay + w2 * by + (1 - w1 - w2) * cy);
        }
      }
    }
  };
  for (const k of GF_ROAD) if (tile.S[k] && tile.S[k].length) ras(tile.S[k], (c, y) => { cov[c] = 1; if (!(roadY[c] <= y)) roadY[c] = y; nRoad++; });
  if (!nRoad) return 0;
  for (const k of GF_COVER) if (tile.S[k] && tile.S[k].length) ras(tile.S[k], (c) => { cov[c] = 1; if (GF_RAISED.has(k)) { raised[c] = 1; nRaised++; } });
  if (!nRaised) return 0;
  // a subway stair's opening is no gap
  if (tile.st38Holes) for (const h of tile.st38Holes) {
    const c = Math.cos(h.yaw), s = Math.sin(h.yaw), ox = tile.header.origin[0], oz = tile.header.origin[1];
    const i0 = Math.max(0, Math.floor((h.x - 4 - ox) / R)), i1 = Math.min(N - 1, Math.floor((h.x + 4 - ox) / R));
    const j0 = Math.max(0, Math.floor((h.z - 4 - oz) / R)), j1 = Math.min(N - 1, Math.floor((h.z + 4 - oz) / R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = (i + 0.5) * R + ox - h.x, z = (j + 0.5) * R + oz - h.z, u = x * c - z * s, v = x * s + z * c;
      if (u > h.x0 - R && u < h.x1 + R && v > h.z0 - R && v < h.z1 + R) cov[j * N + i] = 1;
    }
  }
  // within 1 m (2 cells) of a road cell and of a raised cell
  const near = (src) => {   // a binary dilation by 2 cells, separable (running counts along rows, then columns)
    const D = 2, tmp = new Uint8Array(N * N), out = new Uint8Array(N * N);
    for (let j = 0; j < N; j++) { let cnt = 0; const o = j * N;
      for (let i = 0; i < N + D; i++) { if (i < N && src(o + i)) cnt++; if (i - 2 * D - 1 >= 0 && src(o + i - 2 * D - 1)) cnt--; const c = i - D; if (c >= 0 && c < N && cnt > 0) tmp[o + c] = 1; } }
    for (let i = 0; i < N; i++) { let cnt = 0;
      for (let j = 0; j < N + D; j++) { if (j < N && tmp[j * N + i]) cnt++; if (j - 2 * D - 1 >= 0 && tmp[(j - 2 * D - 1) * N + i]) cnt--; const c = j - D; if (c >= 0 && c < N && cnt > 0) out[c * N + i] = 1; } }
    return out; };
  const nearRoad = near((c) => roadY[c] === roadY[c]), nearRaised = near((c) => raised[c] === 1);
  const gap = new Uint8Array(N * N);
  for (let c = 0; c < N * N; c++) if (!cov[c] && nearRoad[c] && nearRaised[c]) gap[c] = 1;
  // clusters that touch the roadway (4-adjacent to a road cell), and the road level beside each
  const seen = new Uint8Array(N * N), keep = [];
  for (let c = 0; c < N * N; c++) {
    if (!gap[c] || seen[c]) continue;
    const st = [c], cells = []; seen[c] = 1; let touch = false, yMin = Infinity;
    while (st.length) {
      const q = st.pop(); cells.push(q); const i = q % N, j = (q / N) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
        const r = jj * N + ii;
        if (roadY[r] === roadY[r]) { touch = true; if (roadY[r] < yMin) yMin = roadY[r]; }
        if (gap[r] && !seen[r]) { seen[r] = 1; st.push(r); }
      }
    }
    if (touch && cells.length <= 400) keep.push({ cells, y: yMin - 0.003 });   // 100 m2 at most: an island's corners, not a lot
  }
  if (!keep.length) return 0;
  const out = [];
  let n = 0;
  for (const K of keep) {
    const set = new Set();
    for (const q of K.cells) { const i = q % N, j = (q / N) | 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < N && jj < N) set.add(jj * N + ii); } }
    for (const q of set) {
      const i = q % N, j = (q / N) | 0, x0 = i * R, x1 = x0 + R, z0 = j * R, z1 = z0 + R, y = K.y;
      // up-facing: a negative shoelace in (x, z)
      out.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1);
      n++;
    }
  }
  const a = tile.S.asphalt || new Float32Array(0), m = new Float32Array(a.length + out.length);
  m.set(a, 0); m.set(out, a.length);
  tile.S.asphalt = m;
  if (typeof window !== 'undefined') { const W = (window.__gf38 = window.__gf38 || { tiles: 0, clusters: 0, cells: 0 }); W.tiles++; W.clusters += keep.length; W.cells += n; }
  return n;
}

// ---------------------------------------------------------------- the model
const seg = (q, a, b) => (q ? a : b);
export function sub38(q = 1, p = {}) {
  const M = new Model();
  const L = p.L || 5.54, W = p.W || 2.45, hw = W / 2, hl = L / 2, bs = p.bside || 1;
  const yP = 0.2, yTop = 1.14, yMid = 0.92, yBot = 0.28;
  const H = holeOf({ W, L });
  // the granite plinth round the two sides and the closed end, its inner face going down as the well's coping
  M.add('subGranite', rbox(PLINTH, yP + 0.3, L, 0.012, -hw + PLINTH / 2, (yP - 0.3) / 2, 0, seg(q, 2, 1)));
  M.add('subGranite', rbox(PLINTH, yP + 0.3, L, 0.012, hw - PLINTH / 2, (yP - 0.3) / 2, 0, seg(q, 2, 1)));
  M.add('subGranite', rbox(W - 2 * PLINTH, yP + 0.3, PLINTH, 0.012, 0, (yP - 0.3) / 2, -hl + PLINTH / 2, seg(q, 2, 1)));
  // the railing on the plinth: sides from the closed end to the mouth, and the closed end
  const xr = hw - 0.11, zr0 = -hl + 0.11, zr1 = hl - 0.06;
  const runs = [[-xr, zr0, -xr, zr1], [xr, zr0, xr, zr1], [-xr, zr0, xr, zr0]];
  for (const [x0, z0, x1, z1] of runs) {
    const len = Math.hypot(x1 - x0, z1 - z0), a = Math.atan2(x1 - x0, z1 - z0), m = new Model();
    m.add('subGreen', rbox(0.065, 0.055, len, 0.012, 0, yTop, len / 2));
    m.add('subGreen', rbox(0.05, 0.045, len, 0.008, 0, yMid, len / 2));
    m.add('subGreen', rbox(0.05, 0.045, len, 0.008, 0, yBot, len / 2));
    m.add('subGreen', rbox(0.02, yBot - yP, len, 0.004, 0, (yBot + yP) / 2, len / 2));   // the kick plate
    if (q) {
      const n = Math.round(len / 0.105);
      for (let i = 1; i < n; i++) {
        const z = (len * i) / n;
        m.add('subGreen', rbox(0.018, yMid - yBot, 0.018, 0.003, 0, (yMid + yBot) / 2, z, 1));
        m.add('subGreen', rbox(0.016, yTop - yMid, 0.016, 0.003, 0, (yTop + yMid) / 2, z, 1));
      }
    } else m.add('subGreen', rbox(0.012, yTop - yBot, len, 0.002, 0, (yTop + yBot) / 2, len / 2, 1));
    // posts every 1.4 m or so, capped
    const np = Math.max(1, Math.round(len / 1.4));
    for (let i = 0; i <= np; i++) {
      const z = (len * i) / np;
      m.add('subGreen', rbox(0.075, yTop + 0.05 - yP, 0.075, 0.01, 0, (yTop + 0.05 + yP) / 2, z, seg(q, 2, 1)));
      m.add('subGreen', rbox(0.1, 0.03, 0.1, 0.008, 0, yTop + 0.065, z, 1));
      if (q) m.add('subGreen', lathe([[0.001, yTop + 0.08], [0.03, yTop + 0.09], [0.028, yTop + 0.12], [0.001, yTop + 0.14]], 8).translate(0, 0, z));
    }
    const G = new THREE.Matrix4().makeRotationY(a).premultiply(new THREE.Matrix4().makeTranslation(x0, 0, z0));
    for (const [k, Lg] of m.parts) for (const g of Lg) M.add(k, g.clone().applyMatrix4(G));
  }
  // the station sign on the closed end, facing out (125 Street Station, the direction, the bullets)
  const zs = zr0 - 0.045, sk = 'face:sub38|' + (p.lines || '23') + '|' + (p.dir || '') + '|' + (p.note || '');
  M.add('black', rbox(1.72, 0.6, 0.03, 0.006, 0, 0.62, zs + 0.012, 1));
  M.add(sk, plane(1.68, 0.56).rotateY(Math.PI).translate(0, 0.62, zs - 0.008));   // 5 mm off its backing (no coplanar pair in the export)
  // "Subway" plates in the frieze, both sides, both faces
  for (const sx of [-1, 1]) {
    const xs = sx * (xr + 0.035);
    M.add('black', rbox(0.02, 0.17, 0.8, 0.004, xs, (yTop + yMid) / 2, 0.1, 1));
    M.add('face:sub38s', plane(0.78, 0.15).rotateY(sx * Math.PI / 2).translate(xs + sx * 0.015, (yTop + yMid) / 2, 0.1));
    M.add('face:sub38s', plane(0.78, 0.15).rotateY(-sx * Math.PI / 2).translate(xs - sx * 0.015, (yTop + yMid) / 2, 0.1));
  }
  // the double-sided display over the closed end (Lenox Avenue)
  if (p.display) {
    const zd = zr0, yc = yTop + 0.78;
    for (const sx of [-0.88, 0.88]) M.add('black', rbox(0.08, yc + 0.6 - yTop, 0.08, 0.01, sx, (yc + 0.6 + yTop) / 2, zd, seg(q, 2, 1)));
    M.add('black', rbox(2.02, 1.25, 0.14, 0.02, 0, yc, zd, seg(q, 2, 1)));
    for (const sgn of [1, -1]) {
      const g = plane(1.9, 1.12);
      if (sgn < 0) g.rotateY(Math.PI);
      g.translate(0, yc, zd + sgn * 0.075);
      M.add('screen:ad' + ((p.adv || 3) % 6) + (sgn > 0 ? 'a' : 'b'), g);
    }
  }
  // the globes: Lenox, on the building side at the closed end and by the mouth; elsewhere both mouth corners
  const gpos = p.globes === 'lenox' ? [[bs * xr, zr0], [bs * xr, zr1 - 0.95]] : p.globes === 'curbside' ? [[-bs * xr, zr0], [-bs * xr, zr1 - 0.95]] : [[-xr, zr1], [xr, zr1]];
  const gh = 2.42;
  for (const [x, z] of gpos) {
    M.add('subGreen', cyl(0.045, 0.06, gh - yTop, seg(q, 10, 6), yTop).translate(x, 0, z));
    M.add('subGreen', lathe([[0.001, gh], [0.065, gh], [0.05, gh + 0.06], [0.001, gh + 0.06]], 10).translate(x, 0, z));
    M.add('globeG', lathe([[0.001, gh + 0.06], [0.11, gh + 0.11], [0.15, gh + 0.24], [0.15, gh + 0.36], [0.1, gh + 0.46], [0.04, gh + 0.5], [0.001, gh + 0.51]], seg(q, 16, 8)).translate(x, 0, z));
    M.add('subGreen', lathe([[0.04, gh + 0.5], [0.05, gh + 0.54], [0.001, gh + 0.57]], 8).translate(x, 0, z));
  }
  // ---- the well. Steps from the mouth's landing down toward the closed end, on under the walk to a landing
  const x0 = H.x0, x1 = H.x1, wd = x1 - x0, zT = H.z1, nS = q ? NSTEP : 12, rr = q ? RISE : RISE * 2, rn = q ? RUN : RUN * 2;
  for (let k = 1; k <= nS; k++) {
    const zf = zT - (k - 1) * rn, y = -k * rr;
    M.add('subTread', rbox(wd, 0.04, rn, 0.002, 0, y - 0.02, zf - rn / 2, 1));             // the tread
    M.add('subTread', plane(wd, rr - 0.04).rotateY(Math.PI).translate(0, y + (rr - 0.04) / 2, zf - 0.0005));   // the riser (faces down the stair), up to the tread above's underside
    if (q) M.add('subNosing', rbox(wd - 0.06, 0.006, 0.05, 0.001, 0, y + 0.003, zf - 0.03, 1));
  }
  const zB = zT - nS * rn, yB = -nS * rr, zE = zB - LANDING;
  M.add('subTread', rbox(wd, 0.04, LANDING, 0.002, 0, yB - 0.02, zB - LANDING / 2, 1));
  // the walls (glazed tile), the end wall, the soffit under the walk sloping down with the stair, the landing's ceiling
  const wallT = -0.3, wallH = wallT - yB + 0.05;
  for (const sx of [-1, 1]) {
    const g = plane(zT - zE + 0.02, wallH).rotateY(-sx * Math.PI / 2).translate(sx * (wd / 2 + 0.01), wallT - wallH / 2, (zT + zE) / 2);
    M.add('subTile', g);
    // the dark base course along the treads' line
    if (q) M.add('subDark', rod([sx * (wd / 2 - 0.004), -0.15, zT], [sx * (wd / 2 - 0.004), yB - 0.15 + 0.0, zB], 0.03, 4));
  }
  M.add('subTile', plane(wd + 0.02, -yB + 0.4).translate(0, -(-yB + 0.4) / 2, zE));
  const yS0 = -0.35, zS0 = H.z0, yS1 = yB + 2.35;
  { // the soffit: flat under the walk to the opening's end, then down with the stair, flat over the landing
    const len = Math.hypot(yS0 - yS1, zS0 - zB - 0.2), phi = Math.atan2(zS0 - zB - 0.2, yS0 - yS1);   // faces down the well
    const s1 = plane(wd + 0.02, len).rotateX(phi).translate(0, (yS0 + yS1) / 2, (zS0 + zB + 0.2) / 2);
    M.add('subDark', s1);
    M.add('subDark', plane(wd + 0.02, zB + 0.2 - zE).rotateX(Math.PI / 2).translate(0, yS1, (zB + 0.2 + zE) / 2));
    // the end of the walk's slab over the opening's closed end (its face toward the mouth)
    M.add('subDark', plane(wd, 0.35).translate(0, -0.175, zS0 - 0.001));
    // fluorescent fixtures on the soffit and over the landing
    const fx = (z, y) => M.add('lum', rbox(0.12, 0.05, 1.2, 0.01, 0, y - 0.03, z, 1));
    fx(zS0 - 0.6, yS0 - 0.02); fx((zS0 + zB) / 2, (yS0 + yS1) / 2 - 0.05); fx(zB - LANDING / 2, yS1);
  }
  // handrails both sides, 0.9 m over the nosings, on brackets
  for (const sx of [-1, 1]) {
    const xh = sx * (wd / 2 - 0.07), A = [xh, 0.9, zT + 0.25], B = [xh, yB + 0.9, zB - 0.3];
    M.add('stainless', rod(A, B, 0.021, seg(q, 8, 4)));
    if (q) for (let t = 0.1; t < 1; t += 0.2) {
      const P = [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
      M.add('stainless', rod([P[0], P[1] - 0.01, P[2]], [sx * (wd / 2 - 0.005), P[1] - 0.06, P[2]], 0.009, 4));
    }
  }
  return M;
}

// ---------------------------------------------------------------- the signs' faces
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const BUL = { 1: '#ee352e', 2: '#ee352e', 3: '#ee352e', 4: '#00933c', 5: '#00933c', 6: '#00933c', A: '#0039a6', B: '#ff6319', C: '#0039a6', D: '#ff6319' };
const _tex = new Map();
function canvasTex(key, w, h, draw) {
  let t = _tex.get(key);
  if (t) return t;
  const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const x = c.getContext('2d');
  draw(x, w, h);
  t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  _tex.set(key, t);
  return t;
}
// 1.68 x 0.56 m: "125 Street Station" over the direction, the route bullets on the right (the closed end's sign, 2026-08)
export function sub38SignTex(lines, dir, note = '') {
  return canvasTex('sub38|' + lines + '|' + dir + '|' + note, 768, 256, (x, w, h) => {
    x.fillStyle = '#111214'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.textBaseline = 'alphabetic';
    x.font = `bold 58px ${FONT}`; x.fillText('125 Street Station', 24, 62);
    if (dir) { x.font = `bold 38px ${FONT}`; x.fillText(dir, 26, 110); }
    // the route bullets large under the words (the closed ends' signs, 2026-08 at Lenox: about 0.24 m across; 2023-08 at
    // St Nicholas: A C B D in a row, "Elevator across 125 St" under them on the north side)
    const ls = String(lines).split(''), r = ls.length <= 2 ? 54 : 40, step = r * 2 + 14, cy = dir ? 192 : (note ? 128 : 168);
    ls.forEach((ch, i) => {
      const cx = 26 + r + i * step;
      x.fillStyle = BUL[ch] || '#555'; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#ffffff'; x.font = `bold ${Math.round(r * 1.45)}px ${FONT}`;
      x.fillText(ch, cx - x.measureText(ch).width / 2, cy + r * 0.52);
    });
    if (note) { x.font = `bold 34px ${FONT}`; x.fillText(note, 26, 226); }
  });
}
export function sub38SubwayTex() {
  return canvasTex('sub38s', 512, 100, (x, w, h) => {
    x.fillStyle = '#111214'; x.fillRect(0, 0, w, h);
    x.fillStyle = '#ffffff'; x.font = `bold 64px ${FONT}`; x.textBaseline = 'middle';
    x.fillText('Subway', (w - x.measureText('Subway').width) / 2, h / 2 + 4);
  });
}
