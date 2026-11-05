// lmWTC.js: the World Trade Center's towers on their compiled footprint rings (LM65, 2026-10-31).
//   buildOneWTC: Skidmore, Owings and Merrill, 2014. The square podium (200 ft a side, its concrete walls behind vertical
//     glass fins, the lobby glazed behind them at the plaza), then the shaft: the square's corners chamfered away floor by
//     floor so the faces become eight tall triangles, the upright ones vertical, the inverted ones leaning in, until the top
//     is the same square turned 45 degrees with its corners over the middles of the base's sides; the parapet at 1,368 ft,
//     the circular ring on the roof and the spire with its platforms to 1,776 ft. Heights from the city's 3D building model
//     (the podium, the roof, the ring, the spire's stages) scaled to the published roof.
//   build56Leonard: Herzog and de Meuron, 2017. Fifty-seven floors stacked like loose blocks: every floor plate's edges
//     shifted from the one below, a little at the bottom and up to several metres near the top, so floors cantilever out and
//     step back into terraces; floor-to-ceiling glass between white slab edges, glass railings on the terraces, the glazed
//     lobby under the first slab. Not in the 2014 city model: the published height (250 m) over the compiled footprint.
// Glass is painted light (the sky it reflects): a pale blue-grey base colour, low roughness and some metalness, so it reads
// from its reflections and not as a dark hole.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, rgbs, speckle, streaks, addMeshes, triCount } from './lmFacadeKit.js';
import { tile3, tileMat3, fill3, obox, ngon, ngonLathe, triN, fan } from './lmTierKit.js';

const { mat } = KIT;

/* --------------------------------------------------------------- frames */
// a square ring's frame: its centre, the unit axes of its first edge (A) and the perpendicular (B), its half sides
function squareFrame(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x / ring.length; cz += z / ring.length; }
  let best = 0, A = [1, 0];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; A = [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; }
  }
  const B = [-A[1], A[0]];
  let ha = 0, hb = 0;
  for (const [x, z] of ring) { ha = Math.max(ha, Math.abs((x - cx) * A[0] + (z - cz) * A[1])); hb = Math.max(hb, Math.abs((x - cx) * B[0] + (z - cz) * B[1])); }
  const P = (u, v) => [cx + A[0] * u + B[0] * v, cz + A[1] * u + B[1] * v];
  return { cx, cz, A, B, ha, hb, P, rot: Math.atan2(-A[1], A[0]) };
}

