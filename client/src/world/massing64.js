// M64 (massing from the city's 3D building model; `?m64=1`, the bake profiles pass it): a compiled building whose roof
// stands at more than one level in the DoITT 3D Building Model (2014, LOD2) is drawn as one record per level, the level's
// plan extruded from the ground to its roof: setbacks, wings, rear extensions, penthouses and crowns at their measured
// heights, where the footprint layer gives one extrusion to the main roof.
//
// The data (public/data/m64/t_<tile>.json, from the massing builder outside the repository) is baked against the compiled
// tile it was measured on and applies only to that content (shared/overlay.js content keys):
//   { v, ckey, bytes, b: { "<record index>": [[height, [x, z, ...] tile-local ring, [[x, z, ...] courts]], ...] } }
// The level with the largest plan keeps the record's index (its storefronts, door and courts' records stand on the
// original); the other levels are appended. Every level keeps the record's style, colours, floor height and storefront;
// party walls stay blind only where a level's edge lies on one of the record's blind edges, so a setback wall above a
// neighbour's roof gets windows. The procedural massing that would stand in for the measured one (the zoning setbacks,
// the era crowns, the penthouse storey, the mansard) is off for these records: world/assemble.js reads `tile.m64`.
// Buildings inside the hand-built areas (city/areas.js boxes: 125th Street, Hunters Point) keep their compiled record,
// since their kits claim footprints by centroid.
import { entryApplies, warnStale } from '../shared/overlay.js';
import { BF, project } from '../shared/geo.js';
import { BUILDING_OVERRIDES } from '../shared/landmarkSpec.js';

const Q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
export const M64 = !!(Q && Q.get('m64') === '1');
const AREA_BOXES = [[600, -4400, 3750, -1450], [350, 3250, 1850, 5350]];   // city/areas.js B125, BHPT
// a building a read-time override names (world/tiledata.js: facts matched by a point inside the footprint) keeps its
// compiled record: the override would reach only the level holding its point
const OVR_PTS = BUILDING_OVERRIDES.map((o) => project(o.lon, o.lat));

const _p = new Map();
export function m64Load(key) {
  if (!M64 || typeof fetch === 'undefined') return Promise.resolve(null);
  let p = _p.get(key);
  if (!p) {
    p = fetch(`data/m64/t_${key}.json`)
      .then((r) => (r.ok && (r.headers?.get?.('content-type') || '').indexOf('html') < 0 ? r.json() : null))
      .catch(() => null);
    _p.set(key, p);
  }
  return p;
}

const area2 = (P) => { let a = 0; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) a += P[j] * P[i + 1] - P[i] * P[j + 1]; return a / 2; };
const flip = (P) => { const R = []; for (let i = P.length - 2; i >= 0; i -= 2) R.push(P[i], P[i + 1]); return R; };
// does edge (p, q) lie along segment (a, b), within d metres, overlapping it by at least half its own length
function along(px, pz, qx, qz, ax, az, bx, bz, d = 0.6) {
  const ex = bx - ax, ez = bz - az, L = Math.hypot(ex, ez);
  if (L < 0.2) return false;
  const ux = ex / L, uz = ez / L;
  const off = (x, z) => Math.abs((x - ax) * uz - (z - az) * ux);
  if (off(px, pz) > d || off(qx, qz) > d) return false;
  const s1 = (px - ax) * ux + (pz - az) * uz, s2 = (qx - ax) * ux + (qz - az) * uz;
  const lo = Math.max(Math.min(s1, s2), 0), hi = Math.min(Math.max(s1, s2), L);
  return hi - lo >= 0.5 * Math.abs(s2 - s1) - 0.05;
}

