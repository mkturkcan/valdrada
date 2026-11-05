// lmESB.js: the Empire State Building and the Chrysler Building on their compiled footprint rings (LM64, 2026-10-30).
// The old builders stacked boxes scaled from the footprint's bounding box (and a drum mast); the empire_state diorama looks
// at both from 2 to 5 km through a long lens, where a pixel is about half a metre: what reads is the true massing (the
// setbacks at their floors), the vertical striping of the limestone piers and the steel strips, the crowns.
//   buildEmpireState: Shreve, Lamb and Harmon, 1931. Every tier at the plan and height of the city's 3D building model (DoITT,
//     2014): the five-storey base on the whole lot with the low annex on 33rd Street, the tower's setbacks at the 21st, 25th,
//     30th, 72nd, 81st and 85th floors, the recessed centres of the long faces with their deep piers, the 86th-floor
//     observatory and its fence, the mast's base, the mooring mast (glazed faces between four stepped corner fins), the
//     102nd floor, the cone and the antenna. The faces: Indiana limestone piers between window pairs, a chrome-nickel steel
//     strip beside every window column, cast aluminium spandrels, the window frames in their dark red; at street level the
//     fluted piers, the stainless shopfronts and the marquees.
// Everything is merged per material (lmFacadeKit.js accumulators); materials are the kit's (plain stone and metals) and painted
// canvas tiles with bump, roughness and metalness maps.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, box, cyl, lathe, rng, rgbs, speckle, streaks, ringOutSign, offsetRing, capRing, addMeshes, triCount } from './lmFacadeKit.js';
import { applyLightTrim } from '../world/materials.js';

const { mat } = KIT;
const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ tiles */
// a canvas tile painted three ways at once: the albedo, the bump (140 = flat) and the roughness / metalness (G / B)
const _tiles = new Map();
function tile(key, W, H, paint, seed = 1) {
  let t = _tiles.get(key);
  if (t) return t;
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };
  const ca = mk(), cb = mk(), co = mk();
  const ga = ca.getContext('2d'), gb = cb.getContext('2d'), go = co.getContext('2d');
  gb.fillStyle = 'rgb(140,140,140)'; gb.fillRect(0, 0, W, H);
  go.fillStyle = orm(0.85, 0); go.fillRect(0, 0, W, H);
  paint(ga, gb, go, W, H, rng(seed));
  const tex = (c, srgb) => {
    const x = new THREE.CanvasTexture(c);
    if (srgb) x.colorSpace = THREE.SRGBColorSpace;
    x.wrapS = x.wrapT = THREE.RepeatWrapping; x.anisotropy = 8;
    return x;
  };
  t = { map: tex(ca, true), bump: tex(cb, false), orm: tex(co, false), W, H };
  _tiles.set(key, t);
  return t;
}
const _tm = new Map();
function tileMat(key, t, o = {}) {
  let m = _tm.get(key);
  if (m) return m;
  m = new THREE.MeshStandardMaterial({ map: t.map, bumpMap: t.bump, bumpScale: o.bump ?? 1.4, roughnessMap: t.orm, metalnessMap: t.orm,
    roughness: 1, metalness: 1, color: 0xffffff });
  m.name = key;
  applyLightTrim(m);
  _tm.set(key, m);
  return m;
}
function orm(rough, metal) { return `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`; }
// fill a rect in all three layers: albedo colour, bump level, roughness / metalness
function fill3(ga, gb, go, x, y, w, h, col, bump, rough, metal) {
  if (col) { ga.fillStyle = typeof col === 'string' ? col : rgbs(col); ga.fillRect(x, y, w, h); }
  if (bump !== null && bump !== undefined) { gb.fillStyle = `rgb(${bump},${bump},${bump})`; gb.fillRect(x, y, w, h); }
  if (rough !== null && rough !== undefined) { go.fillStyle = orm(rough, metal || 0); go.fillRect(x, y, w, h); }
}

/* ---------------------------------------------------------------- palette */
const LIME = [200, 186, 173];       // Indiana limestone as it is now: a warm, slightly pink buff grey
const LIME_SH = [178, 165, 153];    // the same in the reveals
const ALU = [86, 78, 76];           // the cast aluminium spandrels, weathered dark
const FRAME = [116, 46, 38];        // the window frames' dark red
const GLASS = [30, 34, 40];
const NIROSTA = { hex: 0xc9ccd0, rough: 0.26, metal: 0.95 };

