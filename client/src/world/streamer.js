import * as THREE from 'three';
import { StaticPool } from './staticPool.js';
import { assembleTile } from './assemble.js';
import { HA_P1, haTerrainAt } from './heightAuthority.js';
import { haSetSurface, haAnchorBridges } from './haAnchor.js';   // P1 TERRAIN: the re-anchored builders stand on this streamer's surfaces
import { FAR_UNIFORMS, NEAR_MASK_N } from './materials.js';
import { TILE, MACRO } from '../shared/geo.js';
import { buildMacroCrowns } from './towers.js';
import { NO_TOWER_FX } from './materials.js';
import { FW14, fw14Uv } from './materials.js';   // FW14: the far city's window grid
import { lf39Load, lf39Macro } from './lotfix39.js';   // LF39 (LOTFIX): far LoD boxes of the buildings our export lacks

// LITE15: ?near= narrows the near-detail radius for the light showcase build (default 1000 m)
const NEAR_R = Math.max(300, Number(new URLSearchParams(location.search).get('near')) || 1000);      // near-detail radius (m)
const UNLOAD_R = NEAR_R + 320;    // hysteresis
const MACRO_R = Math.max(2000, Number(new URLSearchParams(location.search).get('macro')) || 13000);    // far-LoD visibility radius (fog hides beyond); LITE15: ?macro=
const FETCH_CONC = 5;
// ==== R1B lod16 (client/src/lod/, docs/notes/arch-r1-b.md): ?lod16=1 replaces the far boxes and the draw-distance fog with
// the persistent tier, the landmark registry and the LOD streaming manager
const LOD16 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('lod16') === '1';
// ==== /R1B

