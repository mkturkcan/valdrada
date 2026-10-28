// CP32L — Central Park's land and water (city/centralPark.js part; docs/notes/central-park-land.md). The compiled park was
// one lawn over the ground with no inland water: the Lake, the Reservoir and every pond were lawn. Here:
//   * the water bodies (OpenStreetMap natural=water inside the park, city/cpLandData.js): every ground section is cut out
//     of each one, the last metres of each bank are reshaped so the ground meets the water (the bank narrows where a
//     path runs close, and a steep bank takes the ground shader's schist), the terrain grid under the water is lowered
//     into a bed, and the surfaces are drawn at their 3DEP levels (city/cpRelief.js; a fixed drop under the lawn while
//     the relief is not loaded) with a water shader of their own: the surroundings mirrored from a probe over each body,
//     slow capillary ripples in wind patches (the Reservoir open and choppier, the ponds calm), the water column's own
//     olive-green or brown-green, lit and shadowed by the city's lights, and a shallow edge that shows the bank;
//   * the Reservoir's raised embankment with its stone coping, Conservatory Water's granite coping and promenade, and the
//     small basins' copings.
// `?cp32l=0` turns the part off (the compiled park comes back where this part changed it).
import { HA_ON, haBaseAt, haCpWater } from '../world/haAnchor.js';
import { haGroundCap } from '../world/heightAuthority.js';   // FIX07: the ground under the standing water held under it (P1)   // P1 TERRAIN (`?terrain=p1`): the water bodies at the authority's levels
import * as THREE from 'three';
import earcut from 'earcut';
import { ENV, applyLightTrim, applyStoneDetail, CP32L_GROUND } from '../world/materials.js';
import { CP_DATUM, cpRelief, cpDemToWorld, cpReliefReady } from './cpRelief.js';
import { WATER, WOODS, PITCHES, PARK, ROCKS } from './cpLandData.js';
import { COLLIDERS } from './colliders.js';
import { CPR33, cpRocksInit, cpRocksBuild, cpRocksTop, cpRocksOwns, cpRocksClear } from './cpRocks.js';   // CP33: every outcrop and boulder but Vista Rock
import { CPC33, castleVistaTop, VISTA_ID } from './cpCastle.js';   // CPC33: Vista Rock is the castle part's (city/cpCastle.js); the CP32 hump is off
import { mkConvex, tpSplit } from './tsqPlaza.js';   // the convex clipper (Times Square's plaza, Bryant Park's walks)
import { cpWaterMat, cpwMirrorBody } from './cpWaterMat.js';   // the water shader, shared with Bethesda's pools; MR33's mirror

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const CP32L = !(Q && (Q.get('cp32') === '0' || Q.get('cp32l') === '0'));
if (typeof window !== 'undefined') window.__CP32L_GROUND = CP32L_GROUND;   // harness access (the frame-cost A/B)

// ---------------------------------------------------------------- the water bodies
const unflat = (a) => { const r = []; for (let i = 0; i + 1 < a.length; i += 2) r.push([a[i], a[i + 1]]); return r; };
const BODIES = WATER.map((w) => {
  const outer = unflat(w.outer), holes = w.holes.map(unflat);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of outer) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const wmax = Math.max(0, ...w.bw, ...w.hbw.flat());
  return { ...w, outer, holes, box: [x0, z0, x1, z1], wmax, sdf: null, surf: null, mat: null, probe: null };
});
const BY_KEY = new Map(BODIES.map((b) => [b.k, b]));
// the 3DEP level of each body (NAVD88 m; tools/cp/land_levels.mjs): the mode of the park elevation samples > 10 m inside
export const CP_WATER_DEM = Object.fromEntries(BODIES.filter((b) => b.dem != null).map((b) => [b.k, b.dem]));

const lawnY = (x, z) => CP_DATUM + cpRelief(x, z);
// the surface of body b at (x, z) (world y). Streams run 0.35 m under their banks; the small basins stand 8 cm over
// the paving round them (the coping 0.42 m).
const _lv = { d: 0, w: 0 };
function levelOf(b, x, z) {
  if (b.kind === 'stream') {
    // 0.35 m under its banks; within 25 m of a lake it comes down to the lake's level (and 3 cm under it where the two
    // overlap at the mouth), so it runs into the lake instead of standing over it
    const own = lawnY(x, z) - 0.35;
    let bd = 1e9, bL = 0;
    for (const o of BODIES) {
      if (o.kind !== 'lake' || x < o.box[0] - 30 || x > o.box[2] + 30 || z < o.box[1] - 30 || z > o.box[3] + 30) continue;
      sdfAt(sdfOf(o), x, z, _lv);
      if (_lv.d < 25 && _lv.d < bd) { bd = _lv.d; bL = levelOf(o, x, z); }
    }
    if (bd === 1e9) return own;
    const t = smooth(0, 25, bd);
    return Math.min(own, (bL - 0.03) * (1 - t) + own * t);
  }
  if (b.kind === 'basin') return lawnY(x, z) + 0.08;
  return cpReliefReady() ? (MR_FLAT || HA_ON ? flatLevel(b) : cpDemToWorld(b.dem, x, z)) : CP_DATUM - b.flat;
}
// MR33 (the water worker; the owner's review of teaser 4): a lake is level. cpDemToWorld followed the 3DEP sample under each
// point, so a body's surface wandered with the 14 m grid: the Pond's outline ran from -2.18 to +0.09 m (a wall of water at
// its south-west corner, and the mirror plane taken from a piece's bounding box at -1.05, a metre over the water: the Pond
// was opaque olive under Gapstow), Harlem Meer's over 4.6 m. A body's level (every kind but the streams and the basins) is
// now the median of its outline's levels (the Pond -2.07, the Lake -4.15, Turtle Pond 8.69, the Reservoir 8.89).
// `?cpflat=0` restores the sampled levels.
const MR_FLAT = !(Q && Q.get('cpflat') === '0');
// P1 TERRAIN (`?terrain=p1`): the body's level is the authority's: the 2017 bare earth is hydro-flattened at the water's
// surface, so the median of the ground 3 m and more inside the outline, + 0.28 (the drawn base lies the walk's 0.28 under
// the bare earth). The 3DEP levels sat 2 m over (the Reservoir, Turtle Pond, Harlem Meer, the Pool) or under (the Pond)
// that ground: water floating over its banks or drowned under them. Cached once the authority answers there.
// (P1B second pass: the level computed once with every chunk under the park in, tools/terrain/anchor_levels.mjs into
// anchors.json cpWater; computed here only where that is missing, and then it waits for every chunk under the body)
// (P1B second pass: the water stands 2 cm over the drawn base where that lies on the bare earth's flattened surface, not
// at the walk's level 0.28 m higher: where the 2017 water reached past the OSM shoreline, a bank there is that flattened
// surface, and the walk-level water drowned it by up to 0.3 m; so the drawn ground meets the water on the 2017 waterline. A body the flight caught as no flat water (the Meer's inlet, 11 samples on
// its cascade) is held under its own banks: at most the 10th percentile of the ground 0.5-2 m outside its outline.)
function haLevel(b, compute) {
  if (!compute) { const w = haCpWater(b.k); if (w !== null) return w; }
  if (b.lvlHA !== undefined) return b.lvlHA;
  const v = [], ring = [], st = Math.max(2, Math.min(12, Math.sqrt((b.box[2] - b.box[0]) * (b.box[3] - b.box[1])) / 12));
  let miss = 0;
  for (let x = b.box[0]; x <= b.box[2]; x += st) for (let z = b.box[1]; z <= b.box[3]; z += st) {
    sdfAt(sdfOf(b), x, z, _lv);
    if (_lv.d > -3) continue;
    const g = haBaseAt(x, z);
    if (g === null) miss++; else v.push(g);
  }
  if (miss || !v.length) return null;
  for (let x = b.box[0] - 3; x <= b.box[2] + 3; x += 0.75) for (let z = b.box[1] - 3; z <= b.box[3] + 3; z += 0.75) {
    sdfAt(sdfOf(b), x, z, _lv);
    if (_lv.d < 0.5 || _lv.d > 2) continue;
    const g = haBaseAt(x, z);
    if (g !== null) ring.push(g);
  }
  v.sort((p, q) => p - q);
  ring.sort((p, q) => p - q);
  let lv = v[v.length >> 1];
  if (ring.length >= 8) lv = Math.min(lv, ring[Math.floor(ring.length * 0.1)]);
  return (b.lvlHA = lv + 0.02);
}
function flatLevel(b) {
  if (HA_ON) { const h = haLevel(b); if (h !== null) return h; }
  if (b.lvl !== undefined) return b.lvl;
  const v = [];
  for (const R of [b.outer, ...b.holes]) for (const [x, z] of R) v.push(cpDemToWorld(b.dem, x, z));
  v.sort((p, q) => p - q);
  b.lvl = v.length ? v[v.length >> 1] : cpDemToWorld(b.dem, (b.box[0] + b.box[2]) / 2, (b.box[1] + b.box[3]) / 2);
  return b.lvl;
}
// the cut: how far inside the shoreline the ground sections stop (the bank runs on under the water to there)
const cutOf = (b) => (b.kind === 'lake' ? -1.0 : b.kind === 'stream' ? -0.6 : 0.0);
// ...and at the shoreline itself where another part's masonry stands on the water (HARD below)
const cutAt = (b, x, z) => { const c = cutOf(b); return c === 0 || !HARD.length ? c : c * (1 - hardMask(x, z)); };

// Hard edges (no bank reshaping, no boulders): other parts' masonry on the water. Rotated boxes, world x, z corners.
//   Bethesda Terrace's lake-front wall and landing (city/cpBethesda.js, BETHESDA worker 2026-09-30)
//   the Loeb Boathouse's lakeside wall and landing (city/cpLandmarks.js, LANDMARKS worker): 10 m west to 1 m east of
//   its wall line (184.3, 837.7)-(196.7, 897.2)
const HARD = [
  [[14.81, 945.9], [61.9, 960.16], [63.44, 955.09], [16.35, 940.83]],
  [[174.51, 839.74], [186.91, 899.24], [197.68, 897.0], [185.28, 837.5]],
].map((q) => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of q) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return { q, bb: [x0 - 4, z0 - 4, x1 + 4, z1 + 4] };
});
function hardMask(x, z) {
  let m = 0;
  for (const H of HARD) {
    if (x < H.bb[0] || x > H.bb[2] || z < H.bb[1] || z > H.bb[3]) continue;
    // distance outside the quad (0 inside): max over the edges of the signed distance to each edge line
    let out = -1e9;
    const q = H.q;
    let s = 0;
    for (let i = 0; i < 4; i++) { const a = q[i], c = q[(i + 1) % 4]; s += a[0] * c[1] - c[0] * a[1]; }
    const sg = s >= 0 ? 1 : -1;
    for (let i = 0; i < 4; i++) {
      const a = q[i], c = q[(i + 1) % 4], ex = c[0] - a[0], ez = c[1] - a[1], L = Math.hypot(ex, ez) || 1;
      out = Math.max(out, (-sg * (ex * (z - a[1]) - ez * (x - a[0]))) / L);
    }
    m = Math.max(m, 1 - Math.min(1, Math.max(0, out) / 3));
  }
  return m;
}

