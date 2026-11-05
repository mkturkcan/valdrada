// lmMidKit.js: helpers shared by the Midtown and Hudson Yards landmark modules (LM66, 2026-10-31): grid frames on a compiled
// ring, roof polygons from the city's 3D building model with the walls under their steps, mouldings swept along open paths,
// fronts built in their own plane (polygons with holes, reveals), tapered prisms with whole bays per face, and the painted
// tiles (albedo with a bump map) the facades are mapped with. Everything writes into lmFacadeKit.js accumulators, merged per
// material by the builders.
import * as THREE from 'three';
import { offsetRing, ringOutSign, rgbs, speckle, streaks, rng, lathe, box, cyl } from './lmFacadeKit.js';

/* ------------------------------------------------------------------ frames */
// The grid frame of a ring: U along the cross streets (the edge direction nearest `street`, world x east / z south), V the
// perpendicular toward the south; the ring's extents in it.
export function streetFrame(ring, street = [0.8728, 0.4881]) {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const t = Math.atan2(ez, ex) * 4;
    sx += L * Math.cos(t); sy += L * Math.sin(t);
  }
  const th = Math.atan2(sy, sx) / 4;
  let best = null;
  for (let k = 0; k < 4; k++) {
    const a = th + (k * Math.PI) / 2, d = [Math.cos(a), Math.sin(a)];
    const s = d[0] * street[0] + d[1] * street[1];
    if (!best || s > best.s) best = { s, d };
  }
  const U = best.d, V = [-U[1], U[0]];
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
  for (const [x, z] of ring) {
    const u = x * U[0] + z * U[1], v = x * V[0] + z * V[1];
    u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v);
  }
  return { U, V, u0, u1, v0, v1 };
}
// Builds in a model frame (u along the streets, height, v south) and maps onto the ring at the end. With `ref` (the model's
// extents [u0, u1, v0, v1]) the model's box lands on the ring's extents in its own frame (the city model's walls on the
// compiled footprint); without it the model frame is the ring's own (u, v measured in the ring's frame, scale 1).
export function frameMap(ring, ref, street) {
  const F = streetFrame(ring, street);
  const r = ref || [F.u0, F.u1, F.v0, F.v1];
  const su = (F.u1 - F.u0) / (r[1] - r[0]), sv = (F.v1 - F.v0) / (r[3] - r[2]);
  const ok = su > 0.8 && su < 1.25 && sv > 0.8 && sv < 1.25;
  const mu = (u) => F.u0 + (u - r[0]) * su, mv = (v) => F.v0 + (v - r[2]) * sv;
  const xz = (u, v) => { const a = mu(u), b = mv(v); return [F.U[0] * a + F.V[0] * b, F.U[1] * a + F.V[1] * b]; };
  const apply = (acc) => {
    const p = acc.p, n = acc.n;
    for (let i = 0; i < p.length; i += 3) {
      const [x, z] = xz(p[i], p[i + 2]);
      p[i] = x; p[i + 2] = z;
      const nu = n[i] * (su === sv ? 1 : 1 / su), nv = n[i + 2] * (su === sv ? 1 : 1 / sv), L = Math.hypot(nu, n[i + 1], nv) || 1;
      n[i] = (F.U[0] * nu + F.V[0] * nv) / L; n[i + 1] /= L; n[i + 2] = (F.U[1] * nu + F.V[1] * nv) / L;
    }
    return acc;
  };
  const um = (F.u0 + F.u1) / 2, vm = (F.v0 + F.v1) / 2;
  const centre = [F.U[0] * um + F.V[0] * vm, F.U[1] * um + F.V[1] * vm];
  // a ring given in world-local x z, in the model frame (for footprints of neighbours drawn by the same builder)
  const toModel = (x, z) => { const a = x * F.U[0] + z * F.U[1], b = x * F.V[0] + z * F.V[1]; return [r[0] + (a - F.u0) / su, r[2] + (b - F.v0) / sv]; };
  return { F, su, sv, ok, xz, apply, centre, toModel, ref: r, rot: Math.atan2(-F.U[1], F.U[0]) };
}
// a collider box in the model frame (u, v centre, size along u and v, y range) for g.userData.colliderBoxes
export function colliderUV(FM, u, v, w, d, y0, y1) {
  const [x, z] = FM.xz(u, v);
  return { x, y: (y0 + y1) / 2, z, w: w * FM.su, h: y1 - y0, d: d * FM.sv, rotY: FM.rot };
}

