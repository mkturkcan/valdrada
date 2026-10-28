// The Manhattan Bridge (Leon Moisseiff, engineer; Carrere and Hastings, architects; 1909), from its published dimensions
// and the record's layout (tools/pipeline/bridges.mjs: both towers' piers from the NOAA ENC, the roadway's profile).
// Facts used (Wikipedia, "Manhattan Bridge"; HAER NY-127): main span 1,470 ft (448 m), side spans 725 ft (221 m); deck 120
// ft (36.6 m) wide on two levels: two upper roadways of two lanes over the track pairs, and below them four subway tracks
// (two under each upper roadway), the three-lane lower roadway in the middle, the walkway outside on the south and the
// bikeway on the north; four Warren stiffening trusses 24-26 ft deep (two flanking each track pair); four cables of 21 in
// (0.53 m); towers of four steel columns 5 ft wide across, tapering along the bridge from 32 ft at the pedestal to 10 ft
// at the top, braced with diagonal lattice, 336 ft to the saddles (spherical finials to 350 ft) on masonry piers; 135 ft
// (41.1 m) of clearance at mid-span; anchorages 237 x 182 ft and 135 ft high. Form details (the arched portals between
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, cableY, cablePts, suspenders, block, taper, memberSO } from './parts.js';

// (BR06: a deeper blue-grey, photographs: the paler paint read brown under the golden grade)
const C = { steel: 0x8197a8, steelD: 0x6c8292, stone: 0x9f998d, stoneD: 0x878175, lamp: 0xffe2b0, conc: 0xa29e95 };
const O_IN = 5.8, O_OUT = 14.8, EDGE = 18.3;   // the inner and outer truss and cable planes; the walkway's outer edge
const DEPTH = 7.6, PANEL = 7.32;               // the trusses' depth and panel
const LOW = 6.7;                               // the lower level under the upper roadways
const PED = 9.0, SADDLE = 100.2, TOP = 101.6;  // the steel towers' pedestal, the cables' saddles, the columns' tops

