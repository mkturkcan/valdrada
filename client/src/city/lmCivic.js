// lmCivic.js: the civic centre round City Hall Park on their compiled footprint rings (LM63, 2026-10-30).
// The old builders were boxes with a flat colour (the Municipal Building, 8 Spruce Street) or nothing at all (City Hall drew
// as a generic 10-storey extrusion of its whole plan, 36.6 m tall); the City Hall diorama frames all three from 300-600 m,
// where what reads is the massing, the window rhythm, the mouldings, the colonnades and the crowns.
//   buildCityHall: Mangin and McComb, 1812. Two storeys of marble on a low base over the H plan of the ring (the wings and the
//     portico are the ring's own projections), pilasters on the south front, a balustrade round the roof, the portico's two
//     orders of columns and its steps, and the cupola: a square clock stage, a colonnaded drum, the dome and Justice.
//   buildMunicipal: McKim, Mead and White, 1914. The C of the ring in three bands (a granite base behind a Corinthian screen
//     along the forecourt, with the arch over Chambers Street; a limestone shaft; an attic of engaged columns under the main
//     cornice) and the tower over the arch: two square stages, corner turrets, two colonnaded drums, the lantern and Civic Fame.
//   build8Spruce: Gehry, 2011. A brick school podium on the whole lot and the stainless tower over it, rippled on every face but
//     the flat one on Spruce Street, stepping back toward the top.
// All of it merged per material with lmFacadeKit.js (facade tiles with bump maps, mouldings swept round rings).
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import {
  Acc, wallRing, capRing, loft, box, cyl, lathe, facadeTex, facadeMat, punchedPainter, offsetRing, ringOutSign, addMeshes,
  triCount, rgbs, speckle, streaks,
} from './lmFacadeKit.js';

const { mat } = KIT;

/* ------------------------------------------------------------------ frames */
// the dominant wall direction of a ring (edge angles folded into 90 degrees, weighted by length); A the long axis, S the
// perpendicular toward `out` (a world xz direction), u and v measured from the middle of the ring's extent
function gridFrame(ring, out) {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const t = Math.atan2(ez, ex) * 4;
    sx += L * Math.cos(t); sy += L * Math.sin(t);
  }
  const th = Math.atan2(sy, sx) / 4;
  let A = [Math.cos(th), Math.sin(th)], P = [-Math.sin(th), Math.cos(th)];
  const span = (d) => { let lo = 1e9, hi = -1e9; for (const p of ring) { const s = p[0] * d[0] + p[1] * d[1]; lo = Math.min(lo, s); hi = Math.max(hi, s); } return [lo, hi]; };
  if (span(P)[1] - span(P)[0] > span(A)[1] - span(A)[0]) [A, P] = [P, A];
  let S = P;
  if (S[0] * out[0] + S[1] * out[1] < 0) S = [-S[0], -S[1]];
  const [a0, a1] = span(A), [s0, s1] = span(S);
  const M = [A[0] * (a0 + a1) / 2 + S[0] * (s0 + s1) / 2, A[1] * (a0 + a1) / 2 + S[1] * (s0 + s1) / 2];
  const P_ = (u, v) => [M[0] + A[0] * u + S[0] * v, M[1] + A[1] * u + S[1] * v];
  const UV = (p) => [(p[0] - M[0]) * A[0] + (p[1] - M[1]) * A[1], (p[0] - M[0]) * S[0] + (p[1] - M[1]) * S[1]];
  return { A, S, M, P: P_, UV, u0: a0 - (a0 + a1) / 2, u1: a1 - (a0 + a1) / 2, v0: s0 - (s0 + s1) / 2, v1: s1 - (s0 + s1) / 2, rot: Math.atan2(-A[1], A[0]) };
}
// the ring's edges with their outward normals, lengths and frame coordinates
function edgesOf(ring, F) {
  const s = ringOutSign(ring), out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.05) continue;
    const n = [s * ez / L, -s * ex / L];
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    out.push({ i, a, b, L, n, d: [ex / L, ez / L], m, um: F ? F.UV(m)[0] : 0, vm: F ? F.UV(m)[1] : 0, fs: F ? n[0] * F.S[0] + n[1] * F.S[1] : 0, fa: F ? n[0] * F.A[0] + n[1] * F.A[1] : 0 });
  }
  return out;
}
function inRing(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function segDist(p, a, b) {
  const abx = b[0] - a[0], abz = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * abz) / (abx * abx + abz * abz || 1)));
  return Math.hypot(p[0] - a[0] - t * abx, p[1] - a[1] - t * abz);
}
// the point of the ring farthest from its walls (1 m grid, then 0.25 m round the best): the thickest part of a C or an L
function pole(ring) {
  let best = { r: -1, p: [0, 0], e: 0 };
  const test = (x, z) => {
    if (!inRing(ring, x, z)) return;
    let r = 1e9, e = 0;
    for (let i = 0; i < ring.length; i++) { const d = segDist([x, z], ring[i], ring[(i + 1) % ring.length]); if (d < r) { r = d; e = i; } }
    if (r > best.r) best = { r, p: [x, z], e };
  };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let x = x0; x <= x1; x += 1) for (let z = z0; z <= z1; z += 1) test(x, z);
  const [px, pz] = best.p;
  for (let x = px - 1; x <= px + 1; x += 0.25) for (let z = pz - 1; z <= pz + 1; z += 0.25) test(x, z);
  return best;
}
// a ring without the vertices whose corner cuts less than minA m2 (the survey's jogs at a tower's base)
function simplify(ring, minA = 25) {
  let r = ring.slice();
  for (let pass = 0; pass < 8 && r.length > 4; pass++) {
    let bi = -1, bA = minA;
    for (let i = 0; i < r.length; i++) {
      const a = r[(i - 1 + r.length) % r.length], b = r[i], c = r[(i + 1) % r.length];
      const A2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
      if (A2 < bA) { bA = A2; bi = i; }
    }
    if (bi < 0) break;
    r.splice(bi, 1);
  }
  return r;
}
// each edge moved in by its own distance (d[i] for the edge from vertex i to i+1), the corners where the moved lines meet
function insetEdges(ring, d) {
  const s = ringOutSign(ring), n = ring.length, L_ = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    const nx = s * ez / L, nz = -s * ex / L;
    L_.push({ p: [a[0] - nx * d[i], a[1] - nz * d[i]], t: [ex / L, ez / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = L_[(i - 1 + n) % n], B = L_[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-3) { out.push(B.p); continue; }
    const wx = B.p[0] - A.p[0], wz = B.p[1] - A.p[1], k = (wx * B.t[1] - wz * B.t[0]) / den;
    out.push([A.p[0] + A.t[0] * k, A.p[1] + A.t[1] * k]);
  }
  return out;
}
function convexHull(ring) {
  const p = ring.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], hi = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}
const ringOf = (ctx, w, d) => (ctx.footprint && ctx.footprint.length >= 4 ? ctx.footprint
  : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]);

