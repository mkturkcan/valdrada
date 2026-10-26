import { CP_PARK } from '../city/cpFloraData.js';
import { buildingsOf } from './tiledata.js';   // TERRAIN FIX: the buildings set into a hillside (haClampGround)   // TERRAIN FIX: Central Park's outline (haClampGround leaves the park to its own parts)
import { gradeGround, gradeLoad, gradeCut, gradeStrips, gradeCrossings, gradeDrapePaths, baseUnderLawn } from './terrainGrade.js';   // TERRAIN GRADE: the ground cut and graded to every paving edge (haClampGround)
// P1 TERRAIN (phase 1a of the terrain round): the one height authority for a terrain region. Behind the flag
// `?terrain=p1` (page, bake) or TERRAIN_P1=1 (node: core, tests); off, nothing here runs and the city stays flat.
//
// The region (Columbia's Morningside campus, Morningside Park, Riverside Park 96th to 133rd, Manhattanville, and the
// blocks between them) carries the real ground as RELIEF over the flat compile, as Central Park's relief does
// (city/cpRelief.js), but from a constrained TIN instead of a 14 m grid:
//   - one surface: a TIN of the bare-earth grade (2017 city LiDAR, 2025 USGS on changed sites) with walls as SLITS
//     (the ground is discontinuous along a wall line: each triangle takes its own side's height, so a wall is a vertical
//     face, never a smeared bank), never sampled inside building footprints (filled harmonically from their perimeter)
//   - relief = world height over the flat compile, exactly 0 on the region's boundary: nothing outside moves
//   - every ground section (asphalt, walks, kerbs, lawns, paths, paint ...) is cut along the TIN's edges and each piece
//     lifted by the relief under it: the pieces lie flat on their TIN triangle, so stacked sections keep their compiled
//     separations exactly (asphalt 0, walk +0.135, lawn +0.127, path +0.155 over the grade) and no layer can fight
//   - the drawn base (terrain) is the TIN itself at the flat compile's base (3.24) + relief; the 16 m grid is not drawn
//     inside the region
//   - surveyed heights (decks, landings) map through the membrane S: world y = 3.385 + h(NAVD88) - S(x, z)
// P2A (Manhattan's ground, part 2): the cut by LIFTING is the default (below: each section keeps its own triangles, lifted
// at their corners and refined only where they leave the authority by more than TAU, 1 cm), every slit gets its face
// (tile.S.terrWall, tile.S.terrRock), the shore's bulkheads ride the land behind them, and the base is not drawn under the
// at-grade paving. The authority for Manhattan is built on a paved design grade (dev tools, mn_ground.py 'paved').
// Readers: world/assemble.js (sections, base, buildings' plinths), world/streamer.js and core/world/streamer.mjs
// (terrainAt), core/world/simTile.mjs (the core's tiles), the bake (it runs the page: cells/bakeLib.js samples the same
// surfaces). Data: client/public/data/terrain_p1/ (manifest.json, t_<tx>_<tz>.bin, S.bin, walls/stairs/decks.json),
// built by the terrain round's ground tools (p1_ground.py, p1_export.py; outside the repository).
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
const FLAG = (() => {
  try { if (typeof location !== 'undefined' && location.search && new URLSearchParams(location.search).get('terrain') === 'p1') return true; } catch { /* no location */ }
  try { if (isNode && process.env.TERRAIN_P1 === '1') return true; } catch { /* no env */ }
  return false;
})();
export const HA_P1 = FLAG;
// P1B: the cut by RE-LAYING (opt-in: `?terrainRelay=1` / TERRAIN_P1_RELAY=1; off, every triangle is cut as in 1a). A flat
// area section (one height over a whole triangle) is not cut along every TIN edge: a TIN triangle it covers wholly is
// laid once, as that triangle at the section's height + the relief (CP32's lawns, generalised); only the TIN triangles
// its boundary crosses get the clipped pieces. The base (terrain) is not drawn under a TIN triangle an opaque area
// covers. Manhattan: 8.25x the flat ground triangles against 11.4x for the full cut (tools/terrain/mn_budget.mjs). Opt-in
// because it reorders a section's triangles: where the compile overlaps one kind at two heights (asphalt at 3.371 and
// 3.385), the first triangle found, which the samplers answer with, can change (1.4 cm; tools/terrain/p1_probe.mjs).
const RELAY = (() => {
  try { if (typeof location !== 'undefined' && location.search && new URLSearchParams(location.search).get('terrainRelay') === '1') return true; } catch { /* no location */ }
  try { if (isNode && process.env.TERRAIN_P1_RELAY === '1') return true; } catch { /* no env */ }
  return false;
})();
// P2A: the cut by LIFTING (the default; `?terrainCut=relay|1a` / TERRAIN_P1_CUT select the earlier cuts). A section
// triangle keeps its own triangulation: its corners are lifted by the authority, and it is refined only where the lifted
// triangle departs from the authority by more than TAU (`?terrainTau=` / TERRAIN_P1_TAU, m). The refinement points on an
// edge are a function of that edge alone (its profile over the TIN, Douglas-Peucker to TAU), so two triangles sharing an
// edge split it identically and meet without a crack; a triangle that crosses a wall (a slit) is cut along the TIN there
// (1a's pieces), its points on an unbroken edge held to that edge's line. Lawns ('grass': natural ground) are laid as the
// TIN's triangles (the relay). The base is not drawn under a TIN triangle the opaque sections cover.
const CUT = (() => {
  let v = null;
  try { if (typeof location !== 'undefined' && location.search) v = new URLSearchParams(location.search).get('terrainCut'); } catch { /* no location */ }
  try { if (!v && isNode && process.env.TERRAIN_P1_CUT) v = process.env.TERRAIN_P1_CUT; } catch { /* no env */ }
  return v === '1a' || v === 'relay' || v === 'lift' ? v : (RELAY ? 'relay' : 'lift');
})();
const TAU = (() => {
  let v = null;
  try { if (typeof location !== 'undefined' && location.search) v = new URLSearchParams(location.search).get('terrainTau'); } catch { /* no location */ }
  try { if (v === null && isNode && process.env.TERRAIN_P1_TAU) v = process.env.TERRAIN_P1_TAU; } catch { /* no env */ }
  const t = v === null ? NaN : Number(v);
  return t > 0 && t < 1 ? t : 0.01;
})();
export const HA_CUT = CUT, HA_TAU = TAU;
// how far the base may sink under a section laid lower (TL26): 8 m in 1a's region; P2A 16 m, Manhattan's tunnel portal
// cuts (Brooklyn-Battery, Queens-Midtown, Lincoln) lie 8 to 14 m under the grade beside them
const SINK_MAX = 16;
// (node only, the measured alternatives: TERRAIN_P1_REFINE=fan refines from the corner opposite the edge with the most
// points instead of the ladder, TERRAIN_P1_LIFT_GRASS=1 lifts the flat lawns instead of relaying them; both cost more)
const FAN = isNode && typeof process !== 'undefined' && process.env.TERRAIN_P1_REFINE === 'fan';
const LIFT_GRASS = isNode && typeof process !== 'undefined' && process.env.TERRAIN_P1_LIFT_GRASS === '1';
const OPAQUE = new Set(['asphalt', 'sidewalk', 'grass', 'path', 'brick', 'gutter', 'grassU', 'plaza', 'gravel', 'busred']);
export const HA_ASPHALT = 3.385;   // the flat compile's asphalt top
export const HA_BASE = 3.24;       // ... and its drawn base (terrain)
const TILE = 512, BK = 4, MARGIN = 64, NB = (TILE + 2 * MARGIN) / BK;   // buckets over the tile square and its margin (the chunks overlap by MARGIN)
// the Columbia superblock (compile.mjs CAMPUS_PADS / CAMPUS_RECT): the flat compile laid its McKim pads there; inside the
// region the real ground replaces them, so a vertex's lift there is the relief less the pad it was compiled on
const ALMA = [764.23, -2747.81], PAD_A = [0.465, -0.885], PAD_C = [0.885, 0.465];
// (the property lines' corners in campus-axis (a, c), CAMPUS_RECT's skewed lines solved: 114th, Amsterdam, 120th, Broadway)
const CAMPUS_Q = [[-206.7, -100.3], [-211.6, 114.7], [249.4, 124.1], [253.9, -90.7]].map(([a, c]) => [ALMA[0] + PAD_A[0] * a + PAD_C[0] * c, ALMA[1] + PAD_A[1] * a + PAD_C[1] * c]);

let MAN = null, SG = null, initP = null, REGION = null, RBOX = null, REGIONS = null;
const CH = new Map();        // 'tx_tz' -> chunk, or false (no data for that tile)
const LOADING = new Map();

// (five boroughs: `?terrainData=<dir under data/>` / TERRAIN_P1_DIR picks another product set, e.g. the merged city set;
// regions, S and chunks are read from its manifest whatever their number)
const DATA_NAME = (() => { try { const v = typeof location !== 'undefined' && location.search && new URLSearchParams(location.search).get('terrainData'); return v && /^[\w.-]+$/.test(v) ? v : 'terrain_p1'; } catch { return 'terrain_p1'; } })();
const dataDir = () => (isNode ? (process.env.TERRAIN_P1_DIR || decodeURIComponent(new URL('../../public/data/terrain_p1/', import.meta.url).pathname)) : null);
async function readBuf(name) {
  if (!isNode) {
    const base = (typeof location !== 'undefined' ? new URL(`data/${DATA_NAME}/`, location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href : `/data/${DATA_NAME}/`);
    const r = await fetch(base + name);
    if (!r.ok) throw new Error(`${DATA_NAME} ${name}: ${r.status}`);
    return r.arrayBuffer();
  }
  const spec = 'node:fs/promises';
  const fs = await import(/* @vite-ignore */ spec);
  const b = await fs.readFile(dataDir() + name);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

let FAR = null;
// the far city's relief at (x, z) (m over the flat compile; 0 off the grid), or null without the data (the macros stay flat)
export function haFarRelief(x, z) {
  if (!FAR) return null;
  const u = (x - FAR.x0) / FAR.step, w = (z - FAR.z0) / FAR.step, i = Math.floor(u), j = Math.floor(w);
  if (i < 0 || j < 0 || i >= FAR.nx - 1 || j >= FAR.nz - 1) return 0;
  const a = u - i, b = w - j, v = FAR.v, n = FAR.nx;
  return (v[j * n + i] * (1 - a) + v[j * n + i + 1] * a) * (1 - b) + (v[(j + 1) * n + i] * (1 - a) + v[(j + 1) * n + i + 1] * a) * b;
}

export function haInit() {
  if (!FLAG) return Promise.resolve(false);
  if (!initP) {
    initP = (async () => {
      MAN = JSON.parse(new TextDecoder().decode(await readBuf('manifest.json')));
      // P1B: several regions (an island each: Manhattan with Marble Hill, Roosevelt, Randall's/Wards, Governors); five
      // boroughs: the city's land parts and the soft edges past the Westchester and Nassau limits (boro_merge.py)
      REGIONS = (MAN.regions || [MAN.region]).map((ring) => {
        const b = [1e9, 1e9, -1e9, -1e9];
        for (const [x, z] of ring) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], z); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], z); }
        return { ring, b };
      });
      REGION = REGIONS[0].ring;
      RBOX = [1e9, 1e9, -1e9, -1e9];
      for (const { b } of REGIONS) { RBOX[0] = Math.min(RBOX[0], b[0]); RBOX[1] = Math.min(RBOX[1], b[1]); RBOX[2] = Math.max(RBOX[2], b[2]); RBOX[3] = Math.max(RBOX[3], b[3]); }
      // five boroughs: the far city's relief (32 m nodes, int16 cm; boro_far.py), for the macro tiles past the near ring
      try { const f = MAN.farRelief; if (f) { const fb = await readBuf(f.f); FAR = { ...f, v: Float32Array.from(new Int16Array(fb), (q) => q / 100) }; } } catch { FAR = null; }
      const s = MAN.S, sb = await readBuf(s.f);
      SG = { ...s, v: s.type === 'i16mm' ? Float32Array.from(new Int16Array(sb), (q) => q / 1000) : new Float32Array(sb) };
      for (const t of MAN.tiles) if (!t.nRegion) CH.set(`${t.tx}_${t.tz}`, false);
      // P2A: the walls registry (the faces' material by source)
      try { WALLS = JSON.parse(new TextDecoder().decode(await readBuf('walls.json'))).walls.map((w) => ({ c: wallClassOf(w.src), xz: w.xz, stone: w.stone || null })); } catch { WALLS = null; }
      // P2C: the OSM stairs (a parapet opens where a flight meets its wall)
      try { STAIRS = JSON.parse(new TextDecoder().decode(await readBuf('stairs.json'))).osm_steps.map((q) => ({ xz: q.xz, w: parseFloat(q.width) })); } catch { STAIRS = null; }
      return true;
    })().catch((e) => { console.warn('[terrain p1] init failed, staying flat', e); MAN = null; return false; });
  }
  return initP;
}

function parseChunk(buf, tx, tz) {
  const h = new Uint32Array(buf, 0, 4);
  if (h[0] !== 0x31505456) throw new Error('terrain_p1 chunk: bad magic');
  const nV = h[2], nT = h[3];
  let o = 16;
  const x = new Float32Array(buf, o, nV); o += 4 * nV;
  const z = new Float32Array(buf, o, nV); o += 4 * nV;
  const tri = new Uint32Array(buf, o, 3 * nT); o += 12 * nT;
  const rel = new Float32Array(buf, o, 3 * nT); o += 12 * nT;
  const tag = new Uint8Array(buf, o, nT);
  // 4 m buckets over the tile square (CSR; PERF: built on the first read of off or list, a chunk loaded round a bridge's
  // deck may never be asked)
  const ox = tx * TILE - MARGIN, oz = tz * TILE - MARGIN;
  const buckets = () => {
    const cnt = new Uint32Array(NB * NB + 1);
    const range = (t) => {
      const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
      const i0 = Math.max(0, Math.floor((Math.min(x[a], x[b], x[c]) - ox) / BK)), i1 = Math.min(NB - 1, Math.floor((Math.max(x[a], x[b], x[c]) - ox) / BK));
      const j0 = Math.max(0, Math.floor((Math.min(z[a], z[b], z[c]) - oz) / BK)), j1 = Math.min(NB - 1, Math.floor((Math.max(z[a], z[b], z[c]) - oz) / BK));
      return [i0, i1, j0, j1];
    };
    const RG = new Int32Array(4 * nT);   // (each triangle's bucket range, taken once for both passes)
    for (let t = 0; t < nT; t++) { const [i0, i1, j0, j1] = range(t); RG[4 * t] = i0; RG[4 * t + 1] = i1; RG[4 * t + 2] = j0; RG[4 * t + 3] = j1; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cnt[j * NB + i + 1]++; }
    for (let k = 0; k < NB * NB; k++) cnt[k + 1] += cnt[k];
    const fill = cnt.slice(0, NB * NB), list = new Uint32Array(cnt[NB * NB]);
    for (let t = 0; t < nT; t++) { const i0 = RG[4 * t], i1 = RG[4 * t + 1], j0 = RG[4 * t + 2], j1 = RG[4 * t + 3]; for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) list[fill[j * NB + i]++] = t; }
    return [cnt, list];
  };
  const ch = { tx, tz, ox, oz, nV, nT, x, z, tri, rel, tag, stamp: new Uint32Array(nT), sc: 0 };
  // (on first read both become plain properties)
  const built = () => { const [off, list] = buckets(); Object.defineProperty(ch, 'off', { value: off, enumerable: true, writable: true, configurable: true }); Object.defineProperty(ch, 'list', { value: list, enumerable: true, writable: true, configurable: true }); };
  Object.defineProperty(ch, 'off', { enumerable: true, configurable: true, get: () => { built(); return ch.off; } });
  Object.defineProperty(ch, 'list', { enumerable: true, configurable: true, get: () => { built(); return ch.list; } });
  return ch;
}

// is there region data for this tile? (loads it; false when the flag is off, the data is missing or the tile has none)
// (chunkOnly: the region's chunk alone, for a reader of its relief (a bridge's deck anchors); the grade's stations and the
// cover round the tile are a tile's own to load when it is laid, and only its own and its neighbours' are read)
export async function haTileReady(tx, tz, chunkOnly = false) {
  if (!FLAG || !(await haInit()) || !MAN) return false;
  const k = `${tx}_${tz}`;
  if (!chunkOnly) {
    if (!LOADING.has('g' + k)) LOADING.set('g' + k, gradeLoad(tx, tz).catch(() => null));   // (TERRAIN GRADE: its stations, the cover)
    await LOADING.get('g' + k);
  }
  if (CH.has(k)) return !!CH.get(k);
  const t = MAN.tiles.find((q) => q.tx === tx && q.tz === tz);
  if (!t) { CH.set(k, false); return false; }
  if (!LOADING.has(k)) LOADING.set(k, readBuf(t.f).then((b) => { CH.set(k, parseChunk(b, tx, tz)); }).catch((e) => { console.warn('[terrain p1] tile', k, e); CH.set(k, false); }));
  await LOADING.get(k);
  return !!CH.get(k);
}
export const haTileHit = (ox, oz) => !!(FLAG && CH.get(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`));

export function haInRegion(x, z) {
  if (!REGIONS || x < RBOX[0] || x > RBOX[2] || z < RBOX[1] || z > RBOX[3]) return false;
  for (const { ring, b } of REGIONS) {
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    let ins = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
    }
    if (ins) return true;
  }
  return false;
}

// the TIN triangle under (x, z) in chunk ch and its barycentrics, or -1
const BW = new Float64Array(3);
function locate(ch, x, z) {
  const i = Math.floor((x - ch.ox) / BK), j = Math.floor((z - ch.oz) / BK);
  if (i < 0 || j < 0 || i >= NB || j >= NB) return -1;
  const { off, list, tri, x: X, z: Z } = ch;
  for (let k = off[j * NB + i], e = off[j * NB + i + 1]; k < e; k++) {
    const t = list[k], a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const d = (Z[b] - Z[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Z[a] - Z[c]);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((Z[b] - Z[c]) * (x - X[c]) + (X[c] - X[b]) * (z - Z[c])) / d;
    const w1 = ((Z[c] - Z[a]) * (x - X[c]) + (X[a] - X[c]) * (z - Z[c])) / d;
    const w2 = 1 - w0 - w1;
    if (w0 >= -1e-7 && w1 >= -1e-7 && w2 >= -1e-7) { BW[0] = w0; BW[1] = w1; BW[2] = w2; return t; }
  }
  return -1;
}
const chunkAt = (x, z) => CH.get(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`);
const relOf = (ch, t) => ch.rel[3 * t] * BW[0] + ch.rel[3 * t + 1] * BW[1] + ch.rel[3 * t + 2] * BW[2];

// relief (m to add to the flat compile) at (x, z): 0 outside the region, null where the tile's data is not loaded
export function haRelief(x, z) {
  if (!FLAG) return 0;
  const ch = chunkAt(x, z);
  if (ch === false) return 0;
  if (!ch) return null;
  const t = locate(ch, x, z);
  return t < 0 ? 0 : relOf(ch, t);
}
// { relief, tag (0 ground, 1 under a footprint, 2 rock/steep face, 3 river, 255 outside), t } or null
export function haInfo(x, z) {
  if (!FLAG) return null;
  const ch = chunkAt(x, z);
  if (!ch) return null;
  const t = locate(ch, x, z);
  return t < 0 ? null : { relief: relOf(ch, t), tag: ch.tag[t], t };
}
// the same from a given tile's chunk (it carries a 64 m margin): a record of tile (tx, tz) lying just past its edge, when
// the neighbour's chunk is not in (P1B re-anchoring, world/haAnchor.js)
export function haInfoIn(x, z, tx, tz) {
  if (!FLAG) return null;
  const ch = CH.get(`${tx}_${tz}`);
  if (!ch) return null;
  const t = locate(ch, x, z);
  return t < 0 ? null : { relief: relOf(ch, t), tag: ch.tag[t], t };
}
// the drawn base (the flat compile's 3.24 + relief) where the region has ground, else null (the tile's grid answers)
export function haTerrainAt(x, z) {
  const q = haInfo(x, z);
  return q && q.tag < 3 ? HA_BASE + q.relief : null;
}
// the grade (asphalt level) where the region has ground, else null
export function haGradeAt(x, z) {
  const q = haInfo(x, z);
  return q && q.tag < 3 ? HA_ASPHALT + q.relief : null;
}
// the membrane S (NAVD88 m) at (x, z), bilinear on its 4 m grid
export function haS(x, z) {
  if (!SG) return null;
  const fx = (x - SG.x0) / SG.step, fz = (z - SG.z0) / SG.step;
  if (fx < 0 || fz < 0 || fx > SG.nx - 1.001 || fz > SG.nz - 1.001) return null;
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, n = SG.nx, a = SG.v;
  return a[j * n + i] * (1 - u) * (1 - v) + a[j * n + i + 1] * u * (1 - v) + a[(j + 1) * n + i] * (1 - u) * v + a[(j + 1) * n + i + 1] * u * v;
}
// world y of a surveyed height h (NAVD88 m: a deck, a landing) at (x, z) inside the region, else null
export function haWorldOf(h, x, z) {
  if (!haInRegion(x, z)) return null;
  const s = haS(x, z);
  return s === null ? null : HA_ASPHALT + h - s;
}

// the compiled pad under a campus vertex (tile-local grid g, res r): its height over the flat base, 0 off the campus
function inQuad(x, z) {
  let ins = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, zi] = CAMPUS_Q[i], [xj, zj] = CAMPUS_Q[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function padOf(grid, res, ox, oz, x, z) {
  if (!grid || res < 64 || !inQuad(x, z)) return 0;
  const n = res + 1;
  const fx = Math.min(res - 0.001, Math.max(0, ((x - ox) / TILE) * res)), fz = Math.min(res - 0.001, Math.max(0, ((z - oz) / TILE) * res));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const y00 = grid[j * n + i], y10 = grid[j * n + i + 1], y01 = grid[(j + 1) * n + i], y11 = grid[(j + 1) * n + i + 1];
  const y = u >= v ? y00 + u * (y10 - y00) + v * (y11 - y10) : y00 + v * (y01 - y00) + u * (y11 - y01);
  return y > 0 ? y - HA_BASE : 0;     // (a water dive is not a pad)
}

// ---------------------------------------------------------------- the cut
// a convex polygon [[x, y, z] ...] (world x, z) clipped to TIN triangle t of ch (Sutherland-Hodgman on its 3 edges)
function clipToTri(poly, ch, t) {
  const { tri, x: X, z: Z } = ch;
  const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
  const s = Math.sign((X[b] - X[a]) * (Z[c] - Z[a]) - (Z[b] - Z[a]) * (X[c] - X[a])) || 1;
  let out = poly;
  for (const [p, q] of [[a, b], [b, c], [c, a]]) {
    if (out.length < 3) return out;
    const ex = X[q] - X[p], ez = Z[q] - Z[p], src = out;
    out = [];
    for (let k = 0; k < src.length; k++) {
      const P = src[k], Q = src[(k + 1) % src.length];
      const dp = s * (ex * (P[2] - Z[p]) - ez * (P[0] - X[p])), dq = s * (ex * (Q[2] - Z[p]) - ez * (Q[0] - X[p]));
      if (dp >= -1e-9) out.push(P);
      if ((dp > 1e-9 && dq < -1e-9) || (dp < -1e-9 && dq > 1e-9)) {
        const r = dp / (dp - dq);
        out.push([P[0] + (Q[0] - P[0]) * r, P[1] + (Q[1] - P[1]) * r, P[2] + (Q[2] - P[2]) * r]);
      }
    }
  }
  return out;
}
// the TIN triangles whose buckets a world box touches (deduplicated)
function candidates(ch, x0, z0, x1, z1, out) {
  out.length = 0;
  const i0 = Math.max(0, Math.floor((x0 - ch.ox) / BK)), i1 = Math.min(NB - 1, Math.floor((x1 - ch.ox) / BK));
  const j0 = Math.max(0, Math.floor((z0 - ch.oz) / BK)), j1 = Math.min(NB - 1, Math.floor((z1 - ch.oz) / BK));
  const st = ++ch.sc, off = ch.off, list = ch.list, stamp = ch.stamp;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    for (let k = off[j * NB + i], e = off[j * NB + i + 1]; k < e; k++) {
      const t = list[k];
      if (stamp[t] !== st) { stamp[t] = st; out.push(t); }
    }
  }
  return out;
}
// does segment (a, b) touch the closed TIN triangle t? (2D, x/z)
function segTouchesTri(ch, t, ax, az, bx, bz) {
  const { tri, x: X, z: Z } = ch;
  const p = [tri[3 * t], tri[3 * t + 1], tri[3 * t + 2]];
  const inT = (x, z) => {
    let pos = 0, neg = 0;
    for (let k = 0; k < 3; k++) {
      const u = p[k], w = p[(k + 1) % 3];
      const c = (X[w] - X[u]) * (z - Z[u]) - (Z[w] - Z[u]) * (x - X[u]);
      if (c > 1e-9) pos++; else if (c < -1e-9) neg++;
    }
    return !(pos && neg);
  };
  if (inT(ax, az) || inT(bx, bz)) return true;
  const orient = (x1, z1, x2, z2, x3, z3) => (x2 - x1) * (z3 - z1) - (z2 - z1) * (x3 - x1);
  for (let k = 0; k < 3; k++) {
    const ux = X[p[k]], uz = Z[p[k]], wx = X[p[(k + 1) % 3]], wz = Z[p[(k + 1) % 3]];
    const d1 = orient(ax, az, bx, bz, ux, uz), d2 = orient(ax, az, bx, bz, wx, wz), d3 = orient(ux, uz, wx, wz, ax, az), d4 = orient(ux, uz, wx, wz, bx, bz);
    if (((d1 >= -1e-9 && d2 <= 1e-9) || (d1 <= 1e-9 && d2 >= -1e-9)) && ((d3 >= -1e-9 && d4 <= 1e-9) || (d3 <= 1e-9 && d4 >= -1e-9))) return true;
  }
  return false;
}
// the relief of TIN triangle t at (x, z) (its plane, extended)
function relAt(ch, t, x, z) {
  const { tri, x: X, z: Z, rel } = ch;
  const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
  const d = (Z[b] - Z[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Z[a] - Z[c]);
  const w0 = ((Z[b] - Z[c]) * (x - X[c]) + (X[c] - X[b]) * (z - Z[c])) / d;
  const w1 = ((Z[c] - Z[a]) * (x - X[c]) + (X[a] - X[c]) * (z - Z[c])) / d;
  return rel[3 * t] * w0 + rel[3 * t + 1] * w1 + rel[3 * t + 2] * (1 - w0 - w1);
}
// the ground sections a tile carries (world/assemble.js's drawn list, the rail beds and the shore aprons)
export const HA_GROUND = ['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'grass', 'path', 'paintG', 'brick', 'gutter', 'busred', 'warn', 'warnIron', 'grassU', 'plaza', 'gravel',
  'rsteel', 'rbal', 'rtop', 'rwall', 'apron'];

// Before anything samples or draws the tile's ground (after the re-kinding passes): every ground section cut along the
// TIN and lifted; the road lines and the terrain grid lifted; the region's base laid as tile.S.terrP1 (tile-local x, z,
// world y; drawn as terrain); tile.p1 = { stats } for the probes. The campus's compiled pads are taken out first.
export const haStats = new Map();   // tile key -> the last apply's counts (probes, logs)
export const haInCampus = (x, z) => inQuad(x, z);
// P1B: the flat triangles of one area section (a single height over each triangle) laid again per TIN triangle: a TIN
// triangle none of whose section-boundary edges touch it, and whose centroid the section covers, is emitted once as that
// triangle at the section's height + the relief (winding as the section's); the others get the clipped pieces (1a's cut).
// Returns { mask (section triangles handled), tout, n } or null.
// the area two plan triangles share ([[x, z] x 3] each; Sutherland-Hodgman of one by the other)
function overlapArea2(A, Bt) {
  const s = Math.sign((Bt[1][0] - Bt[0][0]) * (Bt[2][1] - Bt[0][1]) - (Bt[1][1] - Bt[0][1]) * (Bt[2][0] - Bt[0][0])) || 1;
  let out = A;
  for (let e = 0; e < 3 && out.length >= 3; e++) {
    const P = Bt[e], Q = Bt[(e + 1) % 3], src = out;
    out = [];
    for (let k = 0; k < src.length; k++) {
      const u = src[k], v = src[(k + 1) % src.length];
      const du = s * ((Q[0] - P[0]) * (u[1] - P[1]) - (Q[1] - P[1]) * (u[0] - P[0])), dv = s * ((Q[0] - P[0]) * (v[1] - P[1]) - (Q[1] - P[1]) * (v[0] - P[0]));
      if (du >= 0) out.push(u);
      if ((du > 0 && dv < 0) || (du < 0 && dv > 0)) { const r = du / (du - dv); out.push([u[0] + (v[0] - u[0]) * r, u[1] + (v[1] - u[1]) * r]); }
    }
  }
  let ar = 0;
  for (let k = 1; k + 1 < out.length; k++) ar += Math.abs((out[k][0] - out[0][0]) * (out[k + 1][1] - out[0][1]) - (out[k + 1][0] - out[0][0]) * (out[k][1] - out[0][1])) / 2;
  return ar;
}
function relayCut(name, a, ch, ox, oz, out, lowerC, fullOpaque, cand, stats) {
  const nTri = (a.length / 9) | 0, mask = new Uint8Array(nTri);
  const lv = new Map();
  for (let q = 0; q < nTri; q++) {
    const i = q * 9, y = a[i + 1];
    if (Math.abs(a[i + 4] - y) > 1e-3 || Math.abs(a[i + 7] - y) > 1e-3) continue;
    const Ax = a[i] + ox, Az = a[i + 2] + oz, Bx = a[i + 3] + ox, Bz = a[i + 5] + oz, Cx = a[i + 6] + ox, Cz = a[i + 8] + oz;
    const ar = (Bx - Ax) * (Cz - Az) - (Cx - Ax) * (Bz - Az);
    if (Math.abs(ar) < 1e-3) continue;
    const x0 = Math.min(Ax, Bx, Cx), x1 = Math.max(Ax, Bx, Cx), z0 = Math.min(Az, Bz, Cz), z1 = Math.max(Az, Bz, Cz);
    if (x0 < ox - MARGIN + 0.5 || x1 > ox + TILE + MARGIN - 0.5 || z0 < oz - MARGIN + 0.5 || z1 > oz + TILE + MARGIN - 0.5) continue;
    if (x1 < RBOX[0] || x0 > RBOX[2] || z1 < RBOX[1] || z0 > RBOX[3]) continue;
    const k = `${Math.round(y * 1000)}|${ar > 0 ? 1 : 0}`;
    let L = lv.get(k);
    if (!L) lv.set(k, (L = []));
    L.push(q);
  }
  if (!lv.size) return null;
  // P2A: a triangle that overlaps another of this kind on another level (or a sloped one: Central Park's lake banks lay
  // lawns at two heights over one spot) is not relaid: relaying reorders the soup, and the samplers answer with the first
  // triangle found, so such a spot could answer the other level; those triangles keep the in-order cut below
  {
    const lvOf = new Int32Array(nTri).fill(-1), keys = [...lv.keys()];
    keys.forEach((k, li) => { for (const q of lv.get(k)) lvOf[q] = li; });
    const B = new Map();
    for (let q = 0; q < nTri; q++) {
      const i = q * 9;
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]), x1 = Math.max(a[i], a[i + 3], a[i + 6]), z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]), z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]);
      if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-3 || x1 - x0 > 200 || z1 - z0 > 200) continue;
      for (let j = Math.floor(z0 / 4); j <= Math.floor(z1 / 4); j++) for (let k = Math.floor(x0 / 4); k <= Math.floor(x1 / 4); k++) { const bk = j * 100000 + k; let l = B.get(bk); if (!l) B.set(bk, (l = [])); l.push(q); }
    }
    const stacked = new Uint8Array(nTri), seen = new Set();
    const tri2 = (q) => { const i = q * 9; return [[a[i], a[i + 2]], [a[i + 3], a[i + 5]], [a[i + 6], a[i + 8]]]; };
    for (const l of B.values()) {
      for (let u = 0; u < l.length; u++) for (let w = u + 1; w < l.length; w++) {
        const p = l[u], q = l[w], lp = lvOf[p], lq = lvOf[q];
        if (lp === lq || (stacked[p] && stacked[q])) continue;
        const key = p < q ? p * nTri + q : q * nTri + p;
        if (seen.has(key)) continue;
        seen.add(key);
        if (overlapArea2(tri2(p), tri2(q)) > 1e-3) { stacked[p] = 1; stacked[q] = 1; }
      }
    }
    // (only the overlapping triangles leave their level; the rest of it is still relaid, its outline round them cut)
    let ns = 0;
    for (const k of keys) {
      const L = lv.get(k).filter((q) => !stacked[q]);
      ns += lv.get(k).length - L.length;
      if (L.length) lv.set(k, L); else lv.delete(k);
    }
    if (ns) stats.relay.stackedTriangles = (stats.relay.stackedTriangles || 0) + ns;
    if (!lv.size) return null;
  }
  const { tri, x: X, z: Z, rel, tag } = ch;
  const key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  let tout = 0, n = 0;
  for (const L of lv.values()) {
    // the level's boundary: edges used once (vertices keyed at 1 mm), in 4 m buckets
    const ec = new Map();
    let areaIn = 0, areaOut = 0;
    for (const q of L) {
      const i = q * 9;
      const V = [[a[i] + ox, a[i + 2] + oz], [a[i + 3] + ox, a[i + 5] + oz], [a[i + 6] + ox, a[i + 8] + oz]];
      areaIn += Math.abs((V[1][0] - V[0][0]) * (V[2][1] - V[0][1]) - (V[2][0] - V[0][0]) * (V[1][1] - V[0][1])) / 2;
      // (directed: an interior edge is walked once each way and cancels; a duplicated or overlapping triangle leaves its
      // edges uncancelled, so its outline counts as boundary and the TIN triangles there are cut, never laid whole)
      for (let e = 0; e < 3; e++) {
        const P = V[e], Q = V[(e + 1) % 3], kp = key(P[0], P[1]), kq = key(Q[0], Q[1]);
        const k2 = kp < kq ? kp + '|' + kq : kq + '|' + kp, d = kp < kq ? 1 : -1;
        const r = ec.get(k2);
        if (r) { r.n += d; r.m++; } else ec.set(k2, { n: d, m: 1, P, Q });
      }
    }
    const segB = new Map();
    for (const { n: c, m, P, Q } of ec.values()) {
      if (c === 0 && m === 2) continue;
      const i0 = Math.floor((Math.min(P[0], Q[0]) - ox) / BK), i1 = Math.floor((Math.max(P[0], Q[0]) - ox) / BK);
      const j0 = Math.floor((Math.min(P[1], Q[1]) - oz) / BK), j1 = Math.floor((Math.max(P[1], Q[1]) - oz) / BK);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const bk = j * 100000 + ii;
        let arr = segB.get(bk);
        if (!arr) segB.set(bk, (arr = []));
        arr.push(P[0], P[1], Q[0], Q[1]);
      }
    }
    // the TIN triangles each flat triangle touches
    const byT = new Map();
    for (const q of L) {
      const i = q * 9;
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]) + ox, x1 = Math.max(a[i], a[i + 3], a[i + 6]) + ox;
      const z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]) + oz, z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]) + oz;
      candidates(ch, x0, z0, x1, z1, cand);
      for (const t of cand) { let arr = byT.get(t); if (!arr) byT.set(t, (arr = [])); arr.push(q); }
      mask[q] = 1;
      n++;
    }
    const y0 = a[L[0] * 9 + 1];
    const i0q = L[0] * 9, sgnS = Math.sign((a[i0q + 3] - a[i0q]) * (a[i0q + 8] - a[i0q + 2]) - (a[i0q + 6] - a[i0q]) * (a[i0q + 5] - a[i0q + 2]));
    const inQ = (q, x, z) => {
      const i = q * 9;
      const ax = a[i] + ox, az = a[i + 2] + oz, bx = a[i + 3] + ox, bz = a[i + 5] + oz, cx = a[i + 6] + ox, cz = a[i + 8] + oz;
      const d1 = (bx - ax) * (z - az) - (bz - az) * (x - ax), d2 = (cx - bx) * (z - bz) - (cz - bz) * (x - bx), d3 = (ax - cx) * (z - cz) - (az - cz) * (x - cx);
      return !((d1 < -1e-9 || d2 < -1e-9 || d3 < -1e-9) && (d1 > 1e-9 || d2 > 1e-9 || d3 > 1e-9));
    };
    for (const [t, qs] of byT) {
      const A0 = tri[3 * t], B0 = tri[3 * t + 1], C0 = tri[3 * t + 2];
      const tx0 = Math.min(X[A0], X[B0], X[C0]), tx1 = Math.max(X[A0], X[B0], X[C0]), tz0 = Math.min(Z[A0], Z[B0], Z[C0]), tz1 = Math.max(Z[A0], Z[B0], Z[C0]);
      let whole = true;
      const i0 = Math.floor((tx0 - ox) / BK), i1 = Math.floor((tx1 - ox) / BK), j0 = Math.floor((tz0 - oz) / BK), j1 = Math.floor((tz1 - oz) / BK);
      for (let j = j0; j <= j1 && whole; j++) for (let ii = i0; ii <= i1 && whole; ii++) {
        const arr = segB.get(j * 100000 + ii);
        if (!arr) continue;
        for (let k = 0; k < arr.length; k += 4) if (segTouchesTri(ch, t, arr[k], arr[k + 1], arr[k + 2], arr[k + 3])) { whole = false; break; }
      }
      if (whole) {
        // (the centroid and the three corners pulled 1 % towards it lie in the section)
        const cx = (X[A0] + X[B0] + X[C0]) / 3, cz = (Z[A0] + Z[B0] + Z[C0]) / 3;
        whole = [[cx, cz], ...[A0, B0, C0].map((v) => [X[v] + (cx - X[v]) * 0.01, Z[v] + (cz - Z[v]) * 0.01])].every(([px, pz]) => qs.some((q) => inQ(q, px, pz)));
      }
      const lifted = tag[t] !== 255;
      if (whole) {
        stats.relay.whole++;
        const sgnT = Math.sign((X[B0] - X[A0]) * (Z[C0] - Z[A0]) - (X[C0] - X[A0]) * (Z[B0] - Z[A0]));
        const order = sgnT === sgnS ? [0, 1, 2] : [0, 2, 1];
        let mn = Infinity;
        for (const k of order) {
          const v = tri[3 * t + k], r = lifted ? rel[3 * t + k] : 0;
          out.push(X[v] - ox, y0 + r, Z[v] - oz);
          mn = Math.min(mn, y0 + r);
        }
        tout++;
        areaOut += Math.abs((X[B0] - X[A0]) * (Z[C0] - Z[A0]) - (X[C0] - X[A0]) * (Z[B0] - Z[A0])) / 2;
        if (lifted && tag[t] < 3) {
          if (OPAQUE.has(name)) fullOpaque[t] = 1;
          for (let k = 0; k < 3; k++) {
            const by = HA_BASE + rel[3 * t + k];
            if (mn - 0.12 < by) lowerC[3 * t + k] = Math.min(lowerC[3 * t + k], Math.max(mn - 0.12, by - SINK_MAX));
          }
        }
        continue;
      }
      stats.relay.partial++;
      for (const q of qs) {
        const i = q * 9;
        const pc = clipToTri([[a[i] + ox, a[i + 1], a[i + 2] + oz], [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], [a[i + 6] + ox, a[i + 7], a[i + 8] + oz]], ch, t);
        if (pc.length < 3) continue;
        let mn = Infinity;
        for (let k = 1; k + 1 < pc.length; k++) {
          const p0 = pc[0], p1 = pc[k], p2 = pc[k + 1];
          const cr = (p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2]);
          if (Math.abs(cr) < 1e-9) continue;
          areaOut += Math.abs(cr) / 2;
          for (const p of [p0, p1, p2]) {
            const y = p[1] + (lifted ? relAt(ch, t, p[0], p[2]) : 0);
            out.push(p[0] - ox, y, p[2] - oz);
            mn = Math.min(mn, y);
          }
          tout++;
        }
        if (lifted && tag[t] < 3 && mn < Infinity) {
          for (let k = 0; k < 3; k++) {
            const by = HA_BASE + rel[3 * t + k];
            if (mn - 0.12 < by) lowerC[3 * t + k] = Math.min(lowerC[3 * t + k], Math.max(mn - 0.12, by - SINK_MAX));
          }
        }
      }
    }
    // (coverage: what was laid against the level's area; overlapping compiled triangles count twice in areaIn)
    stats.relay.areaErr = Math.max(stats.relay.areaErr, Math.abs(areaOut - areaIn) / Math.max(areaIn, 1e-6));
  }
  return { mask, tout, n };
}

