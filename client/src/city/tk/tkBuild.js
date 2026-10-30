// Tower kit (TW): the near level of one tower, built on the tiers assemble.js extruded for it (the same rings, heights and
// v datum as the tile facade), on the facade shader's bay and floor grid (city/tk/tkParams.js).
//
// What a tower is made of:
//   - merged per building (its own geometry: the footprint is its own): the wall with its openings and their reveals in the
//     record's colour (a PBR set's shared material, the tint per vertex), the glass of every opening or curtain-wall bay
//     (one quad per pane, tilted a little so no two panes mirror the sky alike; aTkW carries the pane's bay, floor, wall
//     seed and building seed for the lit rooms), spandrel panels and bands, string courses and the cornice;
//   - instanced by reference (one InstancedMesh per prototype and finish for the whole kit): window frames with their
//     meeting rail, stone sills and lintels, curtain-wall mullions and transoms, piers and fins, lobby columns.
// Frames are face frames (fk/kitGeom.js edgeFrame): u along the wall from ring[i + 1] to ring[i], y up from the building's
// base, w out of the wall. The shader's u runs the other way (from ring[i]), so a bay's index is counted from the far end.
import * as THREE from 'three';
import { Sink, edgeFrame, edgeMitres, quadW, quadU, quadY, poly } from '../fk/kitGeom.js';   // (FP18: poly)
import { ARCH, hash12, GLASS_FAMS, shaderRoom } from './tkParams.js';
import { cwGlassMat, winGlassMat, surfMat, partMat, tkFacadeMat, litWinMat } from './tkMats.js';

const OFF = 0.03;          // the kit's wall plane stands this far out of the tile's (hidden) wall
const PANE_TILT = 0.011;   // radians: a curtain-wall pane's tilt (float glass in its frame: the reflection breaks pane to pane)

// ---------------------------------------------------------------- prototypes (shared geometry, built once)
const PROTO = new Map();
// a box x in [-0.5, 0.5] (or [0, 1] with `x0`), y in [0, 1], z in [0, 1], without its back face (z = 0)
function unitBox(key, x0 = -0.5) {
  let g = PROTO.get(key);
  if (g) return g;
  const P = [], N = [], T = [], I = [];
  const x1 = x0 + 1;
  const face = (pts, n) => {
    const b = P.length / 3;
    for (const p of pts) { P.push(...p); N.push(...n); }
    T.push(0, 0, 1, 0, 1, 1, 0, 1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  face([[x0, 0, 1], [x1, 0, 1], [x1, 1, 1], [x0, 1, 1]], [0, 0, 1]);      // front
  face([[x1, 0, 1], [x1, 0, 0], [x1, 1, 0], [x1, 1, 1]], [1, 0, 0]);      // +x
  face([[x0, 0, 0], [x0, 0, 1], [x0, 1, 1], [x0, 1, 0]], [-1, 0, 0]);     // -x
  face([[x0, 1, 1], [x1, 1, 1], [x1, 1, 0], [x0, 1, 0]], [0, 1, 0]);      // top
  face([[x0, 0, 0], [x1, 0, 0], [x1, 0, 1], [x0, 0, 1]], [0, -1, 0]);     // bottom
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setIndex(I);
  g.userData.tkProto = key;
  PROTO.set(key, g);
  return g;
}
// a window frame (a unit opening x 0..1, y 0..1; the frame members a fixed size at the nominal opening W x H, so a
// prototype serves openings within its bucket): stiles, head, bottom rail, and the sash's own division
//   kind 'dh' a double-hung meeting rail at 0.52; 'fixed' none; 'slider' a vertical mullion at 0.5; 'case' a transom at 0.78
function frameProto(W, H, kind) {
  const key = `frame|${W.toFixed(2)}|${H.toFixed(2)}|${kind}`;
  let g = PROTO.get(key);
  if (g) return g;
  const P = [], N = [], T = [], I = [];
  const fw = 0.055, fd = 0.07;               // member face width and depth (m)
  const ax = fw / W, ay = fw / H;            // in unit coordinates
  const quad = (pts, n) => {
    const b = P.length / 3;
    for (const p of pts) { P.push(...p); N.push(...n); }
    T.push(0, 0, 1, 0, 1, 1, 0, 1);
    I.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // a member: the rectangle x0..x1, y0..y1 on the plane z = fd (its front), and the faces toward the glass
  const mem = (x0, x1, y0, y1, sides) => {
    quad([[x0, y0, fd], [x1, y0, fd], [x1, y1, fd], [x0, y1, fd]], [0, 0, 1]);
    if (sides.includes('r')) quad([[x1, y0, fd], [x1, y0, 0], [x1, y1, 0], [x1, y1, fd]], [1, 0, 0]);
    if (sides.includes('l')) quad([[x0, y0, 0], [x0, y0, fd], [x0, y1, fd], [x0, y1, 0]], [-1, 0, 0]);
    if (sides.includes('t')) quad([[x0, y1, fd], [x1, y1, fd], [x1, y1, 0], [x0, y1, 0]], [0, 1, 0]);
    if (sides.includes('b')) quad([[x0, y0, 0], [x1, y0, 0], [x1, y0, fd], [x0, y0, fd]], [0, -1, 0]);
  };
  mem(0, ax, 0, 1, 'r');                     // left stile
  mem(1 - ax, 1, 0, 1, 'l');                 // right stile
  mem(ax, 1 - ax, 1 - ay, 1, 'b');           // head
  mem(ax, 1 - ax, 0, ay * 1.4, 't');         // bottom rail
  if (kind === 'dh') mem(ax, 1 - ax, 0.52 - ay * 0.6, 0.52 + ay * 0.6, 'tb');
  else if (kind === 'slider') mem(0.5 - ax * 0.6, 0.5 + ax * 0.6, ay * 1.4, 1 - ay, 'lr');
  else if (kind === 'case') mem(ax, 1 - ax, 0.78 - ay * 0.5, 0.78 + ay * 0.5, 'tb');
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(T, 2));
  g.setIndex(I);
  g.userData.tkProto = key;
  PROTO.set(key, g);
  return g;
}
const bucket = (v, s) => Math.max(s, Math.round(v / s) * s);

// ---------------------------------------------------------------- facade-shader geometry
// A tower's walls and panes drawn by the tile facade shader itself (world/materials.js makeFacadeMaterial), with the
// attributes extrudePrism gives the tile's walls: the record's colour, uv (u along the wall from ring[i], v above the
// building's base), aux (floor height, bay width, shopfront height, style), aux2 (the wall's top, lit share, seed, flags),
// aux3 (the wall's length, its seed, door). The kit's wall stands where the tile's did, with real openings, reveals and
// recessed panes, so near and far are one shader: its stone and brick, weathering, grime, soot and streaks, the rooms,
// blinds and curtains in the windows and the lit rooms at night (the lead, 2026-10-11: the PBR walls read as clean CG).
export class FacSink {
  constructor() { this.P = []; this.N = []; this.C = []; this.T = []; this.A1 = []; this.A2 = []; this.A3 = []; this.I = []; this.n = 0; this.st = null; this.gfn = null; }
  wall(st) { this.st = st; }
  v(x, y, z, nx, ny, nz, tu, tv) {
    const s = this.st;
    this.P.push(x, y, z); this.N.push(nx, ny, nz); this.C.push(s.col[0], s.col[1], s.col[2]);
    this.T.push(s.L - tu, tv);
    this.A1.push(s.aux[0], s.aux[1], s.aux[2], s.aux[3]); this.A2.push(s.aux2[0], s.aux2[1], s.aux2[2], s.aux2[3]);
    this.A3.push(s.aux3[0], s.aux3[1], s.aux3[2]);
    return this.n++;
  }
  tri(a, b, c) { this.I.push(a, b, c); }
  build() {
    if (!this.I.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.T, 2));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.A1, 4));
    g.setAttribute('aux2', new THREE.Float32BufferAttribute(this.A2, 4));
    g.setAttribute('aux3', new THREE.Float32BufferAttribute(this.A3, 3));
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(new Float32Array(this.n), 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingBox(); g.computeBoundingSphere();
    return g;
  }
}
// the night look of a pane for the cell packages (P.nightQuads, the baker's region hold): the facade shader's rooms at full
// night (materials.js N11 OCCUPANCY: a share of 0.44 of the rooms lit in homes, 0.56 in offices, by the room hash) and a
// tower's floors (TOWERFX (e): a floor fully on at x2.5, a dark one at x0.28); a twelfth of the rooms cool
function litKind(P, cellU, cellV, ws) {
  const { id3 } = shaderRoom(cellU, cellV, ws, P.cvar);
  if (id3 < 1 - (P.shResi ? 0.44 : 0.56)) return null;
  let kind = hash12(cellU, cellV + 9.0) < 0.12 ? 'cool' : 'warm';
  if (P.height > 34) {
    const fLit = hash12(cellV * 3.71 + P.cvar * 61.0, 1.93);
    if (fLit <= 0.34) kind = 'dim'; else if (fLit >= 0.86 && kind === 'warm') kind = 'hi';
  }
  return kind;
}
function litQuad(out, F, P, u0, u1, y0, y1, w, cellU, cellV, ws) {
  if (!P.nightQuads) return;
  const k = litKind(P, cellU, cellV, ws);
  if (k) quadW(out.sink(litWinMat(k)), F, u0, u1, y0, y1, w);
}
const ONE3 = [1, 1, 1];
const FF_CORNICE = 1, FF_BLIND = 2;

