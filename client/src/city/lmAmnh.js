// lmAmnh.js (LM16, landmarks round 2026-10-16; owner: the park's landmarks "too basic", "as detailed as possible", no
// tiled painted facades): the American Museum of Natural History on its two compiled footprints (tile -1_0 #82, the main
// block from 77th Street to the Rose Center, and #211, the north side on 81st Street), modelled from the overhead and
// oblique reference views on the compiled rings (plan read off in the grid frame below) with the kit's material sets:
//   - the 77th Street front (J. C. Cady, 1890s; Romanesque Revival): rock-faced pink granite in courses, the central
//     pavilion with its round towers, arcade and terrace stair, the corner pavilions with octagonal copper lanterns, the
//     round corner towers with stone cones, slate-roofed wings with dormers, red tile hip roofs;
//   - the Central Park West front: the Theodore Roosevelt Memorial (John Russell Pope, 1936; a triumphal arch with four
//     Ionic columns carrying statues, the attic, the hall behind with its copper roof) between granite wings with red tile
//     hip roofs, the brick tower at the 81st Street end;
//   - the Rose Center (1999): the glass cube (37 m) with its mullion grid and roof band, the Hayden Sphere (26.5 m) on its
//     legs inside; the interior ranges (brick blocks, the copper-roofed central range, the slate pyramid hall, the octagon);
//   - the north side (lmAmnhNorth): the Gilder Center's curving granite bands on Columbus Avenue, the brick north building
//     with its skylights, the terrace on 81st Street.
// Grid frame: origin world (-260, 250), gx along the streets (east), gn along the avenues (north); the 77th Street front
// line is gn -39.5, Central Park West gx 85 (the Memorial's front gx 98.6), Columbus Avenue gx -106.6.
import { LB, GE, GN, opening, courses, mould, PROF, corbels, hipRoof, dormer, lathe, coursedCone, towerFaces, column, ribW, archPts } from './lmStoneKit.js';
import { quadW, quadU, quadY, poly, box as kbox, wallWithHoles, Frame } from './fk/kitGeom.js';
import { surfMat, partMat, cwGlassMat, winGlassMat } from './tk/tkMats.js';
import { LM_GLASS } from './tk/tkParams.js';

const O = [-260, 250];
const TAU = Math.PI * 2;

// the museum's own sets (mat/pbrLib.js amnh_*): neutral maps at 0.75 of white, so a writer's tint is the target albedo / 0.75
const srl = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)), lsr = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const am = (set, hex) => surfMat(set, '#' + [1, 3, 5].map((i) => Math.round(255 * lsr(Math.min(1, srl(parseInt(hex.slice(i, i + 2), 16) / 255) / 0.75)))).map((v) => v.toString(16).padStart(2, '0')).join(''));
function M() {
  return {
    pink: am('amnh_granite', '#a98b7e'),        // the 77th Street granite (rock-faced, warm)
    pinkD: am('amnh_granite', '#8f7569'),       // its darker courses and plinth
    pinkT: am('amnh_granite', '#bba395'),       // dressed trim: hoods, sills, strings
    buff: am('amnh_granite', '#b49e90'),        // the Central Park West wings (lighter)
    buffT: surfMat('stone_lime', '#d2c4b4'),
    mem: surfMat('stone_lime_ashlar', '#d8d0c2'),    // the Memorial's granite
    memT: surfMat('stone_lime', '#e0d9cc'),
    // (tile, slate, copper, granite: the museum's own sets, their HQ maps in Unreal by the set's name (ue_families.json hq.pbr))
    tile: am('amnh_tile', '#5e4238'),      // red clay tile roofs
    tileC: am('amnh_tile', '#4c362e'),    // their ridge and hip tiles
    slate: am('amnh_slate', '#4e5257'),
    copper: am('amnh_copper', '#4b6c5f'),         // verdigris (the tower kit's copper)
    copperD: am('amnh_copper', '#34503f'),        // its darker trim, and the standing seams
    memb: surfMat('roof_membrane', '#aeaba3'),       // the ranges' membrane roofs (light grey, two weathers)
    membD: surfMat('roof_membrane', '#94918a'),
    plant: surfMat('panel_alu', '#a3a6a8'),          // roof plant: galvanised casings
    plantD: surfMat('panel_alu', '#6c7073'),
    brick: surfMat('brick_red', '#8c4c3c'),
    brickD: surfMat('brick_brown', '#6e4436'),
    stoneG: surfMat('granite_grey', '#9a968e'),
    roof: surfMat('roof_membrane', '#8c8a84'),
    conc: surfMat('concrete_smooth', '#dedcd6'),
    pave: surfMat('granite_grey', '#a6a199'),
    gild: am('amnh_granite', '#d2c3b8'),       // the Gilder Center's Milford pink granite (pale)
    frame: partMat('alu_bronze'),
    mull: partMat('alu_clear'),
    steel: partMat('steel_black'),
    win: winGlassMat(),
    glass: cwGlassMat(LM_GLASS.CLEARG),
    sphere: surfMat('panel_alu', '#e4e6e8'),
  };
}

// ------------------------------------------------------------------------------------------- a facade
// One face from u = 0 to L: walls in courses (base rusticated with joints), bays of openings per floor, strings, the
// cornice (with corbels), mitred m0 / m1 at the ends. P: see the specs below.
let WS = 0;
function facade(B, F, L, P) {
  const ws = ++WS;
  const nb = Math.max(1, Math.round((L - 2 * (P.margin ?? 1.5)) / P.bay)), pitch = (L - 2 * (P.margin ?? 1.5)) / nb, m = P.margin ?? 1.5;
  const holes = [], ops = [];
  for (let f = 0; f < (P.floors || []).length; f++) {
    const fl = P.floors[f];
    for (let k = 0; k < nb; k++) {
      if (fl.skip && fl.skip(k, nb)) continue;
      const uc = m + (k + 0.5) * pitch;
      const big = fl.center && P.centerBay && Math.abs(k - (nb - 1) / 2) < 0.6 ? fl.center : null;
      const w = big ? big.w : fl.w, n = big ? 1 : (fl.n || 1), gap = fl.gap ?? 0.5;
      const tot = n * w + (n - 1) * gap;
      for (let j = 0; j < n; j++) {
        const u0 = uc - tot / 2 + j * (w + gap), u1 = u0 + w;
        const o = { u0, u1, y0: big ? big.sill : fl.sill, ys: big ? big.head : fl.head, arch: big ? big.arch : fl.arch, h: big ? big.h : fl.h, d: fl.d ?? 0.4,
          wall: P.wall, trim: P.trim, glass: fl.door ? null : P.glass, frame: P.frame, mull: fl.mull ?? (w > 1.6 ? 1 : 0), transom: fl.transom,
          hood: fl.hood ?? P.hood ?? true, key: fl.key, lintel: fl.lintel ?? P.lintel, info: { cu: k * n + j, cv: f, ws, fh: fl.fh ?? 4.5, sill: 0.9 }, door: fl.door };
        ops.push(o);
        const rise = o.arch === 'round' ? w / 2 : o.arch === 'seg' ? o.h : 0;
        holes.push({ u0, u1, y0: o.y0, y1: o.ys + rise });
      }
    }
  }
  const yW = P.yTop - (P.cornice ? P.cornice.H : 0);
  // the walls: the base and the upper wall in courses (or plain), cut round the holes
  let y = P.y0 ?? 0;
  if (P.base) {
    courses(B, F, P.base.mat || P.wall, 0, L, y, P.base.y, P.base.ch, holes, P.base.p ?? 0.07, 0.04, P.base.joint ?? 0, ws);
    y = P.base.y;
  }
  if (P.ch) courses(B, F, P.wall, 0, L, y, yW, P.ch, holes, P.p ?? 0.04, P.c ?? 0.025, P.joint ?? 0, ws * 3);
  else wallWithHoles(B.S(P.wall), F, 0, L, y, yW, holes, 0);
  for (const o of ops) opening(B, F, o);
  // piers (pilaster strips) between bays
  if (P.piers) for (let k = 0; k <= nb; k++) {
    const u = m + k * pitch;
    kbox(B.S(P.trim), F, u - P.piers.w / 2, u + P.piers.w / 2, P.piers.y0, P.piers.y1, 0, P.piers.p, 0.03, 16);
  }
  const m0 = P.m0 ?? 1, m1 = P.m1 ?? 1;
  for (const s of P.strings || []) mould(B, F, P.trim, PROF.string(s, P.stringP ?? 0.18, 0.32), 0, L, m0, m1);
  if (P.cornice) {
    mould(B, F, P.trim, PROF.cornice(P.yTop, P.cornice.P, P.cornice.H), 0, L, m0, m1);
    if (P.corbels) corbels(B, F, P.trim, 0.6, L - 0.6, P.yTop - P.cornice.H, P.corbels.pitch ?? 0.9, 0.3, 0.6, P.cornice.P * 0.35);
  }
  if (P.parapet) {
    const yp = P.yTop, hp = P.parapet.h;
    quadW(B.S(P.parapet.mat || P.wall), F, 0, L, yp, yp + hp, P.parapet.w ?? 0);
    quadW(B.S(P.parapet.mat || P.wall), F, 0, L, yp, yp + hp, (P.parapet.w ?? 0) - 0.35, true);
    mould(B, F, P.trim, PROF.coping(yp + hp, 0.1, 0.25), 0, L, m0, m1);
  }
  if (P.plinth) mould(B, F, P.plinth.mat || P.trim, PROF.plinth(P.plinth.h, P.plinth.p ?? 0.2), 0, L, m0, m1);
}
// the four faces of a grid block, each with its own facade (null: a plain wall in mat `plain` to the top)
function block(B, gx0, gx1, gn0, gn1, sides, plain, yTop) {
  const F = B.rectFaces(gx0, gx1, gn0, gn1), L = [gx1 - gx0, gn1 - gn0, gx1 - gx0, gn1 - gn0];
  for (let i = 0; i < 4; i++) {
    const P = sides[i];
    if (P === false) continue;
    if (P) facade(B, F[i], L[i], P);
    else if (plain) quadW(B.S(plain), F[i], 0, L[i], 0, yTop, 0);
  }
}

