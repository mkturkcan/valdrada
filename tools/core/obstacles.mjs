// The walkers' street-furniture obstacles as data, written by today's page (the generator that places the furniture),
// read by the core: a prototype of the cell sidecar's declared `colliders` (docs/specs/cell-package.md). For every
// instancer pool the walker model avoids (sim/peds.js OBS_POOL: tree trunks, poles, hydrants, benches, racks, stoops,
// stair walls, the work-zone kit ...) it writes the pool's footprint boxes (the boxes peds.js derives from the pool's
// geometry below head height) and every live instance's matrix, one file per 512 m tile. The page runs headless on
// SwiftShader with its picture held, at a shot's first key, with the take's path pre-streamed (as the recorder does).
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/obstacles.mjs --shot tuApolloSweep [--out /data0/projectnyc_aux/cache/core/obstacles]
// The core's streamer reads <out>/foot.json and <out>/t_<tile>.json when it loads that tile (core/world/streamer.mjs).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickPort } from '../cells/harness.mjs';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotName = opt('shot', 'tuApolloSweep');
const out = path.resolve(opt('out', '/data0/projectnyc_aux/cache/core/obstacles'));   // shared by every checkout (tools/core/take.mjs)
fs.mkdirSync(out, { recursive: true });
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const P = { name: shotName, ...(SH.shots[shotName] || SH.probes[shotName]) };
if (P.take) { const { expandTake } = await import('../ad/takes.mjs'); expandTake(P, ROOT); }
const BASE_FLAGS = SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1';
const { project } = await import('../../client/src/shared/geo.js');
const [sx, sz] = project(P.keys[0].p[0], P.keys[0].p[1]);
const holdAt = (Q, K) => ({ duration: 1e6, ease: 0, abs: Q.abs, tension: Q.tension, fov: Q.fov, keys: [K, { p: [K.p[0] + 1e-6, K.p[1] + 1e-6, K.p[2]], look: K.look }] });
const midKey = (a, b) => ({ p: a.p.map((v, i) => (v + b.p[i]) / 2), look: (a.look || a.p).map((v, i) => (v + (b.look || b.p)[i]) / 2) });
const query = `?shot=1&record=1&${BASE_FLAGS}&time=${P.time}${P.flags ? '&' + P.flags : ''}&x=${sx.toFixed(1)}&z=${sz.toFixed(1)}&y=${(P.keys[0].p[2] + 40).toFixed(1)}&pc26=0`;

const port = await pickPort();   // (free, and outside Chrome's restricted ports: tools/cells/harness.mjs)
const bdir = path.join(ROOT, 'client');
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await sleep(4000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--window-size=640,360'] });
const cleanup = async () => { try { await browser.close(); } catch {} try { vite.kill('SIGTERM'); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.addInitScript(() => { setInterval(() => { const E = window.__ENGINE; if (E && !E.holdDraw) E.holdDraw = true; }, 20); });
  await page.goto(`http://127.0.0.1:${port}/${query}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('typeof window.__SET_PATH === "function" && !!window.__gtRefs && !!window.__gtRefs.peds', null, { timeout: 2400000, polling: 3000 });
  const settle = async () => { for (;;) { const ok = await page.evaluate(() => { const S = window.__STREAMER; return S.outstanding === 0 && S.queue.length === 0 && S.fetching === 0; }); if (ok) return; await sleep(1000); } };
  // the path pre-streamed, the streamer growing (record.mjs FP26), so every tile the take touches is in
  await page.evaluate(() => window.__DRESS_HOLD?.('grow'));
  const pts = [P.keys[0]];
  for (let k = 1; k < P.keys.length; k++) pts.push(midKey(P.keys[k - 1], P.keys[k]), P.keys[k]);
  for (const K of pts) { await page.evaluate((p) => window.__SET_PATH(p), holdAt(P, K)); await page.evaluate(() => window.__advance(0)); await settle(); }
  for (let i = 0; i < 30; i++) await page.evaluate(() => window.__advance(0));   // late claims (models that load after the tile)
  const D = await page.evaluate(() => {
    const T = window.__gtRefs.traffic, Pd = window.__gtRefs.peds, I = Pd.streamer.ctx.instancer, S = window.__STREAMER;
    // the pools the walker model avoids: its own test, read back by building its obstacle list once at every loaded tile's
    // centre (peds._obsFoot then holds each pool's footprint boxes, keyed by the pool's geometry)
    const tiles = [...S.tiles.keys()];
    for (const k of tiles) { const [tx, tz] = k.split('_').map(Number); Pd._obsBuild(tx * 512 + 256, tz * 512 + 256); }
    const foot = {}, inst = {};
    for (const [name, pool] of I.pools) {
      const F = Pd._obsFoot && Pd._obsFoot.get(pool.geo);
      if (!F || !pool.top || !pool.alive || !pool.mats) continue;
      foot[name] = F.map((b) => [b.x0, b.x1, b.z0, b.z1, b.y0, b.y1].map((v) => Math.round(v * 1000) / 1000));
      const m = pool.mats;
      for (let s = 0; s < pool.top; s++) {
        if (!pool.alive[s]) continue;
        const o = s * 16, key = `${Math.floor(m[o + 12] / 512)}_${Math.floor(m[o + 14] / 512)}`;
        ((inst[key] || (inst[key] = {}))[name] || (inst[key][name] = [])).push(Array.from(m.subarray(o, o + 16), (v) => Math.round(v * 10000) / 10000));
      }
    }
    return { foot, inst, tiles };
  });
  // one footprint file per run (runs in parallel never write the same file; the core merges foot*.json)
  fs.writeFileSync(path.join(out, `foot_${shotName}.json`), JSON.stringify(D.foot));
  let n = 0;
  for (const [key, pools] of Object.entries(D.inst)) {
    if (!D.tiles.includes(key)) continue;   // an instance whose position falls in a tile the page did not load
    fs.writeFileSync(path.join(out, `t_${key}.json`), JSON.stringify({ tile: key, shot: shotName, pools }));
    for (const L of Object.values(pools)) n += L.length;
  }
  console.log(`[obstacles] ${Object.keys(D.foot).length} pools with footprints, ${n} instances in ${Object.keys(D.inst).filter((k) => D.tiles.includes(k)).length} tiles in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${path.relative(ROOT, out)}`);
} catch (e) {
  console.log('FAILED', e.stack || e);
} finally {
  await cleanup();
}
