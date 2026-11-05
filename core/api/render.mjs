// The render protocol's core side (docs/specs/render-protocol.md, valdrada.render/0): what the headless core sends a
// renderer client (the Unreal plugin ValdradaRender, a three.js page without its own sims) and what it takes back.
//
//   render.hello    a renderer identifies itself; the answer carries the class table, the fleet's kinds, the crowd's
//                   variants, the time of day and the current load set
//   render.state    after every step: the frame, the time of day, the view, the actors that entered or left, and one
//                   ATRK v1 frame block (docs/specs/actor-tracks.md) as its blob
//   render.load     the streaming manager's load set (core/streaming/stream.mjs) round the view and the listening cameras,
//                   whenever it changes; the renderer answers render.loaded with its pending count
//   render.capture  one per sensor group (bridge.js runSensors through window.__PERC.group); the renderer answers
//                   render.result with the output planes as blobs, in the order of `outputs`
//
// The recorder of the takes (core/tracks/recorder.mjs) writes the records, so a renderer that replays takes draws a live
// session with the same code. Its region is the cameras' positions: an actor is sent while it is within RADIUS of the
// view or of a listening camera.
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { TrackRecorder } from '../tracks/recorder.mjs';
import { frameBlock } from '../tracks/format.mjs';
import { StreamManager, normalizeLod, normalizeCells, normalizeLandmarks, tierParams } from '../streaming/stream.mjs';
import { R1D_FLEET_FNS, KIND24 } from '../../client/src/sim/fleet24.js';
import { TILE } from '../../client/src/shared/geo.js';

export const RENDER_PROTOCOL = 'valdrada.render/0';
const RADIUS = Number(process.env.VALDRADA_RENDER_RADIUS || 300);   // m round each camera: the actors a renderer draws
const PARKED_EXTRA = 50;          // parked vehicles a little farther out, so they are in place before they are seen
const API_IDS_BELOW = 1000000;    // the recorder's own ids start here; an API actor keeps its API id
const IDLE_STATE_MS = 100;        // dt = 0 frames (world.wait_until_loaded, idle frames) send their state at most this often
const CAPTURE_TIMEOUT_MS = Number(process.env.VALDRADA_CAPTURE_TIMEOUT_MS || 180000);
const CELLCACHE = process.env.VALDRADA_CELLCACHE || '/data0/projectnyc_aux/cellcache';
const OUT_FORMAT = { rgb: 'rgba8', semantic: 'class_u8', instance: 'instance_rgba8', depth: 'depth_f32', labels: 'labels' };

const readJSON = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const r4 = (v) => Math.round(v * 1e4) / 1e4;

