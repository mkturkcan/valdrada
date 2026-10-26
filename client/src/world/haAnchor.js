// P1 TERRAIN, re-anchoring (part 2 of phase 1b): the authored geometry that was built at the flat city's heights (the
// Columbia kit, viaducts, bridges, Central Park's structures, furniture, parked cars, colliders) stands on the height
// authority's ground instead. Behind the same flag as world/heightAuthority.js (`?terrain=p1` / TERRAIN_P1=1); off, every
// function here returns its input unchanged and nothing is fetched.
//
//   haPreload(x0, z0, x1, z1)   loads the authority's chunks over a box, so the synchronous queries below answer (the
//                               builders that run once at boot: campus, elevated rail, bridges)
//   haLift(x, z)                the metres to add to something the flat compile stood at (x, z): the relief less the
//                               Columbia pad it was compiled on (compile.mjs padAt, ported below), 0 outside the region
//   haFootY(y, x, z)            y + haLift(x, z)
//   haDeckY(id, s) / haProfile  a structure's deck profile (registry anchors.json: LiDAR class-17 deck heights along its
//                               alignment, NAVD88, mapped to world y through the membrane S), by station
//   haFoot(cls, id, ...)        records a footing for the anchor gate (tools/terrain/anchor_gate.mjs); a no-op when the
//                               gate is not running
// Data: client/public/data/terrain_p1a/anchors.json (built by the terrain round's p2b_profiles.py, outside the repository).
import { HA_P1, HA_BASE, HA_ASPHALT, HA_GROUND, haInit, haTileReady, haRelief, haInfo, haInfoIn, haInRegion, haInCampus, haS, haInCentralPark } from './heightAuthority.js';
import { roadsOf } from './tiledata.js';

export const HA_ON = HA_P1;
const TILE = 512;
const isNode = typeof process !== 'undefined' && !!(process.versions && process.versions.node) && typeof window === 'undefined';

export async function haPreload(x0, z0, x1, z1) {
  if (!HA_ON || !(await haInit())) return false;
  const ps = [];
  for (let tz = Math.floor(z0 / TILE); tz <= Math.floor(z1 / TILE); tz++) for (let tx = Math.floor(x0 / TILE); tx <= Math.floor(x1 / TILE); tx++) ps.push(haTileReady(tx, tz, true));   // (the relief only: a tile's grade data loads with the tile)
  await Promise.all(ps);
  return true;
}

// ---------------------------------------------------------------- Columbia's McKim pads in the flat compile
// compile.mjs padAt (FLAT): the terrain level the compile laid inside the Morningside superblock, as metres over the flat
// base (3.24); 0 outside it. The authority takes the same pads off the compiled sections (heightAuthority.js padOf, from
// the tile's grid); this is the analytic form, for builders that run before any tile is in.
const PAD_AX = 0.465, PAD_AZ = -0.885, ALMA = [764.23, -2747.81], SHIFT = -36.84, BASE = 3.24;
const PADS = [
  { a0: -23.7, a1: -17.2, halfB: 58.6, bMin: 40.2, y: 41.15, y1: 46.65, rampC: true, c0: 40.5, c1: 53.9 },
  { a0: -6.2, a1: 11, halfB: 29.5, y: 41.15, y1: 46.65 },
  { a0: -40.4, a1: -19, halfB: 92, bMin: 58.4, y: 46.9 },
  { a0: -19, a1: 21, halfB: 400, bMin: 58.4, y: 46.9 },
  { a0: -48, a1: -1.5, halfB: 58.4, y: 41.4 },
  { a0: -1.5, a1: 92, halfB: 400, y: 46.9 },
  { a0: -48, a1: -40.4, halfB: 400, bMin: 54, y: 40.2 },
  { a0: -40.4, a1: -19, halfB: 400, bMin: 92, y: 40.2 },
  { a0: 92, a1: 400, halfB: 400, y: 46.9 },
].map((p) => ({ am: (p.a0 + p.a1) / 2, halfA: (p.a1 - p.a0) / 2, halfB: p.halfB, bMin: p.bMin || 0, y: p.y, y1: p.y1, rampC: !!p.rampC, c0: p.c0, c1: p.c1 }));
const RECT = { cW: (a) => -96.0 + 0.0208 * a, cE: (a) => 119.0 + 0.0205 * a, aS: (c) => -209.0 - 0.0227 * c, aN: (c) => 252.0 - 0.0210 * c };
export function campusPadAt(x, z) {
  const dx = x - ALMA[0], dz = z - ALMA[1];
  const aW = dx * PAD_AX + dz * PAD_AZ, cW = dx * -PAD_AZ + dz * PAD_AX;
  const dIn = Math.min(aW - RECT.aS(cW), RECT.aN(cW) - aW, cW - RECT.cW(aW), RECT.cE(aW) - cW);
  if (dIn <= 0) return 0;
  const aSh = aW + 0.0234 * cW;
  let lvl;
  if (aSh < -63.3) lvl = 39.7;
  else if (aSh < -41.0) lvl = 40.2;
  else for (const p of PADS) {
    const aS = aW - p.am, b = Math.abs(cW);
    if (b < p.bMin || Math.abs(aS) > p.halfA || b > p.halfB) continue;
    lvl = p.y;
    if (p.y1 !== undefined) {
      const t = p.rampC ? Math.min(1, Math.max(0, (b - p.c0) / (p.c1 - p.c0))) : Math.min(1, Math.max(0, (aS + p.halfA) / (2 * p.halfA)));
      lvl = p.y + (p.y1 - p.y) * t;
    }
    break;
  }
  if (lvl === undefined) return 0;
  lvl += SHIFT;
  const f = Math.min(1, dIn / 20), sm = f * f * (3 - 2 * f);
  return (lvl - BASE) * sm;
}

// the lift of a flat-compiled thing at (x, z): relief less the campus pad (0 off the region; 0 where the tile's chunk is
// not loaded, after a warning once per tile: call haPreload first). (ox, oz): the origin of the tile the record belongs
// to, whose chunk answers for a point just past its edge
const warned = new Set();
export function haLift(x, z, ox, oz) {
  if (!HA_ON) return 0;
  let q = haInfo(x, z);
  if (!q && ox !== undefined && haRelief(x, z) === null) q = haInfoIn(x, z, Math.floor(ox / TILE), Math.floor(oz / TILE));
  if (!q) {
    const r = haRelief(x, z);
    if (r === null && ox === undefined) { const k = `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`; if (!warned.has(k)) { warned.add(k); console.warn('[terrain p1] anchor before its tile was loaded', k); } }
    return 0;
  }
  if (q.tag >= 3) return 0;
  return q.relief - campusPadAt(x, z);
}
export const haFootY = (y, x, z) => (HA_ON ? y + haLift(x, z) : y);
// the lowest lift over a round footprint of radius r (its centre and 8 points on the rim): a rigid thing that stands on
// it touches the ground at its lowest point and is set into the slope on the high side, never floating
export function haLiftMin(x, z, r) {
  if (!HA_ON) return 0;
  let m = haLift(x, z);
  if (r > 0.05) for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4; m = Math.min(m, haLift(x + Math.cos(a) * r, z + Math.sin(a) * r)); }
  return m;
}
// the authority's base (3.24 + relief) and grade (3.385 + relief) where the region has ground, else null
export function haBaseAt(x, z) { const q = HA_ON ? haInfo(x, z) : null; return q && q.tag < 3 ? HA_BASE + q.relief : null; }
export function haGradeAt2(x, z) { const q = HA_ON ? haInfo(x, z) : null; return q && q.tag < 3 ? HA_ASPHALT + q.relief : null; }
// a surveyed height (NAVD88 m) to world y; outside the region (over the water, the other boroughs) the flat city's datum
// (relief 0 there: world = 3.385 + h - S at the nearest S, S clamped to the tie c = 2.263 when S is missing)
export function haWorldAny(h, x, z) {
  const s = haS(x, z);
  return HA_ASPHALT + h - (s === null ? 2.263 : s);
}
export const haIn = (x, z) => HA_ON && haInRegion(x, z);

