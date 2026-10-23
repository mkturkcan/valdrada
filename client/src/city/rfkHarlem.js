// BRIDGES (AR34): the RFK (Triborough) Bridge's Harlem River crossing and its Manhattan approach ramps, with the Harlem River
// Drive's viaduct round 125th-129th St. Called by city/w125e.js (its apply() and build() hooks); flag `?rfk34=0` (the AR32
// pieces of w125e.js come back). Notes: docs/notes/ar34-bridges.md.
//
// THE RAMPS (city/rfkData.js, written by client/tools/ar34/bridges/rfk_data.mjs from the CSCL centrelines): each elevated
// roadway a smoothed alignment (curvature continuous) with a solved profile (vertical curves, the crossings' clearances), drawn
// as a deck: asphalt with its lane lines, a 0.25 m slab, steel plate girders, New Jersey safety-shape parapets (0.81 m), light
// poles, scuppers; concrete piers about every 27 m where the ground under is not a street; where the deck is under 3 m over
// the ground it stands on fill between retaining walls. The compiled tiles' own raised decks for the same roadways (flat at the
// compiler's level constants, straight ramps between CSCL nodes: the kinks) are cut out in apply(), and their traffic lines
// lifted onto the new profile.
//
// THE LIFT BRIDGE (Allston Dana, chief engineer; opened 11 July 1936; Wikipedia, "Robert F. Kennedy Bridge"): a 310 ft (94.5 m)
// vertical-lift span, 92 ft (28 m) wide, six lanes and two sidewalks, 55 ft (16.8 m) over mean high water closed (135 ft open);
// a side span of 195 ft (59.4 m) each side between the lift span and the approach viaducts, 700 ft (213 m) in all; towers
// lattice shafts (square built-up columns braced with X panels), a counterweight bay between the shafts on each side, closed at
// the top by an arch; across the roadway an arched portal truss at the top; the machinery house over it with raised end blocks
// and round ports; each tower on four concrete pier blocks behind a timber fender at the waterline. The lift span a through
// truss with a curved top chord (Warren web with verticals, ten panels), floor beams, stringers and lateral bracing under the
// deck, the sidewalks on brackets outside the trusses behind a glazed fence; the side spans through trusses whose top chord falls
// away from the tower. Paint: the pale grey-blue of the photographs. The span's axis and ends: OSM ways 801411751 / 801411754
// (94.5 / 92.3 m, the bearings), which the CSCL bridge centrelines confirm within 0.4 m.
import { COLLIDERS } from './colliders.js';
import { Bag, mats, K } from './w125eKit.js';
import { RFK_CHAINS } from './rfkData.js';

export const RFK34 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rfk34') === '0');
const TILE = 512;
const owns = (ox, oz, x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;
const ROADS = ['asphalt', 'busred', 'gutter', 'paintW', 'paintY', 'curb', 'sidewalk', 'brick'];

// colours (sRGB, before the materials' light trim)
const C = {
  paint: K(0xb9c8cd), paintD: K(0xa2b3b9), paintU: K(0x8a9ba1), house: K(0xc7d3d6), port: K(0x26303a),
  conc: K(0xa39d92), concD: K(0x8a847a), concU: K(0x77726a), pierC: K(0x9a917f), pierD: K(0x7e7666), timber: K(0x3d342b),
  asph: K(0x5f5f5e), asphD: K(0x525251), white: K(0xd9d8d2), yellow: K(0xd2a93a), girder: K(0x7f8c90), girderD: K(0x687478),
  rsteel: K(0x7c8d88), rsteelD: K(0x66756f),
  glass: K(0x6f8790), pole: K(0x7d8487), lamp: K(0xf0eee4), rope: K(0x2a2c2e), cw: K(0x9d9e9a), barrier: K(0xb8b3a8),
};

// ---- the lift bridge's frame ----------------------------------------------------------------------------------------------
// s along the axis from the lift span's Manhattan bearing toward Randall's Island, o across it (+ to the south side)
const O = [3585.85, -1955.45], U = [0.87397, 0.48601], N = [-0.48601, 0.87397];
const SPAN = 93.3;                       // bearing to bearing (OSM 801411751 / 754: 94.5 / 92.3 m)
const WATER = 0;                          // the water plane: mean high water
const LOW = 16.8, ROAD = 18.9;            // the span's low steel (55 ft over MHW) and its road surface
const at = (s, o) => [O[0] + U[0] * s + N[0] * o, O[1] + U[1] * s + N[1] * o];
const sOf = (x, z) => (x - O[0]) * U[0] + (z - O[1]) * U[1];
const oOf = (x, z) => (x - O[0]) * N[0] + (z - O[1]) * N[1];
// the towers straddle the lift span's ends: the span's 310 ft run bearing to bearing at the towers' centre lines, its ends
// passing between the tower legs (the elevation photograph's scale: towers 94.5 m centre to centre at 64 m tall, ~23 m along
// the axis; side span + tower = 195 ft from the lift span's end to the approach viaduct, 700 ft in all)
const TW = 23;                            // a tower's length along the axis: shaft 8 m, counterweight bay 7 m, shaft 8 m
const TOW = [[-TW / 2, TW / 2], [SPAN - TW / 2, SPAN + TW / 2]];   // the towers' s ranges (Manhattan, Randall's Island)
const SIDE = 59.4;                        // the lift span's end to the approach viaduct (195 ft)
const S_W = -SIDE, S_E = SPAN + SIDE;     // the approach viaducts' starts
const S_GORE = -65, S_END = 240;          // the ramps' gores (CSCL) and where the compiled Randall's Island viaduct takes over
const Y_END = 17.3;                       // ... at the compiled deck's height
const TR = 12.2, SW0 = 12.7, SW1 = 14.2;  // truss planes; the sidewalks outside them; the deck's edge
const CURB = 11.6;                        // the roadway's kerbs (six 3.66 m lanes and a 0.6 m median barrier)
// the road surface along the bridge: level over the river, falling at 1.4 % from the Randall's Island approach's start to the
// compiled viaduct
const bridgeY = (s) => (s <= S_E + 20 ? ROAD : ROAD + (Y_END - ROAD) * Math.min(1, (s - S_E - 20) / (S_END - S_E - 20)));

// ---- the chains: lookups ---------------------------------------------------------------------------------------------------
const CH = RFK_CHAINS.map((c) => {
  const n = c.p.length / 3, P = [];
  for (let i = 0; i < n; i++) P.push([c.p[i * 3], c.p[i * 3 + 1], c.p[i * 3 + 2]]);
  return { ...c, P };
});
// a 16 m hash of the chains' segments for the corridor tests
const HC = 16, hash = new Map();
CH.forEach((c, ci) => { for (let i = 0; i + 1 < c.P.length; i++) {
  const a = c.P[i], b = c.P[i + 1], r = c.w / 2 + 3;
  for (let gx = Math.floor((Math.min(a[0], b[0]) - r) / HC); gx <= Math.floor((Math.max(a[0], b[0]) + r) / HC); gx++)
    for (let gz = Math.floor((Math.min(a[2], b[2]) - r) / HC); gz <= Math.floor((Math.max(a[2], b[2]) + r) / HC); gz++) {
      const k = gx + ',' + gz; let L = hash.get(k); if (!L) hash.set(k, (L = [])); L.push([ci, i]);
    }
} });
// the nearest chain point within `pad` of the deck's edge: { y, d (from the centre line), w } or null
function chainAt(x, z, pad) {
  const L = hash.get(Math.floor(x / HC) + ',' + Math.floor(z / HC));
  if (!L) return null;
  let best = null;
  for (const [ci, i] of L) {
    const c = CH[ci], a = c.P[i], b = c.P[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2)), px = a[0] + dx * t - x, pz = a[2] + dz * t - z, d = Math.hypot(px, pz);
    if (d > c.w / 2 + pad) continue;
    const y = a[1] + (b[1] - a[1]) * t;
    if (!best || d - c.w / 2 < best.d - best.w / 2) best = { y, d, w: c.w };
  }
  return best;
}
const onBridge = (x, z, pad = 0) => { const s = sOf(x, z), o = oOf(x, z); return s > S_GORE - 2 && s < S_END && Math.abs(o) < SW1 + 1.5 + pad; };
// where two decks merge (the gores, the ramps that join side by side) the surfaces overlap: a point inside the deck of a chain
// listed earlier, or of the bridge, at a height within 1.2 m of `y` belongs to that deck (so the later one leaves out its
// surface there, and its parapet on that side)
function insideOther(ci, x, z, y, inset = 0.3) {
  const s = sOf(x, z), o = oOf(x, z);
  if (s > S_GORE - 0.5 && s < S_END && Math.abs(o) < SW1 - inset && Math.abs(bridgeY(s) - y) < 1.2) return true;
  const L = hash.get(Math.floor(x / HC) + ',' + Math.floor(z / HC));
  if (!L) return false;
  for (const [cj, i] of L) {
    if (cj >= ci) continue;
    const c = CH[cj], a = c.P[i], b = c.P[i + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2)), d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < c.w / 2 - inset && Math.abs(a[1] + (b[1] - a[1]) * t - y) < 1.2) return true;
  }
  return false;
}