/* ------------------------------------------------------------ shared parts */
const PROF = {
  cornice: [[0, 0], [0.3, 0], [0.3, 0.14], [0.66, 0.14], [0.66, 0.3], [1.02, 0.3], [1.02, 0.56], [1.2, 0.64], [1.2, 0.98], [0.9, 0.98], [0.9, 1.12], [0, 1.12]],
  corniceS: [[0, 0], [0.22, 0], [0.22, 0.12], [0.5, 0.12], [0.5, 0.26], [0.78, 0.26], [0.78, 0.46], [0.9, 0.52], [0.9, 0.8], [0.68, 0.8], [0.68, 0.9], [0, 0.9]],
  string: [[0, 0], [0.22, 0], [0.22, 0.1], [0.34, 0.1], [0.34, 0.42], [0, 0.42]],
  rail: [[0, 0], [0.16, 0], [0.16, 0.2], [0, 0.2]],
};
// a column: base, shaft (faceted: the flutes at 100 m), capital, abacus; returns its height
function column(acc, x, y0, z, r, h, rot = 0, corinth = false) {
  cyl(acc, x, y0, z, r * 1.25, r * 1.32, 0.3, 12, rot);
  cyl(acc, x, y0 + 0.3, z, r * 0.86, r, h - (corinth ? 1.2 : 0.75), 14, rot, false, true);
  const yc = y0 + h - (corinth ? 0.9 : 0.45);
  if (corinth) cyl(acc, x, yc, z, r * 1.38, r * 0.92, 0.6, 12, rot);
  else cyl(acc, x, yc, z, r * 1.3, r * 1.0, 0.3, 12, rot);
  box(acc, x, y0 + h - 0.3, z, r * 2.9, 0.3, r * 2.9, rot);
  return h;
}
// a balustrade along a ring at y: base rail, balusters ~0.42 m apart, pedestals every `ped` m, top rail; height 1.1
function balustrade(acc, ring, y, ped = 3.6) {
  loft(acc, ring, y, PROF.rail, true);
  loft(acc, ring, y + 0.9, PROF.rail, true);
  const s = ringOutSign(ring);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.6) continue;
    const nx = s * ez / L, nz = -s * ex / L, rot = Math.atan2(-ez, ex);
    const nb = Math.max(1, Math.round(L / 0.42));
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) / nb, x = a[0] + ex * t + nx * 0.08, z = a[1] + ez * t + nz * 0.08;
      lathe(acc, x, y + 0.2, z, [[0.07, 0], [0.11, 0.12], [0.06, 0.34], [0.05, 0.6], [0.08, 0.66], [0.08, 0.7], [0, 0.7]], 5);
    }
    const np = Math.max(1, Math.round(L / ped));
    for (let k = 0; k <= np; k++) {
      const t = k / np, x = a[0] + ex * t + nx * 0.08, z = a[1] + ez * t + nz * 0.08;
      box(acc, x, y, z, 0.42, 1.18, 0.42, rot);
    }
  }
}
// a standing figure on a pedestal (Justice, Civic Fame): a robed body spun round the axis, the head, an arm raised; h tall
function figure(acc, x, y0, z, h, rot = 0, raise = 1) {
  const k = h / 3.0;
  lathe(acc, x, y0, z, [[0.36 * k, 0], [0.42 * k, 0.5 * k], [0.36 * k, 1.1 * k], [0.27 * k, 1.6 * k], [0.3 * k, 1.95 * k], [0.24 * k, 2.15 * k],
    [0.1 * k, 2.3 * k], [0.15 * k, 2.42 * k], [0.15 * k, 2.68 * k], [0.08 * k, 2.8 * k], [0, 2.82 * k]], 10, rot);
  const c = Math.cos(rot), s = Math.sin(rot);
  box(acc, x + c * 0.3 * k, y0 + 2.0 * k, z - s * 0.3 * k, 0.12 * k, 0.95 * k * raise, 0.12 * k, rot, -0.35);      // the raised arm
  box(acc, x - c * 0.32 * k, y0 + 1.35 * k, z + s * 0.32 * k, 0.11 * k, 0.75 * k, 0.11 * k, rot, 0.25);            // the lowered arm
  box(acc, x + c * 0.55 * k, y0 + 2.85 * k, z - s * 0.55 * k, 0.75 * k, 0.04 * k, 0.04 * k, rot);                 // what it holds up
}

