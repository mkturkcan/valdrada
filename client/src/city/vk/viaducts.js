// AR33 part (city/areas.js) vk: the viaducts over 125th Street, rebuilt as riveted steel to the references: the IRT
// Broadway line's Manhattan Valley viaduct (the 1 train's parabolic arch over 125th Street and the 125th Street station),
// the Riverside Drive viaduct over 12th Avenue and 125th Street, and the Park Avenue viaduct (Metro-North) with the
// Harlem-125th Street station. `?vk=0` restores the previous structures. Owner: the VIADUCT worker (docs/notes/ar33-viaducts.md).
//
// Hooks (the contracts are in city/centralPark.js): build(group, ctx) builds each piece (a span, a bent, the arch) from
// the one tile that owns its anchor point, one mesh per material per tile; `ready` waits for the materials library.
// Taking over: globalThis.__AR33VK (a Set of structure keys, read by w125w.js / w125e.js to leave their old builders
// out) with skipBent(x, z) / skipTrack(x, z) for city/elevatedKit.js (the generic IRT deck and bents on the viaduct).

import { COLLIDERS } from '../colliders.js';
import { HA_ON, haAnchors, haStructWarp, haWarpKids, haFoot } from '../../world/haAnchor.js';   // P1 TERRAIN (`?terrain=p1`)
import { haInit } from '../../world/heightAuthority.js';
import { Geo, UP } from './vkKit.js';
import { vkMatsReady, setRivBand, spikeMat } from './vkMats.js';
import { MV, P, toUL, archGeom, archBuild, mvvBents, bentBuild, spanBuild, deckBuild, mvvMats, COLL } from './mvv.js';
import { stationBuild, stationColliders } from './mvvStation.js';
import { RS, RP, rsUL, rsStations, rsdMats, rsdSpan, rsdBent, rsdLamp } from './rsd.js';
import { PK, PP, tU, parkUV, parkMats, parkInterval, parkSpan125, parkBent, parkBentTags, parkCols, parkCorner, parkPlatforms, parkHouse, DVv as DVV } from './park.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const VK = !(Q && (Q.get('vk') === '0' || Q.get('ar33') === '0' || Q.get('ar32') === '0'));
// (P1 TERRAIN, `?terrain=p1`: the structures stand on the authority's ground and carry their LiDAR decks, world/haAnchor.js)
export const ready = HA_ON ? Promise.all([vkMatsReady, haInit(), haAnchors()]) : vkMatsReady;

const owns = (ox, oz, x, z) => x >= ox && x < ox + 512 && z >= oz && z < oz + 512;
// the Manhattan Valley corridor: the whole viaduct, 122nd to 135th St
const inMVV = (x, z, pad = 0) => { const [u, l] = toUL(x, z); return u > MV.u0 - 14 - pad && u < MV.u1 + 14 + pad && Math.abs(l) < 12 + pad; };

if (VK) {
  try { Geo.spikeMat = spikeMat(); } catch { Geo.spikeMat = null; }
  const S = new Set(['mvv', 'rsd', 'park']);
  S.skipBent = (x, z) => inMVV(x, z);
  S.skipTrack = (x, z) => inMVV(x, z);
  globalThis.__AR33VK = S;
}

// ---------------------------------------------------------------- the Manhattan Valley Viaduct, piece by piece
const GY = 3.52;   // Broadway's median (the flat datum's sidewalk level)
let _mvv = null;
function mvvPlan() {
  if (_mvv) return _mvv;
  const H = MV.span / 2, bents = mvvBents();
  // stations: the abutments, every bent, the arch's ends
  const st = [MV.u0, ...bents.map((b) => b.u), -H - 0.4, H + 0.4, MV.u1].sort((a, b) => a - b);
  const spans = [];
  for (let i = 0; i + 1 < st.length; i++) { const a = st[i], b = st[i + 1]; if (a >= -H - 0.5 && b <= H + 0.5) continue; spans.push([a, b]); }
  // each bent's tower partner (half 0 -> half 1)
  bents.forEach((b, i) => { if (b.tower && b.half === 0) { const p = bents.find((q) => q.tower && q.half === 1 && Math.abs(q.u - b.u) < 9.5 && Math.abs(q.u - b.u) > 8.5 && q.sgn === b.sgn); b.partner = p || null; } });
  return (_mvv = { H, bents, spans });
}
const _coll = new Set();
const once = (k, f) => { if (_coll.has(k)) return; _coll.add(k); try { f(); } catch (e) { console.warn('[vk] colliders', e); } };
let WARP = null;   // P1 TERRAIN: the structure being built's warp (its colliders move with it)
function addBox(x, y, z, hw, hh, hd, rotY) { if (WARP) y = WARP(x, y, z); try { COLLIDERS.addBox('kit31', { x, y, z, hw, hh, hd, rotY }); } catch { /* colliders not loaded */ } }
const ROT = Math.atan2(MV.A[1], MV.A[0]);   // local +x along the line