export class Streamer {
  constructor(scene, ctx) {
    this.scene = scene;
    this.ctx = ctx;
    if (HA_P1) haSetSurface((x, z) => this.surfaceAt(x, z), (x, z) => this.surfaces.has(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`));
    if (!ctx.scene) ctx.scene = scene; // shared pools (signs) need the scene
    this.manifest = null;
    this.tiles = new Map();   // key -> {state: 'loading'|'ready', data}
    this.macros = new Map();  // key -> {state, mesh}
    this.fetching = 0;
    this.queue = [];          // pending near assemblies (arraybufs)
    this.hold = null;         // FP26 film hold: 'grow' loads and never unloads, 'freeze' neither loads nor unloads
    this.listeners = { add: [], remove: [] };
    this.terrains = new Map();
    this.surfaces = new Map();   // tileKey -> data.surfaceY (see assemble.js)
    this.surfInfos = new Map();  // tileKey -> data.surfaceInfo ({kind, y, road})
    this.roadAts = new Map();    // tileKey -> data.roadAt (carriageway under a point, whatever is drawn over it)
    this.macroGroup = new THREE.Group();
    scene.add(this.macroGroup);
    this.stats = { near: 0, macro: 0, pending: 0 };
    this._maskVer = 0;     // NM24: bumped whenever a near tile becomes ready or is unloaded
    this._maskKey = '';
  }
  async init(base = 'tiles') {
    // ?tiles=tiles_dev or ?tiles=http://127.0.0.1:5310/tiles_dev — test a dev compile without touching the live set
    if (typeof location !== 'undefined') base = new URLSearchParams(location.search).get('tiles') || base;
    this.base = base;
    this.manifest = await (await fetch(`${base}/manifest.json`)).json();
    this.bridges = await (await fetch(`${base}/bridges.json`)).json();
    if (HA_P1) { try { await haAnchorBridges(this.bridges); } catch (e) { console.warn('[terrain p1] bridges', e); } }   // P1 TERRAIN: the Manhattan ends
    // ==== R1A cells (client/src/cells/, docs/specs/cell-package.md): ?cells=1 draws the baked cells from their packages
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('cells') === '1') {
      try { const { CellLoader } = await import('../cells/cellLoader.js'); this.cells = await new CellLoader(this).init(); }
      catch (e) { console.warn('[cells] loader unavailable, the live city is drawn', e); this.cells = null; }
    }
    // ==== /R1A
    // ==== R1B lod16
    if (LOD16) {
      try { const { LodManager } = await import('../lod/manager.js'); this.lod16 = await new LodManager(this.scene, this.ctx, this).init(); }
      catch (e) { console.warn('[lod16] manager unavailable, far boxes kept', e); this.lod16 = null; }
    }
    // ==== /R1B
    return this;
  }
  // A late subscriber is REPLAYED every tile that is already in (film, 2026-09-23): the walker graph subscribes only after
  // the crowd's ~80 MB of assets have loaded, and on a cold boot every tile around the camera was in by then — the
  // sidewalks in shot never became walkable and the recorded street stayed empty.
  onTile(add, remove) {
    this.listeners.add.push(add); this.listeners.remove.push(remove);
    for (const [key, t] of this.tiles) if (t.state === 'ready' && t.data) add(key, t.data);
  }
  // Exact height of the paved / planted surface at (x, z), or null outside the
  // loaded ring. `terrainAt` returns the BASE PLANE (3.24 on the flat set): the
  // pavement stack sits 0.145-0.30 m above it, which every caller used to guess
  // with a constant (+0.15 in the player, +0.16 in the ped graph) and so put
  // feet a couple of centimetres off the flags — an AO shadow under every shoe.
  surfaceAt(x, z) {
    const fn = this.surfaces.get(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`);
    return fn ? fn(x, z) : null;
  }
  // …and WHAT that surface is: `{kind, y, road}` or null outside the loaded
  // ring. `road` is true only for asphalt / gutter / bus lane, so a caller can
  // say "not here" instead of only "how high" — the parked fleet uses it to
  // refuse a lawn and the ped graph to walk itself off the carriageway.
  surfaceInfoAt(x, z, tol) {
    const fn = this.surfInfos.get(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`);
    return fn ? fn(x, z, tol) : null;
  }
  // true / false where the tile is in, null where it is not
  roadAt(x, z, tol) {
    const fn = this.roadAts.get(`${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`);
    return fn ? fn(x, z, tol) : null;
  }
  terrainAt(x, z) {
    if (HA_P1) { const a = haTerrainAt(x, z); if (a !== null) return a; }   // P1 TERRAIN: the region's base (world/heightAuthority.js)
    const key = `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
    const t = this.terrains.get(key);
    if (!t) return null;
    const { grid, res, ox, oz } = t;
    const n = res + 1;
    const fx = Math.min(res - 0.001, Math.max(0, ((x - ox) / TILE) * res));
    const fz = Math.min(res - 0.001, Math.max(0, ((z - oz) / TILE) * res));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    // triangle-lerp matching the rendered terrain's diagonal split — bilinear
    // mismatches the drawn surface by up to |y00+y11-y01-y10|/4 mid-cell
    const y00 = grid[j * n + i], y10 = grid[j * n + i + 1], y01 = grid[(j + 1) * n + i], y11 = grid[(j + 1) * n + i + 1];
    return u >= v
      ? y00 + u * (y10 - y00) + v * (y11 - y10)
      : y00 + v * (y01 - y00) + u * (y11 - y01);
  }
  // is the tile under the LAST update position assembled? (the shot harnesses gate
  // on this: counting ready tiles anywhere let open-water frames through under load)
  readyUnder() {
    if (this.px === undefined) return false;
    const t = this.tiles.get(`${Math.floor(this.px / TILE)}_${Math.floor(this.pz / TILE)}`);
    return !!(t && t.state === 'ready');
  }
  update(px, pz) {
    if (!this.manifest) return;
    if (this.cells) this.cells.tick();   // ==== R1A cells: sweeps what joined the scene inside the baked cells
    this.px = px; this.pz = pz;
    FAR_UNIFORMS.playerXZ.value.set(px, pz);
    const frz = this.hold === 'freeze', keep = frz || this.hold === 'grow';
    // only discard far buildings once the near ring is actually assembled (the ?nmask=0 circle; NM24 masks by tile)
    FAR_UNIFORMS.nearR.value = this.tiles.size > 4 ? NEAR_R * 0.82 : 0;
    // ---- near tiles
    const t0x = Math.floor((px - NEAR_R) / TILE), t1x = Math.floor((px + NEAR_R) / TILE);
    const t0z = Math.floor((pz - NEAR_R) / TILE), t1z = Math.floor((pz + NEAR_R) / TILE);
    const want = [];
    let outstanding = 0;
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      const cx = tx * TILE + TILE / 2, cz = tz * TILE + TILE / 2;
      const d = Math.hypot(cx - px, cz - pz);
      if (d > NEAR_R + TILE * 0.7) continue;
      const key = `${tx}_${tz}`;
      if (!this.manifest.tiles[key]) continue;
      const rec = this.tiles.get(key);
      if (!rec) { if (!frz) { want.push({ key, d }); outstanding++; } }
      else if (rec.state !== 'ready') outstanding++;
    }
    this.outstanding = outstanding;
    want.sort((a, b) => a.d - b.d);
    for (const w of want) {
      if (this.fetching >= FETCH_CONC) break;
      this._fetchTile(w.key);
    }
    // assembly budget: one tile per frame (PF25: held while boot waits for the landmarks module)
    if (this.queue.length && !this.holdAssembly) {
      const { key, buf } = this.queue.shift();
      this._assemble(key, buf);
    }
    // unload
    for (const [key, t] of this.tiles) {
      const [tx, tz] = key.split('_').map(Number);
      const cx = tx * TILE + TILE / 2, cz = tz * TILE + TILE / 2;
      if (!keep && Math.hypot(cx - px, cz - pz) > UNLOAD_R + TILE * 0.7 && t.state === 'ready') {
        t.data.dispose(this.scene, this.ctx.instancer);
        for (const fn of this.listeners.remove) fn(key, t.data);
        this.terrains.delete(key);
        this.surfaces.delete(key);
        this.surfInfos.delete(key);
        this.roadAts.delete(key);
        this.tiles.delete(key);
        this._maskVer++;
      }
    }
    this._updateNearMask(px, pz);
    // ==== R1B lod16: no far boxes; the LOD manager draws the persistent tier, the landmarks and the refined chunks
    if (this.lod16) {
      this.lod16.update(px, pz);
      this._px = px; this._pz = pz;
      this.stats.near = this.tiles.size; this.stats.macro = 0; this.stats.pending = this.fetching + this.queue.length;
      return;
    }
    // ==== /R1B
    // ---- macros (all, nearest first, budget 1 concurrent)
    let macroLoading = 0;
    for (const m of this.macros.values()) if (m.state === 'loading') macroLoading++;
    if (macroLoading < 2 && !frz) {
      const wants = [];
      for (const key of Object.keys(this.manifest.macros)) {
        if (this.macros.has(key)) continue;
        const [mx, mz] = key.split('_').map(Number);
        const d = Math.hypot(mx * MACRO + MACRO / 2 - px, mz * MACRO + MACRO / 2 - pz);
        if (d < MACRO_R) wants.push({ key, d });
      }
      wants.sort((a, b) => a.d - b.d);
      for (const w of wants.slice(0, 2 - macroLoading)) this._fetchMacro(w.key);
    }
    this._px = px; this._pz = pz;
    this.stats.near = this.tiles.size;
    this.stats.macro = this.macros.size;
    this.stats.pending = this.fetching + this.queue.length;
  }
  // NM24: the far LoD is dropped only over near tiles that are READY (materials.js farHidden), on a NEAR_MASK_N x
  // NEAR_MASK_N window of tiles centred on the player's; rebuilt when a tile's state or the window changes
  _updateNearMask(px, pz) {
    const N = NEAR_MASK_N;
    const ox = Math.floor(px / TILE) - N / 2, oz = Math.floor(pz / TILE) - N / 2;
    const key = `${ox}_${oz}_${this._maskVer}`;
    if (key === this._maskKey) return;
    this._maskKey = key;
    const tex = FAR_UNIFORMS.nearMask.value, d = tex.image.data;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const t = this.tiles.get(`${ox + i}_${oz + j}`);
      d[j * N + i] = (t && t.state === 'ready') || (this.cells && this.cells.tileDrawn(`${ox + i}_${oz + j}`)) ? 255 : 0;   // ==== R1A cells: a tile whose baked cells are drawn
    }
    FAR_UNIFORMS.nearMaskO.value.set(ox, oz);
    tex.needsUpdate = true;
  }
  idle() {
    if (!this.manifest || this.fetching || this.queue.length || (this.outstanding ?? 1) !== 0) return false;
    if (this.cells && !this.cells.ready()) return false;   // ==== R1A cells: the packages of the ready tiles are in
    if (this.hold === 'freeze') return true;
    if (this.lod16) return this.lod16.idle();   // ==== R1B lod16: the persistent tier and the wanted chunks, not the macros
    for (const key of Object.keys(this.manifest.macros)) {
      const [mx, mz] = key.split('_').map(Number);
      const d = Math.hypot(mx * MACRO + MACRO / 2 - (this._px ?? 0), mz * MACRO + MACRO / 2 - (this._pz ?? 0));
      if (d < MACRO_R && this.macros.get(key)?.state !== 'ready') return false;
    }
    return true;
  }
  async _fetchTile(key) {
    this.fetching++;
    this.tiles.set(key, { state: 'loading' });
    try {
      const r = await fetch(`${this.base}/${this.manifest.tiles[key].f}`);
      const buf = await r.arrayBuffer();
      this.queue.push({ key, buf });
    } catch (e) { console.warn('tile fetch', key, e); this.tiles.delete(key); }
    this.fetching--;
  }
  async _assemble(key, buf) {
    try {
      const data = await assembleTile(key, buf, this.ctx);
      const rec = this.tiles.get(key);
      if (!rec) { data.dispose(this.scene, this.ctx.instancer); return; } // unloaded while queued
      if (this.cells) { try { this.cells.onTile(key, data); } catch (e) { console.warn('[cells] tile', key, e); } }   // ==== R1A cells
      this.scene.add(data.group);
      rec.state = 'ready';
      rec.data = data;
      this._maskVer++;
      this.terrains.set(key, data.terrain);
      if (data.surfaceY) this.surfaces.set(key, data.surfaceY);
      if (data.surfaceInfo) this.surfInfos.set(key, data.surfaceInfo);
      if (data.roadAt) this.roadAts.set(key, data.roadAt);
      for (const fn of this.listeners.add) fn(key, data);
    } catch (e) { console.error('assemble', key, e); this.tiles.delete(key); }
  }
  async _fetchMacro(key) {
    this.macros.set(key, { state: 'loading' });
    try {
      const r = await fetch(`${this.base}/${this.manifest.macros[key].f}`);
      const buf = await r.arrayBuffer();
      const dv = new DataView(buf);
      const hLen = dv.getUint32(4, true);
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hLen)));
      const base = 8 + hLen + ((4 - ((8 + hLen) % 4)) % 4);
      let pos = null, col = null, terr = null;
      for (const s of header.sections) {
        if (s.name === 'pos') pos = new Int16Array(buf, base + s.offset, s.length);
        if (s.name === 'col') col = new Uint8Array(buf, base + s.offset, s.length);
        if (s.name === 'terr') terr = new Float32Array(buf, base + s.offset, s.length);
      }
      // LF39 (LOTFIX, world/lotfix39.js; `?lf39=0` none): the far LoD boxes of the buildings our footprint export lacks
      // (53 W 53rd St on the skyline from Central Park), in the compiler's own format, before the crowns are rebuilt
      try {
        const add = lf39Macro(key, await lf39Load());
        if (add && pos && col) {
          const p2 = new Int16Array(pos.length + add.pos.length); p2.set(pos); p2.set(add.pos, pos.length);
          const c2 = new Uint8Array(col.length + add.col.length); c2.set(col); c2.set(add.col, col.length);
          pos = p2; col = c2;
        }
      } catch (e) { console.warn('[lf39] macro', e); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
      if (FW14) g.setAttribute('uv', new THREE.BufferAttribute(fw14Uv(pos, header.origin), 2));   // FW14 (world/materials.js): the far window grid
      const mesh = new THREE.Mesh(g, this.ctx.farMat);
      mesh.position.set(header.origin[0], 0, header.origin[1]);
      g.computeBoundingSphere();
      this.macroGroup.add(mesh);
      // ---- SKYSCRAPER PASS (docs/notes/skyscrapers.md): the macro bakes every
      // building as a flat-topped box, so past 820 m the skyline lost every
      // crown, bulkhead and mast it has inside the near ring — the "bar chart"
      // horizon in `mMidtownSky` / `fSkyline`. compile.mjs is the lead's and a
      // four-borough recompile is 50 min, so the crowns are reconstructed from
      // the baked buffer here and drawn with the SAME material (hence the same
      // near-radius discard, night stipple, weather and re-lighting). Only
      // macros that actually contain 55 m+ buildings get a second mesh.
      let cMesh = null;
      try {
        const cr = NO_TOWER_FX ? null : buildMacroCrowns(pos, col);
        if (cr) {
          const cg = new THREE.BufferGeometry();
          cg.setAttribute('position', new THREE.BufferAttribute(cr.pos, 3));
          cg.setAttribute('color', new THREE.BufferAttribute(cr.col, 4, true));
          cg.computeBoundingSphere();
          cMesh = new THREE.Mesh(cg, this.ctx.farMat);
          cMesh.name = 'macroCrowns_' + key;
          cMesh.position.set(header.origin[0], 0, header.origin[1]);
          this.macroGroup.add(cMesh);
          this.crownStats = (this.crownStats || 0) + cr.towers;
        }
      } catch (e) { if (!this._crownErr) { this._crownErr = 1; console.warn('macro crowns', e); } }
      let tMesh = null;
      if (terr) {
        const res = 32, n = res + 1;
        const tp = new Float32Array(res * res * 6 * 3);
        let o = 0;
        for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
          const x0 = (i / res) * MACRO, x1 = ((i + 1) / res) * MACRO;
          const z0 = (j / res) * MACRO, z1 = ((j + 1) / res) * MACRO;
          const y00 = terr[j * n + i] - 0.5, y10 = terr[j * n + i + 1] - 0.5, y01 = terr[(j + 1) * n + i] - 0.5, y11 = terr[(j + 1) * n + i + 1] - 0.5;
          for (const [x, y, z] of [[x0, y00, z0], [x1, y11, z1], [x1, y10, z0], [x0, y00, z0], [x0, y01, z1], [x1, y11, z1]]) {
            tp[o * 3] = x; tp[o * 3 + 1] = y; tp[o * 3 + 2] = z; o++;
          }
        }
        const tg = new THREE.BufferGeometry();
        tg.setAttribute('position', new THREE.BufferAttribute(tp, 3));
        const mat = new Float32Array(o).fill(8);
        tg.setAttribute('matId', new THREE.BufferAttribute(mat, 1));
        tg.computeVertexNormals();
        tg.computeBoundingSphere();
        // all far-terrain skirts share ONE mesh (staticPool): ~270 macro tiles
        // were ~270 draw calls of 2k tris each. Geometry is baked in world space.
        tg.translate(header.origin[0], 0, header.origin[1]);
        if (!this._terrPool) {
          this._terrPool = new StaticPool(this.macroGroup, this.ctx.groundMat, {
            attrs: { position: 3, normal: 3, matId: 1 }, capVerts: 262144, castShadow: false, receiveShadow: true, name: 'farTerrain',
          });
        }
        tMesh = { handle: this._terrPool.alloc(tg) };
        tg.dispose();
      }
      this.macros.set(key, { state: 'ready', mesh, tMesh, cMesh });
    } catch (e) { console.warn('macro fetch', key, e); this.macros.set(key, { state: 'ready', mesh: null }); }
  }
}