// ------------------------------------------------------------------------------------------- the specs
function romWing(K, yTop) {
  // the 77th Street wings (four storeys under a corbelled cornice): arched ground storey on a rusticated base, tall arched
  // second storey, paired third, small arched attic windows
  return {
    wall: K.pink, trim: K.pinkT, glass: K.win, frame: K.frame, yTop, bay: 5.6, margin: 1.4, ch: 0.62, p: 0.05, joint: 0,
    base: { y: 5.6, ch: 0.7, p: 0.09, joint: 1.45, mat: K.pinkD },
    floors: [
      { sill: 1.5, head: 3.7, w: 2.1, arch: 'seg', h: 0.45, transom: 3.0 },
      { sill: 7.2, head: 10.6, w: 2.3, arch: 'round', transom: 10.6, fh: 5.5 },
      { sill: 13.6, head: 16.6, w: 1.05, n: 2, gap: 0.45, arch: null, lintel: true, fh: 4.5 },
      { sill: yTop - 4.6, head: yTop - 3.0, w: 0.85, n: 3, gap: 0.35, arch: 'round', hood: false, fh: 3.5 },
    ],
    strings: [5.6, 12.9, yTop - 5.3], cornice: { P: 0.75, H: 1.0 }, corbels: { pitch: 0.95 },
    plinth: { h: 1.1, p: 0.18, mat: K.pinkD },
  };
}
function romPavilion(K, yTop) {
  const P = romWing(K, yTop);
  P.bay = 4.6;
  P.floors = [
    { sill: 1.4, head: 3.6, w: 1.9, arch: 'seg', h: 0.4, transom: 2.9 },
    { sill: 7.0, head: 11.0, w: 2.6, arch: 'round', transom: 11.0, fh: 5.8 },
    { sill: 14.2, head: 17.6, w: 1.1, n: 2, gap: 0.4, arch: 'round', fh: 4.8 },
    { sill: 20.2, head: 22.4, w: 0.9, n: 2, gap: 0.4, arch: null, fh: 3.8 },
  ];
  P.strings = [5.6, 13.4, 19.6];
  P.piers = { w: 0.7, p: 0.16, y0: 5.6, y1: yTop - 1.0 };
  return P;
}
function cpwWing(K, yTop) {
  // the Central Park West wings (1908-1924): a rusticated ground storey, three storeys of paired windows, a top storey
  return {
    wall: K.buff, trim: K.buffT, glass: K.win, frame: K.frame, yTop, bay: 4.9, margin: 1.2, ch: 0.58, p: 0.02, c: 0.012, joint: 1.6,
    base: { y: 5.0, ch: 0.62, p: 0.07, joint: 1.3 },
    floors: [
      { sill: 1.6, head: 3.9, w: 1.7, arch: null, lintel: false },
      { sill: 6.6, head: 10.2, w: 1.0, n: 2, gap: 0.35, arch: null, fh: 5.4 },
      { sill: 12.0, head: 15.0, w: 1.0, n: 2, gap: 0.35, arch: null, fh: 4.8 },
      { sill: 16.8, head: 19.4, w: 1.0, n: 2, gap: 0.35, arch: null, fh: 4.0 },
      { sill: yTop - 3.3, head: yTop - 1.9, w: 1.0, n: 2, gap: 0.35, arch: null, lintel: false, hood: false, fh: 3.2 },
    ],
    strings: [5.0, yTop - 3.8], cornice: { P: 0.9, H: 1.1 }, plinth: { h: 0.9, p: 0.15 },
  };
}
function brickBlock(K, yTop, o = {}) {
  return {
    wall: o.wall || K.brick, trim: o.trim || K.stoneG, glass: K.win, frame: K.steel, yTop, bay: o.bay || 3.4, margin: 1.0, ch: 0, hood: false,
    floors: (o.floors || defaultFloors(yTop, o.fh || 4.4)), cornice: o.cornice === false ? null : { P: 0.35, H: 0.6 }, lintel: true,
    parapet: o.parapet ? { h: 1.0 } : null,
  };
}
function defaultFloors(yTop, fh) {
  const out = [];
  for (let y = 1.2; y + 2.6 < yTop - 1.0; y += fh) out.push({ sill: y, head: y + Math.min(2.6, fh - 1.4), w: 1.3, arch: null, fh });
  return out;
}

// ------------------------------------------------------------------------------------------- roofs
// a repeatable hash in [0, 1) of a few numbers (the roof plant's layout stays put between bakes)
function hh(...a) { let h = 2166136261; for (const v of a) { h ^= Math.round(v * 97) & 0xffffffff; h = Math.imul(h, 16777619) >>> 0; } return (h % 100000) / 100000; }
// a flat range roof as the aerial reference shows them: a light membrane laid in strips, a parapet with its coping inside the
// walls' line, the plant (casings with louvres, duct runs, vents) and, over the galleries, rows of skylight lanterns.
// o.sky: skylight lanterns along the long axis; o.noPar: no parapet (the deck is inside another build); o.plant: casings per 100 m2
function roofDeck(B, K, gx0, gx1, gn0, gn1, y, o = {}) {
  const w = gx1 - gx0, d = gn1 - gn0, area = w * d, seed = hh(gx0, gn0, y);
  // the membrane in strips (two weathers) along the long axis
  const alongX = w >= d, sw = 3.2, n = Math.max(1, Math.round((alongX ? d : w) / sw));
  const L = alongX ? w : d, np2 = Math.max(1, Math.round(L / 7));
  for (let k = 0; k < n; k++) for (let q = 0; q < np2; q++) {
    // strips in sheets of ~7 m, each its own weather (the patched, re-laid membrane the aerials show)
    const a = k / n, b = (k + 1) / n, c0 = q / np2, c1 = (q + 1) / np2, m = hh(seed, k) < 0.35 ? K.membD : K.memb;
    const r = alongX ? [[gx0 + c0 * w, gn0 + a * d], [gx0 + c1 * w, gn0 + a * d], [gx0 + c1 * w, gn0 + b * d], [gx0 + c0 * w, gn0 + b * d]]
      : [[gx0 + a * w, gn0 + c0 * d], [gx0 + b * w, gn0 + c0 * d], [gx0 + b * w, gn0 + c1 * d], [gx0 + a * w, gn0 + c1 * d]];
    const S = B.S(m), f = 0.72 + 0.44 * hh(seed, k, q), tr = S.tr || [1, 1, 1];
    S.tr = [tr[0] * f, tr[1] * f, tr[2] * f];
    B.polyW(S, r.map(([gx, gn]) => { const [x, z] = B.W(gx, gn); return [x, B.y0 + y, z]; }), [0, 1, 0]);
  }
  // the parapet: its inner face, top and the coping (the outer face is the facade's own parapet or wall)
  if (!o.noPar) {
    const hp = o.hp ?? 0.85;
    for (const F of B.rectFaces(gx0, gx1, gn0, gn1)) {
      kbox(B.S(K.stoneG), F, 0, F.L, y, y + hp, -0.4, 0.02, 0, 4);
      kbox(B.S(K.pinkT), F, -0.05, F.L + 0.05, y + hp, y + hp + 0.14, -0.5, 0.1, 0.02, 0);
    }
  }
  // skylight lanterns: glazed hips on low upstands, in a row along the long axis
  if (o.sky && Math.min(w, d) > 6) {
    const L = alongX ? w : d, Wd = alongX ? d : w, nl = Math.max(1, Math.floor((L - 3) / 7)), lw = Math.min(4.2, Wd * 0.4);
    for (let k = 0; k < nl; k++) {
      const c = (k + 0.5) * (L - 2) / nl + 1, h = 2.6;
      if (alongX) skylightRoof(B, K, gx0 + c - h, gx0 + c + h, gn0 + d / 2 - lw / 2, gn0 + d / 2 + lw / 2, y + 0.02, false);
      else skylightRoof(B, K, gx0 + w / 2 - lw / 2, gx0 + w / 2 + lw / 2, gn0 + c - h, gn0 + c + h, y + 0.02, true);
    }
  }
  // the plant: casings (louvred band, a lid), a duct run to the nearest parapet, round vents
  const np = Math.min(9, Math.floor(area / 100 * (o.plant ?? 0.35)));
  for (let k = 0; k < np; k++) {
    const pw = 1.6 + hh(seed, k, 1) * 3.2, pd = 1.4 + hh(seed, k, 2) * 2.2, ph = 1.1 + hh(seed, k, 3) * 1.3;
    let gx = gx0 + 1.6 + hh(seed, k, 4) * Math.max(0.1, w - 3.2 - pw), gn = gn0 + 1.6 + hh(seed, k, 5) * Math.max(0.1, d - 3.2 - pd);
    if (o.sky) { if (alongX) gn = hh(seed, k, 6) < 0.5 ? gn0 + 1.2 : gn1 - 1.2 - pd; else gx = hh(seed, k, 6) < 0.5 ? gx0 + 1.2 : gx1 - 1.2 - pw; }
    if (gx + pw > gx1 - 0.8 || gn + pd > gn1 - 0.8) continue;
    const F = B.F(gx, gn, gx + pw, gn);
    kbox(B.S(K.plant), F, 0, pw, y, y + ph, -pd, 0, 0.04, 4);
    kbox(B.S(K.plantD), F, 0.15, pw - 0.15, y + ph * 0.45, y + ph * 0.85, 0.0, 0.03, 0, 4 | 8);
    kbox(B.S(K.plantD), F, -0.08, pw + 0.08, y + ph, y + ph + 0.1, -pd - 0.08, 0.08, 0.02, 0);
    if (hh(seed, k, 7) < 0.6) {   // a fan on the lid
      const [cx, cz] = B.W(gx + pw / 2, gn + pd / 2), rf = Math.min(pw, pd) * 0.3;
      lathe(B, K.plantD, cx, cz, [[rf, y + ph + 0.1], [rf, y + ph + 0.45], [rf * 0.9, y + ph + 0.45]], 12);
    }
    if (hh(seed, k, 8) < 0.5) {   // a duct to the parapet
      const Fd = B.F(gx + pw / 2 - 0.4, gn, gx + pw / 2 + 0.4, gn);
      kbox(B.S(K.plant), Fd, 0, 0.8, y + 0.2, y + 0.9, 0, gn - gn0 - 0.6, 0.03, 4);
    }
  }
  for (let k = 0; k < Math.min(6, Math.floor(area / 160)); k++) {
    const [cx, cz] = B.W(gx0 + 1 + hh(seed, k, 9) * (w - 2), gn0 + 1 + hh(seed, k, 10) * (d - 2));
    lathe(B, K.plantD, cx, cz, [[0.16, y], [0.16, y + 0.7], [0.3, y + 0.75], [0.3, y + 0.9], [0, y + 0.95]], 8);
  }
}
// a stone chimney stack on a roof at grid (gx, gn) from y0 to y1: shaft, a corbelled cap, two pots
function chimney(B, K, gx, gn, y0, y1, w = 1.3, d = 0.8) {
  const F = B.F(gx - w / 2, gn - d / 2, gx + w / 2, gn - d / 2);
  kbox(B.S(K.pink), F, 0, w, y0, y1, -d, 0, 0.02, 4);
  kbox(B.S(K.pinkT), F, -0.12, w + 0.12, y1 - 0.5, y1 - 0.25, -d - 0.12, 0.12, 0.02, 0);
  kbox(B.S(K.pinkT), F, -0.06, w + 0.06, y1 - 0.25, y1, -d - 0.06, 0.06, 0.02, 0);
  for (const s of [0.3, 0.7]) { const [cx, cz] = B.W(gx - w / 2 + w * s, gn); lathe(B, K.tileC, cx, cz, [[0.16, y1], [0.13, y1 + 0.6], [0.17, y1 + 0.7], [0, y1 + 0.7]], 10); }
}

