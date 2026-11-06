// Parity of the core's tile sim view with the page's assembled tiles: the same points asked of both (surfaceInfoAt kind
// and height, roadAt, surfaceAt, terrainAt) and the graphs compared (traffic edges, signals, walk edges, parked records),
// at a shot's first key. The page runs headless on SwiftShader with its picture held (as tools/core/page_take.mjs).
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/parity.mjs --shot tuApolloSweep [--points 4000]
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickPort } from '../cells/harness.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shotName = opt('shot', 'tuApolloSweep');
const NPTS = parseInt(opt('points', '4000'), 10);
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const P = { name: shotName, ...(SH.shots[shotName] || SH.probes[shotName]) };
const BASE_FLAGS = SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1';
const query = `?shot=1&record=1&${BASE_FLAGS}&time=${P.time}${P.flags ? '&' + P.flags : ''}`;

// ---- the core's side
globalThis.location = { search: query };
const { createWorld } = await import('../../core/sim/world.mjs');
const { holdOf } = await import('../../core/sim/pathcam.mjs');
const { project } = await import('../../client/src/shared/geo.js');
const W = await createWorld({ seed: 1 });
W.setPath(holdOf(P));
await W.step(0);
for (let i = 0; i < 60; i++) await W.step(0);   // the walk graph's queued lines (campus, promenades) resolve over updates
const [sx, sz] = project(P.keys[0].p[0], P.keys[0].p[1]);
// points: seeded uniform in the ring's tiles within 600 m of the lens, plus every 2 m along 40 random road centrelines
let s = 12345;
const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
const pts = [];
while (pts.length < NPTS) { const x = sx + (rnd() * 2 - 1) * 600, z = sz + (rnd() * 2 - 1) * 600; if (W.streamer.surfaceInfoAt(x, z, 0.4) !== null || W.streamer.terrainAt(x, z) !== null) pts.push([x, z]); }
const ask = (S, [x, z]) => { const q = S.surfaceInfoAt(x, z, 0.4); const y = S.surfaceAt(x, z); const t = S.terrainAt(x, z); return [q ? q.kind : null, q ? Math.round(q.y * 1000) : null, S.roadAt(x, z, 0.25), y === null ? null : Math.round(y * 1000), t === null ? null : Math.round(t * 1000)]; };
const core = pts.map((p) => ask(W.streamer, p));
const fleetOf = (T) => Object.fromEntries(Object.keys(T.pools).map((k) => [k, { bb: T._lf39BB(k).map((v) => +v.toFixed(3)), half: T.carHalf({ kind: k }).map((v) => +v.toFixed(3)), dims: T.vehDims && T.vehDims[k] }]));
const fleetCore = fleetOf(W.traffic);
const graphCore = { edges: W.traffic.edges.size, signals: W.traffic.signals.size, walkEdges: W.peds.walkEdges.length, parked: [...W.traffic.parkedRecs.values()].reduce((a, r) => a + r.length, 0), tiles: W.streamer.tiles.size,
  edgeLen: Math.round([...W.traffic.edges.values()].reduce((a, e) => a + e.len, 0)), walkLen: Math.round(W.peds.walkEdges.reduce((a, e) => a + e.len, 0)) };
console.log('core', JSON.stringify(graphCore));

