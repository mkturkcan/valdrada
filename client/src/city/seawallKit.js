// SEAWALL KIT (2026-10-25): every bulkhead and seawall in the city by one rule, swept along the coast's own curves:
//   sources   the swept shore walls (heightAuthority.js shoreSplines: the compile's bulkheads chained into smoothed runs, taken
//             out of the curb soup after the terrain's last pass, seawallExtract) and the FDR structures' river walls
//             (hhpKit.js drawBox: Carl Schurz Park, the East River esplanade, Sutton Place), drawn segment by segment here
//   face      coursed dressed granite blocks (Poly Haven stone_block_wall, CC0, at its real 2.1 m) from under the water to
//             the coping; a concrete bulkhead (concrete_wall_006) where nothing walkable lies behind the wall (the run's
//             land 2.5 m behind its cap: walks and lawns on under half of it)
//   coping    a granite cap (granite_tile_03) in 1.8 m stones with open joints, projecting 6 cm over the face; on concrete a
//             cast cap in 6 m pours
//   weather   per vertex: the face under the water dark with weed, green-black algae over the low water, a dark wet band
//             to the high-water line (0.95 m), a brown tide line, a lighter stained band over it; streaks run down from the
//             coping at their own lengths, rust and dark stains under the outfalls and ladders
//   rail      on the coping: the classic NYC esplanade rail (black iron pickets between a top and a bottom rail, posts every
//             2.4 m) on granite runs, a two-pipe galvanized rail on concrete runs with walks behind, none on the rest
//   details   drain outfalls (about one in 130 m), steel ladders (about one in 75 m), timber fender piles with a wale on
//             stretches of the concrete bulkheads and along open pier edges
//   esplanade hexagonal concrete pavers behind the coping on the FDR esplanade decks and on wide caps; lamp posts every 30 m
//             and benches between them on granite runs
//   piers     wshCoast's solid pier decks (kept by the marina rule: no dock line) stand on piles: a 0.6 m deck edge in
//             place of the fascia to the river bed, the soffit, a pile grid, fender piles and a pipe rail on the water edges
// `?seawall=0` / SEAWALL=0 turns the kit off (the walls as before).
import * as THREE from 'three';
import { haInfo } from '../world/heightAuthority.js';
import { marinaSlabHit } from './marinaKit.js';

const isNode = typeof window === 'undefined';
export const SEAWALL = isNode ? process.env.SEAWALL !== '0' : new URLSearchParams(location.search).get('seawall') !== '0';
const SIZE = { granite: 2.1, concrete: 2.71, capc: 2.71, coping: 1.802, paving: 1.6, timber: 0.5 };
// the faces' height atlases (tools/assets/seawall_tex.py): u along the wall, v by the height over the water plane
const ATL = { granite: { w: 8.4, h: 16.8, y0: -4.2 }, concrete: { w: 8.13, h: 16.26, y0: -5.42 } };
const fuv = (k, s, y) => { const a = ATL[k]; return [s / a.w, (y - a.y0) / a.h]; };
const COPE_H = 0.5, PROJ = 0.16;   // (a projection deep enough to throw a shadow line on the face from 400 m)

// ---- materials (own keys: sw:*) ------------------------------------------------------------------------------------
const TL = isNode ? null : new THREE.TextureLoader();
const TX = new Map();
function tex(name, srgb) {
  if (!TL) return null;
  let t = TX.get(name);
  if (!t) { t = TL.load('textures/seawall/' + name + '.jpg'); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; if (srgb) t.colorSpace = THREE.SRGBColorSpace; TX.set(name, t); }
  return t;
}
let M = null;
function mats() {
  if (M) return M;
  const set = (name, s, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ map: tex(s + '_alb', true), normalMap: tex(s + '_nrm', false), roughnessMap: tex(s + '_orm', false), aoMap: tex(s + '_orm', false),
      roughness: o.rough ?? 1, metalness: 0, vertexColors: true, side: o.side ?? THREE.FrontSide });
    m.name = 'sw:' + name;
    return m;
  };
  const plain = (name, o) => { const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: o.rough, metalness: o.metal || 0, side: o.side ?? THREE.FrontSide }); m.name = 'sw:' + name; return m; };
  M = {
    granite: set('granite_c', 'granite'), concrete: set('concrete_c', 'concrete'), coping: set('coping', 'coping'), paving: set('paving', 'paving'),
    timber: set('timber', 'timber'), pierdeck: set('pierdeck', 'concretet'), soffit: set('soffit', 'concretet', { side: THREE.DoubleSide }), capc: set('capc', 'concretet'),
    iron: plain('iron', { rough: 0.5, metal: 0.4 }), steel: plain('steel', { rough: 0.42, metal: 0.85 }), dark: plain('dark', { rough: 0.95, side: THREE.DoubleSide }),
    globe: plain('globe', { rough: 0.25 }),
  };
  return M;
}

