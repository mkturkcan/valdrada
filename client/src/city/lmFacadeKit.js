// lmFacadeKit.js: ring-driven facade geometry for the park-side landmarks (CP33 landmarks round, 2026-09-30).
//
// The landmark builders of landmarks.js are boxes with a flat colour. The towers the teaser frames from the park (the San
// Remo, 111 West 57th, the Plaza, the Essex and Hampshire Houses) are judged at 100-500 m, where the read is the massing,
// the window rhythm, the string courses and the crowns. This kit supplies, all merged per material (a handful of draw calls
// per building):
//   * facade tiles: one canvas tile of 4 x N window cells with its own bump map (recessed panes, proud sills and lintels,
//     coursed brick or ashlar), painted per cell with random curtains and blinds so a long wall does not repeat;
//   * wallRing: the footprint ring's walls with those tiles mapped to whole bays and absolute floors;
//   * loft: a moulding profile swept round a ring with mitred corners (cornices, string courses, plinths, copings);
//   * capRing, box, cyl: roofs, shafts, columns.
// Nothing here touches the shared tile pipeline; landmarks.js builders call it.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { KIT } from './landmarkKit.js';
import { applyLightTrim, applySkyGlass, applyStoneDetail } from '../world/materials.js';

export const { mat: kmat } = KIT;

