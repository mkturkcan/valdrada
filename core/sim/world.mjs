// The headless world: the page's own traffic, walker and signal models (client/src/sim/traffic.js, peds.js,
// signals.js, imported as they are) on the headless streamer, stepped with a fixed dt in the page's frame order
// (main.js engine.onFrame: controller, spawn and view guards, streamer, traffic, peds, signals). No WebGL: the
// three.js objects the models write their instance matrices into are storage, never rendered.
import { seedRandom, shimStats } from '../env/shim.mjs';
import * as THREE from 'three';
import { Traffic, PK34_TABLES } from '../../client/src/sim/traffic.js';
import { Peds } from '../../client/src/sim/peds.js';
import { spawnGuard, viewGuard } from '../../client/src/sim/spawnGuard.js';
import { signalState } from '../../client/src/sim/signals.js';
import { areasReady } from '../../client/src/city/areas.js';
import { lf39Load } from '../../client/src/world/lotfix39.js';
import { HeadlessStreamer, TILES_DIR } from '../world/streamer.mjs';
import path from 'node:path';
import { loadFleetMeta, installFleetMeta } from './fleet.mjs';
import { installFleetState } from './fleetState.mjs';
import { R1D_FLEET_FNS } from '../../client/src/sim/fleet24.js';
import { HeadlessRig } from './rig.mjs';
import { PathCam } from './pathcam.mjs';
import { initTrains } from '../../client/src/sim/trains.js';
import { createReplay } from '../../client/src/game/control.js';

// world/sky.js PRESETS night factor per time of day (the only sim-visible effect of time: lamps on at night > 0.35)
export const NIGHT_OF = { day: 0, golden: 0.05, dusk: 0.55, night: 1 };

