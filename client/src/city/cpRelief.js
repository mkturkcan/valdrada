// CP32 relief (lead): the city is compiled on a flat datum (terrain 3.24, lawn 3.51, paths 3.54, asphalt 3.38), so the
// compiled park had none of its ground: the Lake's valley, Bethesda's two levels, Vista Rock, the Great Hill. The park's
// relief is put back here from the USGS 3DEP ground the compiler sampled (data/raw/park_elev_1.json, 14 m points): the
// ground's height over a smooth surface spanning the park's perimeter, so the park's edge stays at the city's datum and
// the relief inside it is the real one (the Lake about 8 m under the Fifth Avenue and Central Park West kerbs, the
// Reservoir's plateau about 7 m over them).
//   cpRelief(x, z): metres to add to the flat datum at world (x, z) (0 outside the park)
//   cpDem(x, z): the 3DEP ground itself (NAVD88 metres), for levels quoted from surveys
//   cpDemToWorld(h, x, z): a 3DEP level (a lake's surface, a terrace) as a world y at (x, z)
// The grid is baked by client/tools/cp/relief_bake.py into cpReliefData.js (14 m, int16 cm); city/centralPark.js
// re-heights the park's ground sections, terrain grid and road lines with it before any part's apply() runs.
// `?cp32r=0` keeps the park flat (cpRelief returns 0 everywhere).
import { CP_RELIEF } from './cpReliefData.js';
import { HA_P1, haInfo, haInfoIn, haS } from '../world/heightAuthority.js';   // P1 TERRAIN (`?terrain=p1`)
import { haProfile, haWorldAny, haAnchorsReady } from '../world/haAnchor.js';   // P1B: the decks' class-17 levels
export const CP_DATUM = 3.51;   // the flat compile's lawn level
const CP32R = !(typeof location !== 'undefined' && (new URLSearchParams(location.search).get('cp32r') === '0' || new URLSearchParams(location.search).get('cp32') === '0'));
const dec = (b64) => {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(u8.buffer), f = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 100;
  return f;
};
let GRID = CP32R ? { x0: CP_RELIEF.x0, z0: CP_RELIEF.z0, step: CP_RELIEF.step, nx: CP_RELIEF.nx, nz: CP_RELIEF.nz, rel: dec(CP_RELIEF.rel), dem: dec(CP_RELIEF.dem) } : null;
// the grid's box (world x0, z0, x1, z1): outside it the relief is 0
export const CP_RELIEF_BOX = [CP_RELIEF.x0, CP_RELIEF.z0, CP_RELIEF.x0 + (CP_RELIEF.nx - 1) * CP_RELIEF.step, CP_RELIEF.z0 + (CP_RELIEF.nz - 1) * CP_RELIEF.step];
// piecewise linear on the grid's triangles (each cell split along its (i, j)-(i+1, j+1) diagonal), not bilinear: the
// ground laid on it (centralPark.js) is cut along the same lines, so every piece is flat on one patch and two sections
// meeting along a line meet on the same line in 3D, whatever their vertices (a bilinear cell bends each side's
// straight edge differently between its own vertices and opens cracks at every path's edge)
const bil = (a, x, z) => {
  if (!GRID) return 0;
  const fx = (x - GRID.x0) / GRID.step, fz = (z - GRID.z0) / GRID.step;
  if (fx < 0 || fz < 0 || fx > GRID.nx - 1.001 || fz > GRID.nz - 1.001) return 0;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = GRID.nx;
  const a00 = a[j * n + i], a11 = a[(j + 1) * n + i + 1];
  return u >= v ? a00 + (a[j * n + i + 1] - a00) * u + (a11 - a[j * n + i + 1]) * v : a00 + (a[(j + 1) * n + i] - a00) * v + (a11 - a[(j + 1) * n + i]) * u;
};
// P1 TERRAIN (`?terrain=p1`, world/heightAuthority.js): the authority's ground is the park's ground. The relief is the
// authority's (the flat lawn 3.51 lifted by it: the park's lawn), the bare earth its grade + S + the 0.135 m reveal, a
// surveyed level maps through S; the park's sections are lifted by the authority's cut, not by reliefApply
// (centralPark.js). cpHaTile(tx, tz): the tile being applied or built, whose chunk answers just past its edge; where
// the authority has nothing loaded the 3DEP grid stands in.
let HAT = null;
export const cpHaTile = (tx, tz) => { HAT = tx === null ? null : [tx, tz]; };
const haRel = (x, z) => {
  let q = haInfo(x, z);
  if (!q && HAT) q = haInfoIn(x, z, HAT[0], HAT[1]);
  return q && q.tag < 3 ? q.relief : null;
};
const sOf = (x, z) => { const s = haS(x, z); return s === null ? 2.263 : s; };
// (where the authority's chunk is not in: the 3DEP ground through S, the authority's own mapping of a bare-earth level)
const relOf = (x, z) => { if (HA_P1) { const r = haRel(x, z); if (r !== null) return r; return GRID ? bil(GRID.dem, x, z) - 0.135 - sOf(x, z) : 0; } return GRID ? bil(GRID.rel, x, z) : 0; };
export const cpRelief = (x, z) => (HA_P1 ? relOf(x, z) : GRID ? bil(GRID.rel, x, z) : 0);
export const cpDem = (x, z) => (HA_P1 ? relOf(x, z) + sOf(x, z) + 0.135 : GRID ? bil(GRID.dem, x, z) : null);
export const cpDemToWorld = (h, x, z) => (HA_P1 ? CP_DATUM - 0.135 + h - sOf(x, z) : GRID ? CP_DATUM + cpRelief(x, z) + (h - bil(GRID.dem, x, z)) : CP_DATUM);
export const cpReliefReady = () => !!GRID;
// The bridges' decks (the bake's header): 3DEP is bare earth, so a drive or path on a bridge followed the ground down into
// the valley or the Lake. Each deck line carries its own relief, straight between its approaches' shoulders; this is that
// relief at (x, z) within the deck's half width of its line (the highest where decks meet), or null off every deck.
let DI = 0;
const DECKS = GRID ? (CP_RELIEF.decks || []).map((d) => {
  const P = d.pts, bb = [1e9, 1e9, -1e9, -1e9];
  for (let k = 0; k < P.length; k += 3) { bb[0] = Math.min(bb[0], P[k] - d.hw); bb[1] = Math.min(bb[1], P[k + 1] - d.hw); bb[2] = Math.max(bb[2], P[k] + d.hw); bb[3] = Math.max(bb[3], P[k + 1] + d.hw); }
  // (P1: the deck's stations along its line, for the authority's version: straight between its two shoulders)
  const S = [0];
  for (let k = 3; k < P.length; k += 3) S.push(S[S.length - 1] + Math.hypot(P[k] - P[k - 3], P[k + 1] - P[k - 2]));
  return { hw2: d.hw * d.hw, P, bb, S, ends: null, i: DI++ };
}) : [];
// P1: a deck's relief at its two shoulders (its line's ends) on the authority's ground, once both are in
const deckEnds = (d) => {
  if (d.ends) return d.ends;
  const n = d.P.length, a = haRel(d.P[0], d.P[1]), b = haRel(d.P[n - 3], d.P[n - 2]);
  if (a === null || b === null) return null;
  return (d.ends = [a, b]);
};
// P1B second pass: a deck's own level from the LiDAR's class 17 along its line where it has it (anchors.json cpdeck_<i>,
// tools/terrain/anchor_alignments.mjs + p2b_profiles.py: the arches' and the bridges' decks), from the authority's ground
// at an unmeasured end to the first measured station; with no class 17 at all, straight between the two shoulders as
// before. A deck's two ends meeting another deck (a path onto a drive's arch) take that deck's measured level the same way
// (the bare earth under a deck is the ground beneath it, not the deck). Per deck, once: { s, r } (relief at station s).
const deckProf = (d, i) => {
  if (d.prof !== undefined) return d.prof;
  if (!haAnchorsReady()) return null;
  const P = haProfile(`cpdeck_${i}`), E = deckEnds(d);
  if (!E) return null;
  if (!P || !P.measured.some((m) => m)) return (d.prof = false);
  const n = P.s.length, L = d.S[d.S.length - 1] || 1;
  const first = P.measured.indexOf(1), last = P.measured.lastIndexOf(1);
  const lid = (k) => haWorldAny(P.deck[k], P.x[k], P.z[k]) - CP_DATUM;
  const r = new Array(n);
  for (let k = 0; k < n; k++) {
    if (k >= first && k <= last) r[k] = lid(k);
    else if (k < first) { const t = P.s[first] > 0 ? P.s[k] / P.s[first] : 1; r[k] = E[0] + (lid(first) - E[0]) * t; }
    else { const t = L > P.s[last] ? (P.s[k] - P.s[last]) / (L - P.s[last]) : 1; r[k] = lid(last) + (E[1] - lid(last)) * Math.min(1, t); }
  }
  return (d.prof = { s: P.s, r, m: P.s.map((_, k) => k >= first && k <= last) });
};
// is station s within the deck's measured span?
const profMeasured = (pr, s) => s >= pr.s[pr.m.indexOf(true)] && s <= pr.s[pr.m.lastIndexOf(true)];
// (an unmeasured stretch of a deck line, an approach the bake carried to its shoulder, is ground where it runs within a
// metre of it: it hugs the bare earth there and takes its own line only where that stands 1.5 m and more over it, the
// span; a corridor carried flat 0.2-0.5 m over the approach's ground left steps along its edges)
const hug = (r, g) => (g === null || r <= g ? r : g + (r - g) * (() => { const u = Math.min(1, Math.max(0, (r - g - 0.6) / 0.9)); return u * u * (3 - 2 * u); })());
const profAt = (pr, s) => {
  const S = pr.s, n = S.length;
  if (s <= S[0]) return pr.r[0];
  if (s >= S[n - 1]) return pr.r[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  return pr.r[lo] + ((pr.r[lo + 1] - pr.r[lo]) * (s - S[lo])) / Math.max(1e-9, S[lo + 1] - S[lo]);
};
export const cpDecks = () => DECKS;
export function cpBridgeRelief(x, z, skip = null) {
  let best = null, lo = null, near = null, nearD = Infinity, bestM = null;
  for (const d of DECKS) {
    if (skip && skip.has(d.i)) continue;   // (TERRAIN INT2: the decks the drives run along, cpDrives.js)
    if (x < d.bb[0] || x > d.bb[2] || z < d.bb[1] || z > d.bb[3]) continue;
    const P = d.P;
    for (let k = 0; k + 5 < P.length; k += 3) {
      const ax = P[k], az = P[k + 1], dx = P[k + 3] - ax, dz = P[k + 4] - az, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const ex = x - ax - dx * t, ez = z - az - dz * t;
      if (ex * ex + ez * ez > d.hw2) continue;
      let r = P[k + 2] + (P[k + 5] - P[k + 2]) * t, measHere = false;
      // (P1: straight between the authority's ground at its two shoulders; until both are in, its 3DEP level through S)
      if (HA_P1) {
        const E = deckEnds(d), L = d.S[d.S.length - 1] || 1, sd = d.S[k / 3] + (d.S[k / 3 + 1] - d.S[k / 3]) * t, pr = deckProf(d, d.i);
        const meas = pr ? profMeasured(pr, sd) : false;
        measHere = meas;
        r = pr ? profAt(pr, sd) : E ? E[0] + (E[1] - E[0]) * (sd / L)
          : CP_DATUM - 0.135 + (r - bil(GRID.rel, x, z) + bil(GRID.dem, x, z)) - sOf(x, z) - CP_DATUM;
        // (never under the ground: a deck line's approach on a rise the 3DEP line passed over; off the measured span it
        // hugs the ground, above)
        const g = haRel(x, z);
        if (g !== null && g > r) r = g;
        else if (!meas) r = hug(r, g);
      }
      if (best === null || r > best) best = r;
      if (lo === null || r < lo) lo = r;
      if (HA_P1 && measHere && (bestM === null || r > bestM)) bestM = r;
      const nd = Math.sqrt((ex * ex + ez * ez) / d.hw2);
      if (nd < nearD) { nearD = nd; near = r; }
    }
  }
  // (P1B: two deck lines over one point more than 2 m apart are stacked, a path through an arch under the drive it carries:
  // the point is the line's it lies nearer to, for its half width; decks that meet, at about one level, the highest)
  if (HA_P1 && best !== null && best - lo > 2.0) return near;
  // (decks that meet: a deck the LiDAR measured there over one interpolated between its shoulders)
  if (HA_P1 && bestM !== null) return bestM;
  return best;
}
export function cpSetReliefGrid(g) { GRID = g; }