/* --------------------------------------------------------------- polygons */
export const parsePolys = (s) => s.split('|').filter((p) => p.trim()).map((p) => p.trim().split(/\s+/).map((t) => t.split(',').map(Number)));
export function inPoly(P, u, v) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ui, vi] = P[i], [uj, vj] = P[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c;
  }
  return c;
}
// the plane of a roof polygon (h = a u + b v + c), least squares over its vertices
export function planeOf(P) {
  let n = 0, su = 0, sv = 0, sh = 0, suu = 0, svv = 0, suv = 0, suh = 0, svh = 0;
  for (const [u, v, h] of P) { n++; su += u; sv += v; sh += h; suu += u * u; svv += v * v; suv += u * v; suh += u * h; svh += v * h; }
  const mu = su / n, mv = sv / n, mh = sh / n;
  const cuu = suu / n - mu * mu, cvv = svv / n - mv * mv, cuv = suv / n - mu * mv, cuh = suh / n - mu * mh, cvh = svh / n - mv * mh;
  const det = cuu * cvv - cuv * cuv;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: mh };
  const a = (cuh * cvv - cvh * cuv) / det, b = (cvh * cuu - cuh * cuv) / det;
  return { a, b, c: mh - a * mu - b * mv };
}
export const areaOf = (P) => { let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };
// roof polygons [[u, v, h], ...] with their planes and extents
export function roofSet(polys, classify) {
  return polys.map((P) => {
    let h0 = 1e9, h1 = -1e9, cu = 0, cv = 0;
    for (const [u, v, h] of P) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); cu += u / P.length; cv += v / P.length; }
    const q = { P, h0, h1, cu, cv, A: Math.abs(areaOf(P)), pl: planeOf(P) };
    q.k = classify ? classify(q) : 'roof';
    return q;
  });
}
// a roof polygon triangulated in plan on its own plane; uv(u, v) -> [s, t]
export function roofPoly(acc, q, uv = (u, v) => [u * 0.1, v * 0.1]) {
  const pts = q.P.map(([u, v]) => new THREE.Vector2(u, v));
  let T;
  try { T = THREE.ShapeUtils.triangulateShape(pts, []); } catch { return; }
  const { a, b } = q.pl;
  const nl = Math.hypot(a, b, 1), nrm = [-a / nl, 1 / nl, -b / nl];
  for (const [i, j, k] of T) {
    const A = q.P[i], B = q.P[j], C = q.P[k];
    const pa = [A[0], A[2], A[1]], pb = [B[0], B[2], B[1]], pc = [C[0], C[2], C[1]];
    const cr = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
    if (cr >= 0) acc.tri(pa, pb, pc, nrm, uv(A[0], A[1]), uv(B[0], B[1]), uv(C[0], C[1]));
    else acc.tri(pa, pc, pb, nrm, uv(A[0], A[1]), uv(C[0], C[1]), uv(B[0], B[1]));
  }
}
// The walls under every step of a roof set: each roof edge whose outside is lower drops a wall to that lower surface (or to
// the ground, with groundOuter), cut in pieces of `piece` m so a wall over two lower roofs stops on each.
// emit(p0, p1, hBottom, [nu, nv], q, s0): p = [u, v, h] at the two ends of the piece, s0 its start along the edge
export function stepWalls(R, emit, groundOuter = true, piece = 1.5, skipK = null) {
  const hAt = (u, v, self) => {
    let best = null;
    for (const q of R) {
      if (q === self || !inPoly(q.P, u, v)) continue;
      const hh = q.pl.a * u + q.pl.b * v + q.pl.c;
      if (best === null || hh > best) best = hh;
    }
    return best;
  };
  for (const q of R) {
    if (skipK && skipK(q)) continue;
    const P = q.P, n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const eu = b[0] - a[0], ev = b[1] - a[1], L = Math.hypot(eu, ev);
      if (L < 0.05) continue;
      let nu = ev / L, nv = -eu / L;
      if (inPoly(P, (a[0] + b[0]) / 2 + nu * 0.08, (a[1] + b[1]) / 2 + nv * 0.08)) { nu = -nu; nv = -nv; }
      const m = Math.max(1, Math.ceil(L / piece));
      for (let k = 0; k < m; k++) {
        const t0 = k / m, t1 = (k + 1) / m, tm = (t0 + t1) / 2;
        const pu = a[0] + eu * tm + nu * 0.12, pv = a[1] + ev * tm + nv * 0.12;
        let hn = hAt(pu, pv, q);
        if (hn === null) { if (!groundOuter) continue; hn = 0; }
        const ha = a[2] + (b[2] - a[2]) * t0, hb = a[2] + (b[2] - a[2]) * t1;
        if (Math.min(ha, hb) - hn < 0.05) continue;
        emit([a[0] + eu * t0, a[1] + ev * t0, ha], [a[0] + eu * t1, a[1] + ev * t1, hb], hn, [nu, nv], q, L * t0);
      }
    }
  }
}
// a wall piece from stepWalls written with u along the edge (metres / uvW) and v in absolute height (metres / uvH)
export function wallPiece(acc, p0, p1, hb, n, s0, uvW = 4.8, uvH = uvW, vRef = 0) {
  const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  acc.quad([p0[0], hb, p0[1]], [p1[0], hb, p1[1]], [p1[0], p1[2], p1[1]], [p0[0], p0[2], p0[1]], [n[0], 0, n[1]],
    [s0 / uvW, (hb - vRef) / uvH], [(s0 + L) / uvW, (hb - vRef) / uvH], [(s0 + L) / uvW, (p1[2] - vRef) / uvH], [s0 / uvW, (p0[2] - vRef) / uvH]);
}

