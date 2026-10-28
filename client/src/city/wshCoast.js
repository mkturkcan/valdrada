// The coast's land and piers from mapped polygons (HIGHWAYS P2, on the height authority; data coast.json beside hhp.json,
// written by the dev tool wsh_coast.py): in the corridor's tiles, before the clamp,
//   piers   one solid deck per planimetric pier outline (smoothed), at one level (3.40, the compile's pier level 0.45 m
//           under its bulkheads' caps; each tile its share of the triangles), concrete, with a fascia from the
//           deck down under the water plane; the base and aprons inside go under it, the pier's own lawns and walks sit on it
//   strip   the land within 40 m inland of the shoreline, less roads, buildings, piers and the parkway: lawn, walk or plaza
//           by the mapped polygons, laid on the authority's grade (0.45 m under the nearest wall's cap within 8 m of it,
//           blended to the grade by 14 m), clipped on the swept walls' cap lines on the river side, under the compile's own
//           lawns and walks (which draw over it where they are) and under any paving; the base under it sunk 0.15 m
//   aprons  the compile's 16 m-grid shore aprons out of these tiles altogether
// tile.__wshCoast: counts for the gate.
import { HA_BASE, haInfo } from '../world/heightAuthority.js';
import { wshShoreBand } from './wshGround.js';
import { boxAt, topIn } from './fdrBox.js';
import { marinaDropPier } from './marinaKit.js';
import { SEAWALL, swPier } from './seawallKit.js';   // (SEAWALL KIT: the piers on piles)

const isNode = typeof window === 'undefined';
const PIER_Y = 3.40;
const own = (x, z, tx0, tz0) => x >= tx0 && x < tx0 + 512 && z >= tz0 && z < tz0 + 512;
let D = null, P = null;
// (BKB: the bridge towers that stand in the river: a mapped pier outline wholly within 55 m of one is the tower's fender or
// caisson outline, not a pier: the kit draws the tower's own footing there, the pale deck on piles is left out)
let TOWERS = [];
export function setBridgeTowers(bridges) {
  TOWERS = [];
  for (const b of bridges || []) for (const t of (b.layout && b.layout.towers) || b.towers || []) if (Number.isFinite(t.x) && Number.isFinite(t.z)) TOWERS.push([t.x, t.z]);
}
const towerPier = (ring) => TOWERS.some(([x, z]) => ring.every((q) => Math.hypot(q[0] - x, q[1] - z) < 55));
export function wshCoastReady() {
  if (!P) P = (async () => {
    try {
      if (!isNode) {
        const base = new URL('data/hhp_p2/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href;
        const r = await fetch(base + 'coast.json');
        D = r.ok ? await r.json() : null;
      } else {
        const fs = await import(/* @vite-ignore */ 'node:fs/promises');
        const dir = process.env.HHP_P2_DIR || decodeURIComponent(new URL('../../public/data/hhp_p2/', import.meta.url).pathname);
        D = JSON.parse(await fs.readFile(dir + 'coast.json', 'utf8'));
      }
    } catch { D = null; }
    return !!D;
  })();
  return P;
}

function index(a) {
  const B = new Map();
  for (let i = 0; i + 8 < a.length; i += 9) {
    const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 2), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 2);
    const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 2), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 2);
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(i); }
  }
  return B;
}
function ysAt(a, B, x, z, out) {
  const l = B.get(Math.floor(z / 2) * 4096 + Math.floor(x / 2));
  if (!l) return out;
  for (const i of l) {
    const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
    if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) out.push(w0 * a[i + 1] + w1 * a[i + 4] + w2 * a[i + 7]);
  }
  return out;
}
const append = (S, name, arr) => { if (!arr.length) return; const a = S[name] || new Float32Array(0), m = new Float32Array(a.length + arr.length); m.set(a); m.set(arr, a.length); S[name] = m; };
// (+y up as the compile's ground: counter-clockwise seen from above in its x, z)
const up = (a, b, c) => ((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2])) > 0;