// ---- apply: the compiled raised decks out, their traffic onto the new profile ---------------------------------------------
const SECTS = ['asphalt', 'curb', 'sidewalk', 'gutter', 'paintW', 'paintY', 'paintG', 'path', 'busred', 'warn', 'warnIron', 'brick'];
export function apply(tile, ox, oz) {
  if (!RFK34 || ox > 3900 || ox + TILE < 3100 || oz > -1500 || oz + TILE < -2800) return;
  let nt = 0, nv = 0;
  for (const name of SECTS) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    let cut = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const y = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, x = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      if (y > 4.6 && (onBridge(x, z, 3) || chainAt(x, z, 3.5))) { cut++; continue; }
      for (let k = 0; k < 9; k++) out.push(a[i + k]);
    }
    if (cut) { tile.S[name] = Float32Array.from(out); nt += cut; }
  }
  // the compiled shoreline walls that stand in open water (tools/pipeline/compile.mjs "shoreline bulkheads": a face 3.4 m off
  // the land polygon's ring, but the tiles' 16 m terrain grid draws the coast up to ~12 m from that ring, so along the Harlem
  // River's shores stretches of wall stood free in the water with water behind them): a face with water 4 m and 7 m to both
  // sides goes, with its cap and skirt; the coast there is the terrain's (the finer grid is recompile item 7)
  try { nt += shoreApply(tile, ox, oz); } catch (e) { console.warn('[rfk34] shore', e); }
  // the compiled raised footpaths and streets here ran from the deck straight down to the esplanade on lines no deck draws any
  // more, and walkers follow a road line's own heights: walkers hung in the air in front of the Manhattan pier (review view
  // brEsp, r4 / r7). Such a path is taken out of use (class 6: neither cars nor walkers take it), such a street lifted to level
  // 1 (walkers line only level-0 streets with sidewalks)
  let np = 0;
  if (tile.S.roadVerts && tile.S.roads && tile.S.roads.byteLength) {
    const RV = tile.S.roadVerts, m = Uint8Array.from(tile.S.roads), dv = new DataView(m.buffer);
    for (let i = 0; i < m.byteLength / 24; i++) {
      const o = i * 24;
      const cls = m[o + 6] & 0x7f;
      if (cls !== 5 && (cls > 2 || m[o + 14] !== 0)) continue;
      const start = dv.getUint32(o, true), len = dv.getUint16(o + 4, true);
      for (let j = 0; j < len; j++) {
        const x = RV[(start + j) * 3] + ox, y = RV[(start + j) * 3 + 1], z = RV[(start + j) * 3 + 2] + oz;
        if (y > 4.6 && (onBridge(x, z, 3) || chainAt(x, z, 3.5))) {
          // a path: out of use; a street the walkers would line with sidewalks (class 0-2 at level 0): level 1, as a
          // deck's roadway is (sim/peds.js lines only level-0 streets; the cars keep it)
          if (cls === 5) m[o + 6] = (m[o + 6] & 0x80) | 6; else m[o + 14] = 1;
          np++; break;
        }
      }
    }
    if (np) tile.S.roads = m;
  }
  // the road lines (traffic, walkers' levels) on the raised decks: onto the rebuilt profile
  if (tile.S.roadVerts) {
    const rv = (tile.S.roadVerts = Float32Array.from(tile.S.roadVerts));
    for (let k = 0; k + 2 < rv.length; k += 3) {
      if (rv[k + 1] < 4.6) continue;
      const x = rv[k] + ox, z = rv[k + 2] + oz;
      if (onBridge(x, z)) { rv[k + 1] = bridgeY(sOf(x, z)); nv++; continue; }
      const c = chainAt(x, z, 2.5);
      if (c) { rv[k + 1] = c.y; nv++; }
    }
  }
  if (nt || nv || np) console.log(`[rfk34] tile ${ox / TILE}_${oz / TILE}: ${nt} compiled deck / wall triangles out, ${nv} road points onto the new profile, ${np} raised paths out of use`);
}

