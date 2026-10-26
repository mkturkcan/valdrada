// Masonry arch viaducts: the High Bridge's granite arches (John B. Jervis, 1848) and the Washington Bridge's approach
// arches (1888), laid out in a bridge's frame (br/frame.js) beside its steel arch spans.
// A viaduct is a row of round arches between battered piers: each pier coursed granite from its footing to the impost band
// at the springing, a pilaster over it to the cornice; each arch a barrel vault with a ring of voussoirs proud of the
// spandrel, the spandrels laid in courses, a cornice the whole length and a parapet with a coping (an iron rail over it on
// a walkway). The arches are laid out from the steel span's ends outward at the bridge's real spans while the ground
// leaves room for them; piers step off the streets and highways under the bridge (the record's `under`); past the last
// arch the bridge runs on to its abutment as a solid wall.
import { slab, railing, block } from './parts.js';

const PI = Math.PI;
const nrmAt = (F, s) => F.at(s).n;

// the bays of one side: from the end pier at sStart outward (dir -1 toward s = 0, +1 toward L); spans [m, ...] in order of
// preference (the first spans as many times as spec.nMain allows, then the second); returns { piers: [s...], end }
export function layoutBays(F, rec, spec, sStart, dir, yTop) {
  const T = spec.pier, cover = spec.cover ?? 2.2, mg = spec.streetMargin ?? 0.4;
  // the stations a pier's centre may not take: every street or highway under the bridge, widened by half a pier and a margin
  const Z = (rec.under || []).filter((u) => u[2] < 0.5).map((u) => [u[0] - T / 2 - mg, u[1] + T / 2 + mg]).sort((p, q) => p[0] - q[0]);
  const zones = [];
  for (const z of Z) { const l = zones[zones.length - 1]; if (l && z[0] <= l[1]) l[1] = Math.max(l[1], z[1]); else zones.push(z.slice()); }
  const blocked = (s) => zones.some((z) => s > z[0] && s < z[1]);
  const ground = (s) => { const g = F.groundAt(s); return g === null ? -2 : g; };
  const fits = (cur, nxt) => {
    const sp = Math.abs(nxt - cur) - T, ys = yTop(Math.min(cur, nxt) + Math.abs(nxt - cur) / 2) - cover - sp / 2;
    let gmax = -1e9;
    for (let f = 0; f <= 8; f++) gmax = Math.max(gmax, ground(cur + (nxt - cur) * f / 8));
    return ys - gmax >= (spec.minPier ?? 2.5);
  };
  const lo = 0.7 * Math.min(...spec.spans), hi = 1.3 * Math.max(...spec.spans);
  const piers = [sStart];
  let cur = sStart, nMain = spec.nMain ?? 99, count = 0;
  while (count < (spec.max ?? 12)) {
    const want = spec.spans.length > 1 && nMain <= 0 ? spec.spans[1] : spec.spans[0];
    // the nominal next pier, else the free station nearest it with a span between lo and hi (every 0.5 m)
    let best = null;
    for (let d = 0; d <= hi - lo; d += 0.1) for (const sg of d ? [1, -1] : [1]) {
      const sp = want + sg * d;
      if (sp < lo || sp > hi || best !== null) continue;
      const nxt = cur + dir * (sp + T);
      if (nxt < 2 || nxt > F.L - 2 || blocked(nxt) || !fits(cur, nxt)) continue;
      best = nxt;
    }
    if (best === null) break;
    piers.push(best); cur = best; count++;
    if (want === spec.spans[0]) nMain--;
  }
  if (typeof process !== "undefined" && process.env && process.env.HB_DEBUG) console.log("[viaduct]", rec.key, dir, piers.map((p) => p.toFixed(1)).join(" "));
  return { piers, end: cur };
}

