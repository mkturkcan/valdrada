// Columbia campus runtime kit — dresses the compiled campus grounds with the
// pieces tiles can't carry: granite step runs (incl. the Low Library grand
// staircase), retaining walls + balustrades, Alma Mater and the campus
// sculpture set, the Low Plaza fountains, twin-globe path lamps, flagpoles,
// lawn fences and hedges. Geometry positions/heights come pre-baked from the
// compiler (public/data/columbia_campus.json, OSM-derived — see DATA_SOURCES.md).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { applySnowCap, applyLightTrim, applyStoneDetail, ENV } from '../world/materials.js';
import { COLLIDERS } from './colliders.js';
import { setCampusPads } from './landmarks.js';
import { FW25, FW26, FW27, fountainProbe, fountainSpray, poolRings, veilMat } from './fountainFX.js';   // FW25: spray, ring waves; FW26: water veils, foam; FW27: probe-lit clear pools
import { HA_ON, haPreload, haGround, haGroundMin, haGroundReady, haFoot } from '../world/haAnchor.js';
import { haRegistry } from '../world/heightAuthority.js';   // P1 TERRAIN (`?terrain=p1`): the kit on the real ground

// every campus material takes the scene light trim (see applyLightTrim): the
// untrimmed granite and limestone clipped to pure white at noon
const LT = (m) => applyLightTrim(m);
// LP26: no kit stone panels over Low Plaza's compiled paving (see the plaza block)
const LP26 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('lp26') === '0');
const GRANITE = LT(new THREE.MeshStandardMaterial({ color: 0x8f8a80, roughness: 0.82, metalness: 0.02 }));
const STONE = LT(new THREE.MeshStandardMaterial({ color: 0x7d7468, roughness: 0.9 }));
const BRONZE = LT(new THREE.MeshStandardMaterial({ color: 0x51604a, roughness: 0.55, metalness: 0.55 })); // patinated
// Alma Mater's bronze: the 2002 restoration left a green-BROWN patina, not the
// uniform verdigris green a cast-bronze cliche would give (Commons close-ups)
// flatShading is load-bearing here: the figure is built from lathe and ellipsoid
// masses, and smooth shading turns them into a pile of billiard balls. Faceted,
// each panel reads as a drapery plane.
const ALMABRONZE = LT(new THREE.MeshStandardMaterial({ color: 0x2b3226, roughness: 0.62, metalness: 0.10, flatShading: true }));
// her pedestal is a polished red-veined marble die, not grey granite
const MARBLE = LT(new THREE.MeshStandardMaterial({ color: 0x4a2b26, roughness: 0.30, metalness: 0.05 }));
const DARKMETAL = LT(new THREE.MeshStandardMaterial({ color: 0x22282a, roughness: 0.6, metalness: 0.5 }));
const GREENPOST = LT(new THREE.MeshStandardMaterial({ color: 0x1d2b22, roughness: 0.55, metalness: 0.45 }));
const GLOBE = LT(new THREE.MeshStandardMaterial({ color: 0xf3ede2, roughness: 0.4, emissive: 0xffe9c4, emissiveIntensity: 0.85 }));
const HEDGE = LT(new THREE.MeshStandardMaterial({ color: 0x27401f, roughness: 0.97 }));
const PAVBRICK = LT(new THREE.MeshStandardMaterial({ color: 0x9a5540, roughness: 0.96 })); // Low Plaza inlay
// Low Plaza's paving is pale stone PANELS in wide red-brick banding; this is
// the panel stone, a shade lighter and warmer than the step granite
// darkened from 0xa39b8c after n1_flankE_day: at noon the panels clipped to the
// same value as the granite and the whole plaza read as one white field
const PAVSTONE = LT(new THREE.MeshStandardMaterial({ color: 0x958c7c, roughness: 0.95, metalness: 0.0 }));
// the fountain stone the falling water keeps wet: darker and glossier than the dry coping
const WETGRANITE = LT(new THREE.MeshStandardMaterial({ color: 0x6c675f, roughness: 0.4, metalness: 0.02 }));
// AL32: Alma Mater's rebuilt granite block, the tone of the scan's carved front beside it (its photo texture's mean,
// sRGB 206,197,185, a shade down for the sun the capture's front took)
const ALMAGRANITE = LT(new THREE.MeshStandardMaterial({ color: 0xc4bcb0, roughness: 0.82, metalness: 0.02 }));
for (const m of [GRANITE, STONE, BRONZE, ALMABRONZE, MARBLE, DARKMETAL, GREENPOST, HEDGE, PAVBRICK, PAVSTONE, ALMAGRANITE]) applySnowCap(m); // walls, balustrades, hedges, monuments cap over
// AM30 (owner 2026-09-28: "Columbia University athena statue is extremely barebones as well and blocky I'd like a more
// realistic reconstruction"): Alma Mater from M. K. Turkcan's photogrammetry scan of the monument (CC BY 4.0,
// https://doi.org/10.5281/zenodo.10312053), cut to the bronze, its throne and the stone die, moved into her frame and
// simplified by tools/assets/alma_mater.mjs (61k triangles, the capture's photo texture). The capture is metric (its
// throne is 1.68 m wide against the 1.7 m published); its underside stood on uneven steps, so it is cut level and seated
// on a granite plinth. The faceted model stays until the scan has loaded. `?am30=0` restores it.
// AL31 (owner 2026-09-29: "slightly tilted towards back and has an unnecessary square raise around it"): the capture's
// up was 5.6 deg off the vertical (tools/assets/alma_tilt.mjs, from her base's treads and risers), which is also what
// made its underside look uneven; the scan is now levelled and cut where its base meets the landing, and stands on the
// landing on its own stepped pedestal, without the plinth or the faceted model's apron slab.
// AL32 (owner 2026-09-29: "still leaned the wrong way. You might need to prop up the base"): AL31 turned the scan the
// wrong way about its tilt axis and left it leaning 11.3 deg back (alma_tilt.mjs --out on the shipped model). Now level
// to within 0.5 deg. The capture's granite block is set into the Low steps (its sides seen only above the stairs, its
// back not at all), so alma_mater.mjs keeps its carved ALMA MATER front and rebuilds the rest as a closed box ('block',
// in ALMAGRANITE above) that stands on the landing, the die and the bronze propped into its top.
const AM30 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('am30') === '0');
const TB32 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('tb32') === '0');   // TB32: the terrace's granite border (`?tb32=0` off)
let _almaScan = null;   // one load for the campus
const almaScan = () => _almaScan || (_almaScan = (async () => {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const g = await new GLTFLoader().loadAsync('models/landmarks/alma_mater.glb');
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    const m = o.material;
    if (m.name === 'block') { o.material = ALMAGRANITE; return; }
    // the photo texture carries the patina's own colour; the bronze a dark metal, the marble die polished, the granite honed
    if (m.name === 'bronze') { m.metalness = 0.35; m.roughness = 0.52; } else { m.metalness = 0.0; m.roughness = m.name === 'marble' ? 0.5 : 0.86; }
    LT(m); applySnowCap(m);
  });
  return g.scene;
})());
// CT25 (materials.js applyStoneDetail): photographed stone surfaces on the campus kit, triplanar in the campus frame
applyStoneDetail(GRANITE, 'cgranite', { amt: 0.8, nrm: 0.75, rgh: 0.45 });
applyStoneDetail(ALMAGRANITE, 'cgranite', { amt: 0.7, nrm: 0.7, rgh: 0.45, scale: 0.8 });
applyStoneDetail(STONE, 'cgranite', { amt: 0.85, nrm: 0.8, rgh: 0.4, scale: 1.3 });
applyStoneDetail(PAVSTONE, 'cpave', { amt: 0.9, nrm: 0.7, rgh: 0.35 });
applyStoneDetail(PAVBRICK, 'cpave', { amt: 0.6, nrm: 0.6, rgh: 0.3, scale: 0.7 });
applyStoneDetail(WETGRANITE, 'cgranite', { amt: 0.7, nrm: 0.5, rgh: 0.15 });

// ---------- fountain water, all procedural (no image assets)
// Owner review 2026-09-24: "the fountains look too basic". The veil and jet were
// opaque FOAM cylinders (a white drum under a white spike) over matte water.
// Now the pool and bowl water are dark, glossy and rippled; the falling water is
// a translucent sheet of strands that runs down over the lip; foam rings sit
// where it lands. Everything moves on ENV.time, the sim clock, so a recorded
// take steps it frame-exactly and a dt = 0 settle holds it still.
const FW = (() => {
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const tex = (data, w, h) => {
    const t = new THREE.DataTexture(data, w, h);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
    return t;
  };
  // periodic value noise (it tiles), the base of the foam blotches
  const vn = (x, y, P) => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    // an integer hash: the sin() hash of small lattice ints is correlated and
    // draws diagonal streaks
    const g = (i, j) => {
      let h = (Math.imul(((i % P) + P) % P, 374761393) + Math.imul(((j % P) + P) % P, 668265263) + Math.imul(P, 1440662683)) | 0;
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  // ripple normals: 32 wave trains, four random directions for each of eight
  // wavenumbers, amplitude ~ k^-2.2 so the slope spectrum falls with k (integer
  // wave vectors keep the tile seamless). Six trains with two dominant ones
  // interfered into a regular diamond lattice in the film-8 test frames.
  const N = 128, rip = new Uint8Array(N * N * 4), WV = [];
  [3, 4, 5, 6, 8, 10, 13, 16].forEach((k, m) => {
    for (let q = 0; q < 4; q++) {
      const th = (q / 4 + hash(m * 7 + q) * 0.25) * Math.PI * 2;
      const kx = Math.round(k * Math.cos(th)), ky = Math.round(k * Math.sin(th));
      if (kx || ky) WV.push([kx, ky, 1 / Math.pow(Math.hypot(kx, ky), 2.2), hash(m * 13 + q * 3 + 1) * 6.283]);
    }
  });
  const H = (x, y) => WV.reduce((h, [kx, ky, a, ph]) => h + a * Math.sin((2 * Math.PI * (kx * x + ky * y)) / N + ph), 0);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const nx = -(H(x + 1, y) - H(x - 1, y)) * 12, ny = -(H(x, y + 1) - H(x, y - 1)) * 12, l = Math.hypot(nx, ny, 1);
    const i = (y * N + x) * 4;
    rip[i] = (nx / l * 0.5 + 0.5) * 255; rip[i + 1] = (ny / l * 0.5 + 0.5) * 255; rip[i + 2] = (0.5 / l + 0.5) * 255; rip[i + 3] = 255;
  }
  const ripple = tex(rip, N, N);
  // falling-water strands: a strength per column (smoothed across), broken up along the fall
  const SWD = 128, SHT = 256, st = new Uint8Array(SWD * SHT * 4);
  const colR = Array.from({ length: SWD }, (_, x) => hash(x + 0.5));
  const colS = colR.map((_, x) => (colR[(x + SWD - 1) % SWD] + 2 * colR[x] + colR[(x + 1) % SWD]) / 4);
  for (let y = 0; y < SHT; y++) for (let x = 0; x < SWD; x++) {
    const p1 = hash(x * 7.3) * 6.283, p2 = hash(x * 3.1 + 9) * 6.283;
    const brk = 0.5 + 0.3 * Math.sin((2 * Math.PI * 2 * y) / SHT + p1) + 0.2 * Math.sin((2 * Math.PI * 5 * y) / SHT + p2);
    const v = Math.min(1, Math.max(0, 0.22 + 0.95 * colS[x] * (0.45 + 0.55 * brk)));
    const i = (y * SWD + x) * 4;
    st[i] = st[i + 1] = st[i + 2] = v * 255; st[i + 3] = 255;
  }
  const streak = tex(st, SWD, SHT);
  // foam: the same value-noise fbm, thresholded into blotches
  const fo = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const n = 0.55 * vn((x * 8) / N, (y * 8) / N, 8) + 0.3 * vn((x * 16) / N, (y * 16) / N, 16) + 0.15 * vn((x * 32) / N, (y * 32) / N, 32);
    const v = Math.min(1, Math.max(0, (n - 0.34) / 0.3));
    const i = (y * N + x) * 4;
    fo[i] = fo[i + 1] = fo[i + 2] = v * 255; fo[i + 3] = 255;
  }
  const foam = tex(fo, N, N);
  const own = (t, rx, ry) => { const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c; };
  // speeds live in per-material uniforms, so every water material shares one program
  const scroll = (m, u, v) => {
    const prev = m.onBeforeCompile, spd = { value: new THREE.Vector2(u, v) };
    m.onBeforeCompile = (sh, r) => {
      prev?.call(m, sh, r);
      sh.uniforms.fwT = ENV.time; sh.uniforms.fwSpd = spd;
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float fwT; uniform vec2 fwSpd;')
        // two ripple samples drifting apart: the surface moves without ever repeating visibly
        .replace('#include <normal_fragment_maps>', THREE.ShaderChunk.normal_fragment_maps.replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapN = normalize( texture2D( normalMap, vNormalMapUv + fwT * fwSpd ).xyz * 2.0 - 1.0 + texture2D( normalMap, vNormalMapUv * 1.61 + fwT * vec2( -fwSpd.y, fwSpd.x ) * 1.3 ).xyz * 2.0 - 1.0 );'))
        // the strands and the foam run along the lathe profile (v): over the lip, down the veil, out across the pool
        .replace('#include <alphamap_fragment>', '#ifdef USE_ALPHAMAP\n  diffuseColor.a *= ' + (FW25 ? 'smoothstep( 0.18, 0.82, texture2D( alphaMap, vAlphaMapUv - fwT * fwSpd ).g )' : 'texture2D( alphaMap, vAlphaMapUv - fwT * fwSpd ).g') + ';\n#endif');
    };
    const key = m.customProgramCacheKey.bind(m);
    m.customProgramCacheKey = () => key() + '|fwScroll';
    m.needsUpdate = true;
    return m;
  };
  // specularIntensity < 1 trims the grazing sky sheet the old WATER was blamed
  // for; the stronger ripples break what is left into a shimmer
  const water = (rep) => scroll(LT(new THREE.MeshPhysicalMaterial({
    color: 0x121c19, roughness: 0.1, metalness: 0.0, specularIntensity: 0.72,
    normalMap: own(ripple, rep, rep), normalScale: new THREE.Vector2(0.42, 0.42),
  })), 0.021, 0.013);
  // FW25: a clear, glossy sheet (the white frosted look was a 0.22-rough near-opaque skin)
  const sheet = (ru, rv, speed, opacity) => scroll(LT(new THREE.MeshStandardMaterial({
    color: FW25 ? 0xd6e2e2 : 0xe4eceb, roughness: FW25 ? 0.05 : 0.22, metalness: 0.0, alphaMap: own(streak, ru, rv), transparent: true,
    opacity: FW25 ? opacity * 0.62 : opacity, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: FW25 ? 1.6 : 1.0,
  })), 0, speed);
  const froth = (ru, rv, speed) => scroll(LT(new THREE.MeshStandardMaterial({
    color: 0xf1f5f4, roughness: 0.6, metalness: 0.0, alphaMap: own(foam, ru, rv), transparent: true, vertexColors: true,
    depthWrite: false,
  })), 0.004, speed);
  return { water, sheet, froth };
})();

// a lathe of (r, y) pairs. The profile runs COUNTER-clockwise in the (r, y) plane
// (up an outer face, inward across a top, down an inner face) so faces point out.
const lathe = (pts, seg = 64) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);
// a flat foam ring (profile runs INWARD so it faces up) with its alpha in vertex colour
const foamRing = (y, rings, seg = 64) => {
  const g = lathe(rings.map(([r]) => [r, y]), seg);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    let a = 0;
    for (let k = 0; k < rings.length - 1; k++) {
      const [r0, a0] = rings[k], [r1, a1] = rings[k + 1];
      if (r <= r0 + 1e-4 && r >= r1 - 1e-4) { a = a0 + ((a1 - a0) * (r0 - r)) / Math.max(1e-6, r0 - r1); break; }
    }
    col[i * 4] = col[i * 4 + 1] = col[i * 4 + 2] = 1; col[i * 4 + 3] = a;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  return g;
};

