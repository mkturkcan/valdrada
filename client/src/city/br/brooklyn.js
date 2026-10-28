// The Brooklyn Bridge (John A. and Washington Roebling, 1883), from its published dimensions and the record's layout
// (tools/pipeline/bridges.mjs: tower stations from the NOAA ENC pier, the roadway's profile).
// Facts used (Wikipedia, "Brooklyn Bridge", and the HAER record NY-18): main span 1,595.5 ft (486.3 m), side spans 930 ft
// (283.5 m); deck 85 ft (25.9 m) wide: two roadways of three lanes outside, the elevated promenade (10-17 ft wide, 18 ft
// over the roadways) in the middle; four main cables 15.75 in (0.40 m) thick over the towers, ~1,520 suspenders and 400
// diagonal stays (138-449 ft long) radiating from the tower tops; four stiffening trusses (the outer pair at the deck's
// edges, the inner pair under the promenade's edges). Towers of granite and limestone ashlar, 278 ft (84.8 m) over mean
// high water, 140 x 59 ft (42.7 x 18 m) at the waterline, each pierced by two pointed arches 117 ft (35.7 m) high and
// 33.75 ft (10.29 m) wide whose floor, the roadway, is 119.25 ft (36.35 m) over the water; the top 159 ft over the arch
// floor. Anchorages 129 x 119 ft (39.3 x 36.3 m) at the base, 117 x 104 ft at the top. Steel in "Brooklyn Bridge tan".
// Form details (the arch orders, pilasters, cornice, saddle housings, the promenade's lattice rail and lamps) from
import * as THREE from 'three';
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, truss, crossBeams, lateralX, railing, latticeRail, cableY, cablePts, suspenders, block, taper } from './parts.js';

const C = {
  steel: 0xb3ab98,    // Brooklyn Bridge tan: a grey buff (BR06, photographs: the khaki read orange in the golden grade)
  steelD: 0x948c7a,
  stone: 0x9d9688,    // the towers' granite and limestone, weathered: a grey beige (BKB, photographs: 0xb3a996 read cream)
  stoneD: 0x8b8578,
  wood: 0x7b6650,
  lamp: 0xffd9a0,
};
const W = 25.9, O_OUT = 12.45, O_IN = 3.05;          // deck width; the outer and inner truss and cable planes
const ROAD = [3.45, 12.05];                           // a roadway's inner and outer edge (|o|)
const PROM = 2.55, PROM_UP = 5.5;                     // the promenade's half width and its height over the roadway
const PANEL = 4.572;                                  // the trusses' panel, 15 ft (the stays' spacing on the deck)
const T_TOP = 84.8, T_W = 41.6, T_T = 16.4, BASE_W = 42.7, BASE_T = 18.0;
const ARCH_W = 10.29, ARCH_APEX = 72.0, PIER_HALF = 2.6;   // the openings |o| 2.6 .. 12.89
const CABLE_TOP = 85.3;                               // the cables' centre over the saddles, at the towers' top edge

