// lmStoneKit.js (LM16, landmarks round 2026-10-16): geometry helpers for the masonry landmarks built on the kit's material
// sets (tk/tkMats.js surfMat / partMat / cwGlassMat / winGlassMat), so Unreal binds every surface to its PBR set: no painted
// facade canvases. Detail is geometry: coursed and rock-faced stone as stacked chamfered courses, openings cut through
// the wall with their reveals, arches, sills, glass set back, cornices swept along the faces, hip roofs laid in courses,
// dormers, round towers as many-faceted walls, lathed cones and domes. Used by lmAmnh.js and lmGuggenheim.js.
//
// Coordinates: the builders work in a grid frame of their own (gx along the Manhattan streets toward the East River, gn
// along the avenues toward the north, metres from a world origin O fixed per landmark), so the model stays on its site
// whatever ring a compile hands it. Vertices are written as tkLandmarks.js buildSpec writes them: relative to the cell
// origin org (the rounded footprint centre) at world height, the inner group shifted back by the centre and the ground.
import * as THREE from 'three';
import { Sink, Frame, poly, quadW, quadU, quadY, box as kbox, extrude, wallWithHoles, flatRing } from './fk/kitGeom.js';
import { surfMat, partMat, cwGlassMat, winGlassMat } from './tk/tkMats.js';

export const GE = [0.8746, 0.4848], GN = [0.4848, -0.8746];   // the street (east) and avenue (north) axes, world x z
const ONE3 = [1, 1, 1];
const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------------------------- the build
export class LB {
  constructor(ctx, O) {
    this.cx = ctx.cx ?? 0; this.cz = ctx.cz ?? 0; this.y0 = ctx.groundY ?? 0;
    this.org = [Math.round(this.cx), Math.round(this.cz)];
    this.O = O;
    this.sinks = new Map();
    this.we = null;
    this.colliders = [];
  }
  // a grid point in world x z
  W(gx, gn) { return [this.O[0] + gx * GE[0] + gn * GN[0], this.O[1] + gx * GE[1] + gn * GN[1]]; }
  // a face from grid point a (its left end as seen from outside) to b; local y from the ground
  F(ax, an, bx, bn) { return new Frame(this.W(ax, an), this.W(bx, bn), this.y0, this.org); }
  // the four faces of a grid rectangle, outward, in the order south, east, north, west
  rectFaces(gx0, gx1, gn0, gn1) {
    return [this.F(gx0, gn0, gx1, gn0), this.F(gx1, gn0, gx1, gn1), this.F(gx1, gn1, gx0, gn1), this.F(gx0, gn1, gx0, gn0)];
  }
  // the sink of a material handle, its tint ratio and weather set for the writes that follow
  S(mat) {
    const base = (mat.userData && mat.userData.fkBase) || mat;
    let e = this.sinks.get(base);
    if (!e) this.sinks.set(base, (e = { mat: base, S: new Sink(), glass: null }));
    e.S.tr = (mat.userData && mat.userData.fkTr) || (base.userData && base.userData.fkBaseHex ? ONE3 : null);
    e.S.we = this.we;
    return e.S;
  }
  // a glass sink: the room attributes (tkMats glassRooms) per vertex beside it
  G(mat) {
    const S = this.S(mat), e = this.sinks.get((mat.userData && mat.userData.fkBase) || mat);
    if (!e.glass) e.glass = { GW: [], GS: [] };
    return e;
  }
  // a pane: polygon pts [[u, y], ...] (convex, counter-clockwise from outside) on plane w of frame F; info: { cu, cv, ws, sill, fh }
  pane(mat, F, pts, w, info = {}) {
    const e = this.G(mat), S = e.S, n0 = S.n;
    let u0 = 1e9, u1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const [u, y] of pts) { u0 = Math.min(u0, u); u1 = Math.max(u1, u); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const pw = Math.max(0.05, u1 - u0), ph = Math.max(0.05, y1 - y0);
    const b = S.n;
    for (const [u, y] of pts) S.v(F.ox + u * F.ux + w * F.nx, F.y0 + y, F.oz + u * F.uz + w * F.nz, F.nx, 0, F.nz, (u - u0) / pw, (y - y0) / ph, 0);
    for (let i = 1; i + 1 < pts.length; i++) S.tri(b, b + i, b + i + 1);
    const GW = e.glass.GW, GS = e.glass.GS;
    for (let i = n0; i < S.n; i++) {
      GW[i * 4] = info.cu ?? 0; GW[i * 4 + 1] = info.cv ?? 0; GW[i * 4 + 2] = info.ws ?? 0; GW[i * 4 + 3] = info.cvar ?? 0.3;
      GS[i * 4] = pw; GS[i * 4 + 1] = ph; GS[i * 4 + 2] = info.sill ?? 0.9; GS[i * 4 + 3] = info.fh ?? Math.max(3.2, ph + 1.4);
    }
  }
  // a world-space vertex
  V(S, x, y, z, nx, ny, nz, tu, tv) { return S.v(x - this.org[0], y, z - this.org[1], nx, ny, nz, tu, tv, 0); }
  // a planar polygon of world points [x, y, z] (y absolute) facing n (fan from the first point: convex or star-shaped)
  polyW(S, pts, n) {
    const nl = Math.hypot(n[0], n[1], n[2]) || 1, N = [n[0] / nl, n[1] / nl, n[2] / nl];
    let t1 = Math.abs(N[1]) > 0.95 ? [1, 0, 0] : [-N[2], 0, N[0]];
    const tl = Math.hypot(...t1); t1 = t1.map((v) => v / tl);
    const t2 = [N[1] * t1[2] - N[2] * t1[1], N[2] * t1[0] - N[0] * t1[2], N[0] * t1[1] - N[1] * t1[0]];
    const b = S.n;
    for (const p of pts) this.V(S, p[0], p[1], p[2], N[0], N[1], N[2], p[0] * t1[0] + p[1] * t1[1] + p[2] * t1[2], p[0] * t2[0] + p[1] * t2[1] + p[2] * t2[2]);
    // winding: the fan's summed cross product against n
    let cx = 0, cy = 0, cz = 0;
    for (let i = 1; i + 1 < pts.length; i++) {
      const a = pts[0], p = pts[i], q = pts[i + 1];
      const e1 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], e2 = [q[0] - a[0], q[1] - a[1], q[2] - a[2]];
      cx += e1[1] * e2[2] - e1[2] * e2[1]; cy += e1[2] * e2[0] - e1[0] * e2[2]; cz += e1[0] * e2[1] - e1[1] * e2[0];
    }
    const flip = cx * N[0] + cy * N[1] + cz * N[2] < 0;
    for (let i = 1; i + 1 < pts.length; i++) { if (flip) S.tri(b, b + i + 1, b + i); else S.tri(b, b + i, b + i + 1); }
  }
  // a horizontal ring (world x z) at local height y, up (or down)
  deck(mat, ring, y, down = false) {
    let A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
    flatRing(this.S(mat), A > 0 ? ring : ring.slice().reverse(), this.y0 + y, this.org, down);
  }
  // a grid rectangle as a world ring
  rect(gx0, gx1, gn0, gn1) { return [this.W(gx0, gn0), this.W(gx1, gn0), this.W(gx1, gn1), this.W(gx0, gn1)]; }
  collide(gx0, gx1, gn0, gn1, y0, y1) {
    const [x, z] = this.W((gx0 + gx1) / 2, (gn0 + gn1) / 2);
    this.colliders.push({ x: x - this.cx, y: (y0 + y1) / 2, z: z - this.cz, w: gx1 - gx0, h: y1 - y0, d: gn1 - gn0, rotY: Math.atan2(-GE[1], GE[0]) });
  }
  // the meshes: one per base material (the tint per vertex as aFkTr, as the kit's writers do)
  group(name) {
    const g = new THREE.Group(), inner = new THREE.Group();
    inner.position.set(-this.cx, -this.y0, -this.cz);
    g.add(inner);
    let tris = 0;
    const per = {};
    for (const { mat, S, glass } of this.sinks.values()) {
      const geo = S.build();
      if (!geo) continue;
      if (glass) {
        const n = geo.attributes.position.count, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
        for (let i = 0; i < n * 4; i++) { A[i] = glass.GW[i] || 0; B[i] = glass.GS[i] || 1; }
        geo.setAttribute('aTkW', new THREE.BufferAttribute(A, 4));
        geo.setAttribute('aTkS', new THREE.BufferAttribute(B, 4));
      }
      const m = new THREE.Mesh(geo, mat);
      m.position.set(this.org[0], 0, this.org[1]);
      m.name = name + ':' + (mat.name || 'mat');
      inner.add(m);
      const t = geo.index.count / 3;
      tris += t; per[mat.name || 'mat'] = (per[mat.name || 'mat'] || 0) + t;
    }
    g.userData.colliderBoxes = this.colliders;
    g.userData.tris = tris;
    g.userData.trisPer = per;
    g.name = name;
    return g;
  }
}