// ---- a merge bin ---------------------------------------------------------------------------------------------------
class Bin {
  constructor() { this.P = []; this.N = []; this.U = []; this.C = []; }
  v(p, n, u, c) { this.P.push(p[0], p[1], p[2]); this.N.push(n[0], n[1], n[2]); this.U.push(u[0], u[1]); this.C.push(c[0], c[1], c[2]); }
  // a quad a b c d facing `want` (flipped when wound the other way); per-vertex colours (one colour or four)
  quad(a, b, c, d, want, cols, ua = [0, 0], ub = [1, 0], uc = [1, 1], ud = [0, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const l = Math.hypot(...n); if (l < 1e-9) return;
    n = n.map((q) => q / l);
    const C = cols.length === 4 && Array.isArray(cols[0]) ? cols : [cols, cols, cols, cols];
    if (want && n[0] * want[0] + n[1] * want[1] + n[2] * want[2] < 0) {
      n = n.map((q) => -q);
      this.v(a, n, ua, C[0]); this.v(c, n, uc, C[2]); this.v(b, n, ub, C[1]); this.v(a, n, ua, C[0]); this.v(d, n, ud, C[3]); this.v(c, n, uc, C[2]);
    } else { this.v(a, n, ua, C[0]); this.v(b, n, ub, C[1]); this.v(c, n, uc, C[2]); this.v(a, n, ua, C[0]); this.v(c, n, uc, C[2]); this.v(d, n, ud, C[3]); }
  }
  // an oriented box: base centre (cx, y0, cz), axis (ux, uz) of length lx, height ly, width lz (no bottom)
  obox(cx, y0, cz, ux, uz, lx, ly, lz, col, uvs = 1) {
    const vx = -uz, vz = ux, hx = lx / 2, hz = lz / 2, y1 = y0 + ly;
    const P = (s, t, y) => [cx + ux * s * hx + vx * t * hz, y, cz + uz * s * hx + vz * t * hz];
    const u = (a, b) => [a / uvs, b / uvs];
    this.quad(P(-1, -1, y1), P(-1, 1, y1), P(1, 1, y1), P(1, -1, y1), [0, 1, 0], col, u(0, 0), u(0, lz), u(lx, lz), u(lx, 0));
    this.quad(P(-1, -1, y0), P(1, -1, y0), P(1, -1, y1), P(-1, -1, y1), [-vx, 0, -vz], col, u(0, 0), u(lx, 0), u(lx, ly), u(0, ly));
    this.quad(P(1, 1, y0), P(-1, 1, y0), P(-1, 1, y1), P(1, 1, y1), [vx, 0, vz], col, u(0, 0), u(lx, 0), u(lx, ly), u(0, ly));
    this.quad(P(-1, 1, y0), P(-1, -1, y0), P(-1, -1, y1), P(-1, 1, y1), [-ux, 0, -uz], col, u(0, 0), u(lz, 0), u(lz, ly), u(0, ly));
    this.quad(P(1, -1, y0), P(1, 1, y0), P(1, 1, y1), P(1, -1, y1), [ux, 0, uz], col, u(0, 0), u(lz, 0), u(lz, ly), u(0, ly));
  }
  // a cylinder between two points, radius r (r1 at b when given), n sides, open ends unless cap
  cyl(a, b, r, col, n = 8, uvs = 1, cap = false, r1 = r) {
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d) || 1, w = d.map((q) => q / L);
    const s = Math.abs(w[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    let e = [w[1] * s[2] - w[2] * s[1], w[2] * s[0] - w[0] * s[2], w[0] * s[1] - w[1] * s[0]]; const el = Math.hypot(...e); e = e.map((q) => q / el);
    const f = [w[1] * e[2] - w[2] * e[1], w[2] * e[0] - w[0] * e[2], w[0] * e[1] - w[1] * e[0]];
    const rim = (o, k, rr) => { const t = (k / n) * Math.PI * 2, c = Math.cos(t), si = Math.sin(t), nn = [e[0] * c + f[0] * si, e[1] * c + f[1] * si, e[2] * c + f[2] * si]; return [[o[0] + nn[0] * rr, o[1] + nn[1] * rr, o[2] + nn[2] * rr], nn]; };
    for (let k = 0; k < n; k++) {
      const [p0, n0] = rim(a, k, r), [p1, n1] = rim(a, k + 1, r), [q0] = rim(b, k, r1), [q1] = rim(b, k + 1, r1);
      const u0 = ((k / n) * 2 * Math.PI * r) / uvs, u1 = (((k + 1) / n) * 2 * Math.PI * r) / uvs;
      this.v(p0, n0, [u0, 0], col); this.v(p1, n1, [u1, 0], col); this.v(q1, n1, [u1, L / uvs], col);
      this.v(p0, n0, [u0, 0], col); this.v(q1, n1, [u1, L / uvs], col); this.v(q0, n0, [u0, L / uvs], col);
      if (cap) { this.v(q0, w, [0, 0], col); this.v(q1, w, [0.1, 0], col); this.v(b, w, [0.05, 0.1], col); }
    }
  }
  mesh(mat, name, shadow = true) {
    if (!this.P.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.U, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat); m.name = 'sw:' + name; m.castShadow = shadow; m.receiveShadow = true;
    return m;
  }
}
const hsh = (a, b = 0) => { let h = (Math.imul(Math.round(a * 100) | 0, 73856093) ^ Math.imul(Math.round(b * 100) | 0, 19349663)) >>> 0; h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return (h & 0xffff) / 0xffff; };
const lerp = (a, b, t) => a + (b - a) * t;
const sm = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const mul = (c, k) => [c[0] * k[0], c[1] * k[1], c[2] * k[2]];

// the tile's kit: its bins and counts
function kitOf(tile) {
  if (!tile.__sw) tile.__sw = { B: {}, st: { segs: 0, m: 0, granite: 0, concrete: 0, ladders: 0, outfalls: 0, fenders: 0, lamps: 0, benches: 0, piers: 0, piles: 0, shoreOut: 0 } };
  return tile.__sw;
}
const bin = (K, k) => K.B[k] || (K.B[k] = new Bin());

// ---- weathering --------------------------------------------------------------------------------------------------
const BASE = { granite: [0.82, 0.8, 0.77], concrete: [0.85, 0.84, 0.82] };
// streaks down from the coping: a strength and length per metre of wall (a few strong, most faint), stains of the features
function wallCol(kind, s, y, cb, stains) {
  let c = BASE[kind].slice();   // (the water's marks are in the atlas)
  const k = Math.floor(s), h = hsh(k, 3.7), wob = 0.94 + 0.12 * (0.5 + 0.5 * Math.sin(s * 0.21 + 3 * hsh(Math.floor(s / 17), 1)));
  const A = (h > 0.4 ? 0.12 + ((h - 0.4) / 0.6) * 0.48 : 0.1 * h) * (y > 1.1 ? 1 : sm(0.9, 1.1, y)), L = 0.7 + 2.8 * hsh(k, 9.1);
  let d = A * Math.max(0, Math.min(1, 1 - (cb - y) / L));
  let tint = [1, 1.04, 1.12];
  for (const f of stains) {
    const w = Math.max(0, 1 - Math.abs(s - f.s) / f.w);
    if (!w || y > f.y0 + 0.05) continue;
    const e = f.A * w * (y > 0.95 ? 1 : 0.5);
    if (e > d) { d = e; tint = f.tint; }
  }
  c = c.map((q, j) => q * wob * Math.max(0.25, 1 - d * tint[j]));
  return c;
}

// ---- one wall segment ----------------------------------------------------------------------------------------------
// A, B: { x, z (the face line, world), nx, nz (seaward, unit), top (the coping's top), foot, walk (the ground behind the
// coping, for its back face), s (metres along the wall) }; o: { kind, rail, cope (coping depth), pave (paving band width
// behind the coping, at walk + 0.03), capW + capY (a shore wall's cap band: paved from the coping to capW), esp
// (lamps and benches), fender (fender piles allowed), seed }
export function swSegment(tile, A, B, o) {
  const K = kitOf(tile), m = o.kind === 'concrete' ? 'concrete' : 'granite';
  const L = Math.hypot(B.x - A.x, B.z - A.z);
  if (L < 0.05) return;
  K.st.segs++; K.st.m += L; K.st[m] += L;
  const tx = (B.x - A.x) / L, tz = (B.z - A.z) / L;
  const P = (t) => { const nx = lerp(A.nx, B.nx, t), nz = lerp(A.nz, B.nz, t), nl = Math.hypot(nx, nz) || 1; return { x: lerp(A.x, B.x, t), z: lerp(A.z, B.z, t), nx: nx / nl, nz: nz / nl, top: lerp(A.top, B.top, t), foot: lerp(A.foot, B.foot, t), walk: lerp(A.walk, B.walk, t), s: lerp(A.s, B.s, t), capW: o.capW ? lerp(o.capW[0], o.capW[1], t) : 0, capY: o.capY ? lerp(o.capY[0], o.capY[1], t) : 0 }; };
  const at = (p, off, y) => [p.x + p.nx * off, y, p.z + p.nz * off];
  const tAt = (s) => (s - A.s) / (B.s - A.s || 1);
  const seed = o.seed || 0;
  // features first (their stains go into the face's colours)
  const stains = [], feats = [];
  const every = (step, ph, fn) => { for (let k = Math.ceil((Math.min(A.s, B.s) + ph) / step); k * step - ph < Math.max(A.s, B.s); k++) fn(k * step - ph, k); };
  every(75, 31 + seed, (s, k) => { if (hsh(k, 41 + seed) > 0.3) { feats.push(['ladder', s]); stains.push({ s, w: 0.9, y0: P(tAt(s)).top - COPE_H, A: 0.3, tint: [0.9, 1.1, 1.35] }); } });
  every(130, 67 + seed, (s, k) => { if (hsh(k, 53 + seed) > 0.35) { const yo = 0.55 + 0.6 * hsh(k, 7); feats.push(['outfall', s, yo]); stains.push({ s, w: 1.1, y0: yo, A: 0.55, tint: [1, 1.12, 1.3] }); } });
  // the face: sub-steps of a metre or less, rows at the weathering's heights
  const n = Math.max(1, Math.ceil(L / 1.0)), fb = bin(K, m);
  const rowsOf = (p) => { const cb = p.top - COPE_H, r = [p.foot, -0.25, 0.1, 0.45, 0.8, 0.95, 1.08, 1.35, 2.2, Math.max(2.3, (2.2 + cb) / 2), cb]; for (let i = 1; i < r.length; i++) r[i] = Math.min(Math.max(r[i], r[i - 1]), cb); return r; };
  for (let j = 0; j < n; j++) {
    const p0 = P(j / n), p1 = P((j + 1) / n), r0 = rowsOf(p0), r1 = rowsOf(p1), sz = SIZE[m];
    const nrm = [(p0.nx + p1.nx) / 2, 0, (p0.nz + p1.nz) / 2];
    for (let r = 0; r + 1 < r0.length; r++) {
      if (r0[r + 1] - r0[r] < 1e-3 && r1[r + 1] - r1[r] < 1e-3) continue;
      const a = at(p0, 0, r0[r]), b = at(p1, 0, r1[r]), c = at(p1, 0, r1[r + 1]), d = at(p0, 0, r0[r + 1]);
      const cb0 = p0.top - COPE_H, cb1 = p1.top - COPE_H;
      fb.quad(a, b, c, d, nrm, [wallCol(m, p0.s, r0[r], cb0, stains), wallCol(m, p1.s, r1[r], cb1, stains), wallCol(m, p1.s, r1[r + 1], cb1, stains), wallCol(m, p0.s, r0[r + 1], cb0, stains)],
        fuv(m, p0.s, r0[r]), fuv(m, p1.s, r1[r]), fuv(m, p1.s, r1[r + 1]), fuv(m, p0.s, r0[r + 1]));
    }
  }
  // the coping: granite stones of 1.8 m (concrete: 6 m pours), 6 mm open joints, projecting over the face
  const cs = m === 'granite' ? 1.8 : 6.0, cope = o.cope || 0.75, cbin = bin(K, m === 'granite' ? 'coping' : 'capc');
  const s0 = Math.min(A.s, B.s), s1 = Math.max(A.s, B.s);
  for (let k = Math.floor(s0 / cs); k * cs < s1; k++) {
    let a = Math.max(s0, k * cs + 0.003), b = Math.min(s1, (k + 1) * cs - 0.003);
    if (b - a < 0.02) continue;
    const tone = 0.9 + 0.18 * hsh(k, 11 + seed), base = m === 'granite' ? [0.78 * tone, 0.765 * tone, 0.735 * tone] : [0.7 * tone, 0.69 * tone, 0.665 * tone];
    const ns = Math.max(1, Math.ceil((b - a) / 1.0));
    for (let j = 0; j < ns; j++) {
      const q0 = P(tAt(lerp(a, b, j / ns))), q1 = P(tAt(lerp(a, b, (j + 1) / ns))), sz = SIZE[m === 'granite' ? 'coping' : 'capc'];
      const up = [0, 1, 0], sea = [(q0.nx + q1.nx) / 2, 0, (q0.nz + q1.nz) / 2], land = [-sea[0], 0, -sea[2]];
      const dk = mul(base, [0.92, 0.92, 0.92]);
      cbin.quad(at(q0, PROJ, q0.top), at(q1, PROJ, q1.top), at(q1, -cope, q1.top), at(q0, -cope, q0.top), up, base, [q0.s / sz, -PROJ / sz], [q1.s / sz, -PROJ / sz], [q1.s / sz, cope / sz], [q0.s / sz, cope / sz]);
      cbin.quad(at(q0, PROJ, q0.top - COPE_H), at(q1, PROJ, q1.top - COPE_H), at(q1, PROJ, q1.top), at(q0, PROJ, q0.top), sea, [dk, dk, base, base], [q0.s / sz, (q0.top - COPE_H) / sz], [q1.s / sz, (q1.top - COPE_H) / sz], [q1.s / sz, q1.top / sz], [q0.s / sz, q0.top / sz]);
      cbin.quad(at(q0, 0, q0.top - COPE_H), at(q1, 0, q1.top - COPE_H), at(q1, PROJ, q1.top - COPE_H), at(q0, PROJ, q0.top - COPE_H), [0, -1, 0], mul(base, [0.6, 0.6, 0.6]));
      const wb0 = Math.min(q0.walk, q0.top - 0.05), wb1 = Math.min(q1.walk, q1.top - 0.05);
      cbin.quad(at(q0, -cope, wb0), at(q1, -cope, wb1), at(q1, -cope, q1.top), at(q0, -cope, q0.top), land, [dk, dk, base, base], [q0.s / sz, wb0 / sz], [q1.s / sz, wb1 / sz], [q1.s / sz, q1.top / sz], [q0.s / sz, q0.top / sz]);
    }
    // (the stone's end faces, in its joints)
    for (const [sv, sg] of [[a, -1], [b, 1]]) {
      const q = P(tAt(sv)), e = [tx * sg, 0, tz * sg];
      cbin.quad(at(q, PROJ, q.top - COPE_H), at(q, -cope, q.top - COPE_H), at(q, -cope, q.top), at(q, PROJ, q.top), e, mul(base, [0.55, 0.55, 0.55]));
    }
  }
  // a shore wall's cap band behind the coping (paved), its skirt into the land
  if (o.capW) for (let j = 0; j < n; j++) {
    const p0 = P(j / n), p1 = P((j + 1) / n), land = [-(p0.nx + p1.nx) / 2, 0, -(p0.nz + p1.nz) / 2];
    if (p0.capW > cope + 0.15 || p1.capW > cope + 0.15) {
      const w0 = Math.max(cope, p0.capW), w1 = Math.max(cope, p1.capW), pb = bin(K, m === 'granite' ? 'paving' : 'capc'), sz = SIZE[m === 'granite' ? 'paving' : 'capc'];
      const col = m === 'granite' ? [0.7, 0.69, 0.66] : [0.62, 0.61, 0.59];
      pb.quad(at(p0, -cope, p0.capY), at(p1, -cope, p1.capY), at(p1, -w1, p1.capY), at(p0, -w0, p0.capY), [0, 1, 0], col, [p0.s / sz, cope / sz], [p1.s / sz, cope / sz], [p1.s / sz, w1 / sz], [p0.s / sz, w0 / sz]);
    }
    const w0 = Math.max(cope, p0.capW), w1 = Math.max(cope, p1.capW), kb = bin(K, 'concrete');
    kb.quad(at(p0, -w0, p0.capY - 1.6), at(p1, -w1, p1.capY - 1.6), at(p1, -w1, p1.capY), at(p0, -w0, p0.capY), land, [0.55, 0.54, 0.52], fuv('concrete', p0.s, p0.capY - 1.6), fuv('concrete', p1.s, p1.capY - 1.6), fuv('concrete', p1.s, p1.capY), fuv('concrete', p0.s, p0.capY));
  }
  // esplanade paving behind the coping
  if (o.pave) for (let j = 0; j < n; j++) {
    const p0 = P(j / n), p1 = P((j + 1) / n), pb = bin(K, 'paving'), sz = SIZE.paving, w = cope + o.pave;
    pb.quad(at(p0, -cope, p0.walk + 0.03), at(p1, -cope, p1.walk + 0.03), at(p1, -w, p1.walk + 0.03), at(p0, -w, p0.walk + 0.03), [0, 1, 0], [0.7, 0.69, 0.66],
      [p0.s / sz, cope / sz], [p1.s / sz, cope / sz], [p1.s / sz, w / sz], [p0.s / sz, w / sz]);
  }
  // the rail on the coping, 0.3 m in from the face
  if (o.rail) {
    const RO = -0.3, iron = o.rail === 'iron', rb = bin(K, iron ? 'iron' : 'steel'), col = iron ? [0.035, 0.037, 0.04] : [0.55, 0.57, 0.58];
    for (let j = 0; j < n; j++) {
      const p0 = P(j / n), p1 = P((j + 1) / n), a0 = at(p0, RO, 0), a1 = at(p1, RO, 0), l = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
      if (l < 1e-3) continue;
      const ux = (a1[0] - a0[0]) / l, uz = (a1[2] - a0[2]) / l, cx = (a0[0] + a1[0]) / 2, cz = (a0[2] + a1[2]) / 2, ty = (p0.top + p1.top) / 2;
      if (iron) {
        rb.obox(cx, ty + 1.0, cz, ux, uz, l + 0.004, 0.06, 0.075, col);    // top rail
        rb.obox(cx, ty + 0.1, cz, ux, uz, l + 0.004, 0.04, 0.05, col);     // bottom rail
      } else for (const h of [0.53, 1.05]) rb.cyl([a0[0], p0.top + h, a0[2]], [a1[0], p1.top + h, a1[2]], 0.024, col, 8);
    }
    const post = iron ? 2.4 : 1.8;
    every(post, 0, (s) => { const p = P(tAt(s)), q = at(p, RO, 0); if (iron) { rb.obox(q[0], p.top, q[2], tx, tz, 0.08, 1.12, 0.08, col); rb.obox(q[0], p.top + 1.12, q[2], tx, tz, 0.11, 0.05, 0.11, col); } else rb.cyl([q[0], p.top, q[2]], [q[0], p.top + 1.08, q[2]], 0.026, col, 8, 1, true); });
    if (iron) every(0.125, 0, (s) => { const p = P(tAt(s)), q = at(p, RO, 0); rb.obox(q[0], p.top + 0.1, q[2], tx, tz, 0.018, 0.92, 0.018, col); });
  }
  // ladders, outfalls
  for (const f of feats) {
    const p = P(tAt(f[1]));
    if (f[0] === 'ladder') {
      K.st.ladders++;
      const sb = bin(K, 'steel'), col = [0.42, 0.4, 0.37], yT = p.top - COPE_H - 0.02, yB = -1.6, off = 0.15;
      for (const sd of [-0.23, 0.23]) {
        const x = p.x + tx * sd + p.nx * off, z = p.z + tz * sd + p.nz * off;
        sb.obox(x, yB, z, p.nx, p.nz, 0.06, yT - yB, 0.018, col);
        for (let y = yT - 0.3; y > yB; y -= 1.2) sb.obox(p.x + tx * sd + p.nx * off * 0.5, y, p.z + tz * sd + p.nz * off * 0.5, p.nx, p.nz, off, 0.05, 0.016, col);
      }
      for (let y = yT - 0.15; y > yB + 0.1; y -= 0.3) sb.cyl([p.x - tx * 0.23 + p.nx * off, y, p.z - tz * 0.23 + p.nz * off], [p.x + tx * 0.23 + p.nx * off, y, p.z + tz * 0.23 + p.nz * off], 0.016, col, 6);
    } else {
      K.st.outfalls++;
      const yo = f[2], r = 0.42, pb = bin(K, m === 'granite' ? 'coping' : 'capc'), col = [0.45, 0.44, 0.4];
      pb.cyl([p.x - p.nx * 0.05, yo, p.z - p.nz * 0.05], [p.x + p.nx * 0.22, yo, p.z + p.nz * 0.22], r, col, 12, 1.8);
      const db = bin(K, 'dark'), cc = [p.x + p.nx * 0.03, yo, p.z + p.nz * 0.03];
      for (let k = 0; k < 12; k++) {
        const t0 = (k / 12) * Math.PI * 2, t1 = ((k + 1) / 12) * Math.PI * 2, R = r * 0.98;
        const q0 = [cc[0] + tx * Math.cos(t0) * R, yo + Math.sin(t0) * R, cc[2] + tz * Math.cos(t0) * R], q1 = [cc[0] + tx * Math.cos(t1) * R, yo + Math.sin(t1) * R, cc[2] + tz * Math.cos(t1) * R];
        db.v(cc, [p.nx, 0, p.nz], [0, 0], [0.02, 0.02, 0.02]); db.v(q0, [p.nx, 0, p.nz], [0, 0], [0.02, 0.02, 0.02]); db.v(q1, [p.nx, 0, p.nz], [0, 0], [0.02, 0.02, 0.02]);
      }
    }
  }
  // fender piles and their wale (concrete bulkheads, on stretches)
  if (o.fender && m === 'concrete') {
    const tb = bin(K, 'timber'), pc = [0.32, 0.29, 0.26];
    let any = false;
    every(3.2, 0.7, (s, k) => { if (hsh(Math.floor(s / 60), 61 + seed) > 0.45) return; const p = P(tAt(s)); tb.cyl([p.x + p.nx * 0.24, -2.6, p.z + p.nz * 0.24], [p.x + p.nx * 0.24, p.top - 0.12, p.z + p.nz * 0.24], 0.17, pc, 8, SIZE.timber, true); K.st.fenders++; any = true; });
    if (any || hsh(Math.floor(A.s / 60), 61 + seed) <= 0.45) for (let j = 0; j < n; j++) {
      const p0 = P(j / n), p1 = P((j + 1) / n);
      if (hsh(Math.floor(p0.s / 60), 61 + seed) > 0.45) continue;
      const a0 = at(p0, 0.5, 0), a1 = at(p1, 0.5, 0), l = Math.hypot(a1[0] - a0[0], a1[2] - a0[2]);
      if (l > 1e-3) tb.obox((a0[0] + a1[0]) / 2, (p0.top + p1.top) / 2 - 0.75, (a0[2] + a1[2]) / 2, (a1[0] - a0[0]) / l, (a1[2] - a0[2]) / l, l + 0.01, 0.3, 0.25, pc, SIZE.timber);
    }
  }
  // the esplanade's lamps and benches
  if (o.esp) {
    const ib = bin(K, 'iron'), col = [0.03, 0.035, 0.032], wood = bin(K, 'timber'), wc = [0.55, 0.42, 0.3];
    every(30, 7 + seed, (s) => {
      const p = P(tAt(s)), q = at(p, -(cope + 0.55), 0), y = p.walk + (o.pave ? 0.03 : 0);
      if (o.capW && p.capW < cope + 1.9) return;   // (on a shore wall's cap band only where it is wide)
      ib.cyl([q[0], y, q[2]], [q[0], y + 0.9, q[2]], 0.17, col, 10, 1, false, 0.12);
      ib.cyl([q[0], y + 0.9, q[2]], [q[0], y + 3.9, q[2]], 0.075, col, 8, 1, false, 0.055);
      ib.cyl([q[0], y + 3.9, q[2]], [q[0], y + 4.0, q[2]], 0.13, col, 8, 1, true);
      bin(K, 'globe').cyl([q[0], y + 4.0, q[2]], [q[0], y + 4.55, q[2]], 0.2, [0.92, 0.9, 0.84], 10, 1, true, 0.16);
      ib.cyl([q[0], y + 4.55, q[2]], [q[0], y + 4.68, q[2]], 0.17, col, 8, 1, true, 0.04);
      K.st.lamps++;
    });
    every(30, 22 + seed, (s) => {
      const p = P(tAt(s)), off = -(cope + 1.25), q = at(p, off, 0), y = p.walk + (o.pave ? 0.03 : 0);
      if (o.capW && p.capW < cope + 1.9) return;
      // (facing the water: the seat 0.45 m, the back on the land side)
      const lx = q[0] - p.nx * 0.18, lz = q[2] - p.nz * 0.18;
      for (const sl of [-0.15, 0, 0.15]) wood.obox(q[0] + p.nx * sl, y + 0.43, q[2] + p.nz * sl, tx, tz, 1.8, 0.04, 0.11, wc, SIZE.timber);
      for (const h of [0.6, 0.75]) wood.obox(lx - p.nx * 0.08, y + h, lz - p.nz * 0.08, tx, tz, 1.8, 0.1, 0.035, wc, SIZE.timber);
      for (const e of [-0.8, 0.8]) { ib.obox(q[0] + tx * e, y, q[2] + tz * e, p.nx, p.nz, 0.5, 0.43, 0.05, col); ib.obox(lx + tx * e - p.nx * 0.08, y, lz + tz * e - p.nz * 0.08, p.nx, p.nz, 0.05, 0.88, 0.05, col); }
      K.st.benches++;
    });
  }
}

// ---- the swept shore walls: out of the curb soup, kept as runs ----------------------------------------------------
function index(a) {
  const B = new Map();
  for (let i = 0; i + 8 < a.length; i += 9) {
    const i0 = Math.floor(Math.min(a[i], a[i + 3], a[i + 6]) / 4), i1 = Math.floor(Math.max(a[i], a[i + 3], a[i + 6]) / 4);
    const j0 = Math.floor(Math.min(a[i + 2], a[i + 5], a[i + 8]) / 4), j1 = Math.floor(Math.max(a[i + 2], a[i + 5], a[i + 8]) / 4);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 4096) continue;
    for (let j = j0; j <= j1; j++) for (let k = i0; k <= i1; k++) { const q = j * 4096 + k; let l = B.get(q); if (!l) B.set(q, (l = [])); l.push(i); }
  }
  return B;
}
function hitIn(a, B, x, z) {
  const l = B.get(Math.floor(z / 4) * 4096 + Math.floor(x / 4));
  if (!l) return false;
  for (const i of l) {
    const ax = a[i], az = a[i + 2], bx = a[i + 3], bz = a[i + 5], cx = a[i + 6], cz = a[i + 8];
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-9) continue;
    const w0 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d, w1 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    if (w0 >= -1e-4 && w1 >= -1e-4 && 1 - w0 - w1 >= -1e-4) return true;
  }
  return false;
}
function piecesOut(tile, ox, oz, K, slab) {
  if (!tile.S.curb || tile.S.curb.length < 9) return;
  // the compile's other bulkhead pieces left in the curb soup (walls of the land's thin strips and aprons that never reach
  // under the water, so the sweep did not take them): a vertical face with the water on one side and land on the other,
  // its foot under 2 m, is drawn in the concrete face (the height atlas, its water marks) instead of the kerbs' beige
  const wat = (x, z) => { const q = haInfo(x, z); return !q || q.tag >= 3; };
  const cc = tile.S.curb, keep = new Float32Array(cc.length), fb = bin(K, 'concrete');
  let nk = 0, moved = 0;
  for (let i = 0; i + 8 < cc.length; i += 9) {
    const A = [cc[i], cc[i + 1], cc[i + 2]], B = [cc[i + 3], cc[i + 4], cc[i + 5]], C = [cc[i + 6], cc[i + 7], cc[i + 8]];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]], l = Math.hypot(...n), h = Math.hypot(n[0], n[2]);
    let mv = false;
    if (l > 1e-6 && Math.abs(n[1]) / l < 0.2 && Math.min(A[1], B[1], C[1]) < 2.0) {
      const nx = n[0] / h, nz = n[2] / h, cx = (A[0] + B[0] + C[0]) / 3 + ox, cz = (A[2] + B[2] + C[2]) / 3 + oz;
      const wf = wat(cx + nx * 2, cz + nz * 2), wb = wat(cx - nx * 2, cz - nz * 2);
      if ((wf !== wb || (wf && wb)) && !(slab && slab(cx, cz))) {   // (water on one side, or a land strip's wall standing in the water)
        const sg = wf && wb ? 1 : wf ? 1 : -1, tx = -nz * sg, tz = nx * sg, want = [nx * sg, 0, nz * sg];
        const uv = (p) => fuv('concrete', (p[0] + ox) * tx + (p[2] + oz) * tz, p[1]), w = (p) => [p[0] + ox, p[1], p[2] + oz];
        const col = [0.88, 0.87, 0.85];
        if (sg > 0) { fb.v(w(A), want, uv(A), col); fb.v(w(B), want, uv(B), col); fb.v(w(C), want, uv(C), col); }
        else { fb.v(w(A), want, uv(A), col); fb.v(w(C), want, uv(C), col); fb.v(w(B), want, uv(B), col); }
        mv = true; moved++;
      }
    }
    if (!mv && l > 1e-6 && n[1] / l > 0.8) {   // (a strip's flat top over the water: the concrete cap)
      const cx = (A[0] + B[0] + C[0]) / 3 + ox, cz = (A[2] + B[2] + C[2]) / 3 + oz;
      if (wat(cx, cz) && !(slab && slab(cx, cz))) {
        const cb = bin(K, 'capc'), col = [0.6, 0.59, 0.57], w = (p) => [p[0] + ox, p[1], p[2] + oz], uv = (p) => [(p[0] + ox) / SIZE.capc, (p[2] + oz) / SIZE.capc];
        cb.v(w(A), [0, 1, 0], uv(A), col); cb.v(w(B), [0, 1, 0], uv(B), col); cb.v(w(C), [0, 1, 0], uv(C), col);
        mv = true; moved++;
      }
    }
    if (!mv) { for (let k = 0; k < 9; k++) keep[nk + k] = cc[i + k]; nk += 9; }
  }
  if (moved) tile.S.curb = keep.slice(0, nk);
  K.st.piecesOut = moved;
}
// after haClampGround (the walls' last raise): the swept walls' triangles leave the curb soup; each segment (54 vertices:
// face, cap, skirt) becomes a kit segment, the run's kind from the land behind it
export function seawallExtract(tile, ox, oz) {
  const P = tile.p1Shore, c = tile.S.curb;
  if (!SEAWALL) return null;
  if (!P || !c || c.length < (P.off + P.n) * 3 || c[P.off * 3] !== Math.fround(P.x0) || c[P.off * 3 + 1] !== Math.fround(P.y0) || P.n % 54) { piecesOut(tile, ox, oz, kitOf(tile), marinaSlabHit(ox, oz)); return null; }
  const segs = [];
  for (let v = 0; v + 53 < P.n; v += 54) {
    const b = (P.off + v) * 3, g = (k) => [c[b + 3 * k], c[b + 3 * k + 1], c[b + 3 * k + 2]];
    segs.push({ f0: g(0), f1: g(1), b1: g(2), b0: g(5), c0: g(18), c1: g(19), u: P.vst[v], w: P.vst[v + 1] });
  }
  const m = new Float32Array(c.length - P.n * 3);
  m.set(c.subarray(0, P.off * 3)); m.set(c.subarray((P.off + P.n) * 3), P.off * 3);
  tile.S.curb = m;
  tile.p1Shore = null;
  // the land 2.5 m behind the cap: walks, lawns or neither
  const S = tile.S, idx = (ns) => ns.filter((k) => S[k] && S[k].length >= 9).map((k) => [S[k], index(S[k])]);
  const WALK = idx(['sidewalk', 'path', 'plaza', 'brick', 'gravel']), LAWN = idx(['grass', 'grassU']);
  const kindAt = (x, z) => (WALK.some(([a, B]) => hitIn(a, B, x, z)) ? 2 : LAWN.some(([a, B]) => hitIn(a, B, x, z)) ? 1 : 0);
  const slab = marinaSlabHit(ox, oz);
  // runs: consecutive segments sharing a station
  const runs = [];
  for (const g of segs) { const r = runs[runs.length - 1]; if (r && r[r.length - 1].w === g.u) r.push(g); else runs.push([g]); }
  const K = kitOf(tile), out = [];
  for (const r of runs) {
    let walk = 0, lawn = 0, nS = 0;
    for (let i = 0; i < r.length; i += 3) {
      const st = r[i].u, x = P.stn[6 * st] + P.stn[6 * st + 2] * 2.5 - ox, z = P.stn[6 * st + 1] + P.stn[6 * st + 3] * 2.5 - oz, k = kindAt(x, z);
      nS++; if (k === 2) walk++; else if (k === 1) lawn++;
    }
    const kind = (walk + lawn) / nS >= 0.5 ? 'granite' : 'concrete', rail = kind === 'granite' ? 'iron' : walk / nS >= 0.25 ? 'pipe' : null;
    const r0 = r[0].f0, s0 = 1000 * hsh(Math.floor((r0[0] + ox) / 50), Math.floor((r0[2] + oz) / 50));
    let s = s0;
    const pts = [];
    for (const g of r) {
      const len = Math.hypot(g.f1[0] - g.f0[0], g.f1[2] - g.f0[2]);
      const mk = (f, bq, cq, st, sv) => { const nx = -P.stn[6 * st + 2], nz = -P.stn[6 * st + 3]; return { x: f[0] + ox, z: f[2] + oz, nx, nz, top: f[1], foot: bq[1], walk: cq[1], s: sv, capW: Math.hypot(cq[0] - f[0], cq[2] - f[2]), capY: cq[1] }; };
      const drop = slab && slab((g.f0[0] + g.f1[0]) / 2 + ox, (g.f0[2] + g.f1[2]) / 2 + oz);
      pts.push([mk(g.f0, g.b0, g.c0, g.u, s), mk(g.f1, g.b1, g.c1, g.w, s + len), drop]);
      s += len;
    }
    out.push({ kind, rail, pts, wide: pts.filter((p) => p[0].capW >= 2.6).length / pts.length });
  }
  K.st.shoreOut = segs.length;
  K.shore = out;
  piecesOut(tile, ox, oz, K, slab);
  return { segs: segs.length, runs: out.length };
}