export function buildManhattan(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.5), stoneD = M.ashlar(C.stoneD, 1.5, { style: 'dressed' });
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), lamp = M.glow(C.lamp, 2.0), conc = M.concrete(C.conc);
  const cab = M.cable(C.steel, { px: 0.0003 }), hang = M.cable(C.steelD, { px: 0.00008 });
  const [sA, sB] = lay.main, [anA, anB] = lay.anchorages.map((a) => a.s), towersS = [sA, sB];
  const y = (s) => F.yAt(s), yLow = (s) => y(s) - LOW;
  const s0 = Math.max(0, anA), s1 = Math.min(F.L, anB);

  // ---- towers
  // (the towers floodlit after dark)
  const lit = M.paint(C.steel, { flood: { y0: 8, y1: 106, k: 1.3 } }), litD = M.paint(C.steelD, { flood: { y0: 8, y1: 106, k: 1.3 } });
  for (const sT of towersS) tower(bag, F, sT, lit, litD, stone, stoneD);

  // ---- stiffening trusses (cut round the tower columns), floors, roadways, tracks, walkways
  const top = (s) => y(s) - 0.35, bot = (s) => y(s) - 0.35 - DEPTH;
  // the columns' half depth along the bridge at the deck (they taper from 4.88 m at the pedestal to 1.53 m at the top)
  const colHalf = (sT) => 4.875 + (1.525 - 4.875) * ((F.yAt(sT) - PED) / (TOP - PED));
  const runs = cut(s0, s1, towersS.map((t) => [t - colHalf(t) - 0.5, t + colHalf(t) + 0.5]));
  for (const [a, b] of runs) for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) truss(bag, F, steel, a, b, o, top, bot, PANEL, 'warrenV', { chord: [0.6, 0.75], vert: [0.42, 0.42], diag: [0.38, 0.45] });
  for (const [a, b] of runs) {
    // upper floor beams under each upper roadway, lower floor beams across the whole width, laterals under the lower deck
    crossBeams(bag, F, steelD, a, b, PANEL / 2, -O_OUT, -O_IN, (s) => y(s) - 0.3, 0.3, 1.0);
    crossBeams(bag, F, steelD, a, b, PANEL / 2, O_IN, O_OUT, (s) => y(s) - 0.3, 0.3, 1.0);
    crossBeams(bag, F, steelD, a, b, PANEL / 2, -EDGE + 0.3, EDGE - 0.3, (s) => yLow(s) - 0.3, 0.35, 1.25);
    lateralX(bag, F, steelD, a, b, PANEL, -O_OUT, O_OUT, (s) => bot(s) - 0.4, 0.16);
  }
  // upper roadways (two lanes each) with their parapets
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? O_IN + 0.3 : -O_OUT + 0.3, o1 = sg > 0 ? O_OUT - 0.3 : -O_IN - 0.3;
    slab(bag, F, asph, s0, s1, o0, o1, y, 0.3, 6);
    const c = (o0 + o1) / 2;
    laneLines(bag, F, lw, ly, s0, s1, y, [{ o: c, w: 0.11, dash: [3.05, 9.15] }, { o: o0 + 0.25, w: 0.12, yellow: sg < 0 }, { o: o1 - 0.25, w: 0.12, yellow: sg > 0 }]);
    for (const [a, b] of runs) for (const o of [o0, o1]) railing(bag, F, steelD, a, b, o + (o === o0 ? -0.05 : 0.05), y, 1.05, 2.4, 0.08);
  }
  // the lower level: the lower roadway in the middle, the track beds under the upper roadways, the walkway and bikeway
  slab(bag, F, asph, s0, s1, -O_IN + 0.4, O_IN - 0.4, yLow, 0.3, 6);
  laneLines(bag, F, lw, ly, s0, s1, yLow, [{ o: -1.75, w: 0.11, dash: [3.05, 9.15] }, { o: 1.75, w: 0.11, dash: [3.05, 9.15] }, { o: -O_IN + 0.65, w: 0.12 }, { o: O_IN - 0.65, w: 0.12 }]);
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? O_IN + 0.4 : -O_OUT + 0.4, o1 = sg > 0 ? O_OUT - 0.4 : -O_IN - 0.4;
    slab(bag, F, conc, s0, s1, o0, o1, (s) => yLow(s) - 0.25, 0.4, 8);
    trackPair(bag, F, steelD, s0, s1, (o0 + o1) / 2, (s) => yLow(s) - 0.25);
    const w0 = sg > 0 ? O_OUT + 0.95 : -EDGE, w1 = sg > 0 ? EDGE : -O_OUT - 0.95;
    slab(bag, F, conc, s0, s1, w0, w1, (s) => yLow(s) + 0.3, 0.3, 8);
    railing(bag, F, steelD, s0, s1, sg * EDGE, (s) => yLow(s) + 0.3, 2.4, 2.4, 0.07);   // the walkway's tall fence
    for (let s = s0 + 20; s < s1 - 10; s += 40) {
      if (towersS.some((t) => Math.abs(s - t) < 8)) continue;
      lampHead(bag, F, steelD, lamp, s, sg * (O_OUT + 0.6), (ss) => yLow(ss) + 0.3);
    }
  }

  // ---- cables and suspenders (the side spans are suspended)
  for (const oo of [O_IN, O_OUT]) {
    const midY = y(lay.mid) + 2.2 + (oo === O_OUT ? 0.4 : 0);
    const sup = [[anA, yLow(anA) + 2.0], [sA, SADDLE], [sB, SADDLE], [anB, yLow(anB) + 2.0]];
    const fMain = SADDLE - midY, fSide = fMain * (221 / 448) ** 2 * 1.15;
    const cy = cableY(sup, [fSide, fMain, fSide]);
    for (const sg of [-1, 1]) {
      const o = sg * oo;
      bag.tube(cab, cablePts(F, cy, o, anA, anB, 3), 0.27, 10);
      for (const [a, b] of cut(anA + 6, anB - 6, towersS.map((t) => [t - 4, t + 4]))) suspenders(bag, F, hang, cy, top, o, a, b, PANEL / 2, 0.04, steel, 0.15);
      necklace(bag, lamp, F, cy, o, anA, anB, 15);
    }
  }

  // ---- anchorages and the steel approaches
  for (const [sAn, away] of [[anA, -1], [anB, 1]]) anchorage(bag, F, sAn, away, stone, stoneD);
  for (const [a, b] of [[0, Math.max(0, anA - 72.2)], [Math.min(F.L, anB + 72.2), F.L]]) approach(bag, F, a, b, rec, steel, steelD, asph, conc, lw);
  // the decks over the anchorages
  for (const [a, b] of [[Math.max(0, anA - 72.2), anA], [anB, Math.min(F.L, anB + 72.2)]]) {
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? O_IN + 0.3 : -O_OUT + 0.3, o1 = sg > 0 ? O_OUT - 0.3 : -O_IN - 0.3;
      slab(bag, F, asph, a, b, o0, o1, y, 0.4, 6);
      for (const o of [o0, o1]) railing(bag, F, steelD, a, b, o, y, 1.05, 2.4, 0.08);
      block(bag, F, stoneD, a, b, sg > 0 ? O_IN : -O_OUT, sg > 0 ? O_OUT : -O_IN, yLow(a), y(a) - 0.4);
    }
  }

}