// ---- the page's side
const { chromium } = await import('playwright');
const port = await pickPort();   // (free, and outside Chrome's restricted ports: tools/cells/harness.mjs)
const bdir = path.join(ROOT, 'client');
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
await sleep(4000);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--window-size=640,360'] });
const cleanup = async () => { try { await browser.close(); } catch {} try { vite.kill('SIGTERM'); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });
try {
  const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
  await page.addInitScript(() => { setInterval(() => { const E = window.__ENGINE; if (E && !E.holdDraw) E.holdDraw = true; }, 20); });
  await page.goto(`http://127.0.0.1:${port}/${query}&x=${sx.toFixed(1)}&z=${sz.toFixed(1)}&y=${(P.keys[0].p[2] + 40).toFixed(1)}&pc26=0`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  await page.waitForFunction('typeof window.__SET_PATH === "function" && !!window.__gtRefs', null, { timeout: 2400000, polling: 3000 });
  await page.evaluate((p) => window.__SET_PATH(p), holdOf(P));
  for (;;) {
    const st = await page.evaluate(() => { const S = window.__STREAMER; return S.readyUnder() && S.outstanding === 0 && S.queue.length === 0 && S.fetching === 0; });
    if (st) break;
    await sleep(2000);
  }
  for (let i = 0; i < 60; i++) await page.evaluate(() => window.__advance(0));
  const res = await page.evaluate((pts) => {
    const S = window.__STREAMER, T = window.__gtRefs.traffic, Pd = window.__gtRefs.peds;
    const ask = ([x, z]) => { const q = S.surfaceInfoAt(x, z, 0.4); const y = S.surfaceAt(x, z); const t = S.terrainAt(x, z); return [q ? q.kind : null, q ? Math.round(q.y * 1000) : null, S.roadAt(x, z, 0.25), y === null ? null : Math.round(y * 1000), t === null ? null : Math.round(t * 1000)]; };
    const fleetOf = (T) => Object.fromEntries(Object.keys(T.pools).map((k) => [k, { bb: T._lf39BB(k).map((v) => +v.toFixed(3)), half: T.carHalf({ kind: k }).map((v) => +v.toFixed(3)), dims: T.vehDims && T.vehDims[k] }]));
    return { fleet: fleetOf(T), a: pts.map(ask), graph: { edges: T.edges.size, signals: T.signals.size, walkEdges: Pd.walkEdges.length, parked: [...T.parkedRecs.values()].reduce((a, r) => a + r.length, 0), tiles: S.tiles.size,
      edgeLen: Math.round([...T.edges.values()].reduce((a, e) => a + e.len, 0)), walkLen: Math.round(Pd.walkEdges.reduce((a, e) => a + e.len, 0)) } };
  }, pts);
  console.log('page', JSON.stringify(res.graph));
  const n = pts.length, eq = [0, 0, 0, 0, 0], diffs = [];
  for (let i = 0; i < n; i++) {
    const c = core[i], p = res.a[i];
    for (let k = 0; k < 5; k++) if (c[k] === p[k] || (k !== 0 && k !== 2 && c[k] !== null && p[k] !== null && Math.abs(c[k] - p[k]) <= 2)) eq[k]++;
    if (c[0] !== p[0] || c[2] !== p[2]) diffs.push({ x: +pts[i][0].toFixed(1), z: +pts[i][1].toFixed(1), core: c, page: p });
  }
  // the fleet: each kind's plan box (LOD0 bounds, traffic.js _lf39BB), its carHalf and its size as the model reads them
  const fleetDiff = [];
  for (const [k, c] of Object.entries(fleetCore)) {
    const p = res.fleet[k];
    if (!p) { fleetDiff.push(`${k}: not in the page`); continue; }
    const dmax = Math.max(...c.bb.map((v, i) => Math.abs(v - p.bb[i])), ...c.half.map((v, i) => Math.abs(v - p.half[i])), ...(c.dims || []).map((v, i) => Math.abs(v - (p.dims || [])[i])));
    if (dmax > 0.005) fleetDiff.push(`${k}: core bb ${c.bb} half ${c.half} dims ${c.dims} | page bb ${p.bb} half ${p.half} dims ${p.dims}`);
  }
  for (const k of Object.keys(res.fleet)) if (!fleetCore[k]) fleetDiff.push(`${k}: not in the core`);
  console.log(`fleet: ${Object.keys(fleetCore).length} kinds, ${fleetDiff.length} differ by more than 5 mm`);
  for (const d of fleetDiff) console.log('  ', d);
  const out = { shot: shotName, fleetDiff, points: n, agree: { kind: eq[0] / n, kindY: eq[1] / n, roadAt: eq[2] / n, surfaceAt: eq[3] / n, terrainAt: eq[4] / n }, core: graphCore, page: res.graph, diffs: diffs.slice(0, 40) };
  fs.mkdirSync(path.join(ROOT, 'shots/core'), { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'shots/core', `${shotName}_parity.json`), JSON.stringify(out, null, 1));
  console.log(JSON.stringify({ points: n, agree: out.agree, differing: diffs.length }, null, 1));
  for (const d of diffs.slice(0, 8)) console.log(' ', JSON.stringify(d));
} catch (e) {
  console.log('FAILED', e.stack || e);
} finally {
  await cleanup();
}
