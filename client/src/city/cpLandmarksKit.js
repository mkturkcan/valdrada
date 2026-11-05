// CP32 LANDMARKS kit (city/cpLandmarks.js builds with it): the merge bins, the materials and the structures' builders.
// Every structure is built in its own frame (u along its axis, y up, w across; a proper rotation of the world's x, z) and
// merged per material into one mesh each, vertex-coloured. Sources and measurements: docs/notes/central-park-landmarks.md.
// Footprints and frames measured from OpenStreetMap (OpenStreetMap contributors, ODbL 1.0).
import * as THREE from 'three';
import { ENV, applyLightTrim, applyCityAO, applyStoneDetail, applySkyGlass } from '../world/materials.js';

// ---- the merge bin ------------------------------------------------------------------------------------------------
// A frame: world(u, y, w) = (x0 + ax u - az w, y0 + y, z0 + az u + ax w) (det +1). Triangles get flat normals from their
// winding; the materials are double-sided (three flips the normal on a back face), so a reversed winding still lights.
export class LBin {
  constructor(uv = false) { this.P = []; this.N = []; this.C = []; this.T = uv ? [] : null; this.f = null; }
  frame(x0, y0, z0, ax, az) { this.f = { x0, y0, z0, ax, az }; return this; }
  _w(u, y, w, out) { const f = this.f; out[0] = f.x0 + f.ax * u - f.az * w; out[1] = f.y0 + y; out[2] = f.z0 + f.az * u + f.ax * w; return out; }
  // a triangle in frame coordinates, colour c (THREE.Color), optional uvs [u, v] x3
  tri(a, b, c, col, ta, tb, tc) {
    const A = this._w(a[0], a[1], a[2], [0, 0, 0]), B = this._w(b[0], b[1], b[2], [0, 0, 0]), Cc = this._w(c[0], c[1], c[2], [0, 0, 0]);
    const e1x = B[0] - A[0], e1y = B[1] - A[1], e1z = B[2] - A[2], e2x = Cc[0] - A[0], e2y = Cc[1] - A[1], e2z = Cc[2] - A[2];
    let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    this.P.push(A[0], A[1], A[2], B[0], B[1], B[2], Cc[0], Cc[1], Cc[2]);
    this.N.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    this.C.push(col.r, col.g, col.b, col.r, col.g, col.b, col.r, col.g, col.b);
    if (this.T) { const z = [0, 0]; const p = ta || z, q = tb || z, r = tc || z; this.T.push(p[0], p[1], q[0], q[1], r[0], r[1]); }
    return this;
  }
  quad(a, b, c, d, col, ta, tb, tc, td) { this.tri(a, b, c, col, ta, tb, tc); return this.tri(a, c, d, col, ta, tc, td); }
  // a template geometry at a local matrix m (frame coordinates), keeping its own (smooth) normals
  geo(g, m, col) {
    const p = g.attributes.position.array, n = g.attributes.normal.array, idx = g.index ? g.index.array : null;
    const e = m.elements, nm = new THREE.Matrix3().getNormalMatrix(m).elements, f = this.f;
    const cnt = idx ? idx.length : p.length / 3;
    const cf = typeof col === 'function';
    for (let k = 0; k < cnt; k++) {
      const i = idx ? idx[k] : k, x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      const u = e[0] * x + e[4] * y + e[8] * z + e[12], yy = e[1] * x + e[5] * y + e[9] * z + e[13], w = e[2] * x + e[6] * y + e[10] * z + e[14];
      const nx0 = n[i * 3], ny0 = n[i * 3 + 1], nz0 = n[i * 3 + 2];
      let nu = nm[0] * nx0 + nm[3] * ny0 + nm[6] * nz0, ny = nm[1] * nx0 + nm[4] * ny0 + nm[7] * nz0, nw = nm[2] * nx0 + nm[5] * ny0 + nm[8] * nz0;
      const l = Math.hypot(nu, ny, nw) || 1; nu /= l; ny /= l; nw /= l;
      this.P.push(f.x0 + f.ax * u - f.az * w, f.y0 + yy, f.z0 + f.az * u + f.ax * w);
      this.N.push(f.ax * nu - f.az * nw, ny, f.az * nu + f.ax * nw);
      const cc = cf ? col(k) : col;
      this.C.push(cc.r, cc.g, cc.b);
      if (this.T) this.T.push(0, 0);
    }
    return this;
  }
  // a unit box (base on y 0) scaled w (u) x h x d (w), at (u, y, w), turned a about y, pitched p about w
  box(sw, sh, sd, col, u, y, w, a = 0, p = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(u, y, w), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, p, 'YXZ')), new THREE.Vector3(sw, sh, sd));
    return this.geo(TPL.box(), m, col);
  }
  cyl(rt, rb, h, col, u, y, w, seg = 10, rx = 0, rz = 0) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(u, y, w), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, rz)), new THREE.Vector3(rb, h, rb));
    return this.geo(TPL.cyl(rt / rb, seg), m, col);
  }
  lathe(key, pts, col, u, y, w, s = 1, seg = 14) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(u, y, w), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
    return this.geo(TPL.lathe(key, pts, seg), m, col);
  }
  sphere(r, col, u, y, w, sy = 1, seg = 10) {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(u, y, w), new THREE.Quaternion(), new THREE.Vector3(r, r * sy, r));
    return this.geo(TPL.sphere(seg), m, col);
  }
  // a round bar between two frame points
  tube(a, b, r, col, seg = 6) {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
    if (L < 1e-4) return this;
    const m = new THREE.Matrix4().compose(new THREE.Vector3(a[0], a[1], a[2]), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(r, L, r));
    return this.geo(TPL.tube(seg), m, col);
  }
  // a band swept along u: us (sorted), base(u) -> [y, w], prof [[dw, dy], ...] (an open polyline across the band)
  band(us, base, prof, col, mirror = false) {
    for (let i = 0; i + 1 < us.length; i++) {
      const [ya, wa] = base(us[i]), [yb, wb] = base(us[i + 1]);
      for (let k = 0; k + 1 < prof.length; k++) {
        const s = mirror ? -1 : 1, p = prof[k], q = prof[k + 1];
        this.quad([us[i], ya + p[1], wa + s * p[0]], [us[i + 1], yb + p[1], wb + s * p[0]], [us[i + 1], yb + q[1], wb + s * q[0]], [us[i], ya + q[1], wa + s * q[0]], col);
      }
    }
    return this;
  }
  get tris() { return this.P.length / 9; }
  mesh(mat, name, o = {}) {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.P), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.N), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.C), 3));
    if (this.T) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.T), 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.name = name; m.castShadow = o.cast !== false; m.receiveShadow = true;
    return m;
  }
}
const _tpl = new Map();
const tplGet = (k, make) => { let g = _tpl.get(k); if (!g) { g = make(); if (!g.attributes.normal) g.computeVertexNormals(); _tpl.set(k, g); } return g; };
export const TPL = {
  box: () => tplGet('box', () => new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)),
  cyl: (ratio, seg) => tplGet(`cyl${ratio.toFixed(3)}|${seg}`, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1).translate(0, 0.5, 0)),
  tube: (seg) => tplGet(`tube${seg}`, () => new THREE.CylinderGeometry(1, 1, 1, seg, 1, true).translate(0, 0.5, 0)),
  sphere: (seg) => tplGet(`sph${seg}`, () => new THREE.SphereGeometry(1, seg, Math.max(4, seg >> 1))),
  lathe: (key, pts, seg) => tplGet(`lathe${key}|${seg}`, () => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), seg)),
};

// ---- colours (linear, from sRGB hex; the city's day lighting takes applyLightTrim's 0.3 on them) --------------------
export const K = (hex) => new THREE.Color(hex);
export const COL = {
  iron: K(0xe2dccb), ironS: K(0xcfc8b6), ironD: K(0xa9a292), ironU: K(0x8e8878),    // Bow Bridge's cream paint, its shade, the underside
  granite: K(0xa39b8e), graniteD: K(0x8d8679), graniteL: K(0xb3ab9d),
  plank: K(0x8f7b62), plankD: K(0x75644f), plankL: K(0xa08b70), gap: K(0x2a2622),
  pave: K(0x5b5853), paveL: K(0x6a6660), soil: K(0x4a4237),
  urn: K(0xd9d2c0), leafUrn: K(0x4f7a3a), flower: K(0xb8445a),
  bollard: K(0x3a3a38),
};