export function buildBrooklyn(rec, bag) {
  const F = new Frame(rec), lay = rec.layout;
  // (the granite: rock-faced, the mouldings dressed; soot under the plinth, the arch floor, the string course, the cornice
  // and the anchorages' cornices)
  // (BKB: the grime: the stone darker toward the base, as the photographs show it, by a quarter at the water)
  const ST = { ledges: [1.2, 33.4, 60.2, 80.1, 81.2, 83.4], grime: [2, 48, 0.26] };
  const steel = M.paint(C.steel), steelD = M.paint(C.steelD), stone = M.ashlar(C.stone, 1.6, ST), stoneD = M.ashlar(C.stoneD, 1.6, { ...ST, style: 'dressed' });
  const asph = M.asphalt(), wood = M.planks(C.wood), lw = M.lineWhite(), ly = M.lineYellow(), lamp = M.glow(C.lamp, 2.2);
  const cab = M.cable(C.steel, { px: 0.0003 }), hang = M.cable(C.steelD, { px: 0.00008 }), neck = M.glow(0xfff1d6, 2.8);
  const [sA, sB] = lay.main, [anA, anB] = lay.anchorages.map((a) => a.s);
  const y = (s) => F.yAt(s);
  const towersS = [sA, sB];
  const inTower = (s, pad = 0) => towersS.some((t) => Math.abs(s - t) < T_T / 2 + pad);
  // stations where the deck is carried (anchorage to anchorage: the suspended spans), and the approaches beyond
  const s0 = Math.max(0, anA), s1 = Math.min(F.L, anB);

  // ---- towers
  // (the towers floodlit after dark, warm white from their bases)
  const lit = M.ashlarLit(C.stone, 1.6, { y0: 0, y1: T_TOP + 2, k: 0.62, ...ST }), litD = M.ashlarLit(C.stoneD, 1.6, { y0: 0, y1: T_TOP + 2, k: 0.62, ...ST, style: 'dressed' });
  for (const sT of towersS) tower(bag, F, sT, lit, litD, steelD);

  // ---- the deck between the anchorages: trusses, floor, roadways, promenade
  const top = { out: (s) => y(s) + 4.4, inn: (s) => y(s) + PROM_UP - 0.15 }, bot = (s) => y(s) - 1.15;
  // (the trusses run on through the arches: both pairs lie inside the openings)
  for (const [a, b] of [[s0, s1]]) {
    for (const sg of [-1, 1]) {
      truss(bag, F, steel, a, b, sg * O_OUT, top.out, bot, PANEL, 'X', { chord: [0.45, 0.6], vert: [0.32, 0.32], diag: [0.16, 0.24] });
      truss(bag, F, steel, a, b, sg * O_IN, top.inn, bot, PANEL, 'X', { chord: [0.45, 0.6], vert: [0.32, 0.32], diag: [0.16, 0.24] });
    }
  }
  // floor beams and the bottom laterals (not through the towers' central piers), the roadway slabs and their lines
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 0.6)) {
    crossBeams(bag, F, steelD, a, b, PANEL, -O_OUT - 0.2, O_OUT + 0.2, (s) => y(s) - 0.28, 0.35, 0.95);
    lateralX(bag, F, steelD, a, b, PANEL * 2, -O_OUT, O_OUT, (s) => y(s) - 1.1, 0.14);
  }
  for (const sg of [-1, 1]) {
    const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
    slab(bag, F, asph, s0, s1, o0, o1, y, 0.28, 6);
    const lanes = (ROAD[1] - ROAD[0]) / 3;
    laneLines(bag, F, lw, ly, s0, s1, y, [
      { o: sg * (ROAD[0] + 0.25), w: 0.12, yellow: true }, { o: sg * (ROAD[1] - 0.25), w: 0.12 },
      { o: sg * (ROAD[0] + lanes), w: 0.11, dash: [3.05, 9.15] }, { o: sg * (ROAD[0] + 2 * lanes), w: 0.11, dash: [3.05, 9.15] },
    ]);
    // the roadway's outer barrier and the inner kerb wall under the promenade trusses
    railing(bag, F, steelD, s0, s1, sg * (ROAD[1] + 0.1), y, 1.05, 2.29, 0.08);
  }
  // the promenade: planks on the inner trusses, its rails, lamps; round each tower's central pier through the arches
  const promY = (s) => y(s) + PROM_UP;
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 0.05)) {
    slab(bag, F, wood, a, b, -PROM, PROM, promY, 0.18, 4);
    crossBeams(bag, F, steel, a, b, PANEL, -O_IN, O_IN, (s) => promY(s) - 0.18, 0.25, 0.45);
    for (let s = a + 13.7; s < b - 6; s += 27.4) {
      const sg = Math.round(s / 27.4) % 2 ? 1 : -1;
      lampPost(bag, F, steelD, lamp, s, sg * (PROM - 0.25), promY(s));
    }
  }
  for (const [a, b] of splitAround(s0, s1, towersS, T_T / 2 + 9)) for (const sg of [-1, 1]) latticeRail(bag, F, steel, a, b, sg * PROM, promY, 1.25, 2.29, 0.9, sg);
  for (const sT of towersS) for (const sg of [-1, 1]) {
    // the walk splits round the pier: a platform each side, in the arch over the inner lane
    const a = sT - T_T / 2 - 9, b = sT + T_T / 2 + 9, o0 = sg > 0 ? PIER_HALF - 0.1 : -4.6, o1 = sg > 0 ? 4.6 : -PIER_HALF + 0.1;   // (into the pier: no slit of light down its face, BKB)
    slab(bag, F, wood, a, b, o0, o1, promY, 0.18, 3);
    latticeRail(bag, F, steel, a, b, sg * 4.6, promY, 1.25, 2.29, 0.9, sg);
  }

  // ---- cables, suspenders, stays
  const saddle = (s) => towersS.some((t) => Math.abs(s - t) < 1e-3);
  const midY = { [O_IN]: y(lay.mid) + PROM_UP + 1.35, [O_OUT]: y(lay.mid) + 4.4 + 0.75 };
  for (const oo of [O_IN, O_OUT]) {
    // the cables enter the anchorages' river faces between the trusses' chords, a metre over the roadway
    const sup = [[anA, y(anA) + 1.0], [sA, CABLE_TOP], [sB, CABLE_TOP], [anB, y(anB) + 1.0]];
    const fMain = CABLE_TOP - midY[oo];
    const fSide = fMain * (283.5 / 486.3) ** 2;
    const cy = cableY(sup, [fSide, fMain, fSide]);
    for (const sg of [-1, 1]) {
      const o = sg * oo;
      bag.tube(cab, cablePts(F, cy, o, anA, anB, 2.5), 0.2, 10);
      // suspenders every 7.5 ft from the cable to the truss's top chord (none in the towers)
      const yb = oo === O_IN ? top.inn : top.out;
      for (const [a, b] of splitAround(anA + 4, anB - 4, towersS, T_T / 2 + 2)) suspenders(bag, F, hang, cy, yb, o, a, b, 2.286, 0.035, steel, 0.11);
      // the necklace: a lamp every 12 m along the outer cables (steady, lit after dark)
      if (oo === O_OUT) for (let s = anA + 6; s < anB; s += 12) {
        if (towersS.some((t) => Math.abs(s - t) < T_T / 2 + 1)) continue;
        const p = F.P(s, o, cy(s) + 0.32);
        bag.rod(neck, [p[0], p[1] - 0.08, p[2]], [p[0], p[1] + 0.16, p[2]], 0.13, 6, 0.13, true);
      }
      // the diagonal stays: 25 a fan, from the tower top to the deck every 15 ft from 18 m out
      for (const sT of towersS) for (const dir of [-1, 1]) for (let k = 4; k < 29; k++) {
        const sd = sT + dir * k * PANEL;
        if ((dir < 0 && sd < anA + 6) || (dir > 0 && sd > anB - 6)) continue;
        const yTop = CABLE_TOP - 1.2 - (k - 4) * 0.12;
        bag.rod(hang, F.P(sT + dir * (T_T / 2 - 1.5), o, yTop), F.P(sd, o, yb(sd)), 0.045, 4);
      }
    }
  }
  void saddle;

  // ---- anchorages (the cables enter their river faces at the deck) and the masonry approaches
  for (const [sAn, away] of [[anA, -1], [anB, 1]]) anchorage(bag, F, sAn, away, stone, stoneD);
  approach(bag, F, Math.max(0, anA - 39.3 - 0.1), 0, -1, stone, stoneD, asph, steelD, lw);
  approach(bag, F, Math.min(F.L, anB + 39.3 + 0.1), F.L, 1, stone, stoneD, asph, steelD, lw);
  // the deck over each anchorage
  for (const [a, b] of [[Math.max(0, anA - 39.3), anA], [anB, Math.min(F.L, anB + 39.3)]]) {
    for (const sg of [-1, 1]) {
      const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
      slab(bag, F, asph, a, b, o0, o1, y, 0.5, 6);
      railing(bag, F, steelD, a, b, sg * (ROAD[1] + 0.1), y, 1.05, 2.29, 0.08);
    }
    slab(bag, F, stoneD, a, b, -ROAD[0], ROAD[0], (s) => y(s) + 0.9, 1.4, 6);
  }

}

