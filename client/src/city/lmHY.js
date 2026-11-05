// lmHY.js: Hudson Yards on its compiled rings (LM66, 2026-10-31). The district rose after the city's 2014 3D building model,
// so its massing comes from the published heights, the footprints and the towers' setbacks; every builder draws in one site
// frame (u east along the streets, v south along the avenues, metres from a fixed world point), so each piece stands on its
// site whatever ring a compile hands its builder.
//   buildHY30 (the 30 Hudson Yards lot: the Shops and 30 Hudson Yards with its crown and Edge, the sky deck at the 100th floor)
//   buildHY10 (10 Hudson Yards over the High Line), buildHY35, buildHY15 (and The Shed: the base building and its movable
//   shell), buildHY50, buildHY55, buildHYSpiral, buildHYVessel (the Vessel and the Public Square and Gardens on the platform
//   over the rail yard), buildHYNone (a footprint another builder draws).
// All merged per material with lmFacadeKit.js accumulators; facades are painted tiles mapped to whole bays and floors.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, capRing, loft, addMeshes, triCount, facadeMat, rgbs, speckle, streaks, rng, offsetRing } from './lmFacadeKit.js';
import {
  tile, glassPaint, taperWalls, bayCounts, rectUV, chamferUV, roundUV, scalePlan, capDown, capHoles, sweepOpen, lathe, box, cyl,
} from './lmMidKit.js';

const { mat } = KIT;

/* ------------------------------------------------------------- the site frame */
// u along the cross streets toward Tenth Avenue (bearing 119 degrees), v along the avenues toward the south; origin the vertex
// mean of the 30 Hudson Yards lot's compiled ring (world -2511.9, 3278.3). The eastern rail yard runs from u -178 (Eleventh
// Avenue) to u 70 (Tenth Avenue), v -80 (33rd Street) to v 140 (30th Street).
const SU = [0.874620, 0.484810], SV = [-0.484810, 0.874620], SO = [-2511.9, 3278.3];
function siteMap(ctx) {
  const ox = SO[0] - (ctx.cx ?? 0), oz = SO[1] - (ctx.cz ?? 0);
  const xz = (u, v) => [ox + u * SU[0] + v * SV[0], oz + u * SU[1] + v * SV[1]];
  const apply = (acc) => {
    const p = acc.p, n = acc.n;
    for (let i = 0; i < p.length; i += 3) {
      const u = p[i], v = p[i + 2];
      p[i] = ox + u * SU[0] + v * SV[0]; p[i + 2] = oz + u * SU[1] + v * SV[1];
      const nu = n[i], nv = n[i + 2];
      n[i] = nu * SU[0] + nv * SV[0]; n[i + 2] = nu * SU[1] + nv * SV[1];
    }
    return acc;
  };
  const rot = Math.atan2(-SU[1], SU[0]);
  const col = (u, v, w, d, y0, y1) => { const [x, z] = xz(u, v); return { x, y: (y0 + y1) / 2, z, w, h: y1 - y0, d, rotY: rot }; };
  return { xz, apply, col, rot };
}
// a site ring given as 'u,v u,v ...'
const P = (s) => s.trim().split(/\s+/).map((t) => t.split(',').map(Number));

/* --------------------------------------------------------------- footprints */
// the lots (the city's footprints of the towers, in the site frame)
const LOT = {
  p30: P('-41.0,-78.4 -5.6,-77.7 22.2,-77.2 34.5,-77.0 34.5,-77.9 41.7,-77.9 41.8,-79.5 68.5,-79.3 70.0,-76.0 71.8,-71.7 65.2,-64.9 65.2,-62.7 67.0,-62.7 67.2,-38.1 61.9,-38.3 61.9,-35.1 61.6,-21.5 51.6,-21.5 28.8,-21.4 11.3,-21.3 -38.2,-21.2 -38.2,-33.6 -45.1,-33.5 -45.0,-37.0 -43.8,-75.5 -42.6,-76.8'),
  shops: P('68.4,84.2 63.0,84.3 45.8,84.0 14.7,83.8 6.3,83.7 -11.9,83.6 -29.0,83.5 -33.3,83.5 -45.0,83.4 -44.0,77.2 -43.3,73.3 -42.6,69.0 -48.3,69.0 -52.2,69.0 -48.1,11.3 -46.6,-28.5 -46.5,-30.8 -45.2,-30.8 -45.1,-33.5 -38.2,-33.6 -38.2,-21.2 11.3,-21.3 28.8,-21.4 51.6,-21.5 61.6,-21.5 61.9,-35.1 68.1,-35.2 68.3,49.7'),
  p10: P('45.8,84.0 14.7,83.8 6.3,83.7 -11.9,83.6 -29.0,83.5 -28.9,110.0 -38.1,110.2 -34.7,117.2 -38.1,122.1 -32.3,122.1 -24.6,137.5 32.3,137.8 46.8,137.6 50.8,134.0 50.7,93.5 45.9,93.6'),
  p35: P('-173.7,-78.7 -173.6,-20.8 -127.5,-21.1 -127.4,-22.7 -120.9,-78.8'),
  p15: P('-174.3,121.7 -174.2,138.7 -146.6,138.7 -146.2,77.7 -174.5,77.9'),
  shed: P('-146.2,77.7 -64.3,76.8 -63.5,120.5 -106.8,121.3 -106.9,138.5 -146.6,138.7'),
  p55: P('-118.5,-98.3 -112.5,-154.0 -174.0,-153.8 -174.1,-98.4'),
  p50: P('68.9,-153.2 68.9,-97.6 -37.8,-97.4 -37.9,-153.1'),
  spiral: P('-35.2,-247.1 -36.0,-190.8 66.7,-189.4 67.5,-245.8'),
};
// the Vessel's centre and the Public Square (the platform's open ground between the towers)
const VES = { u: -96.4, v: 27.8, r0: 7.6, r1: 23.0, H: 45.7, lv: 16, n: 12 };
const SQUARE = P('-121.0,-80.5 -47.0,-80.5 -45.6,-33.4 -46.6,-28.5 -48.1,11.3 -52.2,69.0 -61.0,76.9 -146.2,77.7 -178.0,78.0 -178.0,-19.5 -127.4,-21.2');

