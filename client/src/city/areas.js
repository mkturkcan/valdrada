// AR32 — detailed areas beyond Central Park (owner 2026-09-30: "125th street from Dinosaur BBQ all the way to the east,
// and the pepsi-cola sign area in Hunter's point; these two will have their own teaser"). Each area part is its own
// module with its own notes (docs/notes/area-<part>.md), gathered here for world/assemble.js and sim/peds.js on the same
// hook contract as city/centralPark.js (read its comments for each hook):
//   w125w.js   W 125th St, the west: Dinosaur Bar-B-Que at 12th Avenue, the Riverside Drive viaduct, Manhattanville,
//              the 1 train's Manhattan Valley viaduct at Broadway, to Amsterdam Avenue
//   w125c.js   125th St, Frederick Douglass to Adam Clayton Powell Boulevard (the Apollo)
//   w125cb.js  125th St, Adam Clayton Powell Boulevard to Lenox Avenue (the Studio Museum, the State Office Building's
//              plaza and the vendors; split out of w125c.js on 2026-09-30)
//   w125e.js   E 125th St, the east: Lenox Avenue to the East River (Fifth, Madison, the Park Avenue viaduct and the
//              Metro-North station, Lexington, Third, Second, the RFK Bridge's approaches, First Avenue)
//   hptSign.js Hunters Point, Queens: the Pepsi-Cola sign, the gantries and Gantry Plaza State Park
//   hptShore.js Hunters Point's waterfront: the Center Boulevard towers, Hunters Point South Park, the piers and the ferry
// AR33 (2026-09-30, the reference-built pass: docs/notes/ar33.md) adds four parts over both areas:
//   vk/viaducts.js   the viaducts: the Manhattan Valley arch and 125th St station, the Riverside Drive viaduct, Park Avenue
//   sk/streetscape.js the street surface: flags, curbs, ramps, markings, asphalt, tree pits, grates, covers
//   pk/props.js      street furniture and props
// Every hook is optional in a part; a part that throws is logged (`[ar32] part.hook`) and skipped. A part whose MODULE
// fails to load (a syntax error mid-edit) is logged (`[ar32] part <name> unavailable`) and left out, so one broken file
// never takes every page down; tile assembly waits for `areasReady` (main.js). A part module may export `ready` (a
// promise, e.g. its own data files loading) and is registered once it settles. `?ar32=0` restores the compiled city in
// all of them, `?ar33=0` leaves out the AR33 parts only; each part has its own sub-flag.
const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const AR32 = !(Q && Q.get('ar32') === '0');
export const AR33 = AR32 && !(Q && Q.get('ar33') === '0');
// world boxes [x0, z0, x1, z1]: a tile outside all of a part's boxes never asks that part
const B125 = [600, -4400, 3750, -1450], BHPT = [350, 3250, 1850, 5350];
// [name, loader, boxes, ar33]: consulted in this order (the AR33 parts after the AR32 ones)
const DEFS = [
  ['w125w', () => import('./w125w.js'), [[600, -4400, 1900, -2800]]],
  ['w125c', () => import('./w125c.js'), [[1450, -3650, 2500, -2350]]],
  ['w125cb', () => import('./w125cb.js'), [[1450, -3650, 2500, -2350]]],
  ['w125e', () => import('./w125e.js'), [[2050, -3050, 3750, -1450]]],
  ['hptShore', () => import('./hptShore.js'), [BHPT]],
  ['hptSign', () => import('./hptSign.js'), [BHPT]],
  ['wfDumbo', () => import('./wfDumbo.js'), [[-2350, 8560, -940, 9150]]],   // WF65: the Brooklyn shore from Pier 1 to the Farragut substation
  ['fk', () => import('./fk/facades.js'), [B125, BHPT], true],
  ['vk', () => import('./vk/viaducts.js'), [B125], true],
  ['sk', () => import('./sk/streetscape.js'), [B125, BHPT], true],
  ['pk', () => import('./pk/props.js'), [B125, BHPT], true],
  ['lk', () => import('./lk/life.js'), [B125, BHPT], true],   // AR34: the street's life (vendors, two-wheelers, sheds)
];
let PARTS = [];   // { name, m, boxes }, in DEFS order, once loaded
export const areasReady = !AR32 ? Promise.resolve() : Promise.allSettled(DEFS.filter((d) => !d[3] || AR33).map(([name, load, boxes]) =>
  load().then(async (m) => { if (m.ready) await m.ready; return { name, m, boxes }; })
    .catch((e) => { console.warn(`[ar32] part ${name} unavailable`, e); return null; })))
  .then((rs) => {
    PARTS = rs.map((r) => r.value).filter(Boolean);
    console.log(`[ar32] parts: ${PARTS.map((P) => P.name).join(', ')}`);
  });