export async function createWorld({ seed = 1, peds: withPeds = true, trains: withTrains = true, pedTarget = null, carTarget = null, aspect = 16 / 9, fov = 58, nearR, obstaclesDir = null, night = 0, tilesDir = null } = {}) {
  seedRandom(seed);
  const t0 = performance.now();
  // the data the models wait on before a tile may be read (main.js: areasGate before tile assembly; traffic.js PK34's
  // hydrant table before a 125th Street tile parks; LF39's lot table): awaited here so the order never depends on timing
  await areasReady;
  globalThis.VALDRADA_TILES_BASE = tilesDir ? path.resolve(tilesDir) : TILES_DIR;   // OV39: the set's own overlays first
  await lf39Load();
  await PK34_TABLES.ready();
  const scene = new THREE.Scene();
  const streamer = new HeadlessStreamer({ ...(nearR ? { nearR, unloadR: nearR + 320 } : {}), ...(tilesDir ? { tilesDir } : {}), obstaclesDir });
  await streamer.anchorBridges();   // P1 TERRAIN (TERRAIN_P1=1 only): the bridges' Manhattan ends
  const { kinds, trafficFleet, names } = loadFleetMeta();
  const traffic = new Traffic(scene, streamer, trafficFleet);
  installFleetMeta(traffic, kinds);
  installFleetState(traffic, kinds, R1D_FLEET_FNS.hash);
  if (carTarget) traffic.target = carTarget;
  const camera = new THREE.PerspectiveCamera(fov, aspect, 0.4, 20000);
  traffic.camera = camera;
  let peds = null, rig = null;
  if (withPeds) {
    rig = new HeadlessRig(700);
    peds = new Peds(scene, streamer, traffic, rig);
    peds.lensAt = camera.position;
    if (pedTarget) peds.target = pedTarget;
    // the obstacle pools' footprints as peds.js caches them per pool geometry (its own footBoxes of the page's kit)
    if (streamer.obsFoot) peds._obsFoot = new Map([...streamer.obsFoot.values()].map((F) => [F.token, F.boxes]));
  }
  // campus walk lines arrive through fetch (peds.js constructor): let them land before the first step
  await new Promise((r) => setTimeout(r, 0));
  const cam = new PathCam(camera, streamer);
  // the trains (sim/trains.js): closed-form timetabled runs on the sim clock ENV.time (world/sky.js advances it by the
  // frame's step); the drawing sets it builds are never updated here, only carsAt and the take cue are used
  const trains = withTrains ? initTrains({ scene, camera }, streamer) : null;
  // the shared uniforms' clock (world/materials.js ENV, reached through the trains' api: the core imports no renderer module)
  const ENV = trains ? trains.ENV : { time: { value: 0 }, night: { value: 0 } };
  ENV.time.value = 0;
  // the time of day's night factor (world/sky.js apply sets it in the page): the vehicles' headlamp beams (sim/carlights.js,
  // which the traffic model updates) and lamp states follow it, as in the page
  if (ENV.night) ENV.night.value = night;
  const W = {
    scene, streamer, traffic, peds, rig, camera, cam, trains, ENV, kinds, fleetKinds: names, seed,
    frame: 0, simTime: 0,
    // the API's camera and hooks (core/api/session.mjs): an ApiCam in place of the shot's PathCam, and src/api/bridge.js's
    // preStep / postStep around the sims, where main.js engine.onFrame calls them
    controller: null, hooks: null,
    bootMs: performance.now() - t0,
    prof: { stream: 0, traffic: 0, peds: 0 },
    // one fixed step in the page's order; the streamer loads synchronously (a step never sees a half-loaded ring)
    async step(dt) {
      ENV.time.value += dt;   // world/sky.js update, first in the page's frame
      if (W.hooks && W.hooks.pre) W.hooks.pre(dt);
      const p = W.controller ? W.controller.update(dt) : cam.path ? cam.update(dt) : { x: camera.position.x, z: camera.position.z };
      spawnGuard.update(camera);
      viewGuard.update(camera);
      let a = performance.now();
      await streamer.update(p.x, p.z);
      let b = performance.now(); W.prof.stream += b - a; a = b;
      traffic.update(dt, p.x, p.z);
      b = performance.now(); W.prof.traffic += b - a; a = b;
      if (peds) peds.update(dt, p.x, p.z);
      W.prof.peds += performance.now() - a;
      if (W.hooks && W.hooks.post) W.hooks.post(dt);
      W.frame++; W.simTime += dt;
      return p;
    },
    setSpawnGuard(on) { spawnGuard.on = !!on; spawnGuard.update(camera); },
    // the page's __SET_PATH as sim/trains.js wraps it: the camera path (a player take's body back in the sims, main.js
    // PathCam.setPath with src/game/control.js createReplay), then the trains' timetable phased for this path
    setPath(P) {
      cam.setPath(P);
      if (P.takeData) {
        if (!W.replay) {
          const fr = new THREE.Frustum(), pv = new THREE.Matrix4(), sph = new THREE.Sphere();
          const engine = { camera, inView(x, y, z, r = 1) { camera.updateMatrixWorld(); pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); fr.setFromProjectionMatrix(pv); sph.center.set(x, y, z); sph.radius = r; return fr.intersectsSphere(sph); } };
          W.replay = createReplay({ engine, streamer, traffic, peds });
        }
        W.replay.start(P.takeData);
        cam.onTake = (f, dt, hold) => W.replay.place(f, dt, hold);
      } else if (W.replay && W.replay.take) { W.replay.stop(); cam.onTake = null; }
      return trains ? trains.cue(P) : null;
    },
    resetPeds() { if (peds) peds.reset(); },
    // signal heads: every signalised junction of the loaded tiles with its two axes' states (sim/signals.js, the shared
    // 40 s clock on traffic.time; the north-south axis is servesEW = false)
    signals() {
      const t = traffic.time, ns = signalState(t, false), ew = signalState(t, true), out = [];
      for (const k of traffic.signals.keys()) {
        const [x, z] = k.split('_').map(Number);
        out.push({ key: k, x, z, ns, ew });
      }
      return out;
    },
    fetches: shimStats.fetches,
  };
  // the simulation's own random stream starts here: three.js draws Math.random for every object's uuid, so the number of
  // meshes, materials and geometries the constructors above happened to create must not shift what the models draw
  // (the take reseeds again once the ring is loaded, tools/core/take.mjs)
  W.reseed = (tag = 0) => seedRandom((Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(tag + 1, 0x85ebca6b)) >>> 0);
  W.reseed(0);
  return W;
}
