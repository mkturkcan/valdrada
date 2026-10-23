// CP34 Belvedere Castle, its terrace and Vista Rock (owner 2026-10-01 after teaser 4: "the castle looks terrible like minecraft -
// this is a UE5 level project"; CP33 before it: "nothing looks flat low poly"). city/cpLandmarks.js calls buildCastleB() instead
// of the CP32 buildBelvedere (cpLandmarksKit.js), which stays behind `?cpc33=0`. The plan is OSM's (building parts 1317000448-58,
// Vista Rock way 387216152) in the castle frame: u along (0.8716, 0.4903) = the park's east, w along (-0.4903, 0.8716) = its
// south, origin (196.66, 418.45); the elevations are measured off the photographs from Turtle Pond (refs/cp33/castle/,
// docs/notes/cp34-castle.md), on the published floor, 130 ft (39.6 m NAVD88):
//   * the keep (three storeys: round-arched windows, paired lights, string courses, a plain parapet on a corbel table, the
//     timber lookout on its roof), the round turret at its south-east corner (the highest part: string courses, slit windows,
//     a corbelled cornice, the slate cone with two stone dormers and their oculi, the flag), the wing west of it (four
//     round-arched windows over the pond, two arches onto the terrace, an arcaded parapet, corbelled bartizans); every wall
//     over the pond battered down onto the rock;
//   * the terrace west of the wing along the cliff (the bastion's curve, the pavilions' platform on the cliff's edge), battered
//     retaining walls with stepped piers, coped parapets, square flags, lamps and benches; the open pavilion (polychrome posts
//     and fretwork, a hipped roof in banded slates), the timber lookout tower at its west end, the second pavilion;
//   * Vista Rock: the macro field falls from the walls' feet to Turtle Pond; city/cpVista.js puts the fracture on it.
// Near level within CASTLE.NEAR m (every stone), far level beyond (the same massing in plain faces).
import * as THREE from 'three';
import { CBin, castleMat, plainMat, flatWall, roundWall, rubble, moulding, archRing, reveal, K, shade, nrm3, rng, fbm, vn, polyDist } from './cpCastleKit.js';
import { CP_DATUM, cpRelief, cpDemToWorld, cpReliefReady } from './cpRelief.js';
import { ROCKS, WATER } from './cpLandData.js';
import { haCpCastle } from '../world/haAnchor.js';   // P1B: the castle's floor on the authority's terrace
import { applyLightTrim, applyCityAO } from '../world/materials.js';
import { buildVistaRock } from './cpVista.js';
import { rockMat, tuftMat } from './cpRocksKit.js';
import { pushTuft, tuftGeo } from './cpRocks.js';

export const CPC33 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpc33') === '0');
export const CASTLE = { O: [196.66, 418.45], A: [0.8716, 0.4903], C: [194.5, 419.9], NEAR: 165, MID: 480 };
const [OX, OZ] = CASTLE.O, [AX, AZ] = CASTLE.A;
const toW = (u, w) => [OX + AX * u - AZ * w, OZ + AZ * u + AX * w];
const toUW = (x, z) => { const ex = x - OX, ez = z - OZ; return [ex * AX + ez * AZ, -ex * AZ + ez * AX]; };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
// (P1B second pass, `?terrain=p1`: the floor is the castle terrace's, the 2017 bare earth on Vista Rock's top round it
// (tools/terrain/anchor_levels.mjs, anchors.json cpCastle: the highest walk level on open ground within
// 16 m, 43.2 m). The 39.6 m NAVD the flat park takes is the 3DEP ground under the castle's footprint, filled down from the
// cliff on its east: 2.7 m under the terrace it opens onto)
export const castleFloorY = () => { const h = haCpCastle(); return h !== null ? h : cpReliefReady() ? cpDemToWorld(39.6, CASTLE.C[0], CASTLE.C[1]) : CP_DATUM + 6.0; };

// ---- the plan (castle frame; heights over the floor B) ----------------------------------------------------------------
// keep and wing from OSM; their storeys from the photographs (the wing's parapet 4.6 m over the floor, the keep's 8.6 m,
// the turret's cornice 12 m, its cone 3.2 m, the staff to 20 m)
const KEEP = { u0: 0, u1: 5.14, w0: 0, w1: 6.85, roof: 7.72, top: 8.62 };
const WING = { u0: -8.64, u1: 0, w0: -2.97, w1: 2.37, roof: 3.86, top: 4.62 };
const TUR = { u: 5.56, w: 5.9, r: 1.5, eave: 11.95, cone: 3.9, rTop: 0.36 };
const GAZ = { u: 1.2, w: 1.28, hw: 1.06 };                                   // the timber lookout on the keep's roof (OSM u 0-2 x w 0-2.4)
// the terrace, the castle's floor: the walk west of the wing along the cliff, round the bastion to the pavilions' platform
// (OSM's rock edge), clockwise seen from above (the outside on the left of travel, as the keep's faces); the edges' kinds:
// 'plat' the platform's retaining wall, 'cliff' a parapet on a retaining wall, 'low' a low parapet, 'none' the wing
const PT = [[-32.6, -13.6], [-28.8, -14.3], [-17.6, -14.3], [-17.6, -9.2], [-16.5, -7.0], [-15.3, -5.2], [-13.6, -4.0], [-11.6, -3.3], [-8.64, -3.15],
  [-8.64, 2.37], [-13.5, 6.4], [-24.5, 8.4], [-33.2, 7.8], [-32.9, -9.2]];
const PT_KIND = ['plat', 'plat', 'plat', 'cliff', 'cliff', 'cliff', 'cliff', 'cliff', 'none', 'low', 'low', 'low', 'low', 'plat'];
const PLAT = { P: [[-32.6, -13.6], [-28.8, -14.3], [-17.6, -14.3], [-17.6, -9.2], [-32.9, -9.2]], h: 0.95, stair: [-24.4, -21.6] };
const PAV = { u0: -28.3, u1: -18.0, w0: -13.85, w1: -9.6 };                  // the open pavilion (OSM u -28.6 to -17.8 x w -14.0 to -8.9)
const TOWER = { u: -30.55, w: -11.75, hw: 1.45 };                           // the timber lookout tower at its west end
const PAV2 = { u0: -31.0, u1: -25.9, w0: 2.6, w1: 6.8 };                     // the second pavilion (OSM u -31.2 to -25.7 x w 2.4-7.0)
// the building's footprint with the turret's square, and how far the rock stands under the floor at each of its faces (the
// photographs: 3-6 m of battered wall over the pond; the world's floor is 6.9 m over Turtle Pond, so a little less here)
// (the turret's part an inscribed polygon, 1.46 m round its axis: a square there stood the rock's floor-level plate out past the
// battered base, a dark slab in it from the pond)
const PB = [[-8.64, -2.97], [0, -2.97], [0, 0], [5.14, 0], [5.14, 4.49], [5.94, 4.49], [6.59, 4.87], [6.97, 5.52], [6.97, 6.28], [6.59, 6.93],
  [5.94, 7.31], [5.18, 7.31], [4.53, 6.93], [4.4, 6.85], [0, 6.85], [0, 2.37], [-8.64, 2.37]];
const PB_DROP = [3.3, 3.0, 2.7, 2.4, 2.3, 2.2, 2.1, 1.9, 1.6, 1.3, 1.1, 1.0, 0.9, 0.8, 0.8, 0.8, 0.6];
const KIND_DROP = { plat: 1.8, cliff: 1.6, low: 0.5 };
export const CASTLE_BENCH = { w: 0.42, u: [-13.6, -16.4, -19.2, -22.0] };
// the planted bed in the terrace's south part (a granite curb round shrubs and ground cover): the walk keeps to the cliff
const BED = [[-25.2, 1.0], [-12.6, 1.0], [-11.3, 3.4], [-13.6, 5.6], [-24.5, 7.6], [-25.2, 7.5]];

const unflatUW = (a) => { const r = []; for (let i = 0; i + 1 < a.length; i += 2) r.push(toUW(a[i], a[i + 1])); return r; };
let _VP = null, _TP = null;
const VPOLY = () => _VP || (_VP = unflatUW(ROCKS.find((r) => r.id === 387216152).outer));
const TPOLY = () => _TP || (_TP = unflatUW(WATER.find((b) => b.k === 'turtle').outer));
const turtleY = () => (cpReliefReady() ? cpDemToWorld(32.0, 250, 404) : CP_DATUM + 5.2);
// signed distance to the floor (the terrace and the building, negative inside)
const dSolid = (u, w) => Math.min(polyDist(PT, u, w), polyDist(PB, u, w));
const segD = (a, b, u, w) => {
  const eu = b[0] - a[0], ew = b[1] - a[1], L = eu * eu + ew * ew;
  const t = clamp(L > 0 ? ((u - a[0]) * eu + (w - a[1]) * ew) / L : 0, 0, 1);
  return Math.hypot(u - a[0] - eu * t, w - a[1] - ew * t);
};
let _E = null;
const EDGES = () => {
  if (_E) return _E;
  _E = [];
  PT.forEach((p, i) => { if (PT_KIND[i] !== 'none') _E.push([p, PT[(i + 1) % PT.length], KIND_DROP[PT_KIND[i]]]); });
  PB.forEach((p, i) => _E.push([p, PB[(i + 1) % PB.length], PB_DROP[i]]));
  return _E;
};
// the rock's drop under the floor at the foot of the nearest walls (inverse-distance blend of the edges' values)
function dropAt(u, w) {
  let s = 0, n = 0;
  for (const [a, b, d] of EDGES()) { const q = 1 / Math.pow(segD(a, b, u, w) + 0.6, 4); s += d * q; n += q; }
  return s / n;
}