// ---------------------------------------------------------------- the per-building output
class Out {
  constructor(org) {
    this.org = org;
    this.sinks = new Map();     // material (base) -> { mat, S }
    this.inst = new Map();      // `${proto}|${mat.uuid}` -> { geo, mat, M: number[], shadow }
    this.fac = new Map();       // facade material -> FacSink
    this.tris = 0;
  }
  facSink(mat) { let f = this.fac.get(mat); if (!f) this.fac.set(mat, (f = new FacSink())); return f; }
  sink(mat, we, tr) {
    const base = (mat.userData && mat.userData.fkBase) || mat;
    let e = this.sinks.get(base);
    if (!e) this.sinks.set(base, (e = { mat: base, S: new Sink() }));
    e.S.we = we || null;
    e.S.tr = (mat.userData && mat.userData.fkTr) || tr || (base.userData && base.userData.fkBaseHex ? ONE3 : null);   // (a shared set at its own tint: aFkTr 1)
    return e.S;
  }
  // one instance of geometry `geo` drawn with `mat`: the face frame F, at (u, y, w), scaled (sx, sy, sz) along (U, Y, N)
  put(geo, mat, F, u, y, w, sx, sy, sz, shadow = true) {
    const k = geo.userData.tkProto + '|' + mat.uuid;
    let e = this.inst.get(k);
    if (!e) this.inst.set(k, (e = { geo, mat, M: [], shadow }));
    const [X, Y, Z] = F.world(u, y, w);
    e.M.push(F.ux * sx, 0, F.uz * sx, 0, 0, sy, 0, 0, F.nx * sz, 0, F.nz * sz, 0, X, Y, Z, 1);
  }
  // the same, turned by `a` radians in the wall's plane (a diagrid member: its unit box's y axis along the member)
  putRot(geo, mat, F, u, y, w, a, sx, sy, sz, shadow = true) {
    const k = geo.userData.tkProto + '|' + mat.uuid;
    let e = this.inst.get(k);
    if (!e) this.inst.set(k, (e = { geo, mat, M: [], shadow }));
    const [X, Y, Z] = F.world(u, y, w);
    const c = Math.cos(a), s = Math.sin(a);
    // x' = c U + s Y (across the member), y' = -s U + c Y (along it)
    e.M.push(F.ux * c * sx, s * sx, F.uz * c * sx, 0, -F.ux * s * sy, c * sy, -F.uz * s * sy, 0, F.nx * sz, 0, F.nz * sz, 0, X, Y, Z, 1);
  }
}

// a pane: the quad u0..u1 x y0..y1 on the plane w, tilted by up to `amp` radians about its own axes (seeded) so no two
// panes mirror the sky alike; uv 0..1 over the pane (the shade line is drawn in it)
function paneQ(S, F, u0, u1, y0, y1, w, seed, amp) {
  if (u1 - u0 < 1e-4 || y1 - y0 < 1e-4) return;
  const h = (k) => { const x = Math.sin(seed * 12.9898 + k * 78.233) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; };
  const ta = amp ? h(1) * amp : 0, tb = amp ? h(2) * amp : 0;
  const um = (u0 + u1) / 2, yc = (y0 + y1) / 2, sa = Math.tan(ta), sb = Math.tan(tb);
  const nl = Math.sqrt(1 + sa * sa + sb * sb), nu = -sb / nl, ny = -sa / nl, nw = 1 / nl;
  const wx = nu * F.ux + nw * F.nx, wz = nu * F.uz + nw * F.nz;
  const b = S.n;
  for (const [u, y, tu, tv] of [[u0, y0, 0, 0], [u1, y0, 1, 0], [u1, y1, 1, 1], [u0, y1, 0, 1]]) {
    const ww = w + (y - yc) * sa + (u - um) * sb;
    S.v(F.ox + u * F.ux + ww * F.nx, F.y0 + y, F.oz + u * F.uz + ww * F.nz, wx, ny, wz, tu, tv, 0);
  }
  S.tri(b, b + 1, b + 2); S.tri(b, b + 2, b + 3);
}

// the lit-room attributes onto a built glass geometry (aTkW: bay, floor, wall seed, building seed; aTkS: the pane's size)
export function tkGlassAttrs(g, gl) {
  const n = g.attributes.position.count, A = new Float32Array(n * 4), B = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) { A[i] = gl.GW[i] || 0; B[i] = gl.GS[i] || 1; }
  g.setAttribute('aTkW', new THREE.BufferAttribute(A, 4));
  g.setAttribute('aTkS', new THREE.BufferAttribute(B, 4));
}

