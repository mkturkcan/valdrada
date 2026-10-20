// ============================================================================
// SKYSCRAPER CROWNS AND ROOF ARTICULATION            docs/notes/skyscrapers.md
// ----------------------------------------------------------------------------
// Owner review of the ad film: "not enough detail for skyscrapers". At 0.6-1.7 km
// (`mMidtownSky`, `fSkyline`, every aerial) a real Manhattan tower is read almost
// entirely from its TOP: a stepped 1916-zoning crown, a mechanical bulkhead, a
// deep parapet, a mast. Ours ended in a flat plane with a 0.9 m lip, so the
// skyline read as a bar chart of extruded boxes.
//
// Everything here is written into the tile's OWN merged GeoBuf, i.e. into the
// same draw call as the building it caps. That is the whole reason crowns are
// geometry and not instanced props:
//   * instanced roof props (roofEngine.js) are frustum/height culled and are
//     ~1 m objects — they carry nothing at 1 km;
//   * merged geometry costs triangles only (~110-260 per tower, ~60 k for a
//     Midtown near-ring) and zero draw calls, and it casts the crown's shadow.
//
// ERA WITHOUT A YEAR. The tile record has no `year_built` (compile.mjs reads
// PLUTO's year but consumes it inside classify.mjs). It is recoverable from
// `style`, because classify derives style FROM the year for every office
// building: <1920 CIVIC_STONE, 1920-44 DECO_MASONRY, 1945-79 MODERN_GLASS,
// >=1980 GLASS_TOWER_BLUE. So style is the era signal used below.
//
// THE WINDING RULE (same as assemble.js): footprint rings are shoelace-positive
// in (x, z), so the exterior normal of edge i->i+1 is (+ez, -ex) and quads are
// wound [y0, y1, y1', y0'] to match. Insets must preserve that winding, so every
// ring here is produced by scaling toward the centroid — never by reversing.
// ============================================================================
import earcut from 'earcut';
import { ringOffsetMiter, upTri } from './ringOffset.js';   // NM24

// facade-shader flag bits packed into aux2.w (assemble.js sets 1/2/4/8)
export const FF = { CORNICE: 1, BLIND: 2, ROOF: 4, STORE: 8, MECH: 16, CROWN: 32, FACEH: 64, FACEIN: 128 };
// `?e10=0` — round-10 edge/contact pass (docs/notes/edges-r10.md). Geometry side here:
// the mechanical penthouse gains a coping lip, and every parapet / bulkhead prism
// publishes its OWN height in aux3.z with FF.FACEH set, so the facade shader can place a
// contact on the prism's foot (the roof deck) instead of on the building's base 60 m below.
const E10 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('e10') === '0');
const RIM_M = 1.25;              // roof-deck rim band width, metres (matches assemble.js)
// Every bulkhead / mechanical penthouse gets the E10 coping lip, and the coping is PALE
// on all of them by design. The shader's own MAT9 rule turns 58 % of penthouses into
// brick or stucco (rendered ~0.25-0.34) and leaves 42 % as metal screen (~0.32-0.39 after
// the louvre mean), and the CPU cannot know which roll a building got — so the one cap
// value that contrasts with both is a precast/limestone pale. That is also what most of
// them really have: a stone or mill-finish aluminium cap flashing over a masonry box.
// Value chosen for the BLIND branch, which does not apply the facade's `pow(a,1.22)*0.88`
// (see assemble.js extrudePrism's colScale note) — 0.50 here lands near the tower
// parapet's own masonry coping at 0.62 * that calibration.
const MECH_OPTS = { coping: true, cop: [0.50, 0.49, 0.455] };

// a tower for this pass. 45 m is where a Manhattan roof stops being a roof and
// starts being a silhouette; below it the roofEngine's props do the work.
export const TOWER_H = 45;

const hash1 = (x) => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};

// ---------------------------------------------------------------- ring maths
function centroidOf(ring) {
  let cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x; cz += z; }
  return [cx / ring.length, cz / ring.length];
}
// mean radius from the centroid — lets an inset be specified in METRES, which
// is how a real setback works (the code line steps back 6-9 m, it does not
// shrink the plan by a percentage).
function meanRadius(ring, cx, cz) {
  let r = 0;
  for (const [x, z] of ring) r += Math.hypot(x - cx, z - cz);
  return r / ring.length;
}
function polyArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; a += x1 * z2 - x2 * z1; }
  return Math.abs(a) * 0.5;
}
function scaleRing(ring, f, cx, cz) {
  return ring.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f]);
}
// inset by `d` metres, clamped so the ring can never collapse or invert
function ringArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length]; a += x1 * z2 - x2 * z1; }
  return a / 2;
}
function pointInRing(x, z, ring) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) ins = !ins;
  }
  return ins;
}
const NM24T = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('nm24') === '0');
// FB38 (2026-10-11): every crown piece stands on its own building. A crown's tiers were scaled toward the footprint's
// vertex mean while its pylon and mast went to the most interior point of the roof, so on a footprint whose vertices
// bunch on one side the pylon could stand beside the tier stack instead of on it (the Majestic, 115 Central Park West:
// a 6.6 m box hanging 10 m over the roof). Now each piece goes inside the deck it stands on, a tier that would overhang
// the deck below ends the stack, the first tier rises from the roof deck instead of the parapet's top, and a box whose
// foot is still over a lower deck comes down to it. `?fb38=0` restores the old placement.
const FB38 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fb38') === '0');
function insetM(ring, d, cx, cz, minF = 0.3) {
  const R = meanRadius(ring, cx, cz);
  return scaleRing(ring, Math.max(minF, (R - d) / Math.max(R, 0.01)), cx, cz);
}
// FB38: a crown inset is a true offset of its ring where one exists (NM24's miter offset: every edge moves d inward,
// so the inset stays inside a notched plan), the scaled inset otherwise
function insetFB(ring, d, cx, cz, minF) {
  return (FB38 && ringOffsetMiter(ring, d)) || insetM(ring, d, cx, cz, minF);
}
// oriented bounding box in the ring's own dominant direction (long axis first)
function ringOBB(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const ang = Math.atan2(z2 - z1, x2 - x1);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [px, pz] of pts) {
      const rx = px * c - pz * s, rz = px * s + pz * c;
      if (rx < minX) minX = rx; if (rx > maxX) maxX = rx;
      if (rz < minZ) minZ = rz; if (rz > maxZ) maxZ = rz;
    }
    const area = (maxX - minX) * (maxZ - minZ);
    if (!best || area < best.area) best = { area, ang, minX, maxX, minZ, maxZ };
  }
  const c = Math.cos(best.ang), s = Math.sin(best.ang);
  const cxr = (best.minX + best.maxX) / 2, czr = (best.minZ + best.maxZ) / 2;
  let w = best.maxX - best.minX, h = best.maxZ - best.minZ, ang = best.ang;
  const center = [cxr * c - czr * s, cxr * s + czr * c];
  if (h > w) { const t = w; w = h; h = t; ang += Math.PI / 2; }
  return { w, h, ang, center };
}
// axis-aligned-in-OBB-frame rectangle ring, shoelace-positive in (x, z)
function rectRing(cx, cz, hw, hh, ang) {
  const c = Math.cos(ang), s = Math.sin(ang);
  const P = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
  const r = [P(-hw, -hh), P(hw, -hh), P(hw, hh), P(-hw, hh)];
  // shoelace sign check (the quad winding convention depends on it)
  let a = 0;
  for (let i = 0; i < 4; i++) { const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % 4]; a += x1 * z2 - x2 * z1; }
  return a >= 0 ? r : r.slice().reverse();
}

