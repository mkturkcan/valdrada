// lmMid2.js: landmarks on their compiled footprint rings (LM66, 2026-11-01), the box builders' successors.
//   buildFlatiron: Burnham, 1902. The triangle of the ring in three parts: a rusticated limestone base of four storeys with the
//     shop windows, a shaft of cream terracotta in window pairs between piers, the arcaded crown under the deep cornice, and the
//     set-back storey of 1905 on the roof.
//   buildUNSecretariat: Harrison and Abramovitz with Le Corbusier and Niemeyer, 1952. The slab of the ring: its long faces a
//     green-tinted curtain wall with aluminium mullions and three louvred mechanical floors, its short faces white marble without
//     an opening, a low glazed lobby, and the grille that screens the roof plant.
//   buildGothic: a Gothic church on its ring (aisles, a clerestoried nave and transept under slate, the front's towers with
//     spires or stumps, a fleche or a low dome over the crossing): St. Patrick's Cathedral and St. John the Divine.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, wallRing, capRing, loft, lathe, facadeTex, facadeMat, punchedPainter, offsetRing, ringOutSign, addMeshes, triCount, rgbs, speckle, streaks } from './lmFacadeKit.js';
import { UN_REF, UN_POLYS } from './lmUNData.js';

const { mat } = KIT;
const ringOf = (ctx, w, d) => (ctx.footprint && ctx.footprint.length >= 3 ? ctx.footprint
  : [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]);
const centre = (ring) => { let x = 0, z = 0; for (const [a, b] of ring) { x += a; z += b; } return [x / ring.length, z / ring.length]; };