// ---------------------------------------------------------------- one tower
// rec: assemble.js's tower record ({ tiers: [{ ring, y0, y1, blind, store }], baseY, ... }), P: towerParams
export function buildTowerKit(rec, P) {
  const org = [Math.round(rec.cx), Math.round(rec.cz)];
  const out = new Out(org);
  const baseY = rec.baseY;
  const fH = P.floorH, wW = P.winW;
  const cvW = P.cvar + (P.shResi ? 4 : 0);
  const we = [P.cvI * 0.731 % 1, baseY, baseY + P.height];
  const wallM = P.glass || P.fac ? null : surfMat(P.wallSet, P.hex);
  const trimM = P.glass ? null : partMat(P.trimSet);
  const finM = partMat(P.finish);
  const lobbyM = surfMat(P.lobbySet || 'granite_grey');
  // the glass: one sink per material (a landmark may give each bay its own family: P.glassOf(face, bay, floor))
  const glassM0 = P.glass ? cwGlassMat(P.famObj || P.fam) : winGlassMat();
  const GL = new Map();
  const glassSink = (m) => { let g = GL.get(m); if (!g) GL.set(m, (g = { S: out.sink(m), GW: [], GS: [] })); return g; };
  // the lit-room attribute per vertex: a side stream on the glass sink (Sink has no slot for it), indexed by vertex
  // and aTkS = (pane width, pane height, the pane's sill above its floor, the floor height) for the room behind it
  let faceI = 0;
  const pane = (F, u0, u1, y0, y1, w, cellU, cellV, ws, tilt) => {
    const fam = P.glassOf ? P.glassOf(faceI, cellU, cellV) : null;
    const g = glassSink(fam ? cwGlassMat(fam) : glassM0), glassS = g.S, GW = g.GW, GS = g.GS;
    const n0 = glassS.n;
    paneQ(glassS, F, u0, u1, y0, y1, w, cellU * 7.31 + cellV * 3.17 + P.cvI, tilt);
    // (the packages' night window, baker only: in front of the tilted pane by more than its tilt moves its edges, which at
    // 5 mm cut through it over 56 m2 of a curtain wall: RG44, the Unreal duplicate gate)
    litQuad(out, F, P, u0, u1, y0, y1, w + 0.004 + (tilt || 0) * (Math.abs(u1 - u0) + Math.abs(y1 - y0)) * 0.5, cellU, cellV, ws);
    const sill = Math.max(0.05, y0 - cellV * fH);
    for (let i = n0; i < glassS.n; i++) {
      GW[i * 4] = cellU; GW[i * 4 + 1] = cellV; GW[i * 4 + 2] = ws; GW[i * 4 + 3] = cvW;
      GS[i * 4] = u1 - u0; GS[i * 4 + 1] = y1 - y0; GS[i * 4 + 2] = Math.min(sill, 3.0); GS[i * 4 + 3] = fH;
    }
  };
  const box = unitBox('box');
  const box0 = unitBox('box0', 0);

  for (let ti = 0; ti < rec.tiers.length; ti++) {
    const T = rec.tiers[ti];
    const ring = T.ring, n = ring.length;
    const vT0 = T.y0 - baseY, vTop = T.y1 - baseY;    // this tier's span in v (the base tier from the ground)
    let uAcc = 0;
    for (let i = 0; i < n; i++) {
      const A = ring[i], B = ring[(i + 1) % n];
      const L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (L < 0.05) continue;
      const wsRaw = (uAcc % 97) + i * 0.13;              // assemble.js extrudePrism: aux3.y
      uAcc += L;
      const ws = Math.floor(wsRaw * 128 + 0.5) / 128;      // the shader's wallSeed
      const F = edgeFrame(ring, i, baseY, org);
      const [m0, m1] = edgeMitres(ring, i);
      // the wall plane's ends, carried round the corners; not round a corner whose other side is a lot line (a neighbour's
      // wall continues in this plane there: the overlap gate's pairs at the party walls). The face frame runs from
      // ring[i + 1] (u = 0: the corner with edge i + 1) to ring[i] (u = L: the corner with edge i - 1).
      const bl = (k) => ti === 0 && k >= 0 && k < 32 && ((T.blind >> k) & 1);
      const e0 = bl((i + 1) % n) ? 0 : OFF * m0, e1 = bl((i - 1 + n) % n) ? 0 : OFF * m1;
      let blind = ti === 0 && i < 32 && ((T.blind >> i) & 1);
      const vLo = Math.max(0, vT0);
      // the shader's bays (a landmark may fit whole bays to the wall instead: P.bayFit)
      const bayN = P.bayFit ? Math.max(0, Math.round(L / wW)) : Math.floor((L - 0.44) / wW);
      const sideM = (L - Math.max(bayN, 0) * wW) * 0.5;
      faceI++;
      // the base: the tile keeps its shopfront band below storeH; elsewhere the kit draws a lobby
      const store = ti === 0 && P.storeH > 0;
      const vBase = ti === 0 ? (store ? P.storeH : P.lobbyH) : vLo;
      // the window rows: the shader's cells with the opening inside [0.15, top - 0.8] and above the base
      const cy0 = P.cell.y0, cy1 = P.cell.y1, cx0 = P.cell.x0, cx1 = P.cell.x1;
      const rows = [];
      for (let k = Math.max(0, Math.floor(vBase / fH)); (k + cy1) * fH <= vTop - 0.8 + 1e-3; k++) {
        const s = (k + cy0) * fH, h = (k + cy1) * fH;
        if (s < vBase + 0.25 || s < 0.15) continue;
        if (blind && !(vTop > 36 && s > 26)) continue;   // BW28: a lot-line wall opens above 26 m on a tower over 36 m
        rows.push({ k, s, h });
      }
      const cols = [];
      if (bayN >= 1) for (let j = 0; j < bayN; j++) {
        const cU = bayN - 1 - j;                           // the shader's bay index (from ring[i])
        const uL = sideM + j * wW;                         // this bay's left edge in the face frame
        cols.push({ j, cU, a: uL + cx0 * wW, b: uL + cx1 * wW, uL });
      }
      const fo = { L, e0, e1, vLo, vBase, vTop, rows, cols, ws, wsRaw, ti, store, blind, pane, finM, box, box0, i, rec, wallM, trimM, we,
        m0, m1, nb0: bl((i + 1) % n), nb1: bl((i - 1 + n) % n) };   // FP18: the corners' mitres and whether each neighbour is a lot line
      if (P.fac) {
        (P.glass ? curtainFaceF : masonryFaceF)(out, F, P, fo);
        // the shopfront band (the tile's is hidden with the walls): shops, or a plain wall on a lot line or a short face
        if (store && (blind || !retailFaceF(out, F, P, fo))) {
          const S = out.facSink(tkFacadeMat(P.wallSet || 'stone_lime'));
          S.wall(facWall(P, rec, fo, FF_BLIND));
          quadW(S, F, -e0, L + e1, 0, P.storeH, OFF);
        }
      } else if (P.glass) curtainFace(out, F, P, fo);
      else masonryFace(out, F, P, fo);
      if (ti === 0 && !store && P.lobbyH > 0) lobbyFace(out, F, P, { L, e0, e1, vBase, cols, pane, lobbyM, finM, box, box0, we, i, rec, ws });
    }
  }
  // the lit-room stream onto the glass geometry
  out.glass = GL;   // material -> { S, GW (aTkW per vertex), GS (aTkS per vertex) }
  return out;
}

