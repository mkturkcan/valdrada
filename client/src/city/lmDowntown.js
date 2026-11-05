// lmDowntown.js: the landmarks of lower Manhattan on their compiled footprint rings (LM65, 2026-10-31).
// The old builders (landmarks.js) were boxes, cones and a pyramid scaled from each footprint's bounding box. The City Hall,
// Financial District, World Trade Center and Battery dioramas see these buildings from 5 km through a long lens, where a
// pixel is about half a metre: what reads is the true massing (every setback at its measured height), the vertical rhythm
// of the piers, the copings and cornices of the tiers, the crowns and their materials. The massing of each comes from the
// city's 3D building model (lmDowntownData.js, lmTierKit.js); the faces, the ornament and the crowns are modelled here.
//   buildWoolworth: Cass Gilbert, 1913. The U of the 30-storey base with its copper mansard, the tower's three stages with
//     their notched corners, the corner turrets and pinnacles, the eight-sided copper pyramid with its dormers and the
//     lantern; cream terracotta faces (windows in pairs between continuous piers, the spandrels between floors), the Gothic
//     heads and pinnacles at every stage, the shop fronts.
//   build40Wall: H. Craig Severance, 1930. The stepped base on its L-shaped lot, the square shaft in buff brick over a
//     limestone base, its notched corners at the top, the steep copper pyramid with its dormers, the lantern and the spire.
//   build70Pine: Clinton and Russell, 1932. The many setbacks of the Art Deco tower, pale brick between continuous piers over
//     a limestone base, the stepped crown, the glazed observation room and the spire.
//   build28Liberty: Skidmore, Owings and Merrill, 1961. The slab with its aluminium-clad columns standing out of the long
//     faces, the grey glass and aluminium spandrels between them, the plant floors' louvres at the top, the plaza's granite.
// Everything is merged per material (lmFacadeKit.js accumulators) with painted canvas tiles (albedo, bump, roughness and
// metalness) and the kit's plain materials.
import * as THREE from 'three';
import { KIT } from './landmarkKit.js';
import { Acc, rgbs, speckle, streaks, addMeshes, triCount } from './lmFacadeKit.js';
import {
  tile3, tileMat3, fill3, path3, parseSurfaces, shiftFor, shiftSurfaces, stepWalls, runPt, runRot, capSurface, sweepRun,
  obox, ngon, ngonLathe, triN, fan, heightAt, inSurf,
} from './lmTierKit.js';
import { LD } from './lmDowntownData.js';

const { mat } = KIT;

/* ------------------------------------------------------------- the model */
// 2026-11-03 (the owner: Battery Park's buildings "just a single facade"): the 2014 model's roofs register a metre or two
// off the newer footprints, so a neighbour's roof reaches into a landmark as a long strip along the footprint's edge at
// the neighbour's height, and its walls stood as one-wall fins over the roof (28 Liberty's two, 0.47 m wide, 117 m long).
// A flat strip under 1 m wide (twice its area over its perimeter), 40 m or more round, every corner within 2.5 m of the
// footprint's edge and 3 m or more over the main roof is laid on the main roof's plane: no wall, no hole. (A crown's
// ledges are short and set back, a spire's facets sloped: none matches. The measured massing does the same:
// dev massing m64_build.py SLIVER)
function unSliver(R, ring) {
  if (R.length < 2 || !ring || ring.length < 3) return R;
  const main = R.reduce((a, q) => (q.A > a.A ? q : a), R[0]);
  const edgeD = (x, z) => {
    let d = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % ring.length], ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2)) : 0;
      d = Math.min(d, Math.hypot(x - ax - ex * t, z - az - ez * t));
    }
    return d;
  };
  for (const q of R) {
    if (q === main || !q.flat || q.h1 < main.h1 + 3) continue;
    let per = 0;
    for (let i = 0; i < q.P.length; i++) { const a = q.P[i], b = q.P[(i + 1) % q.P.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
    if (!(per >= 40) || !(q.A > 0) || (2 * q.A) / per >= 1.0 || !q.P.every(([x, z]) => edgeD(x, z) <= 2.5)) continue;
    const { a, b, c } = main.pl;
    q.P = q.P.map(([x, z]) => [x, z, a * x + b * z + c]);
    q.H = q.H.map((h) => h.map(([x, z]) => [x, z, a * x + b * z + c]));
    q.h0 = Math.min(...q.P.map((p) => p[2])); q.h1 = Math.max(...q.P.map((p) => p[2]));
    q.pl = { a, b, c }; q.flat = main.flat; q.sliver = true;
  }
  return R;
}
// a landmark's surfaces and cones moved onto the live ring
function model(ctx, key) {
  const ring = ctx.footprint, D = LD[key];
  if (!ring || ring.length < 4 || !D) return null;
  const shift = shiftFor(ring, D.ref);
  return {
    R: unSliver(shiftSurfaces(parseSurfaces(D.surf), shift), ring),
    SP: D.spires.map(([x, z, y0, y1, r]) => [x + shift[0], z + shift[1], y0, y1, r]),
  };
}
function bounds(R) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y1 = 0;
  for (const q of R) for (const [x, z, y] of q.P) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); y1 = Math.max(y1, y); }
  return { x0, x1, z0, z1, y1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
}

/* ------------------------------------------------------------- run layout */
// A wall run divided into whole window columns of `colW` metres between corner piers that take up the remainder
function layout(L, colW, cornerMin = 0.9) {
  const n = Math.max(0, Math.floor((L - 2 * cornerMin) / colW));
  return { n, cw: colW, s0: (L - n * colW) / 2 };
}
// a wall run's quad from y0 to y1 with u in columns counted from the layout's first column and v in floors from vRef
function runQuad(acc, w, y0, y1, lay, tex, floorH, vRef, ya = y1, yb = y1) {
  const U = (s) => (s - lay.s0) / lay.cw / tex.nx, V = (y) => (y - vRef) / (floorH * tex.ny);
  acc.quad([w.a[0], y0, w.a[1]], [w.b[0], y0, w.b[1]], [w.b[0], yb, w.b[1]], [w.a[0], ya, w.a[1]], [w.n[0], 0, w.n[1]],
    [U(0), V(y0)], [U(w.L), V(y0)], [U(w.L), V(yb)], [U(0), V(ya)]);
}
// The faces of every wall run: zoneOf(w, top, height) returns how a run is dressed, or null to leave it out:
//   { acc, tex, floor, col, vRef, corner, plain (an acc: one untextured quad), headH, headAcc, headTex, shopH, shopAcc, shopTex,
//     shopCol, trim (the acc of piers and mouldings), string, cornice, coping,
//     pier: { every, w, d, cd (corner depth), over, minH, pin(x, y, z, rot) },
//     groups(L, top, height): { pattern: [columns per group], gap (the pier between groups), corner (the corner piers) } }
// A run is cut in segments: the corner piers, the groups of window columns (each mapped to whole columns of the tile) and the
// piers between the groups; the piers are geometry standing out of the wall, the windows' wall is the run's plane.
function segmentsOf(L, z, top, hgt) {
  const G = z.groups ? z.groups(L, top, hgt) : null;
  if (G && G.pattern && G.pattern.length) {
    const n = G.pattern.reduce((a, b) => a + b, 0);
    const cw = (L - 2 * G.corner - (G.pattern.length - 1) * G.gap) / n;
    if (cw > z.col * 0.6 && cw < z.col * 1.6) {
      const segs = [{ pier: true, corner: true, s0: 0, s1: G.corner }];
      let s = G.corner;
      G.pattern.forEach((k, i) => {
        segs.push({ s0: s, s1: s + k * cw, n: k, cw });
        s += k * cw;
        if (i < G.pattern.length - 1) { segs.push({ pier: true, major: true, s0: s, s1: s + G.gap }); s += G.gap; }
      });
      segs.push({ pier: true, corner: true, s0: s, s1: L });
      return segs;
    }
  }
  const lay = layout(L, z.col, L < 6 ? 0.3 : (z.corner ?? 1.0));
  if (!z.pier || lay.n < 1) return [{ s0: 0, s1: L, n: Math.max(1, Math.round(L / z.col)), cw: L / Math.max(1, Math.round(L / z.col)), plainEnds: true }];
  const segs = [];
  if (lay.s0 > 0.05) segs.push({ pier: true, corner: true, s0: 0, s1: lay.s0 });
  segs.push({ s0: lay.s0, s1: lay.s0 + lay.n * lay.cw, n: lay.n, cw: lay.cw, uniform: true });
  if (lay.s0 > 0.05) segs.push({ pier: true, corner: true, s0: L - lay.s0, s1: L });
  return segs;
}
// a part of a run (s0..s1 from its start) from y0 to y1 (the top following a sloped run), u in columns from u0
function subQuad(acc, w, s0, s1, y0, y1, cw, u0, tex, floorH, vRef, topSlope = false) {
  const A = runPt(w, s0, 0), B = runPt(w, s1, 0);
  const ya = topSlope ? w.ya + (w.yb - w.ya) * (s0 / (w.L || 1)) : y1, yb = topSlope ? w.ya + (w.yb - w.ya) * (s1 / (w.L || 1)) : y1;
  const U = (s) => (u0 + (s - s0) / cw) / tex.nx, V = (y) => (y - vRef) / (floorH * tex.ny);
  acc.quad([A[0], y0, A[1]], [B[0], y0, B[1]], [B[0], yb, B[1]], [A[0], ya, A[1]], [w.n[0], 0, w.n[1]],
    [U(s0), V(y0)], [U(s1), V(y0)], [U(s1), V(yb)], [U(s0), V(ya)]);
}
function facadeRuns(runs, zoneOf) {
  for (const w of runs) {
    if (w.L < 0.3) continue;
    const top = Math.min(w.ya, w.yb), hgt = top - w.y0;
    const z = zoneOf(w, top, hgt);
    if (!z) continue;
    if (z.plain) { runQuad(z.plain, w, w.y0, top, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0, w.ya, w.yb); continue; }
    const headH = z.headH && hgt > z.headH * 1.6 ? z.headH : 0;
    const shop = z.shopH && w.y0 < 0.5 && top > z.shopH + 1;
    const y0 = shop ? z.shopH : w.y0, sloped = Math.abs(w.ya - w.yb) > 0.05;
    if (shop) {
      runQuad(z.shopAcc, w, 0, z.shopH, layout(w.L, z.shopCol || z.col * 2, 0.6), z.shopTex, z.shopH, 0);
      if (z.string) sweepRun(z.trim, w.a, w.b, w.n, z.shopH - 0.1, z.string, 0.15);
    }
    const segs = segmentsOf(w.L, z, top, hgt);
    const P = z.pier, rot = runRot(w);
    for (const g of segs) {
      if (g.pier) {
        if (!P || hgt < (P.minH ?? 4)) { subQuad(z.acc, w, g.s0, g.s1, y0, top, z.col, 0, z.tex, z.floor, z.vRef ?? 0, sloped); continue; }
        const d = g.corner ? (P.cd ?? P.d) : (P.md ?? P.d), wd = g.s1 - g.s0;
        const [px, pz] = runPt(w, (g.s0 + g.s1) / 2, d / 2 - 0.02);
        obox(z.trim, px, y0, pz, wd + (g.corner ? 0.03 : 0), top - y0 + (P.over ?? 0.25) + (g.corner ? 0.2 : 0), d + 0.02, rot);
        if (P.pin && hgt > 9 && (g.major || g.corner)) P.pin(px, top + (P.over ?? 0.25) + (g.corner ? 0.2 : 0), pz, -rot, g.corner);
        continue;
      }
      if (top - headH > y0) subQuad(z.acc, w, g.s0, g.s1, y0, top - headH, g.cw, 0, z.tex, z.floor, z.vRef ?? 0, sloped && !headH);
      if (headH) subQuad(z.headAcc, w, g.s0, g.s1, top - headH, top, g.cw, 0, z.headTex, headH, top - headH, sloped);
      if (P && g.uniform && hgt > (P.minH ?? 4)) {               // thin piers inside a uniform run: every `every` columns
        for (let c = P.every; c < g.n; c += P.every) {
          const [px, pz] = runPt(w, g.s0 + c * g.cw, P.d / 2);
          obox(z.trim, px, y0, pz, P.w, top - y0 + (P.over ?? 0.25), P.d, rot);
          if (P.pin && hgt > 9) P.pin(px, top + (P.over ?? 0.25), pz, -rot, false);
        }
      }
    }
    if (z.trim && w.L > 0.8) {
      if (headH && z.cornice) sweepRun(z.trim, w.a, w.b, w.n, top - 0.15, z.cornice, (z.cornice[z.cornice.length - 2] || [0.6])[0]);
      else if (z.coping && hgt > 1.2) sweepRun(z.trim, w.a, w.b, w.n, top - 0.1, z.coping, 0.12);
    }
  }
}

/* ---------------------------------------------------------------- painters */
// One storey of a tower bay per cell (nx columns x ny floors, row 0 the top floor): the wall (smooth, brick or ashlar), a
// window over a spandrel panel. o: wall, spand, glass, frame, win [x0, x1, y0, y1] (cell fractions, y from the top),
// sash ('dh', 'case', 'none'), brick (course px), ashlar (course px), mull (a light strip at the cell edges: width fraction),
// orn ('tre' trefoils, 'deco' chevrons, 'none'), rough, tone
function bayPaint(o) {
  const O = Object.assign({ win: [0.16, 0.84, 0.12, 0.74], sash: 'dh', brick: 0, ashlar: 0, mull: 0, orn: 'none', rough: 0.7, tone: 0.04, blinds: 0.25 }, o);
  return (ga, gb, go, W, H, r) => {
    const cw = W / O.nx, fh = H / O.ny;
    fill3(ga, gb, go, 0, 0, W, H, O.wall, 150, O.rough, 0);
    speckle(ga, 0, 0, W, H, r, Math.round(W * H / 60), 0.05);
    if (O.brick) for (let y = 0; y < H; y += O.brick) {
      ga.fillStyle = `rgba(30,22,14,${0.06 + r() * 0.05})`; ga.fillRect(0, y, W, 1); gb.fillStyle = 'rgb(125,125,125)'; gb.fillRect(0, y, W, 1);
      for (let k = 0; k < W / (O.brick * 3); k++) {
        ga.fillStyle = r() < 0.5 ? `rgba(0,0,0,${(0.03 + r() * 0.05).toFixed(3)})` : `rgba(255,240,215,${(0.03 + r() * 0.05).toFixed(3)})`;
        ga.fillRect(r() * W, y + 1, O.brick * (2 + r() * 2), O.brick - 1);
      }
    }
    if (O.ashlar) for (let y = 0, row = 0; y < H; y += O.ashlar, row++) {
      ga.fillStyle = 'rgba(40,32,24,0.22)'; ga.fillRect(0, y, W, 1.5); gb.fillStyle = 'rgb(105,105,105)'; gb.fillRect(0, y, W, 2);
      for (let x = (row % 2) * O.ashlar * 1.4; x < W; x += O.ashlar * 2.8) { ga.fillRect(x, y, 1.5, O.ashlar); gb.fillRect(x, y, 2, O.ashlar); }
    }
    for (let j = 0; j < O.ny; j++) for (let i = 0; i < O.nx; i++) {
      const x = i * cw, y = j * fh, t = 1 + (r() - 0.5) * 2 * O.tone;
      const [fx0, fx1, fy0, fy1] = O.win;
      const wx0 = x + cw * fx0, wx1 = x + cw * fx1, wy0 = y + fh * fy0, wy1 = y + fh * fy1;
      if (O.spand) {                                     // the spandrel panel under the window and its head over it
        fill3(ga, gb, go, wx0, wy1, wx1 - wx0, y + fh - wy1, rgbs(O.spand, t), 118, O.rough, O.spandMetal || 0);
        fill3(ga, gb, go, wx0, y, wx1 - wx0, wy0 - y, rgbs(O.spand, t), 118, O.rough, O.spandMetal || 0);
        ga.fillStyle = 'rgba(0,0,0,0.18)'; ga.fillRect(wx0, wy1, wx1 - wx0, Math.max(1.5, fh * 0.02));
        if (O.orn === 'tre') {
          ga.strokeStyle = rgbs(O.wall, 1.02); ga.lineWidth = Math.max(1, cw * 0.025); gb.strokeStyle = 'rgb(172,172,172)'; gb.lineWidth = ga.lineWidth;
          const k = 3, pw = (wx1 - wx0) / k, sy = wy1 + (y + fh - wy1) * 0.62, rr = Math.min(pw, y + fh - wy1) * 0.3;
          for (const g of [ga, gb]) for (let q = 0; q < k; q++) { g.beginPath(); g.arc(wx0 + pw * (q + 0.5), sy, rr, Math.PI, 0); g.stroke(); }
        } else if (O.orn === 'deco') {
          ga.strokeStyle = rgbs(O.spand, 1.25); ga.lineWidth = Math.max(1, cw * 0.03); gb.strokeStyle = 'rgb(176,176,176)'; gb.lineWidth = ga.lineWidth;
          const sy0 = wy1 + 2, sy1 = y + fh - 2;
          for (const g of [ga, gb]) { g.beginPath(); g.moveTo(wx0 + 2, sy1); g.lineTo((wx0 + wx1) / 2, sy0 + 1); g.lineTo(wx1 - 2, sy1); g.stroke(); }
        }
      }
      fill3(ga, gb, go, wx0, wy0, wx1 - wx0, wy1 - wy0, rgbs(O.frame, 0.9 + r() * 0.2), 70, 0.45, O.frameMetal ?? 0.2);
      const fr = Math.max(2, cw * 0.05), sky = r() < 0.45, k = 0.85 + r() * 0.35;
      const panes = O.sash === 'dh' ? [[wy0 + fr, (wy0 + wy1) / 2 - fr * 0.5], [(wy0 + wy1) / 2 + fr * 0.5, wy1 - fr]] : [[wy0 + fr, wy1 - fr]];
      for (const [p0, p1] of panes) {
        const gl = ga.createLinearGradient(0, p0, 0, p1);
        gl.addColorStop(0, rgbs(sky ? O.glassSky || [104, 118, 132] : O.glass.map((v) => v * 1.4), k)); gl.addColorStop(1, rgbs(O.glass, k));
        ga.fillStyle = gl; ga.fillRect(wx0 + fr, p0, wx1 - wx0 - 2 * fr, p1 - p0);
        fill3(null, gb, go, wx0 + fr, p0, wx1 - wx0 - 2 * fr, p1 - p0, null, 50, 0.08, 0.1);
      }
      if (O.sash === 'case') fill3(ga, gb, go, (wx0 + wx1) / 2 - fr * 0.4, wy0, fr * 0.8, wy1 - wy0, rgbs(O.frame), 90, 0.45, 0.2);
      if (r() < O.blinds) fill3(ga, gb, go, wx0 + fr, wy0 + fr, wx1 - wx0 - 2 * fr, (wy1 - wy0 - 2 * fr) * (0.1 + r() * 0.5), rgbs([196, 188, 166], 0.8 + r() * 0.2), 60, 0.8, 0);
      ga.fillStyle = 'rgba(0,0,0,0.36)'; ga.fillRect(wx0, wy0, wx1 - wx0, Math.max(2, fh * 0.03));
      fill3(ga, gb, go, wx0 - cw * 0.02, wy1, wx1 - wx0 + cw * 0.04, Math.max(2, fh * 0.025), rgbs(O.wall, 1.05), 200, O.rough, 0);   // the sill
    }
    if (O.mull) for (let i = 0; i <= O.nx; i++) {
      const x = i * cw;
      fill3(ga, gb, go, x - cw * O.mull / 2, 0, cw * O.mull, H, rgbs(O.wall, 1.04), 178, O.rough, 0);
      ga.fillStyle = 'rgba(40,34,26,0.16)'; ga.fillRect(x + cw * O.mull / 2, 0, cw * 0.03, H);
    }
    streaks(ga, 0, 0, W, H, r, Math.round(O.nx * O.ny * 1.5), 0.05);
  };
}
// a Gothic head under a cornice: pointed arches over the last windows, a small-arched frieze under the cornice
function gothicHeadPaint(o) {
  return (ga, gb, go, W, H, r) => {
    const cw = W / o.nx;
    fill3(ga, gb, go, 0, 0, W, H, o.wall, 160, 0.6, 0);
    speckle(ga, 0, 0, W, H, r, Math.round(W * H / 50), 0.06);
    for (let i = 0; i < o.nx; i++) {
      const x0 = i * cw + cw * 0.14, x1 = (i + 1) * cw - cw * 0.14, xm = (x0 + x1) / 2, ya = H * 0.3, yb = H * 0.62;
      const arch = (g) => { g.moveTo(x0, H); g.lineTo(x0, yb); g.quadraticCurveTo(x0, ya + (yb - ya) * 0.2, xm, ya); g.quadraticCurveTo(x1, ya + (yb - ya) * 0.2, x1, yb); g.lineTo(x1, H); g.closePath(); };
      path3(ga, gb, go, arch, rgbs(o.glass, 1.2 + r() * 0.3), 55, 0.1, 0);
      for (const [g, col] of [[ga, rgbs(o.wall, 1.06)], [gb, 'rgb(205,205,205)']]) {
        g.strokeStyle = col; g.lineWidth = Math.max(2, cw * 0.07);
        g.beginPath(); g.moveTo(x0 - cw * 0.05, yb + 2); g.quadraticCurveTo(x0 - cw * 0.05, ya - (yb - ya) * 0.1, xm, ya - H * 0.06); g.quadraticCurveTo(x1 + cw * 0.05, ya - (yb - ya) * 0.1, x1 + cw * 0.05, yb + 2); g.stroke();
        g.beginPath(); g.moveTo(xm, ya - H * 0.06); g.lineTo(xm, H * 0.05); g.stroke();
        g.lineWidth = Math.max(1.5, cw * 0.05); g.beginPath(); g.moveTo(xm, ya + 4); g.lineTo(xm, H); g.stroke();
      }
    }
    const k = o.nx * 6, aw = W / k;
    for (let q = 0; q < k; q++) for (const [g, col, lw] of [[ga, 'rgba(60,50,40,0.35)', 1.2], [gb, 'rgb(110,110,110)', 1.5]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(q * aw + aw / 2, H * 0.14, aw * 0.42, Math.PI, 0); g.stroke();
    }
    ga.fillStyle = 'rgba(30,24,18,0.25)'; ga.fillRect(0, 0, W, Math.max(2, H * 0.03));
  };
}
// the head of a Gothic stage: per column a lancet window through `floors` storeys (a mullion, a transom at every floor, a
// trefoil in its point, the hood mould over it), the corbel table of small arches under the cornice
function lancetPaint(o) {
  return (ga, gb, go, W, H, r) => {
    const cw = W / o.nx, fl = o.floors, fh = (H * 0.84) / fl;
    fill3(ga, gb, go, 0, 0, W, H, o.wall, 160, o.rough ?? 0.6, 0);
    speckle(ga, 0, 0, W, H, r, Math.round(W * H / 50), 0.06);
    for (let i = 0; i < o.nx; i++) {
      const x0 = i * cw + cw * 0.2, x1 = (i + 1) * cw - cw * 0.2, xm = (x0 + x1) / 2, hw = (x1 - x0) / 2;
      const yb = H, ys = H * 0.16 + hw * 1.1, ya = H * 0.16;          // the sill, the springing, the point
      const arch = (g) => { g.moveTo(x0, yb); g.lineTo(x0, ys); g.quadraticCurveTo(x0, ya + (ys - ya) * 0.15, xm, ya); g.quadraticCurveTo(x1, ya + (ys - ya) * 0.15, x1, ys); g.lineTo(x1, yb); g.closePath(); };
      path3(ga, gb, go, arch, rgbs(o.glass, 1.1 + r() * 0.3), 55, 0.12, 0.1);
      for (const [g, col, lw] of [[ga, rgbs(o.frame || o.wall, 0.95), Math.max(1.5, cw * 0.035)], [gb, 'rgb(150,150,150)', Math.max(1.5, cw * 0.035)]]) {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath(); g.moveTo(xm, ys - hw * 0.4); g.lineTo(xm, yb); g.stroke();                          // the mullion
        for (let k = 1; k < fl; k++) { const yy = yb - k * fh; if (yy > ys) { g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); } }
        g.beginPath(); g.arc(xm, ya + (ys - ya) * 0.62, hw * 0.42, 0, Math.PI * 2); g.stroke();             // the trefoil's ring
      }
      for (const [g, col] of [[ga, rgbs(o.wall, 1.07)], [gb, 'rgb(210,210,210)']]) {                    // the hood mould
        g.strokeStyle = col; g.lineWidth = Math.max(2, cw * 0.06);
        g.beginPath(); g.moveTo(x0 - cw * 0.06, ys + 3); g.quadraticCurveTo(x0 - cw * 0.06, ya - H * 0.01, xm, ya - H * 0.035); g.quadraticCurveTo(x1 + cw * 0.06, ya - H * 0.01, x1 + cw * 0.06, ys + 3); g.stroke();
      }
      ga.fillStyle = 'rgba(0,0,0,0.3)'; ga.fillRect(x0, ys, 3, yb - ys);
    }
    const k = o.nx * 5, aw = W / k;                                                                     // the corbel table
    for (let q = 0; q < k; q++) for (const [g, col, lw] of [[ga, 'rgba(60,50,40,0.4)', 1.5], [gb, 'rgb(100,100,100)', 2]]) {
      g.strokeStyle = col; g.lineWidth = lw; g.beginPath(); g.arc(q * aw + aw / 2, H * 0.1, aw * 0.4, Math.PI, 0); g.stroke();
      g.beginPath(); g.moveTo(q * aw, H * 0.1); g.lineTo(q * aw, H * 0.13); g.stroke();
    }
    ga.fillStyle = 'rgba(30,24,18,0.3)'; ga.fillRect(0, 0, W, Math.max(2, H * 0.02));
    streaks(ga, 0, 0, W, H, r, o.nx * 4, 0.05);
  };
}
// street floors: a stone base, bronze shop fronts with transoms between piers, a band over them
function shopPaint(o) {
  return (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, o.wall, 150, 0.65, 0);
    speckle(ga, 0, 0, W, H, r, 900, 0.05);
    if (o.ashlar) for (let y = 0; y < H; y += o.ashlar) { ga.fillStyle = 'rgba(40,32,24,0.25)'; ga.fillRect(0, y, W, 1.5); gb.fillStyle = 'rgb(100,100,100)'; gb.fillRect(0, y, W, 2); }
    const n = o.nx, cw = W / n;
    for (let i = 0; i < n; i++) {
      const x0 = i * cw + cw * 0.12, x1 = (i + 1) * cw - cw * 0.12;
      fill3(ga, gb, go, x0, H * 0.16, x1 - x0, H * 0.74, o.metal || [52, 44, 36], 70, 0.4, 0.6);
      fill3(ga, gb, go, x0 + 4, H * 0.19, x1 - x0 - 8, H * 0.22, [64, 74, 84], 45, 0.1, 0.1);
      fill3(ga, gb, go, x0 + 4, H * 0.45, x1 - x0 - 8, H * 0.42, [44, 50, 58], 45, 0.08, 0.1);
      if (r() < 0.6) { ga.fillStyle = 'rgba(255,214,150,0.22)'; ga.fillRect(x0 + 4, H * 0.47, x1 - x0 - 8, H * 0.38); }
      for (let q = 1; q < 3; q++) fill3(ga, gb, go, x0 + ((x1 - x0) * q) / 3 - 1.5, H * 0.19, 3, H * 0.68, o.metal || [52, 44, 36], 90, 0.4, 0.6);
    }
    fill3(ga, gb, go, 0, H * 0.9, W, H * 0.1, o.base || [150, 146, 140], 140, 0.7, 0);
    fill3(ga, gb, go, 0, 0, W, H * 0.1, rgbs(o.band || o.wall), 175, 0.6, 0);
  };
}
// copper roofs: sheets with standing seams, the green mottled and streaked
function copperPaint(base, seamStep = 16) {
  return (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, base, 140, 0.62, 0.12);
    for (let i = 0; i < 160; i++) {
      const x = r() * W, y = r() * H, rr = 6 + r() * 30;
      const g = ga.createRadialGradient(x, y, 0, x, y, rr);
      const c = r() < 0.5 ? base.map((v) => v * 0.82) : base.map((v) => Math.min(255, v * 1.14));
      g.addColorStop(0, rgbs(c, 1, 0.35)); g.addColorStop(1, rgbs(c, 1, 0));
      ga.fillStyle = g; ga.fillRect(x - rr, y - rr, 2 * rr, 2 * rr);
    }
    const step = W / seamStep;
    for (let x = 0; x < W; x += step) {
      fill3(ga, gb, go, x, 0, 2, H, base.map((v) => v * 0.78), 200, 0.5, 0.12);
      ga.fillStyle = 'rgba(220,240,230,0.35)'; ga.fillRect(x + 2, 0, 1, H);
    }
    for (let y = 0; y < H; y += H / 6) { ga.fillStyle = 'rgba(60,90,80,0.22)'; ga.fillRect(0, y, W, 1); }
    streaks(ga, 0, 0, W, H, r, 40, 0.06);
  };
}
// a flat roof: a pale membrane with its seams and patches
function roofPaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [168, 164, 156], 140, 0.9, 0);
  for (let y = 0; y < H; y += H / 8) { ga.fillStyle = 'rgba(90,86,80,0.25)'; ga.fillRect(0, y, W, 2); gb.fillStyle = 'rgb(160,160,160)'; gb.fillRect(0, y, W, 2); }
  for (let i = 0; i < 120; i++) {
    ga.fillStyle = r() < 0.5 ? `rgba(70,66,60,${(r() * 0.12).toFixed(2)})` : `rgba(230,226,216,${(r() * 0.1).toFixed(2)})`;
    ga.fillRect(r() * W, r() * H, 4 + r() * 30, 2 + r() * 14);
  }
}
const _misc = {};
function roofMat() { return _misc.roof || (_misc.roof = tileMat3('ld-roof', tile3('ld-roof', 256, 256, roofPaint, 99, 0.9), { bump: 0.8 })); }
function texd(key, W, H, paint, seed, rough, nx, ny) { const t = tile3(key, W, H, paint, seed, rough); t.nx = nx; t.ny = ny; return t; }

