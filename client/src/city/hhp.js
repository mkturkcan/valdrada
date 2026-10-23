// HIGHWAYS, PHASE 2 (the terrain and highways plan, first stretch): the Henry Hudson Parkway from the West Side Highway's
// deck at 70th St to 141st St, its ramps and the 79th Street rotunda's circle, as designed alignments. Behind `?hhp=1`
// (page) / HHP_P2=1 (node: core, tests); off, nothing here runs and the compiled parkway stays. Works with the terrain
// (`?terrain=p1`: the real heights through the height authority's membrane, world y = 3.385 + h(NAVD88) - S(x, z)) and
// without it (the flat city: grade at 3.385, the decks at their real clearance over what they cross).
//
// The data (client/public/data/hhp_p2/hhp.json, written by the terrain round's dev tool p3hh_build.py, outside the
// repository): per chain (the two carriageways, 15 ramps, the circle) a plan every 2 m (the CSCL centre line smoothed and
// moved to the planimetric roadbed's centre), the NAVD88 profile (a penalised spline through the 2017 LiDAR's road levels,
// class 2 at grade and class 17 on the decks, picked by a Viterbi over the returns' clusters), the flat city's profile, the
// cross slope measured across the width, the paved half widths, the edge treatment per side, the structures by NBI number,
// and what each end joins (another chain, a compiled street, or a compiled deck the next stretch rebuilds: the splices).
//
// This module (page and node): the data, the surface (hhpSurface), and the tile hooks:
//   hhpPre(tile, ox, oz)   before the terrain cut: the compiled parkway's and ramps' sections, kerbs, cut walls, piers and
//                          road records come out (a compiled section stays where another compiled road's ribbon covers it:
//                          the streets under the decks)
//   hhpPost(tile, ox, oz)  after the cut: the parkway's own sections (asphalt, markings, kerbs and edge skirts), its road
//                          records (dense lines on the new profile, split at the tile's border and at every junction), and
//                          under the flag the region's base sunk under the paving
// The structures (decks, girders, bents, arches, parapets, barriers, rails, walls) are drawn by city/hhpKit.js (page).
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';
export const HHP = (() => {
  try { if (typeof location !== 'undefined' && location.search && new URLSearchParams(location.search).get('hhp') === '1') return true; } catch { /* no location */ }
  try { if (isNode && process.env.HHP_P2 === '1') return true; } catch { /* no env */ }
  return false;
})();
import { HA_P1, HA_BASE, haInit, haS, haGradeAt, haRelief, HA_GROUND, haInfo } from '../world/heightAuthority.js';
import { haPreload, haAnchors, haAnchorBridges, HA_BR_UPPER } from '../world/haAnchor.js';
import { roadsOf } from '../world/tiledata.js';
import { buildBoxes, boxQuads, boxAt, cutQuadOf, topIn, BOXES } from './fdrBox.js';   // the FDR's covered and stacked stretches as one structure each

const TILE = 512, ASPHALT = 3.385, CELL = 16;
export const HHP_SEG0 = 900000000;   // the parkway's road records' segment ids (900000000 + the chain's index; CSCL's are under 1e7)
const SECT = ['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'paintG', 'gutter', 'busred', 'warn', 'warnIron', 'brick', 'path', 'rwall', 'grass', 'grassU', 'plaza'];
let D = null, READY = null;
export const HHP_CH = [];          // chains (objects below), in the data's order
// a building footprint the parkway's structures replace: the 79th Street rotunda (the traffic circle's ring and the
// garage under it are the circle's structure, 2267718; the footprint layer carries it as a building with a roof)
export function hhpSkipBuilding(cx, cz) {
  if (BOXES.length && boxAt(cx, cz)) return true;   // (inside an FDR structure's footprint: the structure is what stands there)
  const r = HHP_CH.find((c) => c.loop);
  if (!r) return false;
  let mx = 0, mz = 0;
  for (let i = 0; i < r.n; i++) { mx += r.X[i] / r.n; mz += r.Z[i] / r.n; }
  let rad = 0;
  for (let i = 0; i < r.n; i++) rad = Math.max(rad, Math.hypot(r.X[i] - mx, r.Z[i] - mz) + Math.max(r.WL[i], r.WR[i]));
  return Math.hypot(cx - mx, cz - mz) < rad + 4;
}
export const hhpStructure = (id) => (D && D.structures ? D.structures[id] || null : null);   // the registry entry (NBI)
const GRID = new Map();            // 16 m cells -> [[chain index, station index] ...] (the station segments touching the cell)
const RAWG = new Map();            // 16 m cells -> [[chain index, segment index] ...] of the replaced CSCL lines

async function readJSON() {
  if (!isNode) {
    const base = (typeof location !== 'undefined' ? new URL('data/hhp_p2/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href : '/data/hhp_p2/');
    const r = await fetch(base + 'hhp.json');
    if (!r.ok) throw new Error(`hhp_p2: ${r.status}`);
    return r.json();
  }
  const fs = await import(/* @vite-ignore */ 'node:fs/promises');
  const dir = process.env.HHP_P2_DIR || decodeURIComponent(new URL('../../public/data/hhp_p2/', import.meta.url).pathname);
  return JSON.parse(await fs.readFile(dir + 'hhp.json', 'utf8'));
}

// ---------------------------------------------------------------- the chains
// world y of station i: the flat profile, or under the terrain flag the NAVD88 profile through the membrane, plus the end
// corrections (a compiled street's drawn grade at a ramp's end, read from the authority, blended in over the last 30 m)
function chainOf(id, d) {
  const n = d.x.length, X = Float64Array.from(d.x), Z = Float64Array.from(d.z);
  const TX = new Float64Array(n), TZ = new Float64Array(n), S = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = X[b] - X[a], dz = Z[b] - Z[a], L = Math.hypot(dx, dz) || 1;
    TX[i] = dx / L; TZ[i] = dz / L;
    if (i) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  }
  return {
    id, kind: d.kind, name: d.name || null, pair: d.pair || (id === 'NB' ? 'SB' : id === 'SB' ? 'NB' : null), lead: d.lead ?? id === 'NB', n, X, Z, TX, TZ, NX: Float64Array.from(TZ, (v) => -v), NZ: TX, S,   // N = the right of travel (x east, z south)
    H: d.h, HF: d.hf, E: Float64Array.from(d.e), WL: Float64Array.from(d.wl), WR: Float64Array.from(d.wr), Y: new Float64Array(n),
    lanes: d.lanes, speed: d.speed, edgeL: d.edgeL, edgeR: d.edgeR, gapL: d.gapL, structs: d.structs, ends: d.ends, pids: d.pids,
    splice: d.splice, trimStart: d.trim_start, trimEnd: d.trim_end, dem: d.dem, loop: d.kind === 'loop',
    raw: d.raw || null, rawW: d.raw_w || 7,
  };
}

export function hhpReady() {
  if (!HHP) return Promise.resolve(false);
  if (!READY) {
    READY = (async () => {
      D = await readJSON();
      for (const [id, d] of Object.entries(D.chains)) HHP_CH.push(chainOf(id, d));
      const terr = HA_P1 && await haInit();
      for (let ci = 0; ci < HHP_CH.length; ci++) {
        const c = HHP_CH[ci];
        for (let i = 0; i + 1 < c.n; i++) {
          const w = Math.max(c.WL[i], c.WR[i], c.WL[i + 1], c.WR[i + 1]) + 6;
          const x0 = Math.min(c.X[i], c.X[i + 1]) - w, x1 = Math.max(c.X[i], c.X[i + 1]) + w, z0 = Math.min(c.Z[i], c.Z[i + 1]) - w, z1 = Math.max(c.Z[i], c.Z[i + 1]) + w;
          for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
            const k = gx * 100003 + gz;
            let a = GRID.get(k); if (!a) GRID.set(k, (a = [])); a.push(ci, i);
          }
        }
      }
      for (let ci = 0; ci < HHP_CH.length; ci++) {
        const R = HHP_CH[ci].raw, w = HHP_CH[ci].rawW / 2 + 8;
        if (!R) continue;
        for (let j = 0; j + 1 < R.length; j++) {
          const x0 = Math.min(R[j][0], R[j + 1][0]) - w, x1 = Math.max(R[j][0], R[j + 1][0]) + w, z0 = Math.min(R[j][1], R[j + 1][1]) - w, z1 = Math.max(R[j][1], R[j + 1][1]) + w;
          for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) { const k = gx * 100003 + gz; let a = RAWG.get(k); if (!a) RAWG.set(k, (a = [])); a.push(ci, j); }
        }
      }
      // the compiled streets' drawn grade at the ramps' compiled ends (and the north splices, which meet a compiled road
      // at grade): their chunks in first
      if (terr) for (const c of HHP_CH) for (const k of [0, c.n - 1]) await haPreload(c.X[k] - 8, c.Z[k] - 8, c.X[k] + 8, c.Z[k] + 8);
      // (a compiled end in a held cut road: its floor, as the anchors lay it; anchors.json, world/haAnchor.js haHoldCuts)
      CUTS = terr ? await haAnchors().then((a) => (a && a.cuts) || null).catch(() => null) : null;
      for (const c of HHP_CH) worldY(c, terr);
      // a bridge-kit end under the flag: on that deck as the anchors re-seat it (haAnchorBridges: the LiDAR deck)
      if (terr && HHP_CH.some((c) => c.ends.some((e) => e.type === 'bridge'))) {
        const B = await bridgesAnchored().catch(() => null);
        if (B) for (const c of HHP_CH) c.ends.forEach((e, k) => {
          if (e.type !== 'bridge') return;
          const b = B.find((q) => q.key === e.key), i = k === 0 ? 0 : c.n - 1;
          if (!b || !b.deck) return;
          let best = null;
          for (const p of b.deck) { const d = Math.hypot(p[0] - c.X[i], p[2] - c.Z[i]); if (d < 25 && (!best || d < best[0])) best = [d, p[1]]; }
          if (!best) return;
          // (a double-deck bridge: the carriageway takes the roadway nearer its own profile 60 m back from the end)
          const up = HA_BR_UPPER[e.key] || 0;
          if (up) {
            const j = k === 0 ? Math.min(c.n - 1, 30) : Math.max(0, c.n - 31);
            if (Math.abs(c.Y[j] - (best[1] + up)) < Math.abs(c.Y[j] - best[1])) best[1] += up;
            else {
              // (on the lower roadway the LiDAR saw the upper deck over the carriageway's last metres and the descent
              // behind them: the profile runs from the deck's end, level, to its own level and grade 150 m back on a
              // cubic (Hermite), no kink at either end)
              const jj = k === 0 ? Math.min(c.n - 2, 75) : Math.max(1, c.n - 76), sg = k === 0 ? 1 : -1;
              const y0 = best[1], y1 = c.Y[jj], L = Math.abs(c.S[jj] - c.S[i]) || 1;
              const m1 = sg * (c.Y[jj + 1] - c.Y[jj - 1]) / ((c.S[jj + 1] - c.S[jj - 1]) || 1);   // (dY per metre away from the end)
              for (let m = Math.min(i, jj); m <= Math.max(i, jj); m++) {
                const u = Math.abs(c.S[m] - c.S[i]) / L, u2 = u * u, u3 = u2 * u;
                c.Y[m] = (2 * u3 - 3 * u2 + 1) * y0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * L * m1;
              }
            }
          }
          const dy = best[1] - c.Y[i];
          e.yT = best[1];
          blendEnd(c, k, dy, Math.min(c.S[c.n - 1] * 0.5, Math.max(30, 1.5 * Math.abs(dy) / 0.04)));
          levelEnd(c, k);
        });
      }
      // where a ramp (or the circle) runs over a higher-ranked chain's paving (its merge, its gore) it lies in that paving's
      // plane, and blends back to its own profile over the next 30 m
      // a ramp steeper than its limit near a compiled street end (the LiDAR saw a deck over it, or the street lies far under
      // the fitted profile): a cubic from the street's end to the nearest station that makes it within the limit, or the
      // gentlest one (before the merges' planes)
      for (const c of HHP_CH) if (c.kind !== 'main' && !c.loop) easeCompiledEnds(c, 0.09);
      for (const c of HHP_CH) if (c.kind !== 'main') overlapPlane(c);
      // junction ends on the paving of the chain they join, exactly (the chains joined first: the data's order)
      // (twice: a chain continuing another's terminal station meets that end as the other's own ends leave it)
      for (let pass = 0; pass < 8; pass++) for (const c of HHP_CH) c.ends.forEach((e, k) => {
        if (e.type !== 'chain') return;
        const o = HHP_CH.find((q) => q.id === e.chain), i = k === 0 ? 0 : c.n - 1;
        const j = [0, o.n - 1].find((j) => Math.hypot(o.X[j] - c.X[i], o.Z[j] - c.Z[i]) < 2.5);
        if (j !== undefined) { blendEnd(c, k, o.Y[j] - c.Y[i]); return; }
        const h = hhpHits(c.X[i], c.Z[i], 1.0).filter((q) => q.c === o).sort((a, b) => Math.abs(a.y - c.Y[i]) - Math.abs(b.y - c.Y[i]))[0];
        if (h) blendEnd(c, k, h.y - c.Y[i]);
      });
      if (terr) await buildBoxes(HHP_CH, hhpHits);
      console.log(`[hhp] ${HHP_CH.length} chains, ${terr ? 'on the height authority' : 'flat city'}`);
      return true;
    })().catch((e) => { console.warn('[hhp] unavailable, the compiled parkway stays', e); HHP_CH.length = 0; return false; });
  }
  return READY;
}

