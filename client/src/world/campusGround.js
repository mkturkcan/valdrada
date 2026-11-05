// CU03 (owner 2026-11-03: "the upper campus is constructed and not heightmapped"): Columbia's Morningside campus as an
// AUTHORED ground, the McKim section as built, in place of the bare earth's triangulation. The terrain round had replaced
// the compile's two-plane pads (compile.mjs CAMPUS_PADS) with the 2017 bare earth, whose filter drops the terrace walls,
// balustrades and hedges and interpolates across them: the flank walls came out as 9 m ramps, the side flights to Kent and
// Dodge as stairs drawn on a slope, the parterre wall as a bank. Measured off the same bare earth on its flat parts (robust
// plane fits, median residual 3 to 8 cm) and the campus's mapped lines, in the McKim frame: a' along the axis
// toward Low, c' across (east +), metres from Alma Mater's node. The frame is the compile's pad axis (PAD_A, PAD_C) turned
// 1.2 degrees: the east and west features (the side flights, the parterres' north edges) come out symmetric only there,
// and the superblock's building lines run along its axes (Broadway c' -117.5, Amsterdam c' +118.5).
//
// The model (NAVD88 m; a level is the paving's and the lawn's top):
//   South Field     its flights up to College Walk, a' -72 .. -68 across |c'| < 20.5 and 40 .. 47.5 (OSM's), the planters
//                   between them at the walk's level over a wall (the field itself is the bare earth's)
//   College Walk    a' -72 .. -39.5, the walk and its verges, one plane falling 2.1 m from Amsterdam to Broadway
//   south steps     a' -39.5 .. -33, the broad flight from the walk up to Low Plaza, |c'| <= 50.1
//   the court       a' -33 .. 1.95, |c'| < 50.1: Low Plaza (the fountains' nested squares) and the parterre lawns, one
//                   plane rising 1.8 % toward Low
//   grand flights   |c'| < 20.5: A from a' -10.2 to -6.5 (9 risers; its foot the top view's, 0.9 m past the court's
//                   squares), Alma Mater's landing to -4, B to +0.5 (9 risers)
//   the fountains   (a' -20.1, c' +-22.9), 0.55 m south of the side flights' middle as the top view has them (OSM's
//                   nodes 0.5 m north); the court's paving rings them (world/materials.js LP27)
//   side flights    a' -22 .. -17.1 (4.9 m wide), from the court at |c'| 40 up to the flank terraces at 50.1 (19 risers):
//                   east to Kent Hall, west to Dodge Hall
//   walls           the parterre-north wall at a' 1.95 (|c'| 20.5 .. 50.1), the flank walls at |c'| 50.1, the flights'
//                   cheeks at |c'| 20.5: the court 2.5 to 3.0 m under the upper campus
//   upper campus    (CU04) the plateau from the parterre wall to the buildings on 120th Street (a' 230) and from Broadway's
//                   building line to Amsterdam's: the plane UP over the McKim core (|c'| <= 50.1, to a' 112, so every
//                   wall and flight head is exact), beyond it the bare earth's own falls (a metre toward both avenues, the
//                   plaza by Pupin and the Northwest Corner Building 1 m over Low's terrace) as a smooth measured surface
//                   (campusGroundData.js, client/tools/campus/cu_ground_fit.py), continuous under the buildings
//   Uris Hall       its podium at 47.76, a' 121 .. 175, |c'| < 40, with its front steps from a' 116 (|c'| < 30)
//   Earl Hall       its portico's flight up from the plateau, a' 47 .. 55 (OSM's 8 m), c' -56.8 .. -64, to a landing at
//                   49.0 (the bare earth's portico floor, 2.8 m over the walk) to its front at c' -66.1 (city/campus.js
//                   lays the landing in granite at the walk's paving plus the rise: no compiled paving reaches it)
//   the pits        the service yards and areaways left to the bare earth (their walls in masonry): north of
//                   Havemeyer to the Northwest Corner Building, between Schermerhorn and Fairchild, beside Mudd; the
//                   117th Street gates down to Broadway and Amsterdam
//   Dodge Hall      its areaway between the court's west wall and its front (c' -54.4 .. -50.1): College Walk's plane carried
//                   north to a' -28.5 (the bare earth's floor, 41.3 to 41.4), then a flight up to the terrace at a' -22
// The ground keeps the bare earth where the model does not reach: South Field, past the building lines, under Dodge Hall
// (c' < -54.4, a' -39.5 .. -22) and the pits.
// Readers: world/heightAuthority.js (the TIN cut along the model's lines, every section laid on it), city/campus.js (the
// walls, flights and landings built on the same numbers), client/tools/tests/campus_ground.mjs (the test). `?cu03=0` off.
import { CU_GRID } from './campusGroundData.js';