function shoreApply(tile, ox, oz) {
  const a = tile.S.curb, g = tile.S.terrain;
  if (!a || !g) return 0;
  const res = tile.header.res, NN = res + 1, cell = TILE / res;
  const terr = (x, z) => {
    const fx = Math.max(0, Math.min(res - 1e-6, (x - ox) / cell)), fz = Math.max(0, Math.min(res - 1e-6, (z - oz) / cell));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return g[j * NN + i] * (1 - u) * (1 - v) + g[j * NN + i + 1] * u * (1 - v) + g[(j + 1) * NN + i] * (1 - u) * v + g[(j + 1) * NN + i + 1] * u * v;
  };
  const gone = [], keep = new Uint8Array(a.length / 9).fill(1);
  for (let t = 0, i = 0; i + 8 < a.length; i += 9, t++) {
    const ys = [a[i + 1], a[i + 4], a[i + 7]];
    // a sloped shard (a cap or face whose top runs from the water up to the bank) by the crossing: out
    const cx0 = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz0 = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
    if (Math.min(...ys) > -0.5 && Math.min(...ys) < 1.0 && Math.max(...ys) > 3.0 && Math.abs(oOf(cx0, cz0)) < 60 && sOf(cx0, cz0) > -80 && sOf(cx0, cz0) < 200) { keep[t] = 0; continue; }
    if (Math.min(...ys) > -2.4) continue;                       // a wall face reaches to -2.6
    // its bottom edge: the two lowest vertices
    const v = [0, 1, 2].map((k) => [a[i + k * 3] + ox, a[i + k * 3 + 1], a[i + k * 3 + 2] + oz]).sort((p, q) => p[1] - q[1]);
    const [p0, p1] = v, top = Math.max(...ys);
    const dx = p1[0] - p0[0], dz = p1[2] - p0[2], L = Math.hypot(dx, dz);
    if (L < 0.5) continue;
    const nx = -dz / L, nz = dx / L, mx = (p0[0] + p1[0]) / 2, mz = (p0[2] + p1[2]) / 2;
    let wet = true;
    for (const d of [4, 7, -4, -7]) {
      const x = mx + nx * d, z = mz + nz * d;
      if (x < ox || x > ox + TILE || z < oz || z > oz + TILE || terr(x, z) > 0.3) { wet = false; break; }
    }
    if (!wet) continue;
    keep[t] = 0; gone.push([p0[0], p0[2], p1[0], p1[2], top]);
  }
  // the caps and skirts along the removed faces
  for (let t = 0, i = 0; i + 8 < a.length; i += 9, t++) {
    if (!keep[t]) continue;
    const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
    for (const [x0, z0, x1, z1, top] of gone) {
      const dx = x1 - x0, dz = z1 - z0, L2 = dx * dx + dz * dz || 1, u = Math.max(0, Math.min(1, ((cx - x0) * dx + (cz - z0) * dz) / L2));
      if (Math.hypot(x0 + dx * u - cx, z0 + dz * u - cz) < 4.2 && cy > top - 1.9 && cy < top + 0.2) { keep[t] = 0; break; }
    }
  }
  const out = [];
  let n = 0;
  for (let t = 0, i = 0; i + 8 < a.length; i += 9, t++) { if (keep[t]) for (let k = 0; k < 9; k++) out.push(a[i + k]); else n++; }
  tile.S.curb = Float32Array.from(out);
  return n;
}

