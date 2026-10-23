// CP32 part (city/centralPark.js): Bow Bridge, the rowboats on the Lake, the Loeb Boathouse, Belvedere Castle, Gapstow
// Bridge, Cleopatra's Needle and the others (docs/notes/central-park-landmarks.md). Hooks, all optional (see
// centralPark.js for the contracts): apply(tile, ox, oz), skipBuilding(cx, cz, h, area), dropFurniture(wx, wz, f),
// furniture(), build(group, ctx), promenades(), seats(). `?cp32m=0` leaves the part out (the compiled park comes back
// where it changed it: Bow Bridge's CSCL roadway and the compiled boxes it skips).
// The positions, outlines and courses below are measured from OpenStreetMap (OpenStreetMap contributors, ODbL 1.0), the
// Library of Congress's HAER record NY-195 (public domain) and published figures; see the notes for each source.
import { COLLIDERS } from './colliders.js';
import * as land from './cpLand.js';
import { CP_DATUM, cpDemToWorld, cpReliefReady } from './cpRelief.js';
import { BOW, bowDeckY, buildBowBridge, bowColliders, bowPromenade, buildRowboats, BOATHOUSE, buildBoathouse, BELV, buildBelvedere, belvedereColliders, GAP, gapWalkY, buildGapstow, gapColliders, NEEDLE, buildNeedle, OAK, oakFrame, oakDeckY, buildOakBridge, oakColliders, STATUES, buildStatue, BANDSHELL, buildBandshell, LADIES, buildLadies, SGATE, buildGatehouse, LANDING, buildLanding, DELA, buildDelacorte, K as KC, buildOctagon, DAIRY, buildDairy, SWEDISH, buildSwedish, RINK, buildRinkBoards, mergeByMaterial, BALC, buildBalcony, buildArch, LBin, lmMats } from './cpLandmarksKit.js';
import * as RELIEF from './cpRelief.js';
import { cpDriveArch, cpDriveH, CPD_ON } from './cpDrives.js';   // TERRAIN INT2: arches under the drives
import { HA_P1 } from '../world/heightAuthority.js';
import { haBaseAt } from '../world/haAnchor.js';
import { mkConvex, tpSplit } from './tsqPlaza.js';
// CPB33: the bridges and arches modelled stone by stone (city/cpBridges.js); the CP32 builders stay as their far level
import { CPB33, CPB34, buildBowBridgeB, buildGapstowB, buildOakBridgeB, buildBalconyB, buildArchB, gapGrade, bowBanks } from './cpBridges.js';
// CP33L: the Lake's rowboats with photoreal rowers, the Loeb Boathouse and Cleopatra's Needle for the near field
// (city/cpLakeside.js); the CP32 builders in cpLandmarksKit.js stay as the `?cp33l=0` fallback
import { CP33L, lsBuildFleet } from './cpLakeside.js';
// CPC33: Belvedere Castle, its terraces and Vista Rock stone by stone (city/cpCastle.js); the CP32 builder stays behind `?cpc33=0`
import { CPC33, buildCastleB, castleColliders, CASTLE_BENCH, castleKeepOut, castleDrop } from './cpCastle.js';

export const CP32M = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp32m') === '0');
const TILE = 512;
const owns = (ox, oz, x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;

// The water under a structure: the LAND part's surface (cpLand.js cpWaterLevelY / cpWaterY), else the 3DEP level through
// the relief (the Lake 16.6-17.0 m NAVD88, LAND's and the lead's medians), else, on the flat compile, 1 m under the lawn
function waterY(key, dem, x, z) {
  try { const y = land.cpWaterLevelY?.(key, x, z); if (y != null && isFinite(y)) return y; } catch { /* not in yet */ }
  try { const y = land.cpWaterY?.(x, z); if (y != null && isFinite(y)) return y; } catch { /* not in yet */ }
  return cpReliefReady() ? cpDemToWorld(dem, x, z) : CP_DATUM - 1.0;
}

// a point's height on the tile's walkable or lawn sections (tile-local triangle lists, world y), null where none is
function secY(tile, ox, oz, names, x, z) {
  for (const name of names) {
    const a = tile.S[name];
    if (!a) continue;
    for (let o = 0; o + 8 < a.length; o += 9) {
      const x0 = a[o] + ox, z0 = a[o + 2] + oz, x1 = a[o + 3] + ox, z1 = a[o + 5] + oz, x2 = a[o + 6] + ox, z2 = a[o + 8] + oz;
      if (x < Math.min(x0, x1, x2) || x > Math.max(x0, x1, x2) || z < Math.min(z0, z1, z2) || z > Math.max(z0, z1, z2)) continue;
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2); if (Math.abs(d) < 1e-9) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d, l2 = 1 - l0 - l1;
      if (l0 >= -1e-4 && l1 >= -1e-4 && l2 >= -1e-4) return l0 * a[o + 1] + l1 * a[o + 4] + l2 * a[o + 7];
    }
  }
  return null;
}
const GROUND = ['path', 'sidewalk', 'gravel', 'plaza', 'brick', 'grass', 'grassU'];

