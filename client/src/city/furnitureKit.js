// Street furniture geometry builders. Each returns { geo, glow? } — vertex-colored,
// origin at ground center, +Z faces "forward" (out from building / toward street).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURN } from '../shared/geo.js';
import { atlasUV, blankUV } from './panelArt.js';

// ?zfix=0 restores the pre-2026-09-04 z-fight datums for A/B measurement
// (docs/notes/zfight.md; tools/zfight.mjs --flags "...&zfix=0"). Default ON.
const ZFIX = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('zfix') === '0');
// ?gfix=0 restores the pre-2026-09-10 MOTION-artefact behaviour for A/B
// measurement (docs/notes/glitch-r7.md; tools/tflick.mjs --flags "...&gfix=0").
// Default ON.
const GFIX = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gfix') === '0');
// FD14 ?fd14=0 restores round-13 behaviour (docs/notes/fd14.md). In THIS file: the stoop
// rail — critic-r14 fix 7 read it as "two plain pipes" because it was four balusters over
// two metres of rake, with no bottom rail and no newel.
const FD14K = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fd14') === '0');
// SG13 ?sg13=0 restores the pre-2026-09-16 traffic signal (docs/notes/signals-r13.md).
// Default ON.
export const SG13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('sg13') === '0');
// SG13 geometry contract shared with world/assemble.js. The mast is four pools,
// not one: the ARM is authored at `ref` metres of horizontal reach and Z-scaled
// by reach/ref at claim time, so the head hung off its tip lands at
// tipZ * (reach / ref) and the pole-mounted face at (poleZ, poleY). Heights are
// above the prop origin (the kerb). Keep in step with G.signalArm / G.signalMast.
export const SG13_ARM = { ref: 4.6, tipZ: 4.631, headY: 5.88, poleY: 5.30, poleZ: 0.42 };

const C = (hex) => new THREE.Color(hex);
function paint(geo, color) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function box(w, h, d, hex, x = 0, y = 0, z = 0, ry = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, h / 2, 0);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return paint(g, C(hex));
}
function cyl(rT, rB, h, hex, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.CylinderGeometry(rT, rB, h, seg);
  g.translate(x, y + h / 2, z);
  return paint(g, C(hex));
}
function tcyl(rT, rB, h, hex, x = 0, y = 0, z = 0, seg = 8, rx = 0) { // pitched cylinder (drum antennas)
  const g = new THREE.CylinderGeometry(rT, rB, h, seg);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return paint(g, C(hex));
}
function tbox(w, h, d, hex, x = 0, y = 0, z = 0, rx = 0) { // pitch-tilted box (solar panels)
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return paint(g, C(hex));
}
function sphere(r, hex, x = 0, y = 0, z = 0, seg = 8) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2));
  g.translate(x, y, z);
  return paint(g, C(hex));
}
function merge(list) { const g = mergeGeometries(list, false); list.forEach((x) => x.dispose()); return g; }
// open-ended low-poly tube: scaffold/railing pipe without the wasted end caps.
// 6 sides = 12 tris, and the missing caps never show (they sit in a plate,
// a fitting or the ground).
function pipe(r, h, hex, x = 0, y = 0, z = 0, seg = 6) {
  const g = new THREE.CylinderGeometry(r, r, h, seg, 1, true);
  g.translate(x, y + h / 2, z);
  return paint(g, C(hex));
}
// pipe between two points (braces, tie rods, curved arms built from chords)
const _UP = new THREE.Vector3(0, 1, 0);
const _D = new THREE.Vector3();
function strut(p1, p2, r1, r2, hex, seg = 6, open = true) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
  const len = Math.hypot(dx, dy, dz) || 1e-4;
  const g = new THREE.CylinderGeometry(r2, r1, len, seg, 1, open);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(_UP, _D.set(dx, dy, dz).divideScalar(len)));
  g.translate(p1[0], p1[1], p1[2]);
  return paint(g, C(hex));
}
// single-quad plates (2 tris): a stair tread, a riser or a warning plate is
// only ever read from one side, where a box would cost 12 tris
function hplate(w, d, hex, x = 0, y = 0, z = 0) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  g.translate(x, y, z);
  return paint(g, C(hex));
}
function vplate(w, h, hex, x = 0, y = 0, z = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  g.translate(x, y + h / 2, z);
  return paint(g, C(hex));
}
// horizontal tube along +x (ledgers, hand rails) — cheaper than strut()
function xpipe(x1, x2, y, z, r, hex, seg = 6) { return strut([x1, y, z], [x2, y, z], r, r, hex, seg); }

