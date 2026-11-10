// Compose the README and documentation figures from the renders (capture.py) and the maps (maps.mjs, citymap.mjs).
//
//   node tools/figures/compose.mjs --raw <captures dir> --maps <maps dir> [--out docs/assets/figures] [--only hero,sensors]
//
// Every figure is an HTML page (Inter, dark theme) rendered by headless Chromium; overlays that must register with a
// render (bands, boxes, tile grids) are SVG in the render's own pixel or world coordinates, cropped by viewBox.
// The architecture diagram is not composed here: its source is docs/assets/figures/src/architecture.drawio, rendered by
// tools/figures/drawio.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { project } from '../../client/src/shared/geo.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const RAW = path.resolve(opt('raw', path.join(repo, 'docs', 'assets', 'figures', 'raw')));
const MAPS = path.resolve(opt('maps', path.join(repo, 'docs', 'assets', 'figures', 'maps')));
const OUT = path.resolve(opt('out', path.join(repo, 'docs', 'assets', 'figures')));
const ONLY = opt('only', null)?.split(',');
fs.mkdirSync(OUT, { recursive: true });
const f = (dir, name) => pathToFileURL(path.join(dir, name)).href;
const json = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const FONTS = pathToFileURL(path.join(repo, 'client', 'public', 'fonts')).href;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

const CSS = `
@font-face { font-family: Inter; font-weight: 400; src: url('${FONTS}/Inter-400.ttf'); }
@font-face { font-family: Inter; font-weight: 500; src: url('${FONTS}/Inter-500.ttf'); }
@font-face { font-family: Inter; font-weight: 600; src: url('${FONTS}/Inter-600.ttf'); }
@font-face { font-family: Inter; font-weight: 700; src: url('${FONTS}/Inter-700.ttf'); }
:root { --bg: #06090e; --line: rgba(255,255,255,0.09); --text: #eef3f8; --muted: #93a3b4; --soft: #c5d0db;
        --accent: #f7c325; --cyan: #5cc8f5; --mono: ui-monospace, 'Cascadia Mono', Consolas, monospace; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: var(--bg); color: var(--text); font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased;
       overflow: hidden; position: relative; }
.bgglow { position: absolute; inset: 0; background:
  radial-gradient(1500px 800px at 12% -18%, rgba(40,78,120,0.42), rgba(0,0,0,0) 62%),
  radial-gradient(1300px 900px at 105% 118%, rgba(247,195,37,0.10), rgba(0,0,0,0) 58%), var(--bg); }
.grain { position: absolute; inset: 0; opacity: 0.35; background-image: radial-gradient(rgba(255,255,255,0.025) 1px, transparent 1px);
         background-size: 3px 3px; }
.head { position: absolute; left: 96px; right: 96px; top: 78px; }
h1 { font-size: 60px; line-height: 1.06; font-weight: 700; letter-spacing: -0.025em; }
.sub { font-size: 23px; line-height: 1.5; color: var(--muted); margin-top: 18px; max-width: 1560px; }
.panel { position: relative; border-radius: 18px; overflow: hidden; border: 1px solid var(--line); background: #0a0f15;
         box-shadow: 0 34px 70px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.35); }
.panel > img, .panel > svg { display: block; width: 100%; height: 100%; object-fit: cover; }
.label { position: absolute; top: 16px; left: 16px; font-size: 18px; font-weight: 600; background: rgba(6,9,14,0.76);
         border: 1px solid rgba(255,255,255,0.14); padding: 8px 14px; border-radius: 10px; backdrop-filter: blur(8px); color: #fff; }
.legend { display: flex; flex-wrap: wrap; gap: 8px 18px; font-size: 16px; color: var(--soft); }
.legend span { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
.legend i { width: 13px; height: 13px; border-radius: 3px; display: inline-block; }
.note { font-size: 17px; line-height: 1.6; color: #75879a; }
.mono { font-family: var(--mono); }
`;
const doc = (w, h, body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}${css}</style></head>
<body style="width:${w}px;height:${h}px"><div class="bgglow"></div><div class="grain"></div>${body}</body></html>`;
const head = (title, sub) => `<div class="head"><h1>${title}</h1><div class="sub">${sub}</div></div>`;

// a render cropped by viewBox, with optional overlay markup in the render's pixel frame
const IMG_W = 2880, IMG_H = 1620;
const crop = (href, [x, y, w, h], overlay = '', imgAttrs = '') =>
  `<svg viewBox="${x} ${y} ${w} ${h}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">` +
  `<image href="${href}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" ${imgAttrs}/>${overlay}</svg>`;

const THING = new Set(['car', 'truck', 'bus', 'pedestrian', 'bicycle']);
function boxes(labels, classes, [cx, cy, cw, ch], { minArea = 700, labelMinH = 70, stroke = 3.2, font = 26 } = {}) {
  const col = Object.fromEntries(classes.map((c) => [c.name, `rgb(${c.rgb.join(',')})`]));
  const light = { car: '#7fb2ff', truck: '#9fb6ff', bus: '#8fd3ff', pedestrian: '#ff6f8c', bicycle: '#ffa36f' };
  let rects = '', tags = '';
  const placed = [];
  const hit = (a) => placed.some((b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3]);
  const objs = labels.objects.filter((o) => THING.has(o.class_name) && o.bbox[2] * o.bbox[3] >= minArea)
    .filter((o) => o.bbox[0] + o.bbox[2] > cx && o.bbox[0] < cx + cw && o.bbox[1] + o.bbox[3] > cy && o.bbox[1] < cy + ch)
    .sort((a, b) => b.bbox[2] * b.bbox[3] - a.bbox[2] * a.bbox[3]);
  for (const o of objs) {
    const c = light[o.class_name] || col[o.class_name] || '#fff';
    const [x, y, w, h] = o.bbox;
    if (o.amodal_bbox && (o.occlusion ?? 0) > 0.06) {
      const [ax, ay, aw, ah] = o.amodal_bbox;
      rects += `<rect x="${ax}" y="${ay}" width="${aw}" height="${ah}" fill="none" stroke="${c}" stroke-width="${stroke * 0.8}" stroke-dasharray="${stroke * 3} ${stroke * 2.2}" opacity="0.9"/>`;
    }
    rects += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${c}" stroke-width="${stroke}"/>`;
    if (h >= labelMinH) {
      const text = o.class_name, tw = text.length * font * 0.55 + 20;
      const r = [x - 2, y - font - 14, tw, font + 12];
      if (hit(r)) continue;
      placed.push(r);
      tags += `<rect x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="6" fill="${c}"/>` +
              `<text x="${x + 8}" y="${y - 12}" font-family="Inter" font-weight="600" font-size="${font}" fill="#081018">${esc(text)}</text>`;
    }
  }
  return { svg: rects + tags, n: objs.length };
}

