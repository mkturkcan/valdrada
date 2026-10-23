// The L0 cell baker (docs/specs/cell-package.md, v0): runs today's client headless, holds every level of detail at its
// finest over a region, dresses its buildings and writes one package per 128 m cell into the content-hashed cache:
//   /data0/projectnyc_aux/cellcache/<hash>/cell.glb    glTF 2.0 binary (meshes, instanced sets, material keys, labels)
//   /data0/projectnyc_aux/cellcache/<hash>/cell.json   the sidecar (buildings, ground, nav, signals, lights, furniture)
//   /data0/projectnyc_aux/cellcache/<hash>/meta.json   the inputs that made it (the hash covers them)
//   /data0/projectnyc_aux/cellcache/index/<region>.json and index.json   the region index: cell -> hash, bytes, bounds
// The hash covers the tile files the cell reads, the client source trees (git tree hashes of the working client/src, less
// client/src/cells, and of src/, the @nyc subproject), the page's other files (client/public less the tiles: path, size,
// time), the baker's own files and its options. A cell whose hash is cached is skipped (--force rebakes).
//
//   GPU_LANE=35 node tools/withgpu.mjs cells-bake -- node tools/cells/bake.mjs --region lenox125 [--force] [--nomeshopt]
//   --region lenox125|cplake|<name> (see REGIONS) or --cells 16_-22,17_-22 (or --cells @<file>) [--name myregion]
//   --loadset <take>/loadset.json   the cells a take's load set lacks (union.cellsMissing); --shot <name> orders them by
//                                   distance to the shot's camera path (tools/ad/shots.json) and --near <m> keeps those within
//   --batch <n>                     cells dressed and exported together (one page boot for all batches; default 16)
//   --kitrec                        the dresser's parts and boxes as kit instances (Unreal's data path), not merged
//   --terrain p1                    the proving region's ground (P1 TERRAIN, client/src/world/heightAuthority.js), the grading,
//                                   woodland and park drives; its data dirs hashed by content
//   --hhp                           with --terrain p1: the highways (?hhp=1, client/src/city/hhp.js; data/hhp_p2 hashed)
//   --pages <n>                     pages (each its own browser) taking batches from one queue (default 4, BAKE_PAGES); a
//                                   cell another bake has claimed (cellcache/claims/<hash>) is waited for, not baked again
//   --all                           with --loadset: every cell of the set (union.cells too), not only the missing ones
//   --maxtex <px>                   the texture cap (default 4096: a texture is read back at its own size up to that)
//   --nosigncells                   the street-name blades' text from the page's shared atlas (by default each cell gets a
//                                   texture of its own, the names in name order: cellTexture, spec section 4)
//   --sidecars                      no bake: the street lamps of the cells' sidecars written again from the page (with
//                                   --loadset, every cell of the load set, baked before or not); the old file moved aside
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { ROOT, CLIENT, CACHE, sleep, stamp, startVite, startBrowser, newPage, guard } from './harness.mjs';
import { writeCellGLB } from './glbWrite.mjs';
import { createRequire } from 'node:module';
const sharp = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'))('sharp');
sharp.cache(false);

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : d; };
const has = (n) => args.includes('--' + n);
const CELL = 128;
// named test regions, in cells [cx0, cz0, cx1, cz1] inclusive (cell = floor(world / 128))
const REGIONS = {
  lenox125: [15, -23, 18, -20],   // 125th St at Lenox Avenue: x 1920..2432, z -2944..-2432 (the node at 2167, -2740)
  cplake: [-2, 5, 1, 8],          // Central Park: the Lake, Bow Bridge, Bethesda Terrace: x -256..256, z 640..1152
};
const BAKER_VERSION = 'cells-bake/0.1';
const OPTS = { time: 'day', flags: 'hud=0&lmwait=150&life=0&clean=1&nosim=1&trains=0', meshopt: !has('nomeshopt'), maxtex: Number(opt('maxtex', '4096')), signcells: !has('nosigncells') };
// ==== BR38 staged tiles: --tiles <dir under client/public> bakes from a staged tile set (the page's ?tiles=), never the
// live one; the dir must be a link into the aux tree's staging folders. The flag is part of OPTS, so the cells' hashes
// differ from the live set's.
const TILES_DIR = opt('tiles', 'tiles');
if (TILES_DIR !== 'tiles') {
  const lp = path.join(CLIENT, 'public', TILES_DIR), real = fs.existsSync(lp) ? fs.realpathSync(lp) : '';
  if (!/^[A-Za-z0-9_]+$/.test(TILES_DIR) || !real.startsWith('/data0/projectnyc_aux/') || real === fs.realpathSync(path.join(CLIENT, 'public', 'tiles'))) {
    console.error(`--tiles ${TILES_DIR}: not a staged tile set (${real || 'missing'})`); process.exit(2);
  }
  OPTS.flags += `&tiles=${TILES_DIR}`;
  // (the bridge records are drawn by the page from the set's bridges.json, which no tile hash covers)
  OPTS.bridges = crypto.createHash('sha256').update(fs.readFileSync(path.join(lp, 'bridges.json'))).digest('hex').slice(0, 16);
}
// ==== end BR38
// GB43 KIT (docs/notes/ue-city-architecture.md): --kitrec bakes the dresser's parts and boxes as kit instances (the
// page's ?kitrec=1), part of OPTS so its cells hash apart from the merged bake's
if (has('kitrec') || process.env.BAKE_KITREC === '1') OPTS.flags += '&kitrec=1';   // (BAKE_KITREC=1 through valdrada's cells step)
// P1 TERRAIN (client/src/world/heightAuthority.js): --terrain p1 bakes with the proving
// region's ground (the page's ?terrain=p1); the region's data (client/public/data/terrain_p1: manifest and chunks) is hashed
// into OPTS, so these cells hash apart from the flat city's and again whenever the ground product changes
if (opt('terrain') === 'p1') {
  const td = path.join(CLIENT, 'public', 'data', 'terrain_p1'), h = crypto.createHash('sha256');
  if (!fs.existsSync(path.join(td, 'manifest.json'))) { console.error('--terrain p1: no client/public/data/terrain_p1/manifest.json'); process.exit(2); }
  for (const f of fs.readdirSync(td).sort()) h.update(f).update(fs.readFileSync(path.join(td, f)));
  OPTS.flags += '&terrain=p1';
  OPTS.terrainP1 = h.digest('hex').slice(0, 16);
  // SHIP-MN: the rest of the new Manhattan under the same flag (the edge cut, terrainGrade.js; the woodland, vegP1.js; the
  // park drives, cpDrives.js) and, with --hhp, the parkway/FDR/HRD/WSH highways (?hhp=1: hhp.js, hhpKit.js, fdrBox.js,
  // wshCoast.js, wshGround.js); every data dir they read is hashed by content into OPTS, so a new product rebakes
  const dirHash = (d) => { const x = crypto.createHash('sha256'), walk = (q) => { for (const f of fs.readdirSync(q).sort()) { const p = path.join(q, f); if (fs.statSync(p).isDirectory()) walk(p); else x.update(path.relative(d, p)).update(fs.readFileSync(p)); } }; walk(d); return x.digest('hex').slice(0, 16); };
  OPTS.terrainData = {};
  for (const d of ['terrain_p1a', 'terrain_grade', 'veg_p1', 'hhp_p2']) { const dd = path.join(CLIENT, 'public', 'data', d); OPTS.terrainData[d] = fs.existsSync(dd) ? dirHash(dd) : 'none'; }
  if (has('hhp')) OPTS.flags += '&hhp=1';
  // (the page assembles a new-Manhattan tile in ~60 s of main thread: the near radius from 1,000 m to 600 m, so a page
  // boots on the 3 x 3 tiles round its batch, not 15; a batch reads its own tile and the neighbours within 64 m)
  OPTS.flags += `&near=${opt('near-r', '600')}`;
}

