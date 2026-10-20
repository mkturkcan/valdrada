// Tower kit (TW, towers lane, docs/notes/r2-towers.md): the facade parameters of one tower, a pure function of its
// compiled record and its tower record (client/public/data/towers/records.json: MapPLUTO's year built, building class,
// land use and floors joined to the footprint by client/tools/towers/tower_records.py).
//
// The near level (city/tk/tkBuild.js) and the far level (the tile facade shader, world/materials.js) read the same
// numbers, so a level change moves no window: the bay grid is the shader's (per wall: bayN = floor((L - 0.44) / winW),
// the margins (L - bayN * winW) / 2 at both ends, floors of floorH from the building's base), the colours are the
// record's, the curtain-wall glass family is the shader's hash of the building seed, and the lit rooms at night are the
// shader's hash of (bay, floor, wall seed, building seed).
import { STYLE, BF } from '../../shared/geo.js';

// FP18: ?fp18=0 draws the masonry towers without their stone base, courses and cornice, the slabs without balconies (A/B)
const FP18 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fp18') === '0');

// the hide slot of a tower's kit-replaced walls in its tile's facade mask: TW_BID + the building's index (assemble.js)
export const TW_BID = 4096;

// ---------------------------------------------------------------- the GLSL hashes, in JS
// hash12 of world/materials.js (HASH_GLSL), each step rounded to float32 as the GPU does it
const f = Math.fround;
const fr = (x) => f(x - Math.floor(x));
export function hash12(px, py) {
  const k = f(0.1031), c = f(33.33);
  let x = fr(f(f(px) * k)), y = fr(f(f(py) * k)), z = fr(f(f(px) * k));
  const d = f(f(f(x * f(y + c)) + f(y * f(z + c))) + f(z * f(x + c)));
  x = f(x + d); y = f(y + d); z = f(z + d);
  return fr(f(f(x + y) * z));
}
// a seeded generator for the kit's own choices (not shared with the shader)
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- the tower records layer
let REC = null, REC_P = null;
export function loadTowerRecords(url = 'data/towers/records.json') {
  if (REC_P) return REC_P;
  REC_P = fetch(url).then((r) => (r.ok ? r.json() : null)).then((j) => {
    REC = new Map();
    if (!j || !j.tiles) return REC;
    const cls = j.classes || [];
    for (const [tk, rows] of Object.entries(j.tiles)) {
      const m = new Map();
      for (const r of rows) m.set(r[0], { cx: r[1], cz: r[2], h: r[3], year: r[4], cls: cls[r[5]] || '', landuse: r[6], floors: r[7], flags: r[8] });
      REC.set(tk, m);
    }
    return REC;
  }).catch(() => (REC = new Map()));
  return REC_P;
}
export const towerRecordsReady = () => REC !== null;
// the record of building `bid` of tile `tk`, if its centroid is the one the layer was made from (a recompile that
// renumbered the tile drops the row instead of mismatching it)
export function towerRecord(tk, bid, cx, cz) {
  const m = REC && REC.get(tk);
  const r = m && m.get(bid);
  if (!r) return null;
  return Math.hypot(r.cx - cx, r.cz - cz) < 1.5 ? r : null;
}

// ---------------------------------------------------------------- archetypes
export const ARCH = {
  MASONRY: 'masonry',     // pre-war office, hotel or apartment: punched windows with reveals, a stone base, a cornice
  DECO: 'deco',           // 1925-45 setback tower: continuous brick piers, recessed spandrels, punched pairs
  SLAB: 'slab',           // post-war brick apartment slab: wide punched or ribbon windows, white / tan brick
  PM: 'pm',               // 1980-2005 stone or brick tower: large punched windows in granite or brick
  CW_GRID: 'cwGrid',      // 1955-85 curtain wall: a mullion grid, spandrel bands at the floor lines
  CW_RIBBON: 'cwRibbon',  // 1955-80 office: ribbon windows between proud spandrel bands
  CW_PIER: 'cwPier',      // 1960-75 office: stone or metal piers every bay, recessed glass and spandrels
  CW_SUPER: 'cwSuper',    // after 2000: floor-to-ceiling glass, fine mullions or fins, slab edges
};
const GLASSY = (s) => s === STYLE.MODERN_GLASS || s === STYLE.GLASS_TOWER_BLUE;
const lin = (c) => Math.pow(c / 255, 2.2);
const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const hex = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// the year a style stands for when the layer has none (towers.js: the classifier derives style from the year for offices)
function yearOfStyle(s) {
  return s === STYLE.CIVIC_STONE ? 1912 : s === STYLE.DECO_MASONRY ? 1930 : s === STYLE.PREWAR_APT ? 1922 : s === STYLE.TENEMENT ? 1905
    : s === STYLE.POSTWAR_BRICK ? 1965 : s === STYLE.MODERN_GLASS ? 1968 : s === STYLE.GLASS_TOWER_BLUE ? 2006 : s === STYLE.PROJECT_BRICK ? 1960 : 1950;
}

