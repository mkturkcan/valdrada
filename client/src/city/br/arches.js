// The arch bridges: steel deck arches (the Henry Hudson, the Alexander Hamilton, the Washington Bridge's twin arches, the
// High Bridge's river span) and a through arch (the Bayonne), from each bridge's spec and the record's layout
// (tools/pipeline/bridges.mjs layoutArch: the arch's springings, the roadway's level).
// A deck arch: two to six ribs under the deck springing from skewbacks low on the banks, the deck carried on spandrel
// columns from the ribs, cross bracing between the ribs; masonry or steel approach spans on piers beyond the springings.
// A through arch: two trussed ribs rising over the deck, the deck hung from them, the ribs' ends on abutments.
import { Frame } from './frame.js';
import * as M from './mats.js';
import { slab, laneLines, crossBeams, lateralX, railing, block, taper, memberSO } from './parts.js';
import { layoutBays, viaduct, abutWall, pier as stonePier } from './masonry.js';

function road(bag, F, asph, lw, ly, steelD, a, b, half, y, lanes) {
  slab(bag, F, asph, a, b, -half, half, y, 0.3, 6);
  const lw0 = half / lanes, lines = [{ o: -0.12, w: 0.11, yellow: true }, { o: 0.12, w: 0.11, yellow: true }, { o: -half + 0.3, w: 0.12 }, { o: half - 0.3, w: 0.12 }];
  for (let k = 1; k < lanes; k++) lines.push({ o: -half + k * lw0, w: 0.11, dash: [3.05, 9.15] }, { o: half - k * lw0, w: 0.11, dash: [3.05, 9.15] });
  laneLines(bag, F, lw, ly, a, b, y, lines);
  for (const sg of [-1, 1]) railing(bag, F, steelD, a, b, sg * (half + 0.15), y, 1.1, 2.4, 0.08);
}