// ---- materials ----------------------------------------------------------------------------------------------------
const MATS = {};
const own = (m, k) => { const f = m.customProgramCacheKey.bind(m); m.customProgramCacheKey = () => f() + '|cp32m' + k; return m; };
const std = (o) => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, ...o });
// the pierced ironwork: an RGBA atlas drawn on a canvas (top half the railing's interlocking rings with their cinquefoil
// rosettes, 3 rings to 1.32 m; bottom half the spandrels' foliate scroll, 1.6 m x 0.8 m to a repeat), alpha-tested, the
// cut-out kept from thinning away with distance by raising the alpha with the mip level (the texel footprint)
function ironAtlas() {
  if (typeof document === 'undefined') return null;
  const S = 1024, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const c = cv.getContext('2d');
  c.clearRect(0, 0, S, S);
  const PX = 1024 / 1.32;                      // px per metre in the rings' half (isotropic: 1.32 m x 0.66 m)
  const ring = (cx, cy, r, wd, col) => { c.strokeStyle = col; c.lineWidth = wd * PX; c.beginPath(); c.arc(cx, cy, r * PX, 0, Math.PI * 2); c.stroke(); };
  // the rings' half: y 0..512 (0.66 m); frame bars top and bottom, three rings, their neighbours' halves wrapping
  const cyR = 256;
  c.fillStyle = '#f2f0ea';
  c.fillRect(0, 0, S, 0.035 * PX); c.fillRect(0, 512 - 0.035 * PX, S, 0.035 * PX);
  for (let k = -1; k <= 3; k++) {
    const cx = (k + 0.5) * (S / 3);
    ring(cx, cyR, 0.262, 0.046, '#f4f2ec');       // the outer ring: 0.52 m across on a 0.44 m pitch, so neighbours interlock
    ring(cx, cyR, 0.262, 0.01, '#b9b5ac');        // its moulded edge
    ring(cx, cyR, 0.19, 0.032, '#efece5');        // the inner ring
    // the rosette: a disc pierced by a cinquefoil (five lobes and the eye), a boss at the centre
    c.fillStyle = '#f0ede6'; c.beginPath(); c.arc(cx, cyR, 0.125 * PX, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#c9c5bb'; c.beginPath(); c.arc(cx, cyR, 0.118 * PX, 0, Math.PI * 2); c.lineWidth = 0.008 * PX; c.strokeStyle = '#b5b1a8'; c.stroke();
    c.globalCompositeOperation = 'destination-out';
    for (let l = 0; l < 5; l++) { const a = -Math.PI / 2 + l * Math.PI * 2 / 5; c.beginPath(); c.arc(cx + Math.cos(a) * 0.052 * PX, cyR + Math.sin(a) * 0.052 * PX, 0.034 * PX, 0, Math.PI * 2); c.fill(); }
    c.beginPath(); c.arc(cx, cyR, 0.045 * PX, 0, Math.PI * 2); c.fill();
    c.globalCompositeOperation = 'source-over';
    c.fillStyle = '#e8e5de'; c.beginPath(); c.arc(cx, cyR, 0.018 * PX, 0, Math.PI * 2); c.fill();
    // the ties where each ring meets the frame bars
    c.fillStyle = '#f2f0ea'; c.fillRect(cx - 0.02 * PX, 0, 0.04 * PX, cyR - 0.26 * PX); c.fillRect(cx - 0.02 * PX, cyR + 0.26 * PX, 0.04 * PX, 512 - cyR - 0.26 * PX);
  }
  // the spandrels' half: y 512..1024 = 0.8 m (640 px/m vertically), x 1024 = 1.6 m (640 px/m): a running scroll (rinceau)
  const Q = 640, y0 = 512;
  c.save(); c.beginPath(); c.rect(0, y0 + 4, S, 512 - 8); c.clip();
  c.strokeStyle = '#f2efe8'; c.lineCap = 'round';
  const spiral = (cx, cy, r0, turns, dir, wd) => {
    c.lineWidth = wd * Q; c.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.02) { const a = dir * t * turns * Math.PI * 2, r = r0 * (1 - 0.82 * t); const x = cx + Math.cos(a) * r * Q, y = cy - Math.sin(a) * r * Q; if (t === 0) c.moveTo(x, y); else c.lineTo(x, y); }
    c.stroke();
  };
  for (let k = -1; k <= 2; k++) {
    const bx = k * 512;
    // the stem: a wave through the band
    c.lineWidth = 0.04 * Q; c.beginPath();
    for (let x = 0; x <= 512; x += 8) { const y = y0 + 256 + Math.sin((x / 512) * Math.PI * 2) * 0.16 * Q; if (x === 0) c.moveTo(bx + x, y); else c.lineTo(bx + x, y); }
    c.stroke();
    // a scroll off each crest, curling the other way, and leaves
    spiral(bx + 128, y0 + 256 - 0.12 * Q + 0.02 * Q, 0.2, 1.3, 1, 0.032);
    spiral(bx + 384, y0 + 256 + 0.12 * Q - 0.02 * Q, 0.2, 1.3, -1, 0.032);
    c.fillStyle = '#f0ede6';
    for (const [lx, ly, a] of [[40, 150, 0.6], [230, 330, -0.5], [300, 190, 2.2], [470, 360, -2.4], [200, 120, 1.2], [440, 420, -1.8]]) {
      c.save(); c.translate(bx + lx, y0 + ly); c.rotate(a); c.beginPath(); c.ellipse(0, 0, 0.08 * Q, 0.028 * Q, 0, 0, Math.PI * 2); c.fill(); c.restore();
    }
    c.fillStyle = '#e6e2da'; for (const [lx, ly] of [[128, 190], [384, 322]]) { c.beginPath(); c.arc(bx + lx, y0 + ly, 0.03 * Q, 0, Math.PI * 2); c.fill(); }
  }
  c.restore();
  // the panel's frame lines top and bottom
  c.fillStyle = '#f2efe8'; c.fillRect(0, y0 + 4, S, 0.03 * Q); c.fillRect(0, S - 4 - 0.03 * Q, S, 0.03 * Q);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
export function lmMats() {
  if (MATS.iron) return MATS;
  // painted cast iron: an enamel over iron is a dielectric (a sheen, not a mirror)
  MATS.iron = own(applyLightTrim(applyCityAO(std({ roughness: 0.5, metalness: 0.12 }))), 'iron');
  const at = ironAtlas();
  const cut = std({ roughness: 0.52, metalness: 0.12, map: at, alphaTest: 0.5 });
  cut.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>', `
      #ifdef USE_MAP
      {
        vec2 dx = dFdx( vMapUv * 1024.0 ), dy = dFdy( vMapUv * 1024.0 );
        float lod = max( 0.0, 0.5 * log2( max( dot( dx, dx ), dot( dy, dy ) ) ) );
        diffuseColor.a *= 1.0 + lod * 0.28;
      }
      #endif
      if ( diffuseColor.a < 0.5 ) discard;`);
  };
  MATS.ironCut = own(applyLightTrim(applyCityAO(cut)), 'ironcut');
  // granite and sandstone ashlar (the campus stone detail's speckled set, jointed in courses)
  MATS.stone = own(applyLightTrim(applyCityAO(applyStoneDetail(std({ roughness: 0.86, metalness: 0.0 }), 'cgranite',
    { amt: 0.55, nrm: 0.55, rgh: 0.35, scale: 0.8, ashlar: 0.85 }))), 'stone');
  MATS.wood = own(applyLightTrim(applyCityAO(std({ roughness: 0.82, metalness: 0.0 }))), 'wood');
  MATS.matte = own(applyLightTrim(applyCityAO(std({ roughness: 0.9, metalness: 0.0 }))), 'matte');
  // weathered copper (the verdigris of the Boathouse's roofs, the castle's finials): a matte patina, a trace of metal
  MATS.copper = own(applyLightTrim(applyCityAO(std({ roughness: 0.62, metalness: 0.08 }))), 'copper');
  // Manhattan schist: the campus stone set darker and coarser, laid in rough courses (the castle's rubble walls)
  // (CPB33: rough-faced, the stones smaller and their faces and joints stronger: Gapstow's walls read as flat panels)
  MATS.schist = own(applyLightTrim(applyCityAO(applyStoneDetail(std({ roughness: 0.9, metalness: 0.0 }), 'cgranite',
    { amt: 1.0, nrm: 1.0, rgh: 0.4, scale: 0.42, ashlar: 1.0 }))), 'schist');
  // the living rock (Vista Rock, the outcrops): no joints, large-scale grain
  MATS.rock = own(applyLightTrim(applyCityAO(applyStoneDetail(std({ roughness: 0.92, metalness: 0.0 }), 'cgranite',
    { amt: 0.9, nrm: 0.9, rgh: 0.4, scale: 1.6 }))), 'rock');
  MATS.slate = own(applyLightTrim(applyCityAO(std({ roughness: 0.55, metalness: 0.04 }))), 'slate');
  // Indiana limestone (the Bandshell): fine, pale, jointed in blocks
  MATS.limestone = own(applyLightTrim(applyCityAO(applyStoneDetail(std({ roughness: 0.8, metalness: 0.0 }), 'climestone',
    { amt: 0.35, nrm: 0.35, rgh: 0.25, scale: 1.0, ashlar: 0.7 }))), 'limestone');
  // statuary bronze under its patina
  MATS.bronze = own(applyLightTrim(applyCityAO(std({ roughness: 0.42, metalness: 0.55 }))), 'bronze');
  return MATS;
}

// ---- Bow Bridge ---------------------------------------------------------------------------------------------------
// Frame: the bridge's centre C, u along the axis (+u toward the Ramble, north-west), w across, y above the Lake's water W.
// Numbers (docs/notes): the ironwork 87 ft 4 in long (HAER NY-195), the arch's clear span 60 ft (18.3 m), the balustrade
// 142 ft (43.3 m), 4.9 m over the fascias (OSM way 580516390); heights measured off the HAER and Commons photographs
// against the span: the deck 1.9 m over the water at the springing piers and 2.5 m at the crown, the arch springing
// 0.3 m over the water and its crown's soffit 2.08 m, the railing 0.92 m high on 0.44 m rings.
export const BOW = {
  C: [-48.12, 815.78], A: [-0.5186, -0.8551], END: 21.65, IRON: 13.3, PIER: 9.95, SPAN: 9.15, SHORE: 15.2,
  DECK0: 2.5, K: 0.00606, HALF: 2.45, RAIL: 2.3, SPRING: 0.3,
};
// the deck's top at u (world y), given W and the ground at the two ends
export function bowDeckY(u, W, gS, gN) {
  const B = BOW, a = Math.abs(u);
  const yI = (x) => W + B.DECK0 - B.K * x * x;
  if (a <= B.IRON) return yI(a);
  const y0 = yI(B.IRON), g = (u < 0 ? gS : gN) + 0.03;
  let m0 = -2 * B.K * B.IRON;                        // the slope out of the iron span, per metre outward
  if (g > y0) m0 = 0;                                // ground higher than the bridge's end: no dip before it climbs
  const L = B.END - B.IRON, t = Math.min(1, (a - B.IRON) / L);
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2;
  return h00 * y0 + h10 * L * m0 + h01 * g;
}
const archOf = (W) => {
  const B = BOW, yS = W + B.SPRING, yC = W + B.DECK0 - 0.42, r = yC - yS, R = (B.SPAN * B.SPAN + r * r) / (2 * r), yc = yC - R;
  return { yi: (u) => yc + Math.sqrt(Math.max(0, R * R - u * u)), dep: (u) => 0.2 + 0.36 * (Math.abs(u) / B.SPAN) ** 2, yS, yC };
};
export function buildBowBridge(group, W, gS, gN, key) {
  const M = lmMats(), B = BOW;
  const [cx, cz] = B.C, [ax, az] = B.A;
  const I = new LBin().frame(cx, 0, cz, ax, az), CU = new LBin(true).frame(cx, 0, cz, ax, az);
  const S = new LBin().frame(cx, 0, cz, ax, az), WD = new LBin().frame(cx, 0, cz, ax, az), MT = new LBin().frame(cx, 0, cz, ax, az);
  const yd = (u) => bowDeckY(u, W, gS, gN), ar = archOf(W);
  const steps = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; };
  const HW = B.HALF, RW = B.RAIL;
  // -- the deck: lengthwise planks over the ironwork, the paved approaches, the dark substructure under the plank gaps
  const uI = steps(-B.IRON, B.IRON, 60);
  const nPl = 31, pw = (2 * (RW - 0.12)) / nPl;
  for (let k = 0; k < nPl; k++) {
    const w0 = -(RW - 0.12) + k * pw + 0.006, w1 = w0 + pw - 0.012;
    const h = Math.sin(k * 12.9898) * 43758.5453, r = h - Math.floor(h);
    const col = r < 0.3 ? COL.plankD : r > 0.8 ? COL.plankL : COL.plank;
    for (let i = 0; i + 1 < uI.length; i++) {
      const ua = uI[i], ub = uI[i + 1], ya = yd(ua), yb = yd(ub);
      WD.quad([ua, ya, w0], [ub, yb, w0], [ub, yb, w1], [ua, ya, w1], col);
    }
  }
  for (let i = 0; i + 1 < uI.length; i++) { const ua = uI[i], ub = uI[i + 1]; MT.quad([ua, yd(ua) - 0.035, -RW], [ub, yd(ub) - 0.035, -RW], [ub, yd(ub) - 0.035, RW], [ua, yd(ua) - 0.035, RW], COL.gap); }
  for (const sg of [-1, 1]) {
    const uA = steps(sg * B.IRON, sg * (B.END + 0.6), 16);
    for (let i = 0; i + 1 < uA.length; i++) { const ua = uA[i], ub = uA[i + 1]; S.quad([ua, yd(ua), -RW], [ub, yd(ub), -RW], [ub, yd(ub), RW], [ua, yd(ua), RW], COL.pave); }
    // three bollards where the planks meet the pavement
    for (const w of [-1.25, 0, 1.25]) { const u = sg * (B.IRON + 1.1); MT.cyl(0.07, 0.07, 1.0, COL.bollard, u, yd(u), w, 10); MT.sphere(0.075, COL.bollard, u, yd(u) + 1.0, w, 0.6, 8); }
  }
  // -- the fascia and cornice along both sides, over the ironwork and the abutments (the approach walls carry it on)
  const uF = steps(-B.SHORE, B.SHORE, 90);
  const FPROF = [[HW - 0.3, 0.005], [HW + 0.11, 0.005], [HW + 0.11, -0.05], [HW + 0.04, -0.07], [HW + 0.03, -0.1], [HW, -0.12], [HW, -0.35], [HW + 0.035, -0.36], [HW + 0.035, -0.41], [HW - 0.25, -0.41]];
  for (const mir of [false, true]) I.band(uF, (u) => [yd(u), 0], FPROF, COL.iron, mir);
  // -- the arch: five ribs (the two fascia ribs with a moulded face), cross beams, spandrel posts, the deck's soffit
  const uA = steps(-B.SPAN, B.SPAN, 48);
  const rib = (w, b, col, face) => {
    for (let i = 0; i + 1 < uA.length; i++) {
      const ua = uA[i], ub = uA[i + 1], ia = ar.yi(ua), ib = ar.yi(ub), ea = ia + ar.dep(ua), eb = ib + ar.dep(ub);
      for (const s of [-1, 1]) I.quad([ua, ia, w + s * b / 2], [ub, ib, w + s * b / 2], [ub, eb, w + s * b / 2], [ua, ea, w + s * b / 2], col);
      I.quad([ua, ia, w - b / 2], [ub, ib, w - b / 2], [ub, ib, w + b / 2], [ua, ia, w + b / 2], COL.ironD);
      I.quad([ua, ea, w - b / 2], [ub, eb, w - b / 2], [ub, eb, w + b / 2], [ua, ea, w + b / 2], col);
      if (face) {
        // the outer face's mouldings: a roll along the soffit edge and one along the back, 3 cm proud
        const s = Math.sign(w), wf = w + s * b / 2;
        for (const [d0, d1] of [[0.0, 0.06], [0.12, 0.15]]) {
          I.quad([ua, ia + d0, wf], [ub, ib + d0, wf], [ub, ib + d0, wf + s * 0.03], [ua, ia + d0, wf + s * 0.03], COL.ironS);
          I.quad([ua, ia + d0, wf + s * 0.03], [ub, ib + d0, wf + s * 0.03], [ub, ib + d1, wf + s * 0.03], [ua, ia + d1, wf + s * 0.03], COL.iron);
          I.quad([ua, ia + d1, wf + s * 0.03], [ub, ib + d1, wf + s * 0.03], [ub, ib + d1, wf], [ua, ia + d1, wf], COL.iron);
        }
      }
    }
  };
  rib(-(HW - 0.08), 0.14, COL.iron, true); rib(HW - 0.08, 0.14, COL.iron, true);
  for (const w of [-1.25, 0, 1.25]) rib(w, 0.1, COL.ironU, false);
  const fb = (u) => yd(u) - 0.41;                                           // the fascia's underside
  for (let u = -B.SPAN + 0.45; u < B.SPAN - 0.3; u += 0.75) {
    const e = ar.yi(u) + ar.dep(u);
    I.box(0.09, 0.14, 2 * HW - 0.2, COL.ironU, u, e, 0);                      // a cross beam on the ribs' backs
    if (fb(u) - e > 0.12) for (const w of [-(HW - 0.08), -1.25, 0, 1.25, HW - 0.08]) I.box(0.07, fb(u) - e, 0.07, COL.ironU, u, e, w);
  }
  // the soffit: the underside of the deck's floor plates between the fascias, over the span and the spandrels
  const uS = steps(-B.SPAN, B.SPAN, 40);
  for (let i = 0; i + 1 < uS.length; i++) { const ua = uS[i], ub = uS[i + 1]; I.quad([ua, fb(ua) + 0.02, -(HW - 0.15)], [ub, fb(ub) + 0.02, -(HW - 0.15)], [ub, fb(ub) + 0.02, HW - 0.15], [ua, fb(ua) + 0.02, HW - 0.15], COL.ironU); }
  // the spandrels' pierced scrollwork, between the fascia rib's back and the fascia, on both faces of the bridge
  for (const sgn of [-1, 1]) for (const sd of [-1, 1]) {
    const us = steps(B.SPAN, 0.5, 40).map((a) => sgn * a), wf = sd * (HW - 0.04);
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i], ub = us[i + 1], ea = ar.yi(ua) + ar.dep(ua), eb = ar.yi(ub) + ar.dep(ub), fa = fb(ua), fbb = fb(ub);
      if (fa - ea < 0.02 && fbb - eb < 0.02) continue;
      const ta = (B.SPAN - Math.abs(ua)) / 1.6, tb = (B.SPAN - Math.abs(ub)) / 1.6;
      const v = (y, e) => 0.02 + 0.46 * Math.min(1, Math.max(0, (y - e) / 0.8));
      CU.quad([ua, ea, wf], [ub, eb, wf], [ub, Math.max(eb, fbb), wf], [ua, Math.max(ea, fa), wf], COL.iron, [ta, v(ea, ea)], [tb, v(eb, eb)], [tb, v(Math.max(eb, fbb), eb)], [ta, v(Math.max(ea, fa), ea)]);
    }
  }
  // -- the railings: plinth, the pierced ring band, the moulded top rail; iron piers with rosette panels and urns
  const piers = [-B.IRON, -B.PIER + 0.4, B.PIER - 0.4, B.IRON, -17.6, 17.6];
  const urnAt = new Set([-B.IRON, -B.PIER + 0.4, B.PIER - 0.4, B.IRON]);
  const PW = 0.4;                                                          // a pier's half length along u
  const runs = []; { const cuts = [-B.END + 0.35, ...piers.slice().sort((a, b) => a - b), B.END - 0.35]; for (let i = 0; i + 1 < cuts.length; i++) runs.push([cuts[i] + (i ? PW : 0), cuts[i + 1] - (i + 2 < cuts.length ? PW : 0)]); }
  for (const sd of [-1, 1]) {
    const w = sd * RW;
    for (const [u0, u1] of runs) {
      if (u1 - u0 < 0.1) continue;
      const us = steps(u0, u1, Math.max(2, Math.ceil((u1 - u0) / 0.35)));
      I.band(us, (u) => [yd(u), w], [[-0.06, 0], [-0.06, 0.12], [0.06, 0.12], [0.06, 0]], COL.iron);                 // the plinth rail
      I.band(us, (u) => [yd(u), w], [[-0.09, 0.78], [-0.1, 0.84], [-0.085, 0.9], [-0.04, 0.925], [0.04, 0.925], [0.085, 0.9], [0.1, 0.84], [0.09, 0.78], [-0.09, 0.78]], COL.iron);
      for (let i = 0; i + 1 < us.length; i++) {
        const ua = us[i], ub = us[i + 1], ya = yd(ua), yb = yd(ub), ta = ua / 1.32, tb = ub / 1.32;
        CU.quad([ua, ya + 0.12, w], [ub, yb + 0.12, w], [ub, yb + 0.78, w], [ua, ya + 0.78, w], COL.iron, [ta, 0.502], [tb, 0.502], [tb, 0.998], [ta, 0.998]);
      }
    }
    for (const p of piers) {
      const y = yd(p), top = y + 1.02;
      I.box(2 * PW, top - (y - 0.41), 0.34, COL.iron, p, y - 0.41, w);                                             // the pier
      I.box(2 * PW + 0.12, 0.08, 0.46, COL.ironS, p, top, w); I.box(2 * PW + 0.04, 0.05, 0.4, COL.iron, p, top + 0.08, w);   // its cap
      I.box(2 * PW - 0.16, 0.5, 0.02, COL.ironS, p, y + 0.26, w + sd * 0.17);                                       // the sunk panel
      I.cyl(0.13, 0.13, 0.05, COL.iron, p, y + 0.51, w + sd * 0.18, 12, Math.PI / 2);                               // its rosette
      I.cyl(0.06, 0.06, 0.05, COL.ironS, p, y + 0.51, w + sd * 0.215, 8, Math.PI / 2);
      if (urnAt.has(p)) {
        // the planting urns (Robinson Iron's 1974 replicas, 3.5 ft): a footed bowl on a square plinth, planted
        const yb = top + 0.13;
        I.box(0.36, 0.1, 0.36, COL.iron, p, yb, w);
        I.lathe('bowurn', [[0.0, 0], [0.12, 0], [0.12, 0.05], [0.07, 0.1], [0.06, 0.2], [0.09, 0.28], [0.2, 0.36], [0.3, 0.5], [0.34, 0.62], [0.36, 0.7], [0.33, 0.72], [0.3, 0.7]], COL.urn, p, yb + 0.1, w, 1, 16);
        MT.sphere(0.34, COL.leafUrn, p, yb + 0.85, w, 0.55, 10);
        for (let k = 0; k < 7; k++) { const a = k * 2.4; MT.sphere(0.07, COL.flower, p + Math.cos(a) * 0.22, yb + 0.9 + (k % 2) * 0.06, w + Math.sin(a) * 0.22, 1, 6); }
      }
    }
    // the scroll terminals at the four ends: the rail sweeps down and out into a volute
    for (const sg of [-1, 1]) {
      const u0 = sg * (B.END - 0.35), yg = yd(sg * B.END);
      const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10, a = t * Math.PI / 2; pts.push([u0 + sg * Math.sin(a) * 0.75, yg + 0.3 + (yd(u0) + 0.92 - yg - 0.3) * Math.cos(a), w + sd * 0.18 * t]); }
      for (let k = 0; k + 1 < pts.length; k++) {
        const a = pts[k], b = pts[k + 1];
        for (const [dw0, dw1] of [[-0.13, 0.13]]) {
          I.quad([a[0], a[1], a[2] + dw0], [b[0], b[1], b[2] + dw0], [b[0], b[1] - 0.22, b[2] + dw0], [a[0], a[1] - 0.22, a[2] + dw0], COL.iron);
          I.quad([a[0], a[1], a[2] + dw1], [b[0], b[1], b[2] + dw1], [b[0], b[1] - 0.22, b[2] + dw1], [a[0], a[1] - 0.22, a[2] + dw1], COL.iron);
          I.quad([a[0], a[1], a[2] + dw0], [b[0], b[1], b[2] + dw0], [b[0], b[1], b[2] + dw1], [a[0], a[1], a[2] + dw1], COL.iron);
        }
      }
      const e = pts[pts.length - 1];
      I.cyl(0.24, 0.24, 0.3, COL.iron, e[0] + sg * 0.05, e[1] - 0.12, e[2] - 0.15, 16, Math.PI / 2);
      I.cyl(0.1, 0.1, 0.34, COL.ironS, e[0] + sg * 0.05, e[1] - 0.12, e[2] - 0.17, 12, Math.PI / 2);
      // the ring band and plinth down the sweep's inside, a stone base course under it
      S.box(0.9, Math.max(0.2, yd(u0) - yg + 0.25), 0.44, COL.graniteD, u0 + sg * 0.25, yg - 0.25, w);
    }
  }
  // -- the stone: the abutments (ashlar walls standing in the water, the arch springing from their faces), the pilasters
  // under the springing piers with their rosette medallions, the approach walls to the ends
  for (const sg of [-1, 1]) {
    const u0 = sg * B.SPAN, u1 = sg * (B.END + 0.3), bot = Math.min(W, Math.min(gS, gN)) - 1.2;
    const us = steps(u0, u1, 24);
    for (const sd of [-1, 1]) {
      const w = sd * (HW + 0.06);
      for (let i = 0; i + 1 < us.length; i++) { const ua = us[i], ub = us[i + 1]; S.quad([ua, bot, w], [ub, bot, w], [ub, yd(ub) - 0.4, w], [ua, yd(ua) - 0.4, w], COL.granite); }
      // the pilaster: plinth course, shaft, the recessed panel with its rosette medallion and pendant
      const pu = sg * (B.SPAN + 0.4), yt = yd(pu) - 0.41;
      S.box(1.0, yt - (W - 0.6), 0.2, COL.granite, pu, W - 0.6, w + sd * 0.1);
      S.box(1.16, 0.45 + (W - bot) * 0, 0.34, COL.graniteD, pu, W - 0.6, w + sd * 0.1);
      S.box(0.6, (yt - W) * 0.62, 0.04, COL.graniteD, pu, W + 0.22, w + sd * 0.21);
      S.cyl(0.17, 0.17, 0.08, COL.graniteL, pu, W + 0.22 + (yt - W) * 0.5, w + sd * 0.23, 14, Math.PI / 2);
      S.box(1.12, 0.1, 0.3, COL.graniteL, pu, yt - 0.1, w + sd * 0.1);
    }
    // the springing face under the arch, the far end, the top under the fascia and pavement
    S.quad([u0, bot, -(HW + 0.06)], [u0, bot, HW + 0.06], [u0, yd(u0) - 0.4, HW + 0.06], [u0, yd(u0) - 0.4, -(HW + 0.06)], COL.graniteD);
    S.quad([u1, bot, -(HW + 0.06)], [u1, bot, HW + 0.06], [u1, yd(u1) - 0.02, HW + 0.06], [u1, yd(u1) - 0.02, -(HW + 0.06)], COL.granite);
    // the approach walls' coping beyond the fascia, under the railing
    const uc = steps(sg * B.SHORE, u1, 12);
    for (const mir of [false, true]) S.band(uc, (u) => [yd(u), 0], [[HW - 0.3, 0.0], [HW + 0.12, 0.0], [HW + 0.12, -0.14], [HW + 0.06, -0.14], [HW + 0.06, -0.42]], COL.graniteL, mir);
  }
  // the skewbacks: granite blocks the ribs spring from
  for (const sg of [-1, 1]) S.box(0.5, 0.5, 2 * HW, COL.graniteL, sg * (B.SPAN - 0.2), ar.yS - 0.25, 0);
  const out = [];
  for (const [b, m, n] of [[I, M.iron, 'iron'], [CU, M.ironCut, 'ironcut'], [S, M.stone, 'stone'], [WD, M.wood, 'wood'], [MT, M.matte, 'matte']]) {
    const mesh = b.mesh(m, 'cp32m:bow:' + n); if (mesh) { group.add(mesh); out.push([n, b.tris]); }
  }
  return out;
}

// the walkers' deck over the bridge: prisms under 'kit31' (sim/peds.js _campusTop stands them on the highest one), the
// railings as obstacles, and the promenade line from path to path across it
export function bowColliders(COLLIDERS, W, gS, gN) {
  const B = BOW, [cx, cz] = B.C, [ax, az] = B.A, rot = Math.atan2(az, ax);   // colliders.js: local x -> (cos, sin) in world (x, z)
  const P = (u, w) => [cx + ax * u - az * w, cz + az * u + ax * w];
  let n = 0;
  for (let u = -B.END; u < B.END - 1e-6; u += 1.5) {
    const u1 = Math.min(B.END, u + 1.5), um = (u + u1) / 2, top = Math.max(bowDeckY(u, W, gS, gN), bowDeckY(u1, W, gS, gN), bowDeckY(um, W, gS, gN));
    const [x, z] = P(um, 0);
    COLLIDERS.addBox('kit31', { x, y: top - 0.3, z, hw: (u1 - u) / 2 + 0.05, hh: 0.3, hd: B.RAIL - 0.12, rotY: rot, deck: true }); n++;
    for (const sd of [-1, 1]) { const [xr, zr] = P(um, sd * B.RAIL); COLLIDERS.addBox('kit31', { x: xr, y: top + 0.45, z: zr, hw: (u1 - u) / 2 + 0.05, hh: 0.5, hd: 0.14, rotY: rot }); n += 1; }
  }
  return n;
}
export function bowPromenade(W, gS, gN) {
  const B = BOW, [cx, cz] = B.C, [ax, az] = B.A, pts = [];
  for (let u = -(B.END + 5); u <= B.END + 5 + 1e-6; u += 1.5) { const y = Math.abs(u) <= B.END ? bowDeckY(u, W, gS, gN) : (u < 0 ? gS : gN); pts.push([cx + ax * u, y, cz + az * u]); }
  return pts;
}

// ---- the rowboats ---------------------------------------------------------------------------------------------------
// The Loeb Boathouse's rowboats (the Boathouse rents about 100): a 4.3 m (14 ft) rowboat of 1.3 m beam, the rower on the
// centre thwart facing the stern, 2.1 m oars pivoting in oarlocks at the gunwale, passengers on the stern and bow seats.
// Each boat keeps to its own course (tools/cp/lm_boats.mjs: ellipses 6 m or more off every shore and clear of the bridges
// and landings) at a rowing pace, or drifts with its oars shipped. Instanced: 8 meshes for the whole fleet, the matrices
// written in place once per sim step (ENV.time, so a recorded take steps them frame-exactly), no allocation per frame.
const BL = 4.3, BB = 0.66;                              // length, half beam
function hullGeo(inside) {
  // stations bow (t 1) to stern (t -1); a U section from gunwale to keel; the sheer rises toward the bow
  const NS = 16, NK = 7, P = [];
  const half = (t) => (t > 0 ? BB * Math.sqrt(Math.max(0, 1 - t ** 2.2)) : BB * (1 - 0.3 * t * t));
  const sheer = (t) => 0.42 + 0.1 * Math.max(0, t) ** 2 + 0.02 * t * t;
  const keel = (t) => -0.17 + 0.12 * Math.max(0, t) ** 3;
  const sec = (t, k) => {                                // k 0..NK-1 from port gunwale to starboard gunwale
    const h = half(t) - (inside ? 0.03 : 0), g = sheer(t) - (inside ? 0.02 : 0), kl = keel(t) + (inside ? 0.04 : 0);
    const a = (k / (NK - 1)) * Math.PI;                  // 0 port .. PI starboard
    const c = -Math.cos(a), s = Math.sin(a);
    return [t * BL / 2, g + (kl - g) * Math.pow(s, 0.7), c * h * (0.35 + 0.65 * Math.pow(Math.abs(c), 0.35))];
  };
  for (let i = 0; i < NS; i++) {
    const t0 = 1 - 2 * i / NS, t1 = 1 - 2 * (i + 1) / NS;
    for (let k = 0; k + 1 < NK; k++) {
      const a = sec(t0, k), b = sec(t1, k), c = sec(t1, k + 1), d = sec(t0, k + 1);
      if (inside) P.push(...a, ...c, ...b, ...a, ...d, ...c); else P.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  }
  if (!inside) {
    // the transom at the stern, and the gunwale's cap joining the outer and inner shells
    const T = [];
    for (let k = 0; k < NK; k++) T.push(sec(-1, k));
    for (let k = 1; k + 1 < NK; k++) P.push(...T[0], ...T[k + 1], ...T[k]);
    const cap = (t, sgn) => { const h = half(t), g = sheer(t); return [[t * BL / 2, g, sgn * h], [t * BL / 2, g + 0.03, sgn * (h - 0.015)], [t * BL / 2, g, sgn * (h - 0.05)]]; };
    for (let i = 0; i < NS; i++) {
      const t0 = 1 - 2 * i / NS, t1 = 1 - 2 * (i + 1) / NS;
      for (const sgn of [-1, 1]) {
        const A = cap(t0, sgn), B = cap(t1, sgn);
        for (let k = 0; k < 2; k++) P.push(...A[k], ...B[k], ...B[k + 1], ...A[k], ...B[k + 1], ...A[k + 1]);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.computeVertexNormals();
  return g;
}
function mergeParts(parts) {
  // [geometry, matrix, THREE.Color] -> one non-indexed geometry with vertex colours
  const P = [], N = [], C = [];
  for (const [g0, m, col] of parts) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const p = g.attributes.position, n = g.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); P.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); N.push(v.x, v.y, v.z);
      C.push(col.r, col.g, col.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(C), 3));
  return g;
}
const mT = (x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
const BOAT = { seatC: 0.05, seatS: -1.38, seatB: 1.3, seatY: 0.2, lockX: -0.28, lockY: 0.5, lockZ: 0.66, oarIn: 0.62, oarOut: 1.5 };
function boatGeos() {
  const box = new THREE.BoxGeometry(1, 1, 1), cyl = new THREE.CylinderGeometry(1, 1, 1, 8), sph = new THREE.SphereGeometry(1, 12, 8);
  const hullOut = mergeParts([[hullGeo(false), new THREE.Matrix4(), K(0xffffff)]]);
  const inner = mergeParts([
    [hullGeo(true), new THREE.Matrix4(), K(0xd2cdc2)],
    [box, mT(0, -0.09, 0, 3.1, 0.02, 0.7), K(0x9a7a55)],                                             // the floorboards
    [box, mT(BOAT.seatC, BOAT.seatY - 0.02, 0, 0.26, 0.04, 1.26), K(0xa4835c)],                      // the centre thwart
    [box, mT(BOAT.seatB, BOAT.seatY + 0.02, 0, 0.24, 0.04, 0.96), K(0xa4835c)],                      // the bow seat
    [box, mT(BOAT.seatS + 0.1, BOAT.seatY - 0.02, 0, 0.62, 0.04, 1.1), K(0xa4835c)],                 // the stern seat
    [cyl, mT(BOAT.lockX, BOAT.lockY - 0.03, BOAT.lockZ, 0.02, 0.08, 0.02), K(0x6a6a66)],             // the oarlocks
    [cyl, mT(BOAT.lockX, BOAT.lockY - 0.03, -BOAT.lockZ, 0.02, 0.08, 0.02), K(0x6a6a66)],
  ]);
  // an oar along +x from its pivot: the handle inboard, the loom, the blade
  const oar = mergeParts([
    [cyl, mT(-BOAT.oarIn + 0.07, 0, 0, 0.018, 0.14, 0.018, 0, 0, Math.PI / 2), K(0x3a2a1c)],
    [cyl, mT((BOAT.oarOut - BOAT.oarIn) / 2 - 0.12, 0, 0, 0.024, BOAT.oarIn + BOAT.oarOut - 0.62, 0.024, 0, 0, Math.PI / 2), K(0xb89a6a)],
    [box, mT(BOAT.oarOut - 0.25, 0, 0, 0.5, 0.012, 0.14), K(0xb89a6a)],
  ]);
  // a seated person (the frame: the hip at the origin, facing +x): torso pivoting at the hip, head, hair, legs, arms
  const torso = mergeParts([[box, mT(0, 0.27, 0, 0.22, 0.54, 0.38), K(0xffffff)], [sph, mT(0, 0.5, 0, 0.12, 0.08, 0.2), K(0xffffff)]]);
  const head = mergeParts([[sph, mT(0, 0, 0, 0.095, 0.115, 0.09), K(0xffffff)], [box, mT(0, -0.1, 0, 0.08, 0.08, 0.08), K(0xffffff)]]);
  const hair = mergeParts([[new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), mT(-0.01, 0.02, 0, 0.102, 0.118, 0.098), K(0xffffff)]]);
  const legs = mergeParts([
    [box, mT(0.2, 0.05, 0.1, 0.44, 0.15, 0.15), K(0xffffff)], [box, mT(0.2, 0.05, -0.1, 0.44, 0.15, 0.15), K(0xffffff)],
    [box, mT(0.44, -0.16, 0.1, 0.12, 0.42, 0.12, 0, 0, 0.15), K(0xffffff)], [box, mT(0.44, -0.16, -0.1, 0.12, 0.42, 0.12, 0, 0, 0.15), K(0xffffff)],
    [box, mT(0.5, -0.36, 0.1, 0.24, 0.07, 0.1), K(0x2a2a2a)], [box, mT(0.5, -0.36, -0.1, 0.24, 0.07, 0.1), K(0x2a2a2a)],
  ]);
  const arm = mergeParts([[new THREE.CylinderGeometry(1, 0.8, 1, 6, 1, true).translate(0, 0.5, 0), new THREE.Matrix4(), K(0xffffff)]]);
  return { hullOut, inner, oar, torso, head, hair, legs, arm };
}
const PAL = {
  hull: [0xdedcd6, 0xc9ccca, 0xb4b9ba, 0xe6e4de, 0xcfd2d0, 0x2f5d45, 0x2c4a73, 0xd8d6d0, 0xbfc3c3, 0x3767a8].map(K),
  shirt: [0xd8d4cc, 0x2d4f8a, 0xb03a2e, 0x3a6b3f, 0xe0b84a, 0x2a2a2a, 0x8a6fa8, 0xe07a5f, 0x6a8caf, 0xf0eee8].map(K),
  legs: [0x2d3a52, 0x3a3a3a, 0xb8ad94, 0x1f2430, 0x4a5a6a].map(K),
  skin: [0xe8c4a8, 0xd9a882, 0xb07a52, 0x7a4e32, 0x5a3a26, 0xf0d0b8].map(K),
  hair: [0x2a1f18, 0x4a3222, 0x8a6a42, 0x1a1a1a, 0xb09060, 0x6a6a6a].map(K),
};
// boats tied up at a landing: [[x, z, heading], ...], empty, rocking a little on the sim clock
export function buildMooredBoats(group, list, W) {
  const G = boatGeos();
  const mat = own(applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }))), 'boatM');
  const hull = new THREE.InstancedMesh(G.hullOut, mat, list.length), inner = new THREE.InstancedMesh(G.inner, mat, list.length);
  hull.name = 'cp32m:moored:hull'; inner.name = 'cp32m:moored:inner';
  const q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), m = new THREE.Matrix4();
  let lastT = -1;
  const upd = () => {
    const t = ENV.time.value; if (t === lastT) return; lastT = t;
    list.forEach(([x, z, h], i) => { e.set(0.02 * Math.sin(0.8 * t + i * 1.7), -h, 0.008 * Math.sin(1.1 * t + i), 'YXZ'); q.setFromEuler(e); p.set(x, W + 0.01 * Math.sin(1.2 * t + i), z); m.compose(p, q, s1); hull.setMatrixAt(i, m); inner.setMatrixAt(i, m); });
    hull.instanceMatrix.needsUpdate = true; inner.instanceMatrix.needsUpdate = true;
  };
  list.forEach((_, i) => { const r = Math.sin(i * 77.7) * 43758.5453; hull.setColorAt(i, PAL.hull[Math.floor((r - Math.floor(r)) * PAL.hull.length)]); });
  hull.instanceColor.needsUpdate = true;
  upd();
  for (const o of [hull, inner]) { o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true; group.add(o); }
  hull.onBeforeRender = upd; hull.onBeforeShadow = upd;
  return list.length;
}
// courses: [[cx, cz, a, b, psi, dir, v, phase], ...] (a 0: drifting); waterAt(x, z): the surface y
export function buildRowboats(group, courses, waterAt) {
  const G = boatGeos();
  const mat = own(applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.05, side: THREE.DoubleSide }))), 'boat');
  const nb = courses.length;
  const boats = courses.map((c, i) => {
    const h = (k) => { const s = Math.sin((i + 1) * 91.7 + k * 13.1) * 43758.5453; return s - Math.floor(s); };
    const pax = c[2] > 0 ? (h(1) < 0.45 ? 1 : h(1) < 0.8 ? 2 : 0) : (h(1) < 0.5 ? 1 : 2);
    return { c, y: waterAt(c[0], c[1]), pax, h, rowing: c[2] > 0 };
  });
  const np = boats.reduce((s, b) => s + 1 + b.pax, 0);
  const mk = (geo, n, name) => { const m = new THREE.InstancedMesh(geo, mat, n); m.name = 'cp32m:boats:' + name; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true; group.add(m); return m; };
  const hull = mk(G.hullOut, nb, 'hull'), inner = mk(G.inner, nb, 'inner'), oars = mk(G.oar, 2 * nb, 'oar');
  const torso = mk(G.torso, np, 'torso'), head = mk(G.head, np, 'head'), hair = mk(G.hair, np, 'hair'), legs = mk(G.legs, np, 'legs'), arms = mk(G.arm, 2 * np, 'arm');
  let pi = 0;
  const people = [];
  boats.forEach((b, i) => {
    hull.setColorAt(i, PAL.hull[(b.h(2) * PAL.hull.length) | 0]);
    const seats = [{ x: BOAT.seatC + 0.02, face: -1, rower: true }];
    if (b.pax >= 1) seats.push({ x: BOAT.seatS - 0.05, face: 1, rower: false });
    if (b.pax >= 2) seats.push({ x: BOAT.seatB + 0.02, face: -1, rower: false });
    for (const s of seats) {
      const k = pi++, r = (q) => b.h(10 + k * 7 + q);
      const shirt = PAL.shirt[(r(1) * PAL.shirt.length) | 0];
      torso.setColorAt(k, shirt); head.setColorAt(k, PAL.skin[(r(2) * PAL.skin.length) | 0]);
      hair.setColorAt(k, PAL.hair[(r(3) * PAL.hair.length) | 0]); legs.setColorAt(k, PAL.legs[(r(4) * PAL.legs.length) | 0]);
      arms.setColorAt(2 * k, shirt); arms.setColorAt(2 * k + 1, shirt);
      people.push({ boat: i, k, ...s, lean: 0.05 + r(5) * 0.1 });
    }
  });
  for (const m of [hull, torso, head, hair, legs, arms]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  // per-frame state (preallocated)
  const Mb = new THREE.Matrix4(), Ml = new THREE.Matrix4(), Mo = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const p = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), va = new THREE.Vector3(), vb = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dv = new THREE.Vector3();
  const st = new Float32Array(nb * 4);                  // per boat: stroke s, blade depth d, lean, rowing
  const hand = new Float32Array(nb * 6);                // per boat: the two handles in the boat frame
  const MbA = Array.from({ length: nb }, () => new THREE.Matrix4());
  let lastT = -1;
  const TWO = Math.PI * 2;
  const update = () => {
    const t = ENV.time.value;
    if (t === lastT) return;
    lastT = t;
    for (let i = 0; i < nb; i++) {
      const b = boats[i], [cx, cz, a, bb, psi, dir, v, ph] = b.c;
      let x, z, hd;
      if (b.rowing) {
        const rm = Math.sqrt((a * a + bb * bb) / 2), phi = ph + dir * (v / rm) * t;
        const ca = Math.cos(psi), sa = Math.sin(psi), co = Math.cos(phi), si = Math.sin(phi);
        x = cx + ca * a * co - sa * bb * si; z = cz + sa * a * co + ca * bb * si;
        const dx = dir * (-ca * a * si - sa * bb * co), dz = dir * (-sa * a * si + ca * bb * co);
        hd = Math.atan2(dz, dx);
      } else {
        x = cx + 0.8 * Math.cos(0.01 * t + ph); z = cz + 0.8 * Math.sin(0.013 * t + ph);
        hd = psi + 0.35 * Math.sin(0.04 * t + ph);
      }
      const y = b.y + 0.012 * Math.sin(1.3 * t + ph);
      e.set(0.022 * Math.sin(0.9 * t + 2 * ph), -hd, 0.012 * Math.sin(1.1 * t + ph), 'YXZ');
      q.setFromEuler(e); p.set(x, y, z);
      Mb.compose(p, q, s1); MbA[i].copy(Mb);
      hull.setMatrixAt(i, Mb); inner.setMatrixAt(i, Mb);
      // the stroke: the drive (blades in, 40 % of a 3.4 s cycle) and the recovery
      let sv = 0.35, dp = 0, lean = 0;
      if (b.rowing) {
        const f = ((t / 3.4 + ph / TWO) % 1 + 1) % 1;
        if (f < 0.4) { const u = f / 0.4; sv = u * u * (3 - 2 * u); dp = Math.min(1, Math.min(f, 0.4 - f) / 0.05); } else { const u = (f - 0.4) / 0.6; sv = 1 - u * u * (3 - 2 * u); dp = 0; }
        lean = 0.38 - 0.6 * sv;
      }
      st[i * 4] = sv; st[i * 4 + 1] = dp; st[i * 4 + 2] = lean; st[i * 4 + 3] = b.rowing ? 1 : 0;
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        let beta, eps;
        if (b.rowing) { beta = 0.75 - 1.3 * sv; eps = 0.46 * dp + 0.28 * (1 - dp); } else { beta = -1.35; eps = -0.02; }   // the blade dipped 5 cm on the drive, 15 cm clear on the recovery
        const ox = Math.sin(beta), oz = sg * Math.cos(beta);             // the outboard direction (horizontal)
        e.set(0, Math.atan2(-oz, ox), -eps, 'YXZ'); q.setFromEuler(e);
        p.set(BOAT.lockX, BOAT.lockY, sg * BOAT.lockZ);
        Ml.compose(p, q, s1); Mo.multiplyMatrices(Mb, Ml);
        oars.setMatrixAt(2 * i + side, Mo);
        const ce = Math.cos(eps);                                        // the handle (inboard end) in the boat frame
        hand[i * 6 + side * 3] = BOAT.lockX - BOAT.oarIn * ox * ce; hand[i * 6 + side * 3 + 1] = BOAT.lockY + BOAT.oarIn * Math.sin(eps) - 0.02; hand[i * 6 + side * 3 + 2] = sg * BOAT.lockZ - BOAT.oarIn * oz * ce;
      }
    }
    for (const pr of people) {
      const i = pr.boat, Mbi = MbA[i], rowing = st[i * 4 + 3] > 0;
      const lean = pr.rower ? (rowing ? st[i * 4 + 2] : 0.08) : pr.lean;
      // the person's frame in the boat: hip on the seat, facing the bow (face 1) or the stern (face -1)
      const yawP = pr.face > 0 ? 0 : Math.PI, hx = pr.x, hy = BOAT.seatY + 0.07;
      e.set(0, yawP, -lean, 'YXZ'); q.setFromEuler(e);
      p.set(hx, hy, 0); Ml.compose(p, q, s1); Mo.multiplyMatrices(Mbi, Ml); torso.setMatrixAt(pr.k, Mo);
      e.set(0, yawP, 0, 'YXZ'); q.setFromEuler(e); Ml.compose(p, q, s1); Mo.multiplyMatrices(Mbi, Ml); legs.setMatrixAt(pr.k, Mo);
      // head and hair over the shoulders (the torso's top follows its lean)
      const fx = pr.face > 0 ? 1 : -1, sl = Math.sin(lean), cl = Math.cos(lean);
      p.set(hx + fx * 0.68 * sl, hy + 0.68 * cl, 0);
      e.set(0, yawP, -lean * 0.5, 'YXZ'); q.setFromEuler(e); Ml.compose(p, q, s1); Mo.multiplyMatrices(Mbi, Ml);
      head.setMatrixAt(pr.k, Mo); hair.setMatrixAt(pr.k, Mo);
      // the arms: shoulder to hand (the rower's hands on the handles, a passenger's in the lap)
      for (let side = 0; side < 2; side++) {
        const sg = side ? 1 : -1;
        va.set(hx + fx * 0.48 * sl, hy + 0.48 * cl, sg * 0.19);
        if (pr.rower) vb.set(hand[i * 6 + side * 3], hand[i * 6 + side * 3 + 1], hand[i * 6 + side * 3 + 2] * 0.55 + sg * 0.1);
        else vb.set(hx + fx * 0.3, hy + 0.12, sg * 0.14);
        va.applyMatrix4(Mbi); vb.applyMatrix4(Mbi);
        dv.subVectors(vb, va); const L = dv.length() || 1e-3; dv.multiplyScalar(1 / L);
        q.setFromUnitVectors(up, dv); p.set(0.045, L, 0.045);
        Mo.compose(va, q, p); arms.setMatrixAt(2 * pr.k + side, Mo);
      }
    }
    for (const m of [hull, inner, oars, torso, head, hair, legs, arms]) m.instanceMatrix.needsUpdate = true;
  };
  update();
  hull.onBeforeRender = update;
  hull.onBeforeShadow = update;
  return { boats: nb, people: np, update };
}

// ---- shared pieces: hip roofs, walls with windows ------------------------------------------------------------------
// a hip roof over the frame rectangle [u0, u1] x [w0, w1] (eaves at yE, overhang o, pitch t = tan), its soffit and fascia
export function hipRoof(B, u0, u1, w0, w1, yE, o, t, col, colS) {
  const a0 = u0 - o, a1 = u1 + o, b0 = w0 - o, b1 = w1 + o, lu = a1 - a0, lw = b1 - b0;
  const r = Math.min(lu, lw) / 2, yR = yE + r * t;
  if (lu >= lw) {
    const r0 = [a0 + r, yR, (b0 + b1) / 2], r1 = [a1 - r, yR, (b0 + b1) / 2];
    B.quad([a0, yE, b0], [a1, yE, b0], r1, r0, col); B.quad([a1, yE, b1], [a0, yE, b1], r0, r1, col);
    B.tri([a0, yE, b1], [a0, yE, b0], r0, col); B.tri([a1, yE, b0], [a1, yE, b1], r1, col);
  } else {
    const r0 = [(a0 + a1) / 2, yR, b0 + r], r1 = [(a0 + a1) / 2, yR, b1 - r];
    B.quad([a1, yE, b0], [a1, yE, b1], r1, r0, col); B.quad([a0, yE, b1], [a0, yE, b0], r0, r1, col);
    B.tri([a0, yE, b0], [a1, yE, b0], r0, col); B.tri([a1, yE, b1], [a0, yE, b1], r1, col);
  }
  B.quad([a0, yE, b0], [a0, yE, b1], [a1, yE, b1], [a1, yE, b0], colS);                   // the soffit
  for (const [p, q] of [[[a0, b0], [a1, b0]], [[a1, b0], [a1, b1]], [[a1, b1], [a0, b1]], [[a0, b1], [a0, b0]]]) B.quad([p[0], yE - 0.22, p[1]], [q[0], yE - 0.22, q[1]], [q[0], yE, q[1]], [p[0], yE, p[1]], colS);
  return yR;
}
// a wall along one edge of a rectangle from (u0, w0) to (u1, w1), y0..y1, with windows every `bay` (sill s, head h)
export function wallRun(B, G, a, b, y0, y1, col, o = {}) {
  const [u0, w0] = a, [u1, w1] = b, L = Math.hypot(u1 - u0, w1 - w0);
  const bay = o.bay || 0, sill = o.sill ?? 1.0, head = o.head ?? 2.6, ww = o.win ?? 1.2, frame = o.frame, glass = o.glass;
  const P = (s, y) => [u0 + (u1 - u0) * s / L, y, w0 + (w1 - w0) * s / L];
  if (!bay || !G) { B.quad(P(0, y0), P(L, y0), P(L, y1), P(0, y1), col); return; }
  const n = Math.max(1, Math.floor(L / bay)), step = L / n;
  let s0 = 0;
  for (let i = 0; i < n; i++) {
    const c = (i + 0.5) * step, wl = c - ww / 2, wr = c + ww / 2;
    B.quad(P(s0, y0), P(wl, y0), P(wl, y1), P(s0, y1), col);                                // the pier left of the window
    B.quad(P(wl, y0), P(wr, y0), P(wr, sill), P(wl, sill), col);                             // under the sill
    B.quad(P(wl, head), P(wr, head), P(wr, y1), P(wl, y1), col);                             // over the head
    G.quad(P(wl, sill), P(wr, sill), P(wr, head), P(wl, head), glass);
    if (frame) { B.quad(P(wl - 0.08, sill - 0.08), P(wr + 0.08, sill - 0.08), P(wr + 0.08, sill), P(wl - 0.08, sill), frame); B.quad(P(wl - 0.08, head), P(wr + 0.08, head), P(wr + 0.08, head + 0.12), P(wl - 0.08, head + 0.12), frame); }
    s0 = wr;
  }
  B.quad(P(s0, y0), P(L, y0), P(L, y1), P(s0, y1), col);
}

// ---- the Loeb Boathouse --------------------------------------------------------------------------------------------
// 1954 (Stuart Constable for the Parks Department, the gift of Carl M. Loeb and Adeline Moses Loeb): a long low pavilion
// on the Lake's eastern arm, its lakeside a glazed colonnade of white columns over a stone water wall, the service ranges
// behind in red brick, pale green copper hip roofs over each range, a mast with a yard over the centre, the boat landing
// at the south end. Footprint: OSM relation 3698871 (7.3 m high), frame O (184.28, 837.65), u along (0.2037, 0.979),
// e east (w = -e): the lakeside face at e 0 from u 0 to 60.8, the open court u 19.9-28.7 x e 7.7-14.6.
export const BOATHOUSE = { O: [184.28, 837.65], A: [0.2037, 0.979], C: [205.5, 864.0] };
export function buildBoathouse(group, W, gE) {
  const M = lmMats(), GL = boatGlass();
  const [ox, oz] = BOATHOUSE.O, [ax, az] = BOATHOUSE.A;
  const mk = (uv) => new LBin(uv).frame(ox, 0, oz, ax, az);
  const WH = mk(), BR = mk(), RF = mk(), GS = mk(), ST = mk(), WD = mk();
  const F = W + 1.05, EAVE = F + 4.0, low = Math.min(W - 0.6, gE - 0.6);
  const cW = K(0xe9e5dc), cWS = K(0xd2cdc2), cBr = K(0x94483a), cBrD = K(0x7c3c31), cCu = K(0x7a9688), cCuS = K(0x647d72), cSt = K(0x9d968a), cDk = K(0x7a6a58), cAw = K(0x8a7258), cGl = K(0xffffff);
  const E = (e) => -e;                                          // the frame's w is west: w = -e
  // the ranges: [u0, u1, e0, e1, eave, pitch]
  const R = [[0, 19.9, 0, 32.0, EAVE + 0.4, 0.3], [19.9, 60.8, 0, 7.7, EAVE, 0.34], [19.9, 28.7, 14.6, 32.2, EAVE - 0.4, 0.3], [28.7, 57.5, 7.7, 24.6, EAVE - 0.4, 0.3]];   // low copper hips (the Commons photographs)
  for (const [u0, u1, e0, e1, yE, pt] of R) {
    // brick walls on the landward faces, the lakeside faces are the colonnade's (below)
    const faces = [[[u0, e1], [u1, e1]], [[u1, e1], [u1, e0]], [[u0, e0], [u0, e1]]];
    if (e0 > 0.1) faces.push([[u1, e0], [u0, e0]]);
    for (const [a, b] of faces) wallRun(BR, GS, [a[0], E(a[1])], [b[0], E(b[1])], low, yE - 0.22, cBr, { bay: 3.4, sill: F + 1.0, head: F + 2.7, win: 1.3, frame: cW, glass: cGl });
    hipRoof(RF, u0, u1, E(e1), E(e0), yE, 0.55, pt, cCu, cCuS);
    WH.band([u0 - 0.05, u1 + 0.05], () => [yE - 0.5, E(e1) - 0.02], [[0, 0], [0, 0.28]], cW);   // a white frieze under the eaves
  }
  // the service block's flat-roofed extension to the east
  { const u0 = 12.4, u1 = 24.0, e0 = 32.0, e1 = 37.7, yT = F + 3.1;
    for (const [a, b] of [[[u0, e1], [u1, e1]], [[u1, e1], [u1, e0]], [[u0, e0], [u0, e1]]]) wallRun(BR, null, [a[0], E(a[1])], [b[0], E(b[1])], low, yT, cBrD);
    BR.quad([u0, yT, E(e0)], [u1, yT, E(e0)], [u1, yT, E(e1)], [u0, yT, E(e1)], K(0x5a5752)); }
  // the court: paved, open to the sky
  ST.quad([19.9, F + 0.02, E(7.7)], [28.7, F + 0.02, E(7.7)], [28.7, F + 0.02, E(14.6)], [19.9, F + 0.02, E(14.6)], K(0x8f887c));
  // the lakeside colonnade: the stone water wall, the floor, white columns every 3.4 m with the glazing between them,
  // transoms, the entablature, awnings over the bays
  const U0 = 0, U1 = 60.8, n = 18, step = (U1 - U0) / n;
  ST.box(U1 - U0 + 0.6, F - (W - 0.8), 0.9, cSt, (U0 + U1) / 2, W - 0.8, E(0.25));                   // the water wall
  ST.box(U1 - U0 + 0.5, 0.12, 0.6, K(0xb0a99c), (U0 + U1) / 2, F - 0.12, E(-0.05));                 // its coping
  for (let i = 0; i <= n; i++) {
    const u = U0 + i * step;
    WH.cyl(0.19, 0.22, 3.5, cW, u, F, E(-0.1), 12); WH.box(0.5, 0.12, 0.5, cW, u, F, E(-0.1)); WH.box(0.52, 0.14, 0.52, cW, u, F + 3.5, E(-0.1));
  }
  for (let i = 0; i < n; i++) {
    const ua = U0 + i * step + 0.25, ub = U0 + (i + 1) * step - 0.25;
    GS.quad([ua, F + 0.35, E(0.15)], [ub, F + 0.35, E(0.15)], [ub, F + 3.1, E(0.15)], [ua, F + 3.1, E(0.15)], cGl);
    WH.box(ub - ua, 0.35, 0.12, cW, (ua + ub) / 2, F, E(0.15));                                          // the dado
    WH.box(ub - ua, 0.1, 0.12, cW, (ua + ub) / 2, F + 2.45, E(0.15));                                    // the transom bar
    for (const f of [1 / 3, 2 / 3]) WH.box(0.07, 2.75, 0.1, cW, ua + (ub - ua) * f, F + 0.35, E(0.15));  // mullions
    // the awning: a canvas slope from the transom out over the bay
    WD.quad([ua, F + 3.25, E(0.05)], [ub, F + 3.25, E(0.05)], [ub, F + 2.75, E(-1.0)], [ua, F + 2.75, E(-1.0)], cAw);
  }
  WH.box(U1 - U0 + 0.7, 0.62, 0.7, cW, (U0 + U1) / 2, F + 3.62, E(-0.05));                            // the entablature
  // the mast over the centre: a white pole with its yard and gaff, the flag
  const mu = 26.5, me = 3.8, mB = EAVE + 1.4;
  WH.cyl(0.07, 0.12, 12.5, cW, mu, mB, E(me), 10);
  WH.tube([mu - 2.2, mB + 8.6, E(me)], [mu + 2.2, mB + 8.6, E(me)], 0.05, cW, 6);
  WH.tube([mu, mB + 7.6, E(me)], [mu, mB + 9.4, E(me) + 1.8], 0.04, cW, 6);
  for (let k = 0; k < 7; k++) WD.quad([mu, mB + 11.4 - k * 0.15, E(me) + 0.05], [mu, mB + 11.4 - k * 0.15, E(me) + 1.6], [mu, mB + 11.25 - k * 0.15, E(me) + 1.6], [mu, mB + 11.25 - k * 0.15, E(me) + 0.05], k % 2 ? K(0xe8e6e0) : K(0xa3262c));
  WD.quad([mu, mB + 11.4, E(me) + 0.05], [mu, mB + 11.4, E(me) + 0.75], [mu, mB + 10.9, E(me) + 0.75], [mu, mB + 10.9, E(me) + 0.05], K(0x2a3a6a));
  // the boat landing: a timber dock along the south end's lakeside, bollards
  const du0 = 40, du1 = 66, de0 = -1.2, de1 = -4.2, dy = W + 0.38;
  WD.box(du1 - du0, 0.18, de0 - de1, cDk, (du0 + du1) / 2, dy - 0.18, E((de0 + de1) / 2));
  for (let u = du0 + 0.5; u < du1; u += 2.5) ST.cyl(0.12, 0.12, 0.9, K(0x5a4a3a), u, W - 0.5, E(de1 + 0.15), 8);
  const out = [];
  for (const [b, m, nm] of [[WH, M.matte, 'white'], [BR, M.matte, 'brick'], [RF, M.copper, 'copper'], [GS, GL, 'glass'], [ST, M.stone, 'stone'], [WD, M.wood, 'wood']]) {
    const mesh = b.mesh(m, 'cp32m:boathouse:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); }
  }
  // the moored rowboats off the dock, bows in
  const moor = [];
  for (let u = du0 + 1.0, k = 0; u < du1 - 0.5; u += 1.55, k++) {
    const x = ox + ax * u - az * (-(de1 - 2.25)), z = oz + az * u + ax * (-(de1 - 2.25));
    moor.push([x, z, Math.atan2(-ax, az) + 0.04 * Math.sin(k * 2.1)]);   // bows east, into the dock
  }
  out.push(['moored', buildMooredBoats(group, moor, W)]);
  return out;
}
let _bGlass = null;
function boatGlass() {
  if (_bGlass) return _bGlass;
  const gl = new THREE.MeshStandardMaterial({ vertexColors: true, color: 0x20282c, roughness: 0.08, metalness: 0.1, side: THREE.DoubleSide });
  gl.onBeforeCompile = (sh) => {
    sh.uniforms.lmNight = ENV.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float lmNight;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(1.0, 0.74, 0.46) * smoothstep(0.2, 0.8, lmNight) * 0.6;');
  };
  gl.customProgramCacheKey = () => 'cp32mglassB';
  _bGlass = own(applyLightTrim(applySkyGlass(gl, { f0: 0.09, rough: 0.05, tint: [0.95, 0.97, 1.0] })), 'glassB');
  return _bGlass;
}

// ---- Belvedere Castle ----------------------------------------------------------------------------------------------
// Calvert Vaux and Jacob Wrey Mould, 1867-69 (restored 1983 and 2019): Manhattan schist quarried in the park, dressed with
// grey granite, on the top of Vista Rock (130 ft, 39.6 m NAVD88) over Turtle Pond. OSM's building parts (ways 1317000456-
// 58, 1317000448-50) in the castle frame O (196.66, 418.45), u along (0.8716, 0.4903), w along (-0.4903, 0.8716): the keep
// u 0-5.1 x w 0-6.9 (two storeys and its roof terrace), the round corner turret with its conical slate cap at (5.56, 5.9),
// the timber lookout on the keep's roof at u 0-2 x w 0-2.4, the one-storey loggia wing u -8.6-0 x w -3.0-2.4, the timber
// pavilion with its hipped roof and pyramidal crown at u -28.6 to -17.8 x w -14.0 to -8.9, a second pavilion at u -31.2 to
// -25.7 x w 2.4-7.0, all on the paved terraces and their parapets. The rock under them is built here: the 14 m 3DEP grid
// smooths Vista Rock's top away (33.2 m against the published 39.6 m).
export const BELV = { O: [196.66, 418.45], A: [0.8716, 0.4903], C: [194.5, 419.9], PLAT: [-34, 8.5, -16.5, 9.5], BENCH: [-12.5, -8.5, -4.5, 1.5] };
const h2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vnoise = (x, y) => { const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = h2(i, j), b = h2(i + 1, j), c = h2(i, j + 1), d = h2(i + 1, j + 1), su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v); return a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv; };
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 5.2, y * 2.1 + 1.3) * 0.3 + vnoise(x * 4.3 + 9.1, y * 4.3 + 7.7) * 0.15;
export function buildBelvedere(group, B, groundAt) {
  const M = lmMats();
  const [ox, oz] = BELV.O, [ax, az] = BELV.A;
  const mk = () => new LBin().frame(ox, 0, oz, ax, az);
  const SC = mk(), GR = mk(), RK = mk(), SL = mk(), TW = mk(), DK = mk();
  // (CPB33, the owner's review of teaser 4: the castle read dark from Turtle Pond; since the 2019 restoration its schist
  // is a light warm grey and the granite trim paler still, the photographs from the Pond: the tones raised a third)
  const cSch = K(0x9a948a), cSchD = K(0x86807a), cSchL = K(0xaaa49a), cGr = K(0xcac6bd), cGrD = K(0xb6b2a9), cSl = K(0x4b5057), cSlD = K(0x3d4147);
  const cTim = K(0x7c4a2c), cTimL = K(0xa0683c), cWin = K(0x22262a), cPave = K(0x9c978d), cRock = K(0x7a756d), cRockL = K(0x908a81), cMoss = K(0x56613f);
  const WL = (u, w) => [ox + ax * u - az * w, oz + az * u + ax * w];
  // -- Vista Rock: a ring of rock round the terrace's plateau, falling from the terrace to the ground in craggy steps
  const [pu0, pu1, pw0, pw1] = BELV.PLAT, RM = 7.5, st = 1.25;
  const nu = Math.ceil((pu1 - pu0 + 2 * RM) / st), nw = Math.ceil((pw1 - pw0 + 2 * RM) / st);
  const H = [], G = [];
  for (let j = 0; j <= nw; j++) for (let i = 0; i <= nu; i++) {
    const u = pu0 - RM + i * st, w = pw0 - RM + j * st;
    const du = Math.max(pu0 - u, 0, u - pu1), dw = Math.max(pw0 - w, 0, w - pw1), d = Math.hypot(du, dw);
    const [x, z] = WL(u, w), g = groundAt(x, z);
    const n = fbm(u * 0.35, w * 0.35);
    // the rock's face: the plateau's edge, then ledges down to the ground, farther out where the noise swells it
    const reach = RM * (0.55 + 0.6 * n), t = Math.min(1, d / reach);
    const ledge = Math.floor(t * 4) / 4 * 0.6 + t * 0.4;
    let y = B - 0.12 - (B - g) * Math.pow(ledge, 0.8) + (n - 0.5) * 0.9 * Math.min(1, d);
    if (d <= 0) y = B - 0.12;
    H.push(Math.max(y, g - 0.05)); G.push(g);
  }
  const idx = (i, j) => j * (nu + 1) + i;
  const P = (i, j) => { const u = pu0 - RM + i * st, w = pw0 - RM + j * st, jit = 0.35 * (h2(i * 3.1, j * 1.7) - 0.5); return [u + jit, H[idx(i, j)], w + jit * 0.8]; };
  for (let j = 0; j < nw; j++) for (let i = 0; i < nu; i++) {
    const u = pu0 - RM + (i + 0.5) * st, w = pw0 - RM + (j + 0.5) * st;
    if (u > pu0 + 0.6 && u < pu1 - 0.6 && w > pw0 + 0.6 && w < pw1 - 0.6) continue;          // under the terrace
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    const hs = [a[1], b[1], c[1], d[1]], gs = [G[idx(i, j)], G[idx(i + 1, j)], G[idx(i + 1, j + 1)], G[idx(i, j + 1)]];
    if (hs.every((y, k) => y < gs[k] + 0.08)) continue;                                           // at the ground: none
    const slope = Math.max(...hs) - Math.min(...hs), r = h2(i * 0.7, j * 1.3);
    const col = slope > 2.5 ? (r < 0.5 ? cRock : cSchD) : slope < 0.6 && r < 0.25 ? cMoss : r < 0.5 ? cRockL : cRock;
    RK.quad(a, b, c, d, col);
  }
  // -- the terraces: flagstones over the plateau, a granite-coped parapet round it with openings for the stairs
  SC.quad([pu0, B, pw0], [pu1, B, pw0], [pu1, B, pw1], [pu0, B, pw1], cPave);
  const par = (u0, w0, u1, w1) => { const L = Math.hypot(u1 - u0, w1 - w0), a = Math.atan2(-(w1 - w0), u1 - u0); SC.box(L, 1.0, 0.5, cSch, (u0 + u1) / 2, B - 0.2, (w0 + w1) / 2, a); GR.box(L + 0.1, 0.12, 0.62, cGr, (u0 + u1) / 2, B + 0.8, (w0 + w1) / 2, a); };
  par(pu0, pw0, pu1, pw0); par(pu1, pw0, pu1, pw1);
  par(pu1, pw1, -12, pw1); par(-15.5, pw1, pu0, pw1);
  par(pu0, pw1, pu0, 1.5); par(pu0, -2.5, pu0, pw0);
  // -- the keep: schist walls, granite quoins, cornices and window dressings; two storeys of round-headed windows, the two
  // arches of the ground floor's porch on the terrace side, a corbelled and crenellated parapet round the roof terrace
  const K0 = [0, 5.14, 0, 6.85], kH = 8.1;
  SC.box(K0[1] - K0[0], kH + 0.6, K0[3] - K0[2], cSch, (K0[0] + K0[1]) / 2, B - 0.6, (K0[2] + K0[3]) / 2);
  for (const [u, w] of [[K0[0], K0[2]], [K0[1], K0[2]], [K0[0], K0[3]]]) for (let y = B; y < B + kH - 0.3; y += 0.6) GR.box(0.34, 0.3, 0.34, (y * 10 | 0) % 2 ? cGr : cGrD, u, y, w);
  GR.box(K0[1] - K0[0] + 0.5, 0.25, K0[3] - K0[2] + 0.5, cGr, (K0[0] + K0[1]) / 2, B + 3.9, (K0[2] + K0[3]) / 2);            // the string course
  GR.box(K0[1] - K0[0] + 0.7, 0.35, K0[3] - K0[2] + 0.7, cGrD, (K0[0] + K0[1]) / 2, B + kH - 0.35, (K0[2] + K0[3]) / 2);  // the corbel table
  for (const [a, b, c, d] of [[K0[0], K0[1], K0[2] - 0.2, K0[2] - 0.2], [K0[0], K0[1], K0[3] + 0.2, K0[3] + 0.2], [K0[0] - 0.2, K0[0] - 0.2, K0[2], K0[3]], [K0[1] + 0.2, K0[1] + 0.2, K0[2], K0[3]]]) {
    const L = Math.hypot(b - a, d - c), n = Math.max(2, Math.round(L / 1.05));
    for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; SC.box(a === b ? 0.4 : 0.55, 0.62, a === b ? 0.55 : 0.4, cSchL, a + (b - a) * t, B + kH, c + (d - c) * t); }
    SC.box(a === b ? 0.4 : L + 0.4, 0.45, a === b ? L + 0.4 : 0.4, cSch, (a + b) / 2, B + kH - 0.05, (c + d) / 2);
  }
  // windows: round-headed openings (dark), in granite surrounds, on the faces toward the pond and the terraces
  const arch = (u, w, face, y0, wd, ht, depth = 0.04) => {
    // face: 0 +u, 1 -u, 2 +w, 3 -w; a rectangle with a half-round head, a granite ring round it
    const n = 8, r = wd / 2, pts = [];
    for (let k = 0; k <= n; k++) { const t = Math.PI * k / n; pts.push([Math.cos(t) * r, ht - r + Math.sin(t) * r]); }
    const at = (s, y, off) => face < 2 ? [u + (face === 0 ? off : -off), y0 + y, w + s] : [u + s, y0 + y, w + (face === 2 ? off : -off)];
    DK.quad(at(-r, 0, depth), at(r, 0, depth), at(r, ht - r, depth), at(-r, ht - r, depth), cWin);
    for (let k = 0; k < n; k++) DK.tri(at(0, ht - r, depth), at(pts[k][0], pts[k][1], depth), at(pts[k + 1][0], pts[k + 1][1], depth), cWin);
    for (let k = 0; k < n; k++) { const p = pts[k], q = pts[k + 1], e = 1.18; GR.quad(at(p[0], p[1], depth + 0.02), at(q[0], q[1], depth + 0.02), at(q[0] * e + 0.0, (q[1] - (ht - r)) * e + ht - r, depth + 0.06), at(p[0] * e, (p[1] - (ht - r)) * e + ht - r, depth + 0.06), cGr); }
    GR.box(face < 2 ? 0.14 : wd + 0.3, 0.12, face < 2 ? wd + 0.3 : 0.14, cGr, face < 2 ? u + (face === 0 ? 0.08 : -0.08) : u, y0 - 0.12, face < 2 ? w : w + (face === 2 ? 0.08 : -0.08));
  };
  for (const w of [1.6, 3.4, 5.2]) { arch(K0[1], w, 0, B + 1.0, 0.9, 2.0); arch(K0[1], w, 0, B + 4.8, 0.8, 1.9); }
  for (const u of [1.2, 3.8]) { arch(u, K0[3], 2, B + 0.25, 1.7, 3.2); arch(u, K0[3], 2, B + 4.8, 0.8, 1.9); }
  for (const u of [1.3, 3.6]) arch(u, K0[2], 3, B + 4.8, 0.8, 1.9);
  // -- the corner turret: round, the conical slate cap with its lucarne, finial, flagstaff, wind vane and anemometer
  const tu = 5.56, tw = 5.9, tr = 1.45, tTop = B + 12.6;
  SC.cyl(tr, tr + 0.1, tTop - B + 0.6, cSch, tu, B - 0.6, tw, 16);
  for (let y = B + 1.2; y < tTop - 1; y += 2.6) GR.cyl(tr + 0.08, tr + 0.08, 0.16, cGr, tu, y, tw, 16);
  GR.cyl(tr + 0.28, tr + 0.08, 0.5, cGr, tu, tTop - 0.4, tw, 16);                                   // the cornice
  for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; arch(tu + Math.cos(a) * (tr - 0.02), tw + Math.sin(a) * (tr - 0.02), Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? 0 : 1) : (Math.sin(a) > 0 ? 2 : 3), B + 8.9, 0.5, 1.3, 0.1); }
  SL.cyl(0.08, tr + 0.35, 5.2, cSl, tu, tTop + 0.1, tw, 16);                                          // the cap
  SL.box(0.7, 0.9, 0.5, cSlD, tu + tr * 0.55, tTop + 0.5, tw, 0.4);                                    // the lucarne
  GR.box(0.56, 0.7, 0.04, cWin, tu + tr * 0.55 + 0.26, tTop + 0.55, tw, 0.4);
  TW.cyl(0.035, 0.05, 5.0, K(0xe8e6e0), tu, tTop + 5.2, tw, 8);                                        // the flagstaff
  for (let k = 0; k < 7; k++) TW.quad([tu, tTop + 9.9 - k * 0.12, tw + 0.05], [tu, tTop + 9.9 - k * 0.12, tw + 1.5], [tu, tTop + 9.78 - k * 0.12, tw + 1.5], [tu, tTop + 9.78 - k * 0.12, tw + 0.05], k % 2 ? K(0xe8e6e0) : K(0xa3262c));
  TW.quad([tu, tTop + 9.9, tw + 0.05], [tu, tTop + 9.9, tw + 0.7], [tu, tTop + 9.42, tw + 0.7], [tu, tTop + 9.42, tw + 0.05], K(0x2a3a6a));
  TW.tube([tu - 0.6, tTop + 6.4, tw], [tu + 0.6, tTop + 6.4, tw], 0.02, K(0x3a3a3a), 5);               // the vane's arm
  for (let k = 0; k < 3; k++) { const a = k * 2.1; TW.sphere(0.07, K(0x3a3a3a), tu + Math.cos(a) * 0.35, tTop + 6.9, tw + Math.sin(a) * 0.35, 1, 6); }
  // -- the lookout on the keep's roof: four turned posts, a bracketed hipped slate roof
  const L0 = [0.05, 2.1, 0.05, 2.45], ly = B + kH;
  for (const [u, w] of [[L0[0], L0[2]], [L0[1], L0[2]], [L0[0], L0[3]], [L0[1], L0[3]]]) { TW.cyl(0.08, 0.1, 2.3, cTim, u, ly, w, 8); TW.tube([u, ly + 1.9, w], [u + (u < 1 ? 0.4 : -0.4), ly + 2.3, w], 0.05, cTimL, 5); }
  TW.box(L0[1] - L0[0] + 0.3, 0.2, L0[3] - L0[2] + 0.3, cTimL, (L0[0] + L0[1]) / 2, ly + 2.3, (L0[2] + L0[3]) / 2);
  hipRoof(SL, L0[0], L0[1], L0[2], L0[3], ly + 2.5, 0.55, 0.62, cSl, cTim);
  // -- the loggia wing: one storey, round-arched openings to the terrace, a flat roof walk behind a crenellated parapet
  const W0 = [-8.64, 0, -2.97, 2.37], wH = 4.6;
  SC.box(W0[1] - W0[0], wH + 0.6, W0[3] - W0[2], cSch, (W0[0] + W0[1]) / 2, B - 0.6, (W0[2] + W0[3]) / 2);
  for (const u of [-7.4, -5.2, -3.0, -1.0]) { arch(u, W0[2], 3, B + 0.6, 1.2, 2.6); arch(u, W0[3], 2, B + 0.9, 0.9, 2.1); }
  arch(W0[0], -0.3, 1, B + 0.6, 1.4, 2.8);
  GR.box(W0[1] - W0[0] + 0.3, 0.25, W0[3] - W0[2] + 0.3, cGr, (W0[0] + W0[1]) / 2, B + wH, (W0[2] + W0[3]) / 2);
  for (let u = W0[0] + 0.4; u < W0[1] - 0.2; u += 1.0) for (const w of [W0[2] + 0.1, W0[3] - 0.1]) SC.box(0.55, 0.9, 0.4, cSchL, u, B + wH + 0.25, w);
  // -- the timber pavilions on the terrace: posts on stone bases, bracketed eaves, slate roofs (the big one's crown)
  const pav = (u0, u1, w0, w1, yE, crown) => {
    const n = Math.max(2, Math.round((u1 - u0) / 2.2)), m = Math.max(2, Math.round((w1 - w0) / 2.2));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= m; j++) {
      if (i > 0 && i < n && j > 0 && j < m) continue;
      const u = u0 + (u1 - u0) * i / n, w = w0 + (w1 - w0) * j / m;
      GR.box(0.42, 0.45, 0.42, cGr, u, B, w); TW.box(0.22, yE - B - 0.45, 0.22, cTim, u, B + 0.45, w);
      TW.box(0.5, 0.18, 0.5, cTimL, u, yE - 0.5, w);
    }
    for (const [a, b] of [[[u0, w0], [u1, w0]], [[u1, w0], [u1, w1]], [[u1, w1], [u0, w1]], [[u0, w1], [u0, w0]]]) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
      TW.box(L, 0.32, 0.18, cTimL, (a[0] + b[0]) / 2, yE - 0.32, (a[1] + b[1]) / 2, ang);            // the plate
      TW.box(L, 0.07, 0.1, cTim, (a[0] + b[0]) / 2, B + 0.95, (a[1] + b[1]) / 2, ang);                 // the rail
    }
    const yR = hipRoof(SL, u0, u1, w0, w1, yE, 0.7, 0.5, cSl, cTim);
    if (crown) {
      const [cu0, cu1] = crown;
      for (const [u, w] of [[cu0, w0 + 0.6], [cu1, w0 + 0.6], [cu0, w1 - 0.6], [cu1, w1 - 0.6]]) TW.box(0.16, 1.4, 0.16, cTim, u, yR - 0.9, w);
      hipRoof(SL, cu0, cu1, w0 + 0.6, w1 - 0.6, yR + 0.4, 0.45, 0.9, cSlD, cTim);
    }
  };
  for (const u of BELV.BENCH) { GR.box(1.8, 0.1, 0.46, cGr, u, B + 0.36, BELV.PLAT[2] + 1.0); for (const du of [-0.7, 0.7]) GR.box(0.2, 0.36, 0.4, cGrD, u + du, B, BELV.PLAT[2] + 1.0); }
  pav(-28.6, -17.8, -14.0, -8.9, B + 3.3, [-27.2, -24.4]);
  pav(-31.2, -25.7, 2.4, 7.0, B + 3.0, null);
  const out = [];
  for (const [b, m, nm] of [[SC, M.schist, 'schist'], [GR, M.stone, 'granite'], [RK, M.rock, 'rock'], [SL, M.slate, 'slate'], [TW, M.wood, 'timber'], [DK, M.matte, 'dark']]) {
    const mesh = b.mesh(m, 'cp32m:belvedere:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); }
  }
  return out;
}
// the walkers on the terraces (the castle's paved decks), obstacles for the buildings and parapets
export function belvedereColliders(COLLIDERS, B) {
  const [ox, oz] = BELV.O, [ax, az] = BELV.A, rot = Math.atan2(az, ax);
  const W = (u, w) => [ox + ax * u - az * w, oz + az * u + ax * w];
  const [pu0, pu1, pw0, pw1] = BELV.PLAT;
  const [cx, cz] = W((pu0 + pu1) / 2, (pw0 + pw1) / 2);
  COLLIDERS.addBox('kit31', { x: cx, y: B - 0.4, z: cz, hw: (pu1 - pu0) / 2, hh: 0.4, hd: (pw1 - pw0) / 2, rotY: rot, deck: true });
  for (const [u0, u1, w0, w1, h] of [[0, 5.14, 0, 6.85, 9], [-8.64, 0, -2.97, 2.37, 5.5], [4.1, 7.0, 4.4, 7.4, 13]]) {
    const [x, z] = W((u0 + u1) / 2, (w0 + w1) / 2);
    COLLIDERS.addBox('kit31', { x, y: B + h / 2, z, hw: (u1 - u0) / 2, hh: h / 2, hd: (w1 - w0) / 2, rotY: rot });
  }
}

// ---- Gapstow Bridge ------------------------------------------------------------------------------------------------
// Howard & Caudwell, 1896 (replacing Mould's timber bridge of 1874): one segmental arch of rough-faced Manhattan schist
// over the Pond's neck, 76 ft (23.2 m) long, the arch 44 ft (13.4 m) across and 12 ft (3.66 m) high over the water
// (Wikipedia, NYC Parks); 6.07 m over its parapets (OSM way 546663191). Frame: the centre C (-221.8, 1797.3), u toward the
// east end (0.8909, -0.4543). The Pond's shore crosses the axis at u -7.1 and +7.0 (OSM way 22726524).
export const GAP = { C: [-221.8, 1797.3], A: [0.8909, -0.4543], HALF: 11.6, SPAN: 6.7, W2: 3.03, RAMP: 14.0 };
export function gapDeckY(u, W) { const t = u / GAP.HALF; return W + 4.76 - 0.56 * t * t; }
// the walk over the bridge and its approaches: the 3DEP grid smooths the Pond's gorge, so the paths either side reach
// the bridge 3 m under its deck; walled approaches (RAMP m) ease the deck's ends down to them (gW, gE: the ground at the
// ramps' feet)
export function gapWalkY(u, W, gW, gE) {
  const a = Math.abs(u), G = GAP;
  if (a <= G.HALF) return gapDeckY(u, W);
  const t = Math.min(1, (a - G.HALF) / G.RAMP), s = t * t * (3 - 2 * t), g = (u < 0 ? gW : gE) + 0.03;
  return gapDeckY(Math.sign(u) * G.HALF, W) * (1 - s) + g * s;
}
export function buildGapstow(group, W, gW, gE) {
  const yw = (u) => gapWalkY(u, W, gW, gE);
  const M = lmMats(), G = GAP;
  const [cx, cz] = G.C, [ax, az] = G.A;
  const mk = () => new LBin().frame(cx, 0, cz, ax, az);
  const SC = mk(), CP = mk(), PV = mk(), DK = mk();
  // (CPB33, the owner's review of teaser 4: the arch read near black; the bridge is grey-brown rough-faced schist with
  // dressed voussoirs, the photographs from the Pond: the tones raised a third, the ring's stones paler than the walls)
  const cS = K(0x8c8374), cSD = K(0x797164), cSL = K(0x9e9586), cCop = K(0xaca69b), cPav = K(0x6f6b64), cBar = K(0x5d574e), cVL = K(0xa89f90);
  const yS = W + 0.4, yC = W + 3.66, r = yC - yS, R = (G.SPAN * G.SPAN + r * r) / (2 * r), yc = yC - R;
  const yi = (u) => yc + Math.sqrt(Math.max(0, R * R - u * u)), ring = 0.8;
  const yd = (u) => gapDeckY(u, W), W2 = G.W2;
  const steps = (a, b, n) => { const o = []; for (let i = 0; i <= n; i++) o.push(a + (b - a) * i / n); return o; };
  const h = (a, b) => { const s = Math.sin(a * 12.99 + b * 78.23) * 43758.55; return s - Math.floor(s); };
  // the barrel: the soffit across the width, the voussoirs of the ring on both faces (alternating stones), the spandrel
  // walls from the ring to the deck, the abutments down into the water
  const nV = 23, th0 = Math.atan2(yS - yc, -G.SPAN), th1 = Math.atan2(yS - yc, G.SPAN);
  for (let k = 0; k < nV; k++) {
    const ta = th0 + (th1 - th0) * k / nV, tb = th0 + (th1 - th0) * (k + 1) / nV;
    const pa = [Math.cos(ta) * R, yc + Math.sin(ta) * R], pb = [Math.cos(tb) * R, yc + Math.sin(tb) * R];
    const qa = [Math.cos(ta) * (R + ring), yc + Math.sin(ta) * (R + ring)], qb = [Math.cos(tb) * (R + ring), yc + Math.sin(tb) * (R + ring)];
    DK.quad([pa[0], pa[1], -W2 + 0.05], [pb[0], pb[1], -W2 + 0.05], [pb[0], pb[1], W2 - 0.05], [pa[0], pa[1], W2 - 0.05], k % 2 ? cSD : cBar);
    const col = h(k, 1) < 0.33 ? cVL : h(k, 1) < 0.66 ? cSL : cS;
    for (const s of [-1, 1]) {
      const w = s * (W2 + 0.06);
      SC.quad([pa[0], pa[1], w], [pb[0], pb[1], w], [qb[0], qb[1], w], [qa[0], qa[1], w], col);
      SC.quad([pa[0], pa[1], s * (W2 - 0.05)], [pb[0], pb[1], s * (W2 - 0.05)], [pb[0], pb[1], w], [pa[0], pa[1], w], cSD);   // the ring's soffit edge
    }
  }
  const uW = steps(-G.HALF, G.HALF, 46);
  for (const s of [-1, 1]) {
    const w = s * W2;
    for (let i = 0; i + 1 < uW.length; i++) {
      const ua = uW[i], ub = uW[i + 1], am = Math.abs((ua + ub) / 2);
      const low = (u) => Math.abs(u) < G.SPAN ? Math.min(yd(u) - 0.1, yi(u) + ring * 0.95) : W - 1.0;
      // (CPB33: the spandrel laid in courses of rough-faced stones ~0.42 m high and ~1 m long, staggered course to
      // course, each stone its own tone, the abutments' a shade darker: one flat panel read as concrete)
      const y0a = low(ua), y0b = low(ub), y1a = yd(ua), y1b = yd(ub);
      const nC = Math.max(1, Math.round(((y1a + y1b) - (y0a + y0b)) / 2 / 0.42));
      for (let c = 0; c < nC; c++) {
        const ta = c / nC, tb = (c + 1) / nC, st = Math.floor((i + (c % 2)) / 2), hv = h(st * 3.1 + c * 17.3, s * 5.7 + 2.0);
        const colS = am < G.SPAN ? (hv < 0.3 ? cSD : hv < 0.72 ? cS : cSL) : (hv < 0.5 ? cSD : cS);
        SC.quad([ua, y0a + (y1a - y0a) * ta, w], [ub, y0b + (y1b - y0b) * ta, w], [ub, y0b + (y1b - y0b) * tb, w], [ua, y0a + (y1a - y0a) * tb, w], colS);
      }
    }
    // the parapet on the spandrel wall, its coping; end piers
    for (let i = 0; i + 1 < uW.length; i++) {
      const ua = uW[i], ub = uW[i + 1], ya = yd(ua), yb = yd(ub), wi = s * (W2 - 0.5);
      SC.quad([ua, ya, wi], [ub, yb, wi], [ub, yb + 0.95, wi], [ua, ya + 0.95, wi], cS);
      for (let c = 0; c < 2; c++) {   // (CPB33: the parapet's outer face in two courses of stones, as the spandrel)
        const hv = h(Math.floor((i + c) / 2) * 3.1 + c * 29.1 + 7.0, s * 5.7 + 9.0), colP = hv < 0.3 ? cSD : hv < 0.72 ? cS : cSL;
        SC.quad([ua, ya + 0.475 * c, w + s * 0.04], [ub, yb + 0.475 * c, w + s * 0.04], [ub, yb + 0.475 * (c + 1), w + s * 0.04], [ua, ya + 0.475 * (c + 1), w + s * 0.04], colP);
      }
      CP.quad([ua, ya + 0.95, wi - s * 0.04], [ub, yb + 0.95, wi - s * 0.04], [ub, yb + 1.05, w + s * 0.08], [ua, ya + 1.05, w + s * 0.08], cCop);
    }
    for (const u of [-G.HALF, G.HALF]) { SC.box(1.0, 1.35, 0.8, cSL, u, yd(u) - 0.1, w - s * 0.2); CP.box(1.12, 0.12, 0.92, cCop, u, yd(u) + 1.25, w - s * 0.2); }
  }
  // the ends of the spandrel walls and the abutments' wing walls along the shore
  for (const sg of [-1, 1]) {
    const u = sg * G.HALF;
    SC.quad([u, W - 1.0, -W2], [u, W - 1.0, W2], [u, yd(u), W2], [u, yd(u), -W2], cSD);
    for (const s of [-1, 1]) { const w0 = s * W2; SC.box(0.7, yd(u) - 0.3 - (W - 1.0), 3.2, cSD, u - sg * 0.8, W - 1.0, w0 + s * 1.5, 0); }
  }
  // the approaches: walled ramps down to the paths, their parapets stepping down with them to end piers
  for (const sg of [-1, 1]) {
    const us = steps(sg * G.HALF, sg * (G.HALF + G.RAMP), 14), gF = Math.min(gW, gE) - 0.6;
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i], ub = us[i + 1], ya = yw(ua), yb = yw(ub);
      PV.quad([ua, ya, -(W2 - 0.5)], [ub, yb, -(W2 - 0.5)], [ub, yb, W2 - 0.5], [ua, ya, W2 - 0.5], cPav);
      for (const s of [-1, 1]) {
        const w = s * W2, wi = s * (W2 - 0.5), pa = Math.max(0.2, 0.95 * (1 - Math.abs(ua - sg * G.HALF) / G.RAMP * 0.6)), pb = Math.max(0.2, 0.95 * (1 - Math.abs(ub - sg * G.HALF) / G.RAMP * 0.6));
        SC.quad([ua, gF, w], [ub, gF, w], [ub, yb + pb, w], [ua, ya + pa, w], cS);
        SC.quad([ua, ya, wi], [ub, yb, wi], [ub, yb + pb, wi], [ua, ya + pa, wi], cS);
        CP.quad([ua, ya + pa, wi - s * 0.04], [ub, yb + pb, wi - s * 0.04], [ub, yb + pb + 0.1, w + s * 0.08], [ua, ya + pa + 0.1, w + s * 0.08], cCop);
      }
    }
    const ue = sg * (G.HALF + G.RAMP);
    for (const s of [-1, 1]) { SC.box(0.8, yw(ue) - gF + 0.7, 0.8, cSL, ue, gF, s * (W2 - 0.2)); CP.box(0.92, 0.12, 0.92, cCop, ue, yw(ue) + 0.7, s * (W2 - 0.2)); }
    SC.quad([ue, gF, -W2], [ue, gF, W2], [ue, yw(ue), W2], [ue, yw(ue), -W2], cSD);
  }
  // the deck: the path's paving between the parapets
  for (let i = 0; i + 1 < uW.length; i++) { const ua = uW[i], ub = uW[i + 1]; PV.quad([ua, yd(ua), -(W2 - 0.5)], [ub, yd(ub), -(W2 - 0.5)], [ub, yd(ub), W2 - 0.5], [ua, yd(ua), W2 - 0.5], cPav); }
  const out = [];
  for (const [b, m, nm] of [[SC, M.schist, 'schist'], [CP, M.stone, 'coping'], [PV, M.matte, 'paving'], [DK, M.rock, 'soffit']]) {
    const mesh = b.mesh(m, 'cp32m:gapstow:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); }
  }
  return out;
}
export function gapColliders(COLLIDERS, W, gW, gE, parU = Infinity) {   // parU (CP34): the parapets' reach along u (the approaches have none)
  const G = GAP, [cx, cz] = G.C, [ax, az] = G.A, rot = Math.atan2(az, ax);
  const P = (u, w) => [cx + ax * u - az * w, cz + az * u + ax * w];
  const E = G.HALF + G.RAMP;
  for (let u = -E; u < E - 1e-6; u += 1.45) {
    const u1 = Math.min(E, u + 1.45), um = (u + u1) / 2, top = Math.max(gapWalkY(u, W, gW, gE), gapWalkY(u1, W, gW, gE), gapWalkY(um, W, gW, gE));
    const [x, z] = P(um, 0);
    COLLIDERS.addBox('kit31', { x, y: top - 0.3, z, hw: (u1 - u) / 2 + 0.05, hh: 0.3, hd: G.W2 - 0.55, rotY: rot, deck: true });
    if (Math.abs(um) < parU) for (const sd of [-1, 1]) { const [xr, zr] = P(um, sd * (G.W2 - 0.25)); COLLIDERS.addBox('kit31', { x: xr, y: top + 0.5, z: zr, hw: (u1 - u) / 2 + 0.05, hh: 0.55, hd: 0.3, rotY: rot }); }
  }
}

// ---- Cleopatra's Needle --------------------------------------------------------------------------------------------
// The obelisk of Thutmose III (Heliopolis, about 1450 BC; Ramesses II's inscriptions added down its sides), erected on
// Greywacke Knoll behind the Metropolitan Museum on 22 February 1881: about 21 m (69 ft) of Aswan red granite, some 200
// tons, on its 50-ton pedestal, the shaft's corners seated on four bronze crabs (the 1881 replicas of the Roman ones), the
// pedestal on three granite steps. OSM way 179685272: the steps' square 8.7 x 8.3 m, centre (489.33, 384.98), its sides
// along (0.9585, 0.2854). The shaft 2.36 m square at its foot and 1.6 m under the pyramidion (published figures: 7 ft 9 in
// and about 5 ft 3 in), the pyramidion 1.4 m.
export const NEEDLE = { C: [489.33, 384.98], A: [0.9585, 0.2854] };
let _glyph = null;
function glyphTex() {
  if (_glyph || typeof document === 'undefined') return _glyph;
  // three columns of incised signs down each face (the central column of Thutmose III, Ramesses II's either side), over
  // the granite's weathering: darker where the signs are cut, a lighter wash on the lower shaft that the weather scoured
  const Wd = 256, Hd = 2048, cv = document.createElement('canvas'); cv.width = Wd; cv.height = Hd;
  const c = cv.getContext('2d');
  const gr = c.createLinearGradient(0, 0, 0, Hd); gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.7, '#f4f0ee'); gr.addColorStop(1, '#e2dcd8');
  c.fillStyle = gr; c.fillRect(0, 0, Wd, Hd);
  let s = 11; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 9000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '90,60,55' : '255,245,240'},${0.05 + rnd() * 0.08})`; c.fillRect(rnd() * Wd, rnd() * Hd, 1 + rnd() * 3, 1 + rnd() * 3); }
  const col = (x0, x1, y0, y1, dense) => {
    let y = y0;
    while (y < y1) {
      const h = (8 + rnd() * 18) * dense, w = (x1 - x0) * (0.4 + rnd() * 0.55), x = x0 + ((x1 - x0) - w) / 2;
      c.fillStyle = 'rgba(70,40,34,0.55)';
      const k = rnd();
      if (k < 0.3) c.fillRect(x, y, w, h * 0.35);                                                   // a bar sign
      else if (k < 0.55) { c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); c.fill(); }   // a round sign
      else if (k < 0.8) { c.fillRect(x + w * 0.4, y, w * 0.2, h); c.fillRect(x, y + h * 0.7, w, h * 0.3); }             // a standing sign
      else { c.beginPath(); c.moveTo(x, y + h); c.lineTo(x + w / 2, y); c.lineTo(x + w, y + h); c.fill(); }               // a bird or a cone
      y += h + 3 + rnd() * 5;
    }
  };
  col(98, 158, 60, Hd - 120, 1.0); col(26, 76, 260, Hd - 160, 0.8); col(180, 230, 260, Hd - 160, 0.8);
  c.fillStyle = 'rgba(70,40,34,0.45)'; c.fillRect(96, 30, 64, 24);                                  // the Horus-name's frame
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  _glyph = t;
  return t;
}
export function buildNeedle(group, G) {
  const M = lmMats(), N = NEEDLE;
  const [cx, cz] = N.C, [ax, az] = N.A;
  const ST = new LBin().frame(cx, 0, cz, ax, az), BZ = new LBin().frame(cx, 0, cz, ax, az), OB = new LBin(true).frame(cx, 0, cz, ax, az);
  const cSt = K(0x9d978c), cStD = K(0x8a847a), cRed = K(0xa07a6c), cBz = K(0x4d4a34);
  // the steps and the pedestal
  let y = G - 0.3;
  for (const [s, h] of [[8.5, 0.62], [7.3, 0.36], [6.1, 0.36]]) { ST.box(s, h, s, cSt, 0, y, 0); y += h; }
  ST.box(4.2, 0.55, 4.2, cStD, 0, y, 0); y += 0.55;
  ST.box(3.3, 2.1, 3.3, cSt, 0, y, 0); y += 2.1;
  ST.box(3.7, 0.28, 3.7, cStD, 0, y, 0); y += 0.28;
  // the four bronze crabs under the shaft's corners
  const b0 = 2.36, top = 1.6, Hs = 19.8, Hp = 1.4, gap = 0.36;
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const u = sx * (b0 / 2 - 0.12), w = sz * (b0 / 2 - 0.12);
    BZ.sphere(0.36, cBz, u, y + 0.16, w, 0.45, 10);
    for (let k = 0; k < 4; k++) for (const side of [-1, 1]) { const a = Math.atan2(sz, sx) + side * (0.6 + k * 0.35); BZ.tube([u + Math.cos(a) * 0.25, y + 0.16, w + Math.sin(a) * 0.25], [u + Math.cos(a) * 0.55, y + 0.02, w + Math.sin(a) * 0.55], 0.035, cBz, 5); }
    for (const side of [-1, 1]) { const a = Math.atan2(sz, sx) + side * 0.25; BZ.sphere(0.12, cBz, u + Math.cos(a) * 0.45, y + 0.2, w + Math.sin(a) * 0.45, 0.6, 8); }
  }
  y += gap;
  // the shaft: four tapering faces, the inscriptions on each (texture v up the face), the pyramidion
  const face = (k) => {
    const c0 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][k], c1 = [[-1, -1], [1, -1], [1, 1], [-1, 1]][(k + 1) % 4];
    const A = [c0[0] * b0 / 2, y, c0[1] * b0 / 2], B = [c1[0] * b0 / 2, y, c1[1] * b0 / 2], C = [c1[0] * top / 2, y + Hs, c1[1] * top / 2], D = [c0[0] * top / 2, y + Hs, c0[1] * top / 2];
    OB.quad(A, B, C, D, cRed, [0, 0], [1, 0], [1, 1], [0, 1]);
    OB.tri(D, C, [0, y + Hs + Hp, 0], K(0x8e6b5e), [0, 1], [1, 1], [0.5, 1]);
  };
  for (let k = 0; k < 4; k++) face(k);
  const gm = own(applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ vertexColors: true, map: glyphTex(), roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide }))), 'glyph');
  const out = [];
  for (const [b, m, nm] of [[ST, M.stone, 'pedestal'], [BZ, M.bronze, 'crabs'], [OB, gm, 'shaft']]) {
    const mesh = b.mesh(m, 'cp32m:needle:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); }
  }
  return { out, top: y + Hs + Hp };
}

