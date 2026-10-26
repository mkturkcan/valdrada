// lmHighbridgeTower.js (HB25): the Highbridge Water Tower (John B. Jervis, 1866-72) at the High Bridge's Manhattan end, on
// its compiled ring (tile 6_-13 #8, OSM way 275059317, 47.8 m): an octagonal shaft of rock-faced granite in courses on a
// battered plinth, dressed quoins at the angles, a round-arched door, narrow round-headed stair windows climbing the faces;
// a moulded belt course and a corbel table carrying the belvedere (a round-arched pair of windows in every face), its
// cornice, an octagonal roof laid in slate courses, the open lantern and its cap and finial. In the kit's material sets
// (granite, slate, bronze, window glass), so Unreal binds every surface to its PBR set.
import { opening, courses, mould, PROF, corbels, lathe } from './lmStoneKit.js';
import { LB } from './lmStoneKit.js';
import { quadW, box as kbox, Frame } from './fk/kitGeom.js';
import { surfMat, partMat, winGlassMat } from './tk/tkMats.js';

const TAU = Math.PI * 2;

function M() {
  return {
    wall: surfMat('amnh_granite', '#9a9286'),    // the rock-faced granite (the neutral granite set: Unreal's granite_grey is a brown rubble wall)
    trim: surfMat('amnh_granite', '#aea79b'),    // its dressed quoins, belt, cornice
    plinth: surfMat('amnh_granite', '#8b847a'),
    slate: surfMat('amnh_slate', '#55585c'),     // the roof's slate
    bronze: partMat('alu_bronze'),
    dark: partMat('alu_black'),
    glass: winGlassMat(),
  };
}

// the eight faces of an octagon of circumradius r about (cx, cz) from vertex angle a0, outward
function faces(B, cx, cz, r, a0) {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = a0 + (i / 8) * TAU, b = a0 + ((i + 1) / 8) * TAU;
    const pa = [cx + Math.cos(a) * r, cz + Math.sin(a) * r], pb = [cx + Math.cos(b) * r, cz + Math.sin(b) * r];
    let F = new Frame(pa, pb, B.y0, B.org);
    const mx = (pa[0] + pb[0]) / 2 - cx, mz = (pa[1] + pb[1]) / 2 - cz;
    if (F.nx * mx + F.nz * mz < 0) F = new Frame(pb, pa, B.y0, B.org);
    out.push(F);
  }
  return out;
}

