// VEG P1 (terrain art pass, lane 1): the parks' woodland, understorey and ground cover from data, behind the terrain flag
// (`?terrain=p1`; `?vegp1=0` keeps the compiled park trees). Data: client/public/data/veg_p1/ (index.json,
// veg/<tx>_<tz>.json, cover/<tx>_<tz>.png), built by the terrain round's veg tools (veg_build.py; outside the repository).
//
// TREES. One per crown of the city's 2017 LiDAR canopy (first returns over the 1-ft bare earth, crowns split by a
// watershed from each treetop): its height, its crown width, a trunk between the apex and the crown's centroid, moved
// onto plantable ground (lawn, meadow, woodland floor, bare soil, rock) within its crown or dropped; a crown over a census
// street tree is the census tree's (the street path draws it). Species from NYC Parks' Forestry Tree Points, else the
// Entitation's dominant woody plants, else the woods' or the lawns' mix (city/cpFloraData.js CP_SPECIES). Claimed
// straight into the kit's TV25 pools at the measured size, as Central Park's are (city/cpFlora.js), so the census
// trees' LOD, far proxies, shadows and draw calls carry them. Inside a managed park area (cover flag 1) the compiler's
// scattered park trees are dropped (vegDropTree); census street trees stay.
// UNDERSTOREY. Shrubs where the LiDAR has returns 0.3-2.5 m above ground under the woods and in open shrub cover (the
// VG37 scanned-leaf mounds); woodland ground plants (ivy mats, sedge, ferns) on the woodland floor, tall grass and asters
// on the meadows, by the cover raster.
// COVER. cover/<key>.png (RGBA, 1024 x 1024, 0.5 m): R class (1 mown lawn, 2 meadow, 3 woodland floor, 4 bare soil /
// dirt path, 5 rock, 6 paved, 7 water, 8 building), G canopy closure, B understorey density, A flags (1 managed,
// 2 natural area, 4 unpaved trail, 8 steep, 16 under canopy, 32 Central Park). vegCover(key) hands it to the ground
// shader (a THREE.DataTexture, pixel (c, r) = world (ox + 0.5 c + 0.25, oz + 0.5 r + 0.25)).
import * as THREE from 'three';
import { HA_P1, haTerrainAt } from './heightAuthority.js';
import { VEG_GROUND_U } from './materials.js';
import { TV25, TREE_FORMS, tv25Spec } from '../city/furnitureKit.js';
import { CP_SPECIES } from '../city/cpFloraData.js';
import { cpCanopyHex } from '../city/cpFlora.js';
import { cpBarkMat, fernForms, lodSet } from '../city/cpFloraKit.js';
import { vg37UnderForms, vg37CoverForms, vg37Form, vg37LeafMat } from './vg37.js';
import { placeGuard, PG_ON } from './placeGuard.js';   // TERRAIN INT2: the placement rule
import { FURN } from '../shared/geo.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const VEGP1 = HA_P1 && TV25 && typeof window !== 'undefined' && Q?.get('vegp1') !== '0';
// tuning without a code change: `?vegcw=` crown width factor (the kit's crown covers ~0.6-0.8 of its nominal width
// from above), `?vegh=` height factor, `?vegg=0` no ground plants, `?vegs=0` no shrubs
const CWK_WOOD = Math.max(0.5, Math.min(2.5, Number(Q?.get('vegcw')) || 1.5));
const CWK_OPEN = CWK_WOOD * 0.87;
// the woods' crowns a shade deeper and cooler than a lawn tree's (a closed canopy self-shades and reads blue-green from
// the air), `?vegtone=` the value factor
const WOOD_TONE = Math.max(0.5, Math.min(1.2, Number(Q?.get('vegtone')) || 0.84));
const WOOD_RGB = [0.52, 0.64, 0.86];
const HK = Math.max(0.5, Math.min(1.5, Number(Q?.get('vegh')) || 1));
const GROUND = Q?.get('vegg') !== '0', SHRUBS = Q?.get('vegs') !== '0';
const GROW = Q?.has('veggrow') ? Math.max(0, Math.min(20, Number(Q.get('veggrow')) || 0)) : 9;   // years since the LiDAR (`?veggrow=0` as flown)
const LAWN = 1, MEADOW = 2, WOOD = 3, DIRT = 4, ROCK = 5;
const TILE = 512, N = 1024, CELL = 0.5;
const frac = (v) => v - Math.floor(v);
const hh = (x, z, k) => frac(Math.sin(x * (12.9898 + k) + z * (78.233 - k * 0.7) + k * 3.1) * 43758.5453);