/* ------------------------------------------------------------ the sweep */
// a profile swept along an open path in the xz plane, mitred at the joints; profile [[out, up], ...] with `out` toward side
// `s` of the travel (+1 = the right of travel looking down with z south)
export function sweepOpen(acc, path, y0, profile, s = 1, capEnds = true) {
  const n = path.length;
  if (n < 2) return;
  const nrm = [];
  for (let i = 0; i < n - 1; i++) {
    const a = path[i], b = path[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    nrm.push([s * -ez / L, s * ex / L]);
  }
  const off = (i, d) => {
    if (i === 0) return [path[0][0] + nrm[0][0] * d, path[0][1] + nrm[0][1] * d];
    if (i === n - 1) return [path[n - 1][0] + nrm[n - 2][0] * d, path[n - 1][1] + nrm[n - 2][1] * d];
    const n1 = nrm[i - 1], n2 = nrm[i];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz) || 1; mx /= ml; mz /= ml;
    const t = d / Math.max(0.4, mx * n2[0] + mz * n2[1]);
    return [path[i][0] + mx * t, path[i][1] + mz * t];
  };
  const rows = profile.map(([d]) => path.map((_, i) => off(i, d)));
  for (let k = 0; k + 1 < profile.length; k++) {
    const [d0, u0] = profile[k], [d1, u1] = profile[k + 1];
    const dd = d1 - d0, du = u1 - u0, Lp = Math.hypot(dd, du);
    if (Lp < 1e-6) continue;
    for (let i = 0; i < n - 1; i++) {
      const o = nrm[i];
      const nv = [o[0] * du / Lp, -dd / Lp, o[1] * du / Lp];
      const A0 = rows[k][i], A1 = rows[k][i + 1], B0 = rows[k + 1][i], B1 = rows[k + 1][i + 1];
      acc.quad([A0[0], y0 + u0, A0[1]], [A1[0], y0 + u0, A1[1]], [B1[0], y0 + u1, B1[1]], [B0[0], y0 + u1, B0[1]], nv);
    }
  }
  if (!capEnds) return;
  for (const [i, sgn] of [[0, -1], [n - 1, 1]]) {
    const e = i === 0 ? [path[1][0] - path[0][0], path[1][1] - path[0][1]] : [path[n - 1][0] - path[n - 2][0], path[n - 1][1] - path[n - 2][1]];
    const L = Math.hypot(e[0], e[1]) || 1, nv = [sgn * e[0] / L, 0, sgn * e[1] / L];
    const pts = profile.map((_, k) => [rows[k][i][0], y0 + profile[k][1], rows[k][i][1]]);
    for (let k = 1; k + 1 < pts.length; k++) {
      const a = pts[0], b = pts[k], c = pts[k + 1];
      const cr = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
      const cx = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      const cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (Math.hypot(cr, cx, cz) < 1e-9) continue;
      if (cr * nv[0] + cz * nv[2] >= 0) acc.tri(a, b, c, nv); else acc.tri(a, c, b, nv);
    }
  }
}