// ------------------------------------- COVERAGE-PRESERVING ALPHA MIPS  (r8)
// ?aa=0 restores plain GPU-generated mips for A/B (docs/notes/shading-aa-r8.md).
const AAFIX_K = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('aa') === '0');
//
// THE PROBLEM (measured: docs/notes/glitch-r7.md 2.2 family B / 3.4). An alpha
// CUTOUT is a binary function of a continuous field, and box-filtering the
// field does NOT commute with thresholding it:
//
//     mean( a >= t )   !=   ( mean(a) >= t )
//
// A leaf card is ~35 % covered by opaque ellipses. Box-average four texels of
// which one is opaque and you get a = 0.25, which fails a 0.35/0.45 test: the
// canopy THINS with every mip level, so leaves fade out as the camera pulls
// back and pop in as it pushes forward. Worse for flicker, the mip level is a
// continuous function of the pixel footprint, so along a 2 cm dolly the whole
// crown sits on an alpha field whose mean is sliding through the threshold —
// which is exactly the dense red/blue speckle over every tree in
// `fStreetGeom_geom_flick.png`, and the 40.8 % of `gxTrees`.
//
// THE FIX (Castano 2010, "Computing Alpha Mipmaps"; the standard fix in every
// engine that ships foliage). Keep the box filter, then rescale each level's
// alpha by a single constant k_L chosen so that the level's COVERAGE at the
// material's alphaTest equals level 0's:
//
//     coverage(L, k) = |{ texels : min(1, k * a) >= alphaTest }| / |L|
//     k_L            = argmin_k | coverage(L, k) - coverage(0, 1) |
//
// coverage is monotone non-decreasing in k, so a bisection on log k converges
// in ~14 steps per level and the whole chain costs ~15 ms once at boot. The
// silhouette area is then scale-invariant: the canopy neither thins nor
// fattens with distance, and there is no systematic drift of the alpha field
// through the threshold as the footprint changes.
//
// NOT alphaToCoverage: measured non-deterministic AND a regression on this
// pipeline (glitch-r7.md 3.4 — overlapping DoubleSide cards in the opaque pass
// with 2 MSAA samples). This runs entirely in the mip chain, changes no draw
// state, costs nothing at runtime and cannot make the renderer stochastic.
//
// `src` must be a TexImageSource (canvas / img / ImageBitmap). Returns a
// DataTexture carrying an explicit `mipmaps` array of {data,width,height} —
// three uploads those level by level (WebGLTextures, the isDataTexture branch)
// and skips GPU mip generation entirely.
//
// WHY A DataTexture AND NOT A CHAIN OF CANVASES. Canvas 2D stores PREMULTIPLIED
// pixels, so putImageData(rgb, a) -> texImage2D(canvas, premultiplyAlpha=false)
// is a lossy round trip whose error is ~255/(2a) per channel: exact at a=255,
// +/-1 at a=128, +/-32 at a=4, and TOTAL at a=0. Both leaf atlases deliberately
// carry the mean leaf colour in their transparent texels (trees.js's mip-safe
// flood fill; LEAF_TEX's painted ground) precisely so mip averaging does not
// bleed black into the canopy — and pushing every level back through a canvas
// would undo exactly that, on every level, which is the "slate canopy" bug
// trees.js already had to fix once. Uint8Array straight to the GPU has no such
// round trip. DataTexture defaults `flipY = false` where CanvasTexture defaults
// true, so level 0's rows are flipped once here and the uploaded orientation is
// bit-for-bit what the CanvasTexture this replaces produced.
export function alphaMipTexture(src, alphaTest, o = {}) {
  const W0 = src.width | 0, H0 = src.height | 0;
  const c0 = document.createElement('canvas');
  c0.width = W0; c0.height = H0;
  const x0 = c0.getContext('2d', { willReadFrequently: true });
  x0.drawImage(src, 0, 0);
  const raw = x0.getImageData(0, 0, W0, H0).data;
  const finish = (t) => {
    t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = o.anisotropy ?? 4;
    t.needsUpdate = true;
    return t;
  };
  if (!AAFIX_K) return finish(new THREE.CanvasTexture(c0));   // ?aa=0: exactly the old texture
  const r = alphaMipLevels(raw, W0, H0, alphaTest, o);
  if (!r) return finish(new THREE.CanvasTexture(c0));             // fully opaque / fully cut: nothing to preserve
  return finish(alphaMipDataTexture(r.mips, o));
}
// TV25: the pure half of alphaMipTexture — flip, mip-safe transparent fill (per cell for an atlas), coverage-preserving
// box chain — so the offline tree bake (tools/bake_trees.mjs) can run it in Node on the painted atlas and ship the
// finished levels, and the runtime only uploads them. `raw` is canvas-order RGBA (row 0 = top). Returns
// { mips: [{ data, width, height }], cov0, log } or null when there is no partial coverage to preserve.
export function alphaMipLevels(raw, W0, H0, alphaTest, o = {}) {
  // flipY compensation: DataTexture uploads rows as given
  let lvl = new Uint8Array(W0 * H0 * 4);
  for (let y = 0; y < H0; y++) lvl.set(raw.subarray((H0 - 1 - y) * W0 * 4, (H0 - y) * W0 * 4), y * W0 * 4);
  // MIP-SAFE TRANSPARENT FILL — trees.js's "MIP RULE for alpha cutouts",
  // applied here so it holds for EVERY cutout this helper builds and so it
  // survives the canvas read above (canvas 2D is premultiplied, so a texel at
  // a = 0 comes back rgb = 0 whatever colour was written into it). Box
  // averaging that black into the coarser levels is exactly what turns a
  // distant canopy slate grey. Give every fully-transparent texel the mean
  // colour of the opaque ones; the alpha test discards them, so this shows up
  // only where it should — in the bilinear blend at a leaf border and in the
  // mips built below.
  {
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < lvl.length; i += 4) if (lvl[i + 3] > 128) { r += lvl[i]; g += lvl[i + 1]; b += lvl[i + 2]; n++; }
    if (n) {
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      for (let i = 0; i < lvl.length; i += 4) if (lvl[i + 3] < 8) { lvl[i] = r; lvl[i + 1] = g; lvl[i + 2] = b; }
    }
    // TV25: an ATLAS (o.cells x o.cells) fills each cell with ITS OWN mean, so a purple plum card does not grow a
    // green fringe from the atlas-wide mean in the bilinear blend at its leaf borders and in its mips
    const nc = o.cells | 0;
    if (nc > 1 && W0 % nc === 0 && H0 % nc === 0) {
      const cw = W0 / nc, ch = H0 / nc;
      for (let cy = 0; cy < nc; cy++) for (let cx = 0; cx < nc; cx++) {
        let cr = 0, cg = 0, cb = 0, cn = 0;
        for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw, i = (y * W0 + x) * 4; x < (cx + 1) * cw; x++, i += 4) {
          if (lvl[i + 3] > 128) { cr += lvl[i]; cg += lvl[i + 1]; cb += lvl[i + 2]; cn++; }
        }
        if (!cn) continue;
        cr = Math.round(cr / cn); cg = Math.round(cg / cn); cb = Math.round(cb / cn);
        for (let y = cy * ch; y < (cy + 1) * ch; y++) for (let x = cx * cw, i = (y * W0 + x) * 4; x < (cx + 1) * cw; x++, i += 4) {
          if (lvl[i + 3] < 8) { lvl[i] = cr; lvl[i + 1] = cg; lvl[i + 2] = cb; }
        }
      }
    }
  }
  const T = Math.max(1, Math.round(alphaTest * 255));
  // coverage(k) = |{ a : min(255, k*a) >= T }| / N, and k*a > 255 implies
  // k*a >= T for any T <= 255, so that is just |{ a : a >= T/k }|. One 256-bin
  // cumulative alpha histogram then answers every bisection probe in O(1)
  // instead of re-scanning a 1-4 Mpx level 18 times.
  const cumOf = (px) => {
    const h = new Int32Array(257);
    for (let i = 3; i < px.length; i += 4) h[px[i]]++;
    for (let v = 254; v >= 0; v--) h[v] += h[v + 1];      // h[v] = count of a >= v
    return h;
  };
  const covK = (h, n, k) => { const a = Math.ceil(T / k); return a > 255 ? 0 : h[a] / n; };
  const cov0 = covK(cumOf(lvl), W0 * H0, 1);
  if (!(cov0 > 0 && cov0 < 1)) return null;
  let W = W0, H = H0;
  const mips = [{ data: lvl, width: W0, height: H0 }];
  const log = [];
  while (W > 1 || H > 1) {
    const w2 = Math.max(1, W >> 1), h2 = Math.max(1, H >> 1);
    const dst = new Uint8Array(w2 * h2 * 4);
    for (let y = 0; y < h2; y++) {
      const ya = Math.min(2 * y, H - 1), yb = Math.min(2 * y + 1, H - 1);
      for (let x = 0; x < w2; x++) {
        const xa = Math.min(2 * x, W - 1), xb = Math.min(2 * x + 1, W - 1);
        const i00 = (ya * W + xa) * 4, i01 = (ya * W + xb) * 4, i10 = (yb * W + xa) * 4, i11 = (yb * W + xb) * 4;
        const d = (y * w2 + x) * 4;
        // RGB: straight (NON-premultiplied) box average — correct here because
        // the transparent texels already hold the mean leaf colour, so there is
        // no black to weight away from.
        for (let c = 0; c < 4; c++) dst[d + c] = (lvl[i00 + c] + lvl[i01 + c] + lvl[i10 + c] + lvl[i11 + c] + 2) >> 2;
      }
    }
    // bisect on log k for the coverage-preserving alpha scale (monotone in k)
    const hc = cumOf(dst), nT = w2 * h2;
    let lo = 0.02, hi = 64, k = 1;
    for (let it = 0; it < 18; it++) { k = Math.sqrt(lo * hi); if (covK(hc, nT, k) < cov0) lo = k; else hi = k; }
    k = Math.sqrt(lo * hi);
    if (Math.abs(k - 1) > 0.005) for (let i = 3; i < dst.length; i += 4) dst[i] = Math.min(255, Math.round(dst[i] * k));
    mips.push({ data: dst, width: w2, height: h2 });
    log.push(w2 + 'x' + h2 + ':' + k.toFixed(2));
    lvl = dst; W = w2; H = h2;
  }
  if (typeof console !== 'undefined') console.log('[alphamip] ' + (o.name || 'leaf') + ' t=' + alphaTest + ' ' + W0 + 'x' + H0
    + ' cov0=' + (cov0 * 100).toFixed(1) + '% scales ' + log.join(' '));
  return { mips, cov0, log };
}
// the finished chain (alphaMipLevels, or baked levels read back from disk) as the texture three uploads level by level
export function alphaMipDataTexture(mips, o = {}) {
  const tex = new THREE.DataTexture(mips[0].data, mips[0].width, mips[0].height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.mipmaps = mips;
  tex.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  tex.anisotropy = o.anisotropy ?? 4;
  tex.needsUpdate = true;
  return tex;
}

// Canvas-painted foliage cluster (alpha card texture): ~90 elliptical leaves
// with hue/value jitter on transparent ground — no external asset needed.
export const LEAF_TEX = (() => {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 256;
  const g = cv.getContext('2d');
  let sd = 12345;
  const rr = () => { sd = (sd * 16807 + 11) % 2147483647; return ((sd >>> 3) & 0xffff) / 0xffff; };
  for (let i = 0; i < 95; i++) {
    const cx = 128 + (rr() - 0.5) * 205, cy = 128 + (rr() - 0.5) * 205;
    const d = Math.hypot(cx - 128, cy - 128) / 128;
    if (d > 0.94) continue;
    const rx = 9 + rr() * 15, ry = rx * (0.45 + rr() * 0.35), a = rr() * Math.PI;
    const L = 26 + rr() * 42 + (1 - d) * 16;
    g.fillStyle = `hsl(${96 + rr() * 26}, ${34 + rr() * 22}%, ${L}%)`;
    g.beginPath();
    g.ellipse(cx, cy, rx, ry, a, 0, Math.PI * 2);
    g.fill();
  }
  // 0.45 is instancer.js's crownMat alphaTest; the chain has to be built for
  // the threshold the material actually cuts at.
  return alphaMipTexture(cv, 0.45, { name: 'LEAF_TEX' });
})();

export function buildFurnitureGeos() {
  const G = {};

  // ---- trees: 3 archetypes, noise-displaced multi-cluster canopies, per-instance color
  {
    const h1 = (x, y, z) => { const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453; return s - Math.floor(s); };
    const puff = (r, x, y, z, squash = 0.88, disp = 0.3, detail = 0) => {
      const g = new THREE.IcosahedronGeometry(r, detail || (r > 1.0 ? 3 : 2));
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
        const n = h1(vx * 1.7, vy * 1.7, vz * 1.7);
        const n2 = h1(vx * 4.3 + 7.1, vy * 4.3, vz * 4.3); // crinkle octave
        const k = 1 + (n - 0.5) * 2 * disp + (n2 - 0.5) * 0.55 * disp;
        pos.setXYZ(i, vx * k, vy * k * squash, vz * k);
      }
      // crown-volume normals (procedural-vegetation contract): billowy foliage
      // shades from the puff's volume, not its displaced facets — radial from
      // the puff center with an upward sky-light bias, NOT computeVertexNormals
      {
        const nrm = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
          const l = Math.hypot(vx, vy, vz) || 1;
          let nx = vx / l, ny = vy / l + 0.38, nz = vz / l;
          const nl = Math.hypot(nx, ny, nz);
          nrm[i * 3] = nx / nl; nrm[i * 3 + 1] = ny / nl; nrm[i * 3 + 2] = nz / nl;
        }
        g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      }
      g.translate(x, y, z);
      // vertical shading gradient + per-puff jitter baked into vertex color (multiplies instance color)
      const col = new Float32Array(pos.count * 3);
      const jit = 0.85 + h1(x, y, z) * 0.3;
      for (let i = 0; i < pos.count; i++) {
        const t = THREE.MathUtils.clamp((g.attributes.position.getY(i) - (y - r)) / (2 * r), 0, 1);
        const v = (0.55 + 0.5 * t) * jit;
        col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 0.94;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      return g;
    };
    const branch = (r1, r2, len, x, y, z, tiltX, tiltZ, hex = '#4a3826') => {
      const g = new THREE.CylinderGeometry(r2, r1, len, 6);
      g.translate(0, len / 2, 0);
      g.rotateX(tiltX); g.rotateZ(tiltZ);
      g.translate(x, y, z);
      return paint(g, C(hex));
    };
    // GROWN trees (procedural-vegetation contract, compact ash-growth port):
    // per-level species table -> queue-grown branches (inherited direction +
    // stochastic curvature + upward tropism, stratified child emergence with
    // permuted azimuths) -> tapered tube segments; crown puffs sit on the
    // grown TIPS so canopy volume follows real branch topology.
    const grow = (P, seed) => {
      let s0 = seed | 0;
      const rnd = () => { s0 = (s0 * 16807 + 19) % 2147483647; return ((s0 >>> 4) & 0xffff) / 0xffff; };
      const segs = [], tips = [];
      const queue = [{ p: [0, 0, 0], d: [0.02, 1, -0.01], len: P.len[0], r: P.r0, lvl: 0 }];
      while (queue.length) {
        const b = queue.shift();
        const n = P.sec[b.lvl];
        let p = b.p.slice(), d = b.d.slice();
        const segLen = b.len / n;
        const pts = [p.slice()];
        for (let i = 0; i < n; i++) {
          d[0] += (rnd() - 0.5) * P.gnarl[b.lvl];
          d[2] += (rnd() - 0.5) * P.gnarl[b.lvl];
          d[1] += P.trop[b.lvl];
          const L = Math.hypot(d[0], d[1], d[2]) || 1;
          d = [d[0] / L, d[1] / L, d[2] / L];
          p = [p[0] + d[0] * segLen, p[1] + d[1] * segLen, p[2] + d[2] * segLen];
          pts.push(p.slice());
        }
        segs.push({ pts, r0: b.r, r1: b.r * P.taper[b.lvl] });
        if (b.lvl + 1 < P.len.length) {
          const kids = P.kids[b.lvl];
          for (let k = 0; k < kids; k++) {
            const t = P.emerge[b.lvl][0] + ((k + rnd() * 0.8) / kids) * (P.emerge[b.lvl][1] - P.emerge[b.lvl][0]);
            const idx = Math.max(1, Math.min(pts.length - 1, Math.round(t * (pts.length - 1))));
            const base = pts[idx];
            const az = ((k + 0.5) / kids + rnd() * 0.3) * Math.PI * 2;
            const tilt = P.ang[b.lvl] + (rnd() - 0.5) * 0.35;
            const pd = d;
            let ux = pd[1] * 0.2 - pd[2] * 0.7, uy = pd[2] * 0.31 - pd[0] * 0.2, uz = pd[0] * 0.7 - pd[1] * 0.31;
            const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
            const vx = pd[1] * uz - pd[2] * uy, vy = pd[2] * ux - pd[0] * uz, vz = pd[0] * uy - pd[1] * ux;
            const ct = Math.cos(tilt), st = Math.sin(tilt), ca = Math.cos(az), sa = Math.sin(az);
            const cd = [pd[0] * ct + (ux * ca + vx * sa) * st, pd[1] * ct + (uy * ca + vy * sa) * st, pd[2] * ct + (uz * ca + vz * sa) * st];
            queue.push({ p: base, d: cd, len: b.len * P.kidLen[b.lvl] * (0.8 + rnd() * 0.4), r: Math.max(0.03, b.r * P.taper[b.lvl] * 0.8), lvl: b.lvl + 1 });
          }
        } else {
          tips.push({ p: pts[pts.length - 1], r: b.len });
        }
      }
      return { segs, tips };
    };
    const treeGeo = (P, seed, bark, puffR, squash) => {
      const { segs, tips } = grow(P, seed);
      const trunkParts = [];
      for (const sg of segs) {
        const m = sg.pts.length - 1;
        for (let i = 0; i < m; i++) {
          const a = sg.pts[i], b = sg.pts[i + 1];
          const r0 = sg.r0 + (sg.r1 - sg.r0) * (i / m), r1 = sg.r0 + (sg.r1 - sg.r0) * ((i + 1) / m);
          const dx2 = b[0] - a[0], dy2 = b[1] - a[1], dz2 = b[2] - a[2];
          const len2 = Math.hypot(dx2, dy2, dz2) || 0.01;
          const g2 = new THREE.CylinderGeometry(r1, r0, len2 * 1.06, 5);
          g2.translate(0, len2 / 2, 0);
          const mm = new THREE.Matrix4().lookAt(new THREE.Vector3(), new THREE.Vector3(dx2, dy2, dz2).negate(), new THREE.Vector3(0, 0, 1));
          const qq = new THREE.Quaternion().setFromRotationMatrix(mm);
          g2.applyQuaternion(qq.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)));
          g2.translate(a[0], a[1], a[2]);
          trunkParts.push(paint(g2, C(bark)));
        }
      }
      // crown = 3 crossed alpha cards per grown tip (game-standard foliage):
      // normals stay RADIAL from the tip center so the cluster shades as a
      // volume, not as flat billboards
      const cards = [];
      tips.forEach((t, i) => {
        const r = puffR * 1.9 * (0.85 + ((i * 37) % 10) * 0.05);
        for (let k = 0; k < 3; k++) {
          const gq = new THREE.PlaneGeometry(r * 2, r * 2 * squash);
          gq.rotateY((k / 3) * Math.PI + (i * 0.61));
          gq.rotateX(((i * 29) % 10 - 5) * 0.05);
          gq.translate(t.p[0], t.p[1] + r * 0.42, t.p[2]);
          const pos = gq.attributes.position, nrm = new Float32Array(pos.count * 3), col = new Float32Array(pos.count * 3);
          const jit = 0.8 + (((i * 53 + k * 17) % 10) / 10) * 0.35;
          for (let vi = 0; vi < pos.count; vi++) {
            let nx = pos.getX(vi) - t.p[0], ny = pos.getY(vi) - (t.p[1] + r * 0.3), nz = pos.getZ(vi) - t.p[2];
            const nl = Math.hypot(nx, ny, nz) || 1;
            ny = ny / nl + 0.45; nx /= nl; nz /= nl;
            const n2l = Math.hypot(nx, ny, nz);
            nrm[vi * 3] = nx / n2l; nrm[vi * 3 + 1] = ny / n2l; nrm[vi * 3 + 2] = nz / n2l;
            const sh = (0.6 + 0.4 * Math.max(0, ny)) * jit;
            col[vi * 3] = sh; col[vi * 3 + 1] = sh; col[vi * 3 + 2] = sh * 0.94;
          }
          gq.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          gq.setAttribute('color', new THREE.BufferAttribute(col, 3));
          cards.push(gq);
        }
      });
      return { trunk: merge(trunkParts), crown: merge(cards) };
    };
    // species tables: broad plane/oak, vase honeylocust, columnar ginkgo
    const SPEC_A = { len: [3.1, 2.2, 1.5], r0: 0.27, sec: [5, 4, 3], kids: [4, 3], kidLen: [0.72, 0.72],
      ang: [0.62, 0.5], emerge: [[0.55, 1.0], [0.4, 1.0]], gnarl: [0.14, 0.3, 0.42], trop: [0.06, 0.03, 0.05], taper: [0.62, 0.55, 0.4] };
    const SPEC_B = { len: [2.0, 1.7, 1.2], r0: 0.18, sec: [4, 3, 3], kids: [3, 2], kidLen: [0.8, 0.75],
      ang: [0.5, 0.42], emerge: [[0.6, 1.0], [0.5, 1.0]], gnarl: [0.1, 0.26, 0.36], trop: [0.12, 0.1, 0.12], taper: [0.6, 0.52, 0.4] };
    const SPEC_C = { len: [3.0, 1.1], r0: 0.17, sec: [5, 3], kids: [6], kidLen: [0.42],
      ang: [0.42, 0.3], emerge: [[0.35, 0.98]], gnarl: [0.06, 0.2], trop: [0.1, 0.16], taper: [0.6, 0.45] };
    const tA = treeGeo(SPEC_A, 1234567, '#4a3826', 1.05, 0.88);
    const tB = treeGeo(SPEC_B, 987651, '#5a4632', 0.85, 1.06);
    const tC = treeGeo(SPEC_C, 555331, '#4f4030', 0.62, 1.25);
    G.treeATrunk = { geo: tA.trunk };
    G.treeACrown = { geo: tA.crown, perInstanceColor: true };
    G.treeBTrunk = { geo: tB.trunk };
    G.treeBCrown = { geo: tB.crown, perInstanceColor: true };
    G.treeCTrunk = { geo: tC.trunk };
    G.treeCCrown = { geo: tC.crown, perInstanceColor: true };
    // seed-variant pools: same placeholder geo, trees.js swaps in reseeded
    // ez-tree builds so neighboring street trees stop being clones
    G.treeA2Trunk = { geo: tA.trunk }; G.treeA2Crown = { geo: tA.crown, perInstanceColor: true };
    G.treeA3Trunk = { geo: tA.trunk }; G.treeA3Crown = { geo: tA.crown, perInstanceColor: true };
    G.treeB2Trunk = { geo: tB.trunk }; G.treeB2Crown = { geo: tB.crown, perInstanceColor: true };
    G.treeC2Trunk = { geo: tC.trunk }; G.treeC2Crown = { geo: tC.crown, perInstanceColor: true };
    // TV25: one pool pair per species FORM variant (TREE_FORMS below). Placeholder = the puff tree of the form's
    // sizing class until trees.js swaps in the generated tree; `?tv25=0` does not create them at all.
    if (TV25) for (const name of TV25_POOLS) {
      const t = { A: tA, B: tB, C: tC }[TREE_FORMS[name.slice(4).replace(/\d+$/, '')].arch] || tA;
      G[name + 'Trunk'] = { geo: t.trunk };
      G[name + 'Crown'] = { geo: t.crown, perInstanceColor: true };
    }
  }
  // ---- NYC cobra-head street light, the standard octagonal pole. The Street
  //      Design Manual gives the city essentially ONE streetlight: 30 ft
  //      (9.144 m) pole, a single mandated 8 ft (2.438 m) mast arm, hot-dip
  //      galvanized silver finish, 3000 K LED — only the wattage changes
  //      between residential and arterial. Built as one smooth davit sweep,
  //      not the two straight elbows the pool had.
  {
    const PL = '#5c6368', PL_D = '#464b50', HD = '#666d73';
    const SH = 8.32, REACH = 1.98, RISE = 0.95;   // luminaire lands 2.42 m out, 9.1 m up
    const ax = (t) => [0, SH + RISE * Math.sin(t * Math.PI * 0.5), REACH * (1 - Math.cos(t * Math.PI * 0.5))];
    const parts = [
      box(0.34, 0.05, 0.34, PL_D, 0, 0, 0),
      cyl(0.125, 0.155, 0.42, PL_D, 0, 0.04, 0, 8),          // shoe base / bolt cover
      cyl(0.078, 0.122, SH - 0.46, PL, 0, 0.46, 0, 8),       // octagonal tapered shaft
    ];
    for (let i = 0; i < 5; i++) parts.push(strut(ax(i / 5), ax((i + 1) / 5), 0.062 - 0.004 * i, 0.062 - 0.004 * (i + 1), PL, 8));
    const [, hy, hz] = ax(1);
    parts.push(box(0.30, 0.16, 0.30, HD, 0, hy - 0.11, hz - 0.02));           // slipfitter
    parts.push(box(0.34, 0.135, 0.86, HD, 0, hy - 0.14, hz + 0.42));          // cobra housing
    parts.push(box(0.30, 0.055, 0.74, '#3d4247', 0, hy - 0.185, hz + 0.42));  // refractor rim
    G.lampCobra = { geo: merge(parts) };
    const lens = new THREE.BoxGeometry(0.26, 0.045, 0.62);
    lens.translate(0, hy - 0.20, hz + 0.42);
    G.lampCobraGlow = { geo: paint(lens, C('#ffd9a0')), glow: true };
  }
  // ---- "Bishop's Crook", the 1900s cast-iron NYC lamp post. NYC Street Design
  //      Manual: overall height 26'-3" (8.00 m), ductile-iron base column
  //      13'-11" (4.24 m), 4.5" (0.114 m) upper shaft, teardrop luminaire —
  //      and it is painted BLACK, not green. Restricted to historic districts.
  {
    const BLK = '#1d1f1e', BLK_D = '#121413';
    const parts = [
      cyl(0.235, 0.266, 0.16, BLK_D, 0, 0, 0, 8),
      cyl(0.175, 0.225, 0.52, BLK, 0, 0.16, 0, 8),           // ornamental base
      cyl(0.115, 0.155, 0.34, BLK_D, 0, 0.68, 0, 8),
      cyl(0.062, 0.108, 5.96, BLK, 0, 1.02, 0, 8),           // fluted shaft
      cyl(0.082, 0.082, 0.10, BLK_D, 0, 6.98, 0, 8),         // collar at the spring line
    ];
    const crook = new THREE.TorusGeometry(0.85, 0.040, 5, 14, Math.PI * 1.08);
    crook.rotateY(Math.PI / 2);
    crook.translate(0, 7.05, 0.85);
    parts.push(paint(crook, C(BLK)));
    const scroll = new THREE.TorusGeometry(0.17, 0.026, 4, 9);
    scroll.rotateY(Math.PI / 2);
    scroll.translate(0, 7.22, 0.36);
    parts.push(paint(scroll, C(BLK)));
    parts.push(cyl(0.038, 0.055, 0.14, BLK_D, 0, 6.86, 1.70, 6));            // luminaire hanger
    parts.push(cyl(0.135, 0.05, 0.40, '#e8e2cf', 0, 6.42, 1.70, 8));         // teardrop glass
    parts.push(cyl(0.15, 0.115, 0.11, BLK_D, 0, 6.78, 1.70, 8));             // hood
    G.lampCrook = { geo: merge(parts) };
    const bulb = sphere(0.11, '#ffe2b0', 0, 6.58, 1.70, 8);
    G.lampCrookGlow = { geo: bulb, glow: true };
  }
  // ---- NYC fire hydrant (per-instance colour: black / green / silver / red).
  //      Dry-barrel pattern: 0.86 m to the top of the bonnet, one 4.5" steamer
  //      nozzle facing the roadway (+z) and two 2.5" hose nozzles on the flanks,
  //      pentagon operating nut on the bonnet. Bonnet, caps and the base flange
  //      are painted brighter than 1.0 so they stay the lighter "silver top" the
  //      city paints on a black barrel once the instance tint multiplies through.
  {
    const CV = (v) => new THREE.Color(v, v, v);
    const lt = (g) => paint(g, CV(1.75));
    const parts = [
      cyl(0.145, 0.165, 0.09, '#ffffff', 0, 0, 0, 10),          // ground flange
      cyl(0.105, 0.125, 0.09, '#ffffff', 0, 0.09, 0, 10),
      cyl(0.098, 0.104, 0.44, '#ffffff', 0, 0.18, 0, 10),       // barrel
      cyl(0.122, 0.100, 0.10, '#ffffff', 0, 0.62, 0, 10),       // shoulder
      lt(cyl(0.115, 0.128, 0.055, '#ffffff', 0, 0.72, 0, 10)),  // bonnet flange
    ];
    const dome = new THREE.SphereGeometry(0.107, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.62, 1); dome.translate(0, 0.775, 0);
    parts.push(lt(dome));
    parts.push(lt(cyl(0.033, 0.042, 0.055, '#ffffff', 0, 0.84, 0, 5)));       // pentagon nut
    // steamer nozzle toward the roadway + two hose nozzles on the flanks
    parts.push(strut([0, 0.44, 0.085], [0, 0.44, 0.185], 0.072, 0.066, '#ffffff', 8, false));
    parts.push(lt(strut([0, 0.44, 0.185], [0, 0.44, 0.215], 0.079, 0.079, '#ffffff', 8, false)));
    for (const sx of [-1, 1]) {
      parts.push(strut([sx * 0.085, 0.50, 0], [sx * 0.175, 0.50, 0], 0.05, 0.046, '#ffffff', 7, false));
      parts.push(lt(strut([sx * 0.175, 0.50, 0], [sx * 0.20, 0.50, 0], 0.057, 0.057, '#ffffff', 7, false)));
    }
    G.hydrant = { geo: merge(parts), perInstanceColor: true };
  }
  // ---- NYC traffic signal, DOT type "M-2A" mast arm pole assembly.
  //      NYCDOT Specifications for Traffic Signals & ITS Systems + NYCDOT Traffic
  //      Signal Standard Drawings:
  //        §38.9  tapered OCTAGONAL shaft, 8.5" across the flats at the bottom,
  //               0.14"/ft taper to 6" at the top; shaft 18'-5.5", pole 20'-2"
  //        §38.4  curved mast arm, 3" Sch.40 pipe (3.5" OD), 20 ft on a 65 ft
  //               bend radius -> 13'-3" horizontal reach, ~0.42 m rise
  //        §38.2  cross arm + two 5/8" tie rods guying the arm off the pole top
  //               — the silhouette that makes a NYC signal a NYC signal
  //        SE-002 12" head 13.5"w x 40.5"h x 7"d, TUNNEL visor 16" long at a 7
  //               degree downward slope (§41: NYC never uses cap visors)
  //        SE-001 mast-arm head bottom 15'-7" (4.75 m) over the roadway, pole
  //               faces 10 ft LOW / 14 ft HIGH, pedestrian head 7'-6"
  //        §7.8.1/§7P.3.1/§64D  housings, visor exteriors and ped housings are
  //               Federal Yellow FS 595 13538, visor interiors flat black. NYC
  //               signals carry NO BACKPLATES — the word does not appear once in
  //               the whole DOT specification.
  //        §27B/P-017  APS push button station 14.25 x 5.5 x 2.5 in at 42",
  //               RAL 7040 window grey (plain buttons are FS 595A 14109 green)
  //      The lower 7 ft of every pole carries an insulating coat, which reads as
  //      a slightly different band at eye level.
  {
    const GRN = '#1d3226', GRN_D = '#12211a', GRN_L = '#26382c';   // pole / castings / insulating band
    const YEL = '#eda92c', YEL_D = '#c48a20';                       // FS 595 13538 as specified
    const LENS = [];                                                // [x, y, z, section]
    const head3 = (x, yTop, z, s = 1) => {
      const W = 0.343 * s, H = 1.029 * s, D = 0.178 * s, SEC = H / 3;
      const VL = 0.406 * s, VDY = VL * 0.122, VDZ = VL * 0.993;     // 16" visor, 7 deg down
      const p = [
        box(W + 0.085 * s, 0.05 * s, D + 0.02, YEL_D, x, yTop, z),
        box(W, H, D, YEL, x, yTop - H, z),
        box(W + 0.095 * s, 0.05 * s, D + 0.02, YEL_D, x, yTop - H - 0.05 * s, z),
      ];
      for (let i = 0; i < 3; i++) {
        const ly = yTop - SEC * (i + 0.5);
        p.push(strut([x, ly, z - D / 2], [x, ly - VDY, z - D / 2 - VDZ], 0.164 * s, 0.158 * s, YEL, 10));
        p.push(box(0.30 * s, 0.30 * s, 0.012, '#0a0b0d', x, ly - 0.15 * s, z - D / 2 - 0.012));
        // the lit lens sits near the MOUTH of the 16" tunnel, not down inside it:
        // seated at the housing face a tunnel visor hides the indication beyond
        // ~30 degrees off axis and the signal reads dead from the kerb.
        LENS.push([x, ly - VDY * 0.78, z - D / 2 - VDZ * 0.78, i, s]);
      }
      return p;
    };
    // 16"x18" pedestrian countdown head (§64D.3.3: 18.5" wide, 9" deep, 16 3/8"
    // tall), Federal Yellow. The lit faces belong to the signalPed glow pools.
    const pedHead = (x, y, z, ry) => {
      const g = merge([
        box(0.47, 0.476, 0.229, YEL, 0, 0, 0),
        box(0.50, 0.05, 0.30, YEL_D, 0, 0.476, 0.035),
        box(0.40, 0.40, 0.02, '#0a0b0d', 0, 0.04, 0.117),
        box(0.09, 0.09, 0.16, GRN, 0, 0.18, -0.15),
      ]);
      g.rotateY(ry); g.translate(x, y, z);
      return g;
    };
    const SH_TOP = 6.147, SPRING = 5.55, REACH = 4.05, RISE = 0.42;
    const armY = (t) => SPRING + RISE * Math.sin(t * Math.PI * 0.5);
    const armZ = (t) => 0.09 + REACH * t;
    const parts = [
      box(0.46, 0.06, 0.46, GRN_D, 0, 0, 0),                     // anchor base / bolt covers
      cyl(0.16, 0.205, 0.51, GRN, 0, 0.04, 0, 8),                // 16" square cast transformer base
      box(0.20, 0.32, 0.03, GRN_D, 0, 0.13, -0.16),              // base handhole door
      cyl(0.105, 0.117, 2.13, GRN_L, 0, 0.55, 0, 8),             // insulated lower 7 ft of shaft
      cyl(0.082, 0.105, SH_TOP - 2.68, GRN, 0, 2.68, 0, 8),      // octagonal tapered shaft
      cyl(0.092, 0.092, 0.05, GRN_D, 0, SH_TOP, 0, 8),           // pole cap "H2"
    ];
    for (let i = 0; i < 5; i++) {                                 // curved mast arm in 5 chords
      const t0 = i / 5, t1 = (i + 1) / 5;
      parts.push(strut([0, armY(t0), armZ(t0)], [0, armY(t1), armZ(t1)], 0.0445 - 0.002 * i, 0.0445 - 0.002 * (i + 1), GRN, 8));
    }
    parts.push(box(0.10, 0.16, 0.14, GRN_D, 0, SPRING - 0.09, 0.06));   // arm support hinge "F2A"
    // cross arm + the two 5/8" tie rods that guy the arm off the pole top
    parts.push(strut([-0.24, SH_TOP - 0.14, 0.02], [0.24, SH_TOP - 0.14, 0.02], 0.028, 0.028, GRN));
    parts.push(strut([-0.20, SH_TOP - 0.14, 0.03], [0, armY(0.9) - 0.04, armZ(0.9)], 0.013, 0.013, GRN_D, 5));
    parts.push(strut([0.20, SH_TOP - 0.14, 0.03], [0, armY(0.9) - 0.04, armZ(0.9)], 0.013, 0.013, GRN_D, 5));
    // main head off the arm: bottom 4.78 m over the roadway (SE-001 min 4.75)
    const HZ = armZ(0.96), HTOP = 5.81;
    parts.push(strut([0, armY(0.96) - 0.02, HZ], [0, HTOP + 0.05, HZ], 0.03, 0.03, GRN, 6));
    parts.push(box(0.15, 0.10, 0.15, GRN_D, 0, HTOP, HZ));             // suspension casting "K2A"
    parts.push(...head3(0, HTOP, HZ));
    // pole-mounted HIGH face (SE-001: 14 ft to the bottom of the housing)
    parts.push(strut([0.09, 4.90, 0.02], [0.31, 4.90, 0.24], 0.03, 0.03, GRN));
    parts.push(...head3(0.31, 5.30, 0.30, 0.92));
    // street name blade under the arm (9" x 30", green with a white border)
    parts.push(box(0.914, 0.229, 0.03, '#14663c', 0, armY(0.55) - 0.34, armZ(0.55)));
    parts.push(box(0.914, 0.028, 0.034, '#e6e9ea', 0, armY(0.55) - 0.115, armZ(0.55)));
    parts.push(box(0.914, 0.028, 0.034, '#e6e9ea', 0, armY(0.55) - 0.34, armZ(0.55)));
    parts.push(strut([0, armY(0.55) - 0.04, armZ(0.55)], [0, armY(0.55) - 0.34, armZ(0.55)], 0.015, 0.015, GRN, 5));
    // pedestrian countdowns at 7'-6", APS push button station at 42"
    // NOTE: no pedestrian heads on the mast pole. The compiler emits SIGNAL_PED
    // as its own furniture with its own lit pedHand/pedMan glow instances; a
    // decorative countdown head here could never light, and a dark ped signal
    // standing next to a working one reads as broken.
    parts.push(box(0.14, 0.362, 0.064, '#9da3a6', 0.15, 0.90, 0.11));
    parts.push(strut([0.15, 1.067, 0.142], [0.15, 1.067, 0.158], 0.026, 0.026, '#26292c', 8, false));
    parts.push(box(0.075, 0.075, 0.006, '#e8e8e4', 0.15, 1.14, 0.145));
    G.signalMast = { geo: merge(parts) };
    // 12" lenses in every tunnel visor of both heads. instancer.glowMat scales
    // its vertex colour by (0.25 + night * 2.4), so a colour of 1.0 renders at
    // 0.25 in daylight — below the bloom floor, which is why the lit lens was
    // invisible. These are real LED sources, so the peak channel is baked to
    // LGAIN: 0.78 by day (bloom picks it up), ~8 at night.
    const LGAIN = 3.1;
    const mk = (rgb, sec) => {
      const m = Math.max(rgb[0], rgb[1], rgb[2]);
      const col = new THREE.Color((rgb[0] / m) * LGAIN, (rgb[1] / m) * LGAIN, (rgb[2] / m) * LGAIN);
      return merge(LENS.filter((l) => l[3] === sec).map((l) => {
        const g = new THREE.SphereGeometry(0.152 * l[4], 10, 6);
        g.scale(1, 1, 0.5);
        g.translate(l[0], l[1], l[2]);
        return paint(g, col);
      }));
    };
    G.sigR = { geo: mk([1.0, 0.20, 0.13], 0), glow: true };
    G.sigA = { geo: mk([1.0, 0.66, 0.10], 1), glow: true };
    G.sigG = { geo: mk([0.17, 1.0, 0.45], 2), glow: true };
  }
  // ---- pedestrian signal on its own post: 16"x18" Federal Yellow housing
  //      (NYCDOT §64D.3.3 — 18.5" wide, 9" deep, 16 3/8" tall) with its bottom
  //      at 7'-6" (SE-001), and the RAL 7040 grey APS push button station at
  //      42" (§27B / drawing P-017)
  {
    const GRN = '#1d3226', GRN_D = '#12211a', YEL = '#eda92c', YEL_D = '#c48a20';
    const parts = [
      box(0.30, 0.05, 0.30, GRN_D, 0, 0, 0),
      cyl(0.10, 0.13, 0.32, GRN, 0, 0.04, 0, 8),                  // base collar
      cyl(0.084, 0.098, 2.13, '#334a3a', 0, 0.36, 0, 8),          // insulated lower 7 ft
      cyl(0.062, 0.084, 0.62, GRN, 0, 2.49, 0, 8),                // octagonal post
      cyl(0.07, 0.07, 0.04, GRN_D, 0, 3.11, 0, 8),
      box(0.47, 0.476, 0.229, YEL, 0, 2.286, 0.02),               // countdown housing
      box(0.50, 0.05, 0.30, YEL_D, 0, 2.762, 0.055),              // hood
      box(0.40, 0.40, 0.02, '#0a0b0d', 0, 2.326, 0.137),          // dark face
      box(0.14, 0.362, 0.064, '#9da3a6', 0, 0.90, 0.11),          // APS station
      box(0.075, 0.075, 0.006, '#e8e8e4', 0, 1.14, 0.145),
    ];
    parts.push(strut([0, 1.067, 0.142], [0, 1.067, 0.158], 0.026, 0.026, '#26292c', 8, false));
    G.signalPed = { geo: merge(parts) };
    // MUTCD §4I.04: Portland orange upraised hand / white walking person, both
    // on the face toward the crossing they control (+z). Baked past the glow
    // material's 0.25 daylight scale so a lit face reads by day and blooms at
    // night (see the LGAIN note on the vehicle lenses).
    const PGAIN = 3.1;
    const face = (r, g0, b) => {
      const m = Math.max(r, g0, b);
      const g = new THREE.PlaneGeometry(0.34, 0.32);
      g.translate(0, 2.50, 0.15);
      return paint(g, new THREE.Color((r / m) * PGAIN, (g0 / m) * PGAIN, (b / m) * PGAIN));
    };
    G.pedHand = { geo: face(1.0, 0.42, 0.10), glow: true };
    G.pedMan = { geo: face(0.93, 0.97, 1.0), glow: true };
  }
  // ------------------------------------------------------------------- SG13
  // NYC SIGNAL REBUILD (docs/notes/signals-r13.md, ?sg13=0 keeps the two blocks
  // above). Owner 2026-09-16: "traffic lights don't look correct" — the ad
  // plates show mast heads with all three lenses apparently lit.
  //
  // WHAT WAS ACTUALLY WRONG. Nothing was emissive and the state machine was
  // fine: the VISOR was a closed cone 0.406 m long and 0.33 m across on a
  // 0.343 x 0.178 m housing, painted Federal Yellow inside AND out. Three
  // sunlit cones ARE three lit lenses to the eye, and they swallowed the
  // housing so completely that the head read as three drums on a stick. The lit
  // lens was a flat saucer parked at the MOUTH of that cone, and an unlit
  // section was a black plate 0.31 m down a yellow tunnel — never glass.
  // (NYCDOT §7.8.1 already said the visor interior is flat black; the comment
  // said so, the geometry did not.)
  //
  // WHAT THIS BUILDS. Four pools instead of one, so the arm can stretch to the
  // street it crosses and each head can be aimed at the traffic it stops:
  //   signalMast  pole, base, cross arm, pole bracket, APS station  (fixed)
  //   signalArm   the curved arm + tie rods + hanger, authored at SG13_ARM.ref
  //               and Z-scaled by reach/ref (assemble.js reads the crossed
  //               width the compiler already ships as FURN.SIGNAL_MAST p0)
  //   signalHead  ONE 12 in three-section head, lenses on +Z, claimed once per
  //               head so the hung face and the pole face can be aimed
  //   signalLens  that head's three DARK lenses, on their own low-roughness
  //               material (instancer.lensMat): an unlit LED lens is glass with
  //               a sky in it, which roughness 0.82 street furniture cannot be
  // sigR/sigA/sigG now carry ONE lit lens each and are claimed per HEAD, so the
  // sim lights one section of one head and every other lens stays dark glass.
  if (SG13) {
    const GRN = '#20362a', GRN_D = '#14231b', GRN_L = '#2b3f31';    // pole / castings / insulating band
    const YEL = '#dfa32e', YEL_D = '#b3801e';                       // FS 595 13538 Federal Yellow
    const BLK = '#0a0c0b', GLS = '#0c110f', GRY = '#9da3a6';
    const W = 0.343, HH = 1.029, DD = 0.178, SEC = HH / 3;          // SE-002: 13.5 x 40.5 x 7 in
    const VL = 0.235, VR0 = 0.160, VR1 = 0.175, LR = 0.152;         // tunnel visor (flared), 12 in lens
    const SH_TOP = 6.15;                                            // §38.9 shaft 18'-5.5"
    const secY = (i) => -SEC * (i + 0.5);                           // head origin = top of the housing
    // reverse winding + normals so a single-wall tube can carry one colour
    // outside and another inside for the price of a second 24-triangle shell.
    const flipG = (g) => {
      const ix = g.index;
      if (ix) { const a = ix.array; for (let i = 0; i < a.length; i += 3) { const t = a[i]; a[i] = a[i + 2]; a[i + 2] = t; } }
      const nr = g.attributes.normal;
      if (nr) { const a = nr.array; for (let i = 0; i < a.length; i++) a[i] = -a[i]; }
      return g;
    };
    // open tube along +Z, z0 -> z0+len, centred on (0, y)
    const ztube = (rT, rM, len, z0, y, hex, seg = 12) => {
      const g = new THREE.CylinderGeometry(rM, rT, len, seg, 1, true);
      g.rotateX(Math.PI / 2); g.translate(0, y, z0 + len / 2);
      return paint(g, C(hex));
    };
    // shallow lens dome facing +Z: rim radius rr in the plane z, apex at z + h
    const dome = (rr, h, z, y, hex, seg = 12) => {
      const g = new THREE.SphereGeometry(1, seg, 2, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(rr, h, rr); g.rotateX(Math.PI / 2); g.translate(0, y, z);
      return paint(g, C(hex));
    };
    // ---- the head. Origin at the top face of the housing so the same geometry
    //      hangs off an arm hanger and bolts to a pole bracket.
    const hp = [
      cyl(0.036, 0.036, 0.085, GRN_D, 0, 0, 0, 6),                        // mounting lug
      box(W + 0.022, 0.040, DD + 0.022, YEL_D, 0, -0.040, 0),             // top hood
      box(W, HH, DD, YEL, 0, -HH, 0),                                     // housing (NO backplate: NYC never uses one)
      box(W + 0.030, 0.034, DD + 0.026, YEL_D, 0, -HH - 0.034, 0),        // bottom hood
      box(0.030, HH - 0.06, 0.038, YEL_D, -W / 2 - 0.013, -HH + 0.03, 0.022),   // door hinge spine
      box(0.030, HH - 0.06, 0.038, YEL_D, W / 2 + 0.013, -HH + 0.03, 0.022),    // latch spine
      box(W + 0.008, 0.016, DD + 0.008, YEL_D, 0, -SEC - 0.008, 0),       // section joints
      box(W + 0.008, 0.016, DD + 0.008, YEL_D, 0, -2 * SEC - 0.008, 0),
    ];
    for (let i = 0; i < 3; i++) {
      const ly = secY(i);
      hp.push(box(0.318, 0.318, 0.014, BLK, 0, ly - 0.159, DD / 2 + 0.005));           // flat-black door aperture
      hp.push(ztube(VR0, VR1, VL, DD / 2 + 0.010, ly, YEL, 12));                       // visor, Federal Yellow outside
      hp.push(flipG(ztube(VR0 - 0.009, VR1 - 0.009, VL - 0.004, DD / 2 + 0.010, ly, BLK, 12)));  // ...flat black inside
    }
    G.signalHead = { geo: merge(hp) };
    // ---- the three dark lenses (own pool, own material). Slightly domed so the
    //      sky slides across them as the camera moves, which is the whole tell
    //      that a dark signal lens is glass and not a painted disc.
    G.signalLens = { geo: merge([0, 1, 2].map((i) => dome(LR, 0.020, DD / 2 + 0.012, secY(i), GLS))) };
    // ---- the lit lens, one pool per indication, ONE section each.
    //      instancer.glowMat scales vertex colour by (0.25 + night * 2.4), so a
    //      1.0 colour renders at 0.25 by day — under the bloom floor, which is
    //      why the lit lens used to be invisible in daylight. These are LED
    //      sources: bake the peak channel at LGAIN (0.8 by day, ~8.5 at night).
    const LGAIN = 3.2;
    const litSec = (rgb, i) => {
      const m = Math.max(rgb[0], rgb[1], rgb[2]);
      const col = new THREE.Color((rgb[0] / m) * LGAIN, (rgb[1] / m) * LGAIN, (rgb[2] / m) * LGAIN);
      const ly = secY(i);
      // A tunnel visor hides the lens itself past ~10 degrees off axis, which is
      // why the old kit parked the lit lens at the visor MOUTH (and got a saucer
      // stuck on a drum). What a real lit signal shows from the kerb is the
      // visor INTERIOR washed by the lamp, so that is what this draws: the lens
      // dome plus an inward-facing cone of spill just inside the black liner, at
      // a third of the lens value. Off axis the indication is a glowing tunnel;
      // head on it is a lens. Both collapse with the same instance scale.
      const spill = flipG(ztube(0.147, 0.158, 0.160, DD / 2 + 0.014, ly, '#ffffff', 12));
      return merge([paint(dome(LR - 0.004, 0.026, DD / 2 + 0.022, ly, '#ffffff'), col),
        paint(spill, new THREE.Color(col.r * 0.34, col.g * 0.34, col.b * 0.34))]);
    };
    G.sigR = { geo: litSec([1.0, 0.10, 0.06], 0), glow: true };
    G.sigA = { geo: litSec([1.0, 0.58, 0.05], 1), glow: true };
    G.sigG = { geo: litSec([0.07, 1.0, 0.46], 2), glow: true };
    // ---- the arm: §38.4 3 in Sch.40 pipe on a long bend radius. Authored at
    //      SG13_ARM.ref of horizontal reach and Z-scaled in assemble.js; the
    //      head is NOT in this pool, so stretching the arm never stretches a
    //      lens or a visor.
    const R0 = SG13_ARM.ref, SPRING = 5.60, RISE = 0.46, TIPT = 0.985;
    const armY = (t) => SPRING + RISE * Math.sin(t * Math.PI * 0.5);
    const armZ = (t) => 0.10 + R0 * t;
    const ap = [box(0.10, 0.17, 0.15, GRN_D, 0, SPRING - 0.10, 0.05)];              // arm support hinge "F2A"
    for (let i = 0; i < 6; i++) {
      const t0 = i / 6, t1 = (i + 1) / 6;
      ap.push(strut([0, armY(t0), armZ(t0)], [0, armY(t1), armZ(t1)], 0.0455 - 0.0022 * i, 0.0455 - 0.0022 * (i + 1), GRN, 8));
    }
    for (const sx of [-0.20, 0.20]) {                                                // §38.2 5/8 in tie rods
      ap.push(strut([sx, SH_TOP - 0.16, 0.03], [0, armY(0.62) - 0.035, armZ(0.62)], 0.014, 0.014, GRN_D, 5));
    }
    const TZ = armZ(TIPT);
    ap.push(strut([0, armY(TIPT) - 0.02, TZ], [0, SG13_ARM.headY + 0.025, TZ], 0.032, 0.032, GRN, 6));
    ap.push(cyl(0.062, 0.080, 0.072, GRN_D, 0, SG13_ARM.headY - 0.005, TZ, 8));      // suspension casting "K2A"
    G.signalArm = { geo: merge(ap) };
    // ---- the pole. No street-name blade: the compiler already stands a
    //      FURN.STREET_SIGN on this very corner point, and the old kit hung a
    //      second one off the arm.
    const pp = [
      box(0.46, 0.06, 0.46, GRN_D, 0, 0, 0),                          // anchor base / bolt covers
      cyl(0.16, 0.205, 0.51, GRN, 0, 0.04, 0, 8),                     // 16 in cast transformer base
      box(0.20, 0.32, 0.03, GRN_D, 0, 0.13, -0.17),                   // base handhole door
      cyl(0.108, 0.120, 2.13, GRN_L, 0, 0.55, 0, 8),                  // insulated lower 7 ft
      cyl(0.084, 0.108, SH_TOP - 2.68, GRN, 0, 2.68, 0, 8),           // §38.9 tapered octagonal shaft
      cyl(0.094, 0.094, 0.055, GRN_D, 0, SH_TOP, 0, 8),               // pole cap "H2"
      strut([-0.25, SH_TOP - 0.16, 0.02], [0.25, SH_TOP - 0.16, 0.02], 0.028, 0.028, GRN),   // guy cross arm
      // SE-001 pole face: bottom of the housing at 14 ft, bracketed clear of the shaft
      strut([0, SG13_ARM.poleY + 0.062, 0.085], [0, SG13_ARM.poleY + 0.062, SG13_ARM.poleZ], 0.030, 0.030, GRN, 6),
      cyl(0.052, 0.064, 0.055, GRN_D, 0, SG13_ARM.poleY + 0.030, SG13_ARM.poleZ, 8),
      box(0.14, 0.362, 0.064, GRY, 0.15, 0.90, 0.11),                 // §27B APS station at 42 in
      box(0.075, 0.075, 0.006, '#e8e8e4', 0.15, 1.14, 0.145),
    ];
    pp.push(strut([0.15, 1.067, 0.142], [0.15, 1.067, 0.158], 0.026, 0.026, '#26292c', 8, false));
    G.signalMast = { geo: merge(pp) };
    // ---- pedestrian head: same tunnel-visor treatment, and the MUTCD §4I.04
    //      indications as GEOMETRY. A solid lit rectangle is not a hand and not
    //      a walking person, and at 8 m that is the only thing anyone reads.
    const PY = 2.286, PF = 0.02 + 0.229 / 2;                          // §64D.3.3 housing bottom / face plane
    const pp2 = [
      box(0.30, 0.05, 0.30, GRN_D, 0, 0, 0),
      cyl(0.10, 0.13, 0.32, GRN, 0, 0.04, 0, 8),                      // base collar
      cyl(0.086, 0.100, 2.13, GRN_L, 0, 0.36, 0, 8),                  // insulated lower 7 ft
      cyl(0.064, 0.086, 0.74, GRN, 0, 2.49, 0, 8),                    // octagonal post
      cyl(0.072, 0.072, 0.045, GRN_D, 0, 3.23, 0, 8),
      box(0.47, 0.476, 0.229, YEL, 0, PY, 0.02),                      // countdown housing
      box(0.535, 0.044, 0.410, YEL_D, 0, PY + 0.476, 0.100),          // hood over the visor
      box(0.415, 0.415, 0.016, BLK, 0, PY + 0.030, PF + 0.006),       // dark face
      box(0.14, 0.362, 0.064, GRY, 0, 0.90, 0.11),                    // APS station
      box(0.075, 0.075, 0.006, '#e8e8e4', 0, 1.14, 0.145),
    ];
    for (const sx of [-1, 1]) pp2.push(box(0.022, 0.32, 0.172, YEL_D, sx * 0.244, PY + 0.156, PF + 0.086));  // visor cheeks
    pp2.push(strut([0, 1.067, 0.142], [0, 1.067, 0.158], 0.026, 0.026, '#26292c', 8, false));
    G.signalPed = { geo: merge(pp2) };
    // The lit face is 0.415 m square from PY+0.030; an indication that does not
    // fill ~0.27 m of it is a blob, not a symbol. `IY` is the icon baseline.
    const PGAIN = 3.2, IZ = PF + 0.026, IY = PY + 0.108;
    const bake = (parts, r, g0, b) => {
      const m = Math.max(r, g0, b), col = new THREE.Color((r / m) * PGAIN, (g0 / m) * PGAIN, (b / m) * PGAIN);
      return merge(parts.map((q) => paint(q, col)));
    };
    const limb = (x1, y1, x2, y2, rr) => strut([x1, IY + y1, IZ], [x2, IY + y2, IZ], rr, rr, '#ffffff', 5, false);
    // upraised hand: heel, palm, four fingers off the palm top, thumb
    const hand = [
      box(0.104, 0.046, 0.022, '#ffffff', 0.025, IY + 0.000, IZ),
      box(0.150, 0.104, 0.022, '#ffffff', 0.025, IY + 0.040, IZ),
      limb(-0.027, 0.140, -0.029, 0.246, 0.0175), limb(0.008, 0.140, 0.009, 0.266, 0.0175),
      limb(0.043, 0.140, 0.045, 0.262, 0.0175), limb(0.076, 0.140, 0.081, 0.230, 0.0175),
      limb(-0.030, 0.056, -0.085, 0.134, 0.0190),
    ];
    // walking person: head, torso, two legs, two arms (MUTCD stride)
    const man = [
      sphere(0.030, '#ffffff', -0.006, IY + 0.244, IZ, 8),
      limb(0.004, 0.214, -0.014, 0.126, 0.026),
      limb(-0.014, 0.126, -0.072, 0.056, 0.019), limb(-0.072, 0.056, -0.082, -0.008, 0.016),
      limb(-0.014, 0.126, 0.046, 0.058, 0.019), limb(0.046, 0.058, 0.074, 0.002, 0.016),
      limb(0.000, 0.198, -0.070, 0.136, 0.015), limb(0.000, 0.198, 0.062, 0.148, 0.015),
    ];
    G.pedHand = { geo: bake(hand, 1.0, 0.42, 0.10), glow: true };     // Portland orange
    G.pedMan = { geo: bake(man, 0.93, 0.97, 1.0), glow: true };       // white
  }
  // ---- street name sign (two crossed green blades)
  {
    const pole = cyl(0.05, 0.07, 3.4, '#4c5358', 0, 0, 0, 6);
    const bladeA = box(2.1, 0.26, 0.03, '#1a7a3c', 0.6, 3.05, 0);
    const bladeB = box(0.03, 0.26, 1.7, '#1a7a3c', 0, 3.32, 0.45);
    const edgeA = box(2.1, 0.035, 0.032, '#e8e8e8', 0.6, 3.29, 0);
    const edgeB = box(0.032, 0.035, 1.7, '#e8e8e8', 0, 3.56, 0.45);
    G.streetSign = { geo: merge([pole, bladeA, bladeB, edgeA, edgeB]) };
  }
  // ---- the classic DSNY green wire-mesh litter basket. DSNY press release
  //      26-028 gives the only published figures: "roughly 28 inches tall with a
  //      diameter at the top of 21.5 inches" -> 0.711 m x 0.546 m, ~30 lb. The
  //      design is essentially unchanged since the 1930s; ~13,000 are still wire.
  {
    const GRN = '#1c3a20', GRN_D = '#10240f';
    const R0 = 0.232, R1 = 0.273, H = 0.711, N = 18;
    const parts = [
      cyl(R0 - 0.02, R0 - 0.03, 0.02, '#15200f', 0, 0.06, 0, 12),               // debris floor
      strut([0, 0.05, 0], [0, H, 0], R0 - 0.015, R1 - 0.015, '#101a12', 12),    // dark liner behind the wires
    ];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      parts.push(strut([c * R0, 0.04, s * R0], [c * R1, H, s * R1], 0.011, 0.011, GRN, 4));
    }
    for (const [y, r, rr] of [[0.06, R0 + 0.004, 0.013], [0.38, 0.255, 0.011], [H - 0.02, R1 + 0.006, 0.018]]) {
      parts.push(strut([0, y, 0], [0, y + rr * 1.6, 0], r, r, GRN_D, 14));      // hoops
    }
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      parts.push(box(0.05, 0.045, 0.05, GRN_D, Math.cos(a) * R0, 0, Math.sin(a) * R0));
    }
    G.litter = { geo: merge(parts) };
  }
  // ---- USPS relay box
  {
    const body = box(0.62, 0.9, 0.62, '#2a4a8a', 0, 0.18, 0);
    const cap = cyl(0.32, 0.32, 0.28, '#2a4a8a', 0, 1.08, 0, 10);
    cap.scale(1, 1, 0.97);
    const legs = box(0.5, 0.18, 0.5, '#222831');
    G.mailbox = { geo: merge([legs, body, cap]) };
  }
  // ---- bus shelter, the Grimshaw/Cemusa "regular" configuration now run by
  //      JCDecaux. NYC Street Design Manual: every configuration is 8'-11"
  //      (2.718 m) overall; "regular" is 14 x 5 ft (4.267 x 1.524 m); the end
  //      ad case is the OAAA junior poster, 69 x 48 in (1.753 x 1.219 m).
  //      The compiler's faceRoad rot puts local +z ALONG the street, so the
  //      long axis runs in z (the old pool ran it in x, i.e. straight across
  //      the sidewalk into the roadway).
  //      Neither the canopy nor the walls are solid: the canopy is glass on an
  //      extruded aluminium roof beam — an opaque slab drops a solid black
  //      rectangle on the roadway, which is the one thing a glass roof never
  //      does — and the walls are glass in slim frames, so they are built as
  //      frames and mullions rather than as white panels.
  {
    const AL = '#454b50', AL_D = '#31363a', GL = '#63737f';
    const H = 2.718, LZ = 2.134, LX = 0.762;
    const parts = [];
    for (const z of [-LZ + 0.12, LZ - 0.12]) for (const x of [LX - 0.14, -LX + 0.14]) parts.push(pipe(0.055, H - 0.12, AL, x, 0, z, 8));
    // canopy: perimeter frame + rafters -> a striped shadow, not a slab
    parts.push(box(0.10, 0.11, 2 * LZ, AL, LX - 0.05, H - 0.11, 0), box(0.10, 0.11, 2 * LZ, AL, -LX + 0.05, H - 0.11, 0));
    parts.push(box(2 * LX - 0.1, 0.11, 0.10, AL, 0, H - 0.11, LZ - 0.05), box(2 * LX - 0.1, 0.11, 0.10, AL, 0, H - 0.11, -LZ + 0.05));
    for (let i = 0; i < 6; i++) parts.push(box(2 * LX - 0.12, 0.06, 0.055, AL_D, 0, H - 0.08, -1.78 + i * 0.71));
    // narrow lighting spine over the seat only
    parts.push(box(0.30, 0.045, 2 * LZ - 0.2, AL_D, -0.42, H - 0.05, 0));
    // glazed back and one end: frames and mullions, so you see through them
    for (const [x, z0, z1] of [[-LX + 0.09, -LZ + 0.17, LZ - 0.17]]) {
      parts.push(box(0.05, 0.055, z1 - z0, AL, x, 2.24, (z0 + z1) / 2), box(0.05, 0.055, z1 - z0, AL, x, 0.38, (z0 + z1) / 2));
      for (let i = 0; i <= 4; i++) parts.push(box(0.04, 1.86, 0.05, GL, x, 0.38, z0 + (z1 - z0) * i / 4));
    }
    parts.push(box(2 * LX - 0.30, 0.055, 0.05, AL, 0, 2.24, LZ - 0.10), box(2 * LX - 0.30, 0.055, 0.05, AL, 0, 0.38, LZ - 0.10));
    parts.push(box(0.05, 1.86, 0.04, GL, 0, 0.38, LZ - 0.10));
    // perch bench along the back
    parts.push(box(0.30, 0.06, 2.7, '#5b6167', -0.42, 0.60, -0.3));
    parts.push(box(0.28, 0.60, 0.06, AL_D, -0.42, 0, -1.5), box(0.28, 0.60, 0.06, AL_D, -0.42, 0, 0.9));
    // backlit ad case at the far end (69 x 48 in) — the one solid element
    parts.push(box(1.30, 1.95, 0.10, AL_D, 0, 0.34, -LZ + 0.06));
    G.busShelter = { geo: merge(parts) };
    // The backlit junior poster. It was a flat `#cfe6ff` quad, and `glowMat`
    // scales a glow pool by (0.25 + night * 2.4), so by day it rendered at a
    // QUARTER value — a blank grey rectangle, which is exactly how the critic
    // reported it (round 5 §7.8, "a bus shelter with a blank grey ad panel").
    // Real poster art off the shared atlas, on the panel-glow material whose
    // day/night curve suits printed art in a lit case.
    const ad = new THREE.PlaneGeometry(1.219, 1.753);
    ad.rotateY(Math.PI);
    ad.translate(0, 1.31, -LZ + 0.005);
    G.busShelterGlow = { geo: atlasUV(paint(ad, C('#ffffff')), 'shelterAd'), glow: true, tex: true };
  }

  // ---- NYC subway street stair. The compiler's faceRoad rot is built from the
  //      road TANGENT (rot = atan2(dirx, dirz) in compile.mjs), so for this pool
  //      local +z runs ALONG the street and local +x crosses it: the stair
  //      therefore runs in z, parallel to the curb, and the module is kept
  //      symmetric in x because which side of it is the curb is a coin flip.
  //      Descends toward -z, entry at +z.
  //      Everything below the sidewalk slab is invisible — the slab is opaque
  //      and cannot be carved — so the hole is read the way it reads in life:
  //      granite coping, a near-black void, nosings dropping into it, the
  //      cast-iron guard all round, and the globe lamps at the head.
  //      ZR §37-41: new street stairs >= 8 ft (2.44 m) wide, max 14 risers per
  //      flight. NYC subway stair standard is 7" rise / 11" tread (Rapid Transit
  //      Station Design, 1920) — 0.279 m nosing pitch. NYC BC §1015.3: guard
  //      1.067 m (42") above the walking surface, §1015.4: no 4" sphere through
  //      the balusters. Granite curb per DDC Std Spec §2.12 (medium grey).
  //      Globe: green = open entrance, red = exit only / restricted (the 1982
  //      three-colour scheme lost its yellow after MetroCard).
  {
    const GRN = '#0f2c1c', GRN_D = '#081a10', GRAN = '#6a6862';
    const LZ = 2.75, LX = 1.20;      // half length of the opening / half width
    const RH = 1.067, RB = 0.16;     // guard height, bottom-rail height
    const parts = [];
    // granite guard curb around three sides of the opening
    parts.push(box(0.20, 0.16, 2 * LZ + 0.4, GRAN, LX + 0.10, 0, 0));
    parts.push(box(0.20, 0.16, 2 * LZ + 0.4, GRAN, -LX - 0.10, 0, 0));
    parts.push(box(2 * LX, 0.16, 0.20, GRAN, 0, 0, -LZ - 0.10));
    // the flight itself: 14 steps at the 11" tread, lit treads over dark risers,
    // the whole value ramp falling away so it reads as a stair dropping under
    // the sidewalk. A flat black slab does not work here — pool geometry takes
    // the full sky term without the ground AO, so a #090b0d floor measured
    // #7c8b88 on the shot.
    parts.push(hplate(2 * LX, 2 * LZ, '#0b0d10', 0, 0.012, 0));
    for (let i = 0; i < 14; i++) {
      const t = Math.max(0x0f, Math.round(150 - i * 10)).toString(16).padStart(2, '0');
      const r = Math.max(0x07, Math.round(56 - i * 4)).toString(16).padStart(2, '0');
      const z0 = LZ - 0.13 - i * 0.279;
      parts.push(hplate(2 * LX - 0.05, 0.185, '#' + t + t + t, 0, 0.055, z0));
      parts.push(vplate(2 * LX - 0.05, 0.075, '#' + r + r + r, 0, 0.05, z0 - 0.093));
    }
    // cast-iron guard: newels, heavy rounded top rail, bottom rail, balusters
    //
    // BALUSTER LOD (docs/notes/glitch-r7.md 3.2). 20 mm stock at 0.17 m centres
    // is 1.18 px wide on a 10.5 px pitch at 25 m in a 1920 frame (f = 1478 px),
    // and there are two ranks 2.44 m apart, so the far one beats against the
    // near one. The renderer is `antialias: false` with 2x MSAA on the scene RT
    // and TAA jitter switched OFF whenever the camera moves (engine.js:1010,
    // `movingNow = dp > 0.012 m`), so nothing resolves a 1 px member: its
    // coverage flips frame to frame and the whole rail band boils. Measured: the
    // 8 worst 32x32 tiles of `fMarkings` are all on this guard, rms 20-45 of 255
    // (tools/tflick.mjs). This is the single strongest motion artefact in the
    // street framings.
    // The fix is the geometric equivalent of a mip level: beyond LOD_D, half as
    // many balusters at DOUBLE the stock — 0.040/0.34 = 0.020/0.17 = 11.76 %, the
    // SAME ink per metre of rail, so the band keeps its tone and its
    // transparency and no LOD pop changes the value. Half the members means half
    // the silhouette edges, and each is 2 px instead of 1, which is the
    // difference between a member that dims and one that vanishes.
    const BAL_P = 0.17, BAL_S = 0.020;         // near: NYC BC 1015.4 spacing
    const BAL_LP = 0.34, BAL_LS = 0.040;       // far: same ink, half the edges
    const BAL_LOD_D = GFIX ? 20 : 1e9;         // metres; fine stock is sub-pixel past ~30
    const bal = [], balL = [];
    const run = (x1, z1, x2, z2) => {
      const L = Math.hypot(x2 - x1, z2 - z1), ux = (x2 - x1) / L, uz = (z2 - z1) / L;
      parts.push(strut([x1, RH, z1], [x2, RH, z2], 0.029, 0.029, GRN, 8));
      parts.push(strut([x1, RB, z1], [x2, RB, z2], 0.018, 0.018, GRN_D, 5));
      const nP = Math.max(2, Math.round(L / 1.5));
      for (let i = 0; i <= nP; i++) parts.push(pipe(0.036, RH, GRN, x1 + ux * (L * i / nP), 0.10, z1 + uz * (L * i / nP), 6));
      const balusters = (pitch, stock, out) => {
        const nK = Math.round(L / pitch);
        for (let i = 1; i < nK; i++) {
          const t = (L * i) / nK;
          out.push(box(stock, RH - RB - 0.02, stock, GRN, x1 + ux * t, RB, z1 + uz * t));
        }
      };
      balusters(BAL_P, BAL_S, bal);
      balusters(BAL_LP, BAL_LS, balL);
    };
    run(LX + 0.02, LZ, LX + 0.02, -LZ);
    run(-LX - 0.02, LZ, -LX - 0.02, -LZ);
    run(LX + 0.02, -LZ - 0.02, -LX - 0.02, -LZ - 0.02);
    // cast-iron globe lamp posts flanking the head of the stair
    for (const x of [LX + 0.02, -LX - 0.02]) {
      parts.push(cyl(0.088, 0.125, 0.32, GRN_D, x, 0, LZ, 8));
      parts.push(pipe(0.052, 2.18, GRN, x, 0.32, LZ, 8));
      parts.push(cyl(0.072, 0.060, 0.09, GRN, x, 2.50, LZ, 8));    // globe seat
      parts.push(cyl(0.02, 0.042, 0.09, GRN_D, x, 2.80, LZ, 6));   // finial
    }
    // NYCTA street entrance sign (Graphics Standards Manual, Station Type 1):
    // 2 ft x 4 ft overall, white on black since 1973, black bar over each panel
    parts.push(box(1.22, 0.61, 0.05, '#101215', 0, 1.52, LZ));
    parts.push(box(1.22, 0.041, 0.062, '#26292d', 0, 2.09, LZ));
    parts.push(box(0.86, 0.10, 0.062, '#e9edf0', 0, 1.83, LZ));
    parts.push(box(0.13, 0.13, 0.062, '#e9edf0', -0.36, 1.60, LZ));
    parts.push(box(0.13, 0.13, 0.062, '#e9edf0', -0.14, 1.60, LZ));
    // a blade sign on each railing facing ACROSS the sidewalk. The panel at the
    // head faces along the kerb, which is edge-on from the roadway — and the
    // sign is the one thing that says "subway", so it has to read from both
    // approaches (real entrances carry several).
    for (const sx of [1, -1]) {
      parts.push(box(0.05, 0.46, 0.92, '#101215', sx * (LX + 0.09), 1.28, LZ - 0.85));
      parts.push(box(0.062, 0.031, 0.92, '#26292d', sx * (LX + 0.09), 1.70, LZ - 0.85));
      parts.push(box(0.062, 0.085, 0.64, '#e9edf0', sx * (LX + 0.09), 1.50, LZ - 0.85));
    }
    // half-moon globe (the mid-1990s pattern): milky white bottom in the lit
    // pool so it reads as glass by day, coloured top in the glow pool
    const halfGlobe = (x, up, hex) => {
      const g = new THREE.SphereGeometry(0.133, 10, 5, 0, Math.PI * 2, up ? 0 : Math.PI / 2, Math.PI / 2);
      g.translate(x, 2.66, LZ);
      return paint(g, C(hex));
    };
    parts.push(halfGlobe(LX + 0.02, false, '#dfe6e0'), halfGlobe(-LX - 0.02, false, '#dfe6e0'));
    // everything except the balusters is shared by both levels; merge() disposes
    // what it consumes, so the far level gets clones
    const shared = parts.map((g) => g.clone());
    G.subway = { geo: merge([...parts, ...bal]), lod: { geo: merge([...shared, ...balL]), dist: BAL_LOD_D } };
    G.subwayGlow = { geo: merge([
      halfGlobe(LX + 0.02, true, '#43d47a'), halfGlobe(-LX - 0.02, true, '#43d47a'),
    ]), glow: true };
  }
  // ---- LinkNYC kiosk (NYC Street Design Manual / LinkNYC): 9'-6" (2.896 m)
  //      tall, faces 35 x 11 in (0.889 x 0.279 m), one 55" 1080p portrait
  //      display per face, aluminium and glass shell with integrated LED
  {
    const BODY = '#31363a', DK = '#15181a', AL = '#8d949a';
    G.linknyc = { geo: merge([
      box(0.35, 0.09, 0.95, DK, 0, 0, 0),                       // plinth
      box(0.279, 2.72, 0.889, BODY, 0, 0.09, 0),                // slab
      box(0.292, 0.22, 0.90, DK, 0, 2.50, 0),                   // header band
      box(0.31, 0.086, 0.92, AL, 0, 2.72, 0),                   // cap
      box(0.29, 1.42, 0.762, DK, 0, 0.98, 0),                   // display bezels (both faces)
      box(0.20, 0.30, 0.03, DK, 0, 0.82, 0.445),                // tablet niche
      box(0.15, 0.05, 0.02, AL, 0, 0.72, 0.45),
    ]) };
    // The two 55" portrait displays. They were flat `#9fd8ff` quads at the glow
    // material's 0.25 daylight scale, i.e. mid-grey by day: the critic's "blank
    // grey kiosk panels" (round 5 defect 19), reported in three frames. One face
    // now carries an ad, the other a wayfinding/transit panel, both off the
    // shared street-furniture atlas.
    const p1 = new THREE.PlaneGeometry(0.686, 1.22); p1.rotateY(Math.PI / 2); p1.translate(0.152, 1.02, 0);
    const p2 = new THREE.PlaneGeometry(0.686, 1.22); p2.rotateY(-Math.PI / 2); p2.translate(-0.152, 1.02, 0);
    G.linknycGlow = { geo: merge([
      atlasUV(paint(p1, C('#ffffff')), 'kioskAd'),
      atlasUV(paint(p2, C('#ffffff')), 'kioskInfo'),
    ]), glow: true, tex: true };
  }
  // ---- newsstand. The front panel was a blank `#cfd6da` box; it carries the
  //      headline/lotto board every NYC newsstand has.
  {
    const board = new THREE.PlaneGeometry(2.4, 0.5); board.translate(0, 1.75, 1.006);
    G.newsstand = { geo: merge([
      blankUV(box(3.0, 2.4, 2.0, '#2f6e46')),
      blankUV(box(3.4, 0.15, 2.4, '#245238', 0, 2.4, 0)),
      atlasUV(paint(board, C('#ffffff')), 'newsBoard'),
    ]), tex: true };
  }
  // ---- NYC sidewalk shed. NYC Building Code §3307.6.4 + NYCHA standard shed
  //      details: header beams 8 ft O.C., secondary joists 2 ft O.C., 2" plank
  //      deck over corrugated metal, base plates on wood blocking, parapet
  //      3'-6"–4'-0" above the deck, LED lighting at 10 ft O.C., and the
  //      3 ft x 6 ft white DOB information panel (§3301.9.2) on the parapet.
  //      LL47/2025 raised the clear height to 12 ft for sheds filed after Aug
  //      2025; the great majority standing are legacy 8 ft, so that is what is
  //      modelled. Diagonal bracing goes in the first two bays then every 4th.
  //      Base length is 10 m in X — assemble.js sets sx = frontage/10 — so the
  //      bays stretch with the frontage the way a real shed's do.
  {
    const GRN = '#123319', GRN_D = '#0a2010', PIPE = '#3a4045', PIPE_D = '#2f353a';
    const CLR = 2.50;                 // clear height under the deck (8'-2")
    const DECK = CLR + 0.20;          // top of the 2" plank deck
    const PAR = 1.07;                 // parapet above the deck (3'-6")
    const ZC = 1.50, ZB = -1.62;      // curb-line frame (18" off the curb) / building line
    const N = 9, SPAN = 10, BAY = SPAN / (N - 1);
    const parts = [];
    for (let i = 0; i < N; i++) {
      const px = -SPAN / 2 + i * BAY;
      for (const z of [ZC, ZB]) {
        parts.push(pipe(0.043, CLR - 0.10, PIPE, px, 0.10, z));       // steel pipe column
        parts.push(box(0.21, 0.024, 0.21, '#5f656a', px, 0.076, z));  // base plate
        parts.push(box(0.23, 0.076, 0.23, '#6d5c43', px, 0, z));      // wood blocking
      }
      parts.push(strut([px, CLR - 0.07, ZB], [px, CLR - 0.07, ZC], 0.04, 0.04, PIPE)); // header beam
      if (i === 0 || i === 1 || i === 5 || i === N - 2) {              // first two bays, then every 4th
        const bx = px + BAY;
        parts.push(strut([px, 0.16, ZC + 0.055], [bx, CLR - 0.16, ZC + 0.055], 0.024, 0.024, PIPE_D));
        parts.push(strut([bx, 0.16, ZC + 0.055], [px, CLR - 0.16, ZC + 0.055], 0.024, 0.024, PIPE_D));
      }
    }
    parts.push(xpipe(-5, 5, CLR - 0.16, ZC, 0.032, PIPE), xpipe(-5, 5, CLR - 0.16, ZB, 0.032, PIPE));
    parts.push(xpipe(-5, 5, 1.30, ZC, 0.026, PIPE_D));                 // horizontal tie on the curb face
    // deck: secondary joists at 2 ft over a corrugated metal pan, 2" plank on top
    for (let i = 0; i < 9; i++) parts.push(box(0.075, 0.12, 3.20, '#4c4034', -5 + 0.4 + i * 1.15, CLR - 0.12, -0.06));
    parts.push(box(SPAN, 0.03, 3.30, '#6e747a', 0, CLR, 0));           // corrugated soffit pan
    parts.push(box(SPAN, 0.055, 3.30, '#5e5445', 0, CLR + 0.03, 0));   // 2" plank deck
    parts.push(box(SPAN, 0.115, 3.30, '#666d73', 0, CLR + 0.085, 0));
    // parapet: plywood board most of the way up, open braced frame + rail above
    parts.push(box(SPAN, PAR - 0.06, 0.05, GRN, 0, CLR - 0.02, ZC + 0.16));
    for (let i = 0; i < N; i++) parts.push(box(0.055, 0.30, 0.055, GRN_D, -SPAN / 2 + i * BAY, DECK + PAR - 0.29, ZC + 0.16));
    parts.push(xpipe(-5, 5, DECK + PAR, ZC + 0.16, 0.03, GRN_D));
    parts.push(box(SPAN, PAR - 0.06, 0.05, GRN, 0, CLR - 0.02, ZB - 0.16));
    parts.push(box(0.05, PAR - 0.06, 3.28, GRN, -SPAN / 2 + 0.02, CLR - 0.02, 0));
    parts.push(box(0.05, PAR - 0.06, 3.28, GRN, SPAN / 2 - 0.02, CLR - 0.02, 0));
    // DOB information panel: 3 ft x 6 ft, white ground, Pantone 296 navy band
    parts.push(box(1.83, 0.914, 0.02, '#eef0f1', -2.6, DECK + 0.04, ZC + 0.195));
    parts.push(box(1.83, 0.16, 0.024, '#0f2b54', -2.6, DECK + 0.70, ZC + 0.197));
    parts.push(box(1.10, 0.07, 0.024, '#0f2b54', -2.95, DECK + 0.42, ZC + 0.197));
    // LED strip fixtures under the deck at 10 ft O.C. (glow strips below)
    for (let i = 0; i < 4; i++) parts.push(box(0.54, 0.055, 0.15, '#b9bcc0', -3.75 + i * 2.5, CLR - 0.085, 0.10));
    G.scaffold = { geo: merge(parts) };
    const lamps = [];
    for (let i = 0; i < 4; i++) lamps.push(box(0.48, 0.02, 0.11, '#fff2cf', -3.75 + i * 2.5, CLR - 0.105, 0.10));
    G.scaffoldGlow = { geo: merge(lamps), glow: true };
  }  // ---- bench (world's fair)
  {
    G.bench = { geo: merge([
      box(1.8, 0.07, 0.55, '#6e5a3e', 0, 0.45, 0),
      box(1.8, 0.5, 0.07, '#6e5a3e', 0, 0.5, -0.28),
      box(0.08, 0.45, 0.5, '#3d4045', -0.8, 0, 0), box(0.08, 0.45, 0.5, '#3d4045', 0.8, 0, 0),
    ]) };
  }
  // ---- awning (per-instance color): shallow slope, sidewalk-clear 1.1m projection, valance
  {
    const g = new THREE.BoxGeometry(3.4, 0.07, 1.1);
    g.translate(0, 0, 0.55);
    g.rotateX(-0.42);
    const flap = new THREE.BoxGeometry(3.4, 0.26, 0.045);
    flap.rotateX(-0.1);
    flap.translate(0, -0.5, 0.98);
    const armL = new THREE.CylinderGeometry(0.02, 0.02, 1.2, 5).rotateX(Math.PI / 2 - 0.42).translate(-1.6, -0.22, 0.5);
    const armR = armL.clone().translate(3.2, 0, 0);
    G.awning = { geo: merge([paint(g, C('#ffffff')), paint(flap, C('#ffffff')), paint(armL, C('#3a3d40')), paint(armR, C('#3a3d40'))]), perInstanceColor: true };
  }
  // ---- stoop: a Harlem/Brooklyn brownstone high stoop (~610 tris)
  //
  // Round-3 critic #3, "the stoop is a brown box". The old pool was seven steps
  // and two 1.40 m slabs — and because the flight only climbs to 1.19 m, those
  // slabs stood 21 cm PROUD of the top step for the whole run, at constant
  // height, 2.4 m deep against a 2.38 m flight. From any angle off the axis they
  // occluded every tread. The frame was showing the parapets, not the stoop.
  // (The critic read them as "half buried"; they are not — `box()` above is
  // base-anchored. The fault is that they are too tall and not raked.)
  //
  // What makes a stoop legible from a kerb 12 m away, in order:
  //   1. the RAKED cheek wall — a solid stone parapet whose top follows the
  //      flight and dies into a heavy square newel at the pavement. That one
  //      diagonal is the entire silhouette.
  //   2. light treads over dark risers, each tread 3.5 cm proud of its riser so
  //      it draws its own shadow line.
  //   3. a thin black iron rail standing on the cheek coping, raked with it.
  //   4. the areaway railing at the property line that the stoop breaks
  //      through — the thing that makes a row read as a ROW.
  //
  // 7 in rise / 11 in tread (2R+T = 25 in, the same stair rule as the subway
  // stair above). Measured reference table in docs/notes/furniture.md.
  // The compiler puts the origin 0.4 m in front of the frontage
  // (compile.mjs:1578) and local +z faces the street, so THE WALL PLANE IS
  // z = -0.40 and the landing has to start there, not 0.75 m inside it.
  {
    const parts = [];
    // Portland brownstone. The daylight wash lifts blue hard and pulls chroma
    // out (the measured table at the end of this file): the old flat #6b5646
    // measured rgb(139,128,118) in frame, R-B = 21, where the photograph is
    // (157,112,80), R-B = 77. Authored redder and darker than the target.
    // MEASURED, first pass: #7a4a2b rendered rgb(150,119,101) at xwalkRow —
    // R-B = 49 against the photograph's 77, and LIGHTER than the red brick
    // beside it (112,83,81), which is why it still read pinkish-tan. Second
    // pass takes ~6 % off the value and 16 sRGB off blue.
    const STONE = '#763e18';     // body: cheek walls, newels, piers
    const STONE_L = '#8c5426';   // treads, copings, caps — sun-bleached, worn
    const STONE_D = '#4b2711';   // risers and the cheek's coping shadow band
    const STONE_W = '#563d26';   // splash-zone weathering at the flags
    const IRON = '#0d0f11';      // near-black: mid-grey iron renders white here
    const RISE = 0.170, GOING = 0.280, NSTEP = 10; // 10 x 0.170 = 1.700 m = nycDress stooped doorY (real Harlem parlour floors sit 1.5-1.9 m up)
    const TOP = RISE * NSTEP;                       // landing level, 1.19
    const W = 1.62, CK = 0.30;                      // clear width / cheek thickness
    const CX = W / 2 + CK / 2;                      // cheek centreline in x, 0.96
    const LZ0 = -0.42, LZ1 = 0.80;                  // landing: 2 cm into the wall, 1.22 m deep
    const BOT = LZ1 + GOING * (NSTEP - 1);          // bottom nosing, z = 2.48

    // ---- flight: stacked solid mass painted as RISERS, light tread caps on top
    parts.push(box(W + 0.02, TOP, LZ1 - LZ0, STONE_D, 0, 0, (LZ0 + LZ1) / 2));
    for (let k = 1; k < NSTEP; k++) {
      parts.push(box(W + 0.02, TOP - k * RISE, GOING, STONE_D, 0, 0, LZ1 + GOING * (k - 0.5)));
    }
    // tread surfaces, overhanging the riser below by 3.5 cm so every step draws
    // a shadow line. hplate is 2 tris; boxes here would cost 84.
    //
    // 18 mm proud, not 5. The tread plate covers the whole top face of the
    // riser box it sits on, and both are in one merged pool geometry with one
    // material, so nothing but their own Y can separate them: at 5 mm the pair
    // holds a stable depth winner only to 37 m at eye level, and mBrownstone /
    // fBrownstone look down a row of stoops to well past 100 m. 18 mm takes it
    // to 59 m and reads as the tread slab it is meant to be (a real bluestone
    // stoop tread is 50-75 mm). docs/notes/zfight.md §6.
    for (let k = 0; k < NSTEP; k++) {
      const y = TOP - k * RISE;
      const z0 = k === 0 ? LZ0 : LZ1 + GOING * (k - 1);
      const z1 = (k === 0 ? LZ1 : LZ1 + GOING * k) + 0.035;
      parts.push(hplate(W + 0.02, z1 - z0, STONE_L, 0, y + (ZFIX ? 0.018 : 0.005), (z0 + z1) / 2));
    }

    // ---- cheek walls, raked on the nosing line from (LZ1, TOP) to (BOT, RISE).
    // Both ends are buried — top in the landing pier, bottom in the newel — so
    // the mitre never shows. th = the flight angle, 31.3 deg at 7 on 11.
    const th = Math.atan2(TOP - RISE, BOT - LZ1);      // +0.546 rad
    const sl = Math.hypot(BOT - LZ1, TOP - RISE);      // 1.965 m along the slope
    const mz = (LZ1 + BOT) / 2, my = (TOP + RISE) / 2; // slope midpoint
    const nz = Math.sin(th), ny = Math.cos(th);        // unit normal, up out of the slope
    const CH = 0.40, CP = 0.10;                        // cheek height (perpendicular) + coping
    const RKL = sl + 0.24;                             // length: ends inside newel and pier
    const rake = (w, h, hex, x, off, len) => tbox(w, h, len, hex, x, my + ny * off, mz + nz * off, th);
    for (const s of [-1, 1]) {
      parts.push(rake(CK, CH, STONE, s * CX, CH / 2, RKL));
      parts.push(rake(CK + 0.08, CP, STONE_L, s * CX, CH + CP / 2, RKL - 0.04));
      // a dark band standing 2 cm proud just under the coping: the coping's
      // own shadow line, the one carved detail that still reads at 12 m. A flat
      // cheek is the other half of "untextured placeholder".
      parts.push(rake(0.03, 0.07, STONE_D, s * (CX + CK / 2 + 0.006), CH - 0.035, RKL - 0.10));
    }

    // ---- newels: the heavy square block the rake dies into, on a plinth
    for (const s of [-1, 1]) {
      const nzc = BOT + 0.10;
      parts.push(box(0.48, 0.10, 0.50, STONE_W, s * CX, 0, nzc));      // plinth
      parts.push(box(0.44, 0.26, 0.46, STONE_W, s * CX, 0.10, nzc));   // weathered base band
      parts.push(box(0.44, 0.58, 0.46, STONE, s * CX, 0.36, nzc));     // shaft
      parts.push(box(0.52, 0.09, 0.54, STONE_L, s * CX, 0.94, nzc));   // moulded cap
    }

    // ---- landing parapets, and the pier where the rake meets them
    for (const s of [-1, 1]) {
      parts.push(box(CK, 0.44, LZ1 - LZ0, STONE, s * CX, TOP, (LZ0 + LZ1) / 2));
      parts.push(box(CK + 0.08, 0.09, LZ1 - LZ0 + 0.04, STONE_L, s * CX, TOP + 0.44, (LZ0 + LZ1) / 2));
      parts.push(box(0.42, 0.62, 0.60, STONE, s * CX, TOP, LZ1 - 0.12));
      parts.push(box(0.50, 0.09, 0.68, STONE_L, s * CX, TOP + 0.62, LZ1 - 0.12));
    }

    // ---- iron. The cheek wall does the guarding, so the rail is short: grip
    // ~0.99 m above the nosing line, i.e. 0.40 m of baluster above the coping.
    // seg-3 balusters (6 tris) — 17 mm stock is sub-pixel past 8 m and only the
    // LINE reads; the rails keep seg 6 so they stay round in the near field.
    const RH = 0.40;
    const cop = (t) => [LZ1 + (BOT - LZ1) * t + nz * (CH + CP), TOP + (RISE - TOP) * t + ny * (CH + CP)];
    // ---- FD14 (critic-r14 fix 7: "stoop rails are two plain pipes"). Four balusters
    // over 1.97 m of slope is one every 0.49 m; a cast-iron stoop rail is one every
    // 0.11-0.15 m, and what the eye actually reads at 12 m is not the individual bar
    // but the BAND OF TEXTURE they make between two rails. So: 11 balusters per flight
    // (0.17 m centres) and 6 on the landing, a bottom rail 6 cm over the coping to close
    // the band, and a square NEWEL with a cap at the foot and head of each rake — the
    // detail that makes an iron rail read as iron rather than as scaffold tube.
    // seg-3 stock as before (17 mm is sub-pixel past 8 m; only the line reads).
    const FD14_RAIL = FD14K ? 1 : 0;
    const nBal = FD14K ? 11 : 4, nLand = FD14K ? 6 : 3;
    for (const s of [-1, 1]) {
      const a = cop(0.02), b = cop(0.99);
      parts.push(strut([s * CX, a[1] + RH, a[0]], [s * CX, b[1] + RH, b[0]], 0.024, 0.024, IRON, 6));
      if (FD14_RAIL) parts.push(strut([s * CX, a[1] + 0.06, a[0]], [s * CX, b[1] + 0.06, b[0]], 0.014, 0.014, IRON, 6));
      for (let i = 1; i <= nBal; i++) { const c = cop(i / (nBal + 1)); parts.push(pipe(0.017, RH, IRON, s * CX, c[1], c[0], 3)); }
      if (FD14_RAIL) {
        for (const [t, nh] of [[0.015, 0.56], [0.985, 0.50]]) {        // newels: foot and head of the rake
          const c = cop(t);
          parts.push(box(0.062, nh, 0.062, IRON, s * CX, c[1] - 0.02, c[0]));
          parts.push(box(0.095, 0.045, 0.095, IRON, s * CX, c[1] - 0.02 + nh, c[0]));
        }
      }
      // landing rail, back along the parapet coping to the wall
      const ly = TOP + 0.53 + RH;
      parts.push(strut([s * CX, ly, LZ1 - 0.02], [s * CX, ly, LZ0 + 0.12], 0.024, 0.024, IRON, 6));
      if (FD14_RAIL) parts.push(strut([s * CX, TOP + 0.59, LZ1 - 0.02], [s * CX, TOP + 0.59, LZ0 + 0.12], 0.014, 0.014, IRON, 6));
      for (let i = 0; i < nLand; i++) {
        parts.push(pipe(0.017, RH, IRON, s * CX, TOP + 0.53, LZ1 - 0.14 - i * (FD14K ? 0.185 : 0.30), 3));
      }
    }

    // ---- areaway railing: the iron line along the property line that the stoop
    // breaks through. Without it a stoop stands alone on an empty pavement and
    // the row never reads as a row. Kept to 1.15 m each side and inboard of the
    // newels, so it cannot reach a kerb, a tree pit or the next house's stoop.
    const AZ = BOT - 0.30, AH = 1.02;
    for (const s of [-1, 1]) {
      const x0 = s * (CX + 0.28), x1 = s * (CX + 1.43);
      parts.push(strut([x0, AH, AZ], [x1, AH, AZ], 0.022, 0.022, IRON, 6));
      parts.push(strut([x0, 0.17, AZ], [x1, 0.17, AZ], 0.016, 0.016, IRON, 6));
      parts.push(pipe(0.030, AH + 0.09, IRON, x1, 0, AZ, 6));
      for (let i = 0; i < 4; i++) parts.push(pipe(0.015, AH - 0.02, IRON, x0 + (x1 - x0) * (0.17 + i * 0.22), 0.02, AZ, 3));
    }
    G.stoop = { geo: merge(parts) };
  }
  // ---- fire escapes: 3 fixed-height variants (no y-scaling → no stretched members),
  //      proper platforms with picket railings + angled stair ladders + drop ladder
  {
    const escape = (floors) => {
      const parts = [];
      const fh = 3.0, y0 = 3.6; // first platform above the storefront line
      const W = 2.6, D = 0.95;
      for (let f = 0; f < floors; f++) {
        const y = y0 + f * fh;
        // platform: deck + slat lines
        parts.push(box(W, 0.06, D, '#2d3236', 0, y, D / 2));
        parts.push(box(W, 0.025, 0.05, '#22262a', 0, y + 0.001, D - 0.08));
        // railings: top rail + mid rail + pickets
        for (const [rx, rz, rw, rd] of [[0, D - 0.025, W, 0.05], [-W / 2 + 0.025, D / 2, 0.05, D], [W / 2 - 0.025, D / 2, 0.05, D]]) {
          parts.push(box(rw, 0.045, rd, '#2d3236', rx, y + 0.92, rz));
          parts.push(box(rw, 0.04, rd, '#2d3236', rx, y + 0.5, rz));
        }
        for (let px = -W / 2 + 0.18; px < W / 2 - 0.1; px += 0.34) {
          parts.push(box(0.028, 0.92, 0.028, '#272b2f', px, y, D - 0.04));
        }
        parts.push(box(0.028, 0.92, 0.028, '#272b2f', -W / 2 + 0.04, y, D * 0.35), box(0.028, 0.92, 0.028, '#272b2f', W / 2 - 0.04, y, D * 0.35));
        // stair ladder up to the next platform (skip topmost)
        if (f < floors - 1) {
          const steps = 7;
          for (let sIdx = 0; sIdx < steps; sIdx++) {
            const tt = (sIdx + 0.5) / steps;
            parts.push(box(0.44, 0.035, 0.14, '#22262a', W / 2 - 0.55, y + tt * fh, D - 0.18 - tt * 0.55));
          }
          for (const sx of [W / 2 - 0.33, W / 2 - 0.77]) {
            const str = box(0.05, Math.hypot(fh, 0.6) + 0.2, 0.05, '#2d3236', 0, 0, 0);
            str.rotateX(-0.19);
            str.translate(sx, y + 0.05, D - 0.2);
            parts.push(str);
          }
        }
        // wall brackets
        parts.push(box(0.06, 0.5, 0.5, '#22262a', -W / 2 + 0.15, y - 0.45, 0.22), box(0.06, 0.5, 0.5, '#22262a', W / 2 - 0.15, y - 0.45, 0.22));
      }
      // counterweighted drop ladder below the first platform
      const drop = merge([
        box(0.05, 2.6, 0.05, '#2d3236', -0.5, y0 - 2.6, D - 0.3),
        box(0.05, 2.6, 0.05, '#2d3236', -0.15, y0 - 2.6, D - 0.3),
        ...Array.from({ length: 6 }, (_, k) => box(0.38, 0.03, 0.04, '#22262a', -0.325, y0 - 2.35 + k * 0.42, D - 0.3)),
      ]);
      parts.push(drop);
      return merge(parts);
    };
    G.fireEscape3 = { geo: escape(3) };
    G.fireEscape4 = { geo: escape(4) };
    G.fireEscape5 = { geo: escape(5) };
  }
  // ---- water tower! cedar-stave tank on X-braced steel dunnage: water-stain
  //      base band, proud hoops, overhanging cone eave + finial, riser (≈444 tris)
  {
    const parts = [];
    for (const [lx, lz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) {
      parts.push(box(0.15, 3.2, 0.15, '#33363c', lx, 0, lz));      // legs
      parts.push(box(0.34, 0.07, 0.34, '#26292e', lx, 0, lz));     // base shoes (contact shadow)
    }
    for (const sgn of [-1, 1]) { // X-braces on the two Z faces
      const b1 = box(0.07, 3.3, 0.07, '#42464c'); b1.rotateZ(0.62); b1.translate(1.05, 0.25, sgn * 1.15); parts.push(b1);
      const b2 = box(0.07, 3.3, 0.07, '#42464c'); b2.rotateZ(-0.62); b2.translate(-1.05, 0.25, sgn * 1.15); parts.push(b2);
    }
    parts.push(box(2.6, 0.13, 2.6, '#3a3d43', 0, 3.02, 0));         // platform
    parts.push(cyl(1.6, 1.72, 3.25, '#7a5c40', 0, 3.15, 0, 12));    // tapered staves
    parts.push(cyl(1.76, 1.79, 0.42, '#4a3626', 0, 3.16, 0, 12));   // water-stain base band
    parts.push(cyl(1.71, 1.73, 0.09, '#35383d', 0, 4.35, 0, 12));   // steel hoop
    parts.push(cyl(1.68, 1.7, 0.09, '#35383d', 0, 5.45, 0, 12));    // steel hoop
    parts.push(cyl(0.12, 1.82, 1.5, '#5a4330', 0, 6.4, 0, 12));     // cone w/ eave overhang
    parts.push(cyl(0.13, 0.13, 0.42, '#33363c', 0, 7.72, 0, 6));    // finial stub
    parts.push(cyl(0.09, 0.09, 3.1, '#4a4e54', 0.35, 0, 0.35, 6));  // riser pipe
    G.waterTower = { geo: merge(parts) };
  }
  // ---- roof AC + bulkhead + standpipe + pier
  // RTU: curb shadow gap, two-tone cabinet w/ seam, service panel, fan collar
  // + recessed dark grille + hub, refrigerant lineset (180 tris)
  G.roofAC = { geo: merge([
    box(1.5, 0.16, 0.98, '#3a3d40', 0, 0, 0),
    box(1.7, 0.86, 1.15, '#9aa0a3', 0, 0.16, 0),
    box(1.74, 0.1, 1.19, '#b2b6b8', 0, 1.02, 0),
    box(1.72, 0.035, 1.17, '#5c6064', 0, 0.58, 0),
    box(0.56, 0.5, 0.045, '#4a4e52', 0.38, 0.28, 0.565),
    box(0.18, 0.035, 0.05, '#26292c', 0.38, 0.52, 0.585),
    cyl(0.46, 0.5, 0.13, '#7d8287', -0.32, 1.1, 0, 8),
    cyl(0.4, 0.4, 0.045, '#1e2124', -0.32, 1.18, 0, 8),
    cyl(0.07, 0.09, 0.1, '#8f9498', -0.32, 1.2, 0, 6),
    cyl(0.035, 0.035, 0.55, '#6b6f74', 0.9, 0, 0.42, 5),
  ]) };
  // ---- ROOF9 (docs/notes/roofs-r9.md §3) PROP SCALE DISTRIBUTION ----------
  // The round-8 blind pass, finding 2: "roof-prop SCALE distribution is far too
  // narrow — roofAC is 1.7 x 1.15 m, a residential split condenser, and it is
  // used for every roof in the city, where the reference's commercial roofs
  // carry 2.5-3.5 m packaged units, long plenums and tall stacks ALONGSIDE the
  // small ones." These four kinds are that missing tail of the histogram. All
  // four are instanced pools like every other kind, so a roof of any size still
  // costs zero draw calls; the round adds 4 pool draws in total.
  //
  // PACKAGED ROOFTOP UNIT — 3.0 x 2.1 m, 1.46 m to the fan deck, on its own
  // curb (a real RTU sits on a curb over the supply/return penetration, which
  // is why it needs no dunnage). ~340 tris.
  G.roofRTU = { geo: merge([
    box(3.10, 0.24, 2.20, '#34373a', 0, 0, 0),            // roof curb — the dark shadow gap
    box(3.00, 1.12, 2.10, '#9ea3a6', 0, 0.24, 0),         // galvanised cabinet
    box(3.04, 0.10, 2.14, '#b4b8ba', 0, 1.36, 0),         // cap flange
    box(3.02, 0.035, 2.12, '#5c6064', 0, 0.86, 0),        // panel seams
    box(3.02, 0.035, 2.12, '#5c6064', 0, 0.52, 0),
    box(1.05, 0.78, 0.05, '#4a4e52', -0.85, 0.42, 1.06),  // service access panel
    box(0.20, 0.04, 0.06, '#26292c', -0.40, 0.86, 1.09),  // latch
    box(0.26, 0.70, 1.55, '#8d9297', 1.62, 0.34, 0),      // economiser / intake hood
    box(0.30, 0.06, 1.60, '#aeb2b5', 1.62, 1.04, 0),      // hood cap
    cyl(0.52, 0.56, 0.15, '#8a8f94', -0.72, 1.46, 0.18, 8),  // condenser fan cowls
    cyl(0.46, 0.46, 0.04, '#1e2124', -0.72, 1.56, 0.18, 8),  // recessed dark grilles
    cyl(0.52, 0.56, 0.15, '#8a8f94', 0.72, 1.46, 0.18, 8),
    cyl(0.46, 0.46, 0.04, '#1e2124', 0.72, 1.56, 0.18, 8),
    box(0.30, 0.16, 0.30, '#6b6f74', -0.72, 1.60, 0.18),  // fan motors
    box(0.30, 0.16, 0.30, '#6b6f74', 0.72, 1.60, 0.18),
    cyl(0.045, 0.045, 0.40, '#6b6f74', 1.30, 0, -0.95, 5),   // condensate riser
    cyl(0.055, 0.055, 0.55, '#7a6a3a', -1.35, 0, -0.95, 5),  // gas riser (yellow)
  ]) };
  // LARGE PLENUM / DUCT RUN WITH AN ELBOW — 4.4 m of insulated supply duct on
  // sleepers, flange seams every 1.4 m, and the turn DOWN into its roof curb at
  // one end. The elbow is the point: ductRun (0.6 x 0.52 x 3.1) reads as a
  // pipe at 150 m, this reads as ductwork. ~150 tris.
  G.roofPlenum = { geo: merge([
    box(1.04, 0.86, 4.40, '#9aa0a3', 0, 0.30, 0),
    box(1.10, 0.92, 0.05, '#6d7175', 0, 0.27, -1.40),
    box(1.10, 0.92, 0.05, '#6d7175', 0, 0.27, 0),
    box(1.10, 0.92, 0.05, '#6d7175', 0, 0.27, 1.40),
    box(1.14, 0.26, 0.16, '#3a3d40', 0, 0, -1.85),        // sleepers
    box(1.14, 0.26, 0.16, '#3a3d40', 0, 0, 0),
    box(1.14, 0.26, 0.16, '#3a3d40', 0, 0, 1.85),
    box(1.04, 1.16, 1.05, '#8f9499', 0, 0, -2.70),        // ELBOW: turns down
    box(1.12, 0.08, 1.12, '#b0b4b7', 0, 1.16, -2.70),
    box(1.22, 0.24, 1.22, '#34373a', 0, 0, -2.70),        // its curb
    box(1.06, 0.88, 0.06, '#7d8287', 0, 0.29, 2.22),      // end cap
    cyl(0.05, 0.05, 0.90, '#6b6f74', 0.60, 0, 1.90, 5),   // condensate drop
  ]) };
  // TALL VENT STACK / FLUE — 3.4 m. ventPipe is 1.45 m and sits below every
  // parapet in the city, so from the pavement a roof had no vertical grain at
  // all except its bulkhead. A boiler flue is the commonest tall thin thing on
  // a New York roof. ~140 tris. Deliberately NOT in the instancer's ROOF_LOW
  // set: unlike the 1 m clutter it is meant to read from the street.
  G.roofStack = { geo: merge([
    cyl(0.20, 0.44, 0.28, '#55514a', 0, 0, 0, 8),          // flashing cone
    cyl(0.165, 0.185, 3.10, '#6f6a5f', 0, 0.22, 0, 8),     // stack
    cyl(0.21, 0.21, 0.06, '#4a4e52', 0, 1.70, 0, 8),       // splice band
    cyl(0.30, 0.12, 0.30, '#3a3d40', 0, 3.24, 0, 8),       // conical rain cap
    cyl(0.055, 0.055, 0.10, '#3a3d40', 0, 3.54, 0, 5),
    strut([0.02, 2.40, 0.02], [0.95, 0.90, 0.0], 0.028, 0.028, '#5c6064'),
    strut([-0.02, 2.40, -0.02], [-0.68, 0.90, 0.62], 0.028, 0.028, '#5c6064'),
    box(0.26, 0.06, 0.26, '#42464c', 0.95, 0.86, 0),       // brace feet
    box(0.26, 0.06, 0.26, '#42464c', -0.68, 0.86, 0.62),
  ]) };
  { // ROOF WALKWAY PAVER — one 0.62 m plate, 2 TRIANGLES, 35 mm proud.
    // Counted off ref_lenox.png at 2x (scratchpad/refcrops/ref_swcorner.png):
    // the SW-corner roof at 125th & Lenox — a white single-ply membrane with
    // eight packaged units on it — carries long DASHED LINES of concrete
    // walkway pavers from its bulkhead to every unit, and at 150 m those lines
    // are the most legible thing on the roof after the units themselves. They
    // are also the reason round 8's blind pair p2 was called: "the reference
    // has 3 m packaged RTUs, rust patches, A PAVER WALKWAY, conduit".
    // Laid on a 0.95 m step (they really are contiguous, but the gap is what
    // the eye reads at this range and it halves the instance count).
    //
    // ---- U10 (docs/notes/uniformity-r10.md): THAT WAS WRONG AND THE ROUND-9
    // BLIND PASS CALLED IT AS FINDING 1 — "the walkway is DASHED where the real
    // one is a continuous ribbon". The dashes were an instance-budget argument,
    // and the argument evaporates once the module is a UNIT-LENGTH RIBBON
    // instead of a paver: 1.0 m along its run x 0.9 m wide, so the roof engine
    // emits ONE instance per walkway run with `sx = run length` and gets a
    // contiguous strip for 2 triangles and 1 instance where 26 used to go. The
    // old 0.62 m paver is still reachable — `?u10=0` emits the same run with
    // (sx 0.62, sz 0.689), which is byte-for-byte the round-9 plate.
    const g = new THREE.PlaneGeometry(1.0, 0.9);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.035, 0);
    G.roofWalk = { geo: paint(g, C('#8e8b84')) };
  }
  { // STAIN RING / SACRIFICIAL SLIP PAD — the round-8 blind pass, finding 3:
    // "nothing on a roof is stained. Every reference roof has a dark rim where
    // water and soot pool, tan/rust haloes around each unit, and dark streaks
    // to the drains. This is probably the cheapest large win available."
    // One 12-gon disc = 12 TRIANGLES, radius 1 m so the roof engine scales it
    // per use (a water tank's drip ring is 2.4 m, an RTU's halo 2.0 m). Sits
    // 30 mm proud of the deck rather than coplanar with it (zfight.md: overlap
    // or clear, never abut) and is excluded from the shadow set in
    // instancer.js — a flat decal 30 mm off the surface it shadows is nothing
    // but acne. It reads as BOTH the stain and the slip sheet that is really
    // laid under rooftop plant, which is why a mid-dark neutral is right.
    //
    // TWO CORRECTIONS AFTER THE FIRST AFTER-PLATE (crop:
    // scratchpad/a_roofzoom.png, a white membrane roof at 3x). The first
    // version was a perfect disc in a near-neutral dark grey (#4b463f) and on a
    // 0.5-albedo white membrane it read as a BLACK HOLE punched in the roof —
    // the hardest-edged, darkest thing in the frame, and obviously painted on.
    // The reference (scratchpad/refcrops/ref_swcorner.png) has no such thing:
    // its stains are TAN / RUST blotches with soft irregular outlines, only
    // ~25 % darker than the coating, and they read as history rather than as
    // holes. So: a warm mid-tone, and the rim radii are jittered into an
    // irregular blob (still 12 triangles) — plus roofEngine gives every PAD
    // instance a random yaw, so one blob shape cannot repeat visibly.
    const g = new THREE.CircleGeometry(1.0, 12);
    {
      const pos = g.attributes.position;   // centre vertex 0, rim 1..13 (13 == 1)
      const K12 = [0.95, 0.74, 0.88, 0.66, 1.0, 0.8, 0.71, 0.93, 0.63, 0.85, 0.78, 0.69];
      for (let i = 1; i < pos.count; i++) {
        const k = K12[(i - 1) % 12];
        pos.setX(i, pos.getX(i) * k); pos.setY(i, pos.getY(i) * k);
      }
      g.computeBoundingSphere();
    }
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.03, 0);
    G.roofPad = { geo: paint(g, C('#6e6052')) };
  }
  // stair bulkhead: grime base, cap lip, door reveal + leaf + kick plate + lamp,
  // louver bank w/ fins, rear ladder, roof gooseneck, conduit (≈248 tris)
  {
    const bh = [
      box(3.4, 2.5, 2.8, '#8a8478'),
      box(3.5, 0.28, 2.9, '#6b665c', 0, 0, 0),
      box(3.56, 0.2, 2.96, '#726c60', 0, 2.5, 0),
      box(1.04, 2.08, 0.07, '#2e3134', 0, 0, 1.38),
      box(0.9, 1.98, 0.05, '#46505a', 0, 0.03, 1.41),
      box(0.9, 0.3, 0.055, '#7d8287', 0, 0.03, 1.415),
      box(0.22, 0.12, 0.16, '#26292c', 0, 2.2, 1.43),
      box(0.07, 0.95, 1.15, '#3f4347', 1.68, 0.85, 0),
      cyl(0.03, 0.03, 2.4, '#6b6f74', 1.2, 0, 1.42, 5),
      cyl(0.09, 0.1, 0.5, '#7d8287', -1.1, 2.7, -0.6, 6),
      box(0.24, 0.14, 0.34, '#5c6064', -1.1, 3.06, -0.48),
      box(0.05, 2.35, 0.05, '#42464c', -0.25, 0.1, -1.47),
      box(0.05, 2.35, 0.05, '#42464c', 0.25, 0.1, -1.47),
      box(0.55, 0.045, 0.045, '#42464c', 0, 0.6, -1.47),
      box(0.55, 0.045, 0.045, '#42464c', 0, 1.3, -1.47),
      box(0.55, 0.045, 0.045, '#42464c', 0, 2.0, -1.47),
    ];
    for (let i = 0; i < 3; i++) { // angled louver fins over the dark recess
      const f = tbox(0.26, 0.05, 1.05, '#a6abae', 0, 0, 0, 0);
      f.rotateZ(-0.7); f.translate(1.73, 0.55 + i * 0.28, 0); bh.push(f);
    }
    G.bulkhead = { geo: merge(bh) };
  }
  G.standpipe = { geo: merge([cyl(0.07, 0.07, 0.8, '#7a2020', -0.14, 0, 0, 6), cyl(0.07, 0.07, 0.8, '#7a2020', 0.14, 0, 0, 6), box(0.5, 0.1, 0.18, '#8a6c1f', 0, 0.75, 0)]) };
  // ---- roof clutter: vent pipes, dishes, antennas, skylights, duct runs
  G.ventPipe = { geo: merge([ // stack + flashing cone + flared cap (60 tris)
    cyl(0.11, 0.125, 1.45, '#6f6a5f', 0, 0, 0, 6),
    cyl(0.15, 0.32, 0.24, '#55514a', 0, 0, 0, 5),
    cyl(0.16, 0.11, 0.1, '#3a3d40', 0, 1.45, 0, 4),
  ]) };
  G.roofDish = { geo: merge([ // ballast foot, mast, tilted reflector, feed arm + LNB (108)
    box(0.44, 0.07, 0.44, '#42464c', 0, 0, 0),
    cyl(0.04, 0.055, 0.95, '#71757a', 0, 0.07, 0, 6),
    tcyl(0.5, 0.46, 0.07, '#cdd1d4', 0.16, 1.0, 0.02, 12, 1.15),
    tbox(0.04, 0.42, 0.04, '#8a8e93', 0.38, 0.78, 0.16, 0.6),
    box(0.09, 0.09, 0.09, '#33363a', 0.42, 0.62, 0.24),
  ]) };
  G.roofAntenna = { geo: merge([ // base plate, mast, booms + elements + tip stub (136)
    box(0.5, 0.06, 0.5, '#3d4045', 0, 0, 0),
    cyl(0.04, 0.065, 5.2, '#5a5f66', 0, 0.05, 0, 6),
    box(1.6, 0.045, 0.045, '#61666d', 0, 4.5, 0),
    box(1.1, 0.04, 0.04, '#61666d', 0, 3.7, 0),
    box(0.04, 0.04, 1.25, '#61666d', 0, 4.1, 0),
    box(0.035, 0.7, 0.035, '#7a7f86', -0.72, 4.5, 0),
    box(0.035, 0.7, 0.035, '#7a7f86', 0.72, 4.5, 0),
    box(0.035, 0.55, 0.035, '#7a7f86', -0.48, 3.7, 0),
    box(0.035, 0.55, 0.035, '#7a7f86', 0.48, 3.7, 0),
    cyl(0.05, 0.05, 0.35, '#33363a', 0, 5.2, 0, 4),
  ]) };
  G.skylight = { geo: merge([ // curb + cap seam, ridge glazing two-tone, mullions, gables (132)
    box(2.0, 0.32, 1.4, '#8a8478'),
    box(2.06, 0.07, 1.46, '#6f6a60', 0, 0.32, 0),
    tbox(1.94, 0.05, 0.8, '#2b3a48', 0, 0.57, -0.34, 0.5),
    tbox(1.94, 0.05, 0.8, '#33455a', 0, 0.57, 0.34, -0.5),
    box(1.94, 0.07, 0.12, '#5a5e62', 0, 0.72, 0),
    tbox(0.05, 0.06, 0.78, '#9aa0a3', -0.6, 0.58, -0.34, 0.5),
    tbox(0.05, 0.06, 0.78, '#9aa0a3', 0.6, 0.58, -0.34, 0.5),
    tbox(0.05, 0.06, 0.78, '#9aa0a3', -0.6, 0.58, 0.34, -0.5),
    tbox(0.05, 0.06, 0.78, '#9aa0a3', 0.6, 0.58, 0.34, -0.5),
    box(0.1, 0.36, 1.3, '#7a756a', -0.95, 0.32, 0),
    box(0.1, 0.36, 1.3, '#7a756a', 0.95, 0.32, 0),
  ]) };
  G.ductRun = { geo: merge([ // raised duct on sleepers, flange seams, riser elbow + weather cap (120)
    box(0.6, 0.52, 3.1, '#9aa0a3', 0, 0.26, 0),
    box(0.66, 0.58, 0.05, '#63676c', 0, 0.23, -0.7),
    box(0.66, 0.58, 0.05, '#63676c', 0, 0.23, 0.35),
    box(0.66, 0.58, 0.05, '#63676c', 0, 0.23, 1.25),
    box(0.5, 0.26, 0.14, '#3a3d40', 0, 0, -1.1),
    box(0.5, 0.26, 0.14, '#3a3d40', 0, 0, 1.1),
    box(0.74, 0.85, 0.72, '#7d8287', 0, 0, -1.7),
    box(0.82, 0.07, 0.8, '#b2b6b8', 0, 0.85, -1.7),
    cyl(0.16, 0.19, 0.42, '#6b6f74', 0.12, 0.78, 1.05, 6),
  ]) };
  // ---- rooftop program props: deck furniture (luxury residential), plant
  // (offices), solar arrays — placed by the compiler's BldgClass program
  G.roofChair = { geo: merge([ // side frames + two-tone cushions + tilted back (84)
    box(0.06, 0.36, 0.52, '#3a3d42', -0.25, 0, 0),
    box(0.06, 0.36, 0.52, '#3a3d42', 0.25, 0, 0),
    box(0.54, 0.07, 0.5, '#4a4e54', 0, 0.3, 0),
    box(0.5, 0.05, 0.46, '#b8a184', 0, 0.37, 0),
    tbox(0.54, 0.5, 0.06, '#4a4e54', 0, 0.62, -0.26, -0.22),
    tbox(0.5, 0.44, 0.045, '#b8a184', 0, 0.63, -0.225, -0.22),
    box(0.54, 0.04, 0.05, '#3a3d42', 0, 0.42, 0.24),
  ]) };
  G.roofTable = { geo: merge([ // top, tapered stem, weighted base (92)
    cyl(0.48, 0.48, 0.045, '#a8adb1', 0, 0.7, 0, 10),
    cyl(0.035, 0.05, 0.7, '#5f6468', 0, 0, 0, 5),
    cyl(0.24, 0.27, 0.045, '#4a4e54', 0, 0, 0, 8),
  ]) };
  G.roofPlanter = { geo: merge([ // fiberglass box + rim + soil + 3-green shrubs (120)
    box(1.5, 0.52, 0.55, '#6e675c'),
    box(1.56, 0.07, 0.61, '#57514a', 0, 0.52, 0),
    box(1.38, 0.06, 0.44, '#2e2416', 0, 0.53, 0),
    sphere(0.3, '#42632f', -0.45, 0.72, 0, 6),
    sphere(0.26, '#537a3a', 0.42, 0.68, 0.05, 6),
    box(0.34, 0.5, 0.3, '#3a5527', 0, 0.56, -0.06),
  ]) };
  G.roofUmbrella = { geo: merge([ // weighted base, pole, canopy, finial (100)
    cyl(0.26, 0.3, 0.08, '#42464c', 0, 0, 0, 8),
    cyl(0.03, 0.035, 2.05, '#5f6468', 0, 0.08, 0, 5),
    cyl(0.1, 1.32, 0.5, '#9a5a44', 0, 1.9, 0, 8),
    cyl(0.04, 0.04, 0.18, '#4a3025', 0, 2.4, 0, 4),
  ]) };
  { // cooling tower: wet basin, seamed casing, twin fan shrouds w/ dark grilles
    // + motors, louvered intakes both faces, riser + flange (≈392 tris)
    const ct = [
      box(2.8, 0.32, 2.3, '#565b60', 0, 0, 0),
      box(2.7, 1.62, 2.2, '#9aa0a3', 0, 0.32, 0),
      box(2.74, 0.1, 2.24, '#b2b6b8', 0, 1.94, 0),
      box(2.72, 0.04, 2.22, '#5c6064', 0, 1.12, 0),
      cyl(0.72, 0.84, 0.46, '#8a8f94', -0.66, 2.04, 0, 12),
      cyl(0.72, 0.84, 0.46, '#8a8f94', 0.66, 2.04, 0, 12),
      cyl(0.62, 0.62, 0.05, '#1e2124', -0.66, 2.4, 0, 10),
      cyl(0.62, 0.62, 0.05, '#1e2124', 0.66, 2.4, 0, 10),
      box(0.26, 0.2, 0.26, '#6b6f74', -0.66, 2.42, 0),
      box(0.26, 0.2, 0.26, '#6b6f74', 0.66, 2.42, 0),
      box(2.5, 1.1, 0.06, '#2c3034', 0, 0.5, 1.11),
      box(2.5, 1.1, 0.06, '#2c3034', 0, 0.5, -1.11),
      cyl(0.14, 0.14, 1.9, '#7d8287', 1.38, 0, -0.75, 6),
      cyl(0.2, 0.2, 0.08, '#5c6064', 1.38, 1.15, -0.75, 6),
    ];
    for (let i = 0; i < 3; i++) {
      ct.push(tbox(2.46, 0.05, 0.16, '#aeb2b5', 0, 0.28 + i * 0.36, 1.13, 0.8));
      ct.push(tbox(2.46, 0.05, 0.16, '#aeb2b5', 0, 0.28 + i * 0.36, -1.13, -0.8));
    }
    G.coolingTower = { geo: merge(ct) };
  }
  G.solarPanel = { geo: merge([ // dark module face on proud silver frame, gap strips, legs + ballast rails (120)
    tbox(3.2, 0.05, 1.7, '#16233b', 0, 0.6, 0, -0.42),
    tbox(3.28, 0.045, 1.78, '#8a8f94', 0, 0.575, 0, -0.42),
    tbox(0.045, 0.055, 1.72, '#9fa4a8', -0.55, 0.61, 0, -0.42),
    tbox(0.045, 0.055, 1.72, '#9fa4a8', 0.55, 0.61, 0, -0.42),
    box(0.07, 0.24, 0.07, '#6b6f74', -1.35, 0, 0.6),
    box(0.07, 0.24, 0.07, '#6b6f74', 1.35, 0, 0.6),
    box(0.07, 0.9, 0.07, '#6b6f74', -1.35, 0, -0.6),
    box(0.07, 0.9, 0.07, '#6b6f74', 1.35, 0, -0.6),
    box(3.0, 0.07, 0.09, '#4a4e54', 0, 0, 0.62),
    box(3.0, 0.07, 0.09, '#4a4e54', 0, 0, -0.62),
  ]) };
  // ---- rooftop engine props (kinds 51-66): comms, exhaust, access, safety,
  // dunnage, screening, sedum, pergola — the full NYC roof vocabulary
  G.cellSled = { geo: merge([ // ballast sled + frame + 3 panels + RRUs + cable bundle (176)
    box(0.18, 0.14, 1.1, '#5c6064', -0.8, 0, 0),
    box(0.18, 0.14, 1.1, '#5c6064', 0.8, 0, 0),
    box(1.9, 0.12, 0.3, '#8a8f94', 0, 0.02, 0),
    box(0.08, 2.0, 0.08, '#7d8287', -0.85, 0.1, 0),
    box(0.08, 2.0, 0.08, '#7d8287', 0.85, 0.1, 0),
    box(1.86, 0.08, 0.08, '#7d8287', 0, 1.95, 0),
    box(1.86, 0.08, 0.08, '#7d8287', 0, 0.95, 0),
    box(0.3, 1.45, 0.13, '#dfe2de', -0.62, 0.65, 0.14),
    box(0.3, 1.45, 0.13, '#dfe2de', 0, 0.65, 0.18),
    box(0.3, 1.45, 0.13, '#dfe2de', 0.62, 0.65, 0.14),
    box(0.24, 0.42, 0.14, '#33363a', -0.62, 1.0, -0.1),
    box(0.24, 0.42, 0.14, '#33363a', 0, 1.0, -0.12),
    box(0.24, 0.42, 0.14, '#33363a', 0.62, 1.0, -0.1),
    cyl(0.05, 0.05, 1.9, '#26292c', 0.92, 0.05, -0.08, 5),
  ]) };
  G.cellCabinet = { geo: merge([ // plinth, body, rain cap, door + louver + handle, rear conduits (112)
    box(0.9, 0.12, 0.7, '#42464c', 0, 0, 0),
    box(0.85, 1.42, 0.65, '#9aa0a3', 0, 0.12, 0),
    box(0.9, 0.09, 0.7, '#7d8287', 0, 1.54, 0),
    box(0.62, 1.2, 0.035, '#787d82', 0, 0.22, 0.33),
    box(0.56, 0.28, 0.045, '#4a4e52', 0, 0.32, 0.335),
    box(0.035, 0.22, 0.05, '#26292c', 0.24, 0.85, 0.34),
    cyl(0.035, 0.035, 0.95, '#6b6f74', -0.24, 0, -0.36, 5),
    cyl(0.035, 0.035, 0.95, '#6b6f74', 0.14, 0, -0.36, 5),
  ]) };
  G.cableTray = { geo: merge([ // ladder tray: rails + rungs + dark cable fill + stands (96)
    box(0.05, 0.12, 3.0, '#8a8f94', -0.19, 0.24, 0),
    box(0.05, 0.12, 3.0, '#8a8f94', 0.19, 0.24, 0),
    box(0.42, 0.03, 0.07, '#7d8287', 0, 0.24, -0.95),
    box(0.42, 0.03, 0.07, '#7d8287', 0, 0.24, 0),
    box(0.42, 0.03, 0.07, '#7d8287', 0, 0.24, 0.95),
    box(0.3, 0.09, 2.85, '#26292c', 0, 0.27, 0),
    box(0.07, 0.24, 0.07, '#5c6064', 0, 0, -1.2),
    box(0.07, 0.24, 0.07, '#5c6064', 0, 0, 1.2),
  ]) };
  G.mushroomFan = { geo: merge([ // curb, base cone, shadow-gap ring, flared 2-step cap (156)
    box(0.86, 0.14, 0.86, '#4a453e', 0, 0, 0),
    cyl(0.3, 0.4, 0.42, '#8f9494', 0, 0.14, 0, 10),
    cyl(0.31, 0.31, 0.1, '#17191c', 0, 0.56, 0, 8),
    cyl(0.5, 0.58, 0.12, '#a2a6a6', 0, 0.62, 0, 10),
    cyl(0.2, 0.5, 0.14, '#8b9090', 0, 0.74, 0, 8),
  ]) };
  G.upblastFan = { geo: merge([ // curb + seam, venturi, drum, dark throat, grease trap, conduit (164)
    box(0.8, 0.42, 0.8, '#8a8f94', 0, 0, 0),
    box(0.86, 0.06, 0.86, '#6b6f74', 0, 0.42, 0),
    cyl(0.44, 0.36, 0.5, '#9aa0a3', 0, 0.48, 0, 10),
    cyl(0.52, 0.47, 0.32, '#7d8287', 0, 0.98, 0, 10),
    cyl(0.42, 0.42, 0.06, '#17191c', 0, 1.3, 0, 8),
    box(0.2, 0.12, 0.26, '#5c6064', 0.42, 0.42, 0.42),
    cyl(0.03, 0.03, 0.45, '#6b6f74', -0.44, 0.42, -0.3, 4),
  ]) };
  G.gooseneck = { geo: merge([ // riser + 180° head + dark downturned mouth (60)
    cyl(0.09, 0.105, 0.72, '#7d8287', 0, 0, 0, 6),
    tcyl(0.085, 0.085, 0.44, '#8a8f94', 0, 0.76, 0.14, 6, 1.5708),
    box(0.19, 0.05, 0.19, '#1e2124', 0, 0.6, 0.32),
  ]) };
  G.chimneyMasonry = { geo: merge([ // brick shaft, sooty base, mortar band, corbel cap + crown, clay pots (148)
    box(0.9, 2.1, 0.6, '#6b4a3a'),
    box(0.96, 0.5, 0.66, '#4e352a', 0, 0, 0),
    box(0.94, 0.05, 0.64, '#523a2e', 0, 1.15, 0),
    box(1.06, 0.18, 0.76, '#5a3d30', 0, 2.1, 0),
    box(0.98, 0.07, 0.68, '#8a8478', 0, 2.28, 0),
    cyl(0.1, 0.13, 0.4, '#94604a', -0.22, 2.35, 0, 6),
    cyl(0.1, 0.13, 0.4, '#94604a', 0.22, 2.35, 0, 6),
    cyl(0.075, 0.075, 0.05, '#1e2124', -0.22, 2.75, 0, 5),
    cyl(0.075, 0.075, 0.05, '#1e2124', 0.22, 2.75, 0, 5),
  ]) };
  G.roofHatch = { geo: merge([ // curb + seam, tilted lid + nose lip, hasp, yellow grab post (80)
    box(0.95, 0.32, 0.8, '#8a8478', 0, 0, 0),
    box(0.99, 0.05, 0.84, '#6f6a60', 0, 0.32, 0),
    tbox(0.97, 0.09, 0.86, '#8f6f52', 0, 0.44, 0.02, -0.14),
    tbox(0.9, 0.04, 0.1, '#6f543c', 0, 0.5, 0.42, -0.14),
    box(0.1, 0.06, 0.14, '#33363a', 0.32, 0.46, 0.36),
    cyl(0.035, 0.04, 1.05, '#c9a53a', -0.52, 0, -0.32, 5),
  ]) };
  G.guardrail = { geo: merge([ // base plates, posts, sky-lit top rail, mid rail, toe board (84)
    box(0.28, 0.04, 0.28, '#33363a', -1.15, 0, 0),
    box(0.28, 0.04, 0.28, '#33363a', 1.15, 0, 0),
    box(0.05, 1.05, 0.05, '#4a4e54', -1.15, 0.04, 0),
    box(0.05, 1.05, 0.05, '#4a4e54', 1.15, 0.04, 0),
    box(2.42, 0.06, 0.06, '#565b61', 0, 1.06, 0),
    box(2.4, 0.04, 0.04, '#42464c', 0, 0.58, 0),
    box(2.4, 0.1, 0.03, '#3d4147', 0, 0.06, 0),
  ]) };
  G.davit = { geo: merge([ // base flange, pedestal socket, yellow mast + boom, sheave head (112)
    cyl(0.2, 0.26, 0.12, '#33363a', 0, 0, 0, 8),
    cyl(0.15, 0.18, 0.55, '#9aa0a3', 0, 0.12, 0, 8),
    cyl(0.07, 0.085, 1.55, '#c9a53a', 0, 0.67, 0, 6),
    tbox(0.08, 0.08, 1.45, '#c9a53a', 0, 2.24, 0.55, 0.42),
    box(0.1, 0.14, 0.12, '#33363a', 0, 1.9, 1.21),
  ]) };
  G.microwaveDrum = { geo: merge([ // ballast base, mast, bracket, radome drum + dark shroud ring (136)
    box(0.5, 0.08, 0.5, '#42464c', 0, 0, 0),
    cyl(0.055, 0.075, 1.75, '#6b6f74', 0, 0.08, 0, 6),
    box(0.1, 0.26, 0.14, '#33363a', 0, 1.5, 0.06),
    tcyl(0.42, 0.42, 0.32, '#d4d7d4', 0, 1.72, 0.28, 12, 1.5708),
    tcyl(0.45, 0.45, 0.07, '#5c6064', 0, 1.72, 0.13, 10, 1.5708),
  ]) };
  G.dishCluster = { geo: merge([ // foot, mast, 3 dishes + feed arms (168)
    box(0.5, 0.07, 0.5, '#42464c', 0, 0, 0),
    cyl(0.045, 0.06, 1.55, '#6b6f74', 0, 0.07, 0, 6),
    tcyl(0.3, 0.28, 0.05, '#cdd0d5', -0.28, 1.18, 0.14, 8, 1.2),
    tcyl(0.26, 0.24, 0.05, '#bfc2c7', 0.26, 1.42, 0.1, 8, 1.35),
    tcyl(0.22, 0.2, 0.05, '#d7dade', 0.05, 0.88, 0.18, 8, 1.1),
    tbox(0.03, 0.26, 0.03, '#5c6064', -0.28, 1.05, 0.3, 0.9),
    tbox(0.03, 0.24, 0.03, '#5c6064', 0.26, 1.3, 0.26, 0.9),
    tbox(0.03, 0.2, 0.03, '#5c6064', 0.05, 0.77, 0.32, 0.9),
  ]) };
  G.dunnage = { geo: merge([ // rusty I-beam rails: web + lighter top flange + crossbeams (72)
    box(0.1, 0.26, 2.2, '#4e433a', -0.75, 0, 0),
    box(0.1, 0.26, 2.2, '#4e433a', 0.75, 0, 0),
    box(0.2, 0.05, 2.2, '#5c5048', -0.75, 0.26, 0),
    box(0.2, 0.05, 2.2, '#5c5048', 0.75, 0.26, 0),
    box(1.7, 0.16, 0.12, '#42463c', 0, 0.1, -0.8),
    box(1.7, 0.16, 0.12, '#42463c', 0, 0.1, 0.8),
  ]) };
  G.screenWall = { geo: merge([ // 3 posts + base shoes, alternating-tone louvers, top channel (120)
    box(0.08, 1.9, 0.08, '#7d8287', -1.15, 0, 0),
    box(0.08, 1.9, 0.08, '#7d8287', 0, 0, 0),
    box(0.08, 1.9, 0.08, '#7d8287', 1.15, 0, 0),
    box(0.24, 0.05, 0.24, '#33363a', -1.15, 0, 0),
    box(0.24, 0.05, 0.24, '#33363a', 1.15, 0, 0),
    tbox(2.4, 0.08, 0.26, '#a6abae', 0, 0.42, 0, 0.9),
    tbox(2.4, 0.08, 0.26, '#9aa0a3', 0, 0.78, 0, 0.9),
    tbox(2.4, 0.08, 0.26, '#a6abae', 0, 1.14, 0, 0.9),
    tbox(2.4, 0.08, 0.26, '#9aa0a3', 0, 1.5, 0, 0.9),
    box(2.44, 0.07, 0.14, '#6b6f74', 0, 1.86, 0),
  ]) };
  G.sedumTray = { geo: merge([ // tray + rim, sedum mat + green/flowering/red tufts (72)
    box(1.9, 0.14, 0.95, '#57544a'),
    box(1.94, 0.035, 0.99, '#454239', 0, 0.11, 0),
    box(1.8, 0.09, 0.86, '#4f6b33', 0, 0.14, 0),
    box(0.5, 0.1, 0.34, '#5d7a3c', -0.45, 0.2, 0.12),
    box(0.42, 0.09, 0.3, '#6e8a3a', 0.4, 0.2, -0.14),
    box(0.3, 0.08, 0.26, '#7a4a3a', 0.05, 0.2, 0.2),
  ]) };
  // sawtooth monitor: curb, standing-seam sloped roof w/ ribs + bleached ridge
  // flashing, mullioned north glazing + sill, end walls — 6.4m module (144)
  G.sawtoothMonitor = { geo: merge([
    box(6.4, 0.25, 3.0, '#6f6a60', 0, 0, 0),
    tbox(6.4, 0.14, 3.4, '#9aa0a3', 0, 1.0, 0.3, -0.6),
    tbox(6.4, 0.05, 0.3, '#b2b6b8', 0, 1.62, -0.98, -0.6),
    tbox(0.09, 0.06, 3.3, '#7d8287', -2.1, 1.02, 0.3, -0.6),
    tbox(0.09, 0.06, 3.3, '#7d8287', 0, 1.02, 0.3, -0.6),
    tbox(0.09, 0.06, 3.3, '#7d8287', 2.1, 1.02, 0.3, -0.6),
    box(6.4, 1.5, 0.1, '#26313d', 0, 0.25, -1.4),
    box(0.1, 1.5, 0.06, '#6f6a60', -1.6, 0.25, -1.42),
    box(0.1, 1.5, 0.06, '#6f6a60', 1.6, 0.25, -1.42),
    box(6.44, 0.09, 0.12, '#5c574d', 0, 0.25, -1.42),
    box(0.14, 1.45, 2.9, '#6f6a60', -3.13, 0.25, 0),
    box(0.14, 1.45, 2.9, '#6f6a60', 3.13, 0.25, 0)]) };
  // mechanical penthouse: grime base + cap fascia, recessed louver banks w/
  // bright fins (front + side), door reveal + lamp, roof fan + gooseneck (≈332)
  {
    // ROUND 9 (docs/notes/materials-r9.md §3, brief item 3): the body was '#8d9195' —
    // mid-grey sheet metal on all four faces — so a mechanical penthouse read as a grey
    // box whatever else was modelled on it, and at the 100-200 m the film sees a roof
    // from, material is the only thing left. Most Manhattan bulkheads are BRICK with a
    // precast or metal coping and a metal louvre bank, which is also what `ref_lenox.png`
    // shows on every roof in frame. So: brick body, a darker brick plinth, a precast cap
    // (the coping the blind pass specifically called out as missing), and a banding
    // course two-thirds up to break a 7 x 4.2 m face that otherwise has one value.
    // The door, the two louvre banks, the fan and the gooseneck were already here.
    // NOTE for the roof-programme owner: this kit entry is ONE merged geometry shared by
    // every instance, so the brick/stucco CHOICE cannot vary per roof without a second
    // kit id + a roofEngine place() — worth doing, and it is your file, not mine.
    const mp = [
      box(7.0, 4.2, 4.6, '#7c5344'),
      box(7.1, 0.4, 4.7, '#5e4034', 0, 0, 0),
      box(7.12, 0.22, 4.72, '#9a958c', 0, 4.2, 0),
      box(7.06, 0.14, 4.66, '#6a4638', 0, 2.9, 0),
      box(4.6, 2.6, 0.08, '#33373b', 0, 0.9, 2.28),
      box(1.0, 2.1, 0.09, '#2c2f33', -2.55, 0, 2.28),
      box(0.88, 2.0, 0.06, '#4a5058', -2.55, 0.03, 2.31),
      box(0.2, 0.12, 0.14, '#26292c', -2.55, 2.24, 2.33),
      box(0.08, 1.6, 2.0, '#33373b', 3.48, 1.2, 0),
      cyl(0.52, 0.6, 0.5, '#7d8287', 2.0, 4.42, 0.9, 10),
      cyl(0.46, 0.46, 0.05, '#1e2124', 2.0, 4.9, 0.9, 8),
      cyl(0.09, 0.1, 0.6, '#7d8287', -2.2, 4.42, -0.8, 6),
      box(0.24, 0.1, 0.3, '#5c6064', -2.2, 4.98, -0.65),
      cyl(0.04, 0.04, 4.1, '#6b6f74', 3.2, 0, 2.32, 5),
    ];
    for (let i = 0; i < 5; i++) mp.push(tbox(4.5, 0.09, 0.4, '#aeb2b5', 0, 0.95 + i * 0.55, 2.32, 0.85));
    for (let i = 0; i < 4; i++) { // side-bank fins tilt around Z (X-facing wall)
      const f = tbox(0.4, 0.09, 1.9, '#aeb2b5', 0, 0, 0, 0);
      f.rotateZ(-0.85); f.translate(3.52, 0.7 + i * 0.42, 0); mp.push(f);
    }
    G.mechPenthouse = { geo: merge(mp) };
  }
  // pipe run on sleeper cradles + bolted flange plate, 3m module (60 tris)
  G.pipeRun = { geo: merge([
    tcyl(0.085, 0.085, 3.0, '#7d8287', 0, 0.36, 0, 6, 1.5708),
    box(0.44, 0.28, 0.14, '#3a3d40', 0, 0, -1.05),
    box(0.44, 0.28, 0.14, '#3a3d40', 0, 0, 1.05),
    box(0.24, 0.24, 0.05, '#5c6064', 0, 0.24, 0.45)]) };
  // 5G monopole: base flange, tapered mast, splice collar, radome canister on
  // dark base ring, cabinet + cap, cable riser (192)
  G.monopole5G = { geo: merge([
    cyl(0.3, 0.36, 0.1, '#5c6064', 0, 0, 0, 8),
    cyl(0.085, 0.135, 6.3, '#8a8f94', 0, 0.1, 0, 8),
    cyl(0.14, 0.14, 0.12, '#6b6f74', 0, 3.4, 0, 6),
    cyl(0.46, 0.46, 0.08, '#5c6064', 0, 6.32, 0, 6),
    cyl(0.44, 0.44, 1.45, '#cdd0d5', 0, 6.4, 0, 10),
    box(0.7, 1.05, 0.5, '#9aa0a3', 0.62, 0, 0),
    box(0.74, 0.07, 0.54, '#7d8287', 0.62, 1.05, 0),
    cyl(0.035, 0.035, 3.0, '#33363a', 0.17, 0.1, 0.02, 4)]) };
  { // pergola: posts on dark shoes, beams, rafters, purlins, knee braces (240)
    const pg = [];
    for (const [px, pz] of [[-1.6, -1.2], [1.6, -1.2], [-1.6, 1.2], [1.6, 1.2]]) {
      pg.push(box(0.13, 2.25, 0.13, '#6e5a40', px, 0, pz));
      pg.push(box(0.2, 0.1, 0.2, '#3a342c', px, 0, pz));
    }
    pg.push(box(3.7, 0.14, 0.16, '#7a654a', 0, 2.25, -1.2));
    pg.push(box(3.7, 0.14, 0.16, '#7a654a', 0, 2.25, 1.2));
    for (let i = 0; i < 5; i++) pg.push(box(0.11, 0.1, 2.8, '#846e50', -1.5 + i * 0.75, 2.39, 0));
    for (const pz of [-1.05, 0, 1.05]) pg.push(box(3.4, 0.05, 0.07, '#6e5a40', 0, 2.49, pz));
    for (const [px, pz, s] of [[-1.6, -1.2, 1], [1.6, 1.2, -1]]) {
      const b = box(0.08, 0.55, 0.08, '#5f4c36');
      b.rotateZ(s * 0.7); b.translate(px + s * 0.18, 1.85, pz); pg.push(b);
    }
    G.pergola = { geo: merge(pg) };
    // rooftop billboard: lattice frame + tilted ad panel + catwalk (the NYC
    // roofline signature the skyline reads at every angle)
    G.roofBillboard = { geo: merge([
      box(0.14, 3.1, 0.14, '#4a4e54', -2.1, 0, -0.3), box(0.14, 3.1, 0.14, '#4a4e54', 2.1, 0, -0.3),
      box(0.14, 2.4, 0.14, '#4a4e54', -2.1, 0, 0.6, 0.5), box(0.14, 2.4, 0.14, '#4a4e54', 2.1, 0, 0.6, -0.5),
      box(4.6, 0.1, 0.1, '#4a4e54', 0, 1.4, -0.3), box(4.6, 0.1, 0.1, '#4a4e54', 0, 2.9, -0.3),
      tbox(5.0, 2.6, 0.1, '#d8d5cc', 0, 2.55, -0.15, 0.12),
      tbox(4.6, 0.9, 0.04, '#a33b2e', 0, 2.1, -0.205, 0.12),
      tbox(2.6, 0.5, 0.04, '#2e4d78', -0.8, 3.2, -0.235, 0.12),
      box(4.8, 0.08, 0.5, '#5c6066', 0, 1.15, 0.05)]) };
  }
  {
    const parts = [box(0.5, 6.8, 0.5, '#4c5358', -2.6, 0, 0), box(0.5, 6.8, 0.5, '#4c5358', 2.6, 0, 0), box(6.4, 0.7, 0.7, '#3c4348', 0, 6.4, 0)];
    G.viaductPier = { geo: merge(parts), baseH: 7 };
  }
  // ---- marquee
  {
    G.marquee = { geo: merge([box(5.4, 0.75, 2.4, '#8a1c1c', 0, 3.3, 1.2), box(5.6, 0.1, 2.6, '#d4c8a8', 0, 3.2, 1.2)]) };
    const under = new THREE.PlaneGeometry(5.2, 2.2);
    under.rotateX(Math.PI / 2);
    under.translate(0, 3.24, 1.2);
    G.marqueeGlow = { geo: paint(under, C('#ffe9b8')), glow: true };
  }
  // ---- bike rack: the NYC DOT "hoop" rack — 2 in (Ø50 mm) steel, 0.86 m above
  //      grade, 0.75 m wide: two straight legs and a 180° bend, flange-mounted.
  //
  // ROUND 6 (critic round 5 defect 4). The whole rack used to be ONE
  // `TorusGeometry(0.42, 0.045, 6, 12, Math.PI)`. An arc of π spans angle 0…π,
  // i.e. the TOP HALF of a circle — it has no legs at all — and
  // `.translate(0, 0.45, 0)` then put its two ends at y = +0.45, so both legs
  // stopped 45 cm above the pavement ("the rack hoop whose left leg ends in
  // mid-air above the flag"; it was both legs). Tube radius 0.045 is 90 mm pipe
  // on a SIX-sided section, which is the same report's "150 mm fuzzy pale tube",
  // and 12 segments over a half turn made the bend a 15° polygon.
  {
    const T = 0.026, RB = 0.35, LEG = 0.51, ST = '#5c6469';
    G.bikeRack = { geo: merge([
      paint(new THREE.TorusGeometry(RB, T, 7, 20, Math.PI).translate(0, LEG, 0), C(ST)),
      pipe(T, LEG + T, ST, RB, 0, 0, 7),
      pipe(T, LEG + T, ST, -RB, 0, 0, 7),
      cyl(0.052, 0.060, 0.014, '#4a5157', RB, 0, 0, 6),
      cyl(0.052, 0.060, 0.014, '#4a5157', -RB, 0, 0, 6),
    ]) };
  }
  // ---- parking/one-way sign pole. The blades were a white box with a black box
  //      laid on it as an "arrow field" and a red box as a legend, i.e. the
  //      critic's "blank white sign panel on a post" (round 5 §7.8). They now
  //      carry real faces off the shared panel atlas — MUTCD R6-1 ONE WAY and a
  //      NYC parking-regulation sign — one quad per side of a 26 mm plate, so
  //      the art is never mirrored onto the back and no edge samples the atlas.
  //
  //      STANDOFF. A NYC sign post is a 2-2.5 in tube; this one was authored at
  //      r 0.035-0.045 (70-90 mm), and the sign faces went 33 mm off the axis —
  //      i.e. INSIDE the post, which drew the post straight down the middle of
  //      both signs (visible at 35 m in the first canyon5th plate of this pass).
  //      The post is now 52-64 mm, the plate spans z 0.018-0.038 and the faces
  //      sit 2.5 mm off it: the front face clears the post by 12 mm, and the
  //      back face is 12 mm INSIDE it, so from behind the post correctly
  //      occludes the sign's back without ever being coincident with it.
  //      TWO variants (owner 2026-09-15, docs/notes/amst120.md): the ONE WAY blade only belongs on a
  //      one-way street — the compiler sets p1 bit 0 on the pole (compile.mjs sign poles) and
  //      assemble.js picks 'signPoleOneWay'; a two-way street (Amsterdam Ave, W 120th) gets the
  //      parking-regulation sign alone, on the same post.
  {
    const signPoleKit = (oneWay) => {
      const parts = [blankUV(cyl(0.026, 0.032, 3.1, '#4c5358', 0, 0, 0, 6))];
      const blade = (w, h, y, slot) => {
        const f = new THREE.PlaneGeometry(w, h); f.translate(0, y, 0.0405);
        const b = new THREE.PlaneGeometry(w, h); b.rotateY(Math.PI); b.translate(0, y, 0.0155);
        parts.push(atlasUV(paint(f, C('#ffffff')), slot), atlasUV(paint(b, C('#ffffff')), slot));
        parts.push(blankUV(box(w + 0.014, h + 0.014, 0.020, '#9aa1a6', 0, y - (h + 0.014) / 2, 0.028)));
      };
      if (oneWay) blade(0.75, 0.25, 2.80, 'oneWay');
      blade(0.30, 0.46, oneWay ? 2.06 : 2.40, 'parkReg');
      return { geo: merge(parts), tex: true };
    };
    G.signPole = signPoleKit(false);
    G.signPoleOneWay = signPoleKit(true);
  }
  // ---- bollard
  G.bollard = { geo: merge([cyl(0.085, 0.095, 0.85, '#23262a', 0, 0, 0, 8), sphere(0.09, '#23262a', 0, 0.87, 0, 8)]) };
  // ---- NYC pedestrian ramp (ADA curb cut) at a crosswalk end. Origin: sidewalk
  // level at the curb line, +z toward the roadway. The compiled sidewalk slab
  // cannot be carved, so the ramp is expressed by the three things that actually
  // read at eye level: the ramp's own concrete pour, the DETECTABLE WARNING in
  // the bottom 0.61 m of the run, and the depressed curb nose that carries the
  // walk down into the gutter.
  //
  // ROUND 3 (docs/notes/streets-audit.md G5). The old plate was one salmon quad
  // with five darker bands laid ACROSS it, which read as a pink RIBBED slab.
  // A NYC detectable warning is truncated DOMES — PROWAG R305 / NYC DOT std:
  // 23-36 mm base, 41-61 mm on centre, 0.61 m (24 in) deep, full ramp width.
  // One quad pair per dome is ~500 tris a ramp and a junction carries eight, so
  // the grid is drawn INVERTED: one plate quad AT dome-top level, and the shaded
  // gaps BETWEEN the domes as a 60 mm lattice of 26 mm ribs (35 quads, 70 tris).
  // That is a true-pitch dome field for ~14 % of the tri cost, and at 10 m a
  // cell is 5 px across — resolvable, which a 12 cm stipple would not be. The
  // ribs sit 1.5 mm ABOVE the plate rather than below it (a dome field cannot be
  // drawn as recesses under an opaque quad); on a horizontal surface that costs
  // nothing in shading and buys the whole dotted read.
  //
  // Three variants, chosen per junction in streetNYC.js:
  //   curbRamp      brick-red composite — the common NYC look
  //   curbRampIron  bare grey cast iron. Measured at Broadway & Chambers
  //                 (2024-11): the plate reads sRGB (104,105,109) against a flag
  //                 at (106,107,111) in the same light — concrete's own value,
  //                 neutral, legible only by its dome texture. A dark-grey plate
  //                 would be as wrong as a salmon one.
  //   curbRampBare  no plate at all — plenty of older Harlem ramps have none
  //                 (W 125th & Lenox, 2022-06 is plain concrete to the gutter).
  {
    const quad = (a, b, c, d, hex) => {
      // indexed like every other kit primitive (BatchedMesh needs one convention)
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c, ...d]), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(8), 2));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      g.computeVertexNormals();
      return paint(g, C(hex));
    };
    const tri = (a, b, c, hex) => {          // the old flare quads carried a degenerate 2nd tri
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...a, ...b, ...c]), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      return paint(g, C(hex));
    };
    // The instancer trims every prop's albedo by a flat 0.30 (materials.js
    // applyLightTrim) while the ground's asphalt / flag / curb take
    // 0.30 * (1.94, 1.70, 1.47) — the street calibration in
    // docs/notes/streets-audit.md §1. A prop lying ON the sidewalk therefore has
    // to be authored ~1.35/1.28/1.19x brighter than its physical colour or it
    // renders ~30 % darker than the flags it sits in. `st()` does that in ONE
    // place: the values below are physical, and if applyLightTrim ever carries
    // the street calibration for props too (see "Requests for the lead"), drop
    // the three multiplies and nothing else changes.
    // applyLightTrim(baseMat, [1.94, 1.70, 1.47]) now carries the street calibration
    // for every prop (instancer.js), so the values below stay PHYSICAL: st() is
    // the identity it was designed to become.
    const st = (hex) => hex;
    const PITCH = 0.060, RIB = 0.026;        // 60 mm on centre -> 34 mm domes
    const PW = 1.50, PD = 0.61;              // full ramp width x 24 in deep
    // The three levels used to be 10.0 / 11.5 / 12.5 mm — 1.5 mm and 1.0 mm
    // apart, inside ONE merged geometry with one material, so nothing can
    // separate them but their own Y. A 1.5 mm pair holds a stable depth winner
    // only to 20 m at eye level and 85 m in the 120 m aerial (2 LSB of a 24-bit
    // buffer at range d is 2.98e-7 * d^2 metres along the ray, and a horizontal
    // pair only presents dY * h / d of that). Now 10 / 15 mm with the rim ON the
    // rib level and every band's footprint made disjoint, so there are exactly
    // two levels and no pair anywhere in the plate:
    //   - ribs at +5 mm over the plate, which is also a real truncated-dome
    //     height (PROWAG R305 asks 0.2 in = 5.1 mm), so the inverted drawing
    //     now stands the right amount proud instead of a token 1.5 mm;
    //   - the ribs stop 32 mm short of each edge and the two side rim bands
    //     stop 30 mm short of the end bands, so rib/rim and rim/rim no longer
    //     share a footprint at all (the four rim corners used to overlap each
    //     other at exactly the same Y).
    const RIBY = ZFIX ? 0.015 : 0.0115, RIMY = ZFIX ? 0.015 : 0.0125;
    const RIBT = ZFIX ? 0.064 : 0.004, RIMT = ZFIX ? 0.060 : 0.0;
    const warnPlate = (domeHex, gapHex, frameHex) => {
      const p = [hplate(PW, PD, st(domeHex), 0, 0.010, -PD / 2)];
      const nx = Math.floor((PW - RIB) / PITCH), nz = Math.floor((PD - RIB) / PITCH);
      for (let i = 0; i <= nx; i++) p.push(hplate(RIB, PD - RIBT, st(gapHex), -(nx * PITCH) / 2 + i * PITCH, RIBY, -PD / 2));
      for (let j = 0; j <= nz; j++) p.push(hplate(PW - RIBT, RIB, st(gapHex), 0, RIBY, -PD / 2 - (nz * PITCH) / 2 + j * PITCH));
      // cast rim: every NYC plate sits in its own frame, and it is what stops
      // the dome field bleeding into the flags at a distance
      p.push(hplate(PW, 0.030, st(frameHex), 0, RIMY, -0.015),
             hplate(PW, 0.030, st(frameHex), 0, RIMY, -PD + 0.015),
             hplate(0.030, PD - RIMT, st(frameHex), -PW / 2 + 0.015, RIMY, -PD / 2),
             hplate(0.030, PD - RIMT, st(frameHex), PW / 2 - 0.015, RIMY, -PD / 2));
      return p;
    };
    // the ramp's own pour: a 1.5 x 1.25 m concrete pad, a different age from the
    // walk around it. This is what makes a ramp legible in plan, and NO flares —
    // drawn as pool geometry they miss the ground AO and read as folded card.
    // The value is the ground flag's OWN physical albedo (materials.js matId 1
    // authors (0.496..0.571, 0.437..0.501, 0.261..0.299)), because that is the
    // only way to land on the rendered walk: at (180,173,160) the pad came back
    // (197,184,156) against flags at (203,195,180) — 10 luma down but R-B = 41
    // vs 23, a warm rectangle laid on the corner, because `st()` compensates a
    // linear trim while ACES compresses the flag's red into its shoulder and the
    // darker pad's does not. Matching the flag's albedo instead of guessing a
    // "concrete" hex makes the pad nearly invisible, which is correct.
    // THE PAD IS GONE (2026-09-04 z-fight pass, docs/notes/zfight.md B3/B4).
    //
    // It was a single 1.50 x 1.25 m quad laid on the compiled flags, first at
    // +4 mm and then at +2 mm — the +2 mm move was made because "the compiled
    // dome plates sit 4 mm over the flags", but they do not: compile.mjs:2681
    // puts them at BASE_Y + 0.290 = 3.530 against a sidewalk at BASE_Y + 0.28 =
    // 3.520, i.e. 10 mm proud (the comment at compile.mjs:2673 is stale). So the
    // pair the move was aimed at was never at 4 mm, and dropping to +2 mm made
    // the pad's conflict with the SIDEWALK worse instead: at 2 mm it is stable
    // only to 28 m at eye level and 91 m in the 120 m fStreetGeom framing, which
    // is the shimmer on every intersection corner in the video review.
    //
    // There is nothing to trade away by deleting it. Two comments up: the pad is
    // authored to the ground flag's OWN physical albedo precisely so that it is
    // "nearly invisible, which is correct". A layer that renders as the surface
    // underneath it and costs a depth tie is all cost. The depressed nose and
    // the dome plate keep the ramp legible; the census confirms the compiled
    // tiles (t_3_-6, t_4_-6, t_1_-6) all carry warn/warnIron sections, so
    // streetNYC.js is placing curbRampBare — pad plus nose — at every corner.
    const rampPad = () => (ZFIX ? [] : [hplate(PW, 1.25, st('#b9b08d'), 0, 0.002, -0.60)]);
    // depressed curb nose: the pour carried down over the stone into the gutter.
    // Light warm concrete — a NYC ramp apron reads close to the flags it comes
    // out of, never the near-black granite the first pass used.
    const nose = () => {
      const h = st('#b4ab8a');
      return [quad([-0.80, 0.0, 0.0], [-0.80, -0.135, 0.40], [0.80, -0.135, 0.40], [0.80, 0.0, 0.0], h),
              tri([-0.80, 0.0, 0.0], [-1.16, -0.135, 0.40], [-0.80, -0.135, 0.40], h),
              tri([0.80, 0.0, 0.0], [0.80, -0.135, 0.40], [1.16, -0.135, 0.40], h)];
    };
    // Red is authored MORE saturated than a photograph of a plate, for the same
    // reason the bus lane is: the sky fill is blue and adds to G and B, so at a
    // physical (150,80,63) the plate rendered (165,125,115) — R-G = 40 where the
    // dome field should read like weathered brick. (152,58,40) lands it.
    G.curbRamp = { geo: merge([...rampPad(), ...warnPlate('#983a28', '#70281a', '#5c2620'), ...nose()]) };
    G.curbRampIron = { geo: merge([...rampPad(), ...warnPlate('#b0aea9', '#807e7a', '#6b6966'), ...nose()]) };
    G.curbRampBare = { geo: merge([...rampPad(), ...nose()]) };
  }
  // ---- newspaper box (per-instance color)
  G.newsbox = { geo: merge([box(0.46, 0.9, 0.4, '#ffffff', 0, 0.12, 0), box(0.4, 0.3, 0.02, '#d8dce0', 0, 0.62, 0.2), box(0.44, 0.12, 0.38, '#2a2d30', 0, 0, 0)]), perInstanceColor: true };
  // ---- traffic cone
  G.cone = { geo: merge([box(0.34, 0.05, 0.34, '#c24a10'), cyl(0.03, 0.13, 0.52, '#e0561a', 0, 0.05, 0, 8), cyl(0.085, 0.1, 0.09, '#e8e8e6', 0, 0.28, 0, 8)]) };
  // ---- dumpster
  G.dumpster = { geo: merge([box(1.9, 1.15, 1.05, '#2e5238', 0, 0.12, 0), box(1.94, 0.1, 1.09, '#24422c', 0, 1.27, 0), box(0.5, 0.06, 1.0, '#24422c', -0.6, 1.36, 0), box(1.86, 0.12, 1.0, '#1d3423', 0, 0, 0)]) };
  // ---- food cart (steel cart + umbrella)
  G.foodcart = { geo: merge([
    box(2.0, 1.15, 1.1, '#b8bcc0', 0, 0.35, 0),
    box(2.1, 0.08, 1.2, '#9a9ea2', 0, 1.5, 0),
    box(0.5, 0.35, 1.05, '#7a7e82', 0.85, 1.5, 0),
    cyl(0.03, 0.03, 1.6, '#6a6e72', -0.4, 1.5, 0, 6),
    cyl(0.02, 1.35, 0.55, '#c8b400', -0.4, 3.0, 0, 8), // umbrella (yellow)
    cyl(0.18, 0.18, 0.36, '#3a3d40', -0.75, 0, 0.42, 8), cyl(0.18, 0.18, 0.36, '#3a3d40', -0.75, 0, -0.42, 8),
  ]) };
  // ---- tree pit: DIRT bed in a granite frame + the low picket tree guard NYC
  //      Parks specifies around street trees (~0.45 m, pickets ~0.10 m apart)
  {
    const STL = '#1a1d20', STL_D = '#0f1113', H = 0.46;
    const rails = [box(1.5, 0.035, 1.5, '#2b2118')];  // soil bed, proud of the flags
    rails.push(box(1.66, 0.055, 0.09, '#7d7a73', 0, 0, 0.785), box(1.66, 0.055, 0.09, '#7d7a73', 0, 0, -0.785));
    rails.push(box(0.09, 0.055, 1.66, '#7d7a73', 0.785, 0, 0), box(0.09, 0.055, 1.66, '#7d7a73', -0.785, 0, 0));
    for (const [x, z, ax] of [[0, 0.72, 1], [0, -0.72, 1], [0.72, 0, 0], [-0.72, 0, 0]]) {
      const w = ax ? 1.5 : 0.035, d = ax ? 0.035 : 1.5;
      rails.push(box(w, 0.04, d, STL_D, x, H, z));                   // top rail
      rails.push(box(w, 0.028, d, STL_D, x, 0.12, z));               // bottom rail
      for (let i = 0; i < 5; i++) {                                  // pickets
        const t = -0.56 + i * 0.28;
        rails.push(box(0.024, H - 0.10, 0.024, STL, ax ? t : x, 0.10, ax ? z : t));
      }
    }
    for (const [x, z] of [[0.72, 0.72], [-0.72, 0.72], [0.72, -0.72], [-0.72, -0.72]]) {
      rails.push(box(0.045, H + 0.07, 0.045, STL_D, x, 0, z));       // corner posts
    }
    G.treeFence = { geo: merge(rails) };
  }
  return G;
}