// the masonry set for a record colour: brick families by value and hue, stone for pale warm greys
function wallSetOf(rgb, arch, r) {
  const L = lum(rgb), [R, G, B] = rgb;
  const warm = R - B, sat = Math.max(R, G, B) - Math.min(R, G, B);
  if (arch === ARCH.PM && L > 0.16 && sat < 46) return r() < 0.6 ? 'granite_grey' : 'stone_lime_ashlar';
  if (L > 0.42 && sat < 30) return arch === ARCH.SLAB ? 'brick_white_glazed' : 'stone_lime_ashlar';
  if (L > 0.30 && sat < 52) return arch === ARCH.SLAB || arch === ARCH.DECO ? 'brick_buff' : 'stone_lime_ashlar';
  if (L > 0.22) return warm > 40 ? 'brick_tan' : 'brick_buff';
  if (warm > 60 && R > 110) return 'brick_red';
  if (L < 0.06) return 'brick_brown';
  return warm > 30 ? 'brick_red' : 'brick_brown';
}
// the frame / mullion finish for a colour (a small palette of shared materials: an instanced part has no tint of its own)
export const FINISH = ['alu_black', 'alu_bronze', 'alu_clear', 'alu_white', 'stainless', 'panel_grey'];
function finishOf(rgb, r) {
  const L = lum(rgb), warm = rgb[0] - rgb[2];
  if (L < 0.05) return warm > 10 ? 'alu_bronze' : 'alu_black';
  if (L > 0.45) return r() < 0.5 ? 'alu_white' : 'alu_clear';
  if (warm > 25) return 'alu_bronze';
  return r() < 0.55 ? 'alu_clear' : 'panel_grey';
}

// the landmarks' own glass (city/tk/tkLandmarks.js, tkOverrides.js): the facade shader's family fields, a PBR name for Unreal
export const LM_GLASS = {
  COBALT: { key: 'one57cobalt', alb: [0.018, 0.034, 0.080], f0: 0.13, rough: 0.04, tint: [0.80, 0.92, 1.10], pbr: 'glass_tower_blue' },
  SKYBLUE: { key: 'one57sky', alb: [0.050, 0.075, 0.105], f0: 0.15, rough: 0.04, tint: [0.88, 0.97, 1.06], pbr: 'glass_tower_blue' },
  SILVERW: { key: 'cptSilver', alb: [0.070, 0.078, 0.085], f0: 0.14, rough: 0.035, tint: [0.98, 1.0, 1.02], pbr: 'glass_tower_grey' },
  CLEARG: { key: 'twcClear', alb: [0.045, 0.058, 0.066], f0: 0.12, rough: 0.035, tint: [0.92, 0.98, 1.02], pbr: 'glass_tower_grey' },
  BLACKG: { key: 'gmBlack', alb: [0.014, 0.014, 0.016], f0: 0.10, rough: 0.04, tint: [0.96, 0.98, 1.0], pbr: 'glass_tower_grey' },
  GOLDG: { key: 'cpwGold', alb: [0.070, 0.052, 0.026], f0: 0.30, rough: 0.05, tint: [1.12, 0.96, 0.70], pbr: 'glass_tower_bronze' },
  BRONZEK: { key: 'bronzeDark', alb: [0.030, 0.022, 0.016], f0: 0.22, rough: 0.05, tint: [1.06, 0.94, 0.80], pbr: 'glass_tower_bronze' },
};

// the curtain-wall glass family of the facade shader (materials.js REFLECTIVITY FAMILIES): the same hash of the seed
export const GLASS_FAMS = [
  { key: 'bronze', alb: [0.036, 0.028, 0.021], f0: 0.26, rough: 0.055, tint: [1.06, 0.95, 0.80] },
  { key: 'blue', alb: [0.030, 0.052, 0.055], f0: 0.15, rough: 0.045, tint: [0.82, 0.98, 1.02] },
  { key: 'silver', alb: [0.052, 0.056, 0.062], f0: 0.10, rough: 0.038, tint: [0.97, 0.99, 1.02] },
  { key: 'gold', alb: [0.062, 0.050, 0.030], f0: 0.30, rough: 0.060, tint: [1.10, 0.98, 0.74] },
];
export function glassFamOf(cvar) {
  const famR = hash12(Math.floor(cvar * 233), 31.7);
  return famR < 0.30 ? 0 : famR < 0.62 ? 1 : famR < 0.84 ? 2 : 3;
}