// The Low Plaza fountain for use elsewhere (BP28, Bryant Park's Lowell fountain is the same type: a broad granite basin
// with a raised tazza on a baluster, its water falling from the lip, a crowned jet): the plaza branch of buildCampus's
// fountain loop at radius R, in a group at the local origin (y 0 = the plinth's foot). x, z: where the caller puts it,
// in world metres (the ring waves and the probe are world-anchored). Returns { group, footR }.
export function tazzaFountain({ x, z, R = 5.35, seed = 0 }) {
  const G = new THREE.Group();
  const rimH = 0.5, cw = 0.64, seg = 96, wl = rimH - 0.2;
  const part = (geo, mat, py = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = py; m.castShadow = cast; m.receiveShadow = true;
    G.add(m);
    return m;
  };
  const o = R + cw;
  part(new THREE.CylinderGeometry(o + 0.02, o + 0.06, 0.1, seg), GRANITE, 0.05);
  part(new THREE.CylinderGeometry(o - 0.15, o - 0.15, rimH - 0.25, seg, 1, true), GRANITE, 0.1 + (rimH - 0.25) / 2);
  part(new THREE.TorusGeometry(o - 0.13, 0.03, 6, seg), GRANITE, 0.15, false).rotation.x = Math.PI / 2;
  part(lathe([[o - 0.15, rimH - 0.15], [o - 0.07, rimH - 0.14], [o - 0.02, rimH - 0.11], [o, rimH - 0.07],
    [o - 0.02, rimH - 0.03], [o - 0.08, rimH - 0.01], [R + 0.1, rimH], [R + 0.03, rimH - 0.02], [R, rimH - 0.06],
    [R, wl - 0.12]], seg), GRANITE);
  const poolMat = FW.water(4.5);
  const setPool = FW25 ? poolRings(poolMat, { impR: 2.4, amp: FW26 ? 0.08 : 0.16, k: 17, foam: 1, foamIn: 0.55, foamOut: 1.3,
    basin: { R, depth: 0.36, ped: 1.3, veilR: 2.37, veilH: 2.17 - wl, copeH: rimH - wl, floor: 0.2, chop: 1 } }) : null;
  if (setPool) setPool(x, z);
  const poolMesh = part(new THREE.CircleGeometry(R + 0.01, seg), poolMat, wl, false);
  poolMesh.rotation.x = -Math.PI / 2;
  part(lathe([[1.3, 0.2], [1.3, 0.4], [1.2, 0.44], [1.05, 0.46], [0.95, 0.52], [0.95, 0.58], [0.8, 0.62],
    [0.62, 0.7], [0.52, 0.85], [0.47, 1.05], [0.5, 1.22], [0.58, 1.32], [0.66, 1.38], [0.66, 1.44],
    [0.55, 1.47], [0.44, 1.5]], 48), WETGRANITE);
  part(lathe([[0.42, 1.5], [0.75, 1.54], [1.15, 1.62], [1.55, 1.74], [1.85, 1.86], [2.02, 1.95], [2.1, 2.0],
    [2.14, 2.04], [2.15, 2.1], [2.12, 2.14], [2.04, 2.155], [1.96, 2.14], [1.93, 2.1], [1.8, 2.04],
    [1.2, 1.98], [0, 1.96]], 72), WETGRANITE);
  const bowlMat = FW.water(1.8);
  const setBowl = FW25 ? poolRings(bowlMat, { impR: 0.8, amp: FW26 ? 0.06 : 0.12, k: 22, foam: 0.85, foamIn: 0.7, foamOut: 2.2,
    basin: { R: 1.95, depth: 0.12, ped: 0.08, copeH: 0.045, floor: 0.2, chop: 0.6 } }) : null;
  if (setBowl) setBowl(x, z);
  part(new THREE.CircleGeometry(1.95, 72), bowlMat, 2.11, false).rotation.x = -Math.PI / 2;
  if (FW25) G.add(fountainSpray({ lipR: 2.12, lipY: 2.15, wl, impR: 2.4, jetY: 2.11, jetH: 1.25, bowlY: 2.11, bowlR: 1.9, seed }));
  const fallT = (h, v0) => (-v0 + Math.sqrt(v0 * v0 + 19.62 * h)) / 9.81;
  part(lathe([[1.92, 2.112], [2.02, 2.165], [2.12, 2.17], [2.18, 2.13], [2.22, 2.02], [2.26, 1.85], [2.29, 1.6],
    [2.33, 1.25], [2.36, 0.85], [2.4, wl]], 96), FW26
    ? veilMat(FW27 ? { y0: 2.17, dir: 1, v0: 0.3, tMax: fallT(2.17 - wl, 0.3), aer: [0.36, 0.95], holes: 0.6, body: 0.2, freq: 10 }
      : { y0: 2.17, dir: 1, v0: 0.3, tMax: fallT(2.17 - wl, 0.3), aer: [0.42, 1.0], holes: 0.55, body: 0.26, freq: 5.5 }, LT)
    : FW.sheet(16, 1.5, 2.4, 0.85), 0, false).renderOrder = 2;
  if (!FW26) part(foamRing(wl + 0.006, [[3.5, 0], [3.0, 0.3], [2.62, 0.8], [2.44, 1], [2.3, 0.55]], 96), FW.froth(24, 2, -0.12), 0, false).renderOrder = 1;
  const jetV0 = Math.sqrt(19.62 * 1.24);
  part(lathe([[0.075, 2.11], [0.07, 2.4], [0.075, 2.8], [0.085, 3.1], [0.1, 3.25], [0.07, 3.33], [0, 3.35]], 24), FW26
    ? veilMat({ y0: 2.11, dir: -1, v0: jetV0, tMax: jetV0 / 9.81, aer: [0.3, 0.95], holes: 0.2, body: 0.34, freq: 30 }, LT)
    : FW.sheet(3, 2, 6.4, FW25 ? 0.75 : 0.9), 0, false).renderOrder = 1;
  part(lathe([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => [0.1 + 0.75 * t, 3.28 + 0.08 * t - 1.25 * t * t]), 48), FW26
    ? veilMat(FW27 ? { y0: 3.37, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.05, 0.55], holes: 0.8, body: 0.22, freq: 15 }
      : { y0: 3.37, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.1, 0.8], holes: 0.6, body: 0.3, freq: 9 }, LT)
    : FW.sheet(8, 1.2, 1.9, 0.6), 0, false).renderOrder = 1;
  if (FW27) fountainProbe(poolMesh, G, [poolMat, bowlMat], wl + 1.2);
  return { group: G, footR: o + 0.06 };
}

// LOOK14 (owner 2026-10-09: Bryant Park's Lowell fountain to the real one): the fountain built from city/bryantParkKit.js's
// lowellStone() geometry (`stone`: { dry, wet }) in this file's granite, with tazzaFountain's water fitted to it: the pool
// over the notched basin (`water`: its outline [[x, z], ...] in the local frame), the ring waves, the bowl's water, the
// spray, the overflow veil from the 13 ft bowl's lip to the pool, the jet and its crown, the probe. L: the kit's LOWELL
// numbers. x, z: the world position (the ring waves and the probe are world-anchored). Returns { group, footR }.
export function lowellFountain({ x, z, seed = 0, stone, water, L }) {
  const G = new THREE.Group();
  const wl = L.wl;
  const part = (geo, mat, py = 0, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.y = py; m.castShadow = cast; m.receiveShadow = true;
    G.add(m);
    return m;
  };
  part(stone.dry, GRANITE);
  part(stone.wet, WETGRANITE);
  const Rw = L.Ro - L.w, landR = L.landR, lipY = L.lipY, bowlY = L.bowlY;
  const poolMat = FW.water(4.5);
  const setPool = FW25 ? poolRings(poolMat, { impR: landR, amp: FW26 ? 0.08 : 0.16, k: 17, foam: 1, foamIn: 0.55, foamOut: 1.3,
    basin: { R: Rw, depth: 0.36, ped: L.plinth, veilR: landR, veilH: lipY + 0.02 - wl, copeH: L.rimH - wl, floor: 0.2, chop: 1 } }) : null;
  if (setPool) setPool(x, z);
  const S = new THREE.Shape(water.filter((p, i) => i === 0 || Math.hypot(p[0] - water[i - 1][0], p[1] - water[i - 1][1]) > 1e-5).map(([px, pz]) => new THREE.Vector2(px, -pz)));
  const poolMesh = part(new THREE.ShapeGeometry(S, 1), poolMat, wl, false);
  poolMesh.rotation.x = -Math.PI / 2;
  const bowlMat = FW.water(1.8);
  const setBowl = FW25 ? poolRings(bowlMat, { impR: 0.8, amp: FW26 ? 0.06 : 0.12, k: 22, foam: 0.85, foamIn: 0.7, foamOut: 2.2,
    basin: { R: L.bowlR, depth: 0.11, ped: 0.08, copeH: lipY - bowlY, floor: 0.2, chop: 0.6 } }) : null;
  if (setBowl) setBowl(x, z);
  part(new THREE.CircleGeometry(L.bowlR + 0.02, 96), bowlMat, bowlY, false).rotation.x = -Math.PI / 2;
  if (FW25) G.add(fountainSpray({ lipR: L.lipR + 0.02, lipY: lipY + 0.01, wl, impR: landR, jetY: bowlY, jetH: 1.35, bowlY, bowlR: L.bowlR, seed }));
  const fallT = (h, v0) => (-v0 + Math.sqrt(v0 * v0 + 19.62 * h)) / 9.81;
  // the overflow: over the lip, nearly straight down the 2.75 m to the pool, landing just outside the plinth's sides
  const vt = lipY + 0.02;
  part(lathe([[1.94, lipY - 0.015], [2.0, vt], [2.045, vt - 0.006], [2.075, vt - 0.05], [2.1, vt - 0.2], [2.13, vt - 0.5], [2.16, vt - 0.95],
    [2.19, vt - 1.55], [2.22, vt - 2.15], [landR, wl]], 112), FW26
    // (LOOK14b, the Lead 22:35: thin bright strands, not a dark wall: whole at the lip, breaking into fine strands as it
    // falls, white from the lip, the glassy body all but clear; ue_prep's LOOK14 curtain uses the same numbers)
    ? veilMat(FW27 ? { y0: vt, dir: 1, v0: 0.3, tMax: fallT(vt - wl, 0.3), aer: [0.0, 0.3], holes: 0.5, body: 0.06, freq: 20, tear0: 0.15 }
      : { y0: vt, dir: 1, v0: 0.3, tMax: fallT(vt - wl, 0.3), aer: [0.0, 0.3], holes: 0.5, body: 0.06, freq: 20, tear0: 0.15 }, LT)
    : FW.sheet(16, 1.5, 2.4, 0.85), 0, false).renderOrder = 2;
  // the jet from the bowl's centre and its falling crown (tazzaFountain's, raised onto this bowl)
  const dy = bowlY - 2.11, jetV0 = Math.sqrt(19.62 * 1.24);
  part(lathe([[0.075, 2.11 + dy], [0.07, 2.4 + dy], [0.075, 2.8 + dy], [0.085, 3.1 + dy], [0.1, 3.25 + dy], [0.07, 3.33 + dy], [0, 3.35 + dy]], 24), FW26
    ? veilMat({ y0: 2.11 + dy, dir: -1, v0: jetV0, tMax: jetV0 / 9.81, aer: [0.3, 0.95], holes: 0.2, body: 0.34, freq: 30 }, LT)
    : FW.sheet(3, 2, 6.4, FW25 ? 0.75 : 0.9), 0, false).renderOrder = 1;
  part(lathe([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => [0.1 + 0.75 * t, 3.28 + dy + 0.08 * t - 1.25 * t * t]), 48), FW26
    ? veilMat(FW27 ? { y0: 3.37 + dy, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.05, 0.55], holes: 0.8, body: 0.22, freq: 15 }
      : { y0: 3.37 + dy, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.1, 0.8], holes: 0.6, body: 0.3, freq: 9 }, LT)
    : FW.sheet(8, 1.2, 1.9, 0.6), 0, false).renderOrder = 1;
  if (FW27) fountainProbe(poolMesh, G, [poolMat, bowlMat], wl + 1.2);
  return { group: G, footR: L.Ro + L.step + 0.06 };
}
// LOOK14 end

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();
const AXIS_Y = new THREE.Vector3(0, 1, 0);

// batched unit-box instancing per material — one draw call per bucket
// P1 TERRAIN: while BOX_LIFT is set (the kit's flat-authored pieces), a box is lifted by the authority's lift at its centre;
// a long thin box (a kerb, a rail, a wall course) is cut into pieces of at most 4 m, each lifted at its own centre
let BOX_LIFT = null;
class BoxBatch {
  constructor(mat) { this.mat = mat; this.items = []; }
  add(cx, cy, cz, sx, sy, sz, yaw = 0) {
    if (BOX_LIFT) {
      if (sz > 4.5 && sx < 1.5) {
        const n = Math.ceil(sz / 4), dx = Math.sin(yaw), dz = Math.cos(yaw);
        for (let k = 0; k < n; k++) {
          const o = (k + 0.5) * sz / n - sz / 2, px = cx + dx * o, pz = cz + dz * o;
          this.items.push([px, cy + BOX_LIFT(px, pz), pz, sx, sy, sz / n + 0.02, yaw]);
        }
        return;
      }
      cy += BOX_LIFT(cx, cz);
    }
    this.items.push([cx, cy, cz, sx, sy, sz, yaw]);
  }
  build(group, shadows) {
    if (!this.items.length) return;
    const m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.mat, this.items.length);
    this.items.forEach(([cx, cy, cz, sx, sy, sz, yaw], i) => {
      tmpQ.setFromAxisAngle(AXIS_Y, yaw);
      tmpM.compose(tmpP.set(cx, cy, cz), tmpQ, tmpS.set(sx, sy, sz));
      m.setMatrixAt(i, tmpM);
    });
    m.castShadow = shadows; m.receiveShadow = true;
    group.add(m);
  }
}