// map compiler kinds -> pool names (+ per-kind placement tweaks)
export const KIND_MAP = {
  [FURN.TREE]: 'tree',
  [FURN.LAMP_COBRA]: 'lampCobra', [FURN.LAMP_CROOK]: 'lampCrook',
  [FURN.HYDRANT]: 'hydrant',
  [FURN.SIGNAL_MAST]: 'signalMast', [FURN.SIGNAL_PED]: 'signalPed',
  [FURN.STREET_SIGN]: 'streetSign', [FURN.LITTER]: 'litter', [FURN.MAILBOX]: 'mailbox',
  [FURN.BUS_SHELTER]: 'busShelter', [FURN.SUBWAY_ENTRANCE]: 'subway', [FURN.LINKNYC]: 'linknyc',
  [FURN.NEWSSTAND]: 'newsstand', [FURN.SCAFFOLD]: 'scaffold', [FURN.BENCH]: 'bench',
  [FURN.AWNING]: 'awning', [FURN.STOOP]: 'stoop', [FURN.FIRE_ESCAPE]: 'fireEscape',
  [FURN.WATER_TOWER]: 'waterTower', [FURN.ROOF_AC]: 'roofAC', [FURN.ROOF_BULKHEAD]: 'bulkhead',
  [FURN.STANDPIPE]: 'standpipe', [FURN.MARQUEE]: 'marquee', [FURN.BIKE_RACK]: 'bikeRack',
  33: 'viaductPier', 34: 'signPole', 35: 'bollard', 36: 'newsbox', 37: 'cone', 38: 'dumpster', 39: 'foodcart',
  40: 'ventPipe', 41: 'roofDish', 42: 'roofAntenna', 43: 'skylight', 44: 'ductRun',
  45: 'roofChair', 46: 'roofTable', 47: 'roofPlanter', 48: 'roofUmbrella', 49: 'coolingTower', 50: 'solarPanel',
  51: 'cellSled', 52: 'cellCabinet', 53: 'cableTray', 54: 'mushroomFan', 55: 'upblastFan',
  56: 'gooseneck', 57: 'chimneyMasonry', 58: 'roofHatch', 59: 'guardrail', 60: 'davit',
  61: 'microwaveDrum', 62: 'dishCluster', 63: 'dunnage', 64: 'screenWall', 65: 'sedumTray', 66: 'pergola',
  67: 'sawtoothMonitor', 68: 'mechPenthouse', 69: 'pipeRun', 70: 'monopole5G', 71: 'roofBillboard',
  72: 'curbRamp',
  // ROOF9 (docs/notes/roofs-r9.md): the missing large end of the roof-prop size
  // histogram, plus the stain decal.
  73: 'roofRTU', 74: 'roofPlenum', 75: 'roofPad', 76: 'roofStack', 77: 'roofWalk',
};
// TC13 (docs/notes/canopy-r13.md). THE MATURE CANOPY ENVELOPE, per archetype,
// in METRES at instance scale 1. trees.js normalises its ez-tree build to
// exactly this box (height AND crown diameter — it used to normalise height
// only, so crown width was whatever the preset happened to give after the
// branch-budget cuts: ~5 m where a mature London plane is 10-15 m across), and
// assemble.js sizes every instance against the same numbers. One table, so the
// two halves of the size contract cannot drift apart.
// MEASURED, not guessed: the r12 build's own crown bbox, headless, came out
// 10.1 x 11.5 m (A), 8.0 x 9.0 (B), 5.5 x 7.6 (C) — the crown was never NARROW,
// it was EMPTY (1 260 leaf cards spread through a 10 m bbox reads as an
// armature with clusters on it). So these widths hold the shape the presets
// already have and normalise the VARIANTS onto one envelope; the canopy gain
// comes from leaf density in trees.js and from the per-instance spread in
// assemble.js, not from inflating the geometry.
export const TREE_ARCH = {
  A: { h: 12.6, w: 10.8 },  // London plane / pin oak / linden — the big street tree
  B: { h: 10.6, w: 9.2 },   // honeylocust / ash — airy, high-branched
  C: { h: 8.0, w: 6.0 },    // callery pear / ginkgo — small, upright
};
export const TREE_SPECIES = [
  // s = relative stature (height). TC13 adds w = relative crown SPREAD and c13,
  // the canopy colour; absolute metres live in TREE_ARCH above. `c`/`c13` are an
  // instanceColor MULTIPLIER on the leaf map, i.e. decoded sRGB -> linear before
  // they are applied. MEASURED: our canopy runs yellow-olive against the reference
  // stills (mean foliage G-B 33 where Bedford Ave reads 13) because the r12 `c`
  // column crushes blue to a QUARTER of green in linear. c13 lifts blue only
  // (+0x0b..0x0d) and green a touch (+0x02), at constant luminance — the canopy
  // brightness already matched the reference, it was the hue that did not.
  // ?tc13=0 keeps `c` and ignores `w`.
  { c: 0x3d5026, c13: 0x3d5233, s: 1.0, w: 1.0, arch: 'A' },   // default
  { c: 0x455a2c, c13: 0x455c39, s: 1.15, w: 1.15, arch: 'A' }, // london plane — big, broad-spreading
  { c: 0x506332, c13: 0x50653e, s: 1.0, w: 1.05, arch: 'B' },  // honeylocust — airy, wide
  // 9-11): the middle crown is 7.9 m across where w 0.75 drew 5.1 m; mature Bradford / Cleveland pears are broad ovals
  { c: 0x3a4f26, c13: 0x3a5133, s: 0.85, w: 1.1, arch: 'B' },
  { c: 0x5d6830, c13: 0x5d6a3c, s: 1.0, w: 0.72, arch: 'C' },  // ginkgo — columnar
  { c: 0x2f421f, c13: 0x2f442b, s: 1.08, w: 1.12, arch: 'A' }, // oak — dark, spreading
  { c: 0x375024, c13: 0x375231, s: 1.0, w: 0.95, arch: 'A' },  // linden — pyramidal
  { c: 0x455224, c13: 0x455431, s: 0.95, w: 1.02, arch: 'A' }, // maple
  { c: 0x4f5b34, c13: 0x4f5d40, s: 0.8, w: 0.85, arch: 'B' },  // cherry
  // AR34: classes 9-12 come from public/data/tree_species_extra.json (assemble.js TSX) until the tiles carry them
  { c: 0x3d5026, c13: 0x3d5233, s: 1.0, w: 1.0, arch: 'A' },   // 9 sophora (Japanese pagoda tree)
  { c: 0x3d5026, c13: 0x3d5233, s: 1.0, w: 1.0, arch: 'A' },   // 10 Japanese zelkova
  { c: 0x3d5026, c13: 0x3d5233, s: 1.0, w: 1.0, arch: 'A' },   // 11 ash (green, white)
  { c: 0x3d5026, c13: 0x3d5233, s: 1.08, w: 1.1, arch: 'A' },  // 12 elm (American, Chinese, Siberian)
];

