// The bridge kit's materials: the city's PBR library (city/mat/pbrLib.js: photogrammetry sets, world-space mapping, the
// light calibration and sky occlusion of the other kits) for paint, stone, concrete and the roadway, so a bridge reads
// like the buildings round it and Unreal swaps in the same sets at full resolution; and the night lights, whose glow
// follows the city's night uniform (dark fittings by day).
import * as THREE from 'three';
import { pbrMaterial } from '../mat/pbrLib.js';
import { stoneTextures } from './stoneTex.js';
import { ENV, applyLightTrim, applyCityAO } from '../../world/materials.js';

const cache = new Map();
const hexStr = (h) => '#' + (h >>> 0).toString(16).padStart(6, '0');
const once = (k, f) => { if (!cache.has(k)) { const m = f(); cache.set(k, m); } return cache.get(k); };
const W = { mapping: 'world' };

// painted structural steel in a bridge's own colour: an enamel over steel, a dielectric with a sheen (the city's other
// steel structures' response, city/w125eKit.js), with the city's light calibration and sky occlusion. The library's
// painted-metal scan is green paint over rust: under a pale bridge colour its rust read as dirt on every member, so the
// coat here is clean; `userData.pbr` names the painted-metal set for the renderers that bind their own sets to it.
function makePaint(hex, o, tag) {
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: o.rough ?? 0.52, metalness: o.metal ?? 0.22 })));
  // o.flood { y0, y1, k, col }: floodlit after dark (a tower's steel): the colour times a warm light strongest a little
  // over y0, fading toward y1 (the world position from the city AO's varying)
  if (o.flood) {
    const prev = m.onBeforeCompile, fl = o.flood, col = new THREE.Color(fl.col ?? 0xfff0d8);
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      sh.uniforms.brNightF = ENV.night;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float brNightF;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float fy = vCAOw.y;
          float fl = smoothstep(0.25, 0.75, brNightF) * smoothstep(${(fl.y0 ?? 0).toFixed(1)}, ${((fl.y0 ?? 0) + 15).toFixed(1)}, fy) * (1.0 - 0.7 * smoothstep(${((fl.y1 ?? 100) * 0.6).toFixed(1)}, ${(fl.y1 ?? 100).toFixed(1)}, fy));
          totalEmissiveRadiance += diffuseColor.rgb * vec3(${col.r.toFixed(3)}, ${col.g.toFixed(3)}, ${col.b.toFixed(3)}) * fl * ${(fl.k ?? 1.4).toFixed(2)};
        }`);
    };
  }
  const f = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => f() + '|' + tag + (o.flood ? '|flood' : '');
  m.name = `br:${tag}:` + hexStr(hex);
  m.userData.pbr = { name: 'metal_painted', opts: { tint: hexStr(hex), chips: 0.04 } };
  return m;
}
export const paint = (hex, o = {}) => once('paint' + hex + JSON.stringify(o), () => makePaint(hex, o, 'paint'));
// a lattice seen from far off (a truss's web on the coarse level): the paint's colour over the panel at the share of it the
// members cover, alpha-hashed (no sorting), so a truss reads as the dark band it is at a distance instead of a few posts
export const web = (hex, cover = 0.42) => once('web' + hex + cover, () => {
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.6, metalness: 0.15, transparent: false, alphaHash: true, opacity: cover, side: THREE.DoubleSide })));
  const f = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => f() + '|brWeb';
  m.name = 'br:web:' + hexStr(hex);
  m.userData.noShadow = false;
  return m;
});
// the web material of a paint material (its colour)
export const webOf = (mat, cover) => web(mat.color ? mat.color.getHex(THREE.SRGBColorSpace) : 0x777777, cover);
// cables and hangers: the paint, each vertex pushed out along its normal by about half a pixel's width at its distance,
// so a cable never draws thinner than a pixel (a 0.9 m cable at 2 km was a broken dotted line, or nothing); within a few
// hundred metres the push is a few centimetres. The geometry itself is untouched (what the packages hold).
export const cable = (hex, o = {}) => once('cable' + hex + JSON.stringify(o), () => {
  const m = makePaint(hex, o, 'cable');
  m.userData.brPx = o.px ?? 0.00042;   // (the push, for the renderers that draw the packages: tools/ue/r1c_cellmat2.py's cable master)
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `
      {
        vec4 cw = modelMatrix * vec4(transformed, 1.0);
        float cd = length(cw.xyz - cameraPosition);
        transformed += objectNormal * cd * ${(o.px ?? 0.00042).toFixed(5)};
      }
      #include <project_vertex>`);
  };
  return m;
});
// dressed stone: coursed ashlar from the kit's own generated maps (br/stoneTex.js: rock-faced or smooth-dressed blocks,
// recessed joints, each block's tone), read through uvs taken from the world (geom.js stoneize: the courses level with
// the ground, `scale` x 0.55 m high), and weathered per vertex (stoneize: the wet band over the water, soot streaks under
// the ledges `o.ledges`, a mottle over the walls); the faces are cut to `o.sub` metres so the weathering has vertices.
// The maps, the uvs and the vertex colours are what the packages carry, so every renderer draws the same stone.
// o: { style: 'rock' | 'dressed', ledges: [y...], wl: the water's height, sub: metres }
function makeStone(hex, scale, o, tag) {
  const T = stoneTextures(o.style || 'rock');
  // (the colour divided by the maps' mean and the weathering's, so the stone keeps the builder's colour on average)
  const c = new THREE.Color(hex), kc = 1 / (T.mean * 0.74);
  c.setRGB(Math.min(1, c.r * kc), Math.min(1, c.g * kc), Math.min(1, c.b * kc));
  const m = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ color: c, map: T.map, normalMap: T.normalMap, normalScale: new THREE.Vector2(1, 1),
    roughnessMap: T.ormMap, aoMap: T.ormMap, aoMapIntensity: 0.3, roughness: 1, metalness: 0, vertexColors: true })));
  { const b0 = new THREE.Color(hex); m.userData.brBase = { r: b0.r, g: b0.g, b: b0.b }; }   // (the builder's colour, for the silhouettes: tools/lod/bake_landmarks)
  m.userData.brStone = { course: 0.55 * scale, ledges: o.ledges || [], wl: o.wl ?? 0, sub: o.sub ?? 1.6, seed: o.seed ?? 3 };
  if (o.flood) {
    // floodlit after dark (the Brooklyn Bridge's towers): the stone's colour times a warm light strongest a little over
    // y0, fading toward y1
    const prev = m.onBeforeCompile, fl = o.flood, col = new THREE.Color(fl.col ?? 0xffd9a8);
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      sh.uniforms.brNight = ENV.night;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float brNight;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float fy = vCAOw.y;
          float fl = smoothstep(0.25, 0.75, brNight) * smoothstep(${(fl.y0 ?? 0).toFixed(1)}, ${((fl.y0 ?? 0) + 8).toFixed(1)}, fy) * (1.0 - 0.6 * smoothstep(${((fl.y0 ?? 0) + 15).toFixed(1)}, ${(fl.y1 ?? 80).toFixed(1)}, fy));
          totalEmissiveRadiance += diffuseColor.rgb * vec3(${col.r.toFixed(3)}, ${col.g.toFixed(3)}, ${col.b.toFixed(3)}) * fl * ${(fl.k ?? 1.6).toFixed(2)};
        }`);
    };
  }
  const f = m.customProgramCacheKey.bind(m);
  m.customProgramCacheKey = () => f() + '|brStone' + (o.flood ? '|flood' : '');
  m.name = `br:${tag}:${o.style || 'rock'}:` + hexStr(hex);
  return m;
}
export const ashlar = (hex, scale = 1.4, o = {}) => once('ash' + hex + scale + JSON.stringify(o), () => makeStone(hex, scale, o, 'stone'));
// the same stone lit by floodlights after dark: o.y0, o.y1, o.k, o.col (and the stone's own options)
export const ashlarLit = (hex, scale = 1.4, o = {}) => once('ashLit' + hex + scale + JSON.stringify(o), () =>
  makeStone(hex, scale, { ...o, flood: { y0: o.y0, y1: o.y1, k: o.k, col: o.col } }, 'stoneLit'));
export const granite = (hex) => once('gr' + hex, () => pbrMaterial('granite_grey', { ...W, tint: hexStr(hex), dirt: 0.25 }));
export const concrete = (hex = 0xa9a59c) => once('cc' + hex, () => pbrMaterial('concrete_smooth', { ...W, tint: hexStr(hex), dirt: 0.3 }));
export const asphalt = () => once('asph', () => pbrMaterial('asphalt_worn', { ...W }));
// the deck's lane lines: instances of their own (a seed the city's markings do not use), pulled forward in depth
const offset = (m) => { m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; return m; };
export const lineWhite = () => once('lw', () => offset(pbrMaterial('paint_thermo', { ...W, seed: 41 })));
export const lineYellow = () => once('ly', () => offset(pbrMaterial('paint_thermo_yellow', { ...W, seed: 41 })));
export const planks = (hex = 0x8a7458) => once('wood' + hex, () => pbrMaterial('wood_painted', { ...W, tint: hexStr(hex), chips: 0.4, rot: 90 }));
// HB25: the masonry bridges' granite on the neutral granite set (Unreal binds it to a grey granite scan whose colour is this
// tint; the library's granite_grey binds to a brown rubble wall). Unreal keeps one record per material name, so every bridge
// that uses it shares one tint (BR_GRANITE)
export const BR_GRANITE = 0x8f8a82;
export const graniteN = () => once('grN', () => pbrMaterial('amnh_granite', { ...W, tint: hexStr(BR_GRANITE), dirt: 0.25 }));
// HB25: a walkway's brick paving (the High Bridge's)
export const paving = (hex = 0x9a6a58) => once('pave' + hex, () => pbrMaterial('paving_brick', { ...W, tint: hexStr(hex) }));
export const galv = () => once('galv', () => pbrMaterial('steel_galvanized', { ...W }));

// a lamp or a light bulb: a dull fitting by day, its colour glowing after dark (ENV.night), never blinking
// (px: after dark the bulb is pushed out along its normals by px x its distance, so a necklace lamp stays a dot of light
// at a kilometre instead of vanishing under a pixel; by day the fittings keep their size)
export function glow(hex, k = 1, px = 0.0009) {
  return once('glow' + hex + k + px, () => {
    const m = new THREE.MeshStandardMaterial({ color: 0x3a3a38, roughness: 0.5, metalness: 0.2, emissive: new THREE.Color(hex), emissiveIntensity: k });
    m.name = 'br:glow:' + hexStr(hex);
    m.userData.noShadow = true;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.brNight = ENV.night;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float brNight;').replace('#include <project_vertex>', `
        {
          vec4 gw = modelMatrix * vec4(transformed, 1.0);
          transformed += objectNormal * length(gw.xyz - cameraPosition) * ${px.toFixed(5)} * smoothstep(0.25, 0.75, brNight);
        }
        #include <project_vertex>`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float brNight;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= smoothstep(0.25, 0.75, brNight);');
    };
    m.customProgramCacheKey = () => 'br:glow:' + px;
    return m;
  });
}