// RB34 (2026-10-02, QA Q07): a roof box must stand ON the roof. The crown pieces are centred on the footprint's OBB, and
// on a concave footprint (an L-shaped NYCHA slab, 2_-7:43 at 125th and Morningside) the OBB's centre lies in the notch:
// the slab's 7 m lift-and-tank bulkhead hung in the air over it and read from the street as a floating wing. A box (or a
// mast's centre: hw = hh = 0) is kept where its centre and corners are inside the ring; otherwise it moves to the most
// interior point of the ring (a grid search) and shrinks until it fits, or is left out (null). `?rb34=0` restores.
const RB34 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rb34') === '0');
function inRing(ring, x, z) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function boxInRing(ring, cx, cz, hw, hh, ang) {
  if (!inRing(ring, cx, cz)) return false;
  if (hw <= 0 && hh <= 0) return true;
  for (const [x, z] of rectRing(cx, cz, hw, hh, ang)) if (!inRing(ring, x, z)) return false;
  // FB38: corners inside a concave ring are not enough, a notch can cut across the box between them (the box then hangs
  // over the notch); no vertex of the ring may lie inside the box
  if (FB38) {
    const c = Math.cos(ang), s = Math.sin(ang);
    for (const [x, z] of ring) {
      const lx = (x - cx) * c + (z - cz) * s, lz = -(x - cx) * s + (z - cz) * c;
      if (Math.abs(lx) < hw - 1e-3 && Math.abs(lz) < hh - 1e-3) return false;
    }
  }
  return true;
}
function edgeDist(ring, x, z) {
  let d = 1e9;
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length];
    const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2));
    d = Math.min(d, Math.hypot(x - (ax + ex * t), z - (az + ez * t)));
  }
  return d;
}
function placeInside(ring, cx, cz, hw, hh, ang) {
  if (!RB34 || !ring || ring.length < 3 || boxInRing(ring, cx, cz, hw, hh, ang)) return { x: cx, z: cz, hw, hh };
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  let best = null, bd = -1;
  const N = 16;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = x0 + ((x1 - x0) * i) / N, z = z0 + ((z1 - z0) * j) / N;
    if (!inRing(ring, x, z)) continue;
    const d = edgeDist(ring, x, z);
    if (d > bd) { bd = d; best = [x, z]; }
  }
  if (!best) return null;
  if (hw <= 0 && hh <= 0) return { x: best[0], z: best[1], hw, hh };
  let w = hw, h = hh;
  for (let k = 0; k < 12; k++) {
    if (boxInRing(ring, best[0], best[1], w, h, ang)) return { x: best[0], z: best[1], hw: w, hh: h };
    w *= 0.85; h *= 0.85;
    if (w < 0.6 || h < 0.6) break;
  }
  return null;
}