// ------------------------------------------------------------------------------------------- towers
// a round tower at grid (gx, gn): radius r, walls to yW (windows in rows), a corbelled eave, a cone (stone or tile) to yC
function roundTower(B, K, gx, gn, r, yW, yC, o = {}) {
  const [cx, cz] = B.W(gx, gn);
  const n = o.n ?? Math.max(16, Math.round(r * 4));
  const faces = towerFaces(B, cx, cz, r, 0, n);
  const L = faces[0].L;
  const rows = o.rows || [[1.4, 3.6, 'seg'], [7.0, 10.6, 'round'], [13.6, 16.4, null], [yW - 4.4, yW - 2.4, 'round']];
  faces.forEach((F, i) => {
    const holes = [], ops = [];
    const towardStreet = true;
    if (towardStreet && i % (o.every ?? 2) === 0) {
      for (let k = 0; k < rows.length; k++) {
        const [y0, ys, arch] = rows[k];
        const w = Math.min(L * 0.62, 1.15), u0 = (L - w) / 2, u1 = u0 + w;
        const rise = arch === 'round' ? w / 2 : arch === 'seg' ? 0.3 : 0;
        ops.push({ u0, u1, y0, ys, arch, h: 0.3, d: 0.38, wall: K.pink, trim: K.pinkT, glass: K.win, frame: K.frame, mull: 0, hood: false, lintel: false,
          info: { cu: i, cv: k, ws: 900 + i, fh: 4.5 } });
        holes.push({ u0, u1, y0, y1: ys + rise });
      }
    }
    courses(B, F, K.pinkD, 0, L, 0, 5.6, 0.7, holes, 0.09, 0.04, 1.4, i);
    courses(B, F, K.pink, 0, L, 5.6, yW - 1.0, 0.62, holes, 0.05, 0.025, 0, i * 7);
    for (const op of ops) opening(B, F, op);
  });
  // strings and the eave: lathed bands; corbels round the top
  for (const ys of [5.6, 12.9]) lathe(B, K.pinkT, cx, cz, [[r - 0.05, ys], [r + 0.16, ys], [r + 0.2, ys + 0.12], [r + 0.2, ys + 0.26], [r + 0.08, ys + 0.34], [r - 0.05, ys + 0.34]], n);
  lathe(B, K.pinkT, cx, cz, [[r - 0.05, yW - 1.0], [r + 0.12, yW - 1.0], [r + 0.12, yW - 0.85], [r + 0.55, yW - 0.5], [r + 0.75, yW - 0.2], [r + 0.75, yW], [r - 0.2, yW]], n);
  const nc = Math.round(n * 1.5);
  for (let k = 0; k < nc; k++) {
    const a = (k + 0.5) / nc * TAU, x = cx + Math.cos(a) * (r + 0.05), z = cz + Math.sin(a) * (r + 0.05);
    const F = new Frame([x - Math.sin(a) * 0.15, z + Math.cos(a) * 0.15], [x + Math.sin(a) * 0.15, z - Math.cos(a) * 0.15], B.y0, B.org);
    const Fo = (F.nx * Math.cos(a) + F.nz * Math.sin(a)) > 0 ? F : new Frame([x + Math.sin(a) * 0.15, z - Math.cos(a) * 0.15], [x - Math.sin(a) * 0.15, z + Math.cos(a) * 0.15], B.y0, B.org);
    kbox(B.S(K.pinkT), Fo, 0, 0.3, yW - 1.75, yW - 1.0, 0, 0.32, 0.02, 16);
  }
  // the roof: a coursed cone (with a slight bell at the eave), a finial
  const rr = r + 0.65;
  const roofM = o.roof === 'tile' ? K.tile : o.roof === 'slate' ? K.slate : K.pinkT;
  lathe(B, roofM, cx, cz, [[rr + 0.15, yW], [rr + 0.15, yW + 0.15], [rr - 0.2, yW + 0.6]], n * 2);
  coursedCone(B, roofM, cx, cz, rr - 0.2, yW + 0.6, yC, n * 2, o.roof === 'tile' ? 0.34 : 0.55, 0.045, 0.22);
  const fk = Math.max(1, r / 4.75);   // (the finial grows with the tower: a collar, a ball, a spike)
  lathe(B, K.copperD, cx, cz, [[0.32, yC - 0.1], [0.36, yC + 0.25], [0.18, yC + 0.5], [0.3, yC + 0.75], [0.12, yC + 1.1], [0.05, yC + 2.2], [0, yC + 2.4]].map(([q, y]) => [q * fk, yC + (y - yC) * fk]), 12);
  B.collide(gx - r, gx + r, gn - r, gn + r, 0, yW);
}

// an octagonal copper lantern on a roof: drum with louvred openings, copper pyramid, finial
function lantern(B, K, gx, gn, y, r, h) {
  const [cx, cz] = B.W(gx, gn);
  const a0 = Math.atan2(GE[1], GE[0]) + Math.PI / 8;
  lathe(B, K.copperD, cx, cz, [[r + 0.3, y], [r + 0.3, y + 0.35], [r, y + 0.35]], 8, a0, a0 + TAU);
  const faces = [];
  for (let i = 0; i < 8; i++) {
    const a = a0 + i / 8 * TAU, b = a0 + (i + 1) / 8 * TAU;
    let F = new Frame([cx + Math.cos(a) * r, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, cz + Math.sin(b) * r], B.y0, B.org);
    const mx = Math.cos((a + b) / 2), mz = Math.sin((a + b) / 2);
    if (F.nx * mx + F.nz * mz < 0) F = new Frame([cx + Math.cos(b) * r, cz + Math.sin(b) * r], [cx + Math.cos(a) * r, cz + Math.sin(a) * r], B.y0, B.org);
    faces.push(F);
  }
  for (const F of faces) {
    const L = F.L, hole = { u0: L * 0.22, u1: L * 0.78, y0: y + 0.8, y1: y + h - 0.5 };
    wallWithHoles(B.S(K.copper), F, 0, L, y + 0.35, y + h, [hole], 0);
    quadW(B.S(K.copperD), F, hole.u0, hole.u1, hole.y0, hole.y1, -0.25);
    for (let yy = hole.y0 + 0.2; yy < hole.y1; yy += 0.28) kbox(B.S(K.copperD), F, hole.u0, hole.u1, yy - 0.04, yy, -0.25, -0.05, 0, 16);
    quadU(B.S(K.copper), F, hole.u0, hole.y0, hole.y1, -0.25, 0, 1); quadU(B.S(K.copper), F, hole.u1, hole.y0, hole.y1, -0.25, 0, -1);
    quadY(B.S(K.copper), F, hole.u0, hole.u1, hole.y1, -0.25, 0, -1); quadY(B.S(K.copper), F, hole.u0, hole.u1, hole.y0, -0.25, 0, 1);
    kbox(B.S(K.copperD), F, -0.05, 0.12, y + 0.35, y + h, 0, 0.1, 0.01, 16);
  }
  lathe(B, K.copperD, cx, cz, [[r - 0.1, y + h], [r + 0.4, y + h], [r + 0.4, y + h + 0.3], [r + 0.2, y + h + 0.3]], 8, a0, a0 + TAU);
  lathe(B, K.copper, cx, cz, [[r + 0.3, y + h + 0.3], [r * 0.55, y + h + 1.4], [0.25, y + h + 2.9], [0, y + h + 3.0]], 8, a0, a0 + TAU);
  lathe(B, K.copperD, cx, cz, [[0.2, y + h + 2.9], [0.32, y + h + 3.2], [0.12, y + h + 3.6], [0.05, y + h + 5.0], [0, y + h + 5.2]], 10);
}