function worldY(c, terr) {
  if (!terr) {
    // the flat city is level: the cross slope only on the decks (a viaduct's superelevation), faded in over 30 m
    const deck = new Float64Array(c.n);
    for (const q of c.structs) if ((q.kind !== 'cover' && q.kind !== 'under') && !q.garage) for (let i = q.i0; i <= q.i1; i++) deck[i] = 1;
    const k = new Float64Array(c.n);
    for (let i = 0; i < c.n; i++) {
      let m = 0;
      for (let j = Math.max(0, i - 15); j <= Math.min(c.n - 1, i + 15); j++) if (deck[j]) m = Math.max(m, 1 - Math.abs(c.S[j] - c.S[i]) / 30);
      k[i] = m;
    }
    for (let i = 0; i < c.n; i++) c.E[i] *= k[i];
  }
  for (let i = 0; i < c.n; i++) {
    let y = c.HF[i];
    if (terr) { const s = haS(c.X[i], c.Z[i]); if (s !== null) y = ASPHALT + c.H[i] - s; }
    c.Y[i] = y;
  }
  c.ends.forEach((e, k) => {
    const i = k === 0 ? 0 : c.n - 1;
    if (e.type === 'rfk') { rfkEnd(c, k, e); return; }   // (the RFK kit's roadway: its own height and grade, both modes)
    if (!terr) {
      // the flat city: a compiled street's end at the compiled grade, a splice at its compiled deck, both level across
      if (e.type === 'compiled') { blendEnd(c, k, ASPHALT - c.Y[i]); levelEnd(c, k); }
      else if (e.type === 'splice' || e.type === 'bridge') { blendEnd(c, k, e.y_flat - c.Y[i]); levelEnd(c, k); }
      return;
    }
    if (e.type === 'splice') levelEnd(c, k);   // (the compiled deck or road it hands over to is level across)
    if (e.type !== 'compiled' && !(e.type === 'splice' && !e.deck)) return;
    if (e.type === 'compiled') levelEnd(c, k);   // (the street it hands over to is level across, as in the flat city)
    const f = cutFloorNear(c.X[i], c.Z[i]), g = f !== null ? f : haGradeAt(c.X[i], c.Z[i]);
    // (the blend long enough that it adds at most 3 % of grade: a smoothstep's steepest is 1.5 dy / len)
    if (g !== null) blendEnd(c, k, g - c.Y[i], Math.min(c.S[c.n - 1] * 0.5, Math.max(30, (1.5 * Math.abs(g - c.Y[i])) / 0.03)));
  });
}
function overlapPlane(c) {
  // the stations whose centre lies on a higher-ranked paving at about its height: that paving's plane there
  const n = c.n, ov = new Uint8Array(n), Y1 = Float64Array.from(c.Y), E1 = Float64Array.from(c.E);
  for (let i = 0; i < n; i++) {
    const h = hhpHits(c.X[i], c.Z[i], -0.3).filter((q) => q.c !== c && rank(q.c) < rank(c) && Math.abs(q.y - c.Y[i]) < 1.0)[0];
    if (!h) continue;
    const o = h.c, k = h.i, e = o.E[k] + (o.E[k + 1] - o.E[k]) * h.t;
    ov[i] = 1; Y1[i] = h.y; E1[i] = e * (o.NX[k] * c.NX[i] + o.NZ[k] * c.NZ[i]);
  }
  if (!ov.some(Boolean)) return;
  // outside: the difference at the run's last station, value and slope (a Hermite start, so the grade is continuous),
  // faded out over 60 m (smootherstep: the vertical curvature it adds stays small)
  const Y0 = Float64Array.from(c.Y), E0 = Float64Array.from(c.E);
  for (let i = 0; i < n; i++) {
    if (ov[i]) { c.Y[i] = Y1[i]; c.E[i] = E1[i]; continue; }
    let j = -1;
    for (let d = 1; d < n && Math.abs(c.S[Math.min(n - 1, i + d)] - c.S[i]) < 60 || Math.abs(c.S[Math.max(0, i - d)] - c.S[i]) < 60; d++) {
      if (i + d < n && ov[i + d]) { j = i + d; break; }
      if (i - d >= 0 && ov[i - d]) { j = i - d; break; }
      if (d > n) break;
    }
    if (j < 0) continue;
    const dir = Math.sign(i - j), jp = j - dir, dist = Math.abs(c.S[i] - c.S[j]);
    if (dist >= 60) continue;
    const dY = Y1[j] - Y0[j], dE = E1[j] - E0[j];
    const g = jp >= 0 && jp < n && ov[jp] ? ((Y1[j] - Y1[jp]) - (Y0[j] - Y0[jp])) / Math.max(1e-6, Math.abs(c.S[j] - c.S[jp])) : 0;
    const u = dist / 60, w = 1 - u * u * u * (u * (u * 6 - 15) + 10);
    c.Y[i] = Y0[i] + (dY + g * dist) * w;
    c.E[i] = E0[i] + dE * w;
  }
}
let CUTS = null;
// the floor (world y) of a held cut road's measured station within 3 m, or null
function cutFloorNear(x, z) {
  if (!CUTS) return null;
  let best = null;
  for (const [key, T] of Object.entries(CUTS)) {
    const [kx, kz] = key.split('_').map(Number);
    if (Math.abs(kx - Math.floor(x / TILE)) + Math.abs(kz - Math.floor(z / TILE)) > 2) continue;
    for (const [j, c] of Object.entries(T)) {
      if (j === 'rail' || !c || !c.x) continue;
      for (let i = 0; i < c.x.length; i++) {
        if (c.floor[i] === null || !(c.measured && c.measured[i])) continue;
        const d = Math.hypot(c.x[i] - x, c.z[i] - z);
        if (d < 3 && (!best || d < best[0])) { const s = haS(c.x[i], c.z[i]); if (s !== null) best = [d, ASPHALT + c.floor[i] - s]; }
      }
    }
  }
  return best ? best[1] : null;
}
// the cross slope faded to level over the last 30 m at one end
function levelEnd(c, k) {
  for (let i = 0; i < c.n; i++) {
    const d = k === 0 ? c.S[i] : c.S[c.n - 1] - c.S[i];
    if (d >= 30) continue;
    const u = d / 30;
    c.E[i] *= u * u * (3 - 2 * u);
  }
}
// a height correction at one end, faded out over 30 m along the chain (smoothstep)
// a junction end's grade matched to the street it runs onto (tgt: dY per metre going into the chain from its end): a
// cubic a d (1 - d/L)^2 added over the last L metres, its height at the end and at L unchanged, its curvature 4a/L
// within the chain's vertical-curve limit
function sagEnd(c, k, tgt) {
  const i = k === 0 ? 0 : c.n - 1, i1 = k === 0 ? 1 : c.n - 2;
  // (half the difference: the full match would steepen the grade before it by a third of it; the rest is the junction's,
  // taken at the street's speed)
  const cur = (c.Y[i1] - c.Y[i]) / Math.abs(c.S[i1] - c.S[i]), a = 0.5 * (tgt - cur);
  if (!Number.isFinite(a) || Math.abs(a) < 0.01) return;
  const L = Math.min(c.S[c.n - 1] * 0.6, 30);
  for (let m = 0; m < c.n; m++) {
    const d = k === 0 ? c.S[m] : c.S[c.n - 1] - c.S[m];
    if (d >= L) continue;
    c.Y[m] += a * d * (1 - d / L) * (1 - d / L);
  }
  c.sagged = (c.sagged || []).concat([[k, +a.toFixed(4), +L.toFixed(0)]]);
}
// an end on the RFK Bridge kit's roadway (city/rfkHarlem.js draws it, in the flat frame in both modes; data tool rfk_trim):
// the chain meets it at its height and grade, a cubic (Hermite) from there to the chain's own level and grade over 2 m of
// run per 0.1 m of height to make up (60-120 m, at most 60 % of the chain), so no kink at either end
function rfkEnd(c, k, e) {
  const n = c.n, i = k === 0 ? 0 : n - 1, dist = (m) => (k === 0 ? c.S[m] : c.S[n - 1] - c.S[m]);
  const L = Math.min(c.S[n - 1] * 0.6, Math.max(c.kind === 'main' ? 150 : 60, Math.min(150, Math.abs(e.y - c.Y[i]) * 20)));   // (a main 150 m: its kink limit)
  const st = k === 0 ? 1 : -1;
  let j = i + st;
  while (j + st >= 0 && j + st <= n - 1 && dist(j) < L) j += st;
  const Ld = dist(j) || 1, jn = Math.max(1, Math.min(n - 2, j));
  const m1 = ((c.Y[jn + 1] - c.Y[jn - 1]) / ((c.S[jn + 1] - c.S[jn - 1]) || 1)) * (k === 0 ? 1 : -1);   // (per metre away from the end)
  const g = Math.max(-0.07, Math.min(0.07, e.g)), m0 = k === 0 ? g : -g, y0 = e.y, y1 = c.Y[j];   // (the kit's grade, within a main's limit)
  for (let m = Math.min(i, j); m <= Math.max(i, j); m++) {
    const u = dist(m) / Ld, u2 = u * u, u3 = u2 * u;
    c.Y[m] = (2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * Ld * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * Ld * m1;
  }
  e.yT = y0;
}
function easeCompiledEnds(c, gmax) {
  const n = c.n;
  if (n < 8) return;
  // (a short ramp steeper than its limit anywhere: one cubic end to end, at its ends' own grades, where that keeps within it)
  if (c.S[n - 1] < 300 && c.ends.every((e) => e.type === 'chain')) {
    let mx = 0;
    for (let m = 0; m + 1 < n; m++) mx = Math.max(mx, Math.abs((c.Y[m + 1] - c.Y[m]) / ((c.S[m + 1] - c.S[m]) || 1)));
    if (mx > gmax + 1e-4) {
      const L = c.S[n - 1], g0 = (c.Y[2] - c.Y[0]) / ((c.S[2] - c.S[0]) || 1), g1 = (c.Y[n - 1] - c.Y[n - 3]) / ((c.S[n - 1] - c.S[n - 3]) || 1);
      const Y = c.S.map((sv) => { const u = sv / L, u2 = u * u, u3 = u2 * u; return (2 * u3 - 3 * u2 + 1) * c.Y[0] + (u3 - 2 * u2 + u) * L * g0 + (-2 * u3 + 3 * u2) * c.Y[n - 1] + (u3 - u2) * L * g1; });
      let ok = true;
      for (let m = 0; m + 1 < n && ok; m++) if (Math.abs((Y[m + 1] - Y[m]) / ((c.S[m + 1] - c.S[m]) || 1)) > gmax) ok = false;
      if (ok) { for (let m = 0; m < n; m++) c.Y[m] = Y[m]; return; }
    }
  }
  const gr = (m) => (c.Y[m + 1] - c.Y[m]) / ((c.S[m + 1] - c.S[m]) || 1);
  c.ends.forEach((e, k) => {
    if (e.type !== 'compiled') return;
    const i = k === 0 ? 0 : n - 1, st = k === 0 ? 1 : -1, dist = (m) => Math.abs(c.S[m] - c.S[i]);
    // (steep within 80 m of the end?)
    let steep = false;
    for (let m = i; m !== i + st * Math.min(n - 2, 40); m += st) { const a = Math.min(m, m + st); if (a >= 0 && a + 1 < n && Math.abs(gr(a)) > gmax + 1e-4) { steep = true; break; } }
    if (!steep) return;
    const y0 = c.Y[i], m0 = 0;   // (level onto the street)
    let best = null;
    for (let j = i + st * 10; j > 0 && j < n - 1; j += st) {
      const L = dist(j), m1 = ((c.Y[j + 1] - c.Y[j - 1]) / ((c.S[j + 1] - c.S[j - 1]) || 1)) * st, y1 = c.Y[j];
      const Y = [];
      let ok = true;
      for (let m = i; m !== j + st; m += st) {
        const u = dist(m) / L, u2 = u * u, u3 = u2 * u;
        Y.push((2 * u3 - 3 * u2 + 1) * y0 + (u3 - 2 * u2 + u) * L * m0 + (-2 * u3 + 3 * u2) * y1 + (u3 - u2) * L * m1);
      }
      let mg = 0;
      for (let q = 0; q + 1 < Y.length; q++) mg = Math.max(mg, Math.abs(Y[q + 1] - Y[q]) / ((Math.abs(c.S[i + st * (q + 1)] - c.S[i + st * q])) || 1));
      if (!best || mg < best[0]) best = [mg, Y];
      if (mg <= gmax) break;
    }
    // (only where it is gentler than the profile it replaces)
    let cur = 0;
    if (best) for (let q = 0; q + 1 < best[1].length; q++) cur = Math.max(cur, Math.abs(c.Y[i + st * (q + 1)] - c.Y[i + st * q]) / ((Math.abs(c.S[i + st * (q + 1)] - c.S[i + st * q])) || 1));
    if (best && best[0] < cur) for (let q = 0; q < best[1].length; q++) c.Y[i + st * q] = best[1][q];
  });
}
function blendEnd(c, k, dy, len = 30) {
  if (!Number.isFinite(dy) || Math.abs(dy) < 1e-4) return;
  for (let i = 0; i < c.n; i++) {
    const d = k === 0 ? c.S[i] : c.S[c.n - 1] - c.S[i];
    if (d >= len) continue;
    const u = 1 - d / len;
    c.Y[i] += dy * u * u * (3 - 2 * u);
  }
}

// ---------------------------------------------------------------- the surface
// the paving at (x, z): every chain whose paved width covers the point; the one nearest yHint (or the highest) wins.
// Returns { c, i, t, o, y } (station segment i..i+1 at fraction t, offset o right of the centre line) or null
export function hhpHits(x, z, margin = 0) {
  const out = [];
  const L = GRID.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!L) return out;
  for (let k = 0; k < L.length; k += 2) {
    const c = HHP_CH[L[k]], i = L[k + 1];
    const ax = c.X[i], az = c.Z[i], dx = c.X[i + 1] - ax, dz = c.Z[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    if (t < -0.02 || t > 1.02) continue;
    const tc = Math.max(0, Math.min(1, t));
    const nx = c.NX[i] + (c.NX[i + 1] - c.NX[i]) * tc, nz = c.NZ[i] + (c.NZ[i + 1] - c.NZ[i]) * tc, nl = Math.hypot(nx, nz) || 1;
    const o = ((x - ax - dx * tc) * nx + (z - az - dz * tc) * nz) / nl;
    const wl = c.WL[i] + (c.WL[i + 1] - c.WL[i]) * tc, wr = c.WR[i] + (c.WR[i + 1] - c.WR[i]) * tc;
    if (o < -wl - margin || o > wr + margin) continue;
    const y = c.Y[i] + (c.Y[i + 1] - c.Y[i]) * tc + (c.E[i] + (c.E[i + 1] - c.E[i]) * tc) * o;
    out.push({ c, i, t: tc, o, y, tr: t });
  }
  return out;
}
// how far (x, z) lies from a replaced CSCL line (the compiled ribbon and its cut's trench), less that line's half width
export function hhpRawNear(x, z, mainsToo = true) {
  const L = RAWG.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!L) return Infinity;
  let best = Infinity;
  for (let k = 0; k < L.length; k += 2) {
    const c = HHP_CH[L[k]], R = c.raw, j = L[k + 1], a = R[j], b = R[j + 1];
    if (!mainsToo && c.kind === 'main') continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[1] + dz * t - z) - c.rawW / 2);
  }
  return best;
}
// the planted median (NB's left edge code 'g', a gap up to 14 m to SB's left edge): the surface across it at (x, z) (kerb
// tops 0.15 m over each edge, straight across), or null off it
export function hhpMedianAt(x, z) {
  const L = GRID.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!L) return null;
  for (let k = 0; k < L.length; k += 2) {
    const c = HHP_CH[L[k]];
    if (!c.lead || !c.gapL) continue;
    const sb = HHP_CH.find((q) => q.id === c.pair);
    if (!sb) continue;
    const i = L[k + 1];
    if (c.edgeL[i] !== 'g' || !(c.gapL[i] > 0.3 && c.gapL[i] <= 14)) continue;
    const ax = c.X[i], az = c.Z[i], dx = c.X[i + 1] - ax, dz = c.Z[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
    const t = ((x - ax) * dx + (z - az) * dz) / L2;
    if (t < 0 || t > 1) continue;
    const o = (x - ax - dx * t) * c.NX[i] + (z - az - dz * t) * c.NZ[i];
    const wl = c.WL[i] + (c.WL[i + 1] - c.WL[i]) * t, gap = c.gapL[i] + (c.gapL[i + 1] - c.gapL[i]) * t;
    if (o > -wl || o < -wl - gap) continue;
    const yN = c.Y[i] + (c.Y[i + 1] - c.Y[i]) * t - (c.E[i] + (c.E[i + 1] - c.E[i]) * t) * wl + 0.15;
    const ex = x - c.NX[i] * (o + wl + gap), ez = z - c.NZ[i] * (o + wl + gap);   // (across to SB's edge)
    const hs = hhpHits(ex, ez, 0.6).filter((h) => h.c === sb);
    if (!hs.length) continue;
    const yS = hs[0].y + 0.15, f = (-wl - o) / Math.max(0.1, gap);
    return { y: yN + (yS - yN) * f, yN, yS, gap, i };
  }
  return null;
}
export function hhpSurface(x, z, yHint = null, margin = 0) {
  const hs = hhpHits(x, z, margin);
  let best = null;
  for (const h of hs) if (!best || (yHint === null ? h.y > best.y : Math.abs(h.y - yHint) < Math.abs(best.y - yHint))) best = h;
  // the drawn one: where pavings lie within 0.6 m of each other (a merge) the higher-ranked chain's is drawn, the other cut
  if (best) for (const h of hs) if (h !== best && Math.abs(h.y - best.y) < 0.6 && rank(h.c) < rank(best.c) && Math.abs(h.o) <= (h.o > 0 ? h.c.WR[h.i] : h.c.WL[h.i])) best = h;
  return best;
}
// traffic (sim/traffic.js _placeCar): a car on the parkway stands on its paving (the road line is the centre line; the
// lanes are off it across the cross slope)
if (HHP && typeof globalThis !== 'undefined') globalThis.__hhpSurf = (x, z, y) => { if (!HHP_CH.length) return null; const h = hhpSurface(x, z, y); return h && Math.abs(h.y - y) < 1.0 ? h.y : null; };