// rewrite the tile's building sections (straight after parseTile and LF39, before anything reads the buildings)
export function m64Apply(key, tile, e, ckey, byteLength) {
  if (!M64 || !e || !e.b || !tile || !tile.S || !tile.S.bldg || tile.m64) return 0;
  if (!entryApplies(e, ckey, byteLength)) { warnStale('m64', key, e, ckey); return 0; }
  const S = tile.S, [ox, oz] = tile.header.origin;
  const old = S.bldg, nOld = old.byteLength / 44, src = new DataView(old.buffer, old.byteOffset, old.byteLength);
  const XZ = S.bldgXZ;
  const groups = [];   // [orig index, levels sorted by plan area (largest first)]
  for (const [ks, L] of Object.entries(e.b)) {
    const i = +ks;
    if (!(i >= 0 && i < nOld) || !L || L.length < 2) continue;
    const o = i * 44, st = src.getUint32(o, true), len = src.getUint16(o + 4, true);
    if (src.getInt16(o + 6, true)) continue;   // a landmark (the builder owns the massing)
    let cx = 0, cz = 0;
    for (let k = 0; k < len; k++) { cx += XZ[(st + k) * 2]; cz += XZ[(st + k) * 2 + 1]; }
    cx = cx / len + ox; cz = cz / len + oz;
    if (AREA_BOXES.some((b) => cx > b[0] && cx < b[2] && cz > b[1] && cz < b[3])) continue;
    if (OVR_PTS.some(([x, z]) => {
      let inside = false;
      for (let k = 0, j = len - 1; k < len; j = k++) {
        const xi = XZ[(st + k) * 2] + ox, zi = XZ[(st + k) * 2 + 1] + oz, xj = XZ[(st + j) * 2] + ox, zj = XZ[(st + j) * 2 + 1] + oz;
        if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    })) continue;
    groups.push([i, L.map(([h, ring, holes]) => ({ h, ring, holes: holes || [], a: Math.abs(area2(ring)) })).sort((p, q) => q.a - p.a)]);
  }
  if (!groups.length) return 0;
  const nNew = groups.reduce((s, g) => s + g[1].length - 1, 0);
  const rec = new Uint8Array((nOld + nNew) * 44);
  rec.set(new Uint8Array(old.buffer, old.byteOffset, old.byteLength), 0);
  const dv = new DataView(rec.buffer);
  const xz = Array.from(XZ), holesAdd = [], orig = new Map(), replaced = new Set();
  let next = nOld;
  for (const [i, levels] of groups) {
    const o0 = i * 44, st = src.getUint32(o0, true), len = src.getUint16(o0 + 4, true);
    const sign = Math.sign(area2(Array.from(XZ.subarray(st * 2, (st + len) * 2)))) || 1;
    const blind0 = src.getUint32(o0 + 36, true), front0 = src.getUint8(o0 + 43) - 1, floorH = src.getFloat32(o0 + 24, true) || 3.3;
    const E = [];   // the record's edges: [ax, az, bx, bz, blind]
    for (let k = 0; k < len; k++) {
      const k2 = (k + 1) % len;
      E.push([XZ[(st + k) * 2], XZ[(st + k) * 2 + 1], XZ[(st + k2) * 2], XZ[(st + k2) * 2 + 1], k < 32 && ((blind0 >>> k) & 1)]);
    }
    replaced.add(i);
    levels.forEach((Lv, li) => {
      const idx = li === 0 ? i : next++;
      orig.set(idx, i);
      let R = Lv.ring;
      if (Math.sign(area2(R)) !== sign) R = flip(R);
      const n = R.length / 2, start = xz.length / 2;
      for (const v of R) xz.push(v);
      let blind = 0, front = -1;
      for (let k = 0; k < n && k < 32; k++) {
        const k2 = (k + 1) % n, px = R[k * 2], pz = R[k * 2 + 1], qx = R[k2 * 2], qz = R[k2 * 2 + 1];
        for (let j = 0; j < E.length; j++) {
          const [ax, az, bx, bz, bl] = E[j];
          if (!along(px, pz, qx, qz, ax, az, bx, bz)) continue;
          if (bl) blind |= 1 << k;
          if (j === front0 && li === 0 && front < 0) front = k;
        }
      }
      const o = idx * 44;
      if (li > 0) rec.copyWithin(o, o0, o0 + 44);
      dv.setUint32(o, start, true); dv.setUint16(o + 4, n, true);
      dv.setFloat32(o + 12, Lv.h, true);
      dv.setUint8(o + 16, Math.max(1, Math.min(255, Math.round(Lv.h / floorH))));
      const rk = src.getUint8(o0 + 21), fl = src.getUint8(o0 + 22);
      // flat roofs on every level; the water tank (flag and roof bit) on the largest level's roof only
      dv.setUint8(o + 21, (rk & ~7 & (li === 0 ? 0xff : ~32)) & 0xff);
      dv.setUint8(o + 22, (fl & ~BF.SETBACKS & ~BF.GABLE & (li === 0 ? 0xff : ~BF.WATERTOWER)) & 0xff);
      dv.setUint32(o + 36, blind >>> 0, true);
      dv.setUint16(o + 40, Math.min(65000, Math.round(Lv.a)), true);
      dv.setUint8(o + 43, front + 1);
      for (const H of Lv.holes) {
        if (!H || H.length < 6) continue;
        const HH = Math.sign(area2(H)) === sign ? flip(H) : H, hs = xz.length / 2;
        for (const v of HH) xz.push(v);
        holesAdd.push([idx, hs, HH.length / 2, Math.min(255, Math.round(Math.abs(area2(HH)) / 4))]);
      }
    });
  }
  // the courts: the replaced records' compiled courts give way to the levels' own
  const keep = [];
  if (S.bholes && S.bholes.byteLength) {
    const hv = new DataView(S.bholes.buffer, S.bholes.byteOffset, S.bholes.byteLength);
    for (let k = 0; k < S.bholes.byteLength / 12; k++) {
      const o = k * 12, b = hv.getUint32(o, true);
      if (!replaced.has(b)) keep.push([b, hv.getUint32(o + 4, true), hv.getUint16(o + 8, true), hv.getUint8(o + 10), hv.getUint8(o + 11)]);
    }
  }
  const hb = new Uint8Array((keep.length + holesAdd.length) * 12), hd = new DataView(hb.buffer);
  [...keep, ...holesAdd.map(([b, s, l, a]) => [b, s, l, 1, a])].forEach(([b, s, l, f, a], k) => {
    const o = k * 12;
    hd.setUint32(o, b, true); hd.setUint32(o + 4, s, true); hd.setUint16(o + 8, l, true); hd.setUint8(o + 10, f); hd.setUint8(o + 11, a);
  });
  S.bldg = rec; S.bldgXZ = Float32Array.from(xz); S.bholes = hb;
  tile.m64 = orig;   // record index -> the compiled record it was measured for
  if (typeof window !== 'undefined') { const W = (window.__m64 = window.__m64 || { tiles: 0, buildings: 0, levels: 0 }); W.tiles++; W.buildings += groups.length; W.levels += groups.length + nNew; }
  return groups.length;
}