// the tower's facade parameters. b: the tile record (assemble.js heroRecs fields), lr: its tower record or null
export function towerParams(b, lr) {
  const style = b.style;
  const year = (lr && lr.year > 1800) ? lr.year : yearOfStyle(style);
  const cls = (lr && lr.cls) || '';
  const c0 = cls.charAt(0);
  const office = c0 === 'O' || cls === 'RB' || cls === 'RC' || c0 === 'K' || cls === 'RK';
  const hotel = c0 === 'H';
  const resi = c0 === 'D' || c0 === 'C' || c0 === 'R' && !office || c0 === 'S';
  // the building seed exactly as the shader snaps it (cvar) and its integer (WL11)
  const cvI = Math.floor(b.colorVar * 1024 + 0.5), cvar = cvI / 1024;
  const r = rng(cvI * 7919 + Math.round(b.height * 10) + 13);
  const H = b.height;
  // the family follows the style the shader draws (glass or masonry), the archetype within it the records
  let arch;
  if (GLASSY(style)) {
    if (year >= 2000) arch = ARCH.CW_SUPER;
    else if (year < 1958) arch = ARCH.CW_RIBBON;
    else if (year < 1985) arch = r() < 0.3 ? ARCH.CW_PIER : r() < 0.35 ? ARCH.CW_RIBBON : ARCH.CW_GRID;
    else arch = ARCH.CW_GRID;
  } else if (style === STYLE.POSTWAR_BRICK || style === STYLE.PROJECT_BRICK) {
    arch = year >= 1985 ? ARCH.PM : ARCH.SLAB;
  } else if (year >= 1980) arch = ARCH.PM;
  else if (year >= 1946) arch = ARCH.SLAB;
  else if (style === STYLE.DECO_MASONRY || (year >= 1925 && H > 60)) arch = ARCH.DECO;
  else arch = ARCH.MASONRY;
  const glass = arch.startsWith('cw');
  const rgb = b.color || [b.r, b.g, b.b];
  // floors: the record's floor height (the shader's grid); PLUTO's count is kept for the notes and the census
  const floorH = Math.max(2.5, b.floorH || 3.4);
  const winW = Math.max(0.8, b.winW || 1.8);
  const storeH = (b.flags & BF.STOREFRONT) ? Math.max(0, b.storeH || 0) : 0;
  // the shader's window cell: x0..x1, y0..y1 of a bay and a floor (glass styles: the whole cell)
  const cell = glass ? { x0: 0.05, x1: 0.95, y0: 0.08, y1: 0.96 } : { x0: 0.2, x1: 0.8, y0: 0.3, y1: 0.88 };
  const P = {
    arch, glass, year, cls, office, hotel, resi: !office && !hotel && (resi || style < 2.5 || style === STYLE.PROJECT_BRICK),
    style, rgb, hex: hex(rgb), floorH, winW, storeH, cvar, cvI, height: H, lit: b.lit ?? 0.5, cell,
    // the shader's residential flag for the lit share (materials.js `resi`)
    shResi: style < 2.5 || (style > 4.5 && style < 5.5) || style > 11.5,
    landmark: !!(lr && (lr.flags & 2)), historic: !!(lr && (lr.flags & 1)), plutoFloors: lr ? lr.floors : 0,
    seed: cvI * 131 + Math.round(H * 7),
  };
  if (glass) {
    P.fam = glassFamOf(cvar);
    P.finish = finishOf(rgb, r);
    // spandrel colour: the shader's record colour x 0.55 (style 3) or x 0.62 (style 11); a curtain wall's mullions x 0.45
    const k = style === STYLE.GLASS_TOWER_BLUE ? 0.62 : 0.55;
    P.spandrelHex = hex(rgb.map((v) => v * Math.sqrt(k)));
    P.spandrelH = arch === ARCH.CW_SUPER ? 0.32 + r() * 0.25 : arch === ARCH.CW_RIBBON ? floorH * (0.30 + r() * 0.08) : floorH * (0.22 + r() * 0.06);
    P.mullW = arch === ARCH.CW_SUPER ? 0.07 : 0.09;
    P.mullD = arch === ARCH.CW_SUPER ? (r() < 0.45 ? 0.32 + r() * 0.25 : 0.14) : arch === ARCH.CW_PIER ? 0.12 : 0.16 + r() * 0.08;
    P.pierEvery = arch === ARCH.CW_PIER ? 1 : 0;
    P.pierW = 0.38 + r() * 0.3;
    P.pierD = 0.35 + r() * 0.2;
    P.pierSet = r() < 0.6 ? 'stone_lime' : 'granite_grey';
    P.ribbonSet = r() < 0.5 ? 'concrete_precast' : r() < 0.6 ? 'brick_white_glazed' : 'panel_alu';
    P.lobbySet = r() < 0.5 ? 'granite_grey' : 'granite_black';
  } else {
    P.wallSet = wallSetOf(rgb, arch, r);
    P.trimSet = arch === ARCH.PM ? 'granite_grey' : P.wallSet.startsWith('stone') ? 'stone_lime' : (r() < 0.75 ? 'stone_lime' : 'cast_stone');
    P.baseSet = arch === ARCH.PM ? 'granite_grey' : arch === ARCH.SLAB ? (r() < 0.5 ? 'granite_grey' : P.wallSet) : 'stone_lime_rusticated';
    P.finish = arch === ARCH.SLAB || arch === ARCH.PM ? (r() < 0.6 ? 'alu_clear' : 'alu_bronze') : (r() < 0.55 ? 'alu_white' : r() < 0.6 ? 'alu_black' : 'alu_bronze');
    // window: the shader's opening (x0..x1 of the bay, y0..y1 of the floor); the reveal depth by wall
    P.reveal = P.wallSet.startsWith('stone') || P.wallSet.startsWith('granite') ? 0.24 : 0.17;
    P.paired = arch === ARCH.DECO;
    P.sash = arch === ARCH.MASONRY || arch === ARCH.DECO ? 'dh' : 'fixed';
    P.cornice = arch === ARCH.MASONRY && (b.flags & BF.CORNICE) ? 1 : 0;
    P.belts = arch === ARCH.MASONRY || arch === ARCH.DECO;
    P.piers = arch === ARCH.DECO;
    P.lobbySet = P.baseSet;
    // FP18 (tkBuild.js masonryFaceF): the base, the courses and the cornice of a pre-war masonry tower. The stone is the
    // trim's colour (limestone, cast stone or terra cotta; a little darker under a stone wall); the base runs two or three
    // storeys; a fifth of the cornices were stripped (the plain band and parapet that replaced them), the rest stand
    // 0.8-1.7 m proud by the height of the building. (Drawn last, so the draws above keep their values.)
    if (FP18 && (arch === ARCH.MASONRY || arch === ARCH.DECO)) {
      const tones = [[200, 190, 170], [210, 194, 166], [188, 182, 172], [216, 202, 176], [196, 178, 150]];
      const t = tones[Math.min(tones.length - 1, Math.floor(r() * tones.length))];
      const k = P.wallSet.startsWith('stone') ? 0.84 : 1;
      P.fpStone = t.map((v) => v * k);
      P.fpBase = (H > 60 || r() < 0.45 ? 3 : 2) * floorH;
      const corn = arch === ARCH.MASONRY && r() < 0.82;   // (the compiler flags nearly every pre-war building BF.CORNICE)
      P.fpCornice = corn ? Math.max(0.9, Math.min(1.5, 0.6 + H * 0.012)) * (0.9 + r() * 0.25) : 0;
      P.fpTop = arch === ARCH.MASONRY ? 2 : 0;   // the string course under the top two storeys
      // the capital: over a brick shaft, the top two storeys in the stone (three in five of the corniced ones)
      P.fpCap = !!corn && !P.wallSet.startsWith('stone') && r() < 0.6;
    }
    // FP18: two thirds of the post-war apartment slabs carry balcony stacks (tkBuild.js fp18Balconies); NYCHA's do not
    if (FP18 && arch === ARCH.SLAB && P.resi && style !== STYLE.PROJECT_BRICK && H > 30 && r() < 0.65) {
      P.fpBalc = { period: 2 + Math.floor(r() * 3), phase: Math.floor(r() * 4), d: 1.2 + r() * 0.5, span: r() < 0.5 ? 2 : 1 };
    }
  }
  // the base: a lobby where the record has no shopfront band (the tile keeps its shopfronts below storeH)
  P.lobbyH = storeH > 0 ? 0 : Math.min(H * 0.25, Math.max(4.2, floorH * 1.3));
  return P;
}

// the shader's lit room for a window (materials.js inWin: rooms of 2-3 bays, id3 against the lit share)
// cellU: the bay on its wall (from the wall's start ring[i]), cellV: floor(v / floorH), wallSeed: aux3.y snapped
export function shaderRoom(cellU, cellV, wallSeed, cvar) {
  const cellUS = cellU + wallSeed * 37.0;
  const span = 2.0 + (hash12(Math.floor(cellUS / 2.0), cellV + cvar * 7.0) >= 0.55 ? 1 : 0);
  const roomI = Math.floor(cellU / span);
  const roomK = roomI + wallSeed * 53.0;
  return { roomK, id3: hash12(roomK * 7.9, cellV * 5.1 + cvar * 57.0) };
}