// a coursed battered pier at station s: half lengths a (along) and b (across) at the top y1, battered out by `bat` per metre
// toward the footing y0; courses of ch, each set back a little at its top edge (the joints)
export function pier(bag, F, mat, s, y0, y1, a, b, bat, ch) {
  const fr = F.at(s), t = fr.t, n = fr.n, c = F.P(s, 0, 0);
  const P = (aa, bb, y) => [c[0] + t[0] * aa + n[0] * bb, y, c[2] + t[2] * aa + n[2] * bb];
  const nC = Math.max(1, Math.round((y1 - y0) / ch)), h = (y1 - y0) / nC;
  for (let k = 0; k < nC; k++) {
    const ya = y0 + k * h, yb = ya + h, ea = (y1 - ya) * bat, eb = (y1 - yb) * bat, j = 0.03;
    const A = [P(-a - ea, -b - ea, ya), P(a + ea, -b - ea, ya), P(a + ea, b + ea, ya), P(-a - ea, b + ea, ya)];
    const B = [P(-a - eb, -b - eb, yb - 0.05), P(a + eb, -b - eb, yb - 0.05), P(a + eb, b + eb, yb - 0.05), P(-a - eb, b + eb, yb - 0.05)];
    const C = [P(-a - eb + j, -b - eb + j, yb), P(a + eb - j, -b - eb + j, yb), P(a + eb - j, b + eb - j, yb), P(-a - eb + j, b + eb - j, yb)];
    const out = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let i = 0; i < 4; i++) {
      const i2 = (i + 1) % 4, mx = (out[i][0] + out[i2][0]) / 2, mz = (out[i][1] + out[i2][1]) / 2;
      const N = [t[0] * mx + n[0] * mz, 0, t[2] * mx + n[2] * mz], L = Math.hypot(N[0], N[2]) || 1;
      const NN = [N[0] / L, 0, N[2] / L];
      bag.quad(mat, A[i], A[i2], B[i2], B[i], NN);
      bag.quad(mat, B[i], B[i2], C[i2], C[i], [NN[0] * 0.7, 0.7, NN[2] * 0.7]);
    }
    if (k === nC - 1) bag.poly(mat, C, [0, 1, 0]);
  }
}

// one arch bay between pier centres c0 < c1: the vault, the voussoir rings, the coursed spandrels on both faces
function bay(bag, F, M, c0, c1, T, half, yTop, cover, ch) {
  const u0 = c0 + T / 2, u1 = c1 - T / 2, r = (u1 - u0) / 2, um = (u0 + u1) / 2;
  const yc = yTop(um) - cover, ys = yc - r, ring = Math.min(1.1, Math.max(0.6, r * 0.09));
  const N = Math.max(12, Math.round(r * 2.2)) | 0;
  const arc = (k, rr) => { const a = PI - (k / N) * PI; return [um + Math.cos(a) * rr, ys + Math.sin(a) * rr, a]; };
  // the vault (the intrados, facing the arch's axis), in rings of stone
  for (let k = 0; k < N; k++) {
    const [sa, ya, aa] = arc(k, r), [sb, yb, ab] = arc(k + 1, r), am = (aa + ab) / 2;
    const nA = nrmAt(F, (sa + sb) / 2), t = F.at((sa + sb) / 2).t;
    const nIn = [-(t[0] * Math.cos(am)), -Math.sin(am), -(t[2] * Math.cos(am))];
    bag.quad(M.vault, F.P(sa, -half, ya), F.P(sb, -half, yb), F.P(sb, half, yb), F.P(sa, half, ya), nIn);
    void nA;
  }
  for (const sg of [-1, 1]) {
    const o = sg * half;
    const nF = (s) => { const n = nrmAt(F, s); return [n[0] * sg, 0, n[2] * sg]; };
    // the ring's back (the joints between the voussoirs) and the voussoirs, proud 0.12, a keystone 0.2
    const nV = Math.max(9, Math.round((PI * (r + ring / 2)) / 0.8)) | 1;
    for (let k = 0; k < nV; k++) {
      const a0 = PI - (k / nV) * PI, a1 = PI - ((k + 1) / nV) * PI, g = 0.025 / (r + ring / 2);
      const P = (a, rr, w) => F.P(um + Math.cos(a) * rr, o + sg * w, ys + Math.sin(a) * rr);
      const s_ = um + Math.cos((a0 + a1) / 2) * r;
      bag.quad(M.ring, P(a0, r, 0), P(a1, r, 0), P(a1, r + ring, 0), P(a0, r + ring, 0), nF(s_));
      const key = k === (nV - 1) / 2, rr = r + ring * (key ? 1.25 : 1), w = key ? 0.2 : 0.12;
      const b0 = a0 - g, b1 = a1 + g;
      bag.quad(M.ring, P(b0, r, w), P(b1, r, w), P(b1, rr, w), P(b0, rr, w), nF(s_));
      const am = (a0 + a1) / 2, tt = F.at(s_).t, nOut = [tt[0] * Math.cos(am), Math.sin(am), tt[2] * Math.cos(am)];
      bag.quad(M.ring, P(b0, rr, 0), P(b1, rr, 0), P(b1, rr, w), P(b0, rr, w), nOut);
      bag.quad(M.ring, P(b0, r, 0), P(b0, rr, 0), P(b0, rr, w), P(b0, r, w), [-tt[0] * Math.sin(am), Math.cos(am), -tt[2] * Math.sin(am)]);
    }
    // the spandrel in courses: each band [ya, yb] solid outside the arch's opening (taken at the band's foot, the step
    // behind the ring), from pier centre to pier centre, each course proud a little more or less
    const yTopL = Math.min(yTop(c0), yTop(c1)) - 0.9;
    const nB = Math.max(1, Math.round((yTopL - ys) / ch)), h = (yTopL - ys) / nB;
    for (let k = 0; k < nB; k++) {
      const ya = ys + k * h, yb = ya + h, p = 0.015 + 0.03 * frac(Math.sin((k + c0) * 12.9898) * 43758.5453);
      const dy = ya - ys, w = dy < r ? Math.sqrt(Math.max(0, r * r - dy * dy)) : -1;
      const segs = w > 0 ? [[c0, um - w], [um + w, c1]] : [[c0, c1]];
      for (const [a, b] of segs) {
        if (b - a < 0.05) continue;
        const sm = (a + b) / 2, n = nF(sm), w0 = sg * p;
        bag.quad(M.wall, F.P(a, o + w0, ya + 0.01), F.P(b, o + w0, ya + 0.01), F.P(b, o + w0, yb - 0.04), F.P(a, o + w0, yb - 0.04), n);
        bag.quad(M.wall, F.P(a, o + w0, yb - 0.04), F.P(b, o + w0, yb - 0.04), F.P(b, o, yb), F.P(a, o, yb), [n[0] * 0.7, 0.7, n[2] * 0.7]);
      }
    }
  }
  return { ys, yc, r };
}
const frac = (x) => x - Math.floor(x);

