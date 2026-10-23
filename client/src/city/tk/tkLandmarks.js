// Tower kit landmarks (TW): the towers that hold the skyline from Central Park and the air, on their compiled lots, built
// with the tower kit's own walls and parts (city/tk/tkBuild.js) on massing of their own: the podiums, shafts, setbacks
// and crowns the records do not carry (a record is one prism per footprint). A spec is data: masses in the lot's grid
// frame (gx along the streets toward the East River, gn along the avenues toward the north, metres from the footprint's
// centroid), each a stack of tiers; the facade parameters over the kit's (towerParams); the roof of each tier; a crown.
// They are 'replace' landmarks (shared/landmarkSpec.js, landmarks.js BUILDERS): the group comes back in the lot's own
// frame and assemble.js places it at the centroid on the ground.
import * as THREE from 'three';
import { Sink, edgeFrame, flatRing, quadW, quadY, quadU, poly, box as kbox } from '../fk/kitGeom.js';
import { towerParams, rng, LM_GLASS } from './tkParams.js';
import { buildTowerKit, tkGlassAttrs } from './tkBuild.js';
import { surfMat, partMat, cwGlassMat, holdNight, litWinMat } from './tkMats.js';

const GE = [0.8746, 0.4848], GN = [0.4848, -0.8746];   // the Manhattan grid's street (east) and avenue (north) axes, world x z

// ---------------------------------------------------------------- the lot's frame
const ONE3 = [1, 1, 1];
function lot(ctx) {
  const cx = ctx.cx, cz = ctx.cz;
  const W = (gx, gn) => [cx + gx * GE[0] + gn * GN[0], cz + gx * GE[1] + gn * GN[1]];
  const pos = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a > 0 ? r : r.slice().reverse(); };
  // the footprint's area centroid as a grid offset from (cx, cz), the mean of the ring's vertices: the vertex mean moves
  // with the ring's vertex count (30 Rockefeller Plaza's 13-vertex ring and the 12-vertex one of runs 7-9: 6.4 m), the
  // area centroid does not (1.8 m)
  let A2 = 0, ax = 0, az = 0;
  const F = ctx.footprint;
  for (let i = 0; i < F.length; i++) { const p = F[i], q = F[(i + 1) % F.length], c = p[0] * q[1] - q[0] * p[1]; A2 += c; ax += (p[0] + q[0]) * c; az += (p[1] + q[1]) * c; }
  ax = Math.abs(A2) > 1e-6 ? ax / (3 * A2) : 0; az = Math.abs(A2) > 1e-6 ? az / (3 * A2) : 0;
  const ga = [ax * GE[0] + az * GE[1], ax * GN[0] + az * GN[1]];
  return {
    cx, cz, y0: ctx.groundY, H: ctx.height,
    ring: pos(ctx.footprint.map(([x, z]) => [x + cx, z + cz])),
    // a rectangle gx0..gx1 x gn0..gn1
    rect: (gx0, gx1, gn0, gn1) => pos([W(gx0, gn0), W(gx1, gn0), W(gx1, gn1), W(gx0, gn1)]),
    // the same about the area centroid
    rectA: (gx0, gx1, gn0, gn1) => pos([W(gx0 + ga[0], gn0 + ga[1]), W(gx1 + ga[0], gn0 + ga[1]), W(gx1 + ga[0], gn1 + ga[1]), W(gx0 + ga[0], gn1 + ga[1])]),
    // a polygon of grid points
    poly: (pts) => pos(pts.map(([a, b]) => W(a, b))),
    // a rectangle with its corners cut by c (45 degrees)
    chamf: (gx0, gx1, gn0, gn1, c) => pos([W(gx0 + c, gn0), W(gx1 - c, gn0), W(gx1, gn0 + c), W(gx1, gn1 - c), W(gx1 - c, gn1), W(gx0 + c, gn1), W(gx0, gn1 - c), W(gx0, gn0 + c)]),
    W, pos,
  };
}

// ---------------------------------------------------------------- one landmark from its spec
// spec: { P: facade overrides, masses: (L) => [{ P, tiers: [{ ring, y1 (m above the ground), roof }], base }], crown(L, put) }
function buildSpec(key, spec, ctx) {
  const L = lot(ctx);
  const g = new THREE.Group();
  const inner = new THREE.Group();
  inner.position.set(-L.cx, -L.y0, -L.cz);   // everything below is in world coordinates
  g.add(inner);
  const org = [Math.round(L.cx), Math.round(L.cz)];
  const sinks = new Map();
  const sinkOf = (mat, we) => {
    const base = (mat.userData && mat.userData.fkBase) || mat;
    let e = sinks.get(base);
    if (!e) sinks.set(base, (e = { mat: base, S: new Sink() }));
    // (a shared kit set drawn at its own tint is the base itself: its writer still gives aFkTr, at 1, as every mesh of a
    // shared base must; without it Unreal's binder multiplied the albedo by the uv channels it reads the tint from: the
    // roof decks came out pale green)
    e.S.we = we || null; e.S.tr = (mat.userData && mat.userData.fkTr) || (base.userData && base.userData.fkBaseHex ? ONE3 : null);
    return e.S;
  };
  const meshes = (out) => {
    for (const { mat, S } of out.sinks.values()) {
      const geo = S.build();
      if (!geo) continue;
      const gl = out.glass && out.glass.get(mat);
      if (gl) tkGlassAttrs(geo, gl);
      const m = new THREE.Mesh(geo, mat);
      m.position.set(out.org[0], 0, out.org[1]);
      inner.add(m);
      if (mat.userData && mat.userData.tkNightOnly) holdNight(m);   // the packages' night windows: drawn for the baker only
    }
    for (const e of out.inst.values()) {
      const n = e.M.length / 16;
      const im = new THREE.InstancedMesh(e.geo, e.mat, n);
      im.instanceMatrix.array.set(e.M);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = !!e.shadow;
      im.name = 'tw:' + key + ':' + e.geo.userData.tkProto;
      inner.add(im);
    }
  };
  const masses = spec.masses(L);
  const base = { style: spec.style ?? 11, color: spec.color || [120, 130, 140], floorH: spec.P.floorH || 3.8, winW: spec.P.winW || 1.6,
    storeH: 0, flags: 0, colorVar: spec.seed ?? 0.37, lit: 0.55 };
  let mi = 0;
  for (const M of masses) {
    const tiers = [];
    let y = L.y0 + (M.y0 || 0);
    for (const t of M.tiers) { tiers.push({ ring: t.ring, y0: y, y1: L.y0 + t.y1, blind: 0, store: false, roof: t.roof }); y = L.y0 + t.y1; }
    const H = y - L.y0;
    const rec = { ...base, ...(M.rec || {}), key: key + ':' + mi, tiers, baseY: L.y0 + (M.y0 || 0), height: H - (M.y0 || 0), cx: L.cx, cz: L.cz, ring: tiers[0].ring, doorI: -1, doorPack: 0 };
    const P = Object.assign(towerParams(rec, null), spec.P, M.P || {});
    if (M.y0) P.lobbyH = 0;
    P.nightQuads = true;   // (held hidden: holdNight)
    const out = buildTowerKit(rec, P);
    meshes(out);
    // the roofs: a deck on each tier's top, a parapet on its edge (the next tier stands on the deck)
    for (let ti = 0; ti < tiers.length; ti++) {
      const T = tiers[ti], R = T.roof || M.roof || spec.roof || {};
      if (R.none) continue;
      const deck = surfMat(R.deck || 'roof_membrane', R.deckTint || null);
      flatRing(sinkOf(deck), T.ring, T.y1 + 0.02, org);
      // the parapet, but not along an edge the next tier rises from (its wall would stand in the parapet's plane)
      const next = tiers[ti + 1] ? tiers[ti + 1].ring : null;
      if (R.parapet !== 0) parapet(sinkOf(surfMat(R.set || P.trimSet || 'stone_lime', R.tint || null)), T.ring, T.y1, R.parapet ?? 1.1, R.depth ?? 0.35, org, next);
    }
    mi++;
  }
  if (spec.crown) spec.crown(L, { sinkOf, org, inner, partMat, surfMat, cwGlassMat });
  for (const { mat, S } of sinks.values()) {
    const geo = S.build();
    if (!geo) continue;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(org[0], 0, org[1]);
    inner.add(m);
    if (mat.userData && mat.userData.tkNightOnly) holdNight(m);   // (a crown's night windows: S125 w53)
  }
  g.userData.tw = key;
  return g;
}

// a parapet on a ring: the outer face flush with the kit's walls, the coping, the inner face
function onRing(r, x, z, tol = 0.15) {
  for (let i = 0; i < r.length; i++) {
    const A = r[i], B = r[(i + 1) % r.length], ex = B[0] - A[0], ez = B[1] - A[1], L2 = ex * ex + ez * ez;
    const t = L2 ? Math.max(0, Math.min(1, ((x - A[0]) * ex + (z - A[1]) * ez) / L2)) : 0;
    if (Math.hypot(x - (A[0] + ex * t), z - (A[1] + ez * t)) < tol) return true;
  }
  return false;
}
function parapet(S, ring, y, h, d, org, next = null) {
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
    if (L < 0.05) continue;
    if (next && onRing(next, (A[0] + B[0]) / 2, (A[1] + B[1]) / 2)) continue;
    const F = edgeFrame(ring, i, 0, org);
    quadW(S, F, -0.03, L + 0.03, y, y + h, 0.03);
    quadY(S, F, -0.03, L + 0.03, y + h, -d, 0.06, 1);
    quadW(S, F, 0.03 + d * 0, L - 0.03, y, y + h, -d, true);
  }
}

// a curved step (One57's cascade): over edge i of a lower tier's ring, a quarter ellipse from the wall's top (vertical
// tangent) up and in to the next tier's face `depth` metres back and `hc` metres higher (horizontal tangent), with its ends
// closed; it covers the terrace deck and the foot of the wall behind it
function sweep(S, ring, i, y, depth, hc, org, segs = 10) {
  const A = ring[i], B = ring[(i + 1) % ring.length];
  const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
  const F = edgeFrame(ring, i, 0, org);
  const V = (u, w, yy, nw, ny, tu, tv) => S.v(F.ox + u * F.ux + w * F.nx, F.y0 + yy, F.oz + u * F.uz + w * F.nz, nw * F.nx, ny, nw * F.nz, tu, tv, 0);
  const prof = [];
  for (let k = 0; k <= segs; k++) {
    const a = (k / segs) * Math.PI / 2;
    const w = -depth * (1 - Math.cos(a)), yy = y + hc * Math.sin(a);
    const tw = depth * Math.sin(a), ty = hc * Math.cos(a), tl = Math.hypot(tw, ty) || 1;   // the tangent (inward, up)
    prof.push([w, yy, ty / tl, tw / tl]);                                                   // the normal (outward, up)
  }
  let arc = 0;
  for (let k = 0; k < segs; k++) {
    const [w0, y0, nw0, ny0] = prof[k], [w1, y1, nw1, ny1] = prof[k + 1];
    const d = Math.hypot(w1 - w0, y1 - y0);
    const b = S.n;
    V(-0.03, w0 + 0.03, y0, nw0, ny0, 0, arc); V(L + 0.03, w0 + 0.03, y0, nw0, ny0, L, arc);
    V(L + 0.03, w1 + 0.03, y1, nw1, ny1, L, arc + d); V(-0.03, w1 + 0.03, y1, nw1, ny1, 0, arc + d);
    S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3);
    arc += d;
  }
  // the ends: a fan from the back corner (w = -depth, y) to the profile, facing -u and +u
  for (const [u, sg] of [[-0.03, -1], [L + 0.03, 1]]) {
    const b = S.n;
    const nx = F.ux * sg, nz = F.uz * sg;
    S.v(F.ox + u * F.ux + (-depth) * F.nx, y, F.oz + u * F.uz + (-depth) * F.nz, nx, 0, nz, 0, 0, 0);
    for (const [w, yy] of prof) S.v(F.ox + u * F.ux + (w + 0.03) * F.nx, yy, F.oz + u * F.uz + (w + 0.03) * F.nz, nx, 0, nz, w, yy - y, 0);
    for (let k = 0; k < segs; k++) { if (sg > 0) S.tri(b, b + 1 + k, b + 2 + k); else S.tri(b, b + 2 + k, b + 1 + k); }
  }
}

