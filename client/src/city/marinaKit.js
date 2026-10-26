// MARINA KIT (2026-10-24): every marina and dock in the city by one rule, from public/data/marinas/marinas.json
// (tools/pipeline/marinas/marina_build.py: OpenStreetMap's man_made=pier lines, ODbL; the slab audit audit_slabs.py).
//   docks     floating docks swept along their smoothed centrelines: a planked deck (Poly Haven weathered_planks, CC0) on
//             concrete float pontoons (concrete_floor_worn_001) down into the water, a timber whaler (rough_wood) on both
//             edges, cleats every 5 m; finger piers the same at 1.1 m; fixed piers a deck on pile bents with timber rails
//   pilings   timber piles from 3 m under the water to 3.6-3.9 m, capped
//   gangways  hinged aluminium ramps (metal_plate_02) from the bulkhead cap to the float, with trussed hand rails
//   boats     lofted hulls (motor cruisers and sloops, 7-16 m), instanced per kind and material, in the slips
//   slabs     the sources' solid shapes the docks replace: wshCoast's planimetric pier decks (marinaDropPier), the compiled
//             ground on the land polygon's dock strips (removed under the slab-out polygons), and buildings the audit drops
//             (zero-height plates, slabs over water, overlapping duplicates: marinaSkipBuilding)
// `?marina=0` turns the kit off.
import * as THREE from 'three';

const isNode = typeof window === 'undefined';
export const MARINA = isNode ? process.env.MARINA !== '0' : new URLSearchParams(location.search).get('marina') !== '0';
let D = null, P = null;
export function marinaReady() {
  if (!MARINA) return Promise.resolve(false);
  if (!P) P = (async () => {
    try {
      if (!isNode) {
        const base = new URL('data/marinas/', location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')).href;
        const r = await fetch(base + 'marinas.json');
        D = r.ok ? await r.json() : null;
      } else {
        const fs = await import(/* @vite-ignore */ 'node:fs/promises');
        D = JSON.parse(await fs.readFile(decodeURIComponent(new URL('../../public/data/marinas/marinas.json', import.meta.url).pathname), 'utf8'));
      }
    } catch { D = null; }
    return !!D;
  })();
  return P;
}
const tileOf = (ox, oz) => (D && D.tiles ? D.tiles[`${Math.floor(ox / 512)}_${Math.floor(oz / 512)}`] : null);
export function marinaDropPier(ox, oz, id) { const T = tileOf(ox, oz); return !!(T && T.dropPier && T.dropPier.includes(id)); }
const DROPB = new Map();
export function marinaSkipBuilding(key, i) {
  if (!D || !D.tiles) return false;
  let s = DROPB.get(key);
  if (!s) { const T = D.tiles[key]; s = new Set(T && T.dropBldg ? T.dropBldg : []); DROPB.set(key, s); }
  return s.has(i);
}

// ---- slab cleanup: the compiled ground under the slab-out polygons ------------------------------------------------
const inPoly = (R, x, z) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const a = R[i], b = R[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
const SLAB_SECTIONS = ['asphalt', 'sidewalk', 'curb', 'grass', 'grassU', 'path', 'brick', 'gutter', 'plaza', 'gravel', 'apron', 'rwall', 'terrP1', 'warn', 'paintW', 'paintY', 'paintG', 'terrWall', 'terrRock'];
export function marinaSlivers(tile) {
  const st = { slivers: 0 };
  // LAWN SLIVERS (every tile, before the terrain's cut splits them): a lawn or path triangle over 30 m long and under 1.5 m across on the mean that runs from above
  // the water down past 2 m under it is the compile's sunk-bank stair, not ground: one stood out of the Boat Basin as a
  // pale plank 85 m long
  for (const n of ['grass', 'grassU', 'path']) {
    const a = tile.S[n]; if (!a || a.length < 9 || a.length % 9) continue;
    const keep = new Float32Array(a.length); let m = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      const L = Math.max(Math.hypot(a[i] - a[i + 3], a[i + 2] - a[i + 5]), Math.hypot(a[i + 3] - a[i + 6], a[i + 5] - a[i + 8]), Math.hypot(a[i + 6] - a[i], a[i + 8] - a[i + 2]));
      const A = Math.abs((a[i + 3] - a[i]) * (a[i + 8] - a[i + 2]) - (a[i + 6] - a[i]) * (a[i + 5] - a[i + 2])) / 2;
      const y0 = Math.min(a[i + 1], a[i + 4], a[i + 7]), y1 = Math.max(a[i + 1], a[i + 4], a[i + 7]);
      if (L > 30 && A / L < 1.5 && y0 < -2 && y1 > 0) { st.slivers++; continue; }
      for (let k = 0; k < 9; k++) keep[m + k] = a[i + k];
      m += 9;
    }
    if (m < a.length) tile.S[n] = keep.slice(0, m);
  }
  tile.__marinaSlivers = st;
  return st;
}
// (SEAWALL KIT: the slab-out polygons' test for the walls it takes out of the curb soup before marinaGround runs)
export function marinaSlabHit(ox, oz) {
  const T = tileOf(ox, oz);
  if (!T || !T.slabOut || !T.slabOut.length) return null;
  const R = T.slabOut.map((r) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { r, b: [x0, z0, x1, z1] }; });
  return (x, z) => R.some((p) => x >= p.b[0] && x <= p.b[2] && z >= p.b[1] && z <= p.b[3] && inPoly(p.r, x, z));
}
export function marinaGround(tile, ox, oz) {
  const T = tileOf(ox, oz), st = { tris: 0, nodes: 0 };
  if (!T || !T.slabOut || !T.slabOut.length) return st;
  const R = T.slabOut.map((r) => { let x0 = 1e9, z0 = 1e9, x1 = -1e9, z1 = -1e9; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { r, b: [x0, z0, x1, z1] }; });
  const hit = (x, z) => R.some((p) => x >= p.b[0] && x <= p.b[2] && z >= p.b[1] && z <= p.b[3] && inPoly(p.r, x, z));
  const S = tile.S;
  for (const n of SLAB_SECTIONS) {
    const a = S[n]; if (!a || a.length < 9 || a.length % 9) continue;
    const keep = new Float32Array(a.length); let m = 0;
    for (let i = 0; i + 8 < a.length; i += 9) {
      if (hit((a[i] + a[i + 3] + a[i + 6]) / 3 + ox, (a[i + 2] + a[i + 5] + a[i + 8]) / 3 + oz)) { st.tris++; continue; }
      for (let k = 0; k < 9; k++) keep[m + k] = a[i + k];
      m += 9;
    }
    if (m < a.length) S[n] = keep.slice(0, m);
  }
  const G = S.terrain, res = tile.header.res, N = res + 1;
  if (G && G.length === N * N) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (hit(ox + (i * 512) / res, oz + (j * 512) / res)) { G[j * N + i] = -3; st.nodes++; }
  tile.__marinaGround = st;
  return st;
}