/* ------------------------------------------------------------- the Flatiron */
// the crown's cells: an arcade of round-headed windows in pairs, terracotta spandrels with a wreath, a frieze band under it
function fiCrownPainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.wall, 1 + (r() - 0.5) * 0.06); g.fillRect(x, y, w, h);
    speckle(g, x, y, w, h, r, 30, 0.05);
    const pw = w * 0.16;                                                  // the pier between the arches, proud
    g.fillStyle = rgbs(o.wall, 1.05); g.fillRect(x, y, pw / 2, h); g.fillRect(x + w - pw / 2, y, pw / 2, h);
    gb.fillStyle = 'rgb(170,170,170)'; gb.fillRect(x, y, pw / 2, h); gb.fillRect(x + w - pw / 2, y, pw / 2, h);
    const aw = (w - pw) * 0.42, ah = h * 0.62, ay = y + h * 0.28;
    for (const k of [0, 1]) {
      const ax = x + pw / 2 + (w - pw) * (k ? 0.54 : 0.04);
      const path = (c) => { c.beginPath(); c.moveTo(ax, ay + ah); c.lineTo(ax, ay + aw / 2); c.arc(ax + aw / 2, ay + aw / 2, aw / 2, Math.PI, 0); c.lineTo(ax + aw, ay + ah); c.closePath(); };
      g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.3); path(g); g.fill();
      gb.fillStyle = 'rgb(76,76,76)'; path(gb); gb.fill();
      g.strokeStyle = rgbs(o.trim); g.lineWidth = Math.max(1, w * 0.018); path(g); g.stroke();
      g.beginPath(); g.moveTo(ax + aw / 2, ay + aw * 0.5); g.lineTo(ax + aw / 2, ay + ah); g.stroke();
    }
    g.fillStyle = rgbs(o.trim, 0.92); g.fillRect(x, y + h * 0.04, w, h * 0.12);   // the frieze, its ornament as a darker run
    gb.fillStyle = 'rgb(162,162,162)'; gb.fillRect(x, y + h * 0.04, w, h * 0.12);
    for (let q = 0; q < 6; q++) { g.fillStyle = rgbs(o.wall, 0.82); g.fillRect(x + (q + 0.3) * w / 6, y + h * 0.07, w / 14, h * 0.06); }
    streaks(g, x, y, w, h, r, 3, 0.05);
  };
}
let _FI = null;
function fiMats() {
  if (_FI) return _FI;
  const TC = [214, 204, 182], LIME = [200, 192, 176], TRIM = [226, 218, 198], GL = [40, 48, 56];
  const base = facadeTex('fi-base', { nx: 4, ny: 4, cw: 120, ch: 120, seed: 81, base: LIME,
    paint: punchedPainter({ wall: LIME, trim: TRIM, win: [0.5, 0.56], winY: 0.2, bars: 'dh', brick: 0, rustic: 13, tone: 0.04, glass: GL }) });
  const shaft = facadeTex('fi-shaft', { nx: 4, ny: 4, cw: 110, ch: 110, seed: 82, base: TC,
    paint: punchedPainter({ wall: TC, trim: TRIM, win: [0.62, 0.6], winY: 0.2, bars: 'dh', brick: 0, pair: 1, tone: 0.035, glass: GL, sillH: 0.04, lintelH: 0.07 }) });
  const crown = facadeTex('fi-crown', { nx: 4, ny: 2, cw: 120, ch: 150, seed: 83, base: TC, paint: fiCrownPainter({ wall: TC, trim: TRIM, glass: GL }) });
  _FI = {
    tx: { base, shaft, crown },
    base: facadeMat('fi-base', base, { rough: 0.85, bump: 2.2 }),
    shaft: facadeMat('fi-shaft', shaft, { rough: 0.7, bump: 1.8 }),
    crown: facadeMat('fi-crown', crown, { rough: 0.72, bump: 2.0 }),
    stone: mat(0xd8cfbc, { rough: 0.78, flat: false }),
    roof: mat(0x5d5e5c, { rough: 0.9, flat: false }),
    shop: mat(0x2a3138, { rough: 0.15, metal: 0.4, flat: false }),
  };
  return _FI;
}
export function buildFlatiron(ctx) {
  const ring = ringOf(ctx, 25, 60), H = ctx.height || 87;
  const M = fiMats();
  const g = new THREE.Group();
  const B = new Acc(), S = new Acc(), C = new Acc(), ST = new Acc(), RF = new Acc(), SH = new Acc();
  const yB = 18.5, yC = H - 12.5, yK = H - 3.8;   // base top (four storeys), crown foot, cornice
  wallRing(B, ring, -0.6, yB, M.tx.base, { bayW: 3.2, floorH: 4.6, vRef: 0 });
  wallRing(S, ring, yB, yC, M.tx.shaft, { bayW: 3.2, floorH: 3.9, vRef: yB });
  wallRing(C, ring, yC, yK, M.tx.crown, { bayW: 3.2, floorH: (yK - yC) / 2, vRef: yC });
  // the shop windows: a dark band set into the base's lowest storey
  loft(SH, offsetRing(ring, 0.02), 0.6, [[0, 0], [0.06, 0], [0.06, 3.4], [0, 3.4]], true);
  // string courses over the base and under the crown, the cornice, the parapet behind it
  loft(ST, ring, yB - 0.4, [[0, 0], [0.3, 0], [0.3, 0.5], [0.5, 0.62], [0.5, 0.9], [0, 0.9]], true);
  loft(ST, ring, yC - 0.3, [[0, 0], [0.25, 0], [0.25, 0.55], [0, 0.55]], true);
  loft(ST, ring, yK, [[0, 0], [0.4, 0], [0.4, 0.3], [0.9, 0.42], [0.9, 0.62], [1.6, 0.9], [1.6, 1.5], [1.25, 1.62], [0, 1.62]], true);
  const par = offsetRing(ring, -0.3);
  wallRing(C, par, yK + 1.62, H, M.tx.crown, { bayW: 3.2, floorH: 2.2, vRef: yK });
  capRing(RF, par, H);
  // the 1905 storey, set back on the roof
  const pent = offsetRing(ring, -4.2);
  if (pent.length >= 3) {
    wallRing(S, pent, H, H + 3.6, M.tx.shaft, { bayW: 3.2, floorH: 3.6, vRef: H });
    capRing(RF, pent, H + 3.6);
    loft(ST, pent, H + 3.6, [[0, 0], [0.2, 0], [0.2, 0.3], [0, 0.3]], true);
  }
  addMeshes(g, [[B, M.base, 'lm66:flatiron:base'], [S, M.shaft, 'lm66:flatiron:shaft'], [C, M.crown, 'lm66:flatiron:crown'],
    [ST, M.stone, 'lm66:flatiron:courses'], [RF, M.roof, 'lm66:flatiron:roof'], [SH, M.shop, 'lm66:flatiron:shops']]);
  const [cx, cz] = centre(ring);
  g.userData.colliderBoxes = [{ x: cx, y: H / 2, z: cz, w: 20, h: H, d: 40, rotY: 0 }];
  g.userData.tris = triCount([[B], [S], [C], [ST], [RF], [SH]]);
  return g;
}

