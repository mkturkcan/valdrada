// landmarks.js — custom low-poly massing builders for ~50 real NYC landmarks.
// Each builder returns a THREE.Group whose origin (0,0,0) is the CENTROID of the
// building footprint at ground level, y-up, meters. Builders derive all dimensions
// from ctx.height and ctx.obb so silhouettes land on their real lots at real scale.
//
// ctx = { footprint:[[x,z],...], height, floors, groundY, obb:{w,h,ang,center:[x,z]}, THREE }
//
// 'replace' builders attach userData.colliderBoxes = [{x,y,z,w,h,d,rotY}] (1-4 coarse
// boxes, group-local, y = box CENTER height). 'decorate' builders return additive
// elements only and skip colliders.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT } from './landmarkKit.js';
import { applyLightTrim, applySkyGlass } from '../world/materials.js';
import { boardMaterial, boardUVRect, BOARD_SLOTS } from './billboards.js';
import { buildSteinway } from './lmSteinway.js';   // CP33: 111 West 57th on its lot (terracotta and bronze faces, glass faces, setbacks, the hall)
import { buildPlazaRoof, buildHampshireRoof } from './lmPlaza.js';
import { buildMetMuseum } from './lmMetMuseum.js';   // LM16: the Met drawn whole on its ring (walls, roofs; replace)
const MET16 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('met16') === '0');
import { buildMetRoof, metFront } from './lmMet.js';   // CP33: the Met's roofscape (deck over the green slab, skylights, copper hips, plant)   // CP33: the Plaza's mansard, dormers, pavilions and chimneys on the compiled ring
import { buildEssexSign } from './lmCps.js';   // CP33: the Essex House's red rooftop letters (and the Plaza's mansard)
import { buildSanRemo } from './lmSanRemo.js';   // CP33: the San Remo on its footprint ring (facade tiles, mouldings, the temples)
import { buildMajestic, buildCentury, buildEldorado, buildBeresford } from './lmCPW.js';   // CW38: Central Park West's tower houses on their rings
// CP33 (landmarks round): `?cp33lm=0` puts the old box builders back (the read-time overrides in shared/landmarkSpec.js follow the same flag)
const CP33LM = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp33lm') === '0');
const CW38 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cw38') === '0');
import { TW_BUILDERS } from './tk/tkLandmarks.js';   // TW: the tower kit's landmarks
// LM16 (2026-10-16): the AMNH and the Guggenheim modelled on their rings with the kit's material sets; `?lm16=0` keeps the old boxes
import { buildAmnh, buildAmnhNorth } from './lmAmnh.js';
import { buildGuggenheim } from './lmGuggenheim.js';
import { buildHighbridgeTower } from './lmHighbridgeTower.js';   // HB25: the Highbridge Water Tower
const LM16 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('lm16') === '0');
const TWLM = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('twlm') === '0');   // TW

const {
  mat, box, cyl, sphere, disc, dome, prism, gable, wedge, pyramid, spire, steps,
  colonnade, colRing, ring, extrudeRing, setbackTower, lattice, billboard,
  inscription, lampStandard
} = KIT;

/* ---------------------------------- palette ---------------------------------- */
const LIME = 0xcfc8b8, LIME2 = 0xc8bfae, TERRA = 0xd8d2c2, MARBLE = 0xd8d2c4;
const WHITE = 0xe8e4dc, PENCIL = 0xe0ded8, CONC = 0xb4aea6, GRANITE = 0xd8d4c8;
const STONE = 0xc2bcae, GRAY = 0xb0a48e, SCHIST = 0x5a5248, TRIM = 0xe8e2d0;
const SLATE = 0x4a4640, DARK = 0x2a2e36, GLASS = 0x7c98ac, GLASS2 = 0x8ca4b4;
const BLUGLASS = 0x5f88b8, LTBLU = 0x9fc0dc, DKGLASS = 0x3a4148, GREENGL = 0x6f9884;
const BRONZE = 0x4a3c30, BRASS = 0x8a6a4a, COPPER = 0x5f8f76, SILVER = 0xb8bcc4;
const STEEL = 0xc4c8cc, BRICK = 0x9c5744, SALMON = 0xb87a5e, BROWNST = 0x6b4a38;
const CREAM = 0xe8dcb8, ROOFDK = 0x6a5a4a, BLUEST = 0x5c6066, GOLD = 0xd4af37;
const RED = 0xc22222, DOMEGR = 0x9a9d99; // Low's dome reads warm granite gray, not verdigris
/* Columbia's McKim stone, measured off Commons daylight photographs rather
   than guessed: Low and Butler are WARM buff Indiana limestone over a cooler
   grey granite base, and the shared LIME/GRANITE palette above renders them
   as milk (see docs/notes/columbia.md, m0_alma_day.png). These are the only
   hexes the two Columbia builders use; keeping them local avoids repainting
   the other 48 landmarks. Values are authored for the applyLightTrim scene
   (materials.js multiplies albedo by 0.30 at noon) — the change here is hue
   and internal contrast, not brightness. */
const CU_LIME = 0xc4b795;      // limestone ashlar, warm buff
const CU_TRIM = 0xd0c4a4;      // dressed trim / cornices, a shade lighter
const CU_LOGGIA = 0x8b8069;    // loggia rear wall + soffit: always in shadow
const CU_GRAN = 0x9d968a;      // granite podium and the frontal stair, cooler
const CU_DOME = 0xb0a898;      // the saucer dome, warm granite grey
const CU_INK = 0x35302a;       // incised inscriptions
// `?lowzf=0`: Low Library's anta capitals back in the plane of the anta face (the z-fight the owner saw, for an A/B)
const LOWZF = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('lowzf') === '0');
// CH32 (owner 2026-09-29 on mLowAerial: "the church walls have serious z-fighting"): St Paul's Chapel's two front brick
// piers ended in the same plane (zF) as the limestone laid across them, the frieze band, the cornice and each pier's
// base, and as the niche panels; brick and stone took turns in the depth test, streaks crawling over the fronts as the
// lens moved. The piers now stand 6 cm behind the stone, which projects from the brick as it does on the building, and
// the niches sit 1 cm proud of the brick. `?ch32=0` restores.
const CH32 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ch32') === '0');
// NY28 (owner 2026-09-27, Bryant Park and the library for the new teaser): the library's Vermont marble takes the campus
// stone detail (ashlar coursing and grain, mean-preserving: the authored marble white stays), the trim the granite grain.
// The survey still read it as one flat grey block. `?ny28=0` restores the plain colours.
const NY28 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ny28') === '0');

/* ---- METAL and GLASS, rebuilt 2026-09-09 (docs/notes/facades-r6.md section 0/2).
   Critic r5 #2 and #21: no glass landmark reflects anything and the Chrysler
   crown - the mirror-bright Nirosta object in New York - renders MATTE WHITE.
   These two option objects were metalness/roughness only, and a
   MeshStandardMaterial reflection comes exclusively from
   getIBLRadiance() * envMapIntensity, i.e. scene.environmentIntensity, which
   lighting.md cut from 0.52 to 0.14 to fix the ambient. On top of that
   applyLightTrim multiplies diffuseColor at <color_fragment>, BEFORE
   <lights_physical_fragment> derives specularColor = mix(0.04, diffuse,
   metalness) - so the day trim crushes a metal MIRROR to 30 % as well.
   skyMetal / skyGlass put an analytic sky-and-sun reflection back on top at
   its own gain (ENV.reflGain, ?refl=0 to A/B), so every glass landmark and
   every metal crown gets one from these two lines. */
const MET = { metal: 0.55, rough: 0.4,              // metallic surfaces
  skyMetal: { tint: [0.88, 0.89, 0.92], rough: 0.11, brush: 0.68 } };
const GLS = { metal: 0.3, rough: 0.3,               // curtain-wall glass
  skyGlass: { f0: 0.16, rough: 0.045, tint: [0.94, 0.99, 1.03], aureole: 1.7, mullion: 1 } };
// Nirosta (18-8 chrome-nickel) architectural sheet: the Chrysler crown and
// spire, and the ESB mullion strips. Brushed hard so the highlight smears in
// a horizontal band the way rolled stainless does on a radiating tier.
const NIROSTA = { metal: 0.92, rough: 0.16, emissive: 0x1a1d22, emissiveIntensity: 0.2,
  skyMetal: { tint: [0.91, 0.92, 0.94], rough: 0.10, brush: 0.80, gain: 0.92 } };
// weathered architectural bronze / statuary: dark, warm, low reflectance
const BRZ = { metal: 0.75, rough: 0.42,
  skyMetal: { tint: [0.42, 0.30, 0.18], rough: 0.24, brush: 0.35, gain: 0.8 } };

/* ------------------------------- shared helpers ------------------------------- */
// [outer, inner]: inner is rotated/offset to the footprint's oriented bounding box,
// so builders work in clean OBB space (x = long axis w, z = short axis h).
function shell(ctx) {
  const g = new THREE.Group();
  const r = new THREE.Group();
  r.rotation.y = -ctx.obb.ang;
  r.position.set(ctx.obb.center[0], 0, ctx.obb.center[1]);
  g.add(r);
  return [g, r];
}
// Attach collider boxes given in OBB-local coords; converts to group-local + rotY.
function fin(g, ctx, boxes) {
  const a = -ctx.obb.ang, c = Math.cos(a), s = Math.sin(a);
  const cx = ctx.obb.center[0], cz = ctx.obb.center[1];
  g.userData.colliderBoxes = boxes.map(b => ({
    x: cx + (b.x || 0) * c + (b.z || 0) * s,
    y: b.y === undefined ? b.h / 2 : b.y,
    z: cz - (b.x || 0) * s + (b.z || 0) * c,
    w: b.w, h: b.h, d: b.d, rotY: a
  }));
  return g;
}
function dims(ctx) {
  return {
    W: Math.max(ctx.obb.w || 10, 6),
    D: Math.max(ctx.obb.h || 10, 6),
    H: Math.max(ctx.height || 10, 4)
  };
}
const sc = (pts, k) => pts.map(p => [p[0] * k, p[1] * k]);
// Re-aim the inner group so local +Z best matches a world direction (+z = south in this projection).
// allow90=false keeps the OBB long axis (only the 180° flip is considered).
function orient(r, ctx, dirX, dirZ, allow90 = true) {
  const base = -ctx.obb.ang;
  const cands = allow90 ? [base, base + Math.PI / 2, base + Math.PI, base + Math.PI * 1.5] : [base, base + Math.PI];
  let best = base, bd = -2;
  for (const c of cands) {
    const d = Math.sin(c) * dirX + Math.cos(c) * dirZ;
    if (d > bd) { bd = d; best = c; }
  }
  r.rotation.y = best;
}

