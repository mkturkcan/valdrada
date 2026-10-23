// The West Side Highway's and the northern parkway's shore ground by rule (HIGHWAYS P2, on the height authority; the
// Battery to 72nd St, 135th St to the Henry Hudson Bridge): before the clamp (haClampGround keeps the ground under the
// paving after it), in the corridor's tiles,
//   sunk    natural ground (lawns, paths, the base, the aprons) on the authority's land lying more than 1.0 m under its
//           grade is laid on the grade (lawns 0.06 m over, the base 0.12 m under; under the compile's paving 0.15 m under
//           that): the compile's old banks and pits behind the bulkheads (66th St: lawns 6 m under the water plane).
//           Left as laid: a triangle hidden under other ground, ground within 8 m of paving 1 m or more under the grade
//           (a road in a cut: its walls and slopes), ground by the parkway's own paving
//   bank    along a swept shore wall (tile.p1Shore): natural ground within 12 m inland of the cap and more than 1 m under
//           it is laid 0.45 m under the cap (the compile's parapet); on the river side, over the authority's water,
//           ground standing out of the river goes under the water plane (-2.6, the wall face's foot)
//   coast   piers and the shore strip from mapped polygons, the aprons out (city/wshCoast.js), last
//   stairs  the shore aprons (the compile's flat infill on its 16 m grid, drawn as cells) are dropped where other natural
//           ground lies within 1.5 m of them at the centre (or at a corner, when the centre has ground within 3 m under
//           the apron): the land is drawn by that ground, the cells' stair-step outline goes with them; an apron with
//           nothing near under it (a pier top over the water) stays
// tile.__wshFix: counts for the gate (tools/terrain/wsh_gate.mjs).
import { HA_BASE, HA_GROUND, haInfo } from '../world/heightAuthority.js';
import { HHP_CH, hhpHits } from './hhp.js';
import { boxAt } from './fdrBox.js';
import { wshCoast } from './wshCoast.js';
import { wshRoadEnds } from './wshEnds.js';

