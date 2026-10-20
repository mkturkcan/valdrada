// ==== R1B tiers (client/src/lod/tiers.js, client/public/data/tiers.json): ?tier=low|medium|high|cinematic expands to its
// flags before any module reads the URL; this import stays first
import './lod/tiers.js';
// ==== /R1B
import * as THREE from 'three';
// PF25 boot timeline (loading-time work, 2026-09-25): window.__BOOT = [[s since navigation start, stage], ...]
const BOOT = []; const bootMark = (stage) => { BOOT.push([+(performance.now() / 1000).toFixed(2), stage]); };
if (typeof window !== 'undefined') window.__BOOT = BOOT;
let bootLoopUp = false;   // PC26: the real frame loop is installed (the precompile pump may release the picture)
bootMark('main.js evaluated');
import { spawnGuard, viewGuard } from './sim/spawnGuard.js';
import { Engine, nb37Hold, FP37 } from './core/engine.js';
import { Sky } from './world/sky.js';
import { Streamer } from './world/streamer.js';
import { makeFacadeMaterial, makeTileFacadeMaterial, makeGroundMaterial, makeFarMaterial, makeWaterMaterial, ENV, initGTEX, initCityAO, CP32R_MASK } from './world/materials.js';
import { NycDresser } from './world/nycDress.js';
import { TowerKit, TW_ON } from './world/towerKit.js';   // TW: the tower kit (towers lane)
import { Instancer } from './city/instancer.js';
import { COLLIDERS } from './city/colliders.js';
import { initAudio } from './world/audio.js';
import { project } from './shared/geo.js';
// CL24: must load before the first shader compiles (it patches three's light chunks and ShaderLib uniforms)
import { CityLamps } from './world/cityLamps.js';
import { areasReady } from './city/areas.js';
import { compileSafe } from './core/compileSafe.js';
const cityLamps = new CityLamps();
if (typeof window !== 'undefined') window.__LAMPS = cityLamps;

const Q = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('app'));
initGTEX(engine.renderer); // async KTX2 texture bank (needs renderer for detectSupport)
initCityAO(); // baked city-scale sky occlusion field
const sky = new Sky(engine);

// spawn points (lon,lat)
export const SPAWNS = {
  columbia: [...project(-73.9620, 40.8067), 'Morningside Heights'],
  harlem: [...project(-73.94875, 40.80915), 'Harlem, 125th St'],
  timessq: [...project(-73.9866, 40.7575), 'Times Square'],
  esb: [...project(-73.9853, 40.7480), 'Midtown, 34th St'],
  bkbridge: [...project(-74.0040, 40.7115), 'Civic Center'],
  wallst: [...project(-74.0110, 40.7070), 'Financial District'],
};

const facadeMat = makeFacadeMaterial();
const groundMat = makeGroundMaterial();
const farMat = makeFarMaterial();
if (Q.has('nofar')) farMat.visible = false;
const instancer = new Instancer(engine.scene);
instancer.attach(engine); // shadow-pass hooks for the culled caster sets
// phase-2 prop companions (bikes at racks, trash bags, work zones): the
// claim/release hook must install BEFORE tiles start claiming furniture
import('./city/props.js').then((m) => m.placeProps(instancer)).catch((e) => console.warn('prop companions unavailable', e));

// landmarks loaded dynamically (optional module; must not break boot). A plain dynamic import, so the production build
// bundles it: the old import(new URL(...).href) form was copied as a raw, unbundled asset whose bare 'three' import no
// browser can resolve — every built package ran without its landmarks (found by the release test, 2026-09-24).
let landmarkFn = () => null;
const landmarksReady = import('./city/landmarks.js')
  .then(async (m) => {
    await m.preloadMeshes?.(); // optional NYC 3D Model massing (?lm3d=1)
    landmarkFn = (key, ctx) => m.buildLandmark(key, ctx);
  })
  .catch((e) => console.warn('landmarks unavailable', e));
// AR33 (2026-09-30): the area parts (city/areas.js) load as separate modules; a tile assembled before they land would be
// built without them and never rebuilt, so tile assembly also waits for them (3 min cap, then it opens without them)
let areasIn = false;
const areasGate = Promise.race([areasReady.then(() => { areasIn = true; }), new Promise((r) => setTimeout(() => { if (!areasIn) console.warn('[boot] area parts still loading after 180 s — continuing without them'); r(); }, 180000))]);

const signalReg = [];
// NYC building dresser: rebuilds the buildings nearest the camera on their real
// footprints with the procedural generator's kit (subproject at ../src, alias
// @nyc) — punched brick walls, recessed windows with glass and rooms, sills,
// lintels, cornices, storefronts, doors, roofs. ?nodress=1 disables it.
const dresser = Q.has('nodress') ? null : new NycDresser(engine.scene, { night: () => ENV.night.value });
const towerKit = TW_ON ? new TowerKit(engine.scene) : null;   // TW: towers over 45 m rebuilt near the camera (world/towerKit.js)
window.__TW = () => (towerKit ? towerKit.report() : null);   // TW
window.__TW_KIT = towerKit;   // TW: the cell baker's handle (cells/bakeLib.js dressRegion)
const streamer = new Streamer(engine.scene, {
  facadeMat, groundMat, farMat, instancer, signalReg,
  makeFacadeMat: dresser || towerKit ? makeTileFacadeMaterial : null,   // TW: the tower kit hides walls through the same mask
  landmarks: (key, ctx) => {
    const r = landmarkFn(key, ctx);
    if (Q.has('lmdebug')) console.warn('LM', key, r ? 'built' : 'NULL');
    return r;
  },
});

engine.groundAt = (x, z) => { try { return streamer.terrainAt ? streamer.terrainAt(x, z) : null; } catch { return null; } };   // DP37 (core/engine.js): the ground under the lens caps its near plane
import { HeroFacades } from './world/heroFacades.js';
import { sweepFrame } from './core/shadowSweep.js';   // SV29: the shadow sets' view test
const RS35 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rs35') === '0');   // RS35: decks left to the view's height
const heroes = new HeroFacades(engine.scene);
// ?hero=0 disables the hero trim ring entirely (attribution renders, lead r8)
if (new URLSearchParams(location.search).get('hero') === '0') heroes.skip = () => true;
else if (dresser || towerKit) heroes.skip = (recKey) => !!(dresser && dresser.owns(recKey)) || !!(towerKit && towerKit.owns(recKey));   // TW: and the kit's towers
streamer.onTile(
  (key, data) => { heroes.setTile(key, data.bldgs || []); dresser?.setTile(key, data); towerKit?.setTile(key, data); engine.invalidateFarShadow(); },   // TW: towerKit
  (key) => { heroes.removeTile(key); dresser?.removeTile(key); towerKit?.removeTile(key); engine.invalidateFarShadow(); },
);

// water
{
  const g = new THREE.PlaneGeometry(46000, 46000, 1, 1);
  g.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(g, makeWaterMaterial());
  water.position.y = 0.0;
  // 138 km across: the five boroughs run from x -24.4 to +22.9 km and z -14.7 to +32.6 km (Staten Island's south shore
  // at z 32 km lay outside the 46 km plane's +-23 km); the shader works in world space, so the scale changes no pattern.
  // The 46000 width stays the plane's tag (lod/manager.js widens it again for ?lod16=1).
  water.scale.set(3, 1, 3);
  // opaque, depth-tested: draw AFTER the city so hidden water pixels are
  // rejected instead of shaded first and overwritten (was renderOrder -3)
  water.renderOrder = 1;
  engine.scene.add(water);
}

// ---------- camera control: fly (debug/shots) or player
let controller = null;
const spawnName = Q.get('spawn') || 'columbia';
const spawn = SPAWNS[spawnName] || SPAWNS.columbia;
let px = Number(Q.get('x') ?? spawn[0]);
let pz = Number(Q.get('z') ?? spawn[1]);
let py = Number(Q.get('y') ?? 80);

class FlyCam {
  constructor() {
    this.pos = new THREE.Vector3(px, py, pz);
    this.relY = Q.has('rel') ? py : null; // y relative to terrain, applied once tiles exist
    this.yaw = Number(Q.get('yaw') ?? 0);
    this.pitch = Number(Q.get('pitch') ?? -0.25);
    this.speed = 60;
    this.keys = {};
    addEventListener('keydown', (e) => (this.keys[e.code] = true));
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    // lock only on CANVAS clicks: clicks in the graphics panel (lil-gui) bubble
    // to body and were re-grabbing the cursor mid-adjustment
    engine.renderer.domElement.addEventListener('click', () => engine.renderer.domElement.requestPointerLock?.());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) { this.yaw -= e.movementX * 0.0022; this.pitch -= e.movementY * 0.0022; this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch)); }
    });
  }
  update(dt) {
    if (this.relY !== null) {
      const g = streamer.terrainAt(this.pos.x, this.pos.z);
      if (g !== null) {
        // CP32R: Central Park's relief takes its ground below the river plane's clamp (the Lake's banks at -3 m): a height
        // there is over the park's own ground (the park's rectangle, as world/materials.js masks the river plane)
        const qx = this.pos.x - 447.2, qz = this.pos.z - 82.2;
        const park = CP32R_MASK && Math.abs(qx * 0.4848 - qz * 0.8746) < 2084 && Math.abs(qx * 0.8746 + qz * 0.4848) < 451;
        // RS34 (QA Q06, 2026-10-02): where the terrain grid dips under the street's own sections (Lexington: terrainAt
        // 1.15-1.91 under a roadway at ~3.4) a height over terrainAt sank the lens; take the section under the camera,
        // less its usual rise over the base plane (road 0.145, walk 0.28), when that is higher. Flat ground: unchanged.
        const si = !park && streamer.surfaceInfoAt ? streamer.surfaceInfoAt(this.pos.x, this.pos.z, 0.5) : null;
        // RS35 (QA Q60, 2026-10-02): only a section within 3 m of the grid counts (a dip like Lexington's); a deck over the
        // street (the Henry Hudson Parkway at 12th Avenue, ~7 m up) is left to the view's height, as the film's PathCam does,
        // so views and teaser keys under a deck stand where they did before RS34 (`?rs35=0`: decks count again)
        const sy = si && Number.isFinite(si.y) ? si.y - (si.road ? 0.145 : 0.28) : null;
        const gs = sy !== null && (sy - g <= 3 || !RS35) ? Math.max(g, sy) : g;
        this.pos.y = (park ? g : Math.max(gs, 0.5)) + this.relY;
        this.relY = null;
      }
    }
    // while setting up a shot, continuously rise out of any streamed-in geometry
    if (isShot && !window.__READY) {
      for (let i = 0; i < 6; i++) {
        const res = COLLIDERS.resolve({ x: this.pos.x, y: this.pos.y, z: this.pos.z }, 0.4, 0.6);
        if (!res.wall) break;
        this.pos.y += 3.5;
      }
    }
    const d = new THREE.Vector3();
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(-f.z, 0, f.x).normalize();
    if (this.keys.KeyW) d.add(f);
    if (this.keys.KeyS) d.sub(f);
    if (this.keys.KeyD) d.add(r);
    if (this.keys.KeyA) d.sub(r);
    if (this.keys.KeyE || this.keys.Space) d.y += 1;
    if (this.keys.KeyQ) d.y -= 1;
    const sp = this.keys.ShiftLeft ? this.speed * 4 : this.speed;
    this.pos.addScaledVector(d.normalize(), sp * dt);
    engine.camera.position.copy(this.pos);
    engine.camera.rotation.set(0, 0, 0);
    engine.camera.rotateY(this.yaw);
    engine.camera.rotateX(this.pitch);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
}

