// AR34 part (city/areas.js) lk: the street's life along 125th Street and in Hunters Point, modelled and placed to the
// kick scooters and delivery bikes, sidewalk sheds and scaffolding, piled rubbish bags, sandwich boards and A-frames,
// cafe seating. The props part (city/pk) keeps the fixed street hardware (lamps, signals, signs, baskets, kiosks, bus
// stops, racks, docks, hydrants, meters, planters, tree guards, subway entrances). Notes: docs/notes/ar34-life.md.
// `?lk=0` leaves the part out.
//
// PLACEMENT. lkData.js holds every surveyed piece in world metres (baked by client/tools/ar34/life/bake.mjs from
// BUILD. Per tile, per 96 m cell: every piece's model (lkKit.js) is posed and merged into one mesh per material, a near
// model and a far one; a cell draws its far model while the camera is more than LOD_R from its box. Only the large
// pieces (canopies, cloth, the shed's deck and parapet) cast shadows.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LOD } from './lkGeo.js';
import * as K from './lkKit.js';
import { lkMat, lkEnvSync, lkTick, lkMatsReady } from './lkMats.js';
import { LK_ITEMS } from './lkData.js';
import { COLLIDERS } from '../colliders.js';
import { DK04, dkSetBack, dkShed } from '../pk/props.js';   // DK04: kerb setback and sheds cut to their frontage

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const LK = !(Q && Q.get('lk') === '0');
export const ready = lkMatsReady;

// ---------------------------------------------------------------- the models, by kind and variant
const MODELS = new Map();
function build1(kind, p, q) {
  const fn = K[kind];
  if (typeof fn !== 'function') return null;
  const M = fn(q, p);
  // a table carries its goods; a flat cart its tote
  if (kind === 'table' && p.goods) M.put(K.goods(q, { kind: p.goods, w: (p.w || 1.83) - 0.1, d: (p.d || 0.76) - 0.08, y: (p.h || 0.74) + (p.cloth !== undefined ? 0.008 : 0.002), seed: (p.seed || 1) * 7 }));
  if (kind === 'cageCart' && p.tub) M.put(K.tub(q, { col: p.tub }), 0, 0.16, 0);
  return M;
}
function modelFor(kind, p, q) {
  const key = kind + '|' + JSON.stringify(p || {}) + '|' + q;
  let m = MODELS.get(key);
  if (m !== undefined) return m;
  LOD.far = !q;
  let M = null;
  try { M = build1(kind, p || {}, q); } catch (e) { console.warn('[lk] model', kind, e); }
  LOD.far = false;
  m = M ? M.bake() : null;
  MODELS.set(key, m);
  return m;
}
const CAST = new Set(['fab', 'canopy', 'valance', 'deck', 'beam', 'ply', 'plyFace', 'tarp', 'glossBlack', 'glossOrange']);
// footprints the walkers go round: [hw, hd, hh] in model space (x along, z front)
const FOOT = { produceStall: (p) => [(p.len || 8.4) / 2, 1.3, 1.2, -0.85], table: (p) => [(p.w || 1.83) / 2 + 0.05, (p.d || 0.76) / 2 + 0.05, 0.45, 0],
  cageCart: (p) => [(p.w || 1.1) / 2, (p.d || 0.62) / 2, 0.6, 0], clothesRack: (p) => [(p.w || 1.5) / 2 + 0.1, 0.35, 0.9, 0],
  gridPanel: (p) => [(p.w || 1.2) / 2, 0.15, 0.9, 0], barrier: () => [1.2, 0.3, 0.55, 0], moped: () => [0.3, 0.95, 0.6, 0], motorcycle: () => [0.35, 1.0, 0.6, 0], ebike: () => [0.25, 0.8, 0.5, 0],
  tarpWall: (p) => (p.hem || 0.15) > 0.5 ? null : [(p.w || 3) / 2, 0.12, 1.0, 0], airDancer: () => [0.3, 0.3, 1.0, 0], monobloc: () => [0.3, 0.3, 0.45, 0],
  chair: () => [0.25, 0.25, 0.45, 0], aframe: () => [0.33, 0.3, 0.5, 0], boards: () => [0.35, 0.2, 0.8, 0.15], tote: () => [0.4, 0.28, 0.4, 0],
  foodCart: () => [0.95, 0.5, 0.6, 0], tent: (p) => null, tarpHeap: (p) => [(p.w || 1) / 2, (p.d || 0.6) / 2, 0.2, 0], cooler: () => [0.32, 0.21, 0.21, 0] };