// ---- the ramps ----------------------------------------------------------------------------------------------------------
// stretches built as an embankment between concrete retaining walls instead of a girder deck on bents: [chain name, from, to]
// (m along the chain). The exit to 125th St and Second Avenue comes down between walls, north of 125th St from near First
// gantry over it, no openings under it)
const FILL = [['RFK BRDG ET 125 STREET 2 AVE', 205, 360]];
const onFill = (c, sv) => FILL.some(([n, a, b]) => n === c.n && sv >= a && sv <= b);
// per station: the centre, the unit tangent and left normal, the banked height of a lateral offset
function frames(c) {
  const P = c.P, n = P.length, F = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[2] - a[2]; const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
    const lx = -tz, lz = tx;
    // the outer side of the curve rises: the inward direction is toward the neighbours' midpoint
    const mx = (a[0] + b[0]) / 2 - P[i][0], mz = (a[2] + b[2]) / 2 - P[i][2];
    const inSide = mx * lx + mz * lz;   // > 0: the curve turns toward +l, so -l is outside
    const e = Math.abs(c.e[i] || 0) * (inSide > 0 ? -1 : inSide < 0 ? 1 : 0);
    F.push({ x: P[i][0], y: P[i][1], z: P[i][2], tx, tz, lx, lz, e });
  }
  return F;
}
const pt = (f, o, dy = 0) => [f.x + f.lx * o, f.y + f.e * o + dy, f.z + f.lz * o];
// a quad strip piece between two stations: lateral offsets o0..o1 at heights dy0..dy1 over the banked surface (a wall when
// o0 == o1), normal given by the caller's side
function band(B, mat, fa, fb, o0, dy0, o1, dy1, col, nrm) {
  B.face(mat, [pt(fa, o0, dy0), pt(fb, o0, dy0), pt(fb, o1, dy1), pt(fa, o1, dy1)], nrm, col);
}
function rampsBuild(B, ctx) {
  const M = mats();
  let n = 0;
  CH.forEach((c, ci) => {
    const F = frames(c), hw = c.w / 2, lanes = Math.max(1, c.l || 2);
    let sAcc = 0;
    for (let i = 0; i + 1 < F.length; i++) {
      const fa = F[i], fb = F[i + 1], seg = Math.hypot(fb.x - fa.x, fb.z - fa.z);
      sAcc += seg;
      const mx = (fa.x + fb.x) / 2, mz = (fa.z + fb.z) / 2;
      if (!owns(ctx.ox, ctx.oz, mx, mz)) continue;
      const g = ctx.sampleT(mx, mz), hy = (fa.y + fb.y) / 2, over = hy - g;
      if (over < 0.3) continue;   // at grade: the compiled street carries it
      // the bridge's own deck takes over east of the gores
      if (onBridge(mx, mz) && sOf(mx, mz) > S_GORE + 1) continue;
      n++;
      const up = [0, 1, 0], dn = [0, -1, 0];
      const lN = [fa.lx, 0, fa.lz], rN = [-fa.lx, 0, -fa.lz];
      // merged into a deck listed earlier (or the bridge's): that deck carries the surface here
      const merged = insideOther(ci, mx, mz, hy);
      const sideIn = [-1, 1].map((sg) => { const q = pt(fa, sg * hw), r = pt(fb, sg * hw); return insideOther(ci, (q[0] + r[0]) / 2, (q[2] + r[2]) / 2, (q[1] + r[1]) / 2, 0.05); });
      // asphalt between the parapets' toes, with its edge lines and lane lines
      if (!merged) {
      if (!RFK_TILE_ASPHALT) band(B, M.matte, fa, fb, -hw + 0.6, 0, hw - 0.6, 0, C.asph, up);   // (else the tile's asphalt: rfkDeckAsphalt)
      band(B, M.matte, fa, fb, -hw + 0.85, 0.008, -hw + 1.0, 0.008, C.yellow, up);
      band(B, M.matte, fa, fb, hw - 1.0, 0.008, hw - 0.85, 0.008, C.white, up);
      if (lanes > 1) {
        const lw = (c.w - 2.0) / lanes;
        for (let k = 1; k < lanes; k++) {
          const o = -hw + 1.0 + k * lw;
          // 10 ft dashes every 40 ft
          const ph = sAcc % 12.2;
          if (ph < 3.05 + seg) band(B, M.matte, fa, fb, o - 0.075, 0.008, o + 0.075, 0.008, C.white, up);
        }
      }
      }
      // the slab's soffit and fascia
      const fill = onFill(c, sAcc - seg / 2);
      const deckT = 0.25, gird = over > 3.0 && !fill ? 1.4 : 0;
      if (over >= 3.0 && !fill) {
        band(B, M.matte, fa, fb, -hw, -deckT, hw, -deckT, C.concU, dn);
        band(B, M.matte, fa, fb, -hw, -deckT - 0.12, -hw, 0, C.conc, rN);   // left edge (outward normal -l... set below)
        band(B, M.matte, fa, fb, hw, -deckT - 0.12, hw, 0, C.conc, lN);
        // plate girders, about every 2.6 m across
        const ng = Math.max(2, Math.round((c.w - 1.2) / 2.6) + 1);
        for (let k = 0; k < ng; k++) {
          const o = -hw + 0.8 + (k * (c.w - 1.6)) / (ng - 1);
          band(B, M.steel, fa, fb, o - 0.012, -deckT, o - 0.012, -deckT - gird, C.rsteel, rN);
          band(B, M.steel, fa, fb, o + 0.012, -deckT, o + 0.012, -deckT - gird, C.rsteel, lN);
          band(B, M.steel, fa, fb, o - 0.22, -deckT - gird, o + 0.22, -deckT - gird, C.rsteelD, dn);   // bottom flange
        }
      } else {
        // on fill: retaining walls to the ground
        const ya = g - fa.y - 0.2, yb = g - fb.y - 0.2;
        for (const [o, nr] of [[-hw, rN], [hw, lN]]) B.face(M.matte, [pt(fa, o, 0), pt(fb, o, 0), pt(fb, o, yb), pt(fa, o, ya)], nr, C.concD);
      }
      // the parapets: New Jersey shape, 0.81 m, the outer face flush with the fascia
      for (const sg of [-1, 1]) {
        if (sideIn[sg < 0 ? 0 : 1]) continue;
        const o0 = sg * hw, inN = sg < 0 ? lN : rN, outN = sg < 0 ? rN : lN;
        const P1 = sg * (hw - 0.6), P2 = sg * (hw - 0.45), P3 = sg * (hw - 0.2);
        band(B, M.matte, fa, fb, P1, 0, P2, 0.33, C.barrier, [inN[0] * 0.9, 0.42, inN[2] * 0.9]);
        band(B, M.matte, fa, fb, P2, 0.33, P3, 0.81, C.barrier, [inN[0], 0.2, inN[2]]);
        band(B, M.matte, fa, fb, P3, 0.81, o0, 0.81, C.barrier, up);
        band(B, M.matte, fa, fb, o0, 0.81, o0, -0.37, C.conc, outN);
      }
      // light poles every 45 m on the right parapet; a scupper and its downpipe every 15 m
      const k45 = Math.floor(sAcc / 45) !== Math.floor((sAcc - seg) / 45);
      if (k45) {
        const [px, py, pz] = pt(fb, hw - 0.3, 0.81);
        B.post(M.steel, px, pz, 0.09, py, py + 9.2, C.pole);
        const ax = px - fb.lx * 2.2, az = pz - fb.lz * 2.2;
        B.bar(M.steel, [px, pz], [ax, az], 0.05, py + 9.0, py + 9.15, C.pole);
        B.bar(M.lamp, [ax + fb.lx * 0.2, az + fb.lz * 0.2], [ax - fb.lx * 0.45, az - fb.lz * 0.45], 0.16, py + 8.82, py + 9.0, C.lamp);
      }
      if (over >= 3.0 && !fill && Math.floor(sAcc / 15) !== Math.floor((sAcc - seg) / 15)) {
        const [qx, qy, qz] = pt(fb, -hw - 0.12, -0.3);
        B.post(M.steel, qx, qz, 0.07, qy - 1.6, qy, C.girderD);
      }
    }
    // piers: at stations every 27 m along the chain where the deck stands over 3.5 m, each moved up to 8 m along it to stand
    // off the streets under it (the station's own tile decides), else that span runs on to the next
    const cum = [0];
    for (let i = 1; i < F.length; i++) cum.push(cum[i - 1] + Math.hypot(F[i].x - F[i - 1].x, F[i].z - F[i - 1].z));
    const total = cum[cum.length - 1];
    const fAt = (sv) => {
      let i = 1; while (i < cum.length - 1 && cum[i] < sv) i++;
      const t = (sv - cum[i - 1]) / ((cum[i] - cum[i - 1]) || 1), a = F[i - 1], b = F[i];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, tx: a.tx, tz: a.tz, lx: a.lx, lz: a.lz, e: a.e };
    };
    for (let sv = 14; sv < total - 6; sv += 27) {
      const f0 = fAt(sv);
      if (!owns(ctx.ox, ctx.oz, f0.x, f0.z) || onFill(c, sv)) continue;
      let f = null;
      for (const d of [0, 3, -3, 6, -6, 8, -8]) {
        if (sv + d < 4 || sv + d > total - 4) continue;
        const q = fAt(sv + d);
        if (!owns(ctx.ox, ctx.oz, q.x, q.z)) continue;
        if (q.y - ctx.sampleT(q.x, q.z) < 3.5 || (onBridge(q.x, q.z) && sOf(q.x, q.z) > S_GORE - 3)) { f = null; break; }
        const street = (o) => { const [x, , z] = pt(q, o); return ctx.surfY(x, z, ROADS, 0.25) !== null; };
        if (street(0) || street(-hw + 1.4) || street(hw - 1.4)) continue;
        f = q; break;
      }
      if (!f) continue;
      // viaduct's grey-green, the caps' ends on curved haunches): box columns on concrete footings, a cap girder under the
      // plate girders, a curved haunch from each column into the cap
      const capT = f.y - 0.25 - 1.4, capB = capT - 1.2;
      const cols = c.w > 11 ? [-hw + 2.2, hw - 2.2] : [0];
      for (const o of cols) {
        const [x, , z] = pt(f, o);
        const gx = ctx.sampleT(x, z);
        B.bar(M.steel, [x - f.tx * 0.5, z - f.tz * 0.5], [x + f.tx * 0.5, z + f.tz * 0.5], 0.5, gx + 0.2, capB, C.rsteel, { bot: false });
        B.bar(M.steel, [x - f.tx * 0.62, z - f.tz * 0.62], [x + f.tx * 0.62, z + f.tz * 0.62], 0.12, gx + 0.2, capB, C.rsteelD, { bot: false, top: false });   // flange plates
        B.bar(M.matte, [x - f.tx * 1.0, z - f.tz * 1.0], [x + f.tx * 1.0, z + f.tz * 1.0], 1.0, gx - 0.12, gx + 0.22, C.concD, { bot: false });   // footing's top
        // the haunches: from 3 m under the cap out to the cap's ends (or the far column)
        for (const sg of [-1, 1]) {
          const oe = cols.length === 1 ? sg * (hw - 0.6) : (sg * o > 0 ? sg * (hw - 0.4) : -o * 0.15);
          if (cols.length === 2 && sg * o < 0) continue;
          const NH = 5, R = Math.abs(oe - o);
          for (let k = 0; k < NH; k++) {
            const a0 = (k / NH) * Math.PI / 2, a1 = ((k + 1) / NH) * Math.PI / 2;
            const p0 = pt(f, o + Math.sign(oe - o) * R * (1 - Math.cos(a0))), p1 = pt(f, o + Math.sign(oe - o) * R * (1 - Math.cos(a1)));
            const y0 = capB - Math.min(3.0, R * 0.6) * (1 - Math.sin(a0)), y1 = capB - Math.min(3.0, R * 0.6) * (1 - Math.sin(a1));
            B.slope(M.steel, [p0[0], y0 - 0.3, p0[2]], [p1[0], y1 - 0.3, p1[2]], 0.3, 0.6, C.rsteel);
          }
        }
        COLLIDERS.addBox('kit31', { x, y: (gx + capB) / 2, z, hw: 0.6, hh: (capB - gx) / 2, hd: 0.6, rotY: 0 });
      }
      const [cx, , cz] = pt(f, 0);
      B.bar(M.steel, [cx - f.lx * (hw - 0.3), cz - f.lz * (hw - 0.3)], [cx + f.lx * (hw - 0.3), cz + f.lz * (hw - 0.3)], 0.55, capB, capT, C.rsteel);
      B.bar(M.steel, [cx - f.lx * (hw - 0.25), cz - f.lz * (hw - 0.25)], [cx + f.lx * (hw - 0.25), cz + f.lz * (hw - 0.25)], 0.7, capT - 0.06, capT, C.rsteelD);   // top flange
    }
  });
  return n;
}

