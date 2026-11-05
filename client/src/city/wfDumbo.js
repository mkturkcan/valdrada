// AR32 part (city/areas.js): the Brooklyn shore between the Brooklyn and Manhattan Bridges, Fulton Ferry to John Street
// (WF65, 2026-10-31). Hooks (the contracts are in city/centralPark.js): skipBuilding, build; the shore's edges through the
// seawall kit's edge rules (seawallKit.js swEdgeRule). `?wf65=0` restores the compiled city here.
//   the shore     by stretch along the OpenStreetMap coastline (ways 630828600, 1257083252, 179060551): riprap round
//                 Main Street Park's point, under the Manhattan Bridge and along John Street, Pebble Beach and the cove in
//                 front of the Empire Stores in shingle, the timber decks at Empire Fulton Ferry and the Fulton Ferry
//                 Landing on piles, the Farragut substation's concrete relieving platform, Pier 1's granite with its rail
//   Fulton Ferry  the landing (way 700244957): a timber deck on piles with its rail, lamps and benches, the ferry kiosk
//                 and the shed, the gangway and the ferry's float (way 245320702) with its canopy, the mooring dolphins;
//                 the River Cafe on its barge; the fireboat house (way 245118653) with its hose tower; Bargemusic's barge
//                 where the old pier stood (way 245320701)
//   Empire Fulton Ferry  Jane's Carousel in Jean Nouvel's glass box (way 223183095) on its plinth
//   the river     the deck barge moored off Pebble Beach
//   John Street   the Farragut substation (way 339711332) as it stands: the yard's roads, gravel bays, the lattice
//                 gantries, transformers and breakers, its perimeter fence
// Every feature is built by the tile that holds its anchor point, in world metres; heights from the terrain authority.
import * as THREE from 'three';
import { GeoBag } from './br/geom.js';
import { pbrMaterial } from './mat/pbrLib.js';
import { swEdgeRule, swTakeRule } from './seawallKit.js';
import { marinaDropPierRule } from './marinaKit.js';
import { Acc, wallRing, capRing, loft, offsetRing, facadeTex, facadeMat, rgbs, speckle, streaks, addMeshes } from './lmFacadeKit.js';
import { haTerrainAt, haInfo } from '../world/heightAuthority.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const WF65 = !(Q && Q.get('wf65') === '0');
const W = { mapping: 'world' };

// ------------------------------------------------------------------------------------------------ materials
let MAT = null;
function mats() {
  if (MAT) return MAT;
  MAT = {
    deck: pbrMaterial('wood_painted', { ...W, tint: '#7a6650', chips: 0.3, rot: 90 }),
    timber: pbrMaterial('wood_painted', { ...W, tint: '#4f4337', chips: 0.2 }),
    iron: pbrMaterial('steel_black', { ...W }),
    steel: pbrMaterial('metal_painted', { ...W, tint: '#5d6266' }),
    galv: pbrMaterial('steel_galvanized', { ...W }),
    conc: pbrMaterial('concrete_smooth', { ...W, tint: '#a19d94' }),
    concD: pbrMaterial('concrete_smooth', { ...W, tint: '#77746d' }),
    gravel: pbrMaterial('roof_gravel', { ...W, tint: '#6f6b64' }),
    asph: pbrMaterial('asphalt_worn', { ...W }),
    yellow: pbrMaterial('paint_thermo_yellow', { ...W }),
    white: pbrMaterial('stucco', { ...W, tint: '#e9e5dc' }),
    cream: pbrMaterial('stucco', { ...W, tint: '#efe0b8' }),
    red: pbrMaterial('metal_painted', { ...W, tint: '#9a2a24' }),
    hull: pbrMaterial('metal_painted', { ...W, tint: '#22272a' }),
    blue: pbrMaterial('metal_painted', { ...W, tint: '#2d4f7a' }),
    hullW: pbrMaterial('metal_painted', { ...W, tint: '#d9d8d2' }),
    teal: pbrMaterial('metal_painted', { ...W, tint: '#5aa595' }),
    rust: pbrMaterial('steel_rust', { ...W }),
    roof: pbrMaterial('roof_membrane', { ...W, tint: '#9c9a95' }),
    glass: pbrMaterial('glass_storefront', {}),
    xfmr: pbrMaterial('metal_painted', { ...W, tint: '#7d8478' }),
    porcelain: pbrMaterial('metal_painted', { ...W, tint: '#6f4a3a' }),
    lamp: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4, emissive: 0x000000 }),
    dark: pbrMaterial('concrete_smooth', { ...W, tint: '#1c1c1a' }),
  };
  MAT.lamp.name = 'wf:lampglobe';
  return MAT;
}

// ------------------------------------------------------------------------------------------------ helpers
const own = (ctx, x, z) => x >= ctx.ox && x < ctx.ox + 512 && z >= ctx.oz && z < ctx.oz + 512;
const hsh = (a, b = 0) => { let h = (Math.imul(Math.round(a * 100) | 0, 73856093) ^ Math.imul(Math.round(b * 100) | 0, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h & 0xffff) / 0xffff; };
// the drawn ground at (x, z): the authority's base where it has land, else the tile's pad, else the flat base
function groundAt(ctx, x, z) {
  const t = haTerrainAt(x, z);
  if (t !== null && t !== undefined && Number.isFinite(t)) return t;
  const p = ctx && ctx.padYNear ? ctx.padYNear(x, z) : null;
  return p !== null && p !== undefined && Number.isFinite(p) ? p : 3.24;
}
function centroid(R) { let x = 0, z = 0; for (const p of R) { x += p[0]; z += p[1]; } return [x / R.length, z / R.length]; }
function inPoly(R, x, z) { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; }
// an oriented frame: origin o [x, z], unit u [x, z] (along), v = the left-hand perpendicular (inland when u runs with the
// land on its right)
const frame = (o, u, v = null) => {
  const l = Math.hypot(u[0], u[1]), ux = u[0] / l, uz = u[1] / l;
  let vx = -uz, vz = ux;
  if (v) { const m = Math.hypot(v[0], v[1]); vx = v[0] / m; vz = v[1] / m; }
  return { P: (a, b, y) => [o[0] + ux * a + vx * b, y, o[1] + uz * a + vz * b], ux, uz, vx, vz };
};
// a box's facing set: obox wants a right-handed (u, up, v); with an explicit v on the other side, flip it through -v
// a box in a frame: a0..a1 along, b0..b1 across, y0..y1
function fbox(bag, mat, F, a0, a1, b0, b1, y0, y1, skip) {
  const c = F.P((a0 + a1) / 2, (b0 + b1) / 2, (y0 + y1) / 2);
  // (obox's axes must be right-handed: ex x ey = ez; with v = left of u that holds for (u, up, v) in this x-east z-south
  // frame only when v = (-uz, ux); otherwise pass -v and the box is the same)
  const rh = Math.abs(F.vx + F.uz) < 1e-6 && Math.abs(F.vz - F.ux) < 1e-6;
  bag.obox(mat, c, [F.ux, 0, F.uz], [0, 1, 0], rh ? [F.vx, 0, F.vz] : [-F.vx, 0, -F.vz], (a1 - a0) / 2, (y1 - y0) / 2, (b1 - b0) / 2, skip);
}
// a flat polygon (a deck, a pad) at y, triangulated (earcut through three's ShapeUtils), facing up
function flat(bag, mat, R, y) {
  const pts = R.map(([x, z]) => new THREE.Vector2(x, z));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  for (const [a, b, c] of tris) bag.poly(mat, [[R[a][0], y, R[a][1]], [R[b][0], y, R[b][1]], [R[c][0], y, R[c][1]]], [0, 1, 0]);
}
// the side faces of a polygon from y0 to y1 (outward)
function walls(bag, mat, R, y0, y1) {
  let ar = 0; for (let i = 0; i < R.length; i++) { const a = R[i], b = R[(i + 1) % R.length]; ar += a[0] * b[1] - b[0] * a[1]; }
  const sg = ar > 0 ? 1 : -1;
  for (let i = 0; i < R.length; i++) {
    const a = R[i], b = R[(i + 1) % R.length], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.02) continue;
    const n = [(dz / l) * sg, 0, (-dx / l) * sg];
    bag.quad(mat, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n);
  }
}
// a polyline offset sideways by d (left of travel positive)
function offsetLine(L, d) {
  return L.map((p, i) => { const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1; return [p[0] - (dz / l) * d, p[1] + (dx / l) * d]; });
}
// a lamp post of the park's kind (a black pole, a lantern head), on y0
function parkLamp(bag, M, x, z, y0, h = 4.3) {
  bag.rod(M.iron, [x, y0, z], [x, y0 + 0.5, z], 0.13, 8, 0.1, true);
  bag.rod(M.iron, [x, y0 + 0.5, z], [x, y0 + h, z], 0.065, 8, 0.05, false);
  bag.rod(M.lamp, [x, y0 + h, z], [x, y0 + h + 0.5, z], 0.19, 8, 0.15, true);
  bag.rod(M.iron, [x, y0 + h + 0.5, z], [x, y0 + h + 0.65, z], 0.2, 8, 0.03, true);
}
// a bench (timber slats on iron ends) at (x, z) facing (fx, fz)
function bench(bag, M, x, z, y0, fx, fz, len = 1.8) {
  const F = frame([x, z], [-fz, fx]);
  for (const b of [-0.18, 0, 0.18]) fbox(bag, M.deck, F, -len / 2, len / 2, b - 0.05, b + 0.05, y0 + 0.42, y0 + 0.46);
  fbox(bag, M.deck, F, -len / 2, len / 2, -0.3, -0.26, y0 + 0.5, y0 + 0.85);
  for (const e of [-len / 2 + 0.1, len / 2 - 0.1]) fbox(bag, M.iron, F, e - 0.03, e + 0.03, -0.3, 0.25, y0, y0 + 0.42);
}