/* ------------------------------------------------------------- One WTC */
const OW = {
  podium: 57.6, roof: 417.0, deck: 406.9, ringTop: 427.1, ringR: [16.0, 21.0], spireTop: 541.3, floor: 4.02,
  // the spire's stages from the model: [y, radius] of its platforms (scaled to the published roof)
  stages: [[457.2, 2.2], [458.9, 3.1], [469.6, 2.8], [470.7, 2.8], [482.3, 2.6], [483.0, 2.6], [494.6, 2.4], [495.7, 2.4], [506.8, 2.0], [507.4, 2.0], [518.6, 1.6], [519.3, 1.6], [527.9, 1.2]],
};
// the curtain wall: panels 1.52 m wide, a floor 4.02 m: the vision glass over a darker spandrel, the mullions bright steel
function owGlassPaint(nx, ny) {
  return (ga, gb, go, W, H, r) => {
    const cw = W / nx, fh = H / ny;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = i * cw, y = j * fh, k = 0.94 + r() * 0.1;
      const gl = ga.createLinearGradient(0, y, 0, y + fh);
      gl.addColorStop(0, rgbs([176, 192, 206], k)); gl.addColorStop(0.7, rgbs([150, 168, 186], k)); gl.addColorStop(1, rgbs([136, 152, 170], k));
      ga.fillStyle = gl; ga.fillRect(x, y, cw, fh);
      fill3(null, gb, go, x, y, cw, fh, null, 130, 0.1, 0.25);
      if (r() < 0.1) { ga.fillStyle = 'rgba(70,80,92,0.25)'; ga.fillRect(x, y + fh * 0.1, cw, fh * 0.6); }    // a pane with the blinds down
      // the spandrel: the floor's slab edge behind the glass, a darker band
      fill3(ga, gb, go, x, y + fh * 0.82, cw, fh * 0.18, rgbs([128, 140, 152], k), 120, 0.14, 0.3);
    }
    for (let i = 0; i <= nx; i++) fill3(ga, gb, go, i * cw - 1.5, 0, 3, H, [210, 216, 222], 190, 0.3, 0.75);
    for (let j = 0; j <= ny; j++) fill3(ga, gb, go, 0, j * fh - 0.75, W, 1.5, [180, 188, 196], 160, 0.3, 0.7);
  };
}
// the podium's fins: tall prismatic glass blades over the concrete, catching the light in vertical stripes
function owFinPaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [186, 192, 196], 140, 0.45, 0.15);
  const n = 10, fw = W / n;
  for (let i = 0; i < n; i++) {
    const x = i * fw, k = 0.9 + r() * 0.2;
    const g = ga.createLinearGradient(x, 0, x + fw, 0);
    g.addColorStop(0, rgbs([168, 178, 186], k)); g.addColorStop(0.45, rgbs([226, 232, 236], k)); g.addColorStop(1, rgbs([150, 160, 168], k));
    ga.fillStyle = g; ga.fillRect(x + 1, 0, fw - 2, H);
    fill3(null, gb, go, x + 1, 0, fw - 2, H, null, 170, 0.12, 0.35);
    fill3(ga, gb, go, x - 1, 0, 2, H, [96, 102, 108], 90, 0.6, 0.2);
  }
  for (let y = 0; y < H; y += H / 4) fill3(ga, gb, go, 0, y, W, 2, [120, 126, 132], 110, 0.5, 0.3);
}
// the lobby behind the fins at the plaza: tall clear glass, the lights inside
function owLobbyPaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [70, 84, 96], 60, 0.08, 0.3);
  const g = ga.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(180,200,215,0.35)'); g.addColorStop(1, 'rgba(255,220,170,0.18)');
  ga.fillStyle = g; ga.fillRect(0, 0, W, H);
  for (let i = 0; i <= 4; i++) fill3(ga, gb, go, (i * W) / 4 - 2, 0, 4, H, [190, 196, 200], 170, 0.3, 0.7);
  fill3(ga, gb, go, 0, H * 0.55, W, 3, [190, 196, 200], 170, 0.3, 0.7);
}
// the ring on the roof: steel panels with joints
function owRingPaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [112, 118, 124], 140, 0.4, 0.6);
  for (let i = 0; i < 24; i++) fill3(ga, gb, go, (i * W) / 24, 0, 3, H, [80, 86, 92], 100, 0.5, 0.5);
  for (let j = 0; j < 5; j++) fill3(ga, gb, go, 0, (j * H) / 5, W, 3, [150, 156, 162], 170, 0.4, 0.6);
  fill3(ga, gb, go, 0, 0, W, H * 0.1, [196, 200, 204], 180, 0.4, 0.5);
  speckle(ga, 0, 0, W, H, r, 400, 0.05);
}
let _OW = null;
function owMats() {
  if (_OW) return _OW;
  const glass = tile3('ow-glass', 256, 256, owGlassPaint(4, 4), 201, 0.12); glass.nx = 4; glass.ny = 4;
  const fins = tile3('ow-fins', 256, 256, owFinPaint, 202, 0.4); fins.nx = 1; fins.ny = 1;
  const lobby = tile3('ow-lobby', 256, 256, owLobbyPaint, 203, 0.1); lobby.nx = 1; lobby.ny = 1;
  const ringT = tile3('ow-ring', 512, 128, owRingPaint, 204, 0.4);
  _OW = {
    tx: { glass, fins, lobby },
    glass: tileMat3('ow-glass', glass, { bump: 0.6 }),
    fins: tileMat3('ow-fins', fins, { bump: 1.0 }),
    lobby: tileMat3('ow-lobby', lobby, { bump: 0.5 }),
    ring: tileMat3('ow-ring', ringT, { bump: 0.8 }),
    steel: mat(0xd2d6da, { rough: 0.32, metal: 0.7, flat: false }),
    white: mat(0xe6e8ea, { rough: 0.45, metal: 0.3, flat: false }),
    roof: mat(0x8e9092, { rough: 0.8, flat: false }),
    plant: mat(0x6a6e72, { rough: 0.6, metal: 0.3, flat: false }),
  };
  return _OW;
}
// a planar quad mapped to the curtain wall tile: u along the horizontal `h` (metres / panel), v in absolute floors
function glassFace(acc, pts, n, tex, panel, floor, h) {
  const uv = (p) => [(p[0] * h[0] + p[2] * h[1]) / panel / tex.nx, p[1] / floor / tex.ny];
  if (pts.length === 3) triN(acc, pts[0], pts[1], pts[2], n, uv(pts[0]), uv(pts[1]), uv(pts[2]));
  else fan(acc, pts, n, uv);
}
export function buildOneWTC(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = squareFrame(ring);
  if (F.ha < 22 || F.hb < 22) return null;
  const M = owMats();
  const g = new THREE.Group();
  const GL = new Acc(), FN = new Acc(), LB = new Acc(), ST = new Acc(), WH = new Acc(), RF = new Acc(), RG = new Acc(), PL = new Acc();
  const s = Math.min(F.ha, F.hb) - 0.15;                     // the podium's half side
  const yP = OW.podium, yT = OW.roof;
  const C = [[s, -s], [s, s], [-s, s], [-s, -s]].map(([u, v]) => F.P(u, v));            // the base square's corners
  const Mid = C.map((c, i) => { const d = C[(i + 1) % 4]; return [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2]; });   // the top's corners
  const V3 = (p, y) => [p[0], y, p[1]];
  // ---- the podium: fins over the concrete, the lobby glazed behind them for the first 15 m, a steel band at the top
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const d = [ex / L, ez / L];
    let n = [d[1], -d[0]];
    if ((a[0] + b[0]) / 2 * n[0] + (a[1] + b[1]) / 2 * n[1] - (F.cx * n[0] + F.cz * n[1]) < 0) n = [-n[0], -n[1]];
    const rot = Math.atan2(-d[1], d[0]);
    const U = (p) => (p[0] * d[0] + p[1] * d[1]) / 1.05;
    const lobH = 15.2;
    // the lobby, set back 1.2 m behind the line of the fins
    const la = [a[0] - n[0] * 1.2 + d[0] * 1.2, a[1] - n[1] * 1.2 + d[1] * 1.2], lb = [b[0] - n[0] * 1.2 - d[0] * 1.2, b[1] - n[1] * 1.2 - d[1] * 1.2];
    LB.quad(V3(la, 0), V3(lb, 0), V3(lb, lobH), V3(la, lobH), [n[0], 0, n[1]], [U(la) / 3, 0], [U(lb) / 3, 0], [U(lb) / 3, 1], [U(la) / 3, 1]);
    // the podium wall over it, fins mapped 1.6 m apart
    FN.quad(V3(a, lobH), V3(b, lobH), V3(b, yP - 1.2), V3(a, yP - 1.2), [n[0], 0, n[1]], [U(a), lobH / 10], [U(b), lobH / 10], [U(b), (yP - 1.2) / 10], [U(a), (yP - 1.2) / 10]);
    // real blades every 1.6 m standing off the wall (they catch the light), and the fins' frame round the lobby
    const nb = Math.round(L / 1.05);
    for (let k = 1; k < nb; k++) {
      const t = k / nb, x = a[0] + ex * t + n[0] * 0.22, z = a[1] + ez * t + n[1] * 0.22;
      obox(ST, x, lobH, z, 0.08, yP - 1.2 - lobH, 0.42, rot);
    }
    obox(ST, (a[0] + b[0]) / 2 + n[0] * 0.3, lobH - 0.8, (a[1] + b[1]) / 2 + n[1] * 0.3, L, 0.8, 0.6, rot);          // the lintel over the lobby
    obox(ST, (a[0] + b[0]) / 2 + n[0] * 0.25, yP - 1.2, (a[1] + b[1]) / 2 + n[1] * 0.25, L + 0.4, 1.2, 0.5, rot);    // the podium's top band
    for (let k = 0; k <= 8; k++) {                                                                          // the lobby's mullions
      const t = 0.03 + 0.94 * k / 8, x = la[0] + (lb[0] - la[0]) * t + n[0] * 0.1, z = la[1] + (lb[1] - la[1]) * t + n[1] * 0.1;
      obox(ST, x, 0, z, 0.25, lobH, 0.3, rot);
    }
  }
  // ---- the shaft: the eight triangles from the podium to the roof
  const nT = 18;                                              // the triangles split in bands so the floors stay on whole rows
  for (let i = 0; i < 4; i++) {
    const a = C[i], b = C[(i + 1) % 4], m = Mid[i], prevM = Mid[(i + 3) % 4];
    // the upright triangle on side i: vertical, its apex the top corner over the side's middle
    const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez), d = [ex / L, ez / L];
    let n = [d[1], -d[0]];
    if ((m[0] - F.cx) * n[0] + (m[1] - F.cz) * n[1] < 0) n = [-n[0], -n[1]];
    glassFace(GL, [V3(a, yP), V3(b, yP), V3(m, yT)], [n[0], 0, n[1]], M.tx.glass, 1.52, OW.floor, d);
    // the inverted triangle at corner i: its base the roof's edge from the previous top corner to this side's, apex the corner
    const t0 = V3(prevM, yT), t1 = V3(m, yT), c0 = V3(a, yP);
    const e1 = [t1[0] - t0[0], 0, t1[2] - t0[2]], e2 = [c0[0] - t0[0], c0[1] - t0[1], c0[2] - t0[2]];
    let nn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...nn); nn = nn.map((v) => v / nl);
    const mid = [(t0[0] + t1[0] + c0[0]) / 3 - F.cx, (t0[2] + t1[2] + c0[2]) / 3 - F.cz];
    if (nn[0] * mid[0] + nn[2] * mid[1] < 0) nn = nn.map((v) => -v);
    const hd = [e1[0], e1[2]]; const hl = Math.hypot(...hd);
    glassFace(GL, [t0, t1, c0], nn, M.tx.glass, 1.52, OW.floor, [hd[0] / hl, hd[1] / hl]);
    // the steel trims on the triangles' shared edges: corner to top corner, both ways
    for (const [p, q] of [[a, m], [b, m]]) {
      const n2 = Math.max(4, Math.round((yT - yP) / 12));
      for (let k = 0; k < n2; k++) {
        const ta = k / n2, tb = (k + 1) / n2;
        const pa = [p[0] + (q[0] - p[0]) * ta, yP + (yT - yP) * ta, p[1] + (q[1] - p[1]) * ta], pb = [p[0] + (q[0] - p[0]) * tb, yP + (yT - yP) * tb, p[1] + (q[1] - p[1]) * tb];
        const dir = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]], dl = Math.hypot(...dir);
        const ctr = [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        const o = [ctr[0] - F.cx, ctr[2] - F.cz], ol = Math.hypot(...o) || 1;
        const geo = new THREE.BoxGeometry(0.28, dl, 0.28);
        const q4 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dir[0] / dl, dir[1] / dl, dir[2] / dl));
        ST.addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(ctr[0] + o[0] / ol * 0.06, ctr[1], ctr[2] + o[1] / ol * 0.06), q4, new THREE.Vector3(1, 1, 1)));
        geo.dispose();
      }
    }
  }
  // ---- the roof: the deck inside the parapet, the parapet's inner face, the ring, the spire
  const top = Mid.map((p) => [p[0], p[1]]);
  {
    const inner = top.map(([x, z]) => [F.cx + (x - F.cx) * 0.97, F.cz + (z - F.cz) * 0.97]);
    const pts = inner.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const [i, j, k] of tris) triN(RF, V3(inner[i], OW.deck), V3(inner[j], OW.deck), V3(inner[k], OW.deck), [0, 1, 0]);
    for (let i = 0; i < 4; i++) {                                    // the parapet's inner face and its cap
      const a = inner[i], b = inner[(i + 1) % 4], A = top[i], B = top[(i + 1) % 4];
      const mx = (a[0] + b[0]) / 2 - F.cx, mz = (a[1] + b[1]) / 2 - F.cz, ml = Math.hypot(mx, mz);
      PL.quad(V3(a, OW.deck), V3(b, OW.deck), V3(b, yT), V3(a, yT), [-mx / ml, 0, -mz / ml]);
      WH.quad(V3(a, yT), V3(b, yT), V3(B, yT), V3(A, yT), [0, 1, 0]);
    }
  }
  const [rcx, rcz] = [F.cx, F.cz];
  {
    const [r0, r1] = OW.ringR, seg = 48;
    for (let k = 0; k < seg; k++) {
      const t0 = (k / seg) * Math.PI * 2, t1 = ((k + 1) / seg) * Math.PI * 2;
      const o0 = [rcx + Math.cos(t0) * r1, rcz + Math.sin(t0) * r1], o1 = [rcx + Math.cos(t1) * r1, rcz + Math.sin(t1) * r1];
      const i0 = [rcx + Math.cos(t0) * r0, rcz + Math.sin(t0) * r0], i1 = [rcx + Math.cos(t1) * r0, rcz + Math.sin(t1) * r0];
      const tm = (t0 + t1) / 2, no = [Math.cos(tm), 0, Math.sin(tm)];
      RG.quad(V3(o0, OW.deck), V3(o1, OW.deck), V3(o1, OW.ringTop), V3(o0, OW.ringTop), no, [k / seg * 6, 0], [(k + 1) / seg * 6, 0], [(k + 1) / seg * 6, 1], [k / seg * 6, 1]);
      RG.quad(V3(i0, OW.deck), V3(i1, OW.deck), V3(i1, OW.ringTop), V3(i0, OW.ringTop), [-no[0], 0, -no[2]], [k / seg * 5, 0], [(k + 1) / seg * 5, 0], [(k + 1) / seg * 5, 1], [k / seg * 5, 1]);
      WH.quad(V3(i0, OW.ringTop), V3(i1, OW.ringTop), V3(o1, OW.ringTop), V3(o0, OW.ringTop), [0, 1, 0]);
    }
    // the ring's top rail and the plant on the deck inside it
    ngon(ST, rcx, rcz, OW.ringTop, OW.ringTop + 1.1, r1 + 0.1, r1 + 0.1, 48, 0, false);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + 0.3;
      obox(PL, rcx + Math.cos(a) * 9.5, OW.deck, rcz + Math.sin(a) * 9.5, 4.5, 3.2, 2.6, -a);
    }
  }
  // the spire: the mast from the deck, its platforms, the beacon
  {
    const S = OW.stages;
    ngon(WH, rcx, rcz, OW.deck, S[0][0], 1.1, 1.1, 10, 0, false);
    for (let q = 0; q < 4; q++) {                                    // its legs down into the ring and the struts out to the ring's wall
      const a = q * Math.PI / 2 + Math.PI / 4;
      obox(ST, rcx + Math.cos(a) * 1.9, OW.deck, rcz + Math.sin(a) * 1.9, 0.4, S[0][0] - OW.deck, 0.4, -a);
      for (const yy of [OW.deck + 6, OW.ringTop - 1.5]) {
        const L = OW.ringR[0] - 2.2, cx = rcx + Math.cos(a) * (2.2 + L / 2), cz = rcz + Math.sin(a) * (2.2 + L / 2);
        obox(ST, cx, yy, cz, L, 0.35, 0.35, -a);
      }
    }
    for (let k = 0; k + 1 < S.length; k++) {
      const [y0, r0] = S[k], [y1, r1] = S[k + 1];
      if (y1 - y0 < 2) { ngon(ST, rcx, rcz, y0, y1, r0 + 0.25, r1 + 0.25, 16, 0, true, true); continue; }   // a platform
      const rr = Math.min(r0, r1) * 0.62;                                                             // the mast between: a core and four legs with braces
      ngon(WH, rcx, rcz, y0, y1, rr * 0.45, rr * 0.45, 8, 0, false);
      for (let q = 0; q < 4; q++) {
        const a = q * Math.PI / 2 + Math.PI / 4;
        obox(ST, rcx + Math.cos(a) * rr, y0, rcz + Math.sin(a) * rr, 0.32, y1 - y0, 0.32, -a);
      }
      for (let yy = y0 + 2.5; yy < y1 - 1; yy += 2.5) ngon(ST, rcx, rcz, yy, yy + 0.18, rr + 0.12, rr + 0.12, 4, Math.PI / 4, false);
    }
    const yl = S[S.length - 1][0];
    ngonLathe(WH, rcx, rcz, yl, [[0.85, 0], [0.6, (OW.spireTop - yl) * 0.5], [0.3, (OW.spireTop - yl) * 0.92], [0.05, OW.spireTop - yl]], 10);
  }
  addMeshes(g, [[GL, M.glass, 'lm65:onewtc:glass'], [FN, M.fins, 'lm65:onewtc:podium'], [LB, M.lobby, 'lm65:onewtc:lobby'], [ST, M.steel, 'lm65:onewtc:steel'],
    [WH, M.white, 'lm65:onewtc:spire'], [RF, M.roof, 'lm65:onewtc:roof'], [RG, M.ring, 'lm65:onewtc:ring'], [PL, M.plant, 'lm65:onewtc:plant']]);
  g.userData.colliderBoxes = [{ x: F.cx, y: yP / 2, z: F.cz, w: 2 * s, h: yP, d: 2 * s, rotY: F.rot }, { x: F.cx, y: (yP + yT) / 2, z: F.cz, w: 1.5 * s, h: yT - yP, d: 1.5 * s, rotY: F.rot }];
  g.userData.tris = triCount([[GL], [FN], [LB], [ST], [WH], [RF], [RG], [PL]]);
  return g;
}