// ------------------------------------------------------------------------------------------- the 77th Street front
function front77(B, K) {
  const yN = -39.5;
  // wings: east gx 15..62, west gx -84..-37; depth to gn -22; slate roofs with dormers, a copper ridge
  for (const [gx0, gx1] of [[15.4, 62.5], [-84.1, -37.1]]) {
    const yT = 22.0;
    block(B, gx0, gx1, yN, -22, [romWing(K, yT), false, brickBlock(K, yT, { wall: K.pink }), false], K.pink, yT);
    const R = hipRoof(B, K.slate, K.copperD, gx0 - 0.6, gx1 + 0.6, yN - 0.6, -21.4, yT, 0.82, { gable: true, ch: 0.3, flatTop: 1.6, deckMat: K.copper, mottle: 0.2, streak: 0.25, mw: 0.9, gutter: K.copperD });
    // dormers on the street slope, one over every other bay
    const F = B.F(gx0 - 0.6, yN - 0.6, gx1 + 0.6, yN - 0.6), L = F.L;
    for (let u = 3.4; u < L - 3; u += 5.6) dormer(B, F, K.pinkT, K.slate, K.win, u - 1.0, u + 1.0, yT, 0.82, 1.8, 2.4, { gp: 0.85 });
    // the stone chimney stacks on the back slope
    for (const gx of [gx0 + 5.5, (gx0 + gx1) / 2, gx1 - 5.5]) chimney(B, K, gx, -25.5, 26.0, 33.2);
    // gable end walls stand against the pavilions; a copper ridge vent
    void R;
  }
  // the central pavilion (gx -37..15.4) to gn -10: a big red hip roof, the round towers, the arcade and the terrace
  {
    const gx0 = -37.1, gx1 = 15.4, gn1 = -10, yT = 26.0;
    const P = romPavilion(K, yT);
    P.floors[0] = { sill: 5.6, head: 9.4, w: 3.4, arch: 'round', d: 2.2, door: true, transom: false, hood: true };   // the arcade
    P.bay = 5.2;
    block(B, gx0, gx1, yN, gn1, [P, romPavilion(K, yT), brickBlock(K, yT, { wall: K.pink }), romPavilion(K, yT)], K.pink, yT);
    // the arcade's back wall and doors
    {
      const F = B.F(gx0, yN, gx1, yN);
      quadW(B.S(K.pinkD), F, 3.0, F.L - 3.0, 5.6, 11.5, -2.2);
      for (let u = 8; u < F.L - 6; u += 10.4) {
        quadW(B.S(K.frame), F, u, u + 2.4, 5.6, 9.2, -2.15);
        quadY(B.S(K.pinkT), F, 3, F.L - 3, 11.5, -2.2, 0, -1);
      }
    }
    hipRoof(B, K.tile, K.tileC, gx0 - 0.7, gx1 + 0.7, yN - 0.7, gn1 + 0.7, yT, 0.86, { mottle: 0.36, streak: 0.35, mw: 1.0, gutter: K.copperD, crest: K.copperD, ch: 0.34 });
    // dormers in the red roof (front)
    const F = B.F(gx0 - 0.7, yN - 0.7, gx1 + 0.7, yN - 0.7);
    for (const u of [12, 27.2, 42.4]) dormer(B, F, K.pinkT, K.tile, K.win, u - 1.4, u + 1.4, yT, 0.86, 2.4, 3.2, { gp: 0.9 });
    for (const u of [19.6, 34.8]) dormer(B, F, K.copper, K.tile, K.win, u - 0.8, u + 0.8, yT, 0.86, 7.2, 1.9, { gp: 0.9 });   // the upper row
    for (const Fh of [B.F(gx1 + 0.7, yN - 0.7, gx1 + 0.7, gn1 + 0.7), B.F(gx0 - 0.7, gn1 + 0.7, gx0 - 0.7, yN - 0.7)])
      for (const u of [Fh.L / 2 - 4.2, Fh.L / 2 + 4.2]) dormer(B, Fh, K.pinkT, K.tile, K.win, u - 1.1, u + 1.1, yT, 0.86, 2.6, 2.6, { gp: 0.9 });
    // the round towers at its front corners
    roundTower(B, K, -32.1, -46.0, 4.75, 29.0, 39.5, { roof: 'tile', n: 20 });
    roundTower(B, K, 10.3, -46.3, 4.75, 29.0, 39.5, { roof: 'tile', n: 20 });
    // the terrace over the carriage arches: gx -27.2..6, gn -58..-46, deck at 5.4; stairs down to 77th Street both sides
    terrace77(B, K);
  }
  // the corner pavilions with octagonal copper lanterns
  for (const [gx0, gx1, lx] of [[62.5, 85.3, 74.5], [-106.6, -84.1, -96]]) {
    const yT = 25.0;
    const gn0 = -43.6, gn1 = -12;
    block(B, gx0, gx1, gn0, gn1, [romPavilion(K, yT), gx0 > 0 ? romPavilion(K, yT) : false, brickBlock(K, yT, { wall: K.pink }), gx0 < 0 ? romPavilion(K, yT) : false], K.pink, yT);
    const R = hipRoof(B, K.tile, K.tileC, gx0 - 0.7, gx1 + 0.7, gn0 - 0.7, gn1 + 0.7, yT, 0.9, { mottle: 0.36, streak: 0.35, mw: 1.0, gutter: K.copperD, crest: K.copperD, ch: 0.34 });
    lantern(B, K, lx, (gn0 + gn1) / 2, R.yR - 1.2, 2.6, 3.6);
    // a stepped gable dormer on the street slope
    const F = B.F(gx0 - 0.7, gn0 - 0.7, gx1 + 0.7, gn0 - 0.7);
    dormer(B, F, K.pink, K.tile, K.win, F.L / 2 - 2.2, F.L / 2 + 2.2, yT, 0.9, 1.0, 4.6, { gp: 1.0 });
    // dormers along the long slopes, two rows
    for (const Fl of [B.F(gx1 + 0.7, gn0 - 0.7, gx1 + 0.7, gn1 + 0.7), B.F(gx0 - 0.7, gn1 + 0.7, gx0 - 0.7, gn0 - 0.7)]) {
      for (let u = 5.5; u < Fl.L - 5; u += 5.2) dormer(B, Fl, K.pinkT, K.tile, K.win, u - 0.9, u + 0.9, yT, 0.9, 2.2, 2.4, { gp: 0.9 });
      for (let u = 8.1; u < Fl.L - 7; u += 5.2) dormer(B, Fl, K.copper, K.tile, K.win, u - 0.6, u + 0.6, yT, 0.9, 6.4, 1.6, { gp: 0.9 });
    }
  }
  // the round corner towers (Central Park West and Columbus Avenue)
  roundTower(B, K, 90.6, -45.3, 6.2, 27.5, 40.5, { n: 26, roof: 'tile' });   // (clay tile cones like the pavilions beside them)
  roundTower(B, K, -112.2, -44.7, 6.3, 27.5, 40.5, { n: 26, roof: 'tile' });
  // behind the wings: flat ranges
  block(B, 15.4, 62.5, -22, -3, [false, false, brickBlock(K, 24, { parapet: true }), brickBlock(K, 24)], K.brick, 24);
  roofDeck(B, K, 15.4, 62.5, -22, -3, 24.0, { sky: true });
  block(B, -84.1, -37.1, -22, -3, [false, brickBlock(K, 22), brickBlock(K, 22, { parapet: true }), false], K.brick, 22);
  roofDeck(B, K, -84.1, -37.1, -22, -3, 22.0, { sky: true });
  B.collide(-106.6, 85.3, -43.6, -3, 0, 25);
}

// the terrace in front of the central pavilion: carriage arches under a deck with a balustrade, flights of steps
function terrace77(B, K) {
  const gx0 = -27.2, gx1 = 6.0, gn0 = -58.5, gn1 = -46.0, yD = 5.4;
  const Fs = B.F(gx0, gn0, gx1, gn0), Le = B.F(gx0, gn1, gx0, gn0), Ri = B.F(gx1, gn0, gx1, gn1);
  // the front: five arches
  const holes = [], ops = [];
  const L = Fs.L, n = 5, pw = L / n;
  for (let k = 0; k < n; k++) {
    const u0 = k * pw + 1.2, u1 = (k + 1) * pw - 1.2;
    ops.push({ u0, u1, y0: 0, ys: 2.2, arch: 'round', d: 1.0, wall: K.pinkD, trim: K.pinkT, glass: null, sill: false, door: true, info: {} });
    holes.push({ u0, u1, y0: 0, y1: 2.2 + (u1 - u0) / 2 });
  }
  courses(B, Fs, K.pinkD, 0, L, 0, yD - 0.6, 0.6, holes, 0.08, 0.04, 1.3, 7);
  for (const o of ops) { opening(B, Fs, o); quadW(B.S(K.steel), Fs, o.u0, o.u1, 0, o.ys + (o.u1 - o.u0) / 2, -1.0); }
  for (const F of [Le, Ri]) courses(B, F, K.pinkD, 0, F.L, 0, yD - 0.6, 0.6, [], 0.08, 0.04, 1.3, 3);
  for (const [F, m0, m1] of [[Fs, 1, 1], [Le, 0, 1], [Ri, 1, 0]]) {
    mould(B, F, K.pinkT, PROF.string(yD - 0.6, 0.2, 0.6), 0, F.L, m0, m1);
    balustrade(B, K, F, 0.3, F.L - 0.3, yD);
  }
  B.deck(K.pave, B.rect(gx0, gx1, gn0, gn1 + 6.5), yD);
  // the steps: two flights along the terrace's sides, from the street up to the deck
  for (const [a0, a1] of [[gx0 - 7.0, gx0], [gx1, gx1 + 7.0]]) {
    const nSt = 30, run = 12.0;
    for (let s = 0; s < nSt; s++) {
      const y = (s + 1) * (yD / nSt), g0 = gn0 + s * (run / nSt);
      const F = B.F(a0, g0, a1, g0);
      kbox(B.S(K.pave), F, 0, F.L, 0, y, -(-39.5 - g0), 0, 0.0, 16 | 4);
    }
    const Fb = B.F(a1, gn0 + 12, a0, gn0 + 12);
    void Fb;
  }
}
// a balustrade along face F at deck height y: plinth, balusters, rail
function balustrade(B, K, F, u0, u1, y, h = 1.05) {
  const S = B.S(K.pinkT);
  kbox(S, F, u0, u1, y, y + 0.18, -0.32, 0.02, 0.02, 16);
  for (let u = u0 + 0.25; u < u1 - 0.2; u += 0.32) {
    kbox(S, F, u - 0.07, u + 0.07, y + 0.18, y + h - 0.16, -0.22, -0.08, 0.025, 16);
  }
  kbox(S, F, u0, u1, y + h - 0.16, y + h, -0.34, 0.03, 0.03, 16);
}