const _coll = new Set();
// the far model (past LOD_R, a few pixels) draws its plain dark pieces in one key and its plain grey metals in another
const FAR_KEY = { plasBlack: 'black', glossBlack: 'black', beam: 'black', rubber: 'black', nylonBlack: 'black', bagBlack: 'black', seat: 'black',
  galv: 'galvDull', alu: 'galvDull', stainless: 'galvDull', steelCart: 'galvDull', chrome: 'galvDull', plasGrey: 'galvDull', lensClear: 'galvDull' };

// ---------------------------------------------------------------- per-frame state
let _frame = -1;
function tick(renderer, scene) {
  const f = renderer.info.render.frame;
  if (f === _frame) return;
  _frame = f;
  lkEnvSync(scene);
  lkTick();
}

// ---------------------------------------------------------------- the tile's meshes
// SPACE r2: in a scene (its parents reach a Scene): the stats list keeps only these
const inScene = (o) => { let p = o; while (p.parent) p = p.parent; return !!p.isScene; };
const CELL = 96, LOD_R = 110, SIDEWALK_Y = 3.52;
// DK04 (2026-11-04): the bases the kerb setback keeps on the flags (pk/props.js dkSetBack); the pieces left out here stand
// in the roadway by design (motorcycles and mopeds in the parking lane, the barriers) or carry `road`
const DK_R = { table: 0.55, umbrella: 0.2, ebike: 0.45, aframe: 0.4, boxes: 0.45, chair: 0.32, cageCart: 0.6, tent: 1.1, clothesRack: 0.55,
  bags: 0.4, tote: 0.35, gridPanel: 0.35, foodCart: 0.85, handTruck: 0.4, tub: 0.35, monobloc: 0.32, tarpWall: 0.3, produceStall: 0.9,
  pallet: 0.6, tarpHeap: 0.6, airDancer: 0.3, boards: 0.35 };
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
let _bins = null;
function bins() {
  if (_bins) return _bins;
  _bins = new Map();
  for (const r of LK_ITEMS) {
    const k = `${Math.floor(r[1] / 512)}_${Math.floor(r[2] / 512)}`;
    let b = _bins.get(k);
    if (!b) _bins.set(k, (b = []));
    b.push(r);
  }
  return _bins;
}
function groundY(ctx, x, z) {
  const y = ctx.padYNear(x, z);
  // the compiled roadway reaches past the real kerb in places: a piece on that strip stands on the sidewalk's datum
  if (y === null || y === undefined || y < SIDEWALK_Y - 0.05) return SIDEWALK_Y;
  return y;
}
export function build(group, ctx) {
  if (!LK) return;
  const list = bins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`);
  if (!list || !list.length) return;
  const cells = new Map();
  // DK04: the pieces as placed, by tile, for placement audits (window.__LK_PLACED)
  const dkPlaced = typeof window !== 'undefined' ? ((window.__LK_PLACED = window.__LK_PLACED || {})[ctx.key] = []) : null;
  for (const r of list) {
    let [kind, x, z, yaw, p] = r;
    if (DK04 && DK_R[kind] && !(p && p.road)) { const at = dkSetBack(ctx, x, z, DK_R[kind]); if (!at) continue; [x, z] = at; }
    if (DK04 && kind === 'shed' && p && p.len) { const sh = dkShed(ctx, x, z, yaw, p, p.dep || 4.6); if (!sh) continue; [x, z, p] = sh; }
    const y = p && p.road ? (ctx.padYNear(x, z) ?? SIDEWALK_Y - 0.15) : groundY(ctx, x, z);
    if (dkPlaced) dkPlaced.push([kind, x, z, yaw, p && p.len ? p.len : 0, p && p.road ? 1 : 0]);
    const ck = `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
    let C = cells.get(ck);
    if (!C) cells.set(ck, (C = { items: [], box: new THREE.Box3(), near: null }));
    C.items.push({ kind, p, x, y, z, yaw });
    const reach = Math.max(3, p && p.len ? p.len / 2 + 3 : 3);
    C.box.expandByPoint(_p.set(x - reach, y, z - reach));
    C.box.expandByPoint(_p.set(x + reach, y + 6, z + reach));
    const F = FOOT[kind], fb = F ? F(p || {}) : null;
    if (fb && !_coll.has(p.id)) {
      _coll.add(p.id);
      const [hw, hd, hh, dz] = fb;
      const cx = x + Math.sin(yaw) * dz, cz = z + Math.cos(yaw) * dz;
      try { COLLIDERS.addBox('lk', { x: cx, y: y + hh, z: cz, hw, hh, hd, rotY: -yaw }); } catch (e) { /* the walkers' grid may not take boxes yet */ }
    }
  }
  const posed = (C, q) => {
    const dst = new Map();
    for (const it of C.items) {
      const m = modelFor(it.kind, it.p, q);
      if (!m) continue;
      _m4.compose(_p.set(it.x, it.y, it.z), _q.setFromAxisAngle(_Y, it.yaw), _one);
      for (const [k0, g] of Object.entries(m.parts)) {
        const key = q ? k0 : (FAR_KEY[k0] || k0);
        let L = dst.get(key);
        if (!L) dst.set(key, (L = []));
        L.push(g.clone().applyMatrix4(_m4));
      }
    }
    const out = new Map();
    for (const [key, L] of dst) {
      const g = mergeGeometries(L, false);
      if (!g) continue;
      g.boundingBox = C.box.clone(); g.boundingSphere = C.box.getBoundingSphere(new THREE.Sphere());
      out.set(key, g);
    }
    return out;
  };
  const drive = [];
  // SPACE r2 (docs/notes/space-r2.md): the stats list below kept every mesh it was ever given, and through mesh.parent every
  // unloaded tile's group with all its geometry (1.7 GB a tour cycle); it now keeps the meshes still in a scene
  if (typeof window !== 'undefined' && window.__LK && window.__LK.meshes) window.__LK.meshes = window.__LK.meshes.filter(inScene);
  for (const C of cells.values()) {
    const far = posed(C, 0);
    const keys = new Set(far.keys());
    for (const it of C.items) { const m = modelFor(it.kind, it.p, 1); if (m) for (const k of Object.keys(m.parts)) keys.add(k); }
    const getNear = () => C.near || (C.near = posed(C, 1));
    const box = C.box;
    const empty = new THREE.BufferGeometry();
    empty.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
    empty.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    empty.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
    empty.boundingBox = box.clone(); empty.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
    for (const key of keys) {
      const gf = far.get(key) || empty;
      const mesh = new THREE.Mesh(gf, lkMat(key));
      mesh.name = 'lk:' + key;
      mesh.castShadow = CAST.has(key);
      mesh.receiveShadow = true;
      mesh.visible = gf !== empty;
      // the stats mark the meshes the view's camera actually drew (frustum culling included)
      mesh.onBeforeRender = (renderer, scene, cam) => { if (cam.isPerspectiveCamera && cam.aspect > 1.2) mesh.userData.lkFrame = renderer.info.render.frame; };
      drive.push({ mesh, key, gf, box, getNear, empty, C });
      group.add(mesh);
      if (typeof window !== 'undefined') (window.__LK = window.__LK || { tiles: 0, items: 0 }, (window.__LK.meshes = window.__LK.meshes || []).push(mesh));
    }
  }
  // One driver per tile: an always-listed empty triangle whose hook sets every cell mesh's near / far geometry for the view's
  // own camera (aspect over 1.2) and hides the meshes with nothing to draw at that range (an empty mesh still cost a draw
  // call). three draws the geometry it listed before a hook runs, so a switch lands on the next frame; the square light-probe
  // and cube passes no longer switch anything (they used to leave the far model in place for the view's draw: round 3, the
  // snack cart drawn far at 7 m on lkQ1174 / lkC1167 while the stats counted the near one).
  const dg = new THREE.BufferGeometry();
  dg.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
  dg.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
  dg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
  const drv = new THREE.Mesh(dg, lkMat('black'));
  drv.name = 'lk:driver';
  drv.frustumCulled = false;
  drv.onBeforeRender = (renderer, scene, cam) => {
    tick(renderer, scene);
    if (!cam.isPerspectiveCamera || !(cam.aspect > 1.2)) return;
    // FP37 (core/engine.js, the film policy): while recording, the take's nearest approach to the cell decides, once per take
    const fp = typeof window !== 'undefined' && window.__FP37 && window.__FP37.pts ? window.__FP37 : null;
    for (const D of drive) {
      let far;
      if (fp) {
        if (D.fpV !== fp.v) {
          let d = Infinity;
          for (let j = 0; j < fp.pts.length; j += 3) d = Math.min(d, D.box.distanceToPoint(_p.set(fp.pts[j], fp.pts[j + 1], fp.pts[j + 2])));
          D.fpV = fp.v; D.fpFar = d > LOD_R;
        }
        far = D.fpFar;
      } else far = D.box.distanceToPoint(cam.position) > LOD_R;
      const g = far ? D.gf : (D.getNear().get(D.key) || D.empty);
      if (D.mesh.geometry !== g) D.mesh.geometry = g;
      D.mesh.visible = g !== D.empty;
    }
  };
  group.add(drv);
  // SPACE r2: the tile's dispose() (world/assemble.js) disposes the geometry each mesh draws at that moment; the other one of
  // each near / far pair (and the cells' merged sets) go here
  drv.userData.onDispose = () => {
    if (typeof window !== 'undefined' && window.__LK && window.__LK.meshes) { const mine = new Set(drive.map((D) => D.mesh)); window.__LK.meshes = window.__LK.meshes.filter((m) => !mine.has(m)); }
    const seen = new Set();
    for (const D of drive) {
      for (const g of [D.gf, D.empty, ...(D.C.near ? D.C.near.values() : [])]) if (g && !seen.has(g)) { seen.add(g); g.dispose(); }
    }
    dg.dispose();
  };
  if (typeof window !== 'undefined') {
    const W = (window.__LK = window.__LK || { tiles: 0, items: 0 });
    W.tiles++; W.items += list.length;
    W.stats = stats;
  }
}
// the part's cost in the last drawn frame (bshot --evalfile tools/ar34/life/stats_eval.js): the meshes the view's camera drew
// (aspect over 1.2: the square light-probe / cube passes are left out),
// their triangles (the geometry each drew: near or far), per material key
function stats() {
  const W = window.__LK, ms = (W && W.meshes) || [];
  let last = -1;
  for (const m of ms) if ((m.userData.lkFrame ?? -1) > last) last = m.userData.lkFrame;
  const byKey = {};
  let calls = 0, tris = 0;
  for (const m of ms) {
    if (m.userData.lkFrame !== last || !m.visible) continue;
    const g = m.geometry, n = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
    if (n <= 1) continue;
    calls++; tris += n;
    const k = m.name.slice(3);
    byKey[k] = (byKey[k] || 0) + n;
  }
  return { tiles: W.tiles, items: W.items, meshes: ms.length, calls, tris, byKey };
}