// a timber deck's water edges (a polygon R at deck level y): on each edge with water 3 m out, the fascia (0.45 m), the dark
// under the deck down past the water plane (set back 0.6 m), piles under the edge every 2.6 m, fender piles outside it every
// 3 m and the iron rail; the edges on land are left to the ground
function deckEdges(bag, M, R, y, o = {}) {
  let ar = 0; for (let i = 0; i < R.length; i++) { const a = R[i], b = R[(i + 1) % R.length]; ar += a[0] * b[1] - b[0] * a[1]; }
  const sg = ar > 0 ? 1 : -1;
  const wet = (x, z) => { const q = haInfo(x, z); return !q || q.tag >= 3; };
  for (let i = 0; i < R.length; i++) {
    const a = R[i], b = R[(i + 1) % R.length], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
    if (L < 0.3) continue;
    const tx = dx / L, tz = dz / L, nx = tz * sg, nz = -tx * sg, mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!wet(mx + nx * 3, mz + nz * 3)) continue;
    const P = (t, off, yy) => [a[0] + tx * t + nx * off, yy, a[1] + tz * t + nz * off];
    bag.quad(M.timber, P(0, 0.02, y - 0.45), P(L, 0.02, y - 0.45), P(L, 0.02, y + 0.03), P(0, 0.02, y + 0.03), [nx, 0, nz]);
    bag.quad(M.dark, P(0, -0.6, -2.4), P(L, -0.6, -2.4), P(L, -0.6, y - 0.45), P(0, -0.6, y - 0.45), [nx, 0, nz]);
    bag.quad(M.timber, P(0, -0.6, y - 0.45), P(L, -0.6, y - 0.45), P(L, 0.02, y - 0.45), P(0, 0.02, y - 0.45), [0, -1, 0]);
    for (let t = 1.3; t < L - 0.5; t += 2.6) { const p = P(t, -0.3, 0); bag.rod(M.timber, [p[0], -2.4, p[2]], [p[0], y - 0.45, p[2]], 0.17, 7); }
    if (o.fenders !== false) for (let t = 1.5; t < L - 0.5; t += 3.0) { const p = P(t, 0.24, 0); bag.rod(M.timber, [p[0], -2.4, p[2]], [p[0], y - 0.05, p[2]], 0.16, 7, 0.16, true); }
    if (o.rail !== false) {
      const r0 = P(0, -0.25, y), r1 = P(L, -0.25, y);
      for (const h of [0.1, 1.0]) bag.beam(M.iron, [r0[0], y + h, r0[2]], [r1[0], y + h, r1[2]], 0.05, 0.06);
      for (let t = 0; t <= L; t += 2.4) { const p = P(t, -0.25, y); bag.beam(M.iron, p, [p[0], y + 1.1, p[2]], 0.07, 0.07); }
      for (let t = 0.12; t < L; t += 0.125) { const p = P(t, -0.25, y); bag.beam(M.iron, [p[0], y + 0.1, p[2]], [p[0], y + 1.0, p[2]], 0.018, 0.018); }
    }
  }
}

// ------------------------------------------------------------------------------------------------ the shore
// the styles by stretch, each a polyline along the coastline; a wall segment takes the style of the nearest stretch whose
// line lies within 18 m of its middle
const RIP = { kind: 'riprap', slope: 1.5, size: 1.15 }, RIPS = { kind: 'riprap', slope: 1.7, size: 0.85 };
const BEACH = { kind: 'beach', slope: 3.4 };
const SHORE = [
  // the Farragut substation's river front and its west side on the inlet: a concrete relieving platform on piles
  { st: { kind: 'pier', mat: 'concrete', fascia: 0.9, fender: false, pile: 3.2 }, pts: [[-1032.7, 8607.8], [-1281.1, 8633.6], [-1285.1, 8717.3]] },
  // John Street: riprap round the inlet's head and along the park (the walkway's rail on its top), under the Manhattan Bridge
  { st: { kind: 'riprap', slope: 1.6, size: 1.0, rail: 'iron' }, pts: [[-1285.1, 8717.3], [-1303.3, 8717.2], [-1302.1, 8695.9], [-1301.2, 8677.6], [-1310.1, 8666.1], [-1333.3, 8659.9], [-1377.6, 8663.2], [-1413.1, 8665.9], [-1433.3, 8673.1], [-1437.2, 8708.8], [-1438.4, 8720.4], [-1458.1, 8726.5], [-1485.4, 8722.7], [-1516.3, 8716.0], [-1541.0, 8700.9], [-1551.8, 8690.1]] },
  // Main Street Park's point
  { st: RIP, pts: [[-1551.8, 8690.1], [-1566.7, 8688.6], [-1586.9, 8683.0], [-1601.3, 8684.4], [-1608.0, 8690.5]] },
  // Pebble Beach and the cove's head
  { st: BEACH, pts: [[-1608.0, 8690.5], [-1613.4, 8699.1], [-1621.3, 8715.8], [-1620.5, 8721.8], [-1622.7, 8730.9], [-1634.2, 8742.9], [-1651.6, 8753.3], [-1657.7, 8761.4], [-1663.6, 8786.5], [-1673.6, 8788.6]] },
  // the shingle and riprap in front of the Empire Stores to the carousel
  { st: RIPS, pts: [[-1673.6, 8788.6], [-1704.2, 8786.7], [-1724.9, 8780.8], [-1739.1, 8772.5], [-1752.9, 8756.9], [-1759.7, 8744.0], [-1764.3, 8740.1]] },
  // Empire Fulton Ferry: the timber promenade round the carousel and on west to the Brooklyn Bridge
  { st: { kind: 'pier', mat: 'timber', fascia: 0.45, rail: 'iron', pile: 2.4, deck: 5.5, lift: -0.2 }, pts: [[-1764.3, 8740.1], [-1764.8, 8714.1], [-1797.7, 8713.8], [-1801.7, 8719.1], [-1868.4, 8719.9], [-1890.9, 8724.7], [-1887.2, 8732.9], [-1904.4, 8736.0], [-1910.1, 8728.6], [-1946.3, 8740.9], [-1969.3, 8760.4], [-1988.4, 8779.3]] },
  // the River Cafe's barge: its hull is the part's
  { st: { kind: 'skip' }, pts: [[-1988.8, 8783.0], [-1984.8, 8789.8], [-1988.7, 8797.6], [-1996.2, 8789.8], [-2007.9, 8812.5], [-1999.3, 8814.7], [-2005.3, 8829.6], [-2000.3, 8832.6]] },
  // the cove beside the landing: sand under the old steel wall
  { st: { kind: 'beach', slope: 3.0 }, pts: [[-2000.3, 8832.6], [-1993.5, 8836.4], [-1979.8, 8850.1], [-1985.2, 8858.5], [-1992.5, 8866.4]] },
  // the Fulton Ferry Landing: its deck draws its own edges (buildLanding)
  { st: { kind: 'skip' }, pts: [[-1992.5, 8866.4], [-1999.5, 8861.7], [-2031.1, 8840.4], [-2034.9, 8850.1], [-2042.4, 8870.1], [-2038.3, 8872.1], [-2015.2, 8883.2], [-2009.9, 8885.9]] },
  // Pier 1's granite bulkhead with the park's rail
  { st: { kind: 'granite', rail: 'iron', esp: true }, pts: [[-2009.9, 8885.9], [-2017.4, 8903.9], [-2088.3, 8870.7], [-2110.7, 8862.4], [-2268.8, 9063.2], [-2249.6, 9080.4], [-2217.4, 9096.9], [-2169.8, 9118.1]] },
];
// (a point takes the style of the nearest stretch within 10 m whose line it projects onto, or past an end of it by 2 m)
function nearestStretch(x, z, maxD = 10) {
  let best = null, bd = maxD;
  for (const S of SHORE) for (let i = 0; i + 1 < S.pts.length; i++) {
    const [ax, az] = S.pts[i], [bx, bz] = S.pts[i + 1], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, L = Math.sqrt(L2);
    const t0 = ((x - ax) * dx + (z - az) * dz) / L2;
    if ((i === 0 && t0 * L < -2) || (i + 2 === S.pts.length && (t0 - 1) * L > 2)) continue;
    const t = Math.max(0, Math.min(1, t0)), d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < bd) { bd = d; best = S; }
  }
  return best;
}
function edgeRule(x, z) {
  if (!WF65 || x < -2320 || x > -1000 || z < 8580 || z > 9140) return null;
  const S = nearestStretch(x, z);
  if (!S) return null;
  return S.st;
}
if (WF65) { swTakeRule((x, z) => edgeRule(x, z) !== null); swEdgeRule(edgeRule); }   // (the kit draws this shore's swept segments)
// the ferry's float drawn by this part: the planimetric deck in its place (wshCoast's pier on piles) is left out
if (WF65) marinaDropPierRule((ox, oz, id, ring) => {
  if (!ring || !ring.length) return false;
  const [cx, cz] = centroid(ring);
  return cx > -2085 && cx < -2030 && cz > 8812 && cz < 8858;
});

