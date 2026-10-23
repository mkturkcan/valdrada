// VG36 (GROUND, docs/notes/ar35-veg.md; owner 2026-10-02: "improve trees and vegetation to a UE5 / Quixel / AAA level ...
// right now they look way too old gen"): grass blades over every lawn near the lens. `?vg36=0` leaves the ground as it was.
//
// A lawn was the ground mesh's grass section (matId 5, the campus underlay 15) under one photo set: from eye level a flat
// green texture, and inside Central Park a few hundred 12-blade clumps (CP33, cpFloraKit.js grassField) over it. Here:
//   * THE LAWN FIELD. The lawns round the lens are rendered from above into a 128 m float target (0.25 m texels): which
//     texels are open lawn (the top surface is a grass section, Central Park's woods, ball-field clay and courts taken out
//     through the CP32L ground mask), the lawn's height, and how much lawn surrounds each texel (the edge and wear term).
//     Re-captured when the lens has moved 8 m, when tiles come or go and when the park's mask lands; never inside a pass
//     (a one-shot scene.onBeforeRender, the fountain probes' way).
//   * THE BLADES. Three rings of 4 m patches round the lens, one draw each: within 8 m ~1,500 curved, tapered blades a square
//     metre (3 segments), to 25 m ~310 wider ones (2 segments), to 58 m ~60 broad ones (2 segments), each ring dissolving
//     into the next blade by blade and the last into the lawn's own texture. Which 4 m cells hold lawn is read once per
//     tile from the ground mesh (the CPU list the rings are filled from, frustum-culled per patch); every blade then asks
//     the field whether its root is lawn and how high it stands, so edges follow kerbs, paths and beds to ~0.1 m.
//   * THE LOOK. Height, density and colour vary with the ground: a mown sward (4.5-8 cm: upright cut blades, a thatch of
//     older leaves lying over the soil, a few long ones the mower missed) with tufts, thin, trodden and bare patches,
//     broad lusher and paler patches and white clover in patches; the ground shader's own dry patches drier and shorter
//     here too, sparser within a metre of a path or a kerb, a longer uncut fringe along the edges; colour from the blade's
//     root (dark, the sward's own shade) to its tip, per blade and per patch; the sun shining through a backlit blade.
//     Normals lean up so the sward shades as a surface, both faces alike. The lawn's floor under the blades:
//     world/vg36Ground.js.
//   * WIND. The blades bend with ENV.windT (frozen at dt = 0: bshot's settle and the film recorder stay deterministic):
//     a travelling gust field and a per-blade sway, scaled by ENV.windAmp.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { ENV, CP32L_GROUND, applyLightTrim, applyCityAO, applySnowCap } from './materials.js';
import { initPits36 } from './vg36Pits.js';
import { VEG_GROUND, vegGroundUpdate } from './vegP1.js';   // VEG P1 (terrain veg lane): no lawn blades on the woodland floor, dirt or rock

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams('');
export const VG36 = Q.get('vg36') !== '0';
const VGMALL = Q.get('vgmall') !== '0';   // `?vgmall=0`: the Mall's side lawns as before (no blades)
// live knobs for a measurement session (?vgd=<density x>, ?vgh=<height x>)
const DENS_X = Math.max(0.05, Math.min(3, Number(Q.get('vgd') || 1)));
const HGT_X = Math.max(0.2, Math.min(4, Number(Q.get('vgh') || 1)));

const CELL = 4;                    // the patch: a 4 m square
const FIELD_M = 128, FIELD_N = 512; // the lawn field: 128 m at 0.25 m
const RECENTRE = 8;                // re-capture when the lens has moved this far from the field's centre
// the rings: [inner fade from, inner fade to, outer fade from, outer fade to] (m), blades per patch, segments, blade width (m),
// blade height scale
const RINGS = [
  { fade: [-2, -1, 6, 8], blades: Math.round(24000 * DENS_X), rows: 3, width: 0.0064, hk: 1.0, cap: 40 },
  { fade: [6, 8, 22, 25], blades: Math.round(5000 * DENS_X), rows: 2, width: 0.0095, hk: 1.0, cap: 220 },
  { fade: [22, 25, 40, 58], blades: Math.round(1000 * DENS_X), rows: 2, width: 0.020, hk: 1.0, cap: 800 },
];
const R_MAX = RINGS[RINGS.length - 1].fade[3];

