// The FDR's covered and stacked stretches, each one structure by rule (HIGHWAYS P2, on the height authority):
//   footprint  both carriageways, their shoulders (1 m) and, on the river side, everything out to the bulkhead (the
//              first river or outside point of the authority's mesh within 45 m of the paving)
//   park       a covered run (the chains' 'under' structures, gaps up to 60 m bridged): one deck slab over the footprint at
//              one level per stretch, the median of the authority's grade over it where that stands 3 m+ over the drives
//              (the LiDAR's deck top), at least 4.9 m over every drive beneath; lawn and a promenade path on top
//   stack      a run under another carriageway (E 61st St): the upper carriageway is its deck; a walk at that level
//              out to the bulkhead
// No ground inside a footprint (hhp.js cuts it out exactly); the kit draws the river wall, the inner retaining wall,
// the tunnel side walls, the slab's soffit and the portals (hhpKit.js).
import { HA_P1, haInfo, haGradeAt } from '../world/heightAuthority.js';
import { haPreload } from '../world/haAnchor.js';

export const BOXES = [];          // strips: { id, c, i0, i1, kind, lo, ro, sr (river side +-1, 0 none), top, soffit, pair, upper }
const QG = new Map(), QC = 16;    // quad grid: cell -> [[strip, i], ...]
const gauss = (A, s) => {
  const n = A.length, out = new Float64Array(n), r = Math.ceil(3 * s);
  for (let i = 0; i < n; i++) { let w = 0, v = 0; for (let k = -r; k <= r; k++) { const j = Math.min(n - 1, Math.max(0, i + k)), g = Math.exp(-(k * k) / (2 * s * s)); w += g; v += g * A[j]; } out[i] = v / w; }
  return out;
};
const water = (x, z) => { const q = haInfo(x, z); return !q || q.tag >= 3; };
const nearestOn = (o, x, z, hint) => {
  let best = -1, bd = Infinity;
  const a = hint >= 0 ? Math.max(0, hint - 40) : 0, b = hint >= 0 ? Math.min(o.n - 1, hint + 40) : o.n - 1;
  for (let j = a; j <= b; j++) { const d = (o.X[j] - x) ** 2 + (o.Z[j] - z) ** 2; if (d < bd) { bd = d; best = j; } }
  return [best, Math.sqrt(bd)];
};
// the strip's corner at station i, offset o (its normal: the chain's, positive to the right)
export const corner = (s, i, o) => [s.c.X[i] + s.c.NX[i] * o, s.c.Z[i] + s.c.NZ[i] * o];
// the cut's quad: on the river side 10 m past the wall (the old shore treatment there, aprons and walls, goes with it)
// (inner > 0: that much past the inner wall too: the replaced roadway's compiled walls and kerbs standing just behind it)
export const cutQuadOf = (s, i, inner = 0) => { const e = (k) => (s.sr > 0 ? [s.lo[k] - inner, s.ro[k] + 10] : s.sr < 0 ? [s.lo[k] - 10, s.ro[k] + inner] : [s.lo[k] - inner, s.ro[k] + inner]); const a = e(i - s.i0), b = e(i + 1 - s.i0); return [corner(s, i, a[1]), corner(s, i + 1, b[1]), corner(s, i + 1, b[0]), corner(s, i, a[0])]; };
export const quadOf = (s, i) => [corner(s, i, s.ro[i - s.i0]), corner(s, i + 1, s.ro[i + 1 - s.i0]), corner(s, i + 1, s.lo[i + 1 - s.i0]), corner(s, i, s.lo[i - s.i0])];