// ---- materials ----------------------------------------------------------------------------------------------------
const TL = isNode ? null : new THREE.TextureLoader();
const TX = new Map();
function tex(name, srgb) {
  if (!TL) return null;
  let t = TX.get(name);
  if (!t) { t = TL.load('textures/marina/' + name + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; TX.set(name, t); }
  return t;
}
let M = null;
function mats() {
  if (M) return M;
  const set = (name, set, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: tex(set + '_alb', true), normalMap: tex(set + '_nrm', false), roughnessMap: tex(set + '_orm', false), aoMap: tex(set + '_orm', false),
      roughness: o.rough ?? 1, metalness: o.metal ?? 0, vertexColors: true, color: o.color ?? 0xffffff, side: o.side ?? THREE.FrontSide });
    m.name = 'mk:' + name;
    if (o.pbr) m.userData.pbr = { name: o.pbr };
    return m;
  };
  const plain = (name, o) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough, metalness: o.metal || 0, side: o.side ?? THREE.FrontSide }); m.name = 'mk:' + name; return m; };
  M = {
    deck: set('deckg', 'deck'),   // ('deckg': the grey set's own key, so Unreal binds it afresh)
    float: set('float', 'float', { pbr: 'concrete_smooth' }), wood: set('wood', 'piling'), steel: set('steel', 'steel', { metal: 0.6, rough: 0.9 }),
    hull: plain('hull', { rough: 0.32 }), bdeck: plain('boatdeck', { rough: 0.7 }), glass: plain('boatglass', { rough: 0.08, metal: 0.2 }),
    canvas: plain('canvas', { rough: 0.9, side: THREE.DoubleSide }), alu: plain('alu', { rough: 0.35, metal: 0.85 }),
  };
  return M;
}