// a viaduct over stations [sA, sB] with pier centres `piers` (ascending): the piers, bays, pilasters, impost bands, the
// cornice and the parapet. M: { wall, ring, vault, pier, trim, rail? }; spec: { pier T, half, cover, ch, bat, parapet,
// walk } ; y(s) the walking or road surface
export function viaduct(bag, F, M, piers, y, spec) {
  const T = spec.pier, half = spec.half, cover = spec.cover ?? 2.2, ch = spec.ch ?? 0.62, bat = spec.bat ?? 0.012;
  const yTop = (s) => y(s) - 0.35;
  const ground = (s) => { const g = F.groundAt(s); return g === null ? -2.5 : g; };
  const P = piers.slice().sort((a, b) => a - b);
  const springs = new Map();
  for (let i = 0; i + 1 < P.length; i++) {
    const { ys } = bay(bag, F, M, P[i], P[i + 1], T, half, yTop, cover, ch);
    springs.set(P[i], Math.min(springs.get(P[i]) ?? 1e9, ys)); springs.set(P[i + 1], Math.min(springs.get(P[i + 1]) ?? 1e9, ys));
  }
  for (const s of P) {
    const ys = springs.get(s) ?? yTop(s) - cover, g = Math.min(ground(s - T / 2), ground(s + T / 2), ground(s)) - 1.0;
    pier(bag, F, M.pier, s, g, ys, T / 2, half, bat, ch * 1.4);
    // the impost band at the springing and the pilaster over the pier (proud 0.25) up to the cornice
    block(bag, F, M.trim, s - T / 2 - 0.12, s + T / 2 + 0.12, -half - 0.16, half + 0.16, ys - 0.55, ys);
    block(bag, F, M.wall, s - T * 0.36, s + T * 0.36, -half - 0.25, half + 0.25, ys, yTop(s) - 0.9);
  }
  const s0 = P[0] - T / 2, s1 = P[P.length - 1] + T / 2;
  // the cornice (a string course and the projecting cornice) and the parapet with its coping
  slab(bag, F, M.trim, s0, s1, -half - 0.3, half + 0.3, (s) => yTop(s) - 0.55, 0.35, 4);
  slab(bag, F, M.trim, s0, s1, -half - 0.12, half + 0.12, (s) => yTop(s) - 0.9 + 0.2, 0.2, 4, { top: false });
  for (const sg of [-1, 1]) {
    const o = sg * (half - 0.3);
    slab(bag, F, M.wall, s0, s1, o - 0.3, o + 0.3, (s) => y(s) + (spec.parapet ?? 1.0), (spec.parapet ?? 1.0) + 0.4, 4);
    slab(bag, F, M.trim, s0, s1, o - 0.36, o + 0.36, (s) => y(s) + (spec.parapet ?? 1.0) + 0.14, 0.14, 4);
    if (M.rail && spec.walk) railing(bag, F, M.rail, s0, s1, o, (s) => y(s) + (spec.parapet ?? 1.0) + 0.14, 1.2, 2.4, 0.05);
  }
  // the fill's top under the walkway or road (the record's surface)
  slab(bag, F, M.wall, s0, s1, -half + 0.6, half - 0.6, (s) => y(s) - 0.02, 0.4, 4, { bottom: false, caps: false });
  return { s0, s1, springs };
}