// bridges the reflections see (their axis over the water, world x0, z0, x1, z1, from the CSCL/OSM lines under their
// decks, and heights over the water: ends, crown, the arch's soffit at mid-span, on): Bow Bridge (LANDMARKS' deck:
// ends ~1.0-1.4 m, crown 2.75 m over the Lake), Gapstow Bridge (a stone arch, estimated)
// ...and towers on a shore (kind 2: centre x, z, radius, -, -, top over the water, -, 2): Belvedere Castle on Vista Rock
// (its tower ~25 m over Turtle Pond: the rock's ~8 m and the castle's tower)
// the half width of each bridge's vault over the water (the reflection under it is its soffit): Bow Bridge's deck
// (BOW.HALF), Gapstow's barrel (GAP.W2)
const BRIDGE_HALFW = { lake: [2.45, 0], pond: [3.03, 0], turtle: [0, 0] };
const BRIDGE_PROXY = {
  lake: [[-58.4, 799.4, -38.7, 832.4, 1.2, 2.75, 2.1, 1]],
  pond: [[-212.6, 1793.3, -231.1, 1801.4, 2.5, 4.0, 3.0, 1]],
  turtle: [[187, 409, 11, 0, 0, 25, 0, 2]],
};
// Water taken past the OSM shoreline up to other parts' masonry on it (convex quads, world x, z): the strip north of the
// Bethesda lake-front wall (BETHESDA's box), and 3 m west of the Loeb Boathouse's lakeside wall line (LANDMARKS)
// BETHFIX (owner 2026-10-08, "two square corners on the water" at the terrace's lake edge; `?bethfix=0` drops them): the
// Bethesda strip ends at |b| = 24.6 in the terrace's frame (city/cpBethesdaKit.js) and the OSM shore beyond it left a
// flat tongue of bank 0.15 m over the Lake past each end of the wall, square-cornered (west: 1.8 m out, a = 24.4..26.2,
// b = -26.4..-24.6; east: tapering out to a = 28.2 along b = 24.6). Two more quads beside it (meeting it on |b| = 24.6,
// not overlapping, so no two water sheets lie in one plane) take the water from the walls' corners (a = 24.3, |b| = 24.75)
// on a diagonal to the OSM shore (east (30.6, 26.8), west (27.6, -26.7)), so the bank leaves the corner instead of
// standing out past the wall.
const BETHFIX = !(Q && Q.get('bethfix') === '0');
const WATER_EXT = [
  { k: 'lake', q: [[14.81, 945.9], [61.9, 960.16], [63.44, 955.09], [16.35, 940.83]] },
  { k: 'lake', q: [[184.3, 837.7], [196.7, 897.2], [193.76, 897.8], [181.36, 838.3]] },
  ...(BETHFIX ? [
    { k: 'lake', q: [[61.9, 960.16], [62.04, 960.2], [65.83, 954.77], [63.73, 954.13]] },
    { k: 'lake', q: [[14.81, 945.9], [14.67, 945.86], [13.76, 942.13], [15.77, 942.74]] },
  ] : []),
].map((X) => ({ ...X, C: mkConvex(X.q) }));
// reflection probes placed by hand (world x, z over the water): the Lake's 30 m north of Bow Bridge's crown
const PROBE_AT = { lake: [-60, 772] };
// ---------------------------------------------------------------- signed distance fields
// Per body a grid over its box (+ margin): D (m, negative inside the water; exact within SDF_R of a shore, clamped past
// it) and W (the bank width at the nearest shore point). Built lazily, once, from the baked rings.
const SDF_R = 24;
function sdfOf(b) {
  if (b.sdf) return b.sdf;
  const small = b.kind === 'basin' || b.kind === 'stream' || Math.max(b.box[2] - b.box[0], b.box[3] - b.box[1]) < 90;
  const step = small ? 0.5 : 1.0, pad = SDF_R + 2;
  const x0 = b.box[0] - pad, z0 = b.box[1] - pad;
  const nx = Math.ceil((b.box[2] - b.box[0] + 2 * pad) / step) + 1, nz = Math.ceil((b.box[3] - b.box[1] + 2 * pad) / step) + 1;
  const D = new Float32Array(nx * nz).fill(SDF_R), W = new Float32Array(nx * nz);
  const rings = [[b.outer, b.bw], ...b.holes.map((h, i) => [h, b.hbw[i] || []])];
  for (const [R, bw] of rings) {
    for (let i = 0; i < R.length; i++) {
      const p = R[i], q = R[(i + 1) % R.length], wp = bw[i] ?? 0, wq = bw[(i + 1) % R.length] ?? 0;
      const ex = q[0] - p[0], ez = q[1] - p[1], LL = ex * ex + ez * ez;
      const i0 = Math.max(0, Math.floor((Math.min(p[0], q[0]) - SDF_R - x0) / step)), i1 = Math.min(nx - 1, Math.ceil((Math.max(p[0], q[0]) + SDF_R - x0) / step));
      const j0 = Math.max(0, Math.floor((Math.min(p[1], q[1]) - SDF_R - z0) / step)), j1 = Math.min(nz - 1, Math.ceil((Math.max(p[1], q[1]) + SDF_R - z0) / step));
      for (let j = j0; j <= j1; j++) {
        const z = z0 + j * step;
        for (let ii = i0; ii <= i1; ii++) {
          const x = x0 + ii * step;
          let t = LL > 0 ? ((x - p[0]) * ex + (z - p[1]) * ez) / LL : 0;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
          const dx = x - p[0] - ex * t, dz = z - p[1] - ez * t, d = Math.sqrt(dx * dx + dz * dz);
          const k = j * nx + ii;
          if (d < D[k]) { D[k] = d; W[k] = wp + (wq - wp) * t; }
        }
      }
    }
  }
  // inside: scanline crossings of every ring (even-odd, so the islands come out dry)
  const xs = [];
  for (let j = 0; j < nz; j++) {
    const z = z0 + j * step;
    xs.length = 0;
    for (const [R] of rings) {
      for (let i = 0, k = R.length - 1; i < R.length; k = i++) {
        const a = R[k], c = R[i];
        if ((a[1] > z) !== (c[1] > z)) xs.push(a[0] + ((z - a[1]) * (c[0] - a[0])) / (c[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const ia = Math.max(0, Math.ceil((xs[m] - x0) / step)), ib = Math.min(nx - 1, Math.floor((xs[m + 1] - x0) / step));
      for (let ii = ia; ii <= ib; ii++) D[j * nx + ii] = -D[j * nx + ii];
    }
  }
  // where the reflection probe stands: the middle of the deepest water (the centroid of the cells as far from every
  // shore as the field measures, then the deep cell nearest it), or a set point (PROBE_AT: the Lake's by Bow Bridge,
  // whose reflection the teaser's glide looks for)
  let best = 0;
  for (let k = 0; k < D.length; k++) if (D[k] < best) best = D[k];
  let sx = 0, sz = 0, sn = 0;
  for (let k = 0; k < D.length; k++) if (D[k] <= best + 0.5) { sx += x0 + (k % nx) * step; sz += z0 + Math.floor(k / nx) * step; sn++; }
  let cx = sn ? sx / sn : (b.box[0] + b.box[2]) / 2, cz = sn ? sz / sn : (b.box[1] + b.box[3]) / 2;
  if (PROBE_AT[b.k]) [cx, cz] = PROBE_AT[b.k];
  {
    let bd = 1e18, bx = cx, bz = cz;
    for (let k = 0; k < D.length; k++) {
      if (D[k] > Math.min(-4, best + 0.5) && !PROBE_AT[b.k]) continue;
      if (D[k] > -4) continue;
      const x = x0 + (k % nx) * step, z = z0 + Math.floor(k / nx) * step, d = (x - cx) ** 2 + (z - cz) ** 2;
      if (d < bd) { bd = d; bx = x; bz = z; }
    }
    cx = bx; cz = bz;
  }
  b.sdf = { x0, z0, step, nx, nz, D, W, cx, cz, deep: -best };
  return b.sdf;
}
// bilinear signed distance (m) and bank width at (x, z); +SDF_R off the grid
function sdfAt(S, x, z, out) {
  const fx = (x - S.x0) / S.step, fz = (z - S.z0) / S.step;
  if (fx < 0 || fz < 0 || fx >= S.nx - 1 || fz >= S.nz - 1) { out.d = SDF_R; out.w = 0; return out; }
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, k = j * S.nx + i, D = S.D, W = S.W;
  out.d = D[k] * (1 - u) * (1 - v) + D[k + 1] * u * (1 - v) + D[k + S.nx] * (1 - u) * v + D[k + S.nx + 1] * u * v;
  out.w = W[u < 0.5 ? (v < 0.5 ? k : k + S.nx) : (v < 0.5 ? k + 1 : k + S.nx + 1)];
  return out;
}
const _f = { d: 0, w: 0 };
// the nearest body at (x, z) among `bodies` (the one whose water the point is deepest in, or nearest to)
function fieldAt(bodies, x, z, out) {
  out.d = SDF_R; out.w = 0; out.b = null;
  for (const b of bodies) {
    if (x < b.box[0] - SDF_R || x > b.box[2] + SDF_R || z < b.box[1] - SDF_R || z > b.box[3] + SDF_R) continue;
    sdfAt(b.sdf, x, z, _f);
    if (_f.d < out.d) { out.d = _f.d; out.w = _f.w; out.b = b; }
  }
  return out;
}

// is (x, z) on the water (pad m inside the shore)? The water surface y there, or null. For the walkers, the bridges,
// the boats and the furniture (other parts: `land.cpWaterY?.(x, z)`).
const _q = { d: 0, w: 0, b: null };
export function cpWaterY(x, z, pad = 0) {
  if (!CP32L) return null;
  for (const X of WATER_EXT) {
    const C = X.C;
    if (x < C.bb[0] || x > C.bb[2] || z < C.bb[1] || z > C.bb[3]) continue;
    let inside = true;
    for (let i = 0; i < C.q.length && inside; i++) { const a = C.q[i], c = C.q[(i + 1) % C.q.length]; if (C.s * ((c[0] - a[0]) * (z - a[1]) - (c[1] - a[1]) * (x - a[0])) < 0) inside = false; }
    if (inside) { const b = BY_KEY.get(X.k); if (b) return levelOf(b, x, z); }
  }
  for (const b of BODIES) {
    if (x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) continue;
    sdfAt(sdfOf(b), x, z, _q);
    if (_q.d < -pad) return levelOf(b, x, z);
  }
  return null;
}
export const cpOnWater = (x, z, pad = 0) => cpWaterY(x, z, pad) !== null;
// within m of a coped basin's shore, or in it (the esplanade: no trunk, no lamp, no shrub; CP33 LANDSCAPE)
export function cpNearCoped(x, z, m = CW_ESP + 1) {
  if (!CP32L || !CPCW) return false;
  for (const b of BODIES) {
    if (b.kind !== 'coped' || x < b.box[0] - m || x > b.box[2] + m || z < b.box[1] - m || z > b.box[3] + m) continue;
    sdfAt(sdfOf(b), x, z, _q);
    if (_q.d < m) return true;
  }
  return false;
}
// the surface of body `key` at any (x, z) (for abutments, landings, the Bethesda lake front)
export function cpWaterLevelY(key, x, z) {
  const b = BY_KEY.get(key);
  return b ? levelOf(b, x, z) : null;
}
export const cpHaLevel = (key, compute) => { const b = BY_KEY.get(key); return b ? haLevel(b, compute) : null; };   // (tools/terrain/anchor_levels.mjs)
export const cpWaterBodies = () => BODIES.map((b) => ({ k: b.k, name: b.name, kind: b.kind, dem: b.dem, box: b.box }));
// a body's deepest point (the farthest from every shore; its reflection probe stands over it) and that distance
export const cpWaterInfo = (key) => { const b = BY_KEY.get(key); if (!b) return null; const S = sdfOf(b); return { x: S.cx, z: S.cz, deep: S.deep }; };

// ---------------------------------------------------------------- the ground cover (the ground shader's mask)
// One RGBA8 texture over the park's box, 2 m texels (world/materials.js CP32L_GROUND): R the woodland floor (OSM
// natural=wood), G the ballfields' clay infields (leisure=pitch, baseball on dirt or sand), B the tennis centre's green
// clay (tennis on clay), A the wet bank (1 in the water, falling to 0 4 m out: a chamfer distance over the texels).
// Baked once, on the first park tile.
const MASK_CELL = 2;
let _mask = null;
function fillPoly(data, W, H, x0, z0, rings, ch, val) {
  let zmin = 1e9, zmax = -1e9;
  for (const R of rings) for (let i = 1; i < R.length; i += 2) { zmin = Math.min(zmin, R[i]); zmax = Math.max(zmax, R[i]); }
  const j0 = Math.max(0, Math.floor((zmin - z0) / MASK_CELL - 0.5)), j1 = Math.min(H - 1, Math.ceil((zmax - z0) / MASK_CELL - 0.5));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const z = z0 + (j + 0.5) * MASK_CELL;
    xs.length = 0;
    for (const R of rings) {
      const n = R.length / 2;
      for (let i = 0, k = n - 1; i < n; k = i++) {
        const az = R[k * 2 + 1], cz = R[i * 2 + 1];
        if ((az > z) !== (cz > z)) { const ax = R[k * 2], cx = R[i * 2]; xs.push(ax + ((z - az) * (cx - ax)) / (cz - az)); }
      }
    }
    xs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const ia = Math.max(0, Math.ceil((xs[m] - x0) / MASK_CELL - 0.5)), ib = Math.min(W - 1, Math.floor((xs[m + 1] - x0) / MASK_CELL - 0.5));
      for (let i = ia; i <= ib; i++) { const o = (j * W + i) * 4 + ch; if (data[o] < val) data[o] = val; }
    }
  }
}
function groundMask() {
  if (_mask) return _mask;
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let i = 0; i < PARK.length; i += 2) { x0 = Math.min(x0, PARK[i]); x1 = Math.max(x1, PARK[i]); z0 = Math.min(z0, PARK[i + 1]); z1 = Math.max(z1, PARK[i + 1]); }
  x0 -= 20; z0 -= 20; x1 += 20; z1 += 20;
  const W = Math.ceil((x1 - x0) / MASK_CELL), H = Math.ceil((z1 - z0) / MASK_CELL);
  const data = new Uint8Array(W * H * 4);
  for (const w of WOODS) fillPoly(data, W, H, x0, z0, [w.outer, ...w.holes], 0, 255);
  for (const p of PITCHES) {
    if (/baseball|softball/.test(p.sport) && /dirt|sand|clay/.test(p.surface)) fillPoly(data, W, H, x0, z0, [p.outer, ...p.holes], 1, 255);
    else if (p.sport === 'tennis' && p.surface === 'clay') fillPoly(data, W, H, x0, z0, [p.outer, ...p.holes], 2, 255);
  }
  // OSM draws the woods with the paths through them left out: close those gaps (a 3-texel max, then a 3-texel min: gaps
  // up to 12 m), so the strips beside the Ramble's paths are woodland floor too, not lawn
  {
    const R0 = new Uint8Array(W * H), R1 = new Uint8Array(W * H);
    for (let k = 0; k < W * H; k++) R0[k] = data[k * 4];
    const pass = (src, dst, r, mx, horiz) => {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let v = mx ? 0 : 255;
        for (let o = -r; o <= r; o++) {
          const ii = horiz ? i + o : i, jj = horiz ? j : j + o;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const u = src[jj * W + ii];
          v = mx ? Math.max(v, u) : Math.min(v, u);
        }
        dst[j * W + i] = v;
      }
    };
    pass(R0, R1, 3, true, true); pass(R1, R0, 3, true, false);
    pass(R0, R1, 3, false, true); pass(R1, R0, 3, false, false);   // a closing: the outer edges stay where OSM has them
    for (let k = 0; k < W * H; k++) data[k * 4] = R0[k];
  }
  // the ballfields and courts are not woods (an OSM wood polygon drawn over a field's edge)
  for (let k = 0; k < W * H; k++) if (data[k * 4 + 1] || data[k * 4 + 2]) data[k * 4] = 0;
  // the water, then the chamfer distance out of it (texels; 1 orthogonal, 1.414 diagonal), A = 1 - d / 4 m
  const D = new Float32Array(W * H).fill(1e9);
  const wet = new Uint8Array(W * H * 4);
  for (const b of WATER) fillPoly(wet, W, H, x0, z0, [b.outer, ...b.holes], 0, 255);
  for (let k = 0; k < W * H; k++) if (wet[k * 4]) D[k] = 0;
  const S2 = Math.SQRT2;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let d = D[k];
    if (i > 0) d = Math.min(d, D[k - 1] + 1);
    if (j > 0) { d = Math.min(d, D[k - W] + 1); if (i > 0) d = Math.min(d, D[k - W - 1] + S2); if (i < W - 1) d = Math.min(d, D[k - W + 1] + S2); }
    D[k] = d;
  }
  for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
    const k = j * W + i;
    let d = D[k];
    if (i < W - 1) d = Math.min(d, D[k + 1] + 1);
    if (j < H - 1) { d = Math.min(d, D[k + W] + 1); if (i < W - 1) d = Math.min(d, D[k + W + 1] + S2); if (i > 0) d = Math.min(d, D[k + W - 1] + S2); }
    D[k] = d;
  }
  // (CPB33: the wet band over 1.4 m, was 2.4: "grass down to a thin dark mud line")
  for (let k = 0; k < W * H; k++) data[k * 4 + 3] = Math.max(0, Math.round(255 * (1 - (D[k] * MASK_CELL) / (CPBANK ? 1.4 : 2.4))));
  // (CPB33: the woodland floor stops short of the water: the Conservancy's shores are planted to the water, so from the
  // air the woods' brown litter read as a brown rim round the Lake's Ramble shore; it fades in from 1.5 to 4.5 m out)
  if (CPBANK) for (let k = 0; k < W * H; k++) { const m = Math.min(1, Math.max(0, (D[k] * MASK_CELL - 1.5) / 3)); data[k * 4] = Math.round(data[k * 4] * m); }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  _mask = { tex, x0, z0, W, H };
  CP32L_GROUND.mask.value = tex;
  CP32L_GROUND.rect.value.set(x0, z0, 1 / (W * MASK_CELL), 1 / (H * MASK_CELL));
  CP32L_GROUND.on.value = 1;
  return _mask;
}