// ---------------------------------------------------------------- P2A: the cut by lifting
// per chunk, once: each vertex's relief, NaN where its corners disagree (a vertex on a slit)
function chunkVerts(ch) {
  if (ch.vrel) return ch.vrel;
  // (outside the region, tag 255, the relief is 0 as 1a's cut takes it: nothing outside moves)
  const r = (c) => (ch.tag[(c / 3) | 0] === 255 ? 0 : ch.rel[c]);
  const v = new Float32Array(ch.nV).fill(NaN), seen = new Uint8Array(ch.nV);
  for (let c = 0; c < 3 * ch.nT; c++) {
    const q = ch.tri[c];
    if (!seen[q]) { seen[q] = 1; v[q] = r(c); } else if (!Number.isNaN(v[q]) && Math.abs(v[q] - r(c)) > 1e-3) v[q] = NaN;
  }
  // (a vertex whose value is NaN after the first pass stays NaN: mark the slit vertices explicitly)
  for (let c = 0; c < 3 * ch.nT; c++) { const q = ch.tri[c]; if (Math.abs(v[q] - r(c)) > 1e-3) v[q] = NaN; }
  ch.vrel = v;
  return v;
}
// the relief at a point, from every TIN triangle holding it; NaN where they disagree (on a slit), 0 off the TIN
function relPoint(ch, x, z) {
  const i = Math.floor((x - ch.ox) / BK), j = Math.floor((z - ch.oz) / BK);
  if (i < 0 || j < 0 || i >= NB || j >= NB) return 0;
  const { off, list, tri, x: X, z: Z, rel } = ch;
  let r = null;
  for (let k = off[j * NB + i], e = off[j * NB + i + 1]; k < e; k++) {
    const t = list[k], a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const d = (Z[b] - Z[c]) * (X[a] - X[c]) + (X[c] - X[b]) * (Z[a] - Z[c]);
    if (Math.abs(d) < 1e-12) continue;
    const w0 = ((Z[b] - Z[c]) * (x - X[c]) + (X[c] - X[b]) * (z - Z[c])) / d;
    const w1 = ((Z[c] - Z[a]) * (x - X[c]) + (X[a] - X[c]) * (z - Z[c])) / d;
    const w2 = 1 - w0 - w1;
    if (w0 < -1e-7 || w1 < -1e-7 || w2 < -1e-7) continue;
    const v = ch.tag[t] === 255 ? 0 : rel[3 * t] * w0 + rel[3 * t + 1] * w1 + rel[3 * t + 2] * w2;
    if (r === null) r = v; else if (Math.abs(r - v) > 1e-3) return NaN;
  }
  return r === null ? 0 : r;
}
// an edge's profile over the TIN, by the edge alone (canonical endpoint order): { slit } or { lin } or { dp: [[s, r] ..] }
// (s from the canonical first endpoint); cached per tile in ctx.edges
// (PERF: ctx.edges holds the edges by a hash of their four coordinates, each bucket a chain of records compared value for
// value; the same edges as a "px,pz,qx,qz" string key: equal numbers, 0 and -0 alike, NaN with NaN)
const EKB = new Float64Array(1), EKU = new Uint32Array(EKB.buffer);
const ekMix = (h, v) => {
  if (v !== v) return Math.imul(h ^ 0x7ff80001, 0x9e3779b1);
  EKB[0] = v + 0;
  h = Math.imul(h ^ EKU[0], 0x9e3779b1);
  return Math.imul(h ^ EKU[1], 0x85ebca6b);
};
const ekEq = (a, b) => a === b || (a !== a && b !== b);
function edgeGet(M, h, px, pz, qx, qz) {
  for (let r = M.get(h); r; r = r.next) if (ekEq(r.px, px) && ekEq(r.pz, pz) && ekEq(r.qx, qx) && ekEq(r.qz, qz)) return r.e;
  return undefined;
}
function edgeInfo(ctx, ax, az, bx, bz) {
  const swap = ax > bx || (ax === bx && az > bz);
  const px = swap ? bx : ax, pz = swap ? bz : az, qx = swap ? ax : bx, qz = swap ? az : bz;
  const key = ekMix(ekMix(ekMix(ekMix(0x811c9dc5, px), pz), qx), qz);
  let e = edgeGet(ctx.edges, key, px, pz, qx, qz);
  if (e) return { e, swap };
  const put = (v) => { ctx.edges.set(key, { px, pz, qx, qz, e: v, next: ctx.edges.get(key) }); };
  const { ch, cand } = ctx, { tri, x: X, z: Z } = ch;
  const dx = qx - px, dz = qz - pz;
  candidates(ch, Math.min(px, qx), Math.min(pz, qz), Math.max(px, qx), Math.max(pz, qz), cand);
  const pr = [];
  for (const t of cand) {
    const a = tri[3 * t], b = tri[3 * t + 1], c = tri[3 * t + 2];
    const sg = Math.sign((X[b] - X[a]) * (Z[c] - Z[a]) - (Z[b] - Z[a]) * (X[c] - X[a])) || 1;
    let s0 = 0, s1 = 1;
    for (let k = 0; k < 3; k++) {
      const u = k === 0 ? a : k === 1 ? b : c, w = k === 0 ? b : k === 1 ? c : a;   // (PERF: the edges (a, b), (b, c), (c, a) without arrays)
      // inside: sg * cross(w - u, p - u) >= 0, linear in s
      const f0 = sg * ((X[w] - X[u]) * (pz - Z[u]) - (Z[w] - Z[u]) * (px - X[u]));
      const f1 = sg * ((X[w] - X[u]) * dz - (Z[w] - Z[u]) * dx);
      if (Math.abs(f1) < 1e-15) { if (f0 < -1e-9) { s1 = -1; break; } continue; }
      const sc = -f0 / f1;
      if (f1 > 0) s0 = Math.max(s0, sc); else s1 = Math.min(s1, sc);
    }
    if (s1 - s0 < -1e-12) continue;
    if (s1 < s0) s1 = s0;
    const out255 = ch.tag[t] === 255;
    pr.push(s0, out255 ? 0 : relAt(ch, t, px + dx * s0, pz + dz * s0), s1, out255 ? 0 : relAt(ch, t, px + dx * s1, pz + dz * s1));
  }
  const n = pr.length / 2;
  if (!n) { e = { lin: true, r0: 0, r1: 0 }; put(e); return { e, swap }; }
  const ord = Array.from({ length: n }, (_, k) => k).sort((u, w) => pr[2 * u] - pr[2 * w]);
  const S = [], R = [];
  let slit = false;
  for (const k of ord) {
    const s = pr[2 * k], r = pr[2 * k + 1];
    if (S.length && s - S[S.length - 1] < 1e-7) { if (Math.abs(r - R[R.length - 1]) > 1e-3) slit = true; continue; }
    S.push(s); R.push(r);
  }
  if (slit || S[0] > 1e-6 || S[S.length - 1] < 1 - 1e-6) { e = { slit: true }; put(e); return { e, swap }; }
  const r0 = R[0], r1 = R[R.length - 1];
  let worst = 0;
  for (let k = 1; k + 1 < S.length; k++) worst = Math.max(worst, Math.abs(R[k] - (r0 + (r1 - r0) * S[k])));
  if (worst <= (ctx.tau || TAU) + 1e-6) { e = { lin: true, r0, r1 }; put(e); return { e, swap }; }
  const keep = new Uint8Array(S.length);
  keep[0] = keep[S.length - 1] = 1;
  const stack = [[0, S.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let bi = -1, bd = (ctx.tau || TAU) + 1e-6;
    for (let k = i0 + 1; k < i1; k++) {
      const d = Math.abs(R[k] - (R[i0] + ((R[i1] - R[i0]) * (S[k] - S[i0])) / (S[i1] - S[i0])));
      if (d > bd) { bd = d; bi = k; }
    }
    if (bi >= 0) { keep[bi] = 1; stack.push([i0, bi], [bi, i1]); }
  }
  const dp = [];
  for (let k = 1; k + 1 < S.length; k++) if (keep[k] && S[k] > 1e-4 && S[k] < 1 - 1e-4) dp.push([S[k], R[k]]);
  e = dp.length ? { dp, r0, r1, worst } : { lin: true, r0, r1 };
  put(e);
  return { e, swap };
}
// the lift at a point of an edge (t from the edge's first point as given), by its canonical line or polyline
function edgeLift(info, t, la, lb) {
  const { e, swap } = info;
  if (!e.dp) return la + (lb - la) * t;
  const s = swap ? 1 - t : t, r0 = swap ? lb : la, r1 = swap ? la : lb;
  let s0 = 0, v0 = r0;
  for (const [sk, rk] of e.dp) {
    if (s <= sk) return v0 + ((rk - v0) * (s - s0)) / Math.max(sk - s0, 1e-12);
    s0 = sk; v0 = rk;
  }
  return v0 + ((r1 - v0) * (s - s0)) / Math.max(1 - s0, 1e-12);
}
// a point's lift (cached: one value per point for every triangle that has it)
function vLift(ctx, x, z) {
  const k = `${x},${z}`;
  let v = ctx.verts.get(k);
  if (v === undefined) { v = relPoint(ctx.ch, x, z); ctx.verts.set(k, v); }
  return v;
}
// One section's triangles cut by lifting (all of them: the flat ones refined, the vertical ones split on their plan
// segment's canonical points). Pushes tile-local [x, y, z] x 3 per triangle to out; returns the count.
function liftCut(name, a, ctx, out, stats) {
  const { ch, ox, oz } = ctx;
  const st = (stats.lift = stats.lift || { emit: 0, refine: 0, split: 0, clip: 0, clipPieces: 0, faces: 0, faceCuts: 0, slitFaces: 0, kept: 0 });
  let tout = 0, buf = [], over = false, budget = 0;
  // (pieces gather in buf: a triangle whose refinement would outgrow its exact cut is cut instead)
  const emit = (P) => { buf.push(P); if (buf.length > budget) over = true; };
  const commit = () => { for (const P of buf) { for (const p of P) out.push(p[0] - ox, p[1] + p[3], p[2] - oz); tout++; st.emit++; ctx.onEmit(P); } buf = []; };
  // 1a's exact pieces, with the triangle's own boundary held to its edges' canonical lines (P: 3 x [x, yFlat, z, lift])
  const clip = (P, plane, E) => {
    st.clip++;
    const x0 = Math.min(P[0][0], P[1][0], P[2][0]), x1 = Math.max(P[0][0], P[1][0], P[2][0]), z0 = Math.min(P[0][2], P[1][2], P[2][2]), z1 = Math.max(P[0][2], P[1][2], P[2][2]);
    const cs = candidates(ch, x0, z0, x1, z1, []);
    const ax = P[0][0], az = P[0][2], bx = P[1][0], bz = P[1][2], cx = P[2][0], cz = P[2][2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    const eL = [0, 1, 2].map((k) => Math.hypot(P[(k + 1) % 3][0] - P[k][0], P[(k + 1) % 3][2] - P[k][2]));
    for (const t of cs) {
      const pc = clipToTri([[ax, 0, az], [bx, 0, bz], [cx, 0, cz]], ch, t);
      if (pc.length < 3) continue;
      const Q = pc.map((p) => {
        const w0 = ((bz - cz) * (p[0] - cx) + (cx - bx) * (p[2] - cz)) / d, w1 = ((cz - az) * (p[0] - cx) + (ax - cx) * (p[2] - cz)) / d, w2 = 1 - w0 - w1;
        const ws = [w0, w1, w2];
        let lift = ch.tag[t] === 255 ? 0 : relAt(ch, t, p[0], p[2]);
        // on edge k (opposite corner k+2; within 0.1 mm): held to that edge's line unless the edge crosses a wall
        for (let k = 0; k < 3; k++) {
          const ia = k, ib = (k + 1) % 3, ic = (k + 2) % 3;
          if ((Math.abs(ws[ic]) * Math.abs(d)) / Math.max(eL[k], 1e-9) > 1e-4) continue;
          if (E[k].e.slit || Number.isNaN(P[ia][3]) || Number.isNaN(P[ib][3])) continue;
          const tt = Math.min(1, Math.max(0, ws[ib] / Math.max(ws[ia] + ws[ib], 1e-12)));
          lift = edgeLift(E[k], tt, P[ia][3], P[ib][3]);
          break;
        }
        return [p[0], plane(p[0], p[2]), p[2], lift];
      });
      for (let k = 1; k + 1 < Q.length; k++) {
        const cr = (Q[k][0] - Q[0][0]) * (Q[k + 1][2] - Q[0][2]) - (Q[k + 1][0] - Q[0][0]) * (Q[k][2] - Q[0][2]);
        if (Math.abs(cr) < 1e-9) continue;
        emit([Q[0], Q[k], Q[k + 1]]);
        st.clipPieces++;
      }
    }
  };
  const proc = (P, plane, depth) => {
    // P: [x, yFlat, z, lift] x 3
    if (over) return;
    const E = [0, 1, 2].map((k) => edgeInfo(ctx, P[k][0], P[k][2], P[(k + 1) % 3][0], P[(k + 1) % 3][2]));
    if (P.some((p) => Number.isNaN(p[3])) || E.some((q) => q.e.slit) || depth > 14) {
      const why = P.some((p) => Number.isNaN(p[3])) ? 'nanV' : E.some((q) => q.e.slit) ? 'slitE' : 'depth';
      (st.why = st.why || {})[why] = (st.why[why] || 0) + 1;
      clip(P, plane, E); return;
    }
    // the TIN's vertices inside: the worst departure
    const ax = P[0][0], az = P[0][2], bx = P[1][0], bz = P[1][2], cx = P[2][0], cz = P[2][2];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-10) return;
    const vr = chunkVerts(ch);
    const cs = candidates(ch, Math.min(ax, bx, cx), Math.min(az, bz, cz), Math.max(ax, bx, cx), Math.max(az, bz, cz), ctx.cand2);
    let worst = (ctx.tau || TAU) + 1e-6, wv = -1, wb = null, slitIn = false;
    const st2 = ++ctx.vstamp;
    for (const t of cs) for (let k = 0; k < 3; k++) {
      const v = ch.tri[3 * t + k];
      if (ctx.vmark[v] === st2) continue;
      ctx.vmark[v] = st2;
      const x = ch.x[v], z = ch.z[v];
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
      if (w0 <= 1e-6 || w1 <= 1e-6 || w2 <= 1e-6) continue;
      if (Number.isNaN(vr[v])) { slitIn = true; break; }
      const dv = Math.abs(vr[v] - (P[0][3] * w0 + P[1][3] * w1 + P[2][3] * w2));
      if (dv > worst) { worst = dv; wv = v; wb = [w0, w1, w2]; }
    }
    if (slitIn) { (st.why = st.why || {}).slitIn = (st.why.slitIn || 0) + 1; clip(P, plane, E); return; }
    // edges with refinement points: a ladder. The apex is the corner opposite the shortest edge; the two edges from it
    // carry their canonical points (u along each, 0 at the apex), and the strip between them is closed by rungs from
    // one chain to the other in order of u, so every new edge crosses the triangle the short way (a long walk strip
    // splits into short pieces, not into slivers that would need points again); the short edge's own points close it
    // with a fan from the last rung's far end
    if (FAN && E.some((q) => q.e.dp)) {
      // (the plain fan, for comparison: from the corner opposite the edge with the most points)
      st.refine++;
      let fe = -1, fn = 0;
      for (let k = 0; k < 3; k++) if (E[k].e.dp && E[k].e.dp.length > fn) { fn = E[k].e.dp.length; fe = k; }
      const A = P[fe], B = P[(fe + 1) % 3], C = P[(fe + 2) % 3], { e, swap } = E[fe];
      const pts = e.dp.map(([s0, r]) => {
        const [qa, qb] = swap ? [B, A] : [A, B];
        const x = qa[0] + (qb[0] - qa[0]) * s0, z = qa[2] + (qb[2] - qa[2]) * s0;
        return [swap ? 1 - s0 : s0, [x, plane(x, z), z, r]];
      }).sort((u, w) => u[0] - w[0]).map((q) => q[1]);
      const chain = [A, ...pts, B];
      for (let k = 0; k + 1 < chain.length; k++) proc([chain[k], chain[k + 1], C], plane, depth + 1);
      return;
    }
    if (E.some((q) => q.e.dp)) {
      st.refine++;
      const len = [0, 1, 2].map((k) => Math.hypot(P[(k + 1) % 3][0] - P[k][0], P[(k + 1) % 3][2] - P[k][2]));
      const sh = len.indexOf(Math.min(...len)), ap = (sh + 2) % 3;              // edge sh = (P[sh], P[sh+1]); apex P[sh+2]
      const A = P[ap], B = P[(ap + 1) % 3], C = P[(ap + 2) % 3];
      // the canonical points of the edge (U, V) as [u from U, point]
      const ptsOn = (k, U, V) => {
        const { e, swap } = E[k];
        if (!e.dp) return [];
        return e.dp.map(([s0, r]) => {
          const [qa, qb] = swap ? [V, U] : [U, V];
          const x = qa[0] + (qb[0] - qa[0]) * s0, z = qa[2] + (qb[2] - qa[2]) * s0;
          return [swap ? 1 - s0 : s0, [x, plane(x, z), z, r]];
        }).sort((u, w) => u[0] - w[0]);
      };
      // edge ap = (A, B), edge (ap + 2) % 3 = (C, A): its points' u from A is 1 - (u from C)
      const L = [[0, A], ...ptsOn(ap, A, B), [1, B]];
      const R = [[0, A], ...ptsOn((ap + 2) % 3, C, A).map(([u, q]) => [1 - u, q]).sort((u, w) => u[0] - w[0]), [1, C]];
      const S = ptsOn(sh, B, C).map((q) => q[1]);
      let li = 1, ri = 1;
      const tris = [[A, L[1][1], R[1][1]]];   // (the apex with each chain's first point, then rung by rung)
      while (li < L.length - 1 || ri < R.length - 1) {
        const advL = ri >= R.length - 1 || (li < L.length - 1 && L[li + 1][0] <= R[ri + 1][0]);
        if (advL) { tris.push([L[li][1], L[li + 1][1], R[ri][1]]); li++; } else { tris.push([L[li][1], R[ri + 1][1], R[ri][1]]); ri++; }
      }
      // tris are wound as (A, B, C); the one holding the short edge (B, C) takes its points as a fan
      for (const T of tris) {
        if (S.length && T.includes(B) && T.includes(C)) {
          // T has B and C: the third vertex X; fan X over B, S..., C in the (A, B, C) winding
          const X = T.find((q) => q !== B && q !== C);
          const chain = [B, ...S, C];
          for (let k = 0; k + 1 < chain.length; k++) proc([X, chain[k], chain[k + 1]], plane, depth + 1);
        } else if (T[0] !== T[1] && T[1] !== T[2] && T[0] !== T[2]) proc(T, plane, depth + 1);
      }
      return;
    }
    if (wv < 0) { emit(P); return; }
    if (Math.min(...wb) < 1e-3) { (st.why = st.why || {}).degen = (st.why.degen || 0) + 1; clip(P, plane, E); return; }
    st.split++;
    const V = [ch.x[wv], plane(ch.x[wv], ch.z[wv]), ch.z[wv], vr[wv]];
    proc([P[0], P[1], V], plane, depth + 1);
    proc([P[1], P[2], V], plane, depth + 1);
    proc([P[2], P[0], V], plane, depth + 1);
  };
  for (let i = 0; i + 8 < a.length; i += 9) {
    const A = [a[i] + ox, a[i + 1], a[i + 2] + oz], B = [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], C = [a[i + 6] + ox, a[i + 7], a[i + 8] + oz];
    const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]), z0 = Math.min(A[2], B[2], C[2]), z1 = Math.max(A[2], B[2], C[2]);
    let inR = !(x1 < RBOX[0] || x0 > RBOX[2] || z1 < RBOX[1] || z0 > RBOX[3]);
    if (inR) { candidates(ch, x0, z0, x1, z1, ctx.cand); inR = ctx.cand.some((t) => ch.tag[t] !== 255); }
    if (!inR) { for (let k = 0; k < 9; k++) out.push(a[i + k]); tout++; st.kept++; ctx.onEmit(null, a, i); continue; }
    const area2 = (B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]);
    if (Math.abs(area2) < 1e-3) {
      // a vertical face: split on its plan segment's canonical points, each point lifted by the segment's line
      st.faces++;
      const V = [A, B, C];
      let Pp = A, Qq = B, best = -1;
      for (const [u, w] of [[A, B], [B, C], [C, A]]) { const dd = (u[0] - w[0]) ** 2 + (u[2] - w[2]) ** 2; if (dd > best) { best = dd; Pp = u; Qq = w; } }
      const L2 = best > 1e-12 ? best : 1;
      const tOf = (p) => Math.min(1, Math.max(0, ((p[0] - Pp[0]) * (Qq[0] - Pp[0]) + (p[2] - Pp[2]) * (Qq[2] - Pp[2])) / L2));
      const info = edgeInfo(ctx, Pp[0], Pp[2], Qq[0], Qq[2]);
      const lP = vLift(ctx, Pp[0], Pp[2]), lQ = vLift(ctx, Qq[0], Qq[2]);
      let cuts = [], liftOf;
      if (info.e.slit || Number.isNaN(lP) || Number.isNaN(lQ)) {
        // across a wall: 1a's pieces (every TIN crossing), each lifted by the TIN triangle under its middle
        st.slitFaces++;
        const cs = new Set();
        candidates(ch, x0, z0, x1, z1, ctx.cand);
        for (const t of ctx.cand) for (const p of clipToTri([[Pp[0], 0, Pp[2]], [Qq[0], 0, Qq[2]], [Qq[0], 0, Qq[2]]], ch, t)) { const s = tOf(p); if (s > 1e-6 && s < 1 - 1e-6) cs.add(Math.round(s * 1e6) / 1e6); }
        cuts = [...cs].sort((u, w) => u - w);
        liftOf = (s, sm) => { const x = Pp[0] + (Qq[0] - Pp[0]) * sm, z = Pp[2] + (Qq[2] - Pp[2]) * sm, t = locate(ch, x, z); return t >= 0 && ch.tag[t] !== 255 ? relAt(ch, t, Pp[0] + (Qq[0] - Pp[0]) * s, Pp[2] + (Qq[2] - Pp[2]) * s) : 0; };
      } else {
        if (info.e.dp) cuts = info.e.dp.map(([s]) => (info.swap ? 1 - s : s)).sort((u, w) => u - w);
        liftOf = (s) => edgeLift(info, s, lP, lQ);
      }
      st.faceCuts += cuts.length;
      let pieces = [V.map((p) => [tOf(p), p[1]])];
      for (const c of cuts) {
        const nx = [];
        for (const pc of pieces) {
          const lo = [], hi = [];
          for (let k = 0; k < pc.length; k++) {
            const p = pc[k], q = pc[(k + 1) % pc.length], dp = p[0] - c, dq = q[0] - c;
            if (dp <= 0) lo.push(p);
            if (dp >= 0) hi.push(p);
            if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const r = dp / (dp - dq), I = [c, p[1] + (q[1] - p[1]) * r]; lo.push(I); hi.push(I); }
          }
          if (lo.length >= 3) nx.push(lo);
          if (hi.length >= 3) nx.push(hi);
        }
        pieces = nx;
      }
      for (const pc of pieces) {
        let sm = 0;
        for (const p of pc) sm += p[0];
        sm /= pc.length;
        for (let k = 1; k + 1 < pc.length; k++) {
          for (const p of [pc[0], pc[k], pc[k + 1]]) out.push(Pp[0] + (Qq[0] - Pp[0]) * p[0] - ox, p[1] + liftOf(p[0], sm), Pp[2] + (Qq[2] - Pp[2]) * p[0] - oz);
          tout++;
        }
      }
      continue;
    }
    // the flat-compile plane of the triangle (its own y at any point, for the refinement points)
    const dd = (B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]);
    const plane = (x, z) => {
      const w0 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / dd, w1 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / dd;
      return A[1] * w0 + B[1] * w1 + C[1] * (1 - w0 - w1);
    };
    const P0 = [A, B, C].map((p) => [p[0], p[1], p[2], vLift(ctx, p[0], p[2])]);
    budget = Math.max(4, candidates(ch, x0, z0, x1, z1, ctx.cand).length);
    buf = []; over = false;
    proc(P0, plane, 0);
    if (over) {
      st.overBudget = (st.overBudget || 0) + 1;
      buf = []; over = false; budget = Infinity;
      clip(P0, plane, [0, 1, 2].map((k) => edgeInfo(ctx, P0[k][0], P0[k][2], P0[(k + 1) % 3][0], P0[(k + 1) % 3][2])));
    }
    commit();
  }
  return tout;
}