// ------------------------------------------------------------- buffer writers
// One prism of walls. `aux2v` is [_, lit, colorVar, flags]; aux2.x is filled per
// wall with this wall's top in v-units (the shader stops its window grid 0.8 m
// under it — using the whole building height there sliced parapets).
// E10: `face` = { in } publishes this prism's own height (y1 - y0) in aux3.z and sets
// FF.FACEH (and FF.FACEIN for a roof-side face). aux3.z is the door pack on a windowed
// wall and unused on every blind/mech prism up here, so it costs no attribute.
function prism(buf, ring, y0, y1, col, aux, aux2v, baseRef, face = null) {
  const n = ring.length;
  const fH = E10 && face ? y1 - y0 : 0;
  const fl = aux2v[3] + (fH ? FF.FACEH : 0) + (fH && face.in ? FF.FACEIN : 0);
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    const ex = x2 - x1, ez = z2 - z1;
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    const nx = ez / len, nz = -ex / len;
    const a2 = [y1 - baseRef, aux2v[1], aux2v[2], fl];
    buf.quad(
      [x1, y0, z1], [x1, y1, z1], [x2, y1, z2], [x2, y0, z2],
      [nx, 0, nz], col,
      [0, y0 - baseRef, 0, y1 - baseRef, len, y1 - baseRef, len, y0 - baseRef],
      aux, a2, [len, (i * 7.3) % 97, fH],
    );
  }
}
// horizontal cap. membId picks the roof membrane in the facade shader (aux.z).
function cap(buf, ring, y, col, style, floorH, winW, aux2v, membId = 2) {
  const flat = [];
  for (const [x, z] of ring) flat.push(x, z);
  let tris;
  try { tris = earcut(flat); } catch { return; }
  const aux = [floorH, winW, membId, style];
  const a2 = [aux2v[0], aux2v[1], aux2v[2], FF.ROOF];
  // E10 RIM BAND — same construction as assemble.js `roofFill`: earcut only emits the
  // input ring's vertices, so a roof deck has no interior vertex to hang a
  // distance-to-parapet on. A 1.25 m band between the ring and its inset carries it in
  // uv.x as (1 + metres). The `minR` guard means a bulkhead LID (which also goes through
  // cap()) never gets one — only the decks that are big enough to have a parapet.
  if (E10 && ring.length >= 3 && ring.length <= 64) {
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    let minR = 1e9;
    for (const [x, z] of ring) minR = Math.min(minR, Math.hypot(x - cx, z - cz));
    // NM24: the band is exactly RIM_M wide (its uv codes the distance): a clean miter offset or no band
    const rin = minR > RIM_M * 2.4 ? (NM24T ? ringOffsetMiter(ring, RIM_M)
      : ring.map(([x, z]) => { const r = Math.hypot(x - cx, z - cz); const f = 1 - RIM_M / r; return [cx + (x - cx) * f, cz + (z - cz) * f]; })) : null;
    if (rin) {
      const n = ring.length, OUT = 1.0, IN = 1.0 + RIM_M;
      // a radial inset is not a polygon offset: on a concave ring it can self-intersect,
      // and earcut turns that into a bow tie. Shoelace ratio is the cheap guard.
      const ar = (p) => { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; } return a; };
      const a0 = ar(ring), a1 = ar(rin);
      if (a0 === 0 || a1 / a0 <= 0.20 || a1 / a0 >= 1.0) {
        for (let i = 0; i < tris.length; i += 3) {
          const A = [flat[tris[i] * 2], y, flat[tris[i] * 2 + 1]];
          const B = [flat[tris[i + 1] * 2], y, flat[tris[i + 1] * 2 + 1]];
          const C = [flat[tris[i + 2] * 2], y, flat[tris[i + 2] * 2 + 1]];
          upTri(buf, A, C, B, col, aux, a2);
        }
        return;
      }
      for (let i = 0; i < n; i++) {
        const O0 = ring[i], O1 = ring[(i + 1) % n];
        const I0 = rin[i], I1 = rin[(i + 1) % n];
        upTri(buf, [O0[0], y, O0[1]], [I1[0], y, I1[1]], [O1[0], y, O1[1]], col, aux, a2, [OUT, 0, IN, 0, OUT, 0]);
        upTri(buf, [O0[0], y, O0[1]], [I0[0], y, I0[1]], [I1[0], y, I1[1]], col, aux, a2, [OUT, 0, IN, 0, IN, 0]);
      }
      const flatI = [];
      for (const [x, z] of rin) flatI.push(x, z);
      let trisI; try { trisI = earcut(flatI); } catch { trisI = null; }
      if (trisI) {
        for (let i = 0; i < trisI.length; i += 3) {
          const A = [flatI[trisI[i] * 2], y, flatI[trisI[i] * 2 + 1]];
          const B = [flatI[trisI[i + 1] * 2], y, flatI[trisI[i + 1] * 2 + 1]];
          const C = [flatI[trisI[i + 2] * 2], y, flatI[trisI[i + 2] * 2 + 1]];
          upTri(buf, A, C, B, col, aux, a2, [IN, 0, IN, 0, IN, 0]);
        }
        return;
      }
    }
  }
  for (let i = 0; i < tris.length; i += 3) {
    const A = [flat[tris[i] * 2], y, flat[tris[i] * 2 + 1]];
    const B = [flat[tris[i + 1] * 2], y, flat[tris[i + 1] * 2 + 1]];
    const C = [flat[tris[i + 2] * 2], y, flat[tris[i + 2] * 2 + 1]];
    upTri(buf, A, C, B, col, aux, a2);   // NM24
  }
}
// horizontal ANNULUS between two rings (inner, outer) — the top surface of a
// parapet coping or a tier lip. Capping the whole polygon instead (which the
// first version did) paints the ENTIRE roof in the coping colour, so every
// tower ends in a flat slab and the roof deck, its membrane and all its props
// disappear under it. Winding: earcut output for a shoelace-positive ring is
// reversed by cap() to face up, so an up-facing strip triangle is likewise the
// reverse of the ring's own rotational order.
function strip(buf, inner, outer, y, col, aux, aux2v) {
  const n = Math.min(inner.length, outer.length);
  const a2 = [aux2v[0], aux2v[1], aux2v[2], FF.ROOF];
  for (let i = 0; i < n; i++) {
    const O0 = outer[i], O1 = outer[(i + 1) % n];
    const I0 = inner[i], I1 = inner[(i + 1) % n];
    // NM24: an inset of a concave ring can carry an edge across itself; wind each half up explicitly
    upTri(buf, [O0[0], y, O0[1]], [I1[0], y, I1[1]], [O1[0], y, O1[1]], col, aux, a2);
    upTri(buf, [O0[0], y, O0[1]], [I0[0], y, I0[1]], [I1[0], y, I1[1]], col, aux, a2);
  }
}
// a box in the OBB frame: 4 walls + a lid. Used for bulkheads, penthouses,
// stair houses and mast stages.
function box(buf, cx, cz, hw, hh, y0, y1, ang, col, aux, aux2v, baseRef, opts = null) {
  const r = rectRing(cx, cz, hw, hh, ang);
  // ---- E10 (brief C): THE COPING LIP. Both round-8 and round-9 blind passes named the
  // mechanical penthouse: "three plain faces, no coping, ~15 m across, in a hero
  // position", and round 9's verdict was explicit that the missing piece is GEOMETRY, not
  // more shader — "a coping lip and a recessed louvre bank ... a few triangles in
  // towers.js". A coping is what stops a bulkhead reading as an extruded rectangle: it
  // breaks the SILHOUETTE against the sky (a 0.10 m overhang all round), it puts a
  // shadow line under itself, and it is a different material from the box, so the box
  // gets a top edge even when it is one pixel wide. +8 triangles, no draw call, and it
  // is what every real Manhattan bulkhead has.
  if (E10 && opts && opts.coping && y1 - y0 > 1.8 && hw > 0.7 && hh > 0.7) {
    const cH = 0.28;
    prism(buf, r, y0, y1 - cH, col, aux, aux2v, baseRef, { in: false });
    const cr = rectRing(cx, cz, hw + 0.10, hh + 0.10, ang);
    const cc = opts.cop || [0.34, 0.35, 0.37];
    prism(buf, cr, y1 - cH - 0.06, y1, cc, aux, [aux2v[0], aux2v[1], aux2v[2], FF.BLIND], baseRef);
    cap(buf, cr, y1, cc.map((c) => c * 0.94), aux[3], aux[0], aux[1], [y1 - baseRef, aux2v[1], aux2v[2], FF.ROOF], 2);
    return;
  }
  // a box too small or too short for a coping still publishes its own height, so the
  // shader's deck contact (the cast curb and the silt in its corner) lands on it too
  prism(buf, r, y0, y1, col, aux, aux2v, baseRef, opts ? { in: false } : null);
  cap(buf, r, y1, col.map((c) => c * 0.92), aux[3], aux[0], aux[1], [y1 - baseRef, aux2v[1], aux2v[2], FF.ROOF], 2);
}
// tapered 4-sided mast stage (a frustum): the antenna/spire silhouette
function taper(buf, cx, cz, hw0, hh0, hw1, hh1, y0, y1, ang, col, aux, aux2v, baseRef) {
  const a = rectRing(cx, cz, hw0, hh0, ang), b = rectRing(cx, cz, hw1, hh1, ang);
  for (let i = 0; i < 4; i++) {
    const A = a[i], B = a[(i + 1) % 4], C = b[(i + 1) % 4], D = b[i];
    const ex = B[0] - A[0], ez = B[1] - A[1];
    const L = Math.hypot(ex, ez) || 1;
    const nx = ez / L, nz = -ex / L;
    const a2 = [y1 - baseRef, aux2v[1], aux2v[2], aux2v[3]];
    buf.quad([A[0], y0, A[1]], [D[0], y1, D[1]], [C[0], y1, C[1]], [B[0], y0, B[1]],
      [nx, 0.18, nz], col,
      [0, y0 - baseRef, 0, y1 - baseRef, L, y1 - baseRef, L, y0 - baseRef], aux, a2, [L, i * 3.1, 0]);
  }
  if (hw1 > 0.12) cap(buf, b, y1, col, aux[3], aux[0], aux[1], [y1 - baseRef, aux2v[1], aux2v[2], FF.ROOF], 2);
}

// Keep a roof box INSIDE the roof it stands on. A mechanical penthouse whose
// half-depth is 0.58 of the building's (which the first version allowed) is
// 116 % of the plan: it overhangs the parapet on both sides and reads as a slab
// hovering over the tower rather than as plant standing on it. Returns the
// clamped half-extent and the largest offset that still fits.
function fitBox(half, wantHalf, wantOff, margin = 0.46) {
  const h2 = Math.max(0.6, Math.min(wantHalf, half * 0.40));
  const room = Math.max(0, half * margin - h2);
  return [h2, Math.max(-room, Math.min(room, wantOff))];
}