/* ----------------------------------------------------- ESB facade painters */
// one bay's glazing between two piers: window column A, a narrow limestone pier, window column B; NY floors (row 0 the top).
// A floor cell, from its top: the upper half of the spandrel (0.6 m), the window (2.17 m: a double-hung sash in its red
// frame), the lower spandrel (0.85 m). The steel strips and the narrow pier are geometry over the column edges.
const GZ = { a1: 0.47, b0: 0.53, win: [0.165, 0.765] };
function paintGlaze(ga, gb, go, W, H, r, NY) {
  const fh = H / NY;
  fill3(ga, gb, go, W * GZ.a1, 0, W * (GZ.b0 - GZ.a1), H, [176, 178, 180], 170, 0.3, 0.8);
  for (let j = 0; j < NY; j++) for (const [x0, x1] of [[0, W * GZ.a1], [W * GZ.b0, W]]) {
    const y = j * fh, w = x1 - x0;
    fill3(ga, gb, go, x0, y, w, fh, rgbs(ALU, 1 + (r() - 0.5) * 0.1), 118, 0.5, 0.45);
    for (let k = 1; k < 6; k++) {                       // the spandrel's cast ribs
      const xx = Math.round(x0 + (w * k) / 6);
      ga.fillStyle = rgbs(ALU, 1.22); ga.fillRect(xx - 1, y, 2, fh);
      gb.fillStyle = 'rgb(172,172,172)'; gb.fillRect(xx - 1, y, 2, fh);
    }
    ga.fillStyle = 'rgba(20,16,14,0.35)'; ga.fillRect(x0, y + fh * 0.995 - 2, w, 2);   // the floor joint
    const wy0 = y + fh * GZ.win[0], wy1 = y + fh * GZ.win[1], wx0 = x0 + w * 0.05, wx1 = x1 - w * 0.05;
    fill3(ga, gb, go, wx0, wy0, wx1 - wx0, wy1 - wy0, rgbs(FRAME, 0.9 + r() * 0.2), 132, 0.5, 0);
    const fr = Math.max(2, w * 0.07), mid = wy0 + (wy1 - wy0) * 0.5;
    const k = 0.8 + r() * 0.45, sky = r() < 0.5;
    for (const [py0, py1] of [[wy0 + fr, mid - fr * 0.55], [mid + fr * 0.55, wy1 - fr]]) {
      const gl = ga.createLinearGradient(0, py0, 0, py1);
      gl.addColorStop(0, rgbs(sky ? [74, 84, 96] : [48, 52, 58], k)); gl.addColorStop(1, rgbs(sky ? [38, 42, 48] : GLASS, k));
      ga.fillStyle = gl; ga.fillRect(wx0 + fr, py0, wx1 - wx0 - 2 * fr, py1 - py0);
      fill3(null, gb, go, wx0 + fr, py0, wx1 - wx0 - 2 * fr, py1 - py0, null, 70, 0.07, 0);
    }
    const b = r();                                      // blinds in about a third of the windows, a curtain in a few
    if (b < 0.2) {
      const bh = (wy1 - wy0 - 2 * fr) * (0.12 + r() * 0.62);
      fill3(ga, gb, go, wx0 + fr, wy0 + fr, wx1 - wx0 - 2 * fr, bh, rgbs([168, 158, 140], 0.8 + r() * 0.2), 90, 0.8, 0);
      ga.fillStyle = 'rgba(0,0,0,0.12)';
      for (let q = wy0 + fr + 3; q < wy0 + fr + bh; q += 3) ga.fillRect(wx0 + fr, q, wx1 - wx0 - 2 * fr, 1);
    } else if (b < 0.25) {
      fill3(ga, gb, go, wx0 + fr, wy0 + fr, (wx1 - wx0 - 2 * fr) * 0.4, wy1 - wy0 - 2 * fr, rgbs([170, 150, 120], 0.9), 90, 0.8, 0);
    }
    ga.fillStyle = 'rgba(0,0,0,0.4)'; ga.fillRect(wx0, wy0, wx1 - wx0, Math.max(2, fh * 0.02));   // the head's shadow
    fill3(ga, gb, go, wx0 - 1, wy1, wx1 - wx0 + 2, Math.max(2, fh * 0.02), rgbs(ALU, 1.25), 190, 0.45, 0.5);   // the sill
  }
  streaks(ga, 0, 0, W, H, r, 10, 0.05);
}
// the top of a bay under a setback's coping: the last window, then a pointed aluminium panel over each column; the stone
// round the points (the parapet)
function paintHead(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, LIME, 150, 0.85, 0);
  for (const [x0, x1] of [[0, W * GZ.a1], [W * GZ.b0, W]]) {
    const w = x1 - x0, ya = H * 0.16, yb = H * 0.5;     // the panel's sides run up to yb, its point to ya
    for (const [g, col, bump] of [[ga, rgbs(ALU, 0.92), null], [gb, null, 112]]) {
      g.fillStyle = col || `rgb(${bump},${bump},${bump})`;
      g.beginPath(); g.moveTo(x0 + w * 0.05, H); g.lineTo(x0 + w * 0.05, yb); g.lineTo(x0 + w * 0.5, ya); g.lineTo(x1 - w * 0.05, yb); g.lineTo(x1 - w * 0.05, H); g.closePath(); g.fill();
    }
    go.fillStyle = orm(0.5, 0.45); go.beginPath(); go.moveTo(x0 + w * 0.05, H); go.lineTo(x0 + w * 0.05, yb); go.lineTo(x0 + w * 0.5, ya); go.lineTo(x1 - w * 0.05, yb); go.lineTo(x1 - w * 0.05, H); go.closePath(); go.fill();
    ga.strokeStyle = rgbs(ALU, 1.35); ga.lineWidth = 2;
    for (let k = 1; k < 4; k++) { const xx = x0 + w * (0.05 + 0.9 * k / 4); ga.beginPath(); ga.moveTo(xx, H); ga.lineTo(xx, yb + (ya - yb) * (1 - Math.abs(xx - (x0 + w / 2)) / (w * 0.45))); ga.stroke(); }
    // the last window's top, under the panel
    const wy0 = H * 0.72;
    fill3(ga, gb, go, x0 + w * 0.05, wy0, w * 0.9, H - wy0, rgbs(FRAME, 0.95), 132, 0.5, 0);
    fill3(ga, gb, go, x0 + w * 0.12, wy0 + H * 0.05, w * 0.76, H - wy0 - H * 0.05, rgbs([70, 82, 96], 0.9 + r() * 0.2), 70, 0.07, 0);
  }
  speckle(ga, 0, 0, W, H * 0.2, r, 60, 0.05);
}
// the base above the shopfronts, one bay's glazing (5.4 m to the coping, 18.6 m): the 2nd floor's tall windows, the 3rd to 5th
// floors over reeded limestone spandrels, a band under the parapet; two windows a bay, a fluted narrow pier between them
const BASE_Y0 = 5.4, BASE_H = 19.52;
function paintBase(ga, gb, go, W, H, r) {
  const m = H / BASE_H, Y = (y) => H - (y - BASE_Y0) * m;   // y in metres above the street -> canvas y
  fill3(ga, gb, go, 0, 0, W, H, LIME, 150, 0.85, 0);
  speckle(ga, 0, 0, W, H, r, 900, 0.05);
  const wins = [[6.4, 10.8, 3], [11.8, 14.6, 2], [15.6, 18.4, 2], [19.4, 21.9, 2]];
  for (const [ya, yb, lights] of wins) {
    for (const [x0, x1] of [[W * 0.03, W * 0.44], [W * 0.56, W * 0.97]]) {
      const top = Y(yb), bot = Y(ya), w = x1 - x0;
      fill3(ga, gb, go, x0, top, w, bot - top, rgbs(FRAME, 0.9 + r() * 0.15), 120, 0.5, 0);
      const fr = Math.max(2, w * 0.06);
      for (let q = 0; q < lights; q++) {
        const p0 = top + fr + (q * (bot - top - fr)) / lights, p1 = top + ((q + 1) * (bot - top - fr)) / lights;
        const gl = ga.createLinearGradient(0, p0, 0, p1);
        const k = 0.8 + r() * 0.4;
        gl.addColorStop(0, rgbs([92, 104, 118], k)); gl.addColorStop(1, rgbs([46, 52, 60], k));
        ga.fillStyle = gl; ga.fillRect(x0 + fr, p0, w - 2 * fr, p1 - p0 - fr * 0.6);
        fill3(null, gb, go, x0 + fr, p0, w - 2 * fr, p1 - p0 - fr * 0.6, null, 68, 0.07, 0);
      }
      ga.fillStyle = 'rgba(0,0,0,0.35)'; ga.fillRect(x0, top, w, 3);
    }
    // the reeded spandrel under each window row
    if (ya > 7) {
      const sTop = Y(ya), sBot = Y(ya - 1.0);
      for (const [x0, x1] of [[W * 0.03, W * 0.44], [W * 0.56, W * 0.97]]) {
        fill3(ga, gb, go, x0, sTop, x1 - x0, sBot - sTop, LIME_SH, 128, 0.85, 0);
        for (let xx = x0 + 3; xx < x1 - 2; xx += 5) { ga.fillStyle = rgbs(LIME, 1.06); ga.fillRect(xx, sTop, 2, sBot - sTop); gb.fillStyle = 'rgb(165,165,165)'; gb.fillRect(xx, sTop, 2, sBot - sTop); }
      }
    }
  }
  // the narrow fluted pier between the two windows
  for (let xx = W * 0.445; xx < W * 0.555; xx += 4) { ga.fillStyle = 'rgba(40,32,24,0.18)'; ga.fillRect(xx, Y(22.2), 1, Y(6.0) - Y(22.2)); gb.fillStyle = 'rgb(110,110,110)'; gb.fillRect(xx, Y(22.2), 1, Y(6.0) - Y(22.2)); }
  // the band under the parapet, and the belt over the shopfronts
  fill3(ga, gb, go, 0, Y(23.0), W, Y(22.2) - Y(23.0), rgbs(LIME, 1.04), 175, 0.85, 0);
  ga.fillStyle = 'rgba(0,0,0,0.25)'; ga.fillRect(0, Y(22.2), W, 2);
  fill3(ga, gb, go, 0, Y(6.3), W, Y(5.4) - Y(6.3), rgbs(LIME, 0.9), 160, 0.85, 0);
  ga.fillStyle = 'rgba(60,56,48,0.25)'; ga.fillRect(0, Y(6.0), W, Y(5.4) - Y(6.0));
  streaks(ga, 0, 0, W, H, r, 14, 0.06);
}
// the shopfronts (street to 5.4 m, one 5.3 m module): black granite base, display glass in stainless frames, a black louvred
// transom, the stainless fascia with its ribs; the pilaster at the module's edge
function paintStore(ga, gb, go, W, H, r) {
  const m = H / 5.7, Y = (y) => H - (y + 0.3) * m;
  fill3(ga, gb, go, 0, Y(0.5), W, Y(-0.3) - Y(0.5), [26, 26, 28], 140, 0.2, 0);
  const gl = ga.createLinearGradient(0, Y(4.0), 0, Y(0.5));
  gl.addColorStop(0, 'rgb(70,78,86)'); gl.addColorStop(0.5, 'rgb(96,90,82)'); gl.addColorStop(1, 'rgb(52,50,48)');
  ga.fillStyle = gl; ga.fillRect(0, Y(4.0), W, Y(0.5) - Y(4.0));
  fill3(null, gb, go, 0, Y(4.0), W, Y(0.5) - Y(4.0), null, 90, 0.06, 0);
  for (let q = 0; q < 6; q++) { ga.fillStyle = `rgba(255,236,200,${(0.05 + r() * 0.12).toFixed(3)})`; ga.fillRect(r() * W, Y(3.4), W * (0.1 + r() * 0.2), Y(0.8) - Y(3.4)); }   // the lit shops inside
  fill3(ga, gb, go, 0, Y(4.8), W, Y(4.0) - Y(4.8), [24, 24, 26], 120, 0.5, 0.2);
  for (let yy = Y(4.8) + 2; yy < Y(4.0); yy += 3) { ga.fillStyle = 'rgba(120,120,124,0.5)'; ga.fillRect(0, yy, W, 1); }
  fill3(ga, gb, go, 0, Y(5.4), W, Y(4.8) - Y(5.4), [196, 199, 202], 170, 0.25, 0.9);
  for (let q = 1; q < 4; q++) { const yy = Y(5.4) + ((Y(4.8) - Y(5.4)) * q) / 4; ga.fillStyle = 'rgba(60,62,66,0.6)'; ga.fillRect(0, yy, W, 1); }
  for (const xf of [0, 0.36, 0.68]) {                    // the stainless mullions and the pilaster
    const w = xf === 0 ? W * 0.05 : W * 0.018;
    fill3(ga, gb, go, xf * W, Y(5.4), w, Y(0.5) - Y(5.4), [200, 203, 206], 180, 0.25, 0.9);
  }
  ga.fillStyle = 'rgba(200,203,206,1)'; ga.fillRect(0, Y(4.0), W, 2);
}
// the base's wide pier: limestone with three flutes at each edge (one tile across the pier, stretched up its height)
function paintFlute(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, LIME, 150, 0.85, 0);
  speckle(ga, 0, 0, W, H, r, 400, 0.05);
  for (const side of [0, 1]) for (let q = 0; q < 3; q++) {
    const x = side ? W - 4 - q * 7 : 2 + q * 7;
    ga.fillStyle = 'rgba(70,60,48,0.30)'; ga.fillRect(x, 0, 2, H); ga.fillStyle = 'rgba(255,250,236,0.22)'; ga.fillRect(x + 2, 0, 2, H);
    gb.fillStyle = 'rgb(96,96,96)'; gb.fillRect(x, 0, 3, H);
  }
  for (let yy = 0; yy < H; yy += Math.round(H / 18)) { ga.fillStyle = 'rgba(60,50,40,0.18)'; ga.fillRect(0, yy, W, 1); }
}
// the mooring mast's glazing: aluminium mullions every 0.92 m and transoms every 1.85 m over dark blue-grey glass
function paintMast(ga, gb, go, W, H, r) {
  const nx = 6, ny = 4, cw = W / nx, ch = H / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = 0.85 + r() * 0.3;
    const gl = ga.createLinearGradient(0, j * ch, 0, (j + 1) * ch);
    gl.addColorStop(0, rgbs([122, 142, 156], k)); gl.addColorStop(1, rgbs([76, 94, 108], k));
    ga.fillStyle = gl; ga.fillRect(i * cw, j * ch, cw, ch);
    fill3(null, gb, go, i * cw, j * ch, cw, ch, null, 80, 0.07, 0);
  }
  for (let i = 0; i <= nx; i++) fill3(ga, gb, go, i * cw - 2, 0, 4, H, [196, 200, 204], 190, 0.3, 0.85);
  for (let j = 0; j <= ny; j++) fill3(ga, gb, go, 0, j * ch - 2, W, 4, [186, 190, 194], 180, 0.3, 0.85);
}
// the 86th floor's enclosure between its piers: a stone band, the observatory's tall windows, the stone over them
function paintObs(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [218, 221, 224], 150, 0.5, 0.2);
  speckle(ga, 0, 0, W, H, r, 500, 0.05);
  const m = H / 8.57, Y = (y) => H - y * m;            // y metres above the deck
  for (const [x0, x1] of [[W * 0.06, W * 0.47], [W * 0.53, W * 0.94]]) {
    fill3(ga, gb, go, x0, Y(5.1), x1 - x0, Y(1.0) - Y(5.1), [150, 152, 156], 140, 0.3, 0.85);
    const fr = 3;
    for (const [a, b] of [[5.0, 3.2], [3.1, 1.1]]) {
      const gl = ga.createLinearGradient(0, Y(a), 0, Y(b));
      gl.addColorStop(0, 'rgb(84,98,112)'); gl.addColorStop(1, 'rgb(34,40,48)');
      ga.fillStyle = gl; ga.fillRect(x0 + fr, Y(a), x1 - x0 - 2 * fr, Y(b) - Y(a));
      fill3(null, gb, go, x0 + fr, Y(a), x1 - x0 - 2 * fr, Y(b) - Y(a), null, 70, 0.07, 0);
    }
  }
  fill3(ga, gb, go, 0, Y(7.2), W, Y(6.4) - Y(7.2), rgbs(LIME, 1.05), 178, 0.85, 0);
}
// the mast's base blocks and the antenna's housings: light grey painted metal in panels
function paintPanel(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [224, 228, 232], 150, 0.45, 0.25);
  for (let yy = 0; yy < H; yy += H / 4) { ga.fillStyle = 'rgba(96,104,114,0.55)'; ga.fillRect(0, yy, W, 3); gb.fillStyle = 'rgb(100,100,100)'; gb.fillRect(0, yy, W, 3); }
  for (let xx = 0; xx < W; xx += W / 4) { ga.fillStyle = 'rgba(80,84,88,0.3)'; ga.fillRect(xx, 0, 2, H); gb.fillStyle = 'rgb(110,110,110)'; gb.fillRect(xx, 0, 2, H); }
  streaks(ga, 0, 0, W, H, r, 20, 0.05);
}
// the fins' face: polished aluminium in stepped feathers (diagonal ribs)
function paintFin(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [230, 233, 236], 150, 0.34, 0.45);
  for (let q = -H; q < W + H; q += 14) {
    for (const [g, s] of [[ga, 'rgba(170,176,184,0.3)'], [gb, 'rgb(104,104,104)']]) {
      g.strokeStyle = s; g.lineWidth = 3; g.beginPath(); g.moveTo(q, H); g.lineTo(q + H * 0.6, 0); g.stroke();
    }
  }
  for (let yy = 0; yy < H; yy += H / 8) { ga.fillStyle = 'rgba(120,126,134,0.35)'; ga.fillRect(0, yy, W, 2); }
}

let _ESB = null;
function esbMats() {
  if (_ESB) return _ESB;
  const stone = { set: 'climestone', amt: 0.35, nrm: 0.5, rgh: 0.3, ashlar: 0.45 };
  const t = {
    glaze: tile('esb-glaze', 192, 1056, (a, b, c, W, H, r) => paintGlaze(a, b, c, W, H, r, 6), 641),
    head: tile('esb-head', 192, 140, paintHead, 642),
    base: tile('esb-base', 192, 744, paintBase, 643),
    store: tile('esb-store', 192, 206, paintStore, 644),
    flute: tile('esb-flute', 48, 512, paintFlute, 645),
    mast: tile('esb-mast', 256, 320, paintMast, 646),
    obs: tile('esb-obs', 192, 300, paintObs, 647),
    panel: tile('esb-panel', 128, 128, paintPanel, 648),
    fin: tile('esb-fin', 128, 256, paintFin, 649),
  };
  _ESB = {
    t,
    glaze: tileMat('lm64:esb:glaze', t.glaze, { bump: 1.2 }),
    head: tileMat('lm64:esb:head', t.head, { bump: 1.2 }),
    base: tileMat('lm64:esb:base', t.base, { bump: 1.6 }),
    store: tileMat('lm64:esb:store', t.store, { bump: 1.0 }),
    flute: tileMat('lm64:esb:flute', t.flute, { bump: 2.0 }),
    mastGlass: tileMat('lm64:esb:mastglass', t.mast, { bump: 1.0 }),
    obs: tileMat('lm64:esb:obs', t.obs, { bump: 1.2 }),
    panel: tileMat('lm64:esb:panel', t.panel, { bump: 1.0 }),
    fin: tileMat('lm64:esb:fin', t.fin, { bump: 1.6 }),
    lime: mat(0xc8baad, { rough: 0.84, flat: false, stone }),
    nickel: mat(NIROSTA.hex, { rough: NIROSTA.rough, metal: NIROSTA.metal, flat: true }),
    alu: mat(0xe6e9ec, { rough: 0.36, metal: 0.45, flat: false }),
    paint: mat(0xe2e5e8, { rough: 0.5, metal: 0.15, flat: true }),
    roof: mat(0xa9746c, { rough: 0.92, flat: true }),          // the setbacks' roofs: a salmon-red membrane
    roofG: mat(0x6f7f4a, { rough: 0.95, flat: true }),         // the green roof on the 21st floor's east terrace
    roofB: mat(0x6a3e38, { rough: 0.9, flat: true }),          // the base's roof, dark red
    panelRoof: mat(0xaeb2b4, { rough: 0.8, flat: true }),      // the mast's base blocks' roofs
    deck: mat(0xb9ada0, { rough: 0.85, flat: true }),          // the observatory deck's paving
    dark: mat(0x1c2026, { rough: 0.35, metal: 0.2, flat: true }),
    antenna: mat(0xdadcdc, { rough: 0.45, metal: 0.4, flat: true }),
  };
  return _ESB;
}