// ---------------------------------------------------------------- P2A: the shoreline's bulkheads
// The compile's bulkheads (compile.mjs 'shoreline bulkheads', in the curb soup): a face from y -2.6 under the water plane
// up to the land grade + 0.55, a cap band from its seaward lip 0.45 m inland and a skirt 1.6 m down behind it. Cut like the
// kerbs they took the relief under their own plan points, which falls to 0 across the 3 m of water in front of the shore
// (the tie leaves the shore within +-0.8 m of the datum), so a parapet stood up to 0.8 m short of the land behind it or
// buried. Each wall piece is lifted as one by the land's relief 2 m behind its cap (the drawn land there), the face's foot
// held 0.5 m or more under the water plane. Returns { keep (the curb soup without the bulkheads), out (them, lifted) }.
// a vertical compiled face with the region's land (TIN tag 0-2, relief known) 6 m out on both sides (water is tag 3 from 3 m off land)
function limitFace(a, i, ox, oz) {
  const LL = MAN && MAN.landLimits;
  if (!LL) return false;
  const pts = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 2]]);
  const px = pts[0][0] + ox, pz = pts[0][1] + oz;
  // (only by a land limit the data names: manifest.landLimits, world polylines, within 150 m)
  let near = false;
  for (const L of LL) for (let j = 0; j + 1 < L.length && !near; j++) {
    const [x0, z0] = L[j], [x1, z1] = L[j + 1], dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz || 1e-9)));
    if (Math.hypot(x0 + dx * t - px, z0 + dz * t - pz) < 150) near = true;
  }
  if (!near) return false;
  let ux = 0, uz = 0, best = 0;
  for (let m = 0; m < 3; m++) for (let n = m + 1; n < 3; n++) { const dx = pts[n][0] - pts[m][0], dz = pts[n][1] - pts[m][1], L = Math.hypot(dx, dz); if (L > best) { best = L; ux = dx / L; uz = dz / L; } }
  if (best < 0.2) return false;
  const cx = (pts[0][0] + pts[1][0] + pts[2][0]) / 3 + ox, cz = (pts[0][1] + pts[1][1] + pts[2][1]) / 3 + oz;
  const land = (x, z) => { const q = haInfo(x, z); return !!q && q.tag <= 2 && q.relief !== null && !Number.isNaN(q.relief); };
  return land(cx - uz * 6, cz + ux * 6) && land(cx + uz * 6, cz - ux * 6);
}
function shoreLift(a, ch, ox, oz, stats) {
  const st = (stats.shore = { faces: 0, caps: 0, skirts: 0, liftMin: Infinity, liftMax: -Infinity, parapetMin: Infinity, parapetMax: -Infinity });
  const key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const nT = (a.length / 9) | 0, role = new Uint8Array(nT);
  const vert = (i) => Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-3;
  const outer = new Set();
  for (let q = 0; q < nT; q++) {
    const i = q * 9;
    if (!vert(i) || Math.min(a[i + 1], a[i + 4], a[i + 7]) > -2.5) continue;
    // (five boroughs: the compile's bulkhead along a land city limit (it took the outside for water) is no shore where the
    // region's ground goes on past it, the soft edge past Westchester and Nassau: the face goes, its cap stays as ground)
    if (limitFace(a, i, ox, oz)) { role[q] = 9; st.limitFaces = (st.limitFaces || 0) + 1; continue; }
    role[q] = 1;
    for (let k = 0; k < 3; k++) outer.add(key(a[i + 3 * k] + ox, a[i + 3 * k + 2] + oz));
  }
  if (!outer.size) return null;
  const lift = new Map();   // plan key -> the land's relief behind
  const inner = new Set(), probes = [];
  for (let q = 0; q < nT; q++) {
    const i = q * 9;
    if (role[q] || vert(i)) continue;
    const P = [0, 1, 2].map((k) => [a[i + 3 * k] + ox, a[i + 3 * k + 1], a[i + 3 * k + 2] + oz]);
    const o = P.filter((p) => outer.has(key(p[0], p[2]))), n = P.filter((p) => !outer.has(key(p[0], p[2])));
    if (!o.length || !n.length) continue;
    role[q] = 2;
    // the cap: seaward lip (outer) to the land line (inner, 0.45 m in); the land 2 m behind the inner line
    const ox_ = o.reduce((s, p) => s + p[0], 0) / o.length, oz_ = o.reduce((s, p) => s + p[2], 0) / o.length;
    const ix = n.reduce((s, p) => s + p[0], 0) / n.length, iz = n.reduce((s, p) => s + p[2], 0) / n.length;
    const L = Math.hypot(ix - ox_, iz - oz_) || 1;
    for (const p of n) {
      const r = haRelief(p[0] + ((ix - ox_) / L) * 1.55, p[2] + ((iz - oz_) / L) * 1.55);
      // (held to the tie's own reach, 3.2 m: past it the land behind is a deck over a shore road, Carl Schurz Park's or
      // Sutton Place's over the FDR, a structure, and the wall stays by the water)
      const v = r === null || Number.isNaN(r) ? 0 : Math.max(-3.2, Math.min(3.2, r));
      inner.add(key(p[0], p[2]));
      lift.set(key(p[0], p[2]), v);
      // (for the check after the cut: the cap's land line, its lifted height and the way inland)
      probes.push([p[0], p[2], p[1] + v, (ix - ox_) / L, (iz - oz_) / L]);
    }
  }
  // an outer point takes the lift of the cap's inner point(s) beside it: the mean over the caps that hold it
  const acc = new Map();
  for (let q = 0; q < nT; q++) {
    if (role[q] !== 2) continue;
    const i = q * 9, ks = [0, 1, 2].map((k) => key(a[i + 3 * k] + ox, a[i + 3 * k + 2] + oz));
    const ins = ks.filter((k) => lift.has(k)).map((k) => lift.get(k));
    if (!ins.length) continue;
    const m = ins.reduce((s, v) => s + v, 0) / ins.length;
    for (const k of ks) if (outer.has(k)) { const e = acc.get(k) || [0, 0]; e[0] += m; e[1]++; acc.set(k, e); }
  }
  for (const [k, [s, c]] of acc) lift.set(k, s / c);
  for (let q = 0; q < nT; q++) {
    const i = q * 9;
    if (role[q] || !vert(i)) continue;
    if ([0, 1, 2].every((k) => inner.has(key(a[i + 3 * k] + ox, a[i + 3 * k + 2] + oz)))) role[q] = 3;
  }
  const keep = [], out = [];
  for (let q = 0; q < nT; q++) {
    const i = q * 9;
    if (!role[q]) { for (let k = 0; k < 9; k++) keep.push(a[i + k]); continue; }
    if (role[q] === 9) continue;
    if (role[q] === 1) st.faces++; else if (role[q] === 2) st.caps++; else st.skirts++;
    for (let k = 0; k < 3; k++) {
      const x = a[i + 3 * k], y = a[i + 3 * k + 1], z = a[i + 3 * k + 2], kk = key(x + ox, z + oz);
      let l = lift.get(kk);
      if (l === undefined) { const r = haRelief(x + ox, z + oz); l = r === null || Number.isNaN(r) ? 0 : Math.max(-3.2, Math.min(3.2, r)); }
      st.liftMin = Math.min(st.liftMin, l); st.liftMax = Math.max(st.liftMax, l);
      out.push(x, y < -2.0 ? Math.min(-0.5, y + l) : y + l, z);
    }
  }
  // the parapet: each cap's inner edge over the drawn land 2 m behind it (the land's own lift; flat compile 3.385-3.5)
  for (const [k, l] of lift) if (inner.has(k)) { st.parapetMin = Math.min(st.parapetMin, l); st.parapetMax = Math.max(st.parapetMax, l); }
  if (!SHORE_PIECES) {
    const sp = shoreSplines(a, role, lift, ox, oz, st);
    if (sp) return { keep: Float32Array.from(keep), out: sp.out, probes: sp.probes, vst: sp.vst, stn: sp.stn };
  }
  return { keep: Float32Array.from(keep), out, probes };
}
// TERRAIN FIX: the shore's walls as one swept wall per run. The compile emits a bulkhead per land-ring edge (7 m pieces,
// each edge pushed 0.9-3.4 m seaward by its own probe and stretched 2.6 m past its ends), so neighbouring pieces stand at
// different offsets, cross at the corners and step at every joint; lifted one by one, their caps stepped too. Here the
// pieces' outer face lines are chained into runs (an end meets the next piece within 4 m, heading within 60 deg), each
// run resampled every metre and smoothed (Gaussian, 4 m, its ends held) into one curve, its top (each piece's own top
// plus the land's lift behind it) smoothed along it (6 m), and one profile swept along it: the face from 2.6 m
// under the water plane to the top, the cap as wide as the compiled caps (smoothed), the skirt 1.6 m down into the land behind. `?shoreSpline=0` /
// TERRAIN_SHORE_SPLINE=0: the pieces, lifted, as before.
const SHORE_PIECES = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('shoreSpline') === '0') || (typeof process !== 'undefined' && process.env && process.env.TERRAIN_SHORE_SPLINE === '0');
function shoreSplines(a, role, lift, ox, oz, st) {
  const nT = (a.length / 9) | 0, key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  // the face segments: a vertical face triangle's two plan points, the top over each
  const top = new Map(), segs = new Map();
  for (let q = 0; q < nT; q++) {
    if (role[q] !== 1) continue;
    const i = q * 9, P = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 1], a[i + 3 * k + 2]]);
    const ks = [];
    for (const p of P) {
      const k = key(p[0] + ox, p[2] + oz);
      if (p[1] > -2) top.set(k, Math.max(top.get(k) ?? -Infinity, p[1] + (lift.get(k) ?? 0)));
      if (!ks.some((e) => e[0] === k)) ks.push([k, p[0], p[2]]);
    }
    if (ks.length === 2) { const [u, w] = ks[0][0] < ks[1][0] ? ks : [ks[1], ks[0]]; segs.set(u[0] + '|' + w[0], [u[1], u[2], w[1], w[2], u[0], w[0]]); }
  }
  // the seaward side of each face point: from the caps (outer lip -> inner line is inland)
  const inl = new Map();
  for (let q = 0; q < nT; q++) {
    if (role[q] !== 2) continue;
    const i = q * 9, P = [0, 1, 2].map((k) => [a[i + 3 * k], a[i + 3 * k + 2], key(a[i + 3 * k] + ox, a[i + 3 * k + 2] + oz)]);
    const o = P.filter((p) => top.has(p[2])), n = P.filter((p) => !top.has(p[2]));
    if (!o.length || !n.length) continue;
    const ix = n.reduce((s, p) => s + p[0], 0) / n.length, iz = n.reduce((s, p) => s + p[1], 0) / n.length;
    for (const p of o) { const e = inl.get(p[2]) || [0, 0, 0]; e[0] += ix - p[0]; e[1] += iz - p[1]; e[2]++; inl.set(p[2], e); }
  }
  // orient every segment with the land on its left
  const S = [];
  for (const [ax, az, bx, bz, ka, kb] of segs.values()) {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) continue;
    const e = [inl.get(ka) || [0, 0, 0], inl.get(kb) || [0, 0, 0]], ix = e[0][0] + e[1][0], iz = e[0][1] + e[1][1];
    const left = -(bz - az) * ix + (bx - ax) * iz > 0;   // (left of a -> b is (-dz, dx))
    // (the cap's width: the compiled cap's, from the face to 0.45 m behind the land's edge)
    const wa = e[0][2] ? Math.min(4.5, Math.max(0.6, Math.hypot(e[0][0], e[0][1]) / e[0][2])) : 1.5, wb = e[1][2] ? Math.min(4.5, Math.max(0.6, Math.hypot(e[1][0], e[1][1]) / e[1][2])) : 1.5;
    S.push(left ? { a: [ax, az, top.get(ka) ?? 0, wa], b: [bx, bz, top.get(kb) ?? 0, wb], L } : { a: [bx, bz, top.get(kb) ?? 0, wb], b: [ax, az, top.get(ka) ?? 0, wa], L });
  }
  if (!S.length) return null;
  // chain: from a run's end, the next segment is the one whose start lies nearest (4 m) with a heading within 60 deg
  const used = new Uint8Array(S.length), H = new Map(), C = 4;
  S.forEach((g, k) => { const hk = `${Math.floor(g.a[0] / C)},${Math.floor(g.a[1] / C)}`; let l = H.get(hk); if (!l) H.set(hk, (l = [])); l.push(k); });
  const dir = (g) => [(g.b[0] - g.a[0]) / g.L, (g.b[1] - g.a[1]) / g.L];
  const next = (g, fwd) => {
    const p = fwd ? g.b : g.a, d = dir(g);
    let best = -1, bd = 4;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const k of H.get(`${Math.floor(p[0] / C) + di},${Math.floor(p[1] / C) + dj}`) || []) {
      if (used[k]) continue;
      const h = S[k], e = dir(h);
      if (d[0] * e[0] + d[1] * e[1] < 0.5) continue;
      const q = fwd ? h.a : h.b, dd = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (dd < bd) { bd = dd; best = k; }
    }
    return best;
  };
  // (a backward search needs the segments by their ends too)
  const HE = new Map();
  S.forEach((g, k) => { const hk = `${Math.floor(g.b[0] / C)},${Math.floor(g.b[1] / C)}`; let l = HE.get(hk); if (!l) HE.set(hk, (l = [])); l.push(k); });
  const prevSeg = (g) => {
    const p = g.a, d = dir(g);
    let best = -1, bd = 4;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const k of HE.get(`${Math.floor(p[0] / C) + di},${Math.floor(p[1] / C) + dj}`) || []) {
      if (used[k]) continue;
      const h = S[k], e = dir(h);
      if (d[0] * e[0] + d[1] * e[1] < 0.5) continue;
      const dd = Math.hypot(h.b[0] - p[0], h.b[1] - p[1]);
      if (dd < bd) { bd = dd; best = k; }
    }
    return best;
  };
  const runs = [];
  for (let k0 = 0; k0 < S.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const run = [k0];
    for (let g = S[k0], k; (k = next(g, true)) >= 0; g = S[k]) { used[k] = 1; run.push(k); }
    for (let g = S[k0], k; (k = prevSeg(g)) >= 0; g = S[k]) { used[k] = 1; run.unshift(k); }
    runs.push(run);
  }
  // each run: the polyline of its segments (an overlapping piece's start is projected past the previous end), resampled
  // every metre, smoothed; the top smoothed along it
  const out = [], probes = [];
  let maxTurn = 0, nRuns = 0;
  const curves = [], vst = [], stn = [];   // (per out vertex its station or -1; per station: cap line x, z, inland nx, nz, cap y, run)
  let turnsOver = 0;   // (stations turning more than 20 deg in their metre)
  const OV = new Map();   // (the overlap check: run points 2 m or more from their run's ends, by 1 m cell)
  const gauss = (v, sig, hold) => {
    const n = v.length, r = Math.ceil(2.5 * sig), o = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      // (the window shrinks toward the ends, which stay where they are)
      const rr = hold ? Math.min(r, i, n - 1 - i) : r;
      let s = 0, w = 0;
      for (let j = -rr; j <= rr; j++) { const k = Math.min(n - 1, Math.max(0, i + j)), ww = Math.exp(-(j * j) / (2 * sig * sig)); s += v[k] * ww; w += ww; }
      o[i] = s / w;
    }
    return o;
  };
  for (const run of runs) {
    const pts = [];
    for (const k of run) {
      const g = S[k];
      if (pts.length) {
        const p = pts[pts.length - 1], d = dir(g);
        // (skip the part of this piece that doubles back over the previous end)
        const t0 = Math.max(0, (p[0] - g.a[0]) * d[0] + (p[1] - g.a[1]) * d[1]);
        if (t0 >= g.L - 0.05) continue;
        const f = t0 / g.L;
        pts.push([g.a[0] + (g.b[0] - g.a[0]) * f, g.a[1] + (g.b[1] - g.a[1]) * f, g.a[2] + (g.b[2] - g.a[2]) * f, g.a[3] + (g.b[3] - g.a[3]) * f]);
      } else pts.push(g.a.slice());
      pts.push(g.b.slice());
    }
    // resample every metre along the polyline
    let tot = 0;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) { tot += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); cum.push(tot); }
    if (tot < 1.5) continue;
    const n = Math.max(2, Math.round(tot) + 1), X = new Float64Array(n), Z = new Float64Array(n), Y = new Float64Array(n), W = new Float64Array(n);
    for (let i = 0, j = 0; i < n; i++) {
      const s = (tot * i) / (n - 1);
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      const f = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
      X[i] = pts[j][0] + (pts[j + 1][0] - pts[j][0]) * f; Z[i] = pts[j][1] + (pts[j + 1][1] - pts[j][1]) * f; Y[i] = pts[j][2] + (pts[j + 1][2] - pts[j][2]) * f; W[i] = pts[j][3] + (pts[j + 1][3] - pts[j][3]) * f;
    }
    const Xs = gauss(X, 6, true), Zs = gauss(Z, 6, true);
    // (where the curve still turns more than 18 deg in a metre, a pier's corner or a run's last metres where the window
    // shrinks: relaxed toward its neighbours, the ends held, until it turns less)
    const head = (i) => Math.atan2(Zs[Math.min(n - 1, i + 1)] - Zs[Math.max(0, i - 1)], Xs[Math.min(n - 1, i + 1)] - Xs[Math.max(0, i - 1)]);
    for (let it = 0; it < 60; it++) {
      let moved = 0;
      for (let i = 1; i < n - 1; i++) {
        let d = Math.abs(head(i + 1 < n ? i : i) - head(i - 1)); if (d > Math.PI) d = 2 * Math.PI - d;
        let d2 = Math.abs(head(Math.min(n - 1, i + 1)) - head(i)); if (d2 > Math.PI) d2 = 2 * Math.PI - d2;
        if (Math.max(d, d2) * 180 / Math.PI > 18) { Xs[i] = 0.5 * Xs[i] + 0.25 * (Xs[i - 1] + Xs[i + 1]); Zs[i] = 0.5 * Zs[i] + 0.25 * (Zs[i - 1] + Zs[i + 1]); moved++; }
      }
      if (!moved) break;
    }
    curves.push({ n, Xs, Zs, Ws: gauss(W, 4, true) });
  }
  // the longest first; a later run keeps only its points 0.8 m or more from the runs already laid (the compile's
  // doubled pieces at corners and joints become one wall)
  curves.sort((u, w) => w.n - u.n);
  const ACC = new Map(), near = (x, z) => { const i = Math.floor(x), j = Math.floor(z); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const [px, pz] of ACC.get(`${i + di},${j + dj}`) || []) if ((px - x) ** 2 + (pz - z) ** 2 < 0.64) return true; return false; };
  for (const { n, Xs, Zs, Ws } of curves) {
    const keepP = new Uint8Array(n);
    for (let i = 0; i < n; i++) keepP[i] = near(Xs[i], Zs[i]) ? 0 : 1;
    for (let i = 0; i < n; i++) if (keepP[i]) { const hk = `${Math.floor(Xs[i])},${Math.floor(Zs[i])}`; let l = ACC.get(hk); if (!l) ACC.set(hk, (l = [])); l.push([Xs[i], Zs[i]]); }
    nRuns++;
    for (let i = 2; i < n - 2; i++) { if (!keepP[i]) continue; const hk = `${Math.floor(Xs[i])},${Math.floor(Zs[i])}`; let l = OV.get(hk); if (!l) OV.set(hk, (l = [])); l.push(nRuns, Xs[i], Zs[i]); }
    // tangents, the inland normal (left), the heading change per metre
    const NX = new Float64Array(n), NZ = new Float64Array(n);
    let ph = null;
    for (let i = 0; i < n; i++) {
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1), tx = Xs[i1] - Xs[i0], tz = Zs[i1] - Zs[i0], L = Math.hypot(tx, tz) || 1;
      NX[i] = -tz / L; NZ[i] = tx / L;
      const h = Math.atan2(tz, tx);
      if (ph !== null && keepP[i] && keepP[i - 1]) { let d = Math.abs(h - ph); if (d > Math.PI) d = 2 * Math.PI - d; maxTurn = Math.max(maxTurn, (d * 180) / Math.PI); if (d * 180 / Math.PI > 20) turnsOver++; }
      ph = h;
    }
    // the top: 0.45 m over the esplanade's flat level (3.52) plus the land's relief 1.55 m behind the cap, smoothed along
    // the run (6 m) and never more than 0.15 m under the land's own at a station (the land behind is not buried)
    const R = new Float64Array(n);
    for (let i = 0; i < n; i++) { const r = haRelief(Xs[i] + ox + NX[i] * (Ws[i] + 1.55), Zs[i] + oz + NZ[i] * (Ws[i] + 1.55)); R[i] = r === null || Number.isNaN(r) ? 0 : Math.max(-3.2, Math.min(3.2, r)); }
    const Rs = gauss(R, 3, false), Ys = new Float64Array(n);
    for (let i = 0; i < n; i++) Ys[i] = 3.97 + Math.max(Rs[i], R[i] - 0.15);
    const lo = () => -2.6;
    const q = (A, B, Cc, D, sa, sb, sc, sd) => { out.push(...A, ...B, ...Cc, ...A, ...Cc, ...D); vst.push(sa, sb, sc, sa, sc, sd); };
    const s0 = stn.length / 6;
    for (let i = 0; i < n; i++) stn.push(Xs[i] + NX[i] * Ws[i] + ox, Zs[i] + NZ[i] * Ws[i] + oz, NX[i], NZ[i], Ys[i] - 0.04, nRuns);
    for (let i = 0; i + 1 < n; i++) {
      if (!keepP[i] || !keepP[i + 1]) continue;
      const f0 = [Xs[i], Ys[i], Zs[i]], f1 = [Xs[i + 1], Ys[i + 1], Zs[i + 1]];
      const b0 = [Xs[i], lo(i), Zs[i]], b1 = [Xs[i + 1], lo(i + 1), Zs[i + 1]];
      const c0 = [Xs[i] + NX[i] * Ws[i], Ys[i] - 0.04, Zs[i] + NZ[i] * Ws[i]], c1 = [Xs[i + 1] + NX[i + 1] * Ws[i + 1], Ys[i + 1] - 0.04, Zs[i + 1] + NZ[i + 1] * Ws[i + 1]];
      const k0 = [c0[0], Ys[i] - 1.6, c0[2]], k1 = [c1[0], Ys[i + 1] - 1.6, c1[2]];
      const u = s0 + i, w = s0 + i + 1;
      q(f0, f1, b1, b0, u, w, -1, -1);          // the face (seaward)
      q(c0, c1, f1, f0, u, w, w, u);            // the cap
      q(k0, k1, c1, c0, u, w, w, u);            // the skirt (inland)
      // (shoreCheck: the cap's land line, its height, inland)
      if (i % 2 === 0) probes.push([c0[0] + ox, c0[2] + oz, c0[1], NX[i], NZ[i]]);
    }
  }
  // two runs' faces within 0.5 m of each other (not at their ends): an overlap
  let ov = 0;
  for (const [hk, l] of OV) {
    const [ci, cj] = hk.split(',').map(Number);
    for (let k = 0; k < l.length; k += 3) {
      let hit = false;
      for (let di = -1; di <= 1 && !hit; di++) for (let dj = -1; dj <= 1 && !hit; dj++) { const m = OV.get(`${ci + di},${cj + dj}`); if (m) for (let e = 0; e < m.length; e += 3) if (m[e] !== l[k] && Math.hypot(m[e + 1] - l[k + 1], m[e + 2] - l[k + 2]) < 0.5) { hit = true; break; } }
      if (hit) ov++;
    }
  }
  st.splineRuns = nRuns; st.splineSegs = S.length; st.maxTurnPerM = +maxTurn.toFixed(2); st.overlapPts = ov; st.turnsOver20 = turnsOver;
  return { out, probes, vst, stn };
}
// After the cut: each bulkhead's parapet over the drawn land 1.5 m behind its cap (the flat compile's is 0.4-0.5 m): a
// parapet under 0.05 m is buried by the land, one over 1.2 m stands proud of it (floating); the face's foot is under the
// water plane by construction
function shoreCheck(tile, ox, oz, probes, stats) {
  const st = stats.shore;
  if (!st || !probes || !probes.length) return;
  const top = topSampler(tile, [...TOP_KINDS.filter((k) => k !== 'curb'), 'terrP1']);   // (the land: not another wall's cap)
  const P = [];
  let buried = 0, floating = 0, none = 0;
  for (const [x, z, y, dx, dz] of probes) {
    const qx = x + dx * 1.5 - ox, qz = z + dz * 1.5 - oz;
    const t = top(qx, qz, y - 6, y + 2);
    if (!t) { none++; continue; }
    const h = y - t.y;
    P.push(h);
    if (h < 0.05) { buried++; if ((st.buriedAt = st.buriedAt || []).length < 4) st.buriedAt.push([+x.toFixed(1), +z.toFixed(1), +h.toFixed(2), t.kind]); } else if (h > 1.2) floating++;
  }
  P.sort((a, b) => a - b);
  const q = (f) => (P.length ? +P[Math.min(P.length - 1, Math.floor(f * P.length))].toFixed(3) : null);
  Object.assign(st, { parapets: P.length, parapetP05: q(0.05), parapetP50: q(0.5), parapetP95: q(0.95), parapetMinM: P.length ? +P[0].toFixed(3) : null, parapetMaxM: P.length ? +P[P.length - 1].toFixed(3) : null, buried, floating, noLandBehind: none });
}