/* --------------------------------------------------------- facade painters */
// a marble bay of City Hall: j 0 the upper floor (a square-headed window with a cornice on consoles), j 1 the main floor
// (a round-headed window in an arched recess with a keystone); 6-over-6 sashes, the panes dark, the frames white
function chPainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    const tone = 1 + (r() - 0.5) * 0.06;
    g.fillStyle = rgbs(o.wall, tone); g.fillRect(x, y, w, h);
    // ashlar joints every ~0.6 m (h is one floor, ~6 m)
    const nc = 10;
    g.fillStyle = rgbs(o.wall, 0.9); gb.fillStyle = 'rgb(118,118,118)';
    for (let c = 1; c < nc; c++) {
      const yy = y + Math.round((c * h) / nc);
      g.fillRect(x, yy, w, 1); gb.fillRect(x, yy, w, 1);
      const off = (c % 2) * w * 0.5;
      for (let q = 0; q < 3; q++) { const xx = x + ((off + q * w * 0.5) % w); g.fillRect(xx, yy - Math.round(h / nc), 1, Math.round(h / nc)); }
    }
    speckle(g, x, y, w, h, r, 40, 0.05);
    const ww = w * 0.4, wx = x + (w - ww) / 2;
    if (j === 1) {
      // the arched recess, the window in it
      const rh = h * 0.7, ry = y + h * 0.17, rw = w * 0.56, rx = x + (w - rw) / 2;
      gb.fillStyle = 'rgb(112,112,112)'; g.fillStyle = rgbs(o.wall, 0.93);
      g.beginPath(); g.moveTo(rx, ry + rh); g.lineTo(rx, ry + rw / 2); g.arc(rx + rw / 2, ry + rw / 2, rw / 2, Math.PI, 0); g.lineTo(rx + rw, ry + rh); g.closePath(); g.fill();
      gb.beginPath(); gb.moveTo(rx, ry + rh); gb.lineTo(rx, ry + rw / 2); gb.arc(rx + rw / 2, ry + rw / 2, rw / 2, Math.PI, 0); gb.lineTo(rx + rw, ry + rh); gb.closePath(); gb.fill();
      const wh = h * 0.6, wy = y + h * 0.23;
      const path = (c) => { c.beginPath(); c.moveTo(wx, wy + wh); c.lineTo(wx, wy + ww / 2); c.arc(wx + ww / 2, wy + ww / 2, ww / 2, Math.PI, 0); c.lineTo(wx + ww, wy + wh); c.closePath(); };
      g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.3); path(g); g.fill();
      gb.fillStyle = 'rgb(70,70,70)'; path(gb); gb.fill();
      g.strokeStyle = rgbs(o.sash); g.lineWidth = Math.max(1, w * 0.02);
      for (let q = 1; q < 3; q++) { g.beginPath(); g.moveTo(wx + (q * ww) / 3, wy + ww * 0.2); g.lineTo(wx + (q * ww) / 3, wy + wh); g.stroke(); }
      for (let q = 1; q < 4; q++) { const yy = wy + ww / 2 + ((wh - ww / 2) * q) / 4; g.beginPath(); g.moveTo(wx, yy); g.lineTo(wx + ww, yy); g.stroke(); }
      g.fillStyle = rgbs(o.trim); g.fillRect(rx + rw / 2 - w * 0.04, ry - h * 0.005, w * 0.08, h * 0.07);       // the keystone
      gb.fillStyle = 'rgb(190,190,190)'; gb.fillRect(rx + rw / 2 - w * 0.04, ry - h * 0.005, w * 0.08, h * 0.07);
      g.fillStyle = rgbs(o.trim); g.fillRect(rx - w * 0.02, wy + wh, rw + w * 0.04, h * 0.03);                   // the sill
      gb.fillRect(rx - w * 0.02, wy + wh, rw + w * 0.04, h * 0.03);
    } else {
      const wh = h * 0.5, wy = y + h * 0.3;
      g.fillStyle = rgbs(o.trim); g.fillRect(wx - w * 0.06, wy - h * 0.08, ww + w * 0.12, h * 0.07);            // the cornice over it
      gb.fillStyle = 'rgb(196,196,196)'; gb.fillRect(wx - w * 0.06, wy - h * 0.08, ww + w * 0.12, h * 0.07);
      g.fillRect(wx - w * 0.05, wy - h * 0.012, w * 0.05, wh + h * 0.02); g.fillRect(wx + ww, wy - h * 0.012, w * 0.05, wh + h * 0.02);   // the surround
      gb.fillStyle = 'rgb(168,168,168)'; gb.fillRect(wx - w * 0.05, wy - h * 0.012, w * 0.05, wh + h * 0.02); gb.fillRect(wx + ww, wy - h * 0.012, w * 0.05, wh + h * 0.02);
      g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.3); g.fillRect(wx, wy, ww, wh);
      gb.fillStyle = 'rgb(70,70,70)'; gb.fillRect(wx, wy, ww, wh);
      g.strokeStyle = rgbs(o.sash); g.lineWidth = Math.max(1, w * 0.02);
      for (let q = 1; q < 3; q++) { g.beginPath(); g.moveTo(wx + (q * ww) / 3, wy); g.lineTo(wx + (q * ww) / 3, wy + wh); g.stroke(); }
      for (let q = 1; q < 4; q++) { const yy = wy + (wh * q) / 4; g.beginPath(); g.moveTo(wx, yy); g.lineTo(wx + ww, yy); g.stroke(); }
      g.fillStyle = rgbs(o.trim); g.fillRect(wx - w * 0.05, wy + wh, ww + w * 0.1, h * 0.035);
      gb.fillStyle = 'rgb(186,186,186)'; gb.fillRect(wx - w * 0.05, wy + wh, ww + w * 0.1, h * 0.035);
    }
    streaks(g, x, y, w, h, r, 3, 0.05);
  };
}
// a bay of 8 Spruce Street: per floor a stainless spandrel band and the vision glass, a mullion every half bay
function spPainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.steel, 1 + (r() - 0.5) * 0.08); g.fillRect(x, y, w, h);
    for (let q = 0; q < 14; q++) { g.fillStyle = `rgba(255,255,255,${(r() * 0.05).toFixed(3)})`; g.fillRect(x + r() * w, y, 1, h); }   // the brushing
    const gy = y + h * 0.1, gh = h * 0.52;
    g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.25); g.fillRect(x, gy, w, gh);
    const grd = g.createLinearGradient(x, gy, x, gy + gh); grd.addColorStop(0, 'rgba(210,225,235,0.18)'); grd.addColorStop(1, 'rgba(210,225,235,0)');
    g.fillStyle = grd; g.fillRect(x, gy, w, gh);
    gb.fillStyle = 'rgb(118,118,118)'; gb.fillRect(x, gy, w, gh);
    g.fillStyle = rgbs(o.steel, 1.06);
    for (let q = 0; q <= 2; q++) g.fillRect(x + (q * w) / 2 - 1, gy, 3, gh);
    gb.fillStyle = 'rgb(160,160,160)';
    for (let q = 0; q <= 2; q++) gb.fillRect(x + (q * w) / 2 - 1, gy, 3, gh);
    g.fillStyle = rgbs(o.steel, 0.82); g.fillRect(x, gy + gh, w, 2);
  };
}