// a solid abutment wall from s0 to s1 (the bridge's run onto its bank past the last arch): coursed faces from the ground to
// the cornice, the cornice and parapet carried on
export function abutWall(bag, F, M, s0, s1, y, spec) {
  if (s1 - s0 < 1) return;
  const half = spec.half, ch = spec.ch ?? 0.62, yTop = (s) => y(s) - 0.35;
  const ground = (s) => { const g = F.groundAt(s); return g === null ? -2.5 : g; };
  const ss = F.range(s0, s1, 3);
  for (const sg of [-1, 1]) {
    const o = sg * half;
    for (let i = 0; i + 1 < ss.length; i++) {
      const a = ss[i], b = ss[i + 1], g = Math.min(ground(a), ground(b)) - 0.8, top = Math.min(yTop(a), yTop(b)) - 0.9;
      if (top - g < 0.3) continue;
      if ((spec.under || []).some((u) => u[2] < 0.5 && b > u[0] - 1 && a < u[1] + 1)) continue;   // (a street under: left open)
      const n = F.at((a + b) / 2).n, nn = [n[0] * sg, 0, n[2] * sg];
      const nB = Math.max(1, Math.round((top - g) / ch)), h = (top - g) / nB;
      for (let k = 0; k < nB; k++) {
        const ya = g + k * h, yb = ya + h, p = sg * (0.015 + 0.03 * frac(Math.sin((k + a) * 12.9898) * 43758.5453));
        bag.quad(M.wall, F.P(a, o + p, ya + 0.01), F.P(b, o + p, ya + 0.01), F.P(b, o + p, yb - 0.04), F.P(a, o + p, yb - 0.04), nn);
        bag.quad(M.wall, F.P(a, o + p, yb - 0.04), F.P(b, o + p, yb - 0.04), F.P(b, o, yb), F.P(a, o, yb), [nn[0] * 0.7, 0.7, nn[2] * 0.7]);
      }
    }
  }
  slab(bag, F, M.trim, s0, s1, -half - 0.3, half + 0.3, (s) => yTop(s) - 0.55, 0.35, 4);
  for (const sg of [-1, 1]) {
    const o = sg * (half - 0.3);
    slab(bag, F, M.wall, s0, s1, o - 0.3, o + 0.3, (s) => y(s) + (spec.parapet ?? 1.0), (spec.parapet ?? 1.0) + 0.4, 4);
    slab(bag, F, M.trim, s0, s1, o - 0.36, o + 0.36, (s) => y(s) + (spec.parapet ?? 1.0) + 0.14, 0.14, 4);
    if (M.rail && spec.walk) railing(bag, F, M.rail, s0, s1, o, (s) => y(s) + (spec.parapet ?? 1.0) + 0.14, 1.2, 2.4, 0.05);
  }
  slab(bag, F, M.wall, s0, s1, -half + 0.6, half - 0.6, (s) => y(s) - 0.02, 0.4, 4, { bottom: false, caps: false });
}