// ---------------------------------------------------------------- P2A: the slits' faces
// Every slit (the ground discontinuous along a wall line: the TIN edges whose two triangles disagree at an end) gets a
// vertical face from the lower side's base up to the higher side's drawn top (its lifted section there, else its base),
// so no wall is an open gap: tile.S.terrWall (masonry and concrete: planimetric and OSM retaining walls, walls traced from
// the LiDAR in streets, plazas, yards and park terraces; the ground shader's board-formed concrete, matId 21) and
// tile.S.terrRock (OSM cliffs, and traced runs most of whose edges have natural ground on both sides and steep ground
// beside them, Morningside's and Inwood's outcrops: the terrain material, which a vertical face turns to schist; one
// material along a run; and the part of a wall standing over 5 m above natural ground more than 4 m under its top: the
// cliff under Morningside Drive's wall). A face is left out where
// a compiled vertical face already closes the step (a kerb along a ramp's edge). A masonry wall whose top is walkable
// paving with a drop of 0.4 m or more gets a coping cap (0.3 m wide, 4 cm proud). World-aligned shading, no UVs.
const WALL_ROCK_SRC = /:(cliff|rock|bare_rock)$/;
// P2C: built walls, opt-in (`?terrainWalls=p2c` / TERRAIN_P1_WALLS=p2c): masonry meshes in the library's stone with UVs
// and weathering, copings, parapets and the OSM flights as stairs. Off: the P2A faces in the ground mesh (the look is the
// art pass's; the walls' lines, straight and merged, come from the ground product either way)
const WALLS_P2C = (() => {
  if (isNode) return typeof process !== 'undefined' && process.env.TERRAIN_P1_WALLS === 'p2c';
  try { return new URLSearchParams(location.search).get('terrainWalls') === 'p2c'; } catch { return false; }
})();
export const HA_WALLS_P2C = WALLS_P2C;
const WALK_KINDS = new Set(['sidewalk', 'path', 'plaza', 'brick', 'gravel']);
const NATURAL_KINDS = new Set(['grass', 'grassU', 'path', 'gravel']);
const TOP_KINDS = HA_GROUND;   // (every ground section a tile draws: a rail cut's wall top is a top too)
function chunkSlits(ch) {
  if (ch.slits) return ch.slits;
  const m = new Map(), out = [];
  const { tri, rel, tag, nV } = ch;
  for (let t = 0; t < ch.nT; t++) {
    if (tag[t] >= 3) continue;
    for (let k = 0; k < 3; k++) {
      const u = tri[3 * t + k], v = tri[3 * t + (k + 1) % 3], ru = rel[3 * t + k], rv = rel[3 * t + (k + 1) % 3];
      const key = u < v ? u * nV + v : v * nV + u;
      const o = m.get(key);
      if (!o) { m.set(key, [t, u, ru, rv]); continue; }
      m.delete(key);
      const [t1, u1, a, b] = o;
      const r1u = u1 === u ? a : b, r1v = u1 === u ? b : a;
      if (Math.abs(r1u - ru) > 1e-3 || Math.abs(r1v - rv) > 1e-3) out.push({ u, v, t1, t2: t, r1u, r1v, r2u: ru, r2v: rv });
    }
  }
  ch.slits = out;
  return out;
}
let WALLS = null;     // [{ c: 'rock' | 'mas' | 'trace', xz, stone: 'schist' | 'granite' | null }] from walls.json (haInit)
let STAIRS = null;    // P2C: [{ xz: [[x, z] ...], w: width or NaN }] per OSM flight (stairs.json)
const wallClassOf = (src) => (src.startsWith('osm:') ? (WALL_ROCK_SRC.test(src) ? 'rock' : 'mas') : src.startsWith('plan:') ? 'mas' : 'trace');
// a bucketed sampler over triangle soups (tile-local): the highest non-vertical triangle at (x, z) within [lo, hi]
function topSampler(tile, names) {
  const B = new Map(), src = [];
  for (const n of names) {
    const a = tile.S[n];
    if (!a) continue;
    const si = src.length;
    src.push([n, a]);
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-6) continue;
      const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 2), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 2);
      const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 2), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 2);
      if (i1 - i0 > 40 || j1 - j0 > 40) {
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(si, i); }
        continue;
      }
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(si, i); }
    }
  }
  return (x, z, lo, hi) => {
    const l = B.get(Math.floor(z / 2) * 4096 + Math.floor(x / 2));
    let best = null, kind = null;
    if (!l) return null;
    for (let q = 0; q < l.length; q += 2) {
      const [n, a] = src[l[q]], i = l[q + 1];
      const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const y = w0 * a[i + 1] + w1 * a[i + 4] + w2 * a[i + 7];
      if (y < lo || y > hi) continue;
      if (best === null || y > best) { best = y; kind = n; }
    }
    return best === null ? null : { y: best, kind };
  };
}
// the compiled vertical faces (kerbs, rail cut walls) after the cut: plan segments with their y span, 2 m buckets
function faceIndex(tile, names) {
  const B = new Map(), F = [];
  for (const n of names) {
    const a = tile.S[n];
    if (!a) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) >= 1e-3) continue;
      let P = null, Q = null, best = -1;
      for (const [u, w] of [[0, 3], [3, 6], [6, 0]]) { const dd = (a[i + u] - a[i + w]) ** 2 + (a[i + u + 2] - a[i + w + 2]) ** 2; if (dd > best) { best = dd; P = u; Q = w; } }
      if (best < 1e-6) continue;
      const f = F.length;
      F.push([a[i + P], a[i + P + 2], a[i + Q], a[i + Q + 2], Math.min(a[i + 1], a[i + 4], a[i + 7]), Math.max(a[i + 1], a[i + 4], a[i + 7])]);
      const i0 = Math.floor((Math.min(a[i + P], a[i + Q]) - 0.3) / 2), i1 = Math.floor((Math.max(a[i + P], a[i + Q]) + 0.3) / 2);
      const j0 = Math.floor((Math.min(a[i + P + 2], a[i + Q + 2]) - 0.3) / 2), j1 = Math.floor((Math.max(a[i + P + 2], a[i + Q + 2]) + 0.3) / 2);
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(f); }
    }
  }
  // does a face within 0.3 m of (x, z), running along (dx, dz), span [y0, y1]? (several triangles of one quad may share it)
  return (x, z, dx, dz, y0, y1) => {
    const l = B.get(Math.floor(z / 2) * 4096 + Math.floor(x / 2));
    if (!l) return false;
    let lo = Infinity, hi = -Infinity;
    for (const f of l) {
      const [px, pz, qx, qz, fy0, fy1] = F[f];
      const ex = qx - px, ez = qz - pz, L = Math.hypot(ex, ez);
      if (Math.abs((ex * dx + ez * dz) / (L * Math.hypot(dx, dz) || 1)) < 0.85) continue;
      const s = ((x - px) * ex + (z - pz) * ez) / (L * L);
      if (s < -0.02 || s > 1.02 || Math.abs((x - px) * ez - (z - pz) * ex) / L > 0.3) continue;
      lo = Math.min(lo, fy0); hi = Math.max(hi, fy1);
    }
    return lo <= y0 + 0.02 && hi >= y1 - 0.02;
  };
}
function wallFaces(tile, ch, ox, oz, stats) {
  const slits = chunkSlits(ch);
  const st = (stats.walls = { slitEdges: 0, faces: 0, rock: 0, masonry: 0, caps: 0, kerbClosed: 0, noGap: 0 });
  const wallOut = [], rockOut = [];
  const top = topSampler(tile, [...TOP_KINDS, 'terrP1']), faceAt = faceIndex(tile, ['curb', 'rwall']);   // (the drawn base too: TL26 may have sunk it)
  // the walls registry near this tile, in 2 m buckets (class per segment)
  const WB = new Map();
  if (WALLS) for (let wi = 0; wi < WALLS.length; wi++) {
    const xz = WALLS[wi].xz;
    for (let k = 0; k + 1 < xz.length; k++) {
      const [ax, az] = xz[k], [bx, bz] = xz[k + 1];
      if (Math.max(ax, bx) < ox - 4 || Math.min(ax, bx) > ox + TILE + 4 || Math.max(az, bz) < oz - 4 || Math.min(az, bz) > oz + TILE + 4) continue;
      const i0 = Math.floor((Math.min(ax, bx) - ox - 1.5) / 2), i1 = Math.floor((Math.max(ax, bx) - ox + 1.5) / 2);
      const j0 = Math.floor((Math.min(az, bz) - oz - 1.5) / 2), j1 = Math.floor((Math.max(az, bz) - oz + 1.5) / 2);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = j * 4096 + i; let l = WB.get(q); if (!l) WB.set(q, (l = [])); l.push(wi, ax, az, bx, bz); }
    }
  }
  const runAt = (x, z) => {
    const l = WB.get(Math.floor((z - oz) / 2) * 4096 + Math.floor((x - ox) / 2));
    let best = 1.5, c = -1;
    if (l) for (let q = 0; q < l.length; q += 5) {
      const ax = l[q + 1], az = l[q + 2], ex = l[q + 3] - ax, ez = l[q + 4] - az, L2 = ex * ex + ez * ez;
      const s = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2)) : 0;
      const d = Math.hypot(x - ax - ex * s, z - az - ez * s);
      if (d < best) { best = d; c = l[q]; }
    }
    return c;
  };
  const { x: X, z: Z, tri, tag } = ch;
  const pending = [], votes = new Map();
  const quad = (buf, a, b, c, d) => { buf.push(a[0] - ox, a[1], a[2] - oz, b[0] - ox, b[1], b[2] - oz, c[0] - ox, c[1], c[2] - oz, a[0] - ox, a[1], a[2] - oz, c[0] - ox, c[1], c[2] - oz, d[0] - ox, d[1], d[2] - oz); };
  for (const e of slits) {
    const ux = X[e.u], uz = Z[e.u], vx = X[e.v], vz = Z[e.v], mx = (ux + vx) / 2, mz = (uz + vz) / 2;
    if (mx < ox || mx >= ox + TILE || mz < oz || mz >= oz + TILE) continue;
    if (tag[e.t1] >= 3 || tag[e.t2] >= 3) continue;
    st.slitEdges++;
    const dx = vx - ux, dz = vz - uz, L = Math.hypot(dx, dz);
    if (L < 1e-4) continue;
    // each side's direction (into its triangle) and its drawn top at the edge's ends (3 cm in)
    const side = [e.t1, e.t2].map((t) => {
      const cx = (X[tri[3 * t]] + X[tri[3 * t + 1]] + X[tri[3 * t + 2]]) / 3, cz = (Z[tri[3 * t]] + Z[tri[3 * t + 1]] + Z[tri[3 * t + 2]]) / 3;
      let nx = -dz / L, nz = dx / L;
      if ((cx - mx) * nx + (cz - mz) * nz < 0) { nx = -nx; nz = -nz; }
      return { t, nx, nz };
    });
    const bs = [[HA_BASE + e.r1u, HA_BASE + e.r1v], [HA_BASE + e.r2u, HA_BASE + e.r2v]];
    // the drawn tops of both sides every 0.25 m along the edge (3 cm in): a face follows them piece by piece, so a walk
    // that covers only part of the edge is met where it lies and nowhere else
    const n = Math.max(2, Math.ceil(L / 0.25));
    const S = [];
    for (let q = 0; q <= n; q++) {
      const s0 = q / n, sp = Math.min(0.97, Math.max(0.03, s0));
      const tk = [0, 1].map((k) => {
        const b = bs[k][0] + (bs[k][1] - bs[k][0]) * s0;
        // (a section laid lower than the base, a compiled road in a cut, is the drawn top there: TL26 sank the base)
        const t = top(ux + dx * sp + side[k].nx * 0.03 - ox, uz + dz * sp + side[k].nz * 0.03 - oz, b - 4.0, b + 1.0);
        return t ? { y: t.y >= b - 0.05 ? Math.max(b, t.y) : t.y, kind: t.kind } : { y: b, kind: null };
      });
      S.push({ s: s0, b: [bs[0][0] + (bs[0][1] - bs[0][0]) * s0, bs[1][0] + (bs[1][1] - bs[1][0]) * s0], t: tk });
    }
    const sum = [0, 1].map((k) => S.reduce((a, q) => a + q.t[k].y, 0));
    const hiSide = sum[0] >= sum[1] ? 0 : 1, loSide = 1 - hiSide;
    if (S.every((q) => Math.abs(q.t[0].y - q.t[1].y) < 0.01 && Math.abs(q.b[0] - q.b[1]) < 0.01)) { st.noGap++; continue; }
    // closed already: a compiled vertical face along the edge spans the gap between the two drawn tops (middle, quarters)
    const at = (f) => S[Math.round(f * n)];
    if ([0.25, 0.5, 0.75].every((f) => { const q = at(f), g0 = Math.min(q.t[0].y, q.t[1].y), g1 = Math.max(q.t[0].y, q.t[1].y); return g1 - g0 < 0.6 && faceAt(ux + dx * q.s - ox, uz + dz * q.s - oz, dx, dz, g0, g1); })) { st.kerbClosed++; continue; }
    // the material, decided per run below: the registry's class; a traced run is rock where most of its edges here have
    // natural ground on both sides (a lawn, a park path or nothing laid) and steep ground beside them (Morningside's,
    // Inwood's outcrops), else a built wall (a terrace, a yard, a plaza edge): one material along a run, no patchwork
    const kindOf = (k) => { for (const q of S) if (q.t[k].kind) return q.t[k].kind; return null; };
    const hiKind = kindOf(hiSide), loKind = kindOf(loSide);
    const wi = runAt(mx, mz);
    const natural = (!hiKind || NATURAL_KINDS.has(hiKind)) && (!loKind || NATURAL_KINDS.has(loKind)) && (tag[e.t1] === 2 || tag[e.t2] === 2);
    const mid = S[n >> 1], drop = Math.max(mid.t[0].y, mid.t[1].y) - Math.min(mid.b[0], mid.b[1], mid.t[0].y, mid.t[1].y);
    if (wi >= 0) { const v = votes.get(wi) || [0, 0, []]; v[0] += natural ? 1 : 0; v[1]++; v[2].push(drop); votes.set(wi, v); }
    pending.push({ ux, uz, dx, dz, S, n, hiSide, loSide, side, hiKind, loKind, wi, natural });
  }
  // P2C: built walls. A masonry face carries its own UVs in metres (u: the arc length along its run in the walls registry,
  // so courses and joints run on round bends and across tiles; v: world height) and the library's weathering attribute
  // (seed, toe, top: the splash zone at the toe, run-off and soot under the coping), and a stone by place: Manhattan
  // schist rubble where a park's ground lies beside the run (Riverside's and Morningside's walls), granite ashlar on the
  // campus and the mapped walls of streets and plazas, board-formed concrete for the steps traced in yards and plazas.
  // A masonry wall gets a coping (0.4 m dressed granite, 3 cm over the face, 12 cm thick, 4 cm proud of the ground on
  // top); one that drops 2 m or more from walkable paving gets a parapet (1.0 m, 0.45 m thick, coped), open where an OSM
  // flight of steps meets it. Opt-in: `?terrainWalls=p2c` (off: the P2A faces, one board-formed concrete in the ground mesh).
  const P2C = WALLS_P2C;
  const wallUV = [], wallWe = [], wallMat = [], capOut = [], capUV = [], capWe = [];
  // TERRAIN FIX: each mapped run's top profile: every 0.5 m along its line the higher side's ground (the authority's
  // relief 0.6 m either side, plus the lawns' 0.3 m), a running maximum over 2 m either way, then a 1 m Gaussian; a face
  // rises to it, so the top is smooth and never under the ground beside it
  const STOP = new Map();
  const smoothTop = (wi, u) => {
    let P = STOP.get(wi);
    if (!P) {
      const xz = WALLS[wi].xz, raw = [];
      for (let k = 0; k + 1 < xz.length; k++) {
        const ax = xz[k][0], az = xz[k][1], ex = xz[k + 1][0] - ax, ez = xz[k + 1][1] - az, L = Math.hypot(ex, ez);
        if (L < 1e-6) continue;
        const nx = -ez / L, nz = ex / L, m = Math.max(1, Math.round(L / 0.5));
        for (let q = (raw.length ? 1 : 0); q <= m; q++) {
          const x = ax + (ex * q) / m, z = az + (ez * q) / m;
          let h = -Infinity;
          for (const d of [0.6, -0.6]) { const r = haRelief(x + nx * d, z + nz * d); if (r !== null && !Number.isNaN(r)) h = Math.max(h, HA_BASE + r + 0.3); }
          raw.push(h);
        }
      }
      const n = raw.length, mx = new Float64Array(n), sm = new Float64Array(n);
      for (let i = 0; i < n; i++) { let v = -Infinity; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) v = Math.max(v, raw[j]); mx[i] = v; }
      for (let i = 0; i < n; i++) { let a2 = 0, w = 0; for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) { if (!Number.isFinite(mx[j])) continue; const ww = Math.exp(-((j - i) ** 2) / 8); a2 += mx[j] * ww; w += ww; } sm[i] = w ? a2 / w : -Infinity; }
      P = { sm, step: 0.5 };
      STOP.set(wi, P);
    }
    const f = u / P.step, i = Math.floor(f), t = f - i, n = P.sm.length;
    if (!n) return -Infinity;
    const a2 = P.sm[Math.max(0, Math.min(n - 1, i))], b2 = P.sm[Math.max(0, Math.min(n - 1, i + 1))];
    return Number.isFinite(a2) && Number.isFinite(b2) ? a2 + (b2 - a2) * t : -Infinity;
  };
  const arcOf = (() => {
    const cum = new Map();
    return (wi, x, z) => {
      const xz = WALLS[wi].xz;
      let c = cum.get(wi);
      if (!c) { c = [0]; for (let k = 1; k < xz.length; k++) c.push(c[k - 1] + Math.hypot(xz[k][0] - xz[k - 1][0], xz[k][1] - xz[k - 1][1])); cum.set(wi, c); }
      let best = Infinity, u = 0;
      for (let k = 0; k + 1 < xz.length; k++) {
        const ax = xz[k][0], az = xz[k][1], ex = xz[k + 1][0] - ax, ez = xz[k + 1][1] - az, L2 = ex * ex + ez * ez;
        const t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2)) : 0;
        const d = (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2;
        if (d < best) { best = d; u = c[k] + t * Math.sqrt(L2); }
      }
      return u;
    };
  })();
  // the OSM flights near this tile (a parapet opens within 3 m of one)
  const stairNear = (() => {
    if (!STAIRS) return () => false;
    const segs = [];
    for (const { xz } of STAIRS) for (let k = 0; k + 1 < xz.length; k++) {
      const [ax, az] = xz[k], [bx, bz] = xz[k + 1];
      if (Math.max(ax, bx) < ox - 8 || Math.min(ax, bx) > ox + TILE + 8 || Math.max(az, bz) < oz - 8 || Math.min(az, bz) > oz + TILE + 8) continue;
      segs.push([ax, az, bx - ax, bz - az]);
    }
    return (x, z) => segs.some(([ax, az, ex, ez]) => { const L2 = ex * ex + ez * ez, t = L2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * ex + (z - az) * ez) / L2)) : 0; return (x - ax - ex * t) ** 2 + (z - az - ez * t) ** 2 < 9; });
  })();
  // per run: how much of it has a park's ground beside it
  const parkVotes = new Map();
  for (const f of pending) if (f.wi >= 0) { const v = parkVotes.get(f.wi) || [0, 0]; v[0] += (f.hiKind && NATURAL_KINDS.has(f.hiKind)) || (f.loKind && NATURAL_KINDS.has(f.loKind)) ? 1 : 0; v[1]++; parkVotes.set(f.wi, v); }
  const parapetEnds = new Map();   // vertex key -> count of parapet pieces ending there (a lone end gets its end face)
  const T3 = (buf, a, b, c) => buf.push(a[0] - ox, a[1], a[2] - oz, b[0] - ox, b[1], b[2] - oz, c[0] - ox, c[1], c[2] - oz);
  // a quad a b c d (counter-clockwise seen from its front) with UVs and weathering
  const quadW = (buf, uvb, web, mb, mk, a, b, c, d, ua, ub, uc, ud, we) => {
    quad(buf, a, b, c, d);
    uvb.push(...ua, ...ub, ...uc, ...ua, ...uc, ...ud);
    for (let k = 0; k < 6; k++) web.push(we[0], we[1], we[2]);
    if (mb) mb.push(mk, mk);
  };
  for (const f of pending) {
    const { ux, uz, dx, dz, S, n, hiSide, loSide, side, hiKind, loKind, wi, natural } = f;
    let c = wi >= 0 ? WALLS[wi].c : 'trace';
    if (c === 'trace') { const v = wi >= 0 ? votes.get(wi) : null; c = (v ? v[0] >= 0.6 * v[1] : natural) ? 'rock' : 'mas'; }
    const buf = c === 'rock' ? rockOut : wallOut;
    if (c === 'rock') st.rock++; else st.masonry++;
    st.faces++;
    const lsn = side[loSide], hn = side[hiSide];
    const front = -dz * lsn.nx + dx * lsn.nz > 0;
    const vr = wi >= 0 ? votes.get(wi) : null, md = vr ? vr[2].slice().sort((p, q) => p - q)[vr[2].length >> 1] : 0;
    const tall = c !== 'rock' && (!loKind || NATURAL_KINDS.has(loKind)) && md > 5;
    if (!P2C || c === 'rock') {
      // (P2A) the cap: a coping on a masonry wall with walkable paving on top and a drop of 0.4 m or more all along
      const cap = c !== 'rock' && WALK_KINDS.has(hiKind) && S.every((q) => q.t[hiSide].y - q.t[loSide].y >= 0.4);
      const ch4 = cap ? 0.04 : 0;
      for (let q = 0; q < n; q++) {
        const a = S[q], b = S[q + 1];
        const ax = ux + dx * a.s, az = uz + dz * a.s, bx = ux + dx * b.s, bz = uz + dz * b.s;
        const ha = Math.max(a.t[0].y, a.t[1].y), hb = Math.max(b.t[0].y, b.t[1].y);
        const U0 = [ax, Math.min(a.b[0], a.b[1], a.t[0].y, a.t[1].y), az], V0 = [bx, Math.min(b.b[0], b.b[1], b.t[0].y, b.t[1].y), bz], U1 = [ax, ha + ch4, az], V1 = [bx, hb + ch4, bz];
        if (tall && ha - U0[1] > 4.2 && hb - V0[1] > 4.2) {
          const Us = [ax, ha - 4, az], Vs = [bx, hb - 4, bz];
          if (front) { quad(rockOut, U0, V0, Vs, Us); quad(buf, Us, Vs, V1, U1); } else { quad(rockOut, V0, U0, Us, Vs); quad(buf, Vs, Us, U1, V1); }
          st.cliffSplit = (st.cliffSplit || 0) + 1;
        } else if (front) quad(buf, U0, V0, V1, U1); else quad(buf, V0, U0, U1, V1);
        if (cap) {
          const w = 0.3;
          const U2 = [ax + hn.nx * w, ha + ch4, az + hn.nz * w], V2 = [bx + hn.nx * w, hb + ch4, bz + hn.nz * w];
          const U3 = [U2[0], ha, U2[2]], V3 = [V2[0], hb, V2[2]];
          const up = (V1[0] - U1[0]) * (U2[2] - U1[2]) - (V1[2] - U1[2]) * (U2[0] - U1[0]) < 0;
          if (up) quad(wallOut, U1, V1, V2, U2); else quad(wallOut, V1, U1, U2, V2);
          if (front) quad(wallOut, V3, U3, U2, V2); else quad(wallOut, U3, V3, V2, U2);
        }
      }
      if (cap) st.caps++;
      continue;
    }
    // ---- P2C masonry
    const ex = dx / Math.hypot(dx, dz), ez = dz / Math.hypot(dx, dz);
    const camp = inQuad(ux + dx * 0.5, uz + dz * 0.5);
    // the product's stone for the run (schist in and by the parks), else the ground beside it decides
    const pv = wi >= 0 ? parkVotes.get(wi) : null;
    const park = wi >= 0 && WALLS[wi].stone ? WALLS[wi].stone === 'schist' : pv ? pv[0] >= 0.4 * pv[1] : (hiKind && NATURAL_KINDS.has(hiKind)) || (loKind && NATURAL_KINDS.has(loKind));
    const traced = wi < 0 || WALLS[wi].c === 'trace';
    const mk = camp ? 1 : park ? 0 : traced ? 2 : 1;          // 0 schist rubble, 1 granite ashlar, 2 board-formed concrete
    const stone = mk !== 2;
    const drop = (q) => q.t[hiSide].y - Math.min(q.b[0], q.b[1], q.t[0].y, q.t[1].y);
    const cap = stone && S.every((q) => drop(q) >= 0.4);
    const parapet = cap && WALK_KINDS.has(hiKind) && md >= 2.0 && S.every((q) => drop(q) >= 1.2) && !stairNear(ux + dx * 0.5, uz + dz * 0.5);
    const PH = parapet ? 1.0 : 0, PW = 0.45, CW = parapet ? PW : 0.4, CO = 0.03, CT = 0.12, CP = 0.04;
    // u along the run (the registry's arc length, increasing from U to V or not), else along the edge from its first end
    const uA = wi >= 0 ? arcOf(wi, ux, uz) : ux * ex + uz * ez, uB = wi >= 0 ? arcOf(wi, ux + dx, uz + dz) : uA + Math.hypot(dx, dz);
    const seed = wi >= 0 ? (wi * 0.6180339) % 1 : 0.5;
    if (cap) st.caps++;
    if (parapet) st.parapets = (st.parapets || 0) + 1;
    const sk = ['schist', 'granite', 'concrete'][mk];
    st[sk] = (st[sk] || 0) + 1;
    // the 0.25 m stations merged where the face's top, its foot and the high side's ground run straight between them
    // (to 1 cm): a built wall's straight top is one piece an edge, not four
    const HA_ = S.map((q) => Math.max(q.t[0].y, q.t[1].y)), YB_ = S.map((q) => Math.min(q.b[0], q.b[1], q.t[0].y, q.t[1].y)), HT_ = S.map((q) => q.t[hiSide].y);
    const brk = [0];
    for (let i = 0; i < n;) {
      let j = i + 1;
      while (j + 1 <= n) {
        const k = j + 1;
        let ok = true;
        for (let m = i + 1; m < k && ok; m++) {
          const f = (S[m].s - S[i].s) / (S[k].s - S[i].s);
          for (const A of [HA_, YB_, HT_]) if (Math.abs(A[m] - (A[i] + (A[k] - A[i]) * f)) > 0.01) { ok = false; break; }
        }
        if (!ok) break;
        j = k;
      }
      brk.push(j);
      i = j;
    }
    for (let qi = 0; qi + 1 < brk.length; qi++) {
      const a = S[brk[qi]], b = S[brk[qi + 1]];
      const ax = ux + dx * a.s, az = uz + dz * a.s, bx = ux + dx * b.s, bz = uz + dz * b.s;
      const ua = uA + (uB - uA) * a.s, ub = uA + (uB - uA) * b.s;
      // TERRAIN FIX: a mapped wall's top is one smoothed line along its run (smoothTop), never the sawtooth of the
      // ground's triangles along it
      const ha = Math.max(a.t[0].y, a.t[1].y, wi >= 0 ? smoothTop(wi, ua) : -Infinity), hb = Math.max(b.t[0].y, b.t[1].y, wi >= 0 ? smoothTop(wi, ub) : -Infinity);
      const ya0 = Math.min(a.b[0], a.b[1], a.t[0].y, a.t[1].y), yb0 = Math.min(b.b[0], b.b[1], b.t[0].y, b.t[1].y);
      // the face's top: the coping's underside (or the parapet's), the ground's top where there is no coping
      const ta = cap ? ha + PH + CP - CT : ha, tb = cap ? hb + PH + CP - CT : hb;
      const we = [seed, Math.min(ya0, yb0), Math.max(ha, hb) + PH + (cap ? CP : 0)];
      const U0 = [ax, ya0, az], V0 = [bx, yb0, bz], U1 = [ax, ta, az], V1 = [bx, tb, bz];
      if (tall && ha - ya0 > 4.2 && hb - yb0 > 4.2) {
        const Us = [ax, ha - 4, az], Vs = [bx, hb - 4, bz];
        if (front) quad(rockOut, U0, V0, Vs, Us); else quad(rockOut, V0, U0, Us, Vs);
        if (front) quadW(wallOut, wallUV, wallWe, wallMat, mk, Us, Vs, V1, U1, [ua, Us[1]], [ub, Vs[1]], [ub, V1[1]], [ua, U1[1]], [seed, ha - 4, we[2]]);
        else quadW(wallOut, wallUV, wallWe, wallMat, mk, Vs, Us, U1, V1, [ub, Vs[1]], [ua, Us[1]], [ua, U1[1]], [ub, V1[1]], [seed, ha - 4, we[2]]);
        st.cliffSplit = (st.cliffSplit || 0) + 1;
      } else if (front) quadW(wallOut, wallUV, wallWe, wallMat, mk, U0, V0, V1, U1, [ua, U0[1]], [ub, V0[1]], [ub, V1[1]], [ua, U1[1]], we);
      else quadW(wallOut, wallUV, wallWe, wallMat, mk, V0, U0, U1, V1, [ub, V0[1]], [ua, U0[1]], [ua, U1[1]], [ub, V1[1]], we);
      if (!cap) continue;
      // the parapet's inner face, from the high side's ground up to the coping
      const off = (x, z, d, y) => [x + hn.nx * d, y, z + hn.nz * d];
      if (parapet) {
        const Ia = off(ax, az, PW, a.t[hiSide].y), Ib = off(bx, bz, PW, b.t[hiSide].y), Ja = off(ax, az, PW, ha + PH + CP - CT), Jb = off(bx, bz, PW, hb + PH + CP - CT);
        if (front) quadW(wallOut, wallUV, wallWe, wallMat, mk, Ib, Ia, Ja, Jb, [ub, Ib[1]], [ua, Ia[1]], [ua, Ja[1]], [ub, Jb[1]], [seed, Math.min(Ia[1], Ib[1]), we[2]]);
        else quadW(wallOut, wallUV, wallWe, wallMat, mk, Ia, Ib, Jb, Ja, [ua, Ia[1]], [ub, Ib[1]], [ub, Jb[1]], [ua, Ja[1]], [seed, Math.min(Ia[1], Ib[1]), we[2]]);
        for (const [x, z, k] of [[ax, az, 0], [bx, bz, 1]]) { const key = `${Math.round(x * 100)}_${Math.round(z * 100)}`; const e = parapetEnds.get(key) || { n: 0, x, z, h: k ? hb : ha, g: k ? b.t[hiSide].y : a.t[hiSide].y, lo: k ? yb0 : ya0, nx: hn.nx, nz: hn.nz, ex, ez, u: k ? ub : ua, mk, seed, front }; e.n++; parapetEnds.set(key, e); }
      }
      // the coping: a dressed stone 3 cm over the face (and the parapet's inner face), its top CP over the ground (or the
      // parapet), CT thick
      const ytA = ha + PH + CP, ytB = hb + PH + CP, ybA = ytA - CT, ybB = ytB - CT;
      const Fa = off(ax, az, -CO, ytA), Fb = off(bx, bz, -CO, ytB), Ra = off(ax, az, CW + (parapet ? CO : 0), ytA), Rb = off(bx, bz, CW + (parapet ? CO : 0), ytB);
      const Fa0 = [Fa[0], ybA, Fa[2]], Fb0 = [Fb[0], ybB, Fb[2]], Ra0 = [Ra[0], parapet ? ybA : ha, Ra[2]], Rb0 = [Rb[0], parapet ? ybB : hb, Rb[2]];
      const wA = [ax, ybA, az], wB = [bx, ybB, bz];
      const cwe = [seed, Math.min(ybA, ybB), Math.max(ytA, ytB)];
      const wTop = CW + CO + (parapet ? CO : 0);
      // (front: U -> V runs with the low side on the right as seen from it; the top's winding follows from that)
      if (front) {
        quadW(capOut, capUV, capWe, null, 0, Fa, Fb, Rb, Ra, [ua, 0], [ub, 0], [ub, wTop], [ua, wTop], cwe);   // top
        quadW(capOut, capUV, capWe, null, 0, Fa0, Fb0, Fb, Fa, [ua, ybA], [ub, ybB], [ub, ytB], [ua, ytA], cwe);   // front
        quadW(capOut, capUV, capWe, null, 0, Rb0, Ra0, Ra, Rb, [ub, Rb0[1]], [ua, Ra0[1]], [ua, ytA], [ub, ytB], cwe);   // back
        quadW(capOut, capUV, capWe, null, 0, wA, wB, Fb0, Fa0, [ua, 0], [ub, 0], [ub, CO], [ua, CO], cwe);   // drip (underside)
      } else {
        quadW(capOut, capUV, capWe, null, 0, Fb, Fa, Ra, Rb, [ub, 0], [ua, 0], [ua, wTop], [ub, wTop], cwe);
        quadW(capOut, capUV, capWe, null, 0, Fb0, Fa0, Fa, Fb, [ub, ybB], [ua, ybA], [ua, ytA], [ub, ytB], cwe);
        quadW(capOut, capUV, capWe, null, 0, Ra0, Rb0, Rb, Ra, [ua, Ra0[1]], [ub, Rb0[1]], [ub, ytB], [ua, ytA], cwe);
        quadW(capOut, capUV, capWe, null, 0, wB, wA, Fa0, Fb0, [ub, 0], [ua, 0], [ua, CO], [ub, CO], cwe);
      }
    }
  }
  // a parapet's lone ends get their end faces (masonry up to the coping, and the coping's end)
  for (const e of parapetEnds.values()) {
    if (e.n !== 1) continue;
    const { x, z, h, g, nx, nz, u, mk, seed } = e;
    const yt = h + 1.0 + 0.04, yb = yt - 0.12;
    const P0 = [x, g, z], P1 = [x + nx * 0.45, g, z + nz * 0.45], P2 = [x + nx * 0.45, yb, z + nz * 0.45], P3 = [x, yb, z];
    const C0 = [x - nx * 0.03, yb, z - nz * 0.03], C1 = [x + nx * 0.48, yb, z + nz * 0.48], C2 = [x + nx * 0.48, yt, z + nz * 0.48], C3 = [x - nx * 0.03, yt, z - nz * 0.03];
    // both windings: the end may face either way along the run (a two-sided end costs 4 triangles)
    quadW(wallOut, wallUV, wallWe, wallMat, mk, P0, P1, P2, P3, [u, g], [u + 0.45, g], [u + 0.45, yb], [u, yb], [seed, g, yt]);
    quadW(wallOut, wallUV, wallWe, wallMat, mk, P1, P0, P3, P2, [u + 0.45, g], [u, g], [u, yb], [u + 0.45, yb], [seed, g, yt]);
    quadW(capOut, capUV, capWe, null, 0, C0, C1, C2, C3, [0, yb], [0.51, yb], [0.51, yt], [0, yt], [seed, yb, yt]);
    quadW(capOut, capUV, capWe, null, 0, C1, C0, C3, C2, [0.51, yb], [0, yb], [0, yt], [0.51, yt], [seed, yb, yt]);
  }
  // ---- P2C: the OSM flights of steps as built stairs. The TIN under a flight is its ramp; on it stand granite treads and
  // risers of 0.16 m (each tread clear of the ramp and of the ground across the flight's width), between masonry cheek
  // walls (0.25 m, 0.25 m over the nosings, their tops sloped with the flight) that run down to the ground beside. The
  // flight's width is OSM's, else 3 m. Left to their kits: the campus (Low's authored steps) and Central Park; a flight
  // the ramp breaks by more than 0.6 m (a wall across it) is left as it is.
  if (P2C && STAIRS) {
    const R = 0.16, CHW = 0.25, CHH = 0.25;
    const inCP = (x, z) => { const qx = x - 447.2, qz = z - 82.2; return Math.abs(qx * 0.4848 - qz * 0.8746) < 2090 && Math.abs(qx * 0.8746 + qz * 0.4848) < 460; };
    // a quad a b c d whose normal is turned to `want` (triangles a b c, a c d), with UVs and weathering
    const faceTo = (buf, uvb, web, mb, mk, P4, U4, we, want) => {
      const [a, b, c] = P4;
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const ok = nx * want[0] + ny * want[1] + nz * want[2] >= 0;
      const o = ok ? [0, 1, 2, 3] : [0, 3, 2, 1];
      quadW(buf, uvb, web, mb, mk, P4[o[0]], P4[o[1]], P4[o[2]], P4[o[3]], U4[o[0]], U4[o[1]], U4[o[2]], U4[o[3]], we);
    };
    st.stairs = st.stairs || 0; st.stairSkip = st.stairSkip || 0;
    for (let fi = 0; fi < STAIRS.length; fi++) {
      const { xz, w: w0 } = STAIRS[fi];
      if (!xz || xz.length < 2) continue;
      const cum = [0];
      for (let k = 1; k < xz.length; k++) cum.push(cum[k - 1] + Math.hypot(xz[k][0] - xz[k - 1][0], xz[k][1] - xz[k - 1][1]));
      const L = cum[cum.length - 1];
      if (L < 1.5) continue;
      const at = (sv) => {
        let k = 0;
        while (k + 2 < cum.length && cum[k + 1] < sv) k++;
        const sl = Math.max(cum[k + 1] - cum[k], 1e-9), t = Math.min(1, Math.max(0, (sv - cum[k]) / sl));
        const tx = (xz[k + 1][0] - xz[k][0]) / sl, tz = (xz[k + 1][1] - xz[k][1]) / sl;
        return [xz[k][0] + (xz[k + 1][0] - xz[k][0]) * t, xz[k][1] + (xz[k + 1][1] - xz[k][1]) * t, tx, tz];
      };
      const M = at(L / 2);
      if (M[0] < ox || M[0] >= ox + TILE || M[1] < oz || M[1] >= oz + TILE) continue;
      if (inQuad(M[0], M[1]) || inCP(M[0], M[1])) continue;
      const w = Math.min(8, Math.max(1.2, isFinite(w0) && w0 > 0 ? w0 : 3.0)), hw = w / 2;
      const n = Math.max(2, Math.ceil(L / 0.25));
      const S2 = [];
      let bad = false;
      const ground = (x, z) => {
        const b = haTerrainAt(x, z);
        if (b === null) return null;
        const t = top(x - ox, z - oz, b - 1.0, b + 1.0);
        return t ? Math.max(b, t.y) : b;
      };
      for (let q = 0; q <= n && !bad; q++) {
        const sv = (q / n) * L, [x, z, tx, tz] = at(sv), nx = -tz, nz = tx;
        const h = ground(x, z), hl = ground(x + nx * hw, z + nz * hw), hr = ground(x - nx * hw, z - nz * hw);
        const gl = ground(x + nx * (hw + CHW + 0.1), z + nz * (hw + CHW + 0.1)), gr = ground(x - nx * (hw + CHW + 0.1), z - nz * (hw + CHW + 0.1));
        if (h === null || hl === null || hr === null) { bad = true; break; }
        S2.push({ sv, x, z, nx, nz, h: Math.max(h, hl, hr), gl: gl === null ? Math.min(h, hl) : Math.min(gl, hl), gr: gr === null ? Math.min(h, hr) : Math.min(gr, hr) });
      }
      if (bad) { st.stairSkip++; continue; }
      if (S2.some((q, k) => k > 0 && Math.abs(q.h - S2[k - 1].h) > 0.6)) { st.stairSkip++; continue; }
      if (Math.abs(S2[n].h - S2[0].h) < 0.3) continue;
      // the profile smoothed over 1.25 m, quantised to the risers, lifted until every tread clears the ground under it
      const hm = S2.map((_, k) => { let a = 0, c = 0; for (let j = Math.max(0, k - 2); j <= Math.min(n, k + 2); j++) { a += S2[j].h; c++; } return a / c; });
      const kq = hm.map((v) => Math.round((v - hm[0]) / R));
      let lift = -Infinity;
      for (let q = 0; q <= n; q++) lift = Math.max(lift, S2[q].h + 0.02 - (hm[0] + kq[q] * R));
      const Y = kq.map((k) => hm[0] + k * R + lift);
      // treads: runs of equal level, from the mid-points between samples
      const tr = [];
      for (let q = 0; q <= n; q++) {
        const s0 = q === 0 ? 0 : (S2[q - 1].sv + S2[q].sv) / 2, s1 = q === n ? L : (S2[q].sv + S2[q + 1].sv) / 2;
        if (tr.length && tr[tr.length - 1].k === kq[q]) tr[tr.length - 1].s1 = s1; else tr.push({ k: kq[q], y: Y[q], s0, s1, q0: q });
      }
      const pos = (sv, off, y) => { const [x, z, tx, tz] = at(sv); return [x - tz * off, y, z + tx * off]; };
      const gAt = (sv, side) => { const q = Math.min(n, Math.max(0, Math.round((sv / L) * n))); return side > 0 ? S2[q].gl : S2[q].gr; };
      // the cheeks' stone: schist where a park's ground lies beside the flight, granite elsewhere
      const kOf = (x, z) => { const b = haTerrainAt(x, z); const t = b === null ? null : top(x - ox, z - oz, b - 1.0, b + 1.0); return t ? t.kind : null; };
      const kk = [kOf(M[0] - M[3] * (hw + 1), M[1] + M[2] * (hw + 1)), kOf(M[0] + M[3] * (hw + 1), M[1] - M[2] * (hw + 1))];
      const mkC = kk.some((k) => k && NATURAL_KINDS.has(k)) ? 0 : 1;
      const seedS = (fi * 0.618034) % 1;
      const cheekTop = (sv) => {   // the cheeks' tops: sloped through the treads' middles, CHH over the nosing
        let i = 0;
        while (i + 1 < tr.length && (tr[i].s0 + tr[i].s1) / 2 < sv) i++;
        const a = tr[Math.max(0, i - 1)], b = tr[i];
        const ma = (a.s0 + a.s1) / 2, mb = (b.s0 + b.s1) / 2;
        const t = mb > ma ? Math.min(1, Math.max(0, (sv - ma) / (mb - ma))) : 0;
        return a.y + (b.y - a.y) * t + CHH + R / 2;
      };
      const yLo = Math.min(...Y) - 0.5, yHi = Math.max(...Y) + CHH + 0.2;
      const we = [seedS, yLo, yHi];
      for (let i = 0; i < tr.length; i++) {
        const t = tr[i];
        const [x0, z0, tx0, tz0] = at(t.s0), [x1, z1] = at(t.s1);
        // the tread (up)
        faceTo(capOut, capUV, capWe, null, 0, [pos(t.s0, hw, t.y), pos(t.s1, hw, t.y), pos(t.s1, -hw, t.y), pos(t.s0, -hw, t.y)],
          [[t.s0, hw], [t.s1, hw], [t.s1, -hw], [t.s0, -hw]], we, [0, 1, 0]);
        // the riser into the next tread (facing the lower one), and the first and last ones down to the ramp
        const riser = (sv, ya, yb, dir) => faceTo(capOut, capUV, capWe, null, 0, [pos(sv, hw, ya), pos(sv, -hw, ya), pos(sv, -hw, yb), pos(sv, hw, yb)],
          [[hw, ya], [-hw, ya], [-hw, yb], [hw, yb]], we, [tx0 * dir, 0, tz0 * dir]);
        if (i + 1 < tr.length) { const u = tr[i + 1]; if (u.y > t.y) riser(t.s1, t.y, u.y, 1); else riser(t.s1, u.y, t.y, -1); }
        if (i === 0) riser(t.s0, S2[0].h - 0.1, t.y, -1);
        if (i === tr.length - 1) riser(t.s1, S2[n].h - 0.1, t.y, 1);
        // the cheeks, per tread: inner face (over the tread), top, outer face (down to the ground beside)
        for (const sd of [1, -1]) {
          const ca = cheekTop(t.s0), cb = cheekTop(t.s1);
          const iA = pos(t.s0, sd * hw, t.y - 0.05), iB = pos(t.s1, sd * hw, t.y - 0.05), iC = pos(t.s1, sd * hw, cb), iD = pos(t.s0, sd * hw, ca);
          const nrm = [-tz0 * sd, 0, tx0 * sd];   // outward
          faceTo(wallOut, wallUV, wallWe, wallMat, mkC, [iA, iB, iC, iD], [[t.s0, iA[1]], [t.s1, iB[1]], [t.s1, cb], [t.s0, ca]], we, [-nrm[0], 0, -nrm[2]]);
          const oA = pos(t.s0, sd * (hw + CHW), gAt(t.s0, sd) - 0.1), oB = pos(t.s1, sd * (hw + CHW), gAt(t.s1, sd) - 0.1), oC = pos(t.s1, sd * (hw + CHW), cb), oD = pos(t.s0, sd * (hw + CHW), ca);
          faceTo(wallOut, wallUV, wallWe, wallMat, mkC, [oA, oB, oC, oD], [[t.s0, oA[1]], [t.s1, oB[1]], [t.s1, cb], [t.s0, ca]], we, nrm);
          faceTo(capOut, capUV, capWe, null, 0, [iD, iC, oC, oD], [[t.s0, 0], [t.s1, 0], [t.s1, CHW], [t.s0, CHW]], we, [0, 1, 0]);
        }
      }
      // the cheeks' ends (both ways round)
      for (const [sv, dir] of [[0, -1], [L, 1]]) for (const sd of [1, -1]) {
        const c = cheekTop(sv), g = gAt(sv, sd) - 0.1, [, , tx, tz] = at(sv);
        faceTo(wallOut, wallUV, wallWe, wallMat, mkC, [pos(sv, sd * hw, g), pos(sv, sd * (hw + CHW), g), pos(sv, sd * (hw + CHW), c), pos(sv, sd * hw, c)],
          [[0, g], [CHW, g], [CHW, c], [0, c]], we, [tx * dir, 0, tz * dir]);
      }
      st.stairs++;
    }
  }
  tile.S.terrWall = Float32Array.from(wallOut);
  tile.S.terrRock = Float32Array.from(rockOut);
  if (P2C) {
    tile.S.terrWallUV = Float32Array.from(wallUV);
    tile.S.terrWallWe = Float32Array.from(wallWe);
    tile.S.terrWallMat = Uint8Array.from(wallMat);
    tile.S.terrCap = Float32Array.from(capOut);
    tile.S.terrCapUV = Float32Array.from(capUV);
    tile.S.terrCapWe = Float32Array.from(capWe);
  }
}