/* ------------------------------------------------------------------ frame */
// the lot in the Manhattan grid: A along the streets toward Fifth Avenue, S toward 33rd Street (both unit vectors in the
// group's xz plane); the tower's axis sits 64.35 m west of the Fifth Avenue line and 29.05 m south of the 34th Street line
// (the DoITT model on the compiled ring). Tower coordinates (x along A, z along S) map to the group by P(x, z).
const GRID = 29.0 * D2R;
function esbFrame(ring) {
  let sx = 0, sy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const t = Math.atan2(ez, ex) * 4; sx += L * Math.cos(t); sy += L * Math.sin(t);
  }
  const g = Math.atan2(sy, sx) / 4;
  let A = null, best = -2;
  for (let k = 0; k < 4; k++) {
    const a = g + (k * Math.PI) / 2, d = [Math.cos(a), Math.sin(a)], dot = d[0] * Math.cos(GRID) + d[1] * Math.sin(GRID);
    if (dot > best) { best = dot; A = d; }
  }
  const S = [-A[1], A[0]];
  const UV = ring.map((p) => [p[0] * A[0] + p[1] * A[1], p[0] * S[0] + p[1] * S[1]]);
  const uE = Math.max(...UV.map((p) => p[0])), vN = Math.min(...UV.map((p) => p[1]));
  const uW = Math.min(...UV.filter((p) => p[1] < vN + 2.5).map((p) => p[0]));
  const vS = Math.max(...UV.filter((p) => p[0] > uE - 2.5).map((p) => p[1]));
  const uC = uE - 64.35, vC = vN + 29.05;
  const ann = UV.filter((p) => p[0] < uW - 1.0);
  const F = {
    A, S, uC, vC,
    P: (x, z) => [A[0] * (uC + x) + S[0] * (vC + z), A[1] * (uC + x) + S[1] * (vC + z)],
    dir: (x, z) => [A[0] * x + S[0] * z, A[1] * x + S[1] * z],
    rot: Math.atan2(-A[1], A[0]),
    lot: [uW - uC, uE - uC, vN - vC, vS - vC],
    annex: ann.length >= 2 ? [Math.min(...ann.map((p) => p[0])) - uC, uW - uC, Math.min(...ann.map((p) => p[1])) - vC, Math.max(...ann.map((p) => p[1])) - vC] : null,
  };
  return F;
}

/* ----------------------------------------------------------- outlines */
const rect = (x0, x1, z0, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
// a closed outline symmetric about both axes from its north-east quarter, q from [0, -zN] to [xE, 0] (x >= 0, z <= 0)
function sym4(q) {
  const se = q.slice().reverse().map(([x, z]) => [x, -z]);
  const sw = q.map(([x, z]) => [-x, -z]);
  const nw = q.slice().reverse().map(([x, z]) => [-x, z]);
  const pts = [...q, ...se.slice(1), ...sw.slice(1), ...nw.slice(1, -1)];
  return clean(pts);
}
function clean(pts) {      // drop repeated and collinear points
  let p = pts.filter((v, i) => { const w = pts[(i + 1) % pts.length]; return Math.hypot(v[0] - w[0], v[1] - w[1]) > 1e-6; });
  for (let pass = 0; pass < 3; pass++) {
    p = p.filter((v, i) => {
      const a = p[(i - 1 + p.length) % p.length], b = p[(i + 1) % p.length];
      return Math.abs((v[0] - a[0]) * (b[1] - a[1]) - (v[1] - a[1]) * (b[0] - a[0])) > 1e-6;
    });
  }
  return p;
}

/* -------------------------------------------------- tower-frame emitters */
function tquad(acc, F, a, b, y0, y1, n, u0, u1, v0, v1) {
  const A = F.P(a[0], a[1]), B = F.P(b[0], b[1]), N = F.dir(n[0], n[1]);
  acc.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], y1, B[1]], [A[0], y1, A[1]], [N[0], 0, N[1]], [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
}
// a box in tower coordinates: centre (x, z), w along the tower direction (dx, dz), d across it
function tbox(acc, F, x, y0, z, w, h, d, dx = 1, dz = 0) {
  const c = F.P(x, z), D = F.dir(dx, dz);
  box(acc, c[0], y0, c[1], w, h, d, Math.atan2(-D[1], D[0]));
}

/* -------------------------------------------------------- the wall model */
// tiers: { ring (tower coords), y0, y1, below (a tier or null), style, skip(edge) }. A wall piece on a tier's edge rises from
// the tier below's top where the same wall continues from there, else from the terrace (1.25 m under that top); it ends
// at the tier's top, with a coping and a parapet where no tier above carries the same wall on.
const TER = 1.25;
function edgesOf(ring) {
  const s = ringOutSign(ring), out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 1e-4) continue;
    const n = [(s * ez) / L, (-s * ex) / L];
    out.push({ i, a, b, L, d: [ex / L, ez / L], n, off: a[0] * n[0] + a[1] * n[1] });
  }
  return out;
}
// the parts of edge e (as [t0, t1] in metres from e.a) that lie on an edge of `ring` facing the same way
function sharedWith(e, ring) {
  if (!ring) return [];
  const out = [];
  for (const f of edgesOf(ring)) {
    if (f.n[0] * e.n[0] + f.n[1] * e.n[1] < 0.999 || Math.abs(f.off - e.off) > 0.03) continue;
    const ta = (f.a[0] - e.a[0]) * e.d[0] + (f.a[1] - e.a[1]) * e.d[1], tb = (f.b[0] - e.a[0]) * e.d[0] + (f.b[1] - e.a[1]) * e.d[1];
    const t0 = Math.max(0, Math.min(ta, tb)), t1 = Math.min(e.L, Math.max(ta, tb));
    if (t1 - t0 > 0.02) out.push([t0, t1]);
  }
  return out;
}
const inAny = (t, iv) => iv.some(([a, b]) => t > a + 1e-3 && t < b - 1e-3);
// a wall line: all the tiers' edges on one plane (facing one way), merged into runs; the bay layout belongs to the run, so a
// face that rises through several tiers keeps its piers in line
function lineKey(n, off) { return `${Math.round(Math.atan2(n[1], n[0]) * 1000)}|${Math.round(off * 20)}`; }
function buildLines(tiers) {
  const L = new Map();
  for (const T of tiers) for (const e of edgesOf(T.ring)) {
    const k = lineKey(e.n, e.off);
    let g = L.get(k);
    if (!g) { g = { n: e.n, off: e.off, t: [-e.n[1], e.n[0]], iv: [] }; L.set(k, g); }
    const ta = e.a[0] * g.t[0] + e.a[1] * g.t[1], tb = e.b[0] * g.t[0] + e.b[1] * g.t[1];
    g.iv.push([Math.min(ta, tb), Math.max(ta, tb)]);
  }
  for (const g of L.values()) {
    g.iv.sort((p, q) => p[0] - q[0]);
    const runs = [];
    for (const v of g.iv) { const r = runs[runs.length - 1]; if (r && v[0] <= r[1] + 0.05) r[1] = Math.max(r[1], v[1]); else runs.push([v[0], v[1]]); }
    g.runs = runs;
  }
  return L;
}

/* ----------------------------------------------------- the ESB's tiers */
function esbTiers(F) {
  const [lx0, lx1, lz0, lz1] = F.lot;
  const T = [];
  const add = (o) => { T.push(o); return o; };
  const base = add({ name: 'base', ring: rect(lx0, lx1, lz0, lz1), y0: 0, y1: 25.22, below: null, style: 'base', roof: 'roofB' });
  if (F.annex) add({ name: 'annex', ring: rect(F.annex[0], F.annex[1], F.annex[2], F.annex[3]), y0: 0, y1: 16.11, below: null, style: 'base', roof: 'roofB',
    skip: (e) => e.n[0] > 0.9 });
  add({ name: 'westRaise', ring: rect(-61.95, -46.85, -14.45, 14.45), y0: 25.22, y1: 25.91, below: base, style: 'plain', roof: 'roofB', skip: (e) => e.n[0] > 0.9 });
  add({ name: 'entrance', ring: clean([[46.85, -14.3], [52.35, -14.3], [52.35, -8.65], [62.95, -8.65], [62.95, 8.65], [52.35, 8.65], [52.35, 14.3], [46.85, 14.3]]),
    y0: 25.22, y1: 26.28, below: base, style: 'plain', roof: 'roofB', skip: (e) => e.n[0] < -0.9 });
  const t2 = add({ name: 't2', ring: sym4([[0, -20.45], [14.05, -20.45], [14.05, -24.95], [35.7, -24.95], [35.7, -20.45], [46.85, -20.45], [46.85, 0]]),
    y0: 25.22, y1: 80.8, below: base, style: 'shaft' });
  const t3 = add({ name: 't3', ring: sym4([[0, -20.45], [14.05, -20.45], [14.05, -24.95], [35.7, -24.95], [35.7, -9.0], [35.0, -9.0], [35.0, 0]]),
    y0: 80.8, y1: 95.49, below: t2, style: 'shaft' });
  const t4 = add({ name: 't4', ring: sym4([[0, -14.0], [8.5, -14.0], [8.5, -20.5], [28.2, -20.5], [28.2, -14.5], [35.0, -14.5], [35.0, 0]]),
    y0: 95.49, y1: 114.93, below: t3, style: 'shaft' });
  const t5 = add({ name: 't5', ring: sym4([[0, -14.0], [8.5, -14.0], [8.5, -20.5], [28.2, -20.5], [28.2, 0]]), y0: 114.93, y1: 266.46, below: t4, style: 'shaft' });
  const t6 = add({ name: 't6', ring: sym4([[0, -14.0], [10.4, -14.0], [10.4, -18.4], [26.25, -18.4], [26.25, 0]]), y0: 266.46, y1: 299.16, below: t5, style: 'shaft' });
  const t7 = add({ name: 't7', ring: sym4([[0, -14.0], [20.05, -14.0], [21.95, -11.9], [21.95, 0]]), y0: 299.16, y1: 315.4, below: t6, style: 'crown', roof: 'deck' });
  const t8 = add({ name: 't8', ring: sym4([[0, -12.8], [19.35, -12.8], [20.75, -11.4], [20.75, 0]]), y0: 315.4, y1: 322.72, below: t7, style: 'obs', roof: 'roof' });
  const t9 = add({ name: 't9', ring: sym4([[0, -10.0], [12.35, -10.0], [12.35, -8.8], [14.5, -8.8], [16.6, -7.4], [16.6, 0]]), y0: 322.72, y1: 327.7, below: t8, style: 'panel', roof: 'panelRoof' });
  add({ name: 't9e', ring: clean([[10.35, -8.8], [14.5, -8.8], [16.6, -7.4], [16.6, 7.4], [14.5, 8.8], [10.35, 8.8]]), y0: 327.7, y1: 331.2, below: t9, style: 'panel', roof: 'panelRoof',
    skip: (e) => e.n[0] < -0.9 });
  const t10 = add({ name: 't10', ring: rect(-10.4, 10.4, -8.75, 8.75), y0: 327.7, y1: 333.4, below: t9, style: 'panel', roof: 'panelRoof' });
  add({ name: 't11', ring: rect(-9.15, 9.15, -7.6, 7.6), y0: 333.4, y1: 336.16, below: t10, style: 'panel', roof: 'panelRoof' });
  return T;
}
// explicit pier runs (tower coords along the line) where the model shows them: the recessed centres' deep piers (and the
// 81st-85th floors' on the same planes), the 86th floor's, the crown's east and west faces
function explicitPiers(n, off) {
  const ax = Math.abs(n[0]) > 0.9 ? 'x' : Math.abs(n[1]) > 0.9 ? 'z' : null;
  const o = Math.abs(off);
  const mir = (lst) => [...lst.map(([a, b]) => [-b, -a]), ...lst];
  if (ax === 'z' && Math.abs(o - 14.0) < 0.05) return { deep: 0.5, piers: mir([[1.15, 4.4], [7.1, 10.35], [14.9, 17.5]]) };
  if (ax === 'z' && Math.abs(o - 12.8) < 0.05) return { deep: 0.4, piers: mir([[1.45, 4.15], [7.35, 9.85], [14.95, 17.45]]) };
  if (ax === 'x' && Math.abs(o - 21.95) < 0.05) return { deep: 0.5, piers: mir([[1.5, 3.9], [6.9, 9.4]]) };
  if (ax === 'x' && Math.abs(o - 20.75) < 0.05) return { deep: 0.3, piers: mir([[1.4, 4.0], [7.1, 9.5]]) };
  return null;
}

/* ------------------------------------------------------ the shaft's faces */
const FLOOR = 3.62, Y6 = 25.22;      // the tower's storey and the 6th floor's level
const PW = 1.5, PP = 0.2;            // the shaft's piers: width, projection
const STRIP = { w: 0.14, p: 0.24 };   // the steel strips: width, projection (a few cm proud of the piers, as they catch the sun)
const DIV = { w: 0.2, p: 0.2 };      // the mullion between a bay's two window columns (steel, like the strips)
const HEAD = 2.3;
function layoutRun(run, pitch, pw) {
  const L = run[1] - run[0], n = Math.max(1, Math.round((L - pw) / pitch)), bay = (L - pw) / n, piers = [];
  for (let k = 0; k <= n; k++) piers.push([run[0] + k * bay, run[0] + k * bay + pw]);
  return piers;
}