// ---- Vista Rock's field -------------------------------------------------------------------------------------------------
// y(u, w) of the rock. Off the floor the rock stands `dropAt` under it at the walls' feet and falls to its reach: to Turtle
// Pond's shore where OSM's bare rock runs down to the water (the polished whalebacks of the photographs: rounded over at
// the top, steeper toward the water), 4-8 m elsewhere; the profile stepped into benches by a noise-shifted floor/smoothstep;
// the ridge along the pond's west shore from the bare-rock polygon, under the floor; ridged and value noise for the relief.
const FIELD = {};
function field(B) {
  const key = B.toFixed(3);
  if (FIELD[key]) return FIELD[key];
  const T1 = B - 0.35, wl = turtleY(), VP = VPOLY(), TP = TPOLY();
  const prof = (t, n, qn, ex = 1.55, st = 0.8) => {
    const p = t >= 1 ? 0 : Math.pow(1 - Math.pow(Math.max(0, t), ex), 0.85);
    const q = p * n + qn, fl = Math.floor(q), fr = q - fl;
    const ps = clamp((fl + sm(0.45, 0.95, fr) - qn) / n, 0, 1);
    return p + (ps - p) * st * sm(0.04, 0.14, t);
  };
  const profR = (t, n, qn) => {
    const p = Math.pow(Math.max(0, 1 - Math.pow(Math.min(t, 1), 0.78)), 1.3);
    const q = p * n + qn, fl = Math.floor(q), fr = q - fl;
    const ps = clamp((fl + sm(0.5, 0.94, fr) - qn) / n, 0, 1);
    return p + (ps - p) * sm(0.03, 0.12, t);
  };
  // the ridge along the pond's west shore (the OSM bare-rock polygon): a crest along its middle, under the floor (a soft cap)
  const ridge = (u, w, uu, vv, foot) => {
    const dv = polyDist(VP, uu, vv);
    if (dv >= 1.4) return -1e9;
    const hr = (4.4 - 2.4 * sm(-14, -40, w)) * (0.72 + 0.28 * clamp(-dv / 7, 0, 1)), s = clamp(-dv / 3.8, 0, 1), tt = 1 - s + (dv > 0 ? dv / 3.8 : 0);
    const n = Math.max(2, Math.round(hr / 0.62)), qr = (fbm(uu * 0.5 + 7, vv * 0.5 - 2, 2) - 0.5) * 1.1;
    const tp = ((fbm(u * 0.17 + 1, w * 0.17 + 4, 3) - 0.5) * 2.6 + (fbm(u * 0.5 + 8, w * 0.5 - 1, 2) - 0.5) * 0.7) * s;
    const yr = foot + hr * profR(tt, n, qr) + tp - 0.55 * sm(0.55, 1.0, tt), cap = T1 - 2.6 - 1.2 * sm(-10, -30, w);
    return yr < cap - 1.2 ? yr : cap - 1.2 + 1.2 * (1 - Math.exp(-(yr - cap + 1.2) / 1.2));
  };
  const sf = function (u, w) {
    const d = dSolid(u, w);
    if (d <= 0) return T1;
    const [x, z] = toW(u, w), g = CP_DATUM + cpRelief(x, z);
    const dW = polyDist(TP, u, w), shore = 1 - sm(0.0, 3.0, dW);
    const foot = g + (Math.min(g, wl - 0.6) - g) * shore;
    const wu = fbm(u * 0.15 + 11.3, w * 0.15 - 4.1, 3) - 0.5, ww = fbm(u * 0.15 - 7.7, w * 0.15 + 2.9, 3) - 0.5;
    const uu = u + wu * 3.8, vv = w + ww * 3.8;
    const pv = polyDist(VP, u, w), inV = 1 - sm(-1.0, 3.0, pv);
    const r0 = 4.4 + 3.6 * fbm(u * 0.12 + 2, w * 0.12 + 9, 2);
    let reach = r0 + Math.max(0, d + Math.max(0, dW) + 0.7 - r0) * inV;
    // where the bare rock meets Turtle Pond it runs on 3-4.5 m into the water (dW is signed: negative in the pond) and goes under
    // it there, over the park's grass bank, so the face stands in the water as in the photographs from the shore
    const inP = (1 - sm(0.5, 6.0, pv)) * (1 - sm(2.0, 8.0, dW));
    if (inP > 0) reach += (Math.max(reach, d + dW + 3.0 + 1.5 * fbm(u * 0.3 + 4, w * 0.3 - 6, 2)) - reach) * inP;
    const t = Math.max(0, d + wu * 1.6 * sm(0.4, 2.5, d)) / reach;
    const top = T1 - dropAt(u, w);
    const qn = (fbm(uu * 0.3 + 3, vv * 0.3 + 8, 2) - 0.5) * 2.6;
    // (where OSM's bare rock runs down to the pond the face stays high to the water's edge and drops into it, as in the
    // photographs from the shore, instead of easing out onto a strip of lawn)
    // (the benches' risers fade out within ~1.5 m of the water: a riser at the waterline shaded as a sawtooth on the lattice)
    const ex = 1.55 + 1.2 * inV * (1 - sm(1.5, 6.0, dW)), y0 = t < 1.3 ? foot + (top - foot) * prof(t, 7, qn, ex, 0) : foot;
    // (the lower slope sinks under the ground and the water toward its reach, so the rock comes out of them along a crisp line;
    // a sheet lying on the ground beyond it z-fought the lawn and the pond's bed: the sawtooth at the waterline)
    let y = t < 1.3 ? foot + (top - foot) * prof(t, 7, qn, ex, 0.8 * sm(0.4, 1.8, y0 - wl)) - 0.6 * sm(0.55, 1.0, t) - 0.3 * sm(1.0, 1.3, t) : foot - 0.9;
    y = Math.max(y, ridge(u, w, uu, vv, foot));
    // the bedding: the schist's foliation dips toward the pond (park north, a little west) ~40 deg; the surface breaks along it
    // into slabs (their dip slopes facing the pond, as in the photographs from the shore) and the scarps between, 0.9-1.5 m
    // layers; carved into the envelope (never over it), not within a metre of the walls
    {
      const xd = -0.25 * u - 0.968 * w, lay = 2.3 + 1.6 * fbm(u * 0.05 + 7, w * 0.05 - 3, 2);
      const q = xd * 0.84 + y + fbm(u * 0.07 + 3, w * 0.07 - 2, 2) * 2.4 + (vn(u * 0.3 + 1, w * 0.3 + 4) - 0.5) * 0.4;
      const k = Math.floor(q / lay), fr = q / lay - k;
      const ys = y - (fr < 0.86 ? fr * lay : 0.86 * lay * (1 - fr) / 0.14);
      const carve = sm(0.8, 2.4, d) * sm(-0.2, 0.8, y - foot) * sm(0.08, 0.3, t);
      y += (Math.min(y, ys) - y) * carve * 0.6;
    }
    y = Math.max(y, foot - 0.9);
    const rel = clamp((y - foot) / 1.5, 0, 1) * sm(0.15, 0.9, d);
    if (rel > 0) {
      const rd = 1 - Math.abs(2 * fbm(u * 0.8 + 19, w * 0.8 + 5, 2) - 1);
      y += (rd * rd - 0.3) * 0.2 * rel + (vn(u * 2.3 + 1.7, w * 2.3 - 3.1) - 0.5) * 0.1 * rel;
    }
    return y;
  };
  // CP34 the slabs (lead's review: "a few LARGE planes: smooth, glacially polished slabs dipping steeply toward the pond, sharp
  // straight edges where slabs break, deep shadowed joints between them"): the smooth envelope is cut into Voronoi slabs 7 m
  // along the strike and 3.4 m down the dip, each the envelope's tangent plane at its site turned a little toward the dip
  // (the pond, park north-west), so the face is a few flat planes with steps where they meet; a V-groove 0.3-0.6 m deep along
  // every border; none within a metre of the walls or on the lawn
  const SD = [-0.29, -0.957], ST = [0.957, -0.29], LA = 10.0, LB = 3.4, planes = new Map();
  const hs = (a, b) => { const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return v - Math.floor(v); };
  const site = (ci, cj) => {
    const k = ci * 8192 + cj;
    let p = planes.get(k);
    if (p) return p;
    const a = (ci + 0.15 + 0.7 * hs(ci * 1.37 + 0.3, cj * 1.91 + 7.1)) * LA, b = (cj + 0.15 + 0.7 * hs(ci * 2.33 + 11.7, cj * 0.87 + 2.9)) * LB;
    const su = ST[0] * a + SD[0] * b, sw = ST[1] * a + SD[1] * b, e = 1.4;
    const y0 = sf(su, sw), gu = (sf(su + e, sw) - sf(su - e, sw)) / (2 * e), gw = (sf(su, sw + e) - sf(su, sw - e)) / (2 * e);
    // the dip: the plane's fall turned toward the bedding's (SD), its slope kept; a little tilt of its own
    const gl = Math.hypot(gu, gw), ddu = -SD[0] * gl, ddw = -SD[1] * gl, tw = 0.35;
    p = [a, b, su, sw, y0, gu * (1 - tw) + ddu * tw + (hs(ci + 5.1, cj - 2.7) - 0.5) * 0.12, gw * (1 - tw) + ddw * tw + (hs(ci - 8.3, cj + 4.4) - 0.5) * 0.12, hs(ci * 3.3, cj * 7.7)];
    planes.set(k, p);
    return p;
  };
  const f = function (u, w) {
    const ys = sf(u, w);
    const d = dSolid(u, w);
    if (d <= 0.6) return ys;
    // (no facets within ~1.5 m of Turtle Pond's surface: a slab's step crossing the waterline drew a sawtooth on the 0.22 m lattice)
    const [x, z] = toW(u, w), g = CP_DATUM + cpRelief(x, z), on = sm(0.6, 2.2, d) * sm(0.15, 0.9, ys - g) * sm(0.5, 2.0, ys - wl);
    if (on <= 0) return ys;
    // the two nearest sites in the slab frame (a along the strike, b down the dip) and the distance to their border (m)
    const a = (u * ST[0] + w * ST[1]) / LA, b = (u * SD[0] + w * SD[1]) / LB, ia = Math.floor(a), ib = Math.floor(b);
    let d1 = 1e9, d2 = 1e9, p1 = null, p2 = null;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const ci = ia + i, cj = ib + j, sa = ci + 0.15 + 0.7 * hs(ci * 1.37 + 0.3, cj * 1.91 + 7.1), sb = cj + 0.15 + 0.7 * hs(ci * 2.33 + 11.7, cj * 0.87 + 2.9);
      const da = (sa - a) * LA, db = (sb - b) * LB, dd = da * da + db * db;
      if (dd < d1) { d2 = d1; p2 = p1; d1 = dd; p1 = [ci, cj]; } else if (dd < d2) { d2 = dd; p2 = [ci, cj]; }
    }
    const P = site(p1[0], p1[1]), Q = site(p2[0], p2[1]);
    let yp = P[4] + P[5] * (u - P[2]) + P[6] * (w - P[3]);
    // the border's distance: along the line between the two sites (metres)
    const qa = (Q[0] - P[0]), qb = (Q[1] - P[1]), ql = Math.hypot(qa, qb) || 1;
    const ma = (P[0] + Q[0]) / 2, mb = (P[1] + Q[1]) / 2, eb = Math.abs(((ma - a * LA) * qa + (mb - b * LB) * qb) / ql);
    // a border between neighbours along the strike runs down the dip: the two slabs blend there into one continuous bedding
    // face (the photographs' long faces); a border between neighbours down the dip is the step where a slab breaks off
    const strike = Math.abs(qa) > Math.abs(qb);
    if (strike) { const yq = Q[4] + Q[5] * (u - Q[2]) + Q[6] * (w - Q[3]), bw = 0.5 * (1 - sm(0.0, 2.8, eb)); yp += (yq - yp) * bw; }
    const wd = 0.16 + 0.22 * P[7], dp = (0.3 + 0.35 * hs(P[7] * 91 + Q[7], 3.1)) * sm(0.5, 2.0, ys - g) * (strike ? 0.3 : 1);
    const gq = 1 - sm(0.0, wd, eb);
    let y = ys + (Math.min(yp, ys + 0.9) - ys) * on * 0.92 - dp * gq * gq * on;
    return Math.max(y, Math.min(g, ys) - 0.9);
  };
  FIELD[key] = f;
  return f;
}
// the OSM bare-rock polygon of Vista Rock (cpLand.js skips it for this part's rock) and its surface for the other parts
// (cpRockTop: trees, benches and walkers seat a foot on it): defined inside the polygon and on the floor
export const VISTA_ID = 387216152;
export function castleVistaTop(x, z) {
  const [u, w] = toUW(x, z);
  if (!(polyDist(VPOLY(), u, w) < 0 || dSolid(u, w) < 0)) return undefined;
  return field(castleFloorY())(u, w);
}
// walkers keep off the rock, its ridge and the castle's floor (cpLmKeepOut); compiled lamps, benches and trees stay off the floor
export function castleKeepOut(x, z) { const [u, w] = toUW(x, z); return polyDist(VPOLY(), u, w) < 3.0 || dSolid(u, w) < 4.0; }
export function castleDrop(x, z) { const [u, w] = toUW(x, z); return dSolid(u, w) < 2.0 || polyDist(VPOLY(), u, w) < 0.5; }
export function castleRockTop(B, x, z) { const [u, w] = toUW(x, z); return field(B)(u, w); }

