// AR33 part (city/areas.js) pk: street furniture and props along 125th Street and in Hunters Point, modelled and placed
// to the references (lamps, signals, signs, litter baskets and compactors, Link kiosks, bus stops and SBS fare machines,
// racks, docks, hydrants, meters, planters, tree guards, sheds, subway entrances, vendors' carts). `?pk=0` restores the
// compiled furniture. Owner: the PROPS worker (docs/notes/ar33-props.md).
//
// PLACEMENT. pkData.js holds every surveyed piece in world metres (baked by client/tools/ar33/props/bake.mjs from
// the compiled city's furniture of the kinds this part draws is dropped (dropFurniture) and this part's own is built.
// BUILD. Per tile, per 96 m cell: every piece's model (pkKit.js) is posed and merged into one mesh per material, a near
// model and a far one; a cell draws its far model while the camera is more than LOD_R from its box.
// BEHAVIOUR. The lamps join world/cityLamps.js through lampSpots (world/life.js), at their real head height and arm yaw.
// The signal lenses and pedestrian heads run on the traffic clock (sim/signals.js signalState / walkTimeLeft, the clock
// window.__TRAFFIC.time that the cars and the walkers use), by the axis each head serves. The benches and the shelters'
// seats are seats for the crowd (seats()).
import { HA_ON, haLift } from '../../world/haAnchor.js';   // P1 TERRAIN (`?terrain=p1`)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURN } from '../../shared/geo.js';
import { ENV } from '../../world/materials.js';
import { lampSpots } from '../../world/life.js';
import { lampKind } from '../../world/night11.js';
import { signalState, walkTimeLeft } from '../../sim/signals.js';
import { LOD } from './pkGeo.js';
import * as K1 from './pkKit.js';
import * as K2 from './pkStreet.js';
import { pkMat, pkGlow, pkFace, pkGlass, pkEnvSync, pkMatsReady, pkFarMat, pkTint } from './pkMats.js';
import * as ART1 from './pkArt.js';
import * as ART2 from './pkArt2.js';
import { regTex, mutTex, poleTagTex, poleGrimeTex, stripTex, busDiscTex, busRouteTex, busDestTex, busTimesTex, meshTex, plateBackTex, signsReady } from './pkSigns.js';
const K = { ...K1, ...K2, sub38 };
const ART = { ...ART1, ...ART2 };
import { PK_ITEMS, PK_ZONES, PK_CORR } from './pkData.js';
import { accessDrop } from '../stations/irt125.js';
// ST38 (STATIONS2): the subway entrances at Lenox and St Nicholas Avenues as built, and the sidewalk at the Lenox corners
import { ST38, st38Rows, st38Replaces, st38Inside, st38Apply, sub38, sub38SignTex, sub38SubwayTex } from '../stations/subEnt38.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const PK = !(Q && Q.get('pk') === '0');
export const ready = Promise.all([pkMatsReady, signsReady]);
// QA36 (QA round 4, 2026-10-02; `?qa36=0` as before): the two 8 m pole lamps on 125th Street under the Park Avenue viaduct
// stood at street level and rose through its deck (support audit tools/qa/support_audit.js: pk:galv through vk-parkDark at
// y 9.43; the heads stood over the tracks beside the platform): left out, the street under the viaduct is lit from it
export const QA36 = !(Q && Q.get('qa36') === '0');
const QA36_DROP = [['lamp', 2706.66, -2454.64], ['lamp', 2723.97, -2444.92]];
const qa36Drop = (r) => QA36 && QA36_DROP.some(([k, x, z]) => r[0] === k && Math.abs(r[1] - x) < 0.05 && Math.abs(r[2] - z) < 0.05);
// FX36 (AR34 fixes, QA round 4, 2026-10-02; `?fx36=0` as before):
//   shelter there, its east end ~3.5 m west of the site bridge's west posts, where the west record (len 4.5) stands; the east
//   record's shelter stood under the bridge with the bridge's posts through its roof (pk:shelterFrame): left out
// - the two signal masts under the Park Avenue viaduct (s33, s34): the 7.1 m pole and the arm rising to 7.65 m over the foot
//   reached into the girders (vk-parkDark at y 9.43): pole, clamp and arm kept under FX36_TOP (world y)
export const FX36 = !(Q && Q.get('fx36') === '0');
const FX36_TOP = 9.2;
const FX36_DROP = [['shelter', 2890.89, -2329.26]];
const FX36_LOW = [['signal', 2709.34, -2455.47], ['signal', 2723.28, -2447.64]];
const at36 = (r, k, x, z) => r[0] === k && Math.abs(r[1] - x) < 0.05 && Math.abs(r[2] - z) < 0.05;
function fx36Row(r, ctx) {
  if (!FX36) return r;
  if (FX36_DROP.some(([k, x, z]) => at36(r, k, x, z))) return null;
  if (FX36_LOW.some(([k, x, z]) => at36(r, k, x, z))) {
    const room = FX36_TOP - groundY(ctx, r[1], r[2], !(r[4] && r[4].road));   // metres over the foot
    return [r[0], r[1], r[2], r[3], { ...(r[4] || {}), poleH: Math.min(7.1, room - 0.12), armY: Math.min(6.05, room - 0.75), rise: 0.04 }];
  }
  return r;
}

