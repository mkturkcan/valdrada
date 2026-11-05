// The simulation's view of one 512 m tile: what the page's sims read from a tile record (sim/traffic.js addTile,
// sim/peds.js onTile, the streamer's surfaceAt / surfaceInfoAt / roadAt / terrainAt), built from the tile file alone,
// with no mesh. This is the prototype of a cell sidecar's navigation part (docs/notes/tile-system.md section 3: the core
// reads cell sidecars only).
//
// What it reuses from the page as is (pure functions on the parsed tile):
//   world/tiledata.js parseTile, roadsOf; the ground re-kinding passes that assembleTile runs before anything samples the
//   sections (world/lotfix39.js lf39Apply, city/tsqPlaza.js tpApply, city/bryantPark.js bpApply, city/centralPark.js
//   cpApply, city/areas.js areaApply, city/stations/subEnt38.js st38GapFill, city/groundFix38.js gf38Apply).
// What it mirrors (closures inside world/assemble.js assembleTile, which also builds the tile's meshes, so they cannot
// be imported): the section sampler (surfHash / sectionY / padYAt / grassOver / surfaceKindAt / roadAt) and the roads /
// nodes records. The mirror keeps the page's names and constants; tools/core/parity.mjs compares it with the page.
import { parseTile, roadsOf } from '../../client/src/world/tiledata.js';
import { lf39Load, lf39Apply } from '../../client/src/world/lotfix39.js';
import { tpTileHit, tpApply } from '../../client/src/city/tsqPlaza.js';
import { bpApply } from '../../client/src/city/bryantPark.js';
import { cpTileHit, cpApply, cpApplyP1 } from '../../client/src/city/centralPark.js';
import { haPreload, haHoldDecks, haRestoreDecks, haAnchors } from '../../client/src/world/haAnchor.js';   // P1 TERRAIN: Central Park's chunks round the tile
import { areaTileHit, areaApply } from '../../client/src/city/areas.js';
import { st38GapFill } from '../../client/src/city/stations/subEnt38.js';
import { gf38Load, gf38Apply, gf38Index } from '../../client/src/city/groundFix38.js';
import { tileContentKey } from '../../client/src/shared/overlay.js';
import { HA_P1, haTileReady, haApplyTile, haClampGround } from '../../client/src/world/heightAuthority.js';
import { HHP, hhpReady, hhpPre, hhpPost, hhpAfterClamp } from '../../client/src/city/hhp.js';   // HIGHWAYS P2 (HHP_P2=1): the Henry Hudson Parkway
import { wshGroundFix } from '../../client/src/city/wshGround.js';
import { wshCoastReady } from '../../client/src/city/wshCoast.js';   // (the West Side Highway's and the northern parkway's shore ground)

const warnOnce = new Set();
const warn = (k, e) => { if (!warnOnce.has(k)) { warnOnce.add(k); console.warn(`[core] ${k}`, e?.message || e); } };