// station runs from s0 to s1 cut round each tower station (half width h)
function splitAround(s0, s1, towers, h) {
  let runs = [[s0, s1]];
  for (const t of towers) {
    const out = [];
    for (const [a, b] of runs) {
      if (t + h <= a || t - h >= b) { out.push([a, b]); continue; }
      if (t - h > a) out.push([a, t - h]);
      if (t + h < b) out.push([t + h, b]);
    }
    runs = out;
  }
  return runs;
}

// the footing course at the water (the caisson's top lies under the river bed, nothing of it shows), the battered pier to
// the belt course under the arch floor, then three pillars (the outer two and the central pier) to the springing, each
// with its buttress on both river faces and buttresses at the corners of the ends; a string course at the springing, a
// set-back of 0.35 m and the upper shaft over the two pointed arches, every opening in two orders (the outer reveal 0.9 m
// wider) with a moulded ring; a corbel table under the cornice, the cornice, the attic and its coping, the saddle houses
function tower(bag, F, sT, stone, stoneD, steelD) {
  const fr = F.at(sT), yFloor = F.yAt(sT) - 1.2;
  const yTop = T_TOP - 3.6, ySpring = ARCH_APEX - 11.8, yBelt = yFloor - 1.8;
  const hw = T_W / 2, ht = T_T / 2, SET = 0.35;
  const OPEN = [[-PIER_HALF - ARCH_W, -PIER_HALF], [PIER_HALF, PIER_HALF + ARCH_W]];
  const PIL = [[-hw, -PIER_HALF - ARCH_W], [-PIER_HALF, PIER_HALF], [PIER_HALF + ARCH_W, hw]];
  // footing and the battered pier
  taper(bag, F, stoneD, sT, 0, -4, 1.2, BASE_T / 2 + 1.0, BASE_W / 2 + 1.0, BASE_T / 2 + 0.9, BASE_W / 2 + 0.9);
  taper(bag, F, stone, sT, 0, 1.2, yBelt, BASE_T / 2, BASE_W / 2, ht + 0.45, hw + 0.45);
  // the belt course under the arch floor
  block(bag, F, stoneD, sT - ht - 0.95, sT + ht + 0.95, -hw - 0.95, hw + 0.95, yBelt, yBelt + 0.7);
  block(bag, F, stone, sT - ht - 0.5, sT + ht + 0.5, -hw - 0.5, hw + 0.5, yBelt + 0.7, yFloor);
  // the lower shaft: three pillars, each a core and its two face slabs (the reveal: 0.9 m back from the opening)
  const face = 1.1, REV = 0.9;
  for (const [o0, o1] of PIL) {
    block(bag, F, stone, sT - ht + face, sT + ht - face, o0, o1, yFloor, ySpring + 0.2);
    const f0 = o0 > -hw + 0.01 ? o0 + REV : o0, f1 = o1 < hw - 0.01 ? o1 - REV : o1;
    for (const sg of [-1, 1]) block(bag, F, stone, sT + (sg > 0 ? ht - face : -ht), sT + (sg > 0 ? ht : -ht + face), f0, f1, yFloor, ySpring + 0.2);
  }
  // the upper shaft: an extrusion through the tower's thickness of its elevation from the springing (the openings as notches)
  const mtx = (o0) => {
    const m = new THREE.Matrix4(), p = F.P(sT, 0, 0);
    m.makeBasis(new THREE.Vector3(...fr.n), new THREE.Vector3(0, 1, 0), new THREE.Vector3(...fr.t));
    m.setPosition(p[0] + fr.t[0] * o0, 0, p[2] + fr.t[2] * o0);
    return m;
  };
  const uw = hw - SET, ut = ht - SET;
  const elev = (grow) => {
    const s = new THREE.Shape();
    s.moveTo(-uw, ySpring);
    for (const [a, b] of OPEN) {
      const aa = a - grow, bb = b + grow;
      s.lineTo(aa, ySpring);
      for (const p of lancet(aa, bb, ySpring, ARCH_APEX + grow)) s.lineTo(p[0], p[1]);
      s.lineTo(bb, ySpring);
    }
    s.lineTo(uw, ySpring); s.lineTo(uw, yTop); s.lineTo(-uw, yTop); s.lineTo(-uw, ySpring);
    return s;
  };
  const core = 2 * ut - 2 * face;
  const ext = (shape, depth) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 6 });
  bag.addGeometry(stone, ext(elev(0), core), mtx(-core / 2));
  const gFace = ext(elev(REV), face);
  bag.addGeometry(stone, gFace, mtx(-ut));
  bag.addGeometry(stone, gFace, mtx(ut - face));
  // the arch orders: a moulded ring round each opening on both faces, stopped on the string course
  for (const sgF of [-1, 1]) for (const [a, b] of OPEN) {
    const g = ext(ring(a - REV - 0.8, b + REV + 0.8, a - REV, b + REV, ySpring, ARCH_APEX + REV + 0.8, ARCH_APEX + REV), 0.35);
    bag.addGeometry(stoneD, g, mtx(sgF > 0 ? ut : -ut - 0.35));
  }
  // the buttresses: on both river faces of every pillar (the central pier's broad one, the outer pillars' at their outer
  // edges), stepping back at the springing; on the ends, one at each corner
  for (const sg of [-1, 1]) {
    const sf = sT + sg * ht, su = sT + sg * ut;
    const bt = (o0, o1, d0, d1) => {
      block(bag, F, stone, Math.min(sf, sf + sg * d0), Math.max(sf, sf + sg * d0), o0, o1, yFloor, ySpring - 0.6);
      block(bag, F, stone, Math.min(su, su + sg * d1), Math.max(su, su + sg * d1), o0 + 0.15, o1 - 0.15, ySpring - 0.6, yTop - 1.0);
    };
    bt(-1.7, 1.7, 0.9, 0.75);
    bt(-hw, -hw + 2.4, 0.9, 0.75 + SET);
    bt(hw - 2.4, hw, 0.9, 0.75 + SET);
  }
  for (const sgO of [-1, 1]) {
    const of = sgO * hw, ou = sgO * uw;
    for (const sgS of [-1, 1]) {
      const s0 = sT + sgS * ht, s1 = s0 - sgS * 2.6;
      block(bag, F, stone, Math.min(s0, s1), Math.max(s0, s1), Math.min(of, of + sgO * 0.7), Math.max(of, of + sgO * 0.7), yFloor, ySpring - 0.6);
      const u0 = sT + sgS * ut, u1 = u0 - sgS * 2.45;
      block(bag, F, stone, Math.min(u0, u1), Math.max(u0, u1), Math.min(ou, ou + sgO * (0.6 + SET)), Math.max(ou, ou + sgO * (0.6 + SET)), ySpring - 0.6, yTop - 1.0);
    }
  }
  // the string course at the springing, round the pillars and the buttresses
  for (const sg of [-1, 1]) for (const [o0, o1] of PIL) {
    const f0 = o0 > -hw + 0.01 ? o0 + REV : o0 - 1.1, f1 = o1 < hw - 0.01 ? o1 - REV : o1 + 1.1;
    block(bag, F, stoneD, Math.min(sT + sg * (ht - 0.5), sT + sg * (ht + 1.25)), Math.max(sT + sg * (ht - 0.5), sT + sg * (ht + 1.25)), f0, f1, ySpring - 0.6, ySpring + 0.25);
  }
  for (const sgO of [-1, 1]) block(bag, F, stoneD, sT - ht - 1.25, sT + ht + 1.25, Math.min(sgO * (hw - 0.5), sgO * (hw + 1.1)), Math.max(sgO * (hw - 0.5), sgO * (hw + 1.1)), ySpring - 0.6, ySpring + 0.25);
  // the corbel table under the cornice: a bracket every 1.5 m on the four faces
  const cW = uw + 0.9, cT = ut + 0.9;
  for (let o = -cW + 0.75; o < cW - 0.5; o += 1.5) for (const sg of [-1, 1]) {
    const s0 = sT + sg * cT, s1 = s0 - sg * 0.9;
    block(bag, F, stoneD, Math.min(s0, s1), Math.max(s0, s1), o - 0.3, o + 0.3, yTop - 1.1, yTop);
  }
  for (let s = -cT + 0.75; s < cT - 0.5; s += 1.5) for (const sg of [-1, 1]) {
    const o0 = sg * cW, o1 = o0 - sg * 0.9;
    block(bag, F, stoneD, sT + s - 0.3, sT + s + 0.3, Math.min(o0, o1), Math.max(o0, o1), yTop - 1.1, yTop);
  }
  // the cornice, the attic, its coping
  block(bag, F, stoneD, sT - cT - 0.35, sT + cT + 0.35, -cW - 0.35, cW + 0.35, yTop, yTop + 1.3);
  block(bag, F, stone, sT - ut - 0.2, sT + ut + 0.2, -uw - 0.2, uw + 0.2, yTop + 1.3, T_TOP - 0.5);
  block(bag, F, stoneD, sT - ut - 0.45, sT + ut + 0.45, -uw - 0.45, uw + 0.45, T_TOP - 0.5, T_TOP);
  // the saddle houses the cables cross
  for (const o of [-O_OUT, -O_IN, O_IN, O_OUT]) block(bag, F, steelD, sT - 4.5, sT + 4.5, o - 1.3, o + 1.3, T_TOP - 0.2, CABLE_TOP + 0.6);
}