/* --------------------------------------------------------- canvas tiles */
const _tiles = new Map();
// one canvas pair (albedo, bump) of w x h px painted by paint(g, gb, w, h, r); repeat-wrapped, cached by key
export function tile(key, w, h, paint, seed = 1, nx = 1, ny = 1) {
  let t = _tiles.get(key);
  if (t) return t;
  const mk = () => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ca = mk(), cb = mk();
  const g = ca.getContext('2d'), gb = cb.getContext('2d');
  gb.fillStyle = 'rgb(140,140,140)'; gb.fillRect(0, 0, w, h);
  paint(g, gb, w, h, rng(seed));
  const map = new THREE.CanvasTexture(ca);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(cb);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 4;
  t = { map, bump, nx, ny };
  _tiles.set(key, t);
  return t;
}
// dressed ashlar: courses of hc px, blocks of bw..2bw px, a hair joint, per block tone, weathering down the wall
export function ashlarPaint(base, { hc, bw, joint = 'rgba(40,34,28,0.32)', tone = 0.05, grime = 0.06, rustic = 0 }) {
  return (g, gb, w, h, r) => {
    g.fillStyle = rgbs(base); g.fillRect(0, 0, w, h);
    for (let y = 0, row = 0; y < h; y += hc, row++) {
      let x = -((row * bw * 0.53) % bw);
      while (x < w) {
        const bl = bw * (1 + Math.floor(r() * 2) * 0.5);
        g.fillStyle = rgbs(base, 1 + (r() - 0.5) * 2 * tone); g.fillRect(x, y, bl, hc);
        speckle(g, x, y, bl, hc, r, Math.round(bl * hc / 60), 0.06);
        g.fillStyle = joint; g.fillRect(x, y, 1.5, hc);
        gb.fillStyle = rustic ? 'rgb(60,60,60)' : 'rgb(112,112,112)'; gb.fillRect(x, y, rustic ? 3 : 1.5, hc);
        x += bl;
      }
      g.fillStyle = joint; g.fillRect(0, y, w, 1.5);
      gb.fillStyle = rustic ? 'rgb(60,60,60)' : 'rgb(112,112,112)'; gb.fillRect(0, y, w, rustic ? 3 : 1.5);
      if (rustic) { gb.fillStyle = 'rgb(176,176,176)'; gb.fillRect(0, y + 4, w, hc - 8); }
    }
    streaks(g, 0, 0, w, h, r, Math.round(w / 6), grime);
  };
}
// A curtain wall: nx bays x ny floors per tile, rows from the top. Each pane a vertical gradient between two glass tones
// (the sky reflected over the interior), a spandrel band of height bandH (fraction of the floor) at the slab, mullions of
// mw px (fins wider), some panes with blinds; o.split: a transom in each pane at that fraction from the top.
export function glassPaint(o) {
  return (g, gb, w, h, r) => {
    const nx = o.nx || 4, ny = o.ny || 4, bw = w / nx, fh = h / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * bw, y = j * fh, k = 0.92 + r() * (o.var ?? 0.14);
      const gl = g.createLinearGradient(0, y, 0, y + fh);
      gl.addColorStop(0, rgbs(o.top, k)); gl.addColorStop(1, rgbs(o.bot, k));
      g.fillStyle = gl; g.fillRect(x, y, bw, fh);
      const c = r();
      if (c < (o.blinds ?? 0.12)) { g.fillStyle = rgbs(o.blind || [214, 210, 198], 0.9 + r() * 0.15, 0.55); g.fillRect(x, y, bw, fh * (0.2 + r() * 0.5)); }
      else if (c < (o.blinds ?? 0.12) + (o.dark ?? 0.1)) { g.fillStyle = 'rgba(30,36,42,0.3)'; g.fillRect(x, y + fh * 0.2, bw, fh * 0.6); }
      gb.fillStyle = 'rgb(118,118,118)'; gb.fillRect(x, y, bw, fh);
      if (o.split) { g.fillStyle = rgbs(o.mullion, 0.95); g.fillRect(x, y + fh * o.split - 1, bw, 2); }
    }
    if (o.bandH) for (let j = 0; j < ny; j++) {
      const yb = j * fh + fh * (1 - o.bandH);
      g.fillStyle = rgbs(o.band); g.fillRect(0, yb, w, fh * o.bandH);
      g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(0, yb - 2, w, 2);
      gb.fillStyle = 'rgb(190,190,190)'; gb.fillRect(0, yb, w, fh * o.bandH);
    }
    const mw = o.mw ?? 3;
    for (let i = 0; i <= nx; i++) {
      const fin = o.finEvery && i % o.finEvery === 0, ww = fin ? (o.finW ?? 10) : mw;
      g.fillStyle = rgbs(fin ? (o.fin || o.mullion) : o.mullion); g.fillRect(i * bw - ww / 2, 0, ww, h);
      if (fin && o.finShade) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(i * bw + ww / 2, 0, ww * 0.6, h); }
      gb.fillStyle = fin ? 'rgb(235,235,235)' : 'rgb(205,205,205)'; gb.fillRect(i * bw - ww / 2, 0, ww, h);
    }
    if (o.slab !== false) for (let j = 0; j <= ny; j++) { g.fillStyle = rgbs(o.mullion, 0.9); g.fillRect(0, j * fh - 1, w, 2); }
  };
}