// TILE CACHE (2026-11-04, the Unreal client's core): VALDRADA_TILE_CACHE names a folder of laid tiles' answers, each keyed by
// the compiled tile's content and the ground flags: the records the sims read (roads, nodes, the terrain grid) and the
// sampler's answers on a 0.5 m raster over the tile (surfaceY, surfaceInfo's kind and height, roadAt), read back bilinear
// for heights and nearest for kinds. A tile found there skips its passes, which on the measured ground with the highways take
// 15 to 45 s a tile; VALDRADA_TILE_CACHE_WRITE=1 writes each tile it lays (tools/core/tile_cache.mjs builds a release's).
let CACHE_SIG;
async function cacheSig() {
  if (CACHE_SIG !== undefined) return CACHE_SIG;
  CACHE_SIG = null;
  try {
    if (typeof process !== 'undefined' && process.env.VALDRADA_TILE_CACHE) {
      const fs = await import('node:fs/promises'), crypto = await import('node:crypto');
      const cells = process.env.TERRAIN_P1_CELLS ? crypto.createHash('sha1').update(await fs.readFile(process.env.TERRAIN_P1_CELLS)).digest('hex').slice(0, 12) : '';
      CACHE_SIG = `p1=${HA_P1 ? 1 : 0};hhp=${HHP ? 1 : 0};cells=${cells}`;
    }
  } catch (e) { warn('tile cache', e); }
  return CACHE_SIG;
}
const RN = 1024, RS = 512 / RN;   // the answers' raster: 0.5 m cells over the tile
const KINDS_C = [null, 'sidewalk', 'path', 'brick', 'plaza', 'gravel', 'grass', 'gutter', 'busred', 'asphalt'];
async function cacheRead(key, compiled, arrayBuf) {
  const sig = await cacheSig();
  if (!sig) return null;
  try {
    const fs = await import('node:fs/promises'), v8 = await import('node:v8'), path = await import('node:path'), zlib = await import('node:zlib');
    const c = v8.deserialize(zlib.inflateSync(await fs.readFile(path.join(process.env.VALDRADA_TILE_CACHE, `${key}.v8z`))));
    if (!c || c.sig !== sig || c.ckey !== tileContentKey(compiled)) return null;
    const [ox, oz] = c.origin;
    const cell = (x, z) => { const i = Math.floor((x - ox) / RS), j = Math.floor((z - oz) / RS); return i < 0 || j < 0 || i >= RN || j >= RN ? -1 : j * RN + i; };
    // heights in cm over the tile's base (-32768: no answer); bilinear where the four cells answer, else the nearest
    const height = (R, x, z) => {
      const fx = (x - ox) / RS - 0.5, fz = (z - oz) / RS - 0.5, i = Math.floor(fx), j = Math.floor(fz);
      if (i >= 0 && j >= 0 && i + 1 < RN && j + 1 < RN) {
        const a = R[j * RN + i], b = R[j * RN + i + 1], c2 = R[(j + 1) * RN + i], d = R[(j + 1) * RN + i + 1];
        // (across a step, a wall's or a deck's edge, the nearest cell: no height between two levels)
        if (a > -32768 && b > -32768 && c2 > -32768 && d > -32768 && Math.max(a, b, c2, d) - Math.min(a, b, c2, d) <= 40) {
          const u = fx - i, v = fz - j;
          return c.base + ((a * (1 - u) + b * u) * (1 - v) + (c2 * (1 - u) + d * u) * v) / 100;
        }
      }
      const k = cell(x, z);
      return k < 0 || R[k] === -32768 ? null : c.base + R[k] / 100;
    };
    return {
      key, roads: c.roads, nodes: c.nodes, terrain: c.terrain,
      surfaceY: (x, z) => height(c.sy, x, z),
      surfaceInfo: (x, z) => { const k = cell(x, z); if (k < 0 || !c.kind[k]) return null; const kind = KINDS_C[c.kind[k]], y = height(c.iy, x, z); return y === null ? null : { kind, y, road: c.kind[k] >= 7 }; },
      roadAt: (x, z) => { const k = cell(x, z); return k >= 0 && !!c.road[k]; },
      bytes: arrayBuf.byteLength, cached: true,
    };
  } catch { return null; }
}
async function cacheWrite(key, ckey, data, origin) {
  const sig = await cacheSig();
  if (!sig || process.env.VALDRADA_TILE_CACHE_WRITE !== '1') return;
  try {
    const fs = await import('node:fs/promises'), v8 = await import('node:v8'), path = await import('node:path'), zlib = await import('node:zlib');
    const [ox, oz] = origin;
    const syF = new Float32Array(RN * RN), iyF = new Float32Array(RN * RN), kind = new Uint8Array(RN * RN), road = new Uint8Array(RN * RN);
    let base = Infinity;
    for (let j = 0; j < RN; j++) for (let i = 0; i < RN; i++) {
      const x = ox + (i + 0.5) * RS, z = oz + (j + 0.5) * RS, k = j * RN + i;
      const y = data.surfaceY(x, z), q = data.surfaceInfo(x, z, 0.4);
      syF[k] = y === null ? NaN : y; iyF[k] = q ? q.y : NaN;
      kind[k] = q ? Math.max(0, KINDS_C.indexOf(q.kind === 'grassU' ? 'grass' : q.kind)) : 0;
      road[k] = data.roadAt(x, z, 0.25) ? 1 : 0;
      if (y !== null && y < base) base = y;
      if (q && q.y < base) base = q.y;
    }
    if (!Number.isFinite(base)) base = 0;
    const cm = (F) => { const R = new Int16Array(RN * RN); for (let k = 0; k < F.length; k++) R[k] = Number.isNaN(F[k]) ? -32768 : Math.max(-32767, Math.min(32767, Math.round((F[k] - base) * 100))); return R; };
    const f = path.join(process.env.VALDRADA_TILE_CACHE, `${key}.v8z`);
    await fs.mkdir(process.env.VALDRADA_TILE_CACHE, { recursive: true });
    const out = { sig, ckey, origin, base, roads: data.roads, nodes: data.nodes, terrain: data.terrain, sy: cm(syF), iy: cm(iyF), kind, road };
    await fs.writeFile(f + '.tmp', zlib.deflateSync(v8.serialize(out), { level: 6 }));
    await fs.rename(f + '.tmp', f);
  } catch (e) { warn('tile cache write', e); }
}