// ---------------------------------------------------------------- the ground (apply)
// Everything the tile draws as ground (world/assemble.js's section list)
const SECTIONS = ['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'grass', 'path', 'paintG', 'brick', 'gutter', 'busred', 'warn', 'warnIron', 'grassU', 'plaza', 'gravel'];
const CELL = 2.5, COARSE = 7.5;   // the global lattices the bank's ground is cut to: both triangles of a shared edge split it alike
const smooth = (a, b, t) => { const u = Math.min(1, Math.max(0, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
// CPB33 (owner review of teaser 4, 2026-09-30: "every water body has a brown or purple smeared band round its edge"):
// the natural bank fell from the relief's lawn to the water over its width w (the distance to the nearest path),
// steepest at the water (2 x the drop over w), so a 1-3 m drop over 1-4 m made 40-70 deg faces, and the ground shader
// turns grass steeper than 35 deg into schist: a smooth brown-grey band round the Lake, the Pond, Turtle Pond and the
// Meer, stretched over a few long triangles, and its reflection. Real banks there are lawn down to a thin dark mud line
// at the water (the photographs), with schist and shrubs in places. Now the lawn at a lake's shore stands a few
// centimetres over the water and rises from it at no more than BANK_TAN (23 deg) until it meets the relief's lawn,
// out to BANK_REACH past the waterline; the wet mask gives the mud line. `?cpbank=0` restores the old profile.
const CPBANK = !(Q && Q.get('cpbank') === '0');
// CP33 LANDSCAPE (review of teaser 4 v2: "Conservatory Water is a deep dark crater, its coping a sawtooth ring of disjoint pale
// wedges, the water well below the lawn, trees right up to it. The real model-boat pond is a shallow formal basin with its water
// a few inches under a continuous granite coping set flush in a paved esplanade"): the coping runs level at 0.30 m over the
// water's mean level all the way round, the ground within CW_ESP of the shore is laid flush with it (the paving) and falls back
// to the relief over the next CW_BLEND m, the lawn within CW_ESP becomes flagstone, no tree stands within CW_ESP + 1.
// `?cpcw=0` restores the CP32 coping.
const CPCW = !(Q && Q.get('cpcw') === '0');
const CW_ESP = 7, CW_BLEND = 7, CW_TOP = 0.30;
const _copeTop = new Map();
function copeTop(b) {
  let v = _copeTop.get(b.k);
  if (v === undefined) {
    let m = 0;
    for (const [x, z] of b.outer) m += levelOf(b, x, z);
    v = m / b.outer.length + CW_TOP;
    _copeTop.set(b.k, v);
  }
  return v;
}
const BANK_TAN = 0.42, BANK_REACH = 9;
const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - (h * h * k) / 4; };
// the bank's reach past the shoreline (where the offset below falls to 0)
function reachOf(b, w) {
  if (b.kind === 'reservoir') return cpReliefReady() ? 20 : 0.5;
  if (b.kind === 'lake') return CPBANK ? Math.max(w, BANK_REACH) : w;
  if (b.kind === 'stream') return w;
  if (b.kind === 'coped') return CPCW ? CW_ESP + CW_BLEND : 5.5;   // the promenade round Conservatory Water
  return 0;
}
// The offset added to every ground section at (x, z) (so a path keeps its lift over the lawn), for the point at signed
// distance d from body b's shore with bank width w.
//   natural banks: the lawn falls to the water over w (steepest at the water, 1 - (1 - t)^2), meets the surface 0.3 m
//   inside the OSM shoreline and runs on under it at 0.9 m per m to the cut; a bank the relief leaves under the water
//   is lifted to at least 0.2 m over it at the shore.
//   the Reservoir: its embankment, the track 1.25 m over the water out to 7 m, the outer slope 1 in 3 (raise only).
function bankOffset(b, x, z, d, w) {
  if (CPCW && b.kind === 'coped') {
    // d < 0: inside the water (the sections are cut there); outside, the paving at the coping's level (2 cm under it)
    const e = 1 - smooth(CW_ESP, CW_ESP + CW_BLEND, Math.max(0, d));
    return (copeTop(b) - 0.02 - lawnY(x, z)) * e;
  }
  if (b.kind === 'coped' || b.kind === 'basin') return 0;
  const G = lawnY(x, z), L = levelOf(b, x, z);
  const hm = HARD.length ? hardMask(x, z) : 0;
  if (hm >= 1) return 0;
  let off;
  if (b.kind === 'reservoir') {
    if (HA_ON) return 0;   // (P1B: the 2017 bare earth has the real embankment and its track: nothing raised over them)
    if (d < -0.5) return 0;   // (past the cut; the vertices on it, at d = 0, take the full lift)
    const top = L + 1.25, emb = d <= 7 ? top : top - (d - 7) / 3;
    off = Math.max(0, emb - G);
  } else if (CPBANK && b.kind === 'lake') {
    const u = d + 0.3;                                   // metres from the waterline (0.3 m inside the OSM shore)
    const R = Math.max(w, BANK_REACH);
    if (u >= R) return 0;
    let Gp;
    if (u >= 0) {
      // the lawn the bank meets: the relief, lifted to 0.2 m over the water where the relief leaves it under it
      // (P1B: and in the first 1.5 m from the water whatever the bank's width: a path at the water's edge stands over it)
      const Gc = G + Math.max(0, L + 0.2 - G) * Math.max(1 - smooth(0.7, 1, u / (w + 0.3)), HA_ON ? 1 - smooth(1.5, 3, u) : 0);
      // a wet lip 6 cm over the water, then the lawn rising at BANK_TAN until it meets Gc (no crease where they meet),
      // eased back to the relief over the reach's last 2 m (a drop steeper than that, a rocky bank, stays steep there)
      Gp = smin(Gc, L + 0.06 + BANK_TAN * u, 0.6);
      Gp += (Gc - Gp) * smooth(R - 2, R, u);
    } else Gp = L + u * 0.9;
    off = Gp - G;
    if (HA_ON && u >= 0) off = Math.max(0, off);   // (P1B: on the bare earth the real bank stands: raised where it is under the water's lip, never cut down)
  } else {
    const t = (d + 0.3) / (w + 0.3);
    if (t >= 1) return 0;
    let Gp;
    if (t >= 0) {
      const s = 1 - (1 - t) * (1 - t);
      const Gc = G + Math.max(0, L + 0.2 - G) * (1 - smooth(0.7, 1, t));
      Gp = L + (Gc - L) * s;
    } else Gp = L + (d + 0.3) * 0.9;
    off = Gp - G;
  }
  return off * (1 - hm);
}
// split a convex polygon (vertices [x, y, z]) by the line p[axis] = v: [below, above] (either may be null)
function splitPoly(P, axis, v) {
  const lo = [], hi = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length], sa = a[axis] - v, sc = c[axis] - v;
    if (sa <= 0) lo.push(a);
    if (sa >= 0) hi.push(a);
    if ((sa < 0 && sc > 0) || (sa > 0 && sc < 0)) {
      const t = sa / (sa - sc);
      const m = [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
      m[axis] = v;
      lo.push(m); hi.push(m);
    }
  }
  return [lo.length >= 3 ? lo : null, hi.length >= 3 ? hi : null];
}
// a convex polygon cut to the global lattice of `cell` m: convex pieces
function lattice(P, cell) {
  let x0 = 1e9, x1 = -1e9;
  for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
  const strips = [];
  let rest = P;
  for (let k = Math.floor(x0 / cell) + 1; k * cell < x1 && rest; k++) {
    const [lo, hi] = splitPoly(rest, 0, k * cell);
    if (lo) strips.push(lo);
    rest = hi;
  }
  if (rest) strips.push(rest);
  const out = [];
  for (const st of strips) {
    let r = st, z0 = 1e9, z1 = -1e9;
    for (const p of st) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    for (let k = Math.floor(z0 / cell) + 1; k * cell < z1 && r; k++) {
      const [lo, hi] = splitPoly(r, 2, k * cell);
      if (lo) out.push(lo);
      r = hi;
    }
    if (r) out.push(r);
  }
  return out;
}

let _applied = 0, _maskQueued = false;
// FIX07 (2026-10-27, the Reservoir's pale green patches): on the P1 terrain the park's bare base is raised to the
// relief's lawn less 4 cm (centralPark.js sinkBaseP1), and the relief inside a body is the bare earth's hydro-flattened
// surface, up to 0.2 m over the drawn water: lawn-kinded base triangles floated on the Reservoir. By rule, for every
// standing body (lake, reservoir, coped and basin; a stream runs under paths and keeps its own banks): ground more than
// BED_PAD inside its shore never stands higher than BED_DROP under its water (heightAuthority.js haGroundCap, applied
// last in the clamp). `?cpbed=0` turns it off.
const CPBED = !(Q && Q.get('cpbed') === '0');
const BED_PAD = 0.5, BED_DROP = 0.3;
let _bedCap = false;
const _bq = { d: 0, w: 0, b: null };
function bedCap(x, z) {
  for (const b of BODIES) {
    if (b.kind === 'stream' || x < b.box[0] || x > b.box[2] || z < b.box[1] || z > b.box[3]) continue;
    sdfAt(sdfOf(b), x, z, _bq);
    if (_bq.d < -BED_PAD) { const y = levelOf(b, x, z); return isFinite(y) ? y - BED_DROP : null; }
  }
  return null;
}
export function apply(tile, ox, oz) {
  if (!CP32L) return;
  if (!_bedCap && CPBED && HA_ON) { _bedCap = true; haGroundCap(bedCap); }
  // the ground-cover mask (~0.3 s) is baked off the tile's own time, once; the shader takes it when it lands
  if (!_maskQueued) {
    _maskQueued = true;
    const run = () => { try { const t = typeof performance !== 'undefined' ? performance.now() : 0; groundMask(); if (t) console.log(`[cp32l] ground-cover mask ${_mask.W}x${_mask.H} in ${(performance.now() - t).toFixed(0)} ms`); } catch (e) { console.warn('[cp32l] ground mask', e); } };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 1500 }); else if (typeof setTimeout === 'function') setTimeout(run, 0); else run();
  }
  const near = BODIES.filter((b) => b.box[0] - SDF_R < ox + 512 && b.box[2] + SDF_R > ox && b.box[1] - SDF_R < oz + 512 && b.box[3] + SDF_R > oz);
  if (!near.length) return;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  for (const b of near) sdfOf(b);
  const F = { d: 0, w: 0, b: null };
  const promenade = [];   // Conservatory Water's paved walk, re-kinded from its lawn
  let nIn = 0, nOut = 0, nCut = 0;
  // one vertex: world [x, yRel, z] -> { x, y (reshaped), z, c (distance past the cut, m) }
  // a stream runs under the paths and drives that cross it (culverts, the Loch's arches): only the lawn is cut and
  // reshaped for a stream
  let soft = true;
  const vtx = (p) => {
    fieldAt(near, p[0], p[2], F);
    if (!F.b || (!soft && F.b.kind === 'stream')) return { x: p[0], y: p[1], yr: p[1], z: p[2], c: 1e9, d: SDF_R, b: null };
    const off = bankOffset(F.b, p[0], p[2], F.d, F.w);
    return { x: p[0], y: p[1] + off, yr: p[1], z: p[2], c: F.d - cutAt(F.b, p[0], p[2]), d: F.d, b: F.b };
  };
  // how a convex piece stands to the water: 0 clear of every bank (kept as it is), 1 in a bank, 2 past the cut. Its
  // edges are sampled every 3 m; slack covers the inside (the inradius) and the gaps between the samples.
  const classify = (P) => {
    let per = 0, ar2 = 0;
    for (let k = 0; k < P.length; k++) {
      const p = P[k], q = P[(k + 1) % P.length];
      per += Math.hypot(q[0] - p[0], q[2] - p[2]);
      ar2 += p[0] * q[2] - q[0] * p[2];
    }
    const slack = Math.abs(ar2) / Math.max(per, 1e-6) + 1.6;
    let clear = 1e9, past = -1e9;
    for (let k = 0; k < P.length; k++) {
      const p = P[k], q = P[(k + 1) % P.length];
      const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[2] - p[2]) / 3));
      for (let m = 0; m < n; m++) {
        const x = p[0] + ((q[0] - p[0]) * m) / n, z = p[2] + ((q[2] - p[2]) * m) / n;
        fieldAt(near, x, z, F);
        if (!F.b || (!soft && F.b.kind === 'stream')) continue;
        clear = Math.min(clear, F.d - reachOf(F.b, F.w));
        past = Math.max(past, F.d - cutAt(F.b, x, z));
      }
    }
    if (clear === 1e9 || clear > slack) return 0;
    if (past < -slack) return 2;
    return 1;
  };
  // the offset over a piece (its corners, edge middles and centre): all under 2 mm, and nothing past the cut
  const flatOffset = (P) => {
    let cx = 0, cz = 0;
    const pts = [];
    for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length]; pts.push([p[0], p[2]], [(p[0] + q[0]) / 2, (p[2] + q[2]) / 2]); cx += p[0]; cz += p[2]; }
    pts.push([cx / P.length, cz / P.length]);
    for (const [x, z] of pts) {
      fieldAt(near, x, z, F);
      if (!F.b) continue;
      if (F.d - cutOf(F.b) < 0.3) return false;
      if (Math.abs(bankOffset(F.b, x, z, F.d, F.w)) > 0.002) return false;
    }
    return true;
  };
  const crossesCut = () => false;
  const extent = (P) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of P) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); } return Math.max(x1 - x0, z1 - z0); };
  for (const name of SECTIONS) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    soft = name === 'grass' || name === 'grassU';
    const out = [];
    let changed = false;
    const push = (P) => { for (const p of P) out.push(p.x - ox, p.y, p.z - oz); };
    const pushRaw = (P) => { for (let k = 1; k + 1 < P.length; k++) for (const p of [P[0], P[k], P[k + 1]]) out.push(p[0] - ox, p[1], p[2] - oz); };
    // a piece in a bank: every vertex reshaped, and the part past the cut dropped (marching triangles on the fan)
    const fine = (Q) => {
      const V = Q.map(vtx);
      for (let k = 1; k + 1 < V.length; k++) {
        const T = [V[0], V[k], V[k + 1]];
        const inn = (T[0].c >= 0) + (T[1].c >= 0) + (T[2].c >= 0);
        if (inn === 0) continue;
        let polys;
        if (inn === 3) polys = [T];
        else {
          const Pg = [];
          for (let m = 0; m < 3; m++) {
            const u = T[m], v = T[(m + 1) % 3];
            if (u.c >= 0) Pg.push(u);
            if ((u.c >= 0) !== (v.c >= 0)) {
              const t = u.c / (u.c - v.c);
              Pg.push(vtx([u.x + (v.x - u.x) * t, u.yr + (v.yr - u.yr) * t, u.z + (v.z - u.z) * t]));
            }
          }
          polys = [];
          for (let m = 1; m + 1 < Pg.length; m++) polys.push([Pg[0], Pg[m], Pg[m + 1]]);
        }
        for (const pg of polys) {
          // Conservatory Water's walk: its lawn within 5.5 m of the coping becomes the city's flagstone
          if (name === 'grass' && pg[0].b && pg[0].b.kind === 'coped') {
            if (!CPCW) {
              if ((pg[0].d + pg[1].d + pg[2].d) / 3 < 5.5) { for (const p of pg) promenade.push(p.x - ox, p.y + 0.008, p.z - oz); continue; }
            } else {
              // CP33 LANDSCAPE: the esplanade's edge is cut where the distance to the shore is CW_ESP (a marching split of the
              // piece), not by whole pieces: the 2 m lattice's staircase read as a sawtooth ring round the coping
              const ins = [], rest = [];
              for (let m = 0; m < 3; m++) {
                const u = pg[m], v = pg[(m + 1) % 3], ui = u.d < CW_ESP, vi = v.d < CW_ESP;
                (ui ? ins : rest).push(u);
                if (ui !== vi) {
                  const t = (CW_ESP - u.d) / (v.d - u.d);
                  const w = { x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t, yr: u.yr + (v.yr - u.yr) * t, z: u.z + (v.z - u.z) * t, c: u.c + (v.c - u.c) * t, d: CW_ESP, b: u.b };
                  ins.push(w); rest.push(w);
                }
              }
              for (let m = 1; m + 1 < ins.length; m++) for (const p of [ins[0], ins[m], ins[m + 1]]) promenade.push(p.x - ox, p.y + 0.008, p.z - oz);
              for (let m = 1; m + 1 < rest.length; m++) push([rest[0], rest[m], rest[m + 1]]);
              continue;
            }
          }
          push(pg);
        }
      }
    };
    // coarse (6 m lattice) first, so only the pieces in a bank are cut to the fine one (2 m)
    const piece = (P, coarse) => {
      const cls = classify(P);
      if (cls === 0) { pushRaw(P); return; }
      if (cls === 2) { nCut++; return; }
      if (coarse && extent(P) > COARSE) { for (const Q of lattice(P, COARSE)) piece(Q, false); return; }
      // a piece the bank leaves where it is (its outer reach, where the offset has faded out) stays whole
      if (!crossesCut(P) && flatOffset(P)) { pushRaw(P); return; }
      nIn++;
      for (const Q of lattice(P, CELL)) fine(Q);
    };
    for (let i = 0; i + 8 < a.length; i += 9) {
      const A = [a[i] + ox, a[i + 1], a[i + 2] + oz], B = [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], C = [a[i + 6] + ox, a[i + 7], a[i + 8] + oz];
      const bx0 = Math.min(A[0], B[0], C[0]), bx1 = Math.max(A[0], B[0], C[0]), bz0 = Math.min(A[2], B[2], C[2]), bz1 = Math.max(A[2], B[2], C[2]);
      let hit = false;
      for (const b of near) if (bx1 > b.box[0] - SDF_R && bx0 < b.box[2] + SDF_R && bz1 > b.box[1] - SDF_R && bz0 < b.box[3] + SDF_R) { hit = true; break; }
      if (!hit) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      const ar2 = Math.abs((B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]));
      if (ar2 < 0.02) {
        // a kerb face (vertical): moved with the ground round it, dropped whole if any of it is past the cut
        const V = [A, B, C].map(vtx);
        if (V[0].c < 0 || V[1].c < 0 || V[2].c < 0) { changed = true; nCut++; continue; }
        if (V.some((v) => v.y !== v.yr)) changed = true;
        push(V);
        continue;
      }
      const cls = classify([A, B, C]);
      if (cls === 0) { for (let k = 0; k < 9; k++) out.push(a[i + k]); nOut++; continue; }
      changed = true;
      if (cls === 2) { nCut++; continue; }
      piece([A, B, C], true);
    }
    if (changed) tile.S[name] = Float32Array.from(out);
  }
  if (promenade.length) tile.S.sidewalk = tile.S.sidewalk && tile.S.sidewalk.length ? Float32Array.from([...tile.S.sidewalk, ...promenade]) : Float32Array.from(promenade);
  // the water taken up to other parts' masonry: the ground inside each extension goes (it lay 0.75-4.5 m wide between
  // the OSM shoreline and the Bethesda wall, 1.5-2.3 m at the Boathouse)
  for (const X of WATER_EXT) {
    const C = X.C;
    if (C.bb[2] < ox || C.bb[0] > ox + 512 || C.bb[3] < oz || C.bb[1] > oz + 512) continue;
    const R = { ped: [C], car: [] };
    for (const name of SECTIONS) {
      const a = tile.S[name];
      if (!a || a.length < 9) continue;
      const out = [];
      let changed = false;
      for (let i = 0; i + 8 < a.length; i += 9) {
        const A = [a[i] + ox, a[i + 1], a[i + 2] + oz], B = [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], D = [a[i + 6] + ox, a[i + 7], a[i + 8] + oz];
        if (Math.max(A[0], B[0], D[0]) < C.bb[0] || Math.min(A[0], B[0], D[0]) > C.bb[2] || Math.max(A[2], B[2], D[2]) < C.bb[1] || Math.min(A[2], B[2], D[2]) > C.bb[3]) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
        const Sp = tpSplit([A, B, D], R);
        if (!Sp.plaza.length) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
        changed = true;
        for (const P of Sp.road) for (let k = 1; k + 1 < P.length; k++) for (const p of [P[0], P[k], P[k + 1]]) out.push(p[0] - ox, p[1], p[2] - oz);
      }
      if (changed) tile.S[name] = Float32Array.from(out);
    }
    const Tg = tile.S.terrain, rs = tile.header.res, nn = rs + 1, cw2 = 512 / rs, b = BY_KEY.get(X.k);
    if (Tg && Tg.length === nn * nn && b) for (let j = 0; j < nn; j++) for (let i = 0; i < nn; i++) {
      const x = ox + i * cw2, z = oz + j * cw2;
      if (x < C.bb[0] - 16 || x > C.bb[2] + 16 || z < C.bb[1] - 16 || z > C.bb[3] + 16) continue;
      const bed = levelOf(b, x, z) - 0.8;
      if (bed < Tg[j * nn + i]) Tg[j * nn + i] = bed;
    }
  }
  // the terrain grid: a bed under the water, and every node near a shore under the surface (the grid is drawn wherever
  // no section covers it, so a node left at the lawn's datum would poke through the water between the cut and the bed)
  const T = tile.S.terrain, res = tile.header.res, n = res + 1, cw = 512 / res;
  if (T && T.length === n * n) {
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ox + i * cw, z = oz + j * cw;
      fieldAt(near, x, z, F);
      if (!F.b || F.d > 24) continue;
      const L = levelOf(F.b, x, z);
      // the Lake is 7 ft (2.1 m) deep at its centre with terraced, shallow edges (Wikipedia, "The Lake (Central Park)"),
      // Harlem Meer 3-5 ft, Turtle Pond 1-2 ft: the bed falls 0.6 m at the shore and 4 cm per metre in, 2.2 m at most
      const bed = F.d < 16 ? L - 0.6 - Math.min(40, Math.max(0, -F.d)) * 0.04 : L - 0.6 + (F.d - 16) * 0.5;
      const k = j * n + i;
      if (bed < T[k]) T[k] = bed;
    }
  }
  _applied++;
  if (nIn || nCut) console.log(`[cp32l] ${tile.header.tx}_${tile.header.tz}: ${nCut} ground triangles under water cut, ${nIn} in banks reshaped (${((typeof performance !== 'undefined' ? performance.now() : 0) - t0).toFixed(0)} ms)`);
}

