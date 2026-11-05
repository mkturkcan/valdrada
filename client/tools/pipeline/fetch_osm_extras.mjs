// OpenStreetMap extracts the city records lack (© OpenStreetMap contributors, ODbL; raw data only, never shipped):
//
//   landings  the New Jersey ends of the four bridges whose CSCL records stop at the state line (George Washington,
//             Bayonne, Goethals, Outerbridge Crossing): the bridge ways' full alignment, the approach ways past the
//             New Jersey abutment, and the shore (natural=coastline, land on its left) as land polygons inside the box
//   gateway   Gateway National Recreation Area's units in the city (Fort Wadsworth, Miller Field, Jacob Riis Park, Fort
//             Tilden, Breezy Point Tip, Floyd Bennett Field, Jamaica Bay Wildlife Refuge, Canarsie Pier, Plumb Beach,
//             Frank Charles Park): the unit outline and its land cover (grass, meadow, scrub, wood, wetland, beach)
//
//   waterfront  the waterfront parks the city's parks file lacks (other jurisdictions: Brooklyn Bridge Park on its piers):
//             the park outline and its land cover, as gateway
//
//   node tools/pipeline/fetch_osm_extras.mjs [landings] [gateway] [waterfront]
//
// One OSM API 0.6 `map` call per box (the Overpass mirrors were refusing queries on 2026-10-11); the XML is cached in
// data/raw/osm_extras/<name>.xml and parsed into data/raw/osm_landings.json and data/raw/osm_gateway.json (lon, lat).
import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('data/raw');
const XML_DIR = path.join(RAW, 'osm_extras');
fs.mkdirSync(XML_DIR, { recursive: true });
const UA = 'valdrada-research/0.1 (project contact: github.com/mkturkcan/valdrada)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// box = [west, south, east, north]
const LANDINGS = {
  gwb: { name: /^George Washington Bridge/, box: [-73.9760, 40.8475, -73.9550, 40.8585] },
  bayonne: { name: /^Bayonne Bridge$/, box: [-74.1490, 40.6405, -74.1300, 40.6525] },
  goethals: { name: /^Goethals Bridge$/, box: [-74.2130, 40.6320, -74.1930, 40.6450] },
  outerbridge: { name: /^Outerbridge Crossing$/, box: [-74.2800, 40.5180, -74.2470, 40.5320] },
};
const GATEWAY = {
  fortWadsworth: { unit: /Fort Wadsworth/, box: [-74.0640, 40.5960, -74.0480, 40.6080] },
  millerField: { unit: /Miller Field/, box: [-74.1060, 40.5600, -74.0920, 40.5720] },
  breezyTip: { unit: /Breezy Point/, box: [-73.9420, 40.5480, -73.9050, 40.5620] },
  fortTilden: { unit: /Fort Tilden/, box: [-73.9050, 40.5520, -73.8780, 40.5680] },
  jacobRiis: { unit: /Jacob Riis/, box: [-73.8780, 40.5580, -73.8580, 40.5720] },
  floydBennett: { unit: /Floyd Bennett/, box: [-73.9050, 40.5780, -73.8780, 40.6000] },
  jamaicaBayRefuge: { unit: /Jamaica Bay Wildlife Refuge/, box: [-73.8400, 40.6050, -73.8100, 40.6300] },
  canarsiePier: { unit: /Canarsie Pier/, box: [-73.8930, 40.6250, -73.8800, 40.6330] },
  plumbBeach: { unit: /Plumb Beach/, box: [-73.9300, 40.5780, -73.9050, 40.5870] },
  frankCharles: { unit: /Frank (M\. )?Charles/, box: [-73.8400, 40.6500, -73.8270, 40.6600] },   // OSM: "Frank M. Charles Memorial Park"
};

const WATERFRONT = {
  brooklynBridgePark: { unit: /^Brooklyn Bridge Park$/, box: [-74.0010, 40.6930, -73.9880, 40.7050] },
};