// a pyramid (or a tapered cap) over a ring: to `apex` height, optionally truncated at a top ring scaled by `topK`
function pyramid(S, ring, y0, y1, org, topK = 0) {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const ox = org[0], oz = org[1];
  for (let i = 0; i < ring.length; i++) {
    const A = ring[i], B = ring[(i + 1) % ring.length];
    const At = [cx + (A[0] - cx) * topK, cz + (A[1] - cz) * topK], Bt = [cx + (B[0] - cx) * topK, cz + (B[1] - cz) * topK];
    const ex = B[0] - A[0], ez = B[1] - A[1], el = Math.hypot(ex, ez) || 1;
    const nx = ez / el, nz = -ex / el;
    const mx = (A[0] + B[0]) / 2, mz = (A[1] + B[1]) / 2, run = Math.hypot(mx - cx, mz - cz) * (1 - topK) || 1;
    const rise = y1 - y0, nl = Math.hypot(rise, run) || 1;
    const N = [nx * rise / nl, run / nl, nz * rise / nl];
    const b = S.n;
    S.v(A[0] - ox, y0, A[1] - oz, ...N, 0, 0, 0); S.v(B[0] - ox, y0, B[1] - oz, ...N, el, 0, 0);
    S.v(Bt[0] - ox, y1, Bt[1] - oz, ...N, el, rise, 0); S.v(At[0] - ox, y1, At[1] - oz, ...N, 0, rise, 0);
    S.tri(b, b + 2, b + 1); S.tri(b, b + 3, b + 2);   // a positive ring: (B - A) x (Bt - A) points in, so the other way round
  }
  if (topK > 0) flatRing(S, ring.map(([x, z]) => [cx + (x - cx) * topK, cz + (z - cz) * topK]), y1, org);
}
// S125 (2026-10-16): fluted piers standing out of face i of a ring (the face frame's u along it, w out of it), one every
// `pitch` m between the corners, `wid` wide, their fronts at depth d(y, k) (k the pier's index), sampled every `step` m of
// height from y0 to y1 (world y): the front and both cheeks, each a strip whose normal leans with the front's slope
function ribPiers(S, ring, i, org, y0, y1, o) {
  const F = edgeFrame(ring, i, 0, org);
  const L = F.L, n = Math.max(1, Math.round((L - o.wid) / o.pitch)), pitch = (L - o.wid) / n;
  const ys = [];
  for (let y = y0; y < y1 - 1e-3; y += o.step) ys.push(y);
  ys.push(y1);
  for (let k = 0; k <= n; k++) {
    const u0 = k * pitch, u1 = u0 + o.wid;
    for (let j = 0; j + 1 < ys.length; j++) {
      const ya = ys[j], yb = ys[j + 1], wa = o.d(ya, k, n), wb = o.d(yb, k, n);
      const sl = (wb - wa) / Math.max(yb - ya, 1e-3), nl = Math.hypot(1, sl);
      poly(S, F, [[u0, ya, wa], [u1, ya, wa], [u1, yb, wb], [u0, yb, wb]], 0, -sl / nl, 1 / nl);
      poly(S, F, [[u0, ya, 0.01], [u0, ya, wa], [u0, yb, wb], [u0, yb, 0.01]], -1, 0, 0);
      poly(S, F, [[u1, ya, 0.01], [u1, yb, 0.01], [u1, yb, wb], [u1, ya, wa]], 1, 0, 0);
      if (o.flutes) {   // two shallow grooves down the front (a darker strip of the same glaze, set back 4 cm)
        for (const f of [0.33, 0.67]) {
          const c = u0 + o.wid * f;
          poly(o.flutes, F, [[c - 0.035, ya, wa + 0.004], [c + 0.035, ya, wa + 0.004], [c + 0.035, yb, wb + 0.004], [c - 0.035, yb, wb + 0.004]], 0, -sl / nl, 1 / nl);
        }
      }
    }
    if (o.cap) {   // the pier's top
      const w = o.d(y1, k, n);
      poly(S, F, [[u0, y1, 0.01], [u1, y1, 0.01], [u1, y1, w], [u0, y1, w]], 0, 1, 0);
    }
  }
  return n + 1;
}
// a straight member of square section from (x0, y0, z0) to (x1, y1, z1) (world), its four sides
function rib(S, x0, y0, z0, x1, y1, z1, t, org) {
  const d = [x1 - x0, y1 - y0, z1 - z0], L = Math.hypot(...d), u = d.map((v) => v / L);
  const a = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const n1 = [u[1] * a[2] - u[2] * a[1], u[2] * a[0] - u[0] * a[2], u[0] * a[1] - u[1] * a[0]], l1 = Math.hypot(...n1);
  for (let i = 0; i < 3; i++) n1[i] /= l1;
  const n2 = [u[1] * n1[2] - u[2] * n1[1], u[2] * n1[0] - u[0] * n1[2], u[0] * n1[1] - u[1] * n1[0]];
  const h = t / 2, C = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
  const P = (o, s1, s2) => [o[0] + (n1[0] * s1 + n2[0] * s2) * h - org[0], o[1] + (n1[1] * s1 + n2[1] * s2) * h, o[2] + (n1[2] * s1 + n2[2] * s2) * h - org[1]];
  for (let k = 0; k < 4; k++) {
    const [a1, b1] = C[k], [a2, b2] = C[(k + 1) % 4];
    const nx = (n1[0] * (a1 + a2) + n2[0] * (b1 + b2)) / 2, ny = (n1[1] * (a1 + a2) + n2[1] * (b1 + b2)) / 2, nz = (n1[2] * (a1 + a2) + n2[2] * (b1 + b2)) / 2, nl = Math.hypot(nx, ny, nz);
    const p = [P([x0, y0, z0], a1, b1), P([x0, y0, z0], a2, b2), P([x1, y1, z1], a2, b2), P([x1, y1, z1], a1, b1)];
    const b = S.n;
    for (const q of p) S.v(q[0], q[1], q[2], nx / nl, ny / nl, nz / nl, 0, 0, 0);
    // (wound outward: the cross of the first two edges against the side's normal)
    const e1 = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], e2 = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    if (cx * nx + cy * ny + cz * nz >= 0) { S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3); } else { S.tri(b, b + 2, b + 1); S.tri(b, b + 3, b + 2); }
  }
}
// a drum: the side of a truncated cone of n facets about (cx, cz) world, radii r0 at y0 to r1 at y1 (world y), and its lid
function drum(S, cx, cz, r0, r1, y0, y1, org, n = 16, lid = true) {
  const ox = org[0], oz = org[1];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const slope = (r0 - r1) / Math.max(1e-3, y1 - y0), nl = Math.hypot(1, slope);
    const N = [Math.cos(am) / nl, slope / nl, Math.sin(am) / nl];
    const b = S.n;
    S.v(cx + Math.cos(a0) * r0 - ox, y0, cz + Math.sin(a0) * r0 - oz, ...N, a0 * r0, 0, 0);
    S.v(cx + Math.cos(a0) * r1 - ox, y1, cz + Math.sin(a0) * r1 - oz, ...N, a0 * r1, y1 - y0, 0);
    S.v(cx + Math.cos(a1) * r1 - ox, y1, cz + Math.sin(a1) * r1 - oz, ...N, a1 * r1, y1 - y0, 0);
    S.v(cx + Math.cos(a1) * r0 - ox, y0, cz + Math.sin(a1) * r0 - oz, ...N, a1 * r0, 0, 0);
    S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3);   // (v1 - v0) x (v2 - v0) points out of the axis
  }
  if (lid && r1 > 0.01) {
    const ring = []; for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; ring.push([cx + Math.cos(a) * r1, cz + Math.sin(a) * r1]); }
    let A = 0; for (let i = 0; i < n; i++) { const p = ring[i], q = ring[(i + 1) % n]; A += p[0] * q[1] - q[0] * p[1]; }
    flatRing(S, A > 0 ? ring : ring.slice().reverse(), y1, org);
  }
}
const shrink = (ring, k) => {
  const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  return ring.map(([x, z]) => [cx + (x - cx) * k, cz + (z - cz) * k]);
};