// ------------------------------------------------------------------ archetype
// masonry eras (the shader's punched-window path) vs curtain wall
const MASONRY = new Set([0, 1, 2, 4, 5, 6, 7, 8, 12]);
export function crownKind(b) {
  const s = b.style, h = b.height;
  if (s === 3) return h > 55 ? 'modern' : 'flat';           // 1945-79 office
  if (s === 11) return h > 60 ? 'sculpt' : 'flat';          // >=1980 glass tower
  if (s === 12 || s === 2) return h > 40 ? 'slab' : 'flat'; // NYCHA / postwar brick
  if (s === 1 || s === 4 || s === 8) return h > 50 ? 'deco' : 'flat';
  return h > 70 ? 'deco' : 'flat';
}

// ============================================================================
// buildTower — the crown for ONE building. Called from assemble.js instead of
// the flat-roof + 0.9 m parapet lip when `b.height > TOWER_H`.
//
// Returns { roofRing, roofY, areaF } so the rooftop engine plants its tanks,
// dunnage and davits on the tier the crown actually left exposed.
// ============================================================================
// FB38: the sculpted crown's shoulder (and the cap on it) is an inset toward the vertex mean; on a notched plan it can
// reach past the roof, and then the tower takes the plain bulkhead instead
function sculptFits(pRing, ring, cx, cz) {
  const shoulder = insetFB(pRing, Math.max(1.2, meanRadius(ring, cx, cz) * 0.16), cx, cz, 0.3);
  if (!shoulder.every(([x, z]) => pointInRing(x, z, ring))) return false;
  const capR = insetFB(shoulder, Math.max(0.9, meanRadius(ring, cx, cz) * 0.16), cx, cz, 0.2);
  return capR.every(([x, z]) => pointInRing(x, z, shoulder));
}
export function buildTower(buf, ring, cx, cz, y0, topY, b, opts = {}) {
  const col = [b.r / 255, b.g / 255, b.b / 255];
  const h = b.height;
  const cv = b.colorVar;
  const aux = [b.floorH, b.winW, b.storeH, b.style];
  const blindAll = FF.BLIND;
  const mechFlags = FF.BLIND | FF.MECH;          // louvred metal screen, lit at night
  const crownFlags = FF.BLIND | FF.CROWN;       // coursed masonry crown, floodlit at night
  const obb = ringOBB(ring);
  const rectness = b.area / Math.max(1, obb.w * obb.h);
  const kind = opts.kind || crownKind(b);   // FP18: a penthouse's roof takes the plain bulkhead (opts.kind 'flat')
  const r0 = hash1(cv * 617.3 + 1.7), r1 = hash1(cv * 311.7 + 5.3), r2 = hash1(cv * 907.1 + 11.9);
  const masonry = MASONRY.has(b.style);
  // FB38: the decks a piece can stand on, lowest first (the roof over the footprint, then each crown tier)
  const support = [{ ring, y: topY }];
  const deckUnder = (x, z, yb) => { let best = null; for (const d of support) if (d.y <= yb + 0.5 && (best === null || d.y > best) && pointInRing(x, z, d.ring)) best = d.y; return best; };

  // ---- 1. PARAPET. A tower's parapet is 1.1-2.4 m with a proud coping, not the
  // 0.55-1.15 m lip every building gets. It is the dark line that separates a
  // roof from the sky at a kilometre, and the thing the eye uses to tell a
  // building's top from its side.
  const paraH = 1.05 + r0 * 1.25 + (h > 120 ? 0.5 : 0);
  const pRing = insetM(ring, 0.35, cx, cz);
  prism(buf, pRing, topY, topY + paraH, col.map((c) => c * 0.94), aux,
    [0, b.lit, cv, blindAll], y0, { in: false });
  // INNER face of the parapet. Quads are single-sided, so without this the
  // parapet is see-through from any camera above the roof plane — which is
  // every camera this pass exists for.
  prism(buf, pRing.slice().reverse(), topY, topY + paraH, col.map((c) => c * 0.66), aux,
    [0, b.lit, cv, blindAll], y0, { in: true });
  // coping: a 0.22 m band standing slightly PROUD of the parapet, so the top
  // edge catches the sun and the parapet face stays in its own shadow
  const cRing = scaleRing(pRing, 1.014, cx, cz);
  const cop = masonry ? [0.62, 0.60, 0.56] : [0.34, 0.35, 0.37];
  prism(buf, cRing, topY + paraH, topY + paraH + 0.22, cop, aux, [0, b.lit, cv, blindAll], y0);
  // coping TOP as an annulus over the parapet only — the roof deck inside must
  // stay visible (membrane, tanks, dunnage, the whole roofEngine programme)
  strip(buf, insetM(pRing, 0.42, cx, cz), cRing, topY + paraH + 0.22, cop,
    [b.floorH, b.winW, 2, b.style], [0, b.lit, cv, FF.ROOF]);
  // roof deck over the FULL footprint (the 0.35 m annulus outside the parapet
  // line would otherwise be a hole straight down the building)
  cap(buf, ring, topY, col.map((c) => c * 0.9), b.style, b.floorH, b.winW,
    [0, b.lit, cv, FF.ROOF], b.greenRoof ? 5 : b.membrane !== undefined ? b.membrane + 1 : 2);

  // ---- 1b. PIER CAPS. `refs/boroughs/deco-park-plaza-crown-03.jpg`: the
  // vertical brick piers of a prewar tower do not stop at the parapet, they
  // carry PAST it and terminate in stepped cast-stone caps, and the parapet
  // between them is battlemented. That broken roofline is the single strongest
  // silhouette cue a masonry tower has against the sky, and it is what makes a
  // real skyline a comb instead of a row of dominoes. Corner piers only (n <= 8
  // boxes, ~80 tris) — merlons along every edge would cost 500.
  if (masonry && h > 55 && r1 < 0.72) {
    const pierH = 1.1 + r2 * 1.6;
    const pw2 = Math.max(0.45, Math.min(1.5, meanRadius(ring, cx, cz) * 0.06));
    const pcol = col.map((c) => Math.min(1, c * 1.04));
    for (let i = 0; i < pRing.length && i < 10; i++) {
      const [vx, vz] = pRing[i];
      // pull the pier a touch inside the wall line so it cannot poke through
      let ix = cx + (vx - cx) * 0.985, iz = cz + (vz - cz) * 0.985;
      // FB38: centred on the corner, half the pier and its cap hung outside the roof over the street; it is drawn
      // where the whole cap block stands on the roof (pulled in along the line to the centre), or not at all
      if (FB38) {
        const L = Math.hypot(vx - cx, vz - cz) || 1;
        let fit = false;
        for (const f of [1.0, 1.5, 2.2, 3.0]) {
          const px = vx - ((vx - cx) / L) * pw2 * 1.32 * f, pz = vz - ((vz - cz) / L) * pw2 * 1.32 * f;
          if (boxInRing(ring, px, pz, pw2 * 1.32, pw2 * 1.32, obb.ang)) { ix = px; iz = pz; fit = true; break; }
        }
        if (!fit) continue;
      }
      box(buf, ix, iz, pw2, pw2, topY + (FB38 ? 0 : paraH * 0.2), topY + paraH + 0.22 + pierH, obb.ang, pcol, aux,
        [0, b.lit, cv, crownFlags], y0);
      // a stepped cap block, the cast-stone terminal in the reference
      box(buf, ix, iz, pw2 * 1.32, pw2 * 1.32, topY + paraH + 0.22 + pierH,
        topY + paraH + 0.22 + pierH + 0.34, obb.ang, cop, aux, [0, b.lit, cv, crownFlags], y0);
    }
  }

  let roofRing = pRing, roofY = topY, areaF = 1;

  // ---- 2. CROWN by era.
  // Stepped and shouldered crowns inset the ring toward its centroid, which is
  // only safe on a footprint that is roughly convex: on an L or a U the
  // centroid can sit OUTSIDE the polygon and the inset ring self-intersects,
  // which earcut then triangulates into a bow tie. Those fall back to a plain
  // bulkhead, which is what a courtyard block really has anyway.
  const steppable = rectness > 0.58 && obb.w > 8 && obb.h > 6;
  if (kind === 'deco' && steppable) {
    // 1916-zoning ziggurat: 2-4 stepped tiers over the shaft, each stepping
    // back a fixed number of METRES (that is how the zoning envelope works),
    // the last one a slender pylon. Limestone crowns sit lighter than the
    // brick shaft under them — the classic Midtown value break.
    const tiers = h > 150 ? 4 : h > 95 ? 3 : 2;
    const lite = col.map((c) => Math.min(1, c * (1.05 + r1 * 0.14)));
    let cur = scaleRing(pRing, 0.995, cx, cz);
    let yy = topY + paraH + 0.22;
    const stepM = Math.max(1.4, Math.min(7.5, meanRadius(ring, cx, cz) * 0.17));
    // CROWN BUDGET. `b.height` is the compiler's roof height, so a crown stack
    // rides ABOVE the building's real data. NYC zoning does let a mechanical
    // bulkhead stand over the roof line, but 30 m of wedding cake would make
    // every prewar tower 15 % taller than the record. The whole tier stack is
    // capped at 7 % of the height / 16 m and shared out between the tiers; the
    // mast is exempt because a real antenna genuinely is above `heightroof`.
    const budget = Math.min(16, Math.max(4.5, h * 0.07));
    const wSum = tiers + 0.4;                       // last tier weighs 1.4
    for (let t = 0; t < tiers; t++) {
      const nextT = insetFB(cur, stepM * (0.8 + hash1(cv * 71 + t * 13.7) * 0.5), cx, cz, 0.22);
      // FB38: a tier must stand inside the deck below it (an inset toward a vertex mean off a notched plan can overhang)
      if (FB38 && !nextT.every(([x, z]) => pointInRing(x, z, support[support.length - 1].ring))) break;
      cur = nextT;
      const th = (budget / wSum) * (t === tiers - 1 ? 1.4 : 1) * (0.82 + hash1(cv * 53 + t * 7.1) * 0.36);
      // tier wall (blind: a crown has no window grid to speak of at this range); FB38: the first rises from the roof deck
      prism(buf, cur, FB38 && t === 0 ? topY : yy, yy + th, lite, aux, [0, b.lit, cv, crownFlags], y0);
      const lip = scaleRing(cur, 1.02, cx, cz);
      prism(buf, lip, yy + th, yy + th + 0.35, cop, aux, [0, b.lit, cv, crownFlags], y0);
      cap(buf, cur, yy + th + 0.35, col.map((c2) => c2 * 0.62), b.style, b.floorH, b.winW,
        [0, b.lit, cv, FF.ROOF], 2);                         // tier terrace, membrane
      strip(buf, cur, lip, yy + th + 0.35, cop, [b.floorH, b.winW, 2, b.style], [0, b.lit, cv, FF.ROOF]);
      yy += th + 0.35;
      support.push({ ring: cur, y: yy });
      if (t === 0) { roofRing = cur; roofY = topY; areaF = 0.8; }
      if (meanRadius(cur, cx, cz) < 3.2) break;
    }
    // a mechanical pylon on the crown of the taller ones; FB38: inside the top deck, from that deck
    const deckTop = support[support.length - 1];
    if (h > 95 && r2 < 0.65) {
      const [pw] = fitBox(obb.w * 0.5, Math.max(1.6, obb.w * 0.13), 0);
      const [ph] = fitBox(obb.h * 0.5, Math.max(1.4, obb.h * 0.16), 0);
      const pyH = Math.min(9, 2.6 + r2 * 4.5 + h * 0.012);
      const pc = FB38 ? centroidOf(deckTop.ring) : obb.center;
      const pl0 = placeInside(FB38 ? deckTop.ring : ring, pc[0], pc[1], pw, ph, obb.ang);   // RB34
      const pyB = FB38 && pl0 ? (deckUnder(pl0.x, pl0.z, yy) ?? yy) : yy;
      if (pl0) box(buf, pl0.x, pl0.z, pl0.hw, pl0.hh, pyB, yy + pyH, obb.ang,
        lite.map((c) => c * 0.92), aux, [0, b.lit, cv, crownFlags], y0, MECH_OPTS);
      if (pl0 && FB38) support.push({ ring: rectRing(pl0.x, pl0.z, pl0.hw, pl0.hh, obb.ang), y: yy + pyH });
      if (pl0 || !FB38) yy += pyH;   // FB38: no pylon fitted, nothing to stand the mast on up there
    }
    // FB38: with no tier and no pylon drawn the mast rises from the roof deck, not from the parapet's top
    if (h > 175 || (h > 130 && r1 < 0.16)) mast(buf, obb, FB38 && support.length === 1 ? topY : yy, h, y0, b, cv, aux, FB38 ? support[support.length - 1].ring : ring);
  } else if (kind === 'modern') {
    // 1945-79 office slab: a big louvred mechanical penthouse pushed to one end
    // of the roof, a lower stair/lift head beside it, screen walls. Nearly every
    // Sixth Avenue slab reads exactly like this from the air.
    const c = Math.cos(obb.ang), s = Math.sin(obb.ang);
    const [mw, off] = fitBox(obb.w * 0.5, Math.max(2.4, obb.w * (0.22 + r1 * 0.14)), (r0 - 0.5) * obb.w * 0.34);
    const [mh] = fitBox(obb.h * 0.5, Math.max(2.2, obb.h * (0.28 + r2 * 0.16)), 0);
    const px = obb.center[0] + off * c, pz = obb.center[1] + off * s;
    const mHt = Math.max(4.2, Math.min(16, h * 0.055 + r0 * 4));
    const mech = [0.40 + r1 * 0.09, 0.41 + r1 * 0.09, 0.43 + r1 * 0.08];
    const pl1 = placeInside(ring, px, pz, mw, mh, obb.ang);   // RB34
    if (pl1) box(buf, pl1.x, pl1.z, pl1.hw, pl1.hh, topY, topY + paraH + mHt, obb.ang, mech, aux,
      [0, b.lit, cv, mechFlags], y0, MECH_OPTS);
    // stair head / lift overrun beside it
    const [sw, soff] = fitBox(obb.w * 0.5, Math.max(1.5, obb.w * 0.09), -off * 0.9);
    const [sh2] = fitBox(obb.h * 0.5, Math.max(1.4, obb.h * 0.16), 0);
    const sx = obb.center[0] + soff * c, sz = obb.center[1] + soff * s;
    const pl2 = placeInside(ring, sx, sz, sw, sh2, obb.ang);   // RB34
    if (pl2) box(buf, pl2.x, pl2.z, pl2.hw, pl2.hh, topY, topY + paraH + mHt * 0.62, obb.ang,
      mech.map((v) => v * 0.9), aux, [0, b.lit, cv, mechFlags], y0, MECH_OPTS);
    roofRing = pRing; roofY = topY; areaF = 0.6;
    // FB38: the mast stands on the penthouse it rises from (it went to the roof's centre, beside a penthouse pushed to one end)
    if (h > 185 || (h > 140 && r2 < 0.14)) {
      if (!FB38) mast(buf, obb, topY + paraH + mHt, h, y0, b, cv, aux, ring);
      else if (pl1) mast(buf, obb, topY + paraH + mHt, h, y0, b, cv, aux, rectRing(pl1.x, pl1.z, pl1.hw, pl1.hh, obb.ang));
      else mast(buf, obb, topY, h, y0, b, cv, aux, ring);
    }
  } else if (kind === 'sculpt' && steppable && (!FB38 || sculptFits(pRing, ring, cx, cz))) {
    // post-2000 tower: the crown is part of the massing — one inset shoulder,
    // then a tapered cap, then a spire on the tallest. Reads as a silhouette,
    // which is the whole point of these buildings.
    const sBud = Math.min(17, Math.max(5, h * 0.075));
    const sh1 = sBud * 0.62;
    const shoulder = insetFB(pRing, Math.max(1.2, meanRadius(ring, cx, cz) * 0.16), cx, cz, 0.3);
    // FB38: the shoulder rises from the roof deck (it hung over the deck by the parapet's height)
    prism(buf, shoulder, FB38 ? topY : topY + paraH + 0.22, topY + paraH + 0.22 + sh1, col, aux, [0, b.lit, cv, blindAll], y0);
    const capR = insetFB(shoulder, Math.max(0.9, meanRadius(ring, cx, cz) * 0.16), cx, cz, 0.2);
    const capH = sBud * 0.38;
    prism(buf, capR, topY + paraH + 0.22 + sh1, topY + paraH + 0.22 + sh1 + capH,
      [0.30, 0.32, 0.35], aux, [0, b.lit, cv, mechFlags], y0);
    cap(buf, capR, topY + paraH + 0.22 + sh1 + capH, [0.30, 0.32, 0.35], b.style, b.floorH, b.winW,
      [0, b.lit, cv, FF.ROOF], 2);
    // FB38: the shoulder's own top, round the cap (it was open: the cap stood on nothing and the deck showed through)
    if (FB38) strip(buf, capR, shoulder, topY + paraH + 0.22 + sh1, col.map((c) => c * 0.8), [b.floorH, b.winW, 2, b.style], [0, b.lit, cv, FF.ROOF]);
    roofRing = shoulder; roofY = topY; areaF = 0.55;
    if (h > 170 || (h > 125 && r0 < 0.18)) mast(buf, obb, topY + paraH + 0.22 + sh1 + capH, h, y0, b, cv, aux, FB38 ? capR : ring);
  } else if (kind === 'slab') {
    // NYCHA / postwar brick slab: one long lift-and-tank bulkhead on the ridge,
    // brick like the shaft, plus a stair head. No crown — that IS the look.
    const c = Math.cos(obb.ang), s = Math.sin(obb.ang);
    const [mw, off] = fitBox(obb.w * 0.5, Math.max(2.0, obb.w * (0.16 + r0 * 0.12)), (r2 - 0.5) * obb.w * 0.4);
    const [mh] = fitBox(obb.h * 0.5, Math.max(1.8, obb.h * (0.30 + r1 * 0.16)), 0);
    const pl3 = placeInside(ring, obb.center[0] + off * c, obb.center[1] + off * s, mw, mh, obb.ang);   // RB34
    if (pl3) box(buf, pl3.x, pl3.z, pl3.hw, pl3.hh,
      topY, topY + paraH + Math.max(3.4, 3.0 + r0 * 3.2), obb.ang,
      col.map((v) => v * 0.95), aux, [0, b.lit, cv, mechFlags], y0, MECH_OPTS);
    roofRing = pRing; roofY = topY; areaF = 0.75;
  } else {
    // everything else over 45 m: a modest bulkhead so no tower is bald
    if (rectness > 0.5 && obb.w > 6 && obb.h > 5) {
      const [mw] = fitBox(obb.w * 0.5, Math.max(1.6, obb.w * (0.15 + r0 * 0.1)), 0);
      const [mh] = fitBox(obb.h * 0.5, Math.max(1.5, obb.h * (0.24 + r1 * 0.14)), 0);
      const pl4 = placeInside(ring, obb.center[0], obb.center[1], mw, mh, obb.ang);   // RB34
      if (pl4) box(buf, pl4.x, pl4.z, pl4.hw, pl4.hh, topY,
        topY + paraH + Math.max(2.8, 2.4 + r2 * 3.0), obb.ang,
        (masonry ? col.map((v) => v * 0.92) : [0.40, 0.41, 0.43]), aux,
        [0, b.lit, cv, mechFlags], y0, MECH_OPTS);
    }
    roofRing = pRing; roofY = topY; areaF = 0.85;
  }
  return { roofRing, roofY, areaF, roofArea: polyArea(roofRing) * areaF };
}

