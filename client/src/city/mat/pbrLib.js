// AR33 MATS: the shared PBR material library (docs/notes/ar33-materials.md is the contract).
//   pbrMaterial(name, opts) -> a cached THREE.MeshStandardMaterial with photogrammetry texture sets (CC0: ambientCG,
//   Poly Haven; public/textures/pbr/<set>/{albedo,normal,orm}.ktx2), UVs in metres, world-space weathering, the city's
//   light calibration (applyLightTrim) and baked sky occlusion (applyCityAO).
// The textures stream in: a material handed out before its set lands draws the set's mean colour, then the maps.
import * as THREE from 'three';
import { ktx2Loader } from './ktx2.js';
import { ENV, applyLightTrim, applyCityAO, applySkyMetal, SKYREFL_CHUNK } from '../../world/materials.js';
import { PBR_TEX } from './pbrSets.js';

// ---------------------------------------------------------------- calibration
const STREET_CAL = [1.94, 1.70, 1.47];   // the street furniture / ground trim (city/cpFlora.js, city/instancer.js)
// AR34 the city in the reflection (see CITY_GLSL); ?pbrcity=0 restores the sky-only reflection (the A/B)
const PBR_CITY = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('pbrcity') === '0');
// AR34 w2 soot patches in the walls' weathering; ?pbsoot=0 leaves them out (the A/B)
const PBR_SOOT = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('pbsoot') === '0');
// AR34 w2 b5 glass A/B flags (the default is the fix): ?pgframe=0 lays the room's bays and the street's lots on the vertex
// normal (the kit's paneW tilts each corner: shards); ?pgbody=0 lights an opaque unit's body as a wall (near white in the sun)
const PG_Q = (typeof location !== 'undefined' && new URLSearchParams(location.search)) || null;
const PG_FRAME = !(PG_Q && PG_Q.get('pgframe') === '0');
const PG_BODY = !(PG_Q && PG_Q.get('pgbody') === '0');
const PG_DBG = (PG_Q && +(PG_Q.get('pgdbg') || 0)) || 0;
// AR34 s6: the default share of a vision glass's rooms lit at night (?pglit=<0..1> for an A/B; 0.62 before s6)
const PG_LIT = PG_Q && PG_Q.get('pglit') !== null ? +PG_Q.get('pglit') : 0.4;
// ?pbst=0: dark paint takes LOOK's ST34 specular trim like everything else (the A/B of the exemption in makeSurface)
const PB_STX = !(PG_Q && PG_Q.get('pbst') === '0');
// AR34 s6 (programs): a set's constants are uniforms (the snap unit, the tap blend, rotation, mapping, chips, roughness,
// metalness, normal strength, glaze, the value curve's switches), so the library compiles one program per structure (street
// or not, paint, paint-over, gum, the attributes, the city reflection) instead of one per set and option set; `?pbprog=0`
// keys every material on its set and options again (the A/B: the same shader text, one program per option set as before)
const PB_PROG = !(PG_Q && PG_Q.get('pbprog') === '0');
// AR34 s6 (KIT 05:22, BID4 01:12): a paint set's chips show the substrate, the scan with its own paint's colour taken out
// where the scan is paint (paint_steel's scan is green paint over rust: under a red tint its chips read as a green
// camouflage); `?pbchip=0` shows the scan's own colour in the chips as before
const PB_CHIP = !(PG_Q && PG_Q.get('pbchip') === '0');
// fam: grime family; tex: packed set; tint: default average colour (sRGB) when the caller gives none; rough: multiplier;
// metal: constant metalness override; nrm: normal strength; unit: pattern repeat in the texture ([u, v] fractions) that
// anti-tiling offsets snap to (bricks keep their joints); iso: the set has no direction (any offset is fine)
const MATS = {
  // brick
  brick_red: { tex: 'brick_red', fam: 'wall', unit: 'brick' },
  // the same red brick with sooted (dark grey) joints, the faces carrying more colour at the same mean (AR34 w2, BID4)
  brick_red_sooted: { tex: 'brick_red_sooted', fam: 'wall', unit: 'brick' },
  brick_brown: { tex: 'brick_brown', fam: 'wall', unit: 'brick', tint: '#6b4536' },
  brick_tan: { tex: 'brick_tan', fam: 'wall', unit: 'brickv' },
  brick_buff: { tex: 'brick_tan', fam: 'wall', unit: 'brickv', tint: '#c9b690' },
  brick_white_glazed: { tex: 'brick_glazed', fam: 'wall', unit: 'brick', tint: '#dedcd4', glazed: 1 },
  // AR34 w2: cream glazed brick with its units brought out (varied unit tones, a few sooted or replaced units, a glaze
  // tilt per unit, grey joints: sets.mjs units); the Hotel Theresa's walls. brick_white_glazed keeps the flat set (the
  // glazed-tile bases whose joints the kit models read as brick courses with this one: 290 Lenox, sbs_b2/main290)
  brick_glazed_cream: { tex: 'brick_glazed_cream', fam: 'wall', unit: 'brick', tint: '#dcd8cc', glazed: 1 },
  // the flat glazed set (the same as brick_white_glazed): glazed tile and block bases whose joints the kit models
  tile_glazed: { tex: 'brick_glazed', fam: 'wall', unit: 'brick', tint: '#dedcd4', glazed: 1 },
  brick_painted: { tex: 'brick_painted', fam: 'wall', unit: 'brick', tint: '#d6d0c2' },
  brick_basketweave: { tex: 'brick_basket', fam: 'wall', unit: 'half' },   // stack-bond basketweave, white mortar (procedural)
  // stone, terracotta
  // stone_lime is JOINTLESS dressed limestone (trim, bands, cornices, coping, rustication the kit models); coursed ashlar
  // walls: stone_lime_ashlar
  stone_lime: { tex: 'stone_plain', fam: 'wall', unit: 'iso' },
  stone_lime_ashlar: { tex: 'stone_lime', fam: 'wall', unit: [1, 1], tint: '#c9c0ae' },
  stone_lime_rusticated: { tex: 'stone_rustic', fam: 'wall', unit: [1, 1], tint: '#c9c0ae' },
  brownstone: { tex: 'brownstone', fam: 'wall', unit: 'iso', tint: '#5b4034' },
  granite_grey: { tex: 'granite', fam: 'wall', unit: 'iso' },
  granite_grey_flamed: { tex: 'granite', fam: 'wall', unit: 'iso', roughSet: [0.62, 0.8], nrm: 0.6 },
  // the Museum of Natural History's own sets (city/lmAmnh.js): their library keys are the museum's alone, so Unreal binds them to
  // its own HQ sets (ue_families.json hq.pbr: neutral albedos, the colour the writers' tint per vertex) through every rebind
  amnh_tile: { tex: 'terracotta', fam: 'wall', unit: 'iso', tint: '#ffffff' },
  amnh_slate: { tex: 'granite', fam: 'wall', unit: 'iso', tint: '#ffffff' },
  amnh_copper: { tex: 'stucco', fam: 'wall', unit: 'iso', tint: '#ffffff' },
  amnh_granite: { tex: 'granite_pink', fam: 'wall', unit: 'iso', tint: '#ffffff' },
  amnh_sedum: { tex: 'mulch', fam: 'wall', unit: 'iso', tint: '#ffffff' },
  granite_pink: { tex: 'granite_pink', fam: 'wall', unit: 'iso', tint: '#a68a80' },
  granite_black: { tex: 'granite', fam: 'wall', unit: 'iso', tint: '#232324' },
  // (no red granite set is packed: the grey granite's grain under the red tint is the intended look, QA Q50)
  granite_red: { tex: 'granite', fam: 'wall', unit: 'iso', tint: '#6e3b32' },
  terracotta_cream: { tex: 'terracotta', fam: 'wall', unit: [0.5, 1], tint: '#d9d2c1', glazed: 0.6 },
  cast_stone: { tex: 'stone_plain', fam: 'wall', unit: 'iso', tint: '#c9c1b0', rough: 0.95 },
  // concrete, render
  concrete_precast: { tex: 'concrete_precast', fam: 'wall', unit: 'iso' },
  concrete_board: { tex: 'concrete_board', fam: 'wall', unit: [0.25, 1], tint: '#9d9b95' },
  concrete_smooth: { tex: 'concrete_smooth', fam: 'wall', unit: 'iso', tint: '#aaa79f' },
  stucco: { tex: 'stucco', fam: 'wall', unit: 'iso', tint: '#cfc8b8' },
  // panels, steel, aluminium
  panel_alu: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#bfc3c7', metal: 1, rough: 1.1 },
  panel_grey: { tex: 'panel_paint', fam: 'metal', unit: 'iso', tint: '#6f7377', metal: 0 },
  metal_painted: { tex: 'paint_steel', fam: 'paint', unit: 'iso', tint: '#1f3327', chips: 0.6, chips34: 0.2 },
  steel_black: { tex: 'paint_steel', fam: 'paint', unit: 'iso', tint: '#151617', chips: 0.25, chips34: 0.12 },
  steel_rust: { tex: 'steel_rust', fam: 'metal', unit: 'iso', tint: '#6a3a22', metal: 0 },
  steel_galvanized: { tex: 'steel_galv', fam: 'metal', unit: 'iso', tint: '#9c9fa1', metal: 1 },
  alu_clear: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#c4c7ca', metal: 1 },
  alu_bronze: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#4b3a2a', metal: 1, rough: 1.2 },
  alu_black: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#1c1c1d', metal: 1, rough: 1.3 },
  alu_white: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#e4e4df', metal: 0, rough: 1.4, nrm: 0.3 },
  stainless: { tex: 'alu_brushed', fam: 'metal', unit: 'dir', tint: '#b8babc', metal: 1, rough: 0.8 },
  // wood, roofs
  wood_painted: { tex: 'wood_paint', fam: 'paint', unit: [0.25, 1], tint: '#e0dccf', chips: 0.5, chips34: 0.3 },
  // raw plywood (hoardings, boarded shop fronts): a pale tan birch face, weathered as a wall (Poly Haven plywood)
  plywood: { tex: 'plywood', fam: 'wall', unit: 'iso', tint: '#d1c29b', rough: 1.05 },   // tint aimed at the 5-15 W crop's weathered ply (150,142,114); board mbN: #c4ab86 rendered (131,115,88), #dccfa8 (166,157,130)
  roof_membrane: { tex: 'roof_tpo', fam: 'roof', unit: 'iso', tint: '#d9d9d4' },
  roof_epdm: { tex: 'roof_tpo', fam: 'roof', unit: 'iso', tint: '#27282a' },
  roof_gravel: { tex: 'roof_gravel', fam: 'roof', unit: 'iso', tint: '#8f8a80' },
  // streets (STREET)
  sidewalk_concrete: { tex: 'sidewalk', fam: 'street', unit: 'iso', gum: 1 },
  asphalt_worn: { tex: 'asphalt', fam: 'street', unit: 'iso' },
  asphalt_patch: { tex: 'asphalt_patch', fam: 'street', unit: 'iso', tint: '#3d3c3a' },
  curb_granite: { tex: 'granite', fam: 'street', unit: 'iso', tint: '#8c8b87', roughSet: [0.6, 0.82], nrm: 0.6 },
  curb_steel: { tex: 'paint_steel', fam: 'street', unit: 'iso', tint: '#3a3634', chips: 1 },
  detectable_warning: { tex: 'tactile', fam: 'street', unit: [0.1, 0.1], tint: '#d9a91e' },
  detectable_warning_dark: { tex: 'tactile', fam: 'street', unit: [0.1, 0.1], tint: '#2e2e2f' },
  paving_brick: { tex: 'paving_brick', fam: 'street', unit: [1, 1] },
  cobble_belgian: { tex: 'cobble', fam: 'street', unit: [1, 1] },
  mulch: { tex: 'mulch', fam: 'street', unit: 'iso' },
  // paint over the asphalt set: the tint is the PAINT (the asphalt keeps its own colour where the paint is worn through);
  // use mapping: 'world' so a painted strip and the road around it show the same asphalt
  paint_thermo: { tex: 'asphalt', fam: 'street', unit: 'iso', tint: '#e8e6dc', paintOver: 0.93, paintRough: 0.52 },
  paint_thermo_yellow: { tex: 'asphalt', fam: 'street', unit: 'iso', tint: '#e0b227', paintOver: 0.93, paintRough: 0.52 },
  bus_lane_red: { tex: 'asphalt', fam: 'street', unit: 'iso', tint: '#8a2f25', paintOver: 0.88, paintRough: 0.6 },
};
// glass: no textures; its own reflection (the city's analytic sky with canyon occlusion, the same model as the shader
// facades), Fresnel, a slight tint, premultiplied blending (the reflection is not faded by the transparency)
// opacity is (1 - transmission): clear float glass passes ~80 % of what is behind it, double / low-e units 60-70 %
const GLASS = {
  glass_clear: { tint: '#e9f0ee', opacity: 0.28, f0: 0.045, rough: 0.03 },
  glass_storefront: { tint: '#e3ece9', opacity: 0.2, f0: 0.05, rough: 0.04, dirt: 0.25 },
  glass_window: { tint: '#dfe8e6', opacity: 0.35, f0: 0.05, rough: 0.03, dirt: 0.3 },
  // opaque curtain-wall glass (no interior modelled behind it): a dark body, the same reflection
  glass_tower: { tint: '#b9c4c8', f0: 0.07, rough: 0.03, opaque: true, body: '#1d2327' },
  glass_tower_blue: { tint: '#9fb8c6', f0: 0.09, rough: 0.03, opaque: true, body: '#16222b' },
  glass_tower_grey: { tint: '#aeb3b5', f0: 0.08, rough: 0.03, opaque: true, body: '#1b1d1f' },
  glass_tower_bronze: { tint: '#c2a88c', f0: 0.08, rough: 0.03, opaque: true, body: '#221b15' },
  glass_tower_green: { tint: '#a9c2b6', f0: 0.08, rough: 0.03, opaque: true, body: '#18231f' },
  glass_grey: { tint: '#6f7678', opacity: 0.45, f0: 0.06, rough: 0.03 },
  glass_blue: { tint: '#5d7c8c', opacity: 0.55, f0: 0.08, rough: 0.03 },
  glass_bronze: { tint: '#7a6450', opacity: 0.5, f0: 0.07, rough: 0.03 },
  glass_green: { tint: '#7f9a8c', opacity: 0.4, f0: 0.06, rough: 0.03 },
  // AR34 w2 VISION GLASS: an opaque curtain-wall pane with the room behind it drawn in its shader (ROOM_GLSL: shades and
  // vertical blinds drawn down to heights of their own, the ceiling's lamps, the floor, the back wall, the slab edge at
  // each floor line), the street in the reflection, a low-e coating. trans: the share of the room's light the unit lets
  // through (the tint colours it). For curtain walls that read as flat pale panels (5-15 W 125th, the Victoria).
  glass_vision: { tint: '#e2e9ea', f0: 0.18, rough: 0.03, opaque: true, room: 1, trans: 0.7 },
  glass_vision_grey: { tint: '#b4bbbd', f0: 0.1, rough: 0.03, opaque: true, room: 1, trans: 0.42 },
  glass_vision_blue: { tint: '#a6c0ce', f0: 0.11, rough: 0.03, opaque: true, room: 1, trans: 0.5 },
  glass_vision_green: { tint: '#b0cbbd', f0: 0.1, rough: 0.03, opaque: true, room: 1, trans: 0.55 },
  glass_vision_bronze: { tint: '#c6ab90', f0: 0.1, rough: 0.03, opaque: true, room: 1, trans: 0.42 },
};
const ALIAS = {
  alu_dark: 'alu_black', aluminum: 'alu_clear', aluminium: 'alu_clear', metal: 'metal_painted', steel: 'steel_black',
  terracotta: 'terracotta_cream', granite: 'granite_grey', limestone: 'stone_lime', stone: 'stone_lime',
  concrete: 'concrete_smooth', glass: 'glass_clear', brick: 'brick_red', brick_white: 'brick_white_glazed',
  brick_glazed: 'brick_white_glazed', sidewalk: 'sidewalk_concrete', asphalt: 'asphalt_worn', wood: 'wood_painted',
  bronze: 'alu_bronze', copper: 'alu_bronze',
  roof_white: 'roof_membrane', roof_tpo: 'roof_membrane', roof_black: 'roof_epdm', roof_pavers: 'sidewalk_concrete',
  roof_green: 'mulch', membrane: 'roof_membrane', gravel: 'roof_gravel', marble: 'stone_lime', plaster: 'stucco',
  precast: 'concrete_precast', iron: 'steel_black', cast_iron: 'steel_black', brick_orange: 'brick_red',
  ply: 'plywood', hoarding: 'plywood', wood_ply: 'plywood', glazed_tile: 'tile_glazed', tile_white_glazed: 'tile_glazed', brick_cream_glazed: 'brick_glazed_cream', glazed_brick: 'brick_glazed_cream', brick_red_dark_mortar: 'brick_red_sooted',
};
const FAMILY = [
  [/^brick/, 'brick_red'], [/^(stone|lime|brownstone)/, 'stone_lime'], [/^granite/, 'granite_grey'], [/^(concrete|cast)/, 'concrete_precast'],
  [/^(alu|stainless)/, 'alu_clear'], [/^(steel|metal|iron)/, 'metal_painted'], [/^glass/, 'glass_clear'], [/^panel/, 'panel_alu'],
  [/^wood/, 'wood_painted'], [/^asphalt/, 'asphalt_worn'], [/^terracotta/, 'terracotta_cream'], [/^roof/, 'roof_membrane'],
  [/^(sidewalk|paving|curb|cobble)/, 'sidewalk_concrete'],
];
// a set that has not been packed borrows its family's set (with the material's own tint)
const TEX_FALLBACK = {
  brick_brown: 'brick_red', brick_buff: 'brick_tan', brick_basket: 'brick_red', brick_red_sooted: 'brick_red', brick_glazed: 'brick_tan', brick_glazed_cream: 'brick_glazed', brick_painted: 'brick_red',
  stone_plain: 'stone_lime', stone_rustic: 'stone_lime', brownstone: 'stone_lime', granite_pink: 'granite', granite_red: 'granite', terracotta: 'stone_lime',
  cast_stone: 'concrete_precast', concrete_board: 'concrete_precast', concrete_smooth: 'concrete_precast', stucco: 'concrete_precast',
  panel_paint: 'paint_steel', steel_rust: 'paint_steel', steel_galv: 'alu_brushed', wood_paint: 'paint_steel', plywood: 'wood_paint',
  roof_tpo: 'concrete_precast', roof_gravel: 'concrete_precast', sidewalk: 'concrete_precast', asphalt: 'concrete_precast',
  asphalt_patch: 'asphalt', tactile: 'concrete_precast', paving_brick: 'brick_red', cobble: 'granite', mulch: 'concrete_precast',
  thermo: 'concrete_precast', bus_red: 'asphalt',
};
const CORE = ['brick_red', 'brick_tan', 'stone_plain', 'stone_lime', 'granite', 'concrete_precast', 'paint_steel', 'alu_brushed'];

