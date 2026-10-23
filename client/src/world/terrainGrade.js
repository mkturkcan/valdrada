// TERRAIN GRADE: civil grading of the region's drawn ground along every paving edge (world/heightAuthority.js calls it
// from haClampGround, after the ground-over-paving clamp).
//
// The clamp lowers only the ground triangles that overlap paving, so wherever the natural ground stands over a road, a
// walk or a plaza the ground fell to the paving's edge inside one triangle: a near-vertical cliff at the edge (and the
// same under the ground below an edge). Here the ground meets each paving edge at the edge's level and blends back to
// the natural surface (the authority's TIN) at the surface's maximum slope (lawn and verge 1:3, woodland 1:2, rock 1:1),
// cut where the ground stands over the edge and filled where it lies under it. Where the band the slope needs is not
// there (a building, another paving, an existing wall, or a natural slope as steep as the limit), the edge gets a
// retaining wall of the height the slope cannot take (one continuous swept run per edge chain, coping on top) and the
// ground meets the wall's top (cut) or foot (fill).
//
// The stations (every metre along the ground-facing paving edges: point, level, outward normal, slope, band, wall
// heights) come from a product (tools/terrain/grade_build.mjs -> data/terrain_grade/<tx>_<tz>.bin, each tile's file
// holding its own stations and its neighbours' within 16 m of it) so the two tiles at a border move their shared ground
// alike. Without the product for a tile the stations are found from the tile itself (border ground then held).
// `?terrainGrade=0` / TERRAIN_GRADE=0: off.
import { haInfo, haInfoIn, HA_PAVED, haInCentralPark } from './heightAuthority.js';
// (the FDR's covered and stacked structures, city/fdrBox.js: their walls hold the ground; bound late, at the first tile's
// load, the module graph being circular)
let boxAt = () => null, boxTopIn = null, boxQuads = null, boxCorner = null, hhpHitsF = null;

const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
const QP = (k) => { try { return typeof location !== 'undefined' ? new URLSearchParams(location.search).get(k) : null; } catch { return null; } };
// the parts behind their own flags: `?gradeWalls=0` / TERRAIN_GRADE_WALLS=0 (mapped walls holding their ground),
// `?gradeNatBank=0` / TERRAIN_GRADE_NATBANK=0 (natural banks at road edges), `?gradeDrape=0` / TERRAIN_GRADE_DRAPE=0
const FLAG_OFF = (q, e) => QP(q) === '0' || (typeof process !== 'undefined' && process.env && process.env[e] === '0');
export const GRADE_WALLS = !FLAG_OFF('gradeWalls', 'TERRAIN_GRADE_WALLS'), GRADE_NATBANK = !FLAG_OFF('gradeNatBank', 'TERRAIN_GRADE_NATBANK'), GRADE_DRAPE = !FLAG_OFF('gradeDrape', 'TERRAIN_GRADE_DRAPE');
export const GRADE_OFF = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('terrainGrade') === '0') || (isNode && process.env.TERRAIN_GRADE === '0');
const TILE = 512, HA_BASE = 3.24, HA_ASPHALT = 3.385;
export const GRADE_R = 15;          // the gate's reach, and the longest band
export const SLOPE = { lawn: 1 / 3, wood: 1 / 2, rock: 1 };
const STEP_MIN = 0.12;              // a step under this between the edge and the natural ground is the compiled separation
const DECK = 4.0;                   // paving more than this over the natural ground: a structure (its own kit), not graded
const CUT_MAX = 6.0;                // a cut wall over this, or a fill wall over FILL_MAX: left as laid (counted: a structure's
const FILL_MAX = 4.0;               // own kit, a quarry face, a bridge's abutment)
const WALL_MIN = 0.4;               // a wall lower than this: the band takes it (steeper ground in a short band instead)
// the drawn ground's offsets over the grade (the authority's asphalt level): base -0.145, lawn +0.127
export const OFF = { terrP1: HA_BASE - HA_ASPHALT, grass: 0.127, grassU: 0.127 };
export const GROUND_SOUPS = ['terrP1', 'grass', 'grassU'];
const edgeKinds = () => [...HA_PAVED, 'rbal'];   // (the paving, and the rail corridors' ballast: the ground meets its edge too)
const SEP = { rbal: 0.3, asphalt: 0, gutter: 0, apron: 0, sidewalk: 0.135, path: 0.155, plaza: 0.135, brick: 0.135, gravel: 0.155 };

// ---- the cover (world/vegP1.js's class mask, 0.5 m): 1 lawn, 2 meadow, 3 woodland floor, 4 soil, 5 rock, 6 paved ...
const COVER = new Map();
function coverDir() {
  if (isNode) return (process.env.TERRAIN_P1_DIR || decodeURIComponent(new URL('../../public/data/terrain_p1/', import.meta.url).pathname)).replace(/terrain_p1\/?$/, '') + 'veg_p1/cover/';
  return new URL('data/veg_p1/cover/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href;
}
async function inflate(parts) {
  if (isNode) { const z = await import(/* @vite-ignore */ 'node:zlib'); return new Uint8Array(z.inflateSync(Buffer.concat(parts.map((p) => Buffer.from(p))))); }
  return new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
}
async function readBytes(url) {
  if (isNode) { const fs = await import(/* @vite-ignore */ 'node:fs/promises'); try { return new Uint8Array(await fs.readFile(url)); } catch { return null; } }
  const r = await fetch(url).catch(() => null);
  return r && r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}
// the class channel of an RGBA8 PNG (veg_build.py writes them non-interlaced, 8 bit RGBA)
async function decodeR(b) {
  if (!b) return null;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 8, w = 0, h = 0;
  const parts = [];
  while (p + 8 <= b.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (type === 'IHDR') { w = dv.getUint32(p + 8); h = dv.getUint32(p + 12); if (b[p + 16] !== 8 || b[p + 17] !== 6 || b[p + 20] !== 0) return null; }
    else if (type === 'IDAT') parts.push(b.subarray(p + 8, p + 8 + len));
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = await inflate(parts), stride = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride, u = o - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= 4 ? out[o + i - 4] : 0, c = y > 0 ? out[u + i] : 0, d = y > 0 && i >= 4 ? out[u + i - 4] : 0;
      let v;
      if (f === 0) v = x; else if (f === 1) v = x + a; else if (f === 2) v = x + c; else if (f === 3) v = x + ((a + c) >> 1);
      else { const pp = a + c - d, pa = Math.abs(pp - a), pb = Math.abs(pp - c), pc = Math.abs(pp - d); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d); }
      out[o + i] = v & 255;
    }
  }
  const R = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) R[i] = out[4 * i];
  return { w, h, R };
}
export async function gradeCoverLoad(tx, tz) {
  const k = `${tx}_${tz}`;
  if (!COVER.has(k)) COVER.set(k, decodeR(await readBytes(coverDir() + k + '.png')).catch(() => null));
  const v = await COVER.get(k);
  COVER.set(k, v);
  return v;
}
export function coverClass(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE), C = COVER.get(`${tx}_${tz}`);
  if (!C || C instanceof Promise) return 0;
  const c = Math.floor(((x - tx * TILE) / TILE) * C.w), r = Math.floor(((z - tz * TILE) / TILE) * C.h);
  return c >= 0 && r >= 0 && c < C.w && r < C.h ? C.R[r * C.w + c] : 0;
}
// the steepest the ground may stand there (rise per run)
export function maxSlopeAt(x, z) {
  const c = coverClass(x, z);
  return c === 5 ? SLOPE.rock : c === 3 ? SLOPE.wood : SLOPE.lawn;
}

// ---- soups
const nonVert = (a, i) => Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) >= 1e-6;
const IDX = new WeakMap();
// every y of a soup's non-vertical triangles at local (x, z) (2 m buckets)
export function ysAt(a, x, z) {
  if (!a || a.length < 9) return [];
  let B = IDX.get(a);
  if (!B) {
    B = new Map();
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (!nonVert(a, i)) continue;
      const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 2), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 2);
      const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 2), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 2);
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(i); }
    }
    IDX.set(a, B);
  }
  const l = B.get(Math.floor(z / 2) * 4096 + Math.floor(x / 2)), out = [];
  if (!l) return out;
  for (const i of l) {
    const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
    if (w0 >= -1e-6 && w1 >= -1e-6 && w2 >= -1e-6) out.push(w0 * a[i + 1] + w1 * a[i + 4] + w2 * a[i + 7]);
  }
  return out;
}
const covKey = (b, j) => `${Math.round(((b[j] + b[j + 3] + b[j + 6]) / 3) * 100)},${Math.round(((b[j + 2] + b[j + 5] + b[j + 8]) / 3) * 100)}`;

// ---- the ground-facing paving edges of a tile: [{ ax, az, ay, bx, bz, by, nx, nz, sep }] in local coordinates,
// (nx, nz) pointing out of the paving; edges inside the paved union (two kinds meeting, T-junctions) are left out
export function pavingEdges(tile, kinds = null) {
  const S = tile.S, cov = tile.p1Covered || null, out = [];
  const pav = [];
  for (const n of kinds || edgeKinds()) if (S[n] && S[n].length >= 9) pav.push([n, S[n]]);
  // (the FDR structures' deck tops, laid after the clamp by city/hhp.js hhpAfterClamp: the ground meets their edges too)
  const bt = tile.__boxTop;
  const BOX = new Set();
  if (bt) for (const [n, arr] of Object.entries(bt)) if (arr && arr.length >= 9 && n !== 'grass' && n !== 'grassU') { const f = Float32Array.from(arr); BOX.add(f); pav.push([n, f]); }
  const E = new Map(), key = (x, z) => `${Math.round(x * 200)},${Math.round(z * 200)}`;
  for (const [n, b] of pav) for (let j = 0; j + 8 < b.length; j += 9) {
    if (!nonVert(b, j)) continue;
    if (cov && cov.has(covKey(b, j))) continue;
    for (let k = 0; k < 3; k++) {
      const p = j + 3 * k, q = j + 3 * ((k + 1) % 3), r = j + 3 * ((k + 2) % 3);
      const ka = key(b[p], b[p + 2]), kb = key(b[q], b[q + 2]), ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      const e = E.get(ek);
      if (e) { e.n++; continue; }
      E.set(ek, { n: 1, n0: n, b, p, q, r, box: BOX.has(b) });
    }
  }
  const paved = (x, z, y) => { for (const [, b] of pav) for (const v of ysAt(b, x, z)) if (Math.abs(v - y) < 0.6) return true; return false; };
  const ground = (x, z) => GROUND_SOUPS.some((n) => ysAt(S[n], x, z).length > 0);
  for (const e of E.values()) {
    if (e.n !== 1) continue;
    const { b, p, q, r } = e;
    const ax = b[p], az = b[p + 2], bx = b[q], bz = b[q + 2], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    let nx = -(bz - az) / L, nz = (bx - ax) / L;
    if ((b[r] - ax) * nx + (b[r + 2] - az) * nz > 0) { nx = -nx; nz = -nz; }
    const mx = (ax + bx) / 2 + nx * 0.3, mz = (az + bz) / 2 + nz * 0.3, my = (b[p + 1] + b[q + 1]) / 2;
    if (paved(mx, mz, my)) continue;
    if (!ground(mx, mz)) continue;
    out.push({ ax, az, ay: b[p + 1], bx, bz, by: b[q + 1], nx, nz, sep: CUT_SEP[e.n0] ?? 0.135, box: e.box });
  }
  return out;
}