export function cut(s0, s1, holes) {
  let runs = [[s0, s1]];
  for (const [h0, h1] of holes) {
    const out = [];
    for (const [a, b] of runs) {
      if (h1 <= a || h0 >= b) { out.push([a, b]); continue; }
      if (h0 > a) out.push([a, h0]);
      if (h1 < b) out.push([h1, b]);
    }
    runs = out;
  }
  return runs.filter(([a, b]) => b - a > 0.5);
}

// two tracks (rails on ties) centred at o on ybed(s)
function trackPair(bag, F, mat, s0, s1, o, ybed) {
  for (const t of [-1.9, 1.9]) for (const r of [-0.72, 0.72]) {
    for (const [a, b] of pairs(F.range(s0, s1, 12))) bag.beam(mat, F.P(a, o + t + r, ybed(a) + 0.32), F.P(b, o + t + r, ybed(b) + 0.32), 0.08, 0.15);
  }
}
function pairs(ss) { const out = []; for (let i = 0; i + 1 < ss.length; i++) out.push([ss[i], ss[i + 1]]); return out; }

// necklace lights: a bulb every `step` along the cable (steady, lit after dark)
export function necklace(bag, mat, F, cy, o, s0, s1, step) {
  for (let s = s0 + step / 2; s < s1; s += step) { const p = F.P(s, o, cy(s) + 0.42); bag.rod(mat, [p[0], p[1] - 0.12, p[2]], [p[0], p[1] + 0.12, p[2]], 0.14, 6, 0.14, true); }
}
// a roadway lamp on an arm
function lampHead(bag, F, post, lamp, s, o, ybase) {
  if (bag.lod) return;
  const y0 = ybase(s);
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 5.2), 0.07, 6, 0.05, true);
  bag.rod(lamp, F.P(s, o, y0 + 5.2), F.P(s, o, y0 + 5.45), 0.22, 8, 0.22, true);
}

