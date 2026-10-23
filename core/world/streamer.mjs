// The headless streamer: the part of client/src/world/streamer.js the sims talk to (onTile, surfaceAt, surfaceInfoAt,
// roadAt, terrainAt, bridgeRoads), loading tiles from disk around a centre with the page's near ring (1000 m, unload at
// 1320 m, both measured to the tile centre with the page's 0.7-tile margin). No meshes: each tile becomes its sim view
// (simTile.mjs), plus its building footprints as collider prisms (the walkers' "inside a building" test, sim/peds.js).
//
// Loading is synchronous within a step and in a fixed order (nearest first, then key), so a take is reproducible: the
// page loads tiles concurrently (five fetches, one assembly a frame), which only changes WHEN a tile arrives, not what
// it holds.
import fs from 'node:fs';
import path from 'node:path';
import { TILE } from '../../client/src/shared/geo.js';
import { parseTile, buildingsOf } from '../../client/src/world/tiledata.js';
import { COLLIDERS } from '../../client/src/city/colliders.js';
import { simTile } from './simTile.mjs';
import { PUBLIC } from '../env/shim.mjs';
import { HA_P1, haTerrainAt } from '../../client/src/world/heightAuthority.js';

export const NEAR_R = 1000, UNLOAD_R = NEAR_R + 320;

// VALDRADA_TILES=<dir> points every core tool at another compiled set (a staging compile) without a code change
export const TILES_DIR = process.env.VALDRADA_TILES ? path.resolve(process.env.VALDRADA_TILES) : path.join(PUBLIC, 'tiles');