// ---------------------------------------------------------------- masonry: punched windows with reveals
function masonryFace(out, F, P, o) {
  const { L, e0, e1, vBase, vTop, rows, cols, wallM, trimM, finM, box, we } = o;
  const S = out.sink(wallM, we);
  const u0 = -e0, u1 = L + e1;          // the wall's ends, round the corners
  const d = P.reveal;
  // horizontal bands between the window rows, and the piers between the openings within a row
  let vPrev = vBase;
  const band = (va, vb) => { if (vb - va > 0.005) quadW(S, F, u0, u1, va, vb, OFF); };
  // a deco tower's spandrels (P.spandrel: { set, tint }): between two rows of windows the panel under each opening stands
  // back from the pier face with the window, so a column of windows and spandrels reads as one recessed strip between
  // continuous piers (the Empire State Building's aluminium panels, 30 Rockefeller Plaza's); the wall stays on the piers
  const spM = P.spandrel && cols.length ? out.sink(surfMat(P.spandrel.set, P.spandrel.tint || null), we) : null;
  const zSp = -d * 0.55;
  const spandrelBand = (va, vb) => {
    if (vb - va <= 0.005) return;
    let uPrev = u0;
    for (const c of cols) {
      if (c.a - uPrev > 0.005) quadW(S, F, uPrev, c.a, va, vb, OFF);
      quadW(spM, F, c.a, c.b, va, vb, zSp);
      quadU(S, F, c.a, va, vb, zSp, OFF, 1);
      quadU(S, F, c.b, va, vb, zSp, OFF, -1);
      uPrev = c.b;
    }
    if (u1 - uPrev > 0.005) quadW(S, F, uPrev, u1, va, vb, OFF);
  };
  for (const r of rows) {
    if (spM && r !== rows[0]) spandrelBand(vPrev, r.s); else band(vPrev, r.s);
    if (cols.length) {
      let uPrev = u0;
      for (const c of cols) { if (c.a - uPrev > 0.005) quadW(S, F, uPrev, c.a, r.s, r.h, OFF); uPrev = c.b; }
      if (u1 - uPrev > 0.005) quadW(S, F, uPrev, u1, r.s, r.h, OFF);
    } else quadW(S, F, u0, u1, r.s, r.h, OFF);
    vPrev = r.h;
  }
  band(vPrev, vTop);
  if (!cols.length || !rows.length) return;
  // the openings: reveals (wall), the pane, the frame and the sill / lintel
  const Wn = cols[0].b - cols[0].a, Hn = rows[0].h - rows[0].s;
  const fp = frameProto(bucket(Wn, 0.25), bucket(Hn, 0.25), P.sash);
  const sillDeep = P.arch === ARCH.SLAB ? 0.03 : 0.065;
  const lintel = P.arch === ARCH.MASONRY;
  const mechS = P.mechEvery ? out.sink(surfMat('panel_grey', '#2c2e30'), null) : null;
  for (const r of rows) {
    // a mechanical floor (432 Park's every twelfth): the opening stands open to louvres deep in the floor
    if (P.mechEvery && (r.k + 1) % P.mechEvery === 0) {
      for (const c of cols) {
        quadU(S, F, c.a, r.s, r.h, -d - 0.6, OFF, 1); quadU(S, F, c.b, r.s, r.h, -d - 0.6, OFF, -1);
        quadY(S, F, c.a, c.b, r.h, -d - 0.6, OFF, -1); quadY(S, F, c.a, c.b, r.s, -d - 0.6, OFF, 1);
        quadW(mechS, F, c.a, c.b, r.s, r.h, -d - 0.6);
      }
      continue;
    }
    // (with recessed spandrels the head and sill step only from the window back to the spandrel's plane, and the strip
    // carries no proud sill)
    const headW = spM && r !== rows[rows.length - 1] ? zSp : OFF, sillW = spM && r !== rows[0] ? zSp : OFF;
    for (const c of cols) {
      // reveal: jambs, head soffit, sill (the wall's colour)
      quadU(S, F, c.a, r.s, r.h, -d, OFF, 1);
      quadU(S, F, c.b, r.s, r.h, -d, OFF, -1);
      quadY(S, F, c.a, c.b, r.h, -d, headW, -1);
      quadY(S, F, c.a, c.b, r.s, -d, sillW, 1);
      // the pane (lit rooms: the shader's bay and floor)
      o.pane(F, c.a, c.b, r.s, r.h, -d + 0.03, c.cU, r.k, o.ws, 0);
      // the frame, its front 7 cm proud of the pane's plane
      if (P.lite) continue;   // the lite level (beyond the kit's full radius): no frame, sill or lintel
      out.put(fp, finM, F, c.a, r.s, -d + 0.02, c.b - c.a, r.h - r.s, 1, false);
      // the sill: proud stone, 8 cm past the opening each side
      if (sillW === OFF) out.put(box, trimM, F, (c.a + c.b) / 2, r.s - 0.075, OFF, (c.b - c.a) + 0.16, 0.075, sillDeep, false);
      if (lintel) out.put(box, trimM, F, (c.a + c.b) / 2, r.h, OFF, (c.b - c.a) + 0.2, 0.2, 0.025, false);
    }
  }
  // deco: a proud brick pier between every pair of openings, base to top (the vertical the style is drawn with)
  if (P.piers && cols.length >= 2) {
    const pw = Math.max(0.22, (cols[1].a - cols[0].b) * 0.72);
    const sm = surfMat(P.wallSet, P.hex);
    const PS = out.sink(sm, we);
    for (let j = 0; j + 1 < cols.length; j++) {
      const um = (cols[j].b + cols[j + 1].a) / 2;
      const ya = rows[0].s - 0.4, yb = rows[rows.length - 1].h + 0.5;
      // merged (the wall's colour): front and sides
      quadW(PS, F, um - pw / 2, um + pw / 2, ya, yb, OFF + 0.11);
      quadU(PS, F, um - pw / 2, ya, yb, OFF, OFF + 0.11, -1);
      quadU(PS, F, um + pw / 2, ya, yb, OFF, OFF + 0.11, 1);
      quadY(PS, F, um - pw / 2, um + pw / 2, yb, OFF, OFF + 0.11, 1);
    }
  }
  // string courses: over the base and every 6 floors on the pre-war types, the cornice at the top
  if (P.belts) {
    const T = surfMat(P.trimSet === 'cast_stone' ? 'cast_stone' : 'stone_lime', null);
    const BS = out.sink(T, we);
    const course = (v, h, p) => {
      quadW(BS, F, -e0 - p, L + e1 + p, v, v + h, OFF + p);
      quadY(BS, F, -e0 - p, L + e1 + p, v + h, OFF, OFF + p, 1);
      quadY(BS, F, -e0 - p, L + e1 + p, v, OFF, OFF + p, -1);
    };
    if (o.ti === 0) course(vBase - 0.05, 0.42, 0.09);
    const r0 = rows.length ? rows[0].k : 0;
    for (const r of rows) if (r.k > r0 && (r.k - r0) % 6 === 0) course(r.s - 0.38, 0.22, 0.05);
    if (P.cornice && o.ti === o.rec.tiers.length - 1) {
      course(vTop - 1.25, 0.35, 0.18);
      course(vTop - 0.9, 0.55, 0.42);
      course(vTop - 0.35, 0.3, 0.62);
    }
  }
}