/* --------------------------- window-band facades -----------------------------
The skyline icons were plain limestone boxes: at hero-shot distance a 380 m
tower with no openings reads as a monolith, not a building. One tileable canvas
— a single bay x a single floor: limestone pier, recessed dark window, lintel
shadow, sill, spandrel — repeated an integer number of times per box gives a
shaft real bays and floor lines for ZERO extra draw calls (the boxes already
exist; only their material changes). Repeat counts are rounded to whole bays so
the pattern wraps seamlessly.
------------------------------------------------------------------------------ */
const _bandCanvas = new Map();
function bandCanvas(pier, glass, sill, vert = 0) {
  const key = pier + '|' + glass + '|' + sill + '|' + vert;
  let c = _bandCanvas.get(key);
  if (c) return c;
  const W = 128, H = 160;
  c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const hex = (h) => '#' + h.toString(16).padStart(6, '0');
  // ==== R1A cells: the grain is seeded by the band's key, so the same band paints the same pixels on every page load
  // (the cell packages' texture store is by content: an unseeded canvas changed between two bakes of the same inputs)
  let r1aS = 0x811c9dc5; for (let i = 0; i < key.length; i++) { r1aS ^= key.charCodeAt(i); r1aS = Math.imul(r1aS, 0x01000193) >>> 0; }
  const rand = () => { r1aS = (r1aS + 0x6d2b79f5) >>> 0; let t = Math.imul(r1aS ^ (r1aS >>> 15), 1 | r1aS); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  // ==== /R1A
  /* ---- VERTICAL-EMPHASIS BAY (Empire State, 30 Rock, RCA-era shafts) -------
     Critic r5 #6 / #21: "its defining feature — continuous nickel-chrome
     vertical mullion strips unbroken from the 6th to the 85th floor with
     narrow limestone piers between — is absent; it renders as a UNIFORM
     DOT-MATRIX of small dark squares with no vertical emphasis at all."
     The default tile below is a punched window in a stone field, which is
     right for a Beaux-Arts block and exactly wrong here: the ESB's spandrels
     are the SAME nickel as its mullions, so window and spandrel form one
     unbroken vertical channel and the limestone survives only as the narrow
     pier between channels. Drawing it that way, with no horizontal stone
     across the channel, is the whole fix — and it costs nothing, because the
     geometry and the draw call already exist. */
  if (vert) {
    x.fillStyle = hex(pier); x.fillRect(0, 0, W, H);
    // limestone pier grain (vertical tooling marks, very faint)
    for (let i = 0; i < 40; i++) {
      x.fillStyle = `rgba(${i % 2 ? 255 : 40},${i % 2 ? 250 : 36},${i % 2 ? 238 : 30},0.05)`;
      x.fillRect(rand() * W, rand() * H, 1, 12 + rand() * 60);   // ==== R1A seeded
    }
    const cx0 = Math.round(W * 0.255), cw = Math.round(W * 0.49);
    // the channel: nickel spandrel field, top to bottom, no stone crossing it
    x.fillStyle = hex(sill); x.fillRect(cx0, 0, cw, H);
    // spandrel panel shading — a shallow recess between floors
    x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(cx0 + 2, Math.round(H * 0.66), cw - 4, Math.round(H * 0.30));
    x.fillStyle = 'rgba(255,255,255,0.20)'; x.fillRect(cx0 + 2, Math.round(H * 0.655), cw - 4, 2);
    // the window itself
    const wx = cx0 + Math.round(cw * 0.16), ww = Math.round(cw * 0.68);
    x.fillStyle = hex(glass); x.fillRect(wx, Math.round(H * 0.10), ww, Math.round(H * 0.54));
    x.fillStyle = 'rgba(0,0,0,0.42)'; x.fillRect(wx, Math.round(H * 0.10), ww, Math.round(H * 0.045)); // lintel shadow
    const gg = x.createLinearGradient(0, H * 0.34, 0, H * 0.64);
    gg.addColorStop(0, 'rgba(255,255,255,0.00)');
    gg.addColorStop(1, 'rgba(196,218,238,0.34)');                            // sky low in the pane
    x.fillStyle = gg; x.fillRect(wx, Math.round(H * 0.34), ww, Math.round(H * 0.30));
    // the two continuous nickel-chrome fillets: unbroken, full height. These
    // are the strips the critic is looking for.
    x.fillStyle = 'rgba(255,255,252,0.55)';
    x.fillRect(cx0, 0, Math.max(2, Math.round(W * 0.028)), H);
    x.fillRect(cx0 + cw - Math.max(2, Math.round(W * 0.028)), 0, Math.max(2, Math.round(W * 0.028)), H);
    x.fillStyle = 'rgba(0,0,0,0.30)';                                        // the shadow line beside each
    x.fillRect(cx0 - 2, 0, 2, H);
    x.fillRect(cx0 + cw, 0, 2, H);
    x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(0, 0, 2, H);                // pier joint at the seam
    _bandCanvas.set(key, c);
    return c;
  }
  x.fillStyle = hex(pier); x.fillRect(0, 0, W, H);
  // spandrel course under each floor line: masonry, a shade darker
  x.fillStyle = 'rgba(0,0,0,0.10)'; x.fillRect(0, H - 26, W, 26);
  // stone grain: faint vertical streaks so the piers are not flat colour
  for (let i = 0; i < 90; i++) {
    x.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 250 : 0},${i % 2 ? 240 : 0},0.045)`;
    x.fillRect(rand() * W, rand() * H, 1 + rand() * 2, 6 + rand() * 40);   // ==== R1A seeded
  }
  // the opening
  const ox = Math.round(W * 0.19), ow = Math.round(W * 0.62);
  const oy = Math.round(H * 0.15), oh = Math.round(H * 0.50);
  x.fillStyle = hex(glass); x.fillRect(ox, oy, ow, oh);
  // reveal: lintel shadow at the head, jamb shadow on one side
  x.fillStyle = 'rgba(0,0,0,0.45)'; x.fillRect(ox, oy, ow, Math.round(H * 0.035));
  x.fillRect(ox, oy, Math.round(W * 0.035), oh);
  // sky glint low in the pane (a dead-black window is its own render tell)
  const g = x.createLinearGradient(ox, oy + oh * 0.35, ox, oy + oh);
  g.addColorStop(0, 'rgba(255,255,255,0.00)');
  g.addColorStop(1, 'rgba(190,215,235,0.30)');
  x.fillStyle = g; x.fillRect(ox, oy + oh * 0.35, ow, oh * 0.65);
  // projecting sill
  x.fillStyle = hex(sill); x.fillRect(ox - 3, oy + oh, ow + 6, Math.round(H * 0.028));
  x.fillStyle = 'rgba(0,0,0,0.22)'; x.fillRect(ox - 3, oy + oh + Math.round(H * 0.028), ow + 6, 2);
  // pier joint at the tile seam
  x.fillStyle = 'rgba(0,0,0,0.13)'; x.fillRect(0, 0, 2, H);
  _bandCanvas.set(key, c);
  return c;
}
const _bandTex = new Map();
const _bandMats = new Map();
// nx x ny repeats of the bay tile, as its own material (textures cannot share a
// repeat, but clones share one GPU upload)
function bandMat(w, h, d, hex, o = {}) {
  const pier = o.pier === undefined ? hex : o.pier;
  const glass = o.glass === undefined ? 0x39424e : o.glass;
  const sill = o.sill === undefined ? 0xded7c7 : o.sill;
  const bay = o.bay || 3.5, fl = o.floor || 3.95;
  const vert = o.vert ? 1 : 0;
  const nx = Math.max(1, Math.round(((w + d) / 2) / bay));
  const ny = Math.max(1, Math.round(h / fl));
  const mkey = nx + 'x' + ny + '|' + pier + '|' + glass + '|' + sill + '|' + (o.rough || 0.8) + '|v' + vert;
  let m = _bandMats.get(mkey);
  if (m) return m;
  const tkey = pier + '|' + glass + '|' + sill + '|' + vert;
  let base = _bandTex.get(tkey);
  if (!base) {
    base = new THREE.CanvasTexture(bandCanvas(pier, glass, sill, vert));
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.colorSpace = THREE.SRGBColorSpace;
    base.anisotropy = 4;
    _bandTex.set(tkey, base);
  }
  const t = base.clone();
  t.needsUpdate = true;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(nx, ny);
  m = applyLightTrim(new THREE.MeshStandardMaterial({
    map: t, color: 0xffffff, roughness: o.rough || 0.8, metalness: 0,
    flatShading: false,
  }));
  // a nickel-mullion shaft has to answer the sun somewhere or the strips read
  // as printed lines: a low-F0 sheen over the whole tile (facades-r6 section 1)
  if (vert) applySkyGlass(m, { f0: 0.07, rough: 0.14, tint: [1.0, 1.0, 0.99], aureole: 1.2 });
  _bandMats.set(mkey, m);
  return m;
}
// box() with a banded facade instead of a flat colour
function bandBox(w, h, d, hex, o = {}) {
  const mesh = box(w, h, d, hex, o);
  mesh.material = bandMat(w, h, d, hex, o.band || {});
  return mesh;
}

/* ------------------- Columbia axis + footprint-ring helpers -------------------
The Columbia superblock is laid out on McKim's axis, not the world axes: campus
north is (0.465, -0.885) in tile x/z (public/data/columbia_campus.json .axis).
Low, Butler and St Paul's orient to it, and they are built on their REAL
footprint rings rather than on boxes — see docs/notes/columbia.md.
------------------------------------------------------------------------------ */
const CAMPUS_N = [0.465, -0.885];

/* ---- the Columbia terraces, and why the builders level off them ------------
`ctx.groundY` is the compiler's `baseY`. In data/tiles_flat4 EVERY building
record in tile 1_-6 arrives at 3.52 — all 99 of them, the flat plane's lot base
— where tiles_flat3 had a real distribution (2.92 x78, 9.68 x10, plus the slope
values). The compiled GROUND did not move: the paving around Low measures
path 10.21 / grass 10.18 in both sets. assemble.js rescues ordinary buildings
with `padUnderRing`, but only up to 1.2 m and never for a landmark, so a
hard-coded offset from baseY sank Low 6.16 m — its granite podium and the whole
86 ft frontal stair disappeared under the terrace and the portico columns grew
straight out of the lawn (shots/columbia/n1_air_day.png).

So the campus builders level themselves off the PAVING, which is the stable
thing, not off baseY. These defaults are the compiled pads; campus.js replaces
them with the live values from public/data/columbia_campus.json the moment they
land, and the arithmetic self-heals if the compiler datum is ever restored.
Reported to the lead — see docs/notes/columbia.md "Requests for the lead". */
export const CU_PADS = { walk: 3.52, apron: 4.70, top: 10.20 };
export function setCampusPads(p) {
  if (p && p.top > 0 && p.walk > 0) { CU_PADS.walk = p.walk; CU_PADS.apron = p.apron; CU_PADS.top = p.top; }
}
// paving level of a campus landmark expressed above its own group origin
// (P1 TERRAIN, `?terrain=p1`: the building and the paving it stands on were lifted together, by ctx.haLift)
const cuYP = (ctx, pad, lo, hi) =>
  Math.max(lo, Math.min(hi, pad + (ctx.haLift || 0) - (Number.isFinite(ctx.groundY) ? ctx.groundY : pad)));

// orient() plus the two things a ring-driven builder also needs: the local
// extents FOR THE ROTATION IT PICKED (dims() is wrong after a quarter turn —
// the local X extent becomes obb.h) and the footprint ring in that frame.
function orientRing(r, ctx, dirX, dirZ) {
  const base = -(ctx.obb?.ang || 0);
  let best = { d: -2, c: base, k: 0 };
  for (let k = 0; k < 4; k++) {
    const c = base + k * Math.PI / 2;
    const d = Math.sin(c) * dirX + Math.cos(c) * dirZ;
    if (d > best.d) best = { d, c, k };
  }
  r.rotation.y = best.c;
  const ct = Math.cos(best.c), st = Math.sin(best.c);
  const cx = ctx.obb?.center?.[0] || 0, cz = ctx.obb?.center?.[1] || 0;
  const ring = (ctx.footprint || []).map(([x, z]) => {
    const X = x - cx, Z = z - cz;
    return [X * ct - Z * st, X * st + Z * ct];
  });
  const W = Math.max(6, best.k % 2 ? ctx.obb.h : ctx.obb.w);
  const D = Math.max(6, best.k % 2 ? ctx.obb.w : ctx.obb.h);
  return { W, D, ring };
}

// which side of an edge is outside (winding is not guaranteed)
function outwardSign(ring) {
  const n = ring.length;
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= n; cz /= n;
  let li = 0, ll = -1;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > ll) { ll = L; li = i; }
  }
  const a = ring[li], b = ring[(li + 1) % n];
  const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
  const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
  return (ez / L) * mx + (-ex / L) * mz > 0 ? 1 : -1;
}

// ring edges with outward normals: window rows, cornice modillions, kerbs
function edgesOf(ring) {
  const out = [];
  const n = ring.length;
  if (n < 3) return out;
  const s = outwardSign(ring);
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 1e-3) continue;
    out.push({ ax: a[0], az: a[1], dx: ex / L, dz: ez / L, nx: s * ez / L, nz: -s * ex / L, len: L });
  }
  return out;
}

// miter-offset a ring outward by d (negative = inward): plinths, cornice
// courses and attic setbacks are the same plan at a different projection
function offsetRing(ring, d) {
  const n = ring.length;
  if (n < 3) return ring;
  const s = outwardSign(ring);
  const nrm = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    nrm.push([s * ez / L, -s * ex / L]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = nrm[(i - 1 + n) % n], n2 = nrm[i]; // edges into / out of vertex i
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { out.push([ring[i][0] + n2[0] * d, ring[i][1] + n2[1] * d]); continue; }
    mx /= ml; mz /= ml;
    const t = d / Math.max(0.36, mx * n2[0] + mz * n2[1]);
    out.push([ring[i][0] + mx * t, ring[i][1] + mz * t]);
  }
  return out;
}

// cut a rectangular loggia into the ring's front face (x0..x1 back to zBack)
function carveBay(ring, zF, x0, x1, zBack) {
  const n = ring.length, out = [];
  let done = false;
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    out.push(a);
    if (done || a[1] < zF - 0.9 || b[1] < zF - 0.9) continue;
    if (Math.abs(a[0] - b[0]) < (x1 - x0) * 0.8) continue;
    if (Math.min(a[0], b[0]) > x0 - 0.1 || Math.max(a[0], b[0]) < x1 + 0.1) continue;
    const lo = [x0, zF], hi = [x1, zF];
    const first = a[0] > b[0] ? hi : lo, last = a[0] > b[0] ? lo : hi;
    out.push(first, [first[0], zBack], [last[0], zBack], last);
    done = true;
  }
  return out;
}

// fallback plan when a tile hands us no footprint: a square with cut corners
function notchedSquare(hx, hz, notch) {
  const p = [];
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) {
    p.push([sx * hx, sz * (hz - notch)], [sx * (hx - notch * 0.1), sz * hz],
      [sx * (hx - notch), sz * hz]);
  }
  return p;
}

/* Merge bin. KIT hands back meshes with shared cached geometry; a hero landmark
   wants hundreds of pieces but only a handful of draw calls, so each piece's
   transform is baked into a geometry clone and the bin merges per material.
   Everything is de-indexed first so extruded rings and primitives can mix. */
function bin() {
  return {
    geos: [],
    add(o) {
      o.updateMatrixWorld(true);
      o.traverse((m) => {
        if (!m.isMesh || !m.geometry) return;
        const gg = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        gg.applyMatrix4(m.matrixWorld);
        for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
        this.geos.push(gg);
      });
      return o;
    },
    into(parent, hex, o) {
      if (!this.geos.length) return null;
      const gm = this.geos.length === 1 ? this.geos[0] : mergeGeometries(this.geos);
      this.geos.length = 0;
      if (!gm) return null;
      const m = new THREE.Mesh(gm, mat(hex, o));
      m.castShadow = true; m.receiveShadow = true;
      parent.add(m);
      return m;
    },
  };
}

// one window: dark light + projecting limestone architrave and sill, aimed by
// the wall edge's outward normal so it works on any footprint edge
function punch(trimB, glsB, e, px, pz, y0, w, h, proj) {
  const yaw = Math.atan2(e.nx, e.nz);
  const ox = e.nx, oz = e.nz;
  glsB.add(box(w, h, 0.2, 0, { x: px - ox * 0.08, y: y0, z: pz - oz * 0.08, rotY: yaw }));
  const jw = Math.max(0.24, w * 0.17);
  for (const s of [-1, 1]) {
    const jx = px + e.dx * (w / 2 + jw / 2) * s, jz = pz + e.dz * (w / 2 + jw / 2) * s;
    trimB.add(box(jw, h + 0.42, proj, 0, { x: jx + ox * proj * 0.5, y: y0 - 0.16, z: jz + oz * proj * 0.5, rotY: yaw }));
  }
  trimB.add(box(w + 2 * jw, 0.32, proj * 1.2, 0, { x: px + ox * proj * 0.6, y: y0 + h + 0.02, z: pz + oz * proj * 0.6, rotY: yaw }));
  trimB.add(box(w + 2 * jw + 0.24, 0.2, proj * 1.6, 0, { x: px + ox * proj * 0.8, y: y0 - 0.26, z: pz + oz * proj * 0.8, rotY: yaw }));
}

/* Fluted Ionic column, ~200 tris. The shaft is three stacked 16-sided drums
   whose radii carry a real entasis (a slight convex swell, not a straight
   taper): 16 flat-shaded facets read as the 24 flutes of the original at
   20-60 m, which is where these columns are judged. The capital is built the
   way an Ionic capital actually reads from the front — necking, echinus, a
   volute block, and the spiral scrolls as small drums facing +Z and -Z with
   a raised eye — so it does not collapse to a plain cushion at distance.
   Columns are assumed to FACE +Z (Low's portico, Butler's colonnade). */
function ionicColumn(b, x, y0, z, h, rad) {
  const baseH = h * 0.072, capH = h * 0.085, shaftH = h - baseH - capH;
  const SEG = 16;
  b.add(box(rad * 2.5, baseH * 0.34, rad * 2.5, 0, { x, y: y0, z }));                     // plinth
  b.add(cyl(rad * 1.30, rad * 1.36, baseH * 0.24, 0, { x, y: y0 + baseH * 0.34, z, seg: 12 })); // lower torus
  b.add(cyl(rad * 1.12, rad * 1.28, baseH * 0.26, 0, { x, y: y0 + baseH * 0.58, z, seg: 12 })); // scotia
  b.add(cyl(rad * 1.02, rad * 1.10, baseH * 0.16, 0, { x, y: y0 + baseH * 0.84, z, seg: 12 })); // upper torus
  // entasis: r 1.000 -> 0.985 -> 0.930 -> 0.840 of the nominal radius
  const ys = y0 + baseH;
  b.add(cyl(rad * 0.985, rad * 1.000, shaftH * 0.36, 0, { x, y: ys, z, seg: SEG }));
  b.add(cyl(rad * 0.930, rad * 0.985, shaftH * 0.38, 0, { x, y: ys + shaftH * 0.36, z, seg: SEG }));
  b.add(cyl(rad * 0.840, rad * 0.930, shaftH * 0.26, 0, { x, y: ys + shaftH * 0.74, z, seg: SEG }));
  const yc = ys + shaftH;
  b.add(cyl(rad * 0.86, rad * 0.82, capH * 0.16, 0, { x, y: yc, z, seg: 12 }));            // necking
  b.add(cyl(rad * 1.06, rad * 0.88, capH * 0.20, 0, { x, y: yc + capH * 0.16, z, seg: 12 })); // echinus
  const yv = yc + capH * 0.36;
  b.add(box(rad * 2.30, capH * 0.44, rad * 1.72, 0, { x, y: yv, z }));                     // volute block
  for (const s of [-1, 1]) for (const f of [-1, 1]) {                                      // the four scrolls
    const d = cyl(rad * 0.50, rad * 0.50, rad * 0.34, 0, { seg: 10 });
    d.rotation.x = Math.PI / 2;
    d.position.set(x + s * rad * 0.92, yv + capH * 0.22, z + f * (rad * 0.86 + rad * 0.17));
    b.add(d);
    const e = cyl(rad * 0.16, rad * 0.16, rad * 0.10, 0, { seg: 6 });
    e.rotation.x = Math.PI / 2;
    e.position.set(x + s * rad * 0.92, yv + capH * 0.22, z + f * (rad * 0.86 + rad * 0.36));
    b.add(e);
  }
  b.add(box(rad * 2.62, capH * 0.14, rad * 2.34, 0, { x, y: yv + capH * 0.44, z }));       // abacus
  b.add(box(rad * 2.44, capH * 0.06, rad * 2.16, 0, { x, y: yv + capH * 0.58, z }));
}

/* Corinthian column / pilaster, ~230 tris. Same entasis shaft as the Ionic
   above (16 facets read as 24 flutes at 20-60 m), but the capital is the
   Corinthian bell: an inverted campana with two tiers of acanthus and four
   corner volutes under a concave-sided abacus. This is the order on the
   New York Public Library's Fifth Avenue front and on its wing pilasters, and
   a plain cushion capital is exactly what makes a Beaux-Arts front read as a
   render. Columns FACE +Z. `pil` builds a half-round pilaster instead of a
   free-standing column (half the drums, flat back). */
function corinthianColumn(b, x, y0, z, h, rad, pil = false) {
  const baseH = h * 0.062, capH = h * 0.135, shaftH = h - baseH - capH;
  const SEG = pil ? 10 : 16;
  const dz = pil ? -rad * 0.55 : 0;              // pilaster sinks into the wall
  b.add(box(rad * 2.6, baseH * 0.30, rad * 2.6, 0, { x, y: y0, z: z + dz }));                    // plinth
  b.add(cyl(rad * 1.28, rad * 1.34, baseH * 0.26, 0, { x, y: y0 + baseH * 0.30, z: z + dz, seg: 12 }));
  b.add(cyl(rad * 1.10, rad * 1.26, baseH * 0.28, 0, { x, y: y0 + baseH * 0.56, z: z + dz, seg: 12 }));
  b.add(cyl(rad * 1.02, rad * 1.08, baseH * 0.16, 0, { x, y: y0 + baseH * 0.84, z: z + dz, seg: 12 }));
  const ys = y0 + baseH;
  b.add(cyl(rad * 0.985, rad * 1.000, shaftH * 0.34, 0, { x, y: ys, z: z + dz, seg: SEG }));
  b.add(cyl(rad * 0.925, rad * 0.985, shaftH * 0.40, 0, { x, y: ys + shaftH * 0.34, z: z + dz, seg: SEG }));
  b.add(cyl(rad * 0.830, rad * 0.925, shaftH * 0.26, 0, { x, y: ys + shaftH * 0.74, z: z + dz, seg: SEG }));
  const yc = ys + shaftH;
  b.add(cyl(rad * 0.86, rad * 0.82, capH * 0.10, 0, { x, y: yc, z: z + dz, seg: 12 }));           // necking + astragal
  // the bell: three flaring drums, so the silhouette curves out rather than
  // stepping — this is the whole read of a Corinthian cap at 40 m
  b.add(cyl(rad * 1.00, rad * 0.86, capH * 0.30, 0, { x, y: yc + capH * 0.10, z: z + dz, seg: 12 }));
  b.add(cyl(rad * 1.22, rad * 1.00, capH * 0.28, 0, { x, y: yc + capH * 0.40, z: z + dz, seg: 12 }));
  // acanthus: eight leaf tips on the lower tier, four on the upper
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.39;
    b.add(box(rad * 0.34, capH * 0.26, rad * 0.30, 0, {
      x: x + Math.cos(a) * rad * 1.02, y: yc + capH * 0.14, z: z + dz + Math.sin(a) * rad * 1.02, rotY: -a
    }));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    b.add(box(rad * 0.44, capH * 0.24, rad * 0.34, 0, {
      x: x + Math.cos(a) * rad * 1.20, y: yc + capH * 0.44, z: z + dz + Math.sin(a) * rad * 1.20, rotY: -a
    }));
    // corner volute
    const v = cyl(rad * 0.26, rad * 0.26, rad * 0.20, 0, { seg: 8 });
    v.rotation.x = Math.PI / 2; v.rotation.z = a;
    v.position.set(x + Math.cos(a) * rad * 1.30, yc + capH * 0.72, z + dz + Math.sin(a) * rad * 1.30);
    b.add(v);
  }
  b.add(box(rad * 2.72, capH * 0.13, rad * 2.72, 0, { x, y: yc + capH * 0.70, z: z + dz }));      // abacus
  b.add(box(rad * 2.50, capH * 0.07, rad * 2.50, 0, { x, y: yc + capH * 0.83, z: z + dz }));
}

/* Round-arched opening in a wall face at z = +off, facing +Z: a dark reveal,
   a projecting archivolt of voussoirs, a keystone and an impost band. Used for
   the NYPL's three great entrance arches and for its wing windows. */
function archOpening(trimB, glsB, off, x, y0, w, hRise, o = {}) {
  const rad = w / 2, dep = o.dep === undefined ? 0.7 : o.dep;
  // the light: a straight-sided panel under a half disc
  glsB.add(box(w, hRise, 0.24, 0, { x, y: y0, z: off - 0.30 }));
  const disc = new THREE.Mesh(new THREE.CircleGeometry(rad, o.seg || 16, 0, Math.PI), mat(0, {}));
  disc.position.set(x, y0 + hRise, off - 0.30);
  glsB.add(disc);
  // jambs + impost blocks
  for (const s of [-1, 1]) {
    trimB.add(box(0.62, hRise, dep, 0, { x: x + s * (rad + 0.31), y: y0, z: off + dep * 0.5 - 0.1 }));
    trimB.add(box(1.10, 0.42, dep * 1.25, 0, { x: x + s * (rad + 0.30), y: y0 + hRise - 0.21, z: off + dep * 0.62 - 0.1 }));
  }
  // archivolt: voussoirs around the half circle
  const n = o.vous || 11;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * (i + 0.5) / n;
    const rr = rad + 0.34;
    trimB.add(box(0.66, 0.62, dep, 0, {
      x: x + Math.cos(a) * rr, y: y0 + hRise + Math.sin(a) * rr, z: off + dep * 0.5 - 0.1,
      rotZ: a - Math.PI / 2,
    }));
  }
  trimB.add(box(0.9, 1.15, dep * 1.3, 0, { x, y: y0 + hRise + rad + 0.05, z: off + dep * 0.6 - 0.1 })); // keystone
  if (o.sill !== false) trimB.add(box(w + 2.1, 0.34, dep * 1.6, 0, { x, y: y0 - 0.34, z: off + dep * 0.8 - 0.1 }));
}

// the Baths-of-Diocletian thermal window: half-round light, mullion grid,
// stone archivolt. off = distance of the wall face from the local origin.
function thermalWindow(trimB, glsB, off, yaw, y0, rad) {
  const nx = Math.sin(yaw), nz = Math.cos(yaw), tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const px = nx * off, pz = nz * off;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(rad, 22, 0, Math.PI), mat(0, {}));
  disc.position.set(px - nx * 0.12, y0, pz - nz * 0.12);
  disc.rotation.y = yaw;
  glsB.add(disc);
  const tor = new THREE.Mesh(new THREE.TorusGeometry(rad + 0.42, 0.4, 6, 22, Math.PI), mat(0, {}));
  tor.position.set(px + nx * 0.18, y0, pz + nz * 0.18);
  tor.rotation.y = yaw;
  trimB.add(tor);
  for (let i = -3; i <= 3; i++) {
    const u = (i / 4) * rad;
    const hh = Math.sqrt(Math.max(0.01, rad * rad - u * u)) - 0.1;
    trimB.add(box(0.24, hh, 0.34, 0, { x: px + nx * 0.1 + tx * u, y: y0, z: pz + nz * 0.1 + tz * u, rotY: yaw }));
  }
  for (const f of [0.36, 0.68]) {
    const hy = rad * f, hw = Math.sqrt(Math.max(0.01, rad * rad - hy * hy)) - 0.1;
    trimB.add(box(hw * 2, 0.22, 0.34, 0, { x: px + nx * 0.1, y: y0 + hy, z: pz + nz * 0.1, rotY: yaw }));
  }
  trimB.add(box(rad * 2 + 1.4, 0.46, 0.66, 0, { x: px + nx * 0.14, y: y0 - 0.46, z: pz + nz * 0.14, rotY: yaw }));
}

/* --------------------------------- builders ---------------------------------- */
export const BUILDERS = {
  // HB25: the Highbridge Water Tower on its ring (city/lmHighbridgeTower.js)
  highbridgeTower(ctx) { return buildHighbridgeTower(ctx); },

  // ==================== the Statue of Liberty (id 67) ====================
  // drawn by city/liberty.js (the statue, the pedestal, Fort Wood), resident with its own level chain like the bridges; the
  // compiled footprint here (Fort Wood's star as a 36 m prism) is replaced by nothing
  statueOfLiberty() { return new THREE.Group(); },
  libertyIslandBuilding() { return new THREE.Group(); },

  // ==================== Morningside Heights & Harlem ====================

  /* ==================== Low Memorial Library (McKim, 1897) ====================
  The Pantheon on a granite podium, at real scale on the real footprint ring —
  all metres above the terrace paving (docs/notes/columbia.md): a 12 ft granite
  base, an 86 ft frontal stair of 24 risers in three flights, a recessed loggia
  of 10 Ionic columns 35 ft tall, inscribed architrave + attic under a modillion
  cornice, the 100 ft square block carrying a thermal window on each face, and
  the 70 ft granite saucer dome 135 ft above the terrace. The compiler hands us
  baseY 9.77 / height 40.86, which is exactly this scheme.                    */
  lowLibrary(ctx) {
    const [g, r] = shell(ctx);
    const O = orientRing(r, ctx, -CAMPUS_N[0], -CAMPUS_N[1]); // portico faces College Walk
    const R0 = O.ring.length >= 8 ? O.ring : notchedSquare(O.W / 2, O.D / 2, 12.7);
    let zF = -1e9;
    for (const [, z] of R0) zF = Math.max(zF, z);
    let fe = null;                                            // the portico bay =
    for (const e of edgesOf(R0)) {                            // widest front edge
      if (e.az + e.dz * e.len * 0.5 < zF - 0.9) continue;
      if (!fe || e.len > fe.len) fe = e;
    }
    const bayC = fe ? fe.ax + fe.dx * fe.len * 0.5 : 0;
    const halfBay = Math.max(9, Math.min(15, (fe ? fe.len : 28) / 2));

    // the plateau paving Low stands on measures 10.21; YP is that above the
    // group origin, derived (NOT hard-coded) because baseY moves between
    // compiles while the paving does not — see CU_PADS above
    const YP = cuYP(ctx, CU_PADS.top + 0.01, 0.2, 8.5);
    const POD = YP + 3.66;        // portico floor  (12 ft granite base)
    const CAP = POD + 10.67;      // top of the Ionic columns (35 ft)
    const ARC = CAP + 0.95;       // architrave: THE LIBRARY OF COLUMBIA UNIVERSITY
    const FRZ = ARC + 0.75;       // frieze
    const ENT = FRZ + 0.70;       // top of the entablature cornice
    const ATT = ENT + 3.85;       // top of the attic wall (KING'S COLLEGE panel)
    const CRN = ATT + 1.02;       // top of the crown cornice
    const DRC = YP + 30.48;       // drum-block cornice (100 ft)
    const SPR = DRC + 2.4;        // dome springing
    const APEX = YP + 39.7;       // dome apex; the finial tops out at 135 ft
    const zBack = zF - 5.6;       // loggia depth

    const gran = bin(), lime = bin(), trim = bin(), dm = bin(), gls = bin(), brz = bin();
    const vrd = bin(), glb = bin();   // patinated lamp standards / opal globes
    const log = bin();            // the loggia's rear wall, soffit and antae:
    // a 5.6 m deep porch reads as DEPTH only if what is behind the columns is
    // darker than the columns. Without this the whole front rendered as one
    // flat white plate (m0_alma_day.png) and the portico disappeared.

    /* ---- granite podium: full ring, projecting plinth, water table ---- */
    gran.add(extrudeRing(R0, POD + 1.6, 0, { yBase: -1.6 }));
    gran.add(extrudeRing(offsetRing(R0, 0.5), 1.05, 0, { yBase: YP - 0.55 }));
    // 1 cm short of POD: a full-height ring put its cap on the podium's own cap,
    // and the two fought across the open portico floor
    trim.add(extrudeRing(offsetRing(R0, 0.28), 0.49, 0, { yBase: POD - 0.5 }));

    /* ---- main storey: the ring with the loggia carved out of the front bay */
    const x0 = bayC - halfBay + 0.55, x1 = bayC + halfBay - 0.55;
    lime.add(extrudeRing(carveBay(R0, zF, x0, x1, zBack), CAP - POD, 0, { yBase: POD }));

    /* ---- entablature courses, attic, crown cornice: one plan, many projections */
    trim.add(extrudeRing(offsetRing(R0, 0.16), ARC - CAP, 0, { yBase: CAP }));
    lime.add(extrudeRing(offsetRing(R0, 0.06), FRZ - ARC, 0, { yBase: ARC }));
    trim.add(extrudeRing(offsetRing(R0, 0.62), ENT - FRZ, 0, { yBase: FRZ }));
    lime.add(extrudeRing(offsetRing(R0, -0.06), ATT - ENT, 0, { yBase: ENT }));
    trim.add(extrudeRing(offsetRing(R0, 0.74), 0.62, 0, { yBase: ATT }));
    trim.add(extrudeRing(offsetRing(R0, 0.34), 0.4, 0, { yBase: ATT + 0.62 }));
    // roof deck: it stands 0.15 m proud of the crown cornice. Its top used to sit
    // exactly at CRN, coplanar with the cornice ring's own cap (ExtrudeGeometry
    // caps every ring), and the two fought over the whole roof in the aerials
    // (owner review 2026-09-24).
    lime.add(extrudeRing(offsetRing(R0, -1.2), 0.75, 0, { yBase: CRN - 0.6 }));

    /* ---- modillion blocks under both cornices + attic antefixes ---- */
    for (const e of edgesOf(R0)) {
      if (e.len < 4) continue;
      const n = Math.floor(e.len / 0.95);
      const yaw = Math.atan2(e.nx, e.nz);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = e.ax + e.dx * e.len * t, pz = e.az + e.dz * e.len * t;
        trim.add(box(0.30, 0.26, 0.60, 0, { x: px + e.nx * 0.5, y: FRZ + 0.10, z: pz + e.nz * 0.5, rotY: yaw }));
        trim.add(box(0.34, 0.30, 0.72, 0, { x: px + e.nx * 0.6, y: ATT + 0.14, z: pz + e.nz * 0.6, rotY: yaw }));
      }
      // acroteria along the crown cornice: the row of palmette antefixes that
      // gives Low's skyline its serrated edge in every frontal photograph
      const na = Math.floor(e.len / 3.1);
      for (let i = 0; i < na; i++) {
        const t = (i + 0.5) / na;
        const px = e.ax + e.dx * e.len * t, pz = e.az + e.dz * e.len * t;
        trim.add(box(0.62, 0.30, 0.34, 0, { x: px + e.nx * 0.34, y: CRN, z: pz + e.nz * 0.34, rotY: yaw }));
        trim.add(box(0.44, 0.34, 0.24, 0, { x: px + e.nx * 0.34, y: CRN + 0.30, z: pz + e.nz * 0.34, rotY: yaw }));
      }
    }

    /* ---- the two inscriptions. These are the identity of the building: the
    architrave carries THE LIBRARY OF COLUMBIA UNIVERSITY and the attic the
    King's College charter text in five lines. Both are hung on their own
    material, so they stay out of the merge bins.                          */
    r.add(inscription(2 * halfBay - 1.2, 0.60, 'THE·LIBRARY·OF·COLUMBIA·UNIVERSITY',
      { x: bayC, y: CAP + 0.17, z: zF + 0.21, ink: CU_INK }));
    r.add(inscription(2 * halfBay - 1.6, 2.10, [
      "KING'S COLLEGE FOUNDED IN THE PROVINCE OF NEW YORK BY ROYAL CHARTER",
      'IN THE REIGN OF GEORGE II  PERPETUATED AS COLUMBIA COLLEGE BY THE',
      'PEOPLE OF THE STATE OF NEW YORK WHEN THEY BECAME FREE AND INDEPENDENT',
      'MAINTAINED AND CHERISHED FROM GENERATION TO GENERATION FOR THE',
      'ADVANCEMENT OF THE PUBLIC GOOD AND THE GLORY OF ALMIGHTY GOD',
    ], { x: bayC, y: ENT + 0.85, z: zF + 0.01, ink: CU_INK }));

    /* ---- windows: tall main-storey lights, square attic lights, base lights.
    The flanking wings each carry ONE tall architraved light per bay at portico
    level and one square light in the attic (Commons frontal photo); the old
    4.7 m pitch scattered small squares over them.                          */
    // The OSM ring gives the front RETURNS beside the portico bay only 2.5 and
    // 3.2 m and the corner chamfers 5.5 m, so the old `len < 6` gate left every
    // one of them blank and hung the wing lights on the side faces instead
    // (round-1 defect 5). They each carry ONE tall light in the photograph, so
    // the threshold drops to 2.2 m and the light is fitted to the edge.
    for (const e of edgesOf(R0)) {
      if (e.len < 2.2) continue;
      const mx = e.ax + e.dx * e.len * 0.5, mz = e.az + e.dz * e.len * 0.5;
      if (mz > zF - 1.2 && Math.abs(mx - bayC) < halfBay) continue;   // the loggia
      const front = mz > zF - 4.0;                                   // front return / chamfer
      const n = Math.max(1, Math.round(e.len / (front ? 6.6 : 5.4)));
      const fit = Math.min(1, (e.len / n - 0.9) / 3.0);               // narrow edge => narrow light
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const px = e.ax + e.dx * e.len * t, pz = e.az + e.dz * e.len * t;
        punch(trim, gls, e, px, pz, POD + 1.9, (front ? 2.1 : 1.5) * fit, front ? 5.2 : 4.0, 0.40);
        punch(trim, gls, e, px, pz, ENT + 1.15, (front ? 1.7 : 1.3) * fit, front ? 1.9 : 1.6, 0.30);
        if (e.len > 12) punch(trim, gls, e, px, pz, YP + 1.2, 1.15, 1.4, 0.22);
      }
    }

    /* ---- the loggia: 10 Ionic columns 35 ft tall, 4 ft in diameter ---- */
    const nCol = 10, span = 2 * (halfBay - 1.5), gap = span / (nCol - 1);
    // the porch interior: rear wall facing, coffered soffit and granite floor,
    // all in the shadowed stone so the colonnade reads as 5.6 m of depth
    log.add(box(2 * halfBay - 1.1, CAP - POD - 0.1, 0.30, 0, { x: bayC, y: POD, z: zBack + 0.15 }));
    log.add(box(2 * halfBay - 1.1, 0.30, zF - zBack, 0, { x: bayC, y: CAP - 0.4, z: (zF + zBack) / 2 }));
    for (let i = 0; i < nCol - 1; i++)                                // soffit beams
      log.add(box(gap * 0.5, 0.34, zF - zBack - 0.6, 0, { x: bayC - span / 2 + (i + 0.5) * gap, y: CAP - 0.74, z: (zF + zBack) / 2 }));
    gran.add(box(2 * halfBay - 1.1, 0.22, zF - zBack, 0, { x: bayC, y: POD - 0.22, z: (zF + zBack) / 2 }));
    for (let i = 0; i < nCol; i++) ionicColumn(trim, bayC - span / 2 + i * gap, POD, zF - 1.05, 10.67, 0.61);
    for (const s of [-1, 1]) {                                        // antae
      lime.add(box(1.1, CAP - POD, zF - zBack, 0, { x: bayC + s * (halfBay - 0.55), y: POD, z: (zF + zBack) / 2 }));
      // the anta capital projects 8 cm: its face sat exactly in the anta's and the wall's plane (zF), granite against
      // limestone, and flickered under the ends of the architrave inscription (owner 2026-09-27: "small bits near the
      // low library text that are z fighting")
      trim.add(box(1.42, 0.5, 1.42, 0, { x: bayC + s * (halfBay - 0.55), y: CAP - 0.5, z: LOWZF ? zF - 0.63 : zF - 0.71 }));
    }
    for (const s of [-1, 0, 1]) {                                     // three bronze doorways
      brz.add(box(2.5, 5.4, 0.3, 0, { x: bayC + s * 5.0, y: POD + 0.1, z: zBack + 0.16 }));
      trim.add(box(3.5, 0.44, 0.5, 0, { x: bayC + s * 5.0, y: POD + 5.5, z: zBack + 0.3 }));
      for (const j of [-1, 1]) trim.add(box(0.5, 5.94, 0.5, 0, { x: bayC + s * 5.0 + j * 1.75, y: POD + 0.1, z: zBack + 0.3 }));
    }
    for (const s of [-1, 1]) for (const k of [0, 1]) {                // loggia windows
      const wx = bayC + s * (9.6 + k * 3.4);
      gls.add(box(1.9, 3.4, 0.2, 0, { x: wx, y: POD + 2.3, z: zBack + 0.14 }));
      trim.add(box(2.3, 0.3, 0.4, 0, { x: wx, y: POD + 1.98, z: zBack + 0.24 }));
      trim.add(box(2.3, 0.28, 0.4, 0, { x: wx, y: POD + 5.7, z: zBack + 0.24 }));
    }

    /* ---- the 86 ft frontal stair: 24 risers, three flights with landings --- */
    const stW = 26.2, rise = (POD - YP) / 24, tread = 0.40, land = 1.4;
    let sz = zF, sy = POD;                                            // walk down from the portico
    const cheek = [];
    for (let f = 0; f < 3; f++) {
      const zTop = sz, yTop = sy;
      for (let i = 0; i < 8; i++) {
        gran.add(box(stW, sy - (YP - 0.4), tread + 0.03, 0, { x: bayC, y: YP - 0.4, z: sz + tread / 2 }));
        sz += tread; sy -= rise;
      }
      cheek.push([zTop, yTop, sz, sy]);
      if (f < 2) {
        gran.add(box(stW, sy - (YP - 0.4), land, 0, { x: bayC, y: YP - 0.4, z: sz + land / 2 }));
        cheek.push([sz, sy, sz + land, sy]);
        sz += land;
      }
    }
    for (const s of [-1, 1]) {                                        // cheek walls + coping
      const cx = bayC + s * (stW / 2 + 0.6);
      for (const [z0, y0, z1, y1] of cheek) {
        const L = z1 - z0, dy = y1 - y0, ln = Math.hypot(L, dy), rx = -Math.atan2(dy, L);
        const m = box(1.2, 1.95, ln + 0.05, 0, {});   // box() is bottom-based:
        m.position.set(cx, (y0 + y1) / 2 - 1.0, (z0 + z1) / 2); // bury 1 m of it
        m.rotation.x = rx;
        gran.add(m);
        const cp = box(1.44, 0.26, ln + 0.05, 0, {});
        cp.position.set(cx, (y0 + y1) / 2 + 0.9, (z0 + z1) / 2);
        cp.rotation.x = rx;
        trim.add(cp);
      }
      // the piers at the foot of the stair, each carrying one of the ornate
      // five-globe bronze standards that book-end the plaza in every photo
      gran.add(box(2.1, 1.55, 2.1, 0, { x: cx, y: YP - 0.3, z: sz - 0.9 }));     // bottom pier
      gran.add(box(2.34, 0.22, 2.34, 0, { x: cx, y: YP - 0.5, z: sz - 0.9 }));
      trim.add(box(2.4, 0.28, 2.4, 0, { x: cx, y: YP + 1.25, z: sz - 0.9 }));
      trim.add(box(2.02, 0.16, 2.02, 0, { x: cx, y: YP + 1.53, z: sz - 0.9 }));
      const ls = lampStandard({ x: cx, y: YP + 1.69, z: sz - 0.9, h: 3.9 });
      vrd.add(ls.metal); glb.add(ls.globes);
    }

    /* ---- the square block: 100 ft walls, a thermal window on each face ---- */
    const dS = 26.4;
    lime.add(box(dS, DRC - (ENT - 2.0), dS, 0, { y: ENT - 2.0 }));
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1])
      lime.add(box(2.8, DRC - ENT + 0.6, 2.8, 0, { x: sx * (dS / 2 - 0.5), y: ENT - 0.6, z: sz2 * (dS / 2 - 0.5) }));
    trim.add(box(dS + 1.6, 0.9, dS + 1.6, 0, { y: DRC }));
    trim.add(box(dS + 0.6, 0.7, dS + 0.6, 0, { y: DRC + 0.9 }));
    for (let f = 0; f < 4; f++) {
      const yaw = f * Math.PI / 2, nx = Math.sin(yaw), nz = Math.cos(yaw);
      thermalWindow(trim, gls, dS / 2, yaw, YP + 22.1, 7.3);
      trim.add(box(dS - 3.4, 0.5, 0.66, 0, { x: nx * (dS / 2 - 0.1), y: YP + 21.2, z: nz * (dS / 2 - 0.1), rotY: yaw }));
    }
    for (const sx of [-1, 1]) for (const sz2 of [-1, 1])                        // roof stacks
      lime.add(box(1.7, 2.4, 2.8, 0, { x: sx * (dS / 2 - 1.7), y: DRC + 1.55, z: sz2 * (dS / 2 - 1.7) }));

    /* ---- the granite saucer dome ---- */
    dm.add(cyl(11.9, 12.6, 0.95, 0, { y: DRC + 1.6, seg: 26 }));
    dm.add(cyl(11.15, 11.9, 0.75, 0, { y: DRC + 2.35, seg: 26 }));
    {
      // 20 facets, flat-shaded: the real saucer is radially ribbed and reads as
      // light/dark segments in every frontal and aerial photograph. Its apex is
      // a big circular SKYLIGHT over the rotunda, not a stone lantern + ball.
      const rD = 10.6, riseD = APEX - SPR;
      const sg = new THREE.SphereGeometry(rD, 20, 9, 0, Math.PI * 2, 0, Math.PI / 2);
      sg.scale(1, riseD / rD, 1);
      const dmesh = new THREE.Mesh(sg, mat(0, {}));
      dmesh.position.y = SPR;
      dm.add(dmesh);
      dm.add(cyl(3.5, 3.9, 0.55, 0, { y: APEX - 0.30, seg: 16 }));              // oculus curb
      gls.add(cyl(3.1, 3.4, 0.35, 0, { y: APEX + 0.22, seg: 16 }));             // its glazing
      dm.add(cyl(0.9, 1.25, 0.30, 0, { y: APEX + 0.57, seg: 10 }));
      dm.add(sphere(0.55, 0, { y: APEX + 1.05 }));                              // finial
    }

    // CT25: Low Library in photographed stone (ashlar limestone, granite podium and stair, the dome's granite)
    lime.into(r, CU_LIME, { rough: 0.88, stone: { set: 'climestone', amt: 0.8, nrm: 0.8, rgh: 0.4, ashlar: 1 } });
    gran.into(r, CU_GRAN, { rough: 0.93, stone: { set: 'cgranite', amt: 0.8, nrm: 0.75, rgh: 0.45 } });
    trim.into(r, CU_TRIM, { rough: 0.82, stone: { set: 'cgranite', amt: 0.5, nrm: 0.5, rgh: 0.3, scale: 0.6 } });
    log.into(r, CU_LOGGIA, { rough: 0.92, stone: { set: 'climestone', amt: 0.7, nrm: 0.7, rgh: 0.3, ashlar: 0.7 } });
    dm.into(r, CU_DOME, { rough: 0.78, flat: true, stone: { set: 'cgranite', amt: 0.6, nrm: 0.4, rgh: 0.3, scale: 1.6 } });
    gls.into(r, 0x24292f, { rough: 0.32, metal: 0.12, flat: false });
    brz.into(r, 0x413a2e, { rough: 0.5, metal: 0.5 });
    vrd.into(r, 0x4c5742, { rough: 0.52, metal: 0.42 });
    glb.into(r, 0xf3ede2, { rough: 0.35, metal: 0, flat: false, emissive: 0xffe6bc, emissiveIntensity: 0.55 });

    return fin(g, ctx, [
      { w: O.W - 1, h: CRN, d: O.D - 1, y: CRN / 2 },
      { w: dS, h: DRC, d: dS, y: DRC / 2 },
    ]);
  },

  /* ================= Butler Library (James Gamble Rogers, 1934) ==============
  The long Beaux-Arts block on South Field's south side: a banded limestone base
  storey, 14 Ionic columns 17 m tall standing free in front of a recessed dark
  glazed wall, the author frieze on the architrave, an attic storey with one
  window per bay under a dentil cornice, green copper roofs behind the parapet,
  and red-brick end pavilions with limestone quoins and a big arched window.
  Compiler: baseY 2.92, height 37.15, front 80.2 x 50.7.                     */
  butlerLibrary(ctx) {
    const [g, r] = shell(ctx);
    const O = orientRing(r, ctx, CAMPUS_N[0], CAMPUS_N[1]);   // colonnade faces Low
    const W = O.W, H = Math.max(30, Math.min(40, ctx.height || 37));
    let zF = -1e9, zR = 1e9;
    for (const [, z] of O.ring) { zF = Math.max(zF, z); zR = Math.min(zR, z); }
    if (!(zF > zR)) { zF = O.D / 2; zR = -O.D / 2; }
    const Dp = zF - zR, zC = (zF + zR) / 2;
    /* Vertical scheme re-measured off the Commons frontal photograph (the view
    down the axis from Low's steps): the north front is base / colonnade /
    author frieze / cornice / TWO attic storeys / green copper cornice. The old
    scheme had one 5.2 m attic, which lost a whole storey of the real building
    and made the colonnade read too tall.                                    */
    // Butler's north-front brick measures 3.02 = padWalk - 0.50; derived, not
    // hard-coded, because baseY moves between compiles (see CU_PADS)
    const YP = cuYP(ctx, CU_PADS.walk - 0.50, -1.2, 1.5);
    const BAS = YP + 10.0;              // top of the banded base storey
    const COL = BAS + 15.2;             // top of the giant Ionic order
    const ARCH = COL + 1.25;            // author frieze band (HOMER HERODOTUS...)
    const ENT = ARCH + 0.75;            // cornice over the frieze
    const AT1 = ENT + 4.35;             // first attic storey  (taller windows)
    const ATB = AT1 + 0.55;             // its intermediate cornice band
    const ATT = ATB + 3.95;             // second attic storey (square windows)
    const TOP = Math.max(ATT + 1.4, H - 0.4);
    const pavW = 10.6;                  // end pavilions
    const cW = W - 2 * pavW;            // limestone centre block
    const nCol = 14, sp = (cW - 5.8) / (nCol - 1);
    const colX = (i) => -cW / 2 + 2.9 + i * sp;
    // the glazed wall sits only ~1.6 m behind the column line: the giant order
    // is ENGAGED, and at any real distance the front reads as a dark glazed
    // band with pale vertical strips, not as a free-standing peristyle
    const zGl = zF - 1.85;

    const lime = bin(), trim = bin(), gran = bin(), brk = bin(), gls = bin(), cop = bin(), brz = bin();
    const deck = bin(), plant = bin();   // CR24: the flat roof and its plant

    /* ---- massing ---- */
    gran.add(box(W + 0.8, YP + 1.2, Dp + 0.8, 0, { y: -1.2, z: zC }));                 // granite footing
    lime.add(box(cW, BAS - YP, Dp, 0, { y: YP, z: zC }));                              // base storey
    lime.add(box(cW, COL - BAS, Dp - 2.7, 0, { y: BAS, z: zC - 1.35 }));               // recessed upper block
    lime.add(box(cW + 0.5, AT1 - ARCH, Dp + 0.5, 0, { y: ARCH, z: zC }));              // 1st attic
    trim.add(box(W + 0.9, 0.45, Dp + 0.9, 0, { y: AT1, z: zC }));                      // its band
    lime.add(box(W - 3.0, ATT - ATB, Dp - 1.4, 0, { y: ATB, z: zC }));                 // 2nd attic, set back
    for (const s of [-1, 1]) {
      const px = s * (W - pavW) / 2;
      brk.add(box(pavW, ATB - YP, Dp - 0.7, 0, { x: px, y: YP, z: zC - 0.35 }));
      lime.add(box(pavW + 0.35, 5.0, Dp - 0.35, 0, { x: px, y: YP, z: zC - 0.35 }));   // limestone base
      lime.add(box(pavW + 0.45, 1.6, Dp - 0.25, 0, { x: px, y: ATB - 1.6, z: zC - 0.35 }));
      trim.add(box(pavW + 1.2, 0.7, Dp + 0.5, 0, { x: px, y: ATB, z: zC - 0.35 }));    // cornice
      lime.add(box(pavW + 0.6, 0.8, Dp + 0.1, 0, { x: px, y: ATB + 0.7, z: zC - 0.35 }));
      for (const q of [-1, 1]) {                                                        // corner finials
        trim.add(box(1.5, 0.55, 1.5, 0, { x: px + q * (pavW / 2 - 0.55), y: ATB + 1.5, z: zF - 1.4 }));
        trim.add(box(1.0, 0.75, 1.0, 0, { x: px + q * (pavW / 2 - 0.55), y: ATB + 2.05, z: zF - 1.4 }));
      }
      for (const q of [-1, 1]) for (let i = 0; i < 9; i++)                             // quoins
        lime.add(box(1.1, 0.9, 1.1, 0, { x: px + q * (pavW / 2 - 0.35), y: YP + 5.4 + i * 1.95, z: zF - 1.05 }));
      // the pavilion's great arched window
      gls.add(box(4.6, 8.6, 0.3, 0, { x: px, y: BAS + 0.8, z: zF - 0.85 }));
      const arc = new THREE.Mesh(new THREE.CircleGeometry(2.3, 14, 0, Math.PI), mat(0, {}));
      arc.position.set(px, BAS + 9.4, zF - 0.85);
      gls.add(arc);
      const av = new THREE.Mesh(new THREE.TorusGeometry(2.62, 0.34, 5, 14, Math.PI), mat(0, {}));
      av.position.set(px, BAS + 9.4, zF - 0.6);
      trim.add(av);
      for (const j of [-1, 1]) trim.add(box(0.6, 9.9, 0.5, 0, { x: px + j * 2.6, y: BAS + 0.5, z: zF - 0.6 }));
      for (let k = 1; k < 4; k++) trim.add(box(4.8, 0.18, 0.42, 0, { x: px, y: BAS + 0.8 + k * 2.1, z: zF - 0.6 }));
      trim.add(box(6.0, 0.4, 0.7, 0, { x: px, y: BAS + 0.4, z: zF - 0.55 }));
      for (const q of [-1, 1]) {                     // pavilion base + attic lights
        for (const [wy, wh] of [[YP + 2.0, 2.4], [YP + 6.0, 2.2], [ENT + 1.2, 2.4], [ATB - 3.0, 1.7]]) {
          gls.add(box(1.8, wh, 0.26, 0, { x: px + q * 2.8, y: wy, z: zF - 0.85 }));
          trim.add(box(2.3, 0.26, 0.46, 0, { x: px + q * 2.8, y: wy - 0.26, z: zF - 0.72 }));
          trim.add(box(2.3, 0.26, 0.46, 0, { x: px + q * 2.8, y: wy + wh, z: zF - 0.72 }));
        }
      }
      for (let i = 0; i < 4; i++) for (let k = 0; k < 3; k++)                          // pavilion flanks
        gls.add(box(0.3, 2.4, 1.6, 0, { x: px + s * (pavW / 2 - 0.1), y: BAS + 1.2 + i * 4.6, z: zF - 8 - k * 8 }));
    }

    /* ---- base storey: banded courses, bay windows, the entrance ---- */
    for (let i = 0; i < 5; i++) trim.add(box(cW + 0.22, 0.14, Dp + 0.22, 0, { y: YP + 1.6 + i * 1.5, z: zC }));
    trim.add(box(cW + 0.55, 0.6, Dp + 0.55, 0, { y: BAS - 0.6, z: zC }));
    for (let i = 0; i < nCol - 1; i++) {
      const bx = colX(i) + sp / 2;
      if (Math.abs(bx) < 4.4) continue;
      gls.add(box(2.4, 3.1, 0.24, 0, { x: bx, y: YP + 3.7, z: zF - 0.12 }));
      trim.add(box(2.9, 0.28, 0.5, 0, { x: bx, y: YP + 3.42, z: zF + 0.02 }));
      trim.add(box(2.9, 0.26, 0.44, 0, { x: bx, y: YP + 6.8, z: zF + 0.02 }));
      gls.add(box(1.9, 1.5, 0.24, 0, { x: bx, y: YP + 0.9, z: zF - 0.12 }));
    }
    brz.add(box(6.4, 4.6, 0.36, 0, { y: YP + 0.4, z: zF - 0.08 }));                    // entrance
    trim.add(box(8.4, 0.7, 1.2, 0, { y: YP + 5.0, z: zF + 0.2 }));
    for (const j of [-1, 1]) trim.add(box(0.9, 5.6, 1.2, 0, { x: j * 3.75, y: YP, z: zF + 0.2 }));
    for (let i = 0; i < 4; i++) gran.add(box(10.0 + i * 0.6, 0.2, 0.46, 0, { y: YP - 0.2 * (i + 1), z: zF + 0.9 + i * 0.46 }));

    /* ---- the giant order before the glazed wall ---- */
    for (let i = 0; i < nCol - 1; i++) {
      const bx = colX(i) + sp / 2, bw = sp - 1.5;
      gls.add(box(bw, COL - BAS - 1.6, 0.22, 0, { x: bx, y: BAS + 0.8, z: zGl + 0.05 }));
      for (let k = 1; k < 5; k++)
        trim.add(box(bw - 0.1, 0.2, 0.34, 0, { x: bx, y: BAS + 0.8 + k * (COL - BAS - 1.6) / 5, z: zGl + 0.1 }));
      trim.add(box(bw + 0.2, 0.55, 0.66, 0, { x: bx, y: BAS + 0.25, z: zGl + 0.15 }));
    }
    for (let i = 0; i < nCol; i++) ionicColumn(trim, colX(i), BAS, zF - 0.98, COL - BAS, 0.88);
    for (const s of [-1, 1]) {                                                         // antae
      lime.add(box(1.6, COL - BAS, 2.6, 0, { x: s * (cW / 2 - 0.8), y: BAS, z: zF - 1.3 }));
      trim.add(box(1.9, 0.5, 2.8, 0, { x: s * (cW / 2 - 0.8), y: COL - 0.5, z: zF - 1.3 }));
    }

    /* ---- architrave (author frieze), cornice, the two attic storeys ---- */
    trim.add(box(cW + 1.0, ARCH - COL, Dp + 1.0, 0, { y: COL, z: zC }));
    r.add(inscription(cW - 3.0, 0.68, 'HOMER·HERODOTUS·SOPHOCLES·PLATO·ARISTOTLE·DEMOSTHENES·CICERO·VERGIL',
      { y: COL + 0.30, z: zF + 0.55, ink: CU_INK }));
    for (const s of [-1, 1])                                                           // frieze-end wreaths
      trim.add(disc(0.52, 0.30, 0, { x: s * (cW / 2 - 1.6), y: COL + (ARCH - COL) / 2, z: zF + 0.62 }));
    trim.add(box(cW + 1.5, 0.55, Dp + 1.5, 0, { y: ENT - 0.55, z: zC }));
    for (let i = 0, n = Math.floor(cW / 0.82); i < n; i++)
      trim.add(box(0.26, 0.24, 0.5, 0, { x: -cW / 2 + (i + 0.5) * (cW / n), y: ENT - 0.85, z: zF + 0.5 }));
    // first attic storey: 19 tall lights on the centre block
    for (let i = 0, n = 19; i < n; i++) {
      const bx = -cW / 2 + (i + 0.5) * (cW / n);
      gls.add(box(1.55, 2.5, 0.26, 0, { x: bx, y: ENT + 1.0, z: zF + 0.12 }));
      trim.add(box(2.0, 0.24, 0.5, 0, { x: bx, y: ENT + 0.76, z: zF + 0.26 }));
      trim.add(box(2.0, 0.26, 0.5, 0, { x: bx, y: ENT + 3.5, z: zF + 0.26 }));
    }
    // second attic storey: the same rhythm in smaller square lights, set back
    for (let i = 0, n = 19; i < n; i++) {
      const bx = -cW / 2 + (i + 0.5) * (cW / n);
      gls.add(box(1.35, 1.55, 0.26, 0, { x: bx, y: ATB + 1.15, z: zF - 0.58 }));
      trim.add(box(1.75, 0.22, 0.42, 0, { x: bx, y: ATB + 0.93, z: zF - 0.46 }));
    }
    for (let i = 0; i < 13; i++) {                                                     // the 114th St back
      const bx = -cW / 2 + (i + 0.5) * (cW / 13);
      for (const [wy, wh] of [[YP + 2.4, 3.0], [BAS + 1.6, 3.4], [BAS + 7.0, 3.4], [BAS + 12.4, 3.4], [ENT + 1.2, 2.6]]) {
        gls.add(box(2.0, wh, 0.26, 0, { x: bx, y: wy, z: zR - 0.13 }));
        trim.add(box(2.5, 0.24, 0.44, 0, { x: bx, y: wy - 0.24, z: zR - 0.24 }));
      }
    }
    // the crowning cornice is GREEN COPPER, not stone: it is the strongest
    // horizontal in every photograph of the north front
    trim.add(box(W - 2.6, 0.35, Dp - 1.0, 0, { y: ATT, z: zC }));
    // CR24 (owner 2026-09-24, "Columbia buildings' roofs are missing"): the copper is the cornice and the parapet RING.
    // Both were solid slabs over the whole plan with a copper pyramid on them, so from above Butler was one green lid;
    // The reference views (top and north) show a flat pale deck carrying the
    // stack penthouse and its plant, with the copper only round the edge.
    const ring4 = (bn, w, d, t, h, y) => {
      bn.add(box(w, h, t, 0, { y, z: zC + d / 2 - t / 2 }));
      bn.add(box(w, h, t, 0, { y, z: zC - d / 2 + t / 2 }));
      bn.add(box(t, h, d - 2 * t, 0, { x: w / 2 - t / 2, y, z: zC }));
      bn.add(box(t, h, d - 2 * t, 0, { x: -w / 2 + t / 2, y, z: zC }));
    };
    ring4(cop, W - 1.4, Dp + 0.4, 1.3, 0.62, ATT + 0.35);                                   // the crowning copper cornice
    for (let i = 0, n = Math.floor((W - 3) / 0.88); i < n; i++)
      cop.add(box(0.3, 0.26, 0.52, 0, { x: -(W - 3) / 2 + (i + 0.5) * ((W - 3) / n), y: ATT + 0.09, z: zF - 0.42 }));
    ring4(cop, W - 3.4, Dp - 1.8, 0.4, 0.55, ATT + 0.97);                                   // parapet

    /* ---- the roof: a pale coated deck, the penthouse over the stacks, packaged plant ---- */
    deck.add(box(W - 3.0, 0.08, Dp - 1.6, 0, { y: ATT + 0.35, z: zC }));
    trim.add(box(cW * 0.46, 4.4, Dp * 0.36, 0, { y: ATT + 0.43, z: zC + Dp * 0.04 }));
    trim.add(box(cW * 0.24, 2.6, Dp * 0.2, 0, { y: ATT + 4.83, z: zC + Dp * 0.04 }));
    for (const [px, pz] of [[-0.33, -0.27], [0.33, -0.27], [-0.37, 0.31], [0.37, 0.31]])
      plant.add(box(3.2, 1.9, 2.4, 0, { x: px * cW, y: ATT + 0.43, z: zC + pz * Dp }));

    lime.into(r, CU_LIME, { rough: 0.88, stone: { set: 'climestone', amt: 0.8, nrm: 0.8, rgh: 0.4, ashlar: 1 } });   // CT25: Butler
    trim.into(r, CU_TRIM, { rough: 0.82, stone: { set: 'cgranite', amt: 0.5, nrm: 0.5, rgh: 0.3, scale: 0.6 } });
    gran.into(r, CU_GRAN, { rough: 0.93, stone: { set: 'cgranite', amt: 0.8, nrm: 0.75, rgh: 0.45 } });
    brk.into(r, 0x8e5138, { rough: 0.94 });
    gls.into(r, 0x1c2228, { rough: 0.30, metal: 0.16, flat: false });
    cop.into(r, 0x6e9c86, { rough: 0.74, metal: 0.05 });   // CR24: verdigris, a matte mineral crust
    brz.into(r, 0x413a2e, { rough: 0.5, metal: 0.5 });
    deck.into(r, 0x9d9b94, { rough: 0.9 });
    plant.into(r, 0x8f9392, { rough: 0.6, metal: 0.35 });

    return fin(g, ctx, [{ w: W, h: TOP, d: Dp, y: TOP / 2 }]);
  },

  /* ============ St Paul's Chapel (Howells & Stokes, 1907) ===================
  Northern Italian Renaissance in Roman brick and limestone. Modelled off the
  Commons frontal (`2014 Columbia University St. Paul's Chapel.jpg`), which the
  round-1 build did not use: the front is NOT a projecting portico. It is a
  solid brick wall with a two-storey RECESS cut into it, four free-standing
  limestone columns standing in the recess between two broad brick piers, an
  entablature carrying PRO·ECCLESIA·DEI, a limestone balustrade over that, and
  above the balustrade a brick gable wall with a big wreathed oculus. Behind it
  the octagonal brick drum -- round-arched window in every face, engaged
  pilasters at the corners, limestone cornice -- carries a low GREEN COPPER
  dome, a lantern and a cross.
  Compiler: baseY 6.11, height 26.87; the chapel straddles the terrace edge, so
  the paving it fronts (10.22) is 4.10 above baseY and its far flank falls to
  the street.                                                                */
  stPaulsChapel(ctx) {
    const [g, r] = shell(ctx);
    const O = orientRing(r, ctx, -CAMPUS_N[0], -CAMPUS_N[1]);  // porch faces the campus walk
    const W = Math.max(15, Math.min(24, O.W)), D = Math.max(24, O.D);
    // the chapel's campus-side paving measures 9.90 = padTop - 0.30 (probed);
    // derived, not hard-coded, because baseY moves between compiles
    const YP = cuYP(ctx, CU_PADS.top - 0.30, 0.5, 8.5), zF = D / 2;
    const COLH = 7.60;                       // the porch columns
    const ARCH = YP + COLH;                  // architrave bed
    const CORN = ARCH + 1.70;                // top of the front cornice
    const GABL = CORN + 5.30;                // apex of the gable wall behind the balustrade
    const DRB = CORN + 0.30, DRT = DRB + 6.60;
    const DOMA = DRT + 2.80;
    const PD = 2.70, rw = W * 0.58;          // depth and clear width of the recess
    const pw = (W - rw) / 2;                 // the brick pier each side of it
    const brk = bin(), lime = bin(), gls = bin(), cop = bin(), brz = bin();

    /* ---- shell: the brick block, with the porch recess left out of it ---- */
    brk.add(box(W, CORN + 8.6, D - PD, 0, { y: -8.6, z: -PD / 2 }));
    lime.add(box(W + 0.5, 1.9, D - PD + 0.5, 0, { y: YP - 0.7, z: -PD / 2 }));   // water table
    const pR = CH32 ? 0.06 : 0;                                  // CH32: the brick piers' setback behind the stone
    for (const s of [-1, 1]) {                                   // the two front piers
      const px = s * (W + rw) / 4;
      brk.add(box(pw, CORN - YP + 0.7, PD - pR, 0, { x: px, y: YP - 0.7, z: zF - PD / 2 - pR / 2 }));
      lime.add(box(pw + 0.5, 1.9, PD, 0, { x: px, y: YP - 0.7, z: zF - PD / 2 }));
      // the small round-arched niche each pier carries beside the entrance
      gls.add(box(1.45, 2.30, 0.24, 0, { x: px, y: YP + 1.30, z: zF - 0.12 - (CH32 ? pR - 0.01 : 0) }));
      const nz = new THREE.Mesh(new THREE.CircleGeometry(0.72, 12, 0, Math.PI), mat(0, {}));
      nz.position.set(px, YP + 3.60, CH32 ? zF - pR + 0.01 : zF - 0.12);
      gls.add(nz);
      const nv = new THREE.Mesh(new THREE.TorusGeometry(0.82, 0.14, 4, 12, Math.PI), mat(0, {}));
      nv.position.set(px, YP + 3.60, zF + 0.02);
      lime.add(nv);
    }

    /* ---- the porch: four limestone columns in the recess, granite floor ---- */
    lime.add(box(rw + 0.4, 0.45, PD + 0.5, 0, { x: 0, y: YP - 0.45, z: zF - PD / 2 }));
    for (let i = 0; i < 4; i++)
      ionicColumn(lime, -rw / 2 + 1.05 + i * (rw - 2.1) / 3, YP, zF - 0.90, COLH, 0.44);
    // the round-arched bronze doorway at the back of the recess
    brz.add(box(3.1, 4.6, 0.28, 0, { y: YP + 0.05, z: zF - PD + 0.16 }));
    const dArc = new THREE.Mesh(new THREE.CircleGeometry(1.55, 14, 0, Math.PI), mat(0, {}));
    dArc.position.set(0, YP + 4.65, zF - PD + 0.16);
    brz.add(dArc);
    const dVou = new THREE.Mesh(new THREE.TorusGeometry(1.75, 0.24, 4, 14, Math.PI), mat(0, {}));
    dVou.position.set(0, YP + 4.65, zF - PD + 0.30);
    lime.add(dVou);

    /* ---- entablature + PRO ECCLESIA DEI + the limestone balustrade ---- */
    lime.add(box(W + 0.5, 1.18, 1.5, 0, { y: ARCH, z: zF - 0.75 }));       // frieze band
    lime.add(box(rw + 1.2, 1.18, PD, 0, { y: ARCH, z: zF - PD / 2 }));     // its beam over the porch
    lime.add(box(W + 0.95, 0.52, 2.0, 0, { y: ARCH + 1.18, z: zF - 1.0 })); // cornice
    r.add(inscription(rw * 0.94, 0.60, 'PRO·ECCLESIA·DEI',
      { x: 0, y: ARCH + 0.30, z: zF + 0.28, ink: 0x5d5140 }));
    lime.add(box(W + 0.95, 0.20, 1.6, 0, { y: CORN, z: zF - 0.80 }));      // balustrade plinth
    {
      const nb = Math.max(7, Math.round(rw / 0.62));
      for (let i = 0; i < nb; i++)
        lime.add(box(0.19, 0.80, 0.19, 0, { x: -rw / 2 + (i + 0.5) * rw / nb, y: CORN + 0.20, z: zF - 0.80 }));
      for (const s of [-1, 1])                                             // its end piers
        brk.add(box(pw - 0.4, 1.00, 1.5, 0, { x: s * (W + rw) / 4, y: CORN + 0.20, z: zF - 0.80 }));
      lime.add(box(W + 0.95, 0.22, 1.6, 0, { y: CORN + 1.00, z: zF - 0.80 }));
    }

    /* ---- the gable wall: a shallow pediment outline in limestone round a big
    wreathed oculus, the front's strongest feature in the photograph ---- */
    const gw = rw + pw * 0.9;
    brk.add(box(gw, GABL - CORN, 1.3, 0, { y: CORN, z: zF - 2.0 }));
    for (const s of [-1, 1]) {                                   // raking cornice
      const rk = box(gw * 0.60, 0.40, 1.7, 0, {});
      rk.position.set(s * gw * 0.26, CORN + 3.55, zF - 1.85);
      rk.rotation.z = -s * 0.34;
      lime.add(rk);
      lime.add(box(1.5, 0.44, 1.7, 0, { x: s * (gw / 2 - 0.5), y: CORN + 2.55, z: zF - 1.85 }));
    }
    lime.add(disc(1.98, 0.34, 0, { y: CORN + 2.15, z: zF - 1.30, seg: 20 }));   // wreath
    gls.add(disc(1.62, 0.30, 0, { y: CORN + 2.15, z: zF - 0.95, seg: 20 }));    // the mosaic
    lime.add(box(0.34, 1.05, 0.30, 0, { y: GABL - 0.15, z: zF - 1.9 }));        // the stone cross
    lime.add(box(0.86, 0.30, 0.30, 0, { y: GABL + 0.35, z: zF - 1.9 }));

    /* ---- lower side bays with green copper hipped roofs ---- */
    for (const s of [-1, 1]) {
      brk.add(box(W + 4.6, CORN - YP - 4.6, 9.2, 0, { x: 0, y: YP, z: s * 5.6 }));
      lime.add(box(W + 5.3, 0.70, 9.8, 0, { y: CORN - 4.6, z: s * 5.6 }));
      cop.add(pyramid(W + 5.0, 9.4, 1.5, 0, { y: CORN - 3.9, z: s * 5.6 }));
    }
    // round-arched aisle windows the whole length of the nave, plus the
    // limestone string course under them: without these the 15 m flanks are one
    // blank brick plane from anywhere on the campus (n2_stpauls_day.png)
    for (const s of [-1, 1]) {
      lime.add(box(0.34, 0.30, D - PD - 2.0, 0, { x: s * (W / 2 - 0.02), y: YP + 3.30, z: -PD / 2 }));
      lime.add(box(0.30, 0.26, D - PD - 2.0, 0, { x: s * (W / 2 - 0.02), y: CORN - 1.5, z: -PD / 2 }));
      const nA = Math.max(4, Math.round((D - PD - 8) / 5.2));
      for (let i = 0; i < nA; i++) {
        const zz = -(D - PD) / 2 + 3.4 + i * ((D - PD - 7.2) / (nA - 1));
        gls.add(box(0.28, 4.4, 2.0, 0, { x: s * (W / 2 - 0.08), y: YP + 3.9, z: zz }));
        const aw = new THREE.Mesh(new THREE.CircleGeometry(1.0, 12, 0, Math.PI), mat(0, {}));
        aw.position.set(s * (W / 2 - 0.08), YP + 8.3, zz);
        aw.rotation.y = s * Math.PI / 2;
        gls.add(aw);
        const av2 = new THREE.Mesh(new THREE.TorusGeometry(1.14, 0.17, 4, 12, Math.PI), mat(0, {}));
        av2.position.set(s * (W / 2 + 0.02), YP + 8.3, zz);
        av2.rotation.y = s * Math.PI / 2;
        lime.add(av2);
        for (const j of [-1, 1])
          lime.add(box(0.36, 5.0, 0.34, 0, { x: s * (W / 2 - 0.02), y: YP + 3.6, z: zz + j * 1.14 }));
      }
    }

    /* ---- the octagonal brick drum and the green copper dome ---- */
    const dr = Math.min(W, 21) * 0.44, ap = dr * Math.cos(Math.PI / 8);
    brk.add(cyl(dr, dr, DRT - DRB, 0, { y: DRB, seg: 8 }));
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4 + Math.PI / 8, yaw = Math.PI / 2 - a;
      const cx = Math.cos(a) * (ap - 0.06), cz = Math.sin(a) * (ap - 0.06);
      gls.add(box(1.55, 2.7, 0.30, 0, { x: cx, y: DRB + 1.5, z: cz, rotY: yaw }));
      const wa = new THREE.Mesh(new THREE.CircleGeometry(0.78, 12, 0, Math.PI), mat(0, {}));
      wa.position.set(cx, DRB + 4.2, cz); wa.rotation.y = yaw;
      gls.add(wa);
      const wv = new THREE.Mesh(new THREE.TorusGeometry(0.90, 0.15, 4, 12, Math.PI), mat(0, {}));
      wv.position.set(cx * 1.03, DRB + 4.2, cz * 1.03); wv.rotation.y = yaw;
      lime.add(wv);
      const pa = i * Math.PI / 4;                                  // corner pilaster
      brk.add(box(0.80, DRT - DRB - 0.3, 0.80, 0,
        { x: Math.cos(pa) * dr * 0.94, y: DRB, z: Math.sin(pa) * dr * 0.94, rotY: -pa }));
    }
    lime.add(cyl(dr + 0.60, dr + 0.30, 0.55, 0, { y: DRT - 0.55, seg: 8 }));   // drum cornice
    {
      const rD = dr + 0.30, riseD = DOMA - DRT;
      const sg = new THREE.SphereGeometry(rD, 16, 7, 0, Math.PI * 2, 0, Math.PI / 2);
      sg.scale(1, riseD / rD, 1);
      const m = new THREE.Mesh(sg, mat(0, {}));
      m.position.y = DRT;
      cop.add(m);
      lime.add(cyl(1.10, 1.28, 1.45, 0, { y: DOMA - 0.30, seg: 8 }));          // lantern
      for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4;
        gls.add(box(0.62, 0.95, 0.16, 0, { x: Math.cos(a) * 1.02, y: DOMA + 0.05, z: Math.sin(a) * 1.02, rotY: Math.PI / 2 - a }));
      }
      cop.add(cyl(0.42, 1.40, 0.80, 0, { y: DOMA + 1.15, seg: 8 }));           // its copper cap
      lime.add(box(0.15, 1.15, 0.15, 0, { y: DOMA + 1.95 }));                  // the cross
      lime.add(box(0.66, 0.15, 0.15, 0, { y: DOMA + 2.55 }));
    }

    brk.into(r, 0x8b4d3b, { rough: 0.94 });
    lime.into(r, 0xd2cbb6, { rough: 0.84 });
    gls.into(r, 0x252b31, { rough: 0.3, metal: 0.12, flat: false });
    cop.into(r, 0x6a7a5c, { rough: 0.7, metal: 0.08, flat: true });   // CR24: olive, older than the halls' copper (the east view)
    brz.into(r, 0x463c30, { rough: 0.5, metal: 0.5 });
    return fin(g, ctx, [{ w: W + 4, h: CORN + 1.2, d: D, y: (CORN + 1.2) / 2 },
      { w: dr * 2, h: DRT, d: dr * 2, y: DRT / 2 }]);
  },
  // Neo-Gothic: 120m slender tower with setbacks + pinnacles, low nave attached.
  riversideChurch(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const tw = Math.min(D * 0.9, 20);
    const tx = -W / 2 + tw * 0.6;
    r.add(setbackTower({ hex: STONE, x: tx, levels: [
      { w: tw, d: tw, h: H * 0.74 },
      { w: tw * 0.8, d: tw * 0.8, h: H * 0.14 },
      { w: tw * 0.58, d: tw * 0.58, h: H * 0.09 }
    ] }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      r.add(spire(1.1, H * 0.09, STONE, { x: tx + sx * tw * 0.42, z: sz * tw * 0.42, y: H * 0.74 }));
    r.add(spire(tw * 0.2, H * 0.055, STONE, { x: tx, y: H * 0.965 }));
    for (const s of [-1, 1])                       // gothic fenestration hint on tower
      r.add(box(tw * 0.16, H * 0.6, 0.5, SLATE, { x: tx + s * tw * 0.2, z: tw * 0.5, y: H * 0.08 }));
    const nw = Math.max(W - tw * 1.3, W * 0.3);
    const nx = tx + tw * 0.45 + nw / 2;
    r.add(box(nw, H * 0.24, D * 0.72, STONE, { x: nx }));
    r.add(gable({ w: nw, d: D * 0.72, h: H * 0.07, hex: SLATE, x: nx, y: H * 0.24 }));
    return fin(g, ctx, [
      { x: tx, w: tw, h: H, d: tw, y: H / 2 },
      { x: nx, w: nw, h: H * 0.31, d: D * 0.72, y: H * 0.155 }
    ]);
  },

  // White granite mausoleum: colonnaded cube, stepped drum-and-cone top.
  grantsTomb(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D);
    r.add(steps({ w: S, d: S, n: 3, rise: 0.5, inset: 1.4, hex: GRANITE }));
    r.add(box(S * 0.8, H * 0.4, S * 0.8, GRANITE, { y: 1.5 }));
    r.add(colonnade({ count: 6, width: S * 0.5, colH: H * 0.28, colR: 0.7, hex: GRANITE, z: S * 0.44, y: 1.5 }));
    r.add(gable({ w: S * 0.56, d: 5, h: H * 0.08, hex: GRANITE, z: S * 0.44, y: 1.5 + H * 0.28 * 1.22 }));
    r.add(cyl(S * 0.21, S * 0.21, H * 0.2, GRANITE, { y: H * 0.42, seg: 14 }));
    r.add(colRing({ r: S * 0.26, count: 14, colH: H * 0.18, colR: 0.55, hex: GRANITE, y: H * 0.42 }));
    r.add(setbackTower({ hex: GRANITE, y0: H * 0.64, levels: [
      { r: S * 0.29, h: H * 0.05, seg: 14 }, { r: S * 0.23, h: H * 0.09, seg: 14 },
      { r: S * 0.17, h: H * 0.09, seg: 12 }, { r: S * 0.11, h: H * 0.08, seg: 10 }
    ] }));
    r.add(spire(S * 0.08, H * 0.05, GRANITE, { y: H * 0.95 }));
    return fin(g, ctx, [
      { w: S * 0.82, h: H * 0.45, d: S * 0.82, y: H * 0.225 },
      { w: S * 0.55, h: H * 0.5, d: S * 0.55, y: H * 0.65 }
    ]);
  },

  // Unfinished gothic colossus: long high nave, stubby twin west towers, rose window.
  stJohnDivine(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const nd = D * 0.58;
    r.add(box(W * 0.97, H * 0.55, nd, GRAY));
    r.add(gable({ w: W * 0.97, d: nd, h: H * 0.22, hex: GRAY, y: H * 0.55 }));
    r.add(box(W * 0.22, H * 0.6, D * 0.92, GRAY, { x: W * 0.08 }));
    r.add(dome(W * 0.1, COPPER, { x: W * 0.08, y: H * 0.6, squash: 0.65, seg: 12 }));
    const tw = nd * 0.4;
    for (const s of [-1, 1])
      r.add(box(tw, H * 0.82, tw, GRAY, { x: -W / 2 + tw * 0.5, z: s * (nd / 2 - tw * 0.3) }));
    r.add(box(2.4, H * 0.68, nd * 0.9, GRAY, { x: -W / 2 + 1.2 }));
    r.add(disc(H * 0.12, 1, DARK, { x: -W / 2 + 0.5, y: H * 0.44, rotY: Math.PI / 2 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.77, d: nd, y: H * 0.385 },
      { x: W * 0.08, w: W * 0.24, h: H * 0.6, d: D * 0.92, y: H * 0.3 }
    ]);
  },

  // Collegiate gothic: dark schist, white trim, central tower, buttressed long hall.
  shepardHall(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W * 0.96, H * 0.45, D * 0.6, SCHIST));
    r.add(gable({ w: W * 0.96, d: D * 0.6, h: H * 0.14, hex: SLATE, y: H * 0.45 }));
    r.add(box(W * 0.98, 1.1, D * 0.63, TRIM, { y: H * 0.45 }));
    const tw = Math.min(D * 0.55, 14);
    r.add(box(tw, H * 0.8, tw, SCHIST));
    r.add(box(tw * 1.06, 1.1, tw * 1.06, TRIM, { y: H * 0.8 }));
    r.add(pyramid(tw * 0.88, tw * 0.88, H * 0.14, SLATE, { y: H * 0.82 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      r.add(spire(0.8, H * 0.11, TRIM, { x: sx * tw * 0.44, z: sz * tw * 0.44, y: H * 0.78 }));
    for (let i = -3; i <= 3; i++) if (i !== 0)
      r.add(box(1.4, H * 0.42, 1.6, TRIM, { x: i * W * 0.12, z: D * 0.3 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.6, d: D * 0.64, y: H * 0.3 },
      { w: tw, h: H, d: tw, y: H / 2 }
    ]);
  },

  // DECORATE: red blade sign + marquee canopy with bulb strip on the street end.
  apolloTheater(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const fx = W / 2;
    const emR = { emissive: 0xcc1111, emissiveIntensity: 0.85 };
    const emW = { emissive: 0xfff0c8, emissiveIntensity: 0.7 };
    r.add(box(3.2, 0.5, D * 0.6, DARK, { x: fx + 1.4, y: 4.2 }));
    r.add(box(3.4, 1.2, D * 0.62, WHITE, { x: fx + 1.4, y: 4.7, m: emW }));
    r.add(billboard(D * 0.62, 0.6, 0xfff2c0, { x: fx + 3.15, y: 4.0, rotY: Math.PI / 2 }));
    const bh = Math.min(12, H * 0.62);
    r.add(box(1.1, bh, 2.6, RED, { x: fx + 0.7, y: H * 0.28, m: emR }));
    for (const s of [-1, 1])
      r.add(box(1.2, bh, 0.3, WHITE, { x: fx + 0.7, y: H * 0.28, z: s * 1.35, m: emW }));
    return g;
  },

  // DECORATE: white terra-cotta cornice bands + rooftop sign frame.
  hotelTheresa(ctx) {
    const [g, r] = shell(ctx); const { W, H } = dims(ctx);
    for (const t of [0.4, 0.64, 0.9])
      g.add(extrudeRing(sc(ctx.footprint, 1.035), 1.0, TRIM, { yBase: H * t }));
    for (const s of [-1, 1]) r.add(box(0.5, 3.6, 0.5, DARK, { x: s * W * 0.18, y: H }));
    r.add(box(W * 0.4, 2.4, 0.4, WHITE, { y: H + 2.6, m: { emissive: 0x777066, emissiveIntensity: 0.5 } }));
    return g;
  },

  // DECORATE: dark bronze curtain-wall fins along both long faces.
  acpStateOffice(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const n = Math.max(4, Math.round(W / 5));
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + (i + 0.5) * (W / n);
      for (const s of [-1, 1]) r.add(box(0.5, H * 0.96, 0.9, BRONZE, { x, z: s * D / 2, m: MET }));
    }
    return g;
  },

  // Small federal frame house: cream clapboard, hip roof, side porch, chimneys.
  hamiltonGrange(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W * 0.88, H * 0.56, D * 0.88, CREAM));
    r.add(pyramid(W * 0.98, D * 0.98, H * 0.26, ROOFDK, { y: H * 0.56 }));
    r.add(box(W * 0.5, H * 0.05, D * 0.5, CREAM, { y: H * 0.82 }));
    r.add(colonnade({ count: 4, width: D * 0.6, colH: H * 0.38, colR: 0.22, hex: CREAM, x: W * 0.5, rotY: Math.PI / 2, entab: 0 }));
    r.add(box(2.4, H * 0.05, D * 0.72, CREAM, { x: W * 0.5, y: H * 0.38 }));
    for (const s of [-1, 1]) r.add(box(1, H * 0.24, 1, BRICK, { x: s * W * 0.2, y: H * 0.66 }));
    return fin(g, ctx, [{ w: W * 0.9, h: H * 0.85, d: D * 0.9, y: H * 0.425 }]);
  },

  // DECORATE: plain brick cornice + entrance canopy.
  schomburg(ctx) {
    const [g, r] = shell(ctx); const { W, H } = dims(ctx);
    g.add(extrudeRing(sc(ctx.footprint, 1.03), 1.1, TERRA, { yBase: Math.max(H - 1.3, 2) }));
    r.add(box(3, 0.5, 6, DARK, { x: W / 2 + 1, y: 3.6 }));
    return g;
  },

  // DECORATE: Whittier Hall, Teachers College (Bruce Price, 1901) — NW corner of W 120th & Amsterdam. The data extrusion
  // stays (red brick over a limestone base via BUILDING_OVERRIDES); this adds what the blind critic missed most
  // (docs/notes/amst120-critic.md): a steep slate roof with dormers and two copper-capped corner turrets, a proud
  // rusticated limestone base two storeys high, and a bracketed cornice line under the eaves. Owner 2026-09-15.
  whittierHall(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const fp = ctx.footprint;
    // limestone base is EXPRESSED, not solid: a granite plinth and a water-table course (a full-height ring hid the
    // ground-floor windows and doors — final_v17 amst120W plate). The rusticated base itself is the record's masonry base.
    g.add(extrudeRing(sc(fp, 1.012), 0.9, GRANITE, { yBase: 0 }));        // plinth
    // water table / string course ON THE FLOOR LINE over the two-storey base. It sat at a fixed 7.6 m, which on the
    // record's floor grid ran straight through the second-floor windows (owner 2026-09-24: "a white line going
    // through ... blocking all of its windows"); the facade and the dresser draw windows on ctx.floorH.
    const fh = ctx.floorH > 2 ? ctx.floorH : 3.65;
    g.add(extrudeRing(sc(fp, 1.02), 0.34, TRIM, { yBase: 2 * fh - 0.17 }));
    g.add(extrudeRing(sc(fp, 1.012), 0.62, TRIM, { yBase: Math.max(H - 0.9, 3) })); // cornice line (slim: the gables rise through it)
    // steep slate roof over the OBB, two ridges so an L-plan still reads as roofs and not one tent
    const rh = Math.min(9, Math.max(5, Math.min(W, D) * 0.42));
    r.add(gable({ w: W * 0.96, d: Math.min(D, 22) * 0.96, h: rh, hex: SLATE, y: H }));
    if (D > 30) r.add(gable({ w: Math.min(W, 22) * 0.96, d: D * 0.96, h: rh * 0.92, hex: SLATE, y: H }));
    // dormers along the long face
    const nd = Math.max(3, Math.round(W / 6.5));
    for (let i = 0; i < nd; i++) {
      const x = -W / 2 + (i + 0.5) * (W / nd);
      for (const s of [-1, 1]) {
        r.add(box(1.7, 2.0, 1.4, BRICK, { x, y: H + 1.1, z: s * (Math.min(D, 22) * 0.48 - 0.9) }));
        r.add(gable({ w: 1.9, d: 1.6, h: 0.9, hex: SLATE, y: H + 2.1, x, z: s * (Math.min(D, 22) * 0.48 - 0.9) }));
      }
    }
    // copper-capped corner turrets
    for (const sx of [-1, 1]) {
      const x = sx * (W / 2 - 2.2), z = Math.min(D, 22) / 2 - 2.2;
      r.add(cyl(1.6, 1.6, 5.5, BRICK, { x, y: H, z, seg: 12 }));            // cyl is bottom-based: drum from the eave
      r.add(cyl(0.05, 1.9, 3.2, COPPER, { x, y: H + 5.5, z, seg: 12 }));    // copper cone on the drum
    }
    // FLEMISH GABLES (owner 2026-09-24, refs/streetview/amst120 nw_tall): what the street reads of Whittier's crown is
    // a rank of stepped brick gables with limestone copings and a round crest, two windows each, standing on the eave
    // of every street front — four along Amsterdam, two on W 120th — not the slate slope behind them.
    {
      let A2 = 0;
      for (let i = 0; i < fp.length; i++) { const [x0, z0] = fp[i], [x1, z1] = fp[(i + 1) % fp.length]; A2 += x0 * z1 - x1 * z0; }
      // ~9.6 m wide, ~7.8 m to the crest: two window storeys in each, as in the references
      const step = (w) => {
        const S = new THREE.Shape(), k = 1.7, d = 1.05;
        S.moveTo(-w, 0); S.lineTo(-w, k); S.lineTo(-w + d, k); S.lineTo(-w + d, 2 * k); S.lineTo(-w + 2 * d, 2 * k);
        S.lineTo(-w + 2 * d, 3 * k); S.lineTo(-1.55, 3 * k); S.absarc(0, 3 * k, 1.55, Math.PI, 0, true);
        S.lineTo(w - 2 * d, 3 * k); S.lineTo(w - 2 * d, 2 * k); S.lineTo(w - d, 2 * k); S.lineTo(w - d, k); S.lineTo(w, k); S.lineTo(w, 0);
        S.closePath();
        return S;
      };
      const brickG = new THREE.ExtrudeGeometry(step(4.8), { depth: 0.6, bevelEnabled: false }); brickG.translate(0, 0, -0.55);
      const copeG = new THREE.ExtrudeGeometry(step(5.0), { depth: 0.45, bevelEnabled: false }); copeG.scale(1, 1.03, 1); copeG.translate(0, 0, -0.62);
      const mBrick = mat(0x9e4a34, { rough: 0.9 }), mTrim = mat(TRIM, { rough: 0.7 }), mWin = mat(0x2a2e33, { rough: 0.3, metal: 0.2 });
      for (let i = 0; i < fp.length; i++) {
        const [x0, z0] = fp[i], [x1, z1] = fp[(i + 1) % fp.length];
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 25) continue;
        let nx = (z1 - z0) / L, nz = -(x1 - x0) / L;
        if (A2 < 0) { nx = -nx; nz = -nz; }
        const rot = Math.atan2(nx, nz), n = Math.max(2, Math.round(L / 16));
        for (let k = 0; k < n; k++) {
          // flush with the wall face (the front 5 cm proud), rising from just under the cornice, which crosses it
          const t = (k + 0.5) / n, px = x0 + (x1 - x0) * t + nx * 0.05, pz = z0 + (z1 - z0) * t + nz * 0.05;
          const gg = new THREE.Group(); gg.position.set(px, H - 1.0, pz); gg.rotation.y = rot;
          gg.add(new THREE.Mesh(brickG, mBrick), new THREE.Mesh(copeG, mTrim));
          const win = (x, y, w, h) => {
            const sur = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.1), mTrim); sur.position.set(x, y, 0.06); gg.add(sur);
            const gl = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.08), mWin); gl.position.set(x, y, 0.1); gg.add(gl);
          };
          for (const sx of [-1.5, 1.5]) win(sx, 2.35, 1.0, 1.6);     // the lower window storey
          win(0, 4.25, 0.95, 1.4);                                    // the upper one
          const band = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.22, 0.14), mTrim); band.position.set(0, 3.4, 0.05); gg.add(band);   // string course
          const ocu = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.1, 18), mWin); ocu.rotation.x = Math.PI / 2; ocu.position.set(0, 5.75, 0.08); gg.add(ocu);
          g.add(gg);
        }
      }
    }
    return g;
  },

  // Neo-gothic bluestone church: gabled front, pointed window, twin low towers.
  abyssinian(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W * 0.88, H * 0.5, D * 0.8, BLUEST));
    r.add(gable({ w: W * 0.88, d: D * 0.8, h: H * 0.28, hex: SLATE, y: H * 0.5 }));
    r.add(box(2.6, H * 0.58, D * 0.86, BLUEST, { x: W * 0.42 }));
    r.add(gable({ w: 2.6, d: D * 0.86, h: H * 0.34, hex: BLUEST, x: W * 0.42, y: H * 0.58 }));
    r.add(box(0.7, H * 0.3, D * 0.22, DARK, { x: W * 0.42 + 1.2, y: H * 0.2 }));
    r.add(gable({ w: 0.7, d: D * 0.22, h: H * 0.08, hex: DARK, x: W * 0.42 + 1.2, y: H * 0.5 }));
    for (const s of [-1, 1]) {
      r.add(box(D * 0.2, H * 0.74, D * 0.2, BLUEST, { x: W * 0.42, z: s * D * 0.34 }));
      r.add(pyramid(D * 0.22, D * 0.22, H * 0.1, SLATE, { x: W * 0.42, z: s * D * 0.34, y: H * 0.74 }));
    }
    return fin(g, ctx, [{ w: W, h: H * 0.82, d: D * 0.88, y: H * 0.41 }]);
  },

  // ==================== Skyline icons ====================

  /* The iconic setback profile; deck at ~86% of total (antenna included in H).
     Critic r5 #6 / #21 on the surface: "a UNIFORM DOT-MATRIX of small dark
     squares with no vertical emphasis at all… the colour is neutral-cool grey
     where Indiana limestone is warm cream-buff… the crown tiers are plain
     untextured blocks with no observatory band and no Art Deco buttress fins,
     and the mast is a smooth cone."
     Fixed here: ESB_LIME is the warm buff; every shaft box uses the new
     vertical-emphasis bay tile (bandCanvas `vert`) at the ESB's own 2.1 m bay
     and 3.25 m floor, so the nickel channels run unbroken; the 7 crude DARK
     strips become Nirosta buttress fins carried up the setback corners; and
     the 86th-floor observatory band, its parapet rail and the mast's ribs are
     modelled. Mast and antenna take skyMetal via MET. */
  empireState(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const ESB_LIME = 0xdccfa6, NIC = 0xcfd2ce;   // warm Indiana limestone / nickel-chrome
    const eb = { bay: 2.1, floor: 3.25, vert: 1, pier: ESB_LIME, glass: 0x2e343c, sill: NIC };
    const lb = { bay: 3.1, floor: 3.6, pier: ESB_LIME, glass: 0x2c323a, sill: 0xdcd2ba }; // punched base
    r.add(bandBox(W, H * 0.048, D, ESB_LIME, { band: lb }));
    r.add(bandBox(W * 0.86, H * 0.16, D * 0.86, ESB_LIME, { y: H * 0.048, band: eb }));
    r.add(box(W * 0.74, H * 0.05, D * 0.74, ESB_LIME, { y: H * 0.208 }));
    const ws = W * 0.46, ds = D * 0.62;
    r.add(bandBox(ws, H * 0.47, ds * 0.82, ESB_LIME, { y: H * 0.258, band: eb }));
    r.add(bandBox(ws * 0.8, H * 0.47, ds, ESB_LIME, { y: H * 0.258, band: eb }));
    // ---- Art Deco buttress fins: a proud nickel-capped limestone pier at the
    // shaft corners and at the centre of each long face, from the 6th-floor
    // setback to the observatory. These, not the window grid, are what give the
    // shaft its vertical read in a silhouette.
    // FIVE verticals per broad face, not one. At 630 m (esbCrown) the whole
    // shaft face is ~44 px, so a 2.1 m bay rhythm is sub-pixel and the nickel
    // channels average to a flat grey however much contrast the tile carries.
    // A ~5 m fin rhythm lands at ~9 px and is what actually reads as vertical
    // emphasis at skyline distance — which is the critic's complaint (r5 #21).
    const FINS = [];
    for (const q of [-0.40, -0.20, 0.0, 0.20, 0.40])
      for (const sz of [1, -1]) FINS.push([ws * q, sz * ds * 0.5, 3.0, 0.75]);
    for (const q of [-0.30, 0.0, 0.30])
      for (const sx of [1, -1]) FINS.push([sx * ws * 0.5, ds * q, 0.75, 3.0]);
    for (const [fx, fz, fw, fd] of FINS) {
      r.add(box(fw, H * 0.462, fd, ESB_LIME, { x: fx, z: fz, y: H * 0.262 }));
      r.add(box(fw * 1.15, H * 0.012, fd * 1.15, NIC, { x: fx, z: fz, y: H * 0.724, m: NIROSTA }));
    }
    // ---- the 86th-floor observatory: a dark glazed band with a nickel rail
    r.add(bandBox(ws * 0.72, H * 0.09, ds * 0.72, ESB_LIME, { y: H * 0.728, band: eb }));
    r.add(box(ws * 0.80, H * 0.026, ds * 0.80, 0x23282f, { y: H * 0.792, m: { rough: 0.2, metal: 0.3 } }));
    r.add(box(ws * 0.86, H * 0.009, ds * 0.86, NIC, { y: H * 0.786, m: NIROSTA }));   // deck slab edge
    r.add(box(ws * 0.84, H * 0.010, ds * 0.84, NIC, { y: H * 0.818, m: NIROSTA }));   // parapet rail
    r.add(box(ws * 0.55, H * 0.045, ds * 0.55, ESB_LIME, { y: H * 0.818 }));
    // ---- the mast: four stepped drums with nickel ribs, not a smooth cone
    r.add(box(ws * 0.4, H * 0.014, ds * 0.4, ESB_LIME, { y: H * 0.863 }));
    r.add(cyl(ws * 0.12, ws * 0.13, H * 0.028, ESB_LIME, { y: H * 0.877, seg: 10 }));
    r.add(cyl(3.0, 3.9, H * 0.020, NIC, { y: H * 0.902, seg: 16, m: NIROSTA }));      // mooring collar
    r.add(cyl(2.2, 3.0, H * 0.034, NIC, { y: H * 0.922, seg: 16, m: NIROSTA }));
    for (let i = 0; i < 8; i++) {                                                     // the vertical ribs
      const a = (i / 8) * Math.PI * 2;
      r.add(box(0.34, H * 0.052, 0.34, NIC, { x: Math.cos(a) * 2.7, z: Math.sin(a) * 2.7, y: H * 0.904, m: NIROSTA }));
    }
    r.add(cyl(1.15, 2.2, H * 0.030, NIC, { y: H * 0.956, seg: 12, m: NIROSTA }));
    r.add(cyl(0.5, 0.9, H * 0.014, NIC, { y: H * 0.986, seg: 6, m: NIROSTA }));
    r.add(sphere(1.2, RED, { y: H * 0.998, m: { emissive: 0xff2222, emissiveIntensity: 1.6 } }));
    return fin(g, ctx, [
      { w: W, h: H * 0.21, d: D, y: H * 0.105 },
      { w: ws, h: H * 0.66, d: ds, y: H * 0.54 }
    ]);
  },

  /* Brick shaft, corner-stepped, 7 radiating Nirosta crown tiers + needle.
     Critic r5 #2 / #21: "THE CHRYSLER BUILDING'S CROWN — the mirror-bright
     Nirosta steel object in New York — renders matte white"
     (parkAveTops_day.png x 900-960, y 440-580). Cause in
     docs/notes/facades-r6.md section 0: `mCr` was metalness 0.75 with a small
     grey emissive, and a metal's mirror came only from the IBL at 0.14. It is
     now NIROSTA (skyMetal), and the crown has the two things that make the
     real one legible at 600 m: the SUNBURST triangular windows radiating from
     each tier's centre, and the ribbed arch chevrons between them. */
  chrysler(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    // the shaft is PALE grey-white brick with grey trim, not the dark brown it
    // rendered as: 0xa08d7a put it 25 sRGB below the limestone next door
    const S = Math.min(W, D), BR = 0xc9bdac, STL = 0xdadde0;
    const brBand = { glass: 0x353c46, sill: 0xd6cab6, bay: 3.3 };
    r.add(bandBox(W, H * 0.14, D, BR, { band: brBand }));
    r.add(bandBox(W * 0.78, H * 0.22, D * 0.78, BR, { y: H * 0.14, band: brBand }));
    r.add(bandBox(S * 0.62, H * 0.26, S * 0.62, BR, { y: H * 0.36, band: brBand }));
    // the steel basketweave band at the 31st floor setback, and the corner eagles
    r.add(box(S * 0.63, H * 0.012, S * 0.63, STL, { y: H * 0.35, m: NIROSTA }));
    r.add(box(S * 0.5, H * 0.06, S * 0.5, BR, { y: H * 0.58 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const ex = sx * S * 0.26, ez = sz * S * 0.26;
      r.add(box(2.4, 1.6, 2.4, STL, { x: ex, z: ez, y: H * 0.6, m: NIROSTA }));
      // the Nirosta eagle head: a beak wedge cantilevered off the corner
      r.add(box(1.1, 0.9, 3.4, STL, { x: ex + sx * 1.1, z: ez + sz * 1.1, y: H * 0.606,
        rotY: Math.atan2(sx, sz), m: NIROSTA }));
    }
    let y = H * 0.62, rad = S * 0.26;
    for (let i = 0; i < 7; i++) {
      const th = H * (0.05 - i * 0.004);
      r.add(dome(rad, STL, { y, squash: th / rad, seg: 12, m: NIROSTA }));
      // ---- the SUNBURST. Each tier of the real crown is pierced by a rank of
      // triangular windows radiating from its centre; they are the crown's
      // whole identity and were simply absent (r5: the tiers render as "plain
      // untextured blocks"). Placed as a RING around the tier of revolution —
      // a tangential chord laid on 4 flat faces would have its outer ends
      // hanging in air off a hemisphere — each slot rotated to face outward,
      // the count falling as the tiers shrink. From 200-600 m this is exactly
      // what the crown reads as: stacked arches each pierced by a row of dark
      // slots, with a bright nickel rib over each row.
      const nW = 20 - i * 2;
      for (let k = 0; k < nW; k++) {
        const a = (k / nW) * Math.PI * 2 + (i % 2) * (Math.PI / nW);
        r.add(box(Math.max(0.5, rad * 1.9 / nW), th * 0.58, 0.34, 0x1e2228, {
          x: Math.sin(a) * rad * 0.93, z: Math.cos(a) * rad * 0.93,
          y: y + th * 0.10, rotY: a, m: { rough: 0.2, metal: 0.4 },
        }));
      }
      // the ribbed nickel chevron over the rank, and the tier's own edge rib
      r.add(cyl(rad * 0.99, rad * 1.02, th * 0.06, STL, { y: y + th * 0.60, seg: 16, m: NIROSTA }));
      r.add(cyl(rad * 1.03, rad * 1.04, th * 0.05, STL, { y, seg: 16, m: NIROSTA }));
      y += th * 0.72; rad *= 0.78;
    }
    r.add(spire(1.6, Math.max(H - y, H * 0.05), STL, { y, m: NIROSTA }));
    return fin(g, ctx, [
      { w: W, h: H * 0.36, d: D, y: H * 0.18 },
      { w: S * 0.62, h: H * 0.32, d: S * 0.62, y: H * 0.5 }
    ]);
  },

  // Square podium; tapered octagonal shaft (square->rotated-square); parapet + mast.
  oneWTC(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D, 62);
    const gm = GLS;
    r.add(box(S, H * 0.107, S, CONC));
    r.add(cyl(S * 0.4, S * 0.55, H * 0.658, GLASS, { y: H * 0.107, seg: 8, rotY: Math.PI / 8, m: gm }));
    r.add(box(S * 0.6, H * 0.012, S * 0.6, GLASS, { y: H * 0.765, m: gm }));
    r.add(cyl(0.8, 2.4, H * 0.223, STEEL, { y: H * 0.777, seg: 6, m: MET }));
    return fin(g, ctx, [
      { w: S, h: H * 0.11, d: S, y: H * 0.055 },
      { w: S * 0.8, h: H * 0.67, d: S * 0.8, y: H * 0.44 }
    ]);
  },

  // Tall thin slab, stepped fins on the short sides, vertical window stripes.
  thirtyRock(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.09, D, LIME2));
    const dslab = Math.min(D * 0.42, 22), finW = W * 0.075;
    r.add(bandBox(W * 0.34, H * 0.985, dslab, LIME2, { band: { bay: 3.2 } }));
    const hs = [0.9, 0.78, 0.62, 0.45];
    for (let i = 0; i < hs.length; i++)
      for (const s of [-1, 1])
        r.add(box(finW, H * hs[i], dslab, LIME2, { x: s * (W * 0.17 + (i + 0.5) * finW) }));
    for (let i = -3; i <= 3; i++)
      for (const s of [-1, 1])
        r.add(box(1.4, H * 0.85, 0.4, DARK, { x: i * W * 0.045, z: s * dslab / 2, y: H * 0.1 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.09, d: D, y: H * 0.045 },
      { w: W * 0.86, h: H, d: dslab, y: H / 2 }
    ]);
  },

  // Extrudes the real triangular footprint; base + 2 bands + crown cornice.
  flatiron(ctx) {
    const g = new THREE.Group(); const { W, D, H } = dims(ctx);
    const fp = (ctx.footprint && ctx.footprint.length >= 3)
      ? ctx.footprint
      : [[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]];
    g.add(extrudeRing(fp, H * 0.12, 0xb8ab94));
    // The shaft was one blank limestone prism. Invert it: a dark window plane
    // for the whole shaft, then a projecting limestone course per floor, so
    // what is left exposed between courses reads as a punched window band.
    const yS = H * 0.12, hS = H * 0.82;
    g.add(extrudeRing(sc(fp, 0.972), hS, 0x3b4550, { yBase: yS }));
    const nFl = Math.max(6, Math.min(30, Math.round(hS / 3.9)));
    const fhF = hS / nFl;
    for (let i = 0; i < nFl; i++) g.add(extrudeRing(sc(fp, 0.985), fhF * 0.58, LIME, { yBase: yS + i * fhF }));
    g.add(extrudeRing(sc(fp, 1.03), H * 0.02, LIME2, { yBase: H * 0.12 }));
    g.add(extrudeRing(sc(fp, 1.03), H * 0.02, LIME2, { yBase: H * 0.62 }));
    g.add(extrudeRing(sc(fp, 1.06), H * 0.06, LIME2, { yBase: H * 0.94 }));
    return fin(g, ctx, [{ w: ctx.obb.w, h: H, d: ctx.obb.h, y: H / 2 }]);
  },

  // Wide octagonal-ish precast slab; flat top with sign block.
  metLife(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.04, D, CONC));
    r.add(box(W * 0.96, H * 0.955, D * 0.7, CONC));
    r.add(box(W * 0.72, H * 0.955, D * 0.96, CONC));
    for (let i = 1; i <= 4; i++) r.add(box(W * 0.97, 0.9, D * 0.71, 0xa39d95, { y: H * 0.19 * i }));
    r.add(box(W * 0.3, H * 0.035, D * 0.32, WHITE, { y: H * 0.955 }));
    return fin(g, ctx, [{ w: W * 0.96, h: H, d: D * 0.96, y: H / 2 }]);
  },

  // Neo-gothic: terra cotta tower on broad base, green pyramid roof + tourelles.
  woolworth(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.3, D, TERRA));
    r.add(box(W * 0.9, H * 0.05, D * 0.9, TERRA, { y: H * 0.3 }));
    const tw = Math.min(W * 0.34, D * 0.62);
    const tz = D * 0.5 - tw * 0.55;
    r.add(box(tw, H * 0.78, tw, TERRA, { z: tz }));
    r.add(box(tw * 0.78, H * 0.08, tw * 0.78, TERRA, { z: tz, y: H * 0.78 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      r.add(spire(1.3, H * 0.07, COPPER, { x: sx * tw * 0.38, z: tz + sz * tw * 0.38, y: H * 0.8 }));
    r.add(pyramid(tw * 0.72, tw * 0.72, H * 0.11, COPPER, { z: tz, y: H * 0.86 }));
    r.add(spire(1.2, H * 0.035, COPPER, { z: tz, y: H * 0.965 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.3, d: D, y: H * 0.15 },
      { z: tz, w: tw, h: H * 0.9, d: tw, y: H * 0.45 }
    ]);
  },

  // 4 interlocking tapering glass fins ending at different heights + spire.
  oneVanderbilt(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D), q = S * 0.26;
    const gm = GLS;
    r.add(box(W * 0.95, H * 0.055, D * 0.95, 0xb9a98e, { m: { rough: 0.6, metal: 0.3 } }));
    const fins = [[-1, -1, 1.0], [1, -1, 0.82], [-1, 1, 0.7], [1, 1, 0.58]];
    for (const [sx, sz, t] of fins) {
      r.add(setbackTower({ hex: GLASS, x: sx * S * 0.21, z: sz * S * 0.21, m: gm, levels: [
        { w: q * 2, d: q * 2, h: H * t * 0.55 },
        { w: q * 1.5, d: q * 1.5, h: H * t * 0.3 },
        { w: q * 1.05, d: q * 1.05, h: H * t * 0.15 }
      ] }));
    }
    r.add(spire(2.2, H * 0.06, 0xb9a98e, { x: -S * 0.21, z: -S * 0.21, y: H * 0.95, m: MET }));
    return fin(g, ctx, [{ w: S, h: H, d: S, y: H / 2 }]);
  },

  // The pencil: perfect slender white concrete tube, banded mechanical floors.
  p432park(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D, 30) * 0.98;
    // the pencil is a 6 x 6 grid of 10 ft square windows on a 15 ft bay — the
    // one thing that identifies it, and it had no openings at all
    r.add(bandBox(S, H * 0.995, S, PENCIL, { band: {
      bay: 4.7, floor: 4.7, pier: 0xe6e2da, glass: 0x2f353c, sill: 0xe8e4dc, rough: 0.72 } }));
    for (let i = 1; i <= 5; i++) r.add(box(S * 1.01, 1.8, S * 1.01, 0x9d9a94, { y: H * i / 6 }));
    r.add(box(S * 1.03, 1.2, S * 1.03, PENCIL, { y: H * 0.995 }));
    return fin(g, ctx, [{ w: S, h: H, d: S, y: H / 2 }]);
  },

  // Blocky glass supertall with cantilevered massing steps.
  cpTower(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const gm = GLS;
    r.add(box(W, H * 0.12, D, GLASS2, { m: gm }));
    r.add(box(W * 0.85, H * 0.5, D * 0.9, GLASS2, { y: H * 0.12, m: gm }));
    r.add(box(W * 0.85, H * 0.34, D * 1.14, GLASS2, { y: H * 0.2, z: D * 0.12, m: gm }));
    r.add(box(W * 0.72, H * 0.26, D * 0.85, GLASS2, { y: H * 0.62, m: gm }));
    r.add(box(W * 0.55, H * 0.12, D * 0.7, GLASS2, { y: H * 0.88, m: gm }));
    return fin(g, ctx, [
      { w: W, h: H * 0.62, d: D * 1.1, y: H * 0.31, z: D * 0.05 },
      { w: W * 0.72, h: H * 0.38, d: D * 0.85, y: H * 0.81 }
    ]);
  },

  // Ultra-thin tower, feathered setbacks stepping down one face, bronze stripes.
  steinway(ctx) {
    if (CP33LM && ctx.footprint && ctx.footprint.length >= 4) {
      try { return buildSteinway(ctx); } catch (e) { console.warn('steinway ring build failed', e); }
    }
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const a = Math.min(D, 18), b = Math.min(W, 26);
    r.add(box(Math.min(W, 42), H * 0.16, D, TERRA));
    r.add(box(b, H * 0.5, a, TERRA));
    for (let i = 0; i < 6; i++) {
      const bb = b * (1 - 0.13 * i);
      r.add(box(bb, H * 0.0834, a, TERRA, { x: (b - bb) / 2, y: H * (0.5 + 0.0833 * i) }));
    }
    for (let i = -2; i <= 2; i++)
      for (const s of [-1, 1])
        r.add(box(0.8, H * (0.45 + 0.09 * (2 - Math.abs(i))), 0.5, BRASS,
          { x: i * b * 0.16, z: s * a * 0.5, y: H * 0.16, m: MET }));
    return fin(g, ctx, [
      { w: Math.min(W, 42), h: H * 0.16, d: D, y: H * 0.08 },
      { w: b, h: H, d: a, y: H / 2 }
    ]);
  },

  // 1928 stone base + faceted diagrid glass tower.
  hearst(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.15, D, 0xcac2b0));
    r.add(box(W * 0.74, H * 0.85, D * 0.74, 0x55636e, { y: H * 0.15, m: GLS }));
    r.add(lattice({ w: W * 0.75, h: H * 0.83, d: D * 0.75, step: H * 0.12, barR: 0.55, hex: STEEL, y: H * 0.16, allFaces: true }));
    return fin(g, ctx, [
      { w: W, h: H * 0.15, d: D, y: H * 0.075 },
      { w: W * 0.75, h: H * 0.85, d: D * 0.75, y: H * 0.575 }
    ]);
  },

  // White aluminum tower on 4 massive side-center stilts, 45-degree crown.
  citigroup(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D), AL = 0xdcdcda, stH = H * 0.125;
    for (const [px, pz] of [[S * 0.42, 0], [-S * 0.42, 0], [0, S * 0.42], [0, -S * 0.42]])
      r.add(box(7, stH, 7, AL, { x: px, z: pz }));
    r.add(box(S * 0.24, stH, S * 0.24, AL));
    r.add(box(S * 0.94, H * 0.745, S * 0.94, AL, { y: stH, m: { rough: 0.5, metal: 0.35,
      skyMetal: { tint: [0.90, 0.90, 0.89], rough: 0.22, brush: 0.55, gain: 0.75 } } }));
    r.add(wedge({ w: S * 0.94, d: S * 0.94, h: H * 0.13, hex: AL, y: H * 0.87 }));
    return fin(g, ctx, [{ w: S * 0.94, h: H, d: S * 0.94, y: H / 2 }]);
  },

  // Thin wide slab: green glass broad faces, white marble end walls.
  unSecretariat(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const d = Math.min(D, W * 0.32);
    r.add(box(W * 0.9, H, d, GREENGL, { m: GLS }));
    for (const s of [-1, 1]) r.add(box(W * 0.06, H * 1.005, d * 1.06, WHITE, { x: s * W * 0.45 }));
    r.add(box(W * 0.96, 1.4, d * 0.8, WHITE, { y: H }));
    return fin(g, ctx, [{ w: W, h: H, d, y: H / 2 }]);
  },

  // Low beaux-arts hall: 3 huge arched windows, clock block, copper roof behind.
  grandCentral(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const GC = 0xc9c0ac;
    r.add(box(W * 0.95, H * 0.55, D * 0.9, GC));
    r.add(box(W * 0.62, H * 0.75, 4, GC, { z: D * 0.43 }));
    for (let i = -1; i <= 1; i++) {
      r.add(box(W * 0.1, H * 0.42, 1.2, DKGLASS, { x: i * W * 0.16, z: D * 0.43 + 1.6, y: H * 0.18 }));
      r.add(disc(W * 0.05, 1.2, DKGLASS, { x: i * W * 0.16, z: D * 0.43 + 1.6, y: H * 0.6 }));
    }
    r.add(box(W * 0.14, H * 0.14, 3, 0xb9b098, { z: D * 0.43 + 0.8, y: H * 0.75 }));
    r.add(sphere(H * 0.05, GOLD, { z: D * 0.43 + 2.4, y: H * 0.79, m: MET }));
    r.add(gable({ w: W * 0.9, d: D * 0.75, h: H * 0.22, hex: COPPER, y: H * 0.55 }));
    return fin(g, ctx, [{ w: W, h: H * 0.8, d: D, y: H * 0.4 }]);
  },

  /* ============ New York Public Library, Stephen A. Schwarzman Building ======
  Carrère & Hastings, 1911, Vermont marble. Critic round 5 defect #3 — the
  round's third-worst — reads: "a single flat pale-grey plane 25 m tall fills
  the right half of the frame; no window, cornice, rustication, terrace, step
  or balustrade. WORSE than round 4, where it was at least a wall." Four rounds
  old. docs/notes/facades-r6.md §2 has the diagnosis; the short version is that
  the old builder DID build a portico, and put it on the wrong side of the
  building. `shell()` only applies `rotation.y = -obb.ang`, so local +Z is the
  OBB's short axis and which way it points is a coin flip; for this footprint
  it came up WEST, into Bryant Park, and `canyon5th` is looking at the plain
  `box(W, H*0.72, D*0.9, MARBLE)` back. Everything below the orientation fix is
  new: this front is now built as an elevation rather than as a stack of boxes.

  The elevation, north to south across a 112 m front: an end pavilion, a
  five-bay wing of tall round-arched windows between coupled pilasters, the
  three-arch centre pavilion with its six coupled Corinthian columns, the
  matching south wing, the south end pavilion. In front of all of it a raised
  terrace with a balustrade, the broad flight up from the Fifth Avenue
  sidewalk, and Patience and Fortitude on their pedestals at the foot.
  ========================================================================== */
  nypl(ctx) {
    const [g, r] = shell(ctx);
    // ---- FACE FIFTH AVENUE. The Manhattan grid normal on the east side of
    // Fifth is ESE, ~29 deg off true east: (0.88, 0.47) in world x/z. orient()
    // only ever picks a candidate 90 deg apart, so anything within 45 deg of
    // the real front direction lands the right quadrant. allow90 must be OFF
    // when the OBB long axis already runs along the avenue, or the 112 m front
    // gets laid across the 82 m depth; when it is ON, the builder's W and D
    // swap with it.
    const NX = 0.88, NZ = 0.47;
    const base = -ctx.obb.ang;
    const perpFacesAve = Math.abs(Math.sin(base) * NX + Math.cos(base) * NZ) >= 0.5;
    orient(r, ctx, NX, NZ, !perpFacesAve);
    let { W, D, H } = dims(ctx);
    if (!perpFacesAve) { const t = W; W = D; D = t; }
    H = Math.min(Math.max(H, 24), 34);              // cornice at ~30 m in life

    const MB = 0xd7d1c2, MB_D = 0xc3bcaa, MB_L = 0xe2ddd0;  // Vermont marble, shadow, dressed trim
    const RUST = 0xc8c1af;                                   // rusticated base course
    const stone = bin(), trim = bin(), glass = bin(), dark = bin();

    const hz = D * 0.5;                             // front face plane (local +Z)
    const FR = hz - 1.0;                            // main wall plane
    const podium = 3.4;                             // terrace level above the sidewalk
    const baseH = podium + 5.6;                     // top of the rusticated storey
    const cornY = H - 3.0;                          // underside of the main cornice
    const cpW = Math.min(W * 0.40, 44);             // centre pavilion width
    const cpZ = FR + 2.6;                           // and its projection

    // ---- the mass -----------------------------------------------------------
    stone.add(box(W, cornY, D * 0.94, 0, { z: -D * 0.03 }));
    // side and rear elevations get a plain ashlar attic so the block is not
    // topped by a raw edge from the park side either
    stone.add(box(W * 1.012, 1.5, D * 0.955, 0, { y: cornY, z: -D * 0.03 }));   // cornice bed
    trim.add(box(W * 1.03, 1.05, D * 0.975, 0, { y: cornY + 1.5, z: -D * 0.03 })); // corona
    stone.add(box(W * 0.99, 1.9, D * 0.94, 0, { y: cornY + 2.55, z: -D * 0.03 })); // attic

    // ---- rusticated base: proud horizontal courses on the avenue front ------
    for (let i = 0; i < 6; i++) {
      const y = podium + i * 0.94;
      stone.add(box(W * 0.998, 0.84, 1.0 + (i % 2 ? 0.0 : 0.14), 0, { y, z: FR - 0.5 }));
    }
    stone.add(box(W, podium, D * 0.94, 0, { z: -D * 0.03 }));       // the plinth itself
    trim.add(box(W * 1.004, 0.36, 1.3, 0, { y: baseH - 0.36, z: FR - 0.34 })); // base cap band (its back 1 cm off the top course's: RG44, the Unreal duplicate gate)

    // ---- the terrace, its balustrade and the Fifth Avenue steps -------------
    const terD = 13.0;
    stone.add(box(W * 0.86, podium, terD, 0, { z: hz + terD * 0.5 - 0.5 }));
    // balustrade: a plinth, a run of balusters, a rail — on the two flanks of
    // the stair, which is where the real one is
    for (const s of [-1, 1]) {
      const bx0 = s * (W * 0.145 + 0.9), bx1 = s * W * 0.43;
      const bl = Math.abs(bx1 - bx0);
      const bcx = (bx0 + bx1) / 2, bz = hz + terD - 0.9;
      trim.add(box(bl, 0.34, 1.0, 0, { x: bcx, y: podium, z: bz }));
      const nb = Math.max(3, Math.round(bl / 0.62));
      for (let i = 0; i < nb; i++)
        trim.add(cyl(0.115, 0.155, 0.74, 0, { x: bx0 + (bx1 - bx0) * (i + 0.5) / nb, y: podium + 0.34, z: bz, seg: 6 }));
      trim.add(box(bl, 0.24, 1.14, 0, { x: bcx, y: podium + 1.08, z: bz }));
      // and the same run returning along the terrace edge
      trim.add(box(1.0, 0.34, terD - 1.8, 0, { x: s * W * 0.43, y: podium, z: hz + terD * 0.5 - 0.9 }));
      trim.add(box(1.14, 0.24, terD - 1.8, 0, { x: s * W * 0.43, y: podium + 1.08, z: hz + terD * 0.5 - 0.9 }));
    }
    // the flight: 11 risers of 0.31 m, full width of the centre pavilion
    const stW = cpW * 0.82;
    for (let i = 0; i < 11; i++)
      stone.add(box(stW + i * 0.5, 0.31, 1.15, 0, { y: podium - (i + 1) * 0.31, z: hz + terD - 0.4 + i * 1.05 }));
    // cheek walls
    for (const s of [-1, 1])
      stone.add(box(1.2, podium, 12.0, 0, { x: s * (stW / 2 + 3.2), y: 0, z: hz + terD + 5.2 }));

    // ---- Patience and Fortitude ---------------------------------------------
    // Pedestals flanking the foot of the stair, and a reclining lion on each:
    // a body block, a raised chest, a maned head and four folded legs. At 20 m
    // this reads as a lion; at 60 m it reads as the two dark forms that say
    // "this is the library" and nothing else in New York does.
    for (const s of [-1, 1]) {
      const lx = s * (stW / 2 + 3.2), lz = hz + terD + 8.2;
      trim.add(box(3.5, 2.05, 2.3, 0, { x: lx, y: 0, z: lz }));            // pedestal die
      trim.add(box(3.9, 0.28, 2.7, 0, { x: lx, y: 2.05, z: lz }));          // cap
      const ly = 2.33;
      dark.add(box(2.85, 0.62, 1.15, 0, { x: lx, y: ly, z: lz }));          // body / haunches
      dark.add(box(1.55, 0.72, 1.05, 0, { x: lx + s * 0.55, y: ly + 0.62, z: lz })); // chest
      dark.add(sphere(0.52, 0, { x: lx + s * 1.02, y: ly + 1.52, z: lz }));  // mane
      dark.add(box(0.52, 0.34, 0.46, 0, { x: lx + s * 1.42, y: ly + 1.42, z: lz })); // muzzle
      for (const f of [-1, 1]) {                                            // forepaws stretched out
        dark.add(box(1.5, 0.30, 0.30, 0, { x: lx + s * 0.95, y: ly, z: lz + f * 0.36 }));
        dark.add(box(0.42, 0.26, 0.34, 0, { x: lx + s * 1.62, y: ly - 0.02, z: lz + f * 0.36 }));
      }
      dark.add(box(1.5, 0.26, 0.24, 0, { x: lx - s * 1.1, y: ly + 0.1, z: lz - 0.45, rotY: s * 0.4 })); // tail
    }

    // ---- CENTRE PAVILION: three great arches, six coupled columns ----------
    stone.add(box(cpW, cornY + 1.2, 3.6, 0, { z: cpZ + 0.2 }));
    // rusticated podium under the columns
    stone.add(box(cpW, baseH - podium, 4.0, 0, { y: podium, z: cpZ + 0.4 }));
    const arcW = cpW * 0.205, arcGap = cpW * 0.305;
    for (let k = -1; k <= 1; k++) {
      const ax = k * arcGap;
      archOpening(trim, dark, cpZ + 2.05, ax, baseH - 4.4, arcW, 5.4, { dep: 0.9, vous: 13 });
      // bronze double doors in the two flanking arches, glazed screen in the centre
      dark.add(box(arcW * 0.62, 4.2, 0.2, 0, { x: ax, y: podium + 0.1, z: cpZ + 1.95 }));
      glass.add(box(arcW * 0.80, 2.6, 0.16, 0, { x: ax, y: podium + 4.4, z: cpZ + 1.92 }));
    }
    // coupled Corinthian columns on pedestals between and outside the arches
    const colH = cornY - baseH - 1.6, colR = Math.max(0.62, colH * 0.052);
    const pairs = [-1.5, -0.5, 0.5, 1.5].map((t) => t * arcGap);
    for (const px of pairs) for (const d of [-1, 1]) {
      const cx2 = px + d * colR * 1.55;
      if (Math.abs(cx2) > cpW * 0.5 - colR * 1.6) continue;
      trim.add(box(colR * 3.0, 1.55, colR * 3.0, 0, { x: cx2, y: baseH, z: cpZ + 2.7 })); // pedestal
      corinthianColumn(stone, cx2, baseH + 1.55, cpZ + 2.7, colH, colR);
    }
    // entablature over the order: architrave, frieze, dentil cornice
    trim.add(box(cpW + 0.6, 0.85, 4.6, 0, { y: cornY - 3.2, z: cpZ + 1.4 }));
    stone.add(box(cpW + 0.4, 1.35, 4.2, 0, { y: cornY - 2.35, z: cpZ + 1.3 }));  // frieze
    trim.add(box(cpW + 1.5, 1.0, 5.3, 0, { y: cornY - 1.0, z: cpZ + 1.7 }));     // corona
    // attic over the centre, with the building's own inscription cut into it
    stone.add(box(cpW * 0.92, 4.2, 3.4, 0, { y: cornY, z: cpZ + 0.1 }));
    for (const s of [-1, 1])                                                     // attic pedestals
      trim.add(box(4.2, 5.0, 4.0, 0, { x: s * cpW * 0.5, y: cornY, z: cpZ + 0.4 }));

    // ---- WINGS: coupled pilasters and tall round-arched windows ------------
    const wingIn = cpW * 0.5 + 1.0, wingOut = W * 0.5 - 5.0;
    const bays = Math.max(3, Math.round((wingOut - wingIn) / 8.2));
    for (const s of [-1, 1]) for (let i = 0; i < bays; i++) {
      const t = (i + 0.5) / bays;
      const bx = s * (wingIn + (wingOut - wingIn) * t);
      // the arched window of the main storey
      archOpening(trim, glass, FR + 0.15, bx, baseH + 1.2, 3.5, 2.9, { dep: 0.5, vous: 9, seg: 12 });
      // a square-headed attic light above it
      glass.add(box(2.5, 1.7, 0.2, 0, { x: bx, y: cornY - 3.9, z: FR - 0.15 }));
      trim.add(box(3.3, 0.30, 0.55, 0, { x: bx, y: cornY - 4.2, z: FR + 0.2 }));
      trim.add(box(3.3, 0.34, 0.55, 0, { x: bx, y: cornY - 2.2, z: FR + 0.2 }));
      // basement light in the rusticated storey
      dark.add(box(2.0, 1.5, 0.2, 0, { x: bx, y: podium + 1.5, z: FR - 0.65 }));
      // coupled pilasters between the bays
      if (i > 0) {
        const pxm = s * (wingIn + (wingOut - wingIn) * (i / bays));
        for (const d of [-1, 1])
          corinthianColumn(stone, pxm + d * 0.9, baseH + 0.6, FR + 0.05, cornY - baseH - 2.2, 0.62, true);
      }
    }
    // end pavilions: plain marble faces with a single arch and a proud quoin
    for (const s of [-1, 1]) {
      const ex = s * (W * 0.5 - 2.6);
      stone.add(box(5.2, cornY + 1.0, D * 0.30, 0, { x: ex, z: FR - D * 0.15 + 0.4 }));
      archOpening(trim, glass, FR + 0.35, ex, baseH + 2.2, 2.6, 2.1, { dep: 0.5, vous: 9, seg: 12 });
      trim.add(box(5.9, 1.15, D * 0.31, 0, { x: ex, y: cornY + 1.0, z: FR - D * 0.15 + 0.4 }));
    }
    // LW31 (Bryant Park, owner 2026-09-28: "look online for reference shots ... and create it in a detailed way"): the
    // park elevation to the references (docs/notes/bryant-park.md: ref1 and ref3 from the lawn, the LPC's 2017 report on
    // the reading room, whose 17 x 14 ft bronze windows give the scale). The stack wing between two end pavilions: under
    // the cornice nine round-arched windows 4.3 m wide in 8.25 m bays (the Main Reading Room's west side), their sills
    // 7.5 m below the cornice; between them at sill level eight small pedimented doorways (built for a stack extension
    // that was never made); a carved frieze of festoons; below it the stack lights, three to a bay, 1 m wide and 13 m
    // tall across seven stack levels, between 1.75 m marble piers ("the striping effect of the dark windows alternating
    // with the white Vermont marble"); the end pavilions rusticated; a hip roof over the centre. NY28's five tiers of
    // lights in 3 m bays read as an office block from the lawn. Heights are ref3's, scaled to this block's cornice.
    // `?lw31=0` (or `?bp31=0`, the whole park) restores NY28's.
    const LW31 = NY28 && !(typeof location !== 'undefined' && ['lw31', 'bp31'].some((k) => new URLSearchParams(location.search).get(k) === '0'));
    const roofB = LW31 ? bin() : null;
    if (LW31) {
      const zf = -D * 0.5;                                               // the park face; the park lies toward -Z
      const s = (cornY - 1.4) / 25.5, yAt = (d) => cornY - d * s;         // d: metres under the cornice in ref3
      const bay = 8.25, nBay = 9, cHalf = (bay * nBay) / 2, pW = Math.max(3, W / 2 - cHalf);
      // the end pavilions: 0.6 m proud of the stack wing, rusticated in 0.9 m courses up to the frieze, two small lights
      for (const sg of [-1, 1]) {
        const px = sg * (cHalf + pW / 2);
        stone.add(box(pW, cornY, 0.6, 0, { x: px, z: zf - 0.3 }));
        for (let y = 1.5; y < cornY - 1.8; y += 0.9) stone.add(box(pW + 0.12, 0.64, 0.14, 0, { x: px, y, z: zf - 0.67 }));
        for (const d of [12.5, 5.0]) {
          glass.add(box(1.5, 2.6 * s, 0.1, 0, { x: px, y: yAt(d) - 1.3 * s, z: zf - 0.77 }));
          trim.add(box(2.1, 0.3, 0.34, 0, { x: px, y: yAt(d) - 1.3 * s - 0.3, z: zf - 0.9 }));
          trim.add(box(2.3, 0.4, 0.4, 0, { x: px, y: yAt(d) + 1.3 * s, z: zf - 0.92 }));
        }
      }
      // the stack lights: three to a bay (either side of the window's axis and on the line between two bays), glazed
      // 0.05 m off the wall, seven stack levels as bronze transoms and a mullion; the piers between them 0.4 m proud,
      // so each light reads as a 0.4 m reveal; a plain base course under them to the terrace
      const yS0 = yAt(25.0), yS1 = yAt(11.8), lights = [];
      for (let i = 0; i < nBay; i++) { const xc = -cHalf + bay * (i + 0.5); lights.push(xc - 1.375, xc + 1.375); if (i > 0) lights.push(xc - bay / 2); }
      lights.sort((a, b) => a - b);
      let xp = -cHalf;
      for (const xl of [...lights, cHalf + 0.5]) {
        const a = xp, b = xl - 0.5;
        if (b - a > 0.05) stone.add(box(b - a, yS1 - yS0 + 0.1, 0.4, 0, { x: (a + b) / 2, y: yS0 - 0.05, z: zf - 0.2 }));
        xp = xl + 0.5;
      }
      stone.add(box(cHalf * 2, yS0, 0.46, 0, { y: 0, z: zf - 0.23 }));
      trim.add(box(cHalf * 2 + 0.2, 0.24, 0.56, 0, { y: yS0 - 0.24, z: zf - 0.28 }));
      for (const xl of lights) {
        glass.add(box(1.0, yS1 - yS0, 0.08, 0, { x: xl, y: yS0, z: zf - 0.05 }));
        for (let k = 1; k < 7; k++) dark.add(box(1.0, 0.14, 0.1, 0, { x: xl, y: yS0 + ((yS1 - yS0) * k) / 7 - 0.07, z: zf - 0.1 }));
        dark.add(box(0.08, yS1 - yS0, 0.1, 0, { x: xl, y: yS0, z: zf - 0.1 }));
      }
      // the carved frieze over the stacks: a proud band between mouldings, a rosette over each light and a festoon
      // swung between each pair
      const yF0 = yAt(11.8), yF1 = yAt(10.2), yFm = (yF0 + yF1) / 2;
      trim.add(box(cHalf * 2 + 0.4, yF1 - yF0, 0.62, 0, { y: yF0, z: zf - 0.31 }));
      trim.add(box(cHalf * 2 + 0.7, 0.22, 0.76, 0, { y: yF1 - 0.11, z: zf - 0.38 }));
      trim.add(box(cHalf * 2 + 0.6, 0.18, 0.72, 0, { y: yF0 - 0.05, z: zf - 0.36 }));
      for (let i = 0; i < lights.length; i++) {
        stone.add(disc(0.26, 0.14, 0, { x: lights[i], y: yFm + 0.12, z: zf - 0.68, seg: 10 }));
        if (i + 1 < lights.length) {
          const sw = new THREE.Mesh(new THREE.TorusGeometry((lights[i + 1] - lights[i]) / 2 - 0.3, 0.1, 4, 10, Math.PI).rotateZ(Math.PI), mat(0, {}));
          sw.scale.set(1, 0.42, 1); sw.position.set((lights[i] + lights[i + 1]) / 2, yFm + 0.2, zf - 0.66);
          stone.add(sw);
        }
      }
      // the reading room's windows: glazing a hair off the wall, the bronze frame (two mullions into the arch, three
      // transoms), jambs and imposts, a ring of thirteen voussoirs with its keystone, the sill; an apron panel under each
      const ySill = yAt(7.5), ySpr = yAt(4.3), ww = 4.3, r0 = ww / 2, hRise = ySpr - ySill;
      for (let i = 0; i < nBay; i++) {
        const xc = -cHalf + bay * (i + 0.5);
        glass.add(box(ww, hRise, 0.08, 0, { x: xc, y: ySill, z: zf - 0.04 }));
        const dk = new THREE.Mesh(new THREE.CircleGeometry(r0, 16, 0, Math.PI), mat(0, {}));
        dk.rotation.y = Math.PI; dk.position.set(xc, ySpr, zf - 0.05);
        glass.add(dk);
        for (const mx of [-0.72, 0.72]) dark.add(box(0.1, hRise + Math.sqrt(r0 * r0 - mx * mx) - 0.06, 0.1, 0, { x: xc + mx, y: ySill, z: zf - 0.1 }));
        for (let k = 1; k <= 3; k++) dark.add(box(ww, 0.1, 0.1, 0, { x: xc, y: ySill + (hRise * k) / 3.2, z: zf - 0.1 }));
        for (const sd of [-1, 1]) {
          trim.add(box(0.5, hRise, 0.5, 0, { x: xc + sd * (r0 + 0.25), y: ySill, z: zf - 0.25 }));
          trim.add(box(0.8, 0.36, 0.62, 0, { x: xc + sd * (r0 + 0.3), y: ySpr - 0.36, z: zf - 0.31 }));
        }
        for (let k = 0; k < 13; k++) {
          const a = (Math.PI * (k + 0.5)) / 13, rr = r0 + 0.02;
          trim.add(box(0.56, 0.62, 0.5, 0, { x: xc + Math.cos(a) * rr, y: ySpr + Math.sin(a) * rr, z: zf - 0.25, rotZ: a - Math.PI / 2 }));
        }
        trim.add(box(0.8, 0.95, 0.66, 0, { x: xc, y: ySpr + r0 - 0.12, z: zf - 0.33 }));
        trim.add(box(ww + 1.3, 0.3, 0.72, 0, { x: xc, y: ySill - 0.3, z: zf - 0.36 }));
        trim.add(box(ww + 0.5, 1.5 * s, 0.16, 0, { x: xc, y: ySill - 0.3 - 1.5 * s - 0.25, z: zf - 0.08 }));
        // the pedimented doorway on the pier before this bay: a bronze door, jambs, lintel, pediment, sill
        if (i > 0) {
          const xd = xc - bay / 2, yd0 = yAt(9.8), yd1 = yAt(7.4);
          dark.add(box(1.1, yd1 - yd0, 0.08, 0, { x: xd, y: yd0, z: zf - 0.04 }));
          for (const sd of [-1, 1]) trim.add(box(0.24, yd1 - yd0, 0.3, 0, { x: xd + sd * 0.67, y: yd0, z: zf - 0.15 }));
          trim.add(box(1.8, 0.24, 0.36, 0, { x: xd, y: yd1, z: zf - 0.18 }));
          trim.add(prism([[-1.0, 0], [1.0, 0], [0, 0.5]], 0.4, 0, { x: xd, y: yd1 + 0.24, z: zf - 0.2 }));
          trim.add(box(1.7, 0.18, 0.4, 0, { x: xd, y: yd0 - 0.18, z: zf - 0.2 }));
        }
      }
      // a string course under the cornice's frieze; the hip roof over the reading room (24 m deep, 90 m long; ref1, ref2)
      trim.add(box(cHalf * 2, 0.34, 0.34, 0, { y: yAt(1.4) - 0.34, z: zf - 0.17 }));
      roofB.add(prism([[-12.5, 0], [12.5, 0], [3.5, 3.6], [-3.5, 3.6]], 90, 0, { y: cornY + 4.45, z: zf + 13.5, rotY: Math.PI / 2 }));
    } else if (NY28) {
      // NY28: the stack wall on the park side (local -Z faces Bryant Park). That elevation is the library's book stacks, a
      // long run of tall narrow lights in tiers between marble piers above the terrace; the block was a blank marble wall
      // at the end of every view down the park
      const rz = -D * 0.5, bw = 3.0, nb = Math.floor((W * 0.72) / bw);
      const x0r = -((nb - 1) * bw) / 2, y0r = podium + 3.2, tiers = 5, th = (cornY - 2.8 - y0r) / tiers;
      for (let i = 0; i < nb; i++) {
        const bx = x0r + i * bw;
        for (let t = 0; t < tiers; t++) {
          const ty = y0r + t * th;
          glass.add(box(1.25, th - 0.9, 0.16, 0, { x: bx, y: ty + 0.45, z: rz - 0.05 }));
          trim.add(box(1.55, 0.22, 0.34, 0, { x: bx, y: ty + 0.25, z: rz - 0.12 }));   // sill
        }
      }
      // the terrace cornice band over the stack lights' base
      trim.add(box(W * 0.74, 0.5, 0.5, 0, { y: y0r - 0.7, z: rz - 0.2 }));
    }
    // roof balustrade along the avenue front
    {
      const rz = FR - 0.2, ry = cornY + 2.55;
      trim.add(box(W * 0.99, 0.30, 1.0, 0, { y: ry + 1.9, z: rz }));
      const nb = Math.round(W / 1.35);
      for (let i = 0; i < nb; i++)
        trim.add(cyl(0.13, 0.17, 0.66, 0, { x: -W * 0.49 + W * 0.98 * (i + 0.5) / nb, y: ry + 2.2, z: rz, seg: 5 }));
      trim.add(box(W * 0.99, 0.22, 1.14, 0, { y: ry + 2.86, z: rz }));
    }

    stone.into(r, MB, NY28 ? { rough: 0.86, flat: false, stone: { set: 'climestone', amt: 0.72, nrm: 0.75, rgh: 0.35, ashlar: 0.9 } } : { rough: 0.86, flat: false });
    trim.into(r, MB_L, NY28 ? { rough: 0.82, stone: { set: 'cgranite', amt: 0.35, nrm: 0.45, rgh: 0.25, scale: 0.6 } } : { rough: 0.82 });
    glass.into(r, 0x2b3138, { rough: 0.18, metal: 0.1 });
    dark.into(r, 0x3a3126, { rough: 0.5, metal: 0.25 });  // bronze doors, the lions
    if (roofB) roofB.into(r, 0x857a6c, { rough: 0.72, metal: 0.1 });   // LW31: the hip roof, a weathered warm grey (ref2)
    // the frieze legend, incised in the centre attic
    r.add(inscription(cpW * 0.86, 1.35, ['THE NEW YORK PUBLIC LIBRARY'],
      { y: cornY + 1.35, z: cpZ + 1.82, ink: 0x4a4438 }));
    return fin(g, ctx, [
      { w: W, h: cornY, d: D * 0.94, z: -D * 0.03, y: cornY / 2 },
      { w: W * 0.86, h: podium, d: terD, z: hz + terD * 0.5 - 0.5, y: podium / 2 },
    ]);
  },

  // White marble gothic: twin ~100m spires, rose window, pitched nave, pinnacles.
  stPatricks(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const M = 0xdcd8cc, nd = D * 0.6;
    r.add(box(W * 0.92, H * 0.32, nd, M));
    r.add(gable({ w: W * 0.92, d: nd, h: H * 0.12, hex: M, y: H * 0.32 }));
    r.add(box(W * 0.16, H * 0.36, D * 0.9, M, { x: W * 0.08 }));
    const tw = Math.min(nd * 0.34, 10), txx = -W / 2 + tw * 0.55;
    for (const s of [-1, 1]) {
      const z = s * (nd / 2 - tw * 0.4);
      r.add(box(tw, H * 0.5, tw, M, { x: txx, z }));
      r.add(spire(tw * 0.62, H * 0.5, M, { x: txx, z, y: H * 0.5 }));
    }
    r.add(box(2, H * 0.42, nd * 0.5, M, { x: -W / 2 + 1 }));
    r.add(disc(H * 0.06, 1, DKGLASS, { x: -W / 2 + 0.6, y: H * 0.3, rotY: Math.PI / 2 }));
    for (let i = 0; i < 4; i++)
      for (const s of [-1, 1])
        r.add(spire(0.9, H * 0.08, M, { x: -W * 0.2 + i * W * 0.16, z: s * nd / 2, y: H * 0.4 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.45, d: D * 0.9, y: H * 0.225 },
      { x: txx, w: tw, h: H * 0.85, d: nd, y: H * 0.425 }
    ]);
  },

  // Brownstone gothic: single square tower + tall spire fronting a low nave.
  trinityChurch(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const tw = Math.min(D * 0.7, 11), tx = -W / 2 + tw * 0.6;
    r.add(box(tw, H * 0.45, tw, BROWNST, { x: tx }));
    r.add(spire(tw * 0.58, H * 0.55, BROWNST, { x: tx, y: H * 0.45 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      r.add(spire(0.7, H * 0.08, BROWNST, { x: tx + sx * tw * 0.42, z: sz * tw * 0.42, y: H * 0.44 }));
    const nw = Math.max(W - tw * 1.3, W * 0.4), nx2 = tx + tw * 0.45 + nw / 2;
    r.add(box(nw, H * 0.22, D * 0.62, BROWNST, { x: nx2 }));
    r.add(gable({ w: nw, d: D * 0.62, h: H * 0.1, hex: 0x54402f, x: nx2, y: H * 0.22 }));
    return fin(g, ctx, [
      { x: tx, w: tw, h: H * 0.75, d: tw, y: H * 0.375 },
      { x: nx2, w: nw, h: H * 0.32, d: D * 0.62, y: H * 0.16 }
    ]);
  },

  // Greek revival: 8 Doric columns, pediment, high steps, low dome behind.
  federalHall(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(steps({ w: W * 0.6, d: 8, n: 6, rise: 0.42, inset: 0.7, hex: MARBLE, z: D * 0.42 }));
    r.add(box(W * 0.9, H * 0.62, D * 0.75, MARBLE));
    const p = colonnade({ count: 8, width: W * 0.58, colH: H * 0.44, colR: 0.8, hex: MARBLE, z: D * 0.44, y: 2.5 });
    r.add(p);
    r.add(gable({ w: W * 0.72, d: 6, h: H * 0.16, hex: MARBLE, z: D * 0.44, y: 2.5 + p.userData.topY }));
    r.add(dome(Math.min(W, D) * 0.18, MARBLE, { y: H * 0.62, squash: 0.85, seg: 12 }));
    return fin(g, ctx, [{ w: W * 0.9, h: H * 0.7, d: D * 0.8, y: H * 0.35 }]);
  },

  // Temple front: 6 giant Corinthian columns + big pediment on a marble block.
  nyse(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.9, D, MARBLE));
    r.add(box(W * 1.02, H * 0.06, D * 1.02, MARBLE, { y: H * 0.9 }));
    r.add(box(W * 0.6, H * 0.12, 6, MARBLE, { z: D * 0.5 + 1 }));
    const p = colonnade({ count: 6, width: W * 0.44, colH: H * 0.52, colR: 1.1, hex: MARBLE, z: D * 0.5 + 2.4, y: H * 0.12 });
    r.add(p);
    r.add(gable({ w: W * 0.58, d: 5.4, h: H * 0.14, hex: MARBLE, z: D * 0.5 + 2.4, y: H * 0.12 + p.userData.topY }));
    return fin(g, ctx, [{ w: W, h: H, d: D + 4, y: H / 2 }]);
  },

  // U-shaped limestone colossus, colonnade base, circular wedding-cake top + gold statue.
  municipalBldg(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const LM = 0xcac2b0;
    r.add(box(W, H * 0.5, D * 0.55, LM, { z: -D * 0.2 }));
    for (const s of [-1, 1]) r.add(box(W * 0.2, H * 0.5, D, LM, { x: s * W * 0.4 }));
    r.add(colonnade({ count: 12, width: W * 0.55, colH: H * 0.1, colR: 1.1, hex: LM, z: D * 0.09, entab: H * 0.015 }));
    r.add(box(W * 0.26, H * 0.14, D * 0.4, LM, { z: -D * 0.15, y: H * 0.5 }));
    r.add(cyl(W * 0.08, W * 0.08, H * 0.12, LM, { z: -D * 0.15, y: H * 0.64, seg: 12 }));
    r.add(colRing({ r: W * 0.1, count: 12, colH: H * 0.1, colR: 0.8, hex: LM, y: H * 0.64, z: -D * 0.15 }));
    r.add(colRing({ r: W * 0.055, count: 8, colH: H * 0.08, colR: 0.5, hex: LM, y: H * 0.78, z: -D * 0.15 }));
    r.add(cyl(W * 0.03, W * 0.05, H * 0.06, LM, { z: -D * 0.15, y: H * 0.86, seg: 10 }));
    r.add(spire(W * 0.02, H * 0.05, GOLD, { z: -D * 0.15, y: H * 0.9, m: MET }));
    r.add(sphere(2.2, GOLD, { z: -D * 0.15, y: H * 0.96, m: { metal: 0.8, rough: 0.25, emissive: 0x664e10, emissiveIntensity: 0.4 } }));
    return fin(g, ctx, [
      { w: W, h: H * 0.5, d: D, y: H * 0.25 },
      { z: -D * 0.15, w: W * 0.26, h: H, d: D * 0.4, y: H * 0.5 }
    ]);
  },

  // 'Jenga': ~16 shifted glass slabs, deterministic cantilevers growing with height.
  p56leonard(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const gm = GLS;
    const n = 16, fh = H / n;
    const w0 = Math.min(W, 30), d0 = Math.min(D, 25);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const k1 = Math.sin(i * 12.9898) * 43758.5453, r1 = k1 - Math.floor(k1);
      const k2 = Math.sin(i * 78.233) * 12543.123, r2 = k2 - Math.floor(k2);
      const amp = 1 + t * 5;
      const dx = (r1 - 0.5) * amp, dz = (r2 - 0.5) * amp;
      const wv = w0 * (0.85 + 0.15 * r2), dv = d0 * (0.85 + 0.15 * r1);
      r.add(box(wv, fh * 0.9, dv, GLASS2, { x: dx, z: dz, y: i * fh, m: gm }));
      r.add(box(wv * 1.04, fh * 0.1, dv * 1.04, WHITE, { x: dx, z: dz, y: (i + 0.9) * fh }));
    }
    return fin(g, ctx, [{ w: w0 * 1.1, h: H, d: d0 * 1.1, y: H / 2 }]);
  },

  // Gehry ripple: stainless tower, wavy vertical fin strips, tan school podium.
  p8spruce(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const S = Math.min(W, D);
    r.add(box(W * 0.98, H * 0.075, D * 0.98, 0xc9a37a));
    r.add(box(S * 0.85, H * 0.925, S * 0.85, STEEL, { y: H * 0.075, m: { metal: 0.55, rough: 0.35 } }));
    const segs = 5;
    for (let f = 0; f < 4; f++) {
      const fx = -S * 0.3 + f * S * 0.2;
      for (let j = 0; j < segs; j++)
        for (const s of [-1, 1])
          r.add(box(S * 0.15, H * 0.925 / segs, 1.2, 0xd4d8dc,
            { x: fx, z: s * (S * 0.4 + ((j + f) % 2) * 1.0), y: H * (0.075 + 0.925 * j / segs), m: MET }));
    }
    return fin(g, ctx, [{ w: S * 0.9, h: H, d: S * 0.9, y: H / 2 }]);
  },

  // Low wide ribbed concrete drum on a plinth.
  msg(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const R = Math.min(W, D) * 0.48;
    r.add(box(W * 0.9, H * 0.12, D * 0.9, CONC));
    r.add(cyl(R, R, H * 0.78, 0xcac6bc, { y: H * 0.12, seg: 24, m: { flat: false } }));
    r.add(colRing({ r: R - 0.25, count: 24, colH: H * 0.78, colR: 0.55, hex: 0xb8b4aa, y: H * 0.12, entab: 0 }));
    r.add(cyl(R * 0.99, R * 0.99, H * 0.04, 0xb0aca2, { y: H * 0.9, seg: 24 }));
    r.add(dome(R * 0.98, 0xb0aca2, { y: H * 0.94, squash: (H * 0.06) / (R * 0.98), seg: 20 }));
    return fin(g, ctx, [
      { w: W * 0.9, h: H * 0.12, d: D * 0.9, y: H * 0.06 },
      { w: R * 2, h: H * 0.88, d: R * 2, y: H * 0.56 }
    ]);
  },

  // DECORATE: monumental staircase, facade slab, 4 paired-column bays, attic.
  metMuseum(ctx) {
    // LM16: the whole museum on its ring (city/lmMetMuseum.js); the decorate builder below stays for `?met16=0`
    if (MET16 && ctx.footprint && ctx.footprint.length >= 4) {
      // (a failure returns null: assemble.js then draws the plain extrusion the replace path left out)
      try { return buildMetMuseum(ctx); } catch (e) { console.warn('met museum build failed', e); return null; }
    }
    const [g, r0] = shell(ctx); const { W, D, H } = dims(ctx);
    let r = r0, F = Math.min(W * 0.6, 90), zf = D / 2;
    // CP33: on the compiled ring the front goes on Fifth Avenue's front line (the OBB of a 63-sided ring put it off the corner)
    const fr = CP33LM && ctx.footprint && ctx.footprint.length >= 4 ? metFront(ctx.footprint) : null;
    if (fr) { r = new THREE.Group(); r.position.set(fr.x, 0, fr.z); r.rotation.y = fr.rot; g.add(r); F = Math.min(fr.len * 0.5, 84); zf = 0; }
    r.add(steps({ w: F * 0.5, d: 9, n: 6, rise: 0.35, inset: 0.55, hex: LIME, z: zf + 5 }));
    r.add(box(F, H * 0.85, 7, LIME, { z: zf + 2 }));
    for (const s of [-1.5, -0.5, 0.5, 1.5])
      r.add(colonnade({ count: 2, spacing: 3.4, colH: H * 0.5, colR: 0.9, hex: LIME2, x: s * F * 0.22, z: zf + 6.2, y: H * 0.12, entab: H * 0.06 }));
    r.add(box(F * 0.86, H * 0.14, 8, LIME, { z: zf + 2.5, y: H * 0.85 }));
    if (CP33LM && ctx.footprint && ctx.footprint.length >= 4) {
      try { const mr = buildMetRoof(ctx); if (mr) g.add(mr); } catch (e) { console.warn('met roof failed', e); }
    }
    return g;
  },

  // Inverted white ziggurat spiral + skylight + small rotunda + back block.
  guggenheim(ctx) {
    // LM16: Wright's rotunda, the monitor and the 1992 tower on the compiled ring (city/lmGuggenheim.js)
    if (LM16 && ctx.footprint && ctx.footprint.length >= 4) {
      try { const gg = buildGuggenheim(ctx); if (gg) return gg; } catch (e) { console.warn('guggenheim build failed', e); }
    }
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const R = Math.min(W, D) * 0.3, rx = -W / 2 + R * 1.3;
    r.add(box(W * 0.9, H * 0.45, D * 0.8, WHITE, { x: W * 0.12 }));
    r.add(box(W * 0.9, H * 0.08, D * 0.82, WHITE, { x: W * 0.12, y: H * 0.62 }));
    r.add(cyl(R * 0.66, R * 0.66, H * 0.14, WHITE, { x: rx, seg: 18, m: { flat: false } }));
    for (let i = 0; i < 5; i++) {
      const rr = R * (0.62 + 0.095 * i);
      r.add(cyl(rr, rr, H * 0.13, WHITE, { x: rx, y: H * (0.14 + 0.13 * i), seg: 18, m: { flat: false } }));
    }
    r.add(cyl(R * 0.3, R * 0.3, H * 0.1, 0xcfccc4, { x: rx, y: H * 0.79, seg: 12 }));
    r.add(cyl(R * 0.55, R * 0.44, H * 0.5, WHITE, { x: rx + R * 1.35, z: -D * 0.14, seg: 14, m: { flat: false } }));
    return fin(g, ctx, [
      { x: W * 0.12, w: W * 0.9, h: H * 0.7, d: D * 0.8, y: H * 0.35 },
      { x: rx, w: R * 2.2, h: H * 0.9, d: R * 2.2, y: H * 0.45 }
    ]);
  },

  // LM16: the AMNH's north side (the Gilder Center, the 81st Street terrace, the north ranges) on its own footprint
  amnhNorth(ctx) {
    if (!LM16) return null;
    try { return buildAmnhNorth(ctx); } catch (e) { console.warn('amnhNorth build failed', e); return null; }
  },

  // DECORATE: romanesque central entrance tower + arch + corner towers.
  amnh(ctx) {
    // LM16: the whole museum south of the north side (city/lmAmnh.js), a 'replace' on its ring (shared/landmarkSpec.js LM16)
    if (LM16 && ctx.footprint && ctx.footprint.length >= 4) {
      try { const ga = buildAmnh(ctx); if (ga) return ga; } catch (e) { console.warn('amnh build failed', e); }
    }
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const PK = 0xb89890, zf = D / 2, cx = Math.min(W * 0.4, 40);
    r.add(box(16, H * 1.08, 8, PK, { z: zf + 1 }));
    r.add(box(10, H * 0.55, 3, PK, { z: zf + 5.5 }));
    r.add(disc(3.6, 2.2, DKGLASS, { z: zf + 6.4, y: H * 0.3 }));
    r.add(pyramid(17, 9, H * 0.18, COPPER, { z: zf + 1, y: H * 1.08 }));
    for (const s of [-1, 1]) {
      r.add(box(7, H * 1.0, 7, PK, { x: s * cx, z: zf - 2 }));
      r.add(spire(4.2, H * 0.16, COPPER, { x: s * cx, z: zf - 2, y: H }));
    }
    return g;
  },

  // DECORATE: steep copper roofscape — gables, corner pavilion pyramids, finials.
  dakota(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(gable({ w: W * 0.86, d: D * 0.26, h: 7, hex: COPPER, z: D * 0.33, y: H }));
    r.add(gable({ w: W * 0.86, d: D * 0.26, h: 7, hex: COPPER, z: -D * 0.33, y: H }));
    for (const sx of [-1, 1]) {
      r.add(gable({ w: D * 0.8, d: W * 0.22, h: 7, hex: COPPER, x: sx * W * 0.36, y: H, rotY: Math.PI / 2 }));
      for (const sz of [-1, 1]) {
        r.add(pyramid(10, 10, 9, COPPER, { x: sx * W * 0.4, z: sz * D * 0.36, y: H }));
        r.add(spire(0.5, 4, 0x3f4448, { x: sx * W * 0.4, z: sz * D * 0.36, y: H + 9 }));
      }
    }
    return g;
  },

  // CW38: Central Park West's twin- and three-tower houses (city/lmCPW.js); `?cw38=0` keeps them off (the read-time
  // overrides in shared/landmarkSpec.js follow the same flag), and a builder failure falls back to the plain extrusion
  majestic(ctx) { return CW38 ? buildMajestic(ctx) : null; },
  century(ctx) { return CW38 ? buildCentury(ctx) : null; },
  eldorado(ctx) { return CW38 ? buildEldorado(ctx) : null; },
  beresford(ctx) { return CW38 ? buildBeresford(ctx) : null; },

  // Twin towers on a shared base, each crowned by a round temple + cone.
  sanRemo(ctx) {
    // CP33: built on the compiled footprint ring (lmSanRemo.js); the boxes below stay for `?cp33lm=0` and for a ring-less ctx
    if (CP33LM && ctx.footprint && ctx.footprint.length >= 4) {
      try { return buildSanRemo(ctx); } catch (e) { console.warn('sanRemo ring build failed', e); }
    }
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const BG = 0xd2c8b0;
    r.add(box(W, H * 0.6, D, BG));
    r.add(box(W * 1.02, H * 0.025, D * 1.04, BG, { y: H * 0.6 }));
    const tw = Math.min(D * 0.55, 17);
    for (const s of [-1, 1]) {
      const x = s * W * 0.27;
      r.add(box(tw, H * 0.26, tw, BG, { x, y: H * 0.6 }));
      r.add(colRing({ r: tw * 0.26, count: 8, colH: H * 0.06, colR: 0.5, hex: BG, x, y: H * 0.86 }));
      r.add(cyl(tw * 0.2, tw * 0.2, H * 0.06, BG, { x, y: H * 0.86, seg: 10 }));
      r.add(spire(tw * 0.3, H * 0.075, COPPER, { x, y: H * 0.925, seg: 12 }));
      r.add(spire(0.35, H * 0.02, 0x333333, { x, y: H * 0.995 }));
    }
    return fin(g, ctx, [
      { w: W, h: H * 0.62, d: D, y: H * 0.31 },
      { x: -W * 0.27, w: tw, h: H, d: tw, y: H / 2 },
      { x: W * 0.27, w: tw, h: H, d: tw, y: H / 2 }
    ]);
  },

  // DECORATE: green mansard roof cap, dormer row, corner turrets.
  plaza(ctx) {
    if (CP33LM && ctx.footprint && ctx.footprint.length >= 4) {
      try { const pr = buildPlazaRoof(ctx); if (pr) return pr; } catch (e) { console.warn('plaza ring roof failed', e); }
    }
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const mh = Math.max(H * 0.1, 6);
    r.add(setbackTower({ hex: COPPER, y0: H, levels: [
      { w: W * 0.94, d: D * 0.94, h: mh * 0.55 },
      { w: W * 0.78, d: D * 0.78, h: mh * 0.45 }
    ] }));
    for (let i = -2; i <= 2; i++)
      for (const s of [-1, 1])
        r.add(box(1.6, 1.8, 1.2, TRIM, { x: i * W * 0.16, z: s * D * 0.46, y: H + 0.8 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      r.add(cyl(2.2, 2.2, mh * 0.7, TRIM, { x: sx * W * 0.44, z: sz * D * 0.44, y: H - 2, seg: 10 }));
      r.add(spire(2.5, mh * 0.6, COPPER, { x: sx * W * 0.44, z: sz * D * 0.44, y: H + mh * 0.7 - 2, seg: 10 }));
    }
    return g;
  },

  // DECORATE (CP33): Hampshire House's steep verdigris hip with its dormers and chimney stacks, on the compiled ring
  hampshireHouse(ctx) {
    if (!CP33LM || !ctx.footprint || ctx.footprint.length < 4) return null;
    return buildHampshireRoof(ctx);
  },

  // DECORATE (CP33): the red ESSEX HOUSE letters on their steel frame over the park front of 160 Central Park South
  essexHouse(ctx) {
    if (!CP33LM) return null;
    return buildEssexSign(ctx);
  },

  // DECORATE: twin copper-green round-cap towers.
  waldorf(ctx) {
    const [g, r] = shell(ctx); const { W, H } = dims(ctx);
    for (const s of [-1, 1]) {
      const x = s * W * 0.18;
      r.add(cyl(5.5, 6.5, 8, 0x8a8478, { x, y: H - 2, seg: 12 }));
      r.add(dome(5.6, COPPER, { x, y: H + 6, squash: 1.15, seg: 12 }));
      r.add(spire(0.4, 5, 0x333333, { x, y: H + 11.6 }));
    }
    return g;
  },

  // Slender limestone tower, setbacks, steep green copper pyramid + spire.
  p40wall(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, H * 0.12, D, LIME2));
    const tw = Math.min(W * 0.6, D * 0.8);
    r.add(setbackTower({ hex: LIME2, levels: [
      { w: tw, d: tw, h: H * 0.52 },
      { w: tw * 0.8, d: tw * 0.8, h: H * 0.18 },
      { w: tw * 0.62, d: tw * 0.62, h: H * 0.12 }
    ] }));
    r.add(pyramid(tw * 0.55, tw * 0.55, H * 0.12, COPPER, { y: H * 0.82 }));
    r.add(spire(0.9, H * 0.06, COPPER, { y: H * 0.94 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.12, d: D, y: H * 0.06 },
      { w: tw, h: H * 0.82, d: tw, y: H * 0.41 }
    ]);
  },

  // Slender deco tower, gothic setbacks, glowing glass lantern crown + spire.
  p70pine(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const AG = 0xc4c2bc;
    r.add(box(W, H * 0.08, D, AG));
    const tw = Math.min(W, D) * 0.72;
    r.add(setbackTower({ hex: AG, levels: [
      { w: tw * 1.2, d: tw * 1.2, h: H * 0.3 },
      { w: tw, d: tw, h: H * 0.22 },
      { w: tw * 0.78, d: tw * 0.78, h: H * 0.18 },
      { w: tw * 0.55, d: tw * 0.55, h: H * 0.16 }
    ] }));
    r.add(box(tw * 0.3, H * 0.06, tw * 0.3, 0xbcd8e8, { y: H * 0.86, m: { emissive: 0x9fc8dd, emissiveIntensity: 0.55 } }));
    r.add(spire(1.4, H * 0.08, STEEL, { y: H * 0.92, m: MET }));
    return fin(g, ctx, [
      { w: W, h: H * 0.3, d: D, y: H * 0.15 },
      { w: tw, h: H * 0.86, d: tw, y: H * 0.43 }
    ]);
  },

  // Plain black steel international slab on a plaza plinth, light piers.
  p28liberty(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W * 1.15, 1, D * 1.15, 0xb5b0a6));
    r.add(box(W * 0.95, H, D * 0.95, DKGLASS, { y: 1, m: { metal: 0.45, rough: 0.35 } }));
    for (let i = -2; i <= 2; i++)
      for (const s of [-1, 1])
        r.add(box(1.1, H * 0.99, 0.4, 0x565e66, { x: i * W * 0.19, z: s * D * 0.475, y: 1 }));
    return fin(g, ctx, [{ w: W * 0.95, h: H, d: D * 0.95, y: H / 2 }]);
  },

  // The perfect bronze box on 10m stilts, mullion strips, travertine plaza.
  seagram(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    r.add(box(W, 1.2, D, 0xb8b2a4));
    const tw = Math.min(W * 0.62, 48), td = Math.min(D * 0.7, 30);
    const bm = Object.assign({ metal: 0.5, rough: 0.45 }, BRZ), stH = 10;
    for (const i of [-1, 1])
      for (const j of [-1, 0, 1])
        r.add(box(1.6, stH, 1.6, BRONZE, { x: j * tw * 0.33, z: i * td * 0.47, y: 1.2, m: bm }));
    r.add(box(tw * 0.5, stH, td * 0.5, BRONZE, { y: 1.2, m: bm }));
    r.add(box(tw, H - stH - 1.2, td, BRONZE, { y: stH + 1.2, m: bm }));
    for (let i = -5; i <= 5; i++)
      for (const s of [-1, 1])
        r.add(box(0.35, H - stH - 3, 0.5, 0x2f261e, { x: i * tw * 0.085, z: s * td * 0.5, y: stH + 2, m: { metal: 0.6, rough: 0.4 } }));
    return fin(g, ctx, [{ w: tw, h: H, d: td, y: H / 2 }]);
  },

  // Green-glass slab floating on stilts above a 1-floor horizontal podium.
  leverHouse(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const gm = GLS;
    for (const px of [-W * 0.35, 0, W * 0.35])
      for (const pz of [-D * 0.3, D * 0.3])
        r.add(box(1.2, H * 0.08, 1.2, STEEL, { x: px, z: pz, m: MET }));
    r.add(box(W * 0.95, H * 0.06, D * 0.95, GREENGL, { y: H * 0.08, m: gm }));
    r.add(box(W * 0.96, 0.8, D * 0.96, WHITE, { y: H * 0.14 }));
    r.add(box(W * 0.52, H * 0.82, D * 0.35, 0x7ba088, { x: -W * 0.18, z: -D * 0.2, y: H * 0.15, m: gm }));
    r.add(box(W * 0.52, 1, D * 0.35, WHITE, { x: -W * 0.18, z: -D * 0.2, y: H * 0.97 }));
    return fin(g, ctx, [
      { w: W * 0.95, h: H * 0.16, d: D * 0.95, y: H * 0.08 },
      { x: -W * 0.18, z: -D * 0.2, w: W * 0.52, h: H, d: D * 0.35, y: H / 2 }
    ]);
  },

  // White travertine block, 5 huge glowing arched glass bays on the plaza end.
  metOpera(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const TR = 0xe6e0d2, fw = D * 0.85;
    const warm = { emissive: 0x2f2415, emissiveIntensity: 0.5 };
    // banded travertine (bays and floor lines), not a flat-colour box: the flat block drew as a white slab in Unreal
    r.add(bandBox(W * 0.95, H * 0.92, D * 0.9, TR, { band: { glass: 0x3e3830, sill: 0xd8d0bf, bay: 5.5, floor: 5.2 } }));
    r.add(box(W * 0.98, H * 0.06, D * 0.92, TR, { y: H * 0.92 }));
    for (let i = -2; i <= 2; i++) {
      const z = i * fw / 5.4;
      r.add(box(fw / 7, H * 0.6, 1.6, 0x5a4a3a, { x: W * 0.475 + 0.6, z, y: H * 0.1, m: warm }));
      r.add(disc(fw / 14, 1.6, 0x5a4a3a, { x: W * 0.475 + 0.6, z, y: H * 0.7, rotY: Math.PI / 2, m: warm }));
    }
    return fin(g, ctx, [{ w: W, h: H, d: D * 0.9, y: H / 2 }]);
  },

  /* Narrow wedge tower clad in screens, plus the ball-drop mast.
     Critic r5 #19 / section 3 #8: "every Times Square billboard is a blank grey
     rectangle". Half of that verdict is THIS builder, not billboards.js: it
     stacked `billboard()` panels, which are unlit MeshBasicMaterial FLAT
     COLOURS, in a seven-step rainbow. From 250 m up Seventh Avenue
     (`timessqNorth`) One Times Square read as a stack of pure cyan / magenta /
     lime blocks with no content of any kind — see
     before/timessqNorth_day.png. It now takes the district atlas from
     billboards.js: the same material, so these panels merge into the draw call
     the district already pays for and repaint on the same 4.2 s timer, and the
     same 16 procedural posters (fictional brands only). All four faces are clad,
     which is what the real building is. */
  oneTimesSquare(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const bw = Math.min(W, 20), bd = Math.min(D, 17);
    r.add(box(bw, H * 0.84, bd, 0x2d3138));
    const bmat = boardMaterial();
    // one screen: a plane with its uv remapped into the atlas slot. Baked into
    // its final transform and collected, so ~40 panels merge into ONE mesh and
    // ONE draw call instead of 40 (the old rainbow version paid a draw per
    // panel too, and this tower is in every Times Square frame).
    const panels = [];
    const screen = (w, h, slot, o) => {
      const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
      const [u0, v0, u1, v1] = boardUVRect(slot);
      const uv = geo.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
      if (o.rotY) geo.rotateY(o.rotY);
      geo.translate(o.x || 0, o.y || 0, o.z || 0);
      panels.push(geo);
    };
    let y = H * 0.06, k = 0;
    while (y < H * 0.78) {
      const bh = H * (0.07 + 0.03 * ((k * 7) % 3));
      // the two broad faces
      for (const s of [-1, 1])
        screen(bw * 0.94, bh, k * 3 + (s > 0 ? 0 : 1),
          { z: s * (bd / 2 + 0.3), y, rotY: s === 1 ? 0 : Math.PI });
      // and the two narrow ones, so the tower is clad rather than posted
      if (bd > 8) for (const s of [-1, 1])
        screen(bd * 0.9, bh, k * 5 + (s > 0 ? 2 : 3),
          { x: s * (bw / 2 + 0.3), y, rotY: s * Math.PI / 2 });
      // no reveal box per tier: the 0.014*H gap between tiers already shows the
      // dark core through, and ten extra boxes here would be ten draw calls
      y += bh + H * 0.014; k++;
    }
    if (panels.length) { const pm = new THREE.Mesh(mergeGeometries(panels), bmat); pm.renderOrder = 2; r.add(pm); }
    r.add(box(bw * 0.5, H * 0.05, bd * 0.5, 0x2d3138, { y: H * 0.84 }));
    r.add(cyl(0.35, 0.35, H * 0.13, STEEL, { y: H * 0.87, seg: 6, m: NIROSTA }));
    r.add(sphere(1.1, 0xffffff, { y: H * 0.995, m: { basic: true } }));
    return fin(g, ctx, [{ w: bw, h: H * 0.88, d: bd, y: H * 0.44 }]);
  },

  // Glass tower with crossing sloped facets at the top + offset spire.
  boaTower(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const PB = 0xa8c4d4, gm = GLS;
    r.add(box(W, H * 0.1, D, PB, { m: gm }));
    r.add(box(W * 0.8, H * 0.62, D * 0.8, PB, { y: H * 0.1, m: gm }));
    r.add(wedge({ w: W * 0.8, d: D * 0.8, h: H * 0.16, hex: PB, y: H * 0.72, m: gm }));
    r.add(wedge({ w: D * 0.62, d: W * 0.62, h: H * 0.14, hex: PB, y: H * 0.72, rotY: Math.PI / 2, m: gm }));
    r.add(box(W * 0.34, H * 0.1, D * 0.34, PB, { x: -W * 0.1, y: H * 0.72, m: gm }));
    r.add(spire(1.8, H * 0.18, STEEL, { x: -W * 0.16, z: -D * 0.16, y: H * 0.82, m: MET }));
    return fin(g, ctx, [
      { w: W, h: H * 0.72, d: D, y: H * 0.36 },
      { w: W * 0.4, h: H * 0.28, d: D * 0.4, y: H * 0.82 }
    ]);
  },

  // Angular glass supertall; cantilevered triangular observation deck at ~86%.
  p30hudson(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const HB = 0x7f98a8, gm = GLS;
    r.add(box(W, H * 0.18, D, HB, { m: gm }));
    r.add(box(W * 0.8, H * 0.55, D * 0.85, HB, { y: H * 0.18, m: gm }));
    r.add(box(W * 0.62, H * 0.2, D * 0.7, HB, { y: H * 0.73, m: gm }));
    r.add(wedge({ w: W * 0.62, d: D * 0.7, h: H * 0.07, hex: HB, y: H * 0.93, m: gm }));
    const dy = H * 0.855;
    r.add(box(W * 0.42, 4, D * 0.34, HB, { y: dy, z: D * 0.5, m: gm }));
    r.add(wedge({ w: W * 0.42, d: D * 0.2, h: 4, hex: HB, y: dy, z: D * 0.77, rotY: Math.PI, m: gm }));
    r.add(box(W * 0.4, 1.2, D * 0.3, 0xd8dee2, { y: dy + 4, z: D * 0.52 }));
    return fin(g, ctx, [
      { w: W, h: H * 0.73, d: D, y: H * 0.365 },
      { w: W * 0.62, h: H * 0.27, d: D * 0.7, y: H * 0.865 }
    ]);
  },

  // Blue glass tower, two-tone stripes, curved 'waterfall' quarter-round top.
  one57(ctx) {
    const [g, r] = shell(ctx); const { W, D, H } = dims(ctx);
    const gm = GLS;
    const dd = Math.min(D, 32);
    const cr = Math.min(dd * 0.5, H * 0.08);
    r.add(box(W, H - cr, dd, BLUGLASS, { m: gm }));
    r.add(box(W, cr, dd - cr, BLUGLASS, { z: -cr / 2, y: H - cr, m: gm }));
    const pts = [[0, 0]];
    for (let a = 0; a <= 8; a++) {
      const t = (a / 8) * (Math.PI / 2);
      pts.push([Math.cos(t) * cr, Math.sin(t) * cr]);
    }
    const cap = prism(pts, W, BLUGLASS, { y: H - cr, z: dd / 2 - cr, m: gm });
    cap.rotation.y = -Math.PI / 2;
    r.add(cap);
    for (const i of [-2, 0, 2])
      for (const s of [-1, 1])
        r.add(box(W * 0.14, H * 0.9, 0.5, LTBLU, { x: i * W * 0.18, z: s * dd / 2, y: H * 0.02, m: gm }));
    return fin(g, ctx, [{ w: W, h: H, d: dd, y: H / 2 }]);
  }
};

