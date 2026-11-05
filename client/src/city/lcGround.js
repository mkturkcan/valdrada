// LC69 (2026-11-02): the compiled lawns' paved parts. The compile lays a park's whole polygon as lawn and draws the mapped
// walks over it, so what no walk covers stays grass: at the Battery its promenade along the seawall, its plazas and the
// forecourts, and Peter Minuit Plaza in front of the ferry terminal. Where the 2017 land cover has the ground as paved
// (roads, other paved, rail, structures), the lawn goes to the plaza kind here, before anything samples the ground; the
// pieces are the cover's paved polygons (a 0.9 m close-open, simplified) within the lawn, cut out of the lawn triangles and
// laid as their own triangles at the lawn's level, so the edges follow the cover, not the lawn's triangulation. Data:
// lc_ground.json beside hhp.json, per tile the paved parts as triangles (world x, z; the private dev tool lc_ground.py).
// `?lc69=0` none.
import { mkConvex, tpSplit } from './tsqPlaza.js';
import { haInfo } from '../world/heightAuthority.js';

const isNode = typeof window === 'undefined';
const LC69 = (() => { try { if (!isNode) return new URLSearchParams(location.search).get('lc69') !== '0'; } catch { /* */ } return !(typeof process !== 'undefined' && process.env && process.env.LC69 === '0'); })();
let D = null, P = null;
export function lcGroundReady() {
  if (!LC69) return Promise.resolve(false);
  if (!P) P = (async () => {
    try {
      if (!isNode) {
        const base = new URL('data/hhp_p2/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href;
        const r = await fetch(base + 'lc_ground.json');
        D = r.ok ? await r.json() : null;
      } else {
        const fs = await import(/* @vite-ignore */ 'node:fs/promises');
        const dir = process.env.HHP_P2_DIR || decodeURIComponent(new URL('../../public/data/hhp_p2/', import.meta.url).pathname);
        D = JSON.parse(await fs.readFile(dir + 'lc_ground.json', 'utf8'));
      }
    } catch { D = null; }
    return !!D;
  })();
  return P;
}
const G = 16;   // (the pieces bucketed by a 16 m grid: a lawn triangle tests only the pieces its box reaches)
export function lcGroundApply(tile, ox, oz) {
  const T0 = LC69 && D && D.tiles ? D.tiles[`${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`] : null;
  if (!T0 || !T0.length || !tile || !tile.S) return null;
  // (a piece the region's relief tilts past 10 degrees stays lawn: the banks of a cut or a trench are planted, and a paving
  // laid on one reads as a concrete ramp)
  const relAt = (x, z) => { const q = haInfo(x, z); return q && q.tag < 3 ? q.relief : 0; };
  const T = T0.filter((t) => {
    const r0 = relAt(t[0], t[1]), r1 = relAt(t[2], t[3]), r2 = relAt(t[4], t[5]);
    const ux = t[2] - t[0], uy = r1 - r0, uz = t[3] - t[1], vx = t[4] - t[0], vy = r2 - r0, vz = t[5] - t[1];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    return Math.abs(ny) >= 0.985 * Math.hypot(nx, ny, nz);
  });
  if (!T.length) return null;
  const C = T.map((t) => mkConvex([[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]]));
  const B = new Map();
  C.forEach((c, n) => {
    for (let j = Math.floor(c.bb[1] / G); j <= Math.floor(c.bb[3] / G); j++) for (let i = Math.floor(c.bb[0] / G); i <= Math.floor(c.bb[2] / G); i++) {
      const k = j * 65536 + i; let l = B.get(k); if (!l) B.set(k, (l = [])); l.push(n);
    }
  });
  const fan = (poly, out) => { for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) out.push(p[0] - ox, p[1], p[2] - oz); };
  const st = { m2: 0, tris: 0 };
  // (the paved triangles' corners at the lawn's level: the lawn triangle under each, by a 4 m grid of the lawn's triangles)
  const LW = [], LB = new Map();
  for (const name of ['grass', 'grassU']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const t = [a[i] + ox, a[i + 1], a[i + 2] + oz, a[i + 3] + ox, a[i + 4], a[i + 5] + oz, a[i + 6] + ox, a[i + 7], a[i + 8] + oz], n = LW.length;
      LW.push(t);
      for (let j = Math.floor(Math.min(t[2], t[5], t[8]) / 4); j <= Math.floor(Math.max(t[2], t[5], t[8]) / 4); j++) for (let k = Math.floor(Math.min(t[0], t[3], t[6]) / 4); k <= Math.floor(Math.max(t[0], t[3], t[6]) / 4); k++) {
        const q = j * 65536 + k; let l = LB.get(q); if (!l) LB.set(q, (l = [])); l.push(n);
      }
    }
  }
  let yDef = 0; for (const t of LW) yDef += t[1]; yDef = LW.length ? yDef / LW.length : 0;
  const yAt = (x, z) => {
    let best = null, bw = -1e9;
    for (const n of LB.get(Math.floor(z / 4) * 65536 + Math.floor(x / 4)) || []) {
      const t = LW[n], d = (t[5] - t[8]) * (t[0] - t[6]) + (t[6] - t[3]) * (t[2] - t[8]);
      if (Math.abs(d) < 1e-9) continue;
      const w0 = ((t[5] - t[8]) * (x - t[6]) + (t[6] - t[3]) * (z - t[8])) / d, w1 = ((t[8] - t[2]) * (x - t[6]) + (t[0] - t[6]) * (z - t[8])) / d, w2 = 1 - w0 - w1;
      const w = Math.min(w0, w1, w2);
      if (w > bw) { bw = w; best = w0 * t[1] + w1 * t[4] + w2 * t[7]; }
      if (w >= 0) break;
    }
    return best === null ? yDef : best;
  };
  for (const name of ['grass', 'grassU']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    let changed = false;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const x0 = a[i] + ox, z0 = a[i + 2] + oz, x1 = a[i + 3] + ox, z1 = a[i + 5] + oz, x2 = a[i + 6] + ox, z2 = a[i + 8] + oz;
      const seen = new Set(), cand = [];
      for (let j = Math.floor(Math.min(z0, z1, z2) / G); j <= Math.floor(Math.max(z0, z1, z2) / G); j++) for (let k = Math.floor(Math.min(x0, x1, x2) / G); k <= Math.floor(Math.max(x0, x1, x2) / G); k++) {
        for (const n of B.get(j * 65536 + k) || []) if (!seen.has(n)) { seen.add(n); cand.push(C[n]); }
      }
      if (!cand.length) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      const S = tpSplit([[x0, a[i + 1], z0], [x1, a[i + 4], z1], [x2, a[i + 7], z2]], { ped: cand, car: [] });
      if (!S.plaza.length) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      changed = true;
      for (const poly of S.road) fan(poly, out);   // (the pieces inside are the paved triangles' own, laid below)
    }
    if (changed) tile.S[name] = Float32Array.from(out);
  }
  // the paved parts, counter-clockwise from above as the compile's ground
  const pav = [];
  for (const t of T) {
    const V = [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]].map(([x, z]) => [x - ox, yAt(x, z), z - oz]);
    const cr = (V[1][2] - V[0][2]) * (V[2][0] - V[0][0]) - (V[1][0] - V[0][0]) * (V[2][2] - V[0][2]);
    for (const v of cr > 0 ? V : [V[0], V[2], V[1]]) pav.push(v[0], v[1], v[2]);
    st.m2 += Math.abs(cr) / 2;
  }
  if (!pav.length) return st;
  const c = tile.S.plaza || new Float32Array(0), m = new Float32Array(c.length + pav.length);
  m.set(c); m.set(pav, c.length);
  tile.S.plaza = m;
  st.tris = pav.length / 9;
  tile.__lc69 = st;
  return st;
}