// ------------------------------------------------------------------------------------------------ Fulton Ferry
const LANDING = [[-2007.1, 8881.1], [-2009.9, 8885.9], [-2015.2, 8883.2], [-2038.3, 8872.1], [-2042.4, 8870.1], [-2035.7, 8852.2], [-2031.1, 8840.4], [-1999.5, 8861.7], [-1992.5, 8866.4], [-1989.3, 8868.3], [-1984.9, 8870.1], [-1986.5, 8872.2], [-1990.7, 8878.3], [-1996.1, 8876.3], [-2000.9, 8876.7], [-2005.5, 8879.2]];
const FLOAT = [[-2035.7, 8852.2], [-2050.4, 8841.7], [-2052.0, 8844.0], [-2079.6, 8824.3], [-2073.6, 8816.0], [-2046.1, 8835.6], [-2047.8, 8838.1], [-2034.1, 8847.9]];
const FIREBOAT = [[-1976.2, 8889.6], [-1991.3, 8879.2], [-1986.5, 8872.2], [-1971.4, 8882.6]];
const BARGEMUSIC = { c: [-2031.0, 8885.7], u: [0.897, 0.442], L: 30.5, B: 9.0 };   // (the old pier's outline, way 245320701)
// the River Cafe's barges along the coastline: the outer one 27.7 m from (-1995.2, 8787.9), the inner one 21.1 m from
// (-1995.5, 8810.9) set 10.3 m back, both running SSW with the land on their east (way 1257083252); their widths to the shore
const CAFE = { u: [-0.458, 0.888], n: [0.888, 0.458], parts: [{ o: [-1995.2, 8787.9], L: 27.7, B: 23.0 }, { o: [-1995.5, 8810.9], L: 21.1, B: 12.9 }] };
const DOLPHINS = [[18, 11], [27, 11], [36, 11], [45, 11], [18, 19], [27, 19], [36, 19], [45, 19]];   // (in the ferry pier's frame: along it, north of it)