async function osmMap(name, box) {
  const file = path.join(XML_DIR, `${name}.xml`);
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch(`https://api.openstreetmap.org/api/0.6/map?bbox=${box.join(',')}`, { headers: { 'User-Agent': UA } }).catch((e) => ({ ok: false, status: String(e) }));
    if (r.ok) { const txt = await r.text(); fs.writeFileSync(file, txt); console.log(`  ${name}: ${(txt.length / 1e6).toFixed(1)} MB`); await sleep(1500); return txt; }
    console.log(`  ${name}: HTTP ${r.status}, retry`);
    await sleep(5000 * (attempt + 1));
  }
  throw new Error('OSM API failed for ' + name);
}

// ---- a small parser for the API's XML (nodes, ways, relations with tags)
function parseOsm(xml) {
  const nodes = new Map(), ways = new Map(), rels = [];
  const attr = (s, k) => { const m = new RegExp(`\\b${k}="([^"]*)"`).exec(s); return m ? m[1] : null; };
  const tagsOf = (body) => { const t = {}; for (const m of body.matchAll(/<tag k="([^"]*)" v="([^"]*)"\/>/g)) t[m[1]] = m[2].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&gt;/g, '>').replace(/&lt;/g, '<'); return t; };
  for (const m of xml.matchAll(/<node ([^>]*?)(\/>|>([\s\S]*?)<\/node>)/g)) nodes.set(attr(m[1], 'id'), [+attr(m[1], 'lon'), +attr(m[1], 'lat')]);
  for (const m of xml.matchAll(/<way ([^>]*?)>([\s\S]*?)<\/way>/g)) {
    const nd = [...m[2].matchAll(/<nd ref="(\d+)"\/>/g)].map((x) => x[1]);
    ways.set(attr(m[1], 'id'), { id: attr(m[1], 'id'), nd, tags: tagsOf(m[2]) });
  }
  for (const m of xml.matchAll(/<relation ([^>]*?)>([\s\S]*?)<\/relation>/g)) {
    const members = [...m[2].matchAll(/<member type="(\w+)" ref="(\d+)" role="([^"]*)"\/>/g)].map((x) => ({ type: x[1], ref: x[2], role: x[3] }));
    rels.push({ id: attr(m[1], 'id'), members, tags: tagsOf(m[2]) });
  }
  const coords = (w) => w.nd.map((id) => nodes.get(id)).filter(Boolean);
  return { nodes, ways, rels, coords };
}
// rings of a closed way or a multipolygon relation's outer members (way chains joined end to end)
function chainRings(lines) {
  const rings = [], open = lines.map((l) => l.slice());
  while (open.length) {
    let cur = open.shift();
    for (let guard = 0; guard < 1000; guard++) {
      const a = cur[0], b = cur[cur.length - 1];
      if (cur.length > 3 && a[0] === b[0] && a[1] === b[1]) break;
      const k = open.findIndex((l) => (l[0][0] === b[0] && l[0][1] === b[1]) || (l[l.length - 1][0] === b[0] && l[l.length - 1][1] === b[1]));
      if (k < 0) break;
      let nx = open.splice(k, 1)[0];
      if (!(nx[0][0] === b[0] && nx[0][1] === b[1])) nx = nx.reverse();
      cur = cur.concat(nx.slice(1));
    }
    const a = cur[0], b = cur[cur.length - 1];
    if (cur.length > 3 && a[0] === b[0] && a[1] === b[1]) rings.push(cur);
  }
  return rings;
}
function areasOf(O, pred) {
  const out = [];
  for (const w of O.ways.values()) {
    if (!pred(w.tags)) continue;
    const c = O.coords(w);
    if (c.length > 3 && w.nd[0] === w.nd[w.nd.length - 1]) out.push({ tags: w.tags, rings: [c] });
  }
  for (const r of O.rels) {
    if (r.tags.type !== 'multipolygon' && r.tags.type !== 'boundary') continue;
    if (!pred(r.tags)) continue;
    const outer = [];
    for (const m of r.members) if (m.type === 'way' && (m.role === 'outer' || m.role === '') && O.ways.has(m.ref)) outer.push(O.coords(O.ways.get(m.ref)));
    const rings = chainRings(outer.filter((l) => l.length > 1));
    if (rings.length) out.push({ tags: r.tags, rings });
  }
  return out;
}