const q = typeof location !== 'undefined' && location.search ? new URLSearchParams(location.search) : null;
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
export const CU03 = !(q && q.get('cu03') === '0') && !(isNode && process.env.CU03 === '0');

export const CU_ORIGIN = [764.23, -2747.81];
const T = 0.021, N = Math.hypot(1, T);
export const CU_A = [(0.465 + T * 0.885) / N, (-0.885 + T * 0.465) / N];   // toward Low
export const CU_C = [(0.885 - T * 0.465) / N, (0.465 + T * 0.885) / N];    // across, east +
export const cuAC = (x, z) => { const dx = x - CU_ORIGIN[0], dz = z - CU_ORIGIN[1]; return [dx * CU_A[0] + dz * CU_A[1], dx * CU_C[0] + dz * CU_C[1]]; };
export const cuXZ = (a, c) => [CU_ORIGIN[0] + CU_A[0] * a + CU_C[0] * c, CU_ORIGIN[1] + CU_A[1] * a + CU_C[1] * c];

// the planes
const CW = (a, c) => 42.346 + 0.01237 * a + 0.00991 * c;    // College Walk
const CT = (a) => 43.5537 + 0.01797 * a;                    // the court
const UP = (a, c) => 46.133 + 0.00123 * a + 0.00059 * c;    // the upper campus
const LANDING = 44.75, URIS = 47.76, SOUTH_FIELD = 40.85, EARL = 49.0;
// the lines (a', c')
export const CU = {
  sfS: -72.0, sfN: -68.0, sfC: 40.0, sfC1: 47.5, stepsFoot: -39.5, courtS: -33.0, wallN: 1.95, flank: 50.1, cheek: 20.5,
  fA0: -10.2, fA1: -6.5, fB0: -4.0, fB1: 0.5, side0: -22.0, side1: -17.1, sideFoot: 40.0,
  coreN: 112.0, coreW: -117.5, coreE: 118.5, northN: 230.0, dodgeN: -22.0,
  urisS0: 116.0, urisS1: 121.0, urisN: 175.0, urisC: 40.0, urisStepsC: 30.0,
  earlA0: 47.0, earlA1: 55.0, earlC0: 56.8, earlC1: 64.0, earlC2: 66.1, dodgeS0: -28.5, dodgeC: 54.4,
  landing: LANDING, uris: URIS, southField: SOUTH_FIELD, riser: 0.155, fountA: -20.1, fountC: 22.9,
};
// the pits [a0, a1, c0, c1]: north of Havemeyer (the service yard at Broadway's level, its ramp and the areaways along
// Havemeyer and the podium), between Schermerhorn and Fairchild (the yard at Amsterdam's), the drive beside Mudd, and the
// 117th Street gates down to Broadway and Amsterdam (their flights OSM's)
const PITS = [[146, 180, -118.5, -40], [159, 200, 64, 99], [210, 230, 30, 64], [34, 68, -118.5, -100], [34, 68, 99, 118.5]];
export const cuLevel = { CW, CT, UP, LANDING, URIS, SOUTH_FIELD, EARL };
const lerp = (u, v, t) => u + (v - u) * t;
const ramp = (x, x0, x1) => Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));