// ---------------------------------------------------------------- before the cut: the compiled parkway out
const mineSet = () => {
  if (mineSet.s) return mineSet.s;
  const s = new Set();
  for (const c of HHP_CH) for (const p of c.pids) s.add(+p);
  return (mineSet.s = s);
};
function tileRoads(tile, ox, oz) {
  const RV = tile.S.roadVerts, out = [];
  if (!RV) return out;
  let k = 0;
  for (const r of roadsOf(tile)) {
    const pts = [];
    for (let j = 0; j < r.len; j++) pts.push([RV[(r.start + j) * 3] + ox, RV[(r.start + j) * 3 + 1], RV[(r.start + j) * 3 + 2] + oz]);
    out.push({ ...r, pts, _idx: k++ });
  }
  return out;
}
// distance in plan from (x, z) to a road's line, and its height there (strict: not past the line's ends)
function nearRoad(r, x, z, strict = false) {
  let best = Infinity, y = 0;
  for (let j = 0; j + 1 < r.pts.length; j++) {
    const a = r.pts[j], b = r.pts[j + 1], dx = b[0] - a[0], dz = b[2] - a[2], L2 = dx * dx + dz * dz || 1e-9;
    const t0 = ((x - a[0]) * dx + (z - a[2]) * dz) / L2;
    if (strict && ((j === 0 && t0 < 0) || (j + 2 === r.pts.length && t0 > 1))) continue;
    const t = Math.max(0, Math.min(1, t0));
    const d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < best) { best = d; y = a[1] + (b[1] - a[1]) * t; }
  }
  return [best, y];
}

export function hhpPre(tile, ox, oz, terrTile = false) {
  if (!HHP || !HHP_CH.length || !tile || !tile.S) return null;
  // is any of the parkway near this tile?
  let hit = false;
  for (let gx = Math.floor((ox - 32) / CELL); gx <= Math.floor((ox + TILE + 32) / CELL) && !hit; gx++) for (let gz = Math.floor((oz - 32) / CELL); gz <= Math.floor((oz + TILE + 32) / CELL); gz++) if (GRID.has(gx * 100003 + gz)) { hit = true; break; }
  if (!hit) return null;
  const stats = { tris: 0, recs: 0, split: 0, furn: 0, cuts: 0 };
  // a compiled height as the tile will draw it (under the flag the cut lifts it by the relief; the decks it holds stay)
  const wOf = (x, z, y) => { if (!terrTile || y >= HA_BASE + 5) return y; const r = haRelief(x, z); return r === null ? y : y + r; };
  // 1. the road records: a compiled record's points on the parkway's paving (its own CSCL segments, or a record running
  // along a chain within 25 degrees at the chain's flat-city height: the compile grafts consecutive segments into one
  // record, so segment ids alone are not enough) are cut out; what is left of the record stays, split where it leaves
  const roads = tileRoads(tile, ox, oz);
  const mineRoad = [];   // the parts cut out (for the sections' ribbon test)
  const keptRoads = [];
  const onPaving = (r, p, q) => {
    // (a replaced segment's own record: anywhere within 6 m of the paving, whatever its compiled height (a ramp the
    // compile dug into a cut lies metres under its real level, and its centre line wanders off the roadbed's))
    if (mineSet().has(r.segId)) return hhpHits(p[0], p[2], 6.0).length > 0;
    const hs = hhpHits(p[0], p[2], 0.5);
    if (!hs.length) return false;
    if (r.rclass === 5 || r.rclass === 6) return false;
    const dx = q[0] - p[0], dz = q[2] - p[2], L = Math.hypot(dx, dz) || 1;
    return hs.some((h) => {
      const c = h.c, tx = c.TX[h.i], tz = c.TZ[h.i];
      return Math.abs((dx * tx + dz * tz) / L) > 0.906 && Math.abs(h.y - wOf(p[0], p[2], p[1])) < 1.5;
    });
  };
  const parts = [];   // [record, [points]]
  for (const r of roads) {
    if (r.pts.length < 2) { parts.push([r, r.pts, false]); continue; }
    const flag = r.pts.map((p, j) => onPaving(r, p, r.pts[Math.min(r.pts.length - 1, j + 1)] === p ? r.pts[j - 1] : r.pts[Math.min(r.pts.length - 1, j + 1)]));
    if (globalThis.__HHP_DBG && r.segId === globalThis.__HHP_DBG[2]) console.log('[hhp dbg rec]', ox / TILE, oz / TILE, r.segId, r.pts.length, r.pts.map((p, j) => `${p[0].toFixed(0)},${p[2].toFixed(0)}:${flag[j] ? 1 : 0}`).join(' '));
    if (!flag.some(Boolean)) { parts.push([r, r.pts, false]); keptRoads.push(r); continue; }
    stats.recs++;
    if (flag.every(Boolean)) { mineRoad.push(r); continue; }
    { // the cut-out runs (with a point of the kept line at each end) are the compiled parkway's own ribbon
      let run = null;
      for (let j = 0; j < r.pts.length; j++) {
        if (flag[j]) { if (!run) run = j > 0 ? [r.pts[j - 1]] : []; run.push(r.pts[j]); }
        else if (run) { run.push(r.pts[j]); if (run.length >= 2) mineRoad.push({ ...r, pts: run }); run = null; }
      }
      if (run && run.length >= 2) mineRoad.push({ ...r, pts: run });
    }
    // the kept runs, each ended where the record leaves the paving (bisection on the segment)
    let cur = [];
    for (let j = 0; j < r.pts.length; j++) {
      if (j > 0 && flag[j] !== flag[j - 1]) {
        let a = r.pts[j - 1], b = r.pts[j];
        const fa = flag[j - 1];
        for (let it = 0; it < 12; it++) {
          const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
          if (onPaving(r, m, b) === fa) a = m; else b = m;
        }
        const m = fa ? b : a;
        if (!flag[j]) cur = [m];
        else { cur.push(m); if (cur.length >= 2) parts.push([r, cur, true]); cur = []; }
      }
      if (!flag[j]) cur.push(r.pts[j]);
    }
    if (cur.length >= 2) parts.push([r, cur, true]);
    stats.split++;
  }
  for (const [r, pts, split] of parts) if (split) keptRoads.push({ ...r, pts });
  writeRecords(tile, ox, oz, parts.filter(([r, pts]) => pts.length >= 2 && polyLen(pts) > 0.5));
  // 2. the sections: a compiled ground triangle on the paving (or within a kerb's reach of it) is the parkway's when it
  // lies on a cut record's ribbon or at the chain's flat-city height, and on no kept road's ribbon at its height (the
  // streets under the decks, the junctions' own paving)
  const onKept = (x, z, y) => { for (const r of keptRoads) { if (r.rclass === 5) continue; const [d, ry] = nearRoad(r, x, z, true); if (d < r.width / 2 - 0.2 && Math.abs(ry - y) < 1.0) return true; } return false; };
  // inside the paving: anything at the chain's flat-city height (-0.3 .. +0.6 m: the compiled ribbon's edges, the ground
  // fill's slivers, another compiled road laid across it) goes, except a kept road's paving within 25 m of a ramp's
  // compiled end (the junction it meets); and a cut record's ribbon goes at its own height (its raised decks)
  const nearJunction = (h) => h.c.loop || h.c.ends.some((e, k) => e.type === 'compiled' && (k === 0 ? h.c.S[h.i] < 25 : h.c.S[h.c.n - 1] - h.c.S[h.i] < 25));   // (the circle meets its streets all round)
  const onMine = (x, z, y, pad) => {
    for (const r of mineRoad) { const [d, ry] = nearRoad(r, x, z); if (d < r.width / 2 + pad && Math.abs(ry - y) < 1.6 && !onKept(x, z, y)) return true; }   // (its end caps too: the junction mouths' paving)
    // the replaced segments' compiled ribbons and cut trenches (walls 0.25 m off the edges, a kerb strip): within 1.5 m of
    // their CSCL lines' edges, at any compiled height, unless a kept road's paving lies there at that height
    // (a ramp's trench anywhere; the parkway's own ribbon not under its decks, where the ground stays)
    if (!onKept(x, z, y) && (hhpRawNear(x, z, false) < 1.5 + pad || (hhpRawNear(x, z) < 1.5 + pad && !hhpHits(x, z, 8).some((h) => h.c.structs.some((q) => (q.kind !== 'cover' && q.kind !== 'under') && h.i >= q.i0 && h.i <= q.i1))))) return true;
    // (end-of-run cut walls and kerbs of a replaced segment: within its ribbon at any of its heights)
    const md = hhpMedianAt(x, z);
    if (md) { const yw0 = wOf(x, z, y); if (yw0 > Math.min(md.yN, md.yS) - 0.6 && yw0 < Math.max(md.yN, md.yS) + 0.6 && !onKept(x, z, y)) return true; }
    const hs = hhpHits(x, z, pad);
    if (!hs.length) return false;
    const yw = wOf(x, z, y);
    // (between two carriageways stacked over each other (3 m+ apart): a compiled deck or road left in the gap is the
    // compiled drive the stack replaces)
    if (hs.length > 1) { let lo = Infinity, hi = -Infinity; for (const h of hs) { lo = Math.min(lo, h.y); hi = Math.max(hi, h.y); } if (hi - lo > 3 && yw > lo + 0.3 && yw < hi - 0.3) return true; }
    // (at a junction too: the ramp's paving runs through to its end node, the junction's own paving round it)
    for (const h of hs) {
      const nj = nearJunction(h), lo = nj ? 0.8 : 0.3, hi = nj ? 0.8 : 0.6;   // (at a junction the ramp's end moves onto the laid paving later)
      if (yw > h.y - lo && yw < h.y + hi) return true;
    }
    return false;
  };
  for (const name of SECT) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [];
    let cut = 0;
    const pad = name === 'rwall' || name === 'curb' ? 1.6 : 0.6;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const x = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, y = (a[i + 1] + a[i + 4] + a[i + 7]) / 3, z = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      if (name === 'grass' || name === 'grassU' || name === 'plaza') {
        // a lawn only where the new paving covers it (the compiled ribbon was narrower than the roadbed): cut at its edge
        const onPav = (px, pz, py) => { const h = hhpSurface(px, pz, null, 0); if (h && Math.abs(h.y - wOf(px, pz, py)) < 0.6) return true; const md = hhpMedianAt(px, pz); return !!md && Math.abs(md.y - wOf(px, pz, py)) < 0.8; };
        const clippedG = clipOff(a, i, ox, oz, (px, pz, py) => onPav(px, pz, py), 0);
        if (clippedG) { cut++; for (const q of clippedG) keep.push(q); continue; }
        if (!onPav(x, z, y)) { for (let k = 0; k < 9; k++) keep.push(a[i + k]); continue; }
        cut++; continue;
      }
      // a triangle across the paving's end (a splice into a compiled deck, a ramp's end at a junction): clipped to the
      // part off the paving
      const clipped = clipOff(a, i, ox, oz, onMine, pad);
      if (globalThis.__HHP_DBG && Math.hypot(x - globalThis.__HHP_DBG[0], z - globalThis.__HHP_DBG[1]) < 4) console.log('[hhp dbg]', name, x.toFixed(1), z.toFixed(1), y.toFixed(3), 'yw', wOf(x, z, y).toFixed(3), 'hits', hhpHits(x, z, pad).map((h) => `${h.c.id} ${h.y.toFixed(3)} o ${h.o.toFixed(1)}`).join(' '), 'onMine', onMine(x, z, y, pad), 'kept', onKept(x, z, y), 'clipped', !!clipped, 'mineRoad', mineRoad.map((r) => `${r.segId}:${nearRoad(r, x, z, true).map((v) => v.toFixed(2)).join('/')}w${r.width}`).join(' '));
      if (clipped) {
        cut++; for (const q of clipped) keep.push(q);
        if (GONE_AS_GROUND.includes(name)) { const on = clipOff(a, i, ox, oz, (px, pz, py, pd) => !onMine(px, pz, py, pd), pad); if (on) { const g = tile.__hhpGone || (tile.__hhpGone = []); for (const q of on) g.push(q); } }
        continue;
      }
      if (onMine(x, z, y, pad)) {
        cut++;
        // (a paved triangle taken out: its outline comes back as ground in hhpPost, the corridor clamp shapes it)
        if (GONE_AS_GROUND.includes(name)) { const g = tile.__hhpGone || (tile.__hhpGone = []); for (let k = 0; k < 9; k++) g.push(a[i + k]); }
        continue;
      }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    if (cut) { tile.S[name] = Float32Array.from(keep); stats.tris += cut; }
  }
  // 3. the compiled cut's holes (RG44: the 96th St ramps were dug 2.9 m into the flat city) and the viaduct piers (kind 33)
  const RC = tile.header.railCuts;
  if (RC && RC.length) {
    const keep = RC.filter(([x, z]) => !(onMine(x + ox, z + oz, 0.45, 2) || mineRoad.some((r) => nearRoad(r, x + ox, z + oz)[0] < r.width / 2 + 2)));
    stats.cuts = RC.length - keep.length;
    if (stats.cuts) tile.header.railCuts = keep;
  }
  if (tile.S.furn && tile.S.furn.byteLength) {
    const src = new Uint8Array(tile.S.furn.buffer, tile.S.furn.byteOffset, tile.S.furn.byteLength), dv = new DataView(src.buffer, src.byteOffset, src.byteLength);
    const keep = [];
    for (let o = 0; o + 20 <= src.byteLength; o += 20) {
      if (dv.getUint8(o) === 33) {
        const x = dv.getFloat32(o + 4, true) + ox, z = dv.getFloat32(o + 12, true) + oz;
        if (mineRoad.some((r) => nearRoad(r, x, z)[0] < r.width / 2 + 1.5) || hhpSurface(x, z, null, 1.5)) { stats.furn++; continue; }
      }
      keep.push(o);
    }
    if (stats.furn) {
      const m = new Uint8Array(keep.length * 20);
      keep.forEach((o, j) => m.set(src.subarray(o, o + 20), j * 20));
      tile.S.furn = m;
    }
  }
  tile.hhp = { pre: stats };
  return stats;
}
const polyLen = (P) => { let L = 0; for (let j = 1; j < P.length; j++) L += Math.hypot(P[j][0] - P[j - 1][0], P[j][2] - P[j - 1][2]); return L; };