// a moulded arch ring between an outer arch (a0..b0, apex ya0) and an inner one (a1..b1, apex ya1), both springing at ys
function ring(a0, b0, a1, b1, ys, ya0, ya1) {
  const sh = new THREE.Shape();
  const outer = lancet(a0, b0, ys, ya0), inner = lancet(a1, b1, ys, ya1);
  sh.moveTo(a0, ys - 0.01);
  for (const p of outer) sh.lineTo(p[0], p[1]);
  sh.lineTo(b1, ys - 0.01);
  for (const p of inner.slice().reverse()) sh.lineTo(p[0], p[1]);
  sh.lineTo(a0, ys - 0.01);
  return sh;
}

// a pointed (lancet) arch from jamb a to jamb b springing at ys with its apex at ya: the points from the left springing
// over the apex to the right springing
function lancet(a, b, ys, ya, n = 10) {
  const w = b - a, h = ya - ys, R = (w * w / 4 + h * h) / w, c = (a + b) / 2;
  const out = [];
  const thA = Math.acos((c - (a + R)) / R);   // the apex's angle on the left arc (centred at a + R)
  for (let i = 0; i <= n; i++) { const th = Math.PI + (thA - Math.PI) * (i / n); out.push([a + R + R * Math.cos(th), ys + R * Math.sin(th)]); }
  for (let i = n - 1; i >= 0; i--) { const th = Math.PI + (thA - Math.PI) * (i / n); out.push([b - R - R * Math.cos(th), ys + R * Math.sin(th)]); }
  return out;
}