// ---- the lift bridge --------------------------------------------------------------------------------------------------------
// helpers in the bridge frame: a member between (s0, o0, y0) and (s1, o1, y1) of square half-size r (the Bag's sloped plank)
function mem(B, mat, s0, o0, y0, s1, o1, y1, r, col) {
  const [x0, z0] = at(s0, o0), [x1, z1] = at(s1, o1);
  if (Math.abs(y1 - y0) > 1e-3 && Math.hypot(x1 - x0, z1 - z0) < 1e-3) {   // vertical
    B.ext(mat, [at(s0 - r, o0 - r), at(s0 + r, o0 - r), at(s0 + r, o0 + r), at(s0 - r, o0 + r)], Math.min(y0, y1), Math.max(y0, y1), col);
    return;
  }
  B.slope(mat, [x0, y0 - r, z0], [x1, y1 - r, z1], r, 2 * r, col);
}
// a box in the frame: s0..s1, o0..o1, y0..y1
const fbox = (B, mat, s0, s1, o0, o1, y0, y1, col, o) => B.ext(mat, [at(s0, o0), at(s1, o0), at(s1, o1), at(s0, o1)], y0, y1, col, o);
// a braced lattice panel in the plane o = const between s0..s1, y0..y1: X diagonals in square-ish bays, horizontals
function latticeS(B, mat, o, s0, s1, y0, y1, r, col) {
  const nb = Math.max(1, Math.round((y1 - y0) / Math.max(4.5, (s1 - s0) * 0.9)));
  for (let k = 0; k <= nb; k++) { const y = y0 + ((y1 - y0) * k) / nb; mem(B, mat, s0, o, y, s1, o, y, r, col); }
  for (let k = 0; k < nb; k++) {
    const ya = y0 + ((y1 - y0) * k) / nb, yb = y0 + ((y1 - y0) * (k + 1)) / nb;
    mem(B, mat, s0, o, ya, s1, o, yb, r * 0.8, col); mem(B, mat, s1, o, ya, s0, o, yb, r * 0.8, col);
  }
}
function latticeO(B, mat, s, o0, o1, y0, y1, r, col) {
  const nb = Math.max(1, Math.round((y1 - y0) / Math.max(4.5, Math.abs(o1 - o0) * 0.9)));
  for (let k = 0; k <= nb; k++) { const y = y0 + ((y1 - y0) * k) / nb; mem(B, mat, s, o0, y, s, o1, y, r, col); }
  for (let k = 0; k < nb; k++) {
    const ya = y0 + ((y1 - y0) * k) / nb, yb = y0 + ((y1 - y0) * (k + 1)) / nb;
    mem(B, mat, s, o0, ya, s, o1, yb, r * 0.8, col); mem(B, mat, s, o1, ya, s, o0, yb, r * 0.8, col);
  }
}
const SH_Y0 = 15.6, SH_Y1 = 56.0, HOUSE1 = 61.2, TOP = 64.0;   // shafts on the pier tops to the machinery house; the towers' top
// one tower: s range [a, a + TW]; `fwd` +1 when the lift span lies toward +s
function towerBuild(B, a, fwd) {
  const M = mats(), P = C.paint, PD = C.paintD;
  const shafts = [[a, a + 8], [a + 15, a + 23]];
  const sides = [[-19.6, -14.6], [14.6, 19.6]];
  for (const [s0, s1] of shafts) for (const [o0, o1] of sides) {
    // the corner columns and the mid columns of the long faces
    for (const s of [s0, (s0 + s1) / 2, s1]) for (const o of [o0, o1]) mem(B, M.steel, s, o, SH_Y0, s, o, SH_Y1, 0.42, P);
    // X-braced faces on all four sides
    for (const o of [o0, o1]) { latticeS(B, M.steel, o, s0, (s0 + s1) / 2, SH_Y0 + 1, SH_Y1 - 1, 0.17, PD); latticeS(B, M.steel, o, (s0 + s1) / 2, s1, SH_Y0 + 1, SH_Y1 - 1, 0.17, PD); }
    for (const s of [s0, s1]) latticeO(B, M.steel, s, o0, o1, SH_Y0 + 1, SH_Y1 - 1, 0.17, PD);
  }
  // the counterweight bays (between the shafts, each side): an arch under a lattice girder on both faces, the counterweight
  // hung under the sheaves (the span is down, so the counterweights are up), its ropes
  const b0 = a + 8, b1 = a + 15, BH = 3.5, AS = 37, AR = 6.5;   // the bay's arch: springing 37 m, rise 6.5 m
  for (const [o0, o1] of sides) {
    for (const o of [o0, o1]) {
      const NA = 10;
      for (let k = 0; k < NA; k++) {
        const t0 = (k / NA) * Math.PI, t1 = ((k + 1) / NA) * Math.PI;
        mem(B, M.steel, (b0 + b1) / 2 - Math.cos(t0) * BH, o, AS + Math.sin(t0) * AR, (b0 + b1) / 2 - Math.cos(t1) * BH, o, AS + Math.sin(t1) * AR, 0.42, P);
      }
      mem(B, M.steel, b0, o, SH_Y1 - 0.5, b1, o, SH_Y1 - 0.5, 0.45, P);
      for (let s = b0 + 0.9; s < b1; s += 1.3) mem(B, M.steel, s, o, AS + AR * Math.sin(Math.acos(Math.max(-1, Math.min(1, ((b0 + b1) / 2 - s) / BH)))), s, o, SH_Y1 - 0.9, 0.12, PD);
    }
    // (the counterweight itself rides inside the outer shaft, behind its lattice; the bay shows only its guide ropes)
    const oc = (o0 + o1) / 2;
    for (const ds of [-2.3, -1.9, 1.9, 2.3]) mem(B, M.steel, (b0 + b1) / 2 + ds, oc, SH_Y0 + 2, (b0 + b1) / 2 + ds, oc, AS + AR * Math.sqrt(Math.max(0, 1 - (ds / BH) ** 2)) - 0.3, 0.05, C.rope);
    const sc = fwd > 0 ? a + 4 : a + TW - 4;
    fbox(B, M.matte, sc - 3.2, sc + 3.2, o0 + 0.9, o1 - 0.9, 41.0, 49.0, C.cw);
  }
  // across the roadway at both shaft groups: the portal truss, its soffit an arch (springing 40 m, crown 47 m)
  for (const s of [a + 0.4, a + 7.6, a + 15.4, a + 22.6]) {
    const NA = 14;
    for (let k = 0; k < NA; k++) {
      const t0 = (k / NA) * Math.PI, t1 = ((k + 1) / NA) * Math.PI;
      mem(B, M.steel, s, -Math.cos(t0) * 14.6, 40 + Math.sin(t0) * 7, s, -Math.cos(t1) * 14.6, 40 + Math.sin(t1) * 7, 0.55, P);
      mem(B, M.steel, s, -Math.cos(t0) * 14.6, 41.6 + Math.sin(t0) * 6.6, s, -Math.cos(t1) * 14.6, 41.6 + Math.sin(t1) * 6.6, 0.35, P);
      mem(B, M.steel, s, -Math.cos(t0) * 14.6, 40 + Math.sin(t0) * 7, s, -Math.cos(t1) * 14.6, 41.6 + Math.sin(t1) * 6.6, 0.12, PD);
    }
    mem(B, M.steel, s, -14.6, SH_Y1 - 0.6, s, 14.6, SH_Y1 - 0.6, 0.5, P);
    mem(B, M.steel, s, -14.6, 51.0, s, 14.6, 51.0, 0.25, PD);
    for (let o = -12.6; o <= 12.7; o += 2.8) {
      const ya = 40 + 7 * Math.sin(Math.acos(Math.max(-1, Math.min(1, o / 14.6))));
      mem(B, M.steel, s, o, ya, s, o, SH_Y1 - 0.9, 0.14, PD);
      if (o + 2.8 < 12.8) mem(B, M.steel, s, o, ya, s, o + 2.8, SH_Y1 - 0.9, 0.11, PD);   // the spandrel's diagonals
    }
  }
  // top laterals between the portal planes
  for (const o of [-14.6, -7.3, 0, 7.3, 14.6]) mem(B, M.steel, a, o, SH_Y1 - 0.4, a + TW, o, SH_Y1 - 0.4, 0.3, PD);
  // the machinery house: a body over the whole top, raised blocks over the shaft groups, round ports, roof rails
  fbox(B, M.matte, a - 0.4, a + TW + 0.4, -20.2, 20.2, SH_Y1, HOUSE1, C.house);
  for (const [o0, o1] of [[-20.4, -13.6], [13.6, 20.4]]) for (const [s0, s1] of [[a - 0.6, a + 8.6], [a + 14.4, a + TW + 0.6]]) {
    fbox(B, M.matte, s0, s1, o0, o1, HOUSE1, TOP, C.house);
    // ports on the outer and end faces
    for (const s of [s0 + 2.5, (s0 + s1) / 2, s1 - 2.5]) {
      const oo = o0 < 0 ? o0 - 0.02 : o1 + 0.02, [px, pz] = at(s, oo);
      B.ball(M.glass, px, TOP - 1.6, pz, 0.62, C.port);
    }
    // the roof rails
    for (const [ra, rb] of [[[s0, o0], [s1, o0]], [[s0, o1], [s1, o1]], [[s0, o0], [s0, o1]], [[s1, o0], [s1, o1]]]) {
      B.bar(M.steel, at(ra[0], ra[1]), at(rb[0], rb[1]), 0.03, TOP + 1.0, TOP + 1.06, C.paintD);
    }
  }
  // the lift span's ropes: from the sheaves under the house down to the span's end posts
  const se = fwd > 0 ? 0 : SPAN;   // the span hangs at its bearings, the towers' centre lines
  for (const o of [-TR, TR]) for (const d of [-0.9, -0.45, 0.45, 0.9]) mem(B, M.steel, se + d, o, LOW + 0.9 + 12.5, se + d, o, SH_Y1, 0.045, C.rope);
  // the piers: four blocks (one under each shaft group), cap, and the timber fender round them at the waterline
  for (const [s0, s1] of [[a - 1.2, a + TW / 2 - 0.4], [a + TW / 2 + 0.4, a + TW + 1.2]]) for (const [o0, o1] of [[-20.8, -13.4], [13.4, 20.8]]) {
    fbox(B, M.matte, s0, s1, o0, o1, -6, SH_Y0 - 0.9, C.pierC);
    fbox(B, M.matte, s0 - 0.3, s1 + 0.3, o0 - 0.3, o1 + 0.3, SH_Y0 - 0.9, SH_Y0, C.pierD);
    fbox(B, M.matte, s0 - 0.25, s1 + 0.25, o0 - 0.25, o1 + 0.25, -6, 2.2, C.pierD, { top: false });
  }
  const f0 = a - 4.2, f1 = a + TW + 4.2;
  for (const [s0, s1, o0, o1] of [[f0, f1, -24.2, -22.4], [f0, f1, 22.4, 24.2], [f0, f0 + 1.8, -22.4, 22.4], [f1 - 1.8, f1, -22.4, 22.4]]) fbox(B, M.matte, s0, s1, o0, o1, -1.5, 1.3, C.timber);
  for (let s = f0 + 1; s < f1; s += 2.4) for (const o of [-24.0, 24.0]) { const [px, pz] = at(s, o); B.post(M.matte, px, pz, 0.2, -1.5, 2.0, C.timber); }
  for (const sg of [-1, 1]) { const [px, pz] = at(a + TW / 2, sg * 17.1); COLLIDERS.addBox('kit31', { x: px, y: (SH_Y1 + 0) / 2, z: pz, hw: TW / 2 + 1, hh: SH_Y1 / 2, hd: 3.8, rotY: Math.atan2(U[1], U[0]) }); }
}
// a through truss on both planes from s0 to s1: depth d(s) over the bottom chord at yB, Warren web with verticals, n panels
function trussBuild(B, s0, s1, yB, depth, n) {
  const M = mats(), P = C.paint, PD = C.paintD;
  const L = s1 - s0, pnl = (k) => s0 + (L * k) / n, yT = (s) => yB + depth(s);
  for (const o of [-TR, TR]) {
    mem(B, M.steel, s0, o, yB, s1, o, yB, 0.5, P);                                        // bottom chord
    for (let k = 0; k < n; k++) mem(B, M.steel, pnl(k), o, yT(pnl(k)), pnl(k + 1), o, yT(pnl(k + 1)), 0.48, P);   // top chord
    for (let k = 0; k <= n; k++) mem(B, M.steel, pnl(k), o, yB, pnl(k), o, yT(pnl(k)), k === 0 || k === n ? 0.5 : 0.3, P);
    for (let k = 0; k < n; k++) {
      const up = k % 2 === 0;
      mem(B, M.steel, pnl(k), o, up ? yB : yT(pnl(k)), pnl(k + 1), o, up ? yT(pnl(k + 1)) : yB, 0.3, PD);
      // the sub-struts at mid-panel (half-height)
      const sm = (pnl(k) + pnl(k + 1)) / 2;
      mem(B, M.steel, sm, o, yB, sm, o, yB + depth(sm) * 0.5, 0.16, PD);
    }
  }
  // top struts with knee braces at every panel point, portals at the ends; the top lateral X bracing
  for (let k = 0; k <= n; k++) {
    const s = pnl(k), y = yT(s);
    mem(B, M.steel, s, -TR, y - 0.3, s, TR, y - 0.3, k === 0 || k === n ? 0.45 : 0.28, P);
    for (const sg of [-1, 1]) mem(B, M.steel, s, sg * TR, y - 3.2, s, sg * (TR - 3.0), y - 0.3, 0.16, PD);
    if (k < n) { const s2 = pnl(k + 1), y2 = yT(s2); mem(B, M.steel, s, -TR, y - 0.2, s2, TR, y2 - 0.2, 0.12, PD); mem(B, M.steel, s, TR, y - 0.2, s2, -TR, y2 - 0.2, 0.12, PD); }
  }
  // floor beams at the panel points, stringers, the lateral bracing under the floor
  for (let k = 0; k <= n; k++) mem(B, M.steel, pnl(k), -TR, yB - 0.4, pnl(k), TR, yB - 0.4, 0.42, PD);
  for (const o of [-9.3, -5.6, -1.9, 1.9, 5.6, 9.3]) mem(B, M.steel, s0, o, yB + 0.2, s1, o, yB + 0.2, 0.25, C.paintU);
  for (let k = 0; k < n; k++) { mem(B, M.steel, pnl(k), -TR, yB - 0.7, pnl(k + 1), TR, yB - 0.7, 0.1, C.paintU); mem(B, M.steel, pnl(k), TR, yB - 0.7, pnl(k + 1), -TR, yB - 0.7, 0.1, C.paintU); }
}
// the bridge deck from s0 to s1 (road surface yr(s)): asphalt, the median barrier, kerbs, the sidewalks on brackets outside
// the trusses with the glazed fence, the fascia girders
function deckBuild(B, s0, s1, yr, opts = {}) {
  const M = mats();
  const step = 4;
  for (let s = s0; s < s1 - 1e-6; s += step) {
    const sb = Math.min(s1, s + step), ya = yr(s), yb = yr(sb);
    const q = (o0, o1, dy) => [[...at(s, o0)], [...at(sb, o0)], [...at(sb, o1)], [...at(s, o1)]].map((p, i) => [p[0], (i === 0 || i === 3 ? ya : yb) + dy, p[1]]);
    const face = (o0, o1, dy, col, nrm, mat = M.matte) => B.face(mat, q(o0, o1, dy), nrm, col);
    face(-CURB, CURB, 0, C.asph, [0, 1, 0]);
    face(-SW1, SW1, -0.35, C.concU, [0, -1, 0]);
    for (const sg of [-1, 1]) {
      // kerb, sidewalk, fascia
      face(sg < 0 ? -SW0 : CURB, sg < 0 ? -CURB : SW0, 0.18, C.concD, [0, 1, 0]);
      face(sg < 0 ? -SW1 : SW0, sg < 0 ? -SW0 : SW1, 0.18, C.conc, [0, 1, 0]);
      const oE = sg * SW1, [x0, z0] = at(s, oE), [x1, z1] = at(sb, oE), nO = [N[0] * sg, 0, N[1] * sg];
      B.face(M.steel, [[x0, ya - 1.2, z0], [x1, yb - 1.2, z1], [x1, yb + 0.25, z1], [x0, ya + 0.25, z0]], nO, C.girder);
      // the glazed fence (posts every 2 m, panes, a top rail)
      B.face(M.glass, [[x0, ya + 0.3, z0], [x1, yb + 0.3, z1], [x1, yb + 2.1, z1], [x0, ya + 2.1, z0]], nO, C.glass);
      mem(B, M.steel, s, oE - sg * 0.05, ya + 2.12, sb, oE - sg * 0.05, yb + 2.12, 0.05, C.paintD);
      for (let ps = Math.ceil(s / 2) * 2; ps < sb; ps += 2) { const t = (ps - s) / (sb - s), y = ya + (yb - ya) * t; mem(B, M.steel, ps, oE - sg * 0.05, y + 0.2, ps, oE - sg * 0.05, y + 2.15, 0.04, C.paintD); }
      // the edge line
      face(sg < 0 ? -CURB + 0.3 : CURB - 0.45, sg < 0 ? -CURB + 0.45 : CURB - 0.3, 0.008, C.white, [0, 1, 0]);
    }
    // the median: a concrete barrier with its yellow lines
    face(-0.3, 0.3, 0.81, C.barrier, [0, 1, 0]);
    for (const sg of [-1, 1]) { const [x0, z0] = at(s, sg * 0.3), [x1, z1] = at(sb, sg * 0.3); B.face(M.matte, [[x0, ya, z0], [x1, yb, z1], [x1, yb + 0.81, z1], [x0, ya + 0.81, z0]], [N[0] * sg, 0, N[1] * sg], C.barrier); }
    face(-0.75, -0.6, 0.008, C.yellow, [0, 1, 0]); face(0.6, 0.75, 0.008, C.yellow, [0, 1, 0]);
    // lane lines: two per roadway, 10 ft dashes every 40 ft
    if (Math.floor(s / 12.2) * 12.2 + 3.05 > s) for (const o of [-8.0, -4.35, 4.35, 8.0]) face(o - 0.075, o + 0.075, 0.008, C.white, [0, 1, 0]);
    if (opts.girders) {
      for (const o of [-11, -7.3, -3.6, 0, 3.6, 7.3, 11]) mem(B, M.steel, s, o, ya - 0.35 - 0.85, sb, o, yb - 0.35 - 0.85, 0.2, C.girder);
    }
  }
}
// the approach piers of the viaducts: three octagonal columns under a cap beam (the Randall's Island viaduct's piers)
function approachPier(B, ctx, s, y) {
  const M = mats();
  const capT = y - 0.35 - 1.7, capB = capT - 1.6;
  for (const o of [-9.5, 0, 9.5]) {
    const [x, z] = at(s, o), g = Math.max(WATER - 2, ctx.sampleT(x, z));
    B.bar(M.matte, at(s - 0.65, o), at(s + 0.65, o), 0.65, g - 0.1, capB, C.conc, { bot: false });
    B.bar(M.matte, at(s - 0.46, o - 0.46), at(s + 0.46, o + 0.46), 0.65, g - 0.1, capB, C.conc, { bot: false, top: false });
    COLLIDERS.addBox('kit31', { x, y: (g + capB) / 2, z, hw: 0.7, hh: (capB - g) / 2, hd: 0.7, rotY: 0 });
  }
  fbox(B, M.matte, s - 0.9, s + 0.9, -13.6, 13.6, capB, capT, C.conc);
}
function bridgeBuild(B, ctx) {
  const M = mats();
  // the whole crossing from the tile that owns the lift span's middle
  const [mx, mz] = at(SPAN / 2, 0);
  if (!owns(ctx.ox, ctx.oz, mx, mz)) return 0;
  const yB = LOW + 0.9;                       // the trusses' bottom chord centre over the low steel
  // the lift span: depth 12.5 m at the ends, 15 m at mid-span
  trussBuild(B, 0, SPAN, yB, (s) => 12.5 + 2.5 * Math.sin((Math.PI * s) / SPAN), 10);
  // the side spans (their outer ends to the towers): the top chord falls from 10.5 m at the tower to 5 m at the outer end
  trussBuild(B, S_W, TOW[0][0], yB, (s) => 5 + 5.5 * Math.pow((s - S_W) / (TOW[0][0] - S_W), 0.7), 4);
  trussBuild(B, TOW[1][1], S_E, yB, (s) => 5 + 5.5 * Math.pow((S_E - s) / (S_E - TOW[1][1]), 0.7), 4);
  // through the towers: the floor on the pier tops between the shafts
  // (the tower's outer half, between the side span's end and the lift span's bearing at the tower's centre line)
  for (const [a, b] of [[TOW[0][0], 0], [SPAN, TOW[1][1]]]) { for (const o of [-TR, TR]) mem(B, M.steel, a, o, yB, b, o, yB, 0.5, C.paint); for (let s = a; s <= b + 0.01; s += (b - a) / 2) mem(B, M.steel, s, -TR, yB - 0.4, s, TR, yB - 0.4, 0.42, C.paintD); }
  // the deck, gore to gore: the approach slab at the Manhattan end, the spans, the Randall's Island approach falling to the
  // compiled viaduct
  deckBuild(B, S_GORE, S_W, bridgeY, { girders: true });
  deckBuild(B, S_W, S_E, bridgeY);
  deckBuild(B, S_E, S_END, bridgeY, { girders: true });
  // bearings: steel shoes at each truss end on the piers
  for (const s of [S_W, TOW[0][0], 0, SPAN, TOW[1][1], S_E]) for (const o of [-TR, TR]) fbox(B, M.steel, s - 0.7, s + 0.7, o - 0.8, o + 0.8, LOW - 0.6, LOW + 0.2, C.paintU);
  // the towers
  towerBuild(B, TOW[0][0], 1);
  towerBuild(B, TOW[1][0], -1);
  // the side spans' outer piers and the approach viaducts' piers (three octagonal columns, Wikipedia's Randall's viaduct)
  approachPier(B, ctx, S_W, ROAD);
  approachPier(B, ctx, S_E, ROAD);
  for (let s = S_E + 30; s < S_END; s += 30) approachPier(B, ctx, s, bridgeY(s));
  for (let s = S_W - 0.01; s > S_GORE; s -= 30) if (s < S_W - 1) approachPier(B, ctx, s, ROAD);
  // the deck's collider over the river (cars and the camera ride the traffic decks; this stops a walker or the fly camera)
  COLLIDERS.addBox('kit31', { x: mx, y: ROAD - 0.6, z: mz, hw: SPAN / 2 + SIDE, hh: 0.6, hd: SW1, rotY: Math.atan2(U[1], U[0]) });
  return 1;
}