// ---------------------------------------------------------------- curtain walls
function curtainFace(out, F, P, o) {
  const { L, e0, e1, vBase, vTop, rows, cols, finM, box, ws } = o;
  const gIn = 0.10;                                 // the glass plane, behind the mullions' faces
  const A = P.arch;
  const spM = surfMat(A === ARCH.CW_RIBBON ? P.ribbonSet : 'panel_alu', A === ARCH.CW_RIBBON && P.ribbonSet !== 'panel_alu' ? null : P.spandrelHex);
  const SP = out.sink(spM, null);
  const u0 = -e0, u1 = L + e1;
  const fH = P.floorH;
  // the spandrel / slab-edge band of every floor from the base to the top: the panes are the floor's remaining height
  const k0 = Math.max(0, Math.ceil((vBase - 1e-3) / fH));
  const kTop = Math.floor((vTop - 0.3) / fH);
  // the parapet band over the last floor
  if (vTop - (kTop + 1) * fH > -1e-3) { /* the last floor ends at the wall top */ }
  const spH = Math.min(P.spandrelH, fH * 0.45);
  const proud = A === ARCH.CW_RIBBON ? 0.12 : 0.0;
  for (let k = k0; k <= kTop; k++) {
    const vb = k * fH, vt = Math.min((k + 1) * fH, vTop);
    if (vt - vb < 0.4) continue;
    // the spandrel at the floor line (its top at vb + spH)
    const sTop = Math.min(vt, vb + spH);
    if (proud > 0) {
      quadW(SP, F, u0, u1, vb, sTop, -gIn + 0.03 + proud);
      quadY(SP, F, u0, u1, sTop, -gIn, -gIn + 0.03 + proud, 1);
      quadY(SP, F, u0, u1, vb, -gIn, -gIn + 0.03 + proud, -1);
    } else quadW(SP, F, u0, u1, vb, sTop, -gIn + 0.012);
    // the panes: one per bay, from the spandrel to the next floor line
    if (cols.length) {
      for (const c of cols) pane4(o.pane, F, c.uL, c.uL + P.winW, sTop, vt, -gIn, c.cU, k, ws, PANE_TILT);
      // the margins at the corners: spandrel-coloured panels (a corner column)
      if (cols[0].uL - u0 > 0.01) quadW(SP, F, u0, cols[0].uL, sTop, vt, -gIn + 0.012);
      const ue = cols[cols.length - 1].uL + P.winW;
      if (u1 - ue > 0.01) quadW(SP, F, ue, u1, sTop, vt, -gIn + 0.012);
    } else quadW(SP, F, u0, u1, sTop, vt, -gIn + 0.012);
    // the transom over the spandrel (a horizontal mullion, the light catching its top)
    if (A !== ARCH.CW_RIBBON && !P.lite) out.put(box, finM, F, (u0 + u1) / 2, sTop - 0.03, -gIn, u1 - u0 - 0.01, 0.06, P.mullD * 0.55, false);   // (RG44: 5 mm short of the returns)
  }
  // the top band (above the last full floor) and the base band (from the base to the first floor line)
  const vEnd = Math.min(vTop, (kTop + 1) * fH);
  if (vTop - vEnd > 0.01) quadW(SP, F, u0, u1, vEnd, vTop, -gIn + 0.012);
  if (k0 * fH - vBase > 0.01) quadW(SP, F, u0, u1, vBase, k0 * fH, -gIn + 0.012);
  // the reveal of the glass plane at the wall's ends (the corner): a return from the glass to the wall line
  const SR = out.sink(spM, null);
  quadU(SR, F, u0, vBase, vTop, -gIn, OFF, -1);
  quadU(SR, F, u1, vBase, vTop, -gIn, OFF, 1);
  // vertical members: a mullion on every bay line (piers on the pier type), full height of the tier
  const h = vTop - vBase;
  if (h > 1 && cols.length) {
    const lines = [];
    for (let j = 0; j <= cols.length; j++) lines.push(cols[0].uL + j * P.winW);
    if (A === ARCH.CW_PIER) {
      const pm = partMat(P.pierSet);
      for (const u of lines) out.put(box, pm, F, u, vBase, -gIn, P.pierW, h - 0.04, P.pierD + gIn, true);
    } else {
      for (const u of lines) out.put(box, finM, F, u, vBase, -gIn, P.mullW, h - 0.04, P.mullD + gIn * 0.5, true);
    }
  }
  // a diagrid over the curtain wall (Hearst, 53 West 53rd): diamonds `P.diagrid.floors` floors high and two bays wide a
  // half, members of P.diagrid.w x P.diagrid.d standing proud of the mullions
  if (P.diagrid && h > 4 && L > 6) {
    const D = P.diagrid, dm = partMat(D.set || 'stainless');
    const hh = D.floors * P.floorH, ww = Math.max(3, Math.round(L / (D.span || 9)));
    const du = (u1 - u0) / ww;
    const v0 = vBase;
    for (let row = 0; v0 + row * hh < vTop - 0.5; row++) {
      const ya = v0 + row * hh, yb = Math.min(vTop, ya + hh), dy = yb - ya;
      for (let k = 0; k < ww; k++) {
        const ua = u0 + k * du;
        // the two members of a V or an inverted V, alternating by row: (ua, ya) -> (ua + du, yb) and (ua + du, ya) -> (ua, yb)
        const len = Math.hypot(du, dy), a = Math.atan2(du, dy);
        out.putRot(box, dm, F, ua, ya, -gIn, -a, D.w, len, D.d + gIn, true);
        out.putRot(box, dm, F, ua + du, ya, -gIn, a, D.w, len, D.d + gIn, true);
      }
      // the ring beam at each node level
      out.put(box, dm, F, (u0 + u1) / 2, ya - D.w * 0.5, -gIn, u1 - u0, D.w, D.d + gIn, true);
    }
  }
}
const pane4 = (fn, F, u0, u1, y0, y1, w, cellU, cellV, ws, tilt) => fn(F, u0, u1, y0, y1, w, cellU, cellV, ws, tilt);

