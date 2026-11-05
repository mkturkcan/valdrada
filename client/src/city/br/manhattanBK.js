// The Manhattan Bridge's Brooklyn end (MB65, 2026-10-31): the anchorage between Water and Front Streets with the Archway
// through it, and the approach over Front, York and Prospect Streets, the Brooklyn-Queens Expressway, Sands, High and
// Concord Streets to Flatbush Avenue Extension, as it stands: the bridge's own deck carried on to the street.
//   the anchorage   a granite block 58 m along the bridge and 49.6 m across at its river face (its footprint in
//                   OpenStreetMap, way 1255353998, h 25 over the street); the river end (34 m) a tower over the whole
//                   width with rusticated corner pilasters, a rock-faced base, a row of small windows under its cornice and
//                   the Archway, a round-arched barrel vault 13 m wide through it from face to face 18.5 m from the river
//                   face (the DUMBO Archway's line in the same data); over the cornice on either side of the deck an open
//                   colonnade between two end blocks with arched openings, its entablature 9.5 m over the roadway (Carrere
//                   and Hastings, 1909); the land end (24 m) a battered rock-faced wing up to the walkway
//   the approach    the deck as over the river: four Warren trusses 7.6 m deep at the stiffening trusses' panel, the two
//                   upper roadways over the track pairs, the lower roadway between the inner trusses, the walkway on the
//                   south side and the bikeway on the north on the lower level, carried by granite wall-piers under each
//                   pair of trusses, one in each block between the streets the record says pass under the deck; where the
//                   trusses come down to the ground the tracks and the lower level end at a portal (the subway's
//                   tunnel) and the upper roadways run on, on a fill between granite walls with girder spans over the
//                   streets, to the street at the deck's end
// Heights are the record's anchored deck (world/haAnchor.js: the measured deck on the terrain); the ground under it is the
// record's. The deck past the anchorage stands on the towers' axis (the record's centre line follows one carriageway of the
// street it lands on there). Every part is laid out in the bridge's frame (br/frame.js).
import { slab, laneLines, truss, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';
import * as M from './mats.js';

const O_IN = 5.8, O_OUT = 14.8, EDGE = 18.3, DEPTH = 7.6, PANEL = 7.32, LOW = 6.7;
// the anchorage (metres, its footprint in OpenStreetMap): its length from the river face, the tower's length, the tower's and
// the wing's half widths and the offset of their centre from the deck's, the length of the tower's two piers along the bridge
// and how far the Archway's bay between them is set back, the Archway's span and springing over the ground, the
// rock-faced base's height
const AN = { L: 58.6, LC: 38.6, bR: 24.75, bW: 22.2, oc: -0.7, pierL: 11.8, recess: 1.4, archW: 13.0, archSpring: 8.5, rustic: 9.0 };

// the ground under the centre line at s, with a floor for the river (the record's null)
const gAt = (F, s) => { const g = F.groundAt(s); return g === null ? 0 : g; };

// the record's centre line past the anchorage follows one carriageway of the street it lands on (11 m off the towers' axis
// past 1890 m); the deck stands on the axis: the points past the anchorage put on it (heights and ground kept, a point
// that would step back dropped)
function axisFrame(F, rec, sAn) {
  const T = rec.layout && rec.layout.towers;
  if (!T || T.length < 2) return F;
  const ux0 = T[1].x - T[0].x, uz0 = T[1].z - T[0].z, ul = Math.hypot(ux0, uz0), ux = ux0 / ul, uz = uz0 / ul;
  const D = [], G = [];
  let last = -Infinity;
  for (let i = 0; i < rec.deck.length; i++) {
    const p = rec.deck[i], g = rec.ground ? rec.ground[i] : null;
    if (F.s[i] <= sAn) { D.push(p); G.push(g); last = (p[0] - T[1].x) * ux + (p[2] - T[1].z) * uz; continue; }
    const t = (p[0] - T[1].x) * ux + (p[2] - T[1].z) * uz;
    if (t < last + 0.5) continue;
    D.push([T[1].x + ux * t, p[1], T[1].z + uz * t]); G.push(g); last = t;
  }
  return new F.constructor({ deck: D, ground: rec.ground ? G : null });
}

export function buildBrooklynEnd(bag, F0, rec, sAn, mats) {
  const F = axisFrame(F0, rec, sAn);
  const { steel, steelD, asph, conc, lw, ly, lamp } = mats;
  const y = (s) => F.yAt(s), yLow = (s) => y(s) - LOW;
  const top = (s) => y(s) - 0.35, bot = (s) => y(s) - 0.35 - DEPTH;
  const sL = sAn + AN.L, sEnd = F.L;
  // the granite: rock-faced for the base, dressed above (the kit's generated ashlar, weathered per vertex)
  const gran = M.ashlar(0xa89c88, 1.5, { ledges: [], sub: 1.6, seed: 7 }), granD = M.ashlar(0xb0a591, 1.5, { style: 'dressed', seed: 9 });
  const granT = M.ashlar(0xbab0a0, 1.2, { style: 'dressed', seed: 11 });   // the trim: cornices, impost bands, coping
  const dark = M.concrete(0x3a3a38);
  const yCor = anchorage(bag, F, sAn, gran, granD, granT, dark, y, bot);
  // where the trusses' bottom chords come within 0.6 m of the ground the lower level ends at the portal (the tracks go on
  // in the subway's tunnel) and the upper roadways run on, on fill; the streets the record says pass under the deck before
  // it keep their clearance under the trusses
  let sPortal = sEnd - 30;
  for (let s = sL + 20; s < sEnd - 30; s += 2) if (bot(s) - 0.4 - gAt(F, s) < 0.6) { sPortal = s; break; }
  const sFill = sPortal;
  // ---- the deck from the anchorage's river face to the portal: trusses, floors, roadways, tracks, walkway, bikeway
  deck(bag, F, sAn, sPortal, mats, y, yLow, top, bot);
  // ---- the piers under the trusses: one in each block between the streets the record says pass under the deck
  const piers = pierStations(F, rec, sL, sPortal);
  for (const s of piers) pierPair(bag, F, s, steelD, gran, granT, bot);
  // ---- past the portal: the upper roadways on a granite-walled fill to the deck's end, girder spans over the streets;
  // the portal's face over the lower level with the tunnel mouths
  portal(bag, F, sPortal, gran, granT, dark, yLow, y);
  endRamp(bag, F, rec, sPortal, sEnd, mats, gran, granT, y);
  return { sL, sFill, sPortal, piers: piers.length, cornice: yCor };
}

// ------------------------------------------------------------------------------------------------ the deck
function deck(bag, F, a, b, mats, y, yLow, top, bot) {
  const { steel, steelD, asph, conc, lw, ly, lamp } = mats;
  for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) truss(bag, F, steel, a, b, o, top, bot, PANEL, 'warrenV', { chord: [0.6, 0.75], vert: [0.42, 0.42], diag: [0.38, 0.45] });
  crossBeams(bag, F, steelD, a, b, PANEL / 2, -O_OUT, -O_IN, (s) => y(s) - 0.3, 0.3, 1.0);
  crossBeams(bag, F, steelD, a, b, PANEL / 2, O_IN, O_OUT, (s) => y(s) - 0.3, 0.3, 1.0);
  crossBeams(bag, F, steelD, a, b, PANEL / 2, -EDGE + 0.3, EDGE - 0.3, (s) => yLow(s) - 0.3, 0.35, 1.25);
  lateralX(bag, F, steelD, a, b, PANEL, -O_OUT, O_OUT, (s) => bot(s) - 0.4, 0.16);
  // the upper roadways (two lanes each) and their parapets
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? O_IN + 0.3 : -O_OUT + 0.3, o1 = sg > 0 ? O_OUT - 0.3 : -O_IN - 0.3, c = (o0 + o1) / 2;
    slab(bag, F, asph, a, b, o0, o1, y, 0.3, 6);
    laneLines(bag, F, lw, ly, a, b, y, [{ o: c, w: 0.11, dash: [3.05, 9.15] }, { o: o0 + 0.25, w: 0.12, yellow: sg < 0 }, { o: o1 - 0.25, w: 0.12, yellow: sg > 0 }]);
    for (const o of [o0, o1]) railing(bag, F, steelD, a, b, o + (o === o0 ? -0.05 : 0.05), y, 1.05, 2.4, 0.08);
  }
  // the lower roadway between the inner trusses (three lanes)
  slab(bag, F, asph, a, b, -O_IN + 0.4, O_IN - 0.4, yLow, 0.3, 6);
  laneLines(bag, F, lw, ly, a, b, yLow, [{ o: -1.75, w: 0.11, dash: [3.05, 9.15] }, { o: 1.75, w: 0.11, dash: [3.05, 9.15] }, { o: -O_IN + 0.65, w: 0.12 }, { o: O_IN - 0.65, w: 0.12 }]);
  // the track beds under the upper roadways, the walkway (south, o < 0) and the bikeway (north) outside the outer trusses
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? O_IN + 0.4 : -O_OUT + 0.4, o1 = sg > 0 ? O_OUT - 0.4 : -O_IN - 0.4;
    slab(bag, F, conc, a, b, o0, o1, (s) => yLow(s) - 0.25, 0.4, 8);
    tracks(bag, F, steelD, a, b, (o0 + o1) / 2, (s) => yLow(s) - 0.25);
    const w0 = sg > 0 ? O_OUT + 0.95 : -EDGE, w1 = sg > 0 ? EDGE : -O_OUT - 0.95;
    slab(bag, F, conc, a, b, w0, w1, (s) => yLow(s) + 0.3, 0.3, 8);
    railing(bag, F, steelD, a, b, sg * EDGE, (s) => yLow(s) + 0.3, 2.4, 2.4, 0.07);   // the tall fence
    for (let s = a + 20; s < b - 10; s += 40) lampHead(bag, F, steelD, lamp, s, sg * (O_OUT + 0.6), (ss) => yLow(ss) + 0.3);
  }
}
function tracks(bag, F, mat, s0, s1, o, ybed) {
  for (const t of [-1.9, 1.9]) for (const r of [-0.72, 0.72]) {
    const ss = F.range(s0, s1, 12);
    for (let i = 0; i + 1 < ss.length; i++) bag.beam(mat, F.P(ss[i], o + t + r, ybed(ss[i]) + 0.32), F.P(ss[i + 1], o + t + r, ybed(ss[i + 1]) + 0.32), 0.08, 0.15);
  }
}
function lampHead(bag, F, post, lamp, s, o, ybase) {
  if (bag.lod) return;
  const y0 = ybase(s);
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 5.2), 0.07, 6, 0.05, true);
  bag.rod(lamp, F.P(s, o, y0 + 5.2), F.P(s, o, y0 + 5.45), 0.22, 8, 0.22, true);
}

