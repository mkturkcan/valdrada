// lmTierKit.js: the downtown landmarks' massing from the city's 3D building model (LM65, 2026-10-31).
// The DoITT 3D Building Model (2014, CityGML LOD2) gives every roof surface of a building with its corner heights: the
// setbacks, the light courts, the pyramids, the turrets. A builder embeds those surfaces (metres from the compiled ring's
// vertex mean at authoring time, heights over the street) and this kit turns them into a building:
//   * stepWalls: the wall under every roof edge, down to the surface outside the edge (the next roof down, or the street),
//     merged into runs along each edge;
//   * the runs mapped with a painted tile at whole bays (u measured along the wall from a fixed line, so the bays of the
//     tiers line up over the setbacks) and absolute floors;
//   * caps: flat roofs triangulated with their holes, sloped roofs at their measured planes;
//   * tile3 / tileMat3: canvas tiles painted three ways at once (albedo, bump, roughness and metalness), as lmESB.js does.
// Nothing here touches the shared tile pipeline; the builders of lmDowntown.js call it.
import * as THREE from 'three';
import { Acc, rng, rgbs } from './lmFacadeKit.js';
import { applyLightTrim } from '../world/materials.js';

/* ------------------------------------------------------------------ tiles */
const _tiles = new Map();
export function orm(rough, metal) { return `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`; }
// a canvas tile painted three ways at once: paint(ga, gb, go, W, H, r) on the albedo, the bump (140 = flat) and the
// roughness / metalness (G / B) layers
export function tile3(key, W, H, paint, seed = 1, rough0 = 0.85) {
  let t = _tiles.get(key);
  if (t) return t;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const ca = mk(), cb = mk(), co = mk();
  const ga = ca.getContext('2d'), gb = cb.getContext('2d'), go = co.getContext('2d');
  gb.fillStyle = 'rgb(140,140,140)'; gb.fillRect(0, 0, W, H);
  go.fillStyle = orm(rough0, 0); go.fillRect(0, 0, W, H);
  paint(ga, gb, go, W, H, rng(seed));
  const tex = (c, srgb) => {
    const x = new THREE.CanvasTexture(c);
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8;
    return x;
  };
  t = { map: tex(ca, true), bump: tex(cb, false), orm: tex(co, false), W, H };
  _tiles.set(key, t);
  return t;
}
const _tm = new Map();
export function tileMat3(key, t, o = {}) {
  let m = _tm.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: o.bump ?? 1.4, roughnessMap: t.orm, metalnessMap: t.orm,
    roughness: 1, metalness: 1, color: 0xffffff });
  m.name = key;
  applyLightTrim(m);
  _tm.set(key, m);
  return m;
}
// fill a rect in all three layers: albedo colour, bump level, roughness / metalness (null leaves a layer)
export function fill3(ga, gb, go, x, y, w, h, col, bump, rough, metal) {
  if (col) { ga.fillStyle = typeof col === 'string' ? col : rgbs(col); ga.fillRect(x, y, w, h); }
  if (bump !== null && bump !== undefined) { gb.fillStyle = `rgb(${bump},${bump},${bump})`; gb.fillRect(x, y, w, h); }
  if (rough !== null && rough !== undefined) { go.fillStyle = orm(rough, metal || 0); go.fillRect(x, y, w, h); }
}
// the same path filled in all three layers
export function path3(ga, gb, go, pathFn, col, bump, rough, metal) {
  for (const [g, f] of [[ga, col ? (typeof col === 'string' ? col : rgbs(col)) : null], [gb, bump !== null && bump !== undefined ? `rgb(${bump},${bump},${bump})` : null],
    [go, rough !== null && rough !== undefined ? orm(rough, metal || 0) : null]]) {
    if (!f) continue;
    g.fillStyle = f; g.beginPath(); pathFn(g); g.fill();
  }
}