/* ------------------------------------------------------------------ random */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const cl = (v) => Math.max(0, Math.min(255, Math.round(v)));
export const rgbs = (c, k = 1, a = 1) => `rgba(${cl(c[0] * k)},${cl(c[1] * k)},${cl(c[2] * k)},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/* ------------------------------------------------------------ facade tiles */
const _tex = new Map();
// A tile of nx x ny cells of cw x ch px. paint(g, gb, x, y, w, h, i, j, r): draws cell (i, j) into the albedo context g and
// the bump context gb (140 = flat, lower = recessed, higher = proud). Row 0 is the TOP of the tile (the highest floor).
export function facadeTex(key, { nx, ny, cw, ch, paint, seed = 1, base = [200, 190, 165] }) {
  let t = _tex.get(key);
  if (t) return t;
  const mk = () => { const c = document.createElement('canvas'); c.width = nx * cw; c.height = ny * ch; return c; };
  const ca = mk(), cb = mk();
  const ga = ca.getContext('2d'), gb = cb.getContext('2d');
  ga.fillStyle = rgbs(base); ga.fillRect(0, 0, ca.width, ca.height);
  gb.fillStyle = 'rgb(140,140,140)'; gb.fillRect(0, 0, cb.width, cb.height);
  const r = rng(seed);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) paint(ga, gb, i * cw, j * ch, cw, ch, i, j, r);
  const map = new THREE.CanvasTexture(ca);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const bump = new THREE.CanvasTexture(cb);
  bump.wrapS = bump.wrapT = THREE.RepeatWrapping; bump.anisotropy = 4;
  t = { map, bump, nx, ny, cw, ch };
  _tex.set(key, t);
  return t;
}
const _fm = new Map();
// o: { rough, metal, bump, skyGlass, stone: { set, amt, nrm, rgh, ashlar } }
export function facadeMat(key, tex, o = {}) {
  let m = _fm.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({
    map: tex.map, bumpMap: tex.bump, bumpScale: o.bump ?? 1.6, roughness: o.rough ?? 0.86, metalness: o.metal ?? 0, color: 0xffffff,
  });
  applyLightTrim(m);
  if (o.skyGlass) applySkyGlass(m, o.skyGlass);
  if (o.stone) applyStoneDetail(m, o.stone.set, o.stone);
  _fm.set(key, m);
  return m;
}

// speckle: tiny tone variation over a rect (stone / brick grain)
export function speckle(g, x, y, w, h, r, n, amp = 0.08) {
  for (let k = 0; k < n; k++) {
    const dark = r() < 0.5;
    g.fillStyle = dark ? `rgba(0,0,0,${(r() * amp).toFixed(3)})` : `rgba(255,250,235,${(r() * amp).toFixed(3)})`;
    g.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 4);
  }
}
// weathering streaks running down from sills and ledges
export function streaks(g, x, y, w, h, r, n, amp = 0.07) {
  for (let k = 0; k < n; k++) {
    g.fillStyle = `rgba(30,24,16,${(r() * amp).toFixed(3)})`;
    g.fillRect(x + r() * w, y + r() * h * 0.5, 1 + r() * 2, h * (0.2 + r() * 0.5));
  }
}

// One punched-window cell: coursed wall, stone surround, recessed pane with bars, a curtain or blind, a sill and a lintel.
// o: wall, trim, win [w, h] as fractions of the cell, winY (bottom margin fraction), bars ('dh' | 'tri' | 'case' | 'none'),
// brick (course px, 0 = smooth), pair (two windows in the cell), arch (round head), dark (glass depth), seed
export function punchedPainter(o) {
  const O = Object.assign({
    wall: [200, 186, 152], trim: [226, 218, 196], win: [0.46, 0.58], winY: 0.14, bars: 'dh', brick: 5, pair: 0, arch: 0,
    glass: [34, 44, 54], tone: 0.05, sillH: 0.035, lintelH: 0.06, rustic: 0, quoin: 0,
  }, o);
  return (g, gb, x, y, w, h, i, j, r) => {
    // wall: per-cell tone, coursed
    const tone = 1 + (r() - 0.5) * 2 * O.tone;
    g.fillStyle = rgbs(O.wall, tone); g.fillRect(x, y, w, h);
    if (O.brick) {
      const cr = O.brick;
      for (let yy = 0; yy < h; yy += cr) {
        g.fillStyle = `rgba(20,14,8,${0.07 + r() * 0.05})`; g.fillRect(x, y + yy, w, 1);
        gb.fillStyle = 'rgb(118,118,118)'; gb.fillRect(x, y + yy, w, 1);
      }
      // brick-to-brick tone shifts, a few per row
      for (let k = 0; k < 26; k++) {
        const bx = x + r() * w, by = y + Math.floor(r() * (h / cr)) * cr;
        g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${0.05 + r() * 0.06})` : `rgba(255,240,215,${0.04 + r() * 0.05})`;
        g.fillRect(bx, by, cr * (2 + r() * 3), cr - 1);
      }
    }
    speckle(g, x, y, w, h, r, Math.round(w * h / 90), 0.07);
    if (O.rustic) {                                   // ashlar: deep horizontal joints, staggered vertical joints
      const cr = O.rustic;
      for (let yy = 0, row = 0; yy < h; yy += cr, row++) {
        g.fillStyle = 'rgba(25,20,14,0.30)'; g.fillRect(x, y + yy, w, 2);
        gb.fillStyle = 'rgb(70,70,70)'; gb.fillRect(x, y + yy, w, 3);
        const bw = cr * 2.1, off = (row % 2) * bw * 0.5;
        for (let xx = -off; xx < w; xx += bw) {
          if (xx < 0) continue;
          g.fillStyle = 'rgba(25,20,14,0.24)'; g.fillRect(x + xx, y + yy, 2, cr);
          gb.fillStyle = 'rgb(80,80,80)'; gb.fillRect(x + xx, y + yy, 3, cr);
        }
      }
    }
    const nWin = O.pair ? 2 : 1;
    for (let k = 0; k < nWin; k++) {
      const ww = w * (O.pair ? O.win[0] * 0.5 : O.win[0]), wh = h * O.win[1];
      const wx = x + (O.pair ? w * (0.27 + k * 0.46) - ww / 2 : w / 2 - ww / 2), wy = y + h * (1 - O.winY) - wh;
      const t = Math.max(3, w * 0.04);
      // surround (proud) and its shadow line
      g.fillStyle = rgbs(O.trim, 1 + (r() - 0.5) * 0.04); g.fillRect(wx - t, wy - h * O.lintelH, ww + 2 * t, wh + h * O.lintelH + h * O.sillH * 0.4);
      gb.fillStyle = 'rgb(185,185,185)'; gb.fillRect(wx - t, wy - h * O.lintelH, ww + 2 * t, wh + h * O.lintelH + h * O.sillH * 0.4);
      // the recessed pane
      const gl = g.createLinearGradient(0, wy, 0, wy + wh);
      const gcol = O.glass;
      gl.addColorStop(0, rgbs(mixc(gcol, [150, 175, 200], 0.28)));
      gl.addColorStop(0.5, rgbs(gcol));
      gl.addColorStop(1, rgbs(gcol, 0.7));
      g.fillStyle = gl; g.fillRect(wx, wy, ww, wh);
      gb.fillStyle = 'rgb(28,28,28)'; gb.fillRect(wx, wy, ww, wh);
      // interior: a curtain or a half-drawn blind in about a third of the windows
      const c = r();
      if (c < 0.22) { g.fillStyle = rgbs([196, 186, 160], 0.82 + r() * 0.2, 0.9); g.fillRect(wx + ww * 0.08, wy + wh * 0.08, ww * 0.84, wh * (0.3 + r() * 0.5)); }
      else if (c < 0.36) { g.fillStyle = rgbs([170, 160, 140], 0.9, 0.85); g.fillRect(wx, wy, ww, wh * (0.25 + r() * 0.3)); }
      else if (c < 0.40) { g.fillStyle = 'rgba(255,214,150,0.55)'; g.fillRect(wx, wy, ww, wh); }
      // reveal shadow: head and left jamb
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(wx, wy, ww, Math.max(3, wh * 0.07)); g.fillRect(wx, wy, Math.max(3, ww * 0.07), wh);
      // bars
      g.fillStyle = rgbs(O.trim, 0.92);
      if (O.bars === 'dh') { g.fillRect(wx, wy + wh * 0.5 - 1.5, ww, 3); gb.fillStyle = 'rgb(150,150,150)'; gb.fillRect(wx, wy + wh * 0.5 - 1.5, ww, 3); }
      else if (O.bars === 'tri') { for (const f of [1 / 3, 2 / 3]) { g.fillRect(wx + ww * f - 1, wy, 2.5, wh); gb.fillStyle = 'rgb(150,150,150)'; gb.fillRect(wx + ww * f - 1, wy, 2.5, wh); } g.fillRect(wx, wy + wh * 0.5 - 1.5, ww, 3); }
      else if (O.bars === 'case') { g.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); gb.fillStyle = 'rgb(150,150,150)'; gb.fillRect(wx + ww / 2 - 1.5, wy, 3, wh); g.fillRect(wx, wy + wh * 0.34 - 1.5, ww, 3); }
      // sill (proud) and the shadow it throws
      g.fillStyle = rgbs(O.trim, 1.04); g.fillRect(wx - t * 1.5, wy + wh, ww + 3 * t, h * O.sillH);
      gb.fillStyle = 'rgb(225,225,225)'; gb.fillRect(wx - t * 1.5, wy + wh, ww + 3 * t, h * O.sillH);
      g.fillStyle = 'rgba(0,0,0,0.26)'; g.fillRect(wx - t, wy + wh + h * O.sillH, ww + 2 * t, h * 0.03);
      // lintel keystone (every other cell reads as a fine detail without cost)
      if (O.keystone) { g.fillStyle = rgbs(O.trim, 1.05); g.fillRect(wx + ww * 0.42, wy - h * O.lintelH * 1.25, ww * 0.16, h * O.lintelH * 1.3); }
    }
    // pier edge streak and a slow vertical weathering
    streaks(g, x, y, w, h, r, 3, 0.07);
  };
}