// The ground's classes in a frame from a renderer that labels by component (Unreal: one stencil a component). Its ground
// meshes hold roads, sidewalks and grass in one piece (the measured ground's drape, a tile's ground), so it leaves them
// unlabelled; each unlabelled pixel whose point (from the frame's depth) lies on the simulation's ground takes the class of
// the surface the walkers and the cars use there (the streamer's tile answers, surfaceInfo; perception/segRender.js ids),
// the measured ground off the streets terrain. A pixel more than GROUND_TOL off that surface keeps no class (a roof, a
// ledge, a prop). Two of the answers' limits are worked round. A road one tile lays may overhang the next by metres while
// the streamer asks the point's own tile only, and a cached tile's answers stop at its own edge: within EDGE of a tile's
// edge the neighbours are asked too, and where none answers, the nearest answer across the edge on the pixel's surface
// (W 120th St's carriageway was a hole 5 m wide along x = 1024, classed terrain). And the cached tiles' kinds are 0.5 m
// cells with interpolated heights, so where the cells round a pixel hold other kinds the cell whose surface the pixel
// lies on (better by KERB_STEP / 3) gives the kind, and a kerb line follows the step.
const GROUND_TOL = 0.3, KERB_STEP = 0.06, EDGE = 8;
const KIND_CLASS = { asphalt: 3, sidewalk: 4, busred: 10, gutter: 11, brick: 13, plaza: 13, path: 14, gravel: 14, grass: 16, grassU: 16 };
const TERRAIN_CLASS = 15;
const GROUND_ON = process.env.VALDRADA_GROUND_CLASSES !== '0';
export function groundClasses(sem, depth, w, h, camera, depthMax, streamer) {
  const q = new THREE.Quaternion(camera.quat[0], camera.quat[1], camera.quat[2], camera.quat[3]);
  const r = new THREE.Vector3(1, 0, 0).applyQuaternion(q), u = new THREE.Vector3(0, 1, 0).applyQuaternion(q), f = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  // (the renderer's horizontal field from the camera's aspect, its vertical one from the frame's: ValdradaFrames.h HFov)
  const tanX = Math.tan((camera.fov_y_deg * Math.PI) / 360) * (camera.aspect || w / h), tanY = (tanX * h) / w;
  const [px, py, pz] = camera.pos;
  const far = depthMax * 0.999;
  const fns = streamer.surfInfos;
  const edgeOf = (x, z) => {
    const ix = Math.floor(x / TILE), iz = Math.floor(z / TILE), fx = x - ix * TILE, fz = z - iz * TILE;
    return [ix, iz, fx < EDGE ? -1 : fx > TILE - EDGE ? 1 : 0, fz < EDGE ? -1 : fz > TILE - EDGE ? 1 : 0];
  };
  const info = (x, z) => {
    const own = streamer.surfaceInfoAt(x, z, 0.3);
    if (own || !fns) return own;
    const [ix, iz, dx, dz] = edgeOf(x, z);
    for (const [a, b] of [[dx, 0], [0, dz], [dx, dz]]) {
      if (!a && !b) continue;
      const fn = fns.get(`${ix + a}_${iz + b}`), t = fn ? fn(x, z, 0.3) : null;
      if (t) return t;
    }
    return null;
  };
  // (no tile answers in an edge's band: the nearest answer across the band, square to the edge, on the pixel's surface)
  const across = (x, z, y) => {
    const [, , dx, dz] = edgeOf(x, z);
    if (!dx && !dz) return null;
    for (let d = 0.5; d <= EDGE + 1; d += 0.5)
      for (const [ox, oz] of dx ? [[d, 0], [-d, 0]] : [[0, d], [0, -d]]) {
        const t = info(x + ox, z + oz);
        if (t && Math.abs(y - t.y) < GROUND_TOL) return t;
      }
    return null;
  };
  let n = 0, ci0 = NaN, cj0 = NaN, s0 = null, nb0 = null, mixed0 = false;
  for (let j = 0; j < h; j++) {
    const ny = (1 - (2 * (j + 0.5)) / h) * tanY;
    for (let i = 0; i < w; i++) {
      const k = j * w + i;
      if (sem[k] !== 0) continue;
      const d = depth[k];
      if (!(d > 0) || d >= far) continue;
      const nx = ((2 * (i + 0.5)) / w - 1) * tanX;
      const x = px + d * (f.x + nx * r.x + ny * u.x), y = py + d * (f.y + nx * r.y + ny * u.y), z = pz + d * (f.z + nx * r.z + ny * u.z);
      // (a 5 cm cell's answers serve the next pixels in it: the near ground spans many pixels a cell)
      const ci = Math.floor(x * 20), cj = Math.floor(z * 20);
      if (ci !== ci0 || cj !== cj0) {
        ci0 = ci; cj0 = cj; s0 = info(x, z) || across(x, z, y);
        nb0 = [info(x + 0.5, z), info(x - 0.5, z), info(x, z + 0.5), info(x, z - 0.5)];
        mixed0 = nb0.some((t) => t && (!s0 || t.kind !== s0.kind));
      }
      let s = s0, dy = s ? Math.abs(y - s.y) : Infinity;
      if (mixed0 || dy > KERB_STEP) for (const t of nb0) if (t && Math.abs(y - t.y) < dy - KERB_STEP / 3) { s = t; dy = Math.abs(y - t.y); }
      let c = 0;
      if (s && dy < GROUND_TOL) c = KIND_CLASS[s.kind] || 0;
      else {
        const g = streamer.terrainAt(x, z);
        if (g !== null && Number.isFinite(g) && Math.abs(y - g) < GROUND_TOL) c = TERRAIN_CLASS;
      }
      if (c) { sem[k] = c; n++; }
    }
  }
  return n;
}
const f32 = (b, n) => (b.byteOffset % 4 === 0 ? new Float32Array(b.buffer, b.byteOffset, n) : new Float32Array(Uint8Array.from(b.subarray(0, n * 4)).buffer));