// ---- a merge bin: positions, normals, uvs, colours ------------------------------------------------------------------
class Bin {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; }
  v(p, n, u, c) { this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.U.push(u[0], u[1]); this.C.push(c[0], c[1], c[2]); }
  // a quad a b c d (counter-clockwise seen from its front), flat normal, uvs given
  quad(a, b, c, d, col, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n) || 1; n = n.map((q) => q / l);
    this.v(a, n, ua, col); this.v(b, n, ub, col); this.v(c, n, uc, col); this.v(a, n, ua, col); this.v(c, n, uc, col); this.v(d, n, ud, col);
  }
  // an oriented box: centre c, axis u (unit, horizontal) of length lx, height ly (y0 at its bottom), width lz
  obox(cx, y0, cz, ux, uz, lx, ly, lz, col, uvs = 1) {
    const vx = -uz, vz = ux, hx = lx / 2, hz = lz / 2, y1 = y0 + ly;
    const P = (s, t, y) => [cx + ux * s * hx + vx * t * hz, y, cz + uz * s * hx + vz * t * hz];
    const u = (a, b) => [a / uvs, b / uvs];
    this.quad(P(-1, -1, y1), P(-1, 1, y1), P(1, 1, y1), P(1, -1, y1), col, u(0, 0), u(0, lz), u(lx, lz), u(lx, 0));
    this.quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), col, u(0, 0), u(lx, 0), u(lx, ly), u(0, ly));
    this.quad(P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1), col, u(0, 0), u(lx, 0), u(lx, ly), u(0, ly));
    this.quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), col, u(0, 0), u(lz, 0), u(lz, ly), u(0, ly));
    this.quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), col, u(0, 0), u(lz, 0), u(lz, ly), u(0, ly));
  }
  // a cylinder (vertical, or between two points when b is given) of radius r, n sides
  cyl(a, b, r, col, n = 10, uvs = 1, cap = true) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, w = d.map((q) => q / L);
    let s = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e = [w[1] * s[2] - w[2] * s[1], w[2] * s[0] - w[0] * s[2], w[0] * s[1] - w[1] * s[0]]; const el = Math.hypot(...e); e = e.map((q) => q / el);
    const f = [w[1] * e[2] - w[2] * e[1], w[2] * e[0] - w[0] * e[2], w[0] * e[1] - w[1] * e[0]];
    const ring = (o, k) => { const t = (k / n) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t); return [[o[0] + (e[0] * c + f[0] * si) * r, o[1] + (e[1] * c + f[1] * si) * r, o[2] + (e[2] * c + f[2] * si) * r], [e[0] * c + f[0] * si, e[1] * c + f[1] * si, e[2] * c + f[2] * si]]; };
    for (let k = 0; k < n; k++) {
      const [p0, n0] = ring(a, k), [p1, n1] = ring(a, k + 1), [q0] = ring(b, k), [q1] = ring(b, k + 1);
      const u0 = (k / n) * 2 * Math.PI * r / uvs, u1 = ((k + 1) / n) * 2 * Math.PI * r / uvs;
      this.v(p0, n0, [u0, 0], col); this.v(p1, n1, [u1, 0], col); this.v(q1, n1, [u1, L / uvs], col);
      this.v(p0, n0, [u0, 0], col); this.v(q1, n1, [u1, L / uvs], col); this.v(q0, n0, [u0, L / uvs], col);
      if (cap) { const [t0] = ring(b, k), [t1] = ring(b, k + 1), top = [b[0] + w[0] * r * 0.4, b[1] + w[1] * r * 0.4, b[2] + w[2] * r * 0.4]; this.v(t0, w, [0, 0], col); this.v(t1, w, [0.1, 0], col); this.v(top, w, [0.05, 0.1], col); }
    }
  }
  mesh(mat, name, shadow = true) {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = 'mk:' + name; m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}