let _index = null;
const _tiles = new Map();   // key -> { veg, rgba } | false | Promise
function index() {
  if (!_index) _index = fetch('data/veg_p1/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return _index;
}
// the cover PNG decoded byte-exact (a canvas premultiplies by the alpha, and A carries flags, not coverage): RGBA8,
// non-interlaced, as veg_build.py writes it; IDAT inflated by DecompressionStream, the scanline filters undone here
async function decodePng(url) {
  const r = await fetch(url);
  if (!r.ok) return null;
  const b = new Uint8Array(await r.arrayBuffer());
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
  const raw = new Uint8Array(await new Response(new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = w * 4, out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, o = y * stride, u = o - stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= 4 ? out[o + i - 4] : 0, c = y > 0 ? out[u + i] : 0, d = y > 0 && i >= 4 ? out[u + i - 4] : 0;
      let v;
      if (f === 0) v = x;
      else if (f === 1) v = x + a;
      else if (f === 2) v = x + c;
      else if (f === 3) v = x + ((a + c) >> 1);
      else { const pp = a + c - d, pa = Math.abs(pp - a), pb = Math.abs(pp - c), pc = Math.abs(pp - d); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? c : d); }
      out[o + i] = v & 255;
    }
  }
  return out;
}
// the tile's data in (true) or none (false); call before vegDropTree / vegBuild
export async function vegTile(ox, oz) {
  if (!VEGP1) return false;
  const key = `${Math.floor(ox / TILE)}_${Math.floor(oz / TILE)}`;
  const have = _tiles.get(key);
  if (have !== undefined) return !!(await have);
  const p = (async () => {
    const I = await index();
    if (!I || !I.tiles || !I.tiles[key]) return false;
    const [veg, rgba] = await Promise.all([
      fetch(`data/veg_p1/veg/${key}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      decodePng(`data/veg_p1/cover/${key}.png`).catch(() => null),
    ]);
    if (!veg || !rgba) return false;
    return { key, ox: Math.floor(ox / TILE) * TILE, oz: Math.floor(oz / TILE) * TILE, veg, rgba, tex: null };
  })();
  _tiles.set(key, p);
  const T = await p;
  _tiles.set(key, T);
  return !!T;
}
const tileOf = (x, z) => { const T = _tiles.get(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`); return T && !(T instanceof Promise) ? T : null; };
// the cover pixel at world (x, z): [class, canopy, under, flags] or null
export function vegCoverAt(x, z) {
  const T = tileOf(x, z);
  if (!T) return null;
  const c = Math.floor((x - T.ox) / CELL), r = Math.floor((z - T.oz) / CELL);
  if (c < 0 || r < 0 || c >= N || r >= N) return null;
  const i = (r * N + c) * 4, a = T.rgba;
  return [a[i], a[i + 1], a[i + 2], a[i + 3]];
}
// the ground shader's mask for a tile key ('tx_tz'): { tex (RGBA DataTexture, nearest), ox, oz, size: 512 } or null
export function vegCover(key) {
  const T = _tiles.get(key);
  if (!T || T instanceof Promise) return null;
  if (!T.tex) {
    T.tex = new THREE.DataTexture(T.rgba, N, N, THREE.RGBAFormat);
    T.tex.magFilter = T.tex.minFilter = THREE.NearestFilter;
    T.tex.flipY = false; T.tex.needsUpdate = true;
  }
  return { tex: T.tex, ox: T.ox, oz: T.oz, size: TILE };
}
// THE GROUND MASK ROUND THE LENS (for the ground shader and the lawn blades, as Central Park's CP32L_GROUND): one RGBA8
// texture, VG_M m square at 1 m texels (every second cover pixel), re-filled from the loaded tiles when the lens has moved
// VG_STEP m or a tile has come in. Same channels as the tiles (R class, G canopy, B understorey, A flags); uv =
// (xz - rect.xy) * rect.zw. `on` is 0 until the first fill. world/vg36.js calls vegGroundUpdate before its lawn capture.
const VG_M = 1024, VG_STEP = 192;
export const VEG_GROUND = VEG_GROUND_U;   // (TERRAIN FIX: the object lives in world/materials.js, whose ground shader reads it)
VEG_GROUND.rect.value.set(0, 0, 1 / VG_M, 1 / VG_M);
let _vgData = null, _vgTex = null, _vgCx = 1e9, _vgCz = 1e9, _vgTiles = -1;
export function vegGroundUpdate(cx, cz) {
  if (!VEGP1) return false;
  let nT = 0;
  for (const T of _tiles.values()) if (T && !(T instanceof Promise)) nT++;
  const far = Math.abs(cx - _vgCx) > VG_STEP || Math.abs(cz - _vgCz) > VG_STEP;
  if (!far && nT === _vgTiles) return false;
  if (!nT) return false;
  if (far) { _vgCx = Math.round(cx / 64) * 64; _vgCz = Math.round(cz / 64) * 64; }
  _vgTiles = nT;
  if (!_vgData) {
    _vgData = new Uint8Array(VG_M * VG_M * 4);
    _vgTex = new THREE.DataTexture(_vgData, VG_M, VG_M, THREE.RGBAFormat);
    _vgTex.magFilter = _vgTex.minFilter = THREE.NearestFilter; _vgTex.flipY = false;
  }
  const x0 = _vgCx - VG_M / 2, z0 = _vgCz - VG_M / 2;
  _vgData.fill(0);
  for (const T of _tiles.values()) {
    if (!T || T instanceof Promise) continue;
    const a = Math.max(0, T.ox - x0), b = Math.min(VG_M, T.ox + TILE - x0), c = Math.max(0, T.oz - z0), d = Math.min(VG_M, T.oz + TILE - z0);
    if (a >= b || c >= d) continue;
    for (let j = c; j < d; j++) {
      const r = Math.floor((z0 + j + 0.5 - T.oz) / CELL), o = j * VG_M * 4;
      for (let i = a; i < b; i++) {
        const k = (r * N + Math.floor((x0 + i + 0.5 - T.ox) / CELL)) * 4, q = o + i * 4;
        _vgData[q] = T.rgba[k]; _vgData[q + 1] = T.rgba[k + 1]; _vgData[q + 2] = T.rgba[k + 2]; _vgData[q + 3] = T.rgba[k + 3];
      }
    }
  }
  _vgTex.needsUpdate = true;
  VEG_GROUND.mask.value = _vgTex;
  VEG_GROUND.rect.value.set(x0, z0, 1 / VG_M, 1 / VG_M);
  VEG_GROUND.on.value = 1;
  return true;
}
if (typeof window !== 'undefined') window.__VEG_GROUND = VEG_GROUND;

// a compiled furniture tree (not a census street tree) standing in a managed park area: dropped (this lane plants there)
export function vegDropTree(wx, wz, f) {
  if (!VEGP1 || (f.p2 & 1)) return false;
  const p = vegCoverAt(wx, wz);
  return !!(p && (p[3] & 1));
}

// ---- the ground under a plant (as Central Park's groundAt): the lawn or a path on it, else the authority's base
const HARD = ['path', 'sidewalk', 'brick', 'plaza', 'gravel', 'gutter', 'asphalt'];
function groundAt(ctx, x, z, tree) {
  let g = ctx.sectionY ? ctx.sectionY('grass', x, z, 0) : null;
  if (g !== null && !isFinite(g)) g = null;
  let best = null;
  if (ctx.sectionY) for (const k of HARD) { const y = ctx.sectionY(k, x, z, 0); if (y !== null && isFinite(y) && (best === null || y > best)) best = y; }
  if (g !== null) return best === null || best <= g ? g : best <= g + 0.3 ? best : tree ? null : best;
  const t = haTerrainAt(x, z);
  if (best !== null) return tree && t !== null && best > t + 1.0 ? null : best;
  return t !== null ? t : ctx.padYNear(x, z);
}
const hardNear = (ctx, x, z, r) => { if (!ctx.sectionY) return false; for (const k of HARD) if (ctx.sectionY(k, x, z, r) !== null) return true; return false; };

const _c = new THREE.Color();
const _spec = new Map();
const specOf = (pool) => { let s = _spec.get(pool); if (s === undefined) _spec.set(pool, (s = tv25Spec(pool))); return s; };
const _sets = new Set(), _meshes = new Set();
let _on = true;
const claimSet = (inst, S) => { S.ids = S.spec.map(([p, x, y, z, rot, sW, sH, col]) => inst.claim(p, x, y, z, rot, sW, sH, sW, col)); };
const releaseSet = (inst, S) => { if (S.ids) S.spec.forEach(([p], i) => { if (S.ids[i] >= 0) inst.release(p, S.ids[i]); }); S.ids = null; };
export const VEGP1_STATS = { tiles: {}, trees: 0, shrubs: 0, ground: 0, miss: 0, deck: 0 };
const tone = (b, x, z, k = 1) => {
  const h1 = hh(x, z, k + 0.5), h2 = frac(h1 * 57.3 + 0.31);
  const v = 0.9 + 0.2 * h1, hj = (h2 - 0.5) * 0.09;
  return [Math.min(1, b[0] * v * (1 + hj)), Math.min(1, b[1] * v), Math.min(1, b[2] * v * (1 - hj * 0.6))];
};

// the tile's plants, added to its group (disposed with it)
export function vegBuild(group, ctx) {
  if (!VEGP1) return;
  const T = tileOf(ctx.ox + 1, ctx.oz + 1);
  const inst = window.__INST || window.__INSTANCER;
  if (!T || !inst) return;
  const t0 = performance.now();
  const st = { trees: 0, shrubs: 0, ground: 0, miss: 0, deck: 0 };
  // ---- trees
  const S = { spec: [], ids: null, inst };
  const PGV = PG_ON && ctx.tile ? placeGuard(ctx.tile, ctx.ox, ctx.oz) : null;
  for (const [xd, zd, hd, cwd, sp, fl, fd] of T.veg.trees) {
    const x = xd / 10, z = zd / 10;
    const row = CP_SPECIES[sp] || CP_SPECIES[0];
    const F = row[3];
    const h1 = hh(x, z, 1), h2 = hh(x, z, 2);
    const nv = (TREE_FORMS[F] && TREE_FORMS[F].variants) || 1;
    const pool = 'tree' + F + (nv > 1 && h2 < 0.5 ? '2' : '');
    const P = specOf(pool);
    if (!P) { st.miss++; continue; }
    const wood = fl & 1;
    // nine growing seasons since the 2017 flight: a crown ~0.22 m wider a year (a tree under 8 m in proportion to its
    // height), a tree ~0.12 m taller
    const g = GROW * Math.min(1, (hd / 10) / 8);
    const cw = Math.min(28, ((fd || cwd) / 10 + 0.22 * g) * (wood ? CWK_WOOD : CWK_OPEN));
    const h = Math.max(3, (hd / 10 + 0.12 * GROW) * HK);
    if (PGV && PGV.why(x, z, FURN.TREE)) { st.guard = (st.guard || 0) + 1; continue; }   // TERRAIN INT2 (world/placeGuard.js)
    const y = groundAt(ctx, x, z, true);
    if (y === null) { st.deck++; continue; }
    const sW = cw / P.W, sH = h / P.H, rot = h1 * 6.2832;
    // bark: the kit's street-tree barks are warm (a cherry's reads orange); a park tree's trunk in the woods' shade is a
    // greyer, darker brown, mossed on its shaded side
    if (F === 'Y' || F === 'R') _c.setRGB(0.42, 0.50, 0.76); else _c.setRGB(0.70, 0.75, 0.86);
    if (wood) _c.multiplyScalar(0.86);
    S.spec.push([pool + 'Trunk', x, y, z, rot, sW, sH, _c.getHex()]);
    let col = cpCanopyHex(F, x, z, !!row[4], sp);
    if (wood) {
      // the woods read as one deep blue-green mass from the air: each species' tone halfway to the woods'
      // own, then darker; the pale locusts and the cherries' yellow-green do not stand out as lime
      _c.setHex(col);
      // (the compound-leaved forms, locust and sophora, read lime in the leaf atlas: pulled further)
      const k = F === 'H' || F === 'S' ? 0.75 : 0.5;
      _c.r = (_c.r * (1 - k) + WOOD_RGB[0] * k) * WOOD_TONE * (F === 'H' || F === 'S' ? 0.9 : 1);
      _c.g = (_c.g * (1 - k) + WOOD_RGB[1] * k) * WOOD_TONE;
      _c.b = Math.min(1, (_c.b * (1 - k) + WOOD_RGB[2] * k) * WOOD_TONE * 1.04);
      col = _c.getHex();
    } else {
      // a lawn or grove tree: a lighter pull, the species' own tone kept (the kit's bright street greens read lime here)
      _c.setHex(col);
      _c.r = (_c.r * 0.7 + 0.62 * 0.3) * 0.92; _c.g = (_c.g * 0.7 + 0.72 * 0.3) * 0.93; _c.b = Math.min(1, (_c.b * 0.7 + 0.88 * 0.3) * 0.95);
      col = _c.getHex();
    }
    S.spec.push([pool + 'Crown', x, y, z, rot, sW, sH, col]);
    st.trees++;
  }
  if (_on) claimSet(inst, S);
  if (S.ids) st.miss += S.ids.filter((id) => id < 0).length;
  _sets.add(S);
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const sentinel = new THREE.Mesh(sg, new THREE.MeshBasicMaterial());
  sentinel.visible = false; sentinel.name = 'vegp1:treeClaims';
  sentinel.geometry.addEventListener('dispose', () => {
    releaseSet(inst, S); _sets.delete(S); delete VEGP1_STATS.tiles[ctx.key];
    group.traverse((o) => { if (_meshes.has(o)) _meshes.delete(o); });
  });
  group.add(sentinel);
  // ---- shrubs (the understorey)
  const bark = cpBarkMat();
  const leaf = vg37LeafMat();
  if (SHRUBS) {
    const SF = vg37UnderForms(), sets = SF.map(() => []);
    for (const [xd, zd, hd, wd] of T.veg.shrubs) {
      const x = xd / 10, z = zd / 10;
      if (hardNear(ctx, x, z, 0.8)) continue;
      const y = groundAt(ctx, x, z, true);
      if (y === null) continue;
      const v = Math.min(SF.length - 1, Math.floor(hh(x, z, 31) * SF.length));
      sets[v].push({ x, y: y - 0.06, z, yaw: hh(x, z, 32) * 6.2832, sx: (wd / 10) / 3.4, sy: (hd / 10) / 3.2, c: tone([0.74, 0.82, 0.92], x, z, 9) });
      st.shrubs++;
    }
    SF.forEach((F, v) => { if (sets[v].length) group.add(lodSet('vegp1:shrub' + v, sets[v], [{ near: F.leaves0, mid: F.leaves1, mat: leaf, cast: false }], 80, 300, _meshes)); });
  }
  // ---- ground plants by the cover: the woodland floor's ivy, sedge and ferns; the meadows' tall grass and asters
  if (GROUND) {
    const GF = vg37CoverForms(), FF = fernForms();
    const fg = vg37Form('fountain'), fa = vg37Form('aster'), fs = vg37Form('sedge');
    const MF = [{ leaves0: fg.lod0, leaves1: fg.lod1 }, { leaves0: fs.lod0, leaves1: fs.lod1 }, { leaves0: fa.lod0, leaves1: fa.lod1 }];
    const covers = GF.map(() => []), ferns = FF.map(() => []), mead = MF.map(() => []);
    const a = T.rgba;
    const at = (x, z) => { const c = Math.floor((x - T.ox) / CELL), r = Math.floor((z - T.oz) / CELL); return c < 0 || r < 0 || c >= N || r >= N ? -1 : (r * N + c) * 4; };
    for (let gx = T.ox + 0.9; gx < T.ox + TILE; gx += 1.8) for (let gz = T.oz + 0.9; gz < T.oz + TILE; gz += 1.8) {
      const x = gx + (hh(gx, gz, 71) - 0.5) * 1.6, z = gz + (hh(gx, gz, 72) - 0.5) * 1.6;
      const i = at(x, z);
      if (i < 0 || !(a[i + 3] & 1)) continue;
      const cls = a[i];
      if (cls !== WOOD && cls !== MEADOW && cls !== DIRT && cls !== ROCK) continue;
      const u = hh(x, z, 73);
      const drift = 0.5 + 0.5 * Math.sin(x * 0.083 + Math.sin(z * 0.047) * 2.4) * Math.sin(z * 0.071 + Math.sin(x * 0.059) * 2.1);
      let list = null, s = 1, c = null, sink = 0.03;
      if (cls === WOOD) {
        // the floor: litter mostly (the shader's), plants in drifts, more where the canopy opens
        const open = 1 - a[i + 1] / 255;
        if (u > 0.22 + 0.45 * drift + 0.25 * open) continue;
        if (hh(x, z, 74) < 0.3) { const v = hh(x, z, 75) < 0.5 ? 0 : 1; list = ferns[v]; s = 0.7 + 0.6 * hh(x, z, 76); c = tone([0.70, 0.80, 0.86], x, z, 11); }
        else { const v = Math.min(GF.length - 1, Math.floor(hh(x, z, 77) * GF.length)); list = covers[v]; s = 0.7 + 0.7 * hh(x, z, 78); c = tone([0.66, 0.80, 0.74], x, z, 15); }
      } else if (cls === MEADOW) {
        if (u > 0.55 + 0.35 * drift) continue;
        // unmown grass: sedge-like tufts mostly, a few taller grass clumps (the kit's fountain grass, small, its plumes
        // read as seed heads), no garden perennials
        const v = hh(x, z, 79) < 0.3 ? 0 : 1;
        list = mead[v]; s = (v === 0 ? 0.5 : 0.9) + (v === 0 ? 0.3 : 0.6) * hh(x, z, 80); c = tone(v === 0 ? [0.80, 0.80, 0.64] : [0.76, 0.84, 0.70], x, z, 13);
      } else {
        // bare ground and rock: a few sedge tufts in the cracks
        if (u > 0.08) continue;
        list = mead[1]; s = 0.6 + 0.5 * hh(x, z, 81); c = tone([0.80, 0.82, 0.68], x, z, 17);
      }
      if (hardNear(ctx, x, z, 0.5)) continue;
      const y = groundAt(ctx, x, z, true);
      if (y === null) continue;
      list.push({ x, y: y - sink, z, yaw: hh(x, z, 82) * 6.2832, sx: s, sy: s * (0.8 + 0.4 * hh(x, z, 83)), c });
      st.ground++;
    }
    GF.forEach((F, v) => { if (covers[v].length) group.add(lodSet('vegp1:cover' + v, covers[v], [{ near: F.leaves0, mid: F.leaves1, mat: leaf, cast: false }], 40, 90, _meshes)); });
    FF.forEach((F, v) => { if (ferns[v].length) group.add(lodSet('vegp1:fern' + v, ferns[v], [{ near: F.leaves0, mid: F.leaves1, mat: inst.crownMat || leaf, cast: false }], 40, 80, _meshes)); });
    MF.forEach((F, v) => { if (mead[v].length) group.add(lodSet('vegp1:meadow' + v, mead[v], [{ near: F.leaves0, mid: F.leaves1, mat: leaf, cast: false }], 45, 110, _meshes)); });
  }
  st.ms = +(performance.now() - t0).toFixed(1);
  VEGP1_STATS.tiles[ctx.key] = st;
  for (const k of ['trees', 'shrubs', 'ground', 'miss', 'deck']) VEGP1_STATS[k] = Object.values(VEGP1_STATS.tiles).reduce((s, q) => s + q[k], 0);
  window.__VEGP1 = VEGP1_STATS;
  void bark;
}

// in-page A/B: __VEGP1_SET(false) hands the trees back and hides the plants
if (typeof window !== 'undefined') {
  window.__VEGP1_SET = (on) => {
    on = !!on;
    if (on === _on) return _on;
    _on = on;
    for (const S of _sets) { if (on) claimSet(S.inst, S); else releaseSet(S.inst, S); }
    for (const m of _meshes) m.visible = on;
    return _on;
  };
  // __VEGP1_AB(ms): the frame rate on, off, on again in the same page (as city/cpFlora.js __CP32F_AB)
  window.__VEGP1_AB = async (ms = 3000) => {
    const wait = (t) => new Promise((r) => setTimeout(r, t));
    const fps = async () => { await wait(900); const a = window.__FRAMES(); await wait(ms); const b = window.__FRAMES(); return +(((b.frames - a.frames) * 1000) / (b.t - a.t)).toFixed(1); };
    const perf = () => { try { const i = window.__RENDERER && window.__RENDERER.info; return i ? { calls: i.render.calls, tris: i.render.triangles } : null; } catch (e) { return null; } };
    const on1 = await fps(), p1 = perf();
    window.__VEGP1_SET(false);
    const off = await fps(), p0 = perf();
    window.__VEGP1_SET(true);
    const on2 = await fps();
    return { on: on1, off, on2, msOn: +(1000 / ((on1 + on2) / 2)).toFixed(2), msOff: +(1000 / off).toFixed(2), on1p: p1, offp: p0, trees: VEGP1_STATS.trees };
  };
}
