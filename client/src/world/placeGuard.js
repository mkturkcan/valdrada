// TERRAIN INT2: one placement rule for every standing instance (trees of every source, lamps, benches, signs, hydrants,
// litter baskets and the rest of the street furniture): an instance is rejected where its footprint meets
//   - a building footprint (a tree: its trunk within 2 m of a facade or inside; anything else standing on the ground:
//     inside the footprint),
//   - a carriageway: the compile's asphalt or bus lane at grade, or a Central Park drive's (cpDrives.js, the bike lane
//     included).
// placeGuard(tile, ox, oz) builds the tile's index once (cached on the tile); guard.why(wx, wz, kind) returns null or the
// reason ('bldg', 'road', 'drive'). assemble.js (the page) and tools/terrain/place_gate.mjs (the city-wide gate) use it.
// `?placeGuard=0` / PLACE_GUARD=0: off.
import { FURN } from '../shared/geo.js';
import { buildingsOf, roadsOf } from './tiledata.js';
import { cpDriveNear, CPD_ON, CPD_BAND } from '../city/cpDrives.js';

export const PG_ON = (() => {
  try { if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('placeGuard') === '0') return false; } catch { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.PLACE_GUARD === '0') return false; } catch { /* no env */ }
  return true;
})();
// the kinds that stand on the ground at the pavement (the road rule) and those that may not stand in a building
export const PG_ROAD_KINDS = new Set([FURN.TREE, FURN.LAMP_COBRA, FURN.LAMP_CROOK, FURN.HYDRANT, FURN.SIGNAL_MAST, FURN.SIGNAL_PED, FURN.STREET_SIGN,
  FURN.LITTER, FURN.MAILBOX, FURN.BUS_SHELTER, FURN.LINKNYC, FURN.NEWSSTAND, FURN.BENCH, FURN.BIKE_RACK, FURN.PHONE, FURN.PLANTER,
  FURN.CROSSING_BEACON, FURN.PARKING_METER]);