// P2A: the TIN triangles the opaque at-grade area sections cover, where the base need not be drawn (fullOpaque). Robust
// to the compile's seams: the opaque triangles' edges are counted over all those sections together (an edge two
// triangles share, in one section or two, cancels); what is left is the union's outline plus every seam that is not
// shared vertex for vertex (a T-junction, an overlap). A TIN triangle such a segment touches keeps its base (a crack
// there shows the base, never the sky); one none touches, whose centroid and corners (pulled 1 % in) lie in an opaque
// triangle, is covered.
function coverOpaque(tile, ch, ox, oz, fullOpaque, stats) {
  const key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const ec = new Map(), TB = new Map(), tris = [], TF = [], TR = [];   // (TF: the triangles' corners flat; TR: their bucket ranges)
  for (const name of [...OPAQUE, 'curb']) {   // (the kerb tops close the strip between a walk and its gutter)
    const a = tile.S[name];
    if (!a) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const ax = a[i] + ox, az = a[i + 2] + oz, bx = a[i + 3] + ox, bz = a[i + 5] + oz, cx = a[i + 6] + ox, cz = a[i + 8] + oz;
      const ar = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
      if (Math.abs(ar) < 1e-6) continue;
      // (at grade only: a deck over the ground or a road in a cut does not hide the base round it)
      if (Math.min(a[i + 1], a[i + 4], a[i + 7]) < HA_ASPHALT - 0.3 || Math.max(a[i + 1], a[i + 4], a[i + 7]) > HA_ASPHALT + 0.5) continue;
      const V = ar > 0 ? [[ax, az], [bx, bz], [cx, cz]] : [[ax, az], [cx, cz], [bx, bz]];
      for (let e = 0; e < 3; e++) {
        const P = V[e], Q = V[(e + 1) % 3], kp = key(P[0], P[1]), kq = key(Q[0], Q[1]);
        const k2 = kp < kq ? kp + '|' + kq : kq + '|' + kp, d = kp < kq ? 1 : -1;
        const r = ec.get(k2);
        if (r) { r.n += d; r.m++; } else ec.set(k2, { n: d, m: 1, P, Q });
      }
      const ti = tris.length;
      tris.push(V);
      const i0 = Math.floor((Math.min(ax, bx, cx) - ox) / BK), i1 = Math.floor((Math.max(ax, bx, cx) - ox) / BK);
      const j0 = Math.floor((Math.min(az, bz, cz) - oz) / BK), j1 = Math.floor((Math.max(az, bz, cz) - oz) / BK);
      TF.push(V[0][0], V[0][1], V[1][0], V[1][1], V[2][0], V[2][1]); TR.push(i0, i1, j0, j1);
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const bk = j * 100000 + ii; let l = TB.get(bk); if (!l) TB.set(bk, (l = [])); l.push(ti); }
    }
  }
  // (PERF: the triangle that held the last point is tried first when the point's bucket lists it: the lattices below walk
  // across one triangle at a time; the answer is the same, any listed triangle holding the point)
  let last = -1;
  const inTri = (ti, x, z) => {
    const o = 6 * ti, ax = TF[o], az = TF[o + 1], bx = TF[o + 2], bz = TF[o + 3], cx = TF[o + 4], cz = TF[o + 5];
    return (bx - ax) * (z - az) - (bz - az) * (x - ax) >= -1e-9 && (cx - bx) * (z - bz) - (cz - bz) * (x - bx) >= -1e-9 && (ax - cx) * (z - cz) - (az - cz) * (x - cx) >= -1e-9;
  };
  const inAny = (x, z) => {
    const bj = Math.floor((z - oz) / BK), bi = Math.floor((x - ox) / BK);
    if (last >= 0 && bi >= TR[4 * last] && bi <= TR[4 * last + 1] && bj >= TR[4 * last + 2] && bj <= TR[4 * last + 3] && inTri(last, x, z)) return true;
    const l = TB.get(bj * 100000 + bi);
    if (!l) return false;
    for (let k = 0; k < l.length; k++) if (inTri(l[k], x, z)) { last = l[k]; return true; }
    return false;
  };
  const segB = new Map();
  let interior = 0;
  for (const { n: c, m, P, Q } of ec.values()) {
    if (c === 0 && m === 2) continue;
    // (a seam with opaque paving on both sides, 5 mm either way at its quarter points, hides the base as well)
    const ex = Q[0] - P[0], ez = Q[1] - P[1], L = Math.hypot(ex, ez);
    if (L > 1e-6 && [0.25, 0.5, 0.75].every((f) => { const x = P[0] + ex * f, z = P[1] + ez * f, nx = (-ez / L) * 0.005, nz = (ex / L) * 0.005; return inAny(x + nx, z + nz) && inAny(x - nx, z - nz); })) { interior++; continue; }
    const i0 = Math.floor((Math.min(P[0], Q[0]) - ox) / BK), i1 = Math.floor((Math.max(P[0], Q[0]) - ox) / BK);
    const j0 = Math.floor((Math.min(P[1], Q[1]) - oz) / BK), j1 = Math.floor((Math.max(P[1], Q[1]) - oz) / BK);
    for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) { const bk = j * 100000 + ii; let l = segB.get(bk); if (!l) segB.set(bk, (l = [])); l.push(P[0], P[1], Q[0], Q[1]); }
  }
  let n = 0;
  const { tri, x: X, z: Z } = ch;
  for (let t = 0; t < ch.nT; t++) {
    if (ch.tag[t] >= 3 || fullOpaque[t]) continue;
    const A0 = tri[3 * t], B0 = tri[3 * t + 1], C0 = tri[3 * t + 2];
    const tx0 = Math.min(X[A0], X[B0], X[C0]), tx1 = Math.max(X[A0], X[B0], X[C0]), tz0 = Math.min(Z[A0], Z[B0], Z[C0]), tz1 = Math.max(Z[A0], Z[B0], Z[C0]);
    if (tx1 < ox || tx0 > ox + TILE || tz1 < oz || tz0 > oz + TILE) continue;
    let whole = true;
    const i0 = Math.floor((tx0 - ox) / BK), i1 = Math.floor((tx1 - ox) / BK), j0 = Math.floor((tz0 - oz) / BK), j1 = Math.floor((tz1 - oz) / BK);
    for (let j = j0; j <= j1 && whole; j++) for (let ii = i0; ii <= i1 && whole; ii++) {
      const arr = segB.get(j * 100000 + ii);
      if (!arr) continue;
      for (let k = 0; k < arr.length; k += 4) if (segTouchesTri(ch, t, arr[k], arr[k + 1], arr[k + 2], arr[k + 3])) { whole = false; break; }
    }
    if (!whole) continue;
    const cx = (X[A0] + X[B0] + X[C0]) / 3, cz = (Z[A0] + Z[B0] + Z[C0]) / 3;
    if (![[cx, cz], ...[A0, B0, C0].map((v) => [X[v] + (cx - X[v]) * 0.01, Z[v] + (cz - Z[v]) * 0.01])].every(([px, pz]) => inAny(px, pz))) continue;
    // (and a fine lattice inside it: a gap between sections that no outline segment reaches, a strip the re-kinding
    // passes left between two pieces, must keep its base)
    const L = Math.max(Math.hypot(X[B0] - X[A0], Z[B0] - Z[A0]), Math.hypot(X[C0] - X[B0], Z[C0] - Z[B0]), Math.hypot(X[A0] - X[C0], Z[A0] - Z[C0]));
    const m = Math.min(96, Math.max(2, Math.ceil(L / 0.12)));   // (TERRAIN FIX: 0.12 m, was 0.4: a kerb-line gap 0.1-0.3 m wide slipped through)
    let ok = true;
    for (let i = 1; i < m && ok; i++) for (let j = 1; i + j < m && ok; j++) {
      const u = i / m, v = j / m, w = 1 - u - v;
      if (!inAny(X[A0] * u + X[B0] * v + X[C0] * w, Z[A0] * u + Z[B0] * v + Z[C0] * w)) ok = false;
    }
    if (ok) { fullOpaque[t] = 1; n++; }
  }
  stats.covered = n;
  stats.coverInteriorSeams = interior;
}