// ---- optional real massing from the NYC 3D Building Model (2014 CityGML LOD2)
// enabled with ?lm3d=1 — real roof forms (Low's actual dome), but LOD2 walls
// are blank planes, so evaluate against the procedural builders per landmark.
let MESHES = null;
export async function preloadMeshes() {
  if (MESHES !== null) return;
  try {
    const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
    if (!q || !q.has('lm3d')) { MESHES = {}; return; }
    MESHES = await (await fetch('data/landmark_meshes.json')).json();
    console.log('lm3d: real massing for', Object.keys(MESHES).join(', '));
  } catch { MESHES = {}; }
}
const LM3D_ROOF = { lowLibrary: 0x8a9488, stPaulsChapel: 0x4e7f63, butlerLibrary: 0x4a4640 };
function realMassing(key, ctx) {
  const rec = MESHES && MESHES[key];
  if (!rec || !rec.tris || !rec.tris.length || ctx.cx === undefined) return null;
  const t = rec.tris;
  let minY = 1e9;
  for (const p of t) minY = Math.min(minY, p[1]);
  const wall = [], roof = [];
  for (let i = 0; i < t.length; i += 3) {
    const A = t[i], B = t[i + 1], C = t[i + 2];
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2];
    const vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    (Math.abs(ny / len) > 0.3 ? roof : wall).push(A, B, C);
  }
  const g = new THREE.Group();
  const mk = (tris, hex) => {
    if (!tris.length) return;
    const pos = new Float32Array(tris.length * 3);
    tris.forEach((p, i) => { pos[i * 3] = p[0] - ctx.cx; pos[i * 3 + 1] = p[1] - minY; pos[i * 3 + 2] = p[2] - ctx.cz; });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, applyLightTrim(new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, side: THREE.DoubleSide })));
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  };
  mk(wall, LIME);
  mk(roof, LM3D_ROOF[key] ?? SLATE);
  return g;
}

export function buildLandmark(key, ctx) {
  const real = realMassing(key, ctx);
  if (real) return real;
  // TW (towers lane): the tower kit's landmarks first (city/tk/tkLandmarks.js); `?twlm=0` keeps the builders below
  if (TWLM && TW_BUILDERS[key]) {
    try { const g = TW_BUILDERS[key](ctx); if (g) return g; } catch (e) { console.warn('[tw] landmark', key, e); }
  }
  const b = BUILDERS[key];
  if (!b) return null;
  try { return b(ctx); } catch (e) { console.warn('landmark build failed', key, e); return null; }
}