function inQuad(Q, x, z) {
  let pos = false, neg = false;
  for (let k = 0; k < 4; k++) {
    const a = Q[k], b = Q[(k + 1) % 4], cr = (b[0] - a[0]) * (z - a[1]) - (b[1] - a[1]) * (x - a[0]);
    if (cr > 1e-9) pos = true; else if (cr < -1e-9) neg = true;
    if (pos && neg) return false;
  }
  return true;
}
// the strips' quads round a box (x0..x1, z0..z1): [{ s, i, Q }]
export function boxQuads(x0, z0, x1, z1) {
  const seen = new Set(), out = [];
  for (let gx = Math.floor(x0 / QC); gx <= Math.floor(x1 / QC); gx++) for (let gz = Math.floor(z0 / QC); gz <= Math.floor(z1 / QC); gz++) {
    const L = QG.get(gx * 100003 + gz); if (!L) continue;
    for (const [k, i] of L) { const key = k * 100000 + i; if (seen.has(key)) continue; seen.add(key); out.push({ s: BOXES[k], i, Q: quadOf(BOXES[k], i) }); }
  }
  return out;
}
// the quad over (x, z), or null
export function boxAt(x, z) {
  const L = QG.get(Math.floor(x / QC) * 100003 + Math.floor(z / QC));
  if (!L) return null;
  for (const [k, i] of L) { const s = BOXES[k], Q = quadOf(s, i); if (inQuad(Q, x, z)) return { s, i, Q }; }
  return null;
}
// every strip over (x, z)
export function boxesAt(x, z) {
  const L = QG.get(Math.floor(x / QC) * 100003 + Math.floor(z / QC)), out = [];
  if (L) for (const [k, i] of L) { const s = BOXES[k]; if (!out.includes(s) && inQuad(quadOf(s, i), x, z)) out.push(s); }
  return out;
}
// the deck's top at (x, z) within quad (s, i): the stations' levels, along the chain
export function topIn(s, i, x, z) {
  const c = s.c, dx = c.X[i + 1] - c.X[i], dz = c.Z[i + 1] - c.Z[i];
  const t = Math.max(0, Math.min(1, ((x - c.X[i]) * dx + (z - c.Z[i]) * dz) / (dx * dx + dz * dz || 1e-9)));
  const a = s.top[i - s.i0], b = s.top[i + 1 - s.i0];
  return a + (b - a) * t;
}