const _noted = new Set();
function note(msg) { if (_noted.has(msg)) return; _noted.add(msg); console.log('[pbr] ' + msg); }
function resolve(name) {
  if (MATS[name] || GLASS[name]) return name;
  if (ALIAS[name]) return ALIAS[name];
  const f = FAMILY.find(([re]) => re.test(name));
  const to = f ? f[1] : 'concrete_smooth';
  note(`'${name}' is not in the library: using '${to}'`);
  return to;
}
function texFor(t) { let k = t, i = 0; while (!PBR_TEX[k] && TEX_FALLBACK[k] && i++ < 4) k = TEX_FALLBACK[k]; return PBR_TEX[k] ? k : null; }
export function pbrNames() { return [...Object.keys(MATS), ...Object.keys(GLASS), ...Object.keys(ALIAS)].sort(); }
export function pbrHas(name) { return !!(MATS[name] || GLASS[name] || ALIAS[name]); }
export function pbrInfo(name) {
  const n = resolve(name), M = MATS[n];
  if (!M) return { family: 'glass', size: null, mean: GLASS[n].tint, source: 'procedural' };
  const k = texFor(M.tex), T = k && PBR_TEX[k];
  return { family: M.fam, set: k, size: T ? T.size : null, mean: M.tint || (T && T.meanHex) || '#808080', source: T ? `${T.url} (${T.licence})` : null };
}