/* ---------------------------------------------------------- ornament parts */
// a Gothic pinnacle: a square shaft with a gablet band, then a crocketed spire; h tall, r the shaft's half width
function pinnacle(acc, x, y0, z, h, r, rot = 0) {
  ngonLathe(acc, x, z, y0, [[r, 0], [r, h * 0.42], [r * 1.18, h * 0.46], [r * 0.9, h * 0.5], [r * 0.62, h * 0.62], [r * 0.5, h * 0.62], [0.06, h]], 4, rot + Math.PI / 4);
  for (let k = 0; k < 3; k++) {
    const t = 0.66 + k * 0.1, rr = r * 0.62 * (1 - (t - 0.62) / 0.38);
    for (let q = 0; q < 4; q++) {
      const a = rot + q * Math.PI / 2;
      obox(acc, x + Math.cos(a) * rr, y0 + h * t, z + Math.sin(a) * rr, r * 0.28, h * 0.035, r * 0.28, a);
    }
  }
}
// rows of dormers up a sloped surface (a pyramid's face): rows at fractions of its rise, `pitch` metres apart; the dormer is
// a box with a gablet roof (acc) and a dark window (win); size scales the dormer
function dormers(acc, win, q, rows, pitch, size = 1, gable = acc) {
  const gx = q.pl.a, gz = q.pl.b, gl = Math.hypot(gx, gz) || 1;
  const out = [-gx / gl, -gz / gl], along = [-out[1], out[0]];
  const rot = Math.atan2(-along[1], along[0]);
  for (const [t, sz] of rows) {
    const yy = q.h0 + (q.h1 - q.h0) * t;
    let lo = 1e9, hi = -1e9, off = 0, cnt = 0;
    for (let i = 0; i < q.P.length; i++) {
      const a = q.P[i], b = q.P[(i + 1) % q.P.length];
      if ((a[2] - yy) * (b[2] - yy) > 0 || a[2] === b[2]) continue;
      const f = (yy - a[2]) / (b[2] - a[2]), px = a[0] + (b[0] - a[0]) * f, pz = a[1] + (b[1] - a[1]) * f;
      const s = px * along[0] + pz * along[1];
      lo = Math.min(lo, s); hi = Math.max(hi, s); off += px * out[0] + pz * out[1]; cnt++;
    }
    const k = size * (sz || 1), dw = 0.85 * k, dh = 1.2 * k;
    if (cnt < 2 || hi - lo < dw * 2.2) continue;
    off /= cnt;
    const nd = Math.max(1, Math.floor((hi - lo - dw) / (pitch * k)));
    for (let m = 0; m < nd; m++) {
      const s = lo + (hi - lo) * (m + 0.5) / nd;
      const px = along[0] * s + out[0] * off, pz = along[1] * s + out[1] * off;
      obox(acc, px + out[0] * 0.15 * k, yy - 0.2 * k, pz + out[1] * 0.15 * k, dw + 0.22 * k, dh + 0.2 * k, 1.3 * k, rot);
      obox(win, px + out[0] * 0.8 * k, yy, pz + out[1] * 0.8 * k, dw * 0.68, dh * 0.72, 0.04, rot);
      ngon(gable, px + out[0] * 0.2 * k, pz + out[1] * 0.2 * k, yy + dh, yy + dh + 0.85 * k, 0.6 * k, 0.02, 4, rot + Math.PI / 4, false);
    }
  }
}
// the rolls on the hips of a pyramid: where two of its sloped surfaces share a sloping edge
function hipRolls(acc, PY, r = 0.2) {
  for (let i = 0; i < PY.length; i++) for (let j = i + 1; j < PY.length; j++) {
    const shared = PY[i].P.filter((p) => PY[j].P.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.15 && Math.abs(p[2] - q[2]) < 0.15));
    if (shared.length < 2) continue;
    shared.sort((a, b) => a[2] - b[2]);
    const a = shared[0], b = shared[shared.length - 1];
    if (b[2] - a[2] < 1) continue;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), n = Math.max(2, Math.round(L / 1.2));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      ngon(acc, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 0.12, a[2] + (b[2] - a[2]) * t + 0.3, r, r * 0.8, 6, 0, true);
    }
  }
}

/* ------------------------------------------------------------- Woolworth */
const WW = { TC: [224, 216, 197], TC2: [196, 188, 170], GLASS: [40, 47, 56], FRAME: [70, 74, 70], COP: [152, 188, 172], floor: 3.72, col: 1.95 };
let _WW = null;
function wwMats() {
  if (_WW) return _WW;
  const shaft = texd('ww-shaft', 256, 512, bayPaint({ nx: 2, ny: 4, wall: WW.TC, spand: WW.TC2, glass: WW.GLASS, frame: WW.FRAME, mull: 0, orn: 'tre', rough: 0.62, win: [0.2, 0.8, 0.16, 0.74], blinds: 0.3 }), 151, 0.62, 2, 4);
  const head = texd('ww-head', 256, 512, lancetPaint({ nx: 2, floors: 4, wall: WW.TC, glass: WW.GLASS, frame: [206, 198, 180] }), 152, 0.6, 2, 1);
  const head3 = texd('ww-head3', 256, 400, lancetPaint({ nx: 2, floors: 3, wall: WW.TC, glass: WW.GLASS, frame: [206, 198, 180] }), 156, 0.6, 2, 1);
  const head1 = texd('ww-head1', 256, 128, gothicHeadPaint({ nx: 2, wall: WW.TC, glass: WW.GLASS }), 157, 0.6, 2, 1);
  const shop = texd('ww-shop', 256, 256, shopPaint({ nx: 2, wall: WW.TC, band: WW.TC2 }), 153, 0.6, 2, 1);
  const cop = tile3('ww-copper', 256, 256, copperPaint(WW.COP), 154, 0.62);
  _WW = {
    tx: { shaft, head, head3, head1, shop },
    shaft: tileMat3('ww-shaft', shaft, { bump: 1.5 }),
    head: tileMat3('ww-head', head, { bump: 1.6 }),
    head3: tileMat3('ww-head3', head3, { bump: 1.6 }),
    head1: tileMat3('ww-head1', head1, { bump: 1.6 }),
    shop: tileMat3('ww-shop', shop, { bump: 1.2 }),
    copper: tileMat3('ww-copper', cop, { bump: 1.2 }),
    roof: roofMat(),
    tc: mat(0xe0d8c6, { rough: 0.62, flat: false, stone: { set: 'climestone', amt: 0.25, nrm: 0.4, rgh: 0.2, ashlar: 0.3 } }),
    copS: mat(0x9cbcac, { rough: 0.6, metal: 0.12, flat: false }),
    dark: mat(0x22282e, { rough: 0.35, metal: 0.2, flat: false }),
    gilt: mat(0xc2a050, { rough: 0.3, metal: 0.85, flat: false }),
  };
  return _WW;
}
const PROF_WW = {
  cornice: [[0, 0], [0.25, 0.1], [0.25, 0.35], [0.55, 0.45], [0.7, 0.75], [0.7, 0.95], [0.45, 1.05], [0, 1.05]],
  string: [[0, 0], [0.18, 0.06], [0.18, 0.28], [0, 0.34]],
  coping: [[0, 0], [0.15, 0], [0.15, 0.35], [0, 0.45]],
};
export function buildWoolworth(ctx) {
  const m = model(ctx, 'woolworth');
  if (!m) return null;
  const { R, SP } = m;
  const M = wwMats();
  const g = new THREE.Group();
  const SH = new Acc(), HD = new Acc(), HD3 = new Acc(), HD1 = new Acc(), SHOP = new Acc(), TC = new Acc(), COP = new Acc(), CS = new Acc(), RF = new Acc(), DK = new Acc(), GI = new Acc();
  const yBase = 116;                                           // the base's roofs are under it, the tower's over it
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.75 });
  const pin = (x, y, z, rot, corner) => pinnacle(TC, x, y, z, corner ? 4.4 : 3.4, corner ? 0.5 : 0.36, rot);
  facadeRuns(runs, (w, top, hgt) => {
    if (w.q.h1 - w.q.h0 > 0.3 && w.q.A < 60 && hgt < 3) return { plain: TC };   // the low walls round small copper slopes
    const tower = top > yBase + 1, stage = tower && hgt > 14;
    // the stages' heads: tall lancets through the last four storeys of the main stage, three on the upper one, a frieze else
    const head = !tower ? [2.6, HD1, M.tx.head1] : !stage ? [0, null, null] : top > 180 ? [3 * WW.floor, HD3, M.tx.head3] : [4 * WW.floor, HD, M.tx.head];
    return {
      acc: SH, tex: M.tx.shaft, floor: WW.floor, col: WW.col, corner: 1.1, trim: TC,
      headH: head[0], headAcc: head[1], headTex: head[2], cornice: PROF_WW.cornice, coping: PROF_WW.coping,
      shopH: 8.2, shopAcc: SHOP, shopTex: M.tx.shop, shopCol: 3.9, string: PROF_WW.string,
      pier: { every: 2, w: 0.55, d: 0.3, md: tower ? 0.6 : 0.4, cd: tower ? 0.8 : 0.5, pin: tower ? pin : null },
      // the tower's faces: windows in groups of two, three and two between deep piers (the main stage), two and two above
      groups: tower ? (L) => (L > 22 ? { pattern: [2, 3, 2], gap: 1.7, corner: 2.6 } : L > 11 ? { pattern: [2, 2], gap: 1.5, corner: 1.5 } : null) : null,
    };
  });
  for (const q of R) {
    if (q.h1 - q.h0 > 0.3) capSurface(COP, q, 0.25);
    else capSurface(q.h1 > yBase ? TC : RF, q, 0.08, 0.01);
  }
  // the Broadway portal: the tower's widest wall that comes down to the street, facing most nearly east-south-east
  {
    let best = null;
    for (const w of runs) {
      if (w.y0 > 0.5 || Math.min(w.ya, w.yb) < 150 || w.L < 12) continue;
      const sc = w.n[0] * 0.875 + w.n[1] * 0.485;
      if (sc > 0.8 && (!best || w.L > best.L)) best = w;
    }
    if (best) {
      const w = best, dx = (w.b[0] - w.a[0]) / w.L, dz = (w.b[1] - w.a[1]) / w.L, sm = w.L / 2;
      const P = (s, y, d) => [w.a[0] + dx * (sm + s) + w.n[0] * d, y, w.a[1] + dz * (sm + s) + w.n[1] * d];
      const n = [w.n[0], 0, w.n[1]];
      archShape(TC, P, n, 4.6, 0, 9.4, 13.6, 0.75);                         // the portal's moulded frame, standing out
      archShape(DK, P, n, 3.7, 0, 9.0, 12.4, 0.8);                           // the opening
      archShape(GI, P, n, 2.6, 0.2, 6.2, 8.6, 0.84);                         // the bronze doors and screen
      for (const so of [-8.2, 8.2]) { archShape(TC, P, n, 2.0, 0, 6.4, 8.4, 0.5, so); archShape(DK, P, n, 1.5, 0, 6.1, 7.7, 0.55, so); }
      for (const so of [-4.9, 4.9]) { const [x, , z] = P(so, 0, 0.9); pinnacle(TC, x, 9.2, z, 6.5, 0.38, runRot(w)); }
    }
  }
  // the turrets and pinnacles of the model's cones
  for (const [x, z, y0, y1, r] of SP) {
    if (y1 > 230) continue;                                      // the lantern's spire: drawn with the lantern below
    if (r > 1.6) {                                               // the upper stage's corner turrets, from the main stage's roof
      const yb = 171.3;
      ngon(TC, x, z, yb, y0, r, r, 8, Math.PI / 8, false);
      for (let k = 0; k < 8; k++) {
        const a = Math.PI / 8 + (k / 8) * Math.PI * 2;
        obox(TC, x + Math.cos(a) * r, yb, z + Math.sin(a) * r, 0.22, y0 - yb, 0.22, -a);
      }
      for (let yy = yb + 4; yy < y0 - 2; yy += WW.floor * 2) ngon(TC, x, z, yy, yy + 0.35, r + 0.18, r + 0.18, 8, Math.PI / 8, true, true);
      ngon(TC, x, z, y0 - 0.6, y0, r + 0.3, r + 0.3, 8, Math.PI / 8, true, true);
      pinnacle(TC, x, y0, z, (y1 - y0) * 1.1, r * 0.72, 0);
    } else {                                                     // the main stage's corner pinnacles
      const below = heightAt(R, x, z, null);
      const yb = below !== null ? Math.min(below, y0) : y0 - 1.5;
      ngon(TC, x, z, yb, y0, r * 0.8, r * 0.8, 8, Math.PI / 8, false);
      pinnacle(TC, x, y0, z, (y1 - y0) * 1.5, r * 0.6, 0);
    }
  }
  // the pyramid: rows of small dormers up its eight slopes, rolls on the hips; the base's mansard: a row of dormers
  const PY = R.filter((q) => q.h1 - q.h0 > 8 && q.h0 > 190);
  for (const q of PY) dormers(COP, DK, q, q.A > 22 ? [[0.14, 1], [0.34, 0.85], [0.54, 0.72], [0.72, 0.6]] : [[0.18, 0.85], [0.45, 0.7]], 2.0, 0.8, CS);
  hipRolls(CS, PY, 0.2);
  for (const q of R) if (q.h1 - q.h0 > 3 && q.h0 > 100 && q.h0 < 120 && q.A > 20) dormers(COP, DK, q, [[0.4, 1]], 3.9, 1.0, CS);
  // the lantern: arched openings round its drum, pinnacles at its corners, the crocketed spire and its finial
  const top = SP.find((s) => s[3] > 230);
  if (top) {
    const [x, z, y0, y1] = top;
    const deck = heightAt(R, x + 2.6, z, null) ?? 219;
    const drum1 = y0 - 7.2;
    for (let k = 0; k < 10; k++) {
      const a = (k + 0.5) / 10 * Math.PI * 2;
      obox(DK, x + Math.cos(a) * 1.95, deck + 1.2, z + Math.sin(a) * 1.95, 0.75, (drum1 - deck) * 0.62, 0.05, -a + Math.PI / 2);
      pinnacle(TC, x + Math.cos(a - Math.PI / 10) * 2.25, deck, z + Math.sin(a - Math.PI / 10) * 2.25, (drum1 - deck) + 2.2, 0.2, 0);
    }
    ngonLathe(TC, x, z, drum1 - 0.1, [[2.3, 0], [2.3, 0.6], [1.9, 0.9], [1.9, 2.6], [1.5, 2.8], [1.2, 4.6], [1.0, 4.8], [0.9, 7.2]], 10);
    ngonLathe(CS, x, z, y0, [[1.0, 0], [0.62, (y1 - y0) * 0.5], [0.3, (y1 - y0) * 0.85], [0.05, y1 - y0 - 0.6]], 8);
    ngonLathe(GI, x, z, y1 - 0.8, [[0.18, 0], [0.32, 0.25], [0.2, 0.5], [0.04, 1.4]], 8);
  }
  const all = [[SH, M.shaft, 'lm65:woolworth:shaft'], [HD, M.head, 'lm65:woolworth:heads'], [HD3, M.head3, 'lm65:woolworth:heads3'], [HD1, M.head1, 'lm65:woolworth:friezes'], [SHOP, M.shop, 'lm65:woolworth:shops'], [TC, M.tc, 'lm65:woolworth:terracotta'],
    [COP, M.copper, 'lm65:woolworth:copper'], [CS, M.copS, 'lm65:woolworth:copperTrim'], [RF, M.roof, 'lm65:woolworth:roofs'], [DK, M.dark, 'lm65:woolworth:dark'], [GI, M.gilt, 'lm65:woolworth:finial']];
  addMeshes(g, all);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: yBase / 2, z: B.cz, w: B.x1 - B.x0, h: yBase, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(all);
  return g;
}