// ---------------------------------------------------------------- figures
const FIGS = {};

const HERO = {   // base render, crop [x0, y0, w] (height follows 2.4:1), band edges as [x at top, x at bottom], caption
  lenox: { shot: 'lenox_oblique', crop: [0, 250, 2880], e1: [2330, 1990], e2: [2640, 2300],
    caption: 'W 125th St and Lenox Ave in Harlem: one simulator frame and its ground truth' },
  street: { shot: 'sensors', crop: [700, 470, 2180], e1: [2040, 1800], e2: [2480, 2240],
    caption: 'W 120th St and Amsterdam Ave: one simulator frame and its ground truth' },
};
FIGS.hero = () => {
  const P = HERO[opt('hero', 'lenox')];
  const W = 2400, H = 1000, [X0, Y0, CW] = P.crop, CH = CW / 2.4, Y1 = Y0 + CH, V = [X0, Y0, CW, CH], S = W / CW;
  const band = (href, pts, id) => `<clipPath id="${id}"><polygon points="${pts}"/></clipPath><image href="${href}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" clip-path="url(#${id})"/>`;
  const e1 = [[P.e1[0], Y0], [P.e1[1], Y1]], e2 = [[P.e2[0], Y0], [P.e2[1], Y1]];
  const edge = ([[ax, ay], [bx, by]]) => `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-width="${5 / S}" opacity="0.95"/>` +
    `<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-width="${22 / S}" opacity="0.10"/>`;
  const R = X0 + CW;
  const svg = `<svg viewBox="${V.join(' ')}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:100%;height:100%">
    <image href="${f(RAW, P.shot + '_rgb.png')}" x="0" y="0" width="${IMG_W}" height="${IMG_H}"/>
    ${band(f(RAW, P.shot + '_semantic.png'), `${e1[0].join(',')} ${R},${Y0} ${R},${Y1} ${e1[1].join(',')}`, 'b1')}
    ${band(f(RAW, P.shot + '_depth_vis.png'), `${e2[0].join(',')} ${R},${Y0} ${R},${Y1} ${e2[1].join(',')}`, 'b2')}
    ${edge(e1)}${edge(e2)}</svg>`;
  const bx = (x) => (x - X0) * S;
  const lab = (x, t) => `<div class="blab" style="left:${Math.round(x)}px">${t}</div>`;
  return doc(W, H, `${svg}
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,7,11,0.94) 0%,rgba(4,7,11,0.80) 30%,rgba(4,7,11,0.30) 50%,rgba(4,7,11,0) 60%)"></div>
    <div style="position:absolute;inset:0;background:linear-gradient(0deg,rgba(4,7,11,0.60) 0%,rgba(4,7,11,0) 24%)"></div>
    <div style="position:absolute;left:112px;top:205px;width:1060px">
      <div style="font-size:136px;font-weight:700;letter-spacing:-0.035em;line-height:1">Valdrada</div>
      <div style="font-size:34px;line-height:1.42;color:#d9e2ea;margin-top:34px;max-width:990px">A real-time digital twin of New York City, compiled from public records, with simulated traffic, pixel-exact ground truth and a Python API.</div>
    </div>
    ${lab(bx(e1[1][0]) - 118, 'RGB')}${lab(bx((e1[1][0] + e2[1][0]) / 2) - 70, 'Semantic')}${lab(bx((e2[1][0] + R) / 2) - 50, 'Depth')}
    <div style="position:absolute;left:112px;bottom:46px;font-size:19px;color:#8d9cab">${P.caption}</div>`,
  `.blab{position:absolute;bottom:40px;font-size:18px;font-weight:600;color:#fff;background:rgba(6,9,14,0.7);
    border:1px solid rgba(255,255,255,0.2);padding:9px 16px;border-radius:10px}`);
};