// ---------------------------------------------------------------- textures
const srgbLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const hexLin = (h) => [1, 3, 5].map((i) => srgbLin(parseInt(h.slice(i, i + 2), 16) / 255));
const px = (r, g, b, a = 255, srgb = false) => {
  const t = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true; return t;
};
const _sets = {};     // tex -> { alb, nrm, orm: uniform objects, ready: Promise }
let _loader = null, _renderer = null, _queue = [];
function getLoader() {
  if (_loader) return _loader;
  const r = _renderer || (typeof window !== 'undefined' && window.__ENGINE && window.__ENGINE.renderer);
  if (!r) return null;
  _loader = ktx2Loader(r);   // (the app's one KTX2Loader: mat/ktx2.js)
  return _loader;
}
function pump() {
  const L = getLoader(); if (!L) return false;
  const q = _queue; _queue = [];
  for (const job of q) job(L);
  return true;
}
if (typeof window !== 'undefined') {
  const iv = setInterval(() => { if (pump() || _loader) clearInterval(iv); }, 200);
}
function texSet(k) {
  if (_sets[k]) return _sets[k];
  const T = PBR_TEX[k];
  const m = T.mean.map((v) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)));
  const S = _sets[k] = {
    alb: { value: px(m[0], m[1], m[2], 255, true) }, nrm: { value: px(128, 128, 255) },
    orm: { value: px(255, Math.round((T.roughMean ?? 0.8) * 255), 0, 128) },
  };
  let done = 0;
  S.ready = new Promise((res) => {
    const job = (L) => {
      for (const [slot, file, srgb] of [['alb', 'albedo', true], ['nrm', 'normal', false], ['orm', 'orm', false]]) {
        L.load(`textures/pbr/${k}/${file}.ktx2`, (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = srgb ? 16 : 8;   // colour sharp, data at 8 (world/materials.js initGTEX, the r8 rule)
          S[slot].value = t;
          if (++done === 3) res(k);
        }, undefined, (e) => { console.warn('[pbr] texture failed', k, file, e && e.message); if (++done === 3) res(k); });
      }
    };
    _queue.push(job); pump();
  });
  return S;
}
// the sets in use and what they hold on the GPU: 3 maps a set, 1 byte a texel once transcoded to BC7 / ASTC 4x4, mips
// add a third (computed from the packed resolutions, not read back from the driver)
export function pbrStats() {
  const sets = Object.keys(_sets).sort();
  let texels = 0;
  for (const k of sets) { const r = PBR_TEX[k].res; texels += 3 * r[0] * r[1]; }
  return { sets, n: sets.length, mbGpu: +((texels * 4) / 3 / 1048576).toFixed(1), materials: _cache.size };
}
export const pbrReady = new Promise((res) => {
  const go = () => Promise.all(CORE.filter((k) => PBR_TEX[k]).map((k) => texSet(k).ready)).then(res);
  if (typeof window === 'undefined') res(); else { go(); setTimeout(res, 60000); }
});

// ---------------------------------------------------------------- shared GLSL
const NOISE_GLSL = /* glsl */ `
  float pbH12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  vec2 pbH22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
  float pbN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(pbH12(i), pbH12(i + vec2(1, 0)), f.x), mix(pbH12(i + vec2(0, 1)), pbH12(i + vec2(1, 1)), f.x), f.y); }
  float pbF(vec2 p) { return pbN(p) * 0.55 + pbN(p * 2.03 + 17.1) * 0.28 + pbN(p * 4.11 + 31.7) * 0.17; }
  float pbLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
`;

// THE CITY IN THE REFLECTION. three's environment is the sky alone (world/sky.js envScene: below the horizon it repeats
// the horizon's haze), so the reflection lobe of a wall, a frame or a cornice saw open sky in every direction where the
// real one sees the street and the buildings across it: dark paint and dark metal read navy blue by day, every sheen
// was sky blue. The share of the lobe under the street canyon's skyline (seen from this height: about 30 deg at the
// sidewalk, the horizon from ~32 m up) takes the city instead, a cool grey (shade) at 0.55 of the sky's luminance; the sky
// above the skyline is kept, a third paler (the 125th Street captures' skies are hazy; at cornice height steel_black
// sin elevation) along R.
const CITY_GLSL = /* glsl */ `
  float pbCityK(vec3 Rw, float h, float w) {
    float hz = 0.55 * (1.0 - smoothstep(2.0, 32.0, h));
    return smoothstep(hz - w, hz + w, Rw.y);
  }
  vec3 pbCity(vec3 c, float k) {
    vec3 g = vec3(dot(c, vec3(0.2126, 0.7152, 0.0722))) * vec3(0.95, 1.0, 1.08);
    return mix(g * 0.55, mix(c, g, 0.35), k);
  }
`;
// the radiance edit at lights_fragment_end (three's own lobe direction, the canyon from the street height h)
const cityRadiance = (h) => `
        #if defined( RE_IndirectSpecular )
        {
          vec3 cR = normalize(mix(reflect(-geometryViewDir, geometryNormal), geometryNormal, pow4(material.roughness)));
          vec3 cRw = inverseTransformDirection(cR, viewMatrix);
          radiance = pbCity(radiance, pbCityK(cRw, ${h}, 0.1 + 0.55 * material.roughness * material.roughness));
        }
        #endif`;
const BASE_KEY = THREE.Material.prototype.customProgramCacheKey;
// applyCityRefl(mat): the city in the reflection (CITY_GLSL) for any MeshStandardMaterial outside the library (a kit's
// plain paint, a fire escape's iron, a pole): three's sky-only environment made their dark paints navy blue by day.
// Composes with an existing onBeforeCompile; the street height comes from the city AO bake. ?pbrcity=0: unchanged.
export function applyCityRefl(mat) {
  if (!PBR_CITY || !mat || !mat.isMeshStandardMaterial || mat.userData.pbCity) return mat;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.pcCAO = ENV.cityAO; sh.uniforms.pcCAORect = ENV.cityAORect;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vPcW;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 pcP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            pcP = instanceMatrix * pcP;
          #endif
          vPcW = (modelMatrix * pcP).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPcW; uniform sampler2D pcCAO; uniform vec4 pcCAORect;
        ${CITY_GLSL}`)
      .replace('#include <lights_fragment_end>', `
        float pcGy = 0.0;
        if (pcCAORect.z > 0.0) pcGy = texture2D(pcCAO, (vPcW.xz - pcCAORect.xy) * pcCAORect.zw).g * 127.5;
        ${cityRadiance('vPcW.y - pcGy')}
        #include <lights_fragment_end>`);
  };
  mat.customProgramCacheKey = () => (prevKey && prevKey !== BASE_KEY ? prevKey.call(mat) : (prev ? String(prev) : '')) + '|pbcity';
  mat.userData.pbCity = true;
  mat.needsUpdate = true;
  return mat;
}

// THE STREET IN THE GLASS. A pane mirrors the buildings across the street below their skyline, not the sky: the
// reflected ray is followed to a facing wall W m out along the pane's normal (125th Street: 30.5 m building line to
// building line) and to the street plane. Along that wall stand invented buildings (12 m lots, 10-42 m high) in masonry
// tones (brick, buff, limestone, brownstone, painted), lit as a wall facing back along -N is (the sun on it or not), with
// rows of windows that mirror the sky dimly (lit at night) and a shop band; above them the analytic sky. Every edge is
// box-filtered by its pixel footprint, so the pattern fades to its mean with distance. pgStreet returns the radiance;
// pgSkyK is the sky's share (for the sun disc). Needs NOISE_GLSL.
const STREET_GLSL = /* glsl */ `
  float pgSkyK;
  float pgCovI(float x, float lo, float hi) { return floor(x) * (hi - lo) + clamp(fract(x) - lo, 0.0, hi - lo); }
  float pgCov(float x, float lo, float hi, float w) { w = max(w, 1e-4); return clamp((pgCovI(x + 0.5 * w, lo, hi) - pgCovI(x - 0.5 * w, lo, hi)) / w, 0.0, 1.0); }
  vec3 pgO = vec3(0.0);
  vec3 pgStreet(vec3 P, vec3 R, vec3 N, float gy, float W, vec3 sky, vec3 hor, vec3 sunD, float night) {
    float L = pbLum(hor);
    float t = W / max(dot(R, N), 0.035);
    vec3 Q = P + R * t;
    vec3 Tg = normalize(vec3(-N.z, 0.0, N.x) + 1e-5);
    float u = dot(Q - pgO, Tg), qy = Q.y - gy;
    float fu = length(vec2(dFdx(u), dFdy(u))), fy = length(vec2(dFdx(qy), dFdy(qy)));
    float li = floor(u / 12.0);
    vec2 hh = pbH22(vec2(li, 5.3) + 0.5);
    float hb = 10.0 + 32.0 * hh.x * hh.x;
    float pick = pbH12(vec2(li, 9.1) + 0.5);
    vec3 tone = pick < 0.35 ? vec3(0.36, 0.17, 0.11) : pick < 0.55 ? vec3(0.55, 0.46, 0.34) : pick < 0.75 ? vec3(0.62, 0.58, 0.5)
      : pick < 0.88 ? vec3(0.26, 0.16, 0.12) : vec3(0.7, 0.7, 0.66);
    float sunF = max(dot(-N, sunD), 0.0) * (1.0 - night);
    vec3 wall = tone * L * (0.5 + 1.4 * sunF);
    // windows 1.1 m wide every 2.4 m, floors of 3.3 m from 4.6 m up
    float win = pgCov((u + hh.y * 2.4) / 2.4, 0.27, 0.73, fu / 2.4) * pgCov((qy - 4.6) / 3.3, 0.18, 0.74, fy / 3.3) * smoothstep(4.4, 4.8, qy);
    vec3 winC = mix(vec3(0.07 * L), sky * 0.25, 0.5);
    winC = mix(winC, vec3(1.0, 0.74, 0.46) * 0.5 * step(0.5, pbH12(floor(vec2(u / 2.4, qy / 3.3)) + li)), night);
    vec3 fac = mix(wall, winC, win);
    // the shop band: dark glass to 3.3 m, a sign band to 4.3 m in a colour of its own
    vec3 signC = (0.2 + 0.8 * vec3(pbH12(vec2(li, 1.3)), pbH12(vec2(li, 2.9)), pbH12(vec2(li, 4.7)))) * L * 0.45;
    vec3 shop = mix(vec3(0.13 * L), signC, smoothstep(3.3 - fy, 3.3 + fy, qy));
    fac = mix(shop, fac, smoothstep(4.3 - fy, 4.3 + fy, qy));
    float bld = 1.0 - smoothstep(hb - fy, hb + fy, qy);
    // the street below: the ray meets the ground before the facing wall
    float st = R.y < -1e-3 ? step((P.y - gy) / max(-R.y, 1e-3), t) : 0.0;
    pgSkyK = (1.0 - bld) * (1.0 - st);
    // the pavement: sunlit concrete and asphalt (the sun's height), the shade's share
    return mix(mix(sky, fac, bld), vec3(1.0, 0.97, 0.92) * L * (0.12 + 0.35 * max(sunD.y, 0.0) * (1.0 - night)), st);
  }
`;
export const PBR_STREET_GLSL = STREET_GLSL;