export function createRenderHub({ server, W, sky, weather, classes, walkerVariants = [], apiVersion = '0.1.0', geoOrigin, publicDir, log = () => {} }) {
  const renderers = new Map();   // cid -> renderer state
  let seq = 0, lastIdleSend = 0;
  const pending = new Map();     // capture id -> { cid, res, rej, timer }

  // ---------------------------------------------------------------- records
  const rec = new TrackRecorder(W, { radius: RADIUS, pathPts: [], night: W.ENV.night ? W.ENV.night.value : 0 });
  rec.nextId = API_IDS_BELOW;
  rec.signalList = []; rec.parked = [];          // the static set is kept here, by the cameras (below)
  const vehicleKinds = rec.kinds.map((k) => ({ kind: k, size: W.kinds[k].size, wheelbase: W.kinds[k].meta?.wheelbase ?? null,
    hubs: (W.kinds[k].meta?.hubs || []).map((h) => ({ id: h.id, p: h.p, r: h.r })),
    articulated: W.kinds[k].rear ? { pivot: W.kinds[k].rear.pivot, tow: W.kinds[k].rear.tow } : null,
    palette: KIND24[k]?.palette || 'car', base: KIND24[k]?.base || null }));   // (base: the model a kind repaints, taxi2 the lincoln)
  const parkedIds = new Map();   // 'tile:index' -> id
  const signalIds = new Map();   // junction key -> id
  let parkedNow = new Map();     // id -> static record of the parked vehicles in range
  let signalsNow = [];           // [{ id, key, x, z }] in range, the order of the frame block's signal bytes
  let staticAt = null, staticStep = 0;

  // the region: the view and every listening camera (bridge.js window.__API.cameras)
  function cameras() {
    const out = [];
    const c = W.camera;
    c.updateMatrixWorld();
    out.push({ x: c.position.x, y: c.position.y, z: c.position.z, fovV: c.fov, heightPx: 1080, q: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w] });
    // the spectator, where the core simulates and world.wait_until_loaded waits, when the view is elsewhere (the view is
    // the first RGB camera once one exists, listening or not)
    const sc = W.controller && W.controller.center;
    if (sc && Math.hypot(sc.x - c.position.x, sc.z - c.position.z) > 50) out.push({ x: sc.x, y: sc.y, z: sc.z, fovV: c.fov, heightPx: 1080, q: out[0].q });
    const api = globalThis.window && window.__API;
    if (api && typeof api.cameras === 'function') {
      for (const s of api.cameras()) out.push({ x: s.p.x, y: s.p.y, z: s.p.z, fovV: s.fov, heightPx: s.height || 720, q: [s.q.x, s.q.y, s.q.z, s.q.w] });
    }
    return out;
  }
  const near = (pts, x, z, r) => pts.some(([a, b]) => (a - x) ** 2 + (b - z) ** 2 <= r * r);

  // the parked vehicles and the signalised junctions in range (again when a camera moved 25 m, or every 30 steps)
  function updateStatic(pts) {
    const key = pts.map(([x, z]) => `${Math.round(x / 25)}_${Math.round(z / 25)}`).join('|');
    if (key === staticAt && staticStep++ < 30) return;
    staticAt = key; staticStep = 0;
    const T = W.traffic, m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    const next = new Map();
    for (const [tile, recs] of T.parkedRecs || []) {
      recs.forEach((r, i) => {
        if (!near(pts, r.x, r.z, RADIUS + PARKED_EXTRA)) return;
        const k = `${tile}:${i}`;
        let id = parkedIds.get(k);
        if (!id) { id = rec.nextId++; parkedIds.set(k, id); }
        const old = parkedNow.get(id);
        if (old) { next.set(id, old); return; }
        m.fromArray(r.m).decompose(p, q, s);
        const seed = R1D_FLEET_FNS.hash(Math.round(p.x * 10), Math.round(p.z * 10));   // fleet24: a parked body's seed is its place
        next.set(id, { id, type: 'parked', kind: r.kind, kind_index: rec.kindIx.get(r.kind) ?? 65535, x: r4(p.x), y: r4(p.y), z: r4(p.z),
          q: [r4(q.x), r4(q.y), r4(q.z), r4(q.w)], seed: r4(seed), ...rec._paint(r.kind, r.color, seed) });
      });
    }
    parkedNow = next;
    signalsNow = [];
    for (const k of T.signals.keys()) {
      const [x, z] = k.split('_').map(Number);
      if (!near(pts, x, z, RADIUS + PARKED_EXTRA)) continue;
      let id = signalIds.get(k);
      if (!id) { id = rec.nextId++; signalIds.set(k, id); }
      signalsNow.push({ id, key: k, x, z });
    }
    rec.signalList = signalsNow.map(({ key, x, z }) => ({ key, x, z }));
  }

  // ---------------------------------------------------------------- load sets
  let lodIdx = null, cellIdx = null, tiersDoc = null;
  function managerFor(tierName) {
    if (!lodIdx) {
      lodIdx = readJSON(path.join(CELLCACHE, 'lod16/index.json')) || { levels: {}, chunks: {} };
      cellIdx = readJSON(path.join(CELLCACHE, 'index.json'));
      tiersDoc = readJSON(path.join(publicDir, 'data/tiers.json')) || { tiers: {} };
    }
    const t = tiersDoc.tiers && tiersDoc.tiers[tierName] ? { name: tierName, ...tiersDoc.tiers[tierName] } : null;
    const lod = normalizeLod(lodIdx);
    const finest = lod.chunks.length ? Math.max(3, Math.min(...lod.chunks.map((c) => c.level))) : 4;
    return new StreamManager({ lod, cells: normalizeCells(cellIdx), landmarks: normalizeLandmarks(lodIdx), tier: tierParams(t, tierName), finest });
  }
  function updateLoad(R, cams, dt, frame) {
    const out = R.sm.update({ cameras: cams, dt, resident: () => true });
    const chunks = [], fading = [];
    for (const [k, a, mode] of out.chunks) (a >= 1 && mode === 0 ? chunks : fading).push(mode === 0 && a >= 1 ? k : [k, +a.toFixed(3), mode]);
    const key = JSON.stringify([out.cells.baked, out.cells.missing, chunks, fading.map((f) => f[0])]);
    if (key === R.loadKey) return;
    R.loadKey = key;
    const c = cams[0];
    // seq: the load's own number, which render.loaded echoes (several loads can share a frame while the world waits)
    R.loadSeq = (R.loadSeq || 0) + 1;
    R.load = { frame, seq: R.loadSeq, centre: [r4(c.x), r4(c.y), r4(c.z)], tier: R.tier, cells: out.cells.baked, cells_missing: out.cells.missing, chunks, fading, landmarks: out.landmarks };
    R.loadFrame = frame; R.pending = Infinity;
    server.send(R.cid, { event: 'render.load', ...R.load });
  }

  // ---------------------------------------------------------------- per-step state
  const clock = () => (globalThis.window && window.__API && window.__API.clock ? window.__API.clock() : { frame: W.frame, simTime: W.traffic.time });
  function env() {
    return { time_of_day: sky.mode, night: W.ENV.night ? +W.ENV.night.value.toFixed(4) : 0, rain: weather.rain || 0, clock: +W.ENV.time.value.toFixed(6) };
  }
  function view() {
    const c = W.camera;
    c.updateMatrixWorld();
    return { pos: [r4(c.position.x), r4(c.position.y), r4(c.position.z)], quat: [c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w].map((v) => +v.toFixed(7)),
      fov_y_deg: +c.fov.toFixed(4), aspect: +c.aspect.toFixed(6) };
  }
  // the API actors keep their own ids in the records (bridge.js labels name them by it)
  function claimApiIds() {
    const api = globalThis.window && window.__API;
    if (!api) return;
    for (const a of api.actors.values()) {
      if (a.kind === 'vehicle' && a.car) rec.ids.set(a.car, a.id);
      else if (a.kind === 'walker' && a.ped) rec.ids.set(a.ped, a.id);
    }
  }
  function afterStep(dt) {
    if (!renderers.size) return;
    const now = performance.now();
    const cams = cameras();
    const pts = cams.map((c) => [c.x, c.z]);
    const { frame, simTime } = clock();
    for (const R of renderers.values()) updateLoad(R, cams, dt, frame);
    if (!(dt > 0) && now - lastIdleSend < IDLE_STATE_MS) return;
    lastIdleSend = now;
    updateStatic(pts);
    claimApiIds();
    rec.pathPts = pts;
    rec.night = W.ENV.night ? W.ENV.night.value : 0;
    rec.capture(dt);
    const F = rec.frames[rec.frames.length - 1];
    rec.frames.length = 0; rec.camera.length = 0; rec.simTime.length = 0; rec.lightFrames.length = 0;
    const blob = frameBlock(F);
    const ids = new Set();
    for (const v of F.veh) ids.add(v.id);
    for (const w of F.walk) ids.add(w.id);
    for (const t of F.train) ids.add(t.id);
    for (const id of parkedNow.keys()) ids.add(id);
    const sigKey = signalsNow.map((s) => s.id).join(',');
    const st = { event: 'render.state', frame, timestamp: +simTime.toFixed(6), dt, env: env(), view: view() };
    for (const R of renderers.values()) {
      const add = [], remove = [];
      for (const id of ids) {
        if (R.known.has(id)) continue;
        const a = parkedNow.get(id) || rec.actors.get(id);
        if (a) add.push(id < API_IDS_BELOW ? { ...a, api: true } : a);
        R.known.add(id);
      }
      for (const id of R.known) if (!ids.has(id)) { remove.push(id); R.known.delete(id); }
      const msg = { ...st, actors: { add, remove } };
      if (sigKey !== R.sigKey) { R.sigKey = sigKey; msg.signals = signalsNow; }
      server.send(R.cid, msg, [blob]);
    }
    // the recorder's static records of actors no renderer holds any more
    for (const id of rec.actors.keys()) if (!ids.has(id)) rec.actors.delete(id);
  }

  // ---------------------------------------------------------------- captures
  function serving(outputs) {
    let best = null, bestN = -1;
    for (const R of renderers.values()) {
      const n = outputs.filter((o) => R.outputs.has(o)).length;
      if (n > bestN) { best = R; bestN = n; }
    }
    return bestN > 0 ? best : null;
  }
  // a sensor group's capture (bridge.js runSensors): resolves with the planes in the protocol's formats
  function capture(g) {
    const R = serving(g.outputs);
    if (!R) return Promise.reject(Object.assign(new Error('no attached renderer serves ' + g.outputs.join(', ')), { code: 'needs_renderer' }));
    const outputs = g.outputs.filter((o) => R.outputs.has(o));
    // (the ground's classes need the frame's depth: asked for with the semantic plane, dropped again unless wanted)
    const ground = GROUND_ON && R.renderer === 'unreal' && outputs.includes('semantic') && R.outputs.has('depth') && !!W.streamer;
    const dropDepth = ground && !outputs.includes('depth');
    const id = ++seq;
    const c = g.pose;
    const msg = { event: 'render.capture', frame: g.frame, timestamp: +g.t.toFixed(6), capture: id, primary: !!g.primary, sensors: g.sensors, outputs: dropDepth ? [...outputs, 'depth'] : outputs,
      width: g.width, height: g.height, fov: g.fov, transform: g.transform,
      camera: { pos: [r4(c.p.x), r4(c.p.y), r4(c.p.z)], quat: [c.q.x, c.q.y, c.q.z, c.q.w].map((v) => +v.toFixed(7)), fov_y_deg: +c.fov.toFixed(4), aspect: +c.aspect.toFixed(6),
        near: W.camera.near, far: W.camera.far },
      amodal: g.amodal || 0, min_pixels: g.min_pixels || 30, exposure: g.exposure || { mode: 'auto', compensation: 0 } };
    // the RGB camera's render_mode 'pathtrace' (a renderer with a path tracer: Unreal's) with its samples per pixel
    if (g.mode === 'pathtrace') { msg.mode = 'pathtrace'; msg.spp = Math.max(1, Math.min(4096, g.spp | 0 || 64)); }
    const limit = CAPTURE_TIMEOUT_MS + (msg.mode === 'pathtrace' ? msg.spp * 1000 : 0);
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { pending.delete(id); rej(Object.assign(new Error(`capture ${id}: no render.result in ${limit / 1000} s`), { code: 'renderer_timeout' })); }, limit);
      pending.set(id, { cid: R.cid, res, rej, timer, outputs: msg.outputs, t0: performance.now(), ground, dropDepth, camera: msg.camera });
      server.send(R.cid, msg);
    });
  }
  function result(cid, p, blobs) {
    const P = pending.get(p.capture | 0);
    if (!P || P.cid !== cid) return { ok: false, reason: 'no such capture' };
    pending.delete(p.capture | 0);
    clearTimeout(P.timer);
    if (p.error) { P.rej(Object.assign(new Error(`renderer: ${p.error.message || p.error.code}`), { code: p.error.code === 'unsupported_output' ? 'needs_renderer' : (p.error.code || 'internal') })); return { ok: true }; }
    const outs = p.outputs || P.outputs, planes = {};
    let b = 0;
    for (const o of outs) if (o !== 'labels') planes[o] = blobs[b++] || null;
    const timing = p.timing || null, n = p.width * p.height;
    if (P.ground && planes.semantic && planes.depth && planes.semantic.length === n && planes.depth.length === n * 4) {
      const t = performance.now();
      const px = groundClasses(planes.semantic, f32(planes.depth, n), p.width, p.height, P.camera, p.depth_max ?? P.camera.far, W.streamer);
      if (timing) { timing.ground_ms = +(performance.now() - t).toFixed(1); timing.ground_px = px; }
    }
    if (P.dropDepth) delete planes.depth;
    P.res({ width: p.width, height: p.height, planes, labels: p.labels || null, depth_max: P.dropDepth ? null : (p.depth_max ?? null), timing, ms: +(performance.now() - P.t0).toFixed(1) });
    return { ok: true };
  }

  // ---------------------------------------------------------------- requests from a renderer
  function hello(cid, p) {
    if (p.protocol && p.protocol !== RENDER_PROTOCOL) throw Object.assign(new Error(`this core speaks ${RENDER_PROTOCOL}, not ${p.protocol}`), { code: 'bad_protocol' });
    const tier = String(p.tier || 'high');
    const R = { cid, hello: p, renderer: String(p.renderer || 'unknown'), outputs: new Set(p.outputs || ['rgb']), tier, sm: managerFor(tier === 'cinematic' ? 'cinematic' : tier),
      known: new Set(), loadKey: '', load: null, loadFrame: -1, loadedFrame: -1, pending: Infinity, resident: null, sigKey: null };
    renderers.set(cid, R);
    const { frame, simTime } = clock();
    updateLoad(R, cameras(), 0, frame);
    const res = { protocol: RENDER_PROTOCOL, api_version: apiVersion, geo_origin: geoOrigin, frame, timestamp: +simTime.toFixed(6), classes, vehicle_kinds: vehicleKinds,
      walker_variants: walkerVariants, train_kinds: ['r62a', 'm7a', 'm8'], env: env(), view: view(), load: R.load, formats: OUT_FORMAT };
    log(`renderer #${cid}: ${R.renderer} ${p.version || ''} (${[...R.outputs].join(', ')}; tier ${tier})`);
    lastIdleSend = 0;
    setImmediate(() => afterStep(0));   // its first state at once
    return res;
  }
  function loaded(cid, p) {
    const R = renderers.get(cid);
    if (!R) return { ok: false };
    if (p.seq !== undefined && p.seq !== R.loadSeq) return { ok: true, stale: true };   // an answer to an older load set
    R.loadedFrame = p.frame ?? R.loadedFrame;
    R.pending = Number.isFinite(+p.pending) ? +p.pending : 0;
    R.resident = p.resident || null;
    return { ok: true };
  }
  function handle(cid, msg) {
    const p = msg.params || {};
    try {
      let r;
      if (msg.method === 'render.hello') r = hello(cid, p);
      else if (!renderers.has(cid)) throw Object.assign(new Error('render.hello first'), { code: 'not_a_renderer' });
      else if (msg.method === 'render.loaded') r = loaded(cid, p);
      else if (msg.method === 'render.result') r = result(cid, p, msg._blobs || []);
      else throw Object.assign(new Error(`unknown method ${msg.method}`), { code: 'unknown_method' });
      if (msg.id !== undefined && msg.id !== null) server.send(cid, { id: msg.id, result: r });
    } catch (e) {
      server.send(cid, { id: msg.id ?? null, error: { code: e.code || 'internal', message: String(e.message || e) } });
    }
  }
  function bye(cid) {
    const R = renderers.get(cid);
    if (!R) return false;
    renderers.delete(cid);
    for (const [id, P] of pending) if (P.cid === cid) { pending.delete(id); clearTimeout(P.timer); P.rej(Object.assign(new Error('the renderer went away'), { code: 'needs_renderer' })); }
    log(`renderer #${cid} (${R.renderer}) detached`);
    return true;
  }
  // every attached renderer has the current load set in (world.wait_until_loaded)
  const idle = () => [...renderers.values()].every((R) => R.loadedFrame >= R.loadFrame && R.pending === 0);
  const info = () => [...renderers.values()].map((R) => ({ renderer: R.renderer, version: R.hello.version || null, outputs: [...R.outputs], tier: R.tier, pending: Number.isFinite(R.pending) ? R.pending : null }));
  return { handle, bye, afterStep, capture, idle, info, isRenderer: (cid) => renderers.has(cid), get count() { return renderers.size; } };
}