// a tower: the masonry pier with its cutwaters, four tapering columns (two per side frame) braced with stacked X panels
// in each frame, portals across the middle (an arched portal under the top girder, another under the deck), the cap and
// the four spherical finials
function tower(bag, F, sT, steel, steelD, stone, stoneD) {
  const fr = F.at(sT), yDeck = F.yAt(sT), yLow = yDeck - LOW;
  // the pier: a rusticated block with rounded cutwaters up and down stream (as octagonal ends)
  // (the ENC pier: 21.3 m along the bridge, 40 m across with its cutwaters)
  taper(bag, F, stoneD, sT, 0, -3, 2.0, 10.9, 16.6, 10.7, 16.4);
  taper(bag, F, stone, sT, 0, 2.0, PED, 10.4, 16.0, 9.8, 15.6);
  for (const sg of [-1, 1]) taper(bag, F, stone, sT, sg * 17.4, -3, PED, 6.6, 2.6, 5.4, 2.0);
  // columns: along-bridge depth 9.75 m at the pedestal to 3.05 m at the top, 1.52 m across
  const colO = [-O_OUT, -O_IN, O_IN, O_OUT];
  const halfD = (yy) => 4.875 + (1.525 - 4.875) * ((yy - PED) / (TOP - PED));
  const N = 14;
  // (BKB: each column two flanges at its tapering edges, 1.1 m along the bridge, joined on both its faces by a riveted X
  // lattice with a batten at every panel: from the side the towers read as open lattice, as in the photographs, not as
  // solid tapering slabs)
  for (const o of colO) {
    for (let i = 0; i < N; i++) {
      const ya = PED + ((TOP - PED) * i) / N, yb = PED + ((TOP - PED) * (i + 1)) / N, da = halfD(ya), db = halfD(yb);
      for (const f of [-1, 1]) {
        // a flange: a member along the column's tapering edge (1.52 m across, 1.1 m along the bridge)
        memberSO(bag, F, steel, sT + f * (da - 0.55), o, ya - 0.02, sT + f * (db - 0.55), o, yb + 0.02, 1.52, 1.1);
      }
      for (const fo of [-0.62, 0.62]) {
        const ia = da - 1.1, ib = db - 1.1;
        memberSO(bag, F, steelD, sT - ia, o + fo, ya, sT + ib, o + fo, yb, 0.22, 0.32);
        memberSO(bag, F, steelD, sT + ia, o + fo, ya, sT - ib, o + fo, yb, 0.22, 0.32);
        memberSO(bag, F, steel, sT - ia, o + fo, yb - 0.3, sT + ia, o + fo, yb - 0.3, 0.3, 0.6);
      }
    }
  }
  // X lattice between the two columns of each side frame, from the pedestal to the cap: panels of ~9 m
  for (const sg of [-1, 1]) {
    const oa = sg * O_IN, ob = sg * O_OUT;
    // (none through the deck: the track pairs pass between a frame's columns)
    const below = [], above = [];
    for (let k = 0, n = Math.max(1, Math.round((yLow - 2.2 - PED - 1) / 9)); k <= n; k++) below.push(PED + 1 + ((yLow - 2.2 - PED - 1) * k) / n);
    for (let k = 0, n = Math.max(1, Math.round((TOP - 11.7 - yDeck - 2) / 9.5)); k <= n; k++) above.push(yDeck + 2 + ((TOP - 11.7 - yDeck - 2) * k) / n);   // (to the side arches' springing)
    const panels = [];
    for (const L of [below, above]) for (let i = 0; i + 1 < L.length; i++) panels.push([L[i], L[i + 1]]);
    for (const [y0, y1] of panels) {
      for (const f of [-1, 1]) {
        const s = sT + f * (halfD((y0 + y1) / 2) - 0.25);
        memberSO(bag, F, steelD, s, oa, y0, s, ob, y1, 0.35, 0.5);
        memberSO(bag, F, steelD, s, ob, y0, s, oa, y1, 0.35, 0.5);
        memberSO(bag, F, steelD, s, oa, y1, s, ob, y1, 0.45, 0.6);
      }
    }
  }
  // the top: a deep girder across all four columns, the arched portal under it between the inner columns, the cap
  const yGir = TOP - 4.2;
  for (const f of [-1, 1]) {
    const s = sT + f * 1.3;
    block(bag, F, steel, s - 0.4, s + 0.4, -O_OUT, O_OUT, yGir, TOP - 0.6);
    // the arch: a polygon of short members springing from the inner columns 14 m under the girder
    const yS = yGir - 14, R = O_IN, pts = [];
    for (let k = 0; k <= 12; k++) { const a = Math.PI - (Math.PI * k) / 12; pts.push([R * Math.cos(a), yS + R * 0.9 * Math.sin(a) + 3]); }
    for (let k = 0; k + 1 < pts.length; k++) memberSO(bag, F, steel, s, pts[k][0], pts[k][1], s, pts[k + 1][0], pts[k + 1][1], 0.7, 0.9);
    // spandrel lattice between the arch and the girder
    for (let k = 1; k < 12; k += 1) memberSO(bag, F, steelD, s, pts[k][0], pts[k][1], s, pts[k][0], yGir, 0.25, 0.3);
    // (BKB: the side frames' own arches under the girder, between each frame's columns, as in the photographs)
    for (const sg of [-1, 1]) {
      const c = sg * (O_IN + O_OUT) / 2, r = (O_OUT - O_IN) / 2 - 0.76, yA = yGir - 7.5, q = [];
      for (let k = 0; k <= 8; k++) { const a = Math.PI - (Math.PI * k) / 8; q.push([c + r * Math.cos(a), yA + r * Math.sin(a)]); }
      for (let k = 0; k + 1 < q.length; k++) memberSO(bag, F, steel, s, q[k][0], q[k][1], s, q[k + 1][0], q[k + 1][1], 0.5, 0.7);
      for (let k = 1; k < 8; k++) memberSO(bag, F, steelD, s, q[k][0], q[k][1], s, q[k][0], yGir, 0.2, 0.25);
    }
    // the portal under the deck between the inner columns
    for (let k = 0; k + 1 < pts.length; k++) memberSO(bag, F, steel, s, pts[k][0], pts[k][1] - yS + PED + 2 - 3, s, pts[k + 1][0], pts[k + 1][1] - yS + PED + 2 - 3, 0.6, 0.8);
  }
  block(bag, F, steelD, sT - 2.4, sT + 2.4, -O_OUT - 1.3, O_OUT + 1.3, TOP - 0.6, TOP + 0.5);
  // saddles and finials
  for (const o of colO) {
    block(bag, F, steelD, sT - 2.0, sT + 2.0, o - 1.0, o + 1.0, TOP + 0.5, SADDLE + 0.9);
    const p = F.P(sT, o, TOP + 1.6);
    bag.rod(steelD, [p[0], TOP + 0.5, p[2]], [p[0], TOP + 2.3, p[2]], 0.55, 8, 0.4, true);
    sphere(bag, steel, [p[0], TOP + 3.6, p[2]], 1.35);
  }
}
function sphere(bag, mat, c, r) {
  const N = 12, Mr = 8;
  for (let j = 0; j < Mr; j++) {
    const t0 = (j / Mr) * Math.PI, t1 = ((j + 1) / Mr) * Math.PI;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
      const P = (t, a) => [c[0] + r * Math.sin(t) * Math.cos(a), c[1] + r * Math.cos(t), c[2] + r * Math.sin(t) * Math.sin(a)];
      const q = [P(t0, a0), P(t0, a1), P(t1, a1), P(t1, a0)];
      const m = P((t0 + t1) / 2, (a0 + a1) / 2), n = [(m[0] - c[0]) / r, (m[1] - c[1]) / r, (m[2] - c[2]) / r];
      bag.quad(mat, q[0], q[1], q[2], q[3], n);
    }
  }
}