// ------------------------------------------------------------------------------------------- Central Park West
function cpw(B, K) {
  const gF = 85.3;
  // the south wing (gn -12..29.5) and the north wing (gn 86.6..134)
  for (const [gn0, gn1] of [[-12, 29.5], [86.6, 134.1]]) {
    const yT = 23.5, gx0 = gn0 < 0 ? 66 : 74;
    const P = cpwWing(K, yT);
    block(B, gx0, gF, gn0, gn1, [gn0 < 0 ? false : cpwWing(K, yT), P, gn0 > 0 ? cpwWing(K, yT) : false, brickBlock(K, yT, { wall: K.buff })], K.buff, yT);
    hipRoof(B, K.tile, K.tileC, gx0 - 0.6, gF + 0.7, gn0 - (gn0 < 0 ? 0 : 0.7), gn1 + (gn0 < 0 ? 0 : 0.7), yT, 0.78, { mottle: 0.36, mw: 1.0, gutter: K.copperD, crest: K.copperD, ch: 0.34, gable: gn0 < 0 });
    B.collide(gx0, gF, gn0, gn1, 0, yT + 6);
  }
  // the north wing's courtyard range with its glass roof, and the brick tower at the 81st Street end
  block(B, 60, 74, 92, 130, [false, false, brickBlock(K, 20, { wall: K.buff }), brickBlock(K, 20)], K.brick, 20);
  skylightRoof(B, K, 60, 74, 92, 130, 20, true);
  block(B, 73.3, 79.1, 134.1, 139.8, [brickBlock(K, 38), brickBlock(K, 38), brickBlock(K, 38, { parapet: true }), brickBlock(K, 38)], K.brick, 38);
  roofDeck(B, K, 73.3, 79.1, 134.1, 139.8, 38, { plant: 0 });
  // the Memorial
  memorial(B, K);
}

// a ridge of glass over a range: glazed slopes on steel ribs (along gn when alongN)
function skylightRoof(B, K, gx0, gx1, gn0, gn1, y, alongN) {
  B.deck(K.membD, B.rect(gx0, gx1, gn0, gn1), y);
  const n = alongN ? 1 : 1;
  void n;
  const inset = 1.2;
  const a0 = alongN ? gx0 + inset : gn0 + inset, a1 = alongN ? gx1 - inset : gn1 - inset, b0 = alongN ? gn0 + inset : gx0 + inset, b1 = alongN ? gn1 - inset : gx1 - inset;
  const rise = (a1 - a0) / 2 * 0.6, am = (a0 + a1) / 2;
  const P = (a, b, yy) => { const [x, z] = alongN ? B.W(a, b) : B.W(b, a); return [x, B.y0 + yy, z]; };
  const Sg = B.G(K.glass).S;
  void Sg;
  // the glazed slopes (as panes on a frame along the ridge)
  for (const s of [-1, 1]) {
    const ea = s < 0 ? a0 : a1;
    const p0 = P(ea, b0, y + 0.6), p1 = P(ea, b1, y + 0.6), p2 = P(am, b1, y + 0.6 + rise), p3 = P(am, b0, y + 0.6 + rise);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let N = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (N[1] < 0) N = N.map((v) => -v);
    B.polyW(B.G(K.glass).S, [p0, p1, p2, p3], N);
    // the ribs
    const nr = Math.round((b1 - b0) / 2.4);
    for (let k = 0; k <= nr; k++) {
      const b = b0 + (b1 - b0) * k / nr;
      ribW(B, B.S(K.steel), P(ea, b, y + 0.65), P(am, b, y + 0.65 + rise), 0.12);
    }
  }
  ribW(B, B.S(K.steel), P(am, b0, y + 0.7 + rise), P(am, b1, y + 0.7 + rise), 0.2);
  // the upstands
  for (const [aa, bb, cc, dd] of [[a0, b0, a1, b0], [a1, b1, a0, b1]]) {
    const p = P(aa, bb, y), q = P(cc, dd, y);
    const F = new Frame([p[0], p[2]], [q[0], q[2]], B.y0, B.org);
    quadW(B.S(K.steel), F, 0, F.L, y, y + 0.6, 0);
    quadW(B.S(K.steel), F, 0, F.L, y, y + 0.6, 0, true);
  }
}

