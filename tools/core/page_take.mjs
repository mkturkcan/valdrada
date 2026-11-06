// The page's own simulation for a shot, on the CPU (headless Chromium, SwiftShader, nothing drawn), measured exactly as
// the core measures its take (core/tracks/stats.mjs lensStatsOf runs inside the page on window.__gtRefs), following the
// recorder's procedure (tools/ad/record.mjs): hold on key 0 until the near ring is in, empty the crowd, warm up with
// spawning in view allowed, install the path, spawn guard on, one fixed step per frame.
//
//   source /data0/projectnyc_aux/env.sh
//   node tools/core/page_take.mjs --shot tuApolloSweep [--warm N] [--frames N] [--radius 250] [--out dir] [--port P]
//
// Writes <out>/stats.json (the same per-frame fields as tools/core/take.mjs) and <out>/console.log. No GPU is used:
// the browser runs ANGLE on SwiftShader and the engine's picture is held (engine.holdDraw), so only the frame hooks run.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pickPort } from '../cells/harness.mjs';
import { chromium } from 'playwright';
import { lensStatsOf } from '../../core/tracks/stats.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (k, d = null) => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const shotName = opt('shot', 'tuApolloSweep');
const SH = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ad/shots.json'), 'utf8'));
const P = { name: shotName, ...(SH.shots[shotName] || SH.probes[shotName]) };
const FPS = SH._meta?.fps || 30, dt = 1 / FPS;
const total = parseInt(opt('frames', String(Math.round(P.duration * FPS))), 10);
const warm = parseInt(opt('warm', String(P.warm || 300)), 10);
const radius = parseFloat(opt('radius', '250'));
const out = path.resolve(opt('out', path.join(ROOT, 'shots/core', `${shotName}_page`)));
fs.mkdirSync(out, { recursive: true });
const BASE_FLAGS = opt('flags', SH._meta?.flags || 'hud=0&lmwait=150&life=0&clean=1');
const logs = [];
const log = (...a) => { const s = a.join(' '); console.log(s); logs.push(`[${new Date().toISOString()}] ${s}`); };

// the shot's first key in world metres (shared/geo.js project)
const { project } = await import('../../client/src/shared/geo.js');
const [sx, sz] = project(P.keys[0].p[0], P.keys[0].p[1]);
const holdOf = (Q) => ({ duration: 1e6, ease: 0, abs: Q.abs, tension: Q.tension, fov: Q.fov, keys: [Q.keys[0], { p: [Q.keys[0].p[0] + 1e-6, Q.keys[0].p[1] + 1e-6, Q.keys[0].p[2]], look: Q.keys[0].look }] });