// THE ROOM BEHIND VISION GLASS. The view ray goes on through the pane into an office floor: storeys of rm.x m from rm.y
// above the street, a dropped ceiling 0.3 m under the slab above (0.5 m lamps every 2.4 m), the floor, a
// back wall rm.z m in, the slab edge and plenum as a dark band at each floor line (0.3 m); 0.12 m behind the glass a shade per
// bay of rm.w m (share bl of the bays: a roller shade or vertical blinds, drawn down to a height of its own). By day the
// room is lit from its windows (a share of the outdoor level L, darker with depth), the lamps on in most rooms; at
// night most rooms lit, the shades glowing. Edges box-filtered by the pixel footprint, the bays fading to their mean
// when a bay is under a few pixels. Needs NOISE_GLSL and STREET_GLSL's pgCov.
const ROOM_GLSL = /* glsl */ `
  vec3 pgRoom(vec3 P, vec3 Vd, vec3 N, float gy, float L, float night, vec4 rm, float bl, float sd, float shr, float slk, float lit) {
    vec3 Tg = normalize(vec3(-N.z, 0.0, N.x) + 1e-5);
    float u = dot(P - pgO, Tg), y = P.y - gy;
    float rd = max(dot(Vd, -N), 0.08);
    float ru = dot(Vd, Tg) / rd, ry = Vd.y / rd;
    float Hs = rm.x, fs = (y - rm.y) / Hs, fl = floor(fs), yIn = (fs - fl) * Hs;
    float fwy = max(fwidth(y), 1e-4), fwu = max(fwidth(u), 1e-4);
    float yc = Hs - 0.3;
    // the shade plane
    float uS = u + ru * 0.12, ySd = yIn + ry * 0.12;
    float bi = floor(uS / rm.w);
    vec2 hb = pbH22(vec2(bi, fl) + sd);
    float hk = pbH12(vec2(bi, fl) + sd + 7.1);
    // sheers (opts.sheers): that share of the bays behind a full-height translucent white sheer with soft folds, a quarter of
    // them drawn part open; no shade in a sheer bay
    float hs2 = pbH12(vec2(bi, fl) + sd + 13.7);
    float isSh = step(hs2, shr);
    float has = step(hb.x, bl) * (1.0 - isSh);
    float vert = step(hb.x, bl * 0.3);
    // shades drawn to heights of their own around a height shared by a run of 8 bays (the offices of a floor: a patchwork of
    // independent heights read as white blocks, BID4 / EAST b3)
    float hF = pbH12(vec2(floor(uS / (rm.w * 8.0)), fl) + sd + 5.9);
    float bot = yc - mix(0.12, 1.0, mix(hF, hb.y, 0.3)) * (yc - 0.1);
    float sh = has * smoothstep(bot - fwy, bot + fwy, ySd) * (1.0 - smoothstep(yc - fwy, yc + fwy, ySd));
    sh *= mix(1.0, 0.7 + 0.3 * pgCov(uS / 0.089, 0.0, 0.8, fwu / 0.089), vert);
    // venetian blinds in another third of the shaded bays: horizontal slats 6 cm apart, the room a little through them
    // (the HCZ crop's half-drawn white blinds); the slats fade to their mean once under a few pixels
    float ven = step(bl * 0.3, hb.x) * step(hb.x, bl * 0.65);
    sh *= mix(1.0, 0.72 + 0.28 * pgCov(ySd / 0.06, 0.0, 0.78, fwy / 0.06), ven);
    // the room: ceiling, floor or back wall, whichever the ray meets first
    float tC = ry > 1e-4 ? (yc - yIn) / ry : 1e4;
    float tF = ry < -1e-4 ? -yIn / ry : 1e4;
    float t = min(min(tC, tF), rm.z);
    float isC = step(tC, min(tF, rm.z)), isF = (1.0 - isC) * step(tF, rm.z);
    float tc = min(tC, 60.0);
    float uC = u + ru * tc;
    float fwc = max(fwidth(uC), 1e-4), fwd = max(fwidth(tc), 1e-4);
    float lamp = pgCov(uC / 2.4, 0.4, 0.6, fwc / 2.4) * pgCov(tc / 2.4 - 0.3, 0.4, 0.6, fwd / 2.4);
    // a lamp under a few pixels: its share of the ceiling (dots far away read as noise)
    lamp = mix(lamp, 0.04, smoothstep(0.12, 0.35, max(fwc, fwd)));
    // light: by day from the windows (falls off with depth) and the lamps; at night the lamps of the lit rooms
    // (AR34 s6, HPT 03:26: at night a share 'lit' of the rooms are lit (opts.lit, default 0.4; was 0.62), their light warm (lamps
    // ~3000 K: night photograph 46's lit windows are yellow-orange), the unlit ones dark)
    // (by day the lamps go by 9 m office zones; at night a lit room is two bays wide, the windows of the photograph's towers)
    float cellW = night > 0.5 ? rm.w * 2.0 : 9.0;
    float on = step(pbH12(vec2(floor(u / cellW), fl) + sd + 3.3), mix(0.85, lit, night));
    float dayK = L * (1.0 - night);
    vec3 warm = mix(vec3(1.0, 0.93, 0.82), vec3(1.0, 0.78, 0.52), night);
    float fill = dayK * 0.42 * exp(-t * 0.12) + night * on * 0.12;
    vec3 fillC = mix(vec3(1.0), warm, night);
    vec3 ceilC = vec3(0.92, 0.92, 0.9) * fillC * fill * 1.25 + mix(vec3(1.0, 0.99, 0.96), warm, night) * lamp * on * mix(dayK * 0.4, 1.1, night);
    vec3 flrC = vec3(0.4, 0.38, 0.36) * fillC * fill;
    vec3 wallC = vec3(0.6, 0.6, 0.58) * fillC * fill * (0.8 + 0.4 * hk);
    vec3 room = mix(mix(wallC, flrC, isF), ceilC, isC);
    // the shade: lit by the day on its outer face, glowing from the room at night; white, grey or beige
    vec3 shc = mix(vec3(0.9, 0.89, 0.86), mix(vec3(0.68, 0.68, 0.67), vec3(0.8, 0.75, 0.66), step(0.88, hk)), step(0.68, hk));
    vec3 shade = shc * (dayK * 0.78 + night * on * 0.32 * warm);
    // far away (a bay under a few pixels) the shades fade to their mean
    float farK = smoothstep(0.15, 0.6, fwu / rm.w);
    sh = mix(sh, bl * (1.0 - shr) * 0.5 * (yc - 0.1) / Hs, farK);
    vec3 c = mix(room, shade, sh);
    {
      float uB = fract(uS / rm.w), fb = fwu / rm.w;
      float shW = mix(1.0, 0.4 + 0.45 * hk, step(0.75, fract(hs2 * 7.31)));
      float cov = isSh * (1.0 - smoothstep(shW - fb, shW + fb, uB)) * smoothstep(0.08 - fwy, 0.08 + fwy, ySd) * (1.0 - smoothstep(yc - fwy, yc + fwy, ySd));
      cov = mix(cov, shr * 0.9 * (yc - 0.08) / Hs, farK);
      float fold = 0.8 + 0.2 * sin(6.2832 * uS / 0.17 + 2.5 * pbN(vec2(uS * 1.3, fl + sd)));
      fold = mix(fold, 0.8, smoothstep(0.02, 0.06, fwu));
      // lit on its outer face by the day (a translucent cloth: less than a roller shade), glowing from a lit room at night;
      // the room faintly through it
      vec3 she = vec3(0.93, 0.92, 0.89) * fold * (dayK * 0.6 + night * on * 0.3 * warm) + room * 0.25;
      c = mix(c, she, cov);
    }
    // the slab edge and plenum at each floor line
    // (only with the caller's storeys, slk 1: on a kit curtain whose floor lines the shader does not know, a slab band at
    // the default 3.7 m grid crossed the vision panes mid-height: 5-15 W, EAST's e125-35)
    float slab = pgCov(fs, yc / Hs, 1.0, fwy / Hs) * slk;
    return mix(c, vec3(0.16) * L * (1.0 - night) + vec3(0.01) * night, slab);
  }
`;

// inverse error function (Giles' approximation), for the paint-coverage threshold
function erfinv(x) {
  x = Math.max(-0.999, Math.min(0.999, x));
  let w = -Math.log((1 - x) * (1 + x)), p;
  if (w < 5) { w -= 2.5; p = 2.81022636e-08; for (const c of [3.43273939e-07, -3.5233877e-06, -4.39150654e-06, 0.00021858087, -0.00125372503, -0.00417768164, 0.246640727, 1.50140941]) p = c + p * w; }
  else { w = Math.sqrt(w) - 3; p = -0.000200214257; for (const c of [0.000100950558, 0.00134934322, -0.00367342844, 0.00573950773, -0.0076224613, 0.00943887047, 1.00167406, 2.83297682]) p = c + p * w; }
  return p * x;
}

// ---------------------------------------------------------------- the material
const _cache = new Map();
const keyOf = (name, o) => name + '|' + Object.keys(o).sort().map((k) => k + '=' + (o[k] && o[k].isTexture ? o[k].uuid : JSON.stringify(o[k]))).join('&');