// ------------------------------------------------------------------------------------------------ the anchorage
// The river end of the block (LC m) stands as a tower over the whole width: rusticated corner pilasters from the plinth to
// the cornice, the Archway through it, a row of small windows under the cornice, and over the cornice on either side of the
// deck an open colonnade between two end blocks with arched openings, its entablature 9.5 m over the roadway. The land end
// (L - LC m) is a battered wing of rock-faced stone up to the walkway, the trusses bearing on both. Returns the cornice's top.
function anchorage(bag, F, sR, gran, granD, granT, dark, y, bot) {
  const sL = sR + AN.L, sC = sR + AN.LC, oc = AN.oc, B = AN.bR, Bb = AN.bR - AN.recess, bW = AN.bW;
  const sP = sR + AN.pierL, sQ = sC - AN.pierL;          // the river pier, the Archway's bay, the land pier
  let g = Infinity; for (let s = sR; s <= sL; s += 4) g = Math.min(g, gAt(F, s));
  const g0 = g - 1.2;                                    // (the footing under the ground)
  let yC = Infinity; for (let s = sR; s <= sL; s += 2) yC = Math.min(yC, bot(s) - 0.15);   // the bearing level, level
  const yR = g + AN.rustic;                             // the rock-faced base's top
  const sA = (sP + sQ) / 2, hw = AN.archW / 2, ySpr = g + AN.archSpring, yCrown = ySpr + hw;
  const yRd = y(sR + AN.LC / 2), yStyl = yRd + 0.4, yEnt = yRd + 7.7, yTop = yRd + 9.5;   // the colonnade's levels
  const oT = EDGE + 0.35;                               // the side masses' inner face (beside the walkway's fence)
  const Wd = (sa, sb, w, ya, yb, mat, capA, capB) => quadBlock(bag, F, mat, sa, sb, oc - w, oc + w, oc - w, oc + w, ya, yb, capA, capB);
  // ---- the tower: two piers the full width, the recessed bay between them with the Archway through it; each in a
  // rock-faced base and dressed stone over it, to the bearing level under the trusses
  for (const [sa, sb, w, capA, capB] of [[sR, sP, B, true, true], [sQ, sC, B, true, true]]) {
    Wd(sa, sb, w, g0, yR, gran, capA, capB);
    Wd(sa, sb, w, yR, yC, granD, capA, capB);
  }
  for (const [sa, sb, ya] of [[sP, sA - hw, g0], [sA + hw, sQ, g0], [sA - hw, sA + hw, yCrown + 1.4]]) {
    if (ya < yR) Wd(sa, sb, Bb, ya, yR, gran, false, false);
    Wd(sa, sb, Bb, Math.max(ya, yR), yC, granD, false, false);
  }
  vault(bag, F, sA, hw, ySpr, oc - Bb - 0.2, oc + Bb + 0.2, granD, granT, dark, g, yCrown + 1.4);
  // the side masses outside the walkways rise on to the colonnades' stylobate
  for (const sg of [-1, 1]) {
    const lo = sg > 0 ? oT : oc - B, hi = sg > 0 ? oc + B : -oT;
    quadBlock(bag, F, granD, sR, sC, lo, hi, lo, hi, yC, yStyl, true, true);
  }
  // the tower's land face where it stands wider than the wing
  { const t = F.at(sC).t, nl = [t[0], 0, t[2]]; for (const [o0, o1] of [[oc + bW, oc + B], [oc - B, oc - bW]]) bag.quad(granD, F.P(sC, o0, g0), F.P(sC, o1, g0), F.P(sC, o1, yC), F.P(sC, o0, yC), nl); }
  // the piers' banded rustication over the base (a course 0.12 m proud every other 1.1 m) on their long and river faces;
  // the plinth and the base's top band round the tower
  const course = (sa, sb, o0, o1, ya, yb) => { for (let yy = ya, k = 0; yy < yb - 0.3; yy += 1.1, k++) if (k % 2 === 0) block(bag, F, granD, sa, sb, o0, o1, yy, Math.min(yb, yy + 0.98)); };
  for (const sg of [-1, 1]) for (const [sa, sb] of [[sR - 0.12, sP + 0.12], [sQ - 0.12, sC]]) {
    const o0 = sg > 0 ? oc + B - 0.05 : oc - B - 0.12, o1 = sg > 0 ? oc + B + 0.12 : oc - B + 0.05;
    course(sa, sb, o0, o1, yR + 0.3, yC - 1.4);
  }
  course(sR - 0.12, sR + 0.05, oc - B - 0.12, oc + B + 0.12, yR + 0.3, yC - 1.4);
  for (const [ya, yb, p] of [[g - 0.2, g + 1.3, 0.32], [yR - 0.3, yR + 0.3, 0.22]]) {
    for (const sg of [-1, 1]) {
      const face = (sa, sb, w) => quadBlock(bag, F, granT, sa, sb, sg > 0 ? oc + w - 0.05 : oc - w - p, sg > 0 ? oc + w + p : oc - w + 0.05, sg > 0 ? oc + w - 0.05 : oc - w - p, sg > 0 ? oc + w + p : oc - w + 0.05, ya, yb);
      face(sR - p, sP + p, B); face(sQ - p, sC, B);
      if (ya > yCrown) face(sP, sQ, Bb); else { face(sP, sA - hw - 0.05, Bb); face(sA + hw + 0.05, sQ, Bb); }
    }
    block(bag, F, granT, sR - p, sR + 0.05, oc - B - p, oc + B + p, ya, yb);
  }
  // the small windows: a row under the cornice on the piers' faces and the river face, two over the Archway
  const yW0 = yC - 4.6, yW1 = yC - 2.6;
  const win = (s, o, sg) => {
    const q = F.at(s).n, nn = [q[0] * sg, 0, q[2] * sg];
    bag.quad(dark, F.P(s - 0.55, o + sg * 0.13, yW0), F.P(s + 0.55, o + sg * 0.13, yW0), F.P(s + 0.55, o + sg * 0.13, yW1), F.P(s - 0.55, o + sg * 0.13, yW1), nn);
    block(bag, F, granT, s - 0.8, s + 0.8, sg > 0 ? o - 0.02 : o - 0.3, sg > 0 ? o + 0.3 : o + 0.02, yW0 - 0.3, yW0);
  };
  for (const sg of [-1, 1]) {
    for (const s of [sR + 3.2, sR + 6.0, sR + 8.8, sQ + 3.0, sQ + 5.8, sQ + 8.6]) win(s, oc + sg * B, sg);
    for (const s of [sA - 2.2, sA + 2.2]) win(s, oc + sg * Bb, sg);
  }
  { const t = F.at(sR).t, nb = [-t[0], 0, -t[2]]; for (const o of [-22, -19.5, 19.5, 22]) bag.quad(dark, F.P(sR - 0.14, oc + o + 0.55, yW0), F.P(sR - 0.14, oc + o - 0.55, yW0), F.P(sR - 0.14, oc + o - 0.55, yW1), F.P(sR - 0.14, oc + o + 0.55, yW1), nb); }
  // the cornice round the tower at the bearing level (a frieze band and a corona), broken where the deck passes
  for (const [p0, ya, yb] of [[0.25, yC - 1.3, yC - 0.5], [0.8, yC - 0.5, yC]]) {
    quadBlock(bag, F, granT, sR - p0, sC, oc - B - p0, -O_OUT - 0.9, oc - B - p0, -O_OUT - 0.9, ya, yb, true, false);
    quadBlock(bag, F, granT, sR - p0, sC, O_OUT + 0.9, oc + B + p0, O_OUT + 0.9, oc + B + p0, ya, yb, true, false);
    block(bag, F, granT, sR - p0, sR, -O_OUT - 0.9, O_OUT + 0.9, ya, yb);
  }
  // ---- the colonnades on the side masses
  for (const sg of [-1, 1]) colonnade(bag, F, sR, sC, sg, sg > 0 ? oT : oc - B, sg > 0 ? oc + B : -oT, yStyl, yEnt, yTop, granD, granT, dark);
  // ---- the land wing: battered rock-faced walls to the walkway, a coping; the middle to the bearing level
  const yWk = (s) => bot(s) + 1.55;                     // (the walkway's level, its slab 0.3 over the lower floor)
  const bat = 1.6;
  quadBlock(bag, F, gran, sC, sL, oc - bW, oc + bW, oc - bW, oc + bW, g0, yC, false, true);
  for (const sg of [-1, 1]) {
    const ss = F.range(sC, sL, 4);
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = ss[i], b = ss[i + 1], q = F.at((a + b) / 2).n, nn = [q[0] * sg * 0.97, 0.24, q[2] * sg * 0.97];
      bag.quad(gran, F.P(a, oc + sg * (bW + bat), g0), F.P(b, oc + sg * (bW + bat), g0), F.P(b, oc + sg * bW, yWk(b) - 0.6), F.P(a, oc + sg * bW, yWk(a) - 0.6), nn);
      block(bag, F, granT, a, b, sg > 0 ? oc + bW - 1.2 : oc - bW - 0.15, sg > 0 ? oc + bW + 0.15 : oc - bW + 1.2, Math.min(yWk(a), yWk(b)) - 0.6, Math.min(yWk(a), yWk(b)) - 0.1);
      block(bag, F, gran, a, b, sg > 0 ? O_OUT + 1.0 : oc - bW, sg > 0 ? oc + bW : -O_OUT - 1.0, yC, Math.min(yWk(a), yWk(b)) - 0.6);
    }
  }
  { const t = F.at(sL).t, ne = [t[0] * 0.97, 0.24, t[2] * 0.97]; bag.quad(gran, F.P(sL + bat, oc - bW - bat, g0), F.P(sL + bat, oc + bW + bat, g0), F.P(sL, oc + bW, yC), F.P(sL, oc - bW, yC), ne); }
  // bearing pedestals under the trusses' bottom chords (the deck's grade over the level top)
  for (let s = sR + 3; s < sL - 1; s += PANEL) for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) {
    const yb = bot(s) - 0.1;
    if (yb - yC > 0.08) block(bag, F, granT, s - 0.7, s + 0.7, o - 0.8, o + 0.8, yC, yb);
  }
  return yC;
}
// an open colonnade on a side tower (side sg) from sR to sC: two end blocks with arched openings through them, two rows of
// columns between on the stylobate, the entablature, the end blocks' attic a little higher
function colonnade(bag, F, sR, sC, sg, lo, hi, yStyl, yEnt, yTop, mat, trim, dark) {
  const endL = 6.4;
  // the stylobate and the end blocks
  block(bag, F, trim, sR - 0.2, sC + 0.2, lo - 0.2, hi + 0.2, yStyl - 0.5, yStyl);
  for (const [s0, s1] of [[sR, sR + endL], [sC - endL, sC]]) {
    // an arched opening through the block along the across direction, 2.6 m wide: the block as two piers and a lintel mass
    const sc = (s0 + s1) / 2, w = 1.3, ySp = yStyl + 3.0, yCr = ySp + w;
    block(bag, F, mat, s0, sc - w, lo, hi, yStyl, yEnt);
    block(bag, F, mat, sc + w, s1, lo, hi, yStyl, yEnt);
    block(bag, F, mat, sc - w, sc + w, lo, hi, yCr + 0.6, yEnt);
    for (let j = 0; j < 8; j++) {
      const t0 = Math.PI - (j / 8) * Math.PI, t1 = Math.PI - ((j + 1) / 8) * Math.PI, tt = F.at(sc).t, am = (t0 + t1) / 2;
      const P = (t, o, r = w) => F.P(sc + Math.cos(t) * r, o, ySp + Math.sin(t) * r);
      bag.quad(dark, P(t0, lo), P(t1, lo), P(t1, hi), P(t0, hi), [-tt[0] * Math.cos(am), -Math.sin(am), -tt[2] * Math.cos(am)]);
      // the spandrel fill between the arch and the lintel mass, as slices
      const x0 = Math.cos(t0) * w, x1 = Math.cos(t1) * w;
      block(bag, F, mat, sc + Math.min(x0, x1), sc + Math.max(x0, x1), lo, hi, ySp + Math.min(Math.sin(t0), Math.sin(t1)) * w, yCr + 0.6);
      for (const [o, d] of [[hi, 1], [lo, -1]]) {
        const q = F.at(sc).n, nF = [q[0] * d, 0, q[2] * d], Q = (t, r) => F.P(sc + Math.cos(t) * r, o + d * 0.1, ySp + Math.sin(t) * r);
        bag.quad(trim, Q(t0, w), Q(t1, w), Q(t1, w + 0.45), Q(t0, w + 0.45), nF);
      }
    }
    for (const sgn of [-1, 1]) block(bag, F, dark, sc + sgn * w - (sgn > 0 ? 0.02 : -0.02), sc + sgn * w, lo, hi, yStyl, ySp);
    // the attic over the end block and its cap
    block(bag, F, trim, s0 - 0.35, s1 + 0.35, lo - 0.35, hi + 0.35, yTop - 0.1, yTop + 0.5);
    block(bag, F, mat, s0, s1, lo, hi, yEnt, yTop + 1.3);
    block(bag, F, trim, s0 - 0.25, s1 + 0.25, lo - 0.25, hi + 0.25, yTop + 1.3, yTop + 1.75);
  }
  // the columns: two rows, about 3.4 m apart along the colonnade, 1.0 m across, with a base and a capital
  const c0 = sR + endL, c1 = sC - endL, n = Math.max(2, Math.round((c1 - c0) / 3.4)), step = (c1 - c0) / n;
  for (let k = 1; k < n; k++) {
    const s = c0 + k * step;
    for (const o of [lo + 0.75, hi - 0.75]) {
      const p0 = F.P(s, o, yStyl), p1 = F.P(s, o, yEnt - 0.55);
      block(bag, F, trim, s - 0.7, s + 0.7, o - 0.7, o + 0.7, yStyl, yStyl + 0.45);
      bag.rod(mat, [p0[0], yStyl + 0.45, p0[2]], [p1[0], yEnt - 0.55, p1[2]], 0.5, 12, 0.43, false);
      block(bag, F, trim, s - 0.68, s + 0.68, o - 0.68, o + 0.68, yEnt - 0.55, yEnt);
    }
  }
  // pilasters against the end blocks' inner faces, the colonnade's ceiling (dark), the entablature and cornice
  block(bag, F, dark, c0, c1, lo + 0.1, hi - 0.1, yEnt - 0.05, yEnt);
  block(bag, F, trim, c0, c1, lo - 0.1, hi + 0.1, yEnt, yEnt + 1.1);
  block(bag, F, mat, c0, c1, lo, hi, yEnt + 1.1, yTop - 0.4);
  block(bag, F, trim, c0 - 0.3, c1 + 0.3, lo - 0.45, hi + 0.45, yTop - 0.4, yTop + 0.1);
}
// a block from a to b whose half widths go from (a: o0a..o1a) to (b: o0b..o1b), y0..y1; ends capped where asked
function quadBlock(bag, F, mat, a, b, o0a, o1a, o0b, o1b, y0, y1, capA = true, capB = true) {
  const P = (s, o, yy) => F.P(s, o, yy);
  const n = (s, sg) => { const q = F.at(s).n; return [q[0] * sg, 0, q[2] * sg]; };
  const ss = F.range(a, b, 6);
  for (let i = 0; i + 1 < ss.length; i++) {
    const sa = ss[i], sb = ss[i + 1], ta = (sa - a) / (b - a || 1), tb = (sb - a) / (b - a || 1);
    const lA = o0a + (o0b - o0a) * ta, lB = o0a + (o0b - o0a) * tb, rA = o1a + (o1b - o1a) * ta, rB = o1a + (o1b - o1a) * tb;
    bag.quad(mat, P(sa, rA, y0), P(sb, rB, y0), P(sb, rB, y1), P(sa, rA, y1), n((sa + sb) / 2, 1));
    bag.quad(mat, P(sb, lB, y0), P(sa, lA, y0), P(sa, lA, y1), P(sb, lB, y1), n((sa + sb) / 2, -1));
    bag.quad(mat, P(sa, lA, y1), P(sa, rA, y1), P(sb, rB, y1), P(sb, lB, y1), [0, 1, 0]);
  }
  const t = (s, sg) => { const q = F.at(s).t; return [q[0] * sg, 0, q[2] * sg]; };
  if (capA) bag.quad(mat, P(a, o0a, y0), P(a, o1a, y0), P(a, o1a, y1), P(a, o0a, y1), t(a, -1));
  if (capB) bag.quad(mat, P(b, o1b, y0), P(b, o0b, y0), P(b, o0b, y1), P(b, o1b, y1), t(b, 1));
}
// the Archway's vault: the soffit (a half cylinder across the bridge, axis along the frame's across direction) and its
// rings; the jambs (the passage's side walls) to the springing
function vault(bag, F, sA, hw, ySpr, o0, o1, mat, trim, dark, g, yFill) {
  const N = 18, ring = 0.95;
  // the spandrels on both faces: from the arch's curve up to the block over the passage (yFill), as vertical slices
  for (const [o, sg] of [[o0, -1], [o1, 1]]) {
    const q = F.at(sA).n, nF = [q[0] * sg, 0, q[2] * sg], M = 16;
    for (let j = 0; j < M; j++) {
      const x0 = -hw + (2 * hw * j) / M, x1 = -hw + (2 * hw * (j + 1)) / M;
      const y0 = ySpr + Math.sqrt(Math.max(0, hw * hw - x0 * x0)), y1 = ySpr + Math.sqrt(Math.max(0, hw * hw - x1 * x1));
      bag.quad(mat, F.P(sA + x0, o, y0), F.P(sA + x1, o, y1), F.P(sA + x1, o, yFill), F.P(sA + x0, o, yFill), nF);
    }
  }
  const arc = (k, r) => { const a = Math.PI - (k / N) * Math.PI; return [sA + Math.cos(a) * r, ySpr + Math.sin(a) * r, a]; };
  // the soffit, facing the passage's axis
  for (let k = 0; k < N; k++) {
    const [s0, y0, a0] = arc(k, hw), [s1, y1, a1] = arc(k + 1, hw), am = (a0 + a1) / 2, t = F.at(sA).t;
    const nIn = [-(t[0] * Math.cos(am)), -Math.sin(am), -(t[2] * Math.cos(am))];
    bag.quad(dark, F.P(s0, o0, y0), F.P(s1, o0, y1), F.P(s1, o1, y1), F.P(s0, o1, y0), nIn);
  }
  // the jambs from the ground to the springing (facing into the passage)
  const t = F.at(sA).t;
  for (const sg of [-1, 1]) {
    const s = sA + sg * hw, nn = [-t[0] * sg, 0, -t[2] * sg];
    bag.quad(mat, F.P(s, o0, g - 0.5), F.P(s, o1, g - 0.5), F.P(s, o1, ySpr), F.P(s, o0, ySpr), nn);
  }
  // the voussoir rings on both faces (proud 0.18, a keystone 0.3) and the impost blocks
  for (const [o, sg] of [[o0, -1], [o1, 1]]) {
    const q = F.at(sA).n, nF = [q[0] * sg, 0, q[2] * sg], nV = 17;
    for (let k = 0; k < nV; k++) {
      const a0 = Math.PI - (k / nV) * Math.PI + 0.012, a1 = Math.PI - ((k + 1) / nV) * Math.PI - 0.012, key = k === (nV - 1) / 2;
      const rr = hw + ring * (key ? 1.35 : 1), w = key ? 0.3 : 0.18;
      const P = (a, r, d) => F.P(sA + Math.cos(a) * r, o + sg * d, ySpr + Math.sin(a) * r);
      bag.quad(trim, P(a0, hw, w), P(a1, hw, w), P(a1, rr, w), P(a0, rr, w), nF);
      const am = (a0 + a1) / 2, nOut = [t[0] * Math.cos(am), Math.sin(am), t[2] * Math.cos(am)];
      bag.quad(trim, P(a0, rr, 0), P(a1, rr, 0), P(a1, rr, w), P(a0, rr, w), nOut);
      bag.quad(trim, P(a0, hw, 0), P(a0, rr, 0), P(a0, rr, w), P(a0, hw, w), [-t[0] * Math.sin(a0), Math.cos(a0), -t[2] * Math.sin(a0)]);
      bag.quad(trim, P(a1, rr, 0), P(a1, hw, 0), P(a1, hw, w), P(a1, rr, w), [t[0] * Math.sin(a1), -Math.cos(a1), t[2] * Math.sin(a1)]);
    }
    for (const e of [-1, 1]) block(bag, F, trim, sA + e * hw - (e < 0 ? 1.1 : 0), sA + e * hw + (e > 0 ? 1.1 : 0), sg > 0 ? o - 0.05 : o - 0.3, sg > 0 ? o + 0.3 : o + 0.05, ySpr - 0.55, ySpr + 0.1);
  }
}
// ------------------------------------------------------------------------------------------------ the piers
// a pier in the middle of every gap of 14 m or more between the streets the record says pass under the deck (and between the
// anchorage's land face and the first street), from s0 to s1
function pierStations(F, rec, s0, s1) {
  const Z = (rec.under || []).filter((u) => u[1] > s0 && u[0] < s1).map((u) => [u[0], u[1]]).sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const z of Z) { const l = merged[merged.length - 1]; if (l && z[0] <= l[1] + 2) l[1] = Math.max(l[1], z[1]); else merged.push(z.slice()); }
  const out = [];
  let prev = s0;
  for (const z of merged) { if (z[0] - prev >= 14) out.push((prev + z[0]) / 2); prev = Math.max(prev, z[1]); }
  if (s1 - prev >= 22) out.push(Math.min((prev + s1) / 2, s1 - 12));
  return out.filter((q) => q > s0 + 6 && q < s1 - 6);
}
// a pier pair at s: under each pair of trusses a granite wall-pier 3.2 m along the bridge, battered 1:40, from its footing to
// a projecting cap under the bottom chords; a steel cross girder between the caps carries the lower roadway's floor
function pierPair(bag, F, s, steelD, gran, granT, bot) {
  const g = Math.min(gAt(F, s - 2), gAt(F, s + 2), gAt(F, s)), yCap = bot(s) - 0.45, H = yCap - 1.2 - g;
  if (H < 2.5) return;
  const a = 1.6, bat = H / 40;
  for (const sg of [-1, 1]) {
    const oc = sg * (O_IN + O_OUT) / 2, b = (O_OUT - O_IN) / 2 + 1.0;
    // the footing, the shaft in two tapers (rock-faced to 3 m, dressed above), the cap with its moulding
    block(bag, F, granT, s - a - bat - 0.5, s + a + bat + 0.5, oc - b - bat - 0.5, oc + b + bat + 0.5, g - 1.0, g + 0.35);
    taper(bag, F, gran, s, oc, g + 0.35, g + 3.0, a + bat, b + bat, a + bat * 0.8, b + bat * 0.8);
    taper(bag, F, granT, s, oc, g + 3.0, g + 3.3, a + bat * 0.8 + 0.08, b + bat * 0.8 + 0.08, a + bat * 0.8 + 0.08, b + bat * 0.8 + 0.08);
    taper(bag, F, gran, s, oc, g + 3.3, yCap - 1.2, a + bat * 0.8, b + bat * 0.8, a, b);
    taper(bag, F, granT, s, oc, yCap - 1.2, yCap - 0.7, a, b, a + 0.35, b + 0.35);
    block(bag, F, granT, s - a - 0.4, s + a + 0.4, oc - b - 0.4, oc + b + 0.4, yCap - 0.7, yCap);
    // bearing shoes under the two trusses
    for (const o of [sg * O_IN, sg * O_OUT]) block(bag, F, steelD, s - 0.6, s + 0.6, o - 0.6, o + 0.6, yCap, bot(s) + 0.05);
  }
  // the cross girder from cap to cap under the lower roadway
  memberSO(bag, F, steelD, s, -O_IN - 0.5, yCap - 0.65, s, O_IN + 0.5, yCap - 0.65, 0.9, 1.3);
}