/* ------------------------------------------------------- Empire State */
export function buildEmpireState(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = esbFrame(ring);
  const M = esbMats();
  const g = new THREE.Group();
  const acc = {};
  const A = (k) => (acc[k] ||= new Acc());
  const tiers = esbTiers(F);
  const lines = buildLines(tiers);
  const above = (T) => tiers.filter((U) => U.below === T);
  for (const T of tiers) {
    const ups = above(T);
    const E = edgesOf(T.ring), pieces = [];
    for (const e of E) {
      const lk = lines.get(lineKey(e.n, e.off));
      // the edge in its line's coordinate (t along lk.t), and the line's run holding it
      const tA = e.a[0] * lk.t[0] + e.a[1] * lk.t[1], tB = e.b[0] * lk.t[0] + e.b[1] * lk.t[1];
      const run = lk.runs.find((r) => Math.min(tA, tB) >= r[0] - 0.06 && Math.max(tA, tB) <= r[1] + 0.06) || [Math.min(tA, tB), Math.max(tA, tB)];
      // split the edge where walls continue from below / on above
      const fromB = sharedWith(e, T.below && T.below.ring), toU = ups.flatMap((U) => sharedWith(e, U.ring));
      const cuts = new Set([0, e.L]);
      for (const [a, b] of [...fromB, ...toU]) { cuts.add(a); cuts.add(b); }
      const cs = [...cuts].sort((p, q) => p - q);
      e.pieces = [];
      for (let k = 0; k + 1 < cs.length; k++) {
        const t0 = cs[k], t1 = cs[k + 1];
        if (t1 - t0 < 0.02) continue;
        const mid = (t0 + t1) / 2;
        const cont = inAny(mid, toU), fromBelow = inAny(mid, fromB);
        const yb = T.below ? (fromBelow ? T.y0 : T.y0 - TER) : -0.6;
        const piece = { T, e, t0, t1, yb, yt: T.y1, cont, lk, run, tA, tB, skip: !!(T.skip && T.skip(e)) };
        e.pieces.push(piece); pieces.push(piece);
      }
    }
    // the coping's mitre at each end of a piece: tan(half the turn) where the neighbouring piece also ends in a coping
    const nE = E.length, s0 = ringOutSign(T.ring);
    for (let i = 0; i < nE; i++) {
      const e = E[i], prev = E[(i - 1 + nE) % nE], next = E[(i + 1) % nE];
      const turn = (d1, d2) => { const cr = d1[0] * d2[1] - d1[1] * d2[0], dt = d1[0] * d2[0] + d1[1] * d2[1]; return Math.atan2(cr * s0, dt); };
      for (const pc of e.pieces) {
        pc.m0 = 0; pc.m1 = 0;
        if (pc.t0 < 0.03) { const q = prev.pieces[prev.pieces.length - 1]; if (q && !q.cont && !q.skip && !pc.cont) pc.m0 = Math.tan(turn(prev.d, e.d) / 2); }
        if (pc.t1 > e.L - 0.03) { const q = next.pieces[0]; if (q && !q.cont && !q.skip && !pc.cont) pc.m1 = Math.tan(turn(e.d, next.d) / 2); }
      }
    }
    for (const pc of pieces) if (!pc.skip) facePiece(pc, F, M, A);
    // the roof: the whole tier's ring at the terrace level (the tier above stands on it)
    const ringL = T.ring.map(([x, z]) => F.P(x, z));
    capRing(A(T.roof || 'roof'), ringL, T.y1 - TER, 0.1);
  }
  // the green roof on the 21st floor's east terrace (it lies over the salmon membrane, 5 cm up)
  capRing(A('roofG'), [[36.2, -19.9], [46.3, -19.9], [46.3, 19.9], [36.2, 19.9]].map(([x, z]) => F.P(x, z)), 80.8 - TER + 0.05, 0.1);
  esbBaseDetails(F, A);
  esbDeckFence(F, A);
  esbMast(F, A);
  addMeshes(g, Object.entries(acc).map(([k, a]) => [a, M[k] || M.lime, 'lm64:esb:' + k]));
  // colliders: the base, the lower tower, the shaft, the crown (group-local, y = box centre)
  const C = (x, z) => F.P(x, z);
  const [lx0, lx1, lz0, lz1] = F.lot;
  const cb = (x0, x1, z0, z1, y0, y1) => { const c = C((x0 + x1) / 2, (z0 + z1) / 2); return { x: c[0], y: (y0 + y1) / 2, z: c[1], w: x1 - x0, h: y1 - y0, d: z1 - z0, rotY: F.rot }; };
  g.userData.colliderBoxes = [cb(lx0, lx1, lz0, lz1, 0, 25.2), cb(-46.85, 46.85, -24.9, 24.9, 25.2, 95.5), cb(-28.2, 28.2, -20.5, 20.5, 95.5, 299.2), cb(-22, 22, -14, 14, 299.2, 336.2)];
  g.userData.tris = triCount(Object.values(acc).map((a) => [a]));
  return g;
}

// one wall piece: piers, glazing, strips, heads, coping (tower coords; the piece runs along its line from t0 to t1 of its edge)
function facePiece(p, F, M, A) {
  const { T, e, t0, t1, yb, yt, cont, lk, run, tA } = p;
  if (yt - yb < 0.05) return;
  const style = T.style;
  // the piece's ends in tower coords, and its span in line coordinates (lt0 < lt1)
  const P0 = [e.a[0] + e.d[0] * t0, e.a[1] + e.d[1] * t0], P1 = [e.a[0] + e.d[0] * t1, e.a[1] + e.d[1] * t1];
  const sgn = e.d[0] * lk.t[0] + e.d[1] * lk.t[1] > 0 ? 1 : -1;   // edge direction vs the line's
  const lt = (t) => tA + sgn * t;                                   // edge t -> line t
  const at = (u) => { const t = (u - tA) * sgn; return [e.a[0] + e.d[0] * t, e.a[1] + e.d[1] * t]; };   // line t -> point
  const l0 = Math.min(lt(t0), lt(t1)), l1 = Math.max(lt(t0), lt(t1));
  // u must grow to the right seen from outside: right = (n.z, -n.x)
  const rightSign = (lk.t[0] * e.n[1] - lk.t[1] * e.n[0]) > 0 ? 1 : -1;
  const n = e.n;
  const yTop = cont ? yt : yt - 0.3;
  if (style === 'plain' || style === 'panel') {
    const acc = style === 'panel' ? A('panel') : A('lime');
    const Pa = at(l0), Pb = at(l1);
    const len = l1 - l0;
    if (style === 'panel') tquad(acc, F, Pa, Pb, yb, yTop, n, rightSign > 0 ? 0 : len / 4.8, rightSign > 0 ? len / 4.8 : 0, yb / 4.8, yTop / 4.8);
    else tquad(acc, F, Pa, Pb, yb, yTop, n, 0, 0, 0, 0);
    if (!cont) coping(A(style === 'panel' ? 'paint' : 'lime'), F, P0, P1, n, yt, 0.25, style === 'panel' ? 0.9 : TER, p.m0, p.m1);
    return;
  }
  if (style === 'base') { basePiece(p, F, M, A, l0, l1, at, rightSign, P0, P1); return; }
  // piers: explicit on the known planes, else laid out on the run
  const ex = explicitPiers(n, lk.off);
  const pp = ex ? ex.deep : style === 'obs' ? 0.25 : PP;
  let piers;
  if (ex) piers = ex.piers.map((q) => q.slice());
  else piers = layoutRun(run, style === 'crown' ? 5.6 : 5.0, PW);
  // clip to the piece; a pier at a convex corner of the ring is carried round it by its projection (on one face only)
  const nxt = (T.ring.length + e.i + 1) % T.ring.length;
  const convexAt = (idx) => {
    const R = T.ring, a = R[(idx - 1 + R.length) % R.length], b = R[idx], c = R[(idx + 1) % R.length];
    const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    return cr * ringOutSign(R) > 0;
  };
  const endAtB = Math.abs(t1 - e.L) < 0.03;
  const bLine = lt(e.L);
  const segs = [];
  for (let [a, b] of piers) {
    a = Math.max(a, l0); b = Math.min(b, l1);
    if (b - a < 0.05) continue;
    if (endAtB && convexAt(nxt) && (Math.abs(a - bLine) < 0.06 || Math.abs(b - bLine) < 0.06)) {
      if (Math.abs(b - bLine) < 0.06) b += pp; else a -= pp;
    }
    segs.push([a, b]);
  }
  const pierAcc = A('lime');
  for (const [a, b] of segs) {
    const c = at((a + b) / 2);
    tbox(pierAcc, F, c[0] + n[0] * pp / 2, yb, c[1] + n[1] * pp / 2, b - a, yTop - yb, pp, lk.t[0], lk.t[1]);
  }
  // the bays between the piers (and the piece's ends)
  const cover = segs.map(([a, b]) => [Math.max(a, l0), Math.min(b, l1)]).sort((p, q) => p[0] - q[0]);
  const bays = [];
  let cur = l0;
  for (const [a, b] of cover) { if (a - cur > 0.3) bays.push([cur, a]); cur = Math.max(cur, b); }
  if (l1 - cur > 0.3) bays.push([cur, l1]);
  const head = !cont && style !== 'obs';
  const gTop = head ? yTop - HEAD : yTop;
  for (const [a, b] of bays) {
    const w = b - a, two = w >= 3.0, uMax = two ? 1 : GZ.a1 + 0.02;
    const Pa = at(rightSign > 0 ? a : b), Pb = at(rightSign > 0 ? b : a);
    if (style === 'obs') {
      tquad(A('obs'), F, Pa, Pb, yb, yTop, n, 0, uMax, (yb - (T.y0 - TER)) / 8.57, (yTop - (T.y0 - TER)) / 8.57);
    } else {
      const ny = 6 * FLOOR;
      if (gTop > yb + 0.05) tquad(A('glaze'), F, Pa, Pb, yb, gTop, n, 0, uMax, (yb - Y6) / ny, (gTop - Y6) / ny);
      if (head) { const hb = Math.max(gTop, yb); tquad(A('head'), F, Pa, Pb, hb, yTop, n, 0, uMax, (hb - gTop) / HEAD, 1); }
    }
    // the steel strips at the bay's edges and round the narrow pier; the narrow pier
    const sTop = style === 'obs' ? yTop : gTop + (head ? HEAD * 0.55 : 0);
    const strips = [[a + STRIP.w / 2, STRIP.w, STRIP.p], [b - STRIP.w / 2, STRIP.w, STRIP.p]];
    if (two) strips.push([a + w * (GZ.a1 + GZ.b0) / 2, DIV.w, DIV.p]);
    if (style === 'obs') strips.length = 0;
    for (const [s, sw, sp] of strips) {
      const c = at(s);
      tbox(A('nickel'), F, c[0] + n[0] * sp / 2, yb, c[1] + n[1] * sp / 2, sw, sTop - yb, sp, lk.t[0], lk.t[1]);
    }
    if (style === 'obs' && two) {
      const c = at(a + w / 2);
      tbox(pierAcc, F, c[0] + n[0] * 0.08, yb, c[1] + n[1] * 0.08, 0.5, sTop - yb, 0.16, lk.t[0], lk.t[1]);
    }
  }
  if (!cont) coping(A('lime'), F, P0, P1, n, yt, pp + 0.12, TER, p.m0, p.m1);
}
// the coping and parapet along a straight piece: the cap's underside, front and top, then the parapet's inner face down to
// the terrace (drop metres)
function coping(acc, F, Pa, Pb, n, yt, proj, drop, m0 = 0, m1 = 0) {
  const prof = [[0, -0.3], [proj, -0.3], [proj, 0], [-0.42, 0], [-0.42, -drop]];
  const d = [Pb[0] - Pa[0], Pb[1] - Pa[1]], L = Math.hypot(d[0], d[1]);
  if (L < 0.05) return;
  const dh = [d[0] / L, d[1] / L];
  for (let k = 0; k + 1 < prof.length; k++) {
    const [o0, u0] = prof[k], [o1, u1] = prof[k + 1];
    const dd = o1 - o0, du = u1 - u0, Lp = Math.hypot(dd, du);
    if (Lp < 1e-6) continue;
    // the outward normal of a profile segment travelled with the solid on its left: (du, -dd) in (out, up)
    const nn = [n[0] * du / Lp, -dd / Lp, n[1] * du / Lp];
    const p = (P, o, u, sgn, m) => { const q = F.P(P[0] + n[0] * o + sgn * dh[0] * o * m, P[1] + n[1] * o + sgn * dh[1] * o * m); return [q[0], yt + u, q[1]]; };
    const N = F.dir(nn[0], nn[2]);
    acc.quad(p(Pa, o0, u0, -1, m0), p(Pb, o0, u0, 1, m1), p(Pb, o1, u1, 1, m1), p(Pa, o1, u1, -1, m0), [N[0], nn[1], N[1]]);
  }
}
// the base's faces: the shopfronts to 5.4 m (stainless, glass, the black transom), the fluted wide piers, the windows over
// reeded spandrels; the entrances are cut out of the run and drawn by esbBaseDetails
function basePiece(p, F, M, A, l0, l1, at, rightSign, P0, P1) {
  const { T, e, yt, lk, run } = p;
  const n = e.n, yTop = yt - 0.3;
  const openings = baseOpenings(T, e).filter(([a, b]) => b > l0 && a < l1).sort((x, y) => x[0] - y[0]);
  const piers = layoutRun(run, 5.3, 1.5);
  const spansOf = (ops) => {
    const out = [];
    let cur = l0;
    for (const [a, b] of ops) { if (a > cur) out.push([cur, Math.min(a, l1)]); cur = Math.max(cur, b); }
    if (cur < l1) out.push([cur, l1]);
    return out;
  };
  // the shopfronts, broken at every opening
  for (const [a, b] of spansOf(openings)) {
    const Pa = at(rightSign > 0 ? a : b), Pb = at(rightSign > 0 ? b : a);
    const ua = (rightSign > 0 ? a - run[0] : run[1] - b) / 5.3, ub = ua + (b - a) / 5.3;
    tquad(A('store'), F, Pa, Pb, -0.3, BASE_Y0, n, ua, ub, 0, 1);
  }
  // above them, broken only where an opening rises past the belt (Fifth Avenue's portal)
  for (const [s0, s1] of spansOf(openings.filter((o) => o[2] > BASE_Y0 + 1.5))) {
    const segs = piers.map(([a, b]) => [Math.max(a, s0), Math.min(b, s1)]).filter(([a, b]) => b - a > 0.2);
    for (const [a, b] of segs) {
      const c = at((a + b) / 2);
      tbox(A('flute'), F, c[0] + n[0] * 0.13, BASE_Y0, c[1] + n[1] * 0.13, b - a, yTop - BASE_Y0, 0.26, lk.t[0], lk.t[1]);
    }
    let c0 = s0;
    for (const [a, b] of [...segs, [s1, s1]]) {
      if (a - c0 > 0.3) {
        const Pa = at(rightSign > 0 ? c0 : a), Pb = at(rightSign > 0 ? a : c0);
        tquad(A('base'), F, Pa, Pb, BASE_Y0, yTop, n, 0, 1, 0, (yTop - BASE_Y0) / BASE_H);
      }
      c0 = Math.max(c0, b);
    }
  }
  coping(A('lime'), F, P0, P1, n, yt, 0.5, TER, p.m0, p.m1);
  if (yt > 23) coping(A('lime'), F, P0, P1, n, 22.4, 0.32, 0.0, p.m0, p.m1);    // the cornice band at the 5th floor's head
}
// the entrances on the base's faces ([from, to, top] in line coordinates along the face): Fifth Avenue's portal at its
// middle, 33rd and 34th Streets' doors at the middle of the block
function baseOpenings(T, e) {
  if (T.name !== 'base') return [];
  if (e.n[0] > 0.99) return [[-6.2, 6.2, 22.1]];
  if (Math.abs(e.n[1]) > 0.99) return [[-5.5, 5.5, 5.6]];
  return [];
}