export class HeadlessStreamer {
  constructor({ tilesDir = TILES_DIR, nearR = NEAR_R, unloadR = UNLOAD_R, colliders = true, obstaclesDir = null } = {}) {
    this.dir = tilesDir;
    this.nearR = nearR; this.unloadR = unloadR;
    this.withColliders = colliders;
    this.manifest = JSON.parse(fs.readFileSync(path.join(this.dir, 'manifest.json'), 'utf8'));
    this.bridges = JSON.parse(fs.readFileSync(path.join(this.dir, 'bridges.json'), 'utf8'));
    // city/bridgeKit.js buildBridges: the decks that carry cars (the same record traffic.js adds as edges)
    this.bridgeRoads = [];
    for (const br of this.bridges) {
      if (!br.deck || br.deck.length < 2 || br.foot) continue;
      const W = Math.min(38, br.width);
      this.bridgeRoads.push({ pts: br.deck.map((p) => [...p]), width: W, lanes: Math.max(2, Math.round(W / 3.6)), speed: 40, oneway: 0, rclass: 3, name: br.name, level: 1 });
    }
    this.tiles = new Map();
    this.listeners = { add: [], remove: [] };
    this.terrains = new Map(); this.surfaces = new Map(); this.surfInfos = new Map(); this.roadAts = new Map();
    this.ctx = {};   // the page's ctx.instancer: here only the walkers' obstacle pools, from obstacle files when given
    // OBSTACLES (prototype of the cell sidecar's colliders, tools/core/obstacles.mjs): per pool its footprint boxes
    // (foot.json) and per tile its live instances (t_<tile>.json), as instancer-shaped pools sim/peds.js reads
    const footFiles = obstaclesDir && fs.existsSync(obstaclesDir) ? fs.readdirSync(obstaclesDir).filter((f) => /^foot.*\.json$/.test(f)).sort() : [];
    this.obstaclesDir = footFiles.length ? obstaclesDir : null;
    if (this.obstaclesDir) {
      const F = {};   // the pools' footprints (the same kit everywhere; every dump's file merged)
      for (const f of footFiles) Object.assign(F, JSON.parse(fs.readFileSync(path.join(obstaclesDir, f), 'utf8')));
      this.obsFoot = new Map();   // pool name -> { token (the pool's geometry key), boxes }
      for (const [name, boxes] of Object.entries(F)) this.obsFoot.set(name, { token: { obstaclePool: name }, boxes: boxes.map(([x0, x1, z0, z1, y0, y1]) => ({ x0, x1, z0, z1, y0, y1 })) });
      this.ctx.instancer = { pools: new Map() };
      this.obsSlots = new Map();   // tile key -> [[pool, slot] ...]
    }
    this.hold = null;
    this.stats = { near: 0, loaded: 0, unloaded: 0, loadMs: 0, bytes: 0, ...(this.obstaclesDir ? { obstacles: 0 } : {}) };
  }
  // P1 TERRAIN (TERRAIN_P1=1): the bridges' Manhattan ends on the authority's ground and their LiDAR decks
  // (client/src/world/haAnchor.js haAnchorBridges), and the decks the cars drive with them; core/sim/world.mjs calls it
  async anchorBridges() {
    if (!HA_P1) return 0;
    const { haAnchorBridges } = await import('../../client/src/world/haAnchor.js');
    const n = await haAnchorBridges(this.bridges);
    this.bridgeRoads = [];
    for (const br of this.bridges) {
      if (!br.deck || br.deck.length < 2 || br.foot) continue;
      const W = Math.min(38, br.width);
      this.bridgeRoads.push({ pts: br.deck.map((p) => [...p]), width: W, lanes: Math.max(2, Math.round(W / 3.6)), speed: 40, oneway: 0, rclass: 3, name: br.name, level: 1 });
    }
    return n;
  }
  onTile(add, remove) {
    this.listeners.add.push(add); this.listeners.remove.push(remove);
    for (const [key, t] of this.tiles) if (t.state === 'ready' && t.data) add(key, t.data);
  }
  _key(x, z) { return `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`; }
  surfaceAt(x, z) { const fn = this.surfaces.get(this._key(x, z)); return fn ? fn(x, z) : null; }
  surfaceInfoAt(x, z, tol) { const fn = this.surfInfos.get(this._key(x, z)); return fn ? fn(x, z, tol) : null; }
  roadAt(x, z, tol) { const fn = this.roadAts.get(this._key(x, z)); return fn ? fn(x, z, tol) : null; }
  terrainAt(x, z) {
    if (HA_P1) { const a = haTerrainAt(x, z); if (a !== null) return a; }   // P1 TERRAIN: the region's base (client/src/world/heightAuthority.js)
    const t = this.terrains.get(this._key(x, z));
    if (!t) return null;
    const { grid, res, ox, oz } = t;
    const n = res + 1;
    const fx = Math.min(res - 0.001, Math.max(0, ((x - ox) / TILE) * res));
    const fz = Math.min(res - 0.001, Math.max(0, ((z - oz) / TILE) * res));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const y00 = grid[j * n + i], y10 = grid[j * n + i + 1], y01 = grid[(j + 1) * n + i], y11 = grid[(j + 1) * n + i + 1];
    return u >= v ? y00 + u * (y10 - y00) + v * (y11 - y10) : y00 + v * (y01 - y00) + u * (y11 - y01);
  }
  // the tiles the page's near ring wants around (px, pz), nearest first
  wanted(px, pz) {
    const R = this.nearR;
    const t0x = Math.floor((px - R) / TILE), t1x = Math.floor((px + R) / TILE);
    const t0z = Math.floor((pz - R) / TILE), t1z = Math.floor((pz + R) / TILE);
    const out = [];
    for (let tz = t0z; tz <= t1z; tz++) for (let tx = t0x; tx <= t1x; tx++) {
      const d = Math.hypot(tx * TILE + TILE / 2 - px, tz * TILE + TILE / 2 - pz);
      if (d > R + TILE * 0.7) continue;
      const key = `${tx}_${tz}`;
      if (this.manifest.tiles[key]) out.push({ key, d });
    }
    out.sort((a, b) => a.d - b.d || (a.key < b.key ? -1 : 1));
    return out;
  }
  // load every wanted tile now (the page's ring, fully resident), unload past the unload ring; returns the keys added
  async update(px, pz) {
    this.px = px; this.pz = pz;
    const frz = this.hold === 'freeze', keep = frz || this.hold === 'grow';
    const added = [];
    if (!frz) for (const { key } of this.wanted(px, pz)) {
      if (this.tiles.has(key)) continue;
      await this._load(key);
      added.push(key);
    }
    if (!keep) for (const [key, t] of [...this.tiles]) {
      const [tx, tz] = key.split('_').map(Number);
      if (Math.hypot(tx * TILE + TILE / 2 - px, tz * TILE + TILE / 2 - pz) > this.unloadR + TILE * 0.7 && t.state === 'ready') this._unload(key);
    }
    this.stats.near = this.tiles.size;
    return added;
  }
  async _load(key) {
    const t0 = performance.now();
    const file = path.join(this.dir, this.manifest.tiles[key].f);
    const nb = fs.readFileSync(file);
    const buf = nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength);
    const data = await simTile(key, buf);
    if (this.withColliders) this._addColliders(key, buf);
    if (this.obstaclesDir) this._addObstacles(key);
    this.tiles.set(key, { state: 'ready', data });
    this.terrains.set(key, data.terrain);
    this.surfaces.set(key, data.surfaceY);
    this.surfInfos.set(key, data.surfaceInfo);
    this.roadAts.set(key, data.roadAt);
    for (const fn of this.listeners.add) fn(key, data);
    this.stats.loaded++; this.stats.bytes += nb.byteLength;
    this.stats.loadMs += performance.now() - t0;
  }
  // the buildings' footprints as full-height collider prisms (assembleTile registers one per building)
  _addColliders(key, buf) {
    const tile = parseTile(buf);
    if (!tile.S.bldg || !tile.S.bldgXZ) return;
    const [ox, oz] = tile.header.origin, XZ = tile.S.bldgXZ;
    for (const b of buildingsOf(tile)) {
      if (b.len < 3) continue;
      const pts = new Float32Array(b.len * 2);
      let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
      for (let i = 0; i < b.len; i++) {
        const x = XZ[(b.start + i) * 2] + ox, z = XZ[(b.start + i) * 2 + 1] + oz;
        pts[i * 2] = x; pts[i * 2 + 1] = z;
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
      COLLIDERS.addPrism(key, { pts, minX, minZ, maxX, maxZ, y0: b.baseY - 2, y1: b.baseY + b.height });
    }
  }
  _addObstacles(key) {
    const f = path.join(this.obstaclesDir, `t_${key}.json`);
    if (!fs.existsSync(f)) return;
    const D = JSON.parse(fs.readFileSync(f, 'utf8'));
    const slots = [];
    for (const [name, list] of Object.entries(D.pools || {})) {
      const F = this.obsFoot.get(name);
      if (!F) continue;
      let p = this.ctx.instancer.pools.get(name);
      if (!p) this.ctx.instancer.pools.set(name, (p = { name, top: 0, alive: [], mats: [], geo: F.token, ver: 0 }));
      for (const m of list) {
        const s = p.top++;
        for (let k = 0; k < 16; k++) p.mats[s * 16 + k] = m[k];
        p.alive[s] = 1;
        slots.push([p, s]);
      }
      p.ver++;
      this.stats.obstacles += list.length;
    }
    this.obsSlots.set(key, slots);
  }
  _unload(key) {
    if (this.obsSlots && this.obsSlots.has(key)) { for (const [p, s] of this.obsSlots.get(key)) { p.alive[s] = 0; p.ver++; } this.obsSlots.delete(key); }
    const t = this.tiles.get(key);
    for (const fn of this.listeners.remove) fn(key, t.data);
    COLLIDERS.removeTile(key);
    this.terrains.delete(key); this.surfaces.delete(key); this.surfInfos.delete(key); this.roadAts.delete(key);
    this.tiles.delete(key);
    this.stats.unloaded++;
  }
  idle() { return true; }
  readyUnder() { return this.tiles.has(this._key(this.px ?? 0, this.pz ?? 0)); }
}
