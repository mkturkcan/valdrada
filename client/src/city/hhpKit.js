// HIGHWAYS P2: the Henry Hudson Parkway's structures and edges (city/hhp.js lays the paving; this draws what stands on and
// under it), per tile, from the chains' edge codes and structure runs (hhp.json; dev tool p3hh_build.py):
//   m  the median barrier where the carriageways share one paving (NB draws it): a concrete strip between the two edges
//      and an F-shape safety barrier on it (0.81 m; NYSDOT standard shape)
//   r  a steel W-beam guide rail on steel posts 1.9 m apart, 0.5 m outside the edge (the parkway's open edges)
//   s  a stone parapet (0.45 m of granite ashlar, 0.95 m over the paving, a 0.55 m coping) on the 1930s arches, bridges
//      and the rotunda, its face carried down as the deck's fascia
//   c  a concrete parapet (0.8 m) with a two-tube steel rail on the viaducts
//   w  a stone parapet over a retaining wall where the ground falls away from the paving
//   k, g  kerbs (laid with the paving); o (a merge) and b (the median SB leaves to NB): nothing
// Wherever the paving stands over the ground beside it (0.4 m or more) its edge is a wall down to the ground (stone on the
// parkway, concrete on the ramps): the retained approaches, the humps the flat city needs over its crossings. On a
// structure run where the deck stands 3 m or more over the ground it is open: a slab and its girders (steel plate girders
// under the steel structures' decks), bents of concrete columns under a cap at the filed span (moved off the roads under
// them), stone-faced abutments where a deck meets its approach; the arches (concrete, stone-faced, 1937-38) are spandrel
// walls to the ground with the arch opening over what passes under, its barrel vault under the deck.
import { HHP, HHP_CH, hhpReady, hhpStructure } from './hhp.js';
import * as THREE from 'three';
import { Bag, mats, K } from './w125eKit.js';
import { pbrMaterial } from './mat/pbrLib.js';
import { roadsOf } from '../world/tiledata.js';
import { HA_P1, haGradeAt } from '../world/heightAuthority.js';
import { BOXES, boxAt, boxesAt } from './fdrBox.js';