FIGS.pipeline = () => {
  const W = 2400, H = 1040, L = json(MAPS, 'legend.json');
  const USE = { 2: 'Walk-up', 3: 'Elevator building', 4: 'Mixed use', 5: 'Commercial', 8: 'Institutional' };
  const NM = { TENEMENT: 'Tenement', PREWAR_APT: 'Pre-war apartment', POSTWAR_BRICK: 'Post-war brick', MODERN_GLASS: 'Modern glass', RETAIL_STRIP: 'Retail strip',
    CIVIC_STONE: 'Civic stone', ROWHOUSE: 'Rowhouse', DECO_MASONRY: 'Deco masonry', RETAIL_MODERN: 'Modern retail', PROJECT_BRICK: 'Public housing',
    INDUSTRIAL: 'Industrial', CHURCH: 'Church', LOFT_CASTIRON: 'Cast-iron loft', GLASS_TOWER_BLUE: 'Glass tower', FRAME_HOUSE: 'Frame house', CONDO_NEW: 'New condominium' };
  const inst = json(RAW, 'lenox_oblique_instance.json'), classes = json(RAW, 'classes.json');
  const bx = boxes(inst, classes, [0, 0, IMG_W, IMG_H], { minArea: 140, labelMinH: 9999, stroke: 3.4 });
  const lu = (L.records?.landuse || []).filter((x) => USE[x.use]);
  const ty = (L.compiled?.typology || []).slice(0, 5);
  const leg = (items) => `<div class="leg">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>`;
  const card = (img, title, text, legend = '') => `<div class="card">
      <div class="panel" style="height:388px">${img}${legend}</div>
      <div style="font-size:30px;font-weight:700;letter-spacing:-0.01em;margin-top:30px">${title}</div>
      <div style="font-size:20px;line-height:1.55;color:var(--muted);margin-top:14px">${text}</div></div>`;
  const arrow = `<div class="arrow"><svg width="44" height="44" viewBox="0 0 44 44"><path d="M12 6 L30 22 L12 38" fill="none" stroke="#f7c325" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>`;
  const c1 = card(`<img src="${f(MAPS, 'records.svg')}">`, 'Public records',
    'Building footprints joined to tax lots, street centrelines, street trees, hydrants and subway entrances.',
    leg(lu.map((x) => [x.color, USE[x.use]])));
  const c2 = card(`<img src="${f(MAPS, 'compiled.svg')}">`, 'Compiled city',
    'Footprints become buildings, each with a facade typology. Centrelines become carriageways, kerbs, crosswalks, lane paint and the lane graph, packed into binary tiles.',
    leg(ty.map((x) => [x.color, NM[x.style] || x.style])));
  const c3 = card(crop(f(RAW, 'lenox_oblique_rgb.png'), [0, 0, IMG_W, IMG_H]), 'Real-time rendering',
    'The WebGL2 client streams the tiles, dresses every facade and moves vehicles and pedestrians on the lane and sidewalk graphs.');
  const c4 = card(crop(f(RAW, 'lenox_oblique_semantic.png'), [0, 0, IMG_W, IMG_H], bx.svg), 'Ground truth',
    'Semantic and instance masks, metric depth and object boxes, rendered with each frame.');
  return doc(W, H, `${head('From public records to ground truth',
      'One block of Harlem, at W 125th St and Lenox Ave, at each stage of the pipeline.')}
    <div style="position:absolute;left:96px;right:96px;top:330px;display:flex;align-items:flex-start;justify-content:space-between">${c1}${arrow}${c2}${arrow}${c3}${arrow}${c4}</div>`,
  `.card{width:505px}.arrow{height:388px;display:grid;place-items:center;width:44px;opacity:0.95}
   .leg{position:absolute;left:12px;right:12px;bottom:12px;display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;font-weight:500;color:#e8eef4;
        background:rgba(6,9,14,0.74);border:1px solid rgba(255,255,255,0.12);border-radius:10px;padding:9px 12px}
   .leg span{display:inline-flex;gap:6px;align-items:center}.leg i{width:11px;height:11px;border-radius:2px;display:inline-block}`);
};