/* --------------------------------------------------------------- materials */
let _M = null;
function hyMats() {
  if (_M) return _M;
  const T = (key, o, seed, nx = 4, ny = 4, w = 256, h = 512) => tile(key, w, h, glassPaint({ nx, ny, ...o }), seed, nx, ny);
  // the towers' curtain walls: a bay of 1.52 m, a floor of 4.4 m (offices) or 3.2 m (homes); light glass that mirrors the sky
  const t30 = T('hy-30', { top: [128, 146, 168], bot: [86, 104, 128], mullion: [196, 202, 208], mw: 3, bandH: 0.09, band: [196, 202, 208], blinds: 0.08, finEvery: 4, finW: 5, fin: [210, 214, 218] }, 301);
  const t10 = T('hy-10', { top: [130, 140, 152], bot: [88, 98, 110], mullion: [190, 194, 198], mw: 3, fin: [206, 208, 210], finEvery: 2, finW: 6, finShade: 1, bandH: 0.1, band: [150, 156, 162], blinds: 0.1 }, 302);
  const t35 = T('hy-35', { top: [134, 146, 156], bot: [92, 102, 112], mullion: [214, 208, 196], mw: 4, fin: [222, 216, 202], finEvery: 2, finW: 26, finShade: 1, bandH: 0.22, band: [206, 200, 188], blinds: 0.2, blind: [226, 218, 200] }, 303, 4, 4, 256, 384);
  const t15 = T('hy-15', { top: [118, 134, 146], bot: [74, 88, 100], mullion: [186, 192, 196], mw: 3, bandH: 0.1, band: [168, 174, 178], blinds: 0.25, blind: [224, 220, 206], split: 0.5 }, 304, 4, 4, 256, 384);
  const t50 = T('hy-50', { top: [118, 130, 142], bot: [78, 88, 100], mullion: [150, 156, 162], mw: 2, fin: [238, 238, 234], finEvery: 4, finW: 22, finShade: 1, bandH: 0.08, band: [104, 110, 118], blinds: 0.12 }, 305);
  const t55 = T('hy-55', { top: [104, 110, 118], bot: [70, 76, 84], mullion: [62, 58, 54], mw: 5, fin: [70, 64, 58], finEvery: 1, finW: 10, finShade: 1, bandH: 0.2, band: [58, 56, 54], blinds: 0.08 }, 306);
  const tSp = T('hy-sp', { top: [146, 158, 168], bot: [100, 112, 124], mullion: [222, 224, 224], mw: 4, fin: [232, 232, 230], finEvery: 2, finW: 12, finShade: 1, bandH: 0.1, band: [210, 212, 212], blinds: 0.12 }, 307);
  const tShop = T('hy-shops', { top: [142, 150, 158], bot: [98, 106, 114], mullion: [206, 204, 198], mw: 6, fin: [214, 210, 202], finEvery: 1, finW: 18, finShade: 1, bandH: 0.3, band: [200, 196, 188], blinds: 0 }, 308, 4, 2, 256, 256);
  const tShedB = T('hy-shed', { top: [150, 160, 168], bot: [108, 118, 126], mullion: [200, 204, 206], mw: 4, bandH: 0.18, band: [176, 180, 182], blinds: 0.15 }, 309, 4, 4, 256, 384);
  // The Shed's shell: ETFE cushions, a quilt of pale pillows in a diagonal steel frame
  const shell = tile('hy-shell', 512, 512, (g, gb, w, h, r) => {
    g.fillStyle = 'rgb(214,216,216)'; g.fillRect(0, 0, w, h);
    const n = 4, c = w / n;
    for (let j = -1; j <= n; j++) for (let i = -1; i <= n; i++) {
      const cx = i * c + (j % 2 ? c / 2 : 0), cy = j * c / 2;
      const gr = g.createRadialGradient(cx - c * 0.12, cy - c * 0.1, 2, cx, cy, c * 0.62);
      gr.addColorStop(0, 'rgb(240,242,242)'); gr.addColorStop(0.7, 'rgb(206,210,212)'); gr.addColorStop(1, 'rgb(170,176,180)');
      g.fillStyle = gr; g.beginPath(); g.moveTo(cx, cy - c / 2); g.lineTo(cx + c / 2, cy); g.lineTo(cx, cy + c / 2); g.lineTo(cx - c / 2, cy); g.closePath(); g.fill();
      const gb2 = gb.createRadialGradient(cx, cy, 2, cx, cy, c * 0.55); gb2.addColorStop(0, 'rgb(210,210,210)'); gb2.addColorStop(1, 'rgb(90,90,90)');
      gb.fillStyle = gb2; gb.beginPath(); gb.moveTo(cx, cy - c / 2); gb.lineTo(cx + c / 2, cy); gb.lineTo(cx, cy + c / 2); gb.lineTo(cx - c / 2, cy); gb.closePath(); gb.fill();
    }
    g.strokeStyle = 'rgb(150,154,156)'; g.lineWidth = 5; gb.strokeStyle = 'rgb(240,240,240)'; gb.lineWidth = 6;
    for (let k = -n; k <= 2 * n; k++) {
      for (const c2 of [g, gb]) { c2.beginPath(); c2.moveTo(k * c, 0); c2.lineTo(k * c + h, h); c2.stroke(); c2.beginPath(); c2.moveTo(k * c, 0); c2.lineTo(k * c - h, h); c2.stroke(); }
    }
  }, 310);
  // the square's paving: granite pavers in long courses, darker bands, joints
  const pave = tile('hy-pave', 512, 512, (g, gb, w, h, r) => {
    g.fillStyle = 'rgb(188,184,176)'; g.fillRect(0, 0, w, h);
    const ch = h / 16;
    for (let j = 0; j < 16; j++) {
      let x = -r() * 60;
      while (x < w) { const bl = 40 + r() * 60; g.fillStyle = rgbs([188, 184, 176], 0.92 + r() * 0.14); g.fillRect(x, j * ch, bl, ch); g.fillStyle = 'rgba(60,56,50,0.35)'; g.fillRect(x, j * ch, 1.5, ch); gb.fillStyle = 'rgb(110,110,110)'; gb.fillRect(x, j * ch, 1.5, ch); x += bl; }
      g.fillStyle = 'rgba(60,56,50,0.35)'; g.fillRect(0, j * ch, w, 1.5); gb.fillStyle = 'rgb(110,110,110)'; gb.fillRect(0, j * ch, w, 1.5);
    }
    for (const y of [0, h / 2]) { g.fillStyle = 'rgba(80,78,74,0.35)'; g.fillRect(0, y, w, ch); }
    speckle(g, 0, 0, w, h, r, 1200, 0.06); streaks(g, 0, 0, w, h, r, 20, 0.03);
  }, 311);
  const lat = tile('hy-lattice', 256, 256, (g, gb, w, h, r) => {
    const gl = g.createLinearGradient(0, 0, w, h); gl.addColorStop(0, 'rgb(120,134,146)'); gl.addColorStop(1, 'rgb(84,96,108)');
    g.fillStyle = gl; g.fillRect(0, 0, w, h); gb.fillStyle = 'rgb(90,90,90)'; gb.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgb(226,228,226)'; g.lineWidth = 7; gb.strokeStyle = 'rgb(240,240,240)'; gb.lineWidth = 8;
    for (const c2 of [g, gb]) {
      for (let k = 0; k <= 2; k++) { c2.beginPath(); c2.moveTo(0, k * h / 2); c2.lineTo(w, k * h / 2); c2.stroke(); c2.beginPath(); c2.moveTo(k * w / 2, 0); c2.lineTo(k * w / 2, h); c2.stroke(); }
      c2.beginPath(); c2.moveTo(0, 0); c2.lineTo(w, h); c2.stroke(); c2.beginPath(); c2.moveTo(0, h / 2); c2.lineTo(w / 2, h); c2.stroke(); c2.beginPath(); c2.moveTo(w / 2, 0); c2.lineTo(w, h / 2); c2.stroke();
    }
  }, 312);
  const ves = { metal: 0.75, rough: 0.32 };
  _M = {
    t: { t30, t10, t35, t15, t50, t55, tSp, tShop, tShedB, shell, pave },
    g30: facadeMat('hy-30', t30, { rough: 0.16, metal: 0.15, bump: 0.8 }),
    g10: facadeMat('hy-10', t10, { rough: 0.16, metal: 0.15, bump: 0.8 }),
    g35: facadeMat('hy-35', t35, { rough: 0.3, metal: 0.08, bump: 1.2 }),
    g15: facadeMat('hy-15', t15, { rough: 0.16, metal: 0.15, bump: 0.8 }),
    g50: facadeMat('hy-50', t50, { rough: 0.2, metal: 0.12, bump: 1.0 }),
    g55: facadeMat('hy-55', t55, { rough: 0.2, metal: 0.18, bump: 1.0 }),
    gSp: facadeMat('hy-sp', tSp, { rough: 0.18, metal: 0.12, bump: 0.9 }),
    gShop: facadeMat('hy-shops', tShop, { rough: 0.3, metal: 0.1, bump: 1.0 }),
    gShed: facadeMat('hy-shed', tShedB, { rough: 0.2, metal: 0.12, bump: 0.9 }),
    shell: facadeMat('hy-shell', shell, { rough: 0.45, metal: 0.05, bump: 1.6 }),
    pave: facadeMat('hy-pave', pave, { rough: 0.85, bump: 1.0 }),
    lattice: facadeMat('hy-lattice', lat, { rough: 0.15, metal: 0.25, bump: 1.0 }),
    roof: mat(0xb9b8b2, { rough: 0.85, flat: false }),
    deck: mat(0x8f8d88, { rough: 0.9, flat: false }),
    coping: mat(0xd2d4d4, { rough: 0.5, metal: 0.3, flat: false }),
    plant: mat(0x9a9ea0, { rough: 0.6, metal: 0.3, flat: false }),
    dark: mat(0x23272b, { rough: 0.6, flat: false }),
    stone: mat(0xd8d2c4, { rough: 0.7, flat: false }),
    steel: mat(0xc8ccd0, { rough: 0.4, metal: 0.6, flat: false }),
    crown: mat(0xb8c4cc, { rough: 0.12, metal: 0.35, flat: false }),
    copper: mat(0xa3653f, { rough: ves.rough, metal: ves.metal, flat: false }),
    copperDk: mat(0x7c4a2e, { rough: 0.45, metal: 0.6, flat: false }),
    steps: mat(0xbcb6aa, { rough: 0.8, flat: false }),
    soil: mat(0x4c5a34, { rough: 0.95, flat: false }),
    leaf: mat(0x48612f, { rough: 0.9, flat: true }),
    leaf2: mat(0x5b7238, { rough: 0.9, flat: true }),
    bark: mat(0x4a3f34, { rough: 0.9, flat: false }),
    granite: mat(0x9c9890, { rough: 0.8, flat: false }),
    glassRail: mat(0x9fb4bc, { rough: 0.1, metal: 0.3, flat: false }),
    pool: mat(0x4fa3b8, { rough: 0.08, metal: 0.1, flat: false }),
  };
  return _M;
}