const port = opt('port') || await pickPort();   // (free, and outside Chrome's restricted ports: tools/cells/harness.mjs)
const bdir = path.join(ROOT, 'client');
const vite = spawn(process.execPath, [path.join(bdir, 'node_modules/vite/bin/vite.js'), '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
log(`vite pid ${vite.pid} on ${port}`);
await sleep(4000);
const W = 640, H = 360;   // 16:9 as the core's camera (the spawn and view guards' frustum)
const browser = await chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--use-gl=angle', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W},${H}`] });
const cleanup = async () => { try { await browser.close(); } catch {} try { vite.kill('SIGTERM'); } catch {} };
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await cleanup(); process.exit(130); });
const t0 = Date.now();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  // the picture held from the first frame (SwiftShader would draw the whole city every frame of the boot; the frame hooks,
  // tile streaming and the sims run without it)
  await page.addInitScript(() => { const iv = setInterval(() => { const E = window.__ENGINE; if (E && !E.holdDraw) E.holdDraw = true; if (window.__R1D_DONE) clearInterval(iv); }, 20); });
  page.on('console', (m) => { const s = m.text(); if (/error|warn|\[record\]|\[boot\]|sims|crowd|fleet24\] \d+ kinds/i.test(s)) logs.push(`[console] ${s.slice(0, 300)}`); });
  page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
  const q = `?shot=1&record=1&${BASE_FLAGS}&x=${sx.toFixed(1)}&z=${sz.toFixed(1)}&y=${(P.keys[0].p[2] + 40).toFixed(1)}&time=${P.time}${P.flags ? '&' + P.flags : ''}&pc26=0`;
  log('page', q);
  await page.goto(`http://127.0.0.1:${port}/${q}`, { waitUntil: 'domcontentloaded', timeout: 300000 });
  for (let k = 0; ; k++) {
    const b = await page.evaluate(() => ({ up: typeof window.__SET_PATH === 'function' && !!window.__gtRefs, near: window.__STREAMER?.stats?.near ?? -1, crowd: !!window.__CROWD, traffic: !!window.__TRAFFIC })).catch((e) => ({ err: String(e).slice(0, 120) }));
    if (b.up) break;
    if (b.err && /closed|crashed/i.test(b.err)) throw new Error(b.err);
    if (k % 10 === 0) log(`  boot ${((Date.now() - t0) / 1000).toFixed(0)} s: ${JSON.stringify(b)}`);
    if (Date.now() - t0 > 2400000) throw new Error('boot timeout');
    await sleep(3000);
  }
  log(`record mode up in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  await page.evaluate(() => { window.__ENGINE.holdDraw = true; });   // no picture: the frame hooks (stream, sims) only
  await page.evaluate((p) => window.__SET_PATH(p), holdOf(P));
  await page.evaluate(() => window.__advance(0));
  // settle: the near ring around key 0 assembled (the streamer's own counters), the sims built
  const ts = Date.now();
  let st = null;
  for (;;) {
    st = await page.evaluate(() => { const S = window.__STREAMER; return { near: S.stats.near, out: S.outstanding, q: S.queue.length, f: S.fetching, under: S.readyUnder(), cars: window.__gtRefs.traffic?.cars.length ?? -1, peds: window.__gtRefs.peds?.peds.length ?? -1, crowd: !!window.__CROWD }; });
    if (st.under && st.out === 0 && st.q === 0 && st.f === 0 && st.near > 4) break;
    if (Date.now() - ts > 1800000) { log('settle timeout', JSON.stringify(st)); break; }
    await sleep(3000);
  }
  log(`settled in ${((Date.now() - ts) / 1000).toFixed(0)} s: ${JSON.stringify(st)}`);
  const graph = await page.evaluate(() => { const T = window.__gtRefs.traffic, Pd = window.__gtRefs.peds; return { edges: T.edges.size, signals: T.signals.size, walkEdges: Pd ? Pd.walkEdges.length : 0, kinds: Object.keys(T.pools).length, target: T.target, pedTarget: Pd ? Pd.target : 0, crowd: !!window.__CROWD }; });
  log('graph', JSON.stringify(graph));
  // FP26 (record.mjs, filmlod=1): the whole path pre-streamed with the streamer growing, back on key 0; frozen for the capture
  const filmlod = /(^|[?&])filmlod=1(&|$)/.test(q);
  if (filmlod) {
    await page.evaluate(() => window.__DRESS_HOLD?.('grow'));
    const holdAt = (Q, K) => ({ duration: 1e6, ease: 0, abs: Q.abs, tension: Q.tension, fov: Q.fov, keys: [K, { p: [K.p[0] + 1e-6, K.p[1] + 1e-6, K.p[2]], look: K.look }] });
    const midKey = (a, b) => ({ p: a.p.map((v, i) => (v + b.p[i]) / 2), look: (a.look || a.p).map((v, i) => (v + (b.look || b.p)[i]) / 2) });
    const pts = [];
    for (let k = 1; k < P.keys.length; k++) pts.push(midKey(P.keys[k - 1], P.keys[k]), P.keys[k]);
    for (const qq of P.prestream || []) pts.push({ p: qq, look: [qq[0], qq[1] + 0.002, 0] });
    for (const K of [...pts, P.keys[0]]) {
      await page.evaluate((p) => window.__SET_PATH(p), K === P.keys[0] ? holdOf(P) : holdAt(P, K));
      await page.evaluate(() => window.__advance(0));
      for (;;) { const ok = await page.evaluate(() => { const S = window.__STREAMER; return S.outstanding === 0 && S.queue.length === 0 && S.fetching === 0; }); if (ok) break; await sleep(1000); }
    }
    log(`pre-streamed ${pts.length} path points: tiles ${await page.evaluate(() => window.__STREAMER.stats.near)}`);
  }
  await page.evaluate(() => window.__PEDS_RESET?.());
  await page.evaluate(() => window.__SPAWNGUARD?.(false));
  const carsAtWarm = await page.evaluate(() => window.__gtRefs.traffic.cars.length);
  log(`cars at the warm-up's start: ${carsAtWarm} (the core's --prefill to match)`);
  const tw = Date.now();
  for (let done = 0; done < warm;) {
    const n = Math.min(150, warm - done);
    await page.evaluate((o) => window.__REC_WARM(o), { n, drawLast: 0, dt });
    done += n;
    const c = await page.evaluate(() => [window.__gtRefs.traffic.cars.length, window.__gtRefs.peds?.peds.length ?? 0]);
    log(`  warm ${done}/${warm}: cars ${c[0]}, walkers ${c[1]}`);
  }
  const warmS = (Date.now() - tw) / 1000;
  await page.evaluate((p) => window.__SET_PATH(p), P);
  await page.evaluate(() => window.__advance(0));
  await page.evaluate(() => window.__SPAWNGUARD?.(true));
  if (filmlod) await page.evaluate(() => window.__DRESS_HOLD?.('freeze'));
  // the lens path's points for the region counts (as the core's recorder takes them: 33 points on the take's curve)
  const { PathCam } = await import('../../core/sim/pathcam.mjs');
  const pc = new PathCam({ fov: P.fov || 58, updateProjectionMatrix() {} }, null);
  pc.setPath(P);
  const pathPts = [];
  for (let i = 0; i <= 32; i++) { const qq = pc.curve.getPointAt(i / 32); pathPts.push([qq.x, qq.z]); }
  await page.evaluate((src) => { window.__R1D_STATS = new Function('return ' + src)(); }, lensStatsOf.toString());
  const perFrame = [];
  const tc = Date.now();
  for (let i = 0; i < total; i++) {
    if (i > 0) await page.evaluate((o) => window.__REC_WARM(o), { n: 1, drawLast: 0, dt });
    const s = await page.evaluate(([R, pts]) => {
      const T = window.__gtRefs.traffic, Pd = window.__gtRefs.peds, cam = window.__ENGINE.camera, R2 = R * R;
      const near = (x, z) => pts.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 <= R2);
      let veh = 0, walk = 0;
      for (const c of T.cars) if (c._pose && near(c._pose[0], c._pose[2])) veh++;
      if (Pd) { const M = Pd.mesh.instanceMatrix.array; for (const p of Pd.peds) if (near(M[p.idx * 16 + 12], M[p.idx * 16 + 14])) walk++; }
      return { t: +T.time.toFixed(4), inRegion: { veh, walk }, ...window.__R1D_STATS(T, Pd, cam, [50, 100, 250], true), cam: [cam.position.x, cam.position.y, cam.position.z] };
    }, [radius, pathPts]);
    perFrame.push({ i, ...s });
    // the actors at the first, middle and last frames (tools/core/plot_take.py draws them next to the core's)
    if (i === 0 || i === (total >> 1) || i === total - 1) {
      const A = await page.evaluate(() => {
        const T = window.__gtRefs.traffic, Pd = window.__gtRefs.peds, r = (v) => Math.round(v * 100) / 100;
        const veh = T.cars.filter((c) => c._pose).map((c) => [c.kind, r(c._pose[0]), r(c._pose[2]), r(c._pose[3]), r(c.v || 0)]);
        const walk = [];
        if (Pd) { const M = Pd.mesh.instanceMatrix.array; for (const p of Pd.peds) { const k = p.idx * 16; walk.push([r(M[k + 12]), r(M[k + 14]), r(Math.atan2(M[k + 8], M[k + 10])), r((p.v || 0) * (p.vf ?? 1))]); } }
        const cam = window.__ENGINE.camera;
        cam.updateMatrixWorld();
        return { veh, walk, cam: [cam.position.x, cam.position.y, cam.position.z, cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w, cam.fov] };
      });
      fs.writeFileSync(path.join(out, `actors_f${i}.json`), JSON.stringify(A));
    }
    if (i % 30 === 0) log(`  frame ${i}: within 100 m: cars ${s.cars[100]} (moving ${s.moving[100]}, mean ${s.meanV[100]} m/s) walkers ${s.walkers[100]}; overlaps ${s.overlaps} offroad ${s.offRoad}`);
  }
  const capS = (Date.now() - tc) / 1000;
  const summary = { shot: shotName, source: 'page', frames: total, warm, query: q, graph, carsAtWarm, s: { boot: null, warm: warmS, capture: capS, total: (Date.now() - t0) / 1000 },
    cars: perFrame.at(-1)?.total.cars, walkers: perFrame.at(-1)?.total.walkers, perFrame };
  fs.writeFileSync(path.join(out, 'stats.json'), JSON.stringify(summary, null, 1));
  log(`done: ${total} frames; warm ${warmS.toFixed(0)} s, capture ${capS.toFixed(0)} s, total ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${out}`);
} catch (e) {
  log('FAILED', e.stack || e);
} finally {
  fs.writeFileSync(path.join(out, 'console.log'), logs.join('\n'));
  await cleanup();
}