// three-stage tapered mast with an obstruction light: the antenna silhouette
// that separates a 200 m tower from a 200 m box against the sky.
function mast(buf, obb, yBase, h, y0, b, cv, aux, ring = null) {
  const r = hash1(cv * 131.7 + 3.3);
  const total = Math.min(26, Math.max(7, h * (0.045 + r * 0.055)));
  const dark = [0.17, 0.175, 0.185];
  const w0 = Math.max(0.20, Math.min(0.80, obb.w * 0.016));   // a real antenna mast is 0.4-1.6 m across, not 4 m
  const plM = placeInside(ring, obb.center[0], obb.center[1], 0, 0, 0);   // RB34: never over a notch
  if (!plM) return;
  const cx = plM.x, cz = plM.z;
  let y = yBase;
  // a squat base house, then two tapering stages, then the pin
  taper(buf, cx, cz, w0 * 2.2, w0 * 2.2, w0 * 1.9, w0 * 1.9, y, y + total * 0.14, obb.ang, dark, aux, [0, b.lit, cv, FF.BLIND | FF.MECH], y0);
  y += total * 0.14;
  taper(buf, cx, cz, w0, w0, w0 * 0.78, w0 * 0.78, y, y + total * 0.52, obb.ang, dark, aux, [0, b.lit, cv, FF.BLIND | FF.MECH], y0);
  y += total * 0.52;
  taper(buf, cx, cz, w0 * 0.5, w0 * 0.5, w0 * 0.34, w0 * 0.34, y, y + total * 0.34, obb.ang, dark, aux, [0, b.lit, cv, FF.BLIND | FF.MECH], y0);
  y += total * 0.34;
  // aviation obstruction light: a red pip the night shader lifts to emissive
  box(buf, cx, cz, w0 * 0.34, w0 * 0.34, y, y + Math.max(0.5, w0 * 1.1), obb.ang, [0.55, 0.10, 0.10], aux,
    [0, b.lit, cv, FF.BLIND | FF.MECH | FF.CROWN], y0);
}