FIGS.sensors = () => {
  const W = 2400, H = 1760, C = [720, 405, 2160, 1215];
  const inst = json(RAW, 'sensors_instance.json'), classes = json(RAW, 'classes.json');
  const bx = boxes(inst, classes, C, { minArea: 900, labelMinH: 80, stroke: 4, font: 27 });
  const cls = Object.fromEntries(classes.map((c) => [c.name, c.rgb]));
  const legend = ['road', 'sidewalk', 'crosswalk', 'road_marking', 'lane_marking_yellow', 'building', 'vegetation', 'car', 'truck', 'pedestrian', 'bicycle',
    'traffic_signal', 'street_light', 'bus_shelter', 'scaffold', 'street_furniture', 'sky'].filter((n) => cls[n]);
  const turbo = 'linear-gradient(90deg,#7a0403,#c42503,#f26d11,#fdb838,#d0f735,#79fe59,#1ae4b6,#26bce1,#4686fb,#4454c4,#30123b)';
  const panel = (label, inner, extra = '') => `<div class="panel" style="height:614px">${inner}<div class="label">${label}</div>${extra}</div>`;
  const cbar = `<div style="position:absolute;right:18px;bottom:18px;width:420px;background:rgba(6,9,14,0.76);border:1px solid rgba(255,255,255,0.14);border-radius:10px;padding:12px 16px 10px">
      <div style="height:12px;border-radius:3px;background:${turbo}"></div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:14px;color:#dfe7ef"><span>near</span><span>far</span></div></div>`;
  return doc(W, H, `${head('Ground truth from the scene state',
      'One synchronous step at W 120th St and Amsterdam Ave. The labels are rendered from the same scene state as the image, so they need no annotation.')}
    <div style="position:absolute;left:96px;right:96px;top:330px;display:grid;grid-template-columns:1fr 1fr;gap:24px">
      ${panel('RGB', crop(f(RAW, 'sensors_rgb.png'), C))}
      ${panel('Semantic segmentation', crop(f(RAW, 'sensors_semantic.png'), C))}
      ${panel('Instance segmentation and boxes', crop(f(RAW, 'sensors_rgb.png'), C,
        `<image href="${f(RAW, 'sensors_instance.png')}" x="0" y="0" width="${IMG_W}" height="${IMG_H}" style="mix-blend-mode:screen" opacity="0.78"/>${bx.svg}`, 'style="filter:brightness(0.42) saturate(0.6)"'))}
      ${panel('Depth', crop(f(RAW, 'sensors_depth_vis.png'), C), cbar)}
    </div>
    <div style="position:absolute;left:96px;right:96px;bottom:50px">
      <div class="legend">${legend.map((n) => `<span><i style="background:rgb(${cls[n].join(',')})"></i>${n.replace(/_/g, ' ')}</span>`).join('')}</div>
      <div class="note" style="margin-top:16px">Solid boxes mark the visible extent of each object; dashed boxes mark the amodal extent, including the occluded part.</div></div>`);
};

