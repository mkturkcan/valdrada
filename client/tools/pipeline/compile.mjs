// City compiler: raw NYC datasets -> binary streaming tiles + far LoD + bridges.json
// Usage: node tools/pipeline/compile.mjs --boro 1[,2,3,4]
import fs from 'node:fs';
import path from 'node:path';
import earcut from 'earcut';
import { project, TILE, MACRO, FT, FURN, STYLE, BF } from '../../src/shared/geo.js';
import { LANDMARKS, DISTRICTS, BUILDING_OVERRIDES } from '../../src/shared/landmarkSpec.js';
import { signedArea, centroid, pointInPoly, simplify, simplifyRing, alongPolyline, polylineLength, orientedBBox, hash2, mulberry, idwGrid } from './geom.mjs';
import { classify, colorJitter } from './classify.mjs';
import { loadRoofDatasets } from './rooftops.mjs';
import { matchBridgeDef, bridgeWalkDef, bridgeInputs, buildBridgeRecords, isBridgeStructure } from './bridges.mjs';

// rooftop engine datasets: DOB water tanks (BIN), TNC green roofs (BIN),
// NYSERDA distributed solar (georeferenced installs). Loaded before anything
// touches buildings (the serializer reads greenBins for the roof surface bit).
const ROOFDATA = loadRoofDatasets(project, (...a) => console.log(...a));
import { writeTile, F32, U32, U8 } from './binio.mjs';
// MUTCD 2009 Figure 3B-24 arrow outlines, extracted from the official FHWA PDF (public domain) by
// tools/refs/pdfpaths.mjs + tools/refs/mutcd_arrows.mjs: metres, x along travel from the shaft
// tail, y to the driver's LEFT (the turn arrow is drawn as a left turn; mirror y for right turns).
const MUTCD_ARROWS = JSON.parse(fs.readFileSync(new URL('./data/mutcd_arrows.json', import.meta.url), 'utf8'));
// FHWA Standard Alphabets, Series C, glyph outlines (public domain; tools/refs/pdfglyphs.mjs):
// { glyphs: { A: { adv, outer: [[x,y]...], holes: [[[x,y]...]...] } } }, cap height = 1, baseline y = 0
const SERIES_C = JSON.parse(fs.readFileSync(new URL('./data/fhwa_seriesC.json', import.meta.url), 'utf8'));

const RAW = path.resolve('data/raw');
const OUT = path.resolve(process.env.TILES_OUT || 'public/tiles');
// TERRAIN MODE. Default is FLAT: the heightmap pipeline (IDW over building bases +
// USGS park samples, road-corridor carving, steep-tile resolution) stays in this
// file behind TERRAIN=real, but the city is compiled on ONE flat base plane so
// every overlay sits at a known offset from it — asphalt BASE+0.145, curbs 0.14,
// sidewalk slabs BASE+0.28, lawns BASE+0.26, furniture and building bases at the
// sidewalk grade. No clipping, no gaps between a surface and the terrain under
// it. The Columbia superblock keeps its McKim terraces (padAt), shifted onto the
// flat base so College Walk meets the surrounding sidewalks.
const FLAT = process.env.TERRAIN !== 'real';
const RC44 = process.env.RC44 !== '0';   // RG44: roads below grade in open cuts (RC44=0: clamped to grade, as before)
const LOT_Y = 3.5;               // sidewalk / lot grade above the water plane (bulkheads ≈ 3 m)
const BASE_Y = LOT_Y - 0.26;     // the flat terrain plane
// RG44: a cut's depth per CSCL level below grade. The flat city's datum is 3.39 m over main.js's water plane (y = 0, under
// everything), so a road cut's floor stops 0.45 m over it, as RL36's rail cuts do: 2.9 m down, a trench from above (the
// 5 m clearance of a real underpass waits for the terrain of revision 5)
const CUT_PER_LEVEL = Math.min(6.5, BASE_Y + 0.145 - 0.45);
// SA37 (shoreline, round 2): pier tiles' centred sliver window, the walls' per-end overlap and the shore aprons;
// NO_SA37=1 compiles the shore as before
const SA37 = FLAT && process.env.NO_SA37 !== '1';
const CAMPUS_SHIFT = FLAT ? (LOT_Y - 0.14) - 40.2 : 0;   // College Walk pad + 0.16 brick paving = sidewalk top (BASE+0.28)
const LAWN_LIFT = FLAT ? 0.272 : 0.06;                   // lawns 8 mm under the walk top (0.28): the old 2 cm step drew an SSAO line along every lawn edge (seams.md item 6); still off-plane
fs.mkdirSync(OUT, { recursive: true });
const argBoro = process.argv.find((a) => a.startsWith('--boro'));
const BOROS = (argBoro ? (argBoro.split('=')[1] ?? process.argv[process.argv.indexOf(argBoro) + 1]) : '1').split(',').map(Number);
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1) + 's', ...a);

// ---------------------------------------------------------------- load helpers
const loadJSON = (f) => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
function loadCSV(f) {
  const txt = fs.readFileSync(path.join(RAW, f), 'utf8');
  const lines = txt.split('\n').filter((l) => l.trim());
  const head = splitCSV(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
  return lines.slice(1).map((l) => {
    const cells = splitCSV(l);
    const o = {};
    head.forEach((h, i) => (o[h] = (cells[i] ?? '').replace(/^"|"$/g, '')));
    return o;
  });
}
function splitCSV(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

// ---------------------------------------------------------------- land polygons
log('loading land polygons');
const LAND = []; // array of {outer:[[x,z]..], holes:[...]} projected
{
  const fc = loadJSON('boundaries.geojson');
  for (const f of fc.features) {
    const geom = f.geometry; if (!geom) continue;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      const rings = poly.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
      LAND.push({ outer: rings[0], holes: rings.slice(1), bbox: ringBBox(rings[0]), boro: parseInt((f.properties || {}).borocode) || 0 });
    }
  }
}
// borough code (1 Manhattan .. 5 Staten Island) of a land point, 0 for water / outside NYC
function boroAt(x, z) {
  for (const L of LAND) {
    const b = L.bbox;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (pointInPoly(x, z, L.outer)) {
      let inHole = false;
      for (const h of L.holes) if (pointInPoly(x, z, h)) { inHole = true; break; }
      if (!inHole) return L.boro;
    }
  }
  return 0;
}
function ringBBox(r) {
  let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12;
  for (const [x, z] of r) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  return [x0, z0, x1, z1];
}
function onLand(x, z) {
  for (const L of LAND) {
    const b = L.bbox;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (pointInPoly(x, z, L.outer)) {
      let inHole = false;
      for (const h of L.holes) if (pointInPoly(x, z, h)) { inHole = true; break; }
      if (!inHole) return true;
    }
  }
  return false;
}
// ---------------------------------------------------------------- New Jersey landings (OSM, ODbL)
// The CSCL records of the four bridges to New Jersey (George Washington, Bayonne, Goethals, Outerbridge Crossing) stop
// at the state line in mid-channel, and New Jersey is water in our world, so their decks ended in mid-air.
// data/raw/osm_landings.json (tools/pipeline/fetch_osm_extras.mjs) holds each bridge's full OSM alignment, its approach
// past the New Jersey abutment and the shore round the landing as land polygons: those join LAND here (borough 0), so
// the decks come down onto ground. The George Washington Bridge lands on the Palisades: its patch is a plateau at the
// cliff top (LANDING_PAD), the bridge's New Jersey anchorage and toll plaza standing ~60 m over the river.
const LANDINGS = fs.existsSync(path.join(RAW, 'osm_landings.json')) ? loadJSON('osm_landings.json') : {};
const LANDING_PAD = { gwb: 62 };
// NJ39 (lead, 2026-10-11, step 3 of the New Jersey landing plan): the backdrop draws the real New Jersey shore and the
// Palisades from USGS terrain, and the patches stand in front of it as a plateau with saw-tooth walls. With NJ_PATCHES=0
// they are no longer land (no ground, walls, lawns or trees); the alignments stay for the decks, and the tile range still
// covers the bridges' New Jersey ends (LANDING_PTS below). The default keeps the patches until the bridges' New Jersey
// ends stand on the backdrop's heights and the backdrop's shore is on main (the three land together; the lead flips it).
const NJ_PATCHES = process.env.NJ_PATCHES !== '0';
const LANDING_PTS = [];   // every projected point of the landings (bridge strands, approaches, land rings)
for (const [key, L] of Object.entries(LANDINGS)) {
  for (const line of [L.bridge || [], L.approach || [], ...(L.land || [])]) for (const [lon, lat] of line) LANDING_PTS.push(project(lon, lat));
  if (NJ_PATCHES) for (const ring of L.land || []) {
    const r = ring.map(([lon, lat]) => project(lon, lat));
    if (r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1]) r.pop();
    if (r.length < 3) continue;
    LAND.push({ outer: r, holes: [], bbox: ringBBox(r), boro: 0, landing: key, padY: LANDING_PAD[key] ?? null });
  }
}
const PADS = LAND.filter((L) => L.padY != null);
// the landing plateau's height at a land point, null off the pads
function landingPadAt(x, z) {
  for (const L of PADS) {
    const b = L.bbox;
    if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue;
    if (pointInPoly(x, z, L.outer)) return L.padY;
  }
  return null;
}
if (Object.keys(LANDINGS).length) log('New Jersey landings:', Object.keys(LANDINGS).join(', '), '|', LAND.filter((L) => L.landing).length, 'land patches', NJ_PATCHES ? '(NJ_PATCHES=0 leaves them to the backdrop)' : '(NJ39: the backdrop draws New Jersey; alignments kept for the decks)');

// Shoreline proximity index: LAND ring SEGMENTS (outer + holes) in a 32m
// hash. Point-to-SEGMENT distance gives a SMOOTH field — the earlier 10m
// point sampling produced a scalloped distance field, and terrain graded by
// it terraced whole park hillsides at 10m wavelength (Riverside Park read as
// rice paddies). Segments register in every cell their bbox touches.
const SHORE = new Map();
const SHORE_CELL = 32;
{
  const addSeg = (ax, az, bx, bz) => {
    const i0 = Math.floor(Math.min(ax, bx) / SHORE_CELL), i1 = Math.floor(Math.max(ax, bx) / SHORE_CELL);
    const j0 = Math.floor(Math.min(az, bz) / SHORE_CELL), j1 = Math.floor(Math.max(az, bz) / SHORE_CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = `${i}_${j}`;
      let arr = SHORE.get(key);
      if (!arr) SHORE.set(key, (arr = []));
      arr.push(ax, az, bx, bz);
    }
  };
  const addRing = (r) => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) addSeg(r[j][0], r[j][1], r[i][0], r[i][1]); };
  for (const L of LAND) { addRing(L.outer); for (const h of L.holes) addRing(h); }
}
function shoreClosest(x, z, max) { // -> [dist, cx, cz] closest point on any ring segment, or null
  let best = max * max, bx = 0, bz = 0, found = false;
  const ci = Math.floor(x / SHORE_CELL), cj = Math.floor(z / SHORE_CELL);
  const r = Math.ceil(max / SHORE_CELL);
  for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
    const arr = SHORE.get(`${i}_${j}`);
    if (!arr) continue;
    for (let k = 0; k < arr.length; k += 4) {
      const ax = arr[k], az = arr[k + 1], dx = arr[k + 2] - ax, dz = arr[k + 3] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + dx * t, pz = az + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) { best = d2; bx = px; bz = pz; found = true; }
    }
  }
  return found ? [Math.sqrt(best), bx, bz] : null;
}
function shoreDist(x, z, max) {
  const c = shoreClosest(x, z, max);
  return c ? c[0] : max;
}

// ---------------------------------------------------------------- PLUTO
log('loading PLUTO');
const pluto = new Map();
for (const b of BOROS) {
  const f = `pluto_${b}.csv`;
  if (!fs.existsSync(path.join(RAW, f))) continue;
  for (const r of loadCSV(f)) {
    const bbl = String(Math.round(parseFloat(r.bbl)));
    pluto.set(bbl, {
      floors: parseFloat(r.numfloors) || 0,
      year: parseInt(r.yearbuilt) || 0,
      cls: r.bldgclass || '',
      landuse: (r.landuse || '').trim(),
      histDist: r.histdist || '',
      address: r.address || '',
    });
  }
}
log('PLUTO lots:', pluto.size);

// ---------------------------------------------------------------- FISP facade materials (by BIN)
const fisp = new Map();
if (fs.existsSync(path.join(RAW, 'fisp.csv'))) {
  for (const r of loadCSV('fisp.csv')) {
    const bin = (r.bin || '').trim();
    const mats = (r.exterior_wall_material_s_ || '').trim();
    if (!bin || !mats) continue;
    const prev = fisp.get(bin);
    const date = r.filing_date || '';
    const tokens = mats.split(';').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const wallType = (r.exterior_wall_type_s_ || '').toUpperCase();
    // filings disagree over the years (Harlem Center: CAST IRON 2005/2012, MASONRY 2018, GFRC 2024);
    // remember whether ANY filing called the building brick masonry — brick is the safe read
    const anyBrick = !!(prev && prev.anyBrick) || tokens.includes('MASONRY') || tokens.includes('BRICK') || wallType.includes('BRICK');
    if (prev && prev.date > date) { prev.anyBrick = anyBrick; continue; }
    fisp.set(bin, { date, primary: tokens[0], tokens: new Set(tokens), wallType, anyBrick });
  }
  log('FISP facade materials:', fisp.size, 'buildings');
}
// ---------------------------------------------------------------- OSM building:colour (by centroid)
const osmCol = [];
if (fs.existsSync(path.join(RAW, 'osm_colours.json'))) {
  const NAMES = {
    white: [232, 228, 220], cream: [232, 220, 184], beige: [214, 197, 168], tan: [200, 176, 140],
    yellow: [236, 196, 110], brown: [122, 88, 60], red: [150, 70, 55], maroon: [110, 50, 45],   // yellow: real NYC centre line peaks ~(240,195,118); at (212,184,100) it rendered darker than the asphalt (critic 2026-09-15)
    gray: [160, 158, 152], grey: [160, 158, 152], silver: [190, 192, 194], black: [50, 52, 56],
    green: [110, 130, 100], blue: [110, 130, 160], orange: [186, 120, 70], pink: [212, 168, 158],
  };
  const parse = (c) => {
    c = (c || '').trim().toLowerCase();
    if (/^#([0-9a-f]{3})$/.test(c)) return [...c.slice(1)].map((h) => parseInt(h + h, 16));
    if (/^#([0-9a-f]{6})$/.test(c)) return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    return NAMES[c] || null;
  };
  for (const r of JSON.parse(fs.readFileSync(path.join(RAW, 'osm_colours.json'), 'utf8'))) {
    const col = parse(r.colour);
    if (!col) continue;
    const [x, z] = project(r.lon, r.lat);
    osmCol.push({ x, z, col });
  }
  log('OSM facade colours:', osmCol.length);
}
function osmColourNear(cx, cz) {
  let best = null, bd = 22;
  for (const o of osmCol) {
    const d = Math.hypot(o.x - cx, o.z - cz);
    if (d < bd) { bd = d; best = o.col; }
  }
  return best;
}

// ---------------------------------------------------------------- landmarks/districts projected
const LM = LANDMARKS.map((l) => ({ ...l, p: project(l.lon, l.lat) }));
const DIST = DISTRICTS.map((d) => ({ ...d, poly: d.poly.map(([lon, lat]) => project(lon, lat)) }));
// per-building truth overrides (owner 2026-09-15, docs/notes/amst120.md): applied after classify + district rules
const BOVR = BUILDING_OVERRIDES.map((o) => ({ ...o, p: project(o.lon, o.lat), hit: false }));
function applyBuildingOverride(b, o, rnd) {
  const c = b.c;
  if (o.style && STYLE[o.style] != null) c.style = STYLE[o.style];
  if (o.color) { c.color = o.color; b.color = colorJitter(o.color, rnd, 6); }
  if (o.roofKind != null) c.roofKind = (c.roofKind & ~7) | o.roofKind;
  for (const f of o.set || []) if (BF[f]) c.flags |= BF[f];
  for (const f of o.clear || []) if (BF[f]) c.flags &= ~BF[f];
  if (o.floors) c.floors = o.floors;
  if (o.floorH) c.floorH = o.floorH;
  if (o.winW) c.winW = o.winW;
  if (o.storeH != null) c.storeH = o.storeH;
  o.hit = true;
}

// ---------------------------------------------------------------- CY12 courtyards
// The DOITT/OSM footprint of a pre-war apartment block is a DONUT: poly[0] is the street
// outline and poly[1..] are the enclosed light courts the block is built around
// (the reference top view: four of them on the SE block of 120th & Amsterdam alone).
// The loader below used to keep poly[0] and throw the rest away, so such a block extruded
// as one solid slab. Courts are kept here and wound CW, opposite the CCW outer ring — one
// choice that does two jobs: earcut gets the hole winding it wants, and assemble.js's
// extrudePrism rule ("shoelace-positive ring => exterior side is (+ez,-ex)") turns a CW
// ring's quads to face INTO the area it encloses, which is exactly where a court wall
// looks. NO_CY12=1 restores the old behaviour for an A/B compile.
const CY12 = process.env.NO_CY12 !== '1';
const CY_MIN_AREA = 9;      // m2 — under this it is a digitising sliver, not a light court
const CY_MIN_W = 1.8;       // m  — mean width 2A/P: a 30 x 0.4 m crack is not a court either
const CY_MAX_N = 6;         // courts kept per footprint
const CY_MAX_V = 40;        // vertices kept per court ring
const cyStat = { kept: 0, tiny: 0, thin: 0, outside: 0, over: 0, complex: 0, feats: 0, emitted: 0, emFeats: 0 };
// `rings`: the projected outer ring first, then candidate inner rings (already projected).
function courtRings(inner, outer) {
  if (!CY12 || !inner || !inner.length) return [];
  const outerA = Math.abs(signedArea(outer));
  const out = [];
  for (const raw of inner) {
    if (out.length >= CY_MAX_N) { cyStat.over++; continue; }
    const h = simplifyRing(raw, 0.30);
    if (h.length < 3) { cyStat.tiny++; continue; }
    if (h.length > CY_MAX_V) { cyStat.complex++; continue; }
    const a = Math.abs(signedArea(h));
    if (a < CY_MIN_AREA || a > outerA * 0.86) { cyStat.tiny++; continue; }
    let per = 0;
    for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; per += Math.hypot(q[0] - p[0], q[1] - p[1]); }
    if (per <= 0 || (2 * a) / per < CY_MIN_W) { cyStat.thin++; continue; }
    // the two rings are simplified independently, which can push a court vertex through
    // the outer wall. earcut turns a hole that crosses its outer ring into a bow tie
    // across the WHOLE roof deck, so such a court is dropped rather than repaired.
    let ok = true;
    for (const [x, z] of h) if (!pointInPoly(x, z, outer)) { ok = false; break; }
    if (!ok) { cyStat.outside++; continue; }
    if (signedArea(h) > 0) h.reverse();   // CW — opposite the CCW outer
    out.push(h);
    cyStat.kept++;
  }
  if (out.length) cyStat.feats++;
  return out;
}

// ---------------------------------------------------------------- buildings
log('loading buildings');
// WB14: borough from a 10-digit BBL string (borough digit + 5 block + 4 lot); 0 when unmatched
const bblBoro = (k) => { const d = k.charCodeAt(0) - 48; return (k.length === 10 && d >= 1 && d <= 5) ? d : 0; };
const buildings = [];
const seenBin = new Set();
const badHeights = [];   // TW39: [bin, height, mean width] of the footprints whose height_roof no building has
let placeholders = 0;   // TW39: feature code 1003 records skipped
// TW39: the footprint exports come from data/raw/footprints/latest/ (fetch.mjs --footprints: a dated export checked against
// the live dataset's count) when it exists, else from the files beside the other raw data. Those were exported on
// 2026-07-06 and lacked 2,299 of today's 163,914 records in Manhattan's box: 30 Rockefeller Plaza, 53 West 53rd and 89
// more towers over 60 m (the towers lane's audit, 2026-10-11). FOOTPRINTS_DIR overrides (a path under data/raw, '' = the old files).
const FOOT_DIR = process.env.FOOTPRINTS_DIR ?? (fs.existsSync(path.join(RAW, 'footprints', 'latest')) ? path.join('footprints', 'latest') : '');
{
  let when = '';
  try { when = JSON.parse(fs.readFileSync(path.join(RAW, FOOT_DIR, 'fetch.json'), 'utf8')).fetched; } catch { /* the old files */ }
  log(' footprints:', FOOT_DIR ? `${FOOT_DIR} (fetched ${when || '?'})` : 'data/raw (the 2026-07-06 exports)');
}
for (const b of BOROS) {
  const f = path.join(FOOT_DIR, `buildings_${b}.geojson`);
  if (!fs.existsSync(path.join(RAW, f))) continue;
  const fc = loadJSON(f);
  for (const feat of fc.features) {
    const p = feat.properties, g = feat.geometry;
    if (!g) continue;
    // TW39: feature code 1003 is a placeholder (a triangle where a permitted building's outline is still to come), not an
    // outline: 34 in the fresh exports, among them a 109 m2 triangle under 262 Fifth Avenue's tower
    if (String(p.feature_code) === '1003') { placeholders++; continue; }
    const bin = p.bin || p.doitt_id;
    if (seenBin.has(bin)) continue;
    seenBin.add(bin);
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    // largest outer ring wins; its inner rings are the light courts (CY12 — they used to
    // be dropped here, which is why a pre-war block read as one slab)
    let best = null, bestA = 0, bestPoly = null;
    for (const poly of polys) {
      const ring = poly[0].map(([lon, lat]) => project(lon, lat));
      const a = Math.abs(signedArea(ring));
      if (a > bestA) { bestA = a; best = ring; bestPoly = poly; }
    }
    if (!best || bestA < 6) continue;
    const ring = simplifyRing(best, 0.35);
    if (ring.length < 3) continue;
    if (signedArea(ring) < 0) ring.reverse(); // CCW
    // CY12: court rings must be tested against the SIMPLIFIED outer ring, so they are
    // built after it
    const holes = courtRings((bestPoly || []).slice(1).map((r) => r.map(([lon, lat]) => project(lon, lat))), ring);
    let h = (parseFloat(p.height_roof) || 0) * FT;
    // degenerate slivers: a footprint digitised as a line (area / perimeter -> mean width under
    // 1.6 m) extruded to a real roof height stood as a 250 m grey needle over Midtown in the ad
    // film's hero camera (critic round 5, crops/sm_tower.png). Real slivers are ≤ 2 storeys.
    { let per = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      const meanW = per > 0 ? (2 * bestA) / per : 0;
      if (meanW < 1.6 && h > 12) continue;
      if (bestA < 12 && h > 25) continue;
      // TW39: heights no building has. The fresh export carries a Bronx footprint at 2,130,353 ft (its own BIN in the height
      // field: 649 km) and, beside 432 Park Avenue, a 6 m wide annex at the tower's 425.5 m. A roof over 500 m (the city's
      // tallest is 472 m) or 50 times the footprint's mean width (the slenderest towers and chimneys stay under 45) is not
      // the building's: it is read as unknown (the PLUTO floors, else a low default), and counted
      if (h > 500 || (h > 60 && meanW > 0 && h / meanW > 50)) { badHeights.push([String(bin), +h.toFixed(1), +meanW.toFixed(1)]); h = -1; } }
    const base = (parseFloat(p.ground_elevation) || 10) * FT;
    const bblKey = String(Math.round(parseFloat(p.mappluto_bbl || p.base_bbl) || 0));
    const [cx, cz] = centroid(ring);
    buildings.push({
      bin, ring, holes, area: bestA, cx, cz, base,   // CY12: holes = enclosed light courts, CW
      h: h > 2 ? h : 4 + hash2(cx, cz) * 4,   // TW39: a height no building has (h = -1) takes this low default too
      year: parseInt(p.construction_year) || 0,
      pl: pluto.get(bblKey) || null,
      name: p.name || '',
      // WB13 (docs/notes/wburg-r13.md): classify() has never seen a borough, and
      // the frame-belt rule is a borough fact (a class-C0 of 1905 is a sided
      // house in Greenpoint and a masonry tenement in Harlem).
      // WB14: the DOITT exports are BBOX exports, not borough exports —
      // buildings_1.geojson spans lon -74.047..-73.900 / lat 40.678..40.888, so it
      // also holds Williamsburg, Greenpoint, Bushwick, LIC, Astoria and the south
      // Bronx, and the seenBin de-dup above loads all of those under b = 1. The
      // v19 census showed it: 258,992 FRAME_HOUSE citywide, ZERO in every 2 km
      // cell of north Brooklyn, and all 143 footprints within 120 m of Bedford &
      // N 7th carried BBL 3xxxxxxxxx while tagged Manhattan. The BBL's first digit
      // is the borough for every footprint that matched a lot, the land polygon
      // answers for the rest, and the file index is only the last resort.
      boro: bblBoro(bblKey) || boroAt(cx, cz) || b,
      // TW39: a record the city has not finished (newly initialised, marked or investigated for construction, or a building
      // under construction): its height may be provisional
      provisional: /Initialization|Marked for Construction|Investigate Construction/.test(p.last_status_type || '') || String(p.feature_code) === '5100',
    });
  }
}
log('buildings:', buildings.length);
if (badHeights.length) log(' footprint heights no building has, read as unknown (TW39):', JSON.stringify(badHeights));
log(' footprint placeholders (feature code 1003) skipped (TW39):', placeholders);
// ---------------------------------------------------------------- OSM gap-fill
// The DOITT footprint file misses recent buildings (100 W 125th St, the 2017 block-long retail
// building on the SW corner of 125th & Lenox, rendered as an empty lot — ref_lenox.png review
// 2026-09-10). data/raw/osm_buildings_<boro>.json (Overpass `out geom tags`) supplies footprints
// that overlap NO existing building; height from `height` / `building:levels`, class from the
// `building` value so classify() can style them.
let bridgeStructuresSkipped = 0;
let osmLevelsWin = 0;   // TW39
const osmTaller = [];   // TW39: [bin, OSM name, the record's height, the OSM height it takes]
{
  let added = 0, skipped = 0;
  const cellB = 32, bIdx = new Map();
  const bkey = (x, z) => `${Math.floor(x / cellB)}_${Math.floor(z / cellB)}`;
  buildings.forEach((b, i) => { const k = bkey(b.cx, b.cz); let a = bIdx.get(k); if (!a) bIdx.set(k, (a = [])); a.push(i); });
  const nearBuildings = (x, z) => {
    const gx = Math.floor(x / cellB), gz = Math.floor(z / cellB), out = [];
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const a = bIdx.get(`${gx + dx}_${gz + dz}`); if (a) for (const i of a) out.push(buildings[i]); }
    return out;
  };
  const clsFor = (t) => {
    const v = (t.building || '').toLowerCase();
    if (/commercial|retail|supermarket|kiosk/.test(v)) return 'K';
    if (/office/.test(v)) return 'O';
    if (/apartments|residential|dormitory/.test(v)) return 'D';
    if (/house|terrace|semidetached|detached/.test(v)) return 'A';
    if (/industrial|warehouse|garage|parking|service/.test(v)) return 'E';
    if (/church|cathedral|chapel|synagogue|mosque|temple|religious/.test(v)) return 'M';
    if (/school|university|college|kindergarten|hospital|civic|public|government/.test(v)) return 'W';
    if (/hotel/.test(v)) return 'H';
    return '';
  };
  for (const b of BOROS) {
    const f = `osm_buildings_${b}.json`;
    if (!fs.existsSync(path.join(RAW, f))) continue;
    let els;
    try { els = loadJSON(f).elements || []; } catch (e) { log(' osm buildings: unreadable', f, e.message); continue; }
    for (const el of els) {
      const t = el.tags || {};
      // the bridges' towers, piers and anchorages (OSM `bridge:support`, building=bridge): the bridge kit draws them
      if (isBridgeStructure(t)) { bridgeStructuresSkipped++; continue; }
      let rings = [];
      let innerG = [];   // CY12: multipolygon `inner` members are this block's light courts
      if (el.type === 'way' && el.geometry && el.geometry.length >= 4) rings = [el.geometry];
      else if (el.type === 'relation' && el.members) {
        for (const m of el.members) {
          if (!m.geometry || m.geometry.length < 4) continue;
          if (m.role === 'outer') rings.push(m.geometry);
          else if (m.role === 'inner') innerG.push(m.geometry);
        }
      }
      if (!rings.length) continue;
      let best = null, bestA = 0;
      for (const g of rings) {
        const ring = g.map((p) => project(p.lon, p.lat));
        const a = Math.abs(signedArea(ring));
        if (a > bestA) { bestA = a; best = ring; }
      }
      if (!best || bestA < 20) continue;
      const ring = simplifyRing(best, 0.35);
      if (ring.length < 3) continue;
      if (signedArea(ring) < 0) ring.reverse();
      const holes = courtRings(innerG.map((g) => g.map((p) => project(p.lon, p.lat))), ring);   // CY12
      const [cx, cz] = centroid(ring);
      // only inside the boroughs being compiled (the Overpass bbox reaches Jersey City / Hoboken
      // and the neighbouring boroughs' waterfronts, which a partial --boro run has no DOITT set for)
      const gfBoro = boroAt(cx, cz);   // WB13: kept, so the gap-fill carries a borough too
      if (!BOROS.includes(gfBoro)) { skipped++; continue; }
      // overlap test against the DOITT set: any existing centroid inside this ring, this centroid
      // inside an existing ring, an existing centroid within 6 m, or a quarter of this ring's
      // vertices/edge midpoints inside existing footprints → already represented (differently
      // split footprints: an L-shaped DOITT record vs two OSM rectangles)
      let dup = false;
      const near = nearBuildings(cx, cz);
      for (const ob of near) {
        if (Math.hypot(ob.cx - cx, ob.cz - cz) < 6 || pointInPoly(ob.cx, ob.cz, ring) || pointInPoly(cx, cz, ob.ring)) { dup = true; break; }
      }
      if (!dup && near.length) {
        let inside = 0, total = 0;
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i], b2 = ring[(i + 1) % ring.length];
          for (const [sx, sz] of [[a[0] * 0.98 + cx * 0.02, a[1] * 0.98 + cz * 0.02], [(a[0] + b2[0]) / 2 * 0.98 + cx * 0.02, (a[1] + b2[1]) / 2 * 0.98 + cz * 0.02]]) {
            total++;
            for (const ob of near) if (pointInPoly(sx, sz, ob.ring)) { inside++; break; }
          }
        }
        if (total && inside / total > 0.25) dup = true;
      }
      // TW39: a provisional city record (status Initialization, Marked or Investigate Construction, or under construction)
      // under a finished OSM building at least 1.4 times as tall takes the OSM height: the record lags the tower (270 Park
      // Avenue, 423 m, whose new record says 213.4 m). The record keeps its ring and its identity (a landmark keeps its
      // builder); an OSM building still under construction never counts (The Torch, a 325 m proposal, stood in run 6).
      if (dup && !/construction/i.test(t.building || '')) {
        const oh = parseFloat(t.height) || 0, olv = parseFloat(t['building:levels']) || 0;
        const H = oh > 2 && !(olv >= 3 && oh < olv * 1.6) ? oh : olv * 3.4 + 1;
        if (H >= 60) for (const ob of near) {
          if (ob.osm || !ob.provisional || !(H >= ob.h * 1.4) || ob.area < 0.4 * bestA) continue;   // an outline comparable to the tower's
          if (!(pointInPoly(ob.cx, ob.cz, ring) || pointInPoly(cx, cz, ob.ring))) continue;
          osmTaller.push([String(ob.bin), t.name || '', +ob.h.toFixed(1), +H.toFixed(1)]); ob.h = H;
        }
      }
      if (dup) { skipped++; continue; }
      const levels = parseFloat(t['building:levels']) || 0;
      const cls = clsFor(t);
      let h = parseFloat(t.height) || 0;
      if (!(h > 2) && levels) h = levels * 3.4 + 1.0;
      // TW39: a `height` far under what its own `building:levels` give is not the building's height (30 Rockefeller Plaza's
      // way carries height=10 with building:levels=70, and became a 10 m slab where the DOITT record was missing): the levels win
      if (h > 2 && levels >= 3 && h < levels * 1.6) { h = levels * 3.4 + 1.0; osmLevelsWin++; }
      if (!(h > 2)) h = cls === 'O' ? 20 : cls === 'D' ? 18 : cls === 'K' ? 15 : cls === 'A' ? 11 : 12;   // untagged: typical by use
      const year = parseInt((t.start_date || '').slice(0, 4)) || 0;
      const nb = {
        bin: 'osm' + el.id, ring, holes, area: bestA, cx, cz, base: 10 * FT, h, year,   // CY12
        pl: cls || levels ? { cls, floors: levels, year } : null,
        name: t.name || '', osm: true, boro: gfBoro,   // WB13
      };
      buildings.push(nb);
      const k = bkey(cx, cz); let a = bIdx.get(k); if (!a) bIdx.set(k, (a = [])); a.push(buildings.length - 1);
      added++;
    }
  }
  if (added || skipped) log(' osm gap-fill buildings added:', added, 'already covered:', skipped, '| bridge towers, piers and anchorages left to the bridge kit:', bridgeStructuresSkipped, '| heights from building:levels over a contradicting height tag (TW39):', osmLevelsWin);
  if (osmTaller.length) log(' provisional city records raised to the finished OSM tower on them (TW39):', JSON.stringify(osmTaller));
}
// CY12 census, loader half: how many footprint inner rings survived the filters
log(` CY12 courts loaded: kept ${cyStat.kept} on ${cyStat.feats} footprints | dropped`
  + ` tiny/huge ${cyStat.tiny} thin ${cyStat.thin} crossing-outer ${cyStat.outside}`
  + ` >${CY_MAX_V}v ${cyStat.complex} >${CY_MAX_N}/bldg ${cyStat.over}`);
// flat plane: every building stands on the sidewalk grade (real bases return with TERRAIN=real)
// (FLAT building bases are set just before classification — after the terrain/pad machinery exists)

// ---------------------------------------------------------------- roads
// FOOTPRINT GROUND: a building whose footprint reaches past the land polygon stands on its pier, not over the water —
// the terrain counts every node inside a footprint as land (the 4 m pier-tile grid otherwise opened water under the
// Empire Outlets' river fronts at St. George and left their bases floating). Footprints by 32 m cell.
const FOOT_CELL = 32, footGrid = new Map();
for (const b of buildings) {
  if (!b.ring || b.ring.length < 3) continue;
  const bb = ringBBox(b.ring);
  b._fbb = bb;
  for (let gx = Math.floor(bb[0] / FOOT_CELL); gx <= Math.floor(bb[2] / FOOT_CELL); gx++) for (let gz = Math.floor(bb[1] / FOOT_CELL); gz <= Math.floor(bb[3] / FOOT_CELL); gz++) {
    const k = gx + '_' + gz; let a = footGrid.get(k); if (!a) footGrid.set(k, (a = [])); a.push(b);
  }
}
function inFootprint(x, z) {
  const a = footGrid.get(Math.floor(x / FOOT_CELL) + '_' + Math.floor(z / FOOT_CELL));
  if (a) for (const b of a) if (!b.drop && x >= b._fbb[0] && x <= b._fbb[2] && z >= b._fbb[1] && z <= b._fbb[3] && pointInPoly(x, z, b.ring)) return true;
  return false;
}

log('loading roads');
const roads = []; // {pts [[x,z]..], width m, rclass, oneway, lanes, park, name, level, speed, segId, bridgeKey}
// DBG_NODE="x,z,r": dump every road end within r m of (x,z) after each graph stage
// (DBG_EXIT=1 stops after junction prep) — for chasing moved/merged junction nodes
const DBG = process.env.DBG_NODE ? process.env.DBG_NODE.split(',').map(Number) : null;
const dbgDump = (stage) => {
  if (!DBG) return;
  const [X, Z, R] = DBG, out = [];
  for (const r of roads) {
    if (!r.pts || r.pts.length < 2) continue;
    for (const end of [0, 1]) {
      const p = end === 0 ? r.pts[0] : r.pts[r.pts.length - 1];
      if (Math.hypot(p[0] - X, p[1] - Z) < R) out.push(`${r.name} rc${r.rclass} ow${r.oneway} w${(+r.width).toFixed(1)} end${end} (${p[0].toFixed(1)},${p[1].toFixed(1)}) L${polylineLength(r.pts).toFixed(0)} pts${r.pts.length}${r.noGeom ? ' noGeom' : ''}${r.jSkip ? ' jSkip' : ''}${r.level ? ' lvl' + r.level : ''}`);
    }
  }
  console.log(`[dbg ${stage}] ${out.length} ends:\n  ${out.sort().join('\n  ')}`);
};
const seenSeg = new Set();
// BRIDGE_DEFS and the bridge records: tools/pipeline/bridges.mjs
const bridgeSegs = new Map(); // key -> [{pts,width,name}]
let multiPartRamps = 0;   // CSCL ramps drawn in several parts (one climb shared between them)
let bridgeWalks = 0;      // (BR38) kit bridges' walkways and bike paths left to the kit
for (const b of BOROS.concat([])) {
  const f = `streets_${b}.geojson`;
  if (!fs.existsSync(path.join(RAW, f))) continue;
  const fc = loadJSON(f);
  for (const feat of fc.features) {
    const p = feat.properties, g = feat.geometry;
    if (!g) continue;
    const id = p.physicalid || p.objectid;
    if (seenSeg.has(id)) continue;
    seenSeg.add(id);
    const rw = parseInt(p.rw_type);
    if (![1, 2, 3, 6, 9, 10].includes(rw)) continue; // streets, hwys, bridges, paths, ramps, alleys
    if ((p.status && p.status !== '2') || p.nonped === 'V') { /* keep; status 2=constructed */ }
    const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    const name = (p.stname_label || p.full_street_name || p.street_name || '').trim().replace(/ +/g, ' ');
    const rawName = (p.full_street_name || '').trim();
    const widthFt = parseFloat(p.streetwidth) || (rw === 2 ? 60 : rw === 6 ? 10 : 30);
    const width = Math.min(45, Math.max(rw === 6 ? 2.5 : 7, widthFt * FT));
    const lanes = Math.max(1, parseInt(p.number_travel_lanes) || Math.max(1, Math.round(width / 3.6) - 1));
    const park = parseInt(p.number_park_lanes) || 0;
    const oneway = p.trafdir === 'FT' ? 1 : p.trafdir === 'TF' ? -1 : 0;
    const lvA = parseInt(p.from_level_code) || 13, lvB = parseInt(p.to_level_code) || 13;
    // RG44: an end below grade (CSCL level < 13: Dyer Avenue's cut, the Cross Bronx's trench, the Grand Concourse's
    // underpasses) keeps its level and the road is drawn in an open cut (roadCuts below); clamped to grade, every one of
    // them was laid across the streets it passes under (tools/pipeline/roadgate.mjs: 1,655 such nodes in run 13)
    const cutRoad = RC44 && Math.min(lvA, lvB) < 13;
    const level = cutRoad ? -1 : Math.max(0, Math.round(((lvA + lvB) / 2 - 13) / 4));
    const speed = parseInt(p.posted_speed) || (rw === 2 ? 50 : 25);
    // non-vehicular pieces: CSCL rw_type 5 boardwalk / 6 path / 7 step street, and the bridge
    // (rw 3) pedestrian + bike paths and pedestrian overpasses that only carry it in the name.
    // They came through as 9.1 m rclass-1 ROADS climbing to +10 m (Madison Av Brdg ped & bike
    // path, E 129 St pedestrian OPAS...) and the traffic sim drove cars up them into the air
    // (2026-09-04 video review). Paths (rclass 5) get no traffic and a 3.5 m ribbon.
    // trafdir 'NV' = non-vehicular: housing-campus walkways, closed street sections and plazas
    // digitised as rw_type 1 with no width — they compiled as 9.1 m roads and the traffic sim
    // drove cars through the campuses ("vehicles going through buildings", owner review 2026-09-04)
    // rw_type 12 = non-physical segment, 14 = ferry route: neither is a road. They compiled as
    // default-width (9.1 m) rclass-1 roads — ferry routes across the rivers with traffic on them.
    if (rw === 12 || rw === 14) continue;
    // ...but a pedestrianised STREET (NV with a real roadway width: Wall St's security zone, Fulton
    // Mall, Times Square's bowtie) keeps its full street geometry — asphalt, kerbs, sidewalks — and
    // only loses its traffic (noTraffic flag, bit 7 of rclass in the tile record). Turning Wall St
    // into a 3.5 m path left a bare grey plane where the street was (critic round 5, P10).
    // Times Square's Broadway bowtie and the other pedestrian plazas carry no streetwidth in CSCL:
    // a named avenue/mall/plaza that is NV is still a full-width paved plaza, not a 3.5 m path
    // (Times Square's Broadway bowtie is rw_type 6 "path" in CSCL with no width — a 3 m path in a
    // field of terrain in the tiles; it is a 60 ft paved plaza on the ground.)
    const pedStreet = (p.trafdir === 'NV' || rw === 6) && (rw === 1 || rw === 6)
      && (parseFloat(p.streetwidth) >= 15 || (!parseFloat(p.streetwidth) && /BROADWAY|\bAVE\b|\bMALL\b|PLAZA|\bPL\b|\bBLVD\b/.test(rawName.toUpperCase())))
      && !/PEDESTRIAN|OPAS|WALK|PATH|GREENWAY|ESPLANADE|PROMENADE|PARK/.test(rawName.toUpperCase());
    const widthPS = pedStreet && width < 15 ? 18.3 : width;   // plaza width when CSCL has none
    const pedPath = !pedStreet && (rw === 5 || rw === 6 || rw === 7 || p.trafdir === 'NV'
      || /PEDESTRIAN|OPAS|FOOTBRIDGE|FOOT BRIDGE|PED (&|AND) BIKE|BIKE PATH|BIKE (&|AND) PED|WALKWAY|ESPLANADE|GREENWAY|PROMENADE|BOARDWALK|STEP STREET|STAIRS?\b/.test(rawName.toUpperCase()));
    // a multi-part segment is ONE climb from its from-level to its to-level: each part takes the levels at its own ends
    // along the parts' running length. Every part used to climb the whole lift, a sawtooth of ramps (332 CSCL segments
    // citywide, e.g. the St. George ferry terminal's ramp, physicalid 194030: three parts each 10.3 m -> 3.5 m)
    const lA = cutRoad ? (lvA - 13) / 4 : Math.max(0, (lvA - 13) / 4), lB = cutRoad ? (lvB - 13) / 4 : Math.max(0, (lvB - 13) / 4);
    const partLen = lines.map((ln) => { let s = 0; for (let i = 1; i < ln.length; i++) { const [ax, az] = project(ln[i - 1][0], ln[i - 1][1]), [bx, bz] = project(ln[i][0], ln[i][1]); s += Math.hypot(bx - ax, bz - az); } return s; });
    const lenTot = partLen.reduce((a, b) => a + b, 0) || 1;
    if (lines.length > 1 && lA !== lB) multiPartRamps++;
    let lenRun = 0;
    for (const [li, line] of lines.entries()) {
      const pA = lA + (lB - lA) * (lenRun / lenTot), pB = lA + (lB - lA) * ((lenRun + partLen[li]) / lenTot);
      lenRun += partLen[li];
      let pts = line.map(([lon, lat]) => project(lon, lat));
      pts = simplify(pts, 0.4);
      if (pts.length < 2 || polylineLength(pts) < 3) continue;
      // (BR38: a kit bridge's own walkway or bike path: the kit draws the walks)
      if (bridgeWalkDef(rawName, rw, pts)) { bridgeWalks++; continue; }
      const bd = matchBridgeDef(rawName, rw, lvA, lvB, pts);
      if (bd) {
        let arr = bridgeSegs.get(bd.key);
        if (!arr) bridgeSegs.set(bd.key, (arr = []));
        arr.push({ pts, width, name });
        continue; // main bridge decks handled separately
      }
      roads.push({
        pts, width: pedPath ? Math.min(width, 3.5) : widthPS, name, oneway, lanes, park: pedStreet ? 0 : park, level, speed, segId: parseInt(id) || 0,
        noTraffic: pedStreet,
        lA: pA, lB: pB, // per-end levels → ramps slope (this part's share of the segment's climb)
        cut: cutRoad,   // RG44: in an open cut (an end below grade)
        bike: parseInt(p.bike_lane) || 0,
        rclass: pedPath ? 5 : pedStreet ? (widthPS >= 13.5 ? 2 : 1) : rw === 2 ? 3 : rw === 9 ? 4 : rw === 10 ? 6 : width >= 13.5 ? 2 : 1, // 2 = wide roadway (>= 44 ft: avenues, 125th-class cross streets); CSCL streetwidth is curb-to-curb, so the old 22 m bar left Manhattan avenues (60-70 ft) unsignalized
        isBridgePiece: rw === 3, // unmatched bridge bits (ramps etc.) stay as elevated roads
      });
    }
  }
}
// College Walk: CSCL carries W 116 St through Columbia as ordinary street
// segments — reclass to path inside campus so no asphalt/sidewalks/traffic
// cross the pedestrian mall (the OSM brick pass paves it instead)
for (const r of roads) {
  if (!/^W 116 ST/.test(r.name || '')) continue;
  const [mx, mz] = r.pts[Math.floor(r.pts.length / 2)];
  // noGeom: the OSM brick mall owns this ground — a second ribbon at a
  // near-identical height depth-fights it into jagged shreds
  if (mx > 570 && mx < 1085 && mz > -2760 && mz < -2650) { r.rclass = 5; r.width = Math.min(r.width, 17); r.noGeom = true; }
}
log('road segments:', roads.length, 'bridge groups:', bridgeSegs.size, '| multi-part ramps (one climb across the parts):', multiPartRamps, '| kit bridges\' walks left to the kit:', bridgeWalks);

// ---------------------------------------------------------------- duplicate parallels
// CSCL carries near-coincident duplicates (generic centerline + roadbed pieces
// of the same street): both emit ribbons, DOUBLE center lines, twin junction
// nodes and doubled crosswalks. Where one road's centerline runs deep inside
// another same-name road's ribbon for most of its length, keep only the more
// significant one. True twin carriageways sit a full roadway apart - unaffected.
{
  const cell = 20, grid = new Map();
  roads.forEach((r, ri) => {
    if (r.rclass >= 5) return;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
      for (let gx = Math.floor(Math.min(x1, x2) / cell); gx <= Math.floor(Math.max(x1, x2) / cell); gx++)
        for (let gz = Math.floor(Math.min(z1, z2) / cell); gz <= Math.floor(Math.max(z1, z2) / cell); gz++) {
          const k = gx + '_' + gz;
          let a2 = grid.get(k); if (!a2) grid.set(k, (a2 = []));
          a2.push([ri, i]);
        }
    }
  });
  const drop = new Set();
  const score = (r) => polylineLength(r.pts) * r.width;
  roads.forEach((r, ri) => {
    if (r.rclass >= 5 || drop.has(ri)) return;
    const L = polylineLength(r.pts);
    if (L < 8) return;
    const overlap = new Map();
    let nSamp = 0;
    for (let d = 2; d < L - 2; d += 6) {
      nSamp++;
      const [x, z] = alongPolyline(r.pts, d);
      const seen = new Set();
      const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a2 = grid.get(`${gx + dx}_${gz + dz}`);
        if (!a2) continue;
        for (const [rj, j] of a2) {
          if (rj === ri || seen.has(rj) || drop.has(rj)) continue;
          const B = roads[rj];
          if (B.name !== r.name || B.level !== r.level) continue;
          const [x1, z1] = B.pts[j - 1], [x2, z2] = B.pts[j];
          const ddx = x2 - x1, ddz = z2 - z1, L2 = ddx * ddx + ddz * ddz || 1e-9;
          const tRaw = ((x - x1) * ddx + (z - z1) * ddz) / L2;
          // samples that project BEYOND THE ENDS OF B'S WHOLE POLYLINE do not count:
          // an end-to-end neighbour (the 13.6 m W 125 St link between the twin Lenox
          // nodes, CSCL physid 19418) had every sample "inside" the adjoining pieces'
          // half-widths simply by touching their ends, and was dropped — 3.6 m of bare
          // ground across every divided-avenue junction. Samples near B's INTERNAL
          // vertices still count (a per-segment interior test skipped them and let
          // ~2,700 true roadbed duplicates survive: 3061 -> 386 dropped, Lenox lost
          // its lane paint under doubled ribbons).
          // ...but ONLY for short r (< 25 m): applied to every road it let ~2,400 genuine
          // roadbed duplicates through (3061 -> 648 dropped) and re-clustered nodes
          // citywide (Lenox's carriageways then converged and lost their twin status).
          if (L < 25 && ((j === 1 && tRaw < -0.02) || (j === B.pts.length - 1 && tRaw > 1.02))) continue;
          const t = Math.max(0, Math.min(1, tRaw));
          const dd = Math.hypot(x - (x1 + ddx * t), z - (z1 + ddz * t));
          // ribbon-overlap criterion: centerlines closer than the sum of half-
          // widths minus margin = the carriageways physically overlap (true twin
          // carriageways always keep a positive gap and never trigger this)
          if (dd < (B.width + r.width) / 2 - 0.8) { overlap.set(rj, (overlap.get(rj) || 0) + 1); seen.add(rj); }
        }
      }
    }
    for (const [rj, cnt] of overlap) {
      if (cnt < nSamp * 0.6) continue; // needs deep overlap over most of the length
      const B = roads[rj];
      if (score(B) <= score(r)) drop.add(rj);
      else { drop.add(ri); break; }
    }
  });
  if (drop.size) {
    const keep = roads.filter((_, i) => !drop.has(i));
    roads.length = 0;
    for (const r of keep) roads.push(r);
  }
  log(' duplicate parallels dropped:', drop.size);
}
dbgDump('after-dup-parallels');

// ---------------------------------------------------------------- T-junction splitting
// CSCL sometimes ends a segment ON another segment's mid-span without splitting
// it — the endpoint then shares no node with the through road, the junction gets
// no cap/crosswalks, and traffic sees a dead end (mid-street U-turns). Split the
// through road at the touch point and snap the endpoint to it so a real 3-way
// node forms downstream.
{
  const cell = 24;
  const segIdx = new Map();
  roads.forEach((r, ri) => {
    if (r.rclass >= 5) return;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
      for (let gx = Math.floor(Math.min(x1, x2) / cell); gx <= Math.floor(Math.max(x1, x2) / cell); gx++)
        for (let gz = Math.floor(Math.min(z1, z2) / cell); gz <= Math.floor(Math.max(z1, z2) / cell); gz++) {
          const k = gx + '_' + gz;
          let a = segIdx.get(k); if (!a) segIdx.set(k, (a = []));
          a.push([ri, i]);
        }
    }
  });
  const splits = new Map(); // ri -> [{d, x, z}] cut points by arc length
  const arcTo = (r, i, t) => { // arc length to param t on segment i
    let d = 0;
    for (let j = 1; j < i; j++) d += Math.hypot(r.pts[j][0] - r.pts[j - 1][0], r.pts[j][1] - r.pts[j - 1][1]);
    return d + t * Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
  };
  let tees = 0, shared = 0, clamped = 0, rampSplits = 0;
  // an end that already coincides with another road's end IS a node (CSCL split the
  // through road there). Divided-avenue twin nodes (Lenox/ACP/FDB at every cross
  // street) were being "grafted" 7 m sideways onto the interior vertex of the 14 m
  // between-carriageways piece — the clamped projection onto its second segment
  // passed the width/2+1.5 test — which squeezed the twins to 8 m apart at 124th
  // and collapsed them onto one point at 126th (lenoxRef review 2026-09-10).
  const endCount = new Map();
  const ekeyT = (x, z) => `${Math.round(x / 1.2)}_${Math.round(z / 1.2)}`;
  for (const r of roads) {
    if (r.rclass >= 5 || r.pts.length < 2) continue;
    for (const p of [r.pts[0], r.pts[r.pts.length - 1]]) { const k = ekeyT(p[0], p[1]); endCount.set(k, (endCount.get(k) || 0) + 1); }
  }
  roads.forEach((r, ri) => {
    if (r.rclass >= 5 || polylineLength(r.pts) < 3) return;
    for (const end of [0, 1]) {
      if (Math.abs(end === 0 ? (r.lA || 0) : (r.lB || 0)) > 0.1) continue; // elevated (or cut, RG44) end — don't graft onto grade
      const p = end === 0 ? r.pts[0] : r.pts[r.pts.length - 1];
      if ((endCount.get(ekeyT(p[0], p[1])) || 0) >= 2) { shared++; continue; }   // already a shared node
      let best = null;
      const gx0 = Math.floor(p[0] / cell), gz0 = Math.floor(p[1] / cell);
      for (let gz = gz0 - 1; gz <= gz0 + 1; gz++) for (let gx = gx0 - 1; gx <= gx0 + 1; gx++) {
        const a = segIdx.get(gx + '_' + gz);
        if (!a) continue;
        for (const [rj, j] of a) {
          if (rj === ri) continue;
          const B = roads[rj];
          if (Math.abs(B.lA || 0) > 0.1 || Math.abs(B.lB || 0) > 0.1 || B.noGeom) continue;
          const [x1, z1] = B.pts[j - 1], [x2, z2] = B.pts[j];
          const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz;
          if (L2 < 1e-6) continue;
          const tRaw = ((p[0] - x1) * dx + (p[1] - z1) * dz) / L2;
          const t = Math.max(0, Math.min(1, tRaw));
          const px = x1 + dx * t, pz = z1 + dz * t;
          const d = Math.hypot(p[0] - px, p[1] - pz);
          if (d > B.width / 2 + 1.5) continue;
          // a projection clamped onto an interior vertex is not a touch on this segment
          // (the neighbouring segment owns that vertex); only a near-exact hit counts
          if ((tRaw < 0.02 || tRaw > 0.98) && d > 1.5) { clamped++; continue; }
          // skip when the touch point is basically B's own endpoint (normal node)
          const dEndA = arcTo(B, j, t), dEndB = polylineLength(B.pts) - dEndA;
          if (dEndA < 6 || dEndB < 6) continue;
          if (!best || d < best.d) best = { d, rj, arc: dEndA, x: px, z: pz };
        }
      }
      if (!best) continue;
      let a = splits.get(best.rj); if (!a) splits.set(best.rj, (a = []));
      // dedupe near-identical cut points (two stubs meeting the same spot)
      const dup = a.find((s) => Math.hypot(s.x - best.x, s.z - best.z) < 3);
      if (dup) { p[0] = dup.x; p[1] = dup.z; continue; }
      a.push({ d: best.arc, x: best.x, z: best.z });
      p[0] = best.x; p[1] = best.z; // snap the ending road onto the through road
      tees++;
    }
  });
  log(' T-junction grafts:', tees, 'ends already shared nodes (skipped):', shared, 'clamped-vertex rejects:', clamped);
  // apply cuts (walk each road once, emit pieces)
  for (const [ri, cuts] of splits) {
    const r = roads[ri];
    // re-project each cut onto the (possibly endpoint-snapped) polyline so the
    // piece boundary lands in the right segment
    for (const c of cuts) {
      let bestD = 0, bestDist = 1e9, acc2 = 0;
      for (let i = 1; i < r.pts.length; i++) {
        const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
        const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
        const t = Math.max(0, Math.min(1, ((c.x - x1) * dx + (c.z - z1) * dz) / L2));
        const dd = Math.hypot(c.x - (x1 + dx * t), c.z - (z1 + dz * t));
        if (dd < bestDist) { bestDist = dd; bestD = acc2 + t * Math.sqrt(L2); }
        acc2 += Math.sqrt(L2);
      }
      c.d = bestD;
    }
    cuts.sort((a, b) => a.d - b.d);
    const pieces = [];
    let cur = [r.pts[0]], acc = 0, ci = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const segL = Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      while (ci < cuts.length && cuts[ci].d <= acc + segL + 1e-6) {
        const c = cuts[ci++];
        cur.push([c.x, c.z]);
        if (polylineLength(cur) > 2) pieces.push(cur);
        cur = [[c.x, c.z]];
      }
      cur.push(r.pts[i]);
      acc += segL;
    }
    if (polylineLength(cur) > 2) pieces.push(cur);
    if (pieces.length < 2) continue;
    // a ramp (end levels differ) keeps ONE climb: each piece takes the levels at its own ends along the parent. Copying
    // the parent's lA / lB to every piece made a sawtooth, each piece climbing the whole lift again (the St. George ferry
    // terminal's ramp, CSCL 194030, level 17 to 13 over 150 m, split twice: 10.3 m -> 3.5 m three times over)
    const lA0 = r.lA ?? r.level ?? 0, lB0 = r.lB ?? r.level ?? 0, Ltot = polylineLength(r.pts);
    const isRamp = Math.abs(lA0 - lB0) > 1e-6 && Ltot > 0;
    let s0 = 0;
    const lvAt = (d) => lA0 + (lB0 - lA0) * Math.min(1, d / Ltot);
    const lv = pieces.map((pc) => { const L = polylineLength(pc), o = isRamp ? { lA: lvAt(s0), lB: lvAt(s0 + L) } : {}; s0 += L; return o; });
    if (isRamp) rampSplits++;
    r.pts = pieces[0];
    Object.assign(r, lv[0]);
    for (let k = 1; k < pieces.length; k++) roads.push({ ...r, pts: pieces[k], ...lv[k] });
  }
  log(' T-junctions split:', tees, 'roads now:', roads.length, '| ramps split with their climb shared:', rampSplits);
}

// ---------------------------------------------------------------- terrain samples & grid per tile
log('terrain');
const terrSamples = [];
for (const b of buildings) terrSamples.push([b.cx, b.cz, b.base]);
// parks have no buildings, so without this the grid is pure extrapolation there
// (Morningside/Riverside rendered as walls and terraces): USGS 3DEP samples on a
// ~14 m grid over every park polygon + margin, fetched by tools/pipeline/fetch_elev.mjs
for (const b of FLAT ? [] : BOROS) {
  const pf = path.join(RAW, `park_elev_${b}.json`);
  if (!fs.existsSync(pf)) continue;
  const arr = JSON.parse(fs.readFileSync(pf, 'utf8'));
  // terrarium nodata decodes to ~-32768; Manhattan tops out near 80 m
  let kept = 0;
  for (const [x, z, y] of arr) if (Number.isFinite(y) && y > -3 && y < 120) { const smp = [x, z, y]; smp.park = true; terrSamples.push(smp); kept++; }
  log('park elevation samples:', kept, 'of', arr.length, 'boro', b);
}
// road endpoint samples where they carry no elevation: skip — buildings dense enough.
// figure world tile range from data
let WX0 = 1e12, WZ0 = 1e12, WX1 = -1e12, WZ1 = -1e12;
for (const [x, z] of LANDING_PTS) { WX0 = Math.min(WX0, x); WX1 = Math.max(WX1, x); WZ0 = Math.min(WZ0, z); WZ1 = Math.max(WZ1, z); }   // NJ39: the bridges' New Jersey ends
for (const b of buildings) { WX0 = Math.min(WX0, b.cx); WX1 = Math.max(WX1, b.cx); WZ0 = Math.min(WZ0, b.cz); WZ1 = Math.max(WZ1, b.cz); }
for (const r of roads) for (const p of r.pts) { WX0 = Math.min(WX0, p[0]); WX1 = Math.max(WX1, p[0]); WZ0 = Math.min(WZ0, p[1]); WZ1 = Math.max(WZ1, p[1]); }
// the New Jersey landing patches: the Outerbridge Crossing's lands at x -25,588, past the city's own buildings and roads
// (x -24,576), and got no tile and no ground
for (const L of LAND) if (L.landing) { WX0 = Math.min(WX0, L.bbox[0]); WX1 = Math.max(WX1, L.bbox[2]); WZ0 = Math.min(WZ0, L.bbox[1]); WZ1 = Math.max(WZ1, L.bbox[3]); }
const TX0 = Math.floor(WX0 / TILE) - 1, TX1 = Math.floor(WX1 / TILE) + 1;
const TZ0 = Math.floor(WZ0 / TILE) - 1, TZ1 = Math.floor(WZ1 / TILE) + 1;
log('tile range', TX0, TZ0, '..', TX1, TZ1);

const RES = 32;
// Columbia superblock tiles get a 4m grid: the campus is architectural — its
// level changes are cliffs, and a 16m heightfield renders every cliff as a
// ~16m fold that no wall can hide. 4m folds tuck under walls and green banks.
// terrain grid resolution per tile: the Columbia superblock stays at 128; tiles
// whose park elevation samples span more than 12 m (Morningside, Riverside,
// Fort Tryon, Inwood cliffs) get 64 (8 m cells) instead of the 16 m default
const steepTiles = new Set();
{
  const relief = new Map();
  for (const s of terrSamples) {
    if (!s.park) continue;
    const k = Math.floor(s[0] / TILE) + '_' + Math.floor(s[1] / TILE);
    const r = relief.get(k) || [1e9, -1e9];
    r[0] = Math.min(r[0], s[2]); r[1] = Math.max(r[1], s[2]);
    relief.set(k, r);
  }
  for (const [k, r] of relief) if (r[1] - r[0] > 12) steepTiles.add(k);
  log('steep park tiles (64-res terrain):', steepTiles.size);
}
// PIER TILES: land narrower than the 16 m grid (piers, ferry slips) was water in the drawn terrain, its bulkhead walls
// floating as planks either side of nothing (St. George's slips). A tile whose 4 m land raster holds 400 m2 or more of
// land in 16 m cells whose four grid nodes are all water draws its terrain on a 4 m grid instead (as the Columbia tiles
// do), so a pier of 8 m and more is ground. The raster: per 4 m row, the parity at the tile's west edge (onLand) toggled
// at each crossing of the shore segments indexed round the tile.
const pierTiles = new Set();
const pierLand = new Map();   // pier tile -> its 4 m land raster (128 x 128, row-major from the tile's north-west corner)
{
  const cand = new Set();
  for (const k of SHORE.keys()) {
    const [i, j] = k.split('_').map(Number);
    const tx = Math.floor((i * SHORE_CELL) / TILE), tz = Math.floor((j * SHORE_CELL) / TILE);
    if (tx >= TX0 && tx <= TX1 && tz >= TZ0 && tz <= TZ1) cand.add(tx + '_' + tz);
  }
  const N = 128, C = TILE / N;
  for (const key of cand) {
    const [tx, tz] = key.split('_').map(Number), x0 = tx * TILE, z0 = tz * TILE;
    const segs = new Map();
    const c0 = Math.floor(x0 / SHORE_CELL) - 1, c1 = Math.floor((x0 + TILE) / SHORE_CELL) + 1;
    const r0 = Math.floor(z0 / SHORE_CELL) - 1, r1 = Math.floor((z0 + TILE) / SHORE_CELL) + 1;
    for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
      const a = SHORE.get(`${i}_${j}`); if (!a) continue;
      for (let k = 0; k < a.length; k += 4) segs.set(`${a[k]},${a[k + 1]},${a[k + 2]},${a[k + 3]}`, [a[k], a[k + 1], a[k + 2], a[k + 3]]);
    }
    const E = [...segs.values()];
    const land = new Uint8Array(N * N);
    for (let r = 0; r < N; r++) {
      const z = z0 + (r + 0.5) * C;
      let inside = onLand(x0 + 1e-3, z);
      const xs = [];
      for (const [ax, az, bx, bz] of E) if ((az > z) !== (bz > z)) { const x = ax + ((z - az) * (bx - ax)) / (bz - az); if (x > x0 && x < x0 + TILE) xs.push(x); }
      xs.sort((a, b) => a - b);
      let xi = 0;
      for (let c = 0; c < N; c++) {
        const x = x0 + (c + 0.5) * C;
        while (xi < xs.length && xs[xi] < x) { inside = !inside; xi++; }
        land[r * N + c] = inside ? 1 : 0;
      }
    }
    // 16 m cells (4 x 4 raster cells) whose corner nodes are all water but hold land
    const node = (i, j) => land[Math.min(N - 1, j * 4) * N + Math.min(N - 1, i * 4)];
    let missed = 0;
    for (let j = 0; j < 32; j++) for (let i = 0; i < 32; i++) {
      if (node(i, j) || node(i + 1, j) || node(i, j + 1) || node(i + 1, j + 1)) continue;
      for (let v = 0; v < 4; v++) for (let u = 0; u < 4; u++) missed += land[(j * 4 + v) * N + i * 4 + u];
    }
    if (missed >= 25) { pierTiles.add(key); pierLand.set(key, land); }
  }
  log('pier tiles (4 m terrain for land the 16 m grid misses):', pierTiles.size, 'of', cand.size, 'shore tiles');
}
const resOf = (tx, tz) => (tx >= 0 && tx <= 2 && tz >= -7 && tz <= -4) ? 128 : pierTiles.has(tx + '_' + tz) ? 128 : (!FLAT && steepTiles.has(tx + '_' + tz)) ? 64 : RES;
const rawGrids = new Map();     // IDW+water only — used to assign road elevations
const terrainGrids = new Map(); // carved (roads flattened in) — written to tiles, used everywhere else
function buildTerrainRaw(tx, tz) {
  const key = `${tx}_${tz}`;
  if (rawGrids.has(key)) return rawGrids.get(key);
  const R = resOf(tx, tz);
  const x0 = tx * TILE, z0 = tz * TILE;
  const local = [];
  for (const s of terrSamples) {
    if (s[0] > x0 - 300 && s[0] < x0 + TILE + 300 && s[1] > z0 - 300 && s[1] < z0 + TILE + 300) local.push(s);
  }
  let g;
  if (FLAT) { g = new Float32Array((R + 1) ** 2).fill(BASE_Y); }
  else if (local.length === 0) { g = new Float32Array((R + 1) ** 2).fill(-3.5); }
  if (FLAT || local.length > 0) {
    if (!FLAT) g = idwGrid(local, x0, z0, TILE, R);
    for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
      const px = x0 + (i / R) * TILE, pz = z0 + (j / R) * TILE;
      // water nodes adjacent to land drop to -9 so the land->water crossing
      // triangle breaks the surface within ~1.6m of the land node — always
      // BEHIND the seawall face (+3.4m off the ring). At -3.5 the crossing
      // surfaced meters out and read as pale "ice floe" sheets on the water.
      // Corridor-claimed nodes still get set to the roadbed by carveAt, so
      // waterfront road support is unaffected; open water stays -3.5.
      // on a pier tile, land thinner than ~5 m round a node (a fender rack, a breakwater line: the land raster holds at
      // most three of the nine 4 m cells about it) is water: such nodes stood as lone pyramids of ground in the slip
      const pl = FLAT && R === 128 ? pierLand.get(key) : null;
      let sliver = false;
      if (pl && !SA37) { let c = 0; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = Math.min(127, Math.max(0, i + di)), jj = Math.min(127, Math.max(0, j + dj)); c += pl[jj * 128 + ii]; } sliver = c <= 3; }
      else if (pl) {
        // SA37: the window is the 4 x 4 cells round the node (the 3 x 3 above sits east and south of it, and drew nodes
        // within ~2 m of an east- or south-facing shore as water); the node is ground where a 2 x 2 block of land cells
        // (8 m square) lies in that window
        const at = (ii, jj) => pl[Math.min(127, Math.max(0, jj)) * 128 + Math.min(127, Math.max(0, ii))];
        sliver = true;
        for (let bj = j - 2; bj <= j && sliver; bj++) for (let bi = i - 2; bi <= i; bi++)
          if (at(bi, bj) && at(bi + 1, bj) && at(bi, bj + 1) && at(bi + 1, bj + 1)) { sliver = false; break; }
      }
      if ((!onLand(px, pz) || sliver) && !(FLAT && inFootprint(px, pz))) g[j * (R + 1) + i] = shoreDist(px, pz, 28) < 27 ? -9 : -3.5;
      else if (FLAT) { const pY = PADS.length ? landingPadAt(px, pz) : null; if (pY !== null) g[j * (R + 1) + i] = pY; /* else the flat base plane */ }
      else {
        let h = Math.max(1.2, g[j * (R + 1) + i]);
        // esplanade grading: coastal land may not out-climb a 16% grade from
        // the waterline — kills the IDW beach-bluff ramps sliding into rivers
        // while leaving genuinely high ground beyond 64m untouched. Nodes
        // within one cell of the ring pin to 1.0 so the land->water crossing
        // triangle breaks the surface right at the seawall, not meters out
        // (shoreDist is position-deterministic: no cracks at tile seams).
        if (h > 1.0) {
          // pin radius must cover the CELL DIAGONAL (1.42 cells): a land node
          // whose water neighbor sits across the diagonal otherwise keeps its
          // graded height and the diagonal crossing surfaces meters offshore
          // as an angular terrain shard the seawall cannot hide
          const pinR = (TILE / R) * 1.5;
          const dW = shoreDist(px, pz, 92);
          if (dW < pinR) h = Math.min(h, 1.0);
          else if (dW < 92) {
            // flat esplanade band (<=2.5m out to 45m) then a SMOOTH release
            // to raw terrain by 92m: real waterfronts run a low promenade
            // strip before the land climbs. A hard linear cap terraced
            // Riverside Park and coned buildings at its 64m boundary.
            const t = Math.max(0, (dW - 45) / 47);
            h = Math.min(h, 2.5 + t * t * (3 - 2 * t) * 90);
          }
        }
        g[j * (R + 1) + i] = h;
      }
    }
  }
  rawGrids.set(key, g);
  return g;
}
function sampleGrid(g, tx, tz, x, z) {
  const R = resOf(tx, tz);
  const fx = ((x - tx * TILE) / TILE) * R, fz = ((z - tz * TILE) / TILE) * R;
  const i = Math.min(R - 1, Math.max(0, Math.floor(fx))), j = Math.min(R - 1, Math.max(0, Math.floor(fz)));
  const u = Math.min(1, Math.max(0, fx - i)), v = Math.min(1, Math.max(0, fz - j)), n = R + 1;
  // triangle-lerp on the SAME diagonal split the renderer triangulates
  // ((i,j)->(i+1,j+1)); bilinear deviates from the drawn saddle by enough to
  // sink overlays through terrain on curved cells
  const y00 = g[j * n + i], y10 = g[j * n + i + 1], y01 = g[(j + 1) * n + i], y11 = g[(j + 1) * n + i + 1];
  return u >= v
    ? y00 + u * (y10 - y00) + v * (y11 - y10)
    : y00 + v * (y01 - y00) + u * (y11 - y01);
}
function sampleTerrainRaw(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  return sampleGrid(buildTerrainRaw(tx, tz), tx, tz, x, z);
}
// road corridors (filled after roads get elevations) — carve terrain to meet the roadbed
const corridorIdx = new Map();
const CORR_CELL = 32;
function corridorAdd(x1, z1, y1, x2, z2, y2, halfW) {
  const seg = { x1, z1, y1, x2, z2, y2, halfW };
  const minX = Math.min(x1, x2) - halfW - 8, maxX = Math.max(x1, x2) + halfW + 8;
  const minZ = Math.min(z1, z2) - halfW - 8, maxZ = Math.max(z1, z2) + halfW + 8;
  for (let cz = Math.floor(minZ / CORR_CELL); cz <= Math.floor(maxZ / CORR_CELL); cz++)
    for (let cx = Math.floor(minX / CORR_CELL); cx <= Math.floor(maxX / CORR_CELL); cx++) {
      const k = cx + '_' + cz;
      let a = corridorIdx.get(k);
      if (!a) corridorIdx.set(k, (a = []));
      a.push(seg);
    }
}
function carveAt(px, pz, raw, cell = 16) {
  if (FLAT) return raw; // flat base plane: roads sit on it, nothing to carve
  // returns carved height at point given raw height.
  // THE ANTI-CLIP INVARIANT: the drawn surface interpolates between grid nodes
  // up to one full cell apart, so every node whose cell TOUCHES a ribbon must
  // sit at or below that roadbed. The old code (a) blended only over 10m, so a
  // just-outside node kept its raw hillside height and the interpolated surface
  // rose straight through the road, and (b) honored only the NEAREST corridor,
  // so at junctions of roads at different heights terrain was carved to the
  // higher one and clipped the lower. Now every overlapping corridor caps the
  // height (min), and the cap only ever pulls DOWN, so downhill sides keep
  // their natural fall.
  let best = null, bestD = 1e9, cap = 1e9;
  const cx = Math.floor(px / CORR_CELL), cz = Math.floor(pz / CORR_CELL);
  const a = corridorIdx.get(cx + '_' + cz);
  if (a) for (const s of a) {
    const dx = s.x2 - s.x1, dz = s.z2 - s.z1;
    const L2 = dx * dx + dz * dz || 1e-9;
    let t = ((px - s.x1) * dx + (pz - s.z1) * dz) / L2;
    t = Math.max(0, Math.min(1, t));
    const qx = s.x1 + dx * t, qz = s.z1 + dz * t;
    const d = Math.hypot(px - qx, pz - qz) - s.halfW;
    if (d < bestD) { bestD = d; best = { y: s.y1 + (s.y2 - s.y1) * t, d }; }
    const tg = s.y1 + (s.y2 - s.y1) * t - 0.12;
    if (d <= 0) cap = Math.min(cap, tg);
    else if (d <= cell) cap = Math.min(cap, tg + d * 0.015);
    else if (d <= cell + 9) cap = Math.min(cap, tg + cell * 0.015 + (d - cell) * 0.14);
  }
  if (!best) return raw;
  const target = best.y - 0.12;
  if (best.d <= 0) return Math.min(target, cap); // flat under roadbed
  let h = raw;
  if (best.d < 10) { const f = best.d / 10; const sm = f * f * (3 - 2 * f); h = target * (1 - sm) + raw * sm; }
  return Math.min(h, cap);
}
// Columbia campus terrace pads (McKim split-level plan): crisp flat levels the
// smoothed elevation data loses. Applied AFTER road carving so pads win inside
// campus; the deliberate gap between the apron and the Low terrace becomes a
// 2.4m ramp that the runtime grand-steps geometry (src/city/campus.js) dresses.
// Axis derived from the OSM "Low Library Steps" ways; Alma Mater at (764.2,-2747.8).
const PAD_AX = 0.465, PAD_AZ = -0.885; // campus "north" (toward Low) unit vector
const CAMPUS_ALMA = [764.23, -2747.81];
// The real campus is a series of FLAT terraces (McKim section); the elevation
// data is lumpy noise from interpolated building ground heights (it even puts
// a fake +4m crest mid-College-Walk). Pads are defined in campus-axis coords
// relative to Alma Mater: a = along-axis toward Low, |c| = across.
// Section: South Field 39.7 -> College Walk 40.2 -> Low Plaza 41.4 ->
// grand staircase -> Low terrace 47.6 -> north campus 46.9.
// FULL heightmap override inside the superblock: every point sits on exactly
// one flat pad (first match wins — inner pads listed before their flanking
// fills), so both campus "floors" read dead flat as built.
// v19: the override is confined to the MEASURED Morningside superblock and is
// total inside it. Pads TILE the block with HARD edges (first containing pad
// wins) — every inner boundary is a designed step whose fold lands under a
// wall, a stair run, or a green bank. A single perimeter fade (CAMPUS_PERIM)
// eases campus levels into the street-carved grade just inside the property
// line; the avenues and cross streets themselves are NEVER touched.
// `y1` ramps along a; `rampC` ramps across |c| (c0->c1).
// v25 TWO-PLANE MODEL (user directive): the ENTIRE upper campus is ONE flat
// plateau at 46.9 — the old intermediate terraces (44.3/45.6/46.82/47.6) are
// merged. A flat grid interpolates exactly, so the heightmap can't wiggle
// anywhere except at the high/low boundary — and every boundary line is encased
// in authored geometry (walls as faces + flat cap strips w/ colliders +
// stair flights, src/city/campus.js), so the interpolation zone is never seen.
// A 5.5m story on a 4m grid interpolates over a FULL CELL each side of the
// seam — terrain would overtop any wall placed on it. So every plateau seam is
// pulled ~4.7m BEHIND its retaining wall: the low side stays exactly flat up
// to the wall base, and the whole interpolation cone lives in a hidden trench
// behind the wall, decked by a wide walkable cap slab (campus.js) at 46.9.
const CAMPUS_PADS = [
  // side stairs ON THE FOUNTAIN LINE (OSM ways): ramp under the flight, then a
  // 46.9 head shelf out to the seam at |c|=58.6 (capped)
  // ramps sit 0.25 BELOW their flights so treads always clear the terrain
  { a0: -23.7, a1: -17.2, halfB: 58.6, bMin: 40.2, y: 41.15, y1: 46.65, rampC: true, c0: 40.5, c1: 53.9 },
  { a0: -6.2, a1: 11, halfB: 29.5, y: 41.15, y1: 46.65 },                      // grand cascade ramp under the single flight
  { a0: -40.4, a1: -19, halfB: 92, bMin: 58.4, y: 46.9 },                      // Kent/Dodge flank plateau (seam inside the buildings' footprints)
  { a0: -19, a1: 21, halfB: 400, bMin: 58.4, y: 46.9 },                        // flank upper lawns + NE/NW wedges to the property lines
  { a0: -48, a1: -1.5, halfB: 58.4, y: 41.4 },                                 // court + boundary trenches behind the walls (decked by cap slabs)
  { a0: -1.5, a1: 92, halfB: 400, y: 46.9 },                                   // upper-campus core (seam 4.7m behind the parterre-north wall, under its cap)
  { a0: -48, a1: -40.4, halfB: 400, bMin: 54, y: 40.2 },                       // frontage south of Kent/Dodge
  { a0: -40.4, a1: -19, halfB: 400, bMin: 92, y: 40.2 },                       // frontage east of Kent / west of Dodge
  { a0: 92, a1: 400, halfB: 400, y: 46.9 },                                    // north campus
].map((p) => ({
  cx: CAMPUS_ALMA[0] + PAD_AX * (p.a0 + p.a1) / 2,
  cz: CAMPUS_ALMA[1] + PAD_AZ * (p.a0 + p.a1) / 2,
  halfA: (p.a1 - p.a0) / 2, halfB: p.halfB, bMin: p.bMin || 0,
  y: p.y, y1: p.y1, rampC: !!p.rampC, c0: p.c0, c1: p.c1,
}));
// Morningside superblock property lines in campus-axis coords, fit from CSCL
// centerlines (streets run ~1.2 deg skew to the McKim axis) minus roadbed
// half-width and sidewalk: Broadway 40ft, Amsterdam/116th/120th 60ft, 114th 30ft.
const CAMPUS_RECT = {
  // west bound pulled EAST of the Broadway frontage halls: the plateau ends
  // BEHIND Furnald/Lewisohn/etc instead of ramping 11m down to the avenue in
  // open grass — Broadway keeps its natural street grade (user: the banks
  // "look horrible"). Buildings bridge the seam with their own foundations.
  cW: (a) => -96.0 + 0.0208 * a,
  cE: (a) => 119.0 + 0.0205 * a,   // Amsterdam west property line
  aS: (c) => -209.0 - 0.0227 * c,  // W 114th north property line
  aN: (c) => 252.0 - 0.0210 * c,   // W 120th south property line
};
const CAMPUS_PERIM = 20; // fade width inside the property line
// College Walk & everything south of it belong to the CITY-GRID frame, which
// sits ~1.34 deg skew to the McKim axis. aSh = a + SHEAR*c is constant along
// the OSM walk centerline (aSh = -52.55), so the walk band and the South Field
// seam run exactly street-parallel — the walk ribbon's edges (±8.25m) land ON
// the terrain steps instead of the steps slicing diagonally through the brick.
// The campus north of the walk stays axis-aligned (McKim geometry really is).
const CAMPUS_SHEAR = 0.0234;
// Band edges sit ~3m OFF the 16.5m walk ribbon (edges at -44.3/-60.8): the 4m
// terrain grid spreads each step into a ramp that can reach a full diagonal
// cell (~2.9m) past the seam, so the seams are pushed clear of the brick — the
// south ramp rolls in the grass verge, the north ramp hides behind the plaza
// rim wall + hedge band + flight-head landing slab (campus.js).
const WALK_N = -41.0, WALK_S = -63.3; // walk band edges in sheared coords
function padAt(px, pz, cur) {
  const dx = px - CAMPUS_ALMA[0], dz = pz - CAMPUS_ALMA[1];
  const aW = dx * PAD_AX + dz * PAD_AZ;
  const cW = dx * -PAD_AZ + dz * PAD_AX;
  const dIn = Math.min(aW - CAMPUS_RECT.aS(cW), CAMPUS_RECT.aN(cW) - aW,
    cW - CAMPUS_RECT.cW(aW), CAMPUS_RECT.cE(aW) - cW);
  if (dIn <= 0) return cur; // outside the superblock: streets & raw grade untouched
  const aSh = aW + CAMPUS_SHEAR * cW;
  let lvl;
  if (aSh < WALK_S) lvl = 39.7;      // South Field / Butler level (street frame)
  else if (aSh < WALK_N) lvl = 40.2; // College Walk band, gate to gate (street frame)
  else for (const p of CAMPUS_PADS) {
    const aS = aW - (p.cx - CAMPUS_ALMA[0]) * PAD_AX - (p.cz - CAMPUS_ALMA[1]) * PAD_AZ;
    const b = Math.abs(cW);
    if (b < p.bMin) continue;
    if (Math.abs(aS) > p.halfA || b > p.halfB) continue;
    lvl = p.y;
    if (p.y1 !== undefined) {
      const t = p.rampC
        ? Math.min(1, Math.max(0, (b - p.c0) / (p.c1 - p.c0)))
        : Math.min(1, Math.max(0, (aS + p.halfA) / (2 * p.halfA)));
      lvl = p.y + (p.y1 - p.y) * t;
    }
    break;
  }
  if (lvl === undefined) return cur;
  lvl += CAMPUS_SHIFT;
  if (dIn >= CAMPUS_PERIM) return lvl;
  const f = dIn / CAMPUS_PERIM, sm = f * f * (3 - 2 * f);
  return cur + (lvl - cur) * sm;
}
function buildTerrain(tx, tz) {
  const key = `${tx}_${tz}`;
  if (terrainGrids.has(key)) return terrainGrids.get(key);
  const raw = buildTerrainRaw(tx, tz);
  const g = new Float32Array(raw);
  const R = resOf(tx, tz);
  const x0 = tx * TILE, z0 = tz * TILE;
  for (let j = 0; j <= R; j++) for (let i = 0; i <= R; i++) {
    const idx = j * (R + 1) + i;
    const px = x0 + (i / R) * TILE, pz = z0 + (j / R) * TILE;
    const carved = carveAt(px, pz, g[idx], TILE / R);
    // keep open water at water level, but nodes a road corridor claims must
    // still carve: waterfront roads bilinear-sampled a skipped -3.5 water node
    // and dove below the surrounding terrain (FDR at roadY -0.04)
    if (g[idx] < -3 && carved === g[idx]) continue;
    g[idx] = padAt(px, pz, carved);
  }
  terrainGrids.set(key, g);
  return g;
}
function sampleTerrain(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  return sampleGrid(buildTerrain(tx, tz), tx, tz, x, z);
}
// Overlay drape datum: park lawns, pavement contours and corner bands must
// never follow the terrain grid down its -3.5 water dive — a park polygon that
// overhangs the LAND edge otherwise emits huge pale wedges sliding into the
// river. Off-land verts pin to a fixed deck grade just above the waterline
// (reads as esplanade decking behind the compiled seawall). The onLand test is
// only paid when the sample is already in the dive zone; carved trenches on
// land (tunnel approaches at -8) pass the onLand check and keep their depth.
const TOE_Y = 0.45;   // fallback grade if a vert is somehow beyond the shore index
function shoreNearest(x, z, max) {
  const c = shoreClosest(x, z, max);
  return c ? [c[1], c[2]] : null;
}
// Overlay drape vertex: on land it follows carved terrain, off land it is
// PULLED BACK to the nearest shoreline point — lawns and pavement end flush
// at the compiled seawall instead of overhanging or diving into the water.
// Fully-off-land geometry (OSM piers) collapses to slivers on the wall line;
// proper pier structures are future work. Deterministic per (x,z) so shared
// triangle edges stay welded. The onLand test only runs for samples already
// in the water-dive zone; carved on-land trenches keep their depth.
function drapeVert(x, z, lift) {
  const y = sampleTerrain(x, z);
  if (y > -0.4 || onLand(x, z)) return [x, y + lift, z];
  const s = shoreNearest(x, z, 220);
  // element [3] marks a pulled vert: triangles with ALL verts pulled must be
  // dropped by emitters — across a bay notch the three verts pull to
  // DIFFERENT ring points and the triangle chords over open water
  if (!s) return [x, TOE_Y + lift, z, 1];
  return [s[0], Math.max(1.0, sampleTerrain(s[0], s[1])) + lift, s[1], 1];
}
const allPulled = (A, B, C) => A[3] === 1 && B[3] === 1 && C[3] === 1;
// Chord guard: a triangle with SOME pulled verts can still span open water
// (river-straddling landuse polygon: one far on-land vert + two verts pulled
// to this bank chords a tilted slab across the channel). Any overlay triangle
// with an XZ edge beyond 90m is pathological — subdivision targets 24m leaves.
const triTooBig = (A, B, C) => {
  const e2 = (P, Q) => (P[0] - Q[0]) ** 2 + (P[2] - Q[2]) ** 2;
  return e2(A, B) > 8100 || e2(B, C) > 8100 || e2(C, A) > 8100;
};
function groundYOnLand(x, z, lift) { // Y-only variant (fixed-xz ribbon datums)
  const y = sampleTerrain(x, z);
  return (y > -0.4 || onLand(x, z)) ? y + lift : TOE_Y + lift;
}

// register road corridors so terrain conforms to roadbeds. Elevations come from
// SMOOTHED per-road longitudinal profiles, not raw IDW samples: raw terrain
// oscillates several meters over tens of meters near shoreline cliffs and
// stacked infrastructure (FDR Drive under the Carl Schurz esplanade sampled
// y=[0,-0.6,3.5,7.9,1.5]), and since roadY() follows the carved terrain the
// roads themselves rollercoastered and clipped through the heightmap.
// Profile pipeline: sample raw every ~10m -> median filter (kills single-sample
// cliff spikes) -> iterated Laplacian grade clamp (bounded deviation from the
// local chord, so profiles keep their trend but lose the bumps) -> endpoint
// consensus (roads meeting at the same point agree on one elevation, the
// adjustment lerped along the profile so junctions stay continuous).
log('road corridors');
{
  const profs = []; // {r, xs, zs, ys, halfW, lifted}
  for (const r of roads) {
    if (r.rclass === 6 || r.noGeom) continue;
    // bridge pieces and ramps still get corridors where their deck is near
    // grade (lift gate below) — excluding them wholesale left FDR-style
    // at-grade "bridge bits" following raw cliffside terrain (roadY -0.04
    // beside a +3m heightmap: guaranteed clip)
    const lifted = (r.lA ?? r.level ?? 0) > 0 || (r.lB ?? r.level ?? 0) > 0 || r.isBridgePiece || r.cut;
    const sw = r.rclass === 2 ? 4.6 : r.rclass === 5 ? 0.8 : 3.6;
    const halfW = r.width / 2 + sw + 0.6;
    const L = polylineLength(r.pts);
    const n = Math.max(2, Math.ceil(L / 10) + 1);
    const xs = [], zs = [], ys = [], ds = [];
    for (let i = 0; i < n; i++) {
      const d = (i / (n - 1)) * L;
      const [x, z] = alongPolyline(r.pts, d);
      xs.push(x); zs.push(z); ds.push(d);
      ys.push(Math.max(1.3, sampleTerrainRaw(x, z)));
    }
    // median filter, window 5
    const med = ys.slice();
    for (let i = 0; i < n; i++) {
      const w = [];
      for (let k = Math.max(0, i - 2); k <= Math.min(n - 1, i + 2); k++) w.push(ys[k]);
      w.sort((a, b) => a - b);
      med[i] = w[w.length >> 1];
    }
    // Laplacian clamp: each interior sample stays within maxDev of its
    // neighbors' midpoint (5% grade over the half-window)
    for (let pass = 0; pass < 16; pass++) {
      for (let i = 1; i < n - 1; i++) {
        const mid = (med[i - 1] + med[i + 1]) / 2;
        const dev = Math.max(0.35, 0.05 * (ds[i + 1] - ds[i - 1]) / 2);
        med[i] = Math.max(mid - dev, Math.min(mid + dev, med[i]));
      }
    }
    profs.push({ r, xs, zs, ys: med, halfW, lifted });
  }
  // endpoint consensus: quantize endpoints, take the median height per point
  const ends = new Map();
  const ekey = (x, z) => `${Math.round(x * 2)}_${Math.round(z * 2)}`;
  for (const p of profs) {
    if (p.lifted) continue; // ramps keep their own grade-end elevations
    const n = p.ys.length;
    for (const [i, k] of [[0, ekey(p.xs[0], p.zs[0])], [n - 1, ekey(p.xs[n - 1], p.zs[n - 1])]]) {
      let a = ends.get(k); if (!a) ends.set(k, (a = []));
      a.push(p.ys[i]);
    }
  }
  const cons = new Map();
  for (const [k, a] of ends) { a.sort((x, y) => x - y); cons.set(k, a[a.length >> 1]); }
  let nSeg = 0;
  for (const p of profs) {
    const n = p.ys.length;
    if (!p.lifted) {
      const c0 = cons.get(ekey(p.xs[0], p.zs[0])), c1 = cons.get(ekey(p.xs[n - 1], p.zs[n - 1]));
      const d0 = c0 !== undefined ? c0 - p.ys[0] : 0, d1 = c1 !== undefined ? c1 - p.ys[n - 1] : 0;
      for (let i = 0; i < n; i++) { const t = i / (n - 1); p.ys[i] += d0 * (1 - t) + d1 * t; }
    }
    // the road keeps its own profile: roadY() interpolates this instead of
    // re-sampling the carved heightmap, because the heightmap takes the MIN of
    // every overlapping corridor — a highway crossing above a greenway would
    // otherwise dive to the greenway's grade where their ribbons overlap in 2D
    p.r.prof = { L: polylineLength(p.r.pts), ys: p.ys };
    for (let i = 1; i < n; i++) {
      if (p.lifted) {
        // ramps: carve only where the deck is still near grade (approach mouth)
        const lift = (t) => ((p.r.lA ?? p.r.level) + ((p.r.lB ?? p.r.level) - (p.r.lA ?? p.r.level)) * t) * 7;
        if (lift((i - 1) / (n - 1)) > 0.35 && lift(i / (n - 1)) > 0.35) continue;
      }
      corridorAdd(p.xs[i - 1], p.zs[i - 1], p.ys[i - 1], p.xs[i], p.zs[i], p.ys[i], p.halfW);
      nSeg++;
    }
  }
  log('corridor segments:', nSeg);
}

// ---------------------------------------------------------------- road spatial index (for building frontage)
const roadIdx = new Map(); // cell -> [{road, segIdx}]
const RCELL = 24;
function roadCells(x, z) { return `${Math.floor(x / RCELL)}_${Math.floor(z / RCELL)}`; }
for (const r of roads) {
  if (r.rclass === 5 || r.rclass === 6) continue;
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
    const steps = Math.ceil(Math.hypot(x2 - x1, z2 - z1) / RCELL) + 1;
    const added = new Set();
    for (let s = 0; s <= steps; s++) {
      const k = roadCells(x1 + ((x2 - x1) * s) / steps, z1 + ((z2 - z1) * s) / steps);
      if (added.has(k)) continue;
      added.add(k);
      let arr = roadIdx.get(k); if (!arr) roadIdx.set(k, (arr = []));
      arr.push({ r, i });
    }
  }
}
function nearestRoad(x, z, maxD = 30) {
  let best = null, bestD = maxD;
  const ci = Math.floor(x / RCELL), cj = Math.floor(z / RCELL);
  for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
    const arr = roadIdx.get(`${ci + di}_${cj + dj}`);
    if (!arr) continue;
    for (const { r, i } of arr) {
      const [x1, z1] = r.pts[i], [x2, z2] = r.pts[i + 1];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - x1) * dx + (z - z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = x1 + dx * t, pz = z1 + dz * t;
      const d = Math.hypot(x - px, z - pz) - r.width / 2;
      if (d < bestD) { bestD = d; best = { r, d, px, pz, dirx: dx / Math.sqrt(L2), dirz: dz / Math.sqrt(L2) }; }
    }
  }
  return best;
}

// ---------------------------------------------------------------- classify buildings
// ---------------------------------------------------------------- divided avenues
// CSCL models Lenox / ACP / Frederick Douglass / Park / Allen ... as two one-way
// same-name carriageways (rclass 1, ~9 m each). Everything that keys on
// "avenue" — storefront classification (onAvenue), the pavement field's median
// fill — must see them as the avenue they are. r.divided = sign of the twin's
// lateral offset in this road's (-dz, dx) frame (+1 = the +n side).
{
  const cellD = 24, dg = new Map();
  const cands = roads.filter((r) => r.level === 0 && !r.noGeom && r.rclass <= 2 && r.oneway !== 0 && r.name && polylineLength(r.pts) > 12);
  for (const r of cands) {
    const L = polylineLength(r.pts);
    for (let d = 3; d < L - 3; d += 8) {
      const [x, z, dx, dz] = alongPolyline(r.pts, d);
      const k = `${Math.floor(x / cellD)}_${Math.floor(z / cellD)}`;
      let a = dg.get(k); if (!a) dg.set(k, (a = []));
      a.push({ r, x, z, dx, dz });
    }
  }
  let nDiv = 0;
  for (const r of cands) {
    const L = polylineLength(r.pts);
    let votes = 0, nv = 0, twin = null, gapSum = 0, gapN = 0;
    for (const f of [0.3, 0.5, 0.7]) {
      const [x, z, dx, dz] = alongPolyline(r.pts, L * f);
      const gx = Math.floor(x / cellD), gz = Math.floor(z / cellD);
      let found = 0;
      for (let dz2 = -1; dz2 <= 1 && !found; dz2++) for (let dx2 = -1; dx2 <= 1 && !found; dx2++) {
        const a = dg.get(`${gx + dx2}_${gz + dz2}`); if (!a) continue;
        for (const s of a) {
          if (s.r === r || s.r.name !== r.name || s.r.oneway === r.oneway) continue;
          if (Math.abs(s.dx * dx + s.dz * dz) < 0.9) continue;          // parallel
          const ox = s.x - x, oz = s.z - z;
          if (Math.abs(ox * dx + oz * dz) > 8) continue;                 // abreast
          const lat = ox * -dz + oz * dx;
          const gap = Math.abs(lat) - r.width / 2 - s.r.width / 2;
          if (gap < -6 || gap > 14) continue;                             // a median, not a far parallel; twins may overlap where they converge on a single node
          found = Math.sign(lat) || 1; twin = s.r; gapSum += gap; gapN++; break;
        }
      }
      if (found) { votes += found; nv++; }
    }
    if (nv >= 2) { r.divided = votes > 0 ? 1 : -1; r.twin = twin; r.medGap = gapSum / gapN; nDiv++; }
  }
  log('divided carriageways:', nDiv);
}

// FLAT base plane: every building stands on the pavement top — except where the
// Columbia pads keep their terraces, where it stands on the padded terrain + the
// paving slab (the constant BASE_Y + 0.28 put the 13 plateau buildings 6.7 m low)
if (FLAT) for (const b of buildings) b.base = Math.max(BASE_Y + 0.28, sampleTerrain(b.cx, b.cz) + 0.12);
log('classifying buildings');
let lmHits = 0;
let vacantKept = 0, vacantDropped = 0;   // TW39
for (const b of buildings) {
  if (b.drop) continue;   // TW39: a city record an OSM tower superseded
  const rnd = mulberry((hash2(b.cx * 10, b.cz * 10) * 1e9) | 0);
  // district
  let district = null;
  for (const d of DIST) if (pointInPoly(b.cx, b.cz, d.poly)) { district = d.style; break; }
  const nr = nearestRoad(b.cx, b.cz, 60);
  // wide roadway OR one carriageway of a divided avenue (critic round 2: the
  // rclass-2 test alone left all of Lenox and most of ACP Blvd without shops)
  const onAvenue = !!(nr && (nr.r.rclass === 2 || nr.r.divided) && nr.d < 25);
  const pl = b.pl || {};
  const fi = fisp.get(String(b.bin));
  const ovr = {};
  if (fi) { ovr.material = fi.primary; ovr.tokens = fi.tokens; ovr.wallType = fi.wallType; ovr.anyBrick = fi.anyBrick; }
  const oc = osmCol.length ? osmColourNear(b.cx, b.cz) : null;
  if (oc) ovr.colour = oc;
  let c = classify({
    height: b.h, floors: pl.floors || 0, year: pl.year || b.year, cls: pl.cls || '',
    landuse: pl.landuse || '', area: b.area, onAvenue, histDist: pl.histDist, district,
    boro: b.boro || 0,   // WB13: the frame-belt / new-condo rules are borough-gated
  }, rnd, ovr);
  // TW39: classify() drops a building on a lot PLUTO calls vacant (class V). PLUTO trails construction: a footprint the city
  // has measured at 10 m and more on such a lot is a new building, kept and styled as one of unknown class
  if (!c && b.h >= 10 && !b.osm) { c = classify({ height: b.h, floors: 0, year: b.year, cls: '', landuse: '', area: b.area, onAvenue, histDist: pl.histDist, district, boro: b.boro || 0 }, rnd, ovr); if (c) vacantKept++; }
  if (!c) { b.drop = true; vacantDropped++; continue; }
  b.c = c;
  b.cls = pl.cls || ''; // PLUTO BldgClass drives the rooftop program
  b.color = colorJitter(c.color, rnd, 9);
  b.colorVar = (rnd() * 255) | 0;
  // per-building truth overrides (footprint containing the reference point)
  for (const o of BOVR) {
    if (Math.abs(o.p[0] - b.cx) < 150 && Math.abs(o.p[1] - b.cz) < 150 && pointInPoly(o.p[0], o.p[1], b.ring)) { applyBuildingOverride(b, o, rnd); break; }
  }
  // landmark containment
  b.landmarkId = 0;
  for (const lm of LM) {
    const [lx, lz] = lm.p;
    if (Math.abs(lx - b.cx) < 150 && Math.abs(lz - b.cz) < 150 && pointInPoly(lx, lz, b.ring)) {
      b.landmarkId = lm.mode === 'replace' ? lm.id : -lm.id;
      b.c.flags |= BF.LANDMARK;
      lmHits++;
      break;
    }
  }
}
log('landmarks matched:', lmHits, '/', LM.length);
log(' buildings on lots PLUTO calls vacant (TW39): kept', vacantKept, '(measured 10 m and more), dropped', vacantDropped);
// nearest-fallback for unmatched landmarks
{
  const matched = new Set(buildings.filter((b) => b.landmarkId).map((b) => Math.abs(b.landmarkId)));
  for (const lm of LM) {
    if (matched.has(lm.id)) continue;
    let best = null, bd = 70;
    for (const b of buildings) {
      if (b.drop || b.landmarkId) continue;
      const d = Math.hypot(b.cx - lm.p[0], b.cz - lm.p[1]);
      if (d < bd) { bd = d; best = b; }
    }
    if (best) { best.landmarkId = lm.mode === 'replace' ? lm.id : -lm.id; best.c.flags |= BF.LANDMARK; lmHits++; }
  }
  log('landmarks after fallback:', lmHits);
}
// truth overrides whose reference point fell outside every footprint (a courtyard, an L-shaped plan): nearest building within 30 m
for (const o of BOVR) {
  if (o.hit) continue;
  let best = null, bd = 30;
  for (const b of buildings) {
    if (b.drop || !b.c) continue;
    const d = Math.hypot(b.cx - o.p[0], b.cz - o.p[1]);
    if (d < bd) { bd = d; best = b; }
  }
  if (best) applyBuildingOverride(best, o, mulberry((hash2(best.cx * 10, best.cz * 10) * 1e9) | 0));
}
log('building overrides applied:', BOVR.filter((o) => o.hit).map((o) => o.key).join(' '), '| missed:', BOVR.filter((o) => !o.hit).map((o) => o.key).join(' ') || 'none');

// ---------------------------------------------------------------- blind party walls
log('computing party walls');
{
  const ecell = new Map();
  const EK = 4;
  const ekey = (x, z) => `${Math.round(x / EK)}_${Math.round(z / EK)}`;
  buildings.forEach((b, bi) => {
    if (b.drop) return;
    const n = b.ring.length;
    for (let i = 0; i < Math.min(n, 32); i++) {
      const [x1, z1] = b.ring[i], [x2, z2] = b.ring[(i + 1) % n];
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      const ang = Math.atan2(z2 - z1, x2 - x1);
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 2) continue;
      const k = ekey(mx, mz);
      let arr = ecell.get(k); if (!arr) ecell.set(k, (arr = []));
      arr.push({ bi, i, mx, mz, ang, len });
    }
  });
  for (const arr of ecell.values()) {
    for (let a = 0; a < arr.length; a++) for (let b2 = a + 1; b2 < arr.length; b2++) {
      const A = arr[a], B = arr[b2];
      if (A.bi === B.bi) continue;
      const dAng = Math.abs(((A.ang - B.ang + Math.PI * 2.5) % Math.PI) - Math.PI / 2 - Math.PI / 2 + Math.PI / 2);
      const parallel = Math.abs(Math.sin(A.ang - B.ang)) < 0.15;
      if (!parallel) continue;
      const thresh = Math.min(3.2, Math.max(1.4, Math.min(A.len, B.len) * 0.25));
      if (Math.hypot(A.mx - B.mx, A.mz - B.mz) < thresh) {
        buildings[A.bi].blind = (buildings[A.bi].blind || 0) | (1 << A.i);
        buildings[B.bi].blind = (buildings[B.bi].blind || 0) | (1 << B.i);
      }
    }
  }
}

dbgDump('after-tee-split');
// ---------------------------------------------------------------- road network nodes
log('network nodes');
const nodes = new Map(); // key -> {x,z,stubs:[{road,end,dir,width,rclass,name}]}
const NK = 1.2;
const nkey = (x, z) => `${Math.round(x / NK)}_${Math.round(z / NK)}`;
for (const r of roads) {
  if (r.rclass === 5 || r.rclass === 6) continue;
  for (const end of [0, 1]) {
    const p = end === 0 ? r.pts[0] : r.pts[r.pts.length - 1];
    const q = end === 0 ? r.pts[1] : r.pts[r.pts.length - 2];
    const k = nkey(p[0], p[1]);
    let n = nodes.get(k);
    if (!n) nodes.set(k, (n = { x: p[0], z: p[1], stubs: [] }));
    const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1;
    // RG44: a cut road's end at grade is a leg of the street junction there; an end below grade is not (it passes under)
    const lvE = r.cut ? (Math.abs(end === 0 ? r.lA : r.lB) < 0.1 ? 0 : -1) : r.level;
    n.stubs.push({ r, end, dirx: dx / L, dirz: dz / L, width: r.width, rclass: r.rclass, name: r.name, level: lvE });
    // direct ref: after node recentring the endpoint may quantize to a
    // different nkey cell, so key lookups can miss their own node
    if (end === 0) r.nodeA = n; else r.nodeB = n;
  }
}
// merge near-miss nodes: the 1.2m quantized clustering leaves the same physical
// intersection split into 2+ nodes when CSCL endpoints sit 2-4.5m apart (curved
// geometry / digitization noise) — double caps, gapped corners, and traffic that
// can't route across. Union-find within 4.2m (real intersections are never that
// close; divided-avenue twin nodes sit >7m apart and must NOT merge).
{
  const list = [...nodes.values()];
  const cell = 8, grid = new Map();
  list.forEach((n, i) => {
    const k = `${Math.floor(n.x / cell)}_${Math.floor(n.z / cell)}`;
    let a = grid.get(k); if (!a) grid.set(k, (a = []));
    a.push(i);
  });
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    const gx = Math.floor(list[i].x / cell), gz = Math.floor(list[i].z / cell);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = grid.get(`${gx + dx}_${gz + dz}`);
      if (!a) continue;
      for (const j of a) {
        if (j <= i) continue;
        if (Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z) < 6.0) parent[find(j)] = find(i);
      }
    }
  }
  const groups = new Map();
  list.forEach((n, i) => {
    const g = find(i);
    let arr = groups.get(g); if (!arr) groups.set(g, (arr = []));
    arr.push(n);
  });
  nodes.clear();
  let mergedCount = 0, gi = 0;
  for (const members of groups.values()) {
    let n = members[0];
    if (members.length > 1) {
      mergedCount += members.length - 1;
      n = { x: 0, z: 0, stubs: [] };
      for (const m of members) { n.x += m.x; n.z += m.z; n.stubs.push(...m.stubs); }
      n.x /= members.length; n.z /= members.length;
      for (const s of n.stubs) { if (s.end === 0) s.r.nodeA = n; else s.r.nodeB = n; }
    }
    nodes.set('n' + gi++, n);
  }
  log(' near-miss nodes merged:', mergedCount);
  // geometry must FOLLOW the merged nodes: the runtime traffic graph joins
  // edges by EXACT endpoint coordinates (nk keys over serialized polylines).
  // Merging only the logical node objects left CSCL's 2-4.5m endpoint scatter
  // in r.pts, so the street graph shipped shattered into ~45k fragments and
  // cars could only circle single streets. Snap every arm's end vertex onto
  // its node's merged position and all arms of a junction serialize the SAME
  // coordinate.
  {
    let snapped = 0, moved = 0, far = 0, noNode = 0, moveSum = 0;
    for (const r of roads) {
      if (!r.pts || r.pts.length < 2) continue;
      if (!r.nodeA) noNode++;
      if (!r.nodeB) noNode++;
      if (r.nodeA) {
        const p = r.pts[0];
        const d = Math.hypot(p[0] - r.nodeA.x, p[1] - r.nodeA.z);
        if (d < 7) { if (d > 0.01) { moved++; moveSum += d; } p[0] = r.nodeA.x; p[1] = r.nodeA.z; snapped++; } else far++;
      }
      if (r.nodeB) {
        const p = r.pts[r.pts.length - 1];
        const d = Math.hypot(p[0] - r.nodeB.x, p[1] - r.nodeB.z);
        if (d < 7) { if (d > 0.01) { moved++; moveSum += d; } p[0] = r.nodeB.x; p[1] = r.nodeB.z; snapped++; } else far++;
      }
    }
    log(' road endpoints snapped to merged nodes:', snapped, 'actually moved:', moved,
      'meanMove:', moved ? (moveSum / moved).toFixed(2) : 0, 'tooFar:', far, 'noNodeRef:', noNode);
  }
  // degenerate loops: a short link whose BOTH ends merged into one node (twin
  // carriageway junction pairs over narrow medians). Its ribbon is junction
  // interior asphalt — as stubs it produced corner geometry inside the roadway.
  let loops = 0;
  for (const r of roads) {
    if (r.nodeA && r.nodeA === r.nodeB && polylineLength(r.pts) < 14) { r.jSkip = true; loops++; }
  }
  log(' degenerate junction loops:', loops);
  dbgDump('after-merge-snap');
  // dead-end rescue (OSM-style network healing): a degree-1 node within 14m of
  // another node at similar elevation is a digitization gap, not a real cul de
  // sac — vehicles hitting it can only U-turn, and an unlucky fragment strands
  // them circling one segment. Graft the dead end onto its neighbor so the
  // graph routes through. Height-gated 3m via the road profiles so a street
  // passing under a viaduct never welds to it.
  {
    const list = [...nodes.entries()];
    const cell = 16, grid = new Map();
    list.forEach(([k, n], i) => {
      const g = `${Math.floor(n.x / cell)}_${Math.floor(n.z / cell)}`;
      let a = grid.get(g); if (!a) grid.set(g, (a = []));
      a.push(i);
    });
    const endY = (s) => {
      const p = s.r.prof;
      if (!p || p.ys.length < 2) return null;
      return s.end === 0 ? p.ys[0] : p.ys[p.ys.length - 1];
    };
    let grafted = 0;
    for (const [k, n] of list) {
      if (n.stubs.length !== 1) continue;
      const sy = endY(n.stubs[0]);
      const gx = Math.floor(n.x / cell), gz = Math.floor(n.z / cell);
      let best = null, bestD = 14;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a = grid.get(`${gx + dx}_${gz + dz}`);
        if (!a) continue;
        for (const j of a) {
          const [k2, m] = list[j];
          if (m === n || !nodes.has(k2) || m.stubs.length < 2) continue;
          if (m.stubs.some((s) => s.r === n.stubs[0].r)) continue; // own other end
          const d = Math.hypot(m.x - n.x, m.z - n.z);
          if (d >= bestD) continue;
          if (sy !== null) {
            const my = m.stubs.map(endY).filter((y) => y !== null);
            if (my.length && Math.min(...my.map((y) => Math.abs(y - sy))) > 3) continue;
          }
          bestD = d; best = m;
        }
      }
      if (!best) continue;
      const s = n.stubs[0];
      best.stubs.push(s);
      if (s.end === 0) s.r.nodeA = best; else s.r.nodeB = best;
      nodes.delete(k);
      grafted++;
    }
    log(' dead ends grafted:', grafted);
  }
}
let signalCount = 0;
for (const n of nodes.values()) {
  const names = new Set(n.stubs.map((s) => s.name).filter(Boolean));
  const ground = n.stubs.filter((s) => s.level === 0 && (s.rclass === 1 || s.rclass === 2));
  n.isX = ground.length >= 3 && names.size >= 2;
  n.radius = Math.max(...n.stubs.map((s) => s.width / 2), 4) + 0.4;
  n.signal = n.isX && (n.stubs.some((s) => s.rclass === 2) || ground.length >= 4);
  if (n.signal) signalCount++;
}
log('nodes:', nodes.size, 'signalized:', signalCount);

// ---------------------------------------------------------------- junction geometry prep
// Replaces the round-disc intersection model. A node's member endpoints can sit
// ~1.7m apart inside one 1.2m cluster cell — every downstream seam inherited that,
// so first recentre each node on the mean of its endpoints and snap the endpoints
// onto it. Then build true junction corners: each corner point is the intersection
// of the two adjacent stub edge lines, the curb return is a quadratic Bezier
// tangent to both edges, and each stub gets a "mouth" cross-section distance.
// Cap polygon, curb returns, corner sidewalks, straight-sidewalk trims and
// crosswalks all derive from the same mouths, so they meet instead of gapping.
for (const n of nodes.values()) {
  if (n.stubs.length < 2) continue;
  let mx = 0, mz = 0;
  for (const s of n.stubs) { const p = s.end === 0 ? s.r.pts[0] : s.r.pts[s.r.pts.length - 1]; mx += p[0]; mz += p[1]; }
  n.x = mx / n.stubs.length; n.z = mz / n.stubs.length;
  for (const s of n.stubs) {
    const pts = s.r.pts;
    const p = s.end === 0 ? pts[0] : pts[pts.length - 1];
    const q = s.end === 0 ? pts[1] : pts[pts.length - 2];
    if (Math.hypot(q[0] - n.x, q[1] - n.z) < 1.5) continue; // don't fold micro-segments onto themselves
    p[0] = n.x; p[1] = n.z;
    const dx = q[0] - n.x, dz = q[1] - n.z, L = Math.hypot(dx, dz) || 1;
    s.dirx = dx / L; s.dirz = dz / L;
  }
}
dbgDump('after-recentre');
if (DBG && process.env.DBG_EXIT) process.exit(0);
for (const n of nodes.values()) {
  const ground = n.stubs.filter((s) => s.level === 0 && s.rclass <= 4 && !s.r.noGeom && !s.r.jSkip);
  n.ground = ground;
  if (!ground.length) continue;
  const stubs = [...ground].sort((a, b) => Math.atan2(a.dirz, a.dirx) - Math.atan2(b.dirz, b.dirx));
  n.jstubs = stubs;
  n.corners = [];
  const k = stubs.length;
  if (k < 2) { stubs[0].mouth = 0; continue; }
  // raw corner params: t along A's CCW(left) edge, u along B's CW(right) edge
  const raw = [];
  for (let i = 0; i < k; i++) {
    const A = stubs[i], B = stubs[(i + 1) % k];
    const w2A = A.width / 2, w2B = B.width / 2;
    const ax = n.x - A.dirz * w2A, az = n.z + A.dirx * w2A;
    const bx = n.x + B.dirz * w2B, bz = n.z - B.dirx * w2B;
    const det = B.dirx * A.dirz - A.dirx * B.dirz;
    const ex = bx - ax, ez = bz - az;
    let t = -1, u = -1;
    if (Math.abs(det) > 0.10) {
      t = (B.dirx * ez - B.dirz * ex) / det;
      u = (A.dirx * ez - A.dirz * ex) / det;
    }
    const angA = Math.atan2(A.dirz, A.dirx);
    let span = Math.atan2(B.dirz, B.dirx) - angA;
    while (span <= 0) span += Math.PI * 2;
    const maxC = w2A + w2B + 8;
    // reflex wedges (gore points, Y-junction outer sides) never take the ray
    // solve — a bogus crossing there inflates mouths and the chord fallback
    // would cut across the roadway (handled with an outward bulge below)
    const ok = span < 3.55 && t > 0.2 && u > 0.2 && t < maxC && u < maxC;
    // diverging/near-parallel edges: keep the mouth tight (a chord bridges the
    // corner) — inflating it pushed crosswalks meters away from wide junctions
    raw.push({ ok, t: ok ? t : 2.0, u: ok ? u : 2.0, ax, az, bx, bz, span, angA });
  }
  for (let i = 0; i < k; i++) {
    const prev = raw[(i - 1 + k) % k], cur = raw[i];
    const s = stubs[i];
    s.mouth = Math.min(Math.max(prev.u, cur.t, 2.2) + 0.35, Math.max(2.2, polylineLength(s.r.pts) * 0.45));
    // expose per-end mouths to the road for serialization — the runtime traffic
    // stops cars at the painted stop bars and turns across the real junction span
    if (s.end === 0) s.r.mouthA = s.mouth; else s.r.mouthB = s.mouth;
  }
  for (let i = 0; i < k; i++) {
    const A = stubs[i], B = stubs[(i + 1) % k], rw = raw[i];
    // full corner boundary: A's edge from its mouth down to the fillet tangent,
    // Bezier curb return, B's edge from tangent back up to its mouth
    const eA = (d) => [rw.ax + A.dirx * d, rw.az + A.dirz * d];
    const eB = (d) => [rw.bx + B.dirx * d, rw.bz + B.dirz * d];
    const pts = [];
    if (rw.ok) {
      // curb-return radius: NYC DOT standard 10-15 ft on local corners, 15-25 ft
      // where a wide roadway (avenue / truck route) turns. The old 2.4 m read as
      // a knife-edge corner once the pavement bands filled the block corner.
      const fil = (A.rclass === 2 || B.rclass === 2) ? 4.6 : 3.4;
      const backA = Math.min(fil, rw.t * 0.55), backB = Math.min(fil, rw.u * 0.55);
      const tT = Math.min(rw.t - backA, A.mouth), uT = Math.min(rw.u - backB, B.mouth);
      for (let d = A.mouth; d > tT + 0.4; d -= 2.5) pts.push(eA(d));
      const SA = eA(tT), SB = eB(uT), C = eA(rw.t);
      const steps = Math.max(3, Math.min(12, Math.ceil((Math.hypot(C[0] - SA[0], C[1] - SA[1]) + Math.hypot(SB[0] - C[0], SB[1] - C[1])) / 0.9)));
      for (let j = 0; j <= steps; j++) {
        const tt = j / steps, it = 1 - tt;
        pts.push([it * it * SA[0] + 2 * it * tt * C[0] + tt * tt * SB[0], it * it * SA[1] + 2 * it * tt * C[1] + tt * tt * SB[1]]);
      }
      for (let d = uT + 2.5; d < B.mouth - 0.4; d += 2.5) pts.push(eB(d));
      pts.push(eB(B.mouth));
    } else {
      const SA = eA(A.mouth), SB = eB(B.mouth);
      if (rw.span > 3.55) {
        // reflex wedge: bulge the curb OUTWARD around the gore point — a chord
        // here would slice straight across the junction box
        const bis = rw.angA + rw.span / 2;
        // control must sit OUTSIDE the SA-SB chord or the curve dives across
        // the roadway — scale with the mouth endpoints, not the road width
        const rr2 = Math.max(Math.hypot(SA[0] - n.x, SA[1] - n.z), Math.hypot(SB[0] - n.x, SB[1] - n.z)) * 1.12 + 1.2;
        const C = [n.x + Math.cos(bis) * rr2, n.z + Math.sin(bis) * rr2];
        const approx = Math.hypot(C[0] - SA[0], C[1] - SA[1]) + Math.hypot(SB[0] - C[0], SB[1] - C[1]);
        const steps = Math.max(4, Math.min(14, Math.ceil(approx / 1.1)));
        for (let j = 0; j <= steps; j++) {
          const tt = j / steps, it = 1 - tt;
          pts.push([it * it * SA[0] + 2 * it * tt * C[0] + tt * tt * SB[0], it * it * SA[1] + 2 * it * tt * C[1] + tt * tt * SB[1]]);
        }
      } else {
        // near-parallel stubs (street continuation): straight taper between edges
        pts.push(SA, [(SA[0] + SB[0]) / 2, (SA[1] + SB[1]) / 2], SB);
      }
    }
    n.corners.push({ pts, A, B, swA: A.rclass === 2 ? 4.6 : 3.6, swB: B.rclass === 2 ? 4.6 : 3.6 });
  }
}

// ---------------------------------------------------------------- per-tile collectors
const tiles = new Map();
function tileFor(x, z) {
  const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE);
  const k = `${tx}_${tz}`;
  let t = tiles.get(k);
  if (!t) {
    tiles.set(k, (t = {
      tx, tz, x0: tx * TILE, z0: tz * TILE,
      bldgXZ: new F32(4096), bldg: [], bholes: [], names: [], nameIdx: new Map(),   // CY12: bholes = courtyard inner-ring records
      roadVerts: new F32(2048), roadRecs: [],
      asphalt: new F32(8192), sidewalk: new F32(8192), curb: new F32(2048),
      paintW: new F32(2048), paintY: new F32(1024), paintG: new F32(512), grass: new F32(1024), grassU: new F32(256), pathTris: new F32(1024), brick: new F32(512),
      gutter: new F32(1024), busred: new F32(512), // matId 11 gutter strip against every curb, 12 red bus lane
      warn: new F32(256), warnIron: new F32(256), // matId 13/14 detectable-warning plates (red composite / cast iron) at crosswalk ends
      // RL36 rail (matIds 18 rail steel, 19 ballast, 20 + bearing the sleeper bed, 21 cut walls); rtopA = the bed's
      // per-vertex matId (20 + 0.45 * bearing / pi: the sleepers' direction for the ground shader); railCuts = the open
      // cuts' oriented rectangles [x, z, yaw, halfLen, halfW] (tile-local) the runtime cuts out of the drawn terrain
      rsteel: new F32(64), rbal: new F32(64), rtop: new F32(64), rtopA: new F32(32), rwall: new F32(64), railCuts: [],
      furn: [], nodesJson: [],
    }));
  }
  return t;
}
function nameIdx(t, s) {
  s = s || '';
  let i = t.nameIdx.get(s);
  if (i === undefined) { i = t.names.length; t.names.push(s); t.nameIdx.set(s, i); }
  return i;
}
const pushTri = (buf, ax, ay, az, bx, by, bz, cx, cy, cz) => buf.push(ax, ay, az, bx, by, bz, cx, cy, cz);
// subdivide a triangle until edges < 24m, resampling y from carved terrain (keeps
// big park polygons conforming to the collision heightfield); leaf emit handles tile binning
function subdivTri(A, B, C, lift, emit, depth = 0, maxE = 24) {
  const e = (P, Q) => Math.hypot(P[0] - Q[0], P[2] - Q[2]);
  if (depth < 6 && Math.max(e(A, B), e(B, C), e(C, A)) > maxE) {
    const mid = (P, Q) => drapeVert((P[0] + Q[0]) / 2, (P[2] + Q[2]) / 2, lift);
    const AB = mid(A, B), BC = mid(B, C), CA = mid(C, A);
    subdivTri(A, AB, CA, lift, emit, depth + 1, maxE);
    subdivTri(AB, B, BC, lift, emit, depth + 1, maxE);
    subdivTri(CA, BC, C, lift, emit, depth + 1, maxE);
    subdivTri(AB, BC, CA, lift, emit, depth + 1, maxE);
    return;
  }
  emit(A, B, C);
}
// landmarks whose park polygon swallows a paved parcel (NYPL inside Bryant Park:
// lawn ran to the 5th Ave kerb, critic round 2 #7) declare `noLawn` metres
// `noLawn` = radius (m); `noLawnBox` = { along: [lo, hi], across: [lo, hi] } in the Manhattan grid frame
// (along = uptown N29E, across = toward the east-south-east), metres from the spec centre
const GRID_ALONG = [Math.sin((29 * Math.PI) / 180), -Math.cos((29 * Math.PI) / 180)], GRID_ACROSS = [Math.cos((29 * Math.PI) / 180), Math.sin((29 * Math.PI) / 180)];
const NO_LAWN = LM.filter((l) => l.noLawn > 0 || l.noLawnBox).map((l) => ({ x: l.p[0], z: l.p[1], r2: l.noLawn > 0 ? l.noLawn * l.noLawn : 0, box: l.noLawnBox || null }));
const emitGrassIn = (SEC) => (A, B, C) => {
  if (allPulled(A, B, C) || triTooBig(A, B, C)) return; // chords over water
  {
    // never lay lawn over a carriageway: park polygons that overrun the street
    // (Bryant Park onto 5th Ave's parking lane) sat ABOVE the asphalt (0.272 vs 0.145)
    const gx = (A[0] + B[0] + C[0]) / 3, gz = (A[2] + B[2] + C[2]) / 3;
    if (inCarriageway(gx, gz, (FLAT ? BASE_Y : sampleTerrain(gx, gz)) + 0.2, null)) return;
    // ...and off the SIDEWALK strip beside every road: OSM park polygons run to the kerb (Bryant
    // Park's lawn ran down the 5th Ave sidewalk in critic rounds 4 and 5), so a 5.5 m margin
    // beyond the roadway edge keeps every lawn behind the pavement, as it is on the ground
    if (inCarriageway(gx, gz, (FLAT ? BASE_Y : sampleTerrain(gx, gz)) + 0.2, null, 5.5)) return;
  }
  if (NO_LAWN.length) {
    const gx = (A[0] + B[0] + C[0]) / 3, gz = (A[2] + B[2] + C[2]) / 3;
    for (const n of NO_LAWN) {
      const dx = gx - n.x, dz = gz - n.z;
      if (n.r2 && dx * dx + dz * dz < n.r2) return;
      if (n.box) {
        const al = dx * GRID_ALONG[0] + dz * GRID_ALONG[1], ac = dx * GRID_ACROSS[0] + dz * GRID_ACROSS[1];
        if (al >= n.box.along[0] && al <= n.box.along[1] && ac >= n.box.across[0] && ac <= n.box.across[1]) return;
      }
    }
  }
  // earcut emits one fixed chirality regardless of ring orientation — enforce
  // face-up (+y front) here or lawns render backface-culled = invisible.
  // (Visible-road quads measure normal.y > 0, so that is the render-up sign.)
  if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) < 0) { const T = B; B = C; C = T; }
  const t = tileFor((A[0] + B[0] + C[0]) / 3, (A[2] + B[2] + C[2]) / 3);
  // index explicitly — drapeVert verts carry a 4th flag element, and spreading
  // a 4-vector into pushTri's 9 scalar slots shifts every later coordinate
  // (the corrupted stream put world X values in Y slots: 3500m grass slabs)
  pushTri(t[SEC], A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
};
const emitGrass = emitGrassIn('grass');
// TL26: the campus lawn underlay lies under every campus path, brick field and bed by design; its own section lets the
// runtime push it back in depth (materials.js ground zb) so it never wins a tie against what is laid over it
const emitGrassU = emitGrassIn('grassU');
function pushQuad(buf, a, b, c, d) { // 4 pts [x,y,z] ccw
  pushTri(buf, a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  pushTri(buf, a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2]);
}

// ---------------------------------------------------------------- emit buildings into tiles
log('emitting buildings');
let baseDrops = 0;
for (const b of buildings) {
  if (b.drop) continue;
  // AM120 (owner 2026-09-15, docs/notes/amst120.md): a facade goes down to the LOWEST adjacent pavement. b.base is the
  // terrain at the centroid, so Mudd Hall — on Columbia's terrace, 5.2 m above Amsterdam Ave — floated on a schist slope
  // with its east wall starting a storey above the sidewalk. For a building whose base sits above the street plane,
  // sample the ground 1.5-5.5 m outside each edge midpoint; drop the base to the lowest sample (cap 8 m) and grow the
  // wall by the same amount so the roof keeps its LiDAR elevation. NO_BASEDROP=1 disables.
  if (FLAT && !process.env.NO_BASEDROP && b.base > BASE_Y + 0.28 + 0.6 && b.ring.length >= 3) {
    let lowest = b.base;
    const nE = Math.min(b.ring.length, 250);
    for (let i = 0; i < nE; i++) {
      const [x1, z1] = b.ring[i], [x2, z2] = b.ring[(i + 1) % b.ring.length];
      const el = Math.hypot(x2 - x1, z2 - z1);
      if (el < 3) continue;
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      let nx = -(z2 - z1) / el, nz = (x2 - x1) / el;
      if (pointInPoly(mx + nx * 1.5, mz + nz * 1.5, b.ring)) { nx = -nx; nz = -nz; }
      for (const d of [1.5, 3.5, 5.5]) {
        const y = Math.max(BASE_Y + 0.28, sampleTerrain(mx + nx * d, mz + nz * d) + 0.12);
        if (y < lowest) lowest = y;
      }
    }
    const drop = Math.min(8, b.base - lowest);
    if (drop > 0.6) { b.base -= drop; b.h += drop; baseDrops++; }
  }
  const t = tileFor(b.cx, b.cz);
  const start = t.bldgXZ.n / 2;
  for (const [x, z] of b.ring) t.bldgXZ.push(x - t.x0, z - t.z0);
  // CY12: each light court's ring goes into bldgXZ straight after the outer ring and is
  // addressed by its own `bholes` record, so `start`/`len` below still describe the OUTER
  // RING ONLY and every reader of the 44-byte record is byte-for-byte unaffected.
  const bIdxHere = t.bldg.length;          // index this record WILL take, for the hole's parent ref
  for (const h of b.holes || []) {
    const hs = t.bldgXZ.n / 2;
    for (const [x, z] of h) t.bldgXZ.push(x - t.x0, z - t.z0);
    t.bholes.push({ b: bIdxHere, start: hs, len: h.length, flags: 1,
      area: Math.min(255, Math.round(Math.abs(signedArea(h)) / 4)) });
    cyStat.emitted++;
  }
  if (b.holes && b.holes.length) cyStat.emFeats++;
  const c = b.c;
  const groundY = sampleTerrain(b.cx, b.cz);
  // best street-facing edge -> serialized so the runtime puts THE entrance there
  // (shader + hero door both consume it; previously each guessed its own wall)
  let frontIdx = 255, frontScore = 0;
  for (let i = 0; i < Math.min(b.ring.length, 250); i++) {
    if ((b.blind >> i) & 1) continue;
    const [x1, z1] = b.ring[i], [x2, z2] = b.ring[(i + 1) % b.ring.length];
    const el = Math.hypot(x2 - x1, z2 - z1);
    if (el < 3.5) continue;
    const nr = nearestRoad((x1 + x2) / 2, (z1 + z2) / 2, 16);
    if (!nr || nr.d >= 12) continue;
    const par = Math.abs(nr.dirx * (x2 - x1) + nr.dirz * (z2 - z1)) / el;
    if (par < 0.72) continue;
    const score = (par * Math.min(el, 18)) / (1 + nr.d);
    if (score > frontScore) { frontScore = score; frontIdx = i; }
  }
  t.bldg.push({
    start, len: b.ring.length, landmarkId: b.landmarkId || 0,
    // FLAT: the facade datum IS the pavement (b.base = BASE_Y + 0.28). The old
    // -0.6 buried every storefront bulkhead and door sill (seams.md: 535/535
    // buildings at 2.92 instead of 3.52); assemble.js extrudes its own foundation.
    baseY: FLAT ? b.base : Math.max(groundY - 0.4, b.base - 0.6), height: b.h,
    floors: Math.min(255, c.floors), style: c.style,
    r: b.color[0], g: b.color[1], bcol: b.color[2],
    // packed roof byte: bits 0-2 shape, 3-4 membrane, 5 tank, 6 solar, 7 green.
    // The runtime engine (src/city/roofEngine.js) instantiates the roofscape
    // from these bits at tile stream-in — nothing is serialized per prop.
    roofKind: (() => {
      const shape = c.roofKind & 7;
      const mh = (b.colorVar * 7.31) % 1;
      const s2 = c.style, cl = (b.cls || '')[0] || '';
      let memb; // 0 silver coat, 1 dark EPDM/tar, 2 gravel ballast, 3 pavers
      if (s2 === 3 || s2 === 11 || cl === 'O') memb = mh < 0.35 ? 1 : mh < 0.6 ? 2 : mh < 0.85 ? 3 : 0;
      else if (s2 === 7 || s2 === 6) memb = mh < 0.45 ? 2 : mh < 0.8 ? 1 : 0;
      else memb = mh < 0.55 ? 0 : mh < 0.8 ? 1 : 2;
      const tank = ROOFDATA.tankBins.has(String(b.bin || '')) ? 32 : 0;
      const sN = ROOFDATA.solarNear(b.cx, b.cz, Math.max(14, Math.sqrt(b.area) * 0.7));
      const solar = !shape && sN ? 64 : 0;
      const green = !shape && (ROOFDATA.greenBins.has(String(b.bin || ''))
        || (() => { const g = ROOFDATA.greenNear(b.cx, b.cz, Math.max(10, Math.sqrt(b.area) * 0.75)); return g && pointInPoly(g[0], g[1], b.ring); })()) ? 128 : 0;
      return shape | (memb << 3) | tank | solar | green;
    })(),
    flags: c.flags, lit: (c.lit * 255) | 0,
    floorH: c.floorH, winW: c.winW, storeH: c.storeH, blind: b.blind || 0,
    colorVar: b.colorVar, area: b.area, frontIdx,
  });

  // rooftop & frontage furniture — landmark-replaced buildings get custom
  // massing at runtime, so generic roof/frontage props would float in midair
  if (b.landmarkId > 0) continue;
  const rnd = mulberry((hash2(b.cx * 7, b.cz * 13) * 1e9) | 0);
  const roofY = Math.max(groundY, b.base) + b.h;
  const [obX, obZ] = [b.cx, b.cz];
  if (false && c.flags & BF.WATERTOWER) { // superseded by the rooftop engine (real DOB tank BINs)
    const ob = orientedBBox(b.ring);
    if (ob.w > 8 && ob.h > 8) {
      let px = 0, pz = 0, ok = false;
      for (let tries = 0; tries < 8 && !ok; tries++) {
        const off = 0.1 + rnd() * 0.22;
        px = obX + Math.cos(ob.ang) * ob.w * off * (rnd() < 0.5 ? 1 : -1);
        pz = obZ + Math.sin(ob.ang) * ob.h * off * (rnd() < 0.5 ? 1 : -1);
        ok = pointInPoly(px, pz, b.ring) && pointInPoly(px + 2, pz, b.ring) && pointInPoly(px, pz + 2, b.ring) && pointInPoly(px - 2, pz, b.ring) && pointInPoly(px, pz - 2, b.ring);
      }
      if (!ok && pointInPoly(obX, obZ, b.ring)) { px = obX; pz = obZ; ok = true; }
      if (ok) t.furn.push({ k: FURN.WATER_TOWER, x: px, y: roofY, z: pz, rot: rnd() * 6.28, p0: (Math.min(255, b.h)) | 0, p1: (rnd() * 255) | 0 });
    }
  }
  // rooftop props are RUNTIME-generated (src/city/roofEngine.js) from the
  // packed roof byte above — nothing serialized per prop (the Spider-Man
  // lesson: generate near the camera, don't store).
  // frontage: stoops, fire escapes, awnings, scaffolding, marquee, standpipe
  const n = b.ring.length;
  const frontEdges = [];
  for (let i = 0; i < n; i++) {
    const [x1, z1] = b.ring[i], [x2, z2] = b.ring[(i + 1) % n];
    if ((b.blind >> i) & 1) continue;
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
    const nr = nearestRoad(mx, mz, 16);
    if (!nr) continue;
    const edgeLen = Math.hypot(x2 - x1, z2 - z1);
    if (edgeLen < 3.5) continue;
    const par = Math.abs(nr.dirx * (x2 - x1) + nr.dirz * (z2 - z1)) / edgeLen;
    if (par > 0.8 && nr.d < 9) frontEdges.push({ i, x1, z1, x2, z2, mx, mz, len: edgeLen, nr });
  }
  if (frontEdges.length) {
    const gY = FLAT ? BASE_Y + 0.28 : groundY + CURB; // frontage furniture stands on the WALK, not the terrain plane (seams.md item 2)
    // the stoop/standpipe edge must be the SAME edge the door lands on
    const fe = frontEdges.find((e) => e.i === frontIdx) || frontEdges[0];
    const eAng = (e) => Math.atan2(e.z2 - e.z1, e.x2 - e.x1);
    // outward normal (toward road)
    const outN = (e) => {
      let nx = -(e.z2 - e.z1), nz = (e.x2 - e.x1);
      const L = Math.hypot(nx, nz) || 1; nx /= L; nz /= L;
      const toRoad = (e.nr.px - e.mx) * nx + (e.nr.pz - e.mz) * nz;
      return toRoad > 0 ? [nx, nz] : [-nx, -nz];
    };
    // stoops: 1-2 family rowhouses (PLUTO A/B) AND the brownstones PLUTO files as
    // class C walk-ups (Harlem's rows are almost all C0-C3): narrow front, <= 5
    // floors. Critic round 2: "no stoops on any brownstone block".
    const cls0 = (b.cls || '').charAt(0).toUpperCase();
    const brownstoneC = cls0 === 'C' && fe.len <= 9 && (c.floors || 0) <= 5 && b.h < 18;
    // ...and never in front of a storefront: the shop takes the parlour floor, the stoop was removed
    // ...and only when the runtime's door picker will find a door on this front: pickDoor() (assemble.js)
    // needs a front longer than 3.6 m with at least one bay at the dresser's bay width, otherwise the
    // building has no parlour door and the stoop would climb to a wall
    const hasDoorBay = fe.len > 3.8 && Math.floor((fe.len - 0.44) / Math.max(1.4, c.winW || 2.6)) >= 1;
    // WB13: a sided frame house has a stoop too — a LOW one (3-6 risers,
    // 0.50-1.15 m to the parlour floor, docs/typology/08-vinyl-rowhouse.md
    // §1.2) rather than the Manhattan brownstone's flight, but the same prop
    // and the same "where the front allows" gates: a front long enough for the
    // runtime door picker, and never in front of a shop, because the shop took
    // the parlour floor and the stoop went with it. Weight 0.72, not 0.9:
    // the typology's own front-yard table puts a fraction of the belt behind a
    // railing and a path instead.
    if (c.style === STYLE.FRAME_HOUSE && b.h < 16 && !(c.flags & BF.STOREFRONT) && hasDoorBay && rnd() < 0.72) {
      const [nx, nz] = outN(fe);
      t.furn.push({ k: FURN.STOOP, x: fe.mx + nx * 0.4, y: gY, z: fe.mz + nz * 0.4, rot: Math.atan2(nx, nz), p0: 0, p1: 0 });
      c.flags |= BF.STOOP;
      { const br = t.bldg[t.bldg.length - 1]; if (br && br.start === start) br.flags |= BF.STOOP; }
    } else if ((c.style === STYLE.ROWHOUSE || brownstoneC) && b.h < 20 && !(c.flags & BF.STOREFRONT) && hasDoorBay && rnd() < 0.9) {
      const [nx, nz] = outN(fe);
      t.furn.push({ k: FURN.STOOP, x: fe.mx + nx * 0.4, y: gY, z: fe.mz + nz * 0.4, rot: Math.atan2(nx, nz), p0: 0, p1: 0 });
      c.flags |= BF.STOOP; // the dresser lifts this building's door to the landing (1.70 m) and the runtime slides the stoop to the door bay
      // the tile record was pushed (with a copy of c.flags) before this frontage pass — stamp it too
      { const br = t.bldg[t.bldg.length - 1]; if (br && br.start === start) br.flags |= BF.STOOP; }
    }
    // FIRE ESCAPES, where New York has them (owner 2026-09-11, refs/streetview/harlem): multi-family
    // walk-ups of four storeys and more — tenements and lofts, prewar apartment houses up to seven
    // floors — on the street front. Never on a stooped brownstone (class A/B, or the class-C rows),
    // never under 11.5 m, never on civic, retail, postwar or glass stock (classify already clears those).
    const feStyle = c.style === STYLE.TENEMENT || c.style === STYLE.LOFT_CASTIRON || c.style === STYLE.INDUSTRIAL
      || (c.style === STYLE.PREWAR_APT && (c.floors || 0) <= 7);
    if ((c.flags & BF.FIRE_ESCAPE) && feStyle && !(c.flags & BF.STOOP) && !brownstoneC && (c.floors || 0) >= 4 && b.h >= 11.5) {
      for (const e of frontEdges) {
        const bays = Math.max(1, Math.floor(e.len / 8));
        for (let bi2 = 0; bi2 < bays; bi2++) {
          if (rnd() < 0.35) continue;
          const tt = (bi2 + 0.5) / bays;
          const px = e.x1 + (e.x2 - e.x1) * tt, pz = e.z1 + (e.z2 - e.z1) * tt;
          const [nx, nz] = outN(e);
          t.furn.push({ k: FURN.FIRE_ESCAPE, x: px + nx * 0.55, y: gY, z: pz + nz * 0.55, rot: Math.atan2(nx, nz), p0: Math.min(255, c.floors), p1: (c.floorH * 20) | 0 });
        }
      }
    }
    if ((c.flags & BF.STOREFRONT) && c.storeH > 0) {
      for (const e of frontEdges) {
        const bays = Math.max(1, Math.floor(e.len / 4.2));
        for (let bi2 = 0; bi2 < bays; bi2++) {
          if (rnd() < 0.45) continue;
          const tt = (bi2 + 0.5) / bays;
          const px = e.x1 + (e.x2 - e.x1) * tt, pz = e.z1 + (e.z2 - e.z1) * tt;
          const [nx, nz] = outN(e);
          t.furn.push({ k: FURN.AWNING, x: px + nx * 0.1, y: gY + c.storeH * 0.72, z: pz + nz * 0.1, rot: Math.atan2(nx, nz), p0: (rnd() * 6) | 0, p1: 36 });
        }
      }
    }
    // 1.2 %: NYC carries ~9 000 sidewalk sheds over ~1 M buildings; at 2.8 % the same shed asset stood in three of the four
    // 120th & Amsterdam plates (docs/notes/amst120-critic.md, 2026-09-15)
    if (rnd() < 0.012 && b.h > 8) { // sidewalk shed / scaffolding (+ stray cones)
      for (const e of frontEdges) {
        const [nx, nz] = outN(e);
        // rotY maps local +x to (cosθ,0,−sinθ): θ = atan2(−dz,dx) aligns the module to the wall
        t.furn.push({ k: FURN.SCAFFOLD, x: e.mx + nx * 1.8, y: gY, z: e.mz + nz * 1.8, rot: Math.atan2(-(e.z2 - e.z1), e.x2 - e.x1), p0: Math.min(250, e.len) | 0, p1: 0 });
        if (rnd() < 0.5) t.furn.push({ k: 37, x: e.x1 + nx * 3.6, y: gY, z: e.z1 + nz * 3.6, rot: rnd() * 6.28, p0: 0, p1: 0 });
        if (rnd() < 0.35) t.furn.push({ k: 37, x: e.x2 + nx * 3.2, y: gY, z: e.z2 + nz * 3.2, rot: rnd() * 6.28, p0: 0, p1: 0 });
      }
    }
    if (rnd() < 0.5 && b.h > 12) {
      const [nx, nz] = outN(fe);
      const tt = 0.15 + rnd() * 0.7;
      t.furn.push({ k: FURN.STANDPIPE, x: fe.x1 + (fe.x2 - fe.x1) * tt + nx * 0.5, y: gY, z: fe.z1 + (fe.z2 - fe.z1) * tt + nz * 0.5, rot: Math.atan2(nx, nz), p0: 0, p1: 0 });
    }
  }

  // CY12 — FIRE ESCAPES ON THE COURT WALLS. On a pre-war New York apartment house the light
  // court is not decoration: it is what gives the interior rooms their legally required light
  // and their second means of egress, so the court walls carry MORE fire escapes than the
  // street front, not fewer (the reference top view; every court on that block has them).
  // Runs outside the `frontEdges` block on purpose — a court's escapes do not depend on the
  // building having any street frontage at all.
  if ((b.holes || []).length && (c.flags & BF.FIRE_ESCAPE) && (c.floors || 0) >= 4 && b.h >= 11.5
      && (c.style === STYLE.TENEMENT || c.style === STYLE.LOFT_CASTIRON || c.style === STYLE.INDUSTRIAL
          || (c.style === STYLE.PREWAR_APT && (c.floors || 0) <= 7))) {
    const gYc = FLAT ? BASE_Y + 0.28 : groundY + 0.14;   // 0.14 = CURB, spelled out: that const is declared below this loop
    for (const h of b.holes) {
      // a fire escape hangs 1.1 m off the wall — it needs a court, not a light slot
      let a2 = Math.abs(signedArea(h)), per2 = 0;
      for (let i = 0; i < h.length; i++) { const p = h[i], q = h[(i + 1) % h.length]; per2 += Math.hypot(q[0] - p[0], q[1] - p[1]); }
      if (per2 <= 0 || (2 * a2) / per2 < 4.5) continue;
      for (let i = 0; i < h.length; i++) {
        const [x1, z1] = h[i], [x2, z2] = h[(i + 1) % h.length];
        const ex = x2 - x1, ez = z2 - z1, el = Math.hypot(ex, ez);
        if (el < 4.5) continue;
        // the court ring is wound CW, so (+ez,-ex) — the same "exterior" direction
        // extrudePrism gives the court wall's face — points INTO the court
        const nx = ez / el, nz = -ex / el;
        const bays = Math.max(1, Math.floor(el / 8));
        for (let bi2 = 0; bi2 < bays; bi2++) {
          if (rnd() < 0.3) continue;
          const tt = (bi2 + 0.5) / bays;
          const px = x1 + ex * tt, pz = z1 + ez * tt;
          t.furn.push({ k: FURN.FIRE_ESCAPE, x: px + nx * 0.55, y: gYc, z: pz + nz * 0.55, rot: Math.atan2(nx, nz), p0: Math.min(255, c.floors), p1: (c.floorH * 20) | 0 });
        }
      }
    }
  }
}
// CY12 census, emit half: courts that reached a tile record
log(` CY12 courts emitted: ${cyStat.emitted} on ${cyStat.emFeats} buildings`
  + ` (loader kept ${cyStat.kept} on ${cyStat.feats}; ${cyStat.kept - cyStat.emitted} lost to dropped/landmark buildings)`);

// ---------------------------------------------------------------- roads -> tile geometry
log(' facades dropped to the adjacent pavement (AM120):', baseDrops);
log('emitting roads');
const CURB = 0.14;
const FURN_LIFT = FLAT ? 0.28 : CURB; // furniture base = sidewalk top (flat: BASE+0.28)
// contour pavement (vector union -> marching squares -> earcut) replaces the
// analytic straight sidewalks, corner bands, dead-end wraps and their curb
// faces; ANALYTIC_WALKS=1 restores the old emitters for comparison
const CONTOUR_WALKS = !process.env.ANALYTIC_WALKS;
// XW11 crosswalk depth (the marked width of the crossing, measured ALONG the road it crosses).
// MEASURED on client/ref_lenox.png, the near-nadir aerial plate of 125th & Lenox —
// the only reference steep enough to measure both axes (scale anchored on parked vehicles,
// 8.2 px/m N-S, and on the 22.7 m carriageway+median span, 9.3 px/m E-W):
//   crossing of W 125 ST  bar length 76.5 px -> 8.2 m (27 ft), ladder span 18.3 m = the CSCL width
//   crossing of a Lenox carriageway  bar length 36 px -> 4.4 m (14.5 ft)
// NYC DOT's standard crosswalk widths are 12 / 15 / 20 / 25 ft; 25 ft is used here for 55 ft+
// roadways (the measurement says 27) and 15 ft everywhere else (measured 14.5 on Lenox, 11-16 on
// the W 122 St locals). Keyed on rclass + width ONLY so src/city/streetNYC.js (RAMP_IN),
// src/sim/traffic.js (stop line) and src/perception/segRender.js can reproduce it from the tile
// road record, which carries no signal or divided flag.
const XW_DEPTH = (rclass, width) => (rclass === 2 && width >= 16.5 ? 7.62 : 4.57);   // 25 ft / 15 ft
function roadY(r, x, z, d = 0, L = 1) {
  if (FLAT) {
    const liftF = ((r.lA ?? r.level) + ((r.lB ?? r.level) - (r.lA ?? r.level)) * Math.min(1, d / Math.max(1, L))) * 7;
    if (liftF < -0.05) return Math.max(0.45, BASE_Y + 0.145 + liftF * CUT_PER_LEVEL / 7);   // RG44: the cut's floor (two levels down rest on one's)
    return liftF > 0.05 ? Math.max(BASE_Y, 1.5) + liftF + 0.02 : BASE_Y + (r.rclass === 5 ? 0.27 : 0.145);
  }
  // base comes from the road's OWN smoothed profile (corridor pass), not from
  // the carved heightmap: the heightmap is min'd across every overlapping
  // corridor, so a road crossing above another would dive to the lower grade.
  let base;
  if (r.prof && r.prof.ys.length > 1) {
    const f = Math.max(0, Math.min(1, d / Math.max(1e-6, r.prof.L))) * (r.prof.ys.length - 1);
    const i = Math.min(r.prof.ys.length - 2, Math.floor(f));
    base = r.prof.ys[i] + (r.prof.ys[i + 1] - r.prof.ys[i]) * (f - i) - 0.12; // = carve target
  } else base = sampleTerrain(x, z); // carved: sits 0.12 below the corridor elevation
  const lift = ((r.lA ?? r.level) + ((r.lB ?? r.level) - (r.lA ?? r.level)) * Math.min(1, d / Math.max(1, L))) * 7;
  if (lift < -0.05) return Math.max(0.45, base + 0.14 + lift * CUT_PER_LEVEL / 7);   // RG44
  return lift > 0.05 ? Math.max(base, 1.5) + lift + 0.02 : base + 0.14;
}
// RULE: pavement never overlaps a carriageway. CSCL carries near-duplicate
// parallel carriageways whose ribbons overlap — a road's sidewalk can land on
// its neighbor's asphalt. Every pavement emitter (straight sidewalks, corner
// bands, dead-end wraps, medians) asks this index how much outward room it has
// before entering ANOTHER road's carriageway at a similar height.
// how far a road's sidewalk band runs past a junction node: to the outer edge of the
// widest OTHER leg's sidewalk there (+0.5 m so the two bands overlap at the corner)
const cornerExt = (n, r) => {
  let m = 0;
  for (const s of n.stubs) {
    if (s.r === r) continue;
    const bwS = s.rclass <= 2 ? (s.r.bwMax || (s.rclass === 2 ? 5.0 : 4.2)) : 0;
    m = Math.max(m, s.width / 2 + bwS);
  }
  return m > 0 ? m + 0.5 : 0;
};
// ---------------------------------------------------------------- NYC DOT bus lanes (red)
// data/raw/bus_lanes.json: Socrata rows of "Bus Lanes - Local Streets" (LION
// segments; lane_type Curbside/Offset, lane_color Red, bltrafdir W/A/T relative
// to the LION segment's own digitising direction). LION and CSCL share their
// centerline geometry, so roads are matched geometrically: a road carries the
// lane when 2 of 3 samples sit within 4 m of a red-lane polyline.
{
  const bf = path.join(RAW, 'bus_lanes.json');
  if (fs.existsSync(bf)) {
    const rows = JSON.parse(fs.readFileSync(bf, 'utf8'));
    const BC = 32, bidx = new Map();
    let nB = 0;
    for (const row of rows) {
      if (!/^red$/i.test(row.lane_color || '')) continue;
      const lt = /curb/i.test(row.lane_type || '') ? 'curb' : /offset/i.test(row.lane_type || '') ? 'offset' : null;
      if (!lt) continue;
      const g = row.the_geom; if (!g) continue;
      const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
      for (const line of lines) {
        const P = line.map(([lon, lat]) => project(lon, lat));
        for (let i = 1; i < P.length; i++) {
          const s = { x1: P[i - 1][0], z1: P[i - 1][1], x2: P[i][0], z2: P[i][1], dir: (row.bltrafdir || 'T').toUpperCase(), lt };
          nB++;
          for (let gx = Math.floor(Math.min(s.x1, s.x2) / BC); gx <= Math.floor(Math.max(s.x1, s.x2) / BC); gx++)
            for (let gz = Math.floor(Math.min(s.z1, s.z2) / BC); gz <= Math.floor(Math.max(s.z1, s.z2) / BC); gz++) {
              const k = gx + '_' + gz; let a = bidx.get(k); if (!a) bidx.set(k, (a = [])); a.push(s);
            }
        }
      }
    }
    const nearest = (px, pz) => {
      const gx = Math.floor(px / BC), gz = Math.floor(pz / BC);
      let best = null, bd = 16; // (4 m)^2
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const a = bidx.get(`${gx + dx}_${gz + dz}`); if (!a) continue;
        for (const s of a) {
          const vx = s.x2 - s.x1, vz = s.z2 - s.z1, L2 = vx * vx + vz * vz || 1e-9;
          const t = Math.max(0, Math.min(1, ((px - s.x1) * vx + (pz - s.z1) * vz) / L2));
          const d2 = (px - (s.x1 + vx * t)) ** 2 + (pz - (s.z1 + vz * t)) ** 2;
          if (d2 < bd) { bd = d2; best = s; }
        }
      }
      return best;
    };
    let busRoads = 0;
    for (const r of roads) {
      if (r.rclass > 2 || r.level !== 0 || r.noGeom) continue;
      const L = polylineLength(r.pts);
      if (L < 12) continue;
      let hits = 0, side = 0, lt = null;
      for (const f of [0.25, 0.5, 0.75]) {
        const [x, z, dx, dz] = alongPolyline(r.pts, L * f);
        const s = nearest(x, z);
        if (!s) continue;
        hits++;
        lt = lt || s.lt;
        // W = with the LION segment's direction, A = against, T = both. In this
        // road's from->to frame the lane sits on the RIGHT of its travel
        // direction, which is the +n side (n = (-dz, dx); +x east, +z south).
        const same = (s.x2 - s.x1) * dx + (s.z2 - s.z1) * dz >= 0;
        side += s.dir === 'T' ? 0 : ((s.dir === 'W') === same ? 1 : -1);
      }
      if (hits < 2) continue;
      let sides = side > 0 ? [1] : side < 0 ? [-1] : [-1, 1];
      if (r.oneway !== 0) sides = [r.oneway]; // one-way: only the travel direction's right kerb
      r.bus = { sides, lt };
      busRoads++;
    }
    log('bus lanes:', nB, 'red segments ->', busRoads, 'roads');
  }
}

// ---------------------------------------------------------------- sidewalk widths from the building line
// NYC walks run curb to property line, and on Manhattan blocks the footprints
// ARE the property line: measure curb -> nearest footprint along the outward
// normal (3 samples per segment, median), clamped to what NYC builds — 60 ft
// side streets 3.4-5.2 m, avenues and wide roadways 4.0-6.4 m. The class
// defaults (4.2 / 5.0) stand where there is no frontage within 9.5 m.
const BGC = 48, BGRID = new Map();
for (const b of buildings) {
  if (b.drop || !b.ring || b.ring.length < 3) continue;
  let x0 = 1e12, z0 = 1e12, x1 = -1e12, z1 = -1e12;
  for (const [x, z] of b.ring) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  b.bb = [x0, z0, x1, z1];
  for (let gx = Math.floor(x0 / BGC); gx <= Math.floor(x1 / BGC); gx++)
    for (let gz = Math.floor(z0 / BGC); gz <= Math.floor(z1 / BGC); gz++) {
      const k = gx + '_' + gz; let a = BGRID.get(k); if (!a) BGRID.set(k, (a = [])); a.push(b);
    }
}
// first hit of the ray (px,pz)+(nx,nz)t against any footprint edge, t in [0,tMax)
const rayToBuildings = (px, pz, nx, nz, tMax) => {
  let best = tMax;
  const ex = px + nx * tMax, ez = pz + nz * tMax;
  const gx0 = Math.floor(Math.min(px, ex) / BGC), gx1 = Math.floor(Math.max(px, ex) / BGC);
  const gz0 = Math.floor(Math.min(pz, ez) / BGC), gz1 = Math.floor(Math.max(pz, ez) / BGC);
  for (let gx = gx0; gx <= gx1; gx++) for (let gz = gz0; gz <= gz1; gz++) {
    const a = BGRID.get(gx + '_' + gz); if (!a) continue;
    for (const b of a) {
      const bb = b.bb;
      if (Math.max(px, ex) < bb[0] || Math.min(px, ex) > bb[2] || Math.max(pz, ez) < bb[1] || Math.min(pz, ez) > bb[3]) continue;
      const R = b.ring, m = R.length;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const ax = R[j][0], az = R[j][1], vx = R[i][0] - ax, vz = R[i][1] - az;
        const den = nx * vz - nz * vx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((ax - px) * vz - (az - pz) * vx) / den;   // along the ray
        const u = ((ax - px) * nz - (az - pz) * nx) / den;   // along the edge
        if (t >= 0 && t < best && u >= 0 && u <= 1) best = t;
      }
    }
  }
  return best;
};
const walkWidth = (x1, z1, x2, z2, w2, sgn, rclass) => {
  const def = rclass === 2 ? 5.0 : 4.2;
  const lo = rclass === 2 ? 4.0 : 3.4, hi = rclass === 2 ? 6.4 : 5.2;
  const dx = x2 - x1, dz = z2 - z1, Ls = Math.hypot(dx, dz) || 1;
  const nx = (-dz / Ls) * sgn, nz = (dx / Ls) * sgn;
  const ds = [];
  for (const f of [0.2, 0.5, 0.8]) {
    const d = rayToBuildings(x1 + dx * f + nx * w2, z1 + dz * f + nz * w2, nx, nz, 9.5);
    if (d < 9.5) ds.push(d);
  }
  if (!ds.length) return def;
  ds.sort((a, b) => a - b);
  return Math.max(lo, Math.min(hi, ds[(ds.length - 1) >> 1]));
};
// pre-pass: per-segment [+n side, -n side] widths and the road's max (used by
// the field, the junction caps and cornerExt before any segment is indexed)
{
  let nw = 0, sum = 0;
  for (const r of roads) {
    if (r.rclass > 2 || r.noGeom || r.cut) continue;   // (RG44: a cut has no sidewalks)
    r.segBw = []; r.bwMax = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
      let bwN = walkWidth(x1, z1, x2, z2, r.width / 2, 1, r.rclass), bwM = walkWidth(x1, z1, x2, z2, r.width / 2, -1, r.rclass);
      r.bwMax = Math.max(r.bwMax, bwN, bwM); // street-side widths only: caps and cornerExt key on this
      // divided avenue: the twin side fills the whole median gap (up to 2 x 8.5 m),
      // including where the carriageways splay toward their junction nodes — the
      // bare triangle north of 125th/Lenox in seams.md
      if (r.divided > 0) bwN = Math.max(bwN, 8.5); else if (r.divided < 0) bwM = Math.max(bwM, 8.5);
      r.segBw.push([bwN, bwM]);
      nw += 2; sum += bwN + bwM;
    }
  }
  log('sidewalk widths measured:', nw, 'mean', nw ? (sum / nw).toFixed(2) : '-');
}

const ROADIDX = new Map();
const PCELL = 24;
{
  for (const r of roads) {
    if (r.rclass >= 5 || r.noGeom) continue;
    const L = polylineLength(r.pts);
    let acc = 0;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
      const segL = Math.hypot(x2 - x1, z2 - z1);
      const y1 = roadY(r, x1, z1, acc, L), y2 = roadY(r, x2, z2, acc + segL, L);
      acc += segL;
      // sidewalk band width PER SIDE, curb -> building line (walkWidth): +n side
      // (right of from->to) and -n side; the field picks the side per sample
      const [bwN, bwM] = r.segBw ? r.segBw[i - 1] : [0, 0];
      const bw = Math.max(bwN, bwM);
      // pavement bands run PAST a junction end by the junction radius + band, so
      // the two bands meeting at a corner fill the whole block corner (NYC
      // sidewalks reach the building line); the asphalt-distance term still
      // keeps pavement off every carriageway. Before, corners were only the
      // 4.6 m band around the curb-return fillet — chamfered "cut" corners
      // and bare terrain at park-side corners.
      const nodeAtA = i === 1 ? r.nodeA : null, nodeAtB = i === r.pts.length - 1 ? r.nodeB : null;
      const seg = {
        x1, z1, x2, z2, y1, y2, w2: r.width / 2, r,
        atGrade: Math.abs(y1 - sampleTerrain(x1, z1)) < 1.2 && Math.abs(y2 - sampleTerrain(x2, z2)) < 1.2,   // (RG44: nor a cut's deep run)
        bw, bwN, bwM,
        // extend exactly to the far edge of the OTHER legs' sidewalks (their half width + band);
        // junction radius + band overshot by ~7 m along avenues and laid pavement into the block
        extA: bw > 0 && nodeAtA && nodeAtA.stubs && nodeAtA.stubs.length >= 2 ? cornerExt(nodeAtA, r) : 0,
        extB: bw > 0 && nodeAtB && nodeAtB.stubs && nodeAtB.stubs.length >= 2 ? cornerExt(nodeAtB, r) : 0,
      };
      for (let gx = Math.floor(Math.min(x1, x2) / PCELL); gx <= Math.floor(Math.max(x1, x2) / PCELL); gx++)
        for (let gz = Math.floor(Math.min(z1, z2) / PCELL); gz <= Math.floor(Math.max(z1, z2) / PCELL); gz++) {
          const k = gx + '_' + gz;
          let a = ROADIDX.get(k); if (!a) ROADIDX.set(k, (a = []));
          a.push(seg);
        }
    }
  }
}
// is (px,pz,py) inside another road's carriageway (similar height)?
function inCarriageway(px, pz, py, exclude, margin = -0.05) {
  const gx = Math.floor(px / PCELL), gz = Math.floor(pz / PCELL);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const a = ROADIDX.get(`${gx + dx}_${gz + dz}`);
    if (!a) continue;
    for (const s of a) {
      if (exclude && exclude.indexOf(s.r) !== -1) continue;
      const dx2 = s.x2 - s.x1, dz2 = s.z2 - s.z1, L2 = dx2 * dx2 + dz2 * dz2 || 1e-9;
      const t = Math.max(0, Math.min(1, ((px - s.x1) * dx2 + (pz - s.z1) * dz2) / L2));
      const dd = Math.hypot(px - (s.x1 + dx2 * t), pz - (s.z1 + dz2 * t));
      if (dd >= s.w2 + margin) continue;
      const sy = s.y1 + (s.y2 - s.y1) * t;
      if (Math.abs(sy - py) > 1.8) continue; // different level (over/underpass)
      return true;
    }
  }
  return false;
}
// directional clearance: march outward from (px,pz) along (nx,nz) up to maxW,
// return the usable band width before entering another road's carriageway
function paveClearDir(px, pz, py, nx, nz, maxW, exclude) {
  if (inCarriageway(px, pz, py, exclude)) return -1;
  for (let t = 0.7; t <= maxW + 0.05; t += 0.7) {
    if (inCarriageway(px + nx * t, pz + nz * t, py, exclude)) return Math.max(0, t - 0.85);
  }
  return maxW;
}
for (const r of roads) {
  if (r.rclass === 6) continue; // alleys: skip geometry (rare)
  const isPath = r.rclass === 5;
  const w2 = r.width / 2;
  // junction nodes at each end (direct refs — see node registration)
  const nA = r.nodeA, nB = r.nodeB;
  // resample polyline every ~10m with y
  const L = polylineLength(r.pts);
  // MK14: the MUTCD elongated-letter helpers (LH/SX/GAP, glyphTris, wordW, cellQuad, word) used to live inside the bus-lane
  // branch; the lane-use arrows need `word` too (ONLY under a two-way avenue's left-turn arrow), so they sit at road scope.
    const LH = 2.44, SX = 0.42 * LH, GAP = 0.20;
    const glyphTris = (ch, dBase, dirSign, oLeft) => {
      const g = SERIES_C.glyphs[ch]; if (!g) return;
      const flat = [], holeIdx = [];
      for (const [gx, gy] of g.outer) flat.push(gx, gy);
      for (const h of g.holes) { holeIdx.push(flat.length / 2); for (const [gx, gy] of h) flat.push(gx, gy); }
      const idx = earcut(flat, holeIdx.length ? holeIdx : null);
      const V = (k) => {
        const gx = flat[k * 2], gy = flat[k * 2 + 1];
        const d = dBase + dirSign * gy * LH, o = oLeft + dirSign * gx * SX;
        const [xa, za, dxa, dza] = alongPolyline(r.pts, d);
        return [xa - dza * o, roadY(r, xa, za, d, L) + 0.032, za + dxa * o];   // legends over lane paint: zfight.md L5
      };
      for (let i = 0; i < idx.length; i += 3) {
        const A = V(idx[i]), B = V(idx[i + 1]), C = V(idx[i + 2]);
        const tq = tileFor((A[0] + B[0] + C[0]) / 3, (A[2] + B[2] + C[2]) / 3);
        if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) < 0) pushTri(tq.paintW, A[0], A[1], A[2], C[0], C[1], C[2], B[0], B[1], B[2]);
        else pushTri(tq.paintW, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
      }
    };
    const wordW = (str) => { let w = 0; for (const ch of str) w += (SERIES_C.glyphs[ch]?.adv || 0.6) * SX; return w + (str.length - 1) * GAP; };
    const cellQuad = (dA, dB, offA, offB) => {
      const [xa, za, dxa, dza] = alongPolyline(r.pts, dA), [xb, zb, dxb, dzb] = alongPolyline(r.pts, dB);
      const ya = roadY(r, xa, za, dA, L) + 0.014, yb = roadY(r, xb, zb, dB, L) + 0.014;
      const tq = tileFor((xa + xb) / 2, (za + zb) / 2);
      pushQuad(tq.paintW, [xa - dza * offA, ya, za + dxa * offA], [xa - dza * offB, ya, za + dxa * offB], [xb - dzb * offB, yb, zb + dxb * offB], [xb - dzb * offA, yb, zb + dxb * offA]);
    };
    // letters across the lane centred on `off`; the word's baseline is at dStart (nearest
    // the driver), its top LH ahead; the driver's left is -n for +dir travel, +n for -dir
    const word = (str, dStart, dirSign, off) => {
      if (Math.min(dStart, dStart + dirSign * LH) < 0.5 || Math.max(dStart, dStart + dirSign * LH) > L - 0.5) return;
      const wTot = wordW(str);
      let k0 = -wTot / 2;
      for (const ch of str) {
        const g = SERIES_C.glyphs[ch]; if (!g) continue;
        glyphTris(ch, dStart, dirSign, off + dirSign * k0);
        k0 += g.adv * SX + GAP;
      }
    };
  // park paths (rclass 5) have no corridor profile: their ribbon is draped per vertex,
  // so on real park relief a 12 m quad floats as a slab over every dip — sample
  // them every ~3 m; streets keep the 6-14 m step
  const step = r.rclass === 5 ? Math.max(2.5, Math.min(4, L / Math.ceil(L / 3))) : Math.max(6, Math.min(14, L / Math.ceil(L / 12)));
  const P = [];
  for (let d = 0; d <= L + 0.01; d += step) {
    const [x, z, dx, dz] = alongPolyline(r.pts, Math.min(d, L));
    P.push([x, roadY(r, x, z, Math.min(d, L), L), z, dx, dz]);
  }
  if (P.length < 2) continue;
  // tile assignment per sub-quad by midpoint
  const emitRibbon = (buf, off1, off2, yLift = 0) => {
    for (let i = 0; i < P.length - 1; i++) {
      const [x1, y1, z1, dx1, dz1] = P[i], [x2, y2, z2, dx2, dz2] = P[i + 1];
      const n1 = [-dz1, dx1], n2 = [-dz2, dx2];
      const a = [x1 + n1[0] * off1, y1 + yLift, z1 + n1[1] * off1];
      const b = [x1 + n1[0] * off2, y1 + yLift, z1 + n1[1] * off2];
      const c = [x2 + n2[0] * off2, y2 + yLift, z2 + n2[1] * off2];
      const d = [x2 + n2[0] * off1, y2 + yLift, z2 + n2[1] * off1];
      const t = tileFor((x1 + x2) / 2, (z1 + z2) / 2);
      pushQuad(t[buf], a, b, c, d);
    }
  };
  if (isPath) {
    if (!r.noGeom) {
      // paths are not junction arms (no mouths), so their ribbons ran straight across the cap of
      // any road they meet — a 3.5 m "path" painted over the junction asphalt, which the traffic
      // audit then read as cars driving on a path. Trim each end back until it leaves every
      // OTHER road's carriageway (+1 m), like a road stopping at its mouth.
      const yP = FLAT ? BASE_Y + 0.2 : sampleTerrain(r.pts[0][0], r.pts[0][1]) + 0.2;
      let ta = 0, tb = 0;
      while (ta < L * 0.45) { const [px, pz] = alongPolyline(r.pts, ta); if (!inCarriageway(px, pz, yP, [r])) break; ta += 1; }
      while (tb < L * 0.45) { const [px, pz] = alongPolyline(r.pts, L - tb); if (!inCarriageway(px, pz, yP, [r])) break; tb += 1; }
      if (ta > 0) ta += 1; if (tb > 0) tb += 1;
      if (ta === 0 && tb === 0) emitRibbon('pathTris', -w2, w2, 0.03);
      else if (L - ta - tb > 1) {
        // exact-arc strip between ta..L-tb (emitStrip lives in the road branch below)
        for (let d = ta; d < L - tb - 1e-6; d += 6) {
          const d2 = Math.min(d + 6, L - tb);
          const [xa, za, dxa, dza] = alongPolyline(r.pts, d);
          const [xb, zb, dxb, dzb] = alongPolyline(r.pts, d2);
          const ya = roadY(r, xa, za, d, L) + 0.03, yb = roadY(r, xb, zb, d2, L) + 0.03;
          const t = tileFor((xa + xb) / 2, (za + zb) / 2);
          pushQuad(t.pathTris, [xa + dza * w2, ya, za - dxa * w2], [xa - dza * w2, ya, za + dxa * w2], [xb - dzb * w2, yb, zb + dxb * w2], [xb + dzb * w2, yb, zb - dxb * w2]);
        }
      }
    }
  }
  else {
    // exact-arc strip between arc distances dLo..dHi at lateral offsets off1..off2
    // (same lateral convention as emitRibbon / paintStrip: +off = the (-dz, dx) side)
    const emitStrip = (buf, off1, off2, dLo, dHi, yLift = 0) => {
      dLo = Math.max(0, dLo); dHi = Math.min(L, dHi);
      if (dHi - dLo < 0.05) return;
      for (let d = dLo; d < dHi - 1e-6; d += step) {
        const d2 = Math.min(d + step, dHi);
        const [xa, za, dxa, dza] = alongPolyline(r.pts, d);
        const [xb, zb, dxb, dzb] = alongPolyline(r.pts, d2);
        const ya = roadY(r, xa, za, d, L) + yLift, yb = roadY(r, xb, zb, d2, L) + yLift;
        const t = tileFor((xa + xb) / 2, (za + zb) / 2);
        pushQuad(t[buf],
          [xa - dza * off1, ya, za + dxa * off1], [xa - dza * off2, ya, za + dxa * off2],
          [xb - dzb * off2, yb, zb + dxb * off2], [xb - dzb * off1, yb, zb + dxb * off1]);
      }
    };
    // NYC roadway edge: the 0.45 m against each curb is its own surface (matId
    // 11, gutter — grit at the stone, then oil-dark, dirtier asphalt), the
    // strongest single read of a real street edge. Cut out of the ribbon (no
    // overlay, no z-fight) between the junction mouths; the cap fan carries it
    // round the corner returns. Red bus lanes (NYC DOT dataset) are matId 12
    // strips with a solid white edge line on the traffic side, ending at the
    // crosswalk / stop-bar zone like the real paint.
    const GUT = 0.45;
    const hasCurb = r.level === 0 && r.rclass !== 3 && r.rclass !== 4 && !(r.lA > 0 || r.lB > 0);
    if (!hasCurb) emitRibbon('asphalt', -w2, w2, 0);
    else {
      const sA0 = r.nodeA ? r.nodeA.stubs.find((s) => s.r === r && s.end === 0) : null;
      const sB0 = r.nodeB ? r.nodeB.stubs.find((s) => s.r === r && s.end === 1) : null;
      const gA = sA0 && r.nodeA.stubs.length > 1 ? (sA0.mouth ?? r.nodeA.radius + 2.6) : 0;
      const gB = sB0 && r.nodeB.stubs.length > 1 ? (sB0.mouth ?? r.nodeB.radius + 2.6) : 0;
      // junction boxes: full width, 4 mm UNDER the cap fan that covers the same area at the
      // road datum — coplanar until 2026-09-04, the shimmer on every intersection mouth
      emitStrip('asphalt', -w2, w2, 0, gA, -0.014);
      emitStrip('asphalt', -w2, w2, L - gB, L, -0.014);
      // 6 mm above the road datum: the gutter strip tied exactly with the cap-fan asphalt over
      // 74-76 m2 per junction (zfight.md L1) — the loudest curb-side flicker in the film
      emitStrip('gutter', -w2, -w2 + GUT, gA, L - gB, 0.006);
      emitStrip('gutter', w2 - GUT, w2, gA, L - gB, 0.006);
      const bus = r.bus && w2 - GUT > 4.5 ? r.bus : null;
      if (!bus) emitStrip('asphalt', -w2 + GUT, w2 - GUT, gA, L - gB);
      else {
        const BUSW = 3.35, PARK = 2.45;                       // 11 ft lane, 8 ft parking lane (offset type)
        const padX = XW_DEPTH(r.rclass, r.width) + 2.5;       // XW11 crosswalk + stop bar: plain asphalt
        const bA = gA > 0 ? gA + padX : 0, bB = gB > 0 ? L - gB - padX : L;
        const o1 = bus.lt === 'offset' ? w2 - PARK : w2 - GUT, o0 = o1 - BUSW;   // +n side lane edges (outer, inner)
        const hasR = bus.sides.includes(1), hasL = bus.sides.includes(-1);
        emitStrip('asphalt', -w2 + GUT, w2 - GUT, gA, bA);
        emitStrip('asphalt', -w2 + GUT, w2 - GUT, bB, L - gB);
        if (bB - bA > 6) {
          let lo = -w2 + GUT;
          if (hasL) {
            if (bus.lt === 'offset') emitStrip('asphalt', lo, -o1, bA, bB);
            emitStrip('busred', -o1, -o0, bA, bB);
            emitStrip('paintW', -o0 - 0.05, -o0 + 0.05, bA, bB, 0.024);
            lo = -o0;
          }
          emitStrip('asphalt', lo, hasR ? o0 : w2 - GUT, bA, bB);
          if (hasR) {
            emitStrip('paintW', o0 - 0.05, o0 + 0.05, bA, bB, 0.024);
            emitStrip('busred', o0, o1, bA, bB);
            if (bus.lt === 'offset') emitStrip('asphalt', o1, w2 - GUT, bA, bB);
          }
          // "BUS ONLY" legends (NYC DOT): white stencil letters side by side ACROSS
          // the lane, 2.4 m tall, read by the approaching driver — BUS nearest,
          // ONLY ahead; every ~60 m and after each crosswalk zone. 5x7 glyphs as
          // paint quads (~95 per legend). Street audit round 3 request #3.
          if (bB - bA > 30) {
            // FHWA Series C outlines drawn as MUTCD elongated pavement letters: 8 ft (2.44 m) tall,
            // compressed to 42 % width so "ONLY" spans ~3.0 m of an 11 ft lane. Glyph +y (up) = ahead
            // along travel (dirSign), glyph +x = the driver's right; the first letter sits on the
            // driver's left. (Replaces the 5x7 bitmap squares of the first pass — 2026-09-04 review.)
            const legend = (dStart, dirSign, off) => {
              word('BUS', dStart, dirSign, off);
              word('ONLY', dStart + dirSign * (LH + 1.5), dirSign, off);
            };
            const laneMid = (o0 + o1) / 2;
            if (hasR) for (let d = bA + 10; d < bB - 14; d += 60) legend(d, 1, laneMid);
            if (hasL) for (let d = bB - 10; d > bA + 14; d -= 60) legend(d, -1, -laneMid);
          }
        } else emitStrip('asphalt', -w2 + GUT, w2 - GUT, bA, bB);
      }
    }
    if (r.lA > 0 || r.lB > 0) {
      // elevated viaduct: enclose the deck (visible from below/side) + guard walls
      for (let i = 0; i < P.length - 1; i++) {
        const [x1, y1, z1, dx1, dz1] = P[i], [x2, y2, z2, dx2, dz2] = P[i + 1];
        // only enclose genuinely raised spans (ramps stay open at their grade ends)
        const g1 = sampleTerrain(x1, z1), g2 = sampleTerrain(x2, z2);
        if (y1 - g1 < 2.5 && y2 - g2 < 2.5) continue;
        const n1 = [-dz1, dx1], n2 = [-dz2, dx2];
        const t = tileFor((x1 + x2) / 2, (z1 + z2) / 2);
        const G = 1.5; // girder depth
        for (const s of [1, -1]) {
          // side skirt (faces outward)
          pushQuad(t.curb,
            [x1 + n1[0] * w2 * s, y1 - G, z1 + n1[1] * w2 * s], [x1 + n1[0] * w2 * s, y1, z1 + n1[1] * w2 * s],
            [x2 + n2[0] * w2 * s, y2, z2 + n2[1] * w2 * s], [x2 + n2[0] * w2 * s, y2 - G, z2 + n2[1] * w2 * s]);
          // guard wall
          pushQuad(t.curb,
            [x1 + n1[0] * (w2 - 0.35) * s, y1, z1 + n1[1] * (w2 - 0.35) * s], [x1 + n1[0] * (w2 - 0.35) * s, y1 + 1.05, z1 + n1[1] * (w2 - 0.35) * s],
            [x2 + n2[0] * (w2 - 0.35) * s, y2 + 1.05, z2 + n2[1] * (w2 - 0.35) * s], [x2 + n2[0] * (w2 - 0.35) * s, y2, z2 + n2[1] * (w2 - 0.35) * s]);
          pushQuad(t.curb,
            [x2 + n2[0] * (w2 - 0.35) * s, y2, z2 + n2[1] * (w2 - 0.35) * s], [x2 + n2[0] * (w2 - 0.35) * s, y2 + 1.05, z2 + n2[1] * (w2 - 0.35) * s],
            [x1 + n1[0] * (w2 - 0.35) * s, y1 + 1.05, z1 + n1[1] * (w2 - 0.35) * s], [x1 + n1[0] * (w2 - 0.35) * s, y1, z1 + n1[1] * (w2 - 0.35) * s]);
        }
        // underside (faces down)
        pushQuad(t.curb,
          [x1 - n1[0] * w2, y1 - G, z1 - n1[1] * w2], [x1 + n1[0] * w2, y1 - G, z1 + n1[1] * w2],
          [x2 + n2[0] * w2, y2 - G, z2 + n2[1] * w2], [x2 - n2[0] * w2, y2 - G, z2 - n2[1] * w2]);
      }
    }
    if (r.level === 0 && r.rclass !== 3 && r.rclass !== 4) {
      const sw = r.rclass === 2 ? 4.6 : 3.6;
      // sidewalks trimmed at the junction mouths (corner bands take over from there)
      const stubA = nA ? nA.stubs.find((s) => s.r === r && s.end === 0) : null;
      const stubB = nB ? nB.stubs.find((s) => s.r === r && s.end === 1) : null;
      const trimA = stubA && nA.stubs.length > 1 ? (stubA.mouth ?? nA.radius + 2.6) : 0;
      const trimB = stubB && nB.stubs.length > 1 ? (stubB.mouth ?? nB.radius + 2.6) : 0;
      // XW11: longitudinal lane paint (centre line, lane dashes, parking lines, bike lane) starts
      // where the stop bar ends — mouth + 0.35 + XW + 1.2 + 0.61. With the NYC crossing depth the
      // old fixed 3.8 m trim would have run the double yellow 2.65 m into the ladder.
      const xwPad = XW_DEPTH(r.rclass, r.width) + 2.2;
      // Straight sidewalks: analytic strips, each sample's width clamped by the
      // directional clearance march so the band can NEVER lie on another road's
      // carriageway (the pavement rule), tapering where parallels overlap.
      const Ltot = L;
      if (!CONTOUR_WALKS && Ltot > trimA + trimB + 2) {
        const Psw = [];
        for (let d = trimA; d <= Ltot - trimB + 0.01; d += step) {
          const dd = Math.min(d, Ltot);
          const [x, z, dx, dz] = alongPolyline(r.pts, dd);
          Psw.push([x, roadY(r, x, z, dd, Ltot), z, dx, dz]);
        }
        const last = alongPolyline(r.pts, Ltot - trimB);
        Psw.push([last[0], roadY(r, last[0], last[1], Ltot - trimB, Ltot), last[1], last[2], last[3]]);
        for (const side of [-1, 1]) {
          for (let i = 0; i < Psw.length - 1; i++) {
            const [x1, y1, z1, dx1, dz1] = Psw[i], [x2, y2, z2, dx2, dz2] = Psw[i + 1];
            if (x1 === x2 && z1 === z2) continue;
            const n1 = [-dz1 * side, dx1 * side], n2 = [-dz2 * side, dx2 * side];
            const t = tileFor((x1 + x2) / 2, (z1 + z2) / 2);
            const sw1 = Math.max(0, paveClearDir(x1 + n1[0] * w2, z1 + n1[1] * w2, y1, n1[0], n1[1], sw, [r]));
            const sw2 = Math.max(0, paveClearDir(x2 + n2[0] * w2, z2 + n2[1] * w2, y2, n2[0], n2[1], sw, [r]));
            if (sw1 < 0.7 && sw2 < 0.7) continue; // no room (or curb line inside another road)
            // outer edge follows terrain, position-deterministic so overlapping parallel
            // carriageway sidewalks stay exactly coplanar (no z-fight)
            const ox1 = x1 + n1[0] * (w2 + sw1), oz1 = z1 + n1[1] * (w2 + sw1);
            const ox2 = x2 + n2[0] * (w2 + sw2), oz2 = z2 + n2[1] * (w2 + sw2);
            const oy1 = groundYOnLand(ox1, oz1, 0.28);
            const oy2 = groundYOnLand(ox2, oz2, 0.28);
            const a = [x1 + n1[0] * w2, y1 + CURB, z1 + n1[1] * w2];
            const b = [ox1, oy1, oz1];
            const c = [ox2, oy2, oz2];
            const d = [x2 + n2[0] * w2, y2 + CURB, z2 + n2[1] * w2];
            pushQuad(t.sidewalk, a, d, c, b);
            // curb face
            const a2 = [x1 + n1[0] * w2, y1, z1 + n1[1] * w2];
            const d2 = [x2 + n2[0] * w2, y2, z2 + n2[1] * w2];
            pushQuad(t.curb, a2, d2, [d[0], d[1], d[2]], [a[0], a[1], a[2]]);
          }
        }
      }
      // lane paint. NYC leaves local streets UNMARKED: no centre line, no lane
      // dashes, no parking-lane line on a 30-40 ft two-way residential street
      // (W 122nd, the Bedford Ave side streets, Montague — every local street in
      // the Street View set). Centre/lane paint only on wide roadways (rclass 2),
      // highways and the odd 41+ ft local; arrows and bike lanes keep their gates.
      if (r.rclass <= 3 && r.width >= 7) {
        // NYC's standard 40 ft street is 12.19 m: 12.5 missed it by 31 cm and left
        // Broadway's and Lenox's carriageways bare (critic round 2). Divided-avenue
        // carriageways are one-way, so they get lane dashes and no centre line.
        const marked = r.rclass === 2 || r.rclass === 3 || r.width >= 12.0 || !!r.divided;
        const lanes = Math.max(1, r.lanes);
        const laneW = (r.width - (r.park > 0 ? r.park * 2.4 : 0)) / lanes;
        // longitudinal paint strip clamped to exact arc distances — quads are
        // 6-14m long, so midpoint-skipping let half-quads stab into the junction
        // box (yellow lines through crosswalks); clamp geometry instead
        const paintStrip = (kind, off, halfT, yl, lo, hi) => {
          lo = Math.max(lo, 0.2); hi = Math.min(hi, L - 0.2);
          if (hi - lo < 0.6) return;
          for (let d = lo; d < hi; d += step) {
            const d2 = Math.min(d + step, hi);
            const [xa, za, dxa, dza] = alongPolyline(r.pts, d);
            const [xb, zb, dxb, dzb] = alongPolyline(r.pts, d2);
            const ya = roadY(r, xa, za, d, L) + yl, yb = roadY(r, xb, zb, d2, L) + yl;
            const t = tileFor((xa + xb) / 2, (za + zb) / 2);
            const buf = kind === 'Y' ? t.paintY : kind === 'G' ? t.paintG : t.paintW;
            // RG44: paint never on another road's carriageway (ramps laid over each other: a centre line ran across the
            // Lincoln Tunnel approach's lanes)
            if (RC44 && inCarriageway((xa + xb) / 2 - ((dza + dzb) / 2) * off, (za + zb) / 2 + ((dxa + dxb) / 2) * off, (ya + yb) / 2, [r], -0.3)) continue;
            pushQuad(buf,
              [xa - dza * (off - halfT), ya, za + dxa * (off - halfT)],
              [xa - dza * (off + halfT), ya, za + dxa * (off + halfT)],
              [xb - dzb * (off + halfT), yb, zb + dxb * (off + halfT)],
              [xb - dzb * (off - halfT), yb, zb + dxb * (off - halfT)]);
          }
        };
        // center double-yellow when two-way — stops behind the stop bars
        if (marked && r.oneway === 0) {
          for (const off of [-0.18, 0.18]) paintStrip('Y', off, 0.06, 0.026, trimA + xwPad, L - trimB - xwPad);   // XW11   // zfight.md L6
        }
        // NYC LANE MODEL — the same layout the traffic sim drives (src/sim/traffic.js _laneOffsetAt):
        // the parking lanes in use come off the width (2.3 m each), 0.6 m of kerb clearance, lane width
        // capped at 3.4 m, lanes laid out from the CENTRE (two-way: (0.5 + k) * laneW right of the
        // centreline per direction; one-way: (k - (lanes-1)/2) * laneW), single-side parking shifts the
        // band 1.15 m away from the parked kerb. The old paint laid lanes from the left kerb with one
        // 2.4 m parking lane regardless of side, so arrows and dashes sat up to half a lane off the cars
        // ("turn markings aren't in the right positions and lanes", owner 2026-09-11).
        const parkWm = (r.park | 0) >= 2 ? 4.6 : (r.park | 0) ? 2.3 : 0;
        const usableM = Math.max(3, r.width - parkWm - 0.6);
        const laneWm = Math.min(3.4, usableM / Math.max(1, lanes));
        const lanesDirM = r.oneway !== 0 ? lanes : Math.max(1, Math.floor(lanes / 2));
        const parkShift = (dirSign) => ((r.park | 0) === 1 ? -((((r.segId || 0) % 2) ? 1 : -1) * dirSign * 1.15) : 0);   // right-of-travel metres
        // lane k (0 = leftmost lane of travel) centre, as an offset along the polyline's LEFT normal
        // LA13 (critic r13): paint offsets are measured on the A->B LEFT normal (paintStrip: x - dz*off, z + dx*off), where
        // +off is the RIGHT of A->B travel; the sim (_laneOffsetAt + _placeCar) drives on the right, so an approach travelling
        // with dirSign has its lanes at +dirSign*(...). The old leading minus painted every lane-use arrow in the OPPOSING lanes
        // (a BUS ONLY legend facing one way with a through arrow pointing the other in the same red lane, markings125).
        const laneOffT = (k, dirSign) => dirSign * ((r.oneway !== 0 ? (k - (lanes - 1) / 2) * laneWm : (0.5 + k) * laneWm) + parkShift(dirSign));
        // dashed white lane lines between adjacent lanes of one direction
        const laneLines = [];
        if (marked) {
          if (r.oneway !== 0) { for (let k = 1; k < lanes; k++) laneLines.push(r.oneway * ((k - lanes / 2) * laneWm + parkShift(r.oneway))); }   // LA13 sign
          else for (const ds of [1, -1]) for (let k = 1; k < lanesDirM; k++) laneLines.push(ds * (k * laneWm + parkShift(ds)));   // LA13 sign
        }
        for (const off of laneLines) {
          for (let d = Math.max(4, trimA + xwPad); d + 2.4 < L - Math.max(4, trimB + xwPad); d += 7.5) {   // XW11
            const [x, z, dx, dz] = alongPolyline(r.pts, d);
            const y = roadY(r, x, z, d, L) + 0.024;   // lane dashes: zfight.md L4
            const nx = -dz, nz = dx;
            const t = tileFor(x, z);
            pushQuad(t.paintW,
              [x + nx * (off - 0.06), y, z + nz * (off - 0.06)],
              [x + nx * (off + 0.06), y, z + nz * (off + 0.06)],
              [x + dx * 2.4 + nx * (off + 0.06), y, z + dz * 2.4 + nz * (off + 0.06)],
              [x + dx * 2.4 + nx * (off - 0.06), y, z + dz * 2.4 + nz * (off - 0.06)]);
          }
        }
        // NYC lane-use arrows (MUTCD 8 ft turn arrows) on signalized approaches:
        // inner lane gets a LEFT arrow, outer lane a RIGHT arrow, twice (4 m and
        // 12 m behind the stop bar). Two-way: lanes left of centre travel A->B.
        {
          const upTriW = (buf, A3, B3, C3) => { // enforce +y-facing winding
            if (allPulled(A3, B3, C3) || triTooBig(A3, B3, C3)) return; // chords over water
            if ((B3[2] - A3[2]) * (C3[0] - A3[0]) - (B3[0] - A3[0]) * (C3[2] - A3[2]) < 0) { const T = B3; B3 = C3; C3 = T; }
            pushTri(buf, A3[0], A3[1], A3[2], B3[0], B3[1], B3[2], C3[0], C3[1], C3[2]);
          };
          const arrow = (dAlong, off, dirSign, turn) => {
            if (dAlong < trimA + 6 || dAlong > L - trimB - 6) return;
            const [x0, z0, dx0, dz0] = alongPolyline(r.pts, dAlong);
            const tx = dx0 * dirSign, tz = dz0 * dirSign;          // travel direction
            // LA14 (critic r13 / final_v19 crop): in this frame (x east, z south) the LEFT of travel (tx,tz) is (tz,-tx); the
            // old (-tz,tx) was the RIGHT, so the MUTCD asset (+y = driver's left) rendered mirrored — right-turn arrows as left hooks.
            const lx = tz, lz = -tx;                                  // left of travel
            const bx = x0 - dz0 * off, bz = z0 + dx0 * off;           // lane centre (global left normal)
            const y = roadY(r, x0, z0, dAlong, L) + 0.032;   // over the lane paint (+0.024): zfight.md L5
            const P = (u, v) => [bx + tx * u + lx * v, y, bz + tz * u + lz * v];
            const t = tileFor(bx, bz);
            // real MUTCD outlines (Figure 3B-24): B = 8 ft turn arrow, A = 9.5 ft through arrow.
            // The asset is drawn as a LEFT turn with +v = driver's left; turn = -1 left, +1 right,
            // 0 through. Tail at u = 0, head toward the junction (+u = travel).
            const shape = turn === 0 ? MUTCD_ARROWS.through : MUTCD_ARROWS.turn;
            const sgn = turn > 0 ? -1 : 1;
            // centre the arrow's BOUNDING BOX on the lane centre, not its shaft: the turn arrow's
            // head reaches 1.5 m to the turn side, so a shaft-centred arrow sat against the lane
            // line ("turn arrows are not centred on their lanes", owner review 2026-09-04)
            let vMin = 1e9, vMax = -1e9;
            for (const [, v] of shape.ring) { const vv = v * sgn; if (vv < vMin) vMin = vv; if (vv > vMax) vMax = vv; }
            const vShift = -(vMin + vMax) / 2;
            const flat = [];
            for (const [u, v] of shape.ring) flat.push(u, v * sgn + vShift);
            const idx = earcut(flat);
            for (let i = 0; i < idx.length; i += 3) {
              const a = idx[i] * 2, b = idx[i + 1] * 2, c = idx[i + 2] * 2;
              upTriW(t.paintW, P(flat[a], flat[a + 1]), P(flat[b], flat[b + 1]), P(flat[c], flat[c + 1]));
            }
          };
          const sigA = nA && nA.signal && nA.stubs.length >= 3, sigB = nB && nB.signal && nB.stubs.length >= 3;
          // XW11: the stop bar is at mouth + 0.35 + XW + 1.2 and is 0.61 wide, i.e. its far edge is at
          // trim + xwPad — the arrows (6 m and 18 m further back, lanes untouched) follow the real bar
          const stopB = L - trimB - xwPad, stopA = trimA + xwPad;     // stop bar positions along the road
          // Which movements exist at the node for an approach heading (hx, hz): an arm counts as a
          // left / right / through exit when it can be ENTERED from here — two-way, or a one-way
          // leading away from the node (a one-way pointing at us is not a legal turn), at grade, a
          // vehicular road. cross > 0 is a right turn in this frame (x east, z south).
          const exitsAt = (n, hx, hz) => {
            const ex = { left: false, right: false, through: false };
            for (const s of n.stubs) {
              if (s.r === r || s.level !== 0 || s.rclass >= 5 || s.r.noGeom || s.r.noTraffic) continue;
              const ow = s.r.oneway | 0;
              if (ow !== 0 && ow !== (s.end === 0 ? 1 : -1)) continue;   // one-way toward the node: no entry
              const cr = hx * s.dirz - hz * s.dirx, dt = hx * s.dirx + hz * s.dirz;
              if (dt > 0.7) ex.through = true; else if (cr > 0.4) ex.right = true; else if (cr < -0.4) ex.left = true;
            }
            return ex;
          };
          // NYC DOT lane-use arrows: only on signalised approaches with at least two lanes in the
          // direction of travel, only for turns that exist, LEFT in the leftmost lane, RIGHT in the
          // rightmost (a kerbside bus lane is the right-turn lane too), THROUGH in the middle lanes
          // of a 3+ lane approach once both turn lanes are marked; two sets, 6 m and 18 m before the
          // stop bar. Everything else (1 lane per direction, T-junctions with no turn) stays bare,
          // which is what Harlem's side streets look like.
          const approachArrows = (node, stopD, dirSign) => {
            if (!node || lanesDirM < 2) return;
            const [, , dxE, dzE] = alongPolyline(r.pts, dirSign > 0 ? Math.max(0.2, L - 0.5) : Math.min(L - 0.2, 0.5));
            const hx = dxE * dirSign, hz = dzE * dirSign;
            const ex = exitsAt(node, hx, hz);
            // MK14 (critic r14 #4/#5; the reference oblique): NYC marks the LEFT-turn lane of a two-way avenue with
            // the arrow and the word ONLY UPSTREAM of it — the driver reads ONLY first, then the arrow nearer the stop bar
            // (the amst120 reference, z_e_road.png: ONLY / arrow / ONLY / arrow up the lane); RIGHT-turn arrows
            // are rare — only where the through movement does not exist (a forced turn) or on a wide one-way (3+ lanes).
            // Two adjacent lanes hooking opposite ways, and a turn arrow inside a kerbside bus lane, were both wrong.
            const rightArrow = ex.right && (!ex.through || (r.oneway !== 0 && lanesDirM >= 3));
            const only = ex.left && r.oneway === 0 && lanesDirM >= 2;
            if (!ex.left && !rightArrow) return;
            for (const back of [6, 18]) {
              const d = stopD - dirSign * back;
              if (ex.left) {
                arrow(d, laneOffT(0, dirSign), dirSign, -1);
                if (only) word('ONLY', d - dirSign * (2.44 + 1.2), dirSign, laneOffT(0, dirSign));   // 2.44 m word, top 1.2 m behind the arrow's tail
              }
              if (rightArrow) arrow(d, laneOffT(lanesDirM - 1, dirSign), dirSign, 1);
              if (lanesDirM >= 3 && ex.left && rightArrow && ex.through) for (let k = 1; k < lanesDirM - 1; k++) arrow(d, laneOffT(k, dirSign), dirSign, 0);
            }
          };
          if (sigB && (r.oneway >= 0)) approachArrows(nB, stopB, 1);
          if (sigA && (r.oneway <= 0)) approachArrows(nA, stopA, -1);
        }
        // solid parking-lane lines (marked roadways only)
        if (marked && r.park > 0) {
          const sides = r.park >= 2 ? [-1, 1] : [(r.segId % 2) ? 1 : -1];
          for (const sgn of sides) {
            paintStrip('W', sgn * (r.width / 2 - 2.4), 0.05, 0.024, trimA + xwPad, L - trimB - xwPad);   // XW11
          }
        }
        // NYC bike lanes (CSCL bike_lane class codes): only a CLASS I (protected / greenway) lane
        // gets the green surface. A Class II conventional lane is a white edge line on plain asphalt
        // (Amsterdam Ave at W 120th, the reference views, owner
        // 2026-09-15: no green anywhere on the avenue), and Class III is sharrows — no lane at all.
        // CSCL codes: 1 = I, 2 = II, 3 = III, 4 = links, 5 = I+II, 6 = II+III, 8 = I+III, 9 = II+I.
        // codes 10 (III+II) and 11 (III+I) carry a lane too; 3 (III sharrows), 4 (links) and 7 (stairs) do not.
        // Amsterdam Ave at W 120th is code 2 both ways (CSCL streets_1.geojson, checked 2026-09-15).
        if (r.bike >= 1 && r.bike <= 11 && r.rclass <= 2 && r.bike !== 3 && r.bike !== 4 && r.bike !== 7) {
          const bw = 1.5;
          const protectedLane = r.bike === 1 || r.bike === 5 || r.bike === 8 || r.bike === 11;
          const sides = r.oneway !== 0 ? [r.oneway] : [-1, 1];
          for (const sgn of sides) {
            const off = sgn * (r.width / 2 - (r.park > 0 ? 2.4 : 0) - bw / 2 - 0.25);
            if (protectedLane) paintStrip('G', off, bw / 2, 0.022, trimA + xwPad, L - trimB - xwPad);   // zfight.md L7, XW11 trim
            // the lane's travel-side line is a solid 6 in (15 cm) white stripe — at 8 cm it vanished a lane away (critic 2026-09-15)
            paintStrip('W', off - bw / 2 - 0.10, 0.075, 0.024, trimA + xwPad, L - trimB - xwPad);
          }
        }
      }
    }
    // at-grade highway/ramp portions: curb strips frame the corridor where it
    // cuts through pedestrian areas (gores read as raw wedges otherwise)
    if (r.level === 0 && (r.rclass === 3 || r.rclass === 4)) {
      for (const side of [-1, 1]) {
        for (let d0 = 2; d0 < L - 2; d0 += 4) {
          const d1 = Math.min(d0 + 4, L - 2);
          const [xa, za, dxa, dza] = alongPolyline(r.pts, d0);
          const [xb, zb, dxb, dzb] = alongPolyline(r.pts, d1);
          const ya = roadY(r, xa, za, d0, L), yb = roadY(r, xb, zb, d1, L);
          if (ya - sampleTerrain(xa, za) > 1.0 || yb - sampleTerrain(xb, zb) > 1.0) continue; // lifted
          const ax2 = xa - dza * side * w2, az2 = za + dxa * side * w2;
          const bx2 = xb - dzb * side * w2, bz2 = zb + dxb * side * w2;
          if (inCarriageway((ax2 + bx2) / 2, (az2 + bz2) / 2, (ya + yb) / 2, [r])) continue;
          // RG44: nor either end (a 4 m kerb whose middle missed a crossing ramp ran across its lanes)
          if (RC44 && (inCarriageway(ax2, az2, ya, [r], -0.3) || inCarriageway(bx2, bz2, yb, [r], -0.3))) continue;
          const t = tileFor((ax2 + bx2) / 2, (az2 + bz2) / 2);
          pushQuad(t.curb, [ax2, ya, az2], [bx2, yb, bz2], [bx2, yb + CURB, bz2], [ax2, ya + CURB, az2]);
          pushQuad(t.curb, [bx2, yb, bz2], [ax2, ya, az2], [ax2, ya + CURB, az2], [bx2, yb + CURB, bz2]);
        }
      }
    }
    // elevated viaduct piers (per-point lift so ramps get piers only where raised)
    if ((r.lA > 0 || r.lB > 0) && !r.isBridgePiece) {
      for (let d = 9; d < L - 4; d += 18) {
        const [x, z, dx, dz] = alongPolyline(r.pts, d);
        const lift = roadY(r, x, z, d, L) - sampleTerrain(x, z);
        if (lift < 3) continue;
        const t = tileFor(x, z);
        t.furn.push({ k: 33, x, y: sampleTerrain(x, z), z, rot: Math.atan2(dx, dz), p0: Math.min(255, lift | 0), p1: Math.min(255, r.width | 0) });
      }
    }
  }
  // record polyline for runtime (traffic graph + sidewalk ped paths) — store per tile pieces
  {
    let cur = null, curTile = null;
    const myRecs = []; // pieces of THIS road, in order — first/last carry the end mouths
    const flush = () => {
      if (!cur || cur.length < 2) { cur = null; return; }
      const t = curTile;
      const start = t.roadVerts.n / 3;
      for (const [x, y, z] of cur) t.roadVerts.push(x - t.x0, y, z - t.z0);
      const rec = {
        start, len: cur.length, rclass: r.rclass, oneway: r.oneway, width: r.width, noTraffic: !!r.noTraffic,
        lanes: r.lanes, park: r.park, level: r.level, speed: r.speed,
        nameIdx: nameIdx(t, r.name), segId: r.segId, mouthA: 0, mouthB: 0,
      };
      t.roadRecs.push(rec);
      myRecs.push(rec);
      cur = null;
    };
    // step floor 4 (was 8): a road shorter than the step serialized as ONE
    // point and flush() dropped it — junction connector stubs vanished from
    // the traffic graph entirely
    for (let d = 0; d <= L + 0.01; d += Math.min(20, Math.max(4, L / 2))) {
      const dd = Math.min(d, L);
      const [x, z] = alongPolyline(r.pts, dd);
      const y = roadY(r, x, z, dd, L);
      const t = tileFor(x, z);
      if (t !== curTile) { if (cur) { cur.push([x, y, z]); } flush(); curTile = t; cur = [[x, y, z]]; }
      else cur.push([x, y, z]);
    }
    flush();
    if (myRecs.length) {
      myRecs[0].mouthA = r.mouthA || 0;
      myRecs[myRecs.length - 1].mouthB = r.mouthB || 0;
    }
  }
}

// DEBUG_ROADS=x,z: every road within 20 m of that point with its flags and node assignment
if (process.env.DEBUG_ROADS) {
  const [qx, qz] = process.env.DEBUG_ROADS.split(',').map(Number);
  for (const r of roads) {
    let near = false;
    for (const p of r.pts) if (Math.hypot(p[0] - qx, p[1] - qz) < 20) { near = true; break; }
    if (!near) continue;
    const A = r.pts[0], B = r.pts[r.pts.length - 1];
    console.log('[road]', r.name, 'rc', r.rclass, 'L', polylineLength(r.pts).toFixed(1), 'w', r.width.toFixed(1), 'oneway', r.oneway, 'lanes', r.lanes, 'park', r.park, 'divided', r.divided ?? 0, 'bus', r.bus ? r.bus.lt : '-', 'noGeom', !!r.noGeom, 'jSkip', !!r.jSkip, 'level', r.level,
      'A', A[0].toFixed(1), A[1].toFixed(1), 'nodeA', r.nodeA ? [r.nodeA.x.toFixed(1), r.nodeA.z.toFixed(1), r.nodeA.stubs.length] : null,
      'B', B[0].toFixed(1), B[1].toFixed(1), 'nodeB', r.nodeB ? [r.nodeB.x.toFixed(1), r.nodeB.z.toFixed(1), r.nodeB.stubs.length] : null, 'segId', r.segId);
  }
}
// ---------------------------------------------------------------- intersections: caps, crosswalks, corners, signals, signs
log('intersections');
const XW11 = { xw: 0, bars: 0, std: 0, depth: 0, clamp: 0, stop: 0, skipNT: 0, reg: 0 };   // XW11 census
// coarse grid of junction positions: crosswalks are suppressed when their
// stripe zone would butt into ANOTHER junction (close node pairs on one street)
const NXC = 16, xNodeGrid = new Map();
for (const nn of nodes.values()) {
  if (!(nn.jstubs || []).length || (nn.jstubs || []).length < 2) continue;
  const k = `${Math.floor(nn.x / NXC)}_${Math.floor(nn.z / NXC)}`;
  let a2 = xNodeGrid.get(k); if (!a2) xNodeGrid.set(k, (a2 = []));
  a2.push(nn);
}
const nearOtherNode = (self, px, pz, rad) => {
  const gx = Math.floor(px / NXC), gz = Math.floor(pz / NXC);
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const a2 = xNodeGrid.get(`${gx + dx}_${gz + dz}`);
    if (a2) for (const nn of a2) if (nn !== self && Math.hypot(nn.x - px, nn.z - pz) < rad) return true;
  }
  return false;
};
for (const n of nodes.values()) {
  if (!n.stubs.length) continue;
  const stubs = n.jstubs;
  if (!stubs || !stubs.length) continue;
  const rY = (px, pz) => groundYOnLand(px, pz, 0.145); // ribbon datum +5mm (kills grazing z-fight)
  const upTri = (buf, A3, B3, C3) => { // enforce +y-facing winding
    if (allPulled(A3, B3, C3) || triTooBig(A3, B3, C3)) return; // chords over water
    if ((B3[2] - A3[2]) * (C3[0] - A3[0]) - (B3[0] - A3[0]) * (C3[2] - A3[2]) < 0) { const T = B3; B3 = C3; C3 = T; }
    pushTri(buf, A3[0], A3[1], A3[2], B3[0], B3[1], B3[2], C3[0], C3[1], C3[2]);
  };
  // dead end: no cap disc (used to leave an asphalt blob past the end) —
  // wrap the sidewalk around the road end instead. ONLY when the node is a
  // true dead end: a road continuing elevated (ramp) or via an unmerged twin
  // used to get a sidewalk slab painted straight across live traffic.
  // dead end: wrap the sidewalk around the road end — ONLY at true dead ends
  // (single stub at ANY level; elevated continuations and unmerged twins used
  // to get a slab across live traffic) and never across another carriageway
  if (stubs.length === 1) {
    const s = stubs[0];
    if (!CONTOUR_WALKS && !process.env.SKIP_WRAPS && n.stubs.length === 1 && s.rclass <= 2 && polylineLength(s.r.pts) > 8) {
      const w2 = s.width / 2, sw = s.rclass === 2 ? 4.6 : 3.6;
      const t = tileFor(n.x, n.z);
      const iL = [n.x - s.dirz * w2, n.z + s.dirx * w2], iR = [n.x + s.dirz * w2, n.z - s.dirx * w2];
      const oL = [iL[0] - s.dirx * sw, iL[1] - s.dirz * sw], oR = [iR[0] - s.dirx * sw, iR[1] - s.dirz * sw];
      const yiL = rY(iL[0], iL[1]), yiR = rY(iR[0], iR[1]);
      if (inCarriageway(oL[0], oL[1], yiL, [s.r]) || inCarriageway(oR[0], oR[1], yiR, [s.r])
        || inCarriageway((oL[0] + oR[0]) / 2, (oL[1] + oR[1]) / 2, (yiL + yiR) / 2, [s.r])) continue;
      const A3 = [iL[0], yiL + CURB - 0.005, iL[1]], B3 = [iR[0], yiR + CURB - 0.005, iR[1]];
      const C3 = drapeVert(oR[0], oR[1], 0.28), D3 = drapeVert(oL[0], oL[1], 0.28);
      upTri(t.sidewalk, A3, B3, C3); upTri(t.sidewalk, A3, C3, D3);
      pushQuad(t.curb, [iL[0], yiL - 0.005, iL[1]], [iR[0], yiR - 0.005, iR[1]], B3, A3);
      pushQuad(t.curb, [iR[0], yiR - 0.005, iR[1]], [iL[0], yiL - 0.005, iL[1]], A3, B3);
    }
    continue;
  }

  // --- asphalt cap: true junction polygon (mouth chords + edge runs + curb
  // returns) fanned from the node center, terrain-following per vertex
  const poly = [], chordAt = new Set();
  for (let i = 0; i < stubs.length; i++) {
    const s = stubs[i], w2 = s.width / 2;
    chordAt.add(poly.length); // edge leaving the right-mouth point = mouth chord (no curb)
    poly.push([n.x + s.dirz * w2 + s.dirx * s.mouth, n.z - s.dirx * w2 + s.dirz * s.mouth]);
    const c = n.corners[i];
    for (let j = 0; j < c.pts.length - 1; j++) poly.push(c.pts[j]);
  }
  {
    const cy = rY(n.x, n.z);
    for (let i = 0; i < poly.length; i++) {
      const P1 = poly[i], P2 = poly[(i + 1) % poly.length];
      if (Math.hypot(P2[0] - P1[0], P2[1] - P1[1]) < 0.02) continue;
      const t = tileFor((P1[0] + P2[0] + n.x) / 3, (P1[1] + P2[1] + n.z) / 3);
      upTri(t.asphalt, [n.x, cy, n.z], [P1[0], rY(P1[0], P1[1]), P1[1]], [P2[0], rY(P2[0], P2[1]), P2[1]]);
      // gutter round the corner returns (every non-chord edge is curb): a 0.45 m
      // strip inside the cap edge, 6 mm proud so it wins the coplanar asphalt
      if (!chordAt.has(i)) {
        let gx = -(P2[1] - P1[1]), gz = P2[0] - P1[0];
        const gl = Math.hypot(gx, gz) || 1; gx /= gl; gz /= gl;
        if ((n.x - P1[0]) * gx + (n.z - P1[1]) * gz < 0) { gx = -gx; gz = -gz; }   // inward = toward the node
        const G = 0.45, yg = 0.014;   // corner-return gutter over the cap fan: 6 mm held only to 41 m (zfight.md L2)
        const Q1 = [P1[0], rY(P1[0], P1[1]) + yg, P1[1]], Q2 = [P2[0], rY(P2[0], P2[1]) + yg, P2[1]];
        const Q3 = [P2[0] + gx * G, rY(P2[0] + gx * G, P2[1] + gz * G) + yg, P2[1] + gz * G];
        const Q4 = [P1[0] + gx * G, rY(P1[0] + gx * G, P1[1] + gz * G) + yg, P1[1] + gz * G];
        upTri(t.gutter, Q1, Q2, Q3); upTri(t.gutter, Q1, Q3, Q4);
      }
    }
    // saved for the FIELD pass: the cap polygon is part of the asphalt union
    // (its fillet corners produce the rounded curb returns in the field)
    let bx0 = 1e12, bz0 = 1e12, bx1 = -1e12, bz1 = -1e12;
    for (const p of poly) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
    n.capPoly = poly;
    n.capBox = [bx0, bz0, bx1, bz1];
    n.capY = cy;
    n.capBw = Math.max(...stubs.map((s) => (s.rclass <= 2 ? (s.r.bwMax || (s.rclass === 2 ? 5.0 : 4.2)) : 0)));
  }
  // --- corner curb returns + corner sidewalk bands. Runs on EVERY multi-stub
  // node (2-stub continuation nodes used to trim sidewalks and fill nothing —
  // mid-block gaps wherever CSCL splits a street). Band width blends between
  // the two roads' own sidewalk widths and both ends land exactly on the
  // straight sidewalks' start cross-sections (same mouth, same datum).
  // RULE: pavement never overlaps a carriageway. Clamp each band sample's
  // outward width so the outer edge stays out of every stub's ribbon — acute
  // gores otherwise push full-width sidewalk triangles into the road.
  const clampW = (px, pz, nx, nz, w) => {
    for (const s of stubs) {
      const rx = px - n.x, rz = pz - n.z;
      const perpP = rx * -s.dirz + rz * s.dirx;   // signed lateral vs stub centerline
      const alongP = rx * s.dirx + rz * s.dirz;
      const perpN = nx * -s.dirz + nz * s.dirx;   // lateral rate along the outward ray
      const alongN = nx * s.dirx + nz * s.dirz;
      // hit-test INSIDE the ribbon proper (edge points sit at exactly w2 and
      // must not self-clamp); march from t=0 so a band can never START inside
      const w2s = s.width / 2 - 0.05;
      for (let t = 0; t <= w; t += 0.5) {
        const al = alongP + alongN * t;
        if (al < -2 || al > 80) continue;
        if (Math.abs(perpP + perpN * t) < w2s) { w = Math.max(0, t - 0.65); break; }
      }
      if (w <= 0.05) break;
    }
    return w;
  };
  for (const c of (CONTOUR_WALKS || process.env.SKIP_BANDS ? [] : n.corners)) {
    if (c.A.rclass > 2 && c.B.rclass > 2) continue; // no sidewalks between highways/ramps
    const pts = c.pts;
    const cum = [0];
    for (let j = 1; j < pts.length; j++) cum.push(cum[j - 1] + Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]));
    const total = Math.max(cum[cum.length - 1], 0.01);
    const outN = (j) => {
      const a = pts[Math.max(0, j - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
      let nx = -(b[1] - a[1]), nz = b[0] - a[0];
      const L2 = Math.hypot(nx, nz) || 1; nx /= L2; nz /= L2;
      // "away from the node" is DEGENERATE for edge runs collinear with the
      // node bearing (short links between twin-carriageway junctions): the
      // normal flipped inward and laid bands INSIDE the link road. Flip to
      // move away from the NEAREST stub ribbon instead.
      const rx = pts[j][0] - n.x, rz = pts[j][1] - n.z;
      let bs = null, bd = 1e9;
      for (const s of stubs) {
        const al = rx * s.dirx + rz * s.dirz;
        if (al < -1) continue;
        const pd = Math.abs(Math.abs(rx * -s.dirz + rz * s.dirx) - s.width / 2);
        if (pd < bd) { bd = pd; bs = s; }
      }
      const pn = bs ? nx * -bs.dirz + nz * bs.dirx : 0;
      if (bs && Math.abs(pn) > 1e-6) {
        const pp = rx * -bs.dirz + rz * bs.dirx;
        if (pp * pn < 0) { nx = -nx; nz = -nz; }
      } else if (rx * nx + rz * nz < 0) { nx = -nx; nz = -nz; }
      return [nx, nz];
    };
    // two-pass: clamp widths at every curve point first, then slope-limit so
    // oscillating clamps can't spike thin slivers into the roadway or notch
    // holes into gore islands
    const exR = stubs.map((s2) => s2.r);
    const wArr = [];
    for (let j = 0; j < pts.length; j++) {
      const nj = outN(j);
      let w = c.swA + (c.swB - c.swA) * (cum[j] / total);
      w = clampW(pts[j][0], pts[j][1], nj[0], nj[1], w);
      w = Math.min(w, Math.max(0, paveClearDir(pts[j][0], pts[j][1], rY(pts[j][0], pts[j][1]), nj[0], nj[1], w, exR)));
      wArr.push(w);
    }
    for (let j = 1; j < wArr.length; j++) wArr[j] = Math.min(wArr[j], wArr[j - 1] + 1.2 * (cum[j] - cum[j - 1]));
    for (let j = wArr.length - 2; j >= 0; j--) wArr[j] = Math.min(wArr[j], wArr[j + 1] + 1.2 * (cum[j + 1] - cum[j]));
    for (let j = 0; j < pts.length - 1; j++) {
      const P1 = pts[j], P2 = pts[j + 1];
      const segl = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
      if (segl < 0.03) continue;
      const n1 = outN(j), n2 = outN(j + 1);
      const w1 = wArr[j], w2b = wArr[j + 1];
      if (Math.max(w1, w2b) < 0.8) continue;       // sliver
      if ((w1 + w2b) * 0.5 * segl < 0.25) continue; // degenerate area
      const t = tileFor((P1[0] + P2[0]) / 2, (P1[1] + P2[1]) / 2);
      const y1r = rY(P1[0], P1[1]), y2r = rY(P2[0], P2[1]);
      const I1 = [P1[0], y1r + CURB - 0.005, P1[1]], I2 = [P2[0], y2r + CURB - 0.005, P2[1]];
      const O1p = [P1[0] + n1[0] * w1, P1[1] + n1[1] * w1], O2p = [P2[0] + n2[0] * w2b, P2[1] + n2[1] * w2b];
      const O1 = drapeVert(O1p[0], O1p[1], 0.28), O2 = drapeVert(O2p[0], O2p[1], 0.28);
      upTri(t.sidewalk, I1, I2, O2); upTri(t.sidewalk, I1, O2, O1);
      // curb face both windings (corner travel direction flips halfway)
      pushQuad(t.curb, [P1[0], y1r - 0.005, P1[1]], [P2[0], y2r - 0.005, P2[1]], I2, I1);
      pushQuad(t.curb, [P2[0], y2r - 0.005, P2[1]], [P1[0], y1r - 0.005, P1[1]], I1, I2);
    }
  }
  if (!n.isX) continue;
  // stripes must not paint over corner-band islands (multi-carriageway junctions
  // put a sidewalk island between twin stubs): outward-of-curve + within band width
  const onIsland = (px, pz, s0) => {
    for (const c of n.corners) {
      // the crossing's OWN two corner returns are never an island: with 3.4-4.6 m
      // fillets their curves curl along the stub and flagged the last ~2 m of
      // every wide crossing, so bars stopped short of the curb ramps (critic R3
      // "crosswalk registration") and the dome plates lost their ends
      if (s0 && (c.A === s0 || c.B === s0)) continue;
      const wMax = Math.max(c.swA, c.swB) + 0.25;
      const cp = c.pts;
      for (let j = 1; j < cp.length; j++) {
        const dx = cp[j][0] - cp[j - 1][0], dz = cp[j][1] - cp[j - 1][1], L2 = dx * dx + dz * dz || 1e-9;
        const tRaw = ((px - cp[j - 1][0]) * dx + (pz - cp[j - 1][1]) * dz) / L2;
        // only points that project INSIDE a curb-return segment can be outward of
        // that curve. A clamped projection (point past the polyline's end) used to
        // flag the whole crosswalk zone of any leg whose mouth meets the corner's
        // end — every Lenox Ave leg at 125th St lost its crosswalk that way.
        if (tRaw <= 0.02 || tRaw >= 0.98) continue;
        const tt = tRaw;
        const qx = cp[j - 1][0] + dx * tt, qz = cp[j - 1][1] + dz * tt;
        const dd = Math.hypot(px - qx, pz - qz);
        if (dd >= wMax) continue;
        const ol = Math.hypot(qx - n.x, qz - n.z) || 1;
        if (((px - qx) * (qx - n.x) + (pz - qz) * (qz - n.z)) / ol > -0.05) return true;
      }
    }
    return false;
  };
  // DEBUG_NODE=x,z logs every crosswalk decision at the junction nearest that point
  const DBG = process.env.DEBUG_NODE ? process.env.DEBUG_NODE.split(',').map(Number) : null;
  const dbgHere = DBG && Math.hypot(n.x - DBG[0], n.z - DBG[1]) < 25;
  if (dbgHere) console.log('[xwalk] node', n.x.toFixed(1), n.z.toFixed(1), 'signal', n.signal, 'stubs', stubs.map((s) => (s.name || '?') + ' rc' + s.rclass + ' w' + s.width.toFixed(1) + ' m' + (s.mouth ?? 0).toFixed(1) + ' end' + s.end).join(' | '));
  // XW11 registration: the two legs of ONE street through a junction are painted at the
  // SAME distance from the node, so opposite crossings line up (critic rounds 2-5, "the
  // east and west crossings sit at visibly different distances from the junction centre").
  // Only when the two mouths are within 1 m of each other: a bigger gap means genuinely
  // different geometry (a skew leg), and streetNYC.js places the runtime curb ramps from the
  // RAW mouth in the tile record, so a large shift would decouple the ramps from the ladder.
  const xOff = new Map();
  for (const s of stubs) xOff.set(s, s.mouth ?? 0);
  for (let i = 0; i < stubs.length; i++) for (let j = i + 1; j < stubs.length; j++) {
    const a = stubs[i], b = stubs[j];
    if (a.dirx * b.dirx + a.dirz * b.dirz > -0.94) continue;           // not an opposite pair
    const ma = a.mouth ?? 0, mb = b.mouth ?? 0;
    if (Math.abs(ma - mb) > 1.0) continue;                            // cap: runtime curb ramps still key off the RAW mouth
    if (Math.abs(ma - mb) > 0.05) XW11.reg++;
    xOff.set(a, Math.max(ma, mb)); xOff.set(b, Math.max(ma, mb));
  }
  // --- crosswalks: at each walkable stub's own mouth, on its own ribbon
  // (contained in asphalt by construction; skips highways/ramps)
  for (const s of stubs) {
    if (s.rclass > 2) { if (dbgHere) console.log('[xwalk]  skip rclass', s.name); continue; }
    // XW11: no crossing, stop bar or warning plate on a ribbon that carries no traffic
    // (pedestrianised Wall St / the Times Square plaza, rclass 2 + noTraffic) or whose
    // ground another surface owns (noGeom, the Columbia brick mall)
    if (s.r.noTraffic || s.r.noGeom) { XW11.skipNT++; if (dbgHere) console.log('[xwalk]  skip noTraffic/noGeom', s.name); continue; }
    const mRaw = s.mouth ?? 0, w2 = s.width / 2;
    let m = xOff.get(s) ?? mRaw;                     // XW11: registered offset (see above)
    const Lr = polylineLength(s.r.pts);
    // twin-node link (the cross street's short piece between a divided avenue's two
    // carriageway nodes, e.g. 125th between the Lenox nodes): no crossing, stop bar
    // or warning plates in the median gap — the real crossings sit at the outer curbs
    if (Lr < 20 && s.r.nodeA && s.r.nodeB && s.r.nodeA !== s.r.nodeB && (s.r.nodeA.stubs || []).length >= 3 && (s.r.nodeB.stubs || []).length >= 3) { if (dbgHere) console.log('[xwalk]  skip twin-node link', s.name); continue; }
    // NYC DOT high-visibility ("continental") crosswalk: bars only, NO transverse framing lines —
    // every crossing in the Street View set (5th/42, Amsterdam/116, 125th/ACP, 122nd/MMPW,
    // Bedford/N 7) is bars only; the old rails caught a specular line at eye level and read as a
    // raised slab. Unsignalized local/local junctions keep the older "standard" marking on ~40 %
    // of legs: two 12 in transverse lines, no bars.
    // XW11: depth from XW_DEPTH (25 ft on 55 ft+ roadways, 15 ft elsewhere — measured on
    // ref_lenox.png), clamped so the ladder plus its stop bar still fit between this mouth and
    // the far node's mouth.
    let XW = XW_DEPTH(s.rclass, s.width);
    {
      const far = s.end === 0 ? s.r.nodeB : s.r.nodeA;
      const fst = far ? (far.stubs || []).find((q) => q.r === s.r && q.end !== s.end) : null;
      const mFar = fst && (far.stubs || []).length > 1 ? (fst.mouth ?? 0) : 0;
      const avail = Lr - m - mFar - 1.8;
      if (avail < XW) { XW = Math.max(3.05, avail); XW11.clamp++; }
    }
    // XW11: the registered offset may never push the stop bar into the lane arrows. The first
    // arrow set is anchored 11.6 m back from the RAW mouth and the MUTCD through arrow is 2.90 m
    // long, so its head reaches mouth+8.70; the stop bar's far edge is m + XW + 2.16 and must
    // stay 0.3 m behind it.
    m = Math.min(m, mRaw + Math.max(0, 6.24 - XW));
    const cx = n.x + s.dirx * (m + 0.35), cz = n.z + s.dirz * (m + 0.35);
    // XW11 bar + gap MEASURED on ref_lenox.png: autocorrelation of the paint across both ladders
    // at 125th & Lenox gives a pitch of 7.0-7.3 px N-S (8.2 px/m) and 8.78 px E-W (9.3 px/m) =
    // 0.86-0.94 m, with a ~50 % duty cycle -> 18 in bars at 18 in gaps, not 24 + 24. At 0.92 m the
    // compiler now lays 20 bars across W 125 ST and 10 across a Lenox carriageway; the reference
    // plate has 21-22 and 10.
    const BAR = 0.46, PITCH = 0.92, EDGE = 0.3;
    const standardXW = !n.signal && s.rclass === 1 && hash2(n.x | 0, n.z | 0) < 0.4;
    // skip only when ANOTHER junction's zone overlaps this crosswalk (its centre
    // within half a crossing + 1.6 m): the old 7.5 m test around the stripe zone
    // also killed every crosswalk facing the twin node of a median-divided
    // avenue (nodes ~15 m apart), leaving 125th St junctions with one crossing
    const cxw = m + 0.35 + XW / 2;
    if (nearOtherNode(n, n.x + s.dirx * cxw, n.z + s.dirz * cxw, XW / 2 + 1.6)) { if (dbgHere) console.log('[xwalk]  skip nearOtherNode', s.name); continue; }
    const nx = -s.dirz, nz = s.dirx;
    // XW11: kerb line to kerb line. CSCL streetwidth is curb-to-curb (parking lanes
    // included), so the ladder runs the whole roadway less 15 cm of gutter at each kerb
    // (was 30 cm: the bars stopped visibly short of the ramps).
    const halfW = w2 - 0.15;
    const t = tileFor(cx, cz);
    // paint rides the stub's asphalt ribbon: roadY() (the road's smoothed
    // longitudinal profile, which the ribbon itself uses) + 13 mm. Raw-terrain
    // draping put whole crosswalks 6-12 cm UNDER the ribbon wherever the terrain
    // dips between polyline vertices (the east legs at 125th/Lenox, the whole
    // W 122 St junction) — geometry present, nothing visible.
    const along = (px, pz) => {
      const P = s.r.pts; let acc = 0, best = 0, bd = 1e18;
      for (let i = 1; i < P.length; i++) {
        const ax = P[i - 1][0], az = P[i - 1][1], bx = P[i][0], bz = P[i][1];
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1e-9;
        const tt = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / L2));
        const dd = (px - (ax + vx * tt)) ** 2 + (pz - (az + vz * tt)) ** 2;
        if (dd < bd) { bd = dd; best = acc + Math.sqrt(L2) * tt; }
        acc += Math.sqrt(L2);
      }
      return best;
    };
    const pv = (px, pz) => [px, roadY(s.r, px, pz, along(px, pz), Lr) + 0.024, pz];   // crosswalk bars / stop bars: zfight.md L4
    // ladder extent = the longest contiguous island-free interval across the
    // stub (per-stripe skipping left ugly sawtooth edges at complex junctions)
    let oLo = -halfW, oHi = halfW;
    {
      const K = 24;
      let bestLo = 0, bestHi = -1, runLo = 0, inRun = false;
      for (let k2 = 0; k2 <= K; k2++) {
        const o = -halfW + (k2 / K) * halfW * 2;
        const bad = onIsland(cx + nx * o + s.dirx * 1.25, cz + nz * o + s.dirz * 1.25, s);
        if (!bad && !inRun) { inRun = true; runLo = o; }
        if ((bad || k2 === K) && inRun) {
          inRun = false;
          const hiO = bad ? o - (halfW * 2) / K : o;
          if (hiO - runLo > bestHi - bestLo) { bestLo = runLo; bestHi = hiO; }
        }
      }
      if (bestHi - bestLo < 1.2) { if (dbgHere) console.log('[xwalk]  skip island', s.name, bestLo.toFixed(1), bestHi.toFixed(1)); continue; } // island swallows the crossing
      if (dbgHere) console.log('[xwalk]  paint', s.name, 'interval', bestLo.toFixed(1), bestHi.toFixed(1), 'halfW', halfW.toFixed(1));
      oLo = bestLo; oHi = bestHi;
    }
    // XW11: CONSTANT 0.92 m pitch (18 in bar + 18 in gap, measured on ref_lenox.png). The old
    // spread divided the interval by the bar count, so every leg ended up with its own pitch
    // (1.22-1.42 m) and two crossings of one junction never matched (critic r5 "the south crossing
    // has a different bar length AND a different pitch again"). The slack is split evenly, so the
    // ladder is symmetric about the roadway centre and opposite legs register.
    const nStripes = Math.max(1, Math.floor((oHi - oLo - BAR) / PITCH) + 1);   // never overflow the island-free interval
    const barOff = oLo + ((oHi - oLo) - ((nStripes - 1) * PITCH + BAR)) / 2 + BAR / 2;
    XW11.xw++; XW11.depth += XW; if (standardXW) XW11.std++; else XW11.bars += nStripes;
    if (!standardXW) for (let i = 0; i < nStripes; i++) {
      const o = barOff + i * PITCH;
      pushQuad(t.paintW,
        pv(cx + nx * (o - BAR / 2), cz + nz * (o - BAR / 2)),
        pv(cx + nx * (o + BAR / 2), cz + nz * (o + BAR / 2)),
        pv(cx + s.dirx * XW + nx * (o + BAR / 2), cz + s.dirz * XW + nz * (o + BAR / 2)),
        pv(cx + s.dirx * XW + nx * (o - BAR / 2), cz + s.dirz * XW + nz * (o - BAR / 2)));
    }
    if (standardXW) for (const d0 of [0, XW - EDGE]) {
      pushQuad(t.paintW,
        pv(cx + s.dirx * d0 + nx * oLo, cz + s.dirz * d0 + nz * oLo),
        pv(cx + s.dirx * d0 + nx * oHi, cz + s.dirz * d0 + nz * oHi),
        pv(cx + s.dirx * (d0 + EDGE) + nx * oHi, cz + s.dirz * (d0 + EDGE) + nz * oHi),
        pv(cx + s.dirx * (d0 + EDGE) + nx * oLo, cz + s.dirz * (d0 + EDGE) + nz * oLo));
    }
    // detectable-warning plates as a GROUND class (matId 13 red composite / 14
    // cast iron): 1.5 m along the curb x 0.6 m into the walk at both ends of the
    // crossing, 4 mm proud of the flags; the shader draws the 60 mm dome grid with
    // real AA and zero triangles (street audit round 3 request #2). Per-junction
    // variant, same hash as streetNYC's RAMP_POOL: 24 % no plate (older Harlem
    // ramps are plain concrete), 44 % red, 32 % iron. The runtime keeps only the
    // depressed curb nose when a tile carries these sections.
    {
      const hv = Math.abs(Math.sin(n.x * 12.9898 + n.z * 78.233) * 43758.5453) % 1;
      if (hv >= 0.24) {
        const bufN = hv < 0.68 ? 'warn' : 'warnIron';
        const ca = m + 0.35 + XW / 2;                             // ramp centre along the stub (= RAMP_IN)
        const PW = (a, l) => { const px = n.x + s.dirx * a + nx * l, pz = n.z + s.dirz * a + nz * l; return [px, FLAT ? BASE_Y + 0.300 : groundYOnLand(px, pz, 0.284), pz]; };
        for (const sd of [-1, 1]) {
          const l0 = sd * (w2 + 0.07), l1 = sd * (w2 + 0.67);
          if (Math.abs(oLo) < halfW - 0.3 && sd < 0) continue; // crossing cut by an island on this side: no ramp there
          if (Math.abs(oHi) < halfW - 0.3 && sd > 0) continue;
          const tq = tileFor(n.x + s.dirx * ca + nx * l0, n.z + s.dirz * ca + nz * l0);
          upTri(tq[bufN], PW(ca - 0.75, l0), PW(ca + 0.75, l0), PW(ca + 0.75, l1));
          upTri(tq[bufN], PW(ca - 0.75, l0), PW(ca + 0.75, l1), PW(ca - 0.75, l1));
        }
      }
    }
    // stop bar: only on the APPROACH side (o<0 = right of traffic heading into
    // the node), full width on one-way approaches, none on one-way departures
    const app = s.r.oneway === 0 ? 'half' : s.r.oneway === (s.end === 0 ? -1 : 1) ? 'full' : 'none';
    // XW11: stop bars belong to SIGNALISED approaches, plus the stem of an unsignalised T
    // (the leg with no opposite partner — that is the STOP-sign approach in NYC; the through
    // street gets none). Everywhere else the unsignalised local junctions in Harlem carry the
    // ladder and no bar. The length guard now covers the deeper ladder as well.
    const tStem = !n.signal && stubs.length === 3
      && !stubs.some((q) => q !== s && q.dirx * s.dirx + q.dirz * s.dirz < -0.87);
    if (app !== 'none' && (n.signal || tStem) && Lr > m + XW + 2.4) {
      // XW11: the bar spans the TRAVEL lanes — every through, turn and bus lane (critic r4/r5
      // "the red lane has no stop line") but NOT the parking lane: measured on ref_lenox.png the
      // southbound Lenox bar runs 6.6 m of the 9.14 m carriageway and leaves the 2.4 m parking
      // lane bare, ending exactly on the painted parking-lane line (r.width/2 - 2.4).
      let sLoP = -halfW, sHiP = halfW;
      {
        const pk = s.r.park | 0;
        const sides = pk >= 2 ? [-1, 1] : pk ? [((s.r.segId || 0) % 2) ? 1 : -1] : [];
        for (const sgn of sides) {
          const oSide = s.end === 0 ? sgn : -sgn;          // paintStrip's frame -> this stub's frame
          if (oSide > 0) sHiP = Math.min(sHiP, halfW - 2.4); else sLoP = Math.max(sLoP, -halfW + 2.4);
        }
      }
      const sLo = Math.max(oLo, sLoP), sHi = app === 'full' ? Math.min(oHi, sHiP) : Math.min(-0.12, oHi);
      if (sHi - sLo > 0.8) {
        // 24 in stop bar, 4 ft behind the crosswalk (NYC DOT standard; the 0.61 m width is the
        // measured value on ref_lenox.png: 5 px at 8.2 px/m)
        const sb0 = XW + 1.2, sb1 = sb0 + 0.61; XW11.stop++;
        pushQuad(t.paintW,
          pv(cx + s.dirx * sb0 + nx * sLo, cz + s.dirz * sb0 + nz * sLo),
          pv(cx + s.dirx * sb0 + nx * sHi, cz + s.dirz * sb0 + nz * sHi),
          pv(cx + s.dirx * sb1 + nx * sHi, cz + s.dirz * sb1 + nz * sHi),
          pv(cx + s.dirx * sb1 + nx * sLo, cz + s.dirz * sb1 + nz * sLo));
      }
    }
  }
  // corner furniture anchored to the curb-return midpoints
  const rnd = mulberry((hash2(n.x | 0, n.z | 0) * 1e9) | 0);
  let mastAt = 0; // signal masts placed at this node (the corner loop skips cramped corners)
  const DBGM = process.env.DEBUG_NODE ? process.env.DEBUG_NODE.split(',').map(Number) : null;
  const dbgM = DBGM && Math.hypot(n.x - DBGM[0], n.z - DBGM[1]) < 25;
  if (dbgM) console.log('[mast] node', n.x.toFixed(1), n.z.toFixed(1), 'signal', n.signal, 'isX', n.isX, 'corners', n.corners.length, 'stubs', stubs.map((s) => `${s.name || '?'} w${(s.width || 0).toFixed(1)} rc${s.rclass}`).join(' | '));
  for (let i = 0; i < stubs.length; i++) {
    const c = n.corners[i];
    const A = c.A, B2 = c.B;
    if (dbgM) console.log('[mast] corner', i, 'pts', c.pts.length, 'A', A.name, 'rc', A.rclass, 'B', B2.name, 'rc', B2.rclass);
    if (A.rclass > 2 && B2.rclass > 2) continue;
    const pts = c.pts;
    const mj = (pts.length / 2) | 0;
    const ma = pts[Math.max(0, mj - 1)], mb = pts[Math.min(pts.length - 1, mj + 1)];
    const mid = pts[mj];
    let nxm = -(mb[1] - ma[1]), nzm = mb[0] - ma[0];
    const Lm = Math.hypot(nxm, nzm) || 1; nxm /= Lm; nzm /= Lm;
    if ((mid[0] - n.x) * nxm + (mid[1] - n.z) * nzm < 0) { nxm = -nxm; nzm = -nzm; }
    // hardware 2.4 m inboard of the curb return (was 1.7: with the wider fillets a
    // signal mast landed on the cap asphalt at 125th/Lenox — seams.md item 5)
    if (dbgM) console.log('[mast] corner', i, 'mid', mid[0].toFixed(1), mid[1].toFixed(1), 'clampW', clampW(mid[0], mid[1], nxm, nzm, 3.2).toFixed(2));
    if (clampW(mid[0], mid[1], nxm, nzm, 3.2) < 2.9) continue; // no room for hardware off the roadway
    const cpx = mid[0] + nxm * 2.4, cpz = mid[1] + nzm * 2.4;
    const bis = Math.atan2(cpz - n.z, cpx - n.x);
    const t = tileFor(cpx, cpz);
    const gy = FLAT ? BASE_Y + 0.28 : rY(cpx, cpz) - 0.02 + CURB;
    // never place pole hardware inside a roadway: corner must clear every stub's half-width
    let inRoadway = false;
    for (const s of stubs) {
      const rx = cpx - n.x, rz = cpz - n.z;
      const along = rx * s.dirx + rz * s.dirz;
      const perp = Math.abs(rx * -s.dirz + rz * s.dirx);
      if (along > -1 && perp < s.width / 2 + 0.5) { inRoadway = true; if (dbgM) console.log('[mast] corner', i, 'cp', cpx.toFixed(1), cpz.toFixed(1), 'inRoadway of', s.name, 'along', along.toFixed(1), 'perp', perp.toFixed(1), 'w/2', (s.width / 2).toFixed(1)); break; }
    }
    if (dbgM && !inRoadway) console.log('[mast] corner', i, 'OK cp', cpx.toFixed(1), cpz.toFixed(1), 'mast', n.signal && i % 2 === 0);
    if (inRoadway) continue;
    // street signs once per intersection (on 1-2 corners)
    if (i === 0) {
      const nmA = nameIdx(t, A.name || ''), nmB = nameIdx(t, stubs.find((s) => s.name !== A.name)?.name || '');
      t.furn.push({ k: FURN.STREET_SIGN, x: cpx, y: gy, z: cpz, rot: bis, p0: nmA, p1: nmB });
    }
    if (n.signal) {
      if (i % 2 === 0) { t.furn.push({ k: FURN.SIGNAL_MAST, x: cpx, y: gy, z: cpz, rot: bis + Math.PI, p0: Math.min(255, (Math.max(A.width, B2.width)) | 0), p1: 0 }); mastAt++; }
      t.furn.push({ k: FURN.SIGNAL_PED, x: cpx + Math.cos(bis + 1.2) * 1.2, y: gy, z: cpz + Math.sin(bis + 1.2) * 1.2, rot: bis, p0: 0, p1: 0 });
      if (rnd() < 0.4) t.furn.push({ k: FURN.LITTER, x: cpx + Math.cos(bis) * 1.5, y: gy, z: cpz + Math.sin(bis) * 1.5, rot: rnd() * 6.28, p0: 0, p1: 0 });
      if (rnd() < 0.06) t.furn.push({ k: FURN.MAILBOX, x: cpx + Math.cos(bis - 1.2) * 1.4, y: gy, z: cpz + Math.sin(bis - 1.2) * 1.4, rot: bis + Math.PI, p0: 0, p1: 0 });
      if (rnd() < 0.26) { // news boxes cluster near corners
        const nb = 1 + ((rnd() * 2.4) | 0);
        for (let q = 0; q < nb; q++) t.furn.push({ k: 36, x: cpx + Math.cos(bis + 0.7) * (1.9 + q * 0.55), y: gy, z: cpz + Math.sin(bis + 0.7) * (1.9 + q * 0.55), rot: bis + Math.PI, p0: (rnd() * 5) | 0, p1: 0 });
      }
      if (rnd() < 0.045) t.furn.push({ k: 39, x: cpx + Math.cos(bis) * 2.6, y: gy, z: cpz + Math.sin(bis) * 2.6, rot: bis + 1.5, p0: 0, p1: 0 });
      if (Math.max(A.width, B2.width) > 22 && rnd() < 0.5) { // corner bollards on wide crossings
        for (let q = -1; q <= 1; q++) t.furn.push({ k: 35, x: cpx + Math.cos(bis + q * 0.5) * 1.1, y: gy, z: cpz + Math.sin(bis + q * 0.5) * 1.1, rot: 0, p0: 0, p1: 0 });
      }
    }
  }
  // every signalised node gets masts: the corner loop skips cramped corners
  // (clampW / inRoadway) and twin-node junctions lost ALL of theirs — at
  // 125th/Lenox both nodes report clampW 0.00 on all four corners because their
  // curb returns sit on the edge of the merged asphalt field (debug 2026-09-04).
  // Corner curves are useless there, so march along each corner bisector until
  // the point has left every road rectangle, step past the fillet apex (0.41 R)
  // plus 1.3 m inboard, and place there. Corners touching a short twin-node link
  // are skipped (their bisector exits onto the median), and a 1.5 m outward
  // clearance check keeps masts off median noses. At most two per node.
  if (n.signal && mastAt === 0) {
    const isTwinLink = (s) => { const r = s.r; return polylineLength(r.pts) < 20 && r.nodeA && r.nodeB && r.nodeA !== r.nodeB && (r.nodeA.stubs || []).length >= 3 && (r.nodeB.stubs || []).length >= 3; };
    const py0 = FLAT ? BASE_Y + 0.28 : rY(n.x, n.z) + 0.2;
    for (let i = 0; i < stubs.length && mastAt < 2; i++) {
      const sA = stubs[i], sB = stubs[(i + 1) % stubs.length];
      if (sA === sB) continue;
      if (isTwinLink(sA) || isTwinLink(sB)) { if (dbgM) console.log('[mast] fallback corner', i, 'skip: twin-node link side'); continue; }
      if (sA.rclass > 2 && sB.rclass > 2) continue;
      let bx = sA.dirx + sB.dirx, bz = sA.dirz + sB.dirz;
      const bL = Math.hypot(bx, bz);
      if (bL < 0.3) continue; // straight-through pair: no corner between them
      bx /= bL; bz /= bL;
      const R = (sA.rclass === 2 || sB.rclass === 2) ? 4.6 : 3.4;
      const cIn = 0.3 * R + 1.3; // fillet apex (0.29 R inside the rectangle corner) + 1.3 m inboard
      // analytic corner point: (wB/2 + cIn) from A's axis and (wA/2 + cIn) from B's
      // axis, so the mast stands at the corner even when one road is much wider
      // (a pure bisector on 125th x Lenox lands 7 m down the avenue sidewalk)
      const sinT = Math.abs(sA.dirx * sB.dirz - sA.dirz * sB.dirx);
      let cpx = 0, cpz = 0, how = null;
      if (sinT > 0.3) {
        // facade guard: narrow corner sidewalks (FiDi, Chinatown) would put the pole in
        // the wall — need 1.0 m of clear pavement beyond the pole along the bisector;
        // otherwise retry nearer the curb (0.6 m inboard), else give up on this corner
        for (const c of [cIn, 0.3 * R + 0.6]) {
          const al = (sB.width / 2 + c) / sinT, be = (sA.width / 2 + c) / sinT;
          const qx = n.x + sA.dirx * al + sB.dirx * be, qz = n.z + sA.dirz * al + sB.dirz * be;
          if (inCarriageway(qx, qz, py0, null, 0.3) || inCarriageway(qx + bx * 1.2, qz + bz * 1.2, py0, null, 0.3)) continue;
          if (rayToBuildings(qx, qz, bx, bz, 1.0) < 1.0) { if (dbgM) console.log('[mast] fallback corner', i, 'c', c.toFixed(2), 'facade too close'); continue; }
          cpx = qx; cpz = qz; how = 'corner c' + c.toFixed(1); break;
        }
      }
      if (!how) { // skewed or odd geometry: march along the bisector until the point leaves every road rectangle
        let d0 = -1;
        for (let d = 3; d <= 16; d += 0.25) {
          if (!inCarriageway(n.x + bx * d, n.z + bz * d, py0, null, 0.0)) { d0 = d; break; }
        }
        if (d0 < 0) { if (dbgM) console.log('[mast] fallback corner', i, 'skip: no road exit within 16 m'); continue; }
        const dm = d0 + cIn;
        cpx = n.x + bx * dm; cpz = n.z + bz * dm;
        if (inCarriageway(cpx, cpz, py0, null, 0.3) || inCarriageway(cpx + bx * 1.5, cpz + bz * 1.5, py0, null, 0.3)) {
          if (dbgM) console.log('[mast] fallback corner', i, 'march exit', d0.toFixed(1), 'skip: candidate touches a road (median nose?)');
          continue;
        }
        if (rayToBuildings(cpx, cpz, bx, bz, 1.0) < 1.0) { if (dbgM) console.log('[mast] fallback corner', i, 'march exit', d0.toFixed(1), 'skip: facade too close'); continue; }
        how = 'march ' + d0.toFixed(1);
      }
      const t = tileFor(cpx, cpz);
      const gy = FLAT ? BASE_Y + 0.28 : rY(cpx, cpz) - 0.02 + CURB;
      const bis = Math.atan2(cpz - n.z, cpx - n.x);
      t.furn.push({ k: FURN.SIGNAL_MAST, x: cpx, y: gy, z: cpz, rot: bis + Math.PI, p0: Math.min(255, Math.max(sA.width, sB.width) | 0), p1: 0 });
      mastAt++;
      if (dbgM) console.log('[mast] fallback corner', i, how, 'PLACED', cpx.toFixed(1), cpz.toFixed(1), 'dist', Math.hypot(cpx - n.x, cpz - n.z).toFixed(1));
    }
  }
  {
    const tn = tileFor(n.x, n.z);
    tn.nodesJson.push([+(n.x - tn.x0).toFixed(1), +(n.z - tn.z0).toFixed(1), n.signal ? 1 : 0]);
  }
}
// XW11 census
log(' crossings:', XW11.xw, '(bars', XW11.bars, ', standard', XW11.std, ', depth mean',
  (XW11.xw ? XW11.depth / XW11.xw : 0).toFixed(2), 'm, clamped', XW11.clamp, ')',
  'stop bars:', XW11.stop, 'skipped legs: noTraffic/noGeom', XW11.skipNT, 'registered pairs:', XW11.reg);

// ---------------------------------------------------------------- pavement CONTOURS
// "Road asphalt is the authoritative source", vectorized: the at-grade
// carriageway union (ribbons + junction cap polygons) defines a signed field
//   F = min(dAll - 0.02, cover)
// where dAll is the distance outside the NEAREST carriageway and cover is
// max(bw - d) over sidewalk-bearing sources. The F = 0 isoline is BOTH the
// curb line (road side) and the sidewalk outer edge, with junction corners
// filleted by construction (SimCity-spline corners). Marching squares extracts
// oriented contour loops (band on the left), open chains are closed along the
// tile perimeter (the sample grid is world-aligned so seams match across
// tiles), Douglas-Peucker trims collinear runs, earcut-with-holes fills the
// band, and curb faces extrude along the road-side portion of each loop.
// Replaces the analytic straight sidewalks + corner bands + dead-end wraps
// (set ANALYTIC_WALKS=1 to compare against the old emitters). Unlike the old
// FIELD_WALKS cell tessellation this costs ~1 vertex per 2-3m of curb, not a
// dense grid.
if (CONTOUR_WALKS) {
  const CAPC = 64, capIdx = new Map();
  for (const n of nodes.values()) {
    if (!n.capPoly) continue;
    const k = `${Math.floor(n.x / CAPC)}_${Math.floor(n.z / CAPC)}`;
    let a = capIdx.get(k); if (!a) capIdx.set(k, (a = []));
    a.push(n);
  }
  const CS = 1.4;
  const _fp = { d: 0, cover: 0 };
  const fieldAt = (px, pz, parts) => {
    let dAll = 1e9, cover = -1e9;
    const gx = Math.floor(px / PCELL), gz = Math.floor(pz / PCELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = ROADIDX.get(`${gx + dx}_${gz + dz}`);
      if (!a) continue;
      for (const s of a) {
        if (!s.atGrade) continue;
        const dx2 = s.x2 - s.x1, dz2 = s.z2 - s.z1, L2 = dx2 * dx2 + dz2 * dz2 || 1e-9;
        const t2 = Math.max(0, Math.min(1, ((px - s.x1) * dx2 + (pz - s.z1) * dz2) / L2));
        const dd = Math.hypot(px - (s.x1 + dx2 * t2), pz - (s.z1 + dz2 * t2)) - s.w2;
        if (dd < dAll) dAll = dd;
        if (s.bw > 0) {
          let ddB = dd;
          if (s.extA || s.extB) {
            const Ls = Math.sqrt(L2), ux = dx2 / Ls, uz = dz2 / Ls;
            const ax = s.x1 - ux * (s.extA || 0), az = s.z1 - uz * (s.extA || 0);
            const bx = s.x2 + ux * (s.extB || 0), bz = s.z2 + uz * (s.extB || 0);
            const ex = bx - ax, ez = bz - az, E2 = ex * ex + ez * ez || 1e-9;
            const te = Math.max(0, Math.min(1, ((px - ax) * ex + (pz - az) * ez) / E2));
            ddB = Math.hypot(px - (ax + ex * te), pz - (az + ez * te)) - s.w2;
          }
          const sn = -(px - s.x1) * dz2 + (pz - s.z1) * dx2;   // > 0: the +n side of the segment
          const bws = sn > 0 ? s.bwN : s.bwM;
          if (bws - ddB > cover) cover = bws - ddB;
        }
      }
    }
    const cgx = Math.floor(px / CAPC), cgz = Math.floor(pz / CAPC);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = capIdx.get(`${cgx + dx}_${cgz + dz}`);
      if (!a) continue;
      for (const nn of a) {
        const b = nn.capBox;
        if (px < b[0] - 8 || px > b[2] + 8 || pz < b[1] - 8 || pz > b[3] + 8) continue;
        const poly = nn.capPoly;
        let inside = false, ed = 1e9;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
          if ((zi > pz) !== (zj > pz) && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
          const ddx = xj - xi, ddz = zj - zi, L2 = ddx * ddx + ddz * ddz || 1e-9;
          const t2 = Math.max(0, Math.min(1, ((px - xi) * ddx + (pz - zi) * ddz) / L2));
          ed = Math.min(ed, Math.hypot(px - (xi + ddx * t2), pz - (zi + ddz * t2)));
        }
        const dd = inside ? -ed : ed;
        if (dd < dAll) dAll = dd;
        if (nn.capBw > 0 && nn.capBw - dd > cover) cover = nn.capBw - dd;
      }
    }
    if (parts) { parts.d = dAll; parts.cover = cover; }
    // band edge 5 cm INSIDE the asphalt (hidden under the 13.5 cm curb step): the
    // old 2 cm stand-off plus marching-squares interpolation left a 2-8 cm
    // hairline of bare terrain 28 cm down along every curb (seams.md hole A,
    // field probe at (2266,-2780): d 0.01, F -0.01)
    return Math.min(dAll + 0.05, cover);
  };
  // Douglas-Peucker on an open point run [ [x,z], ... ] (endpoints kept)
  const dpSimplify = (pts, eps) => {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
      const [i0, i1] = stack.pop();
      if (i1 - i0 < 2) continue;
      const ax = pts[i0][0], az = pts[i0][1], bx = pts[i1][0], bz = pts[i1][1];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      let mi = -1, md = eps;
      for (let i = i0 + 1; i < i1; i++) {
        // closed rings enter with identical endpoints: a zero-length chord
        // must fall back to point distance or every ring collapses to 2 pts
        const d = L < 1e-6
          ? Math.hypot(pts[i][0] - ax, pts[i][1] - az)
          : Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
        if (d > md) { md = d; mi = i; }
      }
      if (mi >= 0) { keep[mi] = 1; stack.push([i0, mi], [mi, i1]); }
    }
    return pts.filter((_, i) => keep[i]);
  };
  // DEBUG_FIELD=x,z: dump the pavement field and every road segment/cap around that point
  if (process.env.DEBUG_FIELD) {
    const [qx, qz] = process.env.DEBUG_FIELD.split(',').map(Number);
    const parts = { d: 0, cover: 0 };
    const F = fieldAt(qx, qz, parts);
    console.log('[field] at', qx, qz, 'F', F.toFixed(2), 'd', parts.d.toFixed(2), 'cover', parts.cover.toFixed(2), 'terrain', sampleTerrain(qx, qz).toFixed(2));
    const gx = Math.floor(qx / PCELL), gz = Math.floor(qz / PCELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = ROADIDX.get(`${gx + dx}_${gz + dz}`);
      if (!a) continue;
      for (const sg of a) {
        const dx2 = sg.x2 - sg.x1, dz2 = sg.z2 - sg.z1, L2 = dx2 * dx2 + dz2 * dz2 || 1e-9;
        const t2 = Math.max(0, Math.min(1, ((qx - sg.x1) * dx2 + (qz - sg.z1) * dz2) / L2));
        const dd = Math.hypot(qx - (sg.x1 + dx2 * t2), qz - (sg.z1 + dz2 * t2)) - sg.w2;
        if (dd < 20) console.log('[field]  seg', sg.r.name, 'rc', sg.r.rclass, 'w2', sg.w2.toFixed(1), 'bw', sg.bw, 'atGrade', sg.atGrade, 'y', sg.y1.toFixed(2), sg.y2.toFixed(2), 'terr', sampleTerrain(sg.x1, sg.z1).toFixed(2), sampleTerrain(sg.x2, sg.z2).toFixed(2), 'dBeyondEdge', dd.toFixed(2));
      }
    }
    const cgx = Math.floor(qx / CAPC), cgz = Math.floor(qz / CAPC);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const a = capIdx.get(`${cgx + dx}_${cgz + dz}`);
      if (a) for (const nn of a) if (Math.hypot(nn.x - qx, nn.z - qz) < 40) console.log('[field]  cap node', nn.x.toFixed(1), nn.z.toFixed(1), 'capBw', nn.capBw, 'signal', nn.signal, 'legs', nn.stubs.length);
    }
  }
  const N = Math.ceil(TILE / CS);
  const fGrid = new Float32Array((N + 1) * (N + 1));
  const eGrid = new Uint8Array((N + 1) * (N + 1));
  let bandTris = 0, bandSplit = 0, curbQuads = 0, dropChains = 0, dbgCand = 0, dbgSegs = 0, dbgLoops = 0, dbgOpen = 0;
  const snapshot = [...tiles.values()];
  for (const t of snapshot) {
    // ---- candidate cells around every at-grade source (band + hole margins)
    const cand = new Set();
    const segs = new Set();
    for (let gx = Math.floor((t.x0 - 16) / PCELL); gx <= Math.floor((t.x0 + TILE + 16) / PCELL); gx++)
      for (let gz = Math.floor((t.z0 - 16) / PCELL); gz <= Math.floor((t.z0 + TILE + 16) / PCELL); gz++) {
        const a = ROADIDX.get(gx + '_' + gz);
        if (a) for (const s of a) if (s.atGrade) segs.add(s);
      }
    if (!segs.size) continue;
    for (const s of segs) {
      const m = s.w2 + (s.bw > 0 ? s.bw : 0) + 2.6 + Math.max(s.extA || 0, s.extB || 0);
      const x0 = Math.max(t.x0, Math.min(s.x1, s.x2) - m), x1 = Math.min(t.x0 + TILE - 0.01, Math.max(s.x1, s.x2) + m);
      const z0 = Math.max(t.z0, Math.min(s.z1, s.z2) - m), z1 = Math.min(t.z0 + TILE - 0.01, Math.max(s.z1, s.z2) + m);
      if (x0 >= x1 || z0 >= z1) continue;
      const i0 = Math.max(0, Math.floor((x0 - t.x0) / CS)), i1 = Math.min(N - 1, Math.floor((x1 - t.x0) / CS));
      const j0 = Math.max(0, Math.floor((z0 - t.z0) / CS)), j1 = Math.min(N - 1, Math.floor((z1 - t.z0) / CS));
      const dx2 = s.x2 - s.x1, dz2 = s.z2 - s.z1, L2 = dx2 * dx2 + dz2 * dz2 || 1e-9;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const cx = t.x0 + (i + 0.5) * CS, cz = t.z0 + (j + 0.5) * CS;
        const t2 = Math.max(0, Math.min(1, ((cx - s.x1) * dx2 + (cz - s.z1) * dz2) / L2));
        const dd = Math.hypot(cx - (s.x1 + dx2 * t2), cz - (s.z1 + dz2 * t2));
        if (dd < s.w2 + (s.bw > 0 ? s.bw : 0) + 2.5 + Math.max(s.extA || 0, s.extB || 0) && dd > s.w2 - 2.6) cand.add(j * N + i);
      }
    }
    for (let gx = Math.floor(t.x0 / CAPC) - 1; gx <= Math.floor((t.x0 + TILE) / CAPC) + 1; gx++)
      for (let gz = Math.floor(t.z0 / CAPC) - 1; gz <= Math.floor((t.z0 + TILE) / CAPC) + 1; gz++) {
        const a = capIdx.get(gx + '_' + gz);
        if (!a) continue;
        for (const nn of a) {
          const b = nn.capBox, m = (nn.capBw || 0) + 2.5;
          const i0 = Math.max(0, Math.floor((b[0] - m - t.x0) / CS)), i1 = Math.min(N - 1, Math.floor((b[2] + m - t.x0) / CS));
          const j0 = Math.max(0, Math.floor((b[1] - m - t.z0) / CS)), j1 = Math.min(N - 1, Math.floor((b[3] + m - t.z0) / CS));
          for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) cand.add(j * N + i);
        }
      }
    if (!cand.size) continue;
    eGrid.fill(0);
    const val = (i, j) => {
      const idx = j * (N + 1) + i;
      if (!eGrid[idx]) {
        let f = fieldAt(t.x0 + i * CS, t.z0 + j * CS);
        if (f === 0) f = 1e-6;
        fGrid[idx] = f; eGrid[idx] = 1;
      }
      return fGrid[idx];
    };
    // ---- marching squares: directed segments, band (F>=0) on the LEFT.
    // Edge keys: h_i_j = between nodes (i,j)-(i+1,j); v_i_j = (i,j)-(i,j+1).
    const segsOut = new Map(); // fromKey -> {to, pts:[from,to]}
    const endKeys = new Set();
    const xPt = (i1, j1, i2, j2, f1, f2) => {
      const tt = f1 / (f1 - f2);
      return [t.x0 + (i1 + (i2 - i1) * tt) * CS, t.z0 + (j1 + (j2 - j1) * tt) * CS];
    };
    const addSeg = (fromK, toK, fromP, toP) => {
      segsOut.set(fromK, { to: toK, a: fromP, b: toP });
      endKeys.add(toK);
    };
    for (const ci of cand) {
      const i = ci % N, j = (ci / N) | 0;
      const fa = val(i, j), fb = val(i + 1, j), fc = val(i + 1, j + 1), fd = val(i, j + 1);
      const code = (fa >= 0 ? 1 : 0) | (fb >= 0 ? 2 : 0) | (fc >= 0 ? 4 : 0) | (fd >= 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const kAB = `h${i}_${j}`, kBC = `v${i + 1}_${j}`, kCD = `h${i}_${j + 1}`, kDA = `v${i}_${j}`;
      const pAB = () => xPt(i, j, i + 1, j, fa, fb);
      const pBC = () => xPt(i + 1, j, i + 1, j + 1, fb, fc);
      const pCD = () => xPt(i, j + 1, i + 1, j + 1, fd, fc);
      const pDA = () => xPt(i, j, i, j + 1, fa, fd);
      switch (code) {
        case 1: addSeg(kAB, kDA, pAB(), pDA()); break;
        case 2: addSeg(kBC, kAB, pBC(), pAB()); break;
        case 4: addSeg(kCD, kBC, pCD(), pBC()); break;
        case 8: addSeg(kDA, kCD, pDA(), pCD()); break;
        case 3: addSeg(kBC, kDA, pBC(), pDA()); break;
        case 6: addSeg(kCD, kAB, pCD(), pAB()); break;
        case 12: addSeg(kDA, kBC, pDA(), pBC()); break;
        case 9: addSeg(kAB, kCD, pAB(), pCD()); break;
        case 7: addSeg(kCD, kDA, pCD(), pDA()); break;
        case 14: addSeg(kDA, kAB, pDA(), pAB()); break;
        case 13: addSeg(kAB, kBC, pAB(), pBC()); break;
        case 11: addSeg(kBC, kCD, pBC(), pCD()); break;
        case 5: {
          const cen = fieldAt(t.x0 + (i + 0.5) * CS, t.z0 + (j + 0.5) * CS);
          if (cen >= 0) { addSeg(kAB, kBC, pAB(), pBC()); addSeg(kCD, kDA, pCD(), pDA()); }
          else { addSeg(kAB, kDA, pAB(), pDA()); addSeg(kCD, kBC, pCD(), pBC()); }
          break;
        }
        case 10: {
          const cen = fieldAt(t.x0 + (i + 0.5) * CS, t.z0 + (j + 0.5) * CS);
          if (cen >= 0) { addSeg(kBC, kCD, pBC(), pCD()); addSeg(kDA, kAB, pDA(), pAB()); }
          else { addSeg(kBC, kAB, pBC(), pAB()); addSeg(kDA, kCD, pDA(), pCD()); }
          break;
        }
      }
    }
    dbgCand += cand.size; dbgSegs += segsOut.size;
    if (!segsOut.size) continue;
    // ---- stitch chains: follow fromKey -> toKey until the loop closes or the
    // next segment is missing (open chain: contour left through the tile edge)
    const consumed = new Set();
    const closedLoops = [], openChains = [];
    // chain starts: keys that begin a segment but no segment ends there
    for (const [k0, s0] of segsOut) {
      if (consumed.has(k0) || endKeys.has(k0)) continue;
      const pts = [s0.a];
      let k = k0;
      while (segsOut.has(k) && !consumed.has(k)) {
        const s = segsOut.get(k);
        consumed.add(k);
        pts.push(s.b);
        k = s.to;
      }
      openChains.push(pts);
    }
    for (const [k0, s0] of segsOut) {
      if (consumed.has(k0)) continue;
      const pts = [s0.a];
      let k = k0;
      while (segsOut.has(k) && !consumed.has(k)) {
        const s = segsOut.get(k);
        consumed.add(k);
        pts.push(s.b);
        k = s.to;
      }
      if (k === k0) { pts.pop(); closedLoops.push(pts); }
      else openChains.push(pts); // interior break (dropped cell): salvage below
    }
    // ---- close open chains along the tile perimeter (band on the left =
    // walk the border counterclockwise: +x along bottom, +z up the right...)
    const X1 = t.x0 + TILE, Z1 = t.z0 + TILE, EPSB = CS * 0.51;
    const perimS = (p) => {
      if (Math.abs(p[1] - t.z0) < EPSB) return p[0] - t.x0;
      if (Math.abs(p[0] - X1) < EPSB) return TILE + (p[1] - t.z0);
      if (Math.abs(p[1] - Z1) < EPSB) return 2 * TILE + (X1 - p[0]);
      if (Math.abs(p[0] - t.x0) < EPSB) return 3 * TILE + (Z1 - p[1]);
      return -1;
    };
    const cornerAt = (k) => (k === 1 ? [X1, t.z0] : k === 2 ? [X1, Z1] : k === 3 ? [t.x0, Z1] : [t.x0, t.z0]);
    {
      const evs = [];
      const chains = [];
      for (const pts of openChains) {
        const sEnd = perimS(pts[pts.length - 1]), sStart = perimS(pts[0]);
        if (sEnd < 0 || sStart < 0) { dropChains++; continue; }
        const id = chains.length;
        chains.push({ pts, sStart, sEnd, next: -1, used: false });
        evs.push({ s: sStart, id, kind: 0 }, { s: sEnd, id, kind: 1 });
      }
      evs.sort((a, b) => a.s - b.s || a.kind - b.kind);
      // each chain END connects along CCW border to the next chain START
      const startsByS = evs.filter((e) => e.kind === 0);
      for (const c of chains) {
        if (!startsByS.length) break;
        let lo = 0, hi = startsByS.length - 1, pick = -1;
        // first start with s > sEnd (cyclic)
        for (let q = 0; q < startsByS.length; q++) {
          const e = startsByS[q];
          if (e.s > c.sEnd + 1e-9) { pick = q; break; }
        }
        if (pick < 0) pick = 0;
        c.next = startsByS[pick].id;
        c.nextS = startsByS[pick].s;
        startsByS.splice(pick, 1);
      }
      for (const c of chains) {
        if (c.used || c.next < 0) continue;
        const loop = [];
        let cur = c, guard = 0;
        while (!cur.used && guard++ < chains.length + 2) {
          cur.used = true;
          loop.push(...cur.pts);
          // border run from cur.sEnd to cur.nextS, inserting passed corners
          let s0 = cur.sEnd, s1 = cur.nextS;
          if (s1 <= s0) s1 += 4 * TILE;
          for (let kc = Math.floor(s0 / TILE) + 1; kc * TILE < s1; kc++) {
            loop.push(cornerAt(((kc - 1) % 4) + 1));
          }
          const nxt = chains[cur.next];
          if (!nxt || nxt === c || nxt.used) break;
          cur = nxt;
        }
        if (loop.length >= 3) closedLoops.push(loop);
      }
    }
    dbgLoops += closedLoops.length; dbgOpen += openChains.length;
    // ---- simplify + area/orientation
    const loops = [];
    for (let pts of closedLoops) {
      pts = dpSimplify([...pts, pts[0]], 0.12);
      pts.pop();
      if (pts.length < 3) continue;
      let area = 0;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) area += (pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1]);
      area /= 2;
      if (Math.abs(area) < 0.6) continue;
      loops.push({ pts, area });
    }
    if (!loops.length) continue;
    const inPoly = (p, poly) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const xi = poly[i][0], zi = poly[i][1], xj = poly[j][0], zj = poly[j][1];
        if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    };
    // frame-independent outer/hole classification: sample F just inside the
    // polygon near an edge midpoint — band inside means the loop bounds band
    // (outer), road/far inside means it is a hole in a surrounding band
    for (const l of loops) {
      const pts = l.pts;
      let outer = false;
      for (let i = 0, tries = 0; i < pts.length && tries < 6; i++, tries++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        if (L < 0.3) { tries--; continue; }
        const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
        const nx = -ez / L, nz = ex / L;
        for (const sgn of [1, -1]) {
          const px = mx + nx * 0.2 * sgn, pz = mz + nz * 0.2 * sgn;
          if (inPoly([px, pz], pts)) { outer = fieldAt(px, pz) >= 0; tries = 6; break; }
        }
      }
      l.outer = outer;
    }
    const outers = loops.filter((l) => l.outer).sort((a, b) => Math.abs(a.area) - Math.abs(b.area));
    const holes = loops.filter((l) => !l.outer);
    for (const o of outers) o.holes = [];
    for (const h of holes) {
      for (const o of outers) {
        if (Math.abs(o.area) > Math.abs(h.area) && inPoly(h.pts[0], o.pts)) { o.holes.push(h); break; }
      }
    }
    // ---- earcut the band, emit sidewalk tris (terrain + 0.28 like all pavement)
    // THE MISSING-SIDEWALK BUG (found 2026-09-03 with a section probe of the
    // tiles): dpSimplify turns a straight block-long curb into ONE edge, earcut
    // then spans the 6 m band with 150-250 m slivers, and the 90 m chord guard
    // (triTooBig, meant for river-straddling overlays) threw every one of them
    // away. Whole blocks of Harlem had no pavement at all — bare terrain 28 cm
    // below the buildings, props and curb tops (the "gaps under everything"
    // the owner sees). Fix: densify every ring edge to <= 16 m before earcut
    // and SPLIT oversized triangles at their longest edge instead of dropping
    // them; the water guard (allPulled) stays.
    const densify = (pts, maxE) => {
      const out = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        out.push(a);
        const Le = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const nS = Math.ceil(Le / maxE);
        for (let k = 1; k < nS; k++) out.push([a[0] + ((b[0] - a[0]) * k) / nS, a[1] + ((b[1] - a[1]) * k) / nS]);
      }
      return out;
    };
    const emitBandTri = (A, B, C, depth) => {
      const e2 = (P, Q) => (P[0] - Q[0]) ** 2 + (P[1] - Q[1]) ** 2;
      const ab = e2(A, B), bc = e2(B, C), ca = e2(C, A), mx = Math.max(ab, bc, ca);
      if (mx > 24 * 24 && depth < 9) {
        bandSplit++;
        if (mx === ab) { const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2]; emitBandTri(A, M, C, depth + 1); emitBandTri(M, B, C, depth + 1); }
        else if (mx === bc) { const M = [(B[0] + C[0]) / 2, (B[1] + C[1]) / 2]; emitBandTri(A, B, M, depth + 1); emitBandTri(A, M, C, depth + 1); }
        else { const M = [(C[0] + A[0]) / 2, (C[1] + A[1]) / 2]; emitBandTri(A, B, M, depth + 1); emitBandTri(M, B, C, depth + 1); }
        return;
      }
      const cx = (A[0] + B[0] + C[0]) / 3, cz = (A[1] + B[1] + C[1]) / 3;
      if (cx < t.x0 - 0.001 || cx >= X1 + 0.001 || cz < t.z0 - 0.001 || cz >= Z1 + 0.001) return;
      const A3 = drapeVert(A[0], A[1], 0.28), B3 = drapeVert(B[0], B[1], 0.28), C3 = drapeVert(C[0], C[1], 0.28);
      if (allPulled(A3, B3, C3)) return; // chords over water
      const tt = tileFor(cx, cz);
      if ((B3[2] - A3[2]) * (C3[0] - A3[0]) - (B3[0] - A3[0]) * (C3[2] - A3[2]) < 0) pushTri(tt.sidewalk, A3[0], A3[1], A3[2], C3[0], C3[1], C3[2], B3[0], B3[1], B3[2]);
      else pushTri(tt.sidewalk, A3[0], A3[1], A3[2], B3[0], B3[1], B3[2], C3[0], C3[1], C3[2]);
      bandTris++;
    };
    for (const o of outers) {
      const flat = [];
      for (const p of densify(o.pts, 16)) flat.push(p[0], p[1]);
      const holeIdx = [];
      for (const h of o.holes) {
        holeIdx.push(flat.length / 2);
        for (const p of densify(h.pts, 16)) flat.push(p[0], p[1]);
      }
      const tri = earcut(flat, holeIdx.length ? holeIdx : null);
      for (let k = 0; k + 2 < tri.length; k += 3) {
        emitBandTri([flat[tri[k] * 2], flat[tri[k] * 2 + 1]], [flat[tri[k + 1] * 2], flat[tri[k + 1] * 2 + 1]], [flat[tri[k + 2] * 2], flat[tri[k + 2] * 2 + 1]], 0);
      }
    }
    // ---- curb faces along road-side loop segments (the F=0 line is the curb
    // wherever the carriageway constraint binds, the outer edge where cover
    // binds). Perimeter runs (border closure) sit inside the band: no curb —
    // detected the same way since their midpoints are interior.
    for (const l of loops) {
      const pts = l.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const ax = pts[j][0], az = pts[j][1], bx = pts[i][0], bz = pts[i][1];
        const segL = Math.hypot(bx - ax, bz - az);
        if (segL < 0.05) continue;
        // border-closure runs lie on the tile perimeter: no curb there
        if (perimS(pts[j]) >= 0 && perimS(pts[i]) >= 0) continue;
        fieldAt((ax + bx) / 2, (az + bz) / 2, _fp);
        if (_fp.d + 0.05 >= _fp.cover - 1e-9) continue; // outer edge, no curb (same offset as fieldAt)
        const Ad = drapeVert(ax, az, 0), Bd = drapeVert(bx, bz, 0);
        const tt = tileFor((ax + bx) / 2, (az + bz) / 2);
        pushQuad(tt.curb, [Ad[0], Ad[1] + 0.02, Ad[2]], [Bd[0], Bd[1] + 0.02, Bd[2]], [Bd[0], Bd[1] + 0.28, Bd[2]], [Ad[0], Ad[1] + 0.28, Ad[2]]);
        pushQuad(tt.curb, [Bd[0], Bd[1] + 0.02, Bd[2]], [Ad[0], Ad[1] + 0.02, Ad[2]], [Ad[0], Ad[1] + 0.28, Ad[2]], [Bd[0], Bd[1] + 0.28, Bd[2]]);
        curbQuads++;
      }
    }
  }
  log(' contour band tris:', bandTris, 'split:', bandSplit, 'curb quads:', curbQuads, 'dropped chains:', dropChains, 'cand:', dbgCand, 'msegs:', dbgSegs, 'loops:', dbgLoops, 'open:', dbgOpen);
}


// ---------------------------------------------------------------- medians between divided carriageways
// CSCL models divided avenues as two parallel one-way segments; the gap between
// the two ribbons was bare terrain. Pair opposite-direction same-name samples and
// pave the gap: concrete apron when narrow, planted median with concrete edging
// (+ street trees) when wide. Strips stop short of junction nodes so cross
// traffic keeps clean asphalt.
// ---------------------------------------------------------------- shoreline bulkheads
// NYC's waterfront is hard-edged: concrete seawalls, not bare dirt sliding
// into the river. Walk every land-polygon outer ring, sample ~7m, and emit a
// vertical bulkhead face from below the waterline (y=0 water plane, terrain
// dives to -3.5) up to the local esplanade grade, with a cap band on top.
// Seaward side is probed with onLand so ring winding never matters. Raw
// terrain wedges at the shore were the ugliest thing visible from the air.
log('shoreline');
// SA37: every ring segment that gets its bulkhead, in 16 m cells (the shore aprons below only reach a ring edge that has
// its wall)
const WALL_CELL = 16;
const wallIdx = new Map();
const wallPieces = [];   // WW39: [tile, curb float index, probe x, z, probe x, z] per wall piece
const SA37_DBG = process.env.SA37_DEBUG ? process.env.SA37_DEBUG.split(',').map(Number) : null;
const sa37Dbg = { walls: [], skipped: [], runs: [] };
const inDbg = (x, z) => SA37_DBG && x >= SA37_DBG[0] && x <= SA37_DBG[2] && z >= SA37_DBG[1] && z <= SA37_DBG[3];
function wallAdd(ax, az, bx, bz) {
  for (let j = Math.floor((Math.min(az, bz) - 1) / WALL_CELL); j <= Math.floor((Math.max(az, bz) + 1) / WALL_CELL); j++)
    for (let i = Math.floor((Math.min(ax, bx) - 1) / WALL_CELL); i <= Math.floor((Math.max(ax, bx) + 1) / WALL_CELL); i++) {
      const k = i + '_' + j;
      let a = wallIdx.get(k);
      if (!a) wallIdx.set(k, (a = []));
      a.push(ax, az, bx, bz);
    }
}
function wallNear(x, z, r) {
  const a = wallIdx.get(Math.floor(x / WALL_CELL) + '_' + Math.floor(z / WALL_CELL));
  if (!a) return false;
  for (let k = 0; k < a.length; k += 4) {
    const ax = a[k], az = a[k + 1], dx = a[k + 2] - ax, dz = a[k + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    if (Math.hypot(x - ax - dx * t, z - az - dz * t) <= r) return true;
  }
  return false;
}
{
  let wallSegs = 0, tipsSkipped = 0, wallsShortened = 0;
  const STEP = 7;
  for (const L of LAND) {
    const ring = L.outer;
    // total ring length gate: skip tiny islets
    let ringLen = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
      ringLen += Math.hypot(x2 - x1, z2 - z1);
    }
    if (ringLen < 60) continue;
    for (let i = 0; i < ring.length; i++) {
      let [x1, z1] = ring[i];
      let [x2, z2] = ring[(i + 1) % ring.length];
      const segL = Math.hypot(x2 - x1, z2 - z1);
      if (segL < 0.5) continue;
      const dx = (x2 - x1) / segL, dz = (z2 - z1) / segL;
      let nx = dz, nz = -dx; // candidate seaward normal
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      // stay inside the LOADED data's tile range: LAND rings are citywide, so
      // a partial --boro run otherwise emits wall-only tiles with empty
      // (-3.5) terrain far outside its boro and the manifest merge REPLACES
      // good tiles with them (this drowned Manhattan after a Bronx-only run)
      const stx = Math.floor(mx / TILE), stz = Math.floor(mz / TILE);
      if (stx < TX0 || stx > TX1 || stz < TZ0 || stz > TZ1) continue;
      // seaward = first side that finds water at ANY probe distance: a single
      // 3m probe misfires at convex points (both sides land) and skipped
      // segments left wall GAPS exposing the pale terrain crossing strip
      let found = false;
      for (const pd of [3, 1.6, 5.5]) {
        if (!onLand(mx + nx * pd, mz + nz * pd)) { found = true; break; }
        if (!onLand(mx - nx * pd, mz - nz * pd)) { nx = -nx; nz = -nz; found = true; break; }
      }
      if (!found) { if (inDbg(mx, mz)) sa37Dbg.skipped.push([+x1.toFixed(2), +z1.toFixed(2), +x2.toFixed(2), +z2.toFixed(2), 'nofound']); continue; } // genuine sliver: water on neither side
      // a sliver of land thinner than 4 m (a ferry slip's fender rack, a breakwater line) is not a wharf: its walls stood
      // as a floating plank with corner shards; it is left to the water
      if (FLAT && !onLand(mx - nx * 4, mz - nz * 4) && !onLand(mx - nx * 2.5, mz - nz * 2.5)) { if (inDbg(mx, mz)) sa37Dbg.skipped.push([+x1.toFixed(2), +z1.toFixed(2), +x2.toFixed(2), +z2.toFixed(2), 'sliver']); continue; }
      // WW39: an edge under 8 m long needs land 2.5 m behind it along its whole length (its middle and the points a quarter
      // and three quarters along it), or both 2.5 and 4 m behind its middle: the spikes and tips of a ring (a fender, a
      // dolphin, the pointed ends of Pier 16's outline) carried a wall and an apron and stood as small planks in the slip.
      // A marina's finger pier, 3 to 5 m wide and drawn in short edges, keeps its walls and so its apron: the 4 m test alone
      // took 1,242 such edges city-wide (Chelsea Piers, Great Kills, Mill Basin, the World's Fair Marina, Sheepshead Bay)
      // and left the fingers' few long edges standing in the water as fragments
      if (SA37 && FLAT && segL < 8) {
        const l25 = onLand(mx - nx * 2.5, mz - nz * 2.5);
        const strip = l25 && (onLand(mx - nx * 4, mz - nz * 4)
          || (onLand(x1 + (x2 - x1) * 0.25 - nx * 2.5, z1 + (z2 - z1) * 0.25 - nz * 2.5) && onLand(x1 + (x2 - x1) * 0.75 - nx * 2.5, z1 + (z2 - z1) * 0.75 - nz * 2.5)));
        if (!strip) { tipsSkipped++; if (inDbg(mx, mz)) sa37Dbg.skipped.push([+x1.toFixed(2), +z1.toFixed(2), +x2.toFixed(2), +z2.toFixed(2), 'tip']); continue; }
      }
      // extend both ends so adjacent faces OVERLAP at ring corners — offset
      // walls otherwise diverge at convex bends and open a V gap. The tiny
      // per-segment face-offset jitter keeps collinear overlaps off-plane.
      const EXT = 2.6;
      // the offset face must STAND IN WATER at both ends: across a narrow
      // notch/slip the face lands on the far bank (or on this one) and reads
      // as a pale shard leaning over the inlet — shrink the offset until it
      // fits, or skip the segment (pinned+deepened terrain hides the notch)
      // SA37: an end keeps the full overlap where its offset point stands in water and is drawn shorter (1 m, then none)
      // where that point would reach land: a pier's side meeting the head of its slip (a concave corner, where the faces
      // meet anyway) had lost its whole wall to the overlap alone (59 of 200 ring segments round the Whitehall slips).
      // SG40: where even the edge's own end point offset into the water is on land (the side of a pier at its root, where
      // the shore's line runs on), the end is drawn up to 4 m short of it, the face keeping at least half the edge: such an
      // end had taken the whole wall with it, 30 to 370 m of a pier side (Brooklyn Bridge Park, Pier 97, the Bush Terminal
      // piers, Sheepshead Bay's piers), and with the wall the apron, so the side stood as the terrain grid's 16 m stairs
      const X1 = x1, Z1 = z1, X2 = x2, Z2 = z2, ENDS = SA37 ? [EXT, 1, 0, -0.5, -1, -1.5, -2, -3, -4] : [EXT];
      let base = 0, e1 = EXT, e2 = EXT;
      for (const eo of [3.4, 1.8, 0.9]) {
        if (onLand(mx + nx * eo, mz + nz * eo)) continue;
        const f1 = ENDS.find((e) => !onLand(X1 - dx * e + nx * eo, Z1 - dz * e + nz * eo));
        const f2 = ENDS.find((e) => !onLand(X2 + dx * e + nx * eo, Z2 + dz * e + nz * eo));
        if (f1 === undefined || f2 === undefined || segL + f1 + f2 < segL * 0.5) continue;
        if (f1 < 0 || f2 < 0) wallsShortened++;
        base = eo; e1 = f1; e2 = f2; break;
      }
      x1 = X1 - dx * e1; z1 = Z1 - dz * e1;
      x2 = X2 + dx * e2; z2 = Z2 + dz * e2;
      if (!base) { if (inDbg(mx, mz)) sa37Dbg.skipped.push([+x1.toFixed(2), +z1.toFixed(2), +x2.toFixed(2), +z2.toFixed(2), 'nobase']); continue; }
      wallAdd(x1, z1, x2, z2);
      if (inDbg(mx, mz)) sa37Dbg.walls.push([+x1.toFixed(2), +z1.toFixed(2), +x2.toFixed(2), +z2.toFixed(2), base]);
      const offJ = base + (((i * 2654435761) >>> 16) % 100) * 0.0002; // 0-2cm
      // WW39: the quads below are wound for a seaward normal on the LEFT of travel (n = (-dz, dx)). Where the sea lies on the
      // right (n = (dz, -dx): most of the city's rings) the face looked inland, the cap down and the skirt out to sea; the
      // ground material draws front faces only, so the face vanished from the water and the cap from the air, and what was
      // left, the 1.6 m skirt, read as a plank floating off the shore with water behind it (Piers 15-17, Whitehall, Chelsea).
      const wind = SA37 && dx * nz - dz * nx < 0 ? (buf, a, b, c, d) => pushQuad(buf, a, d, c, b) : pushQuad;
      const n = Math.max(1, Math.ceil((segL + e1 + e2) / STEP));
      let prev = null;
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const px = x1 + (x2 - x1) * t, pz = z1 + (z2 - z1) * t;
        // esplanade grade just inland (8m: past the pinned strip, onto the
        // 2.5m promenade band, so the cap reads as a parapet above it)
        // A pier narrower than the terrain grid sees water 8 m inland, which capped its walls at 1.6 m and left them as
        // planks floating beside an unresolved deck (the St. George ferry slips): the land's own grade counts wherever a
        // probe 8, 4 or 2 m inland is on land (flat mode: the base plane or a landing plateau)
        let hL = Math.max(1.1, sampleTerrain(px - nx * 8, pz - nz * 8));
        if (FLAT) for (const d of [8, 4, 2]) { const qx = px - nx * d, qz = pz - nz * d; if (onLand(qx, qz)) { hL = Math.max(hL, landingPadAt(qx, qz) ?? BASE_Y); break; } }
        // wall rises to the bank: capping it below high esplanades let the
        // terrain ramp crest over the top and the dirt wedge showed anyway.
        // offJ height jitter keeps overlapping corner caps off-plane too.
        const top = Math.min(hL + 0.55 + (offJ - 3.4) * 2, 16);
        const cur = [px, pz, top];
        if (prev) {
          const tile = tileFor((prev[0] + px) / 2, (prev[1] + pz) / 2);
          // seaward face stands 3.4m off the ring: the terrain grid's land->
          // water crossing triangle can break the surface a few meters past
          // the ring (cell-size smear of the boundary) and the wall must be
          // in FRONT of that strip, not behind it
          wind(tile.curb,
            [prev[0] + nx * offJ, -2.6, prev[1] + nz * offJ],
            [px + nx * offJ, -2.6, pz + nz * offJ],
            [px + nx * offJ, cur[2], pz + nz * offJ],
            [prev[0] + nx * offJ, prev[2], prev[1] + nz * offJ]);
          // cap band: a wharf-edge deck from the seaward lip back over the
          // ring to the land line (covers the crossing strip from above)
          wind(tile.curb,
            [prev[0] + nx * offJ, prev[2], prev[1] + nz * offJ],
            [px + nx * offJ, cur[2], pz + nz * offJ],
            [px - nx * 0.45, cur[2] - 0.04, pz - nz * 0.45],
            [prev[0] - nx * 0.45, prev[2] - 0.04, prev[1] - nz * 0.45]);
          // landward skirt: hides the terrain seam behind the wall
          wind(tile.curb,
            [px - nx * 0.45, cur[2] - 0.04, pz - nz * 0.45],
            [px - nx * 0.45, cur[2] - 1.6, pz - nz * 0.45],
            [prev[0] - nx * 0.45, prev[2] - 1.6, prev[1] - nz * 0.45],
            [prev[0] - nx * 0.45, prev[2] - 0.04, prev[1] - nz * 0.45]);
          // WW39: the piece's floats in the tile's curb soup and two points behind it, checked once the ground is final
          if (SA37) { const mx2 = (prev[0] + px) / 2, mz2 = (prev[1] + pz) / 2; wallPieces.push(tile, tile.curb.n - 54, mx2 - nx * 1.0, mz2 - nz * 1.0, mx2 - nx * 2.0, mz2 - nz * 2.0); }
          wallSegs++;
        }
        prev = cur;
      }
    }
  }
  log(' shoreline wall segments:', wallSegs, '| short edges left to the water as spikes and tips (WW39):', tipsSkipped, '| ring edges drawn short of a concave corner (SG40):', wallsShortened);
}
// SA37 SHORE APRONS. The drawn terrain is a 16 m grid, and where a shore runs across it the ground stopped in 16 m stairs
// up to ~20 m short of the land polygon: the bulkheads on the polygon's edge stood in the water as planks with water
// behind them (FiDi's Piers 15 to 17 and the East River esplanade, in the live set too). Per 1 m row of a 16 m-grid
// shore tile, each run of land between the polygon's own crossings (found as the pier raster finds them) is laid flat at
// the drawn land grade wherever the drawn grid under it is lower, out to the polygon's edge: the apron's edge stays
// within half a row of the ring, under the wall's cap band. A run reaches a ring edge only where that edge has its wall,
// so no slab stands over the water without a face (islets, lake shores and slivers keep their terrain). The 4 m pier
// tiles take them too (their stairs are 4 m); Columbia's 4 m tiles hold no shore. The runtime draws the section as
// terrain (assemble.js, matId 7).
// NO_SA37=1 leaves it out.
let apronTiles = 0, apronTris = 0, apronDropped = 0;
const apronRows = new Map();   // WW39: 1 m row (its z) -> the aprons' x spans [s, e, ...]
const apronSpans = [];   // SG40: [its tile's apron buffer, float offset, row z, s, e] per strip
const apronAt = (x, z) => { const a = apronRows.get(Math.floor(z)); if (a) for (let i = 0; i < a.length; i += 2) if (x >= a[i] - 0.05 && x <= a[i + 1] + 0.05) return true; return false; };
function shoreApron(t, grid) {
  const out = new F32(64);
  const R = resOf(t.tx, t.tz);
  if (!SA37 || (R !== RES && !pierTiles.has(t.tx + '_' + t.tz))) return out;
  const x0 = t.x0, z0 = t.z0, n = R + 1, C = TILE / R;
  const segs = new Map();
  const c0 = Math.floor(x0 / SHORE_CELL) - 1, c1 = Math.floor((x0 + TILE) / SHORE_CELL) + 1;
  const r0 = Math.floor(z0 / SHORE_CELL) - 1, r1 = Math.floor((z0 + TILE) / SHORE_CELL) + 1;
  for (let j = r0; j <= r1; j++) for (let i = c0; i <= c1; i++) {
    const a = SHORE.get(`${i}_${j}`); if (!a) continue;
    for (let k = 0; k < a.length; k += 4) segs.set(`${a[k]},${a[k + 1]},${a[k + 2]},${a[k + 3]}`, [a[k], a[k + 1], a[k + 2], a[k + 3]]);
  }
  if (!segs.size) return out;
  const E = [...segs.values()];
  const FY = BASE_Y - 0.12, LOW = FY - 0.25;   // assemble.js draws the grid 0.12 m under its samples
  const flatCell = (i, j) => grid[j * n + i] >= BASE_Y - 0.01 && grid[j * n + i + 1] >= BASE_Y - 0.01
    && grid[(j + 1) * n + i] >= BASE_Y - 0.01 && grid[(j + 1) * n + i + 1] >= BASE_Y - 0.01;
  const cuts = t.railCuts.map(([cx, cz, yaw, hl, hw]) => [cx + x0, cz + z0, Math.cos(yaw), Math.sin(yaw), hl + 1, hw + 1]);
  const inCut = (x, z) => cuts.some(([cx, cz, ux, uz, hl, hw]) => Math.abs((x - cx) * ux + (z - cz) * uz) <= hl && Math.abs(-(x - cx) * uz + (z - cz) * ux) <= hw);
  for (let r = 0; r < TILE; r++) {
    const za = z0 + r, zb = za + 1, z = za + 0.5;
    const xs = [];   // [x where the ring crosses the row's centre line, that segment's dx/dz]
    for (const [ax, az, bx, bz] of E) if ((az > z) !== (bz > z)) { const sl = (bx - ax) / (bz - az), x = ax + (z - az) * sl; if (x > x0 && x < x0 + TILE) xs.push([x, sl]); }
    if (!xs.length) continue;   // a row no shore crosses is all land (a flat grid) or all water
    xs.sort((a, b) => a[0] - b[0]);
    const ends = [x0, ...xs.map((c) => c[0]), x0 + TILE], slopes = [0, ...xs.map((c) => c[1]), 0];
    const jc = Math.min(R - 1, Math.floor((z - z0) / C));
    let land = onLand(x0 + 1e-3, z);
    for (let q = 0; q + 1 < ends.length; q++, land = !land) {
      const a = ends[q], b = ends[q + 1];
      if (!land || b - a < 0.05) continue;
      const m = Math.max(1, Math.ceil(b - a)), step = (b - a) / m;
      let k0 = -1;
      for (let k = 0; k <= m; k++) {
        let low = false;
        if (k < m) {
          const x = a + (k + 0.5) * step, ic = Math.min(R - 1, Math.floor((x - x0) / C));
          low = !flatCell(ic, jc) && sampleGrid(grid, t.tx, t.tz, x, z) - 0.12 < LOW;
        }
        if (low && k0 < 0) k0 = k;
        if (low || k0 < 0) continue;
        // a run of low samples k0 .. k - 1: out to the ring where it reaches an end, one sample into the flat grid
        // otherwise; an end on a ring edge needs that edge's wall
        const k1 = k - 1;
        const atA = k0 === 0 && q > 0, atB = k1 === m - 1 && q + 2 < ends.length;
        let s = k0 === 0 ? a : a + (k0 - 1) * step, e = k1 === m - 1 ? b : a + (k1 + 2) * step;
        k0 = -1;
        const wA = !atA || wallNear(a, z, 1.0), wB = !atB || wallNear(b, z, 1.0);
        if (inDbg((s + e) / 2, z)) sa37Dbg.runs.push([+s.toFixed(2), +e.toFixed(2), z, atA ? 1 : 0, atB ? 1 : 0, wA ? 1 : 0, wB ? 1 : 0]);
        if (!wA || !wB) { apronDropped++; continue; }
        const xm = (s + e) / 2;
        if (landingPadAt(xm, z) !== null) continue;
        if (cuts.length && (inCut(s, z) || inCut(xm, z) || inCut(e, z))) continue;
        // an end on the ring follows its segment across the row (a trapezoid), so the edge is the ring's own line and not
        // a 1 m sawtooth (it stays within 1.5 m of the row's crossing where a segment runs nearly along the row)
        const hA = atA ? Math.max(-1.5, Math.min(1.5, slopes[q] * 0.5)) : 0, hB = atB ? Math.max(-1.5, Math.min(1.5, slopes[q + 1] * 0.5)) : 0;
        let sT = s - hA, sB = s + hA, eT = e - hB, eB = e + hB;
        if (sT > eT) sT = eT = (sT + eT) / 2;
        if (sB > eB) sB = eB = (sB + eB) / 2;
        sT = Math.max(x0, sT); sB = Math.max(x0, sB); eT = Math.min(x0 + TILE, eT); eB = Math.min(x0 + TILE, eB);
        apronSpans.push(out, out.n, za, Math.min(sT, sB), Math.max(eT, eB));   // SG40
        pushTri(out, sT, FY, za, eB, FY, zb, eT, FY, za);
        pushTri(out, sT, FY, za, sB, FY, zb, eB, FY, zb);
        apronTris += 2;
        { let a = apronRows.get(za); if (!a) apronRows.set(za, (a = [])); a.push(Math.min(sT, sB), Math.max(eT, eB)); }   // WW39
      }
    }
  }
  if (out.n) apronTiles++;
  return out;
}

log('medians');
if (!process.env.NO_MEDIANS)
{
  const NC = 16, nodeGrid = new Map();
  for (const n of nodes.values()) {
    if ((n.ground || []).length < 1) continue; // ALL road ends repel medians
    const k = `${Math.floor(n.x / NC)}_${Math.floor(n.z / NC)}`;
    let a = nodeGrid.get(k); if (!a) nodeGrid.set(k, (a = []));
    a.push([n.x, n.z]);
  }
  const nearNode = (x, z, rad) => {
    const gx = Math.floor(x / NC), gz = Math.floor(z / NC), rr = Math.ceil(rad / NC);
    for (let dz2 = -rr; dz2 <= rr; dz2++) for (let dx2 = -rr; dx2 <= rr; dx2++) {
      const a = nodeGrid.get(`${gx + dx2}_${gz + dz2}`);
      if (a) for (const [px, pz] of a) if (Math.hypot(px - x, pz - z) < rad) return true;
    }
    return false;
  };
  const cand = roads.filter((r) => r.level === 0 && !r.noGeom && r.rclass <= 2 && r.oneway !== 0 && r.name && polylineLength(r.pts) > 24);
  const cell = 20, sgrid = new Map();
  for (let ri = 0; ri < cand.length; ri++) {
    const r = cand[ri], L = polylineLength(r.pts);
    for (let d = 4; d < L - 4; d += 7) {
      const [x, z, dx, dz] = alongPolyline(r.pts, d);
      const k = `${Math.floor(x / cell)}_${Math.floor(z / cell)}`;
      let a = sgrid.get(k); if (!a) sgrid.set(k, (a = []));
      a.push({ ri, x, z, dx, dz });
    }
  }
  const mRnd = mulberry(987654321);
  let mQuads = 0;
  const vertQuad = (buf, P1, P2, y0a, y0b, y1a, y1b) => { // both windings (orientation varies)
    pushQuad(buf, [P1[0], y0a, P1[1]], [P2[0], y0b, P2[1]], [P2[0], y1b, P2[1]], [P1[0], y1a, P1[1]]);
    pushQuad(buf, [P2[0], y0b, P2[1]], [P1[0], y0a, P1[1]], [P1[0], y1a, P1[1]], [P2[0], y1b, P2[1]]);
  };
  const upQuad = (buf, A3, B3, C3, D3) => {
    const up = (P, Q, S) => {
      if ((Q[2] - P[2]) * (S[0] - P[0]) - (Q[0] - P[0]) * (S[2] - P[2]) < 0) { pushTri(buf, P[0], P[1], P[2], S[0], S[1], S[2], Q[0], Q[1], Q[2]); }
      else pushTri(buf, P[0], P[1], P[2], Q[0], Q[1], Q[2], S[0], S[1], S[2]);
    };
    up(A3, B3, C3); up(A3, C3, D3);
  };
  for (let ri = 0; ri < cand.length; ri++) {
    const A = cand[ri], L = polylineLength(A.pts);
    const w2A = A.width / 2;
    let prev = null, sinceTree = 99;
    for (let d = 4; d < L - 4; d += 7) {
      const [x, z, dx, dz] = alongPolyline(A.pts, Math.min(d, L));
      let best = null, bestLat = 1e9;
      const gx = Math.floor(x / cell), gz = Math.floor(z / cell);
      for (let dz2 = -1; dz2 <= 1; dz2++) for (let dx2 = -1; dx2 <= 1; dx2++) {
        const a = sgrid.get(`${gx + dx2}_${gz + dz2}`);
        if (!a) continue;
        for (const s of a) {
          const B = cand[s.ri];
          if (B === A || B.name !== A.name || B.oneway === A.oneway || A.segId >= B.segId) continue;
          if (Math.abs(s.dx * dx + s.dz * dz) < 0.92) continue;
          const ox = s.x - x, oz = s.z - z;
          if (Math.abs(ox * dx + oz * dz) > 6) continue;
          const lat = Math.abs(ox * -dz + oz * dx);
          const gap = lat - w2A - B.width / 2;
          if (gap < 0.35 || gap > 12) continue;
          if (lat < bestLat) { bestLat = lat; best = { s, gap, B }; }
        }
      }
      let cur = null;
      if (best && !nearNode(x, z, 13) && !nearNode(best.s.x, best.s.z, 13)) {
        const side = Math.sign((best.s.x - x) * -dz + (best.s.z - z) * dx) || 1;
        const eA = [x - dz * side * w2A, z + dx * side * w2A];
        // B's edge point must be offset along B's OWN perpendicular (toward A),
        // never along the sample-connecting vector — staggered samples (lon up
        // to 6m) pushed the deck edge diagonally INTO B's carriageway
        const sideB = Math.sign((x - best.s.x) * -best.s.dz + (z - best.s.z) * best.s.dx) || 1;
        const eB = [best.s.x - best.s.dz * sideB * (best.B.width / 2), best.s.z + best.s.dx * sideB * (best.B.width / 2)];
        // deck height follows the carriageway profile (roadY), not raw terrain: on slopes the
        // terrain-based deck floated above or sank under the asphalt it sits between
        cur = { eA, eB, gap: best.gap, y: roadY(A, x, z, Math.min(d, L), L) };
      }
      if (cur && prev) {
        const midX = (cur.eA[0] + cur.eB[0]) / 2, midZ = (cur.eA[1] + cur.eB[1]) / 2;
        const exM = [A, best ? best.B : null];
        // converging carriageways: as the gap collapses the deck's edge points
        // cross into the roadway — floor the gap and test BOTH edge midpoints
        const mAx = (prev.eA[0] + cur.eA[0]) / 2, mAz = (prev.eA[1] + cur.eA[1]) / 2;
        const mBx = (prev.eB[0] + cur.eB[0]) / 2, mBz = (prev.eB[1] + cur.eB[1]) / 2;
        if (Math.min(prev.gap, cur.gap) < 1.2
          || inCarriageway(midX, midZ, sampleTerrain(midX, midZ) + 0.28, exM)
          || inCarriageway(mAx, mAz, sampleTerrain(mAx, mAz) + 0.28, exM)
          || inCarriageway(mBx, mBz, sampleTerrain(mBx, mBz) + 0.28, exM)) { prev = cur; continue; }
        const yA0 = prev.y, yA1 = cur.y;
        const yB0 = prev.y, yB1 = cur.y;
        const top = 0.135; // median deck sits at curb height above the roadbed
        const t = tileFor(midX, midZ);
        const g = Math.min(prev.gap, cur.gap);
        const T = (P, y) => [P[0], y, P[1]];
        if (g < 4.5) {
          upQuad(t.sidewalk, T(prev.eA, yA0 + top), T(cur.eA, yA1 + top), T(cur.eB, yB1 + top), T(prev.eB, yB0 + top));
        } else {
          // concrete edging + grass interior
          const ins = (P, Q, f) => [P[0] + (Q[0] - P[0]) * f, P[1] + (Q[1] - P[1]) * f];
          const fr = 0.7 / Math.max(1, g); // edge band fraction of the gap span
          const iA0 = ins(prev.eA, prev.eB, fr), iA1 = ins(cur.eA, cur.eB, fr);
          const iB0 = ins(prev.eB, prev.eA, fr), iB1 = ins(cur.eB, cur.eA, fr);
          upQuad(t.sidewalk, T(prev.eA, yA0 + top), T(cur.eA, yA1 + top), T(iA1, yA1 + top), T(iA0, yA0 + top));
          upQuad(t.sidewalk, T(iB0, yB0 + top), T(iB1, yB1 + top), T(cur.eB, yB1 + top), T(prev.eB, yB0 + top));
          // planted bed RAISED 5 cm above the edging: a Broadway/Lenox median is a
          // soil bed behind its curb. It also has to sit above the pavement field's
          // median-side fill (walk top), which otherwise hid every planted median
          // (critic round 3: "medians are kerbs with nothing in them")
          upQuad(t.grass, T(iA0, yA0 + top + 0.05), T(iA1, yA1 + top + 0.05), T(iB1, yB1 + top + 0.05), T(iB0, yB0 + top + 0.05));
          sinceTree += 7;
          if (sinceTree > 9 && g > 5.5) {
            sinceTree = 0;
            // TC13: p2 bit 2 = PLANTED MEDIAN. A bed between two carriageways is
            // 3-9 m wide and its trees are kept small; the runtime caps this bit
            // at ~8.4 m tall with a crown that stays inside the bed (critic-r13
            // fix 9: "the Lenox median carries clone trees four storeys tall
            // that span the median plus half the carriageway").
            if (mRnd() < 0.8) t.furn.push({ k: FURN.TREE, x: midX, y: cur.y + 0.185, z: midZ, rot: mRnd() * 6.28, p0: [1, 5, 7, 2][(mRnd() * 4) | 0], p1: 10 + ((mRnd() * 22) | 0), p2: 4 });
          }
        }
        vertQuad(t.curb, prev.eA, cur.eA, yA0, yA1, yA0 + top, yA1 + top);
        vertQuad(t.curb, prev.eB, cur.eB, yB0, yB1, yB0 + top, yB1 + top);
        mQuads++;
      } else if (prev && !cur) {
        // end cap: close the median nose with a curb across
        const t = tileFor(prev.eA[0], prev.eA[1]);
        const yA0 = prev.y, yB0 = prev.y;
        vertQuad(t.curb, prev.eA, prev.eB, yA0, yB0, yA0 + 0.135, yB0 + 0.135);
      }
      prev = cur;
    }
  }
  log(' median strips:', mQuads);
}

// ---------------------------------------------------------------- street lamps along roads
log('lamps');
for (const r of roads) {
  if (r.rclass > 3 || r.level > 0 || r.cut) continue;   // (RG44: not over a cut's hole)
  const L = polylineLength(r.pts);
  const spacing = r.rclass === 2 ? 30 : 36;
  const histCrook = false; // bishop's crook in historic districts — refine later
  let side = hash2(r.pts[0][0] | 0, r.pts[0][1] | 0) < 0.5 ? 1 : -1;
  for (let d = spacing * 0.5; d < L; d += spacing) {
    const [x, z, dx, dz] = alongPolyline(r.pts, d);
    const nx = -dz * side, nz = dx * side;
    side = -side;
    const px = x + nx * (r.width / 2 + 0.7), pz = z + nz * (r.width / 2 + 0.7);
    const t = tileFor(px, pz);
    t.furn.push({
      k: histCrook ? FURN.LAMP_CROOK : FURN.LAMP_COBRA, x: px, y: sampleTerrain(px, pz) + FURN_LIFT, z: pz,
      rot: Math.atan2(-nx, -nz), p0: 0, p1: 0,
    });
    // regulation sign poles between lamps; occasional dumpster on side streets
    if (hash2((x * 3) | 0, (z * 3) | 0) < 0.6) {
      const [sx, sz, sdx, sdz] = alongPolyline(r.pts, Math.min(L - 1, d + spacing * 0.5));
      const spx = sx - sdz * -side * (r.width / 2 + 0.55), spz = sz + sdx * -side * (r.width / 2 + 0.55);
      const ts = tileFor(spx, spz);
      // p1 bit 0: the street is one-way, so the pole may carry a MUTCD R6-1 ONE WAY blade. Two-way streets
      // (Amsterdam Ave, W 120th — owner 2026-09-15, docs/notes/amst120.md) get the parking-regulation sign only.
      ts.furn.push({ k: 34, x: spx, y: sampleTerrain(spx, spz) + FURN_LIFT, z: spz, rot: Math.atan2(sdx, sdz) + (r.oneway !== 0 ? (r.oneway > 0 ? 0 : Math.PI) : 0), p0: 0, p1: r.oneway !== 0 ? 1 : 0 });
    }
    if (r.rclass === 1 && hash2((x * 7) | 0, (z * 5) | 0) < 0.05) {
      const dpx = x + nx * (r.width / 2 + 1.7), dpz = z + nz * (r.width / 2 + 1.7);
      const td = tileFor(dpx, dpz);
      td.furn.push({ k: 38, x: dpx, y: sampleTerrain(dpx, dpz) + FURN_LIFT, z: dpz, rot: Math.atan2(dx, dz), p0: 0, p1: 0 });
    }
  }
}

// ---------------------------------------------------------------- point datasets -> furniture
log('point furniture');
const censusTrees = [];   // TI14: every census street tree placed, for the avenue infill pass below
function addPoints(file, kind, opts = {}) {
  const fp = path.join(RAW, file);
  if (!fs.existsSync(fp)) return 0;
  let count = 0;
  const place = (lon, lat, p0 = 0, p1 = 0, p2 = 0) => {
    const [x, z] = project(lon, lat);
    if (x < WX0 - 200 || x > WX1 + 200 || z < WZ0 - 200 || z > WZ1 + 200) return;
    if (!onLand(x, z)) return;
    const t = tileFor(x, z);
    // NYC objects align with the street grid: use road DIRECTION, not a point-facing angle
    const nr = (opts.faceRoad || opts.treeMode) ? nearestRoad(x, z, 30) : null;
    const rot = nr ? Math.atan2(nr.dirx, nr.dirz) : hash2(x | 0, z | 0) * 6.28;
    t.furn.push({ k: kind, x, y: sampleTerrain(x, z) + FURN_LIFT, z, rot, p0, p1, p2 });
    if (opts.treeMode) censusTrees.push({ x, z, sp: p0, dbh: p1 });   // TI14
    count++;
  };
  if (file.endsWith('.geojson')) {
    for (const f of loadJSON(file).features) {
      if (!f.geometry) continue;
      const c = f.geometry.type === 'Point' ? f.geometry.coordinates : f.geometry.coordinates[0];
      place(c[0], c[1]);
    }
  } else {
    for (const r of loadCSV(file)) {
      const lat = parseFloat(r.latitude ?? r.entrance_latitude), lon = parseFloat(r.longitude ?? r.entrance_longitude);
      if (!isFinite(lat) || !isFinite(lon)) continue;
      if (opts.treeMode) {
        const species = (r.spc_common || '').toLowerCase();
        let sp = 0;
        if (species.includes('planetree')) sp = 1; else if (species.includes('honeylocust')) sp = 2;
        else if (species.includes('pear')) sp = 3; else if (species.includes('ginkgo')) sp = 4;
        else if (species.includes('oak')) sp = 5; else if (species.includes('linden')) sp = 6;
        else if (species.includes('maple')) sp = 7; else if (species.includes('cherry')) sp = 8;
        // AR34 (TREES): the city's sophoras, Japanese zelkovas, ashes and elms were class 0 (a position-hashed form);
        // furnitureKit's TREE_SPECIES rows 9-12 draw them. 'ash' as a word: "washington hawthorn" contains it.
        else if (species.includes('sophora')) sp = 9; else if (species.includes('zelkova')) sp = 10;
        else if (/\bash\b/.test(species)) sp = 11; else if (/\belm\b/.test(species)) sp = 12;
        const dbh = Math.min(255, parseInt(r.tree_dbh) || 8);
        place(lon, lat, sp, dbh, 1); // p2=1 marks census street trees (get pit fences)
      } else place(lon, lat);
    }
  }
  return count;
}
log(' trees:', addPoints(`trees_${BOROS[0]}.csv`, FURN.TREE, { treeMode: true }));
for (const b of BOROS.slice(1)) log(' trees:', addPoints(`trees_${b}.csv`, FURN.TREE, { treeMode: true }));
// ---------------------------------------------------------------- TI14: avenue street-tree infill
// (critic r14 #8 / FD14 notes): Amsterdam Ave at W 120th has 15 census trees within 60 m of the camera where the
// Street View block shows one every ~8 m on both kerbs — the 2015 TreesCount census predates a decade of Parks
// plantings, and the canopy the critic measures (0.8 % of frame vs 9.5 %) is bounded by the COUNT, not the crown size.
// Rule, deliberately conservative: only on avenues (rclass <= 2, >= 12 m wide, named, at grade, with traffic), only on a
// kerb that ALREADY carries census trees, and only inside a gap of 16-45 m between two consecutive census trees on the
// same kerb — a densification of planted rows, never a planting of a treeless avenue or a plaza. Infill trees sit 1.3 m
// inside the kerb line, need >= 3 m of walk (r.segBw), stay 12 m clear of the block ends (crosswalks, corner clearances)
// and off the median side of a divided avenue. Species copies the nearer neighbour; dbh 9-13 (young). NO_TREEFILL=1 skips.
if (!process.env.NO_TREEFILL) {
  const cumArc = (r) => { const c = [0]; for (let i = 1; i < r.pts.length; i++) c.push(c[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1])); return c; };
  const arcCache = new Map();
  const arcOf = (r) => { let c = arcCache.get(r); if (!c) arcCache.set(r, (c = cumArc(r))); return c; };
  // foot of (x,z) on r: arc distance, segment index, and the signed side (+1 = the (-dz, dx) side, as paintStrip)
  const footOn = (r, x, z) => {
    let best = null;
    for (let i = 1; i < r.pts.length; i++) {
      const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - x1) * dx + (z - z1) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = x1 + dx * t, pz = z1 + dz * t, dist = Math.hypot(x - px, z - pz);
      if (!best || dist < best.dist) { const Ls = Math.sqrt(L2); best = { dist, i: i - 1, t, side: ((x - px) * (-dz / Ls) + (z - pz) * (dx / Ls)) >= 0 ? 1 : -1 }; }
    }
    if (!best) return null;
    const c = arcOf(r); best.d = c[best.i] + best.t * (c[best.i + 1] - c[best.i]);
    return best;
  };
  const posAt = (r, d) => {
    const c = arcOf(r); let i = 1; while (i < c.length - 1 && c[i] < d) i++;
    const [x1, z1] = r.pts[i - 1], [x2, z2] = r.pts[i]; const segL = (c[i] - c[i - 1]) || 1e-9; const t = Math.max(0, Math.min(1, (d - c[i - 1]) / segL));
    return { x: x1 + (x2 - x1) * t, z: z1 + (z2 - z1) * t, dirx: (x2 - x1) / segL, dirz: (z2 - z1) / segL, i: i - 1 };
  };
  const rows = new Map();   // road -> { 1: [...], -1: [...] } of { d, sp, dbh }
  for (const t of censusTrees) {
    const nr = nearestRoad(t.x, t.z, 12);
    if (!nr) continue;
    const r = nr.r;
    if (r.rclass > 2 || r.level !== 0 || r.noGeom || r.noTraffic || r.width < 12 || !r.name) continue;
    if (nr.d < -0.5 || nr.d > 7) continue;                       // on the walk: not in the roadway, not in a rear yard
    const ft = footOn(r, t.x, t.z); if (!ft) continue;
    let row = rows.get(r); if (!row) rows.set(r, (row = { 1: [], [-1]: [] }));
    row[ft.side].push({ d: ft.d, sp: t.sp, dbh: t.dbh });
  }
  let added = 0, gaps = 0;
  for (const [r, row] of rows) {
    const L = polylineLength(r.pts);
    for (const side of [1, -1]) {
      if ((r.divided > 0 && side > 0) || (r.divided < 0 && side < 0)) continue;   // the median side plants its own
      const arr = row[side].sort((p, q) => p.d - q.d);
      for (let k = 1; k < arr.length; k++) {
        const g = arr[k].d - arr[k - 1].d;
        if (g < 16 || g > 45) continue;
        gaps++;
        const n = Math.max(1, Math.round(g / 9) - 1);
        for (let m = 1; m <= n; m++) {
          const d = arr[k - 1].d + (g * m) / (n + 1);
          if (d < 12 || d > L - 12) continue;
          const p = posAt(r, d);
          const bw = r.segBw ? (r.segBw[Math.min(p.i, r.segBw.length - 1)] || [0, 0])[side > 0 ? 0 : 1] : 4;
          if (bw < 3.0) continue;
          const nx = -p.dirz * side, nz = p.dirx * side;
          const off = r.width / 2 + 1.3;
          const x = p.x + nx * off, z = p.z + nz * off;
          if (!onLand(x, z)) continue;
          const near = arr[k - 1], far = arr[k];
          const src = (d - near.d) < (far.d - d) ? near : far;
          const t = tileFor(x, z);
          t.furn.push({ k: FURN.TREE, x, y: sampleTerrain(x, z) + FURN_LIFT, z, rot: Math.atan2(p.dirx, p.dirz), p0: src.sp, p1: 9 + ((hash2((x * 3) | 0, (z * 3) | 0) * 5) | 0), p2: 1 });
          added++;
        }
      }
    }
  }
  log(' TI14 avenue tree infill:', added, 'trees in', gaps, 'census gaps of 16-45 m on', rows.size, 'avenues');
}
log(' hydrants:', addPoints('hydrants.geojson', FURN.HYDRANT));
log(' shelters:', addPoints('shelters.geojson', FURN.BUS_SHELTER, { faceRoad: true }));
log(' linknyc:', addPoints('linknyc.geojson', FURN.LINKNYC, { faceRoad: true }));
log(' subway:', addPoints('subway.csv', FURN.SUBWAY_ENTRANCE, { faceRoad: true }));
log(' bikeracks:', addPoints('bikeracks.geojson', FURN.BIKE_RACK, { faceRoad: true }));

// ---------------------------------------------------------------- TC13 backyard trees
// THE BLOCK INTERIORS ARE BARE. Every leaf-on aerial reference of the low fabric
// (Bedford Ave, the brownstones of W 122nd St) shows the
// inside of a rowhouse block as a near-continuous canopy of grown rear-yard
// trees, and the r13 critic scored it twice: "Solid block interiors. No rear
// yards, no extensions, no backyard trees" (Williamsburg tell 5) and "B's trees
// cover perhaps a fifth of the frame; ours are countable stick figures" (tell
// 7). The only trees we have ever emitted are the DPR STREET-tree census, which
// by definition stops at the kerb.
//
// A rear yard is the space behind a NON-STREET, NON-PARTY edge of a low
// footprint. The party-wall pass above already marks every edge that abuts a
// neighbour (b.blind bit i) — those are the side walls of a rowhouse and are
// NOT rear walls — so the rear elevation is the surviving edge whose outward
// normal points furthest AWAY from the street the building fronts. Everything
// is seeded off the footprint centroid, so a recompile plants the same trees.
// NO_TC13=1 for an A/B compile.
log('backyard trees (TC13)');
{
  const TC13 = process.env.NO_TC13 !== '1';
  const st = { noEdge: 0, shallow: 0, blocked: 0, yard: 0, second: 0, vacant: 0, boro: {} };
  if (TC13) {
    // footprint index: "is this point built on?" in a 32 m hash. A candidate
    // may never land inside a footprint — and because a light court is inside
    // its building's OUTER ring, testing the outer ring alone also keeps every
    // tree out of the CY12 courtyards for free.
    const BC = 32, bg = new Map();
    for (const b of buildings) {
      if (b.drop || !b.ring || b.ring.length < 3) continue;
      const bb = ringBBox(b.ring);
      const rec = { ring: b.ring, x0: bb[0], z0: bb[1], x1: bb[2], z1: bb[3] };
      for (let i = Math.floor(bb[0] / BC); i <= Math.floor(bb[2] / BC); i++)
        for (let j = Math.floor(bb[1] / BC); j <= Math.floor(bb[3] / BC); j++) {
          const k = `${i}_${j}`; let a = bg.get(k); if (!a) bg.set(k, (a = [])); a.push(rec);
        }
    }
    const built = (x, z) => {
      const a = bg.get(`${Math.floor(x / BC)}_${Math.floor(z / BC)}`);
      if (!a) return false;
      for (const r of a) {
        if (x < r.x0 - 0.5 || x > r.x1 + 0.5 || z < r.z0 - 0.5 || z > r.z1 + 0.5) continue;
        if (pointInPoly(x, z, r.ring)) return true;
      }
      return false;
    };
    // yard trees are what grows in a back lot: Norway/silver maple, cherry,
    // oak, pear, linden — never the London plane, which is a STREET tree the
    // Parks Department plants in a pit. p0 indexes TREE_SPECIES in furnitureKit.
    const YSP = [7, 8, 5, 3, 6, 7, 0];
    for (const b of buildings) {
      if (b.drop || !b.c || !b.ring || b.ring.length < 3 || b.landmarkId) continue;
      if (b.h > 26) continue;                        // rear yards belong to the low fabric
      const boro = b.boro || 0;
      // "roughly one tree per 2-3 rear yards in a rowhouse block, dense in
      // Brooklyn and Queens" — and the taller the building, the more of its
      // back lot is extension, parking and paving rather than garden.
      let p = (boro === 3 || boro === 4) ? 0.56 : (boro === 2 || boro === 5) ? 0.48 : 0.34;
      p *= b.h < 14 ? 1 : b.h < 20 ? 0.75 : 0.45;
      const rnd = mulberry((hash2(b.cx * 7.1 + 13, b.cz * 7.1 + 29) * 1e9) | 0);
      if (rnd() > p) continue;
      // the street this building fronts (one lookup, the same one classify does)
      const nr = nearestRoad(b.cx, b.cz, 60);
      const frx = nr ? nr.px - b.cx : 0, frz = nr ? nr.pz - b.cz : 0;
      const frL = Math.hypot(frx, frz) || 1;
      const n = Math.min(b.ring.length, 32);
      let best = null;
      for (let i = 0; i < n; i++) {
        if ((b.blind >> i) & 1) continue;            // party wall: a side, never a rear
        const [x1, z1] = b.ring[i], [x2, z2] = b.ring[(i + 1) % n];
        const ex = x2 - x1, ez = z2 - z1, len = Math.hypot(ex, ez);
        if (len < 3.5) continue;
        const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
        let nx = -ez / len, nz = ex / len;           // outward = the side that is not inside
        if (pointInPoly(mx + nx * 0.6, mz + nz * 0.6, b.ring)) { nx = -nx; nz = -nz; }
        const away = nr ? -(nx * frx + nz * frz) / frL : 1;
        // PROBED on the compiled tiles before committing to a compile
        // (.tc13tmp/yardprobe.mjs, tiles_dev24 at Bedford & N 7th, 125th &
        // Lenox and W 121st): ~100 % of low footprints have SOME edge with 20 m
        // of open ground beyond it, because the street counts as open ground.
        // So the road filter is the whole test, and 0.25 was far too loose — a
        // genuine rear wall points hard away from the frontage.
        if (away < 0.42) continue;                   // a front or a side elevation
        const score = away * len;
        if (!best || score > best.score) best = { mx, mz, nx, nz, len, score };
      }
      if (!best) { st.noEdge++; continue; }
      // how deep is the yard before the next building's rear wall? Capped at
      // 14 m: past that the probe has stopped measuring a yard and started
      // measuring a street, a park or the next block.
      let depth = 0;
      for (let d = 2; d <= 14; d += 2) {
        if (built(best.mx + best.nx * d, best.mz + best.nz * d)) break;
        depth = d;
      }
      if (depth < 4) { st.shallow++; continue; }
      const ux = -best.nz, uz = best.nx;             // along the rear wall
      const place = (d, off, sp, dbh) => {
        const px = best.mx + best.nx * d + ux * off, pz = best.mz + best.nz * d + uz * off;
        if (built(px, pz) || built(px + best.nx * 1.3, pz + best.nz * 1.3)) return false;
        if (!onLand(px, pz)) return false;
        const ty = sampleTerrain(px, pz);
        if (inCarriageway(px, pz, ty + 0.3, null, 0.8)) return false;
        const nr2 = nearestRoad(px, pz, 16);
        if (nr2 && nr2.d < 5.5) return false;        // that is the sidewalk, not a back lot
        tileFor(px, pz).furn.push({
          k: FURN.TREE, x: px, y: ty + FURN_LIFT, z: pz, rot: rnd() * 6.28,
          p0: sp, p1: dbh, p2: 2,                    // p2 bit 1 = YARD (assemble.js sizes it down)
        });
        return true;
      };
      const off0 = (rnd() - 0.5) * Math.min(best.len * 0.55, 7);
      const d0 = Math.min(depth * 0.5 + 1.5, depth - 1.5);
      if (!place(d0, off0, YSP[(rnd() * YSP.length) | 0], 6 + ((rnd() * 15) | 0))) { st.blocked++; continue; }
      st.yard++; st.boro[boro] = (st.boro[boro] || 0) + 1;
      // a deep outer-borough yard carries more than one
      if (depth > 9 && rnd() < ((boro === 3 || boro === 4) ? 0.45 : 0.22)
        && place(Math.min(d0 + 3.5, depth - 1.5), off0 + (rnd() < 0.5 ? -1 : 1) * (3.5 + rnd() * 3),
          YSP[(rnd() * YSP.length) | 0], 5 + ((rnd() * 12) | 0))) st.second++;
      // …and 12 m of open ground behind a rowhouse rear wall is not a garden,
      // it is a VACANT LOT — the ailanthus/mulberry stand that grows in every
      // one of them, which is the other thing the reference stills are full of.
      // (place() still has to clear it of footprints, roadway and sidewalk.)
      if (depth >= 12 && rnd() < 0.35
        && place(depth - 1.5 - rnd() * 3, (rnd() - 0.5) * 11, YSP[(rnd() * YSP.length) | 0], 8 + ((rnd() * 16) | 0))) st.vacant++;
    }
  }
  log(' TC13 yard trees:', st.yard, '(+', st.second, 'second tree, +', st.vacant, 'vacant-lot)',
    '| per borough', JSON.stringify(st.boro),
    '| skipped: no rear edge', st.noEdge, ', yard under 4 m', st.shallow, ', point blocked', st.blocked);
}

// ---------------------------------------------------------------- parks
log('parks');
// ---------------------------------------------------------------- divided-avenue planted malls
// Lenox / ACP / Frederick Douglass / Park Ave north of 96th / Allen / Broadway (north of 59th)
// carry a raised planted mall between the twin carriageways: grass in a concrete kerb, cut
// back ~12 m from every cross street for the paved pedestrian refuge. The twin-side sidewalk
// band already fills the gap with concrete (the refuge); the bed sits 10 cm above it.
{
  const MALL_Y = FLAT ? BASE_Y + 0.28 + 0.10 : null;
  const distToPoly = (pts, x, z) => {
    let best = 1e9;
    for (let i = 1; i < pts.length; i++) {
      const [x1, z1] = pts[i - 1], [x2, z2] = pts[i];
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      best = Math.min(best, Math.hypot(x - x1 - dx * t, z - z1 - dz * t));
    }
    return best;
  };
  const pushGrassTri = (A, B, C) => {
    if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) < 0) { const T = B; B = C; C = T; }
    const t = tileFor((A[0] + B[0] + C[0]) / 3, (A[2] + B[2] + C[2]) / 3);
    pushTri(t.grass, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
  };
  let malls = 0, quads = 0;
  for (const r of roads) {
    if (!r.twin || !r.divided || r.noGeom || r.level !== 0 || r.rclass > 2) continue;
    const tw = r.twin;
    if (tw.twin === r && !((r.segId || 0) < (tw.segId || 0) || (r.segId === tw.segId && r.pts[0][0] < tw.pts[0][0]))) continue; // one bed per pair
    const gap = r.medGap;
    if (!(gap >= 3.2 && gap <= 12)) continue;                   // 3.2-12 m between the carriageway edges
    const o1 = r.width / 2 + 0.9, o2 = r.width / 2 + gap - 0.9;   // 0.9 m concrete edge each side
    if (o2 - o1 < 1.2) continue;
    const L = polylineLength(r.pts);
    if (L < 30) continue;
    const s = r.divided;
    const corner = (d, o) => {
      const [x, z, dx, dz] = alongPolyline(r.pts, d);
      const nx = -dz * s, nz = dx * s;
      const px = x + nx * o, pz = z + nz * o;
      return [px, MALL_Y !== null ? MALL_Y : sampleTerrain(px, pz) + 0.38, pz];
    };
    let emitted = 0;
    for (let d = 12; d + 4 <= L - 12; d += 4) {
      const cA = corner(d, o1), cB = corner(d + 4, o1), cC = corner(d + 4, o2), cD = corner(d, o2);
      const mx = (cA[0] + cC[0]) / 2, mz = (cA[2] + cC[2]) / 2;
      // the twin must run alongside here at the expected distance, and no carriageway may cross
      const dt = distToPoly(tw.pts, mx, mz);
      if (dt < tw.width / 2 + 0.6 || dt > tw.width / 2 + gap * 0.75 + 1.5) continue;
      if (inCarriageway(mx, mz, (FLAT ? BASE_Y : sampleTerrain(mx, mz)) + 0.2, null, 0.4)) continue;
      pushGrassTri(cA, cB, cC); pushGrassTri(cA, cC, cD);
      emitted++;
    }
    if (emitted) { malls++; quads += emitted; }
  }
  log('divided-avenue malls:', malls, 'beds,', quads, 'quads');
}
// hand-placed campus lawns — superseded by the OSM campus extract when present
const HAVE_CAMPUS = fs.existsSync('data/columbia_campus.json');
const EXTRA_LAWNS = HAVE_CAMPUS ? [] : [
  [[-73.96310, 40.80585], [-73.96245, 40.80585], [-73.96245, 40.80665], [-73.96310, 40.80665]],
  [[-73.96205, 40.80585], [-73.96140, 40.80585], [-73.96140, 40.80665], [-73.96205, 40.80665]],
  [[-73.96297, 40.80755], [-73.96250, 40.80755], [-73.96250, 40.80800], [-73.96297, 40.80800]],
  [[-73.96185, 40.80755], [-73.96138, 40.80755], [-73.96138, 40.80800], [-73.96185, 40.80800]],
];
for (const lonlat of EXTRA_LAWNS) {
  const ring = lonlat.map(([lon, lat]) => project(lon, lat));
  if (signedArea(ring) > 0) ring.reverse(); // shoelace-negative = face-up (z-south)
  const flat = ring.flat();
  const tris = earcut(flat);
  for (let i = 0; i < tris.length; i += 3) {
    const pts3 = [tris[i], tris[i + 1], tris[i + 2]].map((vi) => {
      const x = flat[vi * 2], z = flat[vi * 2 + 1];
      return drapeVert(x, z, LAWN_LIFT - 0.01);
    });
    subdivTri(pts3[0], pts3[1], pts3[2], LAWN_LIFT - 0.01, emitGrass);
  }
}
// one park polygon (projected rings: outer first, then holes): lawn draped on the ground, park trees scattered over it
// (`treeArea` m2 of lawn per tree; 0 = none). NYC Parks properties, the New Jersey landing patches and Gateway's land
// cover all come through here.
const parkOuters = [];   // NYC Parks outlines, so Gateway's cover does not lay a second lawn over one
function parkPolygon(rings, treeArea = 260, lawn = true) {
  {
    {
      const outer = simplifyRing(rings[0], 1.2);
      if (outer.length < 3) return;
      if (lawn) {
      const flat = [], holeIdx = [];
      for (const p of outer) flat.push(p[0], p[1]);
      for (let hi = 1; hi < rings.length; hi++) {
        const h = simplifyRing(rings[hi], 1.5);
        if (h.length < 3) continue;
        holeIdx.push(flat.length / 2);
        for (const p of h) flat.push(p[0], p[1]);
      }
      const tris = earcut(flat, holeIdx.length ? holeIdx : null);
      for (let i = 0; i < tris.length; i += 3) {
        const pts3 = [tris[i], tris[i + 1], tris[i + 2]].map((vi) => {
          const x = flat[vi * 2], z = flat[vi * 2 + 1];
          return drapeVert(x, z, LAWN_LIFT);
        });
        subdivTri(pts3[0], pts3[1], pts3[2], LAWN_LIFT, emitGrass, 0, 10); // 10 m leaves: lawns hug the (now real) park relief
      }
      }
      // scatter park trees
      const bb = ringBBox(outer);
      const area = Math.abs(signedArea(outer));
      const nTrees = treeArea > 0 ? Math.min(1400, Math.floor(area / treeArea)) : 0;
      const rnd = mulberry((hash2(bb[0] | 0, bb[1] | 0) * 1e9) | 0);
      for (let i = 0; i < nTrees; i++) {
        const x = bb[0] + rnd() * (bb[2] - bb[0]), z = bb[1] + rnd() * (bb[3] - bb[1]);
        if (!pointInPoly(x, z, outer)) continue;
        if (!onLand(x, z)) continue;
        const t = tileFor(x, z);
        t.furn.push({ k: FURN.TREE, x, y: sampleTerrain(x, z) + (FLAT ? LAWN_LIFT : 0), z, rot: rnd() * 6.28, p0: [1, 5, 7, 2][((rnd() * 4) | 0)], p1: 10 + ((rnd() * 26) | 0) }); // park trees stand on the lawn, not the terrain plane
      }
    }
  }
}
for (const b of BOROS) {
  const f = `parks_${b}.geojson`;
  if (!fs.existsSync(path.join(RAW, f))) continue;
  const fc = loadJSON(f);
  for (const feat of fc.features) {
    const g = feat.geometry; if (!g) continue;
    const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    for (const poly of polys) {
      const rings = poly.map((ring) => ring.map(([lon, lat]) => project(lon, lat)));
      if (rings[0].length >= 3) parkOuters.push({ ring: rings[0], bb: ringBBox(rings[0]) });
      parkPolygon(rings);
    }
  }
}
// the New Jersey landing patches read as the wooded shore they are (the Palisades, the Kill Van Kull and Arthur Kill
// waterfront parks round the abutments), not as bare ground
// (only inside the loaded data's tile range: a partial --boro run must not write lawn-only tiles over a borough it lacks)
const inTileRange = (x, z) => { const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE); return tx >= TX0 && tx <= TX1 && tz >= TZ0 && tz <= TZ1; };
for (const L of LAND) if (L.landing && inTileRange((L.bbox[0] + L.bbox[2]) / 2, (L.bbox[1] + L.bbox[3]) / 2)) parkPolygon([L.outer], L.padY != null ? 140 : 320);
// GATEWAY NATIONAL RECREATION AREA (federal land the NYC Parks file does not hold: Fort Wadsworth, Miller Field, Jacob
// Riis Park, Fort Tilden, Breezy Point Tip, Floyd Bennett Field, the Jamaica Bay Wildlife Refuge, Canarsie Pier, Plumb
// Beach). data/raw/osm_gateway.json (OSM, ODbL; tools/pipeline/fetch_osm_extras.mjs) holds each unit's outline and the
// land cover in its box: grass, meadow, park and wetland become lawn, wood and scrub lawn with dense trees; beaches and
// sand stay bare. Largest first; one inside another adds only its trees (no second lawn on the first); a unit with
// under three cover areas inside it is laid as one lawn (its sand cut out as holes).
if (fs.existsSync(path.join(RAW, 'osm_gateway.json'))) {
  const GW = loadJSON('osm_gateway.json');
  const inPark = (x, z) => parkOuters.some((p) => x >= p.bb[0] && x <= p.bb[2] && z >= p.bb[1] && z <= p.bb[3] && pointInPoly(x, z, p.ring));
  let nArea = 0, nUnitFill = 0;
  for (const [key, G] of Object.entries(GW)) {
    const units = G.units.flatMap((u) => u.rings.map((r) => r.map(([lon, lat]) => project(lon, lat))));
    if (!units.length) continue;
    const inUnit = (x, z) => units.some((r) => pointInPoly(x, z, r));
    const cand = [];
    for (const c of G.cover) for (const ring of c.rings) {
      const r = ring.map(([lon, lat]) => project(lon, lat));
      if (r.length < 4) continue;
      const [cx, cz] = centroid(r);
      if (!inTileRange(cx, cz) || !BOROS.includes(boroAt(cx, cz))) continue;
      if (!inUnit(cx, cz) || !onLand(cx, cz) || boroAt(cx, cz) === 0 || inPark(cx, cz)) continue;
      cand.push({ kind: c.kind, r, cx, cz, area: Math.abs(signedArea(r)) });
    }
    cand.sort((a, b) => b.area - a.area);
    const laid = [];
    let nHere = 0;
    for (const c of cand) {
      if (c.kind === 'sand') continue;
      const under = laid.some((l) => pointInPoly(c.cx, c.cz, l));
      if (under && c.kind !== 'wood') continue;
      parkPolygon([c.r], c.kind === 'wood' ? 90 : c.kind === 'wetland' ? 0 : 700, !under);
      if (!under) laid.push(c.r);
      nHere++;
    }
    if (nHere < 3) for (const r of units) {
      const [cx, cz] = centroid(r);
      if (!onLand(cx, cz) || !BOROS.includes(boroAt(cx, cz)) || !inTileRange(cx, cz)) continue;
      const holes = cand.filter((c) => c.kind === 'sand' && c.r.every(([x, z]) => pointInPoly(x, z, r))).map((c) => c.r);
      parkPolygon([r, ...holes], 500);
      nUnitFill++;
    }
    nArea += nHere;
  }
  log(' Gateway National Recreation Area:', nArea, 'land-cover areas laid,', nUnitFill, 'unit outlines laid whole');
}

// ---------------------------------------------------------------- Columbia campus (OSM micro-map -> lawns/paths/brick/trees/benches; rest to runtime kit)
if (HAVE_CAMPUS && BOROS.includes(1)) { // campus is Manhattan data: a partial non-1 run must not emit its tiles
  log('columbia campus');
  const C = JSON.parse(fs.readFileSync('data/columbia_campus.json', 'utf8'));
  const IN = (x, z) => x > 540 && x < 1125 && z > -3070 && z < -2510; // campus + immediate frontages
  // ---- lawns (real shapes: South Field, Butler commons, Van Am quad...)
  let nLawn = 0;
  const lawnPoly = (pts, lift, emit = emitGrass) => {
    const ring = pts.map((p) => [p[0], p[1]]);
    if (ring.length < 3 || !IN(ring[0][0], ring[0][1])) return;
    const flat = ring.flat();
    const tris = earcut(flat);
    for (let i = 0; i < tris.length; i += 3) {
      const p3 = [tris[i], tris[i + 1], tris[i + 2]].map((vi) => {
        const x = flat[vi * 2], z = flat[vi * 2 + 1];
        return [x, sampleTerrain(x, z) + lift, z];
      });
      // fine subdivision (9m < terrain cell) — a 24m leaf spans grid diagonals
      // and lets the drawn terrain triangles poke through the lawn
      subdivTri(p3[0], p3[1], p3[2], lift, emit, 0, 9);
    }
    nLawn++;
  };
  // campus-axis helpers (rel. Alma along axis)
  const axisC = (x, z) => { const dx = x - 764.23, dz = z + 2747.81; return [dx * PAD_AX + dz * PAD_AZ, dx * -PAD_AZ + dz * PAD_AX]; };
  const relW = (a2, c2) => [+(764.23 + PAD_AX * a2 - PAD_AZ * c2).toFixed(2), +(-2747.81 + PAD_AZ * a2 + PAD_AX * c2).toFixed(2)];
  const inPlazaZone = (x, z) => { const [a2, c2] = axisC(x, z); return a2 > -46 && a2 < -2 && Math.abs(c2) < 54; };
  const centroidOf = (pts) => pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  // Low Plaza parterres are AUTHORED (ref photo: 4 clean lawn panels per side
  // in a paved court) — raw OSM beds there are ragged; suppress them
  const keptGrass = C.grass.filter((g) => { const c0 = centroidOf(g.pts); return !inPlazaZone(c0[0], c0[1]); });
  // Panel geometry from the OSM parterre lawns: rows a [-30,-22.5] / [-18.4,-11]
  // (the gap between them IS the fountain/side-stair line), columns c [23,30.9]
  // / [32,40]. Inner panels get chamfered corners wrapping the fountain circles
  // (r~7 around the fountains at (-21, +-23)) exactly as the aerial shows.
  const PANEL_POLYS = [
    [[-30, 23], [-30, 30.9], [-22.5, 30.9], [-22.5, 30.4], [-26, 28], [-28.6, 23]],   // S inner (chamfer at fountain)
    [[-13.4, 23], [-11, 23], [-11, 30.9], [-18.4, 30.9], [-18.4, 30.4], [-16, 28]],   // N inner (chamfer at fountain)
    [[-30, 32], [-30, 40], [-22.5, 40], [-22.5, 32]],                                  // S outer
    [[-18.4, 32], [-18.4, 40], [-11, 40], [-11, 32]],                                  // N outer
  ];
  const PANELS = [];
  for (const s of [-1, 1]) for (const poly of PANEL_POLYS) {
    const ring = poly.map(([a2, c2]) => relW(a2, c2 * s));
    ring.push(ring[0]);
    PANELS.push(ring);
  }
  // raised beds: lawn surface sits PROUD of the paving inside its stone edging,
  // and the curb line is generated from the SAME ring as the grass, so the
  // white edging always coincides exactly with the grass/paving switch
  for (const g of keptGrass) lawnPoly(g.pts, 0.20);   // TL26: 4 cm over the brick ways they overlap
  for (const ring of PANELS) lawnPoly(ring, 0.18);
  for (const g of C.flowerbeds || []) lawnPoly(g.pts, 0.18);
  let nCurb = 0;
  const kitKerbed = (pts) => { const c0 = centroidOf(pts); const [a2, c2] = axisC(c0[0], c0[1]); return a2 >= -70 && a2 <= 60 && Math.abs(c2) <= 100; };
  for (const g of [...keptGrass.filter((k) => !kitKerbed(k.pts)).map((k) => ({ pts: k.pts, lift: 0.25 })), ...PANELS.map((pts) => ({ pts, lift: 0.23 }))]) {
    const pts = g.pts;
    if (!pts || pts.length < 3 || !IN(pts[0][0], pts[0][1])) continue;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.4) continue;
      const nx = -(bz - az) / L, nz = (bx - ax) / L;
      const n = Math.ceil(L / 4);
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const p1 = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        const q = [
          [p0[0] + nx * 0.16, p0[1] + nz * 0.16], [p1[0] + nx * 0.16, p1[1] + nz * 0.16],
          [p1[0] - nx * 0.16, p1[1] - nz * 0.16], [p0[0] - nx * 0.16, p0[1] - nz * 0.16],
        ].map(([x, z]) => [x, sampleTerrain(x, z) + g.lift, z]);
        const t = tileFor(p0[0], p0[1]);
        const triUpC = (A, B, C2) => {
          if ((B[2] - A[2]) * (C2[0] - A[0]) - (B[0] - A[0]) * (C2[2] - A[2]) < 0) { const T = B; B = C2; C2 = T; }
          pushTri(t.curb, ...A, ...B, ...C2);
        };
        triUpC(q[0], q[1], q[2]); triUpC(q[0], q[2], q[3]);
      }
    }
    nCurb++;
  }
  log(' lawn curbs:', nCurb);
  // campus-wide lawn underlay: every unpaved square meter of the campus block
  // is planted in reality — dirt-gray terrain must never be the visible floor.
  // Paved surfaces (paths 0.12 / brick 0.14 / plaza 0.13 / roads +) sit above.
  // clipped to the measured superblock property lines (see CAMPUS_RECT) — the
  // underlay must never drape the avenues or their sidewalks
  // UNDER every paving lift (paths 0.12 / plaza 0.13 / brick 0.14): at 0.16 the
  // underlay won the depth test over Low Plaza's pavers and the whole plaza
  // rendered as lawn (gnddebug 2026-09-03). 0.10 keeps it 10 cm off the terrain.
  lawnPoly([relW(-204, -131.4), relW(-209.6, 112.7), relW(247.4, 122.1), relW(252.6, -121.9)], 0.10, emitGrassU);
  log(' campus lawns:', nLawn);
  // College Walk centerline (longest pedestrian way) — used to align brick and
  // suppress redundant gray paths inside the mall
  let walkPts = null, walkBest = 0;
  for (const p of C.paths) {
    if (p.ped !== 1) continue;
    let L = 0;
    for (let i = 0; i < p.pts.length - 1; i++) L += Math.hypot(p.pts[i + 1][0] - p.pts[i][0], p.pts[i + 1][1] - p.pts[i][1]);
    if (L > walkBest) { walkBest = L; walkPts = p.pts; }
  }
  const distToWalk = (x, z) => {
    if (!walkPts) return 1e9;
    let best = 1e9;
    for (let i = 0; i < walkPts.length - 1; i++) {
      const [ax, az] = walkPts[i], [bx, bz] = walkPts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
      best = Math.min(best, Math.hypot(x - (ax + dx * t), z - (az + dz * t)));
    }
    return best;
  };
  // ---- paths as terrain-conforming ribbons (mitered + subdivided every ~7m so
  // pad-blend slopes can't poke through); pedestrian mall + paving_stones -> brick
  const ribbon = (pts, w, kind, lift, skipInWalk) => {
    if (pts.length < 2) return;
    // densify: insert points every 5m so quads follow the carved/padded terrain
    const dense = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 5));
      for (let k = 1; k <= n; k++) dense.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
    }
    const perp = [];
    for (let i = 0; i < dense.length; i++) {
      const a = dense[Math.max(0, i - 1)], b = dense[Math.min(dense.length - 1, i + 1)];
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      perp.push([-dz / L, dx / L]);
    }
    // zone ownership: steps zone is pure granite, plaza rects are pure pavers —
    // overlapping ribbons at near-identical lifts depth-fight into jagged shreds
    const relC = (x, z) => {
      const dx = x - 764.23, dz = z + 2747.81;
      return [dx * PAD_AX + dz * PAD_AZ, dx * -PAD_AZ + dz * PAD_AX];
    };
    const inSteps = (x, z) => {
      const [a, c] = relC(x, z);
      if (a > -7 && a < 23 && Math.abs(c) < 62) return true;            // grand cascade
      const ac = Math.abs(c);
      // plateau-seam trenches behind the walls (terrain dives under cap slabs)
      if (a > -6.6 && a < 3.2 && ac > 29 && ac < 54.5) return true;      // behind parterre-north walls
      if (a > -24.2 && a < -1 && ac > 53.7 && ac < 63.2) return true;    // behind flank walls / stair shelves
      if (a > 6.4 && a < 15.6 && ac < 30) return true;                   // cascade-head seam band
      const aSh = a + 0.0234 * c;                                        // street frame
      return aSh > -45 && aSh < -37.8 && Math.abs(c) < 74.5;             // full-width walk steps
    };
    const inPlaza = (x, z) => {
      const [a, c] = relC(x, z);
      return (a > -45 && a < -6 && Math.abs(c) < 54) || (a > 23 && a < 78 && Math.abs(c) < 62);
    };
    for (let i = 0; i < dense.length - 1; i++) {
      const [ax, az] = dense[i], [bx, bz] = dense[i + 1];
      if (!IN(ax, az) && !IN(bx, bz)) continue;
      const midx = (ax + bx) / 2, midz = (az + bz) / 2;
      if (inSteps(midx, midz) || inPlaza(midx, midz)) continue;
      // gray paths crossing the brick mall are redundant — brick already paves it
      if (skipInWalk && distToWalk(midx, midz) < 7) continue;
      const h = w / 2;
      const t = tileFor(midx, midz);
      // wide ribbons subdivide ACROSS too — a 16m-wide quad with only edge
      // samples lets curved terrain rise through its middle
      const strips = Math.max(1, Math.ceil(w / 5.5));
      for (let s = 0; s < strips; s++) {
        const o0 = -h + (w * s) / strips, o1 = -h + (w * (s + 1)) / strips;
        const c = [
          [ax + perp[i][0] * o1, az + perp[i][1] * o1], [bx + perp[i + 1][0] * o1, bz + perp[i + 1][1] * o1],
          [bx + perp[i + 1][0] * o0, bz + perp[i + 1][1] * o0], [ax + perp[i][0] * o0, az + perp[i][1] * o0],
        ].map(([x, z]) => [x, sampleTerrain(x, z) + lift, z]);
        pushQuad(t[kind], c[0], c[1], c[2], c[3]);
      }
    }
  };
  let nPath = 0, nBrick = 0;
  for (const p of C.paths) {
    // McKim's campus walks are red brick with granite edging almost everywhere;
    // only explicitly tagged asphalt/concrete/gravel paths stay grey (otherwise the
    // upper-campus paths read as asphalt)
    const grey = /^(asphalt|concrete|gravel|fine_gravel|compacted)$/.test(p.surface || '');
    const brick = p.ped === 1 || p.surface === 'paving_stones' || p.surface === 'bricks' || !grey;
    const w = p.ped === 1 ? 16.5 : p.width || (brick ? 3.4 : 2.7);
    // TL26: brick ways stay at 0.16, 2 cm over the road datum (the College Walk apron meets Amsterdam's asphalt, zfight.md L10).
    // Their ribbons run wider than the walks and over the lawn beds beside them (College Walk: two rows of lawn panels
    // either side of a grey walk, red brick only at the edges, the reference top view), so the beds sit 4 cm above
    // them (lawnPoly 0.20 below) and the grey footway layer wins its ties with the brick at runtime (materials.js zb).
    ribbon(p.pts, w, brick ? 'brick' : 'pathTris', brick ? 0.16 : 0.12, !brick);
    brick ? nBrick++ : nPath++;
  }
  log(' campus paths:', nPath, '+ brick ways:', nBrick);
  // ---- Low Plaza apron + Low terrace forecourt: fully paved (granite pavers),
  // not bare dirt — emitted as 'path' ground on the flattened pads
  {
    // plaza paving yields to the real planted parterres (OSM lawn beds flank
    // the staircase approach) — skip pave cells whose center falls in a lawn
    const lawnBBs = C.grass.map((g) => {
      let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9;
      for (const [x, z] of g.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return { pts: g.pts, x0, z0, x1, z1 };
    });
    const inLawn = (x, z) => {
      for (const g of lawnBBs) {
        if (x < g.x0 || x > g.x1 || z < g.z0 || z > g.z1) continue;
        let inside = false;
        for (let i = 0, j = g.pts.length - 1; i < g.pts.length; j = i++) {
          const [xi, zi] = g.pts[i], [xj, zj] = g.pts[j];
          if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
        }
        if (inside) return true;
      }
      return false;
    };
    const inPanel = (a2, c2) => {
      const cc = Math.abs(c2); // panels mirror across the axis
      for (const poly of PANEL_POLYS) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          const [ai, ci] = poly[i], [aj, cj] = poly[j];
          if ((ci > cc) !== (cj > cc) && a2 < ((aj - ai) * (cc - ci)) / (cj - ci) + ai) inside = !inside;
        }
        if (inside) return true;
      }
      return false;
    };
    const paveRect = (fwd0, fwd1, halfW, yPad, kind, useOsmLawns) => {
      const relP = (fwd, right) => [764.23 + PAD_AX * fwd - PAD_AZ * right, -2747.81 + PAD_AZ * fwd + PAD_AX * right];
      // TL26: the court paving stops AT the authored lawn panels. A 4 m cell used to be kept or dropped whole by its
      // centre, so brick ran up to 2 m under every panel lawn (5 cm below it: the two fought beyond ~80 m) and the dropped
      // cells left holes of bare underlay beside it. Cells that cross a panel outline are split down to 0.25 m, inside
      // the 0.32 m granite edging that covers the seam.
      const emitCell = (f, r, sf, sr) => {
        const q = [relP(f, r), relP(f + sf, r), relP(f + sf, r + sr), relP(f, r + sr)].map(([x, z]) => [x, sampleTerrain(x, z) + 0.13, z]);
        const t = tileFor((q[0][0] + q[2][0]) / 2, (q[0][2] + q[2][2]) / 2);
        const triUp = (A, B, C) => {
          if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) < 0) { const T = B; B = C; C = T; }
          pushTri(t[kind], ...A, ...B, ...C);
        };
        triUp(q[0], q[1], q[2]);
        triUp(q[0], q[2], q[3]);
      };
      const panelShare = (f, r, sf, sr) => {   // 0 none of the cell in a panel, 1 all of it, else mixed
        let hit = 0, n = 0;
        for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) { n++; if (inPanel(f + (sf * i) / 4, r + (sr * j) / 4)) hit++; }
        return hit / n;
      };
      const cell = (f, r, sf, sr) => {
        const share = panelShare(f, r, sf, sr);
        if (share >= 1) return;
        if (share > 0 && Math.max(sf, sr) > 0.26) {
          const hf = sf / 2, hr = sr / 2;
          cell(f, r, hf, hr); cell(f + hf, r, hf, hr); cell(f, r + hr, hf, hr); cell(f + hf, r + hr, hf, hr);
          return;
        }
        if (share > 0 && inPanel(f + sf / 2, r + sr / 2)) return;
        if (useOsmLawns) {
          const cc = relP(f + sf / 2, r + sr / 2), c1 = relP(f + Math.min(1, sf / 4), r + Math.min(1, sr / 4)), c2 = relP(f + sf - Math.min(1, sf / 4), r + sr - Math.min(1, sr / 4));
          if (inLawn(cc[0], cc[1]) || inLawn(c1[0], c1[1]) || inLawn(c2[0], c2[1])) return;
        }
        emitCell(f, r, sf, sr);
      };
      const step = 4;
      for (let f = fwd0; f < fwd1; f += step) {
        for (let r = -halfW; r < halfW; r += step) cell(f, r, Math.min(step, fwd1 - f), Math.min(step, halfW - r));
      }
    };
    paveRect(-45, -6.2, 54, 41.4, 'brick', false); // Low Plaza — tan court + red motifs, out to the Kent/Dodge building line
    paveRect(23, 78, 62, 47.6, 'pathTris', true); // Low terrace forecourt — granite pavers
  }
  // ---- campus trees (OSM positions; census covers only street trees) —
  // exact-distance dedupe (2.2m) so 4-7m tree rows survive intact
  const cellOf = (x, z) => `${Math.round(x / 4)}_${Math.round(z / 4)}`;
  const treeCells = new Map(); // cell -> [[x,z],...]
  const treeAdd = (x, z) => { const k = cellOf(x, z); let a = treeCells.get(k); if (!a) treeCells.set(k, (a = [])); a.push([x, z]); };
  for (const t of tiles.values()) for (const f of t.furn) if (f.k === FURN.TREE) treeAdd(f.x, f.z);
  const treeNear = (x, z) => {
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const a = treeCells.get(`${Math.round(x / 4) + dx}_${Math.round(z / 4) + dz}`);
      if (a) for (const [px, pz] of a) if ((px - x) * (px - x) + (pz - z) * (pz - z) < 2.2 * 2.2) return true;
    }
    return false;
  };
  // TREE_SPECIES order (furnitureKit.js): 0 other, 1 plane, 2 honeylocust, 3 pear, 4 ginkgo, 5 oak, 6 linden, 7 maple, 8 cherry
  const GENUS_P0 = { Platanus: 1, Gleditsia: 2, Pyrus: 3, Quercus: 5, Ulmus: 1, Tilia: 6, Ginkgo: 4, Acer: 7, Prunus: 8 };
  let nTree = 0, rndT = mulberry(1234567);
  for (const tr of C.trees) {
    const [x, z] = tr.p;
    if (!IN(x, z)) continue;
    if (treeNear(x, z)) continue;
    treeAdd(x, z);
    const genus = (tr.genus || '').split(' ')[0];
    const p0 = GENUS_P0[genus] ?? [1, 5, 7, 2][(rndT() * 4) | 0];
    tileFor(x, z).furn.push({ k: FURN.TREE, x, y: sampleTerrain(x, z) + (FLAT ? 0.12 : 0), z, rot: rndT() * 6.28, p0, p1: 12 + ((rndT() * 24) | 0) }); // campus trees on the lawn/brick lift, not the padded terrain
    nTree++;
  }
  log(' campus trees:', nTree, '/', C.trees.length);
  // ---- benches + litter baskets (oriented to nearest path segment)
  const nearestPathRot = (x, z) => {
    let best = 1e9, rot = 0;
    for (const p of C.paths) for (let i = 0; i < p.pts.length - 1; i++) {
      const [ax, az] = p.pts[i], [bx, bz] = p.pts[i + 1];
      const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
      let t = ((x - ax) * dx + (z - az) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + dx * t), z - (az + dz * t));
      if (d < best) { best = d; rot = Math.atan2(dx, dz); }
    }
    return rot;
  };
  let nB = 0;
  for (const b of C.benches) { const [x, z] = b.p; if (!IN(x, z)) continue; tileFor(x, z).furn.push({ k: FURN.BENCH, x, y: sampleTerrain(x, z) + (FLAT ? 0.12 : 0), z, rot: nearestPathRot(x, z) }); nB++; }
  for (const b of C.baskets) { const [x, z] = b.p; if (!IN(x, z)) continue; tileFor(x, z).furn.push({ k: FURN.LITTER, x, y: sampleTerrain(x, z) + (FLAT ? 0.12 : 0), z, rot: 0 }); }
  log(' campus benches:', nB);
  // ---- enrich with terrain heights + campus frame, publish for the runtime kit
  const enrich = (pts) => pts.map(([x, z]) => [+x.toFixed(2), +z.toFixed(2), +sampleTerrain(x, z).toFixed(2)]);
  for (const s of C.steps) s.pts3 = enrich(s.pts);
  for (const w of C.walls) w.pts3 = enrich(w.pts);
  for (const f of C.fences) f.pts3 = enrich(f.pts);
  for (const h of C.hedges) h.pts3 = enrich(h.pts);
  for (const m of C.monuments) if (m.p) m.y = +sampleTerrain(m.p[0], m.p[1]).toFixed(2);
  for (const f of C.fountains) {
    if (f.p) f.y = +sampleTerrain(f.p[0], f.p[1]).toFixed(2);
    else if (f.pts) { const c = f.pts.reduce((s, p) => [s[0] + p[0] / f.pts.length, s[1] + p[1] / f.pts.length], [0, 0]); f.p = [+c[0].toFixed(2), +c[1].toFixed(2)]; f.y = +sampleTerrain(c[0], c[1]).toFixed(2); }
  }
  for (const fp of C.flagpoles) fp.y = +sampleTerrain(fp.p[0], fp.p[1]).toFixed(2);
  // longest pedestrian way = College Walk centerline (for the twin-globe lamp rows)
  let walk = null, walkLen = 0;
  for (const p of C.paths) {
    if (p.ped !== 1) continue;
    let L = 0;
    for (let i = 0; i < p.pts.length - 1; i++) L += Math.hypot(p.pts[i + 1][0] - p.pts[i][0], p.pts[i + 1][1] - p.pts[i][1]);
    if (L > walkLen) { walkLen = L; walk = p; }
  }
  C.walkLine = walk ? enrich(walk.pts) : null;
  C.axis = [PAD_AX, PAD_AZ];
  C.alma = CAMPUS_ALMA;
  // McKim levels for the runtime kit (campus.js): shifted onto the flat base plane in FLAT mode
  // the kit stands on the PAVED tops, not on the terrain pads: walk brick +0.14, plaza/upper paving +0.12
  // (the first treads of the grand staircase were buried in the paving/lawn otherwise)
  C.padTop = 46.9 + CAMPUS_SHIFT + 0.12; C.padApron = 41.4 + CAMPUS_SHIFT + 0.12; C.padWalk = 40.2 + CAMPUS_SHIFT + 0.14;
  fs.mkdirSync('public/data', { recursive: true });
  C.levels = { shift: CAMPUS_SHIFT, lot: LOT_Y, base: BASE_Y, flat: FLAT ? 1 : 0 };
  // terrace seams of the two-plane pad model (CAMPUS_PADS), exported so the campus
  // kit can stand the real granite retaining walls + balustrades on them instead
  // of guessing. Each edge: campus-axis coords [a, c] and
  // world [x, z] endpoints; `low`/`high` are the PAVED tops either side.
  {
    const apron = 41.4 + CAMPUS_SHIFT + 0.12, plateau = 46.9 + CAMPUS_SHIFT + 0.12;
    const rw = (a2, c2) => [+(CAMPUS_ALMA[0] + PAD_AX * a2 - PAD_AZ * c2).toFixed(2), +(CAMPUS_ALMA[1] + PAD_AZ * a2 + PAD_AX * c2).toFixed(2)];
    const edge = (name, a0, c0, a1, c1, low, high) => ({ name, a: [a0, c0], b: [a1, c1], aw: rw(a0, c0), bw: rw(a1, c1), low, high });
    C.terraceEdges = [
      edge('plaza flank west', -40.4, -58.4, -1.5, -58.4, apron, plateau),   // Dodge side: plateau outside |c| > 58.4
      edge('plaza flank east', -40.4, 58.4, -1.5, 58.4, apron, plateau),     // Kent side
      edge('parterre-north west', -1.5, -58.4, -1.5, -29.5, apron, plateau), // walls north of the court, up to the cascade corridor
      edge('parterre-north east', -1.5, 29.5, -1.5, 58.4, apron, plateau),
    ];
  }
  fs.writeFileSync('public/data/columbia_campus.json', JSON.stringify(C));
  log(' wrote public/data/columbia_campus.json');
}

// ---------------------------------------------------------------- RL36 rail at grade and in open cut
// NYC Planimetric Database: Railroad Line (anc7-97cy, data/raw/rail_lines.geojson): one centreline per track. Codes
// 2400 (railroad: at grade, and tunnels copied with no elevation), 2420 (embankment) and 2440 (open cut) are drawn here;
// 2410 elevated and 2430 viaduct are left to the structures that already draw them (city/elevatedKit.js, the Park
// Avenue and 125th Street viaduct kits), 2450 fences and 2465 abandoned lines are not drawn. Every 2 m a centreline is
// classed: water, under a building footprint, inside a street (a carriageway and 3 m either side) or open. A grade
// line is drawn only in the open: under a street it passes beneath (the street crosses over it; NYC has next to no
// level crossings), under a building or the water it is in a tunnel. A cut line under a street for up to 60 m passes
// under a street bridge (a soffit and two fascias below the road); longer, or under a building, it is in a tunnel, and
// the cut ends at a portal wall. Embankments are drawn at grade (open item: their height and street underbridges).
// The track: a bed of crushed stone (2.6 m sleeper zone at the top, shoulders sloping to 5.2 m), the sleepers drawn by
// the ground shader across the bed (matId 20 + bearing), two rails 1,435 mm apart (head 72 mm, 0.18 m over the bed).
// A cut: its floor 0.40 m over the water plane (the base plane is 3.24 m, so cuts are ~3 m deep in the flat city),
// concrete walls 3.25 m off the outer tracks up to 0.35 m over grade, and its corridor cut out of the drawn terrain.
log('rail');
const RL = { tracks: 0, km: 0, cutKm: 0, crossings: 0, underRoads: 0, portals: 0, hiddenKm: 0 };
if (fs.existsSync(path.join(RAW, 'rail_lines.geojson'))) {
  const fc = loadJSON('rail_lines.geojson');
  const GR = BASE_Y, CUT_FLOOR = 0.40, BED = 0.30, RAIL_H = 0.18, GAUGE2 = 0.7175, HEAD2 = 0.036;
  const TOP2 = 1.3, SHOULDER2 = 2.6, WALL2 = 3.25, HOLE2 = 3.4;
  // building footprints by 64 m cell
  const BC = 64, bGrid = new Map();
  for (const b of buildings) {
    if (b.drop || !b.ring) continue;
    const bb = ringBBox(b.ring);
    b._bb = bb;
    for (let gx = Math.floor(bb[0] / BC); gx <= Math.floor(bb[2] / BC); gx++) for (let gz = Math.floor(bb[1] / BC); gz <= Math.floor(bb[3] / BC); gz++) {
      const k = gx + '_' + gz; let a = bGrid.get(k); if (!a) bGrid.set(k, (a = [])); a.push(b);
    }
  }
  const inBuilding = (x, z) => {
    const a = bGrid.get(Math.floor(x / BC) + '_' + Math.floor(z / BC));
    if (a) for (const b of a) if (x >= b._bb[0] && x <= b._bb[2] && z >= b._bb[1] && z <= b._bb[3] && pointInPoly(x, z, b.ring)) return true;
    return false;
  };
  // land by 32 m shore cell: a cell no shore segment crosses is all one side, so one test answers for it
  const landCell = new Map();
  const isLand = (x, z) => {
    const i = Math.floor(x / SHORE_CELL), j = Math.floor(z / SHORE_CELL), k = i + '_' + j;
    if (SHORE.has(k)) return onLand(x, z);
    let v = landCell.get(k);
    if (v === undefined) landCell.set(k, (v = onLand((i + 0.5) * SHORE_CELL, (j + 0.5) * SHORE_CELL)));
    return v;
  };
  const inTiles = (x, z) => { const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE); return tx >= TX0 && tx <= TX1 && tz >= TZ0 && tz <= TZ1; };
  // 1. the tracks, resampled and classed
  const tracks = [];
  for (const f of fc.features) {
    const p = f.properties || {}, g = f.geometry;
    const code = String(p.feat_code || '');
    if (!g || !['2400', '2420', '2440'].includes(code)) continue;
    const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates];
    for (const line of lines) {
      let pts = simplify(line.map(([lon, lat]) => project(lon, lat)), 0.3);
      if (pts.length < 2) continue;
      const L = polylineLength(pts);
      if (L < 4) continue;
      const [mx, mz] = alongPolyline(pts, L / 2);
      if (!inTiles(mx, mz) && !inTiles(pts[0][0], pts[0][1]) && !inTiles(pts[pts.length - 1][0], pts[pts.length - 1][1])) continue;
      tracks.push({ pts, L, cut: code === '2440', name: p.name || '' });
    }
  }
  // cut tracks indexed by 16 m cell (a wall stands only where no other cut track runs within 6.2 m on that side)
  const CC = 16, cutGrid = new Map();
  tracks.forEach((t, ti) => {
    if (!t.cut) return;
    for (let i = 1; i < t.pts.length; i++) {
      const [x1, z1] = t.pts[i - 1], [x2, z2] = t.pts[i];
      for (let gx = Math.floor((Math.min(x1, x2) - 8) / CC); gx <= Math.floor((Math.max(x1, x2) + 8) / CC); gx++)
        for (let gz = Math.floor((Math.min(z1, z2) - 8) / CC); gz <= Math.floor((Math.max(z1, z2) + 8) / CC); gz++) {
          const k = gx + '_' + gz; let a = cutGrid.get(k); if (!a) cutGrid.set(k, (a = [])); a.push([ti, x1, z1, x2, z2]);
        }
    }
  });
  const nearOtherCut = (x, z, ti, r) => {
    const a = cutGrid.get(Math.floor(x / CC) + '_' + Math.floor(z / CC));
    if (a) for (const [tj, x1, z1, x2, z2] of a) {
      if (tj === ti) continue;
      const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / L2));
      if (Math.hypot(x - (x1 + dx * t), z - (z1 + dz * t)) < r) return true;
    }
    return false;
  };
  // a sub-polyline from arc length s0 to s1
  const subLine = (pts, s0, s1) => {
    const out = [];
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const [x1, z1] = pts[i - 1], [x2, z2] = pts[i], l = Math.hypot(x2 - x1, z2 - z1);
      if (acc + l >= s0 && acc <= s1) {
        const a = Math.max(0, (s0 - acc) / (l || 1)), b = Math.min(1, (s1 - acc) / (l || 1));
        if (!out.length) out.push([x1 + (x2 - x1) * a, z1 + (z2 - z1) * a]);
        out.push([x1 + (x2 - x1) * b, z1 + (z2 - z1) * b]);
      }
      acc += l;
    }
    // long straights: a vertex every 32 m at most, so a piece goes to the tile it lies in
    const dense = [out[0]];
    for (let i = 1; i < out.length; i++) {
      const [x1, z1] = out[i - 1], [x2, z2] = out[i], n = Math.max(1, Math.ceil(Math.hypot(x2 - x1, z2 - z1) / 32));
      for (let k = 1; k <= n; k++) dense.push([x1 + ((x2 - x1) * k) / n, z1 + ((z2 - z1) * k) / n]);
    }
    return dense;
  };
  // +y facing triangle, both windings for vertical faces
  const triUp = (buf, A, B, C) => {
    if ((B[2] - A[2]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[2] - A[2]) >= 0) pushTri(buf, A[0], A[1], A[2], B[0], B[1], B[2], C[0], C[1], C[2]);
    else pushTri(buf, A[0], A[1], A[2], C[0], C[1], C[2], B[0], B[1], B[2]);
  };
  const quadUp = (buf, A, B, C, D) => { triUp(buf, A, B, C); triUp(buf, A, C, D); };
  const quadBoth = (buf, A, B, C, D) => { pushQuad(buf, A, B, C, D); pushQuad(buf, A, D, C, B); };
  // a vertical quad wound to face (fx, fz)
  const quadFace = (buf, A, B, C, D, fx, fz) => {
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    if ((uy * vz - uz * vy) * fx + (ux * vy - uy * vx) * fz >= 0) pushQuad(buf, A, B, C, D); else pushQuad(buf, A, D, C, B);
  };
  // per-vertex left normals (mitred, capped) of a polyline
  const normals = (P) => P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  });
  const off = (p, n, o, y) => [p[0] + n[0] * o, y, p[1] + n[1] * o];
  // the track's bed, sleepers and rails over a polyline at bed base y0
  const emitTrack = (P, y0, cut, ti, withBed = true) => {
    const N = normals(P), yB = y0 + BED, yR = yB + RAIL_H;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], na = N[i - 1], nb = N[i];
      if (!inTiles((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) continue;
      const t = tileFor((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      if (withBed) {
        // the sleeper bed: its bearing (mod pi) rides in the matId for the ground shader
        const bear = ((Math.atan2(b[1] - a[1], b[0] - a[0]) % Math.PI) + Math.PI) % Math.PI;
        const mid = 20 + 0.45 * (bear / Math.PI);
        const n0 = t.rtop.n;
        quadUp(t.rtop, off(a, na, TOP2, yB), off(b, nb, TOP2, yB), off(b, nb, -TOP2, yB), off(a, na, -TOP2, yB));
        for (let k = (t.rtop.n - n0) / 3; k > 0; k--) t.rtopA.push(mid);
        // shoulders down to the base, both sides
        for (const sd of [1, -1]) quadUp(t.rbal, off(a, na, sd * TOP2, yB), off(b, nb, sd * TOP2, yB), off(b, nb, sd * SHOULDER2, y0 + 0.01), off(a, na, sd * SHOULDER2, y0 + 0.01));
      }
      // the rails: head top + both flanks
      for (const sd of [1, -1]) {
        const o = sd * GAUGE2, yr = withBed ? yR : y0;
        quadUp(t.rsteel, off(a, na, o - HEAD2, yr), off(b, nb, o - HEAD2, yr), off(b, nb, o + HEAD2, yr), off(a, na, o + HEAD2, yr));
        if (withBed) for (const e of [-HEAD2, HEAD2]) {
          const fx = (na[0] + nb[0]) * Math.sign(e), fz = (na[1] + nb[1]) * Math.sign(e);   // each flank faces away from its rail
          quadFace(t.rsteel, off(a, na, o + e, yB + 0.03), off(b, nb, o + e, yB + 0.03), off(b, nb, o + e, yr), off(a, na, o + e, yr), fx, fz);
        }
      }
    }
  };
  // a cut's walls, floor strips and terrain holes over a polyline
  const emitCut = (P, ti, under = false) => {
    // under a street the walls stop at the bridge's soffit (no parapet through the roadway)
    const N = normals(P), yTop = under ? GR - 0.9 : GR + 0.35;
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1], b = P[i], na = N[i - 1], nb = N[i];
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      if (!inTiles(mx, mz)) continue;
      const t = tileFor(mx, mz);
      const segL = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (const sd of [1, -1]) {
        const nm = [(na[0] + nb[0]) / 2, (na[1] + nb[1]) / 2];
        if (nearOtherCut(mx + nm[0] * sd * WALL2, mz + nm[1] * sd * WALL2, ti, 3.2)) continue;
        // floor strip from the shoulder to the wall, the wall, its coping
        quadUp(t.rbal, off(a, na, sd * SHOULDER2, CUT_FLOOR), off(b, nb, sd * SHOULDER2, CUT_FLOOR), off(b, nb, sd * (WALL2 + 0.05), CUT_FLOOR), off(a, na, sd * (WALL2 + 0.05), CUT_FLOOR));
        quadBoth(t.rwall, off(a, na, sd * WALL2, CUT_FLOOR - 0.05), off(b, nb, sd * WALL2, CUT_FLOOR - 0.05), off(b, nb, sd * WALL2, yTop), off(a, na, sd * WALL2, yTop));
        if (!under) {
          quadUp(t.rwall, off(a, na, sd * WALL2, yTop), off(b, nb, sd * WALL2, yTop), off(b, nb, sd * (WALL2 + 0.4), yTop), off(a, na, sd * (WALL2 + 0.4), yTop));
          quadBoth(t.rwall, off(a, na, sd * (WALL2 + 0.4), yTop), off(b, nb, sd * (WALL2 + 0.4), yTop), off(b, nb, sd * (WALL2 + 0.4), GR - 0.2), off(a, na, sd * (WALL2 + 0.4), GR - 0.2));
        }
      }
      // the corridor out of the drawn terrain, in every tile the rectangle reaches
      const yaw = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = segL / 2 + 0.6, hw = HOLE2;
      const rx = Math.abs(Math.cos(yaw)) * hl + Math.abs(Math.sin(yaw)) * hw, rz = Math.abs(Math.sin(yaw)) * hl + Math.abs(Math.cos(yaw)) * hw;
      for (let tx = Math.floor((mx - rx) / TILE); tx <= Math.floor((mx + rx) / TILE); tx++) for (let tz = Math.floor((mz - rz) / TILE); tz <= Math.floor((mz + rz) / TILE); tz++) {
        if (tx < TX0 || tx > TX1 || tz < TZ0 || tz > TZ1) continue;
        const tt = tileFor(tx * TILE + 1, tz * TILE + 1);
        tt.railCuts.push([+(mx - tt.x0).toFixed(2), +(mz - tt.z0).toFixed(2), +yaw.toFixed(4), +hl.toFixed(2), hw]);
      }
    }
  };
  // a street bridge over a cut: soffit under the road and a fascia either side, across the corridor
  const emitUnderRoad = (P) => {
    if (P.length < 2) return;
    const N = normals(P), ySoffit = GR - 0.9, yDeck = GR + 0.2, A = P[0], B = P[P.length - 1], nA = N[0], nB = N[N.length - 1];
    const t = tileFor((A[0] + B[0]) / 2, (A[1] + B[1]) / 2);
    const w = WALL2;
    const s0 = off(A, nA, w, ySoffit), s1 = off(B, nB, w, ySoffit), s2 = off(B, nB, -w, ySoffit), s3 = off(A, nA, -w, ySoffit);
    pushQuad(t.rwall, s0, s1, s2, s3); pushQuad(t.rwall, s0, s3, s2, s1);
    for (const [Q, nQ] of [[A, nA], [B, nB]]) quadBoth(t.rwall, off(Q, nQ, w, ySoffit), off(Q, nQ, -w, ySoffit), off(Q, nQ, -w, yDeck), off(Q, nQ, w, yDeck));
  };
  const emitPortal = (Q, nQ) => {
    const t = tileFor(Q[0], Q[1]);
    quadBoth(t.rwall, off(Q, nQ, WALL2, CUT_FLOOR - 0.05), off(Q, nQ, -WALL2, CUT_FLOOR - 0.05), off(Q, nQ, -WALL2, GR + 0.35), off(Q, nQ, WALL2, GR + 0.35));
  };
  // 2. class every 2 m, merge into runs, apply the run rules, emit
  tracks.forEach((T, ti) => {
    const STEP = 2, n = Math.max(2, Math.ceil(T.L / STEP) + 1), cls = new Array(n);
    for (let i = 0; i < n; i++) {
      const d = Math.min(T.L, i * STEP), [x, z] = alongPolyline(T.pts, d);
      cls[i] = !isLand(x, z) ? 'w' : inBuilding(x, z) ? 'b' : inCarriageway(x, z, GR + 0.145, null, 3.0) ? 'r' : 'o';
    }
    const runs = [];
    for (let i = 0; i < n; i++) {
      const s = Math.min(T.L, i * STEP);
      if (runs.length && runs[runs.length - 1].c === cls[i]) runs[runs.length - 1].s1 = s;
      else { if (runs.length) runs[runs.length - 1].s1 = s; runs.push({ c: cls[i], s0: s, s1: s }); }
    }
    runs[runs.length - 1].s1 = T.L;
    // a grade line under a street is left out where the street is (NYC's lines pass under their street crossings; drawn
    // as level crossings, the rails ran across the asphalt of every street bridge over a yard or a cut); a cut line runs
    // on under a street bridge of up to 60 m
    for (const r of runs) {
      const len = r.s1 - r.s0;
      if (r.c === 'o') r.k = 'open';
      else if (r.c === 'r' && T.cut && len <= 60) r.k = 'under';
      else { r.k = 'hidden'; if (r.c === 'r' && len <= 40) RL.crossings++; }
    }
    // a short open run between two hidden ones is a gap in the tunnel's data, not daylight
    for (let i = 1; i + 1 < runs.length; i++) if (runs[i].k === 'open' && runs[i].s1 - runs[i].s0 < 12 && runs[i - 1].k === 'hidden' && runs[i + 1].k === 'hidden') runs[i].k = 'hidden';
    RL.tracks++;
    runs.forEach((r, ri) => {
      const len = r.s1 - r.s0;
      if (len < 0.5) return;
      if (r.k === 'hidden') { RL.hiddenKm += len / 1000; return; }
      const P = subLine(T.pts, r.s0, r.s1);
      if (P.length < 2) return;
      const y0 = T.cut ? CUT_FLOOR : GR + 0.01;
      emitTrack(P, y0, T.cut, ti, true);
      RL.km += len / 1000;
      if (T.cut) {
        emitCut(P, ti, r.k === 'under'); RL.cutKm += len / 1000;
        if (r.k === 'under') { emitUnderRoad(P); RL.underRoads++; }
        // a portal where the cut meets a tunnel
        const N = normals(P);
        if (ri > 0 && runs[ri - 1].k === 'hidden') { emitPortal(P[0], N[0]); RL.portals++; }
        if (ri + 1 < runs.length && runs[ri + 1].k === 'hidden') { emitPortal(P[P.length - 1], N[N.length - 1]); RL.portals++; }
      }
    });
  });
  log(` rail: ${RL.tracks} track lines, ${RL.km.toFixed(1)} km drawn (${RL.cutKm.toFixed(1)} km in open cut), ${RL.crossings} streets crossing a grade line (the line left out under them), ${RL.underRoads} street bridges over cuts, ${RL.portals} tunnel portals, ${RL.hiddenKm.toFixed(1)} km in tunnels / under buildings / under streets / over water left out`);
} else log(' rail: data/raw/rail_lines.geojson missing (fetch.mjs --rail)');

// ---------------------------------------------------------------- RG44 roads in open cuts
// A road CSCL puts below grade (an end under level 13: the Lincoln Tunnel's approaches in Dyer Avenue's cut, the Cross
// Bronx Expressway's trench, the Grand Concourse's underpasses) is drawn down in a cut (roadY, CUT_PER_LEVEL): concrete
// retaining walls 0.25 m off its edges from the floor to a 0.9 m parapet over grade with a coping, a kerb strip between
// the asphalt and the wall, and its corridor cut out of the drawn terrain (the tiles' railCuts, which assemble.js cuts
// from the grid). Where a street at grade crosses over it the walls stop under a soffit 0.6 m below the deck and the
// street's run over the cut gets its fascias (a street bridge); under a building the road is in a tunnel (no walls, no
// hole), and a road ending below grade with no cut road going on from it ends at a portal wall. Two cut roads side by side
// (the ramps' bundles) share one trench: no wall stands in the other's carriageway.
log('road cuts');
const RG = { roads: 0, km: 0, bridges: 0, portals: 0, mouths: 0, tunnelM: 0 };
if (RC44) {
  const GRD = BASE_Y + 0.145, PARA = 0.9, SOFF = 0.6, WOFF = 0.25, COPE = 0.3, STEP = 3;
  const BC = 64, bGrid = new Map();
  for (const b of buildings) {
    if (b.drop || !b.ring) continue;
    const bb = b._bb || ringBBox(b.ring);
    b._bb = bb;
    for (let gx = Math.floor(bb[0] / BC); gx <= Math.floor(bb[2] / BC); gx++) for (let gz = Math.floor(bb[1] / BC); gz <= Math.floor(bb[3] / BC); gz++) {
      const k = gx + '_' + gz; let a = bGrid.get(k); if (!a) bGrid.set(k, (a = [])); a.push(b);
    }
  }
  const inBuilding = (x, z) => {
    const a = bGrid.get(Math.floor(x / BC) + '_' + Math.floor(z / BC));
    if (a) for (const b of a) if (x >= b._bb[0] && x <= b._bb[2] && z >= b._bb[1] && z <= b._bb[3] && pointInPoly(x, z, b.ring)) return true;
    return false;
  };
  const inT = (x, z) => { const tx = Math.floor(x / TILE), tz = Math.floor(z / TILE); return tx >= TX0 && tx <= TX1 && tz >= TZ0 && tz <= TZ1; };
  const quadBoth = (buf, A, B, C, D) => { pushQuad(buf, A, B, C, D); pushQuad(buf, A, D, C, B); };
  const quadUp = (buf, A, B, C, D) => {   // +y facing
    const ux = B[0] - A[0], uz = B[2] - A[2], vx = C[0] - A[0], vz = C[2] - A[2];
    if (uz * vx - ux * vz >= 0) pushQuad(buf, A, B, C, D); else pushQuad(buf, A, D, C, B);
  };
  const cutStubs = (n) => (n ? n.stubs.filter((s) => s.r.cut && s.level < 0).length : 0);
  for (const r of roads) {
    if (!r.cut || r.noGeom) continue;
    const L = polylineLength(r.pts), w2 = r.width / 2;
    if (L < 1) continue;
    RG.roads++; RG.km += L / 1000;
    const n = Math.max(1, Math.ceil(L / STEP));
    const S = [];
    for (let i = 0; i <= n; i++) {
      const d = (i / n) * L, [x, z, dx, dz] = alongPolyline(r.pts, d), y = roadY(r, x, z, d, L);
      S.push({ d, x, z, dx, dz, y, depth: GRD - y });
    }
    let run = null;   // a street bridge: consecutive steps under a carriageway at grade
    let open = true;  // the step before was drawn open (not covered)
    const ownDist = (x, z) => {   // plan distance to the road's own centreline
      let m = 1e9;
      for (let k = 1; k < r.pts.length; k++) {
        const [x1, z1] = r.pts[k - 1], [x2, z2] = r.pts[k], dx = x2 - x1, dz = z2 - z1, l2 = dx * dx + dz * dz || 1e-9;
        const u = Math.max(0, Math.min(1, ((x - x1) * dx + (z - z1) * dz) / l2));
        m = Math.min(m, Math.hypot(x - x1 - dx * u, z - z1 - dz * u));
      }
      return m;
    };
    // a tunnel mouth at Q: a concrete headwall from the soffit to the parapet, and the dark of the bore a metre in
    const mouth = (Q, Rr) => {
      const t = tileFor(Q.x, Q.z), hw = w2 + WOFF, ex = Rr.x - Q.x, ez = Rr.z - Q.z, el = Math.hypot(ex, ez) || 1;
      const ix = (ex / el) * 1.0, iz = (ez / el) * 1.0;
      quadBoth(t.rwall, [Q.x - Q.dz * hw, GRD - SOFF, Q.z + Q.dx * hw], [Q.x + Q.dz * hw, GRD - SOFF, Q.z - Q.dx * hw],
        [Q.x + Q.dz * hw, GRD + PARA, Q.z - Q.dx * hw], [Q.x - Q.dz * hw, GRD + PARA, Q.z + Q.dx * hw]);
      quadBoth(t.gutter, [Q.x + ix - Q.dz * hw, Q.y - 0.05, Q.z + iz + Q.dx * hw], [Q.x + ix + Q.dz * hw, Q.y - 0.05, Q.z + iz - Q.dx * hw],
        [Q.x + ix + Q.dz * hw, GRD - SOFF, Q.z + iz - Q.dx * hw], [Q.x + ix - Q.dz * hw, GRD - SOFF, Q.z + iz + Q.dx * hw]);
      RG.mouths++;
    };
    const endRun = () => {
      if (!run) return;
      for (const Q of [run.a, run.b]) {
        const t = tileFor(Q.x, Q.z), hw = w2 + WOFF;
        quadBoth(t.rwall, [Q.x - Q.dz * hw, GRD - SOFF, Q.z + Q.dx * hw], [Q.x + Q.dz * hw, GRD - SOFF, Q.z - Q.dx * hw],
          [Q.x + Q.dz * hw, GRD + 0.05, Q.z - Q.dx * hw], [Q.x - Q.dz * hw, GRD + 0.05, Q.z + Q.dx * hw]);
      }
      RG.bridges++;
      run = null;
    };
    for (let i = 1; i < S.length; i++) {
      const a = S[i - 1], b = S[i];
      const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
      if (!inT(mx, mz)) { endRun(); continue; }
      if (a.depth < 0.25 && b.depth < 0.25) { endRun(); continue; }   // at grade: the ribbon alone
      // under a building, or within 25 m of the shore (the FDR under Carl Schurz Park's and the UN's esplanades, the BQE
      // under the Brooklyn Heights Promenade: a waterfront deck, and an open trench there took the land from the shore):
      // covered, a tunnel; where an open run goes in, a tunnel mouth
      if (inBuilding(mx, mz) || shoreDist(mx, mz, 25) < 25) {
        endRun(); RG.tunnelM += b.d - a.d;
        if (open && a.depth > SOFF + 1.2) mouth(a, b);
        open = false;
        continue;
      }
      if (!open && i > 1 && a.depth > SOFF + 1.2) mouth(a, a.d > 0 ? S[i - 2] : b);
      open = true;
      const t = tileFor(mx, mz);
      const under = inCarriageway(mx, mz, GRD, [r], 4.6) && a.depth > SOFF + 0.4 && b.depth > SOFF + 0.4;   // (its sidewalks too)
      // the kerb strips and the walls, each side unless another cut road's carriageway is there (a shared trench)
      for (const sd of [1, -1]) {
        const o = sd * (w2 + WOFF), o0 = sd * w2;
        const pa = [a.x - a.dz * o, a.z + a.dx * o], pb = [b.x - b.dz * o, b.z + b.dx * o];
        const shared = inCarriageway((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (a.y + b.y) / 2, [r], 0.3);
        if (shared) continue;   // (and no kerb strip on the other road's lanes)
        // nor on its own: on the inside of a tight bend one segment's strip falls on the next segment's lanes
        const kx = (a.x + b.x) / 2 - ((a.dz + b.dz) / 2) * (o0 + sd * WOFF / 2), kz = (a.z + b.z) / 2 + ((a.dx + b.dx) / 2) * (o0 + sd * WOFF / 2);
        if (ownDist(kx, kz) < w2 - 0.05) continue;
        quadUp(t.curb, [a.x - a.dz * o0, a.y + 0.01, a.z + a.dx * o0], [b.x - b.dz * o0, b.y + 0.01, b.z + b.dx * o0],
          [pb[0], b.y + 0.01, pb[1]], [pa[0], a.y + 0.01, pa[1]]);
        const topA = under ? GRD - SOFF : GRD + PARA, topB = topA;
        quadBoth(t.rwall, [pa[0], a.y - 0.05, pa[1]], [pb[0], b.y - 0.05, pb[1]], [pb[0], topB, pb[1]], [pa[0], topA, pa[1]]);
        if (!under) {
          const oc = sd * (w2 + WOFF + COPE);
          const ca = [a.x - a.dz * oc, a.z + a.dx * oc], cb = [b.x - b.dz * oc, b.z + b.dx * oc];
          quadUp(t.rwall, [pa[0], topA, pa[1]], [pb[0], topB, pb[1]], [cb[0], topB, cb[1]], [ca[0], topA, ca[1]]);
          quadBoth(t.rwall, [ca[0], topA, ca[1]], [cb[0], topB, cb[1]], [cb[0], BASE_Y - 0.2, cb[1]], [ca[0], BASE_Y - 0.2, ca[1]]);
        }
      }
      if (under) {
        // the soffit under the street, across the trench
        const hw = w2 + WOFF;
        pushQuad(t.rwall, [a.x + a.dz * hw, GRD - SOFF, a.z - a.dx * hw], [b.x + b.dz * hw, GRD - SOFF, b.z - b.dx * hw],
          [b.x - b.dz * hw, GRD - SOFF, b.z + b.dx * hw], [a.x - a.dz * hw, GRD - SOFF, a.z + a.dx * hw]);
        pushQuad(t.rwall, [a.x - a.dz * hw, GRD - SOFF, a.z + a.dx * hw], [b.x - b.dz * hw, GRD - SOFF, b.z + b.dx * hw],
          [b.x + b.dz * hw, GRD - SOFF, b.z - b.dx * hw], [a.x + a.dz * hw, GRD - SOFF, a.z - a.dx * hw]);
        if (!run) run = { a, b }; else run.b = b;
      } else endRun();
      // the corridor out of the drawn terrain, in every tile the rectangle reaches
      const segL = Math.hypot(b.x - a.x, b.z - a.z), yaw = Math.atan2(b.z - a.z, b.x - a.x), hl = segL / 2 + 0.3, hw = w2 + WOFF + 0.05;
      const rx = Math.abs(Math.cos(yaw)) * hl + Math.abs(Math.sin(yaw)) * hw, rz = Math.abs(Math.sin(yaw)) * hl + Math.abs(Math.cos(yaw)) * hw;
      for (let tx = Math.floor((mx - rx) / TILE); tx <= Math.floor((mx + rx) / TILE); tx++) for (let tz = Math.floor((mz - rz) / TILE); tz <= Math.floor((mz + rz) / TILE); tz++) {
        if (tx < TX0 || tx > TX1 || tz < TZ0 || tz > TZ1) continue;
        const tt = tileFor(tx * TILE + 1, tz * TILE + 1);
        tt.railCuts.push([+(mx - tt.x0).toFixed(2), +(mz - tt.z0).toFixed(2), +yaw.toFixed(4), +hl.toFixed(2), +hw.toFixed(2)]);
      }
    }
    endRun();
    // portals: an end below grade that no other cut road goes on from (a tunnel mouth)
    for (const [Q, nd] of [[S[0], r.nodeA], [S[S.length - 1], r.nodeB]]) {
      if (Q.depth < 1 || cutStubs(nd) >= 2 || !inT(Q.x, Q.z)) continue;
      const t = tileFor(Q.x, Q.z), hw = w2 + WOFF;
      quadBoth(t.rwall, [Q.x - Q.dz * hw, Q.y - 0.05, Q.z + Q.dx * hw], [Q.x + Q.dz * hw, Q.y - 0.05, Q.z - Q.dx * hw],
        [Q.x + Q.dz * hw, GRD + PARA, Q.z - Q.dx * hw], [Q.x - Q.dz * hw, GRD + PARA, Q.z + Q.dx * hw]);
      RG.portals++;
    }
  }
  log(' roads in cuts:', RG.roads, '|', RG.km.toFixed(1), 'km | street bridges over them:', RG.bridges, '| portals:', RG.portals, '| covered (under buildings, at the shore):', RG.tunnelM.toFixed(0), 'm, tunnel mouths:', RG.mouths);
}

// ---------------------------------------------------------------- bridges.json
// (tools/pipeline/bridges.mjs: the inputs it reads from this compile go beside bridges.json, so the records can be
// rebuilt from them alone with `node tools/pipeline/bridges.mjs <tiles dir>`)
log('bridges');
const bridgeIn = bridgeInputs({ segs: bridgeSegs, roads, LAND, sampleTerrain, LANDINGS, raw: RAW });
fs.writeFileSync(path.join(OUT, 'bridge_inputs.json'), JSON.stringify(bridgeIn));
const bridgesOut = buildBridgeRecords(bridgeIn, log);
fs.writeFileSync(path.join(OUT, 'bridges.json'), JSON.stringify(bridgesOut));
log('bridges written:', bridgesOut.map((b) => b.key).join(', '));

// ---------------------------------------------------------------- write tiles
log('writing tiles');
let written = 0;
// merge with any existing manifest so a partial --boro recompile can't drop
// the other boroughs' tiles/macros from the index
const manifest = { tile: TILE, macro: MACRO, tiles: {}, macros: {}, bounds: [WX0, WZ0, WX1, WZ1] };
{
  const mPath = path.join(OUT, 'manifest.json');
  if (fs.existsSync(mPath)) {
    try {
      const prev = JSON.parse(fs.readFileSync(mPath, 'utf8'));
      Object.assign(manifest.tiles, prev.tiles || {});
      Object.assign(manifest.macros, prev.macros || {});
      if (prev.bounds) manifest.bounds = [Math.min(prev.bounds[0], WX0), Math.min(prev.bounds[1], WZ0), Math.max(prev.bounds[2], WX1), Math.max(prev.bounds[3], WZ1)];
    } catch { /* corrupt manifest — rebuild fresh */ }
  }
}
// WW39: every tile's shore aprons first (the wall check below reads them across tile edges), then the wall pieces with no
// drawn ground behind them (neither the terrain at the land grade nor an apron, 1 and 2 m inland of the ring) come out: a
// bulkhead in front of nothing is a plank in the water (the tips of Pier 16, a spit's single wall)
const APRONS = new Map();
for (const [key, t] of tiles) APRONS.set(key, shoreApron(t, buildTerrain(t.tx, t.tz)));
// SG40: apron strips that reach no land come out before the walls are checked. A strip is laid per 1 m row between two
// walled ring crossings, so where a pier's walls hold on some rows and not on others (a marina dock's T-head whose far side
// is too narrow to wall, a stub between dropped rows) the rows that kept theirs stood out in the water as fragments, walls
// and all. Strips within 1.5 m of each other in a row (one split at a tile edge, a dock's root beside the shore's strips)
// or overlapping across adjacent rows (within 1 m) are one piece; a piece reaches land where land-grade terrain lies just
// past one of its strips' ends or in the row beside it.
let apronFragments = 0, apronFragmentStrips = 0;
if (SA37 && apronSpans.length) {
  const N = apronSpans.length / 5;
  const par = new Int32Array(N); for (let i = 0; i < N; i++) par[i] = i;
  const find = (i) => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  const uni = (a, b) => { a = find(a); b = find(b); if (a !== b) par[a] = b; };
  const Z_ = (i) => apronSpans[i * 5 + 2], S_ = (i) => apronSpans[i * 5 + 3], E_ = (i) => apronSpans[i * 5 + 4];
  const byRow = new Map();
  for (let i = 0; i < N; i++) { let a = byRow.get(Z_(i)); if (!a) byRow.set(Z_(i), (a = [])); a.push(i); }
  for (const a of byRow.values()) a.sort((p, q) => S_(p) - S_(q));
  for (const [z, a] of byRow) {
    for (let k = 1; k < a.length; k++) if (S_(a[k]) <= E_(a[k - 1]) + 1.5) uni(a[k], a[k - 1]);
    const b = byRow.get(z + 1); if (!b) continue;
    let j0 = 0;
    for (const i of a) {
      const s0 = S_(i), e0 = E_(i);
      while (j0 < b.length && E_(b[j0]) <= s0 - 1) j0++;
      for (let j = j0; j < b.length && S_(b[j]) < e0 + 1; j++) uni(i, b[j]);
    }
  }
  const grade = (x, z) => sampleTerrain(x, z) - 0.12 >= BASE_Y - 0.4;
  const reaches = new Set();
  for (let i = 0; i < N; i++) {
    const r = find(i); if (reaches.has(r)) continue;
    const z = Z_(i), s0 = S_(i), e0 = E_(i);
    let ok = grade(s0 - 0.75, z + 0.5) || grade(e0 + 0.75, z + 0.5);
    for (let x = s0 - 0.5; !ok && x <= e0 + 0.5; x += 1) ok = grade(x, z - 0.5) || grade(x, z + 1.5);
    if (ok) reaches.add(r);
  }
  // a piece that reaches no land is a fragment where undrawn land of the same structure lies beside it (in the rows just
  // past its strips, at least 3 m2 and a twentieth of the piece's own area: the rest of the dock or pier whose walls did not
  // hold); one bounded by water, walls and slivers is a dock drawn whole (a floating dock whose gangway is too narrow to
  // wall), and one with a small gap at its root (a few undrawn rows where it meets the shore) is a pier nearly whole: both stay
  const besideLand = new Map(), pieceArea = new Map(), drop = new Set();
  for (let i = 0; i < N; i++) {
    const r = find(i); if (reaches.has(r)) continue;
    const z = Z_(i), s0 = S_(i), e0 = E_(i);
    let n = besideLand.get(r) || 0;
    for (let x = s0 + 0.5; x < e0; x += 1) for (const zz of [z - 0.5, z + 1.5]) if (onLand(x, zz) && !grade(x, zz) && !apronAt(x, zz)) n++;
    besideLand.set(r, n); pieceArea.set(r, (pieceArea.get(r) || 0) + e0 - s0);
  }
  for (const [r, n] of besideLand) if (n >= 3 && n >= 0.05 * pieceArea.get(r)) drop.add(r);
  if (drop.size) {
    for (let i = 0; i < N; i++) {
      if (!drop.has(find(i))) continue;
      const a = apronSpans[i * 5].a, o = apronSpans[i * 5 + 1];
      for (let k = o + 3; k < o + 18; k += 3) { a[k] = a[o]; a[k + 1] = a[o + 1]; a[k + 2] = a[o + 2]; }   // collapsed to a point
      apronFragmentStrips++;
    }
    apronFragments = drop.size;
    apronRows.clear();   // the rows' spans again, without the fragments: the wall check below reads them
    for (let i = 0; i < N; i++) { if (drop.has(find(i))) continue; let a = apronRows.get(Z_(i)); if (!a) apronRows.set(Z_(i), (a = [])); a.push(S_(i), E_(i)); }
  }
  log(' shore apron pieces reaching no land, taken out as fragments (SG40):', apronFragments, 'pieces,', apronFragmentStrips, 'of', N, 'strips');
}
let wallsOut = 0;
if (SA37) {
  const drawn = (x, z) => sampleTerrain(x, z) - 0.12 >= BASE_Y - 0.4 || apronAt(x, z);
  for (let i = 0; i < wallPieces.length; i += 6) {
    const t = wallPieces[i], o = wallPieces[i + 1];
    if (drawn(wallPieces[i + 2], wallPieces[i + 3]) || drawn(wallPieces[i + 4], wallPieces[i + 5])) continue;
    const a = t.curb.a;
    for (let k = o + 3; k < o + 54; k += 3) { a[k] = a[o]; a[k + 1] = a[o + 1]; a[k + 2] = a[o + 2]; }   // collapsed to a point
    wallsOut++;
  }
  log(' shoreline wall pieces with no drawn ground behind them, taken out (WW39):', wallsOut, 'of', wallPieces.length / 6);
}
for (const [key, t] of tiles) {
  // FINAL RULE FILTER (asphalt is authoritative): drop any pavement tri whose
  // centroid sits inside a live carriageway — backstop over the emitter clamps
  {
    const arr = t.sidewalk.a, n2 = t.sidewalk.n;
    let w = 0;
    for (let i = 0; i + 8 < n2; i += 9) {
      const cx = (arr[i] + arr[i + 3] + arr[i + 6]) / 3;
      const cz = (arr[i + 2] + arr[i + 5] + arr[i + 8]) / 3;
      const cy = (arr[i + 1] + arr[i + 4] + arr[i + 7]) / 3;
      if (inCarriageway(cx, cz, cy, null, -0.55)) continue;
      if (w !== i) arr.copyWithin(w, i, i + 9);
      w += 9;
    }
    t.sidewalk.n = w;
  }
  const grid = buildTerrain(t.tx, t.tz);
  const apron = APRONS.get(key) || shoreApron(t, grid);   // SA37 (computed before the loop: WW39)
  // buildings struct -> arrays
  const nB = t.bldg.length;
  const bldgMeta = new ArrayBuffer(nB * 44);
  const dv = new DataView(bldgMeta);
  t.bldg.forEach((b, i) => {
    const o = i * 44;
    dv.setUint32(o, b.start, true);
    dv.setUint16(o + 4, b.len, true);
    dv.setInt16(o + 6, b.landmarkId, true);
    dv.setFloat32(o + 8, b.baseY, true);
    dv.setFloat32(o + 12, b.height, true);
    dv.setUint8(o + 16, b.floors); dv.setUint8(o + 17, b.style);
    dv.setUint8(o + 18, b.r); dv.setUint8(o + 19, b.g); dv.setUint8(o + 20, b.bcol);
    dv.setUint8(o + 21, b.roofKind); dv.setUint8(o + 22, b.flags); dv.setUint8(o + 23, b.lit);
    dv.setFloat32(o + 24, b.floorH, true);
    dv.setFloat32(o + 28, b.winW, true);
    dv.setFloat32(o + 32, b.storeH, true);
    dv.setUint32(o + 36, b.blind >>> 0, true);
    dv.setUint16(o + 40, Math.min(65000, b.area | 0), true);
    dv.setUint8(o + 42, b.colorVar); dv.setUint8(o + 43, b.frontIdx === 255 || b.frontIdx == null ? 0 : b.frontIdx + 1);
  });
  // CY12 courtyard inner rings -> their OWN section. Nothing above changed: the 44-byte
  // building record is byte-identical to v17 and the court vertices sit in bldgXZ past the
  // parent's outer ring, which is only ever addressed through start/len. A pre-r12 runtime
  // ignores an unknown section and a pre-r12 tile simply has none, so both directions load.
  const nH = t.bholes.length;
  const holeMeta = new ArrayBuffer(nH * 12);
  const dvh = new DataView(holeMeta);
  t.bholes.forEach((h, i) => {
    const o = i * 12;
    dvh.setUint32(o, h.b >>> 0, true);          // parent index into this tile's `bldg` section
    dvh.setUint32(o + 4, h.start >>> 0, true);  // first vertex, as a bldgXZ PAIR index
    dvh.setUint16(o + 8, h.len, true);
    dvh.setUint8(o + 10, h.flags);              // bit 0 = enclosed light court
    dvh.setUint8(o + 11, h.area);               // court area, 4 m2 units
  });
  const nR = t.roadRecs.length;
  const roadMeta = new ArrayBuffer(nR * 24);
  const dvr = new DataView(roadMeta);
  t.roadRecs.forEach((r, i) => {
    const o = i * 24;
    dvr.setUint32(o, r.start, true);
    dvr.setUint16(o + 4, r.len, true);
    dvr.setUint8(o + 6, r.rclass | (r.noTraffic ? 0x80 : 0)); dvr.setInt8(o + 7, r.oneway);   // bit 7 = pedestrianised street, no traffic (tiledata.js strips it)
    dvr.setFloat32(o + 8, r.width, true);
    dvr.setUint8(o + 12, Math.min(255, r.lanes)); dvr.setUint8(o + 13, r.park);
    dvr.setUint8(o + 14, r.level < 0 ? 255 : r.level); dvr.setUint8(o + 15, Math.min(255, r.speed));   // (RG44: 255 = in a cut, below grade)
    dvr.setUint16(o + 16, r.nameIdx, true);
    // spare bytes 18/19: junction mouth distance per end, 0.25m units (0 = none)
    dvr.setUint8(o + 18, Math.min(255, Math.round((r.mouthA || 0) * 4)));
    dvr.setUint8(o + 19, Math.min(255, Math.round((r.mouthB || 0) * 4)));
    dvr.setUint32(o + 20, r.segId >>> 0, true);
  });
  const nF = t.furn.length;
  const furnBuf = new ArrayBuffer(nF * 20);
  const dvf = new DataView(furnBuf);
  t.furn.forEach((f, i) => {
    const o = i * 20;
    dvf.setUint8(o, f.k); dvf.setUint8(o + 1, f.p0 & 255); dvf.setUint8(o + 2, f.p1 & 255); dvf.setUint8(o + 3, (f.p2 ?? 0) & 255);
    dvf.setFloat32(o + 4, f.x - t.x0, true);
    dvf.setFloat32(o + 8, f.y, true);
    dvf.setFloat32(o + 12, f.z - t.z0, true);
    dvf.setFloat32(o + 16, f.rot, true);
  });
  // localize ground soups
  const localize = (f32) => {
    const a = f32.array;
    for (let i = 0; i < a.length; i += 3) { a[i] -= t.x0; a[i + 2] -= t.z0; }
    return a;
  };
  const file = `t_${key}.bin`;
  writeTile(path.join(OUT, file), {
    v: 1, tx: t.tx, tz: t.tz, origin: [t.x0, t.z0], names: t.names, nodes: t.nodesJson, res: resOf(t.tx, t.tz),
    ...(t.railCuts.length ? { railCuts: t.railCuts } : {}),
  }, [
    { name: 'bldgXZ', array: t.bldgXZ.array },
    { name: 'bldg', array: new Uint8Array(bldgMeta) },
    { name: 'bholes', array: new Uint8Array(holeMeta) },   // CY12
    { name: 'roadVerts', array: t.roadVerts.array },
    { name: 'roads', array: new Uint8Array(roadMeta) },
    { name: 'furn', array: new Uint8Array(furnBuf) },
    { name: 'terrain', array: grid },
    { name: 'asphalt', array: localize(t.asphalt) },
    { name: 'sidewalk', array: localize(t.sidewalk) },
    { name: 'curb', array: localize(t.curb) },
    { name: 'paintW', array: localize(t.paintW) },
    { name: 'paintY', array: localize(t.paintY) },
    { name: 'paintG', array: localize(t.paintG) },
    { name: 'grass', array: localize(t.grass) },
    { name: 'grassU', array: localize(t.grassU) },   // TL26
    { name: 'path', array: localize(t.pathTris) },
    { name: 'brick', array: localize(t.brick) },
    { name: 'gutter', array: localize(t.gutter) },
    { name: 'busred', array: localize(t.busred) },
    { name: 'warn', array: localize(t.warn) },
    { name: 'warnIron', array: localize(t.warnIron) },
    ...(apron.n ? [{ name: 'apron', array: localize(apron) }] : []),   // SA37 shore aprons (drawn as terrain)
    ...(t.rtop.n || t.rsteel.n || t.rwall.n ? [
      { name: 'rsteel', array: localize(t.rsteel) }, { name: 'rbal', array: localize(t.rbal) },
      { name: 'rtop', array: localize(t.rtop) }, { name: 'rtopA', array: t.rtopA.array }, { name: 'rwall', array: localize(t.rwall) },
    ] : []),
  ]);
  manifest.tiles[key] = { f: file, b: nB, r: nR, fu: nF, ...(nH ? { h: nH } : {}) };   // CY12: h = courtyard records
  written++;
}
tiles.clear(); // release every tile's geometry buffers before far LoD: the 4-boro run hit the 4.3 GB heap limit here (2026-09-03)
log('tiles written:', written);
if (SA37_DBG) fs.writeFileSync(path.join(OUT, '..', 'sa37_debug.json'), JSON.stringify(sa37Dbg));
if (SA37) log(' shore aprons (SA37):', apronTiles, 'tiles,', apronTris, 'tris,', apronDropped, 'runs left to the water (no wall at their ring edge)');

// ---------------------------------------------------------------- far LoD macros
log('far LoD');
const macros = new Map();
for (const b of buildings) {
  if (b.drop) continue;
  const mx = Math.floor(b.cx / MACRO), mz = Math.floor(b.cz / MACRO);
  const k = `${mx}_${mz}`;
  let m = macros.get(k);
  if (!m) macros.set(k, (m = { mx, mz, pos: [], col: [], count: 0 }));
  // CY12: the far LoD stays SOLID on purpose — b.ring is the outer ring and courts are not
  // punched here. At 2 km a 6 m light court is well under a pixel, the macro already
  // collapses anything over 8 vertices to its oriented bbox, and a hole in the far shell
  // only leaks sky through the block. Consistency here means "no court", deliberately.
  let ring = b.ring.length <= 7 ? b.ring : simplify(b.ring, 2.0);
  if (ring.length > 8) ring = orientedBBox(b.ring).pts;
  const x0 = mx * MACRO, z0 = mz * MACRO;
  const yB = Math.max(b.base, 1), yT = b.base + b.h;
  const col = b.color, lit = b.c ? (b.c.lit * 255) | 0 : 60;
  const n = ring.length;
  const P = m.pos, C = m.col;
  const shade = (f) => [col[0] * f, col[1] * f, col[2] * f];
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[(i + 1) % n];
    // exterior normal for shoelace-positive ring is (+ez, -ex); bake sun-from-NW shading
    const ex = bx - ax, ez = bz - az;
    const Ln = Math.hypot(ex, ez) || 1;
    const nx2 = ez / Ln, nz2 = -ex / Ln;
    const f = 0.62 + 0.38 * Math.max(0, -nx2 * 0.7 + nz2 * 0.3);
    const [r2, g2, b2] = shade(f);
    const quad = [[ax, yB, az], [ax, yT, az], [bx, yT, bz], [bx, yB, bz]];
    for (const idx of [0, 1, 2, 0, 2, 3]) {
      const [x, y, z] = quad[idx];
      P.push(Math.round((x - x0) * 8), Math.round(y * 8), Math.round((z - z0) * 8));
      C.push(r2, g2, b2, lit);
    }
  }
  // roof fan (front face up)
  const rc = shade(0.5);
  for (let i = 1; i < n - 1; i++) {
    for (const [x, z] of [ring[0], ring[i + 1], ring[i]]) {
      P.push(Math.round((x - x0) * 8), Math.round(yT * 8), Math.round((z - z0) * 8));
      C.push(rc[0], rc[1], rc[2], lit);
    }
  }
  m.count++;
}
for (const [k, m] of macros) {
  const file = `far_${k}.bin`;
  // coarse ground heightfield for the far view (33x33 over 2km)
  const MRES = 32, terr = new Float32Array((MRES + 1) ** 2);
  for (let j = 0; j <= MRES; j++) for (let i = 0; i <= MRES; i++) {
    const x = m.mx * MACRO + (i / MRES) * MACRO, z = m.mz * MACRO + (j / MRES) * MACRO;
    terr[j * (MRES + 1) + i] = onLand(x, z) ? Math.max(1.2, sampleTerrain(x, z)) : -3.5;
  }
  writeTile(path.join(OUT, file), { v: 1, mx: m.mx, mz: m.mz, origin: [m.mx * MACRO, m.mz * MACRO], scale: 1 / 8 }, [
    { name: 'pos', array: new Int16Array(m.pos) },
    { name: 'col', array: new Uint8Array(m.col) },
    { name: 'terr', array: terr },
  ]);
  manifest.macros[k] = { f: file, n: m.count };
}
log('macros:', macros.size);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest));

// ---------------------------------------------------------------- city AO
// City-scale sky-occlusion bake: the Lumen-shaped hole in the runtime is that
// ambient light arrives at full strength everywhere — canyon floor and open
// plaza identical. Bake a horizon-scan sky-visibility field from the building
// heightfield (8 azimuths x exponential radii, blocker tops relative to local
// ground) + a terrain-height channel so shaders can fade AO out with height
// above street. Output: raw RG bytes + JSON rect, sampled as a world-space
// texture that scales INDIRECT light only.
{
  log('baking city AO');
  const ax0 = WX0 - 60, az0 = WZ0 - 60, ax1 = WX1 + 60, az1 = WZ1 + 60;
  // the texture grows with the city so its cell stays near 14 m: 2048 texels across the four boroughs' 40.6 km was a
  // 14 x 20 m cell; the five boroughs' 47 km at 2048 would coarsen it to 23 m everywhere (AO_RES overrides)
  const RES = Number(process.env.AO_RES) || Math.min(8192, Math.max(2048, Math.ceil(Math.max(ax1 - ax0, az1 - az0) / 14 / 64) * 64));
  const csx = (ax1 - ax0) / RES, csz = (az1 - az0) / RES;
  const top = new Float32Array(RES * RES); // blocker height above own ground
  for (const b of buildings) {
    if (b.drop || !b.ring || b.h < 3) continue;
    let bx0 = 1e9, bz0 = 1e9, bx1 = -1e9, bz1 = -1e9;
    for (const [x, z] of b.ring) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
    const i0 = Math.max(0, Math.floor((bx0 - ax0) / csx)), i1 = Math.min(RES - 1, Math.ceil((bx1 - ax0) / csx));
    const j0 = Math.max(0, Math.floor((bz0 - az0) / csz)), j1 = Math.min(RES - 1, Math.ceil((bz1 - az0) / csz));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const px = ax0 + (i + 0.5) * csx, pz = az0 + (j + 0.5) * csz;
        // point-in-poly (ray cast)
        let inside = false;
        const r = b.ring;
        for (let k = 0, m = r.length - 1; k < r.length; m = k++) {
          if (((r[k][1] > pz) !== (r[m][1] > pz)) && (px < (r[m][0] - r[k][0]) * (pz - r[k][1]) / (r[m][1] - r[k][1]) + r[k][0])) inside = !inside;
        }
        // CY12: a light court is open to the sky, so it must NOT be stamped into the
        // blocker field. Rasterising the outer ring solid made the court itself a blocker
        // as tall as the building — the horizon scan then read the court floor and the
        // court walls as if they stood on a roof, and the deep shade a real court sits in
        // never appeared. Punched back out here, the scan sees the surrounding walls and
        // the court comes out correctly dark.
        if (inside) for (const hr of b.holes || []) if (pointInPoly(px, pz, hr)) { inside = false; break; }
        if (inside) { const ix = j * RES + i; if (b.h > top[ix]) top[ix] = b.h; }
      }
    }
  }
  // horizon scan: eye at +8m (above rowhouse roofs — keeps low roofs from
  // self-darkening), slope-space max, sky = 1 - mean(sin(horizon))
  const RADII = [12, 20, 32, 52, 84, 130, 190];
  const AZ = 8;
  const out = new Uint8Array(RES * RES * 2);
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      let occ = 0;
      for (let a = 0; a < AZ; a++) {
        const dx = Math.cos(a * Math.PI * 2 / AZ), dz = Math.sin(a * Math.PI * 2 / AZ);
        let maxS = 0;
        for (const rr of RADII) {
          const si = i + Math.round(dx * rr / csx), sj = j + Math.round(dz * rr / csz);
          if (si < 0 || si >= RES || sj < 0 || sj >= RES) break;
          const s = (top[sj * RES + si] - 8) / rr;
          if (s > maxS) maxS = s;
        }
        occ += maxS / Math.sqrt(1 + maxS * maxS); // sin(atan(maxS))
      }
      const vis = 1 - occ / AZ;
      const ix = (j * RES + i) * 2;
      out[ix] = Math.round(Math.max(0, Math.min(1, vis)) * 255);
    }
  }
  // 3x3 box blur on visibility + terrain channel
  const blur = new Uint8Array(RES * RES);
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      let s = 0, n = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const ii = i + di, jj = j + dj;
        if (ii >= 0 && ii < RES && jj >= 0 && jj < RES) { s += out[(jj * RES + ii) * 2]; n++; }
      }
      blur[j * RES + i] = Math.round(s / n);
    }
  }
  for (let j = 0; j < RES; j++) {
    for (let i = 0; i < RES; i++) {
      const ix = (j * RES + i) * 2;
      out[ix] = blur[j * RES + i];
      const t = sampleTerrain(ax0 + (i + 0.5) * csx, az0 + (j + 0.5) * csz);
      out[ix + 1] = Math.round(Math.max(0, Math.min(255, t * 2))); // terrain m * 2 (0..127m)
    }
  }
  fs.mkdirSync(path.join(OUT, '..', 'textures'), { recursive: true }); // TILES_OUT runs write beside their tiles
  fs.writeFileSync(path.join(OUT, '..', 'textures', 'cityao.bin'), out);
  fs.writeFileSync(path.join(OUT, '..', 'textures', 'cityao.json'), JSON.stringify({ x0: ax0, z0: az0, x1: ax1, z1: az1, res: RES }));
  log('city AO baked:', RES + 'x' + RES, `cell ${csx.toFixed(1)}x${csz.toFixed(1)}m`);
}
// FB38 crown gate (crowngate.mjs): the runtime's tower pass (src/world/towers.js) run over every record of the written
// set that takes it (after the manifest); every part must rest on the ground or on its own building within 0.5 m.
// Logged and written beside the tiles (crown_gate.json); NO_CROWN_GATE=1 skips it.
if (!process.env.NO_CROWN_GATE) {
  const { crownGateTiles } = await import('./crowngate.mjs');
  const cg = await crownGateTiles(OUT);
  fs.writeFileSync(path.join(OUT, '..', 'crown_gate.json'), JSON.stringify(cg, null, 1));
  log(' crown gate (FB38):', cg.buildings, 'buildings through the tower pass,', cg.walls, 'walls,', cg.failing.length, 'buildings with a part not resting on the ground or on its own building', cg.failing.length ? '(see crown_gate.json)' : '');
  if (cg.failing.length) { log(' CROWN GATE FAILED'); process.exitCode = 3; }
}
// OV39 OVERLAYS (shared/overlay.js). LF39 (the buildings our footprint export lacks, the parking-lot cars, the NYCHA lawns)
// and GF38 (125th Street's bare ground paved from the planimetric data) are baked against compiled tiles; keyed on file size
// they went silent after the run 6 swap, when every tile changed. They are now baked here, against the tiles just written,
// into <tiles>/overlays/ (which the page reads before the copy in public/data), each entry keyed on its tile's content,
// and gated: a missing or stale overlay ends the compile with exit code 3. NO_OVERLAYS=1 skips the step.
if (!process.env.NO_OVERLAYS) {
  const { spawnSync } = await import('node:child_process');
  const ovDir = path.join(OUT, 'overlays'), dumpDir = path.join(OUT, '..', 'gf38_dump');
  const step = (cmd, args, env = {}) => {
    const r = spawnSync(cmd, args, { env: { ...process.env, TILES_DIR: OUT, ...env }, encoding: 'utf8', maxBuffer: 1 << 28 });
    return r.status === 0 ? null : `${cmd} ${args[0]}: ` + String(r.stderr || r.stdout || r.error || r.status).slice(-800);
  };
  let err = step('node', ['tools/ar34/ground/gf38_dump.mjs', dumpDir]);
  if (!err) err = step('python3', ['tools/ar34/ground/gf38_bake.py', '--chain', dumpDir, '--tiles-dir', OUT, '--out', path.join(ovDir, 'gf38'), '--fresh']);
  if (!err) err = step('node', ['tools/ar34/lotfix/lf39_bake.mjs'], { GF38_DIR: path.join(ovDir, 'gf38'), LF39_OUT: ovDir });
  if (err) { log(' OVERLAYS FAILED:', err); process.exitCode = 3; }
  else {
    const { overlayGate, overlayLine } = await import('./overlaygate.mjs');
    const og = overlayGate(OUT);
    fs.writeFileSync(path.join(OUT, '..', 'overlay_gate.json'), JSON.stringify(og, null, 1));
    log(' overlays (OV39):', overlayLine(og));
    if (og.failed) { log(' OVERLAY GATE FAILED'); process.exitCode = 3; }
  }
}
// TW39 TOWER GATE (towergate.mjs): every footprint over 60 m in the exports this compile read must be drawn at its height
// (by a compiled record, or by an LF39 building of the set's overlays); written beside the tiles (tower_gate.json),
// a failure ends the compile with exit code 3. NO_TOWER_GATE=1 skips it.
if (!process.env.NO_TOWER_GATE) {
  const { towerGate, towerLine } = await import('./towergate.mjs');
  const tg = await towerGate(OUT, { minH: 60, footprints: FOOT_DIR });
  fs.writeFileSync(path.join(OUT, '..', 'tower_gate.json'), JSON.stringify(tg, null, 1));
  log(' tower gate (TW39):', towerLine(tg));
  if (tg.failures) { log(' TOWER GATE FAILED:', tg.failures, 'footprints over 60 m not drawn at their height (see tower_gate.json)'); process.exitCode = 3; }
}
// SG40 SHORE GATE (shoregate.mjs): from the written tiles, per tile, the metres of shore with land behind it drawn as neither
// a bulkhead nor ground (spikes and tips excluded), bulkheads with no ground behind them, and bulkheads facing inland; any
// tile over its limits ends the compile with exit code 3 (the marina finger piers of runs 7 to 11 would have). Written
// beside the tiles (shore_gate.json); NO_SHORE_GATE=1 skips it.
if (SA37 && !process.env.NO_SHORE_GATE) {
  const { shoreGate, shoreLine } = await import('./shoregate.mjs');
  const sg = shoreGate(OUT, { baseY: BASE_Y, njPatches: NJ_PATCHES });
  fs.writeFileSync(path.join(OUT, '..', 'shore_gate.json'), JSON.stringify(sg, null, 1));
  log(' shore gate (SG40):', shoreLine(sg));
  if (sg.failed) { log(' SHORE GATE FAILED:', sg.failing.length, 'tiles over the limits (see shore_gate.json):', sg.failing.slice(0, 8).map((f) => `${f.tile} ${f.leftM} m ${f.planks}p ${f.inland}i`).join(', ')); process.exitCode = 3; }
}
log('DONE. tiles:', written, 'macros:', macros.size, 'buildings:', buildings.filter((b) => !b.drop).length);