/* ------------------------------------------------------------- ring helpers */
export function ringSign(ring) {      // +1 / -1: which side of the longest edge is outside (winding is not guaranteed)
  const n = ring.length;
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  cx /= n; cz /= n;
  let li = 0, ll = -1;
  for (let i = 0; i < n; i++) { const a = ring[i], b = ring[(i + 1) % n]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L > ll) { ll = L; li = i; } }
  const a = ring[li], b = ring[(li + 1) % n];
  const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
  const mx = (a[0] + b[0]) / 2 - cx, mz = (a[1] + b[1]) / 2 - cz;
  return (ez / L) * mx + (-ex / L) * mz > 0 ? 1 : -1;
}
// signed area based winding is exact for simple rings (courts make the longest-edge test fragile): use it when it is clear
export function ringOutSign(ring) {
  let A = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; A += a[0] * b[1] - b[0] * a[1]; }
  // the outward normal of edge (ex, ez) is s * (ez, -ex): a unit square (0,0) (1,0) (1,1) (0,1) has A > 0 and its first
  // edge (1, 0) faces -z = (ez, -ex), so s = +1 there (the same rule probe_buildings.mjs prints its headings with)
  return A > 0 ? 1 : -1;
}
export function offsetRing(ring, d, s = ringOutSign(ring)) {
  const n = ring.length, nrm = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n];
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    nrm.push([s * ez / L, -s * ex / L]);
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const n1 = nrm[(i - 1 + n) % n], n2 = nrm[i];
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1];
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-3) { out.push([ring[i][0] + n2[0] * d, ring[i][1] + n2[1] * d]); continue; }
    mx /= ml; mz /= ml;
    const t = d / Math.max(0.4, mx * n2[0] + mz * n2[1]);
    out.push([ring[i][0] + mx * t, ring[i][1] + mz * t]);
  }
  return out;
}
export const rectRing = (cx, cz, w, d, rot = 0) => {          // w along the local x axis, rotated by rot (radians, y axis)
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, z]) => [cx + x * c + z * s, cz - x * s + z * c]);
};