// an anchorage (89 ft high, 129 x 119 ft at the base, 117 x 104 ft at the top): a battered block of rock-faced ashlar
// from its river face (sAn) away from the river on a dressed plinth; buttresses at the corners and between the bays; on each
// long side two tall blind arches (moulded rings on dressed jambs over the recessed panels); a corbel table, the cornice
// and a parapet with its coping (the deck runs over it)
function anchorage(bag, F, sAn, away, stone, stoneD) {
  const L0 = 39.3, L1 = 35.7, B0 = 36.3 / 2, B1 = 31.7 / 2;
  const sc = sAn + away * L0 / 2, yTop = F.yAt(sc) - 1.4, yC = yTop - 3.2, fr = F.at(sc);
  taper(bag, F, stoneD, sc, 0, -2, 3.0, L0 / 2 + 0.6, B0 + 0.6, L0 / 2 + 0.6, B0 + 0.6);
  taper(bag, F, stone, sc, 0, 3.0, yC, L0 / 2, B0, L1 / 2, B1);
  const at = (y) => (y - 3.0) / (yC - 3.0);   // the batter's share at y
  const hb = (y) => B0 + (B1 - B0) * at(y), hl = (y) => L0 / 2 + (L1 / 2 - L0 / 2) * at(y);
  // buttresses on the long sides: the corners and between the two bays
  for (const sg of [-1, 1]) for (const k of [-1, 0, 1]) {
    const s = sc + k * (L1 / 2 - 1.6);
    // (its outer face 0.6 m proud of the battered wall at the plinth and 0.5 m under the cornice, its inner face in the wall)
    taper(bag, F, stone, s, sg * (B1 - 1.0), 3.0, yC, 1.6, B0 + 0.6 - (B1 - 1.0), 1.4, 1.5);
  }
  // the blind arches: round heads (the panels 12 m wide, the springing at 0.62 of the wall)
  const ys = 3.0 + (yC - 3.0) * 0.55;
  for (const sg of [-1, 1]) for (const k of [-0.5, 0.5]) {
    const s = sc + k * (L1 / 2 - 1.6), w = 11.6, sl = (B1 - B0) / (yC - 3.0), o = sg * (B0 - 3.0 * sl);
    const m = new THREE.Matrix4(), p = F.P(s, 0, 0);
    // (x along the bridge, y up the battered wall, z outward across it: the ring and its jambs stand 0.45 m proud)
    m.makeBasis(new THREE.Vector3(...fr.t), new THREE.Vector3(fr.n[0] * sg * sl, 1, fr.n[2] * sg * sl), new THREE.Vector3(...fr.n).multiplyScalar(sg));
    m.setPosition(p[0] + fr.n[0] * o, 0, p[2] + fr.n[2] * o);
    const ex = (sh) => new THREE.ExtrudeGeometry(sh, { depth: 0.45, bevelEnabled: false, curveSegments: 8 });
    bag.addGeometry(stoneD, ex(ring(-w / 2 - 0.9, w / 2 + 0.9, -w / 2, w / 2, ys, ys + w / 2 + 0.9, ys + w / 2)), m);
    for (const d of [-1, 1]) {
      const x0 = d < 0 ? -w / 2 - 0.9 : w / 2, j = new THREE.Shape();
      j.moveTo(x0, 3.0); j.lineTo(x0 + 0.9, 3.0); j.lineTo(x0 + 0.9, ys); j.lineTo(x0, ys); j.lineTo(x0, 3.0);
      bag.addGeometry(stoneD, ex(j), m);
    }
  }
  // the corbel table, the cornice, the parapet and its coping
  const cB = B1 + 0.5, cL = L1 / 2 + 0.5;
  for (let s = -cL + 0.75; s < cL - 0.5; s += 1.5) for (const sg of [-1, 1]) block(bag, F, stoneD, sc + s - 0.3, sc + s + 0.3, Math.min(sg * B1, sg * cB), Math.max(sg * B1, sg * cB), yC - 1.0, yC);
  for (let o = -cB + 0.75; o < cB - 0.5; o += 1.5) for (const sg of [-1, 1]) block(bag, F, stoneD, Math.min(sc + sg * hl(yC), sc + sg * cL), Math.max(sc + sg * hl(yC), sc + sg * cL), o - 0.3, o + 0.3, yC - 1.0, yC);
  block(bag, F, stoneD, sc - cL - 0.6, sc + cL + 0.6, -cB - 0.6, cB + 0.6, yC, yC + 1.2);
  block(bag, F, stone, sc - L1 / 2, sc + L1 / 2, -B1, B1, yC + 1.2, yTop - 0.4);
  block(bag, F, stoneD, sc - L1 / 2 - 0.3, sc + L1 / 2 + 0.3, -B1 - 0.3, B1 + 0.3, yTop - 0.4, yTop);
}