// ---- small solids ---------------------------------------------------------------------------------------------------------
// a box from 8 corners [u, y, w], its faces oriented away from the centre
function solid(Bn, c, col, off) {
  const cx = c.reduce((s, p) => s + p[0], 0) / 8, cy = c.reduce((s, p) => s + p[1], 0) / 8, cz = c.reduce((s, p) => s + p[2], 0) / 8;
  const F = [[0, 1, 2, 3], [4, 7, 6, 5], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]];
  for (const f of F) {
    const [a, b, d, e] = f.map((i) => c[i]);
    let n = nrm3([(b[1] - a[1]) * (e[2] - a[2]) - (b[2] - a[2]) * (e[1] - a[1]), (b[2] - a[2]) * (e[0] - a[0]) - (b[0] - a[0]) * (e[2] - a[2]), (b[0] - a[0]) * (e[1] - a[1]) - (b[1] - a[1]) * (e[0] - a[0])]);
    const mx = (a[0] + b[0] + d[0] + e[0]) / 4 - cx, my = (a[1] + b[1] + d[1] + e[1]) / 4 - cy, mz = (a[2] + b[2] + d[2] + e[2]) / 4 - cz;
    if (n[0] * mx + n[1] * my + n[2] * mz < 0) n = [-n[0], -n[1], -n[2]];
    Bn.quad(a, b, d, e, col, off, n);
  }
}
// an axis-aligned (castle frame) block with the top edges bevelled
function blockBox(Bn, u0, u1, y0, y1, w0, w1, col, off, bev = 0.02) {
  const b = Math.min(bev, (u1 - u0) / 3, (w1 - w0) / 3, (y1 - y0) / 3), s = 0.7071;
  Bn.quad([u0 + b, y1, w0 + b], [u1 - b, y1, w0 + b], [u1 - b, y1, w1 - b], [u0 + b, y1, w1 - b], col, off, [0, 1, 0]);
  Bn.quad([u0 + b, y1, w0 + b], [u1 - b, y1, w0 + b], [u1, y1 - b, w0], [u0, y1 - b, w0], col, off, [0, s, -s]);
  Bn.quad([u1 - b, y1, w0 + b], [u1 - b, y1, w1 - b], [u1, y1 - b, w1], [u1, y1 - b, w0], col, off, [s, s, 0]);
  Bn.quad([u1 - b, y1, w1 - b], [u0 + b, y1, w1 - b], [u0, y1 - b, w1], [u1, y1 - b, w1], col, off, [0, s, s]);
  Bn.quad([u0 + b, y1, w1 - b], [u0 + b, y1, w0 + b], [u0, y1 - b, w0], [u0, y1 - b, w1], col, off, [-s, s, 0]);
  Bn.quad([u0, y0, w0], [u1, y0, w0], [u1, y1 - b, w0], [u0, y1 - b, w0], col, off, [0, 0, -1]);
  Bn.quad([u1, y0, w0], [u1, y0, w1], [u1, y1 - b, w1], [u1, y1 - b, w0], col, off, [1, 0, 0]);
  Bn.quad([u1, y0, w1], [u0, y0, w1], [u0, y1 - b, w1], [u1, y1 - b, w1], col, off, [0, 0, 1]);
  Bn.quad([u0, y0, w1], [u0, y0, w0], [u0, y1 - b, w0], [u0, y1 - b, w1], col, off, [-1, 0, 0]);
}
// a square rod between two points [u, y, w]
function rod(Bn, a, b, r, col) {
  const d = nrm3([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  const p = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const q1 = nrm3([d[1] * p[2] - d[2] * p[1], d[2] * p[0] - d[0] * p[2], d[0] * p[1] - d[1] * p[0]]);
  const q2 = [d[1] * q1[2] - d[2] * q1[1], d[2] * q1[0] - d[0] * q1[2], d[0] * q1[1] - d[1] * q1[0]];
  const loop = (c) => [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([i, j]) => [c[0] + (q1[0] * i + q2[0] * j) * r, c[1] + (q1[1] * i + q2[1] * j) * r, c[2] + (q1[2] * i + q2[2] * j) * r]);
  solid(Bn, [...loop(a), ...loop(b)], col, [0, 0, 0]);
}
// a box in a wall's frame: s0..s1 along, y0..y1, t0..t1 out of its face
function wallBox(Bn, Wf, s0, s1, y0, y1, t0, t1, col, off) {
  const M = Wf.M;
  solid(Bn, [M(s0, y0, t0), M(s1, y0, t0), M(s1, y0, t1), M(s0, y0, t1), M(s0, y1, t0), M(s1, y1, t0), M(s1, y1, t1), M(s0, y1, t1)], col, off);
}
// a lathed ring of n facets about (cu, cw): rows [[r, y], ...] from the bottom up
function lathe(Bn, cu, cw, rows, n, col, off, smooth = true, a0 = 0) {
  for (let k = 0; k + 1 < rows.length; k++) {
    const [r0, y0] = rows[k], [r1, y1] = rows[k + 1];
    const dr = r1 - r0, dy = y1 - y0, l = Math.hypot(dr, dy) || 1, nr = dy / l, ny = -dr / l;
    for (let i = 0; i < n; i++) {
      const ta = a0 + (i / n) * Math.PI * 2, tb = a0 + ((i + 1) / n) * Math.PI * 2, tm = (ta + tb) / 2;
      const ca = Math.cos(ta), sa = Math.sin(ta), cb = Math.cos(tb), sb = Math.sin(tb);
      const A = [cu + ca * r0, y0, cw + sa * r0], Bq = [cu + cb * r0, y0, cw + sb * r0], C2 = [cu + cb * r1, y1, cw + sb * r1], D = [cu + ca * r1, y1, cw + sa * r1];
      const nA = nrm3([ca * nr, ny, sa * nr]), nB = nrm3([cb * nr, ny, sb * nr]), nF = nrm3([Math.cos(tm) * nr, ny, Math.sin(tm) * nr]);
      if (smooth) { Bn.tri(A, Bq, C2, nA, nB, nB, col, off); Bn.tri(A, C2, D, nA, nB, nA, col, off); }
      else { Bn.tri(A, Bq, C2, nF, nF, nF, col, off); Bn.tri(A, C2, D, nF, nF, nF, col, off); }
    }
  }
}
const rr3 = (r) => [r() * 40, r() * 40, r() * 40];
const Z3 = [0, 0, 0];
// the middle level (CASTLE.NEAR .. CASTLE.MID m): the same building with each rubble face as its bed alone, laid in the stone
// material (flat, the openings, reveals, dressings, mouldings and roofs all kept): a sixth of the triangles
let LITE = false;
const NULLBIN = { tri() {}, quad() {} };
const LITE_TONE = shade(new THREE.Color(0xffffff), 0.86);
function rub(R, Wf, y0, y1, o) { if (LITE) rubble(NULLBIN, R.ST, Wf, y0 - 0.01, y1, { ...o, mortar: LITE_TONE }); else rubble(R.ST, R.MO, Wf, y0, y1, o); }

// ---- battered faces -----------------------------------------------------------------------------------------------------------
// the face from a to b (outside on the left of travel) leaning back k m per metre of rise up to yT: under yT it runs out by
// k (yT - y), the stones leaning with it; the same for a round wall
// (ext: [a end, b end] stretched along the face by the batter's run, so two battered faces meeting at an outside corner
// close it: each face's end follows the corner as it moves out with depth)
function batterWall(a, b, yT, k, ext = [false, false]) {
  const Wf = flatWall(a, b, -1), [nu, nw] = Wf.n, l = Math.hypot(1, k), L = Wf.L, e0 = ext[0] ? 1 : 0, e1 = ext[1] ? 1 : 0;
  return { L, d: Wf.d, n: Wf.n, N: () => [nu / l, k / l, nw / l],
    M: (s, y, t) => { const r = k * Math.max(0, yT - y); return Wf.M(s * (L + (e0 + e1) * r) / L - e0 * r, y, t + r); } };
}
function batterRound(cu, cw, r, a0, a1, yT, k) {
  const L = Math.abs(a1 - a0) * r, sg = a1 >= a0 ? 1 : -1, l = Math.hypot(1, k);
  return { L, round: true, M: (s, y, t) => { const a = a0 + sg * s / r, rr = r + t + k * Math.max(0, yT - y); return [cu + Math.cos(a) * rr, y, cw + Math.sin(a) * rr]; },
    N: (s) => { const a = a0 + sg * s / r; return [Math.cos(a) / l, k / l, Math.sin(a) / l]; } };
}
// the face's inner side (a parapet's back): the same edge moved th inward, its normal turned in
function innerWall(a, b, th) {
  const Wo = flatWall(a, b, -1), [nu, nw] = Wo.n;
  return flatWall([b[0] - nu * th, b[1] - nw * th], [a[0] - nu * th, a[1] - nw * th], -1);
}

// ---- the colours (relative tones around white: the kit's tints carry the absolute tone) ----------------------------------------
const WH = K(0xffffff);
const C = {
  cream: K(0xd9caa4), creamD: K(0xb9a780), red: K(0x7a2e24), redD: K(0x5a2119), green: K(0x2f4a3c), brown: K(0x5a3a26), glass: K(0x1a2128),
  iron: K(0x17191b), flagR: K(0xa3262c), flagW: K(0xe8e6e0), flagB: K(0x2a3a6a), flagK: K(0x111111), pole: K(0xdcd8cf), copper: K(0x4d6b5a), lead: K(0x6a6e72),
  slG: K(0xe6ebf2), slR: K(0xd8a898), slD: K(0xa9aeb6), board: K(0x8a6a4a), soil: K(0x2c2a1c),
};
const STONE = { col: WH, mortar: WH, course: 0.36, nsMax: 5, nyMax: 3, noBack: true };

// ---- Vista Rock's mesh (city/cpVista.js: the fracture on the macro field, the schist shader of the park's outcrops) -------------
// the shader is cpRocksKit.js's (its chain run as is), the albedo taken down to the grey-brown of the photographs (sunlit rock
// ~ (107, 98, 92) sRGB against our (125, 119, 101))
let _vmat = null;
function vistaMat() {
  if (_vmat) return _vmat;
  const base = rockMat('vista', turtleY());
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: base.roughness, metalness: base.metalness });
  m.name = 'cpc34:vista';
  m.onBeforeCompile = (sh, r) => {
    base.onBeforeCompile.call(base, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vV34;').replace('#include <project_vertex>', '#include <project_vertex>\nvV34 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vV34;
float v34H(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float v34N(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(v34H(i), v34H(i + vec2(1.0, 0.0)), u.x), mix(v34H(i + vec2(0.0, 1.0)), v34H(i + vec2(1.0, 1.0)), u.x), u.y); }`).replace('#include <emissivemap_fragment>', `{
  // (CP34) the photographs' grey-brown: pale streaks down the dip (the polished faces), rust stains, the tone a little cooler
  vec3 P = vV34;
  float sk = v34N(vec2((P.x * 0.49 - P.z * 0.87) * 1.7, P.y * 0.22 + (P.x * 0.87 + P.z * 0.49) * 0.05));
  float pale = smoothstep(0.58, 0.82, sk) * (0.6 + 0.4 * v34N(P.xz * 0.6 + 3.7));
  float rust = smoothstep(0.66, 0.9, v34N(P.xz * 0.21 + P.y * 0.17 - 5.3));
  diffuseColor.rgb *= vec3(0.98, 0.96, 1.02) * (1.0 + 0.32 * pale);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(1.16, 0.95, 0.78), rust * 0.55);
}
#include <emissivemap_fragment>`);
  };
  m.customProgramCacheKey = () => (base.customProgramCacheKey ? base.customProgramCacheKey() : 'rk') + '|cpc34vista3';
  _vmat = m;
  return m;
}
function vistaMesh(B, cell) {
  const geo = buildVistaRock({
    field: field(B), ground: (u, w) => { const [x, z] = toW(u, w); return CP_DATUM + cpRelief(x, z); }, toW, rot: [AX, AZ],
    U0: -40, U1: 24, W0: -47, W1: 20, cell,
    flat: (u, w) => 1 - sm(-0.2, 0.45, dSolid(u, w)),
    seed: 4.7, K: 0.7,
  });
  const m = new THREE.Mesh(geo, vistaMat());
  m.name = 'cpc33:vista:' + cell; m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---- the bins ----------------------------------------------------------------------------------------------------------------
// ST rubble (stone kind), MO mortar beds, GR dressed granite, SL slate, WD painted timber, GL glass, IR iron, CL cloth, FL flags
function bins() { return { ST: new CBin(), MO: new CBin(), GR: new CBin(), SL: new CBin(), WD: new CBin(), GL: new CBin(), IR: new CBin(), CL: new CBin(), FL: new CBin() }; }

// ---- the paving ----------------------------------------------------------------------------------------------------------------
// Square flags of 0.8-0.92 m in straight courses (the terrace's bluestone and granite squares), each its own tone and a few mm of
// tilt, a chamfer round the top, the joints between them dark (a base 3 cm under). `excl` rectangles [u0, u1, w0, w1] are left out.
function paving(R, poly, y, excl, seed, exclPoly = []) {
  const r = rng(seed), m = 0.5;
  let U0 = 1e9, U1 = -1e9, W0 = 1e9, W1 = -1e9;
  for (const p of poly) { U0 = Math.min(U0, p[0]); U1 = Math.max(U1, p[0]); W0 = Math.min(W0, p[1]); W1 = Math.max(W1, p[1]); }
  // the base (the joints' tone) under the whole polygon
  const base = shade(WH, 0.62), tris = THREE.ShapeUtils.triangulateShape(poly.map(([a, b]) => new THREE.Vector2(a, b)), []);
  for (const [i, j, k] of tris) R.MO.tri([poly[i][0], y - 0.03, poly[i][1]], [poly[j][0], y - 0.03, poly[j][1]], [poly[k][0], y - 0.03, poly[k][1]], [0, 1, 0], [0, 1, 0], [0, 1, 0], base);
  let n = 0;
  const sz = 0.86;
  for (let w = W0 + 0.05; w < W1 - 0.05; w += sz) {
    for (let u = U0 + 0.05; u < U1 - 0.05; u += sz) {
      const a = u, b = u + sz, w0 = w, w1 = w + sz;
      let skip = false;
      for (const [eu0, eu1, ew0, ew1] of excl) if (b > eu0 && a < eu1 && w1 > ew0 && w0 < ew1) { skip = true; break; }
      for (const P of exclPoly) if (polyDist(P, (a + b) / 2, (w0 + w1) / 2) < 0.75) { skip = true; break; }
      if (skip) continue;
      // inside the polygon (clear of its walls): all four corners
      let ok = true;
      for (const [cu, cw] of [[a, w0], [b, w0], [b, w1], [a, w1]]) if (polyDist(poly, cu, cw) > -m + 0.02) { ok = false; break; }
      if (!ok) continue;
      const v = r(), tone = 0.8 + 0.34 * r() * (0.6 + 0.4 * r()), tilt = (r() - 0.5) * 0.01, off = rr3(r);
      const col = shade(WH, v < 0.08 ? tone * 0.82 : tone, v > 0.86 ? 0.07 : v > 0.7 ? -0.03 : 0);
      const a2 = a + 0.006, b2 = b - 0.006, w2 = w0 + 0.006, w3 = w1 - 0.006, c = 0.012, t0 = y + tilt, t1 = y - tilt;
      R.FL.quad([a2 + c, t0, w2 + c], [b2 - c, t1, w2 + c], [b2 - c, t1, w3 - c], [a2 + c, t0, w3 - c], col, off, [0, 1, 0]);
      const s = 0.7071, dk = shade(col, 0.8);
      R.FL.quad([a2 + c, t0, w2 + c], [b2 - c, t1, w2 + c], [b2, t1 - c, w2], [a2, t0 - c, w2], dk, off, [0, s, -s]);
      R.FL.quad([b2 - c, t1, w2 + c], [b2 - c, t1, w3 - c], [b2, t1 - c, w3], [b2, t1 - c, w2], dk, off, [s, s, 0]);
      R.FL.quad([b2 - c, t1, w3 - c], [a2 + c, t0, w3 - c], [a2, t0 - c, w3], [b2, t1 - c, w3], dk, off, [0, s, s]);
      R.FL.quad([a2 + c, t0, w3 - c], [a2 + c, t0, w2 + c], [a2, t0 - c, w2], [a2, t0 - c, w3], dk, off, [-s, s, 0]);
      n++;
    }
  }
  return n;
}

// ---- the terrace's walls ------------------------------------------------------------------------------------------------------
// From a to b (the outside on the left of travel): the retaining wall battered under the floor y down to y - down, plumb over
// it; 'cliff' and 'low' carry a parapet H over the floor (its back in rubble too), 'plat' stops at the platform's coping.
const PTH = 0.5;
const COPE = [[0.07, 0], [0.07, 0.07], [0.03, 0.13], [-0.53, 0.13], [-0.57, 0.07], [-0.57, 0]];
const COPE_P = [[0.08, 0], [0.08, 0.08], [0.04, 0.14], [-0.9, 0.14], [-0.9, 0]];
function terraceWall(R, a, b, y, kind, o) {
  const Wf = flatWall(a, b, -1), H = o.H, seed = o.seed, s0 = o.s0 ?? 0, s1 = o.s1 ?? Wf.L;
  const yTop = y + H - 0.13;
  rub(R, batterWall(a, b, y, o.k ?? 0.17, [true, true]), y - o.down, y, { ...STONE, course: 0.42, nsMax: 4, seed: seed + 3, damp: o.wet ?? y - o.down + 0.6, s0, s1 });
  rub(R, Wf, y, yTop, { ...STONE, course: 0.34, nsMax: 4, seed, s0, s1 });
  if (kind !== 'plat') {
    const Wi = innerWall(a, b, PTH), L = Wf.L;
    rub(R, Wi, y - 0.04, yTop, { ...STONE, course: 0.32, nsMax: 3, nyMax: 2, seed: seed + 5, s0: L - s1, s1: L - s0, amp: 0.8 });
  }
  moulding(R.GR, Wf, s0, s1, yTop, kind === 'plat' ? COPE_P : COPE, WH, { blk: 1.15, seed: seed + 9 });
}
// a stepped buttress pier on a face (p the plan point on the face, d the face's direction, n its outward normal): two stages, the
// lower projecting pr, the upper 0.55 pr, each with a sloped weathering of dressed stone
function pier(R, p, d, n, wd, pr, y0, ym, y1, seed) {
  const rr = rng(seed);
  const stage = (ya, yb, q, sd, tone = 1) => {
    const a = [p[0] - d[0] * wd / 2, p[1] - d[1] * wd / 2], b = [p[0] + d[0] * wd / 2, p[1] + d[1] * wd / 2];
    const fa = [a[0] + n[0] * q, a[1] + n[1] * q], fb = [b[0] + n[0] * q, b[1] + n[1] * q];
    rub(R, flatWall(fa, fb, -1), ya, yb, { ...STONE, course: 0.4, nsMax: 4, seed: sd });
    rub(R, flatWall(a, fa, -1), ya, yb, { ...STONE, course: 0.4, nsMax: 3, seed: sd + 1 });
    rub(R, flatWall(fb, b, -1), ya, yb, { ...STONE, course: 0.4, nsMax: 3, seed: sd + 2 });
    // the weathering: a dressed slope from the front edge (yb) back to the face (yb + 0.4 q)
    const e = 0.06, A = [a[0] - d[0] * e, a[1] - d[1] * e], Bp = [b[0] + d[0] * e, b[1] + d[1] * e];
    const FA = [fa[0] + n[0] * e - d[0] * e, fa[1] + n[1] * e - d[1] * e], FB = [fb[0] + n[0] * e + d[0] * e, fb[1] + n[1] * e + d[1] * e];
    const yt = yb + 0.45 * q + 0.08;
    solid(R.GR, [[FA[0], yb - 0.1, FA[1]], [FB[0], yb - 0.1, FB[1]], [Bp[0], yb - 0.1, Bp[1]], [A[0], yb - 0.1, A[1]], [FA[0], yb + 0.02, FA[1]], [FB[0], yb + 0.02, FB[1]], [Bp[0], yt, Bp[1]], [A[0], yt, A[1]]], shade(WH, (0.92 + 0.12 * rr()) * tone), rr3(rr));
  };
  stage(y0, ym, pr, seed * 7, 0.62);
  stage(ym, y1, pr * 0.55, seed * 7 + 3);
}
function terrace(R, B) {
  // the floor's flags: the walk (the platform and the second pavilion left out), the platform at its height
  const n1 = paving(R, PT, B, [[-34, -17.55, -15, -9.1], [PAV2.u0 - 0.3, PAV2.u1 + 0.3, PAV2.w0 - 0.3, PAV2.w1 + 0.3]], 11, [BED]);
  bedCurb(R, B);
  const n2 = paving(R, PLAT.P, B + PLAT.h, [], 12);
  // the walls, edge by edge
  PT.forEach((a, i) => {
    const b = PT[(i + 1) % PT.length], k = PT_KIND[i];
    if (k === 'none') return;
    if (k === 'cliff') terraceWall(R, a, b, B, k, { H: 1.0, down: 1.6 + 3.4, seed: 20 + i * 7, wet: B - 2.1 });
    else if (k === 'plat') terraceWall(R, a, b, B + PLAT.h, k, { H: 0.0, down: PLAT.h + 1.8 + 3.2, seed: 20 + i * 7, wet: B - 2.3 });
    else terraceWall(R, a, b, B, k, { H: 0.82, down: 2.6, seed: 20 + i * 7 });
  });
  // the platform's front onto the walk (its south side) with the stair up the middle
  {
    const a = [-17.6, -9.2], b = [-32.9, -9.2], Wf = flatWall(a, b, -1), [g0, g1] = PLAT.stair, L = Wf.L;
    const sg0 = -17.6 - g1, sg1 = -17.6 - g0;      // s along from u = -17.6 westward
    for (const [s0, s1] of [[0, sg0], [sg1, L]]) {
      rub(R, Wf, B - 0.3, B + PLAT.h - 0.14, { ...STONE, course: 0.3, nsMax: 4, seed: 91 + s0 | 0, s0, s1 });
      moulding(R.GR, Wf, s0, s1, B + PLAT.h - 0.14, COPE_P, WH, { blk: 1.1, seed: 93 });
    }
    const steps = 3, rise = PLAT.h / steps, run = 0.34, rr = rng(95);
    for (let k = 0; k < steps; k++) blockBox(R.GR, g0, g1, B - 0.05, B + rise * (k + 1), -9.2 + run * (steps - 1 - k), -9.2 + run * (steps - k) + 0.03, shade(WH, 0.9 + 0.14 * rr()), rr3(rr), 0.02);
    for (const [ua, ub] of [[g0 - 0.42, g0], [g1, g1 + 0.42]]) blockBox(R.GR, ua, ub, B - 0.05, B + PLAT.h + 0.12, -9.2, -9.2 + run * steps + 0.05, shade(WH, 0.95), rr3(rr), 0.025);
  }
  // the stepped piers at the bastion's angles and along the platform's cliff face
  const piers = [[3, 0.0], [4, 0.0], [5, 0.0], [6, 0.0], [7, 0.0], [1, 0.25], [1, 0.7], [0, 0.5]];
  for (const [i, f] of piers) {
    const a = PT[i], b = PT[(i + 1) % PT.length], Wf = flatWall(a, b, -1), [eu, ew] = Wf.d, [nu, nw] = Wf.n;
    const p = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], yTop = PT_KIND[i] === 'plat' ? B + PLAT.h - 0.1 : B + 0.86;
    // at a vertex the pier bisects the two faces
    let d = [eu, ew], n = [nu, nw];
    if (f === 0) {
      const a0 = PT[(i - 1 + PT.length) % PT.length], W0 = flatWall(a0, a, -1);
      n = nrm3([nu + W0.n[0], 0, nw + W0.n[1]]); n = [n[0], n[2]]; d = [-n[1], n[0]];
    }
    pier(R, p, d, n, 1.3, 0.72, B - 5.2, B - 1.9, yTop, 400 + i * 13 + Math.round(f * 10));
  }
  benches(R, B);
  lamps(R, B);
  return n1 + n2;
}