/* --------------------------------------------------------------- 40 Wall */
const W40 = { LIME: [210, 200, 184], BRICK: [204, 186, 164], SP: [160, 144, 126], GLASS: [42, 48, 56], FRAME: [64, 62, 58], COP: [116, 188, 172], floor: 3.85, col: 1.85 };
let _W40 = null;
function w40Mats() {
  if (_W40) return _W40;
  const shaft = texd('w40-shaft', 256, 512, bayPaint({ nx: 2, ny: 4, wall: W40.BRICK, spand: W40.SP, glass: W40.GLASS, frame: W40.FRAME, brick: 4, orn: 'deco', rough: 0.85, win: [0.16, 0.84, 0.14, 0.76], tone: 0.06 }), 161, 0.85, 2, 4);
  const lime = texd('w40-lime', 256, 512, bayPaint({ nx: 2, ny: 4, wall: W40.LIME, spand: [182, 174, 158], glass: W40.GLASS, frame: W40.FRAME, ashlar: 16, rough: 0.75, win: [0.2, 0.8, 0.16, 0.72] }), 162, 0.75, 2, 4);
  const shop = texd('w40-shop', 256, 256, shopPaint({ nx: 2, wall: W40.LIME, ashlar: 24, base: [120, 116, 110] }), 163, 0.7, 2, 1);
  const head = texd('w40-head', 256, 128, gothicHeadPaint({ nx: 2, wall: W40.LIME, glass: W40.GLASS }), 164, 0.7, 2, 1);
  const cop = tile3('w40-copper', 256, 256, copperPaint(W40.COP, 20), 165, 0.6);
  _W40 = {
    tx: { shaft, lime, shop, head },
    shaft: tileMat3('w40-shaft', shaft, { bump: 1.4 }),
    lime: tileMat3('w40-lime', lime, { bump: 1.5 }),
    shop: tileMat3('w40-shop', shop, { bump: 1.2 }),
    head: tileMat3('w40-head', head, { bump: 1.6 }),
    copper: tileMat3('w40-copper', cop, { bump: 1.2 }),
    roof: roofMat(),
    stone: mat(0xd0c8b6, { rough: 0.72, flat: false, stone: { set: 'climestone', amt: 0.3, nrm: 0.45, rgh: 0.25, ashlar: 0.35 } }),
    copS: mat(0x6ab4a4, { rough: 0.55, metal: 0.15, flat: false }),
    dark: mat(0x22282e, { rough: 0.35, metal: 0.2, flat: false }),
    gilt: mat(0xc2a050, { rough: 0.3, metal: 0.85, flat: false }),
  };
  return _W40;
}
const PROF_40 = {
  cornice: [[0, 0], [0.2, 0.08], [0.2, 0.3], [0.45, 0.4], [0.55, 0.65], [0.55, 0.85], [0, 0.9]],
  coping: [[0, 0], [0.12, 0], [0.12, 0.32], [0, 0.4]],
  string: [[0, 0], [0.15, 0.05], [0.15, 0.25], [0, 0.3]],
};
export function build40Wall(ctx) {
  const m = model(ctx, 'p40wall');
  if (!m) return null;
  const { R, SP } = m;
  const M = w40Mats();
  const g = new THREE.Group();
  const SH = new Acc(), LI = new Acc(), SHOP = new Acc(), HD = new Acc(), ST = new Acc(), COP = new Acc(), CS = new Acc(), RF = new Acc(), DK = new Acc(), GI = new Acc();
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.75 });
  facadeRuns(runs, (w, top, hgt) => {
    if (w.q.h1 - w.q.h0 > 0.3) return { plain: ST };
    if (top > 250) return { plain: CS };                       // the lantern's stages: copper
    const tower = top > 140;
    const z = {
      acc: SH, tex: M.tx.shaft, floor: W40.floor, col: W40.col, corner: 1.0, trim: ST, coping: PROF_40.coping,
      shopH: 7.6, shopAcc: SHOP, shopTex: M.tx.shop, shopCol: 4.2, string: PROF_40.string,
      pier: { every: 2, w: 0.5, d: tower ? 0.32 : 0.22, minH: 6 },
    };
    if (tower && top > 200) Object.assign(z, { headH: 3.0, headAcc: HD, headTex: M.tx.head, cornice: PROF_40.cornice });
    return z;
  });
  // the limestone base: the lower floors of every street wall (the shaft's brick starts over them)
  for (const w of runs) {
    if (w.y0 > 0.5 || w.q.h1 - w.q.h0 > 0.3) continue;
    const top = Math.min(w.ya, w.yb);
    if (top < 24) continue;
    const lay = layout(w.L, W40.col, w.L < 6 ? 0.3 : 1.0);
    runQuad(LI, w, 7.6, 23.5, lay, M.tx.lime, W40.floor, 7.6);
    const d = 0.03, a = runPt(w, 0, d), b = runPt(w, w.L, d);
    sweepRun(ST, w.a, w.b, w.n, 23.4, PROF_40.string, 0.15);
    void a; void b;
  }
  for (const q of R) {
    if (q.h1 - q.h0 > 0.3) capSurface(COP, q, 0.25);
    else capSurface(q.h1 > 200 ? ST : RF, q, 0.08, 0.01);
  }
  // the pyramid's dormers and hip rolls, the lantern and the spire
  const PY = R.filter((q) => q.h1 - q.h0 > 8 && q.h0 > 200);
  for (const q of PY) if (q.A > 20) dormers(COP, DK, q, [[0.08, 1.3], [0.42, 0.7]], 3.2, 0.9, CS);
  hipRolls(CS, PY, 0.22);
  const sp = SP.find((s) => s[3] > 260);
  if (sp) {
    const [x, z, y0, y1] = sp;
    const yl = heightAt(R, x + 1.0, z, null) ?? (y0 - 10);
    // the lantern: an octagon with tall arched openings, its cornice, then the copper spire with its finial
    for (let k = 0; k < 8; k++) {
      const a = (k + 0.5) / 8 * Math.PI * 2;
      obox(DK, x + Math.cos(a) * 1.62, yl + 1.0, z + Math.sin(a) * 1.62, 0.6, (y0 - yl) * 0.55, 0.05, -a + Math.PI / 2);
    }
    ngonLathe(CS, x, z, y0 - 0.3, [[1.5, 0], [1.5, 0.6], [1.1, 1.2], [0.75, (y1 - y0) * 0.35], [0.4, (y1 - y0) * 0.7], [0.06, y1 - y0 - 0.5]], 8);
    ngonLathe(GI, x, z, y1 - 0.9, [[0.16, 0], [0.3, 0.3], [0.16, 0.6], [0.03, 1.5]], 8);
  }
  // the notched corners at the top of the shaft: small finials on each step
  for (const q of R) {
    if (!(q.h1 > 218 && q.h1 < 230 && q.A < 35)) continue;
    const [cx, cz] = q.c;
    pinnacle(ST, cx, q.h1, cz, 2.6, 0.32, 0);
  }
  const all = [[SH, M.shaft, 'lm65:40wall:shaft'], [LI, M.lime, 'lm65:40wall:limestone'], [SHOP, M.shop, 'lm65:40wall:shops'], [HD, M.head, 'lm65:40wall:heads'],
    [ST, M.stone, 'lm65:40wall:stone'], [COP, M.copper, 'lm65:40wall:copper'], [CS, M.copS, 'lm65:40wall:copperTrim'], [RF, M.roof, 'lm65:40wall:roofs'], [DK, M.dark, 'lm65:40wall:dark'], [GI, M.gilt, 'lm65:40wall:finial']];
  addMeshes(g, all);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: 60, z: B.cz, w: B.x1 - B.x0, h: 120, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(all);
  return g;
}

/* --------------------------------------------------------------- 70 Pine */
const P70 = { LIME: [222, 210, 194], BRICK: [216, 200, 182], SP: [176, 162, 146], GLASS: [44, 50, 58], FRAME: [70, 70, 66], floor: 3.75, col: 1.7 };
let _P70 = null;
function p70Mats() {
  if (_P70) return _P70;
  const shaft = texd('p70-shaft', 256, 512, bayPaint({ nx: 2, ny: 4, wall: P70.BRICK, spand: P70.SP, glass: P70.GLASS, frame: P70.FRAME, brick: 4, orn: 'deco', rough: 0.82, win: [0.18, 0.82, 0.14, 0.76], tone: 0.05 }), 171, 0.82, 2, 4);
  const lime = texd('p70-lime', 256, 512, bayPaint({ nx: 2, ny: 4, wall: P70.LIME, spand: [190, 184, 172], glass: P70.GLASS, frame: P70.FRAME, ashlar: 16, rough: 0.75, win: [0.2, 0.8, 0.16, 0.72] }), 172, 0.75, 2, 4);
  const shop = texd('p70-shop', 256, 256, shopPaint({ nx: 2, wall: P70.LIME, ashlar: 24, base: [110, 108, 104] }), 173, 0.7, 2, 1);
  const glass = texd('p70-lantern', 256, 256, (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, [178, 196, 208], 120, 0.1, 0.3);
    for (let i = 0; i <= 4; i++) fill3(ga, gb, go, (i * W) / 4 - 3, 0, 6, H, [210, 208, 200], 180, 0.5, 0.2);
    for (let j = 0; j <= 6; j++) fill3(ga, gb, go, 0, (j * H) / 6 - 2, W, 4, [210, 208, 200], 180, 0.5, 0.2);
  }, 174, 0.1, 1, 1);
  _P70 = {
    tx: { shaft, lime, shop, glass },
    shaft: tileMat3('p70-shaft', shaft, { bump: 1.4 }),
    lime: tileMat3('p70-lime', lime, { bump: 1.5 }),
    shop: tileMat3('p70-shop', shop, { bump: 1.2 }),
    glass: tileMat3('p70-lantern', glass, { bump: 0.6 }),
    roof: roofMat(),
    stone: mat(0xd8d2c4, { rough: 0.72, flat: false, stone: { set: 'climestone', amt: 0.3, nrm: 0.45, rgh: 0.25, ashlar: 0.35 } }),
    steel: mat(0xc8ccd0, { rough: 0.3, metal: 0.8, flat: false }),
  };
  return _P70;
}
export function build70Pine(ctx) {
  const m = model(ctx, 'p70pine');
  if (!m) return null;
  const { R } = m;
  const M = p70Mats();
  const g = new THREE.Group();
  const SH = new Acc(), LI = new Acc(), SHOP = new Acc(), ST = new Acc(), RF = new Acc(), GL = new Acc(), SS = new Acc();
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.75 });
  facadeRuns(runs, (w, top, hgt) => {
    if (top > 251 && hgt < 10) return null;                        // (the lantern: drawn below)
    return {
      acc: SH, tex: M.tx.shaft, floor: P70.floor, col: P70.col, corner: 0.9, trim: ST, coping: PROF_40.coping,
      shopH: 7.2, shopAcc: SHOP, shopTex: M.tx.shop, shopCol: 4.0, string: PROF_40.string,
      pier: { every: 2, w: 0.55, d: top > 120 ? 0.4 : 0.28, minH: 5, over: 0.6 },
    };
  });
  for (const w of runs) {                                        // the limestone of the lower floors
    if (w.y0 > 0.5) continue;
    const top = Math.min(w.ya, w.yb);
    if (top < 20) continue;
    runQuad(LI, w, 7.2, 19.5, layout(w.L, P70.col, w.L < 6 ? 0.3 : 0.9), M.tx.lime, P70.floor, 7.2);
    sweepRun(ST, w.a, w.b, w.n, 19.4, PROF_40.string, 0.15);
  }
  for (const q of R) capSurface(q.h1 > 140 ? ST : RF, q, 0.08, 0.01);
  // the lantern over the top (the observation room's tall glazed slits between stone ribs), its stepped cap, the needle to
  // 290 m
  const top = R.reduce((a, q) => (q.h1 > a.h1 ? q : a), R[0]);
  const [cx, cz] = top.c;
  {
    const r0 = Math.sqrt(top.A / (2 * Math.SQRT2)), y0 = 251.75, y1 = top.h1;
    ngon(ST, cx, cz, y0, y1 - 0.8, r0, r0 * 0.97, 8, Math.PI / 8, false);
    for (let k = 0; k < 8; k++) {
      const a = Math.PI / 8 + (k + 0.5) / 8 * Math.PI * 2, rr = r0 * Math.cos(Math.PI / 8) + 0.03;
      obox(GL, cx + Math.cos(a) * rr, y0 + 1.2, cz + Math.sin(a) * rr, r0 * 0.42, y1 - y0 - 3.4, 0.06, -a + Math.PI / 2);   // a glazed slit
      const b = Math.PI / 8 + (k / 8) * Math.PI * 2;
      obox(ST, cx + Math.cos(b) * r0, y0, cz + Math.sin(b) * r0, 0.45, y1 - y0 + 0.6, 0.45, -b);                             // a corner rib
    }
    ngonLathe(ST, cx, cz, y1 - 0.8, [[r0 * 1.06, 0], [r0 * 1.06, 0.7], [r0 * 0.8, 0.9], [r0 * 0.8, 2.2], [r0 * 0.55, 2.4], [r0 * 0.5, 3.8], [0.6, 4.6]], 8, Math.PI / 8);
    ngonLathe(SS, cx, cz, y1 + 3.6, [[0.55, 0], [0.38, 4], [0.2, 10], [0.04, 280 - y1 - 3.6]], 8);
  }
  const all = [[SH, M.shaft, 'lm65:70pine:shaft'], [LI, M.lime, 'lm65:70pine:limestone'], [SHOP, M.shop, 'lm65:70pine:shops'], [ST, M.stone, 'lm65:70pine:stone'],
    [RF, M.roof, 'lm65:70pine:roofs'], [GL, M.glass, 'lm65:70pine:lantern'], [SS, M.steel, 'lm65:70pine:spire']];
  addMeshes(g, all);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: 60, z: B.cz, w: B.x1 - B.x0, h: 120, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(all);
  return g;
}

/* ------------------------------------------------------------ 28 Liberty */
// the curtain wall between the columns: grey glass in aluminium frames over dark grey spandrel panels, a mullion every
// 1.5 m (2026-11-03: the reference reads the walls dark between the bright columns; the pale spandrels drew a silver box)
function libertyPaint(ga, gb, go, W, H, r) {
  const nx = 4, ny = 4, cw = W / nx, fh = H / ny;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = i * cw, y = j * fh, k = 0.92 + r() * 0.14;
    const gl = ga.createLinearGradient(0, y, 0, y + fh * 0.66);
    gl.addColorStop(0, rgbs([70, 78, 84], k)); gl.addColorStop(1, rgbs([40, 46, 52], k));
    ga.fillStyle = gl; ga.fillRect(x, y, cw, fh * 0.66);
    fill3(null, gb, go, x, y, cw, fh * 0.66, null, 110, 0.12, 0.3);
    fill3(ga, gb, go, x, y + fh * 0.66, cw, fh * 0.34, rgbs([78, 82, 86], k), 140, 0.4, 0.6);   // the spandrel panel
    if (r() < 0.2) { ga.fillStyle = 'rgba(210,206,190,0.35)'; ga.fillRect(x + 2, y + 2, cw - 4, fh * 0.66 * (0.2 + r() * 0.5)); }
  }
  for (let i = 0; i <= nx; i++) fill3(ga, gb, go, i * cw - 2, 0, 4, H, [176, 180, 182], 185, 0.35, 0.75);
  for (let j = 0; j <= ny; j++) fill3(ga, gb, go, 0, j * fh - 1.5, W, 3, [170, 174, 176], 175, 0.35, 0.75);
}
// the plant floors: horizontal aluminium louvres
function louvrePaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, [120, 124, 126], 120, 0.45, 0.5);
  for (let y = 0; y < H; y += 6) { fill3(ga, gb, go, 0, y, W, 3, [176, 180, 182], 190, 0.35, 0.7); ga.fillStyle = 'rgba(0,0,0,0.3)'; ga.fillRect(0, y + 3, W, 2); }
  for (let i = 0; i <= 4; i++) fill3(ga, gb, go, (i * W) / 4 - 2, 0, 4, H, [186, 190, 192], 190, 0.35, 0.75);
}
let _L28 = null;
function l28Mats() {
  if (_L28) return _L28;
  const cw = texd('l28-wall', 256, 256, libertyPaint, 181, 0.2, 4, 4);
  const lv = texd('l28-louvre', 256, 128, louvrePaint, 182, 0.4, 4, 1);
  _L28 = {
    tx: { cw, lv },
    wall: tileMat3('l28-wall', cw, { bump: 0.8 }),
    louvre: tileMat3('l28-louvre', lv, { bump: 1.0 }),
    alu: mat(0xbfc3c6, { rough: 0.32, metal: 0.75, flat: false }),
    roof: roofMat(),
    granite: mat(0x9a9890, { rough: 0.8, flat: false, stone: { set: 'cgranite', amt: 0.3, nrm: 0.4, rgh: 0.2 } }),
    lobby: mat(0x3a444c, { rough: 0.1, metal: 0.3, flat: false }),
  };
  return _L28;
}
export function build28Liberty(ctx) {
  const m = model(ctx, 'p28liberty');
  if (!m) return null;
  const { R } = m;
  const M = l28Mats();
  const g = new THREE.Group();
  const CW = new Acc(), LV = new Acc(), AL = new Acc(), RF = new Acc(), GR = new Acc(), LB = new Acc();
  const main = R.reduce((a, q) => (q.A > a.A ? q : a), R[0]);
  const yRoof = Math.max(...R.map((q) => q.h1));
  const yPlant = main.h1 - 7.5;                                  // the two plant floors under the main roof
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.75 });
  for (const w of runs) {
    const top = Math.min(w.ya, w.yb);
    if (w.L < 0.5) continue;
    if (w.y0 < 0.5) {
      // the lobby glazed behind the columns for the first 9 m, the curtain wall over it, the louvres at the top
      const lay = { s0: 0, cw: 1.52 };
      const inset = 3.2;
      const a = runPt(w, 0, -inset), b = runPt(w, w.L, -inset);
      LB.quad([a[0], 0, a[1]], [b[0], 0, b[1]], [b[0], 8.8, b[1]], [a[0], 8.8, a[1]], [w.n[0], 0, w.n[1]]);
      runQuad(CW, w, 8.8, Math.min(top, yPlant), lay, M.tx.cw, 3.81, 0);
      if (top > yPlant) runQuad(LV, w, yPlant, top, lay, M.tx.lv, top - yPlant, yPlant);
      { const [mx, mz] = runPt(w, w.L / 2, 0.15); obox(AL, mx, 8.0, mz, w.L + 0.3, 0.9, 0.3, runRot(w)); }
      LB.quad([a[0], 8.8, a[1]], [b[0], 8.8, b[1]], [w.b[0], 8.8, w.b[1]], [w.a[0], 8.8, w.a[1]], [0, -1, 0]);   // the soffit over the lobby
      sweepRun(AL, w.a, w.b, w.n, top - 0.6, [[0, 0], [0.25, 0], [0.25, 0.6], [0, 0.6]], 0.25);
      // the columns: aluminium-clad, standing 1.2 m out of the long faces every 8.8 m, from the plaza to the roof
      if (w.L > 40) {
        const n = Math.round(w.L / 8.8), step = w.L / n;
        for (let k = 0; k <= n; k++) {
          const s = Math.min(w.L - 0.8, Math.max(0.8, k * step));
          const [px, pz] = runPt(w, s, 0.6);
          obox(AL, px, 0, pz, 1.5, top + 0.2, 1.2, runRot(w));
        }
      }
    } else {
      runQuad(LV, w, w.y0, top, { s0: 0, cw: 1.52 }, M.tx.lv, Math.max(1, top - w.y0), w.y0, w.ya, w.yb);
    }
  }
  for (const q of R) capSurface(RF, q, 0.08, 0.01);
  void yRoof;
  const all = [[CW, M.wall, 'lm65:28liberty:wall'], [LV, M.louvre, 'lm65:28liberty:louvres'], [AL, M.alu, 'lm65:28liberty:aluminium'], [RF, M.roof, 'lm65:28liberty:roof'],
    [GR, M.granite, 'lm65:28liberty:plaza'], [LB, M.lobby, 'lm65:28liberty:lobby']];
  addMeshes(g, all);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: main.h1 / 2, z: B.cz, w: B.x1 - B.x0, h: main.h1, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(all);
  return g;
}

