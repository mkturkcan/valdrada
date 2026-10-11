// Valdrada — SIMULATION SERVER (Electron host).
//
// The CARLA-style server half: it runs the digital twin (the built Valdrada app, served from a content folder
// through the privileged boundless:// scheme) in a GPU-accelerated Chromium window and exposes its API on a TCP port.
// Clients (PythonAPI/valdrada) speak the framed JSON protocol in docs/api/protocol.md:
//
//   [u32 big-endian length N][u8 kind][N-1 payload bytes]      kind 1 = JSON (UTF-8), kind 2 = binary blob
//
// Requests are {id, method, params}; the page answers {id, result} or {id, error}. Sensor data arrives as
// {event: "sensor", ..., blobs: k} followed by k binary frames. This process only frames bytes and routes them:
// every method runs in the page (client/src/api/bridge.js).
//
//   Valdrada.exe [--port 2000] [--host 127.0.0.1] [--res 1280x720] [--headless] [--content <dir>]
//                    [--dev-url=http://127.0.0.1:5219] [--start-lat 40.80955 --start-lon -73.95905] [--time day]
//                    [--quality high|medium] [--pedestrians photoreal|procedural] [--verbose]
'use strict';
const { app, BrowserWindow, Menu, protocol, net, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const tcp = require('node:net');
const { pathToFileURL } = require('node:url');

const VERSION = '0.3.0';

// ---------------------------------------------------------------- options
// --name value or --name=value. A URL must use the = form: Chromium takes a bare URL argument as the page to open
// and never runs the app (--dev-url=http://127.0.0.1:5219).
const argv = process.argv.slice(1);
const opt = (name, def = null) => {
  const eq = argv.find((a) => a.startsWith('--' + name + '='));
  if (eq) return eq.slice(name.length + 3);
  const i = argv.indexOf('--' + name);
  if (i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) return argv[i + 1];
  const env = (process.env['VALDRADA_' + name.toUpperCase().replace(/-/g, '_')] ?? process.env['BOUNDLESS_' + name.toUpperCase().replace(/-/g, '_')]);
  return env !== undefined ? env : def;
};
const flag = (name) => argv.includes('--' + name) || (process.env['VALDRADA_' + name.toUpperCase().replace(/-/g, '_')] ?? process.env['BOUNDLESS_' + name.toUpperCase().replace(/-/g, '_')]) === '1';
const PORT = Number(opt('port', '2000'));
const HOST = opt('host', '127.0.0.1');
const [RES_W, RES_H] = String(opt('res', '1280x720')).split('x').map(Number);
const HEADLESS = flag('headless');
const VERBOSE = flag('verbose');
const DEV_URL = opt('dev-url');
const START_LAT = Number(opt('start-lat', '40.80955'));   // W 120th St & Amsterdam Ave
const START_LON = Number(opt('start-lon', '-73.95905'));
const TIME = opt('time', 'day');
const QUALITY = opt('quality', 'high');
// photoreal: the CARLA 0.10 walker bank (the default); procedural: the built-in articulated mannequins
const PEDESTRIANS = opt('pedestrians', 'photoreal');
// --log <file>: a GUI app on Windows has no console to print to, so the log can also go to a file
const LOG_FILE = opt('log');
const log = (...a) => {
  const line = '[valdrada] ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log(line);
  if (LOG_FILE) { try { fs.appendFileSync(LOG_FILE, new Date().toISOString() + ' ' + line + '\n'); } catch { /* */ } }
};

// the content folder: --content, then the packaged layout (Content/ next to the exe), then the repo's dist-package
function contentRoot() {
  const cands = [
    opt('content'),
    path.join(path.dirname(process.execPath), 'Content'),
    process.resourcesPath ? path.join(process.resourcesPath, 'Content') : null,
    path.join(__dirname, '..', 'dist-package'),
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(path.join(c, 'index.html'))) return path.resolve(c);
  return null;
}

// ---------------------------------------------------------------- Chromium
// the discrete GPU on hybrid laptops, no vsync / frame cap (synchronous mode runs as fast as the GPU allows), exact
// pixel sizes (a 1280x720 window renders 1280x720 on a 150 % display too)
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=8192');
if (process.platform === 'win32') app.commandLine.appendSwitch('use-angle', 'd3d11');

protocol.registerSchemesAsPrivileged([{
  scheme: 'boundless',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true },
}]);

// ---------------------------------------------------------------- framing
const KIND_JSON = 1, KIND_BLOB = 2;
function frame(kind, payload) {
  const head = Buffer.alloc(5);
  head.writeUInt32BE(payload.length + 1, 0);
  head[4] = kind;
  return [head, payload];
}
function send(sock, obj, blobs = []) {
  if (!sock || sock.destroyed) return;
  const js = Buffer.from(JSON.stringify(blobs.length ? { ...obj, blobs: blobs.length } : obj), 'utf8');
  for (const b of frame(KIND_JSON, js)) sock.write(b);
  for (const blob of blobs) {
    const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer ? blob.buffer : blob, blob.byteOffset || 0, blob.byteLength);
    for (const b of frame(KIND_BLOB, buf)) sock.write(b);
  }
}

// ---------------------------------------------------------------- app
let win = null;
let pageReady = false;
const queue = [];               // requests that arrived while the world was still loading
const clients = new Map();      // cid -> socket
let clientSeq = 0;
const t0 = Date.now();