// ---------------------------------------------------------------------------------------------- arcs and openings
// the points of an arch over u0..u1 springing at ys: 'round' (a semicircle) or a segment of rise h; left to right
export function archPts(u0, u1, ys, kind = 'round', h = 0, n = 12) {
  const um = (u0 + u1) / 2, hw = (u1 - u0) / 2;
  const out = [];
  if (kind === 'round') {
    for (let i = 0; i <= n; i++) { const a = Math.PI - (i / n) * Math.PI; out.push([um + Math.cos(a) * hw, ys + Math.sin(a) * hw]); }
    return out;
  }
  // segmental: the circle through the springings and the crown at ys + h
  const R = (hw * hw + h * h) / (2 * h), yc = ys + h - R, a0 = Math.atan2(ys - yc, -hw), a1 = Math.atan2(ys - yc, hw);
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([um + Math.cos(a) * R, yc + Math.sin(a) * R]); }
  return out;
}
// an arch's rise for kind / h
export const archRise = (u0, u1, kind, h) => (kind === 'round' ? (u1 - u0) / 2 : kind === 'seg' ? h : 0);

// One opening in a wall of frame F: the hole is u0..u1 x y0..(ys + rise); the wall around it is the caller's (wallWithHoles
// or courses with this hole); this draws the arch's spandrels up to the hole's top (wall material), the reveals (jambs, sill
// seat, flat head or arch soffit) to depth d, the glass (or a dark recess) at -d, mullions and transom bars, a projecting
// sill, an arch hood and keystone. o: { u0, u1, y0, ys, arch: 'round'|'seg'|null, h, d, wall, trim, glass, frame,
//   mull: n, transom: y, sill: true, hood: true, key: true, info, door }
export function opening(B, F, o) {
  const { u0, u1, y0, ys } = o, d = o.d ?? 0.35;
  const kind = o.arch || null, rise = archRise(u0, u1, kind, o.h || 0), yt = ys + rise, um = (u0 + u1) / 2;
  const wall = o.wall, trim = o.trim || o.wall;
  if (kind) {
    const A = archPts(u0, u1, ys, kind, o.h || 0, (kind === 'round' ? Math.max(8, Math.round((u1 - u0) * 3)) : 8) | 1);
    const Sw = B.S(wall);
    // the spandrels: fans from the hole's top corners to the arc
    const half = Math.floor(A.length / 2);
    const left = [[u0, yt, 0], [um, yt, 0]];
    for (let i = half; i >= 0; i--) left.push([A[i][0], A[i][1], 0]);
    if (A[0][1] < yt - 1e-3) poly(Sw, F, left, 0, 0, 1);
    const right = [[u1, yt, 0], [u1, A[A.length - 1][1], 0]];
    for (let i = A.length - 1; i >= half; i--) right.push([A[i][0], A[i][1], 0]);
    right.push([um, yt, 0]);
    if (A[0][1] < yt - 1e-3) poly(Sw, F, right, 0, 0, 1);
    // the arch soffit
    const St = B.S(trim);
    const cy = kind === 'round' ? ys : (() => { const hw = (u1 - u0) / 2, h = o.h; const R = (hw * hw + h * h) / (2 * h); return ys + h - R; })();
    for (let i = 0; i + 1 < A.length; i++) {
      const [ua, ya] = A[i], [ub, yb] = A[i + 1], mu = (ua + ub) / 2, my = (ya + yb) / 2;
      poly(St, F, [[ua, ya, 0], [ub, yb, 0], [ub, yb, -d], [ua, ya, -d]], um - mu, cy - my, 0);
    }
    // the hood: voussoir blocks round the arch, proud of the face
    if (o.hood !== false) {
      const hw = o.hoodW ?? Math.min(0.55, (u1 - u0) * 0.16), hp = o.hoodP ?? 0.12, Sh = B.S(o.hoodMat || trim);
      const nv = A.length - 1;   // (odd: a keystone at the crown)
      for (let k = 0; k < nv; k++) {
        const pa = A[k], pb = A[k + 1];
        const out = (p) => { const dx = p[0] - um, dy = p[1] - cy, L = Math.hypot(dx, dy) || 1; return [p[0] + dx / L * hw, p[1] + dy / L * hw]; };
        const qa = out(pa), qb = out(pb), gap = 0.012;
        const key = o.key !== false && k === (nv - 1) / 2;
        const ext = key ? 0.18 : 0;
        const qa2 = key ? [qa[0], qa[1] + ext] : qa, qb2 = key ? [qb[0], qb[1] + ext] : qb;
        // the front and the outer edge of the block (a small gap between blocks)
        const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        const a0 = lerp(pa, pb, gap), b0 = lerp(pa, pb, 1 - gap), a1 = lerp(qa2, qb2, gap), b1 = lerp(qa2, qb2, 1 - gap);
        const w1 = hp + (key ? 0.05 : 0);
        poly(Sh, F, [[a0[0], a0[1], w1], [b0[0], b0[1], w1], [b1[0], b1[1], w1], [a1[0], a1[1], w1]], 0, 0, 1);
        const mx = (a1[0] + b1[0]) / 2 - um, my = (a1[1] + b1[1]) / 2 - cy;
        poly(Sh, F, [[a1[0], a1[1], 0], [a1[0], a1[1], w1], [b1[0], b1[1], w1], [b1[0], b1[1], 0]], mx, my, 0);
        poly(Sh, F, [[a0[0], a0[1], 0], [a0[0], a0[1], w1], [a1[0], a1[1], w1], [a1[0], a1[1], 0]], -(b0[1] - a0[1]), b0[0] - a0[0], 0);
        poly(Sh, F, [[b0[0], b0[1], 0], [b1[0], b1[1], 0], [b1[0], b1[1], w1], [b0[0], b0[1], w1]], b0[1] - a0[1], -(b0[0] - a0[0]), 0);
      }
    }
  } else {
    // a flat head: the soffit; a lintel block over it
    quadY(B.S(trim), F, u0, u1, ys, -d, 0, -1);
    if (o.lintel !== false) kbox(B.S(trim), F, u0 - 0.18, u1 + 0.18, ys, ys + (o.lintelH ?? 0.42), 0, o.lintelP ?? 0.08, 0.02, 16);
  }
  // the jambs and the sill seat
  const Sj = B.S(trim);
  quadU(Sj, F, u0, y0, ys, -d, 0, 1);
  quadU(Sj, F, u1, y0, ys, -d, 0, -1);
  quadY(Sj, F, u0, u1, y0, -d, 0, 1);
  // the projecting sill
  if (o.sill !== false && !o.door) kbox(B.S(trim), F, u0 - 0.12, u1 + 0.12, y0 - 0.16, y0, -0.02, 0.1, 0.02, 16);
  // the glass (or a dark recess) and its bars
  const pts = kind ? [[u0, y0], [u1, y0], ...archPts(u0, u1, ys, kind, o.h || 0, 10).reverse()] : [[u0, y0], [u1, y0], [u1, ys], [u0, ys]];
  if (o.glass) B.pane(o.glass, F, pts, -d, o.info || {});
  if (o.frame) {
    const Sf = B.S(o.frame), fw = 0.07, fd = 0.06;
    const bars = [];
    const nm = o.mull ?? 0;
    for (let k = 1; k <= nm; k++) bars.push(['v', u0 + (u1 - u0) * k / (nm + 1)]);
    if (o.transom) bars.push(['h', o.transom]);
    if (kind && o.transom !== false) bars.push(['h', ys]);
    for (const [t, v] of bars) {
      if (t === 'v') kbox(Sf, F, v - fw / 2, v + fw / 2, y0, kind ? yt - 0.05 : ys, -d, -d + fd, 0, 16);
      else kbox(Sf, F, u0, u1, v - fw / 2, v + fw / 2, -d, -d + fd, 0, 16);
    }
    // the frame round the edge
    kbox(Sf, F, u0, u0 + fw, y0, ys, -d, -d + fd, 0, 16);
    kbox(Sf, F, u1 - fw, u1, y0, ys, -d, -d + fd, 0, 16);
    kbox(Sf, F, u0, u1, y0, y0 + fw, -d, -d + fd, 0, 16);
    if (!kind) kbox(Sf, F, u0, u1, ys - fw, ys, -d, -d + fd, 0, 16);
  }
  return { u0, u1, y0, y1: yt };
}