export function wshCoast(tile, ox, oz) {
  const T = D && D.tiles ? D.tiles[`${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`] : null;
  const S = tile.S, st = { strip: 0, pierTris: 0, piers: 0, fascia: 0, sunk: 0, apronsOut: 0 };
  if (S.apron && S.apron.length) { st.apronsOut = S.apron.length / 9; S.apron = new Float32Array(0); }
  if (!T) { tile.__wshCoast = st; return st; }
  const side = wshShoreBand(tile, ox, oz, 30);
  const PAV = ['asphalt', 'sidewalk', 'plaza', 'brick', 'gutter', 'gravel'].filter((n) => S[n] && S[n].length >= 9).map((n) => [S[n], index(S[n])]);
  const pavedMin = (x, z) => { const o = []; for (const [a, B] of PAV) ysAt(a, B, x, z, o); return o.length ? Math.min(...o) : null; };
  const OWN = ['grass', 'grassU', 'path', 'sidewalk', 'plaza'].filter((n) => S[n] && S[n].length >= 9).map((n) => [n, S[n], index(S[n])]);
  const grade = (x, z) => { const q = haInfo(x + ox, z + oz); return q && q.tag < 3 ? HA_BASE + q.relief : null; };
  // ---- piers
  const deck = { plaza: [], curb: [] };
  for (const p of T.piers) {
    if (marinaDropPier(ox, oz, p.id)) { st.marinaDrop = (st.marinaDrop || 0) + 1; continue; }
    if (p.ring && towerPier(p.ring)) { st.towerDrop = (st.towerDrop || 0) + 1; continue; }   // (MARINA KIT: a dock outline drawn as a slab; the kit's floating docks there)
    // (one level for every pier, so a pier split over tiles meets itself: the compile's flat pier level, 0.45 m under its
    // bulkheads' caps)
    const y = PIER_Y;
    p.y = y;
    const d0 = deck.plaza.length;
    for (const t of p.tris) {
      if (!own((t[0] + t[2] + t[4]) / 3, (t[1] + t[3] + t[5]) / 3, ox, oz)) continue;
      // (a pier under an FDR structure: the structure's where the triangle's centre is in it, or a corner is under its deck
      // standing 2 m or more over the pier; a corner in a structure at the pier's level keeps the deck, no hole at its edge)
      if (boxAt((t[0] + t[2] + t[4]) / 3, (t[1] + t[3] + t[5]) / 3)) continue;
      if ([[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]].some(([x, z]) => { const b = boxAt(x, z); if (!b) return false; const top = topIn(b.s, b.i, x, z); return top === null || top > PIER_Y + 2; })) continue;
      const A = [t[0] - ox, y, t[1] - oz], Bv = [t[2] - ox, y, t[3] - oz], C = [t[4] - ox, y, t[5] - oz];
      const tri = up(A, Bv, C) ? [A, Bv, C] : [A, C, Bv];
      for (const v of tri) deck.plaza.push(v[0], v[1], v[2]);
      st.pierTris++;
    }
    // (SEAWALL KIT: the deck on piles: its edge, soffit, pile grid, fender piles and rail; no fascia to the river bed)
    if (SEAWALL) {
      const R = p.ring, mine = deck.plaza.slice(d0);
      const skip = (a, b) => boxAt(a[0], a[1]) || boxAt(b[0], b[1]) || boxAt((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      try { swPier(tile, R, mine, y, ox, oz, (x, z) => own(x, z, ox, oz), skip); } catch (e) { console.warn('[seawall] pier', e); }
      st.piers++;
      continue;
    }
    // (the fascia: both faces, from the deck to 1 m under the water plane)
    const R = p.ring;
    for (let k = 0; k + 1 < R.length; k++) {
      if (!own((R[k][0] + R[k + 1][0]) / 2, (R[k][1] + R[k + 1][1]) / 2, ox, oz)) continue;
      if (boxAt(R[k][0], R[k][1]) || boxAt(R[k + 1][0], R[k + 1][1]) || boxAt((R[k][0] + R[k + 1][0]) / 2, (R[k][1] + R[k + 1][1]) / 2)) continue;   // (the FDR structure's own walls there)
      const a = [R[k][0] - ox, R[k][1] - oz], b = [R[k + 1][0] - ox, R[k + 1][1] - oz];
      const q = [[a[0], y, a[1]], [b[0], y, b[1]], [b[0], -1, b[1]], [a[0], -1, a[1]]];
      for (const ix of [[0, 1, 2, 0, 2, 3], [0, 2, 1, 0, 3, 2]]) for (const i of ix) deck.curb.push(q[i][0], q[i][1], q[i][2]);
      st.fascia++;
    }
    st.piers++;
  }
  const PD = deck.plaza.length ? Float32Array.from(deck.plaza) : null, PDB = PD ? index(PD) : null;
  const inPier = (x, z) => (PD ? ysAt(PD, PDB, x, z, [])[0] ?? null : null);
  // ---- the strip
  const strip = { grass: [], sidewalk: [], plaza: [] };
  const NAME = ['grass', 'sidewalk', 'plaza'];
  const yAt = (x, z, cls) => {
    const b = side(x, z), g = grade(x, z);
    let y = g === null ? (b ? b.cap - 0.45 : HA_BASE) : g + 0.02;
    if (b && b.off >= -0.3) { const yc = b.cap - 0.45, u = Math.max(0, Math.min(1, (b.off - 8) / 6)); y = g === null ? yc : yc + (g + 0.02 - yc) * u; }
    const pv = pavedMin(x, z);
    if (pv !== null && pv > y - 1.0 && pv < y + 1.0) y = Math.min(y, pv - (cls === 0 ? 0.02 : 0.01));
    return y;
  };
  for (const t of T.strip) {
    const cls = t[6], V = [0, 1, 2].map((k) => { const x = t[2 * k] - ox, z = t[2 * k + 1] - oz, b = side(x, z); return [x, 0, z, b ? b.off : 99]; });
    if (V.every((v) => v[3] < -0.3)) continue;
    if (boxAt((t[0] + t[2] + t[4]) / 3, (t[1] + t[3] + t[5]) / 3) || boxAt(t[0], t[1]) || boxAt(t[2], t[3]) || boxAt(t[4], t[5])) continue;   // (an FDR structure's footprint, its deck and band: any corner)
    let poly = V;
    if (V.some((v) => v[3] < -0.3)) {   // (clipped on the cap line: off = -0.3)
      poly = [];
      for (let k = 0; k < 3; k++) {
        const p = V[k], q = V[(k + 1) % 3], pi = p[3] >= -0.3, qi = q[3] >= -0.3;
        if (pi) poly.push(p);
        if (pi !== qi) { const tt = (p[3] + 0.3) / (p[3] - q[3]); poly.push([p[0] + (q[0] - p[0]) * tt, 0, p[2] + (q[2] - p[2]) * tt, -0.3]); }
      }
    }
    for (const v of poly) v[1] = yAt(v[0], v[2], cls);
    // (never a lid over a road: paving more than 1 m under the strip at its centre or a corner leaves it out)
    const under = (x, z, y) => { const o = []; for (const [a, B] of PAV) ysAt(a, B, x, z, o); return o.some((v) => v < y - 1.0); };
    const cx = poly.reduce((m, v) => m + v[0], 0) / poly.length, cz = poly.reduce((m, v) => m + v[2], 0) / poly.length, cy = poly.reduce((m, v) => m + v[1], 0) / poly.length;
    let lid = under(cx, cz, cy) || poly.some((v) => under(v[0], v[2], v[1]));
    for (let k = 1; k + 1 < poly.length && !lid; k++) for (const [u, w] of [[0.5, 0.25], [0.25, 0.5], [0.25, 0.25], [0.5, 0.5], [0.1, 0.45], [0.45, 0.1]]) {
      const A = poly[0], Bq = poly[k], C = poly[k + 1], x = A[0] + (Bq[0] - A[0]) * u + (C[0] - A[0]) * w, z = A[2] + (Bq[2] - A[2]) * u + (C[2] - A[2]) * w, y = A[1] + (Bq[1] - A[1]) * u + (C[1] - A[1]) * w;
      if (under(x, z, y)) { lid = true; break; }
    }
    if (lid) continue;
    for (let k = 1; k + 1 < poly.length; k++) {
      const tri = up(poly[0], poly[k], poly[k + 1]) ? [poly[0], poly[k], poly[k + 1]] : [poly[0], poly[k + 1], poly[k]];
      for (const v of tri) strip[NAME[cls]].push(v[0], v[1], v[2]);
      st.strip++;
    }
  }
  const SA = Float32Array.from([...strip.grass, ...strip.sidewalk, ...strip.plaza]), SB = SA.length ? index(SA) : null;
  const myY = (x, z) => { const o = SB ? ysAt(SA, SB, x, z, []) : []; const p = inPier(x, z); if (p !== null) o.push(p); return o.length ? Math.min(...o) : null; };
  // ---- under them: the base sunk 0.15 m; inside a pier the compile's lawns and walks on the deck, the rest under it
  if (S.terrP1) {
    const a = S.terrP1;
    for (let i = 0; i + 2 < a.length; i += 3) { const m = myY(a[i], a[i + 2]); if (m !== null && a[i + 1] > m - 0.15) { a[i + 1] = m - 0.15; st.sunk++; } }
  }
  if (PD) for (const [n, a] of OWN) {
    const off = n === 'grass' || n === 'grassU' || n === 'path' ? 0.08 : 0.05;
    for (let i = 0; i + 2 < a.length; i += 3) { const p = inPier(a[i], a[i + 2]); if (p !== null && Math.abs(a[i + 1] - p) < 1.5) a[i + 1] = p + off; }
  }
  append(S, 'grass', strip.grass); append(S, 'sidewalk', strip.sidewalk); append(S, 'plaza', SEAWALL ? strip.plaza : strip.plaza.concat(deck.plaza)); append(S, 'curb', deck.curb);
  tile.__wshCoast = st;
  return st;
}