export async function simTile(key, arrayBuf) {
  const compiled = parseTile(arrayBuf);
  const ckey0 = (await cacheSig()) ? tileContentKey(compiled) : null;
  const hit = ckey0 ? await cacheRead(key, compiled, arrayBuf) : null;
  if (hit) return hit;
  const tile = compiled;
  await layTile(key, tile, arrayBuf);
  if (globalThis.__SIMTILE_KEEP) globalThis.__SIMTILE_KEEP.set(key, tile);   // (probes and gates: the tile's sections as laid)
  const data = sampler(key, tile, arrayBuf);
  if (ckey0) await cacheWrite(key, ckey0, data, tile.header.origin);
  return data;
}

// the passes the page's assembleTile runs on a compiled tile's sections, in its order
async function layTile(key, tile, arrayBuf) {
  // OV39: the overlays apply by the content key of the compiled tile, taken before any pass changes its sections
  const lf39D = await lf39Load(), gf38I = await gf38Index().catch(() => null);
  const ckey = (lf39D && lf39D.tiles && lf39D.tiles[key]) || (gf38I && gf38I.tiles && gf38I.tiles[key]) ? tileContentKey(tile) : null;
  try { lf39Apply(key, tile, arrayBuf.byteLength, lf39D, ckey); } catch (e) { warn('lf39', e); }
  const [ox, oz] = tile.header.origin;
  const gf38P = gf38Load(key, arrayBuf.byteLength, ckey).catch(() => null);
  const roadsW = () => [...roadsOf(tile)].map((r) => ({
    ...r,
    pts: Array.from({ length: r.len }, (_, i) => [tile.S.roadVerts[(r.start + i) * 3] + ox, tile.S.roadVerts[(r.start + i) * 3 + 1], tile.S.roadVerts[(r.start + i) * 3 + 2] + oz]),
    name: tile.header.names[r.nameIdx] || '',
  }));
  // the ground re-kinding passes, in assembleTile's order
  if (tpTileHit(ox, oz)) { try { tpApply(tile, ox, oz, roadsW()); } catch (e) { warn('tp28', e); } }
  try { bpApply(tile, ox, oz); } catch (e) { warn('bp28', e); }
  if (cpTileHit(ox, oz) && HA_P1) await haPreload(ox - 512, oz - 512, ox + 1023, oz + 1023);   // P1: cpApply leaves a region tile to cpApplyP1, whose parts read round the tile
  if (cpTileHit(ox, oz)) { try { cpApply(tile, ox, oz); } catch (e) { warn('cp32', e); } }
  if (areaTileHit(ox, oz)) { try { areaApply(tile, ox, oz); } catch (e) { warn('ar32', e); } }
  try { st38GapFill(tile); } catch (e) { warn('st38', e); }
  try { gf38Apply(tile, await gf38P); } catch (e) { warn('gf38', e); }
  // P1 TERRAIN (client/src/world/heightAuthority.js; TERRAIN_P1=1): the region's relief, as assembleTile lays it
  const HHPT = HHP && await hhpReady();
  const P1T = HA_P1 && await haTileReady(Math.floor(ox / 512), Math.floor(oz / 512));
  if (HHPT) { try { hhpPre(tile, ox, oz, P1T); } catch (e) { warn('hhp pre', e); } }
  if (P1T) await haAnchors();   // (the cuts' profiles: haHoldDecks holds the cut roads and the street bridges too)
  if (P1T) { const held = haHoldDecks(tile, ox, oz); try { haApplyTile(tile, ox, oz); } catch (e) { warn('terrain p1', e); } haRestoreDecks(tile, held); }   // (P1 anchors: elevated decks held)
  if (P1T && cpTileHit(ox, oz)) { try { cpApplyP1(tile, ox, oz); } catch (e) { warn('cp32 p1', e); } }   // P1: the park's parts on the authority's ground
  if (HHPT) { try { hhpPost(tile, ox, oz, P1T); } catch (e) { warn('hhp post', e); } }
  if (HHPT && P1T) { try { await wshCoastReady(); wshGroundFix(tile, ox, oz); } catch (e) { warn('wsh ground', e); } }
  if (P1T) haClampGround(tile);   // TERRAIN FIX: the natural ground never over the paving
  if (HHPT) hhpAfterClamp(tile);   // (the FDR structures' deck tops: over the drives by design)
}