// ---- the stations: every metre along the edges, with the band and walls their slopes need.
// Float32 records of ST_W: x, z (world), y (the paving's grade-equivalent level: its top less its separation), nx, nz,
// s (slope), band (m), hc (cut wall: its top over y), hf (fill wall: its foot under y), dir (1 cut, -1 fill), the paving
// top's separation over y, and the edge piece the station stands for (world x0, z0, x1, z1: a wall's panel)
export const ST_W = 15;
export function gradeStations(tile, st = {}, pre = null) {
  const [ox, oz] = tile.header.origin, tx = Math.floor(ox / TILE), tz = Math.floor(oz / TILE);
  const S = tile.S, edges = pavingEdges(tile).concat(wallTopEdges(tile, pre || tile.S)), out = [];
  // the natural ground: the ground as laid before the clamp (the authority's relief over the compile), in grade terms
  // (each soup less its offset; the highest), inside the tile only (a band ends at the tile's border)
  const P = pre || S;
  const gradeAt = (x, z) => {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lz < 0 || lx >= TILE || lz >= TILE) return null;
    let y = null;
    for (const n of GROUND_SOUPS) for (const v of ysAt(P[n], lx, lz)) { const g = v - OFF[n]; if (y === null || g > y) y = g; }
    if (y === null) return null;
    const q = haInfo(x, z);
    return { y, tag: q ? q.tag : 0 };
  };
  // obstacles along a normal: other paving (any level) and the drawn walls
  const pav = HA_PAVED.map((n) => S[n]).filter((a) => a && a.length >= 9);
  const pavedAt = (x, z) => { for (const b of pav) if (ysAt(b, x, z).length) return true; return false; };
  const WH = new Map();
  for (const n of ['terrWall', 'terrRock', 'rwall']) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (nonVert(a, i)) continue;
      // (the face's whole length, every 0.25 m along its edges, and a quarter metre round: a band never crosses a wall)
      for (let k = 0; k < 3; k++) {
        const p = i + 3 * k, q = i + 3 * ((k + 1) % 3), L = Math.hypot(a[q] - a[p], a[q + 2] - a[p + 2]), m = Math.max(1, Math.ceil(L / 0.25));
        for (let u = 0; u <= m; u++) {
          const x = a[p] + ((a[q] - a[p]) * u) / m, z = a[p + 2] + ((a[q + 2] - a[p + 2]) * u) / m;
          for (const [dx, dz] of [[0, 0], [0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]]) WH.set(`${Math.floor(x + dx)},${Math.floor(z + dz)}`, true);
        }
      }
    }
  }
  const wallAt = (x, z) => WH.has(`${Math.floor(x)},${Math.floor(z)}`);
  const over = [...pav];
  if (tile.__boxTop) for (const [n, arr] of Object.entries(tile.__boxTop)) if (arr && arr.length >= 9) over.push(Float32Array.from(arr));
  const coveredAt = (x, z, y) => { for (const b of over) for (const v of ysAt(b, x, z)) if (v >= y && v < y + 30) return true; return false; };
  st.edges = edges.length; st.wallTopEdges = edges.filter((e) => e.wallTop).length; st.boxQ = boxQuads ? 1 : 0; st.inactive = 0; st.deck = 0; st.deep = 0; st.walls = 0; st.graded = 0;
  for (const e of edges) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), m = Math.max(1, Math.round(L));
    for (let s = 0; s < m; s++) {
      const u0 = s / m, u1 = (s + 1) / m;
      const u = (s + 0.5) / m, lx = e.ax + (e.bx - e.ax) * u, lz = e.az + (e.bz - e.az) * u;
      const x = lx + ox, z = lz + oz;
      if (haInCentralPark(x, z)) continue;
      const yp = e.ay + (e.by - e.ay) * u - e.sep;
      // (an edge under another surface 2 m and more over it, a stacked drive under its deck or a road under a viaduct,
      // is not the ground's edge: the structure's walls hold the ground there)
      // (at an FDR structure only its deck's level is the ground's edge: a drive or walk well under the deck's top there
      // is the structure's inside, held by its walls)
      if (!e.box) {
        const bq = boxAt(x - e.nx * 0.3, z - e.nz * 0.3) || boxAt(x + e.nx * 1.5, z + e.nz * 1.5);
        let top = null;
        if (bq && boxTopIn) { try { top = boxTopIn(bq.s, bq.i, x, z); } catch { top = null; } }
        if (bq && !(Number.isFinite(top) && yp + e.sep > top - 1.0)) { st.covered = (st.covered || 0) + 1; continue; }
        if (bq) e.box = true;   // (the deck's own edge: the street-side ground comes up to it)
      }
      if ([0.3, 1.5, 3.0].some((w) => coveredAt(lx - e.nx * w, lz - e.nz * w, yp + e.sep + 2.0))) { st.covered = (st.covered || 0) + 1; continue; }
      let g0 = gradeAt(x + e.nx * 0.5, z + e.nz * 0.5);
      // (a wall's top: its retained ground may begin a little behind it, past the structure's cut)
      if (!g0 && e.wallTop) for (const t of [1.0, 1.5, 2.0, 3.0]) { g0 = gradeAt(x + e.nx * t, z + e.nz * t); if (g0) break; }
      if (!g0 || g0.tag === 1) { if (globalThis.__GRADE_DBG) globalThis.__GRADE_DBG.push(x, z, (g0 ? 4 : 3) + (e.box ? 10 : 0), 0); continue; }
      const step = g0.y - yp;
      const DBG = globalThis.__GRADE_DBG;
      if (DBG) DBG.push(x, z, (Math.abs(step) < STEP_MIN ? 0 : -step > DECK ? 2 : 1) + (e.box ? 10 : 0), step);
      // (a road meeting its ground at grade, step under STEP_MIN, beside a natural bank steeper than its surface allows
      // within the next 4 m: the bank is retained or graded too, the whole rise within GRADE_R taken)
      let natBank = 0;
      if (Math.abs(step) < STEP_MIN) {
        if (GRADE_NATBANK && e.sep === 0 && !e.wallTop) {
          const sl0 = maxSlopeAt(x + e.nx * 2, z + e.nz * 2), q4 = gradeAt(x + e.nx * 4, z + e.nz * 4);
          if (q4 && Math.abs(q4.y - g0.y) > sl0 * 3.5 * 1.15) natBank = q4.y > g0.y ? 1 : -1;
        }
        if (!natBank) { st.inactive++; continue; }
        st.natBank = (st.natBank || 0) + 1;
      }
      // (paving standing over the ground by more than DECK where the authority's grade lies as low: a structure)
      // (an FDR structure's deck top at its inner wall: the street-side ground comes up to its coping, whatever the height)
      if (-step > DECK && !e.box) { const q = haInfo(x + e.nx * 0.5, z + e.nz * 0.5); if (!q || Math.abs(HA_ASPHALT + q.relief - yp) > 1.0) { st.deck++; continue; } }
      const sl = maxSlopeAt(x + e.nx * 2, z + e.nz * 2);
      // the band available: up to an obstacle along the normal
      let wav = GRADE_R;
      for (let t = 0.5; t <= GRADE_R; t += 0.5) {
        const px = x + e.nx * t, pz = z + e.nz * t, q = gradeAt(px, pz);
        if (!q || q.tag === 1 || wallAt(px - ox, pz - oz) || (t > 1.0 && pavedAt(px - ox, pz - oz))) { wav = t - 0.5; break; }
      }
      // cut (step > 0): the cone y + h + s t must reach the natural ground within the band: the lowest h that does
      let hc = 0, hf = 0, band = 0;
      const dir = natBank || (step > 0 ? 1 : -1);
      let best = Infinity, bt = 0;
      if (natBank) {
        // (the wall the bank needs: its highest excess over the cone across the band; the band ends where it peaks)
        let mx = 0, mt = 0.5;
        for (let t = 0.5; t <= Math.max(0.5, wav); t += 0.5) { const q = gradeAt(x + e.nx * t, z + e.nz * t); if (!q) break; const c = dir * (q.y - yp) - sl * t; if (c > mx) { mx = c; mt = t; } }
        best = mx < WALL_MIN ? 0 : mx; bt = mt;
      } else
      for (let t = 0.5; t <= Math.max(0.5, wav); t += 0.5) {
        const q = gradeAt(x + e.nx * t, z + e.nz * t);
        if (!q) { if (e.wallTop && t < 3.01) continue; break; }
        const c = dir * (q.y - yp) - sl * t;   // (how far the natural ground stands past the cone)
        if (c <= 0) { best = 0; bt = t; break; }
        if (c < best) { best = c; bt = t; }
      }
      if (!Number.isFinite(best)) { st.noGround = (st.noGround || 0) + 1; continue; }
      band = bt;
      if (best > 0) {
        if (best < WALL_MIN) best = 0;   // (the short band takes it: the ground a little steeper than the limit)
        if (best > (dir > 0 ? CUT_MAX : e.box ? 12 : FILL_MAX)) { st.deep++; continue; }
        if (dir > 0) hc = best; else hf = best;
      }
      if (hc || hf) st.walls++; else st.graded++;
      out.push(x, z, yp, e.nx, e.nz, sl, band, hc, hf, dir, e.sep, e.ax + (e.bx - e.ax) * u0 + ox, e.az + (e.bz - e.az) * u0 + oz, e.ax + (e.bx - e.ax) * u1 + ox, e.az + (e.bz - e.az) * u1 + oz);
    }
  }
  return Float32Array.from(out);
}