// ---------------------------------------------------------------- the corridor frame (station / offset, + north)
const CUM = [0];
for (let i = 1; i < PK_CORR.length; i++) CUM.push(CUM[i - 1] + Math.hypot(PK_CORR[i][0] - PK_CORR[i - 1][0], PK_CORR[i][1] - PK_CORR[i - 1][1]));
export function pkCorr(x, z) {
  let best = null;
  for (let i = 0; i + 1 < PK_CORR.length; i++) {
    const [ax, az] = PK_CORR[i], [bx, bz] = PK_CORR[i + 1], len = CUM[i + 1] - CUM[i];
    if (len < 1e-6) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    const t = Math.max(0, Math.min(len, (x - ax) * dx + (z - az) * dz));
    const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) best = { d, s: CUM[i] + t, o: (x - px) * dz - (z - pz) * dx };
  }
  return best;
}
// a covered zone: [s0, s1, oMax] along the corridor, or { box: [x0, z0, x1, z1] } in world metres
function inZone(x, z) {
  let c = null;
  for (const Z of PK_ZONES) {
    if (Z.box) { if (x > Z.box[0] && x < Z.box[2] && z > Z.box[1] && z < Z.box[3]) return true; continue; }
    if (!c) c = pkCorr(x, z);
    if (c.s >= Z[0] && c.s <= Z[1] && Math.abs(c.o) <= Z[2]) return true;
  }
  return false;
}

// ---------------------------------------------------------------- the compiled furniture this part replaces
const DROP = new Set([FURN.LAMP_COBRA, FURN.LAMP_CROOK, FURN.SIGNAL_MAST, FURN.SIGNAL_PED, FURN.STREET_SIGN, FURN.LITTER,
  FURN.MAILBOX, FURN.BUS_SHELTER, FURN.LINKNYC, FURN.NEWSSTAND, FURN.BENCH, FURN.BIKE_RACK, FURN.PHONE, FURN.PLANTER,
  FURN.HYDRANT, FURN.CONE, FURN.CROSSING_BEACON, FURN.PARKING_METER, FURN.SUBWAY_ENTRANCE, FURN.SCAFFOLD, 34, 35, 36, 37, 38, 39]);
// AR34 STATIONS: the 1 train's 125 St entrance points on Broadway (escalators and the L stair, drawn by stations/irt125.js)
// stand outside the corridor's zones: the compiled furniture drew a sidewalk stair head (or one in the roadway) on each
const IRT125_PTS = [[1043.03, -3582.22], [1068.17, -3627.22], [1075.21, -3562.98], [1081.32, -3574.07]];
export function dropFurniture(wx, wz, f) {
  if (PK && f.k === FURN.SUBWAY_ENTRANCE) for (const [x, z] of IRT125_PTS) if (Math.hypot(wx - x, wz - z) < 3.0) return true;
  // and any compiled piece inside the station's footprints on Broadway's sidewalks (a lamp inside the south foot house)
  if (PK && accessDrop(wx, wz)) return true;
  // ST38: anything compiled standing in a stair or the elevator's footprint
  if (PK && st38Inside(wx, wz, 0.3)) return true;
  if (!PK || !DROP.has(f.k)) return false;
  return inZone(wx, wz);
}