// ---------------------------------------------------------------- the facade-shader faces (generic towers)
// the wall state of edge i for the facade shader (the tile's own attributes for this wall)
function facWall(P, rec, o, flags) {
  const k = flags & FF_BLIND ? 0.83 : 1;     // extrudePrism's colScale for a blind face (the blind branch skips the value curve)
  const col = rec.color || [rec.r, rec.g, rec.b];
  return { L: o.L, col: [col[0] / 255 * k, col[1] / 255 * k, col[2] / 255 * k], aux: [rec.floorH, rec.winW, rec.storeH || 0, rec.style],
    aux2: [o.vTop, rec.lit ?? 0.5, rec.colorVar, flags], aux3: [o.L, o.wsRaw, 0] };
}
function masonryFaceF(out, F, P, o) {
  const { L, e0, e1, vBase, vTop, rows, cols, box, rec } = o;
  const fm = tkFacadeMat(P.wallSet || 'stone_lime'), gm = tkFacadeMat('glass_vision_grey');
  const S = out.facSink(fm), G = out.facSink(gm);
  const fp = fp18Plan(P, rec, o);                    // FP18: the stone base, the courses and the cornice (null: none)
  // BF.CORNICE: the shader's cornice band at the top of the wall (FP18: not under a cornice drawn as geometry)
  const base = (rec.flags & 2) && !(fp && fp.corn) ? FF_CORNICE : 0;
  const wallF = base | (o.blind ? FF_BLIND : 0);
  const wallSt = facWall(P, rec, o, wallF);
  S.wall(wallSt);
  const u0 = -e0, u1 = L + e1, d = P.reveal;
  // (city v2, 2026-10-14: a lot-line face (BW28's windowed party wall) keeps to its own side of the line, 3 mm in, with no
  // trim proud of it: two neighbours each drew theirs 3 cm into the other, their windows on one bay grid, so a sill lay in
  // the neighbour's reveal and the overlap scan found the two towers' stone and brick in one plane)
  const W = o.blind ? -0.003 : OFF;
  // FP18: below the base's top and over the top storeys' string course (floor lines, so never inside a row of windows)
  // the wall is the stone's
  const yB = fp ? fp.yB : 0, yC = fp ? fp.yC : 0, baseSt = fp && (yB > 0 || yC > 0) ? fp.st(wallF) : null;
  const inStone = (v) => !!baseSt && ((yB > 0 && v < yB - 1e-3) || (yC > 0 && v > yC + 1e-3));
  const stAt = (v) => (inStone(v) ? baseSt : wallSt);
  let vPrev = vBase;
  const band = (va, vb) => {
    if (vb - va <= 0.005) return;
    const cuts = [va];
    for (const y of [yB, yC]) if (y > va + 0.005 && y < vb - 0.005) cuts.push(y);
    cuts.push(vb); cuts.sort((a, b) => a - b);
    for (let k = 0; k + 1 < cuts.length; k++) { S.wall(stAt((cuts[k] + cuts[k + 1]) / 2)); quadW(S, F, u0, u1, cuts[k], cuts[k + 1], W); }
  };
  for (const r of rows) {
    band(vPrev, r.s);
    S.wall(stAt(r.s));
    if (cols.length) {
      let uPrev = u0;
      for (const c of cols) { if (c.a - uPrev > 0.005) quadW(S, F, uPrev, c.a, r.s, r.h, W); uPrev = c.b; }
      if (u1 - uPrev > 0.005) quadW(S, F, uPrev, u1, r.s, r.h, W);
    } else quadW(S, F, u0, u1, r.s, r.h, W);
    vPrev = r.h;
  }
  band(vPrev, vTop);
  S.wall(wallSt);
  if (fp) fp18Trim(out, F, P, o, fp, S);
  if (!cols.length || !rows.length) return;
  const rev = facWall(P, rec, o, base | FF_BLIND), revB = baseSt ? fp.st(base | FF_BLIND) : rev;
  const glassSt = facWall(P, rec, o, base);
  // the backing: one pane across the face's window grid just behind the reveals. Unreal's Nanite simplifies a distant
  // facade by dropping its thin piers and spandrels, every quad its own island (a slab 860 m off showed the sky through
  // its walls, 2026-10-29); behind them this sheet shows the glass's windows instead, and one sheet is a surface it keeps
  G.wall(glassSt);
  quadW(G, F, Math.min(...cols.map((c) => c.a)), Math.max(...cols.map((c) => c.b)), Math.min(...rows.map((r) => r.s)),
    Math.max(...rows.map((r) => r.h)), -d - 0.01);
  const trimM = o.trimM;
  const sillDeep = P.arch === ARCH.SLAB ? 0.03 : 0.06;
  const lintel = P.arch === ARCH.MASONRY;
  const acRate = P.resi && (P.arch === ARCH.MASONRY || P.arch === ARCH.SLAB || P.arch === ARCH.DECO) ? 0.11 : 0;
  const acM = acRate ? partMat('panel_grey', '#cfcac0') : null;
  for (const r of rows) {
    for (const c of cols) {
      // the reveal (the wall's own stone or brick, blind), the pane recessed in it (the shader's window: room, blinds,
      // curtains, sash, the lit rooms at night), the sill and lintel proud of the wall
      S.wall(inStone((r.s + r.h) / 2) ? revB : rev);   // (FP18: the base's and the top storeys' openings in their stone)
      quadU(S, F, c.a, r.s, r.h, -d, W, 1);
      quadU(S, F, c.b, r.s, r.h, -d, W, -1);
      quadY(S, F, c.a, c.b, r.h, -d, W, -1);
      quadY(S, F, c.a, c.b, r.s, -d, W, 1);
      G.wall(glassSt);
      quadW(G, F, c.a, c.b, r.s, r.h, -d + 0.02);
      litQuad(out, F, P, c.a, c.b, r.s, r.h, -d + 0.025, c.cU, r.k, o.ws);
      if (P.lite || o.blind) continue;
      out.put(box, trimM, F, (c.a + c.b) / 2, r.s - 0.07, OFF, (c.b - c.a) + 0.14, 0.07, sillDeep, false);
      if (lintel) out.put(box, trimM, F, (c.a + c.b) / 2, r.h, OFF, (c.b - c.a) + 0.18, 0.18, 0.02, false);
      // a window air conditioner on the sill (residential towers; a seeded tenth of the windows below the top quarter)
      if (acRate && r.h < vTop * 0.78) {
        const hh = hash12(c.cU * 3.1 + r.k * 0.71, P.cvI * 0.37 + o.wsRaw);
        if (hh < acRate) out.put(box, acM, F, (c.a + c.b) / 2 + (hh * 9 % 1 - 0.5) * 0.25, r.s, -d * 0.4, 0.66, 0.44, d * 0.4 + 0.32, false);
      }
    }
    S.wall(wallSt);
  }
  if (P.fpBalc && P.arch === ARCH.SLAB && !o.blind && !P.lite && cols.length >= 3 && rows.length >= 4) fp18Balconies(out, F, P, o);
  // deco: a proud pier between every pair of openings (blind, the wall's colour)
  if (P.piers && cols.length >= 2 && !o.blind) {
    S.wall(rev);
    const pw = Math.max(0.22, (cols[1].a - cols[0].b) * 0.72);
    for (let j = 0; j + 1 < cols.length; j++) {
      const um = (cols[j].b + cols[j + 1].a) / 2;
      const ya = Math.max(rows[0].s - 0.4, baseSt ? yB + 0.45 : -1e9), yb = rows[rows.length - 1].h + 0.5;   // (FP18: from the base's belt)
      quadW(S, F, um - pw / 2, um + pw / 2, ya, yb, OFF + 0.11);
      quadU(S, F, um - pw / 2, ya, yb, OFF, OFF + 0.11, -1);
      quadU(S, F, um + pw / 2, ya, yb, OFF, OFF + 0.11, 1);
      quadY(S, F, um - pw / 2, um + pw / 2, yb, OFF, OFF + 0.11, 1);
    }
  }
}
// ---------------------------------------------------------------- FP18: the base, the courses and the cornice
// From the air a pre-war apartment or office block was a box with a window grid: one brick from the shopfront to the roof
// and a knife edge against the sky. What reads at a few hundred metres is the division into base, shaft and top: a stone
// base of two or three storeys under a belt course, a string course under the top storeys (over it, on three in five, the
// top two storeys in the stone: the capital), and the cornice, its corona
// 0.8-1.7 m proud of the wall on brackets over a bed moulding, a shadow line under the roof and a pale wash round it. All of
// it is the facade shader's own wall in the stone's colour and a stone building's style (the ashlar), so no material is
// added; the brackets are the kit's box in the trim's part material, as the sills are. A lot-line face carries none of it.
// (towerParams: P.fpStone, fpBase, fpCornice, fpTop, fpCap)
function fp18Plan(P, rec, o) {
  if (!P.fpStone || o.blind || (P.arch !== ARCH.MASONRY && P.arch !== ARCH.DECO)) return null;
  // the street wall's top tier takes the string course and the cornice (under a penthouse: the tier below it)
  const T = o.rec.tiers, nT = T.length;
  const last = o.ti === nT - 1 ? !T[o.ti].pent : o.ti === nT - 2 && !!T[nT - 1].pent;
  const yB = o.ti === 0 && P.fpBase > o.vBase + 1.2 && P.fpBase < o.vTop * 0.4 ? P.fpBase : 0;
  const corn = last && P.arch === ARCH.MASONRY && P.fpCornice > 0 && o.vTop > 12 ? P.fpCornice : 0;
  // the top storeys in the stone too (the capital: P.fpCap), over the string course under them
  const yC = last && P.fpCap && P.fpTop && o.rows.length >= 6 ? o.rows[o.rows.length - P.fpTop].k * P.floorH : 0;
  const st = (flags, roof = false) => {
    const s = facWall(P, rec, o, flags);
    const k = flags & FF_BLIND ? 0.83 : 1, c = P.fpStone;
    s.col = [c[0] / 255 * k, c[1] / 255 * k, c[2] / 255 * k];
    // the style of a stone building (the shader's ashlar); a roof face (the wash on a course): the pale pavers' membrane
    s.aux = [rec.floorH, rec.winW, roof ? 4 : rec.storeH || 0, 8];
    if (roof) { s.aux2 = [s.aux2[0], s.aux2[1], s.aux2[2], flags | 4]; s.aux3 = [0, 0, 0]; }
    return s;
  };
  return { yB, yC, corn, last, st };
}
function fp18Trim(out, F, P, o, fp, S) {
  const { L, rows, vTop, vBase } = o;
  const cl = (m) => Math.max(-1.5, Math.min(1.5, m));
  // the ends: carried round a corner into the neighbouring face's course, or stopped with an end of their own at a lot line
  const m0 = o.nb0 ? 0 : cl(o.m0), m1 = o.nb1 ? 0 : cl(o.m1);
  const ext = (w) => [-w * m0, L + w * m1];
  const stF = fp.st(FF_BLIND), stR = fp.st(FF_BLIND, true);
  // a course from ya to yb standing p proud of the wall: its face, the soffit, the ends and the wash on top
  const course = (ya, yb, p, top = true, wIn = OFF) => {
    if (yb - ya < 0.04) return;
    const w1 = OFF + p, [a0, a1] = ext(OFF), [b0, b1] = ext(w1);
    S.wall(stF);
    quadW(S, F, b0, b1, ya, yb, w1);
    poly(S, F, [[a0, ya, OFF], [a1, ya, OFF], [b1, ya, w1], [b0, ya, w1]], 0, -1, 0, [0, ya]);
    if (o.nb0) quadU(S, F, b0, ya, yb, wIn, w1, -1);
    if (o.nb1) quadU(S, F, b1, ya, yb, wIn, w1, 1);
    if (top) {
      const [c0, c1] = ext(wIn);
      S.wall(stR);
      poly(S, F, [[c0, yb, wIn], [c1, yb, wIn], [b1, yb, w1], [b0, yb, w1]], 0, 1, 0, [0, yb]);
    }
  };
  // clear of the sills over it and the lintels under it
  const clear = (lo, hi, y) => {
    for (const r of rows) { if (r.s > y) hi = Math.min(hi, r.s - 0.1); if (r.h < y) lo = Math.max(lo, r.h + 0.2); }
    return [lo, hi];
  };
  // the belt over the base (over the shopfronts or the lobby where the base is the ground storey alone)
  if (o.ti === 0) {
    const y = fp.yB || vBase;
    if (y > 2.5) { const [lo, hi] = clear(y - 0.12, y + 0.34, y); course(lo, hi, fp.yB ? 0.16 : 0.12); }
  }
  // the string course under the top storeys
  if (fp.last && P.fpTop && rows.length >= 6) {
    const y = rows[rows.length - P.fpTop].k * P.floorH;
    const [lo, hi] = clear(y - 0.1, y + 0.22, y);
    course(lo, hi, 0.09);
  }
  if (!fp.corn) return;
  // the cornice: the bed moulding over the last lintel, the corona on it, its top over the roof's edge (the parapet stands
  // behind it on the roof), the wash running back to the roof's edge and a face toward the roof. Under a penthouse it
  // crowns the street wall, the terrace's own parapet standing behind it.
  const Pc = fp.corn;
  const headTop = rows.length ? rows[rows.length - 1].h + 0.2 : vTop - 1;
  const bb = Math.max(headTop + 0.02, vTop - 0.8), cb = bb + 0.3, ct = Math.max(cb + 0.6, vTop + 0.3);
  course(bb, cb, 0.28, false);
  course(cb, ct, Pc, true, 0);
  S.wall(stF);
  quadW(S, F, 0, L, vTop, ct, 0, true);
  // the brackets under the corona, about 0.85 m apart (the full level only)
  if (P.lite) return;
  const nB = Math.floor((L - 0.6) / 0.85);
  if (nB < 1) return;
  const sp = (L - 0.6) / nB;
  for (let k = 0; k <= nB; k++) out.put(o.box, o.trimM, F, 0.3 + k * sp, bb + 0.02, OFF, 0.16, cb - bb - 0.02, Pc * 0.8, false);
}
// FP18: the balconies of a post-war apartment slab (the white- and tan-brick towers of 1950-80): a concrete slab at each
// floor line on stacks of one or two bays, a metal railing round it; from the air the stacks are the striped columns
// these towers are known by. Kit boxes in the trim's and the frame's part materials, as the sills are.
function fp18Balconies(out, F, P, o) {
  const { rows, cols, box, trimM, finM } = o;
  const B = P.fpBalc, fH = P.floorH, sp = B.span * P.winW - 0.16;
  for (let j = 0; j + B.span <= cols.length; j++) {
    if ((j + B.phase) % B.period) continue;
    const uC = cols[j].uL + (B.span * P.winW) / 2;
    for (const r of rows) {
      if (r === rows[0]) continue;
      const y = r.k * fH;
      out.put(box, trimM, F, uC, y - 0.18, OFF, sp, 0.18, B.d, true);
      out.put(box, finM, F, uC, y, OFF + B.d - 0.05, sp, 1.0, 0.05, true);
      out.put(box, finM, F, uC - sp / 2 + 0.025, y, OFF, 0.05, 1.0, B.d - 0.05, false);
      out.put(box, finM, F, uC + sp / 2 - 0.025, y, OFF, 0.05, 1.0, B.d - 0.05, false);
    }
    j += B.span - 1;
  }
}
function curtainFaceF(out, F, P, o) {
  const { L, e0, e1, vBase, vTop, cols, finM, box, rec } = o;
  const gIn = 0.10;
  const gm = tkFacadeMat(GLASS_FAMS[P.fam] ? 'glass_tower_' + (GLASS_FAMS[P.fam].key === 'blue' ? 'blue' : GLASS_FAMS[P.fam].key === 'silver' ? 'grey' : 'bronze') : 'glass_tower');
  const G = out.facSink(gm);
  const st = facWall(P, rec, o, 0);
  G.wall(st);
  const u0 = -e0, u1 = L + e1;
  // the curtain wall itself as the shader draws it (vision glass, spandrels, its reflections and rooms), set back behind
  // the mullions, and its returns to the wall line at the corners
  quadW(G, F, u0, u1, vBase, vTop, -gIn);
  // the backing: an opaque dark sheet 0.6 m behind the glass. Unreal draws the curtain glass dithered and the towers are
  // hollow, so a far tower showed the sky through its glass in a patch that crawled with the lens (2026-10-29)
  quadW(out.sink(partMat('panel_grey', '#1c1e22'), o.we), F, u0, u1, vBase, vTop, -gIn - 0.6);
  G.wall(facWall(P, rec, o, FF_BLIND));
  // (city v2: a lot-line face's returns end 3 mm inside the line and it has no members proud of it: two glass towers on one
  // lot line had their returns and their middle mullion in one plane, the overlap scan's glass on glass and alu on panel)
  const W = o.blind ? -0.003 : OFF;
  quadU(G, F, u0, vBase, vTop, -gIn, W, -1);
  quadU(G, F, u1, vBase, vTop, -gIn, W, 1);
  const h = vTop - vBase, fH = P.floorH;   // (the kit's floor height: never 0, the loops below count by it)
  if (h < 1) return;
  if (P.nightQuads && cols.length) {
    for (let f = Math.max(0, Math.ceil((vBase - 1e-3) / fH)); (f + 0.97) * fH <= vTop; f++) {
      for (const c of cols) litQuad(out, F, P, c.uL + 0.05 * P.winW, c.uL + 0.95 * P.winW, (f + 0.30) * fH, (f + 0.97) * fH, -gIn + 0.004 + PANE_TILT * (0.9 * P.winW + 0.67 * fH) * 0.5, c.cU, f, o.ws);   // (RG44: clear of the panes' tilt)
    }
  }
  // the vertical members on the shader's bay lines (stone piers on the pier type), full height, at the full level only:
  // from afar the facade shader draws a curtain wall's members itself (materials.js TOWERFX: the spandrel band of each
  // floor, a heavier line every 3rd or 4th bay), and real members on every bay had turned the far towers' horizontal
  // bands into vertical stripes, so the lite level is the shader's curtain wall as the tile draws it
  if (cols.length && !P.lite && !o.blind) {
    const lines = [];
    for (let j = 0; j <= cols.length; j++) lines.push(cols[0].uL + j * P.winW);
    if (P.arch === ARCH.CW_PIER) {
      const pm = partMat(P.pierSet);
      for (const u of lines) out.put(box, pm, F, u, vBase, -gIn, P.pierW, h - 0.04, P.pierD + gIn, true);
    } else for (const u of lines) out.put(box, finM, F, u, vBase, -gIn, P.mullW, h - 0.04, P.mullD + gIn * 0.5, true);
  }
  // the horizontals on the shader's spandrel lines (style 3: 0.05-0.30 of the floor, style 11: 0.05-0.17); the ribbon type's
  // spandrels stand proud as bands
  const sp1 = rec.style === 11 ? 0.17 : 0.30;
  const k0 = Math.max(0, Math.ceil((vBase - 1e-3) / fH)), k1 = Math.floor((vTop - 0.5) / fH);
  if (o.blind) { /* (city v2: no proud bands or transoms on a lot-line face) */ } else if (P.arch === ARCH.CW_RIBBON) {
    const k = 0.55;
    const col = rec.color || [rec.r, rec.g, rec.b];
    G.wall({ ...facWall(P, rec, o, FF_BLIND), col: [col[0] / 255 * k, col[1] / 255 * k, col[2] / 255 * k] });
    for (let f = k0; f <= k1; f++) {
      const ya = (f + 0.05) * fH, yb = (f + sp1) * fH;
      if (yb > vTop - 0.2) break;
      quadW(G, F, u0, u1, ya, yb, -gIn + 0.16);
      quadY(G, F, u0, u1, yb, -gIn, -gIn + 0.16, 1);
      quadY(G, F, u0, u1, ya, -gIn, -gIn + 0.16, -1);
    }
  } else if (!P.lite) {
    for (let f = k0; f <= k1; f++) {
      for (const fy of [0.05, sp1]) {
        const y = (f + fy) * fH;
        if (y > vTop - 0.2 || y < vBase) continue;
        out.put(box, finM, F, (u0 + u1) / 2, y - 0.035, -gIn, u1 - u0 - 0.01, 0.07, P.mullD * 0.6, false);   // (5 mm short of the returns: their ends were on the glass returns' plane, RG44)
      }
    }
  }
}