/* --------------------------------------------------------- fronts */
// A front built in its own plane: s metres along it, y up, d out of the wall (outward = the right of travel, z south).
export function frontFrame(u0, v0, du, dv) {
  const nu = -dv, nv = du;
  const fr = { P: (s, y, d) => [u0 + du * s + nu * d, y, v0 + dv * s + nv * d], N: (ns, ny, nd) => [du * ns + nu * nd, ny, dv * ns + nv * nd], du, dv, nu, nv };
  fr.xz = (s, d) => [u0 + du * s + nu * d, v0 + dv * s + nv * d];
  fr.shift = (d0) => frontFrame(u0 + nu * d0, v0 + nv * d0, du, dv);
  return fr;
}
// a front between two plan points a -> b (outward on the right of travel)
export function frontAB(a, b) { const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return Object.assign(frontFrame(a[0], a[1], (b[0] - a[0]) / L, (b[1] - a[1]) / L), { L }); }
// a planar polygon with holes in a front's plane at depth d, facing +d (or -d), UV in metres / uvM
export function frontPoly(acc, fr, outer, holes, d, uvM = 4.8, facing = 1, uvV = uvM, uOff = 0, vOff = 0) {
  const sh = outer.map(([s, y]) => new THREE.Vector2(s, y)), hs = holes.map((h) => h.map(([s, y]) => new THREE.Vector2(s, y)));
  let T;
  try { T = THREE.ShapeUtils.triangulateShape(sh, hs); } catch { return; }
  const all = outer.concat(...holes);
  const n = fr.N(0, 0, facing);
  for (const [i, j, k] of T) {
    const A = all[i], B = all[j], C = all[k];
    const pa = fr.P(A[0], A[1], d), pb = fr.P(B[0], B[1], d), pc = fr.P(C[0], C[1], d);
    const e1 = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], e2 = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const uv = (Q) => [(Q[0] - uOff) / uvM, (Q[1] - vOff) / uvV];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) acc.tri(pa, pb, pc, n, uv(A), uv(B), uv(C)); else acc.tri(pa, pc, pb, n, uv(A), uv(C), uv(B));
  }
}
// the reveal of an opening: its outline swept from the wall (d = 0) back to depth -dep, faces looking into the opening
export function reveal(acc, fr, loop, dep, uvM = 4.8, d0 = 0) {
  const n = loop.length;
  let A = 0; for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
  const sg = A > 0 ? 1 : -1;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n], es = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(es, ey);
    if (L < 1e-4) continue;
    const ns = -sg * ey / L, ny = sg * es / L;
    acc.quad(fr.P(a[0], a[1], d0), fr.P(b[0], b[1], d0), fr.P(b[0], b[1], d0 - dep), fr.P(a[0], a[1], d0 - dep), fr.N(ns, ny, 0),
      [run / uvM, 0], [(run + L) / uvM, 0], [(run + L) / uvM, dep / uvM], [run / uvM, dep / uvM]);
    run += L;
  }
}
export const archLoop = (s0, s1, y0, ys, seg = 16) => {
  const r = (s1 - s0) / 2, c = (s0 + s1) / 2, P = [[s0, y0], [s1, y0], [s1, ys]];
  for (let k = 1; k < seg; k++) { const t = (k / seg) * Math.PI; P.push([c + r * Math.cos(t), ys + r * Math.sin(t)]); }
  P.push([s0, ys]);
  return P;
};
// a pointed (gothic) arch: two arcs struck from the springing line at `k` of the span past each side (k 0.5 = equilateral)
export const pointedLoop = (s0, s1, y0, ys, k = 0.5, seg = 8) => {
  const w = s1 - s0, rad = w * (0.5 + k), cL = s0 + rad, cR = s1 - rad;
  const top = ys + Math.sqrt(Math.max(0, rad * rad - (w / 2) ** 2));
  const P = [[s0, y0], [s1, y0], [s1, ys]];
  const aR0 = 0, aR1 = Math.acos((s0 + w / 2 - cR) / rad);
  for (let i = 1; i <= seg; i++) { const a = aR0 + (aR1 - aR0) * (i / seg); P.push([cR + rad * Math.cos(a), ys + rad * Math.sin(a)]); }
  P[P.length - 1] = [s0 + w / 2, top];
  const aL1 = Math.PI - Math.acos((cL - (s0 + w / 2)) / rad);
  for (let i = seg - 1; i >= 1; i--) { const a = Math.PI - (Math.PI - aL1) * (i / seg); P.push([cL + rad * Math.cos(a), ys + rad * Math.sin(a)]); }
  P.push([s0, ys]);
  return P;
};
export const rectLoop = (s0, s1, y0, y1) => [[s0, y0], [s1, y0], [s1, y1], [s0, y1]];
export const ovalLoop = (c, yc, rs, ry, seg = 20) => Array.from({ length: seg }, (_, k) => { const t = (k / seg) * Math.PI * 2; return [c + rs * Math.cos(t), yc + ry * Math.sin(t)]; });