/* ------------------------------------------------------------------- data */
// 'x,z,y x,z,y ...#hole ...|next' -> [{ P, H, h0, h1, A, pl, flat, c }]; P and holes are [[x, z, y], ...]
// the corners of a ring that lie on the line between their neighbours (within tol metres, the height too) dropped, so a long
// wall is one run
export function dropCollinear(P, tol = 0.12) {
  let r = P.slice();
  for (let pass = 0; pass < 4 && r.length > 3; pass++) {
    const out = [];
    for (let i = 0; i < r.length; i++) {
      const a = out.length ? out[out.length - 1] : r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const ex = c[0] - a[0], ez = c[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 1e-6) { out.push(b); continue; }
      const t = ((b[0] - a[0]) * ex + (b[1] - a[1]) * ez) / (L * L);
      const d = Math.abs((b[0] - a[0]) * ez - (b[1] - a[1]) * ex) / L, dy = Math.abs(b[2] - (a[2] + (c[2] - a[2]) * t));
      if (t > 0 && t < 1 && d < tol && dy < 0.05 && r.length - (i - out.length) > 3) continue;
      out.push(b);
    }
    if (out.length === r.length) break;
    r = out;
  }
  return r.length >= 3 ? r : P;
}
export function parseSurfaces(s) {
  const ring = (t) => dropCollinear(t.trim().split(/\s+/).map((q) => q.split(',').map(Number)));
  return s.split('|').filter((t) => t.trim()).map((t) => {
    const [o, ...hs] = t.split('#');
    const P = ring(o), H = hs.map(ring);
    let h0 = 1e9, h1 = -1e9, cx = 0, cz = 0;
    for (const p of P) { h0 = Math.min(h0, p[2]); h1 = Math.max(h1, p[2]); cx += p[0] / P.length; cz += p[1] / P.length; }
    let A = areaOf(P);
    for (const h of H) A -= areaOf(h);
    return { P, H, h0, h1, A, pl: planeOf(P), flat: h1 - h0 < 0.08, c: [cx, cz] };
  });
}
export const areaOf = (P) => { let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; } return Math.abs(A / 2); };
export function inRing(P, x, z) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const xi = P[i][0], zi = P[i][1], xj = P[j][0], zj = P[j][1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export const inSurf = (q, x, z) => inRing(q.P, x, z) && !q.H.some((h) => inRing(h, x, z));
// the plane of a surface (y = a x + b z + c), least squares over its corners
export function planeOf(P) {
  let n = 0, sx = 0, sz = 0, sy = 0, sxx = 0, szz = 0, sxz = 0, sxy = 0, szy = 0;
  for (const [x, z, y] of P) { n++; sx += x; sz += z; sy += y; sxx += x * x; szz += z * z; sxz += x * z; sxy += x * y; szy += z * y; }
  const mx = sx / n, mz = sz / n, my = sy / n;
  const cxx = sxx / n - mx * mx, czz = szz / n - mz * mz, cxz = sxz / n - mx * mz, cxy = sxy / n - mx * my, czy = szy / n - mz * my;
  const det = cxx * czz - cxz * cxz;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: my };
  const a = (cxy * czz - czy * cxz) / det, b = (czy * cxx - cxy * cxz) / det;
  return { a, b, c: my - a * mx - b * mz };
}
export const yAt = (q, x, z) => q.pl.a * x + q.pl.b * z + q.pl.c;
// the highest surface over a point (excluding `self`), or null
export function heightAt(R, x, z, self) {
  let best = null;
  for (const q of R) {
    if (q === self || !inSurf(q, x, z)) continue;
    const h = yAt(q, x, z);
    if (best === null || h > best) best = h;
  }
  return best;
}
// the model (authoring vertex mean frame) moved onto the live ring: the shift between the two rings' box centres
export function shiftFor(ring, ref) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const dx = (x0 + x1) / 2 - ref[0], dz = (z0 + z1) / 2 - ref[1];
  return Math.hypot(dx, dz) < 12 ? [dx, dz] : [0, 0];
}
export function shiftSurfaces(R, d) {
  if (!d[0] && !d[1]) return R;
  const mv = (p) => [p[0] + d[0], p[1] + d[1], p[2]];
  return R.map((q) => {
    const P = q.P.map(mv), H = q.H.map((h) => h.map(mv));
    return { ...q, P, H, pl: planeOf(P), c: [q.c[0] + d[0], q.c[1] + d[1]] };
  });
}