// ---------------------------------------------------------------------------------------------- walls
// stone laid in courses: bands of height ch from y0 to y1, each a chamfered block proud of the face by p, cut round the
// holes ({ u0, u1, y0, y1 }); every `joint` metres a vertical joint (0: none). The face plane itself is the blocks' back.
export function courses(B, F, mat, u0, u1, y0, y1, ch, holes = [], p = 0.05, c = 0.03, joint = 0, seed = 0) {
  const S = B.S(mat);
  const n = Math.max(1, Math.round((y1 - y0) / ch)), h = (y1 - y0) / n;
  for (let k = 0; k < n; k++) {
    const ya = y0 + k * h, yb = ya + h;
    // the free spans of this band
    let segs = [[u0, u1]];
    for (const H of holes) {
      if (H.y1 <= ya + 1e-3 || H.y0 >= yb - 1e-3) continue;
      const out = [];
      for (const [a, b] of segs) {
        if (H.u1 <= a || H.u0 >= b) { out.push([a, b]); continue; }
        if (H.u0 > a + 0.02) out.push([a, H.u0]);
        if (H.u1 < b - 0.02) out.push([H.u1, b]);
      }
      segs = out;
    }
    // a band only partly covered by a hole (the arch's head) still needs the wall behind: blocks to the hole's edge
    const pk = p * (0.75 + 0.5 * frac(Math.sin((k + seed) * 12.9898) * 43758.5453));
    for (const [a, b] of segs) {
      if (b - a < 0.05) continue;
      if (joint > 0) {
        const off = (k % 2) * joint * 0.5;
        let s = a;
        let j = Math.floor((a - u0 + off) / joint) + 1;
        while (s < b - 1e-3) {
          const e = Math.min(b, u0 - off + j * joint);
          if (e - s > 0.04) kbox(S, F, s + 0.006, e - 0.006, ya + 0.006, yb - 0.006, 0, pk * (0.8 + 0.4 * frac(Math.sin((j * 7.1 + k * 3.3 + seed) * 78.233) * 43758.5453)), c, 16);
          s = e; j++;
        }
      } else kbox(S, F, a, b, ya + 0.006, yb - 0.006, 0, pk, c, 16);
    }
    // the joint's back (the wall plane between courses)
    for (const [a, b] of segs) if (b - a > 0.05) quadW(S, F, a, b, ya, yb, 0.002);
  }
}
const frac = (x) => x - Math.floor(x);
// a plain wall with holes, and with the given openings' parts
export function wall(B, F, mat, u0, u1, y0, y1, holes = []) { wallWithHoles(B.S(mat), F, u0, u1, y0, y1, holes, 0); }