function buildLanding(bag, M, ctx) {
  // the deck at the terrain's level plus 0.3 (a raised timber deck), planks along the pier's long axis
  let g = -Infinity; for (const [x, z] of LANDING) g = Math.max(g, groundAt(ctx, x, z));
  const y = (Number.isFinite(g) ? g : 3.3) + 0.3;
  flat(bag, M.deck, LANDING, y);
  deckEdges(bag, M, LANDING, y);
  // the shade pavilion (an open timber frame under a cream canopy) and the small red-roofed office behind it, benches
  // along the rail, lamps at the corners
  const K = frame([-2003.5, 8867.5], [0.83, -0.56]);
  for (const a of [-4.6, -1.5, 1.5, 4.6]) for (const b of [-3.2, 3.2]) fbox(bag, M.timber, K, a - 0.15, a + 0.15, b - 0.15, b + 0.15, y, y + 3.0);
  for (const b of [-3.2, 3.2]) fbox(bag, M.timber, K, -5.0, 5.0, b - 0.12, b + 0.12, y + 2.75, y + 3.05);
  for (let a = -4.6; a <= 4.61; a += 1.15) fbox(bag, M.timber, K, a - 0.06, a + 0.06, -3.6, 3.6, y + 3.05, y + 3.2);
  fbox(bag, M.cream, K, -5.2, 5.2, -3.8, 3.8, y + 3.2, y + 3.35);
  const S = frame([-1995.0, 8874.5], [0.83, -0.56]);
  fbox(bag, M.white, S, -2.4, 2.4, -1.7, 1.7, y, y + 2.6);
  { const e = 0.25, a0 = -2.4 - e, a1 = 2.4 + e, b0 = -1.7 - e, b1 = 1.7 + e, yE = y + 2.6, yR = y + 3.7;
    bag.quad(M.red, S.P(a0, b0, yE), S.P(a1, b0, yE), S.P(a1, 0, yR), S.P(a0, 0, yR), null); bag.quad(M.red, S.P(a1, b1, yE), S.P(a0, b1, yE), S.P(a0, 0, yR), S.P(a1, 0, yR), null);
    for (const a of [-2.4, 2.4]) bag.poly(M.white, [S.P(a, -1.7, yE), S.P(a, 1.7, yE), S.P(a, 0, yR - 0.1)], null); }
  for (const [x, z] of [[-2033.0, 8845.0], [-2039.8, 8866.0], [-2012.0, 8881.5], [-2001.0, 8860.0]]) parkLamp(bag, M, x, z, y);
  for (const [x, z, fx, fz] of [[-2026.0, 8848.0, 0.56, 0.83], [-2017.0, 8854.0, 0.56, 0.83], [-2036.0, 8862.0, 0.94, -0.35], [-2027.0, 8876.0, -0.43, -0.9]]) bench(bag, M, x, z, y, fx, fz);
  // the ferry pier: a fixed walkway 5 m wide on piles from the deck's river face out 34 m (a concrete deck, pipe rails, a
  // lamp every 12 m), a hinged gangway down to the ferry barge at its end (24 x 10 m, a dark hull, a grey deck, the white
  // waiting canopy on blue posts); the mooring dolphins in two rows north of it (OpenStreetMap way 245320702's line)
  const WK = frame([-2035.2, 8850.6], [-0.81, -0.585], [0.585, -0.81]), yW = y - 0.35, WL = 34;
  fbox(bag, M.concD, WK, 0, WL, -2.5, 2.5, yW - 0.45, yW);
  for (let a = 1.5; a < WL; a += 4.2) for (const b of [-2.1, 2.1]) { const p = WK.P(a, b, 0); bag.rod(M.concD, [p[0], -2.0, p[2]], [p[0], yW - 0.45, p[2]], 0.24, 8); }
  for (const b of [-2.45, 2.45]) {
    for (let a = 0; a <= WL; a += 2.0) bag.rod(M.steel, WK.P(a, b, yW), WK.P(a, b, yW + 1.07), 0.03, 6);
    for (const h of [0.55, 1.07]) bag.rod(M.steel, WK.P(0, b, yW + h), WK.P(WL, b, yW + h), 0.025, 6);
  }
  for (let a = 6; a < WL; a += 12) parkLamp(bag, M, ...(() => { const p = WK.P(a, 2.3, 0); return [p[0], p[2]]; })(), yW, 4.0);
  const GL = 9, yB = 1.05;
  for (let a = 0; a < GL; a += 1.5) fbox(bag, M.steel, WK, WL + a, WL + a + 1.5, -1.5, 1.5, yW - 0.2 - ((a + 0.75) / GL) * (yW - yB), yW - ((a + 0.75) / GL) * (yW - yB));
  for (const b of [-1.5, 1.5]) bag.beam(M.steel, WK.P(WL, b, yW + 1.0), WK.P(WL + GL, b, yB + 1.0), 0.06, 0.06);
  const B0 = WL + GL - 1;
  fbox(bag, M.blue, WK, B0, B0 + 24, -5, 5, -0.6, 0.8);
  fbox(bag, M.concD, WK, B0, B0 + 24, -5, 5, 0.8, yB);
  for (let a = B0 + 4; a <= B0 + 20.1; a += 4) for (const b of [-3.6, 3.6]) bag.rod(M.blue, WK.P(a, b, yB), WK.P(a, b, yB + 2.7), 0.09, 6);
  fbox(bag, M.white, WK, B0 + 2.5, B0 + 21.5, -4.2, 4.2, yB + 2.7, yB + 2.95);
  for (const b of [-5, 5]) for (let a = B0; a <= B0 + 24.01; a += 2) bag.rod(M.steel, WK.P(a, b, yB), WK.P(a, b, yB + 1.05), 0.03, 4);
  // the mooring dolphins: clusters of timber piles bound with a wire wrap
  for (const [a, b] of DOLPHINS) {
    const p = WK.P(a, b, 0), x = p[0], z = p[2];
    for (let k = 0; k < 7; k++) { const t = (k / 6) * Math.PI * 2, r = k ? 0.55 : 0; bag.rod(M.timber, [x + Math.cos(t) * r, -1.5, z + Math.sin(t) * r], [x + Math.cos(t) * r * 0.55, 3.8 - 0.15 * k, z + Math.sin(t) * r * 0.55], 0.26, 7, 0.22, true); }
    bag.rod(M.iron, [x, 2.7, z], [x, 3.1, z], 0.82, 10, 0.7, false);
  }
}
function buildFireboat(bag, M, ctx) {
  // the fireboat house (1926): two storeys under a red hipped roof, white walls, the hose-drying tower on its land corner
  const F = frame(FIREBOAT[3], [FIREBOAT[2][0] - FIREBOAT[3][0], FIREBOAT[2][1] - FIREBOAT[3][1]], [FIREBOAT[0][0] - FIREBOAT[3][0], FIREBOAT[0][1] - FIREBOAT[3][1]]);
  const L = Math.hypot(FIREBOAT[2][0] - FIREBOAT[3][0], FIREBOAT[2][1] - FIREBOAT[3][1]), B = Math.hypot(FIREBOAT[0][0] - FIREBOAT[3][0], FIREBOAT[0][1] - FIREBOAT[3][1]);
  let g = Infinity; for (const [x, z] of FIREBOAT) g = Math.min(g, groundAt(ctx, x, z));
  const y0 = Number.isFinite(g) ? g : 3.3, eave = y0 + 7.4;
  fbox(bag, M.white, F, 0, L, 0, B, y0 - 0.3, eave);
  // windows and the doors (dark recesses)
  for (let a = 1.6; a < L - 1; a += 2.6) for (const yy of [y0 + 1.2, y0 + 4.6]) fbox(bag, M.hull, F, a, a + 1.1, B - 0.04, B + 0.02, yy, yy + 1.7);
  for (let a = 2.4; a < L - 2; a += 4.2) fbox(bag, M.hull, F, a, a + 2.4, -0.02, 0.04, y0, y0 + 3.0);
  // the hipped roof (a frustum to a ridge), its eaves projecting 0.5 m
  const e = 0.5, rise = 3.2, r0 = [F.P(-e, -e, eave), F.P(L + e, -e, eave), F.P(L + e, B + e, eave), F.P(-e, B + e, eave)], ridge = [F.P(B / 2, B / 2, eave + rise), F.P(L - B / 2, B / 2, eave + rise)];
  bag.quad(M.red, r0[0], r0[1], ridge[1], ridge[0], null); bag.quad(M.red, r0[2], r0[3], ridge[0], ridge[1], null);
  bag.poly(M.red, [r0[1], r0[2], ridge[1]], null); bag.poly(M.red, [r0[3], r0[0], ridge[0]], null);
  bag.poly(M.white, [r0[0], r0[3], r0[2], r0[1]], [0, -1, 0]);
  // the tower: a square shaft to 17 m with a belfry and a red pyramid cap
  // (the tower on the building's north-east corner, over Old Fulton Street's end)
  const T = 3.2, ty = y0 + 15.2;
  fbox(bag, M.white, F, 0.2, T + 0.2, 0.2, T + 0.2, eave - 1, ty);
  for (const [a, b] of [[T / 2 + 0.2, 0.2], [0.2, T / 2 + 0.2]]) fbox(bag, M.hull, F, a - 0.5, a + 0.5, b - 0.5, b + 0.5, ty - 2.6, ty - 0.6);
  const c = F.P(T / 2 + 0.2, T / 2 + 0.2, ty), q = [F.P(-0.1, -0.1, ty), F.P(T + 0.5, -0.1, ty), F.P(T + 0.5, T + 0.5, ty), F.P(-0.1, T + 0.5, ty)], apex = [c[0], ty + 2.4, c[2]];
  for (let i = 0; i < 4; i++) bag.poly(M.red, [q[i], q[(i + 1) % 4], apex], null);
}
function buildBargemusic(bag, M) {
  // a steel coffee barge of 1899 (30 m), black hull with a white rub rail, a white deckhouse with a row of windows
  const F = frame(BARGEMUSIC.c, BARGEMUSIC.u), L = BARGEMUSIC.L / 2, B = BARGEMUSIC.B / 2;
  fbox(bag, M.hull, F, -L, L, -B, B, -1.2, 1.3);
  fbox(bag, M.hullW, F, -L - 0.05, L + 0.05, -B - 0.05, B + 0.05, 1.3, 1.55);
  fbox(bag, M.timber, F, -L + 0.3, L - 0.3, -B + 0.3, B - 0.3, 1.55, 1.6);
  fbox(bag, M.white, F, -L + 3.2, L - 2.2, -B + 0.9, B - 0.9, 1.6, 4.4);
  fbox(bag, M.roof, F, -L + 3.0, L - 2.0, -B + 0.7, B - 0.7, 4.4, 4.6);
  for (let a = -L + 4.4; a < L - 3; a += 2.2) for (const b of [-B + 0.88, B - 0.88]) fbox(bag, M.hull, F, a, a + 1.2, b - 0.03, b + 0.03, 2.4, 3.6);
  // the bow's raked end and rails
  for (const b of [-B, B]) for (let a = -L; a <= L; a += 1.8) bag.rod(M.iron, F.P(a, b, 1.55), F.P(a, b, 2.5), 0.03, 4);
}
function buildCafe(bag, M, ctx) {
  // the River Cafe (1977) on its barges: white hulls over a black boot top on the river sides, decks at the land's level,
  // the long glazed dining room along the outer barge's river side under a white roof with a teal fascia, the kitchen wing
  // behind it, the garden pavilion on the inner barge, potted trees along the deck
  let g = -Infinity;
  for (const q of CAFE.parts) for (const [a, b] of [[3, q.B - 2], [q.L - 3, q.B - 2]]) { const x = q.o[0] + CAFE.u[0] * a + CAFE.n[0] * b, z = q.o[1] + CAFE.u[1] * a + CAFE.n[1] * b, v = groundAt(ctx, x, z); if (Number.isFinite(v)) g = Math.max(g, v); }
  const yD = (Number.isFinite(g) ? g : 3.3) + 0.25;
  const [p1, p2] = CAFE.parts, F1 = frame(p1.o, CAFE.u, CAFE.n), F2 = frame(p2.o, CAFE.u, CAFE.n);
  for (const [F, q] of [[F1, p1], [F2, p2]]) {
    for (const [m, y0, y1] of [[M.hull, -1.0, 0.45], [M.hullW, 0.45, yD - 0.3]]) {
      fbox(bag, m, F, 0, q.L, 0, 0.6, y0, y1);                 // the river side
      fbox(bag, m, F, 0, 0.6, 0, q.B, y0, y1);                 // the ends
      fbox(bag, m, F, q.L - 0.6, q.L, 0, q.B, y0, y1);
    }
    fbox(bag, M.hullW, F, -0.12, q.L + 0.12, -0.12, q.B, yD - 0.3, yD - 0.02);
    fbox(bag, M.deck, F, 0, q.L, 0, q.B, yD - 0.02, yD);
  }
  // the dining room on the outer barge
  fbox(bag, M.glass, F1, 2.0, p1.L - 1.0, 0.6, 8.0, yD, yD + 3.3);
  for (let a = 2.0; a <= p1.L - 0.9; a += 2.4) fbox(bag, M.white, F1, a - 0.05, a + 0.05, 0.55, 0.65, yD, yD + 3.3);
  // (the dining room's roof white over a thin teal fascia)
  fbox(bag, M.teal, F1, 1.65, p1.L - 0.65, 0.25, 8.35, yD + 3.3, yD + 3.55);
  fbox(bag, M.hullW, F1, 1.75, p1.L - 0.75, 0.35, 8.25, yD + 3.3, yD + 3.68);
  // the kitchen wing behind it (grey roof) and the north pavilion under its teal roof
  fbox(bag, M.white, F1, 3.0, p1.L - 2.0, 8.8, 20.5, yD, yD + 4.4);
  fbox(bag, M.roof, F1, 2.8, p1.L - 1.8, 8.6, 20.7, yD + 4.4, yD + 4.7);
  fbox(bag, M.white, F1, 0.8, 9.0, 9.0, 21.5, yD, yD + 4.9);
  fbox(bag, M.teal, F1, 0.5, 9.3, 8.7, 21.8, yD + 4.9, yD + 5.25);
  // the inner barge: the garden pavilion (glazed on the river, a white roof) and planters
  fbox(bag, M.glass, F2, 2.5, p2.L - 2.5, 0.8, 7.0, yD, yD + 3.0);
  fbox(bag, M.white, F2, 2.2, p2.L - 2.2, 0.5, 7.3, yD + 3.0, yD + 3.35);
  // planters along the inner barge's river edge
  for (let a = 2.5; a < p2.L - 1.5; a += 4.0) { const q = F2.P(a, 0.55, yD); bag.rod(M.concD, [q[0], yD, q[2]], [q[0], yD + 0.6, q[2]], 0.3, 8, 0.36, true); }
}