// ---------------------------------------------------------------- the models, by kind and variant
// PK_ITEMS rows: [kind, x, z, yaw, p] (p: the kind's parameters; yaw: model +z toward it)
const MODELS = new Map();
function modelFor(kind, p, q) {
  const key = kind + '|' + (p ? JSON.stringify(p) : '') + '|' + q;
  let m = MODELS.get(key);
  if (m) return m;
  let M = null;
  LOD.far = !q;
  switch (kind) {
    case 'lamp': M = K.lamp(q, { banner: p && p.banner !== undefined ? p.banner : false, plates: p && p.plates, cams: !!(p && p.cams), camY: p && p.camY, paint: p && p.paint }); break;
    case 'signal': M = K.signalMast(q, p); break;
    case 'compactor': M = K.compactor(q); break;
    case 'basket': M = K.wireBasket(q); break;
    case 'linknyc': M = K.linkKiosk(q, p && p.ad || 0); break;
    case 'link5g': M = K.link5g(q, p && p.ad || 0); break;
    default: {
      const fn = K[kind];
      M = typeof fn === 'function' ? fn(q, p || {}) : null;
    }
  }
  LOD.far = false;
  m = M ? M.bake() : null;
  MODELS.set(key, m);
  return m;
}
// shadow casters: the tall pieces (a lamp, a signal, a shelter, a kiosk, a shed); small ones never cast
const CAST = new Set(['galv', 'greyPaint', 'yellowSig', 'stainless', 'aluDark', 'whitePaint', 'green', 'plywood', 'black', 'bbGreen', 'greenSub', 'shelterFrame', 'shelterRoof', 'shedDeck', 'shedFascia', 'scaffold', 'subGreen']);

// ---------------------------------------------------------------- materials for the special keys
const GROUPS = ['ew', 'ns'];
const LENS = { R: 0xff2a14, A: 0xffa20a, G: 0x19ff9a };
const LENS_OFF = { R: 0x3a0e0a, A: 0x3a2a08, G: 0x0c2a20 };
function matFor(key) {
  if (key === 'lum') return pkGlow('lum', 0xfff1dc, null, { base: 0xd8d6cf, rough: 0.3 });
  let m = /^lens([RAG])_(ew|ns)$/.exec(key);
  if (m) return pkGlow(key, LENS[m[1]], null, { base: LENS_OFF[m[1]], rough: 0.15 });
  m = /^ped(Hand|Man|Count)_(ew|ns)$/.exec(key);
  if (m) {
    // the symbols add their light over the head's dark face (the hand and the person share one place on it)
    const t = m[1] === 'Hand' ? ART.pedHandTex() : m[1] === 'Man' ? ART.pedManTex() : ART.pedCountTex(0);
    const g = pkGlow(key, 0xffffff, t, { base: 0x000000, map: null, rough: 0.3 });
    if (!g.userData.pkAdd) { g.userData.pkAdd = true; g.transparent = true; g.blending = THREE.AdditiveBlending; g.depthWrite = false; }
    return g;
  }
  if (key === 'pedDark') return pkFace('pedDark', ART.darkTex(), { rough: 0.3 });
  if (key === 'glassSh') return pkGlass();
  if (key === 'roofGlass') return pkGlass('roof');
  if (key === 'globeG' || key === 'globeR') return pkGlow(key, key === 'globeG' ? 0x49ff88 : 0xff4a3a, null, { base: key === 'globeG' ? 0x7fb98f : 0xc27d74, rough: 0.2 });
  m = /^face:(.*)$/.exec(key);
  if (m) {
    const n = m[1];
    // the regulation plates and the signal poles' signs (pkSigns.js): retroreflective sheeting reads a little glossy
    if (n.startsWith('park')) return pkFace(n, regTex(+n.slice(4) || 0), { rough: 0.34, metal: 0.05 });
    if (n.startsWith('mut')) return pkFace(n, mutTex(n.slice(3)), { rough: 0.34, metal: 0.05 });
    // the poles' wear sleeves (alpha-tested decals over the metal)
    if (n.startsWith('poleTags')) return pkFace(n, poleTagTex(+n.slice(8) || 0), { rough: 0.6, alphaTest: 0.5 });
    if (n === 'poleGrime') return pkFace(n, poleGrimeTex(), { rough: 0.85, alphaTest: 0.5 });
    if (n.startsWith('busStrip|')) return pkFace(n, stripTex(n.slice(9)), { rough: 0.35, metal: 0.05 });
    // the 2010s MTA bus-stop sign (pkStreet.js busStop2): the disc, the route and destination plates, the schedule
    if (n === 'busDisc') return pkFace(n, busDiscTex(), { rough: 0.34, metal: 0.05 });
    if (n.startsWith('busRoute|')) return pkFace(n, busRouteTex(n.slice(9).split(',')), { rough: 0.34, metal: 0.05 });
    if (n.startsWith('busDest|')) { const [d, st] = n.slice(8).split('|'); return pkFace(n, busDestTex(d.split(','), st), { rough: 0.34, metal: 0.05 }); }
    if (n === 'busTimes') return pkFace(n, busTimesTex(), { rough: 0.15, metal: 0.0 });
    if (n === 'mesh') return pkFace(n, meshTex(), { rough: 0.7, alphaTest: 0.4, side: THREE.DoubleSide });
    if (n.startsWith('plateBack')) return pkFace(n, plateBackTex(+n.slice(9) || 0), { rough: 0.6, metal: 0.15 });
    if (n === 'busRound') return pkFace(n, ART.busRoundTex(), { rough: 0.3, metal: 0.05 });
    if (n.startsWith('busBlade')) return pkFace(n, ART.busBladeTex(+n.slice(8) || 0), { rough: 0.3, metal: 0.05 });
    if (n === 'busInfo') return pkFace(n, ART.busInfoTex(), { rough: 0.35 });
    if (n === 'sbs') return pkFace(n, ART.sbsTex(), { rough: 0.3, metal: 0.05 });
    if (n === 'stairs') return pkFace(n, ART.stairsTex(), { rough: 0.85 });
    if (n.startsWith('sub38|')) { const [, ln, dr, nt] = n.split('|'); return pkFace(n, sub38SignTex(ln, dr || '', nt || ''), { rough: 0.35, metal: 0.05 }); }
    if (n === 'sub38s') return pkFace(n, sub38SubwayTex(), { rough: 0.35, metal: 0.05 });
    if (n.startsWith('subPlate')) return pkFace(n, ART.subPlateTex(n.slice(8) || '23'), { rough: 0.3, metal: 0.05 });
    if (n.startsWith('banner')) return pkFace(n, ART.bannerTex(+n.slice(6) || 0), { rough: 0.8, side: THREE.FrontSide });
    if (n.startsWith('sign')) return pkFace(n, ART.signTex(n.slice(4)), { rough: 0.35, metal: 0.1, emissive: 0xffffff, on: 0 });
    if (n === 'bb') return pkFace(n, ART.bbTex(), { rough: 0.5 });
    if (n === 'linkTop') return pkFace(n, ART.linkTopTex(), { rough: 0.3, emissive: 0xffffff, on: 0.35 });
    return pkMat('greyPaint');
  }
  m = /^screen:(.*)$/.exec(key);
  if (m) {
    const n = m[1];
    const t = n === 'tablet' ? ART.tabletTex() : ART.screenTex((+(n.replace(/\D/g, '')) || 0) * 2 + (n.endsWith('b') ? 1 : 0));
    // the kiosks' screens by day read darker than their art (b64_s, acpE): the ads at 0.55, the tablet as before
    return pkGlow('screen:' + n, 0xffffff, t, { base: 0x000000, map: t, rough: 0.12, on: n === 'tablet' ? 0.9 : 0.55 });
  }
  if (key === 'solar') return pkFace('solar', ART.solarTex(), { rough: 0.2, metal: 0.2 });
  if (key === 'trash') return pkMat('plastic');
  return pkMat(key);
}