/* -------------------------------------------------------- the Secretariat */
// a curtain-wall cell (a floor and a bay): blue-green glass, the aluminium mullions every bay, the spandrel band
function unGlassPainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.12); g.fillRect(x, y, w, h);
    const grd = g.createLinearGradient(x, y, x + w, y + h); grd.addColorStop(0, 'rgba(225,240,240,0.16)'); grd.addColorStop(1, 'rgba(225,240,240,0.02)');
    g.fillStyle = grd; g.fillRect(x, y, w, h);
    g.fillStyle = rgbs(o.span, 1 + (r() - 0.5) * 0.08); g.fillRect(x, y + h * 0.7, w, h * 0.3);   // the spandrel glass, darker
    gb.fillStyle = 'rgb(132,132,132)'; gb.fillRect(x, y + h * 0.7, w, h * 0.3);
    g.fillStyle = rgbs(o.alu); gb.fillStyle = 'rgb(176,176,176)';
    g.fillRect(x, y, Math.max(2, w * 0.05), h); gb.fillRect(x, y, Math.max(2, w * 0.05), h);   // the mullion
    g.fillRect(x, y + h * 0.69, w, Math.max(1, h * 0.025)); gb.fillRect(x, y + h * 0.69, w, Math.max(1, h * 0.025));
  };
}
function unLouvrePainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.dark); g.fillRect(x, y, w, h);
    for (let q = 0; q < 12; q++) {
      const yy = y + (q + 0.2) * h / 12;
      g.fillStyle = rgbs(o.alu, 0.9 + (r() - 0.5) * 0.05); g.fillRect(x, yy, w, h / 24);
      gb.fillStyle = 'rgb(176,176,176)'; gb.fillRect(x, yy, w, h / 24);
    }
    g.fillStyle = rgbs(o.alu); g.fillRect(x, y, Math.max(2, w * 0.05), h);
  };
}
function marblePainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.marble, 1 + (r() - 0.5) * 0.05); g.fillRect(x, y, w, h);
    speckle(g, x, y, w, h, r, 40, 0.035);
    g.fillStyle = rgbs(o.marble, 0.9); gb.fillStyle = 'rgb(128,128,128)';
    g.fillRect(x, y + h - 1, w, 1); gb.fillRect(x, y + h - 1, w, 1);              // the slabs' joints
    g.fillRect(x + w - 1, y, 1, h); gb.fillRect(x + w - 1, y, 1, h);
    streaks(g, x, y, w, h, r, 2, 0.03);
  };
}
let _UN = null;
function unMats() {
  if (_UN) return _UN;
  const GL = [74, 112, 104], SP = [44, 70, 66], ALU = [196, 200, 202], MAR = [232, 230, 222];
  const glass = facadeTex('un-glass', { nx: 6, ny: 4, cw: 64, ch: 96, seed: 91, base: GL, paint: unGlassPainter({ glass: GL, span: SP, alu: ALU }) });
  const louvre = facadeTex('un-louvre', { nx: 6, ny: 1, cw: 64, ch: 160, seed: 92, base: [70, 74, 76], paint: unLouvrePainter({ dark: [52, 56, 58], alu: ALU }) });
  const marble = facadeTex('un-marble', { nx: 2, ny: 4, cw: 96, ch: 96, seed: 93, base: MAR, paint: marblePainter({ marble: MAR }) });
  _UN = {
    tx: { glass, louvre, marble },
    glass: facadeMat('un-glass', glass, { rough: 0.12, metal: 0.35, bump: 0.8 }),
    louvre: facadeMat('un-louvre', louvre, { rough: 0.45, metal: 0.5, bump: 1.6 }),
    marble: facadeMat('un-marble', marble, { rough: 0.55, bump: 0.8 }),
    alu: mat(0xc4c8ca, { rough: 0.35, metal: 0.8, flat: false }),
    roof: mat(0x6a6c6c, { rough: 0.9, flat: false }),
    lobby: mat(0x26302f, { rough: 0.1, metal: 0.3, flat: false }),
  };
  return _UN;
}
export function buildUNSecretariat(ctx) {
  const ring = ringOf(ctx, 87, 22), H = ctx.height || 156;
  const M = unMats();
  const g = new THREE.Group();
  const GLA = new Acc(), LOU = new Acc(), MAR = new Acc(), AL = new Acc(), RF = new Acc(), LB = new Acc();
  // which edges are the long faces: anything longer than 40 % of the longest edge
  const n = ring.length, L = (i) => Math.hypot(ring[(i + 1) % n][0] - ring[i][0], ring[(i + 1) % n][1] - ring[i][1]);
  const Lmax = Math.max(...ring.map((_, i) => L(i)));
  const isLong = (i) => L(i) > 0.4 * Lmax;
  const fh = 3.66, yL = 7.0;                         // the storey, the lobby's top
  const mech = [[6, 7], [16, 17], [28, 29]].map(([a, b]) => [yL + (a - 2) * fh, yL + (b - 2) * fh]).filter(([, b]) => b < H - 6);
  // the long faces: glass with the mechanical floors' louvres; the short faces: marble from the lobby to the roof
  let y = yL;
  for (const [a, b] of mech) {
    wallRing(GLA, ring, y, a, M.tx.glass, { bayW: 1.2, floorH: fh, vRef: yL, skip: (i) => !isLong(i) });
    wallRing(LOU, ring, a, b, M.tx.louvre, { bayW: 1.2, floorH: b - a, vRef: a, skip: (i) => !isLong(i) });
    y = b;
  }
  wallRing(GLA, ring, y, H, M.tx.glass, { bayW: 1.2, floorH: fh, vRef: yL, skip: (i) => !isLong(i) });
  wallRing(MAR, ring, yL, H + 0.4, M.tx.marble, { bayW: 1.8, floorH: 2.4, vRef: yL, skip: (i) => isLong(i) });
  // the lobby, set back under the slab, and the slab's soffit edge
  const lob = offsetRing(ring, -2.2);
  loft(LB, lob, -0.4, [[0, 0], [0.05, 0], [0.05, yL + 0.4], [0, yL + 0.4]], true);
  capRing(RF, ring, H);
  loft(AL, ring, H, [[0, 0], [0.12, 0], [0.12, 0.45], [0, 0.45]], true);   // the coping
  // the plant screen on the roof: a grille set in from the long faces, its frame
  const scr = offsetRing(ring, -3.0);
  if (scr.length >= 3) {
    wallRing(LOU, scr, H, H + 9.5, M.tx.louvre, { bayW: 1.2, floorH: 9.5, vRef: H });
    capRing(RF, scr, H + 9.5);
    loft(AL, scr, H + 9.5, [[0, 0], [0.15, 0], [0.15, 0.4], [0, 0.4]], true);
  }
  addMeshes(g, [[GLA, M.glass, 'lm66:un:glass'], [LOU, M.louvre, 'lm66:un:louvres'], [MAR, M.marble, 'lm66:un:marble'],
    [AL, M.alu, 'lm66:un:aluminium'], [RF, M.roof, 'lm66:un:roof'], [LB, M.lobby, 'lm66:un:lobby']]);
  const [cx, cz] = centre(ring);
  g.userData.colliderBoxes = [{ x: cx, y: H / 2, z: cz, w: 87, h: H, d: 22, rotY: 0 }];
  g.userData.tris = triCount([[GLA], [LOU], [MAR], [AL], [RF], [LB]]);
  return g;
}