// Valdrada default controller: a flying DRONE (WASD + mouse look, Shift
// rises, Ctrl descends, momentum-smoothed). Tab drops into a first-person
// ground view and back. The graphics editor lives on G.
class Explorer {
  constructor() {
    this.mode = 'drone';
    this.pos = new THREE.Vector3(px, py, pz);
    this.vel = new THREE.Vector3();
    this.yaw = Number(Q.get('yaw') ?? 0);
    this.pitch = Number(Q.get('pitch') ?? -0.25);
    this.keys = {};
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'Tab') { e.preventDefault(); this.toggle(); }
    });
    addEventListener('keyup', (e) => (this.keys[e.code] = false));
    // lock only on CANVAS clicks: clicks in the graphics panel (lil-gui) bubble
    // to body and were re-grabbing the cursor mid-adjustment
    engine.renderer.domElement.addEventListener('click', () => engine.renderer.domElement.requestPointerLock?.());
    addEventListener('mousemove', (e) => {
      if (document.pointerLockElement) {
        this.yaw -= e.movementX * 0.0022;
        this.pitch -= e.movementY * 0.0022;
        this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch));
      }
    });
  }
  toggle() {
    if (this.mode === 'drone') {
      this.mode = 'walk';
      const g = streamer.terrainAt(this.pos.x, this.pos.z);
      if (g !== null && isFinite(g)) this.pos.y = Math.max(g, 0.5) + 1.7;
      this.vel.set(0, 0, 0);
      this.pitch = Math.max(-1.2, Math.min(1.2, this.pitch));
      flash('FIRST PERSON (TAB FOR DRONE)');
    } else {
      this.mode = 'drone';
      this.pos.y += 14; // lift off
      flash('DRONE (SHIFT UP, CTRL DOWN)');
    }
  }
  update(dt) {
    const f = new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    const r = new THREE.Vector3(-f.z, 0, f.x).normalize();
    const d = new THREE.Vector3();
    if (this.mode === 'drone') {
      if (this.keys.KeyW) d.add(f);
      if (this.keys.KeyS) d.sub(f);
      if (this.keys.KeyD) d.add(r);
      if (this.keys.KeyA) d.sub(r);
      if (this.keys.ShiftLeft || this.keys.ShiftRight) d.y += 1;
      if (this.keys.ControlLeft || this.keys.ControlRight) d.y -= 1;
      if (d.lengthSq() > 0) d.normalize();
      this.vel.lerp(d.multiplyScalar(52), Math.min(1, dt * 4.5)); // drone momentum
      this.pos.addScaledVector(this.vel, dt);
      const g = streamer.terrainAt(this.pos.x, this.pos.z);
      if (g !== null && isFinite(g)) this.pos.y = Math.max(this.pos.y, Math.max(g, 0.3) + 1.2); // never dive underground
    } else {
      // first-person: yaw-plane movement glued to the terrain, walls solid
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      if (this.keys.KeyW) { d.x += fx; d.z += fz; }
      if (this.keys.KeyS) { d.x -= fx; d.z -= fz; }
      if (this.keys.KeyD) { d.x += -fz; d.z += fx; }
      if (this.keys.KeyA) { d.x -= -fz; d.z -= fx; }
      const sp = this.keys.ShiftLeft || this.keys.ShiftRight ? 9 : 4.5;
      if (d.lengthSq() > 0) d.normalize();
      const nx = this.pos.x + d.x * sp * dt, nz = this.pos.z + d.z * sp * dt;
      const res = COLLIDERS.resolve({ x: nx, y: this.pos.y, z: nz }, 0.45, 1.65);
      if (!res.wall) { this.pos.x = nx; this.pos.z = nz; }
      const g = streamer.terrainAt(this.pos.x, this.pos.z);
      if (g !== null && isFinite(g)) {
        const eye = Math.max(g, 0.5) + 1.7;
        this.pos.y += (eye - this.pos.y) * Math.min(1, dt * 12);
      }
    }
    engine.camera.position.copy(this.pos);
    engine.camera.rotation.set(0, 0, 0);
    engine.camera.rotateY(this.yaw);
    engine.camera.rotateX(this.pitch);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
}

// ---------------------------------------------------------------------------
// TRAILER RECORDER camera (?record=1). Plays a keyframed spline authored in
// tools/trailer/paths.json, which the recorder injects with window.__SET_PATH.
// Keys are [lon, lat, alt] so a path can be written from a map; alt is metres
// above the terrain under that point unless the path sets "abs": true.
// ---------------------------------------------------------------------------
// PG32 (owner 2026-09-29 on mLowAerial: "serious shimmering due to shadow jittering"): the path camera followed the
// terrain through a low-pass that moved it a quarter of the way on every CALL, and a film frame is sixteen calls (the
// step and fifteen frozen accumulation samples, AC26). Where the ground under the camera changed during the step, the
// samples of one frame were taken from creeping heights and the accumulation restarted part way through them: from
// frame 81 of mLowAerial the sunlit roofs came out 3 % dark on every second or third frame (flat roofs only, the walls
// and the sky unchanged; gone with ?accum=0, unchanged with ?ao=0 and ?sc31=0). The low-pass now runs on time: a frozen
// sample (dt = 0) holds the camera where the step put it. `?pg32=0` restores.
const PG32 = Q.get('pg32') !== '0';
class PathCam {
  constructor() {
    this.pos = new THREE.Vector3(px, py, pz);
    this.yaw = Number(Q.get('yaw') ?? 0);
    this.pitch = Number(Q.get('pitch') ?? -0.25);
    this.t = 0;
    this.path = null;
    this.ground = null;
    this.lookGround = null;
  }
  // path: { duration, ease, abs, keys: [{ p:[lon,lat,alt], look:[lon,lat,alt] }] }
  setPath(path) {
    this.path = path;
    this.t = 0;
    this.ground = null; this.lookGround = null;
    // FL26: a path may carry its own lens (fov: vertical degrees); a path without one gets the page's lens back
    const cam = engine.camera;
    if (this.fov0 === undefined) this.fov0 = cam.fov;
    const fov = path.fov || this.fov0;
    if (Math.abs(cam.fov - fov) > 1e-4) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const pts = path.keys.map((k) => { const [x, z] = project(k.p[0], k.p[1]); return new THREE.Vector3(x, k.p[2], z); });
    const lks = path.keys.map((k) => {
      const src = k.look || k.p;
      const [x, z] = project(src[0], src[1]);
      return new THREE.Vector3(x, k.look ? k.look[2] : k.p[2], z);
    });
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', path.tension ?? 0.5);
    this.lookCurve = new THREE.CatmullRomCurve3(lks, false, 'catmullrom', path.tension ?? 0.5);
    this.hasLook = path.keys.some((k) => !!k.look);
    // NB37 (core/engine.js): the take's height range; while recording the shadow boxes hold the extent of its top
    // FP37 (core/engine.js, the film policy): while recording, the take's path for every LOD that holds a form per take
    {
      let y0 = Infinity, y1 = -Infinity;
      const N = 64, pts = new Float64Array((N + 1) * 3);
      for (let i = 0; i <= N; i++) {
        const q = this.curve.getPointAt(i / N), g = path.abs ? 0 : streamer.terrainAt(q.x, q.z);
        const y = q.y + (Number.isFinite(g) ? g : 0);
        if (y < y0) y0 = y; if (y > y1) y1 = y;
        pts[i * 3] = q.x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = q.z;
      }
      engine.shadowHoldY = nb37Hold(y0, y1);
      if (FP37 && engine.recordMode) window.__FP37 = { v: ((window.__FP37 && window.__FP37.v) || 0) + 1, pts, y0, y1 };
    }
    // CONTROL: a player take (tools/ad/record.mjs / harvest.mjs pass its frames inline as takeData; takeHold: frame 0 only)
    this.take = null;
    const R = window.__PLAYREPLAY;
    if (path.takeData && R) { this.take = path.takeData; this.takeHold = !!path.takeHold; R.start(this.take); }
    else if (path.takeData) console.warn('[take] no replay: a take shot needs play=1 in its flags');
    else if (R && R.take) R.stop();
    return { keys: path.keys.length, duration: path.duration, len: +this.curve.getLength().toFixed(1), take: this.take ? this.take.frames : 0 };
  }
  // CONTROL: the take's frame at t (fractional, interpolated): the camera as recorded, the body put back in the sims
  takeStep(dt) {
    const T = this.take, cam = engine.camera;
    if (!this.takeHold) this.t += dt;
    const f = Math.min(T.frames - 1, Math.max(0, this.t * T.fps));
    const i = Math.floor(f), j = Math.min(T.frames - 1, i + 1), u = f - i, A = T.cam[i], B = T.cam[j];
    this.pos.set(A[0] + (B[0] - A[0]) * u, A[1] + (B[1] - A[1]) * u, A[2] + (B[2] - A[2]) * u);
    const qa = this._qa || (this._qa = new THREE.Quaternion()), qb = this._qb || (this._qb = new THREE.Quaternion());
    qa.set(A[3], A[4], A[5], A[6]); qb.set(B[3], B[4], B[5], B[6]); qa.slerp(qb, u);
    cam.position.copy(this.pos); cam.quaternion.copy(qa);
    const fov = A[7] + (B[7] - A[7]) * u;
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    const e = (this._te || (this._te = new THREE.Euler())).setFromQuaternion(qa, 'YXZ');
    this.yaw = e.y; this.pitch = e.x;
    window.__PLAYREPLAY?.place(f, dt, this.takeHold);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  // constant speed through the middle, quadratic ramps over the first/last
  // `f` of the run so the clip does not start or stop with a jolt
  static easeEnds(x, f) {
    if (f <= 0.001) return x;
    const norm = 1 - f;
    let a;
    if (x < f) a = (x * x) / (2 * f);
    else if (x > 1 - f) { const y = 1 - x; a = norm - (y * y) / (2 * f); }
    else a = x - f / 2;
    return a / norm;
  }
  groundAt(x, z, prev, dt) {
    const g = streamer.terrainAt(x, z);
    if (g === null || !isFinite(g)) return prev;
    if (prev === null) return g;
    // tile-seam low-pass; PG32: by time (0.25 a 30 fps frame, as before at one call a frame), so dt = 0 holds
    return prev + (g - prev) * (PG32 ? 1 - Math.pow(0.75, Math.max(0, dt) * 30) : 0.25);
  }
  update(dt) {
    if (this.take) return this.takeStep(dt);
    if (this.path) {
      this.t += this.hold ? 0 : dt * (this.speed ?? 1);   // LITE15: the showcase holds a path while it loads, plays it slower
      const dur = this.path.duration || 12;
      const u = PathCam.easeEnds(Math.min(1, Math.max(0, this.t / dur)), this.path.ease ?? 0.14);
      const p = this.curve.getPointAt(u);
      const l = this.lookCurve.getPointAt(Math.min(1, u + (this.path.lookAhead ?? 0)));
      if (!this.path.abs) {
        this.ground = this.groundAt(p.x, p.z, this.ground, dt);
        this.lookGround = this.groundAt(l.x, l.z, this.lookGround, dt);
      }
      this.pos.set(p.x, p.y + (this.path.abs ? 0 : (this.ground ?? 0)), p.z);
      const ly = l.y + (this.path.abs ? 0 : (this.lookGround ?? this.ground ?? 0));
      const dx = l.x - this.pos.x, dy = ly - this.pos.y, dz = l.z - this.pos.z;
      const hor = Math.hypot(dx, dz) || 1e-6;
      this.yaw = Math.atan2(-dx, -dz) + (this.hoverYaw || 0);
      this.pitch = Math.atan2(dy, hor) + (this.hoverPitch || 0);
    }
    engine.camera.position.copy(this.pos);
    engine.camera.rotation.set(0, 0, 0);
    engine.camera.rotateY(this.yaw);
    engine.camera.rotateX(this.pitch);
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z };
  }
  speedText() { return `path ${this.t.toFixed(1)}s`; }
}

// ---------------------------------------------------------------------------
// EXTERNAL API camera (?api=1). src/api/bridge.js owns it: `center` is the spectator's position, which is where the
// world streams; `pose` is what this frame renders (the spectator's view, or the primary camera sensor's).
// ---------------------------------------------------------------------------
class ApiCam {
  constructor() {
    this.center = new THREE.Vector3(px, py, pz);
    this.pose = null;   // { p: THREE.Vector3, q: THREE.Quaternion, fov (vertical, deg), aspect (w / h) }
    this.t = 0;
  }
  apply(pose) {
    const cam = engine.camera;
    cam.position.copy(pose.p);
    cam.quaternion.copy(pose.q);
    let proj = false;
    if (pose.fov && Math.abs(cam.fov - pose.fov) > 1e-4) { cam.fov = pose.fov; proj = true; }
    // a label camera whose image_size is not the window's shape renders with its own aspect
    if (pose.aspect && Math.abs(cam.aspect - pose.aspect) > 1e-6) { cam.aspect = pose.aspect; proj = true; }
    if (proj) cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
  }
  update(dt) {
    this.t += dt;
    if (this.pose) this.apply(this.pose);
    return { x: this.center.x, y: this.center.y, z: this.center.z };
  }
  speedText() { return `api ${this.t.toFixed(1)}s`; }
}

const hud = {
  stats: document.getElementById('stats'),
  hood: document.getElementById('hood'),
  msg: document.getElementById('msg'),
  loading: document.getElementById('loading'),
  bar: document.querySelector('#bar div'),
};

const isShot = Q.has('shot');
// ?api=1: driven by an external client (server/ + PythonAPI/, protocol in docs/api/protocol.md). It runs the record
// mode's fixed-step simulation: the world only advances when the API ticks it (or free-runs in asynchronous mode).
const isApi = Q.has('api');
const isRecord = Q.has('record') || isApi;        // fixed-timestep trailer capture
const isFly = Q.has('fly') || (isShot && !isRecord && !Q.has('play'));
if (isShot) { hud.loading.style.display = 'none'; document.getElementById('help').style.display = 'none'; }
// clean plate for captures: ?hud=0 (implied by ?record=1) hides the whole
// overlay — crosshair, place name, stats, tether dots, help and toasts
if (isRecord || Q.get('hud') === '0') document.getElementById('hud').style.display = 'none';