// instanced rivet heads where the street lenses come close: the lower 3.6 m of each structure round 125th St
const RIVH = 2.8;
function mvvBuildTile(group, ctx) {
  const plan = mvvPlan(), M = mvvMats(), g = new Geo().rivZone(GY + RIVH, MV.C[0], MV.C[1], 110);
  setRivBand(M.steel, GY + RIVH, MV.C[0], MV.C[1], 110); setRivBand(M.steelS, GY + RIVH, MV.C[0], MV.C[1], 110);
  let tris = 0, n = 0;
  // the arch (and its floor and deck) from the tile owning C
  if (owns(ctx.ox, ctx.oz, MV.C[0], MV.C[1])) {
    try {
      const t = archBuild(group, GY); tris += t; n++;
      deckBuild(g, M, -plan.H - 0.4, plan.H + 0.4);
      try { stationBuild(g, GY); once('mvvStation', () => stationColliders(addBox, GY, ROT)); } catch (e) { console.warn('[vk] station', e); }
      console.log(`[vk] Manhattan Valley arch: ${t} triangles`);
      once('mvvArch', () => { const G = archGeom(GY); for (const u of [-G.H, G.H]) for (const l of MV.ribs) { const p = P(u, l, 0); addBox(p[0], GY + 0.5, p[2], 1.7, 0.9, 1.25, ROT); } });
    } catch (e) { console.warn('[vk] arch', e); }
  }
  for (const b of plan.bents) {
    const a = P(b.u, 0, 0);
    if (!owns(ctx.ox, ctx.oz, a[0], a[2])) continue;
    try { bentBuild(g, M, b, GY, b.partner); n++; } catch (e) { console.warn('[vk] bent', e); }
    once('bent' + b.u.toFixed(1), () => { for (const l of [-COLL, COLL]) { const p = P(b.u, l, 0); addBox(p[0], GY + 1.5, p[2], 0.75, 1.6, 0.75, ROT); } });
  }
  for (const [ua, ub] of plan.spans) {
    const m = P((ua + ub) / 2, 0, 0);
    if (!owns(ctx.ox, ctx.oz, m[0], m[2])) continue;
    try { spanBuild(g, M, ua, ub); deckBuild(g, M, ua, ub); n++; } catch (e) { console.warn('[vk] span', e); }
  }
  // the ends: granite-faced masonry abutments where the line meets the rising ground (the flat datum here)
  for (const [u, dir] of [[MV.u0, -1], [MV.u1, 1]]) {
    const a = P(u, 0, 0);
    if (!owns(ctx.ox, ctx.oz, a[0], a[2])) continue;
    g.rect(M.granite, P(u + dir * 6, 0, GY - 0.3), P(u + dir * 6, 0, 19.2), [MV.A[0], 0, MV.A[1]], 12.2, 12.0);
  }
  if (!g.empty) tris += g.flush(group, 'mvv' + ctx.key);
  if (n) console.log(`[vk] tile ${ctx.key}: Manhattan Valley viaduct ${n} pieces, ${tris} triangles`);
}