// ------------------------------------------------------------------------------------------------ Empire Fulton Ferry
const CAROUSEL = [[-1796.5, 8731.4], [-1796.5, 8753.2], [-1774.8, 8753.2], [-1774.8, 8731.4]];
function buildCarousel(bag, M, ctx) {
  // Jane's Carousel (1922) in its pavilion (Jean Nouvel, 2011): a glass box 22 m square on a stone plinth, slender steel
  // posts, a deep flat roof with a round glazed lantern over the carousel; the carousel itself inside (its canopy, horses)
  const c = centroid(CAROUSEL), F = frame(c, [1, 0]);
  let g = Infinity; for (const [x, z] of CAROUSEL) g = Math.min(g, groundAt(ctx, x, z));
  const y0 = (Number.isFinite(g) ? g : 3.4) + 0.05, h = 7.0, A = 10.85;
  fbox(bag, M.conc, F, -A - 0.8, A + 0.8, -A - 0.8, A + 0.8, y0 - 0.4, y0 + 0.55);
  // the glass walls (on all four sides, set in 0.25 m) and the posts
  for (const [a0, a1, b0, b1] of [[-A + 0.25, A - 0.25, -A + 0.25, -A + 0.3], [-A + 0.25, A - 0.25, A - 0.3, A - 0.25], [-A + 0.25, -A + 0.3, -A + 0.25, A - 0.25], [A - 0.3, A - 0.25, -A + 0.25, A - 0.25]]) fbox(bag, M.glass, F, a0, a1, b0, b1, y0 + 0.55, y0 + h - 0.6);
  for (let t = -A; t <= A + 0.01; t += A / 4) for (const [a, b] of [[t, -A], [t, A], [-A, t], [A, t]]) fbox(bag, M.steel, F, a - 0.09, a + 0.09, b - 0.09, b + 0.09, y0 + 0.55, y0 + h - 0.6);
  // the roof: a deep slab, its top grey, the lantern (a low glazed drum) over the middle
  fbox(bag, M.steel, F, -A - 0.6, A + 0.6, -A - 0.6, A + 0.6, y0 + h - 0.6, y0 + h);
  const N = 32, rL = 7.4;
  for (let k = 0; k < N; k++) {
    const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, p0 = F.P(Math.cos(a0) * rL, Math.sin(a0) * rL, y0 + h), p1 = F.P(Math.cos(a1) * rL, Math.sin(a1) * rL, y0 + h);
    bag.quad(M.glass, p0, p1, [p1[0], y0 + h + 0.9, p1[2]], [p0[0], y0 + h + 0.9, p0[2]], [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)]);
    bag.poly(M.glass, [[c[0], y0 + h + 1.3, c[1]], [p0[0], y0 + h + 0.9, p0[2]], [p1[0], y0 + h + 0.9, p1[2]]], [0, 1, 0]);
  }
  // the carousel: its round platform, the canopy (a red and cream cone), the centre pole and a ring of horses as posts
  const rc = 6.2;
  bag.rod(M.timber, [c[0], y0 + 0.55, c[1]], [c[0], y0 + 0.95, c[1]], rc, 24, rc, true);
  bag.rod(M.red, [c[0], y0 + 4.2, c[1]], [c[0], y0 + 5.6, c[1]], rc + 0.3, 24, 1.2, false);
  bag.rod(M.cream, [c[0], y0 + 3.9, c[1]], [c[0], y0 + 4.2, c[1]], rc + 0.35, 24, rc + 0.3, false);
  bag.rod(M.cream, [c[0], y0 + 0.95, c[1]], [c[0], y0 + 5.6, c[1]], 0.6, 10, 0.6, false);
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; bag.rod(M.hullW, [c[0] + Math.cos(a) * 5, y0 + 0.95, c[1] + Math.sin(a) * 5], [c[0] + Math.cos(a) * 5, y0 + 3.9, c[1] + Math.sin(a) * 5], 0.05, 4); }
}