/* ---------------------------------------------------------------- materials */
let _CH = null, _MB = null, _SP = null;
const MARBLE = [232, 227, 214], LIMEST = [224, 219, 205];
function chMats() {
  if (_CH) return _CH;
  const tex = facadeTex('ch-front', { nx: 4, ny: 2, cw: 128, ch: 208, seed: 63, base: MARBLE,
    paint: chPainter({ wall: MARBLE, trim: [242, 239, 230], glass: [40, 48, 56], sash: [236, 234, 228] }) });
  const stone = { set: 'climestone', amt: 0.35, nrm: 0.5, rgh: 0.3, ashlar: 0.5 };
  _CH = {
    tex,
    wall: facadeMat('ch-front', tex, { rough: 0.7, bump: 1.8 }),
    stone: mat(0xe9e5da, { rough: 0.72, flat: false, stone }),
    base: mat(0xbdb7aa, { rough: 0.85, flat: false, stone: { ...stone, set: 'cgranite' } }),
    roof: mat(0x5b5f5c, { rough: 0.8, flat: false }),
    copper: mat(0x6f8a7c, { rough: 0.6, metal: 0.15, flat: false }),
    dark: mat(0x23282c, { rough: 0.5, flat: false }),
    clock: mat(0xf1eee4, { rough: 0.5, flat: false }),
    gilt: mat(0xb8913e, { rough: 0.35, metal: 0.8, flat: false }),
  };
  return _CH;
}
function mbMats() {
  if (_MB) return _MB;
  const base = facadeTex('mb-base', { nx: 4, ny: 4, cw: 128, ch: 150, seed: 64, base: [196, 192, 182],
    paint: punchedPainter({ wall: [196, 192, 182], trim: [214, 210, 200], win: [0.5, 0.6], winY: 0.16, bars: 'tri', brick: 0, rustic: 26, tone: 0.03, keystone: 1 }) });
  const shaft = facadeTex('mb-shaft', { nx: 4, ny: 4, cw: 112, ch: 150, seed: 65, base: LIMEST,
    paint: punchedPainter({ wall: LIMEST, trim: [234, 230, 218], win: [0.46, 0.6], winY: 0.17, bars: 'dh', brick: 0, tone: 0.03 }) });
  const attic = facadeTex('mb-attic', { nx: 4, ny: 3, cw: 112, ch: 170, seed: 66, base: LIMEST,
    paint: punchedPainter({ wall: LIMEST, trim: [234, 230, 218], win: [0.5, 0.7], winY: 0.12, bars: 'tri', brick: 0, tone: 0.03 }) });
  const stone = { set: 'climestone', amt: 0.4, nrm: 0.55, rgh: 0.3, ashlar: 0.6 };
  _MB = {
    tx: { base, shaft, attic },
    base: facadeMat('mb-base', base, { rough: 0.84, bump: 2.0 }),
    shaft: facadeMat('mb-shaft', shaft, { rough: 0.84, bump: 1.9 }),
    attic: facadeMat('mb-attic', attic, { rough: 0.84, bump: 2.0 }),
    stone: mat(0xe0dbcc, { rough: 0.8, flat: false, stone }),
    granite: mat(0xa8a499, { rough: 0.86, flat: false, stone: { ...stone, set: 'cgranite' } }),
    roof: mat(0x5a5c5e, { rough: 0.85, flat: false }),
    dark: mat(0x1e2226, { rough: 0.6, flat: false }),
    gilt: mat(0xc9a24a, { rough: 0.3, metal: 0.85, flat: false }),
  };
  return _MB;
}
function spMats() {
  if (_SP) return _SP;
  const steel = facadeTex('sp-steel', { nx: 4, ny: 2, cw: 96, ch: 150, seed: 67, base: [198, 202, 206],
    paint: spPainter({ steel: [214, 218, 222], glass: [92, 106, 118] }) });
  const brick = facadeTex('sp-brick', { nx: 4, ny: 2, cw: 128, ch: 150, seed: 68, base: [148, 74, 56],
    paint: punchedPainter({ wall: [148, 74, 56], trim: [176, 162, 144], win: [0.56, 0.56], winY: 0.2, bars: 'case', brick: 5, tone: 0.05 }) });
  _SP = {
    tx: { steel, brick },
    steel: facadeMat('sp-steel', steel, { rough: 0.3, metal: 0.25, bump: 1.2 }),
    brick: facadeMat('sp-brick', brick, { rough: 0.9, bump: 2.0 }),
    cap: mat(0xc9ccd0, { rough: 0.45, metal: 0.1, flat: false }),
    stone: mat(0xb9b0a2, { rough: 0.85, flat: false }),
    roof: mat(0x55585b, { rough: 0.85, flat: false }),
  };
  return _SP;
}