FIGS.gallery = () => {
  const W = 2400, H = 1250;
  const col = fs.existsSync(path.join(RAW, 'g_columbia_rgb.png'));
  const tiles = [
    ['g_fifth_rgb.png', '5th Avenue at 42nd Street, golden hour'],
    ['g_lenox_rgb.png', '125th Street and Lenox Avenue, Harlem'],
    ['g_timessq_rgb.png', 'Times Square at night'],
    ['g_brownstones_rgb.png', 'Brownstones on W 121st Street, Harlem'],
    ['g_el_rgb.png', 'Rain under the elevated line in Williamsburg'],
    col ? ['g_columbia_rgb.png', 'Low Library from College Walk, Columbia'] : ['hero_crowns_rgb.png', 'Midtown tower crowns from 210 m'],
  ];
  return doc(W, H, `${head('One compiled city, every street',
      'Single frames from the simulator. Time of day, weather, traffic and pedestrians are simulated; buildings, streets, trees and street furniture come from the records.')}
    <div style="position:absolute;left:96px;right:96px;top:330px;display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
      ${tiles.map(([img, cap]) => `<div class="panel" style="height:406px"><img src="${f(RAW, img)}">
        <div style="position:absolute;inset:auto 0 0 0;height:130px;background:linear-gradient(0deg,rgba(4,7,11,0.88),rgba(4,7,11,0))"></div>
        <div style="position:absolute;left:24px;bottom:20px;font-size:23px;font-weight:600">${esc(cap)}</div></div>`).join('')}
    </div>`);
};