// ---------------------------------------------------------------- the surfaces (build)
// Each body triangulated once (earcut, islands as holes) and cut to a 16 m lattice, so every piece lies in one tile
// and every vertex takes the level where it stands (the relief's datum surface tilts a lake by a few centimetres).
const SURF_CELL = 16;
function surfOf(b) {
  if (b.surf) return b.surf;
  const flat = [], holes = [];
  for (const [x, z] of b.outer) flat.push(x, z);
  for (const h of b.holes) { holes.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
  const idx = earcut(flat, holes.length ? holes : null, 2);
  const byTile = new Map();
  const cell = b.kind === 'lake' || b.kind === 'reservoir' ? SURF_CELL : 8;
  for (let t = 0; t < idx.length; t += 3) {
    const tri = [0, 1, 2].map((m) => [flat[idx[t + m] * 2], 0, flat[idx[t + m] * 2 + 1]]);
    for (const P of cutTo(tri, cell)) {
      let cx = 0, cz = 0;
      for (const p of P) { cx += p[0]; cz += p[2]; }
      cx /= P.length; cz /= P.length;
      const key = `${Math.floor(cx / 512)}_${Math.floor(cz / 512)}`;
      let L = byTile.get(key);
      if (!L) byTile.set(key, (L = []));
      for (let m = 1; m + 1 < P.length; m++) L.push(P[0][0], P[0][2], P[m][0], P[m][2], P[m + 1][0], P[m + 1][2]);
    }
  }
  b.surf = byTile;
  return byTile;
}
function cutTo(tri, cell) {
  let x0 = 1e9, x1 = -1e9;
  for (const p of tri) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); }
  const strips = [];
  let rest = tri;
  for (let k = Math.floor(x0 / cell) + 1; k * cell < x1 && rest; k++) { const [lo, hi] = splitPoly(rest, 0, k * cell); if (lo) strips.push(lo); rest = hi; }
  if (rest) strips.push(rest);
  const out = [];
  for (const s of strips) {
    let r = s, z0 = 1e9, z1 = -1e9;
    for (const p of s) { z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    for (let k = Math.floor(z0 / cell) + 1; k * cell < z1 && r; k++) { const [lo, hi] = splitPoly(r, 2, k * cell); if (lo) out.push(lo); r = hi; }
    if (r) out.push(r);
  }
  return out;
}

// the water column's colour (its single-scatter albedo, lit by the city's lights), the ripples' slope, the probe
const LOOK = {
  lake: { col: [0.034, 0.042, 0.021], amp: 0.012, rough: 0.05 },        // the Lake: a deep olive-green, brown in it (NAIP)
  pond: { col: [0.026, 0.034, 0.018], amp: 0.008, rough: 0.05 },        // the ponds: calmer, darker, greener-browner
  reservoir: { col: [0.021, 0.041, 0.047], amp: 0.042, rough: 0.07 },   // the Reservoir: open, grey-green, wind-rippled
  coped: { col: [0.024, 0.036, 0.034], amp: 0.016, rough: 0.05 },       // Conservatory Water: shallow, concrete-bottomed
  basin: { col: [0.030, 0.048, 0.046], amp: 0.010, rough: 0.05 },
  stream: { col: [0.030, 0.036, 0.020], amp: 0.030, rough: 0.08 },
};
// (CPB33: the Pond, Turtle Pond and the Pool take the Lake's look too: the owner's review of teaser 4 read the Pond as
// muddy under Gapstow Bridge; `?cpbank=0` restores the ponds' own)
const lookOf = (b) => (b.kind === 'lake' ? (CPBANK || b.k === 'lake' || b.k === 'meer' ? LOOK.lake : LOOK.pond) : LOOK[b.kind] || LOOK.pond);

// the body's own helpers after the shared core (city/cpWaterMat.js CPW_CORE_GLSL: the uniforms cpwCol, cpwP, cpwProbe,
// cpwEnv, cpwEnvOn, cpwT, cpwNight, cpwSky, the varying vCpW, cpwHash, cpwH and the ripples cpwCap, 1.4 m down to 3 cm,
// slowed x 0.55: a calm park lake, not open sea)
const WATER_GLSL = /* glsl */ `
  #ifndef CPW_BANKK
  #define CPW_BANKK 1.0
  #endif
  uniform sampler2D cpwSdf; uniform vec4 cpwRect;
  uniform vec4 cpwBr[2]; uniform vec4 cpwBrH[2];   // bridges over this body: axis ends; heights over the water (ends, crown, soffit, on)
  uniform float cpwBrW[2];                         // ...and the half width of each one's vault (0: none)
  // distance from the shore into the water (m), from the body's field
  float cpwShore(vec2 xz) {
    vec2 uv = (xz - cpwRect.xy) * cpwRect.zw;
    return texture2D(cpwSdf, uv).r * 26.0 - 2.0;
  }
  // the probe (the surroundings seen from over the water), parallax-fixed on a cylinder of the body's radius round it
  vec3 cpwRefl(vec3 R, float lod) {
    vec3 skyC;
    {
      vec3 zen = cpwSky * 1.95, hor = cpwSky * 2.3;
      #ifdef USE_FOG
        hor = fogSkyColor(vec3(R.x, max(R.y, 0.0), R.z), hor);
      #endif
      skyC = mix(hor, zen, pow(clamp(R.y, 0.0, 1.0), 0.42)) * (1.0 - 0.85 * cpwNight);
    }
    if (cpwEnvOn < 0.5) {
      // no probe yet: the sky, and the dark band of the far shore's trees low over the horizon
      float band = 1.0 - smoothstep(0.02, 0.16, R.y);
      return mix(skyC, vec3(0.018, 0.026, 0.014) * (1.0 - 0.8 * cpwNight), band * 0.85);
    }
    // under a bridge's vault (Bow Bridge's iron deck, Gapstow's arch) the reflected ray rises into its soffit: dark stone
    // or iron lit only by the water under it (the probe, taken over the open water, gave the sky there: a bright band in
    // the Pond under Gapstow's arch, the owner's review of teaser 4)
    // MR33 (the review of teaser 4 v2: "a razor-thin black line across the water under Gapstow and Bow Bridge"): a constant
    // inside the vault's half width drew the footprint of the vault as a hard-edged black strip. The soffit now fades in over
    // the footprint's edge and the span's ends, and with the height the ray has reached by the time it leaves the footprint
    // (a ray that rises into the vault meets the soffit, one that leaves under it sees the far side through the arch); the
    // planar mirror shows the real underside, this is the fallback
    float soff = 0.0;
    for (int k = 0; k < 2; k++) {
      vec4 A = cpwBr[k], Hh = cpwBrH[k];
      float hw = cpwBrW[k];
      if (Hh.w < 0.5 || Hh.w > 1.5 || hw <= 0.0) continue;
      vec2 e = A.zw - A.xy; float el = length(e);
      if (el < 1e-3) continue;
      vec2 eu = e / el, rel = vCpW.xz - A.xy;
      float along = dot(rel, eu), acr = rel.x * eu.y - rel.y * eu.x, across = abs(acr);
      float sw = smoothstep(0.0, 1.8, along) * smoothstep(0.0, 1.8, el - along) * (1.0 - smoothstep(hw - 1.4, hw + 0.3, across));
      if (sw <= 0.0) continue;
      float rise = 1e3, dl2 = length(R.xz);
      if (dl2 > 1e-3) {
        vec2 u2 = R.xz / dl2;
        float ua = dot(u2, eu), uc = u2.x * eu.y - u2.y * eu.x;
        float sA = abs(ua) > 1e-4 ? (ua > 0.0 ? el - along : along) / abs(ua) : 1e5;
        float sC = abs(uc) > 1e-4 ? (uc * acr > 0.0 ? hw - across : hw + across) / abs(uc) : 1e5;
        rise = min(sA, sC) * R.y / dl2;
      }
      soff = max(soff, sw * smoothstep(0.5 * Hh.z, Hh.z, rise));
    }
    // parallax: march the reflected ray over the body's shore field to the bank it would meet; if it passes under the
    // bank's trees there (13-20 m), look the probe up towards that point of the treeline, else it is sky or distant city
    // and the ray's own direction serves (never below the probe's horizon: the probe draws without the water, so under
    // it lies the bed)
    vec3 dir = R;
    vec2 d2 = R.xz; float dl = length(d2);
    float bankK = 0.0, bankRise = 0.0;
    if (dl > 1e-3) {
      vec2 u = d2 / dl;
      float t = 0.0; bool hit = false;
      // (from 3 m out: a fragment by a bank whose ray runs along or off it must not take the bank's own toe)
      t = 3.0;
      for (int i = 0; i < 18; i++) {
        float s = cpwShore(vCpW.xz + u * t);
        if (s < 0.4) { hit = true; break; }
        t += max(s, 1.5);
        if (t > 420.0) break;
      }
      #ifdef CPW_MIR
      // MR33 (the probe is the fallback beyond the mirrored body): a ray that ran out of steps skimming a shore (the
      // field's distance stayed small all along) meets that shore; it escaped to the sky between the treeline's
      // reflections before (the review of teaser 4 v2: sky shards in the Lake by the terrace)
      if (!hit && t <= 420.0) hit = true;
      #endif
      float tc = 450.0;   // past the treeline: the city round the park, taken ~450 m out (or 150 m past the shore)
      if (hit) {
        float rise = t * R.y / dl;
        vec2 hx = vCpW.xz + u * t;
        float treeH = 13.0 + 7.0 * cpwH(hx * 0.05);
        tc = max(t + 150.0, 450.0);
        if (rise < treeH) {
          dir = normalize(vec3(hx.x, vCpW.y + rise, hx.y) - vec3(cpwProbe.x, cpwProbe.z, cpwProbe.y)); tc = -1.0;
          // CPB33: the probe hangs over the body's deepest point, so a bank near this fragment and far from the probe is
          // seen from there at another angle (its wet toe, a wall's face): the near banks lay in the water as brown
          // smears (the owner's review of teaser 4). There the bank's own reflection is taken instead: the lawn's green
          // low down, the trees' darker green over it
          #ifdef CPW_MIR
          // (MR33: feathered over 0.1-0.9 of the probe's distance: the 0.25-0.6 switch drew a seam behind the terrace)
          bankK = CPW_BANKK * (1.0 - smoothstep(0.1, 0.9, t / max(length(hx - cpwProbe.xy), 1.0)));
          #else
          bankK = CPW_BANKK * (1.0 - smoothstep(0.25, 0.6, t / max(length(hx - cpwProbe.xy), 1.0)));
          #endif
          bankRise = rise;
        }
      }
      // a bridge over the water (Bow Bridge, Gapstow): the ray meets its axis before the shore, under its railing and
      // not through its arch: the probe looked up towards that point (the hero shots' reflection of the arch)
      for (int k = 0; k < 2; k++) {
        vec4 A = cpwBr[k], Hh = cpwBrH[k];
        if (Hh.w < 0.5) continue;
        if (Hh.w > 1.5) {
          // a tower on the shore (Belvedere Castle over Turtle Pond): a vertical cylinder (centre A.xy, radius A.z, top Hh.y)
          vec2 oc = vCpW.xz - A.xy;
          float bq = dot(oc, u), cq = dot(oc, oc) - A.z * A.z, disc = bq * bq - cq;
          if (disc < 0.0) continue;
          float tt = -bq - sqrt(disc);
          if (tt <= 0.5 || (hit && tt > t + A.z)) continue;
          float rt = tt * R.y / dl;
          if (rt > Hh.y) continue;
          vec2 ht = vCpW.xz + u * tt;
          dir = normalize(vec3(ht.x, vCpW.y + rt, ht.y) - vec3(cpwProbe.x, cpwProbe.z, cpwProbe.y));
          tc = -1.0; bankK = 0.0;
          break;
        }
        vec2 e = A.zw - A.xy;
        float den = u.x * e.y - u.y * e.x;
        if (abs(den) < 1e-4) continue;
        vec2 w0 = A.xy - vCpW.xz;
        float tb = (w0.x * e.y - w0.y * e.x) / den, sb = (w0.x * u.y - w0.y * u.x) / den;
        if (tb <= 0.5 || sb < 0.0 || sb > 1.0 || (hit && tb > t)) continue;
        float rb = tb * R.y / dl, arc = 1.0 - (2.0 * sb - 1.0) * (2.0 * sb - 1.0);
        if (rb > mix(Hh.x, Hh.y, arc) + 1.1 || rb < Hh.z * sqrt(max(arc, 0.0))) continue;
        vec2 hb = vCpW.xz + u * tb;
        dir = normalize(vec3(hb.x, vCpW.y + rb, hb.y) - vec3(cpwProbe.x, cpwProbe.z, cpwProbe.y));
        tc = -1.0; bankK = 0.0;
        break;
      }
      if (tc > 0.0) {
        vec2 hc = vCpW.xz + u * tc;
        dir = normalize(vec3(hc.x, vCpW.y + tc * R.y / dl, hc.y) - vec3(cpwProbe.x, cpwProbe.z, cpwProbe.y));
      }
    }
    dir.y = max(dir.y, 0.03);
    vec3 cpwRc = textureLod(cpwEnv, normalize(dir), lod).rgb;
    if (bankK > 0.0) cpwRc = mix(cpwRc, mix(vec3(0.050, 0.068, 0.030), vec3(0.022, 0.032, 0.016), smoothstep(0.8, 3.5, bankRise)) * (1.0 - 0.8 * cpwNight), bankK);
    if (soff > 0.0) cpwRc = mix(cpwRc, vec3(0.034, 0.032, 0.028) * (1.0 - 0.8 * cpwNight), soff);
    return cpwRc;
  }`;

