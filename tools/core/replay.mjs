// A recorded take through the Unreal renderer client (ue_client/ValdradaUE), with no simulation: this process speaks
// the core's side of valdrada.render/0 (docs/specs/render-protocol.md) and, frame by frame, sends the take's camera
// (harvest/cam_<shot>.json: three's column-major matrixWorld, vertical fov), the take's actors (tracks.atrk, one ATRK
// frame block each) and the streaming manager's load set round the camera, waits until the load set is in, requests one
// RGB capture and writes it as frame_NNNNN.jpg. The client keeps the city loaded between frames, so a shot costs its
// frames and the client's start, nothing per shot.
//
//   node tools/core/replay.mjs --shot lfBroadway125 --frames 0-299 --pci 61 --out <dir>
//        [--mode lumen|pathtrace] [--spp 4] [--warm 1] [--res 2560x1440] [--time golden] [--tier cinematic]
//        [--walkers] [--port 2410] [--attach] [--quality 95] [--pipeline 1] [--preset-light] [--sun-k 1] [--atmo '{...}'] [--fog] [--fog-density 0.0025] [--fog-radius 350] [--denoiser cpu|rdg]
//        [--no-burst] [--sky-once] [--no-denoise] [--oidn high|balanced|fast] [--depth] [--temporal 0.7] [--ev 0] [--loadset <file> | --stream] [--reach 5000] [--nne fast|balanced|high] [--exec "cmd;cmd"]
//
// --pci: the GPU's bus id (nvidia-smi), the client pinned to it (DRI_PRIME and -graphicsadapter=0); --attach: wait for a
// client started by hand instead of starting one. Walkers are left out unless --walkers (the client draws them as
// capsules). Writes timing.jsonl (one line a frame) and summary.json beside the frames.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readTracks, frameBlock } from '../../core/tracks/format.mjs';
import { StreamManager, normalizeLod, normalizeCells, normalizeLandmarks, tierParams } from '../../core/streaming/stream.mjs';
import { KIND24 } from '../../client/src/sim/fleet24.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d = null) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);
const SHOT = opt('shot', 'lfBroadway125');
const TAKES = opt('takes', '/data0/projectnyc_aux/cellcache/takes');
const [F0, F1] = String(opt('frames', '0-29')).split('-').map(Number);
const PCI = opt('pci', '61'), PORT = Number(opt('port', '2410')), OUT = path.resolve(opt('out', `/data0/projectnyc_aux/dev/v2/speed/replay/${SHOT}`));
const MODE = opt('mode', 'lumen'), SPP = Number(opt('spp', '4')), WARM = opt('warm'), TIME = opt('time', 'golden'), TIER = opt('tier', 'cinematic');
const [W, H] = String(opt('res', '2560x1440')).split('x').map(Number);
const QUALITY = Number(opt('quality', '95')), WALKERS = flag('walkers'), ATTACH = flag('attach');
// --oidn [high|balanced|fast]: the path-traced frames denoised outside Unreal (tools/core/oidn_worker.py, Open Image
// Denoise on this GPU through CUDA) from the noisy image and its albedo and normal guides; Unreal's denoiser off
const OIDN = flag('oidn') ? (opt('oidn') || 'high') : null;
// --depth: each frame's planar depth too, as _depth/depth_NNNN.png (16 bit, log2 encoded: d = 2^(v / 65535 x 18 - 2) m,
// the encoding dev/v2/fp18/reproj.py reads for the reprojected flicker measure)
const DEPTH = flag('depth');
// --temporal [0.7]: with --oidn, a temporal pass after the denoiser against its frame-to-frame flicker: the previous
// output reprojected through this frame's depth and the take's cameras, kept where the depths agree, clamped to this
// frame's 3 x 3 neighbourhood and blended at this weight (oidn_worker.py; needs the depth, which it asks for)
const TEMPORAL = flag('temporal') ? Number(opt('temporal') || 0.7) : null;
if (TEMPORAL !== null && !OIDN) { console.error('--temporal needs --oidn'); process.exit(2); }
function depthPng(f32, w, h) {
  const zlib = req('node:zlib');
  const raw = Buffer.alloc((w * 2 + 1) * h);
  for (let y = 0; y < h; y++) {
    const o = y * (w * 2 + 1);
    raw[o] = 0;
    for (let x = 0; x < w; x++) {
      const d = Math.max(f32[y * w + x], 0.25), v = Math.min(65535, Math.max(0, Math.round((Math.log2(d) + 2) / 18 * 65535)));
      raw.writeUInt16BE(v, o + 1 + x * 2);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 16; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}
if (DEPTH) fs.mkdirSync(path.join(OUT, '_depth'), { recursive: true });
const CELLCACHE = process.env.VALDRADA_CELLCACHE || '/data0/projectnyc_aux/cellcache';
const req = createRequire(path.join(ROOT, 'tools', 'assets', 'package.json'));
const sharp = req('sharp');
const T0 = performance.now();
const secs = () => +((performance.now() - T0) / 1000).toFixed(2);
const log = (...a) => console.log(`[replay ${secs()}s]`, ...a);
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- the take
const tr = readTracks(path.join(TAKES, SHOT, 'tracks.atrk'));
const hd = tr.header;
const cams = JSON.parse(fs.readFileSync(path.join(TAKES, SHOT, 'harvest', `cam_${SHOT}.json`), 'utf8'));
const last = Math.min(F1, tr.frames.length - 1, cams.length - 1);
log(`${SHOT}: ${tr.frames.length} frames, ${cams.length} camera rows; frames ${F0}-${last}, ${MODE}${MODE === 'pathtrace' ? ` ${SPP} spp` : ''}, ${W}x${H}`);
const actorById = new Map(hd.actors.map((a) => [a.id, a]));
const kinds = hd.vehicleKinds.map((k) => ({ ...k, base: KIND24[k.kind]?.base || null }));
const kindIx = new Map(kinds.map((k, i) => [k.kind, i]));
const parked = (hd.parked || []).map((p) => ({ ...p, type: 'parked', kind_index: kindIx.get(p.kind) ?? 65535 }));
const signals = (hd.signals?.list || []).map((s, i) => ({ id: 3000000 + i, ...s }));
// the take's own light from its harvest (as client/tools/ar34/export/ue_light.py builds the trailer's rig with the
// physical light table and the cinematic preset): the sun's direction, intensity (the page's directional lights summed)
// and colour (half the page's warmth over the atmosphere's), the film's exposure (phys_light.json for the time of day)
// and the page's grade with the preset's vignette and grain, the aerial perspective from 6 km
const pyjson = (t) => (typeof t === 'string' ? JSON.parse(t.replace(/'/g, '"').replace(/\bTrue\b/g, 'true').replace(/\bFalse\b/g, 'false').replace(/\bNone\b/g, 'null')) : t);
function takeLook() {
  const H = path.join(TAKES, SHOT, 'harvest');
  try {
    const ls = JSON.parse(fs.readFileSync(path.join(H, 'light_static.json'), 'utf8'));
    const lj = JSON.parse(fs.readFileSync(path.join(H, 'lights.json'), 'utf8'));
    const phys = JSON.parse(fs.readFileSync(path.join(ROOT, 'client/tools/ar34/export/phys_light.json'), 'utf8'));
    const sun = pyjson(ls.sun), g = pyjson(ls.grade) || {};
    const d = [sun.pos[0] - sun.target[0], sun.pos[1] - sun.target[1], sun.pos[2] - sun.target[2]], n = Math.hypot(...d);
    const dirs = (lj.lights || []).filter((l) => l.type === 'DirectionalLight' && l.visible !== false);
    const col = sun.color || [1, 1, 1];
    const mode = ls.mode || TIME;
    return {
      sun: { dir: d.map((v) => v / n), intensity: (dirs.reduce((a, l) => a + (+l.intensity || 0), 0) || 3) * Number(opt('sun-k', '1')), color: col.map((c) => 0.5 + 0.5 * c) },
      film: { Expo: phys.exposure?.[mode] ?? 1, Sat: g.uSat ?? 1, Con: g.uCon ?? 0, Blk: g.uBlk ?? 0, Wht: g.uWht ?? 1, Hi: g.uHi ?? 0, Warm: g.uWarm ?? 0,
        TintG: g.uTintG ?? 0, Vig: (g.uVig ?? 0) + 0.22, Grain: OIDN ? 0 : 0.035 },
      aerial: { scale: 1.0, start_km: 6.0 },
      // (--atmo '<json>': the sky atmosphere's scattering against the engine's defaults, for the path tracer's reference
      // atmosphere: {rayleigh, mie, mie_absorption, mie_g, multi_scattering, ground_albedo: [r, g, b]})
      ...(opt('atmo') ? { atmosphere: JSON.parse(opt('atmo')) } : {}),
      // (--fog: the cinematic preset's height fog, golden density 0.010 x its fog 0.25, inscattering half the visible sky's
      // mean, the volumetric part within 350 m)
      ...(flag('fog') ? { fog: { density: Number(opt('fog-density', String(0.010 * 0.25))), falloff: 0.12, max_opacity: 0.45, cutoff_m: 12000, inscatter: ((() => { try { return pyjson(ls.skyVis)?.mean; } catch { return null; } })() || [0.6, 0.7, 0.9]).map((v) => v * 0.5),
        // (the path tracer's fog is a volume of this radius round the lens: --fog-radius, m; the raster's volumetric part 350 m)
        volumetric: mode === 'golden' || mode === 'day', vol_distance_m: Number(opt('fog-radius', '350')) } } : {}),
    };
  } catch (e) { log(`no take light (${e.message}): the time of day's preset`); return {}; }
}
function classes() {
  const src = fs.readFileSync(path.join(ROOT, 'client/src/perception/segRender.js'), 'utf8');
  const i = src.indexOf('const CLASS_ROWS = ['), j = src.indexOf('];', i);
  return [...src.slice(i, j).matchAll(/\[\s*(\d+)\s*,\s*'([^']+)'\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([01])\s*\]/g)]
    .map((m) => ({ id: +m[1], name: m[2], rgb: [+m[3], +m[4], +m[5]], isthing: m[6] === '1' }));
}
// a camera row as the renderer's frame: position, quaternion, vertical fov
const mtx = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3();
function camAt(f) {
  const c = cams[f];
  mtx.fromArray(c.m).decompose(P, Q, S);
  return { pos: [P.x, P.y, P.z], quat: [Q.x, Q.y, Q.z, Q.w], fov_y_deg: c.fov, aspect: W / H, near: c.near ?? 0.4, far: c.far ?? 20000 };
}

// ---------------------------------------------------------------- load sets round the camera
const readJSON = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const lodIdx = readJSON(path.join(CELLCACHE, 'lod16/index.json'));
const tiers = readJSON(path.join(ROOT, 'client/public/data/tiers.json')).tiers || {};
const lod = normalizeLod(lodIdx);
const sm = new StreamManager({ lod, cells: normalizeCells(readJSON(path.join(CELLCACHE, 'index.json'))), landmarks: normalizeLandmarks(lodIdx),
  tier: tierParams(tiers[TIER] ? { name: TIER, ...tiers[TIER] } : null, TIER), finest: Math.max(3, Math.min(...lod.chunks.map((c) => c.level))) });
let loadKey = '', loadSeq = 0;
// the take's load set (tools/core/loadsets.mjs, <take>/loadset.json), what Movie Render Queue's takes draw: each frame's
// chunks, fading chunks and cells, with the persistent L6 chunks (the whole city's far ring, the bridges' blocks among
// them) always; --loadset <file> names another, --stream uses this process's own manager instead (the frame's view only:
// it left out persistent L6 chunks, the George Washington Bridge's among them, and some far L4 and L5 chunks)
const LSFILE = flag('stream') ? null : (opt('loadset') || path.join(TAKES, SHOT, 'loadset.json'));
const LS = LSFILE && fs.existsSync(LSFILE) ? readJSON(LSFILE) : null;
const lsFrames = new Map((LS?.frames || []).map((x) => [Number(x.f), x]));
const lsPersistent = LS?.persistent?.chunks || [];
// --reach <m>: every city block within this distance of the lens is near (its block level and cells drawn whole), as the
// takes' worlds hold them (tools/ue/render_take.py UE_NEAR_M, 5 km, city_build.city_cut): an aerial then draws whole
// blocks to its horizon where the load set's cells stop at the streaming radius (one cell of each such block is added)
const REACH = Number(opt('reach', '0'));
const cityIdx = REACH > 0 ? readJSON(path.join(ROOT, 'ue_client/ValdradaUE/Data/city.json')) : null;
const blockCell = new Map();
if (cityIdx) for (const k of Object.keys(cityIdx.cells)) {
  const [cx, cz] = k.split('_').map(Number), b = `${Math.floor(cx / 8)}_${Math.floor(cz / 8)}`;
  if (cityIdx.city_blocks[b] && !blockCell.has(b)) blockCell.set(b, k);
}
function reachCells(cam) {
  if (!cityIdx) return [];
  const B = cityIdx.block || 1024, out = [];
  for (const [b, k] of blockCell) {
    const [bx, bz] = b.split('_').map(Number);
    const dx = Math.max(0, bx * B - cam.pos[0], cam.pos[0] - (bx + 1) * B), dz = Math.max(0, bz * B - cam.pos[2], cam.pos[2] - (bz + 1) * B);
    if (Math.hypot(dx, dz) < REACH) out.push(k);
  }
  return out;
}
function loadFor(f, cam, dt) {
  const e = lsFrames.get(f);
  if (e) {
    const chunks = [...new Set([...(e.chunks || []), ...lsPersistent])];
    if (REACH > 0) e.cells = [...new Set([...(e.cells || []), ...reachCells(cam)])];
    const fading = (e.fading || []).map((x) => (Array.isArray(x) ? x : [x, 1, 0]));
    const key = JSON.stringify([e.cells, chunks, fading.filter((x) => x[1] >= 0.5).map((x) => x[0])]);
    if (key === loadKey) return null;
    loadKey = key;
    return { event: 'render.load', frame: f, seq: ++loadSeq, centre: cam.pos, tier: TIER, cells: e.cells || [], cells_missing: [], chunks, fading, landmarks: LS.persistent?.landmarks || [] };
  }
  const out = sm.update({ cameras: [{ x: cam.pos[0], y: cam.pos[1], z: cam.pos[2], fovV: cam.fov_y_deg, heightPx: H, q: cam.quat }], dt, resident: () => true });
  const chunks = [], fading = [];
  for (const [k, a, mode] of out.chunks) (a >= 1 && mode === 0 ? chunks.push(k) : fading.push([k, +a.toFixed(3), mode]));
  const key = JSON.stringify([out.cells.baked, out.cells.missing, chunks, fading.filter((x) => x[1] >= 0.5).map((x) => x[0])]);
  if (key === loadKey) return null;
  loadKey = key;
  return { event: 'render.load', frame: f, seq: ++loadSeq, centre: cam.pos, tier: TIER, cells: out.cells.baked, cells_missing: out.cells.missing, chunks, fading, landmarks: out.landmarks };
}

// ---------------------------------------------------------------- the link (docs/api/protocol.md framing)
let sock = null, openMsg = null;
// incoming bytes as a list of chunks, joined only once a whole frame is there (a 14.7 MB image arrives in hundreds of
// chunks; joining at every chunk copied it quadratically)
const chunks = [];
let have = 0;
function take(n) {
  const out = Buffer.allocUnsafe(n);
  let o = 0;
  while (o < n) {
    const c = chunks[0], k = Math.min(c.length, n - o);
    c.copy(out, o, 0, k); o += k;
    if (k === c.length) chunks.shift(); else chunks[0] = c.subarray(k);
  }
  have -= n;
  return out;
}
function peekU32() {
  if (chunks[0].length >= 4) return chunks[0].readUInt32BE(0);
  const b = take(4); chunks.unshift(b); have += 4; return b.readUInt32BE(0);
}
const waiting = new Map();   // key -> resolve
let onHello = null, lastLoaded = null;   // (the client's latest render.loaded: an answer can come before the wait)
function send(obj, blobs = []) {
  const js = Buffer.from(JSON.stringify(blobs.length ? { ...obj, blobs: blobs.length } : obj));
  const head = Buffer.alloc(5); head.writeUInt32BE(js.length + 1); head[4] = 1;
  sock.write(head); sock.write(js);
  for (const b of blobs) { const h = Buffer.alloc(5); h.writeUInt32BE(b.length + 1); h[4] = 2; sock.write(h); sock.write(b); }
}
function handle(m) {
  if (m.method === 'render.hello') { if (onHello) onHello(m); return; }
  if (m.method === 'render.loaded') {
    if (m.id != null) send({ id: m.id, result: { ok: true } });
    const p = m.params || {};
    lastLoaded = p;
    if (p.seq === loadSeq && p.pending === 0 && waiting.has('load')) { const r = waiting.get('load'); waiting.delete('load'); r(p); }
    return;
  }
  if (m.method === 'render.result') {
    if (m.id != null) send({ id: m.id, result: { ok: true } });
    const k = 'cap' + m.params.capture;
    if (waiting.has(k)) { const r = waiting.get(k); waiting.delete(k); r(m); }
  }
}
const server = net.createServer((s) => {
  if (sock) { s.destroy(); return; }
  sock = s; s.setNoDelay(true);
  log('renderer connected');
  s.on('data', (chunk) => {
    chunks.push(chunk); have += chunk.length;
    while (have >= 5) {
      const n = peekU32();
      if (have < 4 + n) break;
      const fr = take(4 + n);
      const kind = fr[4], payload = fr.subarray(5);
      if (kind === 2) { if (openMsg) { openMsg._blobs.push(payload); if (openMsg._blobs.length >= openMsg.blobs) { const m = openMsg; openMsg = null; handle(m); } } continue; }
      const m = JSON.parse(payload.toString('utf8'));
      if ((m.blobs | 0) > 0) { m._blobs = []; openMsg = m; } else handle(m);
    }
  });
  s.on('close', () => { log('renderer disconnected'); process.exitCode = process.exitCode || 2; });
});
const wait = (key, ms) => new Promise((res, rej) => {
  waiting.set(key, res);
  setTimeout(() => { if (waiting.has(key)) { waiting.delete(key); rej(new Error(`${key}: no answer in ${ms / 1000} s`)); } }, ms);
});

// ---------------------------------------------------------------- the client
let child = null;
function startClient() {
  const logf = path.join(OUT, 'client.log');
  const extra = opt('denoiser') ? [`-ValdradaDenoiser=${opt('denoiser')}`] : [];
  // --nne: the model Unreal's denoiser runs (NNEDenoiser.Asset; without it the project's, Open Image Denoise's
  // balanced model with alpha, which denoises the alpha in a second pass)
  const NNE = { fast: 1, balanced: 2, high: 3 }[opt('nne')];
  // --exec "<console command>;...": console commands for the client after its start, "name=value" for "name value"
  // (cvars: the path tracer's sampler and seed)
  const cmds = [...(NNE ? [`NNEDenoiser.Asset ${NNE}`] : []), ...(opt('exec') ? opt('exec').split(';').map((c) => c.trim().replace('=', ' ')).filter(Boolean) : [])];
  if (cmds.length) extra.push(`-ExecCmds=${cmds.join(',')}`);
  child = spawn('bash', [path.join(ROOT, 'ue_client/ValdradaUE/Tools/run_client.sh'), logf, '-ValdradaNoView', `-ValdradaTier=${TIER}`, ...extra],
    { env: { ...process.env, PORT: String(PORT), GPU_PCI: PCI, RES: '1280x720' }, stdio: 'ignore' });
  child.on('exit', (c) => log(`client exited (${c})`));
  log(`client starting on PCI ${PCI} (pid ${child.pid}, log ${logf})`);
}
function stopClient() {
  if (!child || child.exitCode !== null) return Promise.resolve();
  return new Promise((res) => { child.once('exit', res); child.kill('SIGTERM'); setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* */ } res(); }, 15000).unref(); });
}

// ---------------------------------------------------------------- run
await new Promise((res) => server.listen(PORT, '127.0.0.1', res));
log(`listening on 127.0.0.1:${PORT}`);
const hello = new Promise((res) => { onHello = res; });
if (!ATTACH) startClient();
const h = await hello;
const cam0 = camAt(F0);
const load0 = loadFor(F0, cam0, 0);
const env = { time_of_day: TIME, night: TIME === 'night' ? 1 : TIME === 'dusk' ? 0.55 : hd.night ?? 0.05, rain: 0, clock: hd.simTime?.[F0] ?? 0, ...(flag('preset-light') ? {} : takeLook()),
  // (--sky-once: the sky light captured once instead of every frame; that capture held no sky, so the path tracer drew a
  // black sky and lost the sky's fill. The path-traced views are offline and reset every frame anyway.)
  ...(flag('sky-once') ? { skylight_realtime: false } : {}) };
log('env', JSON.stringify(env));
send({ id: h.id, result: { protocol: 'valdrada.render/0', api_version: '0.1.0', geo_origin: { lat: 40.7831, lon: -73.9712 }, frame: F0, timestamp: env.clock,
  classes: classes(), vehicle_kinds: kinds, walker_variants: [], train_kinds: hd.trainKinds || ['r62a', 'm7a', 'm8'], env,
  view: { pos: cam0.pos, quat: cam0.quat, fov_y_deg: cam0.fov_y_deg, aspect: cam0.aspect }, load: load0 } });
const tHello = secs();
log(`hello from ${h.params?.renderer} ${h.params?.version || ''}`);
const timing = fs.createWriteStream(path.join(OUT, 'timing.jsonl'));
const known = new Set();
const writes = [];
let capId = 0, tFirst = null, loadWaitS = 0;
// --pipeline N: up to N captures in flight (the client takes the next frame's state and capture once the previous
// capture is answered, so its GPU does not wait for this process to read and encode the image); load changes drain it
const PIPE = Math.max(1, Number(opt('pipeline', '1')));
const inflight = [];
let lastDone = null, stop = false;
// the outside denoiser, one process on this GPU (CUDA's index for the PCI bus id)
let worker = null, workerSent = 0;
const workerDone = [];
if (OIDN) {
  const { execFileSync } = await import('node:child_process');
  const rows = execFileSync('nvidia-smi', ['--query-gpu=index,pci.bus_id', '--format=csv,noheader']).toString().trim().split('\n');
  const idx = rows.map((l) => l.split(',').map((x) => x.trim())).find(([, b]) => b.toLowerCase().includes(`:${PCI.toLowerCase()}:00.0`))?.[0] ?? '0';
  worker = spawn('python3', [path.join(ROOT, 'tools/core/oidn_worker.py')], { env: { ...process.env, CUDA_DEVICE_ORDER: 'PCI_BUS_ID', CUDA_VISIBLE_DEVICES: idx }, stdio: ['pipe', 'pipe', 'inherit'] });
  let lineBuf = '';
  worker.stdout.on('data', (d) => { lineBuf += d.toString(); let i; while ((i = lineBuf.indexOf('\n')) >= 0) { workerDone.push(JSON.parse(lineBuf.slice(0, i))); lineBuf = lineBuf.slice(i + 1); } });
  worker.on('exit', (c) => { if (c) { log(`denoiser exited (${c})`); process.exitCode = 4; } });
  log(`denoiser: Open Image Denoise (${OIDN}) on CUDA device ${idx} (PCI ${PCI})`);
}
const encodeMs = [];   // (each JPEG's encode and write, in sharp's threads beside the next frames)
async function finishOne() {
  const j = inflight.shift();
  const r = await j.p;
  const now = performance.now();
  if (r.params.error) { log(`frame ${j.f}: ${r.params.error.code} ${r.params.error.message}`); process.exitCode = 3; return false; }
  const file = path.join(OUT, `frame_${String(j.f).padStart(5, '0')}.jpg`);
  const te = performance.now();
  if (DEPTH) {
    const db = r._blobs[r.params.outputs.indexOf('depth')];
    const f32 = new Float32Array(new Uint8Array(db).buffer);   // (a copy: the blob need not be 4-byte aligned)
    fs.writeFileSync(path.join(OUT, '_depth', `depth_${String(j.f).padStart(4, '0')}.png`), depthPng(f32, r.params.width, r.params.height));
  }
  if (worker) {
    const hdr = Buffer.from(JSON.stringify({ file, w: r.params.width, h: r.params.height, quality: QUALITY, oidn: OIDN,
      ...(TEMPORAL !== null ? { temporal: TEMPORAL, cam: { m: cams[j.f].m, fov: cams[j.f].fov } } : {}) }));
    const len = Buffer.alloc(4); len.writeUInt32LE(hdr.length);
    let ok = worker.stdin.write(len); ok = worker.stdin.write(hdr) && ok;
    for (const b of r._blobs.slice(0, 3)) ok = worker.stdin.write(b) && ok;
    if (TEMPORAL !== null) ok = worker.stdin.write(r._blobs[r.params.outputs.indexOf('depth')]) && ok;
    workerSent++;
    if (!ok) await new Promise((res) => worker.stdin.once('drain', res));
    // (at most 4 frames waiting in the worker)
    while (workerSent - workerDone.length > 4) await new Promise((res) => worker.stdout.once('data', res));
  } else {
    writes.push(sharp(r._blobs[0], { raw: { width: r.params.width, height: r.params.height, channels: 4 } }).removeAlpha().jpeg({ quality: QUALITY }).toFile(file)
      .then(() => { encodeMs.push(performance.now() - te); }));
    if (writes.length > 8) await writes.shift();
  }
  if (tFirst === null) { tFirst = secs(); log(`first frame at ${tFirst} s`); }
  // (frame_s: the time since the previous frame was answered, the throughput)
  const frameS = (now - (lastDone ?? j.tf)) / 1000;
  lastDone = now;
  timing.write(JSON.stringify({ f: j.f, load_s: +j.tl.toFixed(3), cap_s: +((now - j.tc) / 1000).toFixed(3), frame_s: +frameS.toFixed(3), renderer: r.params.timing, add: j.add }) + '\n');
  if ((j.f - F0) % 50 === 0) log(`frame ${j.f}: ${((now - j.tc) / 1000).toFixed(3)} s capture, ${j.tl.toFixed(2)} s load`);
  return true;
}
for (let f = F0; f <= last && !stop; f++) {
  const tf = performance.now();
  const cam = camAt(f);
  // the load set: the first one comes with the hello; later ones as they change, each waited for with nothing in flight
  const ld = f === F0 ? load0 : loadFor(f, cam, 1 / (hd.fps || 30));
  let tl = 0;
  if (ld) {
    while (inflight.length && !stop) stop = !(await finishOne());
    if (stop) break;
    if (f !== F0) send(ld);
    const t = performance.now();
    if (!(lastLoaded && lastLoaded.seq === loadSeq && lastLoaded.pending === 0)) await wait('load', 900000);
    tl = (performance.now() - t) / 1000; loadWaitS += tl;
  }
  // the state: the take's frame block, its actors announced once
  const F = tr.frames[f];
  const fb = { veh: F.veh, walk: WALKERS ? F.walk : [], sig: F.sig, train: F.train };
  const ids = new Set([...fb.veh.map((v) => v.id), ...fb.walk.map((w) => w.id), ...fb.train.map((t) => t.id), ...parked.map((p) => p.id)]);
  const add = [], remove = [];
  for (const id of ids) if (!known.has(id)) { known.add(id); add.push(parked.find((p) => p.id === id) || actorById.get(id) || { id, type: 'vehicle' }); }
  for (const id of known) if (!ids.has(id)) { known.delete(id); remove.push(id); }
  const st = { event: 'render.state', frame: f, timestamp: hd.simTime?.[f] ?? f / 30, dt: f === F0 ? 0 : 1 / (hd.fps || 30),
    env: { ...env, clock: hd.simTime?.[f] ?? f / 30 }, view: { pos: cam.pos, quat: cam.quat, fov_y_deg: cam.fov_y_deg, aspect: cam.aspect }, actors: { add, remove } };
  if (f === F0) st.signals = signals.map(({ id, key, x, z }) => ({ id, key, x, z }));
  send(st, [frameBlock(fb)]);
  // one RGB capture
  const id = ++capId;
  const capMsg = { event: 'render.capture', frame: f, timestamp: st.timestamp, capture: id, primary: true, sensors: [1], outputs: [...(OIDN ? ['rgb', 'albedo', 'normal'] : ['rgb']), ...(DEPTH || TEMPORAL !== null ? ['depth'] : [])],
    width: W, height: H, fov: 0, camera: cam, exposure: { mode: 'manual', compensation: Number(opt('ev', '0')) }, mode: MODE, spp: SPP, burst: !flag('no-burst'), denoise: !OIDN && !flag('no-denoise') };
  if (WARM !== null) capMsg.warm = Number(WARM);
  const tc = performance.now();
  send(capMsg);
  inflight.push({ f, tf, tl, tc, add: add.length, p: wait('cap' + id, 600000) });
  while (inflight.length >= PIPE && !stop) stop = !(await finishOne());
}
while (inflight.length && !stop) stop = !(await finishOne());
if (worker) { worker.stdin.end(); if (worker.exitCode === null) await new Promise((res) => worker.once('exit', res)); }
await Promise.all(writes);
timing.end();
const tEnd = secs(), n = last - F0 + 1;
const rows = fs.readFileSync(path.join(OUT, 'timing.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const steady = rows.slice(1).map((r) => r.frame_s);
const sum = { shot: SHOT, frames: [F0, last], pipeline: PIPE, warm: WARM, denoise: !flag('no-denoise'), mode: MODE, spp: MODE === 'pathtrace' ? SPP : null, res: [W, H], pci: PCI, attach: ATTACH, hello_s: tHello, first_frame_s: tFirst,
  total_s: tEnd, frame_s_mean: steady.length ? +(steady.reduce((a, b) => a + b, 0) / steady.length).toFixed(3) : null,
  frame_s_median: steady.length ? steady.slice().sort((a, b) => a - b)[Math.floor(steady.length / 2)] : null, load_wait_s: +loadWaitS.toFixed(2), loads: loadSeq,
  oidn: OIDN, temporal: TEMPORAL, ev: Number(opt('ev', '0')), nne: opt('nne'), exec: opt('exec'), worker_ms_mean: workerDone.length ? Object.fromEntries(['unpack_ms', 'denoise_ms', 'temporal_ms', 'jpeg_ms'].map((k) => [k, +(workerDone.reduce((a, w) => a + w[k], 0) / workerDone.length).toFixed(1)])) : null,
  encode_ms_mean: encodeMs.length ? +(encodeMs.reduce((a, b) => a + b, 0) / encodeMs.length).toFixed(1) : null,
  renderer_ms_mean: (() => { const k = ['render_ms', 'readback_ms', 'convert_ms', 'total_ms'], o = {}; for (const x of k) { const v = rows.slice(1).map((r) => r.renderer?.[x]).filter((v) => v != null); if (v.length) o[x] = +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1); } return o; })(),
  projected_2700_frames_3gpus_s: steady.length ? +((tFirst ?? 0) + (2700 / 3) * (steady.reduce((a, b) => a + b, 0) / steady.length)).toFixed(0) : null };
fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(sum, null, 1));
log('done', JSON.stringify(sum));
if (!ATTACH) await stopClient();
server.close();
process.exit(process.exitCode || 0);