// ---------------------------------------------------------------- faceted envelopes (S125 w53, 2026-10-17)
// 53 West 53rd's skin: planar facets (world triangles [x, y, z], wound counter-clockwise seen from outside), each with
// its curtain wall drawn in the facet's own plane: u level along it, v up its slope (u, v, n right-handed), the floors
// horizontal lines across it; the panes clipped to the facet; the mullions down the slope, the transoms on the floor
// lines; the structure as square-cut members along the facets' edges, proud of the glass, a block at each node
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const v3mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const v3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const v3x = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const v3n = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const v3lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
// the facet's frame about a fixed origin O (the lot's: coplanar facets share their pane grid)
function facetFrame(a, b, c, O) {
  const n = v3n(v3x(v3sub(b, a), v3sub(c, a)));
  let u = v3x([0, 1, 0], n);
  if (Math.hypot(u[0], u[1], u[2]) < 1e-3) u = [1, 0, 0];
  u = v3n(u);
  const v = v3x(n, u);
  const P2 = (p) => { const d = v3sub(p, O); return [v3dot(d, u), v3dot(d, v)]; };
  const W3 = (s, t, w = 0) => [O[0] + u[0] * s + v[0] * t + n[0] * w, O[1] + u[1] * s + v[1] * t + n[1] * w, O[2] + u[2] * s + v[2] * t + n[2] * w];
  // the plane's offset along n from O (the facet's points are at w = d)
  return { n, u, v, O, P2, W3, d: v3dot(v3sub(a, O), n) };
}
// a convex polygon (2D, counter-clockwise) clipped to a convex polygon (Sutherland-Hodgman)
function clip2(poly, clipR) {
  let out = poly;
  for (let i = 0; i < clipR.length && out.length; i++) {
    const A = clipR[i], B = clipR[(i + 1) % clipR.length];
    const side = (p) => (B[0] - A[0]) * (p[1] - A[1]) - (B[1] - A[1]) * (p[0] - A[0]);
    const inp = out; out = [];
    for (let k = 0; k < inp.length; k++) {
      const P = inp[k], Q = inp[(k + 1) % inp.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { const t = sp / (sp - sq); out.push([P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t]); }
    }
  }
  return out;
}
const area2 = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[i], r = p[(i + 1) % p.length]; a += q[0] * r[1] - r[0] * q[1]; } return a / 2; };
// the range of the line s = const (axis 0) or t = const (axis 1) inside a convex polygon
function span2(poly, axis, c) {
  let lo = Infinity, hi = -Infinity;
  const o = 1 - axis;
  for (let i = 0; i < poly.length; i++) {
    const P = poly[i], Q = poly[(i + 1) % poly.length];
    if ((P[axis] - c) * (Q[axis] - c) > 0 || P[axis] === Q[axis]) continue;
    const t = (c - P[axis]) / (Q[axis] - P[axis]), x = P[o] + (Q[o] - P[o]) * t;
    lo = Math.min(lo, x); hi = Math.max(hi, x);
  }
  return hi > lo ? [lo, hi] : null;
}
// a planar polygon of facet coordinates (s, t) at offset w (from the facet's plane) into S, facing n
function facetPoly(S, F, pts, w, org, uv) {
  if (pts.length < 3) return;
  const b = S.n;
  for (const [s, t] of pts) {
    const p = F.W3(s, t, F.d + w);
    S.v(p[0] - org[0], p[1], p[2] - org[1], F.n[0], F.n[1], F.n[2], uv ? uv(s, t)[0] : s, uv ? uv(s, t)[1] : t, 0);
  }
  for (let i = 1; i + 1 < pts.length; i++) S.tri(b, b + i, b + i + 1);
}
// a strip standing on the facet: the rectangle s0..s1 x t0..t1, its front at w = d (normal n), its two long cheeks
// (normals -/+ the axis across it: 'u' strips run along t, 'v' strips along s)
function facetStrip(S, F, s0, s1, t0, t1, d, along, org) {
  facetPoly(S, F, [[s0, t0], [s1, t0], [s1, t1], [s0, t1]], d, org);
  const q = (pa, pb, nrm) => {   // the cheek from the plane (w 0) to the front (w d) between two facet points
    const p0 = F.W3(pa[0], pa[1], F.d), p1 = F.W3(pb[0], pb[1], F.d), p2 = F.W3(pb[0], pb[1], F.d + d), p3 = F.W3(pa[0], pa[1], F.d + d);
    const b = S.n, Lq = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
    [p0, p1, p2, p3].forEach((p, k) => S.v(p[0] - org[0], p[1], p[2] - org[1], nrm[0], nrm[1], nrm[2], k === 1 || k === 2 ? Lq : 0, k >= 2 ? d : 0, 0));
    const e = v3x(v3sub(p1, p0), v3sub(p2, p0));
    if (v3dot(e, nrm) >= 0) { S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3); } else { S.tri(b, b + 2, b + 1); S.tri(b, b + 3, b + 2); }
  };
  if (along === 't') { q([s0, t0], [s0, t1], v3mul(F.u, -1)); q([s1, t0], [s1, t1], F.u); }
  else { q([s0, t0], [s1, t0], v3mul(F.v, -1)); q([s0, t1], [s1, t1], F.v); }
}
// a member of the structure from p0 to p1 (world), its face out along N (orthogonalised to it), w wide, from `back`
// behind the glass to `out` in front of it (the two cheeks, the front; the ends are inside the nodes' blocks)
function member(S, p0, p1, N, w, out, back, org) {
  const d = v3n(v3sub(p1, p0));
  const n = v3n(v3sub(N, v3mul(d, v3dot(N, d))));
  const t = v3n(v3x(n, d));
  const h = w / 2;
  const P = (p, a, b) => [p[0] + t[0] * a + n[0] * b, p[1] + t[1] * a + n[1] * b, p[2] + t[2] * a + n[2] * b];
  const sides = [[[-h, out], [h, out], n], [[h, -back], [h, out], t], [[-h, out], [-h, -back], v3mul(t, -1)]];
  for (const [[a0, b0], [a1, b1], nr] of sides) {
    const q = [P(p0, a0, b0), P(p0, a1, b1), P(p1, a1, b1), P(p1, a0, b0)];
    const bi = S.n;
    const L = Math.hypot(...v3sub(p1, p0));
    q.forEach((p, k) => S.v(p[0] - org[0], p[1], p[2] - org[1], nr[0], nr[1], nr[2], k === 1 || k === 2 ? w : 0, k >= 2 ? L : 0, 0));
    const e = v3x(v3sub(q[1], q[0]), v3sub(q[2], q[0]));
    if (v3dot(e, nr) >= 0) { S.tri(bi, bi + 1, bi + 2); S.tri(bi, bi + 2, bi + 3); } else { S.tri(bi, bi + 2, bi + 1); S.tri(bi, bi + 3, bi + 2); }
  }
}
// a node's block: a box s across, from `back` behind the glass to `out` in front, its faces square to N
function nodeBlock(S, p, N, s, out, back, org) {
  const n = v3n(N);
  let a = v3x([0, 1, 0], n);
  if (Math.hypot(...a) < 1e-3) a = [1, 0, 0];
  a = v3n(a);
  const b = v3x(n, a), h = s / 2;
  const C = (x, y, z) => [p[0] + a[0] * x + b[0] * y + n[0] * z, p[1] + a[1] * x + b[1] * y + n[1] * z, p[2] + a[2] * x + b[2] * y + n[2] * z];
  const faces = [
    [[C(-h, -h, out), C(h, -h, out), C(h, h, out), C(-h, h, out)], n],
    [[C(h, -h, -back), C(h, h, -back), C(h, h, out), C(h, -h, out)], a],
    [[C(-h, h, -back), C(-h, -h, -back), C(-h, -h, out), C(-h, h, out)], v3mul(a, -1)],
    [[C(h, h, -back), C(-h, h, -back), C(-h, h, out), C(h, h, out)], b],
    [[C(-h, -h, -back), C(h, -h, -back), C(h, -h, out), C(-h, -h, out)], v3mul(b, -1)],
  ];
  for (const [q, nr] of faces) {
    const bi = S.n;
    q.forEach((pp, k) => S.v(pp[0] - org[0], pp[1], pp[2] - org[1], nr[0], nr[1], nr[2], k === 1 || k === 2 ? s : 0, k >= 2 ? s : 0, 0));
    const e = v3x(v3sub(q[1], q[0]), v3sub(q[2], q[0]));
    if (v3dot(e, nr) >= 0) { S.tri(bi, bi + 1, bi + 2); S.tri(bi, bi + 2, bi + 3); } else { S.tri(bi, bi + 2, bi + 1); S.tri(bi, bi + 3, bi + 2); }
  }
}
const hsh = (a, b, c = 0) => { const x = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return x - Math.floor(x); };
// the curtain wall of facet (a, b, c): per floor and bay a spandrel band over the slab and the vision pane above it, each
// clipped to the facet; the mullions every bay down the slope, the transoms on the slab lines. o: { O, org, slabs (world
// heights, rising), pw (the bay), spH (the band), glass(k, j, h) -> { S, GW, GS } (the vision pane's sink, by bay, floor
// and the facet's hash), spand (sink), mull (sink), mW, mD, tW, tD, lit(k, j, h) -> sink | null (the night window) }
function facetSkin(a, b, c, o) {
  const F = facetFrame(a, b, c, o.O);
  if (F.v[1] < 0.08) return 0;   // (no level glass: a facet this flat is a roof)
  const T = [F.P2(a), F.P2(b), F.P2(c)];
  if (area2(T) < 0.5) return 0;
  const tOf = (y) => (y - o.O[1] - F.n[1] * F.d) / F.v[1];
  const s0 = Math.min(T[0][0], T[1][0], T[2][0]), s1 = Math.max(T[0][0], T[1][0], T[2][0]);
  const y0 = Math.min(a[1], b[1], c[1]), y1 = Math.max(a[1], b[1], c[1]);
  const h = hsh(Math.round(F.n[0] * 50), Math.round(F.n[2] * 50), Math.round(F.n[1] * 50));
  const { org, pw, spH, slabs } = o;
  let panes = 0;
  for (let j = 0; j + 1 < slabs.length; j++) {
    const ya = slabs[j], yb = slabs[j + 1];
    if (yb <= y0 || ya >= y1) continue;
    const ta = tOf(ya), tm = tOf(ya + spH), tb = tOf(yb);
    for (let k = Math.floor(s0 / pw); k * pw < s1; k++) {
      const sa = k * pw, sb = sa + pw;
      const sp = clip2([[sa, ta], [sb, ta], [sb, tm], [sa, tm]], T);
      if (sp.length >= 3 && area2(sp) > 1e-3) facetPoly(o.spand, F, sp, 0, org);
      const vp = clip2([[sa, tm], [sb, tm], [sb, tb], [sa, tb]], T);
      if (vp.length < 3 || area2(vp) < 1e-3) continue;
      const g = o.glass(k, j, h), n0 = g.S.n;
      facetPoly(g.S, F, vp, 0, org, (s, t) => [(s - sa) / pw, (t - tm) / (tb - tm)]);
      for (let i = n0; i < g.S.n; i++) {
        g.GW[i * 4] = k; g.GW[i * 4 + 1] = j; g.GW[i * 4 + 2] = h * 37.0; g.GW[i * 4 + 3] = 3.0;
        g.GS[i * 4] = pw; g.GS[i * 4 + 1] = tb - tm; g.GS[i * 4 + 2] = spH; g.GS[i * 4 + 3] = yb - ya;
      }
      const lit = o.lit && o.lit(k, j, h);
      if (lit) facetPoly(lit, F, vp, 0.03, org);
      panes++;
    }
  }
  // the mullions (down the slope, every bay) and the transoms (the slab's line and the band's top), in front of the glass
  for (let k = Math.ceil(s0 / pw); k * pw < s1; k++) {
    const r = span2(T, 0, k * pw);
    if (r && r[1] - r[0] > 0.2) facetStrip(o.mull, F, k * pw - o.mW / 2, k * pw + o.mW / 2, r[0], r[1], o.mD, 't', org);
    // (the finer order: a slim mullion at each half bay, set back behind the bay's)
    const rh = span2(T, 0, (k + 0.5) * pw);
    if (rh && rh[1] - rh[0] > 0.2) facetStrip(o.mull, F, (k + 0.5) * pw - o.mW * 0.3, (k + 0.5) * pw + o.mW * 0.3, rh[0], rh[1], o.mD * 0.55, 't', org);
  }
  for (const ya of slabs) {
    for (const [y, w] of [[ya, o.tW], [ya + spH, o.tW * 0.6]]) {
      if (y <= y0 || y >= y1) continue;
      const t = tOf(y), r = span2(T, 1, t);
      if (r && r[1] - r[0] > 0.2) facetStrip(o.mull, F, r[0], r[1], t - w / 2, t + w / 2, o.tD, 's', org);
    }
  }
  return panes;
}