function sdfTexture(b) {
  const S = sdfOf(b);
  const data = new Uint8Array(S.nx * S.nz);
  for (let k = 0; k < data.length; k++) data[k] = Math.max(0, Math.min(255, Math.round(((-S.D[k] + 2) / 26) * 255)));
  const tex = new THREE.DataTexture(data, S.nx, S.nz, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  // texel centres: u = (x - x0) / (nx * step) + 0.5 / nx
  return { tex, rect: new THREE.Vector4(S.x0 - S.step * 0.5, S.z0 - S.step * 0.5, 1 / (S.nx * S.step), 1 / (S.nz * S.step)) };
}

function waterMat(b) {
  if (b.mat) return b.mat;
  const look = lookOf(b);
  const S = sdfOf(b);
  const { tex, rect } = sdfTexture(b);
  const U = {
    cpwSdf: { value: tex }, cpwRect: { value: rect }, cpwCol: { value: new THREE.Vector3(...look.col) },
    // x ripple slope, y shore depth gain (1/m), z bed albedo, w probe lod bias
    cpwP: { value: new THREE.Vector4(look.amp, b.kind === 'reservoir' ? 0.5 : b.kind === 'coped' || b.kind === 'basin' ? 0.9 : 0.8, b.kind === 'coped' || b.kind === 'basin' ? 0.20 : 0.10, 0) },
    // probe: x, z, y, cylinder radius
    cpwProbe: { value: new THREE.Vector4(S.cx, S.cz, 0, Math.max(...[[b.box[0], b.box[1]], [b.box[2], b.box[1]], [b.box[0], b.box[3]], [b.box[2], b.box[3]]].map(([x, z]) => Math.hypot(x - S.cx, z - S.cz))) + 60) },
    cpwEnv: { value: null }, cpwEnvOn: { value: 0 },
    cpwBr: { value: (BRIDGE_PROXY[b.k] || []).concat([[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]).slice(0, 2).map((q) => new THREE.Vector4(q[0], q[1], q[2], q[3])) },
    cpwBrH: { value: (BRIDGE_PROXY[b.k] || []).concat([[0, 0, 0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0, 0, 0]]).slice(0, 2).map((q) => new THREE.Vector4(q[4], q[5], q[6], q[7])) },
    cpwBrW: { value: CPBANK ? (BRIDGE_HALFW[b.k] || [0, 0]).slice() : [0, 0] },
    cpwT: ENV.time, cpwNight: ENV.night, cpwSky: ENV.skyAmbient,
  };
  // the shader is the park's shared water (city/cpWaterMat.js; Bethesda's pools take it too)
  // (CPB33: the Reservoir, 40 ha of open water, takes the shader's wind waves and sharper reflections)
  const open = CPBANK && b.kind === 'reservoir';
  const m = cpWaterMat({ name: 'cp32l:water:' + b.k, color: 0x0a120a, rough: look.rough, U, glsl: WATER_GLSL, key: open ? 'cp32l-water-open-1' : 'cp32l-water-1',
    defines: open ? { CPW_OPEN: '', CPW_LAM: '2.400', CPW_SLOW: '0.900' } : CPBANK ? null : { CPW_BANKK: '0.0' } });
  b.mat = m;
  // MR33: a level body the planar mirror can serve (city/cpWaterMat.js): its water from the field, the relief's lawn for
  // the rays that pass under a bank before they reach it
  if (b.kind === 'lake' || b.kind === 'reservoir' || b.kind === 'coped') {
    const q = { d: 0, w: 0 };
    cpwMirrorBody({ key: b.k, box: b.box, mats: [m], inside: (x, z) => sdfAt(S, x, z, q).d < 0, ground: lawnY, level: () => levelOf(b, S.cx, S.cz) });
  }
  return m;
}

// ---- reflection probes: one cube over each large body, rendered with the water hidden, on a short schedule of frames
// after the body first draws, and again when the sun moves (the fountains' FW27 scheme, city/fountainFX.js)
const PROBES = new Map();   // body key -> probe
const SCHED = [2, 16, 90];   // three captures as the tiles and trees stream in, then again when the sun moves
const _cp = new THREE.Vector3();
let _capturing = false;
const WATER_MESHES = new Set();
// what the probes see where the water is: a still sheet of the sky's horizon colour (with the probe drawn without its
// water, the bed and the banks' toes lay under its horizon, and the blurred lookups near the horizon mirrored them as
// stepped brown bands: LANDMARKS' 07:55 bowSideE and boatLake)
let _probeWaterMat = null;
function probeWaterMat() {
  if (!_probeWaterMat) _probeWaterMat = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: true });
  const c = ENV.skyAmbient.value, n = ENV.night.value;
  _probeWaterMat.color.setRGB(c.r * 1.6, c.g * 1.6, c.b * 1.6).multiplyScalar(1 - 0.85 * n);
  return _probeWaterMat;
}
function captureProbe(P, r, scene) {
  _capturing = true;
  const vis = [];
  try {
    const pm = probeWaterMat();
    for (const m of WATER_MESHES) { vis.push([m, m.visible, m.material]); m.material = pm; }
    P.cam.position.set(P.x, P.y, P.z);
    P.cam.updateMatrixWorld(true);
    if (P.cam.coordinateSystem !== r.coordinateSystem) { P.cam.coordinateSystem = r.coordinateSystem; P.cam.updateCoordinateSystem(); }
    const rt0 = r.getRenderTarget(), f0 = r.getActiveCubeFace(), m0 = r.getActiveMipmapLevel();
    const xr = r.xr.enabled, sh = r.shadowMap.autoUpdate;
    r.xr.enabled = false; r.shadowMap.autoUpdate = false;
    const tex = P.rt.texture;
    tex.generateMipmaps = false;
    for (let i = 0; i < 6; i++) {
      if (i === 5) tex.generateMipmaps = true;
      r.setRenderTarget(P.rt, i);
      r.clear(true, true, true);
      r.render(scene, P.cam.children[i]);
    }
    r.setRenderTarget(rt0, f0, m0);
    r.xr.enabled = xr; r.shadowMap.autoUpdate = sh;
    P.sun.copy(ENV.sunDir.value);
    const U = P.b.mat?.userData.cpw;
    if (U) { U.cpwEnv.value = tex; U.cpwEnvOn.value = 1; U.cpwProbe.value.z = P.y; }
  } catch (e) { console.warn('[cp32l] probe', e); }
  finally {
    for (const [m, v, mat] of vis) { m.visible = v; m.material = mat; }
    _capturing = false;
  }
}
const _pending = new Set();
function requestProbe(P, scene) {
  _pending.add(P);
  if (scene.userData.cp32lArmed) return;
  scene.userData.cp32lArmed = true;
  const orig = scene.onBeforeRender;
  scene.onBeforeRender = function (r, s, c, rt) {
    scene.onBeforeRender = orig;
    scene.userData.cp32lArmed = false;
    // one probe a frame (six renders of the scene each): the bodies' first draws come together, and taking every
    // probe in one frame stalled it for seconds (r1 lkBow: 0.2 fps at capture)
    const q = [..._pending][0];
    _pending.delete(q);
    if (q) captureProbe(q, r, scene);
    orig?.call(this, r, s, c, rt);
    if (_pending.size) { const nxt = [..._pending][0]; _pending.delete(nxt); requestProbe(nxt, scene); }
  };
}
function probeOf(b) {
  let P = PROBES.get(b.k);
  if (P) return P;
  const S = sdfOf(b);
  const big = b.k === 'lake' || b.k === 'reservoir';
  const rt = new THREE.WebGLCubeRenderTarget(CPBANK && b.k === 'reservoir' ? 512 : big ? 256 : 128, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
  P = { b, rt, cam: new THREE.CubeCamera(0.5, 4000, rt), x: S.cx, z: S.cz, y: levelOf(b, S.cx, S.cz) + 2.2, n: 0, step: 0, sun: new THREE.Vector3(), has: false };
  PROBES.set(b.k, P);
  return P;
}
const PROBE_KINDS = new Set(['lake', 'reservoir', 'coped']);
function hookProbe(mesh, b) {
  if (!PROBE_KINDS.has(b.kind) || sdfOf(b).deep < 12) return;
  const prev = mesh.onBeforeRender;
  mesh.onBeforeRender = function (renderer, scene, camera, ...rest) {
    prev?.call(this, renderer, scene, camera, ...rest);
    if (_capturing || !camera.isPerspectiveCamera || Math.abs(camera.fov - 90) < 0.01) return;
    const rt0 = renderer.getRenderTarget();
    if (rt0 && rt0.isWebGLCubeRenderTarget) return;
    const P = probeOf(b);
    if (_cp.set(P.x, P.y, P.z).distanceToSquared(camera.position) > 1500 * 1500) return;
    if (P.has && P.sun.distanceToSquared(ENV.sunDir.value) > 1e-4) { P.step = 0; P.n = 0; }
    P.n++;
    if (P.step < SCHED.length && P.n >= SCHED[P.step]) { P.step++; P.has = true; requestProbe(P, scene); }
  };
}

// ---- copings: the Reservoir's granite coping on its embankment, Conservatory Water's granite curb, the basins' rims.
// Per ring segment (the rings are resampled to <= 3 m): an inner face from under the water to the top, the top, and a
// short outer face down to the ground behind; each segment a block of its own tone. A segment is built by the tile
// that holds its middle.
let _copeMat = null;
function copeMat() {
  if (_copeMat) return _copeMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.82, metalness: 0 });
  m.name = 'cp32l:coping';
  applyStoneDetail(m, 'cgranite', { amt: 0.7, scale: 0.8 });
  applyLightTrim(m);
  _copeMat = m;
  return m;
}
const hash1 = (n) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
// coping dimensions per kind: top over the water (m, or over the ground behind for the basins), width, face under water
function copeSpec(b) {
  if (b.kind === 'reservoir') return { top: 1.35, w: 0.55, under: 0.6, back: 0.14, col: [0.47, 0.455, 0.43] };
  if (b.kind === 'coped') return { top: 0.36, w: 0.45, under: 0.35, back: 0.12, col: [0.52, 0.50, 0.47] };
  if (b.kind === 'basin') return { top: 0.34, w: 0.32, under: 0.3, back: 0.42, col: [0.56, 0.54, 0.50] };
  return null;
}
function buildCoping(acc, b, ox, oz, ctx) {
  const C = copeSpec(b);
  if (!C) return;
  const { pos, nor, col } = acc;
  const quad = (a, bq, c, d, n, k) => {
    for (const p of [a, bq, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(n[0], n[1], n[2]); col.push(k[0], k[1], k[2]); }
  };
  const rings = [b.outer, ...b.holes];
  let seg = 0;
  for (const R of rings) {
    const n = R.length;
    const nrm = (i) => { const p = R[i], q = R[(i + 1) % n], ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1; return [ez / L, -ex / L]; };
    const vn = [];
    for (let i = 0; i < n; i++) {
      const a = nrm((i - 1 + n) % n), c = nrm(i);
      let mx = a[0] + c[0], mz = a[1] + c[1];
      const ml = Math.hypot(mx, mz) || 1;
      mx /= ml; mz /= ml;
      const k = 1 / Math.max(0.35, mx * c[0] + mz * c[1]);
      vn.push([mx * k, mz * k]);
    }
    for (let i = 0; i < n; i++, seg++) {
      const j = (i + 1) % n, p = R[i], q = R[j];
      const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
      if (mx < ox || mx >= ox + 512 || mz < oz || mz >= oz + 512) continue;
      const yw0 = levelOf(b, p[0], p[1]), yw1 = levelOf(b, q[0], q[1]);
      // the top: over the water, or over the paving for a raised basin; never under the ground behind it
      const g0 = ctx.padYNear ? ctx.padYNear(p[0] + vn[i][0] * (C.w + 0.3), p[1] + vn[i][1] * (C.w + 0.3)) : null;
      const g1 = ctx.padYNear ? ctx.padYNear(q[0] + vn[j][0] * (C.w + 0.3), q[1] + vn[j][1] * (C.w + 0.3)) : null;
      const flat = CPCW && b.kind === 'coped';
      const t0 = flat ? copeTop(b) : b.kind === 'basin' ? lawnY(p[0], p[1]) + C.back : Math.max(yw0 + C.top, (g0 ?? -1e9) + 0.1);
      const t1 = flat ? copeTop(b) : b.kind === 'basin' ? lawnY(q[0], q[1]) + C.back : Math.max(yw1 + C.top, (g1 ?? -1e9) + 0.1);
      const back0 = b.kind === 'basin' ? t0 - C.back - 0.05 : (g0 ?? t0 - C.back) - 0.04, back1 = b.kind === 'basin' ? t1 - C.back - 0.05 : (g1 ?? t1 - C.back) - 0.04;
      const I0 = [p[0] - vn[i][0] * 0.04, q[0] - vn[j][0] * 0.04], Iz = [p[1] - vn[i][1] * 0.04, q[1] - vn[j][1] * 0.04];
      const O0 = [p[0] + vn[i][0] * C.w, q[0] + vn[j][0] * C.w], Oz = [p[1] + vn[i][1] * C.w, q[1] + vn[j][1] * C.w];
      const tone = 0.9 + 0.2 * hash1(seg + b.id % 97), k = [C.col[0] * tone, C.col[1] * tone, C.col[2] * tone];
      const en = nrm(i);
      // inner face (towards the water), top, outer face. The Reservoir's is its stone revetment, sloping about 1 in 1 from
      // the coping down under the water, not a quay wall
      if (b.kind === 'reservoir') {
        const r0 = C.top + C.under, B0 = [p[0] - vn[i][0] * r0, q[0] - vn[j][0] * r0], Bz = [p[1] - vn[i][1] * r0, q[1] - vn[j][1] * r0];
        const sl = Math.SQRT1_2;
        quad([B0[0], yw0 - C.under, Bz[0]], [B0[1], yw1 - C.under, Bz[1]], [I0[1], t1, Iz[1]], [I0[0], t0, Iz[0]], [-en[0] * sl, sl, -en[1] * sl], [k[0] * 0.92, k[1] * 0.92, k[2] * 0.9]);
      } else quad([I0[0], yw0 - C.under, Iz[0]], [I0[1], yw1 - C.under, Iz[1]], [I0[1], t1, Iz[1]], [I0[0], t0, Iz[0]], [-en[0], 0, -en[1]], k);
      // a 2 cm chamfer's worth of lighter arris on the top, where the stone is worn
      quad([I0[0], t0, Iz[0]], [I0[1], t1, Iz[1]], [O0[1], t1, Oz[1]], [O0[0], t0, Oz[0]], [0, 1, 0], [k[0] * 1.06, k[1] * 1.06, k[2] * 1.06]);
      quad([O0[0], t0, Oz[0]], [O0[1], t1, Oz[1]], [O0[1], Math.min(back1, t1 - 0.02), Oz[1]], [O0[0], Math.min(back0, t0 - 0.02), Oz[0]], [en[0], 0, en[1]], [k[0] * 0.9, k[1] * 0.9, k[2] * 0.9]);
    }
  }
}
// every coping in the tile as one mesh (one material)
function flushCoping(group, acc) {
  const { pos, nor, col } = acc;
  if (!pos.length) return;
  // wind every quad's triangles to face its normal
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
    const ux = pos[t + 3] - ax, uy = pos[t + 4] - ay, uz = pos[t + 5] - az, vx = pos[t + 6] - ax, vy = pos[t + 7] - ay, vz = pos[t + 8] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nor[t] + cy * nor[t + 1] + cz * nor[t + 2] < 0) {
      for (let k = 0; k < 3; k++) { const s1 = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = s1; }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, copeMat());
  m.name = 'cp32l:copings';
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}