// ------------------------------------------------------------------------------------------------ the Empire Stores
// The Empire Stores (1870s-1880s coffee and sugar warehouses, converted 2017) on their compiled ring: five storeys of dark red
// brick, a segmental-arched window in every bay with its iron shutters folded back, tall arched openings on the ground floor
// with a granite base course, a corbelled brick cornice; on the roof the glazed rooftop rooms set back from the park front
// along the western half, a pool and decks, planted terraces on the east
const ES_RING = [[-1654.1, 8807.4], [-1655.9, 8846.5], [-1682.1, 8845.2], [-1682.2, 8848.1], [-1689.9, 8847.7], [-1690.6, 8863.2], [-1785.5, 8858.7], [-1785.6, 8861.2], [-1795.4, 8860.8], [-1794.5, 8842.9], [-1793.0, 8843.0], [-1791.8, 8816.3], [-1794.8, 8816.2], [-1793.9, 8798.3], [-1784.4, 8798.7], [-1784.5, 8800.8], [-1654.1, 8807.0]];
function esPainter() {
  const BR = [156, 78, 58], MORT = [110, 92, 82], GLASS = [30, 34, 38], IRON = [44, 50, 48], GRAN = [168, 162, 152];
  return (g, gb, x, y, w, h, i, j, r) => {
    const ground = j === 4;
    const tone = 0.92 + r() * 0.16;
    g.fillStyle = rgbs(BR, tone); g.fillRect(x, y, w, h);
    // brick courses and a few darker and lighter bricks
    for (let yy = 0; yy < h; yy += 4) { g.fillStyle = rgbs(MORT, 1, 0.35); g.fillRect(x, y + yy, w, 1); gb.fillStyle = 'rgb(122,122,122)'; gb.fillRect(x, y + yy, w, 1); }
    for (let k = 0; k < 40; k++) { const bx = x + r() * w, by = y + Math.floor(r() * (h / 4)) * 4; g.fillStyle = r() < 0.55 ? `rgba(20,8,4,${0.08 + r() * 0.12})` : `rgba(190,120,90,${0.06 + r() * 0.08})`; g.fillRect(bx, by + 1, 8 + r() * 6, 3); }
    speckle(g, x, y, w, h, r, Math.round((w * h) / 80), 0.06);
    const arch = (cx, top, ww, hh, rise, fill) => {
      g.beginPath(); g.moveTo(cx - ww / 2, top + hh); g.lineTo(cx - ww / 2, top + rise);
      g.quadraticCurveTo(cx, top - rise, cx + ww / 2, top + rise); g.lineTo(cx + ww / 2, top + hh); g.closePath();
      g.fillStyle = fill; g.fill();
      gb.beginPath(); gb.moveTo(cx - ww / 2, top + hh); gb.lineTo(cx - ww / 2, top + rise); gb.quadraticCurveTo(cx, top - rise, cx + ww / 2, top + rise); gb.lineTo(cx + ww / 2, top + hh); gb.closePath();
      gb.fillStyle = 'rgb(40,40,40)'; gb.fill();
    };
    if (ground) {
      // the granite base course and the tall arched opening, glazed, with a transom and mullions
      const ww = w * 0.64, top = y + h * 0.12, hh = h * 0.8, rise = ww * 0.22;
      g.fillStyle = rgbs(BR, 0.85); g.fillRect(x + w / 2 - ww / 2 - 5, top - rise - 6, ww + 10, rise + 10);   // the brick ring
      arch(x + w / 2, top, ww, hh, rise, rgbs(GLASS));
      g.fillStyle = rgbs(IRON, 1.3); g.fillRect(x + w / 2 - 2, top, 4, hh); g.fillRect(x + w / 2 - ww / 2, top + hh * 0.3, ww, 3);
      g.fillStyle = rgbs(GRAN, 0.95 + r() * 0.08); g.fillRect(x, y + h * 0.92, w, h * 0.08);
      gb.fillStyle = 'rgb(170,170,170)'; gb.fillRect(x, y + h * 0.92, w, h * 0.08);
    } else {
      // a segmental-arched window, its brick arch, a stone sill, the iron shutters folded back (most bays)
      const ww = w * 0.34, top = y + h * 0.24, hh = h * 0.56, rise = ww * 0.16;
      g.fillStyle = rgbs(BR, 0.8); g.fillRect(x + w / 2 - ww / 2 - 4, top - rise - 5, ww + 8, rise + 7);
      arch(x + w / 2, top, ww, hh, rise, rgbs(GLASS));
      g.fillStyle = 'rgba(160,170,180,0.18)'; g.fillRect(x + w / 2 - ww / 2 + 3, top + 2, ww * 0.4, hh * 0.5);
      g.fillStyle = rgbs(GRAN, 1.0); g.fillRect(x + w / 2 - ww / 2 - 4, top + hh, ww + 8, 4);
      gb.fillStyle = 'rgb(200,200,200)'; gb.fillRect(x + w / 2 - ww / 2 - 4, top + hh, ww + 8, 4);
      if (r() < 0.8) for (const sd of [-1, 1]) {
        const sx = x + w / 2 + sd * (ww / 2 + 2) - (sd < 0 ? ww / 2 : 0);
        g.fillStyle = rgbs(IRON, 0.9 + r() * 0.3); g.fillRect(sx, top - rise * 0.5, ww / 2, hh + rise * 0.5);
        gb.fillStyle = 'rgb(165,165,165)'; gb.fillRect(sx, top - rise * 0.5, ww / 2, hh + rise * 0.5);
      }
    }
    streaks(g, x, y, w, h, r, 4, 0.08);
  };
}
let _ES = null;
function esMats() {
  if (_ES) return _ES;
  const tx = facadeTex('wf65-es', { nx: 4, ny: 5, cw: 112, ch: 132, seed: 651, base: [156, 78, 58], paint: esPainter() });
  _ES = {
    tx, wall: facadeMat('wf65-es', tx, { rough: 0.88, bump: 2.0 }),
    brick: pbrMaterial('brick_red_sooted', { ...W }),
    roof: pbrMaterial('roof_membrane', { ...W, tint: '#5f5d5a' }),
    deck: pbrMaterial('wood_painted', { ...W, tint: '#8a7356', chips: 0.2, rot: 90 }),
    plant: pbrMaterial('mulch', { ...W, tint: '#4d6b34' }),
    glass: pbrMaterial('glass_storefront', {}),
    steel: pbrMaterial('steel_black', { ...W }),
    pool: new THREE.MeshStandardMaterial({ color: 0x4f9fb0, roughness: 0.08, metalness: 0.0 }),
  };
  _ES.pool.name = 'wf65:pool';
  return _ES;
}
function buildEmpireStores(bag, M0, ctx, group) {
  const M = esMats(), R = ES_RING;
  let gMin = Infinity, gMax = -Infinity;
  for (const [x, z] of R) { const v = groundAt(ctx, x, z); if (Number.isFinite(v)) { gMin = Math.min(gMin, v); gMax = Math.max(gMax, v); } }
  if (!Number.isFinite(gMin)) { gMin = 3.3; gMax = 3.3; }
  const y0 = gMin - 0.6, yG = gMax + 0.05, fh = 3.66, yE = yG + 5 * fh, yP = yE + 1.1;
  const WL = new Acc(), BK = new Acc(), RF = new Acc();
  // the walls: the facade tile over the five floors (the ground floor its own row), plain brick under the ground line
  wallRing(WL, R, yG, yE, M.tx, { bayW: 3.6, floorH: fh, vRef: yG });
  wallRing(BK, R, y0, yG, M.tx, { bayW: 3.6, floorH: fh, vRef: yG - 5 * fh });
  // the corbelled cornice and the parapet with its coping
  loft(BK, R, yE, [[0, 0], [0.18, 0.12], [0.18, 0.32], [0.36, 0.44], [0.36, 0.64], [0.55, 0.78], [0.55, 1.1], [0, 1.1]], false);
  const inner = offsetRing(R, -0.45);
  wallRing(BK, inner, yE + 1.1, yP + 0.1, M.tx, { bayW: 3.6, floorH: fh, vRef: yG - 5 * fh });
  loft(BK, R, yP, [[0.05, 0], [0.05, 0.12], [-0.5, 0.12], [-0.5, 0]], false);
  capRing(RF, inner, yE + 0.9);
  addMeshes(group, [[WL, M.wall, 'wf65:empirestores:walls'], [BK, M.brick, 'wf65:empirestores:brick'], [RF, M.roof, 'wf65:empirestores:roof']]);
  // the rooftop: glazed rooms set back 5 m from the park front over the western half, decks and the pool before them,
  // planted terraces on the eastern half
  const F = frame([-1784.5, 8800.8], [0.9989, 0.0475], [-0.0475, 0.9989]);   // along the park front (east), inland (south)
  const yR = yE + 0.9;
  fbox(bag, M.glass, F, 4, 62, 6, 30, yR, yR + 3.6);
  fbox(bag, M.steel, F, 3.8, 62.2, 5.8, 30.2, yR + 3.6, yR + 3.9);
  for (let a = 4; a <= 62.01; a += 2.9) fbox(bag, M.steel, F, a - 0.07, a + 0.07, 5.85, 6.0, yR, yR + 3.6);
  fbox(bag, M.deck, F, 2, 64, 1.2, 5.8, yR, yR + 0.12);
  fbox(bag, M.deck, F, 64, 74, 1.2, 30, yR, yR + 0.12);
  fbox(bag, M.pool, F, 65.5, 72.5, 4, 14, yR + 0.12, yR + 0.16);
  for (let a = 78; a < 126; a += 8) fbox(bag, M.plant, F, a, a + 6, 2.5, 20 + 8 * hsh(a, 3), yR, yR + 0.45);
  fbox(bag, M.deck, F, 76, 128, 1.2, 2.4, yR, yR + 0.12);
}