export function pbrMaterial(name, opts = {}) {
  const n = resolve(name);
  const key = keyOf(n, opts);
  if (_cache.has(key)) return _cache.get(key);
  const mat = GLASS[n] ? makeGlass(n, opts) : makeSurface(n, opts);
  mat.name = 'pbr:' + n;
  mat.userData.pbr = { name: n, opts };
  _cache.set(key, mat);
  return mat;
}

function makeSurface(n, o) {
  const M = MATS[n];
  const k = texFor(M.tex);
  if (!k) throw new Error(`[pbr] no texture set packed for ${n}`);
  if (k !== M.tex) note(`'${n}': set '${M.tex}' not packed yet, drawing '${k}'`);
  const T = PBR_TEX[k], S = texSet(k);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, side: o.side ?? THREE.FrontSide });
  const tintHex = o.tint || M.tint || T.meanHex;
  const tint = hexLin(tintHex);
  const paint = T.alpha === 'paint';
  const over = M.paintOver ? +(o.cover ?? M.paintOver) : 0;   // paint-over coverage 0..1 (bus lane, line paint)
  // albedo ratio: tint / packed mean (paint sets: tint / paint-cluster luminance, applied to the paint only)
  const ref = paint ? T.paintMean : T.mean;
  const refL = 0.2126 * ref[0] + 0.7152 * ref[1] + 0.0722 * ref[2];
  const ratio = over ? [1, 1, 1] : paint ? tint.map((v) => v / Math.max(refL, 1e-4)) : tint.map((v, i) => v / Math.max(ref[i], 1e-4));
  const mul = o.mul ? hexLin(o.mul) : [1, 1, 1];
  const scale = +(o.scale ?? 1);
  const size = [T.size[0] * scale, T.size[1] * scale];
  const fam = M.fam;
  const street = fam === 'street';
  const dirt = +(o.dirt ?? (fam === 'wall' ? 0.3 : fam === 'street' ? 0.15 : fam === 'roof' ? 0.3 : 0.1));
  const seed = +(o.seed ?? 0);
  const rough = +(o.rough ?? 1) * (M.rough ?? 1);
  let nrmK = +(o.nrm ?? 1) * (M.nrm ?? 1);
  const metal = M.metal;
  const rot = ((o.rot ?? 0) * Math.PI) / 180;
  const world = o.mapping === 'world';
  const gAttr = !!o.grimeAttr;
  const wAttr = !!o.weatherAttr;   // per-vertex aWeather = (seed, baseY, topY): one material across many buildings
  // AR34 s6 (KIT 05:29): with dirtAttr the weather attribute is a vec4 (seed, baseY, topY, dirt), the dirt per vertex (a
  // negative w: this material's own `dirt`), so one material serves every dirt value
  const dAttr = wAttr && !!o.dirtAttr;
  // anti-tiling offsets snap to whole pattern units: a brick set moves by whole bricks and two courses (joints stay put)
  let unit = [0, 0];
  if (M.unit === 'brick' && T.courses && T.bricks) unit = [1 / (T.halfBricks ? T.bricks / 2 : T.bricks), 2 / T.courses];
  else if (M.unit === 'brickv' && T.courses) unit = [1, 2 / T.courses];   // random bond: whole courses only
  else if (Array.isArray(M.unit)) unit = M.unit;           // explicit snap in texture repeats ([1, 1]: no offsets)
  else if (M.unit === 'dir') unit = [0.25, 0.25];
  else if (M.unit === 'half') unit = [0.5, 0.5];
  const sharp = M.unit === 'brick' || M.unit === 'brickv' || M.unit === 'half';   // switch layers along the joints
  const roughSet = M.roughSet || null;
  // the AR34 response (the city in the reflection, the dark toe, fewer chips); opts.city: 0 = the AR33 one
  const city = PBR_CITY && fam !== 'street' && !(o.city === 0 || o.city === false);
  const chips = +(o.chips ?? (city && M.chips34 !== undefined ? M.chips34 : M.chips) ?? 1);
  // a paint set's relief is its chips' edges: fresh paint (few chips) is smooth
  if (city && T.alpha === 'paint') nrmK *= 0.35 + 0.65 * Math.min(1, chips);
  const glazed = +(M.glazed || 0);
  // walls, roofs, paint and metal take the shader facades' value curve (net of applyLightTrim); street surfaces take the
  // ground's calibration (applyLightTrim with STREET_CAL, the flags' own trim), as the street furniture does
  const facCal = fam !== 'street' && o.trim === undefined;
  // a constant at the precision it had when it was written into the shader (the same pixels as the baked programs)
  const F = (v) => +(+v).toFixed(4);
  const scanL = paint ? 0.2126 * T.paintMean[0] + 0.7152 * T.paintMean[1] + 0.0722 * T.paintMean[2] : 1;
  const U = {
    pbAlb: S.alb, pbNrm: S.nrm, pbOrm: S.orm,
    pbSize: { value: new THREE.Vector2(size[0], size[1]) },
    pbRatio: { value: new THREE.Vector3(ratio[0] * mul[0], ratio[1] * mul[1], ratio[2] * mul[2]) },
    pbSeed: { value: seed },
    pbDirt: { value: dirt },
    pbBaseY: { value: o.baseY ?? -1e4 },
    pbTopY: { value: o.topY ?? 1e5 },
    pbPaint: { value: new THREE.Vector3(tint[0], tint[1], tint[2]) },
    // (AR34 s6: the set's and the options' constants)
    pbUnit: { value: new THREE.Vector2(unit[0] > 0 ? F(unit[0]) : 0, unit[0] > 0 ? F(unit[1]) : 0) },
    pbBl: { value: new THREE.Vector3(...(sharp ? [0.42, 0.58, 1.4] : [0.25, 0.75, 0.5])) },
    pbRot: { value: new THREE.Vector4(...(rot ? [F(Math.cos(rot)), F(Math.sin(rot)), F(-Math.sin(rot)), F(Math.cos(rot))] : [1, 0, 0, 1])) },
    pbWorld: { value: world ? 1 : 0 },
    pbChips: { value: F(chips) }, pbRefL: { value: F(refL) },
    // the scan's paint: its colour's offset from its own grey (linear), its luminance; pbSubK 1 = the chips show the substrate
    pbScan: { value: new THREE.Vector4(...(paint ? T.paintMean.map((v) => v - scanL) : [0, 0, 0]), scanL) },
    pbSubK: { value: PB_CHIP && paint ? 1 : 0 },
    pbOver: { value: new THREE.Vector3(over ? F(0.5 + 0.17 * Math.sqrt(2) * erfinv(2 * over - 1)) : 0, F(refL), F(M.paintRough || 0.55)) },
    pbCavK: { value: T.alpha === 'height' ? 1 : 0 },
    pbGrimeC: { value: new THREE.Vector3(...(glazed ? [0.5, 0.49, 0.47] : [0.52, 0.49, 0.45])) },   // (soot on a glaze is grey)
    pbGlazed: { value: F(glazed) },
    pbRS: { value: new THREE.Vector3(roughSet ? F(roughSet[0]) : 0, roughSet ? F(roughSet[1]) : 1, roughSet ? 1 : 0) },
    pbRough: { value: F(rough) },
    pbMetal: { value: new THREE.Vector2(metal !== undefined ? F(metal) : 0, metal !== undefined ? 1 : 0) },
    pbNrmK: { value: F(nrmK) },
    // x: the facades' value curve; y: its dark toe for paint and metal; z: the dark paint's ST34 exemption
    pbFac: { value: new THREE.Vector3(facCal ? 1 : 0, city && (fam === 'paint' || fam === 'metal') ? 1 : 0, city && PB_STX && fam === 'paint' ? 1 : 0) },
  };
  const weV = dAttr ? 'vec4' : 'vec3';
  mat.onBeforeCompile = (sh, r) => {
    if (r && !_renderer) { _renderer = r; pump(); }
    Object.assign(sh.uniforms, U);
    sh.uniforms.pbCAO = ENV.cityAO; sh.uniforms.pbCAORect = ENV.cityAORect; sh.uniforms.pbNight = ENV.night;
    sh.uniforms.pbSt34 = ENV.st34 || { value: new THREE.Vector4(1, 0, 0, 0) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPbUv; varying vec3 vPbW; varying vec3 vPbWN;
        ${gAttr ? 'attribute float aGrime; varying float vPbG;' : ''}
        ${wAttr ? `attribute ${weV} aWeather; flat varying ${weV} vPbWe;` : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        {
          vec4 pbP = vec4(transformed, 1.0);
          vec3 pbNo = objectNormal;
          #ifdef USE_INSTANCING
            pbP = instanceMatrix * pbP; pbNo = mat3(instanceMatrix) * pbNo;
          #endif
          vPbW = (modelMatrix * pbP).xyz;
          vPbWN = normalize(mat3(modelMatrix) * pbNo);
          vPbUv = uv;
          ${gAttr ? 'vPbG = aGrime;' : ''}
          ${wAttr ? 'vPbWe = aWeather;' : ''}
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vPbUv; varying vec3 vPbW; varying vec3 vPbWN;
        ${gAttr ? 'varying float vPbG;' : ''}
        ${wAttr ? `flat varying ${weV} vPbWe;` : ''}
        float pbSd; float pbGy0; float pbDirtV;
        uniform sampler2D pbAlb; uniform sampler2D pbNrm; uniform sampler2D pbOrm;
        uniform vec2 pbSize; uniform vec3 pbRatio; uniform float pbSeed; uniform float pbDirt; uniform float pbBaseY; uniform float pbTopY;
        uniform sampler2D pbCAO; uniform vec4 pbCAORect; uniform vec3 pbPaint; float pbPv; uniform float pbNight;
        float pbDk = 1.0; uniform vec4 pbSt34;
        uniform vec2 pbUnit; uniform vec3 pbBl; uniform vec4 pbRot; uniform float pbWorld; uniform float pbChips; uniform float pbRefL;
        uniform vec4 pbScan; uniform float pbSubK; uniform vec3 pbOver; uniform float pbCavK; uniform vec3 pbGrimeC; uniform float pbGlazed;
        uniform vec3 pbRS; uniform float pbRough; uniform vec2 pbMetal; uniform float pbNrmK; uniform vec3 pbFac;
        ${NOISE_GLSL}
        ${city ? CITY_GLSL : ''}
        vec4 pbA; vec3 pbNt; vec4 pbO; float pbGr; vec2 pbST;
        // two taps of the set at pattern-snapped offsets chosen by a low-frequency noise (the repeat never lines up)
        vec2 pbOff(float i) {
          vec2 h = pbH22(vec2(i * 7.13 + pbSd * 0.37, i * 3.71 - pbSd * 0.11));
          return pbUnit.x > 0.0 ? floor(h / pbUnit) * pbUnit : h;
        }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        pbSd = pbSeed${wAttr ? ' + vPbWe.x' : ''};
        pbDirtV = ${dAttr ? '(vPbWe.w < 0.0 ? pbDirt : vPbWe.w)' : 'pbDirt'};
        vec3 wn = normalize(vPbWN);
        vec2 m;
        if (pbWorld > 0.5) {
          if (abs(wn.y) > 0.7) m = vec2(vPbW.x, -vPbW.z);
          else { vec2 t = normalize(vec2(wn.z, -wn.x)); m = vec2(dot(vPbW.xz, t), vPbW.y); }
        } else m = vPbUv;
        m = mat2(pbRot.x, pbRot.y, pbRot.z, pbRot.w) * m;
        pbST = m / pbSize;
        // KTX2 data is not flipped on upload (the stored top row is at t = 0): sample at (s, -t) so up the surface is up
        // the image, and the normal map's +Y (green) runs along +t, the frame's B below
        vec2 st = vec2(pbST.x, -pbST.y);
        vec2 gx = dFdx(st), gy = dFdy(st);
        float kx = pbN(st * 0.43 + vec2(pbSd * 1.7, pbSd * 0.3)) * 6.0;
        float ia = floor(kx), fb = fract(kx);
        vec2 oa = pbOff(ia), ob = pbOff(ia + 1.0);
        vec4 a0 = textureGrad(pbAlb, st + oa, gx, gy), a1 = textureGrad(pbAlb, st + ob, gx, gy);
        vec4 o0 = textureGrad(pbOrm, st + oa, gx, gy), o1 = textureGrad(pbOrm, st + ob, gx, gy);
        // (brick sets switch layers along the joints: a sharp blend)
        float w = smoothstep(pbBl.x, pbBl.y, fb + (o1.a - o0.a) * pbBl.z);
        pbA = mix(a0, a1, w);
        pbO = mix(o0, o1, w);
        pbNt = mix(textureGrad(pbNrm, st + oa, gx, gy).xyz, textureGrad(pbNrm, st + ob, gx, gy).xyz, w) * 2.0 - 1.0;
        vec3 alb = pbA.rgb;
        ${paint ? `
        // paint over a chipped substrate: the paint takes the tint (its own light and dark kept), chips show the substrate
        float pm = 1.0 - (1.0 - pbO.a) * pbChips;
        vec3 pc = pbRatio * pbLum(alb);${city ? `
        // the scan's own paint is mottled (stains under the green): half of its light and dark is kept
        pc *= mix(pbRefL / max(pbLum(alb), 1e-3), 1.0, 0.55);` : ''}
        // the substrate: the scan with its own paint's colour taken out where the scan is paint (pbO.a), grey primer under
        // the green, the rust kept
        vec3 sub = alb;
        if (pbSubK > 0.5) sub = max(alb - pbScan.rgb * (pbLum(alb) / max(pbScan.a, 1e-3)) * pbO.a, vec3(0.0));
        alb = mix(sub, pc, pm);` : 'alb *= pbRatio;'}
        pbPv = 0.0;
        ${over ? `
        {
          // worn paint over the substrate, in world space (abutting pieces continue): wear from two noise scales, the
          // threshold (pbOver.x) set so the share of the surface the material's cover asks keeps its paint
          float wr = pbF(vPbW.xz * 1.3 + pbSd * 2.1) * 0.62 + pbF(vPbW.xz * 11.0 - pbSd) * 0.38;
          float thr = pbOver.x;
          pbPv = 1.0 - smoothstep(thr - 0.035, thr + 0.035, wr);
          vec3 pc = pbPaint * mix(1.0, pbLum(alb) / max(pbOver.y, 1e-3), 0.22);
          alb = mix(alb, pc, pbPv);
        }` : ''}
        // large-scale tone drift in world space (a wall is never one flat colour at 20 m), seeded per building
        {
          vec3 wp = vPbW + pbSd * 13.7;
          float mv = pbF(vec2(dot(wp.xz, vec2(0.71, 0.70)) * 0.21, wp.y * 0.17)) - 0.5;
          alb *= 1.0 + mv * 0.16;
          alb = mix(alb, alb * vec3(1.03, 1.0, 0.96), clamp(pbF(wp.xz * 0.09 + wp.y * 0.05) - 0.4, 0.0, 1.0) * 0.6);
        }
        // the street's height here (the splash zone and the street canyon are measured from it)
        pbGy0 = ${wAttr ? 'vPbWe.y' : 'pbBaseY'};
        ${!street ? `
        if (pbGy0 < -9000.0) {
          pbGy0 = 0.0;
          if (pbCAORect.z > 0.0) pbGy0 = texture2D(pbCAO, (vPbW.xz - pbCAORect.xy) * pbCAORect.zw).g * 127.5;
        }` : ''}
        // weathering
        pbGr = 0.0;
        ${!street ? `
        if (pbDirtV > 0.0) {
          float gy0 = pbGy0;
          float h = vPbW.y - gy0;
          float up = wn.y;
          vec2 tw = normalize(vec2(wn.z, -wn.x) + 1e-5);
          float uw = dot(vPbW.xz, tw);
          float nz = pbF(vec2(uw * 1.9, h * 1.3) + pbSd * 3.1);
          // splash zone: 0-0.6 m dark and grey, a softer band to ~2.5 m, the edge ragged
          float sp = 1.0 - smoothstep(0.05, 0.62, h + (nz - 0.5) * 0.3);
          float bs = 1.0 - smoothstep(0.4, 2.6, h + (nz - 0.5) * 0.6);
          // vertical run-off streaks: world noise stretched 25x along the fall line, stronger under openings (aGrime)
          float sk = pbN(vec2(uw * 2.6 + pbSd * 5.3, h * 0.11)) * 0.65 + pbN(vec2(uw * 7.9 - pbSd, h * 0.35)) * 0.35;
          float streak = smoothstep(0.56, 0.86, sk) * (0.55 + 0.45 * pbN(vec2(uw * 0.7, h * 0.05 + pbSd)));
          ${gAttr ? 'streak = max(streak, clamp(vPbG, 0.0, 1.0) * (0.45 + 0.55 * smoothstep(0.35, 0.8, sk)));' : ''}
          streak *= 1.0 - abs(up);
          // soot under the roof line
          float topY = ${wAttr ? 'vPbWe.z' : 'pbTopY'};
          float soot = smoothstep(topY - 3.5, topY - 0.25, vPbW.y + (nz - 0.5) * 1.2) * step(vPbW.y, topY + 0.5);
          // dust on ledges (up-facing), dark soffits (down-facing)
          float ledge = smoothstep(0.55, 0.9, up) * 0.55, soff = smoothstep(0.55, 0.9, -up) * 0.35;
          // dirt settles in the recesses (mortar joints, chips): the ORM height channel (pbCavK 1: the set has one)
          float cav = mix(0.5, 1.0 - pbO.a, pbCavK);
          // AR34 w2: soot in patches over the whole wall (a 125th Street facade is never clean between its sills: the
          // Hotel Theresa crop's grey smudges, wider than tall, broken up at the brick scale)
          float pt = smoothstep(0.5, 0.82, pbF(vec2(uw * 0.42, h * 0.85) + pbSd * 4.7)) * (0.55 + 0.45 * pbN(vec2(uw * 3.1, h * 2.3) - pbSd));
          float g = sp * 0.55 + bs * 0.18 + streak * 0.30 + soot * 0.28 + ledge + soff + cav * 0.14 + pt * ${PBR_SOOT ? '0.9' : '0.0'};
          g *= pbDirtV * (0.8 + 0.4 * pbH12(vec2(pbSd, 7.7)));
          g = clamp(g, 0.0, 0.85);
          pbGr = g;
          float L = pbLum(alb);
          vec3 grime = mix(vec3(L), alb, 0.55) * pbGrimeC;
          alb = mix(alb, grime, g);
        }` : `
        if (pbDirtV > 0.0) {
          // oil and wear blotches; the curb-side gutter grime is STREET's to place
          float bl = pbF(vPbW.xz * 0.35 + pbSd * 1.3);
          float g = smoothstep(0.55, 0.85, bl) * 0.35 * pbDirtV;
          ${M.gum ? `
          // chewing-gum spots: flattened grey discs, 8-20 mm, a few per square metre, faded by the pixel footprint
          {
            vec2 gc = vPbW.xz / 0.23; vec2 ci = floor(gc), cf = fract(gc);
            vec2 hh = pbH22(ci + 11.3);
            float on = step(0.78, pbH12(ci * 1.37 + 4.1));
            float rr = mix(0.035, 0.085, hh.y);
            float d = length(cf - (0.2 + 0.6 * hh));
            float fw = max(fwidth(gc.x), 1e-4);
            float spot = on * (1.0 - smoothstep(rr - fw, rr + fw, d)) * (1.0 - smoothstep(0.08, 0.3, fw));
            alb = mix(alb, vec3(0.075, 0.072, 0.07) * (0.8 + 0.5 * hh.x), spot * 0.85);
            pbO.g = mix(pbO.g, 0.55, spot);
          }` : ''}
          alb *= 1.0 - g;
          pbGr = g;
        }`}
        // THE SHADER FACADES' VALUE CURVE (world/materials.js makeFacadeMaterial: albedo = pow(albedo, 1.22) * 0.88, tuned
        // that factor is divided out here, so the net diffuse is the facades' own curve at every time of day and a wall
        // sits at the brightness of the shader facade beside it with the same colour. (pbFac.x: not for street surfaces
        // or a material given its own trim)
        if (pbFac.x > 0.5) {
          vec3 a0 = max(alb, vec3(0.0));
          pbDk = pbLum(a0);
          vec3 cv = pow(a0, vec3(1.22)) * 0.88;
          ${city ? `// paint and metal finishes (pbFac.y): the curve is not carried into the darks (under 0.1 it keeps its ratio at
          if (pbFac.y > 0.5) cv = mix(a0 * 0.531, cv, step(0.1, a0));` : ''}
          alb = cv / mix(0.30, 0.88, pbNight);
        }
        diffuseColor.rgb *= alb;
      }`)
      .replace('#include <lights_fragment_begin>', `${city ? `
        // AR34 w2 b5: a dark paint (pbFac.z) keeps its sheen under LOOK's ST34 specular trim (with it steel_black read
        // (19,19,18) against the real dark paint's (31,32,35), (28,28,26) without: board_w2r2/board_st34.jpg); CITY_GLSL
        // already puts the street, not the sky, in that sheen (the navy cast ST34 guards against). Paint albedos under ~0.1.
        if (pbFac.z > 0.5) {
          float pbStK = mix(mix(pbSt34.x, 1.0, pbNight), 1.0, 1.0 - smoothstep(0.12, 0.28, material.roughness));
          float pbUn = mix(1.0, 1.0 / max(pbStK, 0.05), 1.0 - smoothstep(0.06, 0.12, pbDk));
          material.specularColor *= pbUn;
          material.specularF90 = min(material.specularF90 * pbUn, 1.0);
          material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
        }` : ''}
        #include <lights_fragment_begin>`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float rr = (pbRS.z > 0.5 ? mix(pbRS.x, pbRS.y, pbO.g) : pbO.g) * pbRough;
          if (pbGlazed > 0.0) rr = mix(rr, max(rr, 0.72), pbGr * pbGlazed);
          else rr = mix(rr, min(1.0, rr + 0.12), pbGr);
          ${over ? 'rr = mix(rr, pbOver.z, pbPv);' : ''}
          roughnessFactor = clamp(rr, 0.04, 1.0);
        }`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = pbMetal.y > 0.5 ? pbMetal.x * (1.0 - pbGr * 0.6) : pbO.b;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // cotangent frame from the derivatives of the sampling coordinates (no tangent attribute needed)
          vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
          vec2 s0 = dFdx(pbST), s1 = dFdy(pbST);
          vec3 N = normal;
          vec3 q1p = cross(q1, N), q0p = cross(N, q0);
          vec3 Tt = q1p * s0.x + q0p * s1.x, Bt = q1p * s0.y + q0p * s1.y;
          float det = max(dot(Tt, Tt), dot(Bt, Bt));
          float sc = det == 0.0 ? 0.0 : inversesqrt(det);
          vec3 tn = pbNt; tn.xy *= pbNrmK * (1.0 - pbGr * 0.35) * (1.0 - pbPv * 0.45);
          if (sc > 0.0) normal = normalize(mat3(Tt * sc, Bt * sc, N) * tn);
        }`)
      .replace('#include <lights_fragment_end>', `${city ? `
        // the city in the reflection (CITY_GLSL): the environment's radiance along three's own lobe direction, the
        // lobe's share under the canyon's skyline taken by the city
        ${cityRadiance('vPbW.y - pbGy0')}` : ''}
        #include <lights_fragment_end>`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>
        {
          float ao = mix(1.0, pbO.r, 0.85);
          reflectedLight.indirectDiffuse *= ao;
          reflectedLight.indirectSpecular *= mix(1.0, ao, 0.6);
          reflectedLight.directDiffuse *= mix(1.0, ao, 0.25);
        }`);
  };
  // the program: one per structure (PB_PROG); ?pbprog=0 one per set and option set, as before AR34 s6
  const key = PB_PROG
    ? ['pbr', 's6', paint ? 'p' : '-', over ? 'o' : '-', street ? 'st' : 'w', M.gum ? 'gum' : '-', gAttr ? 'ga' : '-', wAttr ? (dAttr ? 'wd' : 'we') : '-', city ? 'c1' : 'c0'].join('|')
    : ['pbr', k, paint, fam, world, gAttr, wAttr, dAttr, rot, unit.join(','), sharp, roughSet, rough, metal, nrmK, glazed, chips, M.gum ? 1 : 0, over, M.paintRough || 0, facCal, city ? 'c1' : 'c0', PB_STX ? 'st5' : 'st0'].join('|');
  mat.customProgramCacheKey = () => key;
  if (city) mat.userData.pbCity = true;   // (applyCityRefl leaves it alone)
  applyCityAO(mat);
  applyLightTrim(mat, o.trim ?? (fam === 'street' ? STREET_CAL : 1));
  // metals: applyLightTrim scales diffuseColor before the specular colour is derived from it, so a metal's reflectance
  // is crushed with its (non-existent) diffuse; the engine's analytic sky mirror puts the reflection back, as the
  // landmark metals do (world/materials.js applySkyMetal)
  if (fam === 'metal' && metal > 0.5) {
    let c = tint.map((v) => Math.min(1, v * 1.05 + 0.02));
    if (city) {
      // a dark anodised or coated frame still reflects 7 % or more (alu_black's 3 % mirror read as a black hole)
      const lc = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (lc < 0.07) c = c.map((v) => Math.min(1, (v * 0.07) / Math.max(lc, 1e-4)));
    }
    const pbKey = mat.customProgramCacheKey;
    applySkyMetal(mat, { tint: c, rough: Math.max(0.12, (T.roughMean ?? 0.3) * rough), brush: M.unit === 'dir' ? 0.55 : 0.2, gain: 0.4 });
    const skyKey = mat.customProgramCacheKey;   // applySkyMetal keys on the callback's source text: keep ours in front
    mat.customProgramCacheKey = () => pbKey.call(mat) + skyKey.call(mat);
    if (city) {
      // the city in the sky mirror too: applySkyMetal's reflection (world/materials.js) mirrors the analytic sky along the
      // brushed direction Rm; under the canyon's skyline it takes the city (left as it is if the pattern is not there)
      const obc = mat.onBeforeCompile;
      mat.onBeforeCompile = (sh, r) => {
        obc.call(mat, sh, r);
        sh.fragmentShader = sh.fragmentShader.replace('totalEmissiveRadiance += refl;',
          'refl = pbCity(refl, pbCityK(Rm, vPbW.y - pbGy0, 0.14));\n        totalEmissiveRadiance += refl;');
      };
    }
  }
  return mat;
}

// ---------------------------------------------------------------- glass
// (AR34 w2: the pane's parameters are uniforms, one program per opaque / street / room: the tower glasses had compiled
// one program per body colour, LOOK 19:07)
function makeGlass(n, o) {
  const G = GLASS[n];
  const tint = hexLin(o.tint || G.tint);
  const opq = !!G.opaque;
  const opacity = opq ? 1 : +(o.opacity ?? G.opacity);
  const dirt = +(o.dirt ?? G.dirt ?? 0.1);
  const body = hexLin(o.body || G.body || '#202428');
  // opts.f0: the coating's reflectance at normal incidence (clear float 0.04-0.05, a 1970s reflective bronze 0.2-0.3)
  const f0 = Math.min(0.6, Math.max(0.02, +(o.f0 ?? G.f0)));
  // the street in the glass (STREET_GLSL); opts.street: 0 = the sky with the old canyon term, a number > 1 = the distance
  // to the facing building line in metres (default 30.5, 125th Street)
  const street = PBR_CITY && !(o.street === 0 || o.street === false);
  const stW = typeof o.street === 'number' && o.street > 1 ? o.street : 30.5;
  // vision glass: the room behind (ROOM_GLSL); opts.room 0 = the body colour instead; opts.storey [h, y0] (m, y0 above
  // the street), opts.depth (m), opts.bay (m), opts.blinds (share of bays with a shade), opts.trans
  const room = opq && !!G.room && !(o.room === 0 || o.room === false);
  const sto = Array.isArray(o.storey) ? o.storey : [+(o.storey ?? 3.7), 0];
  // AR34 s6 (KIT 05:29): opts.tintAttr: the tint, the body and the dirt per vertex, so one material serves a set's every
  // colour: aFkTr (vec3, the tint over this material's tint, linear: the kit's shared-material ratio) and aPgBody (vec4: the
  // body, linear, and the dirt; a negative x or w: this material's own body or dirt)
  const cAttr = !!o.tintAttr;
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setRGB(tint[0], tint[1], tint[2]), roughness: G.rough, metalness: 0,
    transparent: !opq, opacity, depthWrite: opq, side: o.side ?? THREE.FrontSide,
  });
  if (!opq) {
    mat.blending = THREE.CustomBlending;
    mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
    mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;
  }
  const U = {
    pgF0: { value: f0 }, pgRough: { value: G.rough }, pgDirt: { value: dirt }, pgStW: { value: stW },
    pgBody: { value: new THREE.Vector3(body[0], body[1], body[2]) },
    pgRm: { value: new THREE.Vector4(+sto[0], +(sto[1] ?? 0), +(o.depth ?? 7), +(o.bay ?? 1.45)) },
    pgBl: { value: +(o.blinds ?? 0.85) }, pgTr: { value: +(o.trans ?? G.trans ?? 0.6) }, pgSd: { value: +(o.seed ?? 0) },
    pgShr: { value: Math.max(0, Math.min(1, +(o.sheers ?? 0))) }, pgGlow: { value: Math.max(0, +(o.glow ?? 0)) },
    pgSlk: { value: o.storey !== undefined ? 1 : 0 },
    // AR34 s6 (HPT 03:26): the share of the rooms lit at night (opts.lit; by day 0.85 of them have their lamps on)
    pgLit: { value: Math.max(0, Math.min(1, +(o.lit ?? PG_LIT))) },
    // opts.bayAt [x, z]: a world point where a bay starts (the caller's first mullion): the shade cells line up with the panes
    pgOrg: { value: new THREE.Vector3(...(Array.isArray(o.bayAt) ? (o.bayAt.length >= 3 ? [+o.bayAt[0], 0, +o.bayAt[2]] : [+o.bayAt[0], 0, +o.bayAt[1]]) : [0, 0, 0])) },
  };
  mat.onBeforeCompile = (sh, r) => {
    if (r && !_renderer) { _renderer = r; pump(); }
    Object.assign(sh.uniforms, U);
    sh.uniforms.uRefl = ENV.reflGain; sh.uniforms.uSunD = ENV.sunDir; sh.uniforms.uSunC = ENV.sunColor;
    sh.uniforms.uZenC = ENV.skyAmbient; sh.uniforms.uHorC = ENV.fogColor; sh.uniforms.pgNight = ENV.night;
    sh.uniforms.pgCAO = ENV.cityAO; sh.uniforms.pgCAORect = ENV.cityAORect;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPgW;${cAttr ? '\n        attribute vec3 aFkTr; attribute vec4 aPgBody; flat varying vec3 vPgTr; flat varying vec4 vPgBo;' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        { vec4 pgP = vec4(transformed, 1.0);${cAttr ? '\n          vPgTr = aFkTr; vPgBo = aPgBody;' : ''}
          #ifdef USE_INSTANCING
            pgP = instanceMatrix * pgP;
          #endif
          vPgW = (modelMatrix * pgP).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vPgW;
        uniform float uRefl; uniform vec3 uSunD; uniform vec3 uSunC; uniform vec3 uZenC; uniform vec3 uHorC; uniform float pgNight;
        uniform sampler2D pgCAO; uniform vec4 pgCAORect;
        uniform float pgF0; uniform float pgRough; uniform float pgDirt; uniform float pgStW; uniform vec3 pgBody;
        uniform vec4 pgRm; uniform float pgBl; uniform float pgTr; uniform float pgSd; uniform float pgShr; uniform float pgGlow; uniform float pgSlk; uniform vec3 pgOrg;
        uniform float pgLit;${cAttr ? '\n        flat varying vec3 vPgTr; flat varying vec4 vPgBo;' : ''}
        ${SKYREFL_CHUNK}
        ${NOISE_GLSL}
        ${street || room ? STREET_GLSL : ''}
        ${room ? ROOM_GLSL : ''}
        vec3 pgRefl; float pgF; vec3 pgIn; vec3 pgNg; vec3 pgNf;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        // the pane's tint, body and dirt: the material's, or per vertex (opts.tintAttr)
        vec3 pgTint = diffuse${cAttr ? ' * vPgTr' : ''};
        vec3 pgBodyC = ${cAttr ? '(vPgBo.x < 0.0 ? pgBody : vPgBo.rgb)' : 'pgBody'};
        float pgDirtV = ${cAttr ? '(vPgBo.w < 0.0 ? pgDirt : vPgBo.w)' : 'pgDirt'};
        // the pane's normal: the interpolated vertex normal (AR34 w2: the derivative normal of the world position is
        // noisy per pixel quad at 30 m (float world coordinates), and the room and street rays carry that noise tens of
        // metres out: grain); the derivative normal where a mesh has no normals
        vec3 Ng = normalize(cross(dFdx(vPgW), dFdy(vPgW)));
        #ifndef FLAT_SHADED
        { float nl = length(vNormal); if (nl > 0.5) Ng = inverseTransformDirection(vNormal / nl, viewMatrix); }
        #endif
        vec3 Vg = normalize(cameraPosition - vPgW);
        if (dot(Ng, Vg) < 0.0) Ng = -Ng;
        // the face's own frame for the room's bays and the street's lots: the GEOMETRIC normal (vertex normals tilt per pane or
        // per corner: the kit's paneW, BID2's pillowing; ~3500 m from the origin u = dot(P, T) turns a 0.004 rad tilt into 14 m:
        // shards), from the camera-relative position's derivatives (precise), its azimuth snapped to 1/64 turn from the
        // street grid (29.07 deg) so every pixel of a face takes the same tangent and u is exact to the float
        vec3 Nf = Ng;
        ${street || room ? 'pgO = pgOrg;' : ''}
        ${PG_FRAME ? `{
          vec3 nv = cross(dFdx(vViewPosition), dFdy(vViewPosition));
          if (dot(nv, nv) > 1e-24) {
            vec3 nw = inverseTransformDirection(normalize(nv), viewMatrix);
            if (dot(nw, Vg) < 0.0) nw = -nw;
            if (abs(nw.y) < 0.8) {
              float az = atan(nw.z, nw.x);
              az = 0.50737 + floor((az - 0.50737) / 0.0981748 + 0.5) * 0.0981748;
              Nf = vec3(cos(az), 0.0, sin(az));
            } else Nf = nw;
          }
        }` : ''}
        pgNg = Ng; pgNf = Nf;
        vec3 Rg = reflect(-Vg, Ng);
        float cosT = max(dot(Vg, Ng), 0.0);
        pgF = fresnelR(cosT, pgF0);
        // a street-level pane mirrors the buildings opposite more than the sky: the canyon term of the shader facades
        float canyon = mix(0.38, 1.0, smoothstep(4.0, 45.0, vPgW.y));
        // the reflection's colour: a coated (opaque) unit's tint; see-through glass reflects nearly neutral (its body
        // tint colours what passes through, not the first surface: glass_grey had mirrored the street at 0.17)
        vec3 tn = ${opq ? 'pgTint' : 'mix(vec3(1.0), pgTint / max(max(pgTint.r, pgTint.g), max(pgTint.b, 1e-3)), 0.3)'};
        // a thin film of dirt and a faint wave in the float glass, both low frequency
        float film = pbF(vPgW.xz * 0.6 + vPgW.y * 0.4) * pgDirtV;
        vec3 Rw = normalize(Rg + (vec3(pbN(vPgW.xy * 1.7), 0.0, pbN(vPgW.zy * 1.7 + 3.1)) - 0.5) * 0.012);
        float gy = 0.0;
        if (pgCAORect.z > 0.0) gy = texture2D(pgCAO, (vPgW.xz - pgCAORect.xy) * pgCAORect.zw).g * 127.5;
        ${street ? `
        vec3 skyR = skyLook(Rw, uSunD, uSunC, uZenC, uHorC, uRefl, 1.4);
        skyR = mix(skyR, vec3(pbLum(skyR)), 0.3);   // (the 125th Street captures' skies are hazy, as CITY_GLSL's)
        pgRefl = pgStreet(vPgW, Rw, Nf, gy, pgStW, skyR, uHorC * (2.55 * uRefl), uSunD, pgNight) * tn * pgF * (1.0 - film * 0.5);
        canyon = pgSkyK;` : `
        pgRefl = skyLook(Rw, uSunD, uSunC, uZenC, uHorC, uRefl, 1.4) * tn * pgF * canyon * (1.0 - film * 0.5);
        canyon = 1.0;`}
        pgRefl += uSunC * tn * sunDisc(Rw, uSunD, pgRough + film * 0.1, length(fwidth(vPgW)) * 0.05) * pgF * 12.0 * uRefl * (1.0 - pgNight) * canyon;
        pgIn = vec3(0.0);
        ${opq && !room ? `
        // opts.glow: a lit room behind the opaque unit by night (a fritted or spandrel glass over a lit floor), per storey
        // and 9 m cell, 62 % of them on, warm, through the tint
        if (pgGlow > 0.0 && pgNight > 0.0) {
          vec3 Tq = normalize(vec3(-Nf.z, 0.0, Nf.x) + 1e-5);
          float onG = step(pbH12(vec2(floor(dot(vPgW - pgOrg, Tq) / 9.0), floor((vPgW.y - gy - pgRm.y) / pgRm.x)) + pgSd + 3.3), 0.62);
          pgIn = vec3(1.0, 0.86, 0.66) * pgGlow * onG * pgNight * (pgTint / max(max(pgTint.r, pgTint.g), max(pgTint.b, 1e-3)));
        }` : ''}
        ${room ? `
        // the room behind the glass, through the coated unit (its tint, its transmission), the film over it
        pgIn = pgRoom(vPgW, -Vg, Nf, gy, pbLum(uHorC * (2.55 * uRefl)), pgNight, pgRm, pgBl, pgSd, pgShr, pgSlk, pgLit)
          * (pgTint / max(max(pgTint.r, pgTint.g), max(pgTint.b, 1e-3))) * pgTr * (1.0 - film * 0.3);` : ''}
        ${opq ? `diffuseColor.rgb = pgBodyC * (1.0 + film * 0.6);
        diffuseColor.a = 1.0;` : `diffuseColor.rgb = pgTint * (0.04 + film * 0.25);
        diffuseColor.a = opacity + film * 0.12;`}
      }`)
      .replace('#include <opaque_fragment>', `
        ${street ? `// the pane's mirror is pgRefl alone: three's sky-only environment specular on top of it is the flat sheen
        outgoingLight = max(outgoingLight - totalSpecular, vec3(0.0));` : ''}
        ${room ? `gl_FragColor = vec4((pgIn + outgoingLight * 0.1) * (1.0 - pgF) + pgRefl, 1.0);` : opq ? (PG_BODY ? `
        {
          // the body is the building behind the coated unit, lit by the day through its windows, not by the sun on the pane
          // (lit as a wall, a light body read near white in the sun at street level: BID3's 100 W and 105 W, b5); a sunlit
          // face's rooms a little brighter (0.15 of the direct light)
          vec3 pgBodyL = reflectedLight.indirectDiffuse + reflectedLight.directDiffuse * 0.15 + totalEmissiveRadiance${street ? '' : ' + totalSpecular'};
          gl_FragColor = vec4((pgBodyL + pgIn) * (1.0 - pgF) + pgRefl, 1.0);
        }` : `gl_FragColor = vec4(outgoingLight * (1.0 - pgF) + pgRefl, 1.0);`) : `
        {
          float a = clamp(diffuseColor.a, 0.0, 1.0);
          float at = a + (1.0 - a) * pgF;
          gl_FragColor = vec4(outgoingLight * a + pgRefl, at);
        }`}
        ${PG_DBG === 1 ? 'gl_FragColor = vec4(vec3(pgF), 1.0);' : PG_DBG === 2 ? 'gl_FragColor.rgb = max(gl_FragColor.rgb - pgRefl, vec3(0.0));' : PG_DBG === 3 ? 'gl_FragColor.rgb = pgRefl;'
          : PG_DBG === 4 ? 'gl_FragColor = vec4(pgNg * 0.5 + 0.5, 1.0);' : PG_DBG === 5 ? 'gl_FragColor = vec4(pgNf * 0.5 + 0.5, 1.0);' : ''}`);
  };
  mat.customProgramCacheKey = () => 'pbrglass4|' + (opq ? 'o' : 't') + (street ? '|st' : '') + (room ? '|rm' : '') + (cAttr ? '|ca' : '');
  return mat;
}