/* --------------------------------------------------------- caps and prisms */
// a flat cap facing down (a soffit)
export function capDown(acc, ring, y) {
  const T = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of T) {
    const a = [ring[i][0], y, ring[i][1]], b = [ring[j][0], y, ring[j][1]], c = [ring[k][0], y, ring[k][1]];
    const cr = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (cr < 0) acc.tri(a, b, c, [0, -1, 0]); else acc.tri(a, c, b, [0, -1, 0]);
  }
}
// a flat cap with holes, facing up
export function capHoles(acc, ring, holes, y, uvS = 0.1) {
  const T = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const all = ring.concat(...holes);
  for (const [i, j, k] of T) {
    const a = [all[i][0], y, all[i][1]], b = [all[j][0], y, all[j][1]], c = [all[k][0], y, all[k][1]];
    const cr = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const uv = (q) => [q[0] * uvS, q[2] * uvS];
    if (cr >= 0) acc.tri(a, b, c, [0, 1, 0], uv(a), uv(b), uv(c)); else acc.tri(a, c, b, [0, 1, 0], uv(a), uv(c), uv(b));
  }
}
// walls between two plans of the same vertex count (a tapered prism) with a fixed bay count per edge (nbs) or whole bays of
// `bay` m, v in absolute floors from vRef; a tile of nx bays x ny floors
export function taperWalls(acc, A, B, y0, y1, bay, floor, vRef, nx, ny, nbs = null) {
  const n = A.length;
  let s = 0; for (let i = 0; i < n; i++) { const a = A[i], b = A[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  const sg = s > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a0 = A[i], b0 = A[(i + 1) % n], a1 = B[i], b1 = B[(i + 1) % n];
    const L0 = Math.hypot(b0[0] - a0[0], b0[1] - a0[1]), L1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
    if (L0 < 0.05 && L1 < 0.05) continue;
    const ex = (b0[0] - a0[0]) + (b1[0] - a1[0]), ez = (b0[1] - a0[1]) + (b1[1] - a1[1]), el = Math.hypot(ex, ez) || 1;
    // the normal of the (possibly leaning) face: across the edge and up the slope
    const mid0 = [(a0[0] + b0[0]) / 2, y0, (a0[1] + b0[1]) / 2], mid1 = [(a1[0] + b1[0]) / 2, y1, (a1[1] + b1[1]) / 2];
    const up = [mid1[0] - mid0[0], mid1[1] - mid0[1], mid1[2] - mid0[2]], ed = [ex / el, 0, ez / el];
    let nrm = [ed[1] * up[2] - ed[2] * up[1], ed[2] * up[0] - ed[0] * up[2], ed[0] * up[1] - ed[1] * up[0]];
    const nl = Math.hypot(...nrm) || 1; nrm = nrm.map((x) => x / nl);
    const want = [sg * ez / el, 0, -sg * ex / el];
    if (nrm[0] * want[0] + nrm[2] * want[2] < 0) nrm = nrm.map((x) => -x);
    const nb = (nbs ? nbs[i] : Math.max(1, Math.round((L0 + L1) / 2 / bay))) / nx;
    const v0 = (y0 - vRef) / (floor * ny), v1 = (y1 - vRef) / (floor * ny);
    acc.quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], nrm, [0, v0], [nb, v0], [nb, v1], [0, v1]);
  }
}
// the number of whole bays on each edge of a plan
export const bayCounts = (P, bay) => P.map((p, i) => Math.max(1, Math.round(Math.hypot(P[(i + 1) % P.length][0] - p[0], P[(i + 1) % P.length][1] - p[1]) / bay)));
// a rectangle (u0..u1, v0..v1) counter-clockwise (z south)
export const rectUV = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
// a plan with cut corners: half widths hu, hv round (cu, cv), the corners chamfered by c
export const chamferUV = (cu, cv, hu, hv, c) => [[cu - hu + c, cv - hv], [cu + hu - c, cv - hv], [cu + hu, cv - hv + c], [cu + hu, cv + hv - c], [cu + hu - c, cv + hv], [cu - hu + c, cv + hv], [cu - hu, cv + hv - c], [cu - hu, cv - hv + c]];
// a plan with rounded corners (radius rr, seg segments a corner)
export function roundUV(cu, cv, hu, hv, rr, seg = 4) {
  const P = [];
  for (const [sx, sz, a0] of [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]]) {
    const ccx = cu + sx * (hu - rr), ccz = cv + sz * (hv - rr);
    for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (Math.PI / 2); P.push([ccx + rr * Math.cos(a), ccz + rr * Math.sin(a)]); }
  }
  return P;
}
// plan helpers
export const scalePlan = (P, cu, cv, k, kv = k) => P.map(([u, v]) => [cu + (u - cu) * k, cv + (v - cv) * kv]);
export { offsetRing, ringOutSign, lathe, box, cyl };