export function haApplyTile(tile, ox, oz) {
  const ch = CH.get(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`);
  if (!FLAG || !ch) return null;
  // (tools/terrain/p1_probe.mjs: globalThis.__P1_KEEP keeps the tile and its sections as compiled, for the layer checks)
  const keep = typeof globalThis !== 'undefined' && globalThis.__P1_KEEP;
  if (keep) { const before = {}; for (const nm of HA_GROUND) if (tile.S[nm]) before[nm] = Float32Array.from(tile.S[nm]); keep.set(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`, { tile, before, grid0: tile.S.terrain ? Float32Array.from(tile.S.terrain) : null }); }
  const res = tile.header.res, grid0 = tile.S.terrain ? Float32Array.from(tile.S.terrain) : null;
  tile.p1Grid0 = grid0;
  const pad = (x, z) => padOf(grid0, res, ox, oz, x, z);
  const stats = { sections: {}, faces: 0, slitFaces: 0, coverErr: 0, baseLowered: 0 };
  // TL26 for the region's base: a corner of the base sinks to 0.12 m under the lowest section piece laid in its triangle
  // (a compiled road in an open cut, RG44), at most SINK_MAX; the corners that share its vertex and its height sink with it
  const lowerC = new Float32Array(3 * ch.nT).fill(Infinity);
  // TERRAIN FIX: the swept shore walls replace the compiled pieces, so the pieces leave the curb soup before the base's
  // cover is found (their caps no longer hide the base; the new caps lie on other lines)
  const shoreEarly = !SHORE_PIECES && tile.S.curb && tile.S.curb.length >= 9 ? shoreLift(tile.S.curb, ch, ox, oz, stats) : null;
  if (shoreEarly) tile.S.curb = shoreEarly.keep;
  const fullOpaque = new Uint8Array(ch.nT);       // P1B: TIN triangles an opaque area section covers wholly (no base drawn there)
  stats.relay = { whole: 0, partial: 0, areaErr: 0 };
  const NO_TL = new Set(['rsteel', 'rbal', 'rtop', 'rwall', 'apron']);
  const cand = [];
  const campusTile = grid0 && res >= 64 && CAMPUS_Q.some(([x, z]) => x > ox - 600 && x < ox + TILE + 600 && z > oz - 600 && z < oz + TILE + 600);
  // P2A: the lifting cut's per-tile state (edge and point caches shared by every section, so a shared edge splits alike)
  const LIFT = CUT === 'lift' && !campusTile;
  const lctx = LIFT ? { ch, ox, oz, cand: [], cand2: [], edges: new Map(), verts: new Map(), vmark: new Uint32Array(ch.nV), vstamp: 0, noTL: false, onEmit: null } : null;
  if (LIFT) {
    chunkVerts(ch);
    const tc = [];
    // (the base sinks 0.12 m under a lifted piece laid lower than that over it: a compiled road in an open cut, RG44)
    lctx.onEmit = (P) => {
      if (!P || lctx.noTL) return;
      const mn = Math.min(P[0][1] + P[0][3], P[1][1] + P[1][3], P[2][1] + P[2][3]);
      if (!(mn - 0.12 < HA_BASE + Math.max(P[0][3], P[1][3], P[2][3]) + 0.5)) return;
      candidates(ch, Math.min(P[0][0], P[1][0], P[2][0]), Math.min(P[0][2], P[1][2], P[2][2]), Math.max(P[0][0], P[1][0], P[2][0]), Math.max(P[0][2], P[1][2], P[2][2]), tc);
      for (const t of tc) {
        if (ch.tag[t] >= 3) continue;
        if (!(mn - 0.12 < HA_BASE + Math.max(ch.rel[3 * t], ch.rel[3 * t + 1], ch.rel[3 * t + 2]))) continue;
        // (the piece's lowest point over this TIN triangle, not over the whole piece: a long walk on a hill must not
        // sink the base at its upper end to its lower end's height)
        const pc = clipToTri([[P[0][0], P[0][1] + P[0][3], P[0][2]], [P[1][0], P[1][1] + P[1][3], P[1][2]], [P[2][0], P[2][1] + P[2][3], P[2][2]]], ch, t);
        if (pc.length < 3) continue;
        let mt = Infinity;
        for (const q of pc) mt = Math.min(mt, q[1]);
        for (let k = 0; k < 3; k++) {
          const by = HA_BASE + ch.rel[3 * t + k];
          if (mt - 0.12 < by) lowerC[3 * t + k] = Math.min(lowerC[3 * t + k], Math.max(mt - 0.12, by - SINK_MAX));
        }
      }
    };
    coverOpaque(tile, ch, ox, oz, fullOpaque, stats);
  }
  // P2A: the shore's bulkheads out of the curb soup, lifted as walls by the land behind them (added back after the cut)
  const shore = shoreEarly || (SHORE_PIECES && tile.S.curb && tile.S.curb.length >= 9 ? shoreLift(tile.S.curb, ch, ox, oz, stats) : null);
  if (shore && !shoreEarly) tile.S.curb = shore.keep;
  for (const name of HA_GROUND) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    if (LIFT && name === 'apron') {
      // the shore aprons (land behind a bulkhead the 16 m grid left under water, a flat infill): lifted as the other
      // sections are, cut exactly across a wall, but refined only past 0.25 m (their own edge cache: TAU differs; an apron lies 0.39 m
      // under the lawns that overlap it)
      lctx.noTL = true;
      const n = liftCut(name, a, { ...lctx, edges: new Map(), cand: [], cand2: [], vmark: new Uint32Array(ch.nV), vstamp: 0, tau: 0.25 }, out, stats);
      tile.S[name] = Float32Array.from(out);
      stats.sections[name] = [(a.length / 9) | 0, n];
      continue;
    }
    if (LIFT && (name !== 'grass' || LIFT_GRASS)) {
      lctx.noTL = NO_TL.has(name);
      const n = liftCut(name, a, lctx, out, stats);
      tile.S[name] = Float32Array.from(out);
      stats.sections[name] = [(a.length / 9) | 0, n];
      continue;
    }
    // the campus: the compile draped each section at its own vertices over the McKim pads, so its sheets were not parallel
    // across a pad's ramp (an underlay triangle spanning a seam sat metres off the ground); there a section is laid again
    // at its own offset over the shared surface (the median of its vertices' offsets over the compiled grid)
    let offK = null;
    if (campusTile) {
      const d = [];
      for (let i = 0; i + 2 < a.length; i += 3) { const x = a[i] + ox, z = a[i + 2] + oz; if (inQuad(x, z)) d.push(a[i + 1] - (HA_BASE + pad(x, z))); }
      if (d.length) { d.sort((u, w) => u - w); offK = d[d.length >> 1]; }
    }
    let tin = 0, tout = 0, changed = false;
    const done = ((CUT === 'relay' || LIFT) && !campusTile && !NO_TL.has(name)) ? relayCut(name, a, ch, ox, oz, out, lowerC, fullOpaque, cand, stats) : null;
    if (done && done.n) { changed = true; tout += done.tout; }
    for (let i = 0; i + 8 < a.length; i += 9) {
      tin++;
      if (done && done.mask[i / 9]) continue;
      const A = [a[i] + ox, a[i + 1], a[i + 2] + oz], B = [a[i + 3] + ox, a[i + 4], a[i + 5] + oz], C = [a[i + 6] + ox, a[i + 7], a[i + 8] + oz];
      const x0 = Math.min(A[0], B[0], C[0]), x1 = Math.max(A[0], B[0], C[0]), z0 = Math.min(A[2], B[2], C[2]), z1 = Math.max(A[2], B[2], C[2]);
      if (x1 < RBOX[0] || x0 > RBOX[2] || z1 < RBOX[1] || z0 > RBOX[3]) { for (let k = 0; k < 9; k++) out.push(a[i + k]); tout++; continue; }
      candidates(ch, x0, z0, x1, z1, cand);
      if (!cand.some((t) => ch.tag[t] !== 255)) { for (let k = 0; k < 9; k++) out.push(a[i + k]); tout++; continue; }
      changed = true;
      const area2 = (B[0] - A[0]) * (C[2] - A[2]) - (C[0] - A[0]) * (B[2] - A[2]);
      if (Math.abs(area2) < 1e-3) {
        // a vertical face (a kerb, a wall course): split along its plan segment where it crosses the TIN's edges
        stats.faces++;
        const V = [A, B, C];
        let P = A, Q = B, best = -1;
        for (const [u, w] of [[A, B], [B, C], [C, A]]) { const dd = (u[0] - w[0]) ** 2 + (u[2] - w[2]) ** 2; if (dd > best) { best = dd; P = u; Q = w; } }
        const L2 = best > 1e-12 ? best : 1;
        const tOf = (p) => ((p[0] - P[0]) * (Q[0] - P[0]) + (p[2] - P[2]) * (Q[2] - P[2])) / L2;
        const cuts = new Set();
        for (const t of cand) {
          const seg = clipToTri([[P[0], 0, P[2]], [Q[0], 0, Q[2]], [Q[0], 0, Q[2]]], ch, t);
          for (const p of seg) { const s = tOf(p); if (s > 1e-6 && s < 1 - 1e-6) cuts.add(Math.round(s * 1e6) / 1e6); }
        }
        const padP = pad(P[0], P[2]), padQ = pad(Q[0], Q[2]);
        // the face in (s, y): cut by the lines s = c, each piece lifted by the TIN triangle under its middle
        let pieces = [V.map((p) => [tOf(p), p[1], 0])];
        for (const c of [...cuts].sort((u, w) => u - w)) {
          const nx = [];
          for (const pc of pieces) {
            const lo = [], hi = [];
            for (let k = 0; k < pc.length; k++) {
              const p = pc[k], q = pc[(k + 1) % pc.length], dp = p[0] - c, dq = q[0] - c;
              if (dp <= 0) lo.push(p);
              if (dp >= 0) hi.push(p);
              if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const r = dp / (dp - dq), I = [c, p[1] + (q[1] - p[1]) * r, 0]; lo.push(I); hi.push(I); }
            }
            if (lo.length >= 3) nx.push(lo);
            if (hi.length >= 3) nx.push(hi);
          }
          pieces = nx;
        }
        for (const pc of pieces) {
          let sm = 0;
          for (const p of pc) sm += p[0];
          sm /= pc.length;
          const mx = P[0] + (Q[0] - P[0]) * sm, mz = P[2] + (Q[2] - P[2]) * sm;
          const t = locate(ch, mx, mz);
          if (t >= 0 && ch.tag[t] < 255) {
            // a piece whose ends sit on two sides of a slit takes its middle's side (counted: a kerb or course across a wall)
            let lo = 1, hi = 0;
            for (const p of pc) { lo = Math.min(lo, p[0]); hi = Math.max(hi, p[0]); }
            for (const e of [lo, hi]) {
              const ex = P[0] + (Q[0] - P[0]) * e, ez = P[2] + (Q[2] - P[2]) * e, te = locate(ch, ex, ez);
              if (te >= 0 && Math.abs(relOf(ch, te) - relAt(ch, t, ex, ez)) > 0.05) { stats.slitFaces++; break; }
            }
          }
          for (let k = 1; k + 1 < pc.length; k++) {
            for (const p of [pc[0], pc[k], pc[k + 1]]) {
              const x = P[0] + (Q[0] - P[0]) * p[0], z = P[2] + (Q[2] - P[2]) * p[0];
              const dy = t >= 0 ? relAt(ch, t, x, z) - (padP + (padQ - padP) * p[0]) : 0;
              out.push(x - ox, p[1] + dy, z - oz);
            }
            tout++;
          }
        }
        continue;
      }
      let area = 0;
      const mark = out.length, mark2 = tout;
      // the campus pad comes off as the compile laid it: draped at the triangle's own vertices, linear between them
      const pA = pad(A[0], A[2]), pB = pad(B[0], B[2]), pC = pad(C[0], C[2]);
      const relaid = offK !== null && inQuad(A[0], A[2]) && inQuad(B[0], B[2]) && inQuad(C[0], C[2]);
      const padLin = pA === 0 && pB === 0 && pC === 0 ? () => 0 : (x, z) => {
        const w0 = ((B[2] - C[2]) * (x - C[0]) + (C[0] - B[0]) * (z - C[2])) / ((B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]));
        const w1 = ((C[2] - A[2]) * (x - C[0]) + (A[0] - C[0]) * (z - C[2])) / ((B[2] - C[2]) * (A[0] - C[0]) + (C[0] - B[0]) * (A[2] - C[2]));
        return pA * w0 + pB * w1 + pC * (1 - w0 - w1);
      };
      for (const t of cand) {
        const pc = clipToTri([A, B, C], ch, t);
        if (pc.length < 3) continue;
        const lift = ch.tag[t] === 255 ? null : t;
        if (lift !== null && ch.tag[t] < 3 && !NO_TL.has(name)) {
          let mn = Infinity;
          for (const p of pc) mn = Math.min(mn, relaid ? HA_BASE + offK + relAt(ch, t, p[0], p[2]) : p[1] + relAt(ch, t, p[0], p[2]) - padLin(p[0], p[2]));
          for (let k = 0; k < 3; k++) {
            const by = HA_BASE + ch.rel[3 * t + k];
            if (mn - 0.12 < by) lowerC[3 * t + k] = Math.min(lowerC[3 * t + k], Math.max(mn - 0.12, by - SINK_MAX));
          }
        }
        for (let k = 1; k + 1 < pc.length; k++) {
          const p0 = pc[0], p1 = pc[k], p2 = pc[k + 1];
          const cr = (p1[0] - p0[0]) * (p2[2] - p0[2]) - (p2[0] - p0[0]) * (p1[2] - p0[2]);
          if (Math.abs(cr) < 1e-9) continue;
          area += Math.abs(cr);
          for (const p of [p0, p1, p2]) out.push(p[0] - ox, relaid && lift !== null ? HA_BASE + offK + relAt(ch, t, p[0], p[2]) : p[1] + (lift === null ? 0 : relAt(ch, t, p[0], p[2]) - padLin(p[0], p[2])), p[2] - oz);
          tout++;
        }
      }
      // coverage: the pieces fill the triangle (the TIN and its zero-relief skirt cover the region's box); a triangle
      // reaching past the skirt (a river-long sliver) is kept whole (it lies on the zero-relief side)
      const ce = Math.abs(area - Math.abs(area2)) / Math.max(Math.abs(area2), 1e-6);
      if (ce > 1e-3) { out.length = mark; tout = mark2; for (let k = 0; k < 9; k++) out.push(a[i + k]); tout++; stats.uncovered = (stats.uncovered || 0) + 1; } else stats.coverErr = Math.max(stats.coverErr, ce);
    }
    if (changed) tile.S[name] = Float32Array.from(out);
    stats.sections[name] = [tin, tout];
    if (offK !== null) (stats.campusOffsets = stats.campusOffsets || {})[name] = +offK.toFixed(3);
  }
  if (shore && shore.out.length) { const c = tile.S.curb || new Float32Array(0), m = new Float32Array(c.length + shore.out.length); m.set(c); m.set(shore.out, c.length); tile.S.curb = m; }
  // (TERRAIN FIX: the swept walls' place in the curb soup, for haClampGround's last look at the land behind them)
  tile.p1Shore = shore && shore.vst ? { off: (tile.S.curb.length - shore.out.length) / 3, n: shore.out.length / 3, x0: shore.out[0], y0: shore.out[1], vst: shore.vst, stn: shore.stn } : null;
  // the road lines (the walks' edges, the drives) and the terrain grid (the legacy sampler, foundations): lifted at
  // their own points, as copies (the parsed sections are views into the tile's buffer)
  const lift = (x, z) => { const t = locate(ch, x, z); return t >= 0 && ch.tag[t] !== 255 ? relOf(ch, t) - pad(x, z) : 0; };
  if (tile.S.roadVerts) {
    const rv = (tile.S.roadVerts = Float32Array.from(tile.S.roadVerts));
    for (let k = 0; k + 2 < rv.length; k += 3) rv[k + 1] += lift(rv[k] + ox, rv[k + 2] + oz);
  }
  if (tile.S.terrain) {
    const n = res + 1, g = (tile.S.terrain = Float32Array.from(tile.S.terrain));
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const x = ox + (i / res) * TILE, z = oz + (j / res) * TILE, t = locate(ch, x, z);
      if (t >= 0 && ch.tag[t] < 3) g[j * n + i] += relOf(ch, t) - pad(x, z);
    }
  }
  // the base's sinking shared by the corners on one vertex at one height (so the base stays closed)
  const byV = new Map();
  for (let c = 0; c < 3 * ch.nT; c++) {
    if (lowerC[c] === Infinity) continue;
    const v = ch.tri[c], k = `${v}|${ch.rel[c].toFixed(4)}`;
    byV.set(k, Math.min(byV.get(k) ?? Infinity, lowerC[c]));
  }
  const baseY = (t, k) => {
    const y = HA_BASE + ch.rel[3 * t + k];
    if (!byV.size) return y;
    const l = byV.get(`${ch.tri[3 * t + k]}|${ch.rel[3 * t + k].toFixed(4)}`);
    if (l !== undefined && l < y) { stats.baseLowered++; return l; }
    return y;
  };
  // the region's drawn base: its TIN triangles (ground, footprints, faces) clipped to the tile square, wound up
  const base = [];
  const sq = (P) => {
    let out = P;
    for (const [ax, sgn, c] of [[0, 1, ox], [0, -1, ox + TILE], [2, 1, oz], [2, -1, oz + TILE]]) {
      if (out.length < 3) return out;
      const src = out;
      out = [];
      for (let k = 0; k < src.length; k++) {
        const p = src[k], q = src[(k + 1) % src.length], dp = sgn * (p[ax] - c), dq = sgn * (q[ax] - c);
        if (dp >= 0) out.push(p);
        if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) { const r = dp / (dp - dq); out.push([p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r, p[2] + (q[2] - p[2]) * r]); }
      }
    }
    return out;
  };
  stats.baseSkipped = 0;
  for (let t = 0; t < ch.nT; t++) {
    if (ch.tag[t] >= 3) continue;
    if (fullOpaque[t]) { stats.baseSkipped++; continue; }
    const v = [0, 1, 2].map((k) => { const q = ch.tri[3 * t + k]; return [ch.x[q], baseY(t, k), ch.z[q]]; });
    const pc = sq(v);
    if (pc.length < 3) continue;
    for (let k = 1; k + 1 < pc.length; k++) {
      let p0 = pc[0], p1 = pc[k], p2 = pc[k + 1];
      const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
      if (Math.abs(ny) < 1e-10) continue;
      if (ny < 0) { const tmp = p1; p1 = p2; p2 = tmp; }
      for (const p of [p0, p1, p2]) base.push(p[0] - ox, p[1], p[2] - oz);
    }
  }
  tile.S.terrP1 = Float32Array.from(base);
  wallFaces(tile, ch, ox, oz, stats);
  if (shore) shoreCheck(tile, ox, oz, shore.probes, stats);
  tile.p1 = { stats, baseTris: base.length / 9 };
  if (globalThis.__P1_KEEP) tile.p1.fullOpaque = fullOpaque;   // (the probes' and tools' view of the base's coverage)
  haStats.set(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`, tile.p1);
  return tile.p1;
}

// The drawn 16 m grid in a region tile (world/assemble.js's ground block): a cell wholly inside the region is not drawn
// (the region's base is), and a grid point of a cell the boundary crosses sinks 0.3 m under the lowest base around it
// (so the grid never shows through the region's base). Returns the per-cell skip mask, edits terrDraw in place.
export function haGridDraw(tile, ox, oz, terrDraw) {
  const ch = CH.get(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`);
  if (!FLAG || !ch) return null;
  const res = tile.header.res, n = res + 1, cw = TILE / res;
  const inside = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) inside[j * n + i] = haInRegion(ox + i * cw, oz + j * cw) ? 1 : 0;
  const skip = new Uint8Array(res * res), cellMin = new Float32Array(res * res).fill(Infinity);
  for (let t = 0; t < ch.nT; t++) {
    if (ch.tag[t] >= 3) continue;
    const a = ch.tri[3 * t], b = ch.tri[3 * t + 1], c = ch.tri[3 * t + 2];
    const m = Math.min(ch.rel[3 * t], ch.rel[3 * t + 1], ch.rel[3 * t + 2]);
    const i0 = Math.max(0, Math.floor((Math.min(ch.x[a], ch.x[b], ch.x[c]) - ox) / cw)), i1 = Math.min(res - 1, Math.floor((Math.max(ch.x[a], ch.x[b], ch.x[c]) - ox) / cw));
    const j0 = Math.max(0, Math.floor((Math.min(ch.z[a], ch.z[b], ch.z[c]) - oz) / cw)), j1 = Math.min(res - 1, Math.floor((Math.max(ch.z[a], ch.z[b], ch.z[c]) - oz) / cw));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cellMin[j * res + i] = Math.min(cellMin[j * res + i], m);
  }
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const k = [j * n + i, j * n + i + 1, (j + 1) * n + i, (j + 1) * n + i + 1];
    const nin = inside[k[0]] + inside[k[1]] + inside[k[2]] + inside[k[3]];
    if (nin === 4) { skip[j * res + i] = 1; continue; }
    if (nin > 0 || cellMin[j * res + i] < Infinity) {
      const lo = HA_BASE + Math.min(0, cellMin[j * res + i] === Infinity ? 0 : cellMin[j * res + i]) - 0.3;
      for (const q of k) terrDraw[q] = Math.min(terrDraw[q], lo);
    }
  }
  return skip;
}

// A building's lift and foundation in the region (world/assemble.js): ring = footprint [[x, z] ...] (world). The lift is
// the median relief round the footprint less the campus pad (the ground floor then settles on the lifted pavement by the
// page's own padUnderRing); low = the lowest drawn base round it (the foundation's floor: the plinth reaches it), or null
// outside the region.
export function haBuildingGround(ring, tile, ox, oz) {
  const ch = CH.get(`${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`);
  if (!FLAG || !ch || !ring || ring.length < 3) return null;
  const grid0 = tile && tile.p1Grid0 ? tile.p1Grid0 : null;
  const rels = [];
  let low = Infinity, any = false;
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L));
    for (let s = 0; s < m; s++) {
      const x = ax + ((bx - ax) * s) / m, z = az + ((bz - az) * s) / m;
      const q = haInfo(x, z);
      if (!q || q.tag >= 3) continue;
      any = true;
      rels.push(q.relief - (grid0 ? padOf(grid0, tile.header.res, ox, oz, x, z) : 0));
      low = Math.min(low, HA_BASE + q.relief);
    }
  }
  if (!any) return null;
  rels.sort((u, w) => u - w);
  return { lift: rels[rels.length >> 1], low, n: rels.length };
}

