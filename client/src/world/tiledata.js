import { BUILDING_OVERRIDES } from '../shared/landmarkSpec.js';
import { project, STYLE, BF } from '../shared/geo.js';
import { GAPFILL_FIX } from '../shared/gapfillFix.js';
// RW13 (owner 2026-09-17, lod-r13.md §2.4): the compiler gave every ROWHOUSE a 2.4-3.0 m window module, so a 5.1-6.5 m
// brownstone front carried ONE bay over its door in every shot of the ad. The classifier now emits 1.8 m (RW13); until the
// next four-borough compile this bridges the live tiles at read time — the shader, the dresser and the hero ring all take
// winW from this record, so one line fixes all three. 1.75 gives three bays on a 6 m front and two on a 5 m one. ?rw13=0 reverts.
const RW13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rw13') === '0');
const rw13WinW = (style, w) => (RW13 && style === 5 && w >= 2.3) ? 1.75 : w;
// READ-TIME TRUTH OVERRIDES (2026-09-24). compile.mjs applies BUILDING_OVERRIDES when it writes tiles; the same table is
// applied here when they are read, so a fact corrected off the references (refs/streetview) reaches the live tiles —
// the shader, the dresser, heroFacades and the landmark builders all read these records — without a four-borough
// recompile. Same fields, same rules as compile.mjs applyBuildingOverride (colour without its jitter); matched by the
// override's point lying inside the footprint. Idempotent on tiles compiled with the same entry. ?rto=0 disables.
const RTO = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('rto') === '0');
const RT_OVR = RTO ? BUILDING_OVERRIDES.map((o) => { const [x, z] = project(o.lon, o.lat); return { o, x, z }; }) : [];
// GF69 (shared/gapfillFix.js): the gap-fill's canopies out and its small untagged structures at a storey, per record (a
// point in its footprint, its area matched), by 512 m tile; `?gf69=0` keeps the compiled records
const GF69 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('gf69') === '0');
let GF_IDX = null;
function gfNear(org) {
  if (!GF_IDX) {
    GF_IDX = new Map();
    for (const f of GAPFILL_FIX) { const k = `${Math.floor(f[0] / 512)}_${Math.floor(f[1] / 512)}`; let l = GF_IDX.get(k); if (!l) GF_IDX.set(k, (l = [])); l.push(f); }
  }
  const tx = Math.floor(org[0] / 512), tz = Math.floor(org[1] / 512), out = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const f of GF_IDX.get(`${tx + dx}_${tz + dz}`) || []) out.push(f);
  return out;
}
function ringArea(XZ, start, len) {
  let A = 0;
  for (let i = 0, j = len - 1; i < len; j = i++) A += XZ[(start + j) * 2] * XZ[(start + i) * 2 + 1] - XZ[(start + i) * 2] * XZ[(start + j) * 2 + 1];
  return Math.abs(A) / 2;
}
function inRing(XZ, start, len, ox, oz, x, z) {
  let inside = false;
  for (let i = 0, j = len - 1; i < len; j = i++) {
    const xi = XZ[(start + i) * 2] + ox, zi = XZ[(start + i) * 2 + 1] + oz, xj = XZ[(start + j) * 2] + ox, zj = XZ[(start + j) * 2 + 1] + oz;
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function applyReadOverride(b, o) {
  if (o.style && STYLE[o.style] != null) b.style = STYLE[o.style];
  if (o.color) { b.r = o.color[0]; b.g = o.color[1]; b.b = o.color[2]; }
  if (o.roofKind != null) b.roofKind = (b.roofKind & ~7) | o.roofKind;
  for (const f of o.set || []) if (BF[f]) b.flags |= BF[f];
  for (const f of o.clear || []) if (BF[f]) b.flags &= ~BF[f];
  if (o.floors) b.floors = o.floors;
  if (o.floorH) b.floorH = o.floorH;
  if (o.winW) b.winW = o.winW;
  if (o.storeH != null) b.storeH = o.storeH;
  if (o.wall) b.wall = o.wall;          // dresser wall family (nycDress FAMILY_LUM key); runtime only
  if (o.base) { b.baseWall = o.base.wall; b.baseFloors = o.base.floors; }   // dresser stone base; runtime only
  // CR24 (campus roofs): runtime roof facts for assemble.js crPlan, a membrane override (packed bits 3-4), and the landmark id
  // where the compiler put a landmark point on the wrong footprint (St. Paul's Chapel had replaced Fayerweather Hall)
  if (o.roof) b.campusRoof = o.roof;
  if (o.memb != null) { b.roofKind = (b.roofKind & ~24) | ((o.memb & 3) << 3); b.membO = o.memb & 3; }   // (membO: FAC8's dealt membrane yields to it)
  if (o.landmarkId != null) b.landmarkId = o.landmarkId;
  if (o.noBalc) b.noBalc = true;      // no postwar balconies (world/heroFacades.js): a research building's punched front
  if (o.height) b.height = o.height;   // TW: a compiled height the live footprints correct (30 Rockefeller Plaza)
  if (o.drop) b.drop = true;           // BP69: a record that is no building (a canopy the gap-fill drew as a solid block)
}
// Binary tile parser (matches tools/pipeline/binio.mjs writer)
export function parseTile(buf) {
  const dv = new DataView(buf);
  const magic = dv.getUint32(0, true);
  if (magic !== 0x43544c31) throw new Error('bad tile magic');
  const hLen = dv.getUint32(4, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, hLen)));
  const base = 8 + hLen + ((4 - ((8 + hLen) % 4)) % 4);
  const S = {};
  for (const s of header.sections) {
    const C = { Float32Array, Uint8Array, Uint32Array, Int16Array, Uint16Array }[s.type];
    S[s.name] = new C(buf, base + s.offset, s.length);
  }
  return { header, S };
}

