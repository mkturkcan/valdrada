// The headless client for the cell tools (bake.mjs, parity.mjs): Vite with NYC_NOHMR=1 (no reloads mid-run), Playwright
// Chromium on ANGLE Vulkan, the harness guard (no hangs, no orphans). Run the tools under tools/withgpu.mjs, which takes the
// GPU lane's lock and pins the GPU (GPU_LANE=35 -> GPU 1).
import { chromium } from 'playwright';
import { installGuard, watchPage } from '../harness_guard.mjs';
import { spawn } from 'node:child_process';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIENT = path.join(ROOT, 'client');
export const CACHE = process.env.CELLCACHE || '/data0/projectnyc_aux/cellcache';
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const stamp = () => new Date().toTimeString().slice(0, 8);

// (Chrome's restricted ports in the range: a page there fails ERR_UNSAFE_PORT, a bake group's 8 cells lost, g0195 2026-11-05)
const UNSAFE_PORTS = new Set([6000, 6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697]);
const portFree = (p) => new Promise((res) => { const s = net.createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });
// a free port in the tools' range outside Chrome's restricted ones (tools/core's page tools take theirs here too)
export async function pickPort() {
  let p;
  do p = 5400 + Math.floor(Math.random() * 3000); while (UNSAFE_PORTS.has(p) || !(await portFree(p)));
  return String(p);
}
// A port free when asked, outside Chrome's restricted ones, and the server answering on it: eighteen groups starting at
// once drew the same port (one --strictPort server exits) or waited out a slow start, and the page found nothing there
// (ERR_CONNECTION_REFUSED, g0041 2026-11-05). Throws when no server came up on eight ports.
export async function startVite() {
  const viteBin = path.join(CLIENT, 'node_modules', 'vite', 'bin', 'vite.js');
  for (let attempt = 0; attempt < 8; attempt++) {
    const port = await pickPort();
    const server = spawn(process.execPath, [viteBin, '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: CLIENT, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });
    let ok = false;
    for (let i = 0; i < 120 && !ok && server.exitCode === null; i++) {
      await sleep(500);
      ok = await new Promise((res) => { const r = http.get(`http://127.0.0.1:${port}/`, (s) => { s.resume(); res(s.statusCode === 200); }); r.on('error', () => res(false)); });
    }
    if (ok) return { port, server, url: `http://127.0.0.1:${port}` };
    try { server.kill(); } catch { /* */ }
  }
  throw new Error('startVite: no dev server came up on eight ports');
}
export async function startBrowser(W = 1600, H = 900) {
  return chromium.launch({
    headless: true,
    args: [process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=vulkan', ...(process.platform === 'win32' ? [] : ['--js-flags=--max-old-space-size=16384']),
      '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W},${H}`,
      // 2D canvases in software: on the GPU the same painter gives different pixels from one call to the next (a red brick
      // painted twice in one page, seed 21: two hashes; in software one hash across page loads), so painted textures
      // would differ between two bakes of the same inputs
      '--disable-accelerated-2d-canvas'],
  });
}
export async function newPage(browser, W, H, label, logs) {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  try { watchPage(page, { label }); } catch { /* */ }
  page.on('console', (m) => { const t = `[${m.type()}] ${m.text().slice(0, 500)}`; logs.push(t); });
  page.on('pageerror', (e) => logs.push('PAGEERROR ' + String(e).slice(0, 500)));
  await page.addInitScript(() => {
    addEventListener('error', (e) => console.warn('[pageerr] ' + (e.error && e.error.stack ? e.error.stack : e.message)));
    addEventListener('unhandledrejection', (e) => { const r = e.reason; console.warn('[pagerej] ' + (r && r.stack ? r.stack : String(r))); });
  });
  return page;
}
export function guard(name, maxMin) { try { installGuard({ name, maxMin }); } catch (e) { console.log('[cells] guard not installed:', e?.message || e); } }
// a CORS static server over a folder (the cell cache for ?cellsbase=, the sink for the baker's page)
export function serveDir(dir) {
  return new Promise((res) => {
    const srv = http.createServer((req, rq) => {
      const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Private-Network': 'true', 'Access-Control-Allow-Headers': '*' };
      if (req.method === 'OPTIONS') { rq.writeHead(204, cors); rq.end(); return; }
      const p = path.join(dir, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(dir) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { rq.writeHead(404, cors); rq.end(); return; }
      rq.writeHead(200, { ...cors, 'Content-Type': p.endsWith('.json') ? 'application/json' : 'application/octet-stream', 'Cache-Control': 'no-cache' });
      fs.createReadStream(p).pipe(rq);
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}