// TERRAIN FIX: the drawn natural ground never stands over paving. Run last on a region tile (after the held decks and
// cuts are restored and Central Park's parts applied): every paved section's vertices, edge midpoints and centroids are
// located in the base (terrP1) and the lawns; where the ground there stands over the paving (the base at all, a lawn
// by more than 14 cm: planting beds lie 5-13 cm over their walks by design), the ground triangle's three corners are
// lowered by the excess plus a margin, and every copy of a lowered corner moves with it (no cracks). Where a ground
// corner lies on paving it is held under it as well. `?terrainClamp=0` / TERRAIN_CLAMP=0: off.
const CPR = []; for (let i = 0; i < CP_PARK.length; i += 2) CPR.push([CP_PARK[i] / 10, CP_PARK[i + 1] / 10]);
const CPB = CPR.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [1e9, -1e9, 1e9, -1e9]);
// (SHIP-MN: a 16 m grid over the park's box, each square inside, outside or on the outline (an edge's box touches it): the
// first two answer at once, the outline squares by the exact test; the same answers, ~10x fewer polygon walks)
let CPGRID = null; const CPG = 16;
export function cpExact(x, z) {
  let c = false;
  for (let i = 0, j = CPR.length - 1; i < CPR.length; j = i++) { const [xi, zi] = CPR[i], [xj, zj] = CPR[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
function cpGrid() {
  const nx = Math.ceil((CPB[1] - CPB[0]) / CPG) + 1, nz = Math.ceil((CPB[3] - CPB[2]) / CPG) + 1, g = new Uint8Array(nx * nz);
  for (let i = 0, j = CPR.length - 1; i < CPR.length; j = i++) {
    const x0 = Math.floor((Math.min(CPR[i][0], CPR[j][0]) - CPB[0]) / CPG) - 1, x1 = Math.floor((Math.max(CPR[i][0], CPR[j][0]) - CPB[0]) / CPG) + 1;
    const z0 = Math.floor((Math.min(CPR[i][1], CPR[j][1]) - CPB[2]) / CPG) - 1, z1 = Math.floor((Math.max(CPR[i][1], CPR[j][1]) - CPB[2]) / CPG) + 1;
    for (let q = Math.max(0, z0); q <= Math.min(nz - 1, z1); q++) for (let k = Math.max(0, x0); k <= Math.min(nx - 1, x1); k++) g[q * nx + k] = 2;
  }
  for (let q = 0; q < nz; q++) for (let k = 0; k < nx; k++) if (g[q * nx + k] !== 2) g[q * nx + k] = cpExact(CPB[0] + (k + 0.5) * CPG, CPB[2] + (q + 0.5) * CPG) ? 1 : 0;
  return { g, nx, nz };
}
export function haInCentralPark(x, z) {
  if (x < CPB[0] || x > CPB[1] || z < CPB[2] || z > CPB[3]) return false;
  if (!CPGRID) CPGRID = cpGrid();
  const v = CPGRID.g[Math.floor((z - CPB[2]) / CPG) * CPGRID.nx + Math.floor((x - CPB[0]) / CPG)];
  if (v !== 2) return v === 1;
  let c = false;
  for (let i = 0, j = CPR.length - 1; i < CPR.length; j = i++) { const [xi, zi] = CPR[i], [xj, zj] = CPR[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
export const HA_PAVED = ['asphalt', 'sidewalk', 'path', 'plaza', 'brick', 'gutter', 'gravel', 'apron'];
const CLAMP_OFF = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('terrainClamp') === '0') || (typeof process !== 'undefined' && process.env && process.env.TERRAIN_CLAMP === '0');
// PORTAL FIX: a structure that stands on its own fill or bed in the ground (the IRT approach at 122nd St, city/vk/viaducts.js)
// registers its footprint as a cap fn(x, z) -> the world y the ground may not rise over there (null outside): the LiDAR
// bare earth under such a structure holds the structure's own walls, fences and vents as 'ground', a crumpled sheet that
// stood through its bed. The terrain and lawn vertices inside come down to the cap, after the rail cut and again last
const GROUND_CAPS = [];
export function haGroundCap(fn) { if (typeof fn === 'function') GROUND_CAPS.push(fn); }
function capGround(tile, st) {
  if (!GROUND_CAPS.length) return;
  const [ox, oz] = tile.header.origin;
  let n = 0;
  for (const nm of ['terrP1', 'grass', 'grassU']) {
    const a = tile.S[nm];
    if (!a || a.length < 9) continue;
    for (let i = 0; i + 2 < a.length; i += 3) {
      let c = Infinity;
      for (const f of GROUND_CAPS) { const y = f(a[i] + ox, a[i + 2] + oz); if (y !== null && y !== undefined && y < c) c = y; }
      if (a[i + 1] > c) { a[i + 1] = c; n++; }
    }
  }
  st.caps = (st.caps || 0) + n;
}
export function haClampGround(tile) {
  if (CLAMP_OFF || !FLAG || !tile || !tile.S) return null;
  const st = { base: 0, grass: 0, maxDrop: 0, passes: 0 };
  railCutStructure(tile, st);   // (first: the clamp then keeps its re-laid ground off the paving too)
  capGround(tile, st);   // (PORTAL FIX)
  const TG0 = Date.now(); gradeDrapePaths(tile, st);   // (TERRAIN GRADE: park walks held far under a hill laid on it)
  const TG1 = Date.now(); st.cut = gradeCut(tile); if (st.cut) st.cut.ms = { drape: TG1 - TG0, cut: Date.now() - TG1 };   // (TERRAIN GRADE: the ground cut along every paving, kerb, coping and wall-cap edge)
  if (st.cut) gradeStrips(tile, st.cut);   // (and laid between two facing edges in a narrow strip)
  if (isNode && process.env.GRADE_XDBG) st.cut.x1 = gradeCrossings(tile).n;
  const pre = {}; for (const n of ['terrP1', 'grass', 'grassU']) if (tile.S[n]) pre[n] = tile.S[n].slice();   // (TERRAIN GRADE: the ground as laid)
  // (lowering moves shared corners: a second pass sees the new ground; three at most)
  for (let k = 0; k < 3; k++) { const n = st.base + st.grass; clampOnce(tile, st); st.passes++; if (st.base + st.grass === n) break; }
  // TERRAIN GRADE (world/terrainGrade.js): the ground meets every paving edge at its level and blends back to the natural
  // surface at its surface's slope, retaining walls where the band is not there; then the clamp again (never over paving)
  const gr = gradeGround(tile, pre);
  if (isNode && process.env.GRADE_XDBG && st.cut) st.cut.x2 = gradeCrossings(tile).n;
  if (gr) { st.grade = gr; for (let k = 0; k < 3; k++) { const n = st.base + st.grass; clampOnce(tile, st); if (st.base + st.grass === n) break; } }
  if (isNode && process.env.GRADE_XDBG && st.cut) st.cut.x3 = gradeCrossings(tile).n;
  // a building set into a hillside (its at-grade ground more than 3 m over its floor along a facade): the ground in a
  // 0.8 m band outside its walls comes down to 2.9 m over the floor (an areaway, the retained bank behind it), so the
  // floor's own raise (haBuildingFloor, at most 3.5 m) clears it and no window stands in the ground
  const band = buildingBands(tile);
  if (band) { st.bands = band.n; for (let k = 0; k < 3; k++) { const n = st.base + st.grass; clampOnce(tile, st, band.soup); if (st.base + st.grass === n) break; } }
  // (until no land stands over a cap, eight passes at most: a raised cap can find a higher bank within its new reach)
  for (let k = 0; k < 8; k++) { shoreRaise(tile, st); if (!st.shoreBuried) break; }
  if (st.grade) baseUnderLawn(tile, st.grade);   // (TERRAIN GRADE: last: the base under the lawns as every pass left them)
  capGround(tile, st);   // (PORTAL FIX: and last, over whatever the passes raised)
  delete st.cpDrop;
  if (tile.p1) tile.p1.clamp = st;
  return st;
}
// TERRAIN FIX: the swept shore walls' last look at the land behind them, once everything is laid (held decks and roads
// behind a wall are not in the relief the sweep read): a station whose land 1.5 m behind its cap stands within 0.1 m of
// the cap or over it raises its wall (cap, face top, skirt), the raise spread along the run (a max over 3 m, then a
// 3 m Gaussian) so the top stays smooth
// (TERRAIN INT2: a walk or ramp standing 0.5 m and more over a cap rises behind the wall on its own structure (the East
// River esplanade's ramps by the FDR at 63rd Street): it is not the land the wall holds)
const rampOver = (t, y) => HA_PAVED.includes(t.kind) && t.y - y > 0.5;
function shoreRaise(tile, st) {
  const P = tile.p1Shore, c = tile.S.curb;
  if (!P || !c || c.length < (P.off + P.n) * 3 || c[P.off * 3] !== Math.fround(P.x0) || c[P.off * 3 + 1] !== Math.fround(P.y0)) return;
  const [ox, oz] = tile.header.origin;
  const top = topSampler(tile, [...TOP_KINDS.filter((k) => k !== 'curb'), 'terrP1']);
  const ns = P.stn.length / 6, need = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    const x = P.stn[6 * i] + P.stn[6 * i + 2] * 1.5 - ox, z = P.stn[6 * i + 1] + P.stn[6 * i + 3] * 1.5 - oz, y = P.stn[6 * i + 4];
    let t = top(x, z, y - 6, y + 2.5);   // (not a deck or stair standing over the wall)
    if (t && rampOver(t, y)) t = top(x, z, y - 6, y + 0.5);   // (the land under a ramp)
    if (t && t.y + 0.1 > y) need[i] = t.y + 0.1 - y;
  }
  const raise = new Float64Array(ns);
  for (let i = 0; i < ns; i++) {
    let m = 0, s = 0, w = 0;
    for (let j = -6; j <= 6; j++) {
      const k = i + j;
      if (k < 0 || k >= ns || P.stn[6 * k + 5] !== P.stn[6 * i + 5]) continue;
      if (Math.abs(j) <= 3) m = Math.max(m, need[k]);
    }
    for (let j = -6; j <= 6; j++) {
      const k = i + j;
      if (k < 0 || k >= ns || P.stn[6 * k + 5] !== P.stn[6 * i + 5]) continue;
      let mk = 0;
      for (let e = -3; e <= 3; e++) { const q = k + e; if (q >= 0 && q < ns && P.stn[6 * q + 5] === P.stn[6 * i + 5]) mk = Math.max(mk, need[q]); }
      const ww = Math.exp(-(j * j) / 18); s += mk * ww; w += ww;
    }
    raise[i] = Math.max(need[i], w ? s / w : m);
  }
  let nr = 0;
  for (let v = 0; v < P.n; v++) { const si = P.vst[v]; if (si >= 0 && raise[si] > 0) { c[(P.off + v) * 3 + 1] += raise[si]; nr++; } }
  const y0s = new Float64Array(ns);
  for (let i = 0; i < ns; i++) { y0s[i] = P.stn[6 * i + 4]; P.stn[6 * i + 4] += raise[i]; }
  let buried = 0;
  st.shoreBuriedAt = [];
  for (let i = 0; i < ns; i++) {
    const x = P.stn[6 * i] + P.stn[6 * i + 2] * 1.5 - ox, z = P.stn[6 * i + 1] + P.stn[6 * i + 3] * 1.5 - oz, y = P.stn[6 * i + 4];
    // (a surface more than 1.5 m over the raised cap is a deck or a stair over the wall, not the land it holds)
    let t = top(x, z, y - 6, y + 1.5);
    if (t && rampOver(t, y0s[i])) t = top(x, z, y - 6, y0s[i] + 0.5);   // (a ramp as the cap stood before the raise)
    if (t && t.y > y - 0.05) { buried++; if ((st.shoreBuriedAt = st.shoreBuriedAt || []).length < 6) st.shoreBuriedAt.push([+(x + ox).toFixed(1), +(z + oz).toFixed(1), +(t.y - y).toFixed(2), t.kind, +raise[i].toFixed(2)]); }
  }
  st.shoreRaised = (st.shoreRaised || 0) + nr; st.shoreBuried = buried; st.shoreStations = ns;
}
// TERRAIN FIX: the compiled rail cuts' walls (rwall) took the ground's relief at each of their points, so their tops
// sawtoothed with the ground's triangles along the Amtrak cut: a wall's top point is raised to the highest relief within
// 1.5 m (a smooth envelope of the bank it holds), its foot left where the cut floor is; every copy of a point moves alike
function railTops(tile, st) {
  const a = tile.S.rwall;
  if (!a || a.length < 9) return;
  const [ox, oz] = tile.header.origin, key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const top = new Map();
  for (let i = 0; i + 8 < a.length; i += 9) {
    if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) >= 1e-3) continue;   // (vertical faces only)
    for (let k = 0; k < 3; k++) { const kk = key(a[i + 3 * k], a[i + 3 * k + 2]); top.set(kk, Math.max(top.get(kk) ?? -Infinity, a[i + 3 * k + 1])); }
  }
  const lift = new Map();
  const R = [[0, 0], [1.5, 0], [-1.5, 0], [0, 1.5], [0, -1.5], [1.06, 1.06], [-1.06, 1.06], [1.06, -1.06], [-1.06, -1.06], [0.75, 0], [-0.75, 0], [0, 0.75], [0, -0.75]];
  for (const kk of top.keys()) {
    const [xs, zs] = kk.split(',').map(Number), x = xs / 1000 + ox, z = zs / 1000 + oz;
    const r0 = haRelief(x, z);
    if (r0 === null || Number.isNaN(r0)) continue;
    let m = r0;
    for (const [dx, dz] of R) { const r = haRelief(x + dx, z + dz); if (r !== null && !Number.isNaN(r)) m = Math.max(m, r); }
    if (m - r0 > 0.01) lift.set(kk, Math.min(3, m - r0));
  }
  let n = 0;
  for (let i = 0; i + 2 < a.length; i += 3) {
    const kk = key(a[i], a[i + 2]), d = lift.get(kk);
    if (d && Math.abs(a[i + 1] - top.get(kk)) < 1e-4) { a[i + 1] += d; n++; }
  }
  st.railTops = n;
}
// TERRAIN FIX: the rail corridor as one structure, from the drawn rails (railRects): their cells chained into runs, the
// centreline resampled every metre, smoothed (6 m) and centred on the rails' span, one cross-section swept along it: the
// bed's level (the drawn ballast, smoothed 5 m) and a bed strip 6 cm under it from line to line; on a cut side (the bank
// 0.6 m over the bed) a concrete wall from the bed to a coping on the bank's envelope (the relief 1 m behind the wall, a
// running maximum over 3 m then a 3 m Gaussian, never over paving along it), 0.5 m wide; on an open side a 2.5 m swept
// shoulder from the bed's edge to the drawn ground. The ground is clipped along each side's line (the wall, or the
// shoulder's foot): under the bed and shoulder inside, meeting the coping or the foot outside, so no triangle crosses the
// line (no sawtooth, no gap); the compiled cut walls, kerb parapets and rock faces in the corridor and the compiled
// ballast's stepped shoulders are dropped. On under the terrain flag.
const RAILCUT_OFF = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('railCut') === '0') || (typeof process !== 'undefined' && process.env && process.env.TERRAIN_RAILCUT === '0');   // (on under the terrain flag; `?railCut=0` / TERRAIN_RAILCUT=0 for the compiled pieces)
// the corridor from the drawn rails themselves (the tile's rsteel soup): the rails' flat faces binned in 16 m cells, each
// cell a rectangle [x, z, yaw, halfLen, halfW] on the rails' mean and principal axis, its half width the outermost rail
// plus 2.6 m of clearance (the RL36 rectangles of the compile need not contain the rails)
function railRects(tile) {
  const a = tile.S.rsteel, out = [];
  out.pts = [];
  if (!a || a.length < 9) return out;
  const [ox, oz] = tile.header.origin, B = new Map();
  for (let i = 0; i + 8 < a.length; i += 9) {
    if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-4) continue;
    const x = (a[i] + a[i + 3] + a[i + 6]) / 3, z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
    if (!haInRegion(x + ox, z + oz)) continue;
    const k = `${Math.floor(x / 16)},${Math.floor(z / 16)}`;
    let l = B.get(k); if (!l) B.set(k, (l = [])); l.push(x, z);
    out.pts.push(x, z);
  }
  for (const l of B.values()) {
    const n = l.length / 2;
    if (n < 6) continue;
    let mx = 0, mz = 0; for (let i = 0; i < l.length; i += 2) { mx += l[i]; mz += l[i + 1]; } mx /= n; mz /= n;
    let cxx = 0, czz = 0, cxz = 0; for (let i = 0; i < l.length; i += 2) { const dx = l[i] - mx, dz = l[i + 1] - mz; cxx += dx * dx; czz += dz * dz; cxz += dx * dz; }
    const yaw = 0.5 * Math.atan2(2 * cxz, cxx - czz), c = Math.cos(yaw), s = Math.sin(yaw);
    let lat = 0, lo = Infinity, hi = -Infinity;
    for (let i = 0; i < l.length; i += 2) { const dx = l[i] - mx, dz = l[i + 1] - mz, al = dx * c + dz * s; lat = Math.max(lat, Math.abs(-dx * s + dz * c)); lo = Math.min(lo, al); hi = Math.max(hi, al); }
    if (hi - lo < 6 || lat > 9) continue;   // (a crossing's stub or a yard's fan: no corridor)
    out.push([mx, mz, yaw, 8, lat + 2.6]);
  }
  return out;
}
function railCutStructure(tile, st) {
  if (RAILCUT_OFF || !tile.S) return;
  const R = railRects(tile), RP = R.pts || [], RH = new Map();   // (RH: the rail points by 8 m cell, each listed in its 3 x 3 neighbours)
  for (let j = 0; j < RP.length; j += 2) { const ci = Math.floor(RP[j] / 8), cj = Math.floor(RP[j + 1] / 8); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const hk = `${ci + a},${cj + b}`; let l = RH.get(hk); if (!l) RH.set(hk, (l = [])); l.push(j); } }
  if (typeof window !== 'undefined') (window.__RAILCUT = window.__RAILCUT || {})[tile.header.origin.join('_') + ':rects'] = R.length;
  if (!R.length) return;
  const [ox, oz] = tile.header.origin, S = tile.S;
  // chain the rectangles (centres within 20 m, heading within 40 deg)
  const used = new Uint8Array(R.length), runs = [];
  const near = (k, x, z, yaw) => { let b = -1, bd = 20; for (let q = 0; q < R.length; q++) { if (used[q]) continue; const d = Math.hypot(R[q][0] - x, R[q][1] - z); let dy = Math.abs(R[q][2] - yaw) % Math.PI; dy = Math.min(dy, Math.PI - dy); if (d < bd && dy < 0.7) { bd = d; b = q; } } return b; };
  for (let k0 = 0; k0 < R.length; k0++) {
    if (used[k0]) continue;
    used[k0] = 1;
    const run = [k0];
    for (let e = 0; e < 2; e++) {
      for (;;) {
        const end = e ? run[run.length - 1] : run[0], q = near(end, R[end][0], R[end][1], R[end][2]);
        if (q < 0) break;
        used[q] = 1;
        if (e) run.push(q); else run.unshift(q);
      }
      if (!e) { /* (the first pass grew the front; reverse sense for the back) */ }
    }
    // (order the run along its own line: by projection on the first-to-last direction)
    if (run.length >= 2) {
      const a = R[run[0]], b = R[run[run.length - 1]], dx = b[0] - a[0], dz = b[1] - a[1];
      run.sort((u, w) => (R[u][0] - a[0]) * dx + (R[u][1] - a[1]) * dz - ((R[w][0] - a[0]) * dx + (R[w][1] - a[1]) * dz));
    }
    if (run.length >= 3) runs.push(run);
  }
  if (!runs.length) return;
  const gauss = (v, sig) => { const n = v.length, r = Math.ceil(2.5 * sig), o = new Float64Array(n); for (let i = 0; i < n; i++) { const rr = Math.min(r, i, n - 1 - i); let s2 = 0, w = 0; for (let j = -rr; j <= rr; j++) { const ww = Math.exp(-(j * j) / (2 * sig * sig)); s2 += v[i + j] * ww; w += ww; } o[i] = s2 / w; } return o; };
  const gaussF = (v, sig) => { const n = v.length, r = Math.ceil(2.5 * sig), o = new Float64Array(n); for (let i = 0; i < n; i++) { let s2 = 0, w = 0; for (let j = -r; j <= r; j++) { const k = i + j; if (k < 0 || k >= n || !Number.isFinite(v[k])) continue; const ww = Math.exp(-(j * j) / (2 * sig * sig)); s2 += v[k] * ww; w += ww; } o[i] = w ? s2 / w : NaN; } return o; };
  const walls = [], bed = [], ST = [], BW = [], RUN0 = [], GY = [], SK = 2.5;   // (BW: each run's bed half widths [+n side, -n side]; stations of every run, for the ground: [x, z, nx, nz, hw, floor, topL, topR, run])
  let nRuns = 0;
  for (const run of runs) {
    // the centreline through the rectangles' centres (and the two outer ends), resampled every metre
    const P = run.map((k) => [R[k][0], R[k][1]]);
    { const f = R[run[0]], l = R[run[run.length - 1]], c0 = Math.cos(f[2]), s0 = Math.sin(f[2]), c1 = Math.cos(l[2]), s1 = Math.sin(l[2]);
      const d0 = Math.sign((P[0][0] - P[1][0]) * c0 + (P[0][1] - P[1][1]) * s0) || 1, d1 = Math.sign((P[P.length - 1][0] - P[P.length - 2][0]) * c1 + (P[P.length - 1][1] - P[P.length - 2][1]) * s1) || 1;
      P.unshift([f[0] + c0 * f[3] * d0, f[1] + s0 * f[3] * d0]); P.push([l[0] + c1 * l[3] * d1, l[1] + s1 * l[3] * d1]); }
    let tot = 0; const cum = [0];
    for (let i = 1; i < P.length; i++) { tot += Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); cum.push(tot); }
    if (tot < 6) continue;
    const n = Math.round(tot) + 1, X = new Float64Array(n), Z = new Float64Array(n);
    for (let i = 0, j = 0; i < n; i++) { const sv = (tot * i) / (n - 1); while (j < cum.length - 2 && cum[j + 1] < sv) j++; const f = cum[j + 1] > cum[j] ? (sv - cum[j]) / (cum[j + 1] - cum[j]) : 0; X[i] = P[j][0] + (P[j + 1][0] - P[j][0]) * f; Z[i] = P[j][1] + (P[j + 1][1] - P[j][1]) * f; }
    let Xs = gauss(X, 6), Zs = gauss(Z, 6);
    const NX = new Float64Array(n), NZ = new Float64Array(n);
    const normals = () => { for (let i = 0; i < n; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), tx = Xs[b] - Xs[a], tz = Zs[b] - Zs[a], L = Math.hypot(tx, tz) || 1; NX[i] = -tz / L; NZ[i] = tx / L; } };
    normals();
    // centred on the rails: each station's rails within 4 m along it give the span's middle (smoothed 6 m) and half width;
    // the run's half width is the 90th percentile of those plus 2.6 m of clearance
    const spans = [];
    for (let pass = 0; pass < 2; pass++) {
      const sh = new Float64Array(n).fill(NaN); spans.length = 0;
      for (let i = 0; i < n; i++) {
        let lo = Infinity, hi = -Infinity;
        for (const j of RH.get(`${Math.floor(Xs[i] / 8)},${Math.floor(Zs[i] / 8)}`) || []) {
          const dx = RP[j] - Xs[i], dz = RP[j + 1] - Zs[i], al = -dx * NZ[i] + dz * NX[i], lt = dx * NX[i] + dz * NZ[i];
          if (Math.abs(al) < 4 && Math.abs(lt) < 10) { lo = Math.min(lo, lt); hi = Math.max(hi, lt); }
        }
        if (hi >= lo) { sh[i] = (lo + hi) / 2; spans.push((hi - lo) / 2); }
      }
      const shs = gaussF(sh, 6);
      Xs = Float64Array.from(Xs, (v, i) => v + (Number.isFinite(shs[i]) ? NX[i] * shs[i] : 0));
      Zs = Float64Array.from(Zs, (v, i) => v + (Number.isFinite(shs[i]) ? NZ[i] * shs[i] : 0));
      normals();
    }
    if (spans.length < 6) continue;
    spans.sort((u, w) => u - w);
    const hw = spans[Math.floor(spans.length * 0.9)] + 2.6;
    // the bed: the drawn ballast / rails at the centre (their top), smoothed 5 m
    const FL = new Float64Array(n);
    for (let i = 0; i < n; i++) { let m = NaN; for (const nm of ['rbal', 'rsteel']) for (const y of soupYs(S[nm], Xs[i], Zs[i])) if (!(y <= m)) m = Number.isNaN(m) ? y : Math.min(m, y); FL[i] = m; }
    if (FL.every((v) => Number.isNaN(v))) continue;
    const FLs = gaussF(FL, 5);
    // the copings: the bank 1 m behind each wall, a running maximum over 3 m, a 3 m Gaussian
    const tops = [1, -1].map((sg) => {
      const raw = new Float64Array(n);
      for (let i = 0; i < n; i++) { const r = haRelief(Xs[i] + ox + NX[i] * sg * (hw + 1.0), Zs[i] + oz + NZ[i] * sg * (hw + 1.0)); raw[i] = r === null || Number.isNaN(r) ? NaN : HA_BASE + r + 0.3; }
      const mx = new Float64Array(n);
      for (let i = 0; i < n; i++) { let v = -Infinity; for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) if (Number.isFinite(raw[j])) v = Math.max(v, raw[j]); mx[i] = Number.isFinite(v) ? v : NaN; }
      // (never over a walk or road that runs along the wall: the coping comes down to the paving 0.3-1.5 m behind it)
      const T = gaussF(mx, 3);
      for (let i = 0; i < n; i++) for (const d of [0.3, 0.9, 1.5]) for (const nm of ['path', 'sidewalk', 'asphalt', 'plaza', 'gravel', 'brick']) for (const y of soupYs(S[nm], Xs[i] + NX[i] * sg * (hw + d), Zs[i] + NZ[i] * sg * (hw + d))) if (y > FLs[i] + 0.6 && y < T[i]) T[i] = y;
      return T;
    });
    nRuns++;
    RUN0[nRuns] = ST.length / 9;
    for (let i = 0; i < n; i++) ST.push(Xs[i], Zs[i], NX[i], NZ[i], hw, FLs[i], tops[0][i], tops[1][i], nRuns);
    // the drawn bed's half width each side (the ballast, ties and rails out from the centreline, a 0.75 m gap ends it):
    // the run's median, where an open side's ground meets the bed
    BW[nRuns] = [1, -1].map((sg) => {
      const w = [];
      for (let i = 0; i < n; i += 2) {
        let last = -1;
        for (let d = 0; d <= hw; d += 0.25) {
          const x = Xs[i] + NX[i] * sg * d, z = Zs[i] + NZ[i] * sg * d;
          if (['rbal', 'rtop', 'rsteel'].some((nm) => soupYs(S[nm], x, z).length)) last = d; else if (last >= 0 && d - last > 0.75) break;
        }
        if (last > 0) w.push(last);
      }
      if (w.length < 3) return 0;
      w.sort((u, v) => u - v);
      return Math.min(w[w.length >> 1], hw - 0.1);
    });
    // the bed: one swept strip 6 cm under the drawn bed, from line to line (the bed's edge on an open side, the wall on a
    // cut side), so the stepped edges of the compiled ballast lie on a continuous bed and no ground shows through them
    const bwR = BW[nRuns];
    // the shoulders: on an open side the bed falls in one swept slope over SK m to the drawn ground there (smoothed 3 m,
    // never over the bed)
    GY[nRuns] = [1, -1].map((sg, k) => {
      const g = new Float64Array(n), w = Math.max(bwR[k], 0.5) + SK;
      for (let i = 0; i < n; i++) {
        const x = Xs[i] + NX[i] * sg * w, z = Zs[i] + NZ[i] * sg * w;
        let m = NaN; for (const nm of ['terrP1', 'grass', 'grassU']) for (const y of soupYs(S[nm], x, z)) if (!(y <= m)) m = y;
        if (Number.isNaN(m)) { const r = haRelief(x + ox, z + oz); m = r === null || Number.isNaN(r) ? NaN : HA_BASE + r; }
        g[i] = m;
      }
      const gs = gaussF(g, 3);
      for (let i = 0; i < n; i++) gs[i] = Number.isFinite(gs[i]) ? Math.min(gs[i], FLs[i] - 0.06) : FLs[i] - 0.06;
      return gs;
    });
    if (bwR[0] > 0.5 || bwR[1] > 0.5) {
      const edge = (i, k) => (Number.isFinite(FLs[i]) && tops[k][i] - FLs[i] > 0.6 ? hw : Math.max(bwR[k], 0.5));
      for (let i = 0; i + 1 < n; i++) {
        if (!Number.isFinite(FLs[i]) || !Number.isFinite(FLs[i + 1])) continue;
        const pt = (j, sg, k) => [Xs[j] + NX[j] * sg * edge(j, k), FLs[j] - 0.06, Zs[j] + NZ[j] * sg * edge(j, k)];
        const P0 = pt(i, 1, 0), P1 = pt(i, -1, 1), Q0 = pt(i + 1, 1, 0), Q1 = pt(i + 1, -1, 1);
        for (const [u, v, w] of [[P0, P1, Q1], [P0, Q1, Q0]]) { const up = (v[2] - u[2]) * (w[0] - u[0]) - (v[0] - u[0]) * (w[2] - u[2]); if (up >= 0) bed.push(...u, ...v, ...w); else bed.push(...u, ...w, ...v); }
        for (const [sg, k] of [[1, 0], [-1, 1]]) {
          if (edge(i, k) === hw || edge(i + 1, k) === hw) continue;   // (a cut side: the wall)
          const G = GY[nRuns][k], o = Math.max(bwR[k], 0.5) + SK;
          const A1 = [Xs[i] + NX[i] * sg * o, G[i], Zs[i] + NZ[i] * sg * o], B1 = [Xs[i + 1] + NX[i + 1] * sg * o, G[i + 1], Zs[i + 1] + NZ[i + 1] * sg * o];
          const A0 = sg > 0 ? P0 : P1, B0 = sg > 0 ? Q0 : Q1;
          for (const [u, v, w] of [[A0, A1, B1], [A0, B1, B0]]) { const up = (v[2] - u[2]) * (w[0] - u[0]) - (v[0] - u[0]) * (w[2] - u[2]); if (up >= 0) bed.push(...u, ...v, ...w); else bed.push(...u, ...w, ...v); }
        }
      }
    }
    // the walls (facing the track) and their copings, one sweep per side
    for (const [k, sg] of [[0, 1], [1, -1]]) {
      const T = tops[k];
      for (let i = 0; i + 1 < n; i++) {
        if (!(T[i] - FLs[i] > 0.6) || !(T[i + 1] - FLs[i + 1] > 0.6) || Number.isNaN(FLs[i]) || Number.isNaN(FLs[i + 1])) continue;
        const ax = Xs[i] + NX[i] * sg * hw, az = Zs[i] + NZ[i] * sg * hw, bx = Xs[i + 1] + NX[i + 1] * sg * hw, bz = Zs[i + 1] + NZ[i + 1] * sg * hw;
        const A0 = [ax, FLs[i] - 0.4, az], B0 = [bx, FLs[i + 1] - 0.4, bz], A1 = [ax, T[i], az], B1 = [bx, T[i + 1], bz];
        const Ao = [ax + NX[i] * sg * 0.5, T[i], az + NZ[i] * sg * 0.5], Bo = [bx + NX[i + 1] * sg * 0.5, T[i + 1], bz + NZ[i + 1] * sg * 0.5];
        const Ad = [Ao[0], T[i] - 0.6, Ao[2]], Bd = [Bo[0], T[i + 1] - 0.6, Bo[2]];
        const q = (p1, p2, p3, p4) => walls.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4);
        // (winding: the face toward the track, the coping up, its back face away)
        if (sg > 0) { q(A0, A1, B1, B0); q(A1, Ao, Bo, B1); q(Ao, Ad, Bd, Bo); } else { q(A0, B0, B1, A1); q(A1, B1, Bo, Ao); q(Ao, Bo, Bd, Ad); }
      }
    }
  }
  if (!nRuns) return;
  // stations by 4 m cell
  const SH = new Map();
  const shk = (i, j) => (i > -1048576 && i < 1048576 && j > -1048576 && j < 1048576 ? (i + 1048576) * 2097152 + (j + 1048576) : `${i},${j}`);   // (PERF: the cell as a number)
  for (let k = 0; k < ST.length; k += 9) { const hk = shk(Math.floor(ST[k] / 4), Math.floor(ST[k + 1] / 4)); let l = SH.get(hk); if (!l) SH.set(hk, (l = [])); l.push(k); }
  const NOL = [];
  const stAt = (x, z) => { let b = -1, bd = 9; const ci = Math.floor(x / 4), cj = Math.floor(z / 4); for (let di = -3; di <= 3; di++) for (let dj = -3; dj <= 3; dj++) for (const k of SH.get(shk(ci + di, cj + dj)) || NOL) { const d = Math.hypot(ST[k] - x, ST[k + 1] - z); if (d < bd + 8) { const al = Math.abs((x - ST[k]) * -ST[k + 3] + (z - ST[k + 1]) * ST[k + 2]); if (al < 0.75 && (b < 0 || d < bd)) { bd = d; b = k; } } } return b; };
  const inCor = (x, z, pad) => { const k = stAt(x, z); if (k < 0) return null; const ac = (x - ST[k]) * ST[k + 2] + (z - ST[k + 1]) * ST[k + 3]; return Math.abs(ac) <= ST[k + 4] + pad ? { k, ac } : null; };
  // a station is a cut on a side when its coping stands 0.6 m over the bed
  const cutS = (k, sg) => { const fl = ST[k + 5], t = sg >= 0 ? ST[k + 6] : ST[k + 7]; return Number.isFinite(fl) && Number.isFinite(t) && t - fl > 0.6; };
  // drop the compiled cut walls, the kerb soup's parapets and rock faces in the corridors (vertical triangles whose centroid
  // lies within the corridor + 1.5 m on a cut side)
  let dropped = 0;
  for (const nm of ['rwall', 'terrWall', 'terrRock', 'curb']) {
    const a = S[nm];
    if (!a || a.length < 9) continue;
    // (the built walls' per-vertex attributes, terrWallUV / We / Mat, are filtered alike, or every later wall's UVs slip)
    const nt = a.length / 9, par = Object.keys(S).filter((q) => q !== nm && q.startsWith(nm) && S[q] && S[q].length && S[q].length % nt === 0 && /^(UV|We|Mat)$/.test(q.slice(nm.length)));   // (per vertex or per triangle: a whole number per triangle either way)
    const keep = [], keepP = par.map(() => []);
    for (let i = 0; i + 8 < a.length; i += 9) {
      const vert = Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-3;
      const c = vert ? inCor((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3, 1.5) : null;
      if (c && cutS(c.k, c.ac)) { dropped++; continue; }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
      par.forEach((q, j) => { const b = S[q], w = b.length / nt, o = (i / 9) * w; for (let k = 0; k < w; k++) keepP[j].push(b[o + k]); });
    }
    S[nm] = Float32Array.from(keep);
    par.forEach((q, j) => { S[q] = S[q] instanceof Uint8Array ? Uint8Array.from(keepP[j]) : Float32Array.from(keepP[j]); });
  }
  // the ground, cut along each cut side's wall line (the triangle clipped by the line through its centroid's station):
  // the pieces between the walls lie under the bed, the pieces behind a wall meet its coping along the line (no sawtooth,
  // nothing crossing the wall, no gap); open sides as drawn
  let moved = 0;
  const clip = (poly, f) => { const inn = [], out = []; for (let q = 0; q < poly.length; q++) { const P = poly[q], Q = poly[(q + 1) % poly.length], fp = f(P), fq = f(Q); if (fp <= 0) inn.push(P); if (fp >= 0) out.push(P); if ((fp < 0 && fq > 0) || (fp > 0 && fq < 0)) { const t = fp / (fp - fq), X = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t, 1]; inn.push(X); out.push([X[0], X[1], X[2], 1]); } } return [inn, out]; };
  for (const nm of ['terrP1', 'grass', 'grassU']) {
    const a = S[nm];
    if (!a || a.length < 9) continue;
    const res = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const c = inCor((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3, 1.7);
      if (!c) { for (let k = 0; k < 9; k++) res.push(a[i + k]); continue; }
      // (each side's line: the wall's on a cut side, the drawn bed's edge on an open one)
      const k0 = c.k, bw = BW[ST[k0 + 8]] || [0, 0], lineOf = (sg) => (cutS(k0, sg) ? ST[k0 + 4] : bw[sg > 0 ? 0 : 1] > 0.5 ? bw[sg > 0 ? 0 : 1] + SK : 0);
      const sides = [1, -1].filter((sg) => lineOf(sg) > 0.5);
      if (!sides.length) { for (let k = 0; k < 9; k++) res.push(a[i + k]); continue; }
      const ac = (P) => (P[0] - ST[k0]) * ST[k0 + 2] + (P[2] - ST[k0 + 1]) * ST[k0 + 3];
      let inner = [[a[i], a[i + 1], a[i + 2], 0], [a[i + 3], a[i + 4], a[i + 5], 0], [a[i + 6], a[i + 7], a[i + 8], 0]];
      const pieces = [];
      for (const sg of sides) {
        const L = lineOf(sg), [inn, out] = clip(inner, (P) => sg * ac(P) - L);
        if (out.length >= 3) pieces.push([out, sg]);
        inner = inn;
        if (inner.length < 3) break;
      }
      if (inner.length >= 3) pieces.push([inner, 0]);
      for (const [poly, sg] of pieces) {
        for (const P of poly) {
          const kv = stAt(P[0], P[2]), k = kv >= 0 ? kv : k0;
          const r = ST[k + 8], gi = k / 9 - RUN0[r], fl = ST[k + 5];
          if (sg === 0) {
            // (under the bed, or under the shoulder's slope past the bed's edge on an open side)
            const o = ac(P), sd = o >= 0 ? 0 : 1, b = Math.max(bw[sd], 0.5);
            let cap = fl - 0.3;
            if (!cutS(k0, o >= 0 ? 1 : -1) && Math.abs(o) > b && GY[r]) cap = Math.min(cap, fl - 0.06 + (GY[r][sd][gi] - fl + 0.06) * Math.min(1, (Math.abs(o) - b) / SK) - 0.05);
            if (Number.isFinite(cap) && P[1] > cap) P[1] = cap;
          } else if (P[3] || Math.abs(sg * ac(P) - lineOf(sg)) < 1e-4) {
            if (cutS(k0, sg)) { const top = sg > 0 ? ST[k + 6] : ST[k + 7]; if (Number.isFinite(top)) P[1] = top - 0.02; }
            else if (GY[r]) { const g = GY[r][sg > 0 ? 0 : 1][gi]; if (Number.isFinite(g)) P[1] = g - 0.03; }   // (meets the shoulder's foot just under it)
          }
          moved++;
        }
        for (let q = 1; q + 1 < poly.length; q++) for (const P of [poly[0], poly[q], poly[q + 1]]) res.push(P[0], P[1], P[2]);
      }
    }
    S[nm] = Float32Array.from(res);
  }
  // the compiled ballast's sloped shoulders (stepped by the compile's grid: the sawtooth at the bed's edge) give way to
  // the swept bed and shoulders; its flat top stays
  if (bed.length && S.rbal && S.rbal.length >= 9) {
    const a = S.rbal, keep = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const ux = a[i + 3] - a[i], uy = a[i + 4] - a[i + 1], uz = a[i + 5] - a[i + 2], vx = a[i + 6] - a[i], vy = a[i + 7] - a[i + 1], vz = a[i + 8] - a[i + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, L = Math.hypot(nx, ny, nz) || 1;
      if (Math.abs(ny) / L < 0.97 && inCor((a[i] + a[i + 3] + a[i + 6]) / 3, (a[i + 2] + a[i + 5] + a[i + 8]) / 3, 0)) { dropped++; continue; }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    S.rbal = Float32Array.from(keep);
  }
  if (bed.length) { const c = S.rbal || new Float32Array(0), m = new Float32Array(c.length + bed.length); m.set(c); m.set(bed, c.length); S.rbal = m; }
  if (walls.length) { const c = S.rwall || new Float32Array(0), m = new Float32Array(c.length + walls.length); m.set(c); m.set(walls, c.length); S.rwall = m; }
  st.railCuts = { runs: nRuns, walls: walls.length / 9, bed: bed.length / 9, dropped, moved };
  if (typeof window !== 'undefined') (window.__RAILCUT = window.__RAILCUT || {})[tile.header.origin.join('_')] = st.railCuts;   // (the page's record, for probes)
}
// TERRAIN FIX: the tall walls of the cuts (the curb soup's vertical faces over 1.5 m: the held cut roads' walls and
// parapets, laid on the bank's grade point by point) billowed with the bank along the Amtrak and parkway cuts: each top
// point goes to a smooth line, the running maximum of the tall walls' tops within 4 m then their Gaussian mean (2.5 m)
// within 6 m (the points of one wall lie on its line, so the mean runs along it); every copy of a point moves alike, only
// upward (the bank never stands over the top)
function tallWallTops(tile, st) {
  const a = tile.S.curb;
  if (!a || a.length < 9) return;
  const key = (x, z) => `${Math.round(x * 1000)},${Math.round(z * 1000)}`;
  const top = new Map(), bot = new Map();
  for (let i = 0; i + 8 < a.length; i += 9) {
    if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) >= 1e-3) continue;
    for (let k = 0; k < 3; k++) { const kk = key(a[i + 3 * k], a[i + 3 * k + 2]), y = a[i + 3 * k + 1]; top.set(kk, Math.max(top.get(kk) ?? -Infinity, y)); bot.set(kk, Math.min(bot.get(kk) ?? Infinity, y)); }
  }
  const P = [];
  for (const [kk, t] of top) { if (t - bot.get(kk) < 1.5 || bot.get(kk) < -1.0) continue; const [xs, zs] = kk.split(',').map(Number); P.push([xs / 1000, zs / 1000, t, kk]); }
  if (!P.length) return;
  const H = new Map();
  P.forEach((p, i) => { const hk = `${Math.floor(p[0] / 6)},${Math.floor(p[1] / 6)}`; let l = H.get(hk); if (!l) H.set(hk, (l = [])); l.push(i); });
  const nb = (p, r) => { const out = []; const ci = Math.floor(p[0] / 6), cj = Math.floor(p[1] / 6); for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const j of H.get(`${ci + di},${cj + dj}`) || []) { const d = Math.hypot(P[j][0] - p[0], P[j][1] - p[1]); if (d <= r) out.push([j, d]); } return out; };
  const mx = P.map((p) => Math.max(...nb(p, 4).map(([j]) => P[j][2])));
  const lift = new Map();
  P.forEach((p, i) => { let s2 = 0, w = 0; for (const [j, d] of nb(p, 6)) { const ww = Math.exp(-(d * d) / (2 * 2.5 * 2.5)); s2 += mx[j] * ww; w += ww; } const t = s2 / w; if (t - p[2] > 0.01) lift.set(p[3], [p[2], Math.min(2.5, t - p[2])]); });
  let n = 0;
  for (let i = 0; i + 2 < a.length; i += 3) { const e = lift.get(key(a[i], a[i + 2])); if (e && Math.abs(a[i + 1] - e[0]) < 1e-4) { a[i + 1] += e[1]; n++; } }
  st.tallWallTops = n;
}
function buildingBands(tile) {
  if (!tile.S.bldg || !tile.S.bldgXZ) return null;
  const [ox, oz] = tile.header.origin, S = tile.S, out = [];
  let n = 0;
  const top = (x, z) => {   // (the at-grade ground: the base and the sections within 1 m over it, as the floor reads it)
    const g = haTerrainAt(x, z);
    if (g === null) return null;
    let m = g;
    for (const k of HA_GROUND) for (const y of soupYs(S[k], x - ox, z - oz)) if (y > m && y <= g + 1.0) m = y;
    return m;
  };
  for (const b of buildingsOf(tile)) {
    if (b.landmarkId > 0) continue;
    const ring = [];
    for (let i = 0; i < b.len; i++) ring.push([S.bldgXZ[(b.start + i) * 2] + ox, S.bldgXZ[(b.start + i) * 2 + 1] + oz]);
    const q = haBuildingGround(ring, tile, ox, oz);
    if (!q) continue;
    const y0 = b.baseY + q.lift;
    let hi = -Infinity;
    haFacadeSamples(ring, 0.4, (x, z) => { const y = top(x, z); if (y !== null && y > hi) hi = y; });
    if (!(hi - y0 > 3.0)) continue;
    n++;
    const cap = y0 + 2.9;
    let area = 0;
    for (let k = 0; k < ring.length; k++) { const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length]; area += ax * bz - bx * az; }
    const sg = area > 0 ? 1 : -1;
    for (let k = 0; k < ring.length; k++) {
      const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const nx = (sg * (bz - az)) / L, nz = (-sg * (bx - ax)) / L, w = 0.8;
      const A = [ax - ox, cap, az - oz], B = [bx - ox, cap, bz - oz], C2 = [bx + nx * w - ox, cap, bz + nz * w - oz], D = [ax + nx * w - ox, cap, az + nz * w - oz];
      out.push(...A, ...B, ...C2, ...A, ...C2, ...D);
    }
  }
  return n ? { n, soup: Float32Array.from(out) } : null;
}
// every y of a soup's non-vertical triangles at local (x, z) (a plain scan per call, 2 m buckets cached per soup)
const SOUP_IDX = new WeakMap();
function soupYs(a, x, z) {
  if (!a || a.length < 9) return [];
  let B = SOUP_IDX.get(a);
  if (!B) {
    B = new Map();
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) < 1e-6) continue;
      const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 2), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 2);
      const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 2), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 2);
      for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(i); }
    }
    SOUP_IDX.set(a, B);
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
const CP_CLIP = 0.25;   // (the anchor gate holds the park's lawn to its relief within 0.25 m)
function clampOnce(tile, st, extra = null) {
  const S = tile.S, MARGIN = 0.05, LAWN_OVER = extra ? 0 : 0.14, C = 2;
  const S0cov = tile.p1Covered || null;
  const nonVert = (a, i) => Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) >= 1e-6;
  const pav = [];
  if (extra) pav.push(extra); else for (const n of HA_PAVED) if (S[n] && S[n].length >= 9) pav.push(S[n]);
  if (!pav.length) return;
  // (a paved triangle [x, z, yPaved] x 3 clipped to the half-planes left of a ground triangle's edges (sg: its winding),
  // flat: 6 corners at most)
  const CPA = new Float64Array(3 * 16), CPB = new Float64Array(3 * 16);
  for (const [name, over] of [['terrP1', 0], ['grass', LAWN_OVER], ['grassU', LAWN_OVER]]) {
    const a = S[name];
    if (!a || a.length < 9) continue;
    const nT = (a.length / 9) | 0, need = new Float32Array(nT), needD = new Uint8Array(nT), TB = new Map();
    for (let t = 0; t < nT; t++) {
      const i = 9 * t;
      if (!nonVert(a, i)) continue;
      const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / C), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / C);
      const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / C), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / C);
      for (let j = j0; j <= j1; j++) for (let q = i0; q <= i1; q++) { const k2 = j * 8192 + q; let l = TB.get(k2); if (!l) TB.set(k2, (l = [])); l.push(t); }
    }
    const seen = new Int32Array(nT).fill(-1);
    const GB = new Float64Array(4 * nT);   // (PERF: each ground triangle's plan box)
    for (let t = 0; t < nT; t++) { const i = 9 * t; GB[4 * t] = Math.min(a[i], a[i + 3], a[i + 6]); GB[4 * t + 1] = Math.max(a[i], a[i + 3], a[i + 6]); GB[4 * t + 2] = Math.min(a[i + 2], a[i + 5], a[i + 8]); GB[4 * t + 3] = Math.max(a[i + 2], a[i + 5], a[i + 8]); }
    // (Central Park's ground is laid by its own parts over its arches, transverses and banks: left to them)
    const [tox, toz] = tile.header.origin, inCP = new Uint8Array(nT);
    if (tox < CPB[1] + 512 && tox + 512 > CPB[0] && toz < CPB[3] + 512 && toz + 512 > CPB[2]) for (let t = 0; t < nT; t++) { const i = 9 * t; inCP[t] = haInCentralPark((a[i] + a[i + 3] + a[i + 6]) / 3 + tox, (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + toz) ? 1 : 0; }
    let stamp = 0;
    // every paved triangle against every ground triangle it overlaps in plan: the excess of the ground over the paving
    // at the vertices of their intersection (both are planar there, so the largest excess is at one of them)
    for (const b of pav) for (let j = 0; j + 8 < b.length; j += 9) {
      if (!nonVert(b, j)) continue;
      if (!extra && S0cov && S0cov.has(`${Math.round(((b[j] + b[j + 3] + b[j + 6]) / 3) * 100)},${Math.round(((b[j + 2] + b[j + 5] + b[j + 8]) / 3) * 100)}`)) continue;   // (the covered FDR: under its park decks)
      stamp++;
      // (TERRAIN INT2: a park drive's own piece (city/cpDrives.js): the ground comes down under it whatever the depth)
      const drv = !extra && tile.cpDriveZone ? tile.cpDriveZone((b[j] + b[j + 3] + b[j + 6]) / 3 + tile.header.origin[0], (b[j + 2] + b[j + 5] + b[j + 8]) / 3 + tile.header.origin[1]) : false;
      const bx0 = Math.min(b[j], b[j + 3], b[j + 6]), bx1 = Math.max(b[j], b[j + 3], b[j + 6]), bz0 = Math.min(b[j + 2], b[j + 5], b[j + 8]), bz1 = Math.max(b[j + 2], b[j + 5], b[j + 8]);
      const i0 = Math.floor(bx0 / C), i1 = Math.floor(bx1 / C);
      const j0 = Math.floor(bz0 / C), j1 = Math.floor(bz1 / C);
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const l = TB.get(jj * 8192 + ii);
        if (!l) continue;
        for (const t of l) {
          if (seen[t] === stamp) continue;
          seen[t] = stamp;
          const i = 9 * t;
          // (PERF: plans 1 cm apart or more share no area: the clip below would leave nothing)
          if (GB[4 * t + 1] < bx0 - 0.01 || GB[4 * t] > bx1 + 0.01 || GB[4 * t + 3] < bz0 - 0.01 || GB[4 * t + 2] > bz1 + 0.01) continue;
          const sg = Math.sign((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2]));
          // (PERF: the clip on two flat buffers)
          let P = CPA, Q = CPB, np = 3;
          P[0] = b[j]; P[1] = b[j + 2]; P[2] = b[j + 1]; P[3] = b[j + 3]; P[4] = b[j + 5]; P[5] = b[j + 4]; P[6] = b[j + 6]; P[7] = b[j + 8]; P[8] = b[j + 7];
          for (let k = 0; k < 3 && np >= 3; k++) {
            const hx = a[i + 3 * k], hz = a[i + 3 * k + 2], ex = a[i + 3 * ((k + 1) % 3)] - hx, ez = a[i + 3 * ((k + 1) % 3) + 2] - hz;
            let nq = 0;
            for (let e = 0; e < np; e++) {
              const p3 = 3 * e, q3 = 3 * ((e + 1) % np);
              const sp = sg * (ex * (P[p3 + 1] - hz) - ez * (P[p3] - hx)), sq = sg * (ex * (P[q3 + 1] - hz) - ez * (P[q3] - hx));
              if (sp >= 0) { Q[3 * nq] = P[p3]; Q[3 * nq + 1] = P[p3 + 1]; Q[3 * nq + 2] = P[p3 + 2]; nq++; }
              if ((sp >= 0) !== (sq >= 0)) { const f = sp / (sp - sq); Q[3 * nq] = P[p3] + (P[q3] - P[p3]) * f; Q[3 * nq + 1] = P[p3 + 1] + (P[q3 + 1] - P[p3 + 1]) * f; Q[3 * nq + 2] = P[p3 + 2] + (P[q3 + 2] - P[p3 + 2]) * f; nq++; }
            }
            const T = P; P = Q; Q = T; np = nq;
          }
          if (np < 3) continue;
          const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
          const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
          for (let e = 0; e < np; e++) {
            const x = P[3 * e], z = P[3 * e + 1], py = P[3 * e + 2];
            const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
            const g = w0 * a[i + 1] + w1 * a[i + 4] + (1 - w0 - w1) * a[i + 7];
            // (TERRAIN INT2: in Central Park only a clip, the ground within CP_CLIP (0.25 m) over the walk; deeper paving there is
            // an arch's, a transverse's or a bank's, laid by the park's own parts)
            if (g - py > over && !(inCP[t] && !drv && g - py > CP_CLIP)) { need[t] = Math.max(need[t], g - py + (over ? 0 : MARGIN)); if (drv) needD[t] = 1; }
          }
        }
      }
    }
    // (PERF: a corner's millimetres as one number, the same corners as the "x,z" string, which one past 2 km takes)
    const drop = new Map(), key = (x, z) => { const rx = Math.round(x * 1000), rz = Math.round(z * 1000); return rx > -2097152 && rx < 2097152 && rz > -2097152 && rz < 2097152 ? (rx + 2097152) * 4194304 + (rz + 2097152) : `${rx},${rz}`; };
    // (in Central Park a corner comes down CP_CLIP at most over all the passes: the park's ground is not dug into a hollow)
    const cpD = (st.cpDrop = st.cpDrop || new Map());
    for (let t = 0; t < nT; t++) {
      if (!(need[t] > 0)) continue;
      const i = 9 * t;
      for (let k = 0; k < 3; k++) {
        const kk = key(a[i + 3 * k], a[i + 3 * k + 2]);
        let nd = need[t];
        if (inCP[t] && cpD && !needD[t]) nd = Math.min(nd, CP_CLIP - (cpD.get(name + kk) || 0));
        if (nd > 0 && !(drop.get(kk) >= nd)) drop.set(kk, nd);
      }
    }
    if (!drop.size) continue;
    for (let i = 0; i + 2 < a.length; i += 3) {
      const kk = key(a[i], a[i + 2]), d = drop.get(kk);
      if (d) { a[i + 1] -= d; st.maxDrop = Math.max(st.maxDrop, d); }
    }
    if (cpD) for (const [kk, d] of drop) cpD.set(name + kk, (cpD.get(name + kk) || 0) + d);
    st[name === 'terrP1' ? 'base' : 'grass'] += drop.size;
  }
}