/* ----------------------------------------------------------- classical kit */
// the frame of a front: the ring edge whose outward normal is nearest `dir` (local xz); s runs along it from its middle (to
// the right seen from outside), y up, d out of the wall
function frontOf(ring, dir) {
  let A = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
  const sg = A > 0 ? 1 : -1;
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 4) continue;
    const n = [sg * ez / L, -sg * ex / L], sc = (n[0] * dir[0] + n[1] * dir[1]) + L * 0.002;
    if (!best || sc > best.sc) best = { sc, a, b, n, L };
  }
  const { a, b, n, L } = best;
  const r = [n[1], -n[0]];                                       // to the right seen from outside
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const P = (s, y, d) => [m[0] + r[0] * s + n[0] * d, y, m[1] + r[1] * s + n[1] * d];
  return { a, b, n, r, L, m, P, rot: Math.atan2(-r[1], r[0]), N: (ns, ny, nd) => [r[0] * ns + n[0] * nd, ny, r[1] * ns + n[1] * nd] };
}
// a classical column: the base, the fluted shaft (faceted), the capital (Doric: echinus and abacus; Corinthian: the bell with
// two rows of leaves, the volutes, the abacus); its top at y0 + h
function column(acc, x, y0, z, r, h, order, rot = 0) {
  const corin = order === 'corinthian', ionic = order === 'ionic';
  const capH = corin ? r * 2.3 : ionic ? r * 1.1 : r * 0.9, baseH = corin || ionic ? r * 0.55 : 0;
  if (baseH) ngonLathe(acc, x, z, y0, [[r * 1.42, 0], [r * 1.42, baseH * 0.3], [r * 1.25, baseH * 0.45], [r * 1.3, baseH * 0.7], [r * 1.12, baseH], [r * 1.0, baseH]], 16, rot);
  ngon(acc, x, z, y0 + baseH, y0 + h - capH, r, r * 0.86, corin ? 24 : 20, rot, false);
  const yc = y0 + h - capH;
  if (corin) {
    ngonLathe(acc, x, z, yc, [[r * 0.86, 0], [r * 0.9, capH * 0.15], [r * 1.05, capH * 0.6], [r * 1.25, capH * 0.86]], 16, rot);
    for (let row = 0; row < 2; row++) for (let k = 0; k < 8; k++) {
      const a = rot + (k + row * 0.5) / 8 * Math.PI * 2, rr = r * (0.95 + row * 0.08), yy = yc + capH * (0.08 + row * 0.3);
      const g = new THREE.BoxGeometry(r * 0.42, capH * 0.36, r * 0.16);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.35, -a + Math.PI / 2, 0, 'YXZ'));
      acc.addGeo(g, new THREE.Matrix4().compose(new THREE.Vector3(x + Math.cos(a) * rr, yy + capH * 0.18, z + Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1)));
      g.dispose();
    }
    for (let k = 0; k < 4; k++) {                                // the volutes under the abacus's corners
      const a = rot + Math.PI / 4 + k * Math.PI / 2;
      obox(acc, x + Math.cos(a) * r * 1.2, yc + capH * 0.66, z + Math.sin(a) * r * 1.2, r * 0.36, r * 0.36, r * 0.36, -a);
    }
    obox(acc, x, yc + capH * 0.86, z, r * 2.85, capH * 0.14, r * 2.85, -rot);
  } else if (ionic) {
    ngonLathe(acc, x, z, yc, [[r * 0.86, 0], [r * 0.95, capH * 0.3], [r * 1.05, capH * 0.5]], 16, rot);
    for (const sg of [-1, 1]) {                                    // the volutes, a scroll at each side
      const vx = x + Math.cos(-rot) * sg * r * 1.05, vz = z + Math.sin(-rot) * sg * r * 1.05;
      const geo = new THREE.CylinderGeometry(r * 0.38, r * 0.38, r * 1.9, 10);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, -rot, 0, 'YXZ'));
      acc.addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(vx, yc + capH * 0.55, vz), q, new THREE.Vector3(1, 1, 1))); geo.dispose();
    }
    obox(acc, x, yc + capH * 0.82, z, r * 2.5, capH * 0.18, r * 2.5, -rot);
  } else {
    ngonLathe(acc, x, z, yc, [[r * 0.86, 0], [r * 0.9, capH * 0.12], [r * 0.92, capH * 0.2], [r * 1.32, capH * 0.55]], 20, rot);
    obox(acc, x, yc + capH * 0.55, z, r * 2.75, capH * 0.45, r * 2.75, -rot);
  }
}
// a pediment over a front between s0 and s1 from y0, rising hp to its apex; the tympanum set back at d0, the cornices out to d1
function pediment(acc, fr, s0, s1, y0, hp, d0, d1, back = 6) {
  const sm = (s0 + s1) / 2, cr = 0.75;
  // the tympanum
  triN(acc, fr.P(s0 + cr, y0, d0), fr.P(s1 - cr, y0, d0), fr.P(sm, y0 + hp - cr * 0.5, d0), fr.N(0, 0, 1));
  // the raking cornices: a box along each slope, and the horizontal cornice
  const slope = (sa, sb, ya, yb) => {
    const A = fr.P(sa, ya, (d0 + d1) / 2), B = fr.P(sb, yb, (d0 + d1) / 2);
    const dir = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], L = Math.hypot(...dir);
    const g = new THREE.BoxGeometry(L, cr, d1 - d0 + 0.4);
    const ux = new THREE.Vector3(dir[0] / L, dir[1] / L, dir[2] / L), nz = new THREE.Vector3(...fr.N(0, 0, 1));
    const uy = new THREE.Vector3().crossVectors(nz, ux).normalize(), uz = new THREE.Vector3().crossVectors(ux, uy);
    const m4 = new THREE.Matrix4().makeBasis(ux, uy, uz).setPosition((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
    acc.addGeo(g, m4); g.dispose();
  };
  slope(s0 - 0.4, sm, y0 + 0.1, y0 + hp, 0); slope(sm, s1 + 0.4, y0 + hp, y0 + 0.1, 0);
  const [cx, , cz] = fr.P(sm, 0, (d0 + d1) / 2);
  obox(acc, cx, y0 - cr * 0.6, cz, s1 - s0 + 0.8, cr * 0.9, d1 - d0 + 0.4, fr.rot);
  // the roof behind it: two slopes back `back` metres
  for (const [sa, sb] of [[s0, sm], [s1, sm]]) {
    const p0 = fr.P(sa, y0 + 0.2, d0), p1 = fr.P(sb, y0 + hp, d0), p2 = fr.P(sb, y0 + hp, d0 - back), p3 = fr.P(sa, y0 + 0.2, d0 - back);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const nl = Math.hypot(...n); n = n.map((v) => v / nl); if (n[1] < 0) n = n.map((v) => -v);
    acc.quad(p0, p1, p2, p3, n);
  }
}
// sculpture from smooth parts: ellipsoids and tapered limbs (the pediment's figures, the statues)
const _sph = new THREE.SphereGeometry(1, 10, 8);
function ell(acc, c, r, ry = 0, rx = 0, rz = 0) {
  const m4 = new THREE.Matrix4().compose(new THREE.Vector3(c[0], c[1], c[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(r[0], r[1], r[2]));
  acc.addGeo(_sph, m4);
}
function limb(acc, a, b, ra, rb) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), L = d.length();
  if (L < 1e-4) return;
  const g = new THREE.CylinderGeometry(rb, ra, L, 8, 1, true);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  acc.addGeo(g, new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), q, new THREE.Vector3(1, 1, 1)));
  g.dispose();
  ell(acc, a, [ra, ra, ra]); ell(acc, b, [rb, rb, rb]);
}
// a figure in a front's frame: a pose in unit metres (s along the front, y up, d out) about an anchor, scaled by k.
// pose: 'stand' (arms out), 'stand1' (one arm forward), 'kneel', 'sit', 'recline' (toward +s when side = 1)
function figureAt(acc, fr, s, y0, d, k, pose, side = 1) {
  const P = (q) => fr.P(s + q[0] * k * side, y0 + q[1] * k, d + q[2] * k);
  const E = (c, r) => ell(acc, P(c), r.map((v) => v * k), fr.rot);
  const L = (a, b, ra, rb) => limb(acc, P(a), P(b), ra * k, rb * k);
  if (pose === 'stand' || pose === 'stand1') {
    L([-0.12, 0, 0], [-0.12, 0.85, 0], 0.07, 0.1); L([0.12, 0, 0], [0.12, 0.85, 0], 0.07, 0.1);
    E([0, 0.62, 0.02], [0.24, 0.62, 0.16]);                          // the robe's fall
    E([0, 1.2, 0], [0.2, 0.3, 0.13]);                                // the chest
    E([0, 1.62, 0.01], [0.09, 0.11, 0.1]);                           // the head
    if (pose === 'stand') { L([-0.2, 1.38, 0], [-0.62, 1.55, 0.08], 0.05, 0.04); L([0.2, 1.38, 0], [0.62, 1.55, 0.08], 0.05, 0.04); }
    else { L([-0.2, 1.38, 0], [-0.26, 0.95, 0.05], 0.05, 0.04); L([0.2, 1.38, 0], [0.42, 1.25, 0.32], 0.05, 0.04); }
  } else if (pose === 'kneel') {
    E([0, 0.28, 0], [0.26, 0.24, 0.2]);                              // the knee and the robe
    L([0.05, 0.18, 0], [0.4, 0.1, 0.05], 0.08, 0.07);
    E([-0.05, 0.75, 0], [0.18, 0.3, 0.13]);                          // the body
    E([-0.08, 1.12, 0.02], [0.085, 0.1, 0.095]);
    L([0.1, 0.9, 0], [0.42, 0.72, 0.15], 0.045, 0.04); L([-0.18, 0.92, 0], [-0.3, 0.6, 0.05], 0.045, 0.04);
  } else if (pose === 'sit') {
    E([0, 0.25, 0], [0.3, 0.22, 0.22]);
    L([0.1, 0.32, 0.05], [0.42, 0.3, 0.12], 0.08, 0.07); L([0.42, 0.3, 0.12], [0.45, 0.0, 0.12], 0.07, 0.05);
    E([-0.05, 0.62, 0], [0.17, 0.27, 0.13]);
    E([-0.04, 0.96, 0.02], [0.08, 0.095, 0.09]);
    L([0.1, 0.78, 0.02], [0.32, 0.55, 0.12], 0.045, 0.04);
  } else {                                                           // reclining toward the middle
    E([0, 0.16, 0], [0.5, 0.16, 0.2]);
    E([0.38, 0.32, 0], [0.18, 0.2, 0.13]);
    E([0.5, 0.52, 0.02], [0.08, 0.09, 0.085]);
    L([0.3, 0.38, 0], [0.12, 0.05, 0.12], 0.045, 0.04);
  }
}
// a flight of steps along a front from s0 to s1, n risers of `rise`, `tread` deep, from depth d0 outward, up to y = n * rise
function stepsAt(acc, fr, s0, s1, d0, n, rise, tread) {
  for (let k = 0; k < n; k++) {
    const [cx, , cz] = fr.P((s0 + s1) / 2, 0, d0 + (n - k - 0.5) * tread);
    obox(acc, cx, -0.3, cz, s1 - s0, (k + 1) * rise + 0.3, tread + 0.02, fr.rot);
  }
}
// a pointed opening as a flat shape in a front's plane: P(s, y, d) maps to world, s from -hw to hw, the jambs from y0 to the
// springing ys, the point at yp; facing n
function archShape(acc, P, n, hw, y0, ys, yp, d, sOff = 0) {
  const pts = [];
  for (let k = 0; k <= 10; k++) { const a = Math.PI * k / 10; pts.push([sOff - hw * Math.cos(a), ys + (yp - ys) * Math.sin(a) ** 0.7]); }
  acc.quad(P(sOff - hw, y0, d), P(sOff + hw, y0, d), P(sOff + hw, ys, d), P(sOff - hw, ys, d), n);
  for (let k = 0; k < 10; k++) triN(acc, P(sOff, ys, d), P(pts[k][0], pts[k][1], d), P(pts[k + 1][0], pts[k + 1][1], d), n);
}
// marble ashlar: courses and joints, a faint veining, the grime under the cornices
function ashlarPaint(base, o = {}) {
  return (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, base, 150, o.rough ?? 0.6, 0);
    speckle(ga, 0, 0, W, H, r, 1200, 0.045);
    const ch = o.course || H / 8, bw = o.block || W / 3;
    for (let y = 0, row = 0; y < H; y += ch, row++) {
      ga.fillStyle = 'rgba(70,64,56,0.25)'; ga.fillRect(0, y, W, 1.5); gb.fillStyle = 'rgb(110,110,110)'; gb.fillRect(0, y, W, 2);
      for (let x = (row % 2) * bw / 2; x < W; x += bw) { ga.fillRect(x, y, 1.5, ch); gb.fillRect(x, y, 2, ch); }
      for (let x = 0; x < W; x += bw / 2) { ga.fillStyle = `rgba(${r() < 0.5 ? '255,250,240' : '120,112,100'},${(r() * 0.05).toFixed(3)})`; ga.fillRect(x, y + 2, bw / 2, ch - 3); }
    }
    for (let i = 0; i < 40; i++) { ga.strokeStyle = 'rgba(150,140,128,0.12)'; ga.lineWidth = 1; ga.beginPath(); const x = r() * W, y = r() * H; ga.moveTo(x, y); ga.bezierCurveTo(x + 20, y + 10, x + 30, y - 10, x + 60, y + 5); ga.stroke(); }
    streaks(ga, 0, 0, W, H, r, 20, 0.04);
  };
}