// ---- the graded ground. The stations' cones (cut: y + hc + s d; fill: y - hf - s d) within each station's band move
// every ground vertex of the tile: cut lowers a vertex standing over the lowest cone to it, fill raises one under the
// highest to it, each soup at its own offset over the grade (the base under the lawns, no fight). Vertices the clamp
// lowered under the cut cone come back up to it (the clamp's trench beside the edge), never over the paving (the
// clamp runs again after). Returns the walls' runs for the wall builder.
export function gradeApply(tile, ST, st = {}, pre = null) {
  const [ox, oz] = tile.header.origin, S = tile.S;
  if (!ST || ST.length < ST_W) return null;
  const n = ST.length / ST_W, C = 4, H = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * ST_W, r = ST[o + 6] + 0.5, x = ST[o] - ox, z = ST[o + 1] - oz;
    for (let j = Math.floor((z - r) / C); j <= Math.floor((z + r) / C); j++) for (let k = Math.floor((x - r) / C); k <= Math.floor((x + r) / C); k++) { const q = j * 4096 + k; let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(o); }
  }
  // the envelopes at local (x, z): [cut upper bound, fill lower bound] in grade terms (null: no station's band)
  const env = (x, z) => {
    const l = H.get(Math.floor(z / C) * 4096 + Math.floor(x / C));
    if (!l) return null;
    let U = Infinity, Lo = -Infinity, dmin = Infinity;
    for (const o of l) {
      const dx = x - (ST[o] - ox), dz = z - (ST[o + 1] - oz), d = Math.hypot(dx, dz), b = ST[o + 6];
      if (d > b + 0.5) continue;
      // (only ahead of the edge: behind it lies the paving's own ground)
      if (dx * ST[o + 3] + dz * ST[o + 4] < -0.25) continue;
      const y = ST[o + 2], s = ST[o + 5];
      if (d < dmin) dmin = d;
      if (ST[o + 9] < 0) Lo = Math.max(Lo, y - ST[o + 8] - s * d);
      else U = Math.min(U, y + ST[o + 7] + s * d);
    }
    return U === Infinity && Lo === -Infinity ? null : [U, Lo, dmin];
  };
  let moved = 0, maxCut = 0, maxFill = 0;
  const memo = new Map();
  // (the swept shore walls' land is the shore's: no fill raises ground within 4 m behind a cap station)
  const SH = new Map(), SP = tile.p1Shore;
  if (SP && SP.stn) for (let k = 0; k + 5 < SP.stn.length; k += 6) { const x = SP.stn[k] - ox, z = SP.stn[k + 1] - oz, q = Math.floor(z / 4) * 4096 + Math.floor(x / 4); let l = SH.get(q); if (!l) SH.set(q, (l = [])); l.push(x, z); }
  const nearShore = (x, z) => { if (!SH.size) return false; const i = Math.floor(x / 4), j = Math.floor(z / 4); for (let b = -1; b <= 1; b++) for (let a2 = -1; a2 <= 1; a2++) { const l = SH.get((j + b) * 4096 + i + a2); if (l) for (let k = 0; k < l.length; k += 2) if ((l[k] - x) ** 2 + (l[k + 1] - z) ** 2 < 16) return true; } return false; };
  // the band's triangles refined first (edges over 1.2 m whose middle lies in a band are halved, 3 rounds: a coarse TIN
  // triangle from the edge into the natural ground cannot hold the cone at its corners alone); a halved edge is halved in
  // every triangle that has it, here and in the neighbour tile alike (the same edge, the same stations): no cracks
  const inBand = (x, z) => { const k = `${Math.round(x * 1000)},${Math.round(z * 1000)}`; let E = memo.get(k); if (E === undefined) { E = env(x, z); memo.set(k, E); } return !!E; };
  const ekey = (ax, az, bx, bz) => { const p = `${Math.round(ax * 1000)},${Math.round(az * 1000)}`, q = `${Math.round(bx * 1000)},${Math.round(bz * 1000)}`; return p < q ? p + '|' + q : q + '|' + p; };
  let refined = 0;
  for (const name of GROUND_SOUPS) {
    let a = S[name], b = pre && pre[name] && pre[name].length === (a ? a.length : -1) ? pre[name] : null;
    if (!a || a.length < 9) continue;
    for (let round = 0; round < 3; round++) {
      const mark = new Set();
      for (let i = 0; i + 8 < a.length; i += 9) for (let k = 0; k < 3; k++) {
        const p = i + 3 * k, q = i + 3 * ((k + 1) % 3);
        const L = Math.hypot(a[q] - a[p], a[q + 2] - a[p + 2]);
        if (L > 1.2 && inBand((a[p] + a[q]) / 2, (a[p + 2] + a[q + 2]) / 2)) mark.add(ekey(a[p], a[p + 2], a[q], a[q + 2]));
      }
      if (!mark.size) break;
      const out = [], outB = [];
      // a triangle as 3 corners [x, y, z, yPre], split along its marked edges one at a time
      const emit = (T) => {
        for (let k = 0; k < 3; k++) {
          const P = T[k], Q = T[(k + 1) % 3], R = T[(k + 2) % 3];
          if (!mark.has(ekey(P[0], P[2], Q[0], Q[2]))) continue;
          const M = [(P[0] + Q[0]) / 2, (P[1] + Q[1]) / 2, (P[2] + Q[2]) / 2, (P[3] + Q[3]) / 2];
          // (the halves keep the winding; their halves of the split edge are not marked, the other edges keep their marks)
          const sub = (A, B, C) => { const s0 = mark.has(ekey(A[0], A[2], B[0], B[2])); emit([A, B, C]); return s0; };
          sub(P, M, R); sub(M, Q, R);
          return;
        }
        for (const C of T) { out.push(C[0], C[1], C[2]); outB.push(C[3]); }
      };
      for (let i = 0; i + 8 < a.length; i += 9) {
        const T = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 1], a[i + 3 * k + 2], b ? b[i + 3 * k + 1] : a[i + 3 * k + 1]]);
        emit(T);
      }
      refined += out.length / 9 - a.length / 9;
      a = Float32Array.from(out);
      const nb = new Float32Array(a.length);
      for (let v = 0; v < outB.length; v++) { nb[3 * v] = a[3 * v]; nb[3 * v + 1] = outB[v]; nb[3 * v + 2] = a[3 * v + 2]; }
      b = nb;
    }
    S[name] = a;
    if (pre) pre[name] = b || a.slice();
  }
  st.refined = refined;
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name];
    for (let i = 0; i + 2 < a.length; i += 3) {
      const x = a[i], z = a[i + 2], kk = `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
      let E = memo.get(kk);
      if (E === undefined) { E = env(x, z); memo.set(kk, E); }
      if (!E) continue;
      const q = haInfo(x + ox, z + oz);
      if (q && q.tag === 1) continue;
      const nat = pre && pre[name] && pre[name].length === a.length ? pre[name][i + 1] : a[i + 1];   // (this vertex as laid before the clamp)
      let y = a[i + 1];
      // the clamp's trench: a vertex lowered under the cut cone (and under its natural ground) comes back to the cone
      const U = E[0] + off, Lo = E[1] + off;
      if (U < Infinity && y < Math.min(U, nat) - 0.02) y = Math.min(U, nat);
      // (a vertex a cone would move by more than the walls' limits lies off its station's profile, under a structure or in
      // a pit beside it: left as laid)
      if (y > U && y - U <= CUT_MAX + 1) { maxCut = Math.max(maxCut, y - U); y = U; }
      if (Lo > -Infinity && y < Lo && Lo - y <= 13) { maxFill = Math.max(maxFill, Lo - y); y = Lo; }
      if (y > a[i + 1] && nearShore(x, z)) y = a[i + 1];
      if (y !== a[i + 1]) { a[i + 1] = y; moved++; }
    }
  }
  st.moved = moved; st.maxCut = +maxCut.toFixed(2); st.maxFill = +maxFill.toFixed(2);
  return true;
}

// ---- THE GATE: every ground triangle (base, lawns) within GRADE_R of a ground-facing paving edge standing steeper than
// its surface's limit (by 2 %) and rising 0.3 m or more, not under paving, a footprint or Central Park (its own parts), not backed by a grading
// wall. 'artifact': a corner moved off the natural surface by more than 10 cm (the clamp's cliffs, the grading's own
// faces); 'natural': the authority's surface as surveyed (a natural bank by a path).
export function gradeGate(tile, top = 12) {
  const [ox, oz] = tile.header.origin, S = tile.S, edges = pavingEdges(tile), C = 4, H = new Map();
  for (const e of edges) {
    const L = Math.hypot(e.bx - e.ax, e.bz - e.az), m = Math.max(1, Math.round(L));
    for (let s = 0; s <= m; s++) { const x = e.ax + ((e.bx - e.ax) * s) / m, z = e.az + ((e.bz - e.az) * s) / m, q = Math.floor(z / C) * 4096 + Math.floor(x / C); let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(x, z); }
  }
  const near = (x, z) => { const i = Math.floor(x / C), j = Math.floor(z / C), R = Math.ceil(GRADE_R / C); let best = Infinity; for (let b = -R; b <= R; b++) for (let a = -R; a <= R; a++) { const l = H.get((j + b) * 4096 + i + a); if (l) for (let k = 0; k < l.length; k += 2) { const d = (l[k] - x) ** 2 + (l[k + 1] - z) ** 2; if (d < best) best = d; } } return Math.sqrt(best); };
  const pav = HA_PAVED.map((n) => S[n]).filter((a) => a && a.length >= 9);
  const RB = (x, z) => { for (let k = 0; k < 8; k++) if (ysAt(S.rbal, x + Math.cos(k * 0.785) * 8, z + Math.sin(k * 0.785) * 8).length) return true; return false; };
  // (the grading walls' panels, by 4 m cell: a steep triangle within 1.2 m behind one is the wall's own ground)
  const WS = tile.p1GradeWalls || [], WH = new Map();
  for (let k = 0; k < WS.length; k += 6) { const q = Math.floor((WS[k + 3] + WS[k + 1]) / 2 / C) * 4096 + Math.floor((WS[k + 2] + WS[k]) / 2 / C); let l = WH.get(q); if (!l) WH.set(q, (l = [])); l.push(k); }
  const walled = (x, z) => { const i = Math.floor(x / C), j = Math.floor(z / C); for (let b = -1; b <= 1; b++) for (let a2 = -1; a2 <= 1; a2++) for (const k of WH.get((j + b) * 4096 + i + a2) || []) { const ax = WS[k], az = WS[k + 1], bx = WS[k + 2], bz = WS[k + 3], L2 = (bx - ax) ** 2 + (bz - az) ** 2; const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2)); const px = ax + (bx - ax) * t, pz = az + (bz - az) * t; const o = (x - px) * WS[k + 4] + (z - pz) * WS[k + 5]; if (o > -0.3 && o < 1.2 && Math.hypot(x - px, z - pz) < 1.2) return true; } return false; };
  const ZONE = typeof globalThis !== 'undefined' ? globalThis.__GRADE_ZONE : null;
  const r = { cause: { cp: 0, shore: 0, corridor: 0, structure: 0, natural: 0, edit: 0 }, causeArea: { cp: 0, shore: 0, corridor: 0, structure: 0, natural: 0, edit: 0 }, zone: 0, all: isNode && process.env.GRADE_ALL ? [] : null, tris: 0, steep: 0, area: 0, artifact: 0, artifactArea: 0, natural: 0, edge3: 0, walled: 0, at: [] };
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, A2 = Math.hypot(nx, ny, nz);
      if (A2 < 0.02) continue;
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
      const slope = Math.hypot(nx, nz) / Math.max(1e-9, Math.abs(ny));
      if (slope <= SLOPE.lawn * 1.02) continue;
      // (a face under 0.3 m high is a lip at a kerb or a bed's edge, not a bank)
      if (Math.max(a[i + 1], a[i + 4], a[i + 7]) - Math.min(a[i + 1], a[i + 4], a[i + 7]) < 0.3) continue;
      const d = near(cx, cz);
      if (d > GRADE_R) continue;
      const wx = cx + ox, wz = cz + oz;
      if (slope <= maxSlopeAt(wx, wz) * 1.02) continue;
      if (haInCentralPark(wx, wz)) { r.cause.cp++; r.causeArea.cp += A2 / 2; continue; }
      const q = haInfo(wx, wz);
      if (!q || q.tag === 1 || q.tag === 3) continue;
      let under = false;
      for (const b of pav) { for (const y of ysAt(b, cx, cz)) if (y >= cy - 0.05) { under = true; break; } if (under) break; }
      if (under) continue;
      // (the base under a lawn is not seen)
      if (name === 'terrP1') { let lawn = false; for (const n of ['grass', 'grassU']) for (const y of ysAt(S[n], cx, cz)) if (y >= cy - 0.02) lawn = true; if (lawn) continue; }
      if (WS.length && walled(cx, cz)) { r.walled++; continue; }
      if (ZONE && ZONE(wx, wz)) { r.zone++; continue; }
      r.steep++; r.area += A2 / 2;
      // (the authority's own surface over the triangle: steep there too is a natural bank)
      const T = [0, 1, 2].map((k) => { const qq = haInfo(a[i + 3 * k] + ox, a[i + 3 * k + 2] + oz); return qq ? HA_ASPHALT + qq.relief : null; });
      let natural = false, dev = 0;
      if (T.every((v) => v !== null)) {
        const ty1 = T[1] - T[0], ty2 = T[2] - T[0], mx = uz * ty2 - ty1 * vz, my = uz * vx - ux * vz, mz = ty1 * vx - ux * ty2;
        natural = Math.hypot(mx, mz) / Math.max(1e-9, Math.abs(my)) > maxSlopeAt(wx, wz) * 1.02;
        for (let k = 0; k < 3; k++) dev = Math.max(dev, Math.abs(a[i + 3 * k + 1] - T[k] - off));
      }
      // (the cause: a bank to the river, a highway's or rail corridor's sides, the TIN's own bank, or an edit)
      let cause = natural ? 'natural' : 'edit';
      if (!natural) {
        let sh = false;
        for (let k = 0; k < 8 && !sh; k++) { const qq = haInfo(wx + Math.cos(k * 0.785) * 8, wz + Math.sin(k * 0.785) * 8); if (qq && qq.tag === 3) sh = true; }
        if (sh) cause = 'shore';
        // (ground displaced 4 m and more off the authority: round a held deck, a ramp or a bridge's approach)
        else if (dev > 4.0) cause = 'structure';
        else if ((hhpHitsF && (() => { try { return hhpHitsF(wx, wz, 20).length > 0; } catch { return false; } })()) || RB(cx, cz)) cause = 'corridor';
      }
      r.cause[cause]++; r.causeArea[cause] += A2 / 2;
      if (r.all) r.all.push(+wx.toFixed(1), +wz.toFixed(1), +(Math.atan(slope) * 57.3).toFixed(0), +d.toFixed(1), ['cp', 'shore', 'corridor', 'natural', 'edit', 'structure'].indexOf(cause), +(A2 / 2).toFixed(2));
      if (!natural) { r.artifact++; r.artifactArea += A2 / 2; if (d < 3) r.edge3++; if (r.at.length < 400) r.at.push([+(A2 / 2 * Math.min(dev, 10)).toFixed(2), +wx.toFixed(1), +wz.toFixed(1), +(Math.atan(slope) * 57.3).toFixed(0), +dev.toFixed(2), name]); }
      else r.natural++;
    }
  }
  r.at.sort((u, w) => w[0] - u[0]); r.at.length = Math.min(r.at.length, top);
  r.area = +r.area.toFixed(1); r.artifactArea = +r.artifactArea.toFixed(1); for (const k in r.causeArea) r.causeArea[k] = +r.causeArea[k].toFixed(1);
  return r;
}

// ---- THE RETAINING WALLS: every station with a wall gives its edge piece a panel; a panel end's height is the mean of
// the stations meeting there (0 where an unwalled station meets it: the run ramps down to the paving at its ends), so a
// run is one continuous swept wall with a coping. Cut: the face at the edge towards the paving, from under the paving's
// top to 0.4 m over the cut's top (the cap 0.35 m deep over the ground behind). Fill: a 0.3 m wall standing outside the
// edge, its cap 0.1 m over the paving, its outer face down to the fill's foot. Only the tile's own stations build walls.
const KEY = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
export function gradeWalls(tile, ST, st = {}) {
  const [ox, oz] = tile.header.origin, S = tile.S;
  const own = (o) => ST[o] >= ox && ST[o] < ox + TILE && ST[o + 1] >= oz && ST[o + 1] < oz + TILE;
  const n = ST.length / ST_W, END = new Map();
  for (let i = 0; i < n; i++) {
    const o = i * ST_W;
    for (const [x, z] of [[ST[o + 11], ST[o + 12]], [ST[o + 13], ST[o + 14]]]) {
      const k = KEY(x, z); let e = END.get(k); if (!e) END.set(k, (e = { c: 0, f: 0, n: 0 }));
      e.c += ST[o + 7]; e.f += ST[o + 8]; e.n++;
    }
  }
  const hAt = (x, z, j) => { const e = END.get(KEY(x, z)); return e ? (j ? e.f : e.c) / e.n : 0; };
  const P = [], UV = [], WE = [], MAT = [], walled = new Set();
  const P2C = !!S.terrWallUV;
  const quad = (a, b, c, d, ua, ub, uc, ud) => {
    P.push(...a, ...b, ...c, ...a, ...c, ...d);
    if (P2C) { UV.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud); for (let k = 0; k < 6; k++) WE.push(0.37, a[1] - 1, a[1] + 4); MAT.push(1, 1); }
  };
  let panels = 0, len = 0, hmax = 0;
  const segs = [];
  for (let i = 0; i < n; i++) {
    const o = i * ST_W;
    if (!(ST[o + 7] > 0 || ST[o + 8] > 0) || !own(o)) continue;
    const y = ST[o + 2], sep = ST[o + 10], nx = ST[o + 3], nz = ST[o + 4];
    const x0 = ST[o + 11] - ox, z0 = ST[o + 12] - oz, x1 = ST[o + 13] - ox, z1 = ST[o + 14] - oz;
    const L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 0.02) continue;
    const s0 = Math.hypot(ST[o + 11], ST[o + 12]) % 64, s1 = s0 + L;   // (a world-anchored run coordinate for the texture)
    // the face's winding: towards (fx, fz)
    const face = (A, B, C, D, fx, fz, U4) => {
      const ux = B[0] - A[0], uz = B[2] - A[2], vy = D[1] - A[1];
      const nX = -uz * vy, nZ = ux * vy;   // (the normal of A,B,C,D for a vertical quad, up to sign)
      if (nX * fx + nZ * fz >= 0) quad(A, B, C, D, ...U4); else quad(A, D, C, B, U4[0], U4[3], U4[2], U4[1]);
    };
    if (ST[o + 7] > 0) {
      const h0 = hAt(ST[o + 11], ST[o + 12], 0), h1 = hAt(ST[o + 13], ST[o + 14], 0);
      const b0 = y + sep - 0.25, t0 = y + h0 + 0.4, t1 = y + h1 + 0.4, W = 0.35;
      const A = [x0, b0, z0], B = [x1, b0, z1], C = [x1, t1, z1], D = [x0, t0, z0];
      face(A, B, C, D, -nx, -nz, [[s0, b0], [s1, b0], [s1, t1], [s0, t0]]);
      const C2 = [x1 + nx * W, t1, z1 + nz * W], D2 = [x0 + nx * W, t0, z0 + nz * W];
      quad(D, C, C2, D2, [s0, 0], [s1, 0], [s1, W], [s0, W]);   // (the cap; its winding checked below)
      const C3 = [x1 + nx * W, t1 - 0.5, z1 + nz * W], D3 = [x0 + nx * W, t0 - 0.5, z0 + nz * W];
      face(D3, C3, C2, D2, nx, nz, [[s0, t0 - 0.5], [s1, t1 - 0.5], [s1, t1], [s0, t0]]);
      hmax = Math.max(hmax, ST[o + 7]);
    } else {
      const f0 = hAt(ST[o + 11], ST[o + 12], 1), f1 = hAt(ST[o + 13], ST[o + 14], 1), W = 0.3;
      const tt = y + sep + 0.1, bi = y + sep - 0.25;
      const ft0 = y - f0 + OFF.terrP1 - 0.3, ft1 = y - f1 + OFF.terrP1 - 0.3;
      const A = [x0, bi, z0], B = [x1, bi, z1], C = [x1, tt, z1], D = [x0, tt, z0];
      face(A, B, C, D, -nx, -nz, [[s0, bi], [s1, bi], [s1, tt], [s0, tt]]);
      const A2 = [x0 + nx * W, ft0, z0 + nz * W], B2 = [x1 + nx * W, ft1, z1 + nz * W], C2 = [x1 + nx * W, tt, z1 + nz * W], D2 = [x0 + nx * W, tt, z0 + nz * W];
      face(A2, B2, C2, D2, nx, nz, [[s0, ft0], [s1, ft1], [s1, tt], [s0, tt]]);
      quad(D, C, C2, D2, [s0, 0], [s1, 0], [s1, W], [s0, W]);
      hmax = Math.max(hmax, ST[o + 8]);
    }
    panels++; len += L; segs.push(x0, z0, x1, z1, nx, nz);
  }
  // caps face up: fix any downward cap triangle's winding (the quads above whose normal points down)
  for (let i = 0; i + 8 < P.length; i += 9) {
    const ux = P[i + 3] - P[i], uz = P[i + 5] - P[i + 2], vx = P[i + 6] - P[i], vz = P[i + 8] - P[i + 2];
    const ny = uz * vx - ux * vz;
    if (Math.abs(P[i + 1] - P[i + 4]) < 0.6 && Math.abs(P[i + 1] - P[i + 7]) < 0.6 && ny < 0 && Math.abs(ny) > 1e-4) {
      for (let k = 0; k < 3; k++) { const t = P[i + 3 + k]; P[i + 3 + k] = P[i + 6 + k]; P[i + 6 + k] = t; }
      if (P2C) { const v = i / 3; for (let k = 0; k < 2; k++) { const t = UV[(v + 1) * 2 + k]; UV[(v + 1) * 2 + k] = UV[(v + 2) * 2 + k]; UV[(v + 2) * 2 + k] = t; } }
    }
  }
  if (P.length) {
    const cat = (a, b, T) => { const m = new T((a ? a.length : 0) + b.length); if (a) m.set(a); m.set(b, a ? a.length : 0); return m; };
    if (tile.__mappedWallLen === undefined) tile.__mappedWallLen = S.terrWall ? S.terrWall.length : 0;   // (the gate judges the mapped walls)
    S.terrWall = cat(S.terrWall, P, Float32Array);
    if (P2C) { S.terrWallUV = cat(S.terrWallUV, UV, Float32Array); S.terrWallWe = cat(S.terrWallWe, WE, Float32Array); if (S.terrWallMat) S.terrWallMat = cat(S.terrWallMat, MAT, Uint8Array); }
  }
  tile.p1GradeWalls = segs;
  st.wallPanels = panels; st.wallLen = Math.round(len); st.wallMax = +hmax.toFixed(2);
  return panels;
}

// ---- the stations of a tile: the product's (its own and its neighbours' near it) or, without it, its own found here
const PROD = new Map();
function prodDir() {
  if (isNode) return (process.env.TERRAIN_GRADE_DIR || (process.env.TERRAIN_P1_DIR || decodeURIComponent(new URL('../../public/data/terrain_p1/', import.meta.url).pathname)).replace(/terrain_p1\/?$/, '') + 'terrain_grade/').replace(/\/?$/, '/');
  return new URL('data/terrain_grade/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href;
}
let BOXP = null;
export async function gradeLoad(tx, tz) {
  // (the highways' lookup is the gate's only, in node: never awaited in the page, where the module graph is circular)
  if (isNode && !globalThis.__GRADE_HHP) globalThis.__GRADE_HHP = import('../city/hhp.js').then((m) => { hhpHitsF = m.hhpHits; }).catch(() => null);
  if (isNode) await globalThis.__GRADE_HHP;
  if (GRADE_OFF) return;
  if (!BOXP) BOXP = import('../city/fdrBox.js').then((m) => { boxAt = m.boxAt; boxTopIn = m.topIn; boxQuads = m.boxQuads; boxCorner = m.corner; }).catch(() => null);
  await BOXP;
  const k = `${tx}_${tz}`;
  if (!PROD.has(k)) PROD.set(k, readBytes(prodDir() + k + '.bin').then((b) => (b && b.length % (4 * ST_W) === 0 ? new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)) : null)).catch(() => null));
  PROD.set(k, await PROD.get(k));
  const ps = [];
  for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) ps.push(gradeCoverLoad(tx + a, tz + b));
  await Promise.all(ps);
}
const PRODUCT_ONLY = isNode && process.env.TERRAIN_GRADE === 'local';
// (tools/terrain/grade_gate.mjs --stations: each tile's own stations as found, for the product)
const DUMP = isNode && process.env.TERRAIN_GRADE === 'local' ? (globalThis.__GRADE_DUMP = globalThis.__GRADE_DUMP || new Map()) : null;
// the whole pass, for haClampGround: returns its stats (null when off)
export function gradeGround(tile, pre = null) {
  if (GRADE_OFF || !tile || !tile.S) return null;
  const [ox, oz] = tile.header.origin, k = `${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`;
  const st = {};
  let ST = PRODUCT_ONLY ? null : PROD.get(k);
  if (ST instanceof Promise) ST = null;
  st.src = ST ? 'product' : 'local';
  const T0 = Date.now(), prof = (st.prof = {});
  if (!ST) ST = gradeStations(tile, st, pre);
  prof.stations = Date.now() - T0;
  if (DUMP) DUMP.set(k, ST);
  st.stations = ST.length / ST_W;
  { const t = Date.now(); gradeApply(tile, ST, st, pre); prof.apply = Date.now() - t; }
  const T1 = Date.now();
  if (GRADE_WALLS) gradeMappedWalls(tile, st);   // (the mapped walls hold their ground over any band)
  prof.mapped = Date.now() - T1;
  { const t = Date.now(); gradeWalls(tile, ST, st); prof.walls = Date.now() - t; }
  tile.p1Grade = st;
  return st;
}

// ---- THE CONSTRAINED EDGES: every boundary where the ground meets paving, a kerb or coping top, a wall's cap or a rail
// bed is cut into the ground triangulation: each ground triangle loses exactly the part of it that lies under an at-grade
// cutter (a convex piece at a time, the cutter's three half-planes), so no ground triangle can straddle an edge; the
// vertices made on an edge take the edge's height (its top less its separation, plus the soup's offset over the grade).
// A cutter standing more than DECK_CUT over the ground under it is a deck: the ground runs on under it. Narrow strips
// between two facing edges (under 2 m) are then laid between the two edges' heights (no teeth, no scoop).
const CUT_SEP = { ...SEP, curb: 0.15, terrCap: 0.15 };
const DECK_CUT = 1.5, EPS = 1e-4;
function cutters(tile) {
  const S = tile.S, cov = tile.p1Covered || null, out = [];
  const DK = tile.__cutDeck || (tile.__cutDeck = new Map());
  const add = (n, b) => {
    if (!b || b.length < 9) return;
    for (let j = 0; j + 8 < b.length; j += 9) {
      if (!nonVert(b, j)) continue;
      if (cov && cov.has(covKey(b, j))) continue;
      // (counter-clockwise in x-z)
      const ar = (b[j + 3] - b[j]) * (b[j + 8] - b[j + 2]) - (b[j + 6] - b[j]) * (b[j + 5] - b[j + 2]);
      const P = [[b[j], b[j + 2], b[j + 1]], [b[j + 3], b[j + 5], b[j + 4]], [b[j + 6], b[j + 8], b[j + 7]]];
      if (ar < 0) P.reverse();
      const ck = covKey(b, j), mx = (b[j] + b[j + 3] + b[j + 6]) / 3, mz = (b[j + 2] + b[j + 5] + b[j + 8]) / 3, my = (b[j + 1] + b[j + 4] + b[j + 7]) / 3;
      // (a deck: standing more than DECK_CUT over the ground under its middle, as the ground was before the cut; kept on
      // the tile so the gate judges alike)
      let deck = DK.get(n + ck);
      // (and paving under a lawn laid over it by design, 0-0.35 m under the lawn's top, a median's or a bed's: the lawn is
      // the surface there, not cut)
      if (deck === undefined) {
        let g = null, top = null;
        for (const gn of GROUND_SOUPS) for (const v of ysAt(S[gn], mx, mz)) { const u = v - OFF[gn]; if (g === null || u > g) g = u; if (top === null || v > top) top = v; }
        deck = (g !== null && my - g > DECK_CUT) || (top !== null && top - my > 0.0 && top - my < 0.35 && ysAt(S.grass, mx, mz).concat(ysAt(S.grassU, mx, mz)).some((v) => v - my > 0.0 && v - my < 0.35));
        DK.set(n + ck, deck);
      }
      if (deck) continue;
      out.push({ P, sep: CUT_SEP[n] ?? 0.135, x0: Math.min(P[0][0], P[1][0], P[2][0]), x1: Math.max(P[0][0], P[1][0], P[2][0]), z0: Math.min(P[0][1], P[1][1], P[2][1]), z1: Math.max(P[0][1], P[1][1], P[2][1]), y: (P[0][2] + P[1][2] + P[2][2]) / 3 });
    }
  };
  for (const n of [...edgeKinds(), 'curb', 'terrCap']) add(n, S[n]);
  const bt = tile.__boxTop;
  if (bt) for (const [n, arr] of Object.entries(bt)) if (arr && arr.length >= 9 && n !== 'grass' && n !== 'grassU') add(n, Float32Array.from(arr));
  const H = new Map(), C = 4;
  out.forEach((c, i) => { for (let j = Math.floor(c.z0 / C); j <= Math.floor(c.z1 / C); j++) for (let k = Math.floor(c.x0 / C); k <= Math.floor(c.x1 / C); k++) { const q = j * 4096 + k; let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(i); } });
  return { list: out, H, C };
}
// a convex polygon of points [x, z, yGround, yEdge|null] clipped to one side of the cutter's edge p->q (keep: 1 inside / left, -1 outside)
function clipPoly(poly, p, q, sep, keep) {
  const out = [], f = (P) => keep * ((q[0] - p[0]) * (P[1] - p[1]) - (q[1] - p[1]) * (P[0] - p[0]));
  for (let k = 0; k < poly.length; k++) {
    const A = poly[k], B = poly[(k + 1) % poly.length], fa = f(A), fb = f(B);
    if (fa >= 0) out.push(A);
    if ((fa > 0 && fb < 0) || (fa < 0 && fb > 0)) {
      const t = fa / (fa - fb), x = A[0] + (B[0] - A[0]) * t, z = A[1] + (B[1] - A[1]) * t;
      const L2 = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2, u = L2 > 0 ? Math.max(0, Math.min(1, ((x - p[0]) * (q[0] - p[0]) + (z - p[1]) * (q[1] - p[1])) / L2)) : 0;
      out.push([x, z, A[2] + (B[2] - A[2]) * t, p[2] + (q[2] - p[2]) * u - sep]);
    }
  }
  return out;
}
const polyArea = (P) => { let a = 0; for (let k = 0; k < P.length; k++) { const A = P[k], B = P[(k + 1) % P.length]; a += A[0] * B[1] - B[0] * A[1]; } return a / 2; };
// the polygon less the cutter (pieces), or null when they do not overlap
function subtract(poly, c) {
  const P = c.P;
  // (wholly outside one of the cutter's edges, within EPS: untouched)
  for (let k = 0; k < 3; k++) {
    const p = P[k], q = P[(k + 1) % 3];
    if (poly.every((A) => (q[0] - p[0]) * (A[1] - p[1]) - (q[1] - p[1]) * (A[0] - p[0]) <= EPS * Math.hypot(q[0] - p[0], q[1] - p[1]))) return null;
  }
  const out = [];
  let rest = poly;
  for (let k = 0; k < 3 && rest.length >= 3; k++) {
    const p = P[k], q = P[(k + 1) % 3];
    const o = clipPoly(rest, p, q, c.sep, -1);
    if (o.length >= 3 && Math.abs(polyArea(o)) > 1e-5) out.push(o);
    rest = clipPoly(rest, p, q, c.sep, 1);
  }
  return out;
}
export function gradeCut(tile, st = {}) {
  if (GRADE_OFF || !tile || !tile.S) return null;
  const [ox, oz] = tile.header.origin, S = tile.S, K = cutters(tile), nearSh = shoreNear(tile);
  let cutTris = 0, made = 0, dropped = 0;
  const inCP = (x, z) => haInCentralPark(x + ox, z + oz);
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name], out = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const keep = () => { for (let k = 0; k < 9; k++) out.push(a[i + k]); };
      if (!nonVert(a, i)) { keep(); continue; }
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]), x1 = Math.max(a[i], a[i + 3], a[i + 6]), z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]), z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]);
      const seen = new Set(), cand = [];
      for (let j = Math.floor(z0 / K.C); j <= Math.floor(z1 / K.C); j++) for (let k = Math.floor(x0 / K.C); k <= Math.floor(x1 / K.C); k++) for (const ci of K.H.get(j * 4096 + k) || []) {
        if (seen.has(ci)) continue; seen.add(ci);
        const c = K.list[ci];
        if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
        cand.push(c);
      }
      if (!cand.length || inCP((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3)) { keep(); continue; }
      // the ground's plane (for the deck test at a cutter's middle)
      const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const yAt = (x, z) => { const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d; return w0 * a[i + 1] + w1 * a[i + 4] + (1 - w0 - w1) * a[i + 7]; };
      let pieces = [[0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 2], a[i + 3 * k + 1], null])];
      if (polyArea(pieces[0]) < 0) pieces[0].reverse();
      let hit = false;
      for (const c of cand) {
        const next = [];
        for (const pc of pieces) { const r = subtract(pc, c); if (r === null) next.push(pc); else { hit = true; next.push(...r); } }
        pieces = next;
        if (!pieces.length) break;
      }
      if (!hit) { keep(); continue; }
      cutTris++;
      const wind = (a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2]);   // (keep the soup's winding)
      for (const P of pieces) {
        if (Math.abs(polyArea(P)) < 1e-4) { dropped++; continue; }
        // (a cut vertex takes the edge's height where that lies within 1 m of the ground there; farther, the edge is a
        // structure's or a cliff's and the ground keeps its own height: the grading and the walls meet it, no spike)
        const Q = P.map((p) => [p[0], p[3] !== null && Math.abs(p[3] + off - p[2]) <= 1.0 && !nearSh(p[0], p[1], 6) ? p[3] + off : p[2], p[1]]);
        for (let k = 1; k + 1 < Q.length; k++) {
          const T = [Q[0], Q[k], Q[k + 1]], w = (T[1][0] - T[0][0]) * (T[2][2] - T[0][2]) - (T[2][0] - T[0][0]) * (T[1][2] - T[0][2]);
          if ((w > 0) !== (wind > 0)) T.reverse();
          for (const V of T) out.push(V[0], V[1], V[2]);
          made++;
        }
      }
    }
    S[name] = Float32Array.from(out);
  }
  st.cutTris = cutTris; st.cutMade = made; st.cutDropped = dropped;
  return st;
}
// the gate's second count: ground triangles (outside Central Park) still overlapping an at-grade cutter in plan by more
// than 0.01 m2 (a straddled edge)
export function gradeCrossings(tile) {
  const [ox, oz] = tile.header.origin, S = tile.S, K = cutters(tile);
  let n = 0;
  const at = [];
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name];
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (!nonVert(a, i)) continue;
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]), x1 = Math.max(a[i], a[i + 3], a[i + 6]), z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]), z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]);
      if (haInCentralPark((x0 + x1) / 2 + ox, (z0 + z1) / 2 + oz)) continue;
      const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8], d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const yAt = (x, z) => { const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d; return w0 * a[i + 1] + w1 * a[i + 4] + (1 - w0 - w1) * a[i + 7]; };
      let poly = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 2], 0, null]);
      if (polyArea(poly) < 0) poly.reverse();
      const A0 = Math.abs(polyArea(poly));
      const seen = new Set();
      let lost = 0;
      for (let j = Math.floor(z0 / K.C); j <= Math.floor(z1 / K.C) && lost <= 0.01; j++) for (let k = Math.floor(x0 / K.C); k <= Math.floor(x1 / K.C) && lost <= 0.01; k++) for (const ci of K.H.get(j * 4096 + k) || []) {
        if (seen.has(ci)) continue; seen.add(ci);
        const c = K.list[ci];
        if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
        const r = subtract(poly, c);
        if (r === null) continue;
        lost = A0 - r.reduce((s, P) => s + Math.abs(polyArea(P)), 0);
        if (lost > 0.01) break;
      }
      if (lost > 0.01) { n++; if (at.length < 8) at.push([+(ax + ox).toFixed(1), +(az + oz).toFixed(1), name, +lost.toFixed(2)]); }
    }
  }
  return { n, at };
}

// narrow ground strips: a ground vertex within 1.05 m of two facing edges (a path and a wall's coping, a walk and a kerb)
// lies on the line between their heights (each edge's top less its separation, plus the soup's offset)
export function gradeStrips(tile, st = {}) {
  if (GRADE_OFF || !tile || !tile.S) return null;
  const [ox, oz] = tile.header.origin, S = tile.S, E = pavingEdges(tile, [...edgeKinds(), 'curb', 'terrCap']), C = 2, H = new Map();
  E.forEach((e, i) => { for (let j = Math.floor((Math.min(e.az, e.bz) - 1.1) / C); j <= Math.floor((Math.max(e.az, e.bz) + 1.1) / C); j++) for (let k = Math.floor((Math.min(e.ax, e.bx) - 1.1) / C); k <= Math.floor((Math.max(e.ax, e.bx) + 1.1) / C); k++) { const q = j * 4096 + k; let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(i); } });
  let n = 0;
  const nearSh = shoreNear(tile);
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name];
    for (let v = 0; v + 2 < a.length; v += 3) {
      const x = a[v], z = a[v + 2], l = H.get(Math.floor(z / C) * 4096 + Math.floor(x / C));
      if (!l) continue;
      if (haInCentralPark(x + ox, z + oz) || nearSh(x, z, 6)) continue;
      const near = [];
      for (const i of l) {
        const e = E[i], dx = e.bx - e.ax, dz = e.bz - e.az, L2 = dx * dx + dz * dz;
        const t = Math.max(0, Math.min(1, ((x - e.ax) * dx + (z - e.az) * dz) / L2)), px = e.ax + dx * t, pz = e.az + dz * t, d = Math.hypot(x - px, z - pz);
        // (on the ground side of the edge)
        if (d > 1.05 || (x - px) * e.nx + (z - pz) * e.nz < -0.02) continue;
        near.push({ d, y: e.ay + (e.by - e.ay) * t - e.sep, nx: e.nx, nz: e.nz });
      }
      if (near.length < 2) continue;
      near.sort((p, q) => p.d - q.d);
      const A = near[0], B = near.find((q) => q.nx * A.nx + q.nz * A.nz < -0.5);
      if (!B || A.d + B.d > 2.1) continue;
      const y = (A.d + B.d) > 1e-6 ? (A.y * B.d + B.y * A.d) / (A.d + B.d) + off : A.y + off;
      if (Math.abs(a[v + 1] - y) > 0.005) { a[v + 1] = y; n++; }
    }
  }
  st.strips = n;
  return st;
}

// one surface where a lawn lies over the base: a base corner standing within 6 cm of a lawn over it, or through it (up to
// 6 m over a lawn the clamp or a building's band lowered), goes
// 8 cm under the lawn there, so the base cannot show through the lawn in blotches (the UN's lawns by the FDR deck)
export function baseUnderLawn(tile, st = {}) {
  if (GRADE_OFF) return;
  const S = tile.S, a = S.terrP1;
  if (!a || a.length < 9) return;
  let n = 0;
  // (the lawns, and the FDR structures' deck lawns laid after the clamp, tile.__boxTop)
  const L = ['grass', 'grassU'].map((gn) => S[gn]);
  const bt = tile.__boxTop;
  if (bt) for (const gn of ['grass', 'grassU']) if (bt[gn] && bt[gn].length >= 9) L.push(Float32Array.from(bt[gn]));
  for (let v = 0; v + 2 < a.length; v += 3) {
    let lw = null;
    for (const la of L) for (const y of ysAt(la, a[v], a[v + 2])) if (y > a[v + 1] - 6.0 && (lw === null || y < lw)) lw = y;
    if (lw !== null && a[v + 1] > lw - 0.06) { a[v + 1] = lw - 0.08; n++; }
  }
  st.baseUnder = n;
}

// ---- ONE SURFACE PER MAPPED PIECE: the 2017 land-cover raster drives the base's shading only on natural ground. The
// base (terrP1) is split into its connected pieces (triangles sharing an edge); a piece whose raster cover is mostly
// lawn/meadow (1, 2) or paved (6), with under a quarter natural (woodland 3, soil 4, rock 5), is urban ground: the whole
// piece takes one class, the lawn's material (matId 5) or a plaza's (matId 16) by the area majority, so no pixel mix of
// the two shows inside it; natural pieces keep the raster's shading (0 here). world/assemble.js reads it per triangle.
// `?baseClass=0`: off.
// the Hudson River Park piers' surfaces by survey (world x0, z0, x1, z1, matId: 5 lawn, 16 paved): Pier 59's driving range
// turf, Piers 62-63's lawn, Pier 64's lawn
const SURFACE_BOXES = [[-3418, 4117, -3240, 4183, 5], [-3254, 3662, -3149, 3788, 5], [-3322, 3519, -3172, 3610, 5]];
const BASE_CLASS_OFF = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('baseClass') === '0') || (isNode && process.env.TERRAIN_BASECLASS === '0');
export function gradeBaseClasses(tile) {
  const a = tile && tile.S && tile.S.terrP1;
  if (BASE_CLASS_OFF || !a || a.length < 9) return null;
  const [ox, oz] = tile.header.origin, nT = (a.length / 9) | 0;
  // union-find over shared edges
  const par = new Int32Array(nT); for (let t = 0; t < nT; t++) par[t] = t;
  const find = (t) => { while (par[t] !== t) { par[t] = par[par[t]]; t = par[t]; } return t; };
  const vk = (i) => `${Math.round(a[i] * 100)},${Math.round(a[i + 2] * 100)}`;
  const E = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) {
    const p = 9 * t + 3 * k, q = 9 * t + 3 * ((k + 1) % 3), ka = vk(p), kb = vk(q), ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    const u = E.get(ek);
    if (u === undefined) E.set(ek, t); else { const ra = find(u), rb = find(t); if (ra !== rb) par[ra] = rb; }
  }
  // per piece: area by class (sampled at the centroid and the corners' midpoints of each triangle)
  const acc = new Map();
  for (let t = 0; t < nT; t++) {
    const i = 9 * t, ar = Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) / 2;
    if (ar < 1e-6) continue;
    const r = find(t);
    let c = acc.get(r); if (!c) acc.set(r, (c = new Float64Array(10)));
    const pts = [[(a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3], [(a[i] + a[i + 3]) / 2, (a[i + 2] + a[i + 5]) / 2], [(a[i + 3] + a[i + 6]) / 2, (a[i + 5] + a[i + 8]) / 2], [(a[i + 6] + a[i]) / 2, (a[i + 8] + a[i + 2]) / 2]];
    for (const [x, z] of pts) { const k = coverClass(x + ox, z + oz); c[k < 10 ? k : 0] += ar / 4; }
  }
  const cls = new Map();
  for (const [r, c] of acc) {
    const lawn = c[1] + c[2], paved = c[6], nat = c[3] + c[4] + c[5], tot = lawn + paved + nat;
    if (tot <= 0 || nat > 0.25 * tot) { cls.set(r, 0); continue; }
    cls.set(r, lawn >= paved ? 5 : 16);
  }
  const out = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    out[t] = cls.get(find(t)) || 0;
    // (surveyed surfaces the raster misreads: a pier's lawn or turf, by the area's own boxes)
    const i = 9 * t, cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
    for (const [x0, z0, x1, z1, c] of SURFACE_BOXES) if (cx >= x0 && cx <= x1 && cz >= z0 && cz <= z1) { out[t] = c; break; }
  }
  return out;
}

// the retaining walls' tops as grading edges: a wall (a vertical face in the kerb, roadway-wall or built-wall soups) with
// paving at its foot on one side, 1 m and more under its top, and ground on the other side under its top: that ground is
// what the wall retains and comes up to its coping (the FDR's inner walls, a road's retaining walls)
function wallTopEdges(tile, P) {
  const S = tile.S, out = [];
  const pav = HA_PAVED.map((n) => S[n]).filter((a) => a && a.length >= 9);
  const gTop = (x, z) => { let y = null; for (const n of GROUND_SOUPS) for (const v of ysAt(P[n], x, z)) if (y === null || v > y) y = v; return y; };
  const pTop = (x, z) => { let y = null; for (const b of pav) for (const v of ysAt(b, x, z)) if (y === null || v > y) y = v; return y; };
  for (const n of ['curb', 'rwall', 'terrWall']) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (nonVert(a, i)) continue;
      const V = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 1], a[i + 3 * k + 2]]).sort((u, w) => w[1] - u[1]);
      const [A, B, Cc] = V;
      if (Math.abs(A[1] - B[1]) > 0.3 || A[1] - Cc[1] < 0.3) continue;
      const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
      if (L < 0.2) continue;
      const top = Math.min(A[1], B[1]), mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
      const nx0 = -(B[2] - A[2]) / L, nz0 = (B[0] - A[0]) / L;
      for (const sg of [1, -1]) {
        const nx = nx0 * sg, nz = nz0 * sg;
        const g = gTop(mx + nx * 0.6, mz + nz * 0.6), p = pTop(mx - nx * 0.8, mz - nz * 0.8);
        // (a retaining wall holds its ground near its top: ground 2 m and more under it is a parapet's or a viaduct's side)
        if (g === null || p === null || g > top - 0.3 || g < top - 2.0 || p > top - 1.0) continue;
        out.push({ ax: A[0], az: A[2], ay: A[1], bx: B[0], bz: B[2], by: B[1], nx, nz, sep: 0.15, wallTop: true });
        break;
      }
    }
  }
  // the FDR structures' inner walls (city/fdrBox.js): the street side's ground comes up to the wall's top
  if (boxQuads && boxCorner) {
    const [ox, oz] = tile.header.origin;
    for (const { s: b, i: k } of boxQuads(ox - 2, oz - 2, ox + TILE + 2, oz + TILE + 2)) {
      const sides = b.sr > 0 ? ['lo'] : b.sr < 0 ? ['ro'] : ['lo', 'ro'];
      for (const sd of sides) {
        const o0 = b[sd][k - b.i0], o1 = b[sd][k + 1 - b.i0];
        if (!Number.isFinite(o0) || !Number.isFinite(o1)) continue;
        const [x0, z0] = boxCorner(b, k, o0), [x1, z1] = boxCorner(b, k + 1, o1);
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.05) continue;
        const T = b.wallTop || b.top, y0 = T[k - b.i0], y1 = T[k + 1 - b.i0];
        if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
        // (outward: away from the strip's centreline)
        const cx = b.c.X[k], cz = b.c.Z[k];
        let nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
        if (((x0 + x1) / 2 - cx) * nx + ((z0 + z1) / 2 - cz) * nz < 0) { nx = -nx; nz = -nz; }
        out.push({ ax: x0 - ox, az: z0 - oz, ay: y0, bx: x1 - ox, bz: z1 - oz, by: y1, nx, nz, sep: 0.15, wallTop: true, box: true });
      }
    }
  }
  return out;
}

// ---- MISPLACED PARK PATHS: a park path or gravel walk laid 2 m and more under both the ground as laid and the
// authority's surface (a walk held at a flat or stale level on a hill: Marcus Garvey Park's, Inwood's) is laid on the
// ground (its corner at the ground's grade-level plus its separation), every copy of a corner alike; the clamp then has no
// pit to dig round it. A walk under an arch or a deck keeps its level (the authority's bare earth is at the walk there).
export function gradeDrapePaths(tile, st = {}) {
  if (GRADE_OFF || !GRADE_DRAPE || !tile || !tile.S) return null;
  const [ox, oz] = tile.header.origin, S = tile.S, key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const gTop = (x, z) => { let y = null; for (const n of GROUND_SOUPS) for (const v of ysAt(S[n], x, z)) { const g = v - OFF[n]; if (y === null || g > y) y = g; } return y; };
  let n = 0;
  for (const kind of ['path', 'gravel']) {
    const a = S[kind];
    if (!a || a.length < 9) continue;
    const sep = SEP[kind] ?? 0.155, lift = new Map();
    for (let v = 0; v + 2 < a.length; v += 3) {
      const k = key(a[v], a[v + 2]);
      if (lift.has(k)) continue;
      const x = a[v] + ox, z = a[v + 2] + oz;
      if (haInCentralPark(x, z)) { lift.set(k, 0); continue; }
      const q = haInfo(x, z), g = gTop(a[v], a[v + 2]), yp = a[v + 1] - sep;
      if (!q || g === null) { lift.set(k, 0); continue; }
      const tin = HA_ASPHALT + q.relief;
      lift.set(k, g - yp > 2.0 && tin - yp > 2.0 ? g - yp : 0);
    }
    for (let v = 0; v + 2 < a.length; v += 3) { const d = lift.get(key(a[v], a[v + 2])); if (d > 0) { a[v + 1] += d; n++; } }
  }
  st.drapedPathVerts = n;
  return st;
}

// ---- THE STAIRCASE GATE: surface boundaries that follow raster cells. Every boundary edge of each surface soup (lawns,
// aprons, plazas, the base): a vertex where two boundary edges meet, both axis-aligned and under 2 m, at a right angle,
// is a cell staircase's corner. Counted by kind, 'coast' apart (within 40 m of the river: the West Side lane's strip).
export function gradeStairs(tile) {
  const [ox, oz] = tile.header.origin, S = tile.S, out = { n: 0, coast: 0, byKind: {}, at: [] };
  for (const kind of ['grass', 'grassU', 'apron', 'plaza', 'terrP1', 'path', 'sidewalk']) {
    const a = S[kind];
    if (!a || a.length < 9) continue;
    const E = new Map(), key = (x, z) => `${Math.round(x * 100)},${Math.round(z * 100)}`;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (!nonVert(a, i)) continue;
      for (let k = 0; k < 3; k++) {
        const p = i + 3 * k, q = i + 3 * ((k + 1) % 3), ka = key(a[p], a[p + 2]), kb = key(a[q], a[q + 2]), ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        const e = E.get(ek); if (e) e.n++; else E.set(ek, { n: 1, ax: a[p], az: a[p + 2], bx: a[q], bz: a[q + 2], ka, kb });
      }
    }
    const V = new Map();
    for (const e of E.values()) { if (e.n !== 1) continue; for (const k of [e.ka, e.kb]) { let l = V.get(k); if (!l) V.set(k, (l = [])); l.push(e); } }
    let n = 0;
    for (const [k, l] of V) {
      if (l.length !== 2) continue;
      const ax = (e) => { const dx = Math.abs(e.bx - e.ax), dz = Math.abs(e.bz - e.az), L = Math.hypot(dx, dz); return L > 0.05 && L < 2.0 && (dx < 0.01 || dz < 0.01) ? (dx < 0.01 ? 'z' : 'x') : null; };
      const a1 = ax(l[0]), a2 = ax(l[1]);
      if (!a1 || !a2 || a1 === a2) continue;
      const [xs, zs] = k.split(',').map((v) => Number(v) / 100);
      let coast = false;
      for (let t = 0; t < 8 && !coast; t++) { const q = haInfo(xs + ox + Math.cos(t * 0.785) * 40, zs + oz + Math.sin(t * 0.785) * 40); if (q && q.tag === 3) coast = true; }
      if (coast) { out.coast++; continue; }
      n++;
      if (out.at.length < 6) out.at.push([+(xs + ox).toFixed(1), +(zs + oz).toFixed(1), kind]);
    }
    out.byKind[kind] = n; out.n += n;
  }
  return out;
}

// ---- THE WALL GATE: every mapped wall face (the built walls and rock faces, terrWall / terrRock): at stations every metre
// along its foot, the ground 0.5-3 m to either side must lie at the wall's toe or at its top (within 0.35 m): ground
// between the two levels there is a ramp standing in for the wall
export function gradeWallGate(tile) {
  const S = tile.S, [ox, oz] = tile.header.origin, out = { faces: 0, stations: 0, bad: 0, at: [] };
  const gTop = (x, z) => { let y = null; for (const n of GROUND_SOUPS) for (const v of ysAt(S[n], x, z)) if (y === null || v > y) y = v; return y; };
  for (const n of ['terrWall', 'terrRock']) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    const end = n === 'terrWall' && tile.__mappedWallLen !== undefined ? tile.__mappedWallLen : a.length;
    for (let i = 0; i + 8 < end; i += 9) {
      if (nonVert(a, i)) continue;
      const V = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 1], a[i + 3 * k + 2]]).sort((u, w) => w[1] - u[1]);
      const [A, B, C] = V;
      if (Math.abs(A[1] - B[1]) > 0.3 || A[1] - C[1] < 1.0) continue;   // (the upper triangle of a face 1 m and more tall)
      out.faces++;
      const top = (A[1] + B[1]) / 2, toe = C[1], L = Math.hypot(B[0] - A[0], B[2] - A[2]);
      if (L < 0.05) continue;
      const nx = -(B[2] - A[2]) / L, nz = (B[0] - A[0]) / L;
      for (let s2 = Math.min(0.5, L / 2); s2 < L; s2 += 1) {
        const x = A[0] + ((B[0] - A[0]) * s2) / L, z = A[2] + ((B[2] - A[2]) * s2) / L;
        // (the high side: its ground at 0.5 m must meet the top; the low side: its ground at 0.5 m must lie at its toe,
        // the lowest of its ground within 3 m plus 0.6 m: a ramp's ground rises against the wall)
        const g = [1, -1].map((sg) => [0.5, 1.5, 3.0].map((t) => gTop(x + nx * sg * t, z + nz * sg * t)));
        const lv = (side) => side.filter((v) => v !== null);
        const m0 = lv(g[0]).length ? Math.min(...lv(g[0])) : null, m1 = lv(g[1]).length ? Math.min(...lv(g[1])) : null;
        if (m0 === null || m1 === null) continue;
        out.stations++;
        const hi = m0 > m1 ? g[0] : g[1], lo = m0 > m1 ? g[1] : g[0], lmin = Math.min(m0, m1);
        let bad = false;
        if (hi[0] !== null && hi[0] < top - 0.6) bad = true;
        if (lo[0] !== null && lo[0] > lmin + 0.6 && lo[0] > top - (top - lmin) * 0.7) bad = true;
        if (bad) { out.bad++; if (out.at.length < 6) out.at.push([+(x + ox).toFixed(1), +(z + oz).toFixed(1), +(top - toe).toFixed(1)]); }
      }
    }
  }
  return out;
}

// ---- THE MAPPED WALLS HOLD THEIR GROUND: for every mapped wall face (terrWall / terrRock as the product laid them, 1 m
// and more tall), the ground within 3 m behind it (its high side) meets its top, and the ground within 3 m in front of it
// (its low side) lies at its toe (the low side's ground at 3 m): no band, ramp or lifted ground leans on a wall. Each
// ground corner takes the nearest face's rule, full within 1 m of the wall line, eased out to 3 m.
export function gradeMappedWalls(tile, st = {}) {
  if (GRADE_OFF || !tile || !tile.S) return null;
  const S = tile.S, segs = [];
  const gTop = (x, z) => { let y = null; for (const n of GROUND_SOUPS) for (const v of ysAt(S[n], x, z)) { const u = v - OFF[n]; if (y === null || u > y) y = u; } return y; };
  for (const n of ['terrWall', 'terrRock']) {
    const a = S[n];
    if (!a || a.length < 9) continue;
    const end = n === 'terrWall' && tile.__mappedWallLen !== undefined ? tile.__mappedWallLen : a.length;
    for (let i = 0; i + 8 < end; i += 9) {
      if (nonVert(a, i)) continue;
      const V = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 1], a[i + 3 * k + 2]]).sort((u, w) => w[1] - u[1]);
      const [A, B, C] = V;
      if (Math.abs(A[1] - B[1]) > 0.3 || A[1] - C[1] < 1.0) continue;
      const L = Math.hypot(B[0] - A[0], B[2] - A[2]);
      if (L < 0.05) continue;
      let nx = -(B[2] - A[2]) / L, nz = (B[0] - A[0]) / L;
      const mx = (A[0] + B[0]) / 2, mz = (A[2] + B[2]) / 2;
      const s1 = gTop(mx + nx * 3, mz + nz * 3), s2 = gTop(mx - nx * 3, mz - nz * 3);
      if (s1 === null || s2 === null) continue;
      if (s2 > s1) { nx = -nx; nz = -nz; }   // (n points to the high side)
      const top = Math.min(A[1], B[1]), toe = Math.min(s1, s2);
      if (top - toe < 1.0) continue;
      // (a retaining wall only: its high side's ground within 1.5 m of its top; a parapet or a freestanding wall over
      // both sides holds no ground)
      if (Math.max(s1, s2) < top - 1.5 || Math.max(s1, s2) > top + 1.0) continue;
      segs.push({ ax: A[0], az: A[2], bx: B[0], bz: B[2], L, nx, nz, top, toe });
    }
  }
  if (!segs.length) return st;
  const C = 4, H = new Map();
  segs.forEach((g, k) => { for (let j = Math.floor((Math.min(g.az, g.bz) - 3) / C); j <= Math.floor((Math.max(g.az, g.bz) + 3) / C); j++) for (let i = Math.floor((Math.min(g.ax, g.bx) - 3) / C); i <= Math.floor((Math.max(g.ax, g.bx) + 3) / C); i++) { const q = j * 4096 + i; let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(k); } });
  let n = 0;
  for (const name of GROUND_SOUPS) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const off = OFF[name];
    const [ox2, oz2] = tile.header.origin, triSide = new Float32Array(a.length / 9);
    // (each triangle's side by the authority's surface at its centroid: a corner on the wall line belongs to the
    // triangle it is a corner of, the low side's copy and the high side's copy apart)
    for (let t = 0; t < triSide.length; t++) { const i = 9 * t, q = haInfo((a[i] + a[i + 3] + a[i + 6]) / 3 + ox2, (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz2); triSide[t] = q ? HA_ASPHALT + q.relief : NaN; }
    for (let v = 0; v + 2 < a.length; v += 3) {
      const x = a[v], z = a[v + 2], l = H.get(Math.floor(z / C) * 4096 + Math.floor(x / C));
      if (!l) continue;
      let best = null, bd = 3.0;
      for (const k of l) {
        const g = segs[k], t = ((x - g.ax) * (g.bx - g.ax) + (z - g.az) * (g.bz - g.az)) / (g.L * g.L);
        if (t < -0.05 || t > 1.05) continue;
        const d = Math.abs((x - g.ax) * g.nx + (z - g.az) * g.nz);
        if (d < bd) { bd = d; best = g; }
      }
      if (!best) continue;
      const ts = triSide[Math.floor(v / 9)];
      if (!Number.isFinite(ts)) continue;
      const side = ts > (best.top + best.toe) / 2 ? 1 : -1;
      const w = bd <= 1.0 ? 1 : 1 - (bd - 1.0) / 2.0, ws = w * w * (3 - 2 * w);
      const y0 = a[v + 1];
      const target = side >= 0 ? best.top - 0.03 + off : best.toe + off;
      // (the high side comes up or down to the top; the low side only comes down to its toe)
      const y = side >= 0 ? y0 + (target - y0) * ws : y0 > target ? y0 + (target - y0) * ws : y0;
      if (Math.abs(y - y0) > 0.005) { a[v + 1] = y; n++; }
    }
  }
  st.mappedWalls = segs.length; st.mappedWallMoved = n;
  return st;
}

// within 4 m of a swept shore wall's cap station (local x, z): the coast strip, the shore lane's
function shoreNear(tile) {
  const [ox, oz] = tile.header.origin, SH = new Map(), SP = tile.p1Shore;
  if (SP && SP.stn) for (let k = 0; k + 5 < SP.stn.length; k += 6) { const x = SP.stn[k] - ox, z = SP.stn[k + 1] - oz, q = Math.floor(z / 4) * 4096 + Math.floor(x / 4); let l = SH.get(q); if (!l) SH.set(q, (l = [])); l.push(x, z); }
  return (x, z, r = 4) => { if (!SH.size) return false; const i = Math.floor(x / 4), j = Math.floor(z / 4), R = Math.ceil(r / 4); for (let b = -R; b <= R; b++) for (let a2 = -R; a2 <= R; a2++) { const l = SH.get((j + b) * 4096 + i + a2); if (l) for (let k = 0; k < l.length; k += 2) if ((l[k] - x) ** 2 + (l[k + 1] - z) ** 2 < r * r) return true; } return false; };
}