/* -------------------------------------------------------- geometry accumulator */
export class Acc {
  constructor() { this.p = []; this.n = []; this.u = []; this.tris = 0; }
  tri(a, b, c, n, ua = [0, 0], ub = [0, 0], uc = [0, 0]) {
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    this.n.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]);
    this.tris++;
  }
  // a quad a-b-c-d (any winding); n is the outward normal it should face
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const L = Math.hypot(cx, cy, cz);
    if (L < 1e-9) { const e3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]; if (Math.hypot(...e3) < 1e-9) return; }
    const flip = (cx * n[0] + cy * n[1] + cz * n[2]) < 0;
    ua = ua || [0, 0]; ub = ub || [0, 0]; uc = uc || [0, 0]; ud = ud || [0, 0];
    if (!flip) { this.tri(a, b, c, n, ua, ub, uc); this.tri(a, c, d, n, ua, uc, ud); }
    else { this.tri(a, c, b, n, ua, uc, ub); this.tri(a, d, c, n, ua, ud, uc); }
  }
  // both faces of a thin sheet (glazed crown facets, cloaks), each 1 cm out along its own normal: two coplanar faces wound
  // opposite ways are both met by a path tracer, which shades whichever it hits first (the inward one black)
  tri2(a, b, c, n, ua, ub, uc) {
    const o = (p, s) => [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s], m = [-n[0], -n[1], -n[2]];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    if ((e1[1] * e2[2] - e1[2] * e2[1]) * n[0] + (e1[2] * e2[0] - e1[0] * e2[2]) * n[1] + (e1[0] * e2[1] - e1[1] * e2[0]) * n[2] < 0) { [b, c] = [c, b]; [ub, uc] = [uc, ub]; }
    this.tri(o(a, 0.01), o(b, 0.01), o(c, 0.01), n, ua, ub, uc);       // wound to face n
    this.tri(o(a, -0.01), o(c, -0.01), o(b, -0.01), m, ua, uc, ub);    // wound to face -n
  }
  quad2(a, b, c, d, n, ua, ub, uc, ud) {
    const o = (p, s) => [p[0] + n[0] * s, p[1] + n[1] * s, p[2] + n[2] * s];
    this.quad(o(a, 0.01), o(b, 0.01), o(c, 0.01), o(d, 0.01), n, ua, ub, uc, ud);
    this.quad(o(a, -0.01), o(b, -0.01), o(c, -0.01), o(d, -0.01), [-n[0], -n[1], -n[2]], ua, ub, uc, ud);
  }
  // a quad with per-vertex normals (smooth round a lathe); the winding follows the mean normal
  quadN(a, b, c, d, na, nb, nc, nd, ua, ub, uc, ud) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const mx = na[0] + nb[0] + nc[0] + nd[0], my = na[1] + nb[1] + nc[1] + nd[1], mz = na[2] + nb[2] + nc[2] + nd[2];
    ua = ua || [0, 0]; ub = ub || [0, 0]; uc = uc || [0, 0]; ud = ud || [0, 0];
    const push = (p, n, u) => { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.u.push(u[0], u[1]); };
    if (cx * mx + cy * my + cz * mz >= 0) { push(a, na, ua); push(b, nb, ub); push(c, nc, uc); push(a, na, ua); push(c, nc, uc); push(d, nd, ud); }
    else { push(a, na, ua); push(c, nc, uc); push(b, nb, ub); push(a, na, ua); push(d, nd, ud); push(c, nc, uc); }
    this.tris += 2;
  }
  addGeo(geo, m4) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (m4) g.applyMatrix4(m4);
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      this.p.push(P.getX(i), P.getY(i), P.getZ(i));
      if (N) this.n.push(N.getX(i), N.getY(i), N.getZ(i)); else this.n.push(0, 1, 0);
      if (U) this.u.push(U.getX(i), U.getY(i)); else this.u.push(0, 0);
    }
    this.tris += P.count / 3;
    g.dispose();
  }
  build() {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.computeBoundingSphere();
    return g;
  }
  mesh(material, name) {
    const g = this.build();
    if (!g) return null;
    const m = new THREE.Mesh(g, material);
    m.castShadow = true; m.receiveShadow = true;
    if (name) m.name = name;
    return m;
  }
}