// the shopfront band of a generic tower (v 0..storeH): stone piers on the shader's 4 m shop bays, the shop glass set back
// between them (the facade shader's shop interior, goods and lighting: STORE faces), the sign band flush over it (the
// shader's fascia signs), a bulkhead under the glass, an awning over some bays
function retailFaceF(out, F, P, o) {
  const { L, e0, e1, box, rec } = o;
  const sH = P.storeH;
  if (sH < 2.6 || L < 4) return false;
  const S = out.facSink(tkFacadeMat('glass_storefront'));
  const STORE = 8;
  const glass = facWall(P, rec, o, STORE), blindSt = facWall(P, rec, o, FF_BLIND);
  glass.aux2 = [sH, glass.aux2[1], glass.aux2[2], STORE];
  const u0 = -e0, u1 = L + e1, rIn = 0.36, gTop = sH * 0.78, bulk = 0.32;
  // the shader's shop bays run from ring[i] every 4 m: in the face frame from L down
  const cuts = [u0];
  for (let k = 1; L - 4 * k > 0.8; k++) cuts.push(L - 4 * k);
  cuts.push(u1);
  cuts.sort((a, b) => a - b);
  const pierM = partMat(P.office || P.hotel ? 'granite_black' : 'granite_grey');
  const awnM = partMat('alu_black');
  const pw = 0.55;
  for (let k = 0; k + 1 < cuts.length; k++) {
    const a = cuts[k] + (k === 0 ? 0 : pw / 2), b = cuts[k + 1] - (k + 1 === cuts.length - 1 ? 0 : pw / 2);
    if (b - a < 0.6) continue;
    // the glass (the shop behind it is the shader's), its head and the bulkhead under it
    S.wall(glass);
    quadW(S, F, a, b, bulk, gTop, -rIn);
    S.wall(blindSt);
    quadY(S, F, a, b, gTop, -rIn, OFF, -1);
    quadW(S, F, a, b, 0, bulk, OFF);
    quadY(S, F, a, b, bulk, -rIn, OFF, 1);
    // (no jambs of its own: the piers' sides are the jambs; the two were one plane, the granite and the glass fighting in
    // every bay: RG44, the Unreal duplicate gate)
    // the sign band, flush, the shader's fascia
    S.wall(glass);
    quadW(S, F, a, b, gTop, sH, OFF);
    if (!P.lite && hash12(k * 7.7 + o.i, P.cvI * 0.13) < 0.35) out.put(box, awnM, F, (a + b) / 2, gTop - 0.12, OFF, b - a - 0.2, 0.12, 1.1, true);
  }
  // the piers between the bays and at the ends
  for (let k = 0; k < cuts.length; k++) {
    const u = cuts[k], w = k === 0 || k === cuts.length - 1 ? pw * 0.9 : pw;
    const uc = k === 0 ? u + w / 2 : k === cuts.length - 1 ? u - w / 2 : u;
    out.put(box, pierM, F, uc, 0, -rIn, w, sH, rIn + OFF + 0.12, true);
  }
  return true;
}