/* ---------------------------------------------------------------- tower kit */
// walls of a plan between y0 and y1, whole bays per face, the tile's floors counted from vRef (site coordinates)
function walls(acc, Pl, y0, y1, t, bay, floor, vRef = 0) { taperWalls(acc, Pl, Pl, y0, y1, bay, floor, vRef, t.nx, t.ny); }
// a tapered piece: plan A at y0 to plan B at y1 (same vertex count), the bay count of each face fixed at A
function taper(acc, A, B, y0, y1, t, bay, floor, vRef = 0) { taperWalls(acc, A, B, y0, y1, bay, floor, vRef, t.nx, t.ny, bayCounts(A, bay)); }
// a flat roof with its parapet: deck, the parapet's faces and its coping, plant on the deck
function roofTop(T, Pl, y, o = {}) {
  const par = o.par ?? 1.2;
  capRing(T.DE, offsetRing(Pl, -0.35), y + 0.02);
  loft(T.CP, Pl, y, [[-0.35, 0], [0, 0], [0, par], [0.06, par], [0.06, par + 0.15], [-0.4, par + 0.15], [-0.4, 0.05]], false);
}
// rooftop plant: cooling towers, louvred screens and boxes on a deck (seeded)
function plantOn(T, cu, cv, hw, hd, y, seed, n = 6) {
  const r = rng(seed);
  for (let k = 0; k < n; k++) {
    const u = cu + (r() - 0.5) * hw * 1.6, v = cv + (r() - 0.5) * hd * 1.6;
    if (r() < 0.4) { cyl(T.PL, u, y, v, 2.2, 2.4, 2.6, 14); cyl(T.DK, u, y + 2.6, v, 1.9, 1.9, 0.05, 14); }
    else box(T.PL, u, y, v, 3 + r() * 5, 1.6 + r() * 1.8, 2.5 + r() * 3, 0);
  }
}
// the soffit and slab edge of a setback
function setback(T, Pl, y) { loft(T.CP, Pl, y - 0.6, [[0, 0], [0.12, 0], [0.12, 0.6], [0, 0.6]], true); }
const accs = () => ({ GL: new Acc(), G2: new Acc(), DE: new Acc(), CP: new Acc(), PL: new Acc(), DK: new Acc(), ST: new Acc(), SL: new Acc(), CR: new Acc(), RF: new Acc(), GR: new Acc(), LT: new Acc(), PO: new Acc() });
function finish(g, T, list, S) {
  for (const [acc] of list) S.apply(acc);
  addMeshes(g, list);
  g.userData.tris = triCount(list);
  return g;
}