// ---- the ramps' road surface in the tile's asphalt (HIGHWAYS P2, city/wshEnds.js): the parkway's own material on the
// kit's decks, one surface across the hand-overs; the kit then draws only its markings, slabs, girders and parapets
let RFK_TILE_ASPHALT = false;
export function rfkDeckAsphalt(tile, ox, oz, groundAt, skip = null) {
  if (!RFK34) return 0;
  if (ox > 3900 || ox + TILE < 3100 || oz > -1500 || oz + TILE < -2800) return 0;
  RFK_TILE_ASPHALT = true;
  const out = [];
  CH.forEach((c, ci) => {
    const F = frames(c), hw = c.w / 2;
    for (let i = 0; i + 1 < F.length; i++) {
      const fa = F[i], fb = F[i + 1];
      const mx = (fa.x + fb.x) / 2, mz = (fa.z + fb.z) / 2;
      if (!owns(ox, oz, mx, mz)) continue;
      const g = groundAt(mx, mz), hy = (fa.y + fb.y) / 2;
      if (g !== null && hy - g < 0.3) continue;
      if (onBridge(mx, mz) && sOf(mx, mz) > S_GORE + 1) continue;
      if (insideOther(ci, mx, mz, hy)) continue;
      if (skip && [pt(fa, -hw + 0.6), pt(fa, hw - 0.6), pt(fb, -hw + 0.6), pt(fb, hw - 0.6), [mx, hy, mz]].some((p) => skip(p[0], p[2], p[1]))) continue;   // (another builder's paving there)
      const q = [pt(fa, -hw + 0.6), pt(fb, -hw + 0.6), pt(fb, hw - 0.6), pt(fa, hw - 0.6)];
      // (wound up, as the tile's ground)
      for (const T of [[q[0], q[1], q[2]], [q[0], q[2], q[3]]]) {
        const upw = ((T[1][2] - T[0][2]) * (T[2][0] - T[0][0]) - (T[1][0] - T[0][0]) * (T[2][2] - T[0][2])) > 0;
        for (const v of upw ? T : [T[0], T[2], T[1]]) out.push(v[0] - ox, v[1], v[2] - oz);
      }
    }
  });
  if (out.length) { const a = tile.S.asphalt || new Float32Array(0), m = new Float32Array(a.length + out.length); m.set(a); m.set(out, a.length); tile.S.asphalt = m; }
  return out.length / 9;
}

// ---- hooks ---------------------------------------------------------------------------------------------------------------
export function build(group, ctx) {
  if (!RFK34) return;
  if (ctx.ox > 3900 || ctx.ox + TILE < 3100 || ctx.oz > -1500 || ctx.oz + TILE < -2800) return;
  const B = new Bag();
  const parts = [];
  try { parts.push(['ramps', rampsBuild(B, ctx)]); } catch (e) { console.warn('[rfk34] ramps', e); }
  try { parts.push(['bridge', bridgeBuild(B, ctx)]); } catch (e) { console.warn('[rfk34] bridge', e); }
  const r = B.flush(group, 'rfk34_' + ctx.key);
  if (r.meshes) console.log(`[rfk34] tile ${ctx.key}: ${parts.filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(', ')}; ${r.meshes} meshes, ${r.tris | 0} triangles`);
}
export const RFK_FRAME = { O, U, N, SPAN, TOW, S_W, S_E, S_GORE, S_END, ROAD, LOW, bridgeY };