/* ------------------------------------------------- the New York Stock Exchange */
// George B. Post, 1903. The Broad Street front: a rusticated podium with its five doorways, six Corinthian columns 16 m tall
// in front of the great window between two pilastered end bays, the entablature and the pediment with its figures; the
// attic set back over the main cornice behind a balustrade; the Wall Street front's giant pilasters; marble everywhere.
const NYX = { MARBLE: [228, 224, 214], MARB2: [212, 208, 198], GLASS: [52, 60, 70], FRAME: [70, 66, 60] };
let _NY = null;
function nyMats() {
  if (_NY) return _NY;
  const wall = texd('ny-wall', 256, 512, bayPaint({ nx: 2, ny: 4, wall: NYX.MARBLE, spand: NYX.MARB2, glass: NYX.GLASS, frame: NYX.FRAME, ashlar: 16, rough: 0.55, win: [0.24, 0.76, 0.18, 0.74], tone: 0.03 }), 191, 0.55, 2, 4);
  const podium = texd('ny-podium', 256, 256, ashlarPaint(NYX.MARB2, { course: 256 / 6, block: 256 / 2.4, rough: 0.6 }), 192, 0.6, 1, 1);
  const window = texd('ny-window', 256, 256, (ga, gb, go, W, H, r) => {          // the great window: a bronze grid of panes
    fill3(ga, gb, go, 0, 0, W, H, [70, 80, 90], 60, 0.1, 0.2);
    const g = ga.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(170,190,205,0.35)'); g.addColorStop(1, 'rgba(255,220,170,0.12)');
    ga.fillStyle = g; ga.fillRect(0, 0, W, H);
    for (let i = 0; i <= 8; i++) fill3(ga, gb, go, (i * W) / 8 - 2, 0, 4, H, [96, 84, 66], 170, 0.4, 0.6);
    for (let j = 0; j <= 8; j++) fill3(ga, gb, go, 0, (j * H) / 8 - 2, W, 4, [96, 84, 66], 170, 0.4, 0.6);
  }, 193, 0.1, 1, 1);
  _NY = {
    tx: { wall, podium, window },
    wall: tileMat3('ny-wall', wall, { bump: 1.3 }),
    podium: tileMat3('ny-podium', podium, { bump: 1.6 }),
    window: tileMat3('ny-window', window, { bump: 0.8 }),
    marble: mat(0xe4e0d6, { rough: 0.5, flat: false, stone: { set: 'climestone', amt: 0.2, nrm: 0.35, rgh: 0.2, ashlar: 0.2 } }),
    roof: roofMat(),
    dark: mat(0x1e2226, { rough: 0.5, flat: false }),
    bronze: mat(0x5a4a36, { rough: 0.45, metal: 0.7, flat: false }),
  };
  return _NY;
}
export function buildNYSE(ctx) {
  const m = model(ctx, 'nyse');
  if (!m) return null;
  const ring = ctx.footprint;
  const M = nyMats();
  const g = new THREE.Group();
  const WL = new Acc(), PD = new Acc(), WN = new Acc(), MB = new Acc(), RF = new Acc(), DK = new Acc(), BZ = new Acc();
  const fr = frontOf(ring, [0.9, 0.43]);                         // the Broad Street front faces east-south-east
  const yP = 6.7, yC = 22.7, yE = 27.0, hP = 7.6, yA = 43.4;     // podium, columns' top, entablature's top, pediment rise, attic top
  const main = m.R.reduce((a, q) => (q.A > a.A ? q : a), m.R[0]);
  const yRoof = Math.max(yA + 0.5, main.h1);
  // the walls round the ring but the front: marble with windows to the main cornice; the attic over it, set back
  let A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; A += p[0] * q[1] - q[0] * p[1]; }
  const sg = A > 0 ? 1 : -1;
  const attic = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    const n = [sg * ez / L, -sg * ex / L];
    const isFront = a === fr.a && b === fr.b;
    const w = { a, b, n, L, ya: yE, yb: yE };
    if (!isFront && L > 0.5) {
      runQuad(PD, w, 0, yP, { s0: 0, cw: 1 }, M.tx.podium, 1, 0);
      const lay = layout(L, 3.4, 0.8);
      runQuad(WL, w, yP, yE, lay, M.tx.wall, (yE - yP) / 4, yP);
      sweepRun(MB, a, b, n, yP - 0.2, [[0, 0], [0.25, 0.05], [0.25, 0.4], [0, 0.45]], 0.25);
      sweepRun(MB, a, b, n, yE - 0.9, PROF_40.cornice.map(([d, h]) => [d * 1.6, h * 1.2]), 0.9);
      // the Wall Street front (the long north edge) and the others: giant pilasters between the windows
      const np = Math.max(2, Math.round(L / 5.2));
      for (let k = 0; k <= np; k++) {
        const s = 0.6 + (L - 1.2) * k / np, [px, pz] = runPt(w, s, 0.25);
        obox(MB, px, yP, pz, 1.1, yE - yP - 0.9, 0.5, runRot(w));
        obox(MB, px, yE - 2.2, pz, 1.4, 1.0, 0.7, runRot(w));            // its capital
      }
    }
    attic.push(isFront ? 8.0 : 1.4);
  }
  // the attic ring: every edge moved in (the front by 6 m) and walled from the main cornice to the roof
  {
    const inner = insetRing(ring, attic, sg);
    const nI = inner.length;
    for (let i = 0; i < nI; i++) {
      const a = inner[i], b = inner[(i + 1) % nI], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
      if (L < 0.5) continue;
      const n = [sg * ez / L, -sg * ex / L], w = { a, b, n, L, ya: yRoof, yb: yRoof };
      runQuad(WL, w, yE, yRoof, layout(L, 3.4, 0.6), M.tx.wall, 4.1, yE);
      sweepRun(MB, a, b, n, yRoof - 0.6, PROF_40.coping.map(([d, h]) => [d * 1.6, h * 1.5]), 0.2);
    }
    capSurface(RF, { P: inner.map(([x, z]) => [x, z, yRoof]), H: [] }, 0.08);
    // the deck over the main cornice between the ring and the attic, and the balustrade along its edge
    capSurface(RF, { P: ring.map(([x, z]) => [x, z, yE]), H: [inner.map(([x, z]) => [x, z, yE])] }, 0.08, 0.02);
    balustradeRing(MB, insetRing(ring, ring.map(() => 0.35), sg), yE);
  }
  // the penthouse from the model (the flat surface over the main roof)
  for (const q of m.R) if (q.h1 > main.h1 + 2) {
    for (const ring2 of [q.P]) {
      const n2 = ring2.length;
      for (let i = 0; i < n2; i++) {
        const a = ring2[i], b = ring2[(i + 1) % n2], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 0.3) continue;
        let n = [ez / L, -ex / L];
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        let inside = false;
        for (let k = 0, j = n2 - 1; k < n2; j = k++) { const xi = ring2[k][0], zi = ring2[k][1], xj = ring2[j][0], zj = ring2[j][1]; if ((zi > mz + n[1] * 0.05) !== (zj > mz + n[1] * 0.05) && mx + n[0] * 0.05 < ((xj - xi) * (mz + n[1] * 0.05 - zi)) / (zj - zi) + xi) inside = !inside; }
        if (inside) n = [-n[0], -n[1]];
        runQuad(WL, { a: [a[0], a[1]], b: [b[0], b[1]], n, L, ya: q.h1, yb: q.h1 }, yRoof, q.h1, layout(L, 3.4, 0.4), M.tx.wall, 4.1, yRoof);
      }
    }
    capSurface(RF, q, 0.08, 0.02);
  }
  // ---- the Broad Street front
  const L = fr.L, wp = 5.8, s0 = -L / 2, s1 = L / 2, c0 = s0 + wp, c1 = s1 - wp, dW = -3.6;
  const quad = (acc, sa, sb, ya, yb, d, uv) => acc.quad(fr.P(sa, ya, d), fr.P(sb, ya, d), fr.P(sb, yb, d), fr.P(sa, yb, d), fr.N(0, 0, 1), ...(uv || []));
  quad(PD, s0, s1, 0, yP, 0, [[0, 0], [L / 4, 0], [L / 4, yP / 4], [0, yP / 4]]);                       // the podium
  for (let k = 0; k < 5; k++) {                                                                         // its doorways
    const sc = c0 + (c1 - c0) * (k + 0.5) / 5;
    quad(DK, sc - 1.3, sc + 1.3, 0.3, 4.6, 0.04);
    quad(BZ, sc - 1.05, sc + 1.05, 0.3, 4.3, 0.06);
    { const [lx, , lz] = fr.P(sc, 0, 0.18); obox(MB, lx, 4.6, lz, 3.4, 0.5, 0.36, fr.rot); }
  }
  for (const [sa, sb] of [[s0, c0], [c1, s1]]) {                                                        // the end bays
    quad(WL, sa, sb, yP, yE, 0, [[0, 0], [(sb - sa) / 3.4 / 2, 0], [(sb - sa) / 3.4 / 2, 1], [0, 1]]);
    for (const sp of [sa + 0.75, sb - 0.75]) { const [x, , z] = fr.P(sp, 0, 0.3); obox(MB, x, yP, z, 1.3, yC - yP, 0.6, fr.rot); }
  }
  // the great window behind the columns, the side walls of the recess, its ceiling
  quad(WN, c0, c1, yP, yC + 0.3, dW, [[0, 0], [2, 0], [2, 2], [0, 2]]);
  for (const [sa, nn] of [[c0, 1], [c1, -1]]) MB.quad(fr.P(sa, yP, dW), fr.P(sa, yP, 0), fr.P(sa, yC + 0.3, 0), fr.P(sa, yC + 0.3, dW), fr.N(nn, 0, 0));
  MB.quad(fr.P(c0, yP, dW), fr.P(c1, yP, dW), fr.P(c1, yP, 0), fr.P(c0, yP, 0), [0, 1, 0]);
  // six columns, the antae at the ends
  for (let k = 0; k < 6; k++) {
    const sc = c0 + (c1 - c0) * (k + 0.5) / 6, [x, , z] = fr.P(sc, 0, -1.25);
    column(MB, x, yP, z, 0.84, yC - yP, 'corinthian', fr.rot);
  }
  // the entablature across the whole front, the pediment over the colonnade with its figures
  {
    const [x, , z] = fr.P(0, 0, -0.9);
    obox(MB, x, yC, z, L + 0.3, 1.5, 2.8, fr.rot);                     // the architrave
    obox(MB, x, yC + 1.5, z, L + 0.1, 1.7, 2.6, fr.rot);               // the frieze
    const [x2, , z2] = fr.P(0, 0, -0.75);
    obox(MB, x2, yC + 3.2, z2, L + 1.2, 0.95, 3.4, fr.rot);           // the cornice
    pediment(MB, fr, c0 - 1.2, c1 + 1.2, yE + 0.15, hP, -2.4, 0.4, 5.5);
    const fig = [['stand', 0, 1.0], ['kneel', 3.3, 0.95], ['kneel', -3.3, 0.95], ['sit', 6.4, 0.85], ['sit', -6.4, 0.85], ['kneel', 9.3, 0.7], ['kneel', -9.3, 0.7], ['recline', 12.2, 0.6], ['recline', -12.2, 0.6]];
    const span = (c1 - c0) / 2 + 1.2;
    for (const [pose, s, kk] of fig) {
      const yb = yE + 0.4, room = hP * (1 - Math.abs(s) / span) - 0.9;
      const k = Math.max(0.8, Math.min(room / (pose === 'stand' ? 1.75 : pose === 'kneel' ? 1.25 : pose === 'sit' ? 1.05 : 0.65), 3.6 * kk));
      figureAt(MB, fr, s, yb, -1.9, k, pose, s < 0 ? -1 : 1);
    }
  }
  addMeshes(g, [[WL, M.wall, 'lm65:nyse:walls'], [PD, M.podium, 'lm65:nyse:podium'], [WN, M.window, 'lm65:nyse:window'], [MB, M.marble, 'lm65:nyse:marble'],
    [RF, M.roof, 'lm65:nyse:roofs'], [DK, M.dark, 'lm65:nyse:dark'], [BZ, M.bronze, 'lm65:nyse:doors']]);
  const B = bounds(m.R);
  g.userData.colliderBoxes = [{ x: B.cx, y: yRoof / 2, z: B.cz, w: B.x1 - B.x0, h: yRoof, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount([[WL], [PD], [WN], [MB], [RF], [DK], [BZ]]);
  return g;
}
// each edge of a ring moved in by its own distance (d[i] for the edge from vertex i to i + 1), corners where the moved lines meet
function insetRing(ring, d, sg) {
  const n = ring.length, Ls = [];
  for (let i = 0; i < n; i++) {
    const a = ring[i], b = ring[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
    const nx = sg * ez / L, nz = -sg * ex / L;
    Ls.push({ p: [a[0] - nx * d[i], a[1] - nz * d[i]], t: [ex / L, ez / L] });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = Ls[(i - 1 + n) % n], B = Ls[i];
    const den = A.t[0] * B.t[1] - A.t[1] * B.t[0];
    if (Math.abs(den) < 1e-3) { out.push(B.p); continue; }
    const wx = B.p[0] - A.p[0], wz = B.p[1] - A.p[1], k = (wx * B.t[1] - wz * B.t[0]) / den;
    out.push([A.p[0] + A.t[0] * k, A.p[1] + A.t[1] * k]);
  }
  return out;
}
// a balustrade round a ring at y: rails, balusters 0.45 m apart, a pedestal every 3.6 m
function balustradeRing(acc, ring, y) {
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.8) continue;
    const rot = Math.atan2(-ez, ex), mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    obox(acc, mx, y, mz, L, 0.22, 0.42, rot);
    obox(acc, mx, y + 0.95, mz, L, 0.18, 0.46, rot);
    const nb = Math.max(1, Math.round(L / 0.45));
    for (let k = 0; k < nb; k++) { const t = (k + 0.5) / nb; ngonLathe(acc, a[0] + ex * t, a[1] + ez * t, y + 0.22, [[0.08, 0], [0.12, 0.15], [0.06, 0.4], [0.09, 0.7], [0.09, 0.73]], 5); }
    const np = Math.max(1, Math.round(L / 3.6));
    for (let k = 0; k <= np; k++) { const t = k / np; obox(acc, a[0] + ex * t, y, a[1] + ez * t, 0.45, 1.15, 0.45, rot); }
  }
}