/* --------------------------------------------- the base's entrances etc. */
function esbBaseDetails(F, A) {
  const [, lx1, lz0, lz1] = F.lot;
  // Fifth Avenue: the portal (a recess three storeys high in a stainless frame), the marquee, the screen over the doors
  const x5 = lx1;
  for (const s of [-1, 1]) tbox(A('flute'), F, x5 - 0.2, -0.3, s * 6.6, 0.8, 22.1, 0.9, 0, 1);    // the portal's jambs
  tbox(A('dark'), F, x5 - 1.6, -0.3, 0, 0.2, 17.5, 12.4, 1, 0);                                     // the recess's back
  for (const s of [-1, 1]) tbox(A('lime'), F, x5 - 0.8, -0.3, s * 6.25, 1.6, 17.8, 0.3, 1, 0);       // its side walls
  tbox(A('lime'), F, x5 - 0.75, 17.2, 0, 1.6, 4.9, 13.0, 1, 0);                                    // the stone over it
  for (let k = -4; k <= 4; k++) tbox(A('nickel'), F, x5 - 1.45, 5.2, k * 1.36, 0.12, 12.0, 0.1, 1, 0);   // the screen's mullions
  for (let k = 0; k < 6; k++) tbox(A('nickel'), F, x5 - 1.45, 5.6 + k * 2.1, 0, 0.12, 0.14, 12.2, 1, 0);
  marquee(F, A, [x5, 0], [1, 0], 12.6, 3.2, 4.6);
  // 33rd and 34th Streets
  for (const zz of [lz0, lz1]) {
    const nz = zz < 0 ? -1 : 1;
    tbox(A('dark'), F, 0, -0.3, zz - nz * 1.2, 11.0, 5.6, 0.2, 1, 0);
    for (const s of [-1, 1]) tbox(A('lime'), F, s * 5.6, -0.3, zz - nz * 0.6, 0.3, 5.9, 1.2, 1, 0);
    tbox(A('lime'), F, 0, 5.4, zz - nz * 0.55, 11.6, 0.9, 1.1, 1, 0);
    marquee(F, A, [0, zz], [0, nz], 12.0, 3.0, 4.4);
  }
}
// a stainless marquee: a slab with three ribbed bands, out from the face along n
function marquee(F, A, at0, n, w, out, y) {
  const t = [-n[1], n[0]];
  const cx = at0[0] + n[0] * out / 2, cz = at0[1] + n[1] * out / 2;
  tbox(A('nickel'), F, cx, y, cz, w, 0.95, out, t[0], t[1]);
  for (let k = 0; k < 3; k++) tbox(A('nickel'), F, cx + n[0] * 0.04, y + 0.12 + k * 0.28, cz + n[1] * 0.04, w + 0.12, 0.1, out + 0.12, t[0], t[1]);
  tbox(A('dark'), F, cx, y - 0.04, cz, w - 0.2, 0.04, out - 0.2, t[0], t[1]);
}

/* ------------------------------------------------ the 86th floor's fence */
// round the deck on the 85th floor's parapet: posts every 1.6 m, three rails, the top bent in toward the observatory
function esbDeckFence(F, A) {
  const ring = sym4([[0, -14.0 - 0.3], [20.05 + 0.15, -14.0 - 0.3], [21.95 + 0.3, -11.9 - 0.15], [21.95 + 0.3, 0]]);
  const y0 = 315.4, h1 = 1.9, h2 = 0.75, lean = 0.55;
  const s = ringOutSign(ring);
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.3) continue;
    const d = [ex / L, ez / L], n = [(s * ez) / L, (-s * ex) / L];
    const np = Math.max(1, Math.round(L / 1.6));
    for (let k = 0; k <= np; k++) {
      const x = a[0] + ex * (k / np) - n[0] * 0.15, z = a[1] + ez * (k / np) - n[1] * 0.15;
      tbox(A('paint'), F, x, y0, z, 0.07, h1, 0.07, d[0], d[1]);
      // the bent top: a post leaning in
      const c = F.P(x - n[0] * lean / 2, z - n[1] * lean / 2), D = F.dir(n[0], n[1]);
      const geo = new THREE.BoxGeometry(0.06, Math.hypot(h2, lean), 0.06);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-D[0] * lean, h2, -D[1] * lean).normalize());
      A('paint').addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(c[0], y0 + h1 + h2 / 2, c[1]), q, new THREE.Vector3(1, 1, 1)));
      geo.dispose();
    }
    for (const [yy, inw] of [[0.95, 0], [h1, 0], [h1 + h2, lean]]) {
      const cx = (a[0] + b[0]) / 2 - n[0] * (0.15 + inw), cz = (a[1] + b[1]) / 2 - n[1] * (0.15 + inw);
      tbox(A('paint'), F, cx, y0 + yy - 0.03, cz, L, 0.06, 0.05, d[0], d[1]);
    }
  }
}

