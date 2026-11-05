// The core's laid-tile cache for a release (core/world/simTile.mjs TILE CACHE): every compiled tile holding a cell the city
// was baked on the terrain profile (config/far/lift_cells.json) laid on the measured ground with the highways, its answers
// written to <out>/<key>.v8z, in parallel processes. The Unreal client's core reads them (VALDRADA_TILE_CACHE) instead of
// laying each tile again (15 to 45 s a tile).
//   TERRAIN_P1=1 HHP_P2=1 TERRAIN_P1_CELLS=config/far/lift_cells.json node tools/core/tile_cache.mjs <out> [--jobs 24] [--tiles a,b]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const out = path.resolve(process.argv[2]);
const TD = process.env.VALDRADA_TILES || path.join(ROOT, 'client', 'public', 'tiles');
const MAN = JSON.parse(fs.readFileSync(path.join(TD, 'manifest.json'), 'utf8'));

if (process.env.TILE_CACHE_WORKER) {
  await import(path.join(ROOT, 'core', 'env', 'shim.mjs'));
  const { simTile } = await import(path.join(ROOT, 'core', 'world', 'simTile.mjs'));
  for (const key of JSON.parse(process.env.TILE_CACHE_WORKER)) {
    const t0 = performance.now();
    try {
      const nb = fs.readFileSync(path.join(TD, MAN.tiles[key].f));
      await simTile(key, nb.buffer.slice(nb.byteOffset, nb.byteOffset + nb.byteLength));
      process.send({ key, ms: Math.round(performance.now() - t0), ok: fs.existsSync(path.join(out, key + '.v8z')) });
    } catch (e) { process.send({ key, error: String(e && e.message || e) }); }
  }
  process.exit(0);
}

if (!process.env.TERRAIN_P1 || !process.env.TERRAIN_P1_CELLS) { console.error('tile_cache: set TERRAIN_P1=1, HHP_P2=1 and TERRAIN_P1_CELLS'); process.exit(2); }
let tiles;
if (arg('tiles')) tiles = arg('tiles').split(',');
else {
  const cells = JSON.parse(fs.readFileSync(process.env.TERRAIN_P1_CELLS, 'utf8'));
  tiles = [...new Set(cells.map((k) => { const [cx, cz] = k.split('_').map(Number); return `${Math.floor(cx / 4)}_${Math.floor(cz / 4)}`; }))];
}
tiles = tiles.filter((k) => MAN.tiles[k]).sort();
fs.mkdirSync(out, { recursive: true });
const jobs = Math.max(1, Math.min(Number(arg('jobs', Math.max(1, Math.floor(os.cpus().length / 4)))), tiles.length));
const t0 = Date.now();
let done = 0, failed = [];
const parts = Array.from({ length: jobs }, (_, j) => tiles.filter((_, i) => i % jobs === j));
await Promise.all(parts.map((list) => new Promise((res) => {
  const w = fork(fileURLToPath(import.meta.url), [out], { env: { ...process.env, TILE_CACHE_WORKER: JSON.stringify(list), VALDRADA_TILE_CACHE: out, VALDRADA_TILE_CACHE_WRITE: '1' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  w.on('message', (m) => { done++; if (m.error || !m.ok) failed.push(m.key); if (done % 25 === 0 || done === tiles.length) console.log(`[tile cache] ${done}/${tiles.length} in ${Math.round((Date.now() - t0) / 1000)} s`); });
  w.on('exit', () => res());
})));
const bytes = fs.readdirSync(out).filter((f) => f.endsWith('.v8z')).reduce((s, f) => s + fs.statSync(path.join(out, f)).size, 0);
fs.writeFileSync(path.join(out, 'cache.json'), JSON.stringify({ tiles: tiles.length, failed, bytes, seconds: Math.round((Date.now() - t0) / 1000), flags: { TERRAIN_P1: process.env.TERRAIN_P1, HHP_P2: process.env.HHP_P2 || '' } }, null, 1));
console.log(`[tile cache] ${tiles.length - failed.length} of ${tiles.length} tiles, ${(bytes / 1e6).toFixed(0)} MB, ${Math.round((Date.now() - t0) / 1000)} s; failed: ${failed.join(',') || 'none'}`);
process.exit(failed.length ? 1 : 0);