// ------------------------------------------------------------------------------------------------ the river
const DECKBARGE = { c: [-1706.4, 8731.5], u: [-0.079, -0.997], L: 52, B: 15 };
function buildDeckBarge(bag, M) {
  // a steel deck barge moored off Pebble Beach: a rusted flat deck, low coamings, bitts at the corners
  const F = frame(DECKBARGE.c, DECKBARGE.u), L = DECKBARGE.L / 2, B = DECKBARGE.B / 2;
  fbox(bag, M.hull, F, -L, L, -B, B, -0.9, 0.85);
  fbox(bag, M.rust, F, -L + 0.2, L - 0.2, -B + 0.2, B - 0.2, 0.85, 0.9);
  for (const [a0, a1, b0, b1] of [[-L, L, -B, -B + 0.3], [-L, L, B - 0.3, B], [-L, -L + 0.3, -B, B], [L - 0.3, L, -B, B]]) fbox(bag, M.rust, F, a0, a1, b0, b1, 0.85, 1.25);
  for (const [a, b] of [[-L + 1.2, -B + 1.2], [-L + 1.2, B - 1.2], [L - 1.2, -B + 1.2], [L - 1.2, B - 1.2]]) { const p = F.P(a, b, 0.9); bag.rod(M.iron, p, [p[0], 1.5, p[2]], 0.18, 8, 0.18, true); }
}

// ------------------------------------------------------------------------------------------------ the substation
// the Farragut substation (Con Edison): the yard laid out in the frame of its river front, roads round bays of gravel, each
// bay a row of lattice gantries with transformers and breakers under them; sheds stay the compile's
const SUB = { ring: [[-966.6, 8751.7], [-1118.4, 8744.9], [-1239.5, 8739.7], [-1285.7, 8735.4], [-1285.1, 8717.3], [-1281.1, 8633.6], [-1032.7, 8607.8], [-1031.6, 8627.2], [-1032.3, 8640.7], [-1007.8, 8641.6], [-954.2, 8629.9]], o: [-1281.1, 8633.6], u: [0.9947, -0.1033] };
// the yard's control houses and sheds (the city's footprints there, from OpenStreetMap: centre and radius): no equipment
// stands on them
const SHEDS = [[-1274.9, 8638.7, 6.7], [-1118.4, 8710.1, 17.3], [-1068.8, 8691.1, 10.0], [-1034.9, 8634.7, 7.2], [-1237.0, 8683.4, 8.6], [-1176.1, 8686.2, 11.5], [-1147.8, 8634.1, 7.7], [-1021.6, 8694.4, 5.1], [-1057.9, 8625.9, 7.6], [-997.2, 8697.8, 11.8], [-1177.0, 8737.5, 5.1], [-1042.1, 8624.2, 7.4], [-1038.4, 8692.5, 11.5], [-1193.2, 8736.9, 16.2], [-1197.7, 8643.0, 8.8]];
const onShed = (p, r = 1) => SHEDS.some(([x, z, R]) => Math.hypot(p[0] - x, p[2] - z) < R + r);
// the bay grid along the yard (u) and inland (v): the apron along the river 0..13, roads 5 m wide
const SUB_U = [[6, 40], [45, 79], [84, 118], [123, 157], [162, 196], [201, 235]], SUB_V = [[18, 46], [51, 79], [84, 112], [117, 140]];
function buildSubstation(bag, M, ctx) {
  const F = frame(SUB.o, SUB.u), inside = (a, b) => { const p = F.P(a, b, 0); return inPoly(SUB.ring, p[0], p[2]); };
  // the yard's surface: over the terrain and over any ground the tile lays there (the shore strip's lawn), 3 cm
  const KINDS = ['grass', 'plaza', 'sidewalk', 'path', 'asphalt', 'gravel'];
  const gy = (a, b) => {
    const p = F.P(a, b, 0);
    let y = groundAt(ctx, p[0], p[2]) + 0.06;
    if (ctx && ctx.sectionY) for (const k of KINDS) { const v = ctx.sectionY(k, p[0], p[2], 0.3); if (v !== null && v !== undefined && Number.isFinite(v)) y = Math.max(y, v + 0.03); }
    return y;
  };
  // (the surface in cells, each corner at its own height: one continuous sheet; lift lays a layer over another)
  const H = new Map(), hAt = (a, b) => { const k = a.toFixed(2) + ',' + b.toFixed(2); let v = H.get(k); if (v === undefined) H.set(k, (v = gy(a, b))); return v; };
  const cell = (mat, a0, a1, b0, b1, lift = 0, step = 6) => {
    for (let a = a0; a < a1 - 0.01; a += step) for (let b = b0; b < b1 - 0.01; b += step) {
      const aa = Math.min(a1, a + step), bb = Math.min(b1, b + step);
      if (!inside((a + aa) / 2, (b + bb) / 2)) continue;
      bag.quad(mat, F.P(a, b, hAt(a, b) + lift), F.P(aa, b, hAt(aa, b) + lift), F.P(aa, bb, hAt(aa, bb) + lift), F.P(a, bb, hAt(a, bb) + lift), [0, 1, 0]);
    }
  };
  // the apron along the river and the roads between the bays: concrete with yellow edge lines; the bays crushed stone
  cell(M.conc, 0, 250, 0.4, 13);
  for (const [b0, b1] of SUB_V) cell(M.gravel, 1, 250, b0, b1, 0.01);
  for (let k = 0; k < SUB_V.length; k++) { const b0 = k === 0 ? 13 : SUB_V[k - 1][1], b1 = SUB_V[k][0]; cell(M.conc, 0, 250, b0, b1, 0, 5); }
  for (const [a0] of SUB_U) cell(M.conc, a0 - 5, a0, 13, 145, 0.006, 5);
  const y0 = hAt(120, 60);
  for (let k = 0; k < SUB_V.length; k++) for (const b of [SUB_V[k][0] - 0.2, SUB_V[k][1] + 0.05]) for (let a = 0; a < 249; a += 3) if (inside(a + 1.5, b)) {
    const yl = Math.max(hAt(Math.floor(a / 6) * 6, Math.floor(b / 6) * 6), y0) + 0.02;
    bag.quad(M.yellow, F.P(a, b, yl), F.P(a + 3, b, yl), F.P(a + 3, b + 0.15, yl), F.P(a, b + 0.15, yl), [0, 1, 0]);
  }
  // each bay: its row of gantries, the transformers, the breakers
  for (const [a0, a1] of SUB_U) for (const [b0, b1] of SUB_V) {
    if (!inside(a0 + 1, b0 + 1) || !inside(a1 - 1, b1 - 1) || !inside(a0 + 1, b1 - 1) || !inside(a1 - 1, b0 + 1)) continue;
    const seed = hsh(a0, b0), y = gy((a0 + a1) / 2, (b0 + b1) / 2);
    gantryRow(bag, M, F, a0, a1, b0, b1, y, seed);
  }
  // the perimeter fence on its landward sides (chain link on posts, 2.6 m) and along the river apron's edge
  fenceLine(bag, M, SUB.ring.slice(0, 5), (x, z) => groundAt(ctx, x, z));
  // and along the river apron, a metre in from the platform's edge
  fenceLine(bag, M, [F.P(1, 1.2, 0), F.P(248, 1.2, 0)].map((p) => [p[0], p[2]]), (x, z) => groundAt(ctx, x, z));
}
function lattice(bag, M, P0, P1, w, panel) {
  // a square lattice member from P0 to P1 (world), w across, four corner angles and zig-zag lacing on each face
  const d = [P1[0] - P0[0], P1[1] - P0[1], P1[2] - P0[2]], L = Math.hypot(...d), t = d.map((q) => q / L);
  const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  let a = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]]; const al = Math.hypot(...a); a = a.map((q) => q / al);
  const b = [t[1] * a[2] - t[2] * a[1], t[2] * a[0] - t[0] * a[2], t[0] * a[1] - t[1] * a[0]];
  const C = (s, i, j) => [P0[0] + t[0] * s + (a[0] * i + b[0] * j) * w / 2, P0[1] + t[1] * s + (a[1] * i + b[1] * j) * w / 2, P0[2] + t[2] * s + (a[2] * i + b[2] * j) * w / 2];
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [i, j] of corners) bag.beam(M.galv, C(0, i, j), C(L, i, j), 0.13, 0.13);
  if (bag.lod) return;
  const n = Math.max(1, Math.round(L / panel));
  for (let k = 0; k < n; k++) for (let f = 0; f < 4; f++) {
    const [i0, j0] = corners[f], [i1, j1] = corners[(f + 1) % 4], s0 = (L * k) / n, s1 = (L * (k + 1)) / n;
    if (k % 2) bag.beam(M.galv, C(s0, i0, j0), C(s1, i1, j1), 0.07, 0.07); else bag.beam(M.galv, C(s0, i1, j1), C(s1, i0, j0), 0.07, 0.07);
  }
}
function gantryRow(bag, M, F, a0, a1, b0, b1, y, seed) {
  // two or three portal frames across the bay (lattice legs 11-14 m, a lattice beam), linked by a beam along the bay's back
  const H = 11 + 3 * seed, nF = seed > 0.45 ? 6 : 5, span = b1 - b0 - 6;
  const legs = [];
  for (let k = 0; k < nF; k++) {
    const a = a0 + 4 + ((a1 - a0 - 8) * k) / Math.max(1, nF - 1);
    const pA = F.P(a, b0 + 3, y), pB = F.P(a, b1 - 3, y);
    if (onShed(pA, 1.5) || onShed(pB, 1.5) || onShed(F.P(a, (b0 + b1) / 2, y), 1.0)) continue;
    lattice(bag, M, pA, [pA[0], y + H, pA[2]], 0.9, 1.6);
    lattice(bag, M, pB, [pB[0], y + H, pB[2]], 0.9, 1.6);
    lattice(bag, M, [pA[0], y + H - 0.5, pA[2]], [pB[0], y + H - 0.5, pB[2]], 0.8, 1.8);
    legs.push([pA, pB]);
    // insulator strings and conductor drops (dark lines) from the beam
    for (let q = 1; q < 4; q++) { const p = F.P(a, b0 + 3 + (span * q) / 4, y + H - 1.0); bag.rod(M.porcelain, p, [p[0], p[1] - 1.6, p[2]], 0.12, 6); }
  }
  for (let k = 0; k + 1 < legs.length; k++) for (const s of [0, 1]) { const p = legs[k][s], q = legs[k + 1][s]; lattice(bag, M, [p[0], y + H - 0.5, p[2]], [q[0], y + H - 0.5, q[2]], 0.6, 2.0); }
  // the rigid bus: short lattice posts in two rows along the bay carrying three aluminium tubes at 5.5 m
  for (const bb of [b0 + 7, b1 - 7]) {
    if ([0, 0.5, 1].some((t) => onShed(F.P(a0 + 3 + (a1 - a0 - 6) * t, bb, y), 1.5))) continue;
    for (let a = a0 + 3; a <= a1 - 3; a += 7.5) { const p = F.P(a, bb, y); lattice(bag, M, p, [p[0], y + 5.2, p[2]], 0.5, 1.3); }
    for (let k = -1; k <= 1; k++) bag.rod(M.galv, F.P(a0 + 3, bb + k * 0.9, y + 5.5), F.P(a1 - 3, bb + k * 0.9, y + 5.5), 0.09, 6);
  }
  // the transformer: a box with radiator banks and three bushings, on a concrete pad, in the bay's middle
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  if (onShed(F.P(am, bm, y), 6)) return;
  fbox(bag, M.concD, F, am - 5, am + 5, bm - 4, bm + 4, y, y + 0.3);
  fbox(bag, M.xfmr, F, am - 3.2, am + 3.2, bm - 2.2, bm + 2.2, y + 0.3, y + 4.4);
  for (const sg of [-1, 1]) for (let k = 0; k < 7; k++) fbox(bag, M.xfmr, F, am - 2.8 + k * 0.85, am - 2.6 + k * 0.85, bm + sg * 2.2, bm + sg * 3.3, y + 0.8, y + 4.0);
  for (let k = -1; k <= 1; k++) { const p = F.P(am + k * 1.8, bm, y + 4.4); bag.rod(M.porcelain, p, [p[0], y + 6.2, p[2]], 0.18, 8, 0.1, true); }
  // the breakers: three tanks on a frame either side of the transformer along the bay
  for (const da of [-9, 9]) {
    if (am + da < a0 + 2 || am + da > a1 - 2 || onShed(F.P(am + da, bm, y), 3.5)) continue;
    fbox(bag, M.concD, F, am + da - 2.4, am + da + 2.4, bm - 2.2, bm + 2.2, y, y + 0.25);
    for (let k = -1; k <= 1; k++) { const p = F.P(am + da, bm + k * 1.4, y + 1.6); bag.rod(M.galv, [p[0], y + 0.25, p[2]], p, 0.08, 6); bag.rod(M.xfmr, p, [p[0], p[1] + 2.0, p[2]], 0.38, 10, 0.38, true); bag.rod(M.porcelain, [p[0], p[1] + 2.0, p[2]], [p[0], p[1] + 3.3, p[2]], 0.11, 6, 0.07, true); }
  }
}
function fenceLine(bag, M, L, gy) {
  for (let i = 0; i + 1 < L.length; i++) {
    const [ax, az] = L[i], [bx, bz] = L[i + 1], len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / 3));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
      const y0 = gy(x0, z0), y1 = gy(x1, z1);
      bag.rod(M.galv, [x0, y0, z0], [x0, y0 + 2.6, z0], 0.04, 6);
      bag.quad(M.galv, [x0, y0 + 0.05, z0], [x1, y1 + 0.05, z1], [x1, y1 + 2.4, z1], [x0, y0 + 2.4, z0], null);
      bag.beam(M.galv, [x0, y0 + 2.45, z0], [x1, y1 + 2.45, z1], 0.05, 0.05);
    }
  }
}