let name = opt('name'), cells = [];
if (opt('loadset')) {
  const ls = JSON.parse(fs.readFileSync(path.resolve(opt('loadset')), 'utf8'));
  cells = [...(has('sidecars') || has('all') ? (ls.union && ls.union.cells) || [] : []), ...((ls.union && ls.union.cellsMissing) || [])].map((k) => k.split('_').map(Number));   // --all: the set's baked cells too
  name = name || ls.shot || 'loadset';
} else if (opt('cells')) {   // (GB43: --cells @<file>, the list in a file: a city's 50,000 names pass no argument limit)
  const list = opt('cells').startsWith('@') ? fs.readFileSync(opt('cells').slice(1), 'utf8') : opt('cells');
  cells = list.split(/[,\s]+/).filter(Boolean).map((k) => k.split('_').map(Number)); name = name || 'custom';
}
else {
  name = name || opt('region', 'lenox125');
  const R = REGIONS[opt('region', name)];
  if (!R) { console.error('unknown region', name, Object.keys(REGIONS)); process.exit(2); }
  for (let cz = R[1]; cz <= R[3]; cz++) for (let cx = R[0]; cx <= R[2]; cx++) cells.push([cx, cz]);
}
const key = (c) => `${c[0]}_${c[1]}`;
const log = (...a) => console.log(`[bake ${stamp()}]`, ...a);
// nearest a shot's camera path first (its keys, projected; the path as the polyline through them)
const pathDist = (() => {
  const shot = opt('shot') || (opt('loadset') ? name : null);
  if (!shot) return null;
  const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8')), P = (S.shots || {})[shot] || (S.probes || {})[shot];
  if (!P || !P.keys) return null;
  const LAT0 = 40.7831, LON0 = -73.9712, ML = 111132.0, MO = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
  const pts = P.keys.map((k) => [(k.p[0] - LON0) * MO, -(k.p[1] - LAT0) * ML]);
  return ([cx, cz]) => {
    const x = (cx + 0.5) * CELL, z = (cz + 0.5) * CELL;
    let best = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[Math.min(i + 1, pts.length - 1)];
      const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz, t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
    return best;
  };
})();
if (pathDist) {
  cells.sort((a, b) => pathDist(a) - pathDist(b));
  if (opt('near')) cells = cells.filter((c) => pathDist(c) <= Number(opt('near')));
}
guard('cells-bake ' + name, Number(opt('maxmin', '240')));   // (GB43: 240, the trailer's union of 5,400 cells was stopped at 60 minutes, two thirds baked)