// ---------------------------------------------------------------- TV25 SPECIES FORMS (trees agent, 2026-09-25)
// `?tv25=0` restores the round-14 trees exactly (the ez-tree presets, the A/B/C pools, the c13 crown colours).
//
// Why: 74 % of the census (plane, oak, linden, maple and "other") drew ONE ez-tree preset in three seeds, and the
// rest two more presets; every crown sampled one oak spray; every tree in a row had the road's yaw. TV25 gives each
// species its own habit and architecture (city/treeGen.js), leaf spray (trees.js atlas) and bark, and assemble.js
// routes census species -> forms by TREE_FORM_MIX. Sizing is untouched: TC13/FD14 allometry still reads
// TREE_SPECIES (s, w, arch) and TREE_ARCH, and each form's geometry is built at TREE_ARCH[arch] x (hk, wk) so the
// size contract is the one those rounds calibrated against the references.
//
// Census mix (data/raw/trees_*.csv, 550,730 street trees; p0 decoded in compile.mjs addPoints): plane 14.1 %,
// honeylocust 10.9, pin oak 8.4, Callery pear 6.9, Norway maple 5.5, littleleaf linden 5.1, zelkova 4.9, cherry
// 4.4, ginkgo 3.7, sophora 3.3 ... p0 = 0 ("other", ~25 %) is ~20 % zelkova, ~10 % elms (both vase), ~13 % sophora
// and ~12 % ash (round, compound leaf), ~4 % purple-leaf plum, ~14 % small ornamentals (lilac, raintree, crab,
// redbud, hawthorn, serviceberry), the rest mixed broadleaf -> Z / S / X / W / M below.
//
// Form fields (treeGen.js): profile = crown habit; crownBase = clear-trunk fraction; leader >= 0.6 = excurrent
// (whorled limbs along a central leader, whorlAngle bottom->top in degrees from vertical) else a fork into
// `scaffolds` limbs at scafAngle; kids2/kidAngle2/... = secondaries; twigs/shoots = leaf clumps; cards0/cards1 =
// LOD0/LOD1 leaf-card budgets; cell = leaf-atlas cells (trees.js LEAF_CELLS); bark = bark material; barkTint
// multiplies the bark map.
export const TV25 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('tv25') === '0');
// YOUNG street trees: 23.6 % of the census had dbh <= 4 in in 2015 (29.7 % <= 5), i.e. ~7-9 in and 6-10 m tall now —
// a nursery tree grown on a central leader, limbed up high, a narrow sparse egg of a crown on a slender stem. Scaling a
// mature form down gave them a fat bole and a dense old crown. Pool suffix 9 (treeP9 ...), routed by treePoolFor.
const YOUNG25 = { hk: 0.78, wk: 0.6, profile: 'oval', crownBase: 0.36, lump: 0.18, lopside: 0.1, trunkR: 0.011, lean: 0.03, wiggle: 0.01,
  leader: 0.78, scaffolds: [6, 9], whorlAngle: [62, 36], scafReach: [0.8, 0.96], scafRad: 0.5, kids2: 1.1, kidLenMax2: 0.26,
  cards0: 907, cards1: 138, shell: 0.5, barkSegs: [7, 4, 3] };