/* -------------------------------------------------------------- City Hall */
export function buildCityHall(ctx) {
  const g = new THREE.Group();
  const ring = ringOf(ctx, 66, 32);
  const M = chMats();
  const F = gridFrame(ring, [0, 1]);   // the front (the wings, the portico) faces down the park, to the south
  const H = Math.max(30, Math.min(45, ctx.height || 36.6));
  const yP = 1.3, y1 = 7.6, y2 = 13.4, yR = y2 + 1.12;   // the base, the string course, the cornice, the roof
  const W = new Acc(), ST = new Acc(), BS = new Acc(), RF = new Acc(), CU = new Acc(), DK = new Acc(), CL = new Acc(), GI = new Acc();
  // the walls: two storeys of marble bays on a granite base, the string course, the entablature, the balustrade, the roof
  loft(BS, ring, -0.6, [[0, 0], [0.32, 0], [0.32, yP + 0.6], [0, yP + 0.6]], false);
  wallRing(W, ring, yP, y2, M.tex, { bayW: 3.6, floorH: (y2 - yP) / 2, vRef: yP });
  loft(ST, ring, y1 - 0.25, PROF.string, false);
  loft(ST, ring, y2, PROF.cornice, false);
  balustrade(ST, offsetRing(ring, -0.25), yR);
  capRing(RF, offsetRing(ring, -0.3), yR + 0.02);
  const E = edgesOf(ring, F);
  // pilasters on the south front and the ends of the wings, at the bays' edges: Ionic below, Corinthian above
  for (const e of E) {
    if (e.fs < 0.7 && Math.abs(e.fa) < 0.7) continue;
    if (Math.abs(e.fa) >= 0.7 && e.vm < F.v1 - 20) continue;   // the wings' ends only, not the back corners
    const nb = Math.max(1, Math.round(e.L / 3.6)), rot = Math.atan2(-e.d[1], e.d[0]);
    for (let k = 0; k <= nb; k++) {
      const t = k / nb, x = e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * 0.14, z = e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * 0.14;
      box(ST, x, yP, z, 0.72, y1 - 0.25 - yP, 0.28, rot);
      box(ST, x, y1 - 0.62, z, 0.9, 0.37, 0.4, rot);
      box(ST, x, y1 + 0.17, z, 0.66, y2 - y1 - 0.17, 0.26, rot);
      box(ST, x, y2 - 0.55, z, 0.86, 0.55, 0.38, rot);
    }
  }
  // the portico: the middle front edge, two orders of paired columns, the balcony between, its own cornice and balustrade, steps
  const front = E.filter((e) => e.fs > 0.9 && Math.abs(e.um) < 0.2 * (F.u1 - F.u0) && e.L > 8).sort((a, b) => b.vm - a.vm)[0];
  let cu = 0, vP = 0;
  if (front) {
    const [ua, va] = F.UV(front.a), [ub] = F.UV(front.b);
    const pu0 = Math.min(ua, ub), pu1 = Math.max(ua, ub), pw = pu1 - pu0;
    cu = (pu0 + pu1) / 2; vP = va;
    const vc = vP + 1.7;
    const pairs = [-0.39, -0.13, 0.13, 0.39].map((f) => cu + f * pw);
    for (const pc of pairs) for (const dx of [-0.55, 0.55]) {
      const [x, z] = F.P(pc + dx, vc);
      column(ST, x, yP, z, 0.42, y1 - yP - 0.55, F.rot, false);
      column(ST, x, y1 + 0.25, z, 0.38, y2 - y1 - 0.25, F.rot, true);
    }
    const [bx, bz] = F.P(cu, vP + 1.25);
    box(ST, bx, y1 - 0.55, bz, pw, 0.8, 2.6, F.rot);                         // the balcony and the lower entablature
    box(ST, bx, y2, bz, pw + 0.4, 1.12, 3.0, F.rot);                         // the upper entablature
    for (let k = 0; k < 7; k++) {                                             // the steps
      const [x, z] = F.P(cu, vP + 2.75 + k * 0.38);
      box(BS, x, -0.4, z, pw * 0.86, yP + 0.4 - k * (yP / 7), 0.4 + 0.02, F.rot);
    }
    const [px, pz] = F.P(cu, vP + 1.4);
    box(BS, px, -0.4, pz, pw, yP + 0.4, 2.95, F.rot);                         // the porch floor
    balustrade(ST, [F.P(pu0 - 0.2, vP), F.P(pu1 + 0.2, vP), F.P(pu1 + 0.2, vP + 2.8), F.P(pu0 - 0.2, vP + 2.8)], yR);
  }
  // the cupola, over the middle of the main block behind the portico, its top at the record's height
  const vC = (F.v0 + (front ? vP : F.v1)) / 2;
  const [cx, cz] = F.P(cu, vC);
  const k = (H - yR) / 21.75;
  let y = yR;
  box(ST, cx, y, cz, 10.4, 0.9 * k, 10.4, F.rot); y += 0.9 * k;                                       // the plinth
  box(ST, cx, y, cz, 9.4, 4.3 * k, 9.4, F.rot);                                                       // the clock stage
  for (const [su, sv] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const [x, z] = F.P(cu + su * 4.55, vC + sv * 4.55);
    box(ST, x, y, z, 0.9, 4.3 * k, 0.9, F.rot);
  }
  for (const [du, dv] of [[0, 4.72], [0, -4.72], [4.72, 0], [-4.72, 0]]) {   // the four clocks
    const [x, z] = F.P(cu + du, vC + dv);
    const nrm = [F.A[0] * Math.sign(du) + F.S[0] * Math.sign(dv), F.A[1] * Math.sign(du) + F.S[1] * Math.sign(dv)];
    const yc = y + 2.4 * k;
    const g2 = new THREE.CylinderGeometry(1.25 * k, 1.25 * k, 0.12, 24);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nrm[0], 0, nrm[1]));
    CL.addGeo(g2, new THREE.Matrix4().compose(new THREE.Vector3(x + nrm[0] * 0.02, yc, z + nrm[1] * 0.02), q, new THREE.Vector3(1, 1, 1)));
    const g3 = new THREE.CylinderGeometry(1.42 * k, 1.42 * k, 0.1, 24);
    DK.addGeo(g3, new THREE.Matrix4().compose(new THREE.Vector3(x - nrm[0] * 0.01, yc, z - nrm[1] * 0.01), q, new THREE.Vector3(1, 1, 1)));
    g2.dispose(); g3.dispose();
  }
  y += 4.3 * k;
  box(ST, cx, y, cz, 10.0, 0.6 * k, 10.0, F.rot); y += 0.6 * k;                                       // its cornice
  const R = 3.35, Rc = 4.2, hc = 6.2 * k;
  cyl(ST, cx, y, cz, Rc + 0.55, Rc + 0.65, 0.4 * k, 32); y += 0.4 * k;
  cyl(DK, cx, y, cz, R, R, hc, 24);                                                                  // the drum behind its columns
  for (let q = 0; q < 12; q++) {
    const a = F.rot + (q + 0.5) * Math.PI / 6;
    column(ST, cx + Math.cos(a) * Rc, y, cz + Math.sin(a) * Rc, 0.3, hc, a, true);
  }
  for (let q = 0; q < 8; q++) {                                                                       // the drum's piers between its windows
    const a = F.rot + q * Math.PI / 4;
    box(ST, cx + Math.cos(a) * (R + 0.05), y, cz + Math.sin(a) * (R + 0.05), 1.1, hc, 0.3, -a + Math.PI / 2);
  }
  y += hc;
  lathe(ST, cx, y, cz, [[R - 0.2, 0], [Rc + 0.6, 0], [Rc + 0.6, 0.5 * k], [Rc + 0.85, 0.62 * k], [Rc + 0.85, 0.8 * k], [R - 0.2, 0.8 * k]], 32); y += 0.8 * k;
  balustrade(ST, Array.from({ length: 16 }, (_, q) => [cx + Math.cos(q * Math.PI / 8) * (Rc + 0.3), cz + Math.sin(q * Math.PI / 8) * (Rc + 0.3)]), y);
  cyl(ST, cx, y, cz, R + 0.2, R + 0.3, 0.5 * k, 32); y += 0.5 * k;                                     // the attic ring
  const kd = 3.55 * k;
  lathe(CU, cx, y, cz, [[3.6, 0], [3.5, 0.25 * kd], [3.15, 0.5 * kd], [2.55, 0.73 * kd], [1.7, 0.9 * kd], [0.75, 0.985 * kd], [0, kd]], 28);   // the dome
  y += kd * 0.94;
  cyl(ST, cx, y, cz, 0.75, 0.8, 1.2 * k, 12); y += 1.2 * k;                                             // the lantern
  cyl(CU, cx, y, cz, 0.3, 0.95, 0.3 * k, 12); y += 0.3 * k;
  cyl(GI, cx, y, cz, 0.42, 0.5, 0.4 * k, 10); y += 0.4 * k;
  figure(GI, cx, y, cz, H - y, F.rot);                                                                 // Justice
  addMeshes(g, [[W, M.wall, 'lm63:cityhall:walls'], [ST, M.stone, 'lm63:cityhall:stone'], [BS, M.base, 'lm63:cityhall:base'], [RF, M.roof, 'lm63:cityhall:roof'],
    [CU, M.copper, 'lm63:cityhall:dome'], [DK, M.dark, 'lm63:cityhall:dark'], [CL, M.clock, 'lm63:cityhall:clocks'], [GI, M.gilt, 'lm63:cityhall:justice']]);
  g.userData.colliderBoxes = [{ x: F.M[0], y: yR / 2, z: F.M[1], w: F.u1 - F.u0, h: yR, d: F.v1 - F.v0, rotY: F.rot }];
  g.userData.tris = triCount([[W], [ST], [BS], [RF], [CU], [DK], [CL], [GI]]);
  return g;
}