export async function buildBoxes(CH, hits) {
  BOXES.length = 0; QG.clear();
  if (!HA_P1) return 0;
  const mains = CH.filter((c) => c.kind === 'main' && /^[FD][NS]$/.test(c.id));
  const runs = [];
  for (const c of mains) {
    const m = new Uint8Array(c.n);
    for (const q of c.structs) if (q.kind === 'under') for (let i = Math.max(0, q.i0); i <= Math.min(c.n - 1, q.i1); i++) m[i] = 1;
    let last = -1;
    for (let i = 0; i < c.n; i++) if (m[i]) { if (last >= 0 && i - last > 1 && i - last <= 30) for (let k = last + 1; k < i; k++) m[k] = 1; last = i; }
    for (let i = 0; i < c.n;) { if (!m[i]) { i++; continue; } let j = i; while (j + 1 < c.n && m[j + 1]) j++; if (j - i >= 10) runs.push({ c, i0: i, i1: Math.min(c.n - 2, j) }); i = j + 1; }
  }
  for (const r of runs) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = r.i0; i <= r.i1 + 1; i++) { x0 = Math.min(x0, r.c.X[i]); x1 = Math.max(x1, r.c.X[i]); z0 = Math.min(z0, r.c.Z[i]); z1 = Math.max(z1, r.c.Z[i]); }
    await haPreload(x0 - 70, z0 - 70, x1 + 70, z1 + 70);
  }
  // (longest first: a later run's stations already inside an earlier strip are left out, so strips do not overlap)
  runs.sort((a, b) => (b.i1 - b.i0) - (a.i1 - a.i0));
  for (const r of runs) {
    const { c } = r;
    const others = mains.filter((o) => o !== c);
    let i = r.i0;
    while (i <= r.i1) {
      if (boxAt(c.X[i], c.Z[i])) { i++; continue; }
      let j = i; while (j + 1 <= r.i1 && !boxAt(c.X[j + 1], c.Z[j + 1])) j++;
      if (j - i >= 10) { addStrip(c, i, j, others, hits); regStrip(BOXES.length - 1); }
      i = j + 1;
    }
  }
  // the open riverside stretches: where the river lies within 30 m of a main's edge with nothing between (no other
  // carriageway or ramp, no deck), the band from the kerb to the bulkhead is a structure too: one swept river wall, an
  // esplanade or verge on top at the kerb's level
  for (const c of mains) {
    const n = c.n, sh = new Int8Array(n), ext = new Float64Array(n), inn = new Float64Array(n), tv = new Float64Array(n);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, c.X[i]); x1 = Math.max(x1, c.X[i]); z0 = Math.min(z0, c.Z[i]); z1 = Math.max(z1, c.Z[i]); }
    await haPreload(x0 - 50, z0 - 50, x1 + 50, z1 + 50);
    for (let i = 0; i < n - 1; i++) {
      if (boxAt(c.X[i], c.Z[i]) || c.structs.some((q) => q.kind !== 'under' && q.kind !== 'cover' && i >= q.i0 - 2 && i <= q.i1 + 2)) continue;
      for (const sg of [-1, 1]) {
        const w = sg < 0 ? c.WL[i] : c.WR[i];
        let e = null, pin = w + 0.15, py = c.Y[i] + c.E[i] * sg * w + 0.15, lastHit = null;
        for (let d = w + 0.5; d <= w + 40; d += 0.5) {
          const P = (q) => [c.X[i] + c.NX[i] * sg * q, c.Z[i] + c.NZ[i] * sg * q];
          const [x, z] = P(d);
          // (a ramp or another carriageway between it and the river: the band starts past its paving, at its level)
          const hs = hits(x, z, 0).filter((h) => h.c !== c);
          if (hs.some((h) => h.c.kind === 'main')) break;   // (the pair between it and the river: the pair's shore)
          if (hs.length) { lastHit = hs[0]; pin = d + 0.45; py = hs[0].y + 0.15; continue; }
          if (boxAt(x, z)) break;   // (another structure there already)
          if (d - pin > 30) break;
          if (water(x, z) && water(...P(d + 1.5)) && water(...P(d + 3))) { e = d - 0.5; break; }
        }
        if (e !== null) { sh[i] = sg; inn[i] = pin; tv[i] = py; ext[i] = Math.max(e, pin + 1.0); break; }
      }
    }
    // (gaps up to 10 m bridged, runs of 20 m at least)
    for (let i = 1; i < n; i++) if (!sh[i]) { let j = i; while (j < n && !sh[j]) j++; if (j < n && j - i <= 5 && sh[i - 1] && sh[i - 1] === sh[j]) for (let k = i; k < j; k++) { const f = (k - i + 1) / (j - i + 1); sh[k] = sh[i - 1]; ext[k] = ext[i - 1] + (ext[j] - ext[i - 1]) * f; inn[k] = inn[i - 1] + (inn[j] - inn[i - 1]) * f; tv[k] = tv[i - 1] + (tv[j] - tv[i - 1]) * f; } i = j; }
    for (let i = 0; i < n - 1;) {
      if (!sh[i]) { i++; continue; }
      const sg = sh[i]; let j = i; while (j + 1 < n - 1 && sh[j + 1] === sg) j++;
      if (j - i >= 10) {
        const m = j - i + 2, lo = new Float64Array(m), ro = new Float64Array(m), top = new Float64Array(m);
        const E = Float64Array.from({ length: m }, (_, k) => ext[Math.min(j, i + k)]);
        const Em = gauss(Float64Array.from(E.map((_, k) => { let v = E[k]; for (let q = Math.max(0, k - 4); q <= Math.min(m - 1, k + 4); q++) v = Math.max(v, E[q]); return v; })), 3);
        const In0 = Array.from({ length: m }, (_, k) => inn[Math.min(j, i + k)]);
        const In = gauss(Float64Array.from(In0.map((_, k) => { let v = In0[k]; for (let q = Math.max(0, k - 3); q <= Math.min(m - 1, k + 3); q++) v = Math.max(v, In0[q]); return v; })), 2), Tv = Float64Array.from({ length: m }, (_, k) => tv[Math.min(j, i + k)]);
        for (let k = 0; k < m; k++) {
          const ii = i + k, w = sg < 0 ? c.WL[ii] : c.WR[ii];
          const inner = Math.max(w + 0.15, In[k]), outer = Math.max(Em[k], inner + 1.0);
          if (sg > 0) { lo[k] = inner; ro[k] = outer; } else { lo[k] = -outer; ro[k] = -inner; }
          top[k] = Tv[k];
        }
        const T = gauss(top, 2);
        BOXES.push({ id: `${c.id}:shore:${i}`, c, i0: i, i1: j, kind: 'shore', lo, ro, sr: sg, top: T, soffit: T.map((v) => v - 1), pair: null, pairJ: new Int32Array(m).fill(-1), samples: [], floor: -Infinity });
        regStrip(BOXES.length - 1);
      }
      i = j + 1;
    }
  }
  // one level per stretch: strips touching each other share it
  const grp = BOXES.map((_, k) => k), find = (k) => (grp[k] === k ? k : (grp[k] = find(grp[k])));
  for (let a = 0; a < BOXES.length; a++) for (let b = a + 1; b < BOXES.length; b++) {
    if (BOXES[a].kind !== 'park' || BOXES[b].kind !== 'park') continue;
    const B = BOXES[b];
    for (let i = B.i0; i <= B.i1 + 1; i += 2) { const m = (B.lo[i - B.i0] + B.ro[i - B.i0]) / 2; const p = corner(B, i, m); const q = boxAt(p[0] + 1e-3, p[1]); if (q && q.s === BOXES[a]) { grp[find(b)] = find(a); break; } const e = corner(B, i, B.ro[i - B.i0] + 1.5), e2 = corner(B, i, B.lo[i - B.i0] - 1.5); const q2 = boxAt(e[0], e[1]) || boxAt(e2[0], e2[1]); if (q2 && q2.s === BOXES[a]) { grp[find(b)] = find(a); break; } }
  }
  const G = new Map();
  BOXES.forEach((s, k) => { if (s.kind !== 'park') return; const g = find(k); let e = G.get(g); if (!e) G.set(g, (e = { g: [], floor: -Infinity })); e.g.push(...s.samples); e.floor = Math.max(e.floor, s.floor); });
  BOXES.forEach((s, k) => {
    if (s.kind !== 'park') return;
    const e = G.get(find(k)), v = e.g.slice().sort((a, b) => a - b);
    const L = Math.max(v.length ? v[v.length >> 1] : -Infinity, e.floor);
    s.top.fill(L); s.soffit.fill(L - 1.0); s.group = find(k);
  });
  // (the park deck reaches inland as far as the ground beside it lies on the deck's level (within 0.6 m, open ground, up to
  // 40 m): the plaza or garden over the drive is the deck's top, drawn as the deck's lawn, its inner wall where the
  // ground leaves that level)
  for (const s of BOXES) {
    if (s.kind !== 'park') continue;
    const sg = s.sr > 0 ? -1 : 1, n = s.lo.length, ext = new Float64Array(n), c = s.c;
    for (let k = 0; k < n; k++) {
      const i = s.i0 + k, e0 = sg > 0 ? s.ro[k] : -s.lo[k];
      let e = 0;
      for (let d = 1; d <= 40; d += 1) { const x = c.X[i] + c.NX[i] * sg * (e0 + d), z = c.Z[i] + c.NZ[i] * sg * (e0 + d), q = haInfo(x, z), g = haGradeAt(x, z); if (!q || q.tag !== 0 || g === null || Math.abs(g - s.top[k]) > 0.6) break; e = d; }
      ext[k] = e;
    }
    // (eroded then smoothed: a 6 m run of stations at least, no single-station spikes)
    const er = new Float64Array(n); for (let k = 0; k < n; k++) { let m = Infinity; for (let q = Math.max(0, k - 3); q <= Math.min(n - 1, k + 3); q++) m = Math.min(m, ext[q]); er[k] = m; }
    const sm = gauss(er, 3);
    for (let k = 0; k < n; k++) { if (sg > 0) s.ro[k] += Math.min(sm[k], er[k] + 2); else s.lo[k] -= Math.min(sm[k], er[k] + 2); }
  }
  QG.clear(); BOXES.forEach((_, k) => regStrip(k));
  // (the inner wall's top: the deck's coping or the street's ground behind it, whichever is higher, with no step taller
  // than the wall's own course: a running max over 6 m then a 6 m Gaussian, so a bluff's wall eases down to the coping)
  for (const s of BOXES) {
    const n = s.lo.length, c = s.c, sg = s.sr > 0 ? -1 : 1, W = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const i = s.i0 + k, e = sg > 0 ? s.ro[k] : s.lo[k], x = c.X[i] + c.NX[i] * (e + sg * 1.5), z = c.Z[i] + c.NZ[i] * (e + sg * 1.5), g = haGradeAt(x, z);
      W[k] = Math.max(s.top[k] + 0.2, g === null ? -Infinity : g + 0.1);
    }
    const M = W.map((_, k) => { let m = -Infinity; for (let q = Math.max(0, k - 3); q <= Math.min(n - 1, k + 3); q++) m = Math.max(m, W[q]); return m; });
    s.wallTop = gauss(Float64Array.from(M), 3).map((v, k) => Math.max(v, s.top[k] + 0.2));
  }
  console.log(`[hhp box] ${BOXES.length} structures: ${BOXES.map((s) => `${s.c.id} ${s.i0}-${s.i1} ${s.kind}${s.kind === 'park' ? ' ' + s.top[0].toFixed(2) : ''}`).join(', ')}`);
  return BOXES.length;
}