const { COBALT, SKYBLUE, SILVERW, CLEARG, BLACKG, GOLDG, BRONZEK } = LM_GLASS;

// 53 West 53rd's lot frame: grid offsets measured on the compiled ring (tile -2_4 #89, 12 vertices) from its vertex mean,
// held to the ring's area centroid (-5.59, -1.85 in that frame) so a ring of other vertices keeps them in place
function w53G(L) {
  const c = L.rectA(0, 0, 0, 0)[0], dx = c[0] - L.cx, dz = c[1] - L.cz;
  const ga = [dx * GE[0] + dz * GE[1], dx * GN[0] + dz * GN[1]];
  return (gx, gn) => L.W(gx + 5.59 + ga[0], gn + 1.85 + ga[1]);
}
// the shaft's corners (counter-clockwise from the south-west, the lot's L: the west face jogs at the middle of the
// block), each a run of [y, gx, gn] it moves along straight between: the gallery floors upright to 30 m, then the north
// and the south faces both leaning in (about 5 degrees, steeper above 160 m) toward the ridge at the block's middle,
// the east and west faces near upright, the jog closing as it rises
const W53_CORNERS = [
  [[0, -23.6, -33.9], [30, -23.6, -33.9], [160, -22.4, -23.5], [266, -20.2, -13.5]],   // south-west
  [[0, 3.1, -33.9], [30, 3.1, -33.9], [160, 2.6, -23.5], [266, 1.3, -14.1]],           // south-east
  [[0, 3.1, -3.3], [30, 3.1, -3.3], [160, 2.9, -5.0], [266, 1.8, -6.2]],               // the east face's fold
  [[0, 3.1, 27.3], [30, 3.1, 25.5], [160, 2.4, 12.0], [266, 0.8, 1.4]],                // north-east
  [[0, -17.6, 27.3], [30, -17.6, 25.5], [160, -19.5, 12.0], [266, -19.5, 1.4]],        // north-west
  [[0, -17.5, -3.3], [30, -17.5, -3.3], [160, -20.8, -4.5], [266, -20.2, -5.7]],       // the jog (in)
  [[0, -23.6, -3.2], [30, -23.6, -3.2], [160, -22.0, -4.8], [266, -20.1, -6.0]],       // the jog (out)
];
// the ridge over the block's middle from west to east, [gx, gn, y]: three summits, the west one the highest, the east
// one the lowest (from the south the top steps down to the east; from the west the three line up in one point), with
// a notch between each two
const W53_PEAKS = [[-16.5, -6.0, 320], [-11.6, -5.6, 295], [-7.0, -5.0, 306], [-3.4, -5.8, 283], [0.0, -6.5, 294]];
// the diagrid's node rows (m above the ground): irregular, a row at each fold of the corners' runs
const W53_ROWS = [0, 30, 58, 84, 111, 137, 160, 187, 213, 240, 266];
// the rows a level member runs round (the gallery floors' top; two ties high up, the upper one the shoulder under the
// summits: the reference's two light bands across the west face at about 213 and 266 m)
const W53_BELTS = [30, 213, 266];
const W53_SLABS = (() => { const s = [0, 6.5, 12.5, 18.5, 24.5, 30.5]; while (s[s.length - 1] + 4.15 < 318) s.push(s[s.length - 1] + 4.15); return s; })();

function w53Corner(run, y) {
  for (let i = 0; i + 1 < run.length; i++) {
    const [y0, a0, b0] = run[i], [y1, a1, b1] = run[i + 1];
    if (y <= y1 || i + 2 === run.length) { const t = (y - y0) / (y1 - y0); return [a0 + (a1 - a0) * t, b0 + (b1 - b0) * t]; }
  }
  return null;
}
// the envelope: points (world [x, y, z]) and outward facets [i, j, k]
function w53Envelope(L) {
  const G = w53G(L), y0 = L.y0;
  const pts = [], key = new Map();
  const pt = (gx, gn, y) => {
    const k = Math.round(gx * 50) + ':' + Math.round(gn * 50) + ':' + Math.round(y * 50);
    let i = key.get(k);
    if (i === undefined) { const [x, z] = G(gx, gn); i = pts.length; pts.push([x, y0 + y, z]); key.set(k, i); }
    return i;
  };
  const nC = W53_CORNERS.length;
  const soft = new Set(), softT = new Set();
  // each row's nodes per side: [t, index]; even rows k segments, odd rows staggered by half a segment
  const rows = W53_ROWS.map((y, r) => {
    const C = W53_CORNERS.map((run) => w53Corner(run, y));
    const CI = C.map(([gx, gn]) => pt(gx, gn, y));
    const sides = [];
    for (let s = 0; s < nC; s++) {
      const A = C[s], B = C[(s + 1) % nC], len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const k = len < 4 ? 0 : Math.max(1, Math.floor(len / 20));
      const ts = [0];
      // (the nodes staggered row to row and side to side, slid along the side by up to a fifth of a bay, and now and
      // then left out: the triangles come out large and irregular, a single diagonal across a face where a row has none)
      if (k > 0 && r > 0 && hsh(r * 3.1, s * 1.7, 5.5) > 0.22) {
        const odd = (r + s) % 2 === 1;
        const n = odd ? k : k - 1;
        for (let i = 0; i < n; i++) {
          const t0 = odd ? (i + 0.5) / k : (i + 1) / k;
          ts.push(Math.min(0.9, Math.max(0.1, t0 + (hsh(r, s, i) - 0.5) * 0.4 / k)));
        }
      }
      if (r + 1 === W53_ROWS.length) {
        // (the shoulder: besides its diagrid nodes, soft ones every 6 m or so for the summits' fans to share out along
        // the ridge; their edges are folds of the glass, no members)
        const n = len < 4 ? 0 : Math.max(1, Math.round(len / 6) - 1);
        for (let i = 0; i < n; i++) {
          const t = (i + 1) / (n + 1);
          if (ts.every((u) => Math.abs(u - t) * len > 2.5)) { ts.push(t); softT.add(s + ':' + t); }
        }
        ts.sort((a, b) => a - b);
      }
      ts.push(1);
      // (the corners by their own index: a corner reached as the end of one side and the start of the next, rounded
      // apart, drew its members twice)
      sides.push(ts.map((t) => {
        const i = t === 0 ? CI[s] : t === 1 ? CI[(s + 1) % nC] : pt(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, y);
        if (softT.has(s + ':' + t)) soft.add(i);
        return [t, i];
      }));
    }
    return { y, C, sides };
  });
  const faces = [];
  const P = (i) => pts[i];
  // the strip of side s between two rows: advance along whichever row gives the shorter new diagonal
  for (let r = 0; r + 1 < rows.length; r++) {
    for (let s = 0; s < nC; s++) {
      const A = rows[r].sides[s], B = rows[r + 1].sides[s];
      let i = 0, j = 0;
      while (i + 1 < A.length || j + 1 < B.length) {
        let lower;
        if (i + 1 >= A.length) lower = false;
        else if (j + 1 >= B.length) lower = true;
        else {
          const dl = Math.hypot(...v3sub(P(A[i + 1][1]), P(B[j][1]))), du = Math.hypot(...v3sub(P(A[i][1]), P(B[j + 1][1])));
          lower = dl < du;
        }
        if (lower) { faces.push([A[i][1], A[i + 1][1], B[j][1]]); i++; } else { faces.push([A[i][1], B[j + 1][1], B[j][1]]); j++; }
      }
    }
  }
  // the cap: each node of the top row to its nearest summit, the turns between summits, the summits' own facet
  const top = rows[rows.length - 1];
  const ring = [];
  for (const sd of top.sides) for (let q = 0; q + 1 < sd.length; q++) ring.push(sd[q][1]);
  const pk = W53_PEAKS.map(([gx, gn, y]) => pt(gx, gn, y));
  const near = ring.map((i) => {
    let best = 0, bd = 1e9;
    for (let p = 0; p < pk.length; p++) { const d = Math.hypot(P(i)[0] - P(pk[p])[0], P(i)[2] - P(pk[p])[2]); if (d < bd) { bd = d; best = p; } }
    return best;
  });
  // (the ridge's points lie west to east and each side of the ring meets them in turn, so the turns use every ridge
  // edge from both sides and close the cap; a ridge edge met once is closed by the ridge's own fan)
  // the cap's members: the ridge, each shoulder corner to its summit, and the folds between the summits' facets (a
  // ring node to the two ridge points of a turn); the fans' other edges lie flat in their facet and carry none
  const used = new Map(), capM = new Set();
  const ek2 = (p, q) => (p < q ? p + ',' + q : q + ',' + p);
  const corners = new Set(top.sides.map((sd) => sd[0][1]));
  for (let p = 0; p + 1 < pk.length; p++) capM.add(ek2(pk[p], pk[p + 1]));
  for (let q = 0; q < ring.length; q++) {
    const a = ring[q], b = ring[(q + 1) % ring.length];
    let pa = near[q];
    const pb = near[(q + 1) % ring.length];
    faces.push([a, b, pk[pa]]);
    if (corners.has(a)) capM.add(ek2(a, pk[pa]));
    while (pa !== pb) {   // (a jump over a ridge point walks the ridge one edge at a time)
      const nx = pa + Math.sign(pb - pa);
      faces.push([b, pk[nx], pk[pa]]);
      capM.add(ek2(b, pk[nx])); capM.add(ek2(b, pk[pa]));
      const ek = Math.min(pa, nx) + ',' + Math.max(pa, nx);
      used.set(ek, (used.get(ek) || 0) + 1);
      pa = nx;
    }
  }
  for (let p = 0; p + 1 < pk.length; p++) if ((used.get(p + ',' + (p + 1)) || 0) < 2) faces.push([pk[0], pk[p], pk[p + 1]]);
  // wound outward: away from the axis (the centroid of the corners at the facet's height; the cap's from below it)
  const axis = (y) => {
    const yy = Math.min(Math.max(y - y0, 0), 266);
    let ax = 0, az = 0;
    for (const run of W53_CORNERS) { const [gx, gn] = w53Corner(run, yy); const [x, z] = G(gx, gn); ax += x; az += z; }
    return [ax / nC, Math.min(y, y0 + 250), az / nC];
  };
  const out = [];
  for (const f of faces) {
    const a = P(f[0]), b = P(f[1]), c = P(f[2]);
    const n = v3x(v3sub(b, a), v3sub(c, a));
    if (Math.hypot(...n) < 1e-4) continue;
    const m = v3mul(v3add(v3add(a, b), c), 1 / 3);
    out.push(v3dot(n, v3sub(m, axis(m[1]))) >= 0 ? f : [f[0], f[2], f[1]]);
  }
  return { pts, faces: out, G, capM, capY: y0 + top.y + 0.5, soft };
}
// the tower: its curtain wall facet by facet, the diagrid along the facets' edges, a block at each node
function w53Build(L, K) {
  const { pts, faces, capM, capY, soft } = w53Envelope(L);
  const org = K.org, O = [L.cx, L.y0, L.cz];
  // the glass: vision panes in three families (clear, silvered, dark: the tower's glass runs from dark to clear), each
  // a sink of its own with the rooms' side streams (tkGlassAttrs)
  const fams = [CLEARG, SILVERW, BLACKG];
  const GLS = fams.map(() => ({ S: new Sink(), GW: [], GS: [] }));
  const glass = (k, j, h) => {
    const r = hsh(Math.floor(k / 2) + h * 13.0, j * 0.37 + Math.floor(j / 3), 4.1);
    return GLS[r < 0.58 ? 0 : r < 0.84 ? 1 : 2];
  };
  const LIT = ['warm', 'cool', 'dim', 'hi'].map((k) => K.sinkOf(litWinMat(k)));
  const lit = (k, j, h) => {
    const r = hsh(k + h * 7.0, j, 9.3);
    if (r > 0.42) return null;
    const q = hsh(j, h * 3.0, 2.2);
    return LIT[q < 0.55 ? 0 : q < 0.68 ? 1 : q < 0.92 ? 2 : 3];
  };
  const we = [0.57, L.y0, L.y0 + 320];
  const spand = K.sinkOf(K.surfMat('panel_alu', '#9ea4a8'), we);   // (the slab's cover: the facade's fine light grid)
  const mull = K.sinkOf(K.partMat('alu_clear'));
  const conc = K.sinkOf(K.surfMat('concrete_smooth', '#a9a7a2'), we);
  const o = { O, org, slabs: W53_SLABS.map((y) => L.y0 + y), pw: 1.52, spH: 0.55, glass, spand, mull, lit,
    mW: 0.07, mD: 0.14, tW: 0.11, tD: 0.19 };
  // the facets' normals at each edge and node
  const edges = new Map(), nodeN = new Map();
  let panes = 0;
  for (const [i, j, k] of faces) {
    const a = pts[i], b = pts[j], c = pts[k];
    panes += facetSkin(a, b, c, o);
    const n = v3n(v3x(v3sub(b, a), v3sub(c, a)));
    for (const [p, q] of [[i, j], [j, k], [k, i]]) {
      const ek = p < q ? p + ',' + q : q + ',' + p;
      const e = edges.get(ek);
      if (e) { e.n = v3add(e.n, n); e.c++; } else edges.set(ek, { p: Math.min(p, q), q: Math.max(p, q), n, c: 1 });
    }
    for (const p of [i, j, k]) nodeN.set(p, v3add(nodeN.get(p) || [0, 0, 0], n));
  }
  // the diagrid: every edge that rises (the floors' level edges are the slabs' lines, no member), its width falling
  // with height from 1.25 m to 0.75 m; a block at each node of two members or more
  const deg = new Map(), rise = new Set();
  for (const e of edges.values()) {
    const A = pts[e.p], B = pts[e.q];
    if (Math.abs(A[1] - B[1]) < 0.5 && !W53_BELTS.some((b) => Math.abs(A[1] - L.y0 - b) < 0.5)) continue;
    if (Math.max(A[1], B[1]) > capY && !capM.has(e.p + ',' + e.q)) continue;
    if ((soft.has(e.p) || soft.has(e.q)) && Math.abs(A[1] - B[1]) >= 0.5 && !capM.has(e.p + ',' + e.q)) continue;
    const ym = (A[1] + B[1]) / 2 - L.y0, w = 1.6 - 0.6 * Math.min(1, ym / 320);
    member(conc, A, B, v3n(e.n), w, 0.42, 0.6, org);
    deg.set(e.p, (deg.get(e.p) || 0) + 1); deg.set(e.q, (deg.get(e.q) || 0) + 1);
    if (Math.abs(A[1] - B[1]) >= 0.5) { rise.add(e.p); rise.add(e.q); }
  }
  for (const [p, d] of deg) {
    const P = pts[p], y = P[1] - L.y0;
    if (d < 2 || y < 0.5 || !rise.has(p)) continue;   // (a node only where a diagonal lands, not along a tie)
    if (y > 286) continue;   // (the summits: the members meet in a point)
    nodeBlock(conc, P, nodeN.get(p), 1.95 - 0.6 * Math.min(1, y / 320), 0.5, 0.6, org);
  }
  for (const g of GLS) {
    const geo = g.S.build();
    if (!geo) continue;
    tkGlassAttrs(geo, g);
    const m = new THREE.Mesh(geo, cwGlassMat(fams[GLS.indexOf(g)]));
    m.position.set(org[0], 0, org[1]);
    K.inner.add(m);
  }
  return { panes, facets: faces.length, members: deg.size };
}


