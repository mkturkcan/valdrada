// GR07 (2026-10-27): which roofs draw as planted (sedum, membrane 5). The compiled green bit (roofKind 128) comes from
// The Nature Conservancy's green-roof survey joined by BIN or by the record's point (compile.mjs), and it is set on every
// footprint part of that lot: a Midtown tower whose podium terrace is 2-15 % planted drew its whole tower roof as a lawn
// in every aerial. The survey gives the planted area, so the bit is kept only where that area covers most of the part:
//   * a flat roof (shape 0; hips, gables and slate are never planted);
//   * no tower crowns: parts over GR_MAX_H carry their mechanical plant, never a lawn;
//   * the nearest survey record within 60 m + the part's size covers GR_MIN_COVER of the part's roof area.
// Everything else falls back to the membrane/gravel deck with its plant (roofEngine). ?gr07=0 restores the raw bit.
import { TNC_GREEN } from './greenRoofsTnc.js';
const GR07 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gr07') === '0');
export const GR_MAX_H = 120, GR_MIN_COVER = 0.5;
const CELL = 100, grid = new Map();
for (const r of TNC_GREEN) {
  const k = Math.floor(r[0] / CELL) + '_' + Math.floor(r[1] / CELL);
  let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(r);
}
function nearest(x, z, rad) {
  const n = Math.ceil(rad / CELL), gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
  let best = null, bd = rad * rad;
  for (let dz = -n; dz <= n; dz++) for (let dx = -n; dx <= n; dx++) {
    const a = grid.get((gx + dx) + '_' + (gz + dz)); if (!a) continue;
    for (const r of a) { const d = (r[0] - x) ** 2 + (r[1] - z) ** 2; if (d < bd) { bd = d; best = r; } }
  }
  return best;
}
// b: the tile record (roofKind still packed, height, area m2); cx, cz: the footprint's centroid in world metres
export function greenRoofKeep(b, cx, cz) {
  if (!(b.roofKind & 128)) return false;
  if (!GR07) return true;
  if ((b.roofKind & 7) !== 0 || !(b.height <= GR_MAX_H) || !(b.area > 0)) return false;
  const r = nearest(cx, cz, 60 + Math.sqrt(b.area));
  return !!r && r[2] >= GR_MIN_COVER * b.area;
}