export function buildHighbridgeTower(ctx) {
  const fp = ctx.footprint || [];
  if (fp.length < 5) return null;
  const B = new LB(ctx, [ctx.cx ?? 0, ctx.cz ?? 0]), K = M();
  const cx = B.cx, cz = B.cz;
  // the octagon from the ring: the mean vertex radius and the first vertex's angle
  let rv = 0;
  for (const [x, z] of fp) rv += Math.hypot(x, z) / fp.length;
  const a0 = Math.atan2(fp[0][1], fp[0][0]);
  const H = Math.max(36, Math.min(62, ctx.height || 47.8));
  const r = Math.max(4.5, Math.min(8, rv)) - 0.25;           // the shaft (the ring is the plinth's)
  const yP = 2.4, yS = H * 0.70, yB0 = yS + 1.25, yB1 = H * 0.815, yR = H * 0.95;
  B.we = [0.55, B.y0, B.y0 + H];
  // the plinth: battered, two courses of large blocks, a chamfered cap
  const rp = r + 0.45;
  for (const [k, F] of faces(B, cx, cz, rp, a0).entries()) courses(B, F, K.plinth, 0, F.L, -0.6, yP - 0.25, 0.9, [], 0.08, 0.04, 1.6, k);
  lathe(B, K.trim, cx, cz, [[rp + 0.1, yP - 0.25], [rp + 0.1, yP - 0.1], [r + 0.02, yP]], 8, a0, a0 + TAU);
  // the shaft
  const doorFace = 2;
  for (const [i, F] of faces(B, cx, cz, r, a0).entries()) {
    const holes = [], ops = [];
    const um = F.L / 2;
    if (i === doorFace) {
      ops.push({ u0: um - 1.2, u1: um + 1.2, y0: yP, ys: yP + 3.0, arch: 'round', d: 0.6, wall: K.wall, trim: K.trim, glass: null, frame: K.dark, door: true, sill: false, hoodW: 0.5, hoodP: 0.14 });
    }
    // the stair windows: narrow, round-headed, climbing a quarter storey a face
    for (let y = 7.0 + i * 0.9; y < yS - 3.2; y += 7.2) {
      if (i === doorFace && y < yP + 5.5) continue;
      ops.push({ u0: um - 0.42, u1: um + 0.42, y0: y, ys: y + 1.75, arch: 'round', d: 0.45, wall: K.wall, trim: K.trim, glass: K.glass, frame: K.dark, hoodW: 0.3, hoodP: 0.08, info: { cu: i, cv: Math.round(y), ws: 60 + i, sill: 0.1, fh: 2.6 } });
    }
    for (const o of ops) holes.push({ u0: o.u0 - 0.02, u1: o.u1 + 0.02, y0: o.y0, y1: o.ys + (o.u1 - o.u0) / 2 + 0.02 });
    // rock-faced courses between the quoins, the quoins dressed and proud at both angles (long and short blocks)
    const q = 0.7;
    courses(B, F, K.wall, q, F.L - q, yP, yS, 0.56, holes, 0.07, 0.035, 1.6, i * 3);
    for (const [u0, u1] of [[0, q], [F.L - q, F.L]]) {
      const n = Math.round((yS - yP) / 0.56), h = (yS - yP) / n;
      for (let k = 0; k < n; k++) {
        const long = k % 2 === 0, a = u0 === 0 ? 0 : (long ? F.L - q - 0.35 : F.L - q), b = u0 === 0 ? (long ? q + 0.35 : q) : F.L;
        kbox(B.S(K.trim), F, a, b, yP + k * h + 0.008, yP + (k + 1) * h - 0.008, 0, 0.05, 0.02, 16);
      }
      quadW(B.S(K.trim), F, u0, u1, yP, yS, 0.002);
    }
    for (const o of ops) opening(B, F, o);
    // the belt course over the shaft, the corbel table under the belvedere
    quadW(B.S(K.wall), F, 0, F.L, yS, yB0, 0);   // (the wall behind the corbel table)
    mould(B, F, K.trim, PROF.string(yS, 0.32, 0.5), 0, F.L, 1, 1);
    corbels(B, F, K.trim, 0.3, F.L - 0.3, yB0, 0.75, 0.34, 0.7, 0.42);
  }
  // the belvedere, a little wider, on the corbels: a pair of round-arched windows a face, the cornice over
  const rb = r + 0.42;
  lathe(B, K.trim, cx, cz, [[r + 0.01, yB0 - 0.02], [rb + 0.08, yB0 - 0.02], [rb + 0.08, yB0 + 0.16], [rb, yB0 + 0.16]], 8, a0, a0 + TAU);
  for (const [i, F] of faces(B, cx, cz, rb, a0).entries()) {
    const um = F.L / 2, w = Math.min(1.1, F.L * 0.2), ys = yB0 + (yB1 - yB0) * 0.55;
    const ops = [-1, 1].map((sg) => ({ u0: um + sg * (w * 0.62) - w / 2, u1: um + sg * (w * 0.62) + w / 2, y0: yB0 + 0.9, ys, arch: 'round', d: 0.5, wall: K.wall, trim: K.trim, glass: K.glass, frame: K.dark, hoodW: 0.28, hoodP: 0.1, info: { cu: i, cv: 99, ws: 70 + i, sill: 0.4, fh: 3.4 } }));
    const holes = ops.map((o) => ({ u0: o.u0 - 0.02, u1: o.u1 + 0.02, y0: o.y0, y1: o.ys + (o.u1 - o.u0) / 2 + 0.02 }));
    courses(B, F, K.wall, 0, F.L, yB0, yB1 - 0.9, 0.5, holes, 0.06, 0.03, 1.1, 40 + i);
    for (const o of ops) opening(B, F, o);
    mould(B, F, K.trim, PROF.cornice(yB1 + 0.25, 0.75, 1.15), 0, F.L, 1, 1);
  }
  // the roof: an octagonal spire of slate courses from the cornice to the lantern's seat, then the lantern
  const rr = rb + 0.6, yL0 = yR - 1.8;
  const nC = Math.max(4, Math.round(Math.hypot(rr - 1.25, yL0 - yB1) / 0.42));
  for (let k = 0; k < nC; k++) {
    const f0 = k / nC, f1 = (k + 1) / nC, ra = rr + (1.25 - rr) * f0, rb2 = rr + (1.25 - rr) * f1;
    const ya = yB1 + 0.25 + (yL0 - yB1 - 0.25) * f0, yb = yB1 + 0.25 + (yL0 - yB1 - 0.25) * f1;
    lathe(B, K.slate, cx, cz, [[ra + 0.04, ya], [ra + 0.04, ya + 0.05], [rb2, yb]], 8, a0, a0 + TAU);
  }
  // the lantern: eight posts under a cap, a ball and the finial
  lathe(B, K.trim, cx, cz, [[1.45, yL0], [1.45, yL0 + 0.25], [1.2, yL0 + 0.3]], 8, a0, a0 + TAU);
  for (let i = 0; i < 8; i++) {
    const a = a0 + (i / 8) * TAU, px = cx + Math.cos(a) * 1.1, pz = cz + Math.sin(a) * 1.1;
    lathe(B, K.trim, px, pz, [[0.13, yL0 + 0.3], [0.13, yR - 0.1], [0, yR - 0.1]], 6);
  }
  lathe(B, K.slate, cx, cz, [[1.4, yR - 0.1], [1.4, yR + 0.1], [0.08, H - 1.1]], 8, a0, a0 + TAU);
  lathe(B, K.bronze, cx, cz, [[0, H - 1.2], [0.22, H - 1.0], [0.22, H - 0.75], [0.05, H - 0.6], [0.04, H], [0, H]], 10);
  B.colliders.push({ x: 0, y: H / 2, z: 0, w: 2 * r, h: H, d: 2 * r, rotY: 0 });
  return B.group('highbridgeTower');
}