/* ===================================================== 30 Hudson Yards and the Shops */
// KPF, 2019. The Shops and Restaurants fill the lot south of the tower to 10 Hudson Yards (seven tall storeys, their glass front
// on the square). 30 Hudson Yards stands in the west half of the north block on the square: the office floors over the whole
// tower plan to the setback, then the crown block over the north-west part, its glass walls rising past the roof to a folded
// glass crown (two latticed triangles along the north-west to south-east diagonal, highest at the north-west corner, 395 m);
// the Edge, the sky deck of the 100th floor, a triangular deck cantilevered out of the crown block's east face over the
// setback. The east half of the block is the tower's lower office wing.
const H30 = { shops: 52, wing: 92, set: 300, top: 352, crown: 387, edge: 335, floor: 4.4, bay: 1.52 };
const P30 = {
  tower: [[-45.0, -79.0], [11.5, -79.0], [11.5, -22.0], [-45.0, -22.0]],
  up: [[-46.0, -77.0], [-8.0, -77.0], [-8.0, -41.0], [-46.0, -41.0]],
  edge: [[-30.0, -41.0], [-8.0, -58.0], [12.0, -37.0]],
  apex: [-27.0, -60.0],
  wing: [[11.5, -79.3], [41.8, -79.5], [68.5, -79.3], [70.0, -76.0], [71.8, -71.7], [65.2, -64.9], [67.2, -38.1], [61.9, -35.1], [61.6, -21.5], [11.5, -21.4]],
};
export function buildHY30(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  // ---- the Shops: the lot to 52 m, glass toward the square, a roof deck with skylights and plant
  walls(T.G2, LOT.shops, 0, H30.shops, M.t.tShop, 3.05, 7.4, 0);
  roofTop(T, LOT.shops, H30.shops, { par: 1.4 });
  for (let k = 0; k < 4; k++) { const v = -5 + k * 18; box(T.CR, -8, H30.shops, v, 26, 1.6, 7, 0); }   // skylight ridges
  plantOn(T, 30, 40, 22, 30, H30.shops, 3001, 10);
  // ---- the east wing of the block (offices) and the tower
  walls(T.GL, P30.wing, 0, H30.wing, M.t.t30, H30.bay, H30.floor, 0);
  roofTop(T, P30.wing, H30.wing, { par: 1.6 });
  plantOn(T, 42, -50, 16, 18, H30.wing, 3004, 8);
  walls(T.GL, P30.tower, 0, H30.set, M.t.t30, H30.bay, H30.floor, 0);
  roofTop(T, P30.tower, H30.set, { par: 2.0 });
  plantOn(T, -4, -30, 10, 4, H30.set, 3002, 4);
  walls(T.GL, P30.up, H30.set, H30.top, M.t.t30, H30.bay, H30.floor, 0);
  setback(T, P30.up, H30.set);
  capRing(T.DE, offsetRing(P30.up, -1.0), H30.top);
  // the crown: north-west corner highest, the ridge to the south-east corner
  // the crown: a glass pyramid over the crown block, its apex north-west of the middle, the south and east faces long
  {
    const y = H30.top + 0.6, Q = P30.up.map(([u, v]) => [u, y, v]), A = [P30.apex[0], H30.crown, P30.apex[1]];
    for (let i = 0; i < 4; i++) latticeTri(T, Q[i], Q[(i + 1) % 4], A);
    loft(T.SL, P30.up, H30.top, [[-0.2, 0], [0.25, 0], [0.25, 0.6], [-0.2, 0.6]], true);
  }
  // the Edge: the deck, its soffit and fascia, the glass walls leaning out
  {
    const yE = H30.edge, tri = P30.edge;
    capRing(T.DE, tri, yE);
    capDown(T.SL, tri, yE - 1.5);
    loft(T.SL, tri, yE - 1.5, [[0, 0], [0.2, 0], [0.2, 1.5], [0, 1.5]], true);
    loft(T.CR, tri, yE, [[0, 0], [0.05, 0], [0.45, 2.7], [0.38, 2.7], [-0.02, 0.05]], true);
  }
  const all = [[T.GL, M.g30, 'lm66:hy30:glass'], [T.G2, M.gShop, 'lm66:hy30:shops'], [T.DE, M.deck, 'lm66:hy30:decks'], [T.CP, M.coping, 'lm66:hy30:copings'],
    [T.PL, M.plant, 'lm66:hy30:plant'], [T.DK, M.dark, 'lm66:hy30:dark'], [T.CR, M.crown, 'lm66:hy30:crown'], [T.SL, M.steel, 'lm66:hy30:steel'], [T.LT, M.lattice, 'lm66:hy30:lattice']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(10, 31, 118, 160, 0, H30.shops), S.col(-16.75, -50.5, 56.5, 57, 0, H30.set), S.col(-29.5, -60, 33, 34, H30.set, H30.top)];
  return g;
}

/* ============================================================ 10 Hudson Yards */
// KPF, 2016: 52 storeys to 268 m at the south-east corner of the yard, over the High Line's spur at 30th Street; a podium of
// offices and shops over the lot, the tower over its middle; the crown a glass prow over the south-east half of the roof, two
// latticed triangles rising from the roof's middle and its north-east and south-west corners to the south-east corner, 273 m.
const H10 = { podium: 31, top: 252, crown: 273, floor: 4.4, bay: 1.52 };
// latticed glass triangles (both faces) and the glass gables under their outer edges
function latticeTri(T, A, B, C) {
  const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
  let nr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const nl = Math.hypot(...nr) || 1; nr = nr.map((x) => x / nl); if (nr[1] < 0) nr = nr.map((x) => -x);
  const uv = (p) => [(p[0] - A[0]) / 7, (p[2] - A[2]) / 7];
  T.LT.tri2(A, B, C, nr, uv(A), uv(B), uv(C));
  ribBar(T.SL, A, B, 0.9, 0.9); ribBar(T.SL, B, C, 0.9, 0.9); ribBar(T.SL, C, A, 0.9, 0.9);
}
function gable(T, y0, a, b) {   // a, b = [u, h, v]: a glass face from y0 up to the slope a-b, both faces, latticed as the prow
  const ex = b[0] - a[0], ez = b[2] - a[2], L = Math.hypot(ex, ez), n = [ez / L, 0, -ex / L];
  const A0 = [a[0], y0, a[2]], B0 = [b[0], y0, b[2]], A1 = [a[0], a[1], a[2]], B1 = [b[0], b[1], b[2]];
  const uA1 = [0, (a[1] - y0) / 6], uB1 = [L / 6, (b[1] - y0) / 6];
  // (where the slope meets y0 the face is a triangle: as a quad with a repeated corner it took its winding from the
  // degenerate half, both copies faced inwards and the south-west gable drew black in the path tracer)
  if (a[1] - y0 < 0.01) T.LT.tri2(A0, B0, B1, n, [0, 0], [L / 6, 0], uB1);
  else if (b[1] - y0 < 0.01) T.LT.tri2(A0, B0, A1, n, [0, 0], [L / 6, 0], uA1);
  else T.LT.quad2(A0, B0, B1, A1, n, [0, 0], [L / 6, 0], uB1, uA1);
  ribBar(T.SL, A0, A1, 0.8, 0.8);
}
export function buildHY10(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  walls(T.G2, LOT.p10, 0, H10.podium, M.t.tShop, 3.05, 7.4, 0);
  roofTop(T, LOT.p10, H10.podium);
  const [u0, u1, v0, v1] = [-22.5, 41.5, 84.0, 132.0], cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  const tw = chamferUV(cu, cv, (u1 - u0) / 2, (v1 - v0) / 2, 2.5);
  walls(T.GL, tw, H10.podium, H10.top, M.t.t10, H10.bay, H10.floor, 0);
  setback(T, tw, H10.podium + 0.6);
  roofTop(T, tw, H10.top, { par: 1.8 });
  plantOn(T, cu - 12, cv - 10, 10, 8, H10.top, 1001, 6);
  // the prow: apex over the south-east corner
  const y = H10.top + 1.8, NE = [u1 - 1, y, v0 + 1], SE = [u1 - 1, H10.crown, v1 - 1], SW = [u0 + 1, y, v1 - 1], C = [cu, y + 2, cv];
  latticeTri(T, NE, SE, C); latticeTri(T, C, SE, SW);
  gable(T, y, NE, SE); gable(T, y, SE, SW);
  const all = [[T.GL, M.g10, 'lm66:hy10:glass'], [T.G2, M.gShop, 'lm66:hy10:podium'], [T.DE, M.deck, 'lm66:hy10:decks'], [T.CP, M.coping, 'lm66:hy10:copings'],
    [T.PL, M.plant, 'lm66:hy10:plant'], [T.DK, M.dark, 'lm66:hy10:dark'], [T.CR, M.crown, 'lm66:hy10:crown'], [T.SL, M.steel, 'lm66:hy10:steel'], [T.LT, M.lattice, 'lm66:hy10:lattice']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(6, 110, 90, 55, 0, H10.podium), S.col(cu, cv, u1 - u0, v1 - v0, H10.podium, H10.top)];
  return g;
}