// TERRAIN FIX: points every metre along a footprint's facades, off metres outside (cb(x, z)); points lying in another
// footprint (the TIN's tag 1: a party wall's neighbour, whose own walls hide that ground) are skipped
export function haFacadeSamples(ring, off, cb) {
  let area = 0;
  for (let k = 0; k < ring.length; k++) { const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length]; area += ax * bz - bx * az; }
  const sg = area > 0 ? 1 : -1;
  for (let k = 0; k < ring.length; k++) {
    const [ax, az] = ring[k], [bx, bz] = ring[(k + 1) % ring.length];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.3) continue;
    // (the exterior normal of a ring wound with signed area sg)
    const nx = (sg * (bz - az)) / L, nz = (-sg * (bx - ax)) / L, m = Math.max(1, Math.round(L));
    for (let s = 0; s < m; s++) {
      const u = (s + 0.5) / m, x = ax + (bx - ax) * u + nx * off, z = az + (bz - az) * u + nz * off;
      const q = haInfo(x, z);
      if (q && q.tag === 1) continue;
      cb(x, z);
    }
  }
}
// TERRAIN FIX: a building's ground floor in the region never lies under the drawn ground along its facades (windows
// in the ground): y0 = the floor as laid (lift, pavement), topAt(x, z) = the drawn ground's top or null; the floor is
// raised to the highest ground 0.4 m outside its facades, and its plinth (the foundation, minT) shows below on the
// downhill side. `?bfloor=med` / TERRAIN_BFLOOR=med: the median lift alone, as before.
const BFLOOR_MED = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('bfloor') === 'med') || (typeof process !== 'undefined' && process.env && process.env.TERRAIN_BFLOOR === 'med');
// A building whose highest ground stands more than RAISE_MAX over its floor is set into the hillside (the 79th Street
// rotunda and the garages under Riverside Park, park houses on a bank): raising it would stand it out of its slope as a
// box, so it keeps its floor (counted apart by the gate as 'embedded').
export const HA_RAISE_MAX = 3.5;
// A street, walk, kerb or other built surface at grade against a facade is the building's frontage whatever its height: the floor always comes up
// to it (the downhill side shows its plinth); pavedAt(x, z) = the paving's top at grade there, or null.
export function haBuildingFloor(ring, y0, topAt, pavedAt = null) {
  if (BFLOOR_MED || !FLAG) return y0;
  let hi = -Infinity, hp = -Infinity;
  haFacadeSamples(ring, 0.4, (x, z) => { const y = topAt(x, z); if (y !== null && y > hi) hi = y; if (pavedAt) { const p = pavedAt(x, z); if (p !== null && p > hp) hp = p; } });
  let f = Math.max(y0, hp);
  if (hi > f && hi - f <= HA_RAISE_MAX) f = hi;
  return f;
}

// the registries (structures, walls as faces, stairs as geometry): loaded on demand for the builders of 1b
export async function haRegistry(name) {
  if (!(await haInit()) || !MAN) return null;
  return JSON.parse(new TextDecoder().decode(await readBuf(`${name}.json`)));
}
export const haManifest = () => MAN;
// P2A: the slit edges whose middle lies in tile (tx, tz): world ends, each side's unit normal into its triangle and its
// base heights at the two ends (tools/terrain/mn_budget.mjs's watertightness gate)
export function haSlitEdges(tx, tz) {
  const ch = CH.get(`${tx}_${tz}`);
  if (!ch) return [];
  const { x: X, z: Z, tri, tag } = ch, ox = tx * TILE, oz = tz * TILE, out = [];
  for (const e of chunkSlits(ch)) {
    const ux = X[e.u], uz = Z[e.u], vx = X[e.v], vz = Z[e.v], mx = (ux + vx) / 2, mz = (uz + vz) / 2;
    if (mx < ox || mx >= ox + TILE || mz < oz || mz >= oz + TILE || tag[e.t1] >= 3 || tag[e.t2] >= 3) continue;
    const L = Math.hypot(vx - ux, vz - uz);
    if (L < 1e-4) continue;
    const n = [e.t1, e.t2].map((t) => {
      const cx = (X[tri[3 * t]] + X[tri[3 * t + 1]] + X[tri[3 * t + 2]]) / 3, cz = (Z[tri[3 * t]] + Z[tri[3 * t + 1]] + Z[tri[3 * t + 2]]) / 3;
      let nx = -(vz - uz) / L, nz = (vx - ux) / L;
      if ((cx - mx) * nx + (cz - mz) * nz < 0) { nx = -nx; nz = -nz; }
      return [nx, nz];
    });
    out.push({ ux, uz, vx, vz, n, b: [[HA_BASE + e.r1u, HA_BASE + e.r1v], [HA_BASE + e.r2u, HA_BASE + e.r2v]] });
  }
  return out;
}