// the walls of a ring from y0 to y1, a facade tile mapped to whole bays (bayW m) and absolute floors (floorH m, vRef = the
// height of a tile's bottom edge). opts.skip(i) leaves an edge out; opts.plainBelow: edges shorter than this get a pier strip
export function wallRing(acc, ring, y0, y1, tex, o) {
  const s = ringOutSign(ring), n = ring.length;
  const bayW = o.bayW, floorH = o.floorH, vRef = o.vRef ?? 0;
  for (let i = 0; i < n; i++) {
    if (o.skip && o.skip(i)) continue;
    const A = ring[i], B = ring[(i + 1) % n];
    const ex = B[0] - A[0], ez = B[1] - A[1], L = Math.hypot(ex, ez);
    if (L < 0.05) continue;
    const nx = s * ez / L, nz = -s * ex / L;
    const nb = Math.max(1, Math.round(L / bayW));
    const u1 = L < (o.plainBelow ?? 1.6) ? 0.08 / tex.nx : nb / tex.nx;
    const v0 = (y0 - vRef) / (floorH * tex.ny), v1 = (y1 - vRef) / (floorH * tex.ny);
    acc.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [nx, 0, nz], [0, v0], [u1, v0], [u1, v1], [0, v1]);
  }
}
// a flat cap (a roof deck, a setback terrace) triangulated with earcut; facing up
export function capRing(acc, ring, y, scaleUV = 0.1) {
  const pts = ring.map((p) => new THREE.Vector2(p[0], p[1]));
  const tris = THREE.ShapeUtils.triangulateShape(pts, []);
  for (const [i, j, k] of tris) {
    const a = [ring[i][0], y, ring[i][1]], b = [ring[j][0], y, ring[j][1]], c = [ring[k][0], y, ring[k][1]];
    const cr = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);   // y of (b-a) x (c-a)
    const uv = (p) => [p[0] * scaleUV, p[2] * scaleUV];
    if (cr >= 0) acc.tri(a, b, c, [0, 1, 0], uv(a), uv(b), uv(c)); else acc.tri(a, c, b, [0, 1, 0], uv(a), uv(c), uv(b));
  }
}
// a moulding swept round a ring. profile: [[out, up], ...] in order, counter-clockwise in the (out, up) plane when out is
// right and up is up (the solid is on the left of travel); out is metres past the ring, up is metres over y0. closed: the
// last point joins the first. Mitred corners come from offsetRing.
export function loft(acc, ring, y0, profile, closed = true) {
  const s = ringOutSign(ring), n = ring.length;
  const rings = profile.map(([d]) => offsetRing(ring, d, s));
  const segs = profile.length - (closed ? 0 : 1);
  for (let k = 0; k < segs; k++) {
    const k2 = (k + 1) % profile.length;
    const [d0, u0] = profile[k], [d1, u1] = profile[k2];
    const dd = d1 - d0, du = u1 - u0;
    const Lp = Math.hypot(dd, du);
    if (Lp < 1e-6) continue;
    for (let i = 0; i < n; i++) {
      const i2 = (i + 1) % n;
      const A0 = rings[k][i], A1 = rings[k][i2], B0 = rings[k2][i], B1 = rings[k2][i2];
      const ex = ring[i2][0] - ring[i][0], ez = ring[i2][1] - ring[i][1], L = Math.hypot(ex, ez) || 1;
      const ox = s * ez / L, oz = -s * ex / L;
      // outward normal of the profile segment: (du, -dd) in (out, up)
      const nrm = [ox * du / Lp, -dd / Lp, oz * du / Lp];
      acc.quad([A0[0], y0 + u0, A0[1]], [A1[0], y0 + u0, A1[1]], [B1[0], y0 + u1, B1[1]], [B0[0], y0 + u1, B0[1]], nrm);
    }
  }
}