// the Theodore Roosevelt Memorial: front gx 98.6, gn 40.4..75.9; the hall behind (gx 63..85.3, gn 40..80)
function memorial(B, K) {
  const gF = 98.6, gn0 = 40.4, gn1 = 75.9, gB = 85.3;
  const yA = 23.4, yTop = 31.0;     // the entablature's top; the attic's
  const F = B.F(gF, gn0, gF, gn1), L = F.L;
  const um = L / 2;
  // the arch: 9.6 m wide, springing at 12.8
  const aw = 9.4, as = 11.2;
  const archHole = { u0: um - aw / 2, u1: um + aw / 2, y0: 2.6, y1: as + aw / 2 };
  // side bays: a tall window over a niche each side of the columns
  const sideU = [4.2, L - 4.2];
  const holes = [archHole];
  const ops = [];
  for (const u of sideU) {
    ops.push({ u0: u - 1.0, u1: u + 1.0, y0: 3.4, ys: 7.4, arch: null, d: 0.6, wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, mull: 1, transom: 6.0, info: { ws: 700 } });
    ops.push({ u0: u - 1.3, u1: u + 1.3, y0: 11.2, ys: 15.6, arch: 'round', d: 0.7, wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, mull: 1, transom: 15.6, info: { ws: 701 } });
  }
  for (const o of ops) holes.push({ u0: o.u0, u1: o.u1, y0: o.y0, y1: o.ys + (o.arch ? (o.u1 - o.u0) / 2 : 0) });
  // the wall: a rusticated podium storey, ashlar above
  courses(B, F, K.mem, 0, L, 0, 2.6, 0.65, [], 0.06, 0.03, 1.6, 41);
  courses(B, F, K.mem, 0, L, 2.6, yA - 2.2, 0.72, holes, 0.012, 0.01, 1.8, 43);
  for (const o of ops) opening(B, F, o);
  opening(B, F, { u0: archHole.u0, u1: archHole.u1, y0: 2.6, ys: as, arch: 'round', d: 4.5, wall: K.mem, trim: K.memT, glass: null, sill: false, door: true, hood: true, hoodW: 0.9, hoodP: 0.22 });
  // inside the arch: the entrance wall with three bronze doors and a lunette window
  {
    const Fi = B.F(gF - 4.5, gn0, gF - 4.5, gn1);
    const ul = archHole.u0, ur = archHole.u1;
    quadW(B.S(K.memT), Fi, ul, ur, 2.6, as, 0);
    for (let k = 0; k < 3; k++) {
      const u0 = ul + 1.0 + k * 2.75, u1 = u0 + 1.9;
      quadW(B.S(K.frame), Fi, u0, u1, 2.6, 7.4, 0.06);
      kbox(B.S(K.memT), Fi, u0 - 0.25, u1 + 0.25, 7.4, 8.0, 0, 0.3, 0.03, 16);
    }
    B.pane(K.win, Fi, [[ul + 0.6, 8.6], [ur - 0.6, 8.6], [ur - 0.6, as], [ul + 0.6, as]], 0.02, { ws: 710, fh: 8 });
    const A = archPts(ul, ur, as, 'round', 0, 15);
    B.pane(K.win, Fi, [[ul, as], [ur, as], ...A.slice().reverse().slice(1, -1)], 0.02, { ws: 711, fh: 8 });
    for (let k = 1; k < 6; k++) kbox(B.S(K.frame), Fi, ul + k * aw / 6 - 0.05, ul + k * aw / 6 + 0.05, 8.6, as + Math.sqrt(Math.max(0, (aw / 2) ** 2 - (k * aw / 6 - aw / 2) ** 2)) - 0.1, 0.02, 0.1, 0, 16);
    // the vault
    const Ap = archPts(ul, ur, as, 'round', 0, 15);
    for (let k = 0; k + 1 < Ap.length; k++) {
      const [ua, ya] = Ap[k], [ub, yb] = Ap[k + 1];
      // coffers: ribs across the vault
      if (k % 2 === 0) for (const wv of [-1.2, -2.5, -3.8]) kbox(B.S(K.mem), F, Math.min(ua, ub), Math.max(ua, ub) + 0.01, Math.min(ya, yb) - 0.0, Math.max(ya, yb) + 0.01, wv - 0.12, wv + 0.12, 0, 0);
    }
  }
  // the four Ionic columns on pedestals, standing forward of the wall; the entablature breaks forward over them
  const colU = [um - 6.2, um - 11.9, um + 6.2, um + 11.9];
  const r = 1.02, wC = 2.6, yP = 6.4;
  for (const u of colU) {
    const [x, z] = [F.p0[0] + F.ux * u + F.nx * wC, F.p0[1] + F.uz * u + F.nz * wC];
    // the pedestal
    kbox(B.S(K.mem), F, u - 1.45, u + 1.45, 2.6, yP, 0, wC + 1.45, 0.04, 16);
    mould(B, F, K.memT, [[0, yP - 0.5], [wC + 1.6, yP - 0.5], [wC + 1.7, yP - 0.3], [wC + 1.7, yP], [0, yP]], u - 1.6, u + 1.6, 0, 0);
    mould(B, F, K.memT, [[0, 2.6], [wC + 1.7, 2.6], [wC + 1.7, 3.0], [wC + 1.5, 3.2], [0, 3.2]], u - 1.6, u + 1.6, 0, 0);
    const { yc } = column(B, K.memT, x, z, yP, yA - 2.2 - yP, r, { flutes: 24 });
    // the Ionic capital: echinus, the volutes either side (along the facade), the abacus
    lathe(B, K.memT, x, z, [[r * 0.84, yc], [r * 1.05, yc + 0.18], [r * 1.12, yc + 0.42], [r * 0.9, yc + 0.5], [0, yc + 0.5]], 20);
    for (const s of [-1, 1]) {
      const vx = x + F.ux * s * r * 1.25, vz = z + F.uz * s * r * 1.25;
      // a volute: a short drum on the face axis (a lathe about a horizontal axis drawn as a ring of boxes)
      for (let k = 0; k < 14; k++) {
        const a = k / 14 * TAU, rr = 0.42 - k * 0.012;
        const dy = Math.sin(a) * rr, dt = Math.cos(a) * rr * 0.6;
        const px = vx + F.ux * s * dt, pz = vz + F.uz * s * dt;
        const Fv = new Frame([px - F.nx * 0.5, pz - F.nz * 0.5], [px + F.nx * 0.5, pz + F.nz * 0.5], B.y0, B.org);
        kbox(B.S(K.memT), Fv, 0, 1.0, yc + 0.05 + dy + 0.42 - 0.09, yc + 0.05 + dy + 0.42 + 0.09, -0.09, 0.09, 0.02, 0);
      }
    }
    kbox(B.S(K.memT), F, u - 1.25, u + 1.25, yc + 0.5, yc + 0.85, wC - 1.25, wC + 1.25, 0.03, 0);
    // the entablature's break over the column (architrave, frieze, cornice)
    const yE0 = yc + 0.85;
    mould(B, F, K.memT, [[0, yE0], [wC + 1.15, yE0], [wC + 1.15, yE0 + 0.55], [wC + 1.25, yE0 + 0.62], [wC + 1.25, yE0 + 1.05], [wC + 1.15, yE0 + 1.05],
      [wC + 1.15, yA - 0.55], [wC + 1.45, yA - 0.45], [wC + 1.7, yA - 0.2], [wC + 1.7, yA], [0, yA]], u - 1.5, u + 1.5, 0, 0);
    // the statue on the break: plinth and a standing figure in stone
    statue(B, K, F, u, wC, yA);
  }
  // the main entablature along the face and the attic with its inscription panel and cornice
  mould(B, F, K.memT, [[0, yA - 2.2], [0.35, yA - 2.2], [0.35, yA - 1.6], [0.45, yA - 1.55], [0.45, yA - 0.55], [0.8, yA - 0.45], [1.1, yA - 0.2], [1.1, yA], [0, yA]], 0, L, 1, 1);
  courses(B, F, K.mem, 0, L, yA, yTop - 1.0, 0.75, [], 0.012, 0.01, 1.8, 47);
  kbox(B.S(K.memT), F, um - 9.5, um + 9.5, yA + 1.2, yTop - 2.0, 0, 0.12, 0.03, 16);
  kbox(B.S(K.mem), F, um - 9.1, um + 9.1, yA + 1.5, yTop - 2.3, 0.1, 0.16, 0.0, 16);
  for (let k = 0; k < 4; k++) kbox(B.S(K.memT), F, um - 8.4, um + 8.4, yA + 1.95 + k * 0.85, yA + 2.25 + k * 0.85, 0.16, 0.2, 0, 16);   // the inscription's lines
  mould(B, F, K.memT, PROF.cornice(yTop, 0.6, 1.0), 0, L, 1, 1);
  // the Memorial's sides (to the wings) and its roof deck to the hall
  const Fs = B.F(gB, gn0, gF, gn0), Fn = B.F(gF, gn1, gB, gn1);
  for (const Fx of [Fs, Fn]) {
    courses(B, Fx, K.mem, 0, Fx.L, 0, yTop - 1.0, 0.72, [{ u0: Fx.L * 0.35, u1: Fx.L * 0.65, y0: 11.5, y1: 17.0 }], 0.012, 0.01, 1.8, 51);
    opening(B, Fx, { u0: Fx.L * 0.35, u1: Fx.L * 0.65, y0: 11.5, ys: 15.0, arch: 'seg', h: 2.0, d: 0.6, wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, mull: 2, info: { ws: 720 } });
    mould(B, Fx, K.memT, PROF.cornice(yTop, 0.6, 1.0), 0, Fx.L, 1, 1);
  }
  roofDeck(B, K, gB, gF, gn0, gn1, yTop - 0.2, { noPar: true, plant: 0.15 });
  // the broad steps across the front (to the sidewalk), the end pavilions' bumps (gx 85.3..90.9)
  for (let s = 0; s < 8; s++) {
    const g = gF + 0.45 * (8 - s);
    const Fst = B.F(g, gn0 - 3, g, gn1 + 3);
    kbox(B.S(K.memT), Fst, 0, Fst.L, 0, 0.33 * (s + 1) - 0.0, -0.45 * (8 - s) - 0.4, 0, 0.01, 16 | 4);
  }
  for (const [g0, g1] of [[29.5, 40.4], [75.9, 86.6]]) {
    block(B, gB, 90.9, g0, g1, [{ wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, yTop: 27, bay: 5.4, margin: 0.8, ch: 0.72, p: 0.012, c: 0.01, joint: 1.8,
      floors: [{ sill: 4.0, head: 7.5, w: 1.6, arch: null }, { sill: 11.2, head: 15.0, w: 1.6, arch: 'round' }, { sill: 19, head: 21.6, w: 1.4, arch: null }], cornice: { P: 0.6, H: 1.0 } },
    { wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, yTop: 27, bay: 5.4, margin: 0.8, ch: 0.72, p: 0.012, c: 0.01, joint: 1.8,
      floors: [{ sill: 4.0, head: 7.5, w: 1.6, arch: null }, { sill: 11.2, head: 15.0, w: 1.6, arch: 'round' }, { sill: 19, head: 21.6, w: 1.4, arch: null }], cornice: { P: 0.6, H: 1.0 } },
    { wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, yTop: 27, bay: 5.4, margin: 0.8, ch: 0.72, p: 0.012, c: 0.01, joint: 1.8, floors: [], cornice: { P: 0.6, H: 1.0 } }, false], K.mem, 27);
    roofDeck(B, K, gB, 90.9, g0, g1, 27);
  }
  // the hall behind: walls above the wings with thermal windows, the copper roof
  {
    const hx0 = 62.5, hx1 = gB, hn0 = 29.5, hn1 = 86.6, yH = 34.5;
    const faces = B.rectFaces(hx0, hx1, hn0, hn1);
    faces.forEach((Fh, i) => {
      const L = Fh.L, holes = [], ops = [];
      if (i === 0 || i === 2) {
        const u0 = L * 0.18, u1 = L * 0.82;
        ops.push({ u0, u1, y0: 23.6, ys: 23.6, arch: 'round', d: 0.8, wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, mull: 5, transom: false, hood: true, info: { ws: 730 + i, fh: 10 } });
        holes.push({ u0, u1, y0: 23.6, y1: 23.6 + (u1 - u0) / 2 });
      }
      if (i === 3) for (let u = 3; u < L - 4; u += 4.8) { ops.push({ u0: u, u1: u + 1.8, y0: 26, ys: 29.5, arch: 'round', d: 0.5, wall: K.mem, trim: K.memT, glass: K.win, frame: K.frame, info: { ws: 740 } }); holes.push({ u0: u, u1: u + 1.8, y0: 26, y1: 30.4 }); }
      courses(B, Fh, K.mem, 0, L, 0, yH - 1.0, 0.75, holes, 0.012, 0.01, 1.8, 61 + i);
      for (const o of ops) opening(B, Fh, o);
      mould(B, Fh, K.memT, PROF.cornice(yH, 0.7, 1.0), 0, L, 1, 1);
    });
    hipRoof(B, K.copper, K.copperD, hx0 - 0.5, hx1 + 0.5, hn0 - 0.5, hn1 + 0.5, yH, 0.42, { mottle: 0.4, streak: 0.9, mw: 0.6, streakMat: K.copperD, gutter: K.copperD, ch: 0.6, t: 0.03, capW: 0.2, seam: 0.8, seamMat: K.copperD });
    B.collide(hx0, gF, hn0, hn1, 0, yH + 4);
  }
}
// a standing figure on a plinth (the four statues over the Memorial's columns): a simple carved massing in stone
function statue(B, K, F, u, wC, y) {
  const [x, z] = [F.p0[0] + F.ux * u + F.nx * (wC + 0.1), F.p0[1] + F.uz * u + F.nz * (wC + 0.1)];
  kbox(B.S(K.memT), F, u - 0.85, u + 0.85, y, y + 0.9, wC - 0.85 + 0.1, wC + 0.85 + 0.1, 0.03, 0);
  const y0 = y + 0.9;
  lathe(B, K.mem, x, z, [[0.5, y0], [0.62, y0 + 0.2], [0.55, y0 + 1.0], [0.42, y0 + 1.6], [0.48, y0 + 2.1], [0.5, y0 + 2.45], [0.3, y0 + 2.6], [0.16, y0 + 2.68],
    [0.19, y0 + 2.8], [0.21, y0 + 3.0], [0.17, y0 + 3.2], [0.0, y0 + 3.27]], 12);
  // the arms and a staff
  for (const s of [-1, 1]) {
    const ax = x + F.ux * s * 0.52, az = z + F.uz * s * 0.52;
    ribW(B, B.S(K.mem), [ax, B.y0 + y0 + 2.45, az], [ax + F.nx * 0.12, B.y0 + y0 + 1.5, az + F.nz * 0.12], 0.2);
  }
  ribW(B, B.S(K.mem), [x + F.ux * 0.75 + F.nx * 0.2, B.y0 + y0, z + F.uz * 0.75 + F.nz * 0.2], [x + F.ux * 0.75 + F.nx * 0.2, B.y0 + y0 + 3.2, z + F.uz * 0.75 + F.nz * 0.2], 0.09);
}

// ------------------------------------------------------------------------------------------- Columbus Avenue
function columbus(B, K) {
  const gW = -106.6, yT = 23.5;
  const P = romWing(K, yT);
  P.bay = 5.0;
  block(B, gW, -92, -12, 31.9, [false, brickBlock(K, yT, { wall: K.pink }), false, P], K.pink, yT);
  hipRoof(B, K.tile, K.tileC, gW - 0.7, -91.4, -12, 32.6, yT, 0.85, { mottle: 0.36, mw: 1.0, gutter: K.copperD, crest: K.copperD, ch: 0.34, gable: true, gableMat: K.pink });
  const F = B.F(gW - 0.7, 32.6, gW - 0.7, -12);
  for (let u = 3.0; u < F.L - 2; u += 5.0) dormer(B, F, K.pinkT, K.tile, K.win, u - 0.9, u + 0.9, yT, 0.85, 1.6, 2.4);
  B.collide(gW, -92, -12, 31.9, 0, yT + 6);
}

