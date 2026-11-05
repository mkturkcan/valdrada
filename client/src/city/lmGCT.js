// lmGCT.js: Grand Central Terminal and its neighbours on their compiled rings (LM64, 2026-10-30).
// The old builders were boxes: the terminal a box under a flat green gable, the MetLife Building a stack of boxes (and the
// MetLife point fell on the Helmsley Building, so the MetLife box stood on 230 Park Avenue while the real tower drew as its
// 47.9 m base). The Grand Central diorama sees all of them from 2 to 5 km at 45 degrees, about 0.5 m a pixel, where what
// reads is the roofscape, the massing and setbacks, the window rhythm, the cornices and the silhouettes of the sculpture.
//   buildGrandCentral: Reed and Stem, Warren and Wetmore, 1913. The roof from the city's 3D building model (DoITT 2014):
//     the copper wings round three sides with their ridge caps and hipped ends, the concourse roof (a low gable with its
//     raised monitor and the pale roofing over the middle), the light courts with their pyramid skylights, the waiting room
//     roof with its four fans; the walls under every step of it. The 42nd Street front: granite base under the roadway,
//     the giant order (coupled fluted columns, three arched windows with their iron grids, narrow bays with an oculus over a
//     window), the entablature, the attic, the clock and Coutan's Mercury between Hercules and Minerva; the side fronts with
//     the concourse windows; the stone balustrade and lamps of the roadway along the fronts.
// All merged per material with lmFacadeKit.js (painted tiles with bump maps, mouldings swept round rings).
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import {
  Acc, wallRing, capRing, loft, box, cyl, lathe, facadeMat, offsetRing, ringOutSign, addMeshes, triCount, rgbs, speckle, streaks, rng,
} from './lmFacadeKit.js';

const { mat } = KIT;

/* ------------------------------------------------------------------ frames */
// The grid frame of a ring: U along the cross streets (the direction nearest `street`, world x east / z south), V the
// perpendicular toward the south. Returns the ring's extents in it.
function streetFrame(ring, street = [0.8728, 0.4881]) {
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
// Builds in a model frame (the city model's: u, height, v) and maps onto the ring at the end: the model's box
// [gu0, gu1] x [gv0, gv1] lands on the ring's extents in its own frame, then rotates into the world.
function frameMap(ring, ref, street) {
  const F = streetFrame(ring, street);
  const su = (F.u1 - F.u0) / (ref[1] - ref[0]), sv = (F.v1 - F.v0) / (ref[3] - ref[2]);
  const ok = su > 0.8 && su < 1.25 && sv > 0.8 && sv < 1.25;
  const mu = (u) => F.u0 + (u - ref[0]) * su, mv = (v) => F.v0 + (v - ref[2]) * sv;
  const xz = (u, v) => { const a = mu(u), b = mv(v); return [F.U[0] * a + F.V[0] * b, F.U[1] * a + F.V[1] * b]; };
  // rewrite an accumulator built in model space into local world space (positions mapped, normals rotated)
  const apply = (acc) => {
    const p = acc.p, n = acc.n;
    for (let i = 0; i < p.length; i += 3) {
      const [x, z] = xz(p[i], p[i + 2]);
      p[i] = x; p[i + 2] = z;
      const nu = n[i], nv = n[i + 2];
      n[i] = F.U[0] * nu + F.V[0] * nv; n[i + 2] = F.U[1] * nu + F.V[1] * nv;
    }
    return acc;
  };
  const um = (F.u0 + F.u1) / 2, vm = (F.v0 + F.v1) / 2;
  const centre = [F.U[0] * um + F.V[0] * vm, F.U[1] * um + F.V[1] * vm];   // the middle of the ring's extents, local metres
  return { F, su, sv, ok, xz, apply, centre, rot: Math.atan2(-F.U[1], F.U[0]) };
}

/* --------------------------------------------------------------- polygons */
const parsePolys = (s) => s.split('|').map((p) => p.trim().split(/\s+/).map((t) => t.split(',').map(Number)));
function inPoly(P, u, v) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const [ui, vi] = P[i], [uj, vj] = P[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c;
  }
  return c;
}
// the plane of a roof polygon (h = a u + b v + c), least squares over its vertices
function planeOf(P) {
  let n = 0, su = 0, sv = 0, sh = 0, suu = 0, svv = 0, suv = 0, suh = 0, svh = 0;
  for (const [u, v, h] of P) { n++; su += u; sv += v; sh += h; suu += u * u; svv += v * v; suv += u * v; suh += u * h; svh += v * h; }
  const mu = su / n, mv = sv / n, mh = sh / n;
  const cuu = suu / n - mu * mu, cvv = svv / n - mv * mv, cuv = suv / n - mu * mv, cuh = suh / n - mu * mh, cvh = svh / n - mv * mh;
  const det = cuu * cvv - cuv * cuv;
  if (Math.abs(det) < 1e-9) return { a: 0, b: 0, c: mh };
  const a = (cuh * cvv - cvh * cuv) / det, b = (cvh * cuu - cuh * cuv) / det;
  return { a, b, c: mh - a * mu - b * mv };
}
const areaOf = (P) => { let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; } return A / 2; };

/* ------------------------------------------------------------ profiles */
const PROF = {
  // the main cornice: bed mould, dentils, corona, cyma (metres out from the wall, metres up)
  cornice: [[0, 0], [0.18, 0], [0.18, 0.22], [0.42, 0.22], [0.42, 0.4], [0.62, 0.4], [0.62, 0.55], [1.25, 0.62], [1.25, 1.02], [1.45, 1.1], [1.45, 1.42], [1.2, 1.42], [1.2, 1.5], [0, 1.5]],
  atticCap: [[0, 0], [0.12, 0], [0.12, 0.12], [0.38, 0.18], [0.38, 0.42], [0.52, 0.48], [0.52, 0.62], [0, 0.62]],
  string: [[0, 0], [0.16, 0], [0.16, 0.14], [0.3, 0.2], [0.3, 0.38], [0, 0.38]],
};

/* ------------------------------------------------------------ the sweep */
// a profile swept along an open path in the xz plane (model space), mitred at the joints; profile [[out, up], ...]
// with `out` toward side `s` of the travel (+1 = the right of travel when looking down from above with z south)
function sweepOpen(acc, path, y0, profile, s = 1, capEnds = true) {
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
  // end caps: the profile polygon fanned at both ends
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

/* --------------------------------------------------------- figure kit */
// Sculpture from smooth parts (the group over the 42nd Street clock): ellipsoids, tapered limbs between joints, sheets.
const _sph = new THREE.SphereGeometry(1, 12, 9);
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
function ell(acc, c, r, rx = 0, ry = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ'); _q.setFromEuler(_e);
  _m4.compose(_v.set(c[0], c[1], c[2]), _q, _s.set(r[0], r[1], r[2]));
  acc.addGeo(_sph, _m4);
}
function limb(acc, a, b, ra, rb) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  if (L < 1e-4) return;
  const g = new THREE.CylinderGeometry(rb, ra, L, 9, 1, true);
  _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  _m4.compose(_v.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, _s.set(1, 1, 1));
  acc.addGeo(g, _m4); g.dispose();
  ell(acc, a, [ra, ra, ra]); ell(acc, b, [rb, rb, rb]);
}
// a sheet through a grid of points (rows x cols), both faces (cloaks, wings, the lion skin)
function sheet(acc, G) {
  for (let i = 0; i + 1 < G.length; i++) for (let j = 0; j + 1 < G[i].length; j++) {
    const a = G[i][j], b = G[i][j + 1], c = G[i + 1][j + 1], d = G[i + 1][j];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const L = Math.hypot(n[0], n[1], n[2]) || 1;
    const nn = [n[0] / L, n[1] / L, n[2] / L];
    acc.quad2(a, b, c, d, nn);
  }
}

/* ---------------------------------------------------------- canvas tiles */
const _tiles = new Map();
// one canvas pair (albedo, bump) of w x h px painted by paint(g, gb, w, h, r); repeat-wrapped, cached by key
function tile(key, w, h, paint, seed = 1, nx = 1, ny = 1) {
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
function ashlarPaint(base, { hc, bw, joint = 'rgba(40,34,28,0.32)', tone = 0.05, grime = 0.06, rustic = 0 }) {
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
// the great windows' iron: a dark glazed field under bronze-green bars (one tile = 4 x 3 panes of 0.66 x 1.25 m)
function gridPaint(g, gb, w, h, r) {
  const cw = w / 4, ch = h / 3;
  for (let j = 0; j < 3; j++) for (let i = 0; i < 4; i++) {
    const x = i * cw, y = j * ch;
    const gl = g.createLinearGradient(0, y, 0, y + ch);
    const k = 0.85 + r() * 0.3;
    gl.addColorStop(0, rgbs([62, 76, 84], k)); gl.addColorStop(1, rgbs([34, 42, 48], k));
    g.fillStyle = gl; g.fillRect(x, y, cw, ch);
    if (r() < 0.1) { g.fillStyle = 'rgba(255,214,150,0.16)'; g.fillRect(x + 3, y + 3, cw - 6, ch - 6); }    // the concourse's lights behind
    gb.fillStyle = 'rgb(60,60,60)'; gb.fillRect(x, y, cw, ch);
  }
  g.fillStyle = 'rgb(66,82,72)'; gb.fillStyle = 'rgb(220,220,220)';
  for (let i = 0; i <= 4; i++) { g.fillRect(i * cw - 3, 0, 6, h); gb.fillRect(i * cw - 3, 0, 6, h); }
  for (let j = 0; j <= 3; j++) { g.fillRect(0, j * ch - 4, w, 8); gb.fillRect(0, j * ch - 4, w, 8); }
}

// a shop bay under the roadway (5 m x 7 m, rows from the top): granite, the dark green sign band with its gilt letters,
// the display window in its green frame with lit goods behind, the bulkhead
function shopPaint(g, gb, w, h, r) {
  const Y = (m) => (7 - m) * (h / 7), X = (m) => m * (w / 5);
  g.fillStyle = rgbs(GRAN); g.fillRect(0, 0, w, h);
  speckle(g, 0, 0, w, h, r, 260, 0.06);
  g.fillStyle = 'rgb(46,62,52)'; g.fillRect(X(0), Y(5.2), X(5), Y(4.35) - Y(5.2));
  for (let k = 0; k < 14; k++) { g.fillStyle = 'rgba(214,180,96,0.85)'; g.fillRect(X(0.5 + k * 0.29), Y(4.95), X(0.17), Y(4.6) - Y(4.95)); }
  g.fillStyle = 'rgb(52,70,58)'; g.fillRect(X(0), Y(4.35), X(5), Y(0.55) - Y(4.35));
  const gl = g.createLinearGradient(0, Y(4.2), 0, Y(0.7));
  gl.addColorStop(0, 'rgb(92,104,110)'); gl.addColorStop(0.45, 'rgb(150,132,104)'); gl.addColorStop(1, 'rgb(60,56,52)');
  for (const [a, b] of [[0.15, 2.4], [2.6, 4.85]]) {
    g.fillStyle = gl; g.fillRect(X(a), Y(4.2), X(b - a), Y(0.7) - Y(4.2));
    gb.fillStyle = 'rgb(90,90,90)'; gb.fillRect(X(a), Y(4.2), X(b - a), Y(0.7) - Y(4.2));
  }
  g.fillStyle = 'rgb(40,46,42)'; g.fillRect(X(0), Y(0.55), X(5), Y(0) - Y(0.55));
}

/* --------------------------------------------------------- the roof atlas */
// The whole roof of the terminal painted in plan (model frame metres): copper wings and gable with their standing
// seams down every slope, the lead ridge caps, the pale roofing over the middle of the concourse, the black membranes of
// the courts and the waiting room, the skylights' glass and bars, the stone ledges. Every roof polygon samples it in plan.
const ATL = { u0: -52, v0: -51, m: 95, px: 1024 };
// the canvas is drawn with v down its rows and the texture is flipped on upload, so rows count from the top
const atU = (u) => (u - ATL.u0) / ATL.m, atV = (v) => 1 - (v - ATL.v0) / ATL.m;
function classifyRoofs(polys) {
  return polys.map((P) => {
    let h0 = 1e9, h1 = -1e9, cu = 0, cv = 0;
    for (const [u, v, h] of P) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); cu += u / P.length; cv += v / P.length; }
    const A = Math.abs(areaOf(P)), dh = h1 - h0;
    let k;
    if (cv > 36.4 && Math.abs(cu + 4.2) < 11 && h1 > 38) k = 'skip';                       // tops of the sculpture group
    else if (h1 < 18.7) k = 'court';
    else if (h1 < 20.2) k = 'sky';                                                        // pyramid skylights over the courts
    else if (A < 18 && dh < 0.2 && h1 < 32) k = 'pier';                                   // the piers' caps in the courts
    else if (Math.abs(h1 - 34.2) < 0.2) k = 'block';
    else if (Math.abs(h1 - 36.3) < 0.15 && A > 100) k = 'waiting';
    else if (h0 > 36.8 && h1 < 40 && cu > -25 && cu < 16 && cv > -22.5 && cv < -9) k = 'monitor';
    else if (h0 > 31 && h1 < 37.6 && cu > -34 && cu < 25 && cv > -36 && cv < 4) k = 'gable';
    else if (dh < 0.2 && (h1 > 43 || (h1 > 41.5 && A < 40) || h1 > 42.5)) k = 'crest';
    else if (dh < 0.2 && h1 < 36.5) k = 'ledge';
    else if (P.length > 9 && h1 < 38.8) k = 'arch';
    else k = 'copper';
    return { P, k, h0, h1, A, pl: planeOf(P) };
  });
}
function roofAtlas(R) {
  return tile('gct-roof-atlas', ATL.px, ATL.px, (g, gb, w, h, r) => {
    const S = w / ATL.m, X = (u) => (u - ATL.u0) * S, Y = (v) => (v - ATL.v0) * S;
    g.fillStyle = 'rgb(70,66,60)'; g.fillRect(0, 0, w, h);
    const path = (c, P) => { c.beginPath(); P.forEach(([u, v], i) => (i ? c.lineTo(X(u), Y(v)) : c.moveTo(X(u), Y(v)))); c.closePath(); };
    const COP = [124, 127, 74], COP2 = [142, 148, 92], LEAD = [150, 150, 138], STONE = [186, 178, 160], TAN = [182, 164, 134], MEM = [56, 51, 48];
    const seams = (c, cb, P, pl, col, step) => {
      // the seams run down the slope: along the gradient (a, b) of the plane; across it for flats
      let dx = pl.a, dy = pl.b; const L = Math.hypot(dx, dy);
      if (L < 0.02) { dx = 1; dy = 0; } else { dx /= L; dy /= L; }
      const nx = -dy, ny = dx;
      let mn = 1e9, mx = -1e9;
      for (const [u, v] of P) { const t = u * nx + v * ny; mn = Math.min(mn, t); mx = Math.max(mx, t); }
      c.save(); path(c, P); c.clip(); cb.save(); path(cb, P); cb.clip();
      for (let t = Math.floor(mn / step) * step; t <= mx; t += step) {
        const ax = nx * t - dx * 200, ay = ny * t - dy * 200, bx = nx * t + dx * 200, by = ny * t + dy * 200;
        c.strokeStyle = rgbs(col, 0.78, 0.55); c.lineWidth = 1.3; c.beginPath(); c.moveTo(X(ax), Y(ay)); c.lineTo(X(bx), Y(by)); c.stroke();
        c.strokeStyle = rgbs(col, 1.12, 0.35); c.lineWidth = 0.8; c.beginPath(); c.moveTo(X(ax) + 1.2, Y(ay)); c.lineTo(X(bx) + 1.2, Y(by)); c.stroke();
        cb.strokeStyle = 'rgb(205,205,205)'; cb.lineWidth = 1.6; cb.beginPath(); cb.moveTo(X(ax), Y(ay)); cb.lineTo(X(bx), Y(by)); cb.stroke();
      }
      c.restore(); cb.restore();
    };
    const blotch = (c, P, n, colA, amp) => {
      c.save(); path(c, P); c.clip();
      let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9;
      for (const [u, v] of P) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      for (let i = 0; i < n; i++) {
        const u = u0 + r() * (u1 - u0), v = v0 + r() * (v1 - v0), rr = (0.8 + r() * 3.5) * S;
        const gr = c.createRadialGradient(X(u), Y(v), 0, X(u), Y(v), rr);
        gr.addColorStop(0, rgbs(colA, 1, amp * (0.4 + r() * 0.6))); gr.addColorStop(1, rgbs(colA, 1, 0));
        c.fillStyle = gr; c.fillRect(X(u) - rr, Y(v) - rr, 2 * rr, 2 * rr);
      }
      c.restore();
    };
    for (const q of R) {
      const { P, k, pl } = q;
      if (k === 'skip') continue;
      if (k === 'copper' || k === 'gable') {
        g.fillStyle = rgbs(COP, 0.95 + r() * 0.1); path(g, P); g.fill();
        blotch(g, P, Math.round(q.A / 12), COP2, 0.5);
        blotch(g, P, Math.round(q.A / 40), [84, 90, 60], 0.3);
        seams(g, gb, P, pl, COP, 0.55);
      } else if (k === 'crest') {
        g.fillStyle = rgbs(LEAD, 0.9 + r() * 0.15); path(g, P); g.fill();
        seams(g, gb, P, { a: 0, b: 0 }, LEAD, 1.8);
      } else if (k === 'monitor') {
        g.fillStyle = rgbs(TAN, 1.0); path(g, P); g.fill();
        blotch(g, P, 20, [190, 176, 150], 0.5);
        seams(g, gb, P, pl, TAN, 1.2);
      } else if (k === 'ledge' || k === 'arch' || k === 'pier') {
        g.fillStyle = rgbs(STONE, 0.95 + r() * 0.1); path(g, P); g.fill();
      } else if (k === 'block') {
        g.fillStyle = rgbs([150, 146, 138]); path(g, P); g.fill();
      } else if (k === 'court' || k === 'waiting') {
        g.fillStyle = rgbs(MEM, k === 'waiting' ? 1.05 : 1.12); path(g, P); g.fill();
        blotch(g, P, Math.round(q.A / 10), [90, 84, 78], 0.35);
        seams(g, gb, P, { a: 1, b: 0 }, MEM, 1.0);
      } else if (k === 'sky') {
        g.fillStyle = 'rgb(36,38,42)'; path(g, P); g.fill();
        seams(g, gb, P, pl, [120, 124, 120], 0.9);
      }
    }
    // the pale roofing over the middle of the concourse (a light panel field over the monitor and the
    // upper slopes, long strips along the hall, the green showing only toward the eaves and at the gable ends)
    const gab = R.filter((q) => q.k === 'gable' || q.k === 'monitor');
    g.save(); gb.save();
    g.beginPath(); gb.beginPath();
    for (const q of gab) { q.P.forEach(([u, v], i) => (i ? g.lineTo(X(u), Y(v)) : g.moveTo(X(u), Y(v)))); g.closePath(); q.P.forEach(([u, v], i) => (i ? gb.lineTo(X(u), Y(v)) : gb.moveTo(X(u), Y(v)))); gb.closePath(); }
    g.clip(); gb.clip();
    g.fillStyle = rgbs(TAN, 0.98); g.fillRect(X(-24), Y(-28), (38.3) * S, 24.7 * S);
    gb.fillStyle = 'rgb(140,140,140)'; gb.fillRect(X(-24), Y(-28), 38.3 * S, 24.7 * S);
    for (let v = -28; v <= -3.3; v += 4.9) {
      g.fillStyle = 'rgba(90,80,64,0.45)'; g.fillRect(X(-24), Y(v) - 1, 38.3 * S, 2);
      gb.fillStyle = 'rgb(200,200,200)'; gb.fillRect(X(-24), Y(v) - 1.5, 38.3 * S, 3);
    }
    for (let i = 0; i < 160; i++) {
      const u = -24 + r() * 38.3, v = -28 + r() * 24.7;
      g.fillStyle = r() < 0.5 ? `rgba(120,104,84,${(0.08 + r() * 0.12).toFixed(2)})` : `rgba(214,204,184,${(0.08 + r() * 0.12).toFixed(2)})`;
      g.fillRect(X(u), Y(v), (1 + r() * 4) * S, (0.3 + r() * 1.2) * S);
    }
    g.restore(); gb.restore();
    // grime along the eaves of every copper slope: a darker band at the low edge
    for (const q of R) {
      if (q.k !== 'copper' && q.k !== 'gable') continue;
      const { P, pl } = q;
      const L = Math.hypot(pl.a, pl.b);
      if (L < 0.05) continue;
      g.save(); path(g, P); g.clip();
      for (const [u, v, hh] of P) {
        if (hh > q.h0 + 0.3) continue;
        const gr = g.createRadialGradient(X(u), Y(v), 0, X(u), Y(v), 3 * S);
        gr.addColorStop(0, 'rgba(40,44,32,0.35)'); gr.addColorStop(1, 'rgba(40,44,32,0)');
        g.fillStyle = gr; g.fillRect(X(u) - 3 * S, Y(v) - 3 * S, 6 * S, 6 * S);
      }
      g.restore();
    }
  }, 64);
}