// an anchorage: a granite block 72 m along the bridge, 55 m across, from the river face (sAn) away from the water, under
// the lower level; pilasters, a cornice and blind arches on its long sides
function anchorage(bag, F, sAn, away, stone, stoneD) {
  const L = 72.2, B = 27.7, sc = sAn + (away * L) / 2, yTop = F.yAt(sc) - LOW - 1.4;
  const g = Math.max(0, F.groundAt(sc) ?? 3.2);
  taper(bag, F, stone, sc, 0, g - 1, yTop - 2.2, L / 2, B, L / 2 - 1.2, B - 1.2);
  block(bag, F, stoneD, sc - L / 2 + 0.6, sc + L / 2 - 0.6, -B + 0.6, B - 0.6, yTop - 2.2, yTop);
  for (const sg of [-1, 1]) for (let k = -3; k <= 3; k++) {
    const s = sc + k * (L / 7);
    block(bag, F, stone, s - 1.6, s + 1.6, sg * (B + 0.3) - 0.5, sg * (B + 0.3) + 0.5, g - 1, yTop - 2.2);
  }
}

// a steel approach from a to b: bents of four columns under the truss lines every ~30 m (none in the streets under the
// deck), a plate-girder deck on them, the roadways and parapets; low ends on a filled ramp between retaining walls
function approach(bag, F, a, b, rec, steel, steelD, asph, conc, lw) {
  if (b - a < 4) return;
  const y = (s) => F.yAt(s), g = (s) => { const v = F.groundAt(s); return v === null ? 0 : v; };
  const under = (rec.under || []).filter((u) => u[2] < 0.5 && u[1] > a && u[0] < b);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (const sg of [-1, 1]) {
    const o0 = sg > 0 ? 0.6 : -EDGE + 2.5, o1 = sg > 0 ? EDGE - 2.5 : -0.6;
    slab(bag, F, asph, a, b, o0, o1, y, 0.35, 5);
    railing(bag, F, steelD, a, b, sg * (EDGE - 2.4), y, 1.05, 2.4, 0.08);
    laneLines(bag, F, lw, lw, a, b, y, [{ o: sg * (EDGE - 2.8), w: 0.12 }]);
    // plate girders under the slab
    for (const o of [sg * 3.5, sg * 9.5, sg * 15.0]) for (const [p, q] of pairs(F.range(a, b, 8))) bag.beam(steel, F.P(p, o, y(p) - 1.25), F.P(q, o, y(q) - 1.25), 0.5, 1.8);
  }
  slab(bag, F, conc, a, b, -0.6, 0.6, (s) => y(s) + 0.6, 0.9, 6);
  const step = 30;
  for (let s = a + step / 2; s < b; s += step) {
    let ss = s;
    for (let k = 0; k < 6 && !free(ss); k++) ss += k % 2 ? -k * 4 : k * 4;
    if (!free(ss) || ss < a + 2 || ss > b - 2) continue;
    const h = y(ss) - g(ss);
    if (h < 3.5) continue;
    // (the columns stop 5 cm inside the cross beam: at y - 2.1 their tops were the beam's top face, GB43)
    for (const o of [-15.0, -6.0, 6.0, 15.0]) taper(bag, F, steel, ss, o, g(ss), y(ss) - 2.15, 0.7, 0.55, 0.55, 0.45);
    memberSO(bag, F, steelD, ss, -16, y(ss) - 2.6, ss, 16, y(ss) - 2.6, 0.8, 1.0);
    if (h > 9) { memberSO(bag, F, steelD, ss, -15, g(ss) + 1.5, ss, 15, y(ss) - 3.2, 0.25, 0.3); memberSO(bag, F, steelD, ss, 15, g(ss) + 1.5, ss, -15, y(ss) - 3.2, 0.25, 0.3); }
  }
}