// ---------------------------------------------------------------- the Riverside Drive Viaduct, span by span
const RROT = Math.atan2(RS.dir[1], RS.dir[0]);
function rsdBuildTile(group, ctx) {
  const { st, s0, s1 } = rsStations(), M = rsdMats(), c = RP(RS.x125, 0, 0), g = new Geo().rivZone(RS.gy + RIVH, c[0], c[2], 90);
  setRivBand(M.steel, RS.gy + RIVH, c[0], c[2], 90); setRivBand(M.steelS, RS.gy + RIVH, c[0], c[2], 90);
  let n = 0;
  for (let i = 0; i + 1 < st.length; i++) {
    const ua = st[i], ub = st[i + 1], m = RP((ua + ub) / 2, 0, 0);
    if (!owns(ctx.ox, ctx.oz, m[0], m[2])) continue;
    try { rsdSpan(g, M, ua, ub, Math.abs(ua - s0) < 0.5 && Math.abs(ub - s1) < 0.5); n++; } catch (e) { console.warn('[vk] rsd span', e); }
  }
  st.forEach((u, i) => {
    const a = RP(u, 0, 0);
    if (!owns(ctx.ox, ctx.oz, a[0], a[2])) return;
    const pier = Math.abs(u - s0) < 0.5 || Math.abs(u - s1) < 0.5;
    try {
      const lamps = rsdBent(g, M, u, pier); n++;
      if (i % 2 === 0) lamps.forEach((b, k) => rsdLamp(g, M, b, k ? 1 : -1));
    } catch (e) { console.warn('[vk] rsd bent', e); }
    once('rsd' + u.toFixed(1), () => {
      for (const l of [RS.ribs[0], RS.ribs[RS.ribs.length - 1]]) { const p = RP(u, l, 0); addBox(p[0], RS.gy + 1.5, p[2], pier ? 1.65 : 1.3, 1.6, pier ? 1.35 : 1.1, RROT); }
    });
  });
  // granite abutments where the viaduct meets the ground at both ends (the bluffs, on the flat datum here)
  for (const u of [3, RS.L - 3]) {
    const a = RP(u, 0, 0);
    if (!owns(ctx.ox, ctx.oz, a[0], a[2])) continue;
    g.rect(M.granite, RP(u, 0, RS.gy - 0.3), RP(u, 0, RS.gy + RS.deck - 0.3), [RS.dir[0], 0, RS.dir[1]], 2 * RS.hw + 1.0, 6.0);
    g.rect(M.granite, RP(u, 0, RS.gy + RS.deck - 0.3), RP(u, 0, RS.gy + RS.deck + 1.2), [RS.dir[0], 0, RS.dir[1]], 2 * RS.hw + 1.4, 6.4);
  }
  if (!g.empty) { const t = g.flush(group, 'rsd' + ctx.key); console.log(`[vk] tile ${ctx.key}: Riverside Drive viaduct ${n} pieces, ${t} triangles`); }
}
const inRSD = (x, z, pad = 0) => { const [u, l] = rsUL(x, z); return u > -10 - pad && u < RS.L + 10 + pad && Math.abs(l) < 16 + pad; };

