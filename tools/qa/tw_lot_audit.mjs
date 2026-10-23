// Tower kit landmarks: every tier ring of a TW spec must stand on its own lot (owner 2026-10-22: the Deutsche Bank
// Center's north tower stood 30 m out over Broadway). Reads the footprints dumped from the compiled tiles (vertex-mean
// frame, as world/assemble.js hands them) and lists vertices outside the lot by more than TOL metres.
//   node tools/qa/tw_lot_audit.mjs [tools/qa/tw_lots.json]   (exit 1 on any hit; the lots are the compiled buildings
//   that hold each landmark point of shared/landmarkSpec.js, matched by point: the tile indices in its comments are stale)
import fs from 'node:fs';
import { TW_SPECS } from '../../client/src/city/tk/tkLandmarks.js';
const TOL = 2.0;
const GE = [0.8746, 0.4848], GN = [0.4848, -0.8746];
const fps = JSON.parse(fs.readFileSync(process.argv[2] || new URL('./tw_lots.json', import.meta.url), 'utf8'));
function inside(r, x, z) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, zi] = r[i], [xj, zj] = r[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
function dist(r, x, z) { let d = 1e9; for (let i = 0; i < r.length; i++) { const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length]; const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); d = Math.min(d, Math.hypot(x - ax - t * dx, z - az - t * dz)); } return d; }
let bad = 0;
for (const [key, f] of Object.entries(fps)) {
  const spec = TW_SPECS[key]; if (!spec) continue;
  const cx = f.cx, cz = f.cz, ring = f.fp.map(([x, z]) => [x + cx, z + cz]);
  const W = (gx, gn) => [cx + gx * GE[0] + gn * GN[0], cz + gx * GE[1] + gn * GN[1]];
  const id = (r) => r;
  const L = { cx, cz, y0: 0, H: f.h, ring, W, pos: id, rect: (a, b, c, d) => [W(a, c), W(b, c), W(b, d), W(a, d)], poly: (p) => p.map(([a, b]) => W(a, b)),
    chamf: (a, b, c, d, k) => [W(a + k, c), W(b - k, c), W(b, c + k), W(b, d - k), W(b - k, d), W(a + k, d), W(a, d - k), W(a, c + k)], rectA: (a, b, c, d) => [W(a, c), W(b, c), W(b, d), W(a, d)] };
  let A2 = 0, ax = 0, az = 0;
  for (let i = 0; i < f.fp.length; i++) { const p = f.fp[i], q = f.fp[(i + 1) % f.fp.length], c = p[0] * q[1] - q[0] * p[1]; A2 += c; ax += (p[0] + q[0]) * c; az += (p[1] + q[1]) * c; }
  ax /= 3 * A2; az /= 3 * A2;
  const ga = [ax * GE[0] + az * GE[1], ax * GN[0] + az * GN[1]];
  L.rectA = (a, b, c, d) => L.rect(a + ga[0], b + ga[0], c + ga[1], d + ga[1]);
  let worst = 0, where = '';
  for (const m of spec.masses(L)) for (const t of m.tiers || []) for (const [x, z] of t.ring) if (!inside(ring, x, z)) { const d = dist(ring, x, z); if (d > worst) { worst = d; where = `tier to ${t.y1} m`; } }
  const hit = worst > TOL; bad += hit;
  console.log(`${hit ? 'OUT' : 'ok '} ${key} ${worst.toFixed(1)} m ${where}`);
}
process.exit(bad ? 1 : 0);