// ------------------------------------------------------------------------------------------------ the portal and the ramp
// the portal across the deck at s: a granite face from the lower level's floor to the roadways, with the two track pairs'
// tunnel mouths and the lower roadway's, dark
function portal(bag, F, s, gran, granT, dark, yLow, y) {
  const yb = yLow(s) - 1.4, yt = y(s) - 0.3;
  block(bag, F, gran, s, s + 2.5, -EDGE, EDGE, yb, yt);
  block(bag, F, granT, s - 0.15, s + 2.6, -EDGE - 0.2, EDGE + 0.2, yb + 1.0, yb + 1.25);
  const t = F.at(s).t, nb = [-t[0], 0, -t[2]], y0 = yLow(s) - 0.65;
  for (const [o0, o1, h] of [[-O_OUT + 0.6, -O_IN - 0.6, 5.0], [-O_IN + 0.6, O_IN - 0.6, 5.2], [O_IN + 0.6, O_OUT - 0.6, 5.0], [-EDGE + 0.2, -O_OUT - 0.9, 3.0], [O_OUT + 0.9, EDGE - 0.2, 3.0]]) {
    bag.quad(dark, F.P(s - 0.02, o0, y0), F.P(s - 0.02, o1, y0), F.P(s - 0.02, o1, y0 + h), F.P(s - 0.02, o0, y0 + h), nb);
  }
}
// the upper roadways from the portal to the deck's end on a fill between granite walls at their outer edges (a parapet over
// them, a coping), the strip between them a concrete median; over each street the record says passes under, a girder span
// (fascia girders, the floor's soffit) instead of the fill
function endRamp(bag, F, rec, a, b, mats, gran, granT, y) {
  if (b - a < 2) return;
  const { steelD, asph, conc, lw, ly } = mats;
  const gaps = (rec.under || []).filter((u) => u[1] > a && u[0] < b).map((u) => [u[0] - 1.5, u[1] + 1.5]);
  const inGap = (s) => gaps.some((q) => s > q[0] && s < q[1]);
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? O_IN + 0.3 : -O_OUT + 0.3, o1 = sg > 0 ? O_OUT - 0.3 : -O_IN - 0.3, c = (o0 + o1) / 2;
    slab(bag, F, asph, a, b, o0, o1, y, 0.3, 5);
    laneLines(bag, F, lw, ly, a, b, y, [{ o: c, w: 0.11, dash: [3.05, 9.15] }, { o: o0 + 0.25, w: 0.12, yellow: sg < 0 }, { o: o1 - 0.25, w: 0.12, yellow: sg > 0 }]);
  }
  slab(bag, F, conc, a, b, -O_IN - 0.05, O_IN + 0.05, (s) => y(s) + 0.15, 0.45, 5);
  const ss = F.range(a, b, 2.5);
  for (let i = 0; i + 1 < ss.length; i++) {
    const s0 = ss[i], s1 = ss[i + 1], sm = (s0 + s1) / 2, gap = inGap(sm), g0 = gAt(F, s0) - 0.6, g1 = gAt(F, s1) - 0.6;
    for (const sg of [-1, 1]) {
      const o = sg * (O_OUT + 0.25), n = F.at(sm).n, nn = [n[0] * sg, 0, n[2] * sg];
      if (gap) {
        // a fascia girder 1.6 m deep and a steel railing over it
        bag.quad(steelD, F.P(s0, o, y(s0) - 1.9), F.P(s1, o, y(s1) - 1.9), F.P(s1, o, y(s1) - 0.3), F.P(s0, o, y(s0) - 0.3), nn);
        railing(bag, F, steelD, s0, s1, o - sg * 0.2, y, 1.1, 2.5, 0.08);
        continue;
      }
      if (Math.min(y(s0), y(s1)) - Math.max(g0, g1) < 0.4) continue;
      // the wall's face, battered a little, its parapet and coping
      bag.quad(gran, F.P(s0, o + sg * 0.3, g0), F.P(s1, o + sg * 0.3, g1), F.P(s1, o, y(s1) + 0.95), F.P(s0, o, y(s0) + 0.95), nn);
      bag.quad(granT, F.P(s0, o + sg * 0.08, y(s0) + 0.95), F.P(s1, o + sg * 0.08, y(s1) + 0.95), F.P(s1, o + sg * 0.08, y(s1) + 1.2), F.P(s0, o + sg * 0.08, y(s0) + 1.2), nn);
      bag.quad(granT, F.P(s0, o + sg * 0.08, y(s0) + 1.2), F.P(s1, o + sg * 0.08, y(s1) + 1.2), F.P(s1, o - sg * 0.55, y(s1) + 1.2), F.P(s0, o - sg * 0.55, y(s0) + 1.2), [0, 1, 0]);
      bag.quad(gran, F.P(s1, o - sg * 0.55, y(s1) + 1.2), F.P(s0, o - sg * 0.55, y(s0) + 1.2), F.P(s0, o - sg * 0.55, y(s0) - 0.05), F.P(s1, o - sg * 0.55, y(s1) - 0.05), [-nn[0], 0, -nn[2]]);
    }
    if (gap) {
      // the span's soffit and the floor beams' line
      slab(bag, F, steelD, s0, s1, -O_OUT - 0.25, O_OUT + 0.25, (s) => y(s) - 0.3, 1.6, 2.5, { top: false, sides: false, caps: false });
    }
  }
  // the gaps' abutments: granite faces across at each gap's ends
  for (const [q0, q1] of gaps) for (const [sq, sg] of [[q0, 1], [q1, -1]]) {
    if (sq < a + 1 || sq > b - 1) continue;
    const t = F.at(sq).t, nn = [t[0] * sg, 0, t[2] * sg], gq = gAt(F, sq) - 0.6, yq = y(sq) - 1.9;
    if (yq - gq < 0.5) continue;
    bag.quad(gran, F.P(sq, -O_OUT - 0.25, gq), F.P(sq, O_OUT + 0.25, gq), F.P(sq, O_OUT + 0.25, yq), F.P(sq, -O_OUT - 0.25, yq), nn);
  }
}
