// CP32F — Central Park's trees, lamps, benches and litter baskets (part of city/centralPark.js; docs/notes/central-park-flora.md).
// `?cp32f=0` restores what the compiled city had here.
//
// What the compiled park had: ~430 trees scattered at random over the lawns and the lakes, 71 census street trees and
// 32 "yard" trees inside the park, and the drives dressed as city streets: 396 cobra-head lamps, 236 sign poles,
// dumpsters, news boxes and mailboxes along them. The real park has ~18,000 trees, about half of it under canopy: woods
// (the Ramble, the North Woods, the Hallett sanctuary), groves and tree-lined paths round open meadows (Sheep Meadow,
// the Great Lawn, the North and East Meadows) that have trees only at their edges.
//
// TREES. Planted where the canopy is: the USGS NAIP orthoimagery (public domain; 4 bands with near-infrared, 0.6 m)
// classified into canopy and lawn by NDVI, the green/NIR ratio and the NIR texture, the canopy split into crowns by a
// watershed of its NIR from each sunlit crown top, a trunk at each crown's centroid (moved off the water, drives, paths,
// steps, buildings, hard pitches and plazas), the crown width from the crown's area; OpenStreetMap's mapped trees take
// the place of the crowns they stand in; the Mall's four rows of American elms by rule (tools/cp/flora_*.py, baked in
// city/cpFloraData.js). Each tree is one of the kit's species forms (furnitureKit TREE_FORMS) by where it stands:
// woodland mixes (oak, maple, black locust, black cherry and the small understorey trees), London planes, elms and pin
// oaks along the drives, the Reservoir's and Cherry Hill's cherries, the Conservatory Garden's crabapples, the Pinetum.
// The records go through the city's own tree path (world/assemble.js FURN.TREE): the TV25 form pools, their LOD and far
// shadow proxies, the TC13/FD14 allometry. So this module turns (form, crown width) into the kit's species index p0 and a
// trunk diameter p1 that the allometry sizes to that crown, and nudges each trunk by at most 0.35 m to the point at which
// the kit's own position hash (treePoolFor) routes that species to the intended form.
//
// LAMPS, BENCHES, LITTER BASKETS (tools/cp/flora_furn.py): OpenStreetMap's mapped ones where they are, elsewhere along
// the paved paths and the drives, the Mall's continuous benches; built per tile as one instanced mesh per kind, on the
// tile's ground; the lamps join world/cityLamps.js at night; every bench place is a seat for the crowd (seats()).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FURN } from '../shared/geo.js';
import { ENV, applyLightTrim, applyCityAO, applySnowCap } from '../world/materials.js';
import { lampSpots } from '../world/life.js';
import { TREE_SPECIES, TREE_ARCH, TREE_FORMS, TV25, tv25Spec, treePoolFor } from './furnitureKit.js';
import { CP_FORMS, CP_TREES, CP_PARK, CP_TRANSVERSE, CP_LAMPS, CP_BENCHES, CP_BASKETS, CP_SP37, CP_SP, CP_SPCH, CP_SPECIES, CP_WOODMIX } from './cpFloraData.js';
import { cpOnRock, cpWaterY, cpNearCoped } from './cpLand.js';
import { WOODS } from './cpLandData.js';
import { cpbInside } from './cpBethesda.js';
import { cpLmKeepOut } from './cpLandmarks.js';
import { bridgeShrubSpots } from './cpBridges.js';   // CP34: the thickets at Gapstow's and Bow Bridge's ends
import { lampKit, benchKit, basketKit, fenceKit } from './cpFurnKit.js';
import { pgDriveHit } from '../world/placeGuard.js';   // TERRAIN INT2
import { cpDriveFurniture } from './cpDrives.js';
import { HA_P1 } from '../world/heightAuthority.js';
import { COLLIDERS } from './colliders.js';   // SPACE r2: the hoop fence as a walker's barrier
import { cpBarkMat, elmForms, willowForms, shrubForms, fernForms, groundForms, lodSet, grassField, filmPath, ELM_H, ELM_W, WILLOW_H, WILLOW_W, SHRUB_H, SHRUB_W } from './cpFloraKit.js';
import { mallSurface } from './cpMall.js';   // CP33: the Mall's promenade surface (cpMall.js)
import { cpFarEnsure } from './cpFar.js';   // CP33: the park past the near tiles (cpFar.js)
import { VG37, vg37Tile, vg37UnderForms, vg37CoverForms, vg37LeafMat, vg37Blocked } from '../world/vg37.js';   // VG37 (GROUND): shrubs from scanned leaves, the park's hedges and beds

export const CP32F = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp32f') === '0');