/* ---------------------------------------------------------- the mast */
// the mooring mast: an octagonal shaft (glazed N, E, S and W faces 5.5 m wide; the corners cut on the diagonals) from the
// mast's base at 336.16 m to the 101st floor; four fins on the diagonals stepping in at 342.7, 348.5, 355.9 and 370.0 m (the
// model's heights) with rounded wing tops; the 102nd floor's window band, the drum to 381.5 m, the cone, the antenna
function esbMast(F, A) {
  const y0 = 336.16, yW = 370.0, yR = 377.16;
  const hw = 2.75, ap = 4.7;            // half the glazed face's width; the octagon's apothem on the glazed faces
  const oct = [[hw, -ap], [ap, -hw], [ap, hw], [hw, ap], [-hw, ap], [-ap, hw], [-ap, -hw], [-hw, -ap]];
  const s = ringOutSign(oct);
  for (let i = 0; i < 8; i++) {
    const a = oct[i], b = oct[(i + 1) % 8], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const n = [(s * ez) / L, (-s * ex) / L];
    const glazed = Math.abs(Math.abs(n[0]) - 1) < 0.01 || Math.abs(Math.abs(n[1]) - 1) < 0.01;
    // u to the right seen from outside
    const right = ex * n[1] - ez * n[0] > 0;
    const [Pa, Pb] = right ? [a, b] : [b, a];
    if (glazed) {
      tquad(A('mastGlass'), F, Pa, Pb, y0 - 0.2, yW, n, 0, 1, (y0 - 0.2) / 7.4, yW / 7.4);
      // the glazed face's frame: an aluminium jamb each side, and its mullions standing proud of the glass
      for (const P of [a, b]) tbox(A('alu'), F, P[0] + n[0] * 0.1 - (P === a ? -1 : 1) * ex / L * 0.12, y0, P[1] + n[1] * 0.1 - (P === a ? -1 : 1) * ez / L * 0.12, 0.24, yW - y0, 0.2, ex / L, ez / L);
      for (let k = 1; k < 6; k++) {
        const f = k / 6, x = a[0] + ex * f + n[0] * 0.06, z = a[1] + ez * f + n[1] * 0.06;
        tbox(A('alu'), F, x, y0, z, 0.1, yW - y0, 0.12, ex / L, ez / L);
      }
    } else {
      tquad(A('alu'), F, Pa, Pb, y0 - 0.2, yW, n, 0, 0, 0, 0);
    }
  }
  // the fins: a 0.9 m blade on each diagonal, its outer edge stepping in with a rounded top at each step
  const steps = [[9.97, 342.7], [8.9, 348.5], [7.8, 355.9], [6.4, 370.0]];
  for (let q = 0; q < 4; q++) {
    const ang = Math.PI / 4 + (q * Math.PI) / 2, dx = Math.cos(ang), dz = Math.sin(ang);
    const r0 = 4.9;
    // the blade's profile in (r, y), counter-clockwise: in at the root, out along the base, up and in step by step
    const prof = [[r0, y0]];
    let yPrev = y0;
    for (let k = 0; k < steps.length; k++) {
      const [r, yTop] = steps[k], rNext = k + 1 < steps.length ? steps[k + 1][0] : r0;
      prof.push([r, yPrev === y0 ? y0 : yPrev]);
      const rise = yTop - 2.2 - (yPrev === y0 ? y0 : yPrev);
      prof.push([r, (yPrev === y0 ? y0 : yPrev) + Math.max(0.5, rise)]);
      // the wing's rounded top from (r, ya) up and in to (rNext, yTop)
      const ya = (yPrev === y0 ? y0 : yPrev) + Math.max(0.5, rise);
      for (let m = 1; m <= 5; m++) {
        const t = m / 5, th = (t * Math.PI) / 2;
        prof.push([rNext + (r - rNext) * Math.cos(th), ya + (yTop - ya) * Math.sin(th)]);
      }
      yPrev = yTop;
    }
    finBlade(A('fin'), F, prof, dx, dz, 0.9);
  }
  capRing(A('alu'), oct.map(([x, z]) => F.P(x, z)), yW, 0.1);
  // the 101st-102nd floors: the band of tall windows (a 16-sided drum on the shaft's head), its ledge
  const R2 = 5.25;
  cylT(A('lime'), F, 0, yW, 0, R2 + 0.15, ap / Math.cos(Math.PI / 8) * 0.97, 0.6, 16);
  bandDrum(A('mastGlass'), A('alu'), F, yW + 0.6, yR - 0.4, R2, 16);
  lathT(A('paint'), F, yR - 0.4, [[R2 - 0.2, 0], [R2 + 0.32, 0], [R2 + 0.32, 0.55], [R2 - 0.1, 0.55]], 24);
  // the drum to 381.5 (light grey, small windows), the cone, the antenna's housing
  lathT(A('paint'), F, yR + 0.15, [[5.0, 0], [5.05, 2.2], [4.9, 4.34], [4.5, 4.34], [3.6, 5.2], [2.5, 6.4], [2.35, 6.6], [0, 6.6]], 24);
  for (let k = 0; k < 12; k++) {                         // the drum's small windows
    const a = (k / 12) * Math.PI * 2, c = [Math.cos(a) * 5.06, Math.sin(a) * 5.06];
    tbox(A('dark'), F, c[0], yR + 1.2, c[1], 0.9, 1.6, 0.06, -Math.sin(a), Math.cos(a));
  }
  // the antenna: the octagonal housing to 419.0 with its rings, the mast to 434.7 with its platforms and panels, the tip
  const yA = 383.66;
  cylT(A('antenna'), F, 0, yA, 0, 1.95, 2.05, 419.0 - yA, 8, Math.PI / 8);
  for (const yy of [389, 396, 403, 410, 416.5]) cylT(A('antenna'), F, 0, yy, 0, 2.35, 2.35, 0.35, 16);
  for (let k = 0; k < 8; k++) {                         // the housing's lattice ribs
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8, c = [Math.cos(a) * 2.0, Math.sin(a) * 2.0];
    tbox(A('paint'), F, c[0], yA, c[1], 0.16, 419.0 - yA, 0.16, 1, 0);
  }
  cylT(A('antenna'), F, 0, 419.0, 0, 0.8, 0.95, 434.7 - 419.0, 12);
  for (const yy of [421.5, 426.5, 431.5]) {
    cylT(A('antenna'), F, 0, yy, 0, 1.45, 1.45, 0.25, 16);
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + 0.3, c = [Math.cos(a) * 1.1, Math.sin(a) * 1.1];
      tbox(A('antenna'), F, c[0], yy + 0.25, c[1], 0.5, 2.6, 0.12, -Math.sin(a), Math.cos(a));
    }
  }
  cylT(A('antenna'), F, 0, 434.7, 0, 0.18, 0.45, 443.6 - 434.7, 8);
}
// a cylinder / frustum at tower coords (x, z)
function cylT(acc, F, x, y0, z, rt, rb, h, seg, rot = 0) { const c = F.P(x, z); cyl(acc, c[0], y0, c[1], rt, rb, h, seg, rot - F.rot); }
function lathT(acc, F, y0, prof, seg) { const c = F.P(0, 0); lathe(acc, c[0], y0, c[1], prof, seg); }
// a drum of window panels: glass between aluminium mullions, seg sides
function bandDrum(glassAcc, aluAcc, F, ya, yb, R, seg) {
  for (let k = 0; k < seg; k++) {
    const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
    const p0 = [Math.cos(a0) * R, Math.sin(a0) * R], p1 = [Math.cos(a1) * R, Math.sin(a1) * R];
    const n = [Math.cos(am), Math.sin(am)];
    const right = (p1[0] - p0[0]) * n[1] - (p1[1] - p0[1]) * n[0] > 0;
    tquad(glassAcc, F, right ? p0 : p1, right ? p1 : p0, ya, yb, n, 0, 0.33, 0.25, 0.25 + (yb - ya) / 7.4);
    tbox(aluAcc, F, p0[0] * 1.01, ya, p0[1] * 1.01, 0.22, yb - ya, 0.18, -Math.sin(a0), Math.cos(a0));
  }
}
// a fin blade: the profile (r, y) on the diagonal (dx, dz), extruded th across it; the faces textured with the fin tile
function finBlade(acc, F, prof, dx, dz, th) {
  const side = [-dz, dx];
  const P = (r, o) => [dx * r + side[0] * o, dz * r + side[1] * o];
  const n = prof.length;
  // the two side faces (earcut on the profile), and the edge strip round it
  const shape = prof.map(([r, y]) => new THREE.Vector2(r, y));
  const tris = THREE.ShapeUtils.triangulateShape(shape, []);
  for (const sgn of [-1, 1]) {
    const nn = F.dir(side[0] * sgn, side[1] * sgn);
    for (const [i, j, k] of tris) {
      const v = [i, j, k].map((m) => { const [r, y] = prof[m]; const q = P(r, (sgn * th) / 2), w = F.P(q[0], q[1]); return [w[0], y, w[1]]; });
      const uv = [i, j, k].map((m) => [(prof[m][0] - 4.9) / 5.2, (prof[m][1] - 336) / 9]);
      // wind so the face looks along nn
      const e1 = [v[1][0] - v[0][0], v[1][1] - v[0][1], v[1][2] - v[0][2]], e2 = [v[2][0] - v[0][0], v[2][1] - v[0][1], v[2][2] - v[0][2]];
      const cx = e1[1] * e2[2] - e1[2] * e2[1], cz = e1[0] * e2[1] - e1[1] * e2[0];
      if (cx * nn[0] + cz * nn[1] >= 0) acc.tri(v[0], v[1], v[2], [nn[0], 0, nn[1]], uv[0], uv[1], uv[2]);
      else acc.tri(v[0], v[2], v[1], [nn[0], 0, nn[1]], uv[0], uv[2], uv[1]);
    }
  }
  const area = prof.reduce((s, p, i) => { const q = prof[(i + 1) % n]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
  for (let i = 0; i < n; i++) {
    const [r0, ya] = prof[i], [r1, yb] = prof[(i + 1) % n];
    const dr = r1 - r0, dy = yb - ya, L = Math.hypot(dr, dy);
    if (L < 1e-4) continue;
    // outward normal of the profile edge in (r, y): (dy, -dr) for a counter-clockwise profile
    const sg = area > 0 ? 1 : -1;
    const nr = (sg * dy) / L, ny = (-sg * dr) / L;
    const N = F.dir(dx * nr, dz * nr);
    const q = (r, y, o) => { const p = P(r, o), w = F.P(p[0], p[1]); return [w[0], y, w[1]]; };
    acc.quad(q(r0, ya, -th / 2), q(r1, yb, -th / 2), q(r1, yb, th / 2), q(r0, ya, th / 2), [N[0], ny, N[1]], [0, 0], [L / 4, 0], [L / 4, 0.2], [0, 0.2]);
  }
}

/* ------------------------------------------------------------ Chrysler */
// William Van Alen, 1930. The model's tiers (DoITT, as on the ESB): the base on the whole lot to 19 m; the wings on 42nd and
// 43rd Streets to 58, 82 and 92 m round the tower's core, light courts open to Lexington Avenue and the east between them; the
// tower to the 30th-floor setback at 105 m (the hubcap frieze, the radiator caps at its corners); the shaft to 196 m; the
// 59th-61st floors with their cut corners and the eagles at 205.5 m; the crown's base, an octagon with stepped corners to
// 227 m; then the terraced arches (the model's tops at 233.8, 239.9, 247.2, 256.2, 263.9, 271.3 and 279.1 m), each a
// stainless steel vault over a semicircle on every face, pierced by a fan of triangular windows under its rim, and the spire
// to 318.8 m. White brick with grey-brick spandrels, dark grey bands at the setbacks, maroon roofs.
const WBRICK = [226, 222, 214], GBRICK = [150, 148, 145], DBRICK = [92, 90, 88];
function paintChrBrick(ga, gb, go, W, H, r) {
  const nx = 4, ny = 4, cw = W / nx, ch = H / ny;
  fill3(ga, gb, go, 0, 0, W, H, WBRICK, 150, 0.86, 0);
  for (let yy = 0; yy < H; yy += 3) { ga.fillStyle = 'rgba(120,114,106,0.10)'; ga.fillRect(0, yy, W, 1); gb.fillStyle = 'rgb(130,130,130)'; gb.fillRect(0, yy, W, 1); }
  speckle(ga, 0, 0, W, H, r, 1600, 0.05);
  for (let i = 0; i < nx; i++) {
    const x0 = i * cw + cw * 0.2, x1 = (i + 1) * cw - cw * 0.2;
    fill3(ga, gb, go, x0, 0, x1 - x0, H, rgbs(GBRICK, 1 + (r() - 0.5) * 0.06), 136, 0.86, 0);      // the grey-brick stripe of the column
    for (let j = 0; j < ny; j++) {
      const y0 = j * ch + ch * 0.14, y1 = j * ch + ch * 0.7;
      fill3(ga, gb, go, x0, y0, x1 - x0, y1 - y0, [196, 198, 198], 138, 0.5, 0.3);                  // the steel frame
      const k = 0.8 + r() * 0.4, gl = ga.createLinearGradient(0, y0, 0, y1);
      gl.addColorStop(0, rgbs([70, 80, 92], k)); gl.addColorStop(1, rgbs([30, 34, 40], k));
      ga.fillStyle = gl; ga.fillRect(x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4);
      fill3(null, gb, go, x0 + 2, y0 + 2, x1 - x0 - 4, y1 - y0 - 4, null, 70, 0.07, 0);
      fill3(ga, gb, go, x0, y0 + (y1 - y0) * 0.45, x1 - x0, 2, [196, 198, 198], 138, 0.5, 0.3);
      if (r() < 0.2) fill3(ga, gb, go, x0 + 2, y0 + 2, x1 - x0 - 4, (y1 - y0) * (0.2 + r() * 0.4), rgbs([186, 178, 160], 0.85), 90, 0.8, 0);
      ga.fillStyle = 'rgba(0,0,0,0.35)'; ga.fillRect(x0, y0, x1 - x0, 2);
      fill3(ga, gb, go, x0 - 2, y1, x1 - x0 + 4, 3, [214, 212, 206], 190, 0.8, 0);                   // the sill
    }
  }
  streaks(ga, 0, 0, W, H, r, 14, 0.05);
}
// the ground floor: black granite piers and base, display glass in steel frames, a steel band over them
function paintChrStore(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [30, 30, 32], 150, 0.22, 0);
  const m = H / 6.3, Y = (y) => H - (y + 0.3) * m;
  for (const [a, b] of [[0.12, 0.88]]) {
    const gl = ga.createLinearGradient(0, Y(4.6), 0, Y(0.6));
    gl.addColorStop(0, 'rgb(82,90,98)'); gl.addColorStop(0.6, 'rgb(98,92,84)'); gl.addColorStop(1, 'rgb(48,46,44)');
    ga.fillStyle = gl; ga.fillRect(W * a, Y(4.6), W * (b - a), Y(0.6) - Y(4.6));
    fill3(null, gb, go, W * a, Y(4.6), W * (b - a), Y(0.6) - Y(4.6), null, 80, 0.06, 0);
    for (const xf of [a, 0.5, b]) fill3(ga, gb, go, W * xf - 2, Y(4.6), 4, Y(0.6) - Y(4.6), [200, 202, 204], 170, 0.25, 0.9);
    ga.fillStyle = `rgba(255,236,200,${(0.08 + r() * 0.1).toFixed(3)})`; ga.fillRect(W * (a + 0.05), Y(3.6), W * 0.3, Y(0.8) - Y(3.6));
  }
  fill3(ga, gb, go, 0, Y(5.4), W, Y(4.9) - Y(5.4), [200, 202, 204], 175, 0.25, 0.9);
}
// a crown face: the half-ellipse of the arch (u across the span, v from the springing to the top). A fan of triangular windows
// under the rim, the steel rays between them, a dark lunette at the foot
function paintChrSun(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [186, 186, 186], 150, 0.38, 0.8);
  const cx = W / 2, cy = H, nT = 11;
  const P = (rr, th) => [cx + Math.cos(th) * rr * W / 2, cy - Math.sin(th) * rr * H];
  const poly = (g, pts, fs) => { g.fillStyle = fs; g.beginPath(); g.moveTo(...pts[0]); for (const q of pts.slice(1)) g.lineTo(...q); g.closePath(); g.fill(); };
  for (let k = 0; k < nT; k++) {                       // the triangular windows, their bases under the rim, their points inward
    const t0 = Math.PI * (k + 0.12) / nT, t1 = Math.PI * (k + 0.88) / nT, tm = (t0 + t1) / 2;
    const tri = [P(0.9, t0), P(0.9, t1), P(0.58, tm)];
    poly(ga, tri, 'rgb(36,40,46)'); poly(gb, tri, 'rgb(66,66,66)'); poly(go, tri, orm(0.08, 0));
    if (r() < 0.3) poly(ga, tri, 'rgba(120,130,142,0.35)');
    const t2 = [P(0.86, t0 + 0.02), P(0.86, t1 - 0.02), P(0.66, tm)];      // the glazing bar inside each
    ga.strokeStyle = 'rgba(170,172,176,0.6)'; ga.lineWidth = 2; ga.beginPath(); ga.moveTo(...t2[2]); ga.lineTo(...P(0.88, tm)); ga.stroke();
  }
  for (let k = 0; k <= nT; k++) {                      // the steel rays between the windows, and their ribs on into the plate
    const th = Math.PI * k / nT, a = P(0.5, th), b = P(0.96, th);
    for (const [g, ss, lw] of [[ga, 'rgba(214,216,218,0.95)', 4], [gb, 'rgb(196,196,196)', 4]]) { g.strokeStyle = ss; g.lineWidth = lw; g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  }
  for (const rr of [0.5, 0.36]) {                      // the plate's concentric seams under the fan
    ga.strokeStyle = 'rgba(120,122,126,0.6)'; ga.lineWidth = 2; ga.beginPath(); ga.ellipse(cx, cy, W * rr / 2, H * rr, 0, Math.PI, 0); ga.stroke();
  }
  ga.strokeStyle = 'rgba(232,234,236,1)'; ga.lineWidth = 5; ga.beginPath(); ga.ellipse(cx, cy, W * 0.46, H * 0.92, 0, Math.PI, 0); ga.stroke();
  speckle(ga, 0, 0, W, H, r, 500, 0.05);
}
// the vaults' steel: ribs running back from each arch (u round the arch, v back into the crown)
function paintChrRib(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [190, 192, 194], 150, 0.4, 0.85);
  for (let k = 0; k < 24; k++) {
    const x = (k / 24) * W;
    fill3(ga, gb, go, x, 0, 3, H, [214, 216, 218], 185, 0.32, 0.9);
    ga.fillStyle = 'rgba(80,84,90,0.35)'; ga.fillRect(x + 3, 0, 2, H);
  }
  for (let yy = 0; yy < H; yy += H / 6) { ga.fillStyle = 'rgba(90,94,100,0.3)'; ga.fillRect(0, yy, W, 2); }
  streaks(ga, 0, 0, W, H, r, 30, 0.06);
}