/* ---------------------------------------------------------- Federal Hall */
// Town and Davis, 1842: a Doric temple of white marble. Eight columns on Wall Street over a broad flight of steps, the
// entablature with its triglyphs, the low pediment; the side walls with their antae and tall windows, the portico on Pine
// Street at the back, the low roof; George Washington's statue on its pedestal on the steps.
let _FH = null;
function fhMats() {
  if (_FH) return _FH;
  const wall = texd('fh-wall', 256, 512, ashlarPaint([214, 210, 200], { course: 512 / 14, block: 256 / 1.6, rough: 0.55 }), 195, 0.55, 1, 1);
  const frieze = texd('fh-frieze', 512, 64, (ga, gb, go, W, H, r) => {          // triglyphs and metopes
    fill3(ga, gb, go, 0, 0, W, H, [214, 210, 200], 150, 0.55, 0);
    const n = 8, pw = W / n;
    for (let k = 0; k < n; k++) {
      const x = k * pw;
      fill3(ga, gb, go, x, 0, pw * 0.38, H, [200, 196, 186], 190, 0.55, 0);
      for (let q = 1; q < 3; q++) fill3(ga, gb, go, x + (pw * 0.38 * q) / 3 - 1.5, 4, 3, H - 8, [160, 154, 144], 110, 0.55, 0);
    }
  }, 196, 0.55, 1, 1);
  _FH = {
    tx: { wall, frieze },
    wall: tileMat3('fh-wall', wall, { bump: 1.3 }),
    frieze: tileMat3('fh-frieze', frieze, { bump: 1.6 }),
    marble: mat(0xdcd8ce, { rough: 0.5, flat: false, stone: { set: 'climestone', amt: 0.2, nrm: 0.35, rgh: 0.2, ashlar: 0.25 } }),
    granite: mat(0x9c9a94, { rough: 0.7, flat: false, stone: { set: 'cgranite', amt: 0.3, nrm: 0.4, rgh: 0.2 } }),
    roof: mat(0x6c6e70, { rough: 0.6, metal: 0.25, flat: false }),
    dark: mat(0x2a2c30, { rough: 0.4, flat: false }),
    bronze: mat(0x4d4232, { rough: 0.45, metal: 0.7, flat: false }),
  };
  return _FH;
}
export function buildFederalHall(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const M = fhMats();
  const g = new THREE.Group();
  const WL = new Acc(), FZ = new Acc(), MB = new Acc(), GR = new Acc(), RF = new Acc(), DK = new Acc(), BZ = new Acc();
  const fr0 = frontOf(ring, [-0.45, 0.89]);                        // the Wall Street front faces south (+z) down Broad Street
  const L = fr0.L, hw = L / 2 - 0.4;
  let depth = 0;
  for (const [x, z] of ring) depth = Math.max(depth, -((x - fr0.m[0]) * fr0.n[0] + (z - fr0.m[1]) * fr0.n[1]));
  const yS = 4.2, yC = yS + 10.0, yE = yC + 2.6, yR = 20.4;        // the stylobate, the columns' top, the entablature's top, the ridge
  // depths (metres out of the front line, negative inward): the steps from 0 to dF, the front columns at cF, the cella from dP to
  // dQ, the back columns at cB, the podium's back at dB
  const dF = -2.4, cF = dF - 1.0, dP = dF - 5.6, dB = -depth + 0.4, cB = dB + 1.0, dQ = dB + 4.8;
  const fb = { ...fr0, P: (s, y, d) => fr0.P(-s, y, 2 * dB - d), N: (a, b, c) => fr0.N(-a, b, -c), rot: fr0.rot + Math.PI };   // the back's own frame
  const Q = (acc, f, sa, sb, ya, yb, d, n, uv) => acc.quad(f.P(sa, ya, d), f.P(sb, ya, d), f.P(sb, yb, d), f.P(sa, yb, d), n || f.N(0, 0, 1), ...(uv || []));
  const uvW = (w, h) => [[0, 0], [w / 6, 0], [w / 6, h / 6], [0, h / 6]];
  // the podium and the steps up to it on Wall Street
  { const [x, , z] = fr0.P(0, 0, (dF + dB) / 2); obox(GR, x, 0, z, 2 * hw, yS, dF - dB, fr0.rot); }
  stepsAt(GR, fr0, -hw + 1.2, hw - 1.2, dF, 12, yS / 12, 0.2);
  // the cella: side walls with antae and tall windows, the front and back walls with their doorways
  for (const sgn of [-1, 1]) {
    const ss = sgn * (hw - 1.6);
    MB.quad(fr0.P(ss, yS, dQ), fr0.P(ss, yS, dP), fr0.P(ss, yE - 0.1, dP), fr0.P(ss, yE - 0.1, dQ), fr0.N(sgn, 0, 0));
    const nb = Math.max(2, Math.round((dP - dQ) / -5.2));
    for (let k = 0; k <= nb; k++) {
      const d = dQ + (dP - dQ) * k / nb, [x, , z] = fr0.P(ss + sgn * 0.3, 0, d);
      obox(MB, x, yS, z, 1.1, yC - yS, 0.6, fr0.rot);                                   // an anta
      if (k === nb) continue;
      const dm = d + (dP - dQ) / nb / 2, [wx, , wz] = fr0.P(ss + sgn * 0.04, 0, dm);
      obox(DK, wx, yS + 1.6, wz, 0.08, 4.8, 1.6, fr0.rot);                               // a tall window
      obox(MB, wx, yS + 6.4, wz, 0.3, 0.35, 2.0, fr0.rot);                               // its cornice
    }
  }
  for (const [f, d] of [[fr0, dP], [fb, 2 * dB - dQ]]) {
    Q(WL, f, -hw + 1.6, hw - 1.6, yS, yE - 0.1, d, null, uvW(2 * hw - 3.2, yE - yS));
    const [x, , z] = f.P(0, 0, d + 0.05);
    obox(DK, x, yS + 0.2, z, 2.6, 5.6, 0.12, f.rot);
    obox(MB, x, yS + 5.8, z, 3.6, 0.7, 0.4, f.rot);
  }
  // the porticoes: eight Doric columns, the architrave, the frieze of triglyphs, the cornice, the pediment
  for (const [f, c, wallD] of [[fr0, cF, dP], [fb, 2 * dB - cB, 2 * dB - dQ]]) {
    for (let k = 0; k < 8; k++) {
      const sx = -hw + 1.0 + (2 * hw - 2.0) * k / 7, [x, , z] = f.P(sx, 0, c);
      column(MB, x, yS, z, 0.82, yC - yS, 'doric', f.rot);
    }
    const dOut = c + 1.15, dIn = wallD, dm = (dOut + dIn) / 2, dep = dOut - dIn;
    { const [x, , z] = f.P(0, 0, dm); obox(MB, x, yC, z, 2 * hw + 0.3, 1.1, dep, f.rot); obox(MB, x, yC + 1.1, z, 2 * hw + 0.1, yE - 0.55 - yC - 1.1, dep - 0.2, f.rot); }
    FZ.quad(f.P(-hw - 0.05, yC + 1.1, dOut - 0.08), f.P(hw + 0.05, yC + 1.1, dOut - 0.08), f.P(hw + 0.05, yE - 0.55, dOut - 0.08), f.P(-hw - 0.05, yE - 0.55, dOut - 0.08), f.N(0, 0, 1), [0, 0], [3, 0], [3, 1], [0, 1]);
    { const [x, , z] = f.P(0, 0, dm + 0.15); obox(MB, x, yE - 0.55, z, 2 * hw + 1.2, 0.6, dep + 0.9, f.rot); }
    pediment(MB, f, -hw - 0.6, hw + 0.6, yE + 0.05, yR - yE - 0.1, dOut - 1.4, dOut + 0.45, 0.2);
  }
  // the roof: two low slopes from the ridge, front pediment to back pediment
  {
    const d0 = cF + 0.2, d1 = 2 * dB - (2 * dB - cB) - 0.2;
    for (const sgn of [-1, 1]) {
      const pA = fr0.P(sgn * (hw + 0.6), yE + 0.1, d0), pB = fr0.P(0, yR - 0.15, d0), pC = fr0.P(0, yR - 0.15, d1), pD = fr0.P(sgn * (hw + 0.6), yE + 0.1, d1);
      const e1 = [pB[0] - pA[0], pB[1] - pA[1], pB[2] - pA[2]], e2 = [pD[0] - pA[0], pD[1] - pA[1], pD[2] - pA[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const nl = Math.hypot(...n); n = n.map((v) => v / nl); if (n[1] < 0) n = n.map((v) => -v);
      RF.quad(pA, pB, pC, pD, n, [0, 0], [hw / 2, 0], [hw / 2, Math.abs(d1 - d0) / 2], [0, Math.abs(d1 - d0) / 2]);
    }
    const [x, , z] = fr0.P(0, 0, (d0 + d1) / 2);
    ngon(RF, x, z, yR - 0.4, yR + 0.9, 3.4, 2.6, 16, 0, true);                         // the rotunda's skylight
  }
  // Washington on his granite pedestal, halfway up the steps
  {
    const d = dF * 0.45, yb = yS * 0.45, [x, , z] = fr0.P(0, 0, d);
    obox(GR, x, yb - 0.2, z, 2.6, 0.6, 2.6, fr0.rot);
    obox(GR, x, yb + 0.4, z, 2.1, 2.6, 2.1, fr0.rot);
    obox(GR, x, yb + 3.0, z, 2.4, 0.4, 2.4, fr0.rot);
    const P = (q) => fr0.P(q[0], yb + 3.4 + q[1], d + q[2]);
    const E = (c, r) => ell(BZ, P(c), r, fr0.rot), Lm = (a, b, ra, rb) => limb(BZ, P(a), P(b), ra, rb);
    Lm([-0.22, 0, 0], [-0.2, 1.6, 0], 0.16, 0.2); Lm([0.22, 0, 0], [0.2, 1.6, 0], 0.16, 0.2);
    E([0, 1.75, 0], [0.42, 0.32, 0.3]);
    E([0, 2.45, 0], [0.4, 0.55, 0.28]);
    E([0, 3.2, 0.02], [0.17, 0.21, 0.19]);
    Lm([-0.42, 2.85, 0], [-0.55, 1.95, 0.1], 0.1, 0.08);
    Lm([0.42, 2.85, 0], [0.75, 2.45, 0.5], 0.1, 0.08);
    E([0, 1.5, -0.18], [0.55, 0.9, 0.22]);
  }
  addMeshes(g, [[WL, M.wall, 'lm65:federalhall:walls'], [FZ, M.frieze, 'lm65:federalhall:frieze'], [MB, M.marble, 'lm65:federalhall:marble'], [GR, M.granite, 'lm65:federalhall:granite'],
    [RF, M.roof, 'lm65:federalhall:roof'], [DK, M.dark, 'lm65:federalhall:dark'], [BZ, M.bronze, 'lm65:federalhall:washington']]);
  const [cx, , cz] = fr0.P(0, 0, -depth / 2);
  g.userData.colliderBoxes = [{ x: cx, y: yR / 2, z: cz, w: L, h: yR, d: depth, rotY: fr0.rot }];
  g.userData.tris = triCount([[WL], [FZ], [MB], [GR], [RF], [DK], [BZ]]);
  return g;
}

/* ---------------------------------------------------------- Trinity Church */
// Richard Upjohn, 1846: Gothic Revival in brownstone. From the city's 3D building model: the nave's steep roof over the
// clerestory, the aisles' lean-to roofs, the chancel and the parish buildings to the west, the tower on Broadway with its
// buttresses stepping back stage by stage, the corner pinnacles and the octagonal spire to 86 m. Modelled over it: the
// aisles' bays (a traceried window between buttresses with pinnacles), the clerestory, the tower's portal, its great window
// and belfry openings, the parapets, the spire's crockets and lucarnes, the cross.
const TR = { STONE: [138, 98, 86], STONE2: [118, 84, 74], GLASS: [42, 46, 58], SLATE: [70, 72, 78] };
// a Gothic bay: brownstone ashlar, one pointed window (tracery: a mullion, a circle in the head) over most of the wall's height
function gothicBayPaint(o) {
  return (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, o.stone, 150, 0.8, 0);
    speckle(ga, 0, 0, W, H, r, Math.round(W * H / 30), 0.08);
    const ch = H / (o.courses || 24);
    for (let y = 0, row = 0; y < H; y += ch, row++) {
      ga.fillStyle = 'rgba(40,24,18,0.22)'; ga.fillRect(0, y, W, 1.2); gb.fillStyle = 'rgb(115,115,115)'; gb.fillRect(0, y, W, 1.5);
      for (let x = (row % 2) * ch * 1.3; x < W; x += ch * 2.6) { ga.fillRect(x, y, 1.2, ch); }
      for (let x = 0; x < W; x += ch * 1.3) { ga.fillStyle = `rgba(${r() < 0.5 ? '40,24,18' : '200,160,140'},${(r() * 0.08).toFixed(3)})`; ga.fillRect(x, y + 1, ch * 1.3, ch - 1); }
    }
    if (o.win) {
      const [fx0, fx1, fy0, fy1] = o.win, x0 = W * fx0, x1 = W * fx1, xm = (x0 + x1) / 2, hw = (x1 - x0) / 2;
      const ya = H * fy0, ys = ya + hw * 1.25, yb = H * fy1;
      const arch = (g) => { g.moveTo(x0, yb); g.lineTo(x0, ys); g.quadraticCurveTo(x0, ya + (ys - ya) * 0.1, xm, ya); g.quadraticCurveTo(x1, ya + (ys - ya) * 0.1, x1, ys); g.lineTo(x1, yb); g.closePath(); };
      // the splayed reveal (a lighter stone band) and the glass
      ga.save(); ga.translate(xm, (ya + yb) / 2); ga.scale(1.12, 1.04); ga.translate(-xm, -(ya + yb) / 2);
      path3(ga, gb, go, arch, rgbs(o.stone, 1.12), 130, 0.75, 0); ga.restore();
      path3(ga, gb, go, arch, rgbs(o.glass, 1.0 + r() * 0.2), 50, 0.2, 0.1);
      // stained glass: a scatter of warm and blue panes, the leading
      for (let k = 0; k < 60; k++) { const px = x0 + r() * (x1 - x0), py = ys + r() * (yb - ys); ga.fillStyle = `rgba(${r() < 0.5 ? '120,60,50' : '50,70,120'},0.35)`; ga.fillRect(px, py, 3, 4); }
      for (const [g, col, lw] of [[ga, rgbs(o.stone, 1.05), Math.max(2, W * 0.03)], [gb, 'rgb(170,170,170)', Math.max(2, W * 0.03)]]) {
        g.strokeStyle = col; g.lineWidth = lw;
        g.beginPath(); g.moveTo(xm, ys + hw * 0.2); g.lineTo(xm, yb); g.stroke();
        if (o.mull > 1) for (const f of [0.33, 0.67]) { g.beginPath(); g.moveTo(x0 + (x1 - x0) * f, ys + hw * 0.4); g.lineTo(x0 + (x1 - x0) * f, yb); g.stroke(); }
        g.beginPath(); g.arc(xm, ya + (ys - ya) * 0.66, hw * 0.4, 0, Math.PI * 2); g.stroke();
        for (let k = 1; k < 4; k++) { const yy = ys + (yb - ys) * k / 4; g.beginPath(); g.moveTo(x0, yy); g.lineTo(x1, yy); g.stroke(); }
      }
      for (const [g, col] of [[ga, rgbs(o.stone, 1.15)], [gb, 'rgb(210,210,210)']]) {                    // the hood mould
        g.strokeStyle = col; g.lineWidth = Math.max(2, W * 0.04);
        g.beginPath(); g.moveTo(x0 - W * 0.05, ys); g.quadraticCurveTo(x0 - W * 0.05, ya - H * 0.01, xm, ya - H * 0.03); g.quadraticCurveTo(x1 + W * 0.05, ya - H * 0.01, x1 + W * 0.05, ys); g.stroke();
      }
    }
    streaks(ga, 0, 0, W, H, r, 14, 0.08);
  };
}
function slatePaint(ga, gb, go, W, H, r) {
  fill3(ga, gb, go, 0, 0, W, H, TR.SLATE, 140, 0.7, 0.05);
  const rh = H / 24, sw = W / 12;
  for (let j = 0; j < 24; j++) for (let i = 0; i < 13; i++) {
    const x = i * sw - (j % 2) * sw / 2, y = j * rh, k = 0.85 + r() * 0.3;
    fill3(ga, gb, go, x + 1, y + 1, sw - 2, rh - 1, rgbs(TR.SLATE, k), 150 + Math.round(r() * 20), 0.6 + r() * 0.15, 0.05);
    ga.fillStyle = 'rgba(0,0,0,0.35)'; ga.fillRect(x, y + rh - 1.5, sw, 1.5);
  }
}
let _TRM = null;
function trMats() {
  if (_TRM) return _TRM;
  const aisle = texd('tr-aisle', 256, 512, gothicBayPaint({ stone: TR.STONE, glass: TR.GLASS, win: [0.2, 0.8, 0.2, 0.9], mull: 2 }), 221, 0.8, 1, 1);
  const clere = texd('tr-clere', 256, 256, gothicBayPaint({ stone: TR.STONE, glass: TR.GLASS, win: [0.25, 0.75, 0.15, 0.85], mull: 1, courses: 12 }), 222, 0.8, 1, 1);
  const plain = texd('tr-plain', 256, 256, gothicBayPaint({ stone: TR.STONE, courses: 16 }), 223, 0.8, 1, 1);
  const belfry = texd('tr-belfry', 256, 512, (ga, gb, go, W, H, r) => {          // two tall louvred openings
    gothicBayPaint({ stone: TR.STONE, courses: 30 })(ga, gb, go, W, H, r);
    for (const [fx0, fx1] of [[0.12, 0.44], [0.56, 0.88]]) {
      const x0 = W * fx0, x1 = W * fx1, xm = (x0 + x1) / 2, ya = H * 0.08, ys = ya + (x1 - x0) * 0.6, yb = H * 0.92;
      const arch = (g) => { g.moveTo(x0, yb); g.lineTo(x0, ys); g.quadraticCurveTo(x0, ya, xm, ya); g.quadraticCurveTo(x1, ya, x1, ys); g.lineTo(x1, yb); g.closePath(); };
      path3(ga, gb, go, arch, [30, 28, 28], 60, 0.6, 0);
      for (let y = ys; y < yb; y += 7) { fill3(ga, gb, go, x0 + 2, y, x1 - x0 - 4, 3, [96, 74, 62], 120, 0.6, 0); }
    }
  }, 224, 0.8, 1, 1);
  const slate = tile3('tr-slate', 256, 256, slatePaint, 225, 0.7);
  _TRM = {
    tx: { aisle, clere, plain, belfry },
    aisle: tileMat3('tr-aisle', aisle, { bump: 1.4 }),
    clere: tileMat3('tr-clere', clere, { bump: 1.4 }),
    plain: tileMat3('tr-plain', plain, { bump: 1.4 }),
    belfry: tileMat3('tr-belfry', belfry, { bump: 1.4 }),
    slate: tileMat3('tr-slate', slate, { bump: 1.2 }),
    stone: mat(0x8e6656, { rough: 0.8, flat: false, stone: { set: 'cgranite', amt: 0.35, nrm: 0.5, rgh: 0.25 } }),
    dark: mat(0x22201f, { rough: 0.5, flat: false }),
    bronze: mat(0x4e4232, { rough: 0.45, metal: 0.7, flat: false }),
    gilt: mat(0xc8a24c, { rough: 0.3, metal: 0.85, flat: false }),
  };
  return _TRM;
}
export function buildTrinity(ctx) {
  const m = model(ctx, 'trinityChurch');
  if (!m) return null;
  const { R, SP } = m;
  const M = trMats();
  const g = new THREE.Group();
  const AS = new Acc(), CL = new Acc(), PL = new Acc(), BF = new Acc(), SL = new Acc(), ST = new Acc(), DK = new Acc(), BZ = new Acc(), GI = new Acc();
  const tower = R.filter((q) => q.h1 > 43 && q.flat).reduce((a, q) => (q.A > (a ? a.A : 0) ? q : a), null);
  const spire = R.filter((q) => q.h1 > 80);
  const runs = [];
  stepWalls(R.filter((q) => !(q.h1 > 80)), (w) => runs.push(w), { step: 0.6 });
  const pinT = (x, y, z, rot) => pinnacle(ST, x, y, z, 2.6, 0.32, rot);
  const inTowerXZ = (w) => tower && Math.hypot((w.a[0] + w.b[0]) / 2 - tower.c[0], (w.a[1] + w.b[1]) / 2 - tower.c[1]) < 9;
  facadeRuns(runs, (w, top, hgt) => {
    if (w.q.h1 - w.q.h0 > 0.3 && hgt < 3) return { plain: PL };
    if (inTowerXZ(w) && top > 30) {                                  // the tower's walls: the belfry stage at the top
      return { acc: PL, tex: M.tx.plain, floor: 6, col: 4, trim: ST, headH: Math.min(14, hgt * 0.5), headAcc: BF, headTex: M.tx.belfry, coping: [[0, 0], [0.3, 0], [0.3, 0.9], [0, 1.0]] };
    }
    if (top < 18.5 && hgt > 8) {                                     // the aisles: a traceried window per bay, buttresses between
      return { acc: AS, tex: M.tx.aisle, floor: hgt, vRef: w.y0, col: 5.2, corner: 0.9, trim: ST, coping: [[0, 0], [0.25, 0], [0.25, 0.7], [0, 0.85]],
        pier: { every: 1, w: 0.9, d: 1.1, cd: 1.1, over: 1.2, minH: 6, pin: pinT } };
    }
    if (top > 20 && top < 30 && hgt > 3) {                          // the clerestory
      return { acc: CL, tex: M.tx.clere, floor: hgt, vRef: w.y0, col: 5.2, corner: 0.5, trim: ST, coping: [[0, 0], [0.2, 0], [0.2, 0.6], [0, 0.7]],
        pier: { every: 1, w: 0.6, d: 0.45, minH: 3 } };
    }
    return { acc: PL, tex: M.tx.plain, floor: 6, col: 4, trim: ST, coping: [[0, 0], [0.2, 0], [0.2, 0.5], [0, 0.6]] };
  });
  for (const q of R) {
    if (q.h1 > 80) capSurface(ST, q, 0.3);                           // the spire's eight faces
    else if (q.h1 - q.h0 > 0.3) capSurface(SL, q, 0.2);
    else capSurface(q.h1 > 40 ? ST : SL, q, 0.15, 0.01);
  }
  // the tower: its portal and great window on the Broadway front, the parapet, the corner pinnacles, the spire's crockets and
  // lucarnes, the cross
  if (tower) {
    const [tx, tz] = tower.c, ring = ctx.footprint;
    const fr = frontOf(ring, [0.875, 0.485]);
    const dTow = (tx - fr.m[0]) * fr.n[0] + (tz - fr.m[1]) * fr.n[1];   // the tower's centre behind the front line
    const sT = (tx - fr.m[0]) * fr.r[0] + (tz - fr.m[1]) * fr.r[1];
    // the face of the tower on Broadway: the farthest wall run of the tower in the front's direction
    let dFace = -1e9;
    for (const w of runs) if (inTowerXZ(w) && w.n[0] * fr.n[0] + w.n[1] * fr.n[1] > 0.9) dFace = Math.max(dFace, (w.a[0] - fr.m[0]) * fr.n[0] + (w.a[1] - fr.m[1]) * fr.n[1]);
    if (dFace > -1e8) {
      const P = (s, y, d) => fr.P(sT + s, y, dFace + d);
      const arch = (acc, hw, y0, ys, yp, d) => archShape(acc, P, fr.N(0, 0, 1), hw, y0, ys, yp, d);
      // the portal: a deep pointed arch with its jamb shafts, the bronze doors, the gable over it
      arch(ST, 3.4, 0, 6.2, 9.2, 0.6);
      arch(DK, 2.6, 0, 5.8, 8.4, 0.62);
      BZ.quad(P(-1.9, 0, 0.64), P(1.9, 0, 0.64), P(1.9, 5.2, 0.64), P(-1.9, 5.2, 0.64), fr.N(0, 0, 1));
      for (const sx of [-3.0, -2.75, 2.75, 3.0]) { const [x, , z] = P(sx, 0, 0.85); ngon(ST, x, z, 0, 6.0, 0.16, 0.16, 6, 0, true); }
      for (const sg of [-1, 1]) {                                      // the gable's raking copings
        const A = P(sg * 3.9, 8.0, 0.8), B = P(0, 11.6, 0.8);
        const dir = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], Ld = Math.hypot(...dir);
        const geo = new THREE.BoxGeometry(Ld, 0.45, 0.9);
        const ux = new THREE.Vector3(dir[0] / Ld, dir[1] / Ld, dir[2] / Ld), nz = new THREE.Vector3(...fr.N(0, 0, 1));
        const uy = new THREE.Vector3().crossVectors(nz, ux).normalize(), uz = new THREE.Vector3().crossVectors(ux, uy);
        ST.addGeo(geo, new THREE.Matrix4().makeBasis(ux, uy, uz).setPosition((A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2)); geo.dispose();
      }
      { const [x, , z] = P(0, 0, 0.8); pinnacle(ST, x, 11.4, z, 2.4, 0.3, fr.rot); }
      // the great window over the portal
      arch(ST, 2.5, 13.0, 19.5, 23.0, 0.08);
      arch(DK, 2.0, 13.4, 19.3, 22.3, 0.12);
      for (const sx of [-0.7, 0.7]) { const [x, , z] = P(sx, 0, 0.16); obox(ST, x, 13.4, z, 0.18, 7.0, 0.1, fr.rot); }
      void dTow;
    }
    // the tower's parapet: battlements round its top
    const yT = tower.h1;
    for (const q of [tower]) {
      const Pq = q.P, n = Pq.length;
      for (let i = 0; i < n; i++) {
        const a = Pq[i], b = Pq[(i + 1) % n], ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 1.5) continue;
        const rot = Math.atan2(-ez, ex), nb = Math.max(1, Math.round(L / 1.2));
        for (let k = 0; k < nb; k += 2) { const t = (k + 0.5) / nb; obox(ST, a[0] + ex * t, yT, a[1] + ez * t, L / nb, 1.3, 0.45, rot); }
        obox(ST, (a[0] + b[0]) / 2, yT, (a[1] + b[1]) / 2, L, 0.6, 0.5, rot);
      }
    }
    for (const [x, z, y0, y1, r] of SP) {                             // the corner pinnacles: shafts from the parapet, crocketed cones
      ngon(ST, x, z, yT - 0.5, y0, r * 0.85, r * 0.85, 8, Math.PI / 8, false);
      pinnacle(ST, x, y0, z, (y1 - y0) * 1.05, r * 0.65, 0);
    }
    if (spire.length) {
      let sx = 0, sz = 0, apex = null;
      for (const q of spire) for (const p of q.P) if (!apex || p[2] > apex[2]) apex = p;
      const base = spire.flatMap((q) => q.P.filter((p) => p[2] < yT + 0.5));
      for (const p of base) { sx += p[0] / base.length; sz += p[1] / base.length; }
      const r0 = base.reduce((a, p) => Math.max(a, Math.hypot(p[0] - sx, p[1] - sz)), 0);
      const yA = apex[2];
      for (const p of base.slice(0, 8)) {                             // crockets up the spire's eight edges
        const ang = Math.atan2(p[1] - sz, p[0] - sx);
        for (let y = yT + 3; y < yA - 3; y += 2.4) {
          const t = (y - yT) / (yA - yT), rr = r0 * (1 - t) + 0.15;
          obox(ST, sx + Math.cos(ang) * rr, y, sz + Math.sin(ang) * rr, 0.28, 0.26, 0.28, -ang);
        }
      }
      for (let k = 0; k < 4; k++) {                                   // the lucarnes at the spire's foot
        const ang = Math.atan2(base[0][1] - sz, base[0][0] - sx) + Math.PI / 8 + k * Math.PI / 2;
        const rr = r0 * 0.82, x = sx + Math.cos(ang) * rr, z = sz + Math.sin(ang) * rr;
        obox(ST, x, yT + 1.2, z, 1.4, 2.4, 1.0, -ang + Math.PI / 2);
        ngon(ST, x, z, yT + 3.6, yT + 5.0, 0.95, 0.02, 4, -ang + Math.PI / 4, false);
        obox(DK, sx + Math.cos(ang) * (rr + 0.52), yT + 1.5, sz + Math.sin(ang) * (rr + 0.52), 0.7, 1.6, 0.04, -ang + Math.PI / 2);
      }
      ngon(ST, sx, sz, yT + (yA - yT) * 0.45, yT + (yA - yT) * 0.45 + 0.5, r0 * 0.58, r0 * 0.56, 8, Math.PI / 8, true, true);   // a band halfway up
      obox(GI, apex[0], yA - 0.2, apex[1], 0.22, 3.0, 0.22, 0);       // the cross
      obox(GI, apex[0], yA + 1.7, apex[1], 1.4, 0.22, 0.22, fr.rot);
    }
  }
  const all = [[AS, M.aisle, 'lm65:trinity:aisles'], [CL, M.clere, 'lm65:trinity:clerestory'], [PL, M.plain, 'lm65:trinity:walls'], [BF, M.belfry, 'lm65:trinity:belfry'],
    [SL, M.slate, 'lm65:trinity:roofs'], [ST, M.stone, 'lm65:trinity:stone'], [DK, M.dark, 'lm65:trinity:dark'], [BZ, M.bronze, 'lm65:trinity:doors'], [GI, M.gilt, 'lm65:trinity:cross']];
  addMeshes(g, all);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: 14, z: B.cz, w: B.x1 - B.x0, h: 28, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(all);
  return g;
}

/* ------------------------------------------------- towers from the city model */
// A tower drawn from its roof surfaces in the city's 3D building model with a facade family by height: the stone base, the
// shaft, the top (each a painted tile), copper or stone over the roof line, a stepped pyramid where the model has a smooth one.
//   look: { tiles: [[yMaxFraction, key], ...] (from the bottom; the fraction of the main roof's height), col, floor, shopH,
//     copperFrom (surfaces whose lowest corner is over it, and their walls, are copper), stepPyramid: { from, steps },
//     pier: {...}, coping, cornice }
function stepPyramid(acc, faces, n) {
  // the faces' lowest corners (the base ring, in order round the apex) and the apex
  let apex = null;
  for (const q of faces) for (const p of q.P) if (!apex || p[2] > apex[2]) apex = p;
  const base = [];
  for (const q of faces) for (const p of q.P) if (p[2] < apex[2] - 0.5 && !base.some((b) => Math.hypot(b[0] - p[0], b[1] - p[1]) < 0.3)) base.push(p);
  if (base.length < 3) return false;
  const y0 = Math.min(...base.map((p) => p[2])), ax = apex[0], az = apex[1];
  base.sort((a, b) => Math.atan2(a[1] - az, a[0] - ax) - Math.atan2(b[1] - az, b[0] - ax));
  const dh = (apex[2] - y0) / n;
  for (let k = 0; k < n; k++) {
    const t = k / n, t1 = (k + 1) / n, ya = y0 + k * dh, yb = ya + dh;
    const Rk = base.map((p) => [p[0] + (ax - p[0]) * t, p[1] + (az - p[1]) * t]), Rn = base.map((p) => [p[0] + (ax - p[0]) * t1, p[1] + (az - p[1]) * t1]);
    for (let i = 0; i < Rk.length; i++) {
      const a = Rk[i], b = Rk[(i + 1) % Rk.length], c = Rn[(i + 1) % Rn.length], d = Rn[i];
      const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
      let nx = ez / L, nz = -ex / L;
      if ((a[0] + b[0]) / 2 * nx + (a[1] + b[1]) / 2 * nz - (ax * nx + az * nz) < 0) { nx = -nx; nz = -nz; }
      acc.quad([a[0], ya, a[1]], [b[0], ya, b[1]], [b[0], yb, b[1]], [a[0], yb, a[1]], [nx, 0, nz]);   // the riser
      acc.quad([a[0], yb, a[1]], [b[0], yb, b[1]], [c[0], yb, c[1]], [d[0], yb, d[1]], [0, 1, 0]);        // the tread
    }
  }
  return true;
}
function buildTierTower(ctx, key, look, M) {
  const m = model(ctx, key);
  if (!m) return null;
  const { R } = m;
  const g = new THREE.Group();
  const acc = new Map();
  const A = (k) => { if (!acc.has(k)) acc.set(k, new Acc()); return acc.get(k); };
  const main = R.filter((q) => q.flat && q.A > 60).reduce((a, q) => (q.h1 > (a ? a.h1 : 0) ? q : a), null);
  const yTop = main ? main.h1 : Math.max(...R.map((q) => q.h1));
  const isCopper = (q) => look.copperFrom !== undefined && q.h0 >= look.copperFrom - 0.05;
  const pyr = look.stepPyramid ? R.filter((q) => !q.flat && q.h0 >= look.stepPyramid.from - 0.5) : [];
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.75 });
  const tileAt = (y) => { for (const [f, k] of look.tiles) if (y <= f * yTop + 0.01) return k; return look.tiles[look.tiles.length - 1][1]; };
  for (const w of runs) {
    if (w.L < 0.3) continue;
    const top = Math.min(w.ya, w.yb);
    if (pyr.includes(w.q)) continue;
    if (look.plainUnder && top < look.plainUnder) { runQuad(A('trim'), w, w.y0, top, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0, w.ya, w.yb); continue; }
    if (look.copperFrom !== undefined && w.y0 >= look.copperFrom - 0.05) { runQuad(A('copper'), w, w.y0, top, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0, w.ya, w.yb); continue; }
    // the run cut where the facade family changes
    const cuts = [w.y0];
    for (const [f] of look.tiles) { const y = f * yTop; if (y > w.y0 + 0.5 && y < top - 0.5) cuts.push(y); }
    cuts.push(top);
    const lay = layout(w.L, look.col, w.L < 6 ? 0.3 : (look.corner ?? 0.9));
    for (let i = 0; i + 1 < cuts.length; i++) {
      let ya = cuts[i];
      const yb = cuts[i + 1], k = tileAt((ya + yb) / 2), last = i + 2 === cuts.length;
      if (ya < 0.5 && look.shopH && yb > look.shopH + 1) { runQuad(A('shop'), w, 0, look.shopH, layout(w.L, look.col * 2, 0.6), M.tx.shop, look.shopH, 0); ya = look.shopH; }
      runQuad(A(k), w, ya, yb, lay, M.tx[k], look.floor, 0, last ? w.ya : yb, last ? w.yb : yb);
    }
    const hgt = top - w.y0;
    if (look.pier && hgt > 6 && w.L > 3) {
      const rot = runRot(w);
      for (let c = look.pier.every; c < lay.n; c += look.pier.every) {
        const [px, pz] = runPt(w, lay.s0 + c * lay.cw, look.pier.d / 2);
        obox(A('trim'), px, w.y0, pz, look.pier.w, hgt + 0.1, look.pier.d, rot);
      }
    }
    if (w.L > 0.8 && hgt > 1.2) sweepRun(A('trim'), w.a, w.b, w.n, top - 0.1, look.coping || PROF_40.coping, 0.12);
  }
  for (const q of R) {
    if (pyr.includes(q)) continue;
    if (isCopper(q) || (!q.flat && (look.slopedCopper || q.h0 > yTop * 0.5))) capSurface(A('copper'), q, 0.2);
    else capSurface(A(q.h1 > yTop - 2 && look.deckTrim ? 'trim' : 'roof'), q, 0.08, 0.01);
  }
  if (pyr.length) stepPyramid(A(look.stepPyramid.mat || 'trim'), pyr, look.stepPyramid.steps);
  if (look.extra) look.extra({ R, runs, A, yTop, M });
  const list = [];
  for (const [k, a] of acc) list.push([a, M[k] || M.trim, `lm65:${key}:${k}`]);
  addMeshes(g, list);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: yTop / 2, z: B.cz, w: B.x1 - B.x0, h: yTop, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount(list);
  return g;
}