// ---- Oak Bridge ----------------------------------------------------------------------------------------------------
// Over the mouth of Bank Rock Bay, the Lake's northern arm: Vaux's carved white oak bridge of 1859-60 with panels of
// decorative cast iron in its railings, rebuilt in 2009 to the original design (Central Park Conservancy; Jan Hird Pokorny
// Associates) on a steel frame, the railings and deck in white oak. OSM ways 302774807 (the footway, 19.7 m) and
// 580520662 (the outline, 4.0 m wide); the Lake crosses the axis 12.1 m wide. Frame: the footway's middle, u toward the
// north-east end.
export const OAK = { A0: [-45.23, 479.72], A1: [-34.59, 496.28], W2: 2.0 };
export function oakFrame() {
  const [x0, z0] = OAK.A0, [x1, z1] = OAK.A1, L = Math.hypot(x1 - x0, z1 - z0);
  return { C: [(x0 + x1) / 2, (z0 + z1) / 2], A: [(x1 - x0) / L, (z1 - z0) / L], L };
}
export function oakDeckY(u, W, gA, gB) {
  // the banks' line, a 0.45 m hump, lifted further where the banks sit low so the middle clears the water by 1.1 m
  const { L } = oakFrame(), t = Math.min(1, Math.max(0, (u + L / 2) / L)), bw = 1 - (2 * t - 1) ** 2;
  const lift = Math.max(0, W + 1.1 - ((gA + gB) / 2 + 0.45));
  return gA + (gB - gA) * t + (0.45 + lift) * bw;
}
export function buildOakBridge(group, W, gA, gB) {
  const M = lmMats(), F = oakFrame(), [cx, cz] = F.C, [ax, az] = F.A, L = F.L, H = L / 2, W2 = OAK.W2;
  const WO = new LBin().frame(cx, 0, cz, ax, az), CU = new LBin(true).frame(cx, 0, cz, ax, az), ST = new LBin().frame(cx, 0, cz, ax, az), SG = new LBin().frame(cx, 0, cz, ax, az);
  const yd = (u) => oakDeckY(u, W, gA, gB), cOak = K(0xa98a62), cOakD = K(0x8a6e4c), cOakL = K(0xbc9c72), cSteel = K(0x3c3e3c), cPanel = K(0x3a3630), cSt = K(0x8e887e);
  const us = []; for (let i = 0; i <= 28; i++) us.push(-H + L * i / 28);
  // the deck: white oak planks across the bridge
  for (let i = 0; i + 1 < us.length; i++) {
    const ua = us[i], ub = us[i + 1];
    for (let k = 0; k < 3; k++) { const a = ua + (ub - ua) * k / 3 + 0.01, b = ua + (ub - ua) * (k + 1) / 3 - 0.01; WO.quad([a, yd(a), -(W2 - 0.1)], [b, yd(b), -(W2 - 0.1)], [b, yd(b), W2 - 0.1], [a, yd(a), W2 - 0.1], (i * 3 + k) % 5 === 0 ? cOakD : (i * 3 + k) % 3 ? cOak : cOakL); }
    SG.quad([ua, yd(ua) - 0.04, -(W2 - 0.1)], [ub, yd(ub) - 0.04, -(W2 - 0.1)], [ub, yd(ub) - 0.04, W2 - 0.1], [ua, yd(ua) - 0.04, W2 - 0.1], K(0x2a2622));
  }
  // the steel frame under it: two girders and the fascia boards over them
  for (const s of [-1, 1]) {
    SG.band(us, (u) => [yd(u), s * (W2 - 0.35)], [[-0.08, -0.08], [-0.08, -0.62], [0.08, -0.62], [0.08, -0.08]], cSteel);
    WO.band(us, (u) => [yd(u), s * W2], [[0, 0.02], [0, -0.32], [-s * 0.05, -0.32]], cOakD);
  }
  for (let u = -H + 0.8; u < H - 0.5; u += 1.6) SG.box(0.12, 0.2, 2 * W2 - 0.6, cSteel, u, yd(u) - 0.3, 0);
  // the railings: oak posts with capped tops, rails, the pierced cast panels between
  const nP = 10;
  for (const s of [-1, 1]) {
    const w = s * (W2 - 0.12);
    for (let i = 0; i <= nP; i++) { const u = -H + 0.2 + (L - 0.4) * i / nP, y = yd(u); WO.box(0.2, 1.12, 0.2, cOakD, u, y, w); WO.box(0.28, 0.08, 0.28, cOakL, u, y + 1.12, w); WO.sphere(0.07, cOakL, u, y + 1.24, w, 1, 8); }
    WO.band(us, (u) => [yd(u), w], [[-0.08, 0.98], [-0.08, 1.06], [0.08, 1.06], [0.08, 0.98]], cOak);
    WO.band(us, (u) => [yd(u), w], [[-0.06, 0.12], [-0.06, 0.2], [0.06, 0.2], [0.06, 0.12]], cOak);
    for (let i = 0; i + 1 < us.length; i++) { const ua = us[i], ub = us[i + 1], ta = ua / 1.32, tb = ub / 1.32; CU.quad([ua, yd(ua) + 0.22, w], [ub, yd(ub) + 0.22, w], [ub, yd(ub) + 0.96, w], [ua, yd(ua) + 0.96, w], cPanel, [ta, 0.502], [tb, 0.502], [tb, 0.998], [ta, 0.998]); }
  }
  // the stone abutments at the banks
  for (const sg of [-1, 1]) { const u = sg * (H - 0.6), y = yd(u); ST.box(1.6, y - (W - 1.0), 2 * W2 + 0.8, cSt, u, W - 1.0, 0); }
  const out = [];
  for (const [b, m, nm] of [[WO, M.wood, 'oak'], [CU, M.ironCut, 'panels'], [ST, M.stone, 'abutments'], [SG, M.iron, 'steel']]) {
    const mesh = b.mesh(m, 'cp32m:oak:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); }
  }
  return out;
}
export function oakColliders(COLLIDERS, W, gA, gB) {
  const F = oakFrame(), [cx, cz] = F.C, [ax, az] = F.A, H = F.L / 2, rot = Math.atan2(az, ax);
  for (let u = -H; u < H - 1e-6; u += 1.4) {
    const u1 = Math.min(H, u + 1.4), um = (u + u1) / 2, top = Math.max(oakDeckY(u, W, gA, gB), oakDeckY(u1, W, gA, gB), oakDeckY(um, W, gA, gB));
    COLLIDERS.addBox('kit31', { x: cx + ax * um, y: top - 0.3, z: cz + az * um, hw: (u1 - u) / 2 + 0.05, hh: 0.3, hd: OAK.W2 - 0.3, rotY: rot, deck: true });
    for (const sd of [-1, 1]) COLLIDERS.addBox('kit31', { x: cx + ax * um - az * sd * (OAK.W2 - 0.12), y: top + 0.5, z: cz + az * um + ax * sd * (OAK.W2 - 0.12), hw: (u1 - u) / 2 + 0.05, hh: 0.55, hd: 0.14, rotY: rot });
  }
}

// ---- the Mall's statues and the Naumburg Bandshell ------------------------------------------------------------------
// The Literary Walk's bronzes (OSM nodes, NYC Parks monuments): Shakespeare (J.Q.A. Ward, 1872) and Columbus (Jeronimo
// Sunol, 1894) standing, Burns (John Steell, 1880), Scott (Steell, 1872) and Fitz-Greene Halleck (James Wilson
// MacDonald, 1877) seated, each on a granite pedestal facing the Mall's centre line; figures at heroic size (about 1.3 x
// life: 2.3 m standing).
export const STATUES = [
  { n: 'William Shakespeare', x: -98.7, z: 1478.2, pose: 'stand', ped: 3.0 },
  { n: 'Christopher Columbus', x: -132.6, z: 1466.3, pose: 'stand', ped: 2.6 },
  { n: 'Robert Burns', x: -115.2, z: 1434.4, pose: 'sit', ped: 2.4 },
  { n: 'Sir Walter Scott', x: -96.1, z: 1440.2, pose: 'sit', ped: 2.4 },
  { n: 'Fitz-Greene Halleck', x: -79.0, z: 1382.0, pose: 'sit', ped: 2.2 },
];
// the Mall's centre line (from the Literary Walk to the Bethesda end): the statues face the nearest point of it
const MALL = [[-117, 1462], [15, 1020]];
export function statueYaw(x, z) {
  const [[x0, z0], [x1, z1]] = MALL, dx = x1 - x0, dz = z1 - z0, t = ((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz);
  const px = x0 + dx * t, pz = z0 + dz * t;
  return Math.atan2(pz - z, px - x);                                    // the facing direction's angle in (x, z)
}
export function buildStatue(group, s, G) {
  const M = lmMats(), a = statueYaw(s.x, s.z), ax = Math.cos(a), az = Math.sin(a);
  const ST = new LBin().frame(s.x, 0, s.z, ax, az), BZ = new LBin().frame(s.x, 0, s.z, ax, az);
  const cG = K(0x9f998e), cGD = K(0x8b857a), cB = K(0x4a4636), cBL = K(0x5a5a42);
  // the pedestal: a plinth, the die, a moulded cap
  ST.box(2.1, 0.4, 2.1, cGD, 0, G - 0.1, 0);
  ST.box(1.5, s.ped - 0.65, 1.5, cG, 0, G + 0.3, 0);
  ST.box(1.75, 0.25, 1.75, cGD, 0, G + s.ped - 0.35, 0);
  const y0 = G + s.ped - 0.1;
  BZ.box(1.3, 0.12, 1.3, cB, 0, y0, 0);                                 // the bronze base
  // the figure, facing +u (the frame's axis points at the Mall)
  if (s.pose === 'stand') {
    BZ.cyl(0.11, 0.14, 1.05, cB, 0.02, y0 + 0.12, -0.14, 8); BZ.cyl(0.11, 0.14, 1.05, cB, -0.06, y0 + 0.12, 0.15, 8);   // the legs
    BZ.cyl(0.3, 0.42, 0.75, cBL, 0, y0 + 0.55, 0, 10);                    // the coat's skirts
    BZ.cyl(0.26, 0.3, 0.7, cB, 0, y0 + 1.25, 0, 10);                      // the torso
    BZ.sphere(0.29, cB, 0, y0 + 1.95, 0, 0.45, 10);                       // the shoulders
    BZ.sphere(0.14, cBL, 0.02, y0 + 2.18, 0, 1.2, 10);                    // the head
    BZ.tube([0, y0 + 1.9, -0.3], [0.2, y0 + 1.35, -0.38], 0.075, cB); BZ.tube([0.2, y0 + 1.35, -0.38], [0.35, y0 + 1.45, -0.18], 0.065, cB);
    BZ.tube([0, y0 + 1.9, 0.3], [0.05, y0 + 1.25, 0.38], 0.075, cB); BZ.box(0.22, 0.28, 0.06, cBL, 0.35, y0 + 1.4, -0.12);   // a book or a chart
  } else {
    BZ.box(0.75, 0.5, 0.9, cBL, -0.2, y0 + 0.12, 0);                       // the seat (a chair, a stump, a rock)
    for (const w of [-0.15, 0.15]) { BZ.tube([-0.05, y0 + 0.62, w], [0.42, y0 + 0.62, w], 0.1, cB); BZ.tube([0.42, y0 + 0.62, w], [0.46, y0 + 0.14, w], 0.09, cB); }
    BZ.cyl(0.25, 0.3, 0.72, cB, -0.12, y0 + 0.62, 0, 10);                 // the torso
    BZ.sphere(0.27, cB, -0.12, y0 + 1.32, 0, 0.45, 10);
    BZ.sphere(0.135, cBL, -0.08, y0 + 1.55, 0, 1.2, 10);
    BZ.tube([-0.12, y0 + 1.28, -0.28], [0.25, y0 + 0.78, -0.24], 0.07, cB); BZ.tube([-0.12, y0 + 1.28, 0.28], [0.28, y0 + 0.82, 0.22], 0.07, cB);
  }
  const out = [];
  for (const [b, m, nm] of [[ST, M.stone, 'pedestal'], [BZ, M.bronze, 'bronze']]) { const mesh = b.mesh(m, 'cp32m:statue:' + nm); if (mesh) { group.add(mesh); out.push(b.tris); } }
  return out.reduce((p, q) => p + q, 0);
}
// the Naumburg Bandshell (William G. Tachau, 1923; Indiana limestone): a half-dome whose coffered bowl faces the Concert
// Ground, framed by a pilastered proscenium with its entablature, the stage raised on a base. OSM way 265347581 (12.8 m):
// the opening's line (8.57, 1165.49)-(13.39, 1149.56), the bowl's back 8.3 m behind it.
export const BANDSHELL = { P0: [8.57, 1165.49], P1: [13.39, 1149.56] };
export function buildBandshell(group, G) {
  const M = lmMats(), [x0, z0] = BANDSHELL.P0, [x1, z1] = BANDSHELL.P1, L = Math.hypot(x1 - x0, z1 - z0);
  const ax = (x1 - x0) / L, az = (z1 - z0) / L, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // frame: u along the opening, w into the bowl (east): w = (-az, ax) points (0.957, 0.29)
  const LS = new LBin().frame(cx, 0, cz, ax, az), DK = new LBin().frame(cx, 0, cz, ax, az);
  const cL = K(0xd7cfbf), cLD = K(0xbdb4a3), cLS = K(0xa89f8e), cDk = K(0x4a4640);
  const R = 7.2, st = 1.3, yB = G + st;                                  // the bowl's radius, the stage's height
  // the stage and its base, steps down to the Concert Ground at the front
  LS.box(L - 0.4, st, 8.6, cLD, 0, G, 4.3);
  for (let k = 0; k < 4; k++) LS.box(7.0, st - k * 0.32, 0.35, cLS, 0, G, -0.18 - k * 0.35);
  // the half-dome: a quarter sphere of radius R behind the opening (w > 0), the bowl's coffers as darker bands
  const nA = 18, nB = 9;
  for (let i = 0; i < nA; i++) for (let j = 0; j < nB; j++) {
    const a0 = Math.PI * i / nA, a1 = Math.PI * (i + 1) / nA, b0 = (Math.PI / 2) * j / nB, b1 = (Math.PI / 2) * (j + 1) / nB;
    const P = (a, b, r) => [Math.cos(a) * Math.cos(b) * r, yB + Math.sin(b) * r, Math.sin(a) * Math.cos(b) * r];
    const col = (i + j) % 2 ? cL : cLD;
    LS.quad(P(a0, b0, R + 0.35), P(a1, b0, R + 0.35), P(a1, b1, R + 0.35), P(a0, b1, R + 0.35), K(0xc9c1b1));      // the outside
    DK.quad(P(a0, b0, R), P(a0, b1, R), P(a1, b1, R), P(a1, b0, R), (i % 3 === 1 || j % 3 === 1) ? cLS : col);       // the coffered bowl
  }
  // the proscenium: pilasters either side of the opening, the entablature over it, the parapet
  for (const s of [-1, 1]) { LS.box(1.3, R + 1.4, 1.2, cL, s * (R + 0.9), yB, 0.2); LS.box(1.6, 0.4, 1.4, cLD, s * (R + 0.9), yB - 0.4, 0.2); }
  LS.box(2 * R + 3.4, 1.3, 1.4, cL, 0, yB + R + 0.25, 0.3);
  LS.box(2 * R + 3.8, 0.3, 1.7, cLD, 0, yB + R + 1.55, 0.3);
  LS.box(2 * R + 2.6, 0.9, 1.0, cL, 0, yB + R + 1.85, 0.4);
  const out = [];
  for (const [b, m, nm] of [[LS, M.limestone, 'limestone'], [DK, M.limestone, 'bowl']]) { const mesh = b.mesh(m, 'cp32m:bandshell:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- the Ladies' Pavilion ------------------------------------------------------------------------------------------
// Jacob Wrey Mould, 1871 (cast iron; at the Eighth Avenue gate until 1912, since then on Hernshead over the Lake; restored
// 1973): an open pavilion of slender cast-iron posts with pierced brackets and a bracketed frieze under a hipped roof with
// a finial. OSM way 221918229 (the roof, 7.9 x 4.6 m).
export const LADIES = { P: [[-151.14, 603.72], [-146.14, 607.54], [-143.34, 603.87], [-148.33, 600.06]] };
export function buildLadies(group, G) {
  const M = lmMats(), [p0, p1, p2, p3] = LADIES.P;
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4, cz = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), D = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ax = (p1[0] - p0[0]) / L, az = (p1[1] - p0[1]) / L;
  const IR = new LBin().frame(cx, 0, cz, ax, az), CU = new LBin(true).frame(cx, 0, cz, ax, az), RF = new LBin().frame(cx, 0, cz, ax, az), ST = new LBin().frame(cx, 0, cz, ax, az);
  const cI = K(0xe4dfd0), cIS = K(0xcac4b4), cR = K(0x5d6a66), cSt = K(0x9a948a);
  const hu = L / 2 - 0.5, hw = D / 2 - 0.5, yE = G + 0.45 + 3.1;
  ST.box(L - 0.6, 0.45, D - 0.6, cSt, 0, G, 0);                                     // the stone platform
  const posts = [];
  for (let i = 0; i <= 4; i++) for (const w of [-hw, hw]) posts.push([-hu + 2 * hu * i / 4, w]);
  for (const u of [-hu, hu]) for (let j = 1; j < 2; j++) posts.push([u, -hw + 2 * hw * j / 2]);
  for (const [u, w] of posts) {
    IR.cyl(0.06, 0.07, 3.1, cI, u, G + 0.45, w, 8); IR.box(0.2, 0.12, 0.2, cIS, u, G + 0.45, w); IR.box(0.18, 0.1, 0.18, cIS, u, yE - 0.1, w);
  }
  // the pierced frieze and brackets under the eaves on all four sides, a railing between the posts
  for (const [a, b] of [[[-hu, -hw], [hu, -hw]], [[hu, -hw], [hu, hw]], [[hu, hw], [-hu, hw]], [[-hu, hw], [-hu, -hw]]]) {
    const Ls = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.ceil(Ls / 0.5);
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n, A = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], B = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
      const s0 = (k / n) * Ls / 1.6, s1 = ((k + 1) / n) * Ls / 1.6;
      CU.quad([A[0], yE - 0.75, A[1]], [B[0], yE - 0.75, B[1]], [B[0], yE - 0.1, B[1]], [A[0], yE - 0.1, A[1]], cI, [s0, 0.05], [s1, 0.05], [s1, 0.4], [s0, 0.4]);
      const r0 = (k / n) * Ls / 1.32, r1 = ((k + 1) / n) * Ls / 1.32;
      CU.quad([A[0], G + 0.55, A[1]], [B[0], G + 0.55, B[1]], [B[0], G + 1.3, B[1]], [A[0], G + 1.3, A[1]], cI, [r0, 0.502], [r1, 0.502], [r1, 0.998], [r0, 0.998]);
    }
    const ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    IR.box(Ls + 0.2, 0.18, 0.14, cIS, (a[0] + b[0]) / 2, yE - 0.1, (a[1] + b[1]) / 2, ang);
    IR.box(Ls, 0.07, 0.09, cI, (a[0] + b[0]) / 2, G + 1.3, (a[1] + b[1]) / 2, ang);
  }
  const yR = hipRoof(RF, -hu, hu, -hw, hw, yE + 0.08, 0.6, 0.55, cR, cIS);
  IR.cyl(0.02, 0.07, 0.9, cI, 0, yR - 0.05, 0, 8); IR.sphere(0.09, cI, 0, yR + 0.5, 0, 1, 8);        // the finial
  const out = [];
  for (const [b, m, nm] of [[IR, M.iron, 'iron'], [CU, M.ironCut, 'pierced'], [RF, M.slate, 'roof'], [ST, M.stone, 'platform']]) { const mesh = b.mesh(m, 'cp32m:ladies:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- the Reservoir's South Gate House ------------------------------------------------------------------------------
// 1862-64 (the Croton Aqueduct's gate house at the Reservoir's south end, its gates and screens under the floor): a grey
// stone house with round-headed windows in dressed surrounds, a cornice and a low hipped slate roof. OSM way 278363043
// (24.4 x 11.9 m, 11.1 m).
export const SGATE = { P: [[727.40, 85.25], [748.81, 97.04], [743.05, 107.48], [721.64, 95.68]] };
export function buildGatehouse(group, G, P, H) {
  const M = lmMats(), [p0, p1, p2, p3] = P;
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), D = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
  const ax = (p1[0] - p0[0]) / L, az = (p1[1] - p0[1]) / L;
  const cx = (p0[0] + p1[0] + p2[0] + p3[0]) / 4, cz = (p0[1] + p1[1] + p2[1] + p3[1]) / 4;
  const SC = new LBin().frame(cx, 0, cz, ax, az), GR = new LBin().frame(cx, 0, cz, ax, az), SL = new LBin().frame(cx, 0, cz, ax, az), DK = new LBin().frame(cx, 0, cz, ax, az);
  const cS = K(0x8f8a80), cSD = K(0x7d786f), cG = K(0xaaa59a), cW = K(0x23272a), cSl = K(0x4b5057);
  const hu = L / 2, hw = D / 2, yW = G + H - 3.2;                                 // the walls' top, the roof above
  SC.box(L, yW - (G - 0.6), D, cS, 0, G - 0.6, 0);
  GR.box(L + 0.4, 0.6, D + 0.4, cSD, 0, G - 0.6, 0);                              // the base course
  GR.box(L + 0.6, 0.4, D + 0.6, cG, 0, yW - 0.4, 0);                              // the cornice
  // round-headed windows: flat dark openings with dressed surrounds on the four faces
  const win = (u, w, face, y0, wd, ht) => {
    const n = 8, r = wd / 2;
    const at = (s, y, off) => face < 2 ? [u + (face === 0 ? off : -off), y0 + y, w + s] : [u + s, y0 + y, w + (face === 2 ? off : -off)];
    DK.quad(at(-r, 0, 0.03), at(r, 0, 0.03), at(r, ht - r, 0.03), at(-r, ht - r, 0.03), cW);
    for (let k = 0; k < n; k++) { const a0 = Math.PI * k / n, a1 = Math.PI * (k + 1) / n; DK.tri(at(0, ht - r, 0.03), at(Math.cos(a0) * r, ht - r + Math.sin(a0) * r, 0.03), at(Math.cos(a1) * r, ht - r + Math.sin(a1) * r, 0.03), cW);
      GR.quad(at(Math.cos(a0) * r, ht - r + Math.sin(a0) * r, 0.05), at(Math.cos(a1) * r, ht - r + Math.sin(a1) * r, 0.05), at(Math.cos(a1) * (r + 0.22), ht - r + Math.sin(a1) * (r + 0.22), 0.09), at(Math.cos(a0) * (r + 0.22), ht - r + Math.sin(a0) * (r + 0.22), 0.09), cG); }
    GR.box(face < 2 ? 0.16 : wd + 0.4, 0.14, face < 2 ? wd + 0.4 : 0.16, cG, face < 2 ? u + (face === 0 ? 0.08 : -0.08) : u, y0 - 0.14, face < 2 ? w : w + (face === 2 ? 0.08 : -0.08));
  };
  const nL = Math.max(2, Math.round(L / 3.4)), nD = Math.max(1, Math.round(D / 3.6)), wy = G + 1.6, wh = Math.min(3.6, yW - G - 2.4);
  for (let i = 0; i < nL; i++) { const u = -hu + (i + 0.5) * L / nL; win(u, hw, 2, wy, 1.3, wh); win(u, -hw, 3, wy, 1.3, wh); }
  for (let j = 0; j < nD; j++) { const w = -hw + (j + 0.5) * D / nD; win(hu, w, 0, wy, 1.3, wh); win(-hu, w, 1, wy, 1.3, wh); }
  hipRoof(SL, -hu, hu, -hw, hw, yW, 0.45, 0.42, cSl, cSD);
  const out = [];
  for (const [b, m, nm] of [[SC, M.stone, 'stone'], [GR, M.stone, 'dressings'], [SL, M.slate, 'roof'], [DK, M.matte, 'windows']]) { const mesh = b.mesh(m, 'cp32m:gatehouse:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- the Bow Bridge boat landing -----------------------------------------------------------------------------------
// One of the Lake's rustic landings (rebuilt by the Conservancy to the 1860s pattern): a timber deck out over the water
// east of Bow Bridge's Ramble end, brown-painted posts and rails with close balusters on its three water sides, an
// opening at the front for the boats, a bench. OSM node 2216963836 (the landing's shore point); the water lies south.
export const LANDING = { P: [-38.16, 791.19], A: [0.0, 1.0] };
export function buildLanding(group, W, G) {
  const M = lmMats(), [cx, cz] = LANDING.P, [ax, az] = LANDING.A;
  const WD = new LBin().frame(cx, 0, cz, ax, az);
  const cDk = K(0x8a7458), cDkD = K(0x6e5c46), cRl = K(0x5a3e2a), cRlL = K(0x6e4c32);
  const y = Math.max(W + 0.45, Math.min(G, W + 0.9)), u0 = -0.6, u1 = 5.2, hw = 2.1;
  for (let k = 0, w = -hw + 0.07; w < hw; w += 0.15, k++) WD.box(u1 - u0, 0.05, 0.13, k % 4 ? cDk : cDkD, (u0 + u1) / 2, y - 0.05, w);
  for (const u of [u0 + 0.3, (u0 + u1) / 2, u1 - 0.2]) for (const w of [-hw + 0.1, hw - 0.1]) WD.box(0.18, y - (W - 1.2), 0.18, cDkD, u, W - 1.2, w);
  // the railing: posts, the top rail and a mid rail, balusters every 0.14 m, the opening at the front
  const run = (a, b) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(-(b[1] - a[1]), b[0] - a[0]);
    WD.box(L + 0.1, 0.08, 0.12, cRlL, (a[0] + b[0]) / 2, y + 0.92, (a[1] + b[1]) / 2, ang);
    WD.box(L, 0.06, 0.08, cRl, (a[0] + b[0]) / 2, y + 0.15, (a[1] + b[1]) / 2, ang);
    const n = Math.max(1, Math.round(L / 0.14));
    for (let k = 1; k < n; k++) { const t = k / n; WD.box(0.04, 0.77, 0.04, cRl, a[0] + (b[0] - a[0]) * t, y + 0.15, a[1] + (b[1] - a[1]) * t, ang); }
    for (const p of [a, b]) { WD.box(0.14, 1.12, 0.14, cRl, p[0], y, p[1]); WD.box(0.2, 0.06, 0.2, cRlL, p[0], y + 1.12, p[1]); }
  };
  run([u0 + 0.3, -hw + 0.1], [u1 - 0.1, -hw + 0.1]); run([u0 + 0.3, hw - 0.1], [u1 - 0.1, hw - 0.1]);
  run([u1 - 0.1, -hw + 0.1], [u1 - 0.1, -0.6]); run([u1 - 0.1, 0.6], [u1 - 0.1, hw - 0.1]);
  // the step down at the opening, the bench along the east side
  WD.box(0.5, 0.06, 1.1, cDk, u1 + 0.2, y - 0.3, 0);
  WD.box(2.4, 0.06, 0.42, cDk, 2.2, y + 0.42, hw - 0.45); for (const u of [1.2, 3.2]) WD.box(0.08, 0.42, 0.36, cRl, u, y, hw - 0.45);
  const mesh = WD.mesh(M.wood, 'cp32m:landing:wood'); if (mesh) group.add(mesh);
  return { tris: WD.tris, y };
}

// ---- the Delacorte Theater -----------------------------------------------------------------------------------------
// The open-air theatre (1962, Eldon Hunter Duffy for the Parks Department; Shakespeare in the Park), its fan of seats
// rising north from the stage, the stage opening to Turtle Pond and Belvedere Castle. OSM way 278363024 (5.1 m): the fan's
// outer wall and the stage's edge are concentric arcs about (205.3, 333.5), radii 35.8 and 13.35 m (fitted to its 43
// points), the fan from -159 to -35.5 degrees (atan2 of the world z, x offsets: the north side), the side blocks at its
// two ends. Built open (the compiled footprint was a solid 5 m drum).
export const DELA = { C: [205.3, 333.5], R0: 13.35, R1: 35.8, A0: -159.2, A1: -35.5 };
export function buildDelacorte(group, G) {
  const M = lmMats(), D = DELA, [cx, cz] = D.C;
  const CO = new LBin().frame(cx, 0, cz, 1, 0), SE = new LBin().frame(cx, 0, cz, 1, 0), WD = new LBin().frame(cx, 0, cz, 1, 0);
  const cC = K(0xa9a499), cCD = K(0x938e84), cSeat = K(0x2c4a3c), cSeatD = K(0x223a30), cStage = K(0x5a4a3c), cAisle = K(0xb6b1a6);
  const a0 = D.A0 * Math.PI / 180, a1 = D.A1 * Math.PI / 180, nA = 40, rows = 24, rise = 0.21, tread = (D.R1 - 0.8 - D.R0) / rows;
  const P = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];        // frame = world axes: u = x, w = z
  const aisles = [0.1, 0.3, 0.5, 0.7, 0.9];
  for (let k = 0; k < rows; k++) {
    const r0 = D.R0 + k * tread, r1 = r0 + tread, y = G + (k + 1) * rise;
    for (let i = 0; i < nA; i++) {
      const t0 = i / nA, t1 = (i + 1) / nA, aa = a0 + (a1 - a0) * t0, ab = a0 + (a1 - a0) * t1;
      const inAisle = aisles.some((t) => Math.abs((t0 + t1) / 2 - t) < 0.5 / nA);
      CO.quad(P(r0, aa, y), P(r0, ab, y), P(r1, ab, y), P(r1, aa, y), inAisle ? cAisle : cC);          // the tread
      CO.quad(P(r0, aa, y - rise), P(r0, ab, y - rise), P(r0, ab, y), P(r0, aa, y), cCD);                // the riser
      if (!inAisle) SE.quad(P(r0 + tread * 0.72, aa, y), P(r0 + tread * 0.72, ab, y), P(r0 + tread * 0.8, ab, y + 0.82), P(r0 + tread * 0.8, aa, y + 0.82), k % 2 ? cSeat : cSeatD);   // the seat backs
    }
  }
  // the back wall round the top row, with its coping; the fan's ends closed
  const yT = G + rows * rise;
  for (let i = 0; i < nA; i++) {
    const aa = a0 + (a1 - a0) * i / nA, ab = a0 + (a1 - a0) * (i + 1) / nA;
    CO.quad(P(D.R1, aa, G - 0.3), P(D.R1, ab, G - 0.3), P(D.R1, ab, yT + 1.1), P(D.R1, aa, yT + 1.1), cCD);
    CO.quad(P(D.R1 - 0.8, aa, yT), P(D.R1 - 0.8, ab, yT), P(D.R1, ab, yT), P(D.R1, aa, yT), cC);
    CO.quad(P(D.R1 - 0.3, aa, yT + 1.1), P(D.R1 - 0.3, ab, yT + 1.1), P(D.R1, ab, yT + 1.1), P(D.R1, aa, yT + 1.1), cC);
  }
  for (const a of [a0, a1]) for (let k = 0; k < rows; k++) { const r0 = D.R0 + k * tread, y = G + (k + 1) * rise; CO.quad(P(r0, a, G - 0.3), P(r0 + tread, a, G - 0.3), P(r0 + tread, a, y), P(r0, a, y), cCD); }
  // the stage: a thrust platform in the fan's centre and its deck toward the pond
  const nS = 24;
  for (let i = 0; i < nS; i++) { const aa = -Math.PI + Math.PI * i / nS, ab = -Math.PI + Math.PI * (i + 1) / nS; WD.tri([0, G + 0.75, 0], P(D.R0 - 1.2, aa, G + 0.75), P(D.R0 - 1.2, ab, G + 0.75), cStage); CO.quad(P(D.R0 - 1.2, aa, G), P(D.R0 - 1.2, ab, G), P(D.R0 - 1.2, ab, G + 0.75), P(D.R0 - 1.2, aa, G + 0.75), cCD); }
  WD.box(2 * (D.R0 - 1.2), 0.75, 7.5, cStage, 0, G, 3.75);
  // the side blocks at the fan's two ends (the lighting and service houses), their light towers
  for (const [a, len] of [[a0, 22], [a1, 17]]) {
    const ux = Math.cos(a), uz = Math.sin(a), mid = D.R0 + len / 2;
    CO.box(len, 6.2, 3.4, cCD, ux * mid, G - 0.3, uz * mid, -a);
    const tx = ux * (D.R0 + 1.5), tz = uz * (D.R0 + 1.5);
    WD.box(0.5, 13.5, 0.5, K(0x3a3c3c), tx, G, tz); WD.box(2.2, 0.8, 0.9, K(0x2c2e30), tx, G + 13.5, tz);
  }
  const out = [];
  for (const [b, m, nm] of [[CO, M.stone, 'concrete'], [SE, M.matte, 'seats'], [WD, M.wood, 'stage']]) { const mesh = b.mesh(m, 'cp32m:delacorte:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- gabled ranges, octagonal pavilions ----------------------------------------------------------------------------
// a gable roof over the frame rectangle, the ridge along u (along = 'u') or w, the gable ends walled in `wallCol`
export function gableRoof(B, W, u0, u1, w0, w1, yE, o, t, col, wallCol, along = 'u') {
  if (along === 'u') {
    const r = (w1 - w0) / 2 + o, yR = yE + r * t, wm = (w0 + w1) / 2;
    B.quad([u0 - o, yE, w0 - o], [u1 + o, yE, w0 - o], [u1 + o, yR, wm], [u0 - o, yR, wm], col);
    B.quad([u1 + o, yE, w1 + o], [u0 - o, yE, w1 + o], [u0 - o, yR, wm], [u1 + o, yR, wm], col);
    for (const u of [u0, u1]) W.tri([u, yE, w0], [u, yE, w1], [u, yE + (w1 - w0) / 2 * t, wm], wallCol);
    return yR;
  }
  const r = (u1 - u0) / 2 + o, yR = yE + r * t, um = (u0 + u1) / 2;
  B.quad([u0 - o, yE, w1 + o], [u0 - o, yE, w0 - o], [um, yR, w0 - o], [um, yR, w1 + o], col);
  B.quad([u1 + o, yE, w0 - o], [u1 + o, yE, w1 + o], [um, yR, w1 + o], [um, yR, w0 - o], col);
  for (const w of [w0, w1]) W.tri([u0, yE, w], [u1, yE, w], [um, yE + (u1 - u0) / 2 * t, w], wallCol);
  return yR;
}
// an octagonal pavilion on its OSM ring (8 corners, world): walls to the eaves with an arched opening in each side, a
// pyramidal roof, a lantern
export function buildOctagon(group, name, ring, G, o) {
  const M = lmMats();
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const WL = new LBin().frame(cx, 0, cz, 1, 0), RF = new LBin().frame(cx, 0, cz, 1, 0), DK = new LBin().frame(cx, 0, cz, 1, 0), TR = new LBin().frame(cx, 0, cz, 1, 0);
  const n = ring.length, yW = G + o.wall, P = ring.map(([x, z]) => [x - cx, z - cz]), dark = K(0x24282a);
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let nx = (b[1] - a[1]) / L, nz = -(b[0] - a[0]) / L;
    if (((a[0] + b[0]) / 2) * nx + ((a[1] + b[1]) / 2) * nz < 0) { nx = -nx; nz = -nz; }                // outward
    const at = (t, y, off) => [a[0] + (b[0] - a[0]) * t + nx * off, y, a[1] + (b[1] - a[1]) * t + nz * off];
    WL.quad(at(0, G - 0.4, 0), at(1, G - 0.4, 0), at(1, yW, 0), at(0, yW, 0), o.wallCol);
    const ow = Math.min(o.open, L * 0.7) / L, oh = o.openH, r = (ow * L) / 2, yb = G + o.sill, ys = yb + oh - r;
    DK.quad(at(0.5 - ow / 2, yb, 0.03), at(0.5 + ow / 2, yb, 0.03), at(0.5 + ow / 2, ys, 0.03), at(0.5 - ow / 2, ys, 0.03), dark);
    for (let k = 0; k < 8; k++) { const q0 = Math.PI * k / 8, q1 = Math.PI * (k + 1) / 8; DK.tri(at(0.5, ys, 0.03), at(0.5 + Math.cos(q0) * ow / 2, ys + Math.sin(q0) * r, 0.03), at(0.5 + Math.cos(q1) * ow / 2, ys + Math.sin(q1) * r, 0.03), dark); }
    TR.quad(at(0, yW - 0.45, 0.05), at(1, yW - 0.45, 0.05), at(1, yW, 0.05), at(0, yW, 0.05), o.trimCol);
    const e0 = at(0, yW, o.eave), e1 = at(1, yW, o.eave);
    RF.tri(e0, e1, [0, yW + o.rise, 0], o.roofCol);
    RF.quad(at(0, yW, 0), at(1, yW, 0), e1, e0, o.trimCol);
  }
  if (o.lantern) { TR.cyl(o.lantern * 0.8, o.lantern, 1.2, o.trimCol, 0, yW + o.rise - 0.9, 0, 8); RF.cyl(0.05, o.lantern * 1.25, 1.1, o.roofCol, 0, yW + o.rise + 0.3, 0, 8); TR.sphere(0.12, o.trimCol, 0, yW + o.rise + 1.5, 0, 1, 8); }
  const out = [];
  for (const [b, m, nm] of [[WL, M.matte, 'walls'], [RF, M.slate, 'roof'], [DK, M.matte, 'openings'], [TR, M.matte, 'trim']]) { const mesh = b.mesh(m, 'cp32m:' + name + ':' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}
// the Dairy (Calvert Vaux, 1870; restored 1979 as a visitor centre): Victorian Gothic ranges of grey stone under steep
// slate gables, crossing; the timber loggia on its south-west side. OSM way 265347588 (9.6 m), frame O (-202.11,
// 1547.38), u (-0.877, -0.480): the long range u 0-10.64 x w -22.11-0, the cross ranges u -6.13-13.9 x w -11.46 to -3.18
// and u -5.7-13.89 x w -20.1 to -13.38.
export const DAIRY = { O: [-202.11, 1547.38], A: [-0.877, -0.48] };
export function buildDairy(group, G) {
  const M = lmMats(), [ox, oz] = DAIRY.O, [ax, az] = DAIRY.A;
  const SC = new LBin().frame(ox, 0, oz, ax, az), RF = new LBin().frame(ox, 0, oz, ax, az), TW = new LBin().frame(ox, 0, oz, ax, az), DK = new LBin().frame(ox, 0, oz, ax, az);
  const cS = K(0x8d877c), cSD = K(0x7a746a), cR = K(0x55484a), cRD = K(0x3f4448), cT = K(0x8a3a2c), cTL = K(0xe0d6c0);
  const yE = G + 4.4;
  const R = [[0, 10.64, -22.11, 0, 'w', cR], [-6.13, 13.9, -11.46, -3.18, 'u', cRD], [-5.7, 13.89, -20.1, -13.38, 'u', cRD]];
  for (const [u0, u1, w0, w1, al, rc] of R) {
    SC.box(u1 - u0, yE - (G - 0.5), w1 - w0, cS, (u0 + u1) / 2, G - 0.5, (w0 + w1) / 2);
    for (let u = u0 + 1.2; u < u1 - 0.8; u += 2.4) for (const w of [w0, w1]) { DK.box(0.9, 1.9, 0.06, K(0x24282a), u, G + 1.0, w + (w === w0 ? -0.03 : 0.03)); SC.box(1.1, 0.14, 0.12, cSD, u, G + 2.9, w + (w === w0 ? -0.05 : 0.05)); }
    gableRoof(RF, SC, u0, u1, w0, w1, yE, 0.5, al === 'u' ? 1.05 : 0.95, rc, cS, al);
  }
  // the loggia: a timber porch along the long range's south-west side, posts with brackets, a lean-to roof
  const lu0 = -0.2, lu1 = 10.8, lw = 0.0, dep = 3.2;
  for (let u = lu0; u <= lu1 + 1e-6; u += (lu1 - lu0) / 5) { TW.box(0.22, 3.3, 0.22, cT, u, G, lw + dep); TW.box(0.7, 0.16, 0.16, cTL, u, G + 3.0, lw + dep - 0.25); }
  TW.box(lu1 - lu0 + 0.3, 0.3, 0.25, cT, (lu0 + lu1) / 2, G + 3.3, lw + dep);
  RF.quad([lu0 - 0.3, G + 3.6, lw + dep + 0.5], [lu1 + 0.3, G + 3.6, lw + dep + 0.5], [lu1 + 0.3, yE - 0.2, lw], [lu0 - 0.3, yE - 0.2, lw], cRD);
  TW.box(lu1 - lu0, 0.12, dep, K(0x8f8a80), (lu0 + lu1) / 2, G, lw + dep / 2);
  const out = [];
  for (const [b, m, nm] of [[SC, M.stone, 'stone'], [RF, M.slate, 'slate'], [TW, M.wood, 'timber'], [DK, M.matte, 'windows']]) { const mesh = b.mesh(m, 'cp32m:dairy:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- the Swedish Cottage -------------------------------------------------------------------------------------------
// Sweden's model schoolhouse at the 1876 Centennial Exhibition, brought to the park in 1877 (the Marionette Theatre since
// 1947): Baltic fir, dark-stained boards, steep shingled gables crossing, white-trimmed windows. OSM way 278363049 (8.1 m),
// frame O (67.48, 337.94), u (0.7454, 0.6669): the west range u 0-11.47 x w 0-12.28, the east range u 11.47-21.12 x
// w -1.91-13.03.
export const SWEDISH = { O: [67.48, 337.94], A: [0.7454, 0.6669] };
export function buildSwedish(group, G) {
  const M = lmMats(), [ox, oz] = SWEDISH.O, [ax, az] = SWEDISH.A;
  const TW = new LBin().frame(ox, 0, oz, ax, az), RF = new LBin().frame(ox, 0, oz, ax, az), DK = new LBin().frame(ox, 0, oz, ax, az), TR = new LBin().frame(ox, 0, oz, ax, az);
  const cT = K(0x5a3c28), cTD = K(0x4a3020), cR = K(0x5e4a40), cTr = K(0xe4dccb), cW = K(0x24282a), yE = G + 3.8;
  const R = [[0, 11.47, 0, 12.28, 'w', 0.7], [11.47, 21.12, -1.91, 13.03, 'u', 0.6]];
  for (const [u0, u1, w0, w1, al, pt] of R) {
    TW.box(u1 - u0, yE - (G - 0.4), w1 - w0, cT, (u0 + u1) / 2, G - 0.4, (w0 + w1) / 2);
    for (let y = G + 0.3; y < yE; y += 0.3) for (const w of [w0 - 0.01, w1 + 0.01]) TR.quad([u0, y, w], [u1, y, w], [u1, y + 0.03, w], [u0, y + 0.03, w], cTD);   // the boards' shadow lines
    for (let u = u0 + 1.5; u < u1 - 1.0; u += 2.6) for (const w of [w0, w1]) { const s = w === w0 ? -1 : 1; DK.box(1.0, 1.5, 0.05, cW, u, G + 1.1, w + s * 0.03); TR.box(1.25, 0.12, 0.1, cTr, u, G + 2.6, w + s * 0.05); TR.box(1.25, 0.1, 0.1, cTr, u, G + 1.0, w + s * 0.05); }
    gableRoof(RF, TW, u0, u1, w0, w1, yE, 0.7, pt, cR, cT, al);
  }
  TR.box(3.0, 0.2, 2.2, cTr, 21.12 + 1.1, G + 2.8, 5.5); for (const w of [4.5, 6.5]) TR.box(0.18, 2.8, 0.18, cTr, 21.12 + 2.0, G, w);   // the porch
  const out = [];
  for (const [b, m, nm] of [[TW, M.wood, 'timber'], [RF, M.slate, 'shingles'], [DK, M.matte, 'windows'], [TR, M.wood, 'trim']]) { const mesh = b.mesh(m, 'cp32m:swedish:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- Wollman Rink --------------------------------------------------------------------------------------------------
// The rink (1950; Kate Wollman's gift; the Victorian Gardens rides on it in summer): OSM way 136507647, its 36-point
// outline. The ground inside it is re-kinded to the city's paved plaza (cpLandmarks.js apply) and ringed here by the
// dasher boards (1.1 m, white, a blue cap rail) with gates.
export const RINK = [[-305.16, 1684.83], [-305.07, 1681.96], [-304.15, 1679.5], [-302.55, 1677.06], [-300.22, 1675.24], [-296.12, 1673.81], [-291.11, 1672.79],
  [-286.2, 1672.4], [-278.82, 1672.77], [-273.47, 1673.6], [-268.54, 1674.76], [-262.09, 1677.05], [-254.85, 1680.45], [-251.58, 1682.58], [-248.73, 1684.93],
  [-247.06, 1686.95], [-246.24, 1689.8], [-246.57, 1692.74], [-247.93, 1696.6], [-255.15, 1718.8], [-260.61, 1733.31], [-263.02, 1736.97], [-265.02, 1738.65],
  [-267.24, 1739.7], [-269.91, 1740.85], [-272.8, 1741.17], [-277.82, 1740.08], [-281.13, 1737.59], [-284.43, 1734.28], [-288.5, 1729.04], [-292.68, 1722.58],
  [-296.94, 1713.88], [-300.58, 1705.34], [-303.18, 1696.39], [-304.43, 1689.93]];
export function buildRinkBoards(group, yAt) {
  const M = lmMats(), B = new LBin().frame(0, 0, 0, 1, 0), n = RINK.length, cW = K(0xe8e8e4), cCap = K(0x2c4a7a);
  for (let i = 0; i < n; i++) {
    if (i % 9 === 4) continue;                                                  // four gates
    const a = RINK[i], b = RINK[(i + 1) % n], ya = yAt(a[0], a[1]), yb = yAt(b[0], b[1]);
    B.quad([a[0], ya - 0.1, a[1]], [b[0], yb - 0.1, b[1]], [b[0], yb + 1.07, b[1]], [a[0], ya + 1.07, a[1]], cW);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = (b[1] - a[1]) / L * 0.09, nz = -(b[0] - a[0]) / L * 0.09;
    B.quad([a[0] - nx, ya + 1.07, a[1] - nz], [b[0] - nx, yb + 1.07, b[1] - nz], [b[0] + nx, yb + 1.07, b[1] + nz], [a[0] + nx, ya + 1.07, a[1] + nz], cCap);
    B.quad([a[0] + nx, ya - 0.1, a[1] + nz], [b[0] + nx, yb - 0.1, b[1] + nz], [b[0] + nx, yb + 1.07, b[1] + nz], [a[0] + nx, ya + 1.07, a[1] + nz], cW);
  }
  const mesh = B.mesh(M.matte, 'cp32m:rink:boards'); if (mesh) group.add(mesh);
  return B.tris;
}

// ---- one draw per material per tile ---------------------------------------------------------------------------------
// The structures a tile holds are built as one mesh per material each; the plain (non-instanced) ones added to the group
// since index i0 are merged per material (and attribute set) into one mesh, so a tile's landmarks cost a draw per material
export function mergeByMaterial(group, i0) {
  const bins = new Map(), keep = [];
  for (let i = i0; i < group.children.length; i++) {
    const m = group.children[i];
    if (!m.isMesh || m.isInstancedMesh || !m.name.startsWith('cp32m:') || !m.geometry || m.geometry.index) { keep.push(m); continue; }
    const g = m.geometry, key = m.material.uuid + '|' + Object.keys(g.attributes).sort().join(',') + '|' + (m.castShadow ? 1 : 0);
    let b = bins.get(key); if (!b) bins.set(key, (b = { mat: m.material, cast: m.castShadow, list: [], names: [] }));
    b.list.push(g); b.names.push(m.name.split(':')[1]);
  }
  const removed = group.children.splice(i0, group.children.length - i0);
  for (const m of removed) if (keep.includes(m)) group.children.push(m); else m.parent = null;
  let n = 0;
  for (const b of bins.values()) {
    const names = Object.keys(b.list[0].attributes);
    const out = new THREE.BufferGeometry();
    for (const a of names) {
      const it = b.list[0].attributes[a].itemSize;
      let len = 0; for (const g of b.list) len += g.attributes[a].array.length;
      const arr = new Float32Array(len); let o = 0;
      for (const g of b.list) { arr.set(g.attributes[a].array, o); o += g.attributes[a].array.length; }
      out.setAttribute(a, new THREE.BufferAttribute(arr, it));
    }
    for (const g of b.list) g.dispose();
    out.computeBoundingSphere();
    const mesh = new THREE.Mesh(out, b.mat);
    mesh.name = 'cp32m:merged:' + [...new Set(b.names)].join('+'); mesh.castShadow = b.cast; mesh.receiveShadow = true;
    group.add(mesh); n++;
  }
  return { meshes: n, from: removed.length - keep.length };
}

// ---- Balcony Bridge ------------------------------------------------------------------------------------------------
// Calvert Vaux, 1860: the West Drive over a narrow neck of the Lake's western arm on one stone arch, its parapets opening
// at the middle of each face into a half-round balcony over the water (with a stone bench), the favourite view up the
// Lake to the Ramble. OSM way 689009141: 19.1 m across (along the parapets) and about 8 m along the drive, centre
// (-104.6, 496.4); the drive (CSCL WEST DR, 10.4 m) along (0.8097, -0.5864). Frame u along the drive, w across it. The
// deck at the flat compile's asphalt level plus the relief the lead holds along the bridge (cpRelief.js cpBridgeRelief);
// LAND's water cut takes the drive's sections off the neck, so the carriageway, curbs and walks over it are built here.
export const BALC = { C: [-104.6, 496.4], A: [0.8097, -0.5864], HU: 5.2, HW: 7.5, R: 3.6 };
export function buildBalcony(group, W, yDeckA, yDeckB) {
  const M = lmMats(), Bc = BALC, [cx, cz] = Bc.C, [ax, az] = Bc.A;
  const mk = () => new LBin().frame(cx, 0, cz, ax, az);
  const SC = mk(), SN = mk(), RD = mk(), DK = mk();
  const cS = K(0x6f685e), cSD = K(0x5e584f), cSn = K(0xa89c86), cSnD = K(0x958a76), cAs = K(0x4a4a48), cWk = K(0x8f8b84), cCurb = K(0x9a968c);
  const HU = Bc.HU, HW = Bc.HW, R = Bc.R;
  const yd = (u) => yDeckA + (yDeckB - yDeckA) * (u + HU) / (2 * HU);
  const yS = W + 1.1, yC = yS + R;                                         // a half-round arch springing over the water
  // the barrel and the arch rings of voussoirs on both faces, the spandrel walls to the deck
  const nV = 17;
  for (let k = 0; k < nV; k++) {
    const t0 = Math.PI * k / nV, t1 = Math.PI * (k + 1) / nV;
    const pa = [Math.cos(t0) * R, yS + Math.sin(t0) * R], pb = [Math.cos(t1) * R, yS + Math.sin(t1) * R], ring = 0.7;
    const qa = [Math.cos(t0) * (R + ring), yS + Math.sin(t0) * (R + ring)], qb = [Math.cos(t1) * (R + ring), yS + Math.sin(t1) * (R + ring)];
    DK.quad([pa[0], pa[1], -HW], [pb[0], pb[1], -HW], [pb[0], pb[1], HW], [pa[0], pa[1], HW], k % 2 ? cSD : cS);
    for (const s of [-1, 1]) SN.quad([pa[0], pa[1], s * (HW + 0.05)], [pb[0], pb[1], s * (HW + 0.05)], [qb[0], qb[1], s * (HW + 0.05)], [qa[0], qa[1], s * (HW + 0.05)], k % 2 ? cSn : cSnD);
  }
  const us = []; for (let i = 0; i <= 26; i++) us.push(-HU + 2 * HU * i / 26);
  for (const s of [-1, 1]) {
    const w = s * HW;
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i], ub = us[i + 1], low = (u) => (Math.abs(u) < R + 0.7 ? Math.min(yd(u) - 0.3, yS + Math.sqrt(Math.max(0, (R + 0.7) ** 2 - u * u))) : W - 0.8);
      SC.quad([ua, low(ua), w], [ub, low(ub), w], [ub, yd(ub) - 0.05, w], [ua, yd(ua) - 0.05, w], cS);
    }
    // the parapet with its sandstone coping, broken at the middle by the balcony
    for (const [u0, u1] of [[-HU, -2.1], [2.1, HU]]) {
      const L = u1 - u0, um = (u0 + u1) / 2;
      SC.box(L, 1.05, 0.45, cS, um, yd(um), w - s * 0.2);
      SN.box(L + 0.05, 0.14, 0.6, cSn, um, yd(um) + 1.05, w - s * 0.2);
    }
    // the balcony: a half-round bay 2.1 m out over the water on corbels, its parapet, a curved bench inside it
    const nB = 14, rb = 2.1, yb = yd(0);
    for (let k = 0; k < nB; k++) {
      const t0 = Math.PI * k / nB, t1 = Math.PI * (k + 1) / nB;
      const A = [Math.cos(t0) * rb, s * (HW + Math.sin(t0) * rb)], B = [Math.cos(t1) * rb, s * (HW + Math.sin(t1) * rb)];
      RD.tri([0, yb, w], [A[0], yb, A[1]], [B[0], yb, B[1]], cWk);                                        // the floor
      SC.quad([A[0], yb - 0.9, A[1]], [B[0], yb - 0.9, B[1]], [B[0], yb + 1.0, B[1]], [A[0], yb + 1.0, A[1]], cS);   // the parapet
      SN.quad([A[0], yb + 1.0, A[1]], [B[0], yb + 1.0, B[1]], [B[0] * 0.86, yb + 1.12, s * HW + (B[1] - s * HW) * 0.86], [A[0] * 0.86, yb + 1.12, s * HW + (A[1] - s * HW) * 0.86], cSn);
      SN.quad([A[0] * 0.8, yb + 0.45, s * HW + (A[1] - s * HW) * 0.8], [B[0] * 0.8, yb + 0.45, s * HW + (B[1] - s * HW) * 0.8], [B[0] * 0.62, yb + 0.45, s * HW + (B[1] - s * HW) * 0.62], [A[0] * 0.62, yb + 0.45, s * HW + (A[1] - s * HW) * 0.62], cSnD);   // the bench
      SC.quad([A[0], yb - 0.9, A[1]], [B[0], yb - 0.9, B[1]], [B[0] * 0.3, yb - 2.4, s * HW + (B[1] - s * HW) * 0.3], [A[0] * 0.3, yb - 2.4, s * HW + (A[1] - s * HW) * 0.3], cSD);   // the corbelling
    }
  }
  // the abutments' ends and the wing walls down to the water
  for (const sg of [-1, 1]) { const u = sg * HU; SC.quad([u, W - 0.8, -HW], [u, W - 0.8, HW], [u, yd(u), HW], [u, yd(u), -HW], cSD); }
  // the roadway: the carriageway, the curbs, the walks
  for (let i = 0; i + 1 < us.length; i++) {
    const ua = us[i], ub = us[i + 1], ya = yd(ua), yb = yd(ub);
    RD.quad([ua, ya, -5.2], [ub, yb, -5.2], [ub, yb, 5.2], [ua, ya, 5.2], cAs);
    for (const s of [-1, 1]) {
      RD.quad([ua, ya, s * 5.2], [ub, yb, s * 5.2], [ub, yb + 0.15, s * 5.2], [ua, ya + 0.15, s * 5.2], cCurb);
      RD.quad([ua, ya + 0.15, s * 5.2], [ub, yb + 0.15, s * 5.2], [ub, yb + 0.15, s * (HW - 0.4)], [ua, ya + 0.15, s * (HW - 0.4)], cWk);
    }
  }
  const out = [];
  for (const [b, m, nm] of [[SC, M.schist, 'schist'], [SN, M.stone, 'sandstone'], [RD, M.matte, 'roadway'], [DK, M.rock, 'soffit']]) { const mesh = b.mesh(m, 'cp32m:balcony:' + nm); if (mesh) { group.add(mesh); out.push([nm, b.tris]); } }
  return out;
}

// ---- the stone arches ----------------------------------------------------------------------------------------------
// The park's arches and smaller bridges (Vaux and Mould's Greyshot, Dalehead, Willowdell, Denesmouth, Green Gap,
// Springbanks, Glen Span, Winterdale, Eaglevale, Trefoil, Huddlestone and the others): with the lead's deck hold the drive
// or path over each keeps its level while the ground falls away under it, so each gets its masonry here: in its frame
// (u along the upper way, w across it; tools/cp/lm_arches.mjs from the OSM outlines), walls of rubble schist from the
// ground to the deck across the outline, sliced every 1.5 m along u to follow the ground, the arch's opening at the middle
// (its width a third of the crossing, 3.5-5.5 m) under a ring of voussoirs, the barrel's soffit, parapets with a coping.
// deckAt(x, z): the upper way's surface there (null off it), groundAt(x, z): the ground under it.
export function buildArch(B, SN, DK, A, deckAt, groundAt) {
  const [, , mat, cx, cz, ax, az, u0, u1, w0, w1] = A;
  const P = (u, w) => [cx + ax * u - az * w, cz + az * u + ax * w];
  const cS = mat === 'brick' ? K(0x8a4a3a) : K(0x716a60), cSD = mat === 'brick' ? K(0x74402f) : K(0x5f594f), cSn = K(0xa39a8a);
  // the deck along the way's line; the ground under the middle
  const dk = (u) => { const [x, z] = P(u, 0); return deckAt(x, z); };
  const yMid = dk(0), g0 = (() => { const [x, z] = P(0, 0); return groundAt(x, z); })();
  if (yMid === null || yMid - g0 < 2.0) return 0;
  const span = Math.max(3.5, Math.min(5.5, (u1 - u0) / 3)), r = span / 2, H = yMid - g0;
  const yS = g0 + Math.max(0.6, H - r - 1.0);                               // the springing: the crown about 1 m under the deck
  const n0 = B.tris;
  const steps = Math.max(2, Math.ceil((u1 - u0) / 1.5));
  for (let i = 0; i < steps; i++) {
    const ua = u0 + (u1 - u0) * i / steps, ub = u0 + (u1 - u0) * (i + 1) / steps, um = (ua + ub) / 2;
    const ya = dk(ua) ?? dk(um) ?? yMid, yb = dk(ub) ?? dk(um) ?? yMid;
    const [xm, zm] = P(um, 0), gm = groundAt(xm, zm);
    if (Math.min(ya, yb) - gm < 0.4) continue;                                // the way is on the ground here
    const inOpen = Math.abs(um) < r;
    for (const w of [w0, w1]) {
      // the face: from the ground (or the arch's extrados over the opening) to the deck
      const low = (u) => (Math.abs(u) < r + 0.6 ? Math.max(gm - 0.4, yS + Math.sqrt(Math.max(0, (r + 0.6) ** 2 - u * u))) : gm - 0.4);
      B.quad([ua, low(ua), w], [ub, low(ub), w], [ub, yb - 0.05, w], [ua, ya - 0.05, w], cS);
      // the parapet and its coping along the deck's edge
      B.quad([ua, ya - 0.05, w], [ub, yb - 0.05, w], [ub, yb + 0.9, w], [ua, ya + 0.9, w], cS);
      const s = w > 0 ? -1 : 1;
      B.quad([ua, ya, w + s * 0.45], [ub, yb, w + s * 0.45], [ub, yb + 0.9, w + s * 0.45], [ua, ya + 0.9, w + s * 0.45], cS);
      SN.quad([ua, ya + 0.9, w + s * 0.5], [ub, yb + 0.9, w + s * 0.5], [ub, yb + 1.0, w - s * 0.05], [ua, ya + 1.0, w - s * 0.05], cSn);
    }
    if (!inOpen) {
      // the solid between the faces under the deck (its underside at the ground): closed at the slice's ends by the next
      B.quad([ua, gm - 0.4, w0], [ua, gm - 0.4, w1], [ua, ya - 0.1, w1], [ua, ya - 0.1, w0], cSD);
    }
  }
  // the arch: voussoirs on both faces, the barrel's soffit through the width, the opening's dark depth at the faces
  const nV = 13, ring = 0.6;
  for (let k = 0; k < nV; k++) {
    const t0 = Math.PI * k / nV, t1 = Math.PI * (k + 1) / nV;
    const pa = [Math.cos(t0) * r, yS + Math.sin(t0) * r], pb = [Math.cos(t1) * r, yS + Math.sin(t1) * r];
    const qa = [Math.cos(t0) * (r + ring), yS + Math.sin(t0) * (r + ring)], qb = [Math.cos(t1) * (r + ring), yS + Math.sin(t1) * (r + ring)];
    DK.quad([pa[0], pa[1], w0], [pb[0], pb[1], w0], [pb[0], pb[1], w1], [pa[0], pa[1], w1], k % 2 ? cSD : cS);
    for (const w of [w0 - 0.04, w1 + 0.04]) SN.quad([pa[0], pa[1], w], [pb[0], pb[1], w], [qb[0], qb[1], w], [qa[0], qa[1], w], k % 2 ? cSn : K(0x948b7c));
  }
  // the opening's jambs from the ground to the springing
  for (const su of [-1, 1]) B.quad([su * r, g0 - 0.4, w0], [su * r, g0 - 0.4, w1], [su * r, yS, w1], [su * r, yS, w0], cSD);
  return B.tris - n0;
}