/* ============================================================ 35 Hudson Yards */
// SOM, 2019: 72 storeys to 308 m, Equinox hotel and homes, on the square's north-west corner: a podium, then a shaft of pale
// stone piers and glass that steps back from the east and the south as it rises (the east face's setbacks at the hotel's top
// and again under the crown), the crown a narrow block with its water tanks.
const H35 = { podium: 18, floor: 3.6, bay: 1.6 };
const T35 = [   // [y0, y1, u0, u1, v0, v1]
  [H35.podium, 118, -172.6, -124.6, -77.6, -22.6],
  [118, 214, -172.6, -132.0, -77.6, -27.5],
  [214, 278, -171.0, -139.5, -76.0, -34.0],
  [278, 296, -167.0, -145.0, -72.0, -42.0],
  [296, 304.8, -163.0, -149.0, -66.0, -48.0],
];
export function buildHY35(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  walls(T.G2, LOT.p35, 0, H35.podium, M.t.tShop, 3.05, 6.0, 0);
  roofTop(T, LOT.p35, H35.podium, { par: 1.1 });
  // the pool deck on the podium's south-west corner
  box(T.PO, -168, H35.podium, -28, 10, 0.15, 5, 0);
  let prev = null;
  for (const [y0, y1, u0, u1, v0, v1] of T35) {
    const Pl = chamferUV((u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2, Math.min(3.5, (u1 - u0) * 0.12));
    walls(T.GL, Pl, y0, y1, M.t.t35, H35.bay, H35.floor, 0);
    if (prev) { roofTop(T, prev, y0, { par: 1.1 }); setback(T, Pl, y0); }
    prev = Pl;
  }
  roofTop(T, prev, 304.8, { par: 1.6 });
  cyl(T.CR, -159, 304.8, -61, 2.4, 2.4, 3.2, 14); cyl(T.CR, -153, 304.8, -61, 2.4, 2.4, 3.2, 14);
  plantOn(T, -156, -53, 4, 4, 304.8, 3501, 2);
  const all = [[T.GL, M.g35, 'lm66:hy35:facade'], [T.G2, M.gShop, 'lm66:hy35:podium'], [T.DE, M.deck, 'lm66:hy35:decks'], [T.CP, M.stone, 'lm66:hy35:copings'],
    [T.PL, M.plant, 'lm66:hy35:plant'], [T.DK, M.dark, 'lm66:hy35:dark'], [T.CR, M.copperDk, 'lm66:hy35:tanks'], [T.PO, M.pool, 'lm66:hy35:pool']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(-148.6, -50.1, 48, 55, 0, 214), S.col(-155.2, -55, 31, 42, 214, 304.8)];
  return g;
}

/* ===================================================== 15 Hudson Yards and The Shed */
// Diller Scofidio + Renfro with Rockwell Group, 2019. 15 Hudson Yards: 70 storeys of homes to 279 m on the square's south-west
// corner, a glass tower whose four corners curve and pinch in at the waist and flare out into the lobed crown. The Shed, fixed
// to its east side along 30th Street: the eight-storey base building, and the shell (a diagonal steel frame quilted with ETFE
// cushions, 37 m high) that rolls on rails over the plaza to the east.
const H15 = { top: 270, crown: 279, floor: 3.25, bay: 1.5 };
// a quatrefoil: a rectangle with rounded corners (radius rr) and a groove of depth gd in the middle of each face
function quatrefoil(cu, cv, hu, hv, rr, gd) {
  const P = [], seg = 5, gw = Math.min(hu, hv) * 0.32;
  const side = (a, b, out) => {     // the groove between a and b (the face's ends), out the face's outward normal
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], d = [(b[0] - a[0]), (b[1] - a[1])], L = Math.hypot(d[0], d[1]); d[0] /= L; d[1] /= L;
    for (const t of [-1, -0.5, 0, 0.5, 1]) { const k = (1 + Math.cos(Math.PI * t)) / 2; P.push([m[0] + d[0] * gw * t - out[0] * gd * k, m[1] + d[1] * gw * t - out[1] * gd * k]); }
  };
  const corners = [[1, -1, -Math.PI / 2], [1, 1, 0], [-1, 1, Math.PI / 2], [-1, -1, Math.PI]];
  const arc = (sx, sz, a0) => { const ccx = cu + sx * (hu - rr), ccz = cv + sz * (hv - rr); const R = []; for (let k = 0; k <= seg; k++) { const a = a0 + (k / seg) * (Math.PI / 2); R.push([ccx + rr * Math.cos(a), ccz + rr * Math.sin(a)]); } return R; };
  const A = corners.map(([sx, sz, a0]) => arc(sx, sz, a0));
  const outs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  for (let i = 0; i < 4; i++) { for (const p of A[i]) P.push(p); const a = A[i][seg], b = A[(i + 1) % 4][0]; side(a, b, outs[i]); }
  return P;
}
const SHED = { base: [-146.6, -106.8, 77.7, 138.7], shell: [-106.8, -63.8, 76.9, 121.2], h: 37.0, baseH: 38.0 };
export function buildHY15(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  // ---- the tower: a quatrefoil plan (rounded corners, a groove down the middle of each face) whose half widths pinch in at
  // the waist and flare out at the crown
  const c = [-159.6, 101.0], HU = 14.4, HV = 24.6;
  const prof = (y) => { const t = y / H15.top; return 1 - 0.06 * Math.sin(Math.PI * Math.min(1, t / 0.78)) + (t > 0.78 ? 0.07 * (t - 0.78) / 0.22 : 0); };
  const plan = (y) => quatrefoil(c[0], c[1], HU * prof(y), HV * prof(y), 6.2 * prof(y), 2.2 * prof(y));
  const nb = bayCounts(plan(0), H15.bay);
  for (let y = 0; y < H15.top - 0.01;) {
    const y1 = Math.min(H15.top, y + 4 * H15.floor * 2);
    taperWalls(T.GL, plan(y), plan(y1), y, y1, H15.bay, H15.floor, 0, M.t.t15.nx, M.t.t15.ny, nb);
    y = y1;
  }
  // the crown: the lobes' glass rising past the roof round a terrace, a light coping on the lobes
  {
    const top = plan(H15.top);
    taperWalls(T.CR, top, scalePlan(top, c[0], c[1], 1.015), H15.top, H15.crown, H15.bay, H15.floor, 0, 4, 4, nb);
    capRing(T.DE, offsetRing(top, -1.0), H15.top + 0.5);
    loft(T.CP, scalePlan(top, c[0], c[1], 1.015), H15.crown, [[-0.7, 0], [0.08, 0], [0.08, 0.5], [-0.7, 0.5]], true);
    plantOn(T, c[0], c[1], 6, 12, H15.top + 0.5, 1501, 4);
  }
  // ---- The Shed: the base building and the shell over the plaza
  {
    const [u0, u1, v0, v1] = SHED.base;
    const B = rectUV(u0, u1, v0, v1);
    walls(T.G2, B, 0, SHED.baseH, M.t.tShedB, 1.5, 4.75, 0);
    roofTop(T, B, SHED.baseH, { par: 1.0 });
    plantOn(T, (u0 + u1) / 2, (v0 + v1) / 2, 14, 20, SHED.baseH, 1502, 6);
    shedShell(T, M, SHED.shell, SHED.h);
  }
  const all = [[T.GL, M.g15, 'lm66:hy15:glass'], [T.G2, M.gShed, 'lm66:shed:base'], [T.CR, M.g15, 'lm66:hy15:crown'], [T.DE, M.deck, 'lm66:hy15:decks'],
    [T.CP, M.coping, 'lm66:hy15:copings'], [T.PL, M.plant, 'lm66:hy15:plant'], [T.DK, M.dark, 'lm66:hy15:dark'], [T.RF, M.shell, 'lm66:shed:shell'], [T.SL, M.steel, 'lm66:shed:frame']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(c[0], c[1], 30, 62, 0, H15.top), S.col(-126.7, 108, 40, 61, 0, SHED.baseH), S.col(-85.3, 99, 43, 44, 0, SHED.h)];
  return g;
}
// the shell: a box with rounded upper edges, the quilt on its faces, the diagonal frame's ribs proud of it, the bogies at the feet
function shedShell(T, M, [u0, u1, v0, v1], h) {
  const R = 4.0, seg = 4, cu = (u0 + u1) / 2;
  // the section across v (east-west walls straight, the roof edge rounded): a profile in (out, up) from the wall foot
  const sec = [];
  for (let k = 0; k <= seg; k++) { const a = (k / seg) * (Math.PI / 2); sec.push([R * (Math.cos(a) - 1), h - R + R * Math.sin(a)]); }
  // the four walls as lofts of the rounded section round the plan (mitred corners); the roof as a cap
  const plan = rectUV(u0, u1, v0, v1);
  const profile = [[0, 0], ...sec];
  for (let k = 0; k + 1 < profile.length; k++) {
    const [d0, y0] = profile[k], [d1, y1] = profile[k + 1];
    const r0 = offsetRing(plan, d0), r1 = offsetRing(plan, d1);
    for (let i = 0; i < 4; i++) {
      const a0 = r0[i], b0 = r0[(i + 1) % 4], a1 = r1[i], b1 = r1[(i + 1) % 4];
      const ex = b0[0] - a0[0], ez = b0[1] - a0[1], L = Math.hypot(ex, ez);
      const s = 1;   // rectUV is counter-clockwise in (u, v) with v south: the outward normal is (ez, -ex) / L
      const dn = Math.hypot(d1 - d0, y1 - y0) || 1, ou = (y1 - y0) / dn, oy = -(d1 - d0) / dn;
      T.RF.quad([a0[0], y0, a0[1]], [b0[0], y0, b0[1]], [b1[0], y1, b1[1]], [a1[0], y1, a1[1]], [s * ez / L * ou, oy, -s * ex / L * ou],
        [0, y0 / 9], [L / 9, y0 / 9], [L / 9, y1 / 9], [0, y1 / 9]);
    }
  }
  capRing(T.RF, offsetRing(plan, -R), h, 1 / 9);
  // the frame: diagonal ribs on the long faces and the roof, a sill beam, the bogies
  for (const [a, b, out] of [[[u0, v0], [u1, v0], [0, -1]], [[u1, v1], [u0, v1], [0, 1]]]) {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), du = (b[0] - a[0]) / L, dv = (b[1] - a[1]) / L, nr = Math.round(L / 6);
    for (let k = -2; k <= nr + 2; k++) for (const sg of [-1, 1]) {
      const s0 = k * 6, s1 = s0 + sg * (h - R);
      const c0 = Math.max(0, Math.min(L, s0)), c1 = Math.max(0, Math.min(L, s1));
      if (Math.abs(c1 - c0) < 0.5) continue;
      const y0 = Math.abs(c0 - s0), y1 = Math.abs(c1 - s0);
      const p0 = [a[0] + du * c0 + out[0] * 0.25, a[1] + dv * c0 + out[1] * 0.25], p1 = [a[0] + du * c1 + out[0] * 0.25, a[1] + dv * c1 + out[1] * 0.25];
      ribBar(T.SL, [p0[0], y0, p0[1]], [p1[0], y1, p1[1]], 0.35, 0.3);
    }
  }
  loft(T.SL, rectUV(u0, u1, v0, v1), 0, [[0, 0], [0.45, 0], [0.45, 1.6], [0, 1.6]], true);
  for (const v of [v0 + 3, (v0 + v1) / 2, v1 - 3]) for (const u of [u0, u1]) box(T.DK, u, 0, v, 1.6, 1.4, 4.2, 0);
}
// a square bar between two points
function ribBar(acc, a, b, w, d) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], L = Math.hypot(dx, dy, dz);
  if (L < 0.05) return;
  const geo = new THREE.BoxGeometry(w, L, d);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / L, dy / L, dz / L));
  const m4 = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1));
  acc.addGeo(geo, m4); geo.dispose();
}