/* ----------------------------------------------------- the Municipal Building */
export function buildMunicipal(ctx) {
  const g = new THREE.Group();
  const ring = ringOf(ctx, 110, 30);
  const M = mbMats();
  const H = Math.max(120, ctx.height || 168.4);   // the record's height: the base of Civic Fame
  const k = H / 168.4;
  const yB = 22 * k, yS = 88 * k, yM = 101 * k;
  const WB = new Acc(), WS = new Acc(), WA = new Acc(), ST = new Acc(), GR = new Acc(), RF = new Acc(), DK = new Acc(), GI = new Acc();
  loft(GR, ring, -0.6, [[0, 0], [0.3, 0], [0.3, 1.8], [0, 1.8]], false);
  wallRing(WB, ring, 1.2, yB, M.tx.base, { bayW: 4.2, floorH: (yB - 1.2) / 4, vRef: 1.2 });
  loft(ST, ring, yB - 0.4, PROF.cornice, false);
  wallRing(WS, ring, yB + 0.72, yS, M.tx.shaft, { bayW: 2.6, floorH: 3.9 * k, vRef: yB + 0.72 });
  loft(ST, ring, yS, PROF.cornice.map(([d, h]) => [d * 1.6, h * 1.6]), false);
  wallRing(WA, ring, yS + 1.8, yM - 1.4, M.tx.attic, { bayW: 2.6, floorH: (yM - 1.4 - yS - 1.8) / 3, vRef: yS + 1.8 });
  loft(ST, ring, yM - 1.4, PROF.corniceS.map(([d, h]) => [d * 1.4, h * 1.4]), false);
  balustrade(ST, offsetRing(ring, -0.3), yM - 0.15);
  capRing(RF, offsetRing(ring, -0.3), yM - 0.12);
  // the forecourt: the concave edges (their middles over 3 m inside the ring's convex hull), the Corinthian screen along them
  const hull = convexHull(ring);
  const E = edgesOf(ring, null);
  const inner = E.filter((e) => e.L > 8 && Math.min(...hull.map((h, i) => segDist(e.m, h, hull[(i + 1) % hull.length]))) > 3);
  const hc = yB - 3.2;
  for (const e of inner) {
    const nb = Math.max(1, Math.round(e.L / 4.6)), rot = Math.atan2(-e.d[1], e.d[0]);
    for (let q = 0; q <= nb; q++) {
      const t = 0.04 + 0.92 * q / nb, x = e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * 1.5, z = e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * 1.5;
      column(ST, x, 1.2, z, 0.72, hc, rot, true);
    }
    const [x, z] = [e.m[0] + e.n[0] * 1.2, e.m[1] + e.n[1] * 1.2];
    box(ST, x, 1.2 + hc, z, e.L * 0.96, 2.0, 3.2, rot);                     // the screen's entablature
    box(ST, x, 1.2 + hc + 2.0, z, e.L * 0.96, 0.7, 3.6, rot);
    // the attic's engaged columns over the forecourt
    const na = Math.max(1, Math.round(e.L / 5.2));
    for (let q = 0; q <= na; q++) {
      const t = 0.04 + 0.92 * q / na, xa = e.a[0] + (e.b[0] - e.a[0]) * t + e.n[0] * 0.55, za = e.a[1] + (e.b[1] - e.a[1]) * t + e.n[1] * 0.55;
      column(ST, xa, yS + 1.8, za, 0.55, yM - 1.4 - yS - 1.8, rot, true);
    }
  }
  // the tower: on the thickest part of the C, square to its nearest wall, over the arch
  const P = pole(ring);
  const ea = ring[P.e], eb = ring[(P.e + 1) % ring.length];
  const dx = eb[0] - ea[0], dz = eb[1] - ea[1], dl = Math.hypot(dx, dz) || 1;
  const A = [dx / dl, dz / dl], rot = Math.atan2(-A[1], A[0]);
  const [tx, tz] = P.p;
  // the arch over Chambers Street: on the forecourt wall nearest the tower, a dark round-headed opening behind the screen
  const ae = inner.slice().sort((a, b) => segDist(P.p, a.a, a.b) - segDist(P.p, b.a, b.b))[0];
  if (ae) {
    const t = Math.max(0.2, Math.min(0.8, ((tx - ae.a[0]) * ae.d[0] + (tz - ae.a[1]) * ae.d[1]) / ae.L));
    const ox = ae.a[0] + ae.d[0] * ae.L * t + ae.n[0] * 0.06, oz = ae.a[1] + ae.d[1] * ae.L * t + ae.n[1] * 0.06;
    const aw = 11 * k, ay = 12.5 * k;
    const sh = new THREE.Shape();
    sh.moveTo(-aw / 2, 0); sh.lineTo(aw / 2, 0); sh.lineTo(aw / 2, ay); sh.absarc(0, ay, aw / 2, 0, Math.PI, false); sh.lineTo(-aw / 2, 0);
    const ag = new THREE.ShapeGeometry(sh, 16);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(ae.n[0], 0, ae.n[1]));
    DK.addGeo(ag, new THREE.Matrix4().compose(new THREE.Vector3(ox, 1.2, oz), q, new THREE.Vector3(1, 1, 1)));
    ag.dispose();
  }
  const s1 = Math.min(28, P.r * 1.42) * Math.min(1, k * 1.1);
  const sq = (s, y0, h, tex, o = {}) => {
    const c = Math.cos(rot), sn = Math.sin(rot);
    const r4 = [[-s / 2, -s / 2], [s / 2, -s / 2], [s / 2, s / 2], [-s / 2, s / 2]].map(([u, v]) => [tx + u * c + v * sn, tz - u * sn + v * c]);
    if (tex) wallRing(o.acc || WS, r4, y0, y0 + h, tex, { bayW: o.bayW || 2.6, floorH: 3.9 * k, vRef: y0 });
    return r4;
  };
  let y = yM;
  const r1 = sq(s1, y, 20 * k, M.tx.shaft); y += 20 * k;
  loft(ST, r1, y, PROF.cornice, true); balustrade(ST, offsetRing(r1, -0.3), y + 1.12); capRing(RF, r1, y + 1.1);
  for (const [cu, cv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {                       // the corner turrets
    const c = Math.cos(rot), sn = Math.sin(rot), u = cu * (s1 / 2 - 3.2), v = cv * (s1 / 2 - 3.2);
    const x = tx + u * c + v * sn, z = tz - u * sn + v * c, yt = y + 1.1;
    cyl(ST, x, yt, z, 2.4, 2.5, 0.5, 16);
    for (let m = 0; m < 6; m++) { const a = m * Math.PI / 3; column(ST, x + Math.cos(a) * 1.9, yt + 0.5, z + Math.sin(a) * 1.9, 0.22, 5.2 * k, a, true); }
    cyl(DK, x, yt + 0.5, z, 1.4, 1.4, 5.2 * k, 12);
    lathe(ST, x, yt + 0.5 + 5.2 * k, z, [[1.2, 0], [2.4, 0], [2.4, 0.6], [2.0, 0.7], [1.6, 1.6], [0.9, 2.3], [0.25, 2.7], [0.25, 3.6], [0, 3.9]], 12);
  }
  y += 1.1;
  const s2 = s1 * 0.62;
  const r2 = sq(s2, y, 13 * k, M.tx.attic, { acc: WA }); y += 13 * k;
  loft(ST, r2, y, PROF.corniceS, true); capRing(RF, r2, y + 0.9); y += 0.9;
  const Rd = s2 * 0.46, hd = 12 * k;
  cyl(ST, tx, y, tz, Rd + 0.9, Rd + 1.0, 0.7, 32); y += 0.7;
  cyl(DK, tx, y, tz, Rd - 1.3, Rd - 1.3, hd, 24);
  for (let m = 0; m < 16; m++) { const a = rot + (m + 0.5) * Math.PI / 8; column(ST, tx + Math.cos(a) * Rd, y, tz + Math.sin(a) * Rd, 0.5, hd, a, true); }
  y += hd;
  lathe(ST, tx, y, tz, [[Rd - 1.5, 0], [Rd + 0.75, 0], [Rd + 0.75, 0.9], [Rd + 1.05, 1.05], [Rd + 1.05, 1.4], [Rd - 1.5, 1.4]], 32); y += 1.4;
  const Ru = Rd * 0.66, hu = 7 * k;
  cyl(ST, tx, y, tz, Ru + 0.6, Ru + 0.7, 0.5, 24); y += 0.5;
  cyl(DK, tx, y, tz, Ru - 0.9, Ru - 0.9, hu, 20);
  for (let m = 0; m < 12; m++) { const a = rot + (m + 0.5) * Math.PI / 6; column(ST, tx + Math.cos(a) * Ru, y, tz + Math.sin(a) * Ru, 0.36, hu, a, true); }
  y += hu;
  lathe(ST, tx, y, tz, [[Ru - 1.0, 0], [Ru + 0.55, 0], [Ru + 0.55, 0.7], [Ru + 0.75, 0.8], [Ru + 0.75, 1.1], [Ru - 1.0, 1.1]], 24); y += 1.1;
  const hl = Math.max(4, H - y);                                                      // the lantern up to Civic Fame's feet
  lathe(ST, tx, y, tz, [[Ru * 0.92, 0], [Ru * 0.92, 0.14 * hl], [Ru * 0.74, 0.16 * hl], [Ru * 0.66, 0.42 * hl], [Ru * 0.5, 0.45 * hl], [Ru * 0.44, 0.66 * hl],
    [Ru * 0.3, 0.7 * hl], [Ru * 0.24, 0.88 * hl], [0.95, 0.92 * hl], [0.95, hl], [0, hl]], 24);
  y += hl;
  figure(GI, tx, y, tz, 7.6 * k, rot, 1.2);                                           // Civic Fame
  addMeshes(g, [[GR, M.granite, 'lm63:municipal:plinth'], [WB, M.base, 'lm63:municipal:base'], [WS, M.shaft, 'lm63:municipal:shaft'], [WA, M.attic, 'lm63:municipal:attic'],
    [ST, M.stone, 'lm63:municipal:stone'], [RF, M.roof, 'lm63:municipal:roof'], [DK, M.dark, 'lm63:municipal:dark'], [GI, M.gilt, 'lm63:municipal:fame']]);
  g.userData.colliderBoxes = [{ x: tx, y: yM / 2, z: tz, w: s1, h: yM, d: s1, rotY: rot }, { x: tx, y: (yM + H) / 2, z: tz, w: s2, h: H - yM, d: s2, rotY: rot }];
  g.userData.tris = triCount([[GR], [WB], [WS], [WA], [ST], [RF], [DK], [GI]]);
  return g;
}

/* ------------------------------------------------------------ 8 Spruce Street */
// one rippled face from a to b (outward normal n) between y0 and y1: per floor a row of vertices pushed out by a wave whose
// phase drifts from floor to floor (the bays' flowing folds), held flat over the last 3 m at each corner
function rippleWall(acc, a, b, n, y0, y1, fh, tex, seed, flat) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 0.5) return;
  const nc = Math.max(2, Math.ceil(L / 1.5)), nf = Math.max(1, Math.round((y1 - y0) / fh)), dy = (y1 - y0) / nf;
  const f0 = Math.round(y0 / fh);
  const off = (t, f) => {
    if (flat) return 0;
    const u = t * L, env = Math.min(1, u / 3, (L - u) / 3);
    const ph = 0.9 * Math.sin((f + f0) * 0.21 + seed) + 0.6 * Math.sin((f + f0) * 0.07 + 1.3 * seed);
    return 1.7 * env * (0.5 + 0.5 * Math.sin((2 * Math.PI * u) / 6.2 + ph * 2.2));
  };
  const P = [];
  for (let f = 0; f <= nf; f++) {
    const row = [];
    for (let c = 0; c <= nc; c++) {
      const t = c / nc, d = off(t, f);
      row.push([a[0] + (b[0] - a[0]) * t + n[0] * d, y0 + f * dy, a[1] + (b[1] - a[1]) * t + n[1] * d]);
    }
    P.push(row);
  }
  const N = (f, c) => {
    const p = P[f][c], pu = P[f][Math.min(nc, c + 1)], pd = P[f][Math.max(0, c - 1)], pv = P[Math.min(nf, f + 1)][c], pw = P[Math.max(0, f - 1)][c];
    const tu = [pu[0] - pd[0], pu[1] - pd[1], pu[2] - pd[2]], tv = [pv[0] - pw[0], pv[1] - pw[1], pv[2] - pw[2]];
    let x = tu[1] * tv[2] - tu[2] * tv[1], y = tu[2] * tv[0] - tu[0] * tv[2], z = tu[0] * tv[1] - tu[1] * tv[0];
    if (x * n[0] + z * n[1] < 0) { x = -x; y = -y; z = -z; }
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  };
  const U = (c) => ((c / nc) * L) / (1.5 * tex.nx), V = (f) => (f0 + f) / tex.ny;
  for (let f = 0; f < nf; f++) for (let c = 0; c < nc; c++)
    acc.quadN(P[f][c], P[f][c + 1], P[f + 1][c + 1], P[f + 1][c], N(f, c), N(f, c + 1), N(f + 1, c + 1), N(f + 1, c),
      [U(c), V(f)], [U(c + 1), V(f)], [U(c + 1), V(f + 1)], [U(c), V(f + 1)]);
}
export function build8Spruce(ctx) {
  const g = new THREE.Group();
  const ring0 = ringOf(ctx, 60, 45);
  const M = spMats();
  const H = Math.max(150, ctx.height || 262.4);
  const yP = 26.5, fh = (H - yP) / 70;
  const BR = new Acc(), SL = new Acc(), CP = new Acc(), ST = new Acc(), RF = new Acc();
  // the school: brick on the whole lot, a stone base course and a coping
  loft(ST, ring0, -0.6, [[0, 0], [0.25, 0], [0.25, 1.6], [0, 1.6]], false);
  wallRing(BR, ring0, 1.0, yP, M.tx.brick, { bayW: 3.4, floorH: (yP - 1.0) / 6, vRef: 1.0 });
  loft(ST, ring0, yP, PROF.corniceS.map(([d, h]) => [d * 0.6, h * 0.8]), false);
  capRing(RF, offsetRing(ring0, -0.2), yP + 0.7);
  // the tower: the lot's simple ring, the face on Spruce Street (the one facing most nearly south) flat, the rest rippled; the
  // faces facing east step back toward the top
  const ring = simplify(ring0, 25);
  const E = edgesOf(ring, null);
  let fi = 0;
  for (let i = 1; i < E.length; i++) if (E[i].n[1] - 0.3 * Math.abs(E[i].n[0]) > E[fi].n[1] - 0.3 * Math.abs(E[fi].n[0])) fi = i;
  const tiers = [[yP, 0.45 * H, 0], [0.45 * H, 0.66 * H, 2.5], [0.66 * H, 0.84 * H, 5], [0.84 * H, H - 4, 7.5]];
  let prev = null;
  for (const [ya, yb, st] of tiers) {
    const dIn = E.map((e, i) => (i === fi ? 2.5 : 3.5) + (e.n[0] > 0.35 ? st : 0));
    const tr = insetEdges(ring.map((p) => p), E.length === ring.length ? dIn : ring.map(() => 3.5));
    const s = ringOutSign(tr);
    for (let i = 0; i < tr.length; i++) {
      const a = tr[i], b = tr[(i + 1) % tr.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      rippleWall(SL, a, b, [s * ez / L, -s * ex / L], ya, yb, fh, M.tx.steel, 1.7 * i + ya * 0.01, i === fi);
    }
    capRing(RF, tr, yb);
    loft(CP, tr, yb - 0.05, [[0, 0], [1.8, 0], [1.8, 0.45], [0, 0.45]], true);
    prev = tr;
  }
  if (prev) {                                                                              // the roof's screen
    const sc = offsetRing(prev, -2.5);
    wallRing(SL, sc, H - 4, H, M.tx.steel, { bayW: 1.5, floorH: fh, vRef: 0 });
    capRing(RF, sc, H);
  }
  addMeshes(g, [[BR, M.brick, 'lm63:spruce:school'], [ST, M.stone, 'lm63:spruce:stone'], [SL, M.steel, 'lm63:spruce:steel'], [CP, M.cap, 'lm63:spruce:ledges'],
    [RF, M.roof, 'lm63:spruce:roof']]);
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  g.userData.colliderBoxes = [{ x: cx / ring.length, y: H / 2, z: cz / ring.length, w: 35, h: H, d: 35, rotY: 0 }];
  g.userData.tris = triCount([[BR], [ST], [SL], [CP], [RF]]);
  return g;
}