// ---------------------------------------------------------------- the inputs and the hashes
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function srcTree() {   // the git trees of the working client/src (not the index: a temporary one), less client/src/cells,
  // and of src/ (the subproject the page imports as @nyc: the dresser's materials and their painted textures)
  const idx = path.join(os.tmpdir(), `cells-idx-${process.pid}`);
  const env = { ...process.env, GIT_INDEX_FILE: idx };
  try {
    execFileSync('git', ['read-tree', 'HEAD'], { cwd: ROOT, env });
    execFileSync('git', ['add', '-A', 'client/src', 'src'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'ignore'] });
    // (GB43: and less the code no cell package holds: the traffic and walker simulation, the UI, the API, the game modes,
    // the perception and replay tools; a change there rebaked every cell of the city)
    execFileSync('git', ['rm', '-r', '-q', '--cached', '--ignore-unmatch', 'client/src/cells', 'client/src/sim', 'client/src/ui', 'client/src/api', 'client/src/game',
      'client/src/perception', 'client/src/replay'], { cwd: ROOT, env });
    const w = (pre) => execFileSync('git', ['write-tree', `--prefix=${pre}`], { cwd: ROOT, env, encoding: 'utf8' }).trim();
    return { client: w('client/src/'), nyc: w('src/') };
  } finally { try { fs.unlinkSync(idx); } catch { /* */ } }
}
// the files the page loads besides the tiles (client/public less tiles*: data, models, textures, fonts, luts, settings):
// the path, size and modification time of each, so a touched file counts as changed
function assetDigest() {
  const PUB = path.join(CLIENT, 'public'), out = [];
  // GB43: a tracked file by its git blob (content: a checkout that resets the times no longer rebakes the city), an
  // untracked one by size and time; the streaming tiers, the graphics settings and the grading LUTs hold no cell content
  const SKIP = /^(data\/tiers\.json|settings\/|luts\/)/;
  const blobs = new Map();
  try {
    for (const l of execFileSync('git', ['ls-files', '-s', '--', 'client/public'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n')) {
      const m = l.match(/^\d+ ([0-9a-f]+) \d\t(.+)$/); if (m) blobs.set(path.relative('client/public', m[2]), m[1]);
    }
  } catch { /* */ }
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      let st; try { st = fs.statSync(p); } catch { continue; }
      if (st.isDirectory()) walk(p);
      else if (st.isFile()) { const r = path.relative(PUB, p); if (!SKIP.test(r)) out.push(blobs.has(r) ? `${r}\t${blobs.get(r)}` : `${r}\t${st.size}\t${Math.round(st.mtimeMs)}`); }
    }
  };
  for (const e of fs.readdirSync(PUB, { withFileTypes: true })) {
    if (/^tiles/.test(e.name)) continue;
    const p = path.join(PUB, e.name);
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p); else if (st.isFile() && !SKIP.test(e.name)) out.push(blobs.has(e.name) ? `${e.name}\t${blobs.get(e.name)}` : `${e.name}\t${st.size}\t${Math.round(st.mtimeMs)}`);
  }
  return { digest: sha(out.sort().join('\n')).slice(0, 16), files: out.length };
}
const manifest = JSON.parse(fs.readFileSync(path.join(CLIENT, 'public', TILES_DIR, 'manifest.json'), 'utf8'));   // (BR38: TILES_DIR)
const tileHash = new Map();
const tileSha = (t) => {
  if (!tileHash.has(t)) { const e = manifest.tiles[t]; tileHash.set(t, e ? sha(fs.readFileSync(path.join(CLIENT, 'public', TILES_DIR, e.f))) : 'none'); }
  return tileHash.get(t);
};
// the tiles a cell reads: its own, and the neighbour across any tile edge within 64 m of the cell
function tilesOf([cx, cz]) {
  const x0 = cx * CELL - 64, x1 = (cx + 1) * CELL + 64, z0 = cz * CELL - 64, z1 = (cz + 1) * CELL + 64, out = new Set();
  for (const x of [x0, cx * CELL + 64, x1 - 1]) for (const z of [z0, cz * CELL + 64, z1 - 1]) out.add(`${Math.floor(x / 512)}_${Math.floor(z / 512)}`);
  return [...out].sort();
}
// (GB43: the scheduling here and the harness are left out, so a change to how cells are queued, claimed or spread over
// pages does not rebake the city; a change to what a page does to a cell bumps BAKER_VERSION)
const bakerFiles = ['tools/cells/glbWrite.mjs', 'client/src/cells/bakeLib.js', 'client/src/cells/cellRules.js'];
const bakerHash = sha(bakerFiles.map((f) => fs.readFileSync(path.join(ROOT, f))).join('\n') + BAKER_VERSION + JSON.stringify(OPTS));
const { client: tree, nyc: nycTree } = srcTree();
const assets = assetDigest();
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const inputsOf = (c) => ({ schema: 'valdrada.cell/0', cell: key(c), srcTree: tree, nycTree, assets: assets.digest, baker: bakerHash.slice(0, 16), tiles: Object.fromEntries(tilesOf(c).map((t) => [t, tileSha(t).slice(0, 16)])), opts: OPTS });
const hashOf = (c) => sha(JSON.stringify(inputsOf(c))).slice(0, 24);
const plan = cells.map((c) => ({ c, k: key(c), h: hashOf(c) }));
const todo = plan.filter((p) => has('force') || !fs.existsSync(path.join(CACHE, p.h, 'cell.glb')));
if (!cells.length) {   // nothing to bake: the region's index stays as it is (a load set whose cells are all baked lists none missing)
  log(`${name}: no cells${opt('loadset') ? ' (the load set lists none missing; --all bakes all of its cells)' : ''}; the index is left as it is`);
  process.exit(2);
}
log(`${name}: ${cells.length} cells, ${todo.length} to bake (client/src tree ${tree.slice(0, 12)}, src tree ${nycTree.slice(0, 12)}, assets ${assets.digest.slice(0, 8)} of ${assets.files} files, HEAD ${head.slice(0, 8)}, baker ${bakerHash.slice(0, 8)})`);