// ============================================================================
// SETBACK MASSING — the wedding cake. Replaces the old 3-tier 0.74/0.52
// centroid shrink, which stepped by a PERCENTAGE (so a 200 m tower and a 45 m
// one stepped back the same relative amount, and neither matched the zoning
// envelope). The 1916 resolution steps a fixed distance off the street line and
// then lets a slender tower rise on <=25 % of the lot, which is what this does.
// ============================================================================
export function buildSetbacks(buf, ring, cx, cz, y0, topY, b, opts, extrudePrism) {
  const h = b.height;
  const cv = b.colorVar;
  const R = meanRadius(ring, cx, cz);
  // FP18: opts.pentY / pentStep, a pre-war tower's penthouse storey: two tiers, the street wall to pentY, then the
  // penthouse set back pentStep metres (a true offset) on its terrace
  const pent = opts.pentY > y0 && opts.pentY < topY;
  const tiers = pent ? 2 : h > 150 ? 4 : h > 90 ? 3 : 2;
  const stepM = Math.max(1.6, Math.min(9, R * 0.19));
  // tier tops: the base block holds the street wall, the steps come fast, the
  // tower takes the top half
  const frac = tiers === 4 ? [0.34, 0.50, 0.63, 1.0] : tiers === 3 ? [0.38, 0.56, 1.0] : [0.46, 1.0];
  let cur = ring, prevY = y0, ringsOut = [];
  for (let t = 0; t < tiers; t++) {
    const yT = t === tiers - 1 ? topY : pent ? opts.pentY : y0 + h * frac[t];
    if (t === 0) extrudePrism(buf, cur, opts.fndY, yT, b, opts);
    else extrudePrism(buf, cur, prevY, yT, b, { baseRef: y0, noStore: true });
    // terrace deck left by the step above
    if (t < tiers - 1) {
      const next = pent ? insetFB(cur, opts.pentStep, cx, cz, 0.26) : insetM(cur, stepM * (0.85 + hash1(cv * 97 + t * 9.1) * 0.4), cx, cz, 0.26);
      // an inset of an L / U / notched footprint can flip a vertex outside the ring or fold the
      // polygon; extruded, that is a thin 250 m wall with a slab arm to the crown (critic r5, the
      // "needle over Midtown"). Every inset vertex must stay inside the tier below and the tier
      // must shrink — otherwise stop stepping and run the shaft straight to the top.
      { let ok = next.length >= 3 && Math.abs(ringArea(next)) < Math.abs(ringArea(cur)) * 0.97;
        for (let q = 0; ok && q < next.length; q++) if (!pointInRing(next[q][0], next[q][1], cur)) ok = false;
        if (!ok) { extrudePrism(buf, cur, yT, topY, b, { baseRef: y0, noStore: true }); return { top: cur, topY }; } }
      cap(buf, cur, yT, [b.r / 255 * 0.86, b.g / 255 * 0.86, b.b / 255 * 0.86], b.style, b.floorH, b.winW,
        [yT - y0, b.lit, cv, FF.ROOF], 3);
      // parapet around the terrace — the horizontal that makes a setback read
      const tp = insetM(cur, 0.3, cx, cz);
      prism(buf, tp, yT, yT + 0.95, [b.r / 255 * 0.95, b.g / 255 * 0.95, b.b / 255 * 0.95], [b.floorH, b.winW, b.storeH, b.style],
        [0, b.lit, cv, FF.BLIND], y0);
      cur = next;
      ringsOut.push(next);
    }
    prevY = yT;
  }
  return { top: cur, topY };
}