// a triangle whose corners fall on both sides of the paving's edge (by onMine at its own height): the part off the paving,
// by bisection along the edges that cross (as triangles, tile-local); null when it does not straddle
function clipOff(a, i, ox, oz, onMine, pad, iters = 10) {
  const P = [0, 1, 2].map((k) => [a[i + k * 3] + ox, a[i + k * 3 + 1], a[i + k * 3 + 2] + oz]);
  const ins = P.map((p) => onMine(p[0], p[2], p[1], pad));
  if (ins.every(Boolean) || !ins.some(Boolean)) return null;
  const poly = [];
  for (let k = 0; k < 3; k++) {
    const p = P[k], q = P[(k + 1) % 3];
    if (!ins[k]) poly.push(p);
    if (ins[k] !== ins[(k + 1) % 3]) {
      let u0 = 0, u1 = 1;
      const fin = ins[k];
      for (let it = 0; it < iters; it++) {
        const u = (u0 + u1) / 2, m = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u];
        if (onMine(m[0], m[2], m[1], pad) === fin) u0 = u; else u1 = u;
      }
      const u = fin ? u1 : u0;
      poly.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]);
    }
  }
  const out = [];
  for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) out.push(p[0] - ox, p[1], p[2] - oz);
  return out;
}

// the tile's road records rewritten: the kept ones as they were, a split one as its runs (new vertices appended)
function writeRecords(tile, ox, oz, parts) {
  const RV = tile.S.roadVerts || new Float32Array(0), extra = [];
  let base = RV.length / 3;
  const out = new Uint8Array(parts.length * 24), dv = new DataView(out.buffer);
  const meta = tile.S.roads, src = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  parts.forEach(([r, pts, split], k) => {
    const o = k * 24, so = r._idx * 24;
    for (let b = 0; b < 24; b++) out[o + b] = src.getUint8(so + b);
    if (split) {
      dv.setUint32(o, base, true); dv.setUint16(o + 4, pts.length, true);
      for (const p of pts) extra.push(p[0] - ox, p[1], p[2] - oz);
      base += pts.length;
    }
  });
  tile.S.roads = out;
  if (extra.length) { const n = new Float32Array(RV.length + extra.length); n.set(RV); n.set(extra, RV.length); tile.S.roadVerts = n; }
}

