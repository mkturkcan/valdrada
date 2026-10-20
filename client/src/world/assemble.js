// Near-tile assembly: buildings extrusion with facade attributes, ground merge,
// furniture instancing, collider registration, landmark builds.
import * as THREE from 'three';
import earcut from 'earcut';
import { parseTile, buildingsOf, roadsOf, furnitureOf, holesOf } from './tiledata.js';   // CY12: holesOf
import { COLLIDERS } from '../city/colliders.js';
import { KIND_MAP, TREE_ARCH, SG13, SG13_ARM, TV25, treePoolFor } from '../city/furnitureKit.js';   // TC13: shared canopy envelope, SG13: signal geometry contract, TV25: species-form tree pools
import { FURN, STYLE, BF } from '../shared/geo.js';
import { LANDMARKS } from '../shared/landmarkSpec.js';
import { buildSignText } from '../city/signText.js';
import { buildRoof } from '../city/roofEngine.js';
import { buildDecals } from '../city/decals.js';
import { buildShopSigns } from '../city/shopSigns.js';
import { namedShopZone } from '../city/namedShops.js';
import { buildBillboards, buildTsqScreens } from '../city/billboards.js';
import { BP28, bpDropTree, bpTrees, bpOwns, bpBuild, bpWorld, bpApply, bpSkipBuilding } from '../city/bryantPark.js';
import { cpTileHit, cpApply, cpSkipBuilding, cpDropFurniture, cpFurniture, cpBuild, cpLift } from '../city/centralPark.js';
import { st38ClipTri, st38GapFill } from '../city/stations/subEnt38.js';   // ST38 (STATIONS2): the stair openings cut out of the drawn grid
import { gf38Load, gf38Apply, gf38Index } from '../city/groundFix38.js';   // GF38 (GROUNDFIX): the bare ground paved from the planimetric data
import { tileContentKey } from '../shared/overlay.js';   // OV39: the overlays' content key
import { lf39Load, lf39Apply } from './lotfix39.js';   // LF39 (LOTFIX): missing buildings, lot cars, NYCHA lawns and trees
import { areaTileHit, areaApply, areaSkipBuilding, areaDropFurniture, areaFurniture, areaBuild } from '../city/areas.js';
import { tpTileHit, tpApply, tpStepsOwner, tpBuildSteps, tpSkipBuilding, tpBuildFurniture, tpDropFrontage } from '../city/tsqPlaza.js';
import { placeCurbRamps } from '../city/streetNYC.js';
import { StaticPool } from './staticPool.js';
import { buildTower, buildSetbacks, TOWER_H } from './towers.js';
import { TW_BID } from '../city/tk/tkParams.js';   // TW: the tower kit's hide slot offset (world/towerKit.js)
import { ringOffsetMiter, upTri } from './ringOffset.js';   // NM24
import { disposeOwned, registerOwned } from './disposeOwned.js';   // SPACE r2: a tile's own materials and textures leave with it
import { LOWMEM, geometryMark, freeArraysAfterUpload, lateSweep } from './cpuFree.js';   // SPACE r2: ?lowmem=1, the light build's memory peak

// `?nodatum=1` — A/B switch for the 2026-09-03 seam pass (docs/notes/seams.md).
// It restores the legacy datums (building base as serialized, furniture as
// serialized, the AO skirt at terrain + 0.305) so a BEFORE plate can be shot in
// the same session and against the same tile set as the AFTER. The predecessor's
// BEFORE shots were taken against the stale pre-13:30 tiles, where the missing
// sidewalk bands hid which gaps were datum bugs and which were compiler bugs.
const NO_DATUM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nodatum') === '1';
// `?notower=1` — A/B switch for the 2026-09-04 skyscraper pass
// (docs/notes/skyscrapers.md). Restores the flat roof + 0.9 m parapet lip and
// the old 3-tier setback shrink, so a BEFORE plate and an fps reference can be
// shot in the SAME session as the AFTER. Machine load varies; an fps
// number compared across sessions is a number compared across CPU loads.
const NO_TOWER = typeof location !== 'undefined' && new URLSearchParams(location.search).get('notower') === '1';
// TL26: the drawn terrain grid stays under every ground section laid on it (see the ground block); ?tl26=0 restores the flat 0.12 m drop
const NO_TL26 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tl26') === '0';
// RL36 (compile.mjs rail pass): `?rl36=0` leaves the drawn terrain whole over the open cuts
const NO_RL36 = typeof location !== 'undefined' && new URLSearchParams(location.search).get('rl36') === '0';
// `?fac8=0` — A/B switch for the round-8 facade/roof pass (docs/notes/facades-r8.md):
// real parapets with a recessed deck and its own coping, the roof-membrane
// redistribution, and the masonry palette correction. Everything below guarded
// by FAC8 restores round-7 behaviour when it is off, so a BEFORE plate and an
// fps reference can be taken in the SAME session as the AFTER.
const FAC8 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fac8') === '0');
// `?roof9=0` — A/B switch for the round-9 roof-program + modern-retail pass
// (docs/notes/roofs-r9.md). Covers: the roof engine's size distribution, stain
// decals and block cell-site election (passed through as env.roof9), and every
// STYLE.RETAIL_MODERN special case in this file. Round 8's `?fac8=0` is
// untouched and still restores round-7 behaviour underneath this.
const ROOF9 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('roof9') === '0');
// `?e10=0` — A/B switch for the round-10 edge/contact pass (docs/notes/edges-r10.md).
// Geometry side: the roof deck's parapet RIM BAND (so the membrane shader has a real
// distance-to-parapet — the deck is earcut from the footprint ring and therefore has no
// interior vertices, so a per-vertex edge distance is identically zero without it) and
// the face-height datum (flags bit 64 + aux3.z) that lets the shader place a contact on
// a parapet's own foot instead of on the building's. Same flag as the materials.js half.
const E10 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('e10') === '0');
// flags bit 64: "aux3.z carries THIS prism's height in metres"; bit 128: "...and this is
// its roof-side face". materials.js reads both (the `faceH` / `faceIn` pair).
const FF_FACEH = 64, FF_FACEIN = 128;
const RIM_M = 1.25;            // width of the roof-deck rim band, metres (radial inset)
// CY12 (docs/notes/courtyards-r12.md) — ENCLOSED LIGHT COURTS. A pre-war New York
// apartment block is a DONUT: the footprint's inner rings are the courts the building is
// built around, and the compiler used to throw them away, so the SE block of 120th &
// Amsterdam extruded as one solid slab. The courts now ride in the tile's `bholes`
// section; here they become a hole in the roof deck, a wall looking into the court, a
// floor and a parapet. `?cy12=0` ignores the section and restores the solid block.
const CY12 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cy12') === '0');
// The bid court geometry is emitted under, so nycDress's per-building hide cannot take it
// away with the outer facade it replaces (see the sentinel-bid note at the emission site).
const CY_BID = 65535;   // CY12
// R12 (docs/notes/silhouette-r12.md) —  restores round-11 behaviour for the
// roofline silhouette / per-block dealer / roof-plant-vs-membrane pass. Three things
// live behind it in THIS file: the per-block DEALER (an ordinal along the block so
// consecutive neighbours cannot draw the same brick family, cornice depth, parapet
// height or roof template), the PARTY-WALL FIRE WALLS that step a row's roofline, and
// the membrane id reaching the roof engine so its plant can be valued AGAINST the
// membrane instead of at it.
const R12 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('r12') === '0');
// AR34 (TREES, 2026-10-01): the census species the compiled tiles lose. treeMode keeps nine classes, so the sophoras,
// zelkovas, ashes and elms (75,704 trees) are class 0 and draw a form picked by a position hash (BID3's c120 sophora drew
// a Norway maple). public/data/tree_species_extra.json (tools/pipeline/tree_species_extra.mjs) gives each its class 9-12
// until a tile recompile carries them; `?tsx=0` draws the hashed forms again.
const TSX = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tsx') === '0' ? Promise.resolve(null)
  : fetch('data/tree_species_extra.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
// the class of the overlay tree within 0.35 m of tile-local (x, z) (the list holds decimetres), 0 if none
function tsxAt(a, x, z) {
  const X = x * 10, Z = z * 10;
  let best = 0, bd = 12.25;
  for (let i = 0; i < a.length; i += 3) { const dx = a[i] - X, dz = a[i + 1] - Z, d = dx * dx + dz * dz; if (d < bd) { bd = d; best = a[i + 2]; } }
  return best;
}
// AR34 (TREES, lead 2026-10-01): street trees inside the 125th Street and Hunters Point boxes follow NYC Parks' current
// inventory (Forestry Tree Points, NYC Open Data hn5i-inap, fetched 2026-10-01; tools/pipeline/tree_forestry.mjs ->
// public/data/tree_forestry.json) instead of the 2015 census in the tiles. A compiled street tree (a census tree or the
// compiler's TI14 infill: both p2 & 1) takes the class and trunk of the live inventory tree it matches (the same point,
// then within 5 m), and is dropped when none is left (felled since 2015, or never there); a live inventory tree with no
// tree within 3 m is added where it stands at a sidewalk (the inventory also holds park trees, which the tiles draw from
// 'remove' | 'move' | 'set' | 'add', x, z (world m), to: [x, z], cls, dbh, pit: 'guard' | 'none' }] }; remove / move / set
// take the nearest street tree within 1.5 m). `?tfo=0` / `?tov=0` turn each off.
const QS34 = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const TFO = QS34 && QS34.get('tfo') === '0' ? Promise.resolve(null)
  : fetch('data/tree_forestry.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
const TOV = (QS34 && QS34.get('tov') === '0' ? Promise.resolve(null)
  : fetch('data/tree_overlay.json').then((r) => (r.ok ? r.json() : null)).catch(() => null)).then((j) => {
  if (!j || !Array.isArray(j.rows)) return null;
  const by = {};
  for (const r of j.rows) {
    if (!r || !Number.isFinite(+r.x) || !Number.isFinite(+r.z)) continue;
    (by[`${Math.floor(r.x / 512)}_${Math.floor(r.z / 512)}`] ||= []).push(r);
  }
  return by;
});
// the street-tree fixes of one tile: { drop: Set of record indices, edit: Map index -> { p0, p1, x, z, pit }, add: [records] }
function treeFixes(list, ox, oz, F, rows, boxes, onWalk) {
  const drop = new Set(), edit = new Map(), add = [];
  const inBox = (x, z) => boxes.some((b) => x >= b[0] && x <= b[2] && z >= b[1] && z <= b[3]);
  const street = [], every = [];
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (f.k !== FURN.TREE) continue;
    const x = f.x + ox, z = f.z + oz;
    every.push(x, z);
    if ((f.p2 & 1) && inBox(x, z)) street.push({ i, x, z, m: -1 });
  }
  if (F && F.length) {
    const n = F.length / 4, used = new Uint8Array(n);
    for (const r of [0.5, 5]) {
      const pairs = [];
      for (const s of street) {
        if (s.m >= 0) continue;
        for (let k = 0; k < n; k++) {
          if (used[k]) continue;
          const dx = F[k * 4] / 10 - s.x, dz = F[k * 4 + 1] / 10 - s.z, d = dx * dx + dz * dz;
          if (d <= r * r) pairs.push([d, s, k]);
        }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      for (const [, s, k] of pairs) { if (s.m < 0 && !used[k]) { s.m = k; used[k] = 1; } }
    }
    for (const s of street) {
      if (s.m < 0) drop.add(s.i);
      else edit.set(s.i, { p0: F[s.m * 4 + 2], p1: F[s.m * 4 + 3] });
    }
    for (let k = 0; k < n; k++) {
      if (used[k]) continue;
      const x = F[k * 4] / 10, z = F[k * 4 + 1] / 10;
      if (x < ox || x >= ox + 512 || z < oz || z >= oz + 512 || !inBox(x, z)) continue;   // the tile it stands in adds it
      let near = false;
      for (let j = 0; j < every.length && !near; j += 2) { const dx = every[j] - x, dz = every[j + 1] - z; near = dx * dx + dz * dz < 9; }
      if (near || !onWalk(x, z)) continue;
      add.push({ k: FURN.TREE, x: x - ox, z: z - oz, y: null, rot: ((x * 12.9898 + z * 78.233) % 6.2832 + 6.2832) % 6.2832, p0: F[k * 4 + 2], p1: F[k * 4 + 3], p2: 1, tfo: true });
    }
  }
  if (rows && rows.length) {
    // the street trees after the inventory step, for the rows to find: kept compiled ones and the additions
    const live = street.filter((s) => !drop.has(s.i)).map((s) => ({ s, x: s.x, z: s.z }));
    for (const a of add) live.push({ a, x: a.x + ox, z: a.z + oz });
    const nearest = (x, z) => { let b = null, bd = 2.25; for (const t of live) { const dx = t.x - x, dz = t.z - z, d = dx * dx + dz * dz; if (d < bd) { bd = d; b = t; } } return b; };
    for (const r of rows) {
      const x = +r.x, z = +r.z;
      if (r.op === 'add') {
        add.push({ k: FURN.TREE, x: x - ox, z: z - oz, y: null, rot: ((x * 12.9898 + z * 78.233) % 6.2832 + 6.2832) % 6.2832, p0: r.cls ?? 0, p1: r.dbh ?? 10, p2: 1, pit: r.pit, tov: true });
        continue;
      }
      const t = nearest(x, z);
      if (!t) continue;
      if (r.op === 'remove') {
        if (t.s) drop.add(t.s.i); else add.splice(add.indexOf(t.a), 1);
        live.splice(live.indexOf(t), 1);
        continue;
      }
      const e = t.s ? (edit.get(t.s.i) || {}) : t.a;
      if (r.op === 'move' && Array.isArray(r.to)) { if (t.s) { e.x = +r.to[0]; e.z = +r.to[1]; } else { t.a.x = +r.to[0] - ox; t.a.z = +r.to[1] - oz; } }
      if (r.cls !== undefined) e.p0 = r.cls;
      if (r.dbh !== undefined) e.p1 = r.dbh;
      if (r.pit !== undefined) e.pit = r.pit;
      if (t.s) edit.set(t.s.i, e);
    }
  }
  return { drop, edit, add };
}
// R12 DEAL CHANNELS. `b.__deal` is the building's ORDINAL along its block (the
// dealer pass in assembleTile). A channel turns that ordinal into a [0,1) value,
// and the point of the construction is what it GUARANTEES rather than what it
// randomises: the ordinal walks a 16-slot cycle with an ODD stride, which is a
// full-cycle LCG over a power-of-two modulus, so two buildings whose ordinals
// differ by 1 — i.e. next-door neighbours — land at least `stride/16` apart in
// every channel. A hash can only make that unlikely (uniformity-r10 §6).
// The sub-slot term is the building's own colorVar, so the value still varies
// inside its slot and two blocks never deal an identical sequence.
// Channels: 0 parapet height, 1 fire-wall rise, 2 brick family, 3 cornice depth,
//           4 window/sash profile, 5 roof template.
const R12_CH = [7, 5, 9, 11, 13, 3];
// WB13 (docs/notes/wburg-r13.md) — `?wb13=0` restores round-12 behaviour for the two
// new styles. In THIS file: the painted-cladding branch in fac8Palette (siding is not
// masonry and must not be neutralised to grey by the hue-family gate), the era and
// membrane entries for FRAME_HOUSE / CONDO_NEW, the frame house's SHALLOW parapet,
// and the low stoop. The tile DATA is compiled either way — with the flag off the two
// styles simply fall through the shader's and the engine's existing branches, which is
// exactly the round-12 look, so the A/B is a fair one.
const WB13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wb13') === '0');
// 10 x 0.170 m kit stoop x this = a 1.05 m landing, i.e. 6 risers of a real frame-house
// stoop. nycDress.js reads the SAME constant for its parlour-door height — the two must
// move together or the stairs climb to a wall (owner 2026-09-11, "stairs don't connect
// to the doors"). Keep in step.
export const WB13_STOOP_SY = 0.62;
// TC13 STREET CANOPY (docs/notes/canopy-r13.md, critic-r13 ranked fix 9).
// In THIS file: the per-instance tree size, which now reads the census TRUNK
// DIAMETER (`tree_dbh`, inches, serialized as FURN.TREE p1) and the species
// (p0) as an ALLOMETRY rather than as one uniform multiplier — height and crown
// SPREAD move on different curves, because a street tree grows outward long
// after it has stopped growing up. `?tc13=0` restores the r12 uniform scale.
const TC13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('tc13') === '0');
// FD14 (docs/notes/fd14.md) — ?fd14=0 restores round-13 behaviour. In THIS file: the
// street-tree size (critic-r14 fix 8, canopy a third of reference in the aerials and a
// TWELFTH at street level on Amsterdam), the MEDIAN cap — TC13's cap has never fired,
// because it keys on `roadOnly()` and the v19 compiler plants the Lenox median as a green
// strip, so `sectionY('grass')` is non-null and the test is false by construction — and
// the `fd14` flag handed to roofEngine for the vent-field density.
const FD14 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fd14') === '0');
// FP18 (?fp18=0 restores the flat-topped towers): a pre-war apartment tower's PENTHOUSE STOREY. From the air the Upper
// West Side's 12-16 storey blocks step back at the top: a terrace behind the street parapet, a penthouse storey set back
// 2.6-4.4 m with its own parapet, the lift and stair bulkhead and the tank on it. Ours ended in one flat deck at the
// cornice. Two thirds of the masonry towers of 45-90 m on a near-rectangular plan take one (towers.js buildSetbacks
// pentY); the street wall stops 0.45 m over a floor line, so its last row of windows and the penthouse's row both fit the
// facade grid (tkBuild.js draws the penthouse as the kit's last tier and the cornice on the street wall's).
const FP18 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fp18') === '0');
function fp18Pent(b, ring, y0) {
  if (!FP18 || !(b.style === STYLE.PREWAR_APT || b.style === STYLE.CIVIC_STONE || b.style === STYLE.DECO_MASONRY || b.style === STYLE.TENEMENT)) return null;
  if (b.height > 90 || ((b.colorVar * 29.7) % 1) > 0.65) return null;
  const o = ringOBB(ring);
  const step = 2.6 + ((b.colorVar * 41.3) % 1) * 1.8;
  if (o.h < 14 || o.w < 16 || (o.w - 2 * step) * (o.h - 2 * step) < 0.35 * o.w * o.h) return null;
  if (b.area / Math.max(1, o.w * o.h) < 0.6) return null;
  const fH = Math.max(2.5, b.floorH || 3.4), H = b.height;
  const yv = Math.floor((H - 3.6) / fH) * fH + 0.45;
  if (yv < H * 0.7) return null;
  return { y: y0 + yv, step };
}
// FP18: and the PENTHOUSE STOREY of a 25-45 m pre-war apartment block (the dresser's buildings): half of those on a
// near-rectangular plan with no light court carry one storey set back 2.4-4 m on the roof. The tile draws it under the
// unhideable bid (CY_BID), so it stands on the dresser's roof as on its own: walls on the shader's window grid counted from
// the roof, its roof and its own parapet and coping, and the rooftop engine's plant on it.
function fp18PentLow(b, ring, topY) {
  if (!FP18 || !(b.style === STYLE.PREWAR_APT || b.style === STYLE.CIVIC_STONE || b.style === STYLE.DECO_MASONRY)) return null;
  if (b.height < 25 || b.height > TOWER_H || b.area < 450 || ((b.colorVar * 29.7) % 1) > 0.5) return null;
  const o = ringOBB(ring);
  if (o.h < 15 || o.w < 17 || b.area / Math.max(1, o.w * o.h) < 0.6) return null;
  // the plan set back 2.4-4 m (a true offset, its every vertex inside the plan, a third to nine tenths of it); else a plain
  // box, the plan's oriented rectangle set back as far and up to 1.5 m more, its outline inside the plan (sampled each
  // metre, so it cannot cross a notch) and at least a quarter of it
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
    }
    return c;
  };
  const fH = Math.max(2.5, b.floorH || 3.2), top = topY + 0.88 * fH + 0.85;
  const step0 = 2.4 + ((b.colorVar * 41.3) % 1) * 1.6;
  const shoe = (r) => {   // signed area (shoelace)
    let a = 0;
    for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; }
    return a / 2;
  };
  for (const st of [step0, step0 * 0.8]) {
    const off = ringOffsetMiter(ring, st);
    if (!off || off.length < 3) continue;
    const aO = Math.abs(shoe(off)), aR = Math.abs(shoe(ring));
    if (aO >= aR * 0.3 && aO <= aR * 0.9 && off.every(([x, z]) => inside(x, z))) return { ring: off, top, areaF: aO / Math.max(1, b.area) };
  }
  const ca = Math.cos(o.ang), sa = Math.sin(o.ang), [mx, mz] = o.centerW;
  for (const st of [step0, step0 + 0.75, step0 + 1.5]) {
    const hw = o.w / 2 - st, hh = o.h / 2 - st;
    if (hw < 4 || hh < 3.5 || 4 * hw * hh < 0.25 * b.area) break;
    // corners counter-clockwise in (x, z) as the footprint rings run (shoelace-positive)
    const pr = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([u, v]) => [mx + u * ca - v * sa, mz + u * sa + v * ca]);
    let ok = true;
    for (let i = 0; ok && i < 4; i++) {
      const [ax, az] = pr[i], [bx, bz] = pr[(i + 1) % 4], L = Math.hypot(bx - ax, bz - az), m = Math.max(1, Math.ceil(L));
      for (let k = 0; ok && k < m; k++) ok = inside(ax + ((bx - ax) * k) / m, az + ((bz - az) * k) / m);
    }
    if (!ok) continue;
    return { ring: shoe(pr) > 0 ? pr : pr.reverse(), top, areaF: (4 * hw * hh) / Math.max(1, b.area) };
  }
  return null;
}
function fp18PentParapet(buf, ring, cx, cz, y, b, baseRef) {
  const ph = 0.9, inner = ringInsetAbs(ring, 0.25, cx, cz);
  extrudePrism(buf, ring, y, y + ph, b, { baseRef, noStore: true, blindMask: 0xffffffff, colScale: 0.83, faceH: ph });
  extrudePrism(buf, inner.slice().reverse(), y, y + ph, b, { baseRef, noStore: true, blindMask: 0xffffffff, colScale: 0.66, faceH: ph, faceIn: true });
  const cop = ringInsetAbs(ring, -0.045, cx, cz);
  copingSkin(buf, cop, y + ph - 0.02, y + ph + 0.07, b, 4);
  copingBand(buf, cop, inner, y + ph + 0.07, b, 4);
}
export function r12Deal(b, ch) {
  const d = b.__deal;
  if (!(d >= 0)) return -1;
  const a = R12_CH[ch % R12_CH.length];
  const slot = (d * a) & 15;
  return (slot + ((b.colorVar * 61.7 + ch * 7.3) % 1)) / 16;
}

const LM_BY_ID = new Map(LANDMARKS.map((l) => [l.id, l]));
const AWNING_COLORS = [0x8a2f2a, 0x27502f, 0x1f3f66, 0x6b6154, 0x7a2f55, 0x3a3f45];
const HYDRANT_COLORS = [0x1a1d20, 0x2e5c34, 0xb0b4b8, 0x8a2222];
// stoop tints multiply the kit's measured brownstone: warm/cool and value jitter so a
// row of eleven stoops is not eleven identical brown blocks
const STOOP_TINTS = [0xffffff, 0xf3e7dc, 0xdccbbd, 0xe9d3c3, 0xd0c2b6, 0xf8f0ea];