// ------------------------------------------------------------------------------------------- the interior ranges
function interior(B, K) {
  // the copper-roofed central range (gx -21..0) from the central pavilion to the brick block at its north end
  {
    const yT = 26;
    block(B, -21.4, 0, -10, 30, [false, brickBlock(K, yT), false, brickBlock(K, yT)], K.brick, yT);
    hipRoof(B, K.copper, K.copperD, -22.0, 0.6, -10, 30, yT, 0.95, { mottle: 0.4, streak: 0.9, mw: 0.6, streakMat: K.copperD, gutter: K.copperD, gable: true, gableMat: K.brick, ch: 0.5, t: 0.025, seam: 0.75, seamMat: K.copperD });
    const Fe = B.F(0.6, -10, 0.6, 30), Fw = B.F(-22.0, 30, -22.0, -10);
    for (const Fx of [Fe, Fw]) for (let u = 3; u < Fx.L - 2; u += 4.4) dormer(B, Fx, K.copper, K.copper, K.win, u - 0.9, u + 0.9, yT, 0.95, 1.4, 2.3);
    // the brick block at its north end with its own copper hip
    block(B, -26.4, 4.0, 30, 46, [false, brickBlock(K, 31), brickBlock(K, 31), brickBlock(K, 31)], K.brick, 31);
    hipRoof(B, K.copper, K.copperD, -27.0, 4.6, 29.4, 46.6, 31, 0.8, { mottle: 0.4, streak: 0.9, mw: 0.6, streakMat: K.copperD, gutter: K.copperD, ch: 0.5, t: 0.025, seam: 0.75, seamMat: K.copperD });
    B.collide(-26.4, 4, -10, 46, 0, 31);
  }
  // the octagon (gx -2, gn 60) with its low copper pyramid
  {
    const [cx, cz] = B.W(-3, 59.5), r = 13.5, yW = 15;
    const a0 = Math.atan2(GE[1], GE[0]) + Math.PI / 8;
    for (let i = 0; i < 8; i++) {
      const a = a0 + i / 8 * TAU, b = a0 + (i + 1) / 8 * TAU;
      let F = new Frame([cx + Math.cos(a) * r, cz + Math.sin(a) * r], [cx + Math.cos(b) * r, cz + Math.sin(b) * r], B.y0, B.org);
      const mx = Math.cos((a + b) / 2), mz = Math.sin((a + b) / 2);
      if (F.nx * mx + F.nz * mz < 0) F = new Frame([cx + Math.cos(b) * r, cz + Math.sin(b) * r], [cx + Math.cos(a) * r, cz + Math.sin(a) * r], B.y0, B.org);
      facade(B, F, F.L, brickBlock(K, yW, { bay: 3.4 }));
    }
    lathe(B, K.copper, cx, cz, [[r + 0.5, yW], [r + 0.5, yW + 0.3], [r * 0.25, yW + 6.0], [r * 0.2, yW + 6.0]], 8, a0, a0 + TAU);
    lathe(B, K.glass, cx, cz, [[r * 0.2, yW + 6.0], [r * 0.2, yW + 7.2], [0, yW + 8.6]], 8, a0, a0 + TAU);
    B.collide(-16, 10, 46, 73, 0, yW + 5);
  }
  // the tall brick block west of the Memorial hall (gx 5..62.5, gn 30..67)
  {
    const yT = 34;
    block(B, 5, 62.5, 30, 67, [brickBlock(K, yT, { wall: K.brickD, parapet: true }), false, brickBlock(K, yT, { wall: K.brickD, parapet: true }), brickBlock(K, yT, { wall: K.brickD, parapet: true })], K.brickD, yT);
    roofDeck(B, K, 5, 62.5, 30, 67, yT, { plant: 0.5 });
    block(B, 20, 45, 40, 58, [brickBlock(K, 39, { wall: K.brickD, floors: [] }), brickBlock(K, 39, { wall: K.brickD, floors: [] }), brickBlock(K, 39, { wall: K.brickD, floors: [] }), brickBlock(K, 39, { wall: K.brickD, floors: [] })], K.brickD, 39);
    roofDeck(B, K, 20, 45, 40, 58, 39, { plant: 0.6 });
    B.collide(5, 62.5, 30, 67, 0, yT);
  }
  // the slate pyramid hall (gx 10..48, gn -3..30)
  {
    const yT = 21;
    block(B, 10, 48, -3, 30, [false, brickBlock(K, yT), false, brickBlock(K, yT)], K.brick, yT);
    hipRoof(B, K.slate, K.copperD, 9.4, 48.6, -3.6, 30.6, yT, 0.62, { mottle: 0.2, streak: 0.25, mw: 0.9, gutter: K.copperD, ch: 0.32 });
    B.collide(10, 48, -3, 30, 0, yT + 8);
  }
  // the court ranges: flat roofs, a copper deck with skylights over the west range
  block(B, -84.1, -48, -3, 15, [false, brickBlock(K, 20), false, false], K.brick, 20);
  B.deck(K.copper, B.rect(-84.1, -48, -3, 15), 20.0);
  for (let g = -80; g < -50; g += 6) skylightRoof(B, K, g, g + 4, 0, 12, 20.05, true);
  block(B, -92, -48, 15, 31.9, [false, brickBlock(K, 22), brickBlock(K, 22, { parapet: true }), false], K.brick, 22);
  roofDeck(B, K, -92, -48, 15, 31.9, 22, { sky: true });
  block(B, -48, -21.4, -3, 16, [false, false, brickBlock(K, 18), false], K.brick, 18);
  roofDeck(B, K, -48, -21.4, -3, 16, 18, { sky: true });
  block(B, 62.5, 66, -12, 30, [false, false, false, brickBlock(K, 22)], K.brick, 22);
  roofDeck(B, K, 62.5, 66, -12, 30, 22);
  block(B, 48, 62.5, -3, 30, [false, false, false, false], K.brick, 0);
  // the courts' floors (paved)
  B.deck(K.pave, B.rect(48, 62.5, -3, 30), 0.25);
  // between the Memorial hall and the cube
  block(B, 54.8, 74, 67, 92, [false, false, brickBlock(K, 20, { wall: K.buff }), false], K.buff, 20);
  roofDeck(B, K, 54.8, 74, 67, 92, 20);
}