// ---------------------------------------------------------------- the Park Avenue Viaduct and the Harlem-125th St station
const PROADS = ['asphalt', 'busred', 'gutter', 'paintW', 'paintY', 'curb', 'sidewalk', 'brick'];
function parkBuildTile(group, ctx) {
  const M = parkMats(), c = PP(1187.1, 3449.2, 0), g = new Geo().rivZone(3.38 + RIVH + 0.4, c[0], c[2], 90);
  setRivBand(M.steel, 3.38 + RIVH + 0.4, c[0], c[2], 90); setRivBand(M.steelS, 3.38 + RIVH + 0.4, c[0], c[2], 90); setRivBand(M.dark, 3.38 + RIVH + 0.4, c[0], c[2], 90); setRivBand(M.blue, 3.38 + RIVH + 0.4, c[0], c[2], 90);
  let n = 0;
  const own = (p) => owns(ctx.ox, ctx.oz, p[0], p[2]);
  const mid = (v) => PP((tU(0, v) + tU(3, v)) / 2, v, 0);
  for (let va = PK.V_S; va < PK.V_N; va += 6.0) {
    const vb = Math.min(PK.V_N, va + 6.0);
    if (!own(mid((va + vb) / 2))) continue;
    try { parkInterval(g, M, va, vb); n++; } catch (e) { console.warn('[vk] park interval', e); }
  }
  const sy = (x, z) => { try { return ctx.surfY ? ctx.surfY(x, z, PROADS, 0.25) : null; } catch { return null; } };
  for (let k = Math.ceil(PK.V_S / 15.24); k * 15.24 < PK.V_N; k++) {
    const v = k * 15.24, uM = (tU(1, v) + tU(2, v)) / 2;
    if (!own(PP(uM, v, 0))) continue;
    if (v > PK.v125[0] - 6.5 && v < PK.v125[1] + 1.5) continue;
    if (uM > PK.SH.u0 - 1 && uM < PK.SH.u1 + 1 && v > PK.SH.v0 - 1 && v < PK.SH.v1 + 1) continue;
    let street = false;
    for (const u of parkCols(v)) for (const dv of [-2.2, 0, 2.2]) { const p = PP(u, v + dv, 0); if (sy(p[0], p[2]) !== null) street = true; }
    if (street) continue;
    const gy = 3.38;
    try { parkBent(g, M, v, gy); n++; } catch (e) { console.warn('[vk] park bent', e); }
    once('park' + k, () => { for (const u of parkCols(v)) { const p = PP(u, v, 0); addBox(p[0], gy + 2.5, p[2], 0.55, 2.6, 0.55, Math.atan2(0.4848, 0.8746)); } });
  }
  // the bent at the south end of the span over 125th St, on Park Avenue's median at the street's south side (the 2026
  // is left out above)
  { const v = PK.v125[0] - 0.9, uM = (tU(1, v) + tU(2, v)) / 2;
    if (own(PP(uM, v, 0))) {
      try { parkBent(g, M, v, 3.38); parkBentTags(g, v, 3.38); n++; } catch (e) { console.warn('[vk] park 125th bent', e); }
      once('park125s', () => { for (const u of parkCols(v)) { const p = PP(u, v, 0); addBox(p[0], 3.38 + 2.5, p[2], 0.55, 2.6, 0.55, Math.atan2(0.4848, 0.8746)); } });
    }
  }
  // the corner column on the west sidewalk at the span's south end with its girder to the west fascia (park.js parkCorner)
  { const p = PP(PK.CORNER[0], PK.CORNER[1], 0);
    if (own(p)) {
      try { parkCorner(g, M, 3.38); n++; } catch (e) { console.warn('[vk] park corner', e); }
      once('parkCorner', () => addBox(p[0], 3.38 + 2.5, p[2], 0.55, 2.6, 0.55, Math.atan2(0.4848, 0.8746)));
    }
  }
  // stone abutments at the part's south end (110th St, where the steel runs on onto the 1870s masonry) and at the
  // Harlem River lift bridge's abutment
  for (const [v, d] of [[PK.V_S, -1], [PK.V_N, 1]]) {
    const uL = tU(0, v) - PK.EDGE, uR = tU(3, v) + PK.EDGE, a = PP((uL + uR) / 2, v + d * 6, 0);
    if (!own(a)) continue;
    g.rect(M.granite, PP((uL + uR) / 2, v, 3.2), PP((uL + uR) / 2, v + d * 12, 3.2), UP, uR - uL + 0.6, 0.02, { caps: false });
    g.rect(M.granite, [a[0], 3.2, a[2]], [a[0], PK.DECK_T, a[2]], [DVV[0], 0, DVV[2]], uR - uL + 0.6, 12.0);
  }
  const c125 = mid((PK.v125[0] + PK.v125[1]) / 2);
  if (own(c125)) { try { parkSpan125(g, M); n++; } catch (e) { console.warn('[vk] park 125th span', e); } }
  const ch = PP((PK.SH.u0 + PK.SH.u1) / 2, (PK.SH.v0 + PK.SH.v1) / 2, 0);
  if (own(ch)) {
    try { parkPlatforms(g, M); n++; } catch (e) { console.warn('[vk] park platforms', e); }
    try { parkHouse(g, M, 3.52); n++; } catch (e) { console.warn('[vk] park house', e); }
    once('parkHouse', () => addBox(ch[0], 3.52 + 3, ch[2], (PK.SH.u1 - PK.SH.u0) / 2 + 0.2, 3, (PK.SH.v1 - PK.SH.v0) / 2 + 0.2, Math.atan2(0.4848, 0.8746)));
  }
  if (!g.empty) { const t = g.flush(group, 'park' + ctx.key); console.log(`[vk] tile ${ctx.key}: Park Avenue viaduct ${n} pieces, ${t} triangles`); }
}
const inPARK = (x, z, pad = 0) => { const [u, v] = parkUV(x, z); return v > PK.V_S - 20 - pad && v < PK.V_N + 20 + pad && u > 1150 - pad && u < 1230 + pad; };