async function boot() {
  bootMark('boot start');
  // PC26 SHADER PRECOMPILE (owner 2026-09-25: loading time). A boot CPU profile put 243 of 300 s of main-thread time in
  // three's WebGLProgram onFirstUse: every new program is linked on the frame that first draws it and its uniforms read
  // at once, which waits for THAT program's compile, so ~280 ANGLE/D3D11 compiles ran one after another. With
  // KHR_parallel_shader_compile, renderer.compileAsync() submits every program in the scene first and polls them without
  // blocking, so the driver compiles them side by side (about 5x faster measured on this machine). The picture is held
  // (nothing is drawn under the loading screen anyway) while passes repeat as the city, fleet and crowd arrive; it is
  // released once the frame loop runs, the near ring is in, and two passes in a row find nothing new. `?pc26=0` off.
  if (Q.get('pc26') !== '0' && engine.renderer.extensions.has('KHR_parallel_shader_compile')) {
    const R = engine.renderer, t0 = performance.now();
    engine.holdDraw = true;
    (async () => {
      let passes = 0, loopAt = 0;
      try {
        // release: the frame loop runs, the near ring is in and a pass found nothing new, or 30 s after the frame loop
        // started, or 3 minutes after boot. A program first seen later compiles on first use, as it always did.
        while (performance.now() - t0 < 180000) {
          // PC35 (LOOK, AR34 wave 2): at dusk and night the first pass waits for the sims. The vehicle light pool
          // (sim/carlights.js, PF34) joins the scene with them, lit, and three keys every lit program by the scene's light
          // count, so each lit program a pass compiled before the pool was compiled again with the pool's lights on first draw.
          // By day the pool starts hidden and changes nothing. `?pc35=0`: passes from boot start, as before.
          if (Q.get('pc35') !== '0' && (ENV.night.value >= 0.06 || /^(night|dusk)$/.test(Q.get('time') || '')) && !BOOT.some((b) => b[1] === 'sims') && performance.now() - t0 < 90000) {
            await new Promise((r) => setTimeout(r, 500));
            continue;
          }
          const n0 = R.info.programs.length;
          await compileSafe(R, engine.scene, engine.camera, 120000);   // SPACE r2: three's own poll throws on a material disposed mid-pass
          passes++;
          const made = R.info.programs.length - n0;
          if (bootLoopUp && !loopAt) loopAt = performance.now();
          if (bootLoopUp && ((made <= 0 && streamer.tiles.size > 4 && streamer.outstanding === 0) || performance.now() - loopAt > 30000)) break;
          await new Promise((r) => setTimeout(r, 1000));   // a pass walks every material: leave the main thread to the city
        }
      } catch (e) { console.warn('[pc26] precompile stopped', e); }
      engine.holdDraw = false;
      engine.resetTemporal?.();   // the camera moved while nothing was drawn: no motion blur or TAA from the old view
      bootMark(`precompiled: ${R.info.programs.length} programs, ${passes} passes`);
    })();
  }
  // PF25 LOADING (owner 2026-09-25: "improve the loading time"). Boot used to be one serial chain: bridges, elevated rail,
  // campus, the landmarks module, the vehicle fleet (tens of MB), the pedestrian bank (~80 MB) and the weather module, and
  // only THEN the frame loop that streams tiles. Now the two big asset banks start downloading at once, in parallel with
  // everything else, and tiles start fetching the moment the manifest is in (assembled once the landmarks module has
  // landed, so no tile is built without its landmark). `?pf25=0` restores the serial boot.
  const PF25 = Q.get('pf25') !== '0';
  const wantSims = !Q.has('nosim');
  const fleetP = PF25 && wantSims && Q.get('fleet24') !== '0'
    ? import('./sim/fleet24.js').then((m) => m.loadFleet24(engine.renderer)).catch((e) => { console.warn('fleet24 unavailable, legacy fleet', e); return null; }) : null;
  const crowdP = PF25 && wantSims && !Q.has('nopeds') && Q.get('crowd') !== '0'
    ? import('./sim/crowd.js').then((m) => m.createCrowd(engine.scene, engine, 700)).catch((e) => { console.warn('crowd unavailable, mannequins', e); return null; }) : null;
  const lmWaitMs0 = Math.max(1, parseInt(Q.get('lmwait') || '30', 10) || 30) * 1000;
  await streamer.init('tiles');
  bootMark('tile manifest');
  if (PF25) {
    streamer.holdAssembly = true;
    Promise.all([Promise.race([landmarksReady, new Promise((r) => setTimeout(r, lmWaitMs0))]), areasGate]).then(() => { streamer.holdAssembly = false; bootMark('tile assembly open'); });
    engine.onFrame = () => streamer.update(px, pz);   // provisional pump; the real frame loop replaces it below
  }
  if (Q.get('time')) sky.apply(Q.get('time'));
  // bridges
  if (Q.get('bridges') !== '0') try {   // ?bridges=0: diagnostic (2026-09-22, the wbBroadway void half)
    const { buildBridges } = await import('./city/bridgeKit.js');
    buildBridges(streamer.bridges, engine.scene, streamer);
  } catch (e) { console.warn('bridges unavailable', e); }
  // LB39: the Statue of Liberty, her pedestal and Fort Wood (city/liberty.js), resident with their level chain like the
  // bridges, so she is drawn from anywhere in the harbour; ?liberty=0 leaves her out
  if (Q.get('liberty') !== '0') try {
    const { buildLiberty } = await import('./city/liberty.js');
    buildLiberty(engine.scene, { instancer });
  } catch (e) { console.warn('the Statue of Liberty unavailable', e); }
  // EL14: elevated rail (J/M/Z over Broadway, Myrtle Av el, the IRT 125th St viaduct) — data/elevated.json from
  // tools/pipeline/elevated.mjs; ?el14=0 leaves it out
  try {
    const { buildElevated } = await import('./city/elevatedKit.js');
    await buildElevated(engine.scene);
  } catch (e) { console.warn('elevated rail unavailable', e); }
  // Columbia campus detail kit (steps/walls/monuments/lamps; data from compiler)
  try {
    const { buildCampus } = await import('./city/campus.js');
    buildCampus(engine.scene);
  } catch (e) { console.warn('campus unavailable', e); }
  bootMark('bridges, elevated, campus');
  // never let the (dynamic, optional) landmarks module hold boot hostage:
  // under load Vite took 25 min to serve it and the sims, peds and streamer pump
  // behind this await never started (critic round 2). 30 s cap, then proceed —
  // landmarkFn stays a null builder until the module lands.
  // ?lmwait=<s> raises the cap for harness renders (bshot passes 150): a tile assembled before the module lands never gets
  // its decorate landmark, which is how Whittier Hall lost its roof in the final_v17 plates (2026-09-15).
  const lmWaitMs = Math.max(1, parseInt(Q.get('lmwait') || '30', 10) || 30) * 1000;
  // (the timer is never cleared: warn only if the module really is still out — it used to fire on every page that lived past lmwait)
  let lmIn = false; landmarksReady.then(() => { lmIn = true; });
  await Promise.race([landmarksReady, new Promise((r) => setTimeout(() => { if (!lmIn) console.warn(`[boot] landmarks module still loading after ${lmWaitMs / 1000} s — continuing without it`); r(); }, lmWaitMs))]);
  await areasGate;

  bootMark('landmarks module');
  // sims
  // ==== R1D (CORE, docs/notes/arch-r1-d.md): ?replay=<take folder | tracks.atrk URL>: a take of the headless core places every
  // actor through the page's own drawing (src/replay/coreReplay.js); without ?replay nothing here runs
  const R1D_REPLAY = Q.has('replay') ? await import('./replay/coreReplay.js').then((m) => m.loadCoreReplay(Q.get('replay'))).catch((e) => { console.error('[replay] the take did not load', e); return null; }) : null;
  if (R1D_REPLAY) window.__REPLAY = R1D_REPLAY;
  // ==== R1D end
  let traffic = null, peds = null, signals = null;
  if (!Q.has('nosim')) {
    try {
      const { Traffic } = await import('./sim/traffic.js');
      let fleet = null, fleet24 = null;
      // PV2 (docs/notes/peds-veh-v2.md): the CARLA 0.10 2024 fleet — textured, three LODs, wheels, lamps.
      // ?fleet24=0 restores the 0.9.15 fleet below.
      if (Q.get('fleet24') !== '0') {
        try {
          if (fleetP) fleet24 = await fleetP;
          else { const { loadFleet24 } = await import('./sim/fleet24.js'); fleet24 = await loadFleet24(engine.renderer); }
          bootMark('fleet24 loaded');
          if (fleet24) fleet = fleet24.trafficFleet;
        } catch (e) { console.warn('fleet24 unavailable, legacy fleet', e); fleet24 = null; }
      }
      if (!fleet) {
        try {
          const { loadCarlaFleet } = await import('./sim/vehicles.js');
          fleet = await loadCarlaFleet();
        } catch (e) { console.warn('CARLA fleet unavailable, placeholder cars', e); }
      }
      traffic = new Traffic(engine.scene, streamer, fleet);
      window.__TRAFFIC = traffic; // harness access (fleet bounds / audits via bshot --eval)
      window.__STREAMER = streamer; // harness access (surfaceInfoAt audits: is every car on asphalt?)
      traffic.camera = engine.camera;
      // ==== R1D (CORE): ?replay: the take's vehicles in place of the traffic model's step (before the fleet's renderer wraps it)
      if (R1D_REPLAY) R1D_REPLAY.attachTraffic(traffic);
      // ==== R1D end
      // culled draw sets for every vehicle pool (view frustum + near shadow box)
      // CL24: the fleet24 lamp lenses are emissive (HDR 7 head, 1.6/6 tail), so carlights draws no near sprites for them
      if (fleet24) { try { fleet24.install(traffic, engine); if (traffic.lights) traffic.lights.emissiveLamps = true; } catch (e) { console.warn('fleet24 renderer failed', e); } }
      else { try { const { installVehicleCulling } = await import('./sim/vehicleCull.js'); installVehicleCulling(traffic, engine); } catch (e) { console.warn('vehicle culling unavailable', e); } }
      if (fleet && Q.has('fleet')) import('./sim/fleetShowroom.js').then((m) => m.installFleetShowroom(traffic, fleet, streamer, Q)).catch((e) => console.warn('fleet showroom unavailable', e));
      if (fleet && Q.has('fleettest')) {
        // debug lineup: every fleet model parked in a row at the camera spawn
        // (?fleettest=1 with x/z params) — deterministic door/orient checks
        const placeFleet = () => {
          const t0 = streamer.terrainAt(px, pz);
          if (t0 == null || !isFinite(t0)) { setTimeout(placeFleet, 500); return; } // tiles not in yet
          const keys = Object.keys(fleet).filter((k) => !k.startsWith('__'));
          keys.forEach((k, i) => {
            const f = fleet[k];
            const gx = px + (i % 8) * 7 - 24, gz = pz + (Math.floor(i / 8) - 0.5) * 14;
            const gy = streamer.terrainAt(gx, gz) ?? t0;
            const m1 = new THREE.Mesh(f.paint, new THREE.MeshStandardMaterial({ color: 0xb03028, roughness: 0.35, metalness: 0.6 }));
            const m2 = new THREE.Mesh(f.dark, new THREE.MeshStandardMaterial({ color: 0x1a1c1e, roughness: 0.6, metalness: 0.25 }));
            for (const m of [m1, m2]) { m.position.set(gx, gy, gz); m.castShadow = m.receiveShadow = true; engine.scene.add(m); }
          });
          // a hooked-claim host too: rack + companion bike land at the spawn
          instancer.claim('bikeRack', px + 10, t0, pz, 0.5);
          instancer.claim('bikeRack', px + 11.6, t0, pz + 1.4, 0.5);
          instancer.flush();
          console.log('[fleettest] placed', keys.join(' '));
        };
        placeFleet();
      }
      // ?nopeds=1 keeps traffic and signals but no walkers (the ad video shows pedestrians as "coming soon")
      if (!Q.has('nopeds')) {
        // PV2: photoreal crowd (CARLA 0.10 walkers, GPU-skinned); ?crowd=0 keeps the procedural mannequins
        let rig = null;
        if (Q.get('crowd') !== '0') {
          try {
            if (crowdP) rig = await crowdP;
            else { const { createCrowd } = await import('./sim/crowd.js'); rig = await createCrowd(engine.scene, engine, 700); }
            bootMark('crowd loaded');
          }
          catch (e) { console.warn('crowd unavailable, mannequins', e); rig = null; }
        }
        const { Peds } = await import('./sim/peds.js');
        peds = new Peds(engine.scene, streamer, traffic, rig);
        peds.lensAt = engine.camera.position;   // LW26: walkers keep clear of a lens at walking height
        // ==== R1D (CORE): ?replay: the take's walkers in place of the walker model's step
        if (R1D_REPLAY) R1D_REPLAY.attachPeds(peds);
        // ==== R1D end
      }
      const { SignalController } = await import('./sim/signals.js');
      signals = new SignalController(instancer, signalReg, traffic);
    } catch (e) { console.warn('sims unavailable', e); }
  }

  bootMark('sims');
  // PLAY takes in record mode (CONTROL): a shot whose flags hold play=1 can carry a player take (PathCam.setPath takeData);
  // the replay puts the player's walker or car back in the sims frame by frame (src/game/control.js createReplay)
  if (isRecord && !isApi && Q.has('play')) {
    try { const { createReplay } = await import('./game/control.js'); window.__PLAYREPLAY = createReplay({ engine, streamer, traffic, peds }); }
    catch (e) { console.warn('take replay unavailable', e); }
  }
  if (isApi) {
    controller = new ApiCam();           // src/api/bridge.js sets its pose and streaming centre
  } else if (isRecord && Q.has('playrun')) {
    // CONTROL: the play controller on the recorder's fixed step (?record=1&playrun=walk|drive): scripted runs and the
    // demo captures (tools/play/play_run.mjs) step it with window.__advance like any take
    const { PlayController } = await import('./game/control.js');
    controller = new PlayController({ engine, streamer, traffic, peds, sky, flash, noDownload: true }, {
      x: px, y: py, z: pz, yaw: Number(Q.get('yaw') ?? 0), mode: Q.get('playrun') === 'drive' ? 'drive' : 'walk',
      kind: Q.get('car'), pv: Q.has('pv') ? Number(Q.get('pv')) : undefined,
    });
    window.__PLAY = controller;
  } else if (isRecord || Q.has('showcase')) {
    controller = new PathCam();          // window.__SET_PATH installs the spline; LITE15: the showcase's scenes
  } else if (isFly) {
    controller = new FlyCam();
  } else if (Q.get('play') === 'tether') {
    // legacy grapple character (the original TETHER game mode)
    try {
      const { Player } = await import('./game/player.js');   // plain import: see the landmarks note above
      controller = new Player(engine, streamer, sky, hud, new THREE.Vector3(px, py, pz));
    } catch (e) { console.warn('player unavailable, using fly cam', e); controller = new FlyCam(); }
  } else if (Q.has('play')) {
    // PLAY (CONTROL, docs/notes/ar34-control.md): walk and drive (?play=1 | walk | drive, ?car=<kind>, ?pv=<body>)
    try {
      const { PlayController } = await import('./game/control.js');
      controller = new PlayController({ engine, streamer, traffic, peds, sky, flash }, {
        x: px, y: py, z: pz, yaw: Number(Q.get('yaw') ?? 0), mode: Q.get('play') === 'drive' ? 'drive' : 'walk',
        kind: Q.get('car'), pv: Q.has('pv') ? Number(Q.get('pv')) : undefined,
      });
      window.__PLAY = controller;
    } catch (e) { console.warn('play mode unavailable, using the drone', e); controller = new Explorer(); }
  } else {
    controller = new Explorer(); // Valdrada default: drone (Tab = first person)
  }

  // SPACE r2: the light showcase has its own keys (game/showcase.js); the page's debug keys (time, teleports, help, rain,
  // photo mode, deep link, auto tour, the graphics editor) stay off there
  const SHOWCASE = Q.has('showcase');
  if (!SHOWCASE) addEventListener('keydown', (e) => {
    if (e.code === 'KeyT') { const m = sky.cycle(); flash(m.toUpperCase()); }
    const spawns = Object.values(SPAWNS);
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].indexOf(e.code);
    if (idx >= 0 && controller) {
      const s = spawns[idx];
      if (controller.pos) { controller.pos.set(s[0], 90, s[1]); controller.vel?.set(0, 0, 0); }
      flash(s[2]);
    }
    if (e.code === 'KeyH') document.getElementById('help').style.display = document.getElementById('help').style.display === 'none' ? 'block' : 'none';
  });

  // weather: ?rain=0..1 sets a fixed downpour; R key toggles a shower live;
  // G opens the live weather/post editor (Tab is the drone/first-person
  // switch). Boot settings come from public/settings/graphics.json.
  const { createWeather, GFX, applyGfx } = await import('./world/weather.js');
  const weather = createWeather(engine.scene, engine.camera, engine);
  let life = null;
  // ?life=0 (recordings, 2026-09-17): no manhole steam or roof plumes — the sprites pop in the ad
  if (new URLSearchParams(location.search).get('life') !== '0') import('./world/life.js').then((m) => { life = m.initLife(engine.scene, engine.camera); }).catch((e) => console.warn('life unavailable', e));
  // VG36 (GROUND, docs/notes/ar35-veg.md): grass blades over the lawns near the lens and the tree pits' fill; `?vg36=0` leaves the ground as it was
  if (new URLSearchParams(location.search).get('vg36') !== '0') import('./world/vg36.js').then((m) => m.initVeg36(engine, streamer)).catch((e) => console.warn('vg36 unavailable', e));
  // TRAINS (AR34, docs/notes/ar34-trains.md): the 1 on the Manhattan Valley Viaduct, Metro-North on the Park Avenue Viaduct; `?trains=0` leaves them out
  if (new URLSearchParams(location.search).get('trains') !== '0') import('./sim/trains.js').then((m) => m.initTrains(engine, streamer)).catch((e) => console.warn('trains unavailable', e));
  try {
    const r = await fetch('/settings/graphics.json');
    if (r.ok) { applyGfx(await r.json()); sky.apply(sky.mode); console.log('[gfx] loaded settings/graphics.json'); }
  } catch { /* no saved settings — defaults */ }
  // profiling toggles: ?gfx=taa:0,motionBlur:0 sets any GFX key after the saved
  // settings; ?nopost=1 renders the scene without the composer; ?noshadow=1 /
  // ?nocascade2=1 drop the shadow cascades (tools/bshot.mjs --flags)
  if (Q.get('gfx')) {
    for (const kv of Q.get('gfx').split(',')) {
      const [k, v] = kv.split(':');
      if (k in GFX) GFX[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
    }
    // the sky was applied (?time=, settings/graphics.json) before these keys landed: a sun or sky offset
    // (gfx=sunAzim:40,sunElev:-1 — a film take's own sun) only takes effect on a re-apply
    sky.apply(sky.mode);
  }
  if (Q.has('nopost')) engine.gtRaw = true;
  if (Q.has('noshadow')) { engine.sun.castShadow = false; engine.sun2.castShadow = false; }
  if (Q.has('nocascade2')) engine.sun2.castShadow = false;
  const rainQ = Q.get('rain');
  if (rainQ !== null) weather.set(parseFloat(rainQ) || 0.8);
  if (Q.get('snow') !== null) GFX.snow = parseFloat(Q.get('snow')) || 0.8;
  if (Q.get('cloud') !== null) GFX.cloud = parseFloat(Q.get('cloud')) || 0.7;
  if (Q.get('gi') !== null) GFX.gi = parseFloat(Q.get('gi')) || 0; // A/B: ?gi=0 kills SSGI
  if (Q.get('probe') !== null) GFX.probe = parseFloat(Q.get('probe')) || 0;
  if (Q.get('tonemap')) GFX.toneMap = Q.get('tonemap');
  if (Q.get('lut')) GFX.lut = Q.get('lut');
  if (Q.get('cityao') !== null) GFX.cityAO = parseFloat(Q.get('cityao')) || 0;
  if (Q.get('haze') !== null) GFX.hazeDensity = parseFloat(Q.get('haze')) || 0;
  if (Q.has('hdri')) sky.setHDRI(Q.get('hdri') || true); // ?hdri or ?hdri=<name>
  // ?cartest=1: glTF vehicle import feasibility probe — loads a sample GLB at
  // the spawn point (CARLA .uasset assets need offline conversion first)
  if (Q.has('cartest')) {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    new GLTFLoader().load(Q.get('carglb') || 'models/carla_tesla_static.glb', (g) => {
      const m = g.scene;
      m.position.set(px + 6, (streamer.terrainAt(px + 6, pz - 4) ?? 40) + 0.05, pz - 4);
      m.rotation.y = 0.6; // CUE4Parse glTF is already in meters
      m.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        // CARLA glTF carries material slots, not baked textures — assign PBR
        // materials by slot name (the traffic integration path: per-instance paint)
        const n = (o.material?.name || '').toLowerCase();
        if (n.includes('bodywork') || n.includes('licenseplate')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0x8a1f1f, metalness: 0.75, roughness: 0.32 });
        } else if (n.includes('glass')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0x101418, metalness: 0.4, roughness: 0.08, transparent: true, opacity: 0.85 });
        } else if (n.includes('wheel')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0x1b1b1d, metalness: 0.3, roughness: 0.75 });
        } else if (n.includes('light')) {
          o.material = new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.2, roughness: 0.25, emissive: 0x333333 });
        } else {
          o.material = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, metalness: 0.35, roughness: 0.55 });
        }
      });
      engine.scene.add(m);
      const bb = new THREE.Box3().setFromObject(m); console.log('[cartest] loaded, bbox', JSON.stringify(bb.min), JSON.stringify(bb.max));
    }, undefined, (e) => console.warn('[cartest] failed', e));
  }
  if (!SHOWCASE) addEventListener('keydown', (e) => {
    if (e.code === 'KeyR') weather.set(weather.wet > 0.25 ? 0 : 0.8);
  });
  if (!SHOWCASE) import('./ui/editor.js').then((m) => m.initEditor({ engine, sky })).catch((e) => console.warn('editor unavailable', e));
  import('./city/props.js').then((m) => m.upgradeProps(instancer)).catch((e) => console.warn('props unavailable', e));
  import('./city/trees.js').then((m) => m.upgradeTrees(instancer)).catch((e) => console.warn('trees unavailable', e));

  const audio = initAudio();
  // ---- scenario config (?scenario=url): reproducible runs for data generation
  // JSON: { time, gfx: {...GFX}, seed, cars, hdri, rain }
  if (Q.has('scenario')) {
    try {
      const sc = await (await fetch(Q.get('scenario'))).json();
      if (sc.seed) { // deterministic sims: seeded PRNG replaces Math.random
        let s0 = sc.seed | 0 || 1;
        Math.random = () => {
          s0 |= 0; s0 = (s0 + 0x6d2b79f5) | 0;
          let z2 = Math.imul(s0 ^ (s0 >>> 15), 1 | s0);
          z2 = (z2 + Math.imul(z2 ^ (z2 >>> 7), 61 | z2)) ^ z2;
          return ((z2 ^ (z2 >>> 14)) >>> 0) / 4294967296;
        };
      }
      if (sc.gfx) applyGfx(sc.gfx);
      if (sc.time) sky.apply(sc.time);
      if (sc.hdri) sky.setHDRI(sc.hdri);
      if (sc.rain !== undefined) weather.set(sc.rain);
      if (sc.cars !== undefined && traffic) traffic.target = sc.cars;
      console.log('[scenario] applied', Q.get('scenario'));
    } catch (e) { console.warn('scenario failed', e); }
  }
  // LITE15: the light showcase (?showcase=1): the trailer's camera moves played live in random order (game/showcase.js)
  let showcase = null;
  if (Q.has('showcase') && controller instanceof PathCam) {
    import('./game/showcase.js').then((m) => { showcase = m.startShowcase({ engine, streamer, sky, controller, traffic, peds, Q }); })
      .catch((e) => console.warn('showcase unavailable', e));
  }
  // ---- camera products: P photo mode, L copy deep link, O auto tour
  let tour = null;
  if (!SHOWCASE) addEventListener('keydown', (e) => {
    if (e.code === 'KeyP') {
      const hud2 = document.getElementById('hud');
      hud2.style.display = hud2.style.display === 'none' ? '' : 'none';
      flash(hud2.style.display === 'none' ? 'PHOTO MODE' : 'HUD ON');
    }
    if (e.code === 'KeyL' && controller && controller.pos) {
      const c2 = controller;
      const url = location.origin + location.pathname +
        '?x=' + c2.pos.x.toFixed(1) + '&y=' + c2.pos.y.toFixed(1) + '&z=' + c2.pos.z.toFixed(1) +
        '&yaw=' + (c2.yaw ?? 0).toFixed(3) + '&pitch=' + (c2.pitch ?? 0).toFixed(3) + '&time=' + sky.mode;
      navigator.clipboard?.writeText(url).then(() => flash('LINK COPIED')).catch(() => flash(url));
    }
    if (e.code === 'KeyO' && controller && controller.pos) {
      tour = tour ? null : { i: 0, t: 0 };
      flash(tour ? 'AUTO TOUR (O TO STOP)' : 'TOUR OFF');
    }
    if (tour && ['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) { tour = null; flash('TOUR OFF'); }
  });
  const tourStops = Object.values(SPAWNS);
  const tourStep = (dt) => {
    if (!tour || !controller || !controller.pos) return;
    const A = tourStops[tour.i % tourStops.length];
    const B = tourStops[(tour.i + 1) % tourStops.length];
    tour.t += dt / 55; // ~55s per leg
    if (tour.t >= 1) { tour.t = 0; tour.i++; return; }
    const tt = tour.t < 0.5 ? 2 * tour.t * tour.t : 1 - (2 - 2 * tour.t) ** 2 / 2; // ease
    const x = A[0] + (B[0] - A[0]) * tt, z = A[1] + (B[1] - A[1]) * tt;
    const g = streamer.terrainAt(x, z);
    controller.pos.set(x, (g !== null && isFinite(g) ? g : 30) + 95 + Math.sin(tour.t * 3.14) * 45, z);
    if (controller.vel) controller.vel.set(0, 0, 0);
    const lookT = Math.min(1, tt + 0.04);
    const lx = A[0] + (B[0] - A[0]) * lookT, lz = A[1] + (B[1] - A[1]) * lookT;
    controller.yaw = Math.atan2(-(lx - controller.pos.x), -(lz - controller.pos.z));
    controller.pitch = -0.42;
  };
  // named storefronts (src/city/namedShops.js): real shops modelled on their real frontages (W 120th & Amsterdam)
  try {
    const { initNamedShops } = await import('./city/namedShops.js');
    window.__NAMED_SHOPS = initNamedShops({ scene: engine.scene, streamer, instancer });
  } catch (e) { console.warn('named shops unavailable', e); }
  // ground-truth export (window.__GT: boxes JSON + ?gt=seg instance masks)
  try {
    const { initGT } = await import('./world/gt.js');
    const gt = initGT(engine, { traffic, peds, scene: engine.scene, facadeMat, groundMat, farMat, instancer });
    window.__gtRefs = { traffic, peds };
    window.__INSTANCER = instancer;   // perf probes: instancer.stats (main / shadow instances, cull ms)
    if (Q.get('gt')) setTimeout(() => gt.setMode(Q.get('gt')), 4000); // after tiles stream in
  } catch (e) { console.warn('gt unavailable', e); }
  // PERCEPTION OUTPUT — semantic / instance / depth / AMODAL ground truth.
  // window.__PERC (docs/notes/perception.md); ?seg=<mode> renders it on screen.
  // Inert unless a mode is entered: normal rendering is untouched.
  try {
    const { initPerception } = await import('./perception/segRender.js');
    const perc = initPerception(engine, {
      scene: engine.scene, streamer, instancer, dresser, heroes, traffic, peds, sky,
      groundMat, farMat,
    });
    if (Q.get('seg')) {
      // the world has to be in before a label means anything — and the tile
      // UNDER the camera specifically (streamer.readyUnder), which is the same
      // gate the shot harnesses use to reject open-water frames
      const arm = () => (streamer.readyUnder() && streamer.stats.near > 4
        ? perc.enter(Q.get('seg')) : setTimeout(arm, 500));
      setTimeout(arm, 2500);
    }
  } catch (e) { console.warn('perception unavailable', e); }
  let frames = 0;
  // ?prof=1: per-subsystem CPU time per frame (ms), read with window.__PROF()
  const PROF = Q.has('prof') ? { t: {}, n: 0 } : null;
  const tick = (name, fn) => {
    if (!PROF) return fn();
    const t0 = performance.now();
    const r = fn();
    PROF.t[name] = (PROF.t[name] || 0) + performance.now() - t0;
    return r;
  };
  engine.prof = PROF;
  let apiHooks = null;   // ?api=1: src/api/bridge.js (preStep: API-driven actors + camera, postStep: sensors' poses)
  bootMark('frame loop');
  bootLoopUp = true;
  let bootNear = false;
  engine.onFrame = (dt) => {
    if (!bootNear && streamer.tiles.size > 4 && streamer.outstanding === 0) { bootNear = true; bootMark('near ring ready'); }
    tick('sky', () => sky.update(dt));
    tick('weather', () => weather.update(dt));
    tick('life', () => life?.update(dt));
    tourStep(dt);
    showcase?.step(dt);   // LITE15
    if (apiHooks) tick('api', () => apiHooks.preStep(dt));
    const p = tick('controller', () => { const c = showcase?.controller || controller; return c ? c.update(dt) : { x: px, z: pz }; });   // SPACE r2: the showcase's modes drive the view
    spawnGuard.update(engine.camera);   // film takes: traffic / walkers never spawn in view (window.__SPAWNGUARD)
    viewGuard.update(engine.camera);    // OV32: what the camera can see (sim/spawnGuard.js)
    tick('sun', () => engine.updateSun(sky.sunDir, p.x, p.y ?? 50, p.z));
    sweepFrame(engine);   // SV29 (?sv29=0 off): which shadow casters can still shadow the view (core/shadowSweep.js)
    tick('lamps', () => cityLamps.update(engine.camera, ENV.night.value, dt, engine));
    tick('streamer', () => streamer.update(p.x, p.z));
    if (traffic) tick('traffic', () => traffic.update(dt, p.x, p.z));
    if (peds) tick('peds', () => peds.update(dt, p.x, p.z));
    if (apiHooks) apiHooks.postStep(dt);
    if (signals) tick('signals', () => signals.update(dt));
    tick('dresser', () => dresser?.update(p.x, p.z));
    tick('heroes', () => heroes.update(p.x, p.z));
    if (towerKit) tick('towers', () => towerKit.update(engine.camera));   // TW
    tick('audio', () => audio.update(dt, { cars: traffic ? traffic.cars.length : 0, alt: p.y - (streamer.terrainAt(p.x, p.z) ?? p.y), night: ENV.night.value, wet: ENV.wet.value, wind: ENV.windAmp.value }));
    tick('flush', () => { instancer.flush(); instancer.cull(engine.camera); });
    if (PROF) PROF.n++;
    frames++;
    if (frames % 10 === 0) {
      hud.stats.textContent = `${engine.fps.toFixed(0)} fps · tiles ${streamer.stats.near} · lod ${streamer.stats.macro}${dresser ? ` · dressed ${dresser.active.size}` : ''} · ${controller?.speedText?.() ?? ''}`;
      const total = Object.keys(streamer.manifest.macros).length;
      hud.bar.style.width = `${(streamer.stats.macro / total) * 100}%`;
      if (hud.loading.style.opacity !== '0' && streamer.stats.near > 4 && frames > 90 && !engine.holdDraw) {
        bootMark('loading hidden');
        hud.loading.style.opacity = '0';
        setTimeout(() => (hud.loading.style.display = 'none'), 800);
      }
      if (isShot && frames > 60 && streamer.idle() && !engine.holdDraw && !window.__READY) { window.__READY = true; bootMark("READY"); }
    }
  };

  // ---- ?record=1 : fixed-timestep trailer capture --------------------------
  // The real-time loop keeps running (tiles stream, the dresser drains its
  // build queue, shaders compile) but the SIMULATION only advances when the
  // recorder asks for a step, and always by exactly the same dt. Frames can
  // take a second each without the camera or the traffic skipping.
  if (isRecord) {
    const realFrame = engine.onFrame;
    engine.recordMode = true;   // AC26: ?accum=N accumulates only here, where the sim steps on request
    let pending = 0, threw = 0;
    // A throw anywhere in the frame body (a module mid-edit under HMR, a pool that
    // briefly has no free() ...) would otherwise skip composer.render() for the
    // rest of the run and the recorder would happily screenshot a frozen image.
    // Swallow it here so the render still happens, and count it for __RECSTAT.
    // ?api=1 asynchronous mode (src/api/bridge.js sets window.__FREERUN_ON): the sim free-runs on real time
    // FP37 (core/engine.js): every THREE.LOD (Belvedere Castle, the park's bridges, Bethesda's angel and cherubs, the facade
    // kit's cells, the streetscape) holds the level of the take's nearest approach: autoUpdate off, the level set once per
    // take; the scene is walked again every 30 stepped frames for parts that stream in. Unheld level changes in view count
    // as `lod` events (the recorder's QA fails a take on them).
    let fpLodV = -1, fpLodN = 0;
    const _fpW = new THREE.Vector3();
    const fpHoldLODs = () => {
      const fp = window.__FP37;
      if (!fp || !fp.pts) return;
      engine.scene.traverse((o) => {
        if (!o.isLOD || !o.levels || o.levels.length < 2 || o.userData.fpV === fp.v) return;
        o.autoUpdate = false; o.userData.fpV = fp.v;
        o.getWorldPosition(_fpW);
        let d = Infinity;
        for (let j = 0; j < fp.pts.length; j += 3) d = Math.min(d, Math.hypot(_fpW.x - fp.pts[j], _fpW.y - fp.pts[j + 1], _fpW.z - fp.pts[j + 2]));
        const L = o.levels;
        let i = 0;
        while (i + 1 < L.length && d >= L[i + 1].distance) i++;
        for (let j = 0; j < L.length; j++) L[j].object.visible = j === i;
        o._currentLevel = i;
      });
    };
    if (FP37) {
      const lodUpd = THREE.LOD.prototype.update;
      THREE.LOD.prototype.update = function (camera) {
        const was = this._currentLevel;
        lodUpd.call(this, camera);
        if (camera === engine.camera && this.userData.fpSeen && this._currentLevel !== was) {
          this.getWorldPosition(_fpW);
          if (engine.inView(_fpW.x, _fpW.y, _fpW.z, 20)) engine.popEvents.lod++;
        }
        if (camera === engine.camera) this.userData.fpSeen = true;
      };
    }
    engine.onFrame = (rdt) => {
      const sdt = pending || (window.__FREERUN_ON ? Math.min(0.1, rdt || 0) : 0); pending = 0;
      if (sdt > 0) engine.simStepped = true;   // AC26: the accumulation AA starts again on a stepped frame
      if (FP37 && window.__FP37 && (window.__FP37.v !== fpLodV || (sdt > 0 && ++fpLodN % 30 === 0))) { fpLodV = window.__FP37.v; try { fpHoldLODs(); } catch (e) { console.warn('[fp37] lod hold', e); } }
      try { realFrame(sdt); } catch (e) { if (!threw++) console.warn('[record] frame body threw:', e); }
    };
    // install a camera path (tools/trailer/paths.json, injected by the recorder)
    window.__SET_PATH = (p) => (controller instanceof PathCam ? controller.setPath(p) : 'not a PathCam');
    // advance the world by one fixed step and resolve once that frame is up
    // nodraw: step the simulation without drawing the frame (the recorder's warm-up: the sim does not need its frames
    // drawn, and each one cost a full 1440p render)
    window.__advance = (dt = 1 / 30, nodraw = false) => new Promise((res) => {
      pending = dt;
      if (nodraw) engine.skipDraw = true;
      const wait = () => (pending === 0 ? requestAnimationFrame(() => res(true)) : requestAnimationFrame(wait));
      requestAnimationFrame(wait);
    });
    window.__ADVANCE = window.__advance;
    // the recorder turns the spawn guard ON for a take's capture and OFF for its warm-up (sim/spawnGuard.js)
    window.__SPAWNGUARD = (on = true) => { spawnGuard.on = !!on; spawnGuard.update(engine.camera); return spawnGuard.on; };
    // ...and empties the crowd once the world has settled, so the warm-up repopulates it around the lens (sim/peds.js reset)
    window.__PEDS_RESET = () => { if (!peds) return -1; peds.reset(); return peds.peds.length; };
    // LW26: is the lens inside a walker or a vehicle, or so near one that the 0.4 m near plane cuts it open? (the recorder asks
    // every frame; film 9's fStreetLife opened inside a head, film 10's mLenoxEye looked into a passing box truck's cab)
    window.__LENS_HIT = () => {
      const c = engine.camera.position, out = [];
      if (peds) for (const p of peds.peds) {
        if (p._x === undefined) continue;
        const d = Math.hypot(p._x - c.x, p._z - c.z);
        if (d < 0.65 && c.y > p._y - 0.1 && c.y < p._y + 1.95) out.push(`walker ${p.idx} at ${d.toFixed(2)} m`);
      }
      if (traffic) for (const car of traffic.cars) {
        const q = car._pose;
        if (!q || Math.abs(q[0] - c.x) > 12 || Math.abs(q[2] - c.z) > 12) continue;
        const [hw, hl] = traffic.carHalf(car), cy = Math.cos(q[3]), sy = Math.sin(q[3]), dx = c.x - q[0], dz = c.z - q[2];
        const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
        const K = traffic.fleet24?.kinds?.[car.kind], ht = K && K.size ? K.size[1] : (hl > 4.5 ? 3.5 : 2.0);   // the kind's own height (a box truck is 3.4 m on a 3.9 m half-length)
        if (Math.abs(lx) < hw + 0.5 && Math.abs(lz) < hl + 0.5 && c.y > q[1] - 0.5 && c.y < q[1] + ht + 0.45) out.push(`${car.kind || 'car'} ${car.idx ?? ''}`);
      }
      return out.length ? out : null;
    };
    // TW26: cars in view that moved more than their speed allows since the last call, or sideways by more than 0.5 m
    // (owner 2026-09-26: "cars randomly change lanes by teleporting"); the recorder asks once a stepped frame
    let jumpPrev = new Map();
    window.__CAR_JUMPS = (dt = 1 / 30) => {
      if (!traffic) return null;
      const out = [], next = new Map();
      for (const c of traffic.cars) {
        const q = c._pose;
        if (!q) continue;
        const p = jumpPrev.get(c);
        next.set(c, [q[0], q[1], q[2], q[3], c.v || 0]);
        if (!p) continue;
        const dx = q[0] - p[0], dz = q[2] - p[2], d = Math.hypot(dx, dz), hx = Math.sin(p[3]), hz = Math.cos(p[3]);
        const lat = Math.abs(dx * hz - dz * hx), allow = Math.max(p[4], c.v || 0) * dt + 0.6;
        if ((lat > 0.5 || d > allow) && spawnGuard.inView(q[0], q[1] + 1, q[2], 2)) out.push(`${c.kind || 'car'} ${d.toFixed(2)} m (side ${lat.toFixed(2)}) ${Math.hypot(q[0] - engine.camera.position.x, q[2] - engine.camera.position.z).toFixed(0)} m away`);
      }
      jumpPrev = next;
      return out.length ? out : null;
    };
    // OV32: pairs of vehicle bodies in view overlapping by more than 0.1 m (owner 2026-09-29: "one turning vehicle clips
    // through another during the turn"); the recorder asks once a stepped frame and reports CAR-OVERLAP
    window.__CAR_OVERLAPS = () => {
      if (!traffic || !traffic._ovHit) return null;
      // VF36 (VEHFIX 2026-10-02): the bodies as drawn, dead cars and parked instances included, in the frame (traffic.js
      // drawnOverlaps); the test below took the live cars' carHalf boxes only and never saw a car standing inside a dead one
      if (traffic.drawnOverlaps && traffic.fleet24 && Q.get('vf36') !== '0') return traffic.drawnOverlaps(0.1);
      const L = [], out = [];
      for (const c of traffic.cars) { const q = c._pose; if (q && !c.dead && spawnGuard.inView(q[0], q[1] + 1, q[2], 3)) L.push(c); }
      for (let a = 0; a < L.length; a++) for (let b = a + 1; b < L.length; b++) {
        const A = L[a], B = L[b], qa = A._pose, qb = B._pose;
        if (Math.abs(qa[0] - qb[0]) > 12 || Math.abs(qa[2] - qb[2]) > 12) continue;
        const h = traffic.carHalf(A);
        if (traffic._ovHit(qa[0], qa[2], qa[3], h[0] - 0.1, h[1] - 0.1, B)) out.push(`${A.kind || 'car'}${A.turn ? ' (turning)' : ''} x ${B.kind || 'car'}${B.turn ? ' (turning)' : ''} ${Math.hypot(qa[0] - engine.camera.position.x, qa[2] - engine.camera.position.z).toFixed(0)} m away`);
      }
      return out.length ? out : null;
    };
    // TN38 (owner 2026-10-04 on t8LenoxDive: "The red van in bottom left turns by getting on the central sidewalk area in the
    // street"): vehicles in view with a wheel hub or their body centre on a non-road surface (a sidewalk, a median or its
    // nose, a planting bed, a plaza) at their own level (traffic.js offRoad); the recorder asks once a stepped frame and
    // reports CAR-OFFROAD, clearance.mjs asks with all = true and fails the shot on one in view
    window.__CAR_OFFROAD = (all = false) => {
      if (!traffic || !traffic.offRoad) return null;
      const L = traffic.offRoad(all);
      if (!L || !L.length) return null;
      return all ? L : L.map((c) => `${c.id}${c.turn ? ' (turning)' : ''}${c.dead ? ' (dead)' : ''} ${c.hits.join(', ')} ${c.dist} m away`);
    };
    // ...and drops the TAA history before a re-shot frame (a void frame must not survive in the history)
    window.__TAA_RESET = () => { if (engine.taa) engine.taa._first = true; return !!engine.taa; };
    // ...and clears the kerb trees whose trunks stand within `r` m of a take's lens path (x,z points) for that take: the
    // W 122nd dollies ran through the FD14 crowns (film 7 review). Returns the number of tree parts hidden.
    window.__CLEAR_TREES = (pts, r = 5) => {
      let n = 0;
      const near = (x, z) => {
        for (let i = 1; i < pts.length; i++) {
          const [ax, az] = pts[i - 1], [bx, bz] = pts[i], dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          if (Math.hypot(x - ax - dx * t, z - az - dz * t) < r) return true;
        }
        return false;
      };
      for (const p of instancer.pools.values()) {
        if (!p.isTree || !p.alive) continue;
        for (let s = 0; s < p.top; s++) if (p.alive[s] && near(p.pos[s * 3], p.pos[s * 3 + 2])) { p.alive[s] = 0; n++; }
        p.ver = (p.ver | 0) + 1;
        p.dirty = p.sdirty = p.fdirty = true;
      }
      return n;
    };
    // tear-proof frame capture for the recorder (engine.capture: canvas read back in the render's own task);
    // resolves with a data URL of the NEXT rendered frame — the sim does not advance (pending stays 0)
    window.__capture = (type = 'image/jpeg', q = 0.95) => engine.capture(type, q);
    // FR28 (owner 2026-09-27: "we need to find a faster way to render at high quality ... near real time with proper
    // instrumentation"): ONE call per captured frame for tools/ad/record.mjs --fast. The classic path spends ~12 page calls,
    // two requestAnimationFrame turns per __advance and a synchronous toDataURL whose base64 crosses the debugger pipe, and
    // the idle loop keeps drawing unrequested frames between them. Here the engine's own frame body runs on demand
    // (engine.externalDrive parks the idle loop): the stepped frame; while tiles or the dresser are still busy, still frames
    // with a yield between them so their fetches and workers can land (the classic path's settle wait); then `acc` more
    // still frames back to back, which the AC26 mean takes as its jittered samples; the lens and car checks; and toBlob in
    // the same task as the last draw (tear-proof like engine.capture; the JPEG is encoded off the main thread), POSTed to
    // the recorder's frame sink while the next frame renders. o.prof: a 1x1 readback after each phase, so the times are the
    // GPU's and not just the CPU's submit.
    let frPend = 0;
    const gpuSync = () => {
      const gl = engine.renderer.getContext(), px = new Uint8Array(4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    };
    const settledNow = () => streamer.idle() && !engine.holdDraw && (!dresser || dresser.queue.length === 0) && (!towerKit || towerKit.idle());   // TW
    // o.enc 'worker': toBlob's readback of the 2560x1440 drawing buffer cost 90-140 ms of the main thread a frame. Here the
    // canvas is snapshotted into an ImageBitmap in the same task as the last draw (a GPU copy; createImageBitmap takes the
    // canvas's bitmap when it is called), and a worker draws it into an OffscreenCanvas, encodes the JPEG and POSTs it.
    let encW = null;
    const encWorker = () => {
      if (encW) return encW;
      const src = `let cv = null, cx = null;
onmessage = async (e) => {
  const { bmp, url, type, q } = e.data;
  try {
    if (!cv || cv.width !== bmp.width || cv.height !== bmp.height) { cv = new OffscreenCanvas(bmp.width, bmp.height); cx = cv.getContext('2d', { alpha: false }); }
    cx.drawImage(bmp, 0, 0); bmp.close();
    const blob = await cv.convertToBlob({ type, quality: q });
    const r = await fetch(url, { method: 'POST', body: blob });
    postMessage({ ok: r.ok || r.status === 204 });
  } catch (err) { postMessage({ ok: false, err: String(err) }); }
};`;
      encW = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      encW.onmessage = (e) => { frPend--; if (!e.data.ok) console.warn('[fr28] worker encode failed', e.data.err || ''); };
      return encW;
    };
    const sendBlob = (name, o) => {
      frPend++;
      engine.renderer.domElement.toBlob((blob) => {
        if (!blob) { frPend--; console.warn('[fr28] toBlob gave nothing for', name); return; }
        fetch(o.sink + '/' + encodeURIComponent(name), { method: 'POST', body: blob })
          .catch((e) => console.warn('[fr28] sink', name, e.message)).finally(() => { frPend--; });
      }, o.type || 'image/jpeg', o.q ?? 0.95);
    };
    const sendWorker = (name, o) => {
      frPend++;
      createImageBitmap(engine.renderer.domElement)
        .then((bmp) => encWorker().postMessage({ bmp, url: o.sink + '/' + encodeURIComponent(name), type: o.type || 'image/jpeg', q: o.q ?? 0.95 }, [bmp]))
        .catch((e) => { frPend--; console.warn('[fr28] createImageBitmap', e.message); });
    };
    const yieldT = () => new Promise((r) => setTimeout(r, 0));
    window.__REC_FRAME = async (o) => {
      const T0 = performance.now();
      engine.externalDrive = true;
      while (frPend >= 4) await new Promise((r) => setTimeout(r, 2));   // at most 4 frames (~6 MB) in flight
      const T1 = performance.now();
      let pumped = 0, err = null;
      try {
        if (o.dt > 0) pending = o.dt;
        engine.frameBody();                                               // the stepped frame (a still one at dt = 0)
        if (o.prof) gpuSync();
        const T2 = performance.now();
        if (o.settle > 0 && !settledNow()) {
          do { await yieldT(); engine.frameBody(); pumped++; } while (!settledNow() && performance.now() - T2 < o.settle);
        }
        if (o.prof) gpuSync();
        const T3 = performance.now();
        {
          // o.freezeShadow: the samples reuse the stepped frame's sun shadow map (the world and the lens are frozen, the
          // casters would draw the same depth again; the far cascade only re-renders on a move anyway)
          const sh = engine.sun.shadow, fz = !!o.freezeShadow && sh.autoUpdate;
          if (fz) sh.autoUpdate = false;
          try { for (let k = 0; k < (o.acc | 0); k++) engine.frameBody(); }   // the accumulation samples of the frozen frame
          finally { if (fz) { sh.autoUpdate = true; sh.needsUpdate = true; } }
        }
        if (o.prof) gpuSync();
        const T4 = performance.now();
        const lens = o.checks ? window.__LENS_HIT() : null;
        const jumps = o.checks && o.dt > 0 ? window.__CAR_JUMPS(o.dt) : null;
        const ovl = o.checks && o.dt > 0 ? window.__CAR_OVERLAPS() : null;   // OV32
        const offr = o.checks && o.dt > 0 ? window.__CAR_OFFROAD?.() ?? null : null;   // TN38
        // o.encBoth: the same drawn frame both ways (<name>_blob, <name>_wkr) for an A/B of the two capture paths
        if (o.encBoth) { const d = o.name.lastIndexOf('.'); sendBlob(o.name.slice(0, d) + '_blob' + o.name.slice(d), o); sendWorker(o.name.slice(0, d) + '_wkr' + o.name.slice(d), o); }
        else if (o.enc === 'worker') sendWorker(o.name, o);
        else sendBlob(o.name, o);
        const T5 = performance.now();
        // WS37: the park water's mirrors as this frame drew them (city/cpWaterMat.js): each body in view with its share of
        // the lens's rays, its mirror's weight against the probe and whether a mirror image was drawn; the recorder logs a
        // REFLECTION-DROPOUT when a body that fills the view loses its mirror mid-take (tools/ad/temporal_scan.py reads it)
        const M = o.checks ? window.__CPMIR : null;
        const water = M ? M.bodies.filter((B) => B.slot || (B.w || 0) > 0 || M.stats.pick.includes(B.key)).map((B) => {
          const i = M.stats.pick.indexOf(B.key);
          return [B.key, i >= 0 ? M.stats.cover[i] : 0, +(B.w || 0).toFixed(3), B.slot ? 1 : 0];
        }) : null;
        // QA37: the engine's pop events since the last captured frame (the shadow cascades' box steps and far-map renders,
        // the light probe), and VG36's lawn-field captures
        const pe = engine.popEvents, V = window.__VG36, F24 = window.__F24PROBE;
        const ev = o.checks && pe ? { ...pe, vg36: V ? V.stats.captures : 0, f24: F24 ? F24.captures || 0 : 0 } : null;   // f24: the fleet's reflection probe (sim/fleet24.js)
        let events = null;
        if (ev) { const last = window.__recEv || ev; events = Object.keys(ev).filter((k) => ev[k] !== last[k]); window.__recEv = ev; if (!events.length) events = null; }
        return { lens, jumps, ovl, offr, water, events, pumped, frames: engine.frames, threw,
          t: { wait: +(T1 - T0).toFixed(1), step: +(T2 - T1).toFixed(1), settle: +(T3 - T2).toFixed(1), acc: +(T4 - T3).toFixed(1), cap: +(T5 - T4).toFixed(1) } };
      } catch (e) {
        err = String(e && e.stack || e).slice(0, 400);
        console.warn('[fr28] frame failed', err);
        return { err, pumped, frames: engine.frames, threw };
      }
    };
    // the recorder hands the loop back (and waits for the uploads) between takes
    window.__REC_DRIVE = (on) => { engine.externalDrive = !!on; return frPend; };
    // FR28: the warm-up in one call. The classic warm-up is a page call and two requestAnimationFrame turns per step, and
    // the second turn draws a still frame even for a draw-free step: 450 steps cost ~100 s, nearly all of it pictures
    // nobody keeps. Here the sim steps back to back (a yield every few steps so a fetch or a worker can land), and only
    // the last `drawLast` steps are drawn, for the light probe, the exposure and the temporal histories.
    window.__REC_WARM = async (o) => {
      const T0 = performance.now();
      engine.externalDrive = true;
      let drawn = 0;
      try {
        for (let i = 0; i < o.n; i++) {
          pending = o.dt || 1 / 30;
          if (i < o.n - (o.drawLast ?? 60)) engine.skipDraw = true; else drawn++;
          engine.frameBody();
          if (i % 4 === 3) await yieldT();
        }
      } finally { engine.externalDrive = false; }
      return { ms: +(performance.now() - T0).toFixed(0), drawn, threw };
    };
    // everything the recorder needs to decide whether the frame is settled
    window.__RECSTAT = () => ({
      ready: !!window.__READY,
      // engine.frames only advances on a frame that reached composer.render():
      // the recorder uses it as a liveness check before every screenshot
      frames: engine.frames,
      threw,
      idle: streamer.idle() && !engine.holdDraw,   // PC26: not settled while the boot precompile holds the picture
      precompiling: !!engine.holdDraw,
      near: streamer.stats.near,
      macro: streamer.stats.macro,
      outstanding: streamer.outstanding,
      dressQ: dresser ? dresser.queue.length : 0,
      dressActive: dresser ? dresser.active.size : 0,
      cars: traffic ? traffic.cars.length : 0,
      peds: peds ? peds.peds.length : 0,
      fps: +engine.fps.toFixed(1),
      t: +(controller?.t ?? 0).toFixed(3),
      pos: [+engine.camera.position.x.toFixed(1), +engine.camera.position.y.toFixed(1), +engine.camera.position.z.toFixed(1)],
    });
    console.log('[record] fixed-step capture armed');
    if (isApi) {
      try {
        const { initApi } = await import('./api/bridge.js');
        apiHooks = initApi({ engine, streamer, traffic, peds, signals, sky, weather, dresser, instancer, cam: controller, spawnGuard });
      } catch (e) { console.error('[api] bridge failed to start', e); }
    }
  }
}
// layer probe: hide scene layers cumulatively inside ONE session and sample fps
// after each step (removes the run-to-run noise of separate launches)
window.__LAYERS = async (sampleMs = 3000) => {
  const sample = () => new Promise((res) => {
    const f0 = engine.frames; const t0 = performance.now();
    setTimeout(() => res(+(((engine.frames - f0) * 1000) / (performance.now() - t0)).toFixed(1)), sampleMs);
  });
  const out = {};
  const setVis = (pred, v) => { engine.scene.traverse((o) => { if (pred(o)) o.visible = v; }); };
  out.base = await sample();
  streamer.macroGroup.visible = false; out.noMacros = await sample();
  setVis((o) => /^pool/.test(o.name || ''), false); out.noFurniture = await sample();
  setVis((o) => o.isMesh && o.material?.userData?.isFacade, false); out.noTileBuildings = await sample();
  setVis((o) => o.isMesh && o.material === groundMat, false); out.noGround = await sample();
  setVis((o) => o.userData?.nycDress, false); out.noDresser = await sample();
  setVis((o) => o.isMesh && /^tile_/.test(o.parent?.name || '') , false); out.noTileRest = await sample();
  if (window.__gtRefs?.traffic) { for (const p of Object.values(window.__gtRefs.traffic.pools)) { if (p.paint) p.paint.visible = false; if (p.dark) p.dark.visible = false; if (p.mesh) p.mesh.visible = false; } }
  out.noCars = await sample();
  engine.sun.castShadow = false; out.noShadow = await sample();
  const info = engine.renderer.info.render;
  out.callsLeft = info.calls; out.trisLeft = info.triangles;
  return out;
};
// per-pass profile: CPU submit ms, GPU ms (EXT_disjoint_timer_query_webgl2),
// draw calls and triangles per composer pass, averaged over nFrames.
// freezeShadow=true keeps the near shadow map (sun.shadow.autoUpdate=false)
// so the prepass delta isolates the shadow-caster pass cost (lossless while
// the camera is still).
window.__PASSES = (nFrames = 90, freezeShadow = false) => new Promise((resolve) => {
  const r = engine.renderer, gl = r.getContext();
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const passes = engine.composer.passes;
  const names = passes.map((p, i) => p.constructor.name + (passes.findIndex((q) => q.constructor.name === p.constructor.name) !== i ? i : ''));
  const acc = names.map(() => ({ cpu: 0, gpu: 0, gpuN: 0, calls: 0, tris: 0 }));
  const pending = [];
  const info = r.info;
  const origs = passes.map((p) => p.render);
  const origCR = engine.composer.render.bind(engine.composer);
  const prevAuto = engine.sun.shadow.autoUpdate;
  if (freezeShadow) engine.sun.shadow.autoUpdate = false;
  let frames = 0, wall0 = 0, wall = 0;
  info.autoReset = false;
  const poll = () => {
    for (let k = pending.length - 1; k >= 0; k--) {
      const { q, i } = pending[k];
      if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) {
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { acc[i].gpu += gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6; acc[i].gpuN++; }
        gl.deleteQuery(q); pending.splice(k, 1);
      }
    }
  };
  const finish = () => {
    passes.forEach((p, i) => { p.render = origs[i]; });
    engine.composer.render = origCR;
    setTimeout(() => {
      poll();
      info.autoReset = true;
      engine.sun.shadow.autoUpdate = prevAuto;
      const out = { frames, ext: !!ext, freezeShadow, frameMs: +((wall - wall0) / frames).toFixed(2), passes: {} };
      let gpuSum = 0, cpuSum = 0;
      names.forEach((n, i) => {
        if (!passes[i].enabled) return;
        const a = acc[i];
        const gpu = a.gpuN ? a.gpu / a.gpuN : null;
        gpuSum += gpu || 0; cpuSum += a.cpu / frames;
        out.passes[n] = { cpu: +(a.cpu / frames).toFixed(2), gpu: gpu === null ? null : +gpu.toFixed(2), calls: Math.round(a.calls / frames), tris: Math.round(a.tris / frames) };
      });
      out.gpuSum = +gpuSum.toFixed(2); out.cpuSum = +cpuSum.toFixed(2);
      resolve(out);
    }, 400);
  };
  engine.composer.render = (dt) => {
    info.reset();
    if (frames === 0) wall0 = performance.now();
    origCR(dt);
    wall = performance.now();
    frames++;
    poll();
    if (frames >= nFrames) finish();
  };
  passes.forEach((p, i) => {
    p.render = function (...a) {
      const c0 = info.render.calls, t0 = info.render.triangles, s0 = performance.now();
      let q = null;
      if (ext) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
      origs[i].apply(this, a);
      if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push({ q, i }); }
      acc[i].cpu += performance.now() - s0;
      acc[i].calls += info.render.calls - c0;
      acc[i].tris += info.render.triangles - t0;
    };
  });
});
// deterministic triangle/draw-call breakdown per scene layer: renders one
// frame per step with the near shadow map frozen (scene pass only) and one
// with it refreshed (scene + near shadow), reading renderer.info deltas.
// Hidden layers are restored afterwards. No fps sampling, no recompiles.
window.__TRIS = async () => {
  const info = engine.renderer.info;
  const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const count = async (shadow) => {
    // frozen: autoUpdate=false and needsUpdate=false -> no caster pass
    engine.sun.shadow.autoUpdate = shadow; engine.sun.shadow.needsUpdate = shadow;
    const f0 = engine.frames;
    await nextFrame();
    info.autoReset = false; info.reset();
    const f1 = engine.frames;
    await nextFrame();
    const n = Math.max(1, engine.frames - f1);
    const out = { calls: Math.round(info.render.calls / n), tris: Math.round(info.render.triangles / n) };
    info.autoReset = true;
    return out;
  };
  const hidden = [];
  const hide = (pred) => { engine.scene.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; hidden.push(o); } }); };
  const steps = { all: null };
  for (const L of ['macros', 'batches', 'cars', 'parked', 'peds', 'dresser', 'tileBuildings', 'ground', 'tileRest', 'heroes', 'water']) steps['no' + L[0].toUpperCase() + L.slice(1)] = () => hide(__layerPred[L]);

  const out = {};
  const prevAuto = engine.sun.shadow.autoUpdate;
  for (const [k, fn] of Object.entries(steps)) {
    if (fn) fn();
    const a = await count(false), b = await count(true);
    out[k] = { calls: a.calls, tris: a.tris, shCalls: b.calls - a.calls, shTris: b.tris - a.tris };
  }
  for (const o of hidden) o.visible = true;
  engine.sun.shadow.autoUpdate = prevAuto; engine.sun.shadow.needsUpdate = true;
  // deltas: what each layer contributed (previous step minus this step)
  const keys = Object.keys(out), d = {};
  for (let i = 1; i < keys.length; i++) {
    const p = out[keys[i - 1]], c = out[keys[i]];
    d[keys[i].replace(/^no/, '')] = { calls: p.calls - c.calls, tris: p.tris - c.tris, shCalls: p.shCalls - c.shCalls, shTris: p.shTris - c.shTris };
  }
  d.rest = out[keys[keys.length - 1]];
  return { total: out.all, layers: d };
};
// instancer pool census: triangles per instance x active instances
window.__POOLS = (top = 25) => {
  const rows = [];
  for (const [name, p] of instancer.pools) {
    const g = p.geo || p.srcGeo || p.mesh?.geometry;
    const tri = g ? Math.round((g.index ? g.index.count : g.attributes?.position?.count || 0) / 3) : 0;
    const n = p.hmap ? p.hmap.size : (p.top || 0) - (p.free?.length || 0);
    rows.push([name, tri, n, tri * n]);
  }
  rows.sort((a, b) => b[3] - a[3]);
  const total = rows.reduce((s, r) => s + r[3], 0);
  return { totalM: +(total / 1e6).toFixed(2), pools: rows.slice(0, top).map((r) => `${r[0]}: ${r[1]}tri x${r[2]} = ${(r[3] / 1e6).toFixed(2)}M`) };
};
// named scene layers for external (Node-driven) fps sampling: __LAYER(name, vis)
// toggles one layer without touching shader programs; __FRAMES() returns the
// frame counter + clock so the harness samples fps without an in-page await.
const __layerPred = {
  macros: (o) => o === streamer.macroGroup,
  batches: (o) => /^pool/.test(o.name || ''),
  dresser: (o) => !!o.userData?.nycDress,
  cars: (o) => /^vehS?:m:/.test(o.name || ''),
  parked: (o) => /^vehS?:p:/.test(o.name || ''),
  peds: (o) => o === window.__gtRefs?.peds?.mesh,
  crowd: (o) => /^pedS?:/.test(o.name || ''),   // PV2 photoreal walkers (sim/crowd.js render sets)
  tileBuildings: (o) => o.isMesh && !!o.material?.userData?.isFacade,
  ground: (o) => o.isMesh && o.material === groundMat,
  tileRest: (o) => o.isMesh && (/^tile_/.test(o.parent?.name || '') || /^signs:/.test(o.name || '')),
  heroes: (o) => o.isMesh && o.material === heroes.mat,
  water: (o) => o.isMesh && o.geometry?.attributes?.position?.count === 4 && o.material?.type === 'ShaderMaterial',
};
const __layerHidden = new Map();
window.__LAYER = (name, vis) => {
  const pred = __layerPred[name];
  if (!pred) return 'unknown layer ' + name;
  if (!vis) {
    const list = [];
    engine.scene.traverse((o) => { if (o.visible && pred(o)) { o.visible = false; list.push(o); } });
    __layerHidden.set(name, list);
    return list.length;
  }
  const list = __layerHidden.get(name) || [];
  for (const o of list) o.visible = true;
  __layerHidden.delete(name);
  return list.length;
};
window.__FRAMES = () => ({ frames: engine.frames, t: performance.now() });
window.__FREEZE_SHADOW = (on) => { engine.sun.shadow.autoUpdate = !on; engine.sun.shadow.needsUpdate = !on; engine.sun2.shadow.autoUpdate = false; if (!on) engine.sun2.shadow.needsUpdate = true; return on; };
// what is still drawn once every known layer is hidden: visible meshes grouped
// by a label (traffic pools identified by reference), with counts and tris
window.__REST = (top = 40) => {
  const t = window.__gtRefs?.traffic;
  const tag = new Map();
  if (t) {
    for (const [k, p] of Object.entries(t.pools)) { tag.set(p.mb, `car:${k}:paint`); tag.set(p.md, `car:${k}:dark`); }
    if (t.parked) for (const [k, p] of Object.entries(t.parked)) { tag.set(p.mb, `parked:${k}:paint`); tag.set(p.md, `parked:${k}:dark`); if (p.shell) tag.set(p.shell, `parked:${k}:shell`); }
  }
  if (window.__gtRefs?.peds?.mesh) tag.set(window.__gtRefs.peds.mesh, 'peds');
  const agg = {};
  engine.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    let p = o; let anc = false; while (p) { if (!p.visible) { anc = true; break; } p = p.parent; }
    if (anc) return;
    const g = o.geometry;
    const n = g ? (g.index ? g.index.count : g.attributes?.position?.count || 0) / 3 : 0;
    const inst = o.isInstancedMesh ? o.count : 1;
    const key = tag.get(o) || (o.isBatchedMesh ? 'batch' : `${o.name || '-'}|${o.parent?.name || '-'}|${o.material?.name || o.material?.type}|${o.isInstancedMesh ? 'inst' : 'mesh'}`);
    const a = agg[key] || (agg[key] = { meshes: 0, tris: 0, inst: 0 });
    a.meshes++; a.tris += n * inst; a.inst += inst;
  });
  return Object.entries(agg).sort((a, b) => b[1].tris - a[1].tris).slice(0, top).map(([k, v]) => `${k}: ${v.meshes} mesh, ${v.inst} inst, ${(v.tris / 1e6).toFixed(2)}M tris`);
};
// who are the anonymous meshes: first n visible meshes of a material type with
// their ancestor chain, shadow flags and sizes
window.__WHO = (matType = 'MeshLambertMaterial', n = 6) => {
  const out = [];
  engine.scene.traverse((o) => {
    if (out.length >= n || !o.isMesh || !o.visible || o.material?.type !== matType) return;
    if (o.name && /^pool|^batch/.test(o.name)) return;
    const chain = []; let p = o.parent; while (p) { chain.push(p.name || p.type); p = p.parent; }
    const g = o.geometry;
    out.push({ name: o.name, chain: chain.join('<'), cast: o.castShadow, recv: o.receiveShadow, inst: o.isInstancedMesh ? o.count : 0,
      verts: g?.attributes?.position?.count ?? 0, idx: g?.index?.count ?? 0, pos: o.position.toArray().map((v) => +v.toFixed(1)), matName: o.material.name, map: !!o.material.map, order: o.renderOrder });
  });
  return out;
};
// attribution only: drop furniture/vehicle casters from the shadow passes
window.__SHADOWSETS = (on) => { Instancer.shadowSets = !!on; return Instancer.shadowSets; };
window.__INST = instancer; window.__STREAMER = streamer;
// A/B toggles for in-session measurement (bshot --ab)
window.__SORT = (on) => { engine.renderer.setOpaqueSort(on ? engine._opaqueSortBS : null); return !!on; };
window.__SKYORDER = (n) => { sky.sky.renderOrder = n; return n; };
window.__SHADOWDBG = () => [...instancer.pools.values()].filter((p) => p.n > 0 && p.shadow).slice(0, 40)
  .map((p) => p.name + ': main ' + p.mesh.count + '/' + (p.mesh2 ? p.mesh2.count : '-') + ' shadow ' + p.shadow.count + '/' + (p.shadow2 ? p.shadow2.count : '-') + ' far ' + (p.far ? p.far.count : '-') + ' n ' + p.n);