/* ---------------------------------------------------------- Brookfield Place */
// Cesar Pelli, 1985-1988: four granite and glass towers over the Hudson, their stone thinning toward the top (punched windows
// in the base, then wider windows, then glass between thin stone mullions), the notched corners stepping back at the top,
// and each crowned in copper: One a chamfered top, Two a dome, Three a pyramid, Four a stepped pyramid.
const WFC = { STONE: [204, 168, 140], STONE2: [188, 152, 126], GLASS: [70, 92, 100], GLASS2: [110, 140, 146], FRAME: [120, 112, 100] };
let _WFC = null;
function wfcMats() {
  if (_WFC) return _WFC;
  const base = texd('wfc-base', 256, 512, bayPaint({ nx: 2, ny: 4, wall: WFC.STONE, spand: WFC.STONE2, glass: WFC.GLASS, glassSky: [120, 146, 156], frame: WFC.FRAME, ashlar: 18, rough: 0.6, win: [0.28, 0.72, 0.2, 0.68], tone: 0.03, blinds: 0.1 }), 231, 0.6, 2, 4);
  const mid = texd('wfc-mid', 256, 512, bayPaint({ nx: 2, ny: 4, wall: WFC.STONE, spand: WFC.STONE2, glass: WFC.GLASS, glassSky: [120, 146, 156], frame: WFC.FRAME, ashlar: 18, rough: 0.6, win: [0.18, 0.82, 0.14, 0.74], tone: 0.03, blinds: 0.1 }), 232, 0.6, 2, 4);
  const top = texd('wfc-top', 256, 512, bayPaint({ nx: 2, ny: 4, wall: WFC.STONE, spand: WFC.GLASS2, glass: WFC.GLASS, glassSky: [126, 150, 160], frame: WFC.STONE, rough: 0.5, win: [0.1, 0.9, 0.06, 0.8], tone: 0.02, blinds: 0.05, spandMetal: 0.3 }), 233, 0.5, 2, 4);
  const shop = texd('wfc-shop', 256, 256, shopPaint({ nx: 2, wall: WFC.STONE, ashlar: 24, base: [150, 120, 100], band: WFC.STONE2 }), 234, 0.6, 2, 1);
  const cop = tile3('wfc-copper', 256, 256, copperPaint([150, 192, 172], 18), 235, 0.6);
  _WFC = {
    tx: { base, mid, top, shop },
    base: tileMat3('wfc-base', base, { bump: 1.3 }), mid: tileMat3('wfc-mid', mid, { bump: 1.3 }), top: tileMat3('wfc-top', top, { bump: 1.0 }), shop: tileMat3('wfc-shop', shop, { bump: 1.2 }),
    copper: tileMat3('wfc-copper', cop, { bump: 1.0 }),
    trim: mat(0xcfae92, { rough: 0.6, flat: false, stone: { set: 'cgranite', amt: 0.25, nrm: 0.35, rgh: 0.2 } }),
    roof: roofMat(),
  };
  return _WFC;
}
const WFC_LOOK = {
  wfc1: { copperFrom: 155.1 }, wfc2: { copperFrom: 179.5 }, wfc3: { copperFrom: 197.1 }, wfc4: { copperFrom: 132.0 },
};
export function buildWFC(ctx, key) {
  const L = WFC_LOOK[key];
  if (!L) return null;
  return buildTierTower(ctx, key, { tiles: [[0.42, 'base'], [0.78, 'mid'], [1.01, 'top']], col: 1.55, floor: 4.0, shopH: 7.5, corner: 0.8, copperFrom: L.copperFrom,
    pier: { every: 2, w: 0.45, d: 0.2 }, slopedCopper: true }, wfcMats());
}

/* ----------------------------------------------------------- 14 Wall Street */
// Trowbridge and Livingston, 1912 (the Bankers Trust Company Building): a granite tower whose top is a colonnade of Ionic
// columns under a stepped pyramid of seven storeys, modelled on the Mausoleum at Halicarnassus.
let _W14 = null;
function w14Mats() {
  if (_W14) return _W14;
  const GR = [206, 202, 194];
  const shaft = texd('w14-shaft', 256, 512, bayPaint({ nx: 2, ny: 4, wall: GR, spand: [190, 186, 178], glass: [44, 52, 60], frame: [80, 80, 78], ashlar: 14, rough: 0.6, win: [0.22, 0.78, 0.14, 0.76], tone: 0.03 }), 241, 0.6, 2, 4);
  const shop = texd('w14-shop', 256, 256, shopPaint({ nx: 2, wall: GR, ashlar: 24, base: [150, 148, 142] }), 242, 0.6, 2, 1);
  _W14 = {
    tx: { shaft, shop },
    shaft: tileMat3('w14-shaft', shaft, { bump: 1.4 }), shop: tileMat3('w14-shop', shop, { bump: 1.2 }),
    trim: mat(0xd2cec4, { rough: 0.62, flat: false, stone: { set: 'cgranite', amt: 0.3, nrm: 0.4, rgh: 0.2, ashlar: 0.3 } }),
    copper: mat(0xb8b4aa, { rough: 0.7, flat: false }),
    roof: roofMat(),
    dark: mat(0x23282e, { rough: 0.4, flat: false }),
  };
  return _W14;
}
export function build14Wall(ctx) {
  const M = w14Mats();
  return buildTierTower(ctx, 'wall14', {
    tiles: [[1.01, 'shaft']], col: 1.75, floor: 3.9, shopH: 9.0, corner: 1.2,
    stepPyramid: { from: 137.5, steps: 24, mat: 'trim' },
    pier: { every: 2, w: 0.55, d: 0.3 },
    extra: ({ runs, A, yTop }) => {
      // the colonnade round the top stage, under the pyramid: Ionic columns standing in front of a dark loggia
      for (const w of runs) {
        const top = Math.min(w.ya, w.yb);
        if (Math.abs(top - yTop) > 1.5 || top - w.y0 < 12 || w.L < 6) continue;
        const yc0 = top - 13.5, rot = runRot(w);
        { const [x, z] = runPt(w, w.L / 2, 0.12); obox(A('dark'), x, yc0 + 1.0, z, w.L - 1.6, 11.0, 0.2, rot); }
        const n = Math.max(2, Math.round(w.L / 4.2));
        for (let k = 0; k <= n; k++) {
          const [x, z] = runPt(w, 0.8 + (w.L - 1.6) * k / n, 0.9);
          column(A('trim'), x, yc0, z, 0.62, 12.0, 'ionic', rot);
        }
        sweepRun(A('trim'), w.a, w.b, w.n, top - 1.2, PROF_40.cornice.map(([d, h]) => [d * 2.2, h * 1.4]), 1.0);
      }
    },
  }, M);
}

/* ------------------------------------------------- the Winter Garden at Brookfield Place */
// Cesar Pelli, 1988 (rebuilt 2002): the glass-vaulted hall between Two and Three World Financial Center, facing the North
// Cove. The compiled footprint (the hall, the galleria east of it and the 2013 entrance pavilion on West Street) had taken
// Two's 197 m height. Drawn here: the galleria's low stone and glass block on the whole footprint, the hall's glass walls
// and barrel vault over its river end (its axis toward the river, 36 m to the crown), the gabled glass end on the plaza, the
// pavilion's dark glass on West Street.
let _WG = null;
function wgMats() {
  if (_WG) return _WG;
  const glass = texd('wg-glass', 256, 256, (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, [128, 150, 162], 120, 0.1, 0.35);
    const g = ga.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(220,232,240,0.25)'); g.addColorStop(1, 'rgba(60,70,80,0.2)'); ga.fillStyle = g; ga.fillRect(0, 0, W, H);
    for (let i = 0; i <= 8; i++) fill3(ga, gb, go, (i * W) / 8 - 2, 0, 4, H, [228, 230, 230], 190, 0.4, 0.3);
    for (let j = 0; j <= 8; j++) fill3(ga, gb, go, 0, (j * H) / 8 - 1.5, W, 3, [228, 230, 230], 180, 0.4, 0.3);
  }, 251, 0.1, 1, 1);
  _WG = {
    tx: { glass },
    glass: tileMat3('wg-glass', glass, { bump: 0.5 }),
    stone: mat(0xcbb09a, { rough: 0.6, flat: false, stone: { set: 'cgranite', amt: 0.25, nrm: 0.35, rgh: 0.2 } }),
    roof: roofMat(),
    dark: mat(0x3a4650, { rough: 0.12, metal: 0.4, flat: false }),
    white: mat(0xe8e8e6, { rough: 0.45, metal: 0.1, flat: false }),
  };
  return _WG;
}
export function buildWinterGarden(ctx) {
  const ring = ctx.footprint;
  if (!ring || ring.length < 4) return null;
  const M = wgMats(), g = new THREE.Group();
  const GL = new Acc(), ST = new Acc(), RF = new Acc(), DK = new Acc(), WH = new Acc();
  // the frame: the ring's longest edge as the axis (along the hall), its outward normal
  let best = null;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (!best || L > best.L) best = { a, b, L }; }
  const ax = [(best.b[0] - best.a[0]) / best.L, (best.b[1] - best.a[1]) / best.L], cr = [-ax[1], ax[0]];
  let u0 = 1e9, u1 = -1e9, v0 = 1e9, v1 = -1e9, cx = 0, cz = 0;
  for (const [x, z] of ring) { cx += x / ring.length; cz += z / ring.length; }
  for (const [x, z] of ring) { const u = (x - cx) * ax[0] + (z - cz) * ax[1], v = (x - cx) * cr[0] + (z - cz) * cr[1]; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const P = (u, y, v) => [cx + ax[0] * u + cr[0] * v, y, cz + ax[1] * u + cr[1] * v];
  // the galleria: the whole ring 11 m, stone walls, a flat roof
  const runs = [];
  stepWalls([{ P: ring.map(([x, z]) => [x, z, 11]), H: [], h0: 11, h1: 11, A: 1, pl: { a: 0, b: 0, c: 11 }, flat: true, c: [cx, cz] }], (w) => runs.push(w), { step: 1 });
  for (const w of runs) runQuad(ST, w, 0, 11, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0);
  capSurface(RF, { P: ring.map(([x, z]) => [x, z, 11]), H: [] }, 0.08);
  // the hall: over the river end of the axis (the end farther from West Street: the more westerly one), 32 m across, 60 m
  // long, glass walls to 20 m, a barrel vault to 36 m
  const west = (ax[0] * 1 > 0) ? u0 : u1, dir = west === u0 ? 1 : -1;
  const ua = west + dir * 1.0, ub = west + dir * 61, vm = (v0 + v1) / 2, hw = Math.min(16, (v1 - v0) / 2 - 1), yS = 20, R = hw;
  const seg = 18;
  for (const [vv, nv] of [[vm - hw, -1], [vm + hw, 1]]) GL.quad(P(ua, 0, vv), P(ub, 0, vv), P(ub, yS, vv), P(ua, yS, vv), [cr[0] * nv, 0, cr[1] * nv], [0, 0], [6, 0], [6, 2], [0, 2]);
  for (let k = 0; k < seg; k++) {
    const t0 = Math.PI * k / seg, t1 = Math.PI * (k + 1) / seg;
    const a0 = [vm - R * Math.cos(t0), yS + R * Math.sin(t0)], a1 = [vm - R * Math.cos(t1), yS + R * Math.sin(t1)];
    const tm = (t0 + t1) / 2, n = [-Math.cos(tm), Math.sin(tm)];
    GL.quad(P(ua, a0[1], a0[0]), P(ub, a0[1], a0[0]), P(ub, a1[1], a1[0]), P(ua, a1[1], a1[0]), [cr[0] * n[0], n[1], cr[1] * n[0]], [0, k / 3], [6, k / 3], [6, (k + 1) / 3], [0, (k + 1) / 3]);
  }
  // the ends: the arched glass gables
  for (const [uu, s] of [[ua, -dir], [ub, dir]]) {
    const pts = [P(uu, 0, vm - hw)];
    for (let k = 0; k <= seg; k++) { const t = Math.PI * k / seg; pts.push(P(uu, yS + R * Math.sin(t), vm - R * Math.cos(t))); }
    pts.push(P(uu, 0, vm + hw));
    fan(GL, pts, [ax[0] * s, 0, ax[1] * s], (p) => [((p[0] - cx) * cr[0] + (p[2] - cz) * cr[1]) / 6, p[1] / 6]);
  }
  // the vault's ribs every 5 m, white steel
  for (let u = ua; dir > 0 ? u <= ub + 0.01 : u >= ub - 0.01; u += dir * 5) {
    for (let k = 0; k < seg; k++) {
      const t0 = Math.PI * k / seg, t1 = Math.PI * (k + 1) / seg;
      const p0 = P(u, yS + (R + 0.3) * Math.sin(t0), vm - (R + 0.3) * Math.cos(t0)), p1 = P(u, yS + (R + 0.3) * Math.sin(t1), vm - (R + 0.3) * Math.cos(t1));
      const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2, mz = (p0[2] + p1[2]) / 2, L = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const geo = new THREE.BoxGeometry(0.35, L + 0.05, 0.6);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3((p1[0] - p0[0]) / L, (p1[1] - p0[1]) / L, (p1[2] - p0[2]) / L));
      WH.addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(mx, my, mz), q, new THREE.Vector3(1, 1, 1))); geo.dispose();
    }
    for (const vv of [vm - hw - 0.2, vm + hw + 0.2]) { const [x, , z] = P(u, 0, vv); obox(WH, x, 0, z, 0.5, yS, 0.5, Math.atan2(-ax[1], ax[0])); }
  }
  // the pavilion on West Street: the other end, a dark glass block over the galleria to 17 m
  {
    const ue = dir > 0 ? u1 : u0, ue0 = ue - dir * 22;
    const q = [P(ue0, 0, vm - 13), P(ue, 0, vm - 13), P(ue, 0, vm + 13), P(ue0, 0, vm + 13)].map((p) => [p[0], p[2], 17]);
    const sq = { P: q, H: [], h0: 17, h1: 17, A: 1, pl: { a: 0, b: 0, c: 17 }, flat: true, c: [0, 0] };
    stepWalls([sq], (w) => runQuad(DK, w, 11, 17, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0), { step: 1, ground: true });
    capSurface(DK, sq, 0.1);
  }
  addMeshes(g, [[GL, M.glass, 'lm65:wintergarden:glass'], [ST, M.stone, 'lm65:wintergarden:galleria'], [RF, M.roof, 'lm65:wintergarden:roof'], [DK, M.dark, 'lm65:wintergarden:pavilion'], [WH, M.white, 'lm65:wintergarden:ribs']]);
  g.userData.colliderBoxes = [{ x: cx, y: 6, z: cz, w: u1 - u0, h: 12, d: v1 - v0, rotY: Math.atan2(-ax[1], ax[0]) }];
  g.userData.tris = triCount([[GL], [ST], [RF], [DK], [WH]]);
  return g;
}

/* ----------------------------------------------------- the Battery's ferry terminals */
// The Battery Maritime Building (Walker and Morris, 1909): the ferry house of the East River slips, its river front a screen of
// painted iron and stone: three tall arches over the slips between pilastered piers, a colonnade and cornice over them; the
// city's 3D building model gives its two roof levels. The Whitehall Terminal (rebuilt 2005): the Staten Island ferry's
// glass-walled house over its slips, the long low roof with the solar band along the harbour edge, the ramps on the land side.
let _BM = null;
function bmMats() {
  if (_BM) return _BM;
  const W = [178, 190, 182], T = [226, 228, 220];
  const wall = texd('bm-wall', 256, 512, bayPaint({ nx: 2, ny: 2, wall: W, spand: [160, 172, 164], glass: [52, 62, 66], frame: T, rough: 0.55, win: [0.2, 0.8, 0.18, 0.8], tone: 0.03 }), 261, 0.55, 2, 2);
  _BM = {
    tx: { wall },
    wall: tileMat3('bm-wall', wall, { bump: 1.3 }),
    trim: mat(0xe2e3db, { rough: 0.5, flat: false }),
    copper: mat(0xb8a294, { rough: 0.8, flat: false }),
    roof: mat(0xc2a294, { rough: 0.85, flat: false }),
    dark: mat(0x1e2426, { rough: 0.6, flat: false }),
    shop: tileMat3('bm-wall', wall, { bump: 1.3 }),
  };
  return _BM;
}
export function buildBatteryMaritime(ctx) {
  return buildTierTower(ctx, 'bmb', {
    tiles: [[1.01, 'wall']], col: 3.4, floor: 4.6, corner: 1.2, deckTrim: false,
    coping: [[0, 0], [0.5, 0.1], [0.5, 0.6], [0.8, 0.75], [0.8, 1.1], [0, 1.2]],
    pier: { every: 1, w: 0.7, d: 0.35 },
    extra: ({ runs, A }) => {
      // the river front: the street-level runs facing the slips (south-south-east), joined into one line at the outermost
      const fr = runs.filter((q) => q.y0 < 0.5 && q.L > 2 && q.n[0] * 0.29 + q.n[1] * 0.96 > 0.85);
      if (!fr.length) return;
      const n0 = fr.reduce((a, q) => (q.L > a.L ? q : a), fr[0]).n, t0 = [n0[1], -n0[0]];
      let s0 = 1e9, s1 = -1e9, dmax = -1e9, top = 1e9;
      for (const q of fr) for (const p of [q.a, q.b]) { const s = p[0] * t0[0] + p[1] * t0[1], d = p[0] * n0[0] + p[1] * n0[1]; s0 = Math.min(s0, s); s1 = Math.max(s1, s); dmax = Math.max(dmax, d); }
      for (const q of fr) top = Math.min(top, q.ya, q.yb);
      const a = [t0[0] * s0 + n0[0] * dmax, t0[1] * s0 + n0[1] * dmax], b = [t0[0] * s1 + n0[0] * dmax, t0[1] * s1 + n0[1] * dmax];
      const w = { a, b, n: n0, L: s1 - s0, ya: top, yb: top }, rot = runRot(w);
      const P = (s, y, d) => { const [x, z] = runPt(w, s, d); return [x, y, z]; };
      const n3 = [w.n[0], 0, w.n[1]];
      const na = 3, span = w.L * 0.86, ss = (w.L - span) / 2, aw = Math.min(17, span / na - 5.5);
      { const [x, , z] = P(w.L / 2, 0, 0.25); obox(A('wall'), x, 0, z, w.L, top, 0.5, rot); }                // the screen wall itself
      for (let k = 0; k < na; k++) {
        const sc = ss + span * (k + 0.5) / na;
        archShape(A('dark'), P, n3, aw / 2, 0, 7.4, 12.8, 0.56, sc);                                    // the slip's arch
        archShape(A('trim'), P, n3, aw / 2 + 1.0, 0, 7.6, 13.9, 0.53, sc);                              // its moulded frame
      }
      for (let k = 0; k <= na; k++) {                                                                    // the piers between, coupled columns
        const sp = ss + span * k / na;
        for (const dx of [-1.7, 1.7]) { const [x, , z] = P(sp + dx, 0, 1.25); column(A('trim'), x, 0, z, 0.6, top - 3.4, 'corinthian', rot); }
        { const [x, , z] = P(sp, 0, 0.8); obox(A('trim'), x, 0, z, 5.0, top - 2.6, 0.6, rot); }
      }
      sweepRun(A('trim'), w.a, w.b, w.n, top - 3.0, PROF_40.cornice.map(([d, h]) => [d * 2.4, h * 2.2]), 1.2);
    },
  }, bmMats());
}
let _WH = null;
function whMats() {
  if (_WH) return _WH;
  const glass = texd('wh-glass', 256, 256, (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, [118, 150, 158], 120, 0.1, 0.35);
    const g = ga.createLinearGradient(0, 0, 0, H); g.addColorStop(0, 'rgba(210,228,236,0.3)'); g.addColorStop(1, 'rgba(40,60,70,0.25)'); ga.fillStyle = g; ga.fillRect(0, 0, W, H);
    for (let i = 0; i <= 4; i++) fill3(ga, gb, go, (i * W) / 4 - 2, 0, 4, H, [224, 228, 228], 190, 0.4, 0.4);
    for (let j = 0; j <= 4; j++) fill3(ga, gb, go, 0, (j * H) / 4 - 2, W, 4, [224, 228, 228], 180, 0.4, 0.4);
    fill3(ga, gb, go, 0, H * 0.72, W, H * 0.06, [70, 150, 150], 130, 0.2, 0.3);                     // the teal band
  }, 262, 0.1, 1, 1);
  _WH = {
    tx: { glass },
    glass: tileMat3('wh-glass', glass, { bump: 0.6 }),
    trim: mat(0xc9c6be, { rough: 0.7, flat: false }),
    copper: mat(0x2c3a52, { rough: 0.3, metal: 0.5, flat: false }),   // (the solar band along the harbour edge)
    roof: mat(0xb8bab8, { rough: 0.8, flat: false }),
    dark: mat(0x1e2226, { rough: 0.6, flat: false }),
    deck: mat(0x9b9b96, { rough: 0.85, flat: false, stone: { set: 'cgranite', amt: 0.2, nrm: 0.3, rgh: 0.15 } }),
    shop: tileMat3('wh-glass', glass, { bump: 0.6 }),
  };
  return _WH;
}
export function buildWhitehall(ctx) {
  return buildTierTower(ctx, 'whitehall', {
    tiles: [[1.01, 'glass']], col: 6, floor: 6, corner: 0.5, copperFrom: 24.3, plainUnder: 7,
    coping: [[0, 0], [0.6, 0], [0.6, 0.5], [0, 0.6]],
    extra: ({ R, A }) => {
      // the ramps (the model's low surface): a concrete deck, the rest of the house as it is
      for (const q of R) if (q.h1 < 7 && q.A > 300) capSurface(A('deck'), q, 0.1, 0.03);
    },
  }, whMats());
}