// ---------------------------------------------------------------- hooks
// The compile laid the Riverside Drive bridge way as a road ribbon of its own at y 10.3 (ramping from 5 m at its ends)
// with traffic on it, 13 m under the rebuilt deck (23.3 m over the street): its raised triangles are taken out and its
// road records flagged noTraffic (sim/traffic.js skips them; sim/peds.js skips level > 0 roads already), so no road or car
// hangs in the arches. The rebuilt deck carries its own roadway surface (vk/rsd.js).
const onRsdDeck = (x, z) => { const [u, l] = rsUL(x, z); return u > -40 && u < 520 && Math.abs(l) < 20; };
export function apply(tile, ox, oz) {
  if (!VK || !(ox < 1150 && ox + 512 > 780 && oz < -3690 && oz + 512 > -4260)) return;
  let nr = 0, nt = 0;
  const RV = tile.S.roadVerts, meta = tile.S.roads;
  if (RV && meta && meta.byteLength) {
    const m = Uint8Array.from(meta), dv = new DataView(m.buffer);
    for (let i = 0; i < m.byteLength / 24; i++) {
      const o = i * 24, start = dv.getUint32(o, true), len = dv.getUint16(o + 4, true);
      for (let j = 0; j < len; j++) {
        const x = RV[(start + j) * 3] + ox, y = RV[(start + j) * 3 + 1], z = RV[(start + j) * 3 + 2] + oz;
        if (y > 4.5 && onRsdDeck(x, z)) { m[o + 6] |= 0x80; nr++; break; }
      }
    }
    if (nr) tile.S.roads = m;
  }
  for (const name of ['asphalt', 'curb', 'paintW', 'paintY', 'sidewalk', 'gutter', 'busred']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    let cut = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const y = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, x = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      if (y > 4.5 && onRsdDeck(x, z)) { cut++; continue; }
      for (let k = 0; k < 9; k++) out.push(a[i + k]);
    }
    if (cut) { tile.S[name] = Float32Array.from(out); nt += cut; }
  }
  if (nr || nt) console.log(`[vk] tile ${ox / 512}_${oz / 512}: the compiled Riverside Drive bridge ribbon: ${nt} triangles out, ${nr} roads without traffic`);
}
// P1 TERRAIN: each structure's warp (world/haAnchor.js haStructWarp): its flat ground datum, the underside of its deck
// (under it the bents and arches stretch to the authority's ground), its LiDAR deck profile by its own frame's parameter
const GKINDS = ['sidewalk', 'curb', 'brick', 'plaza', 'path', 'grass', 'grassU', 'gravel', 'asphalt', 'gutter', 'busred'];
const vkWarp = (k, ctx) => {
  if (!HA_ON) return null;
  const gr = (x, z) => { try { return ctx.surfY ? ctx.surfY(x, z, GKINDS, 0.05) : null; } catch { return null; } };   // the foot on the lifted section under it
  if (k === 'mvv') return haStructWarp('irt_mvv', (x, z) => toUL(x, z)[0], GY, MV.RAIL - 3.0, ctx.ox, ctx.oz, gr);
  if (k === 'rsd') return haStructWarp('rsd', (x, z) => rsUL(x, z)[0], RS.gy, RS.gy + RS.crown - 1.0, ctx.ox, ctx.oz, gr);
  return haStructWarp('park', (x, z) => parkUV(x, z)[1], 3.38, PK.XG_B, ctx.ox, ctx.oz, gr);
};
const VK_G0 = { mvv: GY, rsd: RS.gy, park: 3.38 };
const warped = (k, group, ctx, f) => {
  const i0 = group.children.length;
  WARP = vkWarp(k, ctx);
  try { f(); } finally {
    const W = WARP; WARP = null;
    // (the anchor gate, tools/terrain/anchor_gate.mjs: the vertices the flat build stood on its ground datum, one a metre,
    // are footings after the warp)
    const probe = globalThis.__HA_FEET ? new Map() : null;
    if (probe) for (let i = i0; i < group.children.length; i++) {
      const o = group.children[i], pa = o.isMesh && !o.isInstancedMesh && o.geometry.attributes.position;
      if (pa) for (let q = 0; q < pa.count; q++) { const y = pa.array[3 * q + 1]; if (Math.abs(y - VK_G0[k]) < 0.02) { const key = `${i}:${Math.round(pa.array[3 * q])}:${Math.round(pa.array[3 * q + 2])}`; if (!probe.has(key)) probe.set(key, q); } }
    }
    if (W) haWarpKids(group, i0, W);
    if (probe) for (const [key, q] of probe) { const o = group.children[+key.split(':')[0]], a = o.geometry.attributes.position.array; haFoot('viaducts', `${k}:${key}`, 'col', a[3 * q], a[3 * q + 2], a[3 * q + 1], { r: 0 }); }
  }
};
export function build(group, ctx) {
  if (!VK) return;
  if (inMVV(ctx.ox + 256, ctx.oz + 256, 400)) { try { warped('mvv', group, ctx, () => mvvBuildTile(group, ctx)); } catch (e) { console.warn('[vk] mvv', e); } }
  if (inPARK(ctx.ox + 256, ctx.oz + 256, 400)) { try { warped('park', group, ctx, () => parkBuildTile(group, ctx)); } catch (e) { console.warn('[vk] park', e); } }
  if (inRSD(ctx.ox + 256, ctx.oz + 256, 400)) { try { warped('rsd', group, ctx, () => rsdBuildTile(group, ctx)); } catch (e) { console.warn('[vk] rsd', e); } }
}
// compiled furniture standing on a pier, a pedestal or a column line of the Manhattan Valley viaduct
export function dropFurniture(wx, wz) {
  if (!VK) return false;
  if (inRSD(wx, wz)) {
    const [u, l] = rsUL(wx, wz), { st, s0, s1 } = rsStations();
    for (const s of st) { const pier = Math.abs(s - s0) < 0.5 || Math.abs(s - s1) < 0.5; if (Math.abs(u - s) < (pier ? 2.0 : 1.4) && Math.abs(Math.abs(l) - 11.2) < 1.6) return true; }
  }
  if (inPARK(wx, wz)) {
    // a compiled lamp, tree or sign standing on a bent column's footing in the median
    const [u, v] = parkUV(wx, wz), k = Math.round(v / 15.24), vb = k * 15.24, uM = (tU(1, vb) + tU(2, vb)) / 2;
    if (Math.abs(v - vb) < 1.1) for (const uc of parkCols(vb)) if (Math.abs(u - uc) < 1.1) return true;
    // and on the 125th St span's south bent
    const v5 = PK.v125[0] - 0.9, u5 = (tU(1, v5) + tU(2, v5)) / 2;
    if (Math.abs(v - v5) < 1.1) for (const uc of parkCols(v5)) if (Math.abs(u - uc) < 1.1) return true;
  }
  if (!inMVV(wx, wz)) return false;
  const [u, l] = toUL(wx, wz), H = MV.span / 2;
  if (Math.abs(Math.abs(u) - H) < 2.2 && Math.abs(l) < 9) return true;
  for (const b of mvvPlan().bents) if (Math.abs(u - b.u) < 1.2 && Math.abs(Math.abs(l) - COLL) < 1.2) return true;
  return false;
}