const TREE_FACADE = 2.0, C = 16;
// the footprints' radii (m): a bench's half length, a shelter's, a lamp's or a sign's base
const PG_R = { [FURN.BENCH]: 0.9, [FURN.BUS_SHELTER]: 1.5, [FURN.NEWSSTAND]: 1.2, [FURN.LAMP_COBRA]: 0.25, [FURN.LAMP_CROOK]: 0.25, [FURN.LITTER]: 0.35, [FURN.PLANTER]: 0.6 };
const CP_BOX = [-1100, -2000, 1700, 1800];   // (Central Park's drives: the park's box, with room)
export function placeGuard(tile, ox, oz) {
  if (tile.__pg) return tile.__pg;
  const B = [], R = [], HB = new Map(), HR = new Map();
  const put = (M, x0, z0, x1, z1, v) => { for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) { const k = i * 100003 + j; let l = M.get(k); if (!l) M.set(k, (l = [])); l.push(v); } };
  const XZ = tile.S && tile.S.bldgXZ;
  if (XZ) for (const b of buildingsOf(tile)) {
    const ring = [];
    let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
    for (let i = 0; i < b.len; i++) { const x = XZ[(b.start + i) * 2] + ox, z = XZ[(b.start + i) * 2 + 1] + oz; ring.push([x, z]); x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (ring.length < 3) continue;
    put(HB, x0 - TREE_FACADE, z0 - TREE_FACADE, x1 + TREE_FACADE, z1 + TREE_FACADE, B.length);
    B.push(ring);
  }
  // the carriageways as drawn: the compile's asphalt and bus-lane triangles at grade (a road line's width is its right of
  // way, walks included)
  // (the asphalt runs on under the walks, 15 cm lower: a point under a walk, a lawn or a plaza is not in the carriageway)
  const HX = new Map(), X = [];
  for (const nm of ['asphalt', 'busred', 'sidewalk', 'plaza', 'brick', 'path', 'grass', 'grassU']) {
    const A = tile.S && tile.S[nm];
    if (!A) continue;
    const road = nm === 'asphalt' || nm === 'busred', M = road ? HR : HX, L = road ? R : X;
    for (let i = 0; i + 8 < A.length; i += 9) {
      if (A[i + 1] > 4.2 || A[i + 4] > 4.2 || A[i + 7] > 4.2) continue;
      const ax = A[i] + ox, az = A[i + 2] + oz, bx = A[i + 3] + ox, bz = A[i + 5] + oz, cx = A[i + 6] + ox, cz = A[i + 8] + oz;
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-6) continue;
      put(M, Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz), L.length);
      L.push([ax, az, bx, bz, cx, cz, d]);
    }
  }
  // (and within a road line's right of way: the asphalt of a parking lot or a yard is not a carriageway)
  const HL = new Map(), RL = [];
  const RV = tile.S && tile.S.roadVerts;
  if (RV) for (const r of roadsOf(tile)) {
    if (r.noTraffic || r.level > 0 || !(r.width > 1)) continue;
    const h = r.width / 2;
    for (let q = 0; q + 1 < r.len; q++) {
      const i = (r.start + q) * 3, ax = RV[i] + ox, az = RV[i + 2] + oz, bx = RV[i + 3] + ox, bz = RV[i + 5] + oz;
      put(HL, Math.min(ax, bx) - h, Math.min(az, bz) - h, Math.max(ax, bx) + h, Math.max(az, bz) + h, RL.length);
      RL.push([ax, az, bx, bz, h]);
    }
  }
  const inRow = (x, z, l) => l && l.some((s) => { const [ax, az, bx, bz, h] = RL[s], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return Math.hypot(ax + dx * t - x, az + dz * t - z) < h; });
  const inRing = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, zi] = P[i], [xj, zj] = P[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
  const ringDist = (P, x, z) => { let d = Infinity; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [ax, az] = P[j], [bx, bz] = P[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); d = Math.min(d, Math.hypot(ax + dx * t - x, az + dz * t - z)); } return d; };
  const why = (x, z, k) => {
    if (!PG_ON || !PG_ROAD_KINDS.has(k)) return null;   // (roof, wall-hung and frontage pieces are the buildings' own)
    const key = Math.floor(x / C) * 100003 + Math.floor(z / C);
    const lb = HB.get(key);
    if (lb) for (const b of lb) { const P = B[b]; if (inRing(P, x, z) || (k === FURN.TREE && ringDist(P, x, z) < TREE_FACADE)) return 'bldg'; }
    const lr = HR.get(key);
    const inTri2 = (q, x, z) => { const [ax, az, bx, bz, cx, cz, d] = q, w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d; return w0 >= 0 && w1 >= 0 && w0 + w1 <= 1; };
    const inTri = (q) => { const [ax, az, bx, bz, cx, cz, d] = q, w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d; return w0 >= 0 && w1 >= 0 && w0 + w1 <= 1; };
    // (the footprint: its centre and four points at its radius)
    const rr = PG_R[k] || 0;
    if (rr) for (const [u, w] of [[rr, 0], [-rr, 0], [0, rr], [0, -rr]]) { const xx = x + u, zz = z + w, l2 = HR.get(Math.floor(xx / C) * 100003 + Math.floor(zz / C)); if (l2 && l2.some((q) => inTri2(R[q], xx, zz))) { const lx = HX.get(Math.floor(xx / C) * 100003 + Math.floor(zz / C)); if (!(lx && lx.some((q) => inTri2(X[q], xx, zz))) && inRow(xx, zz, HL.get(Math.floor(xx / C) * 100003 + Math.floor(zz / C)))) return 'road'; } }
    if (lr && lr.some((q) => inTri(R[q]))) { const lx = HX.get(key); if (!(lx && lx.some((q) => inTri(X[q]))) && inRow(x, z, HL.get(key))) return 'road'; }
    if (CPD_ON && x > CP_BOX[0] && x < CP_BOX[2] && z > CP_BOX[1] && z < CP_BOX[3] && pgDriveHit(x, z, k)) return 'drive';
    return null;
  };
  return (tile.__pg = { why });
}
// a Central Park drive's carriageway under a park record's footprint (city/cpFlora.js builds its lamps, benches and
// baskets from its own tables, outside the tiles' furniture)
export function pgDriveHit(x, z, k) {
  if (!PG_ON || !CPD_ON) return false;
  const q = cpDriveNear(x, z);
  if (!q || q.end) return !!q && q.d < q.half + (PG_R[k] || 0.3);
  // (a drive's corridor, its walks and the lawn band beyond, is laid out by the drive: no old lamp, bench, basket or sign
  // stands in it (city/cpDrives.js sets its own); a tree keeps clear of the walk)
  return k === FURN.TREE ? q.d < q.e0 + 0.6 : q.d < q.e0 + CPD_BAND;
}