// ---- New York City's land (boundaries.geojson), to keep only the far shore of each landing
const NYC = JSON.parse(fs.readFileSync(path.join(RAW, 'boundaries.geojson'), 'utf8')).features.flatMap((f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [f.geometry.coordinates]));
const pip = (x, y, ring) => { let ins = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins; } return ins; };
const inNYC = (lon, lat) => NYC.some((poly) => pip(lon, lat, poly[0]) && !poly.slice(1).some((h) => pip(lon, lat, h)));
// metres from a point to the nearest vertex of New York's land (0 inside it)
const NYC_V = NYC.flatMap((poly) => poly[0].filter((_, i) => i % 3 === 0));
const nycDist = ([lon, lat]) => { if (inNYC(lon, lat)) return 0; let b = 1e18; for (const [x, y] of NYC_V) { const d = ((x - lon) * 84300) ** 2 + ((y - lat) * 111132) ** 2; if (d < b) b = d; } return Math.sqrt(b); };

// land polygons inside a box from the coastline (land on the LEFT of the way's direction): each coastline chain is
// clipped to the box; a piece enters and leaves through the box's edge, and the land closes along that edge
// counter-clockwise (the side that keeps the land on the left) to the next piece's entry
function coastLand(O, box) {
  const [W, S, E, N] = box;
  const lines = [];
  for (const w of O.ways.values()) if (w.tags.natural === 'coastline') lines.push(O.coords(w));
  // join coastline ways into chains (end node = next start node)
  const chains = [], open = lines.filter((l) => l.length > 1);
  while (open.length) {
    let cur = open.shift(), grown = true;
    while (grown) {
      grown = false;
      const b = cur[cur.length - 1], a = cur[0];
      const k = open.findIndex((l) => l[0][0] === b[0] && l[0][1] === b[1]);
      if (k >= 0) { cur = cur.concat(open.splice(k, 1)[0].slice(1)); grown = true; continue; }
      const k2 = open.findIndex((l) => l[l.length - 1][0] === a[0] && l[l.length - 1][1] === a[1]);
      if (k2 >= 0) { cur = open.splice(k2, 1)[0].concat(cur.slice(1)); grown = true; }
    }
    chains.push(cur);
  }
  const inside = (p) => p[0] >= W && p[0] <= E && p[1] >= S && p[1] <= N;
  // the box boundary as a parameter 0..4 counter-clockwise from the south-west corner: south edge W->E, east S->N,
  // north E->W, west N->S
  const perim = (p) => {
    const eps = 1e-9;
    if (Math.abs(p[1] - S) < eps) return (p[0] - W) / (E - W);
    if (Math.abs(p[0] - E) < eps) return 1 + (p[1] - S) / (N - S);
    if (Math.abs(p[1] - N) < eps) return 2 + (E - p[0]) / (E - W);
    return 3 + (N - p[1]) / (N - S);
  };
  const corner = [[W, S], [E, S], [E, N], [W, N]];   // at 0, 1, 2, 3
  const cross = (p, q) => {   // where segment p->q crosses the box edge (q outside or p outside)
    let t0 = 0, t1 = 1;
    const dx = q[0] - p[0], dy = q[1] - p[1];
    for (const [pp, qq] of [[-dx, p[0] - W], [dx, E - p[0]], [-dy, p[1] - S], [dy, N - p[1]]]) {
      if (pp === 0) { if (qq < 0) return null; continue; }
      const r = qq / pp;
      if (pp < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [t0, t1];
  };
  const pieces = [], rings = [];
  for (const ch of chains) {
    const closed = ch.length > 3 && ch[0][0] === ch[ch.length - 1][0] && ch[0][1] === ch[ch.length - 1][1];
    if (closed && ch.every(inside)) { rings.push(ch); continue; }
    let cur = null;
    for (let i = 1; i < ch.length; i++) {
      const p = ch[i - 1], q = ch[i], c = cross(p, q);
      if (!c) { if (cur) { pieces.push(cur); cur = null; } continue; }
      const [t0, t1] = c, A = [p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0], B = [p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1];
      if (!cur) cur = [A]; else if (t0 > 0) { pieces.push(cur); cur = [A]; }
      cur.push(B);
      if (t1 < 1) { pieces.push(cur); cur = null; }
    }
    if (cur && cur.length > 1) pieces.push(cur);   // a chain ending inside the box: left open, dropped below
  }
  // close the pieces that enter and leave through the edge
  const edged = pieces.filter((pc) => pc.length > 1 && !inside2(pc[0]) && !inside2(pc[pc.length - 1]));
  function inside2(p) { const e = 1e-9; return p[0] > W + e && p[0] < E - e && p[1] > S + e && p[1] < N - e; }
  const used = new Set();
  for (let s = 0; s < edged.length; s++) {
    if (used.has(s)) continue;
    let ring = [], k = s;
    for (let guard = 0; guard < 64; guard++) {
      used.add(k);
      ring = ring.concat(edged[k]);
      const exitT = perim(edged[k][edged[k].length - 1]);
      // the next entry counter-clockwise from the exit
      let best = -1, bd = 9;
      for (let j = 0; j < edged.length; j++) {
        const d = (perim(edged[j][0]) - exitT + 4) % 4;
        if (d < bd && (j === s || !used.has(j))) { bd = d; best = j; }
      }
      if (best < 0) break;
      // walk the box's corners between the exit and that entry
      const entryT = exitT + bd;
      for (let c = Math.ceil(exitT); c < entryT; c++) ring.push(corner[c % 4]);
      if (best === s) break;
      k = best;
    }
    ring.push(ring[0]);
    if (ring.length > 3) rings.push(ring);
  }
  return rings;
}
const lenM = (pts) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot((pts[i][0] - pts[i - 1][0]) * 84300, (pts[i][1] - pts[i - 1][1]) * 111132); return s; };

async function landings() {
  const out = {};
  for (const [key, L] of Object.entries(LANDINGS)) {
    const O = parseOsm(await osmMap('landing_' + key, L.box));
    // the bridge: highway ways tagged bridge=yes with the bridge's name, joined into chains; the longest chain
    const bw = [...O.ways.values()].filter((w) => w.tags.highway && w.tags.bridge && L.name.test(w.tags.name || '') && !/cycleway|footway|path|construction/.test(w.tags.highway));
    const chains = [];
    for (const w of bw) chains.push({ ids: [w.id], nd: w.nd.slice(), layer: w.tags.layer || '' });
    for (let merged = true; merged;) {
      merged = false;
      for (const a of chains) for (const b of chains) {
        if (a === b || a.layer !== b.layer) continue;
        if (a.nd[a.nd.length - 1] === b.nd[0]) { a.nd = a.nd.concat(b.nd.slice(1)); a.ids.push(...b.ids); chains.splice(chains.indexOf(b), 1); merged = true; break; }
      }
      if (merged) continue;
    }
    const geo = chains.map((c) => ({ ...c, pts: c.nd.map((id) => O.nodes.get(id)).filter(Boolean) })).sort((a, b) => lenM(b.pts) - lenM(a.pts));
    if (!geo.length) { console.log(`  ${key}: no bridge ways`); continue; }
    let strand = geo[0];
    // orient New York -> New Jersey: the end nearer New York's land comes first
    if (nycDist(strand.pts[strand.pts.length - 1]) < nycDist(strand.pts[0])) strand = { ...strand, pts: strand.pts.slice().reverse(), nd: strand.nd.slice().reverse() };
    // the approach past the New Jersey abutment: highway ways sharing its last node, the straightest each step, 450 m
    const approach = [strand.pts[strand.pts.length - 1]];
    let node = strand.nd[strand.nd.length - 1], prevDir = null, run = 0;
    const usedW = new Set(strand.ids);
    {
      const pts = strand.pts, n = pts.length;
      prevDir = [pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]];
    }
    for (let step = 0; step < 40 && run < 450; step++) {
      let best = null, bestDot = -2;
      for (const w of O.ways.values()) {
        if (usedW.has(w.id) || !w.tags.highway || !/motorway|trunk|primary/.test(w.tags.highway)) continue;
        let i = w.nd.indexOf(node);
        if (i < 0) continue;
        // follow the way away from the node, either way along it (the alignment matters here, not the traffic)
        for (const dir of [1, -1]) {
          const j = i + dir;
          if (j < 0 || j >= w.nd.length) continue;
          const a = O.nodes.get(node), b = O.nodes.get(w.nd[j]);
          if (!a || !b) continue;
          const d = [b[0] - a[0], b[1] - a[1]], l1 = Math.hypot(d[0], d[1]) || 1, l2 = Math.hypot(prevDir[0], prevDir[1]) || 1;
          const dot = (d[0] * prevDir[0] + d[1] * prevDir[1]) / (l1 * l2);
          if (dot > bestDot) { bestDot = dot; best = { w, i, dir }; }
        }
      }
      if (!best || bestDot < 0.5) break;
      usedW.add(best.w.id);
      const { w, i, dir } = best;
      for (let j = i + dir; j >= 0 && j < w.nd.length && run < 450; j += dir) {
        const a = approach[approach.length - 1], b = O.nodes.get(w.nd[j]);
        if (!b) break;
        run += lenM([a, b]);
        prevDir = [b[0] - a[0], b[1] - a[1]];
        approach.push(b);
        node = w.nd[j];
      }
    }
    // the far shore: coastline land in the box that is not New York
    const land = coastLand(O, L.box).filter((r) => { let n = 0, k = 0; for (let i = 0; i < r.length; i += Math.max(1, Math.floor(r.length / 40))) { n++; if (inNYC(r[i][0], r[i][1])) k++; } return k / Math.max(1, n) < 0.5; });
    out[key] = { box: L.box, bridge: strand.pts, layer: strand.layer, approach, land, bridgeWays: strand.ids.length };
    const f = (p) => p.map((v) => v.toFixed(5)).join(',');
    console.log(`  ${key}: bridge ${strand.ids.length} ways ${lenM(strand.pts).toFixed(0)} m from ${f(strand.pts[0])} (${nycDist(strand.pts[0]).toFixed(0)} m from NYC) to ${f(strand.pts[strand.pts.length - 1])} (${nycDist(strand.pts[strand.pts.length - 1]).toFixed(0)} m), approach ${lenM(approach).toFixed(0)} m to ${f(approach[approach.length - 1])}, ${land.length} land ring(s) (${land.map((r) => r.length).join(', ')} pts)`);
  }
  fs.writeFileSync(path.join(RAW, 'osm_landings.json'), JSON.stringify(out));
  console.log('wrote data/raw/osm_landings.json');
}

