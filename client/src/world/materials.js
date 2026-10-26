import * as THREE from 'three';
import { TILE } from '../shared/geo.js';
import { fasciaTexture } from '../city/fasciaAtlas.js';  // 2 x 16 slots of 512x64 (inlined in the GLSL below)
import { tq32Patch } from './tq32.js';   // TQ32: the Times Square towers' relief, weathering and sun occlusion (?tq32=0)
import { vgGroundPatch } from './vg36Ground.js';   // VG36 (GROUND): the lawn floor under the blades (world/vg36Ground.js)

// FS26 SKY-MATCHED FOG (owner 2026-09-25: golden hour "flat and low quality"). The far field faded into ONE colour per
// preset (golden: a warm beige, warmed again by the horizon tint below) while the analytic sky at the horizon is a
// neutral white away from the sun and a bright warm white toward it, so every aerial showed a tan band ending in a
// hard seam where fogged geometry met the sky. sky.js renders the sky dome into a 16-texel float strip after every sky
// change (8 azimuths just above the horizon, 8 at ~11 deg) and the fog fades toward THAT colour along each fragment's
// view direction: distance converges on the sky it stands against. The haze pass (engine.js) and the water use the
// same ring. A shader that includes the fog chunks without binding the ring reads fogSkyP = 0 and keeps the old colour.
// `?fs26=0` off.
export const FS26 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fs26') === '0');
export const FOG_SKY = { ring: new Float32Array(16 * 3), p: new Float32Array(4) };   // p: x on, y weight
export const FOG_SKY_GLSL = `
  uniform vec3 fogSkyRing[ 16 ];
  uniform vec4 fogSkyP;
  vec3 fogSkyColor( vec3 d, vec3 base ) {
    if ( fogSkyP.x < 0.5 ) return base;
    vec3 fd = normalize( d );
    float fa = ( atan( fd.z, fd.x + 1e-6 ) + 3.14159265 ) * 1.27323954;   // 0..8 round the horizon
    float fi = floor( fa ); float ff = fa - fi;
    int i0 = int( mod( fi, 8.0 ) ); int i1 = int( mod( fi + 1.0, 8.0 ) );
    vec3 lo = mix( fogSkyRing[ i0 ], fogSkyRing[ i1 ], ff );
    vec3 hi = mix( fogSkyRing[ i0 + 8 ], fogSkyRing[ i1 + 8 ], ff );
    return mix( base, mix( lo, hi, smoothstep( 0.02, 0.22, fd.y ) ), fogSkyP.y );
  }`;

// GLOBAL height fog (aerial perspective): override three's fog chunks BEFORE
// any material compiles — haze thickens toward street level and warms slightly
// at the horizon, hitting every fogged material (buildings, ground, trees,
// cars) from this one place.
THREE.ShaderChunk.fog_pars_vertex = `#ifdef USE_FOG
  varying float vFogDepth;
  varying float vFogWorldY;
  varying vec3 vFogDir;
#endif`;
THREE.ShaderChunk.fog_vertex = `#ifdef USE_FOG
  vFogDepth = - mvPosition.z;
  #ifdef USE_INSTANCING
    vec3 fogWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  #else
    vec3 fogWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
  #endif
  vFogWorldY = fogWP.y;
  vFogDir = fogWP - cameraPosition;
#endif`;
THREE.ShaderChunk.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  varying float vFogDepth;
  varying float vFogWorldY;
  varying vec3 vFogDir;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
  ${FOG_SKY_GLSL}
#endif`;
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogHeight = exp(-max(vFogWorldY - 6.0, 0.0) * 0.010);
    float fogD2 = fogDensity * mix(0.55, 1.45, fogHeight);
    float fogFactor = 1.0 - exp(-fogD2 * fogD2 * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  // FS26: the sky's own horizon colour along this view direction; without the ring, the preset colour warmed at the horizon
  vec3 fogCol3 = fogSkyP.x > 0.5 ? fogSkyColor(vFogDir, fogColor) : fogColor * mix(vec3(1.0), vec3(1.07, 1.02, 0.94), fogFactor);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol3, fogFactor);
#endif`;
// every built-in fogged shader binds the ring, by reference (three's cloneUniforms shares typed arrays), and so does
// any ShaderMaterial that merges UniformsLib.fog
if (FS26) {
  const fsU = () => ({ fogSkyRing: { value: FOG_SKY.ring }, fogSkyP: { value: FOG_SKY.p } });
  Object.assign(THREE.UniformsLib.fog, fsU());
  for (const sh of Object.values(THREE.ShaderLib)) if (sh && sh.uniforms && sh.uniforms.fogColor) Object.assign(sh.uniforms, fsU());
}

// Shared uniforms mutated by sky.js / streamer.
export const ENV = {
  night: { value: 0.0 },
  time: { value: 0 },
  fogColor: { value: new THREE.Color(0.78, 0.83, 0.9) },
  fogDensity: { value: 0.00011 },
  sunDir: { value: new THREE.Vector3(-0.5, 0.7, 0.3).normalize() },
  sunColor: { value: new THREE.Color(1.0, 0.93, 0.82) },
  skyAmbient: { value: new THREE.Color(0.5, 0.6, 0.75) },
  // weather bus (src/world/weather.js): shared by rain streaks, wet surfaces,
  // tree sway — one clock and one wetness so nothing drifts out of lockstep
  wet: { value: 0.0 },        // 0 dry .. 1 soaked
  snow: { value: 0.0 },       // 0 bare .. 1 blanketed
  windT: { value: 0.0 },      // wind clock (seconds, always running)
  windAmp: { value: 0.35 },   // breeze .. storm
  // city-scale sky occlusion (compile-time horizon bake, textures/cityao.bin):
  // R = sky visibility at street level, G = terrain height * 2. Scales
  // INDIRECT light only — canyon floors go moody, rooftops stay airy.
  cityAO: { value: null },
  cityAORect: { value: new THREE.Vector4(0, 0, 0, 0) }, // x0, z0, 1/w, 1/h
  cityAOAmt: { value: 0.85 },
  // ---- SPECULAR / REFLECTION GAIN (facades-r6 §0) -------------------------
  // The city's only reflection source used to be three's IBL, i.e.
  // getIBLRadiance() * envMapIntensity, and three r185 drives that uniform
  // from scene.environmentIntensity whenever material.envMap is null
  // (three.module.js:18690). lighting.md §2c cut scene.environmentIntensity
  // from 0.52 to 0.14 to fix a blue, flat ambient — which switched off every
  // glass reflection in Manhattan at the same time (critic r5 defect #2:
  // "NO SPECULAR REFLECTION ON ANYTHING", seven skyline frames, zero glints).
  // Reflections are therefore no longer taken from the IBL at all: the facade,
  // far-macro and landmark-glass/metal shaders answer the sky ANALYTICALLY
  // with this independent gain, so the ambient can be retuned freely.
  // ?refl=<x> scales it; ?refl=0 is the A/B that restores the r5 look.
  reflGain: { value: 1.0 },
  // LB13 — SILVER ROOF MEMBRANE ALBEDO TRIM (docs/notes/light-r13.md, critic r13 fix 3).
  // Multiplies the `kindR < 0.34` aged-silver-coating branch of the facade/roof shader and
  // nothing else (tar, gravel, EPDM, pavers, sedum and slate are already at reference values).
  // 1.0 restores the round-12 membrane; `?lb13=0` sets it back. Live-tunable for a measurement
  // session through window.__ENV.
  lbRoof: { value: 1.0 },
  // LB14 — GROUND CALIBRATION KNOBS (docs/notes/lb14.md, critic r14 fixes 2/3 + the paint half of 4).
  // The round-13 street calibration is ONE warm vec3 (1.94,1.70,1.47) on road + walk + terrain, and
  // it is the only warmth in a sunlit frame (the day sun saturates to neutral 0xfffcf7 at elev 42).
  // That structure cannot be right in both places at once: it warms the SHADE as well, which is why
  // the L30-70 band reads B-R -10..+5 against the reference crops' +17..+29 and the shaded Amsterdam
  // walk renders olive. LB14 splits it in three, neutralises the hue and puts the warmth back in the
  // SUN (sky.js PRESETS.day.sunW), so a frame can read R>B in sun and B>R in shade at the same time.
  //   lb14StCal  road (0/11/12) + terrain filler (7)      — luminance held at the r13 value
  //   lb14Walk   sidewalk (1)                             — neutral, and DARKER (see below)
  //   lb14Paint  thermoplastic (3/4), scaled by intact film coverage
  //   lb14Gao    how much of the baked city AO the GROUND plane takes back (RF13 exempted it)
  // All four are live-tunable from a measurement session through window.__ENV, all four lerp to the
  // r13 value at night, and `?lb14=0` restores the r13 row exactly.
  lb14StCal: { value: new THREE.Vector3(1.94, 1.70, 1.47) },
  lb14Walk: { value: new THREE.Vector3(1.94, 1.70, 1.47) },
  lb14Paint: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
  lb14Gao: { value: 0.0 },
  lb14Roof: { value: 0.0 },   // per-roof membrane value spread (0 = r13's single tone)
  lb14Road: { value: 0.0 },   // extra amplitude on the road's aperiodic repair mosaic (0 = r13)
  // FS26: the sky ring, for the shaders that take ENV as their uniforms (the water)
  fogSkyRing: { value: FOG_SKY.ring },
  fogSkyP: { value: FOG_SKY.p },
  // CS34 (applyCityAO): x the city's share of the reflection lobe, y of the environment's diffuse, z how much paler the
  // sky over the canyon reads, w unused; cs34Col: the street wall's colour (rgb) and level (a) against the sky's luminance
  cs34: { value: new THREE.Vector4(0, 0, 0, 0) },
  cs34Col: { value: new THREE.Vector4(1.0, 1.0, 0.97, 0.8) },
  // ST34 (applyLightTrim): x the day share of the specular left on a trimmed material (1 = untrimmed, as before)
  st34: { value: new THREE.Vector4(1, 0, 0, 0) },
  // GS35 (makeGroundMaterial): 1 = the ground's specular trim GND_spec reaches the BRDF (three r185 shades with
  // specularColorBlended, set inside lights_physical_fragment before the trim ran: GROUND's 06:20 finding), 0 = as before
  gs35: { value: typeof location !== 'undefined' && new URLSearchParams(location.search).get('gs35') === '0' ? 0 : 1 },   // `?gs35=0` off
  // RV35 (makeWaterMaterial): 1 = by day the river mirrors the far shore's buildings at low reflected elevations and takes
  rv35: { value: typeof location !== 'undefined' && new URLSearchParams(location.search).get('rv35') === '0' ? 0 : 1 },   // `?rv35=0` off
};
// LB14 — the DAY row of the four knobs above. sky.apply() writes these on `day` and the r13 row
// (LB14_R13) on golden/dusk/night, so every non-day preset stays bit-identical by construction and
// a measurement session can still sweep window.__ENV live between sky.apply() calls.
export const LB14_R13 = { stCal: [1.94, 1.70, 1.47], walk: [1.94, 1.70, 1.47], paint: [1, 1, 1], gao: 0, roof: 0, road: 0 };
export const LB14_DAY = {
  // same luminance (1.7389) as r13, R/B 1.32 -> 1.185 — HALF the neutralisation I first shipped.
  // Sunlit asphalt then reads R/B ~1.30 (Street View measures 1.08-1.27) and the shaded carriageway
  // keeps the value the r14 critic called exactly right; a full neutralisation to 1.08, combined with
  // the bounce cut, took the shaded roadway to linear B/R 7.22 against the reference 2.77.
  stCal: [1.94, 1.70, 1.47],   // LB14c: the r13 road hue — with the neutral fill it lands 68,86,105 vs the pano's 58,79,96
  // the walk has to UNDO its own base albedo, not just scale it: (0.496,0.437,0.261) was fitted in r13
  // to fight a blue ambient and is R/B 1.89 on its own. (1.20,1.33,1.64) -> effective (0.191,0.188,
  // 0.138), R/B 1.385 and 0.75x the r13 luminance: sunlit walk R/B ~1.65 (the reference sunlit
  // concrete, 229,214,192, is 1.49 — deliberately on the warm side of it), shaded walk B > R, and
  // walk-minus-road +26 -> ~+7 luma (measured on amst120N_day: walk L 104 / road L 78, reference +6..+7).
  walk: [1.02, 1.04, 1.12],    // LB14c: near-neutral, a touch of blue. Sweep4 row D at 1.30: walk L 100 vs road 83 (+17); at 1.18 the c_street plate read 84,101,107 L 98 vs road 79 (+19, greenish) against the pano walk 67,87,105 L 78 — one more step down and bluer
  // thermoplastic never took the street lift at all: m 3/4 fell through every branch of the r13
  // calibration, so intact white film sat at 1.5x the road's effective albedo where a real crossing is
  // 6-7x. Measured on amst120N_day: the lane line is L 92 on an L 72 road, i.e. +20 luma where AgX at
  // that level should give +55-65.
  paint: [2.20, 2.17, 2.13],
  // gao 0 (LB14, after sweep 3): re-enabling the baked city AO on the street plane HALVES a canyon
  // ground's indirect diffuse (caoF = mix(1, cao, 0.85) on a bake value near 0.35, about -1.1 stops —
  // the shaded carriageway fell from L 78 to L 51) and it cannot separate a walk from its roadway
  // anyway: the bake is 2048 px over 29.4 x 40.6 km = 14.3 x 19.8 m per texel. The shader gate stays
  // in (one uniform, live-tunable) but ships OFF; the sidewalk fix rides entirely on `walk` above.
  gao: 0.0,
  roof: 1.0,                   // per-roof membrane value/speckle spread + a wider coating blotch
  road: 0.85,                  // extra amplitude on the (zero-mean) aperiodic repair mosaic
};
export const LB14 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('lb14') === '0');
export function applyLB14Ground(day) {
  const r = LB14 && day ? LB14_DAY : LB14_R13;
  ENV.lb14StCal.value.fromArray(r.stCal);
  ENV.lb14Walk.value.fromArray(r.walk);
  ENV.lb14Paint.value.fromArray(r.paint);
  ENV.lb14Gao.value = r.gao;
  ENV.lb14Roof.value = r.roof;
  ENV.lb14Road.value = r.road;
}
if (typeof location !== 'undefined') {
  const rq = new URLSearchParams(location.search).get('refl');
  if (rq !== null && rq !== '') ENV.reflGain.value = Math.max(0, parseFloat(rq) || 0);
  // LB13: the trim is ON by default and `?lb13=0` restores the round-12 value.
  if (new URLSearchParams(location.search).get('lb13') !== '0') ENV.lbRoof.value = 0.78;
  if (typeof window !== 'undefined') window.__ENV = ENV;   // LB13 debug/A-B handle, same contract as window.__GFX
}
{ // 1x1 white placeholder so the sampler is bindable before the bake loads
  const t = new THREE.DataTexture(new Uint8Array([255, 255]), 1, 1, THREE.RGFormat);
  t.needsUpdate = true;
  ENV.cityAO.value = t;
}
// NM24 (owner 2026-09-24: "building faces sometimes get lost or disappear"). The far LoD (the macro buildings and the
// macro terrain) was discarded inside a fixed circle of 0.82 x NEAR_R round the player as soon as five near tiles
// EXISTED, loading ones included. Wherever a near tile was still being fetched or assembled, neither representation drew,
// so whole blocks and their ground went missing after a teleport or a fast move. Past the circle both drew over the same
// footprints, and the macro box sits up to 8 m off its near twin (its 0.996 shrink is about the macro origin), so facades
// traded places as the circle moved with the camera. Now a NEAR_MASK_N x NEAR_MASK_N mask centred on the player's tile
// marks the near tiles that are READY (streamer.js), and a far fragment is dropped exactly where a ready near tile covers
// it: never both, never neither. ?nmask=0 restores the circle.
export const NEAR_MASK_N = 16;
const NM24 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('nmask') === '0');
const nearMaskTex = new THREE.DataTexture(new Uint8Array(NEAR_MASK_N * NEAR_MASK_N), NEAR_MASK_N, NEAR_MASK_N, THREE.RedFormat, THREE.UnsignedByteType);
nearMaskTex.magFilter = nearMaskTex.minFilter = THREE.NearestFilter;
nearMaskTex.generateMipmaps = false;
nearMaskTex.needsUpdate = true;
export const FAR_UNIFORMS = {
  playerXZ: { value: new THREE.Vector2(0, 0) }, nearR: { value: 0 },
  nearMask: { value: nearMaskTex }, nearMaskO: { value: new THREE.Vector2(-1e5, -1e5) }, nearMaskOn: { value: NM24 ? 1 : 0 },
};
// declared after `playerXZ` and `nearR` in both far shaders (the macro buildings and the ground's far terrain, matId 8)
// and in the label passes' far clip (perception/segRender.js)
export const NEARMASK_GLSL = `
        uniform sampler2D nearMask; uniform vec2 nearMaskO; uniform float nearMaskOn;
        bool farHidden(vec2 xz) {
          if (nearMaskOn < 0.5) return distance(xz, playerXZ) < nearR;
          vec2 t = floor(xz / ${TILE}.0) - nearMaskO;
          if (t.x < 0.0 || t.y < 0.0 || t.x >= ${NEAR_MASK_N}.0 || t.y >= ${NEAR_MASK_N}.0) return false;
          return texture2D(nearMask, (t + 0.5) / ${NEAR_MASK_N}.0).r > 0.5;
        }`;

// The program cache key of a wrapped material. three shares ONE compiled program between materials whose keys match,
// and these wrappers keyed on String(prev), the source text of the onBeforeCompile they wrap, which is the same for
// every material a given wrapper wraps: a stone material wrapped in applyCityAO and applyLightTrim had the key of the
// metal and matte ones beside it (docs/notes/bryant-park.md, "a shared-program trap"), and whichever compiled first
// lent the others its shader. A custom key already on the material (applyStoneDetail's, applySpecAA's, a kit's own) is
// chained now; only a material with three's default key falls back to the source text, which is what it was before.
const BASE_KEY = THREE.Material.prototype.customProgramCacheKey;
function wrappedKey(mat, prev, prevKey) {
  return prevKey && prevKey !== BASE_KEY ? prevKey.call(mat) : (prev ? String(prev) : '');
}

// Snow-cap any lit material: up-facing fragments whiten with ENV.snow. Uses
// the fully-transformed VIEW-SPACE normal, so it's correct for skinned rigs,
// instanced cars/peds/furniture and static props alike with zero vertex work.
// Composes with an existing onBeforeCompile (tree crowns, etc).
export function applySnowCap(mat, amount = 1) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const std = !!mat.isMeshStandardMaterial;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.snowCapA = ENV.snow;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float snowCapA;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      {
        float upD = dot(normal, normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz));
        float capM = snowCapA * ${amount.toFixed(2)} * smoothstep(0.4, 0.75, upD);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.87, 0.9, 0.94), capM);
        ${std ? 'roughnessFactor = mix(roughnessFactor, 0.62, capM);' : ''}
      }`);
  };
  mat.customProgramCacheKey = () => wrappedKey(mat, prev, prevKey) + '|snowcap' + amount + std;
  mat.needsUpdate = true;
  return mat;
}

// Light trim for plain MeshStandardMaterial geometry (landmarks, campus kit,
// props). The sun/sky in this scene are hot by design and every custom shader
// trims its albedo to match — the ground by `mix(0.30, 0.88, night)`, the
// facades by their global value calibration. A standard material gets the raw
// light, so a 0.27-albedo granite tread or a limestone wall clipped to pure
// white at noon (Low Library, the plaza steps, the ramp plates). Same curve as
// the ground: 0.30 by day, relaxing to 0.88 at night when lights are dim.
// `scale` may be a number or an [r, g, b] array: props standing ON the street
// pass the ground's warm calibration (1.94, 1.70, 1.47) so they match the flags
// they sit in (street audit round 3 §5) — a flat trim left every prop cooler and
// darker than the pavement.
// ST34 (LOOK, AR34 wave 2; VIADUCTS 19:06): the trim scaled the diffuse to 0.30 by day and left the specular whole, so on
// a dark paint, iron or a matte metal the sheen outweighed the paint 3:1 (the Manhattan Valley arch's lit chord read
// trimmed material takes ENV.st34.x of itself by day (the dielectric F0 and the F90; a metal's F0 is its trimmed colour
// already), back to whole at night; smooth glass-like surfaces keep their mirror (untouched under roughness 0.12, the
// whole trim from 0.28).
// `?st34=0`: untrimmed.
export const ST34 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('st34') === '0');
export function applyLightTrim(mat, scale = 1) {
  const sc = Array.isArray(scale) ? scale : [scale, scale, scale];
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  const st = ST34 && !!mat.isMeshStandardMaterial;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.ltNight = ENV.night;
    if (st) sh.uniforms.st34 = ENV.st34;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float ltNight;' + (st ? '\nuniform vec4 st34;' : ''))
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(0.30, 0.88, ltNight) * vec3(${sc.map((v) => v.toFixed(3)).join(', ')});`);
    if (st) sh.fragmentShader = sh.fragmentShader.replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
      {
        float stK = mix(mix(st34.x, 1.0, ltNight), 1.0, 1.0 - smoothstep(0.12, 0.28, material.roughness));
        material.specularColor *= stK;
        material.specularF90 *= stK;
        material.specularColorBlended = mix(material.specularColor, diffuseColor.rgb, metalnessFactor);
      }`);
  };
  mat.customProgramCacheKey = () => wrappedKey(mat, prev, prevKey) + '|lighttrim' + sc.join(',') + (st ? '|st34' : '');
  mat.needsUpdate = true;
  return mat;
}

// CS34 (LOOK, AR34 wave 2; BID4 19:02, MATS 19:20, KIT 19:30: dark paint, iron and metal panels read navy in shade by
// day). The environment is the sky alone, so the reflection lobe of a wall, a cornice or a frame at street level saw open
// sky where the real one sees the buildings across the street: a 0.04 Fresnel on a bright blue sky outweighs the diffuse
// skyline (seen from this height: ~33 deg at the sidewalk, the horizon from ~32 m up; MATS's pbCityK, so the city's
// materials agree) the lobe takes the street wall instead, a near-neutral grey at cs34Col.a (0.8) of the sky's luminance
// (MATS's 0.55 took the shaded 125th plates' medians down 2-8 levels: shots/ar34/look/b2day c120, s120), and the
// environment's diffuse takes the same colour at the sky's level. ENV.cs34 drives both (sky.js sets them by preset);
// MATS's own materials (userData.pbCity) keep their own reflection edit and take only the diffuse half. `?cs34=0`: off.
export const CS34 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cs34') === '0');
const CS34_GLSL = (spec) => `
      if (cs34.x + cs34.y > 0.0) {
        float csH = vCAOw.y;
        if (cityAORect.z > 0.0) csH -= texture2D(cityAO, (vCAOw.xz - cityAORect.xy) * cityAORect.zw).g * 127.5;
        float csHz = 0.55 * (1.0 - smoothstep(2.0, 32.0, csH));
        ${spec ? `#if defined( RE_IndirectSpecular )
        {
          vec3 csR = normalize(mix(reflect(-geometryViewDir, geometryNormal), geometryNormal, pow4(material.roughness)));
          vec3 csRw = transformDirectionByInverseViewMatrix(csR, viewMatrix);
          float csW = 0.1 + 0.55 * material.roughness * material.roughness;
          float csK = smoothstep(csHz - csW, csHz + csW, csRw.y);
          float csL = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
          vec3 csSky = mix(radiance, vec3(csL), cs34.z);
          radiance = mix(radiance, mix(csL * cs34Col.a * cs34Col.rgb, csSky, csK), cs34.x);
        }
        #endif` : ''}
        {
          vec3 csNw = transformDirectionByInverseViewMatrix(geometryNormal, viewMatrix);
          float csKd = smoothstep(csHz - 0.75, csHz + 0.75, csNw.y);
          float csLd = dot(iblIrradiance, vec3(0.2126, 0.7152, 0.0722));
          iblIrradiance = mix(iblIrradiance, mix(csLd * cs34Col.rgb, iblIrradiance, csKd), cs34.y);
        }
      }
`;

// City-scale AO on any MeshStandardMaterial: samples the baked sky-visibility
// field by world XZ and scales indirect diffuse/specular. Fragments fade to
// full ambient with height above LOCAL TERRAIN (G channel) so towers escape
// their own street's gloom. Composes with existing onBeforeCompile.
export function applyCityAO(mat) {
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.cityAO = ENV.cityAO;
    sh.uniforms.cityAORect = ENV.cityAORect;
    sh.uniforms.cityAOAmt = ENV.cityAOAmt;
    sh.uniforms.lb14Gao = ENV.lb14Gao;           // LB14 — the STREET plane takes the bake back (day only)
    if (N11) sh.uniforms.caoNight = ENV.night;   // N11 — see the height ramp below
    const cs = CS34 && !!mat.isMeshStandardMaterial;   // CS34: radiance, iblIrradiance and material.roughness exist there
    if (cs) { sh.uniforms.cs34 = ENV.cs34; sh.uniforms.cs34Col = ENV.cs34Col; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCAOw; varying vec3 vCAOn;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      {
        vec4 caoP = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          caoP = instanceMatrix * caoP;
        #endif
        vCAOw = (modelMatrix * caoP).xyz;
        // RF13: the world-space geometric normal, so an UP-facing surface (a roof deck) can skip the bake — the 14 x 20 m
        // cells of a street-level sky-visibility bake drew as blocky dark squares on every membrane (owner 2026-09-16)
        vec3 caoN = objectNormal;
        #ifdef USE_INSTANCING
          caoN = mat3(instanceMatrix) * caoN;
        #endif
        vCAOn = normalize(mat3(modelMatrix) * caoN);
      }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vCAOw; varying vec3 vCAOn;
        uniform sampler2D cityAO; uniform vec4 cityAORect; uniform float cityAOAmt;
        uniform float lb14Gao;   // LB14
        ${cs ? 'uniform vec4 cs34; uniform vec4 cs34Col;' : ''}
        ${N11 ? 'uniform float caoNight;' : ''}`)
      .replace('#include <lights_fragment_end>', `${cs ? CS34_GLSL(!mat.userData.pbCity) : ''}#include <lights_fragment_end>
      if (cityAORect.z > 0.0) {
        vec2 caoUV = (vCAOw.xz - cityAORect.xy) * cityAORect.zw;
        vec2 caoS = texture2D(cityAO, caoUV).rg;
        float caoHgt = vCAOw.y - caoS.g * 127.5;      // height above local street
        float cao = mix(caoS.r, 1.0, smoothstep(6.0, 46.0, caoHgt));
        // RF13: roofs and other up-facing decks see the sky — no baked street AO.
        // LB14 (docs/notes/lb14.md): that exemption also fired on the STREET PLANE ITSELF (n.y = 1),
        // so a sidewalk tucked against a 20-storey wall took exactly the same sky fill as the middle
        // of the avenue — which is most of critic r14 #3 (sidewalk 27-52 luma over the road in shade
        // against the reference crop's +6..+7) and part of why the shade has no depth. The height ramp
        // above already hands a roof its sky back by 46 m, so the exemption only has to start ABOVE
        // the street. lb14Gao is 0 outside the day preset, so golden/dusk/night are bit-identical.
        cao = mix(cao, 1.0, smoothstep(0.55, 0.8, vCAOn.y) * mix(1.0, smoothstep(1.2, 5.0, caoHgt), lb14Gao));
        ${N11 ? `
        // N11 — AFTER DARK THE HEIGHT RAMP RUNS THE WRONG WAY (night-r11.md 1.6).
        // This bake is SKY VISIBILITY, and the ramp above exists because a tower's
        // upper floors see more sky than its canyon floor does — true at noon, and
        // exactly inverted at night, when the ambient is the street lighting and the
        // shopfronts and the sky is the dim half. Left alone it lit a Harlem walk-up
        // uniformly from pavement to cornice, which is most of why a night frame read
        // as an overcast afternoon rather than as night. Above ~4 m the indirect term
        // falls away with height instead of opening up; the sky-glow share that a
        // roof really does keep is the 0.42 floor.
        float caoUp = mix(1.0, 0.42, smoothstep(4.0, 34.0, caoHgt));
        // gated with a smoothstep, not with caoNight raw: the GOLDEN preset carries
        // night 0.05, and a 5 % blend toward a night-only ramp is still a change to a
        // preset this round is not allowed to touch. Below 0.15 this is exactly 0.
        cao = mix(cao, min(cao, caoUp), smoothstep(0.15, 0.60, caoNight));` : ''}
        float caoF = mix(1.0, cao, cityAOAmt);
        reflectedLight.indirectDiffuse *= caoF;
        reflectedLight.indirectSpecular *= mix(0.65, 1.0, caoF);
      }`);
  };
  mat.customProgramCacheKey = () => wrappedKey(mat, prev, prevKey) + '|cityao' + (N11 ? 'n' : '') + (CS34 && mat.isMeshStandardMaterial ? (mat.userData.pbCity ? '|cs34p' : '|cs34') : '');
  mat.needsUpdate = true;
  return mat;
}

export function initCityAO() {
  (async () => {
    try {
      const [meta, buf] = await Promise.all([
        (await fetch('textures/cityao.json')).json(),
        (await fetch('textures/cityao.bin')).arrayBuffer(),
      ]);
      const t = new THREE.DataTexture(new Uint8Array(buf), meta.res, meta.res, THREE.RGFormat);
      t.minFilter = t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      t.needsUpdate = true;
      ENV.cityAO.value = t;
      ENV.cityAORect.value.set(meta.x0, meta.z0, 1 / (meta.x1 - meta.x0), 1 / (meta.z1 - meta.z0));
      console.log('[cityao] loaded', meta.res, 'covering', Math.round(meta.x1 - meta.x0), 'x', Math.round(meta.z1 - meta.z0), 'm');
    } catch (e) { console.warn('[cityao] unavailable (recompile tiles to bake)', e.message); }
  })();
}
// in public/textures/ — GPU-native BC formats, ~4-8x less VRAM than JPG).
// KTX2Loader is ASYNC and needs a renderer for detectSupport, so the bank
// boots as 1px placeholders and main.js calls initGTEX(renderer); every
// onBeforeCompile that captured t_* uniforms registers itself in
// GTEX_UNIFORM_REFS and gets its .value refreshed when the real texture
// lands. Color maps carry sRGB in the container DFD; data maps are linear.
const GTEX_DEFS = [
  ['asC', 'asphalt_col', 1], ['asN', 'asphalt_nrm', 0], ['asR', 'asphalt_rgh', 0], ['asD', 'asphalt_disp', 0],
  ['coC', 'concrete_col', 1], ['coN', 'concrete_nrm', 0],
  ['grC', 'grass_col', 1], ['grN', 'grass_nrm', 0],
  ['pvC', 'paving_col', 1], ['pvN', 'paving_nrm', 0], ['pvR', 'paving_rgh', 0], ['pvD', 'paving_disp', 0],
  ['brN', 'brick_nrm', 0], ['brR', 'brick_rgh', 0],
  ['wA', 'wall_redbrick', 1], ['wB', 'wall_brownbrick', 1], ['wC', 'wall_whitebrick', 1],
  ['wS', 'wall_stone', 1], ['wP', 'wall_plaster', 1],
];
// ?notower=1 — A/B switch for the whole 2026-09-04 skyscraper pass
// (docs/notes/skyscrapers.md): tower geometry in assemble.js, the tower facade
// block below, the far-macro block, and the macro crowns in streamer.js.
export const NO_TOWER_FX = typeof location !== 'undefined' && new URLSearchParams(location.search).get('notower') === '1';
// WS36 water normals from rotated gradient-noise octaves (makeWaterMaterial); ?ws36=0 restores the value-noise field
const WS36 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ws36') === '0');

// ?aa=0 restores the pre-2026-09-10 SHADING-ANTIALIASING behaviour for A/B
// measurement (docs/notes/shading-aa-r8.md; tools/tflick.mjs --flags "...&aa=0").
// Same convention as ?gfix=0 / ?zfix=0. Default ON.
export const AAFIX = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('aa') === '0');

// ?mat9=0 restores the pre-round-9 material richness (docs/notes/materials-r9.md §2).
// Round 9's brief A came out of the r8 BLIND pass (facades-r8.md §14: identified 6/6,
// reference preferred 5/6), whose facade tells were "brick one flat hue", "every window
// identical" and "nothing on a roof is stained". Measured against ref_lenox.png with a
// low-frequency metric (§2.2): our brick facades carry 10-17 % sd/mean at the 3-8 m scale
// where the reference carries 28 %. Everything under this flag is either a LOW-frequency
// term (far below Nyquist at any framing, so it cannot alias) or is explicitly faded out
// by the pixel footprint before its feature reaches a pixel — the project's stipple rule.
// Separate from ?aa (shading-aa-r8) and ?fac8 (facades-r8) on purpose: three independent
// A/B switches over the same shader.
export const MAT9 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('mat9') === '0');

// ?u10=0 restores the pre-round-10 UNIFORMITY behaviour (docs/notes/uniformity-r10.md).
// Same r9 blind pass, the OTHER recurring tell: **repeated elements are identical**.
// In this file that flag covers exactly four blocks, all of them per-instance identity
// rather than new material physics, and all four are listed in the notes:
//   1. the storefront FASCIA slot pick (64 slots and a bijection over the shop index,
//      so two shops on one frontage cannot draw the same sign);
//   2. the window SASH: paint state and dirt per building;
//   3. the road-paint branch (m == 3/4): a per-JUNCTION age and a per-BAR coverage,
//      because `age` is an fbm at a ~42 m wavelength — LARGER than a crossing;
//   4. the storefront GLAZING: roll-down grilles, a back wall that is not vertical
//      pastel bars, and a far-field fallback with a shop's vertical profile.
//
// RESTORED 2026-09-11 after a lost update: a concurrent whole-file write (the E10
// edges/grime pass, whose own work is intact) removed all four blocks before the WIP
// commit, so 73da69b never contained them either.
// Kept separate from ?e10 so the two rounds' claims stay independently measurable.
export const U10 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('u10') === '0');

// ?e10=0 restores the pre-round-10 EDGE / CONTACT behaviour (docs/notes/edges-r10.md).
// The r9 blind pass (materials-r9.md §11: identified 6/6, preferred 0/6) named two
// recurring tells, and this flag covers the second one: **perfect edges — there is no
// dirt where two surfaces meet**. Every grime term the r8/r9 shader had is anchored to
// an opening, a wall END or a HEIGHT; none of them is anchored to a JOINT. In a
// photograph of New York almost every dark accent in the frame is a contact: the pack
// of grit in the gutter against the kerb stone, the splash-and-salt zone where the
// sidewalk meets the wall, the tar line where a roof membrane turns up onto its
// parapet, the drip off a fascia, the rust run under a through-wall AC sleeve.
// Same design rules as MAT9: every term here is either LOW-frequency (2-12 m feature
// size, far below Nyquist at any framing) or is anchored to a geometric datum the
// shader already has (v, storeH, bldgH, the new face-height in aux3.z, the roof rim
// attribute), and the two that carry fine structure (gum spots, gutter litter) are
// derivative-faded by the ground shader's own gNear/gMid gates before their feature
// reaches a pixel. Nothing here adds a draw call, a material, a texture or a program.
export const E10 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('e10') === '0');

// ?n11=0 restores the pre-round-11 NIGHT behaviour (docs/notes/night-r11.md). Most of
// that round lives in core/engine.js (the probe floor), world/sky.js (sky glow + the
// night ambient rig), world/weather.js and sim/carlights.js; in THIS file it covers
// exactly one thing — WINDOW OCCUPANCY, which was a day/night constant. `lit` was
// `step(1 - (resi ? 0.20 : 0.42), id3)` at every hour, so a residential block at
// 3 a.m. and the same block at noon had the same one window in five lit, and the
// night frames sat at the bottom of the 30-60 % the brief asks for. The threshold
// now moves with ENV.night in opposite directions for the two uses a building has:
// apartments FILL after dark and offices EMPTY but leave their floor lighting on.
// It is a per-ROOM hash against a uniform — nothing varies per pixel and nothing
// varies per frame — so it is outside the stipple rules and cannot flicker.
// Declared here (not imported from world/night11.js) to match this file's own
// AAFIX / MAT9 / U10 / E10 convention.
export const N11 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('n11') === '0');

// WL11 — ?wl11=0 restores the perfect window lattice (docs/notes/lattice-r11.md).
// Three blind packs in a row identified our facades by the GRID: every bay exactly winW
// wide, every sill exactly at 0.3 of the floor, every sash the same colour, and not one
// opening in the city bricked up. This flag covers, in this file: per-bay width/offset
// jitter, per-window sill and lintel noise, bricked-up openings, replaced sashes, and
// correlated (rather than independently random) blind states.
export const WL11 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wl11') === '0');

// WL11 — the ONE hash that the facade shader, heroFacades.js and nycDress.js all evaluate
// for the same bay. It exists because `hash12` cannot be replicated across the CPU/GPU
// boundary: it is chaotic, and its inputs there (`wallSeed`, derived from a cumulative
// perimeter float) are not bit-identical in JS and in a float32 GPU lane — so the hero
// ring's appliqué frames would sit a few centimetres off the shader's jittered openings.
// This one is an integer LCG mod a prime, evaluated in floats: every intermediate is an
// exact integer below 2^24, so float32 and float64 return the SAME value. Feed it exact
// small integers only (see `cvI` in the shader / `wlSeed` in the two JS twins).
// The GLSL twin is `wlh()` in the facade shader's <common> block — keep them identical.
// The two SQUARING steps are not decoration. A chain of affine steps mod p is itself one
// affine map, so consecutive bay indices came out as an arithmetic progression — measured
// as a clean ramp of offsets (-1.6, -0.8, -0.1, +0.6, +1.4, +2.1 %, wrap) which on a
// facade is a systematic lean, not jitter. x -> x^2 + c breaks it: lag-1 correlation over
// 40k adjacent bays is 0.0002 and the deciles are flat. Every intermediate stays exactly
// representable: max 4092^2 + 2411 = 16 746 875 < 2^24, which is the whole contract.
export function wlHash(a, b) {
  let s = (a * 127 + b * 311 + 7) % 4093;
  s = (s * s + 1153) % 4093;
  s = (s * 137 + 59) % 4093;
  s = (s * s + 2411) % 4093;
  return s / 4093;
}
// WL11 — signed ±1 convenience (the jitter amplitudes are all symmetric)
export const wlSign = (a, b) => wlHash(a, b) * 2 - 1;

// WB13 — ?wb13=0 restores round-12 behaviour for the two new outer-borough styles
// (docs/notes/wburg-r13.md). In THIS file: the lap-siding branch for
// STYLE.FRAME_HOUSE (14), the rainscreen/spandrel branch for STYLE.CONDO_NEW (15),
// their window proportions, their white trim, and the four style RANGE tests that
// used to read `style > 11.5` — i.e. "anything above PROJECT_BRICK is NYCHA red
// brick". Turning the flag OFF re-opens those ranges, so 14 and 15 render as the
// red-brick walk-up they rendered as in round 12 and the A/B pair differs by the
// typology rather than by an untextured wall. The tile data is the same either way.
export const WB13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wb13') === '0');

// ------------------------------------------------------ GROUND TONE (r13, GT13)
// docs/notes/ground-r13.md. The round-13 critic ranked "city-wide asphalt" and
// "road/sidewalk/kerb tone inversion" 1 and 7; measured against the aerial reference
// crops on MATCHED, paint-free surfaces the level and the order are already right
// (walk 190/182, road 143/136, walk-minus-road +47/+46 — ours/reference). What the
// same crops DO show is that our carriageway is a rectangular TILING: the
// mill-and-pave lot field is a fixed 78 x 26 m pitch on the two grid axes, so a
// street running on the short axis gets a new pour every 26 m and a longitudinal
// seam down the middle of its roadway, and the lot-to-lot value range is 3.16x —
// every block face draws its asphalt from a lottery three stops wide, which is the
// real content of "one stretch of road in the whole city has the right asphalt".
// GT13 makes the lot a BLOCK FACE at either orientation (~80 m both ways, joints
// that wander by metres), cuts the neighbour-to-neighbour range to 1.9x with the
// MEAN HELD EXACTLY (so the measured tone does not move), and hands the variance
// it took off the lattice to the aperiodic skin-patch field. `?gt13=0` reverts.
export const GT13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gt13') === '0');

// ------------------------------------------------ GEOMETRIC SPECULAR AA (r8)
// Kaplanyan et al. 2016 "Filtering Distributions of Normals for Shading
// Antialiasing" / Tokuyoshi & Kaplanyan 2019 "Improved Geometric Specular
// Antialiasing": the shading normal is not constant inside a pixel, so treat
// its screen-space variation as an extra NDF lobe and CONVOLVE it into the
// roughness. A specular lobe that no longer resolves at this pixel density then
// widens instead of sparkling.
//
//   sigma^2      = SIGMA2 * (|dN/dx|^2 + |dN/dy|^2)      screen-space variance
//   kernelRough2 = min(2 * sigma^2, KAPPA)               clamped lobe widening
//   rough'       = sqrt(rough^2 + kernelRough2)
//
// SIGMA2 = 0.25 is the pixel reconstruction filter's variance (sigma = 0.5 px).
// KAPPA bounds how much roughness ONE pixel may gain, so a silhouette, a
// normal-map discontinuity or a crease cannot flatten the material to matte —
// it is the knob the "does it look matte in stills?" check tunes.
//
// WHY THIS IS NOT ALREADY COVERED. three's own <lights_physical_fragment> does
// a crude version of this:
//     vec3 dxy = max(abs(dFdx(nonPerturbedNormal)), abs(dFdy(nonPerturbedNormal)));
//     material.roughness += max(max(dxy.x, dxy.y), dxy.z);
// but it reads `nonPerturbedNormal` — the INTERPOLATED GEOMETRIC normal, saved
// before <normal_fragment_maps>. Every normal the ground and facade shaders
// synthesise (mip-averaged PBR normal maps, albedo relief, rain rings, leaf
// grain) is invisible to it, and glitch-r7.md 4.3 measured exactly that detail
// as the residue: 61 % of hot pixels the compiled ground, 24 % the facades, all
// at rms 4-5. This wrapper re-derives the variance from the FINAL shading
// normal, which is in scope and fully perturbed at <lights_physical_fragment>.
export const SPECAA_GLSL = /* glsl */ `
  uniform vec2 uAaK;   // live (sigma2, kappa) MULTIPLIER — see AA_SPEC below
  float specAARough(vec3 nrm, float rough, float sigma2, float kappa) {
    vec3 ndx = dFdx(nrm), ndy = dFdy(nrm);
    float variance = sigma2 * uAaK.x * (dot(ndx, ndx) + dot(ndy, ndy));
    float kernel = min(2.0 * variance, kappa * uAaK.y);
    return min(sqrt(rough * rough + kernel), 1.0);
  }
`;
// ONE shared multiplier for every specular-AA program, so the effect can be
// isolated and tuned live with no rebuild — which is what makes the A/B
// attribution in docs/notes/shading-aa-r8.md possible in a single boot:
//   tflick --eval "window.__AA_SPEC.value.set(0, 0)"   specular AA OFF only
//   tflick --eval "window.__AA_SPEC.value.set(1, 2)"   kappa doubled (matte check)
export const AA_SPEC = { value: new THREE.Vector2(1, 1) };
if (typeof window !== 'undefined') window.__AA_SPEC = AA_SPEC;
// Composes with an existing onBeforeCompile. Hooks the LAST point at which the
// shading normal is final and `roughnessFactor` has not been consumed yet, and
// PREPENDS to the include so a material that appends to the same chunk (the
// ground's `material.specularColor *= GND_spec`) composes either way round.
// `clearcoat` also widens clearcoatRoughness (car paint: the 0.06 clearcoat
// lobe is the one that sparkles, not the 0.30 base).
export function applySpecAA(mat, o = {}) {
  // `__specAA` means "already considered", set even when the flag is off, so
  // per-frame callers (vehicleCull's `_finish`, which has to catch async fleet
  // material swaps) stay a single property test under ?aa=0 too.
  if (!mat || mat.__specAA) return mat;
  mat.__specAA = true;
  if (!AAFIX) return mat;
  const sigma2 = (o.sigma2 ?? 0.25).toFixed(4);
  const kappa = (o.kappa ?? 0.18).toFixed(4);
  const cc = !!o.clearcoat;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    if (sh.fragmentShader.indexOf('specAARough') >= 0) return;
    sh.uniforms.uAaK = AA_SPEC;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SPECAA_GLSL)
      // `clearcoatRoughness` is a UNIFORM (read-only), and the clearcoat lobe
      // shades off `clearcoatNormal`, not `normal` — so that half has to be
      // done on `material.*` AFTER the include.
      .replace('#include <lights_physical_fragment>', `roughnessFactor = specAARough(normal, roughnessFactor, ${sigma2}, ${kappa});
        #include <lights_physical_fragment>
        ${cc ? `#ifdef USE_CLEARCOAT
        material.clearcoatRoughness = specAARough(clearcoatNormal, material.clearcoatRoughness, ${sigma2}, ${kappa});
        #endif` : ''}`);
  };
  mat.customProgramCacheKey = () => (prevKey ? prevKey.call(mat) : '') + '|specaa' + sigma2 + kappa + (cc ? 'c' : '');
  mat.__specAA = true;
  mat.needsUpdate = true;
  return mat;
}

export const GTEX = {};
// ==== MEM41: weak references, so a disposed material's uniforms (and its hideTex) can be collected; dead entries are
// pruned when the list grows and on every texture arrival. The list only serves late KTX2 arrivals.
export const GTEX_UNIFORM_REFS = []; // WeakRefs to sh.uniforms objects holding t_* slots
function gtexRefPush(u) {
  GTEX_UNIFORM_REFS.push(typeof WeakRef === 'function' ? new WeakRef(u) : { deref: () => u });
  if (GTEX_UNIFORM_REFS.length % 256 === 0) for (let i = GTEX_UNIFORM_REFS.length - 1; i >= 0; i--) if (!GTEX_UNIFORM_REFS[i].deref()) GTEX_UNIFORM_REFS.splice(i, 1);
}
// ==== MEM41 end
if (typeof document !== 'undefined') {
  for (const [k, , srgb] of GTEX_DEFS) {
    const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    GTEX[k] = t;
  }
}

// ------------------------------------------------------------------ CT25 STONE DETAIL
// (owner 2026-09-25: the trailer's first shot, Columbia's College Walk, "feels really flat and low quality".) The campus
// kit and the campus landmarks were plain single-colour MeshStandardMaterials, so a 60 m granite stair, the Low Plaza
// panels and Low Library's limestone were each one flat value. This gives such a material a real stone surface: colour
// variation, micro-relief normals and roughness from a photographed CC0 set (Poly Haven; tools/assets/encode_stone.mjs),
// projected TRIPLANAR in the campus frame (the Manhattan grid, 29 deg off true north), so it needs no UVs and the
// texture runs square to the steps and walks. The colour term is the texture divided by its own linear mean: a material
// keeps its calibrated value on average (applyLightTrim, the critic-round palette) and takes only the variation.
// `?ct25=0` leaves the materials flat.
export const CT25 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ct25') === '0');
export const CT26 = CT25 && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ct26') === '0');
// WR26 (owner 2026-09-25: "solve the flatness"): a street window mirrors the far side of the street. The analytic sky mirror
// put the bright horizon in every eye-level pane (a shaded pane measured 155 grey against 100 for the brick round it), so
// the glazing read as frosted panels. Now the reflected ray meets a modelled far wall (lots of varied height and masonry,
// a window grid, lit like the city) or the roadway, and only above that skyline the sky and the sun. `?wr26=0` reverts.
export const WR26 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wr26') === '0');
// FR26 (owner 2026-09-26, "fix still open problems"): a masonry wall seen from the sidewalk read as per-pixel static with blue
// specks (W 122nd St, 5 m away). The albedo-relief bump takes the screen derivative of the FINAL albedo, photo grain included,
// and the grain is at full strength at sniff range: its derivative is texel noise, so the relief normal went random per pixel
// and every pixel reflected a different patch of sky. The photo grain is now carried beside the albedo (FAC_grainV) and
// multiplied in only AFTER the relief has read its heightfield, so the procedural pattern, joints and courses keep their
// relief and the grain stays in the colour. (Dividing the grain back out of the final albedo did not cancel it on the
// sunlit stone of the film's Broadway frames.) `?fr26=0` reverts.
export const FR26 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fr26') === '0');
// SW26 (the ad, 2026-09-26): the sidewalk's utility "locate mark" was ridged noise over its whole 4.4 m cell, i.e. a pink
// vein network across the flags, and the hairline cracks a ridge network every ~0.3 m that read as tar snakes. A locate
// mark is now a short sprayed stroke with a cross-tick, and a cracked flag carries one or two thin cracks. `?sw26=0` reverts.
export const SW26 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('sw26') === '0');
// GM28 (owner 2026-09-27, with stills of a street-level NYC game as the bar: "Add proper modern 2026 asphalt and sidewalk
// materials with proper layering - right now all materials look flat"): the grain of the 4K asphalt and concrete sets was
// multiplied in at 30-45 % and faded out by a 0.3-1 m pixel footprint, so a road read as one smooth grey sheet at every
// distance a street shot has; the normal map was flattened (z x1.6) and blended at 85 %, and the roughness map moved the
// asphalt by +-15 %, so nothing caught the sun. GM28: the photo grain near full strength out to a 2.4 m footprint (the
// maps are mip-filtered and the detail multiply is mean-preserving, so the far field keeps its calibrated tone), the
// relief unflattened, the roughness map at +-30 % (aggregate glints, binder stays matte), and new layers on the asphalt:
// rubber skid pairs, oil and damp blotches; the concrete's grain, joints and stains deeper. `?gm28=0` restores.
export const GM28 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gm28') === '0');
// GR28 (2026-09-27, the teaser's Lenox median): a lawn took the grass photo set only inside a 0.22-0.6 m pixel footprint
// and at 45 %, so a median or a park lawn past a few metres was one flat green. GR28 holds the grass grain out to a 2 m
// footprint at 75 %, adds a coarse clump layer from the same set (1/4.8 the frequency, rotated), clump-scale value and
// dry-tint variation, and the blade normals at 80 %. All mean-preserving: the far field keeps its tone. `?gr28=0` restores.
export const GR28 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gr28') === '0');
// BW28 (2026-09-27, the same review): a face the compiler marks blind (a lot-line wall) was painted with one fbm and
// nothing else, and on the towers over 125th & Lenox (the State Office Building, the glass tower east of it) those
// faces are most of what a street shot sees above the low buildings: flat beige and navy boxes. A neighbour in Harlem
// rarely rises past 26 m, so on a building over 36 m the wall above 26 m is exposed and is drawn as the building's own
// windowed facade; below it, and on everything lower, the blind wall stays. `?bw28=0` restores.
export const BW28 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('bw28') === '0');
// RS30 (owner 2026-09-28: "Rooftop shimmering is still a problem for Columbia University in the main ad", and "rooftops
// shimmer" in Times Square): the roof patterns are lines a few percent of their period wide (copper standing seams,
// membrane roll laps, paver joints, slate courses) and random values one per sheet, roll, paver or shingle, and they
// were faded only once the period itself fell under 1.3-5 px, so from the aerials a seam or a joint was a sub-pixel line
// that a frame's jittered samples caught on some frames and missed on others. Each now fades by its own width in pixels
// (whole from ~1.8 px, gone under ~0.7 px) with its mean tone kept, and the granule noises by their own period.
// `?rs30=0` restores.
export const RS30 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rs30') === '0');
// SG31 (the TA31 worker's night probe at 45th St: the storefront band under the screens bloomed into one white glow, the
// lit shop glass reaching 2.0 against the night bloom threshold of 0.85): near Times Square a lit shop front is held at 0.85
// on its brightest channel, its hue kept (inside 180 m of 45th St, easing out by 320 m; the rest of the city as before).
// `?sg31=0` restores.
export const SG31 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('sg31') === '0');
// SF32 (coordinator 2026-09-29: "the storefront band under the screens is still blown white at night"). Measured on
// bshot tsqPlaza at night (docs/notes/tsq-graphics.md SF32): the band IS the shop-glass emission below (SG31's line).
// With it switched off in the page the band under the Lantern screen went from sRGB luma 162 / chroma 20 to 71 / 64,
// the shop signs and the glass albedo changed it by 3; SG31's 0.85 cap cannot help because the emission is a near-grey
// room (grey walls, cool fluorescent light) at 0.6-0.85 in all three channels over every lit bay, which the night
// exposure lifts to a flat near-white. In the Square each glazed 4 m bay now shows what a Times Square window shows:
// one of a backlit graphic wall in a strong colour, a screen behind the glass, figures against a lit display wall, or
// an open view into a room whose goods take the bay's colour; the room behind at 35 %, a lit ceiling strip under the
// transom, and the frame (mullions at the bay ends, a transom bar) dark. The features are glass-plane shapes of 0.1 m
// and up, edged by their own footprint and converged to the bay's mean colour from ~0.12 m a pixel, so none of them can
// shimmer. By day the same displays show at the day level; at night the glass albedo keeps 30 % of the room (the room's
// own light is the emission, lighting it again as a diffuse surface counted it twice). Same zone as SG31 (180 m of
// 45th St, easing out by 320 m). `?sf32=0` restores.
export const SF32 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('sf32') === '0');
const STONE_SETS = {
  cgranite:   { mean: [0.3769, 0.2992, 0.1664], size: 2.17 },   // stone_wall_03: speckled, jointless (steps, walls, rims)
  climestone: { mean: [0.3772, 0.2890, 0.1764], size: 3.00 },   // sandstone_blocks_08: ashlar coursing (Low Library)
  cpave:      { mean: [0.0928, 0.0947, 0.0888], size: 3.00 },   // concrete_floor_worn_001: worn slab (plaza panels)
};
const STONE_AXIS = new THREE.Vector2(0.885, 0.465);   // campus east in world xz (x east, z south); north = (0.465, -0.885)
const _stone = {};      // set -> { col, nrm, rgh } uniform objects, filled when the textures land
let _stoneLoader = null;
function stoneUniforms(name) {
  if (_stone[name]) return _stone[name];
  const px = (r, g, b) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.needsUpdate = true; return t; };
  const S = STONE_SETS[name];
  const u = _stone[name] = {
    col: { value: px(255, 255, 255) }, nrm: { value: px(128, 128, 255) }, rgh: { value: px(200, 200, 200) },
    mean: { value: new THREE.Vector3(1, 1, 1) }, ready: false,
  };
  u._S = S;
  if (_stoneLoader) _stoneLoader(name, u);
  return u;
}
// called from initGTEX once the KTX2 loader exists
function stoneLoaderReady(loader, tl) {
  _stoneLoader = (name, u) => {
    for (const [k, suf, srgb] of [['col', 'col', true], ['nrm', 'nrm', false], ['rgh', 'rgh', false]]) {
      const install = (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = srgb ? 16 : 8;
        u[k].value = t;
        if (k === 'col') u.mean.value.set(...u._S.mean);   // the ratio uses the mean only once the real texture is in
      };
      loader.load(`textures/${name}_${suf}.ktx2`, install, undefined, () => {
        const t = tl.load(`textures/${name}_${suf}.jpg`); if (srgb) t.colorSpace = THREE.SRGBColorSpace; install(t);
      });
    }
  };
  for (const [name, u] of Object.entries(_stone)) _stoneLoader(name, u);
}
// o: { amt (colour variation 0..1), nrm (normal strength 0..1), rgh (roughness blend 0..1), scale (x the set size) }
export function applyStoneDetail(mat, name, o = {}) {
  if (!CT25 || !STONE_SETS[name] || !mat || mat.userData.stoneDetail) return mat;
  const S = STONE_SETS[name], U = stoneUniforms(name);
  const amt = o.amt ?? 0.85, nAmt = o.nrm ?? 0.8, rAmt = o.rgh ?? 0.5, size = S.size * (o.scale ?? 1);
  // CT26 (`?ct26=0` off): ashlar block tone + weathering for dressed stone walls (o.ashlar = strength, 1 = full)
  const ashlarK = CT26 ? +(o.ashlar || 0) : 0, ashlar = ashlarK > 0;
  const prev = mat.onBeforeCompile;
  mat.userData.stoneDetail = name;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.stCol = U.col; sh.uniforms.stNrm = U.nrm; sh.uniforms.stRgh = U.rgh; sh.uniforms.stMean = U.mean;
    sh.uniforms.stAxis = { value: STONE_AXIS };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStW; varying vec3 vStN;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 stP = vec4( transformed, 1.0 );
          vec3 stN = objectNormal;
          #ifdef USE_INSTANCING
            stP = instanceMatrix * stP; stN = mat3( instanceMatrix ) * stN;
          #endif
          vStW = ( modelMatrix * stP ).xyz;
          vStN = mat3( modelMatrix ) * stN;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D stCol; uniform sampler2D stNrm; uniform sampler2D stRgh; uniform vec3 stMean; uniform vec2 stAxis;
        varying vec3 vStW; varying vec3 vStN;
        vec3 stF( vec3 w ) { return vec3( dot( w.xz, stAxis ), w.y, dot( w.xz, vec2( -stAxis.y, stAxis.x ) ) ); }
        vec3 stFi( vec3 f ) { vec2 e = stAxis, n = vec2( -stAxis.y, stAxis.x ); return vec3( e.x * f.x + n.x * f.z, f.y, e.y * f.x + n.y * f.z ); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 stP3 = stF( vStW ) / ${size.toFixed(3)};
        vec3 stN3 = normalize( stF( normalize( vStN ) ) );
        vec3 stWt = pow( abs( stN3 ), vec3( 4.0 ) ); stWt /= max( stWt.x + stWt.y + stWt.z, 1e-4 );
        vec2 stUx = stP3.zy, stUy = stP3.xz, stUz = stP3.xy;
        {
          vec3 c = texture2D( stCol, stUx ).rgb * stWt.x + texture2D( stCol, stUy ).rgb * stWt.y + texture2D( stCol, stUz ).rgb * stWt.z;
          diffuseColor.rgb *= mix( vec3( 1.0 ), clamp( c / max( stMean, vec3( 1e-3 ) ), vec3( 0.35 ), vec3( 1.9 ) ), ${amt.toFixed(3)} );
        }${ashlar ? `
        {
          // CT26 ashlar: what survives distance once the detail maps have mipped to their mean. Each block its own shade
          // (0.62 m courses of 1.24 m blocks, staggered), darker joints, broad weathering, and on walls rain streaks
          // that darken downward from every course
          vec3 f = stF( vStW ); vec3 an = abs( stN3 );
          vec2 bq = an.y > max( an.x, an.z ) ? f.xz : ( an.x > an.z ? f.zy : f.xy );
          float crs = floor( bq.y / 0.62 );
          float bx = floor( ( bq.x + mod( crs, 2.0 ) * 0.62 ) / 1.24 );
          float bh = fract( sin( dot( vec2( bx, crs ), vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
          vec2 inb = vec2( fract( ( bq.x + mod( crs, 2.0 ) * 0.62 ) / 1.24 ) * 1.24, fract( bq.y / 0.62 ) * 0.62 );
          float jn = 1.0 - smoothstep( 0.0, 0.012, min( min( inb.x, 1.24 - inb.x ), min( inb.y, 0.62 - inb.y ) ) );
          float pw = sin( f.x * 0.23 + f.y * 0.11 ) * sin( f.z * 0.19 - f.y * 0.07 + 1.7 ) * 0.5 + 0.5;       // broad patches
          float wall = smoothstep( 0.6, 0.9, 1.0 - an.y );
          float stk = fract( sin( floor( bq.x * 2.3 ) * 91.7 ) * 4375.85 );                                  // streak columns
          float streak = wall * smoothstep( 0.55, 0.95, stk ) * ( 1.0 - fract( bq.y / 0.62 ) ) * 0.6;
          float tone = 1.0 + ( bh - 0.5 ) * ${(0.11 * ashlarK).toFixed(3)} - ( pw - 0.5 ) * ${(0.12 * ashlarK).toFixed(3)} - streak * ${(0.10 * ashlarK).toFixed(3)} - jn * ${(0.16 * ashlarK).toFixed(3)};
          diffuseColor.rgb *= tone;
          diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.02, 1.0, 0.965 ), ( bh - 0.5 ) * 2.0 * ${(0.5 * ashlarK).toFixed(3)} );   // warm / cool stones
        }` : ''}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        {
          float rt = texture2D( stRgh, stUx ).g * stWt.x + texture2D( stRgh, stUy ).g * stWt.y + texture2D( stRgh, stUz ).g * stWt.z;
          roughnessFactor = clamp( mix( roughnessFactor, rt, ${rAmt.toFixed(3)} ), 0.08, 1.0 );
        }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          // whiteout-blended triplanar normal map in the campus frame, back to world, then to view space
          vec3 tx = texture2D( stNrm, stUx ).xyz * 2.0 - 1.0, ty = texture2D( stNrm, stUy ).xyz * 2.0 - 1.0, tz = texture2D( stNrm, stUz ).xyz * 2.0 - 1.0;
          vec3 n3 = stN3;
          tx = vec3( tx.xy + n3.zy, abs( tx.z ) * n3.x );
          ty = vec3( ty.xy + n3.xz, abs( ty.z ) * n3.y );
          tz = vec3( tz.xy + n3.xy, abs( tz.z ) * n3.z );
          vec3 pn = normalize( tx.zyx * stWt.x + ty.xzy * stWt.y + tz.xyz * stWt.z );
          vec3 vn = normalize( ( viewMatrix * vec4( stFi( pn ), 0.0 ) ).xyz );
          normal = normalize( mix( normal, vn * sign( dot( vn, normal ) + 1e-4 ), ${nAmt.toFixed(3)} ) );
        }`);
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => (key ? key() : '') + `|ct25${name}${amt}${nAmt}${rAmt}${size}${ashlar ? '|a' + ashlarK : ''}`;
  mat.needsUpdate = true;
  return mat;
}

export function initGTEX(renderer) {
  (async () => {
    const loader = (await import('../city/mat/ktx2.js')).ktx2Loader(renderer);   // the app's one KTX2 loader (MATS 06:15)
    const tl = new THREE.TextureLoader();
    stoneLoaderReady(loader, tl);   // CT25
    const install = (k, t, srgb) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      // r8 (?aa=0 -> 8 on everything). A street plane at a 3 m eye is the most
      // extreme minification anisotropy in the frame: at 40 m one pixel spans
      // ~0.4 m ALONG the view and ~0.02 m across it, a 20:1 footprint against
      // 8:1 filtering. glitch-r7.md 2.6 lists `aniso16` as one of the two
      // unrun experiments; running it splits into two OPPOSITE answers and the
      // split is the point:
      //   * COLOUR maps (srgb): sharper filtering is a pure win. Colour
      //     aliasing is what mips and anisotropy exist to fix, and colour does
      //     not drive a specular lobe. -> 16.
      //   * NORMAL / roughness / displacement maps (data): anisotropy is the
      //     CORRECT filter and therefore the WRONG thing here — it retains the
      //     short-axis high frequency, and on a normal map that frequency goes
      //     straight into a specular that has one sample per pixel to resolve
      //     it with. Sharper normals at grazing incidence is more sparkle, not
      //     less. -> left at 8, and `applySpecAA` handles what survives.
      t.anisotropy = (AAFIX && srgb) ? 16 : 8;
      GTEX[k] = t;
      const un = 't_' + k;
      for (let i = GTEX_UNIFORM_REFS.length - 1; i >= 0; i--) { const u = GTEX_UNIFORM_REFS[i].deref(); if (!u) { GTEX_UNIFORM_REFS.splice(i, 1); continue; } if (u[un]) u[un].value = t; }   // MEM41
    };
    if (GP31) {
      // GP31: the two ground arrays (tools/assets/encode_ground_pbr.mjs). There is no JPG fallback for an array: until
      // both land gpReady stays 0 and the ground draws its calibrated tones without detail.
      let n = 0;
      for (const [slot, file, srgb] of [['alb', 'gp31_alb', true], ['nrm', 'gp31_nrm', false]]) {
        loader.load('textures/' + file + '.ktx2', (t) => {
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.anisotropy = (AAFIX && srgb) ? 16 : 8;   // the r8 rule above: colour sharp, data at 8
          GP31_TEX[slot].value = t;
          const depth = (t.image && t.image.depth) || 1;
          if (slot === 'nrm') GP31_TEX.macroL.value = depth - 1;
          else GP31_TEX.gravelL.value = depth >= 6 ? 5 : 3;
          if (++n === 2) GP31_TEX.ready.value = 1;
        }, undefined, (e) => console.warn('[gp31] ground array failed:', file, e && e.message));
      }
    }
    for (const [k, name, srgb] of GTEX_DEFS) {
      // GP31: nothing samples the six GM28 asphalt/concrete maps any more (4096^2 each: 128 MiB of VRAM as BC7); they stay 1 px
      if (GP31 && /^(asC|asN|asR|asD|coC|coN)$/.test(k)) continue;
      loader.load('textures/' + name + '.ktx2', (t) => install(k, t, srgb), undefined, () => {
        // fallback: uncompressed jpg (dev before encoding / exotic GPU)
        const t = tl.load('textures/' + name + '.jpg');
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        install(k, t, srgb);
        console.warn('[gtex] ktx2 missing, jpg fallback:', name);
      });
    }
  })();
}

const TEX_GLSL = /* glsl */ `
  vec2 rot2(vec2 p, float a) { float c = cos(a), sn = sin(a); return vec2(c * p.x - sn * p.y, sn * p.x + c * p.y); }
  // anti-tiled lookup: two rotated/offset taps blended by a low-frequency mask
  vec4 atex(sampler2D t, vec2 uv, float mk) {
    return mix(texture2D(t, uv), texture2D(t, rot2(uv, 2.03) + vec2(0.37, 0.71)), mk);
  }
  // the same two taps with explicit gradients (parallax: the mip is picked from the unshifted uv, not the shifted one)
  vec4 atexG(sampler2D t, vec2 uv, float mk, vec2 gx, vec2 gy) {
    return mix(textureGrad(t, uv, gx, gy), textureGrad(t, rot2(uv, 2.03) + vec2(0.37, 0.71), rot2(gx, 2.03), rot2(gy, 2.03)), mk);
  }
`;

const HASH_GLSL = /* glsl */ `
  float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1, 0)), f.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { return vnoise(p) * 0.6 + vnoise(p * 2.7) * 0.25 + vnoise(p * 7.1) * 0.15; }
  // box-filtered pulse train: exact mean of the [lo,hi) indicator (period 1) over a
  // pixel footprint w centered at x — converges to (hi-lo) at any minification.
  float pcovI(float x, float lo, float hi) { return floor(x) * (hi - lo) + clamp(fract(x) - lo, 0.0, hi - lo); }
  float pcov(float x, float lo, float hi, float w) {
    w = max(w, 1e-5);
    return clamp((pcovI(x + 0.5 * w, lo, hi) - pcovI(x - 0.5 * w, lo, hi)) / w, 0.0, 1.0);
  }
`;

// ------------------------------------------------------- ANALYTIC SKY MIRROR
// docs/notes/facades-r6.md §0. What a real glass facade does, in the three
// terms that survive from 5 m to 2 km, none of them per-pane so minification
// cannot kill any of them:
//
//   1. a SKY GRADIENT along the reflection vector: pale zenith, a brighter and
//      warmer horizon band (the haze layer, which is where a vertical wall's
//      reflection vector actually points), and the CITY below the horizon —
//      dark. That last one is why a real tower is bright at the top and nearly
//      black at the bottom of the same sheet of glass.
//   2. the SOLAR AUREOLE: a broad glow around the sun, which is what makes the
//      sun side of an avenue hot and the shade side near-black without any
//      non-physical N.L term.
//   3. the SUN DISC: a tight lobe that clips to white and blooms. Its exponent
//      is widened by the pixel footprint (specular-AA) and its peak clamped,
//      or sub-pixel mirrors strobe — the same rule as every other high
//      frequency in this project.
//
// Fed from ENV (sunDir/sunColor/skyAmbient/fogColor), so it tracks time of day,
// HDRI relighting and weather for free. `gain` is ENV.reflGain.
const SKYREFL_GLSL = /* glsl */ `
  // radiance seen along reflection direction R
  vec3 skyLook(vec3 R, vec3 sunD, vec3 sunC, vec3 zenC, vec3 horC, float gain, float aur) {
    float up = clamp(R.y, -1.0, 1.0);
    vec3 zen = zenC * (1.95 * gain);
    vec3 hor = horC * (2.55 * gain);
    // below the horizon a wall mirrors the CITY, which is dark but not black
    // and warm (sunlit masonry and asphalt, not sky). Measured against
    // crownClose: at 0.20 * horC every tower face above the camera went to
    // near-black because from 170 m most reflection vectors point down.
    vec3 gnd = horC * vec3(0.45, 0.40, 0.34) * gain;
    vec3 c = up >= 0.0 ? mix(hor, zen, pow(up, 0.42))
                       : mix(hor, gnd, pow(-up, 0.55));
    float mu = max(dot(R, sunD), 0.0);
    c += sunC * (aur * gain) * pow(mu, 7.0);               // aureole
    return c;
  }
  // Schlick, with the grazing tail kept honest at large pixel footprints
  float fresnelR(float cosT, float f0) {
    return f0 + (1.0 - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  }
  // tight solar disc with specular-AA: fp = max(fwidth) of the surface param
  float sunDisc(vec3 R, vec3 sunD, float rough, float fp) {
    float e = (2.0 / max(rough * rough, 1e-4)) / (1.0 + fp * 220.0);
    return min(pow(max(dot(R, sunD), 0.0), clamp(e, 12.0, 4000.0)), 6.0);
  }
`;
export const SKYREFL_CHUNK = SKYREFL_GLSL;

// Uniform block every sky-mirror shader needs. Kept in one place so the facade,
// the far macro and the landmark helpers cannot drift apart.
function skyReflUniforms(sh) {
  sh.uniforms.uRefl = ENV.reflGain;
  sh.uniforms.uSunD = ENV.sunDir;
  sh.uniforms.uSunC = ENV.sunColor;
  sh.uniforms.uZenC = ENV.skyAmbient;
  sh.uniforms.uHorC = ENV.fogColor;
}
const SKYREFL_PARS = /* glsl */ `
  uniform float uRefl; uniform vec3 uSunD; uniform vec3 uSunC; uniform vec3 uZenC; uniform vec3 uHorC;`;

/* --------------------------------------------------------------------------
   applySkyGlass(mat, o) — give a plain MeshStandardMaterial (landmark curtain
   walls: One Vanderbilt, 432 Park, One WTC, Central Park Tower, Hearst...) the
   same analytic mirror the 930k shader facades get. `applyLightTrim` has
   already crushed these materials' diffuse to 30 % by day, which is right for
   stone and fatal for glass: a curtain wall is ~5 % diffuse and 10-30 %
   MIRROR, and the mirror was coming from an IBL at 0.14. Composes with an
   existing onBeforeCompile.
     f0     Fresnel reflectance at normal incidence (0.06 clear .. 0.30 coated)
     tint   reflection tint (bronze glass mirrors warm, blue-green cool)
     rough  plate roughness for the sun disc (0.03 mirror .. 0.12 fritted)
   -------------------------------------------------------------------------- */
export function applySkyGlass(mat, o = {}) {
  const f0 = o.f0 ?? 0.14, rough = o.rough ?? 0.05, aur = o.aureole ?? 1.5;
  const tint = o.tint || [1, 1, 1], mull = o.mullion ?? 0;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    skyReflUniforms(sh);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSGw;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSGw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSGw;${SKYREFL_PARS}
        ${SKYREFL_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 Ng = normalize(cross(dFdx(vSGw), dFdy(vSGw)));
        vec3 Vg = normalize(cameraPosition - vSGw);
        if (dot(Ng, Vg) < 0.0) Ng = -Ng;
        vec3 Rg = reflect(-Vg, Ng);
        float fp = length(fwidth(vSGw)) * 0.05;
        float F = fresnelR(max(dot(Vg, Ng), 0.0), ${f0.toFixed(3)});
        vec3 tn = vec3(${tint.map((v) => v.toFixed(3)).join(', ')});
        vec3 refl = skyLook(Rg, uSunD, uSunC, uZenC, uHorC, uRefl, ${aur.toFixed(2)}) * tn * F;
        refl += uSunC * tn * sunDisc(Rg, uSunD, ${rough.toFixed(3)}, fp) * F * 14.0 * uRefl;
        ${mull ? `// spandrel/mullion banding so a landmark slab is not one sheet
        float fb = vSGw.y / 3.9; float aaFb = max(fwidth(fb), 1e-4);
        float band = mix(1.0, 0.34 + 0.72 * pcovSG(fb, 0.26, 0.95, aaFb * 1.25), smoothstep(1.1, 0.25, aaFb));
        refl *= band; diffuseColor.rgb *= mix(1.0, band, 0.6);` : ''}
        totalEmissiveRadiance += refl;
        roughnessFactor = min(roughnessFactor, ${Math.max(rough, 0.04).toFixed(3)});
      }`);
    if (mull) {
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
        float pcovISG(float x, float lo, float hi) { return floor(x) * (hi - lo) + clamp(fract(x) - lo, 0.0, hi - lo); }
        float pcovSG(float x, float lo, float hi, float w) { w = max(w, 1e-5);
          return clamp((pcovISG(x + 0.5 * w, lo, hi) - pcovISG(x - 0.5 * w, lo, hi)) / w, 0.0, 1.0); }`);
    }
  };
  mat.customProgramCacheKey = () => (prev ? String(prev) : '') + '|skyglass' + f0 + rough + aur + tint.join(',') + mull;
  mat.needsUpdate = true;
  return mat;
}

/* --------------------------------------------------------------------------
   applySkyMetal(mat, o) — brushed / polished architectural metal. The Chrysler
   Building's crown is the mirror-bright Nirosta (18-8 chrome-nickel) object in
   New York and it rendered MATTE WHITE (critic r5 #2). Two reasons: the IBL at
   0.14, and `applyLightTrim` multiplying diffuseColor at <color_fragment> —
   which is BEFORE <lights_physical_fragment> derives
   specularColor = mix(0.04, diffuse, metalness), so the day trim crushes a
   metal's MIRROR colour to 30 % as well as its (nonexistent) diffuse.
   This puts a real metal reflection back on top, anisotropically smeared along
   the brush direction (vertical for a spire, radial for a crown tier).
     tint    metal reflectance colour (steel 0.86/0.88/0.91, brass 0.83/0.68/0.42)
     rough   0.04 polished .. 0.30 heavily brushed
     brush   0 = isotropic, 1 = smear the highlight vertically (rolled sheet)
   -------------------------------------------------------------------------- */
export function applySkyMetal(mat, o = {}) {
  const tint = o.tint || [0.86, 0.88, 0.91], rough = o.rough ?? 0.12;
  const brush = o.brush ?? 0.7, gain = o.gain ?? 1.0;
  const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey;
  // LOOK34: the tint, roughness, brush and gain are this material's uniforms, so every metal over the same base material
  // shares one program (baked into the source they made one program per tint: 109 pbr:panel_alu programs at apFront,
  // docs/notes/ar33-kit.md). The base material's own key is chained (wrappedKey), as the other wrappers do.
  const smTn = { value: new THREE.Vector3(tint[0], tint[1], tint[2]) };
  const smP = { value: new THREE.Vector4(rough, brush, gain, Math.max(rough, 0.04)) };
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    skyReflUniforms(sh);
    sh.uniforms.uSmTn = smTn;
    sh.uniforms.uSmP = smP;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSMw;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vSMw = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vSMw;${SKYREFL_PARS}
        uniform vec3 uSmTn; uniform vec4 uSmP;   // tint; rough, brush, gain, roughness floor
        ${SKYREFL_GLSL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        vec3 Nm = normalize(cross(dFdx(vSMw), dFdy(vSMw)));
        vec3 Vm = normalize(cameraPosition - vSMw);
        if (dot(Nm, Vm) < 0.0) Nm = -Nm;
        vec3 Rm = reflect(-Vm, Nm);
        // brushed sheet: pull the reflection vector toward the horizontal
        // plane so the highlight smears in a band, the way rolled stainless
        // does on a spire — this is the read that says "metal" at 600 m
        Rm = normalize(mix(Rm, normalize(vec3(Rm.x, Rm.y * 0.42, Rm.z)), uSmP.y));
        float fp = length(fwidth(vSMw)) * 0.05;
        vec3 tn = uSmTn;
        // a metal has no F0 dielectric tail: reflectance is the tint, near flat
        float F = mix(1.0, 1.0 + 0.6 * pow(1.0 - max(dot(Vm, Nm), 0.0), 5.0), 0.8);
        vec3 refl = skyLook(Rm, uSunD, uSunC, uZenC, uHorC, uRefl, 2.2) * tn * F * uSmP.z;
        refl += uSunC * tn * sunDisc(Rm, uSunD, uSmP.x, fp) * 10.0 * uRefl * uSmP.z;
        totalEmissiveRadiance += refl;
        roughnessFactor = min(roughnessFactor, uSmP.w);
      }`);
  };
  mat.customProgramCacheKey = () => wrappedKey(mat, prev, prevKey) + '|skymetalU';
  mat.needsUpdate = true;
  return mat;
}

// ------------------------------------------------------------------ FACADES
// MeshStandardMaterial + injected procedural facade logic:
// windows from real floor count/width, party-wall blanking, storefronts,
// grime-driven glass roughness (PR #33906 technique), night interiors.
// Per-building hide mask: a 256x256 R8 texture indexed by the building's index
// within its tile (attribute aBid). The NYC dresser (nycDress.js) sets a texel
// to 255 when it has rebuilt that building with real geometry, and the shader
// facade for that building is discarded — the two never z-fight or double up.
let _nullHide = null;
function nullHideTex() {
  if (!_nullHide) {
    _nullHide = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat);
    _nullHide.needsUpdate = true;
  }
  return _nullHide;
}
export function makeHideTexture() {
  const t = new THREE.DataTexture(new Uint8Array(256 * 256), 256, 256, THREE.RedFormat);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  return t;
}
// one facade material per near tile: same shader program, own hide texture
export function makeTileFacadeMaterial() {
  const hideTex = makeHideTexture();
  const m = makeFacadeMaterial({ hideTex });
  m.userData.hideTex = hideTex;
  return m;
}

export function makeFacadeMaterial({ hideTex = null } = {}) {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0.0,
  });
  mat.userData.isFacade = true;
  const FACDEBUG = typeof location !== 'undefined' ? parseInt(new URLSearchParams(location.search).get('facdebug') || '0') : 0;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uHide = { value: hideTex || nullHideTex() };
    sh.uniforms.night = ENV.night;
    sh.uniforms.wet = ENV.wet;
    sh.uniforms.snowA = ENV.snow;
    sh.uniforms.uTimeF = ENV.time;
    sh.uniforms.t_sgn = { value: fasciaTexture() || nullHideTex() };
    sh.uniforms.t_brN = { value: GTEX.brN };
    sh.uniforms.t_brR = { value: GTEX.brR };
    sh.uniforms.sunDirW = ENV.sunDir;
    sh.uniforms.sunColW = ENV.sunColor;
    sh.uniforms.lbRoof = ENV.lbRoof;   // LB13
    sh.uniforms.lb14Roof = ENV.lb14Roof;   // LB14 — per-roof membrane value + speckle-scale spread (day only)
    skyReflUniforms(sh);
    for (const k of ['wA', 'wB', 'wC', 'wS', 'wP']) sh.uniforms['t_' + k] = { value: GTEX[k] };
    gtexRefPush(sh.uniforms); // async KTX2 arrivals refresh these (MEM41: weakly held)
    sh.defines = sh.defines || {};
    if (FACDEBUG) sh.defines.FACDEBUG = FACDEBUG;
    if (!NO_TOWER_FX) sh.defines.TOWERFX = 1;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aux; attribute vec4 aux2; attribute vec3 aux3; attribute float aBid;
        uniform sampler2D uHide; flat varying float vHide;
        varying vec2 vFUv; flat varying vec4 vAux; flat varying vec4 vAux2; flat varying vec3 vAux3; varying vec3 vWP;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vFUv = uv; vAux = aux; vAux2 = aux2; vAux3 = aux3;
        vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vHide = texture2D(uHide, vec2((mod(aBid, 256.0) + 0.5) / 256.0, (floor(aBid / 256.0) + 0.5) / 256.0)).r;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        flat varying float vHide;
        uniform float night; uniform float wet; uniform float snowA; uniform float uTimeF;
        uniform sampler2D t_brN; uniform sampler2D t_brR; uniform sampler2D t_sgn;
        uniform sampler2D t_wA; uniform sampler2D t_wB; uniform sampler2D t_wC; uniform sampler2D t_wS; uniform sampler2D t_wP;
        uniform vec3 sunDirW; uniform vec3 sunColW;
        uniform float lbRoof;   // LB13 — silver-membrane albedo trim (docs/notes/light-r13.md)
        uniform float lb14Roof; // LB14 — per-roof membrane value + speckle-scale spread (docs/notes/lb14.md)
        const bool RS30 = ${RS30 ? 'true' : 'false'};   // RS30 — roof patterns faded by their own width in pixels
        // per-building/per-wall constants MUST interpolate flat: perspective-correct
        // interpolation of equal vertex values wobbles by ~1 ulp per pixel, and a hash
        // amplifies that wobble on large seeds (cvar*511, wallSeed*53...) into per-pixel
        // white noise — this was THE window-stipple root cause (proven via facdebug=6)
        varying vec2 vFUv; flat varying vec4 vAux; flat varying vec4 vAux2; flat varying vec3 vAux3; varying vec3 vWP;
        ${SKYREFL_PARS}
        ${HASH_GLSL}
        ${WL11 ? `
        // WL11 — the GLSL twin of \`wlHash\` (exported above). Integer LCG mod a prime:
        // every intermediate is an exact integer below 2^24, so this lane and the JS in
        // heroFacades.js / nycDress.js return the same value bit for bit, which is what
        // lets the hero ring's appliqué frames land on the shader's jittered openings.
        // Feed it exact small integers only. Do not "simplify" it into hash12.
        // the two SQUARINGS break the affine chain: without them consecutive bays get an
        // arithmetic progression of offsets, i.e. a systematic lean instead of jitter.
        // max intermediate 4092^2 + 2411 = 16 746 875 < 2^24, so every step is exact.
        float wlh(float a, float b) {
          float s = mod(a * 127.0 + b * 311.0 + 7.0, 4093.0);
          s = mod(s * s + 1153.0, 4093.0);
          s = mod(s * 137.0 + 59.0, 4093.0);
          s = mod(s * s + 2411.0, 4093.0);
          return s * (1.0 / 4093.0);
        }
        float wlsg(float a, float b) { return wlh(a, b) * 2.0 - 1.0; }` : ''}
        ${SKYREFL_GLSL}
        vec3 FAC_emis; float FAC_rough; vec3 FAC_nrmAdj; float FAC_dbg; vec3 FAC_dbgV; vec3 FAC_grainV;
        // per-building reflectivity FAMILY, set once in the tower block and
        // read by the glass paths: x = F0, y = plate roughness, z = aureole
        vec3 FAC_glassF; vec3 FAC_reflTint; float FAC_spand;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        if (vHide > 0.5) discard;   // building rebuilt by the NYC dresser
        FAC_emis = vec3(0.0); FAC_rough = 0.92; FAC_nrmAdj = vec3(0.0); FAC_dbg = 0.0; FAC_dbgV = vec3(0.0); FAC_spand = 0.0; FAC_grainV = vec3(1.0);
        float floorH = vAux.x, winW = vAux.y, storeH = vAux.z, style = vAux.w;
        float bldgH = vAux2.x, litAmt = vAux2.y, flags = vAux2.w;
        // seed snapped to a coarse grid: belt-and-suspenders for any geometry path
        // where the flat qualifier can't guarantee bit-stability
        float cvar = floor(vAux2.z * 1024.0 + 0.5) * (1.0 / 1024.0);
        bool cornice = mod(flags, 2.0) >= 1.0;
        bool blind = mod(floor(flags / 2.0), 2.0) >= 1.0;
        ${BW28 ? 'if (blind && vAux2.x > 36.0 && vFUv.y > 26.0) blind = false;   // BW28: an exposed upper lot-line wall' : ''}
        bool isRoof = mod(floor(flags / 4.0), 2.0) >= 1.0;
        bool store = mod(floor(flags / 8.0), 2.0) >= 1.0;
        // ---- SKYSCRAPER PASS (docs/notes/skyscrapers.md, world/towers.js) ----
        // bit 16: mechanical penthouse / crown screen wall (louvred metal, lit
        // at night). bit 32: crown surface — with bit 16 it is the aviation
        // obstruction light on a mast tip, without it a floodlit masonry crown
        // tier (parapets, setback steps, pylons).
        bool mech = mod(floor(flags / 16.0), 2.0) >= 1.0;
        bool crownF = mod(floor(flags / 32.0), 2.0) >= 1.0;
        bool avLight = mech && crownF;
        // ---- WB13 (docs/notes/wburg-r13.md): the two outer-borough styles.
        // 14 FRAME_HOUSE — vinyl/aluminium lap siding over a frame or re-clad
        // masonry house, 2-3 storeys, flat roof, boxed cornice, white trim.
        // 15 CONDO_NEW  — the post-2000 4-9 floor condo: big openings, panel and
        // thin-set brick, slab edges, roof deck.
        // With ?wb13=0 both stay false and the (re-opened) \`style > 11.5\` tests
        // below put them back on NYCHA red brick, which is the round-12 look.
        bool sidingS = ${WB13 ? 'style > 13.5 && style < 14.5' : 'false'};
        bool condoS  = ${WB13 ? 'style > 14.5 && style < 15.5' : 'false'};
        // ---- E10 (edges-r10 §2): bit 64 says "this prism knows its OWN height, in
        // metres, in aux3.z" and bit 128 says "and it is the roof-side face of it".
        // aux3.z is the door pack on a windowed wall and unused (0) on every blind and
        // mech prism in the city, so this costs no attribute and no draw call — it is
        // the one datum a parapet or a bulkhead needs to place a contact: v alone is
        // height above the BUILDING base, and a parapet's own foot is where the roof
        // membrane turns up onto it, 60 m higher.
        float faceH = mod(floor(flags / 64.0), 2.0) >= 1.0 ? vAux3.z : 0.0;
        bool faceIn = mod(floor(flags / 128.0), 2.0) >= 1.0;
        vec3 albedo = diffuseColor.rgb * (0.92 + 0.16 * cvar);
        float u = vFUv.x, v = vFUv.y;
        // ---- REFLECTIVITY FAMILIES (facades-r6 §1). classify.mjs hands out
        // pastel glassBlue/glassGreen at 0.5-0.7 DIFFUSE, and no reflection
        // gain can make a 0.6-albedo wall read as glass: its own diffuse
        // swamps the mirror. Manhattan's real curtain-wall families are dark
        // (0.03-0.10 diffuse) and reflective (8-30 %), so albedo, F0, plate
        // roughness and reflection tint are picked TOGETHER, per building,
        // from one hash. Masonry families stay matte stone with only a
        // grazing sheen.
        //   FAC_glassF = (F0, plate roughness, solar aureole strength)
        bool fGlass = (style > 2.5 && style < 3.5) || (style > 10.5 && style < 11.5);
        float famR = hash12(vec2(floor(cvar * 233.0), 31.7));
        vec3 famAlb;
        if (fGlass) {
          if (famR < 0.30) {          // bronze / near-black glass (Seagram, 9 West 57th)
            famAlb = vec3(0.036, 0.028, 0.021); FAC_glassF = vec3(0.26, 0.055, 1.9);
            FAC_reflTint = vec3(1.06, 0.95, 0.80);
          } else if (famR < 0.62) {   // blue-green vision glass (the postwar default)
            famAlb = vec3(0.030, 0.052, 0.055); FAC_glassF = vec3(0.15, 0.045, 1.6);
            FAC_reflTint = vec3(0.82, 0.98, 1.02);
          } else if (famR < 0.84) {   // silver / clear low-iron (One Vanderbilt, Hearst)
            famAlb = vec3(0.052, 0.056, 0.062); FAC_glassF = vec3(0.10, 0.038, 1.5);
            FAC_reflTint = vec3(0.97, 0.99, 1.02);
          } else {                    // warm gold-tinted reflective coating
            famAlb = vec3(0.062, 0.050, 0.030); FAC_glassF = vec3(0.30, 0.060, 2.1);
            FAC_reflTint = vec3(1.10, 0.98, 0.74);
          }
        } else {
          famAlb = vec3(1.0); FAC_glassF = vec3(0.045, 0.55, 0.5);
          FAC_reflTint = vec3(1.0);
        }

        if (!isRoof && v < 0.02) {
          // below-grade foundation course: rusticated stone/brick, darker and coarser
          float course = step(0.5, fract(v / 0.42));
          float blocks = hash12(vec2(floor(u / 1.1), floor(v / 0.42) + cvar * 41.0));
          vec3 fndStone = mix(vec3(0.32, 0.28, 0.24), vec3(0.42, 0.38, 0.33), blocks) * (0.85 + 0.1 * course);
          // TERRAIN FIX: on a slope the raised floor can leave metres of base exposed downhill: below a 0.6 m stone water
          // table the building's own wall material carries on to the ground (its colour in courses, no windows), never a
          // plain beige box
          float wc = step(0.5, fract(v / 0.075 + step(0.5, fract(u / 0.21)) * 0.5)), wb = hash12(vec2(floor(u / 0.21), floor(v / 0.075) + cvar * 17.0));
          float wfade = smoothstep(0.06, 0.02, fwidth(v));   // (the courses fade to their mean before they alias)
          vec3 fndWall = albedo * (0.90 + wfade * (0.10 * wc + 0.10 * wb - 0.10));
          albedo = v > -0.6 ? fndStone : fndWall;
          FAC_rough = v > -0.6 ? 0.96 : 0.92;
        } else if (isRoof) {
          // NYC roof membranes — DATA-DRIVEN from the compiler's packed roof
          // byte via aux.z (1 silver coat, 2 dark EPDM/tar, 3 gravel ballast,
          // 4 pavers on pedestals, 5 sedum green roof, 6 mansard slate;
          // 0 = legacy hash pick for hip fills etc). Seams, wear, patches.
          // RF13: the roof plane is measured in the BUILDING'S frame — assemble.js roofFill() hands the
          // longest parapet edge's angle and first vertex in aux3 — so seams, blotches, drains and the
          // dresser's texture all run along the building instead of along world X/Z (owner 2026-09-16:
          // "avoid non-aligned textures on the rooftops"). aux3 = 0 (legacy call sites) keeps world space.
          vec2 rp = vWP.xz;
          if (abs(vAux3.x) + abs(vAux3.y) + abs(vAux3.z) > 1e-4) {
            vec2 dR = vWP.xz - vAux3.yz;
            float cR = cos(vAux3.x), sR = sin(vAux3.x);
            rp = vec2(cR * dR.x + sR * dR.y, -sR * dR.x + cR * dR.y);
          }
          float membF = vAux.z;
          float kindR = hash12(vec2(floor(cvar * 253.0), 7.31));
          if (membF > 0.5 && membF < 3.5) kindR = membF < 1.5 ? 0.2 : membF < 2.5 ? 0.5 : 0.7;
          float wear = fbm(rp * 0.13 + cvar * 19.0);
          // fine grain is derivative-faded to its mean (stipple rule: raw
          // vnoise(rp*5) was per-pixel shimmer from every aerial vantage);
          // a 2-5m blotch layer carries the visible variation instead —
          // real membranes are SMOOTH with soft coating blotches
          float rFp = max(fwidth(rp.x), fwidth(rp.y));
          // RS30: vnoise(rp * 5) has a 0.2 m period, so at a 0.12 m footprint it was under 2 px a period and still whole
          float microVis = RS30 ? smoothstep(0.08, 0.025, rFp) : smoothstep(0.5, 0.12, rFp);
          // LB14 (docs/notes/lb14.md, critic r14 runner-up): the membrane speckle was ONE noise at ONE
          // SCALE on every roof in the frame — only its phase varied (cvar), which reads as the same
          // material stamped over the whole block. Two decorrelated per-building draws give each roof
          // its own granule scale and its own coating value; the value spread is also what widens the
          // per-roof span the critic measured at 100 against the photograph's 154, and it lifts p95
          // WITHOUT lowering p50 (which lbRoof 0.78 -> 0.70 would have done — see the notes).
          // lb14Roof is 0 on every non-day preset, so golden/dusk/night are bit-identical.
          float rScl = 1.0 + lb14Roof * 0.30 * (hash12(vec2(floor(cvar * 173.0), 5.17)) * 2.0 - 1.0);
          float rVal = 1.0 + lb14Roof * 0.27 * (hash12(vec2(floor(cvar * 311.0), 13.9)) * 2.0 - 1.0);
          float micro = mix(0.5, vnoise(rp * 5.0 * rScl + cvar * 7.0), microVis);
          float blotch = fbm(rp * 0.31 * (2.0 - rScl) + cvar * 11.0);
          // RF13 MEMBRANE ROLL SEAMS: a coated or bituminous roof is laid in 0.91 m (36 in) rolls along the
          // building's long axis, each lap a faint raised line; the seams are what make a big flat roof read
          // as a roof and not as one tiled texture (owner 2026-09-16: "excessively tiled rooftop textures
          // without details"). AA'd against the screen derivative and faded out where a roll is under ~2 px.
          float rollW = 0.914;
          float rollV = rp.y / rollW;
          float rollAA = max(fwidth(rollV), 1e-4);
          // RS30: the lap line is 7 % of a roll, so at 5.5 px a roll (the old full-strength limit) it was 0.4 px wide
          // (seamL is 1 across ~95 % of a roll and 0 on the lap, so the fade keeps that mean under the old envelope and
          // takes out only the lap pattern: the calibrated LB13/LB14 roof tones stay at every distance)
          float rollEnv = smoothstep(0.6, 0.18, rollAA);
          float rollVis = RS30 ? smoothstep(0.15, 0.05, rollAA) : rollEnv;
          float seamRaw = smoothstep(0.045 + rollAA, 0.0, abs(fract(rollV) - 0.5) * 2.0 - 0.93);
          float seamL = (RS30 ? mix(0.95, seamRaw, rollVis) : seamRaw) * rollEnv;
          float rollTint = (hash12(vec2(floor(rollV), cvar * 53.0)) - 0.5) * 0.06 * rollVis;   // roll-to-roll batch tint
          vec3 roofC;
          bool patterned = false; // pavers/sedum/slate carry their own detail
          bool copperF = false;   // CR24 verdigris copper: keeps its own albedo (no colour-keep test, no membrane terms)
          if (membF > 6.5 && membF < 7.5) {
            // ---- CR24 VERDIGRIS COPPER (Columbia's McKim roofs, domes and dormers; assemble.js crBuild). The vertex
            // colour is the patina base (mint verdigris, the paler grey-green, lead, painted metal); uv.x runs along the
            // eave in metres and uv.y is the height above the eave, so the standing seams run DOWN every slope and the
            // gutter line is where the drip darkens it. Patina is a matte mineral crust: dielectric, rough, no sheen.
            float sx = vFUv.x / 0.46;
            float sAA = max(fwidth(sx), 1e-4);
            // RS30 (owner 2026-09-28: "rooftop shimmering is still a problem for Columbia University"): the rib is ~12 %
            // of a pan, so at the aerial's 2-3 px a pan it was a quarter-pixel line that the six jittered samples of a
            // recorded frame caught on some frames and missed on others; it now fades out before it is under 0.7 px
            // wide and is whole only from 1.8 px (a pan of 15 px), its mean darkening kept where it is gone. The
            // sheet-to-sheet tint (one random value a pan) and the run-off streaks (0.6 m) fade by their own size too.
            float sEnv = smoothstep(0.75, 0.22, sAA);
            float sVis = RS30 ? smoothstep(0.171, 0.0667, sAA) : sEnv;
            float sd = abs(fract(sx) - 0.5) * 2.0;                        // 0 mid-pan, 1 on the seam
            float rib = smoothstep(0.86 - sAA, 0.95, sd) * sVis;
            float ribLit = smoothstep(0.80 - sAA, 0.88, sd) * (1.0 - rib) * sVis;
            float pan = floor(sx);
            float hy = vFUv.y;
            vec3 base = diffuseColor.rgb;
            float pT = (hash12(vec2(pan, cvar * 97.0)) - 0.5) * (RS30 ? smoothstep(0.5, 0.2, sAA) : 1.0);   // sheet-to-sheet patina batch
            float blt = fbm(vec2(vFUv.x, hy) * 0.28 + cvar * 13.0);         // soft weathering blotches
            float strk = vnoise(vec2(vFUv.x * 1.6 + cvar * 31.0, hy * 0.20)); // run-off streaks down the slope
            float strkV = RS30 ? smoothstep(0.45, 0.15, fwidth(vFUv.x * 1.6)) : 1.0;
            vec3 cu = base * (0.92 + 0.12 * pT + 0.22 * (blt - 0.5));
            cu = mix(cu, base * vec3(0.70, 0.80, 0.74), mix(0.10, smoothstep(0.58, 0.88, strk), strkV) * 0.42);
            cu = mix(cu, base * vec3(0.46, 0.44, 0.38), smoothstep(0.55, 0.0, hy) * 0.40);   // the drip over the gutter
            cu *= 1.0 - rib * 0.24;
            cu *= 1.0 + ribLit * 0.07;
            if (RS30) cu *= 1.0 - (sEnv - sVis) * 0.017;   // the ribs' mean where the new fade has taken them and the old had not
            roofC = cu;
            FAC_rough = 0.76 + 0.08 * blt;
            patterned = true;
            copperF = true;
          } else if (membF > 5.5) {         // mansard slate: horizontal shingle courses
            float crs = vWP.y / 0.34;
            float cAA = max(fwidth(crs), 1e-4);
            float cLine = smoothstep(0.1 + cAA, 0.0, abs(fract(crs) - 0.5) * 2.0 - 0.8);
            float shTint = hash12(vec2(floor(crs), floor(rp.x * 1.4) + cvar * 31.0));
            // RS30: 0.34 m courses were drawn at full contrast at any distance; they and the shingle tints fade from 8 px
            // a course to 3 px, to their means (the course line darkens ~85 % of a course by 0.35)
            float cVis = RS30 ? smoothstep(0.34, 0.12, cAA) : 1.0;
            shTint = mix(0.5, shTint, cVis);
            roofC = mix(vec3(0.14, 0.15, 0.17), vec3(0.2, 0.21, 0.24), shTint) * (1.0 - mix(0.30, cLine * 0.35, cVis));
            FAC_rough = 0.75;
            patterned = true;
          } else if (membF > 4.5) {  // sedum: mottled planting with dry patches
            float sed = fbm(rp * 0.8 + cvar * 5.0);
            float dry = smoothstep(0.72, 0.95, vnoise(rp * 1.7 + cvar * 9.0));
            vec3 g1 = vec3(0.20, 0.28, 0.12), g2 = vec3(0.36, 0.34, 0.16), g3 = vec3(0.32, 0.24, 0.15);
            roofC = mix(mix(g1, g2, smoothstep(0.3, 0.72, sed)), g3, dry);
            roofC *= 0.92 + 0.2 * mix(0.5, vnoise(rp * 7.0), RS30 ? smoothstep(0.05, 0.016, rFp) : microVis);
            FAC_rough = 0.97;
            patterned = true;
          } else if (membF > 3.5) {  // pavers on pedestals: 0.6m grid, AA'd joints
            vec2 pv = rp / 0.6;
            vec2 pAA = max(fwidth(pv), vec2(1e-4));
            float jx = smoothstep(0.05 + pAA.x, 0.0, abs(fract(pv.x) - 0.5) * 2.0 - 0.9);
            float jz = smoothstep(0.05 + pAA.y, 0.0, abs(fract(pv.y) - 0.5) * 2.0 - 0.9);
            float pTint = hash12(floor(pv) + cvar * 43.0);
            // RS30: the joint pattern (max(jx, jz) is 1 over all but the joint crossings, mean ~0.99) and the per-paver tint
            // fade from 15 px a paver to 5 px, to their means
            float pVis = RS30 ? smoothstep(0.2, 0.067, max(pAA.x, pAA.y)) : 1.0;
            pTint = mix(0.5, pTint, pVis);
            roofC = mix(vec3(0.42, 0.405, 0.38), vec3(0.52, 0.5, 0.468), pTint) * (1.0 - mix(0.297, max(jx, jz) * 0.3, pVis)) * (0.8 + 0.25 * wear);
            FAC_rough = 0.9;
            patterned = true;
          } else if (kindR < 0.34) { // aged silver coating: smooth, soft blotches
            // LB13 (docs/notes/light-r13.md): lbRoof trims THIS branch only. Measured on the
            // lens-matched Lenox pair, the west-side roof block rendered L p50 205 with a p50->p95
            // span of 14 against the photograph's 180 and 52 — i.e. the membrane was not merely two
            // stops hot, it was sitting on the tone curve's shoulder, where the blotches, the roll
            // seams and the ponding are all squeezed into 14 sRGB. The albedo comes back down the
            // curve so the detail that is already in the shader can be seen. Uniform, not a constant,
            // so a session can sweep it live (window.__ENV.lbRoof.value); 1.0 under ?lb13=0.
            // LB14: the LEVEL of this membrane is right and its SPREAD is a fifth of the photograph's.
            // Same rect, same roof block, lens-matched Lenox pair: ours p50 184 / p95 193 (span 9),
            // the reference capture p50 178 / p95 231 (span 53). Dropping lbRoof to 0.70 (LB13's open
            // item 3) would land the p50 and take the p95 to ~193 — i.e. make critic r14 #1 (no top
            // end) strictly worse. Widen the coating blotch about its own midpoint instead, and give
            // each roof its own value (rVal) and its own granule scale (rScl). mix(x, y, 0) is exact,
            // so lb14Roof = 0 on golden/dusk/night is bit-identical to r13.
            vec3 rSil = mix(vec3(0.5, 0.495, 0.475), vec3(0.585, 0.575, 0.54), blotch);
            vec3 rMid = vec3(0.5425, 0.535, 0.5075);
            rSil = mix(rSil, rMid + (rSil - rMid) * 3.4, lb14Roof);
            roofC = rSil * (0.8 + 0.22 * wear) * lbRoof * rVal;
            roofC *= 0.96 + 0.08 * micro; // faint granule sparkle, derivative-faded
            FAC_rough = 0.6 + wear * 0.22 + blotch * 0.1;
          } else if (kindR < 0.62) { // black tar / smooth bitumen
            roofC = mix(vec3(0.085, 0.085, 0.09), vec3(0.12, 0.115, 0.11), blotch) * (0.9 + 0.2 * wear);
            roofC *= 0.94 + 0.12 * micro;
            FAC_rough = 0.62 + blotch * 0.2; // sheen varies at blotch scale, not per pixel
          } else if (kindR < 0.85) { // gravel ballast: real granularity, mip-faded
            float grv = mix(0.5, vnoise(rp * 11.0), RS30 ? smoothstep(0.035, 0.011, rFp) : microVis);
            roofC = mix(vec3(0.28, 0.255, 0.222), vec3(0.39, 0.365, 0.322), grv) * (0.84 + 0.22 * wear);
            roofC *= 0.94 + 0.12 * blotch;
            FAC_rough = 0.98;
          } else {                   // gray EPDM membrane: near-uniform, soft blotches
            roofC = mix(vec3(0.24, 0.245, 0.255), vec3(0.29, 0.295, 0.30), blotch) * (0.9 + 0.16 * wear);
            roofC *= 0.97 + 0.06 * micro;
            FAC_rough = 0.85;
          }
          if (!patterned) {
            // RF13: the roll seams now come from the building-frame pass above (rollV / seamL); the old seams ran at a
            // RANDOM angle per building and were exactly the "non-aligned rooftop texture" the owner called out.
            // Repair patches (RF13): a real roof carries a FEW small flashed-in patches, not a 9 % field of 3.6 m black
            // squares plus an 8.4 m family (final_v17 / roofs13 plates read as tiled blocks from 150 m). Rate 2 %, the
            // patch fills only the middle ~55 % of its cell (1.6-2.2 m), 40 % darker with a light mastic rim.
            vec2 pcQ = rp / 3.6 + cvar * 53.0;
            vec2 pc = floor(pcQ);
            float pr = hash12(pc);
            if (pr < 0.02) {
              vec2 pf = fract(pcQ);
              vec2 pin = vec2(0.18 + hash12(pc + 7.0) * 0.14, 0.18 + hash12(pc + 13.0) * 0.14);   // per-patch margins
              float pe = min(min(pf.x - pin.x, 1.0 - pin.x - pf.x), min(pf.y - pin.y, 1.0 - pin.y - pf.y));
              float inP = smoothstep(0.0, 0.05, pe);
              roofC = mix(roofC, roofC * 0.6, inP * 0.9);                                        // the patch, a shade darker
              roofC = mix(roofC, roofC * 1.3 + vec3(0.02), smoothstep(0.05, 0.0, pe) * step(-0.04, pe) * 0.5); // mastic rim
            }
          }
          // soot pooling
          roofC *= 1.0 - smoothstep(0.55, 0.95, wear) * 0.25;
          ${MAT9 ? `
          // ---- MAT9: PONDING. §2.2 measured our roof membranes at 16-17 % sd/mean
          // against the reference's 15-30 %, so the roofs are NOT too flat — the variation
          // is simply not organised. In ref_lenox every roof reads as water: dark standing
          // pools in the hollows, a tan drying rim around each one, rust where a pool has
          // sat for years, and the darkest run pooled against the parapet. Anchoring all
          // of it to ONE low-frequency field instead of three independent fbms is what
          // turns it from noise into water. Low frequency (0.24 c/m ≈ a 4 m feature), so
          // it cannot alias at any framing, and it costs one fbm on roof fragments only.
          if (!patterned) {
            float pond = fbm(rp * 0.24 + cvar * 31.0);
            float ponW = smoothstep(0.36, 0.76, pond);
            roofC *= 1.0 - ponW * 0.28;                                   // standing water
            FAC_rough = mix(FAC_rough, 0.46, ponW * 0.5);                 // ...and it glosses
            float rim = smoothstep(0.24, 0.37, pond) * (1.0 - smoothstep(0.37, 0.54, pond));
            roofC = mix(roofC, roofC * vec3(1.18, 0.96, 0.72), rim * 0.6); // tan drying rim
            // RF13: rust only where a pool has sat for years — 3 % of 2.6 m cells, not 13 % (the orange squares on every dark roof)
            if (hash12(floor(rp / 2.6 + cvar * 71.0)) > 0.97) roofC = mix(roofC, vec3(0.24, 0.14, 0.09), rim * 0.4 + 0.06);
          }` : ''}
          ${E10 ? `
          // ---- E10 (brief B/C): THE PARAPET RIM AND THE DRAINS.
          // r8 blind finding 3 ("nothing on a roof is stained... a dark rim where water
          // and soot pool against the parapet") was handed to the shader and the shader
          // could not do it, because the roof deck is earcut from the footprint ring and
          // therefore has NO interior vertices: every vertex is on the boundary, so a
          // per-vertex distance-to-edge is identically zero. assemble.js roofFill() now
          // emits a 1.25 m rim BAND between the ring and its inset before the earcut, and
          // carries the distance in uv.x as (1 + metres) so 0 still means "no rim data"
          // (hip fills, tower caps that have not been converted). +2 triangles per ring
          // edge, no draw call, no attribute.
          // The drains are a hash grid rather than real positions — a roof drain is at a
          // low point and ours are where the ponding field is low, which is the same
          // statement — and each carries the tar boot and the mastic ring that a real one
          // is flashed in with. Everything here is a 0.3-4 m feature.
          if (!patterned) {
            // 1.16 not 1.25: the inset fill carries the band's far edge exactly, so this
            // skips the whole interior of the deck instead of running four smoothsteps
            // that are all identically zero there.
            float rimD = vFUv.x > 0.5 ? vFUv.x - 1.0 : 99.0;
            if (rimD < 1.16) {
              float rN = 0.45 + 0.55 * fbm(rp * 0.55 + cvar * 43.0);
              roofC *= 1.0 - smoothstep(1.15, 0.0, rimD) * rN * 0.34;     // silt and soot pooled at the upstand
              roofC = mix(roofC, roofC * vec3(0.72, 0.70, 0.68), smoothstep(0.42, 0.0, rimD) * 0.7);
              FAC_rough = mix(FAC_rough, 0.72, smoothstep(0.5, 0.0, rimD) * 0.5);
            }
            // 21 m cell at 52 %: a real roof has two to four drains, not one every 16 m.
            // The boot SIZE varies per cell (0.75-1.35x) — round 10's other half is the
            // uniformity brief, and a field of identical discs is exactly the tell it is
            // about (roofs-r9 blind finding 2: "the pale 1 m squares are the loudest CG
            // tell on every roof").
            vec2 dC = rp / 21.0 + cvar * 29.0;
            vec2 dId = floor(dC);
            if (hash12(dId + 3.1) < 0.52) {
              vec2 dOff = vec2(hash12(dId + 8.7), hash12(dId + 15.3)) * 0.66 + 0.17;
              float dS = 0.75 + 0.60 * hash12(dId + 21.9);
              float dR = length((fract(dC) - dOff) * 21.0) / dS;
              roofC *= 1.0 - smoothstep(5.0, 1.1, dR) * 0.13;                                  // the sump the deck falls to
              roofC = mix(roofC, roofC * 1.22 + vec3(0.022), smoothstep(0.62, 1.35, dR) * smoothstep(2.0, 1.35, dR) * 0.4); // mastic ring
              roofC = mix(roofC, vec3(0.055, 0.052, 0.048), smoothstep(1.25, 0.42, dR) * 0.78); // tar boot
              FAC_rough = mix(FAC_rough, 0.55, smoothstep(1.1, 0.3, dR) * 0.6);
            }
          }` : ''}
          if (!patterned) roofC *= (1.0 - seamL * 0.10) * (1.0 + rollTint);   // RF13 roll seams + batch tint on coated/bitumen/gravel
          albedo = roofC;
          if (!copperF && diffuseColor.g > diffuseColor.r * 1.25 && diffuseColor.g > diffuseColor.b * 1.12) { // copper verdigris only: greens, not blue-glass teals
            albedo = diffuseColor.rgb * (0.85 + 0.2 * blotch + 0.1 * micro);
            FAC_rough = 0.6;
          }
          if (snowA > 0.003) { // roof snow cap (roof-flagged faces are up-facing)
            float rsm = clamp(snowA * (0.5 + 0.9 * (vnoise(vWP.xz * 0.42) * 0.5 + vnoise(vWP.xz * 0.09) * 0.5)), 0.0, 1.0);
            albedo = mix(albedo, vec3(0.87, 0.895, 0.94), rsm);
            FAC_rough = mix(FAC_rough, 0.62, rsm);
          }
        } else if (!blind) {
          bool glassStyle = (style > 2.5 && style < 3.5) || (style > 10.5 && style < 11.5);
          bool loftStyle = (style > 5.5 && style < 7.5);
          // per-wall bay layout (PR frame.bays): whole bays only, remainder becomes
          // corner margins — a window can NEVER be sliced by a building corner
          float wallLen = max(vAux3.x, 0.01);
          float wallSeed = floor(vAux3.y * 128.0 + 0.5) * (1.0 / 128.0); // hash seed — snap to grid
          float bayN = floor((wallLen - 0.44) / winW);
          float sideM = (wallLen - max(bayN, 0.0) * winW) * 0.5;
          float cuC = (u - sideM) / winW, cvC = v / floorH;
          float fx = fract(cuC), fy = fract(cvC);
          float cellU = floor(cuC), cellV = floor(cvC);
          float cellUS = cellU + wallSeed * 37.0; // decorrelate walls in hashes
          bool inBay = bayN >= 1.0 && cuC >= 0.0 && cuC < bayN;
          float x0 = 0.2, x1 = 0.8, y0 = 0.3, y1 = 0.88;
          if (glassStyle) { x0 = 0.05; x1 = 0.95; y0 = 0.08; y1 = 0.96; }
          if (loftStyle) { x0 = 0.1; x1 = 0.9; y0 = 0.14; y1 = 0.92; }
          // ---- WB13. The frame house's opening is UNDERSIZED and that is the point:
          // a 0.81 x 1.37 m vinyl replacement unit sits inside a 19th-century hole in a
          // 2.0-2.4 m bay with a 2.90 m floor, the difference panned over in flat coil
          // (docs/typology/08-vinyl-rowhouse.md §5). The generic residential 0.2-0.8
          // x 0.3-0.88 draws a 1.44 m sash, i.e. a tenement window on a house.
          if (sidingS) { x0 = 0.30; x1 = 0.70; y0 = 0.28; y1 = 0.80; }
          // ...and the condo is the opposite tell: floor-to-ceiling-ish glazing filling
          // most of the bay, which is what separates the two at a block's distance.
          if (condoS) { x0 = 0.10; x1 = 0.90; y0 = 0.16; y1 = 0.94; }
          // exact box-filtered window coverage per pixel: cannot stipple at ANY
          // view angle/minification (point-sampled fract() wraps within a pixel on
          // up-views and turned the window/wall decision into per-pixel noise)
          float aaU = max(fwidth(cuC), 1e-4), aaV = max(fwidth(cvC), 1e-4);
          // WL11 — the BASE opening, kept for the three places that run a PERIODIC pcov
          // over x0/x1/y0/y1 (the pier rhythm and the masonry-tower spandrel). pcovI
          // carries floor(x)*(hi-lo) across a cell boundary, so feeding it a per-cell
          // (lo,hi) draws a bright line down every pier. Those keep the base pair.
          float xb0 = x0, xb1 = x1, yb0 = y0, yb1 = y1;
          ${WL11 ? `
          // ---- WL11 (brief B): THE LATTICE. Three blind packs in a row named the window
          // grid, and the grid really is exact: every bay is winW wide to the micron and
          // every sill sits at 0.30 of its floor on every building in the city. A real
          // facade is laid out by a mason from both ends of a wall, so bay to bay it
          // drifts by a couple of per cent and no two sills are at the same height to the
          // centimetre — refs/streetview/morningside shows sills DEAD level across a floor
          // (which is why the amplitude here is ±2 cm and not ±10) but bays that pair and
          // breathe. Three independent per-bay numbers:
          //   * \`off\` slides the opening inside its bay (±2.8 % of the bay ≈ ±7 cm),
          //   * \`wsc\` scales the opening width (±2.6 %),
          //   * \`sJ\`/\`lJ\` move the sill and the lintel INDEPENDENTLY by ±2 cm, so the
          //     opening HEIGHT varies too, which is what a replaced unit in an old hole
          //     actually looks like.
          // THE CELL INDEX NEVER MOVES — only the opening inside it — which is the whole
          // door-bay guarantee: assemble.js doorAnchors, nycDress and heroFacades all put
          // the entrance at sideM + (bay + 0.5)*ww and that arithmetic is untouched. The
          // door bay is additionally pinned to zero jitter below, belt and braces.
          // \`wlh\` (not hash12) because heroFacades.js has to reproduce these three
          // numbers exactly in JS — see docs/notes/lattice-r11.md §3.
          float cvI = floor(vAux2.z * 1024.0 + 0.5);       // exact integer, same value in JS
          float wlDC = vAux3.z >= 8.0 ? floor(vAux3.z / 8.0) - 1.0 : -1.0;
          float wlPin = (cellU == wlDC) ? 0.0 : 1.0;       // the door bay does not move. ever.
          float bk = clamp(cellU, 0.0, 4090.0) + 1.0;
          float off = wlsg(cvI + 17.0, bk) * 0.028 * wlPin;
          float wsc = 1.0 + wlsg(cvI + 53.0, bk) * 0.026 * wlPin;
          // per-OPENING (bay x floor) index, wrapped to 64x64 so a*127 + b*311 stays an
          // exact integer below 2^24 in a float32 lane (see wlHash's contract)
          float bkv = mod(cellU, 64.0) + mod(cellV, 64.0) * 64.0 + 1.0;
          float sJ = wlsg(cvI + 89.0, bkv) * (0.02 / max(floorH, 2.0));
          float lJ = wlsg(cvI + 131.0, bkv) * (0.02 / max(floorH, 2.0));
          x0 = 0.5 + (x0 - 0.5) * wsc + off;
          x1 = 0.5 + (x1 - 0.5) * wsc + off;
          y0 += sJ; y1 += lJ;
          // the jitter has to be GONE before a bay reaches a pixel: cellU decorrelates per
          // pixel under minification, so a per-cell offset that survived there would be the
          // window stipple this project spent two rounds removing (tflick gate).
          float jFade = smoothstep(0.30, 0.09, aaU);
          x0 = mix(xb0, x0, jFade); x1 = mix(xb1, x1, jFade);
          y0 = mix(yb0, y0, jFade); y1 = mix(yb1, y1, jFade);` : ''}
          ${WL11 ? `
          // WL11 — coverage with a per-cell opening. The periodic pcov is still the right
          // answer at any minification (it converges to the mean); the in-cell box filter
          // is the right answer once one cell owns the pixel footprint. Blend on the same
          // jFade, so wherever the jitter is live the box filter is what is being read and
          // wherever pcov's periodicity matters the jitter is already zero.
          float hwU = aaU * 0.625, hwV = aaV * 0.625;
          float covU = mix(pcov(cuC, xb0, xb1, aaU * 1.25),
                           clamp((min(fx + hwU, x1) - max(fx - hwU, x0)) / max(2.0 * hwU, 1e-5), 0.0, 1.0), jFade);
          float covV = mix(pcov(cvC, yb0, yb1, aaV * 1.25),
                           clamp((min(fy + hwV, y1) - max(fy - hwV, y0)) / max(2.0 * hwV, 1e-5), 0.0, 1.0), jFade);` : `
          float covU = pcov(cuC, x0, x1, aaU * 1.25);
          float covV = pcov(cvC, y0, y1, aaV * 1.25);`}
          float winMask = covU * covV;
          if (v > bldgH - 0.8 || v < 0.15 || !inBay) winMask = 0.0;
          // entrance door bay: ONE per building, on the compiler-scored street
          // wall — assemble packs (bay+1)*8 + color*2 into aux3.z (0 = no door),
          // and heroFacades reads the same values, so shader and hero geometry
          // always agree on wall, bay and paint color
          float doorPack = vAux3.z;
          float doorCell = floor(doorPack / 8.0) - 1.0;
          float doorColI = mod(floor(doorPack / 2.0), 4.0);
          bool doorWall = doorPack >= 8.0 && bayN >= 1.0 && !store && !glassStyle && wallLen > 3.6;
          if (doorWall && cellU == doorCell && v < 3.6) winMask = 0.0;
          float wlBrick = 0.0;
          ${WL11 ? `
          // ---- WL11: BRICKED-UP OPENINGS (brief B). Not one opening in 930k buildings is
          // filled in, and in New York they are everywhere: a light court that lost its
          // daylight when the neighbour built higher, a stair that was moved, a lot-line
          // wall that must be closed to satisfy the fire code when the next lot is
          // developed. They cluster HARD — on the two bays nearest a party wall, and often
          // as a whole vertical column of a light court, top to bottom.
          //   * not every building: a per-building gate at 38 %, so a block has a few;
          //   * end bays 20 %, the rest 2.5 %, and a 5 % chance the whole bay COLUMN goes;
          //   * never on the street wall's parlour floor, never on glass, and never on
          //     the door bay (a bricked door is a different, much rarer thing).
          // The opening keeps its sill and its lintel — that is what makes it read as a
          // filled opening and not as a patch of wall — and the infill itself is painted
          // in the masonry branch below (\`wlBrick\`), because from here on this fragment
          // IS wall.
          if (!glassStyle && inBay && bayN >= 2.0 && wlh(cvI + 211.0, 3.0) < 0.38) {
            float endB = (cellU < 0.5 || cellU > bayN - 1.5) ? 1.0 : 0.0;
            float colR = wlh(cvI + 307.0, clamp(cellU, 0.0, 4090.0) + 1.0);
            float opR = wlh(cvI + 401.0, bkv);
            float rate = mix(0.025, 0.20, endB);
            float br = (opR < rate || colR < 0.05) ? 1.0 : 0.0;
            // the street door's own two floors stay open. Tested on the CELL, not on v:
            // a per-fragment v test would brick the top half of an opening that straddles
            // the threshold and leave the bottom half glazed.
            if (doorWall && cellV < 1.5) br = 0.0;
            if (cellU == wlDC) br = 0.0;                       // and the door bay is never filled
            // ...and it fades out on the SAME footprint gate as the jitter. "This cell has
            // no window" is a per-cell decision, and a per-cell decision that survives
            // minification is a stipple: at 400 m adjacent pixels sample different cells
            // and the facade would boil. Beyond the gate every cell is a window again,
            // continuously — no pop, and nothing for tflick to find.
            br *= jFade;
            wlBrick = br * winMask;                            // the opening's own AA'd coverage
            winMask *= 1.0 - br;
          }` : ''}
          float tiny = smoothstep(0.28, 0.62, max(aaU, aaV));
          bool inWin = winMask > 0.5 && tiny < 0.9;
          float winFade = 1.0 - tiny;

          if (store && v < storeH) {
            FAC_dbg = 2.0;
            float band = storeH * 0.78;
            if (v > band) {
              // ---- STOREFRONT FASCIA (facades-r6 item 5). Critic r5 #19:
              // "flat coloured storefront stripes with no text" — this band
              // used to be one random hue per bay, on the ground floor of
              // every storefront building in the city. It now carries a
              // GENERATED SIGN from the 32-slot fascia atlas
              // (src/city/fasciaAtlas.js): one shop per ~7 m of frontage, the
              // slot picked from the building's own colorVar so a shop keeps
              // its name, and no real brand anywhere in the set.
              // Costs one texture and zero draw calls.
              float shopW = 7.0;
              float shopI = floor(u / shopW);
              ${U10 ? `
              // ---- U10: the atlas is 64 slots (4 x 16) and the pick is a
              // BIJECTION, not a hash. \`slot = (a * shopI + b) mod 64\` with \`a\`
              // forced odd is a full-cycle LCG over a power-of-two modulus, so
              // consecutive shops on one wall are guaranteed different slots.
              // The hash it replaces collided about 1 frontage in 16, which is
              // the 06:45 addendum's "ROYAL NAILS twice on 100 W 125th" — and
              // the restored retail125 plate shows exactly that failure, twice
              // on one frontage, because this block had been lost.
              // \`wallSeed\` is in the OFFSET because \`u\` is WALL-local and
              // restarts at 0 on every ring edge: without it a building made of
              // several prisms replays the same slot sequence on each wall.
              float fa = 1.0 + 2.0 * floor(hash12(vec2(cvar * 131.0, 3.7)) * 32.0);
              float fb = floor(hash12(vec2(cvar * 57.0 + wallSeed * 13.0, 9.1)) * 64.0);
              float slot = mod(fa * shopI + fb, 64.0);
              float sCol = mod(slot, 4.0);
              float sRow = floor(slot / 4.0);` : `
              float slot = floor(hash12(vec2(shopI * 3.17 + cvar * 91.0, 7.31)) * 32.0);
              float sCol = mod(slot, 2.0);
              float sRow = floor(slot / 2.0);`}
              float su = clamp((u - shopI * shopW) / shopW, 0.0, 1.0);
              float sv = clamp((v - band) / max(storeH - band, 0.01), 0.0, 1.0);
              vec2 sUV = vec2((sCol + su) * (1.0 / ${U10 ? '4.0' : '2.0'}),
                              1.0 - (sRow + 1.0 - sv) * (1.0 / 16.0));
              vec3 sgn = texture2D(t_sgn, sUV).rgb;
              // stipple rule: converge the sign to its own mean once a shop is
              // under ~20 px wide, so the letterforms can never alias (and the
              // one blurry texel column at the atlas seam disappears with them)
              float sVis = smoothstep(0.34, 0.06, max(fwidth(u), fwidth(v)));
              vec3 sMean = mix(vec3(0.14, 0.13, 0.13), sgn, 0.35);
              vec3 signCol = mix(sMean, sgn, sVis);
              albedo = signCol;
              // internally-lit sign boxes at night, plus a little by day
              FAC_emis += signCol * (night * (0.75 + 0.8 * hash12(vec2(shopI, cvar)))
                                   + (1.0 - night) * 0.10);
              FAC_rough = 0.52;
            } else {
              float bayS = floor(u / 4.0);
              float dust0 = vnoise(vec2(u * 0.3, v * 0.5 + cvar * 5.0)) * 0.3;
              float gate = hash12(vec2(bayS, cvar * 37.0));
              ${U10 ? `
              // ---- U10 (round-10 addendum, seen on the v14 retail125 plate).
              // The shutter was 14 % of bays and it was drawn as VERTICAL
              // stripes on a 0.3 m pitch in one grey — a real roll-down grille
              // has 5-6 cm HORIZONTAL slats, a dark hood box above the opening,
              // and it is never the same grey twice (galvanised, painted, tagged).
              // Rate up to 22 % because a daytime NYC block really does carry
              // one closed shop in four or five, and because a shuttered bay is
              // the cheapest way to break a run of identical glazed ones.
              if (gate < 0.22) {
                // 5.9 cm slats. THE STIPPLE RULE APPLIES: this is a 6 cm feature
                // on a wall read from 5 m to 300 m, so it is box-filtered by its
                // own footprint AND converged to its mean before it can reach a
                // pixel — a raw fract() ladder here would be the window stipple
                // this project spent a round removing, and this round's whole
                // claim is that variety must not add flicker.
                float slat = fract(v * 17.0);
                float sFw = fwidth(v) * 17.0;
                float sAA = clamp(sFw, 1e-4, 0.45);
                float ribV = smoothstep(0.50 - sAA, 0.50 + sAA, slat)
                           * (1.0 - smoothstep(0.86 - sAA, 0.86 + sAA, slat));
                float rib = mix(0.36, ribV, smoothstep(0.95, 0.25, sFw));
                float gTone = 0.30 + 0.34 * hash12(vec2(bayS * 3.3 + 7.0, cvar * 91.0));
                vec3 gCol = mix(vec3(gTone), vec3(gTone * 1.06, gTone * 0.99, gTone * 0.90),
                                step(0.62, hash12(vec2(bayS * 1.9, cvar * 23.0))));
                albedo = gCol * (0.80 + 0.30 * rib);
                albedo = mix(albedo, albedo * 0.42, smoothstep(band - 0.55, band - 0.18, v));
                float tg = hash12(vec2(bayS * 11.0, cvar * 53.0));
                if (tg < 0.34) albedo = mix(albedo, vec3(0.12, 0.10, 0.16),
                  smoothstep(0.55, 0.9, vnoise(vec2(u * 2.6, v * 3.4) + tg * 40.0)) * 0.55);
                FAC_rough = 0.62;
              }` : `
              if (gate < 0.14) { albedo = vec3(0.55) * (0.85 + 0.15 * sin(u * 21.0)); FAC_rough = 0.5; }`}
              else {
                // shop-window interior mapping (PR shopInterior): deep retail room
                float litS = step(0.18, hash12(vec2(bayS + 31.0, cvar * 71.0))); // 82% lit
                vec3 sLight = hash12(vec2(bayS, cvar * 3.0)) < 0.88
                  ? mix(vec3(0.87, 0.92, 1.0), vec3(0.93, 0.96, 1.0), gate)   // cool fluorescent
                  : mix(vec3(1.0, 0.85, 0.6), vec3(1.0, 0.92, 0.75), gate);   // warm halogen
                vec3 NnS = normalize(vNormal);
                vec3 rayS = normalize(-vViewPosition);
                vec3 upS = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
                vec3 TvS = normalize(cross(NnS, upS)); // exact +u direction (winding convention)
                vec3 BvS = normalize(cross(NnS, TvS));
                if (dot(BvS, upS) < 0.0) BvS = -BvS;
                float dotNS = dot(rayS, -NnS);
                float grazeS = smoothstep(0.05, 0.17, dotNS);
                vec3 rdS = vec3(dot(rayS, TvS), dot(rayS, BvS), max(0.04, dotNS));
                float RWs = 4.0, RHs = max(1.6, band - 0.5), RDs = RHs * 2.4 + 1.5;
                float rxS = clamp(u - bayS * 4.0, 0.0, RWs);
                float ryS = clamp(v - 0.45, 0.0, RHs);
                float txS = rdS.x > 0.0 ? (RWs - rxS) / max(rdS.x, 1e-4) : rxS / max(-rdS.x, 1e-4);
                float tyS = rdS.y > 0.0 ? (RHs - ryS) / max(rdS.y, 1e-4) : ryS / max(-rdS.y, 1e-4);
                float tzS = RDs / rdS.z;
                float tS = min(txS, min(tyS, tzS));
                vec3 hS = vec3(rxS, ryS, 0.0) + rdS * tS;
                vec3 qS = vec3(hS.x / RWs, hS.y / RHs, hS.z / RDs);
                float qdS = max(fwidth(qS.x), max(fwidth(qS.y), fwidth(qS.z)));
                float roomVisS = smoothstep(0.06, 0.015, qdS);
                float eAAS = clamp(qdS * 1.5, 0.004, 0.08);
                vec3 shopWall = mix(vec3(0.55, 0.52, 0.48), vec3(0.66, 0.64, 0.6), gate);
                vec3 room;
                if (tS == tzS) { // back wall: stocked shelves (footprint-faded)
                  float shelf = smoothstep(0.82 - eAAS * 5.0, 0.82 + eAAS * 5.0, fract(qS.y * 5.0));
                  ${U10 ? `
                  // ---- U10 (addendum: "big-box storefront glazing reads as FLAT
                  // PASTEL PANELS behind the glass"). Two faults, both here.
                  //  (1) the goods hash is keyed on the COLUMN only — all three
                  //      channels read floor(qS.x * 10.0) and none reads the shelf
                  //      ROW — so a stocked wall was full-height vertical bars.
                  //      That IS the pastel-panel read.
                  //  (2) the amplitude is 0.28 + 0.6 in three independent
                  //      channels: fully saturated primaries. A shelf of packaged
                  //      goods through glass at 25 m is a mid-dark speckle with a
                  //      little chroma, not a paint chart.
                  float gRow = floor(qS.y * 5.0);
                  float gCol = floor(qS.x * 12.0);
                  vec3 goods = 0.20 + 0.34 * vec3(hash12(vec2(gCol, gRow * 3.1 + bayS)),
                                                  hash12(vec2(gRow * 1.7 + bayS, gCol)),
                                                  hash12(vec2(gCol * 3.0 + 5.0, gRow + cvar * 77.0)));
                  goods = mix(vec3(dot(goods, vec3(0.33))), goods, 0.55);
                  // an opaque display backdrop with a poster on a third of bays,
                  // which is what a big-box window actually has
                  float bkd = hash12(vec2(bayS * 7.7 + 2.0, cvar * 61.0));
                  if (bkd < 0.34) {
                    vec3 card = mix(vec3(0.30, 0.29, 0.27), vec3(0.52, 0.50, 0.47), bkd * 2.4);
                    float pos = step(0.18, fract(qS.x * 2.0)) * step(0.28, qS.y) * step(qS.y, 0.82);
                    vec3 poster = 0.30 + 0.45 * vec3(hash12(vec2(floor(qS.x * 2.0), bayS + 3.0)),
                                                     hash12(vec2(bayS + 9.0, floor(qS.x * 2.0))),
                                                     hash12(vec2(floor(qS.x * 2.0) * 7.0, cvar * 13.0)));
                    goods = mix(card, mix(card, poster, 0.7), pos);
                    shelf *= 0.15;
                  }` : `
                  vec3 goods = 0.28 + 0.6 * vec3(hash12(vec2(floor(qS.x * 10.0), bayS)), hash12(vec2(bayS, floor(qS.x * 10.0))), hash12(vec2(floor(qS.x * 10.0) * 3.0, cvar * 77.0)));`}
                  vec3 stocked = mix(mix(shopWall * 0.7, goods, 0.6), shopWall * 0.45, shelf);
                  room = mix(shopWall * 0.6, stocked, roomVisS);
                } else if (tS == tyS) {
                  if (rdS.y < 0.0) { // terrazzo floor w/ dark seams + counter shadow
                    float tile = smoothstep(0.93 - eAAS * 6.0, 0.93 + eAAS * 6.0, max(fract(qS.x * 6.0), fract(qS.z * 6.0)));
                    vec3 terr2 = mix(mix(vec3(0.5, 0.47, 0.43), vec3(0.58, 0.56, 0.52), hash12(floor(vec2(qS.x, qS.z) * 6.0))), vec3(0.2), tile);
                    float cM = smoothstep(0.12 + eAAS, 0.12 - eAAS, abs(qS.z - 0.55)) * smoothstep(0.3 + eAAS, 0.3 - eAAS, abs(qS.x - 0.62));
                    terr2 *= mix(1.0, 0.45, cM * roomVisS);
                    room = mix(vec3(0.5, 0.47, 0.43), terr2, roomVisS);
                  } else { // suspended grid ceiling with troffer strips (intensity footprint-faded)
                    float troffer = smoothstep(0.6 - eAAS * 3.0, 0.6 + eAAS * 3.0, fract(qS.x * 3.0)) * smoothstep(0.35 - eAAS * 2.0, 0.35 + eAAS * 2.0, fract(qS.z * 2.0));
                    room = mix(vec3(0.62), sLight * mix(0.8, 5.0, litS), troffer * 0.8 * mix(0.35, 1.0, roomVisS));
                  }
                } else { room = shopWall * 0.75; }
                room *= mix(1.0, 0.5, qS.z);
                float glowS = litS * mix(0.5, 1.0, night);
                room *= (0.22 * (1.0 - night) + glowS * 1.4 + 0.03);
                room = mix(room, room * sLight, litS * 0.6);
                // derivative LOD for shop detail + grazing fade
                float detVisS = smoothstep(${U10 ? '0.95' : '0.5'}, 0.15, fwidth(u)) * grazeS;
                vec3 shopMean = shopWall * (0.22 * (1.0 - night) + glowS * 1.2 + 0.03) * 0.6;
                ${U10 ? `
                // ---- U10: the far fallback is the rest of the addendum's tell.
                // The whole parallax room collapses to \`shopMean\` once a bay is
                // wider than ~0.5 wall-metres per pixel, which on a 60 m big-box
                // frontage seen obliquely is most of it — and shopMean was
                // literally ONE colour per bay. Two fixes, both free: the
                // collapse starts at 0.95 m/px instead of 0.5 (the fine detail
                // inside is separately faded by roomVisS, so this cannot alias),
                // and the fallback carries the VERTICAL PROFILE every shop has —
                // dark at the head where the ceiling plane never faces you,
                // brightest under the lit ceiling, dark again at the floor —
                // plus a per-bay level, so even the collapsed case reads as a row
                // of rooms rather than a paint chip.
                {
                  float syS = clamp((v - 0.45) / max(band - 0.95, 0.5), 0.0, 1.0);
                  float prof = mix(0.40, 1.0, smoothstep(0.04, 0.40, syS))
                             * mix(1.0, 0.52, smoothstep(0.60, 1.0, syS));
                  shopMean *= prof * (0.72 + 0.56 * hash12(vec2(bayS * 5.1 + 3.0, cvar * 13.0)));
                }` : ''}
                room = mix(shopMean, room, detVisS);
                ${SF32 ? `
                // SF32: the Square's shop windows (the note at SF32's flag)
                float sfA = 1.0;
                {
                  float sfT = 1.0 - smoothstep(180.0, 320.0, length(vWP.xz - vec2(-1215.0, 2820.0)));
                  if (sfT > 0.0) {
                    float sfU = u - bayS * 4.0, sfH = max(band - 0.55, 0.5);
                    float sfY = clamp((v - 0.45) / sfH, 0.0, 1.0);            // 0 at the sill, 1 just under the fascia
                    float sfW = max(fwidth(u), fwidth(v)) + 1e-4, sfEu = sfW * 1.2, sfEv = sfEu / sfH;
                    float sfNear = smoothstep(0.45, 0.12, sfW);
                    float sfK = hash12(vec2(bayS * 5.3 + 1.0, cvar * 17.0));
                    float sfC = hash12(vec2(bayS * 2.9 + 7.0, cvar * 41.0)), sfC2 = fract(sfC + 0.37 + sfK * 0.25);
                    vec3 sfHue = sfC < 0.125 ? vec3(0.95, 0.10, 0.08) : sfC < 0.25 ? vec3(0.90, 0.08, 0.50) : sfC < 0.375 ? vec3(1.0, 0.42, 0.04)
                               : sfC < 0.5 ? vec3(1.0, 0.78, 0.08) : sfC < 0.625 ? vec3(0.08, 0.72, 0.28) : sfC < 0.75 ? vec3(0.04, 0.60, 0.92)
                               : sfC < 0.875 ? vec3(0.12, 0.22, 0.95) : vec3(0.55, 0.14, 0.92);
                    vec3 sfHue2 = sfC2 < 0.25 ? vec3(0.98, 0.30, 0.55) : sfC2 < 0.5 ? vec3(0.10, 0.85, 0.80) : sfC2 < 0.75 ? vec3(1.0, 0.62, 0.10) : vec3(0.35, 0.30, 1.0);
                    #define SFB(x0, x1, y0, y1) (smoothstep((x0) - sfEu, (x0) + sfEu, sfU) * (1.0 - smoothstep((x1) - sfEu, (x1) + sfEu, sfU)) * smoothstep((y0) - sfEv, (y0) + sfEv, sfY) * (1.0 - smoothstep((y1) - sfEv, (y1) + sfEv, sfY)))
                    // (levels: this is the ROOM term, which the shop-glass emission below takes at about 1.36x after dark and
                    // SG31 holds at 0.85; the first pass put its colour fields at 0.8 with white stripes, blooms and a pale
                    // display wall, and ACES took them to pastels (tf32/r2: a cyan field read sRGB 183 / 217 / 221))
                    vec3 sfBase = room * 0.35;
                    vec3 sfD = sfBase;
                    float sfKind = floor(sfK * 4.0);
                    if (sfKind < 1.0) {
                      // a backlit graphic wall: the colour field, a band of the second colour across it, a pale wordmark bar
                      float sfG = smoothstep(0.1, 0.0, abs(fract(sfU * 0.22 + sfY * 0.9 + sfK * 7.0) - 0.5) - 0.2);
                      vec3 sfCol = mix(sfHue * 0.42, sfHue2 * 0.42, sfG * 0.55);
                      sfCol = mix(sfCol, vec3(0.5, 0.48, 0.45), SFB(1.1, 2.9, 0.62, 0.7));
                      sfD = mix(sfD, sfCol, SFB(0.35, 3.65, 0.16, 0.84));
                    } else if (sfKind < 2.0) {
                      // a screen behind the glass: two colours across it and a soft highlight
                      vec2 sfQ = vec2((sfU - 0.3) / 3.4, (sfY - 0.22) / 0.64);
                      vec3 sfCol = mix(sfHue, sfHue2, smoothstep(0.1, 0.9, sfQ.x * 0.7 + sfQ.y * 0.3)) * 0.45;
                      sfCol += (sfHue2 * 0.3 + 0.08) * smoothstep(0.35, 0.0, length((sfQ - vec2(0.62, 0.55)) * vec2(1.6, 1.0)));
                      sfD = mix(sfD, sfCol, SFB(0.3, 3.7, 0.22, 0.86));
                    } else if (sfKind < 3.0) {
                      // mannequins (legs, torso, head: 1.7 m on a 0.3 m platform) against a backlit wall of the second
                      // colour, a band of the bay's colour over them
                      float sfF = 0.0;
                      for (int i = 0; i < 3; i++) {
                        float cx = 0.8 + float(i) * 1.2 + (hash12(vec2(bayS * 3.0 + float(i), cvar * 9.0)) - 0.5) * 0.3;
                        sfF = max(sfF, max(SFB(cx - 0.15, cx - 0.03, 0.08, 0.31), SFB(cx + 0.03, cx + 0.15, 0.08, 0.31)));
                        sfF = max(sfF, SFB(cx - 0.19, cx + 0.19, 0.29, 0.5));
                        sfF = max(sfF, smoothstep(0.1 + sfEu, 0.1 - sfEu, length(vec2(sfU - cx, (sfY - 0.555) * sfH))));
                      }
                      vec3 sfCol = mix(sfHue2 * 0.38, vec3(0.02), sfF * sfNear);
                      sfCol = mix(sfCol, sfHue * 0.42, SFB(0.2, 3.8, 0.8, 0.88));
                      sfD = mix(sfD, sfCol, SFB(0.2, 3.8, 0.05, 0.88));
                    } else {
                      // an open view into the room, its goods in the bay's colour
                      sfD = mix(sfBase, sfBase * sfHue * 2.5, 0.6);
                    }
                    sfD = mix(sfD, vec3(0.5, 0.48, 0.43), SFB(-1.0, 5.0, 0.93, 0.97) * 0.8);    // the lit ceiling under the transom
                    float sfFr = max(1.0 - SFB(0.07, 3.93, -1.0, 2.0), SFB(-1.0, 5.0, 0.895, 0.92));
                    sfD = mix(sfD, vec3(0.012), sfFr);                                          // mullions and transom bar
                    #undef SFB
                    sfD = mix(mix(sfBase, sfHue * 0.35, 0.45), sfD, sfNear);                     // far: the bay's mean
                    room = mix(room, sfD, sfT);
                    sfA = mix(1.0, 0.3, sfT * night);
                  }
                }` : ''}
                float filmS = 0.12 + dust0 * 0.2;
                vec3 shopGlass = vec3(0.8, 0.83, 0.81);
                albedo = mix(room * shopGlass${SF32 ? ' * sfA' : ''}, vec3(0.08, 0.09, 0.095), max(filmS, (1.0 - grazeS) * 0.75));
                ${SG31 ? `{
                  vec3 seS = room * shopGlass * glowS * 2.0 * (1.0 - filmS) * grazeS;
                  float tsqS = 1.0 - smoothstep(180.0, 320.0, length(vWP.xz - vec2(-1215.0, 2820.0)));   // SG31
                  FAC_emis += seS * mix(1.0, min(1.0, 0.85 / max(1e-3, max(seS.r, max(seS.g, seS.b)))), tsqS);
                }` : `FAC_emis += room * shopGlass * glowS * 2.0 * (1.0 - filmS) * grazeS;`}
                FAC_rough = 0.1 + filmS * 0.3;
                FAC_rough = mix(FAC_rough, 0.7, smoothstep(0.15, 0.5, fwidth(u))); // specular-AA
              }
            }
            ${E10 ? `
            // ---- E10: the two contacts a shopfront makes, and we had neither.
            //  * UNDER THE FASCIA. A sign band is a horizontal ledge with a sheet-metal
            //    or plywood face; everything that lands on it runs off its bottom edge in
            //    streaks onto the glass and the transom below. In every Street View frame
            //    of a Harlem or Bushwick frontage that drip line is the darkest thing on
            //    the shopfront, and it is what separates the sign from the glass.
            //  * AT THE PAVEMENT. The bottom 0.35 m of a shopfront is a bulkhead that is
            //    kicked, mopped, splashed and salted: near-black, with the sidewalk's own
            //    grit line right at the joint. Ours ran the interior mapping to y = 0, so
            //    the glass met the flags with no transition at all — the literal
            //    "perfect edge" the blind pass kept naming.
            {
              float dBelow = band - v;                       // metres below the fascia
              if (dBelow > -0.05 && dBelow < 1.05) {
                float dN = 0.30 + 0.70 * vnoise(vec2(u * 4.3 + cvar * 13.0, v * 0.8));
                float drip = smoothstep(1.0, -0.02, dBelow) * smoothstep(-0.05, 0.03, dBelow) * dN;
                albedo *= 1.0 - drip * 0.34;
                FAC_emis *= 1.0 - drip * 0.30;
              }
              float kick = smoothstep(0.40, 0.05, v);
              albedo = mix(albedo, albedo * vec3(0.30, 0.30, 0.31), kick * 0.72);
              FAC_emis *= 1.0 - kick * 0.85;
              albedo *= 1.0 - smoothstep(0.13, 0.0, v) * 0.35;   // the joint itself
              FAC_rough = mix(FAC_rough, 0.9, kick * 0.7);
            }` : ''}
          } else if (inWin) {
            FAC_dbg = 1.0;
            // ============ interior-mapped window (PR #33906: ray-marched virtual room) ============
            // rooms span 2-3 window bays (PR roomSize); interiors continue behind the piers
            float span = 2.0 + step(0.55, hash12(vec2(floor(cellUS / 2.0), cellV + cvar * 7.0)));
            float roomI = floor(cellU / span);
            float roomK = roomI + wallSeed * 53.0;
            float id  = hash12(vec2(roomK + cvar * 511.0, cellV * 1.7));
            float id2 = hash12(vec2(cellV * 3.7 + cvar * 131.0, roomK * 1.3));
            float id3 = hash12(vec2(roomK * 7.9, cellV * 5.1 + cvar * 57.0));
            float mottleG = vnoise(vec2(u, v) * 0.3 + cvar * 19.0);
            float dust = vnoise(vec2(u * 0.3, v * 0.06 + cvar * 5.0)) * 0.3;
            float pooled = smoothstep(0.32, 0.0, (fy - y0) / max(0.001, y1 - y0)) * 0.4;
            float grime = clamp(0.3 + dust + pooled, 0.0, 0.9);
            bool resi = style < 2.5 || (style > 4.5 && style < 5.5) || style > 11.5;
            ${N11 ? `
            // N11 — OCCUPANCY (docs/notes/night-r11.md 1.5). Apartments fill after
            // dark (0.20 -> 0.44); offices empty out but leave floor and cleaners'
            // lighting on, so the count drops rather than collapsing (0.42 -> 0.56
            // of panes reading lit, which is what a photograph of a Midtown block
            // at 9 p.m. shows). Both land inside the brief's 30-60 % band.
            // same gate as applyCityAO: golden (night 0.05) must land on the old
            // 0.20 / 0.42 exactly, so the blend is smoothstep(0.15, 0.60, night), not night.
            float litN = smoothstep(0.15, 0.60, night);
            float litFrac = resi ? mix(0.20, 0.44, litN) : mix(0.42, 0.56, litN);
            float lit = step(1.0 - litFrac, id3);` : `
            float lit = step(1.0 - (resi ? 0.2 : 0.42), id3);`}
            // living windows: ~12% of rooms drift on/off over minutes (slow,
            // per-room-constant phase — safe under the stipple rules: nothing
            // here varies per PIXEL, only per room per frame), and a few lit
            // rooms carry TV flicker at night
            {
              float wPh = hash12(vec2(cellU * 7.3 + wallSeed * 3.0, cellV * 11.1 + cvar * 5.0));
              if (wPh < 0.12) lit = step(0.0, sin(uTimeF * (0.011 + wPh * 0.02) + wPh * 251.0));
            }
            vec3 lightCol = id2 < 0.88
              ? mix(vec3(1.0, 0.72, 0.27), vec3(1.0, 0.89, 0.61), hash12(vec2(cellU, cellV + 9.0)))
              : mix(vec3(0.87, 0.91, 1.0), vec3(0.62, 0.71, 1.0), hash12(vec2(cellV, cellU + 4.0)));
            { // TV rooms: cool flickering light (8% of lit rooms, night only)
              float tvR = hash12(vec2(cellV * 3.9 + cvar * 41.0, cellU * 6.1));
              if (tvR < 0.08) {
                float fl = 0.6 + 0.4 * sin(uTimeF * 9.0 + tvR * 300.0) * sin(uTimeF * 23.7 + tvR * 91.0);
                lightCol = mix(lightCol, vec3(0.55, 0.68, 1.0) * (0.7 + fl * 0.6), night);
              }
            }
            // room frame in view space. Under our winding convention (shoelace-positive
            // ring, exterior normal (+ez,-ex)), cross(N, up) IS the wall's +u direction —
            // exact, per-vertex, no screen-derivative sign guessing (that guess flipped
            // per 2x2 quad at steep angles and caused checkerboard noise).
            vec3 Nn = normalize(vNormal);
            vec3 rayV = normalize(-vViewPosition); // camera -> fragment
            vec3 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
            vec3 Tv = normalize(cross(Nn, upV));
            vec3 Bv = normalize(cross(Nn, Tv));
            if (dot(Bv, upV) < 0.0) Bv = -Bv;
            float RW = span * winW, RH = (y1 - y0) * floorH;
            float RD = (resi ? 1.55 : 2.4) * RH + 1.2;
            float dotN = dot(rayV, -Nn);
            // grazing incidence: rays nearly parallel to the pane make the march
            // numerically meaningless — and real glass turns mirror there anyway
            float grazeVis = smoothstep(0.05, 0.17, dotN);
            vec3 rd = vec3(dot(rayV, Tv), dot(rayV, Bv), max(0.04, dotN));
            // ---- true parallax inset: the glass plane sits REC meters behind
            // the wall face. Marching the view ray from the wall-plane point to
            // that plane shifts the pane CONTENT by rd.xy*REC/rd.z, and where
            // the shifted point exits the opening the ray has hit a reveal wall
            // (jamb / lintel soffit / sill) instead of glass — the same depth
            // cue the hero ring builds as geometry, here for all 930k buildings.
            // All edges AA'd by pixel footprint (the stipple rules), clamped at
            // grazing where the parallax would smear meters wide.
            float REC = glassStyle ? 0.045 : 0.15;
            vec2 parS = clamp(rd.xy * (REC / max(rd.z, 0.2)), vec2(-0.5), vec2(0.5));
            float Wp = max((x1 - x0) * winW, 1e-3), Hp = max((y1 - y0) * floorH, 1e-3);
            float pu = (fx - x0) * winW + parS.x;
            float pv = (fy - y0) * floorH + parS.y;
            float aaPm = clamp(aaU * winW, 0.004, 0.09);
            float insU = smoothstep(-aaPm, aaPm, pu) * smoothstep(-aaPm, aaPm, Wp - pu);
            float insV = smoothstep(-aaPm, aaPm, pv) * smoothstep(-aaPm, aaPm, Hp - pv);
            float revealM = (1.0 - insU * insV) * smoothstep(0.08, 0.28, dotN) * (1.0 - tiny);
            // shifted entry point for the room march (content parallax)
            float rx = clamp((cuC + parS.x / winW - roomI * span) / span, 0.0, 1.0) * RW;
            float ry = clamp((fy + parS.y / floorH - y0) / (y1 - y0), 0.0, 1.0) * RH;
            // slab method: nearest far plane
            float tx = rd.x > 0.0 ? (RW - rx) / max(rd.x, 1e-4) : rx / max(-rd.x, 1e-4);
            float ty = rd.y > 0.0 ? (RH - ry) / max(rd.y, 1e-4) : ry / max(-rd.y, 1e-4);
            float tz = RD / rd.z;
            float t = min(tx, min(ty, tz));
            vec3 hit = vec3(rx, ry, 0.0) + rd * t;
            vec3 q = vec3(hit.x / RW, hit.y / RH, hit.z / RD);
            FAC_dbgV = q; // facdebug=2 visualizes the room-space hit coordinate
            // room-space pixel footprint: q's derivatives explode at grazing angles even
            // when the pane covers many pixels — fade ALL interior detail by it, and AA
            // every edge with it (fixes motion shimmer)
            float qd = max(fwidth(q.x), max(fwidth(q.y), fwidth(q.z)));
            float roomVis = smoothstep(0.06, 0.015, qd);
            float eAA = clamp(qd * 1.5, 0.004, 0.08); // edge softening in q units
            vec3 iWall = mix(vec3(0.62, 0.58, 0.52), vec3(0.72, 0.70, 0.66), id2);
            float aoQx = smoothstep(0.0, 0.15, q.x) * smoothstep(0.0, 0.15, 1.0 - q.x);
            float aoQy = smoothstep(0.0, 0.15, q.y) * smoothstep(0.0, 0.15, 1.0 - q.y);
            float aoQz = smoothstep(0.0, 0.15, q.z) * smoothstep(0.0, 0.15, 1.0 - q.z);
            vec3 room;
            if (t == tz) { // back wall
              room = iWall;
              if (resi) {
                float doorX = mix(0.22, 0.78, id);
                float doorM = smoothstep(0.09 + eAA, 0.09 - eAA, abs(q.x - doorX)) * smoothstep(0.72 + eAA, 0.72 - eAA, q.y);
                room = mix(room, mix(vec3(0.32, 0.22, 0.13), vec3(0.5, 0.38, 0.24), id2), doorM * roomVis);
                float picX = doorX < 0.5 ? mix(0.68, 0.82, id2) : mix(0.18, 0.32, id2);
                float picM = smoothstep(0.05 + eAA, 0.05 - eAA, abs(q.x - picX)) * smoothstep(0.07 + eAA, 0.07 - eAA, abs(q.y - 0.55));
                room = mix(room, mix(vec3(0.2), lightCol * 0.4, id3), picM * roomVis);
                float sofaX = 0.5 + (id - 0.5) * 0.4;
                float sofaM = smoothstep(0.22 + eAA, 0.22 - eAA, abs(q.x - sofaX)) * smoothstep(0.3 + eAA, 0.3 - eAA, q.y);
                room = mix(room, mix(vec3(0.24, 0.2, 0.18), vec3(0.36, 0.3, 0.26), id2) * 1.15, sofaM * roomVis);
              } else {
                float shC = fract(q.y * 4.0);
                float shelf = smoothstep(0.86 - eAA * 4.0, 0.86 + eAA * 4.0, shC);
                vec3 goods = 0.3 + 0.55 * vec3(hash12(vec2(floor(q.x * 8.0), cellV)), hash12(vec2(cellUS, floor(q.x * 8.0))), hash12(vec2(floor(q.x * 8.0) * 3.0, cvar * 77.0)));
                vec3 shelved = mix(mix(iWall * 0.85, goods, 0.5), iWall * 0.55, shelf);
                room = mix(iWall * 0.72, shelved, roomVis);
              }
              room *= mix(0.72, 1.0, aoQx * aoQy);
            } else if (t == ty) {
              if (rd.y < 0.0) { // floor: boards + rug (AA'd, detail-faded)
                float seam = smoothstep(0.94 - eAA * 6.0, 0.94 + eAA * 6.0, fract(q.x * 6.0));
                vec3 boards = mix(mix(vec3(0.29, 0.2, 0.125), vec3(0.42, 0.3, 0.19), id2), vec3(0.12, 0.1, 0.08), seam);
                float rugM = resi ? smoothstep(0.28 + eAA, 0.28 - eAA, abs(q.x - 0.5)) * smoothstep(0.3 + eAA, 0.3 - eAA, abs(q.z - 0.45)) : 0.0;
                boards = mix(boards, mix(vec3(0.48, 0.23, 0.2), vec3(0.23, 0.34, 0.38), id3), rugM);
                room = mix(vec3(0.34, 0.25, 0.16), boards, roomVis);
              } else { // ceiling + bulb (bulb intensity fades with footprint — no hot pixel at range)
                float lamp = smoothstep(0.16 + eAA, 0.13 - eAA, length(vec2(q.x - 0.5, q.z - 0.5)));
                vec3 ceilBase = mix(iWall, vec3(1.0), 0.5);
                room = mix(ceilBase, lightCol * mix(1.0, 4.5, lit), lamp * mix(0.3, 1.0, roomVis));
              }
              room *= mix(0.72, 1.0, aoQx * aoQz);
            } else { // side walls
              room = iWall * 0.8;
              room *= mix(0.72, 1.0, aoQy * aoQz);
            }
            float dayAmb = (1.0 - night) * (0.08 + 0.26 * id); // per-room daylight depth: some rooms read dark, some airy
            float roomGlow = lit * mix(0.22, 1.0, night);
            room *= (dayAmb + roomGlow * 1.6 + 0.02) * mix(1.0, 0.45, q.z);
            room = mix(room, room * lightCol, lit * mix(0.25, 0.85, night)); // bulb tint mostly at night
            // curtains from the sides (rarely fully drawn), transmit 20% of glow — AA'd edges
            float cwid = pow(id2, 2.0) * 0.42;
            float fxn = clamp(pu / Wp, 0.0, 1.0); // curtains hang at the glass plane: parallax with it
            float aaFx = aaU / max(0.05, x1 - x0);
            float curtM = clamp(smoothstep(cwid + aaFx, cwid - aaFx, fxn) + smoothstep(1.0 - cwid - aaFx, 1.0 - cwid + aaFx, fxn), 0.0, 1.0);
            vec3 fab = mix(vec3(0.72, 0.68, 0.6), vec3(0.5, 0.55, 0.52), id3) * (dayAmb * 1.6 + roomGlow * 0.2 + 0.02);
            room = mix(room, fab, curtM);
            // derivative-based interior LOD: collapse room detail to its mean when the
            // window covers few pixels (kills mid-range window noise on real GPUs)
            float detVis = smoothstep(0.16, 0.05, aaU) * grazeVis;
            vec3 roomMean = iWall * (dayAmb + roomGlow * 1.3 + 0.02) * 0.55;
            roomMean = mix(roomMean, roomMean * lightCol, lit * mix(0.25, 0.85, night));
            room = mix(roomMean, room, detVis);
            // ---- per-window dressing states (the clone-killer): roller
            // shades at random pull heights on residential panes, venetian
            // blinds at random drop heights on office panes. Both hang at the
            // glass plane (pane-space pu/pv — same parallax as the curtains),
            // transmit a little warm glow at night, and every edge/slat is
            // fwidth-AA'd or pcov box-filtered (stipple rules).
            {
              float fyn = clamp(pv / Hp, 0.0, 1.0);
              float aaFy = aaV / max(0.05, y1 - y0);
              float dressR = hash12(vec2(cellUS * 3.3 + cvar * 97.0, cellV * 9.4));
              float fynS = fyn;   // WL11 overwrites this with a CROOKED hem
              ${WL11 ? `
              // ---- WL11: the blind states were varied but INDEPENDENT — p = 0.42 per
              // pane, drawn to an unrelated height — and a Bernoulli sprinkle over a grid
              // still reads as a grid, evenly dusted. Three corrections, all free:
              //   * PRESENCE is mostly per FLAT (the interior mapper's room already spans
              //     2-3 bays): one apartment keeps every shade down, the next has none.
              //   * HEIGHT is per flat for a home and per FLOOR for an office (a managed
              //     building's blinds are dropped to one level down a whole floor), with a
              //     small per-window deviation on top — that deviation is the tell that a
              //     human pulled each one, so it is not zero either.
              //   * every roller blind hangs CROOKED. Not one hem in New York is level,
              //     and a dead-level hem across a whole facade is a stamped texture.
              float dRoom = wlh(cvI + 1013.0, mod(floor(cellU / 2.0), 64.0) + mod(cellV, 64.0) * 64.0 + 1.0);
              float dPane = wlh(cvI + 1117.0, bkv);
              dressR = dRoom * 0.72 + dPane * 0.28;
              float hRoom = wlh(cvI + 1229.0, mod(floor(cellU / 2.0), 64.0) + mod(cellV, 64.0) * 64.0 + 1.0);
              float hFloor = wlh(cvI + 1321.0, mod(cellV, 64.0) + 1.0);
              float hPane = wlh(cvI + 1433.0, bkv);
              fynS = clamp(fyn + (fxn - 0.5) * wlsg(cvI + 1553.0, bkv) * 0.07, 0.0, 1.0);` : ''}
              if (resi) {
                if (dressR < 0.42) { // vinyl roller shade, drawn 15-95%
                  float shH = mix(0.15, 0.95, hash12(vec2(cellV * 5.9 + cvar * 23.0, cellUS * 1.9)));
                  ${WL11 ? 'shH = clamp(mix(0.12, 0.97, hRoom * 0.74 + hPane * 0.26), 0.05, 0.99);' : ''}
                  float shM = smoothstep(1.0 - shH - aaFy, 1.0 - shH + aaFy, fynS);
                  vec3 shC = mix(vec3(0.80, 0.76, 0.68), vec3(0.60, 0.59, 0.55), id2);
                  vec3 shade = shC * (dayAmb * 1.9 + roomGlow * 0.55 + 0.02); // translucent: warm night glow
                  shade *= 0.93 + 0.07 * sin(fxn * 19.0); // soft fold ripple (smooth fn, no fract)
                  room = mix(room, shade, shM);
                }
              } else if (dressR < 0.6) { // office venetians, dropped 20-100%
                float blH = mix(0.2, 1.0, hash12(vec2(cellUS * 7.1, cellV * 3.7 + cvar * 51.0)));
                ${WL11 ? 'blH = clamp(mix(0.18, 1.0, hFloor * 0.62 + hRoom * 0.24 + hPane * 0.14), 0.05, 1.0);' : ''}
                float blM = smoothstep(1.0 - blH - aaFy, 1.0 - blH + aaFy, fynS);
                float slat = pcov(fyn * 16.0, 0.0, 0.72, max(fwidth(fyn * 16.0), 1e-4) * 1.25);
                vec3 blC = vec3(0.72, 0.73, 0.71) * (0.55 + 0.45 * slat);
                room = mix(room, blC * (dayAmb * 1.7 + roomGlow * 0.4 + 0.02), blM);
              }
            }
            #if defined(FACDEBUG) && FACDEBUG == 6
            FAC_dbgV = vec3(id, id2, id3); FAC_dbg = 9.0; // room hash ids — must be constant per room
            #endif
            #if defined(FACDEBUG) && FACDEBUG == 7
            FAC_dbgV = vec3(roomVis, detVis, grazeVis); FAC_dbg = 9.0; // derivative-LOD factors
            #endif
            #if defined(FACDEBUG) && FACDEBUG == 9
            FAC_dbgV = vec3(0.5); FAC_dbg = 9.0; // flat control — residue = post/framebuffer
            #endif
            // glass compositing (PR): tinted room vs dirty film, emissive when lit
            vec3 dirtyGlass = mix(vec3(0.05, 0.06, 0.068), vec3(0.105, 0.12, 0.128), mottleG);
            float tintR = hash12(vec2(cellUS * 7.7 + cvar * 43.0, cellV * 3.1));
            vec3 glassTint = mix(vec3(0.71, 0.78, 0.75),
              tintR < 0.33 ? vec3(0.64, 0.73, 0.78) : tintR < 0.66 ? vec3(0.75, 0.78, 0.69) : vec3(0.70, 0.74, 0.77),
              0.55) * 0.86; // calibrated down: real panes read darker than their rooms
            // grazing → reflective film dominates (Fresnel look, hides the dead march)
            albedo = mix(room * glassTint, dirtyGlass, max(grime * (1.0 - lit * 0.35), (1.0 - grazeVis) * 0.75));
            ${MAT9 ? `
            // ---- MAT9: PER-PANE identity, applied to the pane's MEAN so it survives the
            // interior LOD collapse. The r8 shader already varies a lot pane to pane —
            // roller shades on 42 % of residential panes, venetians on 60 % of office
            // panes, three glass tints, 0.55-1.45x reflectivity — but the interior itself
            // is per-ROOM (a room spans 2-3 bays) and every detail inside it is multiplied
            // by \`detVis = smoothstep(0.16, 0.05, aaU)\`, so by ~60 m the panes of a room
            // are clones of each other and the facade reads as a stamped grid. That is
            // blind-pass tell #4. This acts on the composited pane colour instead, with a
            // per-CELL hash (cellUS/cellV are flat per cell, so nothing varies per pixel)
            // faded by the cell footprint so it converges to the facade mean BEFORE a pane
            // reaches a pixel — otherwise a per-pane hash below Nyquist is exactly the
            // window stipple this project spent a round removing.
            {
              // The first version keyed the whole deviation on the PANE, and this round's own
              // blind pass called it (docs/notes/materials-r9.md §11, pair p6): random per-pane
              // value reads as film grain on a grid. A real facade's variance is CORRELATED —
              // one blind is drawn to the same height across the three windows of one apartment,
              // a whole floor goes dark after hours, a stairwell column stays lit. So the same
              // total amplitude is split: most of it per ROOM (the interior mapper's own roomK,
              // which already spans 2-3 bays), some per FLOOR, and a small per-pane jitter on
              // top. Structure instead of noise, for the same cost.
              float paneVis = smoothstep(0.95, 0.22, aaU);
              float rv = hash12(vec2(roomK * 3.7 + cvar * 11.0, cellV * 2.3));
              float fv = hash12(vec2(cellV * 7.1 + cvar * 29.0, 5.31));
              float pj = hash12(vec2(cellUS * 11.3 + cvar * 7.0, cellV * 4.9));
              albedo *= 1.0 + ((rv - 0.5) * 0.34 + (fv - 0.5) * 0.16 + (pj - 0.5) * 0.14) * paneVis;
              float tv = hash12(vec2(roomK * 13.7, cellV * 1.9 + cvar * 83.0));
              albedo *= mix(vec3(1.0), mix(vec3(1.07, 1.0, 0.92), vec3(0.92, 0.99, 1.09), tv), 0.4 * paneVis);
            }` : ''}
            FAC_rough = 0.16 + pooled * 0.45 + dust * 0.2;
            // specular-AA: widen roughness with pixel footprint so env highlights can't sparkle
            FAC_rough = mix(FAC_rough, 0.72, smoothstep(0.05, 0.2, aaU));
            FAC_emis += room * glassTint * roomGlow * 2.2 * (1.0 - grime * 0.6) * grazeVis;
            // soft sky occlusion on the glass just under the lintel (the reveal
            // walls carry the hard depth cue; this keeps a gentle gradient on
            // the pane itself). Far fallback when parallax is subpixel.
            {
              float wyR = clamp(pv / Hp, 0.0, 1.0);
              float recess = 1.0 - 0.24 * smoothstep(0.62, 0.98, wyR);
              albedo *= recess;
              FAC_emis *= mix(1.0, recess, 0.4);
            }
            // ---- glass acts like glass (the Matrix-city signature): per-pane
            // jittered normal (plate waviness — reflections break up pane to
            // pane), fresnel-weighted sky/environment reflection, and a tight
            // sun glint that flares into bloom when a pane aligns camera<->sun
            {
              vec3 Vw = normalize(cameraPosition - vWP);
              vec3 NwG = normalize(cross(dFdx(vWP), dFdy(vWP)));
              if (dot(NwG, Vw) < 0.0) NwG = -NwG;
              float pj1 = hash12(vec2(cellU * 3.1 + wallSeed * 11.0, cellV * 5.3)) - 0.5;
              float pj2 = hash12(vec2(cellV * 9.7 + cvar * 31.0, cellU * 1.7)) - 0.5;
              vec3 Nj = normalize(NwG + vec3(pj1, pj2, pj1 * 0.5) * 0.055);
              vec3 Rw = reflect(-Vw, Nj);
              float fres = 0.05 + 0.95 * pow(1.0 - max(dot(Vw, Nj), 0.0), 5.0);
              float glassW = winMask * grazeVis * (1.0 - grime * 0.7);
              // pane-to-pane reflectivity variance (replaced sashes, film age)
              glassW *= 0.55 + 0.9 * hash12(vec2(cellUS * 5.3, cellV * 8.9 + cvar * 17.0));
              // ---- ANALYTIC sky/sun mirror (facades-r6 §0). This used to be
              // textureCubeUV(envMap) * envMapIntensity, i.e. the IBL — which
              // lighting.md cut to 0.14 to fix the ambient, taking every glass
              // reflection in the city with it (critic r5 #2). It also used to
              // be gated by (1 - tiny) so it faded out with distance; the
              // gradient below is per-FACE, not per-pane, so nothing about it
              // depends on a pane covering pixels.
              float f0P = fGlass ? FAC_glassF.x : 0.075;    // punched glazing is clear glass
              float fresP = fresnelR(max(dot(Vw, Nj), 0.0), f0P);
              float fpP = max(aaU, aaV) * 0.35;
              vec3 mirC = skyLook(Rw, sunDirW, sunColW, uZenC, uHorC, uRefl, FAC_glassF.z);
              float skyVis = 1.0;
              ${WR26 ? `
              // WR26: the far side of the street. The ray leaves the wall at dn per unit length, so it meets a far wall
              // wSt away at height yHit; each lot along that wall has its own height and masonry, the wall carries a
              // window grid, and a ray that comes down first meets the roadway. The grid is box-filtered by its own
              // footprint (pcov), so a distant pane averages to the wall mean instead of shimmering.
              {
                // the geometric normal, not the dFdx/dFdy one: at city coordinates (x ~ 2000 m) the derivative normal
                // carries float noise that a patterned reflection turns into speckle
                vec3 NwS = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
                if (dot(NwS, Vw) < 0.0) NwS = -NwS;
                vec3 RwS = reflect(-Vw, normalize(NwS + vec3(pj1, pj2, pj1 * 0.5) * 0.055));
                float dn = dot(RwS, NwS);
                float tl = length(NwS.xz);
                vec3 tang = vec3(-NwS.z, 0.0, NwS.x) / max(tl, 1e-3);
                float wSt = mix(17.0, 30.0, hash12(vec2(wallSeed * 7.3 + cvar * 3.1, 2.7)));
                float tHit = wSt / max(dn, 0.03);
                float yHit = vFUv.y + RwS.y * tHit;
                float sHit = dot(vWP + RwS * tHit, tang);
                float fwS = max(fwidth(sHit), 1e-3), fwY = max(fwidth(yHit), 1e-3);   // outside any branch: derivatives stay defined
                float lot = floor(sHit / 14.0);
                float lh = hash12(vec2(lot * 1.37 + cvar * 5.3, wallSeed * 3.9 + 0.7));
                float hOpp = clamp(bldgH * mix(0.55, 1.3, lh), 8.0, 55.0);
                float lc = hash12(vec2(lot * 4.1 + 9.3, cvar * 2.9));
                vec3 wallA = lc < 0.45 ? vec3(0.52, 0.30, 0.23) : lc < 0.7 ? vec3(0.44, 0.34, 0.28)
                           : lc < 0.88 ? vec3(0.70, 0.62, 0.50) : vec3(0.52, 0.52, 0.51);
                float bay = mix(1.6, 2.3, lh), flo = mix(2.9, 3.5, lc);
                float win = pcov(sHit / bay, 0.22, 0.78, fwS / bay) * pcov(yHit / flo, 0.32, 0.86, fwY / flo);
                win *= smoothstep(1.5, 3.5, yHit);                                  // shopfronts: one dark band instead
                float shop = 1.0 - smoothstep(3.2, 4.2, yHit);
                vec3 wallC = uHorC * uRefl * wallA * mix(1.0, 0.16, max(win * 0.9, shop * 0.75))
                           * (0.85 + 0.35 * clamp(dot(-NwS, sunDirW) * 3.0, 0.0, 1.0) * (1.0 - night));
                vec3 roadC = uHorC * uRefl * vec3(0.26, 0.26, 0.27);
                float fwH = max(fwY, 0.25);
                float farVis = smoothstep(hOpp - fwH, hOpp + fwH, yHit);
                float onRoad = 1.0 - smoothstep(-fwH, fwH, yHit);
                vec3 farC = mix(wallC, roadC, onRoad);
                float useF = smoothstep(0.5, 0.7, tl) * (1.0 - smoothstep(0.75, 0.9, night));   // walls only; night keeps its glow mirror
                skyVis = mix(1.0, farVis, useF);
                mirC = mix(mirC, mix(farC, mirC, farVis), useF);
              }` : ''}
              FAC_emis += mirC * FAC_reflTint * fresP * glassW;
              // specular AA: the disc exponent is widened by the pixel
              // footprint and its peak clamped inside sunDisc(), otherwise
              // sub-pixel mirrors strobe (and sparkle through bloom)
              FAC_emis += sunColW * FAC_reflTint
                        * sunDisc(Rw, sunDirW, fGlass ? FAC_glassF.y : 0.06, fpP)
                        * fresP * 16.0 * uRefl * glassW * (1.0 - night) * skyVis;
            }
            // ---- sash frames at the glass plane: perimeter stiles + a
            // double-hung meeting rail (residential/punched), or a full
            // steel-sash muntin grid (loft/industrial). Pane-space pu/pv so
            // they parallax with the inset glass; they occlude interior glow
            // and reflections; box-filtered/AA'd per the stipple rules.
            if (!glassStyle && tiny < 0.9) {
              float sashR = hash12(vec2(floor(cvar * 253.0), 4.17));
              vec3 sashC = sashR < 0.5 ? vec3(0.66, 0.65, 0.60)      // painted white/cream
                         : sashR < 0.8 ? vec3(0.085, 0.085, 0.095)   // factory black
                         : vec3(0.22, 0.15, 0.10);                   // stained wood
              float dEdgeS = min(min(pu, Wp - pu), min(pv, Hp - pv));
              float stileW = 0.055;
              float wlRep = 0.0; vec3 wlRepC = vec3(0.0);
              ${WL11 ? `
              // ---- WL11: REPLACED SASHES (brief B, 5-10 %). Every window in a building
              // is currently the same unit, and that is not how any New York building
              // over forty years old looks: sashes are replaced one FLAT at a time, so a
              // wood-sash tenement carries a scatter of white vinyl or mill-finish
              // aluminium units, and the giveaway at 20 m is not the colour but the
              // PROFILE — a replacement unit has a fat frame (a 1-over-1 insert loses
              // 6-8 cm to the new jamb liner), one meeting rail dead centre, and no
              // muntins at all where the original had a grid.
              // CORRELATED, not sprinkled: the gate is mostly per-ROOM (= per flat: the
              // interior mapper's rooms already span 2-3 bays) with a small per-window
              // term, because a landlord replaces a whole apartment's windows in one day.
              // ~7 % of openings overall.
              {
                float rr = wlh(cvI + 613.0, mod(floor(cellU / 2.0), 64.0) + mod(cellV, 64.0) * 64.0 + 1.0);
                float rw = wlh(cvI + 727.0, bkv);
                wlRep = (rr < 0.12 && rw < 0.62) || rw < 0.022 ? 1.0 : 0.0;
                if (wlRep > 0.5) {
                  stileW = 0.085;                              // the fat insert frame
                  float rc = wlh(cvI + 829.0, bkv);
                  wlRepC = rc < 0.62 ? vec3(0.80, 0.795, 0.775) // white vinyl (the common one)
                         : rc < 0.86 ? vec3(0.52, 0.53, 0.545)  // mill-finish aluminium
                         : vec3(0.16, 0.145, 0.125);            // dark bronze anodised
                  sashC = wlRepC;
                }
              }` : ''}
              float sashM = smoothstep(stileW + aaPm, stileW - aaPm, dEdgeS);
              if (loftStyle && wlRep < 0.5) { // steel-sash lights, ~0.56 x 0.47m
                float gU = pu / 0.56, gV = pv / 0.47;
                float mUL = 1.0 - pcov(gU, 0.05, 0.95, max(fwidth(gU), 1e-4) * 1.25);
                float mVL = 1.0 - pcov(gV, 0.06, 0.94, max(fwidth(gV), 1e-4) * 1.25);
                sashM = clamp(sashM + mUL + mVL, 0.0, 1.0);
              } else { // meeting rail just above pane middle (a replacement unit's is centred)
                sashM = clamp(sashM + smoothstep(0.045 + aaPm, 0.045 - aaPm, abs(pv - Hp * (wlRep > 0.5 ? 0.50 : 0.53))), 0.0, 1.0);
              }
              sashM *= insU * insV * (1.0 - tiny) * winMask;
              ${U10 ? `
              // ---- U10: the FRAME's own identity (this is the pane-variance
              // block the brief scopes to me, extended rather than duplicated).
              // Three colours per city and a single value each is the same
              // defect the r9 block fixed one layer in: a whole avenue of
              // windows whose frames are pixel-identical. What varies on a real
              // facade, in the order it reads at 40 m:
              //   * paint STATE per BUILDING — the last repaint was 2 or 22
              //     years ago, and a chalked frame is both lighter and much
              //     rougher than a fresh one, so this has to move roughness too;
              //   * hue drift per building (the same "white" from two decades);
              //   * a per-WINDOW deviation (sashes get replaced one flat at a
              //     time — an aluminium unit in a wooden-sash building);
              //   * DIRT, which is not uniform over a frame: it collects on the
              //     bottom rail and in the corners, where rain sits.
              // All cell- or building-constant, never per-pixel, and faded by
              // the pane footprint so it converges to the facade mean before a
              // frame subtends a pixel.
              {
                float paneVisU = smoothstep(0.95, 0.22, aaU);
                float paint = hash12(vec2(floor(cvar * 253.0) + 11.0, 8.3));
                float chalk = smoothstep(0.45, 1.0, paint);
                sashC = mix(sashC, mix(sashC, vec3(0.52, 0.51, 0.49), 0.55), chalk);
                float hueB = hash12(vec2(floor(cvar * 253.0) + 29.0, 2.1)) - 0.5;
                sashC *= vec3(1.0 + hueB * 0.10, 1.0 + hueB * 0.02, 1.0 - hueB * 0.09);
                float rep = hash12(vec2(cellUS * 9.1 + cvar * 17.0, cellV * 4.3));
                sashC *= 1.0 + (rep - 0.5) * 0.26 * paneVisU;
                float lowF = smoothstep(0.34, 0.0, pv / max(Hp, 0.01));
                float cornF = smoothstep(0.22, 0.0, min(pu, Wp - pu) / max(Wp, 0.01));
                float dirtF = clamp(lowF * 0.7 + cornF * 0.45, 0.0, 1.0)
                            * (0.30 + 0.70 * hash12(vec2(floor(cvar * 253.0) + 5.0, 6.7)));
                sashC = mix(sashC, sashC * vec3(0.60, 0.585, 0.55), dirtF * 0.55 * paneVisU);
                FAC_rough = mix(FAC_rough, mix(0.38, 0.74, max(chalk, dirtF * 0.6)), sashM);
              }` : ''}
              ${WL11 ? `
              // WL11: U10's paint state is the BUILDING's last repaint — a unit that was
              // swapped in five years ago did not get chalky with it, and vinyl does not
              // chalk at all. Take most of the clean colour back (a little of the wall's
              // dirt stays: the frame still lives under the same sill) and give it the
              // semi-gloss a new frame actually has.
              if (wlRep > 0.5) {
                sashC = mix(sashC, wlRepC, 0.75);
                FAC_rough = mix(FAC_rough, 0.30, sashM);
              }` : ''}
              if (sashM > 0.003) {
                albedo = mix(albedo, sashC, sashM);
                FAC_emis *= 1.0 - sashM * 0.92;
                ${U10 ? '' : 'FAC_rough = mix(FAC_rough, 0.38, sashM); // semi-gloss paint'}
              }
            }
            // ---- reveal walls (parallax inset): occlude glass, reflections
            // and glints where the shifted ray left the opening. Which face by
            // largest violation: lintel soffit darkest, sill face lit stone,
            // jambs mid-tone wall; deeper into the reveal shades darker.
            if (revealM > 0.003) {
              float dL2 = -pu, dR2 = pu - Wp, dB2 = -pv, dT2 = pv - Hp;
              float mV = max(max(dL2, dR2), max(dB2, dT2));
              vec3 rev = diffuseColor.rgb * 0.66;
              if (dT2 >= mV - 1e-5) rev = diffuseColor.rgb * 0.40;
              else if (dB2 >= mV - 1e-5) rev = vec3(0.5, 0.47, 0.42) * 1.06;
              rev *= 1.0 - 0.45 * clamp(mV / max(REC, 1e-3), 0.0, 1.0);
              albedo = mix(albedo, rev, revealM);
              FAC_emis *= (1.0 - revealM);
              FAC_rough = mix(FAC_rough, 0.85, revealM);
            }
            if (glassStyle) {
              float mullA = smoothstep(0.045 - aaU, 0.045 + aaU, fx) * (1.0 - smoothstep(0.955 - aaU, 0.955 + aaU, fx))
                          * smoothstep(0.05 - aaV, 0.05 + aaV, fy) * (1.0 - smoothstep(0.95 - aaV, 0.95 + aaV, fy));
              vec3 mullCol = diffuseColor.rgb * 0.45;
              albedo = mix(mullCol, albedo, mullA);
              FAC_emis *= mullA;
              FAC_rough = mix(0.55, FAC_rough, mullA);
              if (fy < 0.3 && fy > 0.05 && style > 2.5 && style < 3.5) { albedo = diffuseColor.rgb * 0.55; FAC_emis = vec3(0.0); FAC_rough = 0.4; }
              ${FD14 ? `// ==== FD14 (round 14, owner: Bryant Park's background towers looked too basic): depth a head-on view keeps
              // (so the BX-WIN facade bake carries it to Cycles and Unreal): each bay's mullion reads as a projecting fin, lit
              // on one face and shadowed on the other, with a shadow line it casts on the glass beside it; the blue
              // towers (style 11, a uniform grid before) get the spandrel band at each floor line that style 3 has.
              {
                float fin = 1.0 - tiny;
                float litF = smoothstep(0.955 - aaU, 0.955 + aaU, fx) * (1.0 - smoothstep(0.985 - aaU, 0.985 + aaU, fx));
                float shF = 1.0 - smoothstep(0.012 + aaU, 0.03 + aaU, fx);
                float castF = smoothstep(0.045 - aaU, 0.045 + aaU, fx) * (1.0 - smoothstep(0.075, 0.075 + 2.0 * aaU, fx));
                albedo *= 1.0 + fin * (0.55 * litF - 0.35 * shF - 0.22 * castF);
                if (style > 10.5 && style < 11.5 && fy > 0.05 && fy < 0.17) {
                  float spM = fin * smoothstep(0.05, 0.05 + aaV, fy) * (1.0 - smoothstep(0.17 - aaV, 0.17, fy));
                  albedo = mix(albedo, diffuseColor.rgb * 0.62, spM); FAC_emis *= 1.0 - spM; FAC_rough = mix(FAC_rough, 0.45, spM);
                }
              }
              // ==== /FD14` : ''}
              // subpixel collapse: blended curtain-wall average
              vec3 cwAvg = mix(diffuseColor.rgb * 0.5, vec3(0.10, 0.125, 0.14), 0.55);
              albedo = mix(albedo, cwAvg, tiny);
              FAC_emis *= (1.0 - tiny * 0.7);
              // ---- tower lobby entrance in the packed door bay: dark portal
              // frame, twin glass leaves w/ center stile + push bars, warm
              // lobby glow (glass styles never had ANY entrance before)
              if (doorPack >= 8.0 && cellU == doorCell && v < 3.9 && tiny < 0.8) {
                float inP = pcov(cuC, 0.5 - 0.38, 0.5 + 0.38, aaU * 1.25) * (1.0 - smoothstep(3.35, 3.6, v));
                float frameB = clamp(max(1.0 - pcov(cuC, 0.5 - 0.30, 0.5 + 0.30, aaU * 1.25), smoothstep(3.1, 3.35, v)), 0.0, 1.0);
                float frameM = inP * frameB;
                albedo = mix(albedo, vec3(0.05, 0.055, 0.06), frameM);
                FAC_emis *= 1.0 - frameM;
                FAC_rough = mix(FAC_rough, 0.35, frameM);
                float inDoor = inP * (1.0 - frameB);
                if (inDoor > 0.003) {
                  float stile = 1.0 - smoothstep(0.015, 0.045, abs(fx - 0.5));
                  float pushb = smoothstep(0.98, 1.02, v) * (1.0 - smoothstep(1.1, 1.14, v));
                  albedo = mix(albedo, vec3(0.05, 0.055, 0.06), inDoor * clamp(stile + pushb, 0.0, 1.0));
                  FAC_emis += vec3(1.0, 0.75, 0.45) * inDoor * (0.3 + night * 1.2);
                }
              }
            } else {
              // punched-window average for subpixel cells: wall w/ darkened fill ratio
              float fill = (x1 - x0) * (y1 - y0);
              vec3 punchAvg = mix(diffuseColor.rgb * 0.98, vec3(0.06, 0.07, 0.08), fill * 0.85);
              albedo = mix(albedo, punchAvg, tiny);
              FAC_emis *= max(winFade, 0.25);
              FAC_rough = mix(FAC_rough, 0.85, tiny);
              // recessed reveal: darken cell top (lintel shadow) + inner edges (AA'd)
              albedo *= mix(1.0, 0.62, smoothstep(y1 - 0.14 - aaV, y1 - 0.14 + aaV, fy) * (1.0 - tiny));
              float edgeD = min(smoothstep(x0 + 0.08 + aaU, x0 + 0.08 - aaU, fx), 1.0) + (1.0 - smoothstep(x1 - 0.08 - aaU, x1 - 0.08 + aaU, fx));
              albedo *= 1.0 - clamp(edgeD, 0.0, 1.0) * 0.2 * (1.0 - tiny);
              // window AC unit (BuildingGeneratorThreeJS kit idea — the NYC
              // staple): ~8% of punched residential cells carry a boxy unit
              // filling the lower sash, slatted vent face, killing the glow
              float acR = hash12(vec2(cellU * 13.7 + wallSeed * 57.0, cellV * 7.9 + cvar * 23.0));
              float acLo = x0 + 0.14, acHi = x1 - 0.14, acTop = y0 + 0.38;
              vec3 acTint = vec3(1.0);
              ${WL11 ? `
              // ---- WL11: the AC units were the most REGULAR thing on the facade — 8 % of
              // cells, independent, and every one of them the same size, the same grey and
              // dead centre in its sash. refs/streetview/morningside (prewar brick, Broadway)
              // has a unit in a quarter of the openings; not one is centred (a window unit
              // sits against one jamb so the accordion panel takes up the rest), they are
              // three different colours and depths, and they CLUSTER by apartment because a
              // flat that buys one buys three. Rate, correlation, position, size, colour.
              acR = wlh(cvI + 1667.0, bkv) * 0.45
                  + wlh(cvI + 1789.0, mod(floor(cellU / 2.0), 64.0) + mod(cellV, 64.0) * 64.0 + 1.0) * 0.55;
              float acW2 = 0.10 + 0.05 * wlh(cvI + 1861.0, bkv);            // half-width: a 0.52-0.78 m unit
              float acSide = wlh(cvI + 1907.0, bkv) < 0.5 ? -1.0 : 1.0;     // hard left or hard right
              float acCx = mix(x0 + acW2 + 0.03, x1 - acW2 - 0.03, acSide * 0.5 + 0.5);
              acLo = acCx - acW2; acHi = acCx + acW2;
              acTop = y0 + 0.26 + 0.14 * wlh(cvI + 2039.0, bkv);
              float acT = wlh(cvI + 2113.0, bkv);
              acTint = acT < 0.5 ? vec3(1.04, 1.03, 1.0) : acT < 0.78 ? vec3(0.94, 0.92, 0.84) : vec3(0.66, 0.67, 0.70);` : ''}
              // WB13: the sided house's single loudest detail after the lap itself is the
              // through-wall / window AC (docs/typology §6 — the "Fedders" sleeve). The
              // "v > 6.0" floor exists to keep units off a tenement's shopfront storey;
              // on a 9 m three-storey house it would leave only the top floor, so the
              // frame belt gets 3.2 m (i.e. everything above the parlour). The condo is
              // excluded on purpose: that generation is PTAC or split, and a grid of
              // window boxes is what makes it read as old stock.
              if (acR < ${WL11 ? '0.26' : '0.08'} && (style < 2.5${WB13 ? ' || sidingS' : ''}) && v > ${WB13 ? '(sidingS ? 3.2 : 6.0)' : '6.0'}) {
                float acM = smoothstep(y0 + 0.02, y0 + 0.06, fy) * (1.0 - smoothstep(acTop - 0.04, acTop, fy))
                          * smoothstep(acLo, acLo + 0.04, fx) * (1.0 - smoothstep(acHi - 0.04, acHi, fx));
                // WL11: own-footprint gate (the E10 rust-run rule). A unit is 0.2-0.3 of a
                // bay; at 26 % of cells rather than 8 % a sub-pixel, cell-decorrelated box
                // is exactly the stipple the project keeps removing. \`tiny\` only reaches
                // zero at ~2 m per pixel, which is far too late for a 0.6 m box.
                acM *= winMask * (1.0 - tiny)${WL11 ? ' * smoothstep(0.24, 0.07, aaU)' : ''};
                vec3 acCol = vec3(0.60, 0.61, 0.60) * acTint * (0.82 + 0.26 * sin(fy * 92.0));
                albedo = mix(albedo, acCol, acM);
                FAC_emis *= 1.0 - acM * 0.9;
                FAC_rough = mix(FAC_rough, 0.55, acM);
              }
            }
            // soften window↔wall boundary with the AA mask
            albedo = mix(diffuseColor.rgb * 0.92, albedo, winMask);
            FAC_emis *= winMask;
            FAC_rough = mix(0.9, FAC_rough, winMask);
          } else {
            FAC_dbg = 0.0;
            // masonry: per-brick coursing with AA mortar joints (PR technique)
            float tone = fbm(vec2(u, v) * 0.03 + cvar * 7.0) * 0.2 - 0.1;   // slow patina
            float mottle = vnoise(vec2(u, v) * 0.7 + cvar * 31.0) * 0.14 - 0.07;
            albedo *= 1.0 + tone + mottle;
            // large weather-stain patches + grounding gradients: splash-zone
            // damp at the base, soot line under the parapet — kills the
            // "vector-clean" mid-distance wall
            float stain = smoothstep(0.55, 0.9, fbm(vec2(u * 0.045, v * 0.11) + cvar * 13.0));
            albedo *= 1.0 - stain * 0.16;
            albedo *= 1.0 - smoothstep(3.4, 0.0, v) * (0.1 + 0.16 * vnoise(vec2(u * 0.5, v * 0.8) + cvar * 19.0)); // splash-zone base grime, varied
            albedo *= 1.0 - smoothstep(bldgH - 2.5, bldgH, v) * 0.1;
            FAC_rough = 0.9;
            // grazing sheen: fired brick and cut stone pick up a low-gloss
            // streak when the view skims the wall (masonry currently went
            // fully matte and carried no light response at all)
            {
              float gDot = abs(dot(normalize(vViewPosition), normalize(vNormal)));
              FAC_rough -= 0.22 * pow(1.0 - gDot, 4.0);
            }
            if (!glassStyle) {
              // ---- Poly Haven wall tiles (CC0): family picked by style, each
              // sample normalized by its own mean and multiplied into the
              // PLUTO-tinted albedo — the photo supplies masonry pattern and
              // grain, the palette keeps per-building identity. Because the
              // ratio mips toward 1.0, distant walls converge to the flat
              // tint (no far-field noise, far macro material untouched).
              {
                vec2 wuv = vec2(u, v);
                vec3 wallT, wallM;
                // WB13: the open-ended "style > 11.5" is CLOSED at 13.5 so ids 14/15
                // (no raw back-ticks in this comment: it is inside a template literal)
                // (siding, rainscreen) do not inherit NYCHA red brick — the exact trap
                // the geo.js NOTE warns about. ?wb13=0 re-opens it (round-12 look).
                if (style < 0.5 || (style > 6.5 && style < 7.5) || (style > 11.5${WB13 ? ' && style < 13.5' : ''})) {        // tenement/industrial/projects: red brick
                  wallT = texture2D(t_wA, wuv * (1.0 / 2.6)).rgb; wallM = vec3(0.126, 0.048, 0.017);
                } else if (style < 1.5) {                                                  // prewar: brown brick
                  wallT = texture2D(t_wB, wuv * (1.0 / 2.4)).rgb; wallM = vec3(0.500, 0.308, 0.158);
                } else if (style < 2.5) {                                                  // postwar: white/tan brick
                  wallT = texture2D(t_wC, wuv * (1.0 / 2.4)).rgb; wallM = vec3(0.304, 0.253, 0.184);
                } else if ((style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5)) { // deco/rowhouse/civic/church: cut stone
                  wallT = texture2D(t_wS, wuv * (1.0 / 3.4)).rgb; wallM = vec3(0.571, 0.386, 0.221);
                } else if ((style > 5.5 && style < 6.5) || (style > 9.5 && style < 10.5)) {// cast iron/retail: painted plaster
                  wallT = texture2D(t_wP, wuv * (1.0 / 3.0)).rgb; wallM = vec3(0.057, 0.063, 0.072);
                } else { wallT = vec3(0.5); wallM = vec3(0.5); }
                // ---- photo grain, tamed: the raw mean-ratio railed its 0.25-2.6
                // clamp on almost every texel (linear-space texels span ~0.03-0.68
                // against tiny channel means) and read as hard salt-and-pepper up
                // close, with per-CHANNEL clipping adding pink/blue hue confetti.
                // Luminance-led soft-knee (pow keeps gradients where a hard clamp
                // made flat rails), clamped hue at 35%, distance-shaped strength:
                // calm at sniff range, full grain mid-range; mips still converge
                // the ratio to 1.0 so the far field stays the flat PLUTO tint.
                // ---- 2026-09-09 (docs/notes/facades-r6.md §0b): critic r5
                // defect #11 called this "a crazed crushed-gravel speckle that
                // reads as granulated cork or camouflage, with magenta/cyan
                // chromatic fringing on every band edge". Three causes, all
                // here:
                //  1. wStr ramped UP with the pixel footprint —
                //     mix(0.42, 0.62, smoothstep(0.006, 0.05, wFp)) saturates
                //     at 0.05 m/px, i.e. beyond ~30 m — so the photo grain was
                //     at MAXIMUM strength at exactly the 30-600 m distances a
                //     tower is read at, where anisotropic filtering at grazing
                //     incidence under-samples it into per-pixel confetti. The
                //     ramp is now inverted: grain at sniff range, none at
                //     range, and a COURSED ASHLAR term (below, box-filtered)
                //     carries the mid-range read instead.
                //  2. the per-channel wHue push. wallM is
                //     srgbToLinear(mean sRGB), so for cut stone it is
                //     (0.571, 0.386, 0.221) — R/B 2.58 — and a NEUTRAL texel
                //     came out of the ratio at (0.53, 0.78, 1.36): after the
                //     0.6..1.6 clamp and the 35 % mix every texel got its own
                //     hue push of up to -11 % R / +21 % B. That is the
                //     magenta/cyan. Stone families are now LUMINANCE ONLY (a
                //     photo of sandstone may not recolour a limestone tower);
                //     brick keeps a tight hue term because brick-to-brick
                //     colour really is the signal there.
                //  3. the pow(x, 0.55) knee still spanned 0.52x..1.62x, i.e.
                //     +-55 % albedo at texel scale. 0.79x..1.24x now.
                vec3 wRat = wallT / max(wallM, vec3(0.01));
                float wLum = dot(wRat, vec3(0.2126, 0.7152, 0.0722));
                float wLumC = pow(clamp(wLum, 0.55, 1.7), 0.42);      // 0.79x .. 1.24x
                bool wStone = (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5)
                            || (style > 5.5 && style < 6.5) || (style > 9.5 && style < 10.5);
                vec3 wHue = clamp(wRat / max(wLum, 0.05), 0.86, 1.16);
                vec3 wRatC = wLumC * mix(vec3(1.0), wHue, wStone ? 0.0 : 0.30);
                float wFp = max(fwidth(u), fwidth(v));                // wall-meters per pixel
                float wStr = mix(0.36, 0.05, smoothstep(0.008, 0.06, wFp));
                ${FR26 ? 'FAC_grainV = mix(vec3(1.0), wRatC, wStr);' : 'albedo *= mix(vec3(1.0), wRatC, wStr);'}
                // low-frequency hierarchy: 2-6m sun-bleach / repointing blotches so
                // the grain reads as material inside structure, not even noise
                float wBlotch = fbm(vec2(u, v) * 0.27 + cvar * 23.0);
                albedo *= 0.93 + 0.14 * wBlotch;
              }
              // WB13: same closure as the wall-tile family above. Siding has no brick
              // module at all, and a condo's thin-set veneer has a joint no frame ever
              // resolves — both would read as a red brick grid under the tint.
              bool brickish = style < 2.5 || (style > 4.5 && style < 5.5) || (style > 6.5 && style < 8.5) || (style > 11.5${WB13 ? ' && style < 13.5' : ''});
              if (brickish) {
                // brick grid: 0.3m courses, 0.62m bricks, offset alternate rows.
                // Visibility is DERIVATIVE-based (a shader mip): when a brick spans
                // less than ~2px, per-brick variance/joints fade to the mean —
                // this is the fix for mid-range facade "dither" on real GPUs.
                float row = v / 0.3;
                float colB = u / 0.62 + step(0.5, fract(row * 0.5)) * 0.5;
                vec2 bc = vec2(fract(colB), fract(row));
                float aaBu = fwidth(colB), aaBv = fwidth(row);
                float brickVis = smoothstep(0.55, 0.22, max(aaBu, aaBv));
                if (brickVis > 0.003) {
                  float joint = 1.0 - (smoothstep(0.0, 0.045 + aaBu * 1.6, bc.x) * smoothstep(0.0, 0.045 + aaBu * 1.6, 1.0 - bc.x)
                                     * smoothstep(0.0, 0.09 + aaBv * 1.6, bc.y) * smoothstep(0.0, 0.09 + aaBv * 1.6, 1.0 - bc.y));
                  float brickRnd = hash12(vec2(floor(colB) * 3.1, floor(row) * 7.7) + cvar * 13.0);
                  // photo tiles carry the brick pattern now — procedural jitter/
                  // joints are dialed down to a relief accent so the two brick
                  // grids don't visibly clash
                  albedo *= 1.0 + (brickRnd - 0.5) * 0.05 * brickVis;
                  float jointMean = 0.16;
                  albedo = mix(albedo, albedo * 0.62, mix(jointMean, joint, brickVis) * 0.4);
                  FAC_rough += joint * 0.1 * brickVis;
                  FAC_nrmAdj += vec3(dFdx(joint), dFdy(joint), 0.0) * -0.5 * brickVis;
                } else {
                  albedo = mix(albedo, albedo * 0.62, 0.16 * 0.85);
                }
              } else {
                // ---- COURSED ASHLAR (facades-r6 §0b). What replaces the photo
                // grain at 30-600 m on limestone / granite / terracotta: a real
                // STRUCTURE at a frequency the frame can resolve, instead of
                // noise at a frequency it cannot. Both joint families are pcov
                // box-filtered, so each converges to its own mean under
                // minification rather than beating against the pixel grid —
                // the project's stipple rule — and the whole term is
                // derivative-faded so a 2 km tower gets the flat tint.
                bool ashlar = (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5);
                float crs = v / 0.66;                                   // 0.66 m bed courses
                float aaCr = max(fwidth(crs), 1e-4);
                float crVis = ashlar ? smoothstep(0.80, 0.10, aaCr) : 0.0;
                if (crVis > 0.004) {
                  float crJ = 1.0 - pcov(crs, 0.05, 0.985, aaCr * 1.25);          // bed joint
                  float blk = u / 1.32 + step(0.5, fract(crs * 0.5)) * 0.5;       // 1.32 m blocks, alternate courses broken
                  float aaBk = max(fwidth(blk), 1e-4);
                  float bkJ = 1.0 - pcov(blk, 0.035, 0.99, aaBk * 1.25);          // perpend joint
                  float joint = clamp(crJ + bkJ * 0.75, 0.0, 1.0);
                  float bTone = hash12(vec2(floor(blk) * 2.7, floor(crs) * 5.3) + cvar * 17.0);
                  albedo *= 1.0 + (bTone - 0.5) * 0.07 * crVis;         // block-to-block value spread
                  albedo *= 1.0 - joint * 0.19 * crVis;                 // the joints are recessed and in shadow
                  FAC_nrmAdj += vec3(dFdx(joint), dFdy(joint), 0.0) * -0.42 * crVis;
                  FAC_rough = min(FAC_rough + joint * 0.05 * crVis, 0.98);
                }
                // ---- and the SPANDREL-AND-MULLION read for a prewar tower:
                // a continuous vertical pier every bay with the spandrel set
                // back between stacked windows is what makes a setback-era
                // shaft read as verticals at a kilometre. The tower block's
                // (b) pier term is a value step only; this gives it relief, so
                // the piers catch the sun and the spandrels do not.
                if (bldgH > 26.0 && inBay) {
                  float pv2 = (u - sideM) / winW;
                  float aaP2 = max(fwidth(pv2), 1e-4);
                  // WL11: the BASE opening — pcov is periodic, and a per-cell (lo,hi)
                  // makes pcovI's floor(x)*(hi-lo) term jump at every cell boundary,
                  // i.e. a bright line down every pier. The pier rhythm is a per-wall
                  // read anyway; it does not want the per-bay jitter.
                  float pierM = 1.0 - pcov(pv2, xb0 - 0.06, xb1 + 0.06, aaP2 * 1.25);
                  float pVis = smoothstep(0.85, 0.16, aaP2);
                  FAC_nrmAdj += vec3(-dFdx(pierM), 0.0, 0.0) * 0.55 * pVis;
                  albedo *= 1.0 + pierM * 0.035 * pVis;
                }
              }
              ${WB13 ? `
              // ================= WB13: LAP SIDING (STYLE.FRAME_HOUSE) =================
              // docs/notes/wburg-r13.md, docs/typology/08-vinyl-rowhouse.md §3. The
              // typology's own first line: "the EXPOSURE sets the horizontal texture
              // that defines this typology at every distance. Get this wrong and
              // nothing else saves the model." So the exposure is not one constant —
              // the trade sizes and their shares are Double-4 0.102 m (.34), Double-5
              // 0.127 (.26), Double-4.5 0.114 (.18), Double-3.5 0.089 (.08) and the
              // aluminium singles 0.152 / 0.203 — drawn per BUILDING off cvar, so a row
              // of six re-clads laps at six pitches the way a real street does.
              if (sidingS) {
                float aaUm = max(fwidth(u), 1e-4);          // wall metres per pixel, u
                float expR = hash12(vec2(floor(cvar * 191.0), 3.17));
                float expo = expR < 0.34 ? 0.102 : expR < 0.60 ? 0.127 : expR < 0.78 ? 0.114
                           : expR < 0.86 ? 0.089 : expR < 0.95 ? 0.152 : 0.203;
                float crsS = v / expo;
                float aaCs = max(fwidth(crsS), 1e-4);
                // Derivative fade, the project's stipple rule: under ~1.5 px per course
                // the lap converges to its own mean instead of beating against the pixel
                // grid. A 0.102 m course is ~1 px at 220 m in the 1080p aerial, which is
                // exactly where the aerial plate is shot from — so the aerial reads the
                // COLOUR and the roofline, and the street plates read the lap.
                float lapVis = smoothstep(0.75, 0.16, aaCs);
                float fcS = fract(crsS);
                // The profile, in the SAME sense as the hero generator's relief pass
                // (src/buildings/rowhouse.js sidingRelief): a board's butt is at its
                // BOTTOM and catches the light; the darkest line on the wall is the
                // shadow the butt of the board ABOVE throws on the top of this one. So
                // in wall space, fract -> 1 is the shadow and fract -> 0 is the drip
                // edge, and the face ramps between them. Both members are pcov
                // box-filtered, so each converges to its own AREA under minification
                // instead of beating against the pixel grid.
                float butt = 1.0 - pcov(crsS, 0.0, 0.945, aaCs * 1.25);   // top 5.5 % = the 10-16 mm lap step
                float lip  = pcov(crsS, 0.0, 0.10, aaCs * 1.25);          // the drip edge, in the light
                float face = 1.0 - fcS;                                    // ramp out of the shadow
                albedo *= mix(1.0, (1.0 - butt * 0.32) * (0.960 + face * 0.066) * (1.0 + lip * 0.055), lapVis);
                // ...and the RELIEF, which is what actually sells it: a lit wall goes
                // striped and a shaded one goes flat, which is how you tell siding from
                // a painted-on texture in an oblique aerial.
                FAC_nrmAdj += vec3(dFdx(butt), dFdy(butt), 0.0) * -0.70 * lapVis;
                // ---- butt joints (§3.3, "non-negotiable for realism"). A panel runs
                // 3.66 m, so a 6.10 m front carries 1-2 seams per course and never zero;
                // adjacent courses are staggered by >= 0.61 m on the installer's 6-value
                // cut-off cycle, which is quasi-periodic rather than white noise because
                // a real installer works from a small pile of offcuts.
                float cIdx = floor(crsS);
                float k6 = mod(cIdx + floor(hash12(vec2(floor(cvar * 71.0), 11.3)) * 6.0), 6.0);
                float offS = k6 < 0.5 ? 0.0 : k6 < 1.5 ? 1.22 : k6 < 2.5 ? 2.44
                           : k6 < 3.5 ? 0.61 : k6 < 4.5 ? 1.83 : 3.05;
                float runS = (u + offS) / 3.66;
                float aaRs = max(fwidth(runS), 1e-4);
                float seamS = (1.0 - pcov(runS, 0.0016, 1.0, aaRs * 1.25)) * smoothstep(0.40, 0.09, aaRs) * lapVis;
                albedo *= 1.0 - seamS * 0.12;
                // ---- panel wave (§ WEATHERING, "mandatory, all vinyl"): 3-8 mm over a
                // 1.0-1.5 m wavelength, along the run only. Vinyl hangs loose on nail
                // slots and a dead-flat plane is the fastest CG tell there is.
                float waveS = sin((u + cvar * 37.0) * 4.6) * sin((u * 0.37 + cvar * 11.0));
                // (both screen derivatives, not just dFdx: waveS depends on u alone, and
                // on a wall whose u axis runs down the screen dFdx of it is identically
                // zero — the wave would vanish on exactly half the buildings in a block.)
                FAC_nrmAdj += vec3(dFdx(waveS), dFdy(waveS), 0.0) * 0.30 * smoothstep(0.10, 0.02, aaUm);
                // ---- chalking (UV binder erosion): 8-25 % luminance lift, starting
                // 1.5 m above grade and increasing upward, masked under the cornice
                // soffit. This is what stops a pale palette reading as new suburban
                // vinyl and starts it reading as thirty-year-old plastic.
                float chalkA = 0.05 + 0.13 * hash12(vec2(floor(cvar * 233.0), 17.3));
                float chalk = smoothstep(1.5, 11.0, v) * chalkA * (1.0 - smoothstep(bldgH - 1.6, bldgH - 0.6, v) * 0.7);
                albedo = mix(albedo, albedo * 0.80 + vec3(0.155, 0.153, 0.146), chalk);
                // vinyl is low-gloss PLASTIC, not fired clay: 0.55-0.75, and aluminium
                // (the wide singles) a little crisper still.
                FAC_rough = expo > 0.14 ? 0.52 : 0.66;
                // ---- white trim on coloured siding — p 0.72, and the single strongest
                // mid-distance tell in the typology (§4). Two members: the outside
                // CORNER POST at each wall end, and the brickmold CASING round every
                // opening. Without them a sided wall reads as a printed texture, which
                // is precisely what a flat tint with a lap pattern is.
                float trimR = hash12(vec2(floor(cvar * 149.0), 5.9));
                vec3 trimC = trimR < 0.72 ? vec3(0.585, 0.578, 0.552)      // white  #f2f1ec, on the shader's value ladder
                           : trimR < 0.88 ? vec3(0.545, 0.505, 0.400)      // almond #e8e1cd
                           : diffuseColor.rgb * 1.10;                      // matched to the field (0.12)
                float dEndS = min(u, wallLen - u);
                float postM = smoothstep(0.082 + aaUm, 0.082 - aaUm, dEndS) * smoothstep(0.22, 0.05, aaUm);
                albedo = mix(albedo, trimC, postM * 0.90);
                FAC_rough = mix(FAC_rough, 0.45, postM);
                if (inBay) {
                  float du0 = (x0 - fx) * winW, du1 = (fx - x1) * winW;    // metres outside the opening
                  float dv0 = (y0 - fy) * floorH, dv1 = (fy - y1) * floorH;
                  float dOut = max(max(du0, du1), max(dv0, dv1));
                  float aaTm = max(fwidth(dOut), 1e-4);
                  float caseM = smoothstep(-aaTm, aaTm, dOut) * smoothstep(0.072 + aaTm, 0.072 - aaTm, dOut)
                              * smoothstep(0.16, 0.04, aaTm);
                  albedo = mix(albedo, trimC, caseM * 0.92);
                  FAC_rough = mix(FAC_rough, 0.42, caseM);
                }
              }
              // ============= WB13: RAINSCREEN + SLAB (STYLE.CONDO_NEW) =============
              // The post-2000 4-9 floor condo. No masonry module: the cladding is a
              // cassette panel on a 1.2-1.5 m module with an open joint, or thin-set
              // brick veneer whose joint no frame at this distance resolves. What DOES
              // read is the grid — vertical joints on the panel module, a horizontal
              // joint at every floor line, and the projecting SLAB EDGE / balcony line
              // that is the silhouette difference between this and the walk-up next door.
              if (condoS) {
                float panW = 1.15 + 0.45 * hash12(vec2(floor(cvar * 173.0), 9.1));
                float pnU = u / panW;
                float aaPn = max(fwidth(pnU), 1e-4);
                float pnVis = smoothstep(0.55, 0.14, aaPn);
                float jV = (1.0 - pcov(pnU, 0.010, 1.0, aaPn * 1.25)) * pnVis;     // open vertical joint
                float rowC = v / floorH;
                float aaRc = max(fwidth(rowC), 1e-4);
                float jH = (1.0 - pcov(rowC, 0.012, 1.0, aaRc * 1.25)) * smoothstep(0.55, 0.14, aaRc);
                float pnTint = hash12(vec2(floor(pnU) * 3.7, floor(rowC) * 6.1 + cvar * 43.0));
                albedo *= 1.0 + (pnTint - 0.5) * 0.055 * pnVis;   // cassette-to-cassette batch spread
                albedo *= 1.0 - clamp(jV + jH * 0.85, 0.0, 1.0) * 0.30;
                FAC_nrmAdj += vec3(dFdx(jV + jH), dFdy(jV + jH), 0.0) * -0.45;
                // spandrel course under each window band: the panel between the head of
                // one floor's glazing and the sill of the next is a different (darker)
                // cassette on nearly every building of this generation.
                // (rcVis on every fract(rowC) term below, not just the slab: an
                // unfiltered smoothstep on a fract() is exactly the stipple this project
                // keeps removing — once a floor is under ~2 px the band wraps inside the
                // pixel and turns into per-pixel noise. Faded to its mean instead.)
                float rcVis = smoothstep(0.55, 0.14, aaRc);
                float spF = fract(rowC);
                float spM = smoothstep(y1 - 0.02, y1 + 0.05, spF) * (1.0 - smoothstep(0.985, 1.0, spF)) * rcVis;
                albedo *= 1.0 - spM * 0.14;
                // the slab edge / balcony line: a 0.22 m band of exposed concrete at
                // every floor, lighter than the cladding and casting its own line. This
                // is the horizontal banding that reads at 300 m in the aerial.
                float slab = smoothstep(0.0, 0.055, spF) * (1.0 - smoothstep(0.075, 0.13, spF)) * rcVis;
                albedo = mix(albedo, vec3(0.44, 0.435, 0.415), slab * 0.55);
                albedo *= 1.0 - smoothstep(0.075, 0.13, spF) * (1.0 - smoothstep(0.13, 0.20, spF)) * rcVis * 0.22;   // its shadow
                FAC_rough = 0.58;
              }` : ''}
              // ---- opening-anchored weathering: rain wash bleeding down
              // from each sill, lime leach under the coping, party-wall soot
              // at the facade edges — grime forms where water sheds, not in
              // free-floating noise patches
              if (inBay && bldgH > 6.0 && tiny < 0.9) {
                float belowS = (y0 - fy) * floorH; // meters below this cell's sill
                if (belowS > 0.0) {
                  float sNw = 0.4 + 0.6 * vnoise(vec2(u * 2.7, cellV * 5.0 + cvar * 11.0));
                  float sProf = smoothstep(x0 - 0.04, x0 + 0.16, fx) * smoothstep(x1 + 0.04, x1 - 0.16, fx);
                  albedo *= 1.0 - sProf * smoothstep(1.15, 0.02, belowS) * sNw * 0.2 * (1.0 - tiny);
                }
              }
              {
                float dTopW = bldgH - 1.95 - v; // lime run-off under the coping
                if (dTopW > -0.2 && dTopW < 1.6) {
                  float limeN = smoothstep(0.6, 0.95, vnoise(vec2(u * 2.9, cvar * 47.0)));
                  float lime = limeN * smoothstep(-0.1, 0.12, dTopW) * smoothstep(1.5, 0.25, dTopW);
                  albedo = mix(albedo, albedo * 1.3 + vec3(0.05), lime * 0.45);
                }
              }
              {
                float dEndW = min(u, wallLen - u); // party-wall joint soot
                float eNw = 0.55 + 0.45 * vnoise(vec2(v * 0.6, wallSeed * 31.0));
                albedo *= 1.0 - smoothstep(0.85, 0.04, dEndW) * eNw * 0.13;
              }
              ${MAT9 ? `
              // ---- MAT9 (brief A.4): weathering keyed on HEIGHT. Every grime term the
              // r8 shader had was anchored to an opening (rain wash under a sill) or to a
              // wall END (party-wall soot), so a wall was exactly as clean at 2 m as at
              // 40 m. On a real street wall height is the strongest weathering axis there
              // is: traffic film and splash at the bottom, dirt pooling against the back
              // of the coping at the top, exhaust and sign wash over a shopfront.
              {
                // (i) traffic film + splash: the bottom three storeys of every masonry
                // street wall in Manhattan are darker than the shaft
                float sootN = 0.55 + 0.45 * fbm(vec2(u * 0.33, v * 0.12) + cvar * 37.0);
                albedo *= 1.0 - smoothstep(14.0, 0.0, v) * sootN * 0.17;
                // (ii) grime at the parapet line. The lime-leach term above LIGHTENS the
                // last 1.5 m (calcium carried out of the mortar); the dirt that water
                // carries INTO the same joint darkens it. Both are real, they interleave
                // up a run, and having only the light one is why our rooflines read as
                // freshly capped.
                float dTopG = bldgH - v;
                float parN = 0.4 + 0.6 * vnoise(vec2(u * 1.7, cvar * 19.0));
                albedo *= 1.0 - smoothstep(2.3, 0.4, dTopG) * smoothstep(-0.1, 0.3, dTopG) * parN * 0.2;
                // (iii) grime above the storefront: the band over a shop fascia collects
                // kitchen exhaust, sign wash and whatever runs off the awning
                if (store && storeH > 1.0) {
                  float dS = v - storeH;
                  float sN = 0.45 + 0.55 * vnoise(vec2(u * 2.1 + cvar * 53.0, v * 0.9));
                  albedo *= 1.0 - smoothstep(2.4, 0.0, dS) * step(0.0, dS) * sN * 0.16;
                }
              }` : ''}
              ${E10 ? `
              // ---- E10 (brief B): THE CONTACTS. MAT9 keyed weathering on HEIGHT, which
              // is a gradient over 14 m; what a photograph actually shows is dirt packed
              // into JOINTS — a 0.3-1.5 m accent exactly where two surfaces meet. Three of
              // them live on a masonry street wall, and all three are missing:
              //   * the WALL/SIDEWALK joint. Splash off the flags, dog urine, salt and the
              //     sweepings a super piles against the building line: the bottom 1.2 m of
              //     every unpainted wall in New York is materially different from the wall
              //     1 m higher. It is ALSO where efflorescence blooms — salt carried out of
              //     the brick by rising damp and left as a pale mineral crust — so the band
              //     is not simply darker, it is darker WITH a pale bloom in it, and that
              //     contrast is the read.
              //   * the SILL joint. MAT9/r8 wash the wall below a sill uniformly; real
              //     run-off leaves the CENTRE cleaner than the two ENDS, because a sill
              //     sheds to its drip ends. Two dark runs, not one broad smudge.
              //   * the AC SLEEVE. A through-wall or window unit rusts and drips: a narrow
              //     rust-brown run under one opening in five or six on a residential wall.
              //     This is the single most New York mark on a brick facade and we had none.
              // All three are anchored to a datum (v = 0, the sill line, the bay), so none
              // of them is free-floating noise, and all three are 0.2-1.5 m features.
              {
                // (i) the sidewalk-to-wall joint
                float cN = 0.45 + 0.55 * fbm(vec2(u * 0.7, v * 1.1) + cvar * 71.0);
                float splash = smoothstep(1.35, 0.02, v) * cN;
                albedo *= 1.0 - splash * 0.26;
                float bloomN = smoothstep(0.55, 0.93, vnoise(vec2(u * 1.25 + cvar * 23.0, v * 2.2)));
                float bloom = bloomN * smoothstep(1.05, 0.12, v) * smoothstep(0.02, 0.22, v) * (1.0 - tiny);
                albedo = mix(albedo, albedo * 0.55 + vec3(0.125, 0.121, 0.112), bloom * 0.5);
                FAC_rough = min(0.99, FAC_rough + bloom * 0.06);
                // the hard line AT grade: where the flags butt the wall there is a 6-10 cm
                // shadow-and-grit seam that no amount of gradient reproduces
                albedo *= 1.0 - smoothstep(0.16, 0.0, v) * 0.34;
              }
              if (inBay && tiny < 0.9 && bldgH > 6.0) {
                // (ii) sill drip ENDS + the dark line under the sill lip
                float belowE = (y0 - fy) * floorH;
                if (belowE > -0.04 && belowE < 1.5) {
                  float endP = smoothstep(0.20, 0.05, abs(fx - x0 - 0.055)) + smoothstep(0.20, 0.05, abs(fx - x1 + 0.055));
                  float dripN = 0.35 + 0.65 * vnoise(vec2(u * 3.9, cellV * 7.0 + cvar * 13.0));
                  albedo *= 1.0 - clamp(endP, 0.0, 1.0) * smoothstep(1.45, 0.0, belowE) * dripN * 0.26;
                  // the lip line itself: 4 cm of shadow directly under the stone
                  float lipM = smoothstep(-0.02, 0.01, belowE) * smoothstep(0.11, 0.02, belowE)
                             * smoothstep(x0 - 0.09, x0 + 0.02, fx) * smoothstep(x1 + 0.09, x1 - 0.02, fx);
                  // 9 cm of wall: faded on its own footprint, not on the generic tiny
                  albedo *= 1.0 - lipM * 0.30 * smoothstep(0.050, 0.015, aaV);
                }
                // (iii) AC sleeve rust run, ~17 % of residential openings
                bool resiW = style < 2.5 || (style > 4.5 && style < 5.5) || style > 11.5;
                if (resiW && v > 3.0 && belowE > 0.0) {
                  float acR = hash12(vec2(cellUS * 13.3, cellV * 5.9 + cvar * 29.0));
                  if (acR < 0.17) {
                    float acX = x0 + 0.20 + 0.34 * fract(acR * 37.0);
                    float acW = 0.055 + 0.035 * fract(acR * 91.0);
                    float rustP = smoothstep(acW + 0.05, acW - 0.03, abs(fx - acX));
                    float rustN = 0.4 + 0.6 * vnoise(vec2(u * 6.0 + cvar * 7.0, v * 1.6));
                    // own-footprint gate, NOT the generic tiny: this streak is 0.1 of a
                    // bay (~0.3 m) and it is hash-gated per opening, so once a bay drops
                    // under ~7 px the streak is sub-pixel AND decorrelated cell to cell,
                    // which is a stipple. tiny only reaches zero at ~2 m per pixel.
                    float rust = rustP * smoothstep(1.45, 0.0, belowE) * rustN * smoothstep(0.15, 0.045, aaU);
                    albedo = mix(albedo, albedo * vec3(0.86, 0.52, 0.34), rust * 0.62);
                  }
                }
              }` : ''}
              // repointed panels: masonry ages in bay-aligned rectangles
              // (mortar campaigns, roof-leak lines) — the big low-frequency
              // value structure real brick facades carry between floors
              {
                float pnl = hash12(vec2(floor(cuC / 2.0) + wallSeed * 19.0, floor(v / (floorH * 2.0)) * 1.7 + cvar * 29.0));
                albedo *= ${MAT9 ? '0.88 + 0.24 * pnl' : '0.93 + 0.14 * pnl'};
                ${MAT9 ? `
                // MAT9: the panel tier was ±7 % of value and nothing else, so a whole
                // facade still read as one hue at 60 m (§2.2: ours 10-17 % sd/mean at the
                // 3-8 m scale, the reference 28 %). Three changes, all low-frequency:
                //  * ±7 % -> ±12 % on the 2-bay x 2-floor panel (≈ 6 x 8 m);
                //  * one panel in four shifts HUE as well — a repointing campaign is a
                //    different batch of brick, not a different exposure of the same one,
                //    and hue is what makes it read as repaired rather than as noise;
                //  * a coarser ~6-bay x 12 m tier on top of it (a facade rebuilt above a
                //    floor line, a leak stain down a bay group, a cleaned section).
                float pHue = hash12(vec2(floor(cuC / 2.0) * 5.3 + cvar * 61.0, floor(v / (floorH * 2.0)) + wallSeed * 7.0));
                // 0.55 -> 0.20 after the measurement in §2.2b: our facades already carry 4-7x the
                // reference's WITHIN-facade hue spread (R-B sd 11.6-20.5 against 2.4-2.9), so a
                // hue push adds to the statistic we are already over on. Kept small, because a
                // repointed panel really is a different batch — it just is not a big hue move.
                albedo *= mix(vec3(1.0), vec3(1.11, 0.93, 0.86), smoothstep(0.74, 0.98, pHue) * 0.20);
                float big = hash12(vec2(floor(cuC / 6.0) * 2.9 + wallSeed * 31.0, floor(v / 12.0) * 3.3 + cvar * 17.0));
                albedo *= 0.93 + 0.14 * big;` : ''}
              }
              // pier-line drip channels: thin dark verticals where water runs
              // down the bay boundaries, strength varying up the wall
              {
                float bEdge = min(fx, 1.0 - fx);
                float dripN = 0.5 + 0.5 * vnoise(vec2(cellU * 7.7 + wallSeed * 23.0, v * 0.1));
                albedo *= 1.0 - smoothstep(0.16, 0.02, bEdge) * dripN * 0.1 * (1.0 - tiny);
              }
              // soot streaks pooling downward + string course every 6 floors
              float streak = fbm(vec2(u * 0.11, v * 0.06) + cvar * 3.0);
              albedo *= 1.0 - smoothstep(0.25, 0.8, streak) * 0.18;
              float six = fract(v / (floorH * 6.0));
              if (six > 0.985 || six < 0.012) albedo *= 1.14; // string course highlight
              if (fy < 0.1) albedo *= 0.93;
              if (fy > y1 && fy < y1 + 0.07) albedo *= 0.75;
              if (fy > y0 - 0.06 && fy < y0) albedo *= 1.1;
              ${WL11 ? `
              // ---- WL11: the INFILL of a bricked-up opening. \`wlBrick\` is the opening's
              // own coverage on a fragment the window branch has handed back to the wall.
              // What makes a filled opening read as filled, in the order the eye takes it:
              //   1. it is a DIFFERENT batch of brick — usually greyer and flatter than the
              //      wall around it, sometimes concrete block, never a perfect match;
              //   2. its courses do not line up with the wall's, so there is a visible
              //      break at the jamb;
              //   3. it is set BACK 5-10 cm in the old reveal, so the head and the jambs
              //      carry a shadow the field does not;
              //   4. the sill and the lintel are still there — the two lines above this
              //      block draw them, and they are drawn on the JITTERED y0/y1, so they
              //      stay with the opening they belong to.
              if (wlBrick > 0.002) {
                float bTone2 = wlh(cvI + 509.0, bkv);
                // grey CMU on a third, a redder/flatter brick on the rest
                vec3 fillC = bTone2 < 0.34 ? vec3(0.42, 0.41, 0.39) : mix(vec3(0.34, 0.25, 0.21), vec3(0.46, 0.37, 0.31), bTone2);
                fillC *= 0.86 + 0.22 * vnoise(vec2(u * 1.7, v * 2.3) + cvI * 0.031);
                // the infill's own coursing, offset from the wall's (0.082 m courses,
                // half-lapped) and box-filtered so it converges instead of aliasing
                float ic = (v + 0.031 * (1.0 + bTone2)) / 0.082;
                float aaIc = max(fwidth(ic), 1e-4);
                float icJ = 1.0 - pcov(ic, 0.10, 0.97, aaIc * 1.25);
                float ib = u / 0.21 + step(0.5, fract(ic * 0.5)) * 0.5;
                float aaIb = max(fwidth(ib), 1e-4);
                float ibJ = 1.0 - pcov(ib, 0.06, 0.98, aaIb * 1.25);
                float icVis = smoothstep(0.9, 0.15, aaIc);
                fillC *= 1.0 - clamp(icJ + ibJ * 0.7, 0.0, 1.0) * 0.16 * icVis;
                // set back in the reveal: the head is darkest, the jambs next, the sill
                // catches light. 0.16 of a bay / 0.10 of a floor ~ the 6-10 cm recess.
                float rvT = smoothstep(y1, y1 - 0.10, fy);
                float rvL = smoothstep(x0, x0 + 0.06, fx) * smoothstep(x1, x1 - 0.06, fx);
                fillC *= mix(0.62, 1.0, rvT) * mix(0.78, 1.0, rvL);
                fillC *= 1.0 - smoothstep(0.55, 0.0, (fy - y0) / max(y1 - y0, 0.01)) * 0.10; // dirt sits in the bottom of the reveal
                albedo = mix(albedo, fillC, wlBrick * (1.0 - tiny));
                FAC_rough = mix(FAC_rough, 0.95, wlBrick * (1.0 - tiny));
              }` : ''}
              if (loftStyle && (fx < 0.06 || fx > 0.94)) albedo *= 1.12;
              // ---- embossed corner quoins: alternating 0.6m stone blocks at
              // both wall ends (matches the hero-ring geometry so nothing pops
              // at the ring boundary). Lightened stone + per-course tint + a
              // relief normal from the mask gradient; derivative-faded.
              if (!loftStyle && style < 9.5 && bldgH > 8.0 && wallLen > 4.0 && v < bldgH - 1.2) {
                float courseQ = floor(v / 0.6);
                float wQ = 0.55 * (mod(courseQ, 2.0) > 0.5 ? 1.0 : 0.66);
                float dEnd = min(u, wallLen - u);
                float aaQ = max(fwidth(u), 1e-4);
                float qVis = smoothstep(0.5, 0.2, fwidth(v) / 0.6) * (1.0 - tiny);
                float qM = smoothstep(wQ + aaQ, wQ - aaQ, dEnd) * qVis;
                if (qM > 0.003) {
                  float jvQ = fract(v / 0.6);
                  float aaJv = fwidth(v) / 0.6;
                  float qJoint = 1.0 - smoothstep(0.0, 0.07 + aaJv * 1.5, jvQ) * smoothstep(0.0, 0.07 + aaJv * 1.5, 1.0 - jvQ);
                  float qTint = 0.9 + 0.2 * hash12(vec2(courseQ * 3.7, wallSeed * 91.0));
                  vec3 qCol = vec3(0.585, 0.565, 0.525) * qTint * (1.0 - qJoint * 0.35);
                  albedo = mix(albedo, qCol, qM * 0.85);
                  FAC_rough = mix(FAC_rough, 0.72, qM * 0.6);
                  FAC_nrmAdj += vec3(dFdx(qM * (1.0 - qJoint)), dFdy(qM * (1.0 - qJoint)), 0.0) * 0.3 * qVis;
                }
              }
              // ---- keystone over the lintel + twin brackets under the sill
              // (stone-dressed styles): the small punctuation that makes bays
              // read hand-built instead of stamped. Bay-gated, AA'd, near-only.
              bool stoneD = (style > 0.5 && style < 2.5) || (style > 3.5 && style < 5.5) || (style > 7.5 && style < 9.5);
              if (stoneD && inBay && !(doorWall && cellU == doorCell && v < 3.6) && tiny < 0.7) {
                float aaFy = max(fwidth(fy), 1e-4);
                float kW = 0.05 + max(fy - y1, 0.0) * 0.35;
                float keyM = smoothstep(y1 - aaFy, y1 + 0.02, fy) * (1.0 - smoothstep(y1 + 0.14, y1 + 0.16 + aaFy, fy))
                           * smoothstep(kW + aaU, kW - aaU, abs(fx - 0.5)) * (1.0 - tiny);
                // stone tone derived from the wall like heroFacades' trim —
                // keystones sit IN the palette instead of floating chalk-white
                float lumW = dot(diffuseColor.rgb, vec3(0.4, 0.45, 0.15));
                vec3 keyC = vec3(1.03, 1.0, 0.93) * (0.40 + lumW * 0.38) * (0.94 + 0.12 * hash12(vec2(cellUS * 9.1, cvar * 61.0)));
                albedo = mix(albedo, keyC, keyM * 0.92);
                float bM = clamp(smoothstep(0.035 + aaU, 0.035 - aaU, abs(fx - x0 - 0.09)) + smoothstep(0.035 + aaU, 0.035 - aaU, abs(fx - x1 + 0.09)), 0.0, 1.0)
                         * smoothstep(y0 - 0.16, y0 - 0.13 + aaFy, fy) * (1.0 - smoothstep(y0 - 0.075, y0 - 0.06 + aaFy, fy)) * (1.0 - tiny);
                albedo = mix(albedo, albedo * vec3(0.58, 0.56, 0.55), bM * 0.85);
                FAC_nrmAdj += vec3(dFdx(keyM - bM), dFdy(keyM - bM), 0.0) * 0.22 * (1.0 - tiny);
              }
            } else { albedo = diffuseColor.rgb * 0.55; FAC_rough = 0.4; }
            if (v < 4.5 && !store && style < 9.0 && bldgH > 20.0) {
              // rusticated limestone water table (was one flat pasted band):
              // 0.56m coursing + running-bond block verticals via pcov, per-
              // course tint (derivative-gated), plinth grime, AA'd top edge
              float aaWv = max(fwidth(v), 1e-4);
              float crs = v / 0.56;
              float crsVis = smoothstep(0.55, 0.22, fwidth(crs)); // hash/offset terms fade before they can stipple
              float cJ = 1.0 - pcov(crs, 0.055, 0.97, max(fwidth(crs), 1e-4) * 1.25);
              float cId = floor(crs);
              float bTint = 1.0 + (hash12(vec2(cId * 3.3, wallSeed * 71.0)) - 0.5) * 0.16 * crsVis;
              float blk = u / 1.15 + mod(cId, 2.0) * 0.5;
              float bJ = (1.0 - pcov(blk, 0.03, 0.985, max(fwidth(blk), 1e-4) * 1.25)) * crsVis;
              vec3 baseC = vec3(0.70, 0.67, 0.60) * bTint;
              baseC *= 1.0 - max(cJ, bJ * 0.7) * 0.36;
              baseC *= 1.0 - smoothstep(0.55, 0.0, v) * 0.22; // plinth shadow/grime
              ${E10 ? `
              // E10: a water table is a PROJECTING course, so it makes two contacts and
              // both are dark. At its TOP the stone is washed clean and the wall above it
              // is shielded, but the 6-10 cm immediately under the projection is a
              // permanent shadow-and-soot line (this is what makes a rusticated base read
              // as base and not as paint). At its FOOT the splash zone of the E10 wall term
              // lands on stone instead of brick, where it shows far more because limestone
              // is pale. Both anchored to the band's own datum, both ~0.1-0.6 m.
              baseC *= 1.0 - smoothstep(4.50, 4.38, v) * smoothstep(4.28, 4.40, v) * 0.30;
              baseC *= 1.0 - smoothstep(0.85, 0.05, v) * (0.30 + 0.30 * vnoise(vec2(u * 0.9 + cvar * 17.0, v * 1.7)));
              baseC = mix(baseC, baseC * 0.6 + vec3(0.16, 0.155, 0.145),
                          smoothstep(0.58, 0.92, vnoise(vec2(u * 1.6 + cvar * 31.0, v * 2.4))) * smoothstep(0.9, 0.1, v) * 0.45);` : ''}
              float bandM = smoothstep(4.5 + aaWv, 4.5 - aaWv, v) * (1.0 - tiny);
              albedo = mix(albedo, baseC, 0.72 * bandM);
              FAC_rough = mix(FAC_rough, 0.7, bandM);
              FAC_nrmAdj += vec3(dFdx(-cJ * bandM), dFdy(-cJ * bandM), 0.0) * 0.3 * crsVis;
            }
            // ---- entrance door (painted slab, casing, transom, entry light)
            if (doorWall && cellU == doorCell && v < 3.6 && tiny < 0.8) {
              float aaM = max(fwidth(v), 1e-3);
              float caseM = pcov(cuC, 0.5 - 0.36, 0.5 + 0.36, aaU * 1.25) * smoothstep(2.95 + aaM, 2.86 - aaM, v);
              float doorM = pcov(cuC, 0.5 - 0.28, 0.5 + 0.28, aaU * 1.25) * smoothstep(2.72 + aaM, 2.63 - aaM, v);
              // painted casing slightly proud of the wall
              albedo = mix(albedo, vec3(0.58, 0.56, 0.51), caseM * 0.9);
              if (doorM > 0.003) {
                float dfx = clamp((fx - 0.5) / 0.28, -1.0, 1.0);
                // paint color index packed with the bay (shared with heroFacades)
                vec3 dCol = doorColI < 0.5 ? vec3(0.16, 0.11, 0.08)     // dark wood
                          : doorColI < 1.5 ? vec3(0.26, 0.09, 0.08)     // oxblood
                          : doorColI < 2.5 ? vec3(0.09, 0.14, 0.12)     // bottle green
                          : vec3(0.12, 0.12, 0.14);                     // black steel
                // recessed reveal shading + twin panels + kick plate
                vec3 slab = dCol * (0.72 + 0.28 * smoothstep(1.0, 0.55, abs(dfx)));
                float panel = smoothstep(0.12, 0.2, abs(dfx)) * (1.0 - smoothstep(0.72, 0.8, abs(dfx)))
                            * smoothstep(0.3, 0.42, v) * (1.0 - smoothstep(2.2, 2.32, v));
                slab *= 1.0 - panel * 0.22;
                if (v < 0.28) slab = vec3(0.32, 0.33, 0.34); // kick plate
                // transom glass above the leaves
                if (v > 2.32 && v < 2.63) {
                  slab = vec3(0.07, 0.09, 0.1);
                  FAC_emis += vec3(1.0, 0.8, 0.5) * night * 0.5 * doorM;
                }
                albedo = mix(albedo, slab, doorM);
                FAC_rough = mix(FAC_rough, 0.45, doorM);
              }
              // warm entry light over the door
              float dl = length(vec2((fx - 0.5) * winW, v - 2.98));
              float lampD = smoothstep(0.15, 0.06, dl);
              albedo = mix(albedo, vec3(0.2, 0.19, 0.17), lampD);
              FAC_emis += vec3(1.0, 0.72, 0.4) * night * lampD * 2.4;
            }
          }
          #ifdef TOWERFX
          // ================= SKYSCRAPER PASS — TOWER FACADES =================
          // docs/notes/skyscrapers.md. A tower is read at 0.3-2 km, where a
          // single window is sub-pixel. What survives that far out is (a) the
          // horizontal floor rhythm (spandrel band vs vision glass), (b) the
          // vertical pier rhythm, (c) how the wall answers the SKY, and (d) the
          // building's colour identity. All four were missing: tiny collapsed
          // every tower to one flat average and took the environment reflection
          // with it, so Midtown rendered as pastel cardboard.
          //
          // Everything here is box-filtered (pcov) or derivative-faded, per the
          // project's stipple rules: a 3.8 m floor band is ~5 px at 600 m and
          // ~2 px at 1.7 km, so it MUST converge to its own mean rather than
          // beat against the pixel grid.
          {
            float towerF = smoothstep(34.0, 60.0, bldgH);
            if (towerF > 0.01) {
              float fl = v / max(floorH, 2.0);
              float aaF = max(fwidth(fl), 1e-4);
              float bandVis = smoothstep(0.85, 0.22, aaF) * towerF;
              // ---- (a) FLOOR RHYTHM
              if (glassStyle) {
                // curtain wall: an opaque spandrel panel over each slab edge.
                // ~1.1 m of a 3.8 m floor — the proportion every postwar Sixth
                // Avenue tower is built from, and the reason a real curtain
                // wall reads as stacked ribbons and not as one sheet.
                float sp = 1.0 - pcov(fl, 0.30, 0.97, aaF * 1.25);
                vec3 spC = diffuseColor.rgb * (0.40 + 0.20 * hash12(vec2(floor(cvar * 199.0), 5.71)));
                albedo = mix(albedo, spC, sp * bandVis * 0.80);
                FAC_rough = mix(FAC_rough, 0.34, sp * bandVis * 0.7);
                FAC_emis *= 1.0 - sp * bandVis * 0.85;
                FAC_spand = sp * bandVis;   // opaque panel: it takes less mirror than the glass
              } else if (!store) {
                // masonry tower: the spandrel between vertically stacked
                // windows sits BACK from the pier face. That recess is what
                // makes a setback-era tower read as continuous verticals at a
                // kilometre instead of as a dotted grid.
                // WL11: base pair — both of these are PERIODIC pcov reads (see the pier
                // rhythm above); the spandrel recess is a per-wall read, not a per-bay one
                float sp = 1.0 - pcov(fl, yb0, yb1, aaF * 1.25);
                float inCol = pcov(cuC, xb0, xb1, aaU * 1.25);
                albedo *= 1.0 - sp * inCol * bandVis * 0.15;
              }
              // ---- (b) PIER RHYTHM: a heavier column line every 3rd or 4th bay
              if (!store) {
                float grp = 3.0 + step(0.5, hash12(vec2(floor(cvar * 173.0), 11.9)));
                float pc = cuC / grp;
                float aaP = max(fwidth(pc), 1e-4);
                float pier = 1.0 - pcov(pc, 0.10, 0.94, aaP * 1.25);
                albedo *= 1.0 - pier * smoothstep(0.9, 0.25, aaP) * towerF * (glassStyle ? 0.17 : 0.11);
              }
              // ---- (d) MIDTOWN PALETTE. classify.mjs hands out pastel blues
              // and mints; with sky bouncing off them the skyline read as
              // sugared almonds. MASONRY towers are pushed toward the families
              // Manhattan actually has, with a real value spread. GLASS towers
              // are handled by the family block at the top of this shader
              // instead — a curtain wall's albedo, F0, plate roughness and
              // reflection tint are one decision, not four (facades-r6 §1).
              if (!glassStyle) {
                float fam = famR;
                vec3 tint = fam < 0.34 ? vec3(1.06, 0.99, 0.86)     // limestone
                          : fam < 0.58 ? vec3(1.04, 0.92, 0.80)     // terracotta / buff
                          : fam < 0.80 ? vec3(0.95, 0.94, 0.92)     // grey granite
                          : vec3(1.0, 0.94, 0.90);                  // white brick
                float val = 0.78 + 0.36 * hash12(vec2(cvar * 419.0, 13.31));
                albedo *= mix(vec3(1.0), tint * val, towerF * 0.7);
                // distance deepens a tower: sub-pixel windows are holes, and the
                // tiny-collapse averages above are too pale to say so
                albedo *= mix(1.0, 0.86, tiny * towerF);
              }
              // ---- (e) NIGHT BY FLOOR. Offices light by FLOOR, not by room:
              // a few floors fully on for the cleaning crews, most dark, and a
              // black mechanical band. The room shader only knew about rooms.
              if (night > 0.01) {
                float fl2 = floor(v / max(floorH, 2.0));
                float fLit = hash12(vec2(fl2 * 3.71 + cvar * 61.0, 1.93));
                float whole = step(0.86, fLit);
                float darkF = step(fLit, 0.34);
                FAC_emis *= mix(1.0, mix(1.0, 2.5, whole) * mix(1.0, 0.28, darkF), night * towerF);
              }
            }
            // ---- (c) THE SKY ANSWER, rebuilt (facades-r6 §0/§1).
            // The r5 version was textureCubeUV(envMap) * envMapIntensity
            // inside #ifdef USE_ENVMAP, gated by towerF and handed over from
            // a per-pane term with mix(0.45, 1.0, tiny). Three things were
            // wrong with it: envMapIntensity is scene.environmentIntensity,
            // which lighting.md cut to 0.14 (so the term was worth ~1 % of the
            // pixel); the IBL bake is SUN-FREE, so no reflection anywhere in
            // the city could contain the sun; and a 0.6-albedo pastel wall
            // cannot read as a mirror whatever you add to it.
            // Now: the family block at the top of the shader has already
            // chosen this building's glass albedo, F0, plate roughness and
            // reflection tint together; here the wall answers the sky
            // analytically at its own gain. Nothing is per-pane, so
            // minification cannot kill it — a tower at 1.7 km still mirrors
            // the sky — and it runs from 18 m up, not 34, because a 20 m
            // curtain wall is still a curtain wall.
            float cwF = smoothstep(18.0, 30.0, bldgH);
            if (fGlass && cwF > 0.01 && !isRoof && !blind) {
              // ---- glass VALUE. This is half the defect: real curtain-wall
              // glass is 3-10 % diffuse, ours was 50-70 %. The pattern
              // (mullions, spandrels, room content) is kept as a RELATIVE
              // modulation and the whole wall is rescaled to glass values;
              // 6 % of the original survives so lit interiors and shop
              // windows do not go pitch black at street level.
              float dBase = max(dot(diffuseColor.rgb, vec3(0.3333)), 1e-3);
              float pat = clamp(dot(albedo, vec3(0.3333)) / dBase, 0.18, 2.0);
              albedo = mix(albedo, famAlb * pat, 0.94 * cwF);
              vec3 Vw2 = normalize(cameraPosition - vWP);
              vec3 Nw2 = normalize(cross(dFdx(vWP), dFdy(vWP)));
              if (dot(Nw2, Vw2) < 0.0) Nw2 = -Nw2;
              // per-building plate lean: neighbouring towers must not all
              // mirror the same patch of sky (the tell of a fake skyline)
              Nw2 = normalize(Nw2 + vec3(hash12(vec2(cvar * 311.0, 2.13)) - 0.5, 0.0,
                                         hash12(vec2(7.31, cvar * 431.0)) - 0.5) * 0.030);
              vec3 Rw2 = reflect(-Vw2, Nw2);
              float cosT = max(dot(Vw2, Nw2), 0.0);
              float F = fresnelR(cosT, FAC_glassF.x);
              float fpW = length(fwidth(vWP)) * 0.06;
              // per-building reflectance spread: coatings, age, cleaning
              float kR = cwF * (0.72 + 0.56 * hash12(vec2(floor(cvar * 89.0), 21.7)))
                       * (1.0 - 0.62 * FAC_spand);   // spandrels are painted metal, not glass
              // canyon occlusion: below ~50 m a wall reflection vector runs
              // into the building opposite, not into the sky, so the horizon
              // band must not reach it at full strength. This is also what
              // gives a real glass tower its dark-base / bright-top gradient.
              float canyonF = mix(0.42, 1.0, smoothstep(6.0, 52.0, v));
              FAC_emis += skyLook(Rw2, sunDirW, sunColW, uZenC, uHorC, uRefl, FAC_glassF.z)
                        * FAC_reflTint * F * kR * canyonF;
              // the sun in the glass: the brightest pixel in any real frame of
              // Midtown. Clipped and specular-AA'd inside sunDisc().
              FAC_emis += sunColW * FAC_reflTint
                        * sunDisc(Rw2, sunDirW, FAC_glassF.y, fpW)
                        * F * 20.0 * uRefl * kR * (1.0 - night);
              FAC_rough = min(FAC_rough, mix(0.9, FAC_glassF.y, kR));
            }
          }
          // =============== END SKYSCRAPER PASS — TOWER FACADES ===============
          #endif
          ${WB13 ? `
          // WB13: the frame belt's cornice is a BOXED aluminium-coil wrap — fascia
          // 0.25-0.46 m over a flat vented soffit, no brackets, no dentils, reading
          // (docs/typology/08-vinyl-rowhouse.md §2.3) as "a plain shadow band". The
          // generic 1.15 m masonry cornice is a quarter of a three-storey house's
          // facade, and it is the member the typology calls "the strongest single
          // authenticity variable", so it gets its own depth and its own value: white
          // coil is LIGHTER than the wall it sits on, where a pressed-metal cornice
          // painted dark is darker. Soffit line below it stays dark either way.
          if (cornice && sidingS) {
            float cFas = 0.40;
            if (v > bldgH - cFas && v < bldgH) { albedo = mix(albedo, vec3(0.555, 0.548, 0.522), 0.75); FAC_rough = 0.45; FAC_nrmAdj = vec3(0.0, 0.22, 0.0); }
            else if (v > bldgH - cFas - 0.22 && v <= bldgH - cFas) albedo *= 0.52;   // the vented soffit in its own shadow
          } else` : ''}
          if (cornice && v > bldgH - 1.15 && v < bldgH) { albedo *= 0.6; FAC_nrmAdj = vec3(0.0, 0.25, 0.0); }
          if (cornice && !sidingS && v > bldgH - 1.85 && v < bldgH - 1.15) albedo *= 0.85;   // WB13: the boxed branch above owns this zone
          albedo *= 1.0 - 0.24 * (1.0 - smoothstep(0.0, 9.0, v)); // street grime (reference: bases run dark)
          // GLOBAL VALUE CALIBRATION: real masonry/trim sits darker than our
          // PLUTO tints render — a gentle power curve deepens mids and tames
          // chalky whites while leaving blacks alone (reference-matched).
          // 2026-09-03 (docs/notes/lighting.md): re-measured against the
          // FOV-matched W 125th crop after the sun/ambient rebalance. The
          // facades never got the trim the ground did, so a SHADED brick wall
          // rendered at sRGB L 194 where the photograph reads 110-127 and
          // sunlit stone at 215 against 156-193. 1.13/0.94 -> 1.22/0.88 takes
          // ~10 % off a light wall and ~17 % off a mid one, which is where the
          // "milky buildings, no blacks" of critic rounds 2-3 lives. Retune
          // together with the sun/env/bnc ratio in sky.js PRESETS, not alone.
          albedo = pow(max(albedo, vec3(0.0)), vec3(1.22)) * 0.88;
        } else if (mech) {
          // ============ SKYSCRAPER PASS: mechanical penthouse / crown ========
          // Every NYC tower ends in one of these: a louvred screen around the
          // cooling plant, a lift overrun, a stone crown pylon. Louvres are the
          // read at 200-600 m; at 1 km+ they must converge to their MEAN, not
          // moire, so both bands are pcov box-filtered and derivative-faded.
          float lc = v / 0.24;                      // 0.24 m louvre blades
          float aaL = max(fwidth(lc), 1e-4);
          float lVis = smoothstep(0.55, 0.16, aaL);
          float louv = pcov(lc, 0.14, 0.90, aaL * 1.25);
          float lBank = 1.0;          // 1 = the whole face is louvre (pre-E10 behaviour)
          float mpv = -1.0, mWallL = max(vAux3.x, 0.01);
          ${E10 ? `
          // ---- E10 (brief C): THE MECHANICAL PENTHOUSE IS NOT A LOUVRE SCREEN.
          // r9 fixed this branch's band-limited MEAN (it used to fade to 1.0, i.e. to
          // nothing) and gave 58 % of penthouses a masonry material, and the r9 blind pass
          // still called it "three plain faces — no coping line and no louvre bank reads at
          // 150 m". The reason is that the louvres run edge to edge and floor to ceiling on
          // every face: a uniform 0.24 m corduroy over a 15 m box has no SHAPE, so once the
          // blades drop under a pixel the whole prism converges to one value, which is
          // exactly the flat grey the critic saw. A real Manhattan bulkhead is a masonry or
          // panelled box with a louvre BANK let into the upper half of one or two faces, a
          // door at the deck, and a coping. The bank is the read at 150 m because it is a
          // 4 x 3 m DARK RECTANGLE on a lighter box — a shape, not a texture.
          if (faceH > 0.05) {
            mpv = v - (bldgH - faceH);                       // 0 = the roof deck it stands on
            float bLo = max(0.9, faceH * 0.34), bHi = max(bLo + 0.6, faceH - 0.75);
            float aaPv = max(fwidth(mpv), 1e-4);
            float bV = smoothstep(bLo - aaPv, bLo + 0.10 + aaPv, mpv) * smoothstep(bHi + aaPv, bHi - 0.10 - aaPv, mpv);
            // 2-3 bays of louvre with solid piers between them, inset from both wall ends
            float nBay = mWallL > 11.0 ? 3.0 : mWallL > 5.5 ? 2.0 : 1.0;
            float inset = min(1.4, mWallL * 0.13);
            float bu = (u - inset) / max(0.01, (mWallL - 2.0 * inset) / nBay);
            float aaBu = max(fwidth(bu), 1e-4);
            float bH = pcov(bu, 0.06, 0.94, aaBu * 1.25) * step(0.0, bu) * step(bu, nBay);
            lBank = clamp(bV * bH, 0.0, 1.0);
          }` : ''}
          ${MAT9 ? `
          // ---- MAT9 (round-9 brief item 3): the mechanical penthouse is what the r8 blind
          // pass called "a bare untextured box — three flat grey faces, no louvres, no
          // coping, ~15 m across, in a hero position", and the cause is on the line below.
          // Two faults, both about the far field:
          //  * THE BAND-LIMITED MEAN WAS WRONG. \`mix(1.0, …, lVis)\` converges to 1.0 as
          //    the 0.24 m blade falls under ~2 px (beyond roughly 40 m at this fov), i.e.
          //    the louvres do not fade to the louvre bank's average, they fade to NOTHING.
          //    The box therefore renders as flat grey at exactly the distances the film
          //    sees it from. A louvre bank's true far-field value is DARK — you are looking
          //    into an unlit plenum between lit blades — so the mean must be ~0.8, not 1.0.
          //  * EVERY FACE WAS METAL. Most mechanical bulkheads in Manhattan are brick or
          //    painted stucco carrying a metal louvre bank, not an all-metal screen; the
          //    material is the read at 150 m, long after the blades have gone.
          float mFam = hash12(vec2(floor(cvar * 317.0), 23.9));
          if (mFam < 0.58) {                                   // brick / buff brick / stucco
            vec3 mCol = mFam < 0.26 ? vec3(0.255, 0.150, 0.120)
                      : mFam < 0.44 ? vec3(0.300, 0.258, 0.205)
                      : vec3(0.340, 0.330, 0.300);
            albedo = mCol * (0.88 + 0.26 * hash12(vec2(cvar * 97.0, 7.3)));
            // brick bulkheads are the dirtiest surface on a roof: soot off their own
            // exhaust, run-off streaks down every face
            albedo *= 1.0 - smoothstep(0.45, 0.9, fbm(vec2(u * 0.8, v * 0.25) + cvar * 13.0)) * 0.26;
            albedo *= 0.93 + 0.14 * vnoise(vec2(u * 2.3 + cvar * 41.0, v * 0.18));
          }
          albedo *= mix(1.0, mix(0.80, 0.62 + 0.52 * louv, lVis), lBank);` : `
          albedo *= mix(1.0, mix(1.0, 0.70 + 0.46 * louv, lVis), lBank);`}
          ${E10 ? `
          // ---- E10: the rest of what a bulkhead is, all anchored to its own foot.
          //  * the DECK CONTACT — a cast curb and the membrane turned up onto it, then the
          //    silt that packs into the corner. This is the same contact as the parapet's
          //    and it is the one that makes the box stand ON the roof instead of floating.
          //  * a DOOR at the deck on one face (hash-picked so a box has one, not four),
          //    because at 150 m a 1 m dark slot is the only thing that gives the box scale.
          //  * a value break between the box and its membrane. roofs-r9 blind finding 4:
          //    "everything on our roofs sits at nearly the membrane's own value" — the
          //    reference roof-with-plant spans 148 L, ours 126. A bulkhead standing on a
          //    dark EPDM deck must be LIGHT, and one on a silver coating must be darker.
          if (mpv > -0.5) {
            float dCol2 = 0.0;
            // door: 1.05 m wide, 2.2 m high, at a wall-seeded position, one wall in ~2.6
            float dSeed = hash12(vec2(floor(vAux3.y * 64.0) * 3.1, cvar * 83.0));
            if (dSeed < 0.38 && mWallL > 3.2) {
              float dx = 0.9 + hash12(vec2(dSeed * 311.0, cvar * 7.7)) * max(0.0, mWallL - 1.8);
              float aaDu = max(fwidth(u), 1e-4), aaDv = max(fwidth(mpv), 1e-4);
              float dM = smoothstep(0.525 + aaDu, 0.525 - aaDu, abs(u - dx))
                       * smoothstep(2.2 + aaDv, 2.2 - aaDv, mpv) * step(0.06, mpv);
              float frM = smoothstep(0.66 + aaDu, 0.66 - aaDu, abs(u - dx))
                        * smoothstep(2.36 + aaDv, 2.36 - aaDv, mpv) * step(0.0, mpv) - dM;
              albedo = mix(albedo, albedo * 1.28 + vec3(0.03), clamp(frM, 0.0, 1.0) * 0.7);
              albedo = mix(albedo, vec3(0.085, 0.082, 0.078), dM * 0.92);
              FAC_rough = mix(FAC_rough, 0.48, dM * 0.8);
              dCol2 = dM;
            }
            // cast curb + membrane turn-up + the silt line in the corner
            float curb = smoothstep(0.30, 0.10, mpv);
            albedo = mix(albedo, vec3(0.075, 0.072, 0.068), curb * 0.72 * (1.0 - dCol2));
            albedo *= 1.0 - smoothstep(1.4, 0.28, mpv) * (0.35 + 0.45 * fbm(vec2(u * 0.7, mpv * 1.1) + cvar * 67.0)) * 0.22;
            // run-off streaks from the coping down the whole box
            albedo *= 1.0 - smoothstep(0.62, 0.95, vnoise(vec2(u * 1.5 + cvar * 19.0, mpv * 0.30))) * 0.15;
          }` : ''}
          float mu = u / 1.35;                      // structural mullions
          float aaM = max(fwidth(mu), 1e-4);
          albedo *= mix(1.0, 0.88 + 0.16 * pcov(mu, 0.07, 0.93, aaM * 1.25), smoothstep(0.5, 0.15, aaM));
          albedo *= 0.94 + 0.12 * fbm(vec2(u * 0.6, v * 0.6) + cvar * 29.0); // panel weathering
          FAC_rough = 0.42 + 0.2 * louv;
          FAC_nrmAdj += vec3(0.0, (louv - 0.5) * 0.25 * lVis, 0.0);
          // ILLUMINATED CROWN. Manhattan floodlights its bulkheads and crowns
          // from below; a lit crown is most of what a night skyline IS. Warm
          // white on masonry, cool on glass, a coloured minority.
          {
            float ck = hash12(vec2(floor(cvar * 251.0), 17.31));
            vec3 cCol = ck < 0.58 ? vec3(1.0, 0.87, 0.64)
                      : ck < 0.86 ? vec3(0.80, 0.88, 1.0)
                      : mix(vec3(1.0, 0.42, 0.32), vec3(0.35, 0.72, 1.0), hash12(vec2(cvar * 91.0, 3.17)));
            float onC = step(0.22, hash12(vec2(cvar * 137.0, 9.7)));   // 78% of crowns are lit
            // floodlights sit at the FOOT of the crown and wash upward
            float upl = mix(0.38, 1.0, smoothstep(0.0, 9.0, bldgH - v));
            FAC_emis += cCol * night * onC * upl * 1.25 * (0.55 + 0.55 * louv);
            albedo = mix(albedo, albedo * (0.7 + 0.5 * dot(cCol, vec3(0.33))), night * onC * 0.4);
          }
          if (avLight) {  // aviation obstruction light: red, always on, slow blink
            float bl = 0.55 + 0.45 * sin(uTimeF * 1.9 + cvar * 40.0);
            albedo = vec3(0.30, 0.05, 0.05);
            FAC_emis += vec3(1.0, 0.12, 0.06) * (0.8 + 2.6 * night) * bl;
            FAC_rough = 0.35;
          }
          albedo = pow(max(albedo, vec3(0.0)), vec3(1.22)) * 0.88; // same value calibration as the facades
        } else if (crownF) {
          // ====== SKYSCRAPER PASS: masonry crown tier (setback step, pylon) ===
          // Limestone/terracotta crowns are the lightest surface on a prewar
          // tower and they carry a coarse ashlar course, not the flat noise the
          // generic blind wall gets. Floodlit at night like the bulkheads.
          float crs = v / 0.62;                       // 0.62 m ashlar courses
          float aaC = max(fwidth(crs), 1e-4);
          float cVis = smoothstep(0.55, 0.16, aaC);
          float cJ = 1.0 - pcov(crs, 0.05, 0.97, aaC * 1.25);
          float blk = u / 1.25 + mod(floor(crs), 2.0) * 0.5;
          float aaB = max(fwidth(blk), 1e-4);
          float bJ = 1.0 - pcov(blk, 0.03, 0.985, aaB * 1.25);
          albedo *= 1.0 - max(cJ, bJ * 0.7) * 0.28 * cVis;
          albedo *= 0.95 + 0.12 * fbm(vec2(u * 0.5, v * 0.5) + cvar * 17.0);
          albedo *= 1.0 - smoothstep(0.55, 0.92, fbm(vec2(u * 0.09, v * 0.2) + cvar * 7.0)) * 0.12;
          FAC_rough = 0.72;
          FAC_nrmAdj += vec3(dFdx(-cJ), dFdy(-cJ), 0.0) * 0.3 * cVis;
          {
            float ck = hash12(vec2(floor(cvar * 251.0), 17.31));
            vec3 cCol = ck < 0.72 ? vec3(1.0, 0.88, 0.66) : vec3(0.82, 0.89, 1.0);
            float onC = step(0.26, hash12(vec2(cvar * 137.0, 9.7)));
            FAC_emis += cCol * night * onC * mix(0.4, 1.0, smoothstep(0.0, 12.0, bldgH - v)) * 0.95;
          }
          albedo = pow(max(albedo, vec3(0.0)), vec3(1.22)) * 0.88;
        } else {
          FAC_dbg = 3.0;
          float n = fbm(vec2(vFUv.x * 2.0, vFUv.y * 2.1));
          albedo *= 0.88 + 0.12 * n;
          albedo *= 1.0 - 0.14 * (1.0 - smoothstep(0.0, 9.0, vFUv.y));
          FAC_rough = 0.95;
          ${E10 ? `
          // ---- E10: THE PARAPET, which is the longest contact line in the city and had
          // five lines of shader. Every flat-roofed building in the frame ends in one, and
          // in ref_lenox.png the roofline is never a clean band: the roof-side face is the
          // dirtiest surface of the whole building (it is in its own shade all day and
          // everything on the deck drains against it) and the street-side face carries the
          // run-off of the coping above it. Anchored to the prism's own foot and head via
          // the aux3.z face height, so it lands correctly on a 0.62 m taxpayer lip and on
          // a 2.4 m tower parapet alike.
          if (faceH > 0.05) {
            float pv = vFUv.y - (bldgH - faceH);   // 0 = roof deck, faceH = coping
            float pu = vFUv.x;
            float gN = 0.4 + 0.6 * fbm(vec2(pu * 0.55, pv * 0.9) + cvar * 53.0);
            if (faceIn) {
              // the TAR LINE: the membrane does not stop at the deck, it turns up 0.2-0.4 m
              // onto the parapet and is capped with a bead of flashing mastic. That black
              // skirt, and the silt packed into its corner, is what a roof edge looks like.
              float turn = smoothstep(0.34, 0.05, pv);
              albedo = mix(albedo, vec3(0.055, 0.052, 0.050), turn * 0.80);
              FAC_rough = mix(FAC_rough, 0.68, turn * 0.7);
              // and the whole inner face is soiled, strongest low down
              albedo *= 1.0 - smoothstep(1.5, 0.1, pv) * gN * 0.26;
              albedo *= 0.80 + 0.14 * fbm(vec2(pu * 0.22, pv * 0.6) + cvar * 11.0);
            } else {
              // street side: a wash band under the coping's drip, then vertical run-off
              // streaks down the face (the coping sheds onto it every time it rains)
              float dCop = faceH - pv;
              albedo *= 1.0 - smoothstep(0.55, 0.02, dCop) * smoothstep(-0.03, 0.06, dCop) * gN * 0.24;
              float strk = smoothstep(0.58, 0.93, vnoise(vec2(pu * 1.9 + cvar * 37.0, pv * 0.35)));
              albedo *= 1.0 - strk * smoothstep(faceH, 0.0, pv) * 0.18;
            }
          }` : ''}
        }
        // faint warm street bounce at night
        FAC_emis += vec3(0.35, 0.24, 0.12) * night * (1.0 - smoothstep(0.0, 6.5, vFUv.y)) * 0.14;
        diffuseColor.rgb = albedo;
        #if defined(FACDEBUG) && FACDEBUG == 1
        {
          vec3 dbg = vec3(0.5);                            // masonry: gray
          if (isRoof) dbg = vec3(1.0, 0.1, 0.1);           // roof: red
          else if (FAC_dbg == 3.0) dbg = vec3(0.1, 0.8, 0.2); // blind: green
          else if (FAC_dbg == 2.0) dbg = vec3(1.0, 0.9, 0.1); // storefront: yellow
          else if (FAC_dbg == 1.0) dbg = vec3(0.15, 0.3, 1.0);// window: blue
          else if (v < 0.02) dbg = vec3(1.0, 0.4, 0.05);   // foundation: orange
          diffuseColor.rgb = dbg;
          FAC_emis = vec3(0.0);
        }
        #endif
        #if defined(FACDEBUG) && FACDEBUG == 2
        diffuseColor.rgb = FAC_dbgV; FAC_emis = vec3(0.0); // q coordinate
        #endif
        #if defined(FACDEBUG) && FACDEBUG == 4
        diffuseColor.rgb = FAC_emis * 2.0; FAC_emis = vec3(0.0); // emissive isolated
        #endif
        #if defined(FACDEBUG) && FACDEBUG == 5
        FAC_emis = diffuseColor.rgb; diffuseColor.rgb = vec3(0.0); // unlit albedo
        #endif
        #if defined(FACDEBUG) && (FACDEBUG == 6 || FACDEBUG == 7 || FACDEBUG == 9)
        // pane-factor bisection: value shown UNLIT (emissive), diffuse+spec suppressed
        FAC_emis = FAC_dbgV * step(8.5, FAC_dbg);
        diffuseColor.rgb = vec3(0.0);
        FAC_rough = 1.0;
        #endif
      }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = FAC_rough;
        // rain-damp masonry: porous surfaces darken and gloss, glass stays glass
        {
          float dampF = wet * smoothstep(0.5, 0.85, FAC_rough);
          diffuseColor.rgb *= 1.0 - 0.26 * dampF;
          roughnessFactor = mix(roughnessFactor, 0.4, dampF * 0.55);
        }`)
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        normal = normalize(normal + FAC_nrmAdj);
        // real masonry micro-relief: photographed brick normal map in a screen-
        // derivative TBN over the wall's (u,v) — masonry only (FAC_rough gate),
        // distance-faded like every derivative effect in this project
        {
          // r8 BAND-LIMIT (?aa=0 restores 0.5, 0.18). vFUv is in WALL METRES,
          // so buv = vFUv * 0.42 tiles the brick normal map every 2.4 m: on a
          // 1024 map that is 2.3 mm per texel. The old gate held the map at
          // FULL weight out to 0.18 m of wall per pixel (~150 m at this fov)
          // and only reached zero at 0.5 (~415 m) — 78 texels per pixel of a
          // NORMAL map, whose mip average shortens the mean normal and whose
          // residue is specular sparkle. glitch-r7.md 3.6 #6 puts 24 % of the
          // frame's hot pixels on tile facades "worst at 60-460 m", which is
          // this range exactly. Below the resolution limit, surface detail
          // belongs in the ROUGHNESS (applySpecAA now supplies that), not in a
          // normal nobody can resolve. Full to ~58 m, gone by ~166 m.
          float bw = smoothstep(0.86, 0.9, FAC_rough) * smoothstep(${AAFIX ? '0.20, 0.07' : '0.5, 0.18'}, length(fwidth(vWP)));
          if (bw > 0.02) {
            vec2 buv = vec2(vFUv.x, vFUv.y) * 0.42;
            vec3 mapN = texture2D(t_brN, buv).xyz * 2.0 - 1.0;
            vec3 q0 = dFdx(-vViewPosition), q1 = dFdy(-vViewPosition);
            vec2 st0 = dFdx(buv), st1 = dFdy(buv);
            vec3 Tt = q0 * st1.t - q1 * st0.t;
            vec3 Bt = -q0 * st1.s + q1 * st0.s;
            float tl = max(length(Tt), 1e-6), bl = max(length(Bt), 1e-6);
            mat3 tsn = mat3(Tt / tl, Bt / bl, normal);
            vec3 pn = tsn * normalize(vec3(mapN.xy * 1.3, max(mapN.z, 0.4)));
            if (dot(pn, pn) > 1e-8) normal = normalize(mix(normal, normalize(pn), bw * 0.8));
            FAC_rough = mix(FAC_rough, texture2D(t_brR, buv).x * 1.05, bw * 0.5);
          }
        }
        { // albedo-relief: the procedural pattern's luminance IS its heightfield
          // (mortar dark = recessed, stone light = proud). Derivative-based, so
          // it needs the same care as the window shaders: patterns are already
          // fwidth-AA'd (bounded gradients) and the relief is clamped.
          float bumpG = smoothstep(0.45, 0.75, FAC_rough); // glass/polished stay smooth
          // r8 BAND-LIMIT (?aa=0 restores 0.4, 0.14). The comment on the right
          // is the correct rule and the numbers did not implement it: the
          // heightfield here IS the procedural albedo, whose finest features
          // are the course lines (0.34-0.66 m period) and the block joints
          // inside them, and dFdx() of a signal near Nyquist is noise, not a
          // gradient. Holding this at FULL strength out to 0.14 m of wall per
          // pixel (~116 m) put a 0.34 m course at 2.4 px and a joint below 1 px
          // while still taking its screen derivative — and a derivative gets
          // LARGER as the feature compresses, so the relief grew with distance.
          // Full to ~37 m (a course is 7.5 px), gone by ~100 m.
          bumpG *= smoothstep(${AAFIX ? '0.12, 0.045' : '0.4, 0.14'}, length(fwidth(vWP))); // fade before pattern gradients hit pixel scale (shimmer)
          float bh = dot(diffuseColor.rgb, vec3(1.05)) * bumpG;
          vec3 bsx = dFdx(-vViewPosition), bsy = dFdy(-vViewPosition);
          vec3 br1 = cross(bsy, normal), br2 = cross(normal, bsx);
          float bdet = dot(bsx, br1);
          vec3 bgrad = sign(bdet) * (dFdx(bh) * br1 + dFdy(bh) * br2);
          float bgl = length(bgrad);
          // FR26: with the photo grain out of the heightfield the joints alone drive it, and at the old gain (clamp 0.55,
          // x2.0, set while the grain masked them) every joint's arris lit up as a white line under a grazing sun
          bgrad *= min(bgl, ${FR26 ? '0.35' : '0.55'}) / max(bgl, 1e-5);
          vec3 bn = abs(bdet) * normal - bgrad * ${FR26 ? '1.1' : '2.0'};
          if (dot(bn, bn) > 1e-9) normal = normalize(bn); // degenerate dets keep the geo normal
        }
        diffuseColor.rgb *= FAC_grainV;   // FR26: the photo grain joins the colour after the relief has read it`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += FAC_emis;`);
    // TQ32 (owner 2026-09-29: "as if building primitives need a lot more detail, the materials need to be PBR ... It seems
    // rather unlit"): the Square's curtain walls were flat sheets that mirror the sky at grazing view (t3DayCorner: 30 % of a
    // tower face over sRGB 225). world/tq32.js traces fins, caps and piers per pixel; a no-op under ?tq32=0
    tq32Patch(sh);
  };
  // r8 geometric specular AA (?aa=0 to disable). The facade builds its shading
  // normal out of the photographed brick normal map and the albedo-relief
  // gradient, neither of which three's own geometryRoughness can see — it
  // reads `nonPerturbedNormal`, saved BEFORE those writes. 24 % of the hot
  // pixels in glitch-r7.md 2.3 are tile facades at rms 5-33.
  return applySpecAA(applyCityAO(mat), { sigma2: 0.25, kappa: 0.14 });
}

// ------------------------------------------------------------------ GROUND
// matId: 0 asphalt 1 sidewalk 2 curb 3 paintW 4 paintY 5 grass 6 path 7 terrain 8 far-carpet
//        9 paintG (bike lane) 10 brick/plaza ... 16 the Times Square plaza pavers (TP28, city/tsqPlaza.js)
// Surface research + calibration notes: client/docs/notes/surfaces.md
const GND_GLSL = /* glsl */ `
  // Manhattan grid bearing, taken from the OSM College Walk axis (the campus
  // and the commissioners' grid share it): MG_A runs with the cross-town
  // streets, MG_B with the avenues. Wheel paths, rubber scrub, mill-and-pave
  // lots and utility trenches all follow a road, never a random cloud, so the
  // road-history fields are laid out in this frame instead of world XZ.
  const vec2 MG_A = vec2(0.8744, 0.4853);
  const vec2 MG_B = vec2(-0.4853, 0.8744);
  // ridged noise: creases instead of blobs (cracks, strata, flaking edges)
  float gridge(vec2 p) { return 1.0 - abs(vnoise(p) * 2.0 - 1.0); }
  // anisotropic streak field locked to whichever grid axis the block runs on
  // (a ~130 m mask picks the axis, so streaks never cross into a plaid)
  float gstreak(vec2 g, float along, float across, float seed) {
    float sA = vnoise(vec2(g.x * along, g.y * across) + seed);
    float sB = vnoise(vec2(g.x * across, g.y * along) + seed + 19.7);
    return mix(sA, sB, smoothstep(0.38, 0.62, vnoise(g * 0.0075 + 41.0)));
  }
  // AA'd axis-aligned rectangle coverage in cell space
  float grect(vec2 f, vec2 lo, vec2 hi, vec2 aa) {
    vec2 s = smoothstep(lo - aa, lo + aa, f) * (1.0 - smoothstep(hi - aa, hi + aa, f));
    return s.x * s.y;
  }
  // mean-preserving detail multiply: a mip-filtered tap converges to the map's
  // own mean, so dividing by that mean gives a ~1.0 field — distance neither
  // darkens nor lightens the surface, and the authored albedo survives while
  // the map supplies the grain procedural noise can only alias.
  vec3 gdet(vec3 tc, vec3 invMean, float k, float det) {
    return mix(vec3(1.0), clamp(mix(vec3(1.0), tc * invMean, k), 0.34, 2.1), det);
  }
`;
// ------------------------------------------------------------------ GP31 GROUND PBR
// (owner 2026-09-28: "the simulator is starting to look PS1/PS2 like instead of the complex realistic materials ... right
// now it seems like there is a basic dirt overlay on the textures only ... we need proper high quality PBR"). What the
// GM28 ground actually was: the sidewalk's photo set was Poly Haven dirty_concrete, a slab strewn with leaf litter and soil
// clumps (the brown flecks on every flag), and the asphalt set (Poly Haven asphalt_02, a 3.0 m scan) was tiled at 6.25 m,
// so its 6-12 mm chips drew at 13-25 mm. Both entered only as a mean-preserving grain over a procedural grey, under two
// fbm stain clouds, soot, skin patches and oil blotches, and those clouds were the dirt overlay. GP31 makes scanned CC0
// sets the material itself, at their true size: ambientCG Asphalt031 (weathered) and Poly Haven asphalt_pit_lane (a young
// pour, new utility cuts), ambientCG Concrete048 (broom finish) and Concrete037 (an old flag walked down to its
// aggregate), Poly Haven stone_wall_03 (the granite kerb face, the plaza's smooth pavers), gravel_floor_02 (Bryant Park's
// walks) and aerial_asphalt_01 (a 30 m scan of a real road surface: tyre marks, stains and weathering at 0.1-10 m).
// tools/assets/encode_ground_pbr.mjs packs them into two KTX2 arrays (docs/notes/ground-pbr.md has every source and
// licence). A 2 m tile is hex-tiled (Mikkelsen 2022) so it never repeats, every texel is taken relative to its set's mean
// so the calibrated tones (LB14/GT13) hold at every distance, and the owner's second note on the first previews ("complex
// procedural materials ... potholes, mud, imperfections, weathering ... extreme AAA quality", two fab.com stills as the
// bar) is answered by a height field: near the lens the eye ray is marched into the scan's relief and a second march
// toward the sun shades the crevices; potholes are marched in their own height field with base course, silt and murky
// water at a flat level; everything else is laid out from the kerbs (gpKerbWorker): tyre tracks and the oil line per
// lane, sealed and open crack runs of a constant width, alligator cracking and raveling in old wheel tracks, utility cuts
// behind a dark saw cut with a settled or proud edge, dust at the kerb. `?gp31=0` restores GM28.
export const GP31 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gp31') === '0');
// CP32R (city/cpRelief.js): Central Park's relief takes its ground below the y = 0 river plane (the Lake's banks and
// Bethesda's lower terrace at about -3 m) and onto slopes of 10-20 degrees. So over the park's rectangle on the grid's
// bearing (NYC Parks M010, 10 m margin): the river plane is not drawn (the park's lakes are their own water), and the
// ground shader's waterfront treatment (riprap on any soft bank over 9 degrees, wet rock and algae within a metre of sea
// level, tide-stained pavement) is off, which turned the Lake's lawns and the lower terrace grey. `?cp32=0` / `?cp32r=0`.
export const CP32R_MASK = !(typeof location !== 'undefined' && /(^|[?&])cp32r?=0(&|$)/.test(location.search));
const CP_PARK_IN = (v) => `(abs(dot(${v} - vec2(447.2, 82.2), vec2(0.4848, -0.8746))) < 2084.0 && abs(dot(${v} - vec2(447.2, 82.2), vec2(0.8746, 0.4848))) < 451.0)`;
// CP32R: the far LoD drew the park's ground one flat grey, so every aerial up the park turned grey past the near tiles
// (~1.3 km). Over the same rectangle it lays the park as the USGS NAIP aerial has it (public domain; resampled onto the
// rectangle at ~2 m a texel by client/tools/cp/relief_farphoto.py): woods, lawns, the Lake and the Reservoir.
let _cpFarPhoto = null;
const cpFarPhoto = () => {
  if (!_cpFarPhoto && typeof document !== 'undefined') {
    _cpFarPhoto = new THREE.TextureLoader().load('textures/cp32_park_far.jpg');
    _cpFarPhoto.anisotropy = 4;
  }
  return _cpFarPhoto;
};
// GP32 (owner 2026-09-29 on the trailer take fTraffic: "Asphalt decals/material have clear z fighting that's terrible. I
// also don't like low-quality lines etc. I gave you high quality references don't give me lines."). Measured causes
// (docs/notes/ground-gp32.md): the junction is a stack of coincident asphalt triangles whose per-triangle kerb frames
// differ, so the two sides of each exact depth tie drew different cracks and tracks (gpKerbWorker.js gp32Ties now gives
// every tied triangle the world-position fallback); the corner-return gutters lie out in the junction as tan "Y" marks
// (drawn as the asphalt they lie on); and every crack was a band of one width round a noise isoline, 2-4 px black strokes
// from the fTraffic lens, replaced by the crack net below. `?gp32=0` restores GP31 (and `?gp31=0` GM28).
export const GP32 = GP31 && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gp32') === '0');
// ?gp32k=<x> scales the crack net's density (an inspection aid for stills; 1 = the default)
const GP32K = (typeof location !== 'undefined' ? Math.max(0, +(new URLSearchParams(location.search).get('gp32k') || 1)) : 1).toFixed(3);
// level, luminance high-pass std 16.6-25.7 twin against 4.1-12.2 real): `?asphk=<k>` scales the asphalt scan's detail
// contrast about its mean (the chip ratio and the 30 m scan's tone) by k; 1 = unchanged until STREET's A/B picks a value.
const ASPHK = (typeof location !== 'undefined' ? Math.max(0, Math.min(2, +(new URLSearchParams(location.search).get('asphk') || 1))) : 1).toFixed(3);
// GP32 crack net: block cracking on the borders of a jittered cell grid, the crack look along a line (width wandering to
// nothing, spalled lips, a dusty dark floor), and straight joints (saw cuts, cold joints) drawn with the same look
const GP32_NET_GLSL = /* glsl */ `
  float GP_cSpall;          // GP32: a crack's broken lip, the aggregate plucked out along it (coverage)
  float GP_cDust;           // GP32: dust and grit settled on a crack's floor
  uniform int gpVN;         // GP32: 1, the Voronoi loops' bound (a uniform, so the compiler keeps a loop rather than unrolling it)
  // Voronoi borders (Quilez's two-pass border distance) of a jittered grid: cell units to the nearest border, the unit
  // direction from this cell's point toward the neighbour's (toward the border) and the two cells the border separates
  float gpVBorder(vec2 x, float jit, float seed, out vec2 bn, out vec2 cA, out vec2 cB) {
    vec2 n = floor(x), f = fract(x);
    vec2 mg = vec2(0.0), mr = vec2(0.0);
    float md = 8.0;
    for (int j = -1; j <= gpVN; j++) for (int i = -1; i <= gpVN; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 r = g + 0.5 + (gpH2(n + g + seed) - 0.5) * jit - f;
      float d = dot(r, r);
      if (d < md) { md = d; mr = r; mg = g; }
    }
    md = 8.0; bn = vec2(1.0, 0.0); cA = n + mg; cB = cA;
    for (int j = -1; j <= gpVN; j++) for (int i = -1; i <= gpVN; i++) {
      vec2 g = mg + vec2(float(i), float(j));
      vec2 r = g + 0.5 + (gpH2(n + g + seed) - 0.5) * jit - f;
      vec2 dr = r - mr;
      if (dot(dr, dr) > 1e-5) {
        vec2 u = normalize(dr);
        float d = dot(0.5 * (mr + r), u);
        if (d < md) { md = d; bn = u; cB = n + g; }
      }
    }
    return md;
  }
  // the crack look along one crack line: d = metres to it, s = metres along it, eh = its own draw, wMax = its widest (m).
  // Box-filtered over the footprint (gpBand): a crack under a pixel keeps its ink, not an aliasing contrast
  float gpCrackBand(float d, float s, float eh, float wMax, float fw) {
    float h = max(fw * 0.5, 0.0004);
    // the width wanders along the crack and closes to a hairline or to nothing: tapered ends, never a blunt stroke
    float w = wMax * smoothstep(0.16, 0.80, vnoise(vec2(s * 1.9, eh * 61.0)));
    if (w < 5e-5) return 0.0;
    float core = gpBand(d, w, h);
    // the spalled lips: where it is open past ~2 mm the aggregate along its edge has broken out in pieces, 0.4-3 cm, ragged
    // (the rag noise fades before it is under a pixel)
    float jk = smoothstep(0.035, 0.010, fw);
    float rag = mix(0.6, 0.15 + 0.85 * vnoise(vec2(s * 55.0, d * 70.0 + eh * 13.0)), jk);
    float ws = smoothstep(0.0012, 0.006, w) * (0.004 + 0.024 * vnoise(vec2(s * 4.3, eh * 23.0))) * rag * smoothstep(0.28, 0.62, vnoise(vec2(s * 7.0, eh * 31.0)));
    GP_cSpall = max(GP_cSpall, gpBand(d, w + ws, h) - core);
    if (core > 0.01) GP_cDust = max(GP_cDust, smoothstep(0.35, 0.80, vnoise(vec2(s * 0.8, eh * 7.0 + 3.0))));
    return core;
  }
  // one level of the net on the warped point pw (metres): cells of the given size (m), borders cracked above the draw onLo,
  // widths wLo..wHi (skewed thin); the lips round down into the crack and its walls lean in (bn points toward it)
  float gpCrackLevel(vec2 pw, float cell, float seed, float onLo, float wLo, float wHi, float dens, float fw) {
    vec2 bn, cA, cB;
    float d = gpVBorder(pw / cell, 0.62, seed, bn, cA, cB) * cell;
    // the border's own draw, symmetric in its two cells
    float eh = hash12((cA + cB) * 0.5 + abs(cA - cB) * 7.31 + seed);
    float eW = smoothstep(onLo, onLo + 0.1, eh) * mix(wLo, wHi, pow(fract(eh * 13.7), 1.4)) * dens;
    if (eW < 5e-5) return 0.0;
    float sp0 = GP_cSpall;
    float core = gpCrackBand(d, dot(pw, vec2(-bn.y, bn.x)), eh, eW, fw);
    GP_slopeW += (bn.x * MG_A + bn.y * MG_B) * (0.55 * max(GP_cSpall - sp0, 0.0) + 0.25 * core) * smoothstep(0.02, 0.005, fw);
    return core;
  }
  // the crack net of an old pour, in the street grid frame p (gG, metres): anchored to the world, so it runs on unbroken
  // over every triangle, tile and junction, and its blocks run with both street axes. Blocks of 1.3-2.5 m (a third of
  // their borders uncracked, the rest 1.5-13 mm), and near the lens the finer net between them (0.3-0.55 m cells, a third
  // cracked, 0.4-2 mm hairlines). The point is warped by a 2.4 m and a 0.3 m meander and a jag round the chips at 7.7, 2.7
  // and 1.0 cm, the finer two gone before they are under a pixel
  float gpCrackNet(vec2 p, vec2 lotId, float lotH, float fw) {
    float dens = min(1.0, smoothstep(0.42, 0.68, lotH) * smoothstep(0.22, 0.55, vnoise(p * 0.075 + lotId * 3.1 + 1.7)) * ${GP32K});
    if (dens < 0.01) return 0.0;
    float jk = smoothstep(0.035, 0.010, fw), jf = smoothstep(0.012, 0.004, fw);
    vec2 pw = p + (vec2(vnoise(p * 0.42 + 7.1), vnoise(p * 0.42 + 3.7)) - 0.5) * 0.70
                + (vec2(vnoise(p * 3.1 + 4.4), vnoise(p * 3.1 + 6.6)) - 0.5) * 0.09
                + ((vec2(vnoise(p * 13.0 + 1.3), vnoise(p * 13.0 + 9.1)) - 0.5) * 0.030
                +  (vec2(vnoise(p * 37.0 + 5.3), vnoise(p * 37.0 + 2.1)) - 0.5) * 0.011 * jk
                +  (vec2(vnoise(p * 97.0 + 8.1), vnoise(p * 97.0 + 3.3)) - 0.5) * 0.0045 * jf) * jk;
    float seed = hash12(lotId + 5.3) * 37.0;
    float cell = mix(1.3, 2.5, hash12(lotId + 9.1));
    float core = gpCrackLevel(pw, cell, seed, 0.30, 0.0015, 0.013, dens, fw);
    if (fw < 0.012) core = max(core, gpCrackLevel(pw, cell * 0.22, seed + 11.0, 0.62, 0.0004, 0.0020, dens * smoothstep(0.012, 0.005, fw), fw));
    return core;
  }
  // a straight joint that has opened (the saw cut round a utility cut, the cold joint between two pours): the same crack
  // look along it, d = metres to the line, s = metres along it
  float gpJoint(float d, float s, float seed, float wMax, float fw) {
    float jk = smoothstep(0.035, 0.010, fw);
    d += ((vnoise(vec2(s * 13.0, seed)) - 0.5) * 0.012 + (vnoise(vec2(s * 41.0, seed + 5.0)) - 0.5) * 0.004) * jk;
    return gpCrackBand(abs(d), s, hash12(vec2(seed, 7.7)), wMax, fw);
  }
`;
// per-layer linear albedo mean (after the encoder's low-frequency flattening), roughness mean and AO mean: gp31_stats.json
const GP31_SETS = [
  { key: 'asphA', mean: [0.1991, 0.1991, 0.1990], rough: 0.524, ao: 0.910, hMean: 0.590 },   // 0 ambientCG Asphalt031, 2.0 m
  { key: 'asphB', mean: [0.0591, 0.0478, 0.0384], rough: 0.832, ao: 0.903, hMean: 0.609 },   // 1 Poly Haven asphalt_pit_lane, 2.0 m
  { key: 'concA', mean: [0.3635, 0.3154, 0.2443], rough: 0.608, ao: 0.929, hMean: 0.534 },   // 2 ambientCG Concrete048, 2.0 m
  { key: 'concB', mean: [0.3364, 0.3114, 0.2662], rough: 0.608, ao: 0.885, hMean: 0.395 },   // 3 ambientCG Concrete037, 1.6 m
  { key: 'granite', mean: [0.3848, 0.3062, 0.1717], rough: 0.871, ao: 1.000, hMean: 0.502 }, // 4 Poly Haven stone_wall_03, 2.17 m
  { key: 'gravel', mean: [0.4288, 0.4075, 0.3519], rough: 0.473, ao: 0.671, hMean: 0.566 },   // 5 Poly Haven gravel_floor_02, 2.0 m
];                                                                              // 6 (nrm array only) aerial_asphalt_01, 30 m
// macroL / gravelL: the aerial scan's and the gravel's layers, read off the arrays that actually loaded (a 5-layer bank
// from before the gravel set keeps working: the aerial scan at 5, the park's walks on the worn-concrete set)
export const GP31_TEX = { alb: { value: null }, nrm: { value: null }, ready: { value: 0 }, macroL: { value: 5 }, gravelL: { value: 3 } };
if (typeof document !== 'undefined') {
  const ph = (n) => { const t = new THREE.DataArrayTexture(new Uint8Array(4 * n).fill(128), 1, 1, n); t.needsUpdate = true; return t; };
  GP31_TEX.alb.value = ph(6); GP31_TEX.nrm.value = ph(7);
}
const f4 = (v) => v.toFixed(4);
// ?gpdefect=N multiplies the pothole and alligator densities (an inspection aid for stills; 1 = the NYC density)
const GP_DEFECT = typeof location !== 'undefined' ? +(new URLSearchParams(location.search).get('gpdefect') || 1) : 1;
// GP31 kerb frame. The ground mesh carries only position and matId (docs/notes/surfaces.md section 1): no lane position
// and not even the street's bearing, which GM28 guessed per ~130 m block from a noise mask, so on about half the blocks
// its wheel paths ran across the street. world/gpKerbWorker.js derives both from the kerb faces (matId 2) and hands each
// roadway, paint and sidewalk vertex four Uint16 (8 bytes): the across-street coordinate from the street's canonical kerb,
// the distance to the nearest kerb, the street width and the bearing. It runs in a worker: on the main thread the first
// version blocked a frame for about a second per tile (the fps sample of the first GPU batch read 0). Until a tile's
// result lands, its ground draws with the block-mask fallback. The attribute is always added between frames, never
// inside a draw: three caches a mesh's vertex bindings on the draw that first sees an attribute and does not rebind a
// buffer uploaded after that draw (found in the CPU preview: every fragment fell back).
let _gpW = null;
const _gpJobs = new Map();
let _gpJob = 0;
function gpKerbAsync(g, st) {
  if (_gpW === null) {
    try {
      _gpW = new Worker(new URL('./gpKerbWorker.js', import.meta.url), { type: 'module' });
      _gpW.onmessage = (e) => {
        const { id, out, segs, tris, ms, ties, ghosts } = e.data;
        const geo = _gpJobs.get(id); _gpJobs.delete(id);
        st.pending--; st.meshes++; st.segs += segs; st.tris += tris; st.ms += ms; st.maxMs = Math.max(st.maxMs, ms);
        if (GP32) { st.ties = (st.ties || 0) + (ties || 0); st.ghosts = (st.ghosts || 0) + (ghosts || 0); }   // GP32 gp32Ties
        if (geo && geo.attributes.position && !geo.userData.gpDisposed) geo.setAttribute('gpK', new THREE.BufferAttribute(out, 4));
      };
      _gpW.onerror = (e) => { console.warn('[gp31] kerb worker failed:', e.message); _gpW = false; };
    } catch (e) { console.warn('[gp31] kerb worker unavailable:', e.message); _gpW = false; }
  }
  if (!_gpW) return;
  const id = ++_gpJob;
  _gpJobs.set(id, g);
  g.addEventListener('dispose', () => { g.userData.gpDisposed = true; });
  const pos = g.attributes.position.array.slice(), mat = g.attributes.matId.array.slice();
  st.pending++;
  _gpW.postMessage({ id, pos, mat, gp32: GP32 }, [pos.buffer, mat.buffer]);
}
// GP32: the crack net evaluated once, before the material branches, for the asphalt and the paint laid on it: called from
// both branches its code was in the program twice (the program's compile time)
const GP32_NETCALL = /* glsl */ `
        float gpNetC = 0.0;
        if ((m == 0 || m == 3 || m == 4) && gFw < 0.10) {
          vec2 gpLq = gG / vec2(82.0, 76.0) + vec2(fbm(gG * 0.013 + 4.0), fbm(gG * 0.015 + 21.0)) * vec2(0.075, 0.075);
          vec2 gpLid = floor(gpLq);
          float gpLh = (hash12(gpLid + 3.3) + hash12(gpLid + 11.7) + hash12(gpLid + 27.1) + hash12(gpLid + 41.9)) * 0.25;
          ${GP_DEFECT > 50 ? 'gpLh = max(gpLh, 0.8);' : ''}
          gpNetC = gpCrackNet(gG, gpLid, gpLh, gFw);
        }`;
const GP31_GLSL = /* glsl */ `
  uniform highp sampler2DArray t_gpA;   // GP31: sRGB albedo, A = height
  uniform highp sampler2DArray t_gpN;   // GP31: normal xy (OpenGL), B = roughness, A = AO; the last layer (gpMacroL) = the 30 m scan
  uniform float gpReady; uniform float gpMacroL; uniform float gpGravelL;
  const vec3 GP_MEAN[6] = vec3[6](${GP31_SETS.map((s) => `vec3(${s.mean.map(f4).join(', ')})`).join(', ')});
  const float GP_RGH[6] = float[6](${GP31_SETS.map((s) => f4(s.rough)).join(', ')});
  const float GP_AO[6] = float[6](${GP31_SETS.map((s) => f4(s.ao)).join(', ')});
  const float GP_HM[6] = float[6](${GP31_SETS.map((s) => f4(s.hMean)).join(', ')});   // mean of the stretched height
  float GP_layer;   // the scanned set this fragment takes (GP31_SETS order)
  float GP_seal;    // crack sealant / sealed saw cut coverage: a smooth satin skin, no aggregate
  float GP_sealE;   // its outer third, where the squeegeed film is thin enough for chip tops to poke through
  vec2 GP_sealN;    // the sealant's raised lip, as a slope in the street frame q
  vec2 GP_off;      // per-flag texture offset (sidewalk)
  vec2 GP_jn;       // tooled-joint slope, gG frame (sidewalk)
  float GP_wear;    // thermoplastic wear, 0 fresh .. 1 worn through
  vec3 GP_asph;     // the asphalt tone under a paint film
  float GP_crack;   // unsealed hairline cracks
  float GP_cut;     // inside a utility cut
  float GP_dust;    // grit and dust drifted against the kerb
  vec2 GP_qT; vec2 GP_qN;   // world directions of the street frame q (along, across)
  // the asphalt height field's layers (GP31 round 2, owner 2026-09-28: "complex procedural materials ... potholes, mud,
  // imperfections, weathering")
  uniform vec3 gpSun;       // ENV.sunDir, toward the sun
  float GP_potD;            // depth below the road of the surface the eye sees (a pothole's wall, floor or water)
  float GP_potIn;           // 1 = inside a pothole
  float GP_potF;            // 1 = on its floor (base course and silt), 0 = up its broken wall
  float GP_water;           // standing water coverage
  float GP_wDepth;          // its depth, metres
  float GP_rim;             // the ring of mud and damp round a pothole
  vec2 GP_pomXZ;            // parallax: world xz from the fragment to where the eye ray meets the surface
  vec2 GP_slopeW;           // macro slope (pothole walls, patch seams, crack walls), world xz
  float GP_shadow;          // direct-light factor: pothole walls and crevices shading their own floor
  float GP_ravel;           // raveling: the fines worn out, the aggregate standing proud
  float GP_allig;           // alligator (fatigue) cracking net
  float GP_open;            // open (unsealed) cracks, 5-14 mm, with depth
  float GP_bleach;          // sun-oxidised binder away from the tyres
  float GP_trk;             // tyre track (polish)
  float GP_flake;           // thermoplastic flaked off along a crack
  float GP_castPat;         // a cover's cast face: 1 = raised (polished) iron, 0 = the lows between; 0.5 = none
  float GP_castSlot;        // a vented cover's slots, open to the dark vault
  float GP_pEdge;           // metres to a marking's long edge (gpKerbWorker's rectangle frame; 1 = none)
  float GP_hp;              // the scan's chip relief at the visible point, -0.5 (lows) .. 0.5 (tops)
  // a pothole cell of the street frame (9 m along x one 3.35 m lane across): xy centre, z radius, w depth; 0 = none.
  // In a tyre track by preference (0.85 m either side of the cell's centre line), on old pours only.
  vec4 gpPotCell(vec2 cid, float lotH) {
    if (hash12(cid + 91.3) > 0.034 * ${GP_DEFECT.toFixed(3)} * smoothstep(0.40, 0.66, lotH)) return vec4(0.0);
    float s = hash12(cid + 17.1), r1 = hash12(cid + 3.3), r2 = hash12(cid + 5.5);
    float R = s < 0.68 ? 0.13 + 0.10 * r1 : s < 0.94 ? 0.25 + 0.17 * r1 : 0.46 + 0.24 * r1;
    float D = s < 0.68 ? 0.022 + 0.018 * r2 : s < 0.94 ? 0.040 + 0.030 * r2 : 0.065 + 0.035 * r2;
    float side = hash12(cid + 7.7) < 0.5 ? -0.85 : 0.85;
    return vec4((cid.x + 0.2 + 0.6 * hash12(cid + 9.9)) * 9.0, (cid.y + 0.5) * 3.35 + side + (hash12(cid + 11.1) - 0.5) * 0.4, R, D);
  }
  // the pothole's surface below the road (metres, <= 0) at street-frame point q: a broken, near-vertical wall ~3 cm wide
  // on a ragged outline (three noise octaves on the radius), a bowl deepest in the middle, base-course rubble on the floor
  float gpPotH(vec2 q, vec4 P, float seed) {
    vec2 d = q - P.xy; d.x /= 1.25;                               // tyres open them along the street
    float r = length(d);
    vec2 u = d / P.z;                                             // the outline's noise in the pothole's own units
    float edge = P.z * (0.62 + 0.42 * vnoise(u * 1.6 + seed) + 0.22 * vnoise(u * 4.3 + seed * 1.7) + 0.10 * vnoise(u * 11.0 + seed * 2.3));
    float inside = smoothstep(edge + 0.012, edge - 0.03, r);
    float bowl = 1.0 - 0.35 * smoothstep(0.0, edge, r);
    return -P.w * inside * bowl * (0.86 + 0.28 * vnoise(q * 11.0 + seed));
  }
  varying vec4 vK;  // the kerb frame (world/gpKerbWorker.js): across-street, to-kerb, width, bearing (paint: its rectangle)
  vec2 gpH2(vec2 p) { return vec2(hash12(p + 0.37), hash12(p * 1.71 + 5.13)); }
  // value noise with its analytic gradient (n, dn/dx, dn/dy): the same field as vnoise()
  vec3 vnoiseD(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
    float a = hash12(i), b = hash12(i + vec2(1.0, 0.0)), c = hash12(i + vec2(0.0, 1.0)), d = hash12(i + vec2(1.0, 1.0));
    float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
    return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
  }
  // box-filtered coverage of a band |sd| < hw over a pixel footprint 2h: a line thinner than a pixel keeps its ink, not
  // its contrast, so a crack or a joint fades to its true mean instead of widening into a grid
  float gpBand(float sd, float hw, float h) { return clamp((min(sd + h, hw) - max(sd - h, -hw)) / (2.0 * h), 0.0, 1.0); }
  // hex tiling (Mikkelsen, "Practical Real-Time Hex-Tiling", JCGT 11(2), 2022) with rotation off (the broom and the
  // paving run with the street): three randomly offset taps of one layer blended by a sharpened barycentric weight (see
  // gpHex for why the blend preserves variance). gs scales the hex cells (0.29 / gs tiles apart).
  void gpTri(vec2 s, out vec3 w, out vec2 v1, out vec2 v2, out vec2 v3) {
    s *= 3.4641016;
    vec2 sk = vec2(s.x - 0.57735027 * s.y, 1.15470054 * s.y);
    vec2 b = floor(sk), f = fract(sk);
    float tz = 1.0 - f.x - f.y, sg = step(0.0, -tz), s2 = 2.0 * sg - 1.0;
    w = vec3(-tz * s2, sg - f.y * s2, sg - f.x * s2);
    v1 = b + vec2(sg); v2 = b + vec2(sg, 1.0 - sg); v3 = b + vec2(1.0 - sg, sg);
  }
  void gpHex(float L, vec2 st, float gs, vec2 gx, vec2 gy, out vec4 A, out vec4 N) {
    vec3 w; vec2 v1, v2, v3; gpTri(st * gs, w, v1, v2, v3);
    vec2 s1 = st + gpH2(v1), s2 = st + gpH2(v2), s3 = st + gpH2(v3);
    vec4 a1 = textureGrad(t_gpA, vec3(s1, L), gx, gy), a2 = textureGrad(t_gpA, vec3(s2, L), gx, gy), a3 = textureGrad(t_gpA, vec3(s3, L), gx, gy);
    // w^7 and a variance-preserving blend (Heitz and Neyret, HPG 2018): mean + sum w (tap - mean) / sqrt(sum w^2). A plain
    // weighted average loses contrast where the taps blend, which drew the hex cells as soft, washed patches (the 2 m
    // stills of the first GPU batch); Mikkelsen's brighter-tap weighting keeps contrast but lifts the mean over the
    // layer's (a 125th St lane measured 22 levels lighter than GM28), and the mean is the calibration. This keeps both.
    int Li = int(L + 0.5);
    vec3 w2 = w * w, W = w2 * w2 * w2 * w;
    W /= max(W.x + W.y + W.z, 1e-6);
    float vs = inversesqrt(max(dot(W, W), 1e-4));
    vec4 mA = vec4(GP_MEAN[Li], GP_HM[Li]), mN = vec4(0.5, 0.5, GP_RGH[Li], GP_AO[Li]);
    A = clamp(mA + ((a1 - mA) * W.x + (a2 - mA) * W.y + (a3 - mA) * W.z) * vs, 0.0, 1.0);
    vec4 n1 = textureGrad(t_gpN, vec3(s1, L), gx, gy), n2 = textureGrad(t_gpN, vec3(s2, L), gx, gy), n3 = textureGrad(t_gpN, vec3(s3, L), gx, gy);
    N = clamp(mN + ((n1 - mN) * W.x + (n2 - mN) * W.y + (n3 - mN) * W.z) * vs, 0.0, 1.0);
  }
  // the longitudinal crack line of the street frame q (tar snakes and open cracks share it, and the paint over them):
  // signed metres to the zero isoline of a warped noise, its distance taken as |f| / |grad f| with the gradient analytic
  // (warp included), so a band drawn round it keeps a constant width in metres. p = the noise coordinate (for the width
  // and run masks), gd = the unit gradient in q.
  float gpCrackL(vec2 q, vec2 lotId, out vec2 p, out vec2 gd) {
    vec3 w1 = vnoiseD(q * 0.09 + 3.0), w2 = vnoiseD(q * 0.09 + 17.0);
    const vec2 S = vec2(0.11, 0.30);
    p = q * S + vec2(w1.x, w2.x) * 1.2 + lotId * 7.31;
    vec3 nf = vnoiseD(p);
    vec2 g = vec2(nf.y * (S.x + 0.108 * w1.y) + nf.z * 0.108 * w2.y, nf.y * 0.108 * w1.z + nf.z * (S.y + 0.108 * w2.z));
    // the meander a real crack has at 0.1-1 m (the warp alone draws smooth 5-10 m arcs): two finer noises added to the
    // field, their gradients too, so the width stays constant through every wiggle
    vec3 f1 = vnoiseD(q * 1.3 + 41.0), f2 = vnoiseD(q * 4.7 + 13.0);
    float f = nf.x + 0.060 * (f1.x - 0.5) + 0.016 * (f2.x - 0.5);
    g += 0.078 * f1.yz + 0.075 * f2.yz;
    float gl = max(length(g), 1e-4);
    gd = g / gl;
    return (f - 0.5) / gl;
  }
  // the 30 m aerial scan (the nrm array's last layer): R = luminance / mean x 0.5, hex-tiled on ~12 m cells (the field of view of a
  // single aerial tile would repeat three times along one block face)
  float gpMacro(vec2 st, vec2 gx, vec2 gy) {
    vec3 w; vec2 v1, v2, v3; gpTri(st * 0.72, w, v1, v2, v3);
    vec3 w2 = w * w, W = w2 * w2 * w; W /= max(W.x + W.y + W.z, 1e-6);   // w^5, variance-preserving as gpHex
    float vs = inversesqrt(max(dot(W, W), 1e-4));
    return max(1.0 + 2.0 * ((textureGrad(t_gpN, vec3(st + gpH2(v1 + 7.7), gpMacroL), gx, gy).r - 0.5) * W.x
                           + (textureGrad(t_gpN, vec3(st + gpH2(v2 + 7.7), gpMacroL), gx, gy).r - 0.5) * W.y
                           + (textureGrad(t_gpN, vec3(st + gpH2(v3 + 7.7), gpMacroL), gx, gy).r - 0.5) * W.z) * vs, 0.2);
  }
${GP32 ? GP32_NET_GLSL : ''}`;
// GP31 asphalt (matId 0 and its gutter / bus-lane variants). The tone is still the block-face lottery GT13 calibrated
// (lotAge between the fresh and the ten-summer binder, AM120 values); what changed is what draws inside it.
const GP31_ASPH_GLSL = /* glsl */ `
          vec2 lotQ = gG / vec2(82.0, 76.0) + vec2(fbm(gG * 0.013 + 4.0), fbm(gG * 0.015 + 21.0)) * vec2(0.075, 0.075);
          vec2 lotId = floor(lotQ);
          float lotH = (hash12(lotId + 3.3) + hash12(lotId + 11.7) + hash12(lotId + 27.1) + hash12(lotId + 41.9)) * 0.25;
          float lotAge = clamp(lotH * 0.86 + n1 * 0.28, 0.0, 1.0);
          albedo = mix(vec3(0.0649, 0.0781, 0.0868), vec3(0.2050, 0.2120, 0.2220), lotAge);
          GND_age = lotAge;
          GND_rough = 0.92 + lotAge * 0.05;
          GND_spec = 0.62;
          // the scan a block face is laid in: a quarter of them (lotH < 0.40, the darkest quarter of the lottery) are a
          // young pour, tight binder over fine chips (asphalt_pit_lane); the rest the weathered set with its aggregate out
          // (Asphalt031). lotH, not lotAge: n1 varies inside a lot and would switch the scan mid-block.
          GP_layer = lotH < 0.40 ? 1.0 : 0.0;
          ${GP_DEFECT > 50 ? 'lotH = max(lotH, 0.8);   // ?gpdefect > 50: every pour old enough for every defect (inspection only)' : ''}
          ${GP32 ? 'float gpJD = 9.0, gpJS = 0.0;   // GP32: metres to the nearest cold joint between two pours, and along it' + String.fromCharCode(10) + '          ' : ''}{
            // the cold joint where two pours meet (GT13), its AA width in the lot's own cell units
            vec2 lf = abs(fract(lotQ) - 0.5);
            vec2 lw = (abs(gGx) + abs(gGy)) / vec2(82.0, 76.0) * 1.5 + 0.0016;
            float seam = max(smoothstep(0.5 - lw.x, 0.5 - lw.x * 0.25, lf.x), smoothstep(0.5 - lw.y, 0.5 - lw.y * 0.25, lf.y));
            ${GP32 ? `// GP32: GP31 drew the joint as a straight band 12 % darker, 1.5 px wide at any range (the long line down the
            // middle of the junction box at 125th and Lenox); it opens as a crack, drawn with the crack net below
            gpJD = min((0.5 - lf.x) * 82.0, (0.5 - lf.y) * 76.0); gpJS = (0.5 - lf.x) * 82.0 < (0.5 - lf.y) * 76.0 ? gG.y : gG.x;` : 'albedo *= 1.0 - seam * 0.12 * gMid;'}
          }
          // broad traffic soot (a 28 m field): the one noise darkening kept, at two thirds of its GM28 depth
          albedo *= 1.0 - smoothstep(0.55, 0.95, fbm(vWPos.xz * 0.035 + 9.1)) * 0.12;
          // the street frame: along the street and metres out from the kerb (gpKerbFrame), or the block mask without one
          vec2 q = kOk ? vec2(kqx, kQ) : (gAx > 0.5 ? gG.yx : gG);
          #ifndef GNDCHEAP
          {
            // tyre tracks: two per travel lane, their centres 0.85 m either side of the lane's (a 1.7 m track), polished
            // smoother and a shade darker by rubber, the oil drip line between them. With the kerb frame the lanes are
            // laid out from the kerb as a NYC street is: an 8 ft (2.4 m) parking lane each side and the travel lanes
            // sharing the rest; parked cars drip in the parking lane instead. A lane period fades to its mean before it
            // reaches a pixel, and the tracks come and go along the street (traffic wanders; a queue polishes an approach).
            float lv = smoothstep(1.4, 0.35, gFw);
            float trk = 0.0, drip = 0.0, laneId = 0.0;
            if (kOk) {
              float W = kOk2 ? kW : 40.0;
              float dk = kDn;
              float nL = max(1.0, floor((W - 4.8) / 3.2 + 0.35));
              float lw = max((W - 4.8) / nL, 2.8);
              float lc = (kQ - 2.4) / lw;
              float dl = abs(fract(lc) - 0.5) * lw;         // metres from the lane centre
              float inL = smoothstep(2.2, 2.6, dk);
              laneId = floor(lc);
              trk = inL * smoothstep(0.62, 0.28, abs(dl - 0.85));
              drip = inL * smoothstep(0.36, 0.10, dl);
              // the parking lane: a parked car's drip every car length or so, 1.1-1.6 m out from the kerb
              float side = step(W * 0.5, kQ) * (kOk2 ? 1.0 : 0.0);
              float pc = q.x / 6.3 + side * 0.37;
              vec2 pid = vec2(floor(pc), side);
              if (hash12(pid + 3.1) < 0.55) {
                vec2 pd = vec2((fract(pc) - 0.25 - 0.5 * hash12(pid + 7.7)) * 6.3, dk - 1.1 - 0.5 * hash12(pid + 1.9));
                float pk = smoothstep(0.42, 0.12, length(pd * vec2(0.7, 1.0))) * (1.0 - inL);
                GND_oil = max(GND_oil, pk * 0.5 * lv);
              }
              GP_dust = smoothstep(1.3, 0.35, dk);
            } else {
              float lane = q.y / 3.35 + hash12(lotId + 61.3);
              float dl = abs(fract(lane) - 0.5) * 3.35;
              laneId = floor(lane);
              trk = smoothstep(0.62, 0.28, abs(dl - 0.85));
              drip = smoothstep(0.36, 0.10, dl);
            }
            trk *= smoothstep(0.22, 0.62, vnoise(vec2(q.x * 0.035, laneId * 3.1 + 5.0))) * (0.45 + 0.55 * hash12(vec2(laneId, lotId.x + 3.0 * lotId.y)));
            drip *= smoothstep(0.35, 0.78, vnoise(vec2(q.x * 0.09, laneId * 7.3 + 1.0)));
            GND_wheel = trk * lv;
            albedo *= 1.0 - GND_wheel * 0.09;
            GND_rough -= GND_wheel * 0.16;
            GND_oil = max(GND_oil, drip * lv * 0.28);        // darker by 14 %, a little glossier (the shared oil composite)
          }
          // utility cuts: saw-cut rectangles 1-3 m across, back-filled a few levels off the road (a new one far darker, in
          // the fresh scan), behind a dark 1 cm kerf, a sealant overband on a third of them, the patch settled or proud
          {
            vec2 cs = vec2(13.0, 8.0);
            vec2 cc = floor(gG / cs), cf = fract(gG / cs);
            float cr = hash12(cc + 17.9);
            if (cr < 0.26 * mix(0.45, 1.0, step(0.40, lotH))) {   // a young pour has had less time to be dug up
              vec2 p0 = vec2(hash12(cc + 3.1), hash12(cc + 5.7)) * 0.52 + 0.08;
              vec2 sz = vec2(cr < 0.13 ? 0.075 + hash12(cc + 9.3) * 0.085 : 0.135 + hash12(cc + 9.3) * 0.150,
                             cr < 0.13 ? 0.175 + hash12(cc + 11.1) * 0.200 : 0.080 + hash12(cc + 11.1) * 0.090);
              vec2 pc = cf * cs, lo = p0 * cs, hi = (p0 + sz) * cs;
              vec2 dq = max(lo - pc, pc - hi);
              float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);    // metres to the cut line, < 0 inside
              float h = max(gFw * 0.5, 0.0008);
              float inner = clamp(0.5 - sd / (2.0 * h), 0.0, 1.0);
              // refs 03/04: an old restoration differs from the road by only ~10 sRGB levels, lighter or darker, and
              // reads by its saw cut, a dark 1 cm line; only a new one is the 0.35x black of fresh binder
              float fresh = hash12(cc + 23.0);
              vec3 fill = albedo * (fresh < 0.18 ? 0.42 + 0.9 * fresh : 0.86 + 0.26 * (fresh - 0.18) / 0.82);
              albedo = mix(albedo, fill, inner);
              GP_cut = inner;
              GND_patch = inner * 0.3;
              if (inner > 0.5) { GP_layer = fresh < 0.5 ? 1.0 : 0.0; GND_rough = 0.90 + 0.05 * fresh; }
              // the saw cut: a dark kerf ~1 cm, ravelled at the corners, and on half the cuts a 3.5-5.5 cm sealant overband
              float kerf = gpBand(sd, 0.004 + 0.003 * vnoise(pc * 9.0 + cc), h);
              ${GP32 ? `// GP32: the 7-14 mm kerf at 0.35 of the road (and a sealant band on a third of the cuts) drew a dark rectangle
              // outline, a pen line from 15 m; the joint opens as a crack instead (0-5.5 mm, closing and reopening, spalled)
              GP_open = max(GP_open, gpJoint(sd, pc.x + pc.y, hash12(cc + 29.0) * 40.0, 0.0055, gFw));` : 'albedo *= 1.0 - kerf * 0.65;'}
              if (${GP32 ? 'false' : 'hash12(cc + 29.0) < 0.35'}) {
                float kw = 0.018 + 0.010 * hash12(cc + 31.0);
                GP_seal = max(GP_seal, gpBand(sd, kw, h) * (0.55 + 0.45 * smoothstep(0.3, 0.6, vnoise(pc * 1.7 + cc * 3.0))));
              }
              // a settled or a proud patch: a 3-8 mm step over the 2 cm next to the cut, in the normal
              {
                vec2 gb = dq.x > dq.y ? vec2(sign(pc.x - 0.5 * (lo.x + hi.x)), 0.0) : vec2(0.0, sign(pc.y - 0.5 * (lo.y + hi.y)));
                float stepH = (hash12(cc + 37.0) < 0.7 ? -1.0 : 1.0) * (0.003 + 0.005 * hash12(cc + 41.0));
                float wall = gpBand(sd + 0.010, 0.010, h) * smoothstep(0.012, 0.004, gFw);
                GP_slopeW += (gb.x * MG_A + gb.y * MG_B) * (stepH / 0.02) * wall;   // the normal leans off the higher side
              }
            }
          }
          // crack sealant ("tar snakes"): the zero isoline of a warped noise drawn at a constant width in metres (the
          // distance is |f| / |grad f| with the gradient analytic, warp included, so compression cannot fatten a band into
          // the r3 "black smoke snakes"), stretched along the street as NYC cracks mostly follow the paving passes,
          // present on stretches of the line only, and only on pours old enough to crack. A squeegeed overband: 4.4-7 cm,
          // darker than the road, satin, feathered at the edge (the surface pass sets its tone and sheen).
          {
            float aged = smoothstep(0.38, 0.62, lotH);
            ${GP32 ? `// GP32 (owner 2026-09-29: "I don't like low-quality lines etc. I gave you high quality references don't give me
            // lines"). GP31 drew every crack as a band of one width round the zero isoline of a warped noise: sealed runs
            // 4.4-8.4 cm wide at 0.17-0.40 of the road's albedo, from the fTraffic lens (17 m up, 20-45 m out) 2-4 px black
            // strokes, smooth, closing into loops, and in the junction's per-triangle frames straight transverse runs that
            // crossed in an X. What replaces them is what the references show: the crack net (gpCrackNet: block cracking on
            // a world-anchored cell grid, a third of the borders uncracked, the rest a hairline to 11 mm, the width wandering
            // and closing to nothing, a jag round the chips, spalled lips, a dusty dark floor, walls in the normal) and the
            // cold joint drawn the same way. No sealant bands: a squeegeed band of one width is the stroke itself. Past a
            // 10 cm footprint an 11 mm crack is a tenth of a pixel of ink: skipped.
            if (gFw < 0.10) {
              GP_open = max(GP_open, gpNetC);
              GP_open = max(GP_open, gpJoint(gpJD, gpJS, hash12(lotId + 3.9) * 50.0, 0.0045, gFw) * smoothstep(0.30, 0.55, lotH));
            }
            if (false) {` : 'if (aged > 0.01 && gFw < 0.15) {   // past a 15 cm footprint a 5 cm band is a third of a pixel of ink: skipped'}
              vec2 p, gq;
              float sd = gpCrackL(q, lotId, p, gq);                                   // signed metres to the crack line
              float gl = 1.0;
              float hw = 0.022 + 0.013 * vnoise(p * 3.1 + 11.0) + 0.007 * (vnoise(q * 22.0 + 3.0) - 0.5);   // a squeegee edge is ragged
              // sealed or not (a crew seals a whole run): age raises the share of the line that is sealed, not its opacity
              float on = smoothstep(0.0, 0.035, vnoise(p * 0.55 + 29.0) - mix(0.74, 0.46, aged));
              float h = max(gFw * 0.5, 0.0008);
              float band = gpBand(sd, hw, h) * on;
              GP_seal = max(GP_seal, band);
              GP_sealE = max(GP_sealE, max(band - gpBand(sd, hw * 0.62, h) * on, 0.0));
              // a squeegeed band is flat with feathered edges, 1-2 mm proud: the edge rolls off over its outer third (a
              // rounded tube read as a plastic worm lying on the road in the first GPU stills)
              float lip = smoothstep(hw * 0.62, hw, abs(sd)) * band * smoothstep(0.012, 0.003, gFw);
              GP_sealN += sign(sd) * (gq / gl) * lip * 0.10;
              // unsealed hairline cracks, 2-4 mm, a finer net on the older pours: dark lines inside ~8 m, their mean beyond
              if (gFw < 0.014) {
                vec3 h1 = vnoiseD(q * 0.16 + 9.0);
                vec2 p2 = q * vec2(0.55, 0.85) + h1.x * 1.2 + lotId * 3.7;
                vec3 n2 = vnoiseD(p2);
                vec2 g2 = vec2(n2.y * (0.55 + 0.192 * h1.y) + n2.z * 0.192 * h1.y, n2.y * 0.192 * h1.z + n2.z * (0.85 + 0.192 * h1.z));
                float sd2 = (n2.x - 0.5) / max(length(g2), 1e-4);
                float cr2 = gpBand(sd2, 0.0012 + 0.0010 * vnoise(p2 * 4.0), max(gFw * 0.5, 0.0004));
                GP_crack = cr2 * smoothstep(0.40, 0.58, vnoise(p2 * 0.8 + 13.0)) * smoothstep(0.40, 0.62, lotH) * smoothstep(0.014, 0.006, gFw);
              }
              // the same line where no crew came: an open crack 5-14 mm wide and about as deep, dark at the bottom, its
              // walls tilting the normal toward it; and transverse cracks across the street every 6-20 m (thermal)
              float h2 = max(gFw * 0.5, 0.0006);
              float offC = smoothstep(0.0, 0.035, mix(0.70, 0.40, aged) - vnoise(p * 0.55 + 29.0)) * smoothstep(0.45, 0.62, lotH);
              float ow = 0.0025 + 0.0045 * vnoise(p * 2.3 + 5.0);
              float oc = gpBand(sd, ow, h2) * offC;
              vec3 w3 = vnoiseD(q * vec2(0.08, 0.05) + 31.0);
              vec2 p3 = q * vec2(0.16, 0.035) + w3.x * 0.8 + lotId * 5.1;
              vec3 n3 = vnoiseD(p3);
              vec2 g3 = vec2(n3.y * (0.16 + 0.064 * w3.y) + n3.z * 0.064 * w3.y, n3.y * 0.04 * w3.z + n3.z * (0.035 + 0.04 * w3.z));
              float gl3 = max(length(g3), 1e-4), sd3 = (n3.x - 0.5) / gl3;
              float on3 = smoothstep(0.0, 0.03, vnoise(p3 * 0.7 + 3.0) - mix(0.82, 0.55, aged));
              float cw3 = 0.0025 + 0.005 * vnoise(p3 * 4.0 + 1.0);
              float tc3 = gpBand(sd3, cw3, h2) * on3;
              // a third of the transverse ones were sealed (a squeegeed band over them), the rest stand open
              if (hash12(floor(p3 * vec2(0.5, 0.25)) + 71.0) < 0.33) { GP_seal = max(GP_seal, gpBand(sd3, 0.028, h) * on3); tc3 = 0.0; }
              GP_open = max(oc, tc3);
              float wall = smoothstep(0.012, 0.003, gFw);
              GP_slopeW += (sign(sd) * (gq / gl).x * GP_qT + sign(sd) * (gq / gl).y * GP_qN) * -0.55 * max(gpBand(sd, ow * 2.2, h2) - oc, 0.0) * offC * wall;
              GP_slopeW += (sign(sd3) * (g3 / gl3).x * GP_qT + sign(sd3) * (g3 / gl3).y * GP_qN) * -0.55 * max(gpBand(sd3, cw3 * 2.2, h2) - tc3, 0.0) * on3 * wall;
            }
          }
          // raveling (the fines worn out of an old surface, the aggregate standing proud and the lows open) and
          // oxidation (the binder bleached to a pale grey where no tyre scrubs it); both old-pour only
          float rv = smoothstep(0.50, 0.72, vnoise(q * vec2(0.09, 0.30) + lotId * 3.1 + 7.0));
          GP_ravel = rv * smoothstep(0.45, 0.72, lotH) * (0.55 + 0.45 * GND_wheel);
          GP_bleach = smoothstep(0.35, 0.80, lotAge) * (1.0 - GND_wheel);
          GP_trk = GND_wheel;
          albedo *= 1.0 + 0.05 * GP_bleach;
          // alligator (fatigue) cracking: stretches of an old wheel track broken into 10-35 cm chunks, each a little
          // raised or sunk and tilted on its own, the gaps 5-15 mm wide down to the dark base course. The chunk tilt goes
          // into the normal (each chunk catches the light on its own), the gaps are box-filtered, and past ~8 m the net
          // is its mean darkening
          {
            float az = smoothstep(0.60 - 0.05 * ${Math.log2(GP_DEFECT).toFixed(3)}, 0.74 - 0.05 * ${Math.log2(GP_DEFECT).toFixed(3)}, vnoise(vec2(q.x * 0.11, q.y * 0.35) + lotId * 2.7 + 17.0)) * smoothstep(0.50, 0.72, lotH) * smoothstep(0.25, 0.6, GND_wheel + 0.25 * GP_ravel);
            if (az > 0.01) {
              if (gFw < 0.014) {
                vec2 vp = (q + vec2(vnoise(q * 2.1 + 3.0), vnoise(q * 2.1 + 11.0)) * 0.09) / 0.21;
                vec2 ci = floor(vp), cf = fract(vp);
                float f1 = 9.0, f2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(0.0), i1 = vec2(0.0);
                for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
                  vec2 o = vec2(float(i), float(j));
                  vec2 pt = o + gpH2(ci + o) * 0.8 + 0.1 - cf;
                  float dd2 = dot(pt, pt);
                  if (dd2 < f1) { f2 = f1; m2 = m1; f1 = dd2; m1 = pt; i1 = ci + o; } else if (dd2 < f2) { f2 = dd2; m2 = pt; }
                }
                vec2 bn = normalize(m2 - m1);
                float eb = dot(0.5 * (m1 + m2), bn) * 0.21;          // metres to the chunk's border
                float gw = 0.0025 + 0.005 * hash12(i1 + 4.4);
                ${GP32 ? `float sp0a = GP_cSpall;   // GP32: the crack look, not a gap of one width (its lips weighted like the gaps)
                float gap = gpCrackBand(eb, dot(q, vec2(-bn.y, bn.x)), hash12(i1 + 4.4), gw * 1.7, gFw);
                GP_cSpall = sp0a + (GP_cSpall - sp0a) * az;` : 'float gap = gpBand(eb, gw, max(gFw * 0.5, 0.0004));'}
                GP_allig = gap * az;
                vec2 tilt = (gpH2(i1 + 8.8) - 0.5) * 0.22;           // each chunk tilted by up to ~6 deg
                float lift = (hash12(i1 + 2.6) - 0.5) * 0.010;       // and raised or sunk by up to 5 mm
                float fade = smoothstep(0.014, 0.005, gFw) * az;
                GP_slopeW += (tilt.x * GP_qT + tilt.y * GP_qN) * fade * (1.0 - gap);
                // the chunk's edge rounds down into the gap (the lip catches the light, the far side is in shadow)
                float lip = smoothstep(gw * 3.5, gw, eb) * (1.0 - gap);
                GP_slopeW += (bn.x * GP_qT + bn.y * GP_qN) * (0.35 + 20.0 * lift) * lip * fade;
                albedo *= 1.0 + lift * 6.0 * az;                      // a raised chunk is scrubbed lighter, a sunk one holds grime
              } else {
                albedo *= 1.0 - 0.10 * az;
              }
            }
          }
          // potholes: in the near field the eye ray is marched down the pothole's height field (16 steps and a secant
          // refine: the broken far wall hides the floor, the near wall shows), the visible point's world offset feeds every
          // texture lookup (parallax), standing water sits at a flat fill level, and the walls shadow the floor from the
          // sun. Past a 5 cm footprint (~15-20 m from a street-level eye) a pothole is drawn where it lies, without the march.
          GP_potD = 0.0; GP_potIn = 0.0; GP_potF = 0.0; GP_water = 0.0; GP_wDepth = 0.0; GP_rim = 0.0; GP_pomXZ = vec2(0.0); GP_shadow = 1.0;
          if (kOk) {
            vec2 cid = floor(vec2(q.x / 9.0, q.y / 3.35));
            vec4 P = gpPotCell(cid, lotH);
            if (P.w > 0.0) {
              float seed = hash12(cid + 2.2) * 50.0;
              float wl = -P.w * min(0.30 + 0.45 * hash12(cid + 13.3) + 0.25 * wet, 0.92);   // the water's fill level, higher in rain
              bool hasW = hash12(cid + 19.9) < 0.50 + 0.50 * clamp(wet * 2.0, 0.0, 1.0);
              vec2 rr = (q - P.xy) / vec2(1.25, 1.0);
              GP_rim = smoothstep(P.z * 2.3, P.z * 1.0, length(rr)) * (0.55 + 0.45 * vnoise(q * 3.0 + seed));
              // the broken rim: loose fragments of the wearing course round the hole, 3-6 cm, each lifted and tilted on
              // its own with a dark gap round it, thinning out away from the edge (ref 1)
              if (gFw < 0.010) {
                float ring = smoothstep(P.z * 1.75, P.z * 1.05, length(rr)) * smoothstep(P.z * 0.80, P.z * 1.02, length(rr));
                if (ring > 0.01) {
                  vec2 vp = q / 0.045;
                  vec2 ci = floor(vp), cf = fract(vp);
                  float f1 = 9.0, f2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(0.0), i1 = vec2(0.0);
                  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
                    vec2 o = vec2(float(i), float(j));
                    vec2 pt = o + gpH2(ci + o + seed) * 0.8 + 0.1 - cf;
                    float dd2 = dot(pt, pt);
                    if (dd2 < f1) { f2 = f1; m2 = m1; f1 = dd2; m1 = pt; i1 = ci + o; } else if (dd2 < f2) { f2 = dd2; m2 = pt; }
                  }
                  float loose = step(hash12(i1 + seed + 3.3), ring * 0.75);
                  if (loose > 0.5) {
                    float eb = dot(0.5 * (m1 + m2), normalize(m2 - m1)) * 0.045;
                    float gap = gpBand(eb, 0.0025, max(gFw * 0.5, 0.0004));
                    GP_allig = max(GP_allig, gap);
                    vec2 tilt = (gpH2(i1 + seed + 8.8) - 0.5) * 0.45;
                    GP_slopeW += (tilt.x * GP_qT + tilt.y * GP_qN) * (1.0 - gap) * smoothstep(0.010, 0.004, gFw);
                  }
                }
              }
              float h0 = gpPotH(q, P, seed);
              float dVis = -h0, wetK = 0.0;
              vec2 qv = q;
              vec3 Vd = normalize(vWPos - cameraPosition);
              float vy = max(-Vd.y, 0.05);
              vec2 vq = vec2(dot(Vd.xz, GP_qT), dot(Vd.xz, GP_qN)) / vy;     // q travel per metre of depth
              if (gFw < 0.05) {
                // march: reject rays that stay clear of the pothole's reach between depth 0 and its depth
                vec2 a0 = q - P.xy, a1 = a0 + vq * P.w;
                vec2 ab = a1 - a0; float tt = clamp(-dot(a0, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
                vec2 cl = (a0 + ab * tt) / vec2(1.25, 1.0);
                if (length(cl) < P.z * 1.5 + 0.03) {
                  const int NS = 16;
                  float dz = P.w * 1.15 / float(NS);
                  float dPrev = 0.0, fPrev = -h0;       // f(d) = ray height - surface = -d - h
                  float dHit = 0.0;
                  if (h0 < -1e-4) {
                    dHit = P.w * 1.15;
                    for (int k = 1; k <= NS; k++) {
                      float dd = dz * float(k);
                      float f = -dd - gpPotH(q + vq * dd, P, seed);
                      if (f <= 0.0) { dHit = mix(dPrev, dd, fPrev / max(fPrev - f, 1e-6)); break; }
                      dPrev = dd; fPrev = f;
                    }
                  }
                  // the ray meets the water first when it would reach the ground below the water level. The waterline is
                  // soft over the last 4 mm: a hard switch drew a 1 px line of wall normal round the pool, and once wet
                  // that line mirrored the sky as a white ring
                  float dW = -wl;
                  wetK = hasW ? smoothstep(dW - 0.004, dW + 0.0005, dHit) : 0.0;
                  dVis = wetK > 0.5 ? dW : dHit;
                  qv = q + vq * dVis;
                }
              }
              if (hasW && gFw >= 0.05) wetK = step(-wl, dVis);             // past the march: the pool where it lies
              GP_potD = dVis;
              GP_potIn = smoothstep(0.003, 0.010, dVis);
              GP_pomXZ = (qv.x - q.x) * GP_qT + (qv.y - q.y) * GP_qN;
              if (GP_potIn > 0.0) {
                float hv = gpPotH(qv, P, seed);
                GP_potF = smoothstep(0.55, 0.85, -hv / P.w);
                GP_water = wetK;
                GP_wDepth = max(wl - hv, 0.0);
                if (GP_water < 0.999) {
                  // wall and floor slope from the height field, and the wall's shadow toward the sun
                  float e = 0.012;
                  vec2 gh = vec2(gpPotH(qv + vec2(e, 0.0), P, seed) - hv, gpPotH(qv + vec2(0.0, e), P, seed) - hv) / e;
                  // the wall slope, softened and clamped: a wall is 1-3 px tall from a street-level eye, and at full slope its
                  // sun-facing side lit up as a bright outline round the hole (?gpdbg=2 shows the terms)
                  vec2 gsw = -(gh.x * GP_qT + gh.y * GP_qN) * 0.4;
                  float gsl = length(gsw);
                  GP_slopeW += gsw * min(1.0, 0.5 / max(gsl, 1e-4)) * (1.0 - GP_water);
                  vec2 sq = vec2(dot(gpSun.xz, GP_qT), dot(gpSun.xz, GP_qN));
                  float sl = max(length(sq), 1e-3), tanE = gpSun.y / sl;
                  float occ = 0.0;
                  for (int j = 1; j <= 4; j++) {
                    float s = 0.025 * float(j * j);
                    float hs = gpPotH(qv + sq / sl * s, P, seed);
                    occ = max(occ, smoothstep(0.0, 0.006, hs - (hv + s * tanE)));
                  }
                  GP_shadow = mix(1.0, 0.18, occ * GP_potIn * (1.0 - GP_water));
                }
              }
            }
          }
          // castings: manhole, valve box and the collar patched round them (the GM28 layer as it was)
          {
            vec2 mc = floor(vWPos.xz / 15.0);
            float mr = hash12(mc);
            if (mr < 0.42) {
              vec2 mo = vec2(hash12(mc + 1.7), hash12(mc + 2.9)) * 0.7 + 0.15;
              float md = length((fract(vWPos.xz / 15.0) - mo) * 15.0);
              float R = mr < 0.28 ? 0.36 : 0.16;
              float ae = max(0.5 * (length(gPx.xz) + length(gPy.xz)), 0.004);
              float collar = 1.0 - smoothstep(R + 0.34, R + 0.62, md);
              albedo *= 1.0 + collar * mix(-0.16, 0.22, step(0.5, hash12(mc + 41.0))) * gMid;
              float rim = smoothstep(R + 0.09 + ae, R + 0.09 - ae, md);
              float cover = smoothstep(R + ae, R - ae, md);
              GND_manhole = max(cover, rim * 0.45);
              GND_cast = max(GND_manhole, collar * 0.85);
              GP_seal *= 1.0 - smoothstep(R + 0.12, R + 0.02, md);   // no sealant over the iron
              // the cast face (ref 03): a flat cover read as a painted disc at 2-4 m. A 4 cm raised rim, then either a
              // DEP waffle (a square grid of raised bosses, 5 cm pitch) or a Con Ed vented pattern (radial slots through
              // to the dark vault below); tyres polish the high points to bare metal, grit fills the lows
              if (cover > 0.01 && gFw < 0.02) {
                vec2 lp = (fract(vWPos.xz / 15.0) - mo) * 15.0;
                float vent = step(0.5, hash12(mc + 53.0)) * step(0.30, R);
                float ringR = smoothstep(R - 0.045, R - 0.035, md);
                float pat, pdx = 0.0, pdy = 0.0;
                if (vent > 0.5) {
                  float th = atan(lp.y, lp.x) * 5.0929582;               // 32 slots round
                  float slot = smoothstep(0.30, 0.18, abs(fract(th) - 0.5)) * step(0.08, md) * step(md, R - 0.06);
                  pat = 1.0 - slot;
                  GP_castSlot = slot;
                } else {
                  vec2 g = abs(fract(lp / 0.05) - 0.5);
                  pat = smoothstep(0.30, 0.18, max(g.x, g.y));           // bosses
                  vec2 sg = vec2(fract(lp.x / 0.05) < 0.5 ? 1.0 : -1.0, fract(lp.y / 0.05) < 0.5 ? 1.0 : -1.0);
                  float edge = smoothstep(0.34, 0.26, max(g.x, g.y)) - pat;
                  pdx = g.x > g.y ? sg.x * edge : 0.0; pdy = g.y >= g.x ? sg.y * edge : 0.0;
                }
                pat = max(pat, ringR);
                GP_castPat = mix(0.5, pat, cover * smoothstep(0.02, 0.006, gFw));
                GP_slopeW += (vec2(pdx, pdy) * 0.45 + (lp / max(md, 1e-3)) * (smoothstep(R - 0.045, R - 0.03, md) - smoothstep(R - 0.015, R, md)) * 0.5) * cover * smoothstep(0.012, 0.005, gFw);
              }
            }
          }
          #endif
`;
// GP31 sidewalk (matId 1, the flag and the curb top).
const GP31_WALK_GLSL = /* glsl */ `
          // ---- NYC sidewalk: 5 ft (1.524 m) flags on the street grid (DOT Street Works Manual 4.4), each its own pour.
          // A flag takes one of the two scanned finishes at its own random offset (no two neighbours share a patch of
          // texture), the broom grooves running across the walk, curb to building line, as a finisher drags them. The
          // tone keeps the round-3/LB14 calibration; the two fbm stain clouds and the tree-pit halo GM28 laid over every
          // walk (7-20 m blotches) are gone. Stains are discrete (one flag cell in six), gum spots are their real 1-3 cm,
          // and grime sits where it collects: packed into the tooled joints.
          albedo = mix(vec3(0.496, 0.437, 0.261), vec3(0.571, 0.501, 0.299), n1);
          vec2 sco = gG / 1.524;
          vec2 sid = floor(sco);
          float slab = hash12(sid);
          vec2 sfr = fract(sco);
          vec2 jm = min(sfr, 1.0 - sfr) * 1.524;                // metres to the nearest joint, per axis
          vec2 pxm = abs(gGx) + abs(gGy);                       // pixel footprint along each grid axis, metres
          float swAx = smoothstep(0.38, 0.62, vnoise(gG * 0.0075 + 41.0));
          vec2 jW = vec2(mix(1.0, 0.42, swAx), mix(0.42, 1.0, swAx));   // strong joints run curb-to-building (round 3)
          // the tooled joint: a 1 cm groove packed with grit, box-filtered so a joint past resolution keeps only its ink
          vec2 jc = vec2(gpBand(jm.x, 0.005, max(pxm.x * 0.5, 0.0005)), gpBand(jm.y, 0.005, max(pxm.y * 0.5, 0.0005))) * jW;
          albedo *= 1.0 - max(jc.x, jc.y) * 0.74;   // refs 07/08: the joints read as dark lines from 1 to 10 m
          // grime spreading 2-5 cm either side of it
          vec2 jh = vec2(gpBand(jm.x, 0.035, max(pxm.x * 0.5, 0.0005)), gpBand(jm.y, 0.035, max(pxm.y * 0.5, 0.0005))) * jW;
          albedo *= 1.0 - max(jh.x, jh.y) * 0.10;
          {
            // the groove walls and the edger's 1.5 cm radius tilt the normal toward the joint; gone before it is sub-pixel
            float fade = smoothstep(0.008, 0.002, gFw);
            vec2 sgn = vec2(sfr.x < 0.5 ? -1.0 : 1.0, sfr.y < 0.5 ? -1.0 : 1.0);
            vec2 sl = 0.60 * smoothstep(0.0, 0.0015, jm) * smoothstep(0.0065, 0.004, jm)
                    + 0.16 * smoothstep(0.005, 0.008, jm) * smoothstep(0.02, 0.012, jm);
            GP_jn = sgn * sl * jW * fade;
            // no flag lies quite flat: settled a little each way, and one in sixteen heaved by a root or a vault (2-4 deg),
            // so neighbouring flags take the sun a shade differently
            GP_jn += (gpH2(sid + 21.0) - 0.5) * (hash12(sid + 23.0) < 0.06 ? 0.12 : 0.022);
          }
          // expansion joints every 4th flag (20 ft): a wider bitumen-filled recess, again box-filtered
          vec2 e4 = min(fract(sco / 4.0), 1.0 - fract(sco / 4.0)) * 4.0 * 1.524;
          float ej = max(gpBand(e4.x, 0.010, max(pxm.x * 0.5, 0.0005)) * jW.x, gpBand(e4.y, 0.010, max(pxm.y * 0.5, 0.0005)) * jW.y);
          albedo = mix(albedo, vec3(0.115, 0.104, 0.083), ej * 0.55);
          // per-flag pour: value and a warm/cool cement cast, the finish, and the flag's own patch of the scan
          albedo *= 0.86 + 0.26 * slab;   // refs 07/08: neighbouring flags step visibly in tone (134-178 in one frame)
          albedo *= mix(vec3(1.016, 0.998, 0.972), vec3(0.978, 0.992, 1.018), hash12(sid + 11.7));
          GND_rough = 0.86 + 0.08 * slab; GND_spec = 0.72;
          GP_layer = hash12(sid + 5.1) < 0.72 ? 2.0 : 3.0;   // most flags broom-finished, about a quarter worn to the aggregate
          GP_off = vec2(hash12(sid + 1.7), hash12(sid + 9.2));
          // replacements: ~7 % fresh flags (lighter, broom-finished), ~2 % cold-patch asphalt, bluestone in block runs
          float srep = hash12(sid + 7.3);
          float bsBlk = step(0.82, hash12(floor(gG / 126.0) + 5.9));
          if (srep < 0.07) { albedo = mix(albedo, vec3(0.693, 0.627, 0.400), 0.55); GND_rough = 0.72; GP_layer = 2.0; }
          else if (srep > 0.978) { albedo = mix(albedo, vec3(0.168, 0.152, 0.124), 0.80); GND_rough = 0.9; GP_layer = 1.0; }
          else if (bsBlk > 0.5 && srep > 0.12) {
            float bs = vnoise(gG * 6.0 + slab * 31.0);
            albedo = mix(albedo, mix(vec3(0.318, 0.330, 0.338), vec3(0.412, 0.424, 0.426), bs), 0.88);
            GND_rough = 0.74; GP_layer = 3.0;
          }
          // pull-box lids and utility locate marks (the round-3 hardware, as it was)
          if (gNear > 0.02) {
            vec2 hc = gG / 4.4;
            vec2 hid = floor(hc);
            float hr = hash12(hid + 19.3);
            if (hr < 0.30) {
              vec2 hp = (fract(hc) - vec2(hash12(hid + 2.3), hash12(hid + 6.1)) * 0.7 - 0.15) * 4.4;
              float hd = length(hp);
              float lid = smoothstep(0.145, 0.115, hd) * gNear;
              albedo = mix(albedo, vec3(0.141, 0.093, 0.059), lid * 0.9);
              albedo *= 1.0 - smoothstep(0.175, 0.148, hd) * (1.0 - lid) * 0.35;
              GND_rough = mix(GND_rough, 0.52, lid * 0.8);
            } else if (hr > 0.86) {
              float ma = hash12(hid + 41.3) * 6.2832;
              vec2 mp = (fract(hc) - vec2(hash12(hid + 2.3), hash12(hid + 6.1)) * 0.7 - 0.15) * 4.4;
              vec2 mq = mat2(cos(ma), -sin(ma), sin(ma), cos(ma)) * mp;
              float mw = 0.012;
              float mk2 = smoothstep(0.045 + mw, 0.03, abs(mq.y)) * smoothstep(0.42, 0.36, abs(mq.x))
                        + smoothstep(0.045 + mw, 0.03, abs(mq.x - 0.28)) * smoothstep(0.16, 0.12, abs(mq.y));
              mk2 = clamp(mk2, 0.0, 1.0) * (0.75 + 0.25 * vnoise(gG * 9.0));
              vec3 lc = hash12(hid + 31.7) > 0.45 ? vec3(0.55, 0.19, 0.030) : vec3(0.53, 0.13, 0.210);
              albedo = mix(albedo, lc, mk2 * 0.30 * gNear);
            }
          }
          // one or two thin cracks on ~22 % of flags (SW26)
          if (hash12(sid + 3.9) < 0.22 && gNear > 0.01) {
            float rdg = gridge(gG * 1.3 + slab * 17.0);
            albedo *= 1.0 - smoothstep(0.965, 0.995, rdg) * 0.22 * gNear;
          }
          // discrete stains: a spilt coffee, a soda, a grease drip; one cell in six of 2.6 m, 0.1-0.45 m, a ragged rim
          {
            vec2 sc2 = gG / 2.6; vec2 si = floor(sc2);
            float sh = hash12(si + 71.7);
            if (sh < 0.17) {
              vec2 sp = (fract(sc2) - vec2(hash12(si + 3.3), hash12(si + 8.8)) * 0.6 - 0.2) * 2.6;
              float lr = length(sp);
              float r0 = 0.10 + 0.35 * hash12(si + 13.1);
              float rim = r0 * (0.70 + 0.45 * vnoise(sp / max(lr, 1e-3) * 1.4 + sh * 37.0) + 0.15 * vnoise(sp * 9.0 + 3.0));
              float stn = smoothstep(rim, rim * 0.55, lr) * (0.55 + 0.45 * vnoise(sp * 5.0 + 1.0));
              albedo *= 1.0 - stn * (0.08 + 0.16 * hash12(si + 5.5));
              albedo = mix(albedo, albedo * vec3(0.985, 0.965, 0.93), stn * 0.6);   // spills dry a little warm
              GND_rough = mix(GND_rough, 0.70, stn * 0.35);
            }
          }
          // a faint broad drift so a long walk is not one value at 60 m (a third of the GM28 cloud)
          albedo *= 1.0 - smoothstep(0.5, 0.9, fbm(vWPos.xz * 0.05 + 4.2)) * 0.08;
          // gum: flattened discs 1-3 cm across, black to mid grey, glossier than the flag, thicker where people wait
          {
            float dens = 0.10 + 0.30 * smoothstep(0.3, 0.8, vnoise(gG * 0.035 + 7.0));
            float gv = smoothstep(0.016, 0.005, gFw);   // ref 08: 2 cm spots still read as dots at 5-6 m
            if (gv > 0.01) {
              vec2 mc = gG / 0.15; vec2 mid2 = floor(mc);
              float mh2 = hash12(mid2 + 91.7);
              if (mh2 < dens) {
                vec2 mp = (fract(mc) - vec2(hash12(mid2 + 4.7), hash12(mid2 + 12.1)) * 0.7 - 0.15) * 0.15;
                float r = 0.005 + 0.010 * fract(mh2 * 53.0);
                float dd = length(mp * vec2(1.0, 0.8 + 0.4 * fract(mh2 * 17.0))) / r;
                float aw = clamp(0.7 * gFw / r, 0.28, 1.0);            // the edge widens with the footprint: no 1 px sparkle
                float gum = smoothstep(1.0 + 0.5 * aw, 1.0 - aw, dd) * gv;
                albedo = mix(albedo, mix(vec3(0.030, 0.029, 0.028), vec3(0.110, 0.106, 0.100), fract(mh2 * 7.0)), gum * 0.92);
                GND_rough = mix(GND_rough, 0.55, gum * 0.6);
              }
            }
            albedo *= 1.0 - (1.0 - gv) * dens * 0.012;       // their mean once they are past resolution
          }
`;
// GP31 Times Square plaza (matId 16, TP28's re-kinded Broadway 42nd-47th). From 24 m at night (the teaser's t2Seventh)
// the plaza read as more grey asphalt: TP28 authored a charcoal field (0.150 against the asphalt's 0.065-0.205), its
// joints faded out at a 6 cm pixel footprint (about 15 m away), one paver in ten was the light tone, and the dry-night
// pass roughened it like a roadway. Photographs of the plaza (Commons, 2017 and 2023; docs/notes/ground-pbr.md) show a
// light-grey field in sun, smooth units (144,144,136) and speckled ones (162,162,155), 30 cm strips of many lengths,
// 5-10 mm joints darker than both, dense gum, and the discs in lines and arcs that cross the units. Now: that field,
// every unit its own value and its own patch of a scan (exposed aggregate or granite), box-filtered joints with a chamfer
// each side (a joint past resolution keeps its ink rather than vanishing), and a foot-polished sheen that varies unit to
// unit and survives the night pass (see roadPlane below), so it throws the screens back softly the way the real one does.
const GP31_PAVER_GLSL = /* glsl */ `
          // units: 30 cm strips along Broadway in a running bond, each row cut into its own lengths (12-19 cm strips in one
          // row in six, 27-57 cm in most, 44-80 cm in one in four), two finishes (smooth, and speckled with exposed white
          // aggregate) in runs along the axis
          vec2 A1 = vec2(0.2646, -0.9644), B1 = vec2(0.9644, 0.2646);
          vec2 pq = vec2(dot(vWPos.xz, A1), dot(vWPos.xz, B1));   // along, across
          float row = floor(pq.y / 0.30);
          float rh = hash12(vec2(row, 7.1));
          float per = rh < 0.17 ? 0.155 : (rh < 0.75 ? 0.42 : 0.62);
          float a = pq.x / per + hash12(vec2(row, 3.3)) * 7.0;
          float k0 = floor(a);
          float bk0 = k0 + 0.35 * (hash12(vec2(k0, row) + 1.7) - 0.5), bk1 = k0 + 1.0 + 0.35 * (hash12(vec2(k0 + 1.0, row) + 1.7) - 0.5);
          float ku = a < bk0 ? k0 - 1.0 : (a >= bk1 ? k0 + 1.0 : k0);
          float lo = ku + 0.35 * (hash12(vec2(ku, row) + 1.7) - 0.5), hi = ku + 1.0 + 0.35 * (hash12(vec2(ku + 1.0, row) + 1.7) - 0.5);
          vec2 pid = vec2(ku, row);
          float ph = hash12(pid + 3.7);
          float runs = vnoise(vec2(pq.x * 0.07, pq.y * 0.8) + 31.0);
          float speck = step(0.62 - 0.30 * smoothstep(0.55, 0.90, runs), ph);
          // ref 15 (full sun, 2-3 m): smooth (144,144,136), speckled (162,162,155); ref 14 (dawn): 15 % apart. Authored so
          // that the walk calibration (lb14Walk) lands them neutral, about 0.75 and 0.9 of a concrete flag: a light-grey
          // field, clearly lighter than the asphalt beside it by day and under the screens at night
          albedo = mix(vec3(0.335, 0.330, 0.303), vec3(0.405, 0.398, 0.368), speck);
          albedo *= (0.91 + 0.16 * hash12(pid + 9.1)) * (0.97 + 0.05 * n1);
          // joints 5-10 mm, swept with dark grit, darker than both finishes; a 4 mm chamfer each side. Box-filtered, so a
          // joint past resolution keeps its ink as a fine line down the axis instead of vanishing
          vec2 pxq = vec2(abs(dot(gPx.xz, A1)) + abs(dot(gPy.xz, A1)), abs(dot(gPx.xz, B1)) + abs(dot(gPy.xz, B1)));
          vec2 jm = vec2(min(a - lo, hi - a) * per, min(fract(pq.y / 0.30), 1.0 - fract(pq.y / 0.30)) * 0.30);
          vec2 hq = max(pxq * 0.5, vec2(0.0004));
          float jw0 = 0.0025 + 0.0020 * hash12(pid + 2.2);
          float jn = max(gpBand(jm.x, jw0, hq.x), gpBand(jm.y, jw0, hq.y));
          float chf = max(gpBand(jm.x, jw0 + 0.004, hq.x), gpBand(jm.y, jw0 + 0.004, hq.y));
          albedo *= 1.0 - jn * 0.62 - max(chf - jn, 0.0) * 0.18;
          {
            float fade = smoothstep(0.008, 0.002, gFw);
            vec2 sgn = vec2(a - lo < hi - a ? -1.0 : 1.0, fract(pq.y / 0.30) < 0.5 ? -1.0 : 1.0);
            vec2 sl = 0.55 * smoothstep(jw0 - 0.0005, jw0 + 0.0008, jm) * smoothstep(jw0 + 0.005, jw0 + 0.003, jm) * sgn * fade;
            GP_jn = sl.x * A1 + sl.y * B1;                           // world xz (the flags use gG; the surface pass knows)
          }
          // the walked lines along the axis a little lighter and smoother; each unit its own polish
          float trod = vnoise(vec2(pq.x * 0.05, pq.y * 0.35) + 7.0);
          albedo *= 0.96 + 0.08 * trod;
          GND_rough = mix(0.66, 0.52, trod) + 0.12 * hash12(pid + 5.3) + 0.08 * speck;
          GND_spec = 0.90;
          GP_layer = speck > 0.5 ? 3.0 : 4.0;                        // speckled: the exposed-aggregate scan; smooth: granite
          GP_off = vec2(hash12(pid + 1.3), hash12(pid + 7.9));
          // gum, dense on a plaza: dark grey blotches 2-6 cm (ref 13), their mean once past resolution
          {
            float gv = smoothstep(0.012, 0.004, gFw);
            vec2 gc = pq / 0.16; vec2 gi = floor(gc);
            float gh = hash12(gi + 51.7);
            if (gv > 0.01 && gh < 0.34) {
              vec2 gp = (fract(gc) - vec2(hash12(gi + 4.1), hash12(gi + 8.3)) * 0.6 - 0.2) * 0.16;
              float gr = 0.010 + 0.020 * fract(gh * 37.0);
              float gd = length(gp * vec2(1.0, 0.8 + 0.4 * fract(gh * 11.0))) / gr;
              float gum = smoothstep(1.0, 0.70, gd + 0.25 * (vnoise(gp * 180.0 + gh * 9.0) - 0.5)) * gv;
              albedo = mix(albedo, albedo * mix(0.30, 0.52, fract(gh * 5.0)), gum * 0.9);
              GND_rough = mix(GND_rough, 0.58, gum * 0.5);
            }
            albedo *= 1.0 - (1.0 - gv) * 0.045;
          }
          // the steel discs (Snohetta: "nickel-sized", 1.6-2.2 cm): straight lines and arcs of them at a 6 cm pitch that run
          // across unit boundaries, one 3.6 m cell in three; resolvable inside ~8 m only, faded out before they alias
          float jw = max(pxq.x, pxq.y) + 1e-4;
          float dk = 0.0;
          if (jw < 0.012) {
            vec2 dc = floor(pq / 3.6);
            float dh = hash12(dc + 13.1);
            if (dh < 0.34) {
              vec2 lp = pq - (dc + 0.5) * 3.6;                        // cell-centred
              float an = hash12(dc + 2.7) * 3.14159;
              vec2 dir = vec2(cos(an), sin(an)), nrm = vec2(-dir.y, dir.x);
              float s, t;
              if (dh < 0.17) { s = dot(lp, dir); t = dot(lp, nrm); }  // a line
              else {                                                 // an arc of radius 2-5 m
                float Rc = 2.0 + 3.0 * hash12(dc + 5.9);
                vec2 cc = nrm * Rc;
                vec2 dv = lp - cc;
                float rl = length(dv);
                t = rl - Rc; s = atan(dv.y, dv.x) * Rc;
              }
              float along = abs(s) < 1.4 ? 1.0 : 0.0;
              vec2 dp = vec2((fract(s / 0.06) - 0.5) * 0.06, t);
              float dd = length(dp);
              dk = (1.0 - smoothstep(0.0095 - jw * 0.7, 0.0095 + jw * 0.7, dd)) * along;
            }
            dk *= smoothstep(0.012, 0.005, jw);
          }
          albedo = mix(albedo, vec3(0.50, 0.51, 0.52), dk);
          GND_rough = mix(GND_rough, 0.16, dk);
          GND_spec = mix(GND_spec, 2.4, dk);
          GND_paint = dk;
`;
// GP31 surface pass: the scanned sets as the material. Every colour term is the texel over its set's linear mean and every
// AO term over its mean, so the mip chain converges to 1 and a surface holds its calibrated tone at any distance while
// the scan supplies all the detail inside it. The normal maps are OpenGL (+Y up the image); the arrays are not flipped,
// so texture rows run +gG.y and the map's Y is negated into the grid frame.
const GP31_SURF_GLSL = /* glsl */ `
          if (gpReady > 0.5 && fw < 6.0 && (m == 0 || m == 1 || m == 2 || m == 3 || m == 4 || m == 6 || m == 9 || m == 16 || m == 17 || (m == 7 && GND_rock < 0.5))) {
            gpDone = true;
            float far = smoothstep(6.0, 4.0, fw);                 // everything is ~1 by here: this only hides the gate
            float nW = smoothstep(2.2, 0.25, fw);                 // normal maps gone before their relief is sub-pixel noise
            vec2 tw = vec2(0.0);                                  // slope field, world xz
            if (m == 0 || m == 3 || m == 4 || m == 9) {
              int L = int(GP_layer + 0.5);
              vec2 pomG = vec2(dot(GP_pomXZ, MG_A), dot(GP_pomXZ, MG_B));   // the pothole march's visible point
              vec2 st0 = (gG + pomG) * 0.5, sgx = gGx * 0.5, sgy = gGy * 0.5;   // 2.0 m tiles
              vec3 tone = albedo;                                   // the block face's calibrated tone, before the scan
              // ---- the aggregate's relief. The eye ray is marched into the scan's height field (10 steps and a secant
              // refine on the dominant hex tap, all on one mip): the chips stand up to 6.5 mm (10 mm raveled) proud of
              // the binder, a chip's far side hides the binder behind it, and every texture read below takes the point the
              // ray actually meets. From that point a second march toward the sun finds the chips that shade it: long
              // crevice shadows at golden hour, almost none at a high noon sun. Inside ~6 m (a 1 cm footprint) only; past
              // that the chips are a few pixels and the normal map, the cavity term and the mean shadow carry them.
              float pomK = (m == 0 ? 1.0 : 0.0) * smoothstep(0.010, 0.0045, fw) * (1.0 - GP_potIn) * (1.0 - GP_seal);
              vec2 stV = st0;
              if (pomK > 0.02) {
                vec3 w; vec2 v1, v2, v3; gpTri(st0 * 0.60, w, v1, v2, v3);
                vec2 o = (w.x > w.y && w.x > w.z) ? gpH2(v1) : (w.y > w.z ? gpH2(v2) : gpH2(v3));
                vec3 Vd = normalize(vWPos - cameraPosition);
                vec2 dSt = vec2(dot(Vd.xz, MG_A), dot(Vd.xz, MG_B)) * 0.5 / max(-Vd.y, 0.08);   // st per metre of depth
                float D = (L == 1 ? 0.0030 : 0.0065) * (1.0 + 0.55 * GP_ravel) * pomK;
                const int NS = 10;
                vec2 du = dSt * D / float(NS);
                vec2 u = st0, uP = st0; float rd = 0.0, rP = 0.0;
                float sd = 1.0 - textureGrad(t_gpA, vec3(u + o, GP_layer), sgx, sgy).a, sP = sd;
                for (int k = 0; k < NS; k++) {
                  if (rd >= sd) break;
                  uP = u; rP = rd; sP = sd;
                  u += du; rd += 1.0 / float(NS);
                  sd = 1.0 - textureGrad(t_gpA, vec3(u + o, GP_layer), sgx, sgy).a;
                }
                float a0 = sP - rP, a1 = sd - rd;
                float tt = clamp(a0 / max(a0 - a1, 1e-4), 0.0, 1.0);
                stV = mix(uP, u, tt);
                float rHit = mix(rP, rd, tt);
                if (gpSun.y > 0.03) {
                  float sl = max(length(gpSun.xz), 1e-3), tanE = gpSun.y / sl;
                  vec2 sSt = vec2(dot(gpSun.xz, MG_A), dot(gpSun.xz, MG_B)) / sl * 0.5;   // st per metre, toward the sun
                  float span = min(rHit * D / tanE, 0.03);
                  float occ = 0.0;
                  for (int j = 1; j <= 5; j++) {
                    float t = span * float(j) * 0.2;
                    float rayR = rHit - t * tanE / max(D, 1e-4);
                    float sj = 1.0 - textureGrad(t_gpA, vec3(stV + o + sSt * t, GP_layer), sgx, sgy).a;
                    occ = max(occ, clamp((rayR - sj) * 7.0, 0.0, 1.0));
                  }
                  GP_shadow *= 1.0 - occ * 0.88 * pomK;
                }
              }
              vec4 A, N; gpHex(GP_layer, stV, 0.60, sgx, sgy, A, N);   // ~1 m hex cells
              vec3 ratio = mix(vec3(1.0), A.rgb / GP_MEAN[L], far);
              float ao = mix(1.0, N.a / GP_AO[L], far);
              float rr = N.b / GP_RGH[L];
              float hc = A.a - GP_HM[L];                           // height over the layer's mean: + chip tops, - binder
              float tnS = 1.0;
              if (m == 3 || m == 4) {
                // thermoplastic: exposed where a chip stands clear of the film. Only the chips: the height over its own
                // local mean (the same hex taps three mips down), or a 20 cm swell of the binder punches a hole through a
                // bar. A mip-averaged height is not a height distribution, so the threshold widens with the footprint.
                vec4 Ab, Nb; gpHex(GP_layer, st0, 0.60, gGx * 4.0, gGy * 4.0, Ab, Nb);
                float e = mix(0.04, 0.22, smoothstep(0.002, 0.05, fw));
                float t = 0.30 - GP_wear * 0.26;
                float expo = smoothstep(t - e, t + e, A.a - Ab.a) * step(0.01, GP_wear);
                // the road's own cracks run on through the film: an open one splits it and flakes it off either side
                expo = max(expo, GP_flake * 0.9);
                vec3 film = albedo * mix(vec3(1.0), ratio, 0.20) * mix(1.0, ao, 0.60);   // draped over the chips: dirt in the lows
                // the long edges wear back first (refs: 1-5 cm, ragged and scalloped, breaking into islands), and the film
                // cracks into blocks a fifth to a half of a bar across, 1-3 mm hairlines, the odd block lost
                if (vK.y > 100.5 && vK.z > 100.5) {
                  GP_pEdge = mod(vK.z - 1.0, 100.0) * 0.01 - abs((vK.y - 1.0) * 0.01 - 300.0);
                  float hE = max(gFw * 0.5, 0.0006);
                  float rag = 0.55 * vnoise(vWPos.xz * 16.0 + 3.0) + 0.30 * vnoise(vWPos.xz * 47.0 + 9.0) + 0.15 * vnoise(vWPos.xz * 130.0);
                  float ew = (0.008 + 0.045 * GP_wear) * (0.35 + 1.3 * rag);
                  float lost = clamp((ew - GP_pEdge) / (2.0 * hE) + 0.5, 0.0, 1.0);
                  // islands: past the ragged front, flakes that let go
                  lost = max(lost, step(0.72 - 0.25 * GP_wear, vnoise(vWPos.xz * 90.0 + 17.0)) * smoothstep(ew * 2.2, ew, GP_pEdge));
                  expo = max(expo, lost);
                  film *= 1.0 - 0.10 * smoothstep(0.18, 0.05, GP_pEdge);   // tyre grime along the edge
                }
                float blk = smoothstep(0.30, 0.60, GP_wear + 0.25 * (vnoise(vWPos.xz * 0.9 + 5.0) - 0.5));
                if (blk > 0.01 && gFw < 0.012) {
                  vec2 vp = (vWPos.xz + vec2(vnoise(vWPos.xz * 9.0), vnoise(vWPos.xz * 9.0 + 7.0)) * 0.03) / 0.11;
                  vec2 ci = floor(vp), cf = fract(vp);
                  float f1 = 9.0, f2 = 9.0; vec2 m1 = vec2(0.0), m2 = vec2(0.0), i1 = vec2(0.0);
                  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
                    vec2 o = vec2(float(i), float(j));
                    vec2 pt = o + gpH2(ci + o) * 0.8 + 0.1 - cf;
                    float dd2 = dot(pt, pt);
                    if (dd2 < f1) { f2 = f1; m2 = m1; f1 = dd2; m1 = pt; i1 = ci + o; } else if (dd2 < f2) { f2 = dd2; m2 = pt; }
                  }
                  float eb = dot(0.5 * (m1 + m2), normalize(m2 - m1)) * 0.11;
                  float crk = gpBand(eb, 0.0007 + 0.0006 * hash12(i1 + 3.1), max(gFw * 0.5, 0.0004)) * blk * smoothstep(0.012, 0.005, gFw);
                  film = mix(film, film * 0.35, crk);
                  expo = max(expo, step(hash12(i1 + 7.3), 0.10 * blk * GP_wear));    // a block let go
                }
                vec3 bareA = GP_asph * ratio * mix(1.0, ao, 0.65);
                albedo = mix(film, bareA, expo);
                albedo = mix(albedo, albedo * 0.30, GP_open);
                // a sealant crew's squeegee runs straight over the paint
                vec3 sc = GP_asph * 0.45 * mix(0.35, 0.80, smoothstep(0.25, 0.85, vnoise(gG * 0.9 + 5.0)));
                albedo = mix(albedo, sc, GP_seal);
                GND_paint = (1.0 - expo) * (1.0 - GP_seal) * (1.0 - GP_open);
                GND_rough = mix(GND_rough, 0.90 * mix(1.0, rr, 0.5), expo);
                // sealant over the film takes the road sealant's satin response: with the film's gloss it mirrored the sky
                GND_rough = mix(GND_rough, mix(0.78, 0.90, smoothstep(0.012, 0.06, gFw)), GP_seal);
                GND_spec = mix(mix(0.50, 1.0, GND_paint), 0.62, GP_seal);
                tnS = mix(0.40, 1.0, max(expo, GP_open));
              } else if (m == 9) {
                albedo *= mix(vec3(1.0), ratio * mix(1.0, ao, 0.6), mix(1.0, 0.45, GND_paint));
                tnS = mix(1.0, 0.5, GND_paint);
              } else {
                // the road surface's own layers do not reach into a pothole
                float outP = 1.0 - GP_potIn;
                GP_seal *= outP;
                // the thin edge of a squeegeed band: the chip tops stand through it (the band reads as poured over the road,
                // not laid on it as a strip)
                GP_seal *= 1.0 - GP_sealE * smoothstep(-0.02, 0.14, hc) * 0.9;
                float bare = 1.0 - GP_seal;
                float hp = A.a - 0.5;                                     // chip relief of the scan, -0.5 (lows) .. 0.5 (tops)
                GP_hp = hc;
                // raveling: the aggregate proud of the binder, its contrast up and the lows deeper
                ratio = mix(ratio, min(pow(max(ratio, vec3(0.0)), vec3(1.25)), vec3(2.2)), GP_ravel * far);
                ao = mix(ao, ao * ao, GP_ravel * far);
                // the 30 m aerial scan: tyre marks, stains and weathering at 0.1-10 m; half of it inside a newer cut
                float mcr = gpMacro(gG / 30.0, gGx / 30.0, gGy / 30.0);
                // (its 0.5-2 m spread is +-15-20 %: at full strength a roadway past ~10 m went blotchy, where the refs show
                // a uniform carriageway with bands of a few percent, so it fades to 0.38 with distance). It is the one
                // source of 5-50 cm tone on the road: measured cv at 12 / 25 / 50 cm, Asphalt031 0.030 / 0.012 / 0.008
                // (processed flat for tiling), the aerial scan 0.160 / 0.136 / 0.119, GM28's asphalt_02 0.084 / 0.061 /
                // 0.042. So it peaks where those scales resolve (2-15 m), and eases off at the lens, where its 1.5 cm texels
                // would blur over the chips
                float mcK = mix(0.38, mix(0.88, 0.55, smoothstep(0.008, 0.003, gFw)), smoothstep(0.06, 0.012, gFw));
                albedo *= mix(1.0, mcr, (mcK - 0.35 * GP_cut) * bare * far * outP * ${ASPHK});
                // the scan's contrast raised (linear about 1, so the mean holds), most where the chips resolve: measured on
                // the display at 1.5-3 m the first GP31 stills had p10/p90 0.80/1.21 of the mean where the photographs have
                // 0.77/1.34 (ref 01, 0.7 m) and 0.59/1.40 (ref 03, 2-4 m): light chips on a darker binder
                float nearC = smoothstep(0.02, 0.006, gFw);
                ratio = max(1.0 + (ratio - 1.0) * mix(1.0, mix(1.25, 1.60, nearC), far) * ${ASPHK}, vec3(0.12));
                albedo *= mix(vec3(1.0), ratio * mix(1.0, ao, 0.85), bare);
                // the cavity: a height-linear term, so it is mean-preserving and a minified road keeps its tone. Chip tops
                // a little lighter, the binder between them darker, most in a raveled surface
                albedo *= max(1.0 + hc * (mix(0.75, 1.15, nearC) + 0.35 * GP_ravel) * bare * far, 0.28);
                albedo *= 1.0 - GP_crack * 0.72 * bare * outP;
                // open cracks and alligator gaps: down to the dark, damp base course
                float gapK = max(GP_open, GP_allig) * bare * outP;
                ${GP32 ? `// GP32: a crack's floor 5-10 mm down a 1-11 mm gap sees little sky and no sun: dark, with the dust and grit
                // that settle in it (a warm grey in the open stretches); its broken lips are fresh binder with the aggregate
                // plucked out: darker, the chips' contrast up, matte (the walls lean in: gpCrackNet's slope)
                {
                  vec3 floorC = mix(albedo * vec3(0.20, 0.19, 0.18), tone * vec3(0.95, 0.88, 0.74) * 0.55, GP_cDust * 0.65);
                  albedo = mix(albedo, floorC, gapK);
                  float spK = GP_cSpall * bare * outP * (1.0 - gapK);
                  albedo = mix(albedo, albedo * clamp(ratio, vec3(0.25), vec3(2.2)) * 0.62, spK * 0.55);
                  GP_shadow *= 1.0 - 0.85 * gapK;
                }` : 'albedo = mix(albedo, albedo * vec3(0.26, 0.245, 0.23), gapK);'}
                // grit and road dust: drifted into the lows (height-blended: the chip tops tyres and feet reach stay
                // clean), a film everywhere and a drift against the kerb, pale and warm, and matte
                float lowH = smoothstep(0.08, -0.22, hc);
                float dustK = GP_dust * mix(0.35, 1.0, lowH) * (1.0 - 0.7 * GP_trk) * bare * outP;
                albedo = mix(albedo, tone * vec3(1.32, 1.24, 1.06), dustK * 0.42);
                GND_rough = min(1.0, GND_rough + dustK * 0.06);
                // the sealant: darker than the road (refs 02, 04: 10-25 % below it in the photographs' display values, a
                // fresh band blacker), no chips, no relief, a satin sheen. Its ALBEDO has to sit well under the road's: at a
                // grazing view the sheen adds sky, and at 0.35-0.80 of the road's tone the first stills drew it as a pale tube;
                // at 0.26-0.55 the batch-4 stills still put it at the road's own display tone, a flat grey strip. Trafficked
                // sealant is sanded: road grit pressed into it, the scan's grain at a fifth of its contrast
                float sDust = smoothstep(0.25, 0.85, vnoise(gG * 0.9 + 5.0));   // fresh (black, satin) .. dusty (grey, matte)
                vec3 sc = tone * mix(0.17, 0.40, sDust);
                sc *= mix(vec3(1.0), ratio, 0.20);
                albedo = mix(albedo, sc, GP_seal);
                // roughness by height: the chip tops tyres reach are polished and glint, the binder between stays matte
                GND_rough = clamp(GND_rough * mix(1.0, rr, 0.55 * far), 0.45, 1.0);
                GND_rough -= smoothstep(0.06, 0.26, hc) * (0.16 + 0.24 * GP_trk) * bare * far;
                GND_rough = mix(GND_rough, ${GP32 ? '0.95' : '0.70'}, gapK);${GP32 ? '   // GP32: a crack floor of dust and broken binder is rough' + String.fromCharCode(10) + '                GND_rough = mix(GND_rough, 0.97, GP_cSpall * bare * outP);' : ''}
                // its satin sheen is a near-field read: at a grazing 20-60 m a smooth band mirrors the sky as a white line
                // down the road, so it roughens with the footprint
                // the sheen goes with the age: in the batch-5 stills the whole band at a satin 0.72-0.84 reflected enough bright
                // sky at a 1.5 m eye to sit at the road's own display tone (the road's chips are in their own crevice shadow,
                // the smooth band is not), where the photographs put a band 10-25 % darker
                GND_rough = mix(GND_rough, mix(mix(0.74, 0.90, sDust), 0.92, smoothstep(0.012, 0.06, gFw)), GP_seal);
                GND_spec = mix(GND_spec, mix(mix(0.52, 0.34, sDust), 0.45, smoothstep(0.012, 0.06, gFw)), GP_seal);
                tnS = (1.0 - GP_seal * 0.85) * (1.0 + 0.45 * GP_ravel) * mix(1.0, 1.25, pomK);
                // silt and damp in the lows round a pothole (height-blended: the chip tops stay clean)
                float low = lowH;
                float mud = GP_rim * outP * mix(0.25, 1.0, low);
                albedo = mix(albedo, vec3(0.080, 0.066, 0.048), mud * 0.90 * bare);
                GND_rough = mix(GND_rough, mix(0.50, 0.22, low), mud * 0.7);   // silt-damp in the lows round a wet hole
                GND_spec = mix(GND_spec, 1.0, mud * low);
                // damp patches (a drained puddle, a hosed stoop, a leaking hydrant): the lows hold a water film and go dark
                // and glossy, the tops dry first; a few per block face, stronger the wetter the day
                float dmp = smoothstep(0.80, 0.90, vnoise(gG * 0.11 + 13.0)) * outP;
                dmp = max(dmp * mix(0.35, 1.0, low), 0.0);
                albedo *= 1.0 - 0.30 * dmp;
                GND_rough = mix(GND_rough, mix(0.30, 0.10, low), dmp);
                GND_spec = mix(GND_spec, 1.0, dmp);
                if (GP_potIn > 0.01) {
                  // inside the pothole: the broken wall is fresh-fractured binder (darker than the weathered top), the floor
                  // the base course, grey gravel and grit, with silt settled in its own lows
                  vec2 offG = vec2(dot(GP_pomXZ, MG_A), dot(GP_pomXZ, MG_B));
                  vec4 Bf, Nf; gpHex(3.0, (gG + offG) / 1.6, 0.60, gGx / 1.6, gGy / 1.6, Bf, Nf);
                  vec3 base = vec3(0.066, 0.061, 0.054) * (Bf.rgb / GP_MEAN[3]) * mix(1.0, Nf.a / GP_AO[3], 0.8);
                  base = mix(base, vec3(0.068, 0.055, 0.040), 0.55 * smoothstep(0.05, -0.20, Bf.a - 0.5));
                  vec3 wallC = albedo * vec3(0.44, 0.42, 0.40);   // fresh-broken binder, and the pit's own occlusion
                  albedo = mix(albedo, mix(wallC, base, GP_potF), GP_potIn);
                  GND_rough = mix(GND_rough, 0.88, GP_potIn);
                  GND_spec = mix(GND_spec, 0.75, GP_potIn);
                  if (GP_water > 0.001) {
                    // standing water at its fill level: murky with depth (the floor shows through a centimetre, silt-brown
                    // water swallows it by three), a mirror surface for the sky and the street
                    float murk = 1.0 - exp(-GP_wDepth / 0.011);
                    albedo = mix(albedo, mix(albedo * 0.55, vec3(0.120, 0.100, 0.074), murk), GP_water);   // silt-laden water scatters like thin mud
                    albedo *= 1.0 - 1.6 * GP_water * (1.0 - GP_water);                  // the wet silt at the meniscus
                    // the wall's tilt goes before the water's gloss comes in: a pixel half wall, half water with the wall's
                    // normal and the water's roughness mirrored the sky as a bright line round the pool
                    float wFlat = smoothstep(0.0, 0.3, GP_water), wGloss = GP_water * GP_water;
                    GND_rough = mix(GND_rough, 0.035, wGloss); GND_spec = mix(GND_spec, 0.5, wGloss);   // water: F0 0.02
                    tnS *= 1.0 - wFlat; GP_slopeW *= 1.0 - wFlat; GP_sealN *= 1.0 - wFlat;
                  }
                }
                // litter where the sweeper misses it, in the gutter and against the kerb: cigarette butts (2.5 x 0.8 cm,
                // a tan filter end), bottle caps, leaves and scraps of paper, one 13 cm cell in twenty at the kerb;
                // resolvable inside ~6 m only, and its mean past that is nothing
                if (GP_dust > 0.05 && gFw < 0.008 && outP > 0.5) {
                  vec2 lc = gG / 0.13; vec2 li = floor(lc);
                  float lh = hash12(li + 61.7);
                  if (lh < 0.05 * GP_dust) {
                    vec2 lp = (fract(lc) - 0.5) * 0.13 * 0.8;
                    float la = hash12(li + 3.1) * 6.2832;
                    vec2 lq = mat2(cos(la), -sin(la), sin(la), cos(la)) * lp;
                    float kind = hash12(li + 9.7), sh = 0.0; vec3 lcol = vec3(0.5);
                    float aw = max(gFw, 0.0008);
                    if (kind < 0.45) {
                      sh = smoothstep(0.0040 + aw, 0.0040 - aw, length(vec2(max(abs(lq.x) - 0.0085, 0.0), lq.y)));
                      lcol = lq.x > 0.004 ? vec3(0.36, 0.22, 0.10) : vec3(0.62, 0.60, 0.56);
                    } else if (kind < 0.62) {
                      sh = smoothstep(0.013 + aw, 0.013 - aw, length(lq));
                      lcol = vec3(0.18, 0.18, 0.19) * (0.6 + 0.9 * hash12(li + 5.5));
                    } else if (kind < 0.85) {
                      sh = smoothstep(1.0 + aw * 60.0, 1.0 - aw * 60.0, length(lq / vec2(0.022, 0.011)));
                      lcol = mix(vec3(0.12, 0.070, 0.030), vec3(0.20, 0.13, 0.04), hash12(li + 7.1));
                    } else {
                      sh = smoothstep(aw, -aw, max(abs(lq.x) - 0.018, abs(lq.y) - 0.012));
                      lcol = vec3(0.60, 0.59, 0.56);
                    }
                    albedo = mix(albedo, lcol, sh);
                    GND_rough = mix(GND_rough, 0.80, sh);
                    GP_shadow = mix(GP_shadow, 1.0, sh);
                  }
                }
                // past the relief march, the mean of the crevice shadow a low sun casts (golden hour, a winter noon)
                float lowSun = 1.0 - smoothstep(0.15, 0.60, gpSun.y);
                GP_shadow *= 1.0 - lowSun * 0.08 * (1.0 - pomK) * bare * (1.0 - GP_water);
              }
              vec2 tn = (N.xy * 2.0 - 1.0) * vec2(1.0, -1.0) * tnS;
              tw = tn.x * MG_A + tn.y * MG_B + GP_sealN.x * GP_qT + GP_sealN.y * GP_qN + GP_slopeW;   // + the sealant lip, macro slopes
            } else if (m == 1) {
              int L = int(GP_layer + 0.5);
              float sz = L == 3 ? 1.6 : 2.0;
              vec2 fq = gAx > 0.5 ? gG.yx : gG;                 // flag frame: x along the kerb, y across the walk
              vec2 fx = (gAx > 0.5 ? gGx.yx : gGx) / sz, fy = (gAx > 0.5 ? gGy.yx : gGy) / sz;
              vec4 A = textureGrad(t_gpA, vec3(fq / sz + GP_off, GP_layer), fx, fy);
              vec4 N = textureGrad(t_gpN, vec3(fq / sz + GP_off, GP_layer), fx, fy);
              float kw = L == 3 ? 0.70 : 1.0;                    // the worn set's pebbles are strong: a worn flag, not gravel
              albedo *= mix(vec3(1.0), (A.rgb / GP_MEAN[L]) * mix(1.0, N.a / GP_AO[L], 0.6), far * kw);
              GND_rough = clamp(GND_rough * mix(1.0, N.b / GP_RGH[L], 0.5 * far), 0.45, 1.0);
              vec2 tn = (N.xy * 2.0 - 1.0) * vec2(1.0, -1.0) * kw;
              vec2 tg = (gAx > 0.5 ? tn.yx : tn) + GP_jn;
              tw = tg.x * MG_A + tg.y * MG_B;
            } else if (m == 16) {
              vec2 A1 = vec2(0.2646, -0.9644), B1 = vec2(0.9644, 0.2646);
              int L = int(GP_layer + 0.5);
              float tsz = L == 3 ? 1.6 : 2.17;
              vec2 st = vec2(dot(vWPos.xz, A1), dot(vWPos.xz, B1)) / tsz + GP_off;
              vec2 fx = vec2(dot(gPx.xz, A1), dot(gPx.xz, B1)) / tsz, fy = vec2(dot(gPy.xz, A1), dot(gPy.xz, B1)) / tsz;
              vec4 A = textureGrad(t_gpA, vec3(st, GP_layer), fx, fy);
              vec4 N = textureGrad(t_gpN, vec3(st, GP_layer), fx, fy);
              float k = (L == 3 ? 0.95 : 0.45) * far * (1.0 - GND_paint);   // speckled units the exposed aggregate; not on the discs
              albedo *= mix(vec3(1.0), (A.rgb / GP_MEAN[L]) * mix(1.0, N.a / GP_AO[L], 0.5), k);
              GND_rough = clamp(GND_rough * mix(1.0, N.b / GP_RGH[L], 0.45 * k), 0.12, 1.0);
              vec2 tn = (N.xy * 2.0 - 1.0) * vec2(1.0, -1.0) * 0.8 * (1.0 - GND_paint);
              tw = tn.x * A1 + tn.y * B1 + GP_jn;                  // GP_jn is world xz here
            } else if (m == 2) {
              // the granite kerb face, in the (along-kerb, height) frame; a wall takes no ground-frame normal
              vec2 ct = normalize(vec2(-GND_wn.z, GND_wn.x) + 1e-5);
              vec2 st = vec2(dot(vWPos.xz, ct), vWPos.y) / 2.17;
              vec2 fx = vec2(dot(gPx.xz, ct), gPx.y) / 2.17, fy = vec2(dot(gPy.xz, ct), gPy.y) / 2.17;
              vec4 A = textureGrad(t_gpA, vec3(st, 4.0), fx, fy);
              vec4 N = textureGrad(t_gpN, vec3(st, 4.0), fx, fy);
              albedo *= mix(vec3(1.0), A.rgb / GP_MEAN[4], 0.8 * far);
              GND_rough = clamp(GND_rough * mix(1.0, N.b / GP_RGH[4], 0.4 * far), 0.45, 1.0);
            } else {
              // park path, Bryant Park gravel, the paved backlot. The gravel is the crushed-stone scan at full strength with
              // its stones' own relief: a height-linear cavity (mean-preserving) and the crevice shadow a low sun casts,
              // roughness by height (stone faces catch the light, the grit between is matte), damp ground holding its fines
              bool grv = m == 17 && gpGravelL > 4.5;
              float L = grv ? gpGravelL : 3.0, tsz = grv ? 2.0 : 1.6;
              int Li = int(L + 0.5);
              vec4 A, N; gpHex(L, gG / tsz, 0.60, gGx / tsz, gGy / tsz, A, N);
              float k = (m == 7 ? 0.45 : m == 6 ? 0.80 : grv ? 0.85 : 0.70) * far;
              albedo *= mix(vec3(1.0), (A.rgb / GP_MEAN[Li]) * mix(1.0, N.a / GP_AO[Li], grv ? 0.85 : 0.6), k);
              vec2 tn = (N.xy * 2.0 - 1.0) * vec2(1.0, -1.0) * k;
              if (grv) {
                float hcg = A.a - GP_HM[Li];
                albedo *= max(1.0 + hcg * 0.6 * k * (1.0 - 0.5 * GP_ravel), 0.3);
                GND_rough = clamp(GND_rough * mix(1.0, N.b / GP_RGH[Li], 0.5 * k) - smoothstep(0.05, 0.25, hcg) * 0.10 * k, 0.45, 1.0);
                float lowSun = 1.0 - smoothstep(0.15, 0.60, gpSun.y);
                GP_shadow *= 1.0 - lowSun * mix(0.10, 0.55 * smoothstep(0.02, -0.20, hcg), smoothstep(0.012, 0.004, gFw));
                tn *= 1.1 * (1.0 - 0.4 * GP_ravel) * (1.0 + 0.5 * GP_dust);
              }
              tw = tn.x * MG_A + tn.y * MG_B;
              if (m == 7) GND_rough = 0.88;
            }
            // the tilts add up (scan normal, pothole wall, chunk tilt, sealant lip, joint bevel): capped at 0.8 (53 deg), past
            // which a rim pixel's normal ran near-perpendicular to the view and Fresnel turned it into a sky mirror
            float twl = length(tw);
            tw *= min(1.0, 0.8 / max(twl, 1e-4));
            GND_tn = vec3(tw, sqrt(max(1.0 - dot(tw, tw), 0.09)));
            GND_tnW = nW * (1.0 - GND_wall);
          }
`;
// CP32L (city/cpLand.js): Central Park's ground-cover mask, filled by the park's land part once it has baked it. RGBA8
// over the park's box: R the woodland floor (OSM natural=wood), G the ballfields' clay infields, B the tennis centre's
// green clay, A the wet bank along every shore (1 at the water, 0 by 4 m); rect = x0, z0, 1/w, 1/h in world metres.
export const CP32L_GROUND = { mask: { value: null }, rect: { value: new THREE.Vector4(0, 0, 0, 0) }, on: { value: 0 } };
// TERRAIN FIX: the region's ground-cover mask round the lens (world/vegP1.js fills it: R class 1 lawn, 2 meadow, 3 woodland
// floor, 4 soil and trails, 5 rock, 6 paved, 7 water, 8 building): the drawn base (matId 7) takes litter, soil or schist from it
export const VEG_GROUND_U = { mask: { value: null }, rect: { value: new THREE.Vector4(0, 0, 0, 0) }, on: { value: 0 } };
export function makeGroundMaterial() {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0.0 });
  if (GP31) {
    const st = GP31_TEX.kerb = { meshes: 0, pending: 0, segs: 0, tris: 0, ms: 0, maxMs: 0 };
    if (typeof window !== 'undefined') window.__GP31 = GP31_TEX;
    mat.onBeforeRender = (r, s, c, geometry) => {
      if (geometry.userData.gpK || !geometry.attributes.matId || geometry.attributes.gpK) return;
      geometry.userData.gpK = true;
      gpKerbAsync(geometry, st);
    };
  }
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.playerXZ = FAR_UNIFORMS.playerXZ;
    sh.uniforms.nearR = FAR_UNIFORMS.nearR;
    sh.uniforms.nearMask = FAR_UNIFORMS.nearMask; sh.uniforms.nearMaskO = FAR_UNIFORMS.nearMaskO; sh.uniforms.nearMaskOn = FAR_UNIFORMS.nearMaskOn;   // NM24
    sh.uniforms.night = ENV.night;
    sh.uniforms.wet = ENV.wet;
    sh.uniforms.windT = ENV.windT;
    sh.uniforms.snowA = ENV.snow;
    sh.uniforms.gs35 = ENV.gs35;   // GS35
    for (const k of ['asC', 'asN', 'asR', 'asD', 'coC', 'coN', 'grC', 'grN', 'pvC', 'pvN']) sh.uniforms['t_' + k] = { value: GTEX[k] };
    sh.uniforms.cp32lMask = CP32L_GROUND.mask; sh.uniforms.cp32lRect = CP32L_GROUND.rect; sh.uniforms.cp32lOn = CP32L_GROUND.on;   // CP32L
    sh.uniforms.vgMask = VEG_GROUND_U.mask; sh.uniforms.vgRect = VEG_GROUND_U.rect; sh.uniforms.vgOn = VEG_GROUND_U.on;   // TERRAIN FIX
    if (CP32R_MASK) sh.uniforms.cpFarPhoto = { value: cpFarPhoto() };   // CP32R: the far park's ground (matId 8) from the aerial
    gtexRefPush(sh.uniforms); // async KTX2 arrivals refresh these (MEM41: weakly held)
    if (GP32) sh.uniforms.gpVN = { value: 1 };
    if (GP31) { sh.uniforms.t_gpA = GP31_TEX.alb; sh.uniforms.t_gpN = GP31_TEX.nrm; sh.uniforms.gpReady = GP31_TEX.ready; sh.uniforms.gpSun = ENV.sunDir; sh.uniforms.gpMacroL = GP31_TEX.macroL; sh.uniforms.gpGravelL = GP31_TEX.gravelL; }
    sh.uniforms.lb14StCal = ENV.lb14StCal;   // LB14
    sh.uniforms.lb14Walk = ENV.lb14Walk;     // LB14
    sh.uniforms.lb14Paint = ENV.lb14Paint;   // LB14
    sh.uniforms.lb14Road = ENV.lb14Road;     // LB14
    sh.defines = sh.defines || {};
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('gnddebug')) sh.defines.GNDDEBUG = 1;
    // ?gndcheap=1 compiles the road WITHOUT the procedural history layers
    // (wheel paths, utility cuts, crack sealant, castings). It exists so the
    // per-layer fps probe can price this shader's added ALU directly:
    //   node tools/bshot.mjs --views harlem125 --wait 80 --fps ground
    //   node tools/bshot.mjs --views harlem125 --wait 80 --fps ground --flags gndcheap=1
    if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('gndcheap')) sh.defines.GNDCHEAP = 1;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float matId; varying float vMat; varying vec3 vWPos;${GP31 ? '\n        attribute vec4 gpK; varying vec4 vK;   // GP31 kerb frame (gpKerbFrame)' : ''}`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vMat = matId;${GP31 ? '\n        vK = gpK;' : ''}
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`)
      // per-layer depth bias (docs/notes/zfight.md 6.1): paint / plates win over the asphalt and
      // the gutter / bus-lane strips over the cap fan by a fixed number of 24-bit depth LSBs,
      // independent of distance — the compiled datum offsets alone lose at 100-300 m in the aerials.
      // one LSB of window depth is 2/2^24 of NDC, so bias = LSBs / 8388608 (times w for clip space).
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          float zb = (matId == 3.0 || matId == 4.0 || matId == 13.0 || matId == 14.0) ? 10.0
                   : matId == 9.0 ? 8.0                       // green bike box under its white edge line (zfight.md)
                   : (matId == 11.0 || matId == 12.0) ? 4.0
                   // TL26: the two layers that lie UNDER the others by design lose every tie: the campus lawn underlay
                   // (15) under paths, brick and beds, the terrain grid (7) under everything
                   : matId == 15.0 ? -4.0 : matId == 7.0 ? -8.0
                   // ...and campus brick (10) yields its ties: the College Walk brick ribbons run under the grey walk
                   // and the lawn beds either side of it (the reference top view)
                   : matId == 10.0 ? -2.0 : 0.0;
          // CPZ34 (owner 2026-10-01: "z fighting heavily in aerial shots of central park"): the park's walks are drawn over
          // its lawn, not cut out of it, 8 mm above it after the relief (centralPark.js reliefApply), and one LSB at the
          // teaser's 280-470 m is 12-33 mm (tools/zfight.mjs t4Dive: sidewalk x grass ratio 0.4-0.75). Inside the park's
          // rectangle the lawn yields its ties like the campus underlay; the city's lawns keep their datum order.
          if (matId == 5.0) {
            vec2 cq = (modelMatrix * vec4(transformed, 1.0)).xz - vec2(447.2, 82.2);
            if (abs(dot(cq, vec2(0.4848, -0.8746))) < 2090.0 && abs(dot(cq, vec2(0.8746, 0.4848))) < 460.0) zb = -4.0;
          }
          gl_Position.z -= (zb / 8388608.0) * gl_Position.w;
        }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 playerXZ; uniform float nearR; uniform float night;${NEARMASK_GLSL}
        ${GP31 ? '// GP31: the six asphalt/concrete maps are replaced by the two t_gp arrays below' : `uniform sampler2D t_asC; uniform sampler2D t_asN; uniform sampler2D t_asR; uniform sampler2D t_asD;
        uniform sampler2D t_coC; uniform sampler2D t_coN;`}
        uniform sampler2D t_grC; uniform sampler2D t_grN;
        uniform sampler2D t_pvC; uniform sampler2D t_pvN;
        uniform sampler2D cp32lMask; uniform vec4 cp32lRect; uniform float cp32lOn;   // CP32L: Central Park's ground cover
        uniform sampler2D vgMask; uniform vec4 vgRect; uniform float vgOn;   // TERRAIN FIX: the region's ground cover (world/vegP1.js)
        ${CP32R_MASK ? 'uniform sampler2D cpFarPhoto;   // CP32R: the far park' : ''}
        uniform vec3 lb14StCal; uniform vec3 lb14Walk; uniform vec3 lb14Paint; uniform float lb14Road;   // LB14 (docs/notes/lb14.md)
        varying float vMat; varying vec3 vWPos;
        ${HASH_GLSL}
        ${TEX_GLSL}
        ${GND_GLSL}
        ${GP31 ? GP31_GLSL : ''}
        float GND_rough; float GND_patch; float GND_manhole; float GND_oil;
        float GND_paint;  // 1 = intact thermoplastic film (fills the aggregate)
        float GND_wall;   // 1 = near-vertical face (curb face, park rock cut)
        float GND_rock;   // 1 = schist outcrop (steep terrain/grass)
        int GND_vgC;      // TERRAIN FIX: the cover class under the base fragment (-1 none)
        float GND_spec;   // dielectric F0 scale (see the specular trim below)
        // three values the asphalt branch computes anyway, published so the
        // gutter (11) and the red bus lane (12) can key off them instead of
        // re-deriving their own fields (see the roadway-edge block below):
        float GND_age;    // block-face binder age, 0 fresh pave -> 1 ten summers
        float GND_wheel;  // 1 = inside a polished wheel track
        float GND_cast;   // 1 = manhole/basin casting or its patched collar
        vec3 GND_tn; float GND_tnW; vec3 GND_wn;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        int m = int(vMat + 0.5);
        int mRaw = m;                       // 11 gutter / 12 red bus lane are asphalt variants${GP32 ? String.fromCharCode(10) + '        bool gpGhost = mRaw == 11 && vK.y > 65000.0 && vK.x < 0.5;   // GP32: a corner-return gutter lying out in the junction (gpKerbWorker gp32Ties)' : ''}
        if (m == 11 || m == 12) m = 0;
        if (m == 15) m = 5;                 // TL26: the campus lawn underlay is lawn (its own id only for the depth order)
        GND_patch = 0.0; GND_manhole = 0.0; GND_oil = 0.0; GND_tn = vec3(0.0, 0.0, 1.0); GND_tnW = 0.0;
        GND_paint = 0.0; GND_rock = 0.0; GND_spec = 1.0; GND_vgC = -1;
        GND_age = 0.5; GND_wheel = 0.0; GND_cast = 0.0;
        if (m == 8 && farHidden(vWPos.xz)) discard;   // NM24: far terrain only where no ready near tile is
        // TERRAIN FIX: the far skirt's coarse cells span the shore, so their slope crosses the water plane a few metres off
        // the near tiles' bulkheads and stood in the river as pale specks: the skirt is never drawn within 1.2 m of the water
        if (m == 8 && vWPos.y < 1.2) discard;
        GND_rough = 0.95;
        vec3 albedo;
        float n1 = vnoise(vWPos.xz * 0.35); // macro variation (~9m) only
        // fine grain comes EXCLUSIVELY from the mip-filtered PBR textures now —
        // procedural per-pixel noise reads as salt-and-pepper at any distance
        float n2 = 0.5;
        // geometric world normal (vNormal is VIEW space): the curb face, park
        // rock cuts and river banks are all vertical strips of the same merged
        // ground mesh, and everything below keys off this instead of guessing.
        GND_wn = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        // (TERRAIN INT2: natural ground (the lawns, the region's base) takes its smoothed vertex normal (world/assemble.js
        // smoothNatural): the slope-keyed layers (litter, schist, bank) no longer change facet by facet)
        if (m == 5 || m == 7 || m == 6) { vec3 sn = normalize((vec4(normalize(vNormal), 0.0) * viewMatrix).xyz); if (dot(sn, GND_wn) < 0.0) sn = -sn; if (abs(dot(sn, GND_wn)) > 0.2) GND_wn = sn; }
        GND_wall = smoothstep(0.62, 0.30, abs(GND_wn.y));   // 52deg -> 73deg
        // world-XZ pixel footprint: the one AA/LOD gate the whole shader shares
        float gFw = max(fwidth(vWPos.x), fwidth(vWPos.z));
        float gNear = smoothstep(0.30, 0.06, gFw);   // fine detail visibility
        float gMid  = smoothstep(1.10, 0.22, gFw);   // coarse detail visibility
        // grid-frame coordinates (metres along the street / along the avenue)
        vec2 gG = vec2(dot(vWPos.xz, MG_A), dot(vWPos.xz, MG_B));
        ${GP31 ? `// GP31: screen gradients taken here, in uniform control flow, for every textureGrad in the branches below
        vec2 gGx = dFdx(gG), gGy = dFdy(gG);
        vec3 gPx = dFdx(vWPos), gPy = dFdy(vWPos);
        // the street's bearing, the ~130 m block mask gstreak and U10 share: 1 = the street runs along gG.y
        float gAx = step(0.5, smoothstep(0.38, 0.62, vnoise(gG * 0.0075 + 41.0)));
        GP_layer = 0.0; GP_seal = 0.0; GP_sealE = 0.0; GP_sealN = vec2(0.0); GP_off = vec2(0.0); GP_jn = vec2(0.0);
        GP_wear = 0.0; GP_asph = vec3(0.2); GP_crack = 0.0; GP_cut = 0.0; GP_dust = 0.0;
        GP_potD = 0.0; GP_potIn = 0.0; GP_potF = 0.0; GP_water = 0.0; GP_wDepth = 0.0; GP_rim = 0.0; GP_pomXZ = vec2(0.0);
        GP_slopeW = vec2(0.0); GP_shadow = 1.0; GP_ravel = 0.0; GP_allig = 0.0; GP_open = 0.0; GP_bleach = 0.0; GP_trk = 0.0; GP_hp = 0.0; GP_flake = 0.0; GP_pEdge = 1.0; GP_castPat = 0.5; GP_castSlot = 0.0;${GP32 ? ' GP_cSpall = 0.0; GP_cDust = 0.0;' : ''}
        // the kerb frame (world/gpKerbWorker.js): kQ = metres across the street from its canonical kerb (continuous over
        // the centreline), kDn = metres to the nearest kerb, kW = the street width (0 = no facing kerb found), kn = the
        // canonical kerb's normal into the street. A street within 4 deg of the commissioners' grid takes the grid axis
        // itself, so its along-street coordinate is gG and continuous across every triangle; off the grid the along
        // coordinate is the position projected on the kerb's own bearing.
        // a mesh the worker has not answered for yet has no gpK: the attribute then reads the generic vertex value, which
        // another program may have left at (1,1,1,1) (ShaderMaterial's default colour). Real values are never that small.
        bool kOk = vK.x > 100.5 && vK.w > 0.5;
        float kQ = (vK.x - 1.0) * 0.01 - 320.0, kDn = max(vK.y - 1.0, 0.0) * 0.01, kW = max(vK.z - 1.0, 0.0) * 0.01;
        bool kOk2 = kOk && vK.z > 100.5;
        float kA = (vK.w - 1.0) / 65534.0 * 3.14159265 - 1.57079633;
        vec2 kn = vec2(cos(kA), sin(kA));
        vec2 kt = vec2(-kn.y, kn.x);                                   // along the street
        float kqx = dot(vWPos.xz, kt);
        if (kOk) {
          float ca = dot(kt, MG_A), cb = dot(kt, MG_B);
          if (abs(ca) > 0.99756) { kt = MG_A * sign(ca); kqx = gG.x * sign(ca); }
          else if (abs(cb) > 0.99756) { kt = MG_B * sign(cb); kqx = gG.y * sign(cb); }
          kn = vec2(kt.y, -kt.x) * sign(dot(vec2(kt.y, -kt.x), kn));
          gAx = step(abs(dot(kt, MG_A)), abs(dot(kt, MG_B)));
        }
        GP_qT = kOk ? kt : (gAx > 0.5 ? MG_B : MG_A);                  // world directions of the street frame's axes
        GP_qN = kOk ? kn : (gAx > 0.5 ? MG_A : MG_B);${GP32 ? GP32_NETCALL : ''}` : ''}
        if (m == 0) {${GP31 ? GP31_ASPH_GLSL : `
          // ---- NYC asphalt. A street here is never one pour: it is a stack of
          // mill-and-pave lots, DEP/Con Ed utility trenches cut and backfilled
          // years apart, crack sealant, and wheel paths polished lighter with
          // an oil-black strip down the middle of every lane. Everything is
          // laid out in the grid frame (gG) so it runs WITH the roadway.
          //
          // 1. mill-and-pave lots: ~55 x 40 m resurfacing jobs, each its own age
          // NYC repaves a BLOCK FACE at a time, so the age unit is the block
          // (~78 m of roadway x its width), not a 57 x 41 m rectangle, and the
          // joint between two pours wanders — a paver follows the crown, not a
          // ruler. Measured off the Street View set (sunlit, docs/notes/streets-audit.md):
          //   fresh binder  Amsterdam Ave @ 116  sRGB (82, 94,110)  DARK and BLUE
          //   ten summers   W 122nd St           sRGB (180,173,161) LIGHT and WARM
          // The old range (0.070 -> 0.158, always warm) could reach neither end:
          // every street rendered as the same mid blue-grey sheet.
          // warp in LOT units: 0.30 was +/-23 m along / +/-7.8 m across, which drew the
          // "long smooth wide-radius arcs" that read as wear (review R3 #2); a
          // paver's joint wanders by decimetres, not by a lane
          // GT13 (docs/notes/ground-r13.md): the 26 m ACROSS pitch is the bug. gG's two
          // axes are the commissioners' grid, so a street that runs on the short axis got
          // a fresh pour every 26 m up its length and a cold joint down the centre of its
          // own carriageway — which is the rectangular tiling the r13 critic read off
          // Amsterdam at 1:3 (shots/critic-r13/z_t_road.png). A mill-and-pave lot is a
          // BLOCK FACE: ~80 m of roadway by its full width, and it has to be that at
          // EITHER orientation, so the cell is near-square. The warp goes up with it
          // (a paver's joint wanders by metres over 80 m, not by 0.8 m over 26).
          vec2 lotQ = gG / ${GT13 ? 'vec2(82.0, 76.0) + vec2(fbm(gG * 0.013 + 4.0), fbm(gG * 0.015 + 21.0)) * vec2(0.075, 0.075)'
                                  : 'vec2(78.0, 26.0) + vec2(fbm(gG * 0.013 + 4.0), fbm(gG * 0.015 + 21.0)) * vec2(0.055, 0.030)'};
          vec2 lotId = floor(lotQ);
          // GT13: one hash12 draw spanned the WHOLE mix (0.0649 -> 0.2050) block face to
          // block face, so the asphalt tone was a lottery two-and-a-bit stops wide and the
          // city had no single asphalt — the critic's fix 1 in one line ("one stretch of
          // road in the whole city has the right asphalt"). AVERAGING FOUR decorrelated
          // draws of the same lot halves the standard deviation and leaves the MEAN
          // EXACTLY where it was — which matters, because the mean is already on the
          // reference crop (ground-r13.md: our sunlit carriageway 143 / walk 190 against the
          // reference's 136 / 182) and must not move. It also turns a flat uniform draw into
          // a bell, so most block faces sit near the city's asphalt and the odd one is
          // a fresh or a bleached pour, which is what a block face actually is.
          ${GT13 ? `float lotH = (hash12(lotId + 3.3) + hash12(lotId + 11.7)
                              + hash12(lotId + 27.1) + hash12(lotId + 41.9)) * 0.25;`
                 : `float lotH = hash12(lotId + 3.3);`}
          float lotAge = clamp(lotH * 0.86 + n1 * 0.28, 0.0, 1.0);
          // ROUND 3: the bleached end was (0.2840, 0.2440, 0.1560), linear R/B
          // 1.82. Every sunlit asphalt patch in the panorama table above has a
          // linear R/B of 1.08-1.27, and the 125th St lane in the FOV-matched
          // reference is nearly neutral (sRGB R-B = 2-8). With stCal's own 1.32
          // R/B boost on top, the roadway rendered at R-B = 27 — above every
          // entry in that table and 1.7x the 16 the round-2 pass was aiming at.
          // B up 22 %, R down 5 %: R/B 1.42 at the aged end, 1.21 at mid-age,
          // luma unchanged, and rendered R still leads B by ~35 % so the round-2
          // "never blue slate again" property is untouched.
          albedo = mix(vec3(0.0649, 0.0781, 0.0868), vec3(0.2050, 0.2120, 0.2220), lotAge);   // AM120 (critic 2026-09-15): the aged end was a warm tan and a sunlit avenue read 55 % too bright; worn NYC asphalt bleaches to a COOL mid-grey
          GND_age = lotAge;                 // the gutter's grime tracks the block face
          // asphalt is one of the roughest surfaces in a city: a low value here
          // lets the grazing sky specular sheet the road over as a wet look
          GND_rough = 0.92 + lotAge * 0.05;
          GND_spec = ${GM28 ? '0.62' : '0.50'};
          // lot seam: the cold joint where a new pass met the old surface
          {
            vec2 lf = abs(fract(lotQ) - 0.5);
            // GT13: the seam's AA width has to be in the SAME cell units as lotQ, or the
            // joint is filtered at the wrong scale (with the new near-square lot it would
            // have been 2.9x too wide across and drawn a soft band instead of a joint).
            vec2 lw = fwidth(gG) / ${GT13 ? 'vec2(82.0, 76.0)' : 'vec2(78.0, 26.0)'} * 1.5 + 0.0016;
            float seam = max(smoothstep(0.5 - lw.x, 0.5 - lw.x * 0.25, lf.x), smoothstep(0.5 - lw.y, 0.5 - lw.y * 0.25, lf.y));
            albedo *= 1.0 - seam * 0.12 * gMid;   // measured 138 -> 108 across the seam at 0.3; a cold joint is a tone change, not a trench
          }
          // 1b. skin patches: the mosaic of 3-10 m repairs with SINUOUS edges
          // that a Williamsburg or Harlem block actually is (Bedford & N 7th:
          // five distinct tones inside one block face). A domain-warped blob
          // field, so no edge is straight and nothing reads as a rectangle.
          {
            vec2 pw = gG + vec2(fbm(gG * 0.19 + 31.0), fbm(gG * 0.21 + 47.0)) * 3.4;
            float pf = fbm(pw * 0.135 + 9.7);
            float skin = smoothstep(0.44, 0.58, pf) - smoothstep(0.70, 0.84, pf);
            // GT13: this is the APERIODIC half of the road's variety and it was the
            // weaker of the two — the lot lattice carried more spread than the patch
            // mosaic, which is exactly backwards for a NYC block face. The lattice
            // gave up 40 % of its range above, so the patches take it: amplitude up
            // 0.34 -> 0.46, and zero-meaned (the old draw averaged +4 %, a bias that
            // lifted every road by a fifth of a stop for no reason).
            // LB14 (docs/notes/lb14.md): the r14 critic's "the brightest, flattest, emptiest place in
            // the set" — the sunlit carriageway in wbBedfordN7_day measures a p5-p95 span of **14**
            // over 500 x 180 px. The LEVEL is right (L 143 is inside the Street View sunlit band
            // 136-188, streets-audit.md; the critic compared it against a SHADED pano value), the
            // VARIETY is not: a block face draws one lotAge, so inside one block the only aperiodic
            // term is this mosaic. Its draw is zero-meaned by GT13, so scaling it widens the span
            // without moving the mean the reference crop is already calibrated on. lb14Road is 0 outside
            // the day preset, and mix/multiply by 1.0 is exact, so golden/dusk/night are identical.
            albedo *= 1.0 + skin * (${GT13 ? '0.46 * hash12(floor(pw * 0.135) + 5.0) - 0.23'
                                           : '0.34 * hash12(floor(pw * 0.135) + 5.0) - 0.13'}) * gMid * (1.0 + lb14Road);
          }
          // 2. broad traffic soot / shade darkening (unchanged in spirit)
          albedo *= 1.0 - smoothstep(0.55, 0.95, fbm(vWPos.xz * 0.035 + 9.1)) * 0.18;
          // 3. wheel paths: two polished, lighter ribbons per lane with the
          // oil-black strip between them. Anisotropic along the road axis.
          #ifndef GNDCHEAP
          {
            float wp = gstreak(gG, 0.02, 0.62, 7.1);
            GND_wheel = smoothstep(0.60, 0.86, wp);   // the bus lane scrubs on the same tracks
            albedo *= 1.0 + GND_wheel * 0.30 * gMid;                        // polished, lighter
            float oil = gstreak(gG, 0.035, 0.55, 3.7);
            GND_oil = smoothstep(0.72, 0.93, oil) * 0.55;                    // drip line
          }
          #endif
          // 4. utility cuts: saw-cut rectangles backfilled with a different mix.
          // Two scales — a long trench along the roadway (gas/water main) and
          // small square service cuts — each with a dark saw-cut outline.
          #ifndef GNDCHEAP
          {
            vec2 cs = vec2(13.0, 8.0);
            vec2 cc = floor(gG / cs), cf = fract(gG / cs);
            float cr = hash12(cc + 17.9);
            if (cr < 0.26) {
              // the long axis follows the road on half the cuts. Sizes are 1-3 m
              // now (Street Works Manual restorations are service-lateral wide,
              // not lane wide): the old 0.30-0.64 cell fractions drew 4-7 m
              // slabs that read from the air as holes in the roadway.
              vec2 p0 = vec2(hash12(cc + 3.1), hash12(cc + 5.7)) * 0.52 + 0.08;
              vec2 sz = vec2(cr < 0.13 ? 0.075 + hash12(cc + 9.3) * 0.085 : 0.135 + hash12(cc + 9.3) * 0.150,
                             cr < 0.13 ? 0.175 + hash12(cc + 11.1) * 0.200 : 0.080 + hash12(cc + 11.1) * 0.090);
              vec2 aa = fwidth(gG) / cs * 0.9 + 0.0016;
              float inner = grect(cf, p0, p0 + sz, aa);
              float outer = grect(cf, p0 - aa * 2.4 - 0.006, p0 + sz + aa * 2.4 + 0.006, aa);
              // Backfill tone. A NYC cold patch is DARKER than the road, never
              // black: in the refs a fresh restoration reads sRGB ~95-115 in sun
              // against a 150 road. The old 0.036 fill rendered as a black
              // rectangle, which is the single most obvious "processed wrong"
              // artefact in the top-down. It also fades with gMid so a minified
              // roadway never gets punched full of dark squares.
              vec3 fill = mix(vec3(0.0827, 0.0807, 0.0760), vec3(0.2293, 0.2080, 0.1573), hash12(cc + 23.0));
              albedo = mix(albedo, fill, inner * 0.70 * mix(0.45, 1.0, gMid));
              albedo *= 1.0 - (outer - inner) * 0.34 * gMid;                 // saw-cut kerf
              GND_patch = inner;                                             // roughness/relief only
            }
          }
          #endif
          // 5. crack sealant: the black tar snakes NYC pours over every seam —
          // shiny, ~6 cm, wandering, and the single most recognisable NYC road
          // detail. Ridged noise at two scales, mip-faded.
          #ifndef GNDCHEAP
          {
            float aged = smoothstep(0.52, 0.88, fbm(vWPos.xz * 0.021 + 5.3));
            if (aged > 0.01 && gNear > 0.01) {
              // DOMAIN WARP. Straight ridged noise on a lattice reads as a
              // repeating diagonal weave from above — a dead giveaway. Pushing
              // the lookup around with a low-frequency field breaks the period
              // and gives the wandering, branching run a sealed crack has.
              //
              // ROUND 3: the warp amplitude is down 9.0 -> 4.6 m and the ridge
              // band 0.925 -> 0.962. A 9 m warp on a 3.9 m lattice is locally
              // COMPRESSIVE, and where it compresses it inflated the 6 cm band
              // into 0.4-0.8 m strokes. From a 2.5 m eye looking ALONG the
              // roadway that is fatal: gFw is isotropic, so a grazing fragment
              // keeps gNear = 1 while perspective stretches each stroke over
              // hundreds of pixels, and W 125th rendered as black smoke snakes
              // across the whole near field (shots/audit/R3bus125_day.png, before
              // this change). The same street in refs/streetview (2023-08) carries
              // a handful of faint sealed cracks and nothing else. The fill is
              // also lifted 0.030 -> 0.052 and capped 0.90 -> 0.60: weathered
              // sealant is a dark grey line on a 150-luma road, not a hole in it.
              vec2 wq = vWPos.xz + vec2(fbm(vWPos.xz * 0.055 + 3.0), fbm(vWPos.xz * 0.055 + 17.0)) * 4.6;
              float web = gridge(wq * 0.26 + 8.8);
              float sealer = smoothstep(0.962, 0.999, web) * aged * gNear;
              float hair = smoothstep(0.975, 1.0, gridge(wq * 0.95 + 21.0)) * aged * gNear;
              albedo = mix(albedo, vec3(0.052, 0.049, 0.047), clamp(sealer * 0.85 + hair * 0.40, 0.0, 0.60));
              GND_rough = mix(GND_rough, 0.62, sealer * 0.7);                // tar stays glossy
            }
          }
          #endif
          // 6. castings: manhole, valve box and the asphalt collar patched
          // around them. Rim + cover, AA'd on the radial derivative.
          #ifndef GNDCHEAP
          {
            vec2 mc = floor(vWPos.xz / 15.0);
            float mr = hash12(mc);
            if (mr < 0.42) {
              vec2 mo = vec2(hash12(mc + 1.7), hash12(mc + 2.9)) * 0.7 + 0.15;
              float md = length((fract(vWPos.xz / 15.0) - mo) * 15.0);
              float R = mr < 0.28 ? 0.36 : 0.16;                             // manhole / valve box
              float ae = max(fwidth(md), 0.004);
              // patched ring: half the castings sit in a lighter concrete
              // collar (grates, DEP basins), half in a darker asphalt re-set
              float collar = 1.0 - smoothstep(R + 0.34, R + 0.62, md);
              albedo *= 1.0 + collar * mix(-0.16, 0.22, step(0.5, hash12(mc + 41.0))) * gMid;
              float rim = smoothstep(R + 0.09 + ae, R + 0.09 - ae, md);
              float cover = smoothstep(R + ae, R - ae, md);
              GND_manhole = max(cover, rim * 0.45);
              // a paint crew skirts a casting: the red bus lane stops at the
              // collar and the lid and its ring stay unpainted grey (visible on
              // every casting inside the 125th St lane, refs 2023-08).
              GND_cast = max(GND_manhole, collar * 0.85);
            }
          }
          #endif
          ${GM28 ? `#ifndef GNDCHEAP
          // GM28: rubber skid pairs, two dark tyre streaks 1.6 m apart, 4-14 m long, drifting a little across the lane,
          // where a car braked hard: black-brown rubber over the aggregate, a touch glossier. About 1 in 6 cells of
          // 26 x 9 m, on the street's own bearing (the block mask gstreak picks it with).
          {
            vec2 q = smoothstep(0.38, 0.62, vnoise(gG * 0.0075 + 41.0)) > 0.5 ? gG.yx : gG;   // q.x along the street
            vec2 sc = floor(q / vec2(26.0, 9.0)), sf = q - sc * vec2(26.0, 9.0);
            float aaY = fwidth(q.y) + 1e-3;                                   // outside the branch: derivatives need all 4 pixels
            float sh = hash12(sc + 71.3);
            if (sh < 0.17 && gMid > 0.02) {
              float L = 4.0 + 10.0 * hash12(sc + 3.7), x0 = hash12(sc + 9.1) * (26.0 - L);
              float t = clamp((sf.x - x0) / L, 0.0, 1.0);
              float inL = smoothstep(0.0, 0.06, t) * smoothstep(1.0, 0.65, t) * step(x0, sf.x) * step(sf.x, x0 + L);
              float y0 = 1.6 + hash12(sc + 13.3) * 5.0 + (hash12(sc + 5.5) - 0.5) * 1.4 * t * t;
              float w = 0.10 + 0.05 * hash12(sc + 17.7);
              float tyre = max(smoothstep(w + aaY, w - aaY, abs(sf.y - y0)), smoothstep(w + aaY, w - aaY, abs(sf.y - y0 - 1.6)));
              float skid = tyre * inL * (0.55 + 0.45 * vnoise(q * vec2(0.9, 4.0) + 7.0)) * gMid;
              albedo = mix(albedo, albedo * vec3(0.40, 0.38, 0.37), skid * 0.78);
              GND_rough = mix(GND_rough, 0.72, skid * 0.6);
            }
          }
          // GM28: oil and damp blotches (0.4-2 m, soft, aperiodic): parked and idling cars, a dried puddle's darker
          // bed; a little glossier than the binder around them
          {
            float ob = fbm(vWPos.xz * 0.55 + 13.0) * 0.65 + vnoise(vWPos.xz * 1.9 + 5.0) * 0.35;
            float blot = smoothstep(0.70, 0.84, ob) * gMid;
            albedo *= 1.0 - blot * 0.30;
            GND_rough = mix(GND_rough, 0.68, blot * 0.45);
          }
          #endif` : ''}`}
        } else if (m == 1) {${GP31 ? GP31_WALK_GLSL : `
          // ---- NYC sidewalk: 5 ft (1.524 m) concrete flags on a 4-flag,
          // 20 ft expansion-joint panel (DOT Street Works Manual 4.4). The
          // flags are laid to the STREET grid, not to world XZ, and each is a
          // separate pour: its own age, its own warm/cool cast. Concrete here
          // is a warm mid grey, never white. Measured off the refs (sunlit):
          // Amsterdam & 116 (229,214,192), Bedford & N 7 (198,188,176) — light,
          // and always R > G > B by a wide margin. The old value was both too
          // dark AND rendered COOL (the render read B > R), which is most of
          // why the ground looked "processed wrong": NYC concrete is sandy warm
          // grey, never the blue-slate the sky-dominated ambient turns it into.
          albedo = mix(vec3(0.496, 0.437, 0.261), vec3(0.571, 0.501, 0.299), n1);
          vec2 sco = gG / 1.524;
          vec2 sid = floor(sco);
          float slab = hash12(sid);
          vec2 j = min(fract(sco), 1.0 - fract(sco));
          vec2 jAA = fwidth(sco) * 1.2 + 1e-4;
          // A NYC walk is scored ACROSS its width: the strong, continuous joints
          // run curb-to-building line every 5 ft and the joints parallel to the
          // curb are secondary (often only one or two down a 4.5 m walk). An
          // equal-weight checker is the tell of a tiled floor, so the two axes
          // are weighted per block by the same ~130 m mask gstreak uses to pick
          // the street bearing.
          float swAx = smoothstep(0.38, 0.62, vnoise(gG * 0.0075 + 41.0));
          vec2 jW = vec2(mix(1.0, 0.42, swAx), mix(0.42, 1.0, swAx));
          // tooled joint: a hand-run groove with a LIGHTER trowelled bevel each
          // side. The bevel is the tell that reads "sidewalk" and not "tiles".
          float joint = max((1.0 - smoothstep(0.0, jAA.x * 1.7 + ${GM28 ? '0.014' : '0.008'}, j.x)) * jW.x,
                            (1.0 - smoothstep(0.0, jAA.y * 1.7 + ${GM28 ? '0.014' : '0.008'}, j.y)) * jW.y);
          float bevel = max(smoothstep(jAA.x * 1.4 + 0.028, jAA.x + 0.011, j.x) * jW.x,
                            smoothstep(jAA.y * 1.4 + 0.028, jAA.y + 0.011, j.y) * jW.y) - joint;
          albedo *= 1.0 - joint * ${GM28 ? '0.46' : '0.24'};
          albedo *= 1.0 + max(bevel, 0.0) * 0.12 * gNear;
          // expansion joints every 4th flag (20 ft): a wider, darker bitumen
          // recess — the long rhythm a plain 1.5 m checker lacks. It is a THIN
          // dark line in the refs, not a black band, so the fill is a warm
          // bitumen grey and the coverage is down from 0.62.
          vec2 e4 = min(fract(sco / 4.0), 1.0 - fract(sco / 4.0)) * 4.0;
          float ej = max((1.0 - smoothstep(0.0, jAA.x * 1.4 + 0.030, e4.x)) * jW.x,
                         (1.0 - smoothstep(0.0, jAA.y * 1.4 + 0.030, e4.y)) * jW.y);
          albedo = mix(albedo, vec3(0.115, 0.104, 0.083), ej * 0.46);
          // per-flag pour: age value + warm/cool cement cast. HALVED — at
          // +-8 % value and +-4 % hue the top-down read as a random light/dark
          // checkerboard, where a real walk is nearly uniform with the odd
          // obviously-new flag (kept below as the 7 % replacement case).
          albedo *= ${GM28 ? '0.925 + 0.13 * slab' : '0.952 + 0.078 * slab'};
          albedo *= mix(vec3(1.016, 0.998, 0.972), vec3(0.978, 0.992, 1.018), hash12(sid + 11.7));
          GND_rough = 0.86 + 0.08 * slab; GND_spec = 0.72;
          // replacements: ~7% fresh flags (lighter, smoother, sharper joints),
          // ~4% cold-patch asphalt repairs, ~5% bluestone (historic districts —
          // Harlem/Brooklyn brownstone blocks still carry the blue-grey slabs)
          float srep = hash12(sid + 7.3);
          // Bluestone and asphalt-patch flags were scattered at 5 % and 4 % of
          // EVERY block, and at less than half the concrete's value they read
          // from above as dark holes punched at random in the walk (the lead
          // logged this off the flat set: "some sidewalk flags render as dark
          // bluestone squares"). Both are real, but neither is random: bluestone
          // survives in RUNS on the brownstone blocks (W 122nd, Strivers' Row,
          // Bedford) and nowhere else, and it is a blue-GREY slab, not a black
          // one. So bluestone is gated on a ~126 m block mask and, ON those
          // blocks, takes nearly the WHOLE walk: a 35 % mix rendered as a
          // 128-vs-208 chequerboard (measured along the W 125th walk in
          // shots/audit/R3bus125_day.png), where a real bluestone walk is a
          // continuous blue-grey field with the odd concrete repair let into it.
          // Blocks 28 % -> 18 %, share on a bluestone block 35 % -> 86 %, value
          // lifted to land at 165-185 against concrete's 200. Patches: 4 % -> 2 %.
          float bsBlk = step(0.82, hash12(floor(gG / 126.0) + 5.9));
          if (srep < 0.07) { albedo = mix(albedo, vec3(0.693, 0.627, 0.400), 0.8); GND_rough = 0.68; }
          else if (srep > 0.978) { albedo = mix(albedo, vec3(0.168, 0.152, 0.124), 0.80); GND_rough = 0.9; }
          else if (bsBlk > 0.5 && srep > 0.12) {  // bluestone flag
            float bs = vnoise(gG * 6.0 + slab * 31.0);
            albedo = mix(albedo, mix(vec3(0.318, 0.330, 0.338), vec3(0.412, 0.424, 0.426), bs), 0.88);
            GND_rough = 0.74;
          }
          // The hardware a NYC walk is peppered with, and which no amount of
          // concrete tone can stand in for: 20-30 cm cast-iron pull-box lids
          // (rust brown, smooth) and the orange/pink utility LOCATE marks the
          // Con Ed/DEP crews spray before a dig. Both are all over the refs
          // (Amsterdam & 116, W 125th & Lenox). Folded into one 4.4 m cell so
          // this costs two hashes, not a new noise field.
          if (gNear > 0.02) {
            vec2 hc = gG / 4.4;
            vec2 hid = floor(hc);
            float hr = hash12(hid + 19.3);
            if (hr < 0.30) {
              vec2 hp = (fract(hc) - vec2(hash12(hid + 2.3), hash12(hid + 6.1)) * 0.7 - 0.15) * 4.4;
              float hd = length(hp);
              float lid = smoothstep(0.145, 0.115, hd) * gNear;
              albedo = mix(albedo, vec3(0.141, 0.093, 0.059), lid * 0.9);      // rusted iron lid
              albedo *= 1.0 - smoothstep(0.175, 0.148, hd) * (1.0 - lid) * 0.35; // seating ring
              GND_rough = mix(GND_rough, 0.52, lid * 0.8);
            } else if (hr > 0.86) {
              // spray-paint locate mark: a short fat stroke, orange or pink
              ${SW26 ? `float ma = hash12(hid + 41.3) * 6.2832;
              vec2 mp = (fract(hc) - vec2(hash12(hid + 2.3), hash12(hid + 6.1)) * 0.7 - 0.15) * 4.4;
              vec2 mq = mat2(cos(ma), -sin(ma), sin(ma), cos(ma)) * mp;     // stroke frame at the cell's point
              float mw = 0.012;                                              // fixed edge: no derivatives in this branch
              float mk2 = smoothstep(0.045 + mw, 0.03, abs(mq.y)) * smoothstep(0.42, 0.36, abs(mq.x))   // the 0.8 m stroke
                        + smoothstep(0.045 + mw, 0.03, abs(mq.x - 0.28)) * smoothstep(0.16, 0.12, abs(mq.y)); // its tick
              mk2 = clamp(mk2, 0.0, 1.0) * (0.75 + 0.25 * vnoise(gG * 9.0));` : `float mk2 = smoothstep(0.86, 0.995, gridge(gG * vec2(3.1, 11.0) + hid * 7.0));`}
              vec3 lc = hash12(hid + 31.7) > 0.45 ? vec3(0.55, 0.19, 0.030) : vec3(0.53, 0.13, 0.210);
              albedo = mix(albedo, lc, mk2 * 0.30 * gNear);
            }
          }
          // hairline cracks on ~22% of flags, corner spalls on a few
          if (hash12(sid + 3.9) < 0.22 && gNear > 0.01) {
            float rdg = gridge(gG * ${SW26 ? '1.3' : '3.4'} + slab * 17.0);
            albedo *= 1.0 - smoothstep(${SW26 ? '0.965, 0.995' : '0.90, 0.99'}, rdg) * ${SW26 ? '0.22' : '0.30'} * gNear;
          }
          // staining: hosing/foot-traffic blotches, dark drip runs off the
          // building line, and the sooty grey that collects along the kerb
          albedo *= 1.0 - smoothstep(0.46, 0.9, fbm(vWPos.xz * 0.14 + 23.0)) * ${GM28 ? '0.20' : '0.13'};
          albedo *= 1.0 - smoothstep(0.5, 0.9, fbm(vWPos.xz * 0.05 + 4.2)) * ${GM28 ? '0.24' : '0.17'};
          // tree-pit / scaffold rust and grease haloes: warm dark, ~8 m apart
          {
            float halo = smoothstep(0.72, 0.97, fbm(vWPos.xz * 0.09 + 55.0));
            albedo = mix(albedo, albedo * vec3(0.86, 0.835, 0.825), halo * 0.45);
          }
          ${E10 ? `
          // ---- E10: GUM. Every square metre of a New York walk carries three to six
          // flattened black discs, and they are the single most recognisable thing about
          // the surface — more so than the flag joints, which we already draw. They are
          // also a CONTACT term in the sense that matters here: they give the walk a
          // population of small dark marks, which is what our concrete lacks against the
          // reference's (streets-audit measured our sidewalk as one value with two soft
          // ~5-11 cm feature, so it is gated on its OWN footprint and not on the shader's
          // generic gNear (which is still at 0.89 where a 5 cm disc is half a pixel — a
          // hash-gated sub-pixel disc is the window-stipple failure of round 7, in the
          // ground shader). Full weight while a spot is >= 6 px, gone before it is 2, i.e.
          // present within ~10 m of the camera and absent from every aerial. The correct
          // band-limited far field of gum really is nothing: 30 % of 0.46 m cells carrying
          // a 7 cm disc is 0.7 % of the surface by area.
          {
            float gumVis = smoothstep(0.030, 0.008, gFw);
            if (gumVis > 0.01) {
              vec2 mc = gG / 0.46;
              vec2 mid2 = floor(mc);
              float mh2 = hash12(mid2 + 91.7);
              if (mh2 < 0.30) {
                vec2 mp = (fract(mc) - vec2(hash12(mid2 + 4.7), hash12(mid2 + 12.1)) * 0.7 - 0.15) * 0.46;
                float md = length(mp) / (0.024 + 0.031 * fract(mh2 * 53.0));
                float gum = smoothstep(1.0, 0.62, md) * gumVis;
                albedo = mix(albedo, mix(vec3(0.055, 0.052, 0.048), vec3(0.150, 0.145, 0.138), fract(mh2 * 17.0)), gum * 0.85);
                GND_rough = mix(GND_rough, 0.62, gum * 0.5);
              }
            }
          }` : ''}`}
        } else if (m == 2) {
          // ---- NYC curb: matId 2 is ONLY the 0.14 m vertical face of the
          // granite/bluestone kerb (the top surface belongs to the sidewalk
          // mesh). World-XZ noise on a vertical strip smears into infinite
          // vertical streaks, so build a real 2D frame first: s runs ALONG the
          // kerb (arc length), vWPos.y runs up the face.
          // NYCDDC SB25-011: random lengths >= 36 in, 1/4 in mortared joints,
          // 6 in reveal. Measured off the refs, the kerb is NOT the dark mid
          // grey the last pass assumed: at Amsterdam & 116 the sunlit kerb
          // strip reads sRGB (203,186,167) — LIGHTER than the roadway (173) and
          // just below the flag above it (216), and warm. What makes it read as
          // stone is not its value but its VERTICAL STRUCTURE (below).
          vec2 ctan = normalize(vec2(-GND_wn.z, GND_wn.x) + 1e-5);
          float cs = dot(vWPos.xz, ctan);
          float blkLen = 1.2 + 0.9 * hash12(floor(vec2(cs / 3.0, 0.0)) + 4.1);
          float bId = floor(cs / blkLen);
          float blk = hash12(vec2(bId, 4.1));
          // granite speckle: grain that survives minification via the pixel
          // footprint along the kerb, not per-pixel salt
          float csFw = max(fwidth(cs), 1e-4);
          float spk = mix(0.5, vnoise(vec2(cs, vWPos.y) * 46.0), smoothstep(0.05, 0.008, csFw));
          albedo = mix(vec3(0.300, 0.286, 0.236), vec3(0.380, 0.362, 0.298), blk) * (0.90 + 0.20 * spk);
          // ---- FACE-LOCAL HEIGHT. The last pass could not do this because the
          // kerb was draped on a heightmap; the city now compiles on ONE FLAT
          // base plane, so world Y *is* face-local height:
          //   compile.mjs  BASE_Y 3.24 | asphalt BASE+0.145 = 3.385
          //                sidewalk/kerb top BASE+0.28 = 3.520  (0.135 reveal)
          // (the analytic-sidewalk path emits 3.385 -> 3.525; both share the
          // top, which is what the gradient is measured down from). CURB_TOP is
          // the only place that number appears — if TERRAIN=real comes back, or
          // LOT_Y moves, change it here. The inBand guard makes the failure
          // mode graceful: off the expected plane the face just loses its
          // gradient instead of banding at a wrong height.
          const float CURB_TOP = 3.520, CURB_REVEAL = 0.135;
          float cyRaw = (CURB_TOP - vWPos.y) / CURB_REVEAL;         // 0 = top arris, 1 = gutter
          float inBand = smoothstep(0.42, 0.26, abs(vWPos.y - (CURB_TOP - CURB_REVEAL * 0.5)));
          float cy = mix(0.5, clamp(cyRaw, 0.0, 1.0), inBand);
          // mortared block joints (1/4 in): thin dark verticals, AA'd
          {
            float jf = abs(fract(cs / blkLen) - 0.5) * blkLen;
            albedo *= 1.0 - smoothstep(csFw * 1.6 + 0.014, csFw * 0.4 + 0.002, jf) * 0.42;
          }
          // The three bands every NYC kerb has, top to bottom:
          //  1. the TOP ARRIS — 2 cm of stone rubbed bright by forty years of
          //     feet, salt and street sweepers, and the one part of the face
          //     that sees the whole sky. It is the brightest line in the frame
          //     at eye level and it is what makes a kerb legible at all.
          //  2. the stone body, with vertical splash mottle.
          //  3. the GUTTER FOOT — the bottom 3-4 cm, where grit, oil and leaf
          //     litter pack against the stone. Near black, and the thing that
          //     separates the kerb from the roadway without any geometry.
          albedo *= 1.0 + smoothstep(0.18, 0.02, cy) * 0.26 * inBand;
          albedo = mix(albedo, albedo * vec3(0.30, 0.30, 0.31),
                       smoothstep(0.62, 0.97, cy) * 0.80 * inBand);
          {
            float gr = fbm(vec2(cs * 1.1, vWPos.y * 5.5) + 12.0);
            albedo = mix(albedo, vec3(0.083, 0.077, 0.069),
                         smoothstep(0.52, 0.90, gr) * (0.30 + 0.42 * cy));
            float salt = smoothstep(0.72, 0.95, vnoise(vec2(cs * 2.3, vWPos.y * 9.0) + 71.0));
            albedo = mix(albedo, albedo * vec3(1.20, 1.17, 1.08), salt * 0.35 * gNear); // salt bloom
          }
          albedo *= 1.0 - smoothstep(0.5, 0.92, fbm(vWPos.xz * 0.09 + 2.2)) * 0.24;   // grime runs
          // Yellow "no standing" kerb paint. NYC paints the FACE AND THE TOP
          // ARRIS in one pass, so the top band takes it at full strength and it
          // thins out towards the gutter where the roller could not reach; it
          // is a saturated school-bus yellow, not a mustard tint.
          if (hash12(vec2(bId, 61.0)) > 0.90) {
            float yp = (0.55 + 0.45 * smoothstep(0.85, 0.35, cy))
                     * (0.72 + 0.28 * smoothstep(0.35, 0.75, vnoise(vec2(cs * 1.7, vWPos.y * 6.0) + 5.0)));
            albedo = mix(albedo, vec3(0.500, 0.310, 0.035), yp * 0.86);
            GND_paint = max(GND_paint, yp * 0.5);
          }
          GND_rough = 0.70 + 0.14 * blk; GND_spec = 0.90;   // polished granite keeps its sheen
        }
        else if (m == 3 || m == 4) {
          // ---- NYC road paint: hot-applied THERMOPLASTIC, ~2-3 mm proud of the
          // road, glass beads on top. Fresh it is a bright warm white; it
          // yellows and greys with age, and it fails in three distinct ways:
          //   * rubber transfer  — tyres lay a neutral grey-brown film over it
          //   * scuffing/polish  — the beads are ground off, roughness drops
          //   * chipping         — flakes lift and the asphalt shows through
          // Those are three different looks and the old single "wear" lerp to
          // asphalt could only do the third one.
          float age = fbm(vWPos.xz * 0.024 + 1.9);                 // per-crossing freshness
          float barCov = 1.0, barTone = 1.0;
          ${U10 ? `
          // ---- U10 (r9 blind pair p5: "crosswalk bars uniformly bright and
          // IDENTICAL"). The line above calls itself "per-crossing freshness"
          // and it is not: an fbm at 0.024 has a ~42 m wavelength, LONGER than a
          // crossing is wide, so every bar of one crossing sampled essentially
          // the same value and the crossing came out one flat tone. Nothing in
          // this branch was ever keyed to a BAR.
          //
          // Two seeds, no new physics. A crossing is painted in one visit, so
          // its bars share a base age -> a per-JUNCTION hash on a 55 m cell of
          // the grid frame (the Manhattan block is ~80 x 270 m, so one cell
          // holds at most one crossing). On top of that a per-BAR coverage,
          // 60-100 %: the bars in the wheel tracks lose their film first, a bus
          // that stops on one bar takes it off in a summer, and DOT patches
          // single bars.
          {
            age = clamp(mix(age, hash12(floor(gG * (1.0 / 55.0)) + 7.13), 0.70), 0.0, 1.0);
            // Bar AXIS from the same ~130 m mask gstreak uses to decide which
            // grid axis a block runs on, so the bar grain and the tyre streaks
            // can never disagree: fine (1.45 m, the continental bar pitch)
            // across the bars, coarse (9 m) along them, which is why this does
            // not draw a checkerboard on a stop bar or a lane line.
            float axm = step(0.5, smoothstep(0.38, 0.62, vnoise(gG * 0.0075 + 41.0)));
            vec2 bq = mix(vec2(floor(gG.x * (1.0 / 1.45)), floor(gG.y * (1.0 / 9.0))),
                          vec2(floor(gG.x * (1.0 / 9.0)), floor(gG.y * (1.0 / 1.45))), axm);
            barCov = 0.60 + 0.40 * hash12(bq + 11.37);
            barTone = 0.93 + 0.14 * hash12(bq + 29.71);
            // STIPPLE RULE: a 1.45 m bin is 6.6 px at gFw 0.22 and 1.3 px at
            // 1.10, so both terms converge to their OWN MEAN (0.80 and 1.0, not
            // to "no wear") before a bar can reach a pixel. Converging to 1.0
            // would make every distant crossing brighter than the near ones.
            barCov = mix(0.80, barCov, gMid);
            barTone = mix(1.00, barTone, gMid);
          }` : ''}
          ${GP31 ? `// GP31: a bar's own draw. U10's bins guessed the bar axis from the block mask, and on half the crossings the
          // 1.45 m bins ran ALONG the bars and cut each one into two tones; gpKerbWorker hands every rectangle its own
          // random (z channel, above the half width)
          if (vK.z > 100.5 && vK.y > 100.5 && (m == 3 || m == 4)) {
            float kr = floor((vK.z - 1.0) / 100.0);
            float junR = mod(kr, 25.0) / 24.0;                                    // the crossing's draw
            // the bar's own draw; a line (half width under 10 cm) is emitted as one quad per 6-14 m and must not step in
            // tone from quad to quad, so it takes the crossing's
            float barR = mod(vK.z - 1.0, 100.0) < 10.0 ? junR : floor(kr / 25.0) / 23.0;
            barCov = mix(0.80, 0.60 + 0.40 * barR, gMid);
            barTone = mix(1.00, 0.93 + 0.14 * fract(barR * 3.71 + 0.57), gMid);
            // the crossing's age from the 55 m cell of the bar's CENTRE: from each fragment's own cell, a cell line
            // through a crossing split its bars into two tones
            age = clamp(mix(fbm(vWPos.xz * 0.024 + 1.9), junR, 0.70), 0.0, 1.0);
          }` : ''}
          vec3 fresh = m == 3 ? vec3(0.618, 0.600, 0.556) : vec3(0.408, 0.212, 0.014);
          vec3 old   = m == 3 ? vec3(0.446, 0.420, 0.336) : vec3(0.292, 0.160, 0.026);
          vec3 paintC = mix(fresh, old, smoothstep(0.34, 0.86, age)) * barTone;
          // rubber film: anisotropic along the roadway, the strongest and most
          // recognisable contamination on a NYC crosswalk bar
          float rubber = smoothstep(0.46, 0.90, gstreak(gG, 0.03, 0.85, 4.4)) * (0.35 + 0.65 * age);
          paintC = mix(paintC, paintC * vec3(0.70, 0.695, 0.68), rubber * 0.60);
          // chipping: fine ridged flakes at 4-12 cm, plus a coarser blotch, all
          // mip-faded. The old 50 m low-frequency blob erased whole junction
          // halves, so it now contributes barely a third of the wear budget and
          // the fine scales carry the rest.
          // wear follows the DIRECTION OF TRAVEL (grid frame gG), never world XZ:
          // the old ridged noise in world space drew isotropic creases that read as
          // worm doodles / black tendrils across every crosswalk (review R3 #2).
          // The wheel-track streak the asphalt branch already
          // computes carries the fine wear; the blotch and pits stretch along travel.
          float wearArea = fbm(gG * vec2(0.021, 0.034) + 7.3);
          float flake = smoothstep(0.55, 0.95, gstreak(gG, 0.02, 0.62, 7.1));
          float pit   = smoothstep(0.58, 0.93, vnoise(gG * vec2(2.4, 6.4)));
          float wear = smoothstep(0.30, 0.95,
              wearArea * 0.15 + flake * 0.48 * gNear + pit * 0.31 + rubber * 0.30);
          // NYC DOT repaints often enough that a crossing is ALWAYS legible.
          // The cap is down from 0.62 to 0.46 and the 50 m blob from 0.26 to
          // 0.15 of the budget: at 0.62 towards bare asphalt the bars grew
          // black blotches big enough to read as half-erased paint, which is
          // not a failure mode NYC thermoplastic has — it goes grey and
          // translucent from the aggregate showing through a THINNED film, and
          // it wears at the bar edges and in the wheel tracks, in fine speckle.
          wear = clamp(wear, 0.03, 0.46);
          float wearCap = 0.46;
          ${U10 ? `
          // spend the per-bar budget. A 60 %-coverage bar carries about 1.9x the
          // wear of a fresh one and the CAP moves with it, so the worst bar in a
          // crossing can go further than the round-9 ceiling while the best one
          // stays crisper than it used to — which is the point: the tell was the
          // absence of a SPREAD, not the level.
          wear = clamp(wear * (2.40 - 1.40 * barCov) + (1.0 - barCov) * 0.10, 0.02, 0.62);
          wearCap = 0.62;` : ''}
          // AM120 (2026-09-15, docs/notes/amst120-critic.md): the light end of the asphalt mix was a warm TAN (0.55,0.41,0.23),
          // so a sunlit avenue sampled rgb(160,150,135) against rgb(~100,107,120) on the real Amsterdam Ave — 55 % too bright and
          // the wrong hue. Worn NYC asphalt is a cool mid-grey: the light end is now neutral-cool and the mix range narrower.
          vec3 asph = mix(vec3(0.1259, 0.1328, 0.1276), vec3(0.3300, 0.3380, 0.3520), n1 * 0.5 + 0.15);
          // worn target: aggregate read through a residual film, NEVER bare road
vec3 worn = mix(asph, paintC * 0.80, 0.62);
          albedo = mix(paintC, worn, wear / wearCap);
          GND_paint = 1.0 - wear;                                  // intact film coverage
          // thermoplastic is much smoother than the aggregate around it, and
          // polishes further where the tyres run
          GND_rough = mix(mix(0.62, 0.50, rubber), 0.88, wear);
          GND_spec = mix(0.50, 1.0, GND_paint);   // glass beads: the film really is glossy
          ${GP31 ? `// GP31: the film is laid whole here and the surface pass wears it off the scan's high points (the chips
          // tyres reach first), so a worn bar shows real aggregate through a real film instead of a lerp to grey
          GP_wear = clamp(wear / wearCap, 0.0, 1.0); GP_asph = asph;
          albedo = paintC; GND_paint = 1.0; GND_rough = mix(0.62, 0.50, rubber); GND_spec = 1.0;
          {
            // the road's cracks run on through the film (reflective cracking): a sealed run lays its black band over the
            // bar, an open one splits the film and flakes it off a centimetre or two either side. Same lot, same street
            // frame and the same crack line as the asphalt round it (gpCrackL), so a crack crosses a bar unbroken.
            vec2 lotQ = gG / vec2(82.0, 76.0) + vec2(fbm(gG * 0.013 + 4.0), fbm(gG * 0.015 + 21.0)) * vec2(0.075, 0.075);
            vec2 lotId = floor(lotQ);
            float lotH = (hash12(lotId + 3.3) + hash12(lotId + 11.7) + hash12(lotId + 27.1) + hash12(lotId + 41.9)) * 0.25;
            float aged = smoothstep(0.38, 0.62, lotH);
            ${GP32 ? `// GP32: the road's crack net runs on through the film (the same net in the same grid frame, so a crack crosses a
            // bar unbroken): the film splits along the crack and lets go along its broken lips; no sealant band over it
            if (gFw < 0.10) {
              GP_open = gpNetC;
              GP_flake = min(1.0, GP_open + GP_cSpall * 1.4);
            }
            if (false) {` : 'if (aged > 0.01) {'}
              vec2 q = kOk ? vec2(kqx, kQ) : (gAx > 0.5 ? gG.yx : gG);
              vec2 p, gq; float sd = gpCrackL(q, lotId, p, gq);
              float h = max(gFw * 0.5, 0.0008);
              float on = smoothstep(0.0, 0.035, vnoise(p * 0.55 + 29.0) - mix(0.74, 0.46, aged));
              GP_seal = gpBand(sd, 0.022 + 0.013 * vnoise(p * 3.1 + 11.0), h) * on;
              float offC = smoothstep(0.0, 0.035, mix(0.70, 0.40, aged) - vnoise(p * 0.55 + 29.0)) * smoothstep(0.45, 0.62, lotH);
              GP_open = gpBand(sd, 0.0015 + 0.0015 * vnoise(p * 2.3 + 5.0), h) * offC;
              GP_flake = gpBand(sd, 0.010 + 0.018 * vnoise(q * 30.0 + 7.0), h) * offC;
            }
          }` : ''}
        }
        else if (m == 5) {
          // lawn: broad hue drift + dry/trodden patches. Blade detail lives in
          // the grass PBR set; this only sets the value and hue it modulates.
          vec3 base = mix(vec3(0.082, 0.152, 0.048), vec3(0.152, 0.238, 0.076), n1);
          float pat = fbm(vWPos.xz * 0.055 + 17.0);
          base = mix(base, vec3(0.205, 0.208, 0.086), smoothstep(0.58, 0.82, pat) * 0.55); // worn/dry patches
          albedo = base;
          GND_rough = 0.97;
        }
        else if (m == 6) {
          // park path: compacted stone dust / hexblock, warm grey — never the
          // flat tan card it used to be (n2 is a constant, so the old mix
          // resolved to one colour everywhere)
          float pg = fbm(vWPos.xz * 0.6 + 13.0);
          albedo = mix(vec3(0.162, 0.150, 0.130), vec3(0.238, 0.220, 0.190), pg * 0.55 + n1 * 0.45);
          albedo *= 1.0 - smoothstep(0.55, 0.92, fbm(vWPos.xz * 0.07 + 8.0)) * 0.22;
          GND_rough = 0.92;
        }
        else if (m == 9) {
          // NYC bike lane: MUTCD green (a deep emerald, not a lawn green),
          // rolled thin over the asphalt so the aggregate reads through, and
          // scrubbed to bare road in the wheel line
          // ROUND 3: measured on the Amsterdam Ave lane, FOV-matched
          // (shots/audit/R3amst116gutter_day.png): the lane rendered
          // (100,123,111) — G-R only 23, G-B only 12 — a desaturated sage where
          // §4 targets MUTCD/IA-14 at (62,151,98). Same cause as the bus lane:
          // the sky fill is blue and adds to R and B, and ACES pulls the rest of
          // the chroma out. R x0.55, B x0.75, G x1.25 on the authored value, and
          // the wear cap down 0.72 -> 0.58 so a scrubbed lane keeps a film.
          vec3 bkC = mix(vec3(0.0145, 0.135, 0.039), vec3(0.026, 0.210, 0.058), n1);
          float bw2 = smoothstep(0.34, 0.92, gstreak(gG, 0.045, 0.7, 12.0) * 0.62
                    + fbm(vWPos.xz * 0.4 + 12.0) * 0.24 + fbm(vWPos.xz * 0.03 + 5.0) * 0.30) * 0.58;
          vec3 asph2 = mix(vec3(0.1259, 0.1328, 0.1276), vec3(0.3300, 0.3380, 0.3520), n1 * 0.5 + 0.15);   // AM120: see asph above
          albedo = mix(bkC, asph2, bw2);
          GND_paint = (1.0 - bw2) * 0.7;
          GND_rough = mix(0.70, 0.88, bw2);
        } // bike lane green, worn
        else if (m == 10) {
          // Campus red brick, herringbone at 45° to the TRUE College Walk axis
          // (0.8744, 0.4853 — derived from the OSM pedestrian way; the campus
          // grid shares this bearing). No granite bands — they read as stray
          // white lines cutting across the paths.
          float wAlong = vWPos.x * 0.8744 + vWPos.z * 0.4853;
          float wAcross = -vWPos.x * 0.4853 + vWPos.z * 0.8744;
          vec2 hb = mat2(0.7071, -0.7071, 0.7071, 0.7071) * vec2(wAlong, wAcross);
          vec2 bc = vec2(hb.x / 0.62, hb.y / 0.205);
          float bt = hash12(floor(bc) + 7.0);
          albedo = mix(vec3(0.148, 0.066, 0.050), vec3(0.212, 0.110, 0.076), bt) * (0.86 + 0.2 * n2);
          // mortar joints, derivative-faded so distance doesn't sparkle
          vec2 jf = abs(fract(bc) - 0.5);
          float jw = max(fwidth(bc.y), 0.02);
          float joint = smoothstep(0.5 - jw * 1.6, 0.5 - jw * 0.2, max(jf.x * 0.42, jf.y));
          float jointVis = smoothstep(0.45, 0.12, fwidth(bc.y));
          albedo = mix(albedo, vec3(0.176, 0.160, 0.143), joint * 0.55 * jointVis);
          GND_rough = 0.86;
          // ---- Low Plaza granite motifs (McKim paving: nested square panels,
          // fountain medallions, granite frame) — campus-axis coords rel. Alma
          {
            float pa = (vWPos.x - 764.23) * 0.465 + (vWPos.z + 2747.81) * -0.885;
            float pc = (vWPos.x - 764.23) * 0.885 + (vWPos.z + 2747.81) * 0.465;
            if (pa > -45.0 && pa < -6.0 && abs(pc) < 56.0) {
              float gm = 0.0;
              float aaP = fwidth(pa) + fwidth(pc);
              float e = max(0.06, aaP * 0.75);
              // fountain medallion distance (field panels yield to the circles —
              // the outer panels read as the photo's chamfered pentagons)
              float rrW = length(vec2(pa, pc) - vec2(-21.0, -23.0));
              float rrE = length(vec2(pa, pc) - vec2(-21.0, 23.0));
              float rr = min(rrW, rrE);
              // nested-square panel field: 7 x 2 cells (outer two cut by medallions)
              if (pa > -31.4 && pa < -10.6 && abs(pc) < 27.5 && rr > 6.2) {
                vec2 cell = vec2((pc + 27.5) / 7.857, (pa + 31.4) / 10.4);
                vec2 cu = abs(fract(cell) - 0.5) * vec2(7.857, 10.4); // meters from cell center
                float m1 = max(cu.x, cu.y);
                gm = max(gm, smoothstep(3.55 - e, 3.55, m1));                      // cell border
                gm = max(gm, smoothstep(2.3 - e, 2.3, m1) * smoothstep(2.95 + e, 2.95, m1)); // outer band
                gm = max(gm, smoothstep(1.05 - e, 1.05, m1) * smoothstep(1.65 + e, 1.65, m1)); // inner band
                gm = max(gm, smoothstep(0.45 + e, 0.45, m1));                      // center block
              }
              // medallions: granite ring + X diagonals + hub around the basin
              if (rr < 6.6) {
                gm = max(gm, smoothstep(5.4 - e, 5.4, rr) * smoothstep(6.05 + e, 6.05, rr)); // outer ring
                vec2 d2 = vec2(pa, pc) - (rrW < rrE ? vec2(-21.0, -23.0) : vec2(-21.0, 23.0));
                float diag = min(abs(d2.x - d2.y), abs(d2.x + d2.y));
                gm = max(gm, smoothstep(0.5 + e, 0.5 - e, diag) * smoothstep(5.4, 2.2, rr));
                gm = max(gm, smoothstep(2.55 + e, 2.55, rr));                      // hub under the fountain
              }
              // ref photo: the WHOLE court reads tan granite; red brick is the
              // accent — pattern bands, medallions, and the border frames
              float redM = clamp(gm, 0.0, 1.0);
              redM = max(redM, smoothstep(52.6 - e, 52.6 + e, abs(pc)));  // side border strips at the Kent/Dodge building line
              redM = max(redM, smoothstep(-8.2 - e, -8.2 + e, pa));       // north band at the parterre wall
              redM = max(redM, smoothstep(-43.6 + e, -43.6 - e, pa));     // south band at the walk flight
              vec3 gran2 = mix(vec3(0.246, 0.233, 0.211), vec3(0.278, 0.264, 0.242), n2);
              // faint 1.5m paver joints on the tan court
              vec2 pj = abs(fract(vec2(pa, pc) / 1.5) - 0.5);
              float pjw = max(fwidth(pa) / 1.5, 0.015);
              float pjoint = smoothstep(0.5 - pjw * 1.5, 0.5 - pjw * 0.2, max(pj.x, pj.y)) * smoothstep(0.4, 0.1, fwidth(pa));
              gran2 *= 1.0 - pjoint * 0.1;
              vec3 brickBand = mix(vec3(0.184, 0.084, 0.063), vec3(0.228, 0.118, 0.084), n2);
              albedo = mix(gran2, brickBand, redM);
              GND_rough = mix(0.72, 0.86, redM);
            }
          }
          albedo *= 0.92 + 0.13 * n1; // weathering drift
        }
        else if (m == 13 || m == 14) {
          // ---- detectable-warning plate (compiler sections warn / warnIron at
          // every crosswalk end): 60 mm dome grid, 34 mm truncated domes, laid in the
          // street frame so the rows run with the kerb. 13 = brick-red composite,
          // 14 = bare cast iron (a recent capital job: concrete's own value, neutral).
          // Each dome shades light on its sun-facing quadrant and dark on the far one.
          vec2 dq = fract(gG / 0.06) - 0.5;
          float dd = length(dq) * 0.06;                               // metres from the dome centre
          float dome = 1.0 - smoothstep(0.015, 0.019, dd);            // r 17 mm with AA
          float shade = clamp(0.5 + (dq.x - dq.y) * 0.9, 0.0, 1.0);
          vec3 plate = (m == 13 ? vec3(0.235, 0.085, 0.062) : vec3(0.190, 0.185, 0.175)) * (0.86 + 0.14 * n1);
          albedo = mix(plate * 0.74, plate * (0.92 + 0.34 * shade), dome * gMid);
          GND_rough = m == 13 ? 0.78 : 0.62;
        }
        else if (m == 16) {${GP31 ? GP31_PAVER_GLSL : `
          // TP28 — the Times Square plaza (Broadway 42nd-47th, rebuilt in 2017): 1 x 2 ft precast concrete pavers laid
          // with the Broadway axis in a running bond, a charcoal field with lighter pavers drawn out in runs along the
          // axis, and nickel-sized steel discs set into them that throw back the screens. GND_paint carries the discs:
          // the night pass keeps their gloss (a dry paver goes matte) and gives them the thermoplastic's glint.
          vec2 pq = vec2(dot(vWPos.xz, vec2(0.2646, -0.9644)), dot(vWPos.xz, vec2(0.9644, 0.2646)));   // along, across
          vec2 pc = vec2(pq.x / 0.60, pq.y / 0.30);
          pc.x += 0.5 * mod(floor(pc.y), 2.0);
          vec2 pid = floor(pc), pf = fract(pc);
          float ph = hash12(pid + 3.7);
          float runs = vnoise(vec2(pq.x * 0.07, pq.y * 0.8) + 31.0);
          float lite = step(0.90 - 0.22 * smoothstep(0.55, 0.90, runs), ph);
          albedo = mix(vec3(0.150, 0.147, 0.141), vec3(0.222, 0.218, 0.207), lite);
          albedo *= (0.91 + 0.16 * hash12(pid + 9.1)) * (0.95 + 0.09 * n1);
          // sand-swept 4 mm joints, faded with the footprint
          vec2 jm = min(pf, 1.0 - pf) * vec2(0.60, 0.30);
          float jw = max(fwidth(pq.x), fwidth(pq.y)) + 1e-4;
          float joint = 1.0 - smoothstep(0.002, 0.002 + jw * 1.4, min(jm.x, jm.y));
          albedo *= 1.0 - joint * 0.42 * smoothstep(0.06, 0.012, jw);
          // the walked lines along the axis a little lighter and smoother
          float trod = vnoise(vec2(pq.x * 0.05, pq.y * 0.35) + 7.0);
          albedo *= 0.94 + 0.12 * trod;
          GND_rough = mix(0.70, 0.58, trod) + 0.06 * ph;
          GND_spec = 0.85;
          // the discs, r 11 mm: resolvable inside ~8 m only, faded out before they alias
          float dk = 0.0;
          if (jw < 0.016) {
            for (int q = 0; q < 3; q++) {
              float fq = float(q);
              if (hash12(pid * 1.31 + fq * 7.7 + 0.5) < 0.5) {
                vec2 c = vec2(0.1 + 0.8 * hash12(pid + fq * 3.3 + 1.1), 0.18 + 0.64 * hash12(pid + fq * 5.9 + 2.3));
                float dd = length((pf - c) * vec2(0.60, 0.30));
                dk = max(dk, 1.0 - smoothstep(0.011 - jw * 0.7, 0.011 + jw * 0.7, dd));
              }
            }
            dk *= smoothstep(0.016, 0.006, jw);
          }
          albedo = mix(albedo, vec3(0.50, 0.51, 0.52), dk);
          GND_rough = mix(GND_rough, 0.16, dk);
          GND_spec = mix(GND_spec, 2.4, dk);
          GND_paint = dk;`}
        }
        else if (m == 17) {${GP31 ? `
          // GP31 — Bryant Park's walks are loose crushed stone, a warm grey (the park worker's reference check: darker than
          // BP28's pale stone dust, which lit read as sand): the gravel scan carries the stones (5-10 mm, surface pass).
          // Drifts where the stone lies deeper and lighter (thrown aside by feet), and damp, darker ground in the shade of
          // the planes and under the chairs: the 1-3 m soft patches the photographs show along the allees
          float gw = fbm(vWPos.xz * 0.45 + 29.0), gd = fbm(vWPos.xz * 0.075 + 3.0), gc = fbm(vWPos.xz * 0.21 + 41.0);
          // ~0.7 of BP28: the Commons photograph of the north walk (the park worker's ref 3, sun) puts it close to the asphalt
          // beside it, a mid warm grey with pale specks; the teaser films the park at golden hour, where the walk row of LB14
          // lifts it 1.6x over the day preset
          albedo = mix(vec3(0.165, 0.150, 0.121), vec3(0.203, 0.184, 0.149), gw * 0.6 + n1 * 0.4);
          albedo *= 1.0 + 0.10 * (smoothstep(0.55, 0.85, gc) - 0.3);                           // loose drifts, lighter
          float damp = smoothstep(0.58, 0.86, gd);
          // the walk's edges (gpKerbWorker: the distance to the nearest edge line and to the one facing it): loose stone
          // heaped in a ridge along the edge, lighter and coarser; the band where the chairs stand (0.3-2 m in), darker and
          // damper (shade, spills, feet scuffing the fines down); the trodden middle a little lighter and compact
          float eD = 9.0;
          if (vK.x > 0.5 && vK.w < 0.5) { eD = (vK.x - 1.0) * 0.01; if (vK.y > 0.5) eD = min(eD, (vK.y - 1.0) * 0.01); }
          float heap = smoothstep(0.45, 0.12, eD) * smoothstep(0.0, 0.05, eD);
          float chairB = smoothstep(0.25, 0.6, eD) * smoothstep(2.4, 1.4, eD) * (0.6 + 0.4 * vnoise(gG * 0.8 + 3.0));
          float midT = smoothstep(1.2, 2.6, eD);
          damp = max(damp, chairB * 0.85);
          albedo *= (1.0 + 0.18 * heap + 0.05 * midT) * (1.0 - 0.24 * damp);
          albedo = mix(albedo, albedo * vec3(1.04, 1.02, 0.97), heap);                  // loose, dry, unsoiled stone
          GND_rough = mix(0.93, 0.80, damp); GND_spec = mix(0.70, 0.85, damp);
          GP_layer = gpGravelL; GP_ravel = damp; GP_dust = heap;                              // (the surface pass: damp holds the fines, the ridge is coarse)` : `
          // BP28 — Bryant Park's walks: pale decomposed granite over compacted gravel (the park's own grass re-kinded,
          // city/bryantPark.js). A warm light grey-beige, not the asphalt-dark park path (6): a lighter trodden line down
          // the middle of a walk, darker damp drifts, and the fine chip grain from the concrete detail set below.
          float gw = fbm(vWPos.xz * 0.45 + 29.0), gd = fbm(vWPos.xz * 0.06 + 3.0);
          albedo = mix(vec3(0.232, 0.205, 0.160), vec3(0.290, 0.258, 0.204), gw * 0.6 + n1 * 0.4);   // lit it read as snow at 0.34-0.42
          albedo *= 1.0 - smoothstep(0.62, 0.92, gd) * 0.10;
          GND_rough = 0.95; GND_spec = 0.7;`}
        }
        else if (m >= 18 && m <= 21) {
          // RL36 rail (compile.mjs rail pass): 18 rail steel, 19 crushed-stone ballast, 20 the sleeper bed (its matId
          // carries the track's bearing: 20 + 0.45 * bearing / pi), 21 the open cuts' concrete walls and street bridges
          float rn = vnoise(vWPos.xz * 1.7 + 11.0), rn2 = fbm(vWPos.xz * 0.11 + 7.0);
          vec3 ballast = mix(vec3(0.200, 0.188, 0.172), vec3(0.262, 0.248, 0.228), rn) * (0.92 + 0.16 * rn2);
          if (m == 18) {
            bool rTop = GND_wn.y > 0.7;   // the polished running surface over rust-brown flanks
            albedo = rTop ? vec3(0.46, 0.46, 0.48) : mix(vec3(0.20, 0.12, 0.08), vec3(0.28, 0.17, 0.11), rn);
            GND_rough = rTop ? 0.35 : 0.85; GND_spec = rTop ? 1.6 : 0.6;
          } else if (m == 19) {
            albedo = ballast; GND_rough = 0.97; GND_spec = 0.5;
          } else if (m == 20) {
            // concrete sleepers, 0.25 m wide every 0.6 m across the bed, box-filtered (pcov) so they fade to their mean
            float bear = clamp((vMat - 20.0) / 0.45, 0.0, 1.0) * 3.14159265;
            float along = dot(vWPos.xz, vec2(cos(bear), sin(bear))) / 0.6;
            float tie = pcov(along, 0.0, 0.42, max(fwidth(along), 1e-4));
            vec3 tieC = mix(vec3(0.42, 0.41, 0.39), vec3(0.50, 0.49, 0.47), rn) * (0.9 + 0.2 * rn2);
            albedo = mix(ballast * 0.92, tieC, tie);
            GND_rough = mix(0.96, 0.85, tie); GND_spec = mix(0.5, 0.8, tie);
          } else {
            float st = smoothstep(0.45, 0.85, fbm(vec2(dot(vWPos.xz, vec2(0.7071, 0.7071)) * 0.15, vWPos.y * 0.6) + 3.0));
            albedo = mix(vec3(0.48, 0.47, 0.44), vec3(0.36, 0.35, 0.33), st);   // board-formed concrete, run-off streaks
            GND_rough = 0.9; GND_spec = 0.7;
          }
        }
        else {
          // terrain / far carpet. Inside the city this is the filler between
          // compiled sidewalk polygons and the building line, so it must read
          // as dusty urban ground, not as the pale desert soil it used to be
          // (which drew tan strips down every block in the top-down).
          // (critic r5: the vacant lot at 125th & Lenox and every backlot read as a "blank quad" of
          // dirt.) In Manhattan the ground between sidewalks and building lines is paved — concrete
          // yards, asphalt lots, gravel — so the filler is weathered pavement with darker damp patches,
          // not soil; the detail block below gives it the concrete grain when it is not schist.
          vec3 soil = mix(vec3(0.158, 0.152, 0.140), vec3(0.235, 0.228, 0.212), n1);
          soil *= 1.0 - smoothstep(0.5, 0.9, fbm(vWPos.xz * 0.06 + 19.0)) * 0.30;
          albedo = soil;
          if (m == 8) albedo = mix(albedo, vec3(0.118, 0.116, 0.112), 0.55); // urban carpet tint
          ${CP32R_MASK ? `// CP32R: the far terrain over the park is the park from the USGS NAIP aerial (the far macro tiles carry no ground
          // of their own: this is the ground past the near tiles), not the urban carpet's grey
          if (m == 8 && ${CP_PARK_IN('vWPos.xz')}) {
            vec2 cq = vWPos.xz - vec2(447.2, 82.2);
            vec3 ph = texture2D(cpFarPhoto, vec2(dot(cq, vec2(0.4848, -0.8746)) / 4168.0 + 0.5, 0.5 - dot(cq, vec2(0.8746, 0.4848)) / 902.0)).rgb;
            albedo = ph * ph * 1.2;
          }` : ''}
          GND_rough = 0.95;
        }
        // ---- roadway edge classes the compiler cuts out of the asphalt ribbon
        // (11 gutter, 12 red bus lane). Both keep everything the asphalt branch
        // just did — lot age, skin patches, sealant, castings and the asphalt
        // texture tap below — because a gutter and a bus lane ARE that pavement,
        // treated. Only the treatment is authored here.
        //
        // ONE COORDINATE MAKES THE GUTTER POSSIBLE. The ground mesh carries only
        // position and matId: no distance-to-kerb, no lane axis (audit G7). But
        //     gT = gG.x + gG.y
        // is arc length ALONG any kerb that runs on either commissioners'-grid
        // axis — dot((1,1), MG_A) = dot((1,1), MG_B) = 1 per metre — while it
        // varies by at most the strip's own 0.45 m ACROSS it. So inside a gutter
        // fragment gT is a true along-kerb parameter that needs NO guess about
        // the street bearing: the grime can run lengthwise and a catch basin can
        // sit square across the strip whichever way the kerb goes. (It degenerates
        // only on a kerb at 45 deg to both axes — Broadway — which simply gets no
        // basins.) The bus lane is 3.35 m wide, so gT is useless there and the
        // scrub keeps using the asphalt branch's own wheel tracks.
        float gT = gG.x + gG.y;
        if (mRaw == 11${GP32 ? ' && !gpGhost' : ''}) {
          // ---- GUTTER: 0.45 m against every kerb and every corner return.
          // Measured (sunlit) off refs/streetview — lane vs gutter in the SAME frame:
          //   Bedford Ave & N 7, 2022-07     lane (130,124,113) -> gutter (120,111,101)  x0.80 linear
          //   Amsterdam & W 116, 2021-08     lane (172,167,155) -> gutter (170,164,152)  x0.97 (paved that year)
          //   Broadway & Chambers, 2024-11   lane (58,67,83) BLUE -> gutter (83,75,71) WARM, +10 luma
          // The unifying read is NOT "darker". It is the roadway pushed WARM and
          // matte: an oil-and-dirt pack right at the stone, plus bright warm
          // grit, salt and leaf litter in lengthwise clumps. Over a fresh blue
          // binder that LIGHTENS the gutter; over a bleached tan lane it darkens
          // it. Mean here lands at x0.84 with R/B up ~3 %, and the value shift is
          // deliberately NOT gated on gMid — the dark line at the kerb is the
          // strongest read of a street edge from 100 m, and the lead's minimal
          // version faded it out with distance. Only the grit texture fades.
          float run  = vnoise(vec2(gT * 0.21, 3.3)) * 0.62 + vnoise(vec2(gT * 1.05, 8.7)) * 0.38;
          float grit = smoothstep(0.40, 0.78, run) * mix(0.45, 1.0, gMid);
          float dirty = mix(0.34, 1.0, GND_age);        // a repaved block face has a clean gutter
          albedo = mix(albedo, vec3(0.050, 0.042, 0.032), 0.34 * dirty);
          albedo = mix(albedo, vec3(0.270, 0.222, 0.146), grit * 0.42);
          GND_rough = min(1.0, GND_rough + 0.035);
          GND_spec *= 0.88;                              // silted: never a wet sheen
          // DEP catch basin: a ~0.6 m cast grate hard against the stone every
          // 30-90 m of kerb (Broadway & Chambers, W 125th at ACP), set in a
          // concrete/granite header, bars ~5 cm and running INTO the kerb.
          {
            float bc = gT / 34.0, bId = floor(bc);
            if (hash12(vec2(bId, 71.3)) < 0.66) {
              float bp = abs(fract(bc) - (0.18 + 0.64 * hash12(vec2(bId, 13.7)))) * 34.0;
              float bAA = max(fwidth(gT), 0.006);
              float hdr = smoothstep(0.62 + bAA, 0.62 - bAA, bp);
              float grt = smoothstep(0.31 + bAA, 0.31 - bAA, bp);
              albedo = mix(albedo, vec3(0.238, 0.216, 0.180), hdr * 0.72);
              albedo = mix(albedo, vec3(0.060, 0.055, 0.050), grt * 0.92);
              albedo *= 1.0 + grt * (0.5 - abs(fract(${GP32 ? '(kOk ? kqx : gT)' : 'gT'} / 0.052) - 0.5)) * 1.25 * ${GP32 ? 'smoothstep(0.020, 0.008, gFw)' : 'gNear'};${GP32 ? '   // GP32: bars across the gutter, gone before their 5.2 cm pitch is under 3 px (GP31 drew them on gT, 45 deg to a grid kerb, and kept them to a 3 cm footprint: a diagonal hatch from 15-40 m)' : ''}
              GND_rough = mix(GND_rough, 0.52, grt * 0.8);
              GND_spec = max(GND_spec, grt * 0.95);
            }
          }
          ${E10 ? `
          // ---- E10: the gutter is where the street's dirt COLLECTS, and collected dirt
          // is spotty, not a uniform tint. The r8/r9 strip is a value shift plus one
          // lengthwise grit run: from 2 m it reads as a painted band. What a photograph of
          // a NYC gutter has is discrete marks — flattened black gum, tar drips, a crushed
          // can's shadow — over larger soft oil-and-silt blots that kill the sheen the
          // asphalt beside them still has. The spots are a 5-11 cm feature, so they are
          // gated on their OWN footprint (full at >= 6 px, gone before 2 px) rather than on
          // the shader's generic gNear — a hash-gated sub-pixel disc is a stipple, and
          // gNear is still 0.9 at a footprint where one of these is half a pixel. The blots
          // are a 1.4 m feature and survive to the aerials.
          {
            float spotVis = smoothstep(0.030, 0.008, gFw);
            vec2 gc = vWPos.xz / 0.55;
            vec2 gid = floor(gc);
            float gh = hash12(gid + 57.1);
            if (gh < 0.34 && spotVis > 0.01) {
              vec2 gp = (fract(gc) - vec2(hash12(gid + 2.9), hash12(gid + 8.3)) * 0.72 - 0.14) * 0.55;
              float gd = length(gp) / (0.026 + 0.032 * fract(gh * 31.0));
              float spot = smoothstep(1.0, 0.68, gd) * spotVis;
              albedo = mix(albedo, vec3(0.050, 0.046, 0.041), spot * 0.82);
              GND_rough = mix(GND_rough, 0.58, spot * 0.6);
            }
            float oil = smoothstep(0.60, 0.86, fbm(vWPos.xz * 0.72 + 19.0)) * mix(0.55, 1.0, gMid);
            albedo = mix(albedo, albedo * vec3(0.44, 0.43, 0.46), oil * 0.55);
            GND_rough = mix(GND_rough, 0.46, oil * 0.5);
            GND_spec = max(GND_spec, oil * 0.9);
          }` : ''}
        } else if (mRaw == 12) {
          // ---- NYC DOT RED BUS LANE (W 125th, 5th Ave, 1st/2nd Ave...).
          // Measured on W 125th at ACP Blvd, 2023-08, FULL SUN, the red and the
          // lane beside it in the same frame, three patches each:
          //   red (186,140,134) / (193,142,135)   lane (142,138,134) / (153,151,146)
          // In LINEAR terms the film keeps the asphalt's G, drops B by ~6 % and
          // multiplies R by 1.63. It is a thin red-oxide coating over grey
          // aggregate, not an opaque slab: luma barely moves (+4 to +12), the
          // aggregate reads straight through, and the entire read is CHROMA
          // (R-G = 46). Authoring it as a multiply on this block's own asphalt is
          // therefore both cheaper and more faithful than an absolute albedo.
          // The round-2 note's (121,89,94) is the same paint in the 2022-06
          // OVERCAST panorama of this block — 50 luma below its sunlit value.
          // The multiply SHIPS at (1.98, 0.826, 0.765), not the measured
          // (1.63, 1.00, 0.94), and the two rounds of correction are worth
          // recording because the naive value is what fails:
          //   at (1.63,1.00,0.94) the render was (178,152,137) — the right LUMA
          //   (156 vs the panorama's 150) but only R-G = 26 against 46-51;
          //   at (1.90,0.96,0.93) it was (186,150,136) — R exactly on the
          //   panorama's linear 0.491, R-G up to 35, the whole residual in G
          //   (linear 0.305 vs 0.262) and B (0.246 vs 0.238).
          // ACES desaturates hard once the road is this bright and the
          // mean-preserving texture multiply pulls chroma out again, so the film
          // has to ABSORB G and B, not just add R — which is what a red pigment
          // does anyway. G x0.826 and B x0.765 close the gap; B carries the extra
          // 12 % because the asphalt's own B went up 14 % in the hue fix above.
          // ---- LIGHTING-R6 CORRECTION (docs/notes/lighting-r6.md 2). The
          // shipped multiply (1.98, 0.826, 0.765) has a Rec.709 LUMA of
          //   0.2126*1.98 + 0.7152*0.826 + 0.0722*0.765 = 1.067
          // so the film made the lane 6.7 % BRIGHTER than the asphalt it sits
          // on, and the 0.35 blend toward (0.340,0.129,0.098) lifted it further.
          // Measured on the shipped build at markings125, same row, mean sRGB:
          //   DAY   red 129.2 / 131.2   asphalt 127.3 / 125.0
          //   DUSK  red  38.7 /  39.2   asphalt  37.1 /  33.3
          // The lane is lighter than the road at BOTH times of day, so the
          // round-5 hypothesis that this was the daylight tonemap cannot be
          // right: a tone curve is monotone in luminance and cannot invert an
          // ordering. What makes dusk LOOK right is chroma, not value — the
          // asphalt goes strongly blue under skylight (R-B -25..-30) while the
          // red stays neutral-warm (R-B -1), and that chroma break reads as
          // "darker and far more saturated". At day the asphalt is +15 warm, the
          // break collapses, and the pale luma is all that is left.
          // Fixed here, in the only place it can be: luma factor 0.80 (a fifth
          // darker than the road, which is what NYC DOT red actually is) with R
          // held at 1.70 so the chroma break survives ACES/AgX desaturation.
          //   0.2126*1.70 + 0.7152*0.558 + 0.0722*0.550 = 0.801
          vec3 filmed = albedo * vec3(1.70, 0.558, 0.550);
          // ...blended toward the product's own value so a lane laid on fresh
          // black binder still reads red instead of maroon-black. The constant
          // is now BELOW a typical asphalt albedo instead of well above it, and
          // the blend is lighter, so it can no longer lift the lane over the road.
          vec3 red = mix(filmed, vec3(0.150, 0.048, 0.040), 0.18);
          float cov = 0.95 * (1.0 - GND_wheel * 0.42) * (1.0 - GND_cast);
          cov *= 1.0 - smoothstep(0.52, 0.90, fbm(vWPos.xz * 0.075 + 3.7)) * 0.24;
          ${GP31 ? '// GP31: the film went down before the road broke: a pothole, an open crack or an alligator gap shows the black\n          cov *= (1.0 - GP_potIn) * (1.0 - 0.85 * max(GP_open, GP_allig));' : ''}
          albedo = mix(albedo, red, cov);
          GND_rough = mix(GND_rough, 0.88, cov);
          GND_spec = mix(GND_spec, 0.58, cov);
        }
        // ---- steep ground: Manhattan schist. Morningside and Riverside are
        // scoured schist outcrops with retaining cuts, so anything past ~35 deg
        // has to stop being lawn: grass texels stretch into vertical smears on
        // a wall and read as painted concrete. Strata are laid out in an
        // (along-face, world-Y) frame, so they never stretch with the slope.
        if (m == 5 || m == 7 || m == 8) {
          GND_rock = smoothstep(0.819, 0.500, abs(GND_wn.y)); // 35 deg -> 60 deg
          // (TERRAIN INT2: a lawn bank in the region is woodland floor to ~65 deg, its schist in patches past ~55 deg)
          if (vgOn > 0.5 && m == 5) GND_rock = GND_rock * smoothstep(0.45, 0.30, abs(GND_wn.y)) + smoothstep(0.60, 0.45, abs(GND_wn.y)) * smoothstep(0.55, 0.78, fbm(vWPos.xz * 0.08 + 19.0)) * 0.6;
          // ...but the COLUMBIA SUPERBLOCK is not a schist outcrop. Its terraces
          // are padAt banks — granite retaining walls with lawn over them — and
          // the slope rule was turning the plaza flank ramps either side of the
          // cascade into bare cliff rock (campus owner, 2026-09-03). Morningside
          // Park's real outcrops start east of x ~ 1100, so this box is clear of
          // them; Riverside is far west. Feathered 16 m so a steep surface
          // straddling the edge does not step. AABB, not the campus-axis frame
          // the matId 10 branch uses, because this runs on every grass and
          // terrain fragment in the city and four compares are the cheap way.
          {
            vec2 c0 = smoothstep(vec2(545.0, -3036.0), vec2(561.0, -3020.0), vWPos.xz);
            vec2 c1 = smoothstep(vec2(995.0, -2502.0), vec2(979.0, -2518.0), vWPos.xz);
            GND_rock *= 1.0 - c0.x * c0.y * c1.x * c1.y;
          }
          // TERRAIN FIX: on the region's base the cover mask's rock (class 5) is schist whatever the slope; its woodland
          // floor, soil, lawn and meadow (3, 4, 1, 2) are never rock below 60 deg
          GND_vgC = -1;
          if (vgOn > 0.5 && m == 7) {
            // (TERRAIN GRADE: the mask's 1 m cells never show as steps: the lookup is warped by a smooth world noise, 1.1 m
            // either way, and the class voted below, so a class edge is a smooth, irregular line)
            vec2 vgW = (vec2(vnoise(vWPos.xz * 0.35), vnoise(vWPos.xz * 0.35 + 17.3)) - 0.5) * 2.2;
            vec2 vgUV = (vWPos.xz + vgW - vgRect.xy) * vgRect.zw;
            if (vgUV.x > 0.0 && vgUV.y > 0.0 && vgUV.x < 1.0 && vgUV.y < 1.0) {
              vec4 vgT = texture2D(vgMask, vgUV);
              // (TERRAIN GRADE: the class is never one texel's: a tent-weighted vote of the 4x4 texels round the point,
              // bilinear in the point's place among them, so a class edge is the vote's smooth iso-line, rounded over
              // ~2 m, single-texel islands voted away; never a cell's square edge)
              {
                vec2 vgTx = vgUV / vgRect.zw;   // (texel units: one texel per metre)
                vec2 vgB = floor(vgTx - 0.5), vgF = vgTx - 0.5 - vgB;
                vec4 vgA4 = vec4(0.0); vec3 vgA3 = vec3(0.0);   // (sward 1-2, wood 3, soil 4, rock 5 | paved 6, water/bldg 7-8, none 0)
                for (int jy = -1; jy <= 2; jy++) for (int jx = -1; jx <= 2; jx++) {
                  vec2 d = vec2(float(jx), float(jy)) - vgF;
                  float w = max(0.0, 1.0 - abs(d.x) * 0.5) * max(0.0, 1.0 - abs(d.y) * 0.5);
                  float c = floor(texture2D(vgMask, (vgB + vec2(float(jx), float(jy)) + 0.5) * vgRect.zw).r * 255.0 + 0.5);
                  if (c > 0.5 && c < 2.5) vgA4.x += w; else if (c < 3.5 && c > 2.5) vgA4.y += w; else if (c < 4.5 && c > 3.5) vgA4.z += w;
                  else if (c < 5.5 && c > 4.5) vgA4.w += w; else if (c < 6.5 && c > 5.5) vgA3.x += w; else if (c > 6.5) vgA3.y += w; else vgA3.z += w;
                }
                float vgM = max(max(max(vgA4.x, vgA4.y), max(vgA4.z, vgA4.w)), max(max(vgA3.x, vgA3.y), vgA3.z));
                int vgV = vgM == vgA4.x ? 1 : vgM == vgA4.y ? 3 : vgM == vgA4.z ? 4 : vgM == vgA4.w ? 5 : vgM == vgA3.x ? 6 : vgM == vgA3.y ? 7 : 0;
                vgT.r = float(vgV == 1 && floor(vgT.r * 255.0 + 0.5) == 2.0 ? 2 : vgV) / 255.0;
              }
              GND_vgC = int(floor(vgT.r * 255.0 + 0.5));
              // (the 2017 land cover calls many steep wooded banks 'other impervious' (6); where the base is drawn no paving
              // lies there, so a bank with understorey or canopy over it is woodland floor)
              bool vgBank = GND_vgC == 6 && (vgT.b > 0.25 || vgT.g > 0.12);
              if (vgBank) GND_vgC = vgT.b > 0.25 ? 2 : 3;   // (understorey over it: the shrubs and vines read as the sward's green; canopy alone: litter)
              // (a managed park or plaza (flag 1): its mown lawn and 'paved' pixels shaded as one surface, the majority of the
              // cover within 10 m round the fragment: a lawn or a paved plaza, not a pixel mix of the two)
              if (!vgBank && (GND_vgC == 1 || GND_vgC == 6) && mod(floor(vgT.a * 255.0 + 0.5), 2.0) > 0.5) {
                float vgL = 0.0, vgN = 0.0;
                for (int q = 0; q < 12; q++) {
                  float an = float(q) * 2.3998, rr = 3.0 + 7.0 * fract(float(q) * 0.618);
                  vec4 vq = texture2D(vgMask, vgUV + vec2(cos(an), sin(an)) * rr * vgRect.zw);
                  int cq = int(floor(vq.r * 255.0 + 0.5));
                  if (cq == 1 || cq == 2) { vgL += 1.0; vgN += 1.0; } else if (cq == 6) vgN += 1.0;
                }
                if (vgN > 3.5) GND_vgC = vgL > 0.5 * vgN ? 1 : 6;
              }
              if (GND_vgC == 5) GND_rock = max(GND_rock, 0.92);
              else if (vgBank) GND_rock *= smoothstep(0.09, 0.04, abs(GND_wn.y));   // (a wooded bank under understorey, 77-82 deg at the GWB: schist only on a sheer face)
              else if (GND_vgC >= 1 && GND_vgC <= 4) GND_rock *= smoothstep(0.50, 0.38, abs(GND_wn.y));   // (wooded and grassy banks stay ground to 60-68 deg)
              // (TERRAIN INT2: a steep natural bank, past ~55 deg, shows its schist in patches through the litter)
              if (GND_vgC != 6) GND_rock = max(GND_rock, smoothstep(0.60, 0.45, abs(GND_wn.y)) * smoothstep(0.48, 0.72, fbm(vWPos.xz * 0.08 + 19.0)) * 0.85);
            }
          }
          if (GND_rock > 0.004) {
            float ha = dot(vWPos.xz, normalize(vec2(GND_wn.z, -GND_wn.x) + 1e-5));
            vec2 rf = vec2(ha, vWPos.y);
            // Feature scales are chosen so nothing lands under a pixel at the
            // 40-90 m the park cliffs are actually seen from: 15 cm laminations
            // aliased into a dotted screen door on the first pass.
            float mass = fbm(rf * vec2(0.10, 0.075) + 41.0);              // 10-13 m blocks: gives the cut form
            float band = fbm(rf * vec2(0.40, 1.10) + 5.0);                // ~0.9 m foliation
            float lam = gridge(rf * vec2(1.0, 3.0) + 2.0);                // ~0.33 m laminations
            vec3 rock = mix(vec3(0.082, 0.076, 0.068), vec3(0.208, 0.192, 0.170), band * 0.6 + mass * 0.4);
            // muscovite is silvery, biotite near black: the seams read as a
            // cool glitter, with a sparser warm band for the iron/garnet staining
            rock = mix(rock, rock * vec3(1.42, 1.42, 1.38), smoothstep(0.62, 0.97, lam) * 0.80 * gMid);
            rock = mix(rock, rock * vec3(0.42, 0.40, 0.38), smoothstep(0.55, 0.20, band) * 0.55);   // biotite / shadowed cleavage
            rock = mix(rock, rock * vec3(1.24, 1.02, 0.78), smoothstep(0.72, 0.97, fbm(rf * vec2(0.55, 1.7) + 61.0)) * 0.55);
            rock *= 0.86 + 0.28 * vnoise(rf * 6.0) * gNear + 0.14 * (1.0 - gNear);
            rock *= 1.35;   // TERRAIN FIX: the cliffs read as near-black slabs from the air; mid-grey schist as photographed
            // quartz / pegmatite dikes: the NYC Parks outcrops are cut by pale
            // veins running ACROSS the foliation, which is what stops a banded
            // wall from reading as corduroy. Rotated frame, wider AA than the
            // laminations because they must survive minification.
            {
              vec2 dk = vec2(rf.x * 0.62 + rf.y * 0.78, -rf.x * 0.78 + rf.y * 0.62);
              float vein = gridge(dk * vec2(0.42, 0.085) + 77.0);
              rock = mix(rock, rock * vec3(1.65, 1.62, 1.55) + 0.010,
                         smoothstep(0.86, 0.995, vein) * 0.75 * gMid);
            }
            // seepage: water tracks down a cut face and leaves near-black
            // vertical stains with a mineral crust at the bottom. Stretched
            // 8:1 in the (along-face, height) frame.
            float seep = smoothstep(0.50, 0.90, fbm(vec2(rf.x * 1.30, rf.y * 0.16) + 53.0));
            rock = mix(rock, rock * vec3(0.44, 0.46, 0.50), seep * 0.72);
            // Moss / lichen. There is no face-local height (the cut is a
            // terrain-draped grid, no UV), so the toe is inferred from the
            // rock mask itself: moss takes the two TRANSITION bands where the
            // slope is easing back into ground — the crest and the toe — which
            // is exactly where Morningside is green, and never the open face.
            float toe = smoothstep(0.06, 0.42, GND_rock) * (1.0 - smoothstep(0.55, 0.90, GND_rock));
            float moss = smoothstep(0.46, 0.88, fbm(rf * vec2(0.55, 0.9) + 30.0));
            rock = mix(rock, vec3(0.052, 0.076, 0.038), moss * (0.34 + 0.62 * toe));
            // damp algae film in the crevices themselves (low bands of the foliation)
            rock = mix(rock, vec3(0.040, 0.058, 0.034),
                       smoothstep(0.42, 0.10, band) * smoothstep(0.35, 0.8, moss) * 0.45);
            GND_spec = 0.80;   // wet-looking schist is real, but not a mirror
            albedo = mix(albedo, rock, GND_rock);
            GND_rough = mix(GND_rough, 0.82, GND_rock);
          }
        }
        // TERRAIN FIX: paving the ground's steps tilt (a walk laid across a bank the wall data lacks) reads as a crumpled
        // pale sheet; past ~37 deg it takes a weathered concrete retaining face (world-aligned streaks, darker, rough)
        if (m <= 4 || m == 6) {
          float stp = smoothstep(0.80, 0.55, abs(GND_wn.y));
          if (stp > 0.004) {
            float ha2 = dot(vWPos.xz, normalize(vec2(GND_wn.z, -GND_wn.x) + 1e-5));
            float strk = fbm(vec2(ha2 * 0.9, vWPos.y * 0.12) + 17.0), mot = fbm(vec2(ha2, vWPos.y) * 0.25 + 3.0);
            vec3 cw = mix(vec3(0.17, 0.165, 0.155), vec3(0.27, 0.26, 0.24), mot) * (0.8 + 0.3 * strk);
            albedo = mix(albedo, cw, stp);
            GND_rough = mix(GND_rough, 0.92, stp);
            GND_tnW *= 1.0 - 0.8 * stp;
          }
        }
        ${GP31 && typeof location !== 'undefined' && new URLSearchParams(location.search).get('gpdbg') === '1' ? `albedo = kOk ? vec3(0.05, fract(kQ / 3.2) * 0.4, kOk2 ? fract(kqx / 9.0) * 0.4 : 0.0) : vec3(0.4, 0.0, 0.0);` : ''}
        #ifdef GNDDEBUG
        {
          vec3 pal[16];
          pal[0]=vec3(0.8,0.1,0.1); pal[1]=vec3(0.9,0.9,0.1); pal[2]=vec3(0.9,0.1,0.9); pal[3]=vec3(1.0);
          pal[4]=vec3(0.9,0.6,0.1); pal[5]=vec3(0.1,0.9,0.1); pal[6]=vec3(0.1,0.3,0.9); pal[7]=vec3(0.1,0.9,0.9);
          pal[8]=vec3(0.3); pal[9]=vec3(0.05,0.45,0.2); pal[10]=vec3(1.0,0.5,0.0); pal[11]=vec3(0.45,0.45,0.5);
          pal[12]=vec3(0.6,0.0,0.3); pal[13]=vec3(1.0,0.35,0.1); pal[14]=vec3(0.55,0.55,0.62); pal[15]=vec3(0.0);
          albedo = pal[mRaw > 15 ? 15 : mRaw];   // 11 gutter (slate), 12 bus lane (wine), 13 warn plate (orange), 14 iron plate (steel), 15 unknown
        }
        #endif
        ${GP31 ? `// GP31 surface pass: the dry material first, then the weather over it
        bool gpDone = false;
        {
          float fw = length(fwidth(vWPos.xz));
${GP31_SURF_GLSL}
        }` : ''}
        // rain response (precipitation-surfaces contract: wetness, puddles and
        // ripples share the SAME weather clock/coverage as the falling rain)
        if (wet > 0.003) {
          float wpn = vnoise(vWPos.xz * 0.13) * 0.6 + vnoise(vWPos.xz * 0.031) * 0.4;
          float damp = wet * (0.5 + 0.5 * wpn);
          float pud = smoothstep(0.66, 0.8, wpn) * wet * step(0.5, abs(float(m) - 5.0)); // pooling on pavements, not grass
          ${GP31 ? `// GP31: water finds the height field's lows: the wheel ruts and the gutter first, the crevices of the chips
          // before their tops; a pothole holds its own (the surface pass drew it, and rain only raises its level)
          if (m == 0) {
            pud = max(pud, smoothstep(0.45, 0.85, GP_trk) * smoothstep(0.30, 0.80, wet) * smoothstep(0.35, 0.65, vnoise(vWPos.xz * 0.21 + 7.0)));
            if (mRaw == 11${GP32 ? ' && !gpGhost' : ''}) pud = max(pud, smoothstep(0.15, 0.55, wet) * (0.55 + 0.45 * vnoise(vec2(gT * 0.4, 1.0))));
            damp = min(1.0, damp * mix(1.25, 0.75, smoothstep(-0.10, 0.25, GP_hp)));
            // a pothole holds its own pool; its broken walls stay rough when wet (their gloss drew a bright rim line)
            pud *= 1.0 - GP_potIn; damp *= (1.0 - GP_water) * (1.0 - 0.8 * GP_potIn);
          }` : ''}
          albedo *= 1.0 - 0.3 * damp - 0.25 * pud;
          GND_rough = mix(GND_rough, 0.32, damp * 0.65);
          GND_rough = mix(GND_rough, 0.06, pud);
          // specular-AA: mirror-gloss puddles alias into white sparkle at
          // distance — widen roughness with the pixel footprint
          GND_rough = max(GND_rough, smoothstep(0.1, 0.45, length(fwidth(vWPos.xz))) * 0.5 * wet);
          GND_spec = mix(GND_spec, 1.0, clamp(damp + pud, 0.0, 1.0));  // water film restores a full dielectric F0
        }
        // ---- real PBR surface detail (Phase 1/2): world-UV texture layer with
        // anti-tiling, single-tap parallax from displacement, crevice grime,
        // normal + roughness response. Procedural paint/pattern/wet/snow layers
        // composite ON TOP so nothing regresses.
        //
        // Every colour tap is now a MEAN-PRESERVING DETAIL MULTIPLY (gdet):
        // the old code lerped the authored albedo towards (tex * k), so at
        // close range the map's own level replaced the value the branch above
        // had chosen — which is why NYC asphalt authored at 0.05 rendered as a
        // uniform grey-blue sheet, and why the surface changed value as you
        // walked towards it. Dividing by each map's measured mean keeps the
        // authored albedo and takes only the grain. Means (linear, 256px
        // average of the source jpg) are in docs/notes/surfaces.md.
        {
          float fw = length(fwidth(vWPos.xz));
          float det = ${GM28 ? 'smoothstep(2.4, 0.45, fw)' : 'smoothstep(1.0, 0.3, fw)'};
          if (det > 0.02) {
            float mk = smoothstep(0.35, 0.65, vnoise(vWPos.xz * 0.017));
            vec3 wV = normalize(vWPos - cameraPosition);
            ${GP31 ? 'if (gpDone) {   // GP31 drew these above' : `if (m == 0 || m == 3 || m == 4 || m == 9) {           // asphalt (+ paint keeps its colour, gains relief)
              vec2 uv = vWPos.xz * 0.16; // finer tiling: 0.09 read as blown-up macro texture
              float hgt = atex(t_asD, uv, mk).x;
              // r8 BAND-LIMIT (?aa=0 reverts to plain det). The parallax offset is
              // a function of a TEXTURE READ (hgt), so uv carries hgt's own
              // high-frequency gradient — and the hardware picks the mip level
              // for t_asC / t_asN from dFdx(uv). Neighbouring pixels therefore
              // sample DIFFERENT mip levels of the colour and normal maps in a
              // noisy pattern, which is per-pixel LOD jitter: the textbook
              // parallax-mapping shimmer, and it drives the normal that drives
              // the specular. det kept it alive out to a 1 m pixel footprint,
              // where the relief it buys is long invisible (a 3 cm crevice at
              // 0.3 m/px is a tenth of a pixel). Gate it on the near footprint
              // instead: the look is identical inside ~20 m and the LOD noise
              // is gone beyond it. The DISPLACEMENT is still read for crevice
              // grime, which is a scalar multiply and cannot destabilise a mip.
              float pxDet = det * ${AAFIX ? 'smoothstep(0.26, 0.05, fw)' : '1.0'};
              ${GM28 ? `
              // GM28: parallax OCCLUSION instead of the single tap: 10 steps down a 1.8 cm relief and a secant refine,
              // inside ~7 m (footprint under 8 cm), every tap on the flat uv's gradients (one mip per pixel, no LOD
              // jitter). The eye ray walks down from the surface; the lookup moves away from the eye as it goes deeper.
              vec2 gdx = dFdx(uv), gdy = dFdy(uv);
              float pom = det * smoothstep(0.08, 0.02, fw) * (1.0 - GND_paint);
              if (pom > 0.02) {
                vec3 toE = -wV;
                vec2 dUV = toE.xz / max(toE.y, 0.12) * (0.018 * 0.16) * pom * 0.1;   // one of 10 layers
                vec2 cu = uv; float lay = 0.0, dep = 1.0 - hgt;
                for (int k = 0; k < 10; k++) {
                  if (lay >= dep) break;
                  cu -= dUV; lay += 0.1;
                  dep = 1.0 - atexG(t_asD, cu, mk, gdx, gdy).x;
                }
                vec2 pu = cu + dUV;
                float aft = dep - lay, bef = (1.0 - atexG(t_asD, pu, mk, gdx, gdy).x) - lay + 0.1;
                uv = mix(cu, pu, clamp(aft / min(aft - bef, -1e-4), 0.0, 1.0));
                hgt = atexG(t_asD, uv, mk, gdx, gdy).x;
              }
              vec3 tc = atexG(t_asC, uv, mk, gdx, gdy).rgb;` : `
              uv -= wV.xz / max(-wV.y, 0.3) * 0.03 * (1.0 - hgt) * pxDet * (1.0 - GND_paint);
              vec3 tc = atex(t_asC, uv, mk).rgb;`}
              // thermoplastic is a 2-3 mm film: it FILLS the aggregate, so the
              // grain, the crevice grime and the normal relief all fade out
              // with paint coverage and come back exactly where it has worn.
              float bare = 1.0 - GND_paint;
              float agg = 0.55 + 0.85 * vnoise(vWPos.xz * 0.62 + 3.0);
              albedo *= gdet(tc, vec3(43.5, 43.5, 50.0), ${GM28 ? '0.80 * agg * mix(1.0, 0.36, GND_paint)' : '0.30 * agg * mix(1.0, 0.30, GND_paint)'}, det);
              ${GM28 ? `{
                // GM28: the coarse chip layer (the set again at 1/4.8 the frequency, rotated), strongest where the fine
                // grain has already gone sub-pixel, and a little of its relief into the normal
                vec2 uvC = rot2(vWPos.xz * 0.0333, 0.61) + 0.29;
                float detK = smoothstep(4.5, 0.9, fw);
                albedo *= gdet(atex(t_asC, uvC, 1.0 - mk).rgb, vec3(43.5, 43.5, 50.0), 0.62 * mix(1.0, 0.40, GND_paint), detK);
              }` : ''}
              albedo *= 1.0 - (1.0 - hgt) * ${GM28 ? '0.36' : '0.22'} * det * bare;   // crevice grime
              GND_tn = ${GM28 ? 'atexG(t_asN, uv, mk, gdx, gdy)' : 'atex(t_asN, uv, mk)'}.xyz * 2.0 - 1.0; GND_tnW = det * ${GM28 ? '1.0 * mix(1.0, 0.30, GND_paint)' : '0.85 * mix(1.0, 0.22, GND_paint)'};
              if (m == 0) GND_rough = mix(GND_rough, GND_rough * ${GM28 ? '(0.64 + atexG(t_asR, uv, mk, gdx, gdy).x * 0.60)' : '(0.82 + atex(t_asR, uv, mk).x * 0.30)'}, det * 0.8);
            } else if (m == 1 || m == 2 || m == 6 || m == 16 || m == 17) {  // concrete sidewalk/curb/path, TP28 pavers, BP28 gravel
              // the kerb face is vertical: an XZ lookup smears it into vertical
              // stripes and lifted it to near-white. Sample it in the
              // (along-kerb, height) frame instead — same tap count.
              vec2 uvF = vWPos.xz * 0.34;                        // ~3m slabs — 6m read as speckle
              vec2 uvW = vec2(dot(vWPos.xz, normalize(vec2(-GND_wn.z, GND_wn.x) + 1e-5)), vWPos.y) * 1.1;
              vec2 uv = mix(uvF, uvW, GND_wall);
              vec3 tc = atex(t_coC, uv, mk).rgb;
              float detC = det * ${GM28 ? 'smoothstep(1.5, 0.35, fw)' : 'smoothstep(0.55, 0.2, fw)'};      // fade earlier: minified concrete = static
              albedo *= gdet(tc, vec3(5.50, 6.02, 7.40), ${GM28 ? '0.82' : '0.45'}, detC);
              ${GM28 ? 'albedo *= gdet(atex(t_coC, rot2(uv * 0.25, 1.13) + 0.41, 1.0 - mk).rgb, vec3(5.50, 6.02, 7.40), 0.55, det * smoothstep(3.5, 0.8, fw) * (1.0 - GND_wall));' : ''}
              GND_tn = atex(t_coN, uv, mk).xyz * 2.0 - 1.0; GND_tnW = detC * ${GM28 ? '0.95' : '0.6'} * (1.0 - GND_wall);
              // gum specks: ~7% of 0.55m sidewalk cells carry a trodden-flat dark dot
              if (m == 1) {
                vec2 gc = vWPos.xz / 0.55;
                vec2 gid = floor(gc);
                if (hash12(gid * 1.7) < 0.07) {
                  vec2 gp = fract(gc) - 0.5 - (vec2(hash12(gid + 3.1), hash12(gid + 7.7)) - 0.5) * 0.5;
                  float gd = smoothstep(0.17, 0.1, length(gp)) * detC;
                  albedo = mix(albedo, albedo * 0.5, gd * 0.85);
                  GND_rough = mix(GND_rough, 0.4, gd * 0.5);
                }
              }
            } else if (m == 7 && GND_rock < 0.5) {               // paved backlot / vacant lot (not a rock cut)
              vec2 uv = vWPos.xz * 0.34;
              vec3 tc = atex(t_coC, uv, mk).rgb;
              float detC = det * smoothstep(0.55, 0.2, fw);
              albedo *= gdet(tc, vec3(5.50, 6.02, 7.40), 0.40, detC);
              GND_tn = atex(t_coN, uv, mk).xyz * 2.0 - 1.0; GND_tnW = detC * 0.5;
              GND_rough = 0.88;`}
            } else if (m == 5 || m == 7) {                       // grass / terrain / schist
              // on a schist cut the XZ lookup stretches the grass texels into
              // vertical smears — swap the UV to (along-face, height) BEFORE
              // the tap so the rock keeps grain at zero extra cost.
              vec2 uvF = vWPos.xz * 0.22;
              vec2 uvR = vec2(dot(vWPos.xz, normalize(vec2(GND_wn.z, -GND_wn.x) + 1e-5)), vWPos.y) * 0.20;
              vec2 uv = mix(uvF, uvR, GND_rock);
              vec3 tc = atex(t_grC, uv, mk).rgb;
              float lawn = ${GR28 ? '1.0 - step(0.5, abs(float(m) - 5.0))' : '0.0'};   // GR28: the lawn only, not terrain or schist
              float detG = det * mix(smoothstep(0.6, 0.22, fw), smoothstep(2.0, 0.35, fw), lawn);
              albedo *= gdet(tc, vec3(3.30, 4.48, 10.3), mix(mix(0.45, 0.20, GND_rock), 0.75, lawn), detG);
              ${GR28 ? `if (lawn > 0.5) {
                // GR28: clumps and tussocks. The set again at 1/4.8 the frequency (a 22 m tile), strongest where the fine
                // grain has gone sub-pixel; then value at 0.6-2.5 m and the drier clumps a little yellower
                vec2 uvK = rot2(vWPos.xz * 0.046, 0.83) + 0.37;
                albedo *= gdet(atex(t_grC, uvK, 1.0 - mk).rgb, vec3(3.30, 4.48, 10.3), 0.55, det * smoothstep(4.0, 0.8, fw));
                float cl = fbm(vWPos.xz * 0.42 + 5.0), cf = vnoise(vWPos.xz * 1.6 + 23.0);
                albedo *= mix(1.0, 0.84 + 0.32 * cl, det);
                albedo = mix(albedo, albedo * vec3(1.16, 1.07, 0.72), smoothstep(0.6, 0.9, cf) * 0.4 * det * smoothstep(1.2, 0.3, fw));
              }` : ''}
              // the horizontal tangent frame is meaningless on a rock wall, and a
              // grass normal map on schist reads as a dotted screen door
              GND_tn = atex(t_grN, uv, mk).xyz * 2.0 - 1.0; GND_tnW = detG * mix(0.45, 0.8, lawn) * (1.0 - GND_rock);
            } else if (m == 10) {                                // plaza brick/pavers
              // (pvR/pvD dropped — ground was at the 16-sampler limit once the
              // city AO field joined; detail-multiply + normals carry the look)
              vec2 uv = vWPos.xz * 0.15;
              float pvt = atex(t_pvC, uv, mk).r;
              albedo *= mix(1.0, 0.72 + 0.55 * pvt, det * 0.75); // detail-multiply keeps the pattern colors
              GND_tn = atex(t_pvN, uv, mk).xyz * 2.0 - 1.0; GND_tnW = det * 0.9;
              GND_rough = mix(GND_rough, 0.55 + pvt * 0.5, det * 0.6);
            }
          }
        }
        // CP32L: Central Park's ground cover over the lawn (5) and the bare ground (7), from the park's mask (city/cpLand.js,
        // CP32L_GROUND): the woodland floor (browned oak and maple litter, moss and ivy in the damp, trodden soil), the
        // ballfields' clay infields, the tennis centre's green clay, the wet bank at every shore, the silt of the beds.
        // Here, after the grass detail, so it is the lawn's last word (the revetment below skips the park).
        // TERRAIN FIX: the base's natural ground by the cover mask (not the backlot concrete): woodland floor (3) and soil (4)
        // as leaf litter and trodden soil, lawn and meadow (1, 2) as a dry sward; world-aligned noise, no new textures
        // (TERRAIN INT2: steep natural ground, 24-39 deg and over, is woodland floor whatever the mask says (lawn, meadow, or
        // no cover at all): a pale sward on a wooded bank read as the TIN's facets)
        float vgSt = ((m == 7 && GND_vgC != 5 && GND_vgC != 6) || (m == 5 && vgOn > 0.5)) ? smoothstep(0.91, 0.78, abs(GND_wn.y)) : 0.0;   // (the compiled lawn on a steep bank too)
        if ((m == 7 && ((GND_vgC >= 1 && GND_vgC <= 4) || vgSt > 0.004)) || (m == 5 && vgSt > 0.004)) {
          float vn1 = fbm(vWPos.xz * 0.7 + 13.0), vn2 = vnoise(vWPos.xz * 4.1 + 7.0);
          vec3 vgLit = mix(mix(vec3(0.090, 0.072, 0.052), vec3(0.140, 0.108, 0.076), vn1), mix(vec3(0.060, 0.088, 0.036), vec3(0.096, 0.124, 0.050), vn2), GND_vgC == 4 ? 0.1 : 0.35 * smoothstep(0.4, 0.7, vn1));
          vec3 vgA = (m == 7 && GND_vgC >= 3) ? vgLit : mix(vec3(0.070, 0.098, 0.040), vec3(0.118, 0.130, 0.060), vn1);
          vgA = mix(vgA, vgLit, vgSt);
          vgA *= 0.9 + 0.2 * vn2 * gNear;
          float vgW = (1.0 - GND_rock) * (m == 7 && GND_vgC >= 1 && GND_vgC <= 4 ? 1.0 : vgSt);
          albedo = mix(albedo, vgA, vgW);
          GND_tnW *= 1.0 - 0.7 * vgW;
          GND_rough = mix(GND_rough, 0.97, vgW);
          GND_spec = mix(GND_spec, 0.3, vgW);
        }
        // (a paved plaza on the base (cover 6): concrete pavers, 1.5 m slabs with dark joints, world-aligned)
        if (m == 7 && GND_vgC == 6) {
          vec2 pg = abs(fract(vWPos.xz / 1.5) - 0.5);
          float joint = smoothstep(0.47, 0.49, max(pg.x, pg.y));
          float pn = vnoise(floor(vWPos.xz / 1.5) * 1.7 + 3.0);
          vec3 pav = vec3(0.30, 0.295, 0.28) * (0.93 + 0.1 * pn);
          float pw = (1.0 - GND_rock);
          albedo = mix(albedo, mix(pav, pav * 0.62, joint * gNear), pw);
          GND_tnW *= 1.0 - 0.6 * pw;
          GND_rough = mix(GND_rough, 0.86, pw);
        }
        if (cp32lOn > 0.5 && (m == 5 || m == 7) && GND_rock < 0.6) {
          vec2 cpJ = (vec2(vnoise(vWPos.xz * 0.19 + 3.1), vnoise(vWPos.xz * 0.19 + 8.7)) - 0.5) * 3.0;   // ragged edges, +-1.5 m
          vec2 cpUV = (vWPos.xz + cpJ - cp32lRect.xy) * cp32lRect.zw;
          if (cpUV.x > 0.0 && cpUV.y > 0.0 && cpUV.x < 1.0 && cpUV.y < 1.0) {
            vec4 cpM = texture2D(cp32lMask, cpUV);
            float cpWood = smoothstep(0.15, 0.85, cpM.r), cpClay = smoothstep(0.2, 0.8, cpM.g), cpCourt = smoothstep(0.3, 0.7, cpM.b);
            float cpWet = cpM.a;
            if (cpWood > 0.002) {
              float cpv_l1 = fbm(vWPos.xz * 0.85 + 3.0), cpv_l2 = vnoise(vWPos.xz * 3.7 + 11.0), cpv_l3 = fbm(vWPos.xz * 0.11 + 29.0);
              // late September under the canopy (the lead's 08:00 review against photographs of the Ramble: brown litter,
              // warm grey-brown to olive in shade, with green patches of understory): a warm, lighter litter, the
              // understory's greens mottled through it, no sheen (the sky's specular had tinted it slate-blue)
              // CP33 LANDSCAPE: the woodland floor (review of teaser 4 v2: "bare brown soil ... an orange dirt band from the
              // air at golden hour"): a greyer, darker litter (oak, maple and beech leaves browned to umber, not orange), the
              // ground cover (ivy, wild ginger, mayapple, sedge) green in broad drifts and patches, sunlit leaf flecks and
              // damp soil between them near the lens, and the litter's own bump (finite-difference noise normals)
              vec2 cpP = vWPos.xz;
              vec3 cpL = mix(vec3(0.088, 0.070, 0.050), vec3(0.134, 0.104, 0.074), cpv_l1);
              float cpv_g = smoothstep(0.34, 0.64, cpv_l3 + 0.2 * (cpv_l1 - 0.5));
              cpL = mix(cpL, mix(vec3(0.058, 0.090, 0.034), vec3(0.098, 0.130, 0.052), cpv_l2), cpv_g * 0.72);
              float cpv_f = vnoise(cpP * 11.0 + 41.0), cpv_f2 = vnoise(cpP * 23.0 + 5.0);
              cpL = mix(cpL, vec3(0.190, 0.136, 0.070), smoothstep(0.72, 0.90, cpv_f) * 0.55 * gNear * (1.0 - 0.6 * cpv_g));
              cpL = mix(cpL, vec3(0.040, 0.032, 0.024), smoothstep(0.70, 0.92, cpv_f2) * 0.5 * gNear);
              cpL *= 0.9 + 0.2 * cpv_l2 * gNear + 0.1 * (1.0 - gNear);
              albedo = mix(albedo, cpL, cpWood);
              {
                vec2 cpq = cpP * 17.0;
                float cpb0 = vnoise(cpq + 3.0);
                vec3 cpBn = normalize(vec3((vnoise(cpq + vec2(0.35, 0.0) + 3.0) - cpb0) * 3.2, (vnoise(cpq + vec2(0.0, 0.35) + 3.0) - cpb0) * 3.2, 1.0));
                GND_tn = mix(GND_tn, cpBn, cpWood * gNear);
                GND_tnW = mix(GND_tnW * (1.0 - 0.75 * cpWood), 0.6 * gNear, cpWood * gNear);
              }
              GND_rough = mix(GND_rough, 1.0, cpWood);
              GND_spec = mix(GND_spec, 0.25, cpWood);
            }
            if (cpClay > 0.002) {
              float cpv_c1 = fbm(vWPos.xz * 0.6 + 71.0), cpv_c2 = vnoise(vWPos.xz * 5.0 + 13.0);
              vec3 cpC = mix(vec3(0.235, 0.118, 0.062), vec3(0.300, 0.160, 0.088), cpv_c1) * (0.9 + 0.2 * cpv_c2 * gNear);
              albedo = mix(albedo, cpC, cpClay);
              GND_tnW *= 1.0 - 0.9 * cpClay;
              GND_rough = mix(GND_rough, 0.93, cpClay);
            }
            if (cpCourt > 0.002) {
              vec3 cpT = mix(vec3(0.108, 0.128, 0.098), vec3(0.140, 0.160, 0.122), fbm(vWPos.xz * 0.5 + 91.0));
              albedo = mix(albedo, cpT, cpCourt);
              GND_tnW *= 1.0 - 0.9 * cpCourt;
              GND_rough = mix(GND_rough, 0.94, cpCourt);
            }
            if (cpWet > 0.002) {
              float cpv_w1 = fbm(vWPos.xz * 0.7 + 17.0);
              vec3 cpMud = mix(vec3(0.052, 0.046, 0.032), vec3(0.082, 0.072, 0.050), cpv_w1);
              float cpv_mw = smoothstep(0.72, 0.98, cpWet) * (0.45 + 0.45 * cpv_w1);
              albedo = mix(albedo * mix(1.0, 0.84, smoothstep(0.15, 0.7, cpWet)), cpMud, cpv_mw);
              GND_rough = mix(GND_rough, 0.7, cpv_mw);
            }
            if (m == 7) albedo = mix(albedo, mix(vec3(0.040, 0.040, 0.028), vec3(0.066, 0.060, 0.040), fbm(vWPos.xz * 0.4 + 5.0)), smoothstep(0.3, 0.9, cpWet));
          }
        }
        // CP32L: the park's perimeter sidewalk, hexagonal asphalt block (8 in across the flats, laid 1930s-40s) with
        // granite block margins at the kerb (Central Park Conservancy, "Park Perimeter"); the band is the park's own
        // edges in the grid frame (the ring's medians: east 434.6, west -397.4, north 2079.5, south -2033 m) out 10 m.
        if (cp32lOn > 0.5 && m == 1) {
          vec2 cpq = vWPos.xz - vec2(447.2, 82.2);
          float cpa = dot(cpq, vec2(0.4848, -0.8746)), cpb = dot(cpq, vec2(0.8746, 0.4848));
          float cpde = max(max(cpb - 434.6, -397.4 - cpb), max(cpa - 2079.5, -2033.0 - cpa));
          if (cpde > -2.5 && cpde < 10.0) {
            vec2 cpv_hu = vec2(cpa, cpb) / 0.2;
            vec4 cpv_hC = floor(vec4(cpv_hu, cpv_hu - vec2(0.5, 1.0)) / vec4(1.0, 1.7320508, 1.0, 1.7320508)) + 0.5;
            vec4 cpv_hh = vec4(cpv_hu - cpv_hC.xy * vec2(1.0, 1.7320508), cpv_hu - (cpv_hC.zw + 0.5) * vec2(1.0, 1.7320508));
            vec4 cpv_hx = dot(cpv_hh.xy, cpv_hh.xy) < dot(cpv_hh.zw, cpv_hh.zw) ? vec4(cpv_hh.xy, cpv_hC.xy) : vec4(cpv_hh.zw, cpv_hC.zw + 0.5);
            vec2 cpv_ha = abs(cpv_hx.xy);
            float cpv_hd = 0.5 - max(dot(cpv_ha, vec2(0.5, 0.8660254)), cpv_ha.x);
            float cpv_hfw = gFw * 10.0 + 1e-4;   // gFw: the footprint taken in uniform flow at the top
            float cpv_hdet = 1.0 - smoothstep(0.12, 0.35, cpv_hfw);
            float cpv_joint = (1.0 - smoothstep(0.025, 0.025 + cpv_hfw, cpv_hd)) * cpv_hdet;
            vec3 cpv_hexC = vec3(0.080, 0.078, 0.074) * mix(1.0, 0.84 + 0.32 * hash12(cpv_hx.zw * 1.37 + 3.0), cpv_hdet);
            cpv_hexC *= 1.0 - 0.18 * smoothstep(0.55, 0.9, fbm(vWPos.xz * 0.21 + 61.0));   // traffic polish and stains
            cpv_hexC = mix(cpv_hexC, vec3(0.050, 0.047, 0.043), cpv_joint * 0.8);
            ${GP31 ? `if (kOk && kDn < 0.62) {
              // the granite margin at the kerb: three courses of setts
              vec2 cpv_gu = vec2(cpa / 0.21, kDn / 0.2);
              vec2 cpv_gf = fract(cpv_gu + vec2(floor(cpv_gu.y) * 0.5, 0.0));
              float cpv_gj = (1.0 - smoothstep(0.04, 0.04 + gFw * 9.5, min(cpv_gf.x, 1.0 - cpv_gf.x))) + (1.0 - smoothstep(0.05, 0.05 + gFw * 10.0, min(cpv_gf.y, 1.0 - cpv_gf.y)));
              vec3 cpv_gr = vec3(0.205, 0.198, 0.188) * (0.88 + 0.24 * hash12(floor(cpv_gu + vec2(floor(cpv_gu.y) * 0.5, 0.0)) + 9.0));
              cpv_hexC = mix(cpv_gr, cpv_gr * 0.55, clamp(cpv_gj, 0.0, 1.0) * cpv_hdet);
            }` : ''}
            albedo = cpv_hexC;
            GND_tnW *= 0.3;
            GND_rough = 0.88;
          }
        }
        // waterfront revetment — LAST albedo writer before decals/rain/snow.
        // It must sit AFTER the PBR detail block: the grass texture mix above
        // washed every earlier placement back to pale tan at close range (det
        // rises as you approach, so the rock only survived at a distance).
        // Soft ground sloping into the water reads as riprap: dry rock on any
        // bank steeper than ~9 degrees, wet dark rock in the splash zone, and
        // a low-band override so anything within a meter of sea level is wet
        // rock/mud regardless of slope (the terrain-grid crossing row at the
        // seawall toe is gentle but it is still tidal ground, never lawn).
        // vNormal is VIEW-space in three's pipeline — the slope gate needs the
        // geometric world normal from position derivatives.
        if ((m == 5 || m == 7 || m == 8 || m == 6)${CP32R_MASK ? ` && !${CP_PARK_IN('vWPos.xz')}` : ''}) {
          vec3 nWG = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          float bankSl = 1.0 - abs(nWG.y);
          float bank = smoothstep(0.012, 0.05, bankSl); // 1-cos: 9deg=0.012 18deg=0.05
          // riprap belongs to the waterline: fade the rock out above ~6m so
          // graded park slopes (Riverside's 20m bank) stay green hillside
          // instead of reading as a full-height quarry cut
          bank *= mix(0.18, 1.0, 1.0 - smoothstep(6.0, 14.0, vWPos.y));
          float low = 1.0 - smoothstep(0.25, 0.95, vWPos.y);
          float n2r = vnoise(vWPos.xz * 2.3);
          vec3 dryRock = mix(vec3(0.112, 0.106, 0.100), vec3(0.170, 0.163, 0.152), n2r)
                       * (0.85 + 0.3 * vnoise(vWPos.xz * 0.9));
          albedo = mix(albedo, dryRock, bank * 0.85);
          vec3 wetRock = mix(vec3(0.050, 0.053, 0.056), vec3(0.086, 0.089, 0.092), n2r);
          float wetW = max((1.0 - smoothstep(0.35, 2.8, vWPos.y)) * bank, low * 0.9);
          albedo = mix(albedo, wetRock, wetW);
          albedo = mix(albedo, vec3(0.055, 0.076, 0.048),
            smoothstep(0.8, 0.15, abs(vWPos.y - 0.35)) * max(bank, low) * 0.5); // algae line
          // matte banks (never below the soft-ground baseline): the daytime
          // white sheet on the old shore aprons was grazing-angle Fresnel,
          // which no roughness value kills — the compile-side drape clamp is
          // what actually removes the grazing surface
          GND_rough = max(GND_rough, 0.9 * max(bank, wetW));
        }
        // pavement in the splash zone: the compiled toe apron (overlay fringe
        // dropped to ~0.45m at the seawall base) must read as tide-stained
        // concrete, not fresh sidewalk. Gated on height alone — carved road
        // trenches this deep are rare and damp-dark suits them anyway.
        if ((m == 1 || m == 2 || m == 10)${CP32R_MASK ? ` && !${CP_PARK_IN('vWPos.xz')}` : ''}) {
          float lowP = 1.0 - smoothstep(0.2, 0.9, vWPos.y);
          albedo = mix(albedo, mix(vec3(0.106, 0.113, 0.113), vec3(0.148, 0.152, 0.148), vnoise(vWPos.xz * 1.7)), lowP * 0.8);
          albedo = mix(albedo, vec3(0.058, 0.074, 0.050),
            smoothstep(0.75, 0.15, abs(vWPos.y - 0.32)) * lowP * 0.45); // algae stain
          GND_rough = max(GND_rough, 0.85 * lowP);
        }
        // composite road decals (asphalt only sets them). The utility-cut
        // backfill tone is applied in-branch now; GND_patch only carries the
        // surface response (a cold patch is coarser and flatter than the mix
        // around it, and it never took the parent surface's polish).
        GND_rough = mix(GND_rough, 0.93, GND_patch * 0.7);
        GND_tnW *= 1.0 - GND_patch * 0.35;
        // cast iron: dark, worn smooth by tyres, and warmer than the asphalt
        albedo = mix(albedo, vec3(0.088, 0.080, 0.070), GND_manhole);
        albedo = mix(albedo, albedo * 0.5, GND_oil);
        GND_rough = mix(GND_rough, 0.48, GND_manhole);
        ${GP31 ? `// GP31: the cast face: polished bosses and rim, grit-dark lows, slots down to the vault
        albedo = mix(albedo, albedo * mix(0.62, 1.30, GP_castPat), GND_manhole);
        albedo = mix(albedo, vec3(0.012, 0.011, 0.010), GP_castSlot * GND_manhole);
        GND_rough = mix(GND_rough, mix(0.72, 0.34, GP_castPat), GND_manhole);` : ''}
        GND_rough = mix(GND_rough, 0.62, GND_oil);
        GND_spec = max(GND_spec, max(GND_manhole, GND_oil) * 0.95);
        GND_tnW *= 1.0 - GND_manhole * 0.85;
        // ---- ground exposure trim.
        // A street plane takes the whole sky dome plus a 42 deg sun, so it is
        // the brightest-lit surface in the frame; with the day preset's
        // exposure 0.62 and the ACES lift, sunlit asphalt at a physical 0.10
        // albedo rendered at sRGB 155-170 where a photograph of 125th St reads
        // 100-130, and paint clipped to white before the bloom pass even ran.
        // Everything above is authored at physical albedo; this single factor
        // puts the ground back on photographic values, and stays near 1 at
        // night where the only light is a sodium lamp and 0.3 would read black.
        // Retune HERE (not per material) if the exposure or sun intensity move.
        // A vertical face (kerb, schist cut, revetment) sees roughly half the
        // sky dome, so it needs less of the trim or it goes to soot.
        albedo *= mix(0.30, 0.88, night) * (1.0 + 0.60 * (1.0 - abs(GND_wn.y)));
        // ---- STREET-SURFACE CALIBRATION (2026-09-03, docs/notes/streets-audit.md).
        // The trim above was fitted to "a photograph of 125th St reads sRGB
        // 100-130". The 80-panorama Street View set says otherwise: EVERY sunlit
        // road patch in refs/streetview measures 136-188 and every sunlit
        // concrete flag 189-237, and every one of them has R > G > B (by 16 on
        // asphalt, 37 on concrete). Against this exposure and a sky-dominated,
        // therefore BLUE, ambient, the 0.30 trim landed the roadway at 118 and
        // INVERTED the hue (render B > R by 6-13) — which is what reads as wet
        // slate instead of dry warm concrete, and is most of the "processed
        // incorrectly" complaint. This factor puts asphalt / flag / kerb back
        // on the measured values and leaves every other surface on the
        // 2026-09-02 calibration. Daytime only: at night the one light is a
        // sodium lamp and the trim has already lerped to 0.88.
        // Retune HERE, and re-measure with the boxes in the notes.
        // LB14 (docs/notes/lb14.md, critic r14 fixes 2/3/4): the ONE warm vec3 above was doing three
        // different jobs and could not be right for any of them at once — it is the only warmth in a
        // sunlit frame (the day key saturates to a neutral 0xfffcf7 by elev 42), so all of it also
        // lands on the SHADE, where the reference is sky-blue. Split into three live uniforms
        // (ENV.lb14StCal / lb14Walk / lb14Paint), hue-neutralised, with the warmth moved into the sun
        // (sky.js PRESETS.day.sunW). ?lb14=0 restores (1.94,1.70,1.47) on road+walk and 1.0 on paint.
        //   road/terrain: same luminance (1.734), R/B 1.32 -> 1.08
        //   walk:  0.79x luminance and neutral — it measured 27-52 luma OVER the road in shade
        //          against the reference crop's +6..+7, and rendered olive-green (98,107,104) where the
        //          reference is blue-grey (67,87,105)
        //   paint: thermoplastic never took the street lift at all (m 3/4 fell through every branch),
        //          so intact white film sat at only 1.5x the road's effective albedo where a real
        //          crossing is 6-7x. Scaled by GND_paint so WORN film keeps the low end the critic
        //          measured right (the band was 119-178 against the photograph's 92-217).
        {
          vec3 stCal = mix(lb14StCal, vec3(1.0), night);
          // the kerb face is vertical, so the trim above has already handed it
          // +60 %; a full street lift on top of that pushed the warm stone to
          // khaki. It gets a gentler, more neutral one.
          if (m == 2) albedo *= mix(vec3(1.44, 1.39, 1.31), vec3(1.0), night);
          else if (m == 0) albedo *= stCal;
          else if (m == 1 || m == 16 || m == 17) albedo *= mix(lb14Walk, vec3(1.0), night);   // TP28 pavers, BP28 gravel: walk
          else if (m == 3 || m == 4) albedo *= mix(mix(vec3(1.0), lb14Paint, GND_paint${GP31 ? ' * (1.0 - 0.45 * GP_wear)' : ''}), vec3(1.0), night);${GP31 ? '   // GP31: GND_paint is the whole film; GM28 read 1 - wear' : ''}
          // the terrain filler between the compiled walk and the building line
          // has to hold the same value as the walk or every block face gets a
          // dark rim; the schist cut keeps its own calibration.
          else if (m == 7 && GND_rock < 0.02) albedo *= mix(lb14Walk, vec3(1.0), night);
        }
        // ---- night pass.
        // 1. Retroreflection. Thermoplastic carries glass beads: under a street
        //    lamp or a headlight the film throws light back and reads far
        //    brighter than the road, which is the whole reason NYC markings
        //    work at night. Only the INTACT film does it — beads are the first
        //    thing tyres grind off, so it scales with GND_paint, and the kerb
        //    face gets a smaller share of the same effect from its salt bloom.
        if (night > 0.01) {
          albedo = min(albedo * (1.0 + night * GND_paint * 0.70), vec3(0.95));
          // 2. A dry street at night must not read wet. The sodium lamps are
          //    small, bright sources: at day roughness the road throws a long
          //    specular streak that looks like rain even with SSR at its dry
          //    floor. Roughen and de-spec the road while ENV.wet is ~0, and
          //    hand it all back the moment it starts raining (the wet block
          //    above has already pushed GND_spec to 1 and roughness down).
          float dryN = night * (1.0 - clamp(wet * 3.0, 0.0, 1.0));
          // a vertical face (kerb, schist) never throws the long grazing
          // streak a road plane does, so it keeps its stone sheen
          float roadPlane = (1.0 - GND_paint) * (1.0 - GND_wall);   // (flat is a reserved GLSL keyword)
          ${GP31 ? 'if (m == 16) roadPlane *= 0.4;   // GP31: a foot-polished paver keeps a soft sheen under the screens' : ''}
          GND_rough = mix(GND_rough, max(GND_rough, 0.97), dryN * roadPlane);
          GND_spec *= 1.0 - 0.45 * dryN * roadPlane;
        }
        if (snowA > 0.003) { // accumulation: patchy at first, blanket at 1 —
          // grass holds snow sooner than trafficked pavement
          float snn = vnoise(vWPos.xz * 0.31) * 0.5 + vnoise(vWPos.xz * 0.06) * 0.5;
          float grassBias = 1.0 - step(0.5, abs(float(m) - 5.0)) * 0.35;
          float sm = clamp(snowA * (0.55 + 0.9 * snn) * (0.65 + grassBias), 0.0, 1.0);
          albedo = mix(albedo, vec3(0.86, 0.885, 0.93), sm);
          GND_rough = mix(GND_rough, 0.62, sm);
        }
        // distance specular AA: the polished bits (thermoplastic, cast iron,
        // granite, wet tar) sparkle once a pixel covers many of them, so relax
        // every roughness back to matte with the world-XZ pixel footprint.
        GND_rough = mix(0.95, GND_rough, smoothstep(0.85, 0.14, gFw));
        ${GP31 && typeof location !== 'undefined' && new URLSearchParams(location.search).get('gpdbg') === '2' ? `albedo = vec3(GP_water, GP_potIn, clamp(length(GP_slopeW), 0.0, 1.0)) * 0.3; GND_rough = 1.0; GND_spec = 0.0;` : ''}
        diffuseColor.rgb = albedo;
      }`)
      .replace('#include <common>', `#include <common>
        uniform float wet; uniform float windT; uniform float snowA; uniform float gs35;`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = GND_rough;`)
      // Specular trim. Three's dielectric F0 of 0.04 is right for a smooth
      // surface; on porous, sooty, very rough ground the microfacet model
      // over-predicts the grazing sky reflection and the road sheets over into
      // a wet-looking mirror as soon as the albedo is dark enough to show it.
      // Asphalt drops to half F0, concrete to 0.72; paint, cast iron, granite
      // and anything with a water film keep the full value.
      // GS35: three r185 has already blended specularColor into specularColorBlended inside that chunk, so the trim has
      // to reach the blended value too (a product, so VG36's own scale composes in either order). By day only for now
      // (golden, dusk and night keep the lamp and sky sheen they were graded with); `gs35` 0 = as before
      .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
        material.specularColor *= GND_spec;
        material.specularColorBlended *= mix(1.0, GND_spec, gs35 * (1.0 - smoothstep(0.0, 0.05, night)));`)
      // GP31: the height field's own shadow (pothole walls, crevices at a low sun) takes the direct light only
      .replace('#include <lights_fragment_end>', GP31 ? `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= GP_shadow; reflectedLight.directSpecular *= GP_shadow;` : '#include <lights_fragment_end>')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        if (GND_tnW > 0.003) { // texture normal map, ground tangent frame (T=+x, B=+z)
          vec3 tn2 = normalize(vec3(GND_tn.xy, max(GND_tn.z, 0.3)));
          vec3 wN = normalize(vec3(tn2.x, tn2.z * ${GM28 ? '1.0' : '1.6'}, tn2.y));
          vec3 vN = normalize((viewMatrix * vec4(wN, 0.0)).xyz);
          normal = normalize(mix(normal, vN, GND_tnW * ${GM28 ? '1.0' : '0.85'}));${GP31 ? `
          // GP31: a shading normal is kept facing the eye (N.V >= 0.08): the relief is steep enough now that a normal at a
          // grazing view could otherwise turn away from it, and a back-facing normal takes a Fresnel of 1
          vec3 gpV = normalize(vViewPosition);
          float gpNV = dot(normal, gpV);
          if (gpNV < 0.08) normal = normalize(normal + gpV * (0.08 - gpNV));` : ''}
        }
        // rain rings on standing water — same clock (windT) as the falling rain
        if (wet > 0.003) {
          float wpn2 = vnoise(vWPos.xz * 0.13) * 0.6 + vnoise(vWPos.xz * 0.031) * 0.4;
          float pud2 = smoothstep(0.66, 0.8, wpn2) * wet
            * smoothstep(0.28, 0.1, length(fwidth(vWPos.xz))); // rings only near the eye — they alias to sparkle far out
          if (pud2 > 0.02) {
            vec2 ruv = vWPos.xz * 1.9;
            vec2 rg = floor(ruv), rf = fract(ruv);
            float rs = hash12(rg);
            float life = windT * 1.25 + rs * 7.0;
            float rt = fract(life);
            vec2 rc = vec2(hash12(rg + floor(life)), hash12(rg + floor(life) + 9.3)) * 0.6 + 0.2;
            float rd = length(rf - rc);
            float ring = sin((rd - rt * 0.55) * 30.0) * exp(-pow((rd - rt * 0.55) * 7.0, 2.0)) * sin(rt * 3.14159);
            vec3 rperp = normalize(vec3(dFdx(ring), 0.0, dFdy(ring)) * -2.2 * pud2 + vec3(0.0, 1.0, 0.0));
            normal = normalize(mix(normal, rperp, pud2 * 0.85));
          }
        }`);
    vgGroundPatch(sh);   // VG36 (GROUND): the lawn under the blades (world/vg36Ground.js; `?vg36g=0` alone off)
  };
  // r8 geometric specular AA (?aa=0 to disable). The ground's shading normal
  // comes from the mip-averaged PBR normal maps (asphalt / concrete / grass /
  // paving) and the rain rings; at 50 m a road pixel already covers ~80 texels
  // of `t_asN` along the view, anisotropy is 8, and mip-averaging a normal map
  // shortens the mean normal without telling the BRDF — which is precisely the
  // low-amplitude sparkle glitch-r7.md 2.3 attributed to 61 % of hot pixels.
  // kappa is a touch looser than the facade's because the road is the surface
  // that takes the whole sky dome at grazing incidence.
  return applySpecAA(applyCityAO(mat), { sigma2: 0.25, kappa: 0.16 });
}

// ------------------------------------------------------------------ FAR LOD (unlit, baked shading, fog)
// ==== FW14 (round 14, owner: the far skyline behind Central Park was untextured boxes): the far city carries a window
// grid. One tiling texture (public/textures/far_windows_fw14.png: 4 bays x 4 floors, 12 x 15.2 m, white sills, spandrels
// and mullions, darker cool glass with blinds variation) multiplies the macro colour through `uv`, which the streamer
// computes per face (fw14Uv: along the wall in metres from the world origin, so a facade is continuous across macro
// tiles; height from the street; roofs on a white texel). Mipmapped and anisotropic, so the grid fades to its average
// with distance instead of shimmering. It is an ordinary map on an ordinary uv, so the harvest exports it and Unreal's
// plain master draws it (ue_prep.py's far rebuild writes the same uv). `?fw14=0`: the flat boxes.
export const FW14 = typeof location === 'undefined' || new URLSearchParams(location.search).get('fw14') !== '0';
// FD14 (makeFacadeMaterial's glass branch): curtain-wall fins and the blue towers' spandrels; `?fd14=0` off
export const FD14 = typeof location === 'undefined' || new URLSearchParams(location.search).get('fd14') !== '0';
export const FW14_TILE = [12.0, 15.2];
export function fw14Uv(pos, origin, scale = 1 / 8) {
  const n = pos.length / 3, uv = new Float32Array(n * 2), ox = origin[0], oz = origin[1];
  for (let t = 0; t + 2 < n; t += 3) {
    const a = t * 3, b = a + 3, c = a + 6;
    const ux = (pos[b] - pos[a]) * scale, uy = (pos[b + 1] - pos[a + 1]) * scale, uz = (pos[b + 2] - pos[a + 2]) * scale;
    const vx = (pos[c] - pos[a]) * scale, vy = (pos[c + 1] - pos[a + 1]) * scale, vz = (pos[c + 2] - pos[a + 2]) * scale;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    for (let k = 0; k < 3; k++) {
      const o = (t + k) * 3;
      if (Math.abs(ny) > 0.7) { uv[(t + k) * 2] = 0.06; uv[(t + k) * 2 + 1] = 0.24; continue; }   // roof: a white texel
      const tl = Math.hypot(nx, nz) || 1, tx = -nz / tl, tz = nx / tl;
      const wx = pos[o] * scale + ox, wz = pos[o + 2] * scale + oz;
      uv[(t + k) * 2] = (wx * tx + wz * tz) / FW14_TILE[0];
      uv[(t + k) * 2 + 1] = (pos[o + 1] * scale) / FW14_TILE[1];
    }
  }
  return uv;
}
let _fw14Tex = null;
function fw14Tex() {
  if (!_fw14Tex && typeof document !== 'undefined') {
    _fw14Tex = new THREE.TextureLoader().load('textures/far_windows_fw14.png');
    _fw14Tex.wrapS = _fw14Tex.wrapT = THREE.RepeatWrapping;
    _fw14Tex.anisotropy = 8;
    _fw14Tex.name = 'far_windows_fw14';
  }
  return _fw14Tex;
}
// ==== /FW14
export function makeFarMaterial() {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: true });
  if (FW14) { const t = fw14Tex(); if (t) mat.map = t; }   // FW14: the window grid (see above)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.playerXZ = FAR_UNIFORMS.playerXZ;
    sh.uniforms.nearR = FAR_UNIFORMS.nearR;
    sh.uniforms.nearMask = FAR_UNIFORMS.nearMask; sh.uniforms.nearMaskO = FAR_UNIFORMS.nearMaskO; sh.uniforms.nearMaskOn = FAR_UNIFORMS.nearMaskOn;   // NM24
    sh.uniforms.night = ENV.night;
    sh.uniforms.wet = ENV.wet;
    sh.uniforms.snowA = ENV.snow;
    sh.uniforms.sunDirF = ENV.sunDir;
    sh.uniforms.sunColF = ENV.sunColor;
    sh.uniforms.skyAmbF = ENV.skyAmbient;
    skyReflUniforms(sh);
    sh.uniforms.cityAO = ENV.cityAO;
    sh.uniforms.cityAORect = ENV.cityAORect;
    sh.uniforms.cityAOAmt = ENV.cityAOAmt;
    sh.uniforms.uScale = { value: 1 / 8 };
    if (CP32R_MASK) sh.uniforms.cpFarPhoto = { value: cpFarPhoto() };
    sh.defines = sh.defines || {};
    if (!NO_TOWER_FX) sh.defines.TOWERFX = 1;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        uniform float uScale; varying vec3 vWPos;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = position * uScale;
        transformed.xz *= 0.996; transformed.y -= 0.6;`)
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec2 playerXZ; uniform float nearR; uniform float night;${NEARMASK_GLSL}${CP32R_MASK ? ' uniform sampler2D cpFarPhoto;' : ''}
        uniform float wet; uniform float snowA;
        uniform vec3 sunDirF; uniform vec3 sunColF; uniform vec3 skyAmbF;
        uniform sampler2D cityAO; uniform vec4 cityAORect; uniform float cityAOAmt;
        varying vec3 vWPos;${SKYREFL_PARS}
        ${HASH_GLSL}
        ${SKYREFL_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        if (farHidden(vWPos.xz)) discard;   // NM24: a ready near tile draws this ground
        diffuseColor.rgb *= diffuseColor.rgb; // sRGB bytes → approx linear
        ${CP32R_MASK ? `// CP32R: the park's ground from the aerial (level faces under 8 m only: not the walls in the rectangle's margin)
        {
          vec2 cq = vWPos.xz - vec2(447.2, 82.2);
          float cu = dot(cq, vec2(0.4848, -0.8746)), cv = dot(cq, vec2(0.8746, 0.4848));
          vec3 cN = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          if (abs(cu) < 2084.0 && abs(cv) < 451.0 && vWPos.y < 8.0 && abs(cN.y) > 0.9) {
            vec3 ph = texture2D(cpFarPhoto, vec2(cu / 4168.0 + 0.5, 0.5 - cv / 902.0)).rgb;
            diffuseColor.rgb = ph * ph * 1.35;
          }
        }` : ''}
        // LIT far macro (was flat unlit albedo = the "whole horizon looks
        // flat" root cause): flat-shaded facet normals from derivatives,
        // lambert sun + hemispheric sky — tracks time of day for free since
        // sunDir/sunColor/skyAmbient are the live ENV uniforms
        {
          vec3 N = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
          vec3 V = normalize(cameraPosition - vWPos);
          if (dot(N, V) < 0.0) N = -N;
          float ndl = max(dot(N, sunDirF), 0.0);
          float caoV = 1.0;
          if (cityAORect.z > 0.0) {
            vec2 caoS = texture2D(cityAO, (vWPos.xz - cityAORect.xy) * cityAORect.zw).rg;
            caoV = mix(1.0, mix(caoS.r, 1.0, smoothstep(6.0, 46.0, vWPos.y - caoS.g * 127.5)), cityAOAmt);
          }
          vec3 light = skyAmbF * (0.8 + 0.3 * max(N.y, 0.0)) * caoV + sunColF * ndl * 1.05;
          diffuseColor.rgb *= light;
          #ifdef TOWERFX
          // ===== SKYSCRAPER PASS (docs/notes/skyscrapers.md) =================
          // The far city was ONE flat colour per baked face, so a 200 m tower at
          // 2 km read as a coloured card and the whole horizon as one wall.
          // Three cheap terms give back exactly what distance preserves: the
          // floor rhythm, per-lot value variety, and a specular answer to the
          // sky (which is what separates a glass tower from a brick one when
          // nothing else is resolvable).
          float vertF = 1.0 - abs(N.y);
          if (vertF > 0.12) {
            float fb = vWPos.y / 3.8;                       // floor lines
            float aaFb = max(fwidth(fb), 1e-4);
            float bv = smoothstep(1.1, 0.28, aaFb) * vertF;  // box-filtered, so it
            diffuseColor.rgb *= mix(1.0, 0.80 + 0.30 * pcov(fb, 0.24, 0.96, aaFb * 1.25), bv * 0.7);
            // per-lot spread on a ~26 m cell: the macro palette repeats, and
            // without this neighbouring towers merge into one flat mass
            diffuseColor.rgb *= 0.85 + 0.30 * hash12(floor(vWPos.xz / 26.0) + 3.7);
            // ---- the far skyline answers the sky too (facades-r6 §1). The r5
            // term was skyAmbF * frF * ... with frF = 0.04 at normal
            // incidence, i.e. ~1.5 % of an already-dim ambient colour: nothing
            // in skyMidtown or skyFidi glinted. Same analytic gradient as
            // the near facades, so the handover at nearR does not step.
            vec3 Rf = reflect(-V, N);
            float glassy = smoothstep(0.0, 0.10, diffuseColor.b - diffuseColor.r * 0.9);
            float f0F = mix(0.05, 0.20, glassy);
            float frF = fresnelR(max(dot(V, N), 0.0), f0F);
            float fpF = length(fwidth(vWPos)) * 0.02;
            diffuseColor.rgb *= mix(1.0, mix(0.55, 0.30, glassy), glassy * 0.9); // far glass is DARK, not pastel
            diffuseColor.rgb += skyLook(Rf, sunDirF, sunColF, uZenC, uHorC, uRefl, 1.6)
                              * frF * vertF * (0.55 + 1.15 * glassy);
            diffuseColor.rgb += sunColF * sunDisc(Rf, sunDirF, mix(0.16, 0.06, glassy), fpF)
                              * frF * (6.0 + 16.0 * glassy) * uRefl * vertF * (1.0 - night);
          }
          // ---- distance silhouette. Measured (scratchpad patch.ps1) against
          // refs/water-tower-rooftops-chelsea-01.jpg, where FiDi at 3-5 km sits
          // at L 81-106 under an L 163 sky (50-65 % of it) with R-B -58..-96 —
          // it takes the SKY's own blue and stays much darker. Our far city
          // measured L 147-178 under an L 166 sky (89-107 %) at R-B +54..+64:
          // the same value as the sky and the opposite hue, i.e. no silhouette
          // at all. Most of that gap is the screen-space HazePass (78 % of a
          // 5 km pixel, docs/notes/lighting.md 1b) and is the lighting owner's,
          // but the far material can stop ADDING to it — vertical faces past
          // 2 km give up ambient and drift toward the sky hue, so there is
          // still a value break left for the haze to wash.
          {
            float aer = smoothstep(1800.0, 7000.0, distance(vWPos, cameraPosition)) * vertF;
            diffuseColor.rgb *= mix(1.0, 0.66, aer);
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.82, 0.95, 1.12), aer * 0.6);
          }
          // ================= END SKYSCRAPER PASS ============================
          #endif
        }
        diffuseColor.rgb *= (1.0 - night * 0.55);
        // weather continuity to the horizon: the near tiles' PBR wet/snow look
        // stops at nearR, so the unlit macro world must darken/whiten in step
        diffuseColor.rgb *= 1.0 - 0.3 * wet * (0.6 + 0.4 * vnoise(vWPos.xz * 0.031));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.8, 0.83, 0.88), snowA * (0.4 + 0.4 * vnoise(vWPos.xz * 0.06)));
        vec2 cell = floor(vec2(vWPos.x + vWPos.z * 0.7, vWPos.y) / 3.0);
        float sp = step(hash12(cell), vColor.a * 0.28) * night;
        diffuseColor.rgb += vec3(1.0, 0.82, 0.5) * sp * 1.1;
        diffuseColor.a = 1.0;
      }`);
  };
  return mat;
}

// ------------------------------------------------------------------ WATER (custom, fog-synced)
export function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: ENV,
    vertexShader: /* glsl */ `
      varying vec3 vWorld; varying float vDist;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mv = viewMatrix * wp;
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vWorld; varying float vDist;
      uniform float time; uniform float night;
      uniform vec3 fogColor; uniform float fogDensity;
      uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyAmbient; uniform float rv35;
      ${FOG_SKY_GLSL}
      ${HASH_GLSL}
      // three-octave animated height field; taps widen with distance so the
      // derivative normals self-antialias instead of shimmering at range
      ${WS36 ? `// WS36 (records lane, 2026-10-11): the octaves were VALUE noise on axis-aligned lattices. Its smoothstep blend
      // has zero slope across every lattice line, so each line drew a flat band in the normals and, at a grazing look
      // over open water (St. George from the harbour, the Narrows), the reflection laid those bands out as straight
      // streaks converging on the horizon. Gradient noise (quintic blend, random unit gradients) has no such lines,
      // each octave turns on its own axes so no two lattices line up, and the finest octave fades out where a pixel
      // spans it (its 2 m ripples aliased into the same streaks at range). ?ws36=0 restores the old field.
      vec2 wsG(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); float a = fract((p3.x + p3.y) * p3.z) * 6.2831853; return vec2(cos(a), sin(a)); }
      // WS37: a lattice point's gradient is hashed from its index wrapped to 0..1023. Hashed from the raw index (~5,000 for
      // the 2 m octave), the corner one cell reached as i + 1 and its neighbour reached as floor(p) could hash apart (the
      // hash magnifies the last bit of a large product), so two cells disagreed on their shared edge's gradients and the
      // 2 m octave drew such edges as thin bright seams converging on the horizon (the Seaport, Whitehall)
      float wsN(vec2 p) {
        vec2 i = floor(p), f = fract(p), u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
        vec2 i0 = mod(i, 1024.0), i1 = mod(i + 1.0, 1024.0);
        float a = dot(wsG(i0), f), b = dot(wsG(vec2(i1.x, i0.y)), f - vec2(1.0, 0.0));
        float c = dot(wsG(vec2(i0.x, i1.y)), f - vec2(0.0, 1.0)), d = dot(wsG(i1), f - vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 0.85 + 0.5;
      }
      float wsFine = 1.0;
      float wH(vec2 q) {
        const mat2 R1 = mat2(0.8090, 0.5878, -0.5878, 0.8090), R2 = mat2(0.2588, -0.9659, 0.9659, 0.2588), R3 = mat2(-0.5299, 0.8480, -0.8480, -0.5299);
        return wsN(R1 * q * 0.045 + vec2(time * 0.25, time * 0.17)) * 0.6
             + wsN(R2 * q * 0.14 - vec2(time * 0.14, time * 0.2)) * 0.3
             + wsN(R3 * q * 0.5 + vec2(time * 0.05, -time * 0.4)) * 0.1 * wsFine;
      }` : `float wsFine = 1.0;
      float wH(vec2 q) {
        return vnoise(q * 0.045 + vec2(time * 0.25, time * 0.17)) * 0.6
             + vnoise(q * 0.14 - vec2(time * 0.14, time * 0.2)) * 0.3
             + vnoise(q * 0.5 + vec2(time * 0.05, -time * 0.4)) * 0.1;
      }`}
      void main() {
        vec2 p = vWorld.xz;
        ${CP32R_MASK ? `if ${CP_PARK_IN('p')} discard;` : ''}
        // large-scale current patches: tidal rivers read as broad calm/ruffled
        // lanes from the air, never as one uniform tone
        float cur = fbm(p * 0.006 + vec2(time * 0.012, -time * 0.008));
        float amp = 0.7 + 0.9 * smoothstep(0.35, 0.75, cur);
        float e = max(0.35, vDist * 0.0045);
        ${WS36 ? `// the 2 m octave fades out once a pixel's footprint (along the view, which a grazing look stretches) spans ~1 m
        float wsFw = max(fwidth(p.x), fwidth(p.y));
        wsFine = 1.0 - smoothstep(0.25, 1.0, wsFw);` : ''}
        float hC = wH(p), hX = wH(p + vec2(e, 0.0)), hZ = wH(p + vec2(0.0, e));
        vec3 N = normalize(vec3((hC - hX) / e * 1.7 * amp, 1.0, (hC - hZ) / e * 1.7 * amp));
        vec3 V = normalize(cameraPosition - vWorld);
        // water body color varies with the current field (silt vs deep)
        vec3 deep = mix(vec3(0.04, 0.085, 0.1), vec3(0.085, 0.15, 0.165), hC);
        deep = mix(deep, vec3(0.075, 0.115, 0.105), smoothstep(0.55, 0.85, cur) * 0.6);
        deep = mix(deep, vec3(0.012, 0.028, 0.045), night);
        // sky reflection graded to the view: zenith color overhead, brighter
        // horizon color at grazing angles (sells reflection without a cubemap)
        vec3 horizonC = mix(fogColor * 1.18, sunColor * 0.35 + fogColor * 0.75, 0.35);
        // FS26: the reflected ray's own sky at the horizon (the sun side of a river glows, the far side stays cool)
        vec3 Rw = reflect(-V, N);
        horizonC = fogSkyP.x > 0.5 ? fogSkyColor(vec3(Rw.x, max(Rw.y, 0.0), Rw.z), horizonC) : horizonC;
        vec3 skyRef = mix(skyAmbient * 1.05, horizonC, pow(1.0 - max(V.y, 0.0), 2.0));
        skyRef *= (1.0 - night * 0.82);
        float fres = 0.05 + 0.95 * pow(1.0 - max(dot(N, V), 0.0), 3.2);
        // RV35 (day): a reflected ray under ~5 deg meets the far shore's walls, not open sky (a city river is walled by
        // buildings 1-2 km off), and water's F0 is ~0.02, not the 0.16 floor that mirrored the sky from every angle
        float rvK = rv35 * (1.0 - smoothstep(0.0, 0.05, night));
        float shore = (1.0 - smoothstep(0.012, 0.085, Rw.y)) * rvK;
        skyRef = mix(skyRef, horizonC * 0.42, shore * 0.8);
        // the East and Harlem Rivers are turbid tidal water: an olive-teal body (the aerial references read (54, 88, 92) off
        // Gantry Plaza), and the ripples blur and grey the sky they mirror
        deep = mix(deep, mix(vec3(0.028, 0.052, 0.046), vec3(0.055, 0.090, 0.078), hC), rvK);
        skyRef = mix(skyRef, vec3(dot(skyRef, vec3(0.2126, 0.7152, 0.0722))), 0.5 * rvK);
        // and water's own Fresnel (Schlick, F0 0.02): ~3 % of the sky from a 40 deg aerial, most of it at a grazing look
        float fresW = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
        vec3 col = mix(deep, skyRef, clamp(mix(0.16 + fres * 0.7, fresW, rvK), 0.0, 0.95));
        // sun streak: lobe widens with distance (a razor lobe vanishes from the
        // air), sparkle modulated by the ripple field, amp specular-AA faded
        float glExp = mix(620.0, 70.0, smoothstep(120.0, 2600.0, vDist));
        float glAmp = mix(0.9, 0.1, smoothstep(120.0, 2600.0, vDist));
        float glint = pow(max(dot(reflect(-sunDir, N), V), 0.0), glExp);
        glint *= 0.45 + 0.7 * vnoise(p * 1.7 + vec2(time * 0.9, -time * 0.7));
        col += sunColor * glint * glAmp * (1.0 - night);
        // city light streaks at night ride the ripples
        col += vec3(0.9, 0.6, 0.3) * night * fres * (hC * 0.7 + 0.3) * 0.1;
        float f = 1.0 - exp(-fogDensity * fogDensity * vDist * vDist);
        col = mix(col, fogSkyColor(vWorld - cameraPosition, fogColor), clamp(f, 0.0, 1.0));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}