// ---- piers on piles (wshCoast's kept solid decks) ------------------------------------------------------------------
// ring: the pier's outline (world); deckTris: its owned deck triangles (tile-local, y = the deck); own(x, z): the tile owns it
export function swPier(tile, ring, deckTris, y, ox, oz, own, skipEdge) {
  const K = kitOf(tile);
  K.st.piers++;
  const db = bin(K, 'pierdeck'), sb = bin(K, 'soffit'), pc = [0.55, 0.54, 0.52], sz = SIZE.concrete;
  for (let i = 0; i + 8 < deckTris.length; i += 9) {
    const A = [deckTris[i] + ox, y, deckTris[i + 2] + oz], B = [deckTris[i + 3] + ox, y, deckTris[i + 5] + oz], C = [deckTris[i + 6] + ox, y, deckTris[i + 8] + oz];
    const uv = (p) => [p[0] / sz, p[2] / sz];
    db.v(A, [0, 1, 0], uv(A), pc); db.v(B, [0, 1, 0], uv(B), pc); db.v(C, [0, 1, 0], uv(C), pc);
    const yb = y - 0.6;
    sb.v([A[0], yb, A[2]], [0, -1, 0], uv(A), [0.3, 0.3, 0.29]); sb.v([C[0], yb, C[2]], [0, -1, 0], uv(C), [0.3, 0.3, 0.29]); sb.v([B[0], yb, B[2]], [0, -1, 0], uv(B), [0.3, 0.3, 0.29]);
  }
  // the outline's orientation: outward normals
  let ar = 0; for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; ar += a[0] * b[1] - b[0] * a[1]; }
  const sg = ar > 0 ? 1 : -1, cb = bin(K, 'concrete'), tb = bin(K, 'timber'), rb = bin(K, 'steel');
  const water = (x, z) => { const q = haInfo(x, z); return !q || q.tag >= 3; };
  let sAcc = 0;
  for (let k = 0; k + 1 < ring.length; k++) {
    const a = ring[k], b = ring[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 0.05) { continue; }
    const s0 = sAcc; sAcc += L;
    if (!own((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) || skipEdge(a, b)) continue;
    const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L, nx = tz * sg, nz = -tx * sg;   // (outward)
    const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, wet = water(mx + nx * 2, mz + nz * 2);
    // the deck's edge: 0.6 m of concrete
    cb.quad([a[0], y - 0.6, a[1]], [b[0], y - 0.6, b[1]], [b[0], y + 0.02, b[1]], [a[0], y + 0.02, a[1]], [nx, 0, nz], [0.62, 0.61, 0.59], fuv('concrete', s0, y - 0.6), fuv('concrete', s0 + L, y - 0.6), fuv('concrete', s0 + L, y + 0.02), fuv('concrete', s0, y + 0.02));
    if (!wet) continue;
    // piles under the edge (0.9 m in, every 4.5 m), fender piles outside it (every 3.2 m), a pipe rail on it
    for (let t = (4.5 - (s0 % 4.5)) % 4.5; t < L; t += 4.5) { const x = a[0] + tx * t - nx * 0.9, z = a[1] + tz * t - nz * 0.9; cb.cyl([x, ATL.concrete.y0, z], [x, y - 0.6, z], 0.26, [0.7, 0.69, 0.66], 8, ATL.concrete.h); K.st.piles++; }
    for (let t = (3.2 - (s0 % 3.2)) % 3.2; t < L; t += 3.2) { const x = a[0] + tx * t + nx * 0.2, z = a[1] + tz * t + nz * 0.2; tb.cyl([x, -2.6, z], [x, y - 0.05, z], 0.16, [0.3, 0.27, 0.24], 8, SIZE.timber, true); K.st.fenders++; }
    const p0 = [a[0] - nx * 0.15, a[1] - nz * 0.15], p1 = [b[0] - nx * 0.15, b[1] - nz * 0.15], col = [0.55, 0.57, 0.58];
    for (const h of [0.53, 1.05]) rb.cyl([p0[0], y + h, p0[1]], [p1[0], y + h, p1[1]], 0.024, col, 8);
    for (let t = (1.8 - (s0 % 1.8)) % 1.8; t < L; t += 1.8) rb.cyl([p0[0] + tx * t, y, p0[1] + tz * t], [p0[0] + tx * t, y + 1.08, p0[1] + tz * t], 0.026, col, 8, 1, true);
  }
  // the pile grid inside (6 m, 1.5 m or more in from the outline)
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const inR = (x, z) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const p = ring[i], q = ring[j]; if ((p[1] > z) !== (q[1] > z) && x < ((q[0] - p[0]) * (z - p[1])) / (q[1] - p[1]) + p[0]) c = !c; } return c; };
  const dEdge = (x, z) => { let d = Infinity; for (let k = 0; k + 1 < ring.length; k++) { const a = ring[k], b = ring[k + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz || 1e-9, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)); d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); } return d; };
  for (let x = Math.ceil(x0 / 6) * 6; x < x1; x += 6) for (let z = Math.ceil(z0 / 6) * 6; z < z1; z += 6) {
    if (!own(x, z) || !inR(x, z) || dEdge(x, z) < 1.5 || !water(x, z)) continue;
    cb.cyl([x, ATL.concrete.y0, z], [x, y - 0.6, z], 0.26, [0.66, 0.65, 0.62], 8, ATL.concrete.h); K.st.piles++;
  }
}

