// TERRAIN INT2: Central Park's drives as continuous roads (P1 TERRAIN). The per-vertex deck lift (centralPark.js decksP1)
// switched on at a deck's edge, so a drive over an arch tore along the edge and stepped across tile borders. Here every
// drive (cpDrivesData.js: the compiled road lines chained, tools/cp/cp_drives.mjs) carries one profile:
//   - its stations every 2 m along the centreline take the park's measured surface there: the bridge deck where a deck
//     line holds it (cpRelief.js cpBridgeRelief: the LiDAR's class-17 returns along the arches), else the bare earth;
//   - the drive's height at any point is the Gaussian mean (sigma 3.5 m) of the stations within 11 m: one smooth function of
//     position, the same in every tile, laterally flat along a straight drive;
//   - every hard section whose centroid lies within the drive's corridor (half its carriageway plus 3.5 m of walk) is laid
//     on that profile as one piece (its compiled offsets kept: kerbs, walks, paint), and is never deck-lifted;
//   - the ground and the park's other sections meet the corridor's edge by cut and fill: a vertex within the corridor
//     takes the drive's height, one beyond it blends back to its own ground over a band twice the height difference
//     (1.5-15 m); fill is not laid over a drive's arch (the arch's walls close its sides, its path runs under);
//   - a deck line a drive runs along lifts nothing else (no fragments beside the drive); the arch under the drive takes
//     its parapets at the drive's outer edges and its deck from the same profile (cpLandmarks.js archesBuild).
// `?cpDrives=0` / CP_DRIVES=0: off (the per-vertex lift as before).
import { CP_DRIVES } from './cpDrivesData.js';
import { roadsOf } from '../world/tiledata.js';
import { cpRelief, cpBridgeRelief, cpDecks, CP_DATUM } from './cpRelief.js';
import { haAnchorsReady, haRoadDeckAt } from '../world/haAnchor.js';
import { haInfo, HA_ASPHALT, haInCentralPark } from '../world/heightAuthority.js';