// grows typed arrays for one merged building geometry
class GeoBuf {
  constructor() { this.pos = []; this.nrm = []; this.col = []; this.uv = []; this.aux = []; this.aux2 = []; this.aux3 = []; this.bid = []; this.curBid = 0; }
  quad(a, b, c, d, n, col, uvs, aux, aux2, aux3 = [0, 0, 0]) {
    // a,b,c,d: [x,y,z] ccw from outside; uvs: [ua,va, ub,vb, uc,vc, ud,vd] (u is WALL-LOCAL)
    const idx = [0, 1, 2, 0, 2, 3];
    const P = [a, b, c, d];
    const U = [[uvs[0], uvs[1]], [uvs[2], uvs[3]], [uvs[4], uvs[5]], [uvs[6], uvs[7]]];
    for (const i of idx) {
      this.pos.push(P[i][0], P[i][1], P[i][2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(col[0] * col[0], col[1] * col[1], col[2] * col[2]); // sRGB→linear approx
      this.uv.push(U[i][0], U[i][1]);
      this.aux.push(aux[0], aux[1], aux[2], aux[3]);
      this.aux2.push(aux2[0], aux2[1], aux2[2], aux2[3]);
      this.aux3.push(aux3[0], aux3[1], aux3[2] ?? 0);
      this.bid.push(this.curBid);
    }
  }
  // uvs (optional): [ua,va, ub,vb, uc,vc]. The roof deck uses u as the E10 RIM CODE —
  // 0 means "no rim data" (every legacy call site), otherwise 1 + metres from the
  // parapet line. Passing it here costs nothing: tri() already pushed a (0,0) uv.
  // RF13 (owner 2026-09-16: "avoid non-aligned textures on the rooftops"): roof triangles carry the
  // building's ROOF FRAME in aux3 = [angle, originX, originZ] — the longest parapet edge and its first
  // vertex — so the membrane shader lays seams, blotches and drains along the building, not along world X/Z.
  tri(a, b, c, n, col, aux, aux2, uvs = null, aux3 = null) {
    const P3 = [a, b, c];
    for (let i = 0; i < 3; i++) {
      const P = P3[i];
      this.pos.push(P[0], P[1], P[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.col.push(col[0] * col[0], col[1] * col[1], col[2] * col[2]);
      this.uv.push(uvs ? uvs[i * 2] : 0, uvs ? uvs[i * 2 + 1] : 0);
      this.aux.push(aux[0], aux[1], aux[2], aux[3]);
      this.aux2.push(aux2[0], aux2[1], aux2[2], aux2[3]);
      this.aux3.push(aux3 ? aux3[0] : 0, aux3 ? aux3[1] : 0, aux3 ? aux3[2] : 0);
      this.bid.push(this.curBid);
    }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aux', new THREE.Float32BufferAttribute(this.aux, 4));
    g.setAttribute('aux2', new THREE.Float32BufferAttribute(this.aux2, 4));
    g.setAttribute('aux3', new THREE.Float32BufferAttribute(this.aux3, 3));
    // building index within the tile: the facade shader's per-building hide mask
    g.setAttribute('aBid', new THREE.Float32BufferAttribute(this.bid, 1));
    return g;
  }
}

// One entrance per building, on the compiler-scored street-facing wall (fallback:
// longest non-blind wall). Returns {doorI, doorPack}; doorPack = (bay+1)*8 + color*2
// is carried in aux3.z so the facade shader and heroFacades place the SAME door.
function pickDoor(b, ring) {
  let doorI = b.frontIdx ?? -1;
  if (doorI < 0 || doorI >= b.len || (doorI < 32 && ((b.blind >> doorI) & 1))) {
    doorI = -1; let bestL = 3.6; // narrow rowhouse fronts (4-5m) still get their door
    for (let i = 0; i < b.len; i++) {
      if (i < 32 && ((b.blind >> i) & 1)) continue;
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % b.len];
      const l = Math.hypot(x2 - x1, z2 - z1);
      if (l > bestL) { bestL = l; doorI = i; }
    }
  }
  if (doorI < 0) return { doorI: -1, doorPack: 0 };
  const [x1, z1] = ring[doorI], [x2, z2] = ring[(doorI + 1) % b.len];
  const len = Math.hypot(x2 - x1, z2 - z1);
  const bayN = Math.floor((len - 0.44) / Math.max(0.8, b.winW));
  if (bayN < 1 || len <= 3.6) return { doorI: -1, doorPack: 0 };
  const fract = (v) => v - Math.floor(v);
  const h = fract(Math.sin((b.colorVar * 511 + doorI * 7.3) * 12.9898) * 43758.5453);
  const bay = Math.min(bayN - 1, Math.floor(h * bayN));
  const colIdx = Math.floor(fract(h * 91.7) * 4);
  return { doorI, doorPack: (bay + 1) * 8 + colIdx * 2 };
}

// ?zfix=0 turns the 2026-09-04/05 z-fight work in THIS file off for A/B
// measurement (docs/notes/zfight.md, tools/zfight.mjs --flags zfix=0). What is
// left here is the AO skirt's polygon offset; the ground-layer separation moved
// into makeGroundMaterial's per-matId depth bias. Default ON.
const ZFIX = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('zfix') === '0');

let _aoSkirtMat = null;
function aoSkirtMat() {
  if (!_aoSkirtMat) {
    _aoSkirtMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
      // factor 0, not -2: on ground at grazing incidence the per-pixel depth
      // slope is enormous and factor scales with it, which threw the ribbon
      // metres in front of the pavement near the horizon. Two parallel planes
      // need only the quantisation term, and 8 LSB of it is decisive at every
      // range (the skirt is 2 mm over flags that are stable only to 28 m at eye
      // level — docs/notes/zfight.md B1).
      polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: ZFIX ? -8 : -2,
      vertexShader: 'attribute float aA; varying float vA; void main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.015, 0.015, 0.025, vA); }',
    });
  }
  return _aoSkirtMat;
}
function ringInset(pts, f, cx, cz) {
  return pts.map(([x, z]) => [cx + (x - cx) * f, cz + (z - cz) * f]);
}
// inset by an ABSOLUTE distance (m) toward the centroid: a parapet is 0.25-0.35 m
// thick whatever the building's size, and the proportional `ringInset(0.985)` gave a
// 40 m loft a 0.3 m parapet and a 6 m rowhouse a 4 cm one. Degenerate rings (a vertex
// closer to the centroid than 2d) fall back to the proportional form.
function ringInsetAbs(pts, d, cx, cz) {
  // NM24 (owner 2026-09-24: "building faces sometimes get lost or disappear"): a TRUE offset first. The radial form below
  // moves every vertex toward the centroid, which on a concave footprint (half of Harlem's pre-war stock: 20-100
  // vertices with light-well notches) folds edges back on themselves. Every parapet inner skin, coping and roof rim band
  // built on a folded edge then faced down or inward and was culled: 17,400 triangles over 1,928 buildings in the
  // harlem125 ring were invisible from above, which reads as bites out of rooflines and holes at roof edges.
  // `?nm24=0` keeps the radial inset everywhere.
  // a footprint too tight for the full offset (short notch edges, necks) takes a thinner one before the radial fallback
  if (NM24O) for (const k of [1, 0.6, 0.35]) { const o = ringOffsetMiter(pts, d * k); if (o) return o; }
  let minR = 1e9;
  for (const [x, z] of pts) minR = Math.min(minR, Math.hypot(x - cx, z - cz));
  if (minR < d * 2.2) return ringInset(pts, Math.max(0.5, 1 - d / Math.max(0.5, minR)), cx, cz);
  return pts.map(([x, z]) => { const r = Math.hypot(x - cx, z - cz); const f = 1 - d / r; return [cx + (x - cx) * f, cz + (z - cz) * f]; });
}
const NM24O = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('nm24') === '0');
// ringOffsetMiter and upTri live in ./ringOffset.js (shared with towers.js)
// ---------------------------------------------------------------------------
// FAC8 PALETTE CORRECTION (docs/notes/facades-r8.md §2)
// Measured over the whole lenoxRef frame against `ref_lenox.png`: our building
// field runs at mean saturation 26 % where the reference runs at 14 %, and the
// reference carries NO blue or pink masonry at all — Harlem, and FiDi, and the
// Times Square blocks are brown / grey / white / tan with a few dark-red brick
// accents. classify.mjs hands out `paintedGray` (#9aa0a2), `glassBlue`
// (#7c98ac) and `brickOrange` (#b06a48) freely, and after the shader's own
// value curve those land as sky blue and salmon.
// Rules, in HSL on the record's sRGB bytes:
//   * masonry hues are 8-46 deg. Outside that band a wall is PAINT, and painted
//     masonry in New York is grey, cream or a dark colour — never a pastel — so
//     out-of-family hues collapse to near-neutral.
//   * in-family saturation is capped at 0.20 and scaled 0.78: brick keeps its
//     hue and stops shouting.
//   * lightness above 0.56 is pulled down (chalky terracotta / white brick is
//     the biggest single contributor to the "milky city" of critic rounds 2-5).
// Glass styles (3, 11) are NOT touched: the facade shader already replaces
// their diffuse with a real curtain-wall family (materials.js `famAlb`).
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function fac8Palette(b) {
  const r = b.r / 255, g = b.g / 255, bl = b.b / 255;
  const mx = Math.max(r, g, bl), mn = Math.min(r, g, bl), d = mx - mn;
  let h = 0;
  if (d > 1e-6) {
    h = mx === r ? ((g - bl) / d + (g < bl ? 6 : 0)) : mx === g ? ((bl - r) / d + 2) : ((r - g) / d + 4);
    h *= 60;
  }
  let l = (mx + mn) / 2;
  let s = d > 1e-6 ? d / (1 - Math.abs(2 * l - 1)) : 0;
  // GLASS. The facade shader DOES replace a curtain wall's pastel diffuse with
  // a real glass family (`famAlb`) — but only where `cwF = smoothstep(18, 30,
  // bldgH) > 0.01` and only on non-blind walls. Every glass-classified building
  // UNDER 18 m, and every blind wall of every glass tower, keeps
  // `#7c98ac` at 0.5-0.7 diffuse: those are the sky-blue boxes all over the
  // lenoxTop plate. Give them the glass VALUE here — hue kept (blue-green is
  // right for glass), saturation cut, value more than halved. On a tall tower
  // this is a no-op: the shader rescales the wall relative to its own mean, so
  // `pat` is unchanged and 94 % of the pixel is `famAlb` regardless.
  if (b.style === STYLE.MODERN_GLASS || b.style === STYLE.GLASS_TOWER_BLUE) {
    s = Math.min(s, 0.16);
    l *= 0.55;
    hsl2rgb(b, h, s, l);
    return;
  }
  // WB13: PAINTED CLADDING IS NOT MASONRY. Everything below this point is a
  // masonry correction — the 8-46 deg hue family, the "pinks read as brick"
  // fallback, the saturation cap tuned on ref_lenox's fired brick. Vinyl siding
  // and a fibre-cement rainscreen are PIGMENTED PLASTIC: pale blue, sage and
  // colonial blue are real product colours, and the masonry gate would send all
  // three to the same 5 %-saturation cool grey — i.e. it would delete the one
  // thing that makes a Greenpoint block read as a Greenpoint block. They keep
  // their hue and take only the VALUE ladder (which is what puts the dresser and
  // the shader on the same exposure), with a 0.22 saturation cap so nothing in
  // the palette can shout.
  if (WB13 && (b.style === STYLE.FRAME_HOUSE || b.style === STYLE.CONDO_NEW)) {
    s = Math.min(s, 0.22);
    l *= 0.94;
    if (l > 0.52) l = 0.52 + (l - 0.52) * 0.60;
    hsl2rgb(b, h, s, l);
    return;
  }
  const inFamily = h >= 8 && h <= 46;
  if (!inFamily) {
    // a cool or magenta wall: keep a whisper of the tint so the block does not
    // go monochrome, and pull the hue to the one neutral New York actually
    // paints masonry — a cool grey. (A green cast is never right: the first
    // version sent `paintedGray` H195 to H96 and turned every grey building
    // olive.) Pinks and magentas read as brick.
    s = Math.min(s, 0.05);
    h = (h > 46 && h < 330) ? 214 : 18;
  } else {
    // Saturation cap by VALUE, not a flat number. Measured on `ref_lenox.png`:
    // masonry there runs S 8-14 % overall, but that average is dominated by
    // light stone and roofs — the dark red-brick faces keep their chroma while
    // the pale terracotta and limestone are almost neutral. That is also how
    // real pigmented masonry behaves, and how the eye decides something is
    // "brick": dark AND warm. A flat cap turned #8f4e3c into a grey mauve.
    s = Math.min(s, 0.30 - 0.22 * clamp01((l - 0.30) / 0.45));
  }
  l *= 0.94;
  if (l > 0.52) l = 0.52 + (l - 0.52) * 0.60;         // chalky whites come down
  hsl2rgb(b, h, s, l);
}
function hsl2rgb(b, h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = h / 60, x = c * (1 - Math.abs((hp % 2) - 1));
  let rr = 0, gg = 0, bb = 0;
  if (hp < 1) { rr = c; gg = x; } else if (hp < 2) { rr = x; gg = c; } else if (hp < 3) { gg = c; bb = x; }
  else if (hp < 4) { gg = x; bb = c; } else if (hp < 5) { rr = x; bb = c; } else { rr = c; bb = x; }
  const m = l - c / 2;
  b.r = Math.max(0, Math.min(255, Math.round((rr + m) * 255)));
  b.g = Math.max(0, Math.min(255, Math.round((gg + m) * 255)));
  b.b = Math.max(0, Math.min(255, Math.round((bb + m) * 255)));
}
// ---------------------------------------------------------------------------
// FAC8 ERA ESTIMATE. The brief says PLUTO class and year are "on the record as
// b.cls" — they are NOT: tiledata.js parses a 44-byte building record with no
// class and no year (see docs/notes/facades-r8.md §4). style, floorH and floors
// are the era signal that survives the compile, and they are a good one:
// classify.mjs derives style FROM year and class, and pre-war floor-to-floor is
// 3.1-3.7 m against post-war 2.7-2.9 m.
function fac8Year(b) {
  const fh = b.floorH || 3.1;
  switch (b.style) {
    case STYLE.TENEMENT: return 1901;
    case STYLE.ROWHOUSE: return 1888;
    case STYLE.LOFT_CASTIRON: return 1897;
    case STYLE.PREWAR_APT: return fh > 3.3 ? 1912 : 1928;
    case STYLE.DECO_MASONRY: return 1931;
    case STYLE.CIVIC_STONE: return 1914;
    case STYLE.CHURCH: return 1890;
    case STYLE.INDUSTRIAL: return 1922;
    case STYLE.PROJECT_BRICK: return 1957;
    case STYLE.POSTWAR_BRICK: return fh < 2.85 ? 1968 : 1954;
    case STYLE.RETAIL_STRIP: return 1972;
    // ROOF9: RETAIL_MODERN only exists for >= 1995 construction (classify.mjs),
    // and the era feeds the roof program — chimneys, condenser census, tanks.
    // The generic fallback below would have called a 2017 retail box 1966 on
    // its 5 m retail floor-to-floor and given it a pre-war plumbing roof.
    case STYLE.RETAIL_MODERN: return 2015;
    // WB13: the era drives the ROOF PROGRAM — chimneys (env.year < 1946), the
    // condenser census and the tank. A frame house is 1880-1930 stock: it gets
    // its party-wall flue. A new condo is not: no chimney, no wooden tank, and
    // the newbuild membrane mix.
    case STYLE.FRAME_HOUSE: return 1905;
    case STYLE.CONDO_NEW: return 2012;
    case STYLE.GLASS_TOWER_BLUE: return 2006;
    default: return fh > 3.2 ? 1966 : 1984;
  }
}
// ---------------------------------------------------------------------------
// FAC8 MEMBRANE REDISTRIBUTION (docs/notes/facades-r8.md §3)
// compile.mjs gives 55 % of the residential stock a silver coating, and the
// shader renders that at 0.50-0.585 albedo — the brightest surface in any
// aerial frame, brighter than the sky's own ground reflection. Counted off
// `ref_lenox.png`, a Harlem block is roughly 40 % white/silver coat, 26 % grey
// EPDM or weathered coat, 22 % gravel ballast and 12 % black tar, and the
// three dark families are what give the reference its (58 .. 227) luminance
// range against our (73 .. 216). Re-rolled at RUNTIME off colorVar, so it needs
// no recompile and no new tile bit. Bias by class: offices and lofts keep more
// grey/ballast, pre-war walk-ups keep more coating (they are recoated often).
//
// Returns the shader's membrane id directly (aux.z), NOT the compiler's 2-bit
// field: 1 silver coat, 2 black tar, 3 gravel ballast, 4 pavers, and **0 = the
// shader's own legacy hash pick**, which is the only route to its grey-EPDM
// family (materials.js `kindR >= 0.85`) — the compiler's 2-bit field can never
// address it. Keeping a fifth of every block on 0 is therefore not laziness: it
// is the only way to get grey EPDM into the mix without a shader edit.
const FAC8_MEMB = {
  // [silver, hash-mix, gravel, tar, pavers] cumulative
  walkup: [0.36, 0.58, 0.78, 0.92, 1.0],
  office: [0.16, 0.38, 0.62, 0.74, 1.0],
  heavy: [0.14, 0.36, 0.66, 0.92, 1.0],
  // ROOF9: new construction is WHITE. A post-1995 big box is single-ply TPO or
  // a fresh coating, which is exactly the bright membrane round 8 spent its
  // effort removing from the pre-war stock — and that is the point: the range
  // in a block comes from old roofs being dark, not from new ones being grey.
  newbuild: [0.62, 0.78, 0.88, 0.94, 1.0],
  // WB13: the frame belt, counted off the Bedford Ave reference. Williamsburg's
  // roofs are visibly PALER than Harlem's in the matched pair — a 6 x 14 m deck over a
  // two-family house is one afternoon and one bucket of aluminium coating, so it gets
  // recoated on a cycle a 20 x 40 m pre-war block never sees, and the reference shows
  // roughly half the belt white or silver against `walkup`'s 36 %. It is still not
  // `newbuild`: these are old roofs, so the dark tail (gravel, tar) stays fat and the
  // grey-EPDM hash slot is kept — round 8's whole finding was that the RANGE in a block
  // comes from old roofs being dark, and a block of 25 identical white rectangles is the
  // uniformity defect however well it matches the average.
  frame: [0.46, 0.64, 0.84, 0.94, 1.0],
};
const FAC8_MEMB_ID = [1, 0, 3, 2, 4];
function fac8Membrane(b) {
  const mh = (b.colorVar * 31.7) % 1;
  const s = b.style;
  // WB13: a post-2000 condo roof is new single-ply or a fresh coat (newbuild);
  // a frame house's roof is the most recoated surface in the city — a 5 m x 12 m
  // deck gets a bucket of silver every few years — so it stays on `walkup`,
  // which is already coating-heavy, and needs no entry of its own.
  const cut = (WB13 && s === STYLE.FRAME_HOUSE) ? FAC8_MEMB.frame
    : ((ROOF9 && s === STYLE.RETAIL_MODERN) || (WB13 && s === STYLE.CONDO_NEW)) ? FAC8_MEMB.newbuild
    : (s === STYLE.MODERN_GLASS || s === STYLE.GLASS_TOWER_BLUE || s === STYLE.CIVIC_STONE || s === STYLE.DECO_MASONRY) ? FAC8_MEMB.office
    : (s === STYLE.INDUSTRIAL || s === STYLE.LOFT_CASTIRON) ? FAC8_MEMB.heavy : FAC8_MEMB.walkup;
  for (let i = 0; i < 5; i++) if (mh < cut[i]) return FAC8_MEMB_ID[i];
  return 1;
}
// hip roof over the footprint's OBB: 4 slope quads to a ridge segment (never self-intersects)
function hipRoof(buf, ring, topY, b, col, cx, cz, scale = 0.92, riseK = 0.3, memb = 0) {   // CH14b: riseK 0.3 copper / 0.5 slate; CR24: memb 6 = slate courses
  const obb = ringOBB(ring);
  const w = obb.w * scale, d = obb.h * scale;
  const cA = Math.cos(obb.ang), sA = Math.sin(obb.ang);
  const ox = cx + obb.center[0] - cx, oz = cz + obb.center[1] - cz; // obb center offset already includes centroid
  const rot = (lx, lz) => [obb.centerW[0] + lx * cA - lz * sA, obb.centerW[1] + lx * sA + lz * cA];
  const hw = w / 2, hd = d / 2;
  const rise = Math.min(riseK > 0.35 ? 9 : 6, Math.max(1.8, Math.min(w, d) * riseK));
  const ridgeHalf = Math.max(0.1, hw - hd);
  const ridgeY = topY + rise;
  const C1 = rot(-ridgeHalf, 0), C2 = rot(ridgeHalf, 0);
  const A1 = rot(-hw, -hd), A2 = rot(hw, -hd), B1 = rot(-hw, hd), B2 = rot(hw, hd);
  const aux = [b.floorH, b.winW, memb, b.style];
  const aux2 = [b.height, b.lit, b.colorVar, 4];
  // side slopes and hip ends. CR24: these were listed clockwise seen from outside (each face's own cross product pointed
  // INTO the roof), so the FrontSide facade material culled every one of them from outside and the deck beneath showed
  // through: Columbia's copper roofs, Teachers College's slate and every generic church roof were missing. Now outward.
  buf.quad([A1[0], topY, A1[1]], [C1[0], ridgeY, C1[1]], [C2[0], ridgeY, C2[1]], [A2[0], topY, A2[1]], [sA, 0.75, -cA], col, [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2);
  buf.quad([B2[0], topY, B2[1]], [C2[0], ridgeY, C2[1]], [C1[0], ridgeY, C1[1]], [B1[0], topY, B1[1]], [-sA, 0.75, cA], col, [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2);
  buf.tri([A1[0], topY, A1[1]], [B1[0], topY, B1[1]], [C1[0], ridgeY, C1[1]], [-cA, 0.6, -sA], col, aux, aux2);
  buf.tri([A2[0], topY, A2[1]], [C2[0], ridgeY, C2[1]], [B2[0], topY, B2[1]], [cA, 0.6, sA], col, aux, aux2);
}
// CH14 — CAMPUS HIP WINGS (critic r14, Amsterdam pair; docs/notes/round14-fixes.md). classify.mjs hands every
// COLUMBIA_CAMPUS hall roofKind 2, but the hip above only fires when the ring FILLS its OBB (rectness > 0.78), so
// the L/U/E-plan McKim halls that ARE the campus — Schermerhorn (23-vertex ring, 1680 m2), Fayerweather, Avery,
// Havemeyer — fell through to a flat white membrane, which is the "white slab with a bump" the critic read against
// the reference oblique's green copper hips. A McKim hall is a set of
// rectangular wings, each under its own hip: rasterise the footprint in its OBB frame (1.5 m cells), peel off
// maximal all-inside rectangles greedily (histogram + stack per row), hip each one. Valleys where wings meet are
// approximate — the hips interpenetrate — which from the 150 m reference pose reads as the roof; the deck under them
// stays the ordinary membrane. ?ch14=0 restores the flat deck. Returns the number of wings roofed.
const CH14 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ch14') === '0');
// CH14b: compiler roofKind shape 3 = a STEEP SLATE hip (Teachers College's Collegiate Gothic halls, classify.mjs
// TEACHERS_COLLEGE, pre-1930) — the same wing decomposition as the copper campus hip, darker and at riseK 0.5.
const SLATE_HIP = [0.16, 0.17, 0.19], COPPER_HIP = [0.17, 0.24, 0.21];
const hipLook = (b) => b.roofKind === 3 ? { col: SLATE_HIP, riseK: 0.5, memb: CR24 ? 6 : 0 } : { col: COPPER_HIP, riseK: 0.3, memb: 0 };
function campusHipWings(buf, ring, topY, b, col, cx, cz, riseK = 0.3) {
  const obb = ringOBB(ring);
  const cA = Math.cos(obb.ang), sA = Math.sin(obb.ang);
  const [ox, oz] = obb.centerW;
  const toL = ([x, z]) => [(x - ox) * cA + (z - oz) * sA, -(x - ox) * sA + (z - oz) * cA];
  const toW = (lx, lz) => [ox + lx * cA - lz * sA, oz + lx * sA + lz * cA];
  const L = ring.map(toL);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const [lx, lz] of L) { mnx = Math.min(mnx, lx); mxx = Math.max(mxx, lx); mnz = Math.min(mnz, lz); mxz = Math.max(mxz, lz); }
  const CELL = 1.5;
  const nx = Math.max(1, Math.ceil((mxx - mnx) / CELL)), nz = Math.max(1, Math.ceil((mxz - mnz) / CELL));
  if (nx * nz > 6400) return 0;   // a 120 x 120 m footprint is not a McKim hall
  const inside = (px, pz) => { let ins = false; for (let i = 0, j = L.length - 1; i < L.length; j = i++) { const [xi, zi] = L[i], [xj, zj] = L[j]; if (((zi > pz) !== (zj > pz)) && (px < (xj - xi) * (pz - zi) / (zj - zi) + xi)) ins = !ins; } return ins; };
  const mask = new Uint8Array(nx * nz);
  let total = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (inside(mnx + (i + 0.5) * CELL, mnz + (j + 0.5) * CELL)) { mask[j * nx + i] = 1; total++; }
  const MIN = Math.ceil(5 / CELL);   // a wing is at least 5 m each way
  const hgt = new Int32Array(nx);
  let left = total, wings = 0;
  for (let guard = 0; left > total * 0.06 && guard < 24; guard++) {
    let best = null;
    hgt.fill(0);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) hgt[i] = mask[j * nx + i] ? hgt[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= nx; i++) {
        const h = i < nx ? hgt[i] : 0;
        let start = i;
        while (st.length && st[st.length - 1][1] > h) {
          const [s0, hh] = st.pop();
          const area = hh * (i - s0);
          if (hh >= MIN && (i - s0) >= MIN && (!best || area > best.area)) best = { area, i0: s0, i1: i - 1, j0: j - hh + 1, j1: j };
          start = s0;
        }
        st.push([start, h]);
      }
    }
    if (!best) break;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) if (mask[j * nx + i]) { mask[j * nx + i] = 0; left--; }
    const lx0 = mnx + best.i0 * CELL, lx1 = mnx + (best.i1 + 1) * CELL, lz0 = mnz + best.j0 * CELL, lz1 = mnz + (best.j1 + 1) * CELL;
    hipRoof(buf, [toW(lx0, lz0), toW(lx1, lz0), toW(lx1, lz1), toW(lx0, lz1)], topY, b, col, cx, cz, 1.0, riseK, hipLook(b).memb);
    wings++;
  }
  if (wings && typeof console !== 'undefined') console.log(`[ch14] ${wings} wing hip(s) on building ${b.i} at ${Math.round(cx)},${Math.round(cz)} (area ${Math.round(b.area)}, h ${b.height.toFixed(1)}, kind ${b.roofKind})`);   // CH14 verification (plate logs)
  return wings;
}
// ---------------------------------------------------------------------------
// CR24 — COLUMBIA CAMPUS ROOFS (owner 2026-09-24: "Columbia buildings' roofs are missing"). Two faults, in this order:
//   1. hipRoof() wound every slope and hip end INWARD (each quad's own cross product points into the roof). The facade
//      material culls back faces, so from outside the hip did not draw and the flat deck under it did: the copper roofs
//      were literally missing, and so was every generic church roof and every Teachers College slate hip.
//   2. Where a hip did draw (seen from inside), it was a low pyramid in a near-black green under the membrane's sky
//      sheen. The reference views (top, north, east and west) show light verdigris copper
//      behind a limestone balustrade on the cornice: a steep MANSARD holding the attic storey, with a row of dormers
//      and a flat top on the deep halls (Hartley, Wallach, John Jay, Furnald, Hamilton, Kent, Journalism, Havemeyer,
//      Schermerhorn, Pupin, Dodge, CEPSR), a plain hip to a ridge on the narrow ones (Philosophy, Avery, Fayerweather,
//      Lewisohn, Mathematics), brick chimneys on the dormitories, Earl Hall's pale dome and Pupin's two observatory domes.
// The roof takes the building's top storey: the walls stop at the eave and the roof rises to the record's height, so
// the silhouette keeps its measured height. Per-building facts come from BUILDING_OVERRIDES `roof` (landmarkSpec.js,
// applied at tile read); any other campus record (compiler roofKind 2) takes the defaults. ?cr24=0 restores round 14.
const CR24 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cr24') === '0');
// patina bases (sRGB-ish, GeoBuf squares them), set against the reference captures: sunlit verdigris reads about (100, 165, 145)
const CR_TONE = { mint: [0.30, 0.52, 0.44], pale: [0.43, 0.50, 0.46], lead: [0.50, 0.55, 0.58], obs: [0.70, 0.71, 0.70], slate: [0.25, 0.26, 0.28] };
const CR_STONE = [214, 205, 186], CR_GLASS = [0.10, 0.11, 0.12], CR_FRAME = [0.87, 0.86, 0.82], CR_BRICK = [0.56, 0.31, 0.23];
const CR_MEMB = 7;        // materials.js roof branch 7: verdigris copper (vertex colour = patina base, uv = seam coords)
const CR_E = 0.55;        // the copper foot stands this far inside the wall face (balustrade 0.35 + gutter)
const CR_PH = 0.95;       // balustrade over the cornice
const CR_DEG = Math.PI / 180;
// Newell normal: sum of P_i x P_i+1, i.e. it points to the side the polygon is counter-clockwise from (three's front)
function crNewell(P) {
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < P.length; i++) {
    const a = P[i], c = P[(i + 1) % P.length];
    nx += (a[1] - c[1]) * (a[2] + c[2]);
    ny += (a[2] - c[2]) * (a[0] + c[0]);
    nz += (a[0] - c[0]) * (a[1] + c[1]);
  }
  return [nx, ny, nz];
}
// a 3- or 4-gon wound so that its front face looks along `out`, whatever order the caller listed it in
function crPoly(buf, P, out, col, aux, aux2, aux3, uv) {
  const N = crNewell(P);
  if (N[0] * out[0] + N[1] * out[1] + N[2] * out[2] < 0) { P = P.slice().reverse(); if (uv) uv = uv.slice().reverse(); N[0] = -N[0]; N[1] = -N[1]; N[2] = -N[2]; }
  const L = Math.hypot(N[0], N[1], N[2]);
  if (L < 1e-8) return;
  const n = [N[0] / L, N[1] / L, N[2] / L];
  const u = uv ? uv.flat() : null;
  if (P.length === 4) buf.quad(P[0], P[1], P[2], P[3], n, col, u || [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2, aux3);
  else buf.tri(P[0], P[1], P[2], n, col, aux, aux2, u, aux3);
}
// inward miter offset of a shoelace-positive (x, z) ring; null when it folds over itself
function crOffset(ring, d) {
  const n = ring.length, out = [];
  for (let i = 0; i < n; i++) {
    const p0 = ring[(i - 1 + n) % n], p1 = ring[i], p2 = ring[(i + 1) % n];
    let ax = p1[0] - p0[0], az = p1[1] - p0[1];
    const la = Math.hypot(ax, az) || 1; ax /= la; az /= la;
    let bx = p2[0] - p1[0], bz = p2[1] - p1[1];
    const lb = Math.hypot(bx, bz) || 1; bx /= lb; bz /= lb;
    const nax = -az, naz = ax, nbx = -bz, nbz = bx;           // inward normals
    let mx = nax + nbx, mz = naz + nbz;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { out.push([p1[0] + nax * d, p1[1] + naz * d]); continue; }
    mx /= ml; mz /= ml;
    const k = d / Math.max(0.3, mx * nax + mz * naz);
    out.push([p1[0] + mx * k, p1[1] + mz * k]);
  }
  for (let i = 0; i < n; i++) {                               // every edge keeps its direction and some length
    const a = ring[i], b2 = ring[(i + 1) % n], c = out[i], e = out[(i + 1) % n];
    const ox = b2[0] - a[0], oz = b2[1] - a[1], nx = e[0] - c[0], nz = e[1] - c[1];
    if (ox * nx + oz * nz <= 0) return null;
  }
  let A = 0;
  for (let i = 0; i < n; i++) { const [x0, z0] = out[i], [x1, z1] = out[(i + 1) % n]; A += x0 * z1 - x1 * z0; }
  if (A <= 0) return null;
  for (const p of out) if (!crInside(ring, p[0], p[1])) return null;
  return out;
}
function crInside(ring, x, z) {
  let ins = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
// the per-building plan: form, eave height and slope run. Returns null when the campus path does not apply.
function crPlan(b, ring, holes, topY) {
  if (!CR24 || holes.length) return null;
  const spec = b.campusRoof || (b.roofKind === 2 ? {} : null);
  if (!spec || spec.form === 'flat' || b.area < 150 || b.height < 8) return null;
  const obb = ringOBB(ring);
  const depth = Math.min(obb.w, obb.h);
  const form = spec.form || (depth > 17 ? 'mansard' : 'hip');
  let rise, run = 0;
  if (form === 'dome') rise = Math.min(Math.max(b.height * 0.42, 9), 17);
  else if (form === 'hip') {
    run = Math.max(1, depth / 2 - CR_E);
    rise = Math.min(Math.max(run * Math.tan((spec.pitch || 38) * CR_DEG), 2.4), 6.5);
  } else {
    // the attic storey: a full floor and a bit, which is what puts the dormers' heads near the ridge line in the photos
    rise = Math.min(Math.max((b.floorH || 3.4) * 1.2, 3.9), 5.4);
    run = rise / Math.tan((spec.pitch || 70) * CR_DEG);
  }
  rise = Math.min(rise, b.height * 0.45);
  return { spec, form, obb, rise, run, eaveY: topY - rise, topY };
}
// the roof itself, over walls the caller has already extruded to plan.eaveY
function crBuild(buf, ring, b, P, cx, cz, y0) {
  const { spec, form, obb } = P;
  const eaveY = P.eaveY, topY = P.topY;
  const jit = 0.96 + ((b.colorVar * 13.1) % 1) * 0.08;
  const tone = (CR_TONE[spec.tone] || CR_TONE.mint).map((v) => v * jit);
  const auxC = [b.floorH, b.winW, CR_MEMB, b.style], aux2R = [b.height, b.lit, b.colorVar, 4];
  const auxB = [b.floorH, b.winW, 0, b.style], aux2B = [b.height, b.lit, b.colorVar, 2];     // blind masonry (chimneys, dormer glass)
  const rf = roofFrame(ring);
  // ---- the limestone balustrade on the cornice: outer skin flush with the wall, inner skin, a pale coping
  const stone = { ...b, r: CR_STONE[0], g: CR_STONE[1], b: CR_STONE[2] };
  const inner = ringInsetAbs(ring, 0.35, cx, cz);
  extrudePrism(buf, ring, eaveY, eaveY + CR_PH, stone, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.83, faceH: CR_PH });
  extrudePrism(buf, inner.slice().reverse(), eaveY, eaveY + CR_PH, stone, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.66, faceH: CR_PH, faceIn: true });
  copingBand(buf, ringInsetAbs(ring, -0.04, cx, cz), inner, eaveY + CR_PH + 0.06, stone, 4);
  // the gutter deck the copper stands on (dark, mostly hidden)
  roofFill(buf, ring, eaveY + 0.03, b, false, form === 'dome' ? 1 : 2);
  const yF = eaveY + 0.05;
  if (form === 'dome') { crDomeRoof(buf, b, P, tone, auxC, aux2R, cx, cz); return; }
  let foot = crOffset(ring, CR_E), top = null;
  let mode = form;
  if (form === 'mansard' && foot) top = crOffset(ring, CR_E + P.run);
  if (!foot || (form === 'mansard' && !top)) mode = 'wings';
  if (mode === 'mansard') {
    crSlopes(buf, foot, top, yF, topY, tone, auxC, aux2R, rf);
    // the flat top: the same copper, a shade paler and flatter-locked
    const deck = tone.map((v, i) => v * 0.93 + [0.05, 0.03, 0.04][i]);
    crDeck(buf, top, topY, deck, auxC, aux2R, rf);
    if (spec.dormers !== 0) crDormers(buf, foot, yF, P, b, tone, auxC, aux2R, auxB, aux2B, spec.dormers ?? 1);
    if (spec.chimneys) crChimneys(buf, top, topY, obb, b, spec.chimneys, auxB, aux2B, auxC, aux2R);
    if (spec.domes) crObservatories(buf, top, topY, obb, spec.domes, auxC, aux2R, auxB, aux2B);
    return;
  }
  if (mode === 'hip' && foot && ring.length <= 6 && b.area / Math.max(1, obb.w * obb.h) > 0.9) {
    crHipRect(buf, obb, yF, P, tone, auxC, aux2R, rf, b, spec, auxB, aux2B);
    return;
  }
  // concave or narrow: a hipped body over each rectangular wing (the CH14 decomposition), bodies interpenetrate
  const wings = crWingRects(ring);
  for (const w of wings) crWingBody(buf, w, yF, P, tone, auxC, aux2R, form);
}
// slope quads between two offset rings; uv = (metres along the eave from the face's own start, metres above the foot)
function crSlopes(buf, foot, top, yA, yB, col, aux, aux2, rf) {
  const n = foot.length;
  for (let i = 0; i < n; i++) {
    const a = foot[i], b2 = foot[(i + 1) % n], c = top[(i + 1) % n], d = top[i];
    const ex = b2[0] - a[0], ez = b2[1] - a[1], L = Math.hypot(ex, ez);
    if (L < 0.05) continue;
    const ux = ex / L, uz = ez / L;
    const along = (p) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uz;
    crPoly(buf, [[a[0], yA, a[1]], [b2[0], yA, b2[1]], [c[0], yB, c[1]], [d[0], yB, d[1]]], [uz, 0.55, -ux], col, aux, aux2,
      [Math.atan2(ez, ex), a[0], a[1]], [[0, 0], [L, 0], [along(c), yB - yA], [along(d), yB - yA]]);
  }
}
function crDeck(buf, ring, y, col, aux, aux2, rf) {
  const flat = [];
  for (const [x, z] of ring) flat.push(x, z);
  const tris = earcut(flat);
  const c = Math.cos(rf[0]), s = Math.sin(rf[0]);
  const U = (p) => (p[0] - rf[1]) * c + (p[1] - rf[2]) * s;
  for (let t = 0; t < tris.length; t += 3) {
    const A = ring[tris[t]], B2 = ring[tris[t + 1]], C = ring[tris[t + 2]];
    crPoly(buf, [[A[0], y, A[1]], [B2[0], y, B2[1]], [C[0], y, C[1]]], [0, 1, 0], col, aux, aux2, rf, [[U(A), 6], [U(B2), 6], [U(C), 6]]);
  }
}
// dormers along every edge long enough for them: copper cheeks and cap, a white frame and dark glass facing out
function crDormers(buf, foot, yF, P, b, col, auxC, aux2R, auxB, aux2B, dens) {
  const tanP = P.rise / Math.max(0.3, P.run);
  const dw = 1.5, dh = Math.min(2.35, P.rise * 0.56), zb = 0.35;      // width, face height, sill above the foot
  const spacing = Math.max(3.2, Math.min(5.4, (b.winW || 2.6) * 1.65)) / Math.max(0.35, dens);
  const n = foot.length;
  for (let i = 0; i < n; i++) {
    const a = foot[i], b2 = foot[(i + 1) % n];
    const ex = b2[0] - a[0], ez = b2[1] - a[1], L = Math.hypot(ex, ez);
    const margin = P.run + 1.4;
    const cnt = Math.floor((L - 2 * margin) / spacing) + 1;
    if (L < 6 || cnt < 1) continue;
    const ux = ex / L, uz = ez / L, ix = -uz, iz = ux;                // along, inward
    const s0 = (L - (cnt - 1) * spacing) / 2;
    for (let k = 0; k < cnt; k++) {
      const s = s0 + k * spacing;
      const y1 = yF + zb, y2 = y1 + dh, yC = y2 + 0.28;
      const d0 = zb / tanP + 0.12, dBack = (yC - yF) / tanP + 0.25;       // front plane, back (buried in the slope)
      const W = (sAlong, dIn, y) => [a[0] + ux * sAlong + ix * dIn, y, a[1] + uz * sAlong + iz * dIn];
      const sl = s - dw / 2, sr = s + dw / 2;
      const out = [-ix, 0, -iz];
      // cheeks and front in copper, the cap sloping back into the roof
      crPoly(buf, [W(sl, d0, y1), W(sr, d0, y1), W(sr, d0, yC), W(sl, d0, yC)], out, col, auxC, aux2R, [Math.atan2(ez, ex), a[0], a[1]], [[0, 0], [dw, 0], [dw, yC - y1], [0, yC - y1]]);
      crPoly(buf, [W(sl, d0, y1), W(sl, dBack, y1), W(sl, dBack, yC), W(sl, d0, yC)], [-ux, 0, -uz], col, auxC, aux2R, [0, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      crPoly(buf, [W(sr, d0, y1), W(sr, dBack, y1), W(sr, dBack, yC), W(sr, d0, yC)], [ux, 0, uz], col, auxC, aux2R, [0, 0, 0], [[0, 0], [1, 0], [1, 1], [0, 1]]);
      crPoly(buf, [W(sl - 0.08, d0 - 0.10, yC), W(sr + 0.08, d0 - 0.10, yC), W(sr + 0.08, dBack, yC + 0.30), W(sl - 0.08, dBack, yC + 0.30)], [0, 1, 0], col, auxC, aux2R, [Math.atan2(ez, ex), a[0], a[1]], [[0, 1], [dw, 1], [dw, 1.3], [0, 1.3]]);
      // the sash: a pale frame, dark glass 2 cm in front of it (overlap, never abut)
      const fw = dw - 0.36, fh = dh - 0.30;
      crPoly(buf, [W(s - fw / 2, d0 - 0.02, y1 + 0.12), W(s + fw / 2, d0 - 0.02, y1 + 0.12), W(s + fw / 2, d0 - 0.02, y1 + 0.12 + fh), W(s - fw / 2, d0 - 0.02, y1 + 0.12 + fh)],
        out, CR_FRAME, auxB, aux2B, [0, 0, 0], [[0, 1], [1, 1], [1, 2], [0, 2]]);
      crPoly(buf, [W(s - fw / 2 + 0.09, d0 - 0.04, y1 + 0.2), W(s + fw / 2 - 0.09, d0 - 0.04, y1 + 0.2), W(s + fw / 2 - 0.09, d0 - 0.04, y1 + fh + 0.04), W(s - fw / 2 + 0.09, d0 - 0.04, y1 + fh + 0.04)],
        out, CR_GLASS, auxB, aux2B, [0, 0, 0], [[0, 1], [1, 1], [1, 2], [0, 2]]);
    }
  }
}
// brick chimneys on the flat top, along the building's long axis
function crChimneys(buf, top, y, obb, b, count, auxB, aux2B, auxC, aux2R) {
  const ca = Math.cos(obb.ang), sa = Math.sin(obb.ang);
  const [ox, oz] = obb.centerW;
  const half = obb.w * 0.5 - 3.2;
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : -half + (2 * half * k) / (count - 1);
    const off = ((b.colorVar * 31.7 + k * 0.37) % 1 - 0.5) * 2.2;
    const px = ox + ca * t - sa * off, pz = oz + sa * t + ca * off;
    if (!crInside(top, px, pz)) continue;
    crBox(buf, px, pz, obb.ang, 0.95, 2.1, y - 0.2, y + 1.75, CR_BRICK, auxB, aux2B);
  }
}
function crBox(buf, px, pz, ang, sx, sz, yA, yB, col, aux, aux2) {
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const C = (lx, lz, y) => [px + ca * lx - sa * lz, y, pz + sa * lx + ca * lz];
  const hx = sx / 2, hz = sz / 2;
  const sides = [[[-hx, -hz], [hx, -hz], [0, -1]], [[hx, -hz], [hx, hz], [1, 0]], [[hx, hz], [-hx, hz], [0, 1]], [[-hx, hz], [-hx, -hz], [-1, 0]]];
  for (const [p, q, o] of sides) {
    const out = [ca * o[0] - sa * o[1], 0, sa * o[0] + ca * o[1]];
    crPoly(buf, [C(p[0], p[1], yA), C(q[0], q[1], yA), C(q[0], q[1], yB), C(p[0], p[1], yB)], out, col, aux, aux2, [0, 0, 0], [[0, 1], [1, 1], [1, 1 + yB - yA], [0, 1 + yB - yA]]);
  }
  crPoly(buf, [C(-hx, -hz, yB), C(hx, -hz, yB), C(hx, hz, yB), C(-hx, hz, yB)], [0, 1, 0], col.map((v) => v * 0.55), aux, aux2, [0, 0, 0], [[0, 1], [1, 1], [1, 2], [0, 2]]);
}
// a single rectangle hipped to a ridge along its long axis (the narrow halls)
function crHipRect(buf, obb, yF, P, col, aux, aux2, rf, b, spec, auxB, aux2B) {
  const ca = Math.cos(obb.ang), sa = Math.sin(obb.ang);
  const [ox, oz] = obb.centerW;
  const hw = obb.w / 2 - CR_E, hd = obb.h / 2 - CR_E;
  const rise = P.rise, ridge = Math.max(0.2, hw - hd);
  const W = (lx, lz, y) => [ox + ca * lx - sa * lz, y, oz + sa * lx + ca * lz];
  const yT = yF + rise - 0.05;
  const A1 = W(-hw, -hd, yF), A2 = W(hw, -hd, yF), B2 = W(hw, hd, yF), B1 = W(-hw, hd, yF);
  const C1 = W(-ridge, 0, yT), C2 = W(ridge, 0, yT);
  const dirW = (lx, lz) => [ca * lx - sa * lz, sa * lx + ca * lz];
  const [sx, sz] = dirW(0, -1), [nx2, nz2] = dirW(0, 1), [wx, wz] = dirW(-1, 0), [exx, exz] = dirW(1, 0);
  const ang = obb.ang;
  const up = yT - yF;
  crPoly(buf, [A1, A2, C2, C1], [sx, 0.6, sz], col, aux, aux2, [ang, A1[0], A1[2]], [[0, 0], [2 * hw, 0], [hw + ridge, up], [hw - ridge, up]]);
  crPoly(buf, [B2, B1, C1, C2], [nx2, 0.6, nz2], col, aux, aux2, [ang + Math.PI, B2[0], B2[2]], [[0, 0], [2 * hw, 0], [hw + ridge, up], [hw - ridge, up]]);
  crPoly(buf, [B1, A1, C1], [wx, 0.6, wz], col, aux, aux2, [ang - Math.PI / 2, B1[0], B1[2]], [[0, 0], [2 * hd, 0], [hd, up]]);
  crPoly(buf, [A2, B2, C2], [exx, 0.6, exz], col, aux, aux2, [ang + Math.PI / 2, A2[0], A2[2]], [[0, 0], [2 * hd, 0], [hd, up]]);
  if (spec.dormers) {   // a few small dormers on the long slopes, clear of the hip ends
    const Pd = { ...P, run: hd, rise: up };
    const foot = [[A1[0], A1[2]], [A2[0], A2[2]], [B2[0], B2[2]], [B1[0], B1[2]]];
    crDormers(buf, foot, yF, Pd, b, col, aux, aux2, auxB, aux2B, spec.dormers * 0.7);
  }
  if (spec.chimneys) {
    for (let k = 0; k < spec.chimneys; k++) {
      const t = spec.chimneys === 1 ? 0 : (-ridge * 0.8) + (1.6 * ridge * k) / (spec.chimneys - 1);
      const [px, pz] = [ox + ca * t, oz + sa * t];
      crBox(buf, px, pz, ang, 1.0, 2.0, yT - 1.2, yT + 1.5, CR_BRICK, auxB, aux2B);
    }
  }
}
// rectangular wings of a concave footprint in its OBB frame, snapped to the footprint's own coordinates (0.75 m raster)
function crWingRects(ring) {
  const obb = ringOBB(ring);
  const cA = Math.cos(obb.ang), sA = Math.sin(obb.ang);
  const [ox, oz] = obb.centerW;
  const toL = ([x, z]) => [(x - ox) * cA + (z - oz) * sA, -(x - ox) * sA + (z - oz) * cA];
  const toW = (lx, lz) => [ox + lx * cA - lz * sA, oz + lx * sA + lz * cA];
  const L = ring.map(toL);
  let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
  for (const [lx, lz] of L) { mnx = Math.min(mnx, lx); mxx = Math.max(mxx, lx); mnz = Math.min(mnz, lz); mxz = Math.max(mxz, lz); }
  const CELL = 0.75;
  const nx = Math.max(1, Math.ceil((mxx - mnx) / CELL)), nz = Math.max(1, Math.ceil((mxz - mnz) / CELL));
  if (nx * nz > 40000) return [];
  const mask = new Uint8Array(nx * nz);
  let total = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (crInside(L, mnx + (i + 0.5) * CELL, mnz + (j + 0.5) * CELL)) { mask[j * nx + i] = 1; total++; }
  const xs = [...new Set(L.map((p) => p[0]))], zs = [...new Set(L.map((p) => p[1]))];
  const snap = (v, arr) => { let best = v, bd = CELL * 0.9; for (const a of arr) { const d = Math.abs(a - v); if (d < bd) { bd = d; best = a; } } return best; };
  const MIN = Math.ceil(5 / CELL), hgt = new Int32Array(nx), out = [];
  let left = total;
  for (let guard = 0; left > total * 0.06 && guard < 24; guard++) {
    let best = null;
    hgt.fill(0);
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) hgt[i] = mask[j * nx + i] ? hgt[i] + 1 : 0;
      const st = [];
      for (let i = 0; i <= nx; i++) {
        const h = i < nx ? hgt[i] : 0;
        let start = i;
        while (st.length && st[st.length - 1][1] > h) {
          const [s0, hh] = st.pop();
          const area = hh * (i - s0);
          if (hh >= MIN && (i - s0) >= MIN && (!best || area > best.area)) best = { area, i0: s0, i1: i - 1, j0: j - hh + 1, j1: j };
          start = s0;
        }
        st.push([start, h]);
      }
    }
    if (!best) break;
    for (let j = best.j0; j <= best.j1; j++) for (let i = best.i0; i <= best.i1; i++) if (mask[j * nx + i]) { mask[j * nx + i] = 0; left--; }
    out.push({ toW, ang: obb.ang, x0: snap(mnx + best.i0 * CELL, xs), x1: snap(mnx + (best.i1 + 1) * CELL, xs), z0: snap(mnz + best.j0 * CELL, zs), z1: snap(mnz + (best.j1 + 1) * CELL, zs), L });
  }
  return out;
}
// one wing: sides on the footprint boundary step in by CR_E and slope; sides inside the building run on 0.4 m into the
// neighbouring wing so the two bodies meet in a valley instead of leaving a gutter between them
function crWingBody(buf, w, yF, P, col, aux, aux2, form) {
  const onEdge = (ax, az, bx, bz, nx, nz) => {
    let outs = 0;
    for (const t of [0.2, 0.5, 0.8]) { const x = ax + (bx - ax) * t + nx * 0.6, z = az + (bz - az) * t + nz * 0.6; if (!crInside(w.L, x, z)) outs++; }
    return outs >= 2;
  };
  const eS = onEdge(w.x0, w.z0, w.x1, w.z0, 0, -1), eN = onEdge(w.x0, w.z1, w.x1, w.z1, 0, 1);
  const eW = onEdge(w.x0, w.z0, w.x0, w.z1, -1, 0), eE = onEdge(w.x1, w.z0, w.x1, w.z1, 1, 0);
  const f = { x0: w.x0 + (eW ? CR_E : -0.4), x1: w.x1 - (eE ? CR_E : -0.4), z0: w.z0 + (eS ? CR_E : -0.4), z1: w.z1 - (eN ? CR_E : -0.4) };
  const dx = f.x1 - f.x0, dz = f.z1 - f.z0;
  if (dx < 2 || dz < 2) return;
  const tanP = P.rise / Math.max(0.3, P.run || 1);
  let run = form === 'mansard' ? P.run : Math.min(dx, dz) / 2;
  let rise = form === 'mansard' ? P.rise : Math.min(P.rise, run * tanP);
  const t = { x0: f.x0 + (eW ? run : 0), x1: f.x1 - (eE ? run : 0), z0: f.z0 + (eS ? run : 0), z1: f.z1 - (eN ? run : 0) };
  if (t.x1 < t.x0) { const m = (f.x0 + f.x1) / 2; t.x0 = t.x1 = m; }
  if (t.z1 < t.z0) { const m = (f.z0 + f.z1) / 2; t.z0 = t.z1 = m; }
  const yT = yF + rise - 0.05;
  const Wp = (lx, lz, y) => { const [x, z] = w.toW(lx, lz); return [x, y, z]; };
  const ca = Math.cos(w.ang), sa = Math.sin(w.ang);
  const dirW = (lx, lz) => [ca * lx - sa * lz, sa * lx + ca * lz];
  const faces = [
    [[f.x0, f.z0], [f.x1, f.z0], [t.x1, t.z0], [t.x0, t.z0], [0, -1]],
    [[f.x1, f.z0], [f.x1, f.z1], [t.x1, t.z1], [t.x1, t.z0], [1, 0]],
    [[f.x1, f.z1], [f.x0, f.z1], [t.x0, t.z1], [t.x1, t.z1], [0, 1]],
    [[f.x0, f.z1], [f.x0, f.z0], [t.x0, t.z0], [t.x0, t.z1], [-1, 0]],
  ];
  for (const [a, b2, c, d, o] of faces) {
    const A = Wp(a[0], a[1], yF), B2 = Wp(b2[0], b2[1], yF), C = Wp(c[0], c[1], yT), D = Wp(d[0], d[1], yT);
    const [ox2, oz2] = dirW(o[0], o[1]);
    const ex = B2[0] - A[0], ez = B2[2] - A[2], L = Math.hypot(ex, ez) || 1;
    const al = (p) => ((p[0] - A[0]) * ex + (p[2] - A[2]) * ez) / L;
    const flatSide = Math.hypot(C[0] - B2[0], C[2] - B2[2]) < 0.05 && Math.hypot(D[0] - A[0], D[2] - A[2]) < 0.05;
    crPoly(buf, [A, B2, C, D], flatSide ? [ox2, 0, oz2] : [ox2, 0.6, oz2], col, aux, aux2, [Math.atan2(ez, ex), A[0], A[2]], [[0, 0], [L, 0], [al(C), yT - yF], [al(D), yT - yF]]);
  }
  if (t.x1 - t.x0 > 0.3 && t.z1 - t.z0 > 0.3) {
    const deck = col.map((v, i) => v * 0.93 + [0.05, 0.03, 0.04][i]);
    crPoly(buf, [Wp(t.x0, t.z0, yT), Wp(t.x1, t.z0, yT), Wp(t.x1, t.z1, yT), Wp(t.x0, t.z1, yT)], [0, 1, 0], deck, aux, aux2, [w.ang, ...w.toW(t.x0, t.z0)], [[0, 6], [t.x1 - t.x0, 6], [t.x1 - t.x0, 6], [0, 6]]);
  }
}
// lathe helpers for domes and drums: quads between two circles
function crRingQuads(buf, cx, cz, rA, yA, rB, yB, seg, col, aux, aux2, uA, uB, outUp) {
  for (let k = 0; k < seg; k++) {
    const t0 = (k / seg) * Math.PI * 2, t1 = ((k + 1) / seg) * Math.PI * 2;
    const P = [[cx + Math.cos(t0) * rA, yA, cz + Math.sin(t0) * rA], [cx + Math.cos(t1) * rA, yA, cz + Math.sin(t1) * rA],
      [cx + Math.cos(t1) * rB, yB, cz + Math.sin(t1) * rB], [cx + Math.cos(t0) * rB, yB, cz + Math.sin(t0) * rB]];
    const tm = (t0 + t1) / 2;
    const arc = (r, t) => t * Math.max(r, 0.3);
    crPoly(buf, rB < 1e-3 ? [P[0], P[1], P[2]] : P, [Math.cos(tm), outUp, Math.sin(tm)], col, aux, aux2, [0, 0, 0],
      rB < 1e-3 ? [[arc(rA, t0), uA], [arc(rA, t1), uA], [arc(rA, tm), uB]] : [[arc(rA, t0), uA], [arc(rA, t1), uA], [arc(rA, t1), uB], [arc(rA, t0), uB]]);
  }
}
function crDome(buf, cx, cz, y0, r, rise, col, aux, aux2, seg = 20, bands = 6) {
  for (let i = 0; i < bands; i++) {
    const p0 = (i / bands) * Math.PI / 2, p1 = ((i + 1) / bands) * Math.PI / 2;
    crRingQuads(buf, cx, cz, r * Math.cos(p0), y0 + rise * Math.sin(p0), i === bands - 1 ? 0 : r * Math.cos(p1), y0 + rise * Math.sin(p1), seg, col, aux, aux2, rise * p0, rise * p1, Math.sin((p0 + p1) / 2) * 1.2);
  }
}
// Earl Hall: a pale lead-coated dome on a limestone drum, with a lantern
function crDomeRoof(buf, b, P, tone, auxC, aux2R, cx, cz) {
  const { obb } = P;
  const yF = P.eaveY + 0.05, H = P.topY - yF;
  const rD = Math.max(3.5, Math.min(8.5, Math.min(obb.w, obb.h) * 0.32));
  const [ox, oz] = obb.centerW;
  const drumH = H * 0.24, domeH = H * 0.46, lanH = H * 0.30;
  const stoneC = CR_STONE.map((v) => (v / 255) * 0.9);
  const auxS = [b.floorH, b.winW, 0, b.style], aux2S = [b.height, b.lit, b.colorVar, 2];
  crRingQuads(buf, ox, oz, rD + 0.35, yF, rD + 0.35, yF + drumH, 24, stoneC, auxS, aux2S, 1, 1 + drumH, 0);
  crRingQuads(buf, ox, oz, rD + 0.35, yF + drumH, rD, yF + drumH + 0.01, 24, stoneC, auxS, aux2S, 1, 1.1, 1);
  crDome(buf, ox, oz, yF + drumH, rD, domeH, tone, auxC, aux2R, 24, 7);
  const rL = Math.max(0.9, rD * 0.2), yL = yF + drumH + domeH * 0.97;
  crRingQuads(buf, ox, oz, rL, yL, rL, yL + lanH * 0.62, 12, stoneC, auxS, aux2S, 1, 1 + lanH, 0);
  crDome(buf, ox, oz, yL + lanH * 0.62, rL * 1.1, lanH * 0.38, tone, auxC, aux2R, 12, 3);
}
// Pupin's Rutherfurd Observatory: small painted domes on the flat top
function crObservatories(buf, top, y, obb, count, auxC, aux2R, auxB, aux2B) {
  const ca = Math.cos(obb.ang), sa = Math.sin(obb.ang);
  const [ox, oz] = obb.centerW;
  for (let k = 0; k < count; k++) {
    const t = count === 1 ? 0 : (k - (count - 1) / 2) * 9.5;
    const px = ox + ca * t, pz = oz + sa * t;
    if (!crInside(top, px, pz)) continue;
    const drum = [0.78, 0.78, 0.76];
    crRingQuads(buf, px, pz, 3.0, y, 3.0, y + 1.5, 20, drum, auxB, aux2B, 1, 2.5, 0);
    crDome(buf, px, pz, y + 1.5, 3.0, 2.9, CR_TONE.obs, auxC, aux2R, 20, 6);
  }
}
// ---------------------------------------------------------------------------
// FAC8 COPING BAND — the horizontal cap on top of a parapet, as its own
// annulus between the parapet's outer and inner rings.
//
// WHY THIS EXISTS (docs/notes/facades-r8.md §1, the round's biggest single find):
// the old parapet emitted `roofFill(rp, topY + ph)` over the WHOLE inset ring,
// so the plane you saw from above was the parapet's top at topY + 0.55..1.15,
// not the roof. The deck at topY was sealed under a lid; the rooftop engine
// claims every prop at topY, so the entire roofscape — AC banks, ducts,
// skylights, hatches, vents — was BURIED, and only bulkheads, tanks and
// chimneys poked through. That is the whole of "our roofs are bare white slabs
// with 1-3 boxes": the props were always there, under the roof.
//
// The cap is 2 tris per edge and takes its own membrane family so the roofline
// draws as a line: 60 % pale stone/precast (pavers, membId 4) and 40 % dark
// metal (tar, membId 2), which is what `ref_lenox.png` shows. No coplanar pair
// is created — the band is a horizontal face bounded by the two vertical
// parapet skins, edge to edge (zfight.md §6: overlap, never abut, and never a
// tie).
// The coping's own vertical FACE. A flat annulus is invisible from the street:
// the camera is below the roof plane, so a zero-thickness horizontal band shows
// nothing at all and the roofline reads as a knife edge — which is exactly what
// `harlem125` showed on the first fac8 pass, with the parapet landing correctly
// and being indistinguishable from the wall because it is (correctly) flush with
// it. A real coping is a 0.08-0.12 m stone standing ~45 mm proud of the parapet,
// and that 45 mm of shadow is the whole roofline read from the pavement.
// Flagged as ROOF so it takes the coping's membrane family rather than the wall
// colour: on a vertical face `rp = vWP.xz` barely varies over 0.09 m of height,
// so the membrane resolves to a near-flat tone, and the pavers family's 0.6 m
// grid lands as vertical joints along the run — coping stones, by accident of
// the right kind.
function copingSkin(buf, ring, yLo, yHi, b, membId) {
  const n = ring.length;
  const aux = [b.floorH, b.winW, membId, b.style];
  const aux2 = [b.height, b.lit, b.colorVar, 4];
  const col = [0.62, 0.60, 0.575];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    const ex = x2 - x1, ez = z2 - z1;
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    const nx = ez / len, nz = -ex / len;
    buf.quad([x1, yLo, z1], [x1, yHi, z1], [x2, yHi, z2], [x2, yLo, z2],
      [nx, 0, nz], col, [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2);
  }
}
function copingBand(buf, outer, inner, y, b, membId) {
  const n = outer.length;
  const aux = [b.floorH, b.winW, membId, b.style];
  const aux2 = [b.height, b.lit, b.colorVar, 4];   // roof flag: the membrane shader
  const col = [0.62, 0.60, 0.575];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = outer[i], B = outer[j], C = inner[j], D = inner[i];
    // NM24: a horizontal triangle faces up iff its (x, z) shoelace cross is negative; wind each half up explicitly
    upTri(buf, [A[0], y, A[1]], [D[0], y, D[1]], [C[0], y, C[1]], col, aux, aux2);
    upTri(buf, [A[0], y, A[1]], [C[0], y, C[1]], [B[0], y, B[1]], col, aux, aux2);
  }
}
// FAC8 PARAPET — outer skin flush with the facade, inner skin set back by the
// parapet's real thickness, a coping band across the top, and the roof deck
// left OPEN at topY where the rooftop engine puts its props.
function fac8Parapet(buf, ring, cx, cz, topY, b, y0) {
  const cv = (b.colorVar * 7.7) % 1;
  // NYC parapet heights: 1.07 m (42 in) is the modern guard minimum, pre-war
  // walk-ups run 0.75-1.4 m, and a street-front parapet is taller than the
  // party-wall return. Below 6 m (garages, one-storey taxpayers) there is
  // often only a coping, so keep those low.
  const tall = b.height > 11 && (b.style === STYLE.TENEMENT || b.style === STYLE.PREWAR_APT
    || b.style === STYLE.ROWHOUSE || b.style === STYLE.LOFT_CASTIRON || b.style === STYLE.DECO_MASONRY);
  // ROOF9: a big-box parapet is a SCREEN — it exists to hide 8-12 packaged
  // units from the street and the neighbours, so it is 1.2-1.8 m, not the
  // 0.62-1.02 m a one-storey taxpayer gets.
  const screen = ROOF9 && b.style === STYLE.RETAIL_MODERN;
  // R12: the parapet height is DEALT, not hashed. `cv` is an independent draw per
  // building, so two neighbours land within 0.1 m of each other about a fifth of the
  // time and a Harlem row draws one flat line. r12Deal() spreads the deal over the
  // same range but guarantees consecutive ordinals sit in different thirds of it.
  const pv = r12Deal(b, 0) >= 0 ? r12Deal(b, 0) : cv;
  // WB13: the frame belt's measured parapet is 0.46-1.07 m on the street face,
  // modal 0.66 (docs/typology/08-vinyl-rowhouse.md §1.2) — a low coping course
  // behind a boxed cornice, not the 0.62-1.14 m a masonry taxpayer gets. On a
  // 9 m three-storey house the difference is a fifth of a storey of roofline,
  // which in an oblique aerial of a whole block is the difference between a row
  // of houses and a row of low apartment buildings.
  const frame13 = WB13 && b.style === STYLE.FRAME_HOUSE;
  const ph = screen ? 1.15 + pv * 0.6
    : frame13 ? 0.48 + pv * 0.50
    : (tall ? 0.95 : 0.62) + pv * (tall ? 0.72 : 0.52);
  const th = 0.26 + ((b.colorVar * 3.1) % 1) * 0.16;      // 0.26-0.42 m thick
  const inner = ringInsetAbs(ring, th, cx, cz);
  // outer skin: flush with the wall below (the old one was inset 1.5 %, which
  // read as a step all round the roofline instead of a continuous facade plane)
  extrudePrism(buf, ring, topY, topY + ph, b, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.83, faceH: ph });
  // inner skin: reversed ring so its quads face INTO the roof well. Without it
  // the far parapet is a backface from every oblique above the roof plane and
  // the roof reads as a hole. Darker still: the inside of a parapet is in its
  // own shadow most of the day and is where the roof's dirt collects.
  extrudePrism(buf, inner.slice().reverse(), topY, topY + ph, b, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.66, faceH: ph, faceIn: true });
  // COPING: a 0.09 m stone standing 45 mm proud, its bottom sunk 20 mm into the
  // parapet so no face is coplanar with any other (zfight.md: overlap, never
  // abut).
  //
  // The family is chosen by CONTRAST WITH THE WALL, not by a blind hash.
  // Measured on `after2/harlem125_day.png` (profiles in docs/notes/facades-r8.md
  // §11.11): where the hash rolled the dark-metal cap the coping reads as a
  // crisp 3 px line — sky 215, coping 81-88, wall 177 — and where it rolled the
  // pale precast cap onto a pale tan wall it reads as nothing at all, because a
  // 0.45-albedo cap on a 0.42-albedo wall has no edge to see. Real copings are
  // chosen for the building, and dark metal on light masonry / pale stone on
  // dark masonry is both the common case and the legible one. A fifth stays on
  // the hash so a block is not perfectly alternating.
  const wLum = (0.3 * b.r + 0.59 * b.g + 0.11 * b.b) / 255;
  const cHash = (b.colorVar * 17.3) % 1;
  const membId = cHash < 0.2 ? (cHash < 0.1 ? 4 : 2)      // a fifth keep the coin-flip
    : wLum > 0.52 ? 2                                      // light wall -> dark metal cap
      : 4;                                                 // dark wall -> pale stone cap
  const cop = ringInsetAbs(ring, -0.045, cx, cz);
  const cLo = topY + ph - 0.02, cHi = topY + ph + 0.07;
  copingSkin(buf, cop, cLo, cHi, b, membId);
  copingBand(buf, cop, inner, cHi, b, membId);
  // R12 PARTY-WALL FIRE WALLS — the jagged step (docs/notes/silhouette-r12.md §3.2).
  if (R12) r12FireWalls(buf, ring, inner, cop, cx, cz, topY, ph, b, membId);
  return ph;
}
// ---------------------------------------------------------------------------
// R12 PARTY-WALL FIRE WALLS
// `b.blind` is a per-edge bitmask and a set bit IS a lot line: the compiler sets
// it where another footprint abuts this one, which is why that wall gets no
// windows. NYC building code has carried the party wall up past the roof as a
// fire wall since 1899, so a row of brownstones at one height still reads as a
// row of separate buildings from any oblique: eight steps in the roofline, each
// a lot wide. Ours drew one unbroken parapet line, and "parapets all one height"
// is the exact phrase edges-r10 §5 p3 used to identify our frame.
//
// One prism per party wall, 0.28-0.95 m proud of the street parapet, its own
// coping, end caps so the return reads as thickness rather than as a card. Cost
// is 5 quads = 10 triangles per party wall and it goes into the tile's own
// facade mesh, so no draw call and no new material.
//
// The two rules that keep it honest:
//  * ONLY where the neighbour is genuinely lower or equal — a fire wall in front
//    of a taller neighbour is invisible anyway, and we do not know the
//    neighbour's height here, so the height is dealt rather than derived and is
//    kept under 1 m: a step that size is right whatever stands behind it.
//  * NEVER on a building whose parapet is already a screen (RETAIL_MODERN) or on
//    anything under 6 m, where a 0.9 m fire wall is a sixth of the building.
function r12FireWalls(buf, ring, inner, cop, cx, cz, topY, ph, b, membId) {
  if (b.height < 6 || (ROOF9 && b.style === STYLE.RETAIL_MODERN)) return;
  const mask = b.blind | 0;
  if (!mask) return;
  const n = ring.length;
  const d0 = r12Deal(b, 1);
  const col = [b.r / 255 * 0.79, b.g / 255 * 0.79, b.b / 255 * 0.79];
  const ccol = [0.62, 0.60, 0.575];
  const aux = [b.floorH, b.winW, 0, b.style];
  const auxC = [b.floorH, b.winW, membId, b.style];
  const yLo = topY + ph + 0.05;
  let made = 0;
  for (let i = 0; i < n && i < 32; i++) {
    if (!((mask >> i) & 1)) continue;
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    const ex = x2 - x1, ez = z2 - z1;
    const len = Math.hypot(ex, ez);
    if (len < 2.2) continue;                    // a 2 m return is not a fire wall
    // dealt height: three bands so consecutive lots in a row step against each
    // other rather than all rising by the same amount.
    const hsel = (d0 >= 0 ? d0 : (b.colorVar * 23.9) % 1);
    const rise = 0.28 + ((hsel + i * 0.31) % 1) * 0.67;
    const yHi = yLo + rise;
    const [ix1, iz1] = inner[i], [ix2, iz2] = inner[(i + 1) % n];
    const nx = ez / len, nz = -ex / len;
    const aux2 = [b.height, b.lit, b.colorVar, 2];        // blind: flat masonry, no window grid
    // outer skin (street/alley side) and inner skin (roof side, darker)
    buf.quad([x1, yLo, z1], [x1, yHi, z1], [x2, yHi, z2], [x2, yLo, z2], [nx, 0, nz], col,
      [0, 0, 0, rise, len, rise, len, 0], aux, aux2);
    buf.quad([ix2, yLo, iz2], [ix2, yHi, iz2], [ix1, yHi, iz1], [ix1, yLo, iz1], [-nx, 0, -nz],
      [col[0] * 0.8, col[1] * 0.8, col[2] * 0.8], [0, 0, 0, rise, len, rise, len, 0], aux,
      [b.height, b.lit, b.colorVar, 2]);
    // end caps, so the wall has thickness from along the row
    buf.quad([x1, yLo, z1], [ix1, yLo, iz1], [ix1, yHi, iz1], [x1, yHi, z1],
      [-ex / len, 0, -ez / len], col, [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2);
    buf.quad([ix2, yLo, iz2], [x2, yLo, z2], [x2, yHi, z2], [ix2, yHi, iz2],
      [ex / len, 0, ez / len], col, [0, 0, 0, 0, 0, 0, 0, 0], aux, aux2);
    // its own coping cap, flagged ROOF so it takes the coping membrane family
    const [cx1, cz1] = cop[i], [cx2, cz2] = cop[(i + 1) % n];
    buf.quad([cx1, yHi, cz1], [ix1, yHi, iz1], [ix2, yHi, iz2], [cx2, yHi, cz2], [0, 1, 0], ccol,
      [0, 0, 0, 0, 0, 0, 0, 0], auxC, [b.height, b.lit, b.colorVar, 4]);
    if (++made >= 4) break;                      // a footprint has at most four lot lines
  }
}
// R12: the same lot lines as world segments, for the roof engine's chimneys
// (plan item S3). Kept next to r12FireWalls because the two must always agree
// about what a party wall is — the fire wall and the flue share the masonry.
function r12PartyEdges(ring, b) {
  const mask = b.blind | 0;
  if (!mask) return null;
  const out = [];
  const n = ring.length;
  for (let i = 0; i < n && i < 32 && out.length < 6; i++) {
    if (!((mask >> i) & 1)) continue;
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    if (Math.hypot(x2 - x1, z2 - z1) < 3) continue;
    out.push([x1, z1, x2, z2]);
  }
  return out.length ? out : null;
}
function ringOBB(pts) {
  let best = null;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    const ang = Math.atan2(z2 - z1, x2 - x1);
    const c = Math.cos(-ang), s = Math.sin(-ang);
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
    for (const [px, pz] of pts) {
      const rx = px * c - pz * s, rz = px * s + pz * c;
      minX = Math.min(minX, rx); maxX = Math.max(maxX, rx);
      minZ = Math.min(minZ, rz); maxZ = Math.max(maxZ, rz);
    }
    const area = (maxX - minX) * (maxZ - minZ);
    if (!best || area < best.area) best = { area, ang, minX, maxX, minZ, maxZ };
  }
  const c = Math.cos(best.ang), s = Math.sin(best.ang);
  const cxr = (best.minX + best.maxX) / 2, czr = (best.minZ + best.maxZ) / 2;
  let w = best.maxX - best.minX, h = best.maxZ - best.minZ, ang = best.ang;
  const centerW = [cxr * c - czr * s, cxr * s + czr * c];
  if (h > w) { const t = w; w = h; h = t; ang += Math.PI / 2; } // long axis first
  return { w, h, ang, center: centerW, centerW };
}