// ---------------------------------------------------------------- the lobby (a base without a shopfront band)
function lobbyFace(out, F, P, o) {
  const { L, e0, e1, vBase, cols, lobbyM, finM, box, we, i, rec } = o;
  if (vBase < 2.5) return;
  const S = out.sink(lobbyM, we);
  const u0 = -e0, u1 = L + e1;
  const headY = vBase - 0.9, sillY = 0.45, d = 0.32;
  // openings: every bay's width less a 0.5 m column, the door bay on the entrance wall glazed to the ground
  const ops = [];
  if (cols.length && L > 6) {
    for (const c of cols) ops.push({ a: c.uL + 0.28, b: c.uL + P.winW - 0.28, cU: c.cU });
  }
  // the stone: a band over the openings, the plinth under them, the columns between
  quadW(S, F, u0, u1, headY, vBase, OFF);
  quadW(S, F, u0, u1, 0, sillY, OFF);
  let uPrev = u0;
  for (const p of ops) { if (p.a - uPrev > 0.005) quadW(S, F, uPrev, p.a, sillY, headY, OFF); uPrev = p.b; }
  if (u1 - uPrev > 0.005) quadW(S, F, uPrev, u1, sillY, headY, OFF);
  if (!ops.length) return;
  const doorBay = i === rec.doorI && rec.doorPack >= 8 ? Math.floor(rec.doorPack / 8) - 1 : -1;
  for (const p of ops) {
    quadU(S, F, p.a, sillY, headY, -d, OFF, 1);
    quadU(S, F, p.b, sillY, headY, -d, OFF, -1);
    quadY(S, F, p.a, p.b, headY, -d, OFF, -1);
    quadY(S, F, p.a, p.b, sillY, -d, OFF, 1);
    o.pane(F, p.a, p.b, sillY, headY, -d + 0.03, p.cU, 0, o.ws, 0);
    // a transom bar and a centre mullion in the lobby glass
    if (P.lite) continue;
    out.put(box, finM, F, (p.a + p.b) / 2, headY - 0.95, -d + 0.02, p.b - p.a, 0.08, 0.08, false);
    out.put(box, finM, F, (p.a + p.b) / 2, sillY, -d + 0.02, 0.07, headY - sillY, 0.08, false);
    if (p.cU === doorBay) {
      // the entrance: a canopy over the door bay
      out.put(box, partMat('alu_black'), F, (p.a + p.b) / 2, headY - 0.05, OFF, (p.b - p.a) + 1.2, 0.28, 1.6, true);
    }
  }
}