// ---- the bed: a dressed curb round it, its soil (the plants: bedPlants) ---------------------------------------------------------------
function bedCurb(R, B) {
  const rr = rng(97);
  BED.forEach((a, i) => {
    const b = BED[(i + 1) % BED.length], Wf = flatWall(a, b, -1);
    moulding(R.GR, Wf, -0.12, Wf.L + 0.12, B - 0.05, [[0.12, 0], [0.12, 0.2], [0.08, 0.24], [-0.12, 0.24], [-0.16, 0.2], [-0.16, 0]], WH, { blk: 0.9, seed: 970 + i });
  });
  const tris = THREE.ShapeUtils.triangulateShape(BED.map(([a, b]) => new THREE.Vector2(a, b)), []);
  for (const [i, j, k] of tris) R.WD.tri([BED[i][0], B + 0.16, BED[i][1]], [BED[j][0], B + 0.16, BED[j][1]], [BED[k][0], B + 0.16, BED[k][1]], [0, 1, 0], [0, 1, 0], [0, 1, 0], [shade(C.soil, 0.9 + 0.2 * rr()), shade(C.soil, 0.9 + 0.2 * rr()), shade(C.soil, 0.9 + 0.2 * rr())]);
}

// ---- benches and lamps ------------------------------------------------------------------------------------------------------------
function benches(R, B) {
  const rr = rng(88);
  for (const u of CASTLE_BENCH.u) {
    const w = CASTLE_BENCH.w;
    // the park's bench: slats on cast-iron standards, facing the pond (-w)
    for (const du of [-0.78, 0.0, 0.78]) {
      blockBox(R.IR, u + du - 0.03, u + du + 0.03, B, B + 0.44, w - 0.24, w + 0.2, C.iron, Z3, 0.004);
      blockBox(R.IR, u + du - 0.03, u + du + 0.03, B + 0.44, B + 0.9, w + 0.16, w + 0.22, C.iron, Z3, 0.004);
    }
    for (let k = 0; k < 4; k++) blockBox(R.WD, u - 0.92, u + 0.92, B + 0.42, B + 0.46, w - 0.22 + k * 0.105, w - 0.13 + k * 0.105, shade(C.green, 0.9 + 0.2 * rr()), Z3, 0.005);
    for (let k = 0; k < 3; k++) blockBox(R.WD, u - 0.92, u + 0.92, B + 0.55 + k * 0.12, B + 0.64 + k * 0.12, w + 0.2, w + 0.23, shade(C.green, 0.9 + 0.2 * rr()), Z3, 0.005);
  }
}
// the park's cast-iron lamp posts (the Henry Bacon pattern: a fluted shaft on a skirted base, the glass globe and its cap)
// BL36 (owner 2026-10-03: "Belvedere Castle's black lamps are misplaced: outside the wall, floating"): the bastion's two lamps
// stood 0.31 and 0.27 m past the parapet's outer face (over the cliff) and the south one in the low parapet against the bed's
// curb; every lamp now stands on the flags, 1.2 m or more inside the terrace's edge (the parapet is 0.5 m thick), 0.55 m or
// more off the bed, off the platform, its foot 3 cm into the paving. `?bl36=0` restores the CP34 places.
const BL36 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('bl36') === '0');
const LAMPS = BL36 ? [[-11.4, -2.1], [-16.25, -4.28], [-18.6, -7.9], [-17.8, 0.45], [-30.0, -2.0], [-10.2, 1.6]]
  : [[-11.2, -2.4], [-15.6, -6.2], [-17.0, -8.6], [-20.0, 7.0], [-30.0, -2.0], [-10.2, 1.6]];
function lamps(R, B) {
  for (const [u, w] of LAMPS) {
    lathe(R.IR, u, w, [[0.2, BL36 ? B - 0.03 : B], [0.2, B + 0.1], [0.16, B + 0.16], [0.12, B + 0.42], [0.09, B + 0.58], [0.075, B + 0.66], [0.06, B + 2.72], [0.08, B + 2.8], [0.06, B + 2.9], [0.1, B + 2.98]], 10, C.iron, Z3, true);
    lathe(R.GL, u, w, [[0.05, B + 2.98], [0.12, B + 3.04], [0.16, B + 3.17], [0.15, B + 3.33], [0.1, B + 3.44], [0.05, B + 3.47]], 12, K(0x8e979c), Z3, true);
    lathe(R.IR, u, w, [[0.05, B + 3.43], [0.12, B + 3.48], [0.09, B + 3.53], [0.025, B + 3.66]], 10, C.iron, Z3, true);
  }
}

// ---- openings and their dressings -----------------------------------------------------------------------------------------------
const rarch = (s, y0, wd, ht) => ({ s0: s - wd / 2, s1: s + wd / 2, y0, y1: y0 + ht, arch: true });
const rect = (s, y0, wd, ht) => ({ s0: s - wd / 2, s1: s + wd / 2, y0, y1: y0 + ht });
// the dressed ring of voussoirs with a hood over it, the jambs' dressings, the sill, the reveal into the wall and the glazing
function trim(R, Wf, op, seed, o = {}) {
  const hw = (op.s1 - op.s0) / 2, sp = op.y1 - (op.arch ? hw : 0), depth = o.depth ?? 0.4, rr = rng(seed);
  if (op.arch) {
    archRing(R.GR, Wf, op, WH, { wd: o.wd ?? 0.2, pr: 0.035, rev: depth, seed, n: o.n });
    // the hood mould: a thin projecting ring over the voussoirs
    archRing(R.GR, Wf, { s0: op.s0 - (o.wd ?? 0.2) - 0.005, s1: op.s1 + (o.wd ?? 0.2) + 0.005, y0: op.y0, y1: op.y1 + (o.wd ?? 0.2) + 0.005, arch: true }, shade(WH, 0.96), { wd: 0.07, pr: 0.075, rev: 0.02, seed: seed + 1, n: 12 });
  } else {
    wallBox(R.GR, Wf, op.s0 - 0.14, op.s1 + 0.14, op.y1, op.y1 + 0.24, -0.02, 0.05, shade(WH, 0.95), rr3(rr));     // the lintel
  }
  reveal(R.ST, o.noGlass ? null : R.GL, Wf, op, depth, shade(WH, 0.72), o.glass || C.glass);
  if (!o.noGlass && op.arch) sashes(R, Wf, op, depth, o.frame || C.green);
  if (!o.noJambs) {
    let y = op.y0, k = 0;
    while (y < sp - 0.05) {
      const hh = Math.min(sp - y, 0.3 + 0.08 * rr()), lng = k % 2 ? 0.3 : 0.18;
      wallBox(R.GR, Wf, op.s0 - 0.03 - lng, op.s0 - 0.004, y + 0.004, y + hh - 0.004, -0.02, 0.03, shade(WH, 0.9 + 0.14 * rr()), rr3(rr));
      wallBox(R.GR, Wf, op.s1 + 0.004, op.s1 + 0.03 + lng, y + 0.004, y + hh - 0.004, -0.02, 0.03, shade(WH, 0.9 + 0.14 * rr()), rr3(rr));
      y += hh; k++;
    }
  }
  if (!o.noSill) wallBox(R.GR, Wf, op.s0 - 0.12, op.s1 + 0.12, op.y0 - 0.12, op.y0 + 0.01, -0.02, 0.09, WH, [3, 4, 5]);
}
// the painted sashes in a round-headed opening, in front of its glazing: the frame round the outline, a transom at the
// springing, a mullion when the light is wide enough, a rail in a door's lower half
function sashes(R, Wf, op, depth, col) {
  const hw = (op.s1 - op.s0) / 2, c = (op.s0 + op.s1) / 2, sp = op.y1 - hw, t0 = -depth + 0.03, t1 = t0 + 0.05, b = hw > 0.4 ? 0.05 : 0.035;
  wallBox(R.WD, Wf, op.s0, op.s0 + b, op.y0, sp, t0, t1, col, Z3);
  wallBox(R.WD, Wf, op.s1 - b, op.s1, op.y0, sp, t0, t1, col, Z3);
  wallBox(R.WD, Wf, op.s0, op.s1, op.y0, op.y0 + b, t0, t1, col, Z3);
  for (let k = 0; k < 8; k++) {
    const a0 = (Math.PI * k) / 8, a1 = (Math.PI * (k + 1)) / 8, rr = hw - b / 2, tm = (t0 + t1) / 2;
    rod(R.WD, Wf.M(c + Math.cos(a0) * rr, sp + Math.sin(a0) * rr, tm), Wf.M(c + Math.cos(a1) * rr, sp + Math.sin(a1) * rr, tm), b / 2, col);
  }
  wallBox(R.WD, Wf, op.s0, op.s1, sp - b / 2, sp + b / 2, t0, t1, col, Z3);
  if (hw > 0.3) wallBox(R.WD, Wf, c - b / 2, c + b / 2, op.y0, op.y1 - 0.02, t0, t1, col, Z3);
  if (op.y1 - op.y0 > 2.4) wallBox(R.WD, Wf, op.s0, op.s1, op.y0 + 0.95, op.y0 + 1.02, t0, t1 + 0.01, col, Z3);
}
// a pair of round-headed lights on a colonnette, under one sill (the keep's upper floor)
function pairLights(s, y0, wd, ht, gap = 0.17) { return [rarch(s - (wd + gap) / 2, y0, wd, ht), rarch(s + (wd + gap) / 2, y0, wd, ht)]; }
function trimPair(R, Wf, ops, seed) {
  const [a, b] = ops, rr = rng(seed);
  for (const op of ops) trim(R, Wf, op, seed + (op === a ? 0 : 5), { depth: 0.36, wd: 0.17, noJambs: true, noSill: true, n: 7 });
  // the outer jambs, the colonnette with its cap and base, the shared sill
  const sp = a.y1 - (a.s1 - a.s0) / 2;
  wallBox(R.GR, Wf, a.s0 - 0.16, a.s0 - 0.004, a.y0, sp, -0.02, 0.03, shade(WH, 0.95), rr3(rr));
  wallBox(R.GR, Wf, b.s1 + 0.004, b.s1 + 0.16, a.y0, sp, -0.02, 0.03, shade(WH, 0.95), rr3(rr));
  const c = (a.s1 + b.s0) / 2, cw = (b.s0 - a.s1) / 2;
  wallBox(R.GR, Wf, c - cw * 0.7, c + cw * 0.7, a.y0 + 0.12, sp - 0.14, -0.2, -0.04, shade(WH, 1.02), [1, 1, 1]);
  wallBox(R.GR, Wf, c - cw - 0.03, c + cw + 0.03, sp - 0.14, sp, -0.24, 0.02, shade(WH, 0.98), [2, 1, 1]);
  wallBox(R.GR, Wf, c - cw - 0.02, c + cw + 0.02, a.y0, a.y0 + 0.12, -0.24, 0.0, shade(WH, 0.98), [2, 2, 1]);
  wallBox(R.GR, Wf, c - cw, c + cw, sp, a.y1 + 0.02, -0.3, 0.0, shade(WH, 0.96), [3, 1, 2]);
  wallBox(R.GR, Wf, a.s0 - 0.24, b.s1 + 0.24, a.y0 - 0.13, a.y0 + 0.01, -0.02, 0.1, WH, [3, 4, 5]);
}
// a string course and the water table (the weathered course at the batter's top)
const SPROF = [[0, 0], [0.07, 0], [0.11, 0.045], [0.11, 0.15], [0.07, 0.19], [0, 0.19]];
const WTAB = [[0, -0.02], [0.2, -0.02], [0.2, 0.06], [0.0, 0.22]];
const CORNICE = [[0, 0], [0.06, 0], [0.06, 0.06], [0.14, 0.1], [0.2, 0.18], [0.2, 0.28], [0.0, 0.28]];
// the corbel table under a cornice: small stepped brackets every ~0.5 m
function corbels(R, Wf, s0, s1, y, seed) {
  const n = Math.max(2, Math.round((s1 - s0) / 0.52)), rr = rng(seed);
  for (let i = 0; i < n; i++) {
    const s = s0 + (i + 0.5) * (s1 - s0) / n, c = shade(WH, 0.9 + 0.14 * rr());
    wallBox(R.GR, Wf, s - 0.07, s + 0.07, y - 0.3, y, 0.0, 0.06, c, rr3(rr));
    wallBox(R.GR, Wf, s - 0.07, s + 0.07, y - 0.17, y, 0.06, 0.12, c, rr3(rr));
  }
}
// a face of the building: the battered substructure from y0 up to yB, the plumb wall over it to y1 with its openings
function face(R, a, b, y0, yB, y1, o) {
  if (yB > y0 + 0.05) rub(R, batterWall(a, b, yB, o.k ?? 0.15, o.ext), y0, yB, { ...STONE, course: 0.42, seed: o.seed + 500, s0: o.s0, s1: o.s1, damp: o.wet ?? y0 + 0.8 });
  rub(R, flatWall(a, b, -1), yB, y1, { ...STONE, seed: o.seed, ops: o.ops || [], s0: o.s0, s1: o.s1 });
}

// ---- the keep --------------------------------------------------------------------------------------------------------------------
function keep(R, B) {
  const { u0, u1, w0, w1, roof, top } = KEEP, yR = B + roof, yT = B + top, yC = yT - 0.14;
  const N = [[u0, w0], [u1, w0]], E = [[u1, w0], [u1, w1]], S = [[u1, w1], [u0, w1]], Wk = [[u0, w1], [u0, w0]];
  const main = (s) => rarch(s, B + 0.95, 0.86, 2.05);
  const pN = pairLights(1.95, B + 4.4, 0.52, 1.62), pE = pairLights(2.0, B + 4.4, 0.52, 1.62), pS = pairLights(2.9, B + 4.4, 0.52, 1.62), pW = pairLights(3.3, B + 4.95, 0.48, 1.5);
  const opsN = [main(1.95), ...pN], opsE = [main(2.0), ...pE, rect(2.0, B + 6.55, 0.2, 0.55)], opsS = [rarch(2.9, B + 0.0, 1.1, 2.6), ...pS], opsW = [...pW];
  face(R, ...N, B - 6.4, B + 0.1, yC, { seed: 41, ops: opsN, k: 0.24, wet: B - 3.1, ext: [false, true] });
  face(R, ...E, B - 5.8, B + 0.1, yC, { seed: 42, ops: opsE, k: 0.24, s1: 4.42, wet: B - 2.8, ext: [true, false] });
  face(R, ...S, B - 3.6, B + 0.1, yC, { seed: 43, ops: opsS, s0: 1.1 });
  face(R, ...Wk, B - 3.6, B + 0.1, yC, { seed: 44, ops: opsW, s1: 4.48 });                                      // south of the wing
  rub(R, flatWall(...Wk, -1), B + WING.top - 0.06, yC, { ...STONE, seed: 45, ops: [], s0: 4.48, s1: 6.85 });   // over its roof
  trim(R, flatWall(...N, -1), opsN[0], 50, { depth: 0.5 });
  trim(R, flatWall(...E, -1), opsE[0], 51, { depth: 0.5 });
  trim(R, flatWall(...E, -1), opsE[3], 52, { depth: 0.3, noSill: true });
  trim(R, flatWall(...S, -1), opsS[0], 53, { depth: 0.85, wd: 0.24, glass: C.brown, noSill: true });
  trimPair(R, flatWall(...N, -1), pN, 60); trimPair(R, flatWall(...E, -1), pE, 64); trimPair(R, flatWall(...S, -1), pS, 68); trimPair(R, flatWall(...Wk, -1), pW, 72);
  // water table, string course, cornice on its corbel table, the coped parapet with its back, the corner blocks
  const faces = [[N, 0, 5.14, 1], [E, 0, 4.42, 2], [S, 1.1, 5.14, 3], [Wk, 0, 6.85, 4]];
  for (const [F, s0, s1, sd] of faces) {
    const Wf = flatWall(...F, -1);
    if (sd !== 4) moulding(R.GR, Wf, s0, s1, B + 0.1, WTAB, WH, { blk: 1.0, seed: 110 + sd });
    else moulding(R.GR, Wf, 0, 4.48, B + 0.1, WTAB, WH, { blk: 1.0, seed: 110 + sd });
    const sc0 = sd === 4 ? 0 : s0;
    moulding(R.GR, Wf, sc0, s1, B + 3.55, SPROF, WH, { blk: 1.0, seed: 120 + sd });
    corbels(R, Wf, s0, s1, yR - 0.2, 130 + sd);
    moulding(R.GR, Wf, s0, s1, yR - 0.2, CORNICE, WH, { blk: 1.0, seed: 140 + sd });
    moulding(R.GR, Wf, s0, s1, yC, COPE, WH, { blk: 1.1, seed: 150 + sd });
    rub(R, innerWall(...F, PTH), yR, yC, { ...STONE, course: 0.3, nsMax: 3, nyMax: 2, seed: 160 + sd, s0: Wf.L - s1, s1: Wf.L - s0, amp: 0.8 });
  }
  const rr = rng(171);
  for (const [cu, cw, su, sw] of [[u0, w0, 1, 1], [u1, w0, -1, 1], [u0, w1, 1, -1]]) blockBox(R.GR, Math.min(cu - su * 0.08, cu + su * 0.66), Math.max(cu - su * 0.08, cu + su * 0.66), yT - 0.02, yT + 0.24, Math.min(cw - sw * 0.08, cw + sw * 0.66), Math.max(cw - sw * 0.08, cw + sw * 0.66), shade(WH, 0.95 + 0.08 * rr()), rr3(rr), 0.03);
  // the roof: the lookout's flags behind the parapet
  paving(R, [[u0, w0], [u1, w0], [u1, w1], [u0, w1]], yR + 0.03, [], 151);
}