// a moulding swept along a face from u0 to u1: prof [[w, y], ...] (w out of the face, y local height); m0 / m1 the mitres
export function mould(B, F, mat, prof, u0, u1, m0 = 1, m1 = 1, o = {}) { extrude(B.S(mat), F, prof, u0, u1, { m0, m1, ...o }); }
// mouldings: a cornice of projection P and height H whose top is at y, a string course, a plinth
export const PROF = {
  cornice: (y, P = 1.0, H = 1.2) => [[0, y - H], [0.18 * P, y - H], [0.18 * P, y - H + 0.12 * H], [0.3 * P, y - H + 0.2 * H], [0.32 * P, y - H + 0.42 * H],
    [0.55 * P, y - H + 0.46 * H], [0.55 * P, y - H + 0.6 * H], [0.88 * P, y - H + 0.66 * H], [P, y - H + 0.8 * H], [P, y], [0, y]],
  string: (y, P = 0.2, H = 0.35) => [[0, y], [P * 0.6, y], [P, y + H * 0.3], [P, y + H * 0.75], [P * 0.7, y + H], [0, y + H]],
  plinth: (y, P = 0.25) => [[0, 0], [P, 0], [P, y - 0.08], [P * 0.5, y], [0, y]],
  coping: (y, P = 0.12, H = 0.3) => [[-0.4, y], [P, y], [P, y + H * 0.6], [0.02, y + H], [-0.4, y + H]],
};

// a corbel table under an eave: small brackets every `pitch` along the face between u0 and u1, at y (their tops)
export function corbels(B, F, mat, u0, u1, y, pitch = 0.9, w = 0.32, h = 0.55, p = 0.4) {
  const S = B.S(mat), n = Math.max(1, Math.floor((u1 - u0) / pitch));
  const s = (u1 - u0 - n * pitch) / 2 + pitch / 2;
  for (let k = 0; k < n; k++) {
    const u = u0 + s + k * pitch;
    kbox(S, F, u - w / 2, u + w / 2, y - h * 0.45, y, 0, p, 0.02, 16);
    kbox(S, F, u - w / 2 + 0.03, u + w / 2 - 0.03, y - h, y - h * 0.45, 0, p * 0.55, 0.02, 16);
  }
}