FIGS.coverage = () => {
  const W = 2400, H = 1560, M = json(MAPS, 'citymap.json');
  const mapH = 1440, mapW = Math.round((M.width / M.height) * mapH);
  const cam = [2167, -2740];
  const inR = (k, r) => { const [i, j] = k.split('_').map(Number); const x = (i + 0.5) * M.tile, z = (j + 0.5) * M.tile; return Math.hypot(x - cam[0], z - cam[1]) <= r + M.tile * 0.5; };
  let grid = '';
  for (const k of M.tileKeys) { const [i, j] = k.split('_').map(Number);
    grid += `<rect x="${i * M.tile}" y="${j * M.tile}" width="${M.tile}" height="${M.tile}" fill="none" stroke="${inR(k, 1000) ? '#f7c325' : 'rgba(255,255,255,0.10)'}" stroke-width="${inR(k, 1000) ? 26 : 9}"/>`; }
  const mh = project(-73.9905, 40.7468);
  const labels = [['MANHATTAN', mh[0], mh[1], -61], ['THE BRONX', 6200, -9600, 0], ['QUEENS', 13000, 3200, 0], ['BROOKLYN', 3900, 12600, 0], ['STATEN ISLAND', -15071, 22015, 0]];
  const lbl = labels.map(([t, x, z, r]) => `<text x="${x}" y="${z}" transform="rotate(${r} ${x} ${z})" font-family="Inter" font-weight="700" font-size="620" letter-spacing="160" fill="#ffffff" fill-opacity="0.94" text-anchor="middle" paint-order="stroke" stroke="#05080c" stroke-opacity="0.6" stroke-width="150" stroke-linejoin="round">${t}</text>`).join('');
  const overlay = `<svg viewBox="${M.x0} ${M.z0} ${M.x1 - M.x0} ${M.z1 - M.z0}" style="position:absolute;inset:0;width:100%;height:100%" xmlns="http://www.w3.org/2000/svg">${grid}
    <circle cx="${cam[0]}" cy="${cam[1]}" r="13000" fill="rgba(92,200,245,0.05)" stroke="#5cc8f5" stroke-width="40" stroke-dasharray="260 180"/>
    <circle cx="${cam[0]}" cy="${cam[1]}" r="1000" fill="none" stroke="#f7c325" stroke-width="44"/>
    <circle cx="${cam[0]}" cy="${cam[1]}" r="150" fill="#f7c325"/>${lbl}</svg>`;
  const HM = json(MAPS, 'citymap_harlem.json'), IV = [cam[0] - 2100, cam[1] - 1640, 4200, 3280];
  let igrid = '';
  for (const k of M.tileKeys) { const [i, j] = k.split('_').map(Number);
    if ((i + 1) * M.tile < IV[0] || i * M.tile > IV[0] + IV[2] || (j + 1) * M.tile < IV[1] || j * M.tile > IV[1] + IV[3]) continue;
    const on = inR(k, 1000);
    igrid += `<rect x="${i * M.tile}" y="${j * M.tile}" width="${M.tile}" height="${M.tile}" fill="${on ? 'rgba(247,195,37,0.10)' : 'none'}" stroke="${on ? '#f7c325' : 'rgba(255,255,255,0.22)'}" stroke-width="${on ? 9 : 4}"/>`; }
  const cone = (() => { const th = Math.atan2(2167 - 2094, 2740 - 2609), d = 520, a = 0.5;
    const p = (s) => [cam[0] + Math.sin(th + s) * d, cam[1] - Math.cos(th + s) * d];
    return `${cam[0]},${cam[1]} ${p(-a).join(',')} ${p(a).join(',')}`; })();
  // (0.4.0: the five boroughs' map is square, so the text column is narrower: the inset keeps its view's aspect instead of
  // a fixed 830 px, which cropped the view's sides and the scale bar)
  const colW = W - (84 + mapW + 100) - 96, insetH = Math.min(830, Math.round(colW * IV[3] / IV[2]));
  const inset = `<div class="panel" style="height:${insetH}px;margin-top:40px">
      <svg viewBox="${IV.join(' ')}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
        <image href="${f(MAPS, 'citymap_harlem.png')}" x="${HM.x0}" y="${HM.z0}" width="${HM.x1 - HM.x0}" height="${HM.z1 - HM.z0}" preserveAspectRatio="none"/>
        ${igrid}<circle cx="${cam[0]}" cy="${cam[1]}" r="1000" fill="none" stroke="#f7c325" stroke-width="12" stroke-dasharray="40 26"/>
        <polygon points="${cone}" fill="rgba(247,195,37,0.28)"/><circle cx="${cam[0]}" cy="${cam[1]}" r="46" fill="#f7c325" stroke="#05080c" stroke-width="10"/>
        <g transform="translate(${IV[0] + 150} ${IV[1] + IV[3] - 150})"><rect x="-40" y="-120" width="1080" height="170" rx="24" fill="rgba(6,9,14,0.72)"/>
          <line x1="0" y1="0" x2="1000" y2="0" stroke="#fff" stroke-width="12"/><line x1="0" y1="-26" x2="0" y2="26" stroke="#fff" stroke-width="10"/><line x1="1000" y1="-26" x2="1000" y2="26" stroke="#fff" stroke-width="10"/>
          <text x="500" y="-44" fill="#fff" font-family="Inter" font-weight="600" font-size="74" text-anchor="middle">1 km</text></g></svg>
      <div class="label">Tiles at full detail around W 125th St and Lenox Ave</div></div>`;
  const ramp = `linear-gradient(90deg,${M.ramp.map(([t, c]) => `rgb(${c.join(',')}) ${Math.round(t * 100)}%`).join(',')})`;
  const hx = (h) => (Math.log1p(h) / Math.log1p(M.hmax)) * 100;
  return doc(W, H, `<div class="panel" style="position:absolute;left:84px;top:60px;width:${mapW}px;height:${mapH}px;background:#090d13">
      <img src="${f(MAPS, 'citymap.png')}" style="position:absolute;inset:0;width:100%;height:100%">${overlay}</div>
    <div style="position:absolute;left:${84 + mapW + 100}px;right:96px;top:84px">
      <h1>The five boroughs, streamed</h1>
      <div class="sub" style="max-width:none;font-size:22px">The buildings of the five boroughs, shaded by height on their street network. The client streams full-detail tiles around the camera (yellow) and coarser far-field tiles beyond them (blue).</div>
      <div style="display:flex;gap:44px;align-items:flex-end;margin-top:40px">
        <div style="flex:1">
          <div style="font-size:17px;font-weight:600;color:var(--soft)">Building height</div>
          <div style="height:14px;border-radius:4px;margin-top:14px;background:${ramp}"></div>
          <div style="position:relative;height:24px;margin-top:8px;font-size:15px;color:var(--muted);white-space:nowrap">${[5, 50, 400].map((h, k, a) => `<span style="position:absolute;left:${hx(h)}%;transform:translateX(${k === a.length - 1 ? '-100%' : '-50%'})">${h} m</span>`).join('')}</div></div>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:16px;color:var(--soft);padding-bottom:26px">
          <span style="display:inline-flex;gap:10px;align-items:center"><i style="width:20px;height:20px;border:4px solid #f7c325;border-radius:50%;display:inline-block"></i>Full detail</span>
          <span style="display:inline-flex;gap:10px;align-items:center"><i style="width:20px;height:20px;border:3px dashed #5cc8f5;border-radius:50%;display:inline-block"></i>Far field</span></div></div>
      ${inset}
      <div class="note" style="margin-top:22px;font-size:15.5px">Building footprints from NYC Open Data and OpenStreetMap. North is up.</div>
    </div>`);
};