// ---------------------------------------------------------------- after the cut: the parkway's own ground
const PAINT_LIFT = 0.02, KERB = 0.15, SKIRT = 0.6;
const owns = (ox, oz, x, z) => x >= ox && x < ox + TILE && z >= oz && z < oz + TILE;
export function hhpPost(tile, ox, oz, terrTile = false) {
  // (a tile the corridor's paving misses can still hold a structure's footprint: its deck's or band's end)
  if (HHP && HHP_CH.length && tile && tile.S && !tile.hhp && HA_P1 && BOXES.length) { boxGround(tile, ox, oz); return null; }
  if (!HHP || !HHP_CH.length || !tile || !tile.S || !tile.hhp) return null;
  // (the ground regrown where compiled paving went comes first: the park deck's lift then takes its pieces over a covered
  // drive with the rest, cut at the drive's edge, instead of leaving them stretched from the drive's level across it)
  dbgHas(tile, ox, oz, 'pre-regrow'); regrowGone(tile, ox, oz); dbgHas(tile, ox, oz, 'regrown');
  if (HA_P1) { liftCoveredDecks(tile, ox, oz); dropCoverAprons(tile, ox, oz); }
  const add = {};
  const push = (name, ...P) => { const a = add[name] || (add[name] = []); for (const p of P) a.push(p[0] - ox, p[1], p[2] - oz); };
  const quad = (name, a, b, c, d) => { push(name, a, b, c); push(name, a, c, d); };   // a b c d counter-clockwise from above
  // the compiled paving left at a ramp's compiled end (its junction) and, for a ramp or the circle, a higher-ranked chain's
  // paving: where either lies within 0.15 m of a quad's height, the quad is cut round it (convex subtraction), so no two
  // pavings ever lie on each other
  const asph = tile.S.asphalt, AH = new Map();
  if (asph) for (let t = 0; t + 8 < asph.length; t += 9) {
    const x0 = Math.min(asph[t], asph[t + 3], asph[t + 6]) + ox, x1 = Math.max(asph[t], asph[t + 3], asph[t + 6]) + ox;
    const z0 = Math.min(asph[t + 2], asph[t + 5], asph[t + 8]) + oz, z1 = Math.max(asph[t + 2], asph[t + 5], asph[t + 8]) + oz;
    if (x1 - x0 > 80 || z1 - z0 > 80) continue;
    for (let gx = Math.floor(x0 / 8); gx <= Math.floor(x1 / 8); gx++) for (let gz = Math.floor(z0 / 8); gz <= Math.floor(z1 / 8); gz++) { const k = gx * 100003 + gz; let L = AH.get(k); if (!L) AH.set(k, (L = [])); L.push(t); }
  }
  // a ramp's compiled end in this tile meets the junction's paving as laid (the cut's floor, a held structure, the
  // relief): the difference blended in over its last 30 m, once
  for (const c of HHP_CH) c.ends.forEach((e, k) => {
    if ((e.type !== 'compiled' && e.type !== 'splice') || (c.fixed && c.fixed[k])) return;
    const i = k === 0 ? 0 : c.n - 1;
    if (!owns(ox, oz, c.X[i], c.Z[i]) || !asph) return;
    let best = null, bestD = 3, gRec = null;
    for (let t = 0; t + 8 < asph.length; t += 9) {
      const lx = c.X[i] - ox, lz = c.Z[i] - oz;
      let d = inTri(asph, t, lx, lz) ? 0 : Math.hypot((asph[t] + asph[t + 3] + asph[t + 6]) / 3 - lx, (asph[t + 2] + asph[t + 5] + asph[t + 8]) / 3 - lz);
      if (d >= bestD && !(d === 0 && best !== null)) continue;
      const y = d === 0 ? triY(asph, t, lx, lz) : (asph[t + 1] + asph[t + 4] + asph[t + 7]) / 3;
      if (Math.abs(y - c.Y[i]) < 1.2 && (best === null || d < bestD || Math.abs(y - c.Y[i]) < Math.abs(best - c.Y[i]))) { best = y; bestD = d; }
    }
    for (const r of roadsOf(tile)) {
      if (r.segId >= HHP_SEG0) continue;
      for (const j of [0, r.len - 1]) {
        const q = (r.start + j) * 3, d = Math.hypot(tile.S.roadVerts[q] + ox - c.X[i], tile.S.roadVerts[q + 2] + oz - c.Z[i]);
        if (d < 1.0 && Math.abs(tile.S.roadVerts[q + 1] - c.Y[i]) < 1.2) {
          best = tile.S.roadVerts[q + 1];
          // the record's grade away from the junction (its next vertex 3 m+ on)
          const step = j === 0 ? 1 : -1;
          for (let m = j + step; m >= 0 && m < r.len; m += step) {
            const q2 = (r.start + m) * 3, L = Math.hypot(tile.S.roadVerts[q2] - tile.S.roadVerts[q], tile.S.roadVerts[q2 + 2] - tile.S.roadVerts[q + 2]);
            if (L >= 3) {
              // (only the street the chain runs on into: its record leaving the junction along the chain's own line)
              const ux = (tile.S.roadVerts[q2] - tile.S.roadVerts[q]) / L, uz = (tile.S.roadVerts[q2 + 2] - tile.S.roadVerts[q + 2]) / L;
              const along = (k === 0 ? -1 : 1) * (ux * c.TX[i] + uz * c.TZ[i]), g = (tile.S.roadVerts[q2 + 1] - tile.S.roadVerts[q + 1]) / L;
              if (e.type === 'compiled' && along > 0.85 && Math.abs(g) < 0.09) gRec = g;
              break;
            }
          }
        }
      }
    }
    (c.fixed || (c.fixed = [false, false]))[k] = true;
    // (blended over a length that adds at most 4 % of grade: 1.5 dy / len)
    if (best !== null && Math.abs(best - c.Y[i]) > 0.003) { blendEnd(c, k, best - c.Y[i], Math.min(c.S[c.n - 1] * 0.8, Math.max(30, 1.5 * Math.abs(best - c.Y[i]) / 0.04))); c.fixedBy = (c.fixedBy || []).concat([[k, +(best - c.Y[i]).toFixed(3)]]); }
    if (gRec !== null && HA_P1) sagEnd(c, k, -gRec);   // (the flat city's profile lands its ends level already)
    // (a chain continuing this one's terminal station follows the end as laid)
    for (const o of HHP_CH) o.ends.forEach((oe, ok) => {
      if (oe.type !== 'chain' || oe.chain !== c.id) return;
      const oi = ok === 0 ? 0 : o.n - 1;
      if (Math.hypot(c.X[i] - o.X[oi], c.Z[i] - o.Z[oi]) < 2.5) blendEnd(o, ok, c.Y[i] - o.Y[oi]);
    });
  });
  let nq = 0, ncut = 0;
  for (const c of HHP_CH) {
    for (let i = 0; i + 1 < c.n; i++) {
      const mx = (c.X[i] + c.X[i + 1]) / 2, mz = (c.Z[i] + c.Z[i + 1]) / 2;
      const own = owns(ox, oz, mx, mz);
      const underI = c.structs.some((q) => q.kind === 'under' && i >= q.i0 - 8 && i <= q.i1 + 8);
      const P = (k, o, dy = 0) => [c.X[k] + c.NX[k] * o, c.Y[k] + c.E[k] * o + dy, c.Z[k] + c.NZ[k] * o];
      const aL = P(i, -c.WL[i]), aR = P(i, c.WR[i]), bL = P(i + 1, -c.WL[i + 1]), bR = P(i + 1, c.WR[i + 1]);
      // (the paving is cut on the tile's edges and drawn in every tile it lies in: no seam row along a tile edge; the rest
      // of the station, markings, kerbs and median, stays with the tile owning its midpoint)
      if (!own && (Math.max(aL[0], aR[0], bL[0], bR[0]) < ox || Math.min(aL[0], aR[0], bL[0], bR[0]) >= ox + TILE ||
        Math.max(aL[2], aR[2], bL[2], bR[2]) < oz || Math.min(aL[2], aR[2], bL[2], bR[2]) >= oz + TILE)) continue;
      const yMine = (x, z) => { const h = segAt(c, i, x, z); return h; };
      // the cutters: convex outlines [[x, z] ...] lying at this paving's height
      const cutters = [];
      const bx0 = Math.min(aL[0], aR[0], bL[0], bR[0]), bx1 = Math.max(aL[0], aR[0], bL[0], bR[0]), bz0 = Math.min(aL[2], aR[2], bL[2], bR[2]), bz1 = Math.max(aL[2], aR[2], bL[2], bR[2]);
      const seenT = new Set();
      const nearEnd = false;   // (the junction's paving under the ramp's was taken out before the cut: the ramp's is drawn)
      if (nearEnd) for (let gx = Math.floor(bx0 / 8); gx <= Math.floor(bx1 / 8); gx++) for (let gz = Math.floor(bz0 / 8); gz <= Math.floor(bz1 / 8); gz++) {
        const L = AH.get(gx * 100003 + gz); if (!L) continue;
        for (const t of L) {
          if (seenT.has(t)) continue;
          seenT.add(t);
          const T = [[asph[t] + ox, asph[t + 2] + oz], [asph[t + 3] + ox, asph[t + 5] + oz], [asph[t + 6] + ox, asph[t + 8] + oz]];
          const cx = (T[0][0] + T[1][0] + T[2][0]) / 3, cz = (T[0][1] + T[1][1] + T[2][1]) / 3, cy = (asph[t + 1] + asph[t + 4] + asph[t + 7]) / 3;
          if (Math.abs(yMine(cx, cz) - cy) < 0.04) cutters.push(T);
        }
      }
      if (c.kind !== 'main') {
        const seen = new Set();
        for (let gx = Math.floor(bx0 / CELL); gx <= Math.floor(bx1 / CELL); gx++) for (let gz = Math.floor(bz0 / CELL); gz <= Math.floor(bz1 / CELL); gz++) {
          const L = GRID.get(gx * 100003 + gz); if (!L) continue;
          for (let k = 0; k < L.length; k += 2) {
            const o = HHP_CH[L[k]], j = L[k + 1];
            if (o === c || rank(o) > rank(c) || (rank(o) === rank(c) && L[k] > HHP_CH.indexOf(c)) || seen.has(L[k] * 100000 + j)) continue;
            seen.add(L[k] * 100000 + j);
            const Q = [[o.X[j] + o.NX[j] * o.WR[j], o.Z[j] + o.NZ[j] * o.WR[j]], [o.X[j + 1] + o.NX[j + 1] * o.WR[j + 1], o.Z[j + 1] + o.NZ[j + 1] * o.WR[j + 1]],
              [o.X[j + 1] - o.NX[j + 1] * o.WL[j + 1], o.Z[j + 1] - o.NZ[j + 1] * o.WL[j + 1]], [o.X[j] - o.NX[j] * o.WL[j], o.Z[j] - o.NZ[j] * o.WL[j]]];
            const cx = (Q[0][0] + Q[2][0]) / 2, cz = (Q[0][1] + Q[2][1]) / 2;
            const yo = segAt(o, j, cx, cz);
            if (Math.abs(yo - yMine(cx, cz)) < 0.6) cutters.push(Q);   // (a merge: a ramp truly over or under is 3 m off)
          }
        }
      }
      let pieces = [[[aR[0], aR[2]], [bR[0], bR[2]], [bL[0], bL[2]], [aL[0], aL[2]]]];
      for (const T of cutters) { const next = []; for (const p of pieces) for (const q of subtractConvex(p, T)) next.push(q); pieces = next; if (!pieces.length) break; }
      const cut = cutters.length > 0;
      if (globalThis.__HHP_DBG) { const [qx, qz] = globalThis.__HHP_DBG; if (qx >= bx0 - 1 && qx <= bx1 + 1 && qz >= bz0 - 1 && qz <= bz1 + 1) { const inP = (p) => { let c2 = false; for (let a2 = 0, b2 = p.length - 1; a2 < p.length; b2 = a2++) { if ((p[a2][1] > qz) !== (p[b2][1] > qz) && qx < ((p[b2][0] - p[a2][0]) * (qz - p[a2][1])) / (p[b2][1] - p[a2][1]) + p[a2][0]) c2 = !c2; } return c2; }; console.log('[hhp pave]', ox / TILE, oz / TILE, c.id, i, 'own', own, 'cutters', cutters.length, 'pieces', pieces.length, 'in', pieces.some(inP), 'inQuad', inP([[aR[0], aR[2]], [bR[0], bR[2]], [bL[0], bL[2]], [aL[0], aL[2]]])); } }
      if (cut) ncut++;
      if (!pieces.length) continue;
      for (const p0 of pieces) {
        const p = clipBox(p0, ox, oz, ox + TILE, oz + TILE);
        if (p.length < 3 || Math.abs(polyArea(p)) < 0.005) continue;
        for (let k = 1; k + 1 < p.length; k++) {
          push('asphalt', ...[p[0], p[k], p[k + 1]].map(([x, z]) => [x, yMine(x, z), z]));
          // (the covered drive's paving: the terrain's ground clamp leaves the park deck over it, as for the compiled one)
          // (and any paving under an FDR structure's deck: its top stands over it by design)
          if (underI || (BOXES.length && [p[0], p[k], p[k + 1], [(p[0][0] + p[k][0] + p[k + 1][0]) / 3, (p[0][1] + p[k][1] + p[k + 1][1]) / 3]].some((q) => boxAt(q[0], q[1])))) {
            const P3 = [p[0], p[k], p[k + 1]].map(([x, z]) => [Math.fround(x - ox), Math.fround(z - oz)]);
            (tile.p1Covered || (tile.p1Covered = new Set())).add(`${Math.round(((P3[0][0] + P3[1][0] + P3[2][0]) / 3) * 100)},${Math.round(((P3[0][1] + P3[1][1] + P3[2][1]) / 3) * 100)}`);
          }
        }
      }
      if (!own) continue;
      nq++;
      const lift = (q) => q;
      // the planted median to SB's edge: grass from kerb top to kerb top (straight across, a slope where they differ)
      if (c.lead && c.edgeL[i] === 'g' && c.gapL && c.gapL[i] > 0.3 && c.gapL[i] <= 14 && c.gapL[i + 1] > 0.3 && c.gapL[i + 1] <= 14) {
        const sb = HHP_CH.find((q) => q.id === c.pair);
        const side = (k) => {
          const a = P(k, -c.WL[k] - 0.15, 0.15), g = c.gapL[k] - 0.3;
          const bx = a[0] - c.NX[k] * g, bz = a[2] - c.NZ[k] * g;
          const h = hhpHits(bx, bz, 0.6).filter((q) => q.c === sb)[0];
          return h ? [a, [bx, h.y + 0.15, bz]] : null;
        };
        const s0 = side(i), s1 = side(i + 1);
        const mxq = (s0 && s1) ? [(s0[0][0] + s1[1][0]) / 2, (s0[0][2] + s1[1][2]) / 2] : null;
        // (none inside an FDR structure (the bores' walls), none over a ramp merging into the median)
        if (s0 && s1 && !(BOXES.length && [s0[0], s0[1], s1[0], s1[1], [mxq[0], 0, mxq[1]]].some((q) => boxAt(q[0], q[2]))) && ![s0[0], s0[1], s1[0], s1[1], [mxq[0], 0, mxq[1]]].some((q) => hhpHits(q[0], q[2], 0.3).some((h) => h.c !== c && h.c !== sb))) quad('grass', s0[0], s1[0], s1[1], s0[1]);   // (none inside an FDR structure: the bores' walls)
      }
      if (cut) continue;   // (no markings, kerbs or skirts where the paving meets another's)
      // markings: the lane lines dashed (3 m in 12 m, NYC parkway practice), the edge lines solid: yellow on the left, white
      // on the right; none along an open edge (a merge)
      const W0 = c.WL[i] + c.WR[i], W1 = c.WL[i + 1] + c.WR[i + 1];
      const line = (name, f0, f1, half) => {   // f = offset fraction across from the left edge at each end
        const o0 = -c.WL[i] + f0 * W0, o1 = -c.WL[i + 1] + f1 * W1;
        quad(name, lift(P(i, o0 + half, PAINT_LIFT)), lift(P(i + 1, o1 + half, PAINT_LIFT)), lift(P(i + 1, o1 - half, PAINT_LIFT)), lift(P(i, o0 - half, PAINT_LIFT)));
      };
      const dash = ((c.S[i] % 12) + 12) % 12 < 3;
      if (dash) for (let k = 1; k < c.lanes; k++) line('paintW', k / c.lanes, k / c.lanes, 0.06);
      if (c.edgeL[i] !== 'o' && c.kind !== 'loop') { const f0 = 0.3 / W0, f1 = 0.3 / W1; line('paintY', f0, f1, 0.05); }
      if (c.edgeR[i] !== 'o') { const f0 = 1 - 0.3 / W0, f1 = 1 - 0.3 / W1; line('paintW', f0, f1, 0.05); }
      // the edges: a kerb (granite against a planted median, concrete elsewhere on the ramps) or a skirt down from the paving
      // (the ground meets it; the kit's barrier, rail, parapet or wall stands on it)
      for (const [side, sg, w0, w1] of [['L', -1, c.WL[i], c.WL[i + 1]], ['R', 1, c.WR[i], c.WR[i + 1]]]) {
        const code = side === 'L' ? c.edgeL[i] : c.edgeR[i];
        if (code === 'o' || code === 'b') continue;
        const A = lift(P(i, sg * w0)), B = lift(P(i + 1, sg * w1));
        if (code === 'k' || code === 'g') {
          const A2 = lift(P(i, sg * (w0 + 0.15))), B2 = lift(P(i + 1, sg * (w1 + 0.15)));
          const up = (p) => [p[0], p[1] + KERB, p[2]];
          if (sg < 0) { quad('curb', A, up(A), up(B), B); quad('curb', up(A), up(A2), up(B2), up(B)); }
          else { quad('curb', B, up(B), up(A), A); quad('curb', up(B), up(B2), up(A2), up(A)); }
        }
        const dn = (p) => [p[0], p[1] - SKIRT, p[2]];
        if (sg < 0) quad('curb', dn(A), A, B, dn(B)); else quad('curb', dn(B), B, A, dn(A));
      }
    }
  }
  const sunk = terrTile ? blendGround(tile, ox, oz) : clampCorridor(tile, ox, oz);   // (the ground's own sections, before the paving joins them)
  dbgHas(tile, ox, oz, 'after blend');
  if (HA_P1 && BOXES.length) { boxGround(tile, ox, oz); dbgHas(tile, ox, oz, 'after box'); }
  if (HA_P1) lawnUnderPaving(tile, ox, oz);
  dropUnderPaving(tile, ox, oz);
  for (const [name, arr] of Object.entries(add)) {
    const a = tile.S[name] || new Float32Array(0), m = new Float32Array(a.length + arr.length);
    m.set(a, 0); m.set(arr, a.length);
    tile.S[name] = m;
  }
  dbgHas(tile, ox, oz, 'after add');
  const recs = addRecords(tile, ox, oz);
  tile.hhp.post = { quads: nq, recs, sunk };
  if (nq) console.log(`[hhp] tile ${ox / TILE}_${oz / TILE}: ${tile.hhp.pre.tris} compiled triangles, ${tile.hhp.pre.recs} records, ${tile.hhp.pre.furn} piers, ${tile.hhp.pre.cuts} cut holes out; ${nq} stations paved, ${recs} records, base sunk at ${sunk}`);
  return tile.hhp;
}
const rank = (c) => (c.kind === 'main' ? 0 : c.kind === 'loop' ? 1 : 2);
// the paving's height at (x, z) by station segment i of chain c (extrapolated along and across)
function segAt(c, i, x, z) {
  const ax = c.X[i], az = c.Z[i], dx = c.X[i + 1] - ax, dz = c.Z[i + 1] - az, L2 = dx * dx + dz * dz || 1e-9;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
  const nx = c.NX[i] + (c.NX[i + 1] - c.NX[i]) * t, nz = c.NZ[i] + (c.NZ[i + 1] - c.NZ[i]) * t, nl = Math.hypot(nx, nz) || 1;
  const o = ((x - ax - dx * t) * nx + (z - az - dz * t) * nz) / nl;
  return c.Y[i] + (c.Y[i + 1] - c.Y[i]) * t + (c.E[i] + (c.E[i + 1] - c.E[i]) * t) * o;
}
const polyArea = (P) => { let a = 0; for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; };
// a convex polygon clipped to one side of the line a -> b (keep: cross >= 0 is kept when side = 1, <= 0 when side = -1)
function clipHalf(P, a, b, side) {
  const out = [], f = (p) => side * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let k = 0; k < P.length; k++) {
    const p = P[k], q = P[(k + 1) % P.length], fp = f(p), fq = f(q);
    if (fp >= 0) out.push(p);
    if ((fp >= 0) !== (fq >= 0)) { const u = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]); }
  }
  return out.length >= 3 ? out : [];
}
const GONE_AS_GROUND = ['asphalt', 'sidewalk', 'gutter', 'apron', 'path', 'brick', 'plaza', 'gravel', 'busred'];
// the paved triangles hhpPre took out, back as the region's ground ('terrP1'): 0.10 m under the authority's grade (the
// flat city's base) so a base already there wins; the corridor clamp then holds it to the paving's edges
// tiles/bridges.json re-seated by the anchors (as the streamers do), once
let BR_ANCH = null;
function bridgesAnchored() {
  if (!BR_ANCH) BR_ANCH = (async () => {
    let B;
    if (typeof window === 'undefined') {
      const fs = await import(/* @vite-ignore */ 'node:fs/promises');
      B = JSON.parse(await fs.readFile((process.env.VALDRADA_TILES || '/data0/projectnyc/client/public/tiles') + '/bridges.json', 'utf8'));
    } else {
      const base = (typeof location !== 'undefined' && new URLSearchParams(location.search).get('tiles')) || 'tiles';
      B = await (await fetch(`${base}/bridges.json`)).json();
    }
    await haAnchorBridges(B);
    return B;
  })();
  return BR_ANCH;
}
// the FDR's structures (fdrBox.js): every compiled and region ground triangle inside a footprint cut out exactly (its
// pieces outside kept on its own plane), then the deck's top drawn by rule: lawn, the promenade path along the river
// wall (4.6 m), a walk at the upper carriageway's level over a stack
// compiled paving left under a chain's own (the corridor's clamp holds what it did not take out 0.15 m under the new
// paving: a second road surface a wheel finds): out, where it lies within the paving and 0.05-0.6 m under it
function dropUnderPaving(tile, ox, oz) {
  let n = 0;
  for (const name of ['asphalt', 'paintW', 'paintY', 'gutter', 'busred']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [];
    let any = false;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
      if (hhpHits(cx, cz, 0).some((h) => cy < h.y - 0.05 && cy > h.y - 0.6)) { any = true; n++; continue; }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    if (any) tile.S[name] = Float32Array.from(keep);
  }
  return n;
}
// natural ground under a chain's paving within a fight's reach of it (-0.12 .. +0.35 m: a kept path's lawn, a regrown
// sward): its corners there held 0.15 m under the paving
function lawnUnderPaving(tile, ox, oz) {
  let n = 0;
  for (const name of ['grass', 'grassU', 'terrP1']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    for (let k = 0; k + 2 < a.length; k += 3) {
      const x = a[k] + ox, z = a[k + 2] + oz, y = a[k + 1];
      for (const h of hhpHits(x, z, 0)) if (y > h.y - 0.12 && y < h.y + 0.35) { a[k + 1] = h.y - 0.15; n++; break; }
    }
  }
  return n;
}
const inPoly = (Q, x, z) => { let c = false; for (let a = 0, b = Q.length - 1; a < Q.length; b = a++) if ((Q[a][1] > z) !== (Q[b][1] > z) && x < ((Q[b][0] - Q[a][0]) * (z - Q[a][1])) / (Q[b][1] - Q[a][1]) + Q[a][0]) c = !c; return c; };
function boxGround(tile, ox, oz) {
  const qs = boxQuads(ox - 1, oz - 1, ox + TILE + 1, oz + TILE + 1);
  if (!qs.length) return 0;
  let cut = 0;
  // the walls standing in a footprint or within 4 m behind its inner wall, under that wall's top (the replaced roadway's
  // and the terrain's built walls and rock faces there): whole triangles out, their per-vertex attributes with them
  for (const nm of ['rwall', 'terrWall', 'terrRock', 'curb']) {
    const a = tile.S[nm];
    if (!a || a.length < 9) continue;
    const nt = a.length / 9, par = Object.keys(tile.S).filter((q) => q !== nm && q.startsWith(nm) && tile.S[q] && tile.S[q].length && tile.S[q].length % nt === 0 && /^(UV|We|Mat)$/.test(q.slice(nm.length)));
    const keep = [], keepP = par.map(() => []);
    let dropped = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
      const hit = boxQuads(cx - 6, cz - 6, cx + 6, cz + 6).some(({ s, i: iq }) => inPoly(cutQuadOf(s, iq, 4), cx, cz) && cy < (s.wallTop ? s.wallTop[iq - s.i0] : s.top[iq - s.i0]) + 0.3);
      if (hit) { dropped++; continue; }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
      par.forEach((q, j) => { const b = tile.S[q], w = b.length / nt, o = (i / 9) * w; for (let k = 0; k < w; k++) keepP[j].push(b[o + k]); });
    }
    if (dropped) { tile.S[nm] = Float32Array.from(keep); par.forEach((q, j) => { tile.S[q] = tile.S[q] instanceof Uint8Array ? Uint8Array.from(keepP[j]) : Float32Array.from(keepP[j]); }); cut += dropped; }
  }
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const out = [];
    let any = false;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const P = [[a[i] + ox, a[i + 2] + oz], [a[i + 3] + ox, a[i + 5] + oz], [a[i + 6] + ox, a[i + 8] + oz]];
      const x0 = Math.min(P[0][0], P[1][0], P[2][0]), x1 = Math.max(P[0][0], P[1][0], P[2][0]), z0 = Math.min(P[0][1], P[1][1], P[2][1]), z1 = Math.max(P[0][1], P[1][1], P[2][1]);
      const C = boxQuads(x0 - 11, z0 - 11, x1 + 11, z1 + 11);
      let pieces = [P], hit = false;
      for (const { s: sq, i: iq, Q: Q0 } of C) { const Q = Q0; const next = []; for (const p of pieces) { const r = subtractConvex(p, Q); if (r.length !== 1 || r[0] !== p) hit = true; for (const q of r) next.push(q); } pieces = next; if (!pieces.length) break; }
      // (past the river wall, 10 m out: the old shore treatment over the river (aprons, kerbs) goes; ground the authority
      // has as land stays)
      if (C.some((q) => q.s.sr)) {
        const keep = [];
        for (const p of pieces) {
          let gx = 0, gz = 0; for (const q of p) { gx += q[0] / p.length; gz += q[1] / p.length; }
          const qi = haInfo(gx, gz);
          if ((!qi || qi.tag >= 3) && C.some((q) => q.s.sr && inPoly(cutQuadOf(q.s, q.i), gx, gz))) { hit = true; continue; }
          keep.push(p);
        }
        pieces = keep;
      }
      if (!hit) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
      any = true; cut++;
      // (the pieces on the triangle's own plane)
      const [A, B, Cc] = P, d = (B[1] - Cc[1]) * (A[0] - Cc[0]) + (Cc[0] - B[0]) * (A[1] - Cc[1]);
      if (Math.abs(d) < 1e-12) continue;
      const yAt = (x, z) => { const u = ((B[1] - Cc[1]) * (x - Cc[0]) + (Cc[0] - B[0]) * (z - Cc[1])) / d, v = ((Cc[1] - A[1]) * (x - Cc[0]) + (A[0] - Cc[0]) * (z - Cc[1])) / d; return a[i + 1] * u + a[i + 4] * v + a[i + 7] * (1 - u - v); };
      const sgn = Math.sign(polyArea(P));
      for (let p of pieces) {
        if (Math.sign(polyArea(p)) !== sgn) p = p.slice().reverse();
        for (let k = 1; k + 1 < p.length; k++) for (const q of [p[0], p[k], p[k + 1]]) out.push(q[0] - ox, yAt(q[0], q[1]), q[1] - oz);
      }
    }
    if (any) tile.S[name] = Float32Array.from(out);
  }
  // the street side's ground meeting the inner wall's coping: natural ground under the coping rises to it, a level
  // terrace 10 m wide behind the wall, then a 1:2 bank (no pit or shadowed facets below the wall's top)
  for (const name of ['terrP1', 'grass', 'grassU']) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    let ch = false;
    for (let k = 0; k + 2 < a.length; k += 3) {
      const x = a[k] + ox, z = a[k + 2] + oz;
      let best = -Infinity;
      for (const { s, i } of boxQuads(x - 20, z - 20, x + 20, z + 20)) {
        if (s.kind === 'shore') continue;   // (its inner edge is the drive)
        const c = s.c, dx = c.X[i + 1] - c.X[i], dz = c.Z[i + 1] - c.Z[i], L2 = dx * dx + dz * dz || 1e-9, t = ((x - c.X[i]) * dx + (z - c.Z[i]) * dz) / L2;
        if (t < 0 || t > 1) continue;
        const nx = c.NX[i] + (c.NX[i + 1] - c.NX[i]) * t, nz = c.NZ[i] + (c.NZ[i + 1] - c.NZ[i]) * t, nl = Math.hypot(nx, nz) || 1;
        const o = ((x - c.X[i] - dx * t) * nx + (z - c.Z[i] - dz * t) * nz) / nl, k0 = i - s.i0;
        const sg = s.sr > 0 ? -1 : 1, e = sg > 0 ? s.ro[k0] + (s.ro[k0 + 1] - s.ro[k0]) * t : s.lo[k0] + (s.lo[k0 + 1] - s.lo[k0]) * t;
        const d = (o - e) * sg;
        if (d < 0 || d > 20) continue;
        const W = s.top[k0] + (s.top[k0 + 1] - s.top[k0]) * t + 0.2;   // (the deck's coping: a bluff over it keeps its own ground)
        best = Math.max(best, W - 0.15 - 0.5 * Math.max(0, d - 10));   // (a 10 m terrace at the coping, then a 1:2 bank)
      }
      if (best > a[k + 1] && !hhpHits(x, z, 2.0).some((h) => !(BOXES.length && boxAt(x, z)))) { a[k + 1] = best; ch = true; }   // (never over a ramp's or a carriageway's paving beside it)
    }
  }
  // the deck's top
  const add = { grass: [], path: [] };
  for (const { s, i } of qs) {
    const k0 = i - s.i0, k1 = k0 + 1, c = s.c;
    const bands = [];
    if (s.kind === 'stack') bands.push(['path', s.lo[k0], s.ro[k0], s.lo[k1], s.ro[k1]]);
    else if (s.kind === 'shore' && s.ro[k0] - s.lo[k0] < 6) bands.push(['grass', s.lo[k0], s.ro[k0], s.lo[k1], s.ro[k1]]);   // (a verge)
    else if (s.sr > 0) { const m0 = Math.max(s.lo[k0], s.ro[k0] - 4.6), m1 = Math.max(s.lo[k1], s.ro[k1] - 4.6); bands.push(['grass', s.lo[k0], m0, s.lo[k1], m1], ['path', m0, s.ro[k0], m1, s.ro[k1]]); }
    else if (s.sr < 0) { const m0 = Math.min(s.ro[k0], s.lo[k0] + 4.6), m1 = Math.min(s.ro[k1], s.lo[k1] + 4.6); bands.push(['path', s.lo[k0], m0, s.lo[k1], m1], ['grass', m0, s.ro[k0], m1, s.ro[k1]]); }
    else bands.push(['grass', s.lo[k0], s.ro[k0], s.lo[k1], s.ro[k1]]);
    for (const [kind, l0, r0, l1, r1] of bands) {
      if (r0 - l0 < 0.01 && r1 - l1 < 0.01) continue;
      const C = (j, o) => [c.X[j] + c.NX[j] * o, c.Z[j] + c.NZ[j] * o];
      const p0 = clipBox([C(i, r0), C(i + 1, r1), C(i + 1, l1), C(i, l0)], ox, oz, ox + TILE, oz + TILE);
      if (p0.length < 3 || Math.abs(polyArea(p0)) < 1e-4) continue;
      // (another chain's paving crossing the band (a ramp beside a shore band, a carriageway under a deck's edge): cut out
      // of the deck's top, the paving drawn there instead)
      let pieces = [p0];
      if (s.kind === 'shore') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const q of p0) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
        const seen = new Set();
        for (let gx = Math.floor(x0 / CELL); gx <= Math.floor(x1 / CELL); gx++) for (let gz = Math.floor(z0 / CELL); gz <= Math.floor(z1 / CELL); gz++) {
          const L = GRID.get(gx * 100003 + gz); if (!L) continue;
          for (let k = 0; k < L.length; k += 2) {
            const o = HHP_CH[L[k]], j = L[k + 1];
            if (o === s.c || seen.has(L[k] * 100000 + j)) continue;
            seen.add(L[k] * 100000 + j);
            const Q = [[o.X[j] + o.NX[j] * (o.WR[j]), o.Z[j] + o.NZ[j] * (o.WR[j])], [o.X[j + 1] + o.NX[j + 1] * (o.WR[j + 1]), o.Z[j + 1] + o.NZ[j + 1] * (o.WR[j + 1])],
              [o.X[j + 1] - o.NX[j + 1] * (o.WL[j + 1]), o.Z[j + 1] - o.NZ[j + 1] * (o.WL[j + 1])], [o.X[j] - o.NX[j] * (o.WL[j]), o.Z[j] - o.NZ[j] * (o.WL[j])]];
            const next = []; for (const q of pieces) for (const r of subtractConvex(q, Q)) next.push(r); pieces = next;
            if (!pieces.length) break;
          }
        }
        // (and out of any other structure's footprint: a park deck or a stack reaching over the band's end)
        for (const { s: s2, Q } of boxQuads(x0, z0, x1, z1)) {
          if (s2 === s || !pieces.length) continue;
          const next = []; for (const q of pieces) for (const r of subtractConvex(q, Q)) next.push(r); pieces = next;
        }
      }
      for (const p of pieces) for (let k = 1; k + 1 < p.length; k++) for (const q of [p[0], p[k], p[k + 1]]) add[kind].push(q[0] - ox, topIn(s, i, q[0], q[1]), q[1] - oz);
    }
  }
  tile.__boxTop = add;   // (laid after the terrain's ground clamp, hhpAfterClamp: the deck stands over the drives by design)
  return cut;
}
// the deck tops of the FDR's structures, after the terrain's ground clamp (world/assemble.js, core/world/simTile.mjs)
export function hhpAfterClamp(tile) {
  const add = tile && tile.__boxTop;
  if (!add) return 0;
  tile.__boxTop = null;
  let n = 0;
  for (const [name, arr] of Object.entries(add)) {
    if (!arr.length) continue;
    const a = tile.S[name] || new Float32Array(0), m = new Float32Array(a.length + arr.length);
    m.set(a, 0); m.set(arr, a.length); tile.S[name] = m; n += arr.length / 9;
  }
  return n;
}
function dbgHas(tile, ox, oz, tag) {
  if (!globalThis.__HHP_DBG) return;
  const [x, z] = globalThis.__HHP_DBG, lx = x - ox, lz = z - oz;
  if (lx < 0 || lz < 0 || lx > TILE || lz > TILE) return;
  const o = {};
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b) continue;
    for (let i = 0; i + 8 < b.length; i += 9) {
      const ax = b[i], az = b[i + 2], bx = b[i + 3], bz = b[i + 5], cx = b[i + 6], cz = b[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-12) continue;
      const u = ((bz - cz) * (lx - cx) + (cx - bx) * (lz - cz)) / d, v = ((cz - az) * (lx - cx) + (ax - cx) * (lz - cz)) / d;
      if (u >= 0 && v >= 0 && u + v <= 1) (o[name] ||= []).push(+(b[i + 1] * u + b[i + 4] * v + b[i + 7] * (1 - u - v)).toFixed(2));
    }
  }
  console.log('[hhp has]', tag, JSON.stringify(o));
}
// the park decks over the covered FDR (the ground triangles haHoldDecks held on the drive's level, tile.p1Covered): now
// that the drive under them is built, on the deck's own level, the authority's grade there (the LiDAR's deck top), where
// that stands 3 m+ over them; the paved drive's own triangles were taken out with the compiled road
const DECKREL = new Map();
function deckRelAt(c, i) {
  let A = DECKREL.get(c);
  if (!A) {
    A = new Float32Array(c.n).fill(NaN);
    for (const q of c.structs) {
      if (q.kind !== 'under') continue;
      const i0 = Math.max(0, q.i0 - 3), i1 = Math.min(c.n - 1, q.i1 + 3), r = [];
      for (let k = i0; k <= i1; k++) { const g = haGradeAt(c.X[k], c.Z[k]); if (g !== null) r.push(g - c.Y[k]); }
      r.sort((a, b) => a - b);
      const m = r.length ? r[r.length >> 1] : NaN;
      for (let k = i0; k <= i1; k++) A[k] = m;
    }
    DECKREL.set(c, A);
  }
  return A[i];
}
// the shore aprons (flat infill behind a bulkhead) beside a covered drive, stretched by the terrain's lift between the
// drive's level and its deck's (a triangle rising 1 m+): out; the deck's edge walls and the clamped ground take their place
function dropCoverAprons(tile, ox, oz) {
  const a = tile.S.apron;
  if (!a || a.length < 9) return 0;
  const keep = [];
  let n = 0;
  for (let i = 0; i + 8 < a.length; i += 9) {
    const y0 = Math.min(a[i + 1], a[i + 4], a[i + 7]), y1 = Math.max(a[i + 1], a[i + 4], a[i + 7]);
    if (y1 - y0 > 1.0) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      if (hhpHits(cx, cz, 20).some((h) => h.c.structs.some((q) => q.kind === 'under' && h.i >= q.i0 - 8 && h.i <= q.i1 + 8))) { n++; continue; }
    }
    for (let k = 0; k < 9; k++) keep.push(a[i + k]);
  }
  if (n) tile.S.apron = Float32Array.from(keep);
  return n;
}
function liftCoveredDecks(tile, ox, oz) {
  const C = tile.p1Covered;
  // (no held deck triangles in the tile: the region's own ground (terrP1) over the drive is still the deck, regrown
  // pieces included)
  if (!HHP_CH.some((c) => c.structs.some((q) => q.kind === 'under'))) return 0;
  // (a drive under another carriageway (the stack at E 61st St) has that carriageway's deck over it, not a park deck)
  const underAt = (x, z) => { const hs = hhpHits(x, z, 0); return hs.find((h) => h.c.structs.some((q) => q.kind === 'under' && h.i >= q.i0 - 5 && h.i <= q.i1 + 5) && !hhpHits(x, z, 2).some((o) => o.c !== h.c && o.y > h.y + 2)); };
  let n = 0;
  for (const name of HA_GROUND.concat(['terrP1'])) {
    if (name === 'asphalt' || name.startsWith('paint')) continue;
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [], lifted = [];
    let any = 0;
    // (a deck triangle across the drive's edge is cut on it: the part over the drive goes up to the deck, the rest
    // stays; the kit's walls close the edge from the deck down to the ground beside it)
    // (the deck's level: one smooth level over each covered run, the drive's plus the median of the authority's grade over
    // it, the same the kit's edge walls and coping take)
    const lift = (arr) => { for (let k = 0; k + 2 < arr.length; k += 3) { const h = underAt(arr[k] + ox, arr[k + 2] + oz) || hhpHits(arr[k] + ox, arr[k + 2] + oz, 0.3).find((q) => deckRelAt(q.c, q.i) > 3); const r = h ? deckRelAt(h.c, h.i) : NaN; if (Number.isFinite(r) && r > 3) arr[k + 1] = h.c.Y[h.i] + (h.c.Y[Math.min(h.c.n - 1, h.i + 1)] - h.c.Y[h.i]) * h.t + r - (name === 'terrP1' ? 0.15 : 0); } return arr; };
    for (let i = 0; i + 8 < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3;
      const near = (C && C.has(`${Math.round(cx * 100)},${Math.round(cz * 100)}`)) || name === 'terrP1';
      const ins = [0, 3, 6].map((q) => !!underAt(a[i + q] + ox, a[i + q + 2] + oz));
      if (!near || !ins.some(Boolean)) { for (let k = 0; k < 9; k++) keep.push(a[i + k]); continue; }
      any++;
      if (ins.every(Boolean)) { lifted.push(...lift(Array.from(a.slice(i, i + 9)))); continue; }
      const pred = (px, pz) => !!underAt(px, pz);
      // (both halves cut on one boundary: 22 halvings leave no gap between them at the drive's edge)
      const outP = clipOff(a, i, ox, oz, (px, pz) => pred(px, pz), 0, 22), inP = clipOff(a, i, ox, oz, (px, pz) => !pred(px, pz), 0, 22);
      if (outP) for (const v of outP) keep.push(v);
      if (inP) lifted.push(...lift(Array.from(inP)));
    }
    if (any) { tile.S[name] = Float32Array.from(keep.concat(lifted)); n += any; }
  }
  return n;
}
function regrowGone(tile, ox, oz) {
  const g = tile.__hhpGone;
  tile.__hhpGone = null;
  if (!HA_P1 || !g || !g.length) return 0;   // (the flat city keeps its compiled ground as it was)
  // (only where no ground is drawn already: the pieces, split to 1 m, whose centre has no ground triangle of the tile)
  const G = new Map();
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b || b.length < 9) continue;
    for (let i = 0; i + 8 < b.length; i += 9) {
      const x0 = Math.min(b[i], b[i + 3], b[i + 6]), x1 = Math.max(b[i], b[i + 3], b[i + 6]), z0 = Math.min(b[i + 2], b[i + 5], b[i + 8]), z1 = Math.max(b[i + 2], b[i + 5], b[i + 8]);
      if (x1 - x0 > 200 || z1 - z0 > 200) continue;
      for (let gx = Math.floor(x0 / 2); gx <= Math.floor(x1 / 2); gx++) for (let gz = Math.floor(z0 / 2); gz <= Math.floor(z1 / 2); gz++) { const k = gx * 100003 + gz; let L = G.get(k); if (!L) G.set(k, (L = [])); L.push(b, i); }
    }
  }
  const covered = (x, z) => {   // (the lowest drawn ground over (x, z), or null)
    const L = G.get(Math.floor(x / 2) * 100003 + Math.floor(z / 2));
    let lo = null;
    if (!L) return null;
    for (let k = 0; k < L.length; k += 2) {
      const b = L[k], i = L[k + 1];
      const ax = b[i], az = b[i + 2], bx = b[i + 3], bz = b[i + 5], cx = b[i + 6], cz = b[i + 8];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
      if (Math.abs(d) < 1e-9) continue;
      const u = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, v = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
      if (u >= -1e-4 && v >= -1e-4 && u + v <= 1 + 1e-4) { const y = b[i + 1] * u + b[i + 4] * v + b[i + 7] * (1 - u - v); if (lo === null || y < lo) lo = y; }
    }
    return lo;
  };
  const out = [], outG = [];
  // (a piece in the open beside a lawn comes back as lawn, the lawn's own sward; else as the base)
  const GR = new Set();
  if (tile.S.grass) { const b = tile.S.grass; for (let i = 0; i + 8 < b.length; i += 9) GR.add(Math.floor((b[i] + b[i + 3] + b[i + 6]) / 18) * 100003 + Math.floor((b[i + 2] + b[i + 5] + b[i + 8]) / 18)); }
  const lawnNear = (x, z) => { const gx = Math.floor(x / 6), gz = Math.floor(z / 6); for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (GR.has((gx + a) * 100003 + gz + c)) return true; return false; };
  const emit = (P, d) => {
    const e = Math.max(Math.hypot(P[0][0] - P[1][0], P[0][2] - P[1][2]), Math.hypot(P[1][0] - P[2][0], P[1][2] - P[2][2]), Math.hypot(P[2][0] - P[0][0], P[2][2] - P[0][2]));
    if (d < 6 && e > 1.0) {
      const m = (a, b) => [(a[0] + b[0]) / 2, 0, (a[2] + b[2]) / 2];
      const ab = m(P[0], P[1]), bc = m(P[1], P[2]), ca = m(P[2], P[0]);
      emit([P[0], ab, ca], d + 1); emit([ab, P[1], bc], d + 1); emit([ca, bc, P[2]], d + 1); emit([ab, bc, ca], d + 1);
      return;
    }
    // (every piece comes back, 0.10 m under the grade and under any ground drawn over it: no sliver of hole, no fight)
    const cx = (P[0][0] + P[1][0] + P[2][0]) / 3, cz = (P[0][2] + P[1][2] + P[2][2]) / 3;
    // (under a chain's paving: base 0.15 m under that paving, never a lawn a few cm under it)
    const hs = hhpHits(cx + ox, cz + oz, 0.1);
    const dst = !hs.length && covered(cx, cz) === null && lawnNear(cx, cz) ? outG : out;
    for (const p of P) {
      const g0 = haGradeAt(p[0] + ox, p[2] + oz), gc = covered(p[0], p[2]);
      let y = g0 !== null && Number.isFinite(g0) ? g0 : 3.24;
      if (gc !== null) y = Math.min(y, gc);
      for (const h of hs) if (Math.abs(h.y - y) < 1.0) y = Math.min(y, h.y - 0.05);
      dst.push(p[0], y - (dst === outG ? 0.03 : 0.10), p[2]);
    }
  };
  for (let i = 0; i + 8 < g.length; i += 9) emit([[g[i], 0, g[i + 2]], [g[i + 3], 0, g[i + 5]], [g[i + 6], 0, g[i + 8]]], 0);
  if (!out.length && !outG.length) return 0;
  for (const [name, arr] of [['terrP1', out], ['grass', outG]]) {
    if (!arr.length) continue;
    const old = tile.S[name];
    const n = new Float32Array((old ? old.length : 0) + arr.length);
    if (old) n.set(old);
    n.set(arr, old ? old.length : 0);
    tile.S[name] = n;
  }
  tile.__hhpGone = null;
  return (out.length + outG.length) / 9;
}
// a convex polygon [[x, z] ..] clipped to the box x0..x1, z0..z1
function clipBox(P, x0, z0, x1, z1) {
  const ax = (Q, k, v, keepLess) => {
    const out = [];
    for (let j = 0; j < Q.length; j++) {
      const p = Q[j], q = Q[(j + 1) % Q.length], fp = keepLess ? v - p[k] : p[k] - v, fq = keepLess ? v - q[k] : q[k] - v;
      if (fp >= 0) out.push(p);
      if ((fp >= 0) !== (fq >= 0)) { const u = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u]); }
    }
    return out;
  };
  let Q = P;
  for (const [k, v, lt] of [[0, x0, false], [0, x1, true], [1, z0, false], [1, z1, true]]) { Q = ax(Q, k, v, lt); if (Q.length < 3) return []; }
  return Q;
}
// convex P less convex C: the convex pieces of P outside C
function subtractConvex(P, C) {
  // quick reject: bounding boxes apart
  let px0 = Infinity, px1 = -Infinity, pz0 = Infinity, pz1 = -Infinity, cx0 = Infinity, cx1 = -Infinity, cz0 = Infinity, cz1 = -Infinity;
  for (const p of P) { px0 = Math.min(px0, p[0]); px1 = Math.max(px1, p[0]); pz0 = Math.min(pz0, p[1]); pz1 = Math.max(pz1, p[1]); }
  for (const p of C) { cx0 = Math.min(cx0, p[0]); cx1 = Math.max(cx1, p[0]); cz0 = Math.min(cz0, p[1]); cz1 = Math.max(cz1, p[1]); }
  if (px1 <= cx0 || cx1 <= px0 || pz1 <= cz0 || cz1 <= pz0) return [P];
  const Cc = polyArea(C) < 0 ? C.slice().reverse() : C;   // counter-clockwise in (x, z): inside = left of each edge
  const out = [];
  let rem = P;
  for (let k = 0; k < Cc.length && rem.length; k++) {
    const a = Cc[k], b = Cc[(k + 1) % Cc.length];
    const outside = clipHalf(rem, a, b, -1);
    if (outside.length && Math.abs(polyArea(outside)) > 1e-4) out.push(outside);
    rem = clipHalf(rem, a, b, 1);
  }
  return out;
}
function inTri(a, t, x, z) {
  const x0 = a[t], z0 = a[t + 2], x1 = a[t + 3], z1 = a[t + 5], x2 = a[t + 6], z2 = a[t + 8];
  const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
  if (Math.abs(d) < 1e-12) return false;
  const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, v = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
  return u >= 0 && v >= 0 && u + v <= 1;
}
function triY(a, t, x, z) {
  const x0 = a[t], z0 = a[t + 2], x1 = a[t + 3], z1 = a[t + 5], x2 = a[t + 6], z2 = a[t + 8];
  const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);
  const u = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d, v = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
  return a[t + 1] * u + a[t + 4] * v + a[t + 7] * (1 - u - v);
}