// ---------------------------------------------------------------- the schist outcrops
// OSM natural=bare_rock (114 in the park, 4.2 ha): Manhattan schist scoured by the Wisconsin ice sheet, rounded and
// polished on the up-ice (north-west) side and plucked steeper on the lee (south-east), 0.5-4 m proud of the ground.
// Each is a heightfield over its polygon on a lattice of 0.5-1.2 m: the hump h = H (1 - (1 - t)^2) of the distance in
// from its edge (t = d / R, R the polygon's inradius), the lee side rising faster, two octaves of knobs and hollows,
// and a skirt sunk 0.45 m under the ground past the edge so its outline is where it meets the lawn. H = 0.8 (A / 100)^0.4
// (a 100 m2 rock 0.8 m, Umpire Rock's 2,830 m2 3.2 m), never more than the inradius allows. Built whole by the tile
// holding its centroid; the ground under it is the relief's lawn with this part's bank offset (a rock on a shore stands
// on the reshaped bank).
const RK = ROCKS.map((r) => {
  const outer = unflat(r.outer);
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9, cx = 0, cz = 0, A = 0;
  for (let i = 0; i < outer.length; i++) {
    const p = outer[i], q = outer[(i + 1) % outer.length];
    x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]);
    cx += p[0]; cz += p[1]; A += p[0] * q[1] - q[0] * p[1];
  }
  return { id: r.id, name: r.name || '', outer, holes: r.holes.map(unflat), box: [x0, z0, x1, z1], c: [cx / outer.length, cz / outer.length], A: Math.abs(A) / 2 };
});
const SE = [0.5, 0.866];   // the ice moved to the south-south-east (striations N30W - S30E); x east, z south
const vnoise2 = (x, z) => {
  const xi = Math.floor(x), zi = Math.floor(z), u = x - xi, v = z - zi, su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  const h = (i, j) => { const t = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return t - Math.floor(t); };
  return (h(xi, zi) * (1 - su) + h(xi + 1, zi) * su) * (1 - sv) + (h(xi, zi + 1) * (1 - su) + h(xi + 1, zi + 1) * su) * sv;
};
// Carve-outs: other parts' floors standing on a rock: a quad (world x, z), a pad (m) and the floor's 3DEP level; the rock
// is kept 0.3 m under the floor inside the quad + pad.
//   Belvedere Castle's terrace plateau (LANDMARKS worker): floor at 3DEP 39.6 m, the published 130 ft top of Vista Rock
//   compiled buildings on an outcrop (their floor is the relief's lawn at their centroid): Blockhouse No. 1 on its
//   crag at the north end, the Loeb Boathouse's north corner, the Chess & Checkers House on the Kinderberg
const ROCK_CUT = [
  { q: [[175.1, 387.4], [212.2, 408.2], [199.4, 430.9], [162.4, 410.1]], pad: 2, dem: 39.6 },
  { q: [[1257, -1735.4], [1262, -1735.4], [1262, -1725.3], [1251.9, -1725.3], [1251.9, -1735.4]], pad: 1, lawn: [1257.0, -1731.3] },
  { q: [[217.7, 840], [218.2, 842.4], [223.3, 841.3], [225.9, 852.5], [220.5, 853.7], [221.3, 857.1], [210.9, 859.5], [211.1, 860.3], [212.5, 860], [216.2, 876.2], [218.1, 875.8], [220.8, 887.8], [203.9, 891.7], [204.5, 894.4], [196.5, 896.2], [187.2, 855.6], [188.4, 855.4], [184.1, 836.7], [215.3, 829.6]], pad: 1, lawn: [210.3, 861.4] },
  { q: [[120.1, 1462.7], [118.9, 1464.4], [116.9, 1464.2], [115.5, 1466.3], [112.4, 1464.2], [113.6, 1462.5], [113.2, 1460.3], [114.5, 1458.4], [116.5, 1458], [117.7, 1456.2], [121.2, 1458.6], [119.8, 1460.7]], pad: 1, lawn: [116.7, 1461.4] },
].map((C) => ({ ...C, poly: C.q, bb: [Math.min(...C.q.map((p) => p[0])) - C.pad, Math.min(...C.q.map((p) => p[1])) - C.pad, Math.max(...C.q.map((p) => p[0])) + C.pad, Math.max(...C.q.map((p) => p[1])) + C.pad] }));
function ringInsideDist(x, z, R, holes) {
  let d = 1e9, ins = false;
  for (const Rg of [R, ...holes]) {
    for (let i = 0, k = Rg.length - 1; i < Rg.length; k = i++) {
      const a = Rg[k], c = Rg[i], ex = c[0] - a[0], ez = c[1] - a[1], L = ex * ex + ez * ez;
      let t = L > 0 ? ((x - a[0]) * ex + (z - a[1]) * ez) / L : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      d = Math.min(d, Math.hypot(x - a[0] - ex * t, z - a[1] - ez * t));
      if ((a[1] > z) !== (c[1] > z) && x < ((c[0] - a[0]) * (z - a[1])) / (c[1] - a[1]) + a[0]) ins = !ins;
    }
  }
  return ins ? d : -d;
}
function bodiesNear(x, z) {
  const out = [];
  for (const b of BODIES) if (x > b.box[0] - SDF_R && x < b.box[2] + SDF_R && z > b.box[1] - SDF_R && z < b.box[3] + SDF_R) { sdfOf(b); out.push(b); }
  return out;
}
// the ground this part leaves at (x, z): the relief's lawn, the bank offset, the bed under the water
const _g = { d: 0, w: 0, b: null };
function groundAt(x, z) {
  const G = lawnY(x, z);
  fieldAt(bodiesNear(x, z), x, z, _g);
  if (!_g.b) return G;
  if (_g.d < cutAt(_g.b, x, z)) return levelOf(_g.b, x, z) - 1.0;
  return G + bankOffset(_g.b, x, z, _g.d, _g.w);
}
function rockGeo(r) {
  if (r.geo !== undefined) return r.geo;
  const H0 = Math.min(4.0, Math.max(0.5, 0.8 * Math.pow(r.A / 100, 0.4)));
  const st = Math.min(1.2, Math.max(0.5, Math.sqrt(r.A) / 22));
  const x0 = r.box[0] - 0.8, z0 = r.box[1] - 0.8, nx = Math.ceil((r.box[2] - r.box[0] + 1.6) / st) + 1, nz = Math.ceil((r.box[3] - r.box[1] + 1.6) / st) + 1;
  const D = new Float32Array(nx * nz);
  let R = 0.5;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const d = ringInsideDist(x0 + i * st, z0 + j * st, r.outer, r.holes); D[j * nx + i] = d; if (d > R) R = d; }
  const H = Math.min(H0, R * 0.9 + 0.3);   // a thin rock stays low
  r.H = H; r.R = R;
  const Y = new Float32Array(nx * nz), keep = new Uint8Array(nx * nz), gy = new Float32Array(nx * nz);
  const seed = (r.id % 1000) * 0.37;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, d = D[k];
    if (d < -0.45) continue;
    keep[k] = 1;
    const x = x0 + i * st, z = z0 + j * st;
    gy[k] = groundAt(x, z);
    if (d <= 0) { Y[k] = d * 2.5; continue; }   // the skirt: 1.1 m under the ground at the lattice's last row
    // the lee (south-east) side climbs faster: its distance counts up to 45 % more
    const ux = x - r.c[0], uz = z - r.c[1], ul = Math.hypot(ux, uz) || 1;
    const lee = 1 + 0.45 * Math.max(0, (ux * SE[0] + uz * SE[1]) / ul);
    const t = Math.min(1, (d * lee) / Math.max(R, 1));
    const hump = 1 - (1 - t) * (1 - t);
    const knob = (vnoise2(x * 0.16 + seed, z * 0.16) - 0.5) * 0.45 + (vnoise2(x * 0.55 + 7 + seed, z * 0.55 - 3) - 0.5) * 0.16;
    Y[k] = H * hump * (1 + knob) + Math.min(d, 0.6) * 0.15;
  }
  for (const C of ROCK_CUT) {
    if (C.bb[0] > r.box[2] + 1 || C.bb[2] < r.box[0] - 1 || C.bb[1] > r.box[3] + 1 || C.bb[3] < r.box[1] - 1) continue;
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, x = x0 + i * st, z = z0 + j * st;
      if (!keep[k] || x < C.bb[0] || x > C.bb[2] || z < C.bb[1] || z > C.bb[3]) continue;
      if (ringInsideDist(x, z, C.poly, []) < -C.pad) continue;
      const floor = C.lawn ? lawnY(C.lawn[0], C.lawn[1]) + 0.02 : cpReliefReady() ? cpDemToWorld(C.dem, x, z) : CP_DATUM;
      Y[k] = Math.min(Y[k], floor - 0.3 - gy[k]);
    }
  }
  const pos = [];
  const P = (k, i, j) => [x0 + i * st, gy[k] + Y[k], z0 + j * st];
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    if (!(keep[a] && keep[b] && keep[c] && keep[d])) continue;
    if (D[a] < -0.3 && D[b] < -0.3 && D[c] < -0.3 && D[d] < -0.3) continue;   // all skirt: under the ground
    const A = P(a, i, j), B = P(b, i + 1, j), Cc = P(c, i, j + 1), Dd = P(d, i + 1, j + 1);
    pos.push(...A, ...Cc, ...B, ...B, ...Cc, ...Dd);   // up-facing (x east, z south, y up)
  }
  r.geo = pos.length ? Float32Array.from(pos) : null;
  return r.geo;
}
// the outcrop's surface y at world (x, z), or null (other parts: seat a foot on it, keep trees and benches off it)
export function cpRockTop(x, z) {
  if (!CP32L) return null;
  const t33 = cpRocksTop(x, z);   // CP33: the new outcrops' own surface (undefined where none)
  if (t33 !== undefined) return t33;
  for (const r of RK) {
    if (cpRocksOwns(r.id)) continue;
    if (CPC33 && r.id === VISTA_ID) { const y = castleVistaTop(x, z); if (y !== undefined) return y; continue; }   // CPC33
    if (x < r.box[0] || x > r.box[2] || z < r.box[1] || z > r.box[3]) continue;
    const d = ringInsideDist(x, z, r.outer, r.holes);
    if (d < 0) continue;
    if (!rockGeo(r)) continue;
    return groundAt(x, z) + r.H * (1 - Math.pow(1 - Math.min(1, d / Math.max(r.R, 1)), 2));
  }
  return null;
}
export const cpOnRock = (x, z) => cpRockTop(x, z) !== null;
let _rockMat = null;
function rockMat() {
  if (_rockMat) return _rockMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0 });
  m.name = 'cp32l:schist';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRkW; varying vec3 vRkN;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRkW = (modelMatrix * vec4(transformed, 1.0)).xyz; vRkN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRkW; varying vec3 vRkN;
        float rkH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float rkN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(rkH(i), rkH(i + vec2(1.0, 0.0)), f.x), mix(rkH(i + vec2(0.0, 1.0)), rkH(i + vec2(1.0, 1.0)), f.x), f.y); }
        float rkF(vec2 p) { return rkN(p) * 0.55 + rkN(p * 2.3 + 5.1) * 0.28 + rkN(p * 5.9 + 1.7) * 0.17; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 w = vRkW;
          float fw = max(length(dFdx(w)), length(dFdy(w)));
          float nearD = 1.0 - smoothstep(0.02, 0.2, fw);
          // foliation: the schist's layering strikes about N30E, so its bands run north-north-east across the polish
          float across = dot(w.xz, vec2(0.866, 0.5));
          float band = rkF(vec2(across * 0.85, w.y * 0.35 + dot(w.xz, vec2(-0.5, 0.866)) * 0.08));
          float mass = rkF(w.xz * 0.12 + 3.0);
          vec3 c = mix(vec3(0.090, 0.088, 0.084), vec3(0.215, 0.205, 0.188), band * 0.62 + mass * 0.38);
          c = mix(c, c * vec3(0.55, 0.54, 0.52), smoothstep(0.62, 0.9, rkN(vec2(across * 3.1, w.y * 1.4))) * 0.6 * (0.4 + 0.6 * nearD));
          // quartz veins across the grain, pale
          c = mix(c, vec3(0.42, 0.41, 0.39), smoothstep(0.93, 0.985, rkN(vec2(dot(w.xz, vec2(0.5, -0.866)) * 0.9, across * 0.12) + 11.0)) * 0.7);
          // glacial striations: fine scratches along the ice's path (N30W - S30E), on the up-facing polish
          float sx = dot(w.xz, vec2(0.866, -0.5)) + rkN(w.xz * 0.35) * 0.8;
          float stri = smoothstep(0.42, 0.5, abs(fract(sx * 5.5) - 0.5)) * rkN(w.xz * vec2(0.4, 2.5));
          c *= 1.0 - stri * 0.18 * nearD * smoothstep(0.6, 0.95, vRkN.y);
          // iron staining, rust brown, where the water runs off
          c = mix(c, c * vec3(1.35, 1.0, 0.62), smoothstep(0.62, 0.92, rkF(w.xz * 0.21 + 17.0)) * 0.45);
          // lichen on the tops (grey-green crusts, the odd orange rosette), moss and soil in the hollows
          float lich = smoothstep(0.58, 0.8, rkF(w.xz * 0.9 + 31.0)) * smoothstep(0.45, 0.9, vRkN.y);
          c = mix(c, vec3(0.21, 0.22, 0.18), lich * 0.55);
          c = mix(c, vec3(0.34, 0.20, 0.06), smoothstep(0.9, 0.97, rkN(w.xz * 3.3 + 51.0)) * 0.6 * nearD * smoothstep(0.5, 0.9, vRkN.y));
          float hollow = smoothstep(0.62, 0.86, rkF(w.xz * 0.45 + 71.0));
          c = mix(c, vec3(0.045, 0.062, 0.030), hollow * 0.45 * smoothstep(0.3, 0.8, vRkN.y));
          // a real albedo (0.2-0.5), multiplied in: applyLightTrim's 0.30 lands before this block (its replace follows
          // the same anchor), so an assignment here would drop the trim and the rock would read white
          diffuseColor.rgb *= c * 1.8;   // (2.3 read chalky beside the lawn in the lead's 07:49 Bethesda still)
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          // the polish: smoother on the up-ice tops; mica flecks glint where the light catches them
          float fl = step(0.965, rkH(floor(vRkW.xz * 38.0) + floor(vRkW.y * 38.0) * 7.0));
          roughnessFactor = mix(0.86, 0.62, smoothstep(0.6, 0.95, vRkN.y)) - fl * 0.4 * (1.0 - smoothstep(0.02, 0.12, max(length(dFdx(vRkW)), length(dFdy(vRkW)))));
        }`);
  };
  m.customProgramCacheKey = () => 'cp32l-schist-1';
  applyLightTrim(m);
  _rockMat = m;
  return m;
}
function buildRocks(group, ox, oz, key, rk33) {
  const parts = [];
  let n = 0;
  for (const r of RK) {
    if (rk33 && cpRocksOwns(r.id)) continue;   // CP33: city/cpRocks.js built it (all but Vista Rock)
    if (CPC33 && r.id === VISTA_ID) continue;   // CPC33: city/cpCastle.js builds Vista Rock (and its walker collider)
    if (r.c[0] < ox || r.c[0] >= ox + 512 || r.c[1] < oz || r.c[1] >= oz + 512) continue;
    const a = rockGeo(r);
    if (!a) continue;
    parts.push(a); n += a.length;
    // walkers walk round it (the ring cut to at most 24 points)
    if (r.A > 40) {
      const R = r.outer, stp = Math.max(1, Math.ceil(R.length / 24)), pts = [];
      let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
      for (let i = 0; i < R.length; i += stp) { pts.push(R[i][0], R[i][1]); minX = Math.min(minX, R[i][0]); maxX = Math.max(maxX, R[i][0]); minZ = Math.min(minZ, R[i][1]); maxZ = Math.max(maxZ, R[i][1]); }
      const gy = groundAt(r.c[0], r.c[1]);
      COLLIDERS.addPrism(key, { pts: new Float32Array(pts), minX, minZ, maxX, maxZ, y0: gy - 2, y1: gy + r.H });
    }
  }
  if (!n) return;
  const pos = new Float32Array(n);
  let o = 0;
  for (const a of parts) { pos.set(a, o); o += a.length; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, rockMat());
  m.name = 'cp32l:outcrops';
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
}

// ---------------------------------------------------------------- the perimeter wall
// Vaux's low wall round the park (1860s): rusticated brownstone ashlar, cast green with moss, about 1 m over the
// perimeter sidewalk, 0.55 m thick, with a peaked (pyramidal) coping so nobody sits on it and the leaves fall off
// (Gothamist, "A Closer Look At Central Park's Maddeningly Slanted Perimeter Walls"; architecturalwatercolors.blogspot.com
// 2012, "The Boundaries of Central Park"). It follows the park's ring (OSM way 427818536, resampled to 2 m), its street
// face on the compiled perimeter sidewalk's inner edge, and it opens wherever the park side is not lawn: the gates (the
// paths and the drives that come in), the Met's plaza, the zoo. Built per tile from the ring segments whose middle lies
// in it; each segment a walker collider.
const WALL = { h: 1.0, t: 0.55, ridge: 0.11, over: 0.05, col: [0.40, 0.33, 0.27] };
const PARK_RING = (() => {
  const R = unflat(PARK), out = [];
  for (let i = 0; i < R.length; i++) {
    const p = R[i], q = R[(i + 1) % R.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]), n = Math.max(1, Math.ceil(L / 2));
    for (let k = 0; k < n; k++) out.push([p[0] + ((q[0] - p[0]) * k) / n, p[1] + ((q[1] - p[1]) * k) / n]);
  }
  return out;
})();
let _wallMat = null;
function wallMat() {
  if (_wallMat) return _wallMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.9, metalness: 0 });
  m.name = 'cp32l:perimeterWall';
  applyStoneDetail(m, 'climestone', { amt: 0.8, ashlar: 1, scale: 0.7 });
  // moss and soot: green in the damp joints low on the park side, darker at the foot
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPwW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvPwW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPwW;
        float pwH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
        float pwN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(pwH(i), pwH(i + vec2(1.0, 0.0)), f.x), mix(pwH(i + vec2(0.0, 1.0)), pwH(i + vec2(1.0, 1.0)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          float mo = smoothstep(0.55, 0.85, pwN(vPwW.xz * 0.9 + vPwW.y * 1.7) * 0.7 + pwN(vPwW.xz * 3.1) * 0.3);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.78, 0.42), mo * 0.5);
        }`);
  };
  m.customProgramCacheKey = () => 'cp32l-wall-1|' + (prev ? 'st' : '');
  applyLightTrim(m);
  _wallMat = m;
  return m;
}
const WALK_SEC = ['path', 'sidewalk', 'asphalt', 'gravel', 'plaza', 'brick', 'gutter'];
function buildWall(group, ctx) {
  const { ox, oz, key, sectionY } = ctx;
  if (!sectionY) return;
  const R = PARK_RING, n = R.length;
  const pos = [], nor = [], col = [];
  const quad = (a, b, c, d, nn, k) => { for (const p of [a, b, c, a, c, d]) { pos.push(p[0], p[1], p[2]); nor.push(nn[0], nn[1], nn[2]); col.push(k[0], k[1], k[2]); } };
  const walk = (x, z) => { for (const s of WALK_SEC) if (sectionY(s, x, z, 0.6) !== null) return true; return false; };
  // per segment: where the street face stands, whether the wall is there, the heights
  const seg = [];
  for (let i = 0; i < n; i++) {
    const p = R[i], q = R[(i + 1) % n];
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    if (mx < ox - 2 || mx >= ox + 514 || mz < oz - 2 || mz >= oz + 514) { seg.push(null); continue; }
    const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1, nx = ez / L, nz = -ex / L;   // outward
    // the perimeter sidewalk's inner edge, looking out from 1.5 m inside the ring
    let face = null;
    for (let d = -1.5; d <= 5; d += 0.25) { if (sectionY('sidewalk', mx + nx * d, mz + nz * d, 0.05) !== null) { face = d; break; } }
    if (face === null) face = 0.6;
    const inX = mx + nx * (face - WALL.t - 1.4), inZ = mz + nz * (face - WALL.t - 1.4);
    const open = walk(inX, inZ) || walk(mx + nx * (face - WALL.t - 0.3), mz + nz * (face - WALL.t - 0.3));
    const sw = sectionY('sidewalk', mx + nx * (face + 0.4), mz + nz * (face + 0.4), 0.6);
    const street = sw ?? CP_DATUM + 0.01;
    const park = groundAt(inX, inZ);
    seg.push({ i, face, open, street, park, nx, nz, mine: mx >= ox && mx < ox + 512 && mz >= oz && mz < oz + 512 });
  }
  // a lone open segment inside a run of wall is a gap in the sampling, not a gate (and a lone wall segment in a gate
  // is a pier's worth of nothing): smooth both
  for (let i = 0; i < n; i++) {
    const a = seg[(i - 1 + n) % n], s = seg[i], b = seg[(i + 1) % n];
    if (!s || !a || !b) continue;
    if (s.open && !a.open && !b.open) s.fix = false;
    else if (!s.open && a.open && b.open) s.fix = true;
  }
  let nSeg = 0;
  for (let i = 0; i < n; i++) {
    const s = seg[i];
    if (!s || !s.mine) continue;
    const open = s.fix !== undefined ? s.fix : s.open;
    if (open) continue;
    const j = (i + 1) % n, p = R[i], q = R[j];
    const sp = seg[(i - 1 + n) % n], sn = seg[j];
    // the face offset averaged with the neighbours' at the ends, so the wall runs on without steps
    const fA = sp ? (s.face + sp.face) / 2 : s.face, fB = sn ? (s.face + sn.face) / 2 : s.face;
    const nx = s.nx, nz = s.nz;
    const top = Math.max(s.street + WALL.h, s.park + 0.45);
    const base0 = Math.min(s.street, s.park) - 0.15;
    const Ao = [p[0] + nx * fA, p[1] + nz * fA], Bo = [q[0] + nx * fB, q[1] + nz * fB];
    const Ai = [Ao[0] - nx * WALL.t, Ao[1] - nz * WALL.t], Bi = [Bo[0] - nx * WALL.t, Bo[1] - nz * WALL.t];
    const tone = 0.86 + 0.26 * hash1(i * 1.37 + 5), k = [WALL.col[0] * tone, WALL.col[1] * tone, WALL.col[2] * tone];
    // street face, park face
    quad([Ao[0], base0, Ao[1]], [Bo[0], base0, Bo[1]], [Bo[0], top, Bo[1]], [Ao[0], top, Ao[1]], [nx, 0, nz], k);
    quad([Bi[0], base0, Bi[1]], [Ai[0], base0, Ai[1]], [Ai[0], top, Ai[1]], [Bi[0], top, Bi[1]], [-nx, 0, -nz], k);
    // the peaked coping, a little proud of both faces
    const o = WALL.over, t2 = WALL.t / 2;
    const Aco = [Ao[0] + nx * o, Ao[1] + nz * o], Bco = [Bo[0] + nx * o, Bo[1] + nz * o];
    const Aci = [Ai[0] - nx * o, Ai[1] - nz * o], Bci = [Bi[0] - nx * o, Bi[1] - nz * o];
    const Ar = [Ao[0] - nx * t2, Ao[1] - nz * t2], Br = [Bo[0] - nx * t2, Bo[1] - nz * t2];
    const yc = top + 0.03, yr = top + WALL.ridge;
    const sl = Math.hypot(t2 + o, WALL.ridge - 0.03), ny = (t2 + o) / sl, nh = (WALL.ridge - 0.03) / sl;
    const kc = [k[0] * 1.08, k[1] * 1.08, k[2] * 1.08];
    quad([Aco[0], yc, Aco[1]], [Bco[0], yc, Bco[1]], [Br[0], yr, Br[1]], [Ar[0], yr, Ar[1]], [nx * nh, ny, nz * nh], kc);
    quad([Br[0], yr, Br[1]], [Bci[0], yc, Bci[1]], [Aci[0], yc, Aci[1]], [Ar[0], yr, Ar[1]], [-nx * nh, ny, -nz * nh], kc);
    // the coping's drip edges
    quad([Aco[0], top - 0.05, Aco[1]], [Bco[0], top - 0.05, Bco[1]], [Bco[0], yc, Bco[1]], [Aco[0], yc, Aco[1]], [nx, 0, nz], kc);
    quad([Bci[0], top - 0.05, Bci[1]], [Aci[0], top - 0.05, Aci[1]], [Aci[0], yc, Aci[1]], [Bci[0], yc, Bci[1]], [-nx, 0, -nz], kc);
    // an end face where the wall stops at a gate
    const endAt = (O, I, Oc, Ic, R0, sgn) => {
      const ex = (q[0] - p[0]) * sgn, ez = (q[1] - p[1]) * sgn, L = Math.hypot(ex, ez) || 1;
      quad([O[0], base0, O[1]], [I[0], base0, I[1]], [I[0], top, I[1]], [O[0], top, O[1]], [ex / L, 0, ez / L], k);
      pos.push(Oc[0], yc, Oc[1], Ic[0], yc, Ic[1], R0[0], yr, R0[1]);
      for (let m2 = 0; m2 < 3; m2++) { nor.push(ex / L, 0, ez / L); col.push(k[0], k[1], k[2]); }
    };
    const openA = sp && (sp.fix !== undefined ? sp.fix : sp.open), openB = sn && (sn.fix !== undefined ? sn.fix : sn.open);
    if (openA) endAt(Ao, Ai, Aco, Aci, Ar, -1);
    if (openB) endAt(Bo, Bi, Bco, Bci, Br, 1);
    nSeg++;
    const cx = (Ao[0] + Bo[0] + Ai[0] + Bi[0]) / 4, cz = (Ao[1] + Bo[1] + Ai[1] + Bi[1]) / 4;
    COLLIDERS.addBox(key, { x: cx, y: (base0 + top) / 2, z: cz, hw: Math.hypot(q[0] - p[0], q[1] - p[1]) / 2 + 0.02, hh: (top - base0) / 2, hd: WALL.t / 2, rotY: Math.atan2(q[1] - p[1], q[0] - p[0]) });
  }
  if (!pos.length) return;
  for (let t = 0; t < pos.length; t += 9) {
    const ax = pos[t], ay = pos[t + 1], az = pos[t + 2];
    const ux = pos[t + 3] - ax, uy = pos[t + 4] - ay, uz = pos[t + 5] - az, vx = pos[t + 6] - ax, vy = pos[t + 7] - ay, vz = pos[t + 8] - az;
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nor[t] + cy * nor[t + 1] + cz * nor[t + 2] < 0) for (let k = 0; k < 3; k++) { const s1 = pos[t + 3 + k]; pos[t + 3 + k] = pos[t + 6 + k]; pos[t + 6 + k] = s1; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, wallMat());
  m.name = 'cp32l:perimeterWall';
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  return nSeg;
}