/* ------------------------------------------------------------ materials */
let _GCT = null;
const LIME = [206, 199, 184], GRAN = [168, 156, 150];
function gctMats(R) {
  if (_GCT) return _GCT;
  const roofT = roofAtlas(R);
  const limeT = tile('gct-lime', 256, 256, ashlarPaint(LIME, { hc: 256 / 8, bw: 256 / 3.5, tone: 0.045, grime: 0.05 }), 65);
  const granT = tile('gct-gran', 256, 256, ashlarPaint(GRAN, { hc: 256 / 5, bw: 256 / 2.4, tone: 0.06, grime: 0.04, rustic: 1 }), 66);
  const gridT = tile('gct-grid', 256, 384, gridPaint, 67);
  const shopT = tile('gct-shops', 200, 280, shopPaint, 68);
  const inscT = tile('gct-inscription', 512, 160, (g, gb, w, h, r) => {
    g.fillStyle = rgbs(LIME, 1.02); g.fillRect(0, 0, w, h); speckle(g, 0, 0, w, h, r, 300, 0.05);
    g.font = `bold ${Math.round(h * 0.3)}px Georgia, 'Times New Roman', serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const [t, y] of [['GRAND CENTRAL', 0.3], ['TERMINAL', 0.72]]) {
      g.fillStyle = 'rgba(70,62,52,0.85)'; g.fillText(t, w / 2 + 1.5, h * y + 1.5);
      g.fillStyle = rgbs(LIME, 0.78); g.fillText(t, w / 2, h * y);
      gb.font = g.font; gb.textAlign = 'center'; gb.textBaseline = 'middle'; gb.fillStyle = 'rgb(70,70,70)'; gb.fillText(t, w / 2, h * y);
    }
  }, 69);
  _GCT = {
    tx: { roofT, limeT, granT, gridT, shopT },
    shops: facadeMat('gct-shops', shopT, { rough: 0.5, metal: 0.1, bump: 1.0 }),
    inscription: facadeMat('gct-inscription', inscT, { rough: 0.82, bump: 1.6 }),
    roof: facadeMat('gct-roof', roofT, { rough: 0.74, metal: 0.06, bump: 1.4 }),
    lime: facadeMat('gct-lime', limeT, { rough: 0.82, bump: 1.2 }),
    gran: facadeMat('gct-gran', granT, { rough: 0.86, bump: 1.6 }),
    grid: facadeMat('gct-grid', gridT, { rough: 0.35, metal: 0.35, bump: 1.6 }),
    stone: mat(0xd2cab8, { rough: 0.8, flat: false, stone: { set: 'climestone', amt: 0.3, nrm: 0.45, rgh: 0.3, ashlar: 0.35 } }),
    statue: mat(0x9c978c, { rough: 0.86, flat: false, stone: { set: 'climestone', amt: 0.25, nrm: 0.6, rgh: 0.2 } }),
    lead: mat(0x707268, { rough: 0.75, metal: 0.15, flat: false }),
    bronze: mat(0x3b4a40, { rough: 0.5, metal: 0.55, flat: false }),
    dark: mat(0x1d2024, { rough: 0.6, flat: false }),
    fan: mat(0xc8ccce, { rough: 0.5, metal: 0.3, flat: false }),
    gilt: mat(0xc6a048, { rough: 0.3, metal: 0.85, flat: false }),
    clock: mat(0xd9b856, { rough: 0.35, metal: 0.4, emissive: 0x302408, emissiveIntensity: 0.4, flat: false }),
    lamp: mat(0xf2e6c8, { rough: 0.3, emissive: 0x8a6a30, emissiveIntensity: 0.35, flat: false }),
  };
  return _GCT;
}

/* --------------------------------------------------------------- walls */
// the walls under every step of the roof: each roof edge whose outside is lower drops a wall to that lower surface (the
// courts' walls, the concourse's sides, the monitor's clerestory, the ridge caps); edges on the outer ring are left to the
// fronts. Walls are cut in 1.5 m pieces so a wall that faces two lower roofs stops on each.
function stepWalls(R, outer, emit, groundOuter = false) {
  const live = R.filter((q) => q.k !== 'skip');
  const hAt = (u, v, self) => {      // every surface counts as a neighbour, also the ones not drawn (the group's tops)
    let best = null;
    for (const q of R) {
      if (q === self || !inPoly(q.P, u, v)) continue;
      const hh = q.pl.a * u + q.pl.b * v + q.pl.c;
      if (best === null || hh > best) best = hh;
    }
    return best;
  };
  for (const q of live) {
    const P = q.P, n = P.length;
    for (let i = 0; i < n; i++) {
      const a = P[i], b = P[(i + 1) % n];
      const eu = b[0] - a[0], ev = b[1] - a[1], L = Math.hypot(eu, ev);
      if (L < 0.05) continue;
      let nu = ev / L, nv = -eu / L;
      if (inPoly(P, (a[0] + b[0]) / 2 + nu * 0.08, (a[1] + b[1]) / 2 + nv * 0.08)) { nu = -nu; nv = -nv; }
      const m = Math.max(1, Math.ceil(L / 1.5));
      for (let k = 0; k < m; k++) {
        const t0 = k / m, t1 = (k + 1) / m, tm = (t0 + t1) / 2;
        const pu = a[0] + eu * tm + nu * 0.12, pv = a[1] + ev * tm + nv * 0.12;
        let hn = hAt(pu, pv, q);
        if (hn === null) { if (!groundOuter) continue; hn = 0; }   // the outer ring: its fronts built apart, or walls to the ground
        const ha = a[2] + (b[2] - a[2]) * t0, hb = a[2] + (b[2] - a[2]) * t1;
        if (Math.min(ha, hb) - hn < 0.05) continue;
        emit([a[0] + eu * t0, a[1] + ev * t0, ha], [a[0] + eu * t1, a[1] + ev * t1, hb], hn, [nu, nv], q, L * t0);
      }
    }
  }
}

/* --------------------------------------------------------- facade kit */
// A front built in its own plane: s metres along it, y up, d out of the wall. `fr` maps (s, y, d) to model space.
function frontFrame(u0, v0, du, dv) {           // origin (u0, v0) on the wall line, (du, dv) the unit direction of +s
  const nu = -dv, nv = du;                        // outward = the right of travel (z south): +s east on a south front -> +v
  const fr = { P: (s, y, d) => [u0 + du * s + nu * d, y, v0 + dv * s + nv * d], N: (ns, ny, nd) => [du * ns + nu * nd, ny, dv * ns + nv * nd], du, dv, nu, nv };
  fr.xz = (s, d) => [u0 + du * s + nu * d, v0 + dv * s + nv * d];
  fr.shift = (d0) => frontFrame(u0 + nu * d0, v0 + nv * d0, du, dv);
  return fr;
}
// a planar polygon with holes in a front's plane at depth d, facing +d (or -d), UV in metres / uvM
function frontPoly(acc, fr, outer, holes, d, uvM = 4.8, facing = 1, uvV = uvM, uOff = 0) {
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
    const uv = (Q) => [(Q[0] - uOff) / uvM, Q[1] / uvV];
    if (cx * n[0] + cy * n[1] + cz * n[2] >= 0) acc.tri(pa, pb, pc, n, uv(A), uv(B), uv(C)); else acc.tri(pa, pc, pb, n, uv(A), uv(C), uv(B));
  }
}
// the reveal of an opening: its outline swept from the wall (d = 0) back to depth -dep, faces looking into the opening
function reveal(acc, fr, loop, dep, uvM = 4.8) {
  const n = loop.length;
  let A = 0; for (let i = 0; i < n; i++) { const a = loop[i], b = loop[(i + 1) % n]; A += a[0] * b[1] - b[0] * a[1]; }
  const sg = A > 0 ? 1 : -1;
  let run = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[i], b = loop[(i + 1) % n], es = b[0] - a[0], ey = b[1] - a[1], L = Math.hypot(es, ey);
    if (L < 1e-4) continue;
    const ns = -sg * ey / L, ny = sg * es / L;    // the left normal of a counter-clockwise outline: into the opening
    acc.quad(fr.P(a[0], a[1], 0), fr.P(b[0], b[1], 0), fr.P(b[0], b[1], -dep), fr.P(a[0], a[1], -dep), fr.N(ns, ny, 0),
      [run / uvM, 0], [(run + L) / uvM, 0], [(run + L) / uvM, dep / uvM], [run / uvM, dep / uvM]);
    run += L;
  }
}
const archLoop = (s0, s1, y0, ys, seg = 16) => {     // a round-headed opening: sill y0, springing ys, counter-clockwise
  const r = (s1 - s0) / 2, c = (s0 + s1) / 2, P = [[s0, y0], [s1, y0], [s1, ys]];
  for (let k = 1; k < seg; k++) { const t = (k / seg) * Math.PI; P.push([c + r * Math.cos(t), ys + r * Math.sin(t)]); }
  P.push([s0, ys]);
  return P;
};
const rectLoop = (s0, s1, y0, y1) => [[s0, y0], [s1, y0], [s1, y1], [s0, y1]];
const ovalLoop = (c, yc, rs, ry, seg = 20) => Array.from({ length: seg }, (_, k) => { const t = (k / seg) * Math.PI * 2; return [c + rs * Math.cos(t), yc + ry * Math.sin(t)]; });
// a fluted column on a front: axis at (s, d), from y0 (the base) to y1 (the top of the capital)
function frontColumn(acc, fr, s, d, y0, y1, r) {
  const [x, , z] = fr.P(s, 0, d);
  const rot = Math.atan2(-fr.dv, fr.du);
  lathe(acc, x, y0, z, [[r * 1.42, 0], [r * 1.42, 0.22], [r * 1.3, 0.3], [r * 1.3, 0.5], [r * 1.12, 0.62], [r * 1.05, 0.72], [r, 0.78], [0, 0.78]], 18, rot);
  const hS = y1 - y0 - 0.78 - 1.25;
  cyl(acc, x, y0 + 0.78, z, r * 0.86, r, hS, 20, rot, true, true);           // the shaft: 20 facets, the flutes at range
  const yc = y0 + 0.78 + hS;
  lathe(acc, x, yc, z, [[r * 0.86, 0], [r * 0.95, 0.12], [r * 0.95, 0.22], [r * 0.88, 0.3], [r * 1.2, 0.55], [r * 1.32, 0.78], [0, 0.78]], 18, rot);
  box(acc, x, yc + 0.78, z, r * 2.8, 0.47, r * 2.8, rot);                     // the abacus
}

/* ---------------------------------------------------- the sculpture group */
// Coutan's Glory of Commerce over the clock (1914): Mercury standing on the clock's crest with his arms out and his wings
// spread, Hercules reclining on the left, Minerva seated on the right, an eagle at Mercury's feet; on a scrolled base.
// Built in the front's frame (s along the front, y up, d out); about 20 m wide and 13 m over the attic. Hercules leans
// on the base's left scroll, Minerva sits with her shield on the right.
function sculptureGroup(acc, fr, y0) {
  const ry = Math.atan2(-fr.dv, fr.du);
  // each figure in its own unit frame (ds, dy, dd) about an anchor, scaled by k
  const fig = (a, k) => {
    const P = (q) => fr.P(a[0] + k * q[0], a[1] + k * q[1], a[2] + k * q[2]);
    return {
      L: (p, q, ra, rb) => limb(acc, P(p), P(q), ra * k * 1.35, rb * k * 1.35),
      E: (c, r, rx = 0, rz = 0) => ell(acc, P(c), [r[0] * k, r[1] * k, r[2] * k], rx, ry, rz),
      S: (G) => sheet(acc, G.map((row) => row.map(P))),
      Lt: (c, pts, seg = 12) => { const p = P(c); lathe(acc, p[0], p[1], p[2], pts.map(([r, h]) => [r * k, h * k]), seg); },
    };
  };
  // the base: a broken pediment of scrolls either side of the clock's frame, 20 m across
  for (const sg of [-1, 1]) {
    const pts = [];
    for (let k = 0; k <= 12; k++) { const t = k / 12; pts.push([sg * (2.9 + 6.9 * t), y0 + 2.3 - 1.7 * t * t]); }
    for (let k = 0; k + 1 < pts.length; k++) {
      const [s0, h0] = pts[k], [s1, h1] = pts[k + 1];
      acc.quad(fr.P(s0, y0, 0.5), fr.P(s1, y0, 0.5), fr.P(s1, h1, 0.5), fr.P(s0, h0, 0.5), fr.N(0, 0, 1));
      acc.quad(fr.P(s0, h0, 0.5), fr.P(s1, h1, 0.5), fr.P(s1, h1, -2.6), fr.P(s0, h0, -2.6), fr.N(0, 1, 0));
    }
    ell(acc, fr.P(sg * 9.5, y0 + 0.75, -0.9), [0.8, 0.8, 1.5], 0, ry, 0);      // the scroll's volute
    acc.quad(fr.P(sg * 9.8, y0, 0.5), fr.P(sg * 9.8, y0 + 0.6, 0.5), fr.P(sg * 9.8, y0 + 0.6, -2.6), fr.P(sg * 9.8, y0, -2.6), fr.N(sg, 0, 0));
  }
  // Hercules (left): a colossal nude reclining toward the middle, the left arm down on the scroll, the right knee up, the
  // club along his leg; his head 7.5 m over the attic
  {
    const H = fig([-6.1, y0 + 0.7, -0.8], 1.75);
    H.E([-0.3, 2.35, 0], [1.1, 1.35, 0.85], 0, 0.45);                         // the chest, leaning in
    H.E([0.2, 1.8, 0.1], [0.9, 0.8, 0.75]);                                    // the belly and the lion skin over it
    H.E([0.5, 1.15, 0], [1.0, 0.72, 0.8]);                                     // the hips
    H.E([-0.75, 3.65, 0.1], [0.42, 0.52, 0.44]);                               // the head
    H.L([0.9, 1.1, 0.2], [2.3, 2.0, 0.6], 0.42, 0.32);                         // the raised thigh
    H.L([2.3, 2.0, 0.6], [3.0, 0.3, 0.8], 0.3, 0.22);                          // the shin down to the base
    H.L([0.9, 0.9, -0.4], [2.9, 0.45, -0.5], 0.4, 0.26);                       // the other leg along the base
    H.L([-1.0, 2.8, 0.1], [-2.0, 1.2, 0.3], 0.3, 0.25);                        // the left arm down on the scroll
    H.L([0.0, 2.8, 0.3], [1.3, 1.9, 0.8], 0.28, 0.22);                         // the right arm over the knee
    H.L([1.6, 1.7, 0.9], [3.3, 0.5, 1.0], 0.16, 0.24);                         // the club
    H.S([[[-1.4, 2.9, -0.6], [-0.4, 3.0, -0.7], [0.6, 2.4, -0.7]], [[-1.7, 1.2, -0.7], [-0.4, 0.8, -0.8], [0.9, 0.6, -0.8]]]);   // the lion skin behind
  }
  // Minerva (right): seated upright, helmeted, the spear up in her right hand, the shield at her side, the robe to the base
  {
    const N = fig([6.0, y0 + 0.65, -0.8], 1.75);
    N.Lt([0, 0, 0], [[1.25, 0], [1.2, 0.5], [0.95, 1.0], [0.72, 1.55], [0.6, 2.2], [0.66, 2.6], [0.48, 2.85], [0.18, 2.95], [0, 2.95]], 12);
    N.E([0, 3.25, 0], [0.4, 0.48, 0.42]);                                      // the head
    N.E([0, 3.7, -0.05], [0.34, 0.32, 0.5], 0.3, 0);                           // the helmet and its crest
    N.L([-0.45, 2.5, 0.1], [-1.5, 1.6, 0.8], 0.24, 0.2);                       // the arm toward the middle
    N.L([0.55, 2.55, 0], [1.2, 3.8, 0.1], 0.22, 0.18);                         // the arm up with the spear
    N.L([1.25, 0.9, 0.1], [1.35, 5.4, 0.1], 0.07, 0.07);                       // the spear
    N.E([1.45, 1.05, 0.5], [0.12, 1.1, 1.1], 0, 0);                            // the shield
    N.L([-0.3, 0.5, 0.3], [-1.3, 0.3, 1.2], 0.42, 0.35);                       // the knees under the robe
    N.E([-0.9, 0.35, 0.9], [0.8, 0.45, 0.7]);                                  // the robe's fall over the base
  }
  // the eagle at Mercury's feet, wings half spread over the clock's crest
  {
    const A = fig([0, y0 + 5.0, 0.35], 1.25);
    A.E([0, 0, 0], [0.75, 0.55, 0.6]);
    A.E([0, 0.55, 0.35], [0.22, 0.25, 0.3]);
    for (const sg of [-1, 1]) A.S([[[sg * 0.5, 0.2, -0.1], [sg * 1.6, 0.95, -0.3], [sg * 2.6, 0.45, -0.4]], [[sg * 0.5, -0.3, -0.1], [sg * 1.5, -0.45, -0.3], [sg * 2.4, -0.65, -0.4]]]);
  }
  // Mercury: on the crest over the clock, the body forward, the arms out and up, the winged hat, the cloak, the wings
  {
    const M = fig([0, y0 + 5.7, -0.4], 1.5);
    M.L([-0.45, 0, -0.1], [-0.5, 1.9, -0.15], 0.26, 0.36);                     // the legs
    M.L([0.45, 0, 0.15], [0.45, 1.9, -0.05], 0.26, 0.36);
    M.E([0, 2.15, -0.1], [0.75, 0.55, 0.5]);                                   // the hips
    M.E([0, 3.2, 0], [0.72, 0.95, 0.55]);                                      // the chest
    M.E([0, 4.45, 0.1], [0.36, 0.43, 0.38]);                                   // the head
    M.E([0, 4.82, 0.05], [0.5, 0.14, 0.5]);                                    // the petasos
    for (const sg of [-1, 1]) {
      M.L([sg * 0.55, 3.8, 0], [sg * 1.6, 4.3, 0.3], 0.2, 0.17);               // the upper arms
      M.L([sg * 1.6, 4.3, 0.3], [sg * 2.3, 5.0, 0.4], 0.17, 0.12);             // the forearms raised
      M.E([sg * 2.4, 5.1, 0.42], [0.16, 0.2, 0.12]);
      M.E([sg * 0.45, 4.95, 0], [0.2, 0.08, 0.32], 0, -sg * 0.6);              // the hat's wings
    }
    M.L([2.35, 4.6, 0.4], [2.2, 6.0, 0.35], 0.04, 0.04);                       // the caduceus
    M.E([0, 1.3, 0.05], [0.65, 1.05, 0.5]);                                    // the drapery over the hips and the leading leg
    M.S([[[-0.7, 3.9, -0.45], [0, 4.0, -0.6], [0.7, 3.9, -0.45]], [[-1.5, 2.4, -1.15], [0, 2.2, -1.35], [1.5, 2.4, -1.15]], [[-2.1, 0.6, -1.65], [0, 0.2, -1.85], [2.1, 0.6, -1.65]]]);   // the cloak
    for (const sg of [-1, 1]) {                                                 // the wings, spread level, the primaries fanned
      const W = [];
      for (let i = 0; i <= 4; i++) {
        const t = i / 4, sx = sg * (0.4 + 3.0 * t), lift = 0.6 * Math.sin(t * Math.PI * 0.9) + 0.2 * t;
        W.push([[sx, 3.6 + lift, -0.75 - 0.3 * t], [sx, 2.6 + lift - 0.4 * t, -0.85 - 0.35 * t], [sx * 0.98, 1.7 + lift - 0.9 * t * t, -0.95 - 0.35 * t]]);
      }
      M.S(W);
      // the primaries: broad feathers fanned from the wing's tip, each a tapering blade
      for (let k = 0; k < 6; k++) {
        const a = 0.55 - k * 0.28, r0 = 2.9, r1 = 4.3 - 0.12 * k, yk = 3.2 - 0.25 * k;
        const ax = Math.cos(a), ay = Math.sin(a), wdt = 0.32 - 0.02 * k;
        M.S([[[sg * r0, yk, -1.05], [sg * (r0 + (r1 - r0) * ax), yk + (r1 - r0) * ay, -1.2]],
          [[sg * r0, yk - wdt * 2, -1.05], [sg * (r0 + (r1 - r0) * ax) - sg * 0.05, yk + (r1 - r0) * ay - wdt * 0.6, -1.2]]]);
      }
    }
  }
}

/* --------------------------------------------------------- open balustrade */
// a balustrade along an open path in model space (rails, turned balusters 0.42 m apart, a pedestal every `ped` m)
function balustradeOpen(acc, path, y, s = 1, ped = 6) {
  sweepOpen(acc, path, y, [[-0.2, 0], [0.2, 0], [0.2, 0.22], [-0.2, 0.22]], s, true);
  sweepOpen(acc, path, y + 0.88, [[-0.24, 0], [0.24, 0], [0.24, 0.12], [0.18, 0.2], [-0.18, 0.2], [-0.24, 0.12]], s, true);
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.6) continue;
    const rot = Math.atan2(-ez, ex);
    const nb = Math.max(1, Math.round(L / 0.42));
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) / nb;
      lathe(acc, a[0] + ex * t, y + 0.22, a[1] + ez * t, [[0.08, 0], [0.12, 0.1], [0.07, 0.3], [0.055, 0.52], [0.09, 0.6], [0.09, 0.66], [0, 0.66]], 6);
    }
    const np = Math.max(1, Math.round(L / ped));
    for (let k = 0; k <= np; k++) {
      const t = k / np;
      box(acc, a[0] + ex * t, y, a[1] + ez * t, 0.55, 1.12, 0.55, rot);
    }
  }
}
// a cast-iron lamp standard with two lanterns (the roadway's lamps round the terminal)
function lampStandard(acc, glass, x, y, z, rot = 0) {
  lathe(acc, x, y, z, [[0.28, 0], [0.28, 0.35], [0.2, 0.5], [0.13, 0.9], [0.1, 2.6], [0.08, 4.4], [0.11, 4.6], [0, 4.62]], 8);
  for (const sg of [-1, 1]) {
    const c = Math.cos(rot), sn = Math.sin(rot), lx = x + sg * 0.62 * c, lz = z - sg * 0.62 * sn;
    box(acc, (x + lx) / 2, y + 4.3, (z + lz) / 2, 1.3, 0.07, 0.07, rot);
    lathe(acc, lx, y + 3.9, lz, [[0.06, 0], [0.2, 0.08], [0.22, 0.12], [0, 0.12]], 8);
    lathe(glass, lx, y + 4.02, lz, [[0.17, 0], [0.21, 0.34], [0, 0.34]], 8);
    lathe(acc, lx, y + 4.36, lz, [[0.25, 0], [0.1, 0.18], [0.03, 0.3], [0, 0.32]], 8);
  }
}

/* ----------------------------------------------------- the 42nd Street front */
// The giant order from 9.5 m (the column bases on their pedestals over the roadway) to 25.8 m (the capitals), the
// entablature to 30.1 m, the attic to 36.1 m; three arched windows 8.4 m wide springing at 19.4 m, centred 24.6 m apart;
// between them a column pair, a narrow bay (a window 3.1 m wide under an oval oculus) and a column pair; a column pair past
// each outer window, then a plain end bay 8.7 m wide to the corner, its attic under a carved cartouche. Under the roadway
// the granite ground floor with its shops, the entrance under the viaduct, the balustrade along the roadway's outer edge.
const F42 = {
  wins: [-24.6, 0, 24.6], winH: 4.2, sill: 9.6, spring: 19.4,
  narrow: [-12, 12], nW: 1.55, nY0: 9.8, nY1: 18.4, ocY: 22.0, ocR: [1.2, 1.6],
  pairs: [[-33.15, -30.4], [-17.95, -15.2], [-8.95, -6.15], [6.15, 8.95], [15.2, 17.95], [30.4, 33.15]],
  colR: 1.0, colD: 1.3, base: 9.5, capTop: 25.8, entTop: 28.6, corTop: 30.1, attic: 35.48, top: 36.1,
};
function front42(T, fr, half, deck, outD, curb = null) {
  const { LI, GR, ST, GD, DK, BZ, SC, CL, GL, GS, SH, LD } = T;
  const W = half;
  // ---- the wall from the roadway to the attic cap, the openings cut through it
  // the wall in panels with one opening each (one triangulation with every opening in it bridged two of them wrongly)
  const cuts = [-W, -17.0, -7.8, 7.8, 17.0, W];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const s0 = cuts[i], s1 = cuts[i + 1];
    const win = F42.wins.find((c) => c > s0 && c < s1), nar = F42.narrow.find((c) => c > s0 && c < s1);
    if (win !== undefined) frontPoly(LI, fr, rectLoop(s0, s1, deck, F42.attic), [archLoop(win - F42.winH, win + F42.winH, F42.sill, F42.spring, 18)], 0, 4.8);
    else if (nar !== undefined) {
      const yc = (F42.nY1 + F42.ocY - F42.ocR[1]) / 2;
      frontPoly(LI, fr, rectLoop(s0, s1, deck, yc), [rectLoop(nar - F42.nW, nar + F42.nW, F42.nY0, F42.nY1)], 0, 4.8);
      frontPoly(LI, fr, rectLoop(s0, s1, yc, F42.attic), [ovalLoop(nar, F42.ocY, F42.ocR[0], F42.ocR[1], 18)], 0, 4.8);
    } else frontPoly(LI, fr, rectLoop(s0, s1, deck, F42.attic), [], 0, 4.8);
  }
  // reveals and the glazing set back in them: the great windows' iron grids, the narrow windows, the oculi
  for (const c of F42.wins) {
    const loop = archLoop(c - F42.winH, c + F42.winH, F42.sill, F42.spring, 18);
    reveal(ST, fr, loop, 1.3);
    frontPoly(GD, fr, loop, [], -1.3, 2.64, 1, 3.75, c - F42.winH);
  }
  for (const c of F42.narrow) {
    const r1 = rectLoop(c - F42.nW, c + F42.nW, F42.nY0, F42.nY1), o1 = ovalLoop(c, F42.ocY, F42.ocR[0], F42.ocR[1], 18);
    reveal(ST, fr, r1, 0.8); frontPoly(GD, fr, r1, [], -0.8, 2.64, 1, 3.75, c - F42.nW);
    reveal(ST, fr, o1, 0.6); frontPoly(GD, fr, o1, [], -0.6, 1.32, 1, 1.25, c);
  }
  // the arches' archivolts (a moulded band round the extrados) and their keystones up to the architrave
  const ring = (c, yc, R, th, dep, a0 = 0, a1 = Math.PI, n = 16, acc = ST) => {
    for (let k = 0; k < n; k++) {
      const am = a0 + ((k + 0.5) / n) * (a1 - a0), len = R * ((a1 - a0) / n) * 1.06;
      const p = fr.P(c + R * Math.cos(am), 0, dep / 2);
      box(acc, p[0], yc + R * Math.sin(am) - th / 2, p[2], len, th, dep, Math.atan2(-fr.dv, fr.du), am + Math.PI / 2);
    }
  };
  for (const c of F42.wins) {
    ring(c, F42.spring, F42.winH + 0.38, 0.75, 0.32, 0, Math.PI, 18);
    for (const sg of [-1, 1]) { const p = fr.P(c + sg * (F42.winH + 0.38), 0, 0.16); box(ST, p[0], F42.sill - 0.2, p[2], 0.75, F42.spring - F42.sill + 0.2, 0.32); }
    const k = fr.P(c, 0, 0.35); box(ST, k[0], F42.spring + F42.winH - 0.1, k[2], 1.25, F42.capTop - (F42.spring + F42.winH - 0.1), 0.7);
    const sl = fr.P(c, 0, 0.3); box(ST, sl[0], F42.sill - 0.45, sl[2], 2 * F42.winH + 1.6, 0.45, 0.6);
  }
  for (const c of F42.narrow) {
    for (const sg of [-1, 1]) { const p = fr.P(c + sg * (F42.nW + 0.25), 0, 0.12); box(ST, p[0], F42.nY0, p[2], 0.5, F42.nY1 - F42.nY0, 0.24); }
    const t = fr.P(c, 0, 0.2); box(ST, t[0], F42.nY1, t[2], 2 * F42.nW + 1.2, 0.55, 0.4);
    const b = fr.P(c, 0, 0.25); box(ST, b[0], F42.nY0 - 0.35, b[2], 2 * F42.nW + 1.0, 0.35, 0.5);
    // the oculus's carved wreath: a garland of leaves round the oval, ribbons falling either side
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2, p = fr.P(c + (F42.ocR[0] + 0.35) * Math.cos(a), 0, 0.2);
      ell(SC, [p[0], F42.ocY + (F42.ocR[1] + 0.35) * Math.sin(a), p[2]], [0.42, 0.42, 0.28], 0, Math.atan2(-fr.dv, fr.du), a);
    }
    for (const sg of [-1, 1]) for (let k = 0; k < 3; k++) { const p = fr.P(c + sg * (1.0 + 0.25 * k), 0, 0.18); ell(SC, [p[0], F42.ocY - 1.9 - 0.7 * k, p[2]], [0.28, 0.42, 0.2]); }
  }
  // ---- the columns, their pedestals, the entablature's breaks over them, the attic's blocks over them
  const ry = Math.atan2(-fr.dv, fr.du);
  for (const [a, b] of F42.pairs) {
    const m = (a + b) / 2, w = b - a + 2.6;
    const pd = fr.P(m, 0, 1.3); box(ST, pd[0], deck, pd[2], w, F42.base - deck, 2.6, ry);
    const pm = fr.P(m, 0, 1.3); box(ST, pm[0], deck, pm[2], w + 0.3, 0.45, 2.9, ry); box(ST, pm[0], F42.base - 0.3, pm[2], w + 0.25, 0.3, 2.85, ry);
    for (const c of [a, b]) frontColumn(ST, fr, c, F42.colD, F42.base, F42.capTop, F42.colR);
    const en = fr.P(m, 0, 1.15); box(ST, en[0], F42.capTop, en[2], b - a + 2.3, F42.entTop - F42.capTop, 2.3, ry);
    const at = fr.P(m, 0, 0.18); box(ST, at[0], F42.corTop, at[2], b - a + 2.3, F42.attic - F42.corTop, 0.36, ry);
  }
  // pilasters at the corners of the end bays
  for (const sg of [-1, 1]) { const p = fr.P(sg * (W - 0.55), 0, 0.1); box(ST, p[0], deck, p[2], 1.1, F42.capTop - deck, 0.2, ry); }
  // the architrave and frieze bands in the wall's plane, the string at the windows' springing
  for (const [y0, h, d] of [[F42.capTop, 0.85, 0.12], [F42.capTop + 0.85, 0.12, 0.2], [F42.entTop - 0.18, 0.18, 0.16]]) {
    const p = fr.P(0, 0, d / 2); box(ST, p[0], y0, p[2], 2 * W, h, d, ry);
  }
  // ---- the attic: the middle panel under the clock, the cartouches over the narrow bays, the corner cartouches
  { const p = fr.P(0, 0, 0.16); box(ST, p[0], F42.corTop + 0.35, p[2], 15.6, F42.attic - F42.corTop - 0.7, 0.32, ry); }
  { // the inscription, cut in two lines in the middle panel
    const a = fr.P(-4.6, 0, 0.33), b = fr.P(4.6, 0, 0.33), y0 = F42.corTop + 1.1, y1 = F42.corTop + 3.9;
    T.IN.quad([a[0], y0, a[2]], [b[0], y0, b[2]], [b[0], y1, b[2]], [a[0], y1, a[2]], fr.N(0, 0, 1), [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  for (const c of F42.narrow) {
    const p = fr.P(c, 0, 0.35);
    ell(SC, [p[0], F42.corTop + 2.6, p[2]], [1.0, 1.35, 0.45], 0, ry, 0);
    for (const sg of [-1, 1]) for (let k = 0; k < 4; k++) { const q = fr.P(c + sg * (1.0 + 0.45 * k), 0, 0.25); ell(SC, [q[0], F42.corTop + 3.4 - 0.45 * k * k * 0.3 - 0.3 * k, q[2]], [0.38, 0.32, 0.25]); }
  }
  for (const sg of [-1, 1]) {
    const c = sg * (W - 4.35), p = fr.P(c, 0, 0.4), y0 = F42.attic;
    box(ST, p[0], y0, p[2], 5.8, 1.2, 1.3, ry);                                                        // the block it sits on
    const sh = fr.P(c, 0, 0.55); ell(SC, [sh[0], y0 + 2.9, sh[2]], [1.25, 1.7, 0.35], 0, ry, 0);      // the shield
    const rim = fr.P(c, 0, 0.45); ell(SC, [rim[0], y0 + 2.9, rim[2]], [1.55, 2.0, 0.28], 0, ry, 0);    // its frame
    for (const s2 of [-1, 1]) {                                                                        // the C-scrolls and their volutes
      for (let k = 0; k < 6; k++) { const a = -0.9 + k * 0.42, q = fr.P(c + s2 * (1.9 + 0.5 * Math.cos(a)), 0, 0.4); ell(SC, [q[0], y0 + 2.6 + 1.2 * Math.sin(a), q[2]], [0.34, 0.34, 0.3]); }
      const v = fr.P(c + s2 * 2.45, 0, 0.35); ell(SC, [v[0], y0 + 1.5, v[2]], [0.55, 0.55, 0.42]);
      for (let k = 0; k < 4; k++) { const q = fr.P(c + s2 * (0.6 + 0.55 * k), 0, 0.5); ell(SC, [q[0], y0 + 1.5 - 0.15 * k, q[2]], [0.36, 0.3, 0.28]); }   // the garland
    }
    const cr = fr.P(c, 0, 0.45); ell(SC, [cr[0], y0 + 4.95, cr[2]], [0.85, 0.5, 0.45]); ell(SC, [cr[0], y0 + 5.5, cr[2]], [0.4, 0.4, 0.35]);   // the crest
  }
  // ---- the clock (13 ft, 4 m across) in its stone frame, and the group over it
  {
    const cy = 39.1, p = fr.P(0, 0, 0.55), q = fr.P(0, 0, 0.75);
    const disc = (acc, P, r, th) => { const g = new THREE.CylinderGeometry(r, r, th, 36); const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(fr.nu, 0, fr.nv)); acc.addGeo(g, new THREE.Matrix4().compose(new THREE.Vector3(P[0], cy, P[2]), qq, new THREE.Vector3(1, 1, 1))); g.dispose(); };
    disc(ST, fr.P(0, 0, 0.2), 2.85, 1.2);
    disc(GL, p, 2.25, 0.5);
    disc(CL, q, 2.0, 0.2);
    for (let k = 0; k < 12; k++) {   // the numerals' marks and the hands
      const a = (k / 12) * Math.PI * 2, m = fr.P(1.65 * Math.cos(a), 0, 0.87);
      box(DK, m[0], cy + 1.65 * Math.sin(a) - 0.18, m[2], 0.16, 0.36, 0.04, ry, a);
    }
    const h = fr.P(0.3, 0, 0.9); box(DK, h[0], cy - 0.05, h[2], 0.12, 1.4, 0.04, ry, -0.9);
    const h2 = fr.P(-0.2, 0, 0.9); box(DK, h2[0], cy - 0.05, h2[2], 0.14, 1.0, 0.04, ry, 0.5);
    for (let k = 0; k < 9; k++) {    // the frame's crest rising to the eagle
      const t = k / 8, p2 = fr.P(0, 0, 0.1);
      box(ST, p2[0], cy + 2.4 + t * 0.9, p2[2], 5.2 - 4.4 * t, 0.12, 1.6, ry);
    }
  }
  sculptureGroup(SC, fr, F42.top);
  // ---- the ground floor under the roadway: granite to the deck, shops along the street, the entrance under the viaduct
  const oD = outD;
  frontPoly(GR, fr, [[-W, 0], [W, 0], [W, deck], [-W, deck]], [], 0, 4.8);
  // the outer face: the entrance arch in the middle, shop bays either side
  frontPoly(GR, fr, [[-W, 0], [W, 0], [W, 6.35], [-W, 6.35]], [archLoop(-4.0, 4.0, 0, 2.2, 14)], oD, 4.8);
  reveal(GR, fr.shift(oD), archLoop(-4.0, 4.0, 0, 2.2, 14), 2.0);
  frontPoly(SH, fr, archLoop(-4.0, 4.0, 0, 2.2, 14), [], oD - 2.0, 4.0, 1, 7.0, -4.0);
  for (const sg of [-1, 1]) {   // the ends of the block
    const p0 = fr.P(sg * W, 0, 0), p1 = fr.P(sg * W, 0, oD);
    GR.quad([p0[0], 0, p0[2]], [p1[0], 0, p1[2]], [p1[0], 6.35, p1[2]], [p0[0], 6.35, p0[2]], fr.N(sg, 0, 0));
  }
  // shop fronts: display windows between granite piers, a sign band over them (a painted bay set into the face)
  for (let s0 = -W + 1.5; s0 + 5.6 <= W - 1.5; s0 += 6.3) {
    if (s0 + 5.6 > -5.0 && s0 < 5.0) continue;
    frontPoly(SH, fr, [[s0, 0.35], [s0 + 5.0, 0.35], [s0 + 5.0, 5.2], [s0, 5.2]], [], oD + 0.04, 5.0, 1, 7.0, s0);
  }
  // the terrace: the paving between the wall and the roadway's inner curb (`curb`: [s, inner d, outer d] across the front,
  // else 4.4 m out), the floor under the deck kept below the road's girders
  const cb = curb && curb.length >= 2 ? curb : [[-W, 4.4], [W, 4.4]];
  const lerp = (j) => (s) => {
    if (s <= cb[0][0]) return cb[0][j];
    for (let k = 0; k + 1 < cb.length; k++) if (s <= cb[k + 1][0]) return cb[k][j] + ((cb[k + 1][j] - cb[k][j]) * (s - cb[k][0])) / ((cb[k + 1][0] - cb[k][0]) || 1);
    return cb[cb.length - 1][j];
  };
  const cAt = lerp(1), oAt = cb[0].length > 2 ? lerp(2) : () => oD;
  const ss = [-W, ...cb.map((q) => q[0]).filter((v) => v > -W && v < W), W];
  for (let k = 0; k + 1 < ss.length; k++) {
    const s0 = ss[k], s1 = ss[k + 1], c0 = cAt(s0), c1 = cAt(s1);
    const a = fr.P(s0, 0, 0), b = fr.P(s1, 0, 0), c = fr.P(s1, 0, c1), d = fr.P(s0, 0, c0);
    ST.quad([a[0], deck - 0.04, a[2]], [b[0], deck - 0.04, b[2]], [c[0], deck - 0.04, c[2]], [d[0], deck - 0.04, d[2]], [0, 1, 0]);
    const g = fr.P(s1, 0, oD), h = fr.P(s0, 0, oD);
    GR.quad([d[0], 4.9, d[2]], [c[0], 4.9, c[2]], [g[0], 4.9, g[2]], [h[0], 4.9, h[2]], [0, 1, 0]);
    GR.quad([d[0], 4.9, d[2]], [c[0], 4.9, c[2]], [c[0], deck - 0.04, c[2]], [d[0], deck - 0.04, d[2]], fr.N(0, 0, 1));
    // (the walk outside the roadway's parapet, out to the block's face)
    const o0 = oAt(s0) + 0.35, o1 = oAt(s1) + 0.35;
    if (o0 < oD - 0.05 || o1 < oD - 0.05) {
      const e = fr.P(s0, 0, Math.min(o0, oD)), f = fr.P(s1, 0, Math.min(o1, oD));
      ST.quad([e[0], deck - 0.04, e[2]], [f[0], deck - 0.04, f[2]], [g[0], deck - 0.04, g[2]], [h[0], deck - 0.04, h[2]], [0, 1, 0]);
    }
  }
  // the cornice of the ground floor and the balustrade on the roadway's outer edge (open where the viaduct comes in)
  for (const [s0, s1] of [[-W, -5.4], [5.4, W]]) {
    sweepOpen(ST, [fr.xz(s0, oD), fr.xz(s1, oD)], 5.75, [[-0.3, 0], [0.12, 0], [0.12, 0.25], [0.3, 0.35], [0.3, 0.6], [-0.3, 0.6]], 1, true);
    balustradeOpen(ST, [fr.xz(s0 + 0.3, oD - 0.25), fr.xz(s1 - 0.3, oD - 0.25)], 6.35, 1, 6.3);
  }
  // the lamps on the balustrade
  for (const sv of [-36, -18, 18, 36]) { const p = fr.P(sv, 0, oD - 0.25); lampStandard(BZ, GS, p[0], 7.45, p[2], ry); }
}

/* ------------------------------------------------------- the side fronts */
// The Vanderbilt Avenue and east fronts carry the same order: the concourse's three end windows in the middle (arched,
// 8.4 m wide, centred on the hall), a single fluted column between them and at either side, the end pavilions with a tall
// window under the segmental hood over the attic (the city model's arched parapets), plain ashlar between; the roadway
// along the front on granite piers with its stone fascia and balustrade.
function sideFront(T, fr, len, wins, pav, deck) {
  const { LI, ST, GD, SC } = T;
  const ry = Math.atan2(-fr.dv, fr.du);
  const sill = F42.sill, spring = F42.spring, wh = F42.winH;
  // the wall in panels round each opening
  const feats = [...wins.map((c) => ({ c, k: 'w', h: wh + 0.3 })), ...pav.map((c) => ({ c, k: 'p', h: 1.9 }))].sort((a, b) => a.c - b.c);
  let s0 = 0;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i], s1 = i + 1 < feats.length ? (f.c + feats[i + 1].c) / 2 : len;
    const hole = f.k === 'w' ? archLoop(f.c - wh, f.c + wh, sill, spring, 18) : rectLoop(f.c - 1.6, f.c + 1.6, 9.8, 21.4);
    frontPoly(LI, fr, rectLoop(s0, s1, deck, F42.attic), [hole], 0, 4.8);
    reveal(ST, fr, hole, f.k === 'w' ? 1.3 : 0.8);
    frontPoly(GD, fr, hole, [], f.k === 'w' ? -1.3 : -0.8, 2.64, 1, 3.75, f.c - (f.k === 'w' ? wh : 1.6));
    s0 = s1;
  }
  for (const c of wins) {
    for (let k = 0; k < 18; k++) {
      const am = ((k + 0.5) / 18) * Math.PI, p = fr.P(c + (wh + 0.38) * Math.cos(am), 0, 0.16);
      box(ST, p[0], spring + (wh + 0.38) * Math.sin(am) - 0.375, p[2], (wh + 0.38) * (Math.PI / 18) * 1.06, 0.75, 0.32, ry, am + Math.PI / 2);
    }
    const k = fr.P(c, 0, 0.35); box(ST, k[0], spring + wh - 0.1, k[2], 1.25, F42.capTop - (spring + wh - 0.1), 0.7, ry);
    const sl = fr.P(c, 0, 0.3); box(ST, sl[0], sill - 0.45, sl[2], 2 * wh + 1.6, 0.45, 0.6, ry);
  }
  // the columns between and beside the windows, on their pedestals
  const cols = [];
  for (let i = 0; i < wins.length; i++) { cols.push(wins[i] - 6.15); }
  cols.push(wins[wins.length - 1] + 6.15);
  for (const c of cols) {
    const pd = fr.P(c, 0, 1.3); box(ST, pd[0], deck - 1.0, pd[2], 2.6, F42.base - deck + 1.0, 2.6, ry);   // (down past the deck: the side roadway runs up to 1 m under it)
    box(ST, pd[0], F42.base - 0.3, pd[2], 2.85, 0.3, 2.85, ry);
    frontColumn(ST, fr, c, F42.colD, F42.base, F42.capTop, F42.colR);
    const en = fr.P(c, 0, 1.15); box(ST, en[0], F42.capTop, en[2], 2.4, F42.entTop - F42.capTop, 2.3, ry);
  }
  // the pavilions' windows: a moulded surround, a cornice on consoles, the segmental hood over the attic
  for (const c of pav) {
    for (const sg of [-1, 1]) { const q = fr.P(c + sg * 1.85, 0, 0.14); box(ST, q[0], 9.6, q[2], 0.5, 12.0, 0.28, ry); }
    const t = fr.P(c, 0, 0.3); box(ST, t[0], 21.4, t[2], 4.6, 0.7, 0.6, ry);
    const b = fr.P(c, 0, 0.25); box(ST, b[0], 9.25, b[2], 4.2, 0.4, 0.5, ry);
    for (let k = 0; k < 12; k++) {
      const am = ((k + 0.5) / 12) * Math.PI, R = 5.3, p = fr.P(c + R * Math.cos(am), 0, 0.2);
      box(ST, p[0], F42.top - 0.6 + 0.47 * R * Math.sin(am) - 0.3, p[2], R * (Math.PI / 12) * 1.08, 0.6, 0.9, ry, Math.atan2(0.47 * Math.cos(am), -Math.sin(am)) + Math.PI);
    }
    const cart = fr.P(c, 0, 0.45); ell(SC, [cart[0], F42.top + 1.0, cart[2]], [1.1, 1.3, 0.4], 0, ry, 0);
  }
  // the architrave band over the whole front
  const pa = fr.P(len / 2, 0, 0.06); box(ST, pa[0], F42.capTop, pa[2], len, 0.85, 0.12, ry);
}
// the roadway's outer edge along a side: granite piers carrying the steel girder, the stone fascia with its dentil cornice,
// the balustrade over it. K: knots [s, d, deck] along the front (the edge's offset and the deck's height, linear between
// them); each span between knots is built level and then sheared to its two decks
function roadSkin(T, fr, K, step = 11.5) {
  const { GR, ST, BZ, GS } = T;
  const ry = Math.atan2(-fr.dv, fr.du), s0 = K[0][0], s1 = K[K.length - 1][0];
  const at = (s) => {
    let k = 0;
    while (k + 2 < K.length && s > K[k + 1][0]) k++;
    const [sa, da, ya] = K[k], [sb, db, yb] = K[k + 1], f = Math.min(1, Math.max(0, (s - sa) / ((sb - sa) || 1)));
    return [da + (db - da) * f, ya + (yb - ya) * f];
  };
  const n = Math.max(1, Math.round((s1 - s0) / step));
  for (let k = 0; k <= n; k++) {
    const s = s0 + ((s1 - s0) * k) / n, [d, deck] = at(s), p = fr.P(s, 0, d - 0.6);
    box(GR, p[0], 0, p[2], 2.6, deck - 1.75, 1.7, ry);
    box(GR, p[0], deck - 1.95, p[2], 2.9, 0.2, 1.9, ry);
    if (k % 2 === 1) { const q = fr.P(s, 0, d + 0.4); lampStandard(BZ, GS, q[0], deck + 1.12, q[2], ry); }
  }
  // the girder's web between the piers (dark green steel), the stone fascia and cornice over it, the balustrade
  const o = fr.P(0, 0, 0), sOf = (x, z) => (x - o[0]) * fr.du + (z - o[2]) * fr.dv;
  for (let k = 0; k + 1 < K.length; k++) {
    const [sa, da, ya] = K[k], [sb, db, yb] = K[k + 1];
    const a = fr.P(sa, 0, da), b = fr.P(sb, 0, db), n2 = fr.N(0, 0, 1);
    BZ.quad([a[0], ya - 1.75, a[2]], [b[0], yb - 1.75, b[2]], [b[0], yb - 0.9, b[2]], [a[0], ya - 0.9, a[2]], n2);
    const i0 = ST.p.length;
    sweepOpen(ST, [fr.xz(sa, da), fr.xz(sb, db)], ya - 0.95, [[-0.4, 0], [0.08, 0], [0.08, 0.5], [0.22, 0.58], [0.22, 0.78], [0.34, 0.86], [0.34, 1.0], [-0.4, 1.0]], 1, k === 0 || k + 2 === K.length);
    const ba = k === 0 ? sa + 0.3 : sa, bb = k + 2 === K.length ? sb - 0.3 : sb, dA = da + ((db - da) * (ba - sa)) / ((sb - sa) || 1), dB = da + ((db - da) * (bb - sa)) / ((sb - sa) || 1);
    balustradeOpen(ST, [fr.xz(ba, dA - 0.25), fr.xz(bb, dB - 0.25)], ya + 0.05, 1, step / 2);
    if (Math.abs(yb - ya) > 1e-3) for (let i = i0; i < ST.p.length; i += 3) ST.p[i + 1] += ((yb - ya) * Math.min(1, Math.max(0, (sOf(ST.p[i], ST.p[i + 2]) - sa) / ((sb - sa) || 1))));
  }
}

/* --------------------------------------------------- Grand Central Terminal */
// the model frame of the city model (its ground ring's extents)
const GCT_REF = [-50.3, 41.0, -49.2, 37.8];
const GCT_OUTER = [[-50.3, -49.2], [41.0, -49.2], [41.0, 17.5], [38.6, 17.5], [38.6, 37.8], [-47.1, 37.8], [-47.1, 17.7], [-50.3, 17.7]];
// The viaduct round the terminal as city/hhp.js draws it (its paving through globalThis.__hhpPave, world metres): the 42nd
// Street roadway's height over the terminal's ground (the building moves up or down so the fronts' deck, drawn 6.74 m up,
// meets it), the roadway's inner curb and outer edge across the front, the side roadways' outer edges and the deck's height
// along them (roadSkin's knots, 0.65 m outside the paving: its 0.35 m concrete parapet and 0.3 m). Without the paving (no
// highway data) the compiled road records' positions.
function gctRoads(ctx, FM, UC) {
  const D0 = 6.74;
  const out = { shift: 0, outD: 11.85, curb: null, east: [[0.5, 8.6, D0], [66.2, 8.17, D0]], west: [[0.5, 12.95, D0], [66.4, 12.95, D0]] };
  const pave = typeof globalThis !== 'undefined' ? globalThis.__hhpPave : null;
  if (typeof pave !== 'function' || !Number.isFinite(ctx.cx) || !Number.isFinite(ctx.cz) || !Number.isFinite(ctx.groundY)) return out;
  const F = FM.F;
  const at = (u, v) => { const p = FM.xz(u, v); try { return pave(ctx.cx + p[0], ctx.cz + p[1], ctx.groundY + 5.5); } catch { return null; } };
  const M = (q) => {
    const a = q[0] - ctx.cx, b = q[2] - ctx.cz, mu = a * F.U[0] + b * F.U[1], mv = a * F.V[0] + b * F.V[1];
    return [GCT_REF[0] + (mu - F.u0) / FM.su, GCT_REF[2] + (mv - F.v0) / FM.sv, q[1] - ctx.groundY];
  };
  // the front: across the roadway every 8 m along it
  const ys = [], curb = [], outer = [];
  for (let s = -40; s <= 40; s += 8) {
    let hit = null;
    for (let d = 3; d <= 18 && !hit; d += 0.5) hit = at(UC + s, 37.8 + d);
    if (!hit) continue;
    const a = M(hit.l), b = M(hit.r);
    ys.push(hit.y - ctx.groundY);
    curb.push([s, Math.min(a[1], b[1]) - 37.8, Math.max(a[1], b[1]) - 37.8]); outer.push(Math.max(a[1], b[1]) - 37.8);
  }
  if (ys.length < 5) return out;
  ys.sort((p, q) => p - q);
  out.shift = ys[ys.length >> 1] - D0;
  out.outD = Math.max(...outer) + 0.65;
  out.curb = curb;
  // the sides: seven knots along each, the outer edge (the one farther from the wall) and its height
  const side = (u0, v0, du, dv, sA, sB) => {
    const K = [];
    for (let k = 0; k <= 6; k++) {
      const s = sA + ((sB - sA) * k) / 6;
      let hit = null;
      for (let d = 1; d <= 20 && !hit; d += 0.5) hit = at(u0 + du * s - dv * d, v0 + dv * s + du * d);
      if (!hit) continue;
      const a = M(hit.l), b = M(hit.r);
      const da = (a[0] - u0) * -dv + (a[1] - v0) * du, db = (b[0] - u0) * -dv + (b[1] - v0) * du;
      const e = da > db ? a : b;
      K.push([s, Math.max(da, db) + 0.65, e[2] - out.shift]);
    }
    return K.length >= 2 && K[0][0] < sA + 12 && K[K.length - 1][0] > sB - 12 ? K : null;
  };
  out.east = side(41.0, 17.5, 0, -1, 0.5, 66.2) || out.east;
  out.west = side(-50.3, -49.2, 0, 1, 0.5, 66.4) || out.west;
  return out;
}
export function buildGrandCentral(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const FM = frameMap(ring, GCT_REF);
  if (!FM.ok) return null;
  const R = classifyRoofs(parsePolys(GCT_ROOFS));
  const M = gctMats(R);
  const g = new THREE.Group();
  const RF = new Acc(), LI = new Acc(), GR = new Acc(), ST = new Acc(), LD = new Acc(), DK = new Acc(), FN = new Acc(), BZ = new Acc(), GD = new Acc();
  // ---- the roof surfaces, triangulated in plan, sampling the atlas in plan
  for (const q of R) {
    if (q.k === 'skip') continue;
    const pts = q.P.map(([u, v]) => new THREE.Vector2(u, v));
    let T;
    try { T = THREE.ShapeUtils.triangulateShape(pts, []); } catch { continue; }
    const { a, b } = q.pl;
    const nl = Math.hypot(a, b, 1), nrm = [-a / nl, 1 / nl, -b / nl];
    for (const [i, j, k] of T) {
      const A = q.P[i], B = q.P[j], C = q.P[k];
      const pa = [A[0], A[2], A[1]], pb = [B[0], B[2], B[1]], pc = [C[0], C[2], C[1]];
      const cr = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      const ua = [atU(A[0]), atV(A[1])], ub = [atU(B[0]), atV(B[1])], uc = [atU(C[0]), atV(C[1])];
      if (cr >= 0) RF.tri(pa, pb, pc, nrm, ua, ub, uc); else RF.tri(pa, pc, pb, nrm, ua, uc, ub);
    }
  }
  // ---- the walls under the roof steps
  stepWalls(R, GCT_OUTER, (p0, p1, hb, n, q, s0) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const crest = q.k === 'crest';
    const acc = crest ? LD : LI;
    const uvS = 1 / 4.8;
    acc.quad([p0[0], hb, p0[1]], [p1[0], hb, p1[1]], [p1[0], p1[2], p1[1]], [p0[0], p0[2], p0[1]], [n[0], 0, n[1]],
      [s0 * uvS, hb * uvS], [(s0 + L) * uvS, hb * uvS], [(s0 + L) * uvS, p1[2] * uvS], [s0 * uvS, p0[2] * uvS]);
  });
  // ---- the outer walls: the sides plain for now (granite to the roadway, limestone to the attic cap); the 42nd Street
  // front is front42's; on the north the corner blocks rise to the cornice and the court between them stays open to the
  // MetLife Building's base, which stands against it
  const DECK = 6.74, UC = -4.25;
  wallRing(GR, GCT_OUTER, 0, DECK, M.tx.granT, { bayW: 4.8, floorH: 4.8, vRef: 0, skip: (i) => i === 0 || i === 4 });
  wallRing(LI, GCT_OUTER, DECK, F42.attic, M.tx.limeT, { bayW: 4.8, floorH: 4.8, vRef: 0, skip: (i) => i === 0 || i === 4 || i === 1 || i === 7 });
  for (const [u0, u1, y1] of [[-50.3, -34.2, F42.attic], [-34.2, 24.8, 18.5], [24.8, 41.0, F42.attic]]) {
    LI.quad([u0, 0, -49.2], [u1, 0, -49.2], [u1, y1, -49.2], [u0, y1, -49.2], [0, 0, -1], [u0 / 4.8, 0], [u1 / 4.8, 0], [u1 / 4.8, y1 / 4.8], [u0 / 4.8, y1 / 4.8]);
  }
  // the cornice round the three fronts, breaking forward over the 42nd Street column pairs; the attic cap; the string
  const jogs = [];
  for (const [a, b] of F42.pairs.slice().reverse()) jogs.push([UC + b + 1.15, 37.8], [UC + b + 1.15, 40.1], [UC + a - 1.15, 40.1], [UC + a - 1.15, 37.8]);
  const sideE = [[41.0, -49.2], [41.0, 17.5], [38.6, 17.5], [38.6, 37.8]], sideW = [[-47.1, 37.8], [-47.1, 17.7], [-50.3, 17.7], [-50.3, -49.2]];
  sweepOpen(ST, [...sideE, ...jogs, ...sideW], F42.entTop, PROF.cornice, -1, true);
  sweepOpen(ST, [...sideE, ...sideW], F42.attic, PROF.atticCap.map(([d, h]) => [d + 0.1, h]), -1, true);
  sweepOpen(ST, [[41.0, -49.2], [41.0, 17.5], [38.6, 17.5], [38.6, 37.6]], DECK - 0.4, PROF.string, -1, true);
  sweepOpen(ST, [[-47.1, 37.6], [-47.1, 17.7], [-50.3, 17.7], [-50.3, -49.2]], DECK - 0.4, PROF.string, -1, true);
  // ---- the 42nd Street front
  const SC = new Acc(), CL = new Acc(), GL = new Acc(), GS = new Acc(), SH = new Acc(), IN = new Acc();
  const fr = frontFrame(UC, 37.8, 1, 0);
  const T = { LI, GR, ST, GD, DK, BZ, SC, CL, GL, GS, SH, LD, IN };
  const RD = gctRoads(ctx, FM, UC);
  front42(T, fr, 42.85, DECK, RD.outD, RD.curb);   // the front block's outer face 0.3 m past the front roadway's parapet
  // ---- the side fronts (the concourse windows centred on the hall at v -15.95) and their roadways
  const frE = frontFrame(41.0, 17.5, 0, -1), frW = frontFrame(-50.3, -49.2, 0, 1);
  sideFront(T, frE, 66.7, [21.15, 33.45, 45.75], [6.9, 60.25], DECK);
  sideFront(T, frW, 66.9, [20.95, 33.25, 45.55], [6.45, 59.8], DECK);
  // the roadway skins on the side roadways' outer edges, at their deck (gctRoads)
  roadSkin(T, frE, RD.east);
  roadSkin(T, frW, RD.west);
  // ---- the waiting room's fans: four big white housings on the black roof
  for (const u of [-22.7, -11.4, 1.5, 14.3]) {
    box(FN, u, 36.3, 20.6, 5.2, 1.5, 5.2);
    cyl(DK, u, 37.8, 20.6, 2.1, 2.1, 0.06, 20);
    for (let k = 0; k < 4; k++) box(FN, u, 37.86, 20.6, 4.0, 0.08, 0.35, (k * Math.PI) / 4);
  }
  const all = [[RF, M.roof, 'lm64:gct:roof'], [LI, M.lime, 'lm64:gct:walls'], [GR, M.gran, 'lm64:gct:base'], [ST, M.stone, 'lm64:gct:stone'],
    [LD, M.lead, 'lm64:gct:lead'], [DK, M.dark, 'lm64:gct:dark'], [FN, M.fan, 'lm64:gct:fans'],
    [BZ, M.bronze, 'lm64:gct:bronze'], [GD, M.grid, 'lm64:gct:windows'], [SC, M.statue, 'lm64:gct:sculpture'], [CL, M.clock, 'lm64:gct:clock'],
    [GL, M.gilt, 'lm64:gct:gilt'], [GS, M.lamp, 'lm64:gct:lamps'], [SH, M.shops, 'lm64:gct:shops'], [IN, M.inscription, 'lm64:gct:inscription']];
  for (const [acc] of all) {
    FM.apply(acc);
    if (RD.shift) for (let i = 1; i < acc.p.length; i += 3) acc.p[i] += RD.shift;
  }
  addMeshes(g, all);
  g.userData.colliderBoxes = [{ x: FM.centre[0], y: 18 + RD.shift, z: FM.centre[1], w: FM.F.u1 - FM.F.u0, h: 36, d: FM.F.v1 - FM.F.v0, rotY: FM.rot }];
  g.userData.viaduct = RD;
  g.userData.tris = triCount(all);
  return g;
}

/* ------------------------------------------------------- the MetLife Building */
// Emery Roth and Sons with Gropius and Belluschi, 1963. Massing from the city model (BIN 1085630): the nine-storey base on
// the whole lot to 36.5 m, two raised parts against the tower's broad faces (43.9 and 44.1 m), the tower an elongated
// octagon 90.7 by 42.5 m (each broad face a flat middle and two wings folded back 14 degrees, the ends flush with the base's
// sides) to its roof at 241.7 m, the cooling towers sunk in a well in the roof's west half (227.8 m). The precast grid: a
// mullion every 1.52 m, a floor every 3.73 m; the louvred mechanical floors at 86.5 m and 184 m and the crown of louvres
// from 222 m with the name on the broad faces; the base a deep precast waffle over a glazed ground floor behind travertine
// piers; the tower's lowest floors a dark recessed band over the base's roof.
const ML_REF = [-44.7, 46.0, -50.6, 62.7];
const ML_BASE = [[-44.7, -50.6], [46.0, -50.6], [46.0, 46.1], [40.0, 46.1], [40.0, 62.7], [-38.8, 62.7], [-38.8, 46.1], [-44.7, 46.1]];
const ML_OCT = [[-18.1, -4.4], [19.3, -4.4], [45.9, 2.2], [46.0, 31.0], [19.4, 38.1], [-18.7, 38.1], [-44.7, 31.5], [-44.7, 1.8]];
const ML_WELL = [[-18.0, -0.6], [-7.0, -0.6], [-7.0, 33.9], [-18.2, 33.9], [-42.9, 27.3], [-43.0, 6.2]];
const ML_PODN = [[-38.6, -37.4], [38.6, -37.5], [38.7, 0.4], [19.3, -4.4], [-18.1, -4.4], [-38.5, 0.3]];
const ML_PODS = [[-18.7, 38.1], [19.4, 38.1], [38.7, 32.9], [38.8, 39.7], [32.4, 39.7], [32.4, 45.3], [-31.3, 45.4], [-31.4, 39.0], [-38.4, 39.0], [-38.4, 33.1]];
const ML_H = { base: 36.5, podN: 43.9, podS: 44.1, t0: 44.0, top: 241.7, well: 227.75, bands: [[86.5, 91.0], [184.0, 188.5]], crown: 222.0, floor: 3.73, bay: 1.52 };
// the tower's grid: 4 bays x 4 floors per tile (rows from the top); precast mullions with a lit and a shaded side,
// the spandrel, the window with its sky reflection
function mlTowerPaint(g, gb, w, h, r) {
  const bw = w / 4, fh = h / 4;
  g.fillStyle = 'rgb(214,212,206)'; g.fillRect(0, 0, w, h);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = i * bw, y = j * fh, wx = x + bw * 0.2, ww = bw * 0.6, wy = y + fh * 0.1, wh = fh * 0.56;
    const gl = g.createLinearGradient(0, wy, 0, wy + wh), k = 0.9 + r() * 0.2;
    gl.addColorStop(0, rgbs([118, 132, 146], k)); gl.addColorStop(0.55, rgbs([82, 94, 106], k)); gl.addColorStop(1, rgbs([64, 72, 80], k));
    g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
    if (r() < 0.18) { g.fillStyle = 'rgba(232,226,206,0.5)'; g.fillRect(wx, wy + wh * (0.2 + r() * 0.4), ww, wh * 0.45); }   // blinds
    gb.fillStyle = 'rgb(80,80,80)'; gb.fillRect(wx, wy, ww, wh);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(wx, wy, ww * 0.12, wh);
    g.fillStyle = 'rgb(222,220,214)'; g.fillRect(x, y, bw * 0.12, fh);                                  // the mullion's lit side
    g.fillStyle = 'rgb(176,174,168)'; g.fillRect(x + bw * 0.12, y, bw * 0.06, fh);                      // and its shaded side
    gb.fillStyle = 'rgb(230,230,230)'; gb.fillRect(x, y, bw * 0.18, fh);
    g.fillStyle = 'rgba(60,56,50,0.10)'; g.fillRect(x, wy + wh, bw, fh * 0.04);                         // the sill's stain
  }
  streaks(g, 0, 0, w, h, r, 10, 0.05);
}
// a louvred mechanical floor: the mullions run through, dark louvre blades between them
function mlLouvrePaint(g, gb, w, h, r) {
  const bw = w / 4;
  g.fillStyle = 'rgb(58,62,64)'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 5) { g.fillStyle = 'rgba(150,154,156,0.35)'; g.fillRect(0, y, w, 1.5); gb.fillStyle = 'rgb(200,200,200)'; gb.fillRect(0, y, w, 2); }
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgb(214,212,206)'; g.fillRect(i * bw, 0, bw * 0.18, h); gb.fillStyle = 'rgb(235,235,235)'; gb.fillRect(i * bw, 0, bw * 0.18, h); }
}
// the crown: the mullions run up through vertical louvres of a mid grey (it reads nearly as light as
// the grid below it)
function mlCrownPaint(g, gb, w, h, r) {
  const bw = w / 4;
  g.fillStyle = 'rgb(132,134,134)'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 4) { g.fillStyle = 'rgba(70,72,74,0.5)'; g.fillRect(x, 0, 1.5, h); gb.fillStyle = 'rgb(90,90,90)'; gb.fillRect(x, 0, 1.5, h); }
  for (let i = 0; i < 4; i++) { g.fillStyle = 'rgb(214,212,206)'; g.fillRect(i * bw, 0, bw * 0.18, h); gb.fillStyle = 'rgb(235,235,235)'; gb.fillRect(i * bw, 0, bw * 0.18, h); }
  streaks(g, 0, 0, w, h, r, 8, 0.05);
}
// the name in the crown: the same louvres, the letters over them
function mlSignPaint(g, gb, w, h, r) {
  // the louvres at the facade's own spacing: 32 m of crown, a mullion every 1.52 m
  const nb = 32 / 1.52, bw = w / nb;
  g.fillStyle = 'rgb(132,134,134)'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += bw / 16) { g.fillStyle = 'rgba(70,72,74,0.5)'; g.fillRect(x, 0, 1.5, h); gb.fillStyle = 'rgb(90,90,90)'; gb.fillRect(x, 0, 1.5, h); }
  for (let i = 0; i < nb; i++) { g.fillStyle = 'rgb(214,212,206)'; g.fillRect(i * bw, 0, bw * 0.18, h); gb.fillStyle = 'rgb(235,235,235)'; gb.fillRect(i * bw, 0, bw * 0.18, h); }
  g.fillStyle = 'rgb(246,246,242)'; g.font = `bold ${Math.round(h * 0.74)}px Helvetica, Arial, sans-serif`; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.fillText('MetLife', w / 2, h * 0.53);
  gb.fillStyle = 'rgb(200,200,200)'; gb.font = g.font; gb.textBaseline = 'middle'; gb.textAlign = 'center'; gb.fillText('MetLife', w / 2, h * 0.53);
}
// the base's precast waffle: deep square openings, 4 x 4 per tile
function mlWafflePaint(g, gb, w, h, r) {
  const cw = w / 4, ch = h / 4;
  g.fillStyle = 'rgb(188,184,176)'; g.fillRect(0, 0, w, h);
  speckle(g, 0, 0, w, h, r, 300, 0.05);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const x = i * cw + cw * 0.16, y = j * ch + ch * 0.14, ww = cw * 0.68, hh = ch * 0.62;
    g.fillStyle = 'rgb(120,116,110)'; g.fillRect(x - 3, y - 3, ww + 6, hh + 6);                          // the deep reveal
    const k = 0.85 + r() * 0.3;
    g.fillStyle = rgbs([58, 66, 74], k); g.fillRect(x + 4, y + 4, ww - 8, hh - 8);
    gb.fillStyle = 'rgb(40,40,40)'; gb.fillRect(x - 3, y - 3, ww + 6, hh + 6);
  }
  streaks(g, 0, 0, w, h, r, 14, 0.06);
}
// the ground floor: travertine piers 6.1 m apart before the dark glazing of the lobby and the shops
function mlPilotiPaint(g, gb, w, h, r) {
  g.fillStyle = 'rgb(46,52,56)'; g.fillRect(0, 0, w, h);
  const gl = g.createLinearGradient(0, 0, 0, h); gl.addColorStop(0, 'rgba(120,130,138,0.5)'); gl.addColorStop(1, 'rgba(160,140,110,0.35)');
  g.fillStyle = gl; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgb(214,204,184)'; g.fillRect(0, 0, w * 0.22, h);
  speckle(g, 0, 0, w * 0.22, h, r, 60, 0.08);
  gb.fillStyle = 'rgb(230,230,230)'; gb.fillRect(0, 0, w * 0.22, h);
  g.fillStyle = 'rgb(176,170,160)'; g.fillRect(0, 0, w, h * 0.06);
}
let _ML = null;
function mlMats() {
  if (_ML) return _ML;
  const tower = tile('ml-tower', 256, 512, mlTowerPaint, 81, 4, 4), louvre = tile('ml-louvre', 256, 128, mlLouvrePaint, 82, 4, 1);
  const waffle = tile('ml-waffle', 256, 256, mlWafflePaint, 83, 4, 4), piloti = tile('ml-piloti', 128, 256, mlPilotiPaint, 84, 1, 1);
  const crown = tile('ml-crown', 256, 256, mlCrownPaint, 85, 4, 1), sign = tile('ml-sign', 1024, 256, mlSignPaint, 86);
  _ML = {
    tx: { tower, louvre, waffle, piloti, crown },
    crown: facadeMat('ml-crown', crown, { rough: 0.6, metal: 0.15, bump: 1.2 }),
    tower: facadeMat('ml-tower', tower, { rough: 0.55, metal: 0.12, bump: 1.4 }),
    louvre: facadeMat('ml-louvre', louvre, { rough: 0.6, metal: 0.2, bump: 1.2 }),
    waffle: facadeMat('ml-waffle', waffle, { rough: 0.8, bump: 2.2 }),
    piloti: facadeMat('ml-piloti', piloti, { rough: 0.4, metal: 0.2, bump: 1.0 }),
    sign: facadeMat('ml-sign', sign, { rough: 0.6, metal: 0.15, bump: 0.8 }),
    roof: mat(0xdfe0dd, { rough: 0.85, flat: false }),
    deck: mat(0x9a9894, { rough: 0.9, flat: false }),
    coping: mat(0xd6d4ce, { rough: 0.7, flat: false }),
    plant: mat(0x8e9294, { rough: 0.6, metal: 0.3, flat: false }),
    dark: mat(0x22272b, { rough: 0.6, flat: false }),
    logo: mat(0x2a7fbf, { rough: 0.5, flat: false }),
  };
  return _ML;
}
// walls of a ring between y0 and y1 with a tile of nx bays (bay m) and ny floors (floor m), v counted from vRef
function bandRing(acc, ring, y0, y1, t, bay, floor, vRef = 0, skip) { wallRing(acc, ring, y0, y1, t, { bayW: bay, floorH: floor, vRef, skip, plainBelow: 0.3 }); }
// a flat cap facing down (a soffit), model space
function capDown(acc, ring, y) {
  const T = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), []);
  for (const [i, j, k] of T) {
    const a = [ring[i][0], y, ring[i][1]], b = [ring[j][0], y, ring[j][1]], c = [ring[k][0], y, ring[k][1]];
    const cr = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (cr < 0) acc.tri(a, b, c, [0, -1, 0]); else acc.tri(a, c, b, [0, -1, 0]);
  }
}
// a flat cap with holes (model space, facing up)
function capHoles(acc, ring, holes, y, uvS = 0.1) {
  const T = THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), holes.map((h) => h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const all = ring.concat(...holes);
  for (const [i, j, k] of T) {
    const a = [all[i][0], y, all[i][1]], b = [all[j][0], y, all[j][1]], c = [all[k][0], y, all[k][1]];
    const cr = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const uv = (q) => [q[0] * uvS, q[2] * uvS];
    if (cr >= 0) acc.tri(a, b, c, [0, 1, 0], uv(a), uv(b), uv(c)); else acc.tri(a, c, b, [0, 1, 0], uv(a), uv(c), uv(b));
  }
}
export function buildMetLife(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const FM = frameMap(ring, ML_REF);
  if (!FM.ok) return null;
  const M = mlMats(), H = ML_H;
  const g = new THREE.Group();
  const TW = new Acc(), LV = new Acc(), WF = new Acc(), PL = new Acc(), RF = new Acc(), DE = new Acc(), CP = new Acc(), PT = new Acc(), DK = new Acc(), SG = new Acc(), LG = new Acc(), CR = new Acc();
  const { tower, louvre, waffle, piloti } = M.tx;
  // ---- the base: glazed ground floor behind its piers, the waffle to the roof, the roof deck and its coping
  bandRing(PL, ML_BASE, 0, 7.6, piloti, 6.1, 7.6, 0);
  bandRing(WF, ML_BASE, 7.6, H.base, waffle, 1.65, 3.6, 7.6);
  loft(CP, ML_BASE, H.base - 0.05, [[0, 0], [0.25, 0], [0.25, 0.6], [0, 0.6]], true);
  capRing(DE, offsetRing(ML_BASE, -0.2), H.base + 0.01);
  loft(CP, ML_BASE, 7.45, [[0, 0], [0.5, 0], [0.5, 0.35], [0, 0.35]], true);                             // the soffit over the piers
  // the raised parts against the tower's broad faces
  for (const [P, h] of [[ML_PODN, H.podN], [ML_PODS, H.podS]]) {
    bandRing(WF, P, H.base, h, waffle, 1.65, 3.6, 7.6);
    capRing(DE, P, h + 0.01);
    loft(CP, P, h - 0.05, [[0, 0], [0.22, 0], [0.22, 0.55], [0, 0.55]], true);
  }
  // rooftop plant on the base: rows of condenser housings on its south part
  const rp = rng(91);
  for (let k = 0; k < 14; k++) {
    const u = -30 + (k % 7) * 9.5 + rp() * 2, v = 50 + Math.floor(k / 7) * 6.5 + rp();
    box(PT, u, H.base, v, 5.0 + rp() * 2, 1.6 + rp() * 0.8, 3.2, 0);
  }
  for (let k = 0; k < 6; k++) box(PT, -32 + k * 12.5, H.base, -45 + rp() * 3, 6, 2.2, 4, 0);
  // ---- the tower: a dark band set back over the base, then the grid with its two louvred floors, the crown
  const octIn = offsetRing(ML_OCT, -1.1);
  bandRing(LV, octIn, H.base, H.t0, louvre, ML_H.bay, 2.2, H.base);
  capDown(DK, ML_OCT, H.t0);                                                                               // the soffit over the band
  // the louvred floors stand 0.55 m behind the grid, with a sill and a soffit
  const cuts = [H.t0, H.bands[0][0], H.bands[0][1], H.bands[1][0], H.bands[1][1], H.crown], octLv = offsetRing(ML_OCT, -0.55);
  for (let i = 0; i + 1 < cuts.length; i++) {
    const lv = i % 2 === 1;
    bandRing(lv ? LV : TW, lv ? octLv : ML_OCT, cuts[i], cuts[i + 1], lv ? louvre : tower, ML_H.bay, lv ? 2.2 : ML_H.floor, H.t0);
    if (lv) { loft(CP, ML_OCT, cuts[i], [[0, 0], [-0.55, 0]], false); loft(CP, ML_OCT, cuts[i + 1], [[-0.55, 0], [0, 0]], false); }
  }
  bandRing(CR, ML_OCT, H.crown, H.top, M.tx.crown, ML_H.bay, H.top - H.crown, H.crown);
  // the slab edges of the louvred floors and the crown's base: a thin projecting band
  for (const y of [H.bands[0][0], H.bands[0][1], H.bands[1][0], H.bands[1][1], H.crown]) loft(CP, ML_OCT, y - 0.15, [[0, 0], [0.18, 0], [0.18, 0.3], [0, 0.3]], true);
  // the roof: the deck round the cooling towers' well, the parapet, the well's walls, floor and towers
  capHoles(RF, offsetRing(ML_OCT, -0.25), [ML_WELL], H.top - 0.4);
  loft(CP, ML_OCT, H.top - 0.4, [[-0.6, 0], [0, 0], [0, 0.55], [-0.6, 0.55]], true);
  loft(CP, ML_OCT, H.top - 0.4, [[-0.6, 0.55], [0.08, 0.55], [0.08, 0.75], [-0.6, 0.75]], true);
  {
    const s = ringOutSign(ML_WELL), n = ML_WELL.length;
    for (let i = 0; i < n; i++) {
      const a = ML_WELL[i], b = ML_WELL[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      const nx = -s * ez / L, nz = s * ex / L;                                                            // facing into the well
      LV.quad([a[0], H.well, a[1]], [b[0], H.well, b[1]], [b[0], H.top - 0.4, b[1]], [a[0], H.top - 0.4, a[1]], [nx, 0, nz], [0, 0], [L / 6.08, 0], [L / 6.08, (H.top - H.well) / 8.8], [0, (H.top - H.well) / 8.8]);
    }
    capRing(DE, ML_WELL, H.well);
    const ct = [[-37, 9], [-37, 17], [-37, 25], [-30, 6], [-30, 14], [-30, 22], [-30, 30], [-23, 9], [-23, 17], [-23, 25], [-13, 4], [-13, 12], [-13, 20], [-13, 28]];
    for (const [u, v] of ct) {
      box(PT, u, H.well, v, 6.4, 4.2, 6.4, 0);
      cyl(PT, u, H.well + 4.2, v, 2.6, 2.6, 0.9, 16);
      cyl(DK, u, H.well + 5.1, v, 2.3, 2.3, 0.05, 16);
    }
  }
  // the name on the crown of both broad faces, and the logo at the east end of the south face
  const signQuad = (u0, u1, v, out, y0, y1) => {
    const a = [u0, y0, v + out * 0.06], b = [u1, y0, v + out * 0.06], c = [u1, y1, v + out * 0.06], d = [u0, y1, v + out * 0.06];
    if (out > 0) SG.quad(a, b, c, d, [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
    else SG.quad(b, a, d, c, [0, 0, -1], [0, 0], [1, 0], [1, 1], [0, 1]);
  };
  signQuad(-18.0, 14.0, 38.1, 1, 229.5, 237.5);
  signQuad(-14.0, 18.0, -4.4, -1, 229.5, 237.5);
  box(LG, 41.53, 229.0, 32.3, 3.2, 5.2, 0.12, Math.atan2(-7.1, -26.6));
  const all = [[TW, M.tower, 'lm64:metlife:grid'], [LV, M.louvre, 'lm64:metlife:louvres'], [CR, M.crown, 'lm64:metlife:crown'], [WF, M.waffle, 'lm64:metlife:base'], [PL, M.piloti, 'lm64:metlife:lobby'],
    [RF, M.roof, 'lm64:metlife:roof'], [DE, M.deck, 'lm64:metlife:decks'], [CP, M.coping, 'lm64:metlife:copings'], [PT, M.plant, 'lm64:metlife:plant'],
    [DK, M.dark, 'lm64:metlife:dark'], [SG, M.sign, 'lm64:metlife:sign'], [LG, M.logo, 'lm64:metlife:logo']];
  for (const [acc] of all) FM.apply(acc);
  addMeshes(g, all);
  g.userData.colliderBoxes = [{ x: FM.centre[0], y: H.base / 2, z: FM.centre[1], w: FM.F.u1 - FM.F.u0, h: H.base, d: FM.F.v1 - FM.F.v0, rotY: FM.rot },
    (() => { const [x, z] = FM.xz(0.65, 16.85); return { x, y: (H.base + H.top) / 2, z, w: 90.7, h: H.top - H.base, d: 42.5, rotY: FM.rot }; })()];
  g.userData.tris = triCount(all);
  return g;
}

/* ----------------------------------------------------- the Helmsley Building */
// Warren and Wetmore, 1929 (the New York Central Building), astride Park Avenue north of the MetLife Building. Massing from
// the city model (BIN 1036185): the limestone base to 21.8 m with the arcade on 46th Street, the brick office wings to
// 62.1 m round light courts on the east and west, their penthouses, the tower 39.4 by 44.5 m to 125.1 m and its top stage
// to 144.3 m; over it the copper pyramid, the lantern and its finial (172 m). The roadways pass through two portals each
// way (where the roads cross the north and south fronts), the walks through the smaller arches beside them.
const HM_REF = [-51.5, 52.7, -29.6, 31.1];
const HM_RING = [[-51.5, -29.6], [52.7, -29.6], [52.7, 31.1], [-51.5, 31.1]];
const HM_TOP = { u0: -10.3, u1: 24.5, v0: -21.9, v1: 19.1, y: 144.3 };
function hmBrickPaint(o) {
  return (g, gb, w, h, r) => {
    const bw = w / 4, fh = h / 4;
    g.fillStyle = rgbs(o.brick); g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 3) { g.fillStyle = `rgba(60,48,36,${(0.05 + r() * 0.05).toFixed(3)})`; g.fillRect(0, y, w, 1); }
    speckle(g, 0, 0, w, h, r, 500, 0.06);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * bw, y = j * fh;
      const panes = o.pair ? [[0.12, 0.36], [0.52, 0.36]] : [[0.25, 0.5]];
      for (const [fx, fw] of panes) {
        const wx = x + bw * fx, ww = bw * fw, wy = y + fh * 0.16, wh = fh * 0.62;
        const gl = g.createLinearGradient(0, wy, 0, wy + wh), k = 0.85 + r() * 0.3;
        gl.addColorStop(0, rgbs([96, 108, 118], k)); gl.addColorStop(1, rgbs([46, 52, 58], k));
        g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
        if (r() < 0.25) { g.fillStyle = 'rgba(226,218,196,0.55)'; g.fillRect(wx, wy, ww, wh * (0.2 + r() * 0.4)); }
        gb.fillStyle = 'rgb(70,70,70)'; gb.fillRect(wx, wy, ww, wh);
        g.fillStyle = rgbs(o.trim); g.fillRect(wx - 1, wy + wh, ww + 2, 3);
      }
      if (o.spandrel) { g.fillStyle = 'rgba(70,58,44,0.25)'; g.fillRect(x + bw * 0.1, y + fh * 0.8, bw * 0.8, fh * 0.32); }
    }
    streaks(g, 0, 0, w, h, r, 12, 0.06);
  };
}
let _HM = null;
function hmMats() {
  if (_HM) return _HM;
  const tower = tile('hm-tower', 256, 512, hmBrickPaint({ brick: [198, 184, 160], trim: [222, 214, 198], pair: 1, spandrel: 1 }), 101, 4, 4);
  const wing = tile('hm-wing', 256, 512, hmBrickPaint({ brick: [194, 180, 156], trim: [222, 214, 198], pair: 0, spandrel: 0 }), 102, 4, 4);
  const base = tile('hm-base', 256, 256, ashlarPaint([204, 196, 180], { hc: 256 / 7, bw: 256 / 3, tone: 0.04, grime: 0.06, rustic: 1 }), 103);
  _HM = {
    tx: { tower, wing, base },
    tower: facadeMat('hm-tower', tower, { rough: 0.85, bump: 1.5 }),
    wing: facadeMat('hm-wing', wing, { rough: 0.85, bump: 1.5 }),
    base: facadeMat('hm-base', base, { rough: 0.84, bump: 1.6 }),
    stone: mat(0xd6cdb8, { rough: 0.8, flat: false, stone: { set: 'climestone', amt: 0.3, nrm: 0.45, rgh: 0.3, ashlar: 0.3 } }),
    roof: mat(0x5c5a56, { rough: 0.9, flat: false }),
    copper: mat(0x9fb898, { rough: 0.6, metal: 0.12, flat: false }),   // a pale verdigris
    gilt: mat(0xc9a24a, { rough: 0.3, metal: 0.85, flat: false }),
    dark: mat(0x16191c, { rough: 0.8, flat: false }),
    plant: mat(0x8e9294, { rough: 0.6, metal: 0.3, flat: false }),
  };
  return _HM;
}
// the four crossings of the Helmsley Building's fronts by the viaduct's roadways as city/hhp.js draws them (its paving
// through globalThis.__hhpPave): { nw, ne, sw, se: { u: the road's middle in the model frame, y: its height over the
// building's ground } | null }, found 0.3 m outside each front within 7 m of the compiled records' crossings
function hmCrossings(ctx, FM) {
  const out = { nw: null, ne: null, sw: null, se: null };
  const pave = typeof globalThis !== 'undefined' ? globalThis.__hhpPave : null;
  if (typeof pave !== 'function' || !Number.isFinite(ctx.cx) || !Number.isFinite(ctx.cz) || !Number.isFinite(ctx.groundY)) return out;
  const F = FM.F;
  const M = (q) => { const a = q[0] - ctx.cx, b = q[2] - ctx.cz; return HM_REF[0] + (a * F.U[0] + b * F.U[1] - F.u0) / FM.su; };
  for (const [k, u0, v, y0] of [['nw', -2.5, -29.9, 1.5], ['ne', 17.7, -29.9, 1.5], ['sw', -40.4, 31.4, 6.0], ['se', 45.0, 31.4, 6.0]]) {
    let best = null;
    for (let u = u0 - 7; u <= u0 + 7; u += 0.5) {
      const p = FM.xz(u, v);
      let h = null;
      try { h = pave(ctx.cx + p[0], ctx.cz + p[1], ctx.groundY + y0); } catch { h = null; }
      if (!h) continue;
      const m = (M(h.l) + M(h.r)) / 2;
      if (Math.abs(m - u0) < 7 && (!best || Math.abs(m - u0) < Math.abs(best.u - u0))) best = { u: m, y: h.y - ctx.groundY };
    }
    out[k] = best;
  }
  return out;
}
export function buildHelmsley(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const FM = frameMap(ring, HM_REF);
  if (!FM.ok) return null;
  const M = hmMats();
  const g = new THREE.Group();
  const TW = new Acc(), WG = new Acc(), BS = new Acc(), ST = new Acc(), RF = new Acc(), CU = new Acc(), GL = new Acc(), DK = new Acc(), PT = new Acc();
  const R = parsePolys(HM_ROOFS).map((P) => ({ P, k: 'roof', pl: planeOf(P), h1: Math.max(...P.map((p) => p[2])) }));
  // ---- the roofs: membranes on the wings and the courts, stone on the tower's setback
  for (const q of R) {
    const pts = q.P.map(([u, v]) => new THREE.Vector2(u, v));
    let T; try { T = THREE.ShapeUtils.triangulateShape(pts, []); } catch { continue; }
    const acc = q.h1 > 120 ? ST : RF;
    for (const [i, j, k] of T) {
      const A = q.P[i], B = q.P[j], C = q.P[k];
      const pa = [A[0], A[2], A[1]], pb = [B[0], B[2], B[1]], pc = [C[0], C[2], C[1]];
      const cr = (pb[2] - pa[2]) * (pc[0] - pa[0]) - (pb[0] - pa[0]) * (pc[2] - pa[2]);
      if (cr >= 0) acc.tri(pa, pb, pc, [0, 1, 0]); else acc.tri(pa, pc, pb, [0, 1, 0]);
    }
  }
  // ---- every wall under a roof edge, down to the next surface or the street, in bands: the stone base to 21.8 m, the
  // brick wings to 62.1 m, the tower over them
  const BANDS = [[0, 21.8, BS, 4.8, 4.8, 1, 1], [21.8, 62.3, WG, 1.6, 3.8, 4, 4], [62.3, 200, TW, 1.6, 3.8, 4, 4]];
  stepWalls(R, HM_RING, (p0, p1, hb, n, q, s0) => {
    const L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const tower = q.h1 > 120;
    for (const [b0, b1, acc0, bay, fl, nx, ny] of BANDS) {
      const y0 = Math.max(hb, b0), y1 = Math.min(p0[2], b1);
      if (y1 - y0 < 0.02) continue;
      const acc = tower && acc0 === WG ? TW : acc0;
      const us = (x) => x / (bay * nx), vs = (y) => y / (fl * ny);
      acc.quad([p0[0], y0, p0[1]], [p1[0], y0, p1[1]], [p1[0], y1, p1[1]], [p0[0], y1, p0[1]], [n[0], 0, n[1]],
        [us(s0), vs(y0)], [us(s0 + L), vs(y0)], [us(s0 + L), vs(y1)], [us(s0), vs(y1)]);
    }
  }, true);
  // cornices: over the base's arcade and stone storeys, the wings, the tower's shaft and its top stage
  const ARC = [[-17.2, -29.6], [30.7, -29.6], [30.7, -23.8], [-17.2, -23.8]];
  loft(ST, HM_RING, 21.3, PROF.cornice.map(([d, h]) => [d * 0.7, h * 0.7]), true);
  loft(ST, HM_RING, 61.4, PROF.atticCap.map(([d, h]) => [d * 1.2, h * 1.2]), true);
  const SH = [[-12.7, -23.8], [26.7, -23.8], [26.7, 20.7], [-12.7, 20.7]], TP = [[HM_TOP.u0, HM_TOP.v0], [HM_TOP.u1, HM_TOP.v0], [HM_TOP.u1, HM_TOP.v1], [HM_TOP.u0, HM_TOP.v1]];
  loft(ST, SH, 124.4, PROF.cornice.map(([d, h]) => [d * 0.8, h * 0.8]), true);
  loft(ST, TP, 143.6, PROF.cornice.map(([d, h]) => [d * 0.7, h * 0.7]), true);
  // the setback's corner urns
  for (const [u, v] of SH) { const cu = u + Math.sign(7 - u) * 1.6, cv = v + Math.sign(-1.5 - v) * 1.6; box(ST, cu, 125.1, cv, 1.4, 1.2, 1.4); lathe(ST, cu, 126.3, cv, [[0.5, 0], [0.75, 0.6], [0.6, 1.4], [0.3, 1.8], [0.4, 2.0], [0, 2.3]], 10); }
  // ---- the pyramid, the lantern and the finial
  {
    const t = HM_TOP, cu = (t.u0 + t.u1) / 2, cv = (t.v0 + t.v1) / 2, y0 = t.y + 0.8, y1 = 159.0, ht = 4.2;   // a 47 degree pitch
    const base = [[t.u0 + 0.7, t.v0 + 0.7], [t.u1 - 0.7, t.v0 + 0.7], [t.u1 - 0.7, t.v1 - 0.7], [t.u0 + 0.7, t.v1 - 0.7]];
    const top = [[cu - ht, cv - ht], [cu + ht, cv - ht], [cu + ht, cv + ht], [cu - ht, cv + ht]];
    for (let i = 0; i < 4; i++) {
      const a = base[i], b = base[(i + 1) % 4], c = top[(i + 1) % 4], d = top[i];
      const mx = (a[0] + b[0]) / 2 - cu, mz = (a[1] + b[1]) / 2 - cv, ml = Math.hypot(mx, mz);
      const run = Math.hypot((a[0] + b[0]) / 2 - (c[0] + d[0]) / 2, (a[1] + b[1]) / 2 - (c[1] + d[1]) / 2), rise = y1 - y0, L = Math.hypot(run, rise);
      CU.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]], [mx / ml * rise / L, run / L, mz / ml * rise / L]);
      // the dormers on each slope
      for (const f of [0.3, 0.7]) {
        const px = a[0] + (b[0] - a[0]) * f + (-mx / ml) * 3.2, pz = a[1] + (b[1] - a[1]) * f + (-mz / ml) * 3.2;
        box(ST, px, y0 + 2.4, pz, 2.0, 2.6, 2.0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
        lathe(CU, px, y0 + 5.0, pz, [[1.3, 0], [0, 1.2]], 4, Math.PI / 4 + Math.atan2(-(b[1] - a[1]), b[0] - a[0]));
      }
    }
    capRing(ST, top, y1);
    loft(ST, base, y0 - 0.8, [[0, 0], [0.2, 0], [0.2, 0.9], [0, 0.9]], true);   // the parapet round its foot
    // the lantern: an octagonal colonnaded drum, its dome, a smaller lantern, the gilded finial
    let y = y1;
    cyl(ST, cu, y, cv, 4.4, 4.6, 1.2, 8); y += 1.2;
    cyl(DK, cu, y, cv, 3.0, 3.0, 5.0, 8);
    for (let k = 0; k < 8; k++) { const a = (k + 0.5) * Math.PI / 4; cyl(ST, cu + 3.8 * Math.cos(a), y, cv + 3.8 * Math.sin(a), 0.35, 0.4, 5.0, 8); }
    y += 5.0;
    cyl(ST, cu, y, cv, 4.5, 4.2, 0.9, 8); y += 0.9;
    lathe(CU, cu, y, cv, [[4.0, 0], [3.6, 1.4], [2.6, 2.6], [1.4, 3.3], [0.6, 3.6], [0, 3.7]], 16); y += 3.4;
    cyl(GL, cu, y, cv, 0.9, 1.1, 1.6, 8); y += 1.6;
    lathe(GL, cu, y, cv, [[1.1, 0], [0.6, 0.6], [0.25, 1.1], [0.35, 1.4], [0.12, 1.9], [0.05, 3.0], [0, 3.2]], 10);
  }
  // ---- the portals: the roadways' where the roads cross the fronts (the compiled road records: on 46th Street at 2.5 m
  // and 17.7 m east of the model's origin, symmetric about the tower, at grade; on 45th Street near the ends, at the
  // roadway's level 6.7 m up) and the walks' beside the 46th Street pair; dark under arched stone surrounds
  const portal = (u, v, w, h, out, y0 = 0) => {
    const fr = frontFrame(u - (out > 0 ? w / 2 : -w / 2), v, out > 0 ? 1 : -1, 0);
    const loop = archLoop(0, w, y0, h - w / 2, 14);
    frontPoly(DK, fr, loop, [], 0.04, 4, 1);
    const ry = Math.atan2(-fr.dv, fr.du);
    for (let k = 0; k < 14; k++) {
      const am = ((k + 0.5) / 14) * Math.PI, R0 = w / 2 + 0.45, c = fr.P(w / 2 + R0 * Math.cos(am), 0, 0.25);
      box(ST, c[0], h - w / 2 + R0 * Math.sin(am) - 0.45, c[2], R0 * (Math.PI / 14) * 1.08, 0.9, 0.5, ry, am + Math.PI / 2);
    }
    for (const sg of [0, 1]) { const c = fr.P(sg ? w + 0.45 : -0.45, 0, 0.25); box(ST, c[0], y0, c[2], 0.9, h - w / 2 - y0, 0.5, ry); }
    if (y0 > 0) { const c = fr.P(w / 2, 0, 0.3); box(ST, c[0], y0 - 0.5, c[2], w + 1.8, 0.5, 0.6, ry); }
  };
  // (where the roadways as city/hhp.js draws them cross the fronts: each portal on its road's middle, the 45th Street pair's
  // floor 0.6 m under the road; else the compiled road records' crossings)
  const X = hmCrossings(ctx, FM);
  const nW = X.nw ? X.nw.u : -2.5, nE = X.ne ? X.ne.u : 17.7;
  const sW = X.sw ? [X.sw.u, X.sw.y - 0.6] : [-40.4, 6.1], sE = X.se ? [X.se.u, X.se.y - 0.6] : [45.0, 5.3];
  portal(nW, -29.6, 9.6, 11.5, -1); portal(nE, -29.6, 9.6, 11.5, -1); portal(nW - 8.4, -29.6, 4.0, 7.2, -1); portal(nE + 8.4, -29.6, 4.0, 7.2, -1);
  portal(sW[0], 31.1, 9.6, sW[1] + 8.1, 1, sW[1]); portal(sE[0], 31.1, 9.6, sE[1] + 8.3, 1, sE[1]);
  g.userData.portals = X;
  // the clock and its figures over the north portals, on the tower's axis
  {
    const fr = frontFrame(7.6, -29.6, -1, 0), c = fr.P(0, 0, 0.6);
    const gq = new THREE.CylinderGeometry(1.6, 1.6, 0.3, 28);
    GL.addGeo(gq, new THREE.Matrix4().compose(new THREE.Vector3(c[0], 15.2, c[2]), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1)), new THREE.Vector3(1, 1, 1)));
    gq.dispose();
    for (const sg of [-1, 1]) { const q = fr.P(sg * 3.2, 0, 0.8); ell(ST, [q[0], 14.3, q[2]], [2.0, 0.9, 0.8], 0, 0, sg * 0.25); ell(ST, [q[0] + sg * 1.2, 15.3, q[2]], [0.45, 0.55, 0.45]); }
  }
  // plant on the wings' roofs
  const rp = rng(111);
  for (let k = 0; k < 8; k++) box(PT, 33 + (k % 4) * 4.2, 62.1, -26 + Math.floor(k / 4) * 50 + rp(), 3.2, 1.8, 2.4);
  const all = [[TW, M.tower, 'lm64:helmsley:tower'], [WG, M.wing, 'lm64:helmsley:wings'], [BS, M.base, 'lm64:helmsley:base'], [ST, M.stone, 'lm64:helmsley:stone'],
    [RF, M.roof, 'lm64:helmsley:roofs'], [CU, M.copper, 'lm64:helmsley:copper'], [GL, M.gilt, 'lm64:helmsley:gilt'], [DK, M.dark, 'lm64:helmsley:portals'], [PT, M.plant, 'lm64:helmsley:plant']];
  for (const [acc] of all) FM.apply(acc);
  addMeshes(g, all);
  g.userData.colliderBoxes = [{ x: FM.centre[0], y: 31, z: FM.centre[1], w: FM.F.u1 - FM.F.u0, h: 62, d: FM.F.v1 - FM.F.v0, rotY: FM.rot },
    (() => { const [x, z] = FM.xz(7.0, -1.4); return { x, y: 103, z, w: 39.4, h: 82, d: 44.5, rotY: FM.rot }; })()];
  g.userData.tris = triCount(all);
  return g;
}

/* ------------------------------------------------------------ One Vanderbilt */
// Kohn Pedersen Fox, 2020: 427 m to the spire across Vanderbilt Avenue from the terminal. Four tapering volumes interlocked
// round the core: the plan narrows from the lot to about a third of its width, every corner is cut by a stepped notch, and
// the volumes stop one after another near the top, so the crown climbs round the tower in steps to the core's open top and
// the spire. The glass is clear and pale (it reads light blue-grey from the sky it reflects), a bright spandrel band at
// every floor; the lower floors carry glazed terracotta spandrels and fins. (Not in the 2014 city model: dimensions from
// the compiled footprint and the published heights.)
const OV = { base: 22, t0: 30, top: 396.5, spire: 427, floor: 4.25, bay: 1.52, notch: 3.2 };
function ovGlassPaint(o) {
  return (g, gb, w, h, r) => {
    const bw = w / 4, fh = h / 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const x = i * bw, y = j * fh;
      const gl = g.createLinearGradient(0, y, 0, y + fh), k = 0.93 + r() * 0.12;
      gl.addColorStop(0, rgbs(o.glassTop, k)); gl.addColorStop(1, rgbs(o.glassBot, k));
      g.fillStyle = gl; g.fillRect(x, y, bw, fh);
      if (r() < 0.12) { g.fillStyle = 'rgba(40,46,52,0.35)'; g.fillRect(x, y + fh * 0.25, bw, fh * 0.5); }   // a deeper pane
      gb.fillStyle = 'rgb(120,120,120)'; gb.fillRect(x, y, bw, fh);
    }
    for (let j = 0; j < 4; j++) {                                                                   // the floor's spandrel band
      g.fillStyle = rgbs(o.band); g.fillRect(0, j * fh + fh * (1 - o.bandH), w, fh * o.bandH);
      g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, j * fh + fh * (1 - o.bandH) - 2, w, 2);
      gb.fillStyle = 'rgb(200,200,200)'; gb.fillRect(0, j * fh + fh * (1 - o.bandH), w, fh * o.bandH);
    }
    for (let i = 0; i <= 4; i++) { g.fillStyle = rgbs(o.mullion); g.fillRect(i * bw - (o.fin ? 5 : 1.5), 0, o.fin ? 10 : 3, h); gb.fillStyle = 'rgb(210,210,210)'; gb.fillRect(i * bw - (o.fin ? 5 : 1.5), 0, o.fin ? 10 : 3, h); }
  };
}
let _OV = null;
function ovMats() {
  if (_OV) return _OV;
  const glass = tile('ov-glass', 256, 512, ovGlassPaint({ glassTop: [184, 190, 196], glassBot: [144, 152, 160], band: [234, 234, 230], bandH: 0.3, mullion: [204, 206, 208] }), 121, 4, 4);
  const terra = tile('ov-terra', 256, 512, ovGlassPaint({ glassTop: [120, 136, 148], glassBot: [86, 98, 108], band: [214, 196, 172], bandH: 0.34, mullion: [206, 188, 164], fin: 1 }), 122, 4, 4);
  _OV = {
    tx: { glass, terra },
    glass: facadeMat('ov-glass', glass, { rough: 0.16, metal: 0.15, bump: 0.8 }),   // a light base colour, a sharp low metal mirror: light blue-grey with the sky in it
    terra: facadeMat('ov-terra', terra, { rough: 0.45, metal: 0.15, bump: 1.4 }),
    roof: mat(0xbfc2c4, { rough: 0.7, flat: false }),
    steel: mat(0xd8dcdf, { rough: 0.4, metal: 0.35, flat: false }),
    terraSolid: mat(0xd6c4aa, { rough: 0.6, flat: false }),
  };
  return _OV;
}
// the notched plan at half-widths (hu, hv): every corner cut by an n x n notch, counter-clockwise from the east side
function ovPlan(cu, cv, hu, hv, n) {
  return [[cu + hu, cv - hv + n], [cu + hu, cv + hv - n], [cu + hu - n, cv + hv - n], [cu + hu - n, cv + hv], [cu - hu + n, cv + hv], [cu - hu + n, cv + hv - n],
    [cu - hu, cv + hv - n], [cu - hu, cv - hv + n], [cu - hu + n, cv - hv + n], [cu - hu + n, cv - hv], [cu + hu - n, cv - hv], [cu + hu - n, cv - hv + n]];
}
// walls between two plans of the same vertex count (a tapered prism), u mapped to whole bays per edge, v to absolute floors
function taperWalls(acc, A, B, y0, y1, bay, floor, vRef, nx, ny) {
  const n = A.length;
  let s = 0; for (let i = 0; i < n; i++) { const a = A[i], b = A[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  const sg = s > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a0 = A[i], b0 = A[(i + 1) % n], a1 = B[i], b1 = B[(i + 1) % n];
    const L = (Math.hypot(b0[0] - a0[0], b0[1] - a0[1]) + Math.hypot(b1[0] - a1[0], b1[1] - a1[1])) / 2;
    if (L < 0.05) continue;
    const ex = b0[0] - a0[0], ez = b0[1] - a0[1], el = Math.hypot(ex, ez) || 1;
    const nb = Math.max(1, Math.round(L / bay)) / nx;
    const nrm = [sg * ez / el, 0, -sg * ex / el];
    acc.quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], nrm,
      [0, (y0 - vRef) / (floor * ny)], [nb, (y0 - vRef) / (floor * ny)], [nb, (y1 - vRef) / (floor * ny)], [0, (y1 - vRef) / (floor * ny)]);
  }
}
// walls between two plans with a fixed bay count per edge (the mullions converge with the taper instead of jumping)
function taperWallsN(acc, A, B, y0, y1, nbs, floor, vRef, nx, ny) {
  const n = A.length;
  let s = 0; for (let i = 0; i < n; i++) { const a = A[i], b = A[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; }
  const sg = s > 0 ? 1 : -1;
  for (let i = 0; i < n; i++) {
    const a0 = A[i], b0 = A[(i + 1) % n], a1 = B[i], b1 = B[(i + 1) % n];
    const ex = b0[0] - a0[0], ez = b0[1] - a0[1], el = Math.hypot(ex, ez);
    if (el < 0.05) continue;
    const nb = nbs[i] / nx, v0 = (y0 - vRef) / (floor * ny), v1 = (y1 - vRef) / (floor * ny);
    acc.quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], [sg * ez / el, 0, -sg * ex / el],
      [0, v0], [nb, v0], [nb, v1], [0, v1]);
  }
}
// a rectangle (u0..u1, v0..v1) counter-clockwise
const rectUV = (u0, u1, v0, v1) => [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
export function buildOneVanderbilt(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = streetFrame(ring);
  const lu = (F.u1 - F.u0) / 2, lv = (F.v1 - F.v0) / 2, cu = (F.u0 + F.u1) / 2, cv = (F.v0 + F.v1) / 2;
  if (lu < 15 || lv < 15) return null;
  const FM = { apply: (acc) => { const p = acc.p, n = acc.n; for (let i = 0; i < p.length; i += 3) { const u = p[i], v = p[i + 2]; p[i] = F.U[0] * u + F.V[0] * v; p[i + 2] = F.U[1] * u + F.V[1] * v; const nu = n[i], nv = n[i + 2]; n[i] = F.U[0] * nu + F.V[0] * nv; n[i + 2] = F.U[1] * nu + F.V[1] * nv; } } };
  const M = ovMats();
  const g = new THREE.Group();
  const GL = new Acc(), TC = new Acc(), RF = new Acc(), SL = new Acc(), TS = new Acc();
  const H = Math.max(300, Math.min(440, ctx.height || OV.spire)), k = H / OV.spire;
  const top = OV.top * k, n0 = OV.notch, fl = OV.floor;
  // half-widths: the lot less a margin at the base, 62 % of it where the first volume stops
  const hu0 = lu - 1.6, hv0 = lv - 1.6, yT = 290 * k;
  const half = (y, r = 0.62) => { const t = Math.max(0, Math.min(1, (y - OV.t0) / (yT - OV.t0))); return [hu0 * (1 - (1 - r) * t), hv0 * (1 - (1 - r) * t)]; };
  const bayN = (L) => Math.max(1, Math.round(L / OV.bay));
  // ---- the base: the lot to 22 m in terracotta and glass, a terracotta frieze over it
  const lot = ovPlan(cu, cv, lu - 0.2, lv - 0.2, 0.01);
  taperWallsN(TC, lot, lot, 0, OV.base, lot.map((p, i) => bayN(Math.hypot(lot[(i + 1) % 12][0] - p[0], lot[(i + 1) % 12][1] - p[1]) / 2)), 5.5, 0, 4, 4);
  capRing(RF, lot, OV.base);
  loft(TS, lot, OV.base - 0.7, [[0, 0], [0.6, 0], [0.6, 0.7], [0, 0.7]], true);
  // ---- the shaft: notched and tapered from the base to yT, the bay count of each face fixed at the base
  const P0 = ovPlan(cu, cv, ...half(OV.t0), n0);
  const nbs = P0.map((p, i) => bayN(Math.hypot(P0[(i + 1) % 12][0] - p[0], P0[(i + 1) % 12][1] - p[1])));
  const yTerra = OV.t0 + 10 * fl;
  {
    const A = ovPlan(cu, cv, ...half(OV.base), n0), B = ovPlan(cu, cv, ...half(OV.t0), n0);
    taperWallsN(TC, A, B, OV.base, OV.t0, nbs, fl, OV.base, 4, 4);
  }
  for (let y = OV.t0; y < yT - 0.01;) {
    const y1 = Math.min(yT, y + 4 * fl);
    taperWallsN(y < yTerra ? TC : GL, ovPlan(cu, cv, ...half(y), n0), ovPlan(cu, cv, ...half(y1), n0), y, y1, nbs, fl, OV.base, 4, 4);
    y = y1;
  }
  // ---- the crown: the core goes on to the top; the four wings round it stop one after another, south first, then east,
  // north and west, each roofed by a slope rising from its outer face to the core
  const [huT, hvT] = half(yT), cuh = huT * 0.6, cvh = hvT * 0.6;
  const coreAt = (y) => { const t = (y - yT) / (top - yT); return [cuh * (1 - 0.15 * t), cvh * (1 - 0.15 * t)]; };
  const outAt = (y) => { const t = (y - yT) / (top - yT); return [huT * (1 - 0.3 * t), hvT * (1 - 0.3 * t)]; };
  const wings = [['S', yT + 2 * k], ['E', yT + 22 * k], ['N', yT + 42 * k], ['W', yT + 62 * k]];
  const wingRect = (side, y) => {
    const [ou, ov] = outAt(y), [iu, iv] = coreAt(y);
    if (side === 'S') return rectUV(cu - ou, cu + ou, cv + iv, cv + ov);
    if (side === 'N') return rectUV(cu - ou, cu + ou, cv - ov, cv - iv);
    if (side === 'E') return rectUV(cu + iu, cu + ou, cv - iv, cv + iv);
    return rectUV(cu - ou, cu - iu, cv - iv, cv + iv);
  };
  const wingN = (R) => R.map((p, i) => bayN(Math.hypot(R[(i + 1) % 4][0] - p[0], R[(i + 1) % 4][1] - p[1])));
  for (const [side, ys] of wings) {
    const A = wingRect(side, yT), B = wingRect(side, ys), nb = wingN(A);
    if (ys > yT + 0.5) taperWallsN(GL, A, B, yT, ys, nb, fl, OV.base, 4, 4);
    // the slope over it: a steep glazed facet from its outer edge at ys up 20 m to the core's face
    const rise = 20 * k, [ou, ov] = outAt(ys), [iu, iv] = coreAt(ys + rise);
    let Q;
    if (side === 'S') Q = [[cu - ou, ys, cv + ov], [cu + ou, ys, cv + ov], [cu + iu, ys + rise, cv + iv], [cu - iu, ys + rise, cv + iv]];
    else if (side === 'N') Q = [[cu + ou, ys, cv - ov], [cu - ou, ys, cv - ov], [cu - iu, ys + rise, cv - iv], [cu + iu, ys + rise, cv - iv]];
    else if (side === 'E') Q = [[cu + ou, ys, cv + iv], [cu + ou, ys, cv - iv], [cu + iu, ys + rise, cv - iv], [cu + iu, ys + rise, cv + iv]];
    else Q = [[cu - ou, ys, cv - iv], [cu - ou, ys, cv + iv], [cu - iu, ys + rise, cv + iv], [cu - iu, ys + rise, cv - iv]];
    const e1 = [Q[1][0] - Q[0][0], Q[1][1] - Q[0][1], Q[1][2] - Q[0][2]], e2 = [Q[3][0] - Q[0][0], Q[3][1] - Q[0][1], Q[3][2] - Q[0][2]];
    let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...nn) || 1; nn = nn.map((x) => x / nl); if (nn[1] < 0) nn = nn.map((x) => -x);
    GL.quad(Q[0], Q[1], Q[2], Q[3], nn, [0, 0], [4, 0], [4, 2], [0, 2]);
    // the slope's side triangles where the wing meets its neighbours
    for (const [a, b] of [[0, 3], [1, 2]]) {
      const base = [Q[a][0], ys, Q[a][2]], tip = Q[b], low = [Q[b][0], ys, Q[b][2]];
      const ex = low[0] - base[0], ez = low[2] - base[2], el = Math.hypot(ex, ez) || 1;
      const nside = [ez / el, 0, -ex / el];
      GL.tri2(base, low, tip, nside);
    }
  }
  // the core: glass up to the open frame, the frame's posts and rings round a dark inner core, the spire
  const yF = wings[3][1] + 20 * k + 2;
  taperWallsN(GL, ovPlan(cu, cv, ...coreAt(yT), 1.2), ovPlan(cu, cv, ...coreAt(yF), 1.2), yT, yF, ovPlan(cu, cv, ...coreAt(yT), 1.2).map((p, i, A) => bayN(Math.hypot(A[(i + 1) % 12][0] - p[0], A[(i + 1) % 12][1] - p[1]))), fl, OV.base, 4, 4);
  {
    const fr = ovPlan(cu, cv, ...coreAt(yF), 1.2), yf1 = top;
    for (const [u, v] of fr) box(SL, u, yF, v, 0.8, yf1 - yF, 0.8);
    for (let y = yF; y <= yf1 + 0.01; y += 4.3) loft(SL, fr, y, [[-0.35, 0], [0.12, 0], [0.12, 0.5], [-0.35, 0.5]], true);
    const inner = ovPlan(cu, cv, ...coreAt(yF).map((x) => x * 0.55), 0.6);
    taperWallsN(GL, inner, inner, yF, yf1, inner.map((p, i) => bayN(Math.hypot(inner[(i + 1) % 12][0] - p[0], inner[(i + 1) % 12][1] - p[1]))), fl, OV.base, 4, 4);   // the lantern's glass core
    capRing(RF, inner, yf1);
    capRing(RF, fr, yF);
    lathe(SL, cu, yf1, cv, [[1.8, 0], [1.3, 6], [0.85, 14], [0.45, 22], [0.18, (H - yf1) * 0.97], [0, H - yf1]], 8, Math.PI / 4);
  }
  const all = [[GL, M.glass, 'lm64:onevanderbilt:glass'], [TC, M.terra, 'lm64:onevanderbilt:terracotta'], [RF, M.roof, 'lm64:onevanderbilt:roofs'],
    [SL, M.steel, 'lm64:onevanderbilt:crown'], [TS, M.terraSolid, 'lm64:onevanderbilt:frieze']];
  for (const [acc] of all) FM.apply(acc);
  addMeshes(g, all);
  g.userData.colliderBoxes = [{ x: F.U[0] * cu + F.V[0] * cv, y: top / 2, z: F.U[1] * cu + F.V[1] * cv, w: lu * 1.6, h: top, d: lv * 1.6, rotY: Math.atan2(-F.U[1], F.U[0]) }];
  g.userData.tris = triCount(all);
  return g;
}

// The terminal's roof surfaces from the city's 3D building model (DoITT 2014 CityGML, BIN 1035381), in its grid frame:
// u metres east along 42nd Street, v metres south, h metres over the ground; 0.1 m. Origin: the compiled ring's vertex mean.
const GCT_ROOFS = [
  '27.4,17,41.7 32.4,17.1,41.7 32.4,14.3,41.7 27.4,14.3,41.7|',
  '-49.4,16.1,36.1 -48.6,15.3,36.6 -47.9,14.5,37 -47,13.6,37.5 -46.4,12.5,37.8 -46.2,11.7,38 -45.9,10.7,38.1 -46.2,9.4,38 -46.5,8.3,37.8 -47,7.1,37.5 -47.9,6.2,37 -48.6,5.6,36.6 -49.4,5.1,36.1 -49.4,5.6,36.6 -49.4,6.2,37 -49.4,7.1,37.5 -49.4,8.3,37.8 -49.4,9.4,38 -49.4,10.7,38.1 -49.4,11.7,38 -49.4,13.6,37.5 -49.4,14.5,37 -49.4,15.3,36.6|',
  '-49.5,-48.3,36.1 -49.5,-47.6,36.6 -49.5,-46.1,37.5 -49.5,-44.9,37.8 -49.5,-43.8,38 -49.5,-42.6,38.1 -49.5,-41.5,38 -49.5,-39.6,37.5 -49.5,-38,36.6 -49.5,-37.2,36.1 -48.6,-37.8,36.6 -47.8,-38.5,37 -47,-39.6,37.5 -46.5,-40.7,37.8 -46.2,-41.5,38 -46,-42.6,38.1 -46.2,-43.8,38 -46.5,-44.9,37.8 -46.9,-46.1,37.5 -47.7,-46.9,37 -48.3,-47.6,36.6|',
  '40.3,-48.7,36.1 39.2,-47.5,36.5 38.5,-46.8,37 38,-45.9,37.5 37.6,-44.8,37.7 37.3,-44,37.9 37,-42.9,38.1 37.6,-40.5,37.7 38.1,-39.4,37.5 38.9,-38.4,37 39.6,-37.8,36.5 40.3,-37.3,36.1 40.3,-38.6,37 40.3,-39.4,37.5 40.3,-42.9,38.1 40.3,-44,37.9 40.3,-44.8,37.7 40.3,-45.8,37.5 40.3,-46.8,37 40.3,-47.5,36.5|',
  '40.4,5,36.1 39.6,5.6,36.5 38.9,6.3,37 38.2,7.3,37.5 37.6,8.4,37.7 37.4,9.2,38 37.1,10.2,38.1 37.4,11.5,38 37.6,12.6,37.7 38.3,13.8,37.5 39.1,14.6,37 39.8,15.3,36.5 40.4,15.8,36.1 40.4,14.6,37 40.4,13.8,37.5 40.4,12.6,37.7 40.4,11.5,38 40.4,10.2,38.1 40.4,9.2,38 40.4,8.4,37.7 40.4,7.3,37.5 40.4,6.4,37|',
  '-50.3,-37.2,36.1 -50.3,5.1,36.1 -49.4,5.1,36.1 -49.5,-37.2,36.1|',
  '40.4,5,36.1 41,5,36.1 40.9,-37.3,36.1 40.3,-37.3,36.1|',
  '-49.5,-48.3,36.1 -50.3,-48.3,36.1 -50.3,-47.6,36.9 -50.3,-46.1,37.8 -50.3,-44.9,38.1 -50.3,-43.8,38.3 -50.3,-42.6,38.4 -50.3,-41.5,38.3 -50.3,-39.6,37.8 -50.3,-38,36.9 -50.3,-37.2,36.1 -49.5,-37.2,36.1 -49.5,-38,36.9 -49.5,-39.6,37.8 -49.5,-41.5,38.3 -49.5,-42.6,38.4 -49.5,-43.8,38.3 -49.5,-44.9,38.1 -49.5,-46.1,37.8 -49.5,-47.6,36.9|',
  '-50.3,5.1,36.1 -50.3,5.6,37.1 -50.3,6.2,37.5 -50.3,7.1,38 -50.3,8.3,38.3 -50.3,9.4,38.5 -50.3,10.7,38.6 -50.3,11.7,38.5 -50.3,13.6,38 -50.3,14.5,37.5 -50.3,15.3,37.1 -50.3,16.1,36.1 -49.4,16.1,36.1 -49.4,15.3,37.1 -49.4,14.5,37.5 -49.4,13.6,38 -49.4,11.7,38.5 -49.4,10.7,38.6 -49.4,9.4,38.5 -49.4,8.3,38.3 -49.4,7.1,38 -49.4,6.2,37.5 -49.4,5.6,37.1 -49.4,5.1,36.1|',
  '-50.3,16.1,36.1 -50.3,17.7,36.1 -47.2,17.7,36.1 -47.1,37.7,36.1 -14.2,37.8,36.1 -14.2,37,36.1 -46,36.9,36.1 -46,16.1,36.1|',
  '6.1,37,36.1 6.1,37.8,36.1 38.6,37.8,36.1 38.6,17.5,36.1 41,17.5,36.1 41,15.8,36.1 37.2,15.8,36.1 37.2,37,36.1|',
  '41,5,36.1 40.4,5,36.1 40.4,5.6,37 40.4,6.4,37.5 40.4,7.3,38 40.4,8.4,38.2 40.4,9.2,38.4 40.4,10.2,38.6 40.4,13.8,38 40.4,14.6,37.5 40.4,15.3,37 40.4,15.8,36.1 41,15.8,36.1 41,15.3,37 41,14.6,37.5 41,13.8,38 41,10.2,38.6 41,9.2,38.4 41,8.4,38.2 41,7.3,38 41,6.4,37.5 41,5.6,37|',
  '-49.4,16.1,36.1 -46,16.1,36.1 -36.2,5.9,41.7 -39.4,5.9,41.7 -47.9,14.5,37 -48.6,15.3,36.6|',
  '-46,16.1,36.1 -46,36.9,36.1 -36.2,27,41.7 -36.2,5.9,41.7|',
  '37.2,37,36.1 37.2,15.8,36.1 27.4,6,41.7 27.4,14.3,41.7 32.4,14.3,39.5 32.4,17.1,39.5 27.4,17,41.7 27.4,27.1,41.7|',
  '37.2,15.8,36.1 40.4,15.8,36.1 39.8,15.3,36.5 39.1,14.6,37 38.3,13.8,37.5 37.6,12.6,37.7 30.6,6,41.7 27.4,6,41.7|',
  '-4.2,28.1,41.2 -36.2,27,41.7 -46,36.9,36.1 -14.2,37,36.1 -14.2,34.9,37.4 -11.3,34.9,37.4|',
  '-2.3,37.8,44.8 0.9,37.8,44.8 0.9,37,44.8 -2.3,37,44.8|-9.3,37.8,44.8 -7.6,37.8,44.8 -7.6,37,44.8 -9.3,37,44.8|',
  '-13.3,37,36.1 -13.3,34.9,36.1 -14.2,34.9,36.1 -14.2,37,36.1|4.5,37,36.1 6.1,37,36.1 6.1,35,36.1 4.5,35,36.1|',
  '-24.4,-9.5,37 15.6,-9.5,37 15.6,-15.7,39.8 -24.4,-15.8,39.8|',
  '15.6,-15.7,39.8 15.6,-21.9,37 -24.4,-21.9,37 -24.4,-15.8,39.8|',
  '-24.2,3.3,28 -24.1,5.3,28 -21.1,5.3,28 -21.1,3.3,28|-12,3.3,28 -12,5.3,28 -9,5.3,28 -9,3.3,28|',
  '0.5,3.3,28 0.5,5.3,28 3.3,5.3,28 3.3,3.3,28|12.2,3.3,28 12.2,5.3,28 15.3,5.3,28 15.3,3.3,28|',
  '12.4,16.8,31.5 15.3,16.8,31.5 15.3,14.7,31.5 12.4,14.7,31.5|',
  '0.5,16.8,31.5 3.3,16.8,31.5 3.3,14.7,31.5 0.5,14.7,31.5|',
  '-11.9,16.8,31.5 -9,16.8,31.5 -9,14.7,31.5 -11.9,14.7,31.5|',
  '-24.1,16.8,31.5 -21.2,16.8,31.5 -21.2,14.7,31.5 -24.1,14.7,31.5|-20.6,13.8,18.5 -16.5,10,19.8 -20.6,6.6,18.5|',
  '-20.6,6.6,18.5 -16.5,10,19.8 -12.6,6.6,18.5|-12.6,6.6,18.5 -16.5,10,19.8 -12.6,13.8,18.5|',
  '-12.6,13.8,18.5 -16.5,10,19.8 -20.6,13.8,18.5|15.9,14,18.5 20,10.2,19.8 15.9,6.8,18.5|',
  '15.9,6.8,18.5 20,10.2,19.8 24,6.8,18.5|24,6.8,18.5 20,10.2,19.8 24,14,18.5|24,14,18.5 20,10.2,19.8 15.9,14,18.5|',
  '3.5,14.3,18.5 7.5,10.8,19.8 3.5,7.1,18.5|3.5,7.1,18.5 7.5,10.8,19.8 11.6,7.1,18.5|',
  '11.6,7.1,18.5 7.5,10.8,19.8 11.6,14.3,18.5|11.6,14.3,18.5 7.5,10.8,19.8 3.5,14.3,18.5|',
  '12.2,5.3,18.5 12.2,3.3,18.5 3.3,3.3,18.5 3.3,5.3,18.5|-12,5.3,18.5 -12,3.3,18.5 -21.1,3.3,18.5 -21.1,5.3,18.5|',
  '-34.2,-48.3,36.1 -34.2,-49.2,36.1 -50.3,-49.2,36.1 -50.3,-48.3,36.1|',
  '-38.7,-37,41.7 -38.7,-34.5,41.7 -34.2,-34.5,41.7 -34.2,-37,41.7|',
  '29.6,-36.9,41.7 24.8,-36.9,41.7 24.8,-34.7,41.7 29.6,-34.7,41.7|',
  '-24.5,-37.1,31.3 -24.4,-35.2,31.3 -21.4,-35.1,31.3 -21.4,-37.1,31.3|',
  '-12.2,-37.1,31.3 -12.2,-35.1,31.3 -9.1,-35.1,31.3 -9.1,-37.1,31.3|',
  '-0.1,-37.1,31.3 -0.1,-35.1,31.3 3,-35.1,31.3 3,-37.1,31.3|',
  '12,-37.1,31.3 12,-35.1,31.3 15.1,-35.1,31.3 15.1,-37.1,31.3|',
  '-33,-46.1,28.2 -28.6,-46.1,28.2 -28.6,-49.2,28.2 -33,-49.2,28.2|',
  '19.4,-46,28.2 23.9,-46,28.2 23.9,-49.1,28.2 19.4,-49.1,28.2|3.6,-38.2,18.5 7.5,-41.7,19.8 3.6,-45.4,18.5|',
  '3.6,-45.4,18.5 7.5,-41.7,19.8 11.7,-45.4,18.5|11.7,-45.4,18.5 7.5,-41.7,19.8 11.7,-38.2,18.5|',
  '11.7,-38.2,18.5 7.5,-41.7,19.8 3.6,-38.2,18.5|-8.6,-38.1,18.5 -4.7,-41.6,19.8 -8.6,-45.3,18.5|',
  '-8.6,-45.3,18.5 -4.7,-41.6,19.8 -0.6,-45.3,18.5|-0.6,-45.3,18.5 -4.7,-41.6,19.8 -0.6,-38.1,18.5|',
  '-0.6,-38.1,18.5 -4.7,-41.6,19.8 -8.6,-38.1,18.5|-20.8,-38,18.5 -16.9,-41.5,19.8 -20.8,-45.2,18.5|',
  '-20.8,-45.2,18.5 -16.9,-41.5,19.8 -12.7,-45.2,18.5|-12.7,-45.2,18.5 -16.9,-41.5,19.8 -12.7,-38,18.5|',
  '-12.7,-38,18.5 -16.9,-41.5,19.8 -20.8,-38,18.5|',
  '12,-37.1,18.5 15.1,-37.1,18.5 15.1,-35.1,18.5 23.9,-35.1,18.5 23.9,-46,18.5 19.4,-46,18.5 19.4,-49.1,18.5 11.7,-49.1,18.5 11.7,-38.2,18.5|',
  '-12.7,-45.2,18.5 -8.6,-45.3,18.5 -0.6,-45.3,18.5 3.6,-45.4,18.5 11.7,-45.4,18.5 11.7,-49.1,18.5 -28.6,-49.2,18.5 -28.6,-46.1,18.5 -33,-46.1,18.5 -33,-45.2,18.5|',
  '-12.7,-45.2,18.5 -12.7,-38,18.5 -20.8,-38,18.5 -20.8,-45.2,18.5 -33,-45.2,18.5 -33,-35.2,18.5 -24.4,-35.2,18.5 -24.5,-37.1,18.5 -21.4,-37.1,18.5 -21.4,-35.1,18.5 -12.2,-35.1,18.5 -12.2,-37.1,18.5 -9.1,-37.1,18.5 -9.1,-35.1,18.5 -0.1,-35.1,18.5 -0.1,-37.1,18.5 3,-37.1,18.5 3,-35.1,18.5 12,-35.1,18.5 12,-37.1,18.5 11.7,-38.2,18.5 3.6,-38.2,18.5 3.6,-45.4,18.5 -0.6,-45.3,18.5 -0.6,-38.1,18.5 -8.6,-38.1,18.5 -8.6,-45.3,18.5|',
  '3.5,7.1,18.5 3.3,5.3,18.5 0.5,5.3,18.5 0.5,14.7,18.5 3.3,14.7,18.5 3.5,14.3,18.5|',
  '11.6,14.3,18.5 3.5,14.3,18.5 3.3,14.7,18.5 3.3,16.8,18.5 12.4,16.8,18.5 12.4,14.7,18.5 15.3,14.7,18.5 15.3,16.8,18.5 24,16.8,18.5 24,14,18.5 15.9,14,18.5 15.9,6.8,18.5 24,6.8,18.5 23.9,5.2,18.5 23.9,3.3,18.5 15.3,3.3,18.5 15.3,5.3,18.5 3.3,5.3,18.5 3.5,7.1,18.5 11.6,7.1,18.5|',
  '-12.6,13.8,18.5 -11.9,14.7,18.5 -9,14.7,18.5 -9,5.3,18.5 -12,5.3,18.5 -12.6,6.6,18.5|',
  '-46.5,8.3,37.8 -46.2,9.4,38 -45.9,10.7,38.1 -46.2,11.7,38 -46.4,12.5,37.8 -47,13.6,37.5 -39.4,5.9,41.7 -39.4,-38.1,41.7 -46.9,-46.1,37.5 -46.5,-44.9,37.8 -46.2,-43.8,38 -46,-42.6,38.1 -46.2,-41.5,38 -46.5,-40.7,37.8 -47,-39.6,37.5 -47.8,-38.5,37 -48.6,-37.8,36.6 -49.5,-37.2,36.1 -49.4,5.1,36.1 -48.6,5.6,36.6 -47.9,6.2,37 -47,7.1,37.5|',
  '-49.5,-48.3,36.1 -48.3,-47.6,36.6 -47.7,-46.9,37 -46.9,-46.1,37.5 -39.4,-38.1,41.7 -34.2,-38.1,41.7 -34.2,-48.3,36.1|',
  '30.6,-38,41.7 38.5,-46.8,37 39.2,-47.5,36.5 40.3,-48.7,36.1 24.8,-48.8,36.1 24.8,-38,41.7|',
  '29.7,2.9,41.7 29.6,-34.7,41.7 24.8,-34.7,39.5 24.8,-34.1,39.5 23.9,-34.1,38.9 23.9,2.9,38.9|',
  '6.1,37,38.7 0.9,37,38.7 0.9,37.8,38.7 6.1,37.8,38.7|',
  '-4.2,28.1,41.2 -4.2,37,41.2 4.5,37,36.1 4.5,35,36.1 2.7,35,37.4|',
  '-7.6,37.8,47.2 -2.3,37.8,47.2 -2.3,37,47.2 -7.6,37,47.2|',
  '-14.2,37.8,38.4 -9.3,37.8,38.4 -9.3,37,38.4 -14.2,37,38.4|',
  '37.6,12.6,37.7 37.4,11.5,38 37.1,10.2,38.1 37.4,9.2,38 37.6,8.4,37.7 38.2,7.3,37.5 38.9,6.3,37 39.6,5.6,36.5 40.4,5,36.1 40.3,-37.3,36.1 39.6,-37.8,36.5 38.9,-38.4,37 38.1,-39.4,37.5 37.6,-40.5,37.7 37,-42.9,38.1 37.3,-44,37.9 37.6,-44.8,37.7 38,-45.9,37.5 38.5,-46.8,37 30.6,-38,41.7 30.6,6,41.7|',
  '-4.2,28.1,41.2 -11.3,34.9,37.4 -13.3,34.9,36.1 -13.3,37,36.1 -9.3,37,38.3 -7.6,37,39.3 -4.2,37,41.2|',
  '-38.6,5.1,42.8 -35.5,5.2,41.9 -33,5.2,41.2 -33,3,41.2 -38.6,3,42.8|',
  '29.7,2.9,42.8 23.9,2.9,41.2 23.9,5.2,41.2 26.6,5.2,41.9 29.7,5.2,42.8|',
  '0.5,16.8,34.2 0.5,3.3,34.2 -9,3.3,34.2 -9,16.8,34.2|-33,16.8,36.3 -32.9,26.1,36.3 24,26.2,36.3 24,16.8,36.3|',
  '-35.5,5.2,41.8 -35.5,26.1,41.8 -32.9,26.1,40.6 -33,16.8,40.6 -33,5.2,40.6|',
  '26.6,5.2,41.8 23.9,5.2,40.6 24,6.8,40.6 24,26.2,40.6 26.6,26.2,41.8|',
  '27.4,6,43.3 30.6,6,43.3 30.6,-38,43.3 24.8,-38,43.3 24.8,-36.9,43.3 29.6,-36.9,43.3 29.7,5.2,43.3 26.6,5.2,43.3 26.6,26.2,43.3 -35.5,26.1,43.3 -35.5,5.2,43.3 -38.6,5.1,43.3 -38.7,-37,43.3 -34.2,-37,43.3 -34.2,-38.1,43.3 -39.4,-38.1,43.3 -39.4,5.9,43.3 -36.2,5.9,43.3 -36.2,27,43.3 27.4,27.1,43.3|',
  '24.8,-37.4,44 23.9,-37.4,44 23.9,-35.1,43 23.9,-34.1,42.6 24.8,-34.1,42.6 24.8,-34.7,42.9|',
  '-33,-15.8,37.4 -24.4,-15.8,37.4 -24.4,-21.9,35.4 15.6,-21.9,35.5 15.6,-15.7,37.4 23.9,-15.7,37.4 23.9,-35.1,31.3 -21.4,-35.1,31.3 -24.4,-35.2,31.3 -33,-35.2,31.3|',
  '23.9,-41.5,40.4 24.8,-41.5,40.4 24.8,-48.8,37 24.8,-49.1,36.8 23.9,-49.1,36.8 23.9,-46,38.3|',
  '-33,-41.4,40.7 -33,-46.1,38.6 -33,-49.2,37.1 -34.2,-49.2,37.1 -34.2,-48.3,37.6 -34.2,-41.4,40.7|',
  '-33,-37.5,44.5 -34.2,-37.6,44.5 -34.2,-33.9,42.7 -33,-33.9,42.7 -33,-35.2,43.3|',
  '-34.2,-41.4,42.7 -34.2,-38.1,44.3 -34.2,-37.6,44.5 -33,-37.5,44.5 -33,-41.4,42.7|',
  '24.8,-37.4,44 24.8,-38,43.8 24.8,-41.5,42.4 23.9,-41.5,42.4 23.9,-37.4,44|',
  '-38.6,3,41.7 -33,3,38.9 -33,-33.9,38.9 -34.2,-33.9,39.5 -34.2,-34.5,39.5 -38.7,-34.5,41.7|',
  '-33,-15.8,37.4 -33,3.3,31.3 23.9,3.3,31.3 23.9,2.9,31.5 23.9,-15.7,37.4 15.6,-15.7,37.4 15.6,-9.5,35.4 -24.4,-9.5,35.4 -24.4,-15.8,37.4|',
  '40.3,-37.3,36.1 40.9,-37.3,36.1 40.9,-38.6,37.4 40.9,-39.4,37.9 40.9,-40.5,38.2 40.9,-40.7,38.3 40.9,-42.9,38.5 40.9,-44,38.4 40.9,-44.8,38.2 40.9,-45.8,37.9 40.9,-46.8,37.4 40.9,-47.5,37 40.9,-48.7,36.1 40.3,-48.7,36.1 40.3,-47.5,37 40.3,-46.8,37.4 40.3,-45.8,37.9 40.3,-44.8,38.2 40.3,-44,38.4 40.3,-42.9,38.5 40.3,-41.7,38.4 40.3,-40.5,38.2 40.3,-39.4,37.9 40.3,-38.6,37.4|',
  '40.9,-48.7,36.1 40.9,-49.1,36.1 24.8,-49.1,36.1 24.8,-48.8,36.1|',
  '-20.6,6.6,18.5 -12.6,6.6,18.5 -12,5.3,18.5 -24.1,5.3,18.5 -24.2,3.3,18.5 -33,3.3,18.5 -33,6.9,18.5 -24.9,6.9,18.5 -24.9,14.1,18.5 -33,14.1,18.5 -33,16.8,18.5 -24.1,16.8,18.5 -24.1,14.7,18.5 -21.2,14.7,18.5 -21.2,16.8,18.5 -11.9,16.8,18.5 -11.9,14.7,18.5 -12.6,13.8,18.5 -20.6,13.8,18.5|',
  '-24.9,6.9,18.5 -33,6.9,18.5 -29,10.6,19.8|-24.9,14.1,18.5 -24.9,6.9,18.5 -29,10.6,19.8|',
  '-24.9,14.1,18.5 -29,10.6,19.8 -33,14.1,18.5|-33,6.9,18.5 -33,14.1,18.5 -29,10.6,19.8|',
  '27.4,27.1,41.7 -36.2,27,41.7 -4.2,28.1,41.2|',
  '27.4,27.1,41.7 -4.2,28.1,41.2 2.7,35,37.4 6.1,35,37.4 6.1,37,36.1 37.2,37,36.1'
].join('');

// The Helmsley Building's roof surfaces from the city's 3D building model (BIN 1036185), its grid frame (u east along the
// streets, v south, h over the ground), origin the compiled ring's vertex mean; the lantern and the pyramid are modelled.
const HM_ROOFS = [
  '45.5,18.9,65.2 31.5,18.8,65.2 31.5,27.7,65.2 45.6,27.7,65.2|',
  '33.9,8.7,65.4 28.9,8.7,65.4 28.9,16.8,65.4 33.9,16.8,65.4|',
  '49.2,-2.3,24.6 41.4,-2.3,24.6 41.4,3.3,24.6 49.2,3.3,24.6|38,-4.7,11.1 32,-4.7,11.1 32,6.5,11.1 38,6.5,11.1|',
  '52.6,-11.3,21.2 38,-11.4,21.2 38,6.5,21.2 38.7,6.5,21.2 38.7,12.4,21.2 52.7,12.4,21.2|',
  '37,-11.4,65.1 30.4,-11.4,65.1 30.4,-8.6,65.1 37,-8.6,65.1|',
  '49.9,-23.3,66.1 46.4,-23.3,66.1 46.4,-17.3,66.1 49.9,-17.3,66.1|',
  '37,-18.2,70.6 29.9,-18.2,70.6 29.9,-11.4,70.6 37,-11.4,70.6|',
  '45.1,-23.2,65.9 38.1,-23.2,65.9 38.1,-17.6,65.9 45.1,-17.6,65.9|',
  '-17.2,10,66.7 -48.9,10,66.7 -48.9,27.6,66.7 -17.2,27.6,66.7|',
  '-30.5,-4,23.9 -34.1,-4,23.9 -34.1,6.1,23.9 -30.5,6.1,23.9|',
  '-34.1,-4,28.4 -41.7,-4,28.4 -41.7,6.1,28.4 -34.1,6.1,28.4|',
  '24.4,-21.8,144.3 -10.3,-21.9,144.3 -10.3,19,144.3 24.5,19.1,144.3|',
  '26.6,-23.8,125.1 -12.7,-23.8,125.1 -12.6,20.6,125.1 26.7,20.7,125.1|',
  '-18.4,-6.4,21.1 -51.5,-6.4,21.1 -51.5,8.5,21.1 -18.4,8.6,21.1|',
  '-17.2,-29.6,21.8 -17.2,-28.9,21.8 -17,-27.7,21.8 -16.7,-27.1,21.8 -16.5,-26.6,21.8 -16.2,-26.1,21.8 -15.8,-25.6,21.8 -15.4,-25.2,21.8 -14.4,-24.4,21.8 -13.9,-24.2,21.8 -13.3,-23.9,21.8 -12.7,-23.8,21.8 26.6,-23.8,21.8 27.1,-23.9,21.8 27.7,-24.1,21.8 28.2,-24.4,21.8 29.1,-25.1,21.8 29.5,-25.5,21.8 30.1,-26.5,21.8 30.5,-27.5,21.8 30.7,-28.7,21.8 30.7,-29.2,21.8 30.6,-29.6,21.8|',
  '-21.2,-27.6,66.8 -50.4,-27.6,66.8 -50.4,-8.1,66.8 -21.2,-8.1,66.8|',
  '-34.6,-29.6,62.1 -51.5,-29.7,62.1 -51.5,-6.4,62.1 -18.4,-6.4,62.1 -18.4,8.6,62.1 -51.5,8.5,62.1 -51.5,30.9,62.1 -37.7,30.9,62.1 8.8,31,62.1 52.7,31,62.1 52.7,12.4,62.1 38.7,12.4,62.1 38.7,6.5,62.1 32,6.5,62.1 32,-4.7,62.1 38,-4.7,62.1 38,-11.4,62.1 52.6,-11.3,62.1 52.6,-29.6,62.1 30.6,-29.6,62.1 30.7,-29.2,62.1 30.7,-28.7,62.1 30.5,-27.5,62.1 30.1,-26.5,62.1 29.5,-25.5,62.1 29.1,-25.1,62.1 28.2,-24.4,62.1 27.7,-24.1,62.1 27.1,-23.9,62.1 26.6,-23.8,62.1 26.7,20.7,62.1 -12.6,20.6,62.1 -12.7,-23.8,62.1 -13.3,-23.9,62.1 -13.9,-24.2,62.1 -14.4,-24.4,62.1 -15.4,-25.2,62.1 -15.8,-25.6,62.1 -16.2,-26.1,62.1 -16.5,-26.6,62.1 -16.7,-27.1,62.1 -17,-27.7,62.1 -17.2,-28.9,62.1 -17.2,-29.6,62.1'
].join('');