// ---------------------------------------------------------------- per-frame state: night glow, signals, env
let _frame = -1;
const _groupsLit = { ew: '', ns: '' };
function tick(renderer, scene) {
  const f = renderer.info.render.frame;
  if (f === _frame) return;
  _frame = f;
  pkEnvSync(scene);
  const night = ENV.night.value;
  const lum = matFor('lum');
  const on = Math.min(1, Math.max(0, (night - 0.06) / 0.24));
  lum.emissiveIntensity = 3.2 * on * on * (3 - 2 * on);
  for (const gk of ['globeG', 'globeR']) matFor(gk).emissiveIntensity = 0.25 + 2.4 * on * on * (3 - 2 * on);
  const t = typeof window !== 'undefined' && window.__TRAFFIC ? window.__TRAFFIC.time : performance.now() / 1000;
  for (const g of GROUPS) {
    const st = signalState(t, g === 'ew');
    const left = walkTimeLeft(t, g === 'ew');
    // WALK while green with more than 7 s left, the countdown (flashing hand) to the end of green, the hand otherwise
    const walk = st === 'G' && left > 7, count = st === 'G' && !walk ? Math.ceil(left) : 0;
    const flash = count > 0 && (t % 1) < 0.5;
    const code = st + (walk ? 'w' : '') + count + (flash ? 'f' : '');
    if (code === _groupsLit[g]) continue;
    _groupsLit[g] = code;
    for (const L of ['R', 'A', 'G']) matFor(`lens${L}_${g}`).emissiveIntensity = st === L ? 2.4 : 0;
    matFor('pedMan_' + g).emissiveIntensity = walk ? 1.6 : 0;
    matFor('pedHand_' + g).emissiveIntensity = !walk && !flash ? 1.6 : 0;
    const cm = matFor('pedCount_' + g);
    const ct = ART.pedCountTex(count);
    if (cm.emissiveMap !== ct) { cm.emissiveMap = ct; cm.needsUpdate = true; }
    cm.emissiveIntensity = count > 0 ? 1.6 : 0;
  }
}