// extrude one prism (ring at world coords) into buf; returns nothing
function extrudePrism(buf, ring, y0, y1, b, opts = {}) {
  // opts.colScale: the BLIND shader branch (materials.js, `else { FAC_dbg = 3.0 ... }`)
  // does NOT apply the global value calibration `pow(albedo, 1.22) * 0.88` that
  // the windowed branch ends with — it only multiplies by 0.88-1.0 of noise. A
  // blind-flagged prism therefore renders about 1.3x brighter than the identical
  // colour on the wall below it. That was tolerable on the old 0.55-1.15 m
  // inset parapet lip and is not on a flush 0.62-1.50 m one: it would draw a
  // bright halo along every roofline in the city.
  // Solving (k*c)^2 * 0.94 = ((c^2)^1.22) * 0.88 for the wall values that
  // actually occur gives k = 0.77 at c = 0.35, 0.83 at c = 0.5 and 0.90 at
  // c = 0.7 — the exponent makes it value-dependent, so 0.83 is the middle and
  // the residual error is under 8 % either way.
  const k = opts.colScale ?? 1;
  const col = [b.r / 255 * k, b.g / 255 * k, b.b / 255 * k];
  const styleF = b.style;
  const flagsBase = (b.flags & BF.CORNICE ? 1 : 0) + (b.flags & BF.STOREFRONT && !opts.noStore ? 8 : 0);
  const aux = [b.floorH, b.winW, b.storeH, styleF];
  const n = ring.length;
  let u = 0;
  for (let i = 0; i < n; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
    const ex = x2 - x1, ez = z2 - z1;
    const len = Math.hypot(ex, ez);
    if (len < 0.05) continue;
    // shoelace-positive ring in (x,z) ⇒ exterior side is (+ez,-ex); wind quads so the
    // geometric front face (cross product) matches that outward direction.
    // u is WALL-LOCAL (0..len) — window bays are laid out per wall with corner margins,
    // so windows can never be sliced by a building corner.
    let nx = ez / len, nz = -ex / len;
    const blind = opts.blindMask !== undefined && i < 32 && ((opts.blindMask >> i) & 1);
    // E10: a prism that knows its own height publishes it in aux3.z (free on a blind
    // wall — that slot is the door pack, and only a windowed wall has a door) and sets
    // flags bit 64 so the shader trusts it. Bit 128 marks the roof-side face of a
    // parapet, whose contact is the membrane turn-up rather than the coping wash.
    const faceHv = E10 && opts.faceH > 0 ? opts.faceH : 0;
    const flags = flagsBase + (blind ? 2 : 0)
      + (faceHv ? FF_FACEH : 0) + (faceHv && opts.faceIn ? FF_FACEIN : 0);
    // aux2.x = THIS WALL's top in v units (v is height above baseRef): the
    // shader stops the window grid 0.8m below it. Using the whole-building
    // height here let setback-tier top rows slice through their parapets.
    const aux2 = [y1 - (opts.baseRef ?? y0), b.lit, b.colorVar, flags];
    buf.quad(
      [x1, y0, z1], [x1, y1, z1], [x2, y1, z2], [x2, y0, z2],
      [nx, 0, nz], col,
      [0, y0 - opts.baseRef, 0, y1 - opts.baseRef, len, y1 - opts.baseRef, len, y0 - opts.baseRef],
      aux, aux2, [len, (u % 97) + i * 0.13, i === opts.doorI ? opts.doorPack : faceHv],
    );
    u += len;
  }
}
// ---------------------------------------------------------------------------
// ROOF9 / brief C — STYLE.RETAIL_MODERN (docs/notes/roofs-r9.md §2)
// 100 W 125th St (2017, class K, 15 m, block-long, an OSM gap-fill) rendered as
// a blank tan brick box with sparse punched windows. The real building is a
// glazed base with a signage band, an upper facade of metal / fibre-cement
// rainscreen panels with few or no windows, and a parapet.
//
// It is built from FOUR PRISMS AND FOUR BANDS rather than a shader branch,
// because materials.js is shared by every facade family and a style id
// above 12 reaching its windowed branch inherits PROJECT_BRICK red brick
// (`style > 11.5` in three places — notes §0.1):
//
//   fndY .. y0+sH    non-blind, STOREFRONT flag -> the shader's own storefront
//                    branch: interior-mapped glazing, and above 0.78 * storeH
//                    the generated fascia sign from the 32-slot atlas. That IS
//                    the signage band; this function frames it in metal.
//   y0+sH .. fieldTop  BLIND on every wall -> flat rainscreen field, no
//                    windows, and the blind branch never reads `style` at all.
//   fieldTop .. topY   the same, 15 % darker: the spandrel course under the
//                    parapet that these facades almost always carry.
//   bands            a drip cap over the sign, one or two horizontal panel-
//                    course reveals, and a 0.9 m canopy over the glazing.
//
// Bands are flagged as ROOF surfaces with membrane id 2, which is the r8
// coping's trick: the membrane branch (materials.js, isRoof) paints id 2 as
// smooth dark bitumen at 0.085-0.12 albedo, i.e. a dark metal band — and,
// unlike the facade branch, it is style-independent and needs no window grid.
//
// The mitre rule (facades-r8 §9 open item): a band is emitted only on
// non-blind edges, and extended into the corner ONLY at its far end and only
// when the next edge is also non-blind. Extending both ends would overlap two
// coplanar tops in a d x d square at every corner — an exact z-fight tie —
// and extending into a party wall would push the band through the neighbour.
function r9Band(buf, ring, d, yLo, yHi, b, col, mask, membId) {
  const n = ring.length;
  const aux = [b.floorH, b.winW, membId, b.style];
  const aux2 = [b.height, b.lit, b.colorVar, 4];      // flags bit 2 = roof surface
  const Z8 = [0, 0, 0, 0, 0, 0, 0, 0];
  const dark = [col[0] * 0.72, col[1] * 0.72, col[2] * 0.72];
  const blind = (i) => mask !== undefined && i < 32 && ((mask >> i) & 1);
  for (let i = 0; i < n; i++) {
    if (blind(i)) continue;
    const j = (i + 1) % n;
    const A = ring[i], B = ring[j];
    const ex = B[0] - A[0], ez = B[1] - A[1];
    const len = Math.hypot(ex, ez);
    if (len < 0.25) continue;
    const tx = ex / len, tz = ez / len;               // along the edge
    const nx = tz, nz = -tx;                          // outward (shoelace-positive ring)
    // CORNER RETURN, by the sign and size of the turn at B. Getting this wrong
    // is a z-fight, not a cosmetic error, and both failure modes are real on
    // these footprints — 100 W 125th is a 6-gon with one 6 m concave jog:
    //   convex and turning more than ~15 deg -> extend the END by d, which
    //     fills the mitre gap exactly and ABUTS the next edge's band (extending
    //     both ends would overlap two coplanar tops in a d x d square);
    //   nearly straight -> extend by nothing: there is no mitre gap to fill and
    //     an extension would lie ON TOP of the next edge's band;
    //   concave (reflex) -> PULL BACK by d, because at a reflex corner the two
    //     outward-offset bands overlap each other by d x d on their own. A
    //     0.9 m canopy doing that is a visible flickering square.
    const C = ring[(j + 1) % n];
    const jx = C[0] - B[0], jz = C[1] - B[1];
    const jl = Math.hypot(jx, jz) || 1;
    const turn = (ex * jz - ez * jx) / (len * jl);    // >0 convex, <0 reflex
    const e1 = blind(j) ? 0 : (turn > 0.25 ? d : turn < -0.05 ? -d : 0);
    const A1 = [A[0], A[1]], B1 = [B[0] + tx * e1, B[1] + tz * e1];
    const Ao = [A1[0] + nx * d, A1[1] + nz * d], Bo = [B1[0] + nx * d, B1[1] + nz * d];
    buf.quad([Ao[0], yLo, Ao[1]], [Ao[0], yHi, Ao[1]], [Bo[0], yHi, Bo[1]], [Bo[0], yLo, Bo[1]],
      [nx, 0, nz], col, Z8, aux, aux2);                                    // fascia
    buf.quad([Ao[0], yHi, Ao[1]], [A1[0], yHi, A1[1]], [B1[0], yHi, B1[1]], [Bo[0], yHi, Bo[1]],
      [0, 1, 0], col, Z8, aux, aux2);                                      // top
    buf.quad([Ao[0], yLo, Ao[1]], [Bo[0], yLo, Bo[1]], [B1[0], yLo, B1[1]], [A1[0], yLo, A1[1]],
      [0, -1, 0], dark, Z8, aux, aux2);                                    // soffit
    if (e1 !== 0) {
      // the return's end cap, facing +t (it continues the next edge's fascia
      // plane at a convex corner). Wound inner -> outer along the BOTTOM edge
      // first: [B1lo, Bolo, Bohi, B1hi] has its geometric front at +t, and the
      // reverse of that pair ([B1lo, B1hi, ...]) puts the front at -t while the
      // declared normal still says +t — a sliver lit from the wrong side.
      buf.quad([B1[0], yLo, B1[1]], [Bo[0], yLo, Bo[1]], [Bo[0], yHi, Bo[1]], [B1[0], yHi, B1[1]],
        [tx, 0, tz], dark, Z8, aux, aux2);
    }
  }
}
function retailModern(buf, ring, cx, cz, fndY, y0, topY, b, opts) {
  const H = topY - y0;
  // The glazed base must never be TALLER than the storeH the shader tests
  // against (aux.z = b.storeH): any slice of a non-blind prism above storeH
  // falls through to the windowed branch and punches window bays in it.
  const sH = Math.min(b.storeH > 2 ? b.storeH : 5.0, H * 0.62);
  const baseTop = y0 + sH;
  const spH = Math.min(1.15, Math.max(0.4, (H - sH) * 0.18));
  const fieldTop = topY - spH;
  extrudePrism(buf, ring, fndY, baseTop, b, { ...opts, baseRef: y0 });
  extrudePrism(buf, ring, baseTop, fieldTop, b,
    { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.83 });
  extrudePrism(buf, ring, fieldTop, topY, b,
    { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.70 });
  const mask = b.blind;
  const metal = [0.62, 0.61, 0.60];
  r9Band(buf, ring, 0.075, baseTop - 0.10, baseTop + 0.06, b, metal, mask, 2);   // drip cap over the sign
  r9Band(buf, ring, 0.07, fieldTop - 0.08, fieldTop + 0.08, b, metal, mask, 2);  // spandrel course break
  if (fieldTop - baseTop > 5.2) {                       // a tall field gets one more course
    const yM = baseTop + (fieldTop - baseTop) * 0.52;
    r9Band(buf, ring, 0.07, yM - 0.075, yM + 0.075, b, metal, mask, 2);
  }
  // the canopy: 0.9 m over the pavement at the head of the glazing, under the
  // sign band. Kept to 0.9 m because the compiler's own frontage props (bus
  // shelters at 2.6 m, newsstands, tree crowns from ~3.5 m) share that strip.
  const yC = y0 + Math.min(sH * 0.74, sH - 0.9);
  r9Band(buf, ring, 0.9, yC - 0.22, yC, b, metal, mask, 2);
  return sH;
}
// RF13 (owner 2026-09-16): the ROOF FRAME — angle of the longest parapet edge and its first vertex. Handed to the membrane
// shader in aux3 so seams, blotches and drains run along the building instead of along world X/Z.
function roofFrame(ring) {
  let best = -1, bi = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const l = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2; if (l > best) { best = l; bi = i; } }
  const a = ring[bi], b = ring[(bi + 1) % ring.length];
  return [Math.atan2(b[1] - a[1], b[0] - a[0]), a[0], a[1]];
}
function roofFill(buf, ring, y, b, copper = false, membOverride = -1, holes = null) {
  const rf = roofFrame(ring);   // RF13: the building's roof frame for the membrane shader (see GeoBuf.tri)
  const flat = [];
  for (const [x, z] of ring) flat.push(x, z);
  // CY12: a courted deck is earcut WITH HOLES — the court rings are appended to the same
  // flat coordinate list and their first-vertex indices handed to earcut, which is exactly
  // the winding the compiler already gave them (outer CCW, courts CW). The whole deck is
  // still ONE fill, so the roof keeps its single merged draw.
  let holeIdx = null;
  if (CY12 && holes && holes.length) {
    holeIdx = [];
    for (const h of holes) { holeIdx.push(flat.length / 2); for (const [x, z] of h) flat.push(x, z); }
  }
  const tris = earcut(flat, holeIdx);
  // roofKind bit 0x80 = real green roof (TNC dataset): sedum surface color
  const col = b.greenRoof ? [0.30, 0.34, 0.20]
    : copper ? [0.35, 0.55, 0.45] : [b.r / 255 * 0.9, b.g / 255 * 0.9, b.b / 255 * 0.9];
  const aux2 = [b.height, b.lit, b.colorVar, 4]; // roof flag
  // aux.z carries the membrane pattern id: 1 silver, 2 dark, 3 gravel,
  // 4 pavers, 5 sedum (0 = legacy hash pick, e.g. hip fills)
  const membId = membOverride >= 0 ? membOverride
    : b.greenRoof ? 5 : b.fmemb !== undefined ? b.fmemb : b.membrane !== undefined ? b.membrane + 1 : 0;
  const aux = [b.floorH, b.winW, membId, b.style];
  // ---- E10 RIM BAND (edges-r10 §2). r8 blind finding 3 asked the membrane shader for
  // "a dark rim where water and soot pool against the parapet" and the shader could not
  // deliver it: earcut only ever outputs the INPUT ring's vertices, so every vertex of a
  // roof deck is on the boundary and a per-vertex distance-to-edge is identically 0.
  // A 1.25 m band between the ring and its inset fixes that for the cost of 2 triangles
  // per ring edge (a 6-gon roof: 12 extra tris) and zero draw calls — the band goes into
  // the same merged facade geometry as the deck it belongs to. uv.x carries the code
  // 1 + metres, so 0 still means "no rim data" on every call site that has not been
  // converted (hip fills, the tower path's own `cap`).
  // CY12: no rim band on a courted deck. The band's inset is RADIAL about the outer ring's
  // centroid, and on a donut that centroid sits inside a court — the inset ring would cut
  // straight across the hole and earcut would bow-tie the whole deck. The plain fill below
  // handles the hole list correctly (uv.x stays 0, which every call site reads as "no rim").
  if (E10 && !holeIdx && ring.length >= 3 && ring.length <= 64) {
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    let minR = 1e9;
    for (const [x, z] of ring) minR = Math.min(minR, Math.hypot(x - cx, z - cz));
    // NM24: the band is exactly RIM_M wide (its uv codes the distance), so it takes the exact miter offset or nothing
    const rin = minR > RIM_M * 2.4 ? (NM24O ? ringOffsetMiter(ring, RIM_M) : ringInsetAbs(ring, RIM_M, cx, cz)) : null;
    if (rin) {
      const n = ring.length;
      // A radial inset is not a polygon offset: on a concave or L-shaped footprint the
      // inset ring can self-intersect, and earcut turns a self-intersecting ring into a
      // bow tie (towers.js §2 hit exactly this with its setback insets). The shoelace
      // area is the cheap test: the inset must keep the ring's orientation and land
      // between 20 % and 100 % of its area, or we fall through to the plain earcut.
      let a0 = 0, a1 = 0;
      for (let i = 0; i < n; i++) {
        const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
        const [u1, v1] = rin[i], [u2, v2] = rin[(i + 1) % n];
        a0 += x1 * z2 - x2 * z1; a1 += u1 * v2 - u2 * v1;
      }
      if (!(a0 !== 0 && a1 / a0 > 0.20 && a1 / a0 < 1.0)) {
        for (let i = 0; i < tris.length; i += 3) {
          const A = [flat[tris[i] * 2], y, flat[tris[i] * 2 + 1]];
          const B = [flat[tris[i + 1] * 2], y, flat[tris[i + 1] * 2 + 1]];
          const C2 = [flat[tris[i + 2] * 2], y, flat[tris[i + 2] * 2 + 1]];
          upTri(buf, A, C2, B, col, aux, aux2, null, rf);   // NM24
        }
        return;
      }
      const OUT = 1.0, IN = 1.0 + RIM_M;
      for (let i = 0; i < n; i++) {
        const O0 = ring[i], O1 = ring[(i + 1) % n];
        const I0 = rin[i], I1 = rin[(i + 1) % n];
        // NM24: wound up explicitly (upTri), not by assuming the inset kept every edge's direction
        upTri(buf, [O0[0], y, O0[1]], [I1[0], y, I1[1]], [O1[0], y, O1[1]], col, aux, aux2, [OUT, 0, IN, 0, OUT, 0], rf);
        upTri(buf, [O0[0], y, O0[1]], [I0[0], y, I0[1]], [I1[0], y, I1[1]], col, aux, aux2, [OUT, 0, IN, 0, IN, 0], rf);
      }
      const flatI = [];
      for (const [x, z] of rin) flatI.push(x, z);
      const trisI = earcut(flatI);
      for (let i = 0; i < trisI.length; i += 3) {
        const A = [flatI[trisI[i] * 2], y, flatI[trisI[i] * 2 + 1]];
        const B = [flatI[trisI[i + 1] * 2], y, flatI[trisI[i + 1] * 2 + 1]];
        const C2 = [flatI[trisI[i + 2] * 2], y, flatI[trisI[i + 2] * 2 + 1]];
        upTri(buf, A, C2, B, col, aux, aux2, [IN, 0, IN, 0, IN, 0], rf);   // NM24: up; RF13: the inner deck takes the roof frame too
      }
      return;
    }
  }
  for (let i = 0; i < tris.length; i += 3) {
    const A = [flat[tris[i] * 2], y, flat[tris[i] * 2 + 1]];
    const B = [flat[tris[i + 1] * 2], y, flat[tris[i + 1] * 2 + 1]];
    const C2 = [flat[tris[i + 2] * 2], y, flat[tris[i + 2] * 2 + 1]];
    upTri(buf, A, C2, B, col, aux, aux2, null, rf);   // NM24: earcut on a self-touching ring can emit a few flipped triangles
  }
}
// ---------------------------------------------------------------------------
// CY12 — THE THREE PIECES OF AN ENCLOSED LIGHT COURT (docs/notes/courtyards-r12.md)
// The deck hole is roofFill's job above; these are the walls that look into the court,
// the floor at the bottom of the shaft and the parapet where the court meets the roof.
// Every one takes the court ring exactly as the compiler wound it: CW, the opposite of
// the outer ring, which is what makes extrudePrism's own rule ("shoelace-positive ring
// => exterior side is (+ez,-ex)") turn the wall quads INTO the court with no new flag.