/* ============================================================ 50 Hudson Yards */
// Foster + Partners, 2022: 58 storeys to 308 m on the whole block between 33rd and 34th Streets, floors of 7,000 m2 at the base;
// the white fins of the curtain wall over dark glass, setbacks on the west and the north at 150 m and 230 m, a plant floor.
const H50 = { top: 308, floor: 4.6, bay: 1.52 };
export function buildHY50(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  const tiers = [[0, 150, -37.5, 68.5, -152.8, -97.6], [150, 232, -27.0, 68.5, -147.0, -97.6], [232, H50.top, -15.0, 68.5, -140.0, -97.6]];
  let prev = null;
  for (const [y0, y1, u0, u1, v0, v1] of tiers) {
    const Pl = chamferUV((u0 + u1) / 2, (v0 + v1) / 2, (u1 - u0) / 2, (v1 - v0) / 2, 2.5);
    walls(T.GL, Pl, y0, y1, M.t.t50, H50.bay, H50.floor, 0);
    if (prev) { roofTop(T, prev, y0, { par: 1.2 }); setback(T, Pl, y0); }
    prev = Pl;
  }
  roofTop(T, prev, H50.top, { par: 3.0 });
  cyl(T.CR, 30, H50.top, -118, 4.2, 4.2, 5, 18); cyl(T.CR, 42, H50.top, -118, 4.2, 4.2, 5, 18);
  plantOn(T, 28, -125, 18, 10, H50.top, 5001, 8);
  const all = [[T.GL, M.g50, 'lm66:hy50:glass'], [T.DE, M.deck, 'lm66:hy50:decks'], [T.CP, M.coping, 'lm66:hy50:copings'], [T.PL, M.plant, 'lm66:hy50:plant'],
    [T.DK, M.dark, 'lm66:hy50:dark'], [T.CR, M.copperDk, 'lm66:hy50:tanks']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(15.5, -125.2, 106, 55, 0, H50.top)];
  return g;
}