// ------------------------------------------------------------------------------------------------ hooks
// the compiled buildings drawn here instead (a footprint whose vertex centroid lies in one of these): the River Cafe on its
// barges, the fireboat house, the kiosk on the landing, the carousel's pavilion
const cafeRing = () => { const [p1, p2] = CAFE.parts, P = (q, a, b) => [q.o[0] + CAFE.u[0] * a + CAFE.n[0] * b, q.o[1] + CAFE.u[1] * a + CAFE.n[1] * b]; return [P(p1, -1, -1), P(p1, p1.L + 1, -1), P(p2, p2.L + 1, -1), P(p2, p2.L + 1, p2.B + 1), P(p1, -1, p1.B + 1)]; };
const SKIP = [cafeRing(), FIREBOAT, LANDING, CAROUSEL, ES_RING];
export function skipBuilding(cx, cz) {
  if (!WF65) return false;
  return SKIP.some((R) => inPoly(R, cx, cz));
}
const FEATURES = [
  ['landing', [-2015.0, 8862.0], buildLanding],
  ['fireboat', centroid(FIREBOAT), buildFireboat],
  ['bargemusic', BARGEMUSIC.c, (bag, M) => buildBargemusic(bag, M)],
  ['cafe', [-1996.0, 8808.0], buildCafe],
  ['carousel', centroid(CAROUSEL), buildCarousel],
  ['empirestores', [-1741.9, 8833.1], buildEmpireStores],
  ['deckbarge', DECKBARGE.c, (bag, M) => buildDeckBarge(bag, M)],
  ['substation', [-1150.0, 8680.0], buildSubstation],
];
export function build(group, ctx) {
  if (!WF65) return;
  const M = mats();
  for (const [name, at, fn] of FEATURES) {
    if (!own(ctx, at[0], at[1])) continue;
    try {
      const bag = new GeoBag();
      fn(bag, M, ctx, group);   // (a builder may add meshes of its own to the group: the Empire Stores' facade)
      const tris = bag.flush(group, 'wf65:' + name);
      console.log(`[wf65] ${name}: ${tris} triangles in tile ${ctx.key}`);
    } catch (e) { console.warn('[wf65] ' + name, e); }
  }
}
// the look-dev harness's whole set (client/wf_test.html ?wf=1): every feature into one group, ctx-free
export function buildWaterfrontLookdev() {
  const g = new THREE.Group(), M = mats();
  for (const [name, , fn] of FEATURES) { try { const bag = new GeoBag(); fn(bag, M, null, g); bag.flush(g, 'wf65:' + name); } catch (e) { console.warn('[wf65] ' + name, e); } }
  return g;
}