// ---- Bow Bridge ---------------------------------------------------------------------------------------------------
// CSCL codes "CENTRAL PARK BOW BRIDGE" as a roadway (9.1 m, rclass 1) with sidewalks, curbs and paint, drawn by the
// compiler as ground at the flat datum: its triangles in the bridge's corridor go, and a walkable strip (`path`, 0.25 m
// under the planks, inside the deck's body) takes its place so sim/peds.js's surfaceAt finds ground there and lifts the
// walkers onto the deck prisms. The levels are fixed here, where the ground is final (the relief and LAND's banks are
// applied before this part), and kept for build().
let BOWL = null;                                   // { W, gS, gN }
const ROADK = ['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'paintG', 'gutter', 'busred', 'warn', 'warnIron'];
function bowApply(tile, ox, oz) {
  const [cx, cz] = BOW.C, [ax, az] = BOW.A;
  if (!owns(ox, oz, cx, cz)) return;
  const toU = (x, z) => [(x - cx) * ax + (z - cz) * az, -(x - cx) * az + (z - cz) * ax];
  let cut = 0;
  for (const name of ROADK) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    for (let o = 0; o + 8 < a.length; o += 9) {
      const [u, w] = toU((a[o] + a[o + 3] + a[o + 6]) / 3 + ox, (a[o + 2] + a[o + 5] + a[o + 8]) / 3 + oz);
      // only under the bridge itself: past its ends the roadway's sidewalk caps are the only ground (no lawn under them), and
      // cutting them opened holes onto LAND's lowered shore grid (the final r1 deck view)
      if (Math.abs(u) < BOW.END + 0.3 && Math.abs(w) < 6.5) { cut++; continue; }
      for (let k = 0; k < 9; k++) out.push(a[o + k]);
    }
    if (out.length !== a.length) tile.S[name] = Float32Array.from(out);
  }
  // the roadway's record itself: the walkers' sidewalks along a street (sim/peds.js, rclass <= 2 at level 0) would run
  // 6.45 m either side of its centreline, out over the water (the final r1 bowSideE still: walkers on the Lake under the
  // arch); marked level 1 (a structure's deck) they are not laid, the bridge's own promenade carries the walkers
  { const m = tile.S.roads, names = tile.header.names || [];
    if (m && m.byteLength) { const dv = new DataView(m.buffer, m.byteOffset, m.byteLength);
      for (let o = 0; o + 24 <= m.byteLength; o += 24) if (names[dv.getUint16(o + 16, true)] === 'CENTRAL PARK BOW BRIDGE') dv.setUint8(o + 14, 1); } }
  // the ground a step beyond each end (the paths the bridge lands on), the Lake's surface under its centre
  const gAt = (u) => {
    for (const d of [1.5, 3, 5, 8]) {
      const uu = u + Math.sign(u) * d, x = cx + ax * uu, z = cz + az * uu;
      const y = secY(tile, ox, oz, GROUND, x, z);
      if (y !== null) return y;
    }
    return CP_DATUM;
  };
  const W = waterY('lake', 17.0, cx, cz), gS = gAt(-BOW.END), gN = gAt(BOW.END);
  BOWL = { W, gS, gN };
  // CP34: past the ends the roadway's sidewalks and kerbs ran down the banks into the Lake; there they are lawn (cpBridges.js bowBanks)
  try { const n = bowBanks(tile, ox, oz, W, gS, gN, (x, z, pad) => land.cpWaterY(x, z, pad)); if (n) console.log(`[cp34] Bow Bridge: ${n} roadway triangles on the banks made lawn or dropped`); } catch (e) { console.warn('[cp34] Bow banks', e); }
  // the walkers' strip under the planks
  const strip = [];
  const pt = (u, w) => { const x = cx + ax * u - az * w, z = cz + az * u + ax * w; return [x - ox, Math.max(bowDeckY(u, W, gS, gN) - 0.25, Math.min(gS, gN) - 0.3), z - oz]; };
  const HWs = BOW.RAIL - 0.18;
  for (let u = -BOW.END; u < BOW.END - 1e-6; u += 1.0) {
    const u1 = Math.min(BOW.END, u + 1.0);
    const A = pt(u, -HWs), B = pt(u1, -HWs), C = pt(u1, HWs), D = pt(u, HWs);
    strip.push(...A, ...C, ...B, ...A, ...D, ...C);
  }
  const p = tile.S.path;
  const merged = new Float32Array((p ? p.length : 0) + strip.length);
  if (p) merged.set(p, 0);
  merged.set(strip, p ? p.length : 0);
  tile.S.path = merged;
  console.log(`[cp32m] Bow Bridge: ${cut} roadway triangles cut, the Lake at ${W.toFixed(2)}, the ends' ground ${gS.toFixed(2)} (S) / ${gN.toFixed(2)} (N), deck ${bowDeckY(0, W, gS, gN).toFixed(2)} at the crown`);
}
let _bowColl = false;
function bowBuild(group, ctx) {
  const [cx, cz] = BOW.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  if (!BOWL) {
    const [ax, az] = BOW.A, e = BOW.END + 2;
    BOWL = { W: waterY('lake', 17.0, cx, cz), gS: ctx.padYNear(cx - ax * e, cz - az * e), gN: ctx.padYNear(cx + ax * e, cz + az * e) };
  }
  const { W, gS, gN } = BOWL;
  const parts = CPB33 ? buildBowBridgeB(group, W, gS, gN, ctx.key) : buildBowBridge(group, W, gS, gN, ctx.key);
  if (!_bowColl) { _bowColl = true; try { bowColliders(COLLIDERS, W, gS, gN); } catch (e) { console.warn('[cp32m] bow colliders', e); } }
  console.log(`[cp32m] Bow Bridge built: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')} triangles`);
}

// ---- the rowboats on the Lake -------------------------------------------------------------------------------------
// Courses from tools/cp/lm_boats.mjs over the Lake's OpenStreetMap outline (relation 7895705; OpenStreetMap contributors,
// ODbL): [cx, cz, a, b, psi, dir, v (m/s), phase], a 0 for a boat drifting with its oars shipped. Built with Bow Bridge's
// tile, which holds most of the Lake.
const COURSES = [[-68.66, 607.75, 20.39, 10.19, 0.48, 1, 0.7, 1.85], [-110.13, 727.13, 15.14, 8.17, 0.61, -1, 0.57, 2.3],
  [-164.41, 672.27, 16.49, 6.79, 2.9, -1, 0.86, 5.56], [145.92, 886.52, 22.88, 17.84, 2.4, 1, 0.64, 4.57],
  [-72.77, 827.97, 7.42, 3.59, 1.7, 1, 0.8, 1.83], [-126, 779.57, 13.87, 5.32, 2.43, -1, 0.87, 5.72],
  [-58.31, 650.71, 7.98, 3.62, 2.54, -1, 0.6, 5.82], [23.47, 828.1, 9.05, 4.52, 2.25, -1, 0.74, 3.7],
  [52.05, 856.48, 8.67, 6.63, 1.57, -1, 0.7, 5.44], [28.41, 855.44, 9.74, 3.7, 2.28, -1, 0.7, 3.42],
  [-62.48, 692.06, 8.95, 3.4, 0.25, 1, 0.67, 1.26], [-79.13, 641.03, 9.01, 3.78, 0.17, 1, 0.68, 0.57],
  [-109.84, 590.8, 8.94, 3.95, 1.37, 1, 0.76, 3.63], [-174.36, 760.69, 18.78, 14.1, 1.82, -1, 0.65, 6.25],
  [-165.73, 832.93, 11.91, 7.52, 2.37, 1, 0.84, 5.73], [72.3, 849.09, 7.15, 2.87, 1.94, -1, 0.58, 1.81],
  [-48.14, 675.94, 0, 0, 6.19, 1, 0.04, 4.15], [-121.93, 809.48, 0, 0, 4.71, -1, 0.05, 1.13],
  [47.08, 904.06, 0, 0, 1.15, 1, 0.03, 4.84], [89.26, 796.7, 0, 0, 3.84, 1, 0.03, 4.77], [-97.59, 625.87, 0, 0, 1.98, 1, 0.02, 2.49]];