// the sampler and the records the sims read, from a laid tile
function sampler(key, tile, arrayBuf) {
  const [ox, oz] = tile.header.origin;
  const roadsW = () => [...roadsOf(tile)].map((r) => ({
    ...r,
    pts: Array.from({ length: r.len }, (_, i) => [tile.S.roadVerts[(r.start + i) * 3] + ox, tile.S.roadVerts[(r.start + i) * 3 + 1], tile.S.roadVerts[(r.start + i) * 3 + 2] + oz]),
    name: tile.header.names[r.nameIdx] || '',
  }));

  // ---- the section sampler (mirror of assembleTile's SURFACE SAMPLER block)
  const SURF = new Map();
  const surfCell = 4;
  const surfHash = (name) => {
    if (SURF.has(name)) return SURF.get(name);
    const a = tile.S[name];
    let rec = null;
    if (a && a.length >= 9) {
      const H = new Map();
      const nTri = Math.floor(a.length / 9);
      for (let t = 0; t < nTri; t++) {
        const o = t * 9;
        const x0 = a[o] + ox, z0 = a[o + 2] + oz, x1 = a[o + 3] + ox, z1 = a[o + 5] + oz, x2 = a[o + 6] + ox, z2 = a[o + 8] + oz;
        const i0 = Math.floor(Math.min(x0, x1, x2) / surfCell), i1 = Math.floor(Math.max(x0, x1, x2) / surfCell);
        const j0 = Math.floor(Math.min(z0, z1, z2) / surfCell), j1 = Math.floor(Math.max(z0, z1, z2) / surfCell);
        if ((i1 - i0) > 64 || (j1 - j0) > 64) continue;
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = i + '_' + j;
          let arr = H.get(k); if (!arr) H.set(k, (arr = []));
          arr.push(t);
        }
      }
      rec = { a, H };
    }
    SURF.set(name, rec);
    return rec;
  };
  const sectionY0 = (name, x, z, tol) => {
    const rec = surfHash(name);
    if (!rec) return null;
    const { a, H } = rec;
    const list = H.get(Math.floor(x / surfCell) + '_' + Math.floor(z / surfCell));
    if (!list) return null;
    let bestY = null, bestD = 1e9;
    for (const t of list) {
      const o = t * 9;
      const x0 = a[o] + ox, y0 = a[o + 1], z0 = a[o + 2] + oz;
      const x1 = a[o + 3] + ox, y1 = a[o + 4], z1 = a[o + 5] + oz;
      const x2 = a[o + 6] + ox, y2 = a[o + 7], z2 = a[o + 8] + oz;
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      const l2 = 1 - l0 - l1;
      let out = 0;
      if (l0 < 0) out = Math.max(out, -l0 * Math.abs(d) / Math.hypot(x1 - x2, z1 - z2));
      if (l1 < 0) out = Math.max(out, -l1 * Math.abs(d) / Math.hypot(x2 - x0, z2 - z0));
      if (l2 < 0) out = Math.max(out, -l2 * Math.abs(d) / Math.hypot(x0 - x1, z0 - z1));
      if (out < bestD) {
        bestD = out; bestY = l0 * y0 + l1 * y1 + l2 * y2;
        if (out > 0) bestY = Math.min(Math.max(y0, y1, y2), Math.max(Math.min(y0, y1, y2), bestY));
      }
      if (bestD === 0) break;
    }
    return bestD <= tol ? bestY : null;
  };
  const sectionY = (name, x, z, tol) => {
    const y = sectionY0(name, x, z, tol);
    return y === null && name === 'grass' ? sectionY0('grassU', x, z, tol) : y;
  };
  const WALK_KINDS = ['sidewalk', 'path', 'brick', 'plaza', 'gravel'];
  const ROAD_KINDS = ['gutter', 'busred', 'asphalt'];
  const surfY = (x, z, kinds, tol) => {
    for (const k of kinds) { const y = sectionY(k, x, z, tol); if (y !== null) return y; }
    return null;
  };
  const padYAt = (x, z, tol = 0.35) => {
    const w = surfY(x, z, WALK_KINDS, tol); if (w !== null) return w;
    const g = sectionY('grass', x, z, tol); if (g !== null) return g;
    const r = surfY(x, z, ROAD_KINDS, tol); if (r !== null) return r;
    return null;
  };
  const GTOP = true;   // the page's default (?gtop=0 off)
  const grassOver = (x, z, y) => {
    if (!GTOP) return null;
    const g = sectionY('grass', x, z, 0.02);
    return g !== null && g > y + 0.01 ? g : null;
  };
  const surfaceKindAt = (x, z, tol = 0.35) => {
    for (const k of WALK_KINDS) {
      const y = sectionY(k, x, z, tol);
      if (y !== null) { const g = grassOver(x, z, y); return g !== null ? { kind: 'grass', y: g, road: false } : { kind: k, y, road: false }; }
    }
    const g = sectionY('grass', x, z, tol); if (g !== null) return { kind: 'grass', y: g, road: false };
    for (const k of ROAD_KINDS) { const y = sectionY(k, x, z, tol); if (y !== null) return { kind: k, y, road: true }; }
    return null;
  };

  // ---- the records the sims subscribe to (mirror of assembleTile's return)
  const roads = roadsW();
  const nodes = (tile.header.nodes || []).map(([x, z, sig]) => ({ x: x + ox, z: z + oz, signal: !!sig }));
  return {
    key,
    roads,
    nodes,
    terrain: { grid: tile.S.terrain, res: tile.header.res, ox, oz },
    surfaceY: (x, z) => { const y = padYAt(x, z, 0.45), g = y !== null ? grassOver(x, z, y) : null; return g !== null ? g : y; },
    surfaceInfo: (x, z, tol = 0.4) => surfaceKindAt(x, z, tol),
    roadAt: (x, z, tol = 0.25) => ROAD_KINDS.some((k) => sectionY(k, x, z, tol) !== null),
    bytes: arrayBuf.byteLength,
  };
}