// 111 West 57th's tiers in the lot's grid frame: the hall on the 57th Street end, the tower's south face stepping north
function SW_TIERS(L) {
  let x0 = 1e9, x1 = -1e9, n0 = 1e9, n1 = -1e9;
  for (const [x, z] of L.ring) {
    const dx = x - L.cx, dz = z - L.cz, gx = dx * GE[0] + dz * GE[1], gn = dx * GN[0] + dz * GN[1];
    x0 = Math.min(x0, gx); x1 = Math.max(x1, gx); n0 = Math.min(n0, gn); n1 = Math.max(n1, gn);
  }
  const ce = (x0 + x1) / 2, hn = n0 + 27.5, tn1 = n1 - 1.0;
  const e0 = ce - 9.2, e1 = ce + 9.2;
  // [top of the tier, the south face's set-back from the hall's back wall]
  const S = [[258, 0], [287, 3.0], [314, 6.0], [338, 9.0], [360, 12.0], [380, 15.0], [397, 18.0], [411, 20.5], [424, 23.0], [435, 25.0]];
  return { x0, x1, n0, n1, hn, tn1, e0, e1, tiers: S.map(([y, b]) => ({ y, s: hn + b })) };
}

// ---------------------------------------------------------------- the specs
export const TW_SPECS = {
  // One57 (157 W 57th St; Christian de Portzamparc, 2014; 306 m, 75 floors): a curtain wall of vertical stripes in two
  // blues, the hotel base on 57th Street, the tower's top falling toward the park in curved steps
  one57: {
    style: 11, color: [70, 100, 150], seed: 0.61,
    P: { arch: 'cwSuper', floorH: 4.05, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.12, spandrelH: 0.35, spandrelHex: '#2b3a52',
      glassOf: (f, c) => ((Math.floor(c / 2) * 7 + f * 3) % 5 < 2 ? SKYBLUE : COBALT) },
    masses: (L) => [
      // the hotel base on 57th Street (east wing)
      { tiers: [{ ring: L.poly([[0, -30.1], [30.6, -30.1], [30.6, -8.7], [10.6, -8.6], [10.6, 0.5], [0, 0.5]]), y1: 68 }],
        P: { arch: 'cwGrid', famObj: COBALT } },
      // the tower: the lot's west strip from 57th to 58th, its top stepping down to the north in curved steps
      { tiers: [
        { ring: L.poly([[-18, -29.9], [0, -29.9], [0, 31.3], [-23.0, 31.0], [-23.5, 7.0], [-18.0, 7.1]]), y1: 196 },
        { ring: L.rect(-23, 0, -29.9, 21), y1: 232 },
        { ring: L.rect(-23, 0, -29.9, 11), y1: 262 },
        { ring: L.rect(-23, 0, -26, 1), y1: 288 },
        { ring: L.rect(-21, -2, -22, -8), y1: 306 },
      ], roof: { parapet: 0, deck: 'roof_membrane' } },
    ],
    crown: (L, K) => {
      const S = K.sinkOf(K.cwGlassMat(COBALT));
      // over each step the next one rises from, the north face curves up and back to it
      const T = [[L.rect(-23, 0, -29.9, 31.0), 196], [L.rect(-23, 0, -29.9, 21), 232], [L.rect(-23, 0, -29.9, 11), 262], [L.rect(-23, 0, -26, 1), 288]];
      const back = [10.0, 10.0, 10.0, 9.0];
      for (let t = 0; t < T.length; t++) {
        const [r, y] = T[t];
        for (let i = 0; i < r.length; i++) {
          const A = r[i], B = r[(i + 1) % r.length], ex = B[0] - A[0], ez = B[1] - A[1], el = Math.hypot(ex, ez);
          const nx = ez / el, nz = -ex / el;
          if (nx * GN[0] + nz * GN[1] > 0.9) sweep(S, r, i, L.y0 + y, back[t], Math.min(back[t] * 1.1, 14), K.org);
        }
      }
    },
  },

  // 220 Central Park South (Robert A.M. Stern, 2019; 290 m, 70 floors): a limestone tower on the park front, the 18-storey
  // villa on 58th Street, setbacks under a crown of corner pavilions and arched lanterns
  tw220cps: {
    style: 1, color: [214, 205, 186], seed: 0.43,
    P: { arch: 'masonry', wallSet: 'stone_lime_ashlar', hex: '#d9d0bc', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 4.12, winW: 2.25, bayFit: true, reveal: 0.30, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 0,
      cell: { x0: 0.16, x1: 0.84, y0: 0.22, y1: 0.86 } },
    masses: (L) => [
      { tiers: [{ ring: L.poly([[-32.6, -30.3], [27.8, -30.0], [27.8, -12.5], [5.0, -12.5], [5.0, 0.0], [-32.8, -0.1]]), y1: 72 }],
        P: { floorH: 3.95 } },
      { tiers: [
        { ring: L.rect(5.0, 27.6, -12.5, 30.1), y1: 214 },
        { ring: L.rect(6.4, 26.2, -11.0, 28.7), y1: 246 },
        { ring: L.rect(7.9, 24.7, -9.4, 27.2), y1: 266 },
      ] },
    ],
    crown: (L, K) => {
      const stone = K.surfMat('stone_lime', '#d6cdb9'), S = K.sinkOf(stone);
      const dark = K.sinkOf(K.cwGlassMat(BLACKG));
      // corner pavilions (lanterns) and the central crown with arched openings
      const pav = (gx, gn) => {
        const r = L.rect(gx - 2.6, gx + 2.6, gn - 2.6, gn + 2.6);
        for (let i = 0; i < 4; i++) {
          const A = r[i], B = r[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
          const F = edgeFrame(r, i, 0, K.org);
          quadW(S, F, 0, el, L.y0 + 266, L.y0 + 268.5, 0.02);
          quadW(dark, F, 0.9, el - 0.9, L.y0 + 268.5, L.y0 + 276.5, -0.25);
          quadW(S, F, 0, 0.9, L.y0 + 268.5, L.y0 + 276.5, 0.02); quadW(S, F, el - 0.9, el, L.y0 + 268.5, L.y0 + 276.5, 0.02);
          quadW(S, F, 0, el, L.y0 + 276.5, L.y0 + 279, 0.02);
        }
        pyramid(S, shrink(r, 1.08), L.y0 + 279, L.y0 + 282, K.org, 0.15);
      };
      pav(9.6, -7.6); pav(23.0, -7.6); pav(9.6, 25.4); pav(23.0, 25.4);
      const c = L.rect(11.5, 21.1, -4.5, 22.3);
      for (let i = 0; i < 4; i++) {
        const A = c[i], B = c[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const F = edgeFrame(c, i, 0, K.org);
        quadW(S, F, 0, el, L.y0 + 266, L.y0 + 270, 0.02);
        const n = Math.max(2, Math.round(el / 3.2));
        for (let k = 0; k < n; k++) {
          const u0 = (k / n) * el, u1 = ((k + 1) / n) * el;
          quadW(S, F, u0, u0 + 0.6, L.y0 + 270, L.y0 + 282, 0.02); quadW(S, F, u1 - 0.6, u1, L.y0 + 270, L.y0 + 282, 0.02);
          quadW(dark, F, u0 + 0.6, u1 - 0.6, L.y0 + 270, L.y0 + 282, -0.3);
        }
        quadW(S, F, 0, el, L.y0 + 282, L.y0 + 285, 0.02);
      }
      flatRing(S, c, L.y0 + 285, K.org);
      pyramid(S, shrink(c, 0.7), L.y0 + 285, L.y0 + 290.2, K.org, 0.4);
    },
  },

  // Central Park Tower (217 W 57th St; Adrian Smith + Gordon Gill, 2020; 472 m, 98 floors): the Nordstrom base, the shaft
  // in pale glass with stainless fins, the east cantilever over the Art Students League from the 30th floor
  // 111 West 57th Street (SHoP Architects, 2021; 435 m, 84 floors, 1:24; S125, 2026-10-16, in the kit's own walls and parts
  // instead of the CP33 painted faces of lmSteinway.js, which tiled in Unreal): Steinway Hall's limestone on 57th Street
  // (Warren & Wetmore, 1925; 16 floors); behind it the tower, 18 m across, its east and west faces terracotta piers in a
  // pale glaze whose fronts ripple up the height (the faces' wave), bronze between them, its north and south faces glass in
  // bronze mullions, the south face feathering back in setbacks toward the top, the piers running on past the roof
  steinway: {
    style: 11, color: [214, 200, 178], seed: 0.57,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 5.18, winW: 1.55, bayFit: true, finish: 'alu_bronze', mullW: 0.1, mullD: 0.32, spandrelH: 0.55, spandrelHex: '#3a2f25' },
    masses: (L) => {
      const T = SW_TIERS(L);
      return [
        { tiers: [{ ring: L.rect(T.x0, T.x1, T.n0, T.hn), y1: 58.5 }],
          P: { arch: 'masonry', glass: false, wallSet: 'stone_lime_ashlar', hex: '#d6ccb8', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
            floorH: 3.66, winW: 2.7, bayFit: true, reveal: 0.32, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 1, cell: { x0: 0.2, x1: 0.8, y0: 0.2, y1: 0.85 } },
          roof: { parapet: 1.2, set: 'stone_lime' } },
        { tiers: T.tiers.map((t) => ({ ring: L.rect(T.e0, T.e1, t.s, T.tn1), y1: t.y })), roof: { parapet: 0 } },
      ];
    },
    crown: (L, K) => {
      const T = SW_TIERS(L);
      // (the glaze as a pale limestone: the kit's 'terracotta' set read as orange clay in Unreal, the first still at 09:42)
      const terra = K.sinkOf(K.surfMat('stone_lime', '#e6dccb'));
      const groove = K.sinkOf(K.surfMat('stone_lime', '#b5a892'));
      const bronze = K.sinkOf(K.partMat('alu_bronze'));
      let y = L.y0;
      for (let ti = 0; ti < T.tiers.length; ti++) {
        const t = T.tiers[ti], r = L.rect(T.e0, T.e1, t.s, T.tn1), top = L.y0 + t.y, last = ti === T.tiers.length - 1;
        for (let i = 0; i < r.length; i++) {
          const F = edgeFrame(r, i, 0, K.org), ge = F.nx * GE[0] + F.nz * GE[1];
          if (Math.abs(ge) < 0.9) continue;
          // the wave: each pier's front 0.22 to 0.78 m out, one swell every 26 m of height, its phase running across the face
          const d = (yy, k, n) => 0.22 + 0.56 * (0.5 + 0.5 * Math.sin(((yy - L.y0) / 26) * 2 * Math.PI + (k / Math.max(n, 1)) * Math.PI * 1.6 + (ge > 0 ? 0 : 1.1)));
          // (each column ends at its setback in a short finial: SHoP's pilasters step with the south face; the tower's top is flat)
          ribPiers(terra, r, i, K.org, Math.max(y, L.y0 + 0.6), top + 1.2, { pitch: 1.55, wid: 0.46, step: 1.3, d, flutes: groove, cap: true });
          // the bronze filigree: a slim band at every floor line between the piers
          for (let yy = Math.ceil((y - L.y0) / 5.18) * 5.18; L.y0 + yy < top - 0.5; yy += 5.18) quadW(bronze, F, 0, F.L, L.y0 + yy - 0.18, L.y0 + yy + 0.18, 0.14);
        }
        y = top;
      }
      // the crown: a bronze band flush with the last tier's faces round the mechanical penthouse, level all round (S125,
      // 2026-10-16, the owner: the first build's piers ran 7.5 m past the roof with bronze blades between them, two "ears")
      const t = T.tiers[T.tiers.length - 1], r = L.rect(T.e0, T.e1, t.s, T.tn1), top = L.y0 + t.y;
      for (let i = 0; i < r.length; i++) {
        const F = edgeFrame(r, i, 0, K.org);
        quadW(bronze, F, -0.05, F.L + 0.05, top, top + 2.4, 0.06);
        quadW(bronze, F, 0.05, F.L - 0.05, top, top + 2.4, -0.25, true);
      }
    },
  },

  cpTower: {
    style: 11, color: [190, 198, 205], seed: 0.29,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.55, winW: 1.55, bayFit: true, finish: 'stainless', mullW: 0.08, mullD: 0.36, spandrelH: 0.55, spandrelHex: '#c9ced2' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 41 }], P: { arch: 'cwGrid', famObj: CLEARG, mullD: 0.2, spandrelH: 1.2, spandrelHex: '#d8dadb' } },
      { y0: 41, tiers: [
        { ring: L.rect(-14.0, 28.6, -12.0, 32.2), y1: 89 },
        { ring: L.rect(-14.0, 37.1, -12.0, 32.2), y1: 440 },
        { ring: L.rect(-11.5, 34.6, -9.5, 29.7), y1: 458 },
        { ring: L.rect(-8.0, 31.1, -6.0, 26.2), y1: 472 },
      ], roof: { parapet: 1.4, set: 'alu_clear' } },
    ],
  },

  // 432 Park Avenue (Rafael Vinoly, 2015; 426 m): a 28.5 m square tube of white concrete, six 3.05 m windows a face a
  // floor on 4.75 m bays, every twelfth floor pair open to the wind
  p432park: {
    style: 1, color: [232, 230, 224], seed: 0.52,
    P: { arch: 'pm', wallSet: 'concrete_smooth', hex: '#e8e6e0', trimSet: 'concrete_smooth', baseSet: 'concrete_smooth', lobbySet: 'granite_black',
      floorH: 4.72, winW: 4.75, bayFit: true, reveal: 0.42, sash: 'fixed', finish: 'alu_clear', belts: false, cornice: 0,
      cell: { x0: 0.18, x1: 0.82, y0: 0.17, y1: 0.82 }, mechEvery: 12 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 22 }], P: { arch: 'cwGrid', famObj: CLEARG, spandrelH: 1.0, spandrelHex: '#d0cfca', floorH: 5.5 } },
      { y0: 22, tiers: [{ ring: L.rect(-36.3, -7.8, -12.5, 16.0), y1: 425.5 }], roof: { parapet: 1.6, set: 'concrete_smooth' } },
    ],
  },

  // Deutsche Bank Center (the Time Warner Center; SOM, 2004; 229 m): two glass towers on a podium round Columbus Circle
  twTimeWarner: {
    style: 11, color: [150, 165, 175], seed: 0.71,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 3.9, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.07, mullD: 0.22, spandrelH: 0.6, spandrelHex: '#9aa6ad' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 46 }], P: { arch: 'cwGrid', spandrelH: 1.4, floorH: 5.6 } },
      // the towers on the lot (owner 2026-10-22: the north one stood 30 m out over Broadway): parallelograms whose
      // circle faces run with Broadway's cut of the lot's north-east corner, set 3 m inside the podium's front
      // (tools/qa/tw_lot_audit.mjs checks every tier ring against its lot)
      { y0: 46, tiers: [{ ring: L.poly([[-62, 49], [-3, 49], [-20, 79], [-62, 79]]), y1: 229 }], roof: { parapet: 3.5, set: 'alu_clear' } },
      { y0: 46, tiers: [{ ring: L.poly([[-50, -41], [20, -41], [2.5, -11], [-50, -11]]), y1: 229 }], roof: { parapet: 3.5, set: 'alu_clear' } },
    ],
  },

  // the General Motors Building (767 Fifth Ave; Edward Durell Stone, 1968; 215 m, 50 floors): white marble piers the
  // whole height, black glass and spandrels between them, on a low base round the plaza
  twGM: {
    style: 3, color: [238, 236, 230], seed: 0.13,
    P: { arch: 'cwPier', famObj: BLACKG, floorH: 4.18, winW: 1.62, bayFit: true, finish: 'alu_black', pierW: 0.62, pierD: 0.55, pierSet: 'stone_lime', spandrelH: 1.1, spandrelHex: '#1c1d1f', mullD: 0.1 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 22 }], P: { famObj: BLACKG } },   // (the whole lot: a replace landmark leaves no ground under it)
      { y0: 22, tiers: [{ ring: L.rect(-12.0, 45.0, -22.0, 22.0), y1: 215 }], roof: { parapet: 2.2, set: 'stone_lime', tint: '#ece9e2' } },
    ],
  },

  // the Sherry-Netherland (781 Fifth Ave; Schultze & Weaver, 1927; 172 m): a brick and limestone tower over a broad base,
  // its copper spire
  twSherry: {
    style: 1, color: [198, 160, 128], seed: 0.83,
    P: { arch: 'masonry', wallSet: 'brick_buff', hex: '#c9a586', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 3.55, winW: 2.1, bayFit: true, reveal: 0.2, sash: 'dh', finish: 'alu_white', belts: true, cornice: 1 },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 64 }] },
      { y0: 64, tiers: [{ ring: L.rect(-10.5, 10.5, -9.5, 9.5), y1: 130 }, { ring: L.rect(-8.6, 8.6, -7.6, 7.6), y1: 140 }] },
    ],
    crown: (L, K) => {
      const cu = K.sinkOf(K.surfMat('panel_alu', '#5d8a74'));
      pyramid(cu, L.rect(-8.0, 8.0, -7.0, 7.0), L.y0 + 140.2, L.y0 + 166, K.org, 0.06);
      const fin = K.sinkOf(K.partMat('alu_bronze'));
      pyramid(fin, L.rect(-0.35, 0.35, -0.35, 0.35), L.y0 + 166, L.y0 + 172, K.org, 0.1);
    },
  },

  // 30 Rockefeller Plaza (Raymond Hood, 1933; 259 m, 70 floors): an Indiana limestone slab of continuous piers, the
  // windows recessed between them over aluminium spandrels, stepping in toward its top, on its lower wings
  thirtyRock: {
    style: 4, color: [214, 204, 182], seed: 0.47,
    P: { arch: 'deco', wallSet: 'stone_lime_ashlar', hex: '#d6cbb2', trimSet: 'stone_lime', baseSet: 'stone_lime', lobbySet: 'granite_black',
      floorH: 3.66, winW: 1.72, bayFit: true, reveal: 0.22, sash: 'dh', finish: 'alu_clear', piers: true, belts: false, cornice: 0,
      spandrel: { set: 'panel_alu', tint: '#7d7f7c' },   // the aluminium spandrels, the windows and panels one strip between the piers
      cell: { x0: 0.22, x1: 0.78, y0: 0.26, y1: 0.86 } },
    // about the area centroid: the complex's ring differs in its vertices between tile sets
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 33 }] },
      { y0: 33, tiers: [
        { ring: L.rectA(-34.5, 60.5, -15.6, 16.4), y1: 200 },
        { ring: L.rectA(-27.5, 56.5, -14.6, 15.4), y1: 222 },
        { ring: L.rectA(-19.5, 50.5, -13.1, 13.9), y1: 240 },
        { ring: L.rectA(-7.5, 40.5, -11.6, 12.4), y1: 259 },
      ], roof: { parapet: 1.2, set: 'stone_lime', tint: '#d6cbb2' } },
    ],
  },

  // the Hearst Tower (Foster + Partners, 2006, on Joseph Urban's 1928 base; 182 m): a glass tower in a stainless diagrid
  // of four-storey diamonds, its corners cut back, over the six-storey cast-stone base
  hearst: {
    style: 11, color: [180, 190, 196], seed: 0.66,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 4.05, winW: 1.5, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.1, spandrelH: 0.4, spandrelHex: '#9aa3a8',
      diagrid: { floors: 4, span: 10.5, w: 0.75, d: 0.55, set: 'stainless' } },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 30 }], P: { arch: 'masonry', glass: false, wallSet: 'cast_stone', hex: '#d3c8b2', trimSet: 'cast_stone', baseSet: 'cast_stone',
        lobbySet: 'cast_stone', floorH: 5.0, winW: 3.2, bayFit: true, reveal: 0.35, sash: 'case', finish: 'alu_black', belts: true, cornice: 1, diagrid: null,
        cell: { x0: 0.18, x1: 0.82, y0: 0.2, y1: 0.86 } } },
      { y0: 30, tiers: [{ ring: L.chamf(-29, 14, -14, 29.5, 5.5), y1: 182 }], roof: { parapet: 1.5, set: 'stainless' } },
    ],
  },

  // 53 West 53rd (Jean Nouvel, 2019; 320 m, 77 floors; S125 w53, 2026-10-17, faceted instead of the stepped tiers): a
  // slender prism of planar facets on the L of its lot (61 m from 53rd to 54th Street), its north face one slope from
  // 54th Street to the summits, the south face near vertical and folding in above 160 m, three summits (320, 302 and
  // 289 m); the exposed concrete diagrid in large irregular triangles along the facets' edges, dark to clear glass in a
  // fine aluminium grid between them; the MoMA gallery block on the lot's north-east arm (w53Build)
  tw53w53: {
    style: 11, color: [150, 158, 164], seed: 0.57,
    P: { arch: 'cwGrid', famObj: CLEARG, floorH: 4.15, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.07, mullD: 0.14, spandrelH: 0.85, spandrelHex: '#3d4246' },
    masses: (L) => {
      const G = w53G(L);
      // (its west wall 0.7 m inside the tower's east face, hidden behind the tower's glass; its east and south walls and
      // the notch 0.3 m inside the lot lines MoMA's own walls stand on: never in another wall's plane)
      const ring = L.pos([[2.4, -3.0], [15.0, -3.0], [15.0, 3.8], [7.8, 3.8], [7.9, 9.3], [15.0, 9.2], [15.0, 27.3], [2.4, 27.3]].map(([a, b]) => G(a, b)));
      return [{ tiers: [{ ring, y1: 26.5 }], P: { floorH: 5.3, spandrelH: 1.1, famObj: BLACKG }, roof: { parapet: 0.9, set: 'alu_clear' } }];
    },
    crown: (L, K) => { w53Build(L, K); },
  },

  // 520 Park Avenue (Robert A.M. Stern, 2018; 238 m): a slender limestone tower, its top stepping in under corner
  // finials and a lantern
  tw520park: {
    style: 1, color: [214, 205, 188], seed: 0.34,
    P: { arch: 'masonry', wallSet: 'stone_lime_ashlar', hex: '#d8cfbc', trimSet: 'stone_lime', baseSet: 'stone_lime_rusticated', lobbySet: 'stone_lime_rusticated',
      floorH: 4.6, winW: 2.1, bayFit: true, reveal: 0.3, sash: 'case', finish: 'alu_bronze', belts: true, cornice: 0,
      cell: { x0: 0.17, x1: 0.83, y0: 0.22, y1: 0.86 } },
    masses: (L) => [
      { tiers: [
        { ring: L.ring, y1: 196 },
        { ring: L.rect(-7.8, 7.9, -9.1, 9.3), y1: 212 },
        { ring: L.rect(-6.3, 6.4, -7.6, 7.8), y1: 224 },
      ] },
    ],
    crown: (L, K) => {
      const S = K.sinkOf(K.surfMat('stone_lime', '#d8cfbc')), dark = K.sinkOf(K.cwGlassMat(BLACKG));
      const c = L.rect(-4.6, 4.7, -5.6, 5.8);
      for (let i = 0; i < 4; i++) {
        const A = c[i], B = c[(i + 1) % 4], el = Math.hypot(B[0] - A[0], B[1] - A[1]);
        const F = edgeFrame(c, i, 0, K.org);
        quadW(S, F, 0, el, L.y0 + 224, L.y0 + 226, 0.02);
        quadW(dark, F, 0.8, el - 0.8, L.y0 + 226, L.y0 + 232, -0.3);
        quadW(S, F, 0, 0.8, L.y0 + 226, L.y0 + 232, 0.02); quadW(S, F, el - 0.8, el, L.y0 + 226, L.y0 + 232, 0.02);
        quadW(S, F, 0, el, L.y0 + 232, L.y0 + 233.5, 0.02);
      }
      flatRing(S, c, L.y0 + 233.5, K.org);
      for (const [gx, gn] of [[-7.0, -8.3], [7.1, -8.3], [-7.0, 8.5], [7.1, 8.5]]) pyramid(S, L.rect(gx - 0.6, gx + 0.6, gn - 0.6, gn + 0.6), L.y0 + 224, L.y0 + 236, K.org, 0.05);
      pyramid(S, L.rect(-1.2, 1.3, -1.2, 1.4), L.y0 + 233.5, L.y0 + 238, K.org, 0.08);
    },
  },

  // 270 Park Avenue (JPMorgan Chase, Foster + Partners, 2025; 423 m): a full-block tower on fan columns, stepping in
  // three times toward its top, in silver glass between stainless fins
  tw270park: {
    style: 11, color: [190, 198, 204], seed: 0.77,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.3, winW: 1.55, bayFit: true, finish: 'stainless', mullW: 0.08, mullD: 0.42, spandrelH: 0.5, spandrelHex: '#c3c8cb' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 24 }], P: { arch: 'cwGrid', famObj: CLEARG, spandrelH: 0.8, floorH: 6.0 } },
      { y0: 24, tiers: [
        { ring: L.rect(-54.5, 54.5, -27.5, 27.5), y1: 205 },
        { ring: L.rect(-50, 50, -22, 22), y1: 285 },
        { ring: L.rect(-44, 44, -16.5, 16.5), y1: 355 },
        { ring: L.rect(-36, 36, -11.5, 11.5), y1: 405 },
      ], roof: { parapet: 2.5, set: 'stainless' } },
    ],
    crown: (L, K) => {
      // the fan columns: three diagonal pairs a face under the overhang
      const st = K.sinkOf(K.partMat('stainless'));
      const mast = L.rect(-0.9, 0.9, -0.9, 0.9);
      pyramid(st, mast, L.y0 + 405, L.y0 + 423, K.org, 0.3);
    },
  },

  // the Empire State Building (Shreve, Lamb & Harmon, 1931; 381 m to the roof, 443 m with the antenna): Indiana limestone in
  // continuous piers, the windows in vertical strips over aluminium spandrels, a five-storey base on the whole lot, the
  // setbacks at the 6th, 25th, 30th, 72nd, 81st and 85th floors, the 86th-floor observatory, the mooring mast and the antenna
  empireState: {
    style: 4, color: [214, 204, 176], seed: 0.19,
    P: { arch: 'deco', wallSet: 'stone_lime_ashlar', hex: '#d8ccaa', trimSet: 'stone_lime', baseSet: 'stone_lime', lobbySet: 'granite_black',
      floorH: 3.66, winW: 1.62, bayFit: true, reveal: 0.2, sash: 'dh', finish: 'alu_clear', piers: true, belts: false, cornice: 0,
      spandrel: { set: 'panel_alu', tint: '#8f9290' },   // the cast aluminium spandrels between the limestone piers
      cell: { x0: 0.25, x1: 0.75, y0: 0.24, y1: 0.86 } },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 23 }] },
      { y0: 23, tiers: [
        { ring: L.rect(-4, 92, -18, 24), y1: 86 },
        { ring: L.rect(4, 84, -14.5, 20.5), y1: 106 },
        { ring: L.rect(14, 74, -11, 17), y1: 266 },
        { ring: L.rect(20, 68, -8, 14), y1: 298 },
        { ring: L.rect(27, 61, -5, 11), y1: 312 },
        { ring: L.rect(31, 57, -3, 9), y1: 320 },
      ], roof: { parapet: 1.3, set: 'stone_lime', tint: '#d8ccaa' } },
    ],
    crown: (L, K) => {
      const stone = K.sinkOf(K.surfMat('stone_lime', '#d8ccaa'));
      const nickel = K.sinkOf(K.partMat('stainless'));
      const glass = K.sinkOf(K.cwGlassMat(BLACKG));
      const [cx, cz] = L.W(44, 3);
      // the observatory deck's glazed drum and its crown, the mast's stepped drums with their ribs, the antenna
      drum(glass, cx, cz, 8.6, 8.6, L.y0 + 320, L.y0 + 326, K.org, 16, false);
      drum(stone, cx, cz, 9.2, 8.2, L.y0 + 326, L.y0 + 330, K.org, 16);
      drum(stone, cx, cz, 7.2, 6.6, L.y0 + 330, L.y0 + 346, K.org, 16);
      drum(nickel, cx, cz, 6.9, 6.1, L.y0 + 346, L.y0 + 352, K.org, 16);
      drum(stone, cx, cz, 5.9, 5.0, L.y0 + 352, L.y0 + 366, K.org, 12);
      drum(nickel, cx, cz, 5.0, 3.6, L.y0 + 366, L.y0 + 374, K.org, 12);
      drum(nickel, cx, cz, 3.0, 2.2, L.y0 + 374, L.y0 + 381, K.org, 12);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, x = cx + Math.cos(a) * 6.4, z = cz + Math.sin(a) * 6.4;
        drum(nickel, x, z, 0.35, 0.3, L.y0 + 330, L.y0 + 352, K.org, 4);
      }
      drum(nickel, cx, cz, 1.2, 0.5, L.y0 + 381, L.y0 + 410, K.org, 8);
      drum(nickel, cx, cz, 0.45, 0.18, L.y0 + 410, L.y0 + 443, K.org, 6);
    },
  },

  // One Vanderbilt (Kohn Pedersen Fox, 2020; 427 m): four interlocking volumes that taper as they rise, glass between
  // terracotta spandrels and fins, a stepped glass crown and its spire; here the taper is a run of tiers, each pair of
  // opposite faces stepping in in turn
  oneVanderbilt: {
    style: 11, color: [196, 190, 176], seed: 0.27,
    P: { arch: 'cwSuper', famObj: CLEARG, floorH: 4.4, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.09, mullD: 0.34, spandrelH: 0.9, spandrelHex: '#c9bfa8' },
    masses: (L) => {
      const T = [];
      const steps = [[0, 0, 0, 0, 92], [3.5, 0, 0, 0, 160], [3.5, 0, 3.5, 0, 220], [3.5, 3.5, 3.5, 0, 270], [3.5, 3.5, 3.5, 3.5, 310],
        [7, 3.5, 3.5, 3.5, 340], [7, 3.5, 7, 3.5, 362], [7, 7, 7, 3.5, 380], [10, 7, 7, 7, 392]];
      for (const [w, e, s, n, y] of steps) T.push({ ring: L.rect(-32.8 + w, 32.8 - e, -30.6 + s, 30.6 - n), y1: y });
      return [
        { tiers: [{ ring: L.ring, y1: 26 }], P: { arch: 'cwGrid', spandrelH: 1.4, floorH: 6.5 } },
        { y0: 26, tiers: T, roof: { parapet: 2.0, set: 'alu_clear' } },
      ];
    },
    crown: (L, K) => {
      const g = K.sinkOf(K.cwGlassMat(CLEARG)), st = K.sinkOf(K.partMat('stainless'));
      pyramid(g, L.rect(-22.8, 25.8, -20.6, 23.6), L.y0 + 392, L.y0 + 404, K.org, 0.62);
      pyramid(g, L.rect(-14.5, 17.5, -12.5, 15.5), L.y0 + 404, L.y0 + 412, K.org, 0.45);
      pyramid(st, L.rect(-0.8, 0.8, -0.8, 0.8), L.y0 + 412, L.y0 + 427, K.org, 0.15);
    },
  },

  // the Bank of America Tower (Cook + Fox, 2009; 288 m to the roof, 366 m to the spire): a glass tower whose faces fold
  // at their corners, on a podium that fills the block, its spire
  boaTower: {
    style: 11, color: [180, 190, 196], seed: 0.31,
    P: { arch: 'cwSuper', famObj: SILVERW, floorH: 4.6, winW: 1.52, bayFit: true, finish: 'alu_clear', mullW: 0.07, mullD: 0.18, spandrelH: 0.5, spandrelHex: '#b9c1c6' },
    masses: (L) => [
      { tiers: [{ ring: L.ring, y1: 30 }], P: { arch: 'cwGrid', spandrelH: 1.2, floorH: 6.0 } },
      { y0: 30, tiers: [
        { ring: L.chamf(-30, 32, -12, 30, 7), y1: 205 },
        { ring: L.chamf(-27, 30, -9, 27, 8), y1: 252 },
        { ring: L.chamf(-22, 26, -5, 23, 8), y1: 280 },
        { ring: L.chamf(-15, 19, 0, 18, 6), y1: 288 },
      ], roof: { parapet: 3.0, set: 'alu_clear' } },
    ],
    crown: (L, K) => {
      const st = K.sinkOf(K.partMat('stainless'));
      const [cx, cz] = L.W(2, 9);
      drum(st, cx, cz, 1.6, 0.9, L.y0 + 288, L.y0 + 330, K.org, 8);
      drum(st, cx, cz, 0.9, 0.2, L.y0 + 330, L.y0 + 366, K.org, 6);
    },
  },

  // the Seagram Building (Mies van der Rohe, 1958; 157 m): a bronze slab of five bays by three behind its plaza on Park
  // Avenue, bronze I-beam mullions every sixth of a bay, bronze-tinted glass to the spandrels, the bustle behind
  seagram: {
    style: 3, color: [74, 58, 44], seed: 0.41,
    P: { arch: 'cwGrid', famObj: BRONZEK, floorH: 3.85, winW: 1.41, bayFit: true, finish: 'alu_bronze', mullW: 0.12, mullD: 0.3, spandrelH: 1.15, spandrelHex: '#3a2c22' },
    masses: (L) => [
      { tiers: [{ ring: L.rect(-29.0, 4.0, -30.4, 30.1), y1: 0.6 }], P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', trimSet: 'granite_pink', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } },
        roof: { deck: 'granite_pink', parapet: 0 } },
      { tiers: [{ ring: L.rect(17.0, 31.6, -30.4, 30.1), y1: 40 }] },
      { tiers: [{ ring: L.rect(4.0, 17.0, -21.2, 21.2), y1: 157 }, ], roof: { parapet: 2.2, set: 'alu_bronze' } },
      { y0: 40, tiers: [{ ring: L.rect(17.0, 29.6, -21.2, 21.2), y1: 157 }], roof: { parapet: 2.2, set: 'alu_bronze' } },
      { tiers: [{ ring: L.rect(4.0, 17.0, -30.4, -21.2), y1: 0.6 }, ], roof: { deck: 'granite_pink', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { tiers: [{ ring: L.rect(4.0, 17.0, 21.2, 30.1), y1: 0.6 }, ], roof: { deck: 'granite_pink', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_pink', hex: '#a3887c', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
    ],
  },

  // Citigroup Center (Hugh Stubbins, 1977; 279 m): a 48 m square tower in bands of aluminium and glass, raised on four 35 m
  // stilts at the middle of its sides and its core, its roof cut at 45 degrees to the south, over St. Peter's and the plaza
  citigroup: {
    style: 3, color: [200, 204, 206], seed: 0.53,
    P: { arch: 'cwRibbon', famObj: CLEARG, floorH: 3.75, winW: 1.5, bayFit: true, finish: 'alu_clear', mullW: 0.06, mullD: 0.1, spandrelH: 1.55, spandrelHex: '#c8cdd0',
      ribbonSet: 'panel_alu' },
    masses: (L) => [
      { tiers: [{ ring: L.rect(4.0, 78.5, -40.0, 21.4), y1: 26 }], P: { arch: 'cwGrid', spandrelH: 1.2, floorH: 5.2 } },
      { tiers: [{ ring: L.rect(-45.3, 4.0, -40.0, -27.0), y1: 0.5 }], roof: { deck: 'granite_grey', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_grey', hex: '#9a9a96', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { tiers: [{ ring: L.rect(-45.3, 4.0, -27.0, 21.4), y1: 0.5 }], roof: { deck: 'granite_grey', parapet: 0 }, P: { arch: 'pm', glass: false, wallSet: 'granite_grey', hex: '#9a9a96', cell: { x0: 0.4, x1: 0.6, y0: 0.4, y1: 0.6 } } },
      { y0: 35, tiers: [{ ring: L.rect(-44.0, 4.0, -27.0, 21.0), y1: 248 }], roof: { parapet: 0 } },
      // the core and the four stilts
      { tiers: [{ ring: L.rect(-29.0, -11.0, -12.0, 6.0), y1: 35 }], P: { arch: 'pm', glass: false, wallSet: 'concrete_precast', hex: '#c9c8c2', cell: { x0: 0.45, x1: 0.55, y0: 0.45, y1: 0.55 } }, roof: { none: true } },
      ...[[-20, -27], [-20, 21], [-44, -3], [4, -3]].map(([gx, gn]) => ({ tiers: [{ ring: L.rect(gx - 3.4 + (gx === -44 ? 3.4 : gx === 4 ? -3.4 : 0), gx + 3.4 + (gx === -44 ? 3.4 : gx === 4 ? -3.4 : 0), gn - 3.4 + (gn === -27 ? 3.4 : gn === 21 ? -3.4 : 0), gn + 3.4 + (gn === -27 ? 3.4 : gn === 21 ? -3.4 : 0)), y1: 35 }],
        P: { arch: 'pm', glass: false, wallSet: 'panel_alu', hex: '#c8cdd0', cell: { x0: 0.45, x1: 0.55, y0: 0.45, y1: 0.55 } }, roof: { none: true } })),
    ],
    crown: (L, K) => {
      // the roof cut at 45 degrees, rising to the north: a wedge over the tower, its sloped face in the bands' aluminium
      const al = K.sinkOf(K.partMat('alu_clear')), S = K.sinkOf(K.surfMat('panel_alu', '#c8cdd0'));
      const r = L.rect(-44.0, 4.0, -27.0, 21.0);
      const y0 = L.y0 + 248, y1 = L.y0 + 279;
      const [a, b, c, d] = r;   // positive ring: a (gx0, gn0) south-west, b south-east, c north-east, d north-west
      const P = (p, y) => [p[0] - K.org[0], y, p[1] - K.org[1]];
      const quad = (S2, A, B, C, D, n) => { const i = S2.n; for (const v of [A, B, C, D]) S2.v(v[0], v[1], v[2], n[0], n[1], n[2], 0, 0, 0); S2.tri(i, i + 1, i + 2); S2.tri(i, i + 2, i + 3); };
      const nl = Math.SQRT1_2;
      quad(S, P(a, y0), P(b, y0), P(c, y1), P(d, y1), [-GN[0] * nl, nl, -GN[1] * nl]);
      // the north face up to the ridge and the two side triangles
      quad(S, P(c, y0), P(d, y0), P(d, y1), P(c, y1), [GN[0], 0, GN[1]]);
      for (const [p0, p1, sg] of [[b, c, 1], [d, a, -1]]) {
        const i = S.n, n = [GE[0] * sg, 0, GE[1] * sg];
        S.v(...P(p0, y0), ...n, 0, 0, 0); S.v(...P(p1, y0), ...n, 0, 0, 0); S.v(...P(p1, y1), ...n, 0, 0, 0);
        S.tri(i, i + 1, i + 2);
      }
    },
  },

  // 1 Central Park West (Trump International; re-clad 1997 in gold-tinted glass; 177 m)
  twTrumpIntl: {
    style: 3, color: [150, 120, 80], seed: 0.22,
    P: { arch: 'cwGrid', famObj: GOLDG, floorH: 3.9, winW: 1.55, bayFit: true, finish: 'alu_bronze', mullD: 0.18, spandrelH: 0.95, spandrelHex: '#5a4630' },
    masses: (L) => [{ tiers: [{ ring: L.ring, y1: 171 }], roof: { parapet: 1.8, set: 'alu_bronze' } }],
  },
};

// the builders, by landmark key (landmarks.js asks here first; `?twlm=0` keeps the old ones)
export const TW_BUILDERS = {};
for (const k of Object.keys(TW_SPECS)) TW_BUILDERS[k] = (ctx) => buildSpec(k, TW_SPECS[k], ctx);