export async function buildCampus(scene) {
  let C;
  try { C = await (await fetch('data/columbia_campus.json')).json(); }
  catch (e) { console.warn('campus data unavailable', e); return; }
  if (!C || !C.alma) return;
  // hand the compiled terrace levels to the landmark builders: Low, Butler and
  // St Paul's level themselves off the PAVING, not off the compiler's baseY,
  // which went uniform-3.52 in tiles_flat4 (see CU_PADS in landmarks.js)
  setCampusPads({ walk: C.padWalk, apron: C.padApron, top: C.padTop });

  const g = new THREE.Group();
  g.name = 'columbiaCampus';
  const granite = new BoxBatch(GRANITE), stone = new BoxBatch(STONE), fenceB = new BoxBatch(DARKMETAL), hedgeB = new BoxBatch(HEDGE), balB = new BoxBatch(GRANITE), brickB = new BoxBatch(PAVBRICK), stoneB = new BoxBatch(PAVSTONE);
  const uniq = new THREE.Group(); // one-off pieces (monuments, fountains, urns...)
  const box = (mat, sx, sy, sz, x, y, z, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z); m.rotation.y = ry; m.rotation.z = rz;
    m.castShadow = true; m.receiveShadow = true;
    return m;
  };
  const cyl = (mat, r0, r1, h, x, y, z, seg = 14) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat);
    m.position.set(x, y, z); m.castShadow = true;
    return m;
  };
  const [AX, AZ] = C.axis; // campus north (toward Low)
  const alma = C.alma;
  // C.pad* ARE the paved tops (measured against the compiled ground sections:
  // College Walk brick 3.52, plaza brick 4.71, plateau path 10.21). NEVER write
  // an absolute height here - read the pads.
  const yWalk = C.padWalk, yApron = C.padApron, yTop = C.padTop;
  // ...but every height the compiler BAKES into a feature (steps[].pts3,
  // walls/fences/hedges pts3, monuments[].y, fountains[].y, flagpoles[].y) is
  // sampled on the terrain grid, which runs one paving slab BELOW the pads.
  // Derive that slab from the data and lift baked heights onto the paving.
  const LIFT = (() => {
    const m = (C.monuments || []).find((q) => Number.isFinite(q.y) && Math.abs(q.y - C.padTop) < 0.6);
    const d = m ? C.padTop - m.y : 0.12;
    return d > 0 && d < 0.6 ? d : 0;
  })();
  const distAlma = (x, z) => Math.hypot(x - alma[0], z - alma[1]);
  // ==== P1 TERRAIN (`?terrain=p1`, world/haAnchor.js): the kit on the authority's ground. The flat kit stands on the
  // compile's McKim pads (two planes 6.7 m apart, seams under authored walls); the real campus (the 2017 bare earth, its
  // walls as slits) has its terrace walls, flights and landings elsewhere (the plaza's flanks at |across| ~42 not 54.6,
  // the parterre wall at along +1.5 not -8.4, the grand flights at along -10..-7 and -3..+0.5). Under the flag:
  //   - every flat-authored piece is lifted at its footing by the relief less the pad (haLift), a point object stands on
  //     the paved ground under it (gS)
  //   - the McKim axis (the plaza's south steps, the grand staircase, Alma Mater's landing) is laid again where the real
  //     ground rises (fitted from the authority below), the landings are the ground itself
  //   - the pad-seam masses (flank walls, parterre-north wall, cascade terraces, their decks, the Kent/Dodge flights) are
  //     not built: the real walls are slits the ground's builder faces, the side flights are OSM steps like the others
  // The kit waits for the campus's tiles (the drawn ground it stands on is their lifted sections: world/haAnchor.js
  // haGround); main.js does not await buildCampus, so the boot does not wait with it
  const HA = HA_ON && await haPreload(alma[0] - 460, alma[1] - 460, alma[0] + 460, alma[1] + 460)
    && await haGroundReady([[alma[0], alma[1]], [alma[0] - 150, alma[1] + 150], [alma[0] + 150, alma[1] - 150], [alma[0] + 200, alma[1] + 200], [alma[0] - 200, alma[1] - 200]]);
  const gS = (x, z) => haGround(x, z);
  // a rigid piece of radius r: on the lowest ground under it, unless a wall runs through its footprint (over 0.4 m between
  // its lowest and highest ground): then on the ground at its centre, its own level
  const gMin = (x, z, r, yFlat) => {
    const g = haGroundMin(x, z, r), c = haGround(x, z);
    if (g === null || c === null) return yFlat;
    let hi = c;
    if (r > 0.05) for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, v = haGround(x + Math.cos(a) * r, z + Math.sin(a) * r); if (v !== null) hi = Math.max(hi, v); }
    return hi - g > 0.4 ? c : g;
  };
  // a group's new children (from index i0), authored on the level `ref`, stood on the ground under each
  const liftKids = (grp, i0, ref) => { if (HA) for (let i = i0; i < grp.children.length; i++) { const o = grp.children[i], g = gS(o.position.x, o.position.z); if (g !== null) o.position.y += g - ref; } };
  // deck = a walking surface (flight treads, granite decks): sim/peds.js stands campus walkers on these
  const addPrism = (pts, y0, y1, deck = false) => {
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    const flat = new Float32Array(pts.length * 2);
    pts.forEach(([x, z], i) => { flat[i * 2] = x; flat[i * 2 + 1] = z; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); });
    if (BOX_LIFT) { const d = BOX_LIFT((minX + maxX) / 2, (minZ + maxZ) / 2); y0 += d; y1 += d; }
    COLLIDERS.addPrism('campus', { pts: flat, minX, minZ, maxX, maxZ, y0, y1, deck });
  };
  const rectPts = (cx, cz, hw, hd, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
  };

  // ---------- step runs (74 OSM ways; heights baked from padded terrain)
  const stairRun = (lo, hi, w, cheeks) => {
    const len = Math.hypot(hi[0] - lo[0], hi[1] - lo[1]);
    const rise = hi[2] - lo[2];
    const loY = lo[2] + LIFT, hiY = hi[2] + LIFT;
    if (len < 0.8 || Math.abs(rise) < 0.22) return;
    const dirx = (hi[0] - lo[0]) / len, dirz = (hi[1] - lo[1]) / len;
    const yaw = Math.atan2(dirx, dirz);
    const n = Math.max(2, Math.round(Math.abs(rise) / 0.155));
    const tread = len / n, rh = Math.abs(rise) / n;
    let prevTop = -Infinity;
    for (let i = 0; i < n; i++) {
      const t0 = (i + 0.5) * tread;
      // deep skirt + ride 9cm proud of the terrain ramp so its coarse triangle
      // cells can never interleave with the treads
      if (HA) {
        // (TERRAIN INT2: on the real ground a straight flight between its two ends rode up to 1.2 m over a dip in the
        // slope (a grey slab on Morningside's bank) or sank under a hump: each tread's top is the line's or 2 cm over the
        // ground under its front, never below the tread before, and its block reaches 0.3 m into the ground under it)
        const cx = lo[0] + dirx * t0, cz = lo[1] + dirz * t0, g0 = gS(cx, cz);
        let top = loY + rh * (i + 1);
        if (g0 !== null && g0 + 0.02 > top) top = g0 + 0.02;
        if (top < prevTop) top = prevTop;
        prevTop = top;
        const foot = Math.min(top - rh - 0.34, g0 !== null ? g0 - 0.3 : top - rh - 0.34);
        granite.add(cx, (top - 0.04 + foot) / 2, cz, w, top - 0.04 - foot, tread + 0.06, yaw);
        continue;
      }
      granite.add(lo[0] + dirx * t0, loY + rh * (i + 1) - rh / 2 - 0.04, lo[1] + dirz * t0, w, rh + 0.34, tread + 0.06, yaw);
    }
    if (cheeks) {
      for (const side of [-1, 1]) {
        const px = -dirz * side * (w / 2 + 0.45), pz = dirx * side * (w / 2 + 0.45);
        const cx = (lo[0] + hi[0]) / 2 + px, cz = (lo[1] + hi[1]) / 2 + pz;
        granite.add(cx, (loY + hiY) / 2 + 0.28, cz, 0.9, Math.abs(rise) + 1.15, len + 1.6, yaw);
        addPrism(rectPts(cx, cz, 0.45, len / 2 + 0.8, yaw), Math.min(loY, hiY) - 1, Math.max(loY, hiY) + 1.2);
      }
    }
  };
  // the grand-staircase zone is FULLY synthetic (below) — pad-flattened OSM
  // ways there have near-zero or inverted rises and orient randomly
  const relPt = (fwd, right) => [alma[0] + AX * fwd - AZ * right, alma[1] + AZ * fwd + AX * right];
  const inZone = (x, z) => {
    const dx = x - alma[0], dz = z - alma[1];
    const along = dx * AX + dz * AZ, across = dx * -AZ + dz * AX;
    return (along > -17 && along < 19 && Math.abs(across) < 62) ||
           (along > -47 && along < -34 && Math.abs(across) < 60);
  };
  // P1: the zone the axis fit lays (the plaza's south steps; the grand staircase up to Low's own stair, which Low builds)
  const haZone = (x, z) => {
    const dx = x - alma[0], dz = z - alma[1];
    const along = dx * AX + dz * AZ, across = dx * -AZ + dz * AX;
    return (along > -45 && along < -27 && Math.abs(across) < 50) || (along > -13 && along < 24 && Math.abs(across) < 30);
  };
  for (const st of C.steps || []) {
    let p = st.pts3;
    if (!p || p.length < 2) continue;
    if (HA) {
      // P1: an OSM flight from the real ground at its two ends (0.3 m past each end: the foot and the head)
      const a0 = p[0], b0 = p[p.length - 1], L0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]);
      if (haZone((a0[0] + b0[0]) / 2, (a0[1] + b0[1]) / 2) || L0 < 0.8) continue;
      const ux = (b0[0] - a0[0]) / L0, uz = (b0[1] - a0[1]) / L0;
      const ga = gS(a0[0] - ux * 0.3, a0[1] - uz * 0.3), gb = gS(b0[0] + ux * 0.3, b0[1] + uz * 0.3);
      if (ga === null || gb === null) continue;
      p = [[a0[0], a0[1], ga - LIFT], [b0[0], b0[1], gb - LIFT]];
      const ea = [a0[0] - ux * 0.3, a0[1] - uz * 0.3, ga], eb = [b0[0] + ux * 0.3, b0[1] + uz * 0.3, gb], lo = ga < gb ? ea : eb, hi = ga < gb ? eb : ea;
      if (Math.abs(gb - ga) >= 0.22) haFoot('campus', `step:${a0[0].toFixed(1)},${a0[1].toFixed(1)}`, 'flight', lo[0], lo[1], lo[2], { x1: hi[0], z1: hi[1], y1: hi[2] });
    }
    const a = p[0], b = p[p.length - 1];
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (!HA && inZone(mx, mz)) continue;
    const rise = b[2] - a[2];
    // near the terrace pads the flattening leaves residual sub-0.6m "rises"
    // pointing arbitrary directions — a wrong-facing stair is worse than none
    if (!HA && Math.abs(rise) < 0.6 && distAlma(mx, mz) < 120) continue;
    stairRun(rise > 0 ? a : b, rise > 0 ? b : a, Math.min(14, st.width || 3.2), false);
  }
  /* ===================== THE McKIM AXIS =====================================
  College Walk -> Low Plaza -> the grand staircase -> the terrace -> Low.
  Fitted to what the compiler actually builds (probed; docs/notes/columbia.md):
  the plaza apron is flat at padApron from along -38 to -8 with a ~55 m
  half-width, the ramp to the plateau runs along -8 .. +14 inside a corridor
  only 27 m half-wide, and the plateau starts at along +14. So the two real
  flights become three fitted flights with landings, Alma stands on the middle
  landing (where she really is - part way up, at the head of the second flight,
  with the steps continuing behind her), and the rest of the ramp is decked in
  granite. `along` = m north of the Alma node on the axis, `across` = m east.
  ========================================================================== */
  const yawAxis = Math.atan2(AX, AZ);   // treads/kerbs run across the axis

  // one monumental flight, (a0,c0) -> (a1,c1), n risers, w metres wide. Every
  // tread block is skirted 2.6 m down: a flight sits 0..1.9 m above the
  // compiled ramp, so the skirt buries the terrain instead of letting it saw
  // up through the treads. Each tread also gets its own collider so the
  // staircase is walkable rather than a ramp you sink into.
  const flightAt = (a0, c0, a1, c1, y0, y1, w, n) => {
    const p0 = relPt(a0, c0), p1 = relPt(a1, c1);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (L < 0.5 || n < 1) return;
    const dx = (p1[0] - p0[0]) / L, dz = (p1[1] - p0[1]) / L;
    const yaw = Math.atan2(dx, dz), run = L / n, rise = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * run;
      const cx = p0[0] + dx * t, cz = p0[1] + dz * t, top = y0 + rise * (i + 1);
      granite.add(cx, top - 1.3, cz, w, 2.6, run + 0.04, yaw);
      addPrism(rectPts(cx, cz, w / 2, run / 2 + 0.02, yaw), top - 0.45, top, true);
    }
  };
  // granite slab: along a0..a1 x across c0..c1, walking surface at y
  const slab = (a0, a1, c0, c1, y, thick = 2.8) => {
    const c = relPt((a0 + a1) / 2, (c0 + c1) / 2);
    granite.add(c[0], y - thick / 2, c[1], Math.abs(c1 - c0), thick, Math.abs(a1 - a0), yawAxis);
    addPrism(rectPts(c[0], c[1], Math.abs(c1 - c0) / 2, Math.abs(a1 - a0) / 2, yawAxis), y - 0.6, y, true);
  };
  // retaining wall carrying a granite plinth, baluster row and hand rail; yWall
  // is the walking level at the TOP of the wall (the balustrade sits on it)
  const parapet = (a0, c0, a1, c1, yFoot, yWall) => {
    const p0 = relPt(a0, c0), p1 = relPt(a1, c1);
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    if (L < 0.8) return;
    const dx = (p1[0] - p0[0]) / L, dz = (p1[1] - p0[1]) / L;
    const yaw = Math.atan2(dx, dz);
    const cx = (p0[0] + p1[0]) / 2, cz = (p0[1] + p1[1]) / 2;
    stone.add(cx, (yFoot - 1.8 + yWall) / 2, cz, 0.62, yWall - yFoot + 1.8, L, yaw);
    granite.add(cx, yWall + 0.09, cz, 0.88, 0.18, L + 0.08, yaw);        // plinth
    const nB = Math.max(2, Math.floor(L / 0.46));
    for (let k = 0; k < nB; k++) {
      const t = (k + 0.5) / nB;
      balB.add(p0[0] + dx * L * t, yWall + 0.52, p0[1] + dz * L * t, 0.13, 0.68, 0.13, yaw);
    }
    granite.add(cx, yWall + 0.94, cz, 0.72, 0.16, L + 0.08, yaw);        // hand rail
    addPrism(rectPts(cx, cz, 0.44, L / 2 + 0.04, yaw), yFoot - 1.2, yWall + 1.1);
  };
  // the same balustrade raked down a flight, in level blocks (as built)
  const rakedParapet = (a0, a1, cA, y0, y1, seg) => {
    for (let i = 0; i < seg; i++) {
      const ym = y0 + (y1 - y0) * (i + 0.5) / seg;
      parapet(a0 + (a1 - a0) * i / seg, cA, a0 + (a1 - a0) * (i + 1) / seg, cA, ym - 1.2, ym + 0.15);
    }
  };
  const urnPier = (a, c, y, h = 2.4, w = 1.85) => {
    const p = relPt(a, c), k = w / 1.85;
    stone.add(p[0], y + h / 2 - 0.3, p[1], w, h + 0.6, w, yawAxis);
    granite.add(p[0], y + h + 0.13, p[1], w * 1.19, 0.26, w * 1.19, yawAxis);
    uniq.add(cyl(GRANITE, 0.4 * k, 0.5 * k, 0.6 * k, p[0], y + h + 0.56 * k, p[1], 12));
    const urn = new THREE.Mesh(new THREE.SphereGeometry(0.52 * k, 12, 10), GRANITE);
    urn.scale.set(1, 1.18, 1); urn.position.set(p[0], y + h + 1.3 * k, p[1]); urn.castShadow = true;
    uniq.add(urn);
    addPrism(rectPts(p[0], p[1], w * 0.53, w * 0.53, yawAxis), y - 1.2, y + h + 0.4);
  };

  const yL1 = yApron + (yTop - yApron) / 3, yL2 = yApron + 2 * (yTop - yApron) / 3;
  const yDeck = yTop + 0.05;      // granite walking level on the terrace masses
  // ---- P1 TERRAIN: the McKim axis on the real ground (see the note at the top of buildCampus)
  const gAC = (a, c) => { const q = relPt(a, c); return gS(q[0], q[1]); };
  let haAlma = null;   // Alma Mater's landing: [along, y]
  const haAxis = () => {
    // the flights on the line of constant across c within [a0, a1]: runs steeper than 1 in 6 over a metre (the plaza and
    // the landings are under 3 %), refined to where the ground leaves the foot and reaches the head
    const runsOn = (c, a0, a1) => {
      const P = [];
      for (let a = a0; a <= a1 + 1e-6; a += 0.25) P.push([a, gAC(a, c)]);
      const R = [];
      let st = -1;
      for (let i = 2; i < P.length - 2; i++) {
        const g0 = P[i - 2][1], g1 = P[i + 2][1];
        const steep = g0 !== null && g1 !== null && g1 - g0 > 0.16;
        if (steep && st < 0) st = i;
        if ((!steep || i === P.length - 3) && st >= 0) {
          const u = P[st][0], w = P[i][0];
          if (w - u >= 1.0) {
            const foot = gAC(u - 1.0, c), head = gAC(w + 1.0, c);
            if (foot !== null && head !== null && head - foot > 0.3) {
              let us = u, ws = w;
              for (let a = u - 1.0; a <= w; a += 0.05) { const g = gAC(a, c); if (g !== null && g > foot + 0.04) { us = a - 0.05; break; } }
              for (let a = w + 1.0; a >= u; a -= 0.05) { const g = gAC(a, c); if (g !== null && g < head - 0.04) { ws = a + 0.05; break; } }
              R.push({ u: us, w: ws, foot: gAC(us - 0.3, c), head: gAC(ws + 0.3, c) });
            }
          }
          st = -1;
        }
      }
      return R;
    };
    // one flight over the across strips that carry it, outward from the axis while the strip's rise is the axis's
    const flight = (A0, A1, tag) => {
      const ax = runsOn(0, A0, A1);
      if (!ax.length) return null;
      const F = ax.reduce((m, r) => (r.head - r.foot > m.head - m.foot ? r : m));
      const strips = [];
      for (const dir of [1, -1]) {
        for (let k = dir > 0 ? 0 : 1; k < 16; k++) {
          const c = dir * (k * 4);
          const r = runsOn(c, F.u - 2.5, F.w + 2.5).find((q) => q.w > F.u - 1 && q.u < F.w + 1);
          if (!r || Math.abs((r.head - r.foot) - (F.head - F.foot)) > 0.6 * (F.head - F.foot)) break;
          strips.push({ c0: c - 2, c1: c + 2, ...r });
        }
      }
      // a strip whose foot or head varies more than 5 cm across it is halved (down to 1 m)
      const lay = (S0, depth) => {
        const cm = (S0.c0 + S0.c1) / 2, wdt = S0.c1 - S0.c0, cs = [S0.c0 + 0.15, S0.c0 + wdt * 0.25, cm, S0.c0 + wdt * 0.75, S0.c1 - 0.15];
        const gm = (a) => { let m = -Infinity; for (const c of cs) { const g = gAC(a, c); if (g !== null) m = Math.max(m, g); } return Number.isFinite(m) ? m : null; };
        const spread = (a) => { let lo = Infinity, hi = -Infinity; for (const c of cs) { const g = gAC(a, c); if (g !== null) { lo = Math.min(lo, g); hi = Math.max(hi, g); } } return hi - lo; };
        if (wdt > 1.1 && depth < 3 && (spread(S0.u - 0.6) > 0.05 || spread(S0.w + 0.6) > 0.05)) {
          lay({ ...S0, c1: cm }, depth + 1); lay({ ...S0, c0: cm }, depth + 1);
          return;
        }
        // the strip's flight: uniform risers of about 0.155 m from the landing at its foot to the one at its head, laid so
        // the line through the inner corners (where each riser meets the tread below it) never dips under the ground: the
        // flight starts at r0, the latest start that keeps that line over the strip's highest ground at every station
        // (the foot on the lowest ground across the strip, the riser's base set into the higher side; the head on the highest)
        const gl = (a) => { let m = Infinity; for (const c of cs) { const g = gAC(a, c); if (g !== null) m = Math.min(m, g); } return Number.isFinite(m) ? m : null; };
        let foot = Infinity, head = -Infinity;
        for (let a = S0.u - 1.5; a <= S0.u - 0.3; a += 0.1) { const g = gl(a); if (g !== null) foot = Math.min(foot, g); }
        for (let a = S0.w + 0.3; a <= S0.w + 1.2; a += 0.1) { const g = gm(a); if (g !== null) head = Math.max(head, g); }
        if (!Number.isFinite(foot) || !Number.isFinite(head) || head - foot < 0.25) return;
        // an edge strip that rises otherwise than the flight is the side terrain, not the flight
        if (Math.abs((head - foot) - (F.head - F.foot)) > 0.3 * (F.head - F.foot)) return;
        const rise = head - foot, n = Math.max(1, Math.round(rise / 0.155)), rh = rise / n;
        const tr = Math.min(0.6, Math.max(0.28, (S0.w - S0.u) / n)), slope = rh / tr;
        let r0 = S0.u;
        for (let a = S0.u - 1.5; a <= S0.w + 1.5; a += 0.1) { const g = gm(a); if (g !== null && g > foot + 0.005 && g < head) r0 = Math.min(r0, a - (g - foot) / slope); }
        // the top tread runs on to where the ground reaches the head (the ramp's rounded top under it)
        let E = r0 + n * tr;
        for (let a = r0 + n * tr; a <= S0.w + 1.5; a += 0.05) { const g = gm(a); if (g !== null && g >= head - 0.03) { E = a; break; } E = a; }
        const S = { ...S0, u: r0, w: r0 + n * tr, foot, head };
        // its foot and head must meet the ground on the strip's centre line: halve it, or (at 1 m) leave it to the terrain
        const gf = gAC(S.u - 0.3, cm), gh = gAC(Math.max(E, S.w) + 0.3, cm);
        if (gf === null || gh === null || Math.abs(gf - foot) > 0.05 || Math.abs(gh - head) > 0.05) {
          if (wdt > 1.1 && depth < 3) { lay({ ...S0, c1: cm }, depth + 1); lay({ ...S0, c0: cm }, depth + 1); }
          return;
        }
        let lo = Math.min(S.foot, S.head);
        for (let t = 0; t <= 1.0001; t += 0.125) for (const cc of [S.c0 - 0.4, cm, S.c1 + 0.4]) { const g = gAC(S.u + (S.w - S.u) * t, cc); if (g !== null) lo = Math.min(lo, g); }
        for (let i = 0; i < n; i++) {
          const a0 = S.u + i * tr, a1 = i === n - 1 ? Math.max(E, S.u + n * tr) : S.u + (i + 1) * tr, d = a1 - a0, am = (a0 + a1) / 2;
          const top = S.foot + rh * (i + 1) + 0.01, q = relPt(am, cm), h = top - (lo - 0.3);
          granite.add(q[0], top - h / 2, q[1], wdt + 0.01, h, d + 0.03, yawAxis);
          addPrism(rectPts(q[0], q[1], wdt / 2, d / 2 + 0.01, yawAxis), top - 0.45, top, true);
          const pts = [];
          for (const da of [-0.45, 0, 0.45]) for (const dc of [-0.45, 0, 0.45]) pts.push(relPt(am + da * d, cm + dc * wdt));
          haFoot('campus', `${tag}:${cm}:${i}`, 'deck', q[0], q[1], top, { pts, skirt: h });
        }
        const qf = relPt(S.u - 0.3, cm), qh = relPt(Math.max(E, S.w) + 0.3, cm);
        haFoot('campus', `${tag}:${cm}`, 'flight', qf[0], qf[1], S.foot, { x1: qh[0], z1: qh[1], y1: S.head });
      };
      for (const S0 of strips) lay(S0, 0);
      return { ...F, strips: strips.length };
    };
    const south = flight(-45, -27, 'southSteps');
    const g1 = flight(-13, -5, 'grandA');
    const g2 = flight(-5.5, 3, 'grandB');
    // Alma Mater on the landing at the head of the grand flights, clear of the last tread
    const aA = Math.max(0.35, (g2 ? g2.w : 0) + 1.6);
    let ay = -Infinity;
    for (let da = -1.2; da <= 1.2; da += 0.4) for (let dc = -1.2; dc <= 1.2; dc += 0.4) { const g = gAC(aA + da, dc); if (g !== null) ay = Math.max(ay, g); }
    haAlma = Number.isFinite(ay) ? [aA, ay] : null;
    console.log('[terrain p1] campus axis:', JSON.stringify({ south, g1, g2, alma: haAlma }));
  };
  if (HA) haAxis();
  // P1 (second pass): Low's terrace between the head of the steps and Low's own stair is brick with pale granite joint
  // bands (the flat kit's field over its slab, (3) below, which the flag leaves out with the flat axis); on the real ground
  // the terrace rises 0.5 m toward Low, so the field is draped on the drawn ground (a 0.5 m grid, 4 cm over it, its edges
  // turned down 8 cm) and the joints over it as draped ribbons 1.5 cm higher, as the flat field lays them
  if (HA) {
    const drape = (mat, a0, a1, c0, c1, dy, tag) => {
      const na = Math.max(1, Math.ceil((a1 - a0) / 0.5)), nc = Math.max(1, Math.ceil((c1 - c0) / 0.5)), P = [], I = [];
      const at = (a, c) => { const q = relPt(a, c), y = gS(q[0], q[1]); return [q[0], (y === null ? 0 : y) + dy, q[1]]; };
      for (let i = 0; i <= na; i++) for (let j = 0; j <= nc; j++) P.push(...at(a0 + ((a1 - a0) * i) / na, c0 + ((c1 - c0) * j) / nc));
      const id = (i, j) => i * (nc + 1) + j;
      for (let i = 0; i < na; i++) for (let j = 0; j < nc; j++) I.push(id(i, j), id(i, j + 1), id(i + 1, j), id(i + 1, j), id(i, j + 1), id(i + 1, j + 1));
      // the edges turned down: a skirt under each border line
      const base = P.length / 3, edge = [];
      for (let i = 0; i <= na; i++) edge.push(id(i, 0));
      for (let j = 1; j <= nc; j++) edge.push(id(na, j));
      for (let i = na - 1; i >= 0; i--) edge.push(id(i, nc));
      for (let j = nc - 1; j >= 1; j--) edge.push(id(0, j));
      for (const k of edge) P.push(P[3 * k], P[3 * k + 1] - 0.08, P[3 * k + 2]);
      for (let e = 0; e < edge.length; e++) { const k0 = edge[e], k1 = edge[(e + 1) % edge.length], b0 = base + e, b1 = base + ((e + 1) % edge.length); I.push(k0, b0, k1, k1, b0, b1); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
      geo.setIndex(I);
      geo.computeVertexNormals();
      // (the winding: up-facing when the frame's mirror flips it)
      const nrm = geo.attributes.normal.array;
      if (nrm[1] < 0) { const ix = geo.index.array; for (let q = 0; q < ix.length; q += 3) { const t = ix[q + 1]; ix[q + 1] = ix[q + 2]; ix[q + 2] = t; } geo.computeVertexNormals(); }
      const m = new THREE.Mesh(geo, mat);
      m.receiveShadow = true;
      g.add(m);
      // (the gate: the field's corners and middle at their own ground + dy)
      for (const [a, c] of [[a0, c0], [a0, c1], [a1, c0], [a1, c1], [(a0 + a1) / 2, (c0 + c1) / 2]]) { const v = at(a, c); haFoot('campus', `drape:${tag}:${a.toFixed(1)},${c.toFixed(1)}`, 'top', v[0], v[2], v[1], { ref: (gS(v[0], v[2]) ?? v[1] - dy) + dy, tol: 0.02, why: 'drape off the ground' }); }
    };
    drape(PAVBRICK, 7.4, 16.4, -29, 29, 0.04, 'lowBrick');
    for (let k = -7; k <= 7; k++) drape(GRANITE, 7.4, 16.4, k * 4.05 - 0.26, k * 4.05 + 0.26, 0.055, `lowJointC${k}`);
    for (const a of [8.0, 11.9, 15.8]) drape(GRANITE, a - 0.26, a + 0.26, -29, 29, 0.055, `lowJointA${a}`);
    if (TB32) drape(GRANITE, 7.36, 7.74, -29.2, 29.2, 0.055, 'lowBorder');
  }
  // P1: McKim's balustrades on the real terrace walls (the authority's wall registry: slits the ground's builder faces in
  // masonry): along every run of the McKim core (along -48..+26, across +-75) that drops 1 m or more, a granite plinth,
  // balusters and a rail 0.45 m in from the edge on its upper side, piece by piece on the drawn ground there
  if (HA) {
    try {
      const WR = await haRegistry('walls');
      const bal = (x0, z0, x1, z1, y) => {
        const L = Math.hypot(x1 - x0, z1 - z0);
        if (L < 0.6) return;
        const yaw = Math.atan2(x1 - x0, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, dx = (x1 - x0) / L, dz = (z1 - z0) / L;
        granite.add(cx, y + 0.09, cz, 0.62, 0.18, L + 0.04, yaw);
        const nB = Math.max(1, Math.floor(L / 0.46));
        for (let k = 0; k < nB; k++) { const t = (k + 0.5) / nB; balB.add(x0 + dx * L * t, y + 0.52, z0 + dz * L * t, 0.13, 0.68, 0.13, yaw); }
        granite.add(cx, y + 0.94, cz, 0.5, 0.16, L + 0.04, yaw);
        addPrism(rectPts(cx, cz, 0.3, L / 2, yaw), y, y + 1.05);
        haFoot('campus', `balustrade:${cx.toFixed(1)},${cz.toFixed(1)}`, 'foot', cx, cz, y, { pts: [[x0, z0], [cx, cz], [x1, z1]] });
      };
      let nRun = 0;
      for (const w of (WR && WR.walls) || []) {
        const P = w.xz;
        if (!P || P.length < 3) continue;
        const ac = P.map(([x, z]) => [(x - alma[0]) * AX + (z - alma[1]) * AZ, (x - alma[0]) * -AZ + (z - alma[1]) * AX]);
        if (!ac.some(([a, c]) => a > -48 && a < 26 && Math.abs(c) < 75)) continue;
        let used = false;
        for (let i = 0; i + 1 < P.length; i++) {
          const [a, c] = ac[i];
          if (!(a > -48 && a < 26 && Math.abs(c) < 75)) continue;
          const rl = w.reliefLeft[i], rr = w.reliefRight[i];
          if (rl === null || rr === null || Math.abs(rl - rr) < 1.0) continue;
          // the upper side: left = +normal of the run (-tz, tx)
          const tx = P[i + 1][0] - P[i][0], tz = P[i + 1][1] - P[i][1], tl = Math.hypot(tx, tz) || 1, nx = -tz / tl, nz = tx / tl, sg = rl > rr ? 1 : -1;
          const o = 0.45 * sg, x0 = P[i][0] + nx * o, z0 = P[i][1] + nz * o, x1 = P[i + 1][0] + nx * o, z1 = P[i + 1][1] + nz * o;
          const ys = [gS(x0, z0), gS(x1, z1), gS((x0 + x1) / 2, (z0 + z1) / 2)];
          if (ys.some((v) => v === null) || Math.max(...ys) - Math.min(...ys) > 0.3) continue;   // (not where the wall's top falls away: its ends)
          const y = Math.min(...ys);   // (on the lowest of its ends and middle)
          bal(x0, z0, x1, z1, y);
          used = true;
        }
        if (used) nRun++;
      }
      console.log(`[terrain p1] campus balustrades on ${nRun} wall runs`);
    } catch (e) { console.warn('[terrain p1] campus balustrades', e); }
  }
  if (!HA) {
  // (1) College Walk band -> the plaza apron: the plaza's south steps.
  // The COMPILED brick ramp under this runs along -45 .. -37 at ~0.14 m/m
  // (probed on tiles_flat4 at across 0, +-30, +-50). Round 1 fitted the flight
  // to -43.6 .. -38.6 -- steeper than the ramp and starting 0.16 m below it --
  // so the ramp sawed up through the treads and the whole foreground read as
  // slabs with jagged dark wedges (shots/v4/columbiaLow_day_v4b, and the matId
  // palette shots/v2/columbiaLow_day_v2dbg). A synthetic flight over a compiled
  // ramp must either span the ramp end to end or, as here, stand on the FLAT
  // walk at its foot with the rest of the ramp decked over.
  const ySouth = yApron + 0.05;
  flightAt(-46.4, 0, -42.4, 0, yWalk, ySouth, 104, 8);   // 8 x 0.154 on 0.50 m treads
  slab(-42.5, -36.4, -54.4, 54.4, ySouth, 3.4);          // buries the rest of the ramp
  for (const s of [-1, 1]) {
    parapet(-46.6, 53.0 * s, -42.2, 53.0 * s, yWalk - 0.4, ySouth + 0.15);
    urnPier(-47.0, 53.0 * s, yWalk, 2.6);
    urnPier(-41.8, 53.0 * s, ySouth, 2.6);
  }
  // (2) the grand staircase: 3 x 12 risers with two landings
  flightAt(-14.0, 0, -8.6, 0, yApron, yL1, 74, 12);
  slab(-8.7, -6.4, -37, 37, yL1);
  flightAt(-6.5, 0, -1.6, 0, yL1, yL2, 50, 12);
  slab(-1.7, 2.2, -25, 25, yL2);                     // Alma Mater's landing
  flightAt(2.1, 0, 7.1, 0, yL2, yTop, 50, 12);
  // (3) the granite terrace between the head of the steps and Low's own stair.
  // In the view south from Low's steps that terrace is BRICK with pale stone
  // joints, not a bare granite plate, and it is the largest single surface in
  // the campus's most photographed framing — so lay the brick panels on it.
  slab(7.0, 16.8, -30, 30, yTop + 0.03);
  {
    // one brick field with pale granite joint bands over it: laying discrete
    // brick panels instead read as two big red plates at a grazing angle
    const p0 = relPt(11.9, 0);
    brickB.add(p0[0], yTop + 0.055, p0[1], 58, 0.08, 9.0, yawAxis);
    for (let k = -7; k <= 7; k++) {                      // joints across the axis
      const p = relPt(11.9, k * 4.05);
      granite.add(p[0], yTop + 0.070, p[1], 0.52, 0.08, 9.0, yawAxis);
    }
    for (const a of [8.0, 11.9, 15.8]) {                 // and along it
      const p = relPt(a, 0);
      granite.add(p[0], yTop + 0.070, p[1], 58, 0.08, 0.52, yawAxis);
    }
    // TB32 (owner 2026-09-29, of the ground in another shot: "I don't like low-quality lines"): the field's south edge
    // stood 6.5 cm proud of the slab at the head of the steps, a thin red line across the whole staircase in the College
    // Walk shots. A granite border in front of it, at the joint bands' height, as the terrace is laid.
    if (TB32) { const p = relPt(7.55, 0); granite.add(p[0], yTop + 0.070, p[1], 58.4, 0.08, 0.38, yawAxis); }   // 7.36-7.74, to the first band
  }
  /* ============ Low Plaza's retaining walls (built on C.terraceEdges) =======
  The compiler hands us the analytic seams of the terrace model in
  `C.terraceEdges`: the plaza flanks at |across| 58.4 (along -40.4..-1.5) and
  the parterre-north line at along -1.5 (|across| 29.5..58.4), each with the
  paved level either side (4.70 apron / 10.20 plateau).

  Probed on tiles_flat4, each seam is the MID-LINE of a ~7 m wide bank, not a
  vertical cut -- the visible ground (max of the terrain grid and the compiled
  surface polygons) ramps straight through it:

     flank, along -38:   |c| 52..54 = 4.71, 56 = 4.82, 58 = 7.22, 60 = 9.61,
                         62 = 10.08  ->  toe |c| ~54.5, crest ~61.5
     north, across 45:   along -8 = 4.74, -6 = 5.60, -2 = 7.32, +1 = 10.08
                         ->  toe along ~-8.3, crest ~+1

  So a thin plate ON the seam leaves the bank standing 2.5 m proud in FRONT of
  it -- which is what round 1's 0.62 m `parapet` at along -1.6 did, and why the
  brown wedges either side of the cascade survive into n0_air_day.png. Each
  wall is therefore a SOLID granite mass running from the bank's toe to well
  behind its crest, with the dressed face on the toe and the walk on top.  */
  const CF = 54.6, CB = 63.0;      // flank wall: dressed face / back of the mass
  const AF = -8.4, AB = 1.8;       // parterre-north wall: face / back of the mass
  const CT = 25.7, CTB = 37.8;     // the cascade's own flanking terraces
  // a box in the campus-axis frame: centred at (a, c), dc across x da along
  const cbox = (b, a, c, dc, h, da, yMid) => {
    const p = relPt(a, c);
    b.add(p[0], yMid, p[1], dc, h, da, yawAxis);
  };
  /* One dressed retaining-wall face: base plinth, string course, moulded cap
     and pilaster piers, all projecting `dir` from the face plane into the open
     air. `isAlongFace` = the face is a constant-ALONG line (it looks south);
     otherwise it is a constant-ACROSS line. `v` is the face's own coordinate,
     u0..u1 the run. 5.5 m of undressed ashlar reads as a retaining dam; the
     three horizontals and the pier rhythm are what make it read as McKim. */
  const dressFace = (isAlongFace, v, u0, u1, dir, yFoot, yCap) => {
    const L = Math.abs(u1 - u0), um = (u0 + u1) / 2;
    if (L < 1.0) return;
    const put = (b, proud, h, yMid, run, uc) => {
      const vv = v + dir * proud / 2;
      if (isAlongFace) cbox(b, vv, uc, run, h, proud, yMid);
      else cbox(b, uc, vv, proud, h, run, yMid);
    };
    // the ASHLAR FIELD is faced in the darker STONE and only the dressed courses
    // and piers are granite. Without the value break the whole 5.5 m face
    // rendered as one flat white plate under the noon sun (n1_flankE_day.png)
    put(stone, 0.12, yCap - yFoot - 0.20, (yFoot + yCap) / 2 - 0.10, L, um);
    put(granite, 0.26, 1.10, yFoot + 0.55, L, um);              // base plinth
    put(granite, 0.17, 0.26, yFoot + 3.10, L, um);              // string course
    put(granite, 0.34, 0.48, yCap - 0.24, L, um);               // moulded cap
    const n = Math.max(1, Math.round(L / 7.6));
    for (let k = 0; k < n; k++) {
      const uc = u0 + (u1 - u0) * (k + 0.5) / n;
      put(granite, 0.32, yCap - yFoot, (yFoot + yCap) / 2, 1.80, uc);  // pilaster pier
      put(granite, 0.46, 0.36, yCap - 0.18, 2.26, uc);                 // its own cap
    }
  };
  const SA0 = -27.0, SA1 = -13.9;   // the flank stair's opening in the balustrade
  for (const s of [-1, 1]) {
    // ---- (a) the plaza's flank wall, Dodge side and Kent side
    slab(-40.8, AF + 0.2, CF * s, CB * s, yDeck, 7.6);
    dressFace(false, CF * s, -40.8, AF + 0.2, -s, yApron - 0.5, yDeck);
    // the balustrade walks the top, broken where the stair comes through
    parapet(-40.6, (CF + 0.62) * s, SA0, (CF + 0.62) * s, yDeck - 1.3, yDeck);
    parapet(SA1, (CF + 0.62) * s, AF, (CF + 0.62) * s, yDeck - 1.3, yDeck);
    urnPier(-40.2, (CF + 1.05) * s, yDeck, 1.9, 1.35);
    urnPier(SA0 - 0.7, (CF + 1.05) * s, yDeck, 1.9, 1.35);
    urnPier(SA1 + 0.7, (CF + 1.05) * s, yDeck, 1.9, 1.35);
    // ---- (b) the parterre-north wall, flanking the head of the cascade
    slab(AF, AB, CTB * s, CB * s, yDeck, 7.6);
    dressFace(true, AF, CTB * s, (CB - 0.4) * s, -1, yApron - 0.5, yDeck);
    parapet(AF + 0.62, CTB * s, AF + 0.62, (CB - 0.8) * s, yDeck - 1.3, yDeck);
    urnPier(AF + 1.05, (CTB + 0.9) * s, yDeck, 1.9, 1.35);
    urnPier(AF + 1.05, (CB - 1.4) * s, yDeck, 1.9, 1.35);
    // ---- (c) the cascade's flanking terraces. Flights B and C run in a slot
    // between them (the compiled ramp corridor is only 27-29 m half-wide, so
    // the plateau really does come up to the steps here); flight A is 74 m
    // wide and still gets its raked balustrade out in the open plaza.
    rakedParapet(-14.2, -8.5, 37.4 * s, yApron, yL1, 4);
    urnPier(-14.6, 37.4 * s, yApron, 2.4);
    slab(-6.45, 7.5, CT * s, CTB * s, yDeck, 7.6);
    dressFace(false, CT * s, -6.45, 7.5, -s, yL1 - 1.6, yDeck);
    dressFace(true, -6.45, CT * s, CTB * s, -1, yL1 - 1.6, yDeck);   // its south return
    parapet(-6.3, (CT + 0.62) * s, 7.4, (CT + 0.62) * s, yDeck - 1.3, yDeck);
    urnPier(-5.9, (CT + 1.05) * s, yDeck, 1.9, 1.35);
    urnPier(7.0, (CT + 1.05) * s, yDeck, 1.9, 1.35);
    // ---- (d) the stair from Low Plaza up to Kent (east) / Dodge (west).
    // "the iconic granite steps and handrails leading from Low Plaza to Kent
    // and Dodge Halls" (Columbia Design & Construction, 2023 Low Steps
    // restoration). 36 x 0.154 on 0.44 m treads, arriving on the wall's deck;
    // 12 m wide so its own skirts bury the compiled stair ramp under it.
    flightAt(-20.45, 39 * s, -20.45, (CF + 0.2) * s, yApron, yDeck, 12.0, 36);
    for (const e of [-1, 1]) {
      // raked cheek walls of the side flight (they run across the axis)
      for (let i = 0; i < 6; i++) {
        const c0 = 39 + i * 2.6, c1 = 39 + (i + 1) * 2.6;
        const ym = yApron + (yDeck - yApron) * (i + 0.5) / 6;
        parapet(-20.45 + e * 6.3, c0 * s, -20.45 + e * 6.3, c1 * s, ym - 1.5, ym + 0.15);
      }
    }
  }
  }
  /* (4) the College Walk gates at Broadway and Amsterdam. Reference:
  `Columbia University Entrance (Oct. 2024).jpg` (Commons) -- RUSTICATED granite
  piers in five deep banded courses, a moulded cap carrying a classical stone
  URN, a low balustraded dwarf wall returning from each pier, and tall black
  wrought-iron leaves with spear finials and a scrolled frieze band. The walk
  skews ~1.3 deg to the axis, so track it off walkLine. */
  // (P1: the gates, the kerbs and the medallions are flat-authored: lifted at each piece's footing)
  const uniq0 = uniq.children.length;
  BOX_LIFT = HA ? (x, z) => { const g = gS(x, z); return g === null ? 0 : g - yWalk; } : null;
  for (const s of [-1, 1]) {
    const cG = 129 * s, aG = -52.5 - 0.0231 * cG;
    for (const e of [-1, 1]) {
      const p = relPt(aG + e * 9.2, cG);
      for (let k = 0; k < 5; k++) {                                  // banded rustication
        const w = k % 2 ? 1.70 : 1.56;
        stone.add(p[0], yWalk + 0.46 + k * 0.92, p[1], w, 0.92, w, yawAxis);
      }
      granite.add(p[0], yWalk + 4.72, p[1], 1.98, 0.26, 1.98, yawAxis);   // cap
      granite.add(p[0], yWalk + 4.98, p[1], 1.30, 0.26, 1.30, yawAxis);
      uniq.add(cyl(GRANITE, 0.30, 0.44, 0.44, p[0], yWalk + 5.33, p[1], 12));  // the urn
      const bowl = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 9), GRANITE);
      bowl.scale.set(1, 0.86, 1); bowl.position.set(p[0], yWalk + 5.78, p[1]);
      bowl.castShadow = true; uniq.add(bowl);
      uniq.add(cyl(GRANITE, 0.20, 0.30, 0.12, p[0], yWalk + 6.10, p[1], 12));
      addPrism(rectPts(p[0], p[1], 0.9, 0.9, yawAxis), yWalk - 1, yWalk + 4.9);
      // the balustraded dwarf wall returning outward from the pier
      for (let k = 0; k < 7; k++) {
        const q = relPt(aG + e * (9.2 + 1.5 + k * 0.52), cG);
        if (k === 0) {
          stone.add(q[0], yWalk + 0.42, q[1], 0.52, 0.84, 4.4, yawAxis);
          granite.add(q[0], yWalk + 0.90, q[1], 0.66, 0.14, 4.6, yawAxis);
          granite.add(q[0], yWalk + 1.66, q[1], 0.58, 0.14, 4.6, yawAxis);
        }
        for (const d of [-1.4, 0, 1.4]) {
          const b = relPt(aG + e * (9.2 + 1.8 + k * 0.52), cG + d);
          balB.add(b[0], yWalk + 1.30, b[1], 0.12, 0.62, 0.12, yawAxis);
        }
      }
      // one open iron leaf swung back against each pier: pickets with spear
      // finials under a scrolled frieze band
      for (let k = 0; k < 13; k++) {
        const q = relPt(aG + e * (9.2 - 0.35), cG - s * (0.9 + k * 0.26));
        fenceB.add(q[0], yWalk + 1.55, q[1], 0.07, 3.1, 0.07, yawAxis);
        fenceB.add(q[0], yWalk + 3.22, q[1], 0.05, 0.24, 0.05, yawAxis);   // spear finial
        if (k % 3 === 1) fenceB.add(q[0], yWalk + 2.86, q[1], 0.16, 0.30, 0.05, yawAxis);
      }
      const gr = relPt(aG + e * 8.85, cG - s * 2.5);
      fenceB.add(gr[0], yWalk + 3.10, gr[1], 3.5, 0.13, 0.14, yawAxis + Math.PI / 2);
      fenceB.add(gr[0], yWalk + 2.62, gr[1], 3.5, 0.09, 0.10, yawAxis + Math.PI / 2);
      fenceB.add(gr[0], yWalk + 0.35, gr[1], 3.5, 0.12, 0.14, yawAxis + Math.PI / 2);
    }
  }
  liftKids(uniq, uniq0, yWalk);
  const uniqM = uniq.children.length;
  // (5) granite kerbs around the plaza parterres and the upper-campus lawns:
  // every lawn edge is a raised granite kerb, never grass running into paving
  for (const gp of C.grass || []) {
    const pts = gp.pts;
    if (!pts || pts.length < 3) continue;
    let ca = 0, cc = 0;
    for (const p of pts) {
      ca += (p[0] - alma[0]) * AX + (p[1] - alma[1]) * AZ;
      cc += (p[0] - alma[0]) * -AZ + (p[1] - alma[1]) * AX;
    }
    ca /= pts.length; cc /= pts.length;
    if (ca < -70 || ca > 60 || Math.abs(cc) > 100) continue;
    // LP26: the Low Plaza parterres are the compiler's AUTHORED panels (compile.mjs PANEL_POLYS) with their own granite
    // edging; these raw OSM outlines there are ragged, so kerbs along them crossed the panel lawns off their real edges,
    // and where they met the compiled edging their tops were coplanar with it (both 4.79)
    if (LP26 && ca > -46 && ca < -2 && Math.abs(cc) < 54) continue;
    // TL26: the College Walk lawns (along < -44) lie on the walk datum, not the plaza apron: their kerbs floated 1.2 m up
    const kerbY = LP26 && ca < -44 ? yWalk : (ca < -6 && Math.abs(cc) < 56) ? yApron : yTop;
    // TL26: kerb tops 0.12 over the pad (was 0.09): the compiled beds now sit 4 cm higher (0.20 over terrain, 4 cm
    // over the brick ribbons that run across them), and the granite must stay proud of the grass it edges
    const kTop = LP26 ? 0.12 : 0.09;
    // P1: the kerb's zone level is the kit's, not the real ground's: each piece stands on the paving under it
    if (HA) BOX_LIFT = (x, z) => { const g = gS(x, z); return g === null ? 0 : g - kerbY; };
    for (let i = 0; i < pts.length; i++) {
      const [ax2, az2] = pts[i], [bx2, bz2] = pts[(i + 1) % pts.length];
      const L = Math.hypot(bx2 - ax2, bz2 - az2);
      if (L < 0.6) continue;
      granite.add((ax2 + bx2) / 2, kerbY + kTop - 0.25, (az2 + bz2) / 2, 0.34, 0.5, L + 0.34,
        Math.atan2(bx2 - ax2, bz2 - az2));
    }
  }

  // (6) Low Plaza paving: McKim's field is PALE STONE PANELS separated by wide
  // red-brick banding, with a broad brick walk on the axis and granite
  // medallions round the fountain pair (ref: the Commons frontal photo of Low
  // and the view south from its steps -- URLs in docs/notes/columbia.md).
  // The previous pass had this inverted, laying brick bands on the compiled
  // brick, which is why the plaza read as one dark field from the air. Only
  // the panels are kit geometry: the banding between them IS the compiled
  // brick, so if the plaza ever renders as lawn that is a ground-layer bug to
  // report, not something to plate over.
  {
    const PITCH = 5.35, CELL = 4.30, ROWS = 5, COLS = 16;
    const aC = -23.4;                                   // centre of the panel field
    // the parterre lawns beside the fountains (C.grass) keep their turf. The
    // field used to run straight over them, and the lawn's terrain cells rose
    // through the panel tops in a saw-tooth that shimmered as the camera moved
    // (owner review 2026-09-24, "the green in the low library is z fighting").
    const lawns = (C.grass || []).filter((gp) => gp.pts && gp.pts.length >= 3).map((gp) => gp.pts);
    const inLawn = (x, z) => lawns.some((P) => {
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, zi] = P[i], [xj, zj] = P[j];
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    });
    const onLawn = (a, c, h) => {
      for (let u = -1; u <= 1; u += 0.25) for (let v = -1; v <= 1; v += 0.25) {
        const q = relPt(a + u * h, c + v * h);
        if (inLawn(q[0], q[1])) return true;
      }
      return false;
    };
    // LP26 (owner 2026-09-25: "fix the weird square pads above the tile pattern near the fountains, they don't exist in
    // real life"). The compiled plaza already carries the real paving, red-brick squares nested on pale stone (the
    // reference top view); these kit panels were a misreading of it laid on top. `?lp26=0` keeps them.
    if (!LP26) for (let r = 0; r < ROWS; r++) for (let k = 0; k < COLS; k++) {
      const a = aC + (r - (ROWS - 1) / 2) * PITCH;
      const c = (k - (COLS - 1) / 2) * PITCH;
      // the fountains sit inside their own granite medallions
      if (Math.hypot(a + 20.5, Math.abs(c) - 23) < 7.6) continue;
      if (onLawn(a, c, CELL / 2 + 0.25)) continue;
      const p = relPt(a, c);
      // BoxBatch.add is CENTRE-based and padApron (4.70) is 1 cm BELOW the
      // compiled brick this sits on (measured 4.71), so the panel centre goes
      // 2 cm up with an 8 cm box: the top lands 5 cm proud of the brick (a
      // visible inlay, no z-fight) and the underside stays buried.
      stoneB.add(p[0], yApron + 0.02, p[1], CELL, 0.08, CELL, yawAxis);
    }
    // granite medallions under the fountain pair
    for (const s of [-1, 1]) {
      const p = relPt(-20.5, 23 * s);
      const med = new THREE.Mesh(new THREE.CylinderGeometry(6.1, 6.1, 0.1, 28), PAVSTONE);
      med.position.set(p[0], yApron + 0.045, p[1]);
      med.receiveShadow = true;
      uniq.add(med);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(6.05, 0.13, 6, 28), GRANITE);
      rim.rotation.x = Math.PI / 2; rim.position.set(p[0], yApron + 0.11, p[1]);
      uniq.add(rim);
    }
  }

  BOX_LIFT = null;
  liftKids(uniq, uniqM, yApron);
  if (HA) for (const s of [-1, 1]) for (const e of [-1, 1]) { const cG = 129 * s, p = relPt(-52.5 - 0.0231 * cG + e * 9.2, cG); haFoot('campus', `gate:${s}:${e}`, 'foot', p[0], p[1], gS(p[0], p[1]), { r: 0 }); }
  // ---------- retaining walls + terrace balustrades
  for (const wl of C.walls || []) {
    const p = wl.pts3;
    if (!p || p.length < 2) continue;
    const meanY = p.reduce((s, q) => s + q[2], 0) / p.length;
    const balustrade = meanY + LIFT > C.padTop - 1.5; // plateau-edge walls carry balustrades
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az, ay] = p[i], [bx, bz, by] = p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.4) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      const cx = (ax + bx) / 2, cz = (az + bz) / 2;
      let top = Math.max(ay, by) + LIFT + 0.72, base = Math.min(ay, by) + LIFT - 1.2;
      if (HA) {
        // P1: a retaining wall's line is a slit in the real ground: its cap 0.72 m over the higher side, its foot under
        // the lower, sampled 0.6 m either side of each end
        const nx = (bz - az) / L, nz = -(bx - ax) / L;
        let hi = -Infinity, lo = Infinity;
        for (const [px, pz, py] of [[ax, az, ay], [(ax + bx) / 2, (az + bz) / 2, (ay + by) / 2], [bx, bz, by]]) for (const o of [-1.2, -0.6, 0.6, 1.2]) {
          const g = gS(px + nx * o, pz + nz * o), v = g === null ? py + LIFT : g;
          hi = Math.max(hi, v); lo = Math.min(lo, v);
        }
        top = hi + 0.72; base = lo - 1.2;
        haFoot('campus', `wall:${cx.toFixed(1)},${cz.toFixed(1)}`, 'wall', cx, cz, base + 1.2, { top: top - 0.72, nx, nz });
      }
      stone.add(cx, (top + base) / 2, cz, 0.42, top - base, L + 0.1, yaw);
      granite.add(cx, top + 0.06, cz, 0.56, 0.13, L + 0.24, yaw); // cap
      addPrism(rectPts(cx, cz, 0.3, L / 2 + 0.05, yaw), base, top + 0.15);
      if (balustrade) {
        const nB = Math.floor(L / 0.42);
        const dx = (bx - ax) / L, dz = (bz - az) / L;
        for (let k = 1; k < nB; k++) {
          const t = (k * 0.42);
          balB.add(ax + dx * t, top + 0.42, az + dz * t, 0.12, 0.6, 0.12, yaw);
        }
        granite.add(cx, top + 0.78, cz, 0.34, 0.1, L, yaw); // rail
      }
    }
  }

  // ---------- lawn fences (low black steel) + hedges
  for (const f of C.fences || []) {
    const p = f.pts3;
    if (!p) continue;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az, ay] = p[i], [bx, bz, by] = p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const yaw = Math.atan2(bx - ax, bz - az);
      const segs = Math.max(1, Math.round(L / 2.4));
      for (let k = 0; k < segs; k++) {
        const t0 = (k + 0.5) / segs;
        const cx = ax + (bx - ax) * t0, cz = az + (bz - az) * t0, cy = HA ? gMin(ax + (bx - ax) * t0, az + (bz - az) * t0, 0, ay + (by - ay) * t0 + LIFT) : ay + (by - ay) * t0 + LIFT;
        const sl = L / segs;
        if (HA) haFoot('campus', `fence:${cx.toFixed(1)},${cz.toFixed(1)}`, 'foot', cx, cz, cy, { r: 0.05 });
        fenceB.add(cx, cy + 0.52, cz, 0.05, 0.05, sl, yaw);      // top rail
        fenceB.add(cx, cy + 0.18, cz, 0.04, 0.04, sl, yaw);      // low rail
        fenceB.add(cx, cy + 0.3, cz, 0.05, 0.62, 0.05, yaw);     // post
      }
    }
  }
  for (const h of C.hedges || []) {
    const p = h.pts3;
    if (!p) continue;
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, az, ay] = p[i], [bx, bz, by] = p[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.5) continue;
      const hy = HA ? gMin((ax + bx) / 2, (az + bz) / 2, 0.4, (ay + by) / 2 + LIFT) : (ay + by) / 2 + LIFT;
      hedgeB.add((ax + bx) / 2, hy + 0.48, (az + bz) / 2, 0.85, 0.95, L + 0.15, Math.atan2(bx - ax, bz - az));
      if (HA) haFoot('campus', `hedge:${ax.toFixed(1)},${az.toFixed(1)}`, 'foot', (ax + bx) / 2, (az + bz) / 2, hy, { r: 0.4 });
    }
  }

  // ---------- monuments
  const faceWalk = Math.atan2(-AX, -AZ); // statues on axis face College Walk (campus south)

  /* ---------------- Alma Mater (Daniel Chester French, 1903) ----------------
  Modelled from Commons photographs (URLs in docs/notes/columbia.md). The
  bronze is 2.6 x 1.7 x 1.9 m (Wikipedia) and stands on a red-veined marble
  die over a pale granite platform. She sits frontally in an academic gown on
  a broad throne whose front posts end in LAMP finials ("Sapientia et
  Doctrina"); a laurel wreath on her head; an open book on her lap; her right
  hand grips a sceptre of four wheat sprays capped by a King's Crown that
  rises ~0.9 m above the wreath; her left arm is thrown open, palm up; an owl
  hides in the folds by her left leg. The bronze reads dark olive green-brown.

  Local frame: +Z = front (campus south, the way she faces), +X = her LEFT
  (campus east), y = 0 at the paving. All numbers are metres. ~2.1k tris in
  three merged meshes.                                                      */
  const UBOX = new THREE.BoxGeometry(1, 1, 1);            // centred unit cube
  const UELL = new THREE.SphereGeometry(1, 8, 5);         // 64-tri ellipsoid blank
  const trs = (px, py, pz, rx, ry, rz, sx, sy, sz) => new THREE.Matrix4().compose(
    new THREE.Vector3(px, py, pz),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)),
    new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz));
  // collect transformed geometry, merge once per material (one draw call each)
  const meld = () => ({
    gs: [],
    push(geom, mtx) {
      const gg = geom.index ? geom.toNonIndexed() : geom.clone();
      if (mtx) gg.applyMatrix4(mtx);
      for (const k of Object.keys(gg.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') gg.deleteAttribute(k);
      this.gs.push(gg);
      return this;
    },
    mesh(material) {
      if (!this.gs.length) return null;
      const gm = this.gs.length === 1 ? this.gs[0] : mergeGeometries(this.gs);
      this.gs.length = 0;
      const m = new THREE.Mesh(gm, material);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    },
  });

  function almaMater(x, y, z) {
    const G = new THREE.Group();
    const bz = meld(), mb = meld(), gr = meld();
    // bottom-based box / centre-based ellipsoid / centre-based cylinder /
    // a cylinder spanning two points (limbs, the sceptre)
    const bx = (b, w, h, d, px, py, pz, rx, ry, rz) => b.push(UBOX, trs(px, py + h / 2, pz, rx, ry, rz, w, h, d));
    const el = (b, sx, sy, sz, px, py, pz, rx, ry, rz) => b.push(UELL, trs(px, py, pz, rx, ry, rz, sx, sy, sz));
    const cyC = (b, r0, r1, h, px, py, pz, seg, rx, rz) =>
      b.push(new THREE.CylinderGeometry(r0, r1, h, seg || 8), trs(px, py, pz, rx, 0, rz));
    const limb = (b, r0, r1, p0, p1, seg) => {
      const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const L = d.length();
      if (L < 1e-4) return;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().divideScalar(L));
      b.push(new THREE.CylinderGeometry(r0, r1, L, seg || 7), new THREE.Matrix4().compose(
        new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
    };
    const lathe = (b, prof, px, py, pz, sz, rx) => b.push(
      new THREE.LatheGeometry(prof.map(([rr, yy]) => new THREE.Vector2(rr, yy)), 14),
      trs(px, py, pz, rx || 0, 0, 0, 1, 1, sz));

    /* ---- pale granite platform + red-veined marble die + bronze plinth ---- */
    bx(gr, 3.42, 0.22, 2.94, 0, 0.00, 0);
    bx(gr, 2.86, 0.24, 2.42, 0, 0.22, 0);
    bx(mb, 2.44, 0.10, 2.06, 0, 0.46, 0);                 // the marble die's base mould
    bx(mb, 2.30, 0.82, 1.92, 0, 0.56, 0);                 // the die itself
    bx(mb, 2.56, 0.11, 2.14, 0, 1.38, 0);                 // its cap
    const B = 1.47;                                       // top of the marble = bronze base
    bx(bz, 2.34, 0.12, 1.94, 0, B, 0);                    // moulded bronze plinth
    bx(bz, 2.12, 0.08, 1.74, 0, B + 0.12, 0);
    const F = B + 0.20;                                   // the bronze figure's own base plane

    /* ---- the throne. Heavy and SOLID: the Commons 3/4 view shows a massive
    trapezoidal side panel under each arm, not a pair of posts, and that solid
    block is what makes her read as seated from behind as well as in front. --*/
    bx(bz, 1.86, 0.17, 1.02, 0, F + 0.76, -0.04);         // seat slab
    for (const s of [-1, 1]) {                            // solid side panels
      const px = s * 0.80;
      bx(bz, 0.30, 0.14, 1.06, px, F + 0.00, -0.02);      // moulded foot
      bx(bz, 0.24, 0.64, 0.86, px, F + 0.14, -0.02);      // the panel itself
      bx(bz, 0.32, 0.13, 0.94, px, F + 0.78, -0.02);      // its cap mould
      // the covered urn on the arm ("Sapientia et Doctrina"): a squat vase,
      // a lid and a bud, not the flame the old model had
      cyC(bz, 0.15, 0.11, 0.09, px, F + 0.985, 0.06, 10);
      el(bz, 0.170, 0.115, 0.170, px, F + 1.10, 0.06);
      cyC(bz, 0.10, 0.16, 0.06, px, F + 1.20, 0.06, 10);
      el(bz, 0.062, 0.085, 0.062, px, F + 1.30, 0.06);
    }
    // The back: one broad slab the full width of the seat with a moulded rail.
    // Its top sits at about her SHOULDER, which is where the frontal photograph
    // puts it — round 1 (and this model's first cut) ran the back up past her
    // chin, and from Low's terrace the head and wreath then had nothing to
    // clear, so she read as a bronze packing case (n2_butler_day, defect 3).
    bx(bz, 1.56, 0.78, 0.20, 0, F + 0.86, -0.50);
    bx(bz, 1.70, 0.15, 0.30, 0, F + 1.62, -0.50);         // top rail
    el(bz, 0.72, 0.13, 0.17, 0, F + 1.70, -0.50);         // its rounded crest
    bz.push(new THREE.CylinderGeometry(0.25, 0.25, 0.05, 16),
      trs(0, F + 1.22, -0.605, Math.PI / 2, 0, 0));       // the seal, embossed
    bz.push(new THREE.TorusGeometry(0.28, 0.035, 5, 16),
      trs(0, F + 1.22, -0.60, 0, 0, 0));                  // its raised rim
    // the mantle spills OVER the back rail and down its outer corners: without
    // something breaking that edge the slab reads as a cavity in shadow
    for (const s of [-1, 1]) {
      el(bz, 0.26, 0.42, 0.20, s * 0.66, F + 1.30, -0.46, 0, 0, s * 0.16);
      el(bz, 0.30, 0.14, 0.19, s * 0.50, F + 1.64, -0.44);
    }
    bx(bz, 1.56, 0.80, 0.16, 0, F + 0.00, -0.50);         // apron under the seat: from Low's
    el(bz, 0.62, 0.28, 0.20, 0, F + 1.50, -0.60);         // terrace the open underside read
                                                          // as a cavity (n2_butler_day)

    /* ---- drapery. The lower two thirds of the silhouette must read as ONE
    broad triangular mass, so this is a flaring lathe skirt (wider than deep)
    plus flattened folds, NOT a pile of spheres: the bronze material is flat-
    shaded, which turns each facet into a drapery plane at distance.        */
    lathe(bz, [[0.95, 0.00], [0.90, 0.16], [0.76, 0.42], [0.60, 0.68], [0.46, 0.88], [0.37, 1.02]],
      0, F, -0.02, 0.86);
    el(bz, 0.66, 0.26, 0.34, 0.00, F + 0.26, 0.62);       // drapery pooled at the front
    el(bz, 0.46, 0.30, 0.30, 0.00, F + 0.76, 0.48);       // knees under the gown
    for (const s of [-1, 1])                              // the diagonal folds that
      el(bz, 0.32, 0.24, 0.32, s * 0.54, F + 0.34, 0.36); // make the outline a triangle
    // long vertical folds down the skirt front (the photograph's strongest
    // texture): thin flattened ridges, cheap and readable at 20 m
    for (const ff of [[-0.40, 0.20, 0.62], [-0.17, 0.16, 0.74], [0.10, 0.16, 0.74],
      [0.36, 0.20, 0.64], [0.58, 0.26, 0.48]])
      el(bz, 0.085, ff[2], 0.115, ff[0], F + ff[1] + ff[2] * 0.5, 0.50 - Math.abs(ff[0]) * 0.22);
    el(bz, 0.20, 0.66, 0.30, -0.80, F + 0.98, 0.04);      // the mantle's long fall, sceptre side
    el(bz, 0.19, 0.50, 0.28, 0.82, F + 0.78, 0.08);       // and the shorter fall opposite
    el(bz, 0.090, 0.105, 0.080, 0.50, F + 0.34, 0.46);    // the owl in the folds, her left leg
    el(bz, 0.058, 0.058, 0.052, 0.50, F + 0.45, 0.48);
    bx(bz, 1.06, 0.14, 0.52, 0, F, 0.70);                 // footstool
    for (const s of [-1, 1])                              // both bare feet, toes together
      bx(bz, 0.15, 0.10, 0.34, s * 0.10, F + 0.14, 0.60);

    /* ---- torso, shoulders, head, laurel wreath ---- */
    lathe(bz, [[0.35, 0.00], [0.33, 0.20], [0.30, 0.46], [0.27, 0.70], [0.23, 0.88]],
      0, F + 0.92, -0.06, 0.68, -0.05);
    el(bz, 0.325, 0.180, 0.220, 0.00, F + 1.70, -0.03);   // shoulders, narrower and
                                                          // lower so the head clears them
    el(bz, 0.40, 0.15, 0.24, 0.00, F + 1.62, -0.10);      // the mantle across her back
    for (const s of [-1, 1])                              // the gown's yoke bands
      bx(bz, 0.10, 0.62, 0.09, s * 0.15, F + 1.10, 0.20, 0, 0, s * 0.05);
    cyC(bz, 0.090, 0.104, 0.20, 0.00, F + 1.90, 0.00, 8);
    el(bz, 0.142, 0.182, 0.154, 0.00, F + 2.12, 0.03);    // head - at 0.118 it read as a
                                                          // knob between two shoulder pads
    el(bz, 0.158, 0.142, 0.150, 0.00, F + 2.13, -0.01);   // the veil over her hair
    // the laurel wreath is BROAD - in the frontal photograph it reaches well
    // outside the skull on both sides and stands above it
    bz.push(new THREE.TorusGeometry(0.215, 0.040, 5, 16),
      trs(0, F + 2.19, 0.02, Math.PI / 2 - 0.10, 0, 0));
    // its side leaves: forward of the skull, or from behind they read as ears
    for (const s of [-1, 1]) {
      el(bz, 0.090, 0.052, 0.046, s * 0.215, F + 2.21, 0.06, 0, 0, s * 0.5);
      el(bz, 0.070, 0.044, 0.040, s * 0.150, F + 2.29, 0.05, 0, 0, s * 0.7);
    }

    /* ---- the sleeves of the academic gown. THE silhouette feature: from each
    raised forearm a broad triangular sheet of drapery falls to the throne arm,
    filling the V between the arms and the lap. Round 1 had small ellipsoids
    here and the V read empty, which is why she needed the sceptre to carry her
    at the plaza framing. Flattened in Z (0.40) so they stay sheets, faceted so
    each panel reads as a drapery plane.                                     */
    for (const s of [-1, 1]) {
      bz.push(new THREE.CylinderGeometry(0.11, 0.52, 1.34, 6),
        trs(s * 0.76, F + 1.06, 0.06, 0, 0, -s * 0.22, 1, 1, 0.40));
      // the shoulder puff sits BELOW the shoulder line: at F+1.60 the two of
      // them formed a horizontal bar at head height and she read as a machine
      el(bz, 0.30, 0.32, 0.22, s * 0.54, F + 1.50, 0.00, 0, 0, s * 0.34);
      el(bz, 0.26, 0.34, 0.21, s * 0.90, F + 0.88, 0.06, 0, 0, s * 0.12); // its hem
    }

    /* ---- arms: her right grips the sceptre, her left is thrown open. Both
    hands sit at about wreath height and OUTSIDE the throne posts, which is
    what the frontal photograph shows. ------------------------------------ */
    limb(bz, 0.115, 0.098, [-0.32, F + 1.72, 0.04], [-0.62, F + 1.44, 0.16]);   // right upper
    limb(bz, 0.095, 0.076, [-0.62, F + 1.44, 0.16], [-0.86, F + 2.10, 0.18]);   // right forearm
    el(bz, 0.082, 0.104, 0.070, -0.885, F + 2.19, 0.19);                        // gripping hand
    limb(bz, 0.115, 0.095, [0.32, F + 1.70, 0.04], [0.70, F + 1.82, 0.10]);     // left upper
    limb(bz, 0.088, 0.066, [0.70, F + 1.82, 0.10], [1.02, F + 2.14, 0.16]);     // left forearm
    bx(bz, 0.15, 0.052, 0.21, 1.10, F + 2.20, 0.16, -0.35, 0, -0.45);           // open palm
    bx(bz, 0.11, 0.040, 0.12, 1.18, F + 2.28, 0.19, -0.55, 0, -0.45);           // fingers

    /* ---- the book, open across her lap. Nearly a metre wide in the photo. -*/
    for (const s of [-1, 1]) bx(bz, 0.44, 0.055, 0.50, s * 0.240, F + 1.02, 0.28, 0, 0, -s * 0.13);
    bx(bz, 0.09, 0.055, 0.50, 0, F + 1.00, 0.28);

    /* ---- the sceptre: wheat sprays under a King's Crown, ~0.9 m clear above
    the wreath. Thicker than scale so the vertical still reads at distance. -- */
    limb(bz, 0.030, 0.036, [-0.98, F + 2.92, 0.10], [-0.72, F + 0.62, 0.26], 6);
    limb(bz, 0.058, 0.030, [-0.982, F + 2.78, 0.105], [-0.986, F + 3.04, 0.095], 6);  // the sheaf
    cyC(bz, 0.070, 0.054, 0.07, -0.987, F + 3.08, 0.094, 8);                          // crown band
    for (let k = 0; k < 4; k++) {
      const a = k * Math.PI / 2 + 0.4;
      cyC(bz, 0.007, 0.016, 0.08, -0.987 + Math.cos(a) * 0.046, F + 3.15, 0.094 + Math.sin(a) * 0.046, 6);
    }
    bx(bz, 0.020, 0.085, 0.020, -0.987, F + 3.12, 0.094);
    bx(bz, 0.058, 0.019, 0.019, -0.987, F + 3.17, 0.094);
    const mBz = bz.mesh(ALMABRONZE), mMb = mb.mesh(MARBLE), mGr = gr.mesh(GRANITE);
    for (const m of [mGr, mMb, mBz]) if (m) G.add(m);
    G.position.set(x, y, z); G.rotation.y = faceWalk;
    if (AM30) {
      almaScan().then((scan) => {
        // AM30: the scan's own pedestal straight on the landing (AL32: its y = 0 is the block's foot; the group stands
        // on the faceted model's 0.16 m apron, which the scan does not have)
        for (const m of [mGr, mMb, mBz]) if (m) m.visible = false;
        const s = scan.clone(); s.position.y = -0.16;
        G.add(s);
      }).catch((e) => console.warn('[campus] Alma Mater scan unavailable; the faceted model stays', e));
    }
    addPrism(AM30 ? rectPts(x, z, 1.25, 1.35, faceWalk) : rectPts(x, z, 2.0, 1.7, faceWalk), y, y + 4.9);
    return G;
  }
  /* The Scholars' Lion (Greg Wyatt, 2004): a seated bronze lion on a low
     granite bench-base. Built from ellipsoid masses + limb cylinders and
     merged into two meshes; the old version was six boxes and read as a dog
     made of luggage. Local +X = the way it faces. */
  function lion(x, y, z, yaw) {
    const G = new THREE.Group();
    const bz = meld(), gr = meld();
    const bx = (b, w, h, d, px, py, pz, rx, ry, rz) => b.push(UBOX, trs(px, py + h / 2, pz, rx, ry, rz, w, h, d));
    const el = (b, sx, sy, sz, px, py, pz, rx, ry, rz) => b.push(UELL, trs(px, py, pz, rx, ry, rz, sx, sy, sz));
    const limb = (b, r0, r1, p0, p1, seg) => {
      const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const L = d.length();
      if (L < 1e-4) return;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().divideScalar(L));
      b.push(new THREE.CylinderGeometry(r0, r1, L, seg || 6), new THREE.Matrix4().compose(
        new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
    };
    bx(gr, 2.60, 0.22, 1.30, 0, 0, 0);
    bx(gr, 2.34, 0.34, 1.12, 0, 0.22, 0);
    const P = 0.56;
    el(bz, 0.60, 0.40, 0.33, -0.06, P + 0.70, 0);                   // barrel
    el(bz, 0.36, 0.38, 0.31, -0.46, P + 0.50, 0);                   // haunches, sat down
    el(bz, 0.33, 0.36, 0.30, 0.34, P + 0.76, 0);                    // chest
    for (const s of [-1, 1]) {
      limb(bz, 0.075, 0.105, [0.44, P + 0.62, s * 0.17], [0.53, P + 0.07, s * 0.18]);   // foreleg
      bx(bz, 0.26, 0.09, 0.20, 0.57, P + 0.00, s * 0.18);                                // paw
      el(bz, 0.20, 0.16, 0.13, -0.40, P + 0.16, s * 0.24);                               // hind foot
    }
    el(bz, 0.30, 0.31, 0.29, 0.50, P + 1.06, 0);                    // mane
    el(bz, 0.20, 0.19, 0.19, 0.62, P + 1.08, 0);                    // skull
    el(bz, 0.13, 0.10, 0.13, 0.80, P + 1.00, 0);                    // muzzle
    for (const s of [-1, 1]) el(bz, 0.055, 0.075, 0.045, 0.56, P + 1.28, s * 0.13);      // ears
    limb(bz, 0.045, 0.062, [-0.62, P + 0.52, 0.06], [-0.44, P + 0.10, 0.30]);            // tail
    el(bz, 0.075, 0.065, 0.060, -0.42, P + 0.08, 0.32);
    for (const m of [gr.mesh(GRANITE), bz.mesh(BRONZE)]) if (m) G.add(m);
    G.position.set(x, y, z); G.rotation.y = yaw;
    addPrism(rectPts(x, z, 1.3, 0.7, yaw), y, y + 2.0);
    return G;
  }
  /* Hamilton / Jefferson / Pulitzer: heroic standing bronzes in frock coats on
     granite dies. One right arm hangs, the left holds a scroll across the
     body. ~700 tris, two merged meshes. */
  function standingFigure(x, y, z, yaw) {
    const G = new THREE.Group();
    const bz = meld(), gr = meld();
    const bx = (b, w, h, d, px, py, pz, rx, ry, rz) => b.push(UBOX, trs(px, py + h / 2, pz, rx, ry, rz, w, h, d));
    const el = (b, sx, sy, sz, px, py, pz, rx, ry, rz) => b.push(UELL, trs(px, py, pz, rx, ry, rz, sx, sy, sz));
    const cyC = (b, r0, r1, h, px, py, pz, seg, rx, rz) =>
      b.push(new THREE.CylinderGeometry(r0, r1, h, seg || 8), trs(px, py, pz, rx, 0, rz));
    const limb = (b, r0, r1, p0, p1, seg) => {
      const d = new THREE.Vector3(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const L = d.length();
      if (L < 1e-4) return;
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().divideScalar(L));
      b.push(new THREE.CylinderGeometry(r0, r1, L, seg || 6), new THREE.Matrix4().compose(
        new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
    };
    bx(gr, 1.90, 0.26, 1.90, 0, 0, 0);                              // granite base course
    bx(gr, 1.44, 1.82, 1.44, 0, 0.26, 0);                           // the die
    bx(gr, 1.68, 0.20, 1.68, 0, 2.08, 0);                           // cap
    bx(bz, 1.14, 0.13, 1.14, 0, 2.28, 0);                           // bronze plinth
    const F = 2.41;
    for (const s of [-1, 1]) {
      bx(bz, 0.17, 0.09, 0.34, s * 0.13, F, s > 0 ? 0.12 : -0.02);  // shoes, one advanced
      limb(bz, 0.095, 0.115, [s * 0.12, F + 0.92, 0.00], [s * 0.13, F + 0.10, s > 0 ? 0.10 : -0.02]);
    }
    cyC(bz, 0.30, 0.38, 0.56, 0, F + 0.80, 0.01, 10);               // flaring frock coat
    cyC(bz, 0.255, 0.305, 0.70, 0, F + 1.42, -0.01, 10);            // torso
    el(bz, 0.31, 0.17, 0.20, 0, F + 1.78, -0.01);                   // shoulders
    for (const s of [-1, 1])                                        // coat lapels
      bx(bz, 0.09, 0.44, 0.10, s * 0.10, F + 1.34, 0.20, 0, 0, s * 0.14);
    cyC(bz, 0.068, 0.082, 0.13, 0, F + 1.90, 0.01, 8);              // neck
    el(bz, 0.100, 0.128, 0.110, 0, F + 2.04, 0.02);                 // head
    el(bz, 0.108, 0.095, 0.116, 0, F + 2.09, -0.01);                // hair
    limb(bz, 0.080, 0.062, [-0.27, F + 1.74, -0.01], [-0.33, F + 1.24, 0.06]);  // right arm hangs
    limb(bz, 0.058, 0.048, [-0.33, F + 1.24, 0.06], [-0.31, F + 0.84, 0.14]);
    el(bz, 0.055, 0.075, 0.050, -0.31, F + 0.78, 0.15);
    limb(bz, 0.080, 0.062, [0.27, F + 1.74, -0.01], [0.34, F + 1.28, 0.05]);    // left arm across
    limb(bz, 0.058, 0.048, [0.34, F + 1.28, 0.05], [0.11, F + 1.20, 0.30]);
    el(bz, 0.055, 0.070, 0.050, 0.09, F + 1.20, 0.32);
    cyC(bz, 0.048, 0.048, 0.34, 0.05, F + 1.22, 0.34, 6, 0, 1.35);  // the scroll
    for (const m of [gr.mesh(GRANITE), bz.mesh(BRONZE)]) if (m) G.add(m);
    G.position.set(x, y, z); G.rotation.y = yaw;
    addPrism(rectPts(x, z, 0.95, 0.95, yaw), y, y + 4.9);
    return G;
  }
  function abstractPiece(x, y, z, name) {
    const G = new THREE.Group();
    G.add(box(GRANITE, 2.2, 0.25, 2.2, 0, 0.12, 0));
    if (name === 'Curl') {
      const t = new THREE.Mesh(new THREE.TorusGeometry(1.3, 0.34, 10, 24, 4.2), DARKMETAL);
      t.position.y = 1.5; t.rotation.z = 0.5; t.castShadow = true; G.add(t);
    } else if ((name || '').startsWith('Three-Way')) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1.0, 12, 10), BRONZE);
      s.scale.set(1.15, 0.85, 1.1); s.position.y = 1.35; s.castShadow = true; G.add(s);
      for (const a of [0, 2.1, 4.2]) G.add(cyl(BRONZE, 0.12, 0.16, 0.7, Math.cos(a) * 0.6, 0.6, Math.sin(a) * 0.6, 8));
    } else if (name === 'Reclining Woman') {
      const s1 = new THREE.Mesh(new THREE.SphereGeometry(0.75, 12, 10), BRONZE);
      s1.scale.set(1.5, 0.75, 0.8); s1.position.set(-0.3, 0.85, 0); s1.castShadow = true; G.add(s1);
      const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), BRONZE);
      s2.position.set(0.9, 1.25, 0); s2.castShadow = true; G.add(s2);
    } else if (name === 'Tightrope Walker') {
      G.add(cyl(BRONZE, 0.14, 0.18, 3.4, 0, 1.7, 0, 8));
      G.add(box(BRONZE, 0.35, 1.05, 0.3, 0.12, 3.9, 0, 0, 0.25));
      G.add(box(BRONZE, 0.3, 0.9, 0.28, -0.15, 4.6, 0, 0, -0.4));
    } else if (name === 'The Sundial') {
      G.add(cyl(GRANITE, 1.55, 1.7, 1.05, 0, 0.75, 0, 20));
      G.add(cyl(GRANITE, 1.7, 1.75, 0.2, 0, 0.22, 0, 20));
    } else if ((name || '').includes('Bellerophon')) {
      G.add(box(BRONZE, 3.0, 4.2, 0.5, 0, 2.2, 0));
    } else if ((name || '').includes('Schurz')) {
      for (let i = -2; i <= 2; i++) G.add(box(GRANITE, 1.1, 1.35, 0.5, i * 1.05, 0.68, Math.abs(i) * 0.28));
    } else {
      G.add(box(BRONZE, 0.9, 2.1, 0.7, 0, 1.3, 0));
    }
    G.position.set(x, y, z); G.rotation.y = faceWalk;
    addPrism(rectPts(x, z, 1.2, 1.2, faceWalk), y, y + 2.6);
    return G;
  }
  for (const m of C.monuments || []) {
    if (!m.p || m.y === undefined) continue;
    const [x, z] = m.p, y = HA ? gMin(x, z, 1.0, m.y + LIFT) : m.y + LIFT;
    if (HA && m.name !== 'Alma Mater') haFoot('campus', `monument:${m.name}`, 'foot', x, z, y, { r: 1.0 });
    if (m.name === 'Alma Mater') {
      // she sits on the plateau at the grand staircase head, centered before
      // Low — not at the OSM node's staircase-foot position
      // she stands on the MIDDLE landing of the cascade, on the axis: part
      // way up at the head of the second flight, steps continuing behind her
      // her granite platform + marble die are part of the model; the landing
      // only needs one low apron step round it (the old 6.6 m dais read as a
      // packing crate under her)
      let p = relPt(0.35, 0), ly = yApron + 2 * (yTop - yApron) / 3;
      if (HA && haAlma) { p = relPt(haAlma[0], 0); ly = haAlma[1] - 0.16; haFoot('campus', 'monument:Alma Mater', 'foot', p[0], p[1], ly + 0.16, { r: 1.2 }); }
      // (AM30: the scan's own pedestal stands on the landing; the apron is the faceted model's alone)
      if (!AM30) granite.add(p[0], ly + 0.08, p[1], 4.7, 0.16, 4.1, yawAxis);
      uniq.add(almaMater(p[0], ly + 0.16, p[1]));
    }
    else if (m.name === "Scholars' Lion") uniq.add(lion(x, y, z, faceWalk + Math.PI / 2));
    else if (m.name === 'Alexander Hamilton' || m.name === 'Thomas Jefferson' || m.name === 'J. Pulitzer') uniq.add(standingFigure(x, y, z, faceWalk));
    else uniq.add(abstractPiece(x, y, z, m.name));
  }

  // ---------- Low Plaza fountains
  let plazaFi = 0;
  for (const f of C.fountains || []) {
    if (!f.p || f.y === undefined) continue;
    const small = !!f.poly;
    // the plaza pair snaps onto the paving medallion centers (a=-21, c=±23)
    let [x, z] = f.p, y = f.y + LIFT;
    if (!small) {
      const side = plazaFi++ === 0 ? -1 : 1;
      const p = relPt(-21, 23 * side);
      x = p[0]; z = p[1]; y = yApron;
    }
    if (HA) { y = gMin(x, z, small ? 1.5 : 4.0, y); haFoot('campus', `fountain:${x.toFixed(1)},${z.toFixed(1)}`, 'foot', x, z, y, { r: small ? 1.5 : 4.0 }); }
    // The Low Plaza pair: a big shallow granite pool with a broad moulded
    // coping you sit on, and at its centre a raised tazza BOWL on a baluster
    // pedestal whose water falls from the lip into the pool (Commons, `2014
    // Columbia University Morningside Heights campus from northeast.jpg`).
    // Round 1 was a bare jet (a blue traffic cone at eye level); round 2 was
    // stacked cylinders under an opaque white drum and spike, which the owner
    // called "too basic" (review 2026-09-24). The stone is lathed mouldings
    // now and the water is the FW set: rippled pools, a translucent veil of
    // strands running over the lip, foam where it lands, a crowned centre jet.
    const R = small ? 1.3 : 5.35;
    const G = new THREE.Group();
    const rimH = small ? 0.72 : 0.5, cw = small ? 0.34 : 0.64, seg = small ? 48 : 96;
    const wl = rimH - (small ? 0.14 : 0.2);                  // the pool's water line
    const part = (geo, mat, py = 0, cast = true) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.y = py; m.castShadow = cast; m.receiveShadow = true;
      G.add(m);
      return m;
    };
    const o = R + cw;                                         // the coping's nose
    part(new THREE.CylinderGeometry(o + 0.02, o + 0.06, 0.1, seg), GRANITE, 0.05);                     // plinth course
    part(new THREE.CylinderGeometry(o - 0.15, o - 0.15, rimH - 0.25, seg, 1, true), GRANITE, 0.1 + (rimH - 0.25) / 2);
    part(new THREE.TorusGeometry(o - 0.13, 0.03, 6, seg), GRANITE, 0.15, false).rotation.x = Math.PI / 2;  // base bead
    // the coping must stay an ANNULUS: a solid disc once capped the basin and
    // hid the water completely (shots/columbia/m3_butler_day.png)
    part(lathe([[o - 0.15, rimH - 0.15], [o - 0.07, rimH - 0.14], [o - 0.02, rimH - 0.11], [o, rimH - 0.07],
      [o - 0.02, rimH - 0.03], [o - 0.08, rimH - 0.01], [R + 0.1, rimH], [R + 0.03, rimH - 0.02], [R, rimH - 0.06],
      [R, wl - 0.12]], seg), GRANITE);
    const poolMat = FW.water(small ? 1.5 : 4.5);
    // FW27 basin: the floor 0.36 m under the water line, the pedestal foot (r 1.3) standing in it, the veil ring and the
    // coping lip as the pool's own reflection occluders
    const setPool = FW25 ? poolRings(poolMat, { impR: small ? 0.5 : 2.4, amp: small ? 0.06 : FW26 ? 0.08 : 0.16, k: 17, foam: small ? 0 : 1, foamIn: 0.55, foamOut: 1.3,
      basin: { R, depth: small ? 0.3 : 0.36, ped: small ? 0 : 1.3, veilR: small ? 0 : 2.37, veilH: small ? 0 : 2.17 - wl, copeH: rimH - wl, floor: 0.2, chop: small ? 0.3 : 1 } }) : null;
    if (setPool) setPool(x, z);
    const poolMesh = part(new THREE.CircleGeometry(R + 0.01, seg), poolMat, wl, false);
    poolMesh.rotation.x = -Math.PI / 2;
    if (!small) {
      // the pedestal: a torus foot in the pool, a swelling baluster, a collar
      part(lathe([[1.3, 0.2], [1.3, 0.4], [1.2, 0.44], [1.05, 0.46], [0.95, 0.52], [0.95, 0.58], [0.8, 0.62],
        [0.62, 0.7], [0.52, 0.85], [0.47, 1.05], [0.5, 1.22], [0.58, 1.32], [0.66, 1.38], [0.66, 1.44],
        [0.55, 1.47], [0.44, 1.5]], 48), WETGRANITE);
      // the tazza: a curved underside out to a rolled lip, a shallow dish inside
      part(lathe([[0.42, 1.5], [0.75, 1.54], [1.15, 1.62], [1.55, 1.74], [1.85, 1.86], [2.02, 1.95], [2.1, 2.0],
        [2.14, 2.04], [2.15, 2.1], [2.12, 2.14], [2.04, 2.155], [1.96, 2.14], [1.93, 2.1], [1.8, 2.04],
        [1.2, 1.98], [0, 1.96]], 72), WETGRANITE);
      const bowlMat = FW.water(1.8);
      const setBowl = FW25 ? poolRings(bowlMat, { impR: 0.8, amp: FW26 ? 0.06 : 0.12, k: 22, foam: 0.85, foamIn: 0.7, foamOut: 2.2,
        basin: { R: 1.95, depth: 0.12, ped: 0.08, copeH: 0.045, floor: 0.2, chop: 0.6 } }) : null;
      if (setBowl) setBowl(x, z);
      part(new THREE.CircleGeometry(1.95, 72), bowlMat, 2.11, false).rotation.x = -Math.PI / 2;
      // FW25: the drops (sheet breakup, landing splash, jet column, bowl crowns), local to the fountain group
      if (FW25) G.add(fountainSpray({ lipR: 2.12, lipY: 2.15, wl, impR: 2.4, jetY: 2.11, jetH: 1.25, bowlY: 2.11, bowlR: 1.9, seed: plazaFi * 7919 }));
      // the veil: over the lip, then a falling sheet thrown slightly outward
      // (0.4 m/s off the lip, 1.8 m of fall) into the pool
      // FW26: the veil, the jet and its crown are water along their own travel time (fountainFX veilMat); the landing
      // froth is the pools' own foam (poolRings), not a separate transparent ring
      const fallT = (h, v0) => (-v0 + Math.sqrt(v0 * v0 + 19.62 * h)) / 9.81;
      part(lathe([[1.92, 2.112], [2.02, 2.165], [2.12, 2.17], [2.18, 2.13], [2.22, 2.02], [2.26, 1.85], [2.29, 1.6],
        [2.33, 1.25], [2.36, 0.85], [2.4, wl]], 96), FW26
        ? veilMat(FW27   // FW27: finer ropes, clearer glass off the lip
          ? { y0: 2.17, dir: 1, v0: 0.3, tMax: fallT(2.17 - wl, 0.3), aer: [0.36, 0.95], holes: 0.6, body: 0.2, freq: 10 }
          : { y0: 2.17, dir: 1, v0: 0.3, tMax: fallT(2.17 - wl, 0.3), aer: [0.42, 1.0], holes: 0.55, body: 0.26, freq: 5.5 }, LT)
        : FW.sheet(16, 1.5, 2.4, 0.85), 0, false).renderOrder = 2;
      if (!FW26) part(foamRing(wl + 0.006, [[3.5, 0], [3.0, 0.3], [2.62, 0.8], [2.44, 1], [2.3, 0.55]], 96), FW.froth(24, 2, -0.12), 0, false).renderOrder = 1;
      // the centre jet and the crown of water it throws back into the bowl
      const jetV0 = Math.sqrt(19.62 * 1.24);
      part(lathe([[0.075, 2.11], [0.07, 2.4], [0.075, 2.8], [0.085, 3.1], [0.1, 3.25], [0.07, 3.33], [0, 3.35]], 24), FW26
        ? veilMat({ y0: 2.11, dir: -1, v0: jetV0, tMax: jetV0 / 9.81, aer: [0.3, 0.95], holes: 0.2, body: 0.34, freq: 30 }, LT)
        : FW.sheet(3, 2, 6.4, FW25 ? 0.75 : 0.9), 0, false).renderOrder = 1;
      part(lathe([0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((t) => [0.1 + 0.75 * t, 3.28 + 0.08 * t - 1.25 * t * t]), 48), FW26
        ? veilMat(FW27   // FW27: the crown breaks into drops instead of reading as a glass dome
          ? { y0: 3.37, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.05, 0.55], holes: 0.8, body: 0.22, freq: 15 }
          : { y0: 3.37, dir: 1, v0: 0.4, tMax: fallT(3.37 - 2.11, 0.4), aer: [0.1, 0.8], holes: 0.6, body: 0.3, freq: 9 }, LT)
        : FW.sheet(8, 1.2, 1.9, 0.6), 0, false).renderOrder = 1;
      if (!FW26) part(foamRing(2.116, [[1.25, 0], [0.98, 0.55], [0.86, 0.9], [0.72, 0.5], [0.45, 0.3], [0.22, 0.85], [0.09, 0.7]], 48),
        FW.froth(10, 1.5, -0.1), 0, false).renderOrder = 1;
      // FW27: what this pool, its bowl and its veils mirror (fountainFX fountainProbe), taken 1.2 m above the water
      if (FW27) fountainProbe(poolMesh, G, [poolMat, bowlMat], wl + 1.2);
    }
    G.position.set(x, y, z);
    uniq.add(G);
    addPrism(rectPts(x, z, R + 0.6, R + 0.6, 0), y, y + rimH + 0.2);
  }

  // ---------- flagpoles (Low Plaza pair)
  for (const fp of C.flagpoles || []) {
    const [x, z] = fp.p, y = HA ? gMin(x, z, 0.7, yTop) : (fp.y != null ? fp.y + LIFT : yTop);
    if (HA) haFoot('campus', `flagpole:${x.toFixed(1)},${z.toFixed(1)}`, 'foot', x, z, y, { r: 0.7 });
    const G = new THREE.Group();
    G.add(cyl(GRANITE, 0.55, 0.7, 1.0, 0, 0.5, 0, 12));
    const pole = cyl(LT(new THREE.MeshStandardMaterial({ color: 0xe8e6e0, roughness: 0.35, metalness: 0.7 })), 0.05, 0.09, 14, 0, 7.5, 0, 10);
    G.add(pole);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd8b544, roughness: 0.3, metalness: 0.85 }));
    ball.position.y = 14.6; G.add(ball);
    G.position.set(x, y, z);
    uniq.add(G);
    addPrism(rectPts(x, z, 0.7, 0.7, 0), y, y + 1.2);
  }

  // ---------- twin-globe lamps: College Walk rows + plaza + steps flanks
  // The College Walk / plaza standard is an ornate cast twin-globe post, not a
  // plain pipe: a stepped octagonal plinth, a swelling ornamented base drum, a
  // fluted tapering shaft, a collar, and two scrolled arms that lift the opal
  // globes above an axial finial (ref: the Commons photos of Low's terrace).
  // ~210 tris, instanced once for all ~40 posts.
  const lampProto = (() => {
    const parts = [];
    const add = (geo, x, y, z) => { geo.translate(x, y, z); parts.push(geo); };
    add(new THREE.CylinderGeometry(0.20, 0.25, 0.15, 6), 0, 0.075, 0);        // stepped plinth
    add(new THREE.CylinderGeometry(0.135, 0.185, 0.34, 6), 0, 0.32, 0);       // swelling base
    add(new THREE.CylinderGeometry(0.095, 0.145, 0.17, 6), 0, 0.575, 0);
    add(new THREE.CylinderGeometry(0.056, 0.090, 2.46, 10), 0, 1.90, 0);      // fluted shaft
    add(new THREE.CylinderGeometry(0.078, 0.052, 0.12, 8), 0, 3.19, 0);       // collar
    for (const s of [-1, 1]) {                                                // scrolled arms
      const a = new THREE.CylinderGeometry(0.026, 0.036, 0.84, 5)
        .rotateZ(-s * (Math.PI / 2 - 0.21));
      a.translate(s * 0.40, 3.33, 0);
      parts.push(a);
    }
    add(new THREE.CylinderGeometry(0.022, 0.050, 0.30, 6), 0, 3.42, 0);       // axial finial
    return mergeGeometries(parts);
  })();
  const lampPos = [];
  if (C.walkLine && C.walkLine.length > 1) {
    let acc = 0;
    for (let i = 0; i < C.walkLine.length - 1; i++) {
      const [ax, az, ay] = C.walkLine[i], [bx, bz, by] = C.walkLine[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const dx = (bx - ax) / L, dz = (bz - az) / L;
      for (let d = 15 - acc; d < L; d += 15) {
        const t = d / L;
        const side = lampPos.length % 2 ? 1 : -1;
        const lx = ax + dx * d - dz * side * 7.0, lz = az + dz * d + dx * side * 7.0;
        lampPos.push([lx, HA ? gMin(lx, lz, 0.3, ay + (by - ay) * t + LIFT) : ay + (by - ay) * t + LIFT, lz, Math.atan2(dx, dz)]);
      }
      acc = (acc + L) % 15;
    }
  }
  // plaza ring + grand steps flanks (relative to Alma along campus axis)
  const rel = (fwd, right, y) => [alma[0] + AX * fwd - AZ * right, y, alma[1] + AZ * fwd + AX * right];
  // plaza + cascade lamps; 'T' = standing on the plateau/flanking terrace
  for (const [fwd, right, lvl] of [[-16, -30, 'A'], [-16, 30, 'A'], [-15, -52, 'A'], [-15, 52, 'A'],
    [-8.2, -40, 'L1'], [-8.2, 40, 'L1'], [0.2, -27.5, 'L2'], [0.2, 27.5, 'L2'],
    [3, -31, 'T'], [3, 31, 'T'], [16, -22, 'T'], [16, 22, 'T'], [26, -34, 'T'], [26, 34, 'T']]) {
    const p = rel(fwd, right, 0);
    let y = lvl === 'T' ? yTop : lvl === 'L1' ? yApron + (yTop - yApron) / 3
      : lvl === 'L2' ? yApron + 2 * (yTop - yApron) / 3 : yApron;
    // P1: the kit's level tags are the pads'; a lamp stands on the paving under it
    if (HA) y = gMin(p[0], p[2], 0.3, y);
    lampPos.push([p[0], y, p[2], Math.atan2(-AX, -AZ)]);
  }
  if (HA) lampPos.forEach(([x, y, z], i) => haFoot('campus', `lamp:${i}`, 'foot', x, z, y, { r: 0.3 }));
  if (lampPos.length) {
    const lm = new THREE.InstancedMesh(lampProto, GREENPOST, lampPos.length);
    const gm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.19, 12, 10), GLOBE, lampPos.length * 2);
    lampPos.forEach(([x, y, z, yaw], i) => {
      tmpQ.setFromAxisAngle(AXIS_Y, yaw);
      tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(1, 1, 1));
      lm.setMatrixAt(i, tmpM);
      for (const s of [-1, 1]) {
        const gx = x + Math.sin(yaw + Math.PI / 2) * 0.75 * s, gz = z + Math.cos(yaw + Math.PI / 2) * 0.75 * s;
        tmpM.compose(tmpP.set(gx, y + 3.42, gz), tmpQ, tmpS.set(1, 1, 1));
        gm.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), tmpM);
      }
    });
    lm.castShadow = true;
    g.add(lm, gm);
  }

  granite.build(g, true);
  stone.build(g, true);
  balB.build(g, false);
  fenceB.build(g, false);
  hedgeB.build(g, false);
  brickB.build(g, false);
  stoneB.build(g, false);
  g.add(uniq);
  scene.add(g);
  console.log('campus kit built:', g.children.length, 'draw groups,', (C.steps || []).length, 'step runs');
  return g;
}