// CC37 (core/engine.js): a cube probe's face swapped the far model in and left it there. three draws the geometry it listed
// before the hooks ran, so the face drew the view's model anyway, and the view's next render listed (and the sun's shadow
// recorded frames, and on every stepped frame since RP37). The face's swap is undone after its draw (`?cc37=0` restores).
function pkHold(mesh) { if (!mesh.userData.pkView) mesh.userData.pkView = mesh.geometry; }
function pkBack() { const v = this.userData.pkView; if (v) { this.userData.pkView = null; this.geometry = v; } }

// ---------------------------------------------------------------- the part's own draws, for the plates' logs
// (bshot --evalfile: `__PK.stats()`): per camera that drew the part (the view's own, a probe's, a reflection's), the pk
// meshes drawn in its last completed render and their triangles, with the camera's position to tell them apart
const _cams = new Map();
function countDraw(renderer, g, cam) {
  const f = renderer.info.render.frame;
  let c = _cams.get(cam.uuid);
  if (!c) _cams.set(cam.uuid, (c = { f, calls: 0, tris: 0, last: null }));
  if (c.f !== f) { c.last = [c.calls, Math.round(c.tris)]; c.f = f; c.calls = 0; c.tris = 0; }
  c.calls++;
  c.tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  c.pos = [+cam.position.x.toFixed(1), +cam.position.y.toFixed(1), +cam.position.z.toFixed(1)];
}
let _meshes = 0;
if (typeof window !== 'undefined') {
  window.__PK = {
    stats: () => ({ cams: [..._cams.values()].map((c) => ({ pos: c.pos, callsTris: c.last || [c.calls, Math.round(c.tris)] })), meshes: _meshes, models: MODELS.size }),
  };
}

// ---------------------------------------------------------------- the far models flattened (batch 5)
// A corridor-long view drew one mesh per material key per far cell (398-552 calls for the part at qc_st, acpNW, acpE,
// qc_12th): a far cell's keys that neither glow, animate nor blend are merged into one mesh with each key's colour per
// vertex (the key's tint; a face's canvas texture averaged), one material for all. The lenses, the luminaire, the
// screens and the glass keep their own meshes. `?pkfar=0` restores the per-key far meshes for an A/B.
const FAR_FLAT = typeof location === 'undefined' || new URLSearchParams(location.search).get('pkfar') !== '0';
const FAR_KEEP = /^(lum|lens|ped(Hand|Man|Count)|globe|screen:|glassSh|roofGlass|face:(mesh|poleTags|poleGrime))/;
const _farCol = new Map();
function texMean(t) {
  try {
    const im = t && t.image;
    if (!im || !im.width || typeof document === 'undefined') return null;
    const c = document.createElement('canvas'); c.width = c.height = 8;
    const x = c.getContext('2d'); x.drawImage(im, 0, 0, 8, 8);
    const d = x.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] < 128) continue; r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    return n ? new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace) : null;
  } catch (e) { return null; }
}
function farColor(key) {
  let c = _farCol.get(key);
  if (c) return c;
  const tint = pkTint(key);
  if (tint !== null) c = new THREE.Color(tint);
  else {
    const m = matFor(key);
    c = (m && m.map && texMean(m.map)) || (m && m.color ? m.color.clone() : new THREE.Color(0x777777));
  }
  _farCol.set(key, c);
  return c;
}
function flattenFar(far, box) {
  const parts = [], keys = new Set();
  let cast = false;
  for (const [key, g] of far) {
    if (FAR_KEEP.test(key) || !g.attributes.position || !g.attributes.normal) continue;
    const src = g.index ? g.toNonIndexed() : g, n = src.attributes.position.count, col = farColor(key);
    const ng = new THREE.BufferGeometry(), ca = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { ca[i * 3] = col.r; ca[i * 3 + 1] = col.g; ca[i * 3 + 2] = col.b; }
    ng.setAttribute('position', src.attributes.position);
    ng.setAttribute('normal', src.attributes.normal);
    ng.setAttribute('color', new THREE.BufferAttribute(ca, 3));
    parts.push(ng); keys.add(key);
    if (CAST.has(key)) cast = true;
  }
  if (parts.length < 2) return null;
  const geo = mergeGeometries(parts, false);
  if (!geo) return null;
  geo.boundingBox = box.clone(); geo.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  return { geo, keys, cast };
}