/* ------------------------------------------------------------------- walls */
// The wall under every edge of every surface (outer rings and holes): sampled in pieces of `step` metres just outside the
// edge, it drops from the edge to the highest surface there (or to the street, y = 0, when `ground` is set and nothing
// is there). Consecutive pieces with the same bottom merge, so a run is one wall plane between two corners or changes of
// the floor below. emit({ a, b, ya, yb, y0, n, q, L }) with a, b the run's ends [x, z], ya / yb the edge heights there,
// y0 the bottom, n the outward normal [nx, nz], q the surface, L the run length.
export function stepWalls(R, emit, o = {}) {
  const step = o.step ?? 1.0, ground = o.ground ?? true, minH = o.minH ?? 0.05;
  const skip = o.skip || (() => false);
  for (const q of R) {
    if (skip(q)) continue;
    for (const ring of [q.P, ...q.H]) {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const A = ring[i], B = ring[(i + 1) % n];
        const ex = B[0] - A[0], ez = B[1] - A[1], L = Math.hypot(ex, ez);
        if (L < 0.05) continue;
        let nx = ez / L, nz = -ex / L;
        const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2;
        if (inSurf(q, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
        const m = Math.max(1, Math.ceil(L / step));
        let cur = null;
        const flush = () => { if (cur) { emit(cur); cur = null; } };
        for (let k = 0; k < m; k++) {
          const t0 = k / m, t1 = (k + 1) / m, tm = (t0 + t1) / 2;
          const px = A[0] + ex * tm + nx * 0.12, pz = A[1] + ez * tm + nz * 0.12;
          let hn = heightAt(R, px, pz, q);
          if (hn === null) { if (!ground) { flush(); continue; } hn = 0; }
          const ha = A[2] + (B[2] - A[2]) * t0, hb = A[2] + (B[2] - A[2]) * t1;
          if (Math.min(ha, hb) - hn < minH) { flush(); continue; }
          if (cur && Math.abs(cur.y0 - hn) < 0.05) {
            cur.b = [A[0] + ex * t1, A[1] + ez * t1]; cur.yb = hb; cur.L = L * (t1 - cur.t0); cur.t1 = t1;
          } else {
            flush();
            cur = { a: [A[0] + ex * t0, A[1] + ez * t0], b: [A[0] + ex * t1, A[1] + ez * t1], ya: ha, yb: hb, y0: hn, n: [nx, nz], q, L: L * (t1 - t0), t0, t1, edge: [A, B] };
          }
        }
        flush();
      }
    }
  }
}
// the direction to the right of a wall seen from outside (u grows that way): n = (nx, nz) -> (nz, -nx)
export const rightOf = (n) => [n[1], -n[0]];
// a wall run as one quad mapped to the tile: u in whole bays from a line through the origin (aligned over setbacks), v in
// absolute floors from vRef; the top follows the edge (sloped edges of a pyramid's base stay exact)
export function wallQuad(acc, w, y0, bayW, floorH, tex, vRef = 0, uOff = 0) {
  const r = rightOf(w.n);
  const ua = ((w.a[0] * r[0] + w.a[1] * r[1]) / bayW + uOff) / tex.nx, ub = ((w.b[0] * r[0] + w.b[1] * r[1]) / bayW + uOff) / tex.nx;
  const V = (y) => (y - vRef) / (floorH * tex.ny);
  acc.quad([w.a[0], y0, w.a[1]], [w.b[0], y0, w.b[1]], [w.b[0], w.yb, w.b[1]], [w.a[0], w.ya, w.a[1]], [w.n[0], 0, w.n[1]],
    [ua, V(y0)], [ub, V(y0)], [ub, V(w.yb)], [ua, V(w.ya)]);
}
// positions of the bay lines along a run (s from the run's start), on the global grid of `bayW` shifted by `off` bays,
// keeping `margin` metres clear of the ends
export function bayLines(w, bayW, off = 0, margin = 0.4) {
  const r = rightOf(w.n);
  const sa = w.a[0] * r[0] + w.a[1] * r[1], sb = w.b[0] * r[0] + w.b[1] * r[1];
  const lo = Math.min(sa, sb), hi = Math.max(sa, sb), dir = sb >= sa ? 1 : -1;
  const out = [];
  for (let k = Math.ceil((lo + margin) / bayW - off); (k + off) * bayW <= hi - margin; k++) {
    const s = (k + off) * bayW;
    out.push(dir > 0 ? s - sa : sa - s);
  }
  return out;
}
// a point on a run at s metres from its start, d metres out of the wall
export function runPt(w, s, d = 0) {
  const dx = w.b[0] - w.a[0], dz = w.b[1] - w.a[1], L = Math.hypot(dx, dz) || 1;
  return [w.a[0] + (dx / L) * s + w.n[0] * d, w.a[1] + (dz / L) * s + w.n[1] * d];
}
export const runRot = (w) => Math.atan2(-(w.b[1] - w.a[1]), w.b[0] - w.a[0]);
// the edge height of a run at s metres from its start
export const runY = (w, s) => w.ya + (w.yb - w.ya) * Math.max(0, Math.min(1, s / (w.L || 1)));

/* -------------------------------------------------------------------- caps */
// a surface capped: flat roofs triangulated with their holes at their height, sloped ones with each corner at its own
// height (the measured plane); UV in plan metres x uvS. Facing up (or down when `down`).
export function capSurface(acc, q, uvS = 0.1, lift = 0, down = false) {
  const contour = q.P.map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = q.H.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1])));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, holes); } catch { return; }
  const all = q.P.concat(...q.H);
  for (const [i, j, k] of tris) {
    const a = [all[i][0], all[i][2] + lift, all[i][1]], b = [all[j][0], all[j][2] + lift, all[j][1]], c = [all[k][0], all[k][2] + lift, all[k][1]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-9) continue;
    nx /= L; ny /= L; nz /= L;
    const uv = (p) => [p[0] * uvS, p[2] * uvS];
    // (b - a) x (c - a) is the face normal of a, b, c: keep it when it points the way wanted, else flip the winding
    if ((ny >= 0) !== down) acc.tri(a, b, c, [nx, ny, nz], uv(a), uv(b), uv(c));
    else acc.tri(a, c, b, [-nx, -ny, -nz], uv(a), uv(c), uv(b));
  }
}