FIGS.social = () => {
  const W = 1280, H = 640;
  return doc(W, H, `<img src="${f(RAW, 'g_fifth_rgb.png')}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 64%">
    <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(4,7,11,0.94) 0%,rgba(4,7,11,0.72) 40%,rgba(4,7,11,0.05) 72%)"></div>
    <div style="position:absolute;left:68px;top:150px;width:720px">
      <img src="${pathToFileURL(path.join(repo, 'docs', 'assets', 'figures', 'logo.svg')).href}" style="width:92px;height:92px;display:block;margin:0 0 18px -4px">
      <div style="font-size:82px;font-weight:700;letter-spacing:-0.035em">Valdrada</div>
      <div style="font-size:30px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;color:#f7c325;margin-top:10px">A digital twin simulator of New York City</div>
      <div style="font-size:22px;line-height:1.45;color:#d9e2ea;margin-top:16px">An explicit world model compiled from public records, with simulated traffic and pedestrians, ground truth and a Python API.</div></div>`);
};

// ---------------------------------------------------------------- render
const OUTS = { hero: 'hero.jpg', pipeline: 'pipeline.jpg', sensors: 'sensors.jpg', gallery: 'gallery.jpg', coverage: 'coverage.jpg', social: 'social.jpg' };
const browser = await chromium.launch();
for (const [name, build] of Object.entries(FIGS)) {
  if (ONLY && !ONLY.includes(name)) continue;
  const html = build();
  const [, W, H] = html.match(/<body style="width:(\d+)px;height:(\d+)px"/).map(Number);
  const tmp = path.join(here, `.${name}.html`);
  fs.writeFileSync(tmp, html);
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(tmp).href, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const out = path.join(OUT, OUTS[name]);
  const jpeg = out.endsWith('.jpg');
  await page.screenshot({ path: out, type: jpeg ? 'jpeg' : 'png', quality: jpeg ? 88 : undefined });
  await page.close();
  fs.rmSync(tmp);
  console.log(`${OUTS[name]}  ${W}x${H}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}
await browser.close();