// the measured plateau: the residual over UP on the 2 m grid, bilinear
const GD = (() => {
  const s = typeof atob === 'function' ? atob(CU_GRID.d) : Buffer.from(CU_GRID.d, 'base64').toString('binary');
  const v = new Float32Array(s.length);
  for (let i = 0; i < s.length; i++) { const b = s.charCodeAt(i); v[i] = (b > 127 ? b - 256 : b) * CU_GRID.k; }
  return v;
})();
function cuMeasured(a, c) {
  const G = CU_GRID, fa = Math.max(0, Math.min(G.na - 1.001, (a - G.a0) / G.step)), fc = Math.max(0, Math.min(G.nc - 1.001, (c - G.c0) / G.step));
  const i = Math.floor(fa), j = Math.floor(fc), u = fa - i, w = fc - j, o = i * G.nc + j;
  return (GD[o] * (1 - w) + GD[o + 1] * w) * (1 - u) + (GD[o + G.nc] * (1 - w) + GD[o + G.nc + 1] * w) * u;
}
// the plane's share: 1 over the McKim core, to 0 eight metres out
const cuCoreW = (a, c) => (1 - ramp(a, CU.coreN, CU.coreN + 8)) * (1 - ramp(Math.abs(c), CU.flank, CU.flank + 8));
const upper = (a, c) => UP(a, c) + (1 - cuCoreW(a, c)) * cuMeasured(a, c);