// ---------------------------------------------------------------- the Reservoir's fence
// The 4 ft (1.22 m) steel fence with cast-iron finials that replaced the 7 ft chain link in 2003, after the 1862 design
// (a section of the original was found by divers on the bottom; Central Park Conservancy, "Reservoir"): posts every
// 2.44 m, a top and a bottom rail, pickets every 13 cm (a strip the shader cuts into bars, dithered to its coverage once
// the bars go under a pixel). It stands 1.4 m behind the water's edge, on the embankment, between the coping and the
// track. Painted the park's dark green-black.
const FENCE = { d: 1.4, h: 1.22, post: 2.44, pw: 0.07, rail: 0.045, pitch: 0.13, bar: 0.022 };
let _fenceMat = null, _picketMat = null;
function fenceMat() {
  if (_fenceMat) return _fenceMat;
  _fenceMat = applyLightTrim(new THREE.MeshStandardMaterial({ color: 0x1c231e, roughness: 0.42, metalness: 0.55 }));
  _fenceMat.name = 'cp32l:fence';
  return _fenceMat;
}
function picketMat() {
  if (_picketMat) return _picketMat;
  const m = new THREE.MeshStandardMaterial({ color: 0x1c231e, roughness: 0.42, metalness: 0.55, side: THREE.DoubleSide });
  m.name = 'cp32l:pickets';
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aRun; varying float vRun;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvRun = aRun;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vRun;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          float u = vRun / ${FENCE.pitch.toFixed(3)};
          float fw = fwidth(u);
          float cov = ${(FENCE.bar / FENCE.pitch).toFixed(3)};
          float bar = 1.0 - smoothstep(cov - fw, cov + fw, fract(u));
          // under a pixel: keep the fragment with the bars' coverage (a stable screen-space dither)
          float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          float keep = fw > 0.6 ? step(dith, cov * 1.3) : step(0.5, bar);
          if (keep < 0.5) discard;
        }`);
  };
  m.customProgramCacheKey = () => 'cp32l-pickets-1';
  applyLightTrim(m);
  _picketMat = m;
  return m;
}
function buildFence(group, b, ox, oz) {
  if (b.kind !== 'reservoir') return;
  const R = b.outer, n = R.length;
  const P = [], N = [], S = [], SR = [];
  const box = (cx, y0, cz, hx, hy, hz, ux, uz) => {
    // an oriented box: half sizes hx along (ux, uz), hz across, hy up
    const vx = -uz, vz = ux;
    const c = [];
    for (const sy of [-1, 1]) for (const sa of [-1, 1]) for (const sb of [-1, 1]) c.push([cx + ux * hx * sa + vx * hz * sb, y0 + hy + hy * sy, cz + uz * hx * sa + vz * hz * sb]);
    // faces: -a, +a, -b, +b, top
    const F = [[0, 1, 5, 4, [-vx, 0, -vz]], [2, 3, 7, 6, [vx, 0, vz]], [0, 2, 6, 4, [-ux, 0, -uz]], [1, 3, 7, 5, [ux, 0, uz]], [4, 5, 7, 6, [0, 1, 0]]];
    for (const [a, bb, cc, d, nn] of F) for (const k of [a, bb, cc, a, cc, d]) { P.push(...c[k]); N.push(...nn); }
  };
  let run = 0;
  for (let i = 0; i < n; i++) {
    const p = R[i], q = R[(i + 1) % n];
    const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1, ux = ex / L, uz = ez / L, nx = uz, nz = -ux;
    const mx = (p[0] + q[0]) / 2, mz = (p[1] + q[1]) / 2;
    const mine = mx >= ox && mx < ox + 512 && mz >= oz && mz < oz + 512;
    const run0 = run;
    run += L;
    if (!mine) continue;
    const A = [p[0] + nx * FENCE.d, p[1] + nz * FENCE.d], B = [q[0] + nx * FENCE.d, q[1] + nz * FENCE.d];
    const yA = groundAt(A[0], A[1]), yB = groundAt(B[0], B[1]);
    // rails (top and bottom) along the segment
    const cx = (A[0] + B[0]) / 2, cz = (A[1] + B[1]) / 2, yM = (yA + yB) / 2;
    box(cx, yM + FENCE.h - 0.12 - FENCE.rail / 2, cz, L / 2, FENCE.rail / 2, FENCE.rail / 2, ux, uz);
    box(cx, yM + 0.10, cz, L / 2, FENCE.rail / 2, FENCE.rail / 2, ux, uz);
    // posts every 2.44 m of run, each with a finial
    for (let s = Math.ceil(run0 / FENCE.post) * FENCE.post; s < run; s += FENCE.post) {
      const t = (s - run0) / L, x = A[0] + (B[0] - A[0]) * t, z = A[1] + (B[1] - A[1]) * t, y = yA + (yB - yA) * t;
      box(x, y - 0.1, z, FENCE.pw / 2, (FENCE.h + 0.1) / 2, FENCE.pw / 2, ux, uz);
      box(x, y + FENCE.h, z, 0.05, 0.03, 0.05, ux, uz);
      // the finial: a four-sided point
      const tip = [x, y + FENCE.h + 0.2, z], cs = [[0.04, 0.04], [0.04, -0.04], [-0.04, -0.04], [-0.04, 0.04]].map(([a, bq]) => [x + ux * a - uz * bq, y + FENCE.h + 0.06, z + uz * a + ux * bq]);
      for (let k = 0; k < 4; k++) { const c0 = cs[k], c1 = cs[(k + 1) % 4]; P.push(...c0, ...c1, ...tip); const nn = [(c0[0] + c1[0]) / 2 - x, 0.6, (c0[2] + c1[2]) / 2 - z]; for (let m2 = 0; m2 < 3; m2++) N.push(...nn); }
    }
    // the picket strip between the rails
    const y0A = yA + 0.12, y1A = yA + FENCE.h - 0.12, y0B = yB + 0.12, y1B = yB + FENCE.h - 0.12;
    for (const v of [[A[0], y0A, A[1], run0], [B[0], y0B, B[1], run], [B[0], y1B, B[1], run], [A[0], y0A, A[1], run0], [B[0], y1B, B[1], run], [A[0], y1A, A[1], run0]]) { S.push(v[0], v[1], v[2]); SR.push(v[3]); }
  }
  if (P.length) {
    // wind to the normals
    for (let t = 0; t < P.length; t += 9) {
      const ux = P[t + 3] - P[t], uy = P[t + 4] - P[t + 1], uz = P[t + 5] - P[t + 2], vx = P[t + 6] - P[t], vy = P[t + 7] - P[t + 1], vz = P[t + 8] - P[t + 2];
      if ((uy * vz - uz * vy) * N[t] + (uz * vx - ux * vz) * N[t + 1] + (ux * vy - uy * vx) * N[t + 2] < 0) for (let k = 0; k < 3; k++) { const s1 = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = s1; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, fenceMat());
    m.name = 'cp32l:reservoirFence';
    m.castShadow = true; m.receiveShadow = true;
    group.add(m);
  }
  if (S.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(S, 3));
    g.setAttribute('aRun', new THREE.Float32BufferAttribute(SR, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, picketMat());
    m.name = 'cp32l:reservoirPickets';
    m.castShadow = false; m.receiveShadow = true;
    group.add(m);
  }
}

// ---------------------------------------------------------------- shore boulders
// The Lake's and the ponds' naturalistic banks are edged with schist boulders half in the water, in runs and clusters
// (the Pond under Gapstow Bridge rockiest). Along every natural shore (not the hard edges, not within 6 m of a bridge
// or the Boathouse's landing), a run every 1.6-5 m on a hash of the arc length, the rockier the steeper the bank;
// each boulder a squashed, knobbed icosahedron 0.35-1.3 m across, sunk a third into the bank and the water, merged per
// tile with the outcrops' schist.
const BRIDGES = [[-233, 1789, -210, 1805], [-62, 796, -34, 836], [-47, 479, -32, 497], [-115, 485, -96, 505], [1005, -1300, 1023, -1273], [1299, -1419, 1317, -1403], [1097, -1186, 1111, -1163], [1378, -1460, 1434, -1424], [1419, -1545, 1429, -1530], [1542, -1544, 1607, -1522], [-189, 410, -153, 451]];
const nearBridge = (x, z) => BRIDGES.some((B) => x > B[0] - 6 && x < B[2] + 6 && z > B[1] - 6 && z < B[3] + 6);
// CP33: city/cpRocks.js builds on this part's ground, water and carve-outs
cpRocksInit({
  groundAt, levelOf, bodies: BODIES, hard: HARD, hardMask, nearBridge, hash1, reliefReady: cpReliefReady,
  rockCut: ROCK_CUT.map((C) => ({ bb: C.bb, poly: C.poly, pad: C.pad,
    floor: (x, z) => (C.lawn ? lawnY(C.lawn[0], C.lawn[1]) + 0.02 : cpReliefReady() ? cpDemToWorld(C.dem, x, z) : CP_DATUM) })),
  inWater: (x, z) => cpWaterY(x, z, 0.05) !== null,
});
let _ico = null;
function icoBase() {
  if (_ico) return _ico;
  const g = new THREE.IcosahedronGeometry(1, 1).toNonIndexed();
  _ico = g.attributes.position.array.slice();
  return _ico;
}
function buildBoulders(group, ox, oz) {
  const base = icoBase(), out = [];
  for (const b of BODIES) {
    if (b.kind !== 'lake') continue;
    if (b.box[0] > ox + 512 || b.box[2] < ox || b.box[1] > oz + 512 || b.box[3] < oz) continue;
    const rockiness = b.k === 'pond' ? 0.75 : b.k === 'lake' ? 0.5 : b.k === 'turtle' ? 0.45 : 0.35;
    for (const [ri, R] of [b.outer, ...b.holes].entries()) {
      const bw = ri === 0 ? b.bw : b.hbw[ri - 1] || [];
      const n = R.length;
      let run = 0;
      for (let i = 0; i < n; i++) {
        const p = R[i], q = R[(i + 1) % n];
        const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1, ux = ex / L, uz = ez / L, nx = uz, nz = -ux;
        const run0 = run;
        run += L;
        // candidate spots every 0.8 m of shore
        for (let s = Math.ceil(run0 / 0.8) * 0.8; s < run; s += 0.8) {
          const h0 = hash1(s * 1.73 + b.id % 911 + ri * 13.1);
          const w = bw[i] ?? 3;
          // steep banks (a path close) are rockier; runs come and go along the shore
          const runOn = vnoise2(s * 0.07 + b.id % 97, ri * 3.3) * 0.9 + (w < 2 ? 0.35 : 0);
          if (runOn < 1 - rockiness || h0 > 0.32) continue;
          const t = (s - run0) / L, x0 = p[0] + ex * t, z0 = p[1] + ez * t;
          if (x0 < ox || x0 >= ox + 512 || z0 < oz || z0 >= oz + 512) continue;
          if (HARD.length && hardMask(x0, z0) > 0.01) continue;
          if (nearBridge(x0, z0)) continue;
          const h1 = hash1(s * 3.11 + 7.7), h2 = hash1(s * 5.37 + 2.2), h3 = hash1(s * 9.91 + 4.4);
          const size = (0.35 + 0.95 * h1 * h1) * (0.8 + 0.4 * rockiness);
          const off = (h2 - 0.45) * 1.2;   // a little into the water or up the bank
          const x = x0 + nx * off, z = z0 + nz * off;
          const L0 = levelOf(b, x, z), gy = Math.max(groundAt(x, z), L0 - 0.3);
          const sx = size * (0.8 + 0.5 * h2), sy = size * (0.45 + 0.3 * h3), sz = size * (0.8 + 0.5 * h3);
          const yaw = h1 * 6.283, cy = Math.cos(yaw), sy2 = Math.sin(yaw);
          const yc = gy + sy * 0.25;
          // CPB33 (the owner's review of teaser 4: "low-poly blobs"): schist breaks along its foliation and its joints, so
          // each boulder is the rounded core cut by a tilted top and bottom (the foliation) and three or four near-vertical
          // joint planes: flat cleaved faces meeting at sharp edges, a slab more than a ball
          const planes = [];
          if (CPBANK) {
            const tx = (h2 - 0.5) * 0.55, tz = (h3 - 0.5) * 0.55, tl = Math.hypot(tx, 1, tz);
            planes.push([tx / tl, 1 / tl, tz / tl, 0.42 + 0.25 * h1], [-tx / tl, -1 / tl, -tz / tl, 0.5 + 0.2 * h2]);
            const nj = 3 + (h3 > 0.5 ? 1 : 0);
            for (let j = 0; j < nj; j++) {
              const a = j * (6.283 / nj) + (hash1(s * 7.1 + j) - 0.5) * 1.1, py = (hash1(s * 2.9 + j) - 0.5) * 0.35, pl = Math.hypot(1, py);
              planes.push([Math.cos(a) / pl, py / pl, Math.sin(a) / pl, 0.6 + 0.28 * hash1(s * 4.3 + j)]);
            }
          }
          for (let k = 0; k < base.length; k += 3) {
            let vx = base[k], vy = base[k + 1], vz = base[k + 2];
            const kn = 1 + (vnoise2(vx * 2.1 + s, vz * 2.1 + vy * 1.7) - 0.5) * (CPBANK ? 0.16 : 0.45);
            for (const [px, py, pz, pd] of planes) { const tq = vx * px + vy * py + vz * pz - pd; if (tq > 0) { vx -= tq * px; vy -= tq * py; vz -= tq * pz; } }
            vx *= sx * kn; vy *= sy * kn; vz *= sz * kn;
            if (vy < 0) vy *= 0.6;   // flatter below
            out.push(x + vx * cy - vz * sy2, yc + vy, z + vx * sy2 + vz * cy);
          }
        }
      }
    }
  }
  if (!out.length) return 0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, rockMat());
  m.name = 'cp32l:boulders';
  m.castShadow = true; m.receiveShadow = true;
  group.add(m);
  return out.length / 3 / 80;
}

// ---------------------------------------------------------------- the waterline's plantings
// The Conservancy's naturalistic shores are planted to the water: tussock sedge, switchgrass, blue flag, soft rush, the
// odd buttonbush (Central Park Conservancy, the Lake's shoreline restorations). Clumps of tall blades along the natural
// shores between the boulders, 0.5-1.3 m, each four crossed quads the shader cuts into tapering, curving blades (their
// coverage dithered once the blades go under a pixel), swaying with the wind clock; late-September greens going straw.
let _reedMat = null;
function reedMat() {
  if (_reedMat) return _reedMat;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.8, metalness: 0, side: THREE.DoubleSide });
  m.name = 'cp32l:reeds';
  m.onBeforeCompile = (sh) => {
    sh.uniforms.rdWind = ENV.windT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRd; varying vec3 vRd; uniform float rdWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRd = aRd;
        {
          // the tops sway: a slow swell and a quicker flutter, stronger up the blade
          float sw = aRd.y * aRd.y;
          transformed.x += sw * (0.10 * sin(rdWind * 1.3 + position.x * 0.35 + position.z * 0.2) + 0.03 * sin(rdWind * 4.1 + position.z * 1.7));
          transformed.z += sw * (0.08 * cos(rdWind * 1.1 + position.z * 0.3) + 0.03 * sin(rdWind * 3.7 + position.x * 1.9));
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vRd;
        float rdH(float n) { return fract(sin(n * 91.3458) * 47453.5453); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          // 7 blades across the quad, each leaning and curving its own way, narrowing to a point
          float u = vRd.x, v = vRd.y, cov = 0.0;
          float fw = fwidth(u) + 1e-4;
          for (int i = 0; i < 7; i++) {
            float fi = float(i);
            float r1 = rdH(fi + vRd.z * 13.1), r2 = rdH(fi * 1.7 + vRd.z * 7.3), r3 = rdH(fi * 2.3 + vRd.z * 3.9);
            float top = 0.55 + 0.45 * r3;
            if (v > top) continue;
            float c = (fi + 0.5) / 7.0 + (r1 - 0.5) * 0.12 + (r2 - 0.5) * 0.5 * (v / top) * (v / top);
            float w = 0.032 * (1.0 - v / top) + 0.004;
            cov = max(cov, 1.0 - smoothstep(w - fw, w + fw, abs(u - c)));
          }
          float dith = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
          if (cov < 0.5 * (fw > 0.05 ? dith * 2.0 : 1.0)) discard;
        }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(0.0, 0.5, vRd.y));   // the bases in their own shade`)
      // lit from above on both faces (DoubleSide would turn the back faces' up normal down)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(vNormal);`);
  };
  m.customProgramCacheKey = () => 'cp32l-reeds-1';
  applyLightTrim(m);
  _reedMat = m;
  return m;
}
// per body: the stand threshold (lower = more of the shore planted), the share of spots taken, base and extra height
const RDENS = { lake: [0.52, 0.55, 0.5, 0.8], turtle: [0.22, 0.85, 0.8, 0.9], pond: [0.64, 0.45, 0.5, 0.7], meer: [0.45, 0.6, 0.6, 0.8], pool: [0.4, 0.6, 0.6, 0.8], azalea: [0.3, 0.7, 0.5, 0.6], meerinlet: [0.35, 0.7, 0.6, 0.8] };
function buildReeds(group, ox, oz) {
  const P = [], C = [], A = [];
  let n = 0;
  for (const b of BODIES) {
    if (b.kind !== 'lake' || b.k === 'reservoir') continue;
    if (b.box[0] > ox + 512 || b.box[2] < ox || b.box[1] > oz + 512 || b.box[3] < oz) continue;
    for (const [ri, R] of [b.outer, ...b.holes].entries()) {
      const bw = ri === 0 ? b.bw : b.hbw[ri - 1] || [];
      let run = 0;
      for (let i = 0; i < R.length; i++) {
        const p = R[i], q = R[(i + 1) % R.length];
        const ex = q[0] - p[0], ez = q[1] - p[1], L = Math.hypot(ex, ez) || 1, nx = ez / L, nz = -ex / L;
        const run0 = run;
        run += L;
        for (let s = Math.ceil(run0 / 1.1) * 1.1; s < run; s += 1.1) {
          const h0 = hash1(s * 2.71 + b.id % 577 + ri * 5.3);
          // stands of plantings come and go along the shore (a lawn mown to the water between them)
          const stand = vnoise2(s * 0.045 + 31 + b.id % 53, ri * 2.1);
          // Turtle Pond's shore is one long band of the Conservancy's meadow plantings (photographs); the Pond is rocky
          const RD = RDENS[b.k] || RDENS.lake;
          if (stand < RD[0] || h0 > RD[1] || (bw[i] ?? 3) < 1.0) continue;
          const t = (s - run0) / L, x0 = p[0] + ex * t, z0 = p[1] + ez * t;
          if (x0 < ox || x0 >= ox + 512 || z0 < oz || z0 >= oz + 512) continue;
          if (HARD.length && hardMask(x0, z0) > 0.01) continue;
          if (nearBridge(x0, z0)) continue;
          const h1 = hash1(s * 4.13 + 1.1), h2 = hash1(s * 6.77 + 3.3), h3 = hash1(s * 8.21 + 5.5);
          const off = -0.2 + h1 * 0.9;   // from just in the water to up the bank
          const x = x0 + nx * off, z = z0 + nz * off;
          if (CPR33 && !cpRocksClear(x, z)) continue;   // CP34: not through one of cpRocks.js's boulders
          const L0 = levelOf(b, x, z), gy = Math.max(groundAt(x, z), L0 - 0.15);
          const H = RD[2] + RD[3] * h2 * h2, Wd = 0.5 + 0.5 * h3;
          // late September: greens with straw coming in, the rushes darker
          const tone = h3 < 0.3 ? [0.30, 0.34, 0.14] : h3 < 0.7 ? [0.22, 0.30, 0.10] : [0.38, 0.35, 0.18];
          const seed = (s * 0.37 + b.id) % 97;
          for (let k = 0; k < 4; k++) {
            const a = (k / 4) * Math.PI + h1 * 3.1, cx = Math.cos(a) * Wd * 0.5, cz = Math.sin(a) * Wd * 0.5;
            const v0 = [x - cx, gy - 0.05, z - cz], v1 = [x + cx, gy - 0.05, z + cz], v2 = [x + cx, gy + H, z + cz], v3 = [x - cx, gy + H, z - cz];
            for (const [v, uv] of [[v0, [0, 0]], [v1, [1, 0]], [v2, [1, 1]], [v0, [0, 0]], [v2, [1, 1]], [v3, [0, 1]]]) {
              P.push(v[0], v[1], v[2]); C.push(...tone); A.push(uv[0], uv[1], seed + k * 0.37);
            }
          }
          n++;
        }
      }
    }
  }
  if (!P.length) return 0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setAttribute('aRd', new THREE.Float32BufferAttribute(A, 3));
  // the blades take the sky's light from above, not the quad's own facing
  const N = new Float32Array(P.length);
  for (let i = 1; i < N.length; i += 3) N[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, reedMat());
  m.name = 'cp32l:reeds';
  m.castShadow = false; m.receiveShadow = true;
  group.add(m);
  return n;
}