const TILE = 512;
const PAVED = ['asphalt', 'sidewalk', 'plaza', 'brick', 'gutter', 'gravel'];
const LIFT = ['grass', 'grassU', 'path', 'terrP1', 'apron'];
const UNDER = ['grass', 'grassU', 'path', 'terrP1'];
const DECK_Y = [10.26, 10.24, 10.42, 8.76, 8.74];   // (compile.mjs's level-1 deck, its walk and kerb faces, as the scan found them)
// the West Side Highway south of 57th St (no chain of the kit: the compile's boulevard), world x, z
const WSH_SOUTH = [[-3759, 8591], [-3591, 7324], [-3422, 6323], [-3313, 4067], [-2891, 2923], [-2301, 2067], [-1795, 1178]];
let TILES = null;
function corridorTiles() {
  if (TILES) return TILES;
  const T = new Set(), add = (x, z) => { for (const dx of [-250, 0, 250]) for (const dz of [-250, 0, 250]) T.add(`${Math.floor((x + dx) / TILE)}_${Math.floor((z + dz) / TILE)}`); };
  for (const c of HHP_CH) {
    if (!/^(NB|SB|LT\d+|HN\d+)$/.test(c.id)) continue;
    for (let i = 0; i < c.n; i += 10) { if ((c.id === 'NB' || c.id === 'SB') && c.Z[i] > -4300 && c.Z[i] < 150) continue; add(c.X[i], c.Z[i]); }
  }
  for (let k = 0; k + 1 < WSH_SOUTH.length; k++) { const [a, b] = WSH_SOUTH[k], [c, d] = WSH_SOUTH[k + 1]; for (let t = 0; t <= 1; t += 0.005) add(a + (c - a) * t, b + (d - b) * t); }
  if (HHP_CH.length) TILES = T;
  return T;
}
export const wshTile = (ox, oz) => corridorTiles().has(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`);

// a soup's triangles by 2 m bucket; ys at a point
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

// `?wshGround=0` / WSH_GROUND=0: off (A/B)
const OFF = (() => { try { if (typeof location !== 'undefined') return new URLSearchParams(location.search).get('wshGround') === '0'; } catch { /* */ } return typeof process !== 'undefined' && process.env && process.env.WSH_GROUND === '0'; })();
export function wshGroundFix(tile, ox, oz) {
  if (OFF || !tile || !tile.S) return null;
  try { wshRoadEnds(tile, ox, oz); } catch (e) { if (typeof console !== 'undefined') console.warn('[wsh] ends', e); }   // (every chain's street hand-overs: city/wshEnds.js)
  // (outside this corridor, the East River and Harlem River shores: the coast's land and piers only, beside the FDR's and
  // the Harlem River Drive's structures)
  if (!wshTile(ox, oz)) { try { return wshCoast(tile, ox, oz); } catch (e) { if (typeof console !== 'undefined') console.warn('[wsh] coast', e); return null; } }
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const S = tile.S, st = { sunkVerts: 0, apronDropped: 0, apronKept: 0 };
  // (decks) the compile's elevated decks the anchors hold at the flat city's level (flat at its level constants) that are left
  // off the authority's grade by more than 1 m (floating, or poking out of a slope) beside this corridor's viaducts (within 15 m of a chain's paving
  // standing 3 m or more over the grade or on a structure): the old deck the chain replaces, cut to pieces round the new paving
  for (const n of ['asphalt', 'sidewalk', 'curb', 'gutter', 'paintW', 'paintY', 'plaza']) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    const keep = [];
    let cut = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const y0 = a[i + 1], y1 = a[i + 4], y2 = a[i + 7], lo = Math.min(y0, y1, y2), hi = Math.max(y0, y1, y2);
      let drop = false;
      // (never a chain's own paving: on a chain's surface within 0.3 m)
      const onChain = () => { const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz, cy = (y0 + y1 + y2) / 3; return hhpHits(cx, cz, 0.5).some((h) => Math.abs(h.y - cy) < 0.3); };
      // (the compile's level constants, exactly and flat: a street lifted by the relief never lies flat at them)
      if (hi - lo < 0.005 && DECK_Y.some((v) => Math.abs(lo - v) < 0.03) && !onChain()) {
        // (at its centre or a corner: a long deck piece reaches out from under the viaduct)
        const cx0 = (a[i] + a[i + 3] + a[i + 6]) / 3, cz0 = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
        for (const [px, pz] of [[cx0, cz0], [a[i], a[i + 2]], [a[i + 3], a[i + 5]], [a[i + 6], a[i + 8]]]) {
          const q = haInfo(px + ox, pz + oz), g = q && q.tag < 3 ? HA_BASE + q.relief : null;
          if (g !== null && Math.abs(lo - g) > 1.0 && hhpHits(px + ox, pz + oz, 15).some((h) => /^(NB|SB|LT\d+|HN\d+)$/.test(h.c.id) && (h.y > g + 3 || h.c.structs.some((q) => q.kind !== 'cover' && q.kind !== 'under' && h.i >= q.i0 && h.i <= q.i1)))) { drop = true; break; }
        }
      }
      if (drop) { cut++; continue; }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    if (cut) { S[n] = Float32Array.from(keep); st.deckTris = (st.deckTris || 0) + cut; }
  }
  const PI = PAVED.filter((n) => S[n] && S[n].length >= 9).map((n) => [S[n], index(S[n])]);
  const paved = (x, z) => { const o = []; for (const [a, B] of PI) { ysAt(a, B, x, z, o); if (o.length) return true; } return false; };
  const pavedYs = (x, z) => { const o = []; for (const [a, B] of PI) ysAt(a, B, x, z, o); return o; };
  const LN = TILE / 2 + 1;
  let LG = null;
  const lowAt = (x, z) => {
    if (!LG) {
      const G0 = new Float32Array(LN * LN).fill(Infinity);
      for (const [a] of PI) for (let i = 0; i + 8 < a.length; i += 9) {
        const y = Math.min(a[i + 1], a[i + 4], a[i + 7]);
        const i0 = Math.max(0, Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 2)), i1 = Math.min(LN - 1, Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 2));
        const j0 = Math.max(0, Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 2)), j1 = Math.min(LN - 1, Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 2));
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) if (y < G0[j * LN + k]) G0[j * LN + k] = y;
      }
      const G1 = new Float32Array(LN * LN).fill(Infinity); LG = new Float32Array(LN * LN).fill(Infinity);
      for (let j = 0; j < LN; j++) for (let i = 0; i < LN; i++) { let m = Infinity; for (let d = -4; d <= 4; d++) { const q = i + d; if (q >= 0 && q < LN && G0[j * LN + q] < m) m = G0[j * LN + q]; } G1[j * LN + i] = m; }
      for (let j = 0; j < LN; j++) for (let i = 0; i < LN; i++) { let m = Infinity; for (let d = -4; d <= 4; d++) { const q = j + d; if (q >= 0 && q < LN && G1[q * LN + i] < m) m = G1[q * LN + i]; } LG[j * LN + i] = m; }
    }
    const i = Math.max(0, Math.min(LN - 1, Math.floor(x / 2))), j = Math.max(0, Math.min(LN - 1, Math.floor(z / 2)));
    return LG[j * LN + i];
  };
  // (sunk) vertex by vertex: the grade where the authority has land and nothing is paved over the point
  const memo = new Map();
  const gradeAt = (x, z) => {
    const k = `${Math.round(x * 100)},${Math.round(z * 100)}`;
    if (memo.has(k)) return memo.get(k);
    const q = haInfo(x + ox, z + oz);
    let g = q && q.tag < 3 ? HA_BASE + q.relief : null;
    // (under the compile's paving: 0.15 m under its lowest surface there)
    if (g !== null) { const pv = pavedYs(x, z); if (pv.length) g = Math.min(g, Math.min(...pv) - 0.15) + 0.0001; }
    // (a road in a cut or a trench within 8 m, its paving 1 m or more under the grade: the ground there is the cut's,
    // its walls and slopes, held as laid)
    if (g !== null) {
      // (the lowest paving within 8 m: a 2 m grid, min-filtered)
      const lo = lowAt(x, z);
      if (lo < g - 1.0) g = null;
    }
    // (within 3 m of a chain's paving: the corridor clamp's band, held there by the kit)
    if (g !== null && (hhpHits(x + ox, z + oz, 3).length || boxAt(x + ox, z + oz))) g = null;   // (and a covered or shore structure's footprint: fdrBox.js)
    memo.set(k, g);
    return g;
  };
  // (the quick look: the grade on a 2 m grid, the highest of a cell's corners; water and outside the region: -Infinity)
  const QN = TILE / 2 + 1, QG = new Float32Array(QN * QN);
  for (let j = 0; j < QN; j++) for (let i = 0; i < QN; i++) { const q = haInfo(ox + i * 2, oz + j * 2); QG[j * QN + i] = q && q.tag < 3 ? HA_BASE + q.relief : -Infinity; }
  const quick = (x, z) => {
    const i = Math.max(0, Math.min(QN - 2, Math.floor(x / 2))), j = Math.max(0, Math.min(QN - 2, Math.floor(z / 2)));
    return Math.max(QG[j * QN + i], QG[j * QN + i + 1], QG[(j + 1) * QN + i], QG[(j + 1) * QN + i + 1]);
  };
  // (a triangle under other drawn ground is hidden: left as it is; one that is the top at its centre is laid on the grade,
  // the base 0.12 m under it, the others 0.06 m over it)
  const ALL = [...new Set([...HA_GROUND, 'terrP1'])].filter((n) => S[n] && S[n].length >= 9);
  const IX = new Map();
  const idx = (n) => { let B = IX.get(n); if (!B) IX.set(n, (B = index(S[n]))); return B; };
  const hidden = (self, x, y, z) => { for (const n of ALL) { if (n === self || n === 'apron') continue; const o = ysAt(S[n], idx(n), x, z, []); if (o.some((v) => v > y + 0.3)) return true; } return false; };
  for (const n of LIFT) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    const off = n === 'terrP1' ? -0.12 : 0.06;
    for (let i = 0; i + 8 < a.length; i += 9) {
      // (the quick look first: a vertex at or over the authority's grade less 1 m is not low)
      let any = false;
      for (let k = 0; k < 3 && !any; k++) { const g = quick(a[i + 3 * k], a[i + 3 * k + 2]); if (a[i + 3 * k + 1] < g - 0.8) any = true; }
      if (!any) continue;
      let low = false;
      const g3 = [0, 1, 2].map((k) => gradeAt(a[i + 3 * k], a[i + 3 * k + 2]));
      for (let k = 0; k < 3; k++) if (g3[k] !== null && a[i + 3 * k + 1] < g3[k] - 1.0) low = true;
      if (!low) continue;
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      if (hidden(n, cx, cy, cz) && [0, 1, 2].every((k) => hidden(n, cx + (a[i + 3 * k] - cx) * 0.9, cy + (a[i + 3 * k + 1] - cy) * 0.9, cz + (a[i + 3 * k + 2] - cz) * 0.9))) { st.sunkHidden = (st.sunkHidden || 0) + 1; continue; }
      for (let k = 0; k < 3; k++) if (g3[k] !== null && a[i + 3 * k + 1] < g3[k] - 1.0) { a[i + 3 * k + 1] = g3[k] + off; st.sunkVerts++; st['sunk_' + n] = (st['sunk_' + n] || 0) + 1; }
    }
  }
  st.msSunk = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  // (bank) the land behind a swept shore wall (tile.p1Shore's stations: cap line, inland normal, cap level): natural
  // ground within 12 m inland of the cap lying more than 1.0 m under it is laid 0.45 m under the cap (the flat compile's
  // parapet; the base 0.12 m lower): the ground meets the wall along the whole run, no slope down to the river bed
  // behind it
  const P = tile.p1Shore;
  if (P && P.stn && P.stn.length >= 6) {
    const band = wshShoreBand(tile, ox, oz);
    const hidden2 = (self, x, y, z) => { for (const n of ALL) { if (n === self || n === 'apron' || n === 'curb') continue; const o = ysAt(S[n], idx(n), x, z, []); if (o.some((v) => v > y + 0.3)) return true; } return false; };
    for (const n of UNDER) {
      const a = S[n];
      if (!a || a.length < 9) continue;
      const off = n === 'terrP1' ? -0.57 : -0.45;
      for (let i = 0; i + 8 < a.length; i += 9) {
        if (!band.near(a[i], a[i + 2]) && !band.near(a[i + 3], a[i + 5]) && !band.near(a[i + 6], a[i + 8])) continue;
        const c3 = [0, 1, 2].map((k) => {
          const x = a[i + 3 * k], z = a[i + 3 * k + 2], y = a[i + 3 * k + 1], b = band(x, z);
          if (!b) return null;
          // (on the river side of the wall, over the authority's water: the ground goes under the water plane, as the
          // wall's face foot; a strip of land standing out of the river in front of a wall is a stair-stepped beach)
          if (b.off < -0.3) { const q = haInfo(x + ox, z + oz); return (!q || q.tag > 2) && y > -0.5 ? -2.6 - off : null; }
          return b.off >= -0.3 && y < b.cap - 1.0 && !paved(x, z) && !hhpHits(x + ox, z + oz, 3).length && !boxAt(x + ox, z + oz) ? b.cap : null;
        });
        if (c3.every((c) => c === null)) continue;
        const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
        if (c3.every((c) => c === null || c < 0) ? false : hidden2(n, cx, cy, cz)) continue;
        for (let k = 0; k < 3; k++) if (c3[k] !== null) { a[i + 3 * k + 1] = c3[k] + off; st.bankVerts = (st.bankVerts || 0) + 1; }
      }
    }
  }
  st.msBank = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  // (stairs) the aprons over other natural ground
  const ap = S.apron;
  if (ap && ap.length >= 9) {
    const UI = UNDER.filter((n) => S[n] && S[n].length >= 9).map((n) => [S[n], index(S[n])]);
    const out = [];
    for (let i = 0; i + 8 < ap.length; i += 9) {
      const cx = (ap[i] + ap[i + 3] + ap[i + 6]) / 3, cy = (ap[i + 1] + ap[i + 4] + ap[i + 7]) / 3, cz = (ap[i + 2] + ap[i + 5] + ap[i + 8]) / 3;
      // (at its centre and near each corner: an apron cell half over a lawn goes too)
      // (a corner's ground counts only where the centre has ground within 3 m under the apron: else the apron is the land)
      const yc = []; for (const [a, B] of UI) ysAt(a, B, cx, cz, yc);
      const under = yc.some((y) => y > cy - 3 && y < cy + 1.5);
      let hit = false;
      for (const f of under ? [0, 0.85] : [0]) {
        for (let k = 0; k < (f ? 3 : 1) && !hit; k++) {
          const px = cx + (ap[i + 3 * k] - cx) * f, py = cy + (ap[i + 3 * k + 1] - cy) * f, pz = cz + (ap[i + 3 * k + 2] - cz) * f;
          const ys = [];
          for (const [a, B] of UI) ysAt(a, B, px, pz, ys);
          if (ys.some((y) => y > py - 1.5 && y < py + 1.5)) hit = true;
        }
      }
      if (hit) { st.apronDropped++; continue; }
      st.apronKept++;
      for (let k = 0; k < 9; k++) out.push(ap[i + k]);
    }
    S.apron = Float32Array.from(out);
  }
  // (the coast's land and piers from mapped polygons; the shore aprons out: city/wshCoast.js)
  try { wshCoast(tile, ox, oz); } catch (e) { if (typeof console !== 'undefined') console.warn('[wsh] coast', e); }
  st.ms = typeof performance !== 'undefined' ? performance.now() - t0 : 0;
  tile.__wshFix = st;
  return st;
}

// the nearest swept shore wall station to a tile-local point (tile.p1Shore): { cap, off } with off the distance inland
// of the cap line (negative: on the river side), within 3 m of the station along the wall and 12 m across it; or null
export function wshShoreBand(tile, ox, oz, R = 12) {
  const P = tile.p1Shore;
  if (!P || !P.stn || P.stn.length < 6) { const f = () => null; f.near = () => false; return f; }
  const ns = P.stn.length / 6, SG = new Map();
  const OCC = new Set();   // (16 m cells within reach of a station: the quick reject)
  for (let k = 0; k < ns; k++) {
    const q = Math.floor((P.stn[6 * k] - ox) / 4) * 100003 + Math.floor((P.stn[6 * k + 1] - oz) / 4); let l = SG.get(q); if (!l) SG.set(q, (l = [])); l.push(k);
    const i = Math.floor((P.stn[6 * k] - ox) / 16), j = Math.floor((P.stn[6 * k + 1] - oz) / 16);
    const D = Math.ceil(R / 16);
    for (let a = -D; a <= D; a++) for (let b = -D; b <= D; b++) OCC.add((i + a) * 100003 + j + b);
  }
  const near = (x, z) => OCC.has(Math.floor(x / 16) * 100003 + Math.floor(z / 16));
  const f = (x, z) => {
    if (!near(x, z)) return null;
    let best = null, bd = (R + 2) * (R + 2);
    const i0 = Math.floor(x / 4), j0 = Math.floor(z / 4), G = Math.ceil((R + 2) / 4);
    for (let a = -G; a <= G; a++) for (let b = -G; b <= G; b++) for (const k of SG.get((i0 + a) * 100003 + j0 + b) || []) {
      const dx = x + ox - P.stn[6 * k], dz = z + oz - P.stn[6 * k + 1], d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
    if (best === null) return null;
    const k = best, dx = x + ox - P.stn[6 * k], dz = z + oz - P.stn[6 * k + 1];
    const off = dx * P.stn[6 * k + 2] + dz * P.stn[6 * k + 3], lat = Math.abs(dx * P.stn[6 * k + 3] - dz * P.stn[6 * k + 2]);
    return lat <= 3 && off >= -R && off <= R ? { cap: P.stn[6 * k + 4], off } : null;
  };
  f.near = near;
  return f;
}