// ---------------------------------------------------------------- the patch geometry
const mulberry = (a) => () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// n blades on a stratified jittered grid over the patch; each blade `rows` segments (2 rows + 1 tip vertex). position =
// (root x, t along the blade, root z); aB = (side -1 / +1 / 0 at the tip, keep random, height random, shape random).
// the roots: best-candidate blue noise on the patch as a torus (each new root the farthest of 6 random tries from the roots
// already placed, wrapping at the patch's edges), so the patches tile without seams and no rows show at a grazing view (a
// jittered grid did: the lead's 06:15 review)
function blueNoise(n, rnd, k = 6) {
  const G = Math.max(1, Math.floor(Math.sqrt(n) / 1.5)), cs = CELL / G, grid = Array.from({ length: G * G }, () => []);
  const out = new Float32Array(n * 2), H = CELL / 2;
  const near = (x, z) => {
    const gi = Math.floor(x / cs), gj = Math.floor(z / cs);
    let best = cs * cs * 4;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const L = grid[((gi + di + G) % G) * G + ((gj + dj + G) % G)];
      for (let q = 0; q < L.length; q += 2) {
        let dx = Math.abs(L[q] - x), dz = Math.abs(L[q + 1] - z);
        if (dx > H) dx = CELL - dx;
        if (dz > H) dz = CELL - dz;
        const d = dx * dx + dz * dz;
        if (d < best) best = d;
      }
    }
    return best;
  };
  for (let i = 0; i < n; i++) {
    let bx = 0, bz = 0, bd = -1;
    for (let c = 0; c < (i ? k : 1); c++) {
      const x = rnd() * CELL, z = rnd() * CELL, d = near(x, z);
      if (d > bd) { bd = d; bx = x; bz = z; }
    }
    out[i * 2] = bx; out[i * 2 + 1] = bz;
    grid[Math.min(G - 1, Math.floor(bx / cs)) * G + Math.min(G - 1, Math.floor(bz / cs))].push(bx, bz);
  }
  return out;
}
function patchGeo(n, rows, seed) {
  const rnd = mulberry(seed);
  const roots = blueNoise(n, rnd);
  const vpb = 2 * rows + 1, tpb = 2 * rows - 1;
  const pos = new Float32Array(n * vpb * 3), ab = new Float32Array(n * vpb * 4);
  const idx = new Uint32Array(n * tpb * 3);
  let v = 0, e = 0;
  for (let b = 0; b < n; b++) {
    const x = roots[b * 2], z = roots[b * 2 + 1];
    const rk = (b + rnd()) / n;            // in placing order: the first roots spread the patch, so a thinned sward stays even
    const rh = rnd(), rs = rnd();
    const v0 = v;
    for (let k = 0; k <= rows; k++) {
      const t = k / rows;
      const sides = k < rows ? [-1, 1] : [0];
      for (const s of sides) {
        pos[v * 3] = x; pos[v * 3 + 1] = t; pos[v * 3 + 2] = z;
        ab[v * 4] = s; ab[v * 4 + 1] = rk; ab[v * 4 + 2] = rh; ab[v * 4 + 3] = rs;
        v++;
      }
    }
    for (let k = 0; k < rows - 1; k++) {
      const a = v0 + 2 * k;
      idx[e++] = a; idx[e++] = a + 1; idx[e++] = a + 2;
      idx[e++] = a + 1; idx[e++] = a + 3; idx[e++] = a + 2;
    }
    const a = v0 + 2 * (rows - 1);
    idx[e++] = a; idx[e++] = a + 1; idx[e++] = v0 + 2 * rows;
  }
  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aB', new THREE.BufferAttribute(ab, 4));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

// ---------------------------------------------------------------- GLSL
const NOISE = /* glsl */ `
  float vgH12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vgN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vgH12(i), vgH12(i + vec2(1, 0)), f.x), mix(vgH12(i + vec2(0, 1)), vgH12(i + vec2(1, 1)), f.x), f.y); }
  float vgFbm(vec2 p) { return vgN(p) * 0.6 + vgN(p * 2.7) * 0.25 + vgN(p * 7.1) * 0.15; }
`;
const BLADE_VS = /* glsl */ `
  attribute vec4 aB;
  attribute vec2 aP;
  uniform sampler2D vgField;
  uniform vec4 vgRect;      // field x0, z0, 1 / size, base y
  uniform vec3 vgCam;
  uniform vec4 vgRing;      // the ring's fades (m)
  uniform vec4 vgShape;     // blade width, height scale, ring index, density x
  uniform float windT, windAmp;
  varying float vVgT;
  varying float vVgTr;
  ${NOISE}
  void vgBlade(out vec3 P, out vec3 N, out vec3 C) {
    // the patch's layout turned / mirrored by its own hash (no 4 m repeat), the blade's randoms re-hashed per patch
    float ph = vgH12(aP * 0.25 + 17.3);
    vec2 lp = position.xz;
    float sym = floor(ph * 8.0);
    if (mod(sym, 2.0) > 0.5) lp.x = ${CELL.toFixed(1)} - lp.x;
    if (mod(floor(sym * 0.5), 2.0) > 0.5) lp.y = ${CELL.toFixed(1)} - lp.y;
    if (sym > 3.5) lp = lp.yx;
    vec2 root = aP + lp;
    float t = position.y, side = aB.x;
    float rk = aB.y;
    float rh = fract(aB.z + ph * 7.13), rs = fract(aB.w + ph * 3.71);
    // the field: x lawn cover, y lawn height (over the base), z lawn round it (1 deep in the lawn, ~0.5 at an edge)
    vec2 fuv = (root - vgRect.xy) * vgRect.z;
    vec4 F = texture2D(vgField, fuv);
    float inF = step(0.002, fuv.x) * step(fuv.x, 0.998) * step(0.002, fuv.y) * step(fuv.y, 0.998);
    float cover = smoothstep(0.42, 0.62, F.x) * inF;
    float edge = clamp(F.z, 0.0, 1.0);
    float d = length(root - vgCam.xz);
    // the ground's own fields: the lawn shader's dry patches (world/materials.js m == 5: fbm(p * 0.055 + 17) over 0.58-0.82),
    // broad thick / thin swathes, tufts, trodden and bare spots
    float dry = smoothstep(0.58, 0.82, vgFbm(root * 0.055 + 17.0));
    float swath = vgFbm(root * 0.09 + 3.0);
    float tuft = vgN(root * 1.9 + 11.0);
    float bare = smoothstep(0.70, 0.86, vgFbm(root * 0.31 + 41.0)) * 0.85;
    float dens = clamp(0.84 + 0.45 * (swath - 0.5) - 0.3 * dry - 0.8 * bare, 0.0, 1.0);
    dens *= mix(0.30, 1.0, smoothstep(0.30, 0.80, edge));      // trodden within a metre of a path or a kerb
    dens *= vgShape.w;
    // the ring's share of the blades, dissolving blade by blade (each grows from nothing past its own threshold)
    float share = smoothstep(vgRing.x, vgRing.y, d) * (1.0 - smoothstep(vgRing.z, vgRing.w, d));
    float keep = share * dens;
    float grow = smoothstep(rk, rk + 0.12, keep);
    // three kinds of blade: upright mown leaves (60 %), the thatch of older leaves lying over the soil (30 %), long ones
    // the mower missed (10 %)
    float kind = fract(rs * 5.17 + rh * 0.31);
    float lying = step(0.52, kind) * step(kind, 0.92), longB = step(0.92, kind);
    // white clover in patches (1-4 m, ~12 % of a lawn): there most blades are its leaflets, broad, rounded and lying flat
    float clov = smoothstep(0.64, 0.76, vgFbm(root * 0.42 + 23.0)) * step(0.3, fract(rh * 5.3 + rs * 2.1));
    // height: a mown sward 4.5-8 cm, tufts to ~13 cm, the dry patches shorter, an uncut fringe at the edges; broad patches
    // (10-30 m) a little longer and lusher or shorter and paler: the mower's passes and the lawn's wetter and drier ground
    float lush = vgFbm(root * 0.035 + 61.0);
    float h = (0.045 + 0.03 * rh) * (0.9 + 0.3 * swath) * (0.85 + 0.35 * lush) * mix(1.0, 0.85, lying) * mix(1.0, 1.7, longB);
    h *= 1.0 + 0.6 * smoothstep(0.72, 0.95, tuft) * step(0.55, rs);
    h *= 1.0 - 0.35 * dry;
    h *= 1.0 + 0.7 * (1.0 - smoothstep(0.55, 0.85, edge)) * step(0.35, rs) * step(0.5, edge + 0.3);
    h = mix(h, 0.028 + 0.022 * rh, clov);
    h *= vgShape.y * grow * cover;
    // the blade's frame: it faces yaw, leans and bends toward its face, twists a little
    float yaw = rs * 6.2832 + rh * 2.1;
    vec2 fd = vec2(cos(yaw), sin(yaw));
    float bend = mix(mix(0.35 + 0.75 * fract(rs * 7.31 + rh), 1.5 + 0.7 * fract(rs * 3.9 + rh * 2.3), lying), 1.9 + 0.4 * rs, clov);
    // wind: a travelling gust field and a per-blade sway (ENV.windT, ENV.windAmp)
    vec2 wd = normalize(vec2(0.86, 0.5));
    float gust = vgN(root * 0.07 - wd * windT * 0.9) * 1.2 + vgN(root * 0.23 - wd * windT * 2.1) * 0.5;
    float sway = sin(windT * (1.9 + 0.8 * rh) + dot(root, vec2(0.61, 0.37)) * 1.7 + rs * 6.28) * 0.35;
    vec2 wv = wd * (gust * 0.6 + sway) * windAmp * 0.9 + fd * bend;
    float wl = length(wv);
    // the centreline: height along t, bent by wv over t^2 (the arc keeps its length roughly)
    float t2 = t * t;
    vec3 c = vec3(root.x, F.y + vgRect.w - 0.015, root.y);
    c.xz += wv * h * t2 * 0.8;
    c.y += h * (t - 0.3 * min(wl, 2.2) * t2);
    // width: tapering to the tip
    // width: a mown blade is cut square (60 % of its width at the top), an uncut one tapers to a point
    float w = vgShape.x * (0.75 + 0.5 * fract(rh * 13.7)) * mix(1.0, 1.4, lying) * (1.0 - pow(t, 1.6) * mix(0.42, 0.92, max(longB, step(0.75, fract(rh * 9.1)))));
    w = mix(w, vgShape.x * 2.6 * (0.75 + 0.5 * sin(3.1416 * clamp(t * 0.85 + 0.15, 0.0, 1.0))), clov);
    float tw = (rs - 0.5) * 1.2 * t;
    vec2 wa = vec2(-fd.y, fd.x);
    wa = vec2(wa.x * cos(tw) - wa.y * sin(tw), wa.x * sin(tw) + wa.y * cos(tw));
    P = c + vec3(wa.x, 0.0, wa.y) * (side * 0.5 * w);
    // collapsed blades (no lawn, not this ring's, not kept) stay a point under the ground
    if (h < 0.004) P = vec3(root.x, F.y + vgRect.w - 0.3, root.y);
    // the normal: the blade's face, turned to the lens, leaned up hard (the sward shades as a surface)
    vec3 tang = normalize(vec3(wv * h * t * 1.6, h * (1.0 - 0.6 * min(wl, 2.2) * t)).xzy + vec3(0.0, 1e-4, 0.0));
    vec3 bn = normalize(cross(vec3(wa.x, 0.0, wa.y), tang));
    if (dot(bn, vgCam - P) < 0.0) bn = -bn;
    N = normalize(bn * 0.42 + vec3(0.0, 1.0, 0.0));
    // colour (linear, before the city's light trim): the sward's shade at the root, the blade's green to the tip; per blade
    // value and hue, broad patches greener or yellower, the dry patches straw
    // (session 2: lighter and less saturated; the t4Sheep key read as a deep green carpet, lower half luma 67 against 103 without)
    vec3 gTip = mix(vec3(0.190, 0.345, 0.072), vec3(0.245, 0.410, 0.088), rh);   // (07:27: x1.1, a little yellower: p4 t4Sheep lower half 72 against 105 off)
    // (session 3, 08:31: the sunny Sheep Meadow photographs' near lawn is luma 100-106, saturation 0.43-0.64, R/G 0.53-0.83; the
    // b11 plates 78 / 0.60 / 0.77: x1.45, a little less red and more blue; ar35-veg.md lists the photographs)
    gTip *= vec3(1.33, 1.45, 1.62);
    gTip = mix(gTip, vec3(0.270, 0.300, 0.105), 0.55 * dry + 0.25 * smoothstep(0.6, 0.9, vgN(root * 0.6 + 5.0)) * rs);
    gTip = mix(gTip, gTip * vec3(1.05, 0.82, 0.75), 0.6 * lying);   // the older leaves duller
    gTip *= mix(vec3(1.12, 1.04, 1.25), vec3(0.88, 0.97, 0.80), lush);   // the paler and the lusher patches
    gTip *= 0.82 + 0.36 * fract(rs * 3.17 + rh * 1.3);
    gTip = mix(gTip, vec3(0.085, 0.215, 0.075) * 1.45 * (0.8 + 0.4 * rs), clov);   // clover: a bluer, deeper green
    vec3 gRoot = gTip * vec3(0.56, 0.6, 0.5);
    C = mix(gRoot, gTip, smoothstep(0.0, 0.85, t));
    vVgT = t;
    vVgTr = 0.55 + 0.45 * (1.0 - dry);
  }
`;

let _mats = null;
function bladeMats(field) {
  if (_mats) return _mats;
  const mk = (ring) => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.68, metalness: 0, side: THREE.DoubleSide });
    m.name = 'vg36:grass' + ring;
    const U = {
      vgField: { value: field.tex }, vgRect: field.rect, vgCam: { value: new THREE.Vector3(0, -1e5, 0) },
      vgRing: { value: new THREE.Vector4(...RINGS[ring].fade) },
      vgShape: { value: new THREE.Vector4(RINGS[ring].width, RINGS[ring].hk * HGT_X, ring, 1) },
    };
    m.userData.vg = U;
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, U);
      sh.uniforms.windT = ENV.windT; sh.uniforms.windAmp = ENV.windAmp;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\n' + BLADE_VS)
        .replace('#include <color_vertex>', 'vec3 vgP, vgNo, vgC; vgBlade(vgP, vgNo, vgC);\n  vColor = vec4(vgC, 1.0);')
        .replace('#include <beginnormal_vertex>', 'vec3 objectNormal = vgNo;')
        .replace('#include <begin_vertex>', 'vec3 transformed = vgP;');
      let lf = THREE.ShaderChunk.lights_fragment_begin;
      const a0 = lf.indexOf('directionalLight = directionalLights[ i ];');
      const re = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
      const a1 = a0 >= 0 ? lf.indexOf(re, a0) : -1;
      let trans = false;
      if (a1 >= 0) {
        // the sun through a backlit blade: the directional lights' shadowed colour, strongest looking into the sun
        lf = lf.slice(0, a1 + re.length) + '\n\t\tvgTr += directLight.color * ( 0.25 + 0.75 * pow( saturate( dot( - geometryViewDir, directLight.direction ) ), 3.0 ) );' + lf.slice(a1 + re.length);
        trans = true;
      }
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vVgT;\nvarying float vVgTr;')
        // both faces lit alike (the normal already faces the lens and leans up)
        .replace('#include <normal_fragment_begin>', '#include <normal_fragment_begin>\n#ifdef DOUBLE_SIDED\n  normal *= faceDirection;\n#endif')
        .replace('#include <lights_fragment_begin>', trans ? 'vec3 vgTr = vec3( 0.0 );\n' + lf + '\nreflectedLight.directDiffuse += vgTr * diffuseColor.rgb * ( 0.55 * vVgTr * smoothstep( 0.05, 0.8, vVgT ) );' : '#include <lights_fragment_begin>');
    };
    m.customProgramCacheKey = () => 'vg36grass1';
    return applyLightTrim(applyCityAO(applySnowCap(m)), 1.0);
  };
  _mats = RINGS.map((_, i) => mk(i));
  return _mats;
}