// a region's surface at (a', c'): NAVD88, each region by its own formula (a piece of the ground takes the surface of the
// region its centre is in at all its corners, so the ground is discontinuous exactly along the regions' edges)
export function cuSurface(id, a, c) {
  const k = CU;
  switch (id) {
    case 'sfSteps': return lerp(SOUTH_FIELD, CW(k.sfN, c), ramp(a, k.sfS, k.sfN));
    case 'walk': return CW(a, c);
    case 'steps': return lerp(CW(k.stepsFoot, c), CT(k.courtS), ramp(a, k.stepsFoot, k.courtS));
    case 'court': return CT(a);
    case 'flightA': return lerp(CT(k.fA0), LANDING, ramp(a, k.fA0, k.fA1));
    case 'landing': return LANDING;
    case 'flightB': return lerp(LANDING, UP(k.fB1, c), ramp(a, k.fB0, k.fB1));
    case 'sideE': return lerp(CT(a), UP(a, k.flank), ramp(c, k.sideFoot, k.flank));
    case 'sideW': return lerp(CT(a), UP(a, -k.flank), ramp(-c, k.sideFoot, k.flank));
    case 'urisSteps': return lerp(upper(k.urisS0, c), URIS, ramp(a, k.urisS0, k.urisS1));
    case 'uris': return URIS;
    case 'earlSteps': return lerp(upper(a, -k.earlC0), EARL, ramp(-c, k.earlC0, k.earlC1));
    case 'dodgeStair': return lerp(CW(k.dodgeS0, c), UP(k.dodgeN, c), ramp(a, k.dodgeS0, k.dodgeN));
    case 'earlLanding': return EARL;
    default: return upper(a, c);   // upper
  }
}
// the region at (a', c'), or null where the bare earth rules
export function cuRegionId(a, c) {
  const k = CU, ac = Math.abs(c);
  if (a < k.sfS || a > k.northN || c < k.coreW || c > k.coreE) return null;
  if (a < k.sfN) return ac < k.cheek || (ac >= k.sfC && ac < k.sfC1) ? 'sfSteps' : 'walk';
  if (c < -k.flank && a >= k.stepsFoot && a < k.dodgeN) {             // Dodge Hall's areaway, and under Dodge
    if (c < -k.dodgeC) return null;
    return a < k.dodgeS0 ? 'walk' : 'dodgeStair';
  }
  if (a < k.stepsFoot) return 'walk';
  if (a < k.courtS) return ac <= k.flank ? 'steps' : 'walk';           // (beyond the steps' ends: Kent Hall's frontage)
  if (c > k.flank && a < k.side0) return 'upper';                      // Kent Hall's terrace over the court
  if (ac < k.cheek && a >= k.fA0 && a < k.fB1) return a < k.fA1 ? 'flightA' : a < k.fB0 ? 'landing' : 'flightB';
  if (ac >= k.sideFoot && ac < k.flank && a >= k.side0 && a < k.side1) return c > 0 ? 'sideE' : 'sideW';
  if (ac < k.flank && a < (ac < k.cheek ? k.fA0 : k.wallN)) return 'court';
  for (const [a0, a1, c0, c1] of PITS) if (a >= a0 && a < a1 && c >= c0 && c < c1) return null;
  if (a >= k.earlA0 && a < k.earlA1 && c <= -k.earlC0 && c > -k.earlC2) return c > -k.earlC1 ? 'earlSteps' : 'earlLanding';
  if (a >= k.urisS1 && a < k.urisN && ac < k.urisC) return 'uris';
  if (a >= k.urisS0 && a < k.urisS1 && ac < k.urisStepsC) return 'urisSteps';
  return 'upper';
}
export function cuRegion(a, c) {
  const id = cuRegionId(a, c);
  return id ? { id, h: cuSurface(id, a, c) } : null;
}
// NAVD88 at world (x, z), null outside the model
export function cuHeight(x, z) {
  if (!CU03) return null;
  const [a, c] = cuAC(x, z), r = cuRegion(a, c);
  return r ? r.h : null;
}
// in the superblock (the model's square, its pits too): its walls are built, never the bare earth's rock
export function cuInBlock(x, z) {
  if (!CU03) return false;
  const [a, c] = cuAC(x, z), k = CU;
  return a >= k.sfS - 2 && a <= k.northN + 2 && c >= k.coreW - 2 && c <= k.coreE + 2;
}
// the flights' regions (their treads are city/campus.js's: no lawn under them, no OSM flight over them)
export const CU_FLIGHT_IDS = new Set(['steps', 'flightA', 'landing', 'flightB', 'sideE', 'sideW', 'urisSteps', 'sfSteps', 'earlSteps', 'earlLanding', 'dodgeStair']);
// paved where the compile filled the pad's open ground with lawn (grassU): the plaza by Pupin, the Northwest Corner
// Building and Schapiro, brick and stone over the gym (its planters are OSM's lawns, kept); and where both its lawn fill
// and its lawns (grass) lie on paving: Dodge Hall's areaway behind the court's west wall
const PAVED = [[178, 232, -100, -28]];
const PAVED_ALL = [[-39.5, -28.5, -54.4, -50.1]];
// what becomes of a compiled lawn triangle centred at (x, z): 'drop' under a flight, 'brick' on a paved square, or null
// (`upper`: the compile's lawn fill, grassU; else its lawns, grass)
export function cuLawnFate(x, z, upper) {
  if (!CU03) return null;
  const [a, c] = cuAC(x, z), id = cuRegionId(a, c);
  if (id && CU_FLIGHT_IDS.has(id)) return 'drop';
  for (const [a0, a1, c0, c1] of upper ? PAVED.concat(PAVED_ALL) : PAVED_ALL) if (a >= a0 && a < a1 && c >= c0 && c < c1) return 'brick';
  return null;
}
// LP28 (2026-11-03): the compile's parterre panels by Low Plaza's fountains (client/tools/pipeline/compile.mjs PANEL_POLYS, in
// its pad frame from Alma Mater: a along PAD_A, c across) cut a 7 m chamfer at each fountain, a pale triangle up to 3 x 5 m
// between the panel and the fountain's ring, where the reference's lawns run to the ring along an arc 4.9 m from the
// basin's centre (world/materials.js LP27 paves inside it). Before the lift, on the campus tile: each chamfered corner
// filled with lawn outside the arc (0.2 m cells at the panel's own level), the chamfer's kerb dropped, kerbs laid along the
// arc and along the panel's two edges the fill opens (the compile's 0.32 m strips, 5 cm over the lawn)
const PAD_A = [0.465, -0.885], PAD_C = [0.885, 0.465];
const padXZ = (a, c) => [CU_ORIGIN[0] + PAD_A[0] * a + PAD_C[0] * c, CU_ORIGIN[1] + PAD_A[1] * a + PAD_C[1] * c];
const padAC = (x, z) => { const dx = x - CU_ORIGIN[0], dz = z - CU_ORIGIN[1]; return [dx * PAD_A[0] + dz * PAD_A[1], dx * PAD_C[0] + dz * PAD_C[1]]; };
// the inner panels' cut corners (c outward from the axis, mirrored west): the corner, the chamfer from the c 23 edge to the
// panel's other edge, the panel's rectangle [a0, a1, c0, c1]
const LP28 = [
  { corner: [-18.4, 23], chamfer: [[-13.4, 23], [-16, 28], [-18.4, 30.4]], rect: [-18.4, -11, 23, 30.9] },
  { corner: [-22.5, 23], chamfer: [[-28.6, 23], [-26, 28], [-22.5, 30.4]], rect: [-30, -22.5, 23, 30.9] },
];
const LP28_R = 4.9;
export function cuPanelReshape(S, ox, oz) {
  if (!CU03 || !S || !S.grass || !S.curb) return null;
  const inPoly = (P, x, y) => { let ins = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
  const dSeg = (p, a, b) => { const ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / (L2 || 1))); return Math.hypot(p[0] - a[0] - ex * t, p[1] - a[1] - ey * t); };
  const st = { lawn: 0, kerbOut: 0, kerbIn: 0 }, addG = [], addK = [];
  const tri = (out, A, B, C) => {   // (wound up, as the compile's triUpC)
    if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) < 0) { const T = B; B = C; C = T; }
    out.push(A[0] - ox, A[1], A[2] - oz, B[0] - ox, B[1], B[2] - oz, C[0] - ox, C[1], C[2] - oz);
  };
  let curb = S.curb;
  for (const s of [-1, 1]) {
    const [fx, fz] = cuXZ(CU.fountA, CU.fountC * s), fp = padAC(fx, fz), F = [fp[0], s * fp[1]];   // the fountain, panel space
    for (const L of LP28) {
      const W = (a, cc, y) => { const [x, z] = padXZ(a, s * cc); return [x, y, z]; };
      const [cx, , cz] = W(L.corner[0], L.corner[1], 0);
      if (cx < ox || cx >= ox + 512 || cz < oz || cz >= oz + 512) continue;
      // the panel's lawn level: the median of its compiled lawn's vertices
      const ys = [], g = S.grass;
      for (let i = 0; i + 8 < g.length; i += 9) {
        const [a, c] = padAC((g[i] + g[i + 3] + g[i + 6]) / 3 + ox, (g[i + 2] + g[i + 5] + g[i + 8]) / 3 + oz), cc = s * c;
        if (a > L.rect[0] && a < L.rect[1] && cc > L.rect[2] && cc < L.rect[3]) ys.push(g[i + 1], g[i + 4], g[i + 7]);
      }
      if (ys.length < 9) continue;
      ys.sort((u, v) => u - v);
      const yL = ys[ys.length >> 1], yK = yL + 0.05;
      const poly = [L.corner, ...L.chamfer];
      // the chamfer's kerb out
      const keep = [];
      for (let i = 0; i + 8 < curb.length; i += 9) {
        const [a, c] = padAC((curb[i] + curb[i + 3] + curb[i + 6]) / 3 + ox, (curb[i + 2] + curb[i + 5] + curb[i + 8]) / 3 + oz), q = [a, s * c];
        if (dSeg(q, L.chamfer[0], L.chamfer[1]) < 0.3 || dSeg(q, L.chamfer[1], L.chamfer[2]) < 0.3) { st.kerbOut++; continue; }
        for (let k = 0; k < 9; k++) keep.push(curb[i + k]);
      }
      curb = Float32Array.from(keep);
      // the lawn in the cut corner, outside the arc (cells 0.15 m past the chamfer, under the old lawn's edge)
      const A0 = Math.min(...poly.map((p) => p[0])), A1 = Math.max(...poly.map((p) => p[0])), C0 = Math.min(...poly.map((p) => p[1])), C1 = Math.max(...poly.map((p) => p[1]));
      const h = 0.2;
      for (let a = A0 + h / 2; a < A1; a += h) for (let cc = C0 + h / 2; cc < C1; cc += h) {
        const inside = inPoly(poly, a, cc) || dSeg([a, cc], L.chamfer[0], L.chamfer[1]) < 0.15 || dSeg([a, cc], L.chamfer[1], L.chamfer[2]) < 0.15;
        if (!inside || Math.hypot(a - F[0], cc - F[1]) < LP28_R - 0.1) continue;
        const p00 = W(a - h / 2, cc - h / 2, yL), p10 = W(a + h / 2, cc - h / 2, yL), p11 = W(a + h / 2, cc + h / 2, yL), p01 = W(a - h / 2, cc + h / 2, yL);
        tri(addG, p00, p10, p11); tri(addG, p00, p11, p01); st.lawn += 2;
      }
      // kerbs: a strip of the compile's (0.16 m either side of its line) from p to q, in panel space
      const strip = (p, q) => {
        const ex = q[0] - p[0], ey = q[1] - p[1], Ln = Math.hypot(ex, ey) || 1, nx = -ey / Ln * 0.16, ny = ex / Ln * 0.16;
        const P = [W(p[0] + nx, p[1] + ny, yK), W(q[0] + nx, q[1] + ny, yK), W(q[0] - nx, q[1] - ny, yK), W(p[0] - nx, p[1] - ny, yK)];
        tri(addK, P[0], P[1], P[2]); tri(addK, P[0], P[2], P[3]); st.kerbIn += 2;
      };
      // the arc, where it crosses the cut corner
      for (let t = 0; t < 360; t += 3) {
        const u0 = (t * Math.PI) / 180, u1 = ((t + 3) * Math.PI) / 180, um = (u0 + u1) / 2;
        const m = [F[0] + LP28_R * Math.cos(um), F[1] + LP28_R * Math.sin(um)];
        if (!inPoly(poly, m[0], m[1])) continue;
        strip([F[0] + LP28_R * Math.cos(u0), F[1] + LP28_R * Math.sin(u0)], [F[0] + LP28_R * Math.cos(u1), F[1] + LP28_R * Math.sin(u1)]);
      }
      // the panel's edges the fill opens: from the corner along c 23 and along its own a, outside the arc
      for (const [p, q] of [[L.corner, L.chamfer[0]], [L.corner, L.chamfer[2]]]) {
        const n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 0.5));
        for (let k = 0; k < n; k++) {
          const t0 = k / n, t1 = (k + 1) / n, a0 = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], a1 = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
          if (Math.hypot((a0[0] + a1[0]) / 2 - F[0], (a0[1] + a1[1]) / 2 - F[1]) < LP28_R) continue;
          strip(a0, a1);
        }
      }
    }
  }
  if (!addG.length && st.kerbOut === 0) return null;
  const cat = (u, v) => { const o = new Float32Array(u.length + v.length); o.set(u, 0); o.set(v, u.length); return o; };
  S.grass = cat(S.grass, addG); S.curb = cat(curb, addK);
  return st;
}
// in the model's square, exactly (the clamp holds its ground out: world/heightAuthority.js haClampGround)
export function cuInModel(x, z) {
  if (!CU03) return false;
  const [a, c] = cuAC(x, z), k = CU;
  return a >= k.sfS && a <= k.northN && c >= k.coreW && c <= k.coreE;
}
// a steep triangle of a soup (tile-local x, z; world y) in the model's square: the bare earth's slopes in the pits (the
// yards' and areaways' walls interpolated by the bare earth's filter) and the slivers along the model's lines, which the
// page draws as the built walls (world/assemble.js), never as natural ground
export function cuSteepIn(a, i, ox, oz) {
  if (!CU03) return false;
  if (!cuInModel((a[i] + a[i + 3] + a[i + 6]) / 3 + ox, (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz)) return false;
  const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], wx = a[i + 6] - a[i], wy = a[i + 7] - a[i + 1], wz = a[i + 8] - a[i + 2];
  const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, L = Math.hypot(nx, ny, nz);
  return L > 1e-9 && Math.abs(ny) / L < 0.6;
}
// the lines the ground is cut along (every discontinuity and every crease) as a' and c' constants: the TIN cut splits every
// triangle a line crosses across the whole model, so no cut ends in a T-junction
export function cuLinesAC() {
  const k = CU;
  const A = [k.sfS, k.sfN, k.stepsFoot, k.courtS, k.side0, k.side1, k.fA0, k.fA1, k.fB0, k.fB1, k.wallN, k.urisS0, k.urisS1, k.urisN, k.northN, k.earlA0, k.earlA1, k.dodgeS0];
  const C = [k.coreW, k.coreE, -k.flank, -k.sfC1, -k.sideFoot, -k.urisC, -k.urisStepsC, -k.cheek, k.cheek, k.urisStepsC, k.urisC, k.sideFoot, k.sfC1, k.flank,
    -k.earlC0, -k.earlC1, -k.earlC2, -k.dodgeC];
  for (const [a0, a1, c0, c1] of PITS) A.push(a0, a1), C.push(c0, c1);
  return { A: [...new Set(A)].sort((p, r) => p - r), C: [...new Set(C)].sort((p, r) => p - r) };
}
// the model's box in world x, z (the chunks it touches)
export function cuBox() {
  const k = CU, P = [[k.sfS, k.coreW], [k.sfS, k.coreE], [k.northN, k.coreW], [k.northN, k.coreE]].map(([a, c]) => cuXZ(a, c));
  return [Math.min(...P.map((p) => p[0])), Math.min(...P.map((p) => p[1])), Math.max(...P.map((p) => p[0])), Math.max(...P.map((p) => p[1]))];
}
// the flights (city/campus.js builds them; the test checks them): foot -> head along a' (axis 'a') or across (axis 'c', the
// side flights, outward), the number of risers of about 0.155 m
export function cuFlights() {
  const k = CU, fl = [];
  fl.push({ id: 'flightA', axis: 'a', a0: k.fA0, a1: k.fA1, c0: -k.cheek, c1: k.cheek, foot: () => CT(k.fA0), head: () => LANDING });
  fl.push({ id: 'flightB', axis: 'a', a0: k.fB0, a1: k.fB1, c0: -k.cheek, c1: k.cheek, foot: () => LANDING, head: (c) => UP(k.fB1, c) });
  for (const s of [1, -1]) {
    fl.push({ id: s > 0 ? 'sideE' : 'sideW', axis: 'c', side: s, a0: k.side0, a1: k.side1, c0: s * k.sideFoot, c1: s * k.flank, foot: (a) => CT(a), head: (a) => UP(a, s * k.flank) });
  }
  // the south steps: the walk falls across their width, so the treads are warped from end to end
  fl.push({ id: 'south', axis: 'a', a0: k.stepsFoot, a1: k.courtS, c0: -k.flank, c1: k.flank, foot: (c) => CW(k.stepsFoot, c), head: () => CT(k.courtS) });
  // (CU04) Uris Hall's front steps up to its podium; South Field's three flights up to College Walk
  fl.push({ id: 'urisSteps', axis: 'a', a0: k.urisS0, a1: k.urisS1, c0: -k.urisStepsC, c1: k.urisStepsC, foot: (c) => upper(k.urisS0, c), head: () => URIS });
  fl.push({ id: 'sfSteps', axis: 'a', a0: k.sfS, a1: k.sfN, c0: -k.cheek, c1: k.cheek, foot: () => SOUTH_FIELD, head: (c) => CW(k.sfN, c) });
  for (const s of [1, -1]) fl.push({ id: s > 0 ? 'sfStepsE' : 'sfStepsW', axis: 'a', a0: k.sfS, a1: k.sfN, c0: s > 0 ? k.sfC : -k.sfC1, c1: s > 0 ? k.sfC1 : -k.sfC, foot: () => SOUTH_FIELD, head: (c) => CW(k.sfN, c) });
  // Dodge Hall's areaway flight, north up from College Walk's level to the terrace between Dodge's front and the court's wall
  fl.push({ id: 'dodgeStair', axis: 'a', a0: k.dodgeS0, a1: k.dodgeN, c0: -k.dodgeC, c1: -k.flank - 0.9, foot: (c) => CW(k.dodgeS0, c), head: (c) => UP(k.dodgeN, c) });
  // Earl Hall's portico flight, west up to its landing (`land`: the landing's depth past the head, to the front)
  // (`kit`: the head is the kit's own landing, the model's rise over the drawn foot)
  fl.push({ id: 'earlSteps', axis: 'c', side: -1, a0: k.earlA0, a1: k.earlA1, c0: -k.earlC0, c1: -k.earlC1, foot: (a) => upper(a, -k.earlC0), head: () => EARL, land: k.earlC2 - k.earlC1, kit: true });
  for (const f of fl) {
    const cm = (f.c0 + f.c1) / 2, fm = f.axis === 'a' ? f.foot(cm) : f.foot((f.a0 + f.a1) / 2), hm = f.axis === 'a' ? f.head(cm) : f.head((f.a0 + f.a1) / 2);
    f.n = Math.max(1, Math.round((hm - fm) / k.riser));
  }
  return fl;
}
// the retaining walls: a line in (a', c') and its two sides' surfaces (the region a point 0.3 m off the line on that side lies
// in); `low` is the side the wall faces
export function cuWalls() {
  const k = CU, W = [];
  for (const s of [1, -1]) {
    const e = s > 0 ? 'E' : 'W';
    W.push({ id: `north${e}`, a0: k.wallN, c0: s * k.cheek, a1: k.wallN, c1: s * k.flank, face: [-1, 0] });                 // faces the court (a-)
    W.push({ id: `flank${e}N`, a0: k.side1, c0: s * k.flank, a1: k.wallN, c1: s * k.flank, face: [0, -s] });             // faces the court
    W.push({ id: `cheek${e}`, a0: k.fA0, c0: s * k.cheek, a1: k.wallN, c1: s * k.cheek, face: [0, s], raked: true });     // faces the parterre
    W.push({ id: `side${e}N`, a0: k.side1, c0: s * k.sideFoot, a1: k.side1, c1: s * k.flank, face: [1, 0], raked: true }); // the side flight's cheeks
    W.push({ id: `side${e}S`, a0: k.side0, c0: s * k.sideFoot, a1: k.side0, c1: s * k.flank, face: [-1, 0], raked: true });
  }
  W.push({ id: 'flankES', a0: k.courtS, c0: k.flank, a1: k.side0, c1: k.flank, face: [0, -1] });   // Kent Hall's terrace over the court
  W.push({ id: 'flankWS', a0: k.stepsFoot, c0: -k.flank, a1: k.courtS, c1: -k.flank, face: [0, -1] });   // the south steps' end over Dodge Hall's areaway
  W.push({ id: 'courtW', a0: k.courtS, c0: -k.flank, a1: k.side0, c1: -k.flank, face: [0, 1] });         // the court's west wall over it
  return W;
}