function forward(cid, msg) {
  if (!win || win.isDestroyed()) return send(clients.get(cid), { id: msg.id, error: { code: 'server_closing', message: 'the simulator window is gone' } });
  win.webContents.send('api-request', { cid, id: msg.id, method: msg.method, params: msg.params || {} });
}
function handleMessage(cid, msg) {
  const sock = clients.get(cid);
  if (VERBOSE) log(`#${cid} ->`, msg.method);
  if (typeof msg.method !== 'string') return send(sock, { id: msg.id ?? null, error: { code: 'bad_request', message: 'missing method' } });
  // answered here, without the page
  if (msg.method === 'server.status') return send(sock, { id: msg.id, result: { ready: pageReady, server_version: VERSION, uptime: (Date.now() - t0) / 1000, clients: clients.size } });
  if (msg.method === 'server.ping') return send(sock, { id: msg.id, result: 'pong' });
  if (!pageReady) { queue.push([cid, msg]); return; }
  forward(cid, msg);
}

function startTcp() {
  const srv = tcp.createServer((sock) => {
    const cid = ++clientSeq;
    clients.set(cid, sock);
    sock.setNoDelay(true);
    log(`client #${cid} connected from ${sock.remoteAddress}:${sock.remotePort}`);
    let buf = Buffer.alloc(0);
    sock.on('data', (chunk) => {
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      while (buf.length >= 5) {
        const n = buf.readUInt32BE(0);
        if (n < 1 || n > 512 * 1024 * 1024) { sock.destroy(new Error('bad frame length')); return; }
        if (buf.length < 4 + n) break;
        const kind = buf[4];
        const payload = buf.subarray(5, 4 + n);
        buf = buf.subarray(4 + n);
        if (kind !== KIND_JSON) continue;            // clients send no blobs (yet)
        let msg;
        try { msg = JSON.parse(payload.toString('utf8')); } catch { send(sock, { id: null, error: { code: 'bad_json', message: 'request is not JSON' } }); continue; }
        handleMessage(cid, msg);
      }
    });
    const bye = () => {
      if (!clients.has(cid)) return;
      clients.delete(cid);
      log(`client #${cid} disconnected`);
      if (win && !win.isDestroyed()) win.webContents.send('api-disconnect', cid);
    };
    sock.on('close', bye);
    sock.on('error', bye);
  });
  srv.on("error", (e) => { log(`ERROR cannot listen on ${HOST}:${PORT}: ${e.message}`); app.exit(2); });
  srv.listen(PORT, HOST, () => log(`listening on ${HOST}:${PORT}`));
}

ipcMain.on('api-response', (_e, msg) => {
  const sock = clients.get(msg.cid);
  if (!sock) return;
  const { cid, ...rest } = msg;
  send(sock, rest);
});
ipcMain.on('api-event', (_e, meta, blobs) => {
  const sock = clients.get(meta.cid);
  if (!sock) return;
  const { cid, ...rest } = meta;
  send(sock, rest, blobs || []);
});
ipcMain.on('api-ready', (_e, info) => {
  pageReady = true;
  log(`world ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (api ${info?.api_version}); ${queue.length} queued request(s)`);
  while (queue.length) { const [cid, msg] = queue.shift(); if (clients.has(cid)) forward(cid, msg); }
});

app.whenReady().then(() => {
  const root = contentRoot();
  if (!DEV_URL && !root) {
    log('ERROR no content folder: pass --content <dir> (the folder with index.html, tiles/, models/ ...)');
    app.exit(1);
    return;
  }
  if (root) {
    log('content', root);
    protocol.handle('boundless', (req) => {
      const u = new URL(req.url);
      let p = decodeURIComponent(u.pathname);
      if (p === '/' || p === '') p = '/index.html';
      const f = path.normalize(path.join(root, p));
      const rel = path.relative(root, f);
      if (rel.startsWith('..') || path.isAbsolute(rel)) return new Response('forbidden', { status: 403 });
      return net.fetch(pathToFileURL(f).toString());
    });
  }
  // the start position: the spectator streams the world around it (x east, z south in the page's frame)
  const LAT0 = 40.7831, LON0 = -73.9712, M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
  const sx = (START_LON - LON0) * M_LON, sz = -(START_LAT - LAT0) * M_LAT;
  const q = new URLSearchParams({ api: '1', hud: '0', clean: '1', life: '0', x: sx.toFixed(1), z: sz.toFixed(1), y: '60', time: TIME, pedtarget: '520', lmwait: '150' });
  if (QUALITY === 'medium') q.set('crowdlod', '15,45');
  if (PEDESTRIANS === 'procedural') q.set('crowd', '0');
  const base = DEV_URL ? DEV_URL.replace(/\/$/, '') + '/' : 'boundless://app/';
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: RES_W, height: RES_H, useContentSize: true, resizable: false, show: !HEADLESS,
    autoHideMenuBar: true, backgroundColor: '#000000', title: `Valdrada — server on ${HOST}:${PORT}`,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false, spellcheck: false,
    },
  });
  // exactly --res: no menu bar (hiding one after creation grows the content area by its height: 1280x772 for 1280x720)
  win.setContentSize(RES_W, RES_H);
  win.webContents.on('console-message', (e) => {
    const m = e.message || '';
    if (/Vite server|\[vite\]|WebSocket/.test(m)) return;   // the dev server's client running without HMR
    if (VERBOSE || /\[api\]|error|Error|PAGEERROR/.test(m)) log('page:', m.slice(0, 400));
  });
  win.webContents.on('render-process-gone', (_e, d) => { log('ERROR renderer gone:', d.reason); app.exit(3); });
  win.on('closed', () => { win = null; app.quit(); });
  win.loadURL(base + 'index.html?' + q.toString());
  startTcp();
});
app.on('window-all-closed', () => app.quit());