// a masonry approach from station a to b (dir = the side away from the river): arched bays on piers where the deck
// stands high, retaining walls and fill where it runs low, the roadways and barriers on top
function approach(bag, F, a, b, dir, stone, stoneD, asph, steelD, lw) {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (hi - lo < 4) return;
  const y = (s) => F.yAt(s);
  const ground = (s) => { const g = F.groundAt(s); return g === null ? 0 : g; };
  const halfW = W / 2 + 0.4;
  // roadway and parapets
  for (const sg of [-1, 1]) {
    const [o0, o1] = sg > 0 ? [ROAD[0], ROAD[1]] : [-ROAD[1], -ROAD[0]];
    slab(bag, F, asph, lo, hi, o0, o1, y, 0.4, 5);
    laneLines(bag, F, lw, lw, lo, hi, y, [{ o: sg * (ROAD[1] - 0.25), w: 0.12 }]);
  }
  const bays = [];
  const BAY = 24, PIER = 4.2;
  for (let s = lo; s < hi; s += BAY) bays.push([s, Math.min(hi, s + BAY)]);
  for (const [s0, s1] of bays) {
    const sm = (s0 + s1) / 2, h = y(sm) - ground(sm);
    // the spandrel wall and parapet over the bay, each side
    for (const sg of [-1, 1]) {
      const o0 = sg > 0 ? halfW - 1.4 : -halfW, o1 = sg > 0 ? halfW : -halfW + 1.4;
      if (h > 7) {
        // the wall above the arch crown, and the arch's two haunches as stepped blocks
        const crown = ground(sm) + Math.max(4.5, h * 0.62);
        block(bag, F, stone, s0, s1, o0, o1, crown, y(sm) - 0.4);
        for (let k = 0; k < 4; k++) {
          const f = (k + 1) / 5, yy = crown - (crown - ground(sm) - h * 0.45) * (1 - Math.sqrt(1 - f * f)) - 0.6;
          const d = (s1 - s0 - PIER) / 2 * (1 - f);
          block(bag, F, stone, s0 + PIER / 2, s0 + PIER / 2 + d, o0, o1, yy, crown);
          block(bag, F, stone, s1 - PIER / 2 - d, s1 - PIER / 2, o0, o1, yy, crown);
        }
      } else {
        block(bag, F, stone, s0, s1, o0, o1, ground(sm), y(sm) - 0.4);
      }
      block(bag, F, stoneD, s0, s1, o0 - (sg > 0 ? 0 : 0.15), o1 + (sg > 0 ? 0.15 : 0), y(sm) - 0.4, y(sm) + 1.1);
    }
    if (h <= 7) block(bag, F, stoneD, s0, s1, -halfW + 1.4, halfW - 1.4, ground(sm), y(sm) - 0.45, new Set(['+y']));
    else crossBeamsUnder(bag, F, steelD, s0, s1, halfW, y);
  }
  // the piers between the bays (where the deck stands high)
  for (let s = lo; s <= hi + 1e-6; s += BAY) {
    const h = y(s) - ground(s);
    if (h <= 7) continue;
    block(bag, F, stone, s - PIER / 2, s + PIER / 2, -halfW, halfW, ground(s), y(s) - 0.45);
  }
  void dir;
}
function crossBeamsUnder(bag, F, mat, s0, s1, halfW, y) {
  crossBeams(bag, F, mat, s0 + 2.1, s1 - 2.1, 3.0, -halfW + 1.4, halfW - 1.4, (s) => y(s) - 0.4, 0.3, 0.8);
}

// a promenade lamp: a cast post with a lantern
function lampPost(bag, F, post, lamp, s, o, y0) {
  if (bag.lod) return;
  bag.rod(post, F.P(s, o, y0), F.P(s, o, y0 + 3.6), 0.09, 8, 0.06, true);
  bag.rod(post, F.P(s, o, y0 + 3.6), F.P(s, o, y0 + 3.75), 0.16, 8, 0.16, true);
  bag.rod(lamp, F.P(s, o, y0 + 3.75), F.P(s, o, y0 + 4.35), 0.2, 8, 0.24, true);
  bag.rod(post, F.P(s, o, y0 + 4.35), F.P(s, o, y0 + 4.55), 0.26, 8, 0.05, true);
}