// snap the shot camera to the nearest traffic junction: offset (dx, dz) metres
// from the node, dy above the sidewalk, looking at the node with the given pitch
window.__GOTO_NODE = (dx = 14, dz = 10, dy = 1.7, pitch = -0.12) => {
  if (Number.isNaN(dx)) dx = 'corner';
  const t = window.__gtRefs?.traffic;
  if (!controller) return 'no controller';
  const cx = controller.pos.x, cz = controller.pos.z;
  let best = null, bd = 1e9;
  if (t && t._nkGrid) {
    // node positions live in the canonical-key grid; keep real junctions (3+ legs)
    for (const arr of t._nkGrid.values()) {
      for (const p of arr) {
        const n = t.nodes.get(p.k);
        if (!n || !n.out || n.out.length < 3) continue;
        const d = Math.hypot(p.x - cx, p.z - cz);
        if (d < bd) { bd = d; best = p; }
      }
    }
  }
  if (!best) {
    // traffic not up yet (slow loads): fall back to the tiles' signalized junction nodes
    for (const rec of streamer.tiles.values()) {
      for (const n of (rec.data && rec.data.nodes) || []) {
        if (!n.signal) continue;
        const d = Math.hypot(n.x - cx, n.z - cz);
        if (d < bd) { bd = d; best = { x: n.x, z: n.z }; }
      }
    }
  }
  if (!best) return 'no node';
  let gx = best.x + dx, gz = best.z + dz;
  if (dx === 'corner' || dx === 0 && dz === 'corner') {
    // stand on a corner sidewalk: of 48 points on a ring around the node, take
    // the one farthest from every roadway (distance to edge centreline - half width)
    const R = typeof dy === 'number' && dy > 3 ? dy : 15;
    const edges = [...t.edges.values()].filter((e) => Math.hypot(e.pts[0][0] - best.x, e.pts[0][2] - best.z) < 80 || Math.hypot(e.pts[e.pts.length - 1][0] - best.x, e.pts[e.pts.length - 1][2] - best.z) < 80);
    const clear = (x, z) => {
      let m = 1e9;
      for (const e of edges) {
        const P = e.pts;
        for (let i = 1; i < P.length; i++) {
          const ax = P[i - 1][0], az = P[i - 1][2], bx = P[i][0], bz = P[i][2];
          const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9;
          const tt = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
          const d = Math.hypot(x - (ax + vx * tt), z - (az + vz * tt)) - e.width / 2;
          if (d < m) m = d;
        }
      }
      return m;
    };
    let bestA = 0, bestC = -1e9;
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const c = clear(best.x + Math.cos(a) * R, best.z + Math.sin(a) * R);
      if (c > bestC) { bestC = c; bestA = a; }
    }
    gx = best.x + Math.cos(bestA) * R; gz = best.z + Math.sin(bestA) * R;
    dy = 1.7;
  }
  const g = streamer.terrainAt(gx, gz);
  controller.pos.set(gx, (g ?? controller.pos.y) + 0.3 + dy, gz);
  controller.yaw = Math.atan2(-(best.x - gx), -(best.z - gz));
  controller.pitch = pitch;
  if (controller.vel) controller.vel.set(0, 0, 0);
  return { node: [Math.round(best.x), Math.round(best.z)], dist: Math.round(bd), cam: [Math.round(gx), +controller.pos.y.toFixed(1), Math.round(gz)] };
};
// NM24 harness: jump the camera (world x, y, z, yaw, pitch) mid-session, the way an API client or a fast flight does
window.__TELEPORT = (x, y, z, yaw, pitch) => {
  if (!controller) return 'no controller';
  controller.pos.set(x, y, z);
  if (yaw !== undefined) controller.yaw = yaw;
  if (pitch !== undefined) controller.pitch = pitch;
  if (controller.vel) controller.vel.set(0, 0, 0);
  return [x, y, z];
};
// the same tear-proof capture outside record mode (the record-mode hook above keeps its own definition)
if (!window.__capture) window.__capture = (type = 'image/jpeg', q = 0.95) => engine.capture(type, q);
// frame profile: average ms per frame per subsystem (needs ?prof=1)
window.__PROF_RESET = () => { const P = engine.prof; if (P) { P.n = 0; P.t = {}; } engine.profRender = null; };
window.__PROF = () => {
  const P = engine.prof;
  if (!P || !P.n) return 'no profile (?prof=1)';
  const out = { frames: P.n };
  for (const [k, v] of Object.entries(P.t)) out[k] = +(v / P.n).toFixed(2);
  if (engine.profRender) { out.render = +(engine.profRender.t / Math.max(1, engine.profRender.n)).toFixed(2); out.frame = +(engine.profRender.f / Math.max(1, engine.profRender.n)).toFixed(2); }
  out.batches = instancer.subCount ? instancer.subCount() : null;
  if (instancer.stats) { out.inst = instancer.stats.mainInst; out.shInst = instancer.stats.shadowInst; out.cullMs = +instancer.stats.cullMs.toFixed(2); }
  return out;
};
// NYC dresser diagnostics: active/queued counts, build time, pool draw calls
// FP26: the recorder grows the dresser's set along a take's path, then freezes it for the capture ('grow' | 'freeze' | null)
window.__DRESS_HOLD = (mode) => { streamer.hold = mode || null; if (!dresser) return null; dresser.hold = mode || null; return dresser.hold; };   // FP26: the tile streamer holds with the dresser
window.__DRESS = () => dresser ? {
  active: dresser.active.size, queued: dresser.queue.length, built: dresser.stats.built,
  skipped: dresser.stats.skipped, msPerBuild: dresser.stats.built ? +(dresser.stats.ms / dresser.stats.built).toFixed(1) : 0,
  drawCalls: dresser.drawCalls(), tiles: dresser.tiles.size,
  recs: [...dresser.tiles.values()].reduce((a, t) => a + t.recs.length, 0),
  night: dresser._nightOn,
  buckets: dresser.pools.buckets ? [...dresser.pools.buckets.entries()].map(([k, b]) => k + ' live=' + b.live + ' vis=' + b.mesh.visible) : null,
} : 'no dresser';
// perf snapshot: fps + renderer counters accumulated over one full frame
// (info auto-resets per render pass, so a sync read only sees the last pass)
window.__PERF = () => new Promise((res) => {
  const info = engine.renderer.info;
  info.autoReset = false;
  info.reset();
  const f0 = engine.frames;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const n = Math.max(1, engine.frames - f0);
    const out = {
      fps: +engine.fps.toFixed(1),
      frames: n,
      calls: Math.round(info.render.calls / n),
      tris: Math.round(info.render.triangles / n),
      geoms: info.memory.geometries,
      texs: info.memory.textures,
      progs: info.programs.length,
    };
    info.autoReset = true;
    res(out);
  }));
});
// triangle census by object/pool name (visible meshes; instances multiplied)
window.__SCENE = (top = 24) => {
  const agg = {};
  engine.scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    const g = o.geometry;
    const n = (g.index ? g.index.count : g.attributes.position ? g.attributes.position.count : 0) / 3;
    if (o.isBatchedMesh) {
      let tri = 0;
      const gi = o._geometryInfo || [], ii = o._instanceInfo || [];
      for (const it of ii) { if (it.active && it.visible && gi[it.geometryIndex]) tri += (gi[it.geometryIndex].indexCount || gi[it.geometryIndex].vertexCount) / 3; }
      const key = 'batch:' + (o.material?.name || o.material?.type);
      agg[key] = (agg[key] || 0) + tri;
      return;
    }
    const inst = o.isInstancedMesh ? o.count : 1;
    const key = o.isInstancedMesh
      ? (o.name || `inst[${Math.round(n)}tri x${inst}]`)
      : (o.name || o.material?.name || o.parent?.name || 'anon');
    agg[key] = (agg[key] || 0) + n * inst;
  });
  return Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, top)
    .map(([k, v]) => `${k}=${(v / 1e6).toFixed(2)}M`);
};
// motion-shimmer meter: mean |Δ| between two frames half-a-pixel of yaw apart
window.__SHIMMER = (dyaw = 0.0005) => {
  const gl = engine.renderer.domElement;
  const cv = document.createElement('canvas');
  cv.width = 600; cv.height = 400;
  const c2 = cv.getContext('2d');
  const grab = () => {
    engine.composer.render();
    c2.drawImage(gl, gl.width / 2 - 300, gl.height / 2 - 200, 600, 400, 0, 0, 600, 400);
    return c2.getImageData(0, 0, 600, 400).data.slice();
  };
  const a = grab();
  engine.camera.rotateY(dyaw);
  const b = grab();
  engine.camera.rotateY(-dyaw);
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  return sum / (a.length / 4) / 3;
};
window.__PICK = async (nx, ny) => {
  const { Raycaster, Vector2 } = await import('three');
  const rc = new Raycaster();
  rc.setFromCamera(new Vector2(nx * 2 - 1, -(ny * 2 - 1)), engine.camera);
  const hits = rc.intersectObjects(engine.scene.children, true).slice(0, 3);
  return hits.map((h) => ({
    d: +h.distance.toFixed(1),
    name: h.object.name || h.object.parent?.name || h.object.type,
    mat: h.object.material?.type,
    geoV: h.object.geometry?.attributes?.position?.count,
    inst: h.instanceId ?? null,
    mid: h.face && h.object.geometry?.attributes?.matId ? h.object.geometry.attributes.matId.getX(h.face.a) : null,
    // facade vertex attributes at the hit (materials.js facade shader: aux = floorH, winW, storeH, style; aux2 = bldgH,
    // litAmt, cvar, flags; aux3 = wallLen, wallSeed, faceH/door pack)
    fac: h.face && h.object.geometry?.attributes?.aux ? ['aux', 'aux2', 'aux3'].map((k) => { const at = h.object.geometry.attributes[k]; return at ? Array.from({ length: at.itemSize }, (_, c) => +at.getComponent(h.face.a, c).toFixed(3)) : null; }) : null,
    x: +h.point.x.toFixed(1),
    y: +h.point.y.toFixed(2),
    z: +h.point.z.toFixed(1),
  }));
};
window.__TRAFFIC = () => {
  if (!window.__gtRefs?.traffic) return 'no traffic ref';
  const t = window.__gtRefs.traffic;
  const edges = [...t.edges.values()];
  return {
    edges: t.edges.size, cars: t.cars.length, target: t.target,
    minor: edges.filter((e) => e.minor).length,
    len25: edges.filter((e) => e.len >= 25).length,
    pools: Object.entries(t.pools).map(([k, p]) => `${k}:${p.n}/${p.cap}`).join(' '),
  };
};
window.__HIDE = (name, idx, vis = false) => {
  const o = name === 'macro' ? streamer.macroGroup
    : name === 'water' ? engine.scene.children.find((c) => c.geometry?.attributes?.position?.count === 4 && c.material?.type === 'ShaderMaterial')
    : engine.scene.getObjectByName(name);
  if (!o) return 'no ' + name;
  const c = idx === -1 ? o : o.children[idx];
  if (!c) return 'no child ' + idx;
  c.visible = vis;
  return (c.material?.type ?? c.type) + ' geoV=' + (c.geometry?.attributes?.position?.count ?? 0);
};
window.__TILE = (name) => {
  const g = engine.scene.getObjectByName(name);
  if (!g) return 'no group ' + name;
  return g.children.map((c) => ({
    name: c.name, type: c.type, mat: c.material?.type,
    geoV: c.geometry?.attributes?.position?.count ?? null,
    hasMatId: !!c.geometry?.attributes?.matId, kids: c.children?.length ?? 0,
  }));
};
window.__PROBE = (x, z) => {
  const key = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`;
  const rec = streamer.tiles.get(key);
  return {
    key, state: rec?.state ?? 'absent', inManifest: !!streamer.manifest?.tiles[key],
    terrain: streamer.terrainAt(x, z), outstanding: streamer.outstanding,
    tiles: streamer.tiles.size, camY: engine.camera.position.y,
  };
};
function flash(text) {
  hud.msg.textContent = text;
  hud.msg.style.opacity = 0.95;
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (hud.msg.style.opacity = 0), 1600);
}
boot();