// ribs: S.ribs offsets across; the arch from springing s0 to s1 (the record's layout), springing height ys, crown yc
export function buildDeckArch(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), stone = M.ashlar(S.stone ?? 0xa29b8e, 1.4), stoneD = M.ashlar(S.stoneD ?? 0x8a8378, 1.4, { style: 'dressed' });
  const asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow(), conc = M.concrete(), lamp = M.glow(0xffe0a8, 2.0);
  const y = (s) => F.yAt(s), half = S.width / 2;
  const deckBot = (s) => y(s) - (S.deckDepth ?? 2.2);
  for (const [s0, s1] of lay.arches) {
    const sm = (s0 + s1) / 2, h = (s1 - s0) / 2;
    const ys = S.springY ?? 6, yc = Math.min(S.crownY ?? 1e9, deckBot(sm) - (S.crownGap ?? 1.5));
    const arch = (s) => { const u = (s - sm) / h; return ys + (yc - ys) * (1 - u * u); };
    const N = Math.max(12, Math.round((s1 - s0) / 9)), Sx = (i) => s0 + ((s1 - s0) * i) / N;
    for (const o of S.ribs) {
      for (let i = 0; i < N; i++) {
        const p = Sx(i), q = Sx(i + 1);
        memberSO(bag, F, steel, p, o, arch(p), q, o, arch(q), S.ribW ?? 1.2, S.ribD ?? 2.6);
        // the spandrel columns at the panel points, carrying the deck girders
        if (deckBot(p) - arch(p) > 1.6) memberSO(bag, F, steel, p, o, arch(p) + 1.0, p, o, deckBot(p), 0.7, 0.7);
        if (!bag.lod && deckBot(p) - arch(p) > 6) memberSO(bag, F, steelD, p, o, arch(p) + 1.0, q, o, deckBot(q) - 0.3, 0.35, 0.4);
      }
    }
    // cross bracing between the ribs (an X per panel, under the arch's top) and struts at the panel points
    for (let k = 0; k + 1 < S.ribs.length; k++) {
      const oa = S.ribs[k], ob = S.ribs[k + 1];
      for (let i = 0; i <= N; i++) memberSO(bag, F, steelD, Sx(i), oa, arch(Sx(i)), Sx(i), ob, arch(Sx(i)), 0.45, 0.5);
      if (!bag.lod) for (let i = 0; i < N; i++) { const p = Sx(i), q = Sx(i + 1); memberSO(bag, F, steelD, p, oa, arch(p), q, ob, arch(q), 0.3, 0.3); memberSO(bag, F, steelD, p, ob, arch(p), q, oa, arch(q), 0.3, 0.3); }
    }
    // the skewbacks: masonry blocks under the ribs' ends
    for (const s of [s0, s1]) {
      const g = F.groundAt(s), base = g === null ? -3 : g - 0.5;
      block(bag, F, S.viaduct ? M.graniteN() : stoneD, s - 5, s + 5, S.ribs[0] - 3, S.ribs[S.ribs.length - 1] + 3, base, ys + 1.5);
    }
  }
  // HB25 (S.viaduct): the masonry arches beside the steel spans (br/masonry.js): laid out from the steel span's end piers
  // outward at the bridge's spans, a solid abutment wall past the last arch where the deck nears the ground, plain bents
  // where the arches cannot stand (a street or highway in the way of every pier); the steel deck only where no masonry is
  const a = 0, b = F.L;
  let girderRuns = [[a, b]];
  if (S.viaduct) girderRuns = masonryApproaches(rec, bag, F, S, y);
  // the deck: plate girders under the roadway, the floor, the road (a walkway's paving), lights
  for (const [ga, gb] of girderRuns) {
    for (const o of S.ribs) slab(bag, F, steel, ga, gb, o - 0.3, o + 0.3, (s) => y(s) - 0.3, (S.deckDepth ?? 2.2) - 0.3, 8, { top: false });
    crossBeams(bag, F, steelD, ga, gb, 5.0, -half, half, (s) => y(s) - 0.3, 0.35, 1.0);
  }
  if (S.walk) {
    const pave = M.paving(S.paveHex ?? 0x9a6a58);
    slab(bag, F, pave, a, b, -half, half, y, 0.3, 6);
    for (const [ga, gb] of girderRuns) for (const sg of [-1, 1]) railing(bag, F, steelD, ga, gb, sg * (half + 0.1), y, 1.25, 2.4, 0.07);
  } else road(bag, F, asph, lw, ly, steelD, a, b, half, y, S.lanes ?? 2);
  if (S.upper) {   // a second roadway over the first (the Henry Hudson's upper level)
    const yu = (s) => y(s) + S.upper;
    road(bag, F, asph, lw, ly, steelD, a, b, half, yu, S.lanes ?? 2);
    for (const s of F.range(a, b, 10)) for (const o of [-half + 0.4, half - 0.4]) memberSO(bag, F, steel, s, o, y(s) + 0.1, s, o, yu(s) - 0.6, 0.5, 0.5);
    crossBeams(bag, F, steelD, a, b, 5.0, -half, half, (s) => yu(s) - 0.3, 0.35, 0.9);
  }
  if (!bag.lod) for (let s = a + 15; s < b - 5; s += 30) for (const sg of [-1, 1]) { const p = F.P(s, sg * (half + 0.15), y(s) + (S.upper ?? 0)); bag.rod(steelD, p, [p[0], p[1] + 7, p[2]], 0.08, 6, 0.06, true); bag.rod(lamp, [p[0], p[1] + 7, p[2]], [p[0], p[1] + 7.25, p[2]], 0.22, 8, 0.22, true); }
  // the approach piers beyond the arches: masonry arches (S.masonry) or steel bents, kept out of the streets
  const spans = lay.arches.map(([s0, s1]) => [s0 - 3, s1 + 3]);
  const inArch = (s) => spans.some(([p, q]) => s > p && s < q);
  const under = (rec.under || []).filter((u) => u[2] < 0.5);
  const free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  const inMasonry = (s) => S.viaduct && !girderRuns.some(([p, q]) => s >= p && s <= q);
  for (let s = 8; s < F.L - 4; s += S.bay ?? 24) {
    if (inArch(s) || !free(s) || inMasonry(s)) continue;
    const g = F.groundAt(s), base = g === null ? -3 : g - 0.5, top = y(s) - (S.deckDepth ?? 2.2);
    if (top - base < 2.5) continue;
    if (S.masonry) taper(bag, F, S.viaduct ? M.graniteN() : stone, s, 0, base, top, 2.6, half + 1.2, 2.2, half + 0.8);
    else { for (const o of S.ribs.length > 1 ? [S.ribs[0], S.ribs[S.ribs.length - 1]] : [-half + 1, half - 1]) taper(bag, F, steel, s, o, base, top, 0.6, 0.5, 0.5, 0.4); memberSO(bag, F, steelD, s, -half, top - 0.5, s, half, top - 0.5, 0.8, 1.0); }
  }
  void conc;
}

