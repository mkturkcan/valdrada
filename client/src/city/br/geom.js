// The bridge kit's geometry bag: indexed triangles per material in growable typed arrays (position, normal, uv in metres),
// so a bridge of a few hundred thousand members builds in a few hundred milliseconds and draws as one mesh per material.
// Every primitive takes world coordinates ([x, y, z] arrays); faces are wound counter-clockwise seen from outside.
import * as THREE from 'three';

class Buf {
  constructor(n = 4096) { this.p = new Float32Array(n * 3); this.n = new Float32Array(n * 3); this.u = new Float32Array(n * 2); this.i = new Uint32Array(n * 3); this.nv = 0; this.ni = 0; }
  growV(k) {
    if (this.nv + k <= this.p.length / 3) return;
    let cap = this.p.length / 3; while (cap < this.nv + k) cap *= 2;
    const p = new Float32Array(cap * 3); p.set(this.p); this.p = p;
    const n = new Float32Array(cap * 3); n.set(this.n); this.n = n;
    const u = new Float32Array(cap * 2); u.set(this.u); this.u = u;
  }
  growI(k) {
    if (this.ni + k <= this.i.length) return;
    let cap = this.i.length; while (cap < this.ni + k) cap *= 2;
    const i = new Uint32Array(cap); i.set(this.i); this.i = i;
  }
  v(x, y, z, nx, ny, nz, u, w) {
    const k = this.nv++;
    this.p[k * 3] = x; this.p[k * 3 + 1] = y; this.p[k * 3 + 2] = z;
    this.n[k * 3] = nx; this.n[k * 3 + 1] = ny; this.n[k * 3 + 2] = nz;
    this.u[k * 2] = u; this.u[k * 2 + 1] = w;
    return k;
  }
  t(a, b, c) { const k = this.ni; this.i[k] = a; this.i[k + 1] = b; this.i[k + 2] = c; this.ni += 3; }
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const V = { sub, add, mul, dot, cross, len, norm };

export class GeoBag {
  // o.chunk: a function of a world point giving the key of the chunk a primitive belongs to (the kit's LOD pieces);
  // o.lod: the level being built (0 full, 1 coarse: the parts leave out what a coarse level does not draw)
  constructor(o = {}) { this.chunks = new Map(); this.tris = 0; this.chunk = o.chunk || null; this.lod = o.lod || 0; this._key = null; }
  // the buffer of material `mat` in the chunk of point p (or the chunk a compound primitive fixed with hold())
  buf(mat, p) {
    const k = this._key !== null ? this._key : this.chunk && p ? this.chunk(p) : 0;
    let m = this.chunks.get(k); if (!m) this.chunks.set(k, (m = new Map()));
    let b = m.get(mat); if (!b) m.set(mat, (b = new Buf()));
    return b;
  }
  // keep every face drawn by f() in the chunk of point p (a box's faces stay together)
  hold(p, f) { if (this._key !== null || !this.chunk) { f(); return; } this._key = this.chunk(p); try { f(); } finally { this._key = null; } }