export function* buildingsOf(tile) {
  const meta = tile.S.bldg;
  const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const n = meta.byteLength / 44;
  // overrides whose point falls near this tile (a footprint may reach a little past its tile's square)
  const org = tile.header && tile.header.origin;
  const near = org ? RT_OVR.filter((r) => r.x > org[0] - 150 && r.x < org[0] + 662 && r.z > org[1] - 150 && r.z < org[1] + 662) : [];
  const gf = GF69 && org ? gfNear(org) : [];
  for (let i = 0; i < n; i++) {
    const o = i * 44;
    const b = {
      i,
      start: dv.getUint32(o, true), len: dv.getUint16(o + 4, true),
      landmarkId: dv.getInt16(o + 6, true),
      baseY: dv.getFloat32(o + 8, true), height: dv.getFloat32(o + 12, true),
      floors: dv.getUint8(o + 16), style: dv.getUint8(o + 17),
      r: dv.getUint8(o + 18), g: dv.getUint8(o + 19), b: dv.getUint8(o + 20),
      roofKind: dv.getUint8(o + 21), flags: dv.getUint8(o + 22), lit: dv.getUint8(o + 23) / 255,
      floorH: dv.getFloat32(o + 24, true), winW: rw13WinW(dv.getUint8(o + 17), dv.getFloat32(o + 28, true)),   // RW13
      storeH: dv.getFloat32(o + 32, true), blind: dv.getUint32(o + 36, true),
      area: dv.getUint16(o + 40, true), colorVar: dv.getUint8(o + 42) / 255,
      frontIdx: dv.getUint8(o + 43) - 1, // -1 = unknown (old tiles / no street frontage)
    };
    // (GF69 first: a named override over the same record has the last word)
    if (gf.length && b.height <= 25) for (const f of gf) {
      if (!inRing(tile.S.bldgXZ, b.start, b.len, org[0], org[1], f[0], f[1])) continue;
      const A = ringArea(tile.S.bldgXZ, b.start, b.len);
      if (!(A > f[2] * 0.9 - 1 && A < f[2] * 1.1 + 1)) continue;
      if (f[3] === 0) b.drop = true;
      else if (b.height > f[3]) { b.height = f[3]; b.floors = 1; }
      break;
    }
    for (const r of near) if (inRing(tile.S.bldgXZ, b.start, b.len, org[0], org[1], r.x, r.z)) applyReadOverride(b, r.o);
    if (b.drop) continue;
    // STORE12: a storefront never takes the whole wall. The compile gives 4.5 m to shops on buildings of any height, so a
    // 3.2 m one-storey building on Broadway at 121st St drew as one band of shop glass from kerb to roof (white slabs from
    // the air). Under 4 m of building a one-storey shopfront (bulkhead, glass, sign band) up to a 0.35 m parapet; above,
    // the shop band stops 1.2 m under the roof at most
    if (b.storeH > 0 && b.height > 0) b.storeH = Math.max(0, Math.min(b.storeH, b.height < 4 ? b.height - 0.35 : b.height - 1.2));
    yield b;
  }
}
// CY12 — enclosed light courts. The `bholes` section is a sidecar to `bldg`: 12 bytes per
// court, the vertices themselves live in `bldgXZ` straight after their parent's outer ring
// (which is why the 44-byte building record is untouched and a pre-r12 tile just has no
// section here). Returns a Map parentIndex -> [{start,len,flags,area}] so a caller that walks
// buildingsOf() pays one pass, not one scan per building.
export function holesOf(tile) {
  const m = new Map();
  const meta = tile.S.bholes;
  if (!meta || !meta.byteLength) return m;   // old tile / no courts in this tile
  const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const n = (meta.byteLength / 12) | 0;
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    const b = dv.getUint32(o, true);
    let a = m.get(b);
    if (!a) m.set(b, (a = []));
    a.push({
      start: dv.getUint32(o + 4, true), len: dv.getUint16(o + 8, true),
      flags: dv.getUint8(o + 10), area: dv.getUint8(o + 11) * 4,   // court area, m2 (4 m2 units)
    });
  }
  return m;
}
export function* roadsOf(tile) {
  const meta = tile.S.roads;
  if (!meta || !meta.byteLength) return;
  const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const n = meta.byteLength / 24;
  for (let i = 0; i < n; i++) {
    const o = i * 24;
    yield {
      start: dv.getUint32(o, true), len: dv.getUint16(o + 4, true),
      rclass: dv.getUint8(o + 6) & 0x7f, noTraffic: !!(dv.getUint8(o + 6) & 0x80), oneway: dv.getInt8(o + 7),   // bit 7 = pedestrianised street (compile.mjs pedStreet)
      width: dv.getFloat32(o + 8, true),
      lanes: dv.getUint8(o + 12), park: dv.getUint8(o + 13),
      level: dv.getUint8(o + 14), speed: dv.getUint8(o + 15),
      nameIdx: dv.getUint16(o + 16, true), segId: dv.getUint32(o + 20, true),
      mouthA: dv.getUint8(o + 18) / 4, mouthB: dv.getUint8(o + 19) / 4, // junction mouth per end (m)
    };
  }
}
export function* furnitureOf(tile) {
  const meta = tile.S.furn;
  if (!meta || !meta.byteLength) return;
  const dv = new DataView(meta.buffer, meta.byteOffset, meta.byteLength);
  const n = meta.byteLength / 20;
  for (let i = 0; i < n; i++) {
    const o = i * 20;
    yield {
      k: dv.getUint8(o), p0: dv.getUint8(o + 1), p1: dv.getUint8(o + 2), p2: dv.getUint8(o + 3),
      x: dv.getFloat32(o + 4, true), y: dv.getFloat32(o + 8, true), z: dv.getFloat32(o + 12, true),
      rot: dv.getFloat32(o + 16, true),
    };
  }
}