// ---- the tile's meshes ---------------------------------------------------------------------------------------------
export function buildSeawall(group, tile) {
  const K = tile.__sw;
  if (!K) return null;
  // the swept shore walls' runs
  if (K.shore) {
    for (const r of K.shore) {
      const esp = r.kind === 'granite' && r.wide >= 0.5;
      for (const [A, B, drop] of r.pts) {
        if (drop) continue;
        swSegment(tile, A, B, { kind: r.kind, rail: r.rail, cope: Math.min(0.75, Math.max(0.5, Math.min(A.capW, B.capW))), capW: [A.capW, B.capW], capY: [A.capY, B.capY], esp, fender: true, seed: 0 });
      }
    }
    K.shore = null;
  }
  const m = mats(), G = new THREE.Group(); G.name = 'seawall';
  for (const [k, b] of Object.entries(K.B)) { const me = b.mesh(m[k], k, k !== 'dark' && k !== 'paving' && k !== 'pierdeck'); if (me) G.add(me); }
  if (!G.children.length) return K.st;
  G.updateMatrixWorld(true);
  group.add(G);
  if (!isNode && (window.__SWM = window.__SWM || []).length < 8) window.__SWM.push(new WeakRef(G));   // (a probe's handle)
  K.B = {};
  return K.st;
}