// HB25: the masonry approaches of a deck arch (S.viaduct: { spans, nMain, pier, half, cover, ch, endT, wallHex, trimHex,
// ringHex, max }); returns the runs left to the steel deck (the steel spans and any run of plain bents)
function masonryApproaches(rec, bag, F, S, y) {
  const V = S.viaduct, lay = rec.layout, yTop = (s) => y(s) - 0.35;
  const G = M.graniteN();
  const Mm = { wall: G, ring: G, vault: G, pier: G, trim: G, rail: M.paint(S.steelD ?? S.steel) };
  const ground = (s) => { const g = F.groundAt(s); return g === null ? -2.5 : g; };
  const archs = lay.arches.slice().sort((p, q) => p[0] - q[0]);
  const e0 = archs[0][0] - V.endT / 2 - 1, e1 = archs[archs.length - 1][1] + V.endT / 2 + 1;
  const spec = { ...V, walk: !!S.walk, under: rec.under || [] };
  const runs = [[e0 - V.endT / 2, e1 + V.endT / 2]];
  // the end piers the steel arch springs beside (and the piers between two steel arches), ground to the cornice
  const tall = [e0, e1];
  for (let i = 0; i + 1 < archs.length; i++) tall.push((archs[i][1] + archs[i + 1][0]) / 2);
  for (const s of tall) {
    const g = Math.min(ground(s - V.endT / 2), ground(s), ground(s + V.endT / 2)) - 1.0;
    stonePier(bag, F, Mm.pier, s, g, yTop(s) - 0.9, V.endT / 2, V.half + 0.4, 0.01, (V.ch ?? 0.62) * 1.4);
    block(bag, F, Mm.trim, s - V.endT / 2 - 0.2, s + V.endT / 2 + 0.2, -V.half - 0.6, V.half + 0.6, yTop(s) - 0.9, yTop(s) - 0.35);
    for (const sg of [-1, 1]) block(bag, F, Mm.wall, s - V.endT / 2, s + V.endT / 2, sg > 0 ? V.half - 0.3 : -V.half - 0.1, sg > 0 ? V.half + 0.1 : -V.half + 0.3, yTop(s) - 0.35, y(s) + (V.parapet ?? 1.0) + 0.3);
  }
  for (const [sStart, dir] of [[e0, -1], [e1, 1]]) {
    const { piers, end } = layoutBays(F, rec, V, sStart, dir, yTop);
    if (piers.length >= 2) viaduct(bag, F, Mm, piers, y, spec);
    // past the last arch: plain bents while the deck is still too high for a wall, then the abutment wall to the bank
    let s = end + dir * (V.pier / 2), sW = s;
    while (sW > 1 && sW < F.L - 1 && y(sW) - ground(sW) > (V.wallMax ?? 16)) sW += dir * 2;
    const lo = Math.min(s, sW), hi = Math.max(s, sW);
    if (hi - lo > 2) runs.push([lo, hi]);
    let sE = sW;
    while (sE > 0.5 && sE < F.L - 0.5 && y(sE) - ground(sE) > 0.6) sE += dir * 2;
    abutWall(bag, F, Mm, Math.min(sW, sE), Math.max(sW, sE), y, spec);
  }
  return runs;
}