// ---- the turret ------------------------------------------------------------------------------------------------------------------
// courses of slates up a cone (or a pyramid, n facets): each band a short frustum with its lower edge lipped out
function slateRoof(Bn, cu, cw, r0, y0, r1, y1, n, nc, col, flat, a0 = 0, bands = null) {
  const rr = rng(n * 31 + nc);
  for (let k = 0; k < nc; k++) {
    const f0 = k / nc, f1 = (k + 1) / nc, ra = r0 + (r1 - r0) * f0, rb = r0 + (r1 - r0) * f1, ya = y0 + (y1 - y0) * f0, yb = y0 + (y1 - y0) * f1;
    const base = bands ? bands[Math.floor(k / 2) % bands.length] : col, c = shade(base, 0.9 + 0.2 * rr()), off = rr3(rr);
    lathe(Bn, cu, cw, [[ra + 0.03, ya - 0.014], [ra + 0.02, ya + 0.0], [rb + 0.002, yb]], n, c, off, !flat, a0);
  }
}
function turret(R, B) {
  const { u, w, r, eave, cone, rTop } = TUR, yE = B + eave, rr = rng(181);
  // the arc clear of the keep below its parapet (the keep hides 140-254 deg), the full ring over it
  const aA = 4.43, aB = 2.44 + Math.PI * 2, Wlow = roundWall(u, w, r, aA, aB), Wfull = roundWall(u, w, r, 0, Math.PI * 2);
  const sL = (a) => ((a - aA + Math.PI * 4) % (Math.PI * 2)) * r, sF = (a) => (((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) * r;
  rub(R, batterRound(u, w, r, aA, aB, B + 0.1, 0.24), B - 5.6, B + 0.1, { ...STONE, course: 0.42, seed: 30, damp: B - 2.6 });
  const opsLow = [rect(sL(5.5), B + 1.2, 0.17, 0.95), rect(sL(0.25), B + 4.6, 0.19, 1.05), rect(sL(5.9), B + 6.5, 0.17, 0.9)];
  const opsHigh = [rect(sF(0.15), B + 8.95, 0.18, 0.95), ...[0.55, 2.15, 3.75, 5.35].map((a) => rarch(sF(a), B + 10.4, 0.34, 0.8))];
  rub(R, Wlow, B + 0.1, B + KEEP.top, { ...STONE, course: 0.33, seed: 31, ops: opsLow });
  rub(R, Wfull, B + KEEP.top, yE - 0.42, { ...STONE, course: 0.33, seed: 32, ops: opsHigh });
  opsLow.forEach((op, i) => trim(R, Wlow, op, 200 + i, { depth: 0.3 }));
  opsHigh.forEach((op, i) => trim(R, Wfull, op, 210 + i, { depth: 0.3, wd: 0.15, n: 7 }));
  moulding(R.GR, Wlow, 0, Wlow.L, B + 0.1, WTAB, WH, { blk: 0.9, seed: 221 });
  moulding(R.GR, Wlow, 0, Wlow.L, B + 3.55, SPROF, WH, { blk: 0.9, seed: 222 });
  moulding(R.GR, Wlow, 0, Wlow.L, B + 7.5, SPROF, WH, { blk: 0.9, seed: 223 });
  moulding(R.GR, Wfull, 0, Wfull.L, B + 10.05, SPROF, WH, { blk: 0.9, seed: 224 });
  // the corbelled cornice and the cone's foot
  moulding(R.GR, Wfull, 0, Wfull.L, yE - 0.42, [[0, 0], [0.07, 0], [0.07, 0.08], [0.15, 0.14], [0.22, 0.24], [0.28, 0.32], [0.28, 0.42], [0, 0.42]], WH, { blk: 0.8, seed: 225 });
  slateRoof(R.SL, u, w, r + 0.33, yE, rTop, yE + cone, 40, 32, shade(WH, 1.0), false);
  // two dormers (east and west): a gable of dressed stone on the cornice, an oculus in its moulded ring, the coping, a finial,
  // the cheeks and the little roof running back into the cone
  for (const a of [-1.2, Math.PI - 1.2]) {
    const ca = Math.cos(a), sa = Math.sin(a), tu = -sa, tw = ca, rf = r + 0.36, hwD = 0.58;
    const M = (s, y, t) => [u + ca * (rf + t) + tu * s, y, w + sa * (rf + t) + tw * s];
    const Wd = { L: 2 * hwD, M: (s, y, t) => M(s - hwD, y, t), N: () => [ca, 0, sa], d: [tu, tw] };
    const yS = yE + 0.86, yA = yE + 1.5, c = shade(WH, 1.02), fN = [ca, 0, sa], oc = yE + 0.47, ro = 0.21, rh = ro + 0.08;
    // the face round the oculus (a square with a round hole: fans from the ring to the rectangle's edge, the corners kept)
    const angs = [];
    for (let k = 0; k < 20; k++) angs.push((k / 20) * Math.PI * 2);
    for (const [cs, cy] of [[hwD, yS - oc], [-hwD, yS - oc], [-hwD, yE - oc], [hwD, yE - oc]]) angs.push((Math.atan2(cy, cs) + Math.PI * 2) % (Math.PI * 2));
    angs.sort((p, q) => p - q);
    const edge = (t) => { const ct = Math.cos(t), st = Math.sin(t); let d = 1e9; if (ct > 1e-6) d = Math.min(d, hwD / ct); if (ct < -1e-6) d = Math.min(d, -hwD / ct); if (st > 1e-6) d = Math.min(d, (yS - oc) / st); if (st < -1e-6) d = Math.min(d, (oc - yE) / -st); return d; };
    for (let k = 0; k < angs.length; k++) {
      const t0 = angs[k], t1 = k + 1 < angs.length ? angs[k + 1] : angs[0] + Math.PI * 2, e0 = edge(t0), e1 = edge(t1);
      R.GR.quad(M(Math.cos(t0) * rh, oc + Math.sin(t0) * rh, 0), M(Math.cos(t1) * rh, oc + Math.sin(t1) * rh, 0), M(Math.cos(t1) * e1, oc + Math.sin(t1) * e1, 0), M(Math.cos(t0) * e0, oc + Math.sin(t0) * e0, 0), c, [1, 2, 3], fN);
    }
    R.GR.tri(M(-hwD, yS, 0), M(hwD, yS, 0), M(0, yA, 0), fN, fN, fN, c, [1, 2, 3]);
    // the cheeks back into the cone
    for (const sg of [-1, 1]) { const sN = [tu * sg, 0, tw * sg]; R.GR.quad(M(sg * hwD, yE - 0.02, 0), M(sg * hwD, yS, 0), M(sg * hwD, yS, -0.7), M(sg * hwD, yE - 0.02, -0.7), shade(WH, 0.9), [2, 1, 3], sN); }
    // the coping along the rakes, the little roof behind the gable, the finial at the apex
    for (const sg of [-1, 1]) {
      const p0 = M(sg * (hwD + 0.08), yS - 0.04, 0.05), p1 = M(0, yA + 0.08, 0.05), q0 = M(sg * (hwD + 0.08), yS - 0.04, -0.8), q1 = M(0, yA + 0.08, -0.8);
      const nR = nrm3([tu * sg * 0.64, 0.7, tw * sg * 0.64]);
      R.GR.quad(p0, p1, q1, q0, shade(WH, 0.97), [2, 3, 4], nR);
      R.GR.quad(M(sg * (hwD + 0.08), yS - 0.13, 0.05), M(0, yA - 0.02, 0.05), p1, p0, shade(WH, 0.9), [2, 3, 4], fN);
      R.SL.quad(M(sg * hwD, yS - 0.03, -0.02), M(0, yA - 0.01, -0.02), M(0, yA - 0.12, -1.0), M(sg * hwD, yS - 0.62, -1.0), shade(WH, 0.95), [3, 1, 2], nR);
    }
    { const p = M(0, 0, 0.02); lathe(R.GR, p[0], p[2], [[0.07, yA + 0.06], [0.09, yA + 0.16], [0.05, yA + 0.32], [0.015, yA + 0.44]], 8, c, Z3, true); }
    // the oculus: its moulded ring, the reveal, the dark glass
    for (let k = 0; k < 20; k++) {
      const t0 = (k / 20) * Math.PI * 2, t1 = ((k + 1) / 20) * Math.PI * 2;
      const P = (rad, t, tt) => M(Math.cos(t) * rad, oc + Math.sin(t) * rad, tt);
      R.GR.quad(P(ro, t0, 0.06), P(ro, t1, 0.06), P(rh + 0.02, t1, 0.06), P(rh + 0.02, t0, 0.06), shade(WH, 0.96), [1, 1, 1], fN);
      R.GR.quad(P(rh + 0.02, t0, 0.0), P(rh + 0.02, t1, 0.0), P(rh + 0.02, t1, 0.06), P(rh + 0.02, t0, 0.06), shade(WH, 0.85), [1, 1, 1]);
      R.GR.quad(P(ro, t0, 0.06), P(ro, t1, 0.06), P(ro, t1, -0.16), P(ro, t0, -0.16), shade(WH, 0.66), [1, 1, 1]);
      R.GR.quad(P(rh, t0, 0.0), P(rh, t1, 0.0), P(rh, t1, -0.04), P(rh, t0, -0.04), shade(WH, 0.66), [1, 1, 1]);
      R.GL.tri(M(0, oc, -0.15), P(ro, t0, -0.15), P(ro, t1, -0.15), fN, fN, fN, C.glass);
    }
    // the pilasters either side of the face
    for (const sg of [-1, 1]) wallBox(R.GR, Wd, hwD + sg * (hwD - 0.07) - 0.07, hwD + sg * (hwD - 0.07) + 0.07, yE - 0.02, yS + 0.02, 0.0, 0.06, shade(WH, 0.96), [4, 4, 1]);
  }
  // the cone's top: a lead cap, the railing round it, the flagstaff
  const yt = yE + cone;
  lathe(R.IR, u, w, [[rTop + 0.06, yt - 0.04], [rTop + 0.06, yt + 0.04], [0.0, yt + 0.06]], 16, C.lead, Z3, true);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; rod(R.IR, [u + Math.cos(a) * rTop, yt + 0.04, w + Math.sin(a) * rTop], [u + Math.cos(a) * rTop, yt + 0.5, w + Math.sin(a) * rTop], 0.014, C.iron); }
  lathe(R.IR, u, w, [[rTop + 0.02, yt + 0.47], [rTop + 0.02, yt + 0.52]], 16, C.iron, Z3, false);
  lathe(R.WD, u, w, [[0.05, yt], [0.04, yt + 4.6], [0.03, yt + 5.3]], 8, C.pole, Z3, true);
  lathe(R.IR, u, w, [[0.06, yt + 5.28], [0.07, yt + 5.34], [0.0, yt + 5.42]], 8, K(0xb59a4a), Z3, true);
  void rr;
  return { staffTop: yt + 5.2 };
}

// ---- the flags: the colours and, under them, the black POW/MIA flag, rippling from the staff ---------------------------------------
function flag(R, u, w, y, len, hgt, kind) {
  const nx = 14, ny = 12, P = [], du = 0.97, dw = -0.24;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) {
    const s = i / nx, v = j / ny, amp = 0.2 * s, ph = s * 7.0 - 0.6 + (kind ? 1.3 : 0), rp = Math.sin(ph) * amp * 0.5;
    P.push([u + du * s * len - dw * rp, y - v * hgt - 0.06 * s, w + dw * s * len + du * rp]);
  }
  const at = (i, j) => P[j * (nx + 1) + i];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const s = (i + 0.5) / nx, v = (j + 0.5) / ny, canton = s < 0.42 && v < 0.54;
    const col = kind ? (Math.abs(s - 0.5) < 0.16 && Math.abs(v - 0.5) < 0.2 ? C.flagW : C.flagK) : canton ? C.flagB : (Math.floor(v * 13) % 2 === 0 ? C.flagR : C.flagW);
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    const n = nrm3([(b[1] - a[1]) * (d[2] - a[2]) - (b[2] - a[2]) * (d[1] - a[1]), (b[2] - a[2]) * (d[0] - a[0]) - (b[0] - a[0]) * (d[2] - a[2]), (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0])]);
    R.CL.quad(a, b, c, d, col, Z3, n);
  }
}