function boatsBuild(group, ctx) {
  const [cx, cz] = BOW.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  const r = (CP33L ? lsBuildFleet : buildRowboats)(group, COURSES, (x, z) => waterY('lake', 17.0, x, z));
  console.log(`[cp32m] rowboats: ${r.boats} boats, ${r.people} people`);
  const [lx, lz] = LANDING.P, L = buildLanding(group, waterY('lake', 17.0, lx, lz + 4), ctx.padYNear(lx, lz - 1.5));
  try { COLLIDERS.addBox('kit31', { x: lx, y: L.y - 0.3, z: lz + 2.3, hw: 2.0, hh: 0.3, hd: 2.9, rotY: 0, deck: true }); } catch { /* colliders not loaded */ }
  console.log(`[cp32m] the Bow Bridge boat landing: ${L.tris} triangles, deck at ${L.y.toFixed(2)}`);
}

// ---- the Loeb Boathouse ------------------------------------------------------------------------------------------
function boathouseBuild(group, ctx) {
  const [cx, cz] = BOATHOUSE.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  const W = waterY('lake', 17.0, 178, 880), gE = ctx.padYNear(222, 868);
  const parts = buildBoathouse(group, W, gE);
  console.log(`[cp32m] Loeb Boathouse built at the Lake ${W.toFixed(2)} (ground east ${gE.toFixed(2)}): ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// ---- Belvedere Castle ---------------------------------------------------------------------------------------------
// its floor on the top of Vista Rock: the published 130 ft (39.6 m NAVD88) through the relief; on the flat compile 6 m
// over the lawn (the rock's height over Turtle Pond's shore)
let _belvColl = false;
function belvedereBuild(group, ctx) {
  const [cx, cz] = BELV.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  const B = cpReliefReady() ? cpDemToWorld(39.6, cx, cz) : CP_DATUM + 6.0;
  const groundAt = (x, z) => { let g = ctx.padYNear(x, z); try { const r = land.cpRockTop?.(x, z); if (r != null && isFinite(r) && r > g) g = r; } catch { /* not in yet */ } return g; };
  const parts = CPC33 ? buildCastleB(group, B) : buildBelvedere(group, B, groundAt);
  if (!_belvColl) { _belvColl = true; try { if (CPC33) castleColliders(COLLIDERS, B); else belvedereColliders(COLLIDERS, B); } catch (e) { console.warn('[cp32m] belvedere colliders', e); } }
  console.log(`[cp32m] Belvedere Castle built on Vista Rock at ${B.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// ---- Gapstow Bridge ----------------------------------------------------------------------------------------------
// the compiled path over it (CSCL "HALLETT NATURE SANCTUARY PATH", flat, 3 m under the deck once the relief is in) is cut
// along the bridge and its walled approaches and the walkers' strip laid 0.25 m under the paving, as on Bow Bridge
let GAPL = null;
function gapApply(tile, ox, oz) {
  const [cx, cz] = GAP.C, [ax, az] = GAP.A;
  if (!owns(ox, oz, cx, cz)) return;
  const E = GAP.HALF + GAP.RAMP;
  const toU = (x, z) => [(x - cx) * ax + (z - cz) * az, -(x - cx) * az + (z - cz) * ax];
  const gAt = (u) => { for (const d of [1.5, 3, 5, 8]) { const uu = u + Math.sign(u) * d, y = secY(tile, ox, oz, GROUND, cx + ax * uu, cz + az * uu); if (y !== null) return y; } return CP_DATUM; };
  const W = waterY('pond', 7.1, cx, cz), gW = gAt(-E), gE = gAt(E);
  GAPL = { W, gW, gE };
  let cut = 0;
  for (const name of ['path', 'sidewalk', 'gravel', 'plaza', 'brick']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    for (let o = 0; o + 8 < a.length; o += 9) {
      const [u, w] = toU((a[o] + a[o + 3] + a[o + 6]) / 3 + ox, (a[o + 2] + a[o + 5] + a[o + 8]) / 3 + oz);
      if (Math.abs(u) < E + 0.5 && Math.abs(w) < GAP.W2 + 0.3) { cut++; continue; }
      for (let k = 0; k < 9; k++) out.push(a[o + k]);
    }
    if (out.length !== a.length) tile.S[name] = Float32Array.from(out);
  }
  // CP34: the walled approaches are gone; the banks are graded to the bridge's ends instead (cpBridges.js gapGrade)
  try { const g = gapGrade(tile, ox, oz, W, gW, gE, (x, z, pad) => land.cpWaterY(x, z, pad)); if (g) console.log(`[cp34] Gapstow's banks graded: ${g.tris} triangles, ${g.moved} vertices moved`); } catch (e) { console.warn('[cp34] Gapstow grade', e); }
  const strip = [], HW = GAP.W2 - 0.6;
  const pt = (u, w) => { const x = cx + ax * u - az * w, z = cz + az * u + ax * w; return [x - ox, gapWalkY(u, W, gW, gE) - 0.25, z - oz]; };
  for (let u = -E; u < E - 1e-6; u += 1.0) {
    const u1 = Math.min(E, u + 1.0), A = pt(u, -HW), B = pt(u1, -HW), C = pt(u1, HW), D = pt(u, HW);
    strip.push(...A, ...C, ...B, ...A, ...D, ...C);
  }
  const p = tile.S.path, merged = new Float32Array((p ? p.length : 0) + strip.length);
  if (p) merged.set(p, 0);
  merged.set(strip, p ? p.length : 0);
  tile.S.path = merged;
  console.log(`[cp32m] Gapstow Bridge: ${cut} path triangles cut, the Pond at ${W.toFixed(2)}, the approaches' feet ${gW.toFixed(2)} (W) / ${gE.toFixed(2)} (E)`);
}
let _gapColl = false;
function gapBuild(group, ctx) {
  const [cx, cz] = GAP.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  if (!GAPL) { const [ax, az] = GAP.A, e = GAP.HALF + GAP.RAMP + 2; GAPL = { W: waterY('pond', 7.1, cx, cz), gW: ctx.padYNear(cx - ax * e, cz - az * e), gE: ctx.padYNear(cx + ax * e, cz + az * e) }; }
  const { W, gW, gE } = GAPL;
  const parts = CPB33 ? buildGapstowB(group, W, gW, gE) : buildGapstow(group, W, gW, gE);
  if (!_gapColl) { _gapColl = true; try { gapColliders(COLLIDERS, W, gW, gE, CPB34 ? GAP.HALF + 0.4 : Infinity); } catch (e) { console.warn('[cp32m] gapstow colliders', e); } }
  console.log(`[cp32m] Gapstow Bridge built: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// ---- Oak Bridge ---------------------------------------------------------------------------------------------------
// CSCL's "CENTRAL PARK BOW BRIDGE PATH" crosses Bank Rock Bay here: its triangles along the bridge are cut, the strip laid
let OAKL = null;
function oakApply(tile, ox, oz) {
  const F = oakFrame(), [cx, cz] = F.C, [ax, az] = F.A, H = F.L / 2;
  if (!owns(ox, oz, cx, cz)) return;
  const toU = (x, z) => [(x - cx) * ax + (z - cz) * az, -(x - cx) * az + (z - cz) * ax];
  // the banks: the lawn's level (the relief's deck hold may lift the path round a bridge), no more than 2 m over the water
  // (the real bridge stands about 1.5 m over Bank Rock Bay)
  const W = waterY('lake', 16.6, cx, cz);
  const gAt = (u) => { for (const d of [1.0, 2.5, 4, 7]) { const uu = u + Math.sign(u) * d, x = cx + ax * uu, z = cz + az * uu, g = secY(tile, ox, oz, ['grass', 'grassU'], x, z), p = secY(tile, ox, oz, GROUND, x, z), y = g !== null && p !== null ? Math.min(g, p) : g ?? p; if (y !== null) return Math.min(y, W + 2.0); } return W + 1.2; };
  const gA = gAt(-H), gB = gAt(H);
  OAKL = { W, gA, gB };
  let cut = 0;
  for (const name of ['path', 'sidewalk', 'gravel', 'plaza', 'brick']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    for (let o = 0; o + 8 < a.length; o += 9) {
      const [u, w] = toU((a[o] + a[o + 3] + a[o + 6]) / 3 + ox, (a[o + 2] + a[o + 5] + a[o + 8]) / 3 + oz);
      if (Math.abs(u) < H + 0.3 && Math.abs(w) < OAK.W2 + 0.3) { cut++; continue; }
      for (let k = 0; k < 9; k++) out.push(a[o + k]);
    }
    if (out.length !== a.length) tile.S[name] = Float32Array.from(out);
  }
  const strip = [], HW = OAK.W2 - 0.35;
  const pt = (u, w) => { const x = cx + ax * u - az * w, z = cz + az * u + ax * w; return [x - ox, oakDeckY(u, W, gA, gB) - 0.25, z - oz]; };
  for (let u = -H; u < H - 1e-6; u += 1.0) { const u1 = Math.min(H, u + 1.0), A = pt(u, -HW), B = pt(u1, -HW), C = pt(u1, HW), D = pt(u, HW); strip.push(...A, ...C, ...B, ...A, ...D, ...C); }
  const p = tile.S.path, merged = new Float32Array((p ? p.length : 0) + strip.length);
  if (p) merged.set(p, 0);
  merged.set(strip, p ? p.length : 0);
  tile.S.path = merged;
  console.log(`[cp32m] Oak Bridge: ${cut} path triangles cut, the Lake at ${W.toFixed(2)}, the banks ${gA.toFixed(2)} / ${gB.toFixed(2)}`);
}
let _oakColl = false;
function oakBuild(group, ctx) {
  const F = oakFrame(), [cx, cz] = F.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  if (!OAKL) { const [ax, az] = F.A, e = F.L / 2 + 1.5; OAKL = { W: waterY('lake', 16.6, cx, cz), gA: ctx.padYNear(cx - ax * e, cz - az * e), gB: ctx.padYNear(cx + ax * e, cz + az * e) }; }
  const { W, gA, gB } = OAKL, parts = CPB33 ? buildOakBridgeB(group, W, gA, gB) : buildOakBridge(group, W, gA, gB);
  if (!_oakColl) { _oakColl = true; try { oakColliders(COLLIDERS, W, gA, gB); } catch (e) { console.warn('[cp32m] oak colliders', e); } }
  console.log(`[cp32m] Oak Bridge built: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// ---- the Mall: the Literary Walk's statues, the Naumburg Bandshell -------------------------------------------------
const _statColl = new Set();
function mallBuild(group, ctx) {
  let n = 0, tris = 0;
  for (const s of STATUES) {
    if (!owns(ctx.ox, ctx.oz, s.x, s.z)) continue;
    const G = ctx.padYNear(s.x, s.z);
    tris += buildStatue(group, s, G); n++;
    if (!_statColl.has(s.n)) { _statColl.add(s.n); try { COLLIDERS.addBox('kit31', { x: s.x, y: G + 1.2, z: s.z, hw: 1.05, hh: 1.2, hd: 1.05, rotY: 0 }); } catch { /* colliders not loaded */ } }
  }
  if (n) console.log(`[cp32m] the Mall's statues: ${n} built (${tris} triangles)`);
  const [x0, z0] = BANDSHELL.P0, [x1, z1] = BANDSHELL.P1, bx = (x0 + x1) / 2, bz = (z0 + z1) / 2;
  if (owns(ctx.ox, ctx.oz, bx, bz)) {
    const G = ctx.padYNear(bx - 3, bz - 1);
    const parts = buildBandshell(group, G);
    console.log(`[cp32m] Naumburg Bandshell built at ${G.toFixed(2)}: ${parts.map(([nm, t]) => `${nm} ${t}`).join(', ')}`);
  }
}

// ---- the Ladies' Pavilion on Hernshead, the Reservoir's South Gate House ----------------------------------------------
function smallBuild(group, ctx) {
  const at = (P) => [(P[0][0] + P[1][0] + P[2][0] + P[3][0]) / 4, (P[0][1] + P[1][1] + P[2][1] + P[3][1]) / 4];
  const [lx, lz] = at(LADIES.P);
  if (owns(ctx.ox, ctx.oz, lx, lz)) {
    // on the Hernshead: LAND's outcrop (cpRockTop) rises up to 1.7 m over the lawn there, so the platform takes the highest
    // of the ground and the rock over its footprint
    let G = ctx.padYNear(lx, lz);
    for (const p of [...LADIES.P, [lx, lz]]) { G = Math.max(G, ctx.padYNear(p[0], p[1])); try { const r = land.cpRockTop?.(p[0], p[1]); if (r != null && isFinite(r)) G = Math.max(G, r); } catch { /* not in */ } }
    const parts = buildLadies(group, G);
    try { COLLIDERS.addBox('kit31', { x: lx, y: G + 0.25, z: lz, hw: 3.4, hh: 0.25, hd: 1.9, rotY: Math.atan2(LADIES.P[1][1] - LADIES.P[0][1], LADIES.P[1][0] - LADIES.P[0][0]), deck: true }); } catch { /* colliders not loaded */ }
    console.log(`[cp32m] the Ladies' Pavilion built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  }
  const [dx, dz] = DELA.C;
  if (owns(ctx.ox, ctx.oz, dx, dz)) {
    const G = ctx.padYNear(dx, dz), parts = buildDelacorte(group, G);
    console.log(`[cp32m] the Delacorte Theater built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  }
  // the Carousel (1951, red brick, OSM way 585788256, 8.2 m) and the Chess and Checkers House (1952, OSM way 265347597,
  // 6.1 m): octagons on their OSM rings
  const OCT = [
    ['carousel', [[-336.09, 1472.89], [-345.65, 1473.24], [-351.96, 1467.41], [-352.34, 1457.85], [-346.45, 1451.52], [-336.89, 1451.16], [-330.59, 1457.0], [-330.21, 1466.55]],
      { wall: 4.6, rise: 3.4, eave: 0.9, open: 4.2, openH: 3.6, sill: 0.25, lantern: 1.3, wallCol: KC(0x8e4a3a), trimCol: KC(0xe2dccd), roofCol: KC(0x565b60) }],
    ['chess', [[-287.3, 1559.75], [-291.97, 1559.45], [-295.07, 1555.94], [-294.78, 1551.26], [-291.26, 1548.18], [-286.59, 1548.48], [-283.49, 1551.99], [-283.78, 1556.66]],
      { wall: 3.6, rise: 2.4, eave: 0.7, open: 2.4, openH: 2.3, sill: 0.3, lantern: 0.6, wallCol: KC(0x8a5a48), trimCol: KC(0xd8d0c0), roofCol: KC(0x5a5e62) }],
  ];
  for (const [nm, ring, o] of OCT) {
    const cx = ring.reduce((a, p) => a + p[0], 0) / 8, cz = ring.reduce((a, p) => a + p[1], 0) / 8;
    if (!owns(ctx.ox, ctx.oz, cx, cz)) continue;
    let G = 1e9; for (const p of ring) G = Math.min(G, ctx.padYNear(p[0], p[1]));
    const parts = buildOctagon(group, nm, ring, G, o);
    console.log(`[cp32m] ${nm} built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  }
  { const [ox0, oz0] = DAIRY.O, [ax, az] = DAIRY.A, u = 4, w = -11, x = ox0 + ax * u - az * w, z = oz0 + az * u + ax * w;
    if (owns(ctx.ox, ctx.oz, x, z)) { const G = ctx.padYNear(x, z), parts = buildDairy(group, G); console.log(`[cp32m] the Dairy built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`); } }
  { const [ox0, oz0] = SWEDISH.O, [ax, az] = SWEDISH.A, u = 10, w = 6, x = ox0 + ax * u - az * w, z = oz0 + az * u + ax * w;
    if (owns(ctx.ox, ctx.oz, x, z)) { const G = ctx.padYNear(x, z), parts = buildSwedish(group, G); console.log(`[cp32m] the Swedish Cottage built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`); } }
  { const cxr = RINK.reduce((a, p) => a + p[0], 0) / RINK.length, czr = RINK.reduce((a, p) => a + p[1], 0) / RINK.length;
    if (owns(ctx.ox, ctx.oz, cxr, czr)) { const t = buildRinkBoards(group, (x, z) => ctx.padYNear(x, z)); console.log(`[cp32m] Wollman Rink's boards: ${t} triangles`); } }
  const [gx, gz] = at(SGATE.P);
  if (owns(ctx.ox, ctx.oz, gx, gz)) {
    let G = 1e9; for (const p of SGATE.P) G = Math.min(G, ctx.padYNear(p[0], p[1]));
    const parts = buildGatehouse(group, G, SGATE.P, 11.1);
    console.log(`[cp32m] the South Gate House built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  }
  // the North Gate House (1862-64; OSM way 278363027, 8.1 m): its main block (the 22.3 x 12.4 m rectangle of the outline)
  const NGATE = [[815.01, -641.87], [836.31, -648.61], [840.06, -636.84], [818.73, -630.19]];
  const [nx, nz] = at(NGATE);
  if (owns(ctx.ox, ctx.oz, nx, nz)) {
    let G = 1e9; for (const p of NGATE) G = Math.min(G, ctx.padYNear(p[0], p[1]));
    const parts = buildGatehouse(group, G, NGATE, 8.1);
    console.log(`[cp32m] the North Gate House built at ${G.toFixed(2)}: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
  }
}

// ---- Balcony Bridge -----------------------------------------------------------------------------------------------
// the deck's level at the bridge's two ends along the drive: the flat compile's asphalt (3.38) plus the relief the lead
// holds along bridge ways (cpRelief.js cpBridgeRelief), else the compiled asphalt a step past the water; none: not built
let BALCL = null;
function balcLevels(sectY) {
  const [cx, cz] = BALC.C, [ax, az] = BALC.A, out = [];
  for (const sg of [-1, 1]) {
    const u = sg * BALC.HU, x = cx + ax * u, z = cz + az * u;
    let y = null;
    try { const r = HA_P1 && CPD_ON ? cpDriveH(x, z) : null; if (r != null && isFinite(r)) y = 3.38 + r; } catch { /* not in yet */ }   // (TERRAIN INT2: the drive's profile)
    if (y === null) try { const r = RELIEF.cpBridgeRelief?.(x, z); if (r != null && isFinite(r)) y = 3.38 + r; } catch { /* not in yet */ }
    if (y === null) for (const d of [1.5, 3, 5]) { const uu = u + sg * d, yy = sectY(cx + ax * uu, cz + az * uu); if (yy !== null) { y = yy; break; } }
    if (y === null) return null;
    out.push(y);
  }
  return { W: waterY('lake', 16.6, cx, cz), yA: out[0], yB: out[1] };
}
function balcApply(tile, ox, oz) {
  const [cx, cz] = BALC.C, [ax, az] = BALC.A;
  if (!owns(ox, oz, cx, cz)) return;
  const L = balcLevels((x, z) => secY(tile, ox, oz, ['asphalt'], x, z));
  if (!L) return;
  BALCL = L;
  // the walkers' strips under both walks over the neck
  const strip = [], HU = BALC.HU, yd = (u) => L.yA + (L.yB - L.yA) * (u + HU) / (2 * HU);
  const pt = (u, w) => { const x = cx + ax * u - az * w, z = cz + az * u + ax * w; return [x - ox, yd(u) + 0.15 - 0.25, z - oz]; };
  for (const s of [-1, 1]) for (let u = -HU; u < HU - 1e-6; u += 1.0) {
    const u1 = Math.min(HU, u + 1.0), w0 = s * 5.4, w1 = s * 6.9;
    const A = pt(u, w0), B = pt(u1, w0), C = pt(u1, w1), D = pt(u, w1);
    if (s > 0) strip.push(...A, ...C, ...B, ...A, ...D, ...C); else strip.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  const p = tile.S.sidewalk, merged = new Float32Array((p ? p.length : 0) + strip.length);
  if (p) merged.set(p, 0);
  merged.set(strip, p ? p.length : 0);
  tile.S.sidewalk = merged;
  console.log(`[cp32m] Balcony Bridge: the deck ${L.yA.toFixed(2)} / ${L.yB.toFixed(2)} over the Lake at ${L.W.toFixed(2)}`);
}
let _balcColl = false;
function balcBuild(group, ctx) {
  const [cx, cz] = BALC.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  const L = BALCL || balcLevels((x, z) => ctx.sectionY('asphalt', x, z, 0.5));
  if (!L) { console.log('[cp32m] Balcony Bridge: no deck level (the relief along the drive is not in), not built'); return; }
  if (L.yA - L.W < 3 || L.yB - L.W < 3) { console.log(`[cp32m] Balcony Bridge: the drive only ${(Math.min(L.yA, L.yB) - L.W).toFixed(2)} m over the water, not built`); return; }
  const parts = CPB33 ? buildBalconyB(group, L.W, L.yA, L.yB) : buildBalcony(group, L.W, L.yA, L.yB);
  if (!_balcColl) {
    _balcColl = true;
    try {
      const [ax, az] = BALC.A, rot = Math.atan2(az, ax), yM = (L.yA + L.yB) / 2;
      COLLIDERS.addBox('kit31', { x: cx, y: yM - 0.3, z: cz, hw: BALC.HU, hh: 0.3, hd: BALC.HW - 0.4, rotY: rot, deck: true });
      for (const s of [-1, 1]) COLLIDERS.addBox('kit31', { x: cx - az * s * (BALC.HW - 0.2), y: yM + 0.6, z: cz + ax * s * (BALC.HW - 0.2), hw: BALC.HU, hh: 0.6, hd: 0.25, rotY: rot });
    } catch (e) { console.warn('[cp32m] balcony colliders', e); }
  }
  console.log(`[cp32m] Balcony Bridge built: ${parts.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// ---- the stone arches ---------------------------------------------------------------------------------------------
// tools/cp/lm_arches.mjs over the OSM man_made=bridge outlines (OpenStreetMap contributors, ODbL): [way, name, material,
// cx, cz, ax, az (the upper way), u0, u1, w0, w1]. Built only where the lead's deck hold (cpRelief.js cpBridgeRelief) keeps
// the way 2 m or more over the ground; the deck there is the flat compile's asphalt (3.38) plus that relief.
const ARCHES = [[385446613, 'Greyshot Arch', '', -729.43, 1539.75, -0.33, 0.94, -11.02, 9.26, -8.63, 11.2],
  [385446619, 'Dalehead Arch', '', -619.42, 1374.83, 0.69, -0.73, -13.08, 11.28, -15.95, 12.42],
  [385460484, 'Willowdell Arch', 'brick', -8.03, 1440.11, 0.49, -0.87, -15.48, 18.08, -6.79, 8.28],
  [385460490, 'Denesmouth Arch', '', 15.07, 1634.62, 0.82, 0.57, -20.62, 15.67, -4.71, 6],
  [385461446, 'Green Gap Arch', '', -171.91, 1684.09, 0.02, 1, -17.65, 15.28, -15.37, 11.02],
  [387351393, 'Springbanks Arch', 'stone', 1104.27, -1173.33, 0.95, 0.3, -3.77, 3.47, -11.62, 9.76],
  [387386578, 'Glen Span Arch', 'stone', 1014.85, -1287.09, -0.31, 0.95, -11.62, 12.93, -4.87, 6.06],
  [388243124, '110th Street Bridge', '', 1123.53, -1872.79, 0.28, 0.96, -12.75, 12.74, -6.49, 8.48],
  [388310491, 'Winterdale Arch', '', 150.22, 137.47, 0.08, 1, -10.32, 12.89, -7.41, 8.28],
  [760514886, 'Eaglevale Bridge', 'stone', -173.85, 428.63, 0.61, 0.8, -18.13, 24.1, -8.03, 5.95],
  [1120999154, 'Trefoil Arch', '', 194.24, 952.34, 0.58, -0.82, -5.8, 5.24, -12.5, 9.7],
  [1121218991, 'Huddlestone Arch', '', 1311.79, -1412.38, -0.37, -0.93, -5.78, 5.15, -11.61, 4.59],
  [1384098872, '', '', 1408.97, -1443.47, -0.85, 0.53, -29.99, 36.35, -2.79, 3.86],
  [1384098888, '', '', 1424.3, -1537.13, 0.43, 0.9, -7.89, 6.85, -2.91, 2.63],
  [1384126014, '', '', 1577.05, -1536.42, -0.98, -0.18, -32.23, 34.2, -9.55, 8.62]];
function archesBuild(group, ctx) {
  const M = lmMats();
  const deckAt = (x, z) => { try { const r = RELIEF.cpBridgeRelief?.(x, z); return r != null && isFinite(r) ? 3.38 + r - 0.02 : null; } catch { return null; } };
  // (TERRAIN INT2: on the region's ground the walls stand on the authority's bare earth, not the flat compile's grid)
  const groundAt = (x, z) => { if (HA_P1) { const g = haBaseAt(x, z); if (g !== null) return g + 0.12; } return ctx.sampleT(x, z) + 0.27; };
  let n = 0, tris = 0;
  for (const A of ARCHES) {
    const [, name, , cx, cz, ax, az] = A;
    if (!owns(ctx.ox, ctx.oz, cx, cz)) continue;
    // (TERRAIN INT2: an arch under a drive: its faces and parapets at the drive's outer edges, its deck the drive's profile)
    const DA = HA_P1 ? cpDriveArch(A) : null, AA = DA ? DA.A : A, dkAt = DA ? DA.deckAt : deckAt;
    if (CPB33) {                                              // CPB33: the modelled arch near, the CP32 one far (cpBridges.js buildArchB)
      const t = buildArchB(group, AA, dkAt, groundAt);
      if (t) { n++; tris += t; if (name) console.log(`[cp32m] ${name} built (CPB33)`); }
      continue;
    }
    const B = new LBin().frame(cx, 0, cz, ax, az), SN = new LBin().frame(cx, 0, cz, ax, az), DK = new LBin().frame(cx, 0, cz, ax, az);
    const t = buildArch(B, SN, DK, AA, dkAt, groundAt);
    if (!t) continue;
    for (const [b, m, nm] of [[B, M.schist, 'walls'], [SN, M.stone, 'dressings'], [DK, M.rock, 'soffit']]) { const mesh = b.mesh(m, 'cp32m:arch:' + nm); if (mesh) group.add(mesh); }
    n++; tris += B.tris + SN.tris + DK.tris;
    if (name) console.log(`[cp32m] ${name} built`);
  }
  if (n) console.log(`[cp32m] tile ${ctx.key}: ${n} arches (${tris} triangles)`);
}

// ---- Cleopatra's Needle -------------------------------------------------------------------------------------------
let _needleColl = false;
function needleBuild(group, ctx) {
  const [cx, cz] = NEEDLE.C;
  if (!owns(ctx.ox, ctx.oz, cx, cz)) return;
  const [ax, az] = NEEDLE.A;
  let G = 1e9;
  for (const [du, dw] of [[4.4, 4.4], [4.4, -4.4], [-4.4, 4.4], [-4.4, -4.4], [0, 0]]) G = Math.min(G, ctx.padYNear(cx + ax * du - az * dw, cz + az * du + ax * dw));
  const r = buildNeedle(group, G);
  if (!_needleColl) { _needleColl = true; try { COLLIDERS.addBox('kit31', { x: cx, y: G + 1.5, z: cz, hw: 4.2, hh: 1.5, hd: 4.2, rotY: Math.atan2(az, ax) }); } catch { /* colliders not loaded */ } }
  console.log(`[cp32m] Cleopatra's Needle built on the knoll at ${G.toFixed(2)}, its tip at ${r.top.toFixed(2)}: ${r.out.map(([n, t]) => `${n} ${t}`).join(', ')}`);
}

// the compiled footprints this part builds itself: [x, z] centroids (tools/cp/lm_bldgs.mjs), 4 m tolerance
const SKIP = [[210.3, 861.4],    // the Loeb Boathouse (OSM relation 3698871, 7.3 m)
  [186.9, 412.6],                // Belvedere Castle (OSM way 278363023, 7.8 m)
  [15.6, 1158.3],                // the Naumburg Bandshell (OSM way 265347581, 12.8 m)
  [735.0, 96.4],                 // the South Gate House (OSM way 278363043, 11.1 m)
  [829.0, -634.9],               // the North Gate House (OSM way 278363027, 8.1 m)
  [-147.1, 603.3],               // the Ladies' Pavilion (OSM way 221918229, 4.4 m)
  [201.3, 316.0],                // the Delacorte Theater (OSM way 278363024: a solid 5.1 m drum where the seats are open)
  [-341.5, 1462.2], [-288.8, 1554.4], [-212.2, 1557.1],    // the Carousel, the Chess and Checkers House, the Dairy
  [71.2, 347.5]];                // the Swedish Cottage (OSM way 278363049, 8.1 m)
export function skipBuilding(cx, cz) {
  if (!CP32M) return false;
  for (const [x, z] of SKIP) if (Math.abs(cx - x) < 4 && Math.abs(cz - z) < 4) return true;
  return false;
}

// ---- the hooks ----------------------------------------------------------------------------------------------------
// Wollman Rink's surface: the lawn inside its outline re-kinded to the paved plaza (the convex clipper of tsqPlaza.js)
function rinkApply(tile, ox, oz) {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (const [x, z] of RINK) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  if (x1 < ox || x0 > ox + TILE || z1 < oz || z0 > oz + TILE) return;
  // the outline's convex hull (the clipper takes convex regions; the rink's 36 points have small dents)
  const hull = (() => { const P = RINK.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (const p of P.slice().reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1)); })();
  const R = { ped: [mkConvex(hull)], car: [] }, plaza = [];
  const fan = (poly, out) => { for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) out.push(p[0] - ox, p[1], p[2] - oz); };
  for (const name of ['grass', 'grassU']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    let changed = false;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const X0 = a[i] + ox, Z0 = a[i + 2] + oz, X1 = a[i + 3] + ox, Z1 = a[i + 5] + oz, X2 = a[i + 6] + ox, Z2 = a[i + 8] + oz;
      if (Math.max(X0, X1, X2) < x0 || Math.min(X0, X1, X2) > x1 || Math.max(Z0, Z1, Z2) < z0 || Math.min(Z0, Z1, Z2) > z1) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      const S = tpSplit([[X0, a[i + 1], Z0], [X1, a[i + 4], Z1], [X2, a[i + 7], Z2]], R);
      if (!S.plaza.length) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      changed = true;
      for (const p of S.road) fan(p, out);
      for (const p of S.plaza) fan(p, plaza);
    }
    if (changed) tile.S[name] = Float32Array.from(out);
  }
  if (!plaza.length) return;
  // the park's own dark paving (the drives' and paths' asphalt), not the city's pale plaza flags (the v1 stills: a white
  // sheet from Central Park South)
  const p = tile.S.path, merged = new Float32Array((p ? p.length : 0) + plaza.length);
  if (p) merged.set(p, 0);
  merged.set(plaza, p ? p.length : 0);
  tile.S.path = merged;
  console.log(`[cp32m] Wollman Rink: ${plaza.length / 9} lawn triangles re-kinded to its paved surface`);
}
export function apply(tile, ox, oz) {
  if (!CP32M) return;
  try { rinkApply(tile, ox, oz); } catch (e) { console.warn('[cp32m] Wollman Rink apply', e); }
  try { bowApply(tile, ox, oz); } catch (e) { console.warn('[cp32m] Bow Bridge apply', e); }
  try { gapApply(tile, ox, oz); } catch (e) { console.warn('[cp32m] Gapstow apply', e); }
  try { oakApply(tile, ox, oz); } catch (e) { console.warn('[cp32m] Oak Bridge apply', e); }
  try { balcApply(tile, ox, oz); } catch (e) { console.warn('[cp32m] Balcony Bridge apply', e); }
}
// sim/peds.js may cut its path runs here: Belvedere's plateau and the 8 m ring of Vista Rock this part builds round it
// (the terrace stands 6.4 m over the 3DEP ground, so a path line at the relief's height runs inside the rock)
export function cpLmKeepOut(x, z) {
  if (!CP32M) return false;
  const [bx0, bz0] = BELV.O, [bx, bz] = BELV.A, ex = x - bx0, ez = z - bz0, u = ex * bx + ez * bz, w = -ex * bz + ez * bx, [pu0, pu1, pw0, pw1] = BELV.PLAT;
  return (u > pu0 - 8 && u < pu1 + 8 && w > pw0 - 8 && w < pw1 + 8) || (CPC33 && castleKeepOut(x, z));
}
// a compiled tree, lamp or bench standing on a structure's footprint
export function dropFurniture(wx, wz, f) {
  if (!CP32M) return false;
  const [cx, cz] = BOW.C, [ax, az] = BOW.A, dx = wx - cx, dz = wz - cz;
  if (Math.abs(dx * ax + dz * az) < BOW.END + 3 && Math.abs(-dx * az + dz * ax) < BOW.HALF + 2.5) return true;
  { const [gx, gz] = GAP.C, [bx, bz] = GAP.A, ex = wx - gx, ez = wz - gz;
    if (Math.abs(ex * bx + ez * bz) < GAP.HALF + GAP.RAMP + 2 && Math.abs(-ex * bz + ez * bx) < GAP.W2 + 2) return true; }
  { const [bx0, bz0] = BELV.O, [bx, bz] = BELV.A, ex = wx - bx0, ez = wz - bz0, u = ex * bx + ez * bz, w = -ex * bz + ez * bx, [pu0, pu1, pw0, pw1] = BELV.PLAT;
    if (u > pu0 - 1 && u < pu1 + 1 && w > pw0 - 1 && w < pw1 + 1) return true; }
  if (CPC33 && castleDrop(wx, wz)) return true;
  { const F = oakFrame(), [ox2, oz2] = F.C, [bx, bz] = F.A, ex = wx - ox2, ez = wz - oz2;
    if (Math.abs(ex * bx + ez * bz) < F.L / 2 + 2 && Math.abs(-ex * bz + ez * bx) < OAK.W2 + 1.5) return true; }
  return false;
}
export function build(group, ctx) {
  if (!CP32M) return;
  const i0 = group.children.length;
  try { bowBuild(group, ctx); } catch (e) { console.warn('[cp32m] Bow Bridge', e); }
  try { boatsBuild(group, ctx); } catch (e) { console.warn('[cp32m] rowboats', e); }
  try { boathouseBuild(group, ctx); } catch (e) { console.warn('[cp32m] Boathouse', e); }
  try { belvedereBuild(group, ctx); } catch (e) { console.warn('[cp32m] Belvedere', e); }
  try { gapBuild(group, ctx); } catch (e) { console.warn('[cp32m] Gapstow', e); }
  try { needleBuild(group, ctx); } catch (e) { console.warn('[cp32m] Needle', e); }
  try { oakBuild(group, ctx); } catch (e) { console.warn('[cp32m] Oak Bridge', e); }
  try { mallBuild(group, ctx); } catch (e) { console.warn('[cp32m] the Mall', e); }
  try { smallBuild(group, ctx); } catch (e) { console.warn('[cp32m] pavilion, gate house', e); }
  try { balcBuild(group, ctx); } catch (e) { console.warn('[cp32m] Balcony Bridge', e); }
  try { archesBuild(group, ctx); } catch (e) { console.warn('[cp32m] arches', e); }
  try { const r = mergeByMaterial(group, i0); if (r.from) console.log(`[cp32m] tile ${ctx.key}: ${r.from} meshes merged into ${r.meshes} (one per material)`); } catch (e) { console.warn('[cp32m] merge', e); }
}
// seats for the seated people (sim/peds.js SW31, the records of bryantPark.js bpSeats): the granite benches on
// Belvedere's terrace facing Turtle Pond, the bench on the Bow Bridge landing
export function seats() {
  if (!CP32M) return [];
  const out = [];
  { const [ox, oz] = BELV.O, [ax, az] = BELV.A, [cx, cz] = BELV.C, B = cpReliefReady() ? cpDemToWorld(39.6, cx, cz) : CP_DATUM + 6.0;
    const w = CPC33 ? CASTLE_BENCH.w : BELV.PLAT[2] + 1.0, fx = az, fz = -ax;           // facing -w: over the parapet toward the pond
    (CPC33 ? CASTLE_BENCH.u : BELV.BENCH).forEach((u, g) => { for (const du of [-0.55, 0, 0.55]) out.push({ x: ox + ax * (u + du) - az * w, y: B, z: oz + az * (u + du) + ax * w, yaw: Math.atan2(fx, fz), seat: 0.46, kind: 'bench', group: 9100 + g }); }); }
  { const [lx, lz] = LANDING.P, W = waterY('lake', 17.0, lx, lz + 4), y = W + 0.9;
    for (const u of [1.45, 2.2, 2.95]) out.push({ x: lx - 1.65, y, z: lz + u, yaw: Math.PI / 2, seat: 0.48, kind: 'bench', group: 9200 }); }
  return out;
}
export function promenades() {
  if (!CP32M) return [];
  const L = BOWL || { W: CP_DATUM - 1.0, gS: CP_DATUM, gN: CP_DATUM };
  const out = [{ pts: bowPromenade(L.W, L.gS, L.gN), busy: 4 }];
  { const [cx, cz] = GAP.C, [ax, az] = GAP.A, E = GAP.HALF + GAP.RAMP + 4, pts = [];
    for (let u = -E; u <= E + 1e-6; u += 1.5) pts.push([cx + ax * u, 0, cz + az * u]);
    out.push({ pts, busy: 3 }); }
  { const [cx, cz] = BALC.C, [ax, az] = BALC.A, E = BALC.HU + 4;
    for (const s of [-1, 1]) { const pts = []; for (let u = -E; u <= E + 1e-6; u += 1.5) pts.push([cx + ax * u - az * s * 6.1, 0, cz + az * u + ax * s * 6.1]); out.push({ pts, busy: 2 }); } }
  { const F = oakFrame(), [cx, cz] = F.C, [ax, az] = F.A, E = F.L / 2 + 4, pts = [];
    for (let u = -E; u <= E + 1e-6; u += 1.5) pts.push([cx + ax * u, 0, cz + az * u]);
    out.push({ pts, busy: 2 }); }
  return out;
}
// ==== R1D (CORE, docs/notes/arch-r1-d.md): the Lake's boat courses and water level, shared with the headless core
// (tools/core/tracks_to_boats.mjs builds the fleet with lsBuildFleet from these, as boatsBuild does)
export const R1D_LAKE = { COURSES, waterY };
// ==== R1D end