export function build(group, ctx) {
  if (!CP32L) return;
  const { ox, oz, key } = ctx;
  for (const b of BODIES) {
    if (b.box[0] > ox + 512 || b.box[2] < ox || b.box[1] > oz + 512 || b.box[3] < oz) continue;
    const L = surfOf(b).get(key);
    if (!L || !L.length) continue;
    const nv = L.length / 2, pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) {
      const x = L[v * 2], z = L[v * 2 + 1];
      pos[v * 3] = x; pos[v * 3 + 1] = levelOf(b, x, z); pos[v * 3 + 2] = z;
      nor[v * 3 + 1] = 1;
    }
    // earcut winds the ring's triangles either way: face them all up
    for (let t = 0; t < nv; t += 3) {
      const ax = pos[t * 3], az = pos[t * 3 + 2], bx = pos[t * 3 + 3], bz = pos[t * 3 + 5], cx = pos[t * 3 + 6], cz = pos[t * 3 + 8];
      if ((bx - ax) * (cz - az) - (cx - ax) * (bz - az) > 0) {
        for (let k = 0; k < 3; k++) { const s = pos[t * 3 + 3 + k]; pos[t * 3 + 3 + k] = pos[t * 3 + 6 + k]; pos[t * 3 + 6 + k] = s; }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.computeBoundingSphere();
    const mesh = new THREE.Mesh(g, waterMat(b));
    mesh.name = 'cp32l:water:' + b.k;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    WATER_MESHES.add(mesh);
    g.addEventListener('dispose', () => WATER_MESHES.delete(mesh));
    hookProbe(mesh, b);
    group.add(mesh);
  }
  const copeAcc = { pos: [], nor: [], col: [] };
  for (const b of BODIES) {
    if (b.box[0] > ox + 512 || b.box[2] < ox || b.box[1] > oz + 512 || b.box[3] < oz) continue;
    try { buildCoping(copeAcc, b, ox, oz, ctx); } catch (e) { console.warn('[cp32l] coping', b.k, e); }
    try { buildFence(group, b, ox, oz); } catch (e) { console.warn('[cp32l] fence', b.k, e); }
  }
  try { flushCoping(group, copeAcc); } catch (e) { console.warn('[cp32l] copings', e); }
  // the extensions' water (1 cm under the body's own, where they overlap), from the tile holding each one's centre
  for (const X of WATER_EXT) {
    const cx = (X.q[0][0] + X.q[1][0] + X.q[2][0] + X.q[3][0]) / 4, cz = (X.q[0][1] + X.q[1][1] + X.q[2][1] + X.q[3][1]) / 4;
    if (cx < ox || cx >= ox + 512 || cz < oz || cz >= oz + 512) continue;
    const b = BY_KEY.get(X.k);
    if (!b) continue;
    const P = [];
    for (const [x, z] of [X.q[0], X.q[1], X.q[2], X.q[0], X.q[2], X.q[3]]) P.push(x, levelOf(b, x, z) - 0.01, z);
    for (let t = 0; t < P.length; t += 9) {
      const ax = P[t], az = P[t + 2], bx = P[t + 3], bz = P[t + 5], ex = P[t + 6], ez = P[t + 8];
      if ((bx - ax) * (ez - az) - (ex - ax) * (bz - az) > 0) for (let k = 0; k < 3; k++) { const s1 = P[t + 3 + k]; P[t + 3 + k] = P[t + 6 + k]; P[t + 6 + k] = s1; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, waterMat(b));
    m.name = 'cp32l:water:' + b.k + ':ext';
    m.receiveShadow = true;
    WATER_MESHES.add(m);
    g.addEventListener('dispose', () => WATER_MESHES.delete(m));
    group.add(m);
  }
  // CP33: city/cpRocks.js builds the tile's outcrops and boulders (all but Vista Rock); the CP32 ones only where it did not
  let rk33 = false;
  // (CP34: with the tile's own surface sampler, so the boulders sit on the ground as drawn, not on groundAt's curve)
  try { rk33 = cpRocksBuild(group, { ox, oz, key, surfY: ctx.surfY }); } catch (e) { console.warn('[cpr33] rocks', e); }
  if (!rk33) try { buildBoulders(group, ox, oz); } catch (e) { console.warn('[cp32l] boulders', e); }
  try { buildReeds(group, ox, oz); } catch (e) { console.warn('[cp32l] reeds', e); }
  try { buildRocks(group, ox, oz, key, rk33); } catch (e) { console.warn('[cp32l] outcrops', e); }
  try { buildWall(group, ctx); } catch (e) { console.warn('[cp32l] perimeter wall', e); }
}

// compiled furniture standing in the water (the compiler's park trees and lamps scattered over the lakes)
export function dropFurniture(wx, wz, f) {
  if (!CP32L) return false;
  if (cpWaterY(wx, wz, -0.4) !== null) return true;
  // the compiler's scattered park trees on an outcrop (a census street tree, p2 & 1, stays)
  return f.k === 1 && !(f.p2 & 1) && cpRockTop(wx, wz) !== null;
}