// ---- the park's outline and its transverse roads (world metres)
const PARK = [];
for (let i = 0; i < CP_PARK.length; i += 2) PARK.push([CP_PARK[i] / 10, CP_PARK[i + 1] / 10]);
const PB = PARK.reduce((b, [x, z]) => [Math.min(b[0], x), Math.max(b[1], x), Math.min(b[2], z), Math.max(b[3], z)], [1e9, -1e9, 1e9, -1e9]);
export function cpInPark(x, z) {
  if (x < PB[0] || x > PB[1] || z < PB[2] || z > PB[3]) return false;
  let c = false;
  for (let i = 0, j = PARK.length - 1; i < PARK.length; j = i++) {
    const [xi, zi] = PARK[i], [xj, zj] = PARK[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
const segDist = (L, x, z) => {
  let best = 1e9;
  for (let i = 0; i + 1 < L.length; i++) {
    const [ax, az] = L[i], [bx, bz] = L[i + 1], dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - t * dx, z - az - t * dz));
  }
  return best;
};
const TRANSV = CP_TRANSVERSE.map((a) => { const p = []; for (let i = 0; i < a.length; i += 2) p.push([a[i] / 10, a[i + 1] / 10]); return p; });
const nearTransverse = (x, z, r) => TRANSV.some((L) => segDist(L, x, z) < r);
const edgeDist = (x, z) => segDist([...PARK, PARK[0]], x, z);

// ---- compiled furniture this part replaces. Trees: the compiler's scatter (and its yard trees) inside the park, and the
// census points more than 6 m inside the park wall (the perimeter sidewalks' street trees stay); the canopy above plants
// the park's own. The drives were compiled as city streets: their cobra-head lamps, sign poles, street signs, litter
// bins, news boxes, mailboxes, dumpsters and the like go (the park's own lamps and baskets replace them), except on the
// four transverse roads, which are city streets. Signals, hydrants and subway entrances stay.
const DROP_KINDS = new Set([FURN.LAMP_COBRA, FURN.LAMP_CROOK, FURN.STREET_SIGN, FURN.LITTER, FURN.MAILBOX, FURN.NEWSSTAND,
  FURN.BENCH, FURN.AWNING, FURN.PHONE, FURN.PLANTER, FURN.PARKING_METER, FURN.CONE, 34, 35, 36, 37, 38]);
export function dropFurniture(wx, wz, f) {
  if (!CP32F || !cpInPark(wx, wz)) return false;
  if (f.k === FURN.TREE) return !(f.p2 & 1) || edgeDist(wx, wz) > 6;
  return DROP_KINDS.has(f.k) && !nearTransverse(wx, wz, 14);
}

// ---- the trees
// form -> the census species index (TREE_SPECIES) that furnitureKit TREE_FORM_MIX routes to it (0 = "other": elm/zelkova,
// sophora/ash-round, small ornamental, purple plum, by the kit's position hash)
const P0 = { P: 1, H: 2, R: 3, G: 4, Q: 5, L: 6, M: 7, Y: 8, Z: 0, S: 0, W: 0, X: 0 };
// world/assemble.js tree sizing (TC13 allometry with the FD14 envelope, the defaults): height and spread factors for a
// trunk of `dbh` inches of species `sp`
function allometry(sp, dbh) {
  const sH = Math.max(0.55, Math.min(1.52, (0.46 + 0.80 * Math.sqrt(dbh / 24)) * sp.s));
  const sW = Math.max(0.45, Math.min(1.42, sH * (sp.w ?? 1) * (0.80 + 0.40 * Math.min(1, dbh / 26))));
  return [sH, sW];
}
// the trunk diameter whose crown is `cw` metres across on a pool built `baseW` wide (clamped to the kit's range)
function dbhFor(sp, baseW, cw) {
  let lo = 4, hi = 60;
  if (baseW * allometry(sp, lo)[1] >= cw) return lo;
  if (baseW * allometry(sp, hi)[1] <= cw) return hi;
  for (let k = 0; k < 24; k++) { const m = (lo + hi) / 2; if (baseW * allometry(sp, m)[1] < cw) lo = m; else hi = m; }
  return Math.round(((lo + hi) / 2) * 10) / 10;
}
// cpFurniture hands each record tile-local and assemble.js adds the tile origin back: the kit hashes THAT position
const rt = (x) => { const o = Math.floor(x / 512) * 512; return (x - o) + o; };
const formOf = (pool) => pool.slice(4).replace(/\d+$/, '');
const frac = (v) => v - Math.floor(v);

let _recs = null;
export const CP32F_STATS = { trees: 0, byForm: {}, bySource: [0, 0, 0], nudgeMiss: 0, tiles: {} };
export function furniture() {
  if (!CP32F || DIRECT) return [];   // (DIRECT: the trees are claimed in build(), below)
  if (_recs) return _recs;
  const out = [];
  const S = CP32F_STATS;
  for (let i = 0; i < CP_TREES.length; i += 4) {
    const x0 = CP_TREES[i] / 10, z0 = CP_TREES[i + 1] / 10, cw = CP_TREES[i + 2] / 10, code = CP_TREES[i + 3];
    const F = CP_FORMS[code & 15], src = (code >> 4) & 3;
    const p0 = P0[F] ?? 0;
    const sp = TREE_SPECIES[p0] || TREE_SPECIES[0];
    let x = x0, z = z0, pool = null;
    if (TV25) {
      // the trunk nudge (golden-angle spiral, 5 cm steps, <= 0.35 m) at which the kit's hash picks this form
      for (let k = 0; k < 48; k++) {
        const a = k * 2.39996, r = 0.05 * Math.sqrt(k);
        const xx = x0 + Math.cos(a) * r, zz = z0 + Math.sin(a) * r;
        const pl = treePoolFor(p0, rt(xx), rt(zz), 20, 0);
        if (formOf(pl) === F) { x = xx; z = zz; pool = pl; break; }
      }
      if (!pool) { S.nudgeMiss++; pool = treePoolFor(p0, rt(x), rt(z), 20, 0); }
    }
    const spec = pool ? tv25Spec(pool) : null;
    const baseW = spec ? spec.W : (TREE_ARCH[sp.arch] || TREE_ARCH.A).w;
    const dbh = dbhFor(sp, baseW, cw);
    out.push({ k: FURN.TREE, x, z, rot: frac(Math.sin(i * 0.731 + 1.7) * 43758.5453) * 6.2832, p0, p1: dbh, p2: 0 });
    const f2 = pool ? formOf(pool) : F;
    S.byForm[f2] = (S.byForm[f2] || 0) + 1;
    S.bySource[src] = (S.bySource[src] || 0) + 1;
    const tk = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`;
    S.tiles[tk] = (S.tiles[tk] || 0) + 1;
  }
  S.trees = out.length;
  if (typeof window !== 'undefined') window.__CP32F = S;
  return (_recs = out);
}

// ---- DIRECT CLAIMS (07:25, after the first renders). Through furniture records the kit's allometry caps a crown at
// 15.3 m across (the FD14 envelope), and seen from above a kit crown covers ~0.6 of its nominal width (a round crown,
// the gaps between its clumps, the sparser far LOD): the park's measured canopy (45.8 % of the park) rendered as
// scattered trees on a lawn (shots/cp32/flora/r1 fTopLake, cpBethesdaHigh). So in the browser the park's trees are
// claimed straight into the kit's TV25 pools (the same pools, 90 m LOD, far-shadow proxies and draw calls as the census
// trees; the instancer adds its own yaw, lean, crown stretch and tint) at the measured crown width x CW_K and a height
// from the crown width, and handed back when the tile goes. furniture() keeps the record path for ?tv25=0 and node.
const DIRECT = TV25 && typeof window !== 'undefined';
// tuning without a code change: `?cp32fk=<crown width factor>` (default 1.3), `?cp32fn=<share of the trees kept>`
// (default 1: a thinner park drops trees by hash, the small understorey ones first)
const QF = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const CW_K = Math.max(0.5, Math.min(2, Number(QF?.get('cp32fk')) || 1.3));
const KEEP = Math.max(0, Math.min(1, QF?.has('cp32fn') ? Number(QF.get('cp32fn')) : 1));
// height from the drawn crown width (m): 4 m of clear trunk and a crown about as tall as it is wide, by form (a
// cherry is wide and low, a ginkgo or a pin oak tall and narrow); park trees are 12-25 m (the Mall's elms ~26 m)
const HK = { P: 1.05, H: 1.0, R: 0.9, Q: 1.12, M: 0.95, L: 1.0, G: 1.15, Y: 0.72, Z: 1.1, S: 1.0, X: 0.8, W: 0.8 };
const heightOf = (F, cw, m = 1) => Math.min(30, 5.0 + 1.15 * Math.min(cw, 22) + 0.3 * Math.max(0, cw - 22)) * (HK[F] || 1) * m;   // (CP33: was 4 + cw, capped 28: the Ramble's canopy is 20-25 m)
// an open-grown tree (a lawn's or a path's, not the woods'): lower and broader for its crown, its limbs low (the kit's
// forms are street trees, limbed up a quarter of their height, so a lower tree of the same spread drops its crown)
const heightOpen = (F, cw, m = 1) => Math.min(30, 3.0 + 1.25 * Math.min(cw, 22) + 0.3 * Math.max(0, cw - 22)) * (HK[F] || 1) * m;   // (CP33: was 2.5 + 0.92 cw, capped 26: "the lawn-edge trees read young, 20-28 m in the park")
const _spec = new Map();
const specOf = (pool) => { let s = _spec.get(pool); if (s === undefined) _spec.set(pool, (s = tv25Spec(pool))); return s; };
let _tbins = null;
function treeBins() {
  if (_tbins) return _tbins;
  const B = new Map();
  for (let i = 0; i < CP_TREES.length; i += 4) {
    const x = CP_TREES[i] / 10, z = CP_TREES[i + 1] / 10, cw = CP_TREES[i + 2] / 10, code = CP_TREES[i + 3];
    const k = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`;
    let b = B.get(k); if (!b) B.set(k, (b = []));
    b.push([x, z, cw, CP_FORMS[code & 15], (code >> 4) & 3, (code >> 6) & 1, (code >> 7) & 1, CP_SP37 ? CP_SPCH.indexOf(CP_SP[i >> 2]) : -1]);
  }
  return (_tbins = B);
}
export const CP32F_CLAIMS = { tiles: {}, trees: 0, miss: 0, sp: {} };
// the schist outcrops (cpLand.js: rounded humps 0.5-4 m): no trunk, lamp or bench on one
const onRock = (x, z) => { try { return cpOnRock(x, z); } catch (e) { return false; } };
// ...nor in the water (LAND's bodies and streams, 0.3 m inside the shore)
const inWater = (x, z) => { try { return cpWaterY(x, z, 0.3) !== null; } catch (e) { return false; } };
// ...nor on Conservatory Water's esplanade (cpLand.js cpNearCoped: 8 m round the shore)
const nearCoped = (x, z) => { try { return cpNearCoped(x, z); } catch (e) { return false; } };
// THE GROUND a trunk, a lamp, a bench or a basket stands on (CPFIX, 2026-09-30; docs/notes/central-park-fix.md). The
// tile's padYNear answers from the nearest section triangle's PLANE up to 0.35 m outside it and, where no section
// covers the point, from the highest answer of a ring 1.2 m round it. Beside the clipped slivers where the park's
// ground meets the transverse roads, the park wall and the bridges' approaches that plane is ill-conditioned: the
// in-page audit found trunks 12-69 m in the air (the owner's "trees flying far in the sky") and 3-11 m under the lawn.
// Here: the top surface that contains the point exactly (inside the triangle, no extrapolation): the lawn, or a path
// laid on it (up to 0.3 m over it); where no section covers the ground (e.g. along the park wall) the drawn terrain
// under it (the tile's grid with the renderer's diagonal split). A trunk under a hard surface more than 0.3 m over the
// lawn (a bridge's deck or raised approach, a terrace: r1 found five, 0.5-2.5 m under one) or on one standing clear of
// the terrain (a deck with no lawn under it) is not planted (null); a lamp, a bench or a basket stands on it.
const OTHER_KINDS = ['path', 'sidewalk', 'brick', 'plaza', 'gravel', 'gutter', 'asphalt'];
// `?cpft=0`: the tile's padYNear again (the flying trees, for an A/B)
const CPFT = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cpft') === '0');
function terrainY(ctx, x, z) {
  const T = ctx.tile && ctx.tile.S && ctx.tile.S.terrain, res = ctx.tile && ctx.tile.header && ctx.tile.header.res;
  if (!T || !res) return ctx.sampleT(x, z);
  const n = res + 1;
  const fx = Math.min(res - 0.001, Math.max(0, ((x - ctx.ox) / 512) * res)), fz = Math.min(res - 0.001, Math.max(0, ((z - ctx.oz) / 512) * res));
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
  const y00 = T[j * n + i], y10 = T[j * n + i + 1], y01 = T[(j + 1) * n + i], y11 = T[(j + 1) * n + i + 1];
  return u >= v ? y00 + u * (y10 - y00) + v * (y11 - y10) : y00 + v * (y01 - y00) + u * (y11 - y01);
}
function groundAt(ctx, x, z, tree = false) {
  if (!CPFT || !ctx.sectionY) return ctx.padYNear(x, z);
  let g = ctx.sectionY('grass', x, z, 0);
  if (g !== null && !isFinite(g)) g = null;
  let best = null;
  for (const k of OTHER_KINDS) { const y = ctx.sectionY(k, x, z, 0); if (y !== null && isFinite(y) && (best === null || y > best)) best = y; }
  if (g !== null) return best === null || best <= g ? g : best <= g + 0.3 ? best : tree ? null : best;
  if (best !== null) return tree && best > terrainY(ctx, x, z) + 1.0 ? null : best;
  return terrainY(ctx, x, z);
}
if (typeof window !== 'undefined') window.__CP32F_GROUND = { groundAt, terrainY };
const ROCK_STEP = [[2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5], [1.8, 1.8], [-1.8, 1.8], [1.8, -1.8], [-1.8, -1.8], [4, 0], [-4, 0], [0, 4], [0, -4]];
// live claim sets and meshes, for the in-page A/B (window.__CP32F_SET / __CP32F_AB)
const _sets = new Set(), _meshes = new Set();
const _lampSeen = new Set();   // SPACE r2: the park lamps already in world/life.js lampSpots
if (typeof window !== 'undefined') window.__CP32F_SETS = _sets;   // the tree audit (docs/notes/central-park-fix.md) reads the claims
let _on = true;
const claimSet = (inst, S) => { S.ids = S.spec.map(([p, x, y, z, rot, sW, sH, col]) => inst.claim(p, x, y, z, rot, sW, sH, sW, col)); };
const releaseSet = (inst, S) => { if (S.ids) S.spec.forEach(([p], i) => { if (S.ids[i] >= 0) inst.release(p, S.ids[i]); }); S.ids = null; };
// CP33 (review: "the canopy is a bright lime and yellow-green with little variation between trees ... a stock game
// asset"): each crown's albedo multiplier by species group, its value and saturation about 15 % down (green taken down
// more than red, blue kept: a deeper green, less yellow), with a per-tree value (+-10 %) and hue jitter
const CANOPY = { P: [0.84, 0.86, 1.0], H: [0.88, 0.88, 0.98], R: [0.76, 0.82, 1.0], Q: [0.70, 0.76, 0.96], M: [0.76, 0.80, 1.0],
  L: [0.80, 0.84, 1.0], G: [0.86, 0.86, 0.96], Y: [0.84, 0.78, 1.0], Z: [0.76, 0.82, 1.0], S: [0.78, 0.82, 1.0], X: [0.95, 0.92, 1.0], W: [0.80, 0.80, 1.0] };
const _cc = new THREE.Color();
const tone = (b, x, z, k = 1) => {
  const h1 = frac(Math.sin(x * 7.13 + z * 3.71 + k) * 43758.5453), h2 = frac(h1 * 57.3 + 0.31);
  const v = 0.9 + 0.2 * h1, hj = (h2 - 0.5) * 0.09;
  return [Math.min(1, b[0] * v * (1 + hj)), Math.min(1, b[1] * v), Math.min(1, b[2] * v * (1 - hj * 0.6))];
};
// SP37 (docs/notes/cp-species.md): a trim on a form's crown tone and height for the species the kit has no form of its own
// for, [tone r, g, b, height factor]. The commonest tree of the park is the black cherry (18.7 % of the Conservancy's 1982
// survey, "the most common tree in Central Park"): the kit's Y is a Kwanzan, low and wide and a light green, so a black
// cherry takes Y's crown at 1.38 x its height factor (a woodland tree, 18-25 m) and a darker, glossier tone; the rest are
// small hue and value steps that tell the oaks, maples, locust, ash, tulip tree and sweetgum apart.
const SP_TRIM = { bc: [0.90, 0.93, 1.0, 1.38], bl: [1.0, 1.04, 1.06, 1.0], nm: [0.96, 0.97, 1.0, 1.0], sm: [0.94, 0.94, 1.0, 1.0],
  rm: [1.04, 1.0, 1.0, 1.0], ro: [0.90, 0.90, 1.0, 1.0], to: [0.86, 0.88, 1.0, 1.0], oo: [0.92, 0.92, 1.0, 1.0],
  wa: [1.04, 1.04, 1.0, 1.0], hk: [1.04, 1.06, 0.98, 1.0], mb: [1.06, 1.08, 1.0, 1.0], tt: [1.15, 1.12, 1.04, 1.1],
  sg: [1.08, 1.06, 1.0, 1.0], bt: [0.95, 0.98, 1.0, 1.0] };
const spTrim = (sp) => (sp >= 0 ? SP_TRIM[CP_SPECIES[sp][0]] : undefined);
function canopyHex(F, x, z, con, trim) {
  if (con) return 0x8fa996;
  const b0 = CANOPY[F] || CANOPY.S;
  const c = tone(trim ? [Math.min(1, b0[0] * trim[0]), Math.min(1, b0[1] * trim[1]), Math.min(1, b0[2] * trim[2])] : b0, x, z);
  return _cc.setRGB(c[0], c[1], c[2]).getHex();
}
// (terrain veg lane, world/vegP1.js: the same crown tone for a species index)
export const cpCanopyHex = (F, x, z, con, sp) => canopyHex(F, x, z, con, spTrim(sp));
// CP33 (review: "from 260 m the south end reads as savanna ... the real south end is closed canopy"): inside OSM's woods
// the crowns are drawn wider (x 1.55 of the measured width, against 1.3 elsewhere) and the gaps are filled: a tree of the
// woodland mix on a jittered 8 m lattice wherever no measured crown stands within 8 m (not on water, rock or a path)
const CW_WOOD = 1.55;
const WOOD_MIX = ['Q', 'Q', 'M', 'S', 'Z', 'W', 'P', 'L', 'M', 'W'];
// (SP37: the lattice fill takes the woodland species mix of flora_species.py instead, CP_WOODMIX: one species character a slot)
const WOOD_SP = CP_SP37 ? [...CP_WOODMIX].map((ch) => CP_SPCH.indexOf(ch)) : null;
const WOODP = WOODS.map((w) => {
  let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
  for (let i = 0; i < w.outer.length; i += 2) { x0 = Math.min(x0, w.outer[i]); x1 = Math.max(x1, w.outer[i]); z0 = Math.min(z0, w.outer[i + 1]); z1 = Math.max(z1, w.outer[i + 1]); }
  return { outer: w.outer, holes: w.holes || [], bb: [x0, z0, x1, z1] };
});
const pipFlat = (R, x, z) => {
  let c = false;
  const n = R.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = R[i * 2], zi = R[i * 2 + 1], xj = R[j * 2], zj = R[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
function inWoods(W, x, z) {
  for (const w of W) {
    if (x < w.bb[0] || x > w.bb[2] || z < w.bb[1] || z > w.bb[3]) continue;
    if (pipFlat(w.outer, x, z) && !w.holes.some((h) => pipFlat(h, x, z))) return true;
  }
  return false;
}
const woodsOf = (ox, oz, m = 0) => WOODP.filter((w) => w.bb[2] > ox - m && w.bb[0] < ox + 512 + m && w.bb[3] > oz - m && w.bb[1] < oz + 512 + m);
// a path, a walk or a road within r of (x, z) (nothing is planted there)
const hardNear = (ctx, x, z, r) => {
  if (!ctx.sectionY) return false;
  for (const k of OTHER_KINDS) if (ctx.sectionY(k, x, z, r) !== null) return true;
  return false;
};
const hh = (x, z, k) => frac(Math.sin(x * (12.9898 + k) + z * (78.233 - k * 0.7) + k * 3.1) * 43758.5453);
function fillWoods(ctx, L) {
  const W = woodsOf(ctx.ox, ctx.oz);
  if (!W.length) return [];
  const cell = new Map(), C = 8;
  const key = (i, j) => i * 100003 + j;
  for (const t of L) { const k = key(Math.floor(t[0] / C), Math.floor(t[1] / C)); let a = cell.get(k); if (!a) cell.set(k, (a = [])); a.push(t); }
  const near = (x, z, r) => {
    const i0 = Math.floor((x - r) / C), i1 = Math.floor((x + r) / C), j0 = Math.floor((z - r) / C), j1 = Math.floor((z + r) / C);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const a = cell.get(key(i, j)); if (a) for (const t of a) if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < r * r) return true; }
    return false;
  };
  const out = [];
  for (let gx = ctx.ox + 4; gx < ctx.ox + 512; gx += 8) for (let gz = ctx.oz + 4; gz < ctx.oz + 512; gz += 8) {
    const x = gx + (hh(gx, gz, 1) - 0.5) * 5, z = gz + (hh(gx, gz, 2) - 0.5) * 5;
    if (!inWoods(W, x, z) || near(x, z, 8)) continue;
    if (onRock(x, z) || inWater(x, z) || hardNear(ctx, x, z, 2.5)) continue;
    const sp = WOOD_SP ? WOOD_SP[Math.floor(hh(x, z, 3) * WOOD_SP.length)] : -1;
    const F = sp >= 0 ? CP_SPECIES[sp][3] : WOOD_MIX[Math.floor(hh(x, z, 3) * WOOD_MIX.length)];
    const t = [x, z, 9 + 5 * hh(x, z, 4), F, 3, sp >= 0 ? CP_SPECIES[sp][4] : 0, 1, sp];
    out.push(t);
    const k = key(Math.floor(x / C), Math.floor(z / C)); let a = cell.get(k); if (!a) cell.set(k, (a = [])); a.push(t);
  }
  return out;
}
function claimTrees(group, ctx) {
  const inst = window.__INST || window.__INSTANCER;
  const L0 = treeBins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`) || [];
  if (!inst) return [];
  let L = L0;
  try { if (CP33L) L = L0.concat(fillWoods(ctx, L0)); } catch (e) { console.warn('[cp33] fillWoods', e); }
  if (!L.length) return [];
  const S = { spec: [], ids: null, inst };
  const elms = [];
  const spc = (CP32F_CLAIMS.sp[ctx.key] = {});
  let miss = 0, rock = 0, deck = 0;
  for (const [x0, z0, cw, F, src, con, wood, sp] of L) {
    // the Mall's elms are the kit's American elm (cpFloraKit.js), not a pool tree
    if (CP33L && src === 2) { elms.push([x0, z0, cw]); continue; }
    // (thinning: a tree's keep threshold rises with its crown, so the understorey goes first)
    if (KEEP < 1 && src !== 2 && frac(Math.sin(x0 * 3.7 + z0 * 9.1) * 43758.5453) * Math.min(1, 6 / Math.max(cw, 1)) > KEEP * 0.75) continue;
    let x = x0, z = z0;
    if (onRock(x, z)) {
      const st = ROCK_STEP.find(([dx, dz]) => !onRock(x0 + dx, z0 + dz));
      if (!st) { rock++; continue; }
      x = x0 + st[0]; z = z0 + st[1];
    }
    if (inWater(x, z) || (CP33L && nearCoped(x, z))) { rock++; continue; }
    const h1 = frac(Math.sin(x0 * 12.9898 + z0 * 78.233) * 43758.5453), h2 = frac(h1 * 91.3 + 0.17);
    const nv = (TREE_FORMS[F] && TREE_FORMS[F].variants) || 1;
    const pool = 'tree' + F + (nv > 1 && h2 < 0.5 ? '2' : '');
    const P = specOf(pool);
    if (!P) { miss++; continue; }
    const cwD = Math.min(26, cw * (CP33L && wood ? CW_WOOD : CW_K));
    const trim = spTrim(sp);
    const hD = (wood || src === 2 ? heightOf(F, cwD, trim ? trim[3] : 1) : heightOpen(F, cwD, trim ? trim[3] : 1)) * (0.92 + 0.16 * h1);
    const sW = cwD / P.W, sH = hD / P.H;
    const y = groundAt(ctx, x, z, true), rot = h2 * 6.2832;
    if (y === null) { deck++; continue; }
    S.spec.push([pool + 'Trunk', x, y, z, rot, sW, sH, null]);
    // (a conifer drawn by the pin oak's pyramid: its crown darker and cooler, as a pine's needles read against the oaks)
    S.spec.push([pool + 'Crown', x, y, z, rot, sW, sH, CP33L ? canopyHex(F, x0, z0, con, trim) : con ? 0x8fa996 : 0xffffff]);
    if (sp >= 0) { const k = CP_SPECIES[sp][0]; spc[k] = (spc[k] || 0) + 1; }   // (SP37: the claimed species by tile, for the in-page share table)
  }
  if (_on) claimSet(inst, S);
  if (S.ids) miss += S.ids.filter((id) => id < 0).length;
  _sets.add(S);
  // the tile's dispose() disposes every geometry in its group: this one's 'dispose' hands the claims back
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3));
  const sentinel = new THREE.Mesh(sg, new THREE.MeshBasicMaterial());
  sentinel.visible = false; sentinel.name = 'cp32f:treeClaims';
  sentinel.geometry.addEventListener('dispose', () => {
    releaseSet(inst, S); _sets.delete(S);
    group.traverse((o) => { if (_meshes.has(o)) _meshes.delete(o); });
  });
  group.add(sentinel);
  CP32F_CLAIMS.tiles[ctx.key] = S.spec.length / 2;
  CP32F_CLAIMS.trees = Object.values(CP32F_CLAIMS.tiles).reduce((a, b) => a + b, 0);
  CP32F_CLAIMS.miss += miss; CP32F_CLAIMS.rock = (CP32F_CLAIMS.rock || 0) + rock; CP32F_CLAIMS.deck = (CP32F_CLAIMS.deck || 0) + deck;
  window.__CP32F_CLAIMS = CP32F_CLAIMS;
  return elms;
}

// ---- CP33 LANDSCAPE: the elms, the understory, the willows (cpFloraKit.js; docs/notes/central-park-photoreal.md).
// `?cp33l=0` restores the CP32 planting.
const CP33L = CP32F && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp33l') === '0');
// weeping willows at the Lake's edge (review: "either side of Bethesda's lake front, at the Boathouse and at both ends
// of Bow Bridge"): each anchor is moved to the nearest bank point 1-3.5 m from the water, off the paths
const WILLOW_AT = [[-12, 948], [78, 946], [184, 846], [168, 872], [-66, 792], [-28, 790], [-70, 842], [-26, 846], [-188, 872], [-120, 760], [118, 818]];
let _willows = null;
function willowSpots(ctx) {
  if (_willows) return _willows;
  const out = [];
  for (const [ax, az] of WILLOW_AT) {
    let best = null;
    for (let r = 0; r <= 30 && !best; r += 1.5) {
      for (let k = 0; k < Math.max(1, Math.round(r * 2)); k++) {
        const a = (k / Math.max(1, Math.round(r * 2))) * 6.2832, x = ax + Math.cos(a) * r, z = az + Math.sin(a) * r;
        if (inWater(x, z) || cpWaterY(x, z, -1.0) !== null || cpWaterY(x, z, -3.5) === null) continue;
        let bad = false;
        try { bad = cpbInside(x, z, 3) || cpLmKeepOut(x, z); } catch (e) { bad = false; }
        if (bad) continue;
        best = [x, z]; break;
      }
    }
    if (best) out.push(best);
  }
  return (_willows = out);
}
function plant(group, ctx, elms) {
  const inst = window.__INST || window.__INSTANCER;
  const crown = inst && inst.crownMat;
  if (!crown) return;
  const bark = cpBarkMat();
  const { ox, oz } = ctx;
  const t0 = performance.now();
  const n = { elm: 0, willow: 0, shrub: 0, fern: 0 };
  // the Mall's American elms: 25-29 m, crowns 17-24 m (the measured crown x 1.45: the limbs vault over the walk)
  if (elms.length) {
    const E = elmForms(), sets = E.map(() => []);
    for (const [x, z, cw] of elms) {
      const y = groundAt(ctx, x, z, true);
      if (y === null) continue;
      const h1 = hh(x, z, 11), h2 = hh(x, z, 12), v = h2 < 0.5 ? 0 : 1;
      const W = Math.max(17, Math.min(24, cw * 1.45)), H = 25 + 4 * h1;
      sets[v].push({ x, y: y - 0.02, z, yaw: hh(x, z, 13) * 6.2832, sx: W / ELM_W, sy: H / ELM_H, c: tone([0.74, 0.80, 0.96], x, z, 5) });
      n.elm++;
    }
    // (the trunk and limbs in full within 70 m, a plain tube and the limbs to 400 m; the crown's cards in full within 100 m, the light set beyond)
    E.forEach((F, v) => { if (sets[v].length) { group.add(lodSet('cp33:elmT' + v, sets[v], [{ near: F.trunk, mid: F.trunkMid, mat: bark, cast: true, castMid: false }], 70, 400, _meshes)); group.add(lodSet('cp33:elm' + v, sets[v], [{ near: F.leaves0, mid: F.leaves1, mat: crown, cast: true }], 100, 5000, _meshes)); } });
  }
  // the willows
  {
    const Wf = willowForms()[0];
    const L = [];
    for (const [x, z] of willowSpots(ctx)) {
      if (x < ox || x >= ox + 512 || z < oz || z >= oz + 512) continue;
      const y = groundAt(ctx, x, z, true);
      if (y === null) continue;
      const s = 0.85 + 0.3 * hh(x, z, 21);
      L.push({ x, y: y - 0.02, z, yaw: hh(x, z, 22) * 6.2832, sx: s * (0.95 + 0.1 * hh(x, z, 23)), sy: s, c: tone([0.92, 0.96, 0.84], x, z, 7) });
    }
    n.willow = L.length;
    if (L.length) { group.add(lodSet('cp33:willowT', L, [{ near: Wf.trunk, mid: Wf.trunkMid, mat: bark, cast: true, castMid: false }], 90, 400, _meshes)); group.add(lodSet('cp33:willow', L, [{ near: Wf.leaves0, mid: Wf.leaves1, mat: crown, cast: true }], 120, 5000, _meshes)); }
  }
  // the understory: shrubs (2-5 m) through the woods and along every natural bank to the waterline, ferns in the woods
  const W = woodsOf(ox, oz, 4);
  // VG37 (GROUND, world/vg37.js): the understorey's forms from the scanned-leaf atlas (viburnum, spicebush, rhododendron), `?vg37=0` the old ones
  const SF = VG37 ? vg37UnderForms() : shrubForms(), FF = fernForms();
  const shrubs = SF.map(() => []), ferns = FF.map(() => []);
  const ok = (x, z, r) => !(inWater(x, z) || onRock(x, z) || hardNear(ctx, x, z, r)) && !(() => { try { return cpbInside(x, z, 2) || cpLmKeepOut(x, z); } catch (e) { return false; } })();
  const addShrub = (x, z, s) => {
    const y = groundAt(ctx, x, z, true);
    if (y === null) return;
    const v = Math.min(SF.length - 1, Math.floor(hh(x, z, 31) * SF.length));
    shrubs[v].push({ x, y: y - 0.05, z, yaw: hh(x, z, 32) * 6.2832, sx: s * (0.85 + 0.3 * hh(x, z, 33)), sy: s * (0.8 + 0.4 * hh(x, z, 34)), c: tone([0.74, 0.82, 0.92], x, z, 9) });
    n.shrub++;
  };
  // the woods: one shrub a ~6 x 6 m cell (most cells), in thickets and gaps
  if (W.length) for (let gx = ox + 3; gx < ox + 512; gx += 6) for (let gz = oz + 3; gz < oz + 512; gz += 6) {
    const x = gx + (hh(gx, gz, 41) - 0.5) * 4.5, z = gz + (hh(gx, gz, 42) - 0.5) * 4.5;
    if (hh(x, z, 43) > 0.62 || !inWoods(W, x, z) || !ok(x, z, 1.6)) continue;
    addShrub(x, z, 0.65 + 0.75 * hh(x, z, 44));
  }
  // the banks: 1-5 m from the water, off the paths (the lawns' mown banks get fewer)
  for (let gx = ox + 1.75; gx < ox + 512; gx += 3.5) for (let gz = oz + 1.75; gz < oz + 512; gz += 3.5) {
    const x = gx + (hh(gx, gz, 51) - 0.5) * 2.5, z = gz + (hh(gx, gz, 52) - 0.5) * 2.5;
    if (cpWaterY(x, z, -5) === null || cpWaterY(x, z, -0.8) !== null) continue;
    const woods = inWoods(W, x, z);
    if (hh(x, z, 53) > (woods ? 0.7 : 0.38) || !ok(x, z, 2.2)) continue;
    addShrub(x, z, 0.45 + 0.6 * hh(x, z, 54));
  }
  // CP34: the bridges' ends, thick with shrubs from the piers to the water as in the photographs (cpBridges.js bridgeShrubSpots)
  try { for (const [x, z, s] of bridgeShrubSpots()) if (x >= ox && x < ox + 512 && z >= oz && z < oz + 512 && !inWater(x, z) && !onRock(x, z) && !hardNear(ctx, x, z, 0.4)) addShrub(x, z, s); } catch (e) { /* the bridges part is off */ }
  // ferns: in patches through the woods (a 2.6 m lattice where the patch noise is high)
  if (W.length) for (let gx = ox + 1.3; gx < ox + 512; gx += 2.6) for (let gz = oz + 1.3; gz < oz + 512; gz += 2.6) {
    const x = gx + (hh(gx, gz, 61) - 0.5) * 2.2, z = gz + (hh(gx, gz, 62) - 0.5) * 2.2;
    const patch = 0.5 + 0.5 * Math.sin(x * 0.21 + Math.sin(z * 0.13) * 2.0) * Math.sin(z * 0.19 + Math.sin(x * 0.11) * 2.0);
    if (patch < 0.55 || hh(x, z, 63) > 0.7 || !inWoods(W, x, z) || !ok(x, z, 1.0)) continue;
    const y = groundAt(ctx, x, z, true);
    if (y === null) continue;
    const v = hh(x, z, 64) < 0.5 ? 0 : 1, s = 0.7 + 0.6 * hh(x, z, 65);
    ferns[v].push({ x, y: y - 0.03, z, yaw: hh(x, z, 66) * 6.2832, sx: s, sy: s * (0.85 + 0.3 * hh(x, z, 67)), c: tone([0.70, 0.80, 0.86], x, z, 11) });
    n.fern++;
  }
  // ground cover: broad-leaved mounds (ginger, mayapple, ivy) in drifts through the woods, a 2.2 m lattice where the drift noise is high
  const GF = VG37 ? vg37CoverForms() : groundForms(), covers = GF.map(() => []);   // VG37: ivy mats and sedge from the scanned-leaf atlas
  if (W.length) for (let gx = ox + 1.1; gx < ox + 512; gx += 2.2) for (let gz = oz + 1.1; gz < oz + 512; gz += 2.2) {
    const x = gx + (hh(gx, gz, 71) - 0.5) * 1.9, z = gz + (hh(gx, gz, 72) - 0.5) * 1.9;
    const drift = 0.5 + 0.5 * Math.sin(x * 0.083 + Math.sin(z * 0.047) * 2.4) * Math.sin(z * 0.071 + Math.sin(x * 0.059) * 2.1);
    if (drift < 0.5 || hh(x, z, 73) > 0.72 || !inWoods(W, x, z) || !ok(x, z, 0.9)) continue;
    const y = groundAt(ctx, x, z, true);
    if (y === null) continue;
    const v = Math.min(GF.length - 1, Math.floor(hh(x, z, 74) * GF.length)), s = 0.7 + 0.7 * hh(x, z, 75);
    covers[v].push({ x, y: y - 0.03, z, yaw: hh(x, z, 76) * 6.2832, sx: s, sy: s * (0.8 + 0.4 * hh(x, z, 77)), c: tone([0.66, 0.80, 0.74], x, z, 15) });
    n.cover = (n.cover || 0) + 1;
  }
  GF.forEach((F, v) => { if (covers[v].length) group.add(lodSet('cp33:cover' + v, covers[v], [{ near: F.leaves0, mid: F.leaves1, mat: VG37 ? vg37LeafMat() : crown, cast: false }], 36, 80, _meshes)); });
  SF.forEach((F, v) => {
    if (!shrubs[v].length) return;
    const parts = [{ near: F.leaves0, mid: F.leaves1, mat: VG37 ? vg37LeafMat() : crown, cast: false }];
    if (F.trunk) parts.unshift({ near: F.trunk, mid: null, mat: bark, cast: false });
    group.add(lodSet('cp33:shrub' + v, shrubs[v], parts, 75, 260, _meshes));
  });
  FF.forEach((F, v) => { if (ferns[v].length) group.add(lodSet('cp33:fern' + v, ferns[v], [{ near: F.leaves0, mid: F.leaves1, mat: crown, cast: false }], 40, 70, _meshes)); });
  if (typeof window !== 'undefined') { const P = (window.__CP33L = window.__CP33L || { tiles: {} }); P.tiles[ctx.key] = { ...n, ms: +(performance.now() - t0).toFixed(1) }; }
}
// in-page A/B (bshot --evalfile): __CP32F_SET(false) hands every tree claim of the part back and hides its lamps,
// benches and baskets; (true) restores them. __CP32F_AB(ms) samples the frame rate on, off, on again.
if (typeof window !== 'undefined') {
  window.__CP32F_SET = (on) => {
    on = !!on;
    if (on === _on) return _on;
    _on = on;
    for (const S of _sets) { if (on) claimSet(S.inst, S); else releaseSet(S.inst, S); }
    for (const m of _meshes) m.visible = on;
    return _on;
  };
  window.__CP32F_AB = async (ms = 3000) => {
    const wait = (t) => new Promise((r) => setTimeout(r, t));
    const fps = async () => { await wait(900); const a = window.__FRAMES(); await wait(ms); const b = window.__FRAMES(); return +(((b.frames - a.frames) * 1000) / (b.t - a.t)).toFixed(1); };
    const perf = async () => (window.__PERF ? window.__PERF() : null);
    const on1 = await fps(), p1 = await perf();
    window.__CP32F_SET(false);
    const off = await fps(), p0 = await perf();
    window.__CP32F_SET(true);
    const on2 = await fps();
    return { on: on1, off, on2, msOn: +(1000 / ((on1 + on2) / 2)).toFixed(2), msOff: +(1000 / off).toFixed(2), trisOn: p1 && p1.tris, trisOff: p0 && p0.tris, callsOn: p1 && p1.calls, callsOff: p0 && p0.calls, trees: CP32F_CLAIMS.trees, sets: _sets.size };
  };
}

// ---- lamps, benches, litter baskets, built per tile: one instanced mesh per kind (the lamp's iron, its glass, the bench,
// the basket), standing on the tile's ground (padYNear, which the lead's relief re-heights)
const STREET_CAL = [1.94, 1.70, 1.47];   // the street furniture's light trim (city/instancer.js baseMat)
const colorize = (g, hex) => {
  const c = new THREE.Color(hex), n = g.getAttribute('position').count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
};
// a box by its centre (w along x, h up, d along z), tilted rx about x
const cbox = (w, h, d, hex, x, y, z, rx = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return colorize(g, hex);
};
const lathe = (pts, seg, hex) => colorize(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), hex);
const IRON = '#1b231f', GLASS = '#ece6d6', WOOD = '#7b6447', WOOD2 = '#6c563c', PLATE = '#a9aaa2', BASKET = '#243629';

// THE LAMPPOST: Henry Bacon's B pole (1907-10) under Kent Bloomer's luminaire (1980-83). The pole: a flaring base 17 in
// (0.43 m) across, "circumferential chains of seeds and leaves defining the segmented stages" (here the beaded rings at
// the base, the knee and the capital), a fluted shaft, ~11.5 ft (3.5 m) to the luminaire's collar. The luminaire: "an
// upside down glass urn cum lantern secured with metal ribs", a flange girdling it "like the cupped sepals of a calyx",
// an acorn finial (elizabethbarlowrogers.com, "Designing the Central Park Luminaire"). The numbered plate (the nearest
// cross street; odd west, even east) on the shaft.
let _lampGeo = null;
function lampGeos() {
  if (_lampGeo) return _lampGeo;
  const post = lathe([[0.001, 0], [0.215, 0], [0.215, 0.055], [0.19, 0.08], [0.2, 0.115], [0.15, 0.22], [0.108, 0.5],
    [0.12, 0.585], [0.12, 0.63], [0.08, 0.67], [0.078, 1.25], [0.093, 1.29], [0.074, 1.35], [0.064, 2.77], [0.1, 2.9],
    [0.1, 2.96], [0.062, 2.99]], 10, IRON);
  // five flutes on the shaft (between the knee ring and the capital): the radius swings 8 % round the post
  {
    const p = post.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      if ((y > 0.69 && y < 1.23) || (y > 1.37 && y < 2.75)) {
        const x = p.getX(i), z = p.getZ(i), k = 1 + 0.08 * Math.cos(5 * Math.atan2(z, x));
        p.setX(i, x * k); p.setZ(i, z * k);
      }
    }
    post.computeVertexNormals();
  }
  const calyx = lathe([[0.06, 2.985], [0.17, 3.01], [0.2, 3.055], [0.12, 3.075]], 10, IRON);
  const cap = lathe([[0.19, 3.655], [0.2, 3.69], [0.12, 3.8], [0.048, 3.875], [0.058, 3.91], [0.045, 3.975], [0.001, 4.03]], 10, IRON);
  // the ribs: four iron straps over the glass, following its belly
  const ribs = [];
  const RIB = [[0.105, 3.07], [0.218, 3.33], [0.2, 3.59], [0.18, 3.66]];
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.3;
    for (let j = 0; j + 1 < RIB.length; j++) {
      const [r0, y0] = RIB[j], [r1, y1] = RIB[j + 1], len = Math.hypot(r1 - r0, y1 - y0);
      const g = new THREE.BoxGeometry(0.018, len, 0.014);
      g.rotateZ(-Math.atan2(r1 - r0, y1 - y0));
      g.translate((r0 + r1) / 2 + 0.008, (y0 + y1) / 2, 0);
      g.rotateY(a);
      ribs.push(colorize(g, IRON));
    }
  }
  const plate = cbox(0.078, 0.05, 0.008, PLATE, 0, 1.12, 0.083);
  const iron = mergeGeometries([post, calyx, cap, ...ribs, plate], false);
  const glass = lathe([[0.001, 3.05], [0.1, 3.055], [0.2, 3.26], [0.218, 3.42], [0.19, 3.59], [0.172, 3.66], [0.001, 3.665]], 10, GLASS);
  // past LOD_R: a six-sided post, collar, cap and lantern (~90 triangles)
  const ironFar = lathe([[0.001, 0], [0.2, 0], [0.19, 0.12], [0.1, 0.55], [0.12, 0.62], [0.07, 0.7], [0.065, 2.8], [0.1, 2.93],
    [0.2, 3.05], [0.13, 3.075], [0.001, 3.08]], 6, IRON);
  const capFar = lathe([[0.19, 3.655], [0.2, 3.69], [0.05, 3.87], [0.001, 4.03]], 6, IRON);
  const ironF = mergeGeometries([ironFar, capFar], false);
  const glassF = lathe([[0.001, 3.05], [0.2, 3.26], [0.21, 3.45], [0.17, 3.66], [0.001, 3.665]], 6, GLASS);
  for (const g of [iron, glass, ironF, glassF]) { g.computeBoundingSphere(); g.computeBoundingBox(); }
  return (_lampGeo = { iron, glass, ironF, glassF });
}
// THE BENCH: the 1939 World's Fair settee, the park's standard: cast-iron ends and a middle standard, wooden slats, 8 ft
// (2.44 m): five seat slats, three back slats raked 15 deg, arms on the ends. The seat's top 0.45 m up, its front edge at
// local z +0.28 (a seated person faces +z).
let _benchGeo = null;
function benchGeo() {
  if (_benchGeo) return _benchGeo;
  const P = [];
  for (const x of [-1.16, 0, 1.16]) {
    P.push(cbox(0.05, 0.43, 0.05, IRON, x, 0.215, 0.235));              // front leg
    P.push(cbox(0.05, 0.92, 0.05, IRON, x, 0.46, -0.275, -0.14));       // rear leg rising into the back standard
    P.push(cbox(0.045, 0.05, 0.53, IRON, x, 0.385, 0.0));               // seat bracket
    if (x !== 0) {
      P.push(cbox(0.05, 0.035, 0.44, IRON, x, 0.645, 0.04));            // arm
      P.push(cbox(0.04, 0.2, 0.04, IRON, x, 0.53, 0.235));              // arm post
    }
  }
  for (let j = 0; j < 5; j++) P.push(cbox(2.44, 0.028, 0.072, j % 2 ? WOOD2 : WOOD, 0, 0.435, -0.15 + j * 0.092));
  for (let j = 0; j < 3; j++) P.push(cbox(2.44, 0.075, 0.026, j % 2 ? WOOD : WOOD2, 0, 0.57 + j * 0.11, -0.2 - j * 0.03, -0.26));
  const g = mergeGeometries(P, false);
  // past LOD_R: the seat and the back as two slabs on two end frames (60 triangles)
  const F = mergeGeometries([cbox(2.44, 0.03, 0.44, WOOD, 0, 0.435, 0.05), cbox(2.44, 0.3, 0.03, WOOD2, 0, 0.68, -0.23, -0.26),
    cbox(0.05, 0.43, 0.5, IRON, -1.16, 0.215, 0.0), cbox(0.05, 0.43, 0.5, IRON, 1.16, 0.215, 0.0), cbox(2.3, 0.05, 0.05, IRON, 0, 0.38, 0.23)], false);
  for (const q of [g, F]) { q.computeBoundingSphere(); q.computeBoundingBox(); }
  return (_benchGeo = { near: g, far: F });
}
// THE LITTER BASKET: the city's wire basket, dark green, ~0.8 m, tapered
let _basketGeo = null;
function basketGeo() {
  if (_basketGeo) return _basketGeo;
  const side = colorize(new THREE.CylinderGeometry(0.29, 0.235, 0.78, 9, 1, true).translate(0, 0.41, 0), BASKET);
  const rim = colorize(new THREE.TorusGeometry(0.29, 0.012, 3, 9).rotateX(Math.PI / 2).translate(0, 0.8, 0), BASKET);
  const foot = colorize(new THREE.CylinderGeometry(0.235, 0.22, 0.03, 9).translate(0, 0.015, 0), BASKET);
  for (const g of [side, rim, foot]) g.deleteAttribute('uv');
  for (const g of [side, rim, foot]) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));
  const g = mergeGeometries([side, rim, foot], false);
  g.computeBoundingSphere(); g.computeBoundingBox();
  return (_basketGeo = g);
}
let _mats = null;
function mats() {
  if (_mats) return _mats;
  const iron = applyLightTrim(applyCityAO(applySnowCap(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08 }))), STREET_CAL);
  iron.side = THREE.DoubleSide;   // the basket is open-topped
  const glass = applyLightTrim(applyCityAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.0, emissive: 0xffd49a, emissiveIntensity: 0 })), STREET_CAL);
  return (_mats = { iron, glass });
}
// the baked lists binned by 512 m tile (world metres)
let _bins = null;
function bins() {
  if (_bins) return _bins;
  const B = new Map();
  const bin = (x, z) => { const k = `${Math.floor(x / 512)}_${Math.floor(z / 512)}`; let b = B.get(k); if (!b) B.set(k, (b = { lamps: [], benches: [], baskets: [] })); return b; };
  // (TERRAIN INT2: none in a drive's carriageway, world/placeGuard.js)
  for (let i = 0; i < CP_LAMPS.length; i += 3) { const x = CP_LAMPS[i] / 10, z = CP_LAMPS[i + 1] / 10; if (!pgDriveHit(x, z, FURN.LAMP_CROOK)) bin(x, z).lamps.push([x, z, CP_LAMPS[i + 2]]); }
  for (let i = 0; i < CP_BENCHES.length; i += 4) { const x = CP_BENCHES[i] / 10, z = CP_BENCHES[i + 1] / 10; if (!pgDriveHit(x, z, FURN.BENCH)) bin(x, z).benches.push([x, z, CP_BENCHES[i + 2] / 1000, CP_BENCHES[i + 3]]); }
  for (let i = 0; i < CP_BASKETS.length; i += 2) { const x = CP_BASKETS[i] / 10, z = CP_BASKETS[i + 1] / 10; if (!pgDriveHit(x, z, FURN.LITTER)) bin(x, z).baskets.push([x, z]); }
  // (TERRAIN INT2: the rebuilt drives' own lamps and settees, city/cpDrives.js)
  if (HA_P1) { const D = cpDriveFurniture(); for (const l of D.lamps) bin(l[0], l[1]).lamps.push(l); for (const b2 of D.benches) bin(b2[0], b2[1]).benches.push(b2); }
  return (_bins = B);
}
const _seatByTile = new Map();
let _seatList = [];
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _Y = new THREE.Vector3(0, 1, 0);
// LOD: a tile's whole set switches to the light geometry while the camera is more than LOD_R from the set's box (read
// in the main pass: the choice holds for the next frame, and for the shadow passes, which do not call onBeforeRender)
const LOD_R = 140;
function instanced(geo, mat, list, name, cast, far = null, onDraw = null) {
  const m = new THREE.InstancedMesh(geo, mat, list.length);
  list.forEach(([x, y, z, yaw], i) => { _m4.compose(_p.set(x, y, z), _q.setFromAxisAngle(_Y, yaw), _one); m.setMatrixAt(i, _m4); });
  m.instanceMatrix.needsUpdate = true;
  m.computeBoundingSphere();
  m.castShadow = cast; m.receiveShadow = true; m.name = name;
  _meshes.add(m); m.visible = _on;
  if (far) {
    const bb = new THREE.Box3();
    for (const [x, y, z] of list) bb.expandByPoint(_p.set(x, y, z));
    bb.max.y += 4;
    m.onBeforeRender = (r, s, cam) => {
      if (onDraw) onDraw();
      // CC37 (core/engine.js): a cube probe's face keeps the view's choice (its camera's position is local, (0, 0, 0))
      if (!cam.isPerspectiveCamera || (cam.parent && cam.parent.isCubeCamera)) return;
      // FP37: while recording, the take's nearest approach to the set decides, once per take
      const fp = filmPath();
      let want;
      if (fp) {
        if (m.userData.fpV !== fp.v) {
          let d = Infinity;
          for (let j = 0; j < fp.pts.length; j += 3) d = Math.min(d, bb.distanceToPoint(_p.set(fp.pts[j], fp.pts[j + 1], fp.pts[j + 2])));
          m.userData.fpV = fp.v; m.userData.fpWant = d > LOD_R ? far : geo;
        }
        want = m.userData.fpWant;
      } else want = bb.distanceToPoint(cam.position) > LOD_R ? far : geo;
      if (m.geometry !== want) m.geometry = want;
    };
  } else if (onDraw) m.onBeforeRender = onDraw;
  return m;
}
// ---- CP33 LANDSCAPE: the furniture, modelled (cpFurnKit.js): the Bacon lamps, the 1939 settees, the baskets, the Mall's hoop
// fences, each tile's instances in a per-instance LOD set (full detail within 24-38 m of the lens, the old light forms beyond,
// none past 160-300 m). `?cp33f=0` restores the CP32 furniture.
const CP33F = CP32F && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp33f') === '0');
const TEXF = 'textures/cp33/landscape/';
let _fm = null;
function furnMats() {
  if (_fm) return _fm;
  const T = new THREE.TextureLoader();
  const ld = (f, srgb) => { const t = T.load(TEXF + f); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const iron = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1.0, metalness: 0.1, normalMap: ld('iron_nrm.jpg'), roughnessMap: ld('iron_rgh.jpg') });
  iron.normalScale.set(0.8, 0.8); iron.name = 'cp33:iron';
  const basket = iron.clone(); basket.side = THREE.DoubleSide; basket.name = 'cp33:wire';
  const arm = ld('benchwood_arm.jpg');
  const wood = new THREE.MeshStandardMaterial({ map: ld('benchwood_col.jpg', true), normalMap: ld('benchwood_nrm.jpg'), roughnessMap: arm, aoMap: arm, aoMapIntensity: 0.8,
    vertexColors: true, roughness: 1.0, metalness: 0 });
  wood.normalScale.set(1.0, 1.0); wood.name = 'cp33:slats';
  const glass = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0, emissive: 0xffd49a, emissiveIntensity: 0 });
  glass.name = 'cp33:lantern';
  const trim = (m) => applyLightTrim(applyCityAO(applySnowCap(m)), STREET_CAL);
  return (_fm = { iron: trim(iron), basket: trim(basket), wood: trim(wood), glass: applyLightTrim(applyCityAO(glass), STREET_CAL) });
}
// the lantern glows once the city's lamps are on (world/cityLamps.js LAMPS_ON 0.06), full by night 0.3
const lanternOn = () => { const n = ENV.night.value, t = Math.min(1, Math.max(0, (n - 0.06) / 0.24)); if (_fm) _fm.glass.emissiveIntensity = 2.6 * t * t * (3 - 2 * t); };
// The Mall's lawn fences (review: "the inner rows stand in lawn behind black hoop fences"): a line behind each inner row of
// elms, 1.9 m out from its trunks (smoothed), as panels of ~2 m: [{ x, z, yaw, sx }] in world metres
let _fp = null;
function mallFence() {
  if (_fp) return _fp;
  const O = [-110, 1455], U = [0.2756, -0.9613], R = [0.9613, 0.2756];
  const rows = [[], []];
  for (let i = 0; i < CP_TREES.length; i += 4) {
    if (((CP_TREES[i + 3] >> 4) & 3) !== 2) continue;
    const dx = CP_TREES[i] / 10 - O[0], dz = CP_TREES[i + 1] / 10 - O[1], s = dx * U[0] + dz * U[1], off = dx * R[0] + dz * R[1];
    if (s < -20 || s > 440) continue;
    if (off > -12 && off < -3) rows[0].push([s, off]); else if (off > 3 && off < 13) rows[1].push([s, off]);
  }
  const out = [];
  rows.forEach((row, side) => {
    row.sort((a, b) => a[0] - b[0]);
    const out2 = (side ? 1 : -1) * 1.9;
    const P = row.map(([s], i) => { let o = 0, n = 0; for (let k = Math.max(0, i - 3); k <= Math.min(row.length - 1, i + 3); k++) { o += row[k][1]; n++; } return [s, o / n + out2]; });
    for (let i = 0; i + 1 < P.length; i++) {
      const [s0, o0] = P[i], [s1, o1] = P[i + 1];
      if (s1 - s0 > 26) continue;
      const ax = O[0] + U[0] * s0 + R[0] * o0, az = O[1] + U[1] * s0 + R[1] * o0, bx = O[0] + U[0] * s1 + R[0] * o1, bz = O[1] + U[1] * s1 + R[1] * o1;
      const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 2)), yaw = Math.atan2(-(bz - az), bx - ax);
      for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, yaw, sx: L / n / 2 }); }
    }
  });
  return (_fp = out);
}
function furnish(group, ctx, gy) {
  const { ox, oz } = ctx;
  const FM = furnMats();
  const b = bins().get(`${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`);
  const t0 = performance.now();
  const n = { lamps: 0, benches: 0, baskets: 0, fences: 0 };
  if (b && b.lamps.length) {
    const K = lampKit();
    const L = b.lamps.filter(([x, z]) => !onRock(x, z)).map(([x, z]) => ({ x, y: gy(x, z), z, yaw: frac(Math.sin(x * 3.1 + z * 1.7) * 43758.5) * 6.2832 }));
    n.lamps = L.length;
    group.add(lodSet('cp33:lamp', L, [{ near: K.iron, mid: K.ironF, mat: FM.iron, cast: true, castMid: false }, { near: K.glass, mid: K.glassF, mat: FM.glass, cast: false }], 32, 300, _meshes, lanternOn));
  }
  if (b && b.benches.length) {
    const K = benchKit();
    // (VG37: no bench inside a mapped hedge: the French garden's hedge areas swallowed two, b5 vgConsNHigh; GROUND 07:43)
    const L = b.benches.filter(([x, z]) => !onRock(x, z) && !(VG37 && vg37Blocked(x, z, 0, true))).map(([x, z, yaw]) => ({ x, y: gy(x, z), z, yaw }));
    n.benches = L.length;
    group.add(lodSet('cp33:bench', L, [{ near: K.iron, mid: K.far, mat: FM.iron, cast: true, castMid: false }, { near: K.wood, mid: null, mat: FM.wood, cast: true }], 28, 190, _meshes));
  }
  if (b && b.baskets.length) {
    const K = basketKit();
    const L = b.baskets.filter(([x, z]) => !onRock(x, z)).map(([x, z]) => ({ x, y: gy(x, z), z, yaw: frac(Math.sin(x * 7.1 + z * 3.3) * 43758.5) * 6.2832 }));
    n.baskets = L.length;
    group.add(lodSet('cp33:basket', L, [{ near: K.near, mid: K.far, mat: FM.basket, cast: false }], 24, 170, _meshes));
  }
  {
    const L = [];
    for (const p of mallFence()) {
      if (p.x < ox || p.x >= ox + 512 || p.z < oz || p.z >= oz + 512) continue;
      const y = gy(p.x, p.z);
      if (y === null || y === undefined) continue;
      L.push({ x: p.x, y: y - 0.02, z: p.z, yaw: p.yaw, sx: p.sx, sy: 1, sz: 1 });
    }
    n.fences = L.length;
    if (L.length) { const K = fenceKit(); group.add(lodSet('cp33:fence', L, [{ near: K.near, mid: K.far, mat: FM.iron, cast: false }], 26, 160, _meshes)); }
    // SPACE r2 (city/colliders.js addBarrier): the walkers keep off the lawns behind the hoop fence (a panel is 2 m at sx 1)
    for (const p of L) COLLIDERS.addBarrier(ctx.key, { x: p.x, z: p.z, hw: p.sx, hd: 0.05, rotY: p.yaw });
  }
  if (typeof window !== 'undefined') { const P = (window.__CP33F = window.__CP33F || { tiles: {} }); P.tiles[ctx.key] = { ...n, ms: +(performance.now() - t0).toFixed(1) }; }
}

// ---- CP33 LANDSCAPE: the lawn's grass (cpFloraKit.js grassField; `?cp33g=0` leaves the lawn flat). A cell is open lawn where the
// park's lawn section covers it and nothing else does within 0.9 m: inside the park, outside OSM's woods, 1.3 m clear of the
// water and the rocks, off the terrace and the landmarks, 1.2 m from a trunk.
const CP33G = CP32F && !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('cp33g') === '0');
function lawnTest(ctx) {
  const W = woodsOf(ctx.ox, ctx.oz, 4);
  const parkM = new Map(), woodM = new Map(), treeG = new Map();
  const T = treeBins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`) || [];
  for (const t of T) { const k = Math.floor(t[0] / 8) * 8192 + Math.floor(t[1] / 8); let a = treeG.get(k); if (!a) treeG.set(k, (a = [])); a.push(t); }
  const memo = (M, x, z, fn) => { const i = Math.floor(x / 4), j = Math.floor(z / 4), k = i * 16384 + j; let v = M.get(k); if (v === undefined) M.set(k, (v = fn(i * 4 + 2, j * 4 + 2))); return v; };
  return (x, z) => {
    if (!memo(parkM, x, z, cpInPark)) return null;
    if (W.length && memo(woodM, x, z, (a, b) => inWoods(W, a, b))) return null;
    if (cpWaterY(x, z, -1.3) !== null || onRock(x, z)) return null;
    try { if (cpbInside(x, z, 1.5) || cpLmKeepOut(x, z)) return null; } catch (e) { /* the parts are not all loaded */ }
    const i0 = Math.floor((x - 1.2) / 8), i1 = Math.floor((x + 1.2) / 8), j0 = Math.floor((z - 1.2) / 8), j1 = Math.floor((z + 1.2) / 8);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = treeG.get(i * 8192 + j);
      if (a) for (const t of a) if ((t[0] - x) ** 2 + (t[1] - z) ** 2 < 1.44) return null;
    }
    const g = ctx.sectionY('grass', x, z, 0);
    if (g === null || !isFinite(g)) return null;
    return hardNear(ctx, x, z, 0.9) ? null : g;
  };
}
export function build(group, ctx) {
  if (!CP32F) return;
  // SPACE r2 (docs/notes/space-r2.md): the A/B set `_meshes` kept every park mesh it was given, and through mesh.parent every
  // unloaded park tile with its sections and samplers; the tile's dispose() (world/assemble.js) now takes this tile's out
  const release = new THREE.Object3D();
  release.name = 'cp33:release';
  release.userData.onDispose = () => group.traverse((o) => { _meshes.delete(o); });
  group.add(release);
  try { cpFarEnsure(); } catch (e) { console.warn('[cp33] far park', e); }   // (once, under the streamer's macro group; cpFar.js)
  const elms = DIRECT ? claimTrees(group, ctx) : [];
  if (CP33L && DIRECT) { try { plant(group, ctx, elms || []); } catch (e) { console.warn('[cp33] plant', e); } }
  // VG37 (GROUND): the park's mapped hedges, planted beds and scrub (world/vg37.js), on the park's own ground
  // (the planting keeps clear of the park's benches, 1.3 m, and lamps, 0.6 m: b4 put a mapped bench inside a bed's mums)
  if (VG37) {
    try {
      const fb = bins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`);
      // (GROUND session 3: a 2 m grid of the tile's benches and lamps, so the ~5,000 plants of the Conservatory Garden's tile each
      // test a handful of them, not every bench and lamp of the tile)
      let clear = null;
      if (fb) {
        const gk = (x, z) => Math.floor(x / 2) + ',' + Math.floor(z / 2), grid = new Map();
        const put = (x, z, r2) => { const k = gk(x, z); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push([x, z, r2]); };
        for (const [bx, bz] of fb.benches) put(bx, bz, 1.69);
        for (const [lx, lz] of fb.lamps) put(lx, lz, 0.36);
        clear = (x, z) => {
          const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
          for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
            const l = grid.get((cx + i) + ',' + (cz + j));
            if (l) for (const [qx, qz, r2] of l) if ((qx - x) * (qx - x) + (qz - z) * (qz - z) < r2) return true;
          }
          return false;
        };
      }
      vg37Tile(group, ctx.ox, ctx.oz, (x, z) => groundAt(ctx, x, z), _meshes, ctx.key, true, clear);
    } catch (e) { console.warn('[vg37] park', e); }
  }
  if (CP33G && DIRECT && ctx.sectionY) { try { group.add(grassField('cp33:grass', ctx.ox, ctx.oz, lawnTest(ctx), _meshes)); } catch (e) { console.warn('[cp33] grass', e); } }
  const gy = (x, z) => groundAt(ctx, x, z);
  try { mallSurface(group, ctx, gy); } catch (e) { console.warn('[cp33] mall surface', e); }
  if (CP33F) { try { furnish(group, ctx, gy); } catch (e) { console.warn('[cp33] furniture', e); } }
  const b = bins().get(`${Math.floor(ctx.ox / 512)}_${Math.floor(ctx.oz / 512)}`);
  if (!b) return;
  const M = mats();
  if (b.lamps.length) {
    const L = b.lamps.filter(([x, z]) => !onRock(x, z)).map(([x, z]) => [x, gy(x, z), z, frac(Math.sin(x * 3.1 + z * 1.7) * 43758.5) * 6.2832]);
    if (!CP33F) {
      const G = lampGeos();
      group.add(instanced(G.iron, M.iron, L, 'cp32f:lampIron', true, G.ironF));
      // the lantern glows once the city's lamps are on (world/cityLamps.js LAMPS_ON 0.06), full by night 0.3
      group.add(instanced(G.glass, M.glass, L, 'cp32f:lampGlass', false, G.glassF,
        () => { const n = ENV.night.value, t = Math.min(1, Math.max(0, (n - 0.06) / 0.24)); M.glass.emissiveIntensity = 2.6 * t * t * (3 - 2 * t); }));
    }
    // the night light: a symmetric post top, warm 3000 K LED (world/night11.js FIXTURES[0]), the head 3.4 m up
    // (SPACE r2: once a lamp; each visit to the tile pushed them again)
    for (const [x, y, z] of L) { const k = `${x.toFixed(1)},${z.toFixed(1)}`; if (_lampSeen.has(k)) continue; _lampSeen.add(k); lampSpots.push([x, y, z, 0, 3.4, null]); }
  }
  if (b.benches.length) {
    const L = b.benches.filter(([x, z]) => !onRock(x, z) && !(VG37 && vg37Blocked(x, z, 0, true))).map(([x, z, yaw]) => [x, gy(x, z), z, yaw]);   // (and no seat there)
    if (!CP33F) group.add(instanced(benchGeo().near, M.iron, L, 'cp32f:bench', true, benchGeo().far));
    if (!_seatByTile.has(ctx.key)) {
      const S = [];
      for (const [x, y, z, yaw] of L) {
        const c = Math.cos(yaw), s = Math.sin(yaw);
        for (const j of [-0.78, 0, 0.78]) S.push({ x: +(x + j * c + 0.08 * s).toFixed(3), y: +y.toFixed(3), z: +(z - j * s + 0.08 * c).toFixed(3), yaw: +yaw.toFixed(4), seat: 0.45, kind: 'bench', group: -1 });
      }
      _seatByTile.set(ctx.key, S);
      _seatList = [..._seatByTile.values()].flat();
    }
  }
  if (b.baskets.length && !CP33F) {
    const L = b.baskets.filter(([x, z]) => !onRock(x, z)).map(([x, z]) => [x, gy(x, z), z, frac(Math.sin(x * 7.1 + z * 3.3) * 43758.5) * 6.2832]);
    group.add(instanced(basketGeo(), M.iron, L, 'cp32f:basket', true));
  }
}
// every bench place of the tiles built so far (sim/peds.js SW31 seats; the bryantPark.js bpSeats records)
export function seats() { return CP32F ? _seatList : []; }