let _CHR = null;
function chrMats() {
  if (_CHR) return _CHR;
  const t = {
    brick: tile('chr-brick', 256, 256, paintChrBrick, 211),
    store: tile('chr-store', 128, 160, paintChrStore, 212),
    sun: tile('chr-sun', 512, 256, paintChrSun, 213),
    rib: tile('chr-rib', 256, 128, paintChrRib, 214),
  };
  _CHR = {
    t,
    brick: tileMat('lm64:chr:brick', t.brick, { bump: 1.2 }),
    store: tileMat('lm64:chr:store', t.store, { bump: 1.0 }),
    sun: tileMat('lm64:chr:sun', t.sun, { bump: 1.4 }),
    rib: tileMat('lm64:chr:vault', t.rib, { bump: 1.6 }),
    // Nirosta as it is: brushed, a soft highlight, not a mirror
    steel: mat(0xc8c9cb, { rough: 0.38, metal: 0.78, flat: false }),
    steelF: mat(0xc8c9cb, { rough: 0.38, metal: 0.78, flat: true }),
    band: mat(0x5c5a58, { rough: 0.85, flat: true }),             // the dark grey brick bands
    coping: mat(0xd8d4cc, { rough: 0.8, flat: true }),
    roof: mat(0x6b3a36, { rough: 0.9, flat: true }),              // the setbacks' maroon roofs
    roofG: mat(0x9a9a98, { rough: 0.9, flat: true }),
  };
  return _CHR;
}
// the lot in the grid from the ring: the tower's axis 30.55 m east of the Lexington Avenue line and 30.65 m north of the
// 42nd Street line
function chrFrame(ring) {
  const F0 = esbFrame(ring);
  const { A, S } = F0;
  const UV = ring.map((p) => [p[0] * A[0] + p[1] * A[1], p[0] * S[0] + p[1] * S[1]]);
  const uW = Math.min(...UV.map((p) => p[0])), vS = Math.max(...UV.map((p) => p[1]));
  const uC = uW + 30.55, vC = vS - 30.65;
  return {
    A, S, uC, vC,
    P: (x, z) => [A[0] * (uC + x) + S[0] * (vC + z), A[1] * (uC + x) + S[1] * (vC + z)],
    dir: (x, z) => [A[0] * x + S[0] * z, A[1] * x + S[1] * z],
    rot: Math.atan2(-A[1], A[0]),
    ringT: UV.map(([u, v]) => [u - uC, v - vC]),
  };
}
function chrTiers(F) {
  const T = [];
  const add = (o) => { T.push(o); return o; };
  const base = add({ name: 'base', ring: clean(F.ringT), y0: 0, y1: 19.1, below: null, style: 'brickBase' });
  const w1 = add({ name: 'wings1', ring: clean([[-30.55, -30.15], [31.15, -30.15], [31.15, -21.75], [28.55, -12.05], [17.25, -12.05], [17.25, 12.65], [20.75, 12.65], [20.75, 30.65],
    [-30.55, 30.65], [-30.55, 12.65], [-13.55, 12.65], [-13.55, -12.05], [-30.55, -12.05]]), y0: 19.1, y1: 58.4, below: base, style: 'brick' });
  const w2 = add({ name: 'wings2', ring: clean([[-24.75, -24.35], [25.35, -24.35], [25.35, -12.05], [17.25, -12.05], [17.25, 12.65], [21.15, 12.65], [21.15, 24.55], [-24.75, 24.55],
    [-24.75, 12.65], [-13.55, 12.65], [-13.55, -12.05], [-24.75, -12.05]]), y0: 58.4, y1: 81.6, below: w1, style: 'brick' });
  const w3 = add({ name: 'wings3', ring: clean([[-22.25, -21.65], [22.45, -21.65], [22.45, -12.05], [17.25, -12.05], [17.25, 12.65], [21.15, 12.65], [21.15, 21.85], [-22.25, 21.85],
    [-22.25, 12.65], [-13.55, 12.65], [-13.55, -12.05], [-22.25, -12.05]]), y0: 81.6, y1: 92.2, below: w2, style: 'brick' });
  const t30 = add({ name: 't30', ring: rect(-13.55, 13.55, -18.65, 19.25), y0: 92.2, y1: 104.8, below: w3, style: 'brick' });
  const shaft = add({ name: 'shaft', ring: rect(-13.55, 13.55, -16.15, 16.55), y0: 104.8, y1: 195.8, below: t30, style: 'brick' });
  const t61 = add({ name: 't61', ring: clean([[-8.85, -16.15], [8.95, -16.15], [8.95, -11.25], [11.55, -9.05], [13.55, -9.05], [13.55, 9.55], [11.55, 9.55], [8.95, 12.05], [8.95, 16.55],
    [-8.85, 16.55], [-8.85, 12.05], [-11.55, 9.55], [-13.55, 9.55], [-13.55, -9.05], [-11.55, -9.05], [-8.85, -11.25]]), y0: 195.8, y1: 205.5, below: shaft, style: 'brick' });
  // the crown's base: the octagon with stepped corners (one quarter from the model, mirrored)
  const oq = [[0, -13.5], [6.25, -13.5], [6.25, -11.95], [8.25, -9.95], [10.35, -9.95], [10.35, -7.65], [12.25, -5.65], [13.55, -5.65], [13.55, 0]];
  add({ name: 'oct', ring: sym4(oq), y0: 205.5, y1: 227.1, below: t61, style: 'brick', roof: 'roofG' });
  return T;
}
export function buildChrysler(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = chrFrame(ring);
  const M = chrMats();
  const g = new THREE.Group();
  const acc = {};
  const A = (k) => (acc[k] ||= new Acc());
  const tiers = chrTiers(F);
  const lines = buildLines(tiers);
  const above = (T) => tiers.filter((U) => U.below === T);
  for (const T of tiers) {
    const ups = above(T), E = edgesOf(T.ring), pieces = [];
    for (const e of E) {
      const fromB = sharedWith(e, T.below && T.below.ring), toU = ups.flatMap((U) => sharedWith(e, U.ring));
      const cuts = new Set([0, e.L]);
      for (const [a, b] of [...fromB, ...toU]) { cuts.add(a); cuts.add(b); }
      const cs = [...cuts].sort((p, q) => p - q);
      e.pieces = [];
      for (let k = 0; k + 1 < cs.length; k++) {
        const t0 = cs[k], t1 = cs[k + 1];
        if (t1 - t0 < 0.02) continue;
        const mid = (t0 + t1) / 2, cont = inAny(mid, toU), fromBelow = inAny(mid, fromB);
        const pc = { T, e, t0, t1, yb: T.below ? (fromBelow ? T.y0 : T.y0 - TER) : -0.6, yt: T.y1, cont };
        e.pieces.push(pc); pieces.push(pc);
      }
    }
    const nE = E.length, s0 = ringOutSign(T.ring);
    for (let i = 0; i < nE; i++) {
      const e = E[i], prev = E[(i - 1 + nE) % nE], next = E[(i + 1) % nE];
      const turn = (d1, d2) => Math.atan2((d1[0] * d2[1] - d1[1] * d2[0]) * s0, d1[0] * d2[0] + d1[1] * d2[1]);
      for (const pc of e.pieces) {
        pc.m0 = 0; pc.m1 = 0;
        if (pc.t0 < 0.03) { const q = prev.pieces[prev.pieces.length - 1]; if (q && !q.cont && !pc.cont) pc.m0 = Math.tan(turn(prev.d, e.d) / 2); }
        if (pc.t1 > e.L - 0.03) { const q = next.pieces[0]; if (q && !q.cont && !pc.cont) pc.m1 = Math.tan(turn(e.d, next.d) / 2); }
      }
    }
    for (const pc of pieces) chrPiece(pc, F, A, lines);
    capRing(A(T.roof || 'roof'), T.ring.map(([x, z]) => F.P(x, z)), T.y1 - TER, 0.1);
  }
  chrOrnaments(F, A);
  chrCrown(F, A);
  addMeshes(g, Object.entries(acc).map(([k, a]) => [a, M[k] || M.steel, 'lm64:chr:' + k]));
  const cb = (x0, x1, z0, z1, y0, y1) => { const c = F.P((x0 + x1) / 2, (z0 + z1) / 2); return { x: c[0], y: (y0 + y1) / 2, z: c[1], w: x1 - x0, h: y1 - y0, d: z1 - z0, rotY: F.rot }; };
  g.userData.colliderBoxes = [cb(-30.5, 31, -30, 30.6, 0, 58.4), cb(-13.5, 13.5, -16, 16.5, 58.4, 205.5), cb(-12, 12, -12, 12, 205.5, 260)];
  g.userData.tris = triCount(Object.values(acc).map((a) => [a]));
  return g;
}
// a Chrysler wall piece: the brick tile over whole floors (3.6 m) and 2.2 m window columns; the shopfronts under the base's;
// a dark grey band and a light coping where the wall ends at a setback
function chrPiece(p, F, A, lines) {
  const { T, e, t0, t1, yb, yt, cont } = p;
  if (yt - yb < 0.05) return;
  const lk = lines.get(lineKey(e.n, e.off));
  const P0 = [e.a[0] + e.d[0] * t0, e.a[1] + e.d[1] * t0], P1 = [e.a[0] + e.d[0] * t1, e.a[1] + e.d[1] * t1];
  const n = e.n, right = e.d[0] * n[1] - e.d[1] * n[0] > 0;
  const tA = e.a[0] * lk.t[0] + e.a[1] * lk.t[1], sg = e.d[0] * lk.t[0] + e.d[1] * lk.t[1] > 0 ? 1 : -1;
  const l0 = tA + sg * t0, l1 = tA + sg * t1;              // line coordinates: the tile stays in register round the tiers
  const [Pa, Pb, ua, ub] = right ? [P0, P1, l0, l1] : [P1, P0, l1, l0];
  const uOf = (l) => (lk.t[0] * n[1] - lk.t[1] * n[0] > 0 ? l : -l) / (4 * 2.2);
  const yTop = cont ? yt : yt - 0.3;
  let y0 = yb;
  if (T.style === 'brickBase') {
    tquad(A('store'), F, Pa, Pb, -0.6, 5.7, n, uOf(ua) * 4 * 2.2 / 4.4, uOf(ub) * 4 * 2.2 / 4.4, 0, 1);
    y0 = 5.7;
  }
  const bandH = cont ? 0 : 1.6;
  if (yTop - bandH > y0) tquad(A('brick'), F, Pa, Pb, y0, yTop - bandH, n, uOf(ua), uOf(ub), y0 / (4 * 3.6), (yTop - bandH) / (4 * 3.6));
  if (!cont) {
    tquad(A('band'), F, Pa, Pb, Math.max(y0, yTop - bandH), yTop, n, 0, 0, 0, 0);
    coping(A('coping'), F, P0, P1, n, yt, 0.3, TER, p.m0, p.m1);
  }
}
// the 30th floor's hubcap frieze and the radiator caps at its corners; the eagles at the 61st floor's corners
function chrOrnaments(F, A) {
  // hubcaps: steel discs along the dark band under the 30th-floor setback (y 103.2)
  for (const [n, a, b, off] of [[[0, -1], -13.2, 13.2, -18.65], [[0, 1], -13.2, 13.2, 19.25], [[1, 0], -18.3, 18.9, 13.55], [[-1, 0], -18.3, 18.9, -13.55]]) {
    const L = b - a, k = Math.max(2, Math.round(L / 3.0));
    for (let q = 0; q <= k; q++) {
      const s = a + (L * q) / k;
      const [x, z] = n[0] ? [off, s] : [s, off];
      const c = F.P(x + n[0] * 0.06, z + n[1] * 0.06), D = F.dir(n[0], n[1]);
      const geo = new THREE.CylinderGeometry(0.55, 0.62, 0.16, 14);
      const qn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(D[0], 0, D[1]));
      A('steelF').addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(c[0], 103.2, c[1]), qn, new THREE.Vector3(1, 1, 1)));
      geo.dispose();
    }
  }
  // the radiator caps: a winged cap at each corner of the setback
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = sx * 13.3, z = sz === 1 ? 19.0 : -18.4;
    cylT(A('steel'), F, x, 104.8, z, 0.55, 0.7, 1.7, 12);
    lathT2(A('steel'), F, x, 106.5, z, [[0.7, 0], [0.75, 0.3], [0.45, 0.75], [0.12, 1.0], [0, 1.0]], 12);
    for (const w of [-1, 1]) {
      const d = w > 0 ? [sx, 0] : [0, sz];
      tbox(A('steelF'), F, x + d[0] * 1.15, 105.6, z + d[1] * 1.15, 1.8, 0.9, 0.12, d[0], d[1]);
      tbox(A('steelF'), F, x + d[0] * 0.95, 106.4, z + d[1] * 0.95, 1.3, 0.55, 0.12, d[0], d[1]);
    }
  }
  // the eagles: off the cut corners of the 61st floor, looking out along the diagonals
  for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const dx = sx * Math.SQRT1_2, dz = sz * Math.SQRT1_2;
    const bx = sx * 10.25, bz = sz * (sz > 0 ? 10.8 : 10.15);
    const y = 204.2;
    eagle(A('steel'), F, bx, y, bz, dx, dz);
  }
}
function lathT2(acc, F, x, y0, z, prof, seg) { const c = F.P(x, z); lathe(acc, c[0], y0, c[1], prof, seg); }
// an eagle's head and neck in steel: the neck out of the corner, the head, the hooked beak, the ruff of feathers behind it
function eagle(acc, F, x, y, z, dx, dz) {
  const add = (geo, px, py, pz, yaw, pitch, sxx = 1, syy = 1, szz = 1) => {
    const c = F.P(px, pz), D = F.dir(dx, dz);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, Math.atan2(D[0], D[1]) + yaw, 0, 'YXZ'));
    acc.addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(c[0], py, c[1]), q, new THREE.Vector3(sxx, syy, szz)));
  };
  const neck = new THREE.CylinderGeometry(0.8, 1.25, 4.6, 12).rotateX(Math.PI / 2);
  add(neck, x + dx * 2.0, y + 1.4, z + dz * 2.0, 0, -0.18);
  const head = new THREE.SphereGeometry(1.1, 14, 10);
  add(head, x + dx * 4.4, y + 1.95, z + dz * 4.4, 0, 0, 0.9, 0.85, 1.25);
  const beak = new THREE.ConeGeometry(0.48, 1.9, 10).rotateX(Math.PI / 2 + 0.35);
  add(beak, x + dx * 5.65, y + 1.65, z + dz * 5.65, 0, 0);
  for (const s of [-1, 1]) {                         // the ruff: feather plates fanned out behind the head
    for (let k = 0; k < 3; k++) {
      const plate = new THREE.BoxGeometry(0.14, 1.9 - k * 0.35, 2.3 - k * 0.45);
      add(plate, x + dx * (2.3 + k * 0.65), y + 2.0 + k * 0.15, z + dz * (2.3 + k * 0.65), s * (0.5 + k * 0.12), 0.15, 1, 1, 1);
      plate.dispose();
    }
  }
  neck.dispose(); head.dispose(); beak.dispose();
}
// the crown: terraced arches (each tier a pair of crossed half-cylinders, so every face shows a semicircle and the corners fall
// into valleys), the tier-1 arches on the octagon's faces, the arch faces with their fans of windows, the rims, the spire
const CROWN = [   // [half-width a, springing s, vertical semi-axis b]: the model's tops (s + b), the arches a little stilted
  [10.3, 239.9 - 11.5, 11.5], [9.4, 247.2 - 10.5, 10.5], [8.3, 256.2 - 9.3, 9.3], [6.5, 263.9 - 7.3, 7.3], [4.1, 271.3 - 4.6, 4.6], [2.9, 279.1 - 4.4, 4.4],
  [1.5, 283.5, 5.3],
];
function chrCrown(F, A) {
  const NS = 24;
  const faces = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  // tier 1: an arch over each of the octagon's four 12.4 m faces, its vault running back 3.2 m into tier 2
  const yo = 227.1, r1 = 6.2;
  const lowT1 = (t) => yo;
  for (const n of faces) {
    const off = Math.abs(n[0]) ? 13.55 : 13.5;
    archFace(A, F, n, off, r1, yo, r1, lowT1, NS, 0.3, (u, y) => [u / (4 * 2.2), y / (4 * 3.6)]);
    vaultStrip(A('rib'), F, n, off, off - 3.4, r1, yo, r1, NS);
  }
  // tiers 2..8, each over the one below: what lies under a face at distance a (tangential u) is the octagon's roof or a
  // tier-1 vault for the first, then the crossed vaults of the tier below
  const lowOf = (k) => (u) => {
    const w = Math.abs(u);
    if (k === 0) return w < r1 ? yo + Math.sqrt(r1 * r1 - w * w) : yo;
    const [ap, sp, bp] = CROWN[k - 1], a = CROWN[k][0];
    const f = (x) => Math.sqrt(Math.max(0, 1 - (x * x) / (ap * ap)));
    return sp + bp * Math.max(f(Math.min(w, ap)), f(Math.min(a, ap)));
  };
  for (let k = 0; k < CROWN.length; k++) {
    const [a, s, b] = CROWN[k];
    for (const n of faces) archFace(A, F, n, a, a, s, b, lowOf(k), NS, k < 4 ? 0.34 : k < 6 ? 0.22 : 0.12);
    crossVault(A('rib'), F, a, s, b, NS);
  }
  // the spire: a plinth, the long tapering shaft with its rings, the needle
  const ySp = 288.8;
  cylT(A('steel'), F, 0, ySp - 0.6, 0, 1.15, 1.25, 1.6, 4, Math.PI / 4);
  cylT(A('steel'), F, 0, ySp + 1.0, 0, 0.2, 1.05, 316.6 - ySp - 1.0, 4, Math.PI / 4);
  for (const yy of [293, 298, 303.5]) cylT(A('steel'), F, 0, yy, 0, 0.95 - (yy - 290) * 0.03, 1.0 - (yy - 290) * 0.03, 0.35, 8);
  cylT(A('steel'), F, 0, 316.6, 0, 0.03, 0.12, 318.8 - 316.6, 6);
}
// a face's arch: the vertical face between the lower surface and the half-ellipse (the fan of windows painted on it), and the
// rim proud of it
function archFace(A, F, n, off, a, s, b, low, NS, rim, brickUV = null) {
  const t = [n[1], -n[0]];                              // to the right seen from outside
  const P = (u, d) => [n[0] * d + t[0] * u, n[1] * d + t[1] * u];
  const arc = [];
  for (let i = 0; i <= NS; i++) { const th = Math.PI - (Math.PI * i) / NS; arc.push([a * Math.cos(th), s + b * Math.sin(th)]); }
  for (let i = 0; i < NS; i++) {
    const [u0, y0] = arc[i], [u1, y1] = arc[i + 1];
    const l0 = Math.min(y0, low(u0)), l1 = Math.min(y1, low(u1));
    if (y0 - l0 < 0.02 && y1 - l1 < 0.02) continue;
    const pa = P(u0, off), pb = P(u1, off);
    const A3 = F.P(pa[0], pa[1]), B3 = F.P(pb[0], pb[1]), N = F.dir(n[0], n[1]);
    const U = (u) => u / (2 * a) + 0.5, V = (y) => Math.max(0, (y - s) / b);
    if (brickUV) A('brick').quad([A3[0], l0, A3[1]], [B3[0], l1, B3[1]], [B3[0], y1, B3[1]], [A3[0], y0, A3[1]], [N[0], 0, N[1]], brickUV(u0, l0), brickUV(u1, l1), brickUV(u1, y1), brickUV(u0, y0));
    else A('sun').quad([A3[0], l0, A3[1]], [B3[0], l1, B3[1]], [B3[0], y1, B3[1]], [A3[0], y0, A3[1]], [N[0], 0, N[1]], [U(u0), V(l0)], [U(u1), V(l1)], [U(u1), V(y1)], [U(u0), V(y0)]);
  }
  // the rays: steel ribs proud of the face between the triangular windows
  if (!brickUV && a > 2) {
    for (let k = 1; k < 11; k++) {                       // the painted fan's rays, at pi k / 11
      const th = (Math.PI * k) / 11, c = Math.cos(th), sN = Math.sin(th);
      const r0 = 0.5, r1 = 0.9, w = Math.max(0.1, a * 0.016), dp = Math.max(0.08, a * 0.012);
      const u0 = a * r0 * c, y0 = s + b * r0 * sN, u1 = a * r1 * c, y1 = s + b * r1 * sN;
      if (Math.min(y0, y1) < low((u0 + u1) / 2)) continue;
      const pa = P(u0, off + dp / 2), pb = P(u1, off + dp / 2);
      const ca = F.P(pa[0], pa[1]), cb2 = F.P(pb[0], pb[1]);
      const len = Math.hypot(cb2[0] - ca[0], y1 - y0, cb2[1] - ca[1]);
      const geo = new THREE.BoxGeometry(w, len, dp);
      const up = new THREE.Vector3(cb2[0] - ca[0], y1 - y0, cb2[1] - ca[1]).normalize();
      const N = F.dir(n[0], n[1]), zA = new THREE.Vector3(N[0], 0, N[1]);
      const xA = new THREE.Vector3().crossVectors(up, zA).normalize(), zB = new THREE.Vector3().crossVectors(xA, up).normalize();
      const m4 = new THREE.Matrix4().makeBasis(xA, up, zB).setPosition((ca[0] + cb2[0]) / 2, (y0 + y1) / 2, (ca[1] + cb2[1]) / 2);
      A('steelF').addGeo(geo, m4);
      geo.dispose();
    }
  }
  // the rim: a band round the arch, rim m proud of the face, from 0.92 of the arch out to the arch
  for (let i = 0; i < NS; i++) {
    const [u0, y0] = arc[i], [u1, y1] = arc[i + 1];
    const q = (u, y, f, d) => { const p = P(u * f, off + d), w = F.P(p[0], p[1]); return [w[0], s + (y - s) * f, w[1]]; };
    const N = F.dir(n[0], n[1]);
    if (Math.min(y0, y1) < low(u0) - 0.5 && Math.min(y0, y1) < low(u1) - 0.5) continue;
    A('steelF').quad(q(u0, y0, 0.9, rim), q(u1, y1, 0.9, rim), q(u1, y1, 1.0, rim), q(u0, y0, 1.0, rim), [N[0], 0, N[1]]);
    // the rim's soffit: from its inner edge back to the face, facing in toward the arch's centre
    const thm = Math.PI - (Math.PI * (i + 0.5)) / NS, sx = -b * Math.cos(thm), sy = -a * Math.sin(thm), sl = Math.hypot(sx, sy) || 1;
    const SD = F.dir(t[0] * sx / sl, t[1] * sx / sl);
    A('steelF').quad(q(u0, y0, 0.9, 0), q(u1, y1, 0.9, 0), q(u1, y1, 0.9, rim), q(u0, y0, 0.9, rim), [SD[0], sy / sl, SD[1]]);
    // its top: back from the rim's outer edge to the face
    const nm = [Math.cos(Math.PI - (Math.PI * (i + 0.5)) / NS), Math.sin(Math.PI - (Math.PI * (i + 0.5)) / NS)];
    const NT = F.dir(t[0] * nm[0] * b, t[1] * nm[0] * b);
    const nl = Math.hypot(NT[0], nm[1] * a, NT[1]) || 1;
    A('steelF').quad(q(u0, y0, 1.0, rim), q(u1, y1, 1.0, rim), q(u1, y1, 1.0, 0), q(u0, y0, 1.0, 0), [NT[0] / nl, (nm[1] * a) / nl, NT[1] / nl]);
  }
}
// the vault behind a single face's arch (tier 1): a half-cylinder from the face at d0 back to d1
function vaultStrip(acc, F, n, d0, d1, a, s, b, NS) {
  const t = [n[1], -n[0]];
  for (let i = 0; i < NS; i++) {
    const th0 = Math.PI - (Math.PI * i) / NS, th1 = Math.PI - (Math.PI * (i + 1)) / NS;
    const pt = (th, d) => { const u = a * Math.cos(th), p = F.P(n[0] * d + t[0] * u, n[1] * d + t[1] * u); return [p[0], s + b * Math.sin(th), p[1]]; };
    const nrm = (th) => { const nx = b * Math.cos(th), ny = a * Math.sin(th), l = Math.hypot(nx, ny) || 1; const D = F.dir(t[0] * nx / l, t[1] * nx / l); return [D[0], ny / l, D[1]]; };
    const na = nrm(th0), nb = nrm(th1);
    acc.quadN(pt(th0, d0), pt(th1, d0), pt(th1, d1), pt(th0, d1), na, nb, nb, na, [i / NS, 0], [(i + 1) / NS, 0], [(i + 1) / NS, (d0 - d1) / 4], [i / NS, (d0 - d1) / 4]);
  }
}
// a tier's crossed vaults: over each face a half-cylinder (its axis square to the face) from the face back to the diagonals
function crossVault(acc, F, a, s, b, NS) {
  for (const n of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const t = [n[1], -n[0]];
    for (let i = 0; i < NS; i++) {
      const th0 = Math.PI - (Math.PI * i) / NS, th1 = Math.PI - (Math.PI * (i + 1)) / NS;
      const u0 = a * Math.cos(th0), u1 = a * Math.cos(th1);
      const pt = (u, th, d) => { const p = F.P(n[0] * d + t[0] * u, n[1] * d + t[1] * u); return [p[0], s + b * Math.sin(th), p[1]]; };
      const nrm = (th) => { const nx = b * Math.cos(th), ny = a * Math.sin(th), l = Math.hypot(nx, ny) || 1; const D = F.dir(t[0] * nx / l, t[1] * nx / l); return [D[0], ny / l, D[1]]; };
      const na = nrm(th0), nb = nrm(th1);
      acc.quadN(pt(u0, th0, a), pt(u1, th1, a), pt(u1, th1, Math.abs(u1)), pt(u0, th0, Math.abs(u0)), na, nb, nb, na,
        [i / NS, 0], [(i + 1) / NS, 0], [(i + 1) / NS, (a - Math.abs(u1)) / 4], [i / NS, (a - Math.abs(u0)) / 4]);
    }
  }
}