export const _internal = { ringOBB, insetM, meanRadius, rectRing, prism, cap, box, taper };

// ============================================================================
// FAR-LoD MACRO CROWNS
// ----------------------------------------------------------------------------
// Beyond nearR (820 m) the city is the compiler's macro: every building baked
// as its oriented bounding box — walls, then a roof fan — into an Int16 stream
// at 1/8 m (compile.mjs "far LoD"). Flat tops, no crowns, no masts. compile.mjs
// belongs to the lead and a four-borough recompile is 50 minutes, so the crowns
// for the far skyline are RECONSTRUCTED from the baked buffer at load time.
//
// The buffer is walkable because of how it is written: for each building, n
// wall quads (6 verts each) followed by an (n-2)-triangle roof fan in which
// EVERY triangle shares ring[0] as its first vertex. So:
//   * a triangle whose three y are equal is a roof triangle;
//   * a run of roof triangles sharing one first vertex is exactly one building;
//   * the fan pushes (ring[0], ring[i+1], ring[i]), so the ring comes back as
//     [t0.v0, t0.v2, t0.v1, t1.v1, t2.v1, ...].
// The preceding wall run gives the base, hence the height.
//
// Output is in the SAME encoding as the macro (Int16 at 1/8 m, macro-relative;
// colour as sRGB bytes with `lit` in alpha) so it draws with the SAME material
// and inherits its near-radius discard, night stipple, weather and re-lighting.
// One extra mesh per macro that actually HAS towers — in the four-borough set
// that is ~20 of 209 tiles, not 209.
// ============================================================================
const MACRO_CROWN_H = 55 * 8;   // 55 m, in 1/8 m units