// ---- the wing ------------------------------------------------------------------------------------------------------------------------
// an arcaded parapet (Mould's pierced band): small round-headed openings at ~0.44 m centres in a dressed band th thick
function arcade(R, Wf, s0, s1, y0, y1, th, seed) {
  const n = Math.max(1, Math.round((s1 - s0) / 0.44)), P = (s1 - s0) / n, ow = 0.2, oy0 = y0 + 0.1, ys = oy0 + 0.22, yh = ys + ow / 2, rr = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = s0 + i * P, b = a + P, c = (a + b) / 2, l = c - ow / 2, r2 = c + ow / 2, cc = shade(WH, 0.92 + 0.12 * rr()), off = rr3(rr);
    wallBox(R.GR, Wf, a, b, y0, oy0, -th, 0.0, cc, off);
    wallBox(R.GR, Wf, a, l, oy0, yh, -th, 0.0, cc, off);
    wallBox(R.GR, Wf, r2, b, oy0, yh, -th, 0.0, cc, off);
    wallBox(R.GR, Wf, a, b, yh, y1, -th, 0.0, cc, off);
    // the heads: the spandrels between the half circle and the square over the springing, outside and in, and the soffit
    const nO = Wf.N(c), nI = [-nO[0], -nO[1], -nO[2]], m = 5;
    for (let k = 0; k < m; k++) {
      const t0 = Math.PI * (k / m), t1 = Math.PI * ((k + 1) / m);
      const A = [c + Math.cos(t0) * ow / 2, ys + Math.sin(t0) * ow / 2], Bq = [c + Math.cos(t1) * ow / 2, ys + Math.sin(t1) * ow / 2];
      const corner = k < m / 2 ? [r2, yh] : [l, yh];
      for (const [t, nn] of [[0.0, nO], [-th, nI]]) R.GR.tri(Wf.M(A[0], A[1], t), Wf.M(Bq[0], Bq[1], t), Wf.M(corner[0], corner[1], t), nn, nn, nn, cc, off);
      const nm = Math.cos((t0 + t1) / 2), ny = Math.sin((t0 + t1) / 2), d = Wf.d || [0, 0];
      const nS = nrm3([-(d[0] * nm), -ny, -(d[1] * nm)]);
      R.GR.quad(Wf.M(A[0], A[1], 0), Wf.M(Bq[0], Bq[1], 0), Wf.M(Bq[0], Bq[1], -th), Wf.M(A[0], A[1], -th), shade(cc, 0.8), off, nS);
    }
  }
}
// a corbelled bartizan: an octagonal turret on a stepped corbel with a pendant, its band and coped parapet
function bartizan(R, cu, cw, y0, y1, seed) {
  const rr = rng(seed), a0 = Math.PI / 8, n = 8;
  lathe(R.GR, cu, cw, [[0.0, y0 - 1.05], [0.05, y0 - 0.98], [0.04, y0 - 0.86], [0.09, y0 - 0.76], [0.09, y0 - 0.66], [0.15, y0 - 0.5], [0.15, y0 - 0.4], [0.2, y0 - 0.2], [0.2, y0]], n, shade(WH, 0.95), [2, 1, 3], false, a0);
  lathe(R.GR, cu, cw, [[0.2, y0], [0.3, y0 + 0.1], [0.3, y0 + 0.2], [0.42, y0 + 0.3], [0.42, y0 + 0.42], [0.52, y0 + 0.52], [0.52, y0 + 0.62], [0.6, y0 + 0.7]], n, shade(WH, 0.97), [1, 3, 2], false, a0);
  for (let y = y0 + 0.7; y < y1 - 0.5 - 0.05;) {
    const h = Math.min(0.32, y1 - 0.5 - y);
    lathe(R.GR, cu, cw, [[0.56, y + 0.005], [0.56, y + h - 0.005]], n, shade(WH, 0.88 + 0.16 * rr()), rr3(rr), false, a0);
    y += h;
  }
  lathe(R.GR, cu, cw, [[0.56, y1 - 0.5], [0.64, y1 - 0.46], [0.64, y1 - 0.36], [0.58, y1 - 0.34], [0.58, y1 - 0.1], [0.64, y1 - 0.08], [0.64, y1], [0.0, y1 + 0.02]], n, shade(WH, 1.0), [3, 2, 1], false, a0);
}
function wing(R, B) {
  const { u0, u1, w0, w1, roof, top } = WING, yR = B + roof, yC = B + top - 0.14;
  const N = [[u0, w0], [u1, w0]], E = [[u1, w0], [u1, 0]], S = [[u1, w1], [u0, w1]], Ww = [[u0, w1], [u0, w0]];
  const win = (s) => rarch(s, B + 0.85, 0.95, 2.0);
  const opsN = [1.4, 3.35, 5.3, 7.25].map(win), opsW = [rarch(1.62, B + 0.0, 1.3, 2.95), rarch(3.72, B + 0.0, 1.3, 2.95)], opsS = [2.2, 4.4, 6.6].map((s) => rarch(s, B + 0.85, 0.85, 1.85));
  face(R, ...N, B - 6.6, B + 0.1, yR, { seed: 51, ops: opsN, k: 0.24, wet: B - 3.7, ext: [false, true] });
  face(R, ...E, B - 6.6, B + 0.1, yR, { seed: 52, ops: [], k: 0.24, wet: B - 3.4, ext: [true, false] });
  face(R, ...S, B - 3.6, B + 0.1, yR, { seed: 53, ops: opsS });
  rub(R, flatWall(...Ww, -1), B - 0.4, yR, { ...STONE, seed: 54, ops: opsW });
  opsN.forEach((op, i) => trim(R, flatWall(...N, -1), op, 300 + i, { depth: 0.55, wd: 0.22 }));
  opsW.forEach((op, i) => trim(R, flatWall(...Ww, -1), op, 310 + i, { depth: 0.95, wd: 0.26, glass: K(0x20262c), noSill: true }));
  opsS.forEach((op, i) => trim(R, flatWall(...S, -1), op, 320 + i, { depth: 0.5 }));
  for (const [F, sd, low] of [[N, 1, true], [E, 2, true], [S, 3, false], [Ww, 4, false]]) {
    const Wf = flatWall(...F, -1);
    if (low) moulding(R.GR, Wf, 0, Wf.L, B + 0.1, WTAB, WH, { blk: 1.0, seed: 350 + sd });
    else moulding(R.GR, Wf, 0, Wf.L, B - 0.4, [[0, 0], [0.1, 0], [0.1, 0.3], [0.05, 0.36], [0, 0.36]], WH, { blk: 1.0, seed: 350 + sd });
    moulding(R.GR, Wf, 0, Wf.L, yR - 0.12, CORNICE, WH, { blk: 1.0, seed: 370 + sd });
    arcade(R, Wf, sd === 4 ? 0.7 : 0.05, sd === 4 ? Wf.L - 0.7 : Wf.L - 0.05, yR + 0.16, yC, 0.32, 380 + sd);
    moulding(R.GR, Wf, 0, Wf.L, yC, COPE, WH, { blk: 1.1, seed: 390 + sd });
  }
  // the bartizans at the west corners (onto the terrace), their tops over the parapet
  bartizan(R, u0 - 0.2, w0 - 0.2, B + 2.55, B + top + 0.42, 395);
  bartizan(R, u0 - 0.2, w1 + 0.2, B + 2.55, B + top + 0.42, 396);
  paving(R, [[u0 + 0.02, w0], [u1, w0], [u1, w1], [u0 + 0.02, w1]], yR + 0.13, [], 399);
}

// ---- the timber lookout on the keep's roof ----------------------------------------------------------------------------------------------
function gazebo(R, B) {
  const { u, w, hw } = GAZ, y0 = B + KEEP.roof, yP = y0 + 0.32, yE = yP + 2.05, rr = rng(606);
  // its stone base (the stair's hood), then posts at the corners and the thirds
  blockBox(R.GR, u - hw - 0.1, u + hw + 0.1, y0 - 0.02, yP, w - hw - 0.1, w + hw + 0.1, shade(WH, 0.92), [3, 3, 3], 0.03);
  const pts = [];
  for (let i = 0; i <= 3; i++) for (const s of [-1, 1]) { pts.push([u - hw + (2 * hw * i) / 3, w + s * hw]); if (i > 0 && i < 3) pts.push([u + s * hw, w - hw + (2 * hw * i) / 3]); }
  for (const [pu, pw] of pts) {
    blockBox(R.WD, pu - 0.065, pu + 0.065, yP, yE - 0.26, pw - 0.065, pw + 0.065, C.cream, Z3, 0.01);
    blockBox(R.WD, pu - 0.085, pu + 0.085, yE - 0.26, yE - 0.18, pw - 0.085, pw + 0.085, C.red, Z3, 0.01);
  }
  // the frieze (red board, cream edge), the brackets, the rail
  for (const [a, b] of [[[u - hw, w - hw], [u + hw, w - hw]], [[u + hw, w - hw], [u + hw, w + hw]], [[u + hw, w + hw], [u - hw, w + hw]], [[u - hw, w + hw], [u - hw, w - hw]]]) {
    const Wf = flatWall(a, b, -1), L = Wf.L;
    wallBox(R.WD, Wf, -0.08, L + 0.08, yE - 0.18, yE + 0.06, -0.05, 0.05, C.red, Z3);
    wallBox(R.WD, Wf, -0.09, L + 0.09, yE - 0.22, yE - 0.18, -0.06, 0.06, C.cream, Z3);
    for (let i = 0; i < 3; i++) {
      const sa = (L * i) / 3, sb = (L * (i + 1)) / 3, cm = (sa + sb) / 2;
      rod(R.WD, Wf.M(sa + 0.06, yE - 0.62, 0), Wf.M(cm - 0.05, yE - 0.24, 0), 0.022, C.cream);
      rod(R.WD, Wf.M(sb - 0.06, yE - 0.62, 0), Wf.M(cm + 0.05, yE - 0.24, 0), 0.022, C.cream);
      wallBox(R.WD, Wf, sa + 0.07, sb - 0.07, yP + 0.88, yP + 0.95, -0.04, 0.04, C.cream, Z3);
      for (let s = sa + 0.17; s < sb - 0.12; s += 0.15) wallBox(R.WD, Wf, s - 0.016, s + 0.016, yP + 0.08, yP + 0.88, -0.016, 0.016, C.cream, Z3);
    }
  }
  // the ceiling and the pyramidal roof in slate courses, its hips and the finial
  const ov = 0.55, rE = (hw + ov) * Math.SQRT2;
  R.WD.quad([u - hw - ov, yE + 0.05, w - hw - ov], [u + hw + ov, yE + 0.05, w - hw - ov], [u + hw + ov, yE + 0.05, w + hw + ov], [u - hw - ov, yE + 0.05, w + hw + ov], C.board, Z3, [0, -1, 0]);
  slateRoof(R.SL, u, w, rE, yE + 0.08, 0.06, yE + 1.3, 4, 10, shade(WH, 1.0), true, Math.PI / 4);
  for (let k = 0; k < 4; k++) { const a = Math.PI / 4 + k * Math.PI / 2; rod(R.IR, [u + Math.cos(a) * rE, yE + 0.12, w + Math.sin(a) * rE], [u + Math.cos(a) * 0.08, yE + 1.32, w + Math.sin(a) * 0.08], 0.025, C.lead); }
  lathe(R.IR, u, w, [[0.06, yE + 1.26], [0.08, yE + 1.36], [0.04, yE + 1.5], [0.06, yE + 1.58], [0.015, yE + 1.85]], 8, C.copper, Z3, true);
  void rr;
}