const lin = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const hsh = (a, b = 0) => { let h = (Math.imul(Math.round(a * 100) | 0, 73856093) ^ Math.imul(Math.round(b * 100) | 0, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h & 0xffff) / 0xffff; };

// a centreline as drawn: a polyline keeps its straight runs and square corners (mitred offsets); only a genuinely curved line
// (4+ points, every turn under 20 deg, segments under 10 m) is smoothed (centripetal Catmull-Rom, samples every 1 m)
function sweepLine(pts) {
  let S = pts;
  if (pts.length >= 4) {
    let curved = true;
    for (let i = 1; i + 1 < pts.length && curved; i++) {
      const ax = pts[i][0] - pts[i - 1][0], az = pts[i][1] - pts[i - 1][1], bx = pts[i + 1][0] - pts[i][0], bz = pts[i + 1][1] - pts[i][1];
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la > 10 || lb > 10 || (ax * bx + az * bz) / (la * lb || 1) < Math.cos(Math.PI / 9)) curved = false;
    }
    if (curved) {
      const c = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
      S = c.getSpacedPoints(Math.max(2, Math.ceil(c.getLength()))).map((v) => [v.x, v.z]);
    }
  }
  const out = [];
  let acc = 0;
  for (let i = 0; i < S.length; i++) {
    const seg = (j) => { const dx = S[j + 1][0] - S[j][0], dz = S[j + 1][1] - S[j][1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
    const t0 = i > 0 ? seg(i - 1) : seg(0), t1 = i + 1 < S.length ? seg(i) : seg(S.length - 2);
    let tx = t0[0] + t1[0], tz = t0[1] + t1[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const k = Math.min(2, 1 / Math.max(0.5, tx * t1[0] + tz * t1[1]));   // (the mitre: the offset lengthened at a corner)
    if (i) acc += Math.hypot(S[i][0] - S[i - 1][0], S[i][1] - S[i - 1][1]);
    out.push({ x: S[i][0], z: S[i][1], nx: tz * k, nz: -tx * k, tx, tz, s: acc });
  }
  return out;
}

const COL = {
  deck: lin(0xeeeeea), deckF: lin(0xe6e6e2),   // (the planks' set is weathered grey: tools/assets/marina_tex.py)
  float: lin(0xb9b7b0), whaler: lin(0x9a9184), pile: lin(0x5e5244), steel: lin(0x8e9399), cleat: lin(0x3a3d40),
  gangway: lin(0xc9cdd1), rail: lin(0xd2d6da), timber: lin(0x8a7660),
};

// ---- docks, piers, pilings, cleats, gangways ----------------------------------------------------------------------
function buildDocks(T, ox, oz, B) {
  for (const d of T.docks) {
    const L = sweepLine(d.pts.map(([x, z]) => [x - ox, z - oz]));
    if (L.length < 2) continue;
    const fixed = d.kind === 'fixed', hw = d.w / 2, y = d.y - (d.kind === 'finger' ? 0.015 : 0);
    const yb = fixed ? y - 0.3 : y - 0.75;   // (the float's bottom under the water; a fixed pier's deck 0.3 m thick)
    const side = (k, sd) => [L[k].x + L[k].nx * hw * sd, L[k].z + L[k].nz * hw * sd];
    for (let k = 0; k + 1 < L.length; k++) {
      const a = L[k], b = L[k + 1], l0 = side(k, 1), r0 = side(k, -1), l1 = side(k + 1, 1), r1 = side(k + 1, -1);
      // deck: boards across the dock (u across, v along, 2 m to a texture)
      B.deck.quad([r0[0], y, r0[1]], [r1[0], y, r1[1]], [l1[0], y, l1[1]], [l0[0], y, l0[1]], d.kind === 'finger' ? COL.deckF : COL.deck,
        [0, a.s / 2], [0, b.s / 2], [d.w / 2, b.s / 2], [d.w / 2, a.s / 2]);
      // sides: the float (concrete) under a timber whaler 0.22 m deep
      for (const [p0, p1] of [[l0, l1], [r1, r0]]) {
        const du = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
        B.wood.quad([p0[0], y - 0.22, p0[1]], [p1[0], y - 0.22, p1[1]], [p1[0], y + 0.02, p1[1]], [p0[0], y + 0.02, p0[1]], COL.whaler, [a.s, 0], [a.s + du, 0], [a.s + du, 0.24], [a.s, 0.24]);
        if (!fixed) {
          const i0 = [p0[0], p0[1]], i1 = [p1[0], p1[1]];
          B.float.quad([i0[0], yb, i0[1]], [i1[0], yb, i1[1]], [i1[0], y - 0.22, i1[1]], [i0[0], y - 0.22, i0[1]], COL.float, [a.s / 2, 0], [(a.s + du) / 2, 0], [(a.s + du) / 2, 0.27], [a.s / 2, 0.27]);
        } else B.wood.quad([p0[0], yb, p0[1]], [p1[0], yb, p1[1]], [p1[0], y - 0.22, p1[1]], [p0[0], y - 0.22, p0[1]], COL.timber, [a.s, 0], [a.s + du, 0], [a.s + du, 0.1], [a.s, 0.1]);
      }
      // underside (seen from a low lens over the water)
      B.float.quad([l0[0], yb, l0[1]], [l1[0], yb, l1[1]], [r1[0], yb, r1[1]], [r0[0], yb, r0[1]], COL.float);
    }
    // the ends
    for (const k of [0, L.length - 1]) {
      const l = side(k, 1), r = side(k, -1), out = k === 0 ? -1 : 1;
      const [p, q] = out > 0 ? [l, r] : [r, l];
      B.wood.quad([p[0], y - 0.22, p[1]], [q[0], y - 0.22, q[1]], [q[0], y + 0.02, q[1]], [p[0], y + 0.02, p[1]], COL.whaler, [0, 0], [d.w, 0], [d.w, 0.24], [0, 0.24]);
      if (!fixed) B.float.quad([p[0], yb, p[1]], [q[0], yb, q[1]], [q[0], y - 0.22, q[1]], [p[0], y - 0.22, p[1]], COL.float, [0, 0], [d.w / 2, 0], [d.w / 2, 0.27], [0, 0.27]);
    }
    if (fixed) {
      // timber rails on both edges: posts every 2.4 m, a cap rail at 1.07 m and a mid rail
      for (const sd of [1, -1]) {
        let last = null;
        for (let k = 0; k < L.length; k++) {
          const p = L[k], due = k === 0 || k === L.length - 1 || p.s - (last ?? -9) >= 2.4;
          if (!due) continue;
          const x = p.x + p.nx * (hw - 0.08) * sd, z = p.z + p.nz * (hw - 0.08) * sd;
          B.wood.obox(x, y, z, p.tx, p.tz, 0.14, 1.07, 0.14, COL.timber, 1);
          if (last !== null) { const q = B._lastRail[sd]; for (const h of [1.0, 0.55]) B.wood.cyl([q[0], y + h, q[1]], [x, y + h, z], 0.05, COL.timber, 6, 1, false); }
          B._lastRail = B._lastRail || {}; B._lastRail[sd] = [x, z]; last = p.s;
        }
      }
    }
  }
  for (const [x, z, r, top] of T.pilings) {
    const lx = x - ox, lz = z - oz;
    B.wood.cyl([lx, -3, lz], [lx, top, lz], r / 2, COL.pile, 10, 1.2, true);
  }
  for (const [x, z, yaw, y] of T.cleats) {
    const lx = x - ox, lz = z - oz, ux = Math.cos(yaw), uz = Math.sin(yaw);
    B.steel.obox(lx, y, lz, ux, uz, 0.18, 0.07, 0.07, COL.cleat, 0.5);
    B.steel.obox(lx, y + 0.07, lz, ux, uz, 0.36, 0.035, 0.06, COL.cleat, 0.5);
  }
  for (const g of T.gangways) {
    const ax = g.a[0] - ox, az = g.a[1] - oz, bx = g.b[0] - ox, bz = g.b[1] - oz;
    const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L, nx = uz, nz = -ux, hw = g.w / 2;
    const P = (s, t, h) => [ax + ux * s + nx * t, g.y0 + (g.y1 - g.y0) * (s / L) + h, az + uz * s + nz * t];
    B.steel.quad(P(0, -hw, 0), P(L, -hw, 0), P(L, hw, 0), P(0, hw, 0), COL.gangway, [0, 0], [L / 1.5, 0], [L / 1.5, g.w / 1.5], [0, g.w / 1.5]);
    B.steel.quad(P(0, hw, -0.18), P(L, hw, -0.18), P(L, -hw, -0.18), P(0, -hw, -0.18), COL.gangway);
    for (const sd of [1, -1]) {
      // the side stringer, posts every 1.5 m, the hand rail at 1.0 m and the knee rail at 0.5 m
      const t = hw * sd;
      if (sd > 0) B.steel.quad(P(0, t, -0.18), P(L, t, -0.18), P(L, t, 0.12), P(0, t, 0.12), COL.gangway);
      else B.steel.quad(P(L, t, -0.18), P(0, t, -0.18), P(0, t, 0.12), P(L, t, 0.12), COL.gangway);
      const n = Math.max(2, Math.round(L / 1.5));
      for (let k = 0; k <= n; k++) { const s = (k / n) * L; B.alu.cyl(P(s, t, 0), P(s, t, 1.0), 0.025, COL.rail, 6, 1, false); }
      B.alu.cyl(P(0, t, 1.0), P(L, t, 1.0), 0.03, COL.rail, 8, 1, false);
      B.alu.cyl(P(0, t, 0.5), P(L, t, 0.5), 0.02, COL.rail, 6, 1, false);
      for (let k = 0; k < n; k++) { const s0 = (k / n) * L, s1 = ((k + 1) / n) * L; B.alu.cyl(P(s0, t, 0.05), P(s1, t, 0.95), 0.015, COL.rail, 5, 1, false); }
    }
    // the roller plate onto the float
    B.steel.obox(bx + ux * 0.5, g.y1 - 0.02, bz + uz * 0.5, ux, uz, 1.0, 0.04, g.w, COL.gangway, 1);
  }
}

// ---- boats: lofted hulls in their own frame (x forward, y up from the waterline, z to starboard), length 1 -------------
const BOATS = {};
function hullGeo(kind) {
  const NS = 28, NP = 9, beam = kind === 'sail' ? 0.3 : 0.33;
  const pos = [], idx = [];
  // station t 0 (transom) .. 1 (stem): half-beam, sheer height, keel depth
  const hb = (t) => (t < 0.55 ? 0.86 + 0.14 * Math.sin((t / 0.55) * Math.PI / 2) : Math.pow(Math.cos(((t - 0.55) / 0.45) * Math.PI / 2), 0.75)) * beam / 2;
  const sh = (t) => (kind === 'sail' ? 0.07 + 0.03 * t * t : 0.095 + 0.05 * t * t);
  const kd = (t) => (kind === 'sail' ? -0.05 : -0.045) * (t < 0.85 ? 1 : 1 - (t - 0.85) / 0.15 * 0.85);
  for (let i = 0; i <= NS; i++) {
    const t = i / NS, x = t - 0.5, b = Math.max(hb(t), 0.002), h = sh(t), k = kd(t);
    for (let j = 0; j <= 2 * NP; j++) {
      const s = j / (2 * NP) * 2 - 1, a = Math.abs(s);   // -1 port sheer .. 0 keel .. 1 starboard sheer
      const z = Math.sign(s) * b * Math.pow(Math.sin(a * Math.PI / 2), 0.55), y = k + (h - k) * Math.pow(a, 1.6);
      pos.push(x, y, z);
    }
  }
  const W = 2 * NP + 1;
  for (let i = 0; i < NS; i++) for (let j = 0; j < 2 * NP; j++) { const a = i * W + j, b = a + W; idx.push(a, a + 1, b, a + 1, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  const ng = g.toNonIndexed();
  // the transom: a flat face at x = -0.5
  const tp = [];
  for (let j = 0; j < 2 * NP; j++) { const p0 = j, p1 = j + 1; tp.push([pos[p0 * 3], pos[p0 * 3 + 1], pos[p0 * 3 + 2]], [pos[p1 * 3], pos[p1 * 3 + 1], pos[p1 * 3 + 2]]); }
  return { ng, hb, sh, beam };
}
function boatParts(kind) {
  if (BOATS[kind]) return BOATS[kind];
  const { ng, hb, sh } = hullGeo(kind);
  const toBin = (g, col) => { const B = new Bin(); const P = g.attributes.position, N = g.attributes.normal; for (let i = 0; i < P.count; i++) B.v([P.getX(i), P.getY(i), P.getZ(i)], [-N.getX(i), -N.getY(i), -N.getZ(i)], [P.getX(i), P.getY(i)], col); return B; };
  const hull = toBin(ng, [1, 1, 1]);
  // the boot stripe: a band just over the waterline drawn into the hull's colours per vertex (dark under y 0.012)
  for (let i = 0; i < hull.P.length / 3; i++) { const y = hull.P[i * 3 + 1]; if (y < 0.004) { hull.C[i * 3] = 0.06; hull.C[i * 3 + 1] = 0.07; hull.C[i * 3 + 2] = 0.09; } else if (y < 0.012) { hull.C[i * 3] = 0.12; hull.C[i * 3 + 1] = 0.16; hull.C[i * 3 + 2] = 0.3; } }
  const deck = new Bin(), glass = new Bin(), canvas = new Bin(), alu = new Bin();
  const off = lin(0xeceae3), nonskid = lin(0xd8d5cb);
  // deck: a fan over the sheer line from the transom to the stem
  const NS = 28;
  for (let i = 0; i < NS; i++) {
    const t0 = i / NS, t1 = (i + 1) / NS, x0 = t0 - 0.5, x1 = t1 - 0.5, b0 = hb(t0) * 0.985, b1 = hb(t1) * 0.985, y0 = sh(t0) + 0.002, y1 = sh(t1) + 0.002;
    deck.quad([x0, y0, b0], [x1, y1, b1], [x1, y1, -b1], [x0, y0, -b0], nonskid);
  }
  // transom
  { const b = hb(0), h = sh(0); deck.quad([-0.5, -0.03, -b * 0.9], [-0.5, -0.03, b * 0.9], [-0.5, h, b], [-0.5, h, -b], off); }
  if (kind === 'motor') {
    // the cabin trunk and windscreen over the forward half, a hard top on posts aft of it with a bimini
    const cx0 = -0.08, cx1 = 0.26, ch = 0.07, b = hb(0.55) * 0.7, yb = sh(0.5);
    deck.quad([cx0, yb, b], [cx1, yb, b * 0.8], [cx1, yb + ch, b * 0.7], [cx0, yb + ch, b * 0.9], off);
    deck.quad([cx1, yb, -b * 0.8], [cx0, yb, -b], [cx0, yb + ch, -b * 0.9], [cx1, yb + ch, -b * 0.7], off);
    deck.quad([cx0, yb + ch, b * 0.9], [cx1, yb + ch, b * 0.7], [cx1, yb + ch, -b * 0.7], [cx0, yb + ch, -b * 0.9], off);
    glass.quad([cx0, yb + ch, -b * 0.9], [cx0 - 0.04, yb + ch + 0.055, -b * 0.8], [cx0 - 0.04, yb + ch + 0.055, b * 0.8], [cx0, yb + ch, b * 0.9], lin(0x1d2a33));
    glass.quad([cx1 - 0.02, yb + 0.02, b * 0.79], [cx0 + 0.04, yb + 0.02, b * 0.97], [cx0 + 0.04, yb + 0.055, b * 0.94], [cx1 - 0.02, yb + 0.055, b * 0.74], lin(0x1d2a33));
    glass.quad([cx0 + 0.04, yb + 0.02, -b * 0.97], [cx1 - 0.02, yb + 0.02, -b * 0.79], [cx1 - 0.02, yb + 0.055, -b * 0.74], [cx0 + 0.04, yb + 0.055, -b * 0.94], lin(0x1d2a33));
    const tx0 = -0.3, tx1 = cx0 - 0.03, ty = yb + ch + 0.075;
    for (const [x, z] of [[tx0, b], [tx0, -b], [tx1, b * 0.9], [tx1, -b * 0.9]]) alu.cyl([x, yb, z], [x, ty, z], 0.004, lin(0xd8dde2), 6, 1, false);
    canvas.quad([tx0, ty, -b], [tx1, ty, -b * 0.9], [tx1, ty, b * 0.9], [tx0, ty, b], lin(0x1c2c44));
    canvas.quad([tx0, ty, b], [tx1, ty, b * 0.9], [tx1, ty, -b * 0.9], [tx0, ty, -b], lin(0x1c2c44));
    // bow rail
    for (const sd of [1, -1]) { let prev = null; for (let t = 0.55; t <= 0.97; t += 0.07) { const p = [t - 0.5, sh(t) + 0.035, hb(t) * 0.9 * sd]; alu.cyl([p[0], sh(t), p[2]], p, 0.003, lin(0xd8dde2), 5, 1, false); if (prev) alu.cyl(prev, p, 0.003, lin(0xd8dde2), 5, 1, false); prev = p; } }
  } else {
    // a low coachroof, the mast (1.25 L) with its boom, the forestay and shrouds, the furled main under a cover
    const cx0 = -0.12, cx1 = 0.2, b = hb(0.5) * 0.6, yb = sh(0.45), ch = 0.04;
    deck.quad([cx0, yb, b], [cx1, yb, b * 0.75], [cx1, yb + ch, b * 0.7], [cx0, yb + ch, b * 0.95], off);
    deck.quad([cx1, yb, -b * 0.75], [cx0, yb, -b], [cx0, yb + ch, -b * 0.95], [cx1, yb + ch, -b * 0.7], off);
    deck.quad([cx0, yb + ch, b * 0.95], [cx1, yb + ch, b * 0.7], [cx1, yb + ch, -b * 0.7], [cx0, yb + ch, -b * 0.95], off);
    deck.quad([cx0, yb, -b], [cx0, yb, b], [cx0, yb + ch, b * 0.95], [cx0, yb + ch, -b * 0.95], off);
    for (const sd of [1, -1]) glass.quad([cx0 + 0.05, yb + 0.012, b * 0.97 * sd], [cx1 - 0.05, yb + 0.012, b * 0.8 * sd], [cx1 - 0.05, yb + 0.03, b * 0.76 * sd], [cx0 + 0.05, yb + 0.03, b * 0.93 * sd], lin(0x1d2a33));
    const mx = 0.1, top = 1.25;
    alu.cyl([mx, yb + ch, 0], [mx, top, 0], 0.007, lin(0xd0d4d8), 8, 1, true);
    alu.cyl([mx, yb + ch + 0.11, 0], [-0.32, yb + ch + 0.11, 0], 0.005, lin(0xd0d4d8), 6, 1, false);
    canvas.cyl([mx - 0.01, yb + ch + 0.125, 0], [-0.3, yb + ch + 0.125, 0], 0.012, lin(0x203a5c), 8, 1, false);
    alu.cyl([0.49, sh(1) + 0.01, 0], [mx, top * 0.97, 0], 0.0015, lin(0x9aa0a6), 4, 1, false);
    for (const sd of [1, -1]) alu.cyl([mx - 0.02, sh(0.6), hb(0.6) * 0.95 * sd], [mx, top * 0.82, 0], 0.0015, lin(0x9aa0a6), 4, 1, false);
    alu.cyl([-0.5, sh(0) + 0.01, 0], [mx, top * 0.97, 0], 0.0012, lin(0x9aa0a6), 4, 1, false);
  }
  const geo = (b) => { if (!b.P.length) return null; const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(b.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.N, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(b.C, 3)); return g; };
  BOATS[kind] = { hull: geo(hull), bdeck: geo(deck), glass: geo(glass), canvas: geo(canvas), alu: geo(alu) };
  return BOATS[kind];
}
const HULLS = [[0xf3f3ef, 0.7], [0xe9e2cf, 0.15], [0x1b2a40, 0.1], [0x8a2a24, 0.05]];
function buildBoats(T, ox, oz, group) {
  if (!T.boats || !T.boats.length) return 0;
  const m = mats(), by = new Map();
  for (const b of T.boats) {
    const [x, z, yaw, len, kind, c] = b;
    let acc = 0, hc = HULLS[0][0];
    for (const [h, p] of HULLS) { acc += p; if (c <= acc) { hc = h; break; } }
    const k = kind + '|' + hc;
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(b);
  }
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), s = new THREE.Vector3(), p = new THREE.Vector3();
  let n = 0;
  for (const [k, list] of by) {
    const [kind, hcS] = k.split('|'), parts = boatParts(kind);
    for (const part of ['hull', 'bdeck', 'glass', 'canvas', 'alu']) {
      const g = parts[part]; if (!g) continue;
      let mat = m[part];
      if (part === 'hull') { mat = m.hull.clone(); mat.name = 'mk:hull:' + Number(hcS).toString(16); mat.color = new THREE.Color(Number(hcS)); }
      const im = new THREE.InstancedMesh(g, mat, list.length);
      list.forEach(([x, z, yaw, len], i) => {
        q.setFromAxisAngle(up, -yaw); s.set(len, len, len); p.set(x - ox, 0.02 * len / 10, z - oz);
        mtx.compose(p, q, s); im.setMatrixAt(i, mtx);
      });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere();
      im.name = `mk:boat:${kind}:${part}`; im.castShadow = part !== 'glass'; im.receiveShadow = true;
      group.add(im);
    }
    n += list.length;
  }
  return n;
}

// the tile's marina: one group at the tile's origin
export function buildMarina(group, ox, oz) {
  const T = tileOf(ox, oz);
  if (!T || (!T.docks.length && !T.gangways.length && !T.boats.length && !T.pilings.length)) return null;
  const m = mats();
  const G = new THREE.Group(); G.name = 'marina'; G.position.set(ox, 0, oz);
  const B = { deck: new Bin(), float: new Bin(), wood: new Bin(), steel: new Bin(), alu: new Bin() };
  buildDocks(T, ox, oz, B);
  for (const [k, mat] of [['deck', m.deck], ['float', m.float], ['wood', m.wood], ['steel', m.steel], ['alu', m.alu]]) { const me = B[k].mesh(mat, k); if (me) G.add(me); }
  const boats = buildBoats(T, ox, oz, G);
  G.updateMatrixWorld(true);
  group.add(G);
  return { docks: T.docks.length, gangways: T.gangways.length, pilings: T.pilings.length, boats };
}