  // a planar quad a b c d (counter-clockwise seen along -n), normal n, uv from the plane axes (metres)
  quad(mat, a, b, c, d, n) {
    const B = this.buf(mat, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2]); B.growV(4); B.growI(6);
    if (!n) n = norm(cross(sub(b, a), sub(d, a)));
    else if (dot(cross(sub(b, a), sub(c, a)), n) < 0) { const t = b; b = d; d = t; }   // wound to face n
    const ex = norm(sub(b, a)), ey = cross(n, ex);
    const uv = (p) => [dot(sub(p, a), ex), dot(sub(p, a), ey)];
    const k = B.nv;
    for (const p of [a, b, c, d]) { const [u, w] = uv(p); B.v(p[0], p[1], p[2], n[0], n[1], n[2], u, w); }
    B.t(k, k + 1, k + 2); B.t(k, k + 2, k + 3);
    this.tris += 2;
  }
  // a convex planar polygon (fan), normal n
  poly(mat, pts, n) {
    if (pts.length < 3) return;
    const B = this.buf(mat, pts[0]); B.growV(pts.length); B.growI((pts.length - 2) * 3);
    if (n) { let ar = [0, 0, 0]; for (let i = 1; i + 1 < pts.length; i++) ar = add(ar, cross(sub(pts[i], pts[0]), sub(pts[i + 1], pts[0]))); if (dot(ar, n) < 0) pts = pts.slice().reverse(); }
    const a = pts[0];
    n = n || norm(cross(sub(pts[1], a), sub(pts[2], a)));
    const ex = norm(sub(pts[1], a)), ey = cross(n, ex);
    const k = B.nv;
    for (const p of pts) { const q = sub(p, a); B.v(p[0], p[1], p[2], n[0], n[1], n[2], dot(q, ex), dot(q, ey)); }
    for (let i = 1; i + 1 < pts.length; i++) B.t(k, k + i, k + i + 1);
    this.tris += pts.length - 2;
  }
  // an oriented box: centre c, unit axes ex ey ez (right-handed), half sizes hx hy hz; `skip` a set of faces to leave out
  // ('+x', '-x', '+y', '-y', '+z', '-z')
  obox(mat, c, ex, ey, ez, hx, hy, hz, skip = null) {
    const P = (sx, sy, sz) => [c[0] + ex[0] * hx * sx + ey[0] * hy * sy + ez[0] * hz * sz, c[1] + ex[1] * hx * sx + ey[1] * hy * sy + ez[1] * hz * sz, c[2] + ex[2] * hx * sx + ey[2] * hy * sy + ez[2] * hz * sz];
    const F = [
      ['+x', ex, [P(1, -1, 1), P(1, -1, -1), P(1, 1, -1), P(1, 1, 1)]],
      ['-x', mul(ex, -1), [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)]],
      ['+y', ey, [P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1), P(-1, 1, -1)]],
      ['-y', mul(ey, -1), [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]],
      ['+z', ez, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]],
      ['-z', mul(ez, -1), [P(1, -1, -1), P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1)]],
    ];
    this.hold(c, () => { for (const [k, n, q] of F) if (!skip || !skip.has(k)) this.quad(mat, q[0], q[1], q[2], q[3], n); });
  }
  // an axis-aligned box from (x0, y0, z0) to (x1, y1, z1)
  aabb(mat, x0, y0, z0, x1, y1, z1, skip) {
    this.obox(mat, [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2], [1, 0, 0], [0, 1, 0], [0, 0, 1], (x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2, skip);
  }
  // a straight member of rectangular section from A to B: `w` wide along `side` (default: horizontal, across the member),
  // `h` deep in the plane of the member and `up`; ends capped
  beam(mat, A, B, w, h, up = [0, 1, 0], caps = true) {
    const d = sub(B, A), L = len(d);
    if (L < 1e-4) return;
    const ez = mul(d, 1 / L);
    let ex = cross(up, ez);
    if (len(ex) < 1e-4) ex = cross([1, 0, 0], ez);
    ex = norm(ex);
    const ey = cross(ez, ex);
    this.obox(mat, mul(add(A, B), 0.5), ex, ey, ez, w / 2, h / 2, L / 2, caps ? null : CAPLESS);
  }
  // a round member (n sides, smooth) from A to B of radius r (r1 at B when given)
  rod(mat, A, B, r, n = 6, r1 = r, caps = false) {
    if (this.lod && Math.max(r, r1) < 0.1) return;   // (thin rods: stays, hangers, lamp posts have no coarse level)
    const d = sub(B, A), L = len(d);
    if (L < 1e-4) return;
    const ez = mul(d, 1 / L);
    let ex = cross(Math.abs(ez[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], ez); ex = norm(ex);
    const ey = cross(ez, ex);
    const B_ = this.buf(mat, [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]); B_.growV(2 * (n + 1)); B_.growI(6 * n);
    const k = B_.nv;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      const nx = ex[0] * ca + ey[0] * sa, ny = ex[1] * ca + ey[1] * sa, nz = ex[2] * ca + ey[2] * sa;
      const u = a * r;
      B_.v(A[0] + nx * r, A[1] + ny * r, A[2] + nz * r, nx, ny, nz, u, 0);
      B_.v(B[0] + nx * r1, B[1] + ny * r1, B[2] + nz * r1, nx, ny, nz, u, L);
    }
    for (let i = 0; i < n; i++) { const a = k + i * 2; B_.t(a, a + 2, a + 1); B_.t(a + 1, a + 2, a + 3); }
    this.tris += 2 * n;
    if (caps) this.hold([(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2], () => { this.disc(mat, A, mul(ez, -1), r, n); this.disc(mat, B, ez, r1, n); });
  }
  // a flat disc (n-gon) at c facing n
  disc(mat, c, n, r, sides = 8) {
    let ex = cross(Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], n); ex = norm(ex);
    const ey = cross(n, ex);
    const pts = [];
    for (let i = 0; i < sides; i++) { const a = (i / sides) * Math.PI * 2; pts.push(add(c, add(mul(ex, Math.cos(a) * r), mul(ey, Math.sin(a) * r)))); }
    this.poly(mat, pts, n);
  }
  // a smooth tube along a polyline of points (parallel-transported frames), radius r (a number or a function of i)
  tube(mat, pts, r, n = 8) {
    if (pts.length < 2) return;
    if (this.lod) n = Math.min(n, 6);
    if (this.chunk && this._key === null) {
      // one run per chunk, each sharing its last point with the next run's first
      const runs = [];
      let cur = [pts[0]], key = this.chunk(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        cur.push(pts[i]);
        const k = this.chunk(pts[i]);
        if (k !== key && i < pts.length - 1) { runs.push([key, cur]); cur = [pts[i]]; key = k; }
      }
      runs.push([key, cur]);
      if (runs.length > 1) { for (const [k, run] of runs) if (run.length >= 2) { this._key = k; try { this.tube(mat, run, r, n); } finally { this._key = null; } } return; }
    }
    const B = this.buf(mat, pts[0]); B.growV(pts.length * (n + 1)); B.growI((pts.length - 1) * n * 6);
    let t0 = norm(sub(pts[1], pts[0]));
    let ex = cross(Math.abs(t0[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0], t0); ex = norm(ex);
    const k0 = B.nv;
    let run = 0;
    for (let j = 0; j < pts.length; j++) {
      const t = norm(j === 0 ? sub(pts[1], pts[0]) : j === pts.length - 1 ? sub(pts[j], pts[j - 1]) : sub(pts[j + 1], pts[j - 1]));
      ex = norm(sub(ex, mul(t, dot(ex, t))));   // parallel transport
      const ey = cross(t, ex);
      if (j > 0) run += len(sub(pts[j], pts[j - 1]));
      const rr = typeof r === 'function' ? r(j) : r;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const nx = ex[0] * ca + ey[0] * sa, ny = ex[1] * ca + ey[1] * sa, nz = ex[2] * ca + ey[2] * sa;
        B.v(pts[j][0] + nx * rr, pts[j][1] + ny * rr, pts[j][2] + nz * rr, nx, ny, nz, a * rr, run);
      }
    }
    for (let j = 0; j + 1 < pts.length; j++) for (let i = 0; i < n; i++) {
      const a = k0 + j * (n + 1) + i, b = a + n + 1;
      B.t(a, a + 1, b); B.t(a + 1, b + 1, b);
    }
    this.tris += (pts.length - 1) * n * 2;
  }
  // a closed prism: footprint `F` ([x, z] counter-clockwise or not) from y0 to y1, with top and bottom (convex footprints)
  prism(mat, F, y0, y1, o = {}) {
    let cx0 = 0, cz0 = 0; for (const p of F) { cx0 += p[0] / F.length; cz0 += p[1] / F.length; }
    this.hold([cx0, (y0 + y1) / 2, cz0], () => this._prism(mat, F, y0, y1, o));
  }
  _prism(mat, F, y0, y1, o) {
    let cx = 0, cz = 0; for (const p of F) { cx += p[0] / F.length; cz += p[1] / F.length; }
    let area = 0; for (let i = 0; i < F.length; i++) { const a = F[i], b = F[(i + 1) % F.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const G = area > 0 ? F.slice().reverse() : F;   // clockwise in (x, z) = counter-clockwise seen from above (+y), z south
    if (o.top !== false) this.poly(mat, G.map(([x, z]) => [x, y1, z]), [0, 1, 0]);
    if (o.bot !== false) this.poly(mat, G.slice().reverse().map(([x, z]) => [x, y0, z]), [0, -1, 0]);
    for (let i = 0; i < G.length; i++) {
      const a = G[i], b = G[(i + 1) % G.length];
      const n = norm([-(b[1] - a[1]), 0, b[0] - a[0]]);   // (G runs clockwise in x, z: outward is to the edge's left)
      this.quad(mat, [a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n);
    }
  }
  // sweep an open or closed cross-section along frames: frames [{ p: [x, y, z], ex: across, ey: up }], profile [[u, v]]
  // in (across, up); `closed` joins the profile's last point to its first. Flat-shaded per profile edge.
  sweep(mat, frames, profile, closed = false) {
    const m = profile.length, E = closed ? m : m - 1;
    for (let e = 0; e < E; e++) {
      const [ua, va] = profile[e], [ub, vb] = profile[(e + 1) % m];
      for (let j = 0; j + 1 < frames.length; j++) {
        const F0 = frames[j], F1 = frames[j + 1];
        const P = (F, u, v) => add(F.p, add(mul(F.ex, u), mul(F.ey, v)));
        const a = P(F0, ua, va), b = P(F0, ub, vb), c = P(F1, ub, vb), d = P(F1, ua, va);
        // outward normal: the edge's normal in the profile plane, turned into the frame
        const nu = vb - va, nv = -(ub - ua), nl = Math.hypot(nu, nv) || 1;
        const n = norm(add(mul(F0.ex, nu / nl), mul(F0.ey, nv / nl)));
        this.quad(mat, a, d, c, b, n);
      }
    }
  }
  // a three.js geometry (an extruded shape, a lathe) put in place by `m` (THREE.Matrix4) and added to the bag
  addGeometry(mat, g, m) {
    const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
    const idx = g.index ? g.index.array : null, nv = pos.count, ni = idx ? idx.length : nv;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const cc = g.boundingSphere.center.clone().applyMatrix4(m);
    const B = this.buf(mat, [cc.x, cc.y, cc.z]); B.growV(nv); B.growI(ni);
    const e = m.elements, k = B.nv;
    const nm = new THREE.Matrix3().getNormalMatrix(m).elements;
    for (let i = 0; i < nv; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14];
      let nx = 0, ny = 1, nz = 0;
      if (nrm) { const a = nrm.getX(i), b = nrm.getY(i), c = nrm.getZ(i); nx = nm[0] * a + nm[3] * b + nm[6] * c; ny = nm[1] * a + nm[4] * b + nm[7] * c; nz = nm[2] * a + nm[5] * b + nm[8] * c; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; }
      B.v(px, py, pz, nx, ny, nz, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
    }
    const flip = m.determinant() < 0;
    for (let i = 0; i + 2 < ni; i += 3) {
      const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
      if (flip) B.t(k + a, k + c, k + b); else B.t(k + a, k + b, k + c);
    }
    this.tris += ni / 3;
  }
  // the meshes, one per material (indexed), into `group`
  flush(group, name, o = {}) {
    let tris = 0;
    for (const m of this.chunks.values()) for (const [mat, B] of m) tris += this._mesh(group, name, mat, B, o);
    this.chunks.clear();
    return tris;
  }
  // one group per chunk: Map key -> { group, tris }
  flushChunks(name, o = {}) {
    const out = new Map();
    for (const [k, m] of this.chunks) {
      const group = new THREE.Group();
      let tris = 0;
      for (const [mat, B] of m) tris += this._mesh(group, name, mat, B, o);
      out.set(k, { group, tris });
    }
    this.chunks.clear();
    return out;
  }
  _mesh(group, name, mat, B, o) {
    {
      if (!B.ni) return 0;
      const g = new THREE.BufferGeometry();
      if (mat.userData?.brStone) B = stoneize(B, mat.userData.brStone, this.lod);
      g.setAttribute('position', new THREE.BufferAttribute(B.p.slice(0, B.nv * 3), 3));
      g.setAttribute('normal', new THREE.BufferAttribute(B.n.slice(0, B.nv * 3), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(B.u.slice(0, B.nv * 2), 2));
      if (B.c) g.setAttribute('color', new THREE.BufferAttribute(B.c.slice(0, B.nv * 3), 3));
      g.setIndex(new THREE.BufferAttribute(B.nv > 65535 ? B.i.slice(0, B.ni) : new Uint16Array(B.i.subarray(0, B.ni)), 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.name = `${name}:${mat.name || 'mat'}`;
      m.castShadow = o.castShadow !== false && !mat.userData?.noShadow;
      m.receiveShadow = o.receiveShadow !== false;
      m.matrixAutoUpdate = false; m.updateMatrix();
      if (mat.userData?.layers3 !== false) m.layers.enable(3);   // the far shadow cascade, as the city's other kits
      group.add(m);
      return B.ni / 3;
    }
  }
}
const CAPLESS = new Set(['+z', '-z']);

// ---------------------------------------------------------------- masonry (materials with userData.brStone)
// Each triangle cut until no edge is longer than `sub` metres (sub x 4 on the coarse level): an edge is halved when it
// is too long whichever triangle holds it, so two faces that share an edge cut it at the same point and no crack opens.
// Then the uvs from the world (the stone maps' tile is 5 courses high and 10 long: v = height / 5 courses, u = the
// distance along the face / 10 courses, so the courses run level across every face and meet at the corners; a top or
// a soffit takes x and z) and the weathering as vertex colours: the wet band and tide line over the water, soot streaks
// under the ledges (`ledges`: heights) and faint ones elsewhere, a mottle over the walls, soffits darker.
const vhash = (x, y, s) => { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1013904223); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise2(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = vhash(i, j, s), b = vhash(i + 1, j, s), c = vhash(i, j + 1, s), d = vhash(i + 1, j + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const sst = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function stoneize(B, S, lod) {
  // (an edge is too long when its run along the ground exceeds `sub` or its rise 4 x `sub`: the streaks run down the
  // walls, so a wall needs vertices across more than up; a top or a soffit takes 3 x `sub` both ways)
  const sh = (S.sub || 1.6) * (lod ? 4 : 1), iH2 = 1 / (sh * sh), iV2 = 1 / (16 * sh * sh), iF2 = 1 / (9 * sh * sh);
  const P = [], N = [], I = [];
  for (let k = 0; k < B.nv * 3; k++) { P.push(B.p[k]); N.push(B.n[k]); }
  const mid = (a, b, cache) => {
    const key = a < b ? a * 4194304 + b : b * 4194304 + a;
    let v = cache.get(key);
    if (v !== undefined) return v;
    v = P.length / 3;
    P.push((P[a * 3] + P[b * 3]) / 2, (P[a * 3 + 1] + P[b * 3 + 1]) / 2, (P[a * 3 + 2] + P[b * 3 + 2]) / 2);
    let nx = N[a * 3] + N[b * 3], ny = N[a * 3 + 1] + N[b * 3 + 1], nz = N[a * 3 + 2] + N[b * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1;
    N.push(nx / l, ny / l, nz / l);
    cache.set(key, v);
    return v;
  };
  const d2 = (a, b) => { const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2]; return dx * dx + dy * dy + dz * dz; };
  // the edge's length against its limit (> 1: cut it); flat faces by the average of its ends' normals
  const over = (a, b) => {
    const dx = P[a * 3] - P[b * 3], dy = P[a * 3 + 1] - P[b * 3 + 1], dz = P[a * 3 + 2] - P[b * 3 + 2];
    if (Math.abs(N[a * 3 + 1] + N[b * 3 + 1]) > 1.4) return (dx * dx + dy * dy + dz * dz) * iF2 > 1;
    return (dx * dx + dz * dz) * iH2 + dy * dy * iV2 > 1;
  };
  const yOf = (v) => P[v * 3 + 1];
  for (let t = 0; t < B.ni; t += 3) {
    const a0 = B.i[t], b0 = B.i[t + 1], c0 = B.i[t + 2];
    // (only walls are cut: a face under 3 m high (a parapet, a cornice, a top) keeps its vertices, which carry its
    // weathering as they are)
    const hy = Math.max(yOf(a0), yOf(b0), yOf(c0)) - Math.min(yOf(a0), yOf(b0), yOf(c0));
    if (hy < 3 || !(over(a0, b0) || over(b0, c0) || over(c0, a0))) { I.push(a0, b0, c0); continue; }
    const cache = new Map(), stack = [[a0, b0, c0]];
    let guard = 0;
    while (stack.length) {
      const [a, b, c] = stack.pop();
      const sab = over(a, b), sbc = over(b, c), sca = over(c, a);
      if ((!sab && !sbc && !sca) || ++guard > 20000) { I.push(a, b, c); continue; }
      if (sab && sbc && sca) { const x = mid(a, b, cache), y = mid(b, c, cache), z = mid(c, a, cache); stack.push([a, x, z], [x, b, y], [z, y, c], [x, y, z]); continue; }
      // one or two edges: rotate so the split edges come first (ab, then bc)
      let A = a, Bv = b, Cv = c, s1 = sab, s2 = sbc, s3 = sca;
      while (!(s1 && (s2 || !s3))) { [A, Bv, Cv] = [Bv, Cv, A]; [s1, s2, s3] = [s2, s3, s1]; }
      if (!s2) { const x = mid(A, Bv, cache); stack.push([A, x, Cv], [x, Bv, Cv]); continue; }
      const x = mid(A, Bv, cache), y = mid(Bv, Cv, cache);
      stack.push([x, Bv, y]);
      if (d2(A, y) < d2(x, Cv)) stack.push([A, x, y], [A, y, Cv]); else stack.push([A, x, Cv], [x, y, Cv]);
    }
  }
  const nv = P.length / 3, u = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const cU = 1 / (10 * S.course), cV = 1 / (5 * S.course), seed = S.seed || 3, ledges = S.ledges || [], wl = S.wl || 0;
  for (let v = 0; v < nv; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2], nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
    let sAlong;
    if (Math.abs(ny) > 0.7) { u[v * 2] = x * cU; u[v * 2 + 1] = z * cV; sAlong = x + z; }
    else { const l = Math.hypot(nx, nz) || 1; sAlong = (x * nz - z * nx) / l; u[v * 2] = sAlong * cU; u[v * 2 + 1] = y * cV; }
    let k = 1;
    const hw = y - wl;
    k *= 0.5 + 0.5 * sst(0.3, 3.4, hw);                                   // wet stone and the tide line
    let st = 0;
    for (const L of ledges) { const d = L - y; if (d > -0.2 && d < 8) st = Math.max(st, 1 - Math.max(0, d) / 8); }
    const streak = sst(0.5, 0.82, vnoise2(sAlong / 1.1, y / 9, seed)) * sst(0.3, 0.7, vnoise2(sAlong / 3.7, y / 23, seed + 5));
    k *= 1 - 0.34 * streak * (0.3 + 0.7 * st);
    k *= 1 + 0.08 * (vnoise2(sAlong / 6.5, y / 6.5, seed + 11) - 0.5) * 2;   // the mottle
    if (S.grime) k *= 1 - S.grime[2] * (1 - sst(S.grime[0], S.grime[1], y));   // grime toward the base
    if (ny < -0.6) k *= 0.76; else if (ny > 0.7) k *= 0.9;
    const wet = 1 - sst(0.5, 2.2, hw);
    col[v * 3] = k * (1 - 0.05 * wet); col[v * 3 + 1] = k * (1 + 0.02 * wet); col[v * 3 + 2] = k * (1 - 0.06 * wet);
  }
  const p = new Float32Array(P), n = new Float32Array(N), i = new Uint32Array(I);
  return { p, n, u, c: col, i, nv, ni: I.length };
}