/* ---------------------------------------------------------------- primitives */
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const BOX = new THREE.BoxGeometry(1, 1, 1);
export function box(acc, cx, y0, cz, w, h, d, rot = 0, tilt = 0) {
  _e.set(0, rot, tilt, 'YXZ'); _q.setFromEuler(_e);
  _m4.compose(_v.set(cx, y0 + h / 2, cz), _q, _s.set(w, h, d));
  acc.addGeo(BOX, _m4);
}
const _cyl = new Map();
// a vertical cylinder / cone frustum: radii rt (top) and rb (bottom), bottom at y0
export function cyl(acc, cx, y0, cz, rt, rb, h, seg = 12, rot = 0, open = false, flat = false) {
  const key = `${rt.toFixed(3)}|${rb.toFixed(3)}|${h.toFixed(3)}|${seg}|${open ? 1 : 0}|${flat ? 1 : 0}`;
  let g = _cyl.get(key);
  if (!g) {
    g = new THREE.CylinderGeometry(rt, rb, h, seg, 1, open);
    if (flat) { g = g.toNonIndexed(); g.computeVertexNormals(); }   // facets: 16 of them read as the flutes at 20-60 m
    _cyl.set(key, g);
  }
  _m4.compose(_v.set(cx, y0 + h / 2, cz), _q.setFromAxisAngle(_v2.set(0, 1, 0), rot), _s.set(1, 1, 1));
  acc.addGeo(g, _m4);
}
const _v2 = new THREE.Vector3();
// a lathe: profile [[r, y], ...] spun round the vertical axis at (cx, y0, cz). Smooth round the axis, hard between profile
// segments (a closed section [[ri,0],[ro,0],[ro,h],[ri,h],[ri,0]] is a ring with square edges); the normal of a segment
// with direction (dr, dy) is (dy, -dr): going up faces out, going out faces down.
export function lathe(acc, cx, y0, cz, pts, seg = 16, rot = 0) {
  for (let k = 0; k + 1 < pts.length; k++) {
    const [r0, h0] = pts[k], [r1, h1] = pts[k + 1];
    const dr = r1 - r0, dy = h1 - h0, L = Math.hypot(dr, dy);
    if (L < 1e-6) continue;
    const nr = dy / L, ny = -dr / L;
    for (let j = 0; j < seg; j++) {
      const t0 = rot + (j / seg) * Math.PI * 2, t1 = rot + ((j + 1) / seg) * Math.PI * 2;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      acc.quadN([cx + r0 * c0, y0 + h0, cz + r0 * s0], [cx + r0 * c1, y0 + h0, cz + r0 * s1], [cx + r1 * c1, y0 + h1, cz + r1 * s1], [cx + r1 * c0, y0 + h1, cz + r1 * s0],
        [nr * c0, ny, nr * s0], [nr * c1, ny, nr * s1], [nr * c1, ny, nr * s1], [nr * c0, ny, nr * s0],
        [j / seg, h0], [(j + 1) / seg, h0], [(j + 1) / seg, h1], [j / seg, h1]);
    }
  }
}
// a tilted slab: a quad roof plane from (x0, y0) to (x1, y1) in a local frame; used by mansard and hip roofs
export function plane(acc, p0, p1, p2, p3, uvScale = 0.25) {
  const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
  const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const L = Math.hypot(...n) || 1;
  const L1 = Math.hypot(...e1), L2 = Math.hypot(...e2);
  acc.quad(p0, p1, p2, p3, [n[0] / L, n[1] / L, n[2] / L], [0, 0], [L1 * uvScale, 0], [L1 * uvScale, L2 * uvScale], [0, L2 * uvScale]);
}

/* ------------------------------------------------------------------ materials */
// the merged accumulators become meshes: one call per (acc, material)
export function addMeshes(group, list) {
  for (const [acc, material, name] of list) { const m = acc.mesh(material, name); if (m) group.add(m); }
  return group;
}
export function triCount(list) { let t = 0; for (const [acc] of list) t += acc.tris; return t; }