/* ----------------------------------------------------------------- shapes */
// a profile swept along an open straight run (a coping, a cornice, a string course): profile [[out, up], ...] from the wall
// face; the ends extended by `ext` metres and closed
export function sweepRun(acc, a, b, n, y0, profile, ext = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz);
  if (L < 0.05) return;
  const tx = dx / L, tz = dz / L;
  const A = [a[0] - tx * ext, a[1] - tz * ext], B = [b[0] + tx * ext, b[1] + tz * ext];
  const P = (e, o, u) => [e[0] + n[0] * o, y0 + u, e[1] + n[1] * o];
  for (let k = 0; k + 1 < profile.length; k++) {
    const [o0, u0] = profile[k], [o1, u1] = profile[k + 1];
    const du = u1 - u0, dout = o1 - o0, Lp = Math.hypot(du, dout);
    if (Lp < 1e-6) continue;
    const nrm = [n[0] * du / Lp, -dout / Lp, n[1] * du / Lp];
    acc.quad(P(A, o0, u0), P(B, o0, u0), P(B, o1, u1), P(A, o1, u1), nrm);
  }
  // end caps (the profile polygon closed against the wall)
  const poly = profile.concat([[0, profile[profile.length - 1][1]], [0, profile[0][1]]]);
  for (const [E, s] of [[A, -1], [B, 1]]) {
    const c0 = P(E, 0, (profile[0][1] + profile[profile.length - 1][1]) / 2);
    for (let k = 0; k < poly.length; k++) {
      const p0 = poly[k], p1 = poly[(k + 1) % poly.length];
      triN(acc, c0, P(E, p0[0], p0[1]), P(E, p1[0], p1[1]), [tx * s, 0, tz * s]);
    }
  }
}
// an oriented box: centre (x, z) at y0, w along the direction rot (radians round y, x axis at rot 0), d across, h up
const _bx = new THREE.BoxGeometry(1, 1, 1);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
export function obox(acc, x, y0, z, w, h, d, rot = 0) {
  if (w <= 0 || h <= 0 || d <= 0) return;
  _e.set(0, rot, 0); _q.setFromEuler(_e);
  _m4.compose(_v.set(x, y0 + h / 2, z), _q, _s.set(w, h, d));
  acc.addGeo(_bx, _m4);
}
// a regular n-gon prism / frustum (r0 at y0, r1 at y1), faceted, optional cap; rot turns the first corner
export function ngon(acc, x, z, y0, y1, r0, r1, n = 8, rot = 0, cap = true, bottom = false) {
  for (let k = 0; k < n; k++) {
    const t0 = rot + (k / n) * Math.PI * 2, t1 = rot + ((k + 1) / n) * Math.PI * 2;
    const a0 = [x + Math.cos(t0) * r0, y0, z + Math.sin(t0) * r0], b0 = [x + Math.cos(t1) * r0, y0, z + Math.sin(t1) * r0];
    const a1 = [x + Math.cos(t0) * r1, y1, z + Math.sin(t0) * r1], b1 = [x + Math.cos(t1) * r1, y1, z + Math.sin(t1) * r1];
    const tm = (t0 + t1) / 2, slope = (r0 - r1) / Math.max(1e-6, y1 - y0), nl = Math.hypot(1, slope);
    const nrm = [Math.cos(tm) / nl, slope / nl, Math.sin(tm) / nl];
    if (r1 < 1e-4) triN(acc, a0, b0, a1, nrm, [k / n, 0], [(k + 1) / n, 0], [(k + 0.5) / n, 1]);
    else if (r0 < 1e-4) triN(acc, a0, b1, a1, nrm, [(k + 0.5) / n, 0], [(k + 1) / n, 1], [k / n, 1]);
    else acc.quad(a0, b0, b1, a1, nrm, [k / n, y0], [(k + 1) / n, y0], [(k + 1) / n, y1], [k / n, y1]);
    if (cap && r1 >= 1e-4) triN(acc, [x, y1, z], a1, b1, [0, 1, 0]);
    if (bottom && r0 >= 1e-4) triN(acc, [x, y0, z], b0, a0, [0, -1, 0]);
  }
}
// a lathe of n facets through a profile [[r, y], ...] (a pinnacle, a finial, a crocketed spire)
export function ngonLathe(acc, x, z, y0, prof, n = 8, rot = 0) {
  for (let k = 0; k + 1 < prof.length; k++) ngon(acc, x, z, y0 + prof[k][1], y0 + prof[k + 1][1], prof[k][0], prof[k + 1][0], n, rot, false, false);
  const last = prof[prof.length - 1];
  if (last[0] > 1e-4) ngon(acc, x, z, y0 + last[1], y0 + last[1], last[0], 0, n, rot, false);
}
// a triangle wound to face n (the winding three.js reads as the front)
export function triN(acc, a, b, c, n, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
  if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) acc.tri(a, b, c, n, ua, ub, uc); else acc.tri(a, c, b, n, ua, uc, ub);
}
// a planar polygon given in 3D (convex or a fan from its first corner), facing n
export function fan(acc, pts, n, uvOf = null) {
  for (let k = 1; k + 1 < pts.length; k++) {
    const a = pts[0], b = pts[k], c = pts[k + 1];
    if (uvOf) triN(acc, a, b, c, n, uvOf(a), uvOf(b), uvOf(c)); else triN(acc, a, b, c, n);
  }
}