// ---------------------------------------------------------------- the region index
const MOVERS = new Set((() => { try { return JSON.parse(fs.readFileSync(path.join(CACHE, 'index', `${name}.json`), 'utf8')).movers || []; } catch { return []; } })());
let PREV_KEPT = false;
async function writeIndex() {
  await fsp.mkdir(path.join(CACHE, 'index'), { recursive: true });
  const reg = { schema: 'valdrada.cellindex/0', region: name, cellSize: CELL, generated: new Date().toISOString(), srcTree: tree, nycTree, assets: assets.digest, head, movers: [...MOVERS].sort(), cells: {} };
  for (const p of plan) {
    const dir = path.join(CACHE, p.h);
    if (!fs.existsSync(path.join(dir, 'cell.glb'))) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    reg.cells[p.k] = { hash: p.h, bytes: { glb: fs.statSync(path.join(dir, 'cell.glb')).size, sidecar: fs.statSync(path.join(dir, 'cell.json')).size },
      bounds: meta.bounds, tris: meta.stats.tris, instances: meta.stats.inst, draws: meta.stats.meshes + meta.stats.instances, tile: meta.tile };
  }
  const regFile = path.join(CACHE, 'index', `${name}.json`);
  if (!PREV_KEPT && fs.existsSync(regFile)) {   // the index this run replaces, kept once per run (index/prev/<region>-<time>.json)
    await fsp.mkdir(path.join(CACHE, 'index', 'prev'), { recursive: true });
    await fsp.copyFile(regFile, path.join(CACHE, 'index', 'prev', `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
  }
  PREV_KEPT = true;
  await fsp.writeFile(regFile, JSON.stringify(reg, null, 1));
  // index.json: every region's cells (the loader reads this one)
  const all = { schema: 'valdrada.cellindex/0', cellSize: CELL, generated: new Date().toISOString(), regions: {}, movers: [], cells: {} };
  for (const f of fs.readdirSync(path.join(CACHE, 'index')).filter((f) => f.endsWith('.json')).sort()) {
    const r = JSON.parse(fs.readFileSync(path.join(CACHE, 'index', f), 'utf8'));
    all.regions[r.region] = { cells: Object.keys(r.cells).length, generated: r.generated, srcTree: r.srcTree };
    Object.assign(all.cells, r.cells);
    for (const m of r.movers || []) if (!all.movers.includes(m)) all.movers.push(m);
  }
  const tmp = path.join(CACHE, `.index.${process.pid}.json`);
  await fsp.writeFile(tmp, JSON.stringify(all, null, 1));
  await fsp.rename(tmp, path.join(CACHE, 'index.json'));
  return reg;
}
// BIN and BBL of the sidecar's buildings: the footprint (client/data/raw/buildings_1.geojson, the Manhattan export) that
// holds the building's centroid, else the nearest footprint centroid within 8 m
const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const proj = (lon, lat) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
let FOOT = null;
function footprints(bbox) {
  if (FOOT) return FOOT;
  FOOT = [];
  const f = path.join(CLIENT, 'data/raw/buildings_1.geojson');
  if (!fs.existsSync(f)) return FOOT;
  const fc = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const ft of fc.features) {
    const g = ft.geometry; if (!g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    const [x0, z0] = proj(...polys[0][0][0]);
    if (x0 < bbox[0] - 300 || x0 > bbox[2] + 300 || z0 < bbox[1] - 300 || z0 > bbox[3] + 300) continue;
    const rings = polys.map((pl) => pl[0].map(([lo, la]) => proj(lo, la)));
    let cx = 0, cz = 0, n = 0; for (const r of rings) for (const [x, z] of r) { cx += x; cz += z; n++; }
    const p = ft.properties || {};
    FOOT.push({ rings, cx: cx / n, cz: cz / n, bin: p.bin != null ? String(p.bin) : null, bbl: p.base_bbl || p.mappluto_bbl || null });
  }
  return FOOT;
}
const inRing = (r, x, z) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
function joinBins(buildings, bbox) {
  const F = footprints(bbox);
  let hit = 0;
  for (const b of buildings) {
    let best = F.find((f) => Math.abs(f.cx - b.cx) < 200 && Math.abs(f.cz - b.cz) < 200 && f.rings.some((r) => inRing(r, b.cx, b.cz)));
    if (!best) { let bd = 64; for (const f of F) { const d = (f.cx - b.cx) ** 2 + (f.cz - b.cz) ** 2; if (d < bd) { bd = d; best = f; } } }
    b.bin = best ? best.bin : null; b.bbl = best ? best.bbl : null;
    if (best) hit++;
  }
  return hit;
}
if (has('sidecars')) {
  // the lamps of every listed cell that is in the cache, from one page that has assembled every tile they lie in
  const all = JSON.parse(fs.readFileSync(path.join(CACHE, 'index.json'), 'utf8')).cells;
  const want = cells.map(key).filter((k) => all[k]);
  log(`sidecars: ${want.length} of ${cells.length} cells are baked`);
  const T1 = Date.now();
  const { server, url } = await startVite();
  const browser = await startBrowser();
  const logs = [];
  let ok = 0;
  try {
    const page = await newPage(browser, 1600, 900, 'cells-sidecars ' + name, logs);
    const xs = cells.map((c) => (c[0] + 0.5) * CELL), zs = cells.map((c) => (c[1] + 0.5) * CELL);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    await page.goto(`${url}/?shot=1&rel=1&x=${((x0 + x1) / 2).toFixed(1)}&y=60&z=${((z0 + z1) / 2).toFixed(1)}&yaw=0&pitch=-0.6&time=${OPTS.time}&${OPTS.flags}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', undefined, { timeout: 3600000 });   // (SHIP-MN: the new Manhattan's tiles assemble in ~60 s each)
    await page.evaluate(async () => { window.__BAKE = await import('/src/cells/bakeLib.js'); if (window.__DRESS_HOLD) window.__DRESS_HOLD('grow'); });
    // every tile under the cells assembled: the camera over each quarter of the set in turn (the streamer holds them all)
    for (const [fx, fz] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75], [0.5, 0.5]]) {
      await page.evaluate(([x, z]) => { const S = window.__STREAMER, g = S.terrainAt(x, z); window.__TELEPORT(x, (Number.isFinite(g) ? g : 3) + 60, z, 0, -0.6); }, [x0 + (x1 - x0) * fx, z0 + (z1 - z0) * fz]);
      for (let i = 0; i < 240; i++) { await sleep(500); if (await page.evaluate(() => window.__STREAMER.idle())) break; }
    }
    const missing = await page.evaluate((ks) => ks.filter((k) => { const [cx, cz] = k.split('_').map(Number), t = window.__STREAMER.tiles.get(`${Math.floor((cx * 128) / 512)}_${Math.floor((cz * 128) / 512)}`); return !(t && t.state === 'ready'); }), want);
    if (missing.length) log(`tiles not assembled for ${missing.length} cells: ${missing.join(' ')}`);
    const heads = await page.evaluate(() => window.__BAKE.lampHeads());
    log(`lamp heads in the page: ${heads.length} (${Object.entries(heads.reduce((a, h) => ((a[h.kind] = (a[h.kind] || 0) + 1), a), {})).map(([k, v]) => k + ' ' + v).join(', ')})`);
    const plainOf = (k) => { for (const r of fs.readdirSync(path.join(CACHE, 'index')).filter((f) => f.endsWith('.json'))) { const j = JSON.parse(fs.readFileSync(path.join(CACHE, 'index', r), 'utf8')); if (j.cells && j.cells[k]) return path.join(CACHE, 'plain', r.slice(0, -5), `${k}.json`); } return null; };
    const stampS = new Date().toISOString().replace(/[:.]/g, '-');
    for (const k of want) {
      if (missing.includes(k)) continue;
      const dir = path.join(CACHE, all[k].hash), f = path.join(dir, 'cell.json');
      const sc = JSON.parse(await fsp.readFile(f, 'utf8'));
      const [ox, , oz] = sc.origin;
      sc.lights = heads.filter((h) => h.x >= ox && h.x < ox + CELL && h.z >= oz && h.z < oz + CELL);
      sc.lightsFrom = 'world/life.js lampSpots, one per 0.5 m as world/cityLamps.js (written again ' + new Date().toISOString() + ')';
      await fsp.rename(f, `${f}.prev-${stampS}`);   // never delete a cache file: moved aside
      await fsp.writeFile(f, JSON.stringify(sc));
      const mf = path.join(dir, 'meta.json'), meta = JSON.parse(await fsp.readFile(mf, 'utf8'));
      (meta.sidecarRewrites ||= []).push({ at: new Date().toISOString(), what: 'lights', lights: sc.lights.length });
      await fsp.writeFile(mf, JSON.stringify(meta, null, 1));
      const pf = plainOf(k);
      if (pf && fs.existsSync(pf)) { await fsp.rename(pf, `${pf}.prev-${stampS}`); await fsp.copyFile(f, pf); }
      ok++;
    }
    log(`sidecars written again: ${ok} cells in ${((Date.now() - T1) / 1000).toFixed(0)} s`);
  } catch (e) { console.error('[sidecars] failed:', e?.stack || e); process.exitCode = 1; }
  finally { await browser.close().catch(() => {}); server.kill(); }
  process.exit(process.exitCode || 0);
}
if (!todo.length) { const r = await writeIndex(); log(`all cached; index ${Object.keys(r.cells).length} cells -> ${path.join(CACHE, 'index', name + '.json')}`); process.exit(0); }