// ---------------------------------------------------------------- the lawn field
const CAP_VS = /* glsl */ `
  attribute float matId;
  uniform vec4 vgRect;       // x0, z0, 1 / size, base y
  varying float vY, vM;
  varying vec2 vXZ;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vY = wp.y; vM = matId; vXZ = wp.xz;
    vec2 uv = (wp.xz - vgRect.xy) * vgRect.z;
    // the top surface wins: higher y = nearer (clip z -1 at base + 200 m, +1 at base - 200 m)
    gl_Position = vec4(uv * 2.0 - 1.0, clamp(-(wp.y - vgRect.w) / 200.0, -1.0, 1.0), 1.0);
  }
`;
const CAP_FS = /* glsl */ `
  uniform vec4 vgRect;
  uniform sampler2D cp32lMask; uniform vec4 cp32lRect; uniform float cp32lOn;
  uniform sampler2D vegMask; uniform vec4 vegRect; uniform float vegOn;
  varying float vY, vM;
  varying vec2 vXZ;
  ${NOISE}
  void main() {
    // the Mall's side lawns (session 2): the compiled ground there is the terrain (matId 7) under CP32L's woodland mask (the
    // elms' canopy), but they are fenced lawns under the elms: grass between the walk and the outer rows (city/cpMall.js axis)
    vec2 vgMq = vXZ - vec2(-110.0, 1455.0);
    float vgMs = dot(vgMq, vec2(0.2756, -0.9613)), vgMr = abs(dot(vgMq, vec2(0.9613, 0.2756)));
    float vgMall = ${VGMALL ? '1.0' : '0.0'} * step(5.0, vgMs) * step(vgMs, 425.0) * step(4.5, vgMr) * step(vgMr, 30.0);
    float lawn = (abs(vM - 5.0) < 0.5 || abs(vM - 15.0) < 0.5 || (vgMall > 0.5 && abs(vM - 7.0) < 0.5)) ? 1.0 : 0.0;
    if (lawn > 0.5 && cp32lOn > 0.5 && vgMall < 0.5) {
      // Central Park's ground cover (world/materials.js CP32L, the same ragged edge): no lawn grass in the woods, on the
      // ball fields' clay or on the courts; the wet banks keep it
      vec2 cpJ = (vec2(vgN(vXZ * 0.19 + 3.1), vgN(vXZ * 0.19 + 8.7)) - 0.5) * 3.0;
      vec2 cpUV = (vXZ + cpJ - cp32lRect.xy) * cp32lRect.zw;
      if (cpUV.x > 0.0 && cpUV.y > 0.0 && cpUV.x < 1.0 && cpUV.y < 1.0) {
        vec4 cpM = texture2D(cp32lMask, cpUV);
        lawn *= (1.0 - smoothstep(0.15, 0.85, cpM.r)) * (1.0 - smoothstep(0.2, 0.8, cpM.g)) * (1.0 - smoothstep(0.3, 0.7, cpM.b));
      }
    }
    if (lawn > 0.5 && vegOn > 0.5) {
      // VEG P1 (world/vegP1.js VEG_GROUND): the parks' cover from the land cover and the LiDAR: no mown blades on the
      // woodland floor (3), bare soil and dirt paths (4) or rock (5); the meadows (2) keep a thinner sward under their tufts
      vec2 vgJ = (vec2(vgN(vXZ * 0.23 + 1.7), vgN(vXZ * 0.23 + 6.1)) - 0.5) * 1.6;
      vec2 vgUV = (vXZ + vgJ - vegRect.xy) * vegRect.zw;
      if (vgUV.x > 0.0 && vgUV.y > 0.0 && vgUV.x < 1.0 && vgUV.y < 1.0) {
        float vgC = floor(texture2D(vegMask, vgUV).r * 255.0 + 0.5);
        // (TERRAIN GRADE: a mapped lawn takes the raster's woodland, soil or rock only where that ground is the majority
        // round it, 8 taps out to 8 m: scattered pixels in a lawn never mottle it)
        float vgNat = (vgC > 2.5 && vgC < 5.5) ? 1.0 : 0.0;
        for (int q = 0; q < 8; q++) {
          float an = float(q) * 0.785398, rr = 4.0 + 4.0 * fract(float(q) * 0.618);
          float cq = floor(texture2D(vegMask, vgUV + vec2(cos(an), sin(an)) * rr * vegRect.zw).r * 255.0 + 0.5);
          if (cq > 2.5 && cq < 5.5) vgNat += 1.0;
        }
        if (vgNat < 5.0) vgC = 1.0;
        if (vgC > 2.5 && vgC < 5.5) lawn = 0.0;
        else if (vgC > 1.5 && vgC < 2.5) lawn *= 0.6;
      }
    }
    gl_FragColor = vec4(lawn, vY - vgRect.w, 1.0, vM / 32.0);
  }
`;
// raw -> field: x the lawn cover, y the lawn's height (a texel off the lawn takes its lawn neighbours' lowest, so a blade at
// a kerb never climbs it), z the lawn round it (mean over 0.5 and 1 m rings), w covered
const PROC_FS = /* glsl */ `
  uniform sampler2D tRaw;
  varying vec2 vUv;
  void main() {
    ivec2 sz = textureSize(tRaw, 0);
    ivec2 ij = ivec2(vUv * vec2(sz));
    vec4 c = texelFetch(tRaw, ij, 0);
    float y = c.y, best = 1e9, sum = 0.0, n = 0.0;
    for (int k = 0; k < 16; k++) {
      float a = float(k) * 0.7854 + (k >= 8 ? 0.3927 : 0.0);
      float r = k >= 8 ? 4.0 : 2.0;
      ivec2 q = clamp(ij + ivec2(round(vec2(cos(a), sin(a)) * r)), ivec2(0), sz - 1);
      vec4 s = texelFetch(tRaw, q, 0);
      sum += s.x; n += 1.0;
      if (s.x > 0.5 && k < 8) best = min(best, s.y);
    }
    for (int k = 0; k < 4; k++) {
      ivec2 q = clamp(ij + ivec2(k == 0 ? 1 : k == 1 ? -1 : 0, k == 2 ? 1 : k == 3 ? -1 : 0), ivec2(0), sz - 1);
      vec4 s = texelFetch(tRaw, q, 0);
      if (s.x > 0.5) best = min(best, s.y);
    }
    if (c.x < 0.5 && best < 1e8) y = best;
    gl_FragColor = vec4(c.x, y, sum / n, c.z);
  }
`;
class LawnField {
  constructor() {
    const opt = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true, generateMipmaps: false };
    this.raw = new THREE.WebGLRenderTarget(FIELD_N, FIELD_N, { ...opt, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.out = new THREE.WebGLRenderTarget(FIELD_N, FIELD_N, { ...opt, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.tex = this.out.texture;
    this.rect = { value: new THREE.Vector4(0, 0, 1 / FIELD_M, 0) };   // shared with the blade materials (the field's live rect)
    this.capRect = { value: new THREE.Vector4(0, 0, 1 / FIELD_M, 0) };
    this.capMat = new THREE.ShaderMaterial({
      uniforms: { vgRect: this.capRect, cp32lMask: CP32L_GROUND.mask, cp32lRect: CP32L_GROUND.rect, cp32lOn: CP32L_GROUND.on,
        vegMask: VEG_GROUND.mask, vegRect: VEG_GROUND.rect, vegOn: VEG_GROUND.on },
      vertexShader: CAP_VS, fragmentShader: CAP_FS, side: THREE.DoubleSide,
    });
    this.scene = new THREE.Scene();
    this.scene.matrixWorldAutoUpdate = false;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.proc = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tRaw: { value: this.raw.texture } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: PROC_FS, depthTest: false, depthWrite: false,
    }));
    this.proxies = new Map();   // tile key -> proxy mesh
    this.cx = 1e9; this.cz = 1e9; this.n = 0; this.ok = false;
  }
  add(key, mesh) {
    const p = new THREE.Mesh(mesh.geometry, this.capMat);
    p.matrixAutoUpdate = false; p.matrix.copy(mesh.matrixWorld); p.matrixWorld.copy(mesh.matrixWorld);
    p.frustumCulled = false;
    if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
    p.userData.bs = mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
    this.proxies.set(key, p);
    this.scene.add(p);
  }
  remove(key) { const p = this.proxies.get(key); if (p) { this.scene.remove(p); this.proxies.delete(key); } }
  // render the lawns round (cx, cz) into the field
  capture(r, cx, cz, baseY) {
    const x0 = cx - FIELD_M / 2, z0 = cz - FIELD_M / 2;
    this.capRect.value.set(x0, z0, 1 / FIELD_M, baseY);
    for (const p of this.proxies.values()) {
      const s = p.userData.bs, dx = Math.max(0, Math.abs(s.center.x - cx) - FIELD_M / 2), dz = Math.max(0, Math.abs(s.center.z - cz) - FIELD_M / 2);
      p.visible = dx * dx + dz * dz < s.radius * s.radius;
    }
    const rt0 = r.getRenderTarget(), f0 = r.getActiveCubeFace(), m0 = r.getActiveMipmapLevel();
    const xr = r.xr.enabled, sh = r.shadowMap.autoUpdate, ac = r.autoClear;
    const cc = r.getClearColor(new THREE.Color()), ca = r.getClearAlpha();
    try {
      r.xr.enabled = false; r.shadowMap.autoUpdate = false; r.autoClear = false;
      r.setClearColor(0x000000, 0);
      r.setRenderTarget(this.raw);
      r.clear(true, true, false);
      r.render(this.scene, this.cam);
      r.setRenderTarget(this.out);
      r.clear(true, false, false);
      this.proc.render(r);
    } finally {
      r.setRenderTarget(rt0, f0, m0);
      r.xr.enabled = xr; r.shadowMap.autoUpdate = sh; r.autoClear = ac;
      r.setClearColor(cc, ca);
    }
    this.rect.value.set(x0, z0, 1 / FIELD_M, baseY);
    this.cx = cx; this.cz = cz; this.n++; this.ok = true;
  }
}