// ---- the pavilions -------------------------------------------------------------------------------------------------------------------
// a hipped roof over u0..u1 x w0..w1 (the ridge along u) from its eave yE up `rise`, in courses of slates (their lower edges lipped
// out) coloured in turn from `bands` (the banded slates of Mould's roofs); the ridge's roll and cresting, the hips' rolls
function hipRoof(R, u0, u1, w0, w1, yE, rise, nc, bands, seed) {
  const hw = (w1 - w0) / 2, wc = (w0 + w1) / 2, rr = rng(seed), lw = Math.hypot(hw, rise);
  const nN = [0, hw / lw, -rise / lw], nS = [0, hw / lw, rise / lw], nW = [-rise / lw, hw / lw, 0], nE = [rise / lw, hw / lw, 0];
  const at = (f) => [u0 + f * hw, u1 - f * hw, w0 + f * hw, w1 - f * hw, yE + f * rise];
  for (let k = 0; k < nc; k++) {
    const [a0, a1, b0, b1, y0] = at(k / nc), [c0, c1, d0, d1, y1] = at((k + 1) / nc), lp = 0.035, ly = 0.016;
    const col = shade(bands[Math.floor((k * bands.length) / nc) % bands.length], 0.9 + 0.18 * rr()), off = rr3(rr);
    R.SL.quad([a0 - lp, y0 - ly, b0 - lp], [a1 + lp, y0 - ly, b0 - lp], [c1, y1, d0], [c0, y1, d0], col, off, nN);
    R.SL.quad([a1 + lp, y0 - ly, b1 + lp], [a0 - lp, y0 - ly, b1 + lp], [c0, y1, d1], [c1, y1, d1], col, off, nS);
    R.SL.tri([a0 - lp, y0 - ly, b1 + lp], [a0 - lp, y0 - ly, b0 - lp], [c0, y1, d0], nW, nW, nW, col, off);
    R.SL.tri([a0 - lp, y0 - ly, b1 + lp], [c0, y1, d0], [c0, y1, d1], nW, nW, nW, col, off);
    R.SL.tri([a1 + lp, y0 - ly, b0 - lp], [a1 + lp, y0 - ly, b1 + lp], [c1, y1, d1], nE, nE, nE, col, off);
    R.SL.tri([a1 + lp, y0 - ly, b0 - lp], [c1, y1, d1], [c1, y1, d0], nE, nE, nE, col, off);
  }
  const yR = yE + rise, ua = u0 + hw, ub = u1 - hw;
  if (ub - ua > 0.05) {
    blockBox(R.IR, ua - 0.04, ub + 0.04, yR - 0.03, yR + 0.07, wc - 0.07, wc + 0.07, C.lead, Z3, 0.02);
    // the cresting along the ridge: little iron finials
    for (let s = ua; s <= ub + 1e-6; s += 0.3) rod(R.IR, [s, yR + 0.06, wc], [s, yR + 0.24, wc], 0.012, C.iron);
    blockBox(R.IR, ua, ub, yR + 0.2, yR + 0.23, wc - 0.012, wc + 0.012, C.iron, Z3, 0.004);
  }
  for (const [eu, ew, tu] of [[u0, w0, ua], [u1, w0, ub], [u1, w1, ub], [u0, w1, ua]]) rod(R.IR, [eu, yE + 0.04, ew], [tu, yR + 0.04, wc], 0.03, C.lead);
  for (const s of [ua, ub]) lathe(R.IR, s, wc, [[0.05, yR + 0.04], [0.08, yR + 0.16], [0.04, yR + 0.34], [0.06, yR + 0.42], [0.012, yR + 0.8]], 8, C.copper, Z3, true);
}
// the posts, the fretwork and the frieze round an open rectangle; the ceiling, the fascia, the roof
function openPavilion(R, P, fl, post, o) {
  const { u0, u1, w0, w1 } = P, yE = fl + post, rr = rng(o.seed);
  const side = (a, b, n) => { const pts = []; for (let i = 0; i <= n; i++) pts.push([a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n]); return pts; };
  const nu = Math.max(1, Math.round((u1 - u0) / (o.bay || 1.7))), nw = Math.max(1, Math.round((w1 - w0) / (o.bay || 1.7)));
  const sides = [[[u0, w0], [u1, w0], nu], [[u1, w0], [u1, w1], nw], [[u1, w1], [u0, w1], nu], [[u0, w1], [u0, w0], nw]];
  const posts = new Map();
  sides.forEach(([a, b, n]) => side(a, b, n).forEach((p) => posts.set(p[0].toFixed(2) + ',' + p[1].toFixed(2), p)));
  for (const [pu, pw] of posts.values()) {
    blockBox(R.WD, pu - 0.1, pu + 0.1, fl, fl + 0.22, pw - 0.1, pw + 0.1, C.red, Z3, 0.015);
    blockBox(R.WD, pu - 0.075, pu + 0.075, fl + 0.22, yE - 0.42, pw - 0.075, pw + 0.075, C.cream, Z3, 0.02);
    blockBox(R.WD, pu - 0.06, pu + 0.06, fl + 0.6, yE - 0.8, pw - 0.06, pw + 0.06, C.red, Z3, 0.01);       // the chamfers picked out
    blockBox(R.WD, pu - 0.105, pu + 0.105, yE - 0.42, yE - 0.3, pw - 0.105, pw + 0.105, C.green, Z3, 0.015);
  }
  sides.forEach(([a, b, n], si) => {
    const Wf = flatWall(a, b, -1), L = Wf.L, bay = L / n;
    // the frieze: a deep board in red with cream mouldings, pierced with a row of quatrefoil-ish holes (dark discs)
    wallBox(R.WD, Wf, -0.12, L + 0.12, yE - 0.3, yE + 0.1, -0.06, 0.06, C.red, Z3);
    wallBox(R.WD, Wf, -0.13, L + 0.13, yE - 0.34, yE - 0.3, -0.07, 0.07, C.cream, Z3);
    wallBox(R.WD, Wf, -0.13, L + 0.13, yE + 0.1, yE + 0.14, -0.07, 0.07, C.cream, Z3);
    {
      const nO = Wf.N(0), ym = yE - 0.1, t = 0.064;
      for (let s = 0.2, k = 0; s < L - 0.1; s += 0.22, k++) {
        if (k % 2 === 0) R.WD.quad(Wf.M(s, ym + 0.12, t), Wf.M(s + 0.085, ym, t), Wf.M(s, ym - 0.12, t), Wf.M(s - 0.085, ym, t), C.cream, Z3, nO);
        else for (let q = 0; q < 6; q++) { const a0 = (q / 6) * Math.PI * 2, a1 = ((q + 1) / 6) * Math.PI * 2; R.WD.tri(Wf.M(s, ym, t), Wf.M(s + Math.cos(a0) * 0.035, ym + Math.sin(a0) * 0.035, t), Wf.M(s + Math.cos(a1) * 0.035, ym + Math.sin(a1) * 0.035, t), nO, nO, nO, C.green); }
      }
    }
    for (let i = 0; i < n; i++) {
      const sa = i * bay, sb = (i + 1) * bay, cm = (sa + sb) / 2, ya = yE - 0.34, hA = Math.min(0.85, bay * 0.45);
      // the fretwork arch: a cusped curve of cream from post to post, spindles over it, a pendant at the crown
      const arc = [];
      for (let k = 0; k <= 8; k++) { const t = k / 8, x = sa + 0.08 + (sb - sa - 0.16) * t, yy = ya - hA * Math.pow(Math.abs(1 - 2 * t), 1.6) - 0.03; arc.push(Wf.M(x, yy, 0)); }
      for (let k = 0; k < 8; k++) rod(R.WD, arc[k], arc[k + 1], 0.024, C.cream);
      for (let k = 1; k < 8; k++) if (k !== 4) { const p = arc[k]; rod(R.WD, p, [p[0], ya, p[2]], 0.012, k % 2 ? C.red : C.cream); }
      lathe(R.WD, ...(() => { const p = Wf.M(cm, 0, 0); return [p[0], p[2]]; })(), [[0.0, ya - 0.28], [0.04, ya - 0.2], [0.03, ya - 0.08], [0.02, ya]], 6, C.red, Z3, true);
      // the balustrade, open in the entrance bays
      if (o.open && o.open(si, i, n)) continue;
      wallBox(R.WD, Wf, sa + 0.1, sb - 0.1, fl + 0.82, fl + 0.9, -0.05, 0.05, C.green, Z3);
      wallBox(R.WD, Wf, sa + 0.1, sb - 0.1, fl + 0.1, fl + 0.16, -0.04, 0.04, C.green, Z3);
      for (let s = sa + 0.2; s < sb - 0.14; s += 0.13) wallBox(R.WD, Wf, s - 0.018, s + 0.018, fl + 0.16, fl + 0.82, -0.018, 0.018, C.cream, Z3);
    }
  });
  // the boarded ceiling under the roof, the fascia round the eave
  const ov = o.ov ?? 0.6;
  R.WD.quad([u0 - ov, yE + 0.15, w0 - ov], [u1 + ov, yE + 0.15, w0 - ov], [u1 + ov, yE + 0.15, w1 + ov], [u0 - ov, yE + 0.15, w1 + ov], C.board, Z3, [0, -1, 0]);
  for (const [a, b] of [[[u0 - ov, w0 - ov], [u1 + ov, w0 - ov]], [[u1 + ov, w0 - ov], [u1 + ov, w1 + ov]], [[u1 + ov, w1 + ov], [u0 - ov, w1 + ov]], [[u0 - ov, w1 + ov], [u0 - ov, w0 - ov]]]) {
    const Wf = flatWall(a, b, -1);
    wallBox(R.WD, Wf, -0.02, Wf.L + 0.02, yE + 0.06, yE + 0.24, -0.05, 0.0, C.cream, Z3);
    { const nO = Wf.N(0); for (let s = 0.0; s + 0.16 <= Wf.L + 1e-6; s += 0.16) R.WD.tri(Wf.M(s, yE + 0.065, -0.03), Wf.M(s + 0.16, yE + 0.065, -0.03), Wf.M(s + 0.08, yE - 0.07, -0.03), nO, nO, nO, C.cream); }
  }
  hipRoof(R, u0 - ov, u1 + ov, w0 - ov, w1 + ov, yE + 0.22, o.rise, o.nc, o.bands, o.seed + 1);
  void rr;
}
// the lookout tower at the open pavilion's west end: an open timber stage with lattice panels, a flared skirt roof, a glazed
// lantern and a steep pyramidal cap with its finial
function lookoutTower(R, B) {
  const { u, w, hw } = TOWER, fl = B + PLAT.h, y1 = fl + 4.0, rr = rng(707);
  const pts = [];
  for (const su of [-1, 0, 1]) for (const sw of [-1, 0, 1]) if (su || sw) pts.push([u + su * hw, w + sw * hw]);
  for (const [pu, pw] of pts) {
    blockBox(R.WD, pu - 0.1, pu + 0.1, fl, fl + 0.25, pw - 0.1, pw + 0.1, C.red, Z3, 0.015);
    blockBox(R.WD, pu - 0.08, pu + 0.08, fl + 0.25, y1, pw - 0.08, pw + 0.08, C.cream, Z3, 0.02);
  }
  const ring = [[[u - hw, w - hw], [u + hw, w - hw]], [[u + hw, w - hw], [u + hw, w + hw]], [[u + hw, w + hw], [u - hw, w + hw]], [[u - hw, w + hw], [u - hw, w - hw]]];
  ring.forEach(([a, b], si) => {
    const Wf = flatWall(a, b, -1), L = Wf.L;
    // the lattice panels under the frieze (crossed red slats in a cream frame), the frieze, the rail
    for (const [sa, sb] of [[0.08, L / 2 - 0.08], [L / 2 + 0.08, L - 0.08]]) {
      const ya = y1 - 1.25, yb = y1 - 0.35;
      wallBox(R.WD, Wf, sa, sb, ya - 0.05, ya, -0.04, 0.04, C.cream, Z3);
      wallBox(R.WD, Wf, sa, sb, yb, yb + 0.05, -0.04, 0.04, C.cream, Z3);
      for (let k = 0; k <= 4; k++) {
        const s = sa + (sb - sa) * k / 4;
        rod(R.WD, Wf.M(s, ya, 0), Wf.M(Math.min(sb, s + (sb - sa) / 2), yb, 0), 0.015, C.red);
        rod(R.WD, Wf.M(s, ya, 0), Wf.M(Math.max(sa, s - (sb - sa) / 2), yb, 0), 0.015, C.red);
      }
      if (si === 2) continue;
      wallBox(R.WD, Wf, sa, sb, fl + 0.85, fl + 0.92, -0.05, 0.05, C.green, Z3);
      for (let s = sa + 0.12; s < sb - 0.06; s += 0.13) wallBox(R.WD, Wf, s - 0.018, s + 0.018, fl + 0.12, fl + 0.85, -0.018, 0.018, C.cream, Z3);
    }
    wallBox(R.WD, Wf, -0.1, L + 0.1, y1 - 0.35, y1 + 0.05, -0.07, 0.07, C.red, Z3);
    wallBox(R.WD, Wf, -0.12, L + 0.12, y1 + 0.05, y1 + 0.1, -0.08, 0.08, C.cream, Z3);
  });
  const sk = (hw + 0.75) * Math.SQRT2, lw = hw - 0.42;
  R.WD.quad([u - hw - 0.75, y1 + 0.12, w - hw - 0.75], [u + hw + 0.75, y1 + 0.12, w - hw - 0.75], [u + hw + 0.75, y1 + 0.12, w + hw + 0.75], [u - hw - 0.75, y1 + 0.12, w + hw + 0.75], C.board, Z3, [0, -1, 0]);
  const bands = [shade(C.slR, 0.95), shade(C.slG, 0.85), shade(C.slR, 0.95), shade(C.slD, 0.9)];
  slateRoof(R.SL, u, w, sk, y1 + 0.14, (lw + 0.05) * Math.SQRT2, y1 + 1.05, 4, 8, shade(WH, 1.0), true, Math.PI / 4, bands);
  // the lantern: corner boards, glazing, a frieze
  for (const [a, b] of [[[u - lw, w - lw], [u + lw, w - lw]], [[u + lw, w - lw], [u + lw, w + lw]], [[u + lw, w + lw], [u - lw, w + lw]], [[u - lw, w + lw], [u - lw, w - lw]]]) {
    const Wf = flatWall(a, b, -1), L = Wf.L;
    wallBox(R.GL, Wf, 0.1, L - 0.1, y1 + 1.05, y1 + 2.05, -0.06, -0.02, C.glass, Z3);
    for (const s of [0.05, L / 2, L - 0.05]) wallBox(R.WD, Wf, s - 0.06, s + 0.06, y1 + 1.0, y1 + 2.1, -0.05, 0.03, C.cream, Z3);
    wallBox(R.WD, Wf, -0.04, L + 0.04, y1 + 1.5, y1 + 1.56, -0.04, 0.02, C.red, Z3);
    wallBox(R.WD, Wf, -0.08, L + 0.08, y1 + 2.05, y1 + 2.3, -0.06, 0.05, C.red, Z3);
  }
  slateRoof(R.SL, u, w, (lw + 0.38) * Math.SQRT2, y1 + 2.3, 0.05, y1 + 4.5, 4, 14, shade(WH, 1.0), true, Math.PI / 4, bands);
  lathe(R.IR, u, w, [[0.07, y1 + 4.4], [0.1, y1 + 4.52], [0.05, y1 + 4.75], [0.08, y1 + 4.85], [0.015, y1 + 5.4]], 8, C.copper, Z3, true);
  void rr;
}
function pavilions(R, B) {
  const bands = [shade(C.slD, 0.9), shade(C.slR, 0.95), shade(C.slG, 0.9), shade(C.slR, 0.9), shade(C.slD, 0.85)];
  openPavilion(R, PAV, B + PLAT.h, 2.55, { seed: 801, rise: 1.95, nc: 18, bands, ov: 0.62, open: (si, i, n) => si === 2 && (i === Math.floor(n / 2) || i === Math.floor((n - 1) / 2)) });
  lookoutTower(R, B);
  const b2 = [shade(C.slD, 0.85), shade(C.slG, 0.85)];
  // the second pavilion stands on a low plinth on the walk
  blockBox(R.GR, PAV2.u0 - 0.2, PAV2.u1 + 0.2, B - 0.05, B + 0.3, PAV2.w0 - 0.2, PAV2.w1 + 0.2, shade(WH, 0.92), [5, 5, 5], 0.03);
  openPavilion(R, PAV2, B + 0.3, 2.45, { seed: 811, rise: 1.7, nc: 12, bands: b2, ov: 0.55, open: (si, i) => si === 0 && i === 1 });
}

// ---- the building as a whole -------------------------------------------------------------------------------------------------------------
function castleBody(R, B) {
  keep(R, B);
  wing(R, B);
  const t = turret(R, B);
  gazebo(R, B);
  flag(R, TUR.u, TUR.w, t.staffTop - 0.08, 1.75, 1.1, 0);
  flag(R, TUR.u, TUR.w, t.staffTop - 1.45, 1.1, 0.72, 1);
  return t;
}

// ---- the planting in the rock's joints ----------------------------------------------------------------------------------------------------
// Clumps of shrubs on the ledges (instanced crossed cards under a procedural leaf atlas): where the rock is broken (the benches'
// flats and the cracks between), mostly on the upper ledges and along the foot.
let _leafTex = null;
function leafTexture() {
  if (_leafTex) return _leafTex;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  const g = cv.getContext('2d'), r = rng(9);
  g.clearRect(0, 0, 512, 512);
  const cols = ['#22431b', '#2a4f1f', '#33602a', '#3b6a2a', '#456f2c', '#527b32', '#1c3818', '#6a8a36', '#2d5424'];
  for (let i = 0; i < 260; i++) {
    const ang = (r() - 0.5) * 2.6 - Math.PI / 2, len = 30 + r() * 62, bx = 256 + (r() - 0.5) * 96, by = 500 - r() * 50 + (r() - 0.5) * 30;
    const lift = r();
    const x = bx + Math.cos(ang) * len * (0.4 + lift * 2.4), y = by + Math.sin(ang) * len * (0.4 + lift * 2.7);
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
    const w = 3.5 + r() * 5, h = 14 + r() * 22;
    g.fillStyle = cols[(r() * cols.length) | 0];
    g.beginPath(); g.moveTo(0, -h); g.quadraticCurveTo(w * 1.5, -h * 0.2, 0, h * 0.8); g.quadraticCurveTo(-w * 1.5, -h * 0.2, 0, -h); g.fill();
    g.strokeStyle = 'rgba(200,215,150,0.30)'; g.lineWidth = 0.9; g.beginPath(); g.moveTo(0, -h * 0.9); g.lineTo(0, h * 0.7); g.stroke();
    g.restore();
  }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  _leafTex = t;
  return t;
}
let _shrubMat = null;
function shrubMat() {
  if (_shrubMat) return _shrubMat;
  const t = leafTexture();
  if (!t) return null;
  const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, vertexColors: false });
  m.name = 'cp33c:shrub';
  m.color.setRGB(1.75, 1.8, 1.7);
  applyLightTrim(m);
  applyCityAO(m);
  _shrubMat = m;
  return m;
}
function shrubGeo() {
  const P = [], N = [], U = [], I = [];
  const quad = (a, b, c, d, n) => { const k = P.length / 3; P.push(...a, ...b, ...c, ...d); for (let i = 0; i < 4; i++) N.push(...n); U.push(0, 0, 1, 0, 1, 1, 0, 1); I.push(k, k + 1, k + 2, k, k + 2, k + 3); };
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); quad([-c, 0, -s], [c, 0, s], [c, 1.5, s], [-c, 1.5, -s], [-s, 0, c]); }
  quad([-1, 0.55, -1], [1, 0.55, -1], [1, 0.75, 1], [-1, 0.75, 1], [0, 1, 0]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2)); g.setIndex(I);
  return g;
}
function bedPlants(B) {
  const mat = shrubMat();
  const r = rng(4242), M = [], col = [], P = [], Cc = [], AT = [];
  let U0 = 1e9, U1 = -1e9, W0 = 1e9, W1 = -1e9;
  for (const [a, b] of BED) { U0 = Math.min(U0, a); U1 = Math.max(U1, a); W0 = Math.min(W0, b); W1 = Math.max(W1, b); }
  for (let k = 0; k < 4000 && (M.length < 70 || P.length < 1400 * 9); k++) {
    const u = U0 + r() * (U1 - U0), w = W0 + r() * (W1 - W0), dd = polyDist(BED, u, w);
    if (dd > -0.25) continue;
    const [x, z] = toW(u, w);
    if (M.length < 70 && dd < -0.6 && r() < 0.5) {
      const s = 0.45 + r() * 0.55, m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(x, B + 0.12, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * Math.PI * 2, (r() - 0.5) * 0.2)), new THREE.Vector3(s, s * (0.8 + 0.5 * r()), s));
      M.push(m); const t = 0.6 + 0.5 * r(); col.push(new THREE.Color(t * (0.8 + 0.3 * r()), t, t * (0.7 + 0.25 * r())));
    } else if (P.length < 1400 * 9) {
      const h0 = r(), h1 = r(), h2 = r();
      pushTuft(P, Cc, AT, x, B + 0.15, z, 0.12 + 0.22 * h2, 0.22 + 0.2 * h1, h2, h0, (u * 0.37 + w * 1.3) % 97);
    }
  }
  const out = [];
  if (mat && M.length) {
    const im = new THREE.InstancedMesh(shrubGeo(), mat, M.length);
    M.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col[i]); });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = true; im.receiveShadow = true; im.name = 'cpc33:bed:shrubs'; im.computeBoundingSphere();
    out.push(im);
  }
  if (P.length) { const m = new THREE.Mesh(tuftGeo(P, Cc, AT), tuftMat()); m.name = 'cpc33:bed:tufts'; m.castShadow = false; m.receiveShadow = true; out.push(m); }
  return out;
}
function plants(B, count, surf) {
  const mat = shrubMat();
  if (!mat) return null;
  const r = rng(1313), M = [], col = [];
  const slopeAt = (u, w) => { const e = 0.35, dx = surf(u + e, w) - surf(u - e, w), dz = surf(u, w + e) - surf(u, w - e); return Math.hypot(dx, dz) / (2 * e); };
  const cavAt = (u, w, y) => (surf(u + 0.7, w) + surf(u - 0.7, w) + surf(u, w + 0.7) + surf(u, w - 0.7)) / 4 - y;
  let tries = 0;
  while (M.length < count && tries++ < count * 90) {
    const u = -36 + r() * 56, w = -44 + r() * 58, [x, z] = toW(u, w), g = CP_DATUM + cpRelief(x, z), y = surf(u, w);
    if (!(y === y) || y < g + 0.35 || y > B - 1.2) continue;
    if (dSolid(u, w) < 0.9) continue;
    const sl = slopeAt(u, w), cv = cavAt(u, w, y);
    if (sl > 1.5 && r() < 0.85) continue;
    if (cv < 0.02 && r() < 0.8) continue;
    if (fbm(u * 0.4 + 5, w * 0.4 - 3, 2) < 0.34 && r() < 0.6) continue;
    const s = 0.22 + r() * r() * 0.8, rot = r() * Math.PI * 2, m = new THREE.Matrix4();
    m.compose(new THREE.Vector3(x, y - 0.08, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, (r() - 0.5) * 0.3)), new THREE.Vector3(s, s * (0.6 + 0.6 * r()), s));
    M.push(m); const t = 0.55 + 0.55 * r(); col.push(new THREE.Color(t * (0.85 + 0.3 * r()), t, t * (0.7 + 0.25 * r())));
  }
  if (!M.length) return null;
  const im = new THREE.InstancedMesh(shrubGeo(), mat, M.length);
  M.forEach((m, i) => { im.setMatrixAt(i, m); im.setColorAt(i, col[i]); });
  im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = false; im.receiveShadow = true; im.name = 'cpc33:shrubs'; im.computeBoundingSphere();
  return im;
}
// grass tufts in the ledges and the joints (the park's tuft shader), on the mesh
function vistaTufts(B, surf, count) {
  const r = rng(2024), P = [], Cc = [], AT = [];
  let n = 0, tries = 0;
  while (n < count && tries++ < count * 60) {
    const u = -38 + r() * 60, w = -46 + r() * 64, y = surf(u, w);
    if (!(y === y)) continue;
    const [x, z] = toW(u, w), g = CP_DATUM + cpRelief(x, z);
    if (y < g + 0.12 || y > B - 1.1) continue;
    if (dSolid(u, w) < 1.0) continue;
    const e = 0.3, sl = Math.hypot(surf(u + e, w) - surf(u - e, w), surf(u, w + e) - surf(u, w - e)) / (2 * e);
    const cv = (surf(u + 0.6, w) + surf(u - 0.6, w) + surf(u, w + 0.6) + surf(u, w - 0.6)) / 4 - y;
    if (sl > 1.0 || (cv < 0.015 && r() < 0.85)) continue;
    const h0 = r(), h1 = r(), h2 = r();
    pushTuft(P, Cc, AT, x, y, z, 0.1 + 0.34 * h2 * h2 * (0.6 + 0.4 * h0), 0.2 + 0.26 * h1, h2, h0, (u * 0.37 + w * 1.3) % 97);
    n++;
  }
  if (!P.length) return null;
  const m = new THREE.Mesh(tuftGeo(P, Cc, AT), tuftMat());
  m.name = 'cpc33:tufts'; m.castShadow = false; m.receiveShadow = true;
  return m;
}