// ---------------------------------------------------------------- the tile's meshes
const CELL = 192, LOD_R = 110;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
const SIDEWALK_Y = 3.52;
let _bins = null;
// AR34 STATIONS (docs/notes/ar34-stations.md): the compiled subway entrances are the MTA's entrance points of every type
// (data.ny.gov i9wp-a4ja, entrance_type), and every one was drawn as a sidewalk stair head with the 2 3 plate. The 1 train's
// 125 St escalator at Broadway is the station's own foot house (stations/irt125.js); the A B C D and 4 5 6 elevators are
// elevator kiosks (pkStreet.js subElev); each plate carries its station's lines (the MTA's daytime_routes order).
const SUB_NOT_STAIR = [[1068.17, -3627.22, null], [1546.51, -3076.30, 'subElev'], [2863.33, -2369.81, 'subElev']];
const SUB_LINES = [[1567.0, -3075.0, 60, 'ACBD'], [2167.0, -2743.0, 60, '23'], [2852.0, -2366.0, 60, '456']];
function subRow(r) {
  if (r[0] !== 'subway') return r;
  for (const [x, z, k] of SUB_NOT_STAIR) if (Math.hypot(r[1] - x, r[2] - z) < 1.5) { if (!k) return null; r = [k, r[1], r[2], r[3], { ...(r[4] || {}) }]; break; }
  for (const [x, z, rad, lines] of SUB_LINES) if (Math.hypot(r[1] - x, r[2] - z) < rad) return [r[0], r[1], r[2], r[3], { ...(r[4] || {}), lines, ...(r[0] === 'subway' && lines === '23' ? { display: 1, adv: Math.round(Math.abs(r[1])) % 6 } : {}) }];
  return r;
}
function bins() {
  if (_bins) return _bins;
  _bins = new Map();
  for (const r0 of PK_ITEMS.concat(st38Rows())) {
    // ST38: the stair heads and the kiosk these entrances replace, and the pieces in their footprints, are left out
    if (ST38 && r0[0] !== 'sub38' && !(r0[4] && r0[4].frame) && ((r0[0] === 'subway' && st38Replaces(r0[1], r0[2])) || st38Inside(r0[1], r0[2], 0.25))) continue;
    const r = r0[0] === 'sub38' || (r0[4] && r0[4].frame) ? r0 : subRow(r0);
    if (!r) continue;
    const k = `${Math.floor(r[1] / 512)}_${Math.floor(r[2] / 512)}`;
    let b = _bins.get(k);
    if (!b) _bins.set(k, (b = []));
    b.push(r);
  }
  return _bins;
}
const _seatByTile = new Map();
let _seatList = [];
const _lampSeen = new Set();
function groundY(ctx, x, z, onWalk) {
  const y = ctx.padYNear(x, z);
  // the compiled roadway reaches ~1.25 m past the real kerb here: a kerbside piece standing on that strip stands on
  // the sidewalk's datum (the street part lays the real kerb)
  const sw = HA_ON ? SIDEWALK_Y + haLift(x, z) : SIDEWALK_Y;   // P1 TERRAIN: the walk's datum lifted with the ground
  if (onWalk && (y === null || y < sw - 0.05)) return sw;
  return y ?? sw;
}
// LOD, once per frame from the view camera (not a probe's 90-degree cube faces): a cell within LOD_R draws its near
// models, else its far ones. A material key a cell has only in its near model draws EMPTY when far, a geometry whose
// bounds sit far below the world, so the frustum test drops it and it costs no draw call.
const EMPTY = new THREE.BufferGeometry();
EMPTY.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(9), 3));
EMPTY.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
EMPTY.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(6), 2));
EMPTY.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -1e6, 0), 0.01);
EMPTY.boundingBox = new THREE.Box3(new THREE.Vector3(0, -1e6, 0), new THREE.Vector3(0, -1e6, 0));
let _cellsLod = [], _lodFrame = -1;
const inScene = (o) => { while (o.parent) o = o.parent; return !!o.isScene; };
const _cp = new THREE.Vector3();
const _fp = new THREE.Vector3();
function lodUpdate(renderer, cam) {
  const f = renderer.info.render.frame;
  if (f === _lodFrame || Math.abs((cam.aspect || 1) - 1) < 0.05) return;
  _lodFrame = f;
  cam.getWorldPosition(_cp);
  let gone = 0;
  for (const L of _cellsLod) {
    // a tile's group leaves the scene when the tile unloads: its cells leave the list
    if (inScene(L.group)) L.seen = true; else if (L.seen) { L.dead = true; gone++; continue; }
    // FP37 (core/engine.js): while recording, the take's nearest approach to the cell decides, once per take
    const fp = typeof window !== 'undefined' && window.__FP37 && window.__FP37.pts ? window.__FP37 : null;
    let near;
    if (fp) {
      if (L.fpV !== fp.v) {
        let d = Infinity;
        for (let j = 0; j < fp.pts.length; j += 3) d = Math.min(d, L.box.distanceToPoint(_fp.set(fp.pts[j], fp.pts[j + 1], fp.pts[j + 2])));
        L.fpV = fp.v; L.fpNear = d <= LOD_R;
      }
      near = L.fpNear;
    } else near = L.box.distanceToPoint(_cp) <= LOD_R;
    if (near === L.near) continue;
    L.near = near;
    const N = near ? L.getNear() : null;
    for (const m of L.meshes) m.mesh.geometry = near ? (N.get(m.key) || EMPTY) : m.gf;
  }
  if (gone) _cellsLod = _cellsLod.filter((L) => !L.dead);
}
// ST38: the walk under the subway entrances (the opening of each stair cut out, the Lenox corners' sidewalk filled in)
export function apply(tile, ox, oz) { if (PK) st38Apply(tile, ox, oz); }