// ---------------------------------------------------------------------------------------------- roofs
// a hip roof over grid rect gx0..gx1 x gn0..gn1 (the eave line, overhang already added by the caller) from local height
// yE, slope `pitch` (radians); laid in courses of slope length ch, each course's lower edge proud by t (the tiles' or
// slates' butts); the ridge and hips capped in capMat. o.gable: gabled ends instead of hips ('x' along gx, else along the
// long axis). Returns { yR, ridge: [[gx, gn], [gx, gn]], long } for dormers and crests.
export function hipRoof(B, mat, capMat, gx0, gx1, gn0, gn1, yE, pitch, o = {}) {
  const ch = o.ch ?? 0.34, t = o.t ?? 0.035, tp = Math.tan(pitch);
  const alongX = (gx1 - gx0) >= (gn1 - gn0);
  const hb = alongX ? (gn1 - gn0) / 2 : (gx1 - gx0) / 2;
  const yR = yE + hb * tp;
  const G = (gx, gn, y) => { const [x, z] = B.W(gx, gn); return [x, B.y0 + y, z]; };
  const S = B.S(mat), tr0 = S.tr ? S.tr.slice() : null;
  let pid = (Math.abs(Math.round(gx0 * 13 + gn0 * 7 + yE * 3)) % 97) / 97;   // the planes' seeds
  const mh = (a, b) => { let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b | 0) + 0x632be5ab, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2f); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
  const ext = o.flatTop || 0;   // a truncated hip: a flat deck at yE + (hb - ext) * tp (ext = the deck's half width)
  const yTop = yE + (hb - ext) * tp;
  // one plane: its eave from P0 to P1 (grid), the slope inward along `inw` (grid unit), the hips shrinking the course's
  // ends by `shr0`, `shr1` per metre of run (1 = a 45 degree hip, 0 = a gable end)
  const plane = (e0, e1, inw, run, shr0, shr1) => {
    const L = Math.hypot(e1[0] - e0[0], e1[1] - e0[1]), ax = [(e1[0] - e0[0]) / L, (e1[1] - e0[1]) / L];
    S.tr = tr0;   // (a seam or cap writer on the same base may have left its own tint on the sink)
    const sl = run / Math.cos(pitch), nC = Math.max(1, Math.round(sl / ch)), dr = run / nC;
    // the plane's outward normal in world: horizontal part opposite inw, vertical part up
    const hw = B.W(e0[0] - inw[0], e0[1] - inw[1]), h0 = B.W(e0[0], e0[1]);
    const hx = hw[0] - h0[0], hz = hw[1] - h0[1], hl = Math.hypot(hx, hz) || 1;
    const nl = Math.hypot(tp, 1), N = [hx / hl * tp / nl, 1 / nl, hz / hl * tp / nl];
    for (let k = 0; k < nC; k++) {
      const r0 = k * dr, r1 = (k + 1) * dr;
      const a00 = r0 * shr0, a01 = L - r0 * shr1, a10 = r1 * shr0, a11 = L - r1 * shr1;
      if (a01 - a00 < 0.02) break;
      const P = (a, r, lift) => {
        const gx = e0[0] + ax[0] * a + inw[0] * r, gn = e0[1] + ax[1] * a + inw[1] * r;
        const p = G(gx, gn, yE + r * tp);
        return [p[0] + N[0] * lift, p[1] + N[1] * lift, p[2] + N[2] * lift];
      };
      if (!o.mottle) {
        B.polyW(S, [P(a00, r0, t), P(a01, r0, t), P(Math.min(a11, a01), r1, 0), P(Math.max(a10, a00), r1, 0)], N);
        // the butt: from the plane up to the lifted edge, facing out and a little down
        const b0 = P(a00, r0, 0), b1 = P(a01, r0, 0), c0 = P(a00, r0, t), c1 = P(a01, r0, t);
        B.polyW(S, [b0, b1, c1, c0], [hx / hl, -0.2, hz / hl]);
        continue;
      }
      // (o.mottle) the course in pieces of o.mw metres, each its own tint: tile-to-tile scatter, weathered patches and,
      // with o.streak, dark runs down the slope from the ridge (strongest toward the eave)
      const mw = o.mw ?? 1.2, t0 = Math.max(a10, a00), t1 = Math.min(a11, a01), cl = (v) => Math.min(t1, Math.max(t0, v));
      for (let j = Math.floor(a00 / mw); j * mw < a01; j++) {
        const s0 = j * mw, s1 = s0 + mw, u0 = Math.max(s0, a00), u1 = Math.min(s1, a01);
        if (u1 - u0 < 0.01) continue;
        const ji = j + Math.round(pid * 1000), col = mh(ji, 7), patch = mh(Math.floor(ji / 3), Math.floor(k / 6) + 17 * pid), tile = mh(ji, k + 31 * pid);
        let f = 1 + o.mottle * (0.45 * (tile - 0.5) + 0.9 * (patch - 0.5));
        if (o.streak && col > 0.62) f -= o.streak * (col - 0.62) / 0.38 * (0.35 + 0.65 * (1 - k / nC));
        S.tr = tr0 ? [tr0[0] * f, tr0[1] * f, tr0[2] * f] : [f, f, f];
        // (o.streakMat: the darker pieces in a second material, for sets whose tint is not per vertex, e.g. the copper)
        const Sx = o.streakMat && ((col > 0.72 && k < nC * (0.25 + 0.7 * mh(ji, 3))) || patch < 0.1) ? B.S(o.streakMat) : S;   // runs from the eave up, a few weathered patches
        B.polyW(Sx, [P(u0, r0, t), P(u1, r0, t), P(cl(s1), r1, 0), P(cl(s0), r1, 0)], N);
        B.polyW(Sx, [P(u0, r0, 0), P(u1, r0, 0), P(u1, r0, t), P(u0, r0, t)], [hx / hl, -0.2, hz / hl]);
      }
    }
    S.tr = tr0;
    pid++;
    // a gutter along the eave (o.gutter: its material): a half-round read as a square member, just outside and below
    if (o.gutter) {
      const g0 = G(e0[0] - inw[0] * 0.14, e0[1] - inw[1] * 0.14, yE - 0.1), g1 = G(e1[0] - inw[0] * 0.14, e1[1] - inw[1] * 0.14, yE - 0.1);
      ribW(B, B.S(o.gutter), g0, g1, 0.2);
    }
    // standing seams (o.seam: their pitch along the eave, metres): ribs from the eave up to the ridge or the hip line
    if (o.seam) {
      const Ss = B.S(o.seamMat || mat), ts = o.seamT ?? 0.07;
      const Q = (a, r, lift) => {
        const p = G(e0[0] + ax[0] * a + inw[0] * r, e0[1] + ax[1] * a + inw[1] * r, yE + r * tp);
        return [p[0] + N[0] * lift, p[1] + N[1] * lift, p[2] + N[2] * lift];
      };
      for (let a = o.seam / 2; a < L; a += o.seam) {
        const rm = Math.min(run, shr0 > 0 ? a / shr0 : 1e9, shr1 > 0 ? (L - a) / shr1 : 1e9);
        if (rm > 0.3) ribW(B, Ss, Q(a, 0, t + ts * 0.5), Q(a, rm, ts * 0.5), ts);
      }
    }
  };
  const inX = [1, 0], inN = [0, 1];
  if (alongX) {
    const hipE = o.gable ? 0 : 1;
    plane([gx0, gn0], [gx1, gn0], inN, hb - ext, hipE, hipE);      // south slope
    plane([gx1, gn1], [gx0, gn1], [0, -1], hb - ext, hipE, hipE);  // north slope
    if (!o.gable) {
      plane([gx1, gn0], [gx1, gn1], [-1, 0], hb - ext, 1, 1);      // east hip end
      plane([gx0, gn1], [gx0, gn0], inX, hb - ext, 1, 1);          // west hip end
    }
  } else {
    const hipE = o.gable ? 0 : 1;
    plane([gx1, gn0], [gx1, gn1], [-1, 0], hb - ext, hipE, hipE);
    plane([gx0, gn1], [gx0, gn0], inX, hb - ext, hipE, hipE);
    if (!o.gable) {
      plane([gx0, gn0], [gx1, gn0], inN, hb - ext, 1, 1);
      plane([gx1, gn1], [gx0, gn1], [0, -1], hb - ext, 1, 1);
    }
  }
  // gable ends: the triangle walls
  let ridge;
  if (alongX) ridge = o.gable ? [[gx0, (gn0 + gn1) / 2], [gx1, (gn0 + gn1) / 2]] : [[gx0 + hb, (gn0 + gn1) / 2], [gx1 - hb, (gn0 + gn1) / 2]];
  else ridge = o.gable ? [[(gx0 + gx1) / 2, gn0], [(gx0 + gx1) / 2, gn1]] : [[(gx0 + gx1) / 2, gn0 + hb], [(gx0 + gx1) / 2, gn1 - hb]];
  if (o.gable && o.gableMat) {
    const Sg = B.S(o.gableMat);
    const ends = alongX ? [[[gx0, gn1], [gx0, gn0], -1], [[gx1, gn0], [gx1, gn1], 1]] : [[[gx0, gn0], [gx1, gn0], -1], [[gx1, gn1], [gx0, gn1], 1]];
    for (const [a, b] of ends) {
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const pa = G(a[0], a[1], yE), pb = G(b[0], b[1], yE), pm = G(m[0], m[1], yR);
      const e = [pb[0] - pa[0], 0, pb[2] - pa[2]];
      B.polyW(Sg, [pa, pb, pm], [e[2], 0, -e[0]]);
    }
  }
  if (ext > 0) {
    // the flat deck of a truncated hip
    const r = alongX ? B.rect(gx0 + (hb - ext), gx1 - (hb - ext), gn0 + (hb - ext), gn1 - (hb - ext)) : B.rect(gx0 + (hb - ext), gx1 - (hb - ext), gn0 + (hb - ext), gn1 - (hb - ext));
    B.deck(o.deckMat || mat, r, yTop + 0.01);
  }
  // the ridge and hip caps
  if (capMat && !ext) {
    const Sc = B.S(capMat), cw = o.capW ?? 0.16;
    const R0 = G(ridge[0][0], ridge[0][1], yR), R1 = G(ridge[1][0], ridge[1][1], yR);
    ribW(B, Sc, R0, R1, cw);
    if (o.crest) {   // ridge cresting: posts and a rail in o.crest's material
      const Sk = B.S(o.crest), d = [R1[0] - R0[0], R1[1] - R0[1], R1[2] - R0[2]], Lr = Math.hypot(...d), hc = o.crestH ?? 0.6;
      for (let q = 0.35; q < Lr; q += 0.55) { const p = [R0[0] + d[0] * q / Lr, R0[1] + cw / 2, R0[2] + d[2] * q / Lr]; ribW(B, Sk, p, [p[0], p[1] + hc * (q % 1.65 < 0.55 ? 1.25 : 1), p[2]], 0.05); }
      ribW(B, Sk, [R0[0], R0[1] + cw / 2 + hc, R0[2]], [R1[0], R1[1] + cw / 2 + hc, R1[2]], 0.06);
    }
    if (!o.gable) {
      const cs = alongX ? [[gx0, gn0, 0], [gx0, gn1, 0], [gx1, gn0, 1], [gx1, gn1, 1]] : [[gx0, gn0, 0], [gx1, gn0, 0], [gx0, gn1, 1], [gx1, gn1, 1]];
      for (const [cgx, cgn, end] of cs) ribW(B, Sc, G(cgx, cgn, yE + 0.04), end ? R1 : R0, cw);
    }
  }
  return { yR, ridge, alongX, hb };
}
// a square-section member between two world points (y absolute)
export function ribW(B, S, p0, p1, t) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(...d);
  if (L < 1e-3) return;
  const u = d.map((v) => v / L);
  const a = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let n1 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]];
  const l1 = Math.hypot(...n1); n1 = n1.map((v) => v / l1);
  const n2 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
  const h = t / 2, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const P = (o, s1, s2) => [o[0] + (n1[0] * s1 + n2[0] * s2) * h, o[1] + (n1[1] * s1 + n2[1] * s2) * h, o[2] + (n1[2] * s1 + n2[2] * s2) * h];
  for (let k = 0; k < 4; k++) {
    const [a1, b1] = C[k], [a2, b2] = C[(k + 1) % 4];
    const n = [(n1[0] * (a1 + a2) + n2[0] * (b1 + b2)), (n1[1] * (a1 + a2) + n2[1] * (b1 + b2)), (n1[2] * (a1 + a2) + n2[2] * (b1 + b2))];
    B.polyW(S, [P(p0, a1, b1), P(p0, a2, b2), P(p1, a2, b2), P(p1, a1, b1)], n);
  }
}
// a dormer on a roof slope: the eave along face frame F (u along it, w out), the slope rising inward at `pitch` from local
// height yE; the dormer's front at u0..u1, set back sb from the eave, h tall; a gabled cap (gable pitch gp). Its window glass.
export function dormer(B, F, wallMat, roofMat, glassMat, u0, u1, yE, pitch, sb, h, o = {}) {
  const tp = Math.tan(pitch), yb = yE + sb * tp, yt = yb + h, dd = h / tp + 0.3;   // the cheeks run back to the slope
  const wf = -sb, wb = -sb - dd;
  const Sw = B.S(wallMat);
  const um = (u0 + u1) / 2, gp = o.gp ?? 0.9, gh = (u1 - u0) / 2 * Math.tan(gp);
  // the front with the window hole
  const wi = (u1 - u0) * 0.24, hole = { u0: u0 + wi, u1: u1 - wi, y0: yb + 0.35, y1: yt - 0.35 };
  wallWithHoles(Sw, F, u0, u1, yb - 0.3, yt, [hole], wf);
  poly(Sw, F, [[u0, yt, wf], [u1, yt, wf], [um, yt + gh, wf]], 0, 0, 1);   // the gable
  // the cheeks
  poly(Sw, F, [[u0, yb - 0.3, wf], [u0, yt, wf], [u0, yt, wb], [u0, yb - 0.3, wf - 0.3 / tp]], -1, 0, 0);
  poly(Sw, F, [[u1, yb - 0.3, wf], [u1, yb - 0.3, wf - 0.3 / tp], [u1, yt, wb], [u1, yt, wf]], 1, 0, 0);
  // the reveals and the glass
  quadU(Sw, F, hole.u0, hole.y0, hole.y1, wf - 0.18, wf, 1);
  quadU(Sw, F, hole.u1, hole.y0, hole.y1, wf - 0.18, wf, -1);
  quadY(Sw, F, hole.u0, hole.u1, hole.y1, wf - 0.18, wf, -1);
  quadY(Sw, F, hole.u0, hole.u1, hole.y0, wf - 0.18, wf, 1);
  if (glassMat) B.pane(glassMat, F, [[hole.u0, hole.y0], [hole.u1, hole.y0], [hole.u1, hole.y1], [hole.u0, hole.y1]], wf - 0.18, o.info || {});
  // the cap: two slopes from the gable back to the main slope
  const Sr = B.S(roofMat), ov = 0.18;
  const nl = Math.hypot(Math.tan(gp), 1);
  poly(Sr, F, [[u0 - ov, yt - ov * Math.tan(gp), wf + ov], [um, yt + gh, wf + ov], [um, yt + gh, wb - gh / tp], [u0 - ov, yt - ov * Math.tan(gp), wb]], -Math.tan(gp) / nl, 1 / nl, 0);
  poly(Sr, F, [[u1 + ov, yt - ov * Math.tan(gp), wf + ov], [u1 + ov, yt - ov * Math.tan(gp), wb], [um, yt + gh, wb - gh / tp], [um, yt + gh, wf + ov]], Math.tan(gp) / nl, 1 / nl, 0);
}