/* ------------------------------------------------------- the UN's General Assembly and Conference Buildings */
// The city's 3D building model's polygons of BIN 1083872 (lmUNData.js) in the landmark's frame, one material per part: the
// General Assembly's white marble walls (its north front a glass wall), its saddle roof a pale sheet and the dome a grey
// metal; the Conference Building along the river in glass, its roofs grey, the garden on its south wing green. The compiled
// record is one 21.6 m prism over the whole complex (tile 0_7 #4): it drew as a brown box beside the Secretariat.
const GA = { x0: 252, x1: 336, z0: 3590, z1: 3706 }, DOME = [293.8, 3668.3], GARDEN = [333.4, 3756.5];
function polyFace(acc, P, ox, oz, uvOf, ring, up) {
  const m = P.length / 3, pt = (i) => [P[i * 3] + ox, P[i * 3 + 1], P[i * 3 + 2] + oz];
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < m; i++) {
    const a = pt(i), b = pt((i + 1) % m);
    nx += (a[1] - b[1]) * (a[2] + b[2]); ny += (a[2] - b[2]) * (a[0] + b[0]); nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-6 || m < 3) return;
  nx /= L; ny /= L; nz /= L;
  if (up) { if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; } }
  else if (ring) {   // (a wall faces out of the complex's footprint: the point a metre in front of it lies outside)
    let cx = 0, cy = 0, cz = 0; for (let i = 0; i < m; i++) { const q = pt(i); cx += q[0] / m; cy += q[1] / m; cz += q[2] / m; }
    if (inside(ring, cx + nx * 1.0, cz + nz * 1.0) && !inside(ring, cx - nx * 1.0, cz - nz * 1.0)) { nx = -nx; ny = -ny; nz = -nz; }
  }
  const ax = Math.abs(nx), ay = Math.abs(ny), az = Math.abs(nz);
  const to2 = ay >= ax && ay >= az ? (q) => new THREE.Vector2(q[0], q[2]) : ax >= az ? (q) => new THREE.Vector2(q[2], q[1]) : (q) => new THREE.Vector2(q[0], q[1]);
  const Q = []; for (let i = 0; i < m; i++) Q.push(pt(i));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(Q.map(to2), []); } catch (e) { return; }
  const n = [nx, ny, nz];
  for (const [i, j, k] of tris) {
    const a = Q[i], b = Q[j], c = Q[k];
    const ex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], fx = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = [ex[1] * fx[2] - ex[2] * fx[1], ex[2] * fx[0] - ex[0] * fx[2], ex[0] * fx[1] - ex[1] * fx[0]];
    if (cr[0] * nx + cr[1] * ny + cr[2] * nz >= 0) acc.tri(a, b, c, n, uvOf(a, n), uvOf(b, n), uvOf(c, n));
    else acc.tri(a, c, b, n, uvOf(a, n), uvOf(c, n), uvOf(b, n));
  }
}
let _UNC = null;
function uncMats() {
  if (_UNC) return _UNC;
  const M = unMats();
  _UNC = { ...M, gaRoof: mat(0xbebbb3, { rough: 0.75, flat: false }), dome: mat(0x9a9f9b, { rough: 0.5, metal: 0.3, flat: false }),
    roofG: mat(0x8e8d89, { rough: 0.85, flat: false }), garden: mat(0x5f7d45, { rough: 0.95, flat: false }) };
  return _UNC;
}
export function buildUNCampus(ctx) {
  if (ctx.cx === undefined || ctx.cz === undefined) return null;
  const M = uncMats(), g = new THREE.Group();
  const ox = UN_REF[0] - ctx.cx, oz = UN_REF[1] - ctx.cz;
  const ring = ctx.footprint && ctx.footprint.length >= 3 ? ctx.footprint : null;
  const MAR = new Acc(), GLA = new Acc(), GR = new Acc(), DM = new Acc(), RF = new Acc(), GD = new Acc();
  const wallUV = (tex, bayW, floorH) => (q, n) => {   // (u along the wall's horizontal, v up the height, in the texture's cells)
    const hx = -n[2], hz = n[0], hl = Math.hypot(hx, hz) || 1;
    return [((q[0] * hx + q[2] * hz) / hl) / (bayW * tex.nx), q[1] / (floorH * tex.ny)];
  };
  const mUV = wallUV(M.tx.marble, 1.8, 2.4), gUV = wallUV(M.tx.glass, 1.2, 3.66), rUV = (q) => [q[0] * 0.1, q[2] * 0.1];
  for (const [k, P] of UN_POLYS) {
    const m = P.length / 3;
    let wx = 0, wz = 0, ymin = 1e9, ymax = -1e9;
    for (let i = 0; i < m; i++) { wx += (P[i * 3] + UN_REF[0]) / m; wz += (P[i * 3 + 2] + UN_REF[1]) / m; ymin = Math.min(ymin, P[i * 3 + 1]); ymax = Math.max(ymax, P[i * 3 + 1]); }
    const inGA = wx > GA.x0 && wx < GA.x1 && wz > GA.z0 && wz < GA.z1;
    if (k === 'r') {
      const acc = Math.hypot(wx - DOME[0], wz - DOME[1]) < 10 && ymin > 34.4 ? DM : Math.hypot(wx - GARDEN[0], wz - GARDEN[1]) < 3 ? GD : inGA && ymax > 25 ? GR : RF;
      polyFace(acc, P, ox, oz, rUV, ring, true);
    } else {
      // (the General Assembly's walls marble, its north front glass; the Conference Building's glass)
      const glass = !inGA || (ymax > 20 && wz < GA.z0 + 20);
      if (glass) polyFace(GLA, P, ox, oz, gUV, ring, false); else polyFace(MAR, P, ox, oz, mUV, ring, false);
    }
  }
  addMeshes(g, [[MAR, M.marble, 'lm66:uncampus:marble'], [GLA, M.glass, 'lm66:uncampus:glass'], [GR, M.gaRoof, 'lm66:uncampus:roof'],
    [DM, M.dome, 'lm66:uncampus:dome'], [RF, M.roofG, 'lm66:uncampus:roofs'], [GD, M.garden, 'lm66:uncampus:garden']]);
  g.userData.colliderBoxes = [{ x: DOME[0] - ctx.cx + 8, y: 17, z: DOME[1] - ctx.cz, w: 80, h: 34, d: 110, rotY: 0 }];
  g.userData.tris = triCount([[MAR], [GLA], [GR], [DM], [RF], [GD]]);
  return g;
}