// the road records: each chain's centre line every 2 m on its profile, split at this tile's border and at every junction
// (a ramp's end on the chain), appended as level-1 records (no walkers line them)
function addRecords(tile, ox, oz) {
  const names = tile.header.names || (tile.header.names = []);
  const nameIdx = (s) => { let i = names.indexOf(s); if (i < 0) { i = names.length; names.push(s); } return i; };
  const cuts = new Map();   // chain id -> station indices where a ramp joins
  for (const c of HHP_CH) c.ends.forEach((e) => { if (e.type === 'chain') { const a = cuts.get(e.chain) || []; a.push(e.i); cuts.set(e.chain, a); } });
  const recs = [], verts = [];
  let base = tile.S.roadVerts ? tile.S.roadVerts.length / 3 : 0;
  for (const c of HHP_CH) {
    const brk = new Set(cuts.get(c.id) || []);
    const pt = (i) => [c.X[i], c.Y[i], c.Z[i]];
    let cur = [];
    const flush = () => {
      if (cur.length >= 2 && polyLen(cur.map((p) => [p[0], p[1], p[2]])) >= 1.0) {
        // (its width: the paving's at the piece's middle station, so the traffic's lanes lie on it)
        const mid = cur[Math.floor(cur.length / 2)];
        let jm = 0, bd = Infinity;
        for (let q = 0; q < c.n; q += 1) { const d = (c.X[q] - mid[0]) ** 2 + (c.Z[q] - mid[2]) ** 2; if (d < bd) { bd = d; jm = q; } }
        recs.push({ start: base, len: cur.length, c, w: c.WL[jm] + c.WR[jm] });
        for (const p of cur) verts.push(p[0] - ox, p[1], p[2] - oz);
        base += cur.length;
      }
      cur = [];
    };
    // a compiled end: the kept road's end it meets (the compile trims a road back from the junction by its mouth, up to
    // 20 m; the traffic joins ends within 12 m) is added to the line, so the ramp leads onto it
    const ext = [null, null];
    c.ends.forEach((e, k) => {
      if (e.type !== 'compiled' && e.type !== 'splice') return;
      const i = k === 0 ? 0 : c.n - 1, p = pt(i);
      if (!owns(ox, oz, p[0], p[2])) return;
      let best = null;
      for (const r of roadsOf(tile)) {
        if (r.segId >= HHP_SEG0 || r.rclass === 5 || r.rclass === 6) continue;
        for (const j of [0, r.len - 1]) {
          const q = [tile.S.roadVerts[(r.start + j) * 3] + ox, tile.S.roadVerts[(r.start + j) * 3 + 1], tile.S.roadVerts[(r.start + j) * 3 + 2] + oz];
          const d = Math.hypot(q[0] - p[0], q[2] - p[2]), dy = Math.abs(q[1] - p[1]);
          if (d < 20 && dy < 1.0 && (!best || dy + 0.02 * d < best[1])) best = [q, dy + 0.02 * d, d];
        }
      }
      if (best && best[2] > 0.5) ext[k] = best[0];
    });
    // a connector runs on the junction's paving as drawn: every 2 m at the laid asphalt's height nearest the straight line
    const conn = (from, to) => {
      const L = Math.hypot(to[0] - from[0], to[2] - from[2]), n = Math.max(1, Math.ceil(L / 2)), out = [];
      for (let k = 1; k < n; k++) {
        const u = k / n, p = [from[0] + (to[0] - from[0]) * u, from[1] + (to[1] - from[1]) * u, from[2] + (to[2] - from[2]) * u];
        const y = laidY(tile, ox, oz, p[0], p[2], p[1]);
        out.push([p[0], y !== null && Math.abs(y - p[1]) < 0.8 ? y : p[1], p[2]]);
      }
      return out;
    };
    const isJ = (k) => c.ends[k] && c.ends[k].type === 'compiled';   // (a splice's connector is straight: both ends meet)
    if (ext[0]) { cur.push(ext[0]); if (isJ(0)) for (const q of conn(ext[0], pt(0))) cur.push(q); }
    for (let i = 0; i < c.n; i++) {
      const p = pt(i), inT = owns(ox, oz, p[0], p[2]);
      if (i > 0) {
        const q = pt(i - 1), inQ = owns(ox, oz, q[0], q[2]);
        if (inT !== inQ) {
          // the crossing of the tile's border (the same point from both tiles)
          const u = borderT(q, p, ox, oz);
          const m = [q[0] + (p[0] - q[0]) * u, q[1] + (p[1] - q[1]) * u, q[2] + (p[2] - q[2]) * u];
          cur.push(m);
          if (inQ) flush(); else cur = [m];
        }
      }
      if (inT) {
        cur.push(p);
        if (brk.has(i) && i > 0 && i < c.n - 1) { flush(); cur = [p]; }
      }
    }
    if (ext[1] && cur.length) { if (isJ(1)) for (const q of conn(pt(c.n - 1), ext[1])) cur.push(q); cur.push(ext[1]); }
    flush();
  }
  if (!recs.length) return 0;
  const RV = tile.S.roadVerts || new Float32Array(0), n = new Float32Array(RV.length + verts.length);
  n.set(RV); n.set(verts, RV.length);
  tile.S.roadVerts = n;
  const old = tile.S.roads && tile.S.roads.byteLength ? new Uint8Array(tile.S.roads.buffer, tile.S.roads.byteOffset, tile.S.roads.byteLength) : new Uint8Array(0);
  const m = new Uint8Array(old.byteLength + recs.length * 24);
  m.set(old);
  const dv = new DataView(m.buffer);
  recs.forEach((r, k) => {
    const o = old.byteLength + k * 24, c = r.c, i = 0;
    dv.setUint32(o, r.start, true); dv.setUint16(o + 4, r.len, true);
    dv.setUint8(o + 6, c.kind === 'main' ? 3 : 4); dv.setInt8(o + 7, 1);
    dv.setFloat32(o + 8, Math.max(3.5, r.w), true);
    dv.setUint8(o + 12, c.lanes); dv.setUint8(o + 13, 0); dv.setUint8(o + 14, 1); dv.setUint8(o + 15, Math.min(255, c.speed));
    dv.setUint16(o + 16, nameIdx(c.name || (c.kind === 'main' ? 'HENRY HUDSON PKWY' : 'HENRY HUDSON PKWY RAMP ' + c.id)), true);
    dv.setUint8(o + 18, 0); dv.setUint8(o + 19, 0);
    dv.setUint32(o + 20, HHP_SEG0 + HHP_CH.indexOf(c), true);
  });
  tile.S.roads = m;
  return recs.length;
}
// the laid asphalt's height at (x, z) nearest yRef (the tile's section, tile-local), or null
function laidY(tile, ox, oz, x, z, yRef) {
  const a = tile.S.asphalt;
  if (!a) return null;
  let best = null;
  for (let t = 0; t + 8 < a.length; t += 9) {
    if (!inTri(a, t, x - ox, z - oz)) continue;
    const y = triY(a, t, x - ox, z - oz);
    if (best === null || Math.abs(y - yRef) < Math.abs(best - yRef)) best = y;
  }
  return best;
}
function borderT(q, p, ox, oz) {
  let u = 1;
  for (const [a, lo, hi] of [[0, ox, ox + TILE], [2, oz, oz + TILE]]) {
    const d = p[a] - q[a];
    if (Math.abs(d) < 1e-9) continue;
    for (const b of [lo, hi]) { const t = (b - q[a]) / d; if (t > 0 && t < u && (q[a] < b) !== (p[a] < b)) u = t; }
  }
  return u;
}