// ---------------------------------------------------------------- claims (GB43): a cell another bake is making is waited for,
// not made a second time (the trailer's workers baked the same new cells side by side). A claim is claims/<hash> holding
// the baker's pid; a claim whose process is gone is taken over.
const CLAIMS = path.join(CACHE, 'claims');
fs.mkdirSync(CLAIMS, { recursive: true });
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const claimant = (p) => { try { return Number(fs.readFileSync(path.join(CLAIMS, p.h), 'utf8')) || 0; } catch { return 0; } };
const claim = (p) => {
  const f = path.join(CLAIMS, p.h);
  try { fs.writeFileSync(f, String(process.pid), { flag: 'wx' }); return true; } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const pid = claimant(p);
  if (pid && pid !== process.pid && alive(pid)) return false;
  fs.writeFileSync(f, String(process.pid));
  return true;
};
const unclaim = (p) => { if (claimant(p) === process.pid) fs.rmSync(path.join(CLAIMS, p.h), { force: true }); };
process.on('exit', () => { for (const p of todo) unclaim(p); });
const mine = todo.filter(claim);
let theirs = todo.filter((p) => !mine.includes(p));
if (theirs.length) log(`${theirs.length} cells are being baked by another run: waited for, not baked again`);

// ---------------------------------------------------------------- the sink: each page POSTs its cells' manifests and buffers
// into its own folder (<run>/<page>/: the texture files are numbered per page)
const run = `${name}-${Date.now().toString(36)}`;
const runRoot = path.join('/data0/projectnyc_aux/tmp/cells', run);
await fsp.mkdir(runRoot, { recursive: true });
const sink = http.createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Private-Network': 'true' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); res.end(); return; }
  const m = /^\/put\/([A-Za-z0-9_.\-]+)\/([A-Za-z0-9_.\-]+)$/.exec(decodeURIComponent(req.url || ''));
  if (req.method !== 'POST' || !m) { res.writeHead(400, cors); res.end('bad'); return; }
  fs.mkdirSync(path.join(runRoot, m[1]), { recursive: true });
  const out = fs.createWriteStream(path.join(runRoot, m[1], m[2]));
  req.pipe(out);
  out.on('finish', () => { res.writeHead(200, cors); res.end('ok'); });
});
await new Promise((r) => sink.listen(0, '127.0.0.1', r));
const SINK = `http://127.0.0.1:${sink.address().port}`;