function regStrip(k) {
  const s = BOXES[k];
  for (let i = s.i0; i <= s.i1; i++) {
    const Q = quadOf(s, i);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const p of Q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let gx = Math.floor(x0 / QC); gx <= Math.floor(x1 / QC); gx++) for (let gz = Math.floor(z0 / QC); gz <= Math.floor(z1 / QC); gz++) { const key = gx * 100003 + gz; let a = QG.get(key); if (!a) QG.set(key, (a = [])); a.push([k, i]); }
  }
}
function addStrip(c, i0, i1, others, hits) {
  const n = i1 - i0 + 2;   // (stations i0 .. i1 + 1: the quads i0 .. i1)
  const lo = new Float64Array(n), ro = new Float64Array(n), up = new Float64Array(n).fill(NaN), pairJ = new Int32Array(n).fill(-1);
  let pair = null, hint = -1, nUp = 0;
  const riverHit = [0, 0];
  for (let k = 0; k < n; k++) {
    const i = i0 + k, x = c.X[i], z = c.Z[i];
    let l = -(c.WL[i] + 1), r = c.WR[i] + 1;
    // over it: another carriageway 2 m+ up at the station (the stack); beside it: the pair, 4-30 m off
    const hU = hits(x, z, 0).find((h) => h.c !== c && h.y > c.Y[i] + 2);
    if (hU) { up[k] = hU.y; nUp++; l = Math.min(l, -(hU.c.WL[hU.i] + 1)); r = Math.max(r, hU.c.WR[hU.i] + 1); }
    for (const o of others) {
      const [j, d] = nearestOn(o, x, z, o === pair ? hint : -1);
      if (j < 0 || d > 30) continue;
      const op = (o.X[j] - x) * c.NX[i] + (o.Z[j] - z) * c.NZ[i], wp = (o.WL[j] + o.WR[j]) / 2 + 1;
      // (within 8 m and 2 m+ up: the carriageway over this one, offset in plan: still a stack)
      if (d < 8 && o.Y[j] > c.Y[i] + 2) { if (!hU) { up[k] = o.Y[j]; nUp++; } r = Math.max(r, op + wp); l = Math.min(l, op - wp); continue; }
      if (d < 4) continue;
      pair = o; hint = j; pairJ[k] = j;
      if (op > 0) r = Math.max(r, op + wp); else l = Math.min(l, op - wp);
    }
    lo[k] = l; ro[k] = r;
    // the bulkhead: the river within 45 m of either side
    for (const sg of [-1, 1]) {
      const e0 = sg < 0 ? -l : r;
      for (let s = e0; s <= e0 + 45; s += 1) if (water(x + c.NX[i] * sg * s, z + c.NZ[i] * sg * s) && water(x + c.NX[i] * sg * (s + 1.5), z + c.NZ[i] * sg * (s + 1.5)) && water(x + c.NX[i] * sg * (s + 3), z + c.NZ[i] * sg * (s + 3))) { riverHit[sg < 0 ? 0 : 1]++; if (sg < 0) lo[k] = -Math.max(e0, s - 0.5); else ro[k] = Math.max(e0, s - 0.5); break; }
    }
  }
  const sr = riverHit[1] >= riverHit[0] ? (riverHit[1] > n * 0.2 ? 1 : 0) : (riverHit[0] > n * 0.2 ? -1 : 0);
  // (the river side's extent smoothed, the bulkhead's probe steps out; the other side's held at its own reach)
  // (the river side out to the land's farthest reach round each station before smoothing: the wall stands on the shore's
  // edge, no land left outside it)
  const rmax = (A, f) => A.map((_, k) => { let m = A[k]; for (let q = Math.max(0, k - 4); q <= Math.min(n - 1, k + 4); q++) m = f(m, A[q]); return m; });
  const loS = gauss(Float64Array.from(rmax(Array.from(lo), Math.min)), 3), roS = gauss(Float64Array.from(rmax(Array.from(ro), Math.max)), 3);
  for (let k = 0; k < n; k++) { lo[k] = sr < 0 ? Math.min(loS[k], -(c.WL[i0 + k] + 1)) : Math.min(lo[k], loS[k]); ro[k] = sr > 0 ? Math.max(roS[k], c.WR[i0 + k] + 1) : Math.max(ro[k], roS[k]); }
  const kind = nUp > n * 0.5 ? 'stack' : 'park';
  // (a stack ends where the carriageway over it leaves: the strip trimmed to the stations that have it)
  if (kind === 'stack') {
    let a = 0, b = n - 1; while (a < n && !Number.isFinite(up[a])) a++; while (b > a && !Number.isFinite(up[b])) b--;
    if (b - a < 11) return;
    const sl = (A) => A.slice(a, b + 1);
    return addStripArrays(c, i0 + a, i0 + b - 1, sl(lo), sl(ro), sl(up), sl(pairJ), pair, sr, 'stack');
  }
  return addStripArrays(c, i0, i1, lo, ro, up, pairJ, pair, sr, kind);
}
function addStripArrays(c, i0, i1, lo, ro, up, pairJ, pair, sr, kind) {
  const n = lo.length;
  const top = new Float64Array(n), soffit = new Float64Array(n);
  const samples = [];
  let floor = -Infinity;
  if (kind === 'stack') {
    // (the upper carriageway's level, bridged where the station missed it)
    const ks = []; for (let k = 0; k < n; k++) if (Number.isFinite(up[k])) ks.push(k);
    for (let k = 0; k < n; k++) {
      if (Number.isFinite(up[k])) top[k] = up[k];
      else { let a = -1, b = -1; for (const q of ks) { if (q < k) a = q; else if (b < 0) b = q; } top[k] = a < 0 ? up[b] : b < 0 ? up[a] : up[a] + (up[b] - up[a]) * (k - a) / (b - a); }
      top[k] -= 0.35; soffit[k] = top[k] - 0.85;   // (the walk a kerb's drop under the carriageway's edge)
    }
  } else {
    for (let k = 0; k < n; k += 2) {
      const i = i0 + k, j = pairJ[k];
      const yLow = j >= 0 ? Math.min(c.Y[i], pair.Y[j]) : c.Y[i], yHigh = j >= 0 ? Math.max(c.Y[i], pair.Y[j]) : c.Y[i];
      floor = Math.max(floor, yHigh + 4.9);
      for (let o = lo[k] + 1; o < ro[k] - 1; o += 3) { const g = haGradeAt(c.X[i] + c.NX[i] * o, c.Z[i] + c.NZ[i] * o); if (g !== null && g > yLow + 3) samples.push(g); }
    }
  }
  BOXES.push({ id: `${c.id}:${i0}`, c, i0, i1, kind, lo, ro, sr, top, soffit, pair, pairJ, samples, floor });
}