// The wall. Same facade attributes as a street wall — the shader's windowed branch, the
// building's own colour, style, floor height and bay width — because a court wall IS a
// facade: it is where the interior rooms' legally required light comes from, which is the
// entire reason the court exists. Two deliberate differences: `blindMask: 0`, since
// `b.blind` is a party-wall mask indexed against the OUTER ring's edges and would blind
// arbitrary court edges if reused; and `noStore: true`, because there is no shopfront at
// the bottom of an enclosed light shaft.
function cy12CourtWalls(buf, holes, fndY, topY, b, y0) {
  for (const h of holes) extrudePrism(buf, h, fndY, topY, b, { baseRef: y0, blindMask: 0, noStore: true });
}
// The floor. Without it a court is a hole through the world: the only thing under a
// building is main.js's 46 km water plane at y = 0, about 3.5 m below the datum, so every
// court would show a square of river. A real court floor is concrete or gravel in
// permanent shade — membrane id 3 (gravel) and a dark neutral. The ring is REVERSED to
// CCW first so earcut's output takes the same orientation roofFill relies on and
// `tri(A, C, B)` faces up.
function cy12CourtFloor(buf, holes, y, b) {
  const col = [0.255, 0.25, 0.245];
  const aux = [b.floorH, b.winW, 3, b.style];
  const aux2 = [b.height, b.lit, b.colorVar, 4];        // flags 4 = roof/membrane surface
  for (const h of holes) {
    const flat = [];
    for (const [x, z] of h.slice().reverse()) flat.push(x, z);
    const tris = earcut(flat);
    for (let i = 0; i < tris.length; i += 3) {
      const A = [flat[tris[i] * 2], y, flat[tris[i] * 2 + 1]];
      const B = [flat[tris[i + 1] * 2], y, flat[tris[i + 1] * 2 + 1]];
      const C = [flat[tris[i + 2] * 2], y, flat[tris[i + 2] * 2 + 1]];
      buf.tri(A, C, B, [0, 1, 0], col, aux, aux2);
    }
  }
}
// The parapet, mirroring fac8Parapet around a hole instead of around a block. The street
// front gets 0.62-1.67 m of parapet and coping; a deck that stopped at a knife edge over
// the court would read as a punched hole from every air camera. Same height (`ph`, dealt
// once for the building) and the same wall-contrast coping family, so the roofline is one
// decision. Geometry, all of it the fac8Parapet construction with the inside and the
// outside swapped:
//   court-side skin  the court ring itself, flush with the wall below it (CW -> faces in)
//   roof-side skin   the ring pushed OUT of the court by the parapet thickness, reversed
//                    so it faces back across the deck
//   coping           a stone 45 mm proud INTO the court, its band spanning the two skins.
// copingBand(outer, inner) wants a big CCW ring and a small CCW ring inside it; reversing
// both court rings and swapping which one is "outer" cancels, so the band still faces up.
function cy12CourtParapet(buf, holes, topY, b, y0, ph, membId) {
  if (!(ph > 0.05)) return;
  const th = 0.26 + ((b.colorVar * 3.1) % 1) * 0.16;    // same 0.26-0.42 m as the street parapet
  for (const h of holes) {
    let hx = 0, hz = 0;
    for (const [x, z] of h) { hx += x; hz += z; }
    hx /= h.length; hz /= h.length;
    const cin = ringInsetAbs(h, -th, hx, hz);           // negative d = away from the court centroid
    extrudePrism(buf, h, topY, topY + ph, b, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.83, faceH: ph });
    extrudePrism(buf, cin.slice().reverse(), topY, topY + ph, b, { baseRef: y0, noStore: true, blindMask: 0xffffffff, colScale: 0.66, faceH: ph, faceIn: true });
    const cop = ringInsetAbs(h, 0.045, hx, hz);         // positive d = proud into the court
    const cLo = topY + ph - 0.02, cHi = topY + ph + 0.07;
    copingSkin(buf, cop, cLo, cHi, b, membId);
    copingBand(buf, cin.slice().reverse(), cop.slice().reverse(), cHi, b, membId);
  }
}
// The coping family fac8Parapet picked for THIS building's street front, recomputed so the
// court's coping cannot disagree with it (fac8Parapet returns only the height).
function cy12CopingMemb(b) {
  const wLum = (0.3 * b.r + 0.59 * b.g + 0.11 * b.b) / 255;
  const cHash = (b.colorVar * 17.3) % 1;
  return cHash < 0.2 ? (cHash < 0.1 ? 4 : 2) : wLum > 0.52 ? 2 : 4;
}
// Point-in-court, for keeping rooftop plant out of the hole.
function cy12InCourt(holes, x, z) {
  for (const h of holes) {
    let inside = false;
    for (let i = 0, j = h.length - 1; i < h.length; j = i++) {
      if (((h[i][1] > z) !== (h[j][1] > z))
        && (x < ((h[j][0] - h[i][0]) * (z - h[i][1])) / (h[j][1] - h[i][1]) + h[i][0])) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

export async function assembleTile(key, arrayBuf, ctx) {
  const geoMark = geometryMark();   // SPACE r2 (world/cpuFree.js): the geometries this assembly makes have ids from here
  const tile = parseTile(arrayBuf);
  // OV39 (shared/overlay.js): the baked overlays (LF39, GF38) apply by the content key of the compiled tile, taken here
  // before any pass changes its sections (only for a tile that has an overlay entry)
  const lf39D = await lf39Load(), gf38I = await gf38Index().catch(() => null);
  const ckey = (lf39D && lf39D.tiles && lf39D.tiles[key]) || (gf38I && gf38I.tiles && gf38I.tiles[key]) ? tileContentKey(tile) : null;
  // LF39 (LOTFIX, world/lotfix39.js; `?lf39=0` none): the baked buildings, campus trees and lawn join the tile's sections
  // before anything below reads them
  try { lf39Apply(key, tile, arrayBuf.byteLength, lf39D, ckey); } catch (e) { console.warn('[lf39] apply', e); }
  const [ox, oz] = tile.header.origin;
  const gf38P = gf38Load(key, arrayBuf.byteLength, ckey).catch(() => null);   // GF38: the tile's baked fill (applied below)
  const group = new THREE.Group();
  group.name = 'tile_' + key;
  const claims = []; // [poolName, id]
  const vgPits = [];  // VG36 (GROUND, world/vg36Pits.js): the street trees on the flags, [x, y, z, rot, guarded 0 / 1, ...]
  const buf = new GeoBuf();
  const landmarkBuilds = [];
  const heroRecs = [];
  // TW (towers lane, city/tk/, world/towerKit.js): every tower over TOWER_H with the tiers its walls were extruded as (the
  // rings, heights and blind masks), so the tower kit rebuilds the walls on the same massing and the same v datum
  // The walls the kit replaces are drawn under their own hide slot, TW_BID + the building's index (a tile holds under 1,400
  // buildings, the slots are 65,536): the kit hides that slot and the tower's roofs, terrace parapets, crown and bulkheads
  // stay the tile's. The part below the ground keeps the building's own slot.
  const towerRecs = [];
  const twTiers = (tiers, y0b) => (bf, r, ya, yb, bb, o2) => {
    const store = !(o2 && o2.noStore) && (bb.flags & BF.STOREFRONT) && bb.storeH > 0;
    tiers.push({ ring: r, y0: Math.max(ya, y0b), y1: yb, blind: o2 && o2.blindMask !== undefined ? o2.blindMask : 0, store: !!store });
    const cut = Math.min(yb, y0b);   // the shopfront band too: the kit draws it (tkBuild.js retailFaceF)
    const saved = bf.curBid;
    if (cut > ya + 1e-3) extrudePrism(bf, r, ya, cut, bb, o2);
    bf.curBid = TW_BID + bb.i;
    if (yb > Math.max(ya, cut) + 1e-3) extrudePrism(bf, r, Math.max(ya, cut), yb, bb, o2);
    bf.curBid = saved;
  };
  // /TW
  const decalRecs = [];
  const doorAnchors = []; // per-building door position on its front edge (stoops slide to it)
  const skirtV = []; // ground-contact AO skirt verts: x,y,z,alpha

  // TP28: the Times Square plaza re-kinds this tile's asphalt before anything below samples or draws the sections
  let tpRoadsW = null;   // TF31: the same world-space roads again for the plaza's furniture, built with the meshes below
  if (tpTileHit(ox, oz)) {
    try {
      const rw = [...roadsOf(tile)].map((r) => ({
        ...r,
        pts: Array.from({ length: r.len }, (_, i) => [tile.S.roadVerts[(r.start + i) * 3] + ox, tile.S.roadVerts[(r.start + i) * 3 + 1], tile.S.roadVerts[(r.start + i) * 3 + 2] + oz]),
        name: tile.header.names[r.nameIdx] || '',
      }));
      tpRoadsW = rw;
      tpApply(tile, ox, oz, rw);
    } catch (e) { console.warn('tp28', e); }
  }
  // BP28: Bryant Park's gravel walks re-kinded out of its lawn, likewise before anything samples the ground
  try { bpApply(tile, ox, oz); } catch (e) { console.warn('bp28 walks', e); }
  // CP32: Central Park's water, ground cover, terrace and landmarks re-kind the tile's ground, likewise (city/centralPark.js)
  const CPT = cpTileHit(ox, oz);
  if (CPT) cpApply(tile, ox, oz);
  // AR32: the detailed areas (125th Street, Hunters Point: city/areas.js), likewise
  const ART = areaTileHit(ox, oz);
  if (ART) areaApply(tile, ox, oz);
  // ST38 (STATIONS2): the corners round the islands' noses that no section covers are paved at the road's level
  try { st38GapFill(tile); } catch (e) { console.warn('[st38] gap fill', e); }
  // GF38 (GROUNDFIX, city/groundFix38.js; `?gf38=0` none): what is still bare where the city's planimetric data has a walk,
  // a roadway, a median, a lot or a plaza is paved as that, with kerb faces where a walk meets the roadway
  try { gf38Apply(tile, await gf38P); } catch (e) { console.warn('[gf38] fill', e); }

  // tile terrain sampler (carved grid) for foundation depths
  const terrRes = tile.header.res, terrN = terrRes + 1, terrG = tile.S.terrain;
  const sampleT = (x, z) => {
    const fx = Math.min(terrRes - 0.001, Math.max(0, ((x - ox) / 512) * terrRes));
    const fz = Math.min(terrRes - 0.001, Math.max(0, ((z - oz) / 512) * terrRes));
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    return terrG[j * terrN + i] * (1 - u) * (1 - v) + terrG[j * terrN + i + 1] * u * (1 - v) + terrG[(j + 1) * terrN + i] * (1 - u) * v + terrG[(j + 1) * terrN + i + 1] * u * v;
  };

  // ---- SURFACE SAMPLER: the exact height of the top compiled surface at (x, z)
  //
  // The single cause of the "clips and empty spaces between the top textures and
  // the objects below them" is that nothing on the runtime side asked the ground
  // what height it actually is. The compiled stack (flat base plane, 2026-09-03)
  // is terrain 3.240 / asphalt 3.385 / gutter 3.385 / lawn 3.500 / sidewalk 3.520
  // / park path 3.540, but the runtime carried three DIFFERENT legacy datums:
  // `terrain + 0.305` (the AO skirt), the compiler's `terrain` (frontage
  // furniture) and `base - 0.60` (every building). Each one shows up as a gap
  // that the SSAO pass then paints a dark halo into.
  //
  // `surfY(x, z, kinds)` walks the tile's own ground triangles in priority order
  // and returns the first hit, so an object standing on the flags gets 3.520,
  // one on the roadway gets 3.385 and one on a lawn gets 3.500 — with real
  // terrain re-enabled it follows the relief for free. Hash built lazily per
  // section (4 m cells) so a tile whose furniture never leaves the sidewalk
  // pays for the sidewalk section only.
  const SURF = new Map();        // section name -> {a, H} spatial hash
  const surfCell = 4;
  const surfHash = (name) => {
    if (SURF.has(name)) return SURF.get(name);
    const a = tile.S[name];
    let rec = null;
    if (a && a.length >= 9) {
      const H = new Map();
      const nTri = Math.floor(a.length / 9);
      for (let t = 0; t < nTri; t++) {
        const o = t * 9;
        const x0 = a[o] + ox, z0 = a[o + 2] + oz, x1 = a[o + 3] + ox, z1 = a[o + 5] + oz, x2 = a[o + 6] + ox, z2 = a[o + 8] + oz;
        const i0 = Math.floor(Math.min(x0, x1, x2) / surfCell), i1 = Math.floor(Math.max(x0, x1, x2) / surfCell);
        const j0 = Math.floor(Math.min(z0, z1, z2) / surfCell), j1 = Math.floor(Math.max(z0, z1, z2) / surfCell);
        if ((i1 - i0) > 64 || (j1 - j0) > 64) continue;     // river-straddling overlay slivers
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const k = i + '_' + j;
          let arr = H.get(k); if (!arr) H.set(k, (arr = []));
          arr.push(t);
        }
      }
      rec = { a, H };
    }
    SURF.set(name, rec);
    return rec;
  };
  // one section: exact Y inside a triangle, else the nearest triangle's plane
  // if the point is within `tol` METRES of it. The tolerance has to be metric,
  // not barycentric: the contour pass emits the sidewalk band as slivers up to
  // 24 m long, and on those a barycentric 0.3 is seven metres of slop while on
  // a 1 m corner triangle it is 30 cm. `-l_i * 2A/|e_i|` converts the
  // barycentric overshoot on each edge into the real distance to that edge.
  // TL26: the campus lawn underlay compiles into its own section (grassU); every question about grass asks it too
  const sectionY = (name, x, z, tol) => {
    const y = sectionY0(name, x, z, tol);
    return y === null && name === 'grass' ? sectionY0('grassU', x, z, tol) : y;
  };
  const sectionY0 = (name, x, z, tol) => {
    const rec = surfHash(name);
    if (!rec) return null;
    const { a, H } = rec;
    const list = H.get(Math.floor(x / surfCell) + '_' + Math.floor(z / surfCell));
    if (!list) return null;
    let bestY = null, bestD = 1e9;
    for (const t of list) {
      const o = t * 9;
      const x0 = a[o] + ox, y0 = a[o + 1], z0 = a[o + 2] + oz;
      const x1 = a[o + 3] + ox, y1 = a[o + 4], z1 = a[o + 5] + oz;
      const x2 = a[o + 6] + ox, y2 = a[o + 7], z2 = a[o + 8] + oz;
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2);   // = 2 * signed area
      if (Math.abs(d) < 1e-9) continue;
      const l0 = ((z1 - z2) * (x - x2) + (x2 - x1) * (z - z2)) / d;
      const l1 = ((z2 - z0) * (x - x2) + (x0 - x2) * (z - z2)) / d;
      const l2 = 1 - l0 - l1;
      let out = 0;                                              // metres outside the triangle
      if (l0 < 0) out = Math.max(out, -l0 * Math.abs(d) / Math.hypot(x1 - x2, z1 - z2));
      if (l1 < 0) out = Math.max(out, -l1 * Math.abs(d) / Math.hypot(x2 - x0, z2 - z0));
      if (l2 < 0) out = Math.max(out, -l2 * Math.abs(d) / Math.hypot(x0 - x1, z0 - z1));
      if (out < bestD) {
        bestD = out; bestY = l0 * y0 + l1 * y1 + l2 * y2;
        // SY33 (docs/notes/central-park-fix.md): outside the triangle its plane is extrapolated, and a sliver's plane is
        // unbounded (surfaceAt answered 115.6 m and -1864 m next to Central Park's clipped slivers): keep an outside
        // answer to the triangle's own heights
        if (out > 0) bestY = Math.min(Math.max(y0, y1, y2), Math.max(Math.min(y0, y1, y2), bestY));
      }
      if (bestD === 0) break;
    }
    return bestD <= tol ? bestY : null;
  };
  // priority order: what would a person standing here be standing ON?
  const WALK_KINDS = ['sidewalk', 'path', 'brick', 'plaza', 'gravel'];   // gravel: BP28's walks (city/bryantPark.js)
  const ROAD_KINDS = ['gutter', 'busred', 'asphalt'];
  const surfY = (x, z, kinds, tol) => {
    for (const k of kinds) { const y = sectionY(k, x, z, tol); if (y !== null) return y; }
    return null;
  };
  // the pavement / lawn / roadway an object at (x, z) rests on, or null.
  const padYAt = (x, z, tol = 0.35) => {
    const w = surfY(x, z, WALK_KINDS, tol); if (w !== null) return w;
    const g = sectionY('grass', x, z, tol); if (g !== null) return g;
    const r = surfY(x, z, ROAD_KINDS, tol); if (r !== null) return r;
    return null;
  };
  // …and the same question for something whose exact point may sit on a patch
  // the compiler left bare (no pavement polygon reaches the wall / the lot is a
  // rear yard). Ask a 1.2 m ring and take the HIGHEST pavement found, so a
  // stoop against a bare strip lands level with the flags two metres away
  // rather than in a dirt hollow. Falls back to the compiler's own lot grade
  // (terrain + 0.28) so the answer is never null.
  const RING8 = [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2], [0.85, 0.85], [-0.85, 0.85], [0.85, -0.85], [-0.85, -0.85]];
  const padYNear = (x, z) => {
    const at = padYAt(x, z); if (at !== null) return at;
    let best = null;
    for (const [dx2, dz2] of RING8) {
      const y = padYAt(x + dx2, z + dz2);
      if (y !== null && (best === null || y > best)) best = y;
    }
    return best !== null ? best : sampleT(x, z) + 0.28;
  };
  // median of the pavement height around a footprint's edge midpoints — the
  // datum a building's ground floor must start at.
  const padUnderRing = (ring) => {
    const hits = [];
    const n = ring.length;
    let probes = 0;
    for (let i = 0; i < n && probes < 8 && hits.length < 5; i++) {
      const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
      const ex = bx - ax, ez = bz - az;
      const L = Math.hypot(ex, ez);
      if (L < 0.5) continue;
      const nx = ez / L, nz = -ex / L;                     // exterior normal
      const px = ax + ex * 0.5, pz = az + ez * 0.5;
      probes++;
      // 0.6 m outside the wall: the sidewalk polygon stops at the lot line
      const y = padYAt(px + nx * 0.6, pz + nz * 0.6, 0.6);
      if (y !== null) hits.push(y);
    }
    if (!hits.length) return null;
    hits.sort((p, q) => p - q);
    return hits[hits.length >> 1];
  };
  // WHAT is under (x, z), not just how high. The height alone cannot tell a
  // lawn from a traffic lane, and two sims now need the difference: the parked
  // fleet must not stand on grass (a gold sedan has been parked on the Bryant
  // Park lawn in the critic's worst frame since round 1) and the pedestrian
  // graph must not run down the middle of the carriageway (26.8 % of its
  // vertices did). Published on the tile record as `surfaceInfo`.
  // GT26 (sims, 2026-09-25): the TOP surface. Planting beds (the Lenox malls, campus beds, park path ends) compile as a
  // grass section laid 5-10 cm OVER a sidewalk section, and the pavement-first answer let walkers stand on the beds
  // with their feet under the drawn grass. Where a grass (or campus underlay) triangle covers the point and lies above
  // the pavement found, the answer is the grass and its height. `?gtop=0`: pavement first, as before.
  const GTOP = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gtop') === '0');
  const grassOver = (x, z, y) => {
    if (!GTOP) return null;
    const g = sectionY('grass', x, z, 0.02);
    return g !== null && g > y + 0.01 ? g : null;
  };
  const surfaceKindAt = (x, z, tol = 0.35) => {
    for (const k of WALK_KINDS) {
      const y = sectionY(k, x, z, tol);
      if (y !== null) { const g = grassOver(x, z, y); return g !== null ? { kind: 'grass', y: g, road: false } : { kind: k, y, road: false }; }
    }
    const g = sectionY('grass', x, z, tol); if (g !== null) return { kind: 'grass', y: g, road: false };
    for (const k of ROAD_KINDS) { const y = sectionY(k, x, z, tol); if (y !== null) return { kind: k, y, road: true }; }
    return null;
  };
  // Is this footprint WHOLLY inside the carriageway? Then it is data noise, not
  // a building. At 5th Ave & W 42nd, (-859.5, 3279.6), a 7.3 x 6.2 m x 6.9 m
  // brick prism with one window stands in the traffic lanes; it has been "the
  // single most jarring object in any of my frames" for three critic rounds
  // (R2 #10, R3 #6). Measured over 98 Manhattan tiles it is the ONLY such
  // footprint in 40 115 small non-landmark buildings, so the test is
  // deliberately narrow — small, unlisted, centroid on asphalt and every corner
  // still on asphalt when pulled 15 % toward the centre. Also reported to the
  // compiler (docs/notes/seams.md R2.7): the parcel itself is wrong.
  const roadOnly = (x, z, tol) => {
    if (surfY(x, z, ROAD_KINDS, tol) === null) return false;             // cheap reject: ~all buildings
    return surfY(x, z, WALK_KINDS, tol) === null && sectionY('grass', x, z, tol) === null;
  };
  // THE MAST ARM MUST REACH OVER THE TRAVEL LANES. `furnitureKit` builds the
  // signal mast with its 4.05 m curved arm along local +Z, so after `rot` the
  // main head hangs at (sin rot, cos rot) * 4.05. NYC hangs it over the
  // carriageway; in the production tiles 6 of 11 masts point theirs ALONG the
  // pavement instead, which parks three yellow-backplated heads 5.8 m up over
  // the flags, above the street's sightline and against the building line —
  // why critic round 3 "could not find a single signal head in ten eye-level
  // frames". Keep the compiler's bearing whenever it already reaches the road;
  // otherwise take the NEAREST bearing that does, in 15 degree steps, so the
  // mast still faces roughly the approach the compiler chose.
  const ARM_REACH = 4.05;
  const armOverRoad = (x, z, rot) => {
    const tipOnRoad = (r) => {
      const tx = x + Math.sin(r) * ARM_REACH, tz = z + Math.cos(r) * ARM_REACH;
      return surfY(tx, tz, ROAD_KINDS, 0.2) !== null && surfY(tx, tz, WALK_KINDS, 0.2) === null;
    };
    if (tipOnRoad(rot)) return rot;
    for (let s = 1; s <= 12; s++) {
      const d = s * (Math.PI / 12);
      if (tipOnRoad(rot + d)) return rot + d;
      if (tipOnRoad(rot - d)) return rot - d;
    }
    return rot;
  };
  // SG13 (docs/notes/signals-r13.md). Two things the old placement could not do.
  //
  // (1) AIM. `f.rot` is NOT a heading. compile.mjs stores
  // `bis + PI` where `bis = atan2(cpz - nz, cpx - nx)` — a MATH angle, while the
  // instancer reads rot as a THREE yaw (local +Z -> (sin, cos)). The two differ
  // by a mirror, not a rotation, so the compiler's bearing has never survived
  // the trip; armOverRoad only papered over it by rotating until the tip landed
  // on asphalt. As a DIRECTION it is still exact, and that is all the aim needs:
  // (cos rot, sin rot) points from the corner at the node. A mast arm crosses
  // the approach it serves, so the arm sits ~45 deg off that bisector and the
  // HEADS look along the road AWAY from the node — at the drivers who have to
  // stop. (The old kit aimed the head back down the arm, i.e. across the
  // traffic: every mast head was turned 90 deg from its own approach.)
  //
  // (2) REACH. `p0` is the crossed street width the compiler already ships
  // (compile.mjs FURN.SIGNAL_MAST). Nothing read it, so a 9 m side street and an
  // 18 m avenue shared one 4.05 m arm.
  const sgRoad = (px, pz) => surfY(px, pz, ROAD_KINDS, 0.2) !== null && surfY(px, pz, WALK_KINDS, 0.2) === null;
  const sgReach = (p0) => Math.max(3.6, Math.min(7.4, 1.8 + 0.30 * (p0 || 12)));
  const sgArmAim = (x, z, rot0, reach) => {
    const nx = Math.cos(rot0), nz = Math.sin(rot0);            // corner -> node
    let best = null;
    for (const base of [Math.atan2(nx, nz) + Math.PI / 4, Math.atan2(nx, nz) - Math.PI / 4]) {
      for (let s = 0; s <= 6; s++) {
        for (const sg of (s === 0 ? [1] : [1, -1])) {
          const r = base + sg * s * (Math.PI / 18);
          const ax = Math.sin(r), az = Math.cos(r);
          const tx = x + ax * reach, tz = z + az * reach;
          if (!sgRoad(tx, tz)) continue;
          let hx = -az, hz = ax;                               // perpendicular to the arm...
          if (hx * nx + hz * nz > 0) { hx = -hx; hz = -hz; }   // ...pointing away from the node
          let score = 0;
          for (const d of [7, 14, 22]) if (sgRoad(tx + hx * d, tz + hz * d)) score++;
          if (!best || score > best.score) best = { rot: r, head: Math.atan2(hx, hz), score };
          if (score === 3) return best;                        // a clear approach: take it
        }
      }
    }
    return best || { rot: Math.atan2(nx, nz), head: Math.atan2(-nz, nx), score: -1 };
  };
  // A pedestrian head is read from the FAR side of the crossing, so it faces
  // across the roadway. Both crosswalks at a corner run ~45 deg off the
  // bisector; take whichever one is unbroken asphalt for 13 m.
  const sgPedAim = (x, z, rot0) => {
    const nx = Math.cos(rot0), nz = Math.sin(rot0);
    let best = null;
    for (const base of [Math.atan2(nx, nz) + Math.PI / 4, Math.atan2(nx, nz) - Math.PI / 4]) {
      for (let s = 0; s <= 4; s++) {
        for (const sg of (s === 0 ? [1] : [1, -1])) {
          const r = base + sg * s * (Math.PI / 24);
          const dx = Math.sin(r), dz = Math.cos(r);
          let score = 0;
          for (const d of [4, 8, 13]) if (sgRoad(x + dx * d, z + dz * d)) score++;
          if (score === 3) return r;
          if (!best || score > best.score) best = { rot: r, score };
        }
      }
    }
    return best ? best.rot : Math.atan2(nx, nz);
  };
  let culledOnRoad = 0;                      // reported on the tile record
  const onCarriageway = (ring, cx, cz) => {
    if (!roadOnly(cx, cz, 0.1)) return false;
    for (const [x, z] of ring) {
      if (!roadOnly(x + (cx - x) * 0.15, z + (cz - z) * 0.15, 0.6)) return false;
    }
    return true;
  };

  // ROOF9: elect the cell-site host per block — the tallest roof in each 110 m
  // cell. Keyed on ABSOLUTE world coordinates so the grid is stable as tiles
  // stream, but the election runs per TILE, so a block lying across a tile
  // seam can carry two sites. (The alternative is a cross-tile registry in the
  // streamer, which is not worth a second mast per ~500 m of city.)
  const blockTop = new Map();
  const cellKey = (x, z) => Math.floor(x / 110) + '_' + Math.floor(z / 110);
  if (ROOF9) {
    for (const b of buildingsOf(tile)) {
      if (b.height <= 8 || b.landmarkId) continue;
      const k2 = cellKey(tile.S.bldgXZ[b.start * 2] + ox, tile.S.bldgXZ[b.start * 2 + 1] + oz);
      const cur = blockTop.get(k2);
      if (!cur || b.height > cur.h) blockTop.set(k2, { h: b.height, i: b.i });
    }
  }
  // ======================================================== R12 PER-BLOCK DEALER
  // docs/notes/silhouette-r12.md §3.4. Every per-building choice in this project
  // is an INDEPENDENT DRAW off one byte (colorVar): the wall family is
  // `hash1(cv*511,3)`, the parapet `(cv*7.7)%1`, the coping `(cv*17.3)%1`, the
  // roof template `mulberry(colorVar ^ ring[0])`. Independent draws collide with
  // probability 1/N, and `RECIPES[TENEMENT].mats` has N = 3 — so a THIRD of all
  // adjacent tenement pairs in Harlem draw the same brick family, which is the
  // "run of identical modules" the blind packs keep naming.
  //
  // uniformity-r10 §6 proved the fix on the shop-sign roster and the argument is
  // the same here: a hash can only make a repeat UNLIKELY; a bijection over an
  // ORDINAL makes it impossible. So give every building an ordinal along its
  // block and let the dealt attributes be functions of that ordinal.
  //
  // The ordinal: bucket by a 55 m cell (about one Manhattan block face), sort by
  // the DIAGONAL projection x + z, rank 0,1,2,... Manhattan's grid runs ~29 deg
  // off true north, so a 6 m rowhouse frontage moves (x+z) by 6*(cos29+sin29) =
  // 8.1 m and an 18 m street crossing moves it by 7.0 m: both axes separate
  // cleanly under one projection, and no grid angle has to be assumed. Ties
  // (two buildings at the same projection, e.g. front and rear of one lot) break
  // on the record index so the rank is stable across reloads.
  //
  // KNOWN LIMIT, stated because roofs-r9 §3d hit the identical one: the pass runs
  // per TILE, so a block lying across a tile seam restarts its rank and the two
  // buildings either side of the seam can repeat. That is one pair per ~500 m of
  // city against a third of all pairs today.
  const deals = new Map();
  if (R12) {
    const cellD = (x, z) => Math.floor(x / 55) + "_" + Math.floor(z / 55);
    const byCell = new Map();
    for (const b of buildingsOf(tile)) {
      const bx = tile.S.bldgXZ[b.start * 2] + ox, bz = tile.S.bldgXZ[b.start * 2 + 1] + oz;
      const k2 = cellD(bx, bz);
      let a = byCell.get(k2); if (!a) byCell.set(k2, a = []);
      a.push([bx + bz, b.i]);
    }
    for (const [k2, arr] of byCell) {
      arr.sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
      // the block's own phase, so two blocks do not deal the same sequence
      const ph = Math.floor(((Math.sin(k2.length * 3.1 + arr[0][0] * 0.017) * 43758.5453) % 1 + 1) * 8) % 8;
      for (let r = 0; r < arr.length; r++) deals.set(arr[r][1], r + ph);
    }
  }
  // ROOF9: AABBs of this tile's RETAIL_MODERN buildings, for the awning
  // suppression in the furniture loop below.
  const rm9 = [];
  // CY12: this tile's enclosed light courts, parent building index -> court records. An
  // old tile has no `bholes` section and gets an empty Map, so everything below stays solid.
  const cyMap = CY12 ? holesOf(tile) : new Map();
  let cyCourts = 0, cyDropped = 0;            // realised / dropped by a massing branch, reported on the tile record
  let fpPents = 0;                            // FP18: penthouse storeys drawn (towers and the mid-rise), on the tile record
  for (const b of buildingsOf(tile)) {
    buf.curBid = b.i;
    b.greenRoof = !!(b.roofKind & 128);
    b.hasSolar = !!(b.roofKind & 64);
    b.hasTank = !!(b.roofKind & 32);
    b.membrane = (b.roofKind >> 3) & 3; // 0 silver, 1 dark, 2 gravel, 3 pavers
    b.roofKind = b.roofKind & 7;        // shape only, for massing logic
    if (FAC8) { fac8Palette(b); b.fmemb = b.greenRoof ? 5 : fac8Membrane(b); }
    // R12: the dealt ordinal for this building (see the dealer pass above).
    // -1 means "no deal" and every consumer falls back to its round-11 hash.
    b.__deal = R12 ? (deals.has(b.i) ? deals.get(b.i) : -1) : -1;
    // world-space ring
    const ring = [];
    for (let i = 0; i < b.len; i++) {
      ring.push([tile.S.bldgXZ[(b.start + i) * 2] + ox, tile.S.bldgXZ[(b.start + i) * 2 + 1] + oz]);
    }
    // CY12: and this building's enclosed light courts, in the same world space. They live
    // in bldgXZ PAST the outer ring, addressed only through the `bholes` sidecar, which is
    // why `b.start`/`b.len` above still describe the outer ring alone and the 44-byte
    // record never changed. They arrive wound CW (opposite the outer ring) and stay that
    // way: earcut wants that winding for a hole and extrudePrism wants it for a wall that
    // faces into the court. `holes` is emptied by whichever massing branch cannot take one.
    let holes = [];
    for (const h of cyMap.get(b.i) || []) {
      const hr = [];
      for (let i = 0; i < h.len; i++) hr.push([tile.S.bldgXZ[(h.start + i) * 2] + ox, tile.S.bldgXZ[(h.start + i) * 2 + 1] + oz]);
      if (hr.length >= 3) holes.push(hr);
    }
    const cyDrop = () => { if (holes.length) { cyDropped += holes.length; holes = []; } };
    let cx = 0, cz = 0;
    for (const [x, z] of ring) { cx += x; cz += z; }
    cx /= ring.length; cz /= ring.length;
    // a footprint that lies entirely in the traffic lanes is not a building
    if (!NO_DATUM && !b.landmarkId && b.area <= 200 && onCarriageway(ring, cx, cz)) { culledOnRoad++; cyDrop(); continue; }   // CY12: a footprint that is not a building has no courts
    if (tpSkipBuilding(cx, cz, b.height, b.area) || bpSkipBuilding(cx, cz, b.height, b.area) || (CPT && cpSkipBuilding(cx, cz, b.height, b.area)) || (ART && areaSkipBuilding(cx, cz, b.height, b.area))) { cyDrop(); continue; }   // TP28: the TKTS booth (the red steps stand there) and the kiosk box on the Duffy Square plaza
    // foundation: walls extend down to below the lowest terrain under the footprint,
    // shader renders the below-grade band (v<0) as a stone/brick foundation course
    let minT = 1e9;
    for (const [x, z] of ring) minT = Math.min(minT, sampleT(x, z));
    // GROUND FLOOR DATUM. The compiler serializes `baseY = max(groundY - 0.4,
    // b.base - 0.6)` to bury the footing on a slope (compile.mjs:1437), so on
    // the flat base plane every building record arrives at 2.920 while the flags
    // it stands on are at 3.520 — 60 cm low. The walls are extruded from `fndY`
    // so nobody saw the base, but EVERYTHING referenced off `baseY` was 60 cm
    // low with it: the storefront bulkhead (0.02..0.5) sat entirely below the
    // pavement, entrance doors were buried to the knee, the dresser's roof deck
    // and every wall decal came down with them. Ask the ground instead: the
    // median pavement height around the footprint, clamped so a bad sample can
    // never move a building (and never a landmark, which carries its own pads).
    if (CPT) { const dy = cpLift(cx, cz); if (dy) b.baseY += dy; }   // CP32: the park's relief under its compiled buildings
    let y0 = b.baseY;
    if (!b.landmarkId && !NO_DATUM) {
      const padY = padUnderRing(ring);
      const want = padY !== null ? padY : sampleT(cx, cz) + 0.28;   // 0.28 = the compiler's lot lift
      if (want > b.baseY && want - b.baseY < 1.2) y0 = want;
    }
    b.baseY = y0;                                          // decals / hero recs / roof all read this
    const topY = y0 + b.height;
    const fndY = Math.min(y0, Math.max(minT - 1.0, y0 - 6));

    // collider prism (full height)
    let minX = 1e9, minZ = 1e9, maxX = -1e9, maxZ = -1e9;
    const flatPts = new Float32Array(ring.length * 2);
    ring.forEach(([x, z], i) => {
      flatPts[i * 2] = x; flatPts[i * 2 + 1] = z;
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    });
    COLLIDERS.addPrism(key, { pts: flatPts, minX, minZ, maxX, maxZ, y0: y0 - 2, y1: topY });

    // landmark replace?
    const lmId = b.landmarkId;
    if (lmId > 0 && ctx.landmarks) {
      const spec = LM_BY_ID.get(lmId);
      if (spec) {
        landmarkBuilds.push({ spec, ring, cx, cz, b, groundY: y0 });
        cyDrop();  // CY12: a landmark's hand-built massing owns its own courts
        continue; // custom massing replaces extrusion
      }
    }

    if (b.frontIdx >= 0 && b.height > 4) decalRecs.push({ ring, frontIdx: b.frontIdx, baseY: b.baseY, storeH: b.storeH, height: b.height, colorVar: b.colorVar, style: b.style, store: (b.flags & 8) !== 0 });
    const door = pickDoor(b, ring);
    if (door.doorI >= 0) {
      // where the facade puts the door on this edge (same bay maths as nycDress):
      // the compiler drops the stoop at the frontage MIDPOINT, the runtime slides
      // it here so the flight meets the door (review R3 #3)
      const A = ring[door.doorI], B2 = ring[(door.doorI + 1) % ring.length];
      const len = Math.hypot(B2[0] - A[0], B2[1] - A[1]);
      // the DRESSER's bay width (nycDress.js: ww = max(1.4, winW || 2.6)) — the anchor used max(0.8,
      // winW), so on narrow-bay brownstones the stoop slid to a different bay than the dressed door
      // ("stairs don't connect to the doors", owner 2026-09-11)
      const ww = Math.max(1.4, b.winW || 2.6), bayN = Math.floor((len - 0.44) / ww), sideM = (len - bayN * ww) / 2;
      const bay = Math.floor(door.doorPack / 8) - 1;
      const uD = Math.min(len - 1.0, Math.max(1.0, sideM + (bay + 0.5) * ww));
      // a storefront on the door wall means the dresser draws no parlour door there (the shop takes the
      // ground floor) — the stoop would climb to a blank wall, so it is dropped at placement
      const store = (b.flags & 8) !== 0 && (b.storeH || 0) > 0;
      doorAnchors.push({ mx: (A[0] + B2[0]) / 2, mz: (A[1] + B2[1]) / 2, dx: A[0] + ((B2[0] - A[0]) * uD) / len, dz: A[1] + ((B2[1] - A[1]) * uD) / len, store, sty: b.style });   // WB13: sty -> the stoop's height class
    }
    const opts = { blindMask: b.blind, baseRef: y0, doorI: door.doorI, doorPack: door.doorPack };
    let convexish = false;
    if (b.flags & BF.SETBACKS) {
      const obbT = ringOBB(ring);
      convexish = b.area / Math.max(1, obbT.w * obbT.h) > 0.72;
    }
    let heroTop = b.height;
    let towerCap = null;                  // {roofRing, roofY, areaF} from towers.js
    // CH14d (2026-09-22): the 49 m Columbia hall at 120th & Amsterdam (flags 18 = SETBACKS|CORNICE, roofKind 2) took this
    // wedding-cake path and its crown cap — the "white slab with a smooth bump" of critic r14 — before the hip branches
    // below could see it. A campus hall with a compiler hip (kind 2 copper / 3 slate) is never a zoning tower.
    if ((b.flags & BF.SETBACKS) && convexish && b.height > 40 && b.area > 300 && !(CH14 && (b.roofKind === 2 || b.roofKind === 3))) {
      // CY12: a setback tower drops its courts. Every tier above the first is an INSET of
      // this ring, so the court would be lidded by the second tier's deck whatever we did
      // down here — and `convexish` already required the footprint to fill 72 % of its OBB,
      // which a deep donut does not.
      cyDrop();
      // ===== SKYSCRAPER PASS (docs/notes/skyscrapers.md): 1916-zoning wedding
      // cake. Was three tiers at fixed 0.74/0.52 centroid scales; now 2-4 tiers
      // stepping back a fixed number of METRES with terrace decks and parapets,
      // capped by the era's crown.
      let topRing;
      if (NO_TOWER) {   // legacy: 3 tiers at 0.55/0.8 of height, 0.74/0.52 scales
        heroTop = b.height * 0.55;
        const t1 = y0 + b.height * 0.55, t2 = y0 + b.height * 0.8;
        extrudePrism(buf, ring, fndY, t1, b, opts);
        roofFill(buf, ring, t1, b);
        const r2 = ringInset(ring, 0.74, cx, cz);
        extrudePrism(buf, r2, t1, t2, b, { baseRef: y0 });
        roofFill(buf, r2, t2, b);
        topRing = ringInset(ring, 0.52, cx, cz);
        extrudePrism(buf, topRing, t2, topY, b, { baseRef: y0 });
        roofFill(buf, topRing, topY, b);
      } else {
        heroTop = b.height * 0.42;
        const twT = [];   // TW: the tiers, for the tower kit
        const set = buildSetbacks(buf, ring, cx, cz, y0, topY, b, { ...opts, fndY }, b.height > TOWER_H && !(lmId > 0) ? twTiers(twT, y0) : extrudePrism);
        if (twT.length) b.__twTiers = twT;   // TW
        topRing = set.top;
        towerCap = buildTower(buf, set.top, cx, cz, y0, topY, b);
      }
      COLLIDERS.addPrism(key, ((r) => {
        const p = new Float32Array(r.length * 2);
        let mx = 1e9, mz = 1e9, Mx = -1e9, Mz = -1e9;
        r.forEach(([x, z], i) => { p[i * 2] = x; p[i * 2 + 1] = z; mx = Math.min(mx, x); Mx = Math.max(Mx, x); mz = Math.min(mz, z); Mz = Math.max(Mz, z); });
        return { pts: p, minX: mx, minZ: mz, maxX: Mx, maxZ: Mz, y0: y0 + b.height * 0.34, y1: y0 + b.height };
      })(topRing));
    } else {
      // hip roofs span the ring's OBB — on L/U-shaped footprints that slab
      // hangs over the courtyard notch with nothing below it. Only rings that
      // essentially FILL their OBB may take a hip; the rest get flat+parapet.
      const obbR = ringOBB(ring);
      // CY12: `rectness` is a LIE on a donut. `b.area` is the outer ring's area and does
      // not subtract the court, so a courted block scores HIGH here — high enough to claim
      // a hip and cap its own courts with a slab. Every sloped-roof branch below therefore
      // also requires `!holes.length`, and a courted footprint falls through to flat.
      const rectness = b.area / Math.max(1, obbR.w * obbR.h);
      if (b.roofKind === 1 && b.area < 1600 && rectness > 0.78 && !holes.length) {
        // church: nave walls + hip roof over OBB
        heroTop = b.height * 0.6;
        const wallTop = y0 + b.height * 0.66;
        extrudePrism(buf, ring, fndY, wallTop, b, opts);
        roofFill(buf, ring, wallTop, b);
        hipRoof(buf, ring, wallTop, b, [b.r / 255 * 0.5, b.g / 255 * 0.5, b.b / 255 * 0.52], cx, cz, 0.98, 0.3, CR24 ? 6 : 0);   // CR24: slate, not a membrane
      // R12: the mansard is the ONE non-flat roof New York actually has on a mid-block
      // pre-war building, and at 12 % of three styles it appeared about once per two
      // blocks. Second Empire brownstone rows (STYLE.ROWHOUSE) carry them too — 1870s
      // Harlem and Morningside are full of them — and a mansard on the record's own
      // terms is still gated the same way: rectangular footprint, no compiler roofKind,
      // and a height band a mansard makes sense in. Rate 0.12 -> 0.19, rowhouses at
      // 0.10 because a mansarded row is a minority of any row.
      // WB13: ...and the FALSE MANSARD, which docs/typology/08-vinyl-rowhouse.md §1.3
      // calls "the single biggest Queens/Brooklyn remuddle tell" — a shingled or vinyl
      // apron bolted over the front of a flat roof, 1.22-2.44 m tall (modal 1.52),
      // probability 0.18 overall and 0.12 in the Brooklyn frame belt. The geometry this
      // branch already builds IS that apron; it only needed the style, a height floor a
      // two-storey house clears, and a SHALLOWER band — 2.3 m of it on a 7 m house is a
      // third of the elevation, where 1.5 m is what the tape measure says.
      } else if (!b.greenRoof && (b.style === 1 || b.style === 4 || b.style === 8 || (R12 && b.style === 5)
            || (WB13 && b.style === STYLE.FRAME_HOUSE))
          && b.height > (WB13 && b.style === STYLE.FRAME_HOUSE ? 6.5 : R12 && b.style === 5 ? 9 : 14) && b.height < 46
          && rectness > 0.62 && !b.roofKind && !holes.length   // CY12: not over a light court
          && ((b.colorVar * 13.7) % 1) < (WB13 && b.style === STYLE.FRAME_HOUSE ? 0.12 : R12 ? (b.style === 5 ? 0.10 : 0.19) : 0.12)) {
        // MANSARD cap: prewar/deco/civic slice — steep slate band from the
        // wall line to an inset flat crown (the missing non-flat NYC roof)
        const mnD = WB13 && b.style === STYLE.FRAME_HOUSE ? 1.5 : 2.3;   // WB13: apron depth
        heroTop = b.height - mnD;
        const wallTop = topY - mnD;
        extrudePrism(buf, ring, fndY, wallTop, b, opts);
        const rIn = ringInset(ring, 0.8, cx, cz);
        const slate = [0.16, 0.17, 0.19];
        for (let i2 = 0; i2 < ring.length; i2++) {
          const [x1, z1] = ring[i2], [x2, z2] = ring[(i2 + 1) % ring.length];
          const [ix1, iz1] = rIn[i2], [ix2, iz2] = rIn[(i2 + 1) % ring.length];
          const ex2 = x2 - x1, ez2 = z2 - z1;
          const eL = Math.hypot(ex2, ez2) || 1;
          const nx2 = ez2 / eL, nz2 = -ex2 / eL;
          buf.quad([x1, wallTop, z1], [ix1, topY, iz1], [ix2, topY, iz2], [x2, wallTop, z2],
            [nx2 * 0.72, 0.7, nz2 * 0.72], slate, [0, 0, 0, 0, 0, 0, 0, 0],
            [b.floorH, b.winW, 6, b.style], [b.height, b.lit, b.colorVar, 4]);
        }
        roofFill(buf, rIn, topY, b);
        b.__roofRing = rIn;
      } else {
        // ROOF9 brief C: the modern-retail facade replaces the body extrusion
        // only — the roof fill, the parapet and the rooftop engine below are
        // shared with every other flat-roofed building.
        // CR24: a campus roof (compiler roofKind 2, or a BUILDING_OVERRIDES `roof`) owns the top storey: walls to the eave
        const crP = crPlan(b, ring, holes, topY);
        if (crP) {
          heroTop = crP.eaveY - y0;
          extrudePrism(buf, ring, fndY, crP.eaveY, b, opts);
          crBuild(buf, ring, b, crP, cx, cz, y0);
        } else if (ROOF9 && b.style === STYLE.RETAIL_MODERN && b.height > 6 && b.storeH > 2) {
          retailModern(buf, ring, cx, cz, fndY, y0, topY, b, opts);
        } else if (b.height > TOWER_H && !(lmId > 0) && !NO_TOWER) {   // TW: the tower kit's tier (the walls as ever; decorate landmarks too)
          const twT = [];
          // FP18: a pre-war tower's penthouse storey on its terrace (fp18Pent), the kit's last tier
          b.__fpPent = null;
          const pn = !lmId && !b.roofKind ? fp18Pent(b, ring, y0) : null;
          if (pn) {
            const set = buildSetbacks(buf, ring, cx, cz, y0, topY, b, { ...opts, fndY, pentY: pn.y, pentStep: pn.step }, twTiers(twT, y0));
            if (set.top !== ring && twT.length === 2) { twT[1].pent = true; b.__fpPent = set.top; fpPents++; }
          } else twTiers(twT, y0)(buf, ring, fndY, topY, b, opts);
          b.__twTiers = twT;
        } else extrudePrism(buf, ring, fndY, topY, b, opts);
        if (crP) {
          // CR24 built the whole roof above
        } else if ((b.roofKind === 2 || (CH14 && b.roofKind === 3)) && rectness > 0.78 && !holes.length) {   // CY12: not over a light court; CH14b: 3 = slate
          // campus copper hip roof (rectangular halls only) — weathered verdigris,
          // muted gray-green; the shader keep-color path brightens it ~1.15x in sun
          roofFill(buf, ring, topY, b);
          hipRoof(buf, ring, topY, b, hipLook(b).col, cx, cz, 0.9, hipLook(b).riseK, hipLook(b).memb);
        } else if (CH14 && (b.roofKind === 2 || b.roofKind === 3) && !holes.length && b.height < 60 && b.area > 350   // CH14c: 60, not 42 — the 49 m concave hall fell to the tower crown (a dome cap)
            && campusHipWings(buf, ring, topY, b, hipLook(b).col, cx, cz, hipLook(b).riseK)) {
          // CH14: the concave McKim hall — a copper hip over each rectangular wing (campusHipWings above). The
          // deck is filled AFTER the hips so a wing-less result (returns 0) falls through to the flat branch instead.
          roofFill(buf, ring, topY, b);
        } else if (b.height > TOWER_H && !lmId && !NO_TOWER) {
          // ===== SKYSCRAPER PASS: over 45 m the roof IS the silhouette. A deep
          // parapet + coping, a mechanical bulkhead, an era-specific crown and,
          // on the tallest, a mast — all merged into this tile's own facade
          // mesh, so the whole crown costs triangles and no draw call.
          // CY12: over 45 m the crown wins and the courts go. buildTower's own `cap()`
          // (towers.js:349) fills the WHOLE footprint at topY, so a courted tower would be
          // lidded whatever we emitted here; towers.js belongs to the silhouette owner this
          // round, so this is a deliberate scope line, counted in `cyDropped`.
          cyDrop();
          towerCap = b.__fpPent ? buildTower(buf, b.__fpPent, cx, cz, y0, topY, b, { kind: 'flat' })   // FP18: the penthouse's roof
            : buildTower(buf, ring, cx, cz, y0, topY, b);
          b.__roofRing = towerCap.roofRing;
        } else {
          // CY12 — THE COURT ITSELF. Walls first (they are the facade the deck's hole
          // looks down), then the floor at the bottom of the shaft, then the deck is
          // earcut WITH the courts as holes, then the court's own parapet at the top.
          if (holes.length) {
            cyCourts += holes.length;
            // …under the SENTINEL BID. `aBid` exists for exactly one thing (materials.js
            // :725): a lookup into the per-tile hide texture, which nycDress sets to 255
            // for a building it has rebuilt so the tile's own facade for it is discarded.
            // The dresser only ever rebuilds the OUTER ring, so hiding this building
            // would take the court walls with it and leave a lidded solid block inside
            // the dresser's 150 m radius. The hide texture is 256x256 = 65536 slots
            // indexed by building ordinal and a tile holds a few hundred buildings, so
            // 65535 is a bid the dresser can never write: court geometry is unhideable.
            buf.curBid = CY_BID;
            cy12CourtWalls(buf, holes, fndY, topY, b, y0);
            cy12CourtFloor(buf, holes, y0 + 0.02, b);
            buf.curBid = b.i;
          }
          roofFill(buf, ring, topY, b, false, -1, holes);
          // parapet lip
          // FAC8: > 3.2 m, not > 6 m. A one-storey taxpayer on 125th St has a
          // parapet and a coping too — it is what hides its roof plant from the
          // street and what draws the block's roofline. `ref_lenox.png` has no
          // flat roof in frame without one; ours had a knife edge under 6 m.
          if (b.height > (FAC8 ? 3.2 : 6)) {
            if (FAC8) {
              b.__parapetH = b.area > 26 ? fac8Parapet(buf, ring, cx, cz, topY, b, y0) : 0;
            } else {
              const rp = ringInset(ring, 0.985, cx, cz);
              const ph = 0.55 + ((b.colorVar * 7.7) % 1) * 0.6; // parapet height varies per building
              extrudePrism(buf, rp, topY, topY + ph, b, { baseRef: y0, noStore: true, blindMask: 0xffffffff });
              roofFill(buf, rp, topY + ph, b, false, -1, holes);   // CY12: the legacy lid keeps the courts open too
            }
          }
          // CY12: and the same parapet around each court, at the height the street front
          // was just dealt, so the roofline is one decision. (Legacy non-FAC8 parapets get
          // none: that path lids the deck at topY + ph anyway.)
          if (holes.length && FAC8 && b.__parapetH > 0) {
            buf.curBid = CY_BID;          // unhideable, like the walls below it
            cy12CourtParapet(buf, holes, topY, b, y0, b.__parapetH, cy12CopingMemb(b));
            buf.curBid = b.i;
          }
          // FP18: the penthouse storey (fp18PentLow), under the unhideable bid
          b.__pentRoof = !holes.length && b.__parapetH > 0 ? fp18PentLow(b, ring, topY) : null;
          if (b.__pentRoof) {
            const pl = b.__pentRoof;
            fpPents++;
            buf.curBid = CY_BID;
            extrudePrism(buf, pl.ring, topY, pl.top, b, { baseRef: topY, noStore: true });
            roofFill(buf, pl.ring, pl.top, b);
            fp18PentParapet(buf, pl.ring, cx, cz, pl.top, b, topY);
            buf.curBid = b.i;
          }
          b.__roofRing = ring;
        }
      }
    }
    // ---- RUNTIME ROOFTOP ENGINE: instantiate the full roofscape from the
    // packed roof byte (membrane/tank/solar/green) + archetype templates.
    // Setback towers use their top-tier ring; hips and churches skip.
    {
      let roofRing = b.__roofRing || null, roofYt = topY, areaF = 1;
      // the crown left a smaller deck than the footprint: give the rooftop
      // engine the REAL exposed area so a setback tower does not get a base-
      // sized tank farm on a 90 m² tower top
      if (towerCap) { roofRing = towerCap.roofRing; roofYt = towerCap.roofY; areaF = Math.min(1, towerCap.roofArea / Math.max(1, b.area)); }
      else if (b.__pentRoof) { roofRing = b.__pentRoof.ring; roofYt = b.__pentRoof.top; areaF = b.__pentRoof.areaF; }   // FP18: on the penthouse
      else if (NO_TOWER && (b.flags & BF.SETBACKS) && convexish && b.height > 40 && b.area > 300) { roofRing = ringInset(ring, 0.52, cx, cz); areaF = 0.27; }
      // CY12: the same correction for a court. `b.area` is the OUTER ring's area — the
      // record never subtracted the hole — so a donut would be issued a tank farm sized
      // for its own courtyard as well as its roof.
      if (holes.length) {
        let hA = 0;
        for (const h of holes) { let s = 0; for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; s += p[0] * q[1] - q[0] * p[1]; } hA += Math.abs(s) / 2; }
        areaF *= Math.max(0.2, 1 - hA / Math.max(1, b.area));
      }
      if (roofRing && b.height > 4 && !lmId) {
        try {
          buildRoof({
            ring: roofRing, roofY: roofYt, area: b.area * areaF, h: b.height,
            floors: b.floors || Math.max(1, Math.round(b.height / 3)),
            style: b.style, flags: b.flags, colorVar: b.colorVar,
            winW: b.winW, storeH: b.storeH, fac8: FAC8, year: fac8Year(b),
            roof9: ROOF9,
            wb13: WB13,   // WB13: gates the 'frame' / 'condo' roof archetypes
            fd14: FD14,   // FD14: vent-field count + riser clustering, dish rate (roofEngine.js)
            // R12: the roof engine never knew what it was standing ON. `fmemb` is the
            // shader membrane id (1 silver ~0.50-0.585 albedo, 2 tar ~0.085-0.12,
            // 3 gravel ~0.28-0.39, 4 pavers ~0.42-0.52, 0 = hash/EPDM ~0.24-0.29), so
            // with it the plant can be valued AGAINST the membrane instead of at it —
            // roofs-r9 blind finding 4 and brief C item 3. `deal` is the block ordinal,
            // so two neighbouring roofs cannot draw the same template.
            r12: R12, memb: FAC8 ? (b.greenRoof ? 5 : (b.fmemb ?? 0)) : (b.membrane === 0 ? 1 : b.membrane === 1 ? 2 : b.membrane === 2 ? 3 : 4),
            deal: b.__deal,
            // R12 (plan item S3): the LOT LINES, as world segments. `b.blind` is
            // a per-edge bitmask and a set bit is an abutting neighbour, which
            // is exactly where a pre-war building's flues come out — the roof
            // engine put every chimney on the rear parapet instead. Segments,
            // not the mask, because the engine works in its own OBB frame and
            // has no way back to a footprint edge index. On a setback tower the
            // engine's ring is the inset tower deck, so these fall outside it
            // and its own `inside()` test rejects them — no special case needed.
            party: R12 ? r12PartyEdges(ring, b) : null,
            // ROOF9: only the block's tallest roof carries a cell lease
            blockTall: ROOF9 && (blockTop.get(cellKey(ring[0][0], ring[0][1])) || {}).i === b.i,
            greenRoof: b.greenRoof, hasTank: b.hasTank || ((b.flags & BF.WATERTOWER) && ((b.colorVar * 5.13) % 1) < 0.5)
              // FAC8: a wooden tank on a pre-war mid-rise is not decoration, it
              // is plumbing — above about six storeys the street main cannot
              // reach the top floor, so every pre-1960 building of that height
              // has one. The DOB tank-BIN join (compile.mjs ROOFDATA) only
              // covers filed tanks and misses most of Harlem's; `ref_lenox.png`
              // has three in one block where our dev18 plate has none.
              || (FAC8 && fac8Year(b) < 1961 && b.height > 17 && b.height < 60 && b.area > 170
                  && ((b.colorVar * 61.7) % 1) < 0.42),
            hasSolar: b.hasSolar,
            claim: (k, wx, wz, yaw, sx = 1, sy = 1, sz = 1) => {
              const pool = KIND_MAP[k];
              if (!pool) return;
              // CY12: the roof engine lays its programme out over the footprint ring and
              // has no idea there is a hole in it — a bulkhead or a tank dropped in a
              // light court would hang in mid-air over the court floor.
              if (holes.length && cy12InCourt(holes, wx, wz)) return;
              // FAC8: 4 mm INTO the deck. zfight.md C3 recorded `inst:pool:bulkhead`
              // at 15.608 against a roof at 15.608 — an exact tie over 78-117 m2.
              // It never flickered visibly because the deck was buried under the
              // old full-width parapet lid; now that the deck is the surface you
              // see, an exact tie is a real motion artefact. Sinking the prop is
              // the fix the roofline itself got (nycDress COPING_SINK): overlap,
              // never abut. The dresser's own deck sits 3 mm proud of topY, so
              // this keeps a 7 mm overlap there too.
              const id = ctx.instancer.claim(pool, wx, roofYt - (FAC8 ? 0.004 : 0), wz, yaw, sx, sy, sz);
              if (id >= 0) claims.push([pool, id]);
            },
          });
        } catch (e) { if (!window.__roofErr) { window.__roofErr = 1; console.warn('roof engine', e); } }
      }
    }
    // decorate landmarks (additive)
    if (lmId < 0 && ctx.landmarks) {
      const spec = LM_BY_ID.get(-lmId);
      if (spec) landmarkBuilds.push({ spec, ring, cx, cz, b, groundY: y0, decorate: true });
    }
    // record for the hero-facade geometry ring (skip odd shapes & glass handled fine)
    // ROOF9: a RETAIL_MODERN facade is a blank rainscreen plus its own bands,
    // and heroFacades would applique per-bay limestone sills and window
    // reveals onto it — floating trim on a wall with no windows. `heroRecs` is
    // the ONLY feed for both heroFacades and the dresser (main.js L69), so
    // skipping the push is the whole exclusion, and heroFacades.js — which the
    // brief-A owner is instrumenting this round — is not touched.
    if (ROOF9 && b.style === STYLE.RETAIL_MODERN) {
      rm9.push([minX - 1.6, minZ - 1.6, maxX + 1.6, maxZ + 1.6]);
    } else if (b.height > 5 && b.len <= 24) {
      heroRecs.push({
        key: `${key}:${b.i}`, bid: b.i, tile: key, ring, cx, cz, baseY: y0, height: b.height, heroTop, style: b.style,
        color: [b.r, b.g, b.b], floorH: b.floorH, winW: b.winW, storeH: b.storeH, wall: b.wall, baseWall: b.baseWall, baseFloors: b.baseFloors,
        blind: b.blind, flags: b.flags, colorVar: b.colorVar, floors: b.floors, area: b.area, lit: b.lit,
        deal: b.__deal,          // R12: the block ordinal, so nycDress deals the same building the same way
        membrane: b.membrane, fmemb: b.fmemb, greenRoof: b.greenRoof, roofKind: b.roofKind, setbacks: !!((b.flags & BF.SETBACKS) && convexish),
        doorI: door.doorI, doorPack: door.doorPack, frontIdx: b.frontIdx,
        // CY12: the dresser fills its own roof deck from `ring` and would lid every court
        // it draws over. It gets the court rings so that fill can be earcut with holes;
        // the court's walls, floor and parapet stay with the tile under the sentinel bid.
        holes: holes.length ? holes : null,
      });
    }
    // TW: the tower kit's record (any vertex count; the kit draws only the walls of the tiers above)
    if (b.__twTiers && b.__twTiers.length) {
      towerRecs.push({
        key: `${key}:${b.i}`, bid: b.i, tile: key, ring, tiers: b.__twTiers, cx, cz, baseY: y0, height: b.height, style: b.style,
        color: [b.r, b.g, b.b], floorH: b.floorH, winW: b.winW, storeH: b.storeH, colorVar: b.colorVar, blind: b.blind, flags: b.flags,
        lit: b.lit, floors: b.floors, area: b.area, doorI: door.doorI, doorPack: door.doorPack, frontIdx: b.frontIdx, roofKind: b.roofKind,
      });
    }
    // /TW
    // ground-contact AO: a soft occlusion gradient ribbon where the building
    // meets the pavement (buildings otherwise read pasted onto the sidewalk).
    // Terrain-following, alpha fades wall -> 0 over 0.55m, drawn as a decal.
    if (b.height > 4) {
      const OUT = 0.55;
      for (let si = 0; si < ring.length; si++) {
        const [sax, saz] = ring[si], [sbx, sbz] = ring[(si + 1) % ring.length];
        const sex = sbx - sax, sez = sbz - saz;
        const sL = Math.hypot(sex, sez);
        if (sL < 0.6) continue;
        const sdx = sex / sL, sdz = sez / sL;
        const snx = sez / sL, snz = -sex / sL; // exterior (winding convention)
        const segs = Math.max(1, Math.ceil(sL / 6));
        for (let ss = 0; ss < segs; ss++) {
          const u0 = (ss / segs) * sL, u1 = ((ss + 1) / segs) * sL;
          const px0 = sax + sdx * u0, pz0 = saz + sdz * u0;
          const px1 = sax + sdx * u1, pz1 = saz + sdz * u1;
          // On the REAL surface, not `terrain + 0.305`. That legacy lift was
          // the pre-flat-plane curb+flag datum; against the compiled flags
          // (terrain + 0.28) it floated this dark 0.55 m ribbon 2.5 cm over the
          // pavement all the way round every building — the ring-shaped "AO
          // seam" in the owner's shots — and 30 cm over any bare terrain.
          // 2 mm proud is under the AO's notice (the ribbon has depthWrite off,
          // so it never enters the depth buffer the AO pass reads) and stops
          // the alpha from being z-culled by the pavement at grazing angles.
          const sY = NO_DATUM ? ((qx, qz) => sampleT(qx, qz) + 0.305)
            : ((qx, qz) => { const y = padYAt(qx, qz, 0.4); return (y !== null ? y : sampleT(qx, qz) + 0.28) + 0.002; });
          const yi0 = sY(px0, pz0), yi1 = sY(px1, pz1);
          const yo0 = sY(px0 + snx * OUT, pz0 + snz * OUT);
          const yo1 = sY(px1 + snx * OUT, pz1 + snz * OUT);
          skirtV.push(
            px0, yi0, pz0, 0.38, px1, yi1, pz1, 0.38, px1 + snx * OUT, yo1, pz1 + snz * OUT, 0,
            px0, yi0, pz0, 0.38, px1 + snx * OUT, yo1, pz1 + snz * OUT, 0, px0 + snx * OUT, yo0, pz0 + snz * OUT, 0,
          );
        }
      }
    }
  }

  const bGeo = buf.build();
  // per-tile facade material (same program) so the NYC dresser can hide the
  // shader facade of exactly the buildings it rebuilds
  const facMat = ctx.makeFacadeMat ? ctx.makeFacadeMat() : ctx.facadeMat;
  const bMesh = new THREE.Mesh(bGeo, facMat);
  bMesh.frustumCulled = true;
  bMesh.castShadow = true;
  bMesh.receiveShadow = true;
  // SHADOW SIDE (docs/notes/lighting-r6.md 1d). three's depth pass renders a
  // FrontSide material's BACK faces, so the depth stored for a caster is its
  // FAR surface. For an open extruded prism that still works (the away wall
  // spans ground to roof), which is why buildings did shadow; for anything
  // CLOSED it is a disaster — the nearest back face under a projecting sill or
  // lintel is the sill's own underside, 100 mm away, so the occluder depth and
  // the receiver depth are inside the bias of each other and the reveal throws
  // nothing. That is critic r5 7.1's "the limestone reads as paper".
  // DoubleSide makes the depth test keep the true nearest surface.
  facMat.shadowSide = THREE.DoubleSide;
  bMesh.layers.enable(3); // far shadow cascade renders buildings only
  bGeo.computeBoundingSphere();
  group.add(bMesh);

  // ---- landmarks
  for (const L of landmarkBuilds) {
    try {
      const local = L.ring.map(([x, z]) => [x - L.cx, z - L.cz]);
      const obb = ringOBB(local);
      const g = ctx.landmarks(L.spec.key, {
        footprint: local, height: L.b.height, floors: L.b.floors, floorH: L.b.floorH, groundY: L.groundY,
        obb, THREE, cx: L.cx, cz: L.cz,
        padY: padUnderRing(L.ring), // paved/pad top under the footprint (replaces the campus kit's CU_PADS table)
      });
      if (g) {
        g.position.set(L.cx, L.groundY, L.cz);
        g.traverse((n) => { if (n.isMesh) { n.castShadow = true; n.receiveShadow = true; n.layers.enable(3); if (n.material && !Array.isArray(n.material)) n.material.shadowSide = THREE.DoubleSide; } });
        group.add(g);
        if (g.userData?.colliderBoxes) {
          for (const cb of g.userData.colliderBoxes) {
            COLLIDERS.addBox(key, { x: L.cx + cb.x, y: L.groundY + cb.y, z: L.cz + cb.z, hw: cb.w / 2, hh: cb.h / 2, hd: cb.d / 2, rotY: cb.rotY || 0 });
          }
        }
      } else if (!L.decorate) {
        // builder missing: fall back to plain extrusion
        const fb = new GeoBuf();
        extrudePrism(fb, L.ring, L.groundY, L.groundY + L.b.height, L.b, { baseRef: L.groundY });
        roofFill(fb, L.ring, L.groundY + L.b.height, L.b);
        const m = new THREE.Mesh(fb.build(), ctx.facadeMat);
        group.add(m);
      }
    } catch (e) { console.warn('landmark', L.spec.key, e); }
  }

  // ---- ground merged geometry (matId per section)
  //
  // ONE mesh, one material, no polygon offset. The per-layer depth separation
  // this needs lives in the ground shader instead: makeGroundMaterial() biases
  // gl_Position.z by a fixed number of 24-bit depth LSBs keyed on the matId
  // attribute (materials.js, the `#include <project_vertex>` replace — paint
  // 3/4/9 and plates 13/14 get 10 LSBs, gutter 11 and bus red 12 get 4).
  //
  // This file briefly carried the same correction as a three-way mesh split with
  // polygonOffsetUnits per tier; it is deleted so the two cannot stack. Keep it
  // deleted. Why the shader is the right home for it: the offset has to be
  // denominated in depth LSBs, not metres, because no geometric lift can work —
  // one LSB at range d is (f-n)*d^2/(f*n*2^24) = 1.490e-7*d^2 metres ALONG THE
  // VIEW RAY, and a dY between two horizontal surfaces is worth only dY*h/d of
  // that, so at 400 m with a 3.4 m eye a stable pair would need 5.9 METRES of
  // lift. The shader does it in one line and one draw call. docs/notes/zfight.md.
  {
    const sections = [['asphalt', 0], ['sidewalk', 1], ['curb', 2], ['paintW', 3], ['paintY', 4], ['grass', 5], ['path', 6], ['paintG', 9], ['brick', 10], ['gutter', 11], ['busred', 12], ['warn', 13], ['warnIron', 14], ['grassU', 15], ['plaza', 16], ['gravel', 17]];   // plaza: TP28's re-kinded Broadway (city/tsqPlaza.js); gravel: BP28's walks
    // RL36 rail (compile.mjs): rail steel 18, ballast 19, the sleeper bed 20 (its per-vertex matId 20 + bearing, rtopA),
    // cut walls 21. Kept out of TL26 below: a cut's bed lies 3 m under the grade and must not pull the grid down to it.
    const RAIL_SECTIONS = [['rsteel', 18], ['rbal', 19], ['rtop', 20], ['rwall', 21]];
    // SA37 shore aprons (compile.mjs): land the 16 m grid leaves under water behind a bulkhead, laid at the drawn land grade
    // and drawn as terrain (matId 7); kept out of TL26 too, so the grid beside an apron stays level with it
    const APRON_SECTIONS = [['apron', 7]];
    let total = 0;
    for (const [name] of sections) total += (tile.S[name]?.length ?? 0) / 3;
    for (const [name] of RAIL_SECTIONS.concat(APRON_SECTIONS)) total += (tile.S[name]?.length ?? 0) / 3;
    // terrain grid
    const res = tile.header.res, n = res + 1;
    const terr = tile.S.terrain;
    // TL26 (owner 2026-09-25: "I don't want to see ground heightmaps clip into grass"). The drawn grid sits 0.12 m under
    // its own samples, but a 4 m terrain cell is flat where a lawn or a path over it slopes or steps down (the Low Plaza
    // parterres, the terrace lawns), so the grid rose through the surface laid on it: 251 points of the plaza alone
    // (scratchpad probe_layers.mjs). Each drawn grid vertex now also stays 0.12 m under the lowest section triangle
    // touching its four cells, at most 1.5 m below its sample; the samples themselves (terrainAt) are untouched.
    const terrDraw = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) terrDraw[k] = terr[k] - 0.12;
    if (!NO_TL26) {
      const cw = TILE_OF(tile) / res;
      for (const [name] of sections) {
        const src = tile.S[name];
        if (!src) continue;
        for (let i = 0; i + 8 < src.length; i += 9) {
          const x0 = Math.min(src[i], src[i + 3], src[i + 6]), x1 = Math.max(src[i], src[i + 3], src[i + 6]);
          const z0 = Math.min(src[i + 2], src[i + 5], src[i + 8]), z1 = Math.max(src[i + 2], src[i + 5], src[i + 8]);
          const y = Math.min(src[i + 1], src[i + 4], src[i + 7]) - 0.12;
          const i0 = Math.max(0, Math.floor(x0 / cw)), i1 = Math.min(res, Math.ceil(x1 / cw));
          const j0 = Math.max(0, Math.floor(z0 / cw)), j1 = Math.min(res, Math.ceil(z1 / cw));
          for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
            const k = j * n + ii;
            if (y < terrDraw[k]) terrDraw[k] = Math.max(y, terr[k] - 1.62);
          }
        }
      }
    }
    const terrVerts = res * res * 6;
    const pos = new Float32Array((total + terrVerts) * 3);
    const mat = new Float32Array(total + terrVerts);
    let o = 0;
    for (const [name, mid] of sections.concat(RAIL_SECTIONS, APRON_SECTIONS)) {
      const src = tile.S[name];
      if (!src) continue;
      const perV = name === 'rtop' && tile.S.rtopA && tile.S.rtopA.length * 3 === src.length ? tile.S.rtopA : null;
      for (let i = 0, v = 0; i < src.length; i += 3, v++) {
        pos[o * 3] = src[i] + ox; pos[o * 3 + 1] = src[i + 1]; pos[o * 3 + 2] = src[i + 2] + oz;
        mat[o] = perV ? perV[v] : mid; o++;
      }
    }
    const T = TILE_OF(tile);
    // ST38 (STATIONS2, city/stations/subEnt38.js; `?st38=0` none): the subway stairs' openings are cut out of the walk, and
    // out of the drawn grid here, exactly: a cell they touch is drawn as its pieces outside them
    // RL36: the open cuts (tile header railCuts, [x, z, yaw, halfLen, halfW] tile-local) are cut out of the drawn grid
    // the same way, as oriented rectangles in st38ClipTri's form
    let railHoles = null;
    if (tile.header.railCuts && tile.header.railCuts.length && !NO_RL36) {
      railHoles = tile.header.railCuts.map(([x, z, yaw, hl, hw]) => ({ x: x + ox, z: z + oz, yaw: -yaw, x0: -hl, x1: hl, z0: -hw, z1: hw }));
    }
    const holes38 = (tile.st38Holes && tile.st38Holes.length) || railHoles ? [...(tile.st38Holes || []), ...(railHoles || [])] : null;
    let extra38 = null;
    for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
      const x0 = ox + (i / res) * T, x1 = ox + ((i + 1) / res) * T;
      const z0 = oz + (j / res) * T, z1 = oz + ((j + 1) / res) * T;
      const y00 = terrDraw[j * n + i], y10 = terrDraw[j * n + i + 1], y01 = terrDraw[(j + 1) * n + i], y11 = terrDraw[(j + 1) * n + i + 1];
      const quad = [[x0, y00, z0], [x1, y11, z1], [x1, y10, z0], [x0, y00, z0], [x0, y01, z1], [x1, y11, z1]];
      if (holes38) {
        const t1 = quad.slice(0, 3), t2 = quad.slice(3), c1 = st38ClipTri(t1, holes38), c2 = st38ClipTri(t2, holes38);
        if (c1 || c2) { (extra38 = extra38 || []).push(...(c1 || [t1]), ...(c2 || [t2])); continue; }
      }
      for (const [x, y, z] of quad) { pos[o * 3] = x; pos[o * 3 + 1] = y; pos[o * 3 + 2] = z; mat[o] = 7; o++; }
    }
    let posF = pos, matF = mat;
    if (holes38) {
      const ne = extra38 ? extra38.length * 3 : 0;
      posF = new Float32Array((o + ne) * 3); matF = new Float32Array(o + ne);
      posF.set(pos.subarray(0, o * 3)); matF.set(mat.subarray(0, o));
      if (extra38) for (const tri of extra38) for (const [x, y, z] of tri) { posF[o * 3] = x; posF[o * 3 + 1] = y; posF[o * 3 + 2] = z; matF[o] = 7; o++; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(posF, 3));
    g.setAttribute('matId', new THREE.BufferAttribute(matF, 1));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, ctx.groundMat);
    m.receiveShadow = true;
    group.add(m);
  }

  // ---- furniture instances
  const inst = ctx.instancer;
  const signTexts = [];
  // Kinds that must SIT ON the ground (everything else — awnings, roof props,
  // fire-escape ladders, water towers — hangs off a wall or a roof at a height
  // the compiler computed, and must not be snapped).
  const GROUND_KIND = new Set([
    FURN.TREE, FURN.LAMP_COBRA, FURN.LAMP_CROOK, FURN.HYDRANT, FURN.SIGNAL_MAST,
    FURN.SIGNAL_PED, FURN.STREET_SIGN, FURN.LITTER, FURN.MAILBOX, FURN.BUS_SHELTER,
    FURN.SUBWAY_ENTRANCE, FURN.LINKNYC, FURN.NEWSSTAND, FURN.SCAFFOLD, FURN.BENCH,
    FURN.BIKE_RACK, FURN.PHONE, FURN.PLANTER, FURN.STOOP, FURN.STANDPIPE, FURN.CONE,
    FURN.CROSSING_BEACON, FURN.PARKING_METER,
    34, 35, 36, 37, 38, 39,        // sign pole, bollards, news boxes, barrel, dumpster, table
  ]);
  // Wall-hung frontage kinds: their height is measured UP from the building's
  // ground floor, so they move with it rather than snapping to the pavement.
  const FRONTAGE_HUNG = new Set([FURN.AWNING, FURN.MARQUEE]);
  // ...but only when this tile was compiled with the frontage-on-terrain bug
  // (compile.mjs:1501 `const gY = groundY`). Detected, not assumed, so a fixed
  // recompile silently turns the compensation off instead of double-correcting.
  let frontageOnTerrain = false;
  for (const f of furnitureOf(tile)) {
    if (f.k !== FURN.STOOP && f.k !== FURN.STANDPIPE && f.k !== FURN.SCAFFOLD && f.k !== FURN.FIRE_ESCAPE) continue;
    if (Math.abs(f.y - sampleT(f.x + ox, f.z + oz)) < 0.02) { frontageOnTerrain = true; break; }
  }
  // Kerbside items that a metre of lateral slack cannot hurt. A third of the
  // street trees in tile 4_-6 sample over ASPHALT, not flags, because the
  // compiled roadway is ~1.5 m wider than the real one on each side (LION
  // `width` vs the tree census points — reported to the lead). Snapping their Y
  // to the roadway closes the gap but leaves trees growing out of a traffic
  // lane, so pull them the short distance back onto the pavement instead. Only
  // small movable things; signals, shelters, lamps and subway stairs stay
  // exactly where the compiler put them.
  const NUDGEABLE = new Set([FURN.TREE, FURN.BIKE_RACK, FURN.LITTER, FURN.PLANTER, FURN.HYDRANT, FURN.PARKING_METER, 35, 36]);
  // …of those, the ones that exist ONLY at a kerb: if the nudge cannot reach a
  // pavement they are dropped rather than left standing in the traffic lanes
  // (4 items across the four probe tiles). Trees are deliberately NOT in here.
  const KERB_ONLY = new Set([FURN.BIKE_RACK, FURN.LITTER, FURN.PLANTER, FURN.HYDRANT, FURN.PARKING_METER, 35, 36]);
  let strandedInRoad = 0;
  // …ordered by radius, so nothing ever moves further than it has to. The 2.7 m
  // ring was added in round 2: of 2 328 nudgeable items in the four probe tiles,
  // 905 sample something other than a flag and the 1.8 m ladder recovers 706 —
  // 46 more (8 hydrants, 16 bike racks, 19 trees, 3 litter bins) need one more
  // step, among them the hydrant standing in the roadway at 5th & 42nd that the
  // critic has reported twice. The remaining 153 are genuinely mid-carriageway
  // or mid-park placements and stay where the data puts them.
  const NUDGE = [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.64, 0.64], [-0.64, 0.64], [0.64, -0.64], [-0.64, -0.64],
    [1.8, 0], [-1.8, 0], [0, 1.8], [0, -1.8], [1.27, 1.27], [-1.27, 1.27], [1.27, -1.27], [-1.27, -1.27],
    [2.7, 0], [-2.7, 0], [0, 2.7], [0, -2.7], [1.9, 1.9], [-1.9, 1.9], [1.9, -1.9], [-1.9, -1.9]];
  const toPavement = (x, z) => {                     // nearest WALK sample within 1.8 m, or null
    for (const [dx2, dz2] of NUDGE) {
      const y = surfY(x + dx2, z + dz2, WALK_KINDS, 0.2);
      if (y !== null) return [x + dx2, z + dz2, y];
    }
    return null;
  };
  // BP28: Bryant Park's allee planes join this tile's furniture (and its compiled scatter trees are dropped below)
  const tsxT = (await TSX)?.[`${Math.round(ox / 512)}_${Math.round(oz / 512)}`] || null;   // AR34 TREES: census species 9-12
  // AR34 TREES: the tile's records once (furnitureOf yields fresh objects), and the street-tree fixes keyed by index
  const furn0 = [];
  for (const f of furnitureOf(tile)) { f.ix = furn0.length; furn0.push(f); }
  const tfo = await TFO, tovRows = (await TOV)?.[`${Math.round(ox / 512)}_${Math.round(oz / 512)}`] || null;
  const TF = (tfo && tfo.boxes) || tovRows
    ? treeFixes(furn0, ox, oz, tfo?.t?.[`${Math.round(ox / 512)}_${Math.round(oz / 512)}`] || null, tovRows, (tfo && tfo.boxes) || [], (x, z) => sectionY('sidewalk', x, z, 1.5) !== null)
    : null;
  const bpExtra = [];
  if (TF) for (const a of TF.add) { a.y = padYNear(a.x + ox, a.z + oz); bpExtra.push(a); }
  if (BP28) for (const t of bpTrees(ox, oz, 0)) { t.bp = true; t.y = padYNear(t.x + ox, t.z + oz); bpExtra.push(t); }
  // CP32: Central Park's trees, lamps and benches likewise (a record without a height stands on the ground under it)
  if (CPT) for (const t of cpFurniture(ox, oz)) { if (t.y === null) t.y = padYNear(t.x + ox, t.z + oz); bpExtra.push(t); }
  if (ART) for (const t of areaFurniture(ox, oz)) { if (t.y === null) t.y = padYNear(t.x + ox, t.z + oz); bpExtra.push(t); }
  for (const f of (bpExtra.length ? [...furn0, ...bpExtra] : furn0)) {
    let wx = f.x + ox, wz = f.z + oz;
    if (TF && f.k === FURN.TREE && f.ix !== undefined) {
      if (TF.drop.has(f.ix)) continue;
      const e = TF.edit.get(f.ix);
      if (e) {
        if (e.p0 !== undefined) f.p0 = e.p0;
        if (e.p1 !== undefined) f.p1 = e.p1;
        if (e.pit !== undefined) f.pit = e.pit;
        if (e.x !== undefined) { wx = e.x; wz = e.z; f.x = wx - ox; f.z = wz - oz; f.y = padYNear(wx, wz); }
      }
    }
    if (BP28 && f.k === FURN.TREE && !f.bp && bpDropTree(wx, wz, f)) continue;
    if (CPT && !f.cp && cpDropFurniture(wx, wz, f)) continue;
    if (ART && !f.ar && areaDropFurniture(wx, wz, f)) continue;
    // GROUND SNAP. Three compiler datums reach us for things that stand on the
    // pavement: `terrain + 0.28` (correct on the flags), the bare `terrain`
    // plane (compile.mjs:1501 frontage — stoops, scaffolds, standpipes, fire
    // escape feet 28 cm sunk; :3342 park trees 26 cm under their lawn) and
    // nothing at all for the point datasets that land on the roadway or a lawn
    // instead of a flag (a hydrant on asphalt floated 13.5 cm, a bench on grass
    // 2 cm — the 2 cm one is the worst, because it is exactly the gap SSAO
    // paints black). Ask the ground. 0.5 m of authority so a bad sample can
    // never launch a bus shelter, and never touch anything above ground floor.
    if (f.y < 12 && !NO_DATUM) {
      if (GROUND_KIND.has(f.k) || f.k === FURN.FIRE_ESCAPE) {
        let gy = padYNear(wx, wz);
        // standing in the roadway? walk it back to the kerb if it is that kind
        // TC13: …except a BACKYARD tree (compiler p2 bit 1), whose whole point
        // is that it is NOT on the pavement. The nudge ladder would walk it out
        // of the rear yard onto the nearest flags, and the kerb-only fallback
        // would then delete it as "stranded in the roadway".
        if (NUDGEABLE.has(f.k) && gy < f.y - 0.05 && surfY(wx, wz, WALK_KINDS, 0.2) === null
            && !(TC13 && f.k === FURN.TREE && (f.p2 & 2))) {
          const p = toPavement(wx, wz);
          if (p) { wx = p[0]; wz = p[1]; gy = p[2]; }
          // …and if it is a thing that ONLY ever stands at a kerb, and the kerb
          // is not within reach, do not stand it in a traffic lane. The fire
          // hydrant at (-837.7, 3294.1) is 8 m inside the junction of 5th Ave
          // and 42nd St — a real hydrant point that the compiled roadbed has
          // swallowed — and it has been "a fire hydrant standing in the
          // roadway" in the critic's worst frame for two rounds. Nobody misses
          // one hydrant; everybody sees one in the middle of Fifth Avenue.
          // Only the small kerb-only kinds: trees, lamps, sign poles, shelters
          // and subway stairs may legitimately stand on a median or an island
          // that this tile did not classify as pavement.
          else if (KERB_ONLY.has(f.k) && surfY(wx, wz, ROAD_KINDS, 0.2) !== null) { strandedInRoad++; continue; }
        }
        if (Math.abs(gy - f.y) < 0.5) f.y = gy;
      } else if (frontageOnTerrain && FRONTAGE_HUNG.has(f.k)) {
        const lift = padYNear(wx, wz) - sampleT(wx, wz);
        if (lift > 0 && lift < 0.6) f.y += lift;
      }
    }
    if (f.k === FURN.TREE) {
      if (tsxT && f.p0 === 0 && (f.p2 & 1)) { const c9 = tsxAt(tsxT, f.x, f.z); if (c9) f.p0 = c9; }
      const sp = inst.treeSpecies(f.p0);
      const dbh = Math.max(4, f.p1);
      // geometry is pre-normalized to real mature height in trees.js, so the
      // instance multiplier must hover near 1.0 (the old 2.1x cap x species
      // 1.55x stacked into 37m street trees). Combined factor capped at 1.38.
      const s = Math.min(1.38, Math.min(1.25, 0.62 + dbh / 45) * sp.s);
      const jitter = 0.9 + ((wx * 13.7 + wz * 7.3) % 1 + 1) % 1 * 0.2;
      // TC13 ALLOMETRY. `tree_dbh` is the census trunk diameter in INCHES; the
      // r12 curve (0.62 + dbh/45, capped 1.25) is nearly flat over the whole
      // range — a 4" sapling came out 0.71 and a 40" veteran 1.25, so every
      // street read as one age of tree — and it scaled UNIFORMLY, so a tree
      // could only get wider by getting taller. Real street trees put on girth
      // and SPREAD long after height stops: height goes as ~sqrt(dbh), crown
      // width keeps climbing nearly linearly to ~26". Envelope in metres comes
      // from TREE_ARCH (trees.js normalises the geometry to the same table):
      // Worked, on the CENSUS dbh (the +4 in of growth below is applied first):
      //   Manhattan p90 plane (census 26) -> 17.2 m tall x 14.7 m across
      //   Manhattan p50 plane (census 10) -> 13.3 m tall x 11.4 m across
      //   Brooklyn  p50 plane (census  7) -> 12.4 m tall x  9.9 m across
      //   Brooklyn  p10 plane (census  3) -> 10.9 m tall x  8.0 m across
      //   ginkgo    p50       (census  7) ->  7.6 m tall x  3.6 m across (columnar)
      let sH = s, sW = s;
      if (TC13) {
        const arch = TREE_ARCH[sp.arch] || TREE_ARCH.A;
        // ELEVEN GROWING SEASONS. `tree_dbh` comes from the DPR 2015 Street
        // Tree Census (data/raw/trees_<boro>.csv: spc_common, tree_dbh, status,
        // lat, lon) and the scene is 2026. A New York street tree puts on
        // ~0.3-0.4 in of diameter a year, so what is standing there now is
        // ~4 in thicker than what was recorded. This is not a fudge, it is the
        // difference between sizing the city's canopy on today's trees and
        // sizing it on the saplings of 2015 — and it is most of the problem in
        // Brooklyn, where the compiled census at Bedford & N 7th reads
        // p10/p50/p90 dbh 3/7/14 (Manhattan at W 120th: 3/10/26).
        // Census points only (p2 bit 0); the median-strip and yard trees the
        // compiler plants carry a present-day diameter already.
        const dbhN = (f.p2 & 1) ? dbh + 4 : dbh;
        // FD14 (critic-r14 fix 8). TC13's curve is right in SHAPE and low in VALUE: the
        // canopy measures 1.8 / 4.0 / 3.3 % of frame in the three aerials against the
        // references' 3.4 / 9.8 / 10.4 %, and 0.8 % against 9.5 % at street level on
        // Amsterdam. Probing the compiled tiles at the amst120N camera (15 trees in 60 m,
        // census dbh p50 = 7) the modal tree there is a honeylocust rendering 9.1 m tall
        // with a 6.7 m crown; the same tree on the reference block is a 12-14 m plane whose
        // crown meets its neighbours over the roadway. The tree COUNT is census data and
        // not mine to change, so the fix is the envelope: +12 on the height intercept and
        // a spread term that starts at 0.80 instead of 0.62, i.e. the mid-range tree gains
        // ~17 % of height and ~19 % of spread while the p90 veteran gains ~11 %. Caps go to
        // 1.52 / 1.42 = 19.2 m tall x 15.3 m across for an arch-A plane, which is a real
        // mature London plane and still clears a 4.5 m sidewalk from a kerbside pit.
        const hf = FD14 ? 0.46 + 0.80 * Math.sqrt(dbhN / 24) : 0.34 + 0.76 * Math.sqrt(dbhN / 24);
        sH = Math.max(0.55, Math.min(FD14 ? 1.52 : 1.45, hf * sp.s));
        sW = Math.max(0.45, Math.min(FD14 ? 1.42 : 1.36, sH * (sp.w ?? 1)
          * (FD14 ? 0.80 + 0.40 * Math.min(1, dbhN / 26) : 0.62 + 0.46 * Math.min(1, dbhN / 26))));
        // …and a tree on a PLANTED MEDIAN or a traffic island is not a street
        // tree. The compiler flags the ones it plants itself (p2 bit 2); a
        // census point that landed on a bed with no pavement under it and
        // roadway all round is the same thing (the Lenox Ave pair at
        // (2183,-2768)). Both get capped at ~8.4 m and a crown that stays
        // inside the bed — critic-r13 fix 9: "median trees at Lenox are ~4
        // storeys tall and span the median plus half the carriageway".
        // FD14: …and THAT TEST HAS NEVER FIRED at Lenox. Probing the v19 tiles 45 m around
        // (2183,-2768): ten trees, every one p2 === 1 — the compiler's own median bit
        // (p2 & 4) is on none of them — so the cap rests entirely on `roadOnly()`, which
        // requires no pavement AND `sectionY('grass') === null`. The v19 compiler plants
        // that median as a green strip, so the grass test alone makes roadOnly false and
        // the cap is unreachable by construction. Hence the critic's "continuous unbroken
        // hedge of very large dark trees" at four storeys, r13 fix 9 still open.
        // The replacement does not ask what the median is SURFACED with. A street tree
        // stands in a pit 0.6-1.5 m off the kerb, so it always has pavement within ~2.5 m;
        // a median or traffic-island tree has carriageway on BOTH sides. Four samples,
        // taken only for the trees that fail the cheap pavement test, and a park tree
        // (no road either side) is not caught by it.
        // The cap itself also comes down: 8.4 m x 6.2 m crowns at the 5-7 m spacing the
        // census gives on Lenox still close into a hedge. 7.2 x 4.6 reads as separate
        // ornamental crowns in beds, which is what the reference shows.
        const fd14Median = () => {
          if (surfY(wx, wz, WALK_KINDS, 0.30) !== null) return false;   // on the flags: a street tree
          if (surfY(wx, wz, ROAD_KINDS, 0.45) === null && sectionY('grass', wx, wz, 0.45) === null) return false;
          // …and a tree STANDING on asphalt is still a street tree if the pavement is a
          // couple of metres away: the note at the head of this loop records that the
          // compiled roadway over-runs the real kerb by ~1.5 m on each side, so a third of
          // the census pits in tile 4_-6 sample asphalt. A median has no flags within 3 m
          // in any direction — that is the difference, and it is what keeps this cap off
          // the kerbside trees whose pit the roadway polygon swallowed.
          for (const [dx2, dz2] of [[3, 0], [-3, 0], [0, 3], [0, -3], [2.1, 2.1], [-2.1, 2.1], [2.1, -2.1], [-2.1, -2.1]]) {
            if (surfY(wx + dx2, wz + dz2, WALK_KINDS, 0.8) !== null) return false;
          }
          const rd = (dx2, dz2) => surfY(wx + dx2, wz + dz2, ROAD_KINDS, 0.8) !== null;
          return (rd(6, 0) && rd(-6, 0)) || (rd(0, 6) && rd(0, -6));
        };
        if ((f.p2 & 4) || (f.p2 === 1 && (FD14 ? fd14Median() : roadOnly(wx, wz, 0.25)))) {
          sH = Math.min(sH, (FD14 ? 7.2 : 8.4) / arch.h);
          sW = Math.min(sW, (FD14 ? 4.6 : 6.2) / arch.w, sH * 1.1);
        }
        // YARD TREES (compiler p2 bit 1) are back-lot volunteers and planted
        // ornamentals in a 6-10 m rear yard, not 15 m avenue plane trees.
        else if (f.p2 & 2) { sH = Math.min(sH, 1.12); sW = Math.min(sW, 1.15); }
      }
      const nV = sp.arch === 'A' ? 3 : 2; // variant pools per species
      const vH = Math.abs((wx * 31.7 + wz * 17.3) % nV) | 0;
      const suff = vH === 0 ? '' : String(vH + 1);
      // TV25 (trees agent 2026-09-25): census species -> species-FORM pools (furnitureKit TREE_FORM_MIX). The crown
      // colour now lives in the leaf atlas, so the instance tint is white and instancer.js U10 adds the per-tree spread.
      const tv = TV25 ? treePoolFor(f.p0, wx, wz, f.p1, f.p2) : null;   // census dbh <= 4 -> the young sub-form
      const poolT = tv ? tv + 'Trunk' : `tree${sp.arch}${suff}Trunk`, poolC = tv ? tv + 'Crown' : `tree${sp.arch}${suff}Crown`;
      const crownCol = tv ? 0xffffff : (TC13 ? (sp.c13 ?? sp.c) : sp.c) + ((wx | 0) % 3) * 0x050803;
      const idT = inst.claim(poolT, wx, f.y, wz, f.rot, sW, sH * jitter, sW);
      const idC = inst.claim(poolC, wx, f.y, wz, f.rot, sW, sH * jitter, sW, crownCol);
      if (idT >= 0) claims.push([poolT, idT]);
      if (idC >= 0) claims.push([poolC, idC]);
      // …but never a raised pit guard around a tree that is standing on the
      // ROADWAY. The Lenox Ave median trees at (2183, -2768) and (2185.7,
      // -2772.8) are real census points on a median the compiler did not pave
      // (probe_map shows 20 m of unbroken asphalt with the flags 10 m away on
      // either side), so nudging cannot help them — but a bare trunk in a lane
      // reads as a missing median, while a fenced planter box in a lane reads
      // as broken geometry. Reported to the compiler with coordinates.
      let vgG = 0;   // VG36 (GROUND): this tree's guard went in
      if (f.p2 === 1 && f.pit !== 'none' && (f.pit === 'guard' || ((wx * 7.3 + wz * 3.1) % 1 + 1) % 1 < 0.55)
          && !(NO_DATUM === false && surfY(wx, wz, WALK_KINDS, 0.25) === null && surfY(wx, wz, ROAD_KINDS, 0.25) !== null)) {
        const idF = inst.claim('treeFence', wx, f.y, wz, f.rot);
        if (idF >= 0) { claims.push(['treeFence', idF]); vgG = 1; }
      }
      if (f.p2 === 1 && (vgG || surfY(wx, wz, WALK_KINDS, 0.25) !== null)) vgPits.push(wx, f.y, wz, f.rot, vgG);   // VG36 (GROUND)
      // SPACE r2 (city/colliders.js addBarrier): a walker does not step over the guard (its 1.48 m box, the kerb's turn)
      if (vgG) COLLIDERS.addBarrier(key, { x: wx, z: wz, hw: 0.74, hd: 0.74, rotY: f.rot });
      continue;
    }
    if (f.k === FURN.STREET_SIGN) {
      const nm = tile.header.names || [];
      signTexts.push({ x: wx, y: f.y, z: wz, rot: f.rot, nameA: nm[f.p0] || '', nameB: nm[f.p1] || '' });
    }
    if (SG13 && (f.k === FURN.SIGNAL_MAST || f.k === FURN.SIGNAL_PED)) {
      if (f.k === FURN.SIGNAL_PED) {
        const prot = sgPedAim(wx, wz, f.rot);
        const idP = inst.claim('signalPed', wx, f.y, wz, prot);
        if (idP >= 0) claims.push(['signalPed', idP]);
        const entry = { veh: false, x: wx, y: f.y, z: wz, rot: prot, ids: {} };
        for (const lp of ['pedHand', 'pedMan']) {
          const id = inst.claim(lp, wx, f.y, wz, prot);
          if (id >= 0) { claims.push([lp, id]); entry.ids[lp] = id; }
        }
        if (ctx.signalReg) ctx.signalReg.push({ tile: key, ...entry });
        continue;
      }
      const reach = sgReach(f.p0);
      const aim = sgArmAim(wx, wz, f.rot, reach);
      const s = reach / SG13_ARM.ref;                       // the arm pool stretches in Z only
      const idB = inst.claim('signalMast', wx, f.y, wz, aim.rot);
      if (idB >= 0) claims.push(['signalMast', idB]);
      const idA = inst.claim('signalArm', wx, f.y, wz, aim.rot, 1, 1, s);
      if (idA >= 0) claims.push(['signalArm', idA]);
      const ax = Math.sin(aim.rot), az = Math.cos(aim.rot);
      const heads = [
        { x: wx + ax * SG13_ARM.tipZ * s, y: f.y + SG13_ARM.headY, z: wz + az * SG13_ARM.tipZ * s, rot: aim.head },
        { x: wx + ax * SG13_ARM.poleZ, y: f.y + SG13_ARM.poleY, z: wz + az * SG13_ARM.poleZ, rot: aim.head },
      ];
      // servesEW is the axis of the traffic the head faces, which is the axis
      // traffic.js already phases cars on (sim/traffic.js:368). The old registry
      // handed it the ARM bearing instead — perpendicular to the approach — so
      // the lamps ran the opposite phase to the cars underneath them.
      const entry = { veh: true, heads, servesEW: Math.abs(Math.sin(aim.head)) > Math.abs(Math.cos(aim.head)), ids: { sigR: [], sigA: [], sigG: [] } };
      for (const h of heads) {
        for (const p of ['signalHead', 'signalLens']) {
          const id = inst.claim(p, h.x, h.y, h.z, h.rot);
          if (id >= 0) claims.push([p, id]);
        }
        // Claim the lit lenses already in a legal state — RED lit, the other two
        // collapsed to a 0.3 mm speck. Claiming all three at scale 1 and waiting
        // for the sim is how a signal with no SignalController running (?nosim,
        // or a sim import that threw) showed three lit lenses at once.
        for (const lp of ['sigR', 'sigA', 'sigG']) {
          const sc = lp === 'sigR' ? 1 : 0.001;
          const id = inst.claim(lp, h.x, h.y, h.z, h.rot, sc, sc, sc);
          if (id >= 0) claims.push([lp, id]);
          entry.ids[lp].push(id);
        }
      }
      if (ctx.signalReg) ctx.signalReg.push({ tile: key, ...entry });
      continue;
    }
    if (f.k === FURN.SIGNAL_MAST || f.k === FURN.SIGNAL_PED) {
      const veh = f.k === FURN.SIGNAL_MAST;
      const rot = veh ? armOverRoad(wx, wz, f.rot) : f.rot;
      const base = veh ? 'signalMast' : 'signalPed';
      const idB = inst.claim(base, wx, f.y, wz, rot);
      if (idB >= 0) claims.push([base, idB]);
      const entry = { veh, x: wx, y: f.y, z: wz, rot, ids: {} };
      for (const lp of veh ? ['sigR', 'sigG', 'sigA'] : ['pedHand', 'pedMan']) {
        const id = inst.claim(lp, wx, f.y, wz, rot);
        if (id >= 0) { claims.push([lp, id]); entry.ids[lp] = id; }
      }
      if (ctx.signalReg) ctx.signalReg.push({ tile: key, ...entry });
      continue;
    }
    // kind 34 sign pole: p1 bit 0 (compile.mjs) marks a one-way street, the only place a ONE WAY blade belongs
    // (owner 2026-09-15, docs/notes/amst120.md — a ONE WAY sign stood on two-way Amsterdam Ave at W 120th)
    const pool = (f.k === 34 && (f.p1 & 1)) ? 'signPoleOneWay' : KIND_MAP[f.k];
    if (!pool) continue;
    // ROOF9: no shop awnings on a big-box retail block. compile.mjs emits an
    // AWNING prop along the frontage of every STOREFRONT building, which on a
    // RETAIL_MODERN facade reads as a row of taxpayer shops hanging under the
    // one continuous canopy retailModern() builds. compile.mjs is off-limits
    // this round, so the props are dropped here by AABB instead.
    if (ROOF9 && f.k === FURN.AWNING && rm9.length) {
      let inRM = false;
      for (const q of rm9) if (wx > q[0] && wx < q[2] && wz > q[1] && wz < q[3]) { inRM = true; break; }
      if (inRM) continue;
    }
    let sx = 1, sy = 1, sz = 1, color = null;
    if (f.k === FURN.STOOP) {
      // slide from the frontage midpoint to the door bay of the building whose
      // front-edge midpoint sits 0.4 m behind this stoop; tint per instance
      const nx = Math.sin(f.rot), nz = Math.cos(f.rot);
      const emx = wx - nx * 0.4, emz = wz - nz * 0.4;
      let best = null, bd = 0.6;
      for (const a of doorAnchors) { const d = Math.hypot(a.mx - emx, a.mz - emz); if (d < bd) { bd = d; best = a; } }
      if (best && best.store) continue;                                   // shop on the door wall: no parlour door, no stoop
      if (best) { wx = best.dx + nx * 0.4; wz = best.dz + nz * 0.4; }
      color = STOOP_TINTS[Math.abs(((wx * 7.3 + wz * 3.1) | 0) % STOOP_TINTS.length)];
      // WB13: the kit stoop is a HARLEM BROWNSTONE high stoop — 10 x 0.170 m to a
      // 1.70 m parlour floor. A Brooklyn frame house has 3-6 risers to 0.50-1.15 m
      // (docs/typology/08-vinyl-rowhouse.md §1.2, modal 0.75), and a full flight in
      // front of a two-storey vinyl house is a Manhattan building standing in
      // Greenpoint. Scaled to a 1.05 m landing — nycDress reads the same factor for
      // its door height, so the stairs still land on the door.
      if (WB13 && best && best.sty === STYLE.FRAME_HOUSE) { sy = WB13_STOOP_SY; }
    }
    if (f.k === FURN.FIRE_ESCAPE) {
      // NYC: fire escapes belong to multi-family walk-ups of four storeys and more; the compiler used to
      // emit them on every pre-1950 class-C front, including 3-storey brownstones (owner 2026-09-11).
      // p0 = floors, p1 = floorH * 20 -> height. Guard here for tiles compiled before the rule.
      if (f.p0 <= 3 || (f.p0 * f.p1) / 20 < 11) continue;
      // fixed-height variants — never stretch the members
      const floorsAbove = Math.max(2, Math.min(6, f.p0 - 1));
      const variant = floorsAbove <= 3 ? 'fireEscape3' : floorsAbove === 4 ? 'fireEscape4' : 'fireEscape5';
      const id = inst.claim(variant, wx, f.y, wz, f.rot);
      if (id >= 0) claims.push([variant, id]);
      continue;
    }
    if (f.k === FURN.SCAFFOLD) sx = Math.max(0.4, f.p0 / 10);
    if (f.k === 33) sy = Math.max(0.5, f.p0 / 7);
    // a frontage modelled shop by shop (src/city/namedShops.js) carries its own awnings, or none
    if (f.k === FURN.AWNING && namedShopZone(wx, wz)) continue;
    if (FRONTAGE_HUNG.has(f.k) && tpDropFrontage(wx, wz)) continue;   // TF32: building 59's awnings (the recruiting station replaces it)
    if (f.k === FURN.AWNING) { sx = Math.max(0.5, (f.p1 / 10) / 3.6); color = AWNING_COLORS[f.p0 % AWNING_COLORS.length]; }
    if (f.k === FURN.HYDRANT) color = HYDRANT_COLORS[(wx | 0) % 4 === 0 ? ((wz | 0) % 4) : 0];
    if (f.k === 36) color = [0xb02020, 0x2050a8, 0xc8a000, 0x20702a, 0xe05a10][f.p0 % 5]; // news boxes
    if (f.k === FURN.WATER_TOWER) { const v = 0.85 + (f.p1 / 255) * 0.4; sx = v; sy = 0.9 + (f.p1 / 255) * 0.35; sz = v; }
    const id = inst.claim(pool, wx, f.y, wz, f.rot, sx, sy, sz, color);
    if (id >= 0) claims.push([pool, id]);
    const glowPool = pool + 'Glow';
    if (inst.pools.has(glowPool)) {
      const gid = inst.claim(glowPool, wx, f.y, wz, f.rot, sx, sy, sz);
      if (gid >= 0) claims.push([glowPool, gid]);
    }
    // colliders for chunky items
    if (f.k === FURN.WATER_TOWER) COLLIDERS.addBox(key, { x: wx, y: f.y + 3.5, z: wz, hw: 1.9 * sx, hh: 3.5 * sy, hd: 1.9 * sz, rotY: f.rot });
    if (f.k === FURN.ROOF_BULKHEAD) COLLIDERS.addBox(key, { x: wx, y: f.y + 1.3, z: wz, hw: 1.7, hh: 1.3, hd: 1.4, rotY: f.rot });
  }
  // ground-contact AO skirt mesh (shared unlit alpha material)
  if (skirtV.length) {
    const sg = new THREE.BufferGeometry();
    const n = skirtV.length / 4;
    const sp = new Float32Array(n * 3), sa = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      sp[i * 3] = skirtV[i * 4]; sp[i * 3 + 1] = skirtV[i * 4 + 1]; sp[i * 3 + 2] = skirtV[i * 4 + 2];
      sa[i] = skirtV[i * 4 + 3];
    }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    sg.setAttribute('aA', new THREE.BufferAttribute(sa, 1));
    sg.computeBoundingSphere();
    const sm = new THREE.Mesh(sg, aoSkirtMat());
    sm.renderOrder = 1;
    group.add(sm);
  }
  // BP28: the park's gravel, hedges, chairs and fountain, built by the tile that holds the lawn's centre
  // TP28: the TKTS red steps in Duffy Square, standing on the plaza
  if (tpStepsOwner(ox, oz)) { try { tpBuildSteps(group, padYNear(-1157.65, 2661.15)); } catch (e) { console.warn('tp28 steps', e); } }
  // TF31: the plaza's benches, bollards, cafe tables and planters, for the pieces of plaza in this tile
  if (tpRoadsW) { try { tpBuildFurniture(group, tpRoadsW, (x, z) => sectionY('plaza', x, z, 0.6) ?? padYNear(x, z), ox, oz, key); } catch (e) { console.warn('tf31', e); } }
  // CP32: Central Park's meshes for this tile (each part builds what lies in it)
  if (CPT) cpBuild(group, { ox, oz, key, tile, sampleT, sectionY, surfY, padYNear });
  if (ART) await areaBuild(group, { ox, oz, key, tile, sampleT, sectionY, surfY, padYNear });   // AR34 KIT: the facade kit builds in slices (city/areas.js)
  if (BP28 && bpOwns(ox, oz)) {
    try {
      const [lx, lz] = bpWorld(77, 69);
      const ly = sectionY('grass', lx, lz, 0.5) ?? padYNear(lx, lz);
      bpBuild(group, ly);
    } catch (e) { console.warn('bryant park', e); }
  }
  // per-tile sign text / decal / billboard / shop-sign meshes share one static
  // pool per material across tiles (4 draws per tile -> 4 draws per city)
  const poolHandles = [];
  const poolStatic = (mesh) => {
    if (!ctx.signPools) ctx.signPools = new Map();
    let pool = ctx.signPools.get(mesh.material);
    if (!pool) {
      pool = new StaticPool(ctx.scene, mesh.material, {
        attrs: { position: 3, normal: 3, uv: 2 }, capVerts: 65536, castShadow: false, receiveShadow: false,
        renderOrder: mesh.renderOrder, name: 'signs:' + (mesh.material.name || mesh.material.type),
      });
      ctx.signPools.set(mesh.material, pool);
    }
    const h = pool.alloc(mesh.geometry);
    mesh.geometry.dispose();
    if (h) poolHandles.push([pool, h]);
  };
  // street name text quads glued to the sign blades (disposes with the tile)
  // + address numerals over entrance doors (procedural numbers — PLUTO house
  // numbers are not serialized; the cue matters at eye level, not the digits)
  const plaques = [];
  for (const r of heroRecs) {
    if (r.doorI < 0 || !(r.doorPack >= 8)) continue;
    if (r.flags & BF.STOREFRONT) continue;           // fascia signs own that zone
    if (r.style === STYLE.ROWHOUSE) continue;        // stoop door sits higher
    const nring = r.ring.length;
    const [ax, az] = r.ring[r.doorI], [bx2, bz2] = r.ring[(r.doorI + 1) % nring];
    const ex = bx2 - ax, ez = bz2 - az;
    const lenW = Math.hypot(ex, ez);
    if (lenW < 3.4) continue;
    const ddx = ex / lenW, ddz = ez / lenW;
    const nnx = ez / lenW, nnz = -ex / lenW;
    const dBay = Math.floor(r.doorPack / 8) - 1;
    if (dBay < 0) continue;
    const bayN = Math.floor((lenW - 0.44) / r.winW);
    const sideM = (lenW - Math.max(bayN, 0) * r.winW) * 0.5;
    const uD = Math.min(lenW - 2.1, Math.max(0.6, sideM + (dBay + 0.5) * r.winW - 0.75));
    const hsh = Math.abs(Math.sin(r.cx * 12.9898 + r.cz * 78.233) * 43758.5453) % 1;
    // bounded variety (8x8 = 64 numbers) so plaques cannot crowd street
    // names out of the shared text atlas
    const num = `${1 + Math.floor(hsh * 8)}${11 + Math.floor(((hsh * 977) % 1) * 8) * 11}`;
    plaques.push({
      x: ax + ddx * (uD + 0.75) + nnx * 0.09, y: r.baseY + 2.88,
      z: az + ddz * (uD + 0.75) + nnz * 0.09,
      ax: ddx, az: ddz, text: num,
    });
  }
  try {
    const st = buildSignText(signTexts, plaques);
    if (st) poolStatic(st);
  } catch (e) { console.warn('sign text', e); }
  // street-level decals: graffiti, posters, stains on street-facing walls
  try {
    const dm = buildDecals(decalRecs);
    if (dm) poolStatic(dm);
  } catch (e) { console.warn('decals', e); }
  // TS28: the Square's screen stacks, into the tile's own group
  try { const ts = buildTsqScreens(decalRecs); if (ts) group.add(ts); } catch (e) { console.warn('ts28', e); }
  // Times Square billboard district (animated ad panels)
  try {
    const bb = buildBillboards(decalRecs);
    if (bb) poolStatic(bb);
  } catch (e) { console.warn('billboards', e); }
  // storefront sign boxes with generated shop names
  try {
    const sm = buildShopSigns(decalRecs.filter((r) => r.store && r.storeH > 2));
    if (sm) poolStatic(sm);
  } catch (e) { console.warn('shop signs', e); }

  const roadsOut = [...roadsOf(tile)].map((r) => ({
    ...r,
    pts: Array.from({ length: r.len }, (_, i) => [
      tile.S.roadVerts[(r.start + i) * 3] + ox,
      tile.S.roadVerts[(r.start + i) * 3 + 1],
      tile.S.roadVerts[(r.start + i) * 3 + 2] + oz,
    ]),
    name: tile.header.names[r.nameIdx] || '',
  }));
  const nodesOut = (tile.header.nodes || []).map(([x, z, sig]) => ({ x: x + ox, z: z + oz, signal: !!sig }));
  // exact sidewalk surface height at (x, z) from the tile's own sidewalk
  // triangles (4 m spatial hash; falls back to terrain + flag datum). The
  // terrain grid is 16 m per cell, so terrain+0.305 was off by tens of cm on
  // Harlem's slopes and the curb ramps sat under the flags.
  // Curb ramps need the flags only, and the section sampler above already
  // holds the sidewalk hash — a second copy of it (which is what this used to
  // build) was the largest single allocation in tile assembly.
  const sidewalkYAt = (x, z) => sectionY('sidewalk', x, z, 0.5);
  // NYC pedestrian ramps at every crosswalk end (runtime, from the road graph)
  try {
    // tiles compiled with detectable-warning plates as ground sections (matId 13/14)
    // keep only the depressed curb nose at runtime — no double plates
    const hasWarn = !!((tile.S.warn && tile.S.warn.length) || (tile.S.warnIron && tile.S.warnIron.length));
    placeCurbRamps({ roads: roadsOut, nodes: nodesOut, hasWarn }, (pool, wx, wy, wz, rot) => {
      const id = inst.claim(pool, wx, wy, wz, rot);
      if (id >= 0) claims.push([pool, id]);
      // ramp top = the flags it cuts into; where the band has a hole the old
      // fallback was `terrain + 0.305`, which put the red plate 2.5 cm above
      // the flags either side of it (and 30 cm above bare terrain).
    }, (x, z) => { const y = sidewalkYAt(x, z); return y !== null ? y : padYNear(x, z); });
  } catch (e) { if (!window.__rampErr) { window.__rampErr = 1; console.warn('curb ramps', e); } }

  if (DISPOSE_OWNED) registerOwned(key, group);   // SPACE r2: what this tile draws with (two tiles' materials are shared: kept)
  if (LOWMEM) { freeArraysAfterUpload(group, geoMark); lateSweep(group, geoMark); }   // SPACE r2 (?lowmem=1): the tile's own static geometry lets its arrays go once uploaded
  return {
    group,
    facadeMat: facMat,
    hideTex: facMat.userData.hideTex || null,
    bldgs: heroRecs,
    towers: towerRecs,   // TW
    roads: roadsOut,
    nodes: nodesOut,
    terrain: { grid: tile.S.terrain, res: tile.header.res, ox, oz },
    // the tile's own top-surface sampler, published so that anything which
    // stands on the ground (peds, the player, later the vehicle sim) can ask
    // the pavement its height instead of guessing a lift off the terrain grid.
    surfaceY: (x, z) => { const y = padYAt(x, z, 0.45), g = y !== null ? grassOver(x, z, y) : null; return g !== null ? g : y; },   // GT26: the top
    // …and WHAT that surface is ({kind, y, road}), so a sim can refuse to put a
    // parked car on a lawn or a pedestrian in a traffic lane.
    surfaceInfo: (x, z, tol = 0.4) => surfaceKindAt(x, z, tol),
    // …and whether there is CARRIAGEWAY under (x, z) at all, whatever is drawn over it: the OSM crossing footways are
    // 'path' polygons laid over the junction asphalt, and surfaceInfo answers 'path' there (sim/peds.js edge ends)
    roadAt: (x, z, tol = 0.25) => ROAD_KINDS.some((k) => sectionY(k, x, z, tol) !== null),
    culledOnRoad,
    vgPits,                                  // VG36 (GROUND, world/vg36Pits.js)
    cyCourts,                                // CY12: light courts realised in this tile
    fpPents,                                 // FP18: penthouse storeys drawn in this tile
    cyDropped,                               // CY12: …and dropped by a massing branch that cannot hold one
    strandedInRoad,
    dispose: (scene, instancer) => {
      for (const [pool, id] of claims) instancer.release(pool, id);
      for (const [p, h] of poolHandles) p.free(h);
      if (ctx.signalReg) {
        for (let i = ctx.signalReg.length - 1; i >= 0; i--) if (ctx.signalReg[i].tile === key) ctx.signalReg.splice(i, 1);
      }
      group.traverse((n) => { if (n.geometry && n.geometry !== undefined) n.geometry.dispose?.(); });
      // SPACE r2: a part's own unload hook (userData.onDispose: geometries it swaps in and out, caches it fills per tile)
      if (DISPOSE_OWNED) group.traverse((n) => { const f = n.userData && n.userData.onDispose; if (typeof f === 'function') try { f(); } catch (e) { console.warn('[tile] onDispose', e); } });
      scene.remove(group);
      if (facMat !== ctx.facadeMat) { facMat.userData.hideTex?.dispose(); facMat.dispose(); }
      // SPACE r2 (world/disposeOwned.js): the materials and textures only this tile drew with (the area kits' signs,
      // storefronts and painted art) go too; they were left on the GPU and in memory at every unload. `?space2dispose=0` off.
      if (DISPOSE_OWNED) disposeOwned(group, scene, key);
      COLLIDERS.removeTile(key);
    },
  };
}
function TILE_OF() { return 512; }
const DISPOSE_OWNED = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('space2dispose') === '0');