// ---------------------------------------------------------------- the pages (GB43): --pages browsers, each its own GPU
// process and renderer, take batches from one queue; one page dressed 483 cells in 1,411 s with the machine idle
const T0 = Date.now();
const { server, url } = await startVite();
const logs = [];
let code = 0;
const BATCH = Math.max(1, Number(opt('batch', '16')));
const PAGES = Math.max(1, Number(opt('pages', process.env.BAKE_PAGES || '4')));
const centre = (L) => { const xs = L.map((p) => (p.c[0] + 0.5) * CELL), zs = L.map((p) => (p.c[1] + 0.5) * CELL); return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2]; };
let indexChain = Promise.resolve(null);
const indexNow = () => (indexChain = indexChain.catch(() => null).then(() => writeIndex()));   // (one write at a time)
let nPage = 0;

const RECYCLE = Number(opt('recycle', '20'));   // (batches a page bakes before its browser is started afresh)
async function bakePage(queue, total) {
  const pi = nPage++, runI = `p${pi}`, runDir = path.join(runRoot, runI), plog = (...a) => log(`p${pi}`, ...a);
  await fsp.mkdir(runDir, { recursive: true });
  if (!queue.length) return;
  const browser = await startBrowser();
  try {
    const page = await newPage(browser, 1600, 900, `cells-bake ${name} p${pi}`, logs);
    const [cx, cz] = centre(queue[0]);
    const q = `shot=1&rel=1&x=${cx.toFixed(1)}&y=60&z=${cz.toFixed(1)}&yaw=0&pitch=-0.6&time=${OPTS.time}&${OPTS.flags}`;
    plog('boot', `${url}/?${q}`);
    const tBoot = Date.now();
    await page.goto(`${url}/?${q}`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForFunction('window.__READY === true', undefined, { timeout: 3600000 });   // (SHIP-MN: the new Manhattan's tiles assemble in ~60 s each)
    plog(`READY after ${((Date.now() - tBoot) / 1000).toFixed(1)} s`, JSON.stringify(await page.evaluate(() => window.__BOOT)));
    await page.evaluate(async () => { window.__BAKE = await import('/src/cells/bakeLib.js'); });
    const teleport = (x, z, h, pitch) => page.evaluate(([x, z, h, pitch]) => { const S = window.__STREAMER, g = S.terrainAt(x, z); window.__TELEPORT(x, (Number.isFinite(g) ? g : 3) + h, z, 0, pitch); }, [x, z, h, pitch]);
    // ---- the textures: read back in the page, PNG here (several at a time), by content into cellcache/tex/<hash>.png
    await fsp.mkdir(path.join(CACHE, 'tex'), { recursive: true });
    const texFile = new Map(), texInfo = new Map(), converted = new Set();
    const texOut = (id) => {   // a texture reference in a material: its image(s) in the cache, size, colour space, alpha
      const t = texInfo.get(id);
      if (!t || t.err) return { tex: id, file: null, err: t ? t.err : 'not read' };
      const files = []; for (let L = 0; L < (t.layers || 1); L++) files.push(texFile.get(`${id}_${L}`) || null);
      return { file: files[0], ...(files.length > 1 ? { layers: files } : {}), w: t.w, h: t.h, colorSpace: t.colorSpace, opaque: t.opaque, wrap: [t.wrapS, t.wrapT], ...(t.capped ? { capped: true } : {}), ...(t.blank ? { blank: true } : {}) };
    };
    const remapTex = (md) => {
      for (const d of Object.values(md.textures || {})) if (d && Number.isInteger(d.tex)) Object.assign(d, texOut(d.tex));
      for (const U of [md.uni, md.obcUni]) if (U) for (const [k, v] of Object.entries(U)) if (v && Number.isInteger(v.tex)) U[k] = { ...v, ...texOut(v.tex) };
    };
    let movers = null;
    for (let batch = queue.shift(), nb = 0; batch; batch = ++nb < RECYCLE ? queue.shift() : null) {
      const tB = Date.now();
      plog(`batch of ${batch.length} (${total - queue.length}/${total}): ${batch.map((p) => p.k).join(' ')}${pathDist ? ` (${Math.round(pathDist(batch[0].c))}..${Math.round(pathDist(batch[batch.length - 1].c))} m from the camera path)` : ''}`);
      const [bx, bz] = centre(batch);
      plog('prepare', JSON.stringify(await page.evaluate((a) => window.__BAKE.prepare(a), { cells: batch.map((p) => p.c), step: batch.length > 16 ? 10 : 6 })));
      // a tour of the cells, so whatever builds its near forms only on approach has built them (the FP37 path holds them)
      for (const p of batch) { await teleport((p.c[0] + 0.5) * CELL, (p.c[1] + 0.5) * CELL, 30, -1.2); await sleep(700); }
      await teleport(bx, bz, 60, -0.6);
      plog('dress', JSON.stringify(await page.evaluate(() => window.__BAKE.dressRegion())));
      let st = null;
      for (let i = 0; i < 7200; i++) {   // (SHIP-MN: up to an hour, the new Manhattan's tiles)
        st = await page.evaluate(() => window.__BAKE.status());
        if (st.queue === 0 && st.idle) break;
        if (i % 20 === 0) plog('settle', JSON.stringify(st));
        await sleep(500);
      }
      await sleep(2500);   // the last builds into the scene, the LOD holds
      plog('settled', JSON.stringify(st));
      if (!movers) { movers = await page.evaluate(() => window.__BAKE.detectMovers(1500)); plog('movers', JSON.stringify(movers)); for (const m of movers) MOVERS.add(m); }
      const tExp = Date.now();
      const res = await page.evaluate((a) => window.__BAKE.exportAll(a), { sink: SINK, run: runI, movers, signCells: OPTS.signcells });
      plog(`export ${((Date.now() - tExp) / 1000).toFixed(1)} s`, JSON.stringify(res.ms), 'skipped', JSON.stringify(res.skipped), res.signs ? 'street names per cell ' + JSON.stringify(res.signs) : '');
      const tTex = Date.now();
      const texRes = await page.evaluate((a) => window.__BAKE.readTextures(a), { sink: SINK, run: runI, maxDim: OPTS.maxtex });
      for (const t of texRes.textures) texInfo.set(t.id, t);
      const files = fs.readdirSync(runDir).filter((f) => /^tex_\d+_\d+__\d+x\d+\.rgba$/.test(f) && !converted.has(f));
      let texNew = 0, next = 0;
      await Promise.all(Array.from({ length: 8 }, async () => {
        while (next < files.length) {
          const f = files[next++], m = /^tex_(\d+)_(\d+)__(\d+)x(\d+)\.rgba$/.exec(f), info = texInfo.get(+m[1]);
          let img = sharp(await fsp.readFile(path.join(runDir, f)), { raw: { width: +m[3], height: +m[4], channels: 4 } });
          if (info && info.opaque) img = img.removeAlpha();
          const png = await img.png({ compressionLevel: 6 }).toBuffer();
          const rel = `tex/${crypto.createHash('sha256').update(png).digest('hex').slice(0, 24)}.png`, abs = path.join(CACHE, rel);
          if (!fs.existsSync(abs)) {   // a temp name of this source file's own (two slots can hold one image: the same target)
            const tmp = `${abs}.${process.pid}.${runI}.${f}.tmp`;
            await fsp.writeFile(tmp, png);
            try { await fsp.rename(tmp, abs); texNew++; } catch (e) { if (!fs.existsSync(abs)) throw e; await fsp.rm(tmp, { force: true }); }
          }
          texFile.set(`${m[1]}_${m[2]}`, rel);
          converted.add(f);
        }
      }));
      const empt = texRes.textures.filter((t) => t.blank || t.err);
      if (empt.length) plog(`textures empty or unread: ${empt.map((t) => `${t.id}:${t.name || '-'}:${t.w}x${t.h}${t.compressed ? ':ktx' : ''}${t.array ? ':array' : ''}${t.err ? ':' + t.err : ''}`).join(' ')}`);
      plog(`textures: ${texRes.textures.length} new read back (${(texRes.bytes / 1e6).toFixed(0)} MB raw, ${texRes.cpu} read from their sources, ${texRes.retried} GPU reads tried again, ${texRes.blank} empty), ${files.length} images, ${texNew} new in cellcache/tex, ${((Date.now() - tTex) / 1000).toFixed(1)} s`);
      // ---- the packages
      for (const p of batch) {
        const man = JSON.parse(await fsp.readFile(path.join(runDir, p.k + '.json'), 'utf8'));
        for (const md of man.materials) remapTex(md);
        const bin = new Uint8Array(await fsp.readFile(path.join(runDir, p.k + '.bin')));
        const t0 = Date.now();
        const glb = await writeCellGLB(man, bin, { meshopt: OPTS.meshopt, protoDir: path.join(CACHE, 'protos'), texDir: path.join(CACHE, 'tex') });   // prototypes once, by content
        const st2 = res.cells.find((c) => c.cell === p.k) || {};
        const [ox, , oz] = man.origin;
        let y0 = Infinity, y1 = -Infinity;
        for (const ms of man.meshes) { const a = ms.attrs.find((d) => d.name === 'position'); if (!a) continue; const P = new Float32Array(bin.buffer.slice(bin.byteOffset + a.offset, bin.byteOffset + a.offset + a.bytes)); for (let i = 1; i < P.length; i += 3) { if (P[i] < y0) y0 = P[i]; if (P[i] > y1) y1 = P[i]; } }
        const bins = joinBins(man.sidecar.buildings || [], [Math.min(...todo.map((q) => q.c[0])) * CELL, Math.min(...todo.map((q) => q.c[1])) * CELL, (Math.max(...todo.map((q) => q.c[0])) + 1) * CELL, (Math.max(...todo.map((q) => q.c[1])) + 1) * CELL]);   // the footprints of the whole run (read once)
        const sidecar = { schema: 'valdrada.cellsidecar/0', cell: p.k, hash: p.h, origin: man.origin, size: CELL, bounds: [ox, Number.isFinite(y0) ? +y0.toFixed(2) : 0, oz, ox + CELL, Number.isFinite(y1) ? +y1.toFixed(2) : 0, oz + CELL],
          tile: `${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`, classes: 'docs/specs/cell-package.md#classes', ...man.sidecar,
          materials: man.materials.map((m) => ({ key: m.key, type: m.type, name: m.name, pbr: m.userData && m.userData.pbr ? m.userData.pbr : null, textures: m.textures })) };
        const meta = { cell: p.k, hash: p.h, inputs: inputsOf(p.c), head, bounds: sidecar.bounds, tile: sidecar.tile, made: new Date().toISOString(), run: `${run}/${runI}`,
          stats: { bins, tris: st2.tris || 0, inst: st2.inst || 0, meshes: man.meshes.length, instances: man.instances.length, materials: man.materials.length, rawBytes: man.bytes, glbBytes: glb.byteLength, writeMs: Date.now() - t0, buildings: sidecar.buildings.length } };
        const tmp = path.join(CACHE, `.tmp-${p.h}-${process.pid}`), dir = path.join(CACHE, p.h);
        await fsp.mkdir(tmp, { recursive: true });
        await fsp.writeFile(path.join(tmp, 'cell.glb'), glb);
        await fsp.writeFile(path.join(tmp, 'cell.json'), JSON.stringify(sidecar));
        await fsp.writeFile(path.join(tmp, 'meta.json'), JSON.stringify(meta, null, 1));
        if (fs.existsSync(dir)) await fsp.rename(dir, `${dir}.old-${Date.now().toString(36)}`);   // never delete a cache entry: move it aside
        await fsp.rename(tmp, dir);
        unclaim(p);
        plog(`${p.k} -> ${p.h}: ${meta.stats.meshes} meshes, ${meta.stats.instances} instanced sets (${meta.stats.inst} inst), ${(meta.stats.tris / 1e3).toFixed(0)}k tris, ${meta.stats.buildings} bldgs, raw ${(man.bytes / 1e6).toFixed(1)} MB -> glb ${(glb.byteLength / 1e6).toFixed(1)} MB (${meta.stats.writeMs} ms)`);
      }
      const reg = await indexNow();   // after every batch: what is baked is usable at once
      plog(`batch done in ${((Date.now() - tB) / 1000).toFixed(0)} s; index ${Object.keys(reg.cells).length} cells`);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

const bakeAll = async (cellsToBake) => {   // the batches in order, PAGES pages taking them as they free
  const queue = [];
  for (let b0 = 0; b0 < cellsToBake.length; b0 += BATCH) queue.push(cellsToBake.slice(b0, b0 + BATCH));
  const n = Math.min(PAGES, queue.length), total = queue.length;
  if (!n) return;
  log(`${cellsToBake.length} cells in ${total} batches over ${n} pages`);
  // (each page's browser started afresh every RECYCLE batches, GB43 2026-10-14: a page that had baked for two hours held
  // 747 tiles and 10,441 buildings and stopped answering for ten minutes, and the guard ended the run)
  // (SHIP-MN --chunked: each page its own contiguous run of the batches, so a page walks on to the next tile with most of
  // its neighbours assembled)
  const own = has('chunked') ? Array.from({ length: n }, (_, i) => queue.slice(Math.floor((i * total) / n), Math.floor(((i + 1) * total) / n))) : null;
  if (own) queue.length = 0;
  const r = await Promise.allSettled(Array.from({ length: n }, (_, i) => sleep(i * 4000).then(async () => { if (own) while (own[i].length) await bakePage(own[i], total); while (queue.length) await bakePage(queue, total); })));
  for (const x of r) if (x.status === 'rejected') { code = 1; console.error('[bake] a page failed:', x.reason?.stack || x.reason); }
};
try {
  await bakeAll(mine);
  // the cells another run claimed: theirs once their packages are written; a claim left without one (its baker gone, or
  // still unwritten after 90 min) is baked here
  const tWait = Date.now();
  while (theirs.length) {
    theirs = theirs.filter((p) => !fs.existsSync(path.join(CACHE, p.h, 'cell.glb')));
    const orphans = theirs.filter((p) => { const pid = claimant(p); return !pid || !alive(pid) || Date.now() - tWait > 90 * 60e3; });
    const got = orphans.filter((p) => { if (Date.now() - tWait > 90 * 60e3) { fs.writeFileSync(path.join(CLAIMS, p.h), String(process.pid)); return true; } return claim(p); });
    if (got.length) { log(`${got.length} claimed cells left unbaked by their run: baked here`); theirs = theirs.filter((p) => !got.includes(p)); await bakeAll(got); }
    if (theirs.length) await sleep(5000);
  }
  if (Date.now() - tWait > 10e3) log(`waited ${((Date.now() - tWait) / 1000).toFixed(0)} s for the cells another run baked`);
  await indexNow();
  log(`done in ${((Date.now() - T0) / 1000).toFixed(0)} s; ${todo.length} cells -> ${path.join(CACHE, 'index', name + '.json')}`);
} catch (e) {
  code = 1;
  console.error('[bake] failed:', e?.stack || e);
} finally {
  await fsp.writeFile(path.join(runRoot, 'page.log'), logs.join('\n')).catch(() => {});
  const errs = logs.filter((l) => /PAGEERROR|\[pageerr\]|\[pagerej\]/.test(l));
  if (errs.length) console.log(`[bake] ${errs.length} page errors, first:`, errs.slice(0, 3).join('\n'));
  server.kill();
  sink.close();
}
process.exit(code);