const TILE = 512;
const COL = {
  stone: K(0x9a948a), stoneD: K(0x7d776f), coping: K(0x9d988e), conc: K(0xa7a298), concD: K(0x8f8a81), concU: K(0x7c7871),
  barrier: K(0xb5b0a5), steel: K(0x56615a), steelD: K(0x434c47), rail: K(0xa3a8aa), post: K(0x7d8286), soffit: K(0x6d6a64),
};
const owns = (ox, oz, x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;
// a station's shade of a material (+-9 %, hashed on the chain and station: the stones of a course, the pours of a wall)
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const tint = (col, a, b) => { const f = 0.91 + 0.18 * hash(a, b); return col.clone().multiplyScalar(f); };

// the masonry and concrete in the material library's stone (the terrain's built walls use the same): faces textured
// world-aligned at true size (u along the face's run, v up; a horizontal face by x, z), weathered from toe to top
const PBR = {
  ashlar: () => pbrMaterial('stone_lime_ashlar', { tint: '#a39e95', weatherAttr: true, dirt: 0.35, seed: 5, side: THREE.DoubleSide }),      // granite ashlar: parapets, spandrels, the rotunda
  rubble: () => pbrMaterial('stone_lime_rusticated', { tint: '#6f6a62', weatherAttr: true, dirt: 0.45, seed: 3, side: THREE.DoubleSide }), // Manhattan schist: retaining walls
  conc: () => pbrMaterial('concrete_board', { weatherAttr: true, dirt: 0.4, seed: 7, side: THREE.DoubleSide }),                             // board-formed concrete
  coping: () => pbrMaterial('granite_grey_flamed', { weatherAttr: true, dirt: 0.3, seed: 11, side: THREE.DoubleSide }),
};
class PBag {
  constructor() { this.b = new Map(); }
  face(key, pts, nrm, col, seed = 0) {
    let A = this.b.get(key); if (!A) this.b.set(key, (A = { p: [], n: [], uv: [], we: [] }));
    const ux = pts[1][0] - pts[0][0], uy = pts[1][1] - pts[0][1], uz = pts[1][2] - pts[0][2], vx = pts[2][0] - pts[0][0], vy = pts[2][1] - pts[0][1], vz = pts[2][2] - pts[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const P = nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0 ? pts.slice().reverse() : pts;
    if (nx * nrm[0] + ny * nrm[1] + nz * nrm[2] < 0) { nx = -nx; ny = -ny; nz = -nz; }
    let y0 = Infinity, y1 = -Infinity; for (const q of P) { y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
    const hz = Math.hypot(nx, nz) || 1, tx = -nz / hz, tz = nx / hz;
    const uvOf = (q) => (Math.abs(ny) > 0.7 ? [q[0], q[2]] : [q[0] * tx + q[2] * tz, q[1]]);
    for (let i = 1; i + 1 < P.length; i++) for (const q of [P[0], P[i], P[i + 1]]) { A.p.push(q[0], q[1], q[2]); A.n.push(nx, ny, nz); const uv = uvOf(q); A.uv.push(uv[0], uv[1]); A.we.push(seed, y0, y1); }
  }
  ext(key, F, y0, y1, col, o = {}) {
    let cx = 0, cz = 0; for (const p of F) { cx += p[0] / F.length; cz += p[1] / F.length; }
    if (o.top !== false) this.face(key, F.map(([x, z]) => [x, y1, z]), [0, 1, 0]);
    if (o.bot !== false) this.face(key, F.map(([x, z]) => [x, y0, z]), [0, -1, 0]);
    for (let i = 0; i < F.length; i++) {
      const a = F[i], b = F[(i + 1) % F.length];
      let nx = b[1] - a[1], nz = -(b[0] - a[0]); const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      if (((a[0] + b[0]) / 2 - cx) * nx + ((a[1] + b[1]) / 2 - cz) * nz < 0) { nx = -nx; nz = -nz; }
      this.face(key, [[a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]]], [nx, 0, nz]);
    }
  }
  flush(group, name) {
    let n = 0, tris = 0;
    for (const [key, A] of this.b) {
      if (!A.p.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(A.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(A.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(A.uv, 2));
      g.setAttribute('aWeather', new THREE.Float32BufferAttribute(A.we, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, PBR[key]());
      m.name = `hhp:${name}:${key}`; m.castShadow = true; m.receiveShadow = true;
      m.matrixAutoUpdate = false; m.updateMatrix();
      m.layers.enable(3);
      group.add(m); n++; tris += A.p.length / 9;
    }
    this.b.clear();
    return { meshes: n, tris };
  }
}

// a profile [[a, h] ...] (a across, along the path's outward normal; h up) swept along a path [{ p: [x, y, z], n: [nx, nz] }]
function sweep(B, mat, path, prof, col) {
  for (let k = 0; k + 1 < path.length; k++) {
    const A = path[k], Bp = path[k + 1];
    for (let j = 0; j + 1 < prof.length; j++) {
      const P = (q, pr) => [q.p[0] + q.n[0] * pr[0], q.p[1] + pr[1], q.p[2] + q.n[1] * pr[0]];
      const a0 = P(A, prof[j]), a1 = P(A, prof[j + 1]), b0 = P(Bp, prof[j]), b1 = P(Bp, prof[j + 1]);
      // the face's outward normal: the profile edge's normal (da, dh) -> (dh, -da), in the path's frame
      const da = prof[j + 1][0] - prof[j][0], dh = prof[j + 1][1] - prof[j][1], L = Math.hypot(da, dh) || 1;
      let na = dh / L, nh = -da / L;
      // (outward from the profile's solid, whichever way it was listed)
      let ca = 0, ch = 0; for (const q of prof) { ca += q[0] / prof.length; ch += q[1] / prof.length; }
      if (((prof[j][0] + prof[j + 1][0]) / 2 - ca) * na + ((prof[j][1] + prof[j + 1][1]) / 2 - ch) * nh < 0) { na = -na; nh = -nh; }
      const nn = [A.n[0] * na, nh, A.n[1] * na];
      B.face(mat, [a0, b0, b1, a1], nn, col);
    }
  }
}
// a vertical wall face between a top line and a bottom line (arrays of [x, y, z]), facing nrm (xz)
function wallFace(B, mat, top, bot, nrm, col) {
  for (let k = 0; k + 1 < top.length; k++) B.face(mat, [top[k], top[k + 1], bot[k + 1], bot[k]], [nrm[0], 0, nrm[1]], col);
}

export async function build(group, ctx) {
  if (!HHP || !(await hhpReady()) || !HHP_CH.length) return;
  const { ox, oz, tile, sampleT } = ctx;
  const M = mats(), B = new Bag(), PB = new PBag();
  const ground = (x, z) => { const g = sampleT(x, z); return Number.isFinite(g) ? g : 3.24; };
  // the roads under the decks (bents keep off them)
  const under = [];
  if (tile && tile.S.roadVerts) {
    const RV = tile.S.roadVerts;
    for (const r of roadsOf(tile)) {
      if (r.segId >= 900000000 || r.rclass === 6) continue;
      for (let j = 0; j + 1 < r.len; j++) under.push([RV[(r.start + j) * 3] + ox, RV[(r.start + j) * 3 + 1], RV[(r.start + j) * 3 + 2] + oz, RV[(r.start + j + 1) * 3] + ox, RV[(r.start + j + 1) * 3 + 2] + oz, r.width / 2 + 0.8]);
    }
  }
  const onRoad = (x, z, yTop) => under.some(([ax, ay, az, bx, bz, hw]) => {
    if (ay > yTop - 2) return false;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
    return Math.hypot(ax + dx * t - x, az + dz * t - z) < hw;
  });
  const stats = { barrier: 0, rail: 0, parapet: 0, walls: 0, decks: 0, bents: 0, arches: 0 };
  for (const c of HHP_CH) {
    const sOf = new Int16Array(c.n).fill(-1);   // the structure index over each station (not covers)
    c.structs.forEach((q, k) => { if ((q.kind !== 'cover' && q.kind !== 'under')) for (let i = q.i0; i <= q.i1; i++) sOf[i] = k; });
    const underAt = new Uint8Array(c.n);   // (the covered drive: no retaining wall or wall to the ground; the deck over it is the park's)
    const deckRel = new Float32Array(c.n).fill(NaN);   // (the deck's height over the drive along each covered run: one smooth level, the median of the authority's grade over it)
    c.structs.forEach((q) => {
      if (q.kind !== 'under') return;
      const i0 = Math.max(0, q.i0 - 3), i1 = Math.min(c.n - 1, q.i1 + 3), r = [];
      for (let i = i0; i <= i1; i++) { underAt[i] = 1; if (HA_P1) { const g = haGradeAt(c.X[i], c.Z[i]); if (g !== null) r.push(g - c.Y[i]); } }
      r.sort((a, b) => a - b);
      const m = r.length ? r[r.length >> 1] : NaN;
      for (let i = i0; i <= i1; i++) deckRel[i] = m;
    });
    const edgePt = (i, sg, extra = 0) => {
      const w = (sg < 0 ? c.WL[i] : c.WR[i]) + extra;
      return [c.X[i] + c.NX[i] * sg * w, c.Y[i] + c.E[i] * sg * (sg < 0 ? c.WL[i] : c.WR[i]), c.Z[i] + c.NZ[i] * sg * w];
    };
    for (let i = 0; i + 1 < c.n; i++) {
      const mx = (c.X[i] + c.X[i + 1]) / 2, mz = (c.Z[i] + c.Z[i + 1]) / 2;
      if (!owns(ox, oz, mx, mz)) continue;
      const st = sOf[i] >= 0 ? c.structs[sOf[i]] : null;
      for (const sg of [-1, 1]) {
        const code = (sg < 0 ? c.edgeL : c.edgeR)[i];
        if (code === 'o' || code === 'b') continue;
        const out = [c.NX[i] * sg, c.NZ[i] * sg];
        const A = edgePt(i, sg), Bq = edgePt(i + 1, sg);
        const path = [{ p: A, n: [c.NX[i] * sg, c.NZ[i] * sg] }, { p: Bq, n: [c.NX[i + 1] * sg, c.NZ[i + 1] * sg] }];
        if (code === 'm' && HHP_CH.some((q) => q.id === c.pair) && !(HA_P1 && BOXES.length && boxAt(mx, mz) && Math.abs(HHP_CH.find((q) => q.id === c.pair).Y[Math.min(HHP_CH.find((q) => q.id === c.pair).n - 1, i)] - c.Y[i]) > 1.0)) {
          // the median: the strip to the paired carriageway's edge, the barrier on its middle line
          const o = HHP_CH.find((q) => q.id === c.pair);
          const near = (p) => { let j = 0, bd = Infinity; for (let k = 0; k < o.n; k += 1) { const d = (o.X[k] - p[0]) ** 2 + (o.Z[k] - p[2]) ** 2; if (d < bd) { bd = d; j = k; } } return j; };
          const jA = near(A), jB = near(Bq);
          const sA = [o.X[jA] - o.NX[jA] * o.WL[jA], o.Y[jA] - o.E[jA] * o.WL[jA], o.Z[jA] - o.NZ[jA] * o.WL[jA]];
          const sB = [o.X[jB] - o.NX[jB] * o.WL[jB], o.Y[jB] - o.E[jB] * o.WL[jB], o.Z[jB] - o.NZ[jB] * o.WL[jB]];
          const mid = (p, q) => [(p[0] + q[0]) / 2, Math.max(p[1], q[1]), (p[2] + q[2]) / 2];
          const mA = mid(A, sA), mB = mid(Bq, sB);
          const gap = Math.hypot(A[0] - sA[0], A[2] - sA[2]);
          if (gap > 0.7) {
            // the raised strip between the edges (0.15 m), its two kerb faces
            const up = (p) => [p[0], p[1] + 0.15, p[2]];
            PB.face('conc', [up(A), up(Bq), up(sB), up(sA)], [0, 1, 0]);
            wallFace(PB, 'conc', [up(A), up(Bq)], [A, Bq], [-out[0], -out[1]], COL.conc);
            wallFace(PB, 'conc', [up(sA), up(sB)], [sA, sB], out, COL.conc);
          }
          const base = gap > 0.7 ? 0.15 : 0;
          // F-shape: 0.61 m base, 0.076 m reveal, the slope break at 0.33 m, 0.15 m top at 0.81 m
          const F = [[-0.305, base], [-0.29, base + 0.076], [-0.18, base + 0.33], [-0.075, base + 0.81], [0.075, base + 0.81], [0.18, base + 0.33], [0.29, base + 0.076], [0.305, base]];
          sweep(PB, 'conc', [{ p: mA, n: out }, { p: mB, n: [c.NX[i + 1] * sg, c.NZ[i + 1] * sg] }], F, COL.barrier);
          stats.barrier++;
          continue;
        }
        // the ground outside the edge (1 m out) and how far the paving stands over it
        const gA = ground(A[0] + out[0] * 1.0, A[2] + out[1] * 1.0), gB = ground(Bq[0] + out[0] * 1.0, Bq[2] + out[1] * 1.0);
        const over = Math.max(A[1] - gA, Bq[1] - gB);
        const open = st && st.kind !== 'arch' && st.kind !== 'rotunda' && !st.garage && over >= 3.0;
        const stoneish = c.kind !== 'ramp' || (st && st.mat === 'stone');
        if (code === 'r') {
          // W-beam on posts (a post every 1.9 m along the run: at this station when its distance is a multiple)
          const rail = [[0.5, 0.53], [0.56, 0.6], [0.5, 0.68], [0.56, 0.76], [0.5, 0.84]];
          sweep(B, M.rail, path, rail.map(([a, h]) => [a, h]), COL.rail);
          if (Math.floor(c.S[i + 1] / 1.905) !== Math.floor(c.S[i] / 1.905)) {
            const px = A[0] + out[0] * 0.62, pz = A[2] + out[1] * 0.62, g = Math.min(A[1] - 0.15, ground(px, pz));
            B.ext(M.steel, [[px - 0.08, pz - 0.08], [px + 0.08, pz - 0.08], [px + 0.08, pz + 0.08], [px - 0.08, pz + 0.08]], g - 0.1, A[1] + 0.8, COL.post);
          }
          stats.rail++;
        } else if (code === 's' || code === 'w' || code === 'c') {
          const conc = code === 'c';
          // the parapet: stone, 0.45 m thick, 0.95 m, a coping; or concrete 0.35 m, 0.8 m, and a two-tube rail
          const P = conc ? [[0, 0], [0, 0.8], [0.35, 0.8], [0.35, -0.05]] : [[0, 0], [0, 0.88], [-0.05, 0.88], [-0.05, 1.0], [0.5, 1.0], [0.5, 0.88], [0.45, 0.88], [0.45, -0.05]];
          if (conc) sweep(PB, 'conc', path, P, COL.conc);
          else {   // the wall in ashlar, the coping in flamed granite
            sweep(PB, 'ashlar', path, [[0.45, -0.05], [0.45, 0.88], [0, 0.88], [0, 0], [0.45, -0.05]].reverse(), COL.stone);
            sweep(PB, 'coping', path, [[-0.05, 0.88], [-0.05, 1.0], [0.5, 1.0], [0.5, 0.88], [-0.05, 0.88]], COL.stone);
          }
          if (conc) {
            for (const h of [0.95, 1.07]) sweep(B, M.steel, path, [[0.1, h - 0.03], [0.1, h + 0.03], [0.22, h + 0.03], [0.22, h - 0.03], [0.1, h - 0.03]], COL.steel);
            if (Math.floor(c.S[i + 1] / 2.4) !== Math.floor(c.S[i] / 2.4)) {
              const px = A[0] + out[0] * 0.16, pz = A[2] + out[1] * 0.16;
              B.ext(M.steel, [[px - 0.04, pz - 0.04], [px + 0.04, pz - 0.04], [px + 0.04, pz + 0.04], [px - 0.04, pz + 0.04]], A[1] + 0.8, A[1] + 1.1, COL.steel, { bot: false });
            }
          }
          stats.parapet++;
        }
        // the bank rising behind the edge (the corridor's ground is held at the edge's level for 0.8 m and climbs to the
        // natural ground by 1.5 m: hhp.js clampCorridor): a schist retaining wall 0.8 m out from that level up to the
        // natural ground, so the climb is a wall's face, not a slope of turf
        // (the covered drive: a concrete wall from the edge up to the park deck beside it, the deck's ground standing 3 m+
        // over the edge: the tunnel's side wall, not the deck's ground drawn down to the road)
        let tunnelWall = false;
        const boxed = HA_P1 && BOXES.length && (!!boxAt(mx, mz) || !!boxAt((A[0] + Bq[0]) / 2 + out[0] * 1.0, (A[2] + Bq[2]) / 2 + out[1] * 1.0));   // (inside an FDR structure or beside a shore band: its own walls, fdrBox.js)
        if (boxed) tunnelWall = true;
        else if (HA_P1 && underAt[i]) {
          const gw = (p) => { const g = haGradeAt(p[0] + out[0] * 8, p[2] + out[1] * 8); return g === null ? -1e9 : g; };   // (8 m out: past the deck's own edge)
          const gA3 = gw(A), gB3 = gw(Bq);
          const deckA = Number.isFinite(deckRel[i]) ? A[1] + deckRel[i] : null;
          if (gA3 !== null && gB3 !== null && Math.min(gA3 - A[1], gB3 - Bq[1]) > 3 && !(deckA !== null && gA3 < deckA - 2)) {
            const wa = [A[0] + out[0] * 0.3, A[1] - 0.1, A[2] + out[1] * 0.3], wb = [Bq[0] + out[0] * 0.3, Bq[1] - 0.1, Bq[2] + out[1] * 0.3];
            // (its top on the deck's one smooth level where the deck is there, else the ground's: no ragged top)
            const deckB = Number.isFinite(deckRel[i + 1]) ? Bq[1] + deckRel[i + 1] : null;
            const tA = deckA !== null ? deckA + 0.15 : gA3 + 0.1, tB = deckB !== null ? deckB + 0.15 : gB3 + 0.1;
            wallFace(PB, 'ashlar', [[wa[0], tA, wa[2]], [wb[0], tB, wb[2]]], [wa, wb], [-out[0], -out[1]], COL.stone);
            PB.face('coping', [[wa[0], tA, wa[2]], [wb[0], tB, wb[2]], [wb[0] + out[0] * 0.5, tB, wb[2] + out[1] * 0.5], [wa[0] + out[0] * 0.5, tA, wa[2] + out[1] * 0.5]], [0, 1, 0]);
            stats.walls++; tunnelWall = true;
          } else {
            // (the deck's open edge over the drive (the UN's river side): the deck's own level just inside the edge,
            // standing 3 m+ over the drive and 2 m+ over the ground outside: a wall face from the deck's coping down
            // to that ground, its outer face to the river)
            const dA = Number.isFinite(deckRel[i]) ? A[1] + deckRel[i] : null, dB = Number.isFinite(deckRel[i + 1]) ? Bq[1] + deckRel[i + 1] : null;
            if (dA !== null && dB !== null && Math.min(dA - A[1], dB - Bq[1]) > 3) {
              const ta = [A[0] + out[0] * 0.3, dA + 0.15, A[2] + out[1] * 0.3], tb = [Bq[0] + out[0] * 0.3, dB + 0.15, Bq[2] + out[1] * 0.3];
              const ba = [ta[0], A[1] - 0.3, ta[2]], bb = [tb[0], Bq[1] - 0.3, tb[2]];   // (down to the drive's level: the ground beside it is held there)
              wallFace(PB, 'ashlar', [ta, tb], [ba, bb], out, COL.stone);
              wallFace(PB, 'ashlar', [ta, tb], [[A[0], dA - 0.2, A[2]], [Bq[0], dB - 0.2, Bq[2]]], [-out[0], -out[1]], COL.stone);
              PB.face('coping', [[A[0], dA + 0.15, A[2]], [Bq[0], dB + 0.15, Bq[2]], [tb[0] + out[0] * 0.25, tb[1], tb[2] + out[1] * 0.25], [ta[0] + out[0] * 0.25, ta[1], ta[2] + out[1] * 0.25]], [0, 1, 0]);
              stats.walls++; tunnelWall = true;
            }
          }
        }
        if (HA_P1 && !open && !tunnelWall) {   // (on the covered drive too where no tunnel wall stands: a bank rising beside it is retained)
          const g15 = (k, p) => { const x = p[0] + out[0] * 1.6, z = p[2] + out[1] * 1.6; const g = haGradeAt(x, z); return g === null ? null : g - 0.15; };
          const gA2 = g15(i, A), gB2 = g15(i + 1, Bq);
          if (gA2 !== null && gB2 !== null && Math.max(gA2 - A[1], gB2 - Bq[1]) > 0.5) {
            const wa = [A[0] + out[0] * 0.8, A[1] - 0.1, A[2] + out[1] * 0.8], wb = [Bq[0] + out[0] * 0.8, Bq[1] - 0.1, Bq[2] + out[1] * 0.8];
            const ta = [wa[0], Math.max(A[1] + 0.3, gA2 + 0.15), wa[2]], tb = [wb[0], Math.max(Bq[1] + 0.3, gB2 + 0.15), wb[2]];
            wallFace(PB, 'rubble', [ta, tb], [wa, wb], [-out[0], -out[1]], COL.stone);
            PB.face('coping', [ta, tb, [tb[0] + out[0] * 0.5, tb[1], tb[2] + out[1] * 0.5], [ta[0] + out[0] * 0.5, ta[1], ta[2] + out[1] * 0.5]], [0, 1, 0]);
            stats.walls++;
          }
        }
        // under the edge: a wall to the ground (retained approach, an arch's spandrel, the rotunda's walls), or an open
        // deck's fascia (slab and girder depth)
        const t = code === 'c' ? 0.35 : code === 's' || code === 'w' ? 0.45 : 0.3;
        const faceA = [A[0] + out[0] * t, A[1], A[2] + out[1] * t], faceB = [Bq[0] + out[0] * t, Bq[1], Bq[2] + out[1] * t];
        if (open) {
          // the slab's edge (its haunch); the girders under it show below (drawn with the soffit)
          const depth = 0.45;
          wallFace(PB, conc(st) ? 'conc' : 'ashlar', [faceA, faceB], [[faceA[0], faceA[1] - depth, faceA[2]], [faceB[0], faceB[1] - depth, faceB[2]]], out, COL.conc);
        } else if (!boxed && (over > 0.4 || (st && (st.kind === 'arch' || st.kind === 'rotunda' || st.garage)))) {   // (inside an FDR structure: its own walls)
          const gfa = Math.min(gA, A[1] - 0.2) - 0.3, gfb = Math.min(gB, Bq[1] - 0.2) - 0.3;
          let top = [faceA, faceB], bot = [[faceA[0], gfa, faceA[2]], [faceB[0], gfb, faceB[2]]];
          // an arch: the opening over the crossing (the deck's lowest ground), cut out of the spandrel as a segmental arch
          const arch = st && st.kind === 'arch' ? archAt(c, st, ground) : null;
          if (arch) {
            const sA = c.S[i] - arch.s, sB = c.S[i + 1] - arch.s;
            const yA = arch.yAt(sA), yB = arch.yAt(sB);
            if (yA !== null && yB !== null) { bot = [[faceA[0], Math.max(gfa, yA), faceA[2]], [faceB[0], Math.max(gfb, yB), faceB[2]]]; stats.arches++; }
          }
          // (a structure's faces in ashlar; a retaining wall in schist; a ramp's walls in concrete)
          wallFace(PB, st && (st.kind === 'arch' || st.kind === 'rotunda' || st.garage || st.mat === 'stone') ? 'ashlar' : stoneish ? 'rubble' : 'conc', top, bot, out, COL.stone);
          stats.walls++;
        }
      }
      // an arch's barrel: the vault's intrados across the deck within the span
      if (st && st.kind === 'arch') {
        const arch = archAt(c, st, ground);
        if (arch) {
          const yA = arch.yAt(c.S[i] - arch.s), yB = arch.yAt(c.S[i + 1] - arch.s);
          if (yA !== null && yB !== null) {
            const L0 = edgePt(i, -1, 0.45), R0 = edgePt(i, 1, 0.45), L1 = edgePt(i + 1, -1, 0.45), R1 = edgePt(i + 1, 1, 0.45);
            PB.face('ashlar', [[L0[0], yA, L0[2]], [R0[0], yA, R0[2]], [R1[0], yB, R1[2]], [L1[0], yB, L1[2]]], [0, -1, 0]);
          }
        }
      }
      // the deck's underside where open: the slab's soffit and the girders, the bents at the filed span
      if (st && st.kind !== 'arch' && st.kind !== 'rotunda' && !st.garage) {
        const yL = c.Y[i] - c.E[i] * c.WL[i], yR = c.Y[i] + c.E[i] * c.WR[i];
        const gC = ground(mx, mz);
        if (Math.min(yL, yR) - gC >= 3.0) {
          const depthSlab = 0.3, steel = st.mat === 'steel';
          const L = (k) => edgePt(k, -1), R = (k) => edgePt(k, 1);
          const dn = (p, d) => [p[0], p[1] - d, p[2]];
          PB.face('conc', [dn(L(i), depthSlab), dn(R(i), depthSlab), dn(R(i + 1), depthSlab), dn(L(i + 1), depthSlab)], [0, -1, 0]);
          // plate girders, one every ~2.6 m across (web 1.2 m, flanges 0.45 m)
          const W = c.WL[i] + c.WR[i], ng = Math.max(2, Math.round(W / 2.6) + 1);
          for (let g = 0; g < ng; g++) {
            const f = (g + 0.5) / ng, o0 = -c.WL[i] + f * W, o1 = -c.WL[i + 1] + f * (c.WL[i + 1] + c.WR[i + 1]);
            const p0 = [c.X[i] + c.NX[i] * o0, c.Y[i] + c.E[i] * o0 - depthSlab, c.Z[i] + c.NZ[i] * o0];
            const p1 = [c.X[i + 1] + c.NX[i + 1] * o1, c.Y[i + 1] + c.E[i + 1] * o1 - depthSlab, c.Z[i + 1] + c.NZ[i + 1] * o1];
            const n0 = { p: p0, n: [c.NX[i], c.NZ[i]] }, n1 = { p: p1, n: [c.NX[i + 1], c.NZ[i + 1]] };
            const web = steel ? 1.25 : 0.9;
            sweep(B, steel ? M.steel : M.matte, [n0, n1], [[-0.225, 0], [-0.225, -0.05], [-0.012, -0.05], [-0.012, -web], [-0.225, -web], [-0.225, -web - 0.05], [0.225, -web - 0.05], [0.225, -web], [0.012, -web], [0.012, -0.05], [0.225, -0.05], [0.225, 0]], steel ? COL.steel : COL.concU);
          }
          stats.decks++;
          // a bent where the filed span's multiple falls in this station
          const span = Math.max(12, Math.min(30, structSpan(st) || 22));
          if (Math.floor((c.S[i + 1] - c.S[st.i0]) / span) !== Math.floor((c.S[i] - c.S[st.i0]) / span) && i > st.i0 + 2 && i < st.i1 - 2) {
            bent(PB, c, i, ground, onRoad, steel);
            stats.bents++;
          }
        }
      }
    }
  }
  if (HA_P1) for (const s of BOXES) drawBox(PB, B, M, s, ox, oz, stats);
  const r = B.flush(group, 'hhp_' + ctx.key), r2 = PB.flush(group, ctx.key);
  r.meshes += r2.meshes; r.tris += r2.tris;
  if (r.meshes) console.log(`[hhp kit] tile ${ctx.key}: ${Object.entries(stats).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(', ')}; ${r.meshes} meshes, ${r.tris | 0} triangles`);
}
const conc = (st) => st && st.mat !== 'stone';
const structSpan = (st) => { const r = hhpStructure(st.id); return r ? (r.nbi && r.nbi.max_span) || r.span || null : null; };

// a bent under station i: a cap beam across the deck under the girders, columns down to the ground (moved off a road under
// them by up to 3 m across, else left out: the cap spans)
function bent(B, c, i, ground, onRoad, steel) {
  const W = c.WL[i] + c.WR[i], depth = (steel ? 1.3 : 0.95) + 0.3;
  const cap = 1.1, capW = 1.4;
  const yTop = Math.min(c.Y[i] - c.E[i] * c.WL[i], c.Y[i] + c.E[i] * c.WR[i]) - depth;
  const tx = c.TX[i], tz = c.TZ[i], nx = c.NX[i], nz = c.NZ[i];
  const at = (o, a) => [c.X[i] + nx * o + tx * a, c.Z[i] + nz * o + tz * a];
  const o0 = -c.WL[i] + 0.3, o1 = c.WR[i] - 0.3;
  B.ext('conc', [at(o0, -capW / 2), at(o1, -capW / 2), at(o1, capW / 2), at(o0, capW / 2)], yTop - cap, yTop, COL.concD);
  const ncol = W > 14 ? 3 : 2;
  for (let k = 0; k < ncol; k++) {
    let o = o0 + 0.6 + ((o1 - o0 - 1.2) * k) / (ncol - 1);
    let p = at(o, 0), tries = 0;
    while (onRoad(p[0], p[1], yTop) && tries < 6) { o += (k < ncol / 2 ? -1 : 1) * 0.5; p = at(o, 0); tries++; }
    if (onRoad(p[0], p[1], yTop) || o < -c.WL[i] - 1 || o > c.WR[i] + 1) continue;
    const g = ground(p[0], p[1]);
    if (yTop - cap - g < 0.5) continue;
    const h = 0.5;
    B.ext('conc', [[p[0] - nx * h - tx * h, p[1] - nz * h - tz * h], [p[0] + nx * h - tx * h, p[1] + nz * h - tz * h], [p[0] + nx * h + tx * h, p[1] + nz * h + tz * h], [p[0] - nx * h + tx * h, p[1] - nz * h + tz * h]], g - 0.4, yTop - cap, COL.conc, { top: false });
  }
}

// an arch's opening (cached per structure): its crown over the lowest ground under the deck run, the filed span, a
// segmental curve from the springing (the ground at the span's ends + 0.3 m) to the crown (the deck less 1.0 m)
function archAt(c, st, ground) {
  if (st._arch !== undefined) return st._arch;
  let best = -Infinity, k = -1, lo = 0;
  for (let i = st.i0; i <= st.i1; i++) { const g = ground(c.X[i], c.Z[i]); if (c.Y[i] - g > best) { best = c.Y[i] - g; k = i; lo = g; } }
  if (k < 0) return (st._arch = null);
  const span = Math.max(6, Math.min(16, structSpan(st) || 8)), crown = c.Y[k] - 1.0, spring = lo + 0.3;
  if (crown - spring < 2.0) return (st._arch = null);
  const half = span / 2, rise = crown - spring;
  st._arch = { s: c.S[k], yAt: (ds) => (Math.abs(ds) >= half ? null : spring + rise * Math.sqrt(Math.max(0, 1 - (ds / half) ** 2))) };
  return st._arch;
}

// an FDR structure (fdrBox.js): the river wall (ashlar from below the water to a granite coping, a two-tube rail), the
// inner retaining wall (from the drive's or the street's level, whichever is lower, to the deck's top or the street's,
// whichever is higher), the tunnel side walls of every drive under it (concrete, up to the soffit), the slab's soffit
// and the portals (the deck's end face, and the walls beside the bores down to the drives)
function drawBox(PB, B, M, s, ox, oz, stats) {
  const c = s.c;
  const C = (i, o, y) => [c.X[i] + c.NX[i] * o, y, c.Z[i] + c.NZ[i] * o];
  const open = (i, o, sg) => !boxAt(c.X[i] + c.NX[i] * (o + sg * 1.0), c.Z[i] + c.NZ[i] * (o + sg * 1.0));
  const drives = (k, i) => {   // the drives under the deck at quad k: [chain, station, station+1]
    const out = [[c, i, i + 1]];
    if (s.pair && s.pairJ[k] >= 0 && s.pairJ[k + 1] >= 0) out.push([s.pair, s.pairJ[k], s.pairJ[k + 1]]);
    return out;
  };
  for (let i = s.i0; i <= s.i1; i++) {
    const k0 = i - s.i0, k1 = k0 + 1;
    const mx = (c.X[i] + c.X[i + 1]) / 2, mz = (c.Z[i] + c.Z[i + 1]) / 2;
    if (!owns(ox, oz, mx, mz)) continue;
    const t0 = s.top[k0], t1 = s.top[k1], f0 = s.soffit[k0], f1 = s.soffit[k1];
    for (const sg of [-1, 1]) {
      const e0 = sg < 0 ? s.lo[k0] : s.ro[k0], e1 = sg < 0 ? s.lo[k1] : s.ro[k1];
      if (!open(i, e0, sg) && !open(i + 1, e1, sg)) continue;
      if (s.kind === 'shore' && sg !== s.sr) continue;   // (a shore band's inner edge is the drive's kerb)
      if (s.kind === 'shore') { const m = C(i, (e0 + e1) / 2 - sg * 0.3, 0); if (boxesAt(m[0], m[2]).some((o) => o !== s)) continue; }   // (inside another structure: its walls)
      const nrm = [c.NX[i] * sg, c.NZ[i] * sg], inn = [-nrm[0], -nrm[1]];
      if (sg === s.sr) {
        const A = C(i, e0, 0), Bq = C(i + 1, e1, 0), Ai = C(i, e0 - sg * 0.6, 0), Bi = C(i + 1, e1 - sg * 0.6, 0);
        wallFace(PB, 'ashlar', [[A[0], t0 + 0.2, A[2]], [Bq[0], t1 + 0.2, Bq[2]]], [[A[0], -4, A[2]], [Bq[0], -4, Bq[2]]], nrm, COL.stone);
        wallFace(PB, 'ashlar', [[Ai[0], t0 + 0.2, Ai[2]], [Bi[0], t1 + 0.2, Bi[2]]], [[Ai[0], t0 - 0.05, Ai[2]], [Bi[0], t1 - 0.05, Bi[2]]], inn, COL.stone);
        const cp0 = C(i, e0 + sg * 0.1, t0 + 0.35), cp1 = C(i + 1, e1 + sg * 0.1, t1 + 0.35), ci0 = C(i, e0 - sg * 0.7, t0 + 0.35), ci1 = C(i + 1, e1 - sg * 0.7, t1 + 0.35);
        PB.face('coping', [cp0, cp1, ci1, ci0], [0, 1, 0]);
        wallFace(PB, 'coping', [cp0, cp1], [[cp0[0], t0 + 0.2, cp0[2]], [cp1[0], t1 + 0.2, cp1[2]]], nrm, COL.stone);
        wallFace(PB, 'coping', [ci0, ci1], [[ci0[0], t0 + 0.2, ci0[2]], [ci1[0], t1 + 0.2, ci1[2]]], inn, COL.stone);
        const path = [{ p: C(i, e0 - sg * 0.3, t0 + 0.35), n: nrm }, { p: C(i + 1, e1 - sg * 0.3, t1 + 0.35), n: [c.NX[i + 1] * sg, c.NZ[i + 1] * sg] }];
        for (const h of [0.5, 0.98]) sweep(B, M.steel, path, [[-0.03, h - 0.03], [-0.03, h + 0.03], [0.03, h + 0.03], [0.03, h - 0.03], [-0.03, h - 0.03]], COL.steel);
        if (Math.floor(c.S[i + 1] / 2.4) !== Math.floor(c.S[i] / 2.4)) { const p = path[0].p; B.ext(M.steel, [[p[0] - 0.035, p[2] - 0.035], [p[0] + 0.035, p[2] - 0.035], [p[0] + 0.035, p[2] + 0.035], [p[0] - 0.035, p[2] + 0.035]], p[1], p[1] + 1.02, COL.steel, { bot: false }); }
      } else {
        const g = (j, e) => { const q = C(j, e + sg * 1.5, 0), v = haGradeAt(q[0], q[2]); return v === null ? null : v; };
        const g0 = g(i, e0) ?? t0, g1 = g(i + 1, e1) ?? t1;
        const lowY = (j) => Math.min(...drives(k0, i).map(([d, a, b]) => d.Y[j === i ? a : b]));
        const b0 = Math.min(lowY(i) - 0.3, g0 - 0.5), b1 = Math.min(lowY(i + 1) - 0.3, g1 - 0.5);
        const w0 = s.wallTop ? s.wallTop[k0] : Math.max(t0 + 0.2, g0 + 0.1), w1 = s.wallTop ? s.wallTop[k1] : Math.max(t1 + 0.2, g1 + 0.1);
        const A = C(i, e0, 0), Bq = C(i + 1, e1, 0), Ai = C(i, e0 - sg * 0.6, 0), Bi = C(i + 1, e1 - sg * 0.6, 0);
        wallFace(PB, 'rubble', [[A[0], w0, A[2]], [Bq[0], w1, Bq[2]]], [[A[0], b0, A[2]], [Bq[0], b1, Bq[2]]], nrm, COL.stone);
        wallFace(PB, 'rubble', [[Ai[0], w0, Ai[2]], [Bi[0], w1, Bi[2]]], [[Ai[0], b0, Ai[2]], [Bi[0], b1, Bi[2]]], inn, COL.stone);
        const cp0 = C(i, e0 + sg * 0.05, w0 + 0.12), cp1 = C(i + 1, e1 + sg * 0.05, w1 + 0.12), ci0 = C(i, e0 - sg * 0.65, w0 + 0.12), ci1 = C(i + 1, e1 - sg * 0.65, w1 + 0.12);
        PB.face('coping', [cp0, cp1, ci1, ci0], [0, 1, 0]);
        wallFace(PB, 'coping', [cp0, cp1], [[cp0[0], w0, cp0[2]], [cp1[0], w1, cp1[2]]], nrm, COL.stone);
        wallFace(PB, 'coping', [ci0, ci1], [[ci0[0], w0, ci0[2]], [ci1[0], w1, ci1[2]]], inn, COL.stone);
      }
      stats.walls++;
    }
    if (s.kind === 'park') PB.face('conc', [C(i, s.ro[k0], f0), C(i + 1, s.ro[k1], f1), C(i + 1, s.lo[k1], f1), C(i, s.lo[k0], f0)], [0, -1, 0]);
    // the bores: each drive's side walls, from its edge's level to the soffit
    if (s.kind !== 'shore') for (const [d, a, b] of drives(k0, i)) {
      for (const sg of [-1, 1]) {
        const oa = sg < 0 ? -(d.WL[a] + 0.35) : d.WR[a] + 0.35, ob = sg < 0 ? -(d.WL[b] + 0.35) : d.WR[b] + 0.35;
        const pa = [d.X[a] + d.NX[a] * oa, d.Y[a] + d.E[a] * oa - 0.3, d.Z[a] + d.NZ[a] * oa], pb = [d.X[b] + d.NX[b] * ob, d.Y[b] + d.E[b] * ob - 0.3, d.Z[b] + d.NZ[b] * ob];
        if (f0 - pa[1] < 2 || f1 - pb[1] < 2) continue;
        wallFace(PB, 'conc', [[pa[0], f0, pa[2]], [pb[0], f1, pb[2]]], [pa, pb], [-d.NX[a] * sg, -d.NZ[a] * sg], COL.conc);
      }
    }
    stats.decks++;
  }
  // the portals
  for (const [i, k, dir] of [[s.i0, 0, -1], [s.i1 + 1, s.i1 + 1 - s.i0, 1]]) {
    if (!owns(ox, oz, c.X[i], c.Z[i])) continue;
    const ax = c.X[i] + c.TX[i] * dir * 3, az = c.Z[i] + c.TZ[i] * dir * 3;
    if (boxAt(ax, az)) continue;
    const nrm = [c.TX[i] * dir, c.TZ[i] * dir];
    if (s.kind !== 'park') continue;   // (a stack's ends: the walk meets the ground beyond, no portal)
    if (s.kind === 'park') wallFace(PB, 'ashlar', [C(i, s.lo[k], s.top[k] + 0.2), C(i, s.ro[k], s.top[k] + 0.2)], [C(i, s.lo[k], s.soffit[k]), C(i, s.ro[k], s.soffit[k])], nrm, COL.stone);
    // (beside the bores: the face down to the lowest drive)
    const j = s.pairJ[Math.min(k, s.pairJ.length - 1)];
    const cuts = [[-(c.WL[i] + 0.35), c.WR[i] + 0.35]];
    let yLow = c.Y[i];
    if (s.pair && j >= 0) { const o = s.pair, op = (o.X[j] - c.X[i]) * c.NX[i] + (o.Z[j] - c.Z[i]) * c.NZ[i], w = (o.WL[j] + o.WR[j]) / 2 + 0.35; cuts.push([op - w, op + w]); yLow = Math.min(yLow, o.Y[j]); }
    cuts.sort((p, q) => p[0] - q[0]);
    let x = s.lo[k];
    const seg = (a, b) => { if (b - a > 0.2) wallFace(PB, 'ashlar', [C(i, a, s.soffit[k]), C(i, b, s.soffit[k])], [C(i, a, yLow - 0.5), C(i, b, yLow - 0.5)], nrm, COL.stone); };
    for (const [a, b] of cuts) { seg(x, Math.min(a, s.ro[k])); x = Math.max(x, b); }
    seg(x, s.ro[k]);
  }
}