async function gateway(SET = GATEWAY, pre = 'gateway', outName = 'osm_gateway.json') {
  const COVER = (t) => /^(grass|meadow|recreation_ground|village_green|forest)$/.test(t.landuse || '') || /^(grassland|heath|scrub|wood|wetland|beach|sand)$/.test(t.natural || '') || /^(park|nature_reserve|golf_course)$/.test(t.leisure || '');
  const out = {};
  for (const [key, G] of Object.entries(SET)) {
    const O = parseOsm(await osmMap(pre + '_' + key, G.box));
    const all = areasOf(O, (t) => COVER(t) || t.boundary === 'protected_area' || t.boundary === 'national_park');
    const units = all.filter((a) => G.unit.test(a.tags.name || '') && (a.tags.leisure || a.tags.boundary));
    const cover = all.filter((a) => COVER(a.tags) && !G.unit.test(a.tags.name || ''));
    const kind = (t) => /^(wood|scrub)$/.test(t.natural || '') || t.landuse === 'forest' ? 'wood' : /^(beach|sand)$/.test(t.natural || '') ? 'sand' : t.natural === 'wetland' ? 'wetland' : 'grass';
    out[key] = {
      box: G.box,
      units: units.map((u) => ({ name: u.tags.name, rings: u.rings })),
      cover: cover.map((c) => ({ kind: kind(c.tags), name: c.tags.name || '', rings: c.rings })),
    };
    console.log(`  ${key}: ${units.length} unit outline(s) [${units.map((u) => u.tags.name).join('; ')}], ${cover.length} land-cover areas`);
  }
  fs.writeFileSync(path.join(RAW, outName), JSON.stringify(out));
  console.log('wrote data/raw/' + outName);
}

const which = process.argv.slice(2);
if (!which.length || which.includes('landings')) await landings();
if (!which.length || which.includes('gateway')) await gateway();
if (!which.length || which.includes('waterfront')) await gateway(WATERFRONT, 'waterfront', 'osm_waterfront.json');