// ------------------------------------------------------------------------------------------- the Rose Center
function roseCenter(B, K) {
  const gx0 = 21.5, gx1 = 58.5, gn0 = 91.0, gn1 = 128.6, yR = 30.5, band = 2.4;
  const faces = B.rectFaces(gx0, gx1, gn0, gn1);
  const nV = 12, nH = 16;
  faces.forEach((F, fi) => {
    const L = F.L, cw = L / nH, rh = (yR - band - 0.4) / nV;
    // the glass, one pane per cell, set 0.25 behind the mullions' faces
    for (let j = 0; j < nV; j++) for (let i = 0; i < nH; i++) {
      const u0 = i * cw, y0 = 0.4 + j * rh;
      B.pane(K.glass, F, [[u0, y0], [u0 + cw, y0], [u0 + cw, y0 + rh], [u0, y0 + rh]], -0.25, { cu: i, cv: j, ws: 800 + fi, fh: rh, sill: 0.05 });
    }
    // the mullions and transoms (the cable-net's clamps read as a fine grid of aluminium)
    for (let i = 0; i <= nH; i++) kbox(B.S(K.mull), F, i * cw - 0.05, i * cw + 0.05, 0.4, yR - band, -0.25, 0.05, 0.01, 16);
    for (let j = 0; j <= nV; j++) kbox(B.S(K.mull), F, 0, L, 0.4 + j * rh - 0.04, 0.4 + j * rh + 0.04, -0.25, 0.03, 0.01, 16);
    // the base kerb and the roof band
    kbox(B.S(K.conc), F, -0.4, L + 0.4, 0, 0.4, -0.3, 0.2, 0.02, 16);
    kbox(B.S(K.conc), F, -0.6, L + 0.6, yR - band, yR, -0.3, 0.45, 0.03, 16);
    kbox(B.S(K.conc), F, -0.6, L + 0.6, yR, yR + 0.35, -0.6, 0.45, 0.02, 16);
  });
  B.deck(K.conc, B.rect(gx0 - 0.4, gx1 + 0.4, gn0 - 0.4, gn1 + 0.4), yR + 0.3);
  B.deck(K.conc, B.rect(gx0, gx1, gn0, gn1), yR - band, true);
  // roof plant: four small skylit boxes
  for (const [a, b] of [[34, 104], [44, 104], [34, 114], [44, 114]]) {
    block(B, a, a + 3, b, b + 3, [false, false, false, false], K.conc, 0);
    const F4 = B.rectFaces(a, a + 3, b, b + 3);
    for (const F of F4) kbox(B.S(K.conc), F, 0, F.L, yR + 0.3, yR + 1.4, -0.3, 0, 0.02, 16);
    B.deck(K.glass, B.rect(a, a + 3, b, b + 3), yR + 1.4);
  }
  // inside: the floor, the Hayden Sphere on its legs, the walkway ring
  const [cx, cz] = B.W((gx0 + gx1) / 2, (gn0 + gn1) / 2), R = 13.25, yc = 15.3;
  B.deck(K.pave, B.rect(gx0, gx1, gn0, gn1), 0.4);
  const prof = [];
  for (let k = 0; k <= 32; k++) { const a = -Math.PI / 2 + (k / 32) * Math.PI; prof.push([Math.max(0, Math.cos(a) * R), yc + Math.sin(a) * R]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  lathe(B, K.sphere, cx, cz, prof, 48);
  // the sphere's equator band and panel rings
  for (const lat of [-0.5, 0, 0.5]) {
    const yy = yc + Math.sin(lat) * R, rr = Math.cos(lat) * R;
    lathe(B, K.mull, cx, cz, [[rr - 0.02, yy - 0.12], [rr + 0.06, yy - 0.08], [rr + 0.06, yy + 0.08], [rr - 0.02, yy + 0.12]], 48);
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.4;
    const fx = cx + Math.cos(a) * R * 0.45, fz = cz + Math.sin(a) * R * 0.45;
    ribW(B, B.S(K.mull), [fx, B.y0 + 0.4, fz], [fx * 0.7 + cx * 0.3, B.y0 + yc - R * 0.85, fz * 0.7 + cz * 0.3], 0.7);
  }
  // the spiral walkway round the sphere (the Cosmic Pathway's lower turn) as a band on posts
  for (let k = 0; k < 48; k++) {
    const a0 = k / 48 * TAU, a1 = (k + 1) / 48 * TAU, rr = R + 2.2, y0 = 1.5 + k * 0.12, y1 = 1.5 + (k + 1) * 0.12;
    const P = (a, r, y) => [cx + Math.cos(a) * r, B.y0 + y, cz + Math.sin(a) * r];
    B.polyW(B.S(K.conc), [P(a0, rr - 1.5, y0), P(a1, rr - 1.5, y1), P(a1, rr + 1.5, y1), P(a0, rr + 1.5, y0)], [0, 1, 0]);
    B.polyW(B.S(K.mull), [P(a0, rr + 1.5, y0), P(a1, rr + 1.5, y1), P(a1, rr + 1.5, y1 + 1.0), P(a0, rr + 1.5, y0 + 1.0)], [Math.cos(a0), 0, Math.sin(a0)]);
  }
  B.collide(gx0, gx1, gn0, gn1, 0, yR);
}

// ------------------------------------------------------------------------------------------- builders
function courtFloor(B, K, ctx) {
  if (!ctx.footprint || ctx.footprint.length < 3) return;
  const ring = ctx.footprint.map(([x, z]) => [x + B.cx, z + B.cz]);
  B.deck(K.pave, ring, 0.15);
}
export function buildAmnh(ctx) {
  WS = 0;
  const B = new LB(ctx, O), K = M();
  B.we = [0.37, B.y0, B.y0 + 40];
  courtFloor(B, K, ctx);
  front77(B, K);
  cpw(B, K);
  columbus(B, K);
  interior(B, K);
  roseCenter(B, K);
  return B.group('amnh');
}

// ------------------------------------------------------------------------------------------- the north side
// the Gilder Center (Studio Gang, 2023): granite in flowing horizontal bands on a curving plan, deep curved openings
function gilder(B, K) {
  // the plan: control points in the grid (the compiled ring's west bulge and the reference's rounded lobes)
  const C = [[-104, 34], [-107, 44], [-103, 52], [-96, 56], [-89, 62], [-89, 70], [-86, 77], [-79, 82], [-71, 86], [-60, 91], [-46, 92], [-36, 88],
    [-33, 76], [-36, 66], [-40, 54], [-45, 40], [-55, 34], [-70, 33], [-86, 33]];
  let plan = catmull(C, 6);
  { let A = 0; for (let i = 0; i < plan.length; i++) { const p = plan[i], q = plan[(i + 1) % plan.length]; A += p[0] * q[1] - q[0] * p[1]; } if (A < 0) plan = plan.reverse(); }
  const bands = 6, hb = 4.1;
  for (let k = 0; k < bands; k++) {
    const y0 = k * hb, y1 = y0 + hb;
    const off = 0.35 * Math.sin(k * 1.7);
    const ring = offsetPoly(plan, off - k * 0.12);
    const ringT = offsetPoly(plan, off - k * 0.12 + 0.95);
    // each band: its face, a rounded nose (the band's top projecting), openings cut in the lower bands
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length], at = ringT[i], bt = ringT[(i + 1) % ring.length];
      const pa = B.W(a[0], a[1]), pb = B.W(b[0], b[1]), qa = B.W(at[0], at[1]), qb = B.W(bt[0], bt[1]);
      const F = new Frame(pa, pb, B.y0, B.org);
      const glazed = k < 4 && ((i + k * 3) % 11 < 4) && !(a[0] > -50 && a[1] < 40);
      if (glazed) {
        quadW(B.S(K.gild), F, 0, F.L, y1 - 1.1, y1, 0);
        B.pane(K.glass, F, [[0, y0 + 0.2], [F.L, y0 + 0.2], [F.L, y1 - 1.1], [0, y1 - 1.1]], -0.6, { cu: i, cv: k, ws: 950 });
        quadY(B.S(K.gild), F, 0, F.L, y1 - 1.1, -0.6, 0, -1);
        quadY(B.S(K.gild), F, 0, F.L, y0 + 0.2, -0.6, 0, 1);
        quadU(B.S(K.gild), F, 0, y0, y1 - 1.1, -0.6, 0, 1); quadU(B.S(K.gild), F, F.L, y0, y1 - 1.1, -0.6, 0, -1);
        quadW(B.S(K.gild), F, 0, F.L, y0, y0 + 0.2, 0);
      } else quadW(B.S(K.gild), F, 0, F.L, y0, y1 - 0.5, 0);
      // the nose: from the face out to the projecting top
      const Ft = new Frame(qa, qb, B.y0, B.org);
      const L = F.L, Lt = Ft.L;
      B.polyW(B.S(K.gild), [[pa[0], B.y0 + y1 - 0.5, pa[1]], [pb[0], B.y0 + y1 - 0.5, pb[1]], [qb[0], B.y0 + y1 - 0.15, qb[1]], [qa[0], B.y0 + y1 - 0.15, qa[1]]], [F.nx, -0.6, F.nz]);
      B.polyW(B.S(K.gild), [[qa[0], B.y0 + y1 - 0.15, qa[1]], [qb[0], B.y0 + y1 - 0.15, qb[1]], [qb[0], B.y0 + y1, qb[1]], [qa[0], B.y0 + y1, qa[1]]], [F.nx, 0, F.nz]);
      void L; void Lt;
    }
    // the band's top deck (the next band sits on it)
    B.deck(K.gild, ringT.map(([gx, gn]) => B.W(gx, gn)), y1);
  }
  // the roof: a membrane deck with a low glass lantern
  B.deck(K.pave, offsetPoly(plan, -1.0).map(([gx, gn]) => B.W(gx, gn)), bands * hb + 0.05);
  B.deck(am('amnh_sedum', '#56683f'), offsetPoly(plan, -3.2).map(([gx, gn]) => B.W(gx, gn)), bands * hb + 0.3);   // the planted roof
  skylightRoof(B, K, -80, -55, 50, 75, bands * hb + 0.1, true);
  B.collide(-107, -33, 33, 92, 0, bands * hb);
}
function catmull(P, sub) {
  const out = [], n = P.length;
  for (let i = 0; i < n; i++) {
    const p0 = P[(i - 1 + n) % n], p1 = P[i], p2 = P[(i + 1) % n], p3 = P[(i + 2) % n];
    for (let s = 0; s < sub; s++) {
      const t = s / sub, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)));
    }
  }
  return out;
}
// offset a closed grid polygon by d (outward for a counter-clockwise ring in (gx, gn))
function offsetPoly(P, d) {
  let A = 0; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; A += p[0] * q[1] - q[0] * p[1]; }
  const s = A > 0 ? 1 : -1, n = P.length;
  return P.map((p, i) => {
    const a = P[(i - 1 + n) % n], b = P[(i + 1) % n];
    const tx = b[0] - a[0], ty = b[1] - a[1], L = Math.hypot(tx, ty) || 1;
    return [p[0] + s * ty / L * d, p[1] - s * tx / L * d];
  });
}
export function buildAmnhNorth(ctx) {
  WS = 500;
  const B = new LB(ctx, O), K = M();
  B.we = [0.53, B.y0, B.y0 + 30];
  courtFloor(B, K, ctx);
  gilder(B, K);
  // the brick north building (gx -84..-50, gn 92..127) with three glass ridges
  {
    const yT = 19;
    const P = brickBlock(K, yT, { bay: 3.6 });
    P.floors = [{ sill: 1.4, head: 4.4, w: 1.8, arch: 'round', fh: 5 }, { sill: 7.0, head: 9.8, w: 1.6, arch: 'seg', h: 0.3, fh: 4.5 }, { sill: 11.6, head: 14.2, w: 1.6, arch: 'seg', h: 0.3, fh: 4.2 }, { sill: 15.6, head: 17.2, w: 1.4, arch: null, fh: 3.6 }];
    P.cornice = { P: 0.6, H: 0.9 }; P.hood = true; P.trim = K.stoneG;
    block(B, -84, -50, 92, 127, [false, P, P, P], K.brick, yT);
    for (const g of [99, 109.5, 120]) skylightRoof(B, K, -81, -53, g - 3.5, g + 3.5, yT, false);
    roofDeck(B, K, -84, -50, 92, 127, yT - 0.02, { plant: 0, noPar: true });
    B.collide(-84, -50, 92, 127, 0, yT);
  }
  // the 81st Street terrace (gx -50..21.5, gn 90..128.6): a granite deck over the lower lobby, its glazed north front
  {
    const t0 = -50, t1 = 21.5, n0 = 90, n1 = 128.6, yD = 2.2;
    const faces = B.rectFaces(t0, t1, n0, n1);
    // the north front: glass between granite piers
    const Fn = faces[2];
    for (let u = 0; u < Fn.L - 0.1; u += 4.5) {
      kbox(B.S(K.pave), Fn, u, u + 0.6, 0, yD, -0.6, 0, 0.02, 16);
      B.pane(K.glass, Fn, [[u + 0.6, 0.1], [Math.min(Fn.L, u + 4.5), 0.1], [Math.min(Fn.L, u + 4.5), yD - 0.2], [u + 0.6, yD - 0.2]], -0.4, { ws: 960 });
    }
    for (const i of [1, 3]) quadW(B.S(K.pave), faces[i], 0, faces[i].L, 0, yD, 0);
    B.deck(K.pave, B.rect(t0, t1, n0, n1), yD);
    for (const F of faces) { if (F === faces[0]) continue; mould(B, F, K.stoneG, PROF.coping(yD, 0.1, 0.25), 0, F.L, 1, 1); }
    // the lawn strip and planters
    block(B, -20, 0, 100, 116, [false, false, false, false], K.pave, 0);
    B.deck(surfMat('mulch', '#4f6a3a'), B.rect(-20, 0, 100, 116), yD + 0.35);
    for (const F of B.rectFaces(-20, 0, 100, 116)) kbox(B.S(K.stoneG), F, 0, F.L, yD, yD + 0.45, -0.3, 0, 0.02, 16);
    // steps down to 81st Street at its west end
    for (let s = 0; s < 12; s++) {
      const F = B.F(-50, 128.6 + (12 - s) * 0.4, -30, 128.6 + (12 - s) * 0.4);
      kbox(B.S(K.pave), F, 0, F.L, 0, (s + 1) * yD / 12, -0.4, 0, 0, 16 | 4);
    }
  }
  // the low ranges south of the terrace (gx -50..54.8, gn 67..90) and the infill behind the Gilder
  {
    const yT = 12.5;
    block(B, -36, 54.8, 70, 90, [false, false, brickBlock(K, yT, { wall: K.stoneG, trim: K.conc, bay: 4.2, parapet: true }), false], K.stoneG, yT);
    roofDeck(B, K, -36, 54.8, 70, 90, yT, { sky: true });
    block(B, -48, -21.4, 16, 32, [false, false, brickBlock(K, 18, { parapet: true }), false], K.brick, 18);
    roofDeck(B, K, -48, -21.4, 16, 32, 18);
    block(B, -36, -26.4, 32, 70, [false, false, false, brickBlock(K, 20)], K.brick, 20);
    roofDeck(B, K, -36, -26.4, 32, 70, 20);
  }
  return B.group('amnhNorth');
}