/* ------------------------------------------------- St. Paul's Chapel, Broadway */
// Thomas McBean, 1766; the steeple James Crommelin Lawrence, 1794. Manhattan schist walls with brownstone quoins and
// trim, two tiers of windows (round-headed above), the slate roof; the tower at the churchyard's west end, brownstone to
// its balustrade, then the painted stages of the steeple: the octagonal drum, the belfry ringed with columns, the clock
// stage, the lantern and the spire. The portico of four Ionic columns and its pediment on Broadway. Massing from the
// city's 3D building model.
let _SP2 = null;
function sp2Mats() {
  if (_SP2) return _SP2;
  const SCH = [128, 116, 104], BRN = [146, 104, 84];
  const wall = texd('sp2-wall', 256, 512, (ga, gb, go, W, H, r) => {
    fill3(ga, gb, go, 0, 0, W, H, SCH, 150, 0.9, 0);
    for (let k = 0; k < 900; k++) {                      // the rubble: irregular stones of grey and brown schist
      const x = r() * W, y = r() * H, w = 6 + r() * 18, h = 4 + r() * 8, t = 0.8 + r() * 0.45;
      fill3(ga, gb, go, x, y, w, h, rgbs(r() < 0.6 ? SCH : [140, 118, 98], t), 130 + Math.round(r() * 40), 0.9, 0);
      ga.fillStyle = 'rgba(40,34,28,0.25)'; ga.fillRect(x, y + h - 1, w, 1);
    }
    const cw = W / 2;
    for (let i = 0; i < 2; i++) {
      const x0 = i * cw;
      // the upper window: tall, round-headed, in a brownstone surround; the lower: a square-headed one
      const ux0 = x0 + cw * 0.3, ux1 = x0 + cw * 0.7, uy0 = H * 0.06, uy1 = H * 0.46, ur = (ux1 - ux0) / 2;
      const up = (g) => { g.moveTo(ux0, uy1); g.lineTo(ux0, uy0 + ur); g.arc((ux0 + ux1) / 2, uy0 + ur, ur, Math.PI, 0); g.lineTo(ux1, uy1); g.closePath(); };
      ga.save(); ga.translate((ux0 + ux1) / 2, (uy0 + uy1) / 2); ga.scale(1.22, 1.08); ga.translate(-(ux0 + ux1) / 2, -(uy0 + uy1) / 2); path3(ga, gb, go, up, BRN, 175, 0.8, 0); ga.restore();
      path3(ga, gb, go, up, [36, 40, 46], 60, 0.15, 0.1);
      ga.strokeStyle = 'rgba(230,226,216,0.8)'; ga.lineWidth = 2;
      for (let q = 1; q < 3; q++) { ga.beginPath(); ga.moveTo(ux0 + (ux1 - ux0) * q / 3, uy0 + ur); ga.lineTo(ux0 + (ux1 - ux0) * q / 3, uy1); ga.stroke(); }
      for (let q = 1; q < 5; q++) { const y = uy0 + ur + (uy1 - uy0 - ur) * q / 5; ga.beginPath(); ga.moveTo(ux0, y); ga.lineTo(ux1, y); ga.stroke(); }
      const lx0 = x0 + cw * 0.32, lx1 = x0 + cw * 0.68, ly0 = H * 0.62, ly1 = H * 0.88;
      fill3(ga, gb, go, lx0 - 5, ly0 - 6, lx1 - lx0 + 10, ly1 - ly0 + 10, BRN, 175, 0.8, 0);
      fill3(ga, gb, go, lx0, ly0, lx1 - lx0, ly1 - ly0, [36, 40, 46], 60, 0.15, 0.1);
      for (let q = 1; q < 3; q++) { ga.beginPath(); ga.moveTo(lx0 + (lx1 - lx0) * q / 3, ly0); ga.lineTo(lx0 + (lx1 - lx0) * q / 3, ly1); ga.stroke(); }
      ga.beginPath(); ga.moveTo(lx0, (ly0 + ly1) / 2); ga.lineTo(lx1, (ly0 + ly1) / 2); ga.stroke();
      fill3(ga, gb, go, x0, 0, cw * 0.08, H, BRN, 165, 0.8, 0);                    // the quoins' strip at the bay edges
      for (let y = 0; y < H; y += 18) fill3(ga, gb, go, x0, y, cw * (y % 36 ? 0.08 : 0.14), 16, BRN, 175, 0.8, 0);
    }
    fill3(ga, gb, go, 0, H * 0.535, W, H * 0.025, BRN, 185, 0.8, 0);                  // the string course between the tiers
    streaks(ga, 0, 0, W, H, r, 20, 0.07);
  }, 271, 0.9, 1, 1);
  const tower = texd('sp2-tower', 256, 256, ashlarPaint(BRN, { course: 256 / 10, block: 256 / 3, rough: 0.8 }), 272, 0.8, 1, 1);
  const slate = tile3('sp2-slate', 256, 256, slatePaint, 273, 0.7);
  _SP2 = {
    tx: { wall, tower },
    wall: tileMat3('sp2-wall', wall, { bump: 1.6 }),
    tower: tileMat3('sp2-tower', tower, { bump: 1.4 }),
    slate: tileMat3('sp2-slate', slate, { bump: 1.2 }),
    brown: mat(0x8e6a58, { rough: 0.8, flat: false, stone: { set: 'cgranite', amt: 0.3, nrm: 0.4, rgh: 0.2 } }),
    paint: mat(0xd9d5ca, { rough: 0.55, flat: false }),
    dark: mat(0x1e2226, { rough: 0.6, flat: false }),
    gilt: mat(0xc8a24c, { rough: 0.3, metal: 0.85, flat: false }),
  };
  return _SP2;
}
export function buildStPaulsBroadway(ctx) {
  const m = model(ctx, 'stPaulsBroadway');
  if (!m) return null;
  const { R, SP } = m;
  const M = sp2Mats(), g = new THREE.Group();
  const WL = new Acc(), TW = new Acc(), SL = new Acc(), BR = new Acc(), PT = new Acc(), DK = new Acc(), GI = new Acc();
  const nave = R.filter((q) => q.h1 < 20.5);
  const steeple = R.filter((q) => q.h1 > 20.5);
  const tq = steeple.filter((q) => Math.abs(q.h1 - 30.14) < 0.2);
  // the tower's square: the outer ring of its 30 m stage (the union of the two halves' corners farthest from the octagon)
  let tcx = 0, tcz = 0, tn = 0;
  for (const q of steeple) for (const p of q.P) { tcx += p[0]; tcz += p[1]; tn++; }
  tcx /= tn; tcz /= tn;
  const runs = [];
  stepWalls(R, (w) => runs.push(w), { step: 0.6 });
  for (const w of runs) {
    const top = Math.min(w.ya, w.yb), mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    const inTower = Math.hypot(mid[0] - tcx, mid[1] - tcz) < 6.5;
    if (inTower && w.y0 > 29) { runQuad(PT, w, w.y0, top, { s0: 0, cw: 1 }, { nx: 1, ny: 1 }, 1, 0, w.ya, w.yb); continue; }   // the painted drums
    if (inTower) { runQuad(TW, w, w.y0, top, { s0: 0, cw: 6 }, M.tx.tower, 6, 0, w.ya, w.yb); continue; }
    runQuad(WL, w, w.y0, top, layout(w.L, 4.6, 0.6), M.tx.wall, top > 14 ? 12.55 : Math.max(4, top), 0, w.ya, w.yb);
    if (w.L > 1 && Math.abs(w.ya - w.yb) < 0.05) sweepRun(BR, w.a, w.b, w.n, top - 0.5, PROF_40.cornice.map(([d, h]) => [d * 0.9, h * 0.7]), 0.4);
  }
  for (const q of nave) capSurface(q.flat ? BR : SL, q, 0.2, 0.02);
  for (const q of steeple) capSurface(PT, q, 0.2, 0.01);
  // the tower's balustrade, the urns at its corners
  for (const q of tq) for (const p of q.P) {
    if (Math.hypot(p[0] - tcx, p[1] - tcz) < 4.2) continue;
    ngonLathe(PT, p[0], p[1], 30.14, [[0.32, 0], [0.32, 0.9], [0.18, 1.1], [0.3, 1.5], [0.05, 2.1]], 8);
  }
  // the belfry (34-39 m): a column at every corner of its octagon, the clock stage's round openings (39-47.6 m), the
  // lantern (47.6-51.5 m) and the spire with its ball and vane
  const oct = (y) => steeple.filter((q) => Math.abs(q.h1 - y) < 0.2).flatMap((q) => q.P).filter((p) => Math.hypot(p[0] - tcx, p[1] - tcz) > 0.5);
  const ringR = (y) => { const P = oct(y); return P.length ? P.reduce((a, p) => a + Math.hypot(p[0] - tcx, p[1] - tcz), 0) / P.length : 2.5; };
  const r34 = ringR(34.14), r39 = ringR(39.1), r47 = ringR(47.61);
  for (let k = 0; k < 8; k++) {
    const a = (k + 0.5) / 8 * Math.PI * 2;
    column(PT, tcx + Math.cos(a) * (r34 + 0.35), 34.14, tcz + Math.sin(a) * (r34 + 0.35), 0.24, 4.9, 'corinthian', a);
    obox(DK, tcx + Math.cos(a + Math.PI / 8) * (r34 - 0.4), 34.6, tcz + Math.sin(a + Math.PI / 8) * (r34 - 0.4), 1.0, 3.6, 0.05, -(a + Math.PI / 8) + Math.PI / 2);
    obox(DK, tcx + Math.cos(a + Math.PI / 8) * (r39 * 0.93), 41.0, tcz + Math.sin(a + Math.PI / 8) * (r39 * 0.93), 0.9, 1.6, 0.05, -(a + Math.PI / 8) + Math.PI / 2);
  }
  ngon(PT, tcx, tcz, 47.61, 51.53, r47 * 0.75, r47 * 0.7, 8, Math.PI / 8, true);
  for (let k = 0; k < 8; k++) { const a = (k + 0.5) / 8 * Math.PI * 2; obox(DK, tcx + Math.cos(a) * r47 * 0.73, 48.4, tcz + Math.sin(a) * r47 * 0.73, 0.5, 2.2, 0.05, -a + Math.PI / 2); }
  const sp = SP[0];
  if (sp) {
    const [x, z, y0, y1, r] = sp;
    ngonLathe(PT, x, z, y0, [[r, 0], [r * 0.6, (y1 - y0) * 0.45], [r * 0.28, (y1 - y0) * 0.86], [0.08, y1 - y0 - 1.2]], 8);
    ngonLathe(GI, x, z, y1 - 1.6, [[0.06, 0], [0.32, 0.25], [0.32, 0.55], [0.06, 0.8], [0.04, 2.2]], 8);
  }
  // the portico on Broadway: four Ionic columns two storeys high, the entablature, the pediment with its niche
  {
    const fr = frontOf(ctx.footprint, [0.84, 0.55]);
    const hw = Math.min(8.2, fr.L / 2 - 1.5), yc = 11.2, d0 = 5.2;
    stepsAt(BR, fr, -hw, hw, d0, 3, 0.18, 0.4);
    { const [x, , z] = fr.P(0, 0, d0 / 2); obox(BR, x, 0, z, 2 * hw + 0.6, 0.55, d0, fr.rot); }
    for (let k = 0; k < 4; k++) { const [x, , z] = fr.P(-hw + 0.7 + (2 * hw - 1.4) * k / 3, 0, d0 - 0.9); column(PT, x, 0.55, z, 0.55, yc - 0.55, 'ionic', fr.rot); }
    { const [x, , z] = fr.P(0, 0, (d0 - 0.2) / 2); obox(PT, x, yc, z, 2 * hw + 0.6, 1.3, d0 + 0.2, fr.rot); }
    pediment(PT, fr, -hw - 0.3, hw + 0.3, yc + 1.3, 4.2, d0 - 1.8, d0 + 0.2, d0 - 1.6);
    { const [x, , z] = fr.P(0, 0, 0.08); obox(DK, x, yc - 4.4, z, 2.0, 3.6, 0.1, fr.rot); }   // the niche (St. Paul stands in it)
    figureAt(BR, fr, 0, yc - 4.3, 0.25, 1.9, 'stand1');
  }
  addMeshes(g, [[WL, M.wall, 'lm65:stpauls:walls'], [TW, M.tower, 'lm65:stpauls:tower'], [SL, M.slate, 'lm65:stpauls:roof'], [BR, M.brown, 'lm65:stpauls:brownstone'],
    [PT, M.paint, 'lm65:stpauls:steeple'], [DK, M.dark, 'lm65:stpauls:dark'], [GI, M.gilt, 'lm65:stpauls:vane']]);
  const B = bounds(R);
  g.userData.colliderBoxes = [{ x: B.cx, y: 9, z: B.cz, w: B.x1 - B.x0, h: 18, d: B.z1 - B.z0, rotY: 0 }];
  g.userData.tris = triCount([[WL], [TW], [SL], [BR], [PT], [DK], [GI]]);
  return g;
}

/* ------------------------------------------------------------ the Battery */
// Castle Clinton (John McComb Jr., 1811): the round fort of red sandstone at the Battery's water edge, its wall 8 m high and
// 2.4 m thick pierced by a row of gun embrasures, the gateway on the park side, the paved court inside. Pier A (George Sears
// Greene Jr., 1886): the pier house on the Hudson, its head house of three storeys on the land end, the long shed of two over
// the pier, mansard roofs with dormers, the clock tower at the river end. Massing from the city's 3D building model.
let _CC = null;
function ccMats() {
  if (_CC) return _CC;
  const SAND = [150, 86, 70];
  const wall = texd('cc-wall', 256, 256, (ga, gb, go, W, H, r) => {
    ashlarPaint(SAND, { course: H / 14, block: W / 3.2, rough: 0.85 })(ga, gb, go, W, H, r);
    // an embrasure in the upper part of the wall: a splayed dark opening in a lighter frame
    const x0 = W * 0.38, x1 = W * 0.62, y0 = H * 0.2, y1 = H * 0.42;
    fill3(ga, gb, go, x0 - 6, y0 - 6, x1 - x0 + 12, y1 - y0 + 12, [168, 104, 86], 175, 0.8, 0);
    fill3(ga, gb, go, x0, y0, x1 - x0, y1 - y0, [30, 24, 22], 50, 0.9, 0);
    fill3(ga, gb, go, 0, H * 0.06, W, H * 0.04, [168, 104, 86], 185, 0.8, 0);       // the coping's course
    streaks(ga, 0, 0, W, H, r, 14, 0.08);
  }, 281, 0.85, 1, 1);
  _CC = {
    tx: { wall },
    wall: tileMat3('cc-wall', wall, { bump: 1.6 }),
    trim: mat(0x9a5a4a, { rough: 0.85, flat: false, stone: { set: 'cgranite', amt: 0.3, nrm: 0.45, rgh: 0.2 } }),
    roof: mat(0x847a72, { rough: 0.8, flat: false }),
    court: mat(0xd4c8b2, { rough: 0.9, flat: false }),
    dark: mat(0x1c1a1a, { rough: 0.8, flat: false }),
    copper: mat(0x9a5a4a, { rough: 0.85, flat: false }),
    shop: tileMat3('cc-wall', wall, { bump: 1.6 }),
  };
  return _CC;
}
export function buildCastleClinton(ctx) {
  const M = ccMats();
  return buildTierTower(ctx, 'castleClinton', {
    tiles: [[1.01, 'wall']], col: 4.6, floor: 6.6, corner: 0.2,
    coping: [[0, 0], [0.12, 0], [0.12, 0.25], [0, 0.3]],
    extra: ({ R, runs, A }) => {
      // the court inside the wall: the inner ring of the wall's surfaces, paved; the gateway on the park side
      let cx = 0, cz = 0, n = 0;
      for (const q of R) for (const p of q.P) { cx += p[0]; cz += p[1]; n++; }
      cx /= n; cz /= n;
      let rIn = 1e9;
      for (const q of R) for (const p of q.P) rIn = Math.min(rIn, Math.hypot(p[0] - cx, p[1] - cz));
      if (rIn > 4 && rIn < 40) ngon(A('court'), cx, cz, 0.02, 0.08, rIn + 0.3, rIn + 0.3, 40, 0, true);
      let best = null;
      for (const w of runs) {
        if (w.y0 > 0.5 || w.L < 1.5) continue;
        const m = [(w.a[0] + w.b[0]) / 2 - cx, (w.a[1] + w.b[1]) / 2 - cz], d = Math.hypot(...m);
        if (d < rIn + 1) continue;                                   // (an inner wall)
        const sc = (m[0] * 0.92 - m[1] * 0.38) / d;
        if (!best || sc > best.sc) best = { w, sc };
      }
      if (best) {
        const w = best.w, P = (s, y, d) => { const [x, z] = runPt(w, s, d); return [x, y, z]; };
        archShape(A('trim'), P, [w.n[0], 0, w.n[1]], 2.4, 0, 3.6, 5.8, 0.06, w.L / 2);
        archShape(A('dark'), P, [w.n[0], 0, w.n[1]], 1.7, 0, 3.4, 5.0, 0.09, w.L / 2);
      }
    },
  }, M);
}
let _PA = null;
function paMats() {
  if (_PA) return _PA;
  const WALL = [226, 220, 206];
  const wall = texd('pa-wall', 256, 256, bayPaint({ nx: 2, ny: 2, wall: WALL, spand: [210, 204, 190], glass: [44, 52, 58], frame: [90, 100, 96], brick: 0, rough: 0.7, win: [0.26, 0.74, 0.16, 0.72], tone: 0.03 }), 291, 0.7, 2, 2);
  const slate = tile3('pa-slate', 256, 256, slatePaint, 292, 0.7);
  _PA = {
    tx: { wall },
    wall: tileMat3('pa-wall', wall, { bump: 1.2 }),
    slate: tileMat3('pa-slate', slate, { bump: 1.2 }),
    trim: mat(0xe8e2d4, { rough: 0.6, flat: false }),
    roof: mat(0x5e6266, { rough: 0.75, flat: false }),
    dark: mat(0x23282c, { rough: 0.5, flat: false }),
    clock: mat(0xf0ece0, { rough: 0.5, flat: false }),
    copper: mat(0x5e6266, { rough: 0.75, flat: false }),
    shop: tileMat3('pa-wall', wall, { bump: 1.2 }),
  };
  return _PA;
}
export function buildPierA(ctx) {
  const M = paMats();
  return buildTierTower(ctx, 'pierA', {
    tiles: [[1.01, 'wall']], col: 3.2, floor: 4.2, corner: 0.6,
    coping: [[0, 0], [0.35, 0], [0.35, 0.45], [0, 0.55]],
    extra: ({ R, runs, A }) => {
      // the mansards: a steep slate slope round the top of every block, dormers in it; the clock tower's faces and spire
      for (const w of runs) {
        const top = Math.min(w.ya, w.yb);
        if (w.L < 2 || top - w.y0 < 3 || top > 20) continue;
        sweepRun(A('slate'), w.a, w.b, w.n, top + 0.3, [[0.25, 0], [-1.2, 2.6], [-1.4, 2.6]], 0.15);
        const nd = Math.floor((w.L - 2) / 4.2);
        for (let k = 0; k < nd; k++) {
          const s = (w.L - (nd - 1) * 4.2) / 2 + k * 4.2, [x, z] = runPt(w, s, -0.5);
          obox(A('trim'), x, top + 0.5, z, 1.3, 1.7, 1.2, runRot(w));
          const [x2, z2] = runPt(w, s, 0.12);
          obox(A('dark'), x2, top + 0.7, z2, 0.8, 1.1, 0.06, runRot(w));
          ngon(A('slate'), x, z, top + 2.2, top + 2.9, 0.95, 0.02, 4, runRot(w) + Math.PI / 4, false);
        }
      }
      const tw = R.find((q) => q.h1 > 20);
      if (tw) {
        const [cx, cz] = tw.c, half = Math.sqrt(tw.A) / 2;
        for (let k = 0; k < 4; k++) {
          const a = k * Math.PI / 2 + Math.atan2(tw.P[1][1] - tw.P[0][1], tw.P[1][0] - tw.P[0][0]);
          const nx = Math.cos(a + Math.PI / 2), nz = Math.sin(a + Math.PI / 2);
          const geo = new THREE.CylinderGeometry(1.1, 1.1, 0.12, 20);
          const q4 = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz));
          A('clock').addGeo(geo, new THREE.Matrix4().compose(new THREE.Vector3(cx + nx * (half + 0.05), tw.h1 - 1.8, cz + nz * (half + 0.05)), q4, new THREE.Vector3(1, 1, 1))); geo.dispose();
        }
        ngonLathe(A('slate'), cx, cz, tw.h1, [[half * 1.25, 0], [half * 0.9, 1.2], [0.35, 4.4], [0.05, 6.0]], 4, Math.atan2(tw.P[1][1] - tw.P[0][1], tw.P[1][0] - tw.P[0][0]) + Math.PI / 4);
      }
    },
  }, M);
}