const warn = (part, hook, e) => console.warn(`[ar32] ${part}.${hook}`, e);
const hitTile = (P, ox, oz) => P.boxes.some((b) => ox < b[2] && ox + 512 > b[0] && oz < b[3] && oz + 512 > b[1]);
const hitPt = (P, x, z) => P.boxes.some((b) => x > b[0] && x < b[2] && z > b[1] && z < b[3]);
export const areaTileHit = (ox, oz) => AR32 && PARTS.some((P) => hitTile(P, ox, oz));

export function areaApply(tile, ox, oz) {
  if (!AR32) return;
  for (const P of PARTS) { if (P.m.apply && hitTile(P, ox, oz)) try { P.m.apply(tile, ox, oz); } catch (e) { warn(P.name, 'apply', e); } }
}
export function areaSkipBuilding(cx, cz, h, area) {
  if (!AR32) return false;
  for (const P of PARTS) { if (P.m.skipBuilding && hitPt(P, cx, cz)) try { if (P.m.skipBuilding(cx, cz, h, area)) return true; } catch (e) { warn(P.name, 'skipBuilding', e); } }
  return false;
}
export function areaDropFurniture(wx, wz, f) {
  if (!AR32) return false;
  for (const P of PARTS) { if (P.m.dropFurniture && hitPt(P, wx, wz)) try { if (P.m.dropFurniture(wx, wz, f)) return true; } catch (e) { warn(P.name, 'dropFurniture', e); } }
  return false;
}
// world records { k, x, z, y?, rot, p0, p1, p2 } from each part (cached by the part); those in this tile come back
// tile-local, y from the ground when left out
export function areaFurniture(ox, oz) {
  if (!AR32) return [];
  const out = [];
  for (const P of PARTS) {
    if (!P.m.furniture || !hitTile(P, ox, oz)) continue;
    let recs;
    try { recs = P.m.furniture() || []; } catch (e) { warn(P.name, 'furniture', e); continue; }
    for (const r of recs) {
      if (r.x < ox || r.x >= ox + 512 || r.z < oz || r.z >= oz + 512) continue;
      out.push({ k: r.k, x: r.x - ox, y: r.y ?? null, z: r.z - oz, rot: r.rot || 0, p0: r.p0 || 0, p1: r.p1 || 0, p2: r.p2 || 0, ar: true });
    }
  }
  return out;
}
// AR34 KIT: a part's build() may return a promise (the facade kit builds a tile in slices of a few ms, yielding to the
// page between buildings). The other parts still build in this task, in DEFS order; assembleTile awaits the promises, so
// the tile stays 'loading' (READY and bshot's ready test wait for it, the far LoD covers it) until its buildings are in.
globalThis.__AR_BUILD_AWAITS = true;
export async function areaBuild(group, ctx) {
  if (!AR32) return;
  const pending = [];
  for (const P of PARTS) {
    if (!P.m.build || !hitTile(P, ctx.ox, ctx.oz)) continue;
    try { const r = P.m.build(group, ctx); if (r && typeof r.then === 'function') pending.push(r.catch((e) => warn(P.name, 'build', e))); }
    catch (e) { warn(P.name, 'build', e); }
  }
  if (pending.length) await Promise.all(pending);
}
// AR34 KIT end
export function areaPromenades() {
  if (!AR32) return [];
  const out = [];
  for (const P of PARTS) { if (P.m.promenades) try { out.push(...(P.m.promenades() || [])); } catch (e) { warn(P.name, 'promenades', e); } }
  return out;
}
export function areaSeats() {
  if (!AR32) return [];
  const out = [];
  for (const P of PARTS) { if (P.m.seats) try { out.push(...(P.m.seats() || [])); } catch (e) { warn(P.name, 'seats', e); } }
  return out;
}