// ---- assembly ------------------------------------------------------------------------------------------------------------------------------
const FRAME = { x0: 0, z0: 0, ox: OX, oz: OZ, ax: AX, az: AZ };
function addBins(grp, R, B, tag) {
  const spec = [['ST', castleMat('stone'), 'rubble', true], ['MO', castleMat('mortar'), 'mortar', false], ['GR', castleMat('granite'), 'granite', true],
    ['FL', castleMat('flag'), 'flags', false], ['SL', castleMat('slate'), 'slate', true], ['WD', plainMat('paint'), 'timber', true], ['GL', plainMat('glass'), 'glass', false], ['IR', plainMat('iron'), 'iron', true], ['CL', plainMat('cloth'), 'flag', false]];
  const tris = {};
  for (const [k, mat, nm, cast] of spec) {
    const bin = R[k]; if (!bin || !bin.P.length) continue;
    const mesh = bin.mesh(mat, `cpc33:${tag}:${nm}`, FRAME, { cast });
    if (mesh) { grp.add(mesh); tris[nm] = bin.tris; }
  }
  return tris;
}
function nearGroup(B) {
  const R = bins();
  terrace(R, B);
  castleBody(R, B);
  pavilions(R, B);
  const grp = new THREE.Group(); grp.name = 'cpc33:castle:near';
  const tris = addBins(grp, R, B, 'near');
  const vm = vistaMesh(B, 0.22); grp.add(vm); tris.vista = vm.geometry.userData.tris;
  const surf = vm.geometry.userData.surface;
  const sh = plants(B, 420, surf); if (sh) { grp.add(sh); tris.shrubs = 420 * 10; }
  const tf = vistaTufts(B, surf, 1100); if (tf) { grp.add(tf); tris.tufts = 1100 * 6; }
  for (const m of bedPlants(B)) { grp.add(m); tris[m.name.slice(6)] = m.isInstancedMesh ? m.count * 10 : (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3; }
  return { grp, tris };
}

// the middle level: LITE (the rubble faces as their beds), the rock at 0.5 m, the bed's planting
function midGroup(B) {
  const R = bins();
  LITE = true;
  try { terrace(R, B); castleBody(R, B); pavilions(R, B); } finally { LITE = false; }
  const grp = new THREE.Group(); grp.name = 'cpc33:castle:mid';
  const tris = addBins(grp, R, B, 'mid');
  const vm = vistaMesh(B, 0.5); grp.add(vm); tris.vista = vm.geometry.userData.tris;
  for (const m of bedPlants(B)) grp.add(m);
  return { grp, tris };
}
// the far level: the same massing in plain faces (the stone material gives the rubble at distance), the rock at 0.7 m
function farGroup(B) {
  const R = bins(), rr = rng(5);
  const frustum = (Bn, u0, u1, w0, w1, y0, y1, out, col) => solid(Bn, [[u0 - out, y0, w0 - out], [u1 + out, y0, w0 - out], [u1 + out, y0, w1 + out], [u0 - out, y0, w1 + out], [u0, y1, w0], [u1, y1, w0], [u1, y1, w1], [u0, y1, w1]], col, rr3(rr));
  const box = (Bn, u0, u1, y0, y1, w0, w1, col) => frustum(Bn, u0, u1, w0, w1, y0, y1, 0, col);
  // the keep and the wing on their battered bases, their parapets' copings
  frustum(R.ST, KEEP.u0, KEEP.u1, KEEP.w0, KEEP.w1, B - 4.5, B + 0.1, 1.1, WH);
  box(R.ST, KEEP.u0, KEEP.u1, B + 0.1, B + KEEP.top - 0.14, KEEP.w0, KEEP.w1, WH);
  box(R.GR, KEEP.u0 - 0.07, KEEP.u1 + 0.07, B + KEEP.top - 0.14, B + KEEP.top, KEEP.w0 - 0.07, KEEP.w1 + 0.07, shade(WH, 0.95));
  frustum(R.ST, WING.u0, WING.u1, WING.w0, WING.w1, B - 4.5, B + 0.1, 1.1, WH);
  box(R.ST, WING.u0, WING.u1, B + 0.1, B + WING.top - 0.14, WING.w0, WING.w1, WH);
  box(R.GR, WING.u0 - 0.07, WING.u1 + 0.07, B + WING.top - 0.14, B + WING.top, WING.w0 - 0.07, WING.w1 + 0.07, shade(WH, 0.95));
  const { u, w, r, eave, cone, rTop } = TUR;
  lathe(R.ST, u, w, [[r + 1.1, B - 4.5], [r, B + 0.1], [r, B + eave - 0.4]], 16, WH, Z3, true);
  lathe(R.GR, u, w, [[r, B + eave - 0.4], [r + 0.28, B + eave - 0.1], [r + 0.28, B + eave]], 16, shade(WH, 0.95), Z3, true);
  lathe(R.SL, u, w, [[r + 0.33, B + eave], [rTop, B + eave + cone]], 16, WH, Z3, true);
  lathe(R.WD, u, w, [[0.05, B + eave + cone], [0.03, B + eave + cone + 5.3]], 6, C.pole, Z3, true);
  slateRoof(R.SL, GAZ.u, GAZ.w, (GAZ.hw + 0.55) * Math.SQRT2, B + KEEP.roof + 2.45, 0.06, B + KEEP.roof + 3.67, 4, 2, WH, true, Math.PI / 4);
  // the terrace, the platform, the walls as blocks
  const tris = THREE.ShapeUtils.triangulateShape(PT.map(([a, b]) => new THREE.Vector2(a, b)), []);
  for (const [i, j, k] of tris) R.FL.tri([PT[i][0], B, PT[i][1]], [PT[j][0], B, PT[j][1]], [PT[k][0], B, PT[k][1]], [0, 1, 0], [0, 1, 0], [0, 1, 0], shade(WH, 0.9));
  { const bt = THREE.ShapeUtils.triangulateShape(BED.map(([a, b]) => new THREE.Vector2(a, b)), []); for (const [i, j, k] of bt) R.WD.tri([BED[i][0], B + 0.18, BED[i][1]], [BED[j][0], B + 0.18, BED[j][1]], [BED[k][0], B + 0.18, BED[k][1]], [0, 1, 0], [0, 1, 0], [0, 1, 0], K(0x2a3a1c)); }
  const pp = PLAT.P;
  for (let k = 1; k + 1 < pp.length; k++) R.FL.tri([pp[0][0], B + PLAT.h, pp[0][1]], [pp[k][0], B + PLAT.h, pp[k][1]], [pp[k + 1][0], B + PLAT.h, pp[k + 1][1]], [0, 1, 0], [0, 1, 0], [0, 1, 0], shade(WH, 0.9));
  PT.forEach((a, i) => {
    const b = PT[(i + 1) % PT.length], k = PT_KIND[i];
    if (k === 'none') return;
    const Wf = flatWall(a, b, -1), yt = k === 'plat' ? B + PLAT.h + 0.1 : B + (k === 'cliff' ? 1.0 : 0.82);
    wallBox(R.ST, Wf, 0, Wf.L, B - 4.5, yt, -PTH, 0, WH, [1, 1, 1]);
  });
  // the pavilions' roofs on corner posts, the tower
  for (const [P, fl, post, rise, ov] of [[PAV, B + PLAT.h, 2.55, 1.95, 0.62], [PAV2, B + 0.3, 2.45, 1.7, 0.55]]) {
    for (const [pu, pw] of [[P.u0, P.w0], [P.u1, P.w0], [P.u1, P.w1], [P.u0, P.w1]]) box(R.WD, pu - 0.08, pu + 0.08, fl, fl + post, pw - 0.08, pw + 0.08, C.cream);
    const hw = (P.w1 - P.w0) / 2 + ov, wc = (P.w0 + P.w1) / 2, yE = fl + post + 0.22, u0 = P.u0 - ov, u1 = P.u1 + ov;
    const lw = Math.hypot(hw, rise), nN = [0, hw / lw, -rise / lw], nS = [0, hw / lw, rise / lw], nW = [-rise / lw, hw / lw, 0], nE = [rise / lw, hw / lw, 0];
    const yR = yE + rise, c = shade(C.slD, 0.9);
    R.SL.quad([u0, yE, wc - hw], [u1, yE, wc - hw], [u1 - hw, yR, wc], [u0 + hw, yR, wc], c, Z3, nN);
    R.SL.quad([u1, yE, wc + hw], [u0, yE, wc + hw], [u0 + hw, yR, wc], [u1 - hw, yR, wc], c, Z3, nS);
    R.SL.tri([u0, yE, wc + hw], [u0, yE, wc - hw], [u0 + hw, yR, wc], nW, nW, nW, c, Z3);
    R.SL.tri([u1, yE, wc - hw], [u1, yE, wc + hw], [u1 - hw, yR, wc], nE, nE, nE, c, Z3);
  }
  const { u: tu, w: tw, hw: th } = TOWER, ty = B + PLAT.h;
  box(R.WD, tu - th, tu + th, ty, ty + 4.1, tw - th, tw + th, shade(C.cream, 0.8));
  slateRoof(R.SL, tu, tw, (th + 0.75) * Math.SQRT2, ty + 4.14, (th - 0.37) * Math.SQRT2, ty + 5.05, 4, 1, shade(C.slR, 0.9), true, Math.PI / 4);
  box(R.WD, tu - th + 0.42, tu + th - 0.42, ty + 5.0, ty + 6.3, tw - th + 0.42, tw + th - 0.42, shade(C.cream, 0.8));
  slateRoof(R.SL, tu, tw, (th - 0.04) * Math.SQRT2, ty + 6.3, 0.05, ty + 8.5, 4, 1, shade(C.slD, 0.9), true, Math.PI / 4);
  const grp = new THREE.Group(); grp.name = 'cpc33:castle:far';
  const t = addBins(grp, R, B, 'far');
  const vm = vistaMesh(B, 0.7); grp.add(vm); t.vista = vm.geometry.userData.tris;
  return { grp, tris: t };
}

// the castle as a THREE.LOD at its centre: every stone within NEAR m, the massing beyond
export function buildCastleB(group, B) {
  const near = nearGroup(B), mid = midGroup(B), far = farGroup(B);
  const c = [CASTLE.C[0], B + 4, CASTLE.C[1]];
  const lod = new THREE.LOD();
  lod.name = 'cpc33:castle';
  lod.position.set(c[0], c[1], c[2]);
  for (const g of [near.grp, mid.grp, far.grp]) g.position.set(-c[0], -c[1], -c[2]);
  lod.addLevel(near.grp, 0);
  lod.addLevel(mid.grp, CASTLE.NEAR);
  lod.addLevel(far.grp, CASTLE.MID);
  lod.updateMatrixWorld(true);
  group.add(lod);
  const sum = (t) => Object.values(t).reduce((s, v) => s + v, 0);
  return [['near', sum(near.tris)], ['mid', sum(mid.tris)], ['far', sum(far.tris)], ...Object.entries(near.tris).map(([k, v]) => ['near:' + k, v])];
}

// the walkers' solids: the floor's decks, the buildings, the pavilions
export function castleColliders(COLLIDERS, B) {
  const rot = Math.atan2(AZ, AX);
  const box = (u0, u1, w0, w1, y0, y1, deck) => { const [x, z] = toW((u0 + u1) / 2, (w0 + w1) / 2); COLLIDERS.addBox('kit31', { x, y: (y0 + y1) / 2, z, hw: (u1 - u0) / 2, hh: (y1 - y0) / 2, hd: (w1 - w0) / 2, rotY: rot, deck: !!deck }); };
  box(-33, -8.64, -9.2, 7.6, B - 0.4, B, true);
  box(-16.4, -8.64, -5.0, -3.2, B - 0.4, B, true);
  box(-32.6, -17.6, -14.3, -9.2, B + PLAT.h - 0.4, B + PLAT.h, true);
  box(KEEP.u0, KEEP.u1, KEEP.w0, KEEP.w1, B, B + KEEP.top);
  box(4.06, 7.06, 4.4, 7.4, B, B + TUR.eave);
  box(WING.u0, WING.u1, WING.w0, WING.w1, B, B + WING.top);
  box(TOWER.u - TOWER.hw, TOWER.u + TOWER.hw, TOWER.w - TOWER.hw, TOWER.w + TOWER.hw, B + PLAT.h, B + PLAT.h + 0.9);
}
