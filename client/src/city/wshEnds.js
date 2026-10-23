// Road ends (HIGHWAYS P2): every chain end that hands over to a compiled street meets its paving without a gap or a step.
// After the chains' paving is laid (hhpPost), per tile: from the end's cross-section along the chain's direction, the
// street's asphalt is looked for (its laid surface within 1.5 m of the end's height, not the chain's own) every 0.25 m to
// 25 m; a connector of the same asphalt is laid from the end's edges to 3 m past the first such paving, its far edge 1.2 cm
// over the street's surface there (a cubic blend in height, no kink), its width the chain's at the end; where the street
// lies flush within 5 cm at the end no connector is laid. tile.__wshEnds: counts for the gate.
import { HHP_CH, hhpHits } from './hhp.js';
import { rfkDeckAsphalt } from './rfkHarlem.js';
import { roadsOf } from '../world/tiledata.js';
import { HA_BASE, haInfo } from '../world/heightAuthority.js';

const TILE = 512;
const ysAt = (a, x, z, out) => {
  for (let i = 0; i + 8 < a.length; i += 9) {
    const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
    if (x < Math.min(ax, bx, cx) - 0.01 || x > Math.max(ax, bx, cx) + 0.01 || z < Math.min(az, bz, cz) - 0.01 || z > Math.max(az, bz, cz) + 0.01) continue;
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d, w2 = 1 - w0 - w1;
    if (w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4) out.push(w0 * a[i + 1] + w1 * a[i + 4] + w2 * a[i + 7]);
  }
  return out;
};

export function wshRoadEnds(tile, ox, oz) {
  const S = tile.S, st = { ends: 0, flush: 0, connectors: 0, none: 0 };
  // (the RFK kit's ramps: their road surface in the tile's asphalt, the parkway's material, before the hand-overs are read)
  try { st.rfkDeck = rfkDeckAsphalt(tile, ox, oz, (x, z) => { const q = haInfo(x, z); return q && q.tag < 3 ? HA_BASE + q.relief : 3.24; }, (x, z, y) => hhpHits(x, z, 1.0).some((h) => Math.abs(h.y - y) < 1.5)); } catch (e) { st.rfkDeck = -1; }
  if (!S.asphalt || !HHP_CH.length) return st;
  const A = S.asphalt, add = [];
  // (the street's asphalt at (x, z) near y: not the chains' own paving)
  const street = (x, z, y) => {
    if (x < ox || x >= ox + TILE || z < oz || z >= oz + TILE) return null;
    if (hhpHits(x, z, 0.05).some((h) => Math.abs(h.y - y) < 0.3)) return null;
    let best = null;
    for (const v of ysAt(A, x - ox, z - oz, [])) if (Math.abs(v - y) < 1.5 && (best === null || Math.abs(v - y) < Math.abs(best - y))) best = v;
    return best;
  };
  for (const c of HHP_CH) c.ends.forEach((e, k) => {
    if (e.type !== 'compiled' || c.loop) return;
    const i = k === 0 ? 0 : c.n - 1, j = k === 0 ? 1 : c.n - 2;
    if (c.X[i] < ox || c.X[i] >= ox + TILE || c.Z[i] < oz || c.Z[i] >= oz + TILE) return;
    st.ends++;
    const tx = c.X[i] - c.X[j], tz = c.Z[i] - c.Z[j], L = Math.hypot(tx, tz) || 1, ux = tx / L, uz = tz / L;
    const offs = [-c.WL[i] * 0.8, 0, c.WR[i] * 0.8];
    const yE = (o) => c.Y[i] + c.E[i] * o;
    // (flush: the street's asphalt 0.5 m past the end within 5 cm at all three offsets)
    if (offs.every((o) => { const y = street(c.X[i] + ux * 0.5 + c.NX[i] * o, c.Z[i] + uz * 0.5 + c.NZ[i] * o, yE(o)); return y !== null && Math.abs(y - yE(o)) < 0.05; })) { st.flush++; return; }
    let dHit = null;
    for (let d = 0.25; d <= 25 && dHit === null; d += 0.25) if (street(c.X[i] + ux * d, c.Z[i] + uz * d, c.Y[i]) !== null) dHit = d;
    if (dHit === null) { st.none++; return; }
    const D = dHit + 3;
    // (the far edge on the street's surface, 1.2 cm over it; where it is missing at an offset, the centre's)
    const yc = street(c.X[i] + ux * D, c.Z[i] + uz * D, c.Y[i]);
    if (yc === null) { st.none++; return; }
    // (the width tapers from the chain's at its end to the street's at the far edge: the nearest compiled record end within
    // 20 m gives it)
    let sw = null;
    { const RV = S.roadVerts; let bd = 20; if (RV) for (const r of roadsOf(tile)) { if (r.segId >= 900000000) continue; for (const q of [0, r.len - 1]) { const x = RV[(r.start + q) * 3] + ox, z = RV[(r.start + q) * 3 + 2] + oz, d = Math.hypot(x - c.X[i], z - c.Z[i]); if (d < bd) { bd = d; sw = r.width; } } } }
    const N = 8, wl0 = c.WL[i], wr0 = c.WR[i], f = sw ? sw / (wl0 + wr0) : 1;
    const farY = (o) => { const y = street(c.X[i] + ux * D + c.NX[i] * o, c.Z[i] + uz * D + c.NZ[i] * o, yc); return (y === null ? yc : y) + 0.012; };
    const yFL = farY(-wl0 * f), yFR = farY(wr0 * f);
    const row = (q) => {
      const u = q / N, d = D * u, h = (u2) => 2 * u2 * u2 * u2 - 3 * u2 * u2 + 1;
      const pt = (o, yF) => { const y0 = yE(o); const y = h(u) * y0 + (1 - h(u)) * yF; return [c.X[i] + ux * d + c.NX[i] * o - ox, y, c.Z[i] + uz * d + c.NZ[i] * o - oz]; };
      const sm = u * u * (3 - 2 * u), wl = wl0 + (wl0 * f - wl0) * sm, wr = wr0 + (wr0 * f - wr0) * sm;
      return [pt(-wl, yFL), pt(wr, yFR)];
    };
    let prev = row(0);
    for (let q = 1; q <= N; q++) {
      const cur = row(q);
      const quad = [prev[0], prev[1], cur[1], cur[0]];
      // (wound up, as the chains' paving)
      const up = (a, b, c2) => ((b[2] - a[2]) * (c2[0] - a[0]) - (b[0] - a[0]) * (c2[2] - a[2])) > 0;
      for (const T of [[quad[0], quad[1], quad[2]], [quad[0], quad[2], quad[3]]]) { const t = up(T[0], T[1], T[2]) ? T : [T[0], T[2], T[1]]; for (const v of t) add.push(v[0], v[1], v[2]); }
      prev = cur;
    }
    st.connectors++;
    (st.list ||= []).push({ c: c.id, k, farW: +((wl0 + wr0) * f).toFixed(2), streetW: sw });
  });
  if (add.length) { const m = new Float32Array(A.length + add.length); m.set(A); m.set(add, A.length); S.asphalt = m; }
  tile.__wshEnds = st;
  return st;
}