// ---------------------------------------------------------------- the lawn cells (CPU): which 4 m cells hold lawn
// the Mall's side lawns (as CAP_FS): terrain cells between the walk and the outer elm rows count as lawn
const inMall = (x, z) => { if (!VGMALL) return false; const qx = x + 110, qz = z - 1455, s = qx * 0.2756 - qz * 0.9613, r = Math.abs(qx * 0.9613 + qz * 0.2756); return s >= 5 && s <= 425 && r >= 4.5 && r <= 30; };
const cellKey = (i, j) => (i + 32768) * 65536 + (j + 32768);
function scanGround(mesh) {
  const g = mesh.geometry, P = g.getAttribute('position'), M = g.getAttribute('matId');
  if (!P || !M || g.index) return new Map();
  const p = P.array, m = M.array, out = new Map();
  const e = mesh.matrixWorld.elements, ox = e[12], oy = e[13], oz = e[14];
  for (let v = 0; v + 2 < M.count; v += 3) {
    const k = m[v];
    const a = v * 3, b = a + 3, c = a + 6;
    if (k !== 5 && k !== 15 && !(k === 7 && inMall((p[a] + p[b] + p[c]) / 3 + ox, (p[a + 2] + p[b + 2] + p[c + 2]) / 3 + oz))) continue;
    const x0 = Math.min(p[a], p[b], p[c]) + ox, x1 = Math.max(p[a], p[b], p[c]) + ox;
    const z0 = Math.min(p[a + 2], p[b + 2], p[c + 2]) + oz, z1 = Math.max(p[a + 2], p[b + 2], p[c + 2]) + oz;
    const y0 = Math.min(p[a + 1], p[b + 1], p[c + 1]) + oy, y1 = Math.max(p[a + 1], p[b + 1], p[c + 1]) + oy;
    const i0 = Math.floor(x0 / CELL), i1 = Math.floor(x1 / CELL), j0 = Math.floor(z0 / CELL), j1 = Math.floor(z1 / CELL);
    // a big triangle marks only the cells its area reaches (centre within the cell's half-diagonal of the triangle)
    const big = (i1 - i0 + 1) * (j1 - j0 + 1) > 4;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      if (big && !nearTri((i + 0.5) * CELL, (j + 0.5) * CELL, p[a] + ox, p[a + 2] + oz, p[b] + ox, p[b + 2] + oz, p[c] + ox, p[c + 2] + oz, CELL * 0.71)) continue;
      const key = cellKey(i, j);
      const o = out.get(key);
      if (o) { if (y0 < o[0]) o[0] = y0; if (y1 > o[1]) o[1] = y1; } else out.set(key, [y0, y1]);
    }
  }
  return out;
}
function nearTri(px, pz, ax, az, bx, bz, cx, cz, r) {
  const s1 = (bx - ax) * (pz - az) - (bz - az) * (px - ax), s2 = (cx - bx) * (pz - bz) - (cz - bz) * (px - bx), s3 = (ax - cx) * (pz - cz) - (az - cz) * (px - cx);
  if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return true;
  const seg = (x0, z0, x1, z1) => { const dx = x1 - x0, dz = z1 - z0, t = Math.max(0, Math.min(1, ((px - x0) * dx + (pz - z0) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(px - x0 - t * dx, pz - z0 - t * dz); };
  return Math.min(seg(ax, az, bx, bz), seg(bx, bz, cx, cz), seg(cx, cz, ax, az)) < r;
}

// ---------------------------------------------------------------- the system
export function initVeg36(engine, streamer) {
  if (!VG36 || !engine || !streamer) return null;
  const scene = engine.scene, camera = engine.camera;
  const field = new LawnField();
  const mats = bladeMats(field);
  const cells = new Map();          // cell key -> [y0, y1]
  const tileCells = new Map();      // tile key -> [cell keys]
  const groundMat = () => streamer.ctx && streamer.ctx.groundMat;
  let dirty = true, lastCap = -100, frame = 0, maskSeen = CP32L_GROUND.mask.value, warned = 0;
  const stats = { cells: 0, patches: [0, 0, 0], captures: 0, ms: 0, tris: 0 };
  const warn = (e) => { if (warned++ < 3) console.warn('[vg36]', e); };
  streamer.onTile((key, data) => {
    try {
      // Central Park's CP33 clumps (city/cpFlora.js grassField) give way to the blades
      if (data && data.group) data.group.traverse((o) => { if (o.name === 'cp33:grass') o.visible = false; });
      const gm = groundMat(), ch = (data && data.group && data.group.children) || [];
      const mesh = (gm && ch.find((o) => o.isMesh && o.material === gm)) || ch.find((o) => o.isMesh && o.geometry?.getAttribute?.('matId'));
      if (!mesh) return;
      mesh.updateMatrixWorld(true);
      const c = scanGround(mesh);
      mesh.geometry.userData.lawnScanned = true;   // SPACE r2 (world/cpuFree.js, ?lowmem=1): the ground's arrays may go now
      for (const [k, v] of c) cells.set(k, v);
      tileCells.set(key, [...c.keys()]);
      field.add(key, mesh);
      dirty = true;
    } catch (e) { warn(e); }
  }, (key) => {
    try {
      const ks = tileCells.get(key);
      if (ks) for (const k of ks) cells.delete(k);
      tileCells.delete(key);
      field.remove(key);
      dirty = true;
    } catch (e) { warn(e); }
  });
  // the rings
  const G = new THREE.Group();
  G.name = 'vg36:grass';
  const rings = RINGS.map((R, i) => {
    const geo = patchGeo(R.blades, R.rows, 9001 + i * 131);
    const buf = new Float32Array(R.cap * 2);
    const attr = new THREE.InstancedBufferAttribute(buf, 2);
    attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aP', attr);
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R_MAX + 10);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(-1e5, -1e3, -1e5), new THREE.Vector3(1e5, 1e3, 1e5));
    const mesh = new THREE.Mesh(geo, mats[i]);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true;
    mesh.name = 'vg36:ring' + i;
    mesh.visible = false;
    G.add(mesh);
    return { R, geo, attr, buf, mesh, tris: (2 * R.rows - 1) * R.blades };
  });
  scene.add(G);
  const _fr = new THREE.Frustum(), _m = new THREE.Matrix4(), _s = new THREE.Sphere(), _v = new THREE.Vector3();
  const update = (r, cam) => {
    const t0 = performance.now();
    frame++;
    const cx = cam.position.x, cz = cam.position.z;
    if (CP32L_GROUND.mask.value !== maskSeen) { maskSeen = CP32L_GROUND.mask.value; dirty = true; }
    try { if (vegGroundUpdate(cx, cz)) dirty = true; } catch (e) { /* the veg lane's mask is optional */ }
    // the lens's ground: the field's base height
    const gy = streamer.terrainAt ? streamer.terrainAt(cx, cz) : null;
    const far = (cx - field.cx) ** 2 + (cz - field.cz) ** 2 > RECENTRE * RECENTRE;
    const high = cam.position.y - (gy ?? 0) > 120;
    if (!high && (far || (dirty && frame - lastCap >= 10))) {
      const sx = Math.round(cx / 4) * 4, sz = Math.round(cz / 4) * 4;
      field.capture(r, sx, sz, gy !== null && isFinite(gy) ? gy : cam.position.y - 2);
      dirty = false; lastCap = frame; stats.captures++;
    }
    // the patches in reach, per ring, frustum-culled
    _m.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _fr.setFromProjectionMatrix(_m);
    const n = [0, 0, 0];
    if (!high && field.ok) {
      const i0 = Math.floor((cx - R_MAX - CELL) / CELL), i1 = Math.floor((cx + R_MAX + CELL) / CELL);
      const j0 = Math.floor((cz - R_MAX - CELL) / CELL), j1 = Math.floor((cz + R_MAX + CELL) / CELL);
      const fx0 = field.cx - FIELD_M / 2, fz0 = field.cz - FIELD_M / 2;
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const c = cells.get(cellKey(i, j));
        if (!c) continue;
        const x = i * CELL, z = j * CELL;
        if (x + CELL < fx0 || z + CELL < fz0 || x > fx0 + FIELD_M || z > fz0 + FIELD_M) continue;
        const d = Math.hypot(x + CELL / 2 - cx, z + CELL / 2 - cz), rr = CELL * 0.7072;
        _s.center.set(x + CELL / 2, (c[0] + c[1]) / 2 + 0.1, z + CELL / 2);
        _s.radius = rr + (c[1] - c[0]) / 2 + 0.4;
        if (!_fr.intersectsSphere(_s)) continue;
        for (let k = 0; k < rings.length; k++) {
          const F = rings[k].R.fade;
          if (d + rr < F[0] || d - rr > F[3]) continue;
          if (n[k] >= rings[k].R.cap) continue;
          rings[k].buf[n[k] * 2] = x; rings[k].buf[n[k] * 2 + 1] = z;
          n[k]++;
        }
      }
    }
    let tris = 0;
    for (let k = 0; k < rings.length; k++) {
      const q = rings[k];
      q.geo.instanceCount = n[k];
      q.mesh.visible = n[k] > 0;
      if (n[k]) { q.attr.clearUpdateRanges(); q.attr.addUpdateRange(0, n[k] * 2); q.attr.needsUpdate = true; }
      q.geo.boundingSphere.center.set(cx, cam.position.y, cz);
      mats[k].userData.vg.vgCam.value.copy(cam.position);
      tris += n[k] * q.tris;
    }
    stats.cells = cells.size; stats.patches = n; stats.tris = tris;
    stats.ms = +(performance.now() - t0).toFixed(2);
  };
  // the per-frame hook: a one-shot scene.onBeforeRender armed from the rings' trigger, so the field capture and the
  // patch lists run before the next render of the scene starts (never nested inside a pass). Another part's one-shot may
  // sit under ours in the chain and restores what it saved when it runs, so ours re-arms only AFTER the chain below has run
  // (a cube probe's render first, then the view's); and if the trigger fires for a few frames without an update (a chain
  // dropped by someone else), it arms afresh.
  let armed = false, trigN = 0, updN = 0;
  const arm = () => {
    if (armed) return;
    armed = true;
    const orig = scene.onBeforeRender;
    scene.onBeforeRender = function (r, s, c, rt) {
      scene.onBeforeRender = orig;
      armed = false;
      const main = c === camera || (c && c.isPerspectiveCamera && c === engine.camera);
      if (main) { updN = trigN; try { update(r, c); } catch (e) { warn(e); } }
      orig.call(this, r, s, c, rt);
      if (!main) arm();
    };
  };
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const trig = new THREE.Mesh(sg, new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
  trig.frustumCulled = false; trig.name = 'vg36:trigger'; trig.renderOrder = -1000;
  trig.onBeforeRender = (r, s, cam) => {
    if (cam !== camera) return;
    trigN++;
    if (armed && trigN - updN > 3) armed = false;   // our one-shot was dropped: arm a new one
    arm();
  };
  G.add(trig);
  arm();
  const api = {
    stats, field, cells, group: G,
    set visible(v) { G.visible = !!v; }, get visible() { return G.visible; },
  };
  try { api.pits = initPits36(engine, streamer); } catch (e) { warn(e); }   // the tree pits (world/vg36Pits.js, `?vg36p=0` off)
  // VG37 (world/vg37.js, `?vg37=0` off): hedges, planted beds and scrub outside Central Park (the park's are cpFlora.js's)
  import('./vg37.js').then((m) => { api.shrubs = m.initVeg37(engine, streamer); }).catch((e) => warn(e));
  if (typeof window !== 'undefined') window.__VG36 = api;
  console.log(`[vg36] grass on: rings ${RINGS.map((R) => `${R.blades}x${R.rows}`).join(' / ')} blades x segments a ${CELL} m patch, field ${FIELD_M} m at ${(FIELD_M / FIELD_N).toFixed(2)} m`);
  return api;
}