/* ------------------------------------------------------- St. Patrick's */
function inside(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
// a bay of the cathedral's marble: a tall pointed lancet with its tracery, the buttress strip at the bay's edge, coursed stone
function spatPainter(o) {
  return (g, gb, x, y, w, h, i, j, r) => {
    g.fillStyle = rgbs(o.marble, 1 + (r() - 0.5) * 0.05); g.fillRect(x, y, w, h);
    speckle(g, x, y, w, h, r, 30, 0.04);
    for (let c = 1; c < 8; c++) { g.fillStyle = rgbs(o.marble, 0.93); g.fillRect(x, y + (c * h) / 8, w, 1); }
    const bw = w * 0.14;                                                   // the buttress, proud
    g.fillStyle = rgbs(o.marble, 1.06); g.fillRect(x, y, bw, h); gb.fillStyle = 'rgb(182,182,182)'; gb.fillRect(x, y, bw, h);
    const lw = w * 0.42, lx = x + bw + (w - bw - lw) / 2, ly = y + h * 0.18, lh = h * 0.7;
    const path = (cx_) => { cx_.beginPath(); cx_.moveTo(lx, ly + lh); cx_.lineTo(lx, ly + lw * 0.6); cx_.quadraticCurveTo(lx, ly, lx + lw / 2, ly - lw * 0.15); cx_.quadraticCurveTo(lx + lw, ly, lx + lw, ly + lw * 0.6); cx_.lineTo(lx + lw, ly + lh); cx_.closePath(); };
    g.fillStyle = rgbs(o.glass, 1 + (r() - 0.5) * 0.25); path(g); g.fill();
    gb.fillStyle = 'rgb(84,84,84)'; path(gb); gb.fill();
    g.strokeStyle = rgbs(o.marble, 0.98); g.lineWidth = Math.max(1, w * 0.02);
    g.beginPath(); g.moveTo(lx + lw / 2, ly + lw * 0.2); g.lineTo(lx + lw / 2, ly + lh); g.stroke();   // the mullion and a transom
    g.beginPath(); g.moveTo(lx, ly + lh * 0.55); g.lineTo(lx + lw, ly + lh * 0.55); g.stroke();
    streaks(g, x, y, w, h, r, 3, 0.05);
  };
}
let _SPA = null;
function spatMats(P = {}) {
  const MAR = P.marble || [226, 222, 210], GL = [52, 58, 72], tk = 'spat-wall-' + MAR.join('-');
  if (_SPA && _SPA[tk]) return _SPA[tk];
  _SPA = _SPA || {};
  const wall = facadeTex(tk, { nx: 4, ny: 2, cw: 96, ch: 200, seed: 101, base: MAR, paint: spatPainter({ marble: MAR, glass: GL }) });
  _SPA[tk] = {
    tx: { wall },
    wall: facadeMat(tk, wall, { rough: 0.6, bump: 2.0 }),
    marble: mat((MAR[0] << 16) | (MAR[1] << 8) | MAR[2], { rough: 0.55, flat: false }),
    slate: mat(0x4f5559, { rough: 0.7, flat: false }),
  };
  return _SPA[tk];
}
// the frame of a long ring: A along its longest walls, S across; u, v measured from the ring's middle
function axisFrame(ring) {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez), t = Math.atan2(ez, ex) * 4;
    sx += L * Math.cos(t); sy += L * Math.sin(t);
  }
  const th = Math.atan2(sy, sx) / 4;
  let A = [Math.cos(th), Math.sin(th)], S = [-Math.sin(th), Math.cos(th)];
  const span = (d) => { let lo = 1e9, hi = -1e9; for (const p of ring) { const s = p[0] * d[0] + p[1] * d[1]; lo = Math.min(lo, s); hi = Math.max(hi, s); } return [lo, hi]; };
  if (span(S)[1] - span(S)[0] > span(A)[1] - span(A)[0]) [A, S] = [S, A];
  const [a0, a1] = span(A), [s0, s1] = span(S), m = [(a0 + a1) / 2, (s0 + s1) / 2];
  const P = (u, v) => [A[0] * (m[0] + u) + S[0] * (m[1] + v), A[1] * (m[0] + u) + S[1] * (m[1] + v)];
  const UV = (p) => [p[0] * A[0] + p[1] * A[1] - m[0], p[0] * S[0] + p[1] * S[1] - m[1]];
  return { A, S, P, UV, hu: (a1 - a0) / 2, hv: (s1 - s0) / 2 };
}
// a gabled roof over a rectangle of the frame (u0..u1 along A, v0..v1 across), its ridge along the longer side
function gableRect(acc, F, u0, u1, v0, v1, yE, yR) {
  const alongA = (u1 - u0) >= (v1 - v0);
  const P3 = (u, v, y) => { const p = F.P(u, v); return [p[0], y, p[1]]; };
  if (alongA) {
    const vm = (v0 + v1) / 2;
    acc.quad(P3(u0, v0, yE), P3(u1, v0, yE), P3(u1, vm, yR), P3(u0, vm, yR), [-F.S[0], 1, -F.S[1]]);
    acc.quad(P3(u0, v1, yE), P3(u1, v1, yE), P3(u1, vm, yR), P3(u0, vm, yR), [F.S[0], 1, F.S[1]]);
    acc.tri(P3(u0, v0, yE), P3(u0, v1, yE), P3(u0, vm, yR), [-F.A[0], 0, -F.A[1]]);
    acc.tri(P3(u1, v0, yE), P3(u1, v1, yE), P3(u1, vm, yR), [F.A[0], 0, F.A[1]]);
  } else {
    const um = (u0 + u1) / 2;
    acc.quad(P3(u0, v0, yE), P3(u0, v1, yE), P3(um, v1, yR), P3(um, v0, yR), [-F.A[0], 1, -F.A[1]]);
    acc.quad(P3(u1, v0, yE), P3(u1, v1, yE), P3(um, v1, yR), P3(um, v0, yR), [F.A[0], 1, F.A[1]]);
    acc.tri(P3(u0, v0, yE), P3(u1, v0, yE), P3(um, v0, yR), [-F.S[0], 0, -F.S[1]]);
    acc.tri(P3(u0, v1, yE), P3(u1, v1, yE), P3(um, v1, yR), [F.S[0], 0, F.S[1]]);
  }
}
const rectOf = (F, u0, u1, v0, v1) => [F.P(u0, v0), F.P(u1, v0), F.P(u1, v1), F.P(u0, v1)];
// a Gothic church on its ring: aisles to yA, a clerestoried nave and transept to yN under slate to the ridge, the front's
// towers (P.towers 2 or 1) to P.towerH with spires to P.spireTop (or flat with corner pinnacles), a fleche or a low dome over
// the crossing. The front is the end of the long axis that is wider (P.front 'wide'), or the more southern one ('south')
function buildGothic(ctx, P) {
  const ring = ringOf(ctx, 100, 40), H = Math.max(P.minH || 30, ctx.height || 42);
  const M = spatMats(P), F = axisFrame(ring);
  const g = new THREE.Group();
  const W = new Acc(), MB = new Acc(), RF = new Acc();
  // the west front: the end of A whose width across is the larger (the towers' front, 38 m), the apse the other
  const widthAt = (u) => { let lo = 1e9, hi = -1e9; for (let i = 0; i < ring.length; i++) { const p = F.UV(ring[i]); if (Math.abs(p[0] - u) < 4) { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); } } return hi - lo; };
  const endZ = (sgn) => F.P(sgn * F.hu, 0)[1];
  const west = P.front === 'south' ? (endZ(-1) >= endZ(1) ? 1 : -1) : (widthAt(-F.hu + 2) >= widthAt(F.hu - 2) ? 1 : -1);   // (+1: the front at the frame's -u end)
  const U = (t) => west * t;                       // t from the west front (-hu) to the apse (+hu) in the frame
  const yA = P.yA ?? 19, yN = P.yN ?? 33, yR = P.yR ?? H + 2;   // the aisles' eaves, the clerestory's, the nave ridge
  wallRing(W, ring, -0.6, yA, M.tx.wall, { bayW: 6.2, floorH: yA / 2, vRef: 0 });
  loft(MB, ring, yA, [[0, 0], [0.35, 0], [0.35, 0.6], [0, 0.6]], true);       // the aisles' parapet
  capRing(RF, offsetRing(ring, -0.3), yA - 0.2);
  // the transept: where the ring is widest across
  let tU = 0, tW = 0;
  for (let t = -F.hu + 18; t < F.hu - 12; t += 1) { const w = widthAt(U(t) * 1); if (w > tW) { tW = w; tU = t; } }
  const nv = P.nv ?? 8.5;                          // the nave's half width
  const naveU0 = -F.hu + 10, naveU1 = F.hu - 6;
  const nave = rectOf(F, Math.min(U(naveU0), U(naveU1)), Math.max(U(naveU0), U(naveU1)), -nv, nv);
  wallRing(W, nave, yA, yN, M.tx.wall, { bayW: 6.2, floorH: (yN - yA), vRef: yA });
  gableRect(RF, F, Math.min(U(naveU0), U(naveU1)), Math.max(U(naveU0), U(naveU1)), -nv, nv, yN, yR);
  const tv = Math.max(nv + 4, tW / 2 - 1);
  const tr = rectOf(F, U(tU) - nv, U(tU) + nv, -tv, tv);
  wallRing(W, tr, yA, yN, M.tx.wall, { bayW: 6.2, floorH: (yN - yA), vRef: yA });
  gableRect(RF, F, U(tU) - nv, U(tU) + nv, -tv, tv, yN, yR);
  // the west towers and their spires (to 100.6 m), pinnacles at the towers' corners and a flèche over the crossing
  const tw = P.towerW ?? 10.5, tH = P.towerH ?? 61;
  for (const s of (P.towers === 1 ? [0] : [-1, 1])) {
    const vC = s * (F.hv - tw / 2 - 1.5), uC = U(-F.hu + tw / 2 + 0.5);
    const tq = rectOf(F, uC - tw / 2, uC + tw / 2, vC - tw / 2, vC + tw / 2);
    wallRing(W, tq, yA, tH, M.tx.wall, { bayW: 5.2, floorH: (tH - yA) / 3, vRef: yA });
    capRing(RF, tq, tH);
    loft(MB, tq, tH, [[0, 0], [0.4, 0], [0.4, 1.2], [0, 1.2]], true);
    const c = F.P(uC, vC);
    if (P.spireTop) lathe(MB, c[0], tH, c[1], [[tw * 0.42, 0], [tw * 0.36, 2.5], [0.25, P.spireTop - tH], [0, P.spireTop - tH]], 8, Math.PI / 8);
    const pinH = P.spireTop ? 7.5 : 9;
    for (const du of [-1, 1]) for (const dv of [-1, 1]) {
      const p = F.P(uC + du * tw * 0.42, vC + dv * tw * 0.42);
      lathe(MB, p[0], tH, p[1], [[P.spireTop ? 0.7 : 1.1, 0], [P.spireTop ? 0.55 : 0.9, 1.5], [0.05, pinH], [0, pinH]], 6);
    }
  }
  const cr = F.P(U(tU), 0);
  if (P.dome) lathe(RF, cr[0], yR - 2, cr[1], [[P.dome, 0], [P.dome * 0.92, P.dome * 0.35], [P.dome * 0.65, P.dome * 0.72], [P.dome * 0.3, P.dome * 0.93], [0, P.dome * 0.98]], 20);
  else lathe(MB, cr[0], yR - 2, cr[1], [[1.4, 0], [1.1, 3], [0.1, 16], [0, 16]], 8);
  // pinnacles along the aisles' parapet, one per buttress
  for (const s of [-1, 1]) for (let t = -F.hu + 16; t < F.hu - 8; t += 6.2) {
    const p = F.P(U(t), s * (F.hv - 0.8));
    if (Math.abs(t - tU) < nv + 2 || !inside(ring, p[0], p[1])) continue;
    lathe(MB, p[0], yA, p[1], [[0.45, 0], [0.35, 1.2], [0.04, 4.2], [0, 4.2]], 6);
  }
  addMeshes(g, [[W, M.wall, `lm66:${P.name}:walls`], [MB, M.marble, `lm66:${P.name}:stone`], [RF, M.slate, `lm66:${P.name}:roof`]]);
  const [cx, cz] = centre(ring);
  g.userData.colliderBoxes = [{ x: cx, y: H / 2, z: cz, w: 40, h: H, d: 100, rotY: 0 }];
  g.userData.tris = triCount([[W], [MB], [RF]]);
  return g;
}
export const buildStPatricks = (ctx) => buildGothic(ctx, { name: 'stpatricks', towers: 2, towerW: 10.5, towerH: 61, spireTop: 100.6 });
// St. John the Divine: the longest nave in the city, the west front's towers unfinished at their stumps, the crossing's low dome
export const buildStJohnDivine = (ctx) => buildGothic(ctx, { name: 'stjohn', towers: 2, towerW: 15, towerH: 62, spireTop: 0, yA: 24, yN: 40, nv: 9.5, dome: 16, minH: 45,
  marble: [206, 198, 182] });