// ---------------------------------------------------------------------------------------------- solids of revolution
// a lathe about world (cx, cz): prof [[r, y], ...] (y local height), n segments from angle a0 to a1; smooth normals along the
// profile where it turns less than 35 degrees
export function lathe(B, mat, cx, cz, prof, n = 24, a0 = 0, a1 = TAU) {
  const S = B.S(mat), m = prof.length, full = Math.abs(a1 - a0 - TAU) < 1e-6;
  // per-segment normals in (r, y)
  const sn = [];
  for (let i = 0; i + 1 < m; i++) {
    const dr = prof[i + 1][0] - prof[i][0], dy = prof[i + 1][1] - prof[i][1], L = Math.hypot(dr, dy) || 1;
    sn.push([dy / L, -dr / L]);
  }
  const acc = [0];
  for (let i = 1; i < m; i++) acc.push(acc[i - 1] + Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]));
  const cos35 = Math.cos(35 * Math.PI / 180);
  for (let i = 0; i + 1 < m; i++) {
    const nA = i > 0 && sn[i - 1][0] * sn[i][0] + sn[i - 1][1] * sn[i][1] > cos35 ? nrm2([sn[i - 1][0] + sn[i][0], sn[i - 1][1] + sn[i][1]]) : sn[i];
    const nB = i + 2 < m && sn[i + 1][0] * sn[i][0] + sn[i + 1][1] * sn[i][1] > cos35 ? nrm2([sn[i + 1][0] + sn[i][0], sn[i + 1][1] + sn[i][1]]) : sn[i];
    const [ra, ya] = prof[i], [rb, yb] = prof[i + 1];
    if (ra < 1e-4 && rb < 1e-4) continue;
    const base = S.n;
    for (let k = 0; k <= n; k++) {
      const a = a0 + (a1 - a0) * (k / n), c = Math.cos(a), s = Math.sin(a);
      const arcU = a * Math.max(ra, rb, 0.5);
      B.V(S, cx + c * ra, B.y0 + ya, cz + s * ra, c * nA[0], nA[1], s * nA[0], arcU, acc[i]);
      B.V(S, cx + c * rb, B.y0 + yb, cz + s * rb, c * nB[0], nB[1], s * nB[0], arcU, acc[i + 1]);
    }
    for (let k = 0; k < n; k++) {
      const p = base + k * 2;
      // (the profile runs bottom to top with r outward: (a, b, next b) faces out for increasing angle in x z with y up)
      S.tri(p, p + 1, p + 3); S.tri(p, p + 3, p + 2);
    }
    void full;
  }
}
const nrm2 = (v) => { const L = Math.hypot(v[0], v[1]) || 1; return [v[0] / L, v[1] / L]; };
// a cone laid in courses (stone or slate scales): from radius r0 at y0 to the apex at y1, courses of slant length ch, each
// lower edge proud by t; n facets
export function coursedCone(B, mat, cx, cz, r0, y0, y1, n = 32, ch = 0.45, t = 0.04, rTop = 0) {
  const sl = Math.hypot(r0 - rTop, y1 - y0), nC = Math.max(2, Math.round(sl / ch));
  const prof = [];
  const nr = (y1 - y0) / sl, ny = (r0 - rTop) / sl;   // the outward normal in (r, y)
  for (let k = 0; k < nC; k++) {
    const f0 = k / nC, f1 = (k + 1) / nC;
    const ra = r0 + (rTop - r0) * f0, ya = y0 + (y1 - y0) * f0, rb = r0 + (rTop - r0) * f1, yb = y0 + (y1 - y0) * f1;
    prof.push([ra, ya], [ra + nr * t, ya + ny * t], [rb, yb]);
  }
  // one lathe per course keeps the butt crisp: the profile's sharp turns stay faceted (lathe smooths below 35 degrees)
  lathe(B, mat, cx, cz, prof, n);
}