export function build(group, ctx) {
  if (!PK) return;
  const list = bins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`);
  if (!list || !list.length) return;
  const cells = new Map();
  const seats = [];
  for (const r of list) {
    if (qa36Drop(r)) continue;   // QA36
    const r36 = fx36Row(r, ctx);   // FX36
    if (!r36) continue;
    const [kind, x, z, yaw, p] = r36;
    const y = groundY(ctx, x, z, !(p && p.road));
    const ck = `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
    let C = cells.get(ck);
    if (!C) cells.set(ck, (C = { items: [], box: new THREE.Box3(), near: null }));
    C.items.push({ kind, p, x, y, z, yaw });
    // the cell's box holds every piece with its reach (a shed or a shelter is metres long)
    const reach = Math.max(3, p && p.len ? p.len / 2 + 2 : 3);
    C.box.expandByPoint(_p.set(x - reach, y, z - reach));
    C.box.expandByPoint(_p.set(x + reach, y + 10, z + reach));
    // behaviour
    if (kind === 'lamp' || (kind === 'signal' && p && p.lamp)) {
      const out = kind === 'lamp' ? K.LAMP.armOut + 0.35 : 2.5, hy = kind === 'lamp' ? K.LAMP.headY : 8.0;
      const hx = x + Math.sin(yaw) * out, hz = z + Math.cos(yaw) * out, lk = `${hx.toFixed(1)},${hz.toFixed(1)}`;
      if (!_lampSeen.has(lk)) { _lampSeen.add(lk); lampSpots.push([hx, y + 0.07, hz, lampKind(hx, hz, false), hy - 0.07, yaw]); }
    }
    if (p && p.seats) for (const [u, w] of p.seats) {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      seats.push({ x: +(x + u * c + w * s).toFixed(3), y: +y.toFixed(3), z: +(z - u * s + w * c).toFixed(3), yaw: +yaw.toFixed(4), seat: p.seatH || 0.45, kind: p.seatKind || 'bench', group: -1 });
    }
  }
  if (!_seatByTile.has(ctx.key)) { _seatByTile.set(ctx.key, seats); _seatList = [..._seatByTile.values()].flat(); }
  const posed = (C, q) => {
    // every piece's model of LOD q posed into the cell, merged per material key
    const dst = new Map();
    for (const it of C.items) {
      const m = modelFor(it.kind, it.p, q);
      if (!m) continue;
      _m4.compose(_p.set(it.x, it.y, it.z), _q.setFromAxisAngle(_Y, it.yaw), _one);
      for (const [key, g] of Object.entries(m.parts)) {
        let L = dst.get(key);
        if (!L) dst.set(key, (L = []));
        L.push(g.clone().applyMatrix4(_m4));
      }
    }
    const out = new Map();
    for (const [key, L] of dst) {
      const g = mergeGeometries(L, false);
      if (!g) continue;
      g.boundingBox = C.box.clone(); g.boundingSphere = C.box.getBoundingSphere(new THREE.Sphere());   // one bound for every geometry of the cell: culling never depends on the LOD shown
      out.set(key, g);
    }
    return out;
  };
  // SPACE r2 (docs/notes/space-r2.md): this tile's cells leave `_cellsLod` when the tile unloads (world/assemble.js calls the
  // hook): the per-frame prune in lodUpdate only ran while a prop of 125th Street was drawn, so away from there the list held
  // every unloaded tile's group and its geometry (1.2 GB a tour cycle); the near and far sets a mesh was not drawing go too
  const mine = [];
  const release = new THREE.Object3D();
  release.name = 'pk:release';
  release.userData.onDispose = () => {
    const set = new Set(mine);
    _cellsLod = _cellsLod.filter((L) => !set.has(L));
    const geos = new Set();
    for (const L of mine) {
      for (const m of L.meshes) if (m.gf) geos.add(m.gf);
      if (L.C.near) for (const g of L.C.near.values()) geos.add(g);
    }
    geos.delete(EMPTY);
    for (const g of geos) g.dispose();
  };
  group.add(release);
  for (const C of cells.values()) {
    // the far models are merged now; the near ones on the first frame the camera is within LOD_R of the cell (they are
    // several times the triangles and most cells are never visited)
    const far = posed(C, 0);
    // (batch 5) the far models' flat keys as ONE vertex-coloured mesh per cell (`?pkfar=0`: one mesh per key as before)
    const flat = FAR_FLAT ? flattenFar(far, C.box) : null;
    const keys = new Set(far.keys());
    for (const it of C.items) { const m = modelFor(it.kind, it.p, 1); if (m) for (const k of Object.keys(m.parts)) keys.add(k); }
    const L = { box: C.box, near: false, getNear: () => C.near || (C.near = posed(C, 1)), meshes: [], group, seen: false, C };
    mine.push(L);
    if (flat) {
      // the merged far mesh: drawn while the cell is far, EMPTY while near (its key is in no near model)
      const gf = flat.geo, mesh = new THREE.Mesh(gf, pkFarMat());
      mesh.name = 'pk:far';
      mesh.castShadow = flat.cast; mesh.receiveShadow = true;
      mesh.onBeforeRender = (renderer, scene, cam) => {
        tick(renderer, scene);
        if (!cam.isPerspectiveCamera) return;
        if (Math.abs((cam.aspect || 1) - 1) >= 0.05) {
          lodUpdate(renderer, cam);
          const want = L.near ? EMPTY : gf;
          if (mesh.geometry !== want) mesh.geometry = want;
        } else if (mesh.geometry !== gf) { if (cam.parent && cam.parent.isCubeCamera) pkHold(mesh); mesh.geometry = gf; }
        countDraw(renderer, mesh.geometry, cam);
      };
      mesh.onAfterRender = pkBack;
      L.meshes.push({ mesh, key: '__far', gf });
      group.add(mesh);
      _meshes++;
    }
    for (const key of keys) {
      const gf = flat && flat.keys.has(key) ? EMPTY : (far.get(key) || EMPTY);
      const mesh = new THREE.Mesh(gf, matFor(key));
      mesh.name = 'pk:' + key;
      mesh.castShadow = CAST.has(key);
      mesh.receiveShadow = true;
      mesh.onBeforeRender = (renderer, scene, cam) => {
        tick(renderer, scene);
        if (!cam.isPerspectiveCamera) return;
        if (Math.abs((cam.aspect || 1) - 1) >= 0.05) {
          // the view: the cell's LOD (lodUpdate), re-asserted here after a probe's face drew the far model
          lodUpdate(renderer, cam);
          const want = L.near ? (L.getNear().get(key) || EMPTY) : gf;
          if (mesh.geometry !== want) mesh.geometry = want;
        } else if (gf !== EMPTY && mesh.geometry !== gf) { if (cam.parent && cam.parent.isCubeCamera) pkHold(mesh); mesh.geometry = gf; }   // a cube probe's face draws the far model
        countDraw(renderer, mesh.geometry, cam);
      };
      mesh.onAfterRender = pkBack;
      L.meshes.push({ mesh, key, gf });
      group.add(mesh);
      _meshes++;
    }
    _cellsLod.push(L);
  }
}

export function seats() { return PK ? _seatList : []; }

// the test board (pkBoard.js): a model as a group of meshes with this part's materials, near (q = 1) or far (q = 0)
export function modelGroup(kind, p = {}, q = 1) {
  const m = modelFor(kind, p, q), g = new THREE.Group();
  if (!m) return g;
  for (const [key, geo] of Object.entries(m.parts)) {
    const mesh = new THREE.Mesh(geo, matFor(key));
    mesh.castShadow = CAST.has(key); mesh.receiveShadow = true; mesh.name = 'pkb:' + key;
    mesh.onBeforeRender = (renderer, scene) => tick(renderer, scene);
    g.add(mesh);
  }
  g.userData.tris = m.tris;
  return g;
}