export function buildMacroCrowns(pos, col) {
  const nv = pos.length / 3;
  const P = [], C = [];
  const y = (i) => pos[i * 3 + 1];
  const px = (i) => pos[i * 3], pz = (i) => pos[i * 3 + 2];
  let i = 0, towers = 0;
  while (i + 3 <= nv) {
    // ---- wall run
    let yB = 1e9, yT = -1e9, sawWall = false;
    while (i + 3 <= nv && !(y(i) === y(i + 1) && y(i + 1) === y(i + 2))) {
      if (y(i) < yB) yB = y(i); if (y(i + 1) < yB) yB = y(i + 1); if (y(i + 2) < yB) yB = y(i + 2);
      if (y(i) > yT) yT = y(i); if (y(i + 1) > yT) yT = y(i + 1); if (y(i + 2) > yT) yT = y(i + 2);
      i += 3; sawWall = true;
    }
    // ---- roof fan: same first vertex, same height, at most 6 triangles (the
    // compiler simplifies every ring to <= 8 points)
    const ring = [];
    let yR = null, fan0 = -1, colI = -1, tri = 0;
    while (i + 3 <= nv && y(i) === y(i + 1) && y(i + 1) === y(i + 2) && tri < 6) {
      if (yR === null) {
        yR = y(i); fan0 = i; colI = i;
        ring.push([px(i), pz(i)], [px(i + 2), pz(i + 2)], [px(i + 1), pz(i + 1)]);
      } else {
        if (y(i) !== yR || px(i) !== px(fan0) || pz(i) !== pz(fan0)) break;   // next building
        ring.push([px(i + 1), pz(i + 1)]);
      }
      i += 3; tri++;
    }
    if (!sawWall || yR === null || ring.length < 3) { if (!sawWall && yR === null) i += 3; continue; }
    const H = yT - yB;
    if (H < MACRO_CROWN_H) continue;
    // ---- footprint stats (axis-aligned is plenty at 1-10 km)
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const [rx, rz] of ring) { if (rx < x0) x0 = rx; if (rx > x1) x1 = rx; if (rz < z0) z0 = rz; if (rz > z1) z1 = rz; }
    const cx = (x0 + x1) * 0.5, cz = (z0 + z1) * 0.5;
    const hw = (x1 - x0) * 0.5, hh = (z1 - z0) * 0.5;
    if (hw < 24 || hh < 20) continue;                       // 3 m x 2.5 m: data noise
    // the roof fan carries colour * 0.5; recover something like the wall tone
    const cr = Math.min(255, col[colI * 4] * 1.7), cg = Math.min(255, col[colI * 4 + 1] * 1.7),
      cb = Math.min(255, col[colI * 4 + 2] * 1.7), lit = col[colI * 4 + 3];
    const warm = cr > cb + 6;                               // masonry vs glass, by hue
    const rnd = hash1(cx * 0.013 + cz * 0.029 + H * 0.0007);
    const rnd2 = hash1(cz * 0.017 + cx * 0.011 + 3.3);
    // the Manhattan grid runs ~29 deg off world axes, so an axis-aligned box
    // on a rotated tower shears against its own roof. Take the ring's longest
    // edge as the building frame and emit every crown piece in it.
    let eAng = 0, eBest = -1;
    for (let q2 = 0; q2 < ring.length; q2++) {
      const [ax0, az0] = ring[q2], [bx0, bz0] = ring[(q2 + 1) % ring.length];
      const dl = (bx0 - ax0) * (bx0 - ax0) + (bz0 - az0) * (bz0 - az0);
      if (dl > eBest) { eBest = dl; eAng = Math.atan2(bz0 - az0, bx0 - ax0); }
    }
    const eC = Math.cos(eAng), eS = Math.sin(eAng);
    // half-extents in the building frame (the axis-aligned bbox over-states a
    // rotated footprint by up to 40 %, which put bulkheads over the parapet)
    let bhw = 0, bhh = 0;
    for (const [rx, rz] of ring) {
      const lx = (rx - cx) * eC + (rz - cz) * eS, lz = -(rx - cx) * eS + (rz - cz) * eC;
      if (Math.abs(lx) > bhw) bhw = Math.abs(lx);
      if (Math.abs(lz) > bhh) bhh = Math.abs(lz);
    }
    const emit = (ox2, oz2, hwr, hhr, Y0, Y1, f) => {
      const R = Math.min(255, cr * f) | 0, G = Math.min(255, cg * f) | 0, B = Math.min(255, cb * f) | 0;
      const PT = (lx, lz) => [Math.round(cx + ox2 + lx * eC - lz * eS), Math.round(cz + oz2 + lx * eS + lz * eC)];
      const q = [PT(-hwr, -hhr), PT(hwr, -hhr), PT(hwr, hhr), PT(-hwr, hhr)];
      for (let s2 = 0; s2 < 4; s2++) {
        const [ax, az] = q[s2], [bx, bz] = q[(s2 + 1) % 4];
        for (const [vx, vy, vz] of [[ax, Y0, az], [ax, Y1, az], [bx, Y1, bz], [ax, Y0, az], [bx, Y1, bz], [bx, Y0, bz]]) {
          P.push(vx, vy, vz); C.push(R, G, B, lit);
        }
      }
      const lidC = [(R * 0.86) | 0, (G * 0.86) | 0, (B * 0.86) | 0];
      for (const [vx, vz] of [q[0], q[2], q[1], q[0], q[3], q[2]]) {
        P.push(vx, Y1, vz); C.push(lidC[0], lidC[1], lidC[2], lit);
      }
    };
    // ---- 1. mechanical bulkhead: every tower has one, and at 2 km it is the
    // difference between a building and a cut-out
    const [bw, bOx] = fitBox(bhw, bhw * (0.26 + rnd * 0.2), (rnd - 0.5) * bhw * 0.5);
    const [bh, bOz] = fitBox(bhh, bhh * (0.30 + rnd2 * 0.16), (rnd2 - 0.5) * bhh * 0.4);
    const bY = Math.max(28, Math.min(120, H * 0.055 + rnd * 40));  // 3.5-15 m
    emit(bOx, bOz, bw, bh, yR, yR + bY, warm ? 0.95 : 0.78);
    // ---- 2. stepped crown on the masonry-era towers (the wedding-cake tops
    // that make a real Midtown horizon a sawtooth and not a bar chart). Capped
    // at 7 % of the height, like the near-tile crowns: b.h is the ROOF height,
    // so a big stack here would make every prewar tower taller than its record.
    let yy = yR;
    if (warm && H > 70 * 8) {
      const tiers = H > 130 * 8 ? 3 : 2;
      const cBud = Math.min(130, Math.max(36, H * 0.07));
      let tw = bhw, th = bhh;
      for (let t = 0; t < tiers; t++) {
        tw *= 0.72 + hash1(cx * 0.007 + t * 3.1) * 0.12;
        th *= 0.72 + hash1(cz * 0.009 + t * 5.7) * 0.12;
        if (tw < 12 || th < 12) break;
        const sH = (cBud / tiers) * (0.8 + hash1(t * 7.3 + rnd * 11.0) * 0.4);
        emit(0, 0, tw, th, yy, yy + sH, 1.06 + t * 0.04);
        yy += sH;
      }
    }
    // ---- 3. mast on the tallest only (1 in ~12 towers, as in the real city)
    if (H > 150 * 8 || (H > 110 * 8 && rnd < 0.16)) {
      const mH = Math.min(300, Math.max(70, H * 0.085));
      const mw = Math.max(3, Math.min(9, bhw * 0.05));
      const base = Math.max(yy, yR + bY);
      emit(0, 0, mw * 2.0, mw * 2.0, base, base + mH * 0.16, 0.34);
      emit(0, 0, mw, mw, base + mH * 0.16, base + mH, 0.30);
    }
    towers++;
  }
  if (!towers) return null;
  return { pos: new Int16Array(P), col: new Uint8Array(C), towers };
}