// ---------------------------------------------------------------- the drawn ground
// The surface a thing stands on is the lifted section under it (the streamer's surfaceAt: walk, road, lawn, plaza, each at
// its own compiled offset over the authority's ground). The page's streamer (world/streamer.js) and the gate register
// their sampler here; where it has no answer (bare ground between sections) the drawn base, the authority's 3.24 + relief.
let SURF = null, SREADY = null;
// fn(x, z): the surface height or null; ready(x, z): the tile under (x, z) is in (its sampler answers there)
export function haSetSurface(fn, ready) { SURF = fn; SREADY = ready || null; }
export function haGround(x, z) {
  if (SURF) { const s = SURF(x, z); if (s !== null && s !== undefined && Number.isFinite(s)) return s; }
  return haBaseAt(x, z);
}
// the lowest drawn ground over a round footprint (centre + 8 rim points at r)
export function haGroundMin(x, z, r) {
  let m = haGround(x, z);
  if (m === null) return null;
  if (r > 0.05) for (let k = 0; k < 8; k++) { const a = (k * Math.PI) / 4, g = haGround(x + Math.cos(a) * r, z + Math.sin(a) * r); if (g !== null) m = Math.min(m, g); }
  return m;
}
// a thing compiled at y on the flat ground at (x, z): lifted by the ground under it, then settled on the drawn surface
// when that is within `snap` of it (a parked car on its lot, a kiosk on its walk)
export function haSettle(y, x, z, snap = 0.2) {
  if (!HA_ON) return y;
  const y1 = y + haLift(x, z), g = SURF ? SURF(x, z) : null;
  return g !== null && g !== undefined && Number.isFinite(g) && Math.abs(g - y1) < snap ? g : y1;
}
// cb(lift at (x, z)) now when the authority's chunk there is in, else once it is (flag off: cb(0) at once)
export function haLiftSoon(x, z, cb) {
  if (!HA_ON) { cb(0); return; }
  if (haRelief(x, z) !== null) { cb(haLift(x, z)); return; }
  haTileReady(Math.floor(x / TILE), Math.floor(z / TILE)).then(() => cb(haLift(x, z)), () => cb(0));
}
// resolves once the registered sampler answers at every point (the tiles there are in), polling once a second
export async function haGroundReady(pts) {
  if (!HA_ON) return false;
  for (;;) {
    if (SURF && SREADY && pts.every(([x, z]) => SREADY(x, z))) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// ---------------------------------------------------------------- structure profiles (anchors.json)
let ANC = null, ancP = null;
const ancDir = () => (isNode ? (process.env.TERRAIN_P1A_DIR || decodeURIComponent(new URL('../../public/data/terrain_p1a/', import.meta.url).pathname)) : null);
export function haAnchors() {
  if (!HA_ON) return Promise.resolve(null);
  if (!ancP) {
    ancP = (async () => {
      let txt;
      if (isNode) { const fs = await import(/* @vite-ignore */ 'node:fs/promises'); txt = await fs.readFile(ancDir() + 'anchors.json', 'utf8'); }
      else {
        const base = (typeof location !== 'undefined' ? new URL('data/terrain_p1a/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href : '/data/terrain_p1a/');
        const r = await fetch(base + 'anchors.json');
        if (!r.ok) throw new Error(`anchors.json: ${r.status}`);
        txt = await r.text();
      }
      ANC = JSON.parse(txt);
      return ANC;
    })().catch((e) => { console.warn('[terrain p1] anchors unavailable, structures stay flat', e); ANC = null; return null; });
  }
  return ancP;
}
export const haAnchorsReady = () => !!ANC;
// TERRAIN INT2: the registry's class-17 fit of a road structure (anchors.json decks: one deck, 15 cm rms, 3000 m2 at most)
// at (x, z) in world y, or null outside every such deck (Central Park's drives over the transverse roads, cpDrives.js)
let RDK = null;
export function haRoadDeckAt(x, z) {
  if (!ANC || !ANC.decks) return null;
  if (!RDK) RDK = ANC.decks.filter((d) => d.fit && d.rms <= 0.15 && d.ring.length >= 4).map((d) => {
    const xs = d.ring.map((p) => p[0]), zs = d.ring.map((p) => p[1]);
    let ar = 0;
    for (let i = 0, j = d.ring.length - 1; i < d.ring.length; j = i++) ar += (d.ring[j][0] + d.ring[i][0]) * (d.ring[j][1] - d.ring[i][1]);
    return { d, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], area: Math.abs(ar) / 2 };
  }).filter((q) => q.area <= 3000);
  for (const q of RDK) {
    if (x < q.bb[0] || x > q.bb[2] || z < q.bb[1] || z > q.bb[3]) continue;
    let ins = false;
    const R = q.d.ring;
    for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; }
    if (!ins) continue;
    const c = q.d.fit, u = x - q.d.c[0], v = z - q.d.c[1];
    return haWorldAny(c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v, x, z);
  }
  return null;
}
// Central Park's water levels (world y, tools/terrain/anchor_levels.mjs), or null
export const haCpWater = (key) => (HA_ON && ANC && ANC.cpWater && ANC.cpWater[key] !== undefined ? ANC.cpWater[key] : null);
export const haCpCastle = () => (HA_ON && ANC && ANC.cpCastle !== undefined ? ANC.cpCastle : null);
export const haProfile = (id) => (ANC && ANC.profiles ? ANC.profiles[id] || null : null);
// a profile's deck world y at the station s (linear between samples, the end values carried on)
export function haProfileY(p, s) {
  const S = p.s, Y = p.y, n = S.length;
  if (s <= S[0]) return Y[0];
  if (s >= S[n - 1]) return Y[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / Math.max(1e-9, S[lo + 1] - S[lo]);
  return Y[lo] + (Y[lo + 1] - Y[lo]) * t;
}
// the station of the profile's alignment nearest (x, z), and the distance to it
export function haProfileStation(p, x, z) {
  let best = 1e18, bs = 0;
  for (let i = 0; i + 1 < p.x.length; i++) {
    const x1 = p.x[i], z1 = p.z[i], dx = p.x[i + 1] - x1, dz = p.z[i + 1] - z1, L2 = dx * dx + dz * dz || 1e-9;
    const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
    const d2 = (x1 + dx * t - x) ** 2 + (z1 + dz * t - z) ** 2;
    if (d2 < best) { best = d2; bs = p.s[i] + t * (p.s[i + 1] - p.s[i]); }
  }
  return [bs, Math.sqrt(best)];
}

// ---------------------------------------------------------------- flat-built structures on their LiDAR decks
// the deck's shift at frame parameter p of structure `id`: its LiDAR deck in world y less the flat build's deck (0 with
// no profile, or the flag off)
export function haDeckShift(id, p, x, z) {
  const P = HA_ON ? haProfile(id) : null;
  if (!P || !P.deck || P.deck[0] === null) return 0;
  return haWorldAny(haProfileY({ s: P.param || P.s, y: P.deck }, p), x, z) - P.flatDeck;
}
// the vertical warp of a structure built on the flat city: a point at its flat ground level G0 moves with the ground under
// it (haLift), a point at or over D0 (the underside of its deck) with its deck (haDeckShift at the point's frame parameter
// frame(x, z)), linearly between: columns, bents and arches stretch or shrink between the two, the deck keeps its shape
// (ground(x, z): the drawn surface under a foot when the builder has it, the tile's own sampler; else the relief)
export function haStructWarp(id, frame, G0, D0, ox, oz, ground) {
  return (x, y, z) => {
    const g = ground ? ground(x, z) : null;
    const dg = g !== null && g !== undefined && Number.isFinite(g) ? g - G0 : haLift(x, z, ox, oz), dd = haDeckShift(id, frame(x, z), x, z);
    const t = Math.min(1, Math.max(0, (y - G0) / (D0 - G0)));
    return y + dg + (dd - dg) * t;
  };
}
// a warp applied to a group's new children (from index i0; the group at the origin): the vertices of a mesh drawn in world
// coordinates, the instance translations of an instanced mesh, the position of anything else
export function haWarpKids(grp, i0, W) {
  if (!HA_ON || !W) return;
  for (let i = i0; i < grp.children.length; i++) {
    const o = grp.children[i];
    if (o.isInstancedMesh) {
      const a = o.instanceMatrix.array;
      for (let k = 0; k < o.count; k++) a[16 * k + 13] = W(a[16 * k + 12], a[16 * k + 13], a[16 * k + 14]);
      o.instanceMatrix.needsUpdate = true;
      if (o.computeBoundingSphere) o.computeBoundingSphere();
    } else if (o.isMesh && o.geometry && o.geometry.attributes.position && o.position.x === 0 && o.position.y === 0 && o.position.z === 0) {
      const pa = o.geometry.attributes.position, a = pa.array;
      for (let k = 0; k < pa.count; k++) a[3 * k + 1] = W(a[3 * k], a[3 * k + 1], a[3 * k + 2]);
      pa.needsUpdate = true;
      o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox();
    } else {
      o.position.y = W(o.position.x, o.position.y, o.position.z);
      if (o.matrixAutoUpdate === false) o.updateMatrix();
    }
  }
}

// ---------------------------------------------------------------- the bridges' Manhattan ends
// The bridges (tiles/bridges.json: a deck polyline with the flat city's heights, the ground under it, towers) re-seated
// in place, before anything builds or drives them (world/streamer.js, core/world/streamer.mjs anchorBridges). The deck is
// fitted from the islands' first to last point and on over the water next to them (a penalised least-squares fit, the
// second differences at a ~40 m smoothing length: the deck's own vertical curves, not the LiDAR's parapets and trusses):
//   - on the islands, a point the flat deck laid at grade is on the street it joins (held exactly) unless the LiDAR has a
//     deck there 8 m or more over the grade: the flat polyline stops where the real deck is still on its structure (the
//     George Washington Bridge's upper level 36 m over the Henry Hudson's slope, the High Bridge 13 m over Highbridge
//     Park's); such an end stays on its deck (the kit stands an abutment under it)
//   - everywhere else in the span the class-17 deck where the LiDAR measured it (anchors.json br_<key>_<index>; a target
//     the first fit leaves 0.6 m off is dropped), with the ground as a floor on the islands
//   - over the water the deck is the LiDAR's, never a slope: what the deck moved by fades out on the far land only
//     (smoothstep over 400 m or 80 % of the land left), so the far end stays on the flat city
// The ground under it is the authority's on the islands; the towers' deck heights and the layout's follow the deck.
// b.haAnchored = { first, last, ends: { <index>: 'grade' | 'deck' }, ... } for the gate.
export const HA_BR_STRUCT = 8.0;
// a double-deck bridge (the kit draws a second roadway `upper` m over its deck, city/br/arches.js): the LiDAR's class 17 is
// the upper roadway's, so the deck (the lower roadway, the one the profile carries) is fitted that much under it
export const HA_BR_UPPER = { henryHudson: 7.6 };
export async function haAnchorBridges(B) {
  if (!HA_ON || !B || !(await haInit())) return 0;
  const A = await haAnchors();
  if (!A || !A.profiles) return 0;
  let n = 0;
  for (let k = 0; k < B.length; k++) {
    const b = B[k], P = A.profiles[`br_${b.key}_${k}`], D = b.deck;
    if (!P || !D || D.length < 2 || P.x.length !== D.length) continue;
    const inR = D.map(([x, , z]) => haInRegion(x, z));
    const first = inR.indexOf(true), last = inR.lastIndexOf(true);
    if (first < 0) continue;
    await Promise.all([...new Set(D.filter((_, i) => inR[i]).map(([x, , z]) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`))].map((q) => { const [tx, tz] = q.split('_').map(Number); return haTileReady(tx, tz, true); }));
    const S = [0];
    for (let i = 1; i < D.length; i++) S.push(S[i - 1] + Math.hypot(D[i][0] - D[i - 1][0], D[i][2] - D[i - 1][2]));
    const wet = (i) => !b.ground || b.ground[i] === null || b.ground[i] === undefined;   // over the water (the flat record's ground is null there)
    // (on over the water while the LiDAR measured the deck: it covers the islands and 300 ft out)
    let a0 = first, a1 = last;
    while (a0 > 0 && wet(a0 - 1) && P.measured[a0 - 1]) a0--;
    while (a1 + 1 < D.length && wet(a1 + 1) && P.measured[a1 + 1]) a1++;
    const m = a1 - a0 + 1, t = new Float64Array(m), w = new Float64Array(m), gr = new Array(m).fill(null);
    const h = (S[a1] - S[a0]) / Math.max(1, m - 1) || 10, lam = Math.pow((b.foot ? 25 : 40) / h, 4), HARD = 1e4 * (1 + lam);
    // (a profile marked lidarOther: the LiDAR's class 17 there is another deck than this one, the 1 train over the
    // Broadway Bridge's roadway; the span keeps the islands' grade)
    const useL = !P.lidarOther;
    const up = HA_BR_UPPER[b.key] || 0, lidar = (i) => (useL && P.measured[i] && P.deck[i] !== null ? haWorldAny(P.deck[i], D[i][0], D[i][2]) - up : null);
    const ends = {};
    for (let i = a0; i <= a1; i++) {
      const [x, y, z] = D[i], j = i - a0, L = lidar(i);
      if (inR[i] && !wet(i)) {
        const g = haBaseAt(x, z);
        gr[j] = g;
        if (g !== null && y < 4.0) {
          const gy = g + (HA_ASPHALT - HA_BASE) + (b.foot ? 0.135 : 0);
          if (L === null || L < gy + HA_BR_STRUCT) { t[j] = gy; w[j] = HARD; gr[j] = null; if (i === 0 || i === D.length - 1) ends[i] = 'grade'; continue; }
          if (i === 0 || i === D.length - 1) ends[i] = 'deck';
        }
      }
      if (L !== null) { t[j] = L; w[j] = 1; }
    }
    // (the unmeasured island points within 12 m of an end held at grade: the abutment's approach, at the street's grade)
    for (const e of Object.keys(ends).map(Number)) if (ends[e] === 'grade') for (let i = a0; i <= a1; i++) {
      const j = i - a0;
      if (i === e || w[j] > 0 || !inR[i] || wet(i) || Math.abs(S[i] - S[e]) > 12) continue;
      const g = haBaseAt(D[i][0], D[i][2]);
      if (g !== null) { t[j] = g + (HA_ASPHALT - HA_BASE) + (b.foot ? 0.135 : 0); w[j] = 1; gr[j] = null; }   // (on the ground there: no clearance floor)
    }
    if (!w.some((v) => v > 0)) continue;
    const fit = () => {
      // (W + lam D'D) y = W t, dense (m <= 201)
      const M = Array.from({ length: m }, () => new Float64Array(m)), r = new Float64Array(m);
      for (let j = 0; j < m; j++) { M[j][j] += w[j]; r[j] = w[j] * t[j]; }
      // (second differences on the polyline's own spacing, scaled to the mean spacing h: [1, -2, 1] where it is even)
      for (let j = 1; j + 1 < m; j++) {
        const h1 = Math.max(0.5, S[a0 + j] - S[a0 + j - 1]), h2 = Math.max(0.5, S[a0 + j + 1] - S[a0 + j]), hh = h * h;
        const c = [j - 1, j, j + 1], d = [(2 * hh) / (h1 * (h1 + h2)), (-2 * hh) / (h1 * h2), (2 * hh) / (h2 * (h1 + h2))];
        for (let p = 0; p < 3; p++) for (let q = 0; q < 3; q++) M[c[p]][c[q]] += lam * d[p] * d[q];
      }
      for (let j = 0; j < m; j++) M[j][j] += 1e-9;
      for (let c = 0; c < m; c++) {
        let piv = c;
        for (let r2 = c + 1; r2 < m; r2++) if (Math.abs(M[r2][c]) > Math.abs(M[piv][c])) piv = r2;
        [M[c], M[piv]] = [M[piv], M[c]]; [r[c], r[piv]] = [r[piv], r[c]];
        const dv = M[c][c] || 1e-12;
        for (let r2 = c + 1; r2 < m; r2++) { const f = M[r2][c] / dv; if (!f) continue; for (let k2 = c; k2 < m; k2++) M[r2][k2] -= f * M[c][k2]; r[r2] -= f * r[c]; }
      }
      const y = new Float64Array(m);
      for (let c = m - 1; c >= 0; c--) { let sm = r[c]; for (let k2 = c + 1; k2 < m; k2++) sm -= M[c][k2] * y[k2]; y[c] = sm / (M[c][c] || 1e-12); }
      return y;
    };
    // (a span with no target at one end: the flat deck's shape there, so the fit does not swing free)
    let Y = fit();
    for (let j = 0; j < m; j++) if (w[j] === 1 && Math.abs(Y[j] - t[j]) > 0.6) w[j] = 0;
    for (let j = 0; j < m; j++) if (gr[j] !== null && Y[j] < gr[j] + 0.4) { t[j] = gr[j] + 0.4; w[j] = HARD; }
    Y = fit();
    const dy = new Array(D.length).fill(0);
    for (let i = a0; i <= a1; i++) dy[i] = Y[i - a0] - D[i][1];
    // past the span (the far land): the shift fades out toward the far end (smoothstep over 400 m or 80 % of the land);
    // a far end with under 150 m of land past the water (the George Washington Bridge's Palisades end) fades over its last
    // 150 m, the end of the water span with it
    const fadeOut = (k0, end) => {
      const L = Math.abs(S[end] - S[k0]), F = Math.min(400, 0.8 * L) || 1;
      for (let i = k0 + Math.sign(end - k0); i !== end + Math.sign(end - k0); i += Math.sign(end - k0)) { const u = Math.min(1, Math.abs(S[i] - S[k0]) / F); dy[i] = dy[k0] * (1 - u * u * (3 - 2 * u)); }
    };
    let fA = a0, fB = a1;
    if (S[a0] - S[0] < 150) { fA = a0; while (fA < first && S[fA] - S[0] < 150) fA++; }
    if (S[D.length - 1] - S[a1] < 150) { fB = a1; while (fB > last && S[D.length - 1] - S[fB] < 150) fB--; }
    if (fA > 0) fadeOut(fA, 0);
    if (fB < D.length - 1) fadeOut(fB, D.length - 1);
    const dyAt = (s) => { let i = 0; while (i + 1 < S.length && S[i + 1] < s) i++; const j = Math.min(S.length - 1, i + 1), t2 = S[j] > S[i] ? Math.min(1, Math.max(0, (s - S[i]) / (S[j] - S[i]))) : 0; return dy[i] + (dy[j] - dy[i]) * t2; };
    for (let i = 0; i < D.length; i++) D[i][1] += dy[i];
    if (b.ground) for (let i = 0; i < D.length; i++) if (inR[i] && b.ground[i] !== null) { const g = haBaseAt(D[i][0], D[i][2]); if (g !== null) b.ground[i] = g; }
    for (const tw of b.towers || []) if (tw.s !== undefined && tw.deckY !== undefined) tw.deckY += dyAt(tw.s);
    if (b.layout) for (const key of ['towers', 'anchorages']) for (const tw of b.layout[key] || []) if (tw.s !== undefined && tw.y !== undefined) tw.y += dyAt(tw.s);
    b.haAnchored = { first, last, a0, a1, fA, fB, ends, lidar: useL, dyMin: Math.min(...dy), dyMax: Math.max(...dy) };
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- the J/M/Z over the Williamsburg Bridge (second pass)
// data/elevated.json carries the J/M/Z's two tracks over the Williamsburg Bridge as single straight segments at the
// Brooklyn el's 11.12 m, under a deck that rises to 43 m over the river. On the flag they follow the track's own LiDAR deck
// where the flight measured it (anchors.json el_<id>, class 17 in a 2.5 m band, Manhattan's third of the bridge) and the
// bridge's anchored deck elsewhere (haAnchorBridges' record within 12 m, the same offset as at the nearest measured
// station), leaving the deck for the flat el it meets where the deck falls under it near an end off the islands (the
// Broadway el in Brooklyn); a 30 m running mean (a rail's smoothness). The polyline is rebuilt on the profile's 2 m stations. Tracks on no bridge, or with no measured station,
// stay as they are (city/elevatedKit.js; the 125th Street IRT is the viaducts' part).
// D: elevated.json's data, B: tiles/bridges.json's records already re-seated by haAnchorBridges. Returns the tracks done.
export async function haAnchorTracks(D, B) {
  if (!HA_ON || !D || !D.tracks || !(await haInit())) return 0;
  const A = await haAnchors();
  if (!A || !A.profiles) return 0;
  let n = 0;
  for (const t of D.tracks) {
    const P = A.profiles[`el_${t.id}`];
    if (!P || !P.measured.some((m) => m) || !t.pts || t.pts.length < 2) continue;
    const m = P.s.length, meas = P.measured;
    // the flat track's y at a station (its own polyline, by arc length)
    const T = t.pts, TS = [0];
    for (let i = 1; i < T.length; i++) TS.push(TS[i - 1] + Math.hypot(T[i][0] - T[i - 1][0], T[i][2] - T[i - 1][2]));
    const flatY = (s) => { let i = 0; while (i + 1 < TS.length && TS[i + 1] < s) i++; const j = Math.min(T.length - 1, i + 1), u = TS[j] > TS[i] ? Math.min(1, Math.max(0, (s - TS[i]) / (TS[j] - TS[i]))) : 0; return T[i][1] + (T[j][1] - T[i][1]) * u; };
    // the bridge the track rides: the anchored deck within 12 m of most of its stations
    let br = null;
    for (const b of B || []) {
      if (!b.deck || b.deck.length < 2 || !b.haAnchored) continue;
      let hit = 0;
      for (let k = 0; k < m; k += 10) { let bd = 1e9; for (let i = 0; i + 1 < b.deck.length; i++) { const a = b.deck[i], c = b.deck[i + 1], dx = c[0] - a[0], dz = c[2] - a[2], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((P.x[k] - a[0]) * dx + (P.z[k] - a[2]) * dz) / L2)); bd = Math.min(bd, Math.hypot(a[0] + dx * u - P.x[k], a[2] + dz * u - P.z[k])); } if (bd < 12) hit++; }
      if (hit * 10 > m * 0.5) { br = b; break; }
    }
    if (!br) continue;   // (an el over the streets: the viaducts' part, vk/viaducts.js, anchors it)
    const deckAt = (x, z) => {
      if (!br) return null;
      let bd = 1e9, by = null;
      for (let i = 0; i + 1 < br.deck.length; i++) { const a = br.deck[i], c = br.deck[i + 1], dx = c[0] - a[0], dz = c[2] - a[2], L2 = dx * dx + dz * dz || 1e-9, u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[2]) * dz) / L2)), d = Math.hypot(a[0] + dx * u - x, a[2] + dz * u - z); if (d < bd) { bd = d; by = a[1] + (c[1] - a[1]) * u; } }
      return bd < 15 ? by : null;
    };
    const Y = new Array(m), lid = (k) => haWorldAny(P.deck[k], P.x[k], P.z[k]);
    const mi = []; for (let k = 0; k < m; k++) if (meas[k]) mi.push(k);
    for (let k = 0; k < m; k++) {
      if (meas[k]) { Y[k] = lid(k); continue; }
      let near = mi[0];
      for (const q of mi) if (Math.abs(q - k) < Math.abs(near - k)) near = q;
      const dk = deckAt(P.x[k], P.z[k]), dn = deckAt(P.x[near], P.z[near]);
      Y[k] = dk !== null && dn !== null ? dk + (lid(near) - dn) : lid(near) + (flatY(P.s[k] - P.s[0]) - flatY(P.s[near] - P.s[0]));
    }
    // toward an end off the islands (the Broadway el in Brooklyn): the track leaves the bridge's deck where that falls under
    // the el it meets, which it stays on (within 300 m of the end; the end itself on the flat track)
    for (const [e, dir] of [[0, 1], [m - 1, -1]]) {
      if (haInRegion(P.x[e], P.z[e])) continue;
      for (let k = e; k >= 0 && k < m; k += dir) {
        if (Math.abs(P.s[k] - P.s[e]) > 300 || meas[k]) break;
        Y[k] = Math.max(Y[k], flatY(P.s[k] - P.s[0]));
      }
      Y[e] = flatY(P.s[e] - P.s[0]);
    }
    // (a rail's own smoothness: a 30 m running mean, the ends held)
    const Ys = Y.map((_, k) => { const h = Math.min(7, k, m - 1 - k); if (!h || !haInRegion(P.x[k], P.z[k]) && Math.min(k, m - 1 - k) < 7) return Y[k]; let sm = 0; for (let q = k - h; q <= k + h; q++) sm += Y[q]; return sm / (2 * h + 1); });
    t.pts = P.x.map((x, k) => [x, Ys[k], P.z[k]]);
    t.haAnchored = { bridge: br ? br.key : null, measured: mi.length };
    n++;
  }
  return n;
}

// ---------------------------------------------------------------- what the cut must not lift (Phase 2's structures)
// The compile's elevated decks (roads at level 1 and up, BASE + 7 m and more: the FDR's stacked and cantilevered
// stretches, the Harlem River Drive, the West Side Highway, the Henry Hudson's viaducts, the bridges' approach ramps) and
// the FDR where it runs covered under the park decks (Carl Schurz Park, the Sutton Place parks, the UN, Rockefeller
// University: the bare earth there is the deck, 10-16 m, which the cut would lift the drive onto) stay at today's heights
// until Phase 2 builds them as structures; the covered FDR (second pass) on its open ends' level, linear between them. haHoldDecks takes their triangles out of the ground sections and notes the
// heights of the road lines on them, before haApplyTile; haRestoreDecks puts both back unlifted after it. Tagged in
// tile.p1Held = { tris, roads, byKind } for the probes.
const DECK_Y = HA_BASE + 5.0, FDR_RE = /^(FDR|F D R|FRANKLIN D\.? ROOSEVELT)/i, COVER_R = 12, COVER_REL = 3.0;
export function haHoldDecks(tile, ox, oz) {
  if (!HA_ON || !tile || !tile.S) return null;
  // the FDR's lines in this tile (world x, z segments) for the covered stretches
  const segs = [];
  const RV = tile.S.roadVerts, names = tile.header.names || [];
  const roadHold = [];
  if (RV) for (const r of roadsOf(tile)) {
    const fdr = FDR_RE.test(names[r.nameIdx] || '');
    for (let j = 0; j < r.len; j++) {
      const k = (r.start + j) * 3, x = RV[k] + ox, y = RV[k + 1], z = RV[k + 2] + oz;
      if (fdr && j + 1 < r.len) segs.push([x, z, RV[k + 3] + ox, RV[k + 5] + oz]);
      if (y >= DECK_Y && !haInCampus(x, z)) roadHold.push(r.start + j);
    }
  }
  const covered = (x, z) => {
    if (!segs.length) return false;
    let near = false;
    for (const [ax, az, bx, bz] of segs) {
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      if ((ax + dx * t - x) ** 2 + (az + dz * t - z) ** 2 < COVER_R * COVER_R) { near = true; break; }
    }
    if (!near) return false;
    const r = haRelief(x, z);
    return r !== null && r > COVER_REL;
  };
  // the FDR's road lines under a deck
  if (RV && segs.length) for (const r of roadsOf(tile)) {
    if (!FDR_RE.test(names[r.nameIdx] || '')) continue;
    for (let j = 0; j < r.len; j++) { const k = (r.start + j) * 3; if (RV[k + 1] < DECK_Y && covered(RV[k] + ox, RV[k + 2] + oz)) roadHold.push(r.start + j); }
  }
  // (P1B second pass: the covered drive on its open ends' level, anchors.json fdrCover, tools/terrain/anchor_levels.mjs;
  // the relief linear between them, by the nearest point within 12 m; 0 where there is none, the flat 3.385 as before)
  const FC = ANC && ANC.fdrCover ? fdrIndex() : null;
  const coverRel = (x, z) => {
    if (!FC) return 0;
    let best = 0, bd = 144;
    for (let gx = Math.floor(x / 8) - 2; gx <= Math.floor(x / 8) + 2; gx++) for (let gz = Math.floor(z / 8) - 2; gz <= Math.floor(z / 8) + 2; gz++) {
      const L = FC.get(gx * 100003 + gz);
      if (L) for (const p of L) { const d = (p[0] - x) ** 2 + (p[1] - z) ** 2; if (d < bd) { bd = d; best = p[2]; } }
    }
    return best;
  };
  const coveredRoad = new Set();
  if (RV && segs.length) for (const r of roadsOf(tile)) { if (!FDR_RE.test(names[r.nameIdx] || '')) continue; for (let j = 0; j < r.len; j++) { const k = (r.start + j) * 3; if (RV[k + 1] < DECK_Y && covered(RV[k] + ox, RV[k + 2] + oz)) coveredRoad.add(r.start + j); } }
  const held = { tris: {}, roads: roadHold.map((i) => [i, coveredRoad.has(i) ? Math.fround(RV[i * 3 + 1] + coverRel(RV[i * 3] + ox, RV[i * 3 + 2] + oz)) : RV[i * 3 + 1]]), byKind: { deck: 0, covered: 0 } };
  for (const name of HA_GROUND) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [], hold = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const y0 = Math.min(a[i + 1], a[i + 4], a[i + 7]), cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      let h = false;
      if (y0 >= DECK_Y && !haInCampus(cx, cz)) { h = true; held.byKind.deck++; }
      else if (segs.length && covered(cx, cz)) { h = 2; held.byKind.covered++; (tile.p1Covered = tile.p1Covered || new Set()).add(`${Math.round((cx - ox) * 100)},${Math.round((cz - oz) * 100)}`); }   // (TERRAIN FIX: the covered drive, which haClampGround leaves under its decks)
      const dst = h ? hold : keep;
      for (let k = 0; k < 9; k++) dst.push(a[i + k] + (h === 2 && k % 3 === 1 ? coverRel(a[i + k - 1] + ox, a[i + k + 1] + oz) : 0));
    }
    if (hold.length) { held.tris[name] = Float32Array.from(hold); tile.S[name] = Float32Array.from(keep); }
  }
  held.cut = haHoldCuts(tile, ox, oz);
  held.bp = haHoldBp(tile, ox, oz);
  held.ox = ox; held.oz = oz;
  tile.p1Held = held;
  return held;
}
export function haRestoreDecks(tile, held) {
  if (!held || !tile || !tile.S) return;
  if (held.cut) haRestoreCuts(tile, held.cut);   // (first: the held decks go back at the sections' end, their compiled heights over any cut's)
  if (held.bp) { for (const [name, h] of Object.entries(held.bp.tris)) { const a = tile.S[name] || new Float32Array(0), n = new Float32Array(a.length + h.length); n.set(a, 0); n.set(h, a.length); tile.S[name] = n; } held.bp.base = haBpBaseFix(tile, held.ox, held.oz); }
  for (const [name, h] of Object.entries(held.tris)) {
    const a = tile.S[name] || new Float32Array(0), n = new Float32Array(a.length + h.length);
    n.set(a, 0); n.set(h, a.length);
    tile.S[name] = n;
  }
  const RV = tile.S.roadVerts;
  if (RV) for (const [i, y] of held.roads) RV[i * 3 + 1] = y;
}

// ---------------------------------------------------------------- Bryant Park on its own level (second pass)
// The park (city/bryantPark.js, bryantParkKit.js) is a raised, designed surface: the lawn and the walks rising 0.8 m from
// Sixth Avenue to the Upper Terrace's foot, the fountain plaza two steps up, the terrace six, the court and the cafe's deck
// nine, retaining walls along the three streets. Its kit is built on one level with those steps; the bare earth under it
// has the real steps, the walls' faces and 0.2 m of undulation, so a kit warped by the relief under each vertex (pass 1)
// stood its terrace on the terrace's own rise twice and left 141 of its lawn-level vertices 0.05-1.04 m off the ground the
// cut drew. Here the park has one level model, from the LiDAR (anchors.json bryantPark, tools/terrain/anchor_levels.mjs):
// a smooth base fitted to the bare earth less each part's height in the kit; the ground sections inside its walls ride on
// it (haHoldDecks holds them from the cut: y + base - 3.51, the compiled lawn's level, split at the walls' lines) and the
// kit is warped onto it (haBpWarp, world/assemble.js); outside the walls the streets keep the bare earth, and a kit vertex
// at the park's floor level on a wall's line (0.3 m in from it) or outside the walls goes down to the street's walk where
// that is lower (the walls' street faces, the gate piers and the planting strips stand on the sidewalk).
const BP_FLAT = 3.51;
const bpLocal = (B, x, z) => {
  const dx = x - B.o[0], dz = z - B.o[1], det = B.u[0] * B.v[1] - B.u[1] * B.v[0];
  return [(dx * B.v[1] - dz * B.v[0]) / det, (B.u[0] * dz - B.u[1] * dx) / det];
};
export function haBpBase(x, z) {
  const B = HA_ON && ANC ? ANC.bryantPark : null;
  if (!B) return null;
  const [u, v] = bpLocal(B, x, z), a = u / 100, b = v / 100, c = B.co;
  return c[0] + c[1] * a + c[2] * b + c[3] * a * a + c[4] * a * b + c[5] * b * b + c[6] * a * a * a + c[7] * a * a * b;
}
// (the park frame's own inverse: bpWorld is affine with axes 0.15 deg off square, so its dot-product inverse in
// city/bryantPark.js bpLocal is 0.3 m off at the far walls)
export const haBpLocal = (x, z) => (HA_ON && ANC && ANC.bryantPark ? bpLocal(ANC.bryantPark, x, z) : null);
const bpInside = (B, x, z, pad = 0) => { const [u, v] = bpLocal(B, x, z), R = B.rect; return u > R[0] - pad && u < R[2] + pad && v > R[1] - pad && v < R[3] + pad; };
function haHoldBp(tile, ox, oz) {
  const B = ANC && ANC.bryantPark;
  if (!B) return null;
  const R = B.rect, corners = [[R[0], R[1]], [R[2], R[1]], [R[2], R[3]], [R[0], R[3]]].map(([u, v]) => [B.o[0] + B.u[0] * u + B.v[0] * v, B.o[1] + B.u[1] * u + B.v[1] * v]);
  if (corners.every(([x]) => x < ox - 1) || corners.every(([x]) => x > ox + TILE + 1) || corners.every(([, z]) => z < oz - 1) || corners.every(([, z]) => z > oz + TILE + 1)) return null;
  // the rectangle's four half-planes in world x, z (u >= R0, v >= R1, u <= R2, v <= R3; u = ((x - o) . v_perp) / det ...)
  const det = B.u[0] * B.v[1] - B.u[1] * B.v[0];
  const uCo = [B.v[1] / det, -B.v[0] / det], vCo = [-B.u[1] / det, B.u[0] / det];
  const uAt = (x, z) => uCo[0] * (x - B.o[0]) + uCo[1] * (z - B.o[1]), vAt = (x, z) => vCo[0] * (x - B.o[0]) + vCo[1] * (z - B.o[1]);
  const hp = [[-uCo[0], -uCo[1], -R[0] - uCo[0] * B.o[0] - uCo[1] * B.o[1]], [-vCo[0], -vCo[1], -R[1] - vCo[0] * B.o[0] - vCo[1] * B.o[1]],
    [uCo[0], uCo[1], R[2] + uCo[0] * B.o[0] + uCo[1] * B.o[1]], [vCo[0], vCo[1], R[3] + vCo[0] * B.o[0] + vCo[1] * B.o[1]]];
  const held = { tris: {}, n: 0 };
  for (const name of HA_GROUND) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [], hold = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const P = [0, 3, 6].map((k) => [a[i + k] + ox, a[i + k + 1], a[i + k + 2] + oz]);
      const us = P.map((p) => uAt(p[0], p[2])), vs = P.map((p) => vAt(p[0], p[2]));
      if (Math.max(...us) < R[0] || Math.min(...us) > R[2] || Math.max(...vs) < R[1] || Math.min(...vs) > R[3]) { for (let k = 0; k < 9; k++) keep.push(a[i + k]); continue; }
      // (a piece under the flat base or over the street levels is not the park's ground: as it is)
      if (Math.min(P[0][1], P[1][1], P[2][1]) < 2.5 || Math.max(P[0][1], P[1][1], P[2][1]) > 4.6) { for (let k = 0; k < 9; k++) keep.push(a[i + k]); continue; }
      let inside = P;
      const outs = [];
      for (const [ha, hb, hc] of hp) { if (inside.length < 3) break; const [inn, out] = halfClip(inside, ha, hb, hc); if (out.length >= 3) outs.push(out); inside = inn; }
      const sg = Math.sign((P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[2][0] - P[0][0]) * (P[1][2] - P[0][2])) || 1;
      const emit = (Q, dst, lift) => {
        for (let q = 1; q + 1 < Q.length; q++) {
          const T = [Q[0], Q[q], Q[q + 1]], s2 = (T[1][0] - T[0][0]) * (T[2][2] - T[0][2]) - (T[2][0] - T[0][0]) * (T[1][2] - T[0][2]);
          if (Math.abs(s2) < 1e-7) continue;
          const ord = Math.sign(s2) === sg ? T : [T[0], T[2], T[1]];
          for (const p of ord) dst.push(p[0] - ox, lift ? p[1] + haBpBase(p[0], p[2]) - BP_FLAT : p[1], p[2] - oz);
        }
      };
      if (inside.length >= 3) { emit(inside, hold, true); held.n++; }
      for (const Q of outs) emit(Q, keep, false);
    }
    if (hold.length) { held.tris[name] = Float32Array.from(hold); tile.S[name] = Float32Array.from(keep); }
  }
  return held.n ? held : null;
}
// the drawn base (tile.S.terrP1, laid by the cut from the bare earth) inside the walls on the base too, 0.15 m under it:
// the bare earth's own walls (its slits) need not stand on the kit's lines (42nd Street's 2 m in from them), and inside
// they would open a trench along the wall or lift the base through the lawn
function haBpBaseFix(tile, ox, oz) {
  const B = ANC && ANC.bryantPark, a = tile.S.terrP1;
  if (!B || !a || !a.length) return 0;
  const R = B.rect, det = B.u[0] * B.v[1] - B.u[1] * B.v[0];
  const uCo = [B.v[1] / det, -B.v[0] / det], vCo = [-B.u[1] / det, B.u[0] / det];
  const uAt = (x, z) => uCo[0] * (x - B.o[0]) + uCo[1] * (z - B.o[1]), vAt = (x, z) => vCo[0] * (x - B.o[0]) + vCo[1] * (z - B.o[1]);
  const hp = [[-uCo[0], -uCo[1], -R[0] - uCo[0] * B.o[0] - uCo[1] * B.o[1]], [-vCo[0], -vCo[1], -R[1] - vCo[0] * B.o[0] - vCo[1] * B.o[1]],
    [uCo[0], uCo[1], R[2] + uCo[0] * B.o[0] + uCo[1] * B.o[1]], [vCo[0], vCo[1], R[3] + vCo[0] * B.o[0] + vCo[1] * B.o[1]]];
  const out = [];
  let n = 0;
  for (let i = 0; i + 8 < a.length; i += 9) {
    const P = [0, 3, 6].map((k) => [a[i + k] + ox, a[i + k + 1], a[i + k + 2] + oz]);
    const us = P.map((p) => uAt(p[0], p[2])), vs = P.map((p) => vAt(p[0], p[2]));
    if (Math.max(...us) < R[0] || Math.min(...us) > R[2] || Math.max(...vs) < R[1] || Math.min(...vs) > R[3]) { for (let k = 0; k < 9; k++) out.push(a[i + k]); continue; }
    let inside = P;
    const outs = [];
    for (const [ha, hb, hc] of hp) { if (inside.length < 3) break; const [inn, o2] = halfClip(inside, ha, hb, hc); if (o2.length >= 3) outs.push(o2); inside = inn; }
    const emit = (Q, lift) => {
      for (let q = 1; q + 1 < Q.length; q++) {
        let p0 = Q[0], p1 = Q[q], p2 = Q[q + 1];
        const ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
        if (Math.abs(ny) < 1e-10) continue;
        if (ny < 0) { const t = p1; p1 = p2; p2 = t; }
        for (const p of [p0, p1, p2]) out.push(p[0] - ox, lift ? haBpBase(p[0], p[2]) - 0.15 : p[1], p[2] - oz);
      }
    };
    if (inside.length >= 3) { emit(inside, true); n++; }
    for (const Q of outs) emit(Q, false);
  }
  tile.S.terrP1 = Float32Array.from(out);
  return n;
}
// the kit's warp: built at y0 (the drawn lawn at the sample, the base there), every vertex onto the base under it; one at
// the floor (within 5 cm of y0 or under it) on or past a wall's line goes down to the street's walk where that is lower
export function haBpWarp(y0) {
  const B = HA_ON && ANC ? ANC.bryantPark : null;
  if (!B) return null;
  const b0 = haBpBase(...[B.o[0] + B.u[0] * B.sample[0] + B.v[0] * B.sample[1], B.o[1] + B.u[1] * B.sample[0] + B.v[1] * B.sample[1]]);
  return (x, y, z) => {
    const d = haBpBase(x, z) - b0;
    if (y > y0 + 0.05 || bpInside(B, x, z, -0.3)) return y + d;   // (the street walls are 0.46 m thick on their lines)
    // (the street outside the nearest street wall, past the bare earth's own step at the wall)
    const [u0, v0] = bpLocal(B, x, z), R = B.rect;
    // (to the drawn base there, the lowest the street draws, the lowest 0.6-1.5 m out: a walk over it buries the foot by
    // its 0.28 m, never floats it)
    let g = null;
    for (const o of [0.6, 1.0, 1.5]) {
      let u = u0, v = v0;
      if (v < R[1] + 0.3) v = R[1] - o; else if (v > R[3] - 0.3) v = R[3] + o; else if (u < R[0] + 0.3) u = R[0] - o;
      const q = haGradeAt2(B.o[0] + B.u[0] * u + B.v[0] * v, B.o[1] + B.u[1] * u + B.v[1] * v);
      if (q !== null && (g === null || q < g)) g = q;
    }
    const tgt = g === null ? y0 + d : Math.min(y0 + d, g - 0.145);
    return y + (tgt - y0);
  };
}

// ---------------------------------------------------------------- the cuts and the streets over them (second pass)
// The compile draws a road whose CSCL level is under grade in an open cut 2.9 m under the flat grade (RG44: floor, kerb
// strips, walls with a parapet, soffits under the street bridges, tunnel mouths, portals) and a rail cut on a floor 0.40
// over the water plane (RL36); the cut lifts both by the relief. But the bare earth already holds the real cut where the
// LiDAR saw its floor, so the trench came out twice: the Trans-Manhattan Expressway 3 m under its LiDAR floor at the
// Alexander Hamilton Bridge, and under the Bus Station and the Bridge Apartments (whose footprints the ground fills at the
// street's level) a roller coaster of +-9 m. And a street at grade crossing a cut (the compile's street bridge) was lifted
// onto the floor under its deck, which the bare earth interpolates there (Amsterdam Avenue 11 m down into the trench).
// Here, before the cut (inside haHoldDecks, so the call sites stay as they are), each is taken out of the sections:
//   - a cut road's pieces (any corner under the flat base, within its corridor): its floor profile from anchors.json cuts
//     (tools/terrain/anchor_alignments.mjs + p2b_profiles.py: the bare earth (class 2) where the LiDAR saw the floor, the
//     grade where the road climbs out, linear under covers: buildings, decks, streets), a corner at the floor going with it
//     (floor + its compiled offset over the road's compiled floor), a corner near the grade (parapets, copings, soffits,
//     headwalls) with the bank (the grade there) or the street bridge over it; the road line on its floor
//   - a rail cut's pieces (rails, ballast, walls in a rail cut rectangle): the bare earth's floor of the rectangle, linear
//     between rectangles
//   - a street bridge: the at-grade pieces of a street (level 0) where it crosses a cut, between its banks (the street's
//     own grade profile bridged by its upper hull: the trench's two rims within 60 m either side), split off at the
//     bridge's rectangle; laid on the straight line between the banks wherever the ground dips under it; its road line
//     with it
// and laid back after it at those heights (haRestoreCuts). Tagged tile.p1Held.cut = { stats } for the probes.
// (Into the compile: a section piece tagged with its cut road or street bridge takes the structure's level instead of the
// relief; the profiles stay data.)
const CUT_NEAR = 0.7, BR_WIN = 60, BR_SIDE = 5;
const CPD_NAME = /( DR$|^CENTRAL PARK (ENTRANCE|EXIT|EN |GREAT HL|LENOX AVE ACCESS)|^102 STREET CROSSING$)/;   // (as tools/cp/cp_drives.mjs)
// (a street bridge carries its street: the carriageway, kerbs, walks and paint; a lawn or a park path in its rectangle is
// ground beside it)
const BR_KINDS = new Set(['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'gutter', 'busred', 'brick', 'plaza', 'warn', 'warnIron']);
const relIn = (x, z, tx, tz) => { const q = haInfo(x, z) || haInfoIn(x, z, tx, tz); return q && q.tag < 3 ? q.relief : null; };
function cutData(tile, tx, tz) {
  if (!ANC || !ANC.cuts) return null;
  const roads = [], rail = [];
  // (the tile's own cut roads, and its neighbours': a cut's pieces near a tile border can lie in the tile whose road line
  // is in the next one; roads[].own marks the tile's own, whose road index j is this tile's)
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const C = ANC.cuts[`${tx + dx}_${tz + dz}`], own = !dx && !dz;
    if (!C) continue;
    for (const [k, c] of Object.entries(C)) {
      if (k === 'rail' || own) continue;
      if (!c.x.some((x, i) => x > (tx) * TILE - 30 && x < (tx + 1) * TILE + 30 && c.z[i] > tz * TILE - 30 && c.z[i] < (tz + 1) * TILE + 30)) continue;
      roads.push({ j: -1, band: c.band, st: c.x.map((x, i) => ({ x, z: c.z[i], yC: c.yC[i], cov: c.cov ? c.cov[i] : 0, fW: c.floor[i] === null ? null : haWorldAny(c.floor[i], x, c.z[i]) })) });
    }
  }
  const C = ANC.cuts[`${tx}_${tz}`] || {};
  for (const [k, c] of Object.entries(C)) {
    if (k === 'rail') {
      c.x.forEach((x, i) => { const z = c.z[i], [, yaw, hl, hw] = c.rect[i]; rail.push({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), hl, hw, cov: c.cov ? c.cov[i] : 0, fW: c.floor[i] === null ? null : haWorldAny(c.floor[i], x, z) }); });
      continue;
    }
    const st = c.x.map((x, i) => ({ x, z: c.z[i], yC: c.yC[i], cov: c.cov ? c.cov[i] : 0, fW: c.floor[i] === null ? null : haWorldAny(c.floor[i], x, c.z[i]) }));
    roads.push({ j: +k, band: c.band, st });
  }
  // (rail rectangles without a floor of their own: linear between measured neighbours in the compile's order)
  const mi = rail.map((r, i) => (r.fW === null ? -1 : i)).filter((i) => i >= 0);
  if (!roads.length && !rail.length) return null;
  if (mi.length) rail.forEach((r, i) => { if (r.fW !== null) return; let a = -1, b = -1; for (const m of mi) { if (m < i) a = m; else if (b < 0) b = m; } r.fW = a < 0 ? rail[b].fW : b < 0 ? rail[a].fW : rail[a].fW + ((rail[b].fW - rail[a].fW) * (i - a)) / (b - a); });
  return { roads, rail: rail.filter((r) => r.fW !== null) };
}
// the nearest station segment of the tile's cut roads to (x, z): { road, i, t, d, yC, fW } or null past maxD
// (PERF: the station segments by 8 m cell of their boxes, per record, built on first use; a query reads the segments of the
// cells within its reach (the widest band + maxD + 3, past which the box test below skips a segment) in the roads' and
// stations' order, so the nearest and its ties come out as from the full walk)
const CUT_IX = new WeakMap();
function cutIndex(D) {
  let G = CUT_IX.get(D);
  if (G !== undefined) return G;
  G = null;
  if (D.roads.length < 1024 && D.roads.every((R) => R.st.length < 1048576 && Number.isFinite(R.band) && R.st.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)))) {
    const H = new Map();
    let band = 0, bad = false;
    D.roads.forEach((R, r) => {
      band = Math.max(band, R.band);
      const S = R.st;
      for (let i = 0; i + 1 < S.length && !bad; i++) {
        const a = S[i], b = S[i + 1];
        const i0 = Math.floor(Math.min(a.x, b.x) / 8), i1 = Math.floor(Math.max(a.x, b.x) / 8), j0 = Math.floor(Math.min(a.z, b.z) / 8), j1 = Math.floor(Math.max(a.z, b.z) / 8);
        if (!(i1 - i0 <= 64 && j1 - j0 <= 64)) { bad = true; break; }
        for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 65536 + k; let l = H.get(q); if (!l) H.set(q, (l = [])); l.push(r * 1048576 + i); }
      }
    });
    if (!bad) G = { H, band };
  }
  CUT_IX.set(D, G);
  return G;
}
function cutNear(D, x, z, maxD) {
  const G = D.rail !== undefined && Number.isFinite(x) && Number.isFinite(z) ? cutIndex(D) : null;   // (a tile's record, kept)
  if (G) {
    const rq = G.band + maxD + 3;
    if (!(rq < 256)) return cutNearAll(D, x, z, maxD);
    const ids = [];
    for (let j = Math.floor((z - rq) / 8); j <= Math.floor((z + rq) / 8); j++) for (let k = Math.floor((x - rq) / 8); k <= Math.floor((x + rq) / 8); k++) { const l = G.H.get(j * 65536 + k); if (l) for (const id of l) ids.push(id); }
    if (!ids.length) return null;
    ids.sort((u, w) => u - w);
    let best = null, bk = Infinity, last = -1;
    for (const id of ids) {
      if (id === last) continue;
      last = id;
      const R = D.roads[Math.floor(id / 1048576)], i = id % 1048576, S = R.st, lim = R.band + maxD;
      const a = S[i], b = S[i + 1];
      if ((a.x - x > lim + 3 && b.x - x > lim + 3) || (x - a.x > lim + 3 && x - b.x > lim + 3) || (a.z - z > lim + 3 && b.z - z > lim + 3) || (z - a.z > lim + 3 && z - b.z > lim + 3)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d > lim || d - R.band >= bk) continue;
      bk = d - R.band;
      best = { road: R, band: R.band, i, t, d, yC: a.yC + (b.yC - a.yC) * t, fW: a.fW === null || b.fW === null ? null : a.fW + (b.fW - a.fW) * t, px: a.x + dx * t, pz: a.z + dz * t, cov: t < 0.5 ? a.cov : b.cov };
    }
    return best;
  }
  return cutNearAll(D, x, z, maxD);
}
function cutNearAll(D, x, z, maxD) {
  let best = null, bk = Infinity;
  for (const R of D.roads) {
    const S = R.st, lim = R.band + maxD;
    for (let i = 0; i + 1 < S.length; i++) {
      const a = S[i], b = S[i + 1];
      if ((a.x - x > lim + 3 && b.x - x > lim + 3) || (x - a.x > lim + 3 && x - b.x > lim + 3) || (a.z - z > lim + 3 && b.z - z > lim + 3) || (z - a.z > lim + 3 && z - b.z > lim + 3)) continue;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / L2));
      const d = Math.hypot(a.x + dx * t - x, a.z + dz * t - z);
      if (d > lim || d - R.band >= bk) continue;
      bk = d - R.band;
      best = { road: R, band: R.band, i, t, d, yC: a.yC + (b.yC - a.yC) * t, fW: a.fW === null || b.fW === null ? null : a.fW + (b.fW - a.fW) * t, px: a.x + dx * t, pz: a.z + dz * t, cov: t < 0.5 ? a.cov : b.cov };
    }
  }
  return best;
}
function railNear(D, x, z, pad) {
  let best = null, bd = 1e9;
  for (let i = 0; i < D.rail.length; i++) {
    const r = D.rail[i], dx = x - r.x, dz = z - r.z, u = dx * r.c + dz * r.s, v = -dx * r.s + dz * r.c;
    if (Math.abs(u) > r.hl + 0.5 || Math.abs(v) > r.hw + pad) continue;
    const d = Math.abs(u) / r.hl;
    if (d < bd) { bd = d; best = { r, i, u }; }
  }
  if (!best) return null;
  // (linear to the next rectangle along the track, the one whose centre lies ahead of u)
  const { r, u } = best;
  let fW = r.fW, nb = null, nd = 1e9;
  for (const q of D.rail) { if (q === r) continue; const du = (q.x - r.x) * r.c + (q.z - r.z) * r.s, dv = -(q.x - r.x) * r.s + (q.z - r.z) * r.c; if (Math.sign(du) === Math.sign(u) && Math.abs(du) < 3 * r.hl + 2 && Math.abs(dv) < r.hw && Math.abs(du) < nd) { nd = Math.abs(du); nb = q; } }
  if (nb && nd > 0.1) fW = r.fW + ((nb.fW - r.fW) * Math.min(1, Math.abs(u) / nd));
  return { fW, yC: 0.40, px: r.x + r.c * u, pz: r.z + r.s * u, cov: r.cov };   // (RL36: the rail cut's floor 0.40)
}
// a convex polygon (plan [x, y, z] corners) clipped by the half-plane a x + b z <= c, and the part outside it
function halfClip(P, a, b, c) {
  const inn = [], out = [];
  for (let k = 0; k < P.length; k++) {
    const p = P[k], q = P[(k + 1) % P.length], dp = a * p[0] + b * p[2] - c, dq = a * q[0] + b * q[2] - c;
    if (dp <= 0) inn.push(p);
    if (dp >= 0) out.push(p);
    if ((dp < 0 && dq > 0) || (dp > 0 && dq < 0)) { const r = dp / (dp - dq), I = [p[0] + (q[0] - p[0]) * r, p[1] + (q[1] - p[1]) * r, p[2] + (q[2] - p[2]) * r]; inn.push(I); out.push(I); }
  }
  return [inn, out];
}
export function haHoldCuts(tile, ox, oz) {
  if (!HA_ON || !ANC || !ANC.cuts || !tile || !tile.S) return null;
  const tx = Math.floor(ox / TILE), tz = Math.floor(oz / TILE);
  const D = cutData(tile, tx, tz);
  if (!D || (!D.roads.length && !D.rail.length)) return null;
  const RV = tile.S.roadVerts, names = tile.header.names || [];
  const grade = (x, z) => { const r = relIn(x, z, tx, tz); return r === null ? null : HA_ASPHALT + r; };
  const stats = { cutTris: 0, railTris: 0, bridges: 0, bridgeTris: 0, roadPts: 0 };
  // 1. the street bridges: level-0 road lines crossing a cut corridor
  const slabs = [];
  const RR = RV ? [...roadsOf(tile)] : [];
  const roadOf = new Map(D.roads.filter((R) => R.j >= 0).map((R) => [R.j, R]));
  RR.forEach((r, j) => {
    // (streets and highways; a ramp (rclass 4) over a cut is one level of an interchange's tangle: Phase 2's structures)
    if (roadOf.has(j) || r.len < 2 || r.rclass > 3) return;
    // (TERRAIN INT2: Central Park's drives are laid on their own profiles over the transverse roads, city/cpDrives.js)
    if (CPD_NAME.test(names[r.nameIdx] || '') && haInCentralPark(RV[r.start * 3] + ox, RV[r.start * 3 + 2] + oz)) return;
    for (let q = 0; q < r.len; q++) if (Math.abs(RV[(r.start + q) * 3 + 1] - HA_ASPHALT) > 0.12) return;
    // the street densified (every 2 m), its crossings with the corridors
    const P = [];
    for (let q = 0; q + 1 < r.len; q++) {
      const k = (r.start + q) * 3, L = Math.hypot(RV[k + 3] - RV[k], RV[k + 5] - RV[k + 2]), n = Math.max(1, Math.ceil(L / 2));
      for (let u = 0; u < n || (q + 2 === r.len && u === n); u++) P.push([RV[k] + ox + ((RV[k + 3] - RV[k]) * u) / n, RV[k + 2] + oz + ((RV[k + 5] - RV[k + 2]) * u) / n]);
    }
    const S = [0];
    for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
    const hit = P.map(([x, z]) => !!cutNear(D, x, z, 0.5) || !!railNear(D, x, z, 0));
    for (let i = 0; i < P.length; i++) {
      if (!hit[i] || (i && hit[i - 1])) continue;
      let i1 = i; while (i1 + 1 < P.length && hit[i1 + 1]) i1++;
      const ic = (i + i1) >> 1, [cx, cz] = P[ic];
      // the street's direction at the crossing, its grade profile over +-60 m (straight on past its ends)
      const a0 = P[Math.max(0, ic - 3)], a1 = P[Math.min(P.length - 1, ic + 3)], dl = Math.hypot(a1[0] - a0[0], a1[1] - a0[1]) || 1, ux = (a1[0] - a0[0]) / dl, uz = (a1[1] - a0[1]) / dl;
      const prof = [];
      for (let d = -BR_WIN; d <= BR_WIN; d += 2) { const g = grade(cx + ux * d, cz + uz * d); if (g !== null) prof.push([d, g]); }
      if (prof.length < 10) continue;
      // the upper hull over the crossing: the segment of it spanning d = 0
      const H = [];
      for (const p of prof) { while (H.length >= 2) { const [o, a] = [H[H.length - 2], H[H.length - 1]]; if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) >= 0) H.pop(); else break; } H.push(p); }
      let k = 0; while (k + 1 < H.length && H[k + 1][0] < 0) k++;
      if (k + 1 >= H.length) continue;
      const [da, ga] = H[k], [db, gb] = H[k + 1];
      if (da <= -BR_WIN + 1 || db >= BR_WIN - 1 || db - da > 2 * BR_WIN - 10) continue;   // (no rims inside the window: a valley, not a trench)
      const line = (d) => ga + ((gb - ga) * (d - da)) / Math.max(1e-6, db - da);
      let dip = 0;
      for (const [d, g] of prof) if (d > da && d < db) dip = Math.max(dip, line(d) - g);
      if (dip < 2.5) continue;   // (a dip under 2.5 m is no room for a road under a deck: the street stays on its ground)
      const half = r.width / 2 + BR_SIDE;
      slabs.push({ cx, cz, ux, uz, da, db, half, line, name: names[r.nameIdx] || '', dip });
      stats.bridges++;
    }
  });
  if (globalThis.__HA_SLABS) for (const b of slabs) globalThis.__HA_SLABS.push({ cx: b.cx, cz: b.cz, ux: b.ux, uz: b.uz, da: b.da, db: b.db, half: b.half, name: b.name });   // (the anchor gate)
  const inSlab = (x, z) => { for (const b of slabs) { const u = (x - b.cx) * b.ux + (z - b.cz) * b.uz, v = -(x - b.cx) * b.uz + (z - b.cz) * b.ux; if (u >= b.da && u <= b.db && Math.abs(v) <= b.half) return b; } return null; };
  // (on a street bridge: its own deck where the LiDAR has it, the registry's class-17 fit of the road structure the point
  // lies in (anchors.json decks, one deck: 15 cm rms, 3000 m2 at most, within 3 m of the line), else the line between its
  // rims; never under the ground)
  const DK = slabs.length && ANC.decks ? ANC.decks.filter((d) => d.fit && d.rms <= 0.15 && d.ring.length >= 4).map((d) => {
    const xs = d.ring.map((p) => p[0]), zs = d.ring.map((p) => p[1]);
    let ar = 0;
    for (let i = 0, j = d.ring.length - 1; i < d.ring.length; j = i++) ar += (d.ring[j][0] + d.ring[i][0]) * (d.ring[j][1] - d.ring[i][1]);
    return { d, bb: [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)], area: Math.abs(ar) / 2 };
  }).filter((q) => q.area <= 3000 && q.bb[2] > ox - 64 && q.bb[0] < ox + TILE + 64 && q.bb[3] > oz - 64 && q.bb[1] < oz + TILE + 64) : [];
  const inPoly = (R, x, z) => { let ins = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, zi] = R[i], [xj, zj] = R[j]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins; } return ins; };
  const deckAt = (x, z, near) => {
    for (const q of DK) {
      if (x < q.bb[0] || x > q.bb[2] || z < q.bb[1] || z > q.bb[3] || !inPoly(q.d.ring, x, z)) continue;
      const c = q.d.fit, u = x - q.d.c[0], v = z - q.d.c[1], L = haWorldAny(c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * u * v + c[5] * v * v, x, z);
      if (Math.abs(L - near) < 3.0) return L;
    }
    return null;
  };
  const topAt = (x, z) => {
    const b = inSlab(x, z), g = grade(x, z);
    if (!b) return g;
    let l = b.line((x - b.cx) * b.ux + (z - b.cz) * b.uz);
    const L = DK.length ? deckAt(x, z, l) : null;
    if (L !== null) l = L;
    return g === null ? l : Math.max(l, g);
  };
  // 2. the pieces held: cut roads' and rail cuts' (any corner under the flat base), the street bridges' (all at grade)
  const held = { tris: {}, front: {}, roads: [], roadCov: [], stats, orig: new Map() };
  // the sections at grade (all three corners within the flat street levels) in 4 m buckets: a cut piece under one is
  // covered by that street (a street bridge, or a street over a tunnel)
  const ATK = ['asphalt', 'sidewalk', 'curb', 'gutter', 'plaza', 'brick', 'busred'], AH = new Map(), AT = [];
  for (const nm of ATK) {
    const a = tile.S[nm];
    if (!a) continue;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (!(a[i + 1] > 3.3 && a[i + 1] < 3.75 && a[i + 4] > 3.3 && a[i + 4] < 3.75 && a[i + 7] > 3.3 && a[i + 7] < 3.75)) continue;
      const x0 = Math.min(a[i], a[i + 3], a[i + 6]) + ox, x1 = Math.max(a[i], a[i + 3], a[i + 6]) + ox, z0 = Math.min(a[i + 2], a[i + 5], a[i + 8]) + oz, z1 = Math.max(a[i + 2], a[i + 5], a[i + 8]) + oz;
      if (x1 - x0 > 200 || z1 - z0 > 200) continue;
      const k = AT.length; AT.push(a, i);
      for (let gx = Math.floor(x0 / 4); gx <= Math.floor(x1 / 4); gx++) for (let gz = Math.floor(z0 / 4); gz <= Math.floor(z1 / 4); gz++) { const q = gx * 100003 + gz; let L = AH.get(q); if (!L) AH.set(q, (L = [])); L.push(k); }
    }
  }
  const coveredAt = (x, z) => {
    const L = AH.get(Math.floor(x / 4) * 100003 + Math.floor(z / 4));
    if (L) for (const k of L) {
      const a = AT[k], i = AT[k + 1], ax = a[i] + ox, az = a[i + 2] + oz, bx = a[i + 3] + ox, bz = a[i + 5] + oz, cx2 = a[i + 6] + ox, cz2 = a[i + 8] + oz;
      const d = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((bz - cz2) * (x - cx2) + (cx2 - bx) * (z - cz2)) / d, l1 = ((cz2 - az) * (x - cx2) + (ax - cx2) * (z - cz2)) / d;
      if (l0 >= -1e-6 && l1 >= -1e-6 && 1 - l0 - l1 >= -1e-6) return true;
    }
    return false;
  };
  // an at-grade piece whose centroid lies within the triangle a[i..i+8] (tile-local)
  const atWithin = (a, i) => {
    const ax = a[i] + ox, az = a[i + 2] + oz, bx = a[i + 3] + ox, bz = a[i + 5] + oz, cx2 = a[i + 6] + ox, cz2 = a[i + 8] + oz;
    const d = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
    if (Math.abs(d) < 1e-9) return false;
    const seen = new Set();
    for (let gx = Math.floor(Math.min(ax, bx, cx2) / 4); gx <= Math.floor(Math.max(ax, bx, cx2) / 4); gx++) for (let gz = Math.floor(Math.min(az, bz, cz2) / 4); gz <= Math.floor(Math.max(az, bz, cz2) / 4); gz++) {
      const L = AH.get(gx * 100003 + gz);
      if (L) for (const k of L) {
        if (seen.has(k)) continue;
        seen.add(k);
        const b = AT[k], j = AT[k + 1], px = (b[j] + b[j + 3] + b[j + 6]) / 3 + ox, pz = (b[j + 2] + b[j + 5] + b[j + 8]) / 3 + oz;
        const l0 = ((bz - cz2) * (px - cx2) + (cx2 - bx) * (pz - cz2)) / d, l1 = ((cz2 - az) * (px - cx2) + (ax - cx2) * (pz - cz2)) / d;
        if (l0 > 0.01 && l1 > 0.01 && 1 - l0 - l1 > 0.01) return true;
      }
    }
    return false;
  };
  // a corner of a cut's piece: one at or near the cut's floor (or between) on the floor; one near the grade over it
  // (parapets, copings, soffits, headwalls) on the bank or the street bridge over it. The floor:
  //   open (no street at grade over the piece, ground in the bare earth): the bare earth there (at the corner itself when
  //   no wall stands between it and the centreline: the floor's own crossfall)
  //   under a street bridge whose line stands 2 m and more over the ground: the bare earth, which the LiDAR leaves
  //   interpolated under the deck (the floor round it)
  //   under a building (the ground there is its fill), under a street at grade that is not such a bridge, over the water:
  //   the profile (the floor seen along the road, linear under covers) when it leaves the street over it 2 m of room,
  //   else as compiled (the relief less the cut's depth: a tunnel under the street)
  const floorAt = (x, y, z, near, cov) => {
    const q = haInfo(near.px, near.pz) || haInfoIn(near.px, near.pz, tx, tz);
    if (!q) return near.fW === null ? null : near.fW + (y - near.yC);
    const tin = HA_ASPHALT + q.relief;
    let open = q.tag !== 1 && q.tag < 3 && !cov;
    if (cov && q.tag < 3) { const b = inSlab(near.px, near.pz); if (b && b.line((near.px - b.cx) * b.ux + (near.pz - b.cz) * b.uz) >= tin + 2.0) open = true; }
    if (open) {
      const qv = haInfo(x, z) || haInfoIn(x, z, tx, tz), rel = qv && qv.tag < 3 && Math.abs(qv.relief - q.relief) < 0.5 ? qv.relief : q.relief;
      return HA_ASPHALT + rel + (y - near.yC);
    }
    if (near.fW !== null && (q.tag >= 3 || near.fW <= tin - 2.0)) return near.fW + (y - near.yC);
    return q.tag >= 3 ? null : y + q.relief;
  };
  // (a floor never under the flat city's 0.45 over the drawn water plane: the portal ramps the flight measured below it,
  // the Brooklyn-Battery's at -5.4, would be under the water drawn at 0)
  const ymap = (x, y, z, near, cov) => {
    if (y > near.yC + 0.35 && y >= HA_ASPHALT - CUT_NEAR) { const t = topAt(x, z); return t === null ? null : t + (y - HA_ASPHALT); }
    const f = floorAt(x, y, z, near, cov);
    return f === null ? null : Math.max(f, 0.45 + (y - near.yC));
  };
  for (const name of HA_GROUND) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const keep = [], hold = [], front = [];
    for (let i = 0; i + 8 < a.length; i += 9) {
      const ys = [a[i + 1], a[i + 4], a[i + 7]], cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      if (Math.min(...ys) < HA_BASE - 0.05 && haInRegion(cx, cz)) {
        // a cut road's piece (its corridor: the band + the kerb strip, wall, coping, and the gap fills the ground passes laid
        // at its floor (GF38) within 10 m) or a rail cut's
        const n = cutNear(D, cx, cz, 10.0);
        const rl = n ? null : (name === 'rsteel' || name === 'rbal' || name === 'rtop' || name === 'rwall') ? railNear(D, cx, cz, 0.6) : null;
        if (n || rl) {
          // (covered: a street at grade over its centroid or over any corner pulled a fifth of the way in, or a piece of one
          // lying within it)
          const out = [];
          let cov = coveredAt(cx, cz);
          for (let k = 0; k < 3 && !cov; k++) cov = coveredAt(a[i + 3 * k] + ox + (cx - a[i + 3 * k] - ox) * 0.2, a[i + 3 * k + 2] + oz + (cz - a[i + 3 * k + 2] - oz) * 0.2);
          if (!cov) cov = atWithin(a, i);
          for (let k = 0; k < 3; k++) {
            const x = a[i + 3 * k] + ox, y = a[i + 3 * k + 1], z = a[i + 3 * k + 2] + oz;
            const nv = n ? (cutNear(D, x, z, 3.0) || n) : (railNear(D, x, z, 1.5) || rl);
            const y2 = ymap(x, y, z, nv, cov);
            if (y2 === null) break;
            out.push(a[i + 3 * k], y2, a[i + 3 * k + 2]);
          }
          if (out.length === 9) { const o = hold.length; for (const v of out) hold.push(v); for (let k = 0; k < 3; k++) held.orig.set(`${name}:${o + 3 * k}`, a[i + 3 * k + 1]); if (n) stats.cutTris++; else stats.railTris++; continue; }
        }
      } else if (slabs.length && BR_KINDS.has(name) && Math.min(...ys) > 3.25 && Math.max(...ys) < 3.8) {
        // a street bridge's piece: split off at the bridge's rectangle
        let P = [0, 3, 6].map((k) => [a[i + k] + ox, a[i + k + 1], a[i + k + 2] + oz]);
        const x0 = Math.min(P[0][0], P[1][0], P[2][0]), x1 = Math.max(P[0][0], P[1][0], P[2][0]), z0 = Math.min(P[0][2], P[1][2], P[2][2]), z1 = Math.max(P[0][2], P[1][2], P[2][2]);
        let done = false;
        for (const b of slabs) {
          const R = Math.hypot(b.db - b.da, 2 * b.half) / 2 + 2, mx = b.cx + b.ux * (b.da + b.db) / 2, mz = b.cz + b.uz * (b.da + b.db) / 2;
          if (x1 < mx - R || x0 > mx + R || z1 < mz - R || z0 > mz + R) continue;
          // the rectangle's four half-planes (u <= db, -u <= -da, v <= half, -v <= half); u = (x - cx) ux + (z - cz) uz
          const hp = [[b.ux, b.uz, b.db + b.cx * b.ux + b.cz * b.uz], [-b.ux, -b.uz, -b.da - b.cx * b.ux - b.cz * b.uz], [-b.uz, b.ux, b.half - b.cx * b.uz + b.cz * b.ux], [b.uz, -b.ux, b.half + b.cx * b.uz - b.cz * b.ux]];
          let inside = P;
          const outs = [];
          for (const [ha, hb, hc] of hp) { if (inside.length < 3) break; const [inn, out] = halfClip(inside, ha, hb, hc); if (out.length >= 3) outs.push(out); inside = inn; }
          if (inside.length < 3) continue;
          const area = (Q) => { let s2 = 0; for (let q = 1; q + 1 < Q.length; q++) s2 += (Q[q][0] - Q[0][0]) * (Q[q + 1][2] - Q[0][2]) - (Q[q + 1][0] - Q[0][0]) * (Q[q][2] - Q[0][2]); return Math.abs(s2) / 2; };
          if (area(inside) < 1e-4) continue;
          const sg = Math.sign((P[1][0] - P[0][0]) * (P[2][2] - P[0][2]) - (P[2][0] - P[0][0]) * (P[1][2] - P[0][2])) || 1;
          const emit = (Q, dst, lift) => {
            for (let q = 1; q + 1 < Q.length; q++) {
              const T = [Q[0], Q[q], Q[q + 1]], s2 = (T[1][0] - T[0][0]) * (T[2][2] - T[0][2]) - (T[2][0] - T[0][0]) * (T[1][2] - T[0][2]);
              if (Math.abs(s2) < 1e-7) continue;
              const ord = Math.sign(s2) === sg ? T : [T[0], T[2], T[1]];
              for (const p of ord) { const y = lift ? topAt(p[0], p[2]) + (p[1] - HA_ASPHALT) : p[1]; dst.push(p[0] - ox, y, p[2] - oz); }
            }
          };
          emit(inside, front, true); stats.bridgeTris++;
          for (const Q of outs) emit(Q, keep, false);
          done = true;
          break;
        }
        if (done) continue;
      }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    if (hold.length || front.length) { if (hold.length) held.tris[name] = Float32Array.from(hold); if (front.length) held.front[name] = Float32Array.from(front); tile.S[name] = Float32Array.from(keep); }
  }
  // (a cut's piece left within 2 m under a street bridge's piece over it, where the two meet in an interchange's tangle of
  // ramps: as compiled, the relief less its depth: never a road on a road)
  if (Object.keys(held.front).length && Object.keys(held.tris).length) {
    const index = (arrs) => {
      const M = new Map();
      for (const [nm, h] of arrs) for (let i = 0; i + 8 < h.length; i += 9) {
        const x0 = Math.min(h[i], h[i + 3], h[i + 6]) + ox, x1 = Math.max(h[i], h[i + 3], h[i + 6]) + ox, z0 = Math.min(h[i + 2], h[i + 5], h[i + 8]) + oz, z1 = Math.max(h[i + 2], h[i + 5], h[i + 8]) + oz;
        for (let gx = Math.floor(x0 / 4); gx <= Math.floor(x1 / 4); gx++) for (let gz = Math.floor(z0 / 4); gz <= Math.floor(z1 / 4); gz++) { const q = gx * 100003 + gz; let L = M.get(q); if (!L) M.set(q, (L = [])); L.push([nm, h, i]); }
      }
      return M;
    };
    const yIn = (h, i, x, z) => {
      const ax = h[i] + ox, az = h[i + 2] + oz, bx = h[i + 3] + ox, bz = h[i + 5] + oz, cx2 = h[i + 6] + ox, cz2 = h[i + 8] + oz;
      const d = (bz - cz2) * (ax - cx2) + (cx2 - bx) * (az - cz2);
      if (Math.abs(d) < 1e-9) return null;
      const l0 = ((bz - cz2) * (x - cx2) + (cx2 - bx) * (z - cz2)) / d, l1 = ((cz2 - az) * (x - cx2) + (ax - cx2) * (z - cz2)) / d, l2 = 1 - l0 - l1;
      return l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6 ? null : l0 * h[i + 1] + l1 * h[i + 4] + l2 * h[i + 7];
    };
    const pts = (h, i) => { const cx = (h[i] + h[i + 3] + h[i + 6]) / 3 + ox, cz = (h[i + 2] + h[i + 5] + h[i + 8]) / 3 + oz; return [[cx, cz], ...[0, 3, 6].map((k) => [h[i + k] + ox + (cx - h[i + k] - ox) * 0.2, h[i + k + 2] + oz + (cz - h[i + k + 2] - oz) * 0.2])]; };
    const cutArrs = Object.entries(held.tris).filter(([nm]) => nm !== 'rwall'), FI = index(Object.entries(held.front)), CI = index(cutArrs);
    const mark = new Set();
    const tooClose = (yb, yc) => yb - yc < 2.0 && yb - yc > -0.5;
    // a cut piece's points under a bridge piece, and a bridge piece's points over a cut piece
    for (const [nm, h] of cutArrs) for (let i = 0; i + 8 < h.length; i += 9) for (const [x, z] of pts(h, i)) {
      const yc = yIn(h, i, x, z), L = FI.get(Math.floor(x / 4) * 100003 + Math.floor(z / 4));
      if (yc !== null && L && L.some(([, f, j]) => { const yb = yIn(f, j, x, z); return yb !== null && tooClose(yb, yc); })) { mark.add(`${nm}:${i}`); break; }
    }
    for (const h of Object.values(held.front)) for (let j = 0; j + 8 < h.length; j += 9) for (const [x, z] of pts(h, j)) {
      const yb = yIn(h, j, x, z), L = CI.get(Math.floor(x / 4) * 100003 + Math.floor(z / 4));
      if (yb !== null && L) for (const [nm, c, i] of L) { const yc = yIn(c, i, x, z); if (yc !== null && tooClose(yb, yc)) mark.add(`${nm}:${i}`); }
    }
    for (const key of mark) {
      const [nm, si] = key.split(':'), h = held.tris[nm], i = +si;
      for (const k of [0, 3, 6]) { const c = held.orig.get(`${nm}:${i + k}`); if (c === undefined) continue; const q = haInfo(h[i + k] + ox, h[i + k + 2] + oz) || haInfoIn(h[i + k] + ox, h[i + k + 2] + oz, tx, tz); if (q && q.tag < 3) h[i + k + 1] = c + q.relief; }
    }
    stats.tangle = mark.size;
  }
  // 3. the road lines: the cut roads on their floors, the street bridges' on their lines
  if (RV) RR.forEach((r, j) => {
    const R = roadOf.get(j);
    for (let q = 0; q < r.len; q++) {
      const i = r.start + q, x = RV[i * 3] + ox, y = RV[i * 3 + 1], z = RV[i * 3 + 2] + oz;
      let y2 = null;
      if (R) { const n = cutNear({ roads: [R] }, x, z, 3.0); if (n && haInRegion(x, z)) { const cv = coveredAt(x, z); if (cv) held.roadCov.push(i); y2 = ymap(x, y, z, n, cv); } }
      else if (Math.abs(y - HA_ASPHALT) < 0.12 && inSlab(x, z)) y2 = topAt(x, z);
      if (y2 !== null && Number.isFinite(y2)) { held.roads.push([i, y2]); stats.roadPts++; }
    }
  });
  held.orig = null;
  held.slabs = slabs.map((b) => ({ name: b.name, cx: +b.cx.toFixed(1), cz: +b.cz.toFixed(1), da: b.da, db: b.db, dip: +b.dip.toFixed(2) }));
  return stats.cutTris || stats.railTris || stats.bridgeTris || stats.roadPts ? held : null;
}
// the drawn base in an open cut never under 0.30 (the cut floor's 0.45 less the base's 0.15): where the bare earth of a
// portal ramp goes under the drawn water plane (the Brooklyn-Battery's, the Lincoln's) the base would be flooded under
// the clamped floor; tile.header.railCuts are the open cuts' rectangles
function haCutBaseFix(tile) {
  const a = tile.S.terrP1, R = tile.header.railCuts;
  if (!a || !a.length || !R || !R.length) return 0;
  const rs = R.map(([x, z, yaw, hl, hw]) => ({ x, z, c: Math.cos(yaw), s: Math.sin(yaw), hl, hw }));
  let n = 0;
  for (let i = 0; i + 2 < a.length; i += 3) {
    if (a[i + 1] >= 0.30) continue;
    const x = a[i], z = a[i + 2];
    if (rs.some((r) => { const dx = x - r.x, dz = z - r.z; return Math.abs(dx * r.c + dz * r.s) <= r.hl && Math.abs(-dx * r.s + dz * r.c) <= r.hw; })) { a[i + 1] = 0.30; n++; }
  }
  return n;
}
export function haRestoreCuts(tile, held) {
  if (!held || !tile || !tile.S) return;
  held.stats.baseRaised = haCutBaseFix(tile);
  for (const name of new Set([...Object.keys(held.tris), ...Object.keys(held.front)])) {
    const a = tile.S[name] || new Float32Array(0), f = held.front[name] || new Float32Array(0), h = held.tris[name] || new Float32Array(0);
    const n = new Float32Array(f.length + a.length + h.length);
    n.set(f, 0); n.set(a, f.length); n.set(h, f.length + a.length);
    tile.S[name] = n;
  }
  const RV = tile.S.roadVerts;
  if (RV) for (const [i, y] of held.roads) RV[i * 3 + 1] = y;
}

let FCI = null;
function fdrIndex() {
  if (FCI && FCI.src === ANC.fdrCover) return FCI.map;
  const map = new Map();
  for (const p of ANC.fdrCover) { const q = Math.floor(p[0] / 8) * 100003 + Math.floor(p[1] / 8); let L = map.get(q); if (!L) map.set(q, (L = [])); L.push(p); }
  FCI = { src: ANC.fdrCover, map };
  return map;
}
// the same through nested groups: every mesh under the group's new children, its vertices taken to the world by its own
// matrix (the group at the origin), warped there, and the height change taken back into its frame (an instanced mesh's
// instances likewise); a kit built as one rotated group (Bryant Park) warps vertex by vertex
export function haWarpDeep(grp, i0, W) {
  if (!HA_ON || !W) return;
  const colY = (e) => {
    // the inverse of the linear part, applied to (0, 1, 0): its second column
    const a = e[0], b = e[4], c = e[8], d = e[1], f = e[5], g = e[9], h = e[2], k = e[6], l = e[10];
    const det = a * (f * l - g * k) - b * (d * l - g * h) + c * (d * k - f * h) || 1e-12;
    return [-(b * l - c * k) / det, (a * l - c * h) / det, -(a * k - c * d) / det];
  };
  for (let i = i0; i < grp.children.length; i++) {
    const root = grp.children[i];
    root.updateMatrixWorld(true);
    root.traverse((o) => {
      const e = o.matrixWorld.elements, cy = colY(e);
      const T = (x, y, z) => [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
      if (o.isInstancedMesh) {
        const a = o.instanceMatrix.array;
        for (let k = 0; k < o.count; k++) { const [wx, wy, wz] = T(a[16 * k + 12], a[16 * k + 13], a[16 * k + 14]), dy = W(wx, wy, wz) - wy; a[16 * k + 12] += cy[0] * dy; a[16 * k + 13] += cy[1] * dy; a[16 * k + 14] += cy[2] * dy; }
        o.instanceMatrix.needsUpdate = true;
        if (o.computeBoundingSphere) o.computeBoundingSphere();
      } else if (o.isMesh && o.geometry && o.geometry.attributes.position) {
        if (o.geometry.userData.haWarped) return;   // (a geometry shared by several meshes: once)
        const pa = o.geometry.attributes.position, a = pa.array;
        for (let k = 0; k < pa.count; k++) { const [wx, wy, wz] = T(a[3 * k], a[3 * k + 1], a[3 * k + 2]), dy = W(wx, wy, wz) - wy; a[3 * k] += cy[0] * dy; a[3 * k + 1] += cy[1] * dy; a[3 * k + 2] += cy[2] * dy; }
        pa.needsUpdate = true; o.geometry.userData.haWarped = true;
        o.geometry.computeBoundingSphere(); o.geometry.computeBoundingBox();
      }
    });
  }
}

// ---------------------------------------------------------------- footings for the gate
// kind: 'foot' (a rigid thing's base at y), 'deck' (a walking top at y that must not have ground over it, nor a gap
// deeper than `skirt` under it), 'col' (a column's or pier's base at y), 'top' (a structure's deck at y against the
// registry's world y `ref`). pts: [[x, z] ...] the footprint samples (default the point itself).
export function haFoot(cls, id, kind, x, z, y, extra) {
  const F = globalThis.__HA_FEET;
  if (!F) return;
  F.push({ cls, id, kind, x, z, y, ...(extra || {}) });
}