/* ============================================================ 55 Hudson Yards */
// Kohn Pedersen Fox with Kevin Roche, 2018: 51 storeys to 237 m; a dark tower of bronze-black fins whose east and west faces
// step back at the 18th and the 35th floors.
const H55 = { top: 237.4, floor: 4.4, bay: 1.52 };
export function buildHY55(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  const tiers = [[0, 80, -173.5, -113.5, -153.6, -98.6], [80, 158, -168.0, -119.0, -153.6, -98.6], [158, H55.top, -162.0, -125.0, -150.0, -102.0]];
  let prev = null;
  for (const [y0, y1, u0, u1, v0, v1] of tiers) {
    const Pl = rectUV(u0, u1, v0, v1);
    walls(T.GL, Pl, y0, y1, M.t.t55, H55.bay, H55.floor, 0);
    if (prev) { roofTop(T, prev, y0, { par: 1.1 }); setback(T, Pl, y0); }
    prev = Pl;
  }
  roofTop(T, prev, H55.top, { par: 2.5 });
  plantOn(T, -143.5, -126, 10, 14, H55.top, 5501, 7);
  const all = [[T.GL, M.g55, 'lm66:hy55:glass'], [T.DE, M.deck, 'lm66:hy55:decks'], [T.CP, M.dark, 'lm66:hy55:copings'], [T.PL, M.plant, 'lm66:hy55:plant'], [T.DK, M.dark, 'lm66:hy55:dark']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(-143.5, -126.1, 60, 55, 0, H55.top)];
  return g;
}

/* ============================================================== The Spiral */
// Bjarke Ingels Group, 2022: 66 storeys to 314 m between 34th and 35th Streets; terraces planted with trees step back up the
// tower in a spiral, one corner and one face at a time, so the block narrows toward the top.
const HSP = { top: 314, floor: 4.5, bay: 1.52 };
export function buildHYSpiral(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  let u0 = -35.5, u1 = 67.0, v0 = -246.5, v1 = -190.2;
  const cuts = [[0, 'S', 6], [62, 'W', 8], [95, 'N', 5], [128, 'E', 7], [160, 'S', 5], [190, 'W', 7], [218, 'N', 5], [244, 'E', 6], [268, 'S', 4], [290, 'W', 6]];
  let y = 0;
  const leafAcc = T.SL;
  for (let k = 0; k < cuts.length; k++) {
    const y1 = k + 1 < cuts.length ? cuts[k + 1][0] : HSP.top;
    const Pl = rectUV(u0, u1, v0, v1);
    walls(T.GL, Pl, y, y1, M.t.tSp, HSP.bay, HSP.floor, 0);
    const [, side, d] = k + 1 < cuts.length ? cuts[k + 1] : [0, 'S', 0];
    if (d) {
      // the terrace: the strip the next tier gives up, planted along its edge
      let Q;
      if (side === 'S') { Q = rectUV(u0, u1, v1 - d, v1); v1 -= d; } else if (side === 'N') { Q = rectUV(u0, u1, v0, v0 + d); v0 += d; }
      else if (side === 'E') { Q = rectUV(u1 - d, u1, v0, v1); u1 -= d; } else { Q = rectUV(u0, u0 + d, v0, v1); u0 += d; }
      capRing(T.DE, Q, y1 + 0.05);
      loft(T.CP, Q, y1, [[0, 0], [0.05, 0], [0.05, 1.15], [-0.1, 1.15], [-0.1, 0]], true);
      const r = rng(9100 + k);
      const L = (side === 'S' || side === 'N') ? u1 - u0 : v1 - v0;
      for (let s = 3; s < L - 2; s += 5 + r() * 3) {
        const pu = side === 'S' || side === 'N' ? u0 + s : (side === 'E' ? u1 + d * 0.5 : u0 - d * 0.5);
        const pv = side === 'S' ? v1 + d * 0.5 : side === 'N' ? v0 - d * 0.5 : v0 + s;
        crown(leafAcc, pu, y1 + 1.2, pv, 1.6 + r() * 0.8, 2.4 + r());
      }
    }
    y = y1;
  }
  roofTop(T, rectUV(u0, u1, v0, v1), HSP.top, { par: 3.0 });
  plantOn(T, (u0 + u1) / 2, (v0 + v1) / 2, 14, 8, HSP.top, 9201, 6);
  const all = [[T.GL, M.gSp, 'lm66:spiral:glass'], [T.DE, M.deck, 'lm66:spiral:decks'], [T.CP, M.coping, 'lm66:spiral:rails'], [T.PL, M.plant, 'lm66:spiral:plant'],
    [T.DK, M.dark, 'lm66:spiral:dark'], [T.SL, M.leaf, 'lm66:spiral:trees']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(15.75, -218.4, 102, 56, 0, HSP.top)];
  return g;
}
// a tree crown: a cluster of faceted lobes over a short trunk (the terraces' and the square's trees)
const _ico = new THREE.IcosahedronGeometry(1, 1);
function crown(acc, u, y, v, r, h, trunk = null) {
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const rr = rng(Math.round(u * 13 + v * 7 + y));
  for (let k = 0; k < 3; k++) {
    const a = rr() * Math.PI * 2, d = r * 0.35;
    p.set(u + Math.cos(a) * d, y + h * (0.45 + 0.25 * rr()), v + Math.sin(a) * d);
    s.set(r * (0.75 + rr() * 0.3), h * 0.42, r * (0.75 + rr() * 0.3));
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rr() * 6.28);
    m4.compose(p, q, s); acc.addGeo(_ico, m4);
  }
  if (trunk) cyl(trunk, u, y, v, 0.12, 0.18, h * 0.5, 6);
}