export const CPD_ON = (() => {
  try { if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpDrives') === '0') return false; } catch { /* no location */ }
  try { if (typeof process !== 'undefined' && process.env && process.env.CP_DRIVES === '0') return false; } catch { /* no env */ }
  return true;
})();
const STEP = 2, SIG = 3.5, RAD = 11, WALK = 3.25, CELL = 16, BAND = 6;   // (WALK: kerb and walk; BAND: the lawn the drive lays beyond its walks)
// the stations and the segments, hashed by 16 m cells
const ST = [], SEG = [], HS = new Map(), HG = new Map();
const put = (M, x0, z0, x1, z1, v) => { for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const k = i * 100003 + j; let l = M.get(k); if (!l) M.set(k, (l = [])); l.push(v); } };
// ---- the drives' smoothed centrelines: each chain at 1 m, a Gaussian over 3 m (its two ends held), its arc length
const CH = CP_DRIVES.map((d, di) => {
  const P = d.pts, X0 = [], Z0 = [];
  for (let k = 0; k + 3 < P.length; k += 2) {
    const L = Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1]), n = Math.max(1, Math.round(L));
    for (let u = 0; u < n; u++) { X0.push(P[k] + ((P[k + 2] - P[k]) * u) / n); Z0.push(P[k + 1] + ((P[k + 3] - P[k + 1]) * u) / n); }
  }
  X0.push(P[P.length - 2]); Z0.push(P[P.length - 1]);
  const n = X0.length, X = new Float64Array(n), Z = new Float64Array(n), S = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r = Math.min(9, i, n - 1 - i);
    let sw = 0, sx = 0, sz = 0;
    for (let j = -r; j <= r; j++) { const w = Math.exp(-(j * j) / 18); sw += w; sx += w * X0[i + j]; sz += w * Z0[i + j]; }
    X[i] = sx / sw; Z[i] = sz / sw;
    if (i) S[i] = S[i - 1] + Math.hypot(X[i] - X[i - 1], Z[i] - Z[i - 1]);
  }
  return { di, X, Z, S, half: d.w / 2 };
});
// (the segments and the profile's stations on the smoothed lines: the corridor, the drop, the guard and the sweep agree)
CH.forEach((c, di) => {
  const P = [], half = c.half;
  for (let i = 0; i < c.X.length; i++) P.push(c.X[i], c.Z[i]);
  let carry = 0;
  for (let k = 0; k + 3 < P.length; k += 2) {
    const ax = P[k], az = P[k + 1], bx = P[k + 2], bz = P[k + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-6) continue;
    const s = SEG.length;
    SEG.push({ ax, az, bx, bz, L, half, di, first: k === 0, last: k + 4 >= P.length });
    put(HG, Math.min(ax, bx) - half - WALK - 16, Math.min(az, bz) - half - WALK - 16, Math.max(ax, bx) + half + WALK + 16, Math.max(az, bz) + half + WALK + 16, s);
    for (let t = carry; t < L; t += STEP) { const x = ax + ((bx - ax) * t) / L, z = az + ((bz - az) * t) / L; put(HS, x, z, x, z, ST.length); ST.push({ x, z, ux: (bx - ax) / L, uz: (bz - az) / L, r: undefined }); }
    carry = (carry - L) % STEP; if (carry < 0) carry += STEP;
  }
});
// (a station reads only the decks its drives run along: a path's bridge over a drive is not the drive's surface)
let ODK = null;
const otherDecks = () => { if (!ODK) { const D = cpDriveDecks(); ODK = new Set(cpDecks().map((d) => d.i).filter((i) => !D.has(i))); } return ODK; };
// a station's measured surface (relief units), cached once the data round it is in
function stationR(s) {
  if (s.r !== undefined) return s.r;
  if (!haInfo(s.x, s.z)) return null;   // (the authority's chunk not in: the relief would answer from the park's old grid)
  let r = null;
  try { const b = cpBridgeRelief(s.x, s.z, otherDecks()), g = cpRelief(s.x, s.z); r = b !== null && Number.isFinite(b) ? Math.max(b, g) : g; } catch { r = null; }
  if (r === null || !Number.isFinite(r)) return null;
  // (over a transverse road: the registry's class-17 fit of the drive's bridge where it stands within 1.5 m of the rims
  // 20 m either way along the drive; a structure over the drive is not its surface)
  try {
    const rd = haRoadDeckAt(s.x, s.z);
    if (rd !== null) {
      const rr = rd - HA_ASPHALT, ga = cpRelief(s.x - s.ux * 20, s.z - s.uz * 20), gb = cpRelief(s.x + s.ux * 20, s.z + s.uz * 20);
      if (rr > r && rr <= Math.max(ga, gb) + 1.5) r = rr;
    }
  } catch { /* the registry not in */ }
  if (haAnchorsReady()) s.r = r;
  return r;
}
// the drive's height (relief units) at (x, z), or null off the drives' reach
export function cpDriveH(x, z) {
  let sw = 0, sr = 0;
  for (let i = Math.floor((x - RAD) / CELL); i <= Math.floor((x + RAD) / CELL); i++) for (let j = Math.floor((z - RAD) / CELL); j <= Math.floor((z + RAD) / CELL); j++) {
    const l = HS.get(i * 100003 + j);
    if (l) for (const k of l) {
      const s = ST[k], d2 = (s.x - x) ** 2 + (s.z - z) ** 2;
      if (d2 > RAD * RAD) continue;
      const r = stationR(s);
      if (r === null) continue;
      const w = Math.exp(-d2 / (2 * SIG * SIG));
      sw += w; sr += w * r;
    }
  }
  return sw > 1e-9 ? sr / sw : null;
}
// the nearest drive centreline: { d, half (carriageway), e0 (corridor), x, z (the foot), ux, uz, di } or null within 40 m
export function cpDriveNear(x, z) {
  const l = HG.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  if (!l) return null;
  let best = null;
  for (const s of l) {
    const g = SEG[s], dx = g.bx - g.ax, dz = g.bz - g.az, t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / (g.L * g.L)));
    const fx = g.ax + dx * t, fz = g.az + dz * t, d = Math.hypot(x - fx, z - fz);
    if (!best || d < best.d) best = { d, half: g.half, e0: g.half + WALK, x: fx, z: fz, ux: dx / g.L, uz: dz / g.L, di: g.di, end: (g.first && t <= 0) || (g.last && t >= 1) };
  }
  return best;
}
// the deck lines a drive runs along (half of their line within its corridor): they lift nothing but the drive
let DDK = null;
export function cpDriveDecks() {
  if (DDK) return DDK;
  DDK = new Set();
  for (const d of cpDecks()) {
    let n = 0, m = 0;
    for (let k = 0; k + 1 < d.P.length; k += 3) { m++; const q = cpDriveNear(d.P[k], d.P[k + 1]); if (q && q.d <= q.e0 + BAND) n++; }   // (a deck beside a drive, in its corridor, too)
    if (m && n * 2 >= m) DDK.add(d.i);
  }
  return DDK;
}
// over a drive's arch: a deck that carries the drive holds the drive's surface 1 m or more over the ground here
const overArch = (x, z) => { const b = cpBridgeRelief(x, z, otherDecks()), g = cpRelief(x, z); return b !== null && b - g > 1.0; };
// (the fill fades to nothing toward a drive's arch along the drive, over 10 m, so the valley's ground meets the filled
// bank continuously: one field for every piece)
const archFade = (q) => { for (const d of [0, 2.5, 5, 7.5, 10]) for (const sg of [-1, 1]) if (overArch(q.x + q.ux * d * sg, q.z + q.uz * d * sg)) { const u = d / 10; return u * u * (3 - 2 * u); } return 1; };
// the compile's pieces of a drive (dropped inside the park and generated again below) and the other sections (met by cut
// and fill at the corridor's edge)
const HARD = ['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'paintG', 'gutter', 'busred', 'warn', 'warnIron', 'brick', 'plaza', 'path', 'gravel'];
const DROP = new Set(['asphalt', 'sidewalk', 'curb', 'paintW', 'paintY', 'paintG', 'gutter', 'busred', 'warn', 'warnIron', 'path', 'brick']);
// the nearest centreline of another drive than di (junctions: one drive's kerbs and walks stop at the other's carriageway)
function nearOther(x, z, di) {
  const l = HG.get(Math.floor(x / CELL) * 100003 + Math.floor(z / CELL));
  let best = null;
  if (l) for (const s of l) {
    const g = SEG[s];
    if (g.di === di) continue;
    const dx = g.bx - g.ax, dz = g.bz - g.az, t = Math.max(0, Math.min(1, ((x - g.ax) * dx + (z - g.az) * dz) / (g.L * g.L)));
    const d = Math.hypot(x - g.ax - dx * t, z - g.az - dz * t);
    if (!best || d < best.d) best = { d, half: g.half };
  }
  return best;
}
// the cross-section (offsets across the centreline, + to the right of the line's direction; heights over the carriageway)
const ROAD_Y = HA_ASPHALT - 0.01, KERB = 0.15, KERB_W = 0.25, WALK_W = 3.0, VERGE = 0.75, BIKE = 1.8, LINE = 0.12, DASH = 3, GAP = 6;
function section(half) {
  const bike = half >= 3 ? BIKE : 0, car0 = -half, car1 = half - (bike ? bike + 0.3 : 0);
  const lanes = Math.max(1, Math.round((car1 - car0) / 3.4)), L = [];
  for (let k = 1; k < lanes; k++) L.push(car0 + ((car1 - car0) * k) / lanes);
  return { bike, car0, car1, lanes: L };
}
// the drives' pieces in tile (ox, oz): the chains' segments whose middle lies in the tile and in the park, swept
function buildDrives(tile, ox, oz) {
  const add = {};
  // (every triangle clipped to the tile's square, so each tile holds exactly its own part of a drive: its sections, its
  // walkers' ground and the gates see the same surface)
  const clip = (P, ax, sgn, c) => { const o = []; for (let k = 0; k < P.length; k++) { const p = P[k], q = P[(k + 1) % P.length], dp = sgn * (p[ax] - c), dq = sgn * (q[ax] - c); if (dp >= 0) o.push(p); if ((dp >= 0) !== (dq >= 0)) { const t = dp / (dp - dq); o.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t]); } } return o; };
  const push = (nm, ...v) => {
    let P = [[v[0], v[1], v[2]], [v[3], v[4], v[5]], [v[6], v[7], v[8]]];
    const inside = P.every((p) => p[0] >= 0 && p[0] <= 512 && p[2] >= 0 && p[2] <= 512);
    if (!inside) { P = clip(P, 0, 1, 0); P = clip(P, 0, -1, 512); P = clip(P, 2, 1, 0); P = clip(P, 2, -1, 512); }
    const L = (add[nm] = add[nm] || []);
    for (let k = 1; k + 1 < P.length; k++) L.push(...P[0], ...P[k], ...P[k + 1]);
  };
  let n = 0;
  // (the park paths crossing a drive: a zebra across the carriageway where one meets it, the walkers' crossing)
  const XP = [];
  const RV = tile.S.roadVerts;
  if (RV) for (const r of roadsOf(tile)) {
    if (r.rclass !== 5) continue;
    for (let q = 0; q + 1 < r.len; q++) { const k = (r.start + q) * 3; XP.push([RV[k] + ox, RV[k + 2] + oz, RV[k + 3] + ox, RV[k + 5] + oz]); }
  }
  const crosses = (ax, az, bx, bz) => { for (const [px, pz, qx, qz] of XP) { const d = (bx - ax) * (qz - pz) - (bz - az) * (qx - px); if (Math.abs(d) < 1e-9) continue; const t = ((px - ax) * (qz - pz) - (pz - az) * (qx - px)) / d, u = ((px - ax) * (bz - az) - (pz - az) * (bx - ax)) / d; if (t >= 0 && t < 1 && u >= 0 && u <= 1) return t; } return -1; };
  for (const c of CH) {
    const { X, Z, S, half, di } = c, m = X.length, sec = section(half);
    const nrm = (i) => { const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1), dx = X[b] - X[a], dz = Z[b] - Z[a], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
    for (let i = 0; i + 1 < m; i++) {
      const mx = (X[i] + X[i + 1]) / 2, mz = (Z[i] + Z[i + 1]) / 2;
      if (mx < ox - 12 - half || mx >= ox + 524 + half || mz < oz - 12 - half || mz >= oz + 524 + half) continue;
      const N0 = nrm(i), N1 = nrm(i + 1), sm = (S[i] + S[i + 1]) / 2;
      // (in the park: its middle, or either edge of its walks, so a drive along the park's edge is whole where its pieces were dropped)
      if (!haInCentralPark(mx, mz) && !haInCentralPark(mx + N0[0] * (half + 3), mz + N0[1] * (half + 3)) && !haInCentralPark(mx - N0[0] * (half + 3), mz - N0[1] * (half + 3))) continue;
      const Hs = [cpDriveH(X[i], Z[i]), cpDriveH(X[i + 1], Z[i + 1])];   // (the profile at the centreline: the section is level across)
      const P = (j, v, dy) => { const N = j ? N1 : N0, x = (j ? X[i + 1] : X[i]) + N[0] * v, z = (j ? Z[i + 1] : Z[i]) + N[1] * v, H = Hs[j]; return H === null ? null : [x - ox, ROAD_Y + H + dy, z - oz]; };
      const junction = (v) => { const N = N0, q = nearOther(mx + N[0] * v, mz + N[1] * v, di); return q && q.d < q.half + 0.3; };
      const quad = (nm, v0, v1, dy) => {
        const a = P(0, v0, dy), b = P(1, v0, dy), cc = P(1, v1, dy), d = P(0, v1, dy);
        if (!a || !b || !cc || !d) return;
        for (const [p, q, r] of [[a, b, cc], [a, cc, d]]) { const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]); if (ny >= 0) push(nm, ...p, ...q, ...r); else push(nm, ...p, ...r, ...q); }
      };
      const face = (nm, v, dy0, dy1, out) => {
        const a = P(0, v, dy0), b = P(1, v, dy0), cc = P(1, v, dy1), d = P(0, v, dy1);
        if (!a || !b || !cc || !d) return;
        const ox2 = N0[0] * out, oz2 = N0[1] * out;
        for (const [p, q, r] of [[a, b, cc], [a, cc, d]]) {
          const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2], wx = r[0] - p[0], wy = r[1] - p[1], wz = r[2] - p[2];
          const fx = uy * wz - uz * wy, fz = ux * wy - uy * wx;
          if (fx * ox2 + fz * oz2 >= 0) push(nm, ...p, ...q, ...r); else push(nm, ...p, ...r, ...q);
        }
      };
      // the carriageway, the bike lane, the lines
      quad('asphalt', -half, half, 0);
      n++;
      if (sec.bike && !junction(half - sec.bike / 2)) quad('paintG', sec.car1 + 0.3, half - 0.05, 0.006);
      if (!junction(-half + 0.3)) quad('paintW', -half + 0.25, -half + 0.25 + LINE, 0.007);
      if (sec.bike && !junction(sec.car1)) quad('paintW', sec.car1 + 0.1, sec.car1 + 0.1 + LINE, 0.007);
      if (sm % (DASH + GAP) < DASH && ![-2, -1, 0, 1, 2].some((jj) => i + jj >= 0 && i + jj + 1 < m && crosses(X[i + jj], Z[i + jj], X[i + jj + 1], Z[i + jj + 1]) >= 0)) for (const v of sec.lanes) if (!junction(v) && !junction(v + 3) && !junction(v - 3)) quad('paintW', v - LINE / 2, v + LINE / 2, 0.007);
      // a zebra where a park path crosses: 0.5 m bars every metre across the carriageway, 3 m long, centred on the path
      for (let jj = -2; jj <= 2; jj++) {
        const ia = i + jj; if (ia < 0 || ia + 1 >= m) continue;
        if (crosses(X[ia], Z[ia], X[ia + 1], Z[ia + 1]) < 0) continue;
        if (Math.abs(jj) <= 1) for (let v = -half + 0.4; v + 0.5 <= half - 0.3; v += 1.0) quad('paintW', v, v + 0.5, 0.008);
        break;
      }
      // the kerbs, the walks and their outer edges, both sides (stopped at another drive's carriageway)
      for (const sg of [-1, 1]) {
        const k0 = sg * half, k1 = sg * (half + KERB_W), w1 = sg * (half + KERB_W + WALK_W);
        if (junction(sg * (half + 1.5))) { quad('asphalt', Math.min(k0, w1), Math.max(k0, w1), 0); continue; }   // (a junction's mouth: paved)
        face('curb', k0, -0.02, KERB, -sg);
        quad('curb', Math.min(k0, k1), Math.max(k0, k1), KERB);
        quad('sidewalk', Math.min(k1, w1), Math.max(k1, w1), KERB);
        face('curb', w1, -0.25, KERB, sg);
        // the lawn beyond the walk, BAND m in strips of 1.5 m, on the ground as the drive lays it (cut and fill): the old
        // lawn there is gone, the lawn beyond meets it on the same heights; beside an arch it lies on the valley's ground
        for (let k = 0; k < 4; k++) {
          const a0 = Math.abs(w1) + (BAND * k) / 4, a1 = Math.abs(w1) + (BAND * (k + 1)) / 4;
          const G = (j, v) => { const N = j ? N1 : N0, x = (j ? X[i + 1] : X[i]) + N[0] * v, z = (j ? Z[i + 1] : Z[i]) + N[1] * v; return [x - ox, CP_DATUM + cpRelief(x, z) + cpDriveGroundDy(x, z) - 0.005, z - oz]; };
          const A0 = G(0, sg * a0), B0 = G(1, sg * a0), C0 = G(1, sg * a1), D0 = G(0, sg * a1);
          for (const [p, q, r] of [[A0, B0, C0], [A0, C0, D0]]) { const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]); if (ny >= 0) push('grass', ...p, ...q, ...r); else push('grass', ...p, ...r, ...q); }
        }
      }
    }
  }
  for (const [nm, v] of Object.entries(add)) {
    const a = tile.S[nm], o = new Float32Array((a ? a.length : 0) + v.length);
    if (a) o.set(a, 0);
    o.set(v, a ? a.length : 0);
    tile.S[nm] = o;
  }
  return n;
}
// the drives in tile (ox, oz): the compile's drive pieces inside the park dropped, the drives swept on their profiles, the
// ground and the other sections met at the corridor's edge. Returns the set of the new pieces per kind (by index) so the
// deck lift leaves them alone, or null when off.
export function cpDrivesApply(tile, ox, oz, ground) {
  if (!CPD_ON || !SEG.length) return null;
  const st = { dropped: 0, segs: 0, met: 0 };
  const blend = (x, z) => {
    // the drive's height and the weight of it at (x, z) for a piece off the drive (1 within the corridor)
    const q = cpDriveNear(x, z);
    if (!q) return null;
    const H = cpDriveH(q.x, q.z);   // (the drive's level at the foot on its centreline)
    if (H === null) return null;
    const g = cpRelief(x, z), dh = H - g;
    const arch = false, fa = dh > 0 ? archFade(q) : 1;   // (the fill fades out toward a drive's arch: its valley stays open)
    if (q.d <= q.e0) return { H, w: fa, dh, arch };
    const B = Math.max(1.5, Math.min(15, 2 * Math.abs(dh)));
    if (q.d >= q.e0 + B) return null;
    const u = 1 - (q.d - q.e0) / B;
    return { H, w: u * u * (3 - 2 * u) * fa, dh, arch };
  };
  for (const name of [...HARD, ...ground]) {
    const a = tile.S[name];
    if (!a || a.length < 9) continue;
    const isGround = ground.includes(name), lawn = name === 'grass' || name === 'grassU';
    const keep = [];
    let dropped = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const cx = (a[i] + a[i + 3] + a[i + 6]) / 3 + ox, cz = (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz;
      const q = cpDriveNear(cx, cz);
      // (a compile piece wholly inside the swept drive and its verge is dropped; one reaching past it stays, met at the edge)
      // (TERRAIN INT2: inside a drive's corridor, the walks and BAND m of lawn beyond them, every compile piece is the old
      // layout's and goes: walks, paving, lawn patches; a piece reaching past the corridor keeps its part beyond it, cut on
      // the corridor's edge either side of the drive (its normal at the piece's foot), where the drive's own lawn band
      // meets it; a junction's own pieces at a drive's end stay)
      if ((lawn || HARD.includes(name)) && haInCentralPark(cx, cz)) {
        const vq = [0, 3, 6].map((k) => cpDriveNear(a[i + k] + ox, a[i + k + 2] + oz));
        const qq = q && !q.end ? q : vq.find((r) => r && !r.end) || null;
        let R = qq ? qq.e0 + BAND : 0;
        if (qq && name === 'path') {
          // (a park path crossing the corridor (its long edge within 45 deg of the drive's normal) runs on to the walk)
          let L = 0, ex = 0, ez = 0;
          for (let k = 0; k < 3; k++) { const j = (k + 1) % 3, dx = a[i + 3 * j] - a[i + 3 * k], dz = a[i + 3 * j + 2] - a[i + 3 * k + 2], l = Math.hypot(dx, dz); if (l > L) { L = l; ex = dx / l; ez = dz / l; } }
          if (Math.abs(ex * -qq.uz + ez * qq.ux) > 0.7) R = qq.e0;
        }
        // (under a drive's arch the valley's own pieces, more than 1.5 m under the drive, are the path's and its banks')
        // (at a drive's arch: the valley's own pieces, their middle 1 m and more under the drive, are the path's and its
        // banks' and stay; a hard piece standing 1 m over the valley's ground there is a fragment the old deck lift raised: out)
        const arch = qq && overArch(qq.x, qq.z), Hq = arch ? cpDriveH(qq.x, qq.z) : null, cy = (a[i + 1] + a[i + 4] + a[i + 7]) / 3;
        const under = arch && Hq !== null && cy < ROAD_Y + Hq - 1.0;
        if (arch && !lawn && qq.d <= qq.e0 + BAND && cy > CP_DATUM + cpRelief(cx, cz) + 1.0 && qq.d > qq.e0) { dropped++; continue; }
        if (qq && !under && (qq.d <= R || vq.some((r) => r && !r.end && r.d <= r.e0 + BAND))) {
          const nx = -qq.uz, nz = qq.ux;
          const lat = (p) => (p[0] + ox - qq.x) * nx + (p[2] + oz - qq.z) * nz;
          for (const sgn of [1, -1]) {
            let Pg = [0, 3, 6].map((k) => [a[i + k], a[i + k + 1], a[i + k + 2]]);
            const side = (p) => sgn * lat(p) - R, o2 = [];
            for (let k = 0; k < Pg.length; k++) { const p0 = Pg[k], p1 = Pg[(k + 1) % Pg.length], s0 = side(p0), s1 = side(p1); if (s0 >= 0) o2.push(p0); if ((s0 >= 0) !== (s1 >= 0)) { const t = s0 / (s0 - s1); o2.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + (p1[2] - p0[2]) * t]); } }
            for (let k = 1; k + 1 < o2.length; k++) for (const p of [o2[0], o2[k], o2[k + 1]]) { const x = p[0] + ox, z = p[2] + oz, b = blend(x, z); let dy = b ? b.dh * b.w : 0; keep.push(p[0], p[1] + dy, p[2]); }
          }
          dropped++;
          continue;
        }
      }
      if (q && q.d <= q.e0 + 15) for (let k = 0; k < 3; k++) {
        // the ground and the other sections cut and filled to the corridor's edge (never filled over or beside a drive's
        // arch: its path runs under, its walls close it)
        const x = a[i + 3 * k] + ox, z = a[i + 3 * k + 2] + oz, b = blend(x, z);
        if (!b) continue;
        let dy = b.dh * b.w;
        if (isGround) dy -= 0.05 * b.w;   // (the ground just under the walk's edge)
        a[i + 3 * k + 1] += dy;
        st.met++;
      }
      for (let k = 0; k < 9; k++) keep.push(a[i + k]);
    }
    if (dropped) { tile.S[name] = Float32Array.from(keep); st.dropped += dropped; }
  }
  // the road lines the cars drive on: on the profile
  const RV = tile.S.roadVerts;
  if (RV) for (let i = 0; i + 2 < RV.length; i += 3) {
    const x = RV[i] + ox, z = RV[i + 2] + oz;
    if (Math.abs(RV[i + 1] - HA_ASPHALT) > 1.5 && !haInCentralPark(x, z)) continue;
    const q = cpDriveNear(x, z);
    if (!q || q.d > q.half || !haInCentralPark(x, z)) continue;
    const H = cpDriveH(q.x, q.z);
    if (H !== null) RV[i + 1] = ROAD_Y + H;
  }
  const n0 = {};
  for (const nm of ['asphalt', 'paintG', 'paintW', 'curb', 'sidewalk']) n0[nm] = tile.S[nm] ? tile.S[nm].length : 0;
  st.segs = buildDrives(tile, ox, oz);
  const mine = {};
  for (const nm of Object.keys(n0)) { const set = new Set(), L = tile.S[nm] ? tile.S[nm].length : 0; for (let i = n0[nm]; i + 8 < L; i += 9) set.add(i); mine[nm] = set; }
  tile.cpDrives = st;
  // (the authority's clamp brings the ground down under the drives' pieces whatever the depth: world/heightAuthority.js)
  tile.cpDriveZone = (x, z) => { const q = cpDriveNear(x, z); return !!q && q.d <= q.half + KERB_W + WALK_W + VERGE + 0.05; };
  return mine;
}
// an arch under a drive (cpLandmarks.js ARCHES row): its faces at the drive's outer edges, 0.45 m of parapet outside the
// walks, its deck the drive's profile; null when no drive crosses it
export function cpDriveArch(A) {
  if (!CPD_ON) return null;
  const [, , , cx, cz, ax, az] = A;
  const q = cpDriveNear(cx, cz);
  if (!q || q.d > q.half + 2 || Math.abs(q.ux * ax + q.uz * az) < 0.7) return null;
  const off = (q.x - cx) * -az + (q.z - cz) * ax;
  const B = A.slice();
  const we = q.half + KERB_W + WALK_W;   // (the parapets' inner faces on the walks' outer edges)
  B[9] = off - we - 0.45; B[10] = off + we + 0.45;
  const deckAt = (x, z) => { const r = cpDriveNear(x, z), H = r ? cpDriveH(r.x, r.z) : null; return H === null ? null : 3.38 + H + KERB - 0.02; };   // (the walk's level: the parapet 0.9 m over it)
  return { A: B, deckAt, off, half: q.half, e0: q.e0 };
}
export const cpDriveChains = () => CH;
// the cut or fill the drives lay the ground under at (x, z) (relief units; 0 off their bands), as cpDrivesApply does
export function cpDriveGroundDy(x, z) {
  if (!CPD_ON || !SEG.length) return 0;
  const q = cpDriveNear(x, z);
  if (!q || q.d > q.e0 + 15) return 0;
  const H = cpDriveH(q.x, q.z);
  if (H === null) return 0;
  const g = cpRelief(x, z), dh = H - g;
  let w = 1;
  if (q.d > q.e0) { const B = Math.max(1.5, Math.min(15, 2 * Math.abs(dh))); if (q.d >= q.e0 + B) return 0; const u = 1 - (q.d - q.e0) / B; w = u * u * (3 - 2 * u); }
  return dh > 0 ? dh * w * archFade(q) : dh * w;
}
// the drives' walk lines in tile key ('tx_tz'): per chain the run of its smoothed centreline inside the tile (2 m margin),
// world [x, y, z] with y on the walk, the offset of the walk's middle and the run's box (sim/peds.js)
const WALKS = new Map();
export function cpDriveWalks(_ox, _oz, key) {
  if (WALKS.has(key)) return WALKS.get(key);
  const [tx, tz] = String(key).split('_').map(Number), ox = tx * 512, oz = tz * 512, out = [];
  for (const c of CH) {
    let run = [];
    const flush = () => { if (run.length >= 4) { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const p of run) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); } const off = c.half + KERB_W + WALK_W / 2, m = off + 1; out.push({ pts: run, off, bb: [x0 - m, z0 - m, x1 + m, z1 + m] }); } run = []; };
    for (let i = 0; i < c.X.length; i++) {
      const x = c.X[i], z = c.Z[i];
      if (x < ox - 2 || x > ox + 514 || z < oz - 2 || z > oz + 514 || !haInCentralPark(x, z)) { flush(); continue; }
      const H = cpDriveH(x, z);
      run.push([x, H === null ? ROAD_Y + KERB : ROAD_Y + H + KERB, z]);
    }
    flush();
  }
  WALKS.set(key, out);
  return out;
}
export const CPD_BAND = BAND;
// the drives' own lamps and benches (city/cpFlora.js bins them with the park's): a Bacon lamp every 30 m at the walk's
// outer edge, the sides alternating; a group of three settees every 90 m on the lawn side of a walk, facing the drive,
// where the drive's grade is under 5 % and no arch or junction is near. [lamps [x, z, 0]], [benches [x, z, yaw, 0]]
let FURNS = null;
export function cpDriveFurniture() {
  if (FURNS) return FURNS;
  const lamps = [], benches = [];
  for (const c of CH) {
    const { X, Z, S, half, di } = c, n = X.length, we = half + KERB_W + WALK_W;
    const at = (s0) => { let i = 0; while (i + 1 < n && S[i + 1] < s0) i++; if (i + 1 >= n) return null; const t = (s0 - S[i]) / Math.max(1e-6, S[i + 1] - S[i]), x = X[i] + (X[i + 1] - X[i]) * t, z = Z[i] + (Z[i + 1] - Z[i]) * t, dx = X[i + 1] - X[i], dz = Z[i + 1] - Z[i], L = Math.hypot(dx, dz) || 1; return { x, z, nx: -dz / L, nz: dx / L }; };
    const clear = (x, z) => { if (!haInCentralPark(x, z) || overArch(x, z)) return false; const o = nearOther(x, z, di); return !(o && o.d < o.half + 8); };
    let k = 0;
    for (let s0 = 15; s0 < S[n - 1] - 10; s0 += 30, k++) {
      const p = at(s0); if (!p) continue;
      const sg = k % 2 ? 1 : -1, x = p.x + p.nx * sg * (we - 0.45), z = p.z + p.nz * sg * (we - 0.45);
      if (clear(p.x, p.z)) lamps.push([x, z, 0]);
    }
    k = 0;
    for (let s0 = 45; s0 < S[n - 1] - 20; s0 += 90, k++) {
      const p = at(s0), p2 = at(s0 + 8); if (!p || !p2) continue;
      const h1 = cpDriveH(p.x, p.z), h2 = cpDriveH(p2.x, p2.z);
      if ((h1 !== null && h2 !== null && Math.abs(h2 - h1) / 8 > 0.05) || !clear(p.x, p.z) || !clear(p2.x, p2.z)) continue;   // (the grade where the profile is in)
      const sg = k % 2 ? -1 : 1, fx = -p.nx * sg, fz = -p.nz * sg, yaw = Math.atan2(fx, fz);
      const tx = p.nz, tz = -p.nx;
      for (const j of [-2.6, 0, 2.6]) {
        const x = p.x + p.nx * sg * (we + 0.9) + tx * j, z = p.z + p.nz * sg * (we + 0.9) + tz * j;
        benches.push([x, z, yaw, 0]);
      }
    }
  }
  return (FURNS = { lamps, benches });
}