/* ------------------------------------------------------------ 56 Leonard */
function rnd(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let x = Math.imul(t ^ (t >>> 15), t | 1); x ^= x + Math.imul(x ^ (x >>> 7), x | 61); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; }; }
function leoGlassPaint(ga, gb, go, W, H, r) {
  const nx = 4, cw = W / nx;
  for (let i = 0; i < nx; i++) {
    const k = 0.92 + r() * 0.14, gl = ga.createLinearGradient(0, 0, 0, H);
    gl.addColorStop(0, rgbs([112, 128, 146], k)); gl.addColorStop(1, rgbs([70, 84, 102], k));
    ga.fillStyle = gl; ga.fillRect(i * cw, 0, cw, H);
    fill3(null, gb, go, i * cw, 0, cw, H, null, 130, 0.08, 0.25);
    if (r() < 0.3) { ga.fillStyle = `rgba(226,222,212,${(0.25 + r() * 0.3).toFixed(2)})`; ga.fillRect(i * cw + 2, 0, cw - 4, H * (0.2 + r() * 0.6)); }   // a curtain
  }
  for (let i = 0; i <= nx; i++) fill3(ga, gb, go, i * cw - 1.5, 0, 3, H, [196, 202, 206], 185, 0.3, 0.6);
}
let _LEO = null;
function leoMats() {
  if (_LEO) return _LEO;
  const glass = tile3('leo-glass', 256, 128, leoGlassPaint, 211, 0.1); glass.nx = 4; glass.ny = 1;
  _LEO = {
    tx: { glass },
    glass: tileMat3('leo-glass', glass, { bump: 0.5 }),
    slab: mat(0xe4d9c6, { rough: 0.5, flat: false }),
    rail: mat(0xb8c8d2, { rough: 0.1, metal: 0.3, flat: false }),
    roof: mat(0x9a9c9e, { rough: 0.8, flat: false }),
    lobby: mat(0x56646e, { rough: 0.08, metal: 0.4, flat: false }),
  };
  return _LEO;
}
export function build56Leonard(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = squareFrame(ring);
  if (F.ha < 10 || F.hb < 10) return null;
  const M = leoMats();
  const g = new THREE.Group();
  const GL = new Acc(), SL = new Acc(), RL = new Acc(), RF = new Acc(), LB = new Acc();
  const H = Math.max(200, Math.min(260, ctx.height > 150 ? ctx.height : 250));
  const nF = 57, yL = 8.0, fh = (H - yL - 3) / (nF - 1), slabT = 0.55;
  const hu = Math.min(F.ha - 1.2, 11.2), hv = Math.min(F.hb - 1.2, 10.6);     // the tower's half plate over the lot
  const r = rnd(5617);
  // the plates: up to 60 % of the height the edges drift a little; above it the stack breaks up into blocks of two to four
  // floors pushed out over the ones below on one or two sides (to 6 m at the top) or pulled in on another
  const plates = [];
  let cur = [0, 0, 0, 0], left = 0;
  for (let k = 0; k < nF; k++) {
    const t = k / (nF - 1);
    if (left <= 0) {
      if (t < 0.55) {
        const a = 0.25 + 0.9 * t;
        cur = [0, 1, 2, 3].map(() => (r() - 0.5) * 2 * a);
        left = 2 + Math.floor(r() * 3);
      } else {
        const a = 2.6 + 5.4 * Math.pow((t - 0.55) / 0.45, 0.8);
        cur = [0, 1, 2, 3].map(() => (r() < 0.5 ? (0.4 + 0.6 * r()) * a : -r() * a * 0.4));
        for (const [i, j] of [[0, 1], [2, 3]]) if (cur[i] > 0.3 * a && cur[j] > 0.3 * a) cur[r() < 0.5 ? i : j] *= -0.4;   // out on one side, in on the other
        left = 2 + Math.floor(r() * 3);
      }
    }
    left--;
    const grow = 1 + 0.16 * Math.max(0, (t - 0.7) / 0.3);
    plates.push([-hu * grow - cur[0], hu * grow + cur[1], -hv * grow - cur[2], hv * grow + cur[3]]);
  }
  const P3 = (u, y, v) => { const [x, z] = F.P(u, v); return [x, y, z]; };
  const NW = (n) => [F.A[0] * n[0] + F.B[0] * n[1], 0, F.A[1] * n[0] + F.B[1] * n[1]];
  const box4 = (acc, [u0, u1, v0, v1], y0, y1, mapped) => {
    const faces = [[[u0, v1], [u1, v1], [0, 1]], [[u1, v1], [u1, v0], [1, 0]], [[u1, v0], [u0, v0], [0, -1]], [[u0, v0], [u0, v1], [-1, 0]]];
    for (const [a, b, n] of faces) {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const uv = mapped ? [[0, 0], [L / 6, 0], [L / 6, 1], [0, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
      acc.quad(P3(a[0], y0, a[1]), P3(b[0], y0, b[1]), P3(b[0], y1, b[1]), P3(a[0], y1, a[1]), NW(n), ...uv);
    }
  };
  const cap = (acc, [u0, u1, v0, v1], y, up) => acc.quad(P3(u0, y, v0), P3(u1, y, v0), P3(u1, y, v1), P3(u0, y, v1), [0, up ? 1 : -1, 0]);
  const slab = (S, y0) => { box4(SL, S, y0 - slabT, y0, false); cap(SL, S, y0 - slabT, false); cap(SL, S, y0, true); };
  // a glass railing along one side of a slab
  const rail = (S, side, y) => {
    const [u0, u1, v0, v1] = S;
    const seg = side === 0 ? [[u0, v0], [u0, v1], [-1, 0]] : side === 1 ? [[u1, v1], [u1, v0], [1, 0]] : side === 2 ? [[u1, v0], [u0, v0], [0, -1]] : [[u0, v1], [u1, v1], [0, 1]];
    const [a, b, n] = seg;
    RL.quad(P3(a[0], y, a[1]), P3(b[0], y, b[1]), P3(b[0], y + 1.05, b[1]), P3(a[0], y + 1.05, a[1]), NW(n));
  };
  // the lobby, recessed under the first slab, and the floors
  box4(LB, [-hu + 1.5, hu - 1.5, -hv + 1.5, hv - 1.5], 0, yL, false);
  for (let k = 0; k < nF; k++) {
    const R0 = plates[k], y0 = yL + k * fh, y1 = y0 + fh - slabT, top = k === nF - 1;
    box4(GL, [R0[0] + 0.6, R0[1] - 0.6, R0[2] + 0.6, R0[3] - 0.6], y0, y1, true);            // the glass, set back behind the slab edge
    // the slab under the floor: the plate's edge, with a balcony run out on one or two sides on most floors (the stacked
    // balconies that give the shaft its rough outline)
    const S = [R0[0] - 0.2, R0[1] + 0.2, R0[2] - 0.2, R0[3] + 0.2];
    slab(S, y0);
    const nb = top ? 0 : r() < 0.8 ? 1 + (r() < 0.45 ? 1 : 0) : 0;
    for (let b = 0; b < nb; b++) {
      const side = Math.floor(r() * 4), ext = 1.0 + r() * 1.6, span = 0.35 + r() * 0.5, off = r() * (1 - span);
      let Bx;
      if (side === 0) { const L = R0[3] - R0[2]; Bx = [R0[0] - ext, R0[0], R0[2] + L * off, R0[2] + L * (off + span)]; }
      else if (side === 1) { const L = R0[3] - R0[2]; Bx = [R0[1], R0[1] + ext, R0[2] + L * off, R0[2] + L * (off + span)]; }
      else if (side === 2) { const L = R0[1] - R0[0]; Bx = [R0[0] + L * off, R0[0] + L * (off + span), R0[2] - ext, R0[2]]; }
      else { const L = R0[1] - R0[0]; Bx = [R0[0] + L * off, R0[0] + L * (off + span), R0[3], R0[3] + ext]; }
      slab(Bx, y0);
      rail(Bx, side, y0);
    }
    if (top) {                                                    // the roof: its slab, a parapet, the plant in a screened box
      box4(SL, S, y1, y1 + slabT + 1.1, false); cap(RF, S, y1 + slabT, true);
      const pl = [R0[0] * 0.45, R0[1] * 0.45, R0[2] * 0.45, R0[3] * 0.45];
      box4(SL, pl, y1 + slabT, y1 + slabT + 3.4, false); cap(RF, pl, y1 + slabT + 3.4, true);
      continue;
    }
    // a terrace where the plate above steps back from this one's edge: its railing
    const N = plates[k + 1];
    if (N[0] - R0[0] > 0.8) rail(S, 0, y0 + fh);
    if (R0[1] - N[1] > 0.8) rail(S, 1, y0 + fh);
    if (N[2] - R0[2] > 0.8) rail(S, 2, y0 + fh);
    if (R0[3] - N[3] > 0.8) rail(S, 3, y0 + fh);
  }
  addMeshes(g, [[GL, M.glass, 'lm65:56leonard:glass'], [SL, M.slab, 'lm65:56leonard:slabs'], [RL, M.rail, 'lm65:56leonard:railings'], [RF, M.roof, 'lm65:56leonard:roof'], [LB, M.lobby, 'lm65:56leonard:lobby']]);
  g.userData.colliderBoxes = [{ x: F.cx, y: H / 2, z: F.cz, w: 2 * hu, h: H, d: 2 * hv, rotY: F.rot }];
  g.userData.tris = triCount([[GL], [SL], [RL], [RF], [LB]]);
  return g;
}


/* ------------------------------------------------------------- the Oculus */
// Santiago Calatrava, 2016: the World Trade Center Transportation Hub's oval hall, 107 m long and 35 m wide, under two
// fans of white steel ribs. Each rib springs from the plaza on one side of the oval, curves over the hall to its spine, where
// the ribs of the two sides cross under the long skylight, and runs on up and out over the other side as a wing, the tips
// 49 m over the plaza at the middle and lower toward the ends, where the ribs fan out in plan. Glass between the ribs over the
// hall. From published dimensions over the compiled footprint (its long axis and length).
function ocFrame(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x / ring.length; cz += z / ring.length; }
  let best = 0, A = [1, 0];
  for (let i = 0; i < ring.length; i++) for (let j = i + 1; j < ring.length; j++) {
    const d = Math.hypot(ring[j][0] - ring[i][0], ring[j][1] - ring[i][1]);
    if (d > best) { best = d; A = [(ring[j][0] - ring[i][0]) / d, (ring[j][1] - ring[i][1]) / d]; }
  }
  // the centre: the middle of the extents along the axis and across it
  const B = [-A[1], A[0]];
  let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
  for (const [x, z] of ring) { const a = (x - cx) * A[0] + (z - cz) * A[1], b = (x - cx) * B[0] + (z - cz) * B[1]; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const mx = cx + A[0] * (a0 + a1) / 2 + B[0] * (b0 + b1) / 2, mz = cz + A[1] * (a0 + a1) / 2 + B[1] * (b0 + b1) / 2;
  return { L: a1 - a0, Wd: b1 - b0, P: (s, y, t) => [mx + A[0] * s + B[0] * t, y, mz + A[1] * s + B[1] * t], A, B, m: [mx, mz] };
}
// Catmull-Rom through points (each [s, y, t]), n samples a span
function crSpline(P, n = 6) {
  const out = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([0, 1, 2].map((c) => 0.5 * (2 * p1[c] + (-p0[c] + p2[c]) * t + (2 * p0[c] - 5 * p1[c] + 4 * p2[c] - p3[c]) * t2 + (-p0[c] + 3 * p1[c] - 3 * p2[c] + p3[c]) * t3)));
    }
  }
  out.push(P[P.length - 1]);
  return out;
}
// a tube of rectangular section along a polyline (world points), w wide along `side` (a unit vector), d deep (perpendicular to
// the path and `side`), tapering from w0, d0 to w1, d1
function ribTube(acc, pts, side, w0, d0, w1, d1) {
  const n = pts.length, frames = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2]; const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
    // the depth axis: perpendicular to the path and to `side`
    let ux = ty * side[2] - tz * side[1], uy = tz * side[0] - tx * side[2], uz = tx * side[1] - ty * side[0];
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const f = i / (n - 1), w = (w0 + (w1 - w0) * f) / 2, d = (d0 + (d1 - d0) * f) / 2, p = pts[i];
    frames.push([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a1, b1]) => [p[0] + side[0] * w * a1 + ux * d * b1, p[1] + side[1] * w * a1 + uy * d * b1, p[2] + side[2] * w * a1 + uz * d * b1]));
  }
  for (let i = 0; i + 1 < n; i++) for (let k = 0; k < 4; k++) {
    const a = frames[i][k], b = frames[i][(k + 1) % 4], c = frames[i + 1][(k + 1) % 4], d = frames[i + 1][k];
    const mx = (a[0] + b[0] + c[0] + d[0]) / 4 - (pts[i][0] + pts[i + 1][0]) / 2, my = (a[1] + b[1] + c[1] + d[1]) / 4 - (pts[i][1] + pts[i + 1][1]) / 2, mz = (a[2] + b[2] + c[2] + d[2]) / 4 - (pts[i][2] + pts[i + 1][2]) / 2;
    const ml = Math.hypot(mx, my, mz) || 1;
    acc.quad(a, b, c, d, [mx / ml, my / ml, mz / ml]);
  }
  const capN = (i, sgn) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]; const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l = Math.hypot(...v) || 1; return v.map((x) => (x / l) * sgn); };
  fan(acc, frames[n - 1], capN(n - 1, 1));
  fan(acc, frames[0], capN(0, -1));
}
let _OC = null;
function ocMats() {
  if (_OC) return _OC;
  _OC = {
    rib: mat(0xf1f1ee, { rough: 0.42, metal: 0.08, flat: false }),
    glass: mat(0xaebcc6, { rough: 0.12, metal: 0.35, flat: false }),
    dark: mat(0x2a3138, { rough: 0.15, metal: 0.3, flat: false }),
    stone: mat(0xe4e2dc, { rough: 0.6, flat: false, stone: { set: 'climestone', amt: 0.2, nrm: 0.3, rgh: 0.2, ashlar: 0.2 } }),
  };
  return _OC;
}
export function buildOculus(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const F = ocFrame(ring);
  if (F.L < 60 || F.L > 160) return null;
  const M = ocMats();
  const g = new THREE.Group();
  const RB = new Acc(), GL = new Acc(), DK = new Acc(), ST = new Acc();
  const L = Math.min(110, F.L), hL = L / 2, W0 = Math.min(17.5, F.Wd / 2 + 1);
  const fOf = (s) => Math.sqrt(Math.max(0, 1 - (s / hL) ** 2));
  const Wf = (s) => W0 * Math.pow(fOf(s), 0.75), Hc = (s) => 7 + 19 * fOf(s), Ht = (s) => 11 + 38 * Math.pow(fOf(s), 1.1), Wt = (s) => Wf(s) + 2 + 8 * fOf(s);
  const side = [F.A[0], 0, F.A[1]];
  const W = (s, y, t) => F.P(s, y, t);
  // the ribs: 57 a side, each from its foot over the spine to its tip on the other side, fanning out in plan toward the ends
  const nR = 57;
  for (const sg of [-1, 1]) for (let k = 0; k < nR; k++) {
    const s0 = -hL * 0.93 + (2 * hL * 0.93) * (k + (sg > 0 ? 0.25 : 0.75)) / nR;
    const f = fOf(s0), fan = 1 + 0.18 * (s0 / hL) ** 2;
    const sT = s0 * fan, sC = s0 * (1 + 0.1 * (s0 / hL) ** 2);
    const P = [[s0, 0, sg * Wf(s0)], [s0, Hc(s0) * 0.52, sg * Wf(s0) * 0.82], [sC, Hc(s0) * 0.9, sg * Wf(s0) * 0.33], [sC, Hc(s0), 0],
      [(sC + sT) / 2, Hc(s0) + (Ht(s0) - Hc(s0)) * 0.5, -sg * Wt(s0) * 0.52], [sT, Ht(s0), -sg * Wt(s0)]];
    const pts = crSpline(P, 5).map(([s, y, t]) => W(s, y, t));
    ribTube(RB, pts, side, 1.15 * (0.6 + 0.4 * f), 1.7, 0.5, 0.6);
  }
  // the vault's glass between the ribs: per side a surface from the foot line to the spine
  const nS = 40;
  for (const sg of [-1, 1]) for (let i = 0; i < nS; i++) {
    const sa = -hL * 0.93 + (2 * hL * 0.93) * i / nS, sb = -hL * 0.93 + (2 * hL * 0.93) * (i + 1) / nS;
    const prof = (s) => crSpline([[s, 0, sg * Wf(s)], [s, Hc(s) * 0.52, sg * Wf(s) * 0.82], [s, Hc(s) * 0.9, sg * Wf(s) * 0.33], [s, Hc(s) - 0.3, sg * 0.9]], 3);
    const A = prof(sa), B = prof(sb);
    for (let j = 0; j + 1 < A.length; j++) {
      const a = W(...A[j]), b = W(...B[j]), c = W(...B[j + 1]), d = W(...A[j + 1]);
      const mid = [(a[0] + c[0]) / 2 - F.m[0], 0, (a[2] + c[2]) / 2 - F.m[1]];
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(...n) || 1; n = n.map((v) => v / nl);
      if (n[0] * mid[0] + n[2] * mid[2] + n[1] * 0.3 < 0) n = n.map((v) => -v);
      GL.quad(a, b, c, d, n);
    }
  }
  // the ends of the vault, closed by the shortest arches; the skylight along the spine
  for (const se of [-hL * 0.93, hL * 0.93]) {
    const pr = crSpline([[se, 0, -Wf(se)], [se, Hc(se) * 0.9, -Wf(se) * 0.33], [se, Hc(se), 0], [se, Hc(se) * 0.9, Wf(se) * 0.33], [se, 0, Wf(se)]], 3).map((p) => W(...p));
    fan(GL, pr, [F.A[0] * Math.sign(se), 0, F.A[1] * Math.sign(se)]);
  }
  for (let i = 0; i < 30; i++) {
    const sa = -hL * 0.6 + (1.2 * hL) * i / 30, sb = -hL * 0.6 + (1.2 * hL) * (i + 1) / 30;
    DK.quad(W(sa, Hc(sa) + 0.05, -1.0), W(sb, Hc(sb) + 0.05, -1.0), W(sb, Hc(sb) + 0.05, 1.0), W(sa, Hc(sa) + 0.05, 1.0), [0, 1, 0]);
  }
  // the marble plaza round the oval
  {
    const pts = [];
    for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push(W(Math.cos(a) * (hL + 6), 0.12, Math.sin(a) * (W0 + 7))); }
    fan(ST, pts, [0, 1, 0]);
  }
  addMeshes(g, [[RB, M.rib, 'lm65:oculus:ribs'], [GL, M.glass, 'lm65:oculus:glass'], [DK, M.dark, 'lm65:oculus:skylight'], [ST, M.stone, 'lm65:oculus:plaza']]);
  g.userData.colliderBoxes = [{ x: F.m[0], y: 12, z: F.m[1], w: L, h: 24, d: 2 * W0, rotY: Math.atan2(-F.A[1], F.A[0]) }];
  g.userData.tris = triCount([[RB], [GL], [DK], [ST]]);
  return g;
}