/* ======================================================== the Vessel and the square */
// Heatherwick Studio, 2019: 154 flights of stairs and 80 landings interlocking in a lattice that widens from 15 m at the base
// to 46 m at the top, 46 m high, clad in copper-coloured steel underneath and on the balustrades; the walkable steps pale.
// Here: 16 levels of landings, 12 round each level, each landing joined to the two above it by a flight; each flight a
// channel (its deck, the two balustrades, the soffit), so the copper of the balustrades makes the diamond lattice.
// The Public Square and Gardens round it on the platform over the rail yard: granite paving in long courses, the round
// court of the Vessel, curved planting beds with trees, the low walls of the beds.
export function buildHYVessel(ctx) {
  const S = siteMap(ctx), M = hyMats(), T = accs();
  const g = new THREE.Group();
  const CU = new Acc(), CI = new Acc(), SP = new Acc(), LF = new Acc(), LF2 = new Acc(), BK = new Acc(), PV = new Acc(), SL2 = new Acc(), GR = new Acc();
  const { u: vu, v: vv, r0, r1, H, lv, n } = VES;
  const hL = H / lv, rad = (y) => r0 + (r1 - r0) * (1 - Math.pow(1 - y / H, 1.35));
  const at = (k, j) => { const th = (2 * Math.PI * (j + 0.5 * (k % 2))) / n, y = k * hL, r = rad(y); return [vu + r * Math.cos(th), y, vv + r * Math.sin(th), th]; };
  const W = 2.0, RAIL = 1.1, SOF = 1.05;
  // a flight from landing a to landing b: the deck, the outer and inner balustrades, the soffit
  const flight = (a, b) => {
    const dx = b[0] - a[0], dz = b[2] - a[2], L = Math.hypot(dx, dz);
    const wx = -dz / L * W / 2, wz = dx / L * W / 2;   // the width across the run, horizontal
    const o = (p, s, dy) => [p[0] + wx * s, p[1] + dy, p[2] + wz * s];
    // which side faces out (away from the axis)
    const mx = (a[0] + b[0]) / 2 - vu, mz = (a[2] + b[2]) / 2 - vv, out = (wx * mx + wz * mz) > 0 ? 1 : -1;
    const nOut = [wx * out / (W / 2), 0, wz * out / (W / 2)];
    // the deck (stepped look by its texture rows) and the soffit
    SP.quad(o(a, -1, 0), o(b, -1, 0), o(b, 1, 0), o(a, 1, 0), [0, 1, 0], [0, 0], [L / 1.5, 0], [L / 1.5, 1], [0, 1]);
    CU.quad(o(a, -1, -SOF), o(b, -1, -SOF), o(b, 1, -SOF), o(a, 1, -SOF), [0, -1, 0]);
    for (const s of [-1, 1]) {
      const n0 = s === out ? nOut : nOut.map((x) => -x);
      // the balustrade's outer skin (copper) from the soffit to the rail, its inner face toward the steps
      (s === out ? CU : CI).quad(o(a, s, -SOF), o(b, s, -SOF), o(b, s, RAIL), o(a, s, RAIL), n0);
      CI.quad(o(a, s * 0.8, 0), o(b, s * 0.8, 0), o(b, s * 0.8, RAIL), o(a, s * 0.8, RAIL), n0.map((x) => -x));
      CU.quad(o(a, s, RAIL), o(b, s, RAIL), o(b, s * 0.8, RAIL), o(a, s * 0.8, RAIL), [0, 1, 0]);
    }
  };
  for (let k = 0; k < lv; k++) for (let j = 0; j < n; j++) {
    const a = at(k, j);
    flight(a, at(k + 1, j - (k % 2 === 0 ? 1 : 0)));
    flight(a, at(k + 1, j + (k % 2 === 0 ? 0 : 1)));
  }
  // the landings: a pad at each node with its copper fascia
  for (let k = 1; k <= lv; k++) for (let j = 0; j < n; j++) {
    const [x, y, z, th] = at(k, j), ex = Math.cos(th), ez = Math.sin(th), tx = -ez, tz = ex, hw = 1.3, hd = 1.1;
    const c = (s, t) => [x + tx * s + ex * t, z + tz * s + ez * t];
    const pad = [c(-hw, -hd), c(hw, -hd), c(hw, hd), c(-hw, hd)];
    capRing(SP, pad, y + 0.01, 0.5);
    loft(CU, pad, y - SOF, [[0, 0], [0.04, 0], [0.04, SOF + RAIL], [-0.12, SOF + RAIL], [-0.12, SOF + RAIL - 0.08]], true);
    capDown(CU, pad, y - SOF);
  }
  // the base: a ring of granite round the foot
  lathe(GR, vu, 0, vv, [[r0 + 3.5, 0], [r0 + 3.5, 0.18], [0, 0.18]], 40);
  // ---- the square: paving over the platform, the Vessel's court, the beds and their trees
  {
    const pts = SQUARE;
    const court = []; for (let k = 0; k < 64; k++) { const a = (k / 64) * Math.PI * 2; court.push([vu + 33 * Math.cos(a), vv + 33 * Math.sin(a)]); }
    // beds: curved bands round the court (inner radius, outer radius, from, to in degrees from +u, clockwise with v south)
    const BEDS = [[38, 47, -160, -95], [38, 47, -80, -20], [38, 48, 15, 60], [37, 50, 110, 150], [52, 62, -150, -105], [52, 64, -60, -10], [55, 66, 160, 200]];
    const bedRings = BEDS.map(([ri, ro, a0, a1]) => {
      const R = [], N = Math.max(6, Math.round((a1 - a0) / 6));
      for (let k = 0; k <= N; k++) { const a = ((a0 + (a1 - a0) * k / N) * Math.PI) / 180; R.push([vu + ro * Math.cos(a), vv + ro * Math.sin(a)]); }
      for (let k = N; k >= 0; k--) { const a = ((a0 + (a1 - a0) * k / N) * Math.PI) / 180; R.push([vu + ri * Math.cos(a), vv + ri * Math.sin(a)]); }
      return R;
    });
    const inside = (R, u, v) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [ui, vi] = R[i], [uj, vj] = R[j]; if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) c = !c; } return c; };
    const beds = bedRings.filter((R) => R.every(([u, v]) => inside(pts, u, v)));
    capHoles(PV, pts, [court, ...beds], 0.12, 1 / 8);
    capHoles(PV, court, [], 0.13, 1 / 6);
    // the platform's edge: a fascia down to the street where the square meets it
    loft(GR, pts, -3.0, [[0, 0], [0.02, 0], [0.02, 3.12], [0, 3.12]], true);
    for (const R of beds) {
      loft(GR, R, 0.12, [[0, 0], [0.04, 0], [0.04, 0.55], [-0.35, 0.55], [-0.35, 0.45]], true);
      capRing(SL2, offsetRing(R, -0.35), 0.62, 0.2);
      // trees along the bed
      const r = rng(Math.round(R[0][0] * 31 + R[0][1] * 17));
      for (let i = 1; i + 1 < R.length / 2; i += 2) {
        const a = R[i], b = R[R.length - 1 - i], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        crown(r() < 0.5 ? LF : LF2, m[0] + (r() - 0.5), 0.62, m[1] + (r() - 0.5), 2.3 + r() * 0.9, 6.5 + r() * 2.5, BK);
      }
    }
    // the rows of trees along the square's east edge and the north (33rd Street)
    const r = rng(77);
    for (let v = -74; v < 64; v += 9) crown(r() < 0.5 ? LF : LF2, -55, 0.12, v, 2.4 + r() * 0.6, 7 + r() * 2, BK);
    for (let u = -115; u < -55; u += 9) crown(r() < 0.5 ? LF : LF2, u, 0.12, -75.5, 2.4 + r() * 0.6, 7 + r() * 2, BK);
  }
  const all = [[CU, M.copper, 'lm66:vessel:copper'], [CI, M.copperDk, 'lm66:vessel:inner'], [SP, M.steps, 'lm66:vessel:steps'], [GR, M.granite, 'lm66:square:granite'],
    [PV, M.pave, 'lm66:square:paving'], [SL2, M.soil, 'lm66:square:beds'], [LF, M.leaf, 'lm66:square:trees'], [LF2, M.leaf2, 'lm66:square:trees2'], [BK, M.bark, 'lm66:square:trunks']];
  finish(g, T, all, S);
  g.userData.colliderBoxes = [S.col(vu, vv, 34, 34, 0, H)];
  return g;
}

// a compiled footprint another builder draws (the sliver inside the Vessel's ring)
export function buildHYNone() { const g = new THREE.Group(); g.userData.colliderBoxes = []; return g; }