// a through arch (the Bayonne Bridge): two trussed ribs rising over the deck from abutments at the shores, the deck hung
// from them by hangers, struts and X bracing between the ribs over the roadway's clearance
export function buildThroughArch(rec, bag, S) {
  const F = new Frame(rec), lay = rec.layout;
  const steel = M.paint(S.steel), steelD = M.paint(S.steelD ?? S.steel), conc = M.concrete(), asph = M.asphalt(), lw = M.lineWhite(), ly = M.lineYellow();
  const hang = M.cable(S.steelD ?? S.steel, { px: 0.00008 }), y = (s) => F.yAt(s), half = S.width / 2;
  const [s0, s1] = lay.arches[0], sm = (s0 + s1) / 2, h = (s1 - s0) / 2;
  const low = (s) => { const u = (s - sm) / h; return S.springY + (S.crownLow - S.springY) * (1 - u * u); };
  const high = (s) => { const u = (s - sm) / h; return S.springY + S.ribDepthEnd + (S.crownLow + S.ribDepthCrown - S.springY - S.ribDepthEnd) * (1 - u * u); };
  const N = Math.round((s1 - s0) / 12), Sx = (i) => s0 + ((s1 - s0) * i) / N;
  for (const sg of [-1, 1]) {
    const o = sg * S.ribO;
    for (let i = 0; i < N; i++) {
      const p = Sx(i), q = Sx(i + 1);
      memberSO(bag, F, steel, p, o, low(p), q, o, low(q), 1.5, 1.8);
      memberSO(bag, F, steel, p, o, high(p), q, o, high(q), 1.4, 1.6);
      memberSO(bag, F, steelD, p, o, low(p), p, o, high(p), 0.8, 0.8);
      if (!bag.lod) memberSO(bag, F, steelD, p, o, i % 2 ? low(p) : high(p), q, o, i % 2 ? high(q) : low(q), 0.6, 0.6);
      // the hangers where the rib runs over the deck
      if (low(p) > y(p) + 3) bag.rod(hang, F.P(p, o, y(p) - 0.5), F.P(p, o, low(p) - 0.8), 0.12, 6);
    }
    for (const s of [s0, s1]) { const g = F.groundAt(s), base = g === null ? -3 : g - 0.5; block(bag, F, conc, s - 8, s + 8, o - 6, o + 6, base, S.springY + 2); }
  }
  // struts and X bracing between the ribs above the deck's clearance
  for (let i = 0; i <= N; i++) { const p = Sx(i); if (low(p) > y(p) + 8) memberSO(bag, F, steelD, p, -S.ribO, high(p), p, S.ribO, high(p), 0.8, 1.0); }
  if (!bag.lod) for (let i = 0; i < N; i++) { const p = Sx(i), q = Sx(i + 1); if (low(p) > y(p) + 8 && low(q) > y(q) + 8) { memberSO(bag, F, steelD, p, -S.ribO, high(p), q, S.ribO, high(q), 0.4, 0.4); memberSO(bag, F, steelD, p, S.ribO, high(p), q, -S.ribO, high(q), 0.4, 0.4); } }
  // the deck: box girders, the floor, the roadway; its approach on concrete piers
  for (const o of [-half + 1, half - 1]) slab(bag, F, steel, 0, F.L, o - 0.5, o + 0.5, (s) => y(s) - 0.3, 3.0, 8, { top: false });
  crossBeams(bag, F, steelD, 0, F.L, 6, -half, half, (s) => y(s) - 0.3, 0.4, 1.2);
  road(bag, F, asph, lw, ly, steelD, 0, F.L, half, y, S.lanes ?? 2);
  const under = (rec.under || []).filter((u) => u[2] < 0.5), free = (s) => !under.some((u) => s > u[0] - 2 && s < u[1] + 2);
  for (let s = 10; s < F.L - 4; s += 40) {
    if (s > s0 - 4 && s < s1 + 4) continue;
    if (!free(s)) continue;
    const g = F.groundAt(s), base = g === null ? -3 : g - 0.5, top = y(s) - 3.3;
    if (top - base < 2.5) continue;
    for (const o of [-half / 2, half / 2]) taper(bag, F, conc, s, o, base, top, 1.4, 1.4, 1.1, 1.1);
    block(bag, F, conc, s - 1.5, s + 1.5, -half, half, top - 1.5, top);
  }
}