// under the terrain flag, the ground meets the paving: the region's drawn base (tile.S.terrP1) is held 0.15 m under the
// paving inside its width, and every ground section's vertex (the base, lawns, paths, walks) within 2 m outside a paved
// edge is moved by the edge's difference from the authority's grade, faded out over those 2 m (the fitted profile and the
// TIN's design grade differ by up to a few decimetres); not where they differ by more than 0.6 m (a wall stands there: its
// face is the ground's), nor along a deck
function blendGround(tile, ox, oz) {
  let n = 0;
  // the base under the paving: its triangles cut along the paving's edge and the part under it dropped (where the base
  // lies within 2 m under the paving: not the ground under a deck); the edge's skirt closes the step
  let B0 = tile.S.terrP1;
  if (B0 && B0.length >= 9) {
    // (not past a chain's first or last station: its paving is drawn to there and no further)
    const under = (x, z, y) => hhpHits(x, z, -0.02).some((h) => y > h.y - 2.0 && y < h.y + 0.6 && !(h.i === 0 && h.tr < 0) && !(h.i === h.c.n - 2 && h.tr > 1));
    // (a triangle touching the paving is split to 1 m first: a narrow gap between two pavings, the strip between the
    // carriageways or a gore, keeps its ground instead of going with a triangle whose corners all lie on paving)
    const fine = [];
    const sub = (P, d) => {
      const e = Math.max(Math.hypot(P[0][0] - P[1][0], P[0][2] - P[1][2]), Math.hypot(P[1][0] - P[2][0], P[1][2] - P[2][2]), Math.hypot(P[2][0] - P[0][0], P[2][2] - P[0][2]));
      const uv = P.map((p) => under(p[0] + ox, p[2] + oz, p[1]));
      const mids = [[0, 1], [1, 2], [2, 0]].map(([a2, b2]) => [(P[a2][0] + P[b2][0]) / 2, (P[a2][1] + P[b2][1]) / 2, (P[a2][2] + P[b2][2]) / 2]).concat([[(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3]]);
      const mu = mids.map((p) => under(p[0] + ox, p[2] + oz, p[1]));
      const straddle = (uv.some(Boolean) && !uv.every(Boolean)) || (uv.every(Boolean) && mu.some((v) => !v)) || (!uv.some(Boolean) && mu.some(Boolean));   // (or across a gap between two pavings, or a paving's tip in it)
      if (d < 9 && ((e > 1.0 && (uv.some(Boolean) || mu.some(Boolean))) || (straddle && e > 0.3))) {   // (an edge's pieces to 0.3 m: a corner of paving cuts no ground off past it)
        const m = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const ab = m(P[0], P[1]), bc = m(P[1], P[2]), ca = m(P[2], P[0]);
        sub([P[0], ab, ca], d + 1); sub([ab, P[1], bc], d + 1); sub([ca, bc, P[2]], d + 1); sub([ab, bc, ca], d + 1);
        return;
      }
      for (const p of P) fine.push(p[0], p[1], p[2]);
    };
    if (globalThis.__HHP_DBG) { const [qx, qz] = globalThis.__HHP_DBG; console.log('[hhp under]', under(qx, qz, 13.46), hhpHits(qx, qz, 0).map((h) => h.c.id + ' ' + h.y.toFixed(2) + ' o' + h.o.toFixed(2) + ' i' + h.i).join(' ')); }
    for (let i = 0; i + 8 < B0.length; i += 9) sub([[B0[i], B0[i + 1], B0[i + 2]], [B0[i + 3], B0[i + 4], B0[i + 5]], [B0[i + 6], B0[i + 7], B0[i + 8]]], 0);
    if (fine.length !== B0.length) { B0 = Float32Array.from(fine); tile.S.terrP1 = B0; }
    dbgHas(tile, ox, oz, 'after fine');
    const keep = [];
    let cut = 0;
    for (let i = 0; i + 8 < B0.length; i += 9) {
      const cl = clipOff(B0, i, ox, oz, under, 0);
      if (cl) { cut++; for (const q of cl) keep.push(q); continue; }
      const cx = (B0[i] + B0[i + 3] + B0[i + 6]) / 3 + ox, cz = (B0[i + 2] + B0[i + 5] + B0[i + 8]) / 3 + oz, cy = (B0[i + 1] + B0[i + 4] + B0[i + 7]) / 3;
      if (globalThis.__HHP_DBG && Math.hypot(cx - globalThis.__HHP_DBG[0], cz - globalThis.__HHP_DBG[1]) < 2) console.log('[hhp base]', cx.toFixed(1), cz.toFixed(1), cy.toFixed(2), 'under', under(cx, cz, cy), hhpHits(cx, cz, -0.02).map((h) => h.c.id + ' ' + h.y.toFixed(2) + ' o' + h.o.toFixed(2)).join(' '));
      if (under(cx, cz, cy) && [0, 3, 6].every((q) => under(B0[i + q] + ox, B0[i + q + 2] + oz, B0[i + q + 1]))) { cut++; continue; }   // (a piece with a corner off the paving stays: no hole round a paving's tip)
      for (let k = 0; k < 9; k++) keep.push(B0[i + k]);
    }
    if (cut) { tile.S.terrP1 = Float32Array.from(keep); n += cut; }
    dbgHas(tile, ox, oz, 'after base cut');
  }
  const deckAt = (c, i) => c.structs.some((q) => (q.kind !== 'cover' && q.kind !== 'under') && i >= q.i0 - 1 && i <= q.i1 + 1);
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b || b.length < 9) continue;
    let out = null;
    for (let k = 0; k + 2 < b.length; k += 3) {
      const x = b[k] + ox, z = b[k + 2] + oz, y = b[k + 1];
      const md = name === 'terrP1' ? hhpMedianAt(x, z) : null;
      if (md && y > md.y - 0.15 && y < md.y + 1.5) { if (!out) out = Float32Array.from(b); out[k + 1] = md.y - 0.15; n++; continue; }
      if (name === 'terrP1') {
        // under any paving (decks too): 0.15 m under it; in its first 0.6 m outside an edge: under the edge's skirt
        const hin = hhpHits(x, z, -0.05).filter((h) => y > h.y - 0.15 && y < h.y + 1.5)[0];
        if (hin) { if (!out) out = Float32Array.from(b); out[k + 1] = hin.y - 0.15; n++; continue; }
        const hn = hhpHits(x, z, 0.6).filter((h) => y > h.y - 0.4 && y < h.y + 1.5)[0];
        if (hn && deckAt(hn.c, hn.i)) {
          const w = hn.o > 0 ? hn.c.WR[hn.i] : hn.c.WL[hn.i], d = Math.abs(hn.o) - w;
          const lim = hn.y - 0.15 + 0.25 * Math.max(0, d);
          if (y > lim) { if (!out) out = Float32Array.from(b); out[k + 1] = lim; n++; continue; }
        }
      }
      const hs = hhpHits(x, z, 2.0).filter((h) => Math.abs(h.y - y) < 1.5 && !deckAt(h.c, h.i));
      if (!hs.length) continue;
      const h = hs.reduce((m, q) => (Math.abs(q.y - y) < Math.abs(m.y - y) ? q : m));
      const c = h.c, w = h.o > 0 ? c.WR[h.i] : c.WL[h.i], d = Math.abs(h.o) - w;
      let ny = y;
      if (d <= 0) { if (name === 'terrP1' && y > h.y - 0.15) ny = h.y - 0.15; }
      else {
        const sg = h.o > 0 ? 1 : -1, ex = c.X[h.i] + c.NX[h.i] * sg * w, ez = c.Z[h.i] + c.NZ[h.i] * sg * w;
        const g = haGradeAt(ex, ez), yE = c.Y[h.i] + c.E[h.i] * sg * w;
        if (g === null || Math.abs(yE - g) > 0.6) continue;
        const u = Math.min(1, d / 2), f = 1 - u * u * (3 - 2 * u);
        ny = y + (yE - g) * f;
        if (name === 'terrP1' && d < 0.6) ny = Math.min(ny, yE - 0.15 + 0.25 * d);   // (the base's first 0.6 m out stays under the edge's skirt)
      }
      if (ny !== y) { if (!out) out = Float32Array.from(b); out[k + 1] = ny; n++; }
    }
    if (out) tile.S[name] = out;
  }
  // the corridor's rule, by construction: no ground over the paving (0.15 m under it inside its width) and none over an
  // edge's level within 1.5 m outside it (a parapet, rail or kerb stands on that edge; the ground meets its foot), up to
  // 6 m over the paving (a deck's ground far under it and the hills past 1.5 m keep their levels)
  dbgHas(tile, ox, oz, 'before clamp'); const nc = clampCorridor(tile, ox, oz); dbgHas(tile, ox, oz, 'after clamp');
  return n + nc;
}
// hhpHits, and outside a bend (a point past both neighbouring segments' ends) the nearest station's own section
function hitsWide(x, z, margin) {
  const hs = hhpHits(x, z, margin);
  const L = GRID.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!L) return hs;
  for (let k = 0; k < L.length; k += 2) {
    const c = HHP_CH[L[k]], j = L[k + 1];
    if (hs.some((h) => h.c === c)) continue;
    const dx = x - c.X[j], dz = z - c.Z[j], o = dx * c.NX[j] + dz * c.NZ[j], along = dx * c.TX[j] + dz * c.TZ[j];
    if (Math.abs(along) > 1.5 || o < -c.WL[j] - margin || o > c.WR[j] + margin) continue;
    hs.push({ c, i: Math.min(j, c.n - 2), t: 0, o, y: c.Y[j] + c.E[j] * o });
  }
  return hs;
}
function clampCorridor(tile, ox, oz) {
  let n = 0;
  // (a large ground triangle reaching over the band, its corners all outside it: split to 2 m first, so the band's lines
  // below cut it; a lawn spanning a narrow cut keeps no part over the paving's edge)
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b || b.length < 9) continue;
    const near = (x, z, y) => hitsWide(x + ox, z + oz, 3.0).some((h) => y > h.y - 3 && y < h.y + 15);
    const outA = [];
    let any = 0;
    const sub = (P, d) => {
      const e = Math.max(Math.hypot(P[0][0] - P[1][0], P[0][2] - P[1][2]), Math.hypot(P[1][0] - P[2][0], P[1][2] - P[2][2]), Math.hypot(P[2][0] - P[0][0], P[2][2] - P[0][2]));
      const bandV = P.map((p) => hitsWide(p[0] + ox, p[2] + oz, 1.5).some((h) => p[1] > h.y - 3 && p[1] < h.y + 15));
      const strad = bandV.some(Boolean) && !bandV.every(Boolean);
      if (d < 9 && (e > 2.0 || (strad && e > 0.3))) {   // (a piece across the band's line to 0.3 m: no edge crosses it twice)
        const m = (a, c) => [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
        const ab = m(P[0], P[1]), bc = m(P[1], P[2]), ca = m(P[2], P[0]), ce = [(P[0][0] + P[1][0] + P[2][0]) / 3, (P[0][1] + P[1][1] + P[2][1]) / 3, (P[0][2] + P[1][2] + P[2][2]) / 3];
        if (strad || [...P, ab, bc, ca, ce].some((p) => near(p[0], p[2], p[1]))) {
          any++;
          sub([P[0], ab, ca], d + 1); sub([ab, P[1], bc], d + 1); sub([ca, bc, P[2]], d + 1); sub([ab, bc, ca], d + 1);
          return;
        }
      }
      for (const p of P) outA.push(p[0], p[1], p[2]);
    };
    for (let i = 0; i + 8 < b.length; i += 9) {
      const e = Math.max(Math.hypot(b[i] - b[i + 3], b[i + 2] - b[i + 5]), Math.hypot(b[i + 3] - b[i + 6], b[i + 5] - b[i + 8]), Math.hypot(b[i + 6] - b[i], b[i + 8] - b[i + 2]));
      if (e <= 0.3) { for (let k = 0; k < 9; k++) outA.push(b[i + k]); continue; }
      sub([[b[i], b[i + 1], b[i + 2]], [b[i + 3], b[i + 4], b[i + 5]], [b[i + 6], b[i + 7], b[i + 8]]], 0);
    }
    if (any) tile.S[name] = Float32Array.from(outA);
  }
  // (a triangle crossing the band's outer line is split on it first, so the clamp below is exact inside the band)
  for (const MB of [1.5, 0.8]) {   // (split on the band's line, then on the flat verge's)
  const inBand = (x, z, y) => hitsWide(x, z, MB).some((h) => y > h.y - 3 && y < h.y + 15);
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b || b.length < 9) continue;
    const pieces = [];
    let split = 0;
    for (let i = 0; i + 8 < b.length; i += 9) {
      const P = [0, 1, 2].map((k) => [b[i + k * 3] + ox, b[i + k * 3 + 1], b[i + k * 3 + 2] + oz]);
      const ins = P.map((p) => inBand(p[0], p[2], p[1]));
      if (ins.every(Boolean) || !ins.some(Boolean)) { for (let k = 0; k < 9; k++) pieces.push(b[i + k]); continue; }
      split++;
      for (const want of [true, false]) {
        const poly = [];
        for (let k = 0; k < 3; k++) {
          const p = P[k], q = P[(k + 1) % 3];
          if (ins[k] === want) poly.push(p);
          if (ins[k] !== ins[(k + 1) % 3]) {
            let u0 = 0, u1 = 1;
            for (let it = 0; it < 10; it++) { const u = (u0 + u1) / 2, m = [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]; if (inBand(m[0], m[2], m[1]) === ins[k]) u0 = u; else u1 = u; }
            const u = (u0 + u1) / 2;
            poly.push([p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u, p[2] + (q[2] - p[2]) * u]);
          }
        }
        for (let k = 1; k + 1 < poly.length; k++) for (const p of [poly[0], poly[k], poly[k + 1]]) pieces.push(p[0] - ox, p[1], p[2] - oz);
      }
    }
    if (split) tile.S[name] = Float32Array.from(pieces);
  }
  }
  for (const name of HA_GROUND.concat(['terrP1'])) {
    const b = tile.S[name];
    if (!b || b.length < 9) continue;
    let out = null;
    for (let k = 0; k + 2 < b.length; k += 3) {
      const x = b[k] + ox, z = b[k + 2] + oz, y = b[k + 1];
      let lim = Infinity;
      // (a deck point over another covered drive (the paired carriageway beside, under the same deck) is that drive's
      // roof, not ground beside this one's edge)
      const overDrive = hitsWide(x, z, 0.3).some((o) => y > o.y + 2.5 && Math.abs(o.o) <= (o.o > 0 ? o.c.WR[o.i] : o.c.WL[o.i]) + 0.3 && o.c.structs.some((q) => q.kind === 'under' && o.i >= q.i0 - 8 && o.i <= q.i1 + 8));
      // (beside a covered drive's open deck edge (the deck 3 m+ up, the ground outside under the deck's level): the
      // ground held at the drive's edge level for 6 m, the kit's edge wall rising from it to the deck's coping)
      if (!overDrive) for (const h of hitsWide(x, z, 6)) {
        const w = h.o > 0 ? h.c.WR[h.i] : h.c.WL[h.i], d = Math.abs(h.o) - w;
        if (d <= 0.3 || y < h.y - 3 || y > h.y + 15) continue;
        const r = deckRelAt(h.c, h.i);
        if (!(r > 3)) continue;
        // (the open side: 8 m past the edge the ground is under the deck's level (the esplanade, the river), whatever
        // the bare earth reads at the edge itself, where it is the deck's)
        const sg = Math.sign(h.o || 1), ex = h.c.X[h.i] + h.c.NX[h.i] * sg * (w + 8), ez = h.c.Z[h.i] + h.c.NZ[h.i] * sg * (w + 8);
        const g = haGradeAt(ex, ez);
        // (or another carriageway on the drive's level within 12 m on that side: the ground between them is the
        // drives' level, the deck's edge wall stands at the covered one's edge)
        const between = hitsWide(x, z, 12).some((o) => o.c !== h.c && Math.abs(o.y - h.y) < 1.5 && Math.abs(o.o) > (o.o > 0 ? o.c.WR[o.i] : o.c.WL[o.i]));
        if (g === null || g < h.c.Y[h.i] + r - 2 || between) lim = Math.min(lim, h.y + h.c.E[h.i] * (sg * w - h.o) - 0.05);
      }
      if (!overDrive) for (const h of hitsWide(x, z, 1.5)) {
        if (y < h.y - 3 || y > h.y + 15 || (y > h.y + 6 && h.c.structs.some((q) => q.kind === 'cover' && h.i >= q.i0 && h.i <= q.i1)) || (y > h.y + 2.5 && Math.abs(h.o) <= (h.o > 0 ? h.c.WR[h.i] : h.c.WL[h.i]) + 0.3 && h.c.structs.some((q) => q.kind === 'under' && h.i >= q.i0 - 8 && h.i <= q.i1 + 8))) continue;   // (over the drive only: beside it the deck's edge is the kit's wall, the ground there keeps the rule)   // (the covered drive: the park deck over it stays)   // (a cut 15 m deep at most; a cover's deck over it keeps its ground)
        const w = h.o > 0 ? h.c.WR[h.i] : h.c.WL[h.i], d = Math.abs(h.o) - w;
        const yE = h.y + h.c.E[h.i] * (Math.sign(h.o || 1) * w - h.o);   // (the edge's level at this point along the chain, not at the station)
        lim = Math.min(lim, d <= 0 ? h.y - 0.15 : yE + (name === 'terrP1' ? -0.05 : 0.08) + Math.max(0, d - 0.8) * 8);   // (past 0.8 m the bank may rise: steeply, to the band's line)   // (a lawn or walk: the city's kerb reveal over the road)
      }
      if (globalThis.__HHP_DBG && Math.hypot(x - globalThis.__HHP_DBG[0], z - globalThis.__HHP_DBG[1]) < 3) console.log('[hhp clamp]', name, x.toFixed(1), z.toFixed(1), y.toFixed(2), 'lim', lim, 'hits', hitsWide(x, z, 1.5).map((h) => h.c.id + ' ' + h.y.toFixed(2) + ' o' + h.o.toFixed(2)).join(' '));
      if (y > lim) { if (!out) out = Float32Array.from(b); out[k + 1] = lim; n++; }
    }
    if (out) tile.S[name] = out;
  }
  return n;
}