export const TREE_FORMS = {
  // London plane: broad, heavy, irregular; a short trunk splits into 4-6 big limbs; mottled camouflage bark
  P: { arch: 'A', variants: 2, seed: 101, young: { ...YOUNG25 }, profile: 'broad', crownBase: 0.27, lump: 0.15, lopside: 0.08,
    trunkR: 0.019, lean: 0.04, wiggle: 0.015, leader: 0.12, scaffolds: [4, 6], forkSpread: 0.26, scafAngle: [30, 62], scafReach: [0.8, 0.97], scafRad: 0.66,
    trop: [0, 0.02, 0.04], gnarl: [0.03, 0.12, 0.2], kids2: 1.5, kidStart2: 0.2, kidAngle2: [35, 65], kidReach2: [0.6, 0.98], kidLenMax2: 0.34, outBias2: 0.4, upBias2: 0.1,
    shootsPerM: 1.82, twigsPerM: 2.31, clump: [3, 5], shootLen: [0.85, 1.15], shootAngle: [25, 65], shootUp: 0.15, scafShoots: 0.5,
    cards0: 1250, cards1: 288, shell: 0.62, cell: [3, 11], opacity: 0.5, roll: 60, bark: 'plane', barkTint: [1, 1, 1], barkSegs: [9, 5, 3] },
  // honeylocust: open vase, zig-zag limbs, fine bipinnate foliage you read the sky through
  H: { arch: 'B', variants: 2, seed: 202, young: { ...YOUNG25, profile: 'vase', scafRad: 0.55, lump: 0.22, cards0: 648 }, profile: 'vase', crownBase: 0.3, lump: 0.18, lopside: 0.1, trunkR: 0.017, lean: 0.06, wiggle: 0.02,
    leader: 0.06, scaffolds: [3, 5], forkSpread: 0.2, scafAngle: [18, 42], scafReach: [0.85, 0.98], scafRad: 0.6,
    trop: [0, 0.05, 0.03], gnarl: [0.03, 0.2, 0.3], kids2: 1.1, kidAngle2: [40, 70], kidReach2: [0.55, 0.95], kidLenMax2: 0.38, outBias2: 0.45, upBias2: 0.05,
    shootsPerM: 1.56, twigsPerM: 2.1, clump: [3, 5], shootLen: [0.7, 0.95], shootAngle: [35, 75], shootUp: 0.05, scafShoots: 0.35,
    cards0: 1339, cards1: 200, shell: 0.55, cell: [5, 13], opacity: 0.32, roll: 70, bark: 'willow', barkTint: [0.62, 0.6, 0.58] },
  // Callery pear: a dense upright egg; many tight-crotched limbs from a low fork; small glossy leaves
  R: { arch: 'B', variants: 1, seed: 303, young: { ...YOUNG25, whorlAngle: [40, 22], wk: 0.5 }, profile: 'oval', crownBase: 0.2, lump: 0.08, lopside: 0.04, trunkR: 0.016, lean: 0.02,
    leader: 0.05, scaffolds: [6, 9], forkSpread: 0.14, scafAngle: [12, 32], scafReach: [0.85, 0.97], scafRad: 0.5,
    trop: [0, 0.07, 0.06], gnarl: [0.02, 0.08, 0.16], kids2: 2.2, kidAngle2: [28, 50], kidReach2: [0.55, 0.9], kidLenMax2: 0.3, outBias2: 0.3, upBias2: 0.2,
    shootsPerM: 2.08, twigsPerM: 2.52, clump: [3, 5], shootLen: [0.55, 0.75], shootAngle: [25, 55], shootUp: 0.25, scafShoots: 0.6,
    cards0: 1300, cards1: 250, shell: 0.7, cell: [6, 14], opacity: 0.55, roll: 50, bark: 'oak', barkTint: [0.7, 0.68, 0.66] },
  // pin oak: pyramidal, a central leader to the top, drooping lower limbs, ascending upper ones
  Q: { arch: 'A', variants: 1, seed: 404, young: { ...YOUNG25, profile: 'pyramid', whorlAngle: [88, 45], leader: 0.9 }, profile: 'pyramid', crownBase: 0.25, lump: 0.1, lopside: 0.05, trunkR: 0.017, lean: 0.02,
    leader: 0.92, scaffolds: [11, 15], whorlAngle: [96, 46], scafReach: [0.8, 0.96], scafRad: 0.42,
    trop: [0, -0.02, 0.02], gnarl: [0.02, 0.1, 0.18], kids2: 1.5, kidAngle2: [35, 60], kidReach2: [0.5, 0.9], kidLenMax2: 0.26, outBias2: 0.25, upBias2: 0.02,
    shootsPerM: 1.82, twigsPerM: 2.31, clump: [3, 5], shootLen: [0.7, 0.9], shootAngle: [25, 60], shootUp: 0.1, scafShoots: 0.55,
    cards0: 1944, cards1: 275, shell: 0.6, cell: [0], opacity: 0.48, roll: 60, bark: 'oak', barkTint: [0.78, 0.78, 0.76] },
  // Norway / red maple: round and dense (deep shade), 4-6 limbs from a short trunk
  M: { arch: 'A', variants: 1, seed: 505, young: { ...YOUNG25, profile: 'round', wk: 0.66 }, profile: 'round', crownBase: 0.24, lump: 0.1, lopside: 0.06, trunkR: 0.018, lean: 0.03,
    leader: 0.12, scaffolds: [4, 6], forkSpread: 0.3, scafAngle: [42, 68], scafReach: [0.8, 0.96], scafRad: 0.62,
    trop: [0, 0.03, 0.05], gnarl: [0.02, 0.1, 0.18], kids2: 1.8, kidAngle2: [35, 60], kidReach2: [0.6, 0.95], kidLenMax2: 0.32, outBias2: 0.35, upBias2: 0.12,
    shootsPerM: 2.08, twigsPerM: 2.52, clump: [3, 6], shootLen: [0.7, 0.95], shootAngle: [25, 60], shootUp: 0.2, scafShoots: 0.5,
    cards0: 1400, cards1: 300, shell: 0.68, cell: [4, 12], opacity: 0.55, roll: 55, bark: 'willow', barkTint: [0.74, 0.7, 0.66] },
  // littleleaf / silver linden: a dense egg-pyramid on a central leader
  L: { arch: 'A', variants: 1, seed: 606, young: { ...YOUNG25, whorlAngle: [70, 40] }, profile: 'oval', crownBase: 0.2, lump: 0.08, lopside: 0.04, trunkR: 0.016, lean: 0.02,
    leader: 0.8, scaffolds: [9, 13], whorlAngle: [80, 45], scafReach: [0.82, 0.96], scafRad: 0.45,
    trop: [0, 0.02, 0.04], gnarl: [0.02, 0.1, 0.16], kids2: 1.8, kidAngle2: [35, 60], kidReach2: [0.55, 0.92], kidLenMax2: 0.28, outBias2: 0.3, upBias2: 0.1,
    shootsPerM: 2.08, twigsPerM: 2.52, clump: [3, 5], shootLen: [0.6, 0.85], shootAngle: [25, 60], shootUp: 0.15, scafShoots: 0.55,
    cards0: 1300, cards1: 275, shell: 0.66, cell: [2], opacity: 0.52, roll: 55, bark: 'willow', barkTint: [0.8, 0.77, 0.74] },
  // ginkgo: columnar-irregular, sparse, fan leaves in spur clusters along the limbs
  G: { arch: 'C', variants: 1, seed: 707, profile: 'columnar', crownBase: 0.22, lump: 0.2, lopside: 0.08, trunkR: 0.02, lean: 0.02,
    leader: 0.9, scaffolds: [6, 9], whorlAngle: [70, 40], scafReach: [0.75, 0.95], scafRad: 0.42,
    trop: [0, 0.04, 0.03], gnarl: [0.01, 0.06, 0.12], kids2: 0.8, kidAngle2: [30, 55], kidReach2: [0.4, 0.8], kidLenMax2: 0.3, outBias2: 0.2, upBias2: 0.15,
    shootsPerM: 1.56, twigsPerM: 1.68, clump: [3, 4], shootLen: [0.45, 0.6], shootAngle: [20, 50], shootUp: 0.2, scafShoots: 0.3, spurs: 2.4,
    cards0: 907, cards1: 138, shell: 0.5, cell: [7], opacity: 0.4, roll: 60, bark: 'oak', barkTint: [0.72, 0.68, 0.64] },
  // cherry (Kwanzan / Yoshino): wide, low, spreading from a low fork
  Y: { arch: 'B', variants: 1, seed: 808, profile: 'spreading', crownBase: 0.24, lump: 0.14, lopside: 0.08, trunkR: 0.017, lean: 0.05,
    leader: 0.05, scaffolds: [3, 5], forkSpread: 0.16, scafAngle: [35, 58], scafReach: [0.85, 0.97], scafRad: 0.6,
    trop: [0, 0.02, 0.0], gnarl: [0.03, 0.14, 0.22], kids2: 1.6, kidAngle2: [35, 65], kidReach2: [0.6, 0.95], kidLenMax2: 0.34, outBias2: 0.4, upBias2: 0.05,
    shootsPerM: 1.82, twigsPerM: 2.31, clump: [3, 5], shootLen: [0.55, 0.75], shootAngle: [30, 70], shootUp: 0.0, scafShoots: 0.5,
    cards0: 1405, cards1: 200, shell: 0.6, cell: [9], opacity: 0.5, roll: 60, bark: 'birch', barkTint: [0.45, 0.3, 0.26] },
  // zelkova / elm: a tall vase of many upright limbs arching out at the top
  Z: { arch: 'A', variants: 1, seed: 909, young: { ...YOUNG25, profile: 'vase', leader: 0.1, scaffolds: [5, 7], scafAngle: [14, 30], scafRad: 0.5 }, profile: 'vase', crownBase: 0.24, lump: 0.12, lopside: 0.06, trunkR: 0.017, lean: 0.03,
    leader: 0.05, scaffolds: [5, 8], forkSpread: 0.2, scafAngle: [16, 38], scafReach: [0.88, 0.98], scafRad: 0.5,
    trop: [0, 0.04, 0.02], gnarl: [0.02, 0.1, 0.2], kids2: 1.7, kidAngle2: [30, 60], kidReach2: [0.55, 0.95], kidLenMax2: 0.32, outBias2: 0.45, upBias2: 0.05,
    shootsPerM: 1.82, twigsPerM: 2.31, clump: [3, 5], shootLen: [0.6, 0.8], shootAngle: [30, 65], shootUp: 0.05, scafShoots: 0.45,
    cards0: 1300, cards1: 263, shell: 0.62, cell: [8], opacity: 0.45, roll: 60, bark: 'birch', barkTint: [0.62, 0.6, 0.56] },
  // sophora / ash: round and broad, compound leaves
  S: { arch: 'A', variants: 1, seed: 1010, profile: 'round', crownBase: 0.3, lump: 0.14, lopside: 0.07, trunkR: 0.017, lean: 0.04,
    leader: 0.12, scaffolds: [4, 6], forkSpread: 0.26, scafAngle: [40, 66], scafReach: [0.8, 0.96], scafRad: 0.62,
    trop: [0, 0.02, 0.03], gnarl: [0.03, 0.12, 0.2], kids2: 1.5, kidAngle2: [35, 65], kidReach2: [0.6, 0.95], kidLenMax2: 0.34, outBias2: 0.4, upBias2: 0.08,
    shootsPerM: 1.69, twigsPerM: 2.1, clump: [3, 5], shootLen: [0.75, 1.0], shootAngle: [30, 65], shootUp: 0.1, scafShoots: 0.45,
    cards0: 1728, cards1: 250, shell: 0.6, cell: [1], opacity: 0.4, roll: 60, bark: 'oak', barkTint: [0.7, 0.68, 0.64] },
  // purple-leaf plum: a small dark-purple ornamental (the one non-green crown on many blocks)
  X: { arch: 'A', variants: 1, seed: 1111, hk: 0.55, wk: 0.65, profile: 'round', crownBase: 0.25, lump: 0.12, lopside: 0.07, trunkR: 0.02, lean: 0.05,
    leader: 0.08, scaffolds: [3, 5], forkSpread: 0.18, scafAngle: [35, 60], scafReach: [0.85, 0.97], scafRad: 0.6,
    trop: [0, 0.03, 0.02], gnarl: [0.03, 0.14, 0.22], kids2: 1.8, kidAngle2: [35, 60], kidReach2: [0.6, 0.95], kidLenMax2: 0.36, outBias2: 0.35, upBias2: 0.1,
    shootsPerM: 1.95, twigsPerM: 2.52, clump: [3, 5], shootLen: [0.5, 0.65], shootAngle: [30, 65], shootUp: 0.1, scafShoots: 0.5,
    cards0: 1123, cards1: 163, shell: 0.62, cell: [10], opacity: 0.52, roll: 60, bark: 'birch', barkTint: [0.4, 0.3, 0.28] },
  // small green ornamental (crab apple, hawthorn, lilac, redbud, serviceberry)
  W: { arch: 'A', variants: 1, seed: 1212, hk: 0.55, wk: 0.65, profile: 'spreading', crownBase: 0.25, lump: 0.16, lopside: 0.1, trunkR: 0.019, lean: 0.06,
    leader: 0.06, scaffolds: [3, 6], forkSpread: 0.2, scafAngle: [30, 62], scafReach: [0.85, 0.97], scafRad: 0.58,
    trop: [0, 0.03, 0.01], gnarl: [0.04, 0.16, 0.24], kids2: 1.8, kidAngle2: [35, 65], kidReach2: [0.6, 0.95], kidLenMax2: 0.36, outBias2: 0.35, upBias2: 0.05,
    shootsPerM: 1.95, twigsPerM: 2.52, clump: [3, 5], shootLen: [0.5, 0.65], shootAngle: [30, 65], shootUp: 0.05, scafShoots: 0.5,
    cards0: 1123, cards1: 163, shell: 0.62, cell: [9, 8], opacity: 0.5, roll: 60, bark: 'oak', barkTint: [0.62, 0.58, 0.54] },
};
// TV25 EARLY FETCH of the baked tree set (public/models/trees25, tools/bake_trees.mjs). Started when this module is first
// imported — the instancer, at the top of the boot — so the two requests are not queued behind the tile stream and the
// fleet/crowd asset banks: fetched from trees.js at its import they took 41-78 s to arrive (ab2, sweep1) for 16-91 ms of
// main-thread work. trees.js consumes the promises; a failed fetch resolves to null (-> runtime generation there).
export const TV25_BAKE = (TV25 && typeof window !== 'undefined' && typeof fetch === 'function' && !/(^|[?&])tv25gen=1/.test(location.search))
  ? {
    t0: performance.now(),
    json: fetch('models/trees25/trees25.json', { priority: 'high' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    bin: fetch('models/trees25/trees25.bin', { priority: 'high' }).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null),
  }
  : null;
// census species (p0, TREE_SPECIES index) -> weighted forms
export const TREE_FORM_MIX = {
  0: [['Z', 0.32], ['S', 0.25], ['M', 0.15], ['W', 0.2], ['X', 0.08]],   // other
  1: [['P', 1]], 2: [['H', 1]], 3: [['R', 1]], 4: [['G', 1]], 5: [['Q', 1]], 6: [['L', 1]],
  7: [['M', 0.93], ['X', 0.07]],   // maple (~5 % of the city's maples are 'Crimson King' purple)
  8: [['Y', 0.8], ['X', 0.2]],     // cherry ('Schubert' chokecherry is purple all summer: ~15 % of the class)
  9: [['S', 1]], 10: [['Z', 1]], 11: [['S', 1]], 12: [['Z', 1]],   // AR34: sophora, zelkova, ash, elm (assemble.js TSX)
};
// every TV25 pool base name ('treeP', 'treeP2', ...): trees.js builds them, furnitureKit/instancer allocate them
export const TV25_POOLS = [];
for (const [id, F] of Object.entries(TREE_FORMS)) {
  for (let v = 0; v < (F.variants || 1); v++) TV25_POOLS.push('tree' + id + (v ? String(v + 1) : ''));
  if (F.young) TV25_POOLS.push('tree' + id + '9');
}
// the build spec of one pool ('treeP2', 'treeQ9' ...): form (suffix 9 = its YOUNG sub-form), target box and seed. ONE
// definition for the offline bake (tools/bake_trees.mjs) and the runtime fallback (trees.js), so both build the same tree.
export function tv25Spec(base) {
  const id = base.slice(4).replace(/\d+$/, ''), suf = base.slice(4 + id.length);
  const F0 = TREE_FORMS[id];
  if (!F0) return null;
  const young = suf === '9', v = young ? 9 : (parseInt(suf, 10) || 1) - 1;
  const F = young ? { ...F0, ...F0.young } : F0;
  const A = TREE_ARCH[F.arch] || TREE_ARCH.A;
  const kv = 0.94 + 0.12 * (((F.seed * 13 + v * 71) % 97) / 97);   // per-variant envelope jitter
  return { id, v, young, F, H: A.h * (F.hk ?? 1) * kv, W: A.w * (F.wk ?? 1) * kv, seed: F.seed + v * 7717 };
}
const _h25 = (x, z, k) => { const s = Math.sin(x * (91.7 + k) + z * (47.3 - k * 0.37) + k * 13.1) * 43758.5453; return s - Math.floor(s); };
// assemble.js: the pool base name for a census tree at world (x, z) — form by the species mix, variant by hash
export function treePoolFor(p0, x, z, dbh = 99, p2 = 0) {
  const mix = TREE_FORM_MIX[p0] || TREE_FORM_MIX[0];
  let u = _h25(x, z, 1), id = mix[0][0];
  for (const [f, w] of mix) { id = f; if ((u -= w) < 0) break; }
  if ((p2 & 1) && dbh <= 4 && TREE_FORMS[id].young) return 'tree' + id + '9';   // a census sapling of 2015
  const nv = TREE_FORMS[id].variants || 1;
  const v = Math.min(nv - 1, (_h25(x, z, 2) * nv) | 0);
  return 'tree' + id + (v ? String(v + 1) : '');
}