// ---------------------------------------------------------------- the specs (colours from photographs)
const deck = (o) => (rec, bag) => buildDeckArch(rec, bag, o);
export const buildHenryHudson = deck({ steel: 0x9aacb6, steelD: 0x7d8e98, width: 19.5, lanes: 2, ribs: [-7.5, 7.5], ribW: 1.6, ribD: 3.4, springY: 5, crownGap: 1.2, deckDepth: 2.4, upper: 7.6, bay: 30 });
export const buildHamilton = deck({ steel: 0x7d918a, steelD: 0x64776f, width: 28.0, lanes: 3, ribs: [-11, -3.7, 3.7, 11], ribW: 1.4, ribD: 3.0, springY: 4, crownGap: 1.0, deckDepth: 2.6, bay: 28 });
// the Washington Bridge (1888): two 510 ft (155 m) steel arches of six ribs on granite piers, granite approach arches
export const buildWashington = deck({ steel: 0x7c7f7d, steelD: 0x636664, width: 25.0, lanes: 3, ribs: [-11.5, -6.9, -2.3, 2.3, 6.9, 11.5], ribW: 1.0, ribD: 3.0, springY: 6, crownGap: 1.0, deckDepth: 2.2, masonry: true, bay: 20,
  viaduct: { spans: [18.3], pier: 3.8, endT: 9.0, half: 13.0, cover: 2.4, ch: 0.66, wallHex: 0x8d8981, trimHex: 0x9f9b92, ringHex: 0x96928a, vaultHex: 0x7e7a72, parapet: 1.1, max: 8 } });
// the High Bridge: the 1928 steel arch (450 ft, 137 m) over the river between the 1848 granite piers, the remaining masonry
// arches on the banks (80 ft spans by the river, 50 ft beyond; ten in all), a brick walkway between iron rails
export const buildHighBridge = deck({ steel: 0xb2b4ae, steelD: 0x8c8f8a, width: 7.0, lanes: 1, ribs: [-2.6, 2.6], ribW: 1.0, ribD: 2.6, springY: 6, crownGap: 0.8, deckDepth: 1.8, masonry: true, bay: 24,
  walk: true, paveHex: 0x8f6656,
  viaduct: { spans: [24.4, 15.2], nMain: 3, pier: 4.6, endT: 7.0, half: 4.3, cover: 2.0, ch: 0.62, wallHex: 0x8a8276, trimHex: 0x9c958a, ringHex: 0x938c80, vaultHex: 0x7a746a, parapet: 1.0, max: 10 } });
// the Bayonne Bridge (Othmar Ammann, 1931; the roadway raised 2019): a steel two-hinged through arch of 1,675 ft
// (510.5 m), its top 325 ft (99 m) over the Kill van Kull, two trussed ribs 74 ft apart, deeper at the skewbacks than at
// the crown; grey paint
export const buildBayonne = (rec, bag) => buildThroughArch(rec, bag, { steel: 0x9eaab3, steelD: 0x808c95, width: 26, lanes: 2, ribO: 11.3, springY: 8, crownLow: 87.6, ribDepthEnd: 20.6, ribDepthCrown: 11.4 });