// a round tower as a many-faceted wall: n facets of radius r about world (cx, cz) from local y0 to y1; per facet the caller's
// function face(F, i, L) draws on it (openings, courses); returns the facet frames
export function towerFaces(B, cx, cz, r, y0, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU, b = ((i + 1) / n) * TAU;
    const pa = [cx + Math.cos(a) * r, cz + Math.sin(a) * r], pb = [cx + Math.cos(b) * r, cz + Math.sin(b) * r];
    let F = new Frame(pa, pb, B.y0, B.org);
    const mx = (pa[0] + pb[0]) / 2 - cx, mz = (pa[1] + pb[1]) / 2 - cz;
    if (F.nx * mx + F.nz * mz < 0) F = new Frame(pb, pa, B.y0, B.org);
    out.push(F);
  }
  return out;
}

// a column: base, shaft with entasis and n flutes (fluted: 2n-gon of alternating radii), at world (x, z) from local y0
export function column(B, mat, x, z, y0, h, r, o = {}) {
  const flutes = o.flutes ?? 24, n = flutes * 2, bh = o.baseH ?? r * 0.9;
  // the attic base: plinth, torus, scotia, torus
  lathe(B, mat, x, z, [[0, y0], [r * 1.45, y0], [r * 1.45, y0 + bh * 0.3], [r * 1.38, y0 + bh * 0.42], [r * 1.32, y0 + bh * 0.55], [r * 1.18, y0 + bh * 0.62],
    [r * 1.12, y0 + bh * 0.75], [r * 1.2, y0 + bh * 0.86], [r * 1.05, y0 + bh], [r, y0 + bh]], 24);
  // the fluted shaft as stacked rings (entasis)
  const S = B.S(mat), ys = y0 + bh, hs = h - bh - (o.capH ?? r * 1.0), rings = 6;
  for (let j = 0; j < rings; j++) {
    const fa = j / rings, fb = (j + 1) / rings;
    const rA = r * (1 - 0.16 * Math.pow(fa, 1.6)), rB = r * (1 - 0.16 * Math.pow(fb, 1.6));
    const ya = ys + hs * fa, yb = ys + hs * fb;
    const base = S.n;
    for (let k = 0; k <= n; k++) {
      const a = (k / n) * TAU, c = Math.cos(a), s = Math.sin(a), dk = k % 2 ? 0.93 : 1.0;
      // (the flute's floor faces out, the arris too: normals radial, slightly turned to the side for a rounded flute)
      const tw = (k % 2 ? 0 : 0.0);
      B.V(S, x + c * rA * dk, B.y0 + ya, z + s * rA * dk, c + tw, 0, s, a * r, ya);
      B.V(S, x + c * rB * dk, B.y0 + yb, z + s * rB * dk, c + tw, 0, s, a * r, yb);
    }
    for (let k = 0; k < n; k++) { const p = base + k * 2; S.tri(p, p + 1, p + 3); S.tri(p, p + 3, p + 2); }
  }
  const yc = ys + hs, rt = r * 0.84;
  return { yc, rt };
}
