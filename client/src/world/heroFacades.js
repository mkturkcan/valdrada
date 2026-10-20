// Hero facade ring — real 3D architectural detail (window reveals, lintels, sills,
// frames, string courses, cornices, storefront kits) generated for buildings near
// the player, PR #33906-style, layered over the shader facades. The shader's glass
// cells stay visible through the holes and become the panes.
import * as THREE from 'three';
import { STYLE, BF } from '../shared/geo.js';
import { StaticPool } from './staticPool.js';
import { applyCityAO, wlHash } from './materials.js';   // WL11: the shared CPU/GPU-exact hash

// see assemble.js: `?nodatum=1` restores the pre-seam-pass datums for A/B plates
const NO_DATUM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nodatum') === '1';
const HERO_R = 255, DROP_R = 295, MAX_HERO = 110;
const DETAIL_R = 95; // full detail (frames/reveals/AC) inside this; simplified beyond
// LD13 (docs/notes/lod-r13.md) — ?ld13=0 restores the round-12 ring schedule. In THIS
// file: the per-frame hand-off sweep, the build TIME BUDGET, the atomic re-band and the
// band hysteresis. `let`, not `const`: `window.__LD13H_SET` flips it at runtime so one
// page can A/B the whole schedule against itself (scratchpad/probe_sim.js).
let LD13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('ld13') === '0');
// Band hysteresis. `a.band !== (d < DETAIL_R ? 0 : 1)` has NO hysteresis at all, so a
// building parked within a metre of 95 m re-bands on every rescan — 3 times a second,
// each time losing and regaining every reveal, bracket and downspout on it. 95 in / 112
// out is a 17 m dead zone, wider than the 22 m the ad's mBrownstone dolly covers in
// total, so no building in that take can cross the boundary twice.
const DETAIL_OUT = 112;
// LD13: build budget per frame (ms). The old loop built EXACTLY ONE building per frame
// and then returned, so a cold ring took MAX_HERO = 110 frames to fill and a dozen
// buildings re-banding in one rescan spent up to a dozen frames each with no trim.
// 2 ms is a third of the dresser's own 6 ms and roughly 12 % of a 60 fps frame.
const HERO_MS = 2.0;

class GBuf {
  constructor() { this.pos = []; this.nrm = []; this.col = []; }
  quad(a, b, c, d, n, col) {
    for (const p of [a, b, c, a, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]); this.col.push(col[0], col[1], col[2]); }
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

// ?fac8=0 restores the round-7 trim value + geometry (docs/notes/facades-r8.md §5)
const FAC8 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fac8') === '0');
// ?heroskip=win,fire,ledge,course,pier,base,arcade — attribution: drop one emitter group at a time
// (lead r8: `?hero=0` removes the Wall St per-floor band ladder, so it is one of these)
const HSKIP = new Set(((typeof location !== 'undefined' && new URLSearchParams(location.search).get('heroskip')) || '').split(',').filter(Boolean));
if (HSKIP.size) console.log('[hero] skipping emitter groups:', [...HSKIP].join(','));
// ?herocensus=1 — round-9 attribution instrument. Twelve elimination renders failed to
// name the Wall St band emitter because four of them silently lost the flag (their logs
// carry no `[hero] skipping` line) and because `heroskip=` of a single group can only
// clear a defect drawn by ONE group. This records, per `strip()` CALL SITE (taken from
// the stack, so no per-site tagging is needed), the member's height range, its width as
// a fraction of the wall, its outset, its colour and its vertical cadence — so ONE render
// names every full-width per-floor bright member and the record values that produced it.
const HCENSUS = typeof location !== 'undefined' && new URLSearchParams(location.search).get('herocensus') === '1';
// ?hero9=0 restores the round-8 hero trim exactly (docs/notes/materials-r9.md §1).
// Round 9 changes three things and nothing else:
//   1. the trim material goes through `applyCityAO`, like the shader facade it is
//      appliquéd onto — without it a trim member kept ALL of its ambient while the
//      wall beside it kept 0.32-0.45 of its own in a street canyon;
//   2. every wall-DERIVED member colour is taken from the wall's RENDERED value
//      (`pow(lum,1.22)*0.88`) instead of its raw one, so "wall * 0.62" means what
//      its author meant;
//   3. the base rustication band is gone — it was the Wall St ladder (§1.6) and the
//      shader already draws a rusticated water table on the same wall.
const HERO9 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('hero9') === '0');
// WL11 — ?wl11=0 restores the perfect lattice (docs/notes/lattice-r11.md). This ring is
// APPLIQUÉ over the tile facade shader, so its reveals, frames, sills and lintels have to
// land on the openings that shader draws: every number below is the same arithmetic the
// WL11 block in materials.js runs, on the same `wlHash`, which is an integer LCG chosen
// precisely because it returns the same value in a float32 GPU lane and in a JS double.
// If you change an amplitude or a seed here, change it THERE in the same edit.
const WL11 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wl11') === '0');
// WB13 (docs/notes/wburg-r13.md) — ?wb13=0 restores round-12 behaviour. In THIS file:
// the FRAME_HOUSE trim exclusions and the CONDO_NEW balcony. The projecting stone SILL
// at the bottom of the bay loop is UNCONDITIONAL — every hero building in the city gets
// one under every opening — and on a vinyl-sided house that is a limestone member
// appliquéd onto 1 mm of plastic, which is the "limestone sills on siding" defect the
// round-13 brief names. A sided house's opening is trimmed in FLAT white brickmold and
// a J-channel (docs/typology/08-vinyl-rowhouse.md §4): no projection worth the name,
// and never a stone colour.
const WB13 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('wb13') === '0');
// FD14 (docs/notes/fd14.md) — ?fd14=0 restores round-13 behaviour. In THIS file: the crown
// order (critic-r14 fix 7). The band and its modillions occupied the SAME 0.25 m of height,
// with the modillions projecting FURTHER (0.34 vs 0.32), so the brackets read as detached
// teeth rather than as the thing carrying a projecting cornice — the same defect the
// dresser had for a different reason (nycDress.js, the cornice yaw).
const FD14 = !(typeof location !== 'undefined' && new URLSearchParams(location.search).get('fd14') === '0');

export class HeroFacades {
  constructor(scene) {
    this.scene = scene;
    this.tiles = new Map();   // tileKey -> recs
    this.active = new Map();  // recKey -> {mesh}
    this.mat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.88, metalness: 0.0,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    // painted/iron hero parts pick up a semi-gloss: dark members (fire
    // escapes, door slabs, frames, storefront iron) read as painted metal,
    // light stone trim stays matte — luminance-driven, no new attributes
    this.mat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float heroLum = dot(vColor.rgb, vec3(0.35, 0.5, 0.15));
          roughnessFactor = ${HSKIP.has('gloss') ? '0.9' : 'mix(0.5, 0.92, smoothstep(0.02, 0.22, heroLum))'};
        }`);
    };
    this._acc = 1;
    this.queue = [];
    // every hero trim ring lives in ONE static mesh (was a draw call per building)
    this.cen = HCENSUS ? new Map() : null;   // call-site line -> member census (?herocensus=1)
    // main.js's window.__gtRefs carries only {traffic, peds}, so the instrument
    // publishes its own handle rather than needing an edit outside this file
    if (HCENSUS && typeof window !== 'undefined') window.__HERO = this;
    // HERO9 (1): the trim is appliqué over `makeFacadeMaterial`, which ends with
    // `applySpecAA(applyCityAO(mat))`. Leaving the trim outside applyCityAO gave every
    // member the full sky while the wall 5 cm behind it was multiplied by the baked
    // sky-visibility (cityAOAmt 0.85 -> 0.32-0.45 of ambient in a FiDi canyon), which is
    // the whole Wall St "white band ladder" and is independent of the trim's albedo.
    // One material, one draw call: this adds a varying and one texture fetch, no calls.
    if (HERO9) applyCityAO(this.mat);
    this.pool = new StaticPool(scene, this.mat, {
      attrs: { position: 3, normal: 3, color: 3 }, capVerts: 131072,
      castShadow: false, receiveShadow: true, name: 'heroes',
    });
    // LD13 (docs/notes/lod-r13.md): read-only handle for the offline probes — this ring
    // carries the FULL `heroRecs` list (the dresser's `tiles` holds only the dressable
    // subset), so it is the only place a harness can ask what every record near the
    // camera is and which layer is drawing it. `__LD13H_SET` is the runtime A/B switch;
    // both it and nycDress's `__LD13_SET` must be flipped together.
    if (typeof window !== 'undefined') {
      window.__LD13H = this;
      window.__LD13H_SET = (v) => { LD13 = !!v; return LD13; };
    }
  }
  setTile(key, recs) { this.tiles.set(key, recs); }
  removeTile(key) {
    const recs = this.tiles.get(key) || [];
    for (const r of recs) this._drop(r.key);
    this.tiles.delete(key);
  }
  _drop(k) {
    const a = this.active.get(k);
    if (!a) return;
    if (a.h) this.pool.free(a.h);
    this.active.delete(k);
  }
  update(px, pz) {
    this._acc++;
    // LD13 (docs/notes/lod-r13.md): the hand-off to the NYC dresser used to be tested
    // ONLY inside the 20-frame rescan, so a building could keep its appliqué trim for up
    // to twenty frames after the dresser's kit wall landed on the same footprint — two
    // sets of sills and two cornices on one facade, at whatever depth each happened to
    // win. 110 map keys once a frame is free; the hand-off is now at most one frame wide
    // in BOTH directions (nycDress `owns()` closes the other half).
    if (LD13 && this.skip && this.active.size) {
      let doomed = null;
      for (const k of this.active.keys()) if (this.skip(k)) (doomed || (doomed = [])).push(k);
      if (doomed) for (const k of doomed) this._drop(k);
    }
    if (this.queue.length) {
      // LD13: a TIME BUDGET instead of exactly one building per frame, and an ATOMIC
      // re-band — the new mesh is built and allocated BEFORE the old handle is freed, so
      // a facade is never without one of its two versions. `?ld13=0` keeps the old
      // one-per-frame `return`, which is what the do/while degenerates to.
      const t0 = performance.now();
      do {
        const q = this.queue.shift();
        const rec = q.rec || q, want = q.band;
        const d = Math.hypot(rec.cx - px, rec.cz - pz);
        const band = want === undefined ? (d < DETAIL_R ? 0 : 1) : want;
        const prev = this.active.get(rec.key);
        const wanted = LD13 ? (!prev || prev.band !== band) : !prev;
        if (wanted && d < DROP_R && !(LD13 && this.skip && this.skip(rec.key))) {
          const mesh = this._build(rec, band);
          const h = mesh ? this.pool.alloc(mesh.geometry) : null;
          if (mesh) mesh.geometry.dispose();
          if (prev && prev.h) this.pool.free(prev.h);      // free LAST: no hole, ever
          this.active.set(rec.key, { h, rec, band });
        }
      } while (LD13 && this.queue.length && performance.now() - t0 < HERO_MS);
      return;
    }
    if (this._acc < 20) return; // rescan ~3x/sec
    this._acc = 0;
    const cands = [];
    // FP37 (core/engine.js, the film policy): while recording, the take's nearest approach places each building's ring and
    // band, so no trim is added, dropped or re-banded within a take
    const fp = typeof window !== 'undefined' && window.__FP37 && window.__FP37.pts ? window.__FP37 : null;
    const near = (x, z) => { let q = Infinity; for (let j = 0; j < fp.pts.length; j += 3) { const ax = x - fp.pts[j], az = z - fp.pts[j + 2]; q = Math.min(q, ax * ax + az * az); } return Math.sqrt(q); };
    for (const recs of this.tiles.values()) {
      for (const r of recs) {
        const d = fp ? near(r.cx, r.cz) : Math.hypot(r.cx - px, r.cz - pz);
        const a = this.active.get(r.key);
        // buildings rebuilt by the NYC dresser get no shader-layer trim
        if (this.skip && this.skip(r.key)) { if (a) this._drop(r.key); continue; }
        if (d < HERO_R && !a) cands.push({ r, d });
        else if (a && d > DROP_R) this._drop(r.key);
        // LD13: re-band with HYSTERESIS and WITHOUT a hole. The old line dropped the
        // handle here and queued the rebuild for a later frame, so the trim was gone in
        // between; and it had no dead zone, so a building sitting on 95 m re-banded on
        // every rescan. Now the band change is only REQUESTED — the builder above swaps
        // the mesh in one step — and a band-0 building has to reach DETAIL_OUT before it
        // simplifies, while a band-1 building has to come inside DETAIL_R before it
        // detailises.
        else if (a && LD13) {
          const want = a.band === 0 ? (d > DETAIL_OUT ? 1 : 0) : (d < DETAIL_R ? 0 : 1);
          if (want !== a.band) cands.push({ r, d, band: want });
        } else if (a && a.band !== (d < DETAIL_R ? 0 : 1)) { this._drop(r.key); cands.push({ r, d }); } // re-band
      }
    }
    cands.sort((a, b) => a.d - b.d);
    let room = MAX_HERO - this.active.size;
    // LD13: a re-band is not a new building — it already holds its slot, so `room` must
    // not starve it. Under ?ld13=0 every candidate has `band === undefined` and this is
    // the old `cands.slice(0, max(0, room))` exactly.
    for (const c of cands) {
      if (LD13 && c.band !== undefined) { this.queue.push({ rec: c.r, band: c.band }); continue; }
      if (room-- <= 0) break;
      this.queue.push(LD13 ? { rec: c.r } : c.r);
    }
  }
  // ---- ?herocensus=1 attribution instrument (no effect unless the flag is set)
  _cen(uA, uB, v0, v1, o, col, len, rec, P) {
    const m = String(new Error().stack || '').match(/heroFacades\.js:(\d+)/g) || [];
    const key = (m[2] || m[1] || m[0] || '?:0').split(':').pop();
    let e = this.cen.get(key);
    if (!e) this.cen.set(key, e = { n: 0, y0: 1e9, y1: -1e9, uf: 0, h: 0, o: 0, col: col.map((c) => +c.toFixed(3)), vs: [], sty: {}, seg: [] });
    e.n++;
    e.y0 = Math.min(e.y0, v0); e.y1 = Math.max(e.y1, v1);
    e.uf = Math.max(e.uf, (uB - uA) / Math.max(len, 0.01));
    e.h = Math.max(e.h, v1 - v0); e.o = Math.max(e.o, o);
    e.sty[rec.style] = (e.sty[rec.style] || 0) + 1;
    if (e.vs.length < 6000) e.vs.push(+v0.toFixed(2));
    // world-space segment down the member's centre line: lets an offline probe
    // project each member into an existing plate and MEASURE which one is the
    // bright rod, instead of guessing from cadence
    if (e.seg.length < 4000 && P) e.seg.push([P(uA, (v0 + v1) / 2, o + 0.01), P(uB, (v0 + v1) / 2, o + 0.01)]);
  }
  censusDump(minY = 0) {
    if (!this.cen) return 'census off (?herocensus=1)';
    const out = [];
    for (const [ln, e] of this.cen) {
      const v = [...new Set(e.vs)].sort((a, b) => a - b);
      const d = [];
      for (let i = 1; i < v.length; i++) if (v[i] - v[i - 1] > 0.01) d.push(+(v[i] - v[i - 1]).toFixed(2));
      d.sort((a, b) => a - b);
      const lum = +(e.col[0] * 0.4 + e.col[1] * 0.45 + e.col[2] * 0.15).toFixed(3);
      if (e.y1 < minY) continue;
      out.push({ ln: +ln, n: e.n, y: [+e.y0.toFixed(1), +e.y1.toFixed(1)], uf: +e.uf.toFixed(2), h: +e.h.toFixed(2), o: +e.o.toFixed(2), lum, col: e.col, cadMed: d.length ? d[d.length >> 1] : null, sty: e.sty });
    }
    out.sort((a, b) => b.n - a.n);
    return out;
  }
  _build(rec, band = 0) {
    const fine = band === 0; // thin members only when they'll span ≥ ~2px
    const buf = new GBuf();
    const S = rec.style;
    const glassy = S === STYLE.MODERN_GLASS || S === STYLE.GLASS_TOWER_BLUE;
    const loft = S === STYLE.LOFT_CASTIRON || S === STYLE.INDUSTRIAL;
    // WB13: these four MUST mirror the shader's x0/x1/y0/y1 (materials.js, the
    // `if (sidingS)` / `if (condoS)` lines beside glassStyle/loftStyle) — this class is
    // an APPLIQUÉ over the shader facade, so a reveal or a frame drawn at 0.2 of a bay
    // over an opening the shader punched at 0.30 sits 0.24 m to one side of its own
    // hole. Same requirement the WL11 lattice notes are built around.
    const frame13 = WB13 && S === STYLE.FRAME_HOUSE, condo13 = WB13 && S === STYLE.CONDO_NEW;
    const x0f = glassy ? 0.05 : loft ? 0.1 : frame13 ? 0.30 : condo13 ? 0.10 : 0.2;
    const x1f = glassy ? 0.95 : loft ? 0.9 : frame13 ? 0.70 : condo13 ? 0.90 : 0.8;
    const y0f = glassy ? 0.08 : loft ? 0.14 : frame13 ? 0.28 : condo13 ? 0.16 : 0.3;
    const y1f = glassy ? 0.96 : loft ? 0.92 : frame13 ? 0.80 : condo13 ? 0.94 : 0.88;
    const lin = (c) => [(c[0] / 255) ** 2, (c[1] / 255) ** 2, (c[2] / 255) ** 2];
    const wallRaw = lin(rec.color);
    const lum = wallRaw[0] * 0.4 + wallRaw[1] * 0.45 + wallRaw[2] * 0.15;
    // ---- FAC8 TRIM VALUE — THE Wall St WHITE BANDS (docs/notes/facades-r8.md §5)
    // `0.42 + lum * 0.35` is an albedo handed straight to a plain
    // MeshStandardMaterial: this class, like the dresser's palette, goes through
    // NO `applyLightTrim` and NO `applyCityAO`, while the shader facade the trim
    // is appliqued ONTO ends with `pow(albedo, 1.22) * 0.88`. On a brick wall
    // (lum ~ 0.12) the shader renders the wall at 0.12^1.22 * 0.88 = 0.066 and
    // this trim at 0.462 — the stone is **7x brighter than the masonry it sits
    // on**, which is why every floor of every FiDi tower carries a blown-out
    // white band. Deriving the trim from the wall's RENDERED value instead of
    // its raw one puts limestone at a believable 2-3x brick and roughly 1x
    // another limestone wall, which is what the reference shows.
    const wallCal = Math.pow(Math.max(lum, 0.004), 1.22) * 0.88;
    // lead, after the fac8 plates: 2.3x + 0.30 cap still drew a white ladder up every FiDi tower
    // (wallSt after2) — limestone on brick reads ~1.6x in the reference, and never above 0.22
    // HERO9 (2): every member derived from `wall` — reveals, cornice, corbels,
    // modillions, downspout, pier stone, bay panels, base rustication — multiplied the
    // wall's RAW linear colour, but the shader renders that same wall at
    // `pow(lum, 1.22) * 0.88`. For the pale limestone on Wall St (rec.color 197,189,183,
    // lum 0.563) the raw value is 0.563 and the RENDERED one 0.436, so a member authored
    // as "wall * 0.85" (a window reveal, meant to be slightly darker than the wall) came
    // out at 0.48 — BRIGHTER than the wall — and "wall * 0.66" (the rustication) came out
    // at 0.372 against a wall that the city AO then cut to ~0.16. Rescaling the wall
    // reference to its rendered value makes every one of those factors mean what it says.
    const wall = HERO9 ? wallRaw.map((c) => c * (wallCal / Math.max(lum, 1e-4))) : wallRaw;
    // Trim value: the r8 cap of 0.22 was set to fight the ladder and, now that the
    // lighting mismatch is fixed, it INVERTS the relationship on pale stone (limestone
    // trim at half the value of the limestone wall it sits on). The cap is now a sanity
    // bound and the ratio is the physical one: the same material on a stone building
    // (~1.1x, it IS the wall) and a genuine material change on brick (~1.7x — brick
    // 0.15-0.25 albedo, limestone 0.4-0.6 — which is why NYC brick buildings have
    // limestone trim in the first place).
    const stoneSty = S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY || S === STYLE.CHURCH;
    const stoneT = !FAC8 ? 0.42 + lum * 0.35
      : HERO9 ? Math.min(0.55, wallCal * (stoneSty ? 1.12 : 1.7) + 0.015)
      : Math.min(0.22, wallCal * 1.6 + 0.02);
    const trim = [stoneT * 1.02, stoneT * 0.99, stoneT * 0.92];
    // WB13: white vinyl / aluminium-coil trim (#f2f1ec), NOT derived from the wall.
    // Every other member in this class is wall * k, because masonry trim IS the wall's
    // family; siding trim is a bought extrusion that is the same white on a cream house
    // and on a forest-green one, and that constancy across a block is the read.
    const vinylTrim = [0.585, 0.578, 0.552];
    const frame = wall.map((c) => c * 0.4);                        // dark frames (PR: base*0.55 sRGB)
    const stone = FAC8 ? [0.30, 0.285, 0.255] : [0.5, 0.47, 0.42];
    const fh = rec.floorH, ww = rec.winW;
    const n = rec.ring.length;
    // door wall + bay come packed from assemble (same values the shader reads
    // from aux3.z) — hero and shader doors land on the same wall, bay and color
    const dWall = rec.doorI >= 0 ? rec.doorI : -1;
    const dBay = Math.floor((rec.doorPack || 0) / 8) - 1;
    const dColI = Math.floor((rec.doorPack || 0) / 2) % 4;
    let u0 = 0;
    let tris = 0;
    for (let i = 0; i < n; i++) {
      const [ax, az] = rec.ring[i], [bx, bz] = rec.ring[(i + 1) % n];
      const ex = bx - ax, ez = bz - az;
      const len = Math.hypot(ex, ez);
      if (len < 0.05) continue;
      const dx = ex / len, dz = ez / len;
      const nx = ez / len, nz = -ex / len; // exterior (shoelace-positive convention)
      const blind = i < 32 && ((rec.blind >> i) & 1);
      const P = (u, v, out) => [ax + dx * u + nx * out, rec.baseY + v, az + dz * u + nz * out];
      // strip helper: front face + top + bottom, spanning wall-u [uA,uB], v [v0,v1], outset o
      const strip = (uA, uB, v0, v1, o, col) => {
        buf.quad(P(uA, v0, o), P(uA, v1, o), P(uB, v1, o), P(uB, v0, o), [nx, 0, nz], col);
        buf.quad(P(uA, v1, o), P(uA, v1, 0), P(uB, v1, 0), P(uB, v1, o), [0, 1, 0], col);
        buf.quad(P(uA, v0, 0), P(uA, v0, o), P(uB, v0, o), P(uB, v0, 0), [0, -1, 0], col);
        tris += 6;
        if (HCENSUS) this._cen(uA, uB, v0, v1, o, col, len, rec, P);
      };
      // Anything that meets the pavement must START BELOW IT. These parts are
      // appliqué over the shader facade, so a member authored to begin at v=0
      // is exactly coplanar with the sidewalk (an AO seam / z-fight down its
      // whole length) and one authored at v=+0.02..+0.3 simply floats, with the
      // AO pass painting a dark band under its soffit. GRADE buries the bottom
      // edge; the pavement hides the overshoot.
      const GRADE = NO_DATUM ? 0.05 : -0.06;
      // ...and this is how it gets applied. Every member whose bottom edge was
      // authored within a third of a metre of the record's base was meant to
      // REST on the pavement; each one instead hovered by whatever small number
      // its author picked (piers 0.30, cellar doors 0.305, bay windows 0.25,
      // colonnettes 0.06, bulkheads 0.02) and the AO pass drew a hard dark line
      // under every one of them. `atGrade(v)` sinks those bottoms below the
      // flags; the pavement hides the overshoot. Values above 0.35 are real
      // heights (sills, string courses, balconies) and pass through untouched.
      const atGrade = (v) => (NO_DATUM ? v : (v <= 0.35 ? GRADE : v));
      if (!blind && len > 3) {
        const uStart = u0, uEnd = u0 + len;
        const capH = Math.min(rec.height, rec.heroTop ?? rec.height); // stop at the first setback tier
        const arcade = (S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY) && rec.height > 22 && rec.storeH === 0 && i === (dWall >= 0 ? dWall : 0);
        if (!glassy) {
          // per-window surrounds + reveals — EXACTLY mirrors the shader's per-wall bay
          // layout (whole bays, remainder as corner margins)
          let mStart = (rec.flags & BF.STOREFRONT) && rec.storeH > 0 ? Math.ceil(rec.storeH / fh) : 0;
          if (arcade) mStart = Math.max(mStart, 2);
          const mEnd = Math.floor((capH - 0.9) / fh);
          const bayN = Math.floor((len - 0.44) / ww);
          const sideM = (len - Math.max(bayN, 0) * ww) * 0.5;
          const rows = Math.max(0, mEnd - mStart);
          const maxWin = 260; // per-wall budget
          const step = rows * Math.max(1, bayN) > maxWin ? 2 : 1;
          for (let m = mStart; m < mEnd; m += 1) {
            if (HSKIP.has('win')) break;
            // WL11: the ROW datum (vB0/vT0). Every opening in the row then takes its own
            // sill and lintel from it — see the block in the bay loop below.
            const vB0 = m * fh + y0f * fh, vT0 = m * fh + y1f * fh;
            if (vT0 > capH - 0.85 || vB0 < 0.15) continue;
            // even in the near band, floors high above the street are far from the eye —
            // thin members there would be subpixel shimmer dust
            const fineRow = fine && vB0 < 42;
            const rowOn = fineRow || vB0 < 62;
            if (!rowOn) continue;
            for (let k = 0; k < bayN; k += step) {
              // ---- WL11 (docs/notes/lattice-r11.md §3): the SAME jitter the facade
              // shader applies to this bay, from the same hash, so these appliqué reveals
              // and sills land on the shader's openings instead of 7 cm to one side.
              // `wlPin` is the door-bay guarantee: assemble.js doorAnchors slides the stoop
              // to sideM + (dBay + 0.5)*ww and the owner's 2026-09-11 complaint was stairs
              // that miss their doors, so that ONE bay is never jittered anywhere.
              let jOff = 0, jSc = 1, jS = 0, jL = 0, wlBrickK = false;
              const cvIk = Math.floor(rec.colorVar * 1024 + 0.5);
              if (WL11) {
                const pin = (i === dWall && dBay >= 0 && k === dBay) ? 0 : 1;
                const bk = k + 1;
                const bkv = (k % 64) + (m % 64) * 64 + 1;
                jOff = (wlHash(cvIk + 17, bk) * 2 - 1) * 0.028 * pin;
                jSc = 1 + (wlHash(cvIk + 53, bk) * 2 - 1) * 0.026 * pin;
                jS = (wlHash(cvIk + 89, bkv) * 2 - 1) * (0.02 / Math.max(fh, 2));
                jL = (wlHash(cvIk + 131, bkv) * 2 - 1) * (0.02 / Math.max(fh, 2));
                // the SHADER's bricked-opening gate, replayed (materials.js, the wlBrick
                // block): same seeds, same rates, same hash, so hero and shader agree on
                // which openings are filled in.
                if (bayN >= 2 && wlHash(cvIk + 211, 3) < 0.38) {
                  const endB = (k === 0 || k >= bayN - 1) ? 1 : 0;
                  const rate = endB ? 0.20 : 0.025;
                  wlBrickK = (wlHash(cvIk + 401, bkv) < rate || wlHash(cvIk + 307, k + 1) < 0.05)
                    && !(i === dWall && dBay >= 0 && m <= 1) && !(i === dWall && k === dBay);
                }
              }
              const x0j = 0.5 + (x0f - 0.5) * jSc + jOff, x1j = 0.5 + (x1f - 0.5) * jSc + jOff;
              const vB = vB0 + jS * fh, vT = vT0 + jL * fh;
              const a = sideM + (k + x0j) * ww, b = sideM + (k + x1j) * ww; // edge-local
              if (fineRow) {
                // reveals (into the wall) — near band only
                const D = 0.15;
                buf.quad(P(a, vB, 0), P(a, vB, -D), P(a, vT, -D), P(a, vT, 0), [dx, 0, dz], wall.map((c) => c * 0.7)); tris += 2;
                buf.quad(P(b, vB, -D), P(b, vB, 0), P(b, vT, 0), P(b, vT, -D), [-dx, 0, -dz], wall.map((c) => c * 0.55)); tris += 2;
                buf.quad(P(a, vT, 0), P(a, vT, -D), P(b, vT, -D), P(b, vT, 0), [0, -1, 0], wall.map((c) => c * 0.5)); tris += 2;
                buf.quad(P(a, vB, -D), P(a, vB, 0), P(b, vB, 0), P(b, vB, -D), [0, 1, 0], wall.map((c) => c * 0.85)); tris += 2;
                // WL11: a bricked-up opening (the shader fills it — same gate, same hash)
                // keeps its reveal, its sill and its lintel and loses its FRAME. Drawing a
                // dark sash frame over an infill panel is worse than drawing nothing.
                if (!wlBrickK) {
                  strip(a - 0.03, a + 0.03, vB, vT, 0.03, frame);
                  strip(b - 0.03, b + 0.03, vB, vT, 0.03, frame);
                }
                // window AC units (the NYC signature) on ~8% of residential windows
                // ---- WL11: 8 % on a MODULAR pattern ((k*73 + m*31) % 100) is both too few
                // and too orderly — it walks a fixed stride across the facade, so the units
                // land on diagonals. refs/streetview/morningside (prewar brick apartment,
                // Broadway) has a unit in 25-30 % of openings, clustered by apartment, each
                // sitting hard LEFT or hard RIGHT inside its opening (nobody centres one),
                // and the sleeve depth varies. That is the loudest window-to-window
                // irregularity on a real New York facade and it was the tamest thing on ours.
                const acOn = WL11
                  ? (!loft && !wlBrickK && wlHash(cvIk + 1667, (k % 64) + (m % 64) * 64 + 1) * 0.45
                      + wlHash(cvIk + 1789, (k >> 1) + (m % 64) * 64 + 1) * 0.55 < 0.27)
                  : (!loft && ((k * 73 + m * 31 + i * 7) % 100) < 8);
                if (acOn && !HSKIP.has('ac')) {   // SOLID12: heroskip=ac (the harvest's): the export instances the shader's own units (usd_facdetail.py)
                  const acW = WL11 ? 0.26 + 0.07 * wlHash(cvIk + 1861, (k % 64) + (m % 64) * 64 + 1) : 0.32;
                  const acC = WL11
                    ? (a + b) / 2 + (wlHash(cvIk + 1907, (k % 64) + (m % 64) * 64 + 1) < 0.5 ? -1 : 1) * ((b - a) * 0.5 - acW - 0.02)
                    : (a + b) / 2;
                  const acD = WL11 ? 0.26 + 0.10 * wlHash(cvIk + 1993, (k % 64) + (m % 64) * 64 + 1) : 0.3;
                  strip(acC - acW, acC + acW, vB + 0.02, vB + (WL11 ? 0.36 + 0.10 * wlHash(cvIk + 2039, (k % 64) + (m % 64) * 64 + 1) : 0.42), acD, [0.5, 0.51, 0.53]);
                }
                // pediment hoods over lower-floor windows (prewar/civic dressing)
                if ((S === STYLE.PREWAR_APT || S === STYLE.CIVIC_STONE) && m <= mStart + 3 && (k % 2) === 0) {
                  strip(a - 0.12, b + 0.12, vT + 0.14, vT + 0.28, 0.12, trim);
                  strip((a + b) / 2 - 0.3, (a + b) / 2 + 0.3, vT + 0.28, vT + 0.42, 0.13, trim);
                }
                // Juliet balconettes on ~10% of prewar windows
                if (S === STYLE.PREWAR_APT && ((k * 41 + m * 13 + i * 3) % 100) < 10 && m > mStart && !wlBrickK) {   // WL11: never on a filled opening
                  strip(a + 0.04, b - 0.04, vB - 0.1, vB - 0.02, 0.26, [0.17, 0.17, 0.18]);
                  strip(a + 0.04, b - 0.04, vB + 0.5, vB + 0.58, 0.24, [0.14, 0.14, 0.15]);
                  buf.quad(P(a + 0.06, vB, 0.22), P(a + 0.06, vB + 0.52, 0.22), P(b - 0.06, vB + 0.52, 0.22), P(b - 0.06, vB, 0.22), [nx, 0, nz], [0.12, 0.12, 0.13]); tris += 2;
                }
              }
              // lintel + sill survive both bands (chunky enough to rasterize cleanly).
              // FAC8: the projection is HALVED and the side overhang cut. A member
              // standing `o` metres off the wall hides `o / tan(theta)` metres of
              // wall at incidence theta, and a street canyon is seen at 8-12 deg:
              // 0.09 m of projection hid 0.51 m against a 0.50 m gap between
              // dense bays, so a floor of separate sills became one continuous
              // band down the whole block. 0.045 m hides 0.26 m against 0.60 m.
              const oL = FAC8 ? 0.04 : 0.07, oS = FAC8 ? 0.045 : 0.09;
              const pL = FAC8 ? 0.042 : 0.08, pS = FAC8 ? 0.048 : 0.09;
              // tall facades (> 30 m) carry per-window stone only on the street-visible floors
              // (< 12 m); above that the shaft reads through string courses and piers, as on a
              // real FiDi tower — one projecting sill per window per floor was the band ladder
              const perWindowStone = !FAC8 || capH <= 30 || vB < 12;
              if (WB13 && S === STYLE.FRAME_HOUSE) {
                // WB13: flat vinyl brickmold, all four sides, 19-25 mm proud and the
                // white the typology calls the p 0.72 mismatch tell — not a stone sill.
                // A sill trim IS there on a real one (0.038-0.064 m, 12 deg), so the
                // bottom member is kept and made a touch deeper than the jambs; the
                // stone LINTEL is dropped outright, because a sided house has none.
                strip(a - 0.055, b + 0.055, vB - 0.055, vB, 0.030, vinylTrim);
                strip(a - 0.055, b + 0.055, vT, vT + 0.050, 0.024, vinylTrim);
              } else if (perWindowStone) {
                if (S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY || !FAC8) strip(a - oL, b + oL, vT + 0.01, vT + 0.12, pL, trim);
                strip(a - oS, b + oS, vB - 0.09, vB - 0.005, pS, trim);
              }
            }
          }
          // FIRE ESCAPES (the NYC signature): zig-zag iron balconies with
          // alternating ladders on tenement/loft street fronts. Thin strips,
          // ~40 tris per floor, biased away from the entrance bay.
          if (!HSKIP.has('fire') && fine && (S === STYLE.TENEMENT || S === STYLE.LOFT_CASTIRON) && !(rec.flags & BF.STOOP) && rec.height >= 12 && i === (dWall >= 0 ? dWall : 0)
              && bayN >= 3 && mEnd - mStart >= 3 && ((rec.colorVar * 977) % 1) < 0.72) {
            const iron = [0.052, 0.052, 0.058];
            const ironD = [0.04, 0.038, 0.042];
            const doorC = dBay >= 0 ? sideM + (dBay + 0.5) * ww : len / 2;
            let k0 = doorC > len / 2 ? 0 : bayN - 2;
            k0 = Math.max(0, Math.min(bayN - 2, k0));
            const uA = sideM + k0 * ww + 0.1, uB = sideM + (k0 + 2) * ww - 0.1;
            const out = 0.82;
            const mTop = Math.min(mEnd, mStart + 7);
            for (let m = mStart + 1; m < mTop; m++) {
              const vP = m * fh + 0.02;
              if (vP > capH - 1.2) break;
              buf.quad(P(uA, vP, 0.02), P(uA, vP, out), P(uB, vP, out), P(uB, vP, 0.02), [0, 1, 0], ironD); tris += 2;
              buf.quad(P(uA, vP - 0.05, out), P(uA, vP - 0.05, 0.02), P(uB, vP - 0.05, 0.02), P(uB, vP - 0.05, out), [0, -1, 0], ironD); tris += 2;
              strip(uA, uB, vP + 0.84, vP + 0.9, out, iron);
              strip(uA, uB, vP + 0.42, vP + 0.46, out, iron);
              strip(uA, uB, vP - 0.06, vP + 0.06, out, ironD);
              for (const uS of [uA, uB]) {
                buf.quad(P(uS, vP + 0.84, 0.02), P(uS, vP + 0.84, out), P(uS, vP + 0.9, out), P(uS, vP + 0.9, 0.02), [dx, 0, dz], iron); tris += 2;
                buf.quad(P(uS, vP + 0.9, out), P(uS, vP + 0.84, out), P(uS, vP + 0.84, 0.02), P(uS, vP + 0.9, 0.02), [-dx, 0, -dz], iron); tris += 2;
              }
              if (m + 1 < mTop) {
                const lw = 0.55;
                const ldir = (m % 2) ? 1 : -1;
                const lc = (uA + uB) / 2 + ldir * ((uB - uA) / 2 - lw / 2 - 0.15);
                const l0 = lc - ldir * 1.4;
                const oL = out * 0.55;
                for (const sOff of [-lw / 2, lw / 2]) {
                  buf.quad(P(l0 + sOff, vP + 0.02, oL - 0.03), P(l0 + sOff, vP + 0.02, oL + 0.03), P(lc + sOff, vP + fh, oL + 0.03), P(lc + sOff, vP + fh, oL - 0.03), [nx, 0.3, nz], iron); tris += 2;
                }
                for (let r = 1; r <= 4; r++) {
                  const tt = r / 5;
                  const ur = l0 + (lc - l0) * tt, vr = vP + 0.02 + (fh - 0.02) * tt;
                  buf.quad(P(ur - lw / 2, vr, oL - 0.02), P(ur - lw / 2, vr, oL + 0.02), P(ur + lw / 2, vr, oL + 0.02), P(ur + lw / 2, vr, oL - 0.02), [0, 1, 0], iron); tris += 2;
                }
              }
            }
          }
        } else {
          // curtain wall: floor ledges clamped to the tier (spandrel depth)
          if (!HSKIP.has('ledge')) for (let m = 1; m * fh < capH - 1.2; m++) strip(0.1, len - 0.1, m * fh - 0.04, m * fh + 0.05, 0.06, frame);
        }
        // base arcade: front face + arch reveals (PR's non-coplanar trick) on civic/deco fronts
        if (arcade && !HSKIP.has('arcade')) {
          const aH = fh * 1.8, aW = ww * 0.85, D = 0.35;
          const countA = Math.floor((len - 1.6) / (ww * 2));
          const sideA = (len - Math.max(countA, 0) * ww * 2) * 0.5;
          for (let k = 0; k < countA; k++) {
            const c = sideA + k * ww * 2 + ww; // bay center (edge-local)
            const a = c - aW / 2, b2 = c + aW / 2;
            if (a < 0.5 || b2 > len - 0.5) continue;
            const spring = aH * 0.62, rad = aW / 2;
            // jamb reveals
            buf.quad(P(a, GRADE, 0), P(a, GRADE, -D), P(a, spring, -D), P(a, spring, 0), [dx, 0, dz], wall.map((q) => q * 0.6)); tris += 2;
            buf.quad(P(b2, GRADE, -D), P(b2, GRADE, 0), P(b2, spring, 0), P(b2, spring, -D), [-dx, 0, -dz], wall.map((q) => q * 0.5)); tris += 2;
            // arch head reveals (3-segment approximation of the semicircle)
            const segs = [[a, spring, a + rad * 0.3, spring + rad * 0.72], [a + rad * 0.3, spring + rad * 0.72, b2 - rad * 0.3, spring + rad * 0.72], [b2 - rad * 0.3, spring + rad * 0.72, b2, spring]];
            for (const [ua, va, ub, vb] of segs) {
              buf.quad(P(ua, va, 0), P(ua, va, -D), P(ub, vb, -D), P(ub, vb, 0), [0, -0.7, 0].map((q, ii) => ii === 1 ? q : (ii === 0 ? nx : nz) * 0.7), wall.map((q) => q * 0.55)); tris += 2;
            }
            // surround band + keystone
            strip(a - 0.14, b2 + 0.14, spring + rad * 0.7, spring + rad * 0.7 + 0.22, 0.12, trim);
            strip(c - 0.11, c + 0.11, spring + rad * 0.7 + 0.2, spring + rad * 0.7 + 0.52, 0.16, trim);
          }
        }
        // string courses every 6 floors, clamped to the tier
        if (!glassy && !loft && capH > 14) {
          if (!HSKIP.has('course')) for (let m = 6; m * fh < capH - 2.5; m += 6) strip(0.12, len - 0.12, m * fh - 0.1, m * fh + 0.14, 0.13, trim);
        }
        // SkyscraperGenerator idea: CONTINUOUS PIERS at every bay line, seeded
        // width/depth per building — the tripartite "shaft" verticality that
        // Beaux-Arts and deco towers live on (was: thin pilasters every 2 bays)
        // AM120 (owner 2026-09-15, docs/notes/amst120.md): a DARK brick pre-war shaft never gets continuous stone piers —
        // Mudd Hall's (113,61,44) record came out as a white-piered wall at 60 m. Piers on PREWAR_APT only when the wall
        // itself is light masonry (linear luminance >= 0.25: tan brick, limestone, white terra cotta).
        const wallLumAM = 0.3 * Math.pow(rec.color[0] / 255, 2.2) + 0.59 * Math.pow(rec.color[1] / 255, 2.2) + 0.11 * Math.pow(rec.color[2] / 255, 2.2);
        if (!HSKIP.has('pier') && (S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY || (S === STYLE.PREWAR_APT && rec.height > 28 && wallLumAM >= 0.25)) && !glassy && !arcade && capH > 14 && len > 10) {
          const bayNp = Math.floor((len - 0.44) / ww);
          const sideP = (len - Math.max(bayNp, 0) * ww) * 0.5;
          const seedP = (rec.colorVar * 631) % 1;
          const pw = 0.13 + seedP * 0.14;          // seeded pier half-width
          const pd = 0.1 + seedP * 0.1;            // seeded protrusion
          const cad = seedP < 0.45 ? 1 : 2;        // every bay, or every other
          const pTop = Math.min(capH - 0.9, 74);
          const baseTop = Math.min(capH * 0.24, fh * 3 + 0.4);
          // FAC8: a full-height pier in TRIM colour on 60 % of towers is what
        // draws the long vertical white bars in the wallSt plate (they are the
        // same trim as the sills, stacked). Continuous piers are right for a
        // deco/civic shaft, so they stay — but a stone pier on a brick shaft is
        // the minority case, and it is a shade darker than a sill.
        const pCol = seedP < (FAC8 ? 0.35 : 0.6) ? trim.map((c) => c * (FAC8 ? 0.92 : 1)) : wall.map((c) => c * 0.9);
          const pColD = pCol.map((c) => c * 0.78);
          for (let k = cad; k < bayNp; k += cad) {
            const uc = sideP + k * ww;
            strip(uc - pw, uc + pw, GRADE, pTop, pd, pCol);
            if (fine) {
              // molded profile: a narrow proud fillet on the pier face, a
              // plinth where it meets the base band, and a two-stage capital
              // (echinus + wider abacus) under the crown line
              strip(uc - pw * 0.45, uc + pw * 0.45, GRADE, pTop, pd + 0.055, pColD);
              strip(uc - pw - 0.09, uc + pw + 0.09, GRADE, Math.min(2.1, baseTop), pd + 0.05, pCol);
              strip(uc - pw - 0.1, uc + pw + 0.1, pTop - 0.52, pTop - 0.2, pd + 0.08, pCol);
              strip(uc - pw - 0.15, uc + pw + 0.15, pTop - 0.2, pTop, pd + 0.12, pColD);
            }
          }
          // heavy band where the base tier meets the shaft (tripartite massing)
          if (capH > 22 && !HSKIP.has('base')) strip(0.05, len - 0.05, baseTop - 0.3, baseTop + 0.06, 0.24, trim);
          // crown FINIALS: pinnacles on the parapet at pier positions
          if (!HSKIP.has('top') && (S === STYLE.DECO_MASONRY || S === STYLE.CIVIC_STONE) && rec.height > 30 && capH >= rec.height - 1 && fine) {
            for (let k = 0; k <= bayNp; k += Math.max(1, cad)) {
              const uc = sideP + k * ww;
              if (uc < 0.3 || uc > len - 0.3) continue;
              strip(uc - 0.14, uc + 0.14, capH - 0.05, capH + 0.55 + seedP * 0.5, 0.12, trim);
              strip(uc - 0.07, uc + 0.07, capH + 0.55 + seedP * 0.5, capH + 0.95 + seedP * 0.6, 0.06, trim);
            }
          }
        }
        // ---- HERO9 (3): THIS WAS THE WALL ST BAND LADDER (docs/notes/materials-r9.md §1.6)
        // "Rusticated base coursing" emitted a full-wall-width band every 0.64 m from
        // 0.62 m up to min(fh*2.2, capH*0.3) — 17 continuous bands over the bottom 11 m of
        // every CIVIC_STONE / DECO_MASONRY / PREWAR_APT wall with no storefront, which is
        // every tower on Wall St. Three things were wrong with it and each alone is fatal
        // at a canyon's 8-12 degree incidence:
        //   * a rustication joint is a RECESSED CHANNEL; this was 0.06 m PROUD, and a
        //     proud member hides o/tan(theta) = 0.34 m of the wall behind it, i.e. half of
        //     its own 0.64 m pitch — the facade became 50 % band by area;
        //   * it ran straight across the window openings (no bay gating);
        //   * it was `wall * 0.66` of the RAW wall, outside cityAO — rendering ~2x the
        //     wall it was supposed to be a shadow line in.
        // Measured: the plate's facade row-profile has a 54 px fundamental at x=60, 45 px
        // at x=200, 34 px at x=380 (autocorrelation, scratchpad period.mjs). At fov 66 and
        // H=990 a spacing S at range D subtends 762*S/D px, so those three are one 0.64 m
        // pitch on a wall 9.0 / 10.8 / 14.3 m away — Wall St is 18 m wide. `?hero=0`
        // removes the fundamental entirely (autocorrelation peak 216 -> 12).
        // materials.js already draws a rusticated limestone water table on exactly these
        // walls (`v < 4.5 && !store && style < 9.0 && bldgH > 20`) with 0.56 m coursing,
        // box-filtered pcov joints and a relief normal — the correct layer for this
        // feature, since a 0.06 m joint is below the resolution of any hero member seen
        // down a street. So the hero ring stops drawing it.
        if (!HERO9 && fine && (S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY || S === STYLE.PREWAR_APT) && rec.storeH === 0) {
          if (!HSKIP.has('rust')) for (let vr = 0.62; vr < Math.min(fh * 2.2, capH * 0.3); vr += 0.64) strip(0.06, len - 0.06, vr, vr + 0.06, 0.06, wall.map((c) => c * 0.66));
        }
        // corbel brackets under tenement/prewar cornices (Italianate)
        // FD14: 0.26 of projection under a band that projects 0.32 is a bracket that does
        // not carry anything. It now stands 0.40 proud — past the bed mould, inside the
        // corona's 0.52 — which is the order the eye reads as "band ON brackets".
        if (!HSKIP.has('top') && fine && (S === STYLE.TENEMENT || S === STYLE.PREWAR_APT) && (rec.flags & BF.CORNICE) && i === 0) {
          for (let du = 0.5; du < len - 0.6; du += 1.9) strip(du, du + 0.22, capH - 0.96, capH - 0.54, FD14 ? 0.40 : 0.26, wall.map((c) => c * 0.58));
        }
        // downspout at the wall end (HK building-gen dressing)
        if (!HSKIP.has('spout') && fine && !glassy && len > 6) {
          strip(0.22, 0.3, 0.1, capH - 0.7, 0.1, wall.map((c) => c * 0.45));
        }
        // cornice at the tier top (never floats beside inset upper tiers)
        if (!HSKIP.has('top') && (rec.flags & BF.CORNICE)) {
          if (frame13) {
            // WB13: the boxed aluminium-coil cornice, weight 0.44 and the typology's
            // "strongest single authenticity variable" (§2.3). Brackets and mouldings
            // are GONE: a flat coil box, fascia 0.25-0.46 m, projection 0.20-0.41 m,
            // over a flat vented soffit — it "reads as a plain shadow band". So: one
            // white member and one dark soffit line, and none of the dentils,
            // modillions or corbels the masonry branch below hangs off it.
            strip(0.02, len - 0.02, capH - 0.42, capH - 0.02, 0.30, vinylTrim);
            strip(0.05, len - 0.05, capH - 0.52, capH - 0.42, 0.25, wall.map((c) => c * 0.40));
          } else if (FD14) {
            // ---- FD14 (critic-r14 fix 7). The hero ring's crown was a 0.20/0.32 m band
            // with the MODILLIONS drawn at 0.34 in the same 0.25 m of height — a row of
            // blocks standing proud of the thing they are supposed to carry, which is the
            // same "crenellation" read the dresser's buried moulding gave. Same envelope,
            // real order: a bed mould, a corona that overhangs everything under it, and
            // the dentils/modillions BELOW both. 0.52 m of projection on a 0.53 m band is
            // a New York sheet-metal cornice (0.5-0.9 m proud, 0.6-1.2 m tall).
            strip(0.05, len - 0.05, capH - 0.55, capH - 0.30, 0.30, wall.map((c) => c * 0.62));
            strip(0.02, len - 0.02, capH - 0.30, capH - 0.08, 0.52, wall.map((c) => c * 0.72));
            strip(0.04, len - 0.04, capH - 0.08, capH - 0.01, 0.44, wall.map((c) => c * 0.58));
          } else {
          strip(0.05, len - 0.05, capH - 0.55, capH - 0.28, 0.2, wall.map((c) => c * 0.62));
          strip(0.02, len - 0.02, capH - 0.28, capH - 0.02, 0.32, wall.map((c) => c * 0.55));
          }
          // dentil course on the street front (near band — subpixel at range)
          // FD14: under the bed mould, not floating on the wall below the band.
          if (fine && i === 0 && len < 45 && !frame13) {
            for (let du = 0.4; du < len - 0.5; du += 0.72) strip(du, du + 0.17, capH - 0.70, capH - 0.56, FD14 ? 0.22 : 0.14, trim);
          }
          // modillions: scrolled brackets under the soffit on stone fronts —
          // larger and sparser than dentils, they read from across the street
          // FD14: dropped below the band (they used to sit IN it), and no longer drawn on
          // the wall the corbel branch above already bracketed — that pair put a 1.9 m row
          // and a 1.35 m row of blocks on the same prewar front.
          if (fine && i === (dWall >= 0 ? dWall : 0) && (S === STYLE.CIVIC_STONE || S === STYLE.DECO_MASONRY || S === STYLE.PREWAR_APT) && len < 55
              && !(FD14 && S === STYLE.PREWAR_APT && i === 0)) {
            for (let du = 0.7; du < len - 0.8; du += 1.35) {
              if (FD14) strip(du, du + 0.26, capH - 0.92, capH - 0.52, 0.40, wall.map((c) => c * 0.5));
              else strip(du, du + 0.24, capH - 0.55, capH - 0.3, 0.34, wall.map((c) => c * 0.5));
            }
          }
        }
        // balustrade parapet on civic roof lines: posts + top rail
        if (!HSKIP.has('top') && fine && S === STYLE.CIVIC_STONE && capH >= rec.height - 1 && len > 6 && len < 45 && rec.height < 40) {
          for (let du = 0.35; du < len - 0.45; du += 0.62) strip(du, du + 0.13, capH + 0.02, capH + 0.46, 0.1, trim);
          strip(0.15, len - 0.15, capH + 0.46, capH + 0.6, 0.14, trim);
          strip(0.15, len - 0.15, capH + 0.02, capH + 0.1, 0.13, trim);
        }
        // quoins at the front wall's corners (near band)
        if (!HSKIP.has('quoin') && fine && i === 0 && !glassy && !loft && capH > 10) {
          for (let vq = 0.6; vq < Math.min(capH - 1.2, 26); vq += 0.92) {
            strip(0.02, 0.5, vq, vq + 0.44, 0.06, trim);
            strip(len - 0.5, len - 0.02, vq + 0.46, vq + 0.9, 0.06, trim);
          }
        }
        // storefront kit
        if ((rec.flags & BF.STOREFRONT) && rec.storeH > 2) {
          strip(0.1, len - 0.1, GRADE, 0.5, 0.06, stone);                                  // bulkhead: ON the flags
          strip(0.05, len - 0.05, rec.storeH * 0.78, rec.storeH, 0.11, frame);             // fascia
          for (let mu = 1.2; mu < len - 1.0; mu += 1.35) strip(mu - 0.035, mu + 0.035, 0.5, rec.storeH * 0.78, 0.05, frame); // mullions
          // cast-iron colonnettes (the SoHo look): fluted shaft + collar rings
          // + square cap at a wider rhythm than the glazing mullions
          if (fine && (S === STYLE.LOFT_CASTIRON || S === STYLE.INDUSTRIAL)) {
            const ironC = [0.05, 0.068, 0.06];
            const bandT = rec.storeH * 0.78;
            for (let cu = 1.6; cu < len - 1.4; cu += 2.75) {
              strip(cu - 0.1, cu + 0.1, GRADE, bandT, 0.16, ironC);
              strip(cu - 0.045, cu + 0.045, GRADE, bandT, 0.21, ironC.map((c) => c * 1.5));
              strip(cu - 0.13, cu + 0.13, 0.5, 0.62, 0.18, ironC.map((c) => c * 1.3));
              strip(cu - 0.13, cu + 0.13, bandT - 0.34, bandT - 0.22, 0.18, ironC.map((c) => c * 1.3));
              strip(cu - 0.16, cu + 0.16, bandT - 0.16, bandT, 0.2, ironC);
            }
          }
          // steel cellar doors flush in the sidewalk (hash-gated ~1 in 5):
          // two leaves with a center seam, tilted a hair so they catch light
          if (fine && i === (dWall >= 0 ? dWall : 0) && len > 7 && ((rec.colorVar * 419) % 1) < 0.2) {
            const cw = 0.75, cdep = 1.55;
            const cu0 = Math.min(len - 2 * cw - 0.6, Math.max(0.6, len * 0.72));
            const steel = [0.2, 0.205, 0.215];
            for (const lf of [0, 1]) {
              const ua = cu0 + lf * cw + 0.02, ub = cu0 + (lf + 1) * cw - 0.02;
              // 0.008 / 0.028, not 0.305 / 0.325: these leaves lie FLUSH in the
              // flags. The old datum predates the flat base plane (it assumed
              // the pavement sat ~0.3 m above the record's base) and left two
              // steel plates hovering 30 cm over the sidewalk.
              buf.quad(P(ua, 0.008, 0.12), P(ua, 0.028, cdep), P(ub, 0.028, cdep), P(ub, 0.008, 0.12), [0, 1, 0], lf ? steel : steel.map((c) => c * 0.88)); tris += 2;
            }
            // frame curb around the doors
            strip(cu0 - 0.06, cu0 + 2 * cw + 0.06, GRADE, 0.035, 0.1, steel.map((c) => c * 0.7));
          }
        }
        // entrance door on the compiler-scored street wall, in the shader's door
        // bay (no more second entrance at a different x, no door over storefronts)
        if (i === dWall && dBay >= 0 && !arcade && !((rec.flags & BF.STOREFRONT) && rec.storeH > 2) && len > 3.4) {
          // WB13: a frame house's door is a 0.91 m single leaf behind a storm door,
          // not a 1.5 m double, and it stands on the LOW stoop landing (assemble.js
          // WB13_STOOP_SY x the kit's 1.70 m) — otherwise the hero ring's door sits at
          // grade while the stoop beside it climbs to 1.05 m.
          const dw = S === STYLE.ROWHOUSE ? 1.15 : frame13 ? 1.05 : 1.5;   // WB13: frame13 from the opening block above
          const bayN2 = Math.floor((len - 0.44) / ww);
          const sideM2 = (len - Math.max(bayN2, 0) * ww) * 0.5;
          const uD = Math.min(len - dw - 0.6, Math.max(0.6, sideM2 + (dBay + 0.5) * ww - dw / 2));
          const v0d = S === STYLE.ROWHOUSE ? 1.19 : frame13 && (rec.flags & BF.STOOP) ? 1.70 * 0.62 : 0.02; // rowhouse door atop its stoop; WB13 frame house atop its LOW one (assemble.js WB13_STOOP_SY)
          const v1d = v0d + 2.55, DD = 0.3;
          // same linear palette as the shader's dCol (indexed by the packed color)
          const doorCol = [[0.16, 0.11, 0.08], [0.26, 0.09, 0.08], [0.09, 0.14, 0.12], [0.12, 0.12, 0.14]][dColI];
          // jamb + header reveals
          buf.quad(P(uD, v0d, 0), P(uD, v0d, -DD), P(uD, v1d, -DD), P(uD, v1d, 0), [dx, 0, dz], wall.map((q) => q * 0.62)); tris += 2;
          buf.quad(P(uD + dw, v0d, -DD), P(uD + dw, v0d, 0), P(uD + dw, v1d, 0), P(uD + dw, v1d, -DD), [-dx, 0, -dz], wall.map((q) => q * 0.5)); tris += 2;
          // (wound outer-edge-first: cross(n, d) = -y, so this soffit actually
          // faces DOWN. It was wound the other way and back-face culled, which
          // left you looking up through the head into the wall.)
          buf.quad(P(uD, v1d, -DD), P(uD, v1d, 0), P(uD + dw, v1d, 0), P(uD + dw, v1d, -DD), [0, -1, 0], wall.map((q) => q * 0.45)); tris += 2;
          // THRESHOLD: the reveal had jambs and a head but no floor, so a
          // 0.3 m-deep recess stood open at the bottom under every entrance —
          // you looked straight down through the pavement into the void under
          // the tile. A saddle at the door line closes it, 1 cm proud of the
          // flags where the door meets grade (a rowhouse door sits on its
          // stoop, so there it is a real landing).
          const vT = Math.max(v0d, 0.01);
          buf.quad(P(uD, vT, 0.02), P(uD, vT, -DD), P(uD + dw, vT, -DD), P(uD + dw, vT, 0.02), [0, 1, 0], stone.map((c) => c * 0.8)); tris += 2;
          // door slab + transom glass + kick plate
          buf.quad(P(uD + 0.04, v0d, -DD + 0.06), P(uD + 0.04, v1d - 0.45, -DD + 0.06), P(uD + dw - 0.04, v1d - 0.45, -DD + 0.06), P(uD + dw - 0.04, v0d, -DD + 0.06), [nx, 0, nz], doorCol); tris += 2;
          buf.quad(P(uD + 0.08, v1d - 0.42, -DD + 0.07), P(uD + 0.08, v1d - 0.06, -DD + 0.07), P(uD + dw - 0.08, v1d - 0.06, -DD + 0.07), P(uD + dw - 0.08, v1d - 0.42, -DD + 0.07), [nx, 0, nz], [0.12, 0.16, 0.18]); tris += 2;
          // surround trim + step
          const vJ = v0d;
          strip(uD - 0.14, uD, atGrade(vJ), v1d + 0.14, 0.05, trim);
          strip(uD + dw, uD + dw + 0.14, atGrade(vJ), v1d + 0.14, 0.05, trim);
          strip(uD - 0.14, uD + dw + 0.14, v1d + 0.02, v1d + 0.16, 0.08, trim);
          if (S !== STYLE.ROWHOUSE) strip(uD - 0.1, uD + dw + 0.1, GRADE, 0.14, 0.42, stone);
          // Siamese standpipe beside the entrance (NYC fixture): red body,
          // twin brass caps angled outward
          if (uD > 1.1 && S !== STYLE.ROWHOUSE && ((rec.colorVar * 257) % 1) < 0.6) {
            const spU = uD - 0.62, spRed = [0.28, 0.05, 0.05], brass = [0.35, 0.26, 0.1];
            strip(spU - 0.055, spU + 0.055, GRADE, 0.68, 0.2, spRed);
            strip(spU - 0.16, spU - 0.04, 0.6, 0.74, 0.24, brass);
            strip(spU + 0.04, spU + 0.16, 0.6, 0.74, 0.24, brass);
          }
        }
        // rowhouse projecting bay window (parlor + upper floors), opposite the door
        if (!HSKIP.has('bay') && S === STYLE.ROWHOUSE && i === (dWall >= 0 ? dWall : 0) && len > 5.5 && capH > 7) {
          const bayN3 = Math.floor((len - 0.44) / ww);
          const sideM3 = (len - Math.max(bayN3, 0) * ww) * 0.5;
          const doorAt = dBay >= 0 ? sideM3 + (dBay + 0.5) * ww : len * 0.4;
          const bc = doorAt < len * 0.5 ? len * 0.74 : len * 0.26;
          const bw = 1.15, dep = 0.5, topB = Math.min(capH - 1.1, 1.1 + fh * 3);
          const panel = (uA, oA, uB, oB, col) => { // vertical panel with its true facet normal
            const tx2 = dx * (uB - uA) + nx * (oB - oA), tz2 = dz * (uB - uA) + nz * (oB - oA);
            let fnx = tz2, fnz = -tx2; const fl = Math.hypot(fnx, fnz) || 1; fnx /= fl; fnz /= fl;
            if (fnx * nx + fnz * nz < 0) { fnx = -fnx; fnz = -fnz; }
            buf.quad(P(uA, GRADE, oA), P(uA, topB, oA), P(uB, topB, oB), P(uB, GRADE, oB), [fnx, 0, fnz], col); tris += 2;
          };
          panel(bc - bw - 0.55, 0.02, bc - bw, dep, wall.map((c) => c * 0.92));
          panel(bc - bw, dep, bc + bw, dep, wall);
          panel(bc + bw, dep, bc + bw + 0.55, 0.02, wall.map((c) => c * 0.8));
          for (let mB = 0; mB * fh + 2.4 < topB; mB++) { // windows on the bay front
            const vw0 = mB * fh + (mB === 0 ? 1.35 : 0.7), vw1 = mB * fh + (mB === 0 ? 3.0 : 2.5);
            if (vw1 > topB - 0.2) break;
            buf.quad(P(bc - 0.78, vw0, dep + 0.01), P(bc - 0.78, vw1, dep + 0.01), P(bc + 0.78, vw1, dep + 0.01), P(bc + 0.78, vw0, dep + 0.01), [nx, 0, nz], [0.08, 0.1, 0.11]); tris += 2;
            strip(bc - 0.86, bc + 0.86, vw0 - 0.08, vw0, dep + 0.05, trim);
            strip(bc - 0.86, bc + 0.86, vw1, vw1 + 0.1, dep + 0.04, trim);
          }
          strip(bc - bw - 0.6, bc + bw + 0.6, topB, topB + 0.16, dep + 0.06, trim);
          strip(bc - bw - 0.6, bc + bw + 0.6, GRADE, 0.3, dep + 0.04, stone);
        }
        // balconies on postwar apartment fronts
        // WB13: ...and on the post-2000 condo, where a projecting balcony slab with a
        // glass or cable rail is not decoration but the type's defining silhouette —
        // docs/notes/wburg-r13.md, and every post-2000 building in
        // the Bedford Ave reference has them. Same geometry, same budget, one
        // style id added; `capH > 12` already restricts it to 4 floors and up.
        if (!HSKIP.has('balc') && (S === STYLE.POSTWAR_BRICK || (WB13 && S === STYLE.CONDO_NEW)) && i === 0 && !glassy && capH > 12) {
          const bayNb = Math.floor((len - 0.44) / ww);
          const sideMb = (len - Math.max(bayNb, 0) * ww) * 0.5;
          for (let m = 2; m * fh < capH - 2.2; m++) {
            for (let k = 0; k < bayNb; k++) {
              if (((k * 31 + m * 17 + (rec.colorVar * 91 | 0)) % 10) > 5) continue;
              const a = sideMb + (k + 0.08) * ww, b2 = sideMb + (k + 0.92) * ww;
              const vS = m * fh - 0.02;
              strip(a, b2, vS - 0.16, vS, 1.15, [0.42, 0.41, 0.4]);          // slab
              strip(a, b2, vS + 0.88, vS + 0.98, 1.1, [0.3, 0.3, 0.31]);     // top rail
              buf.quad(P(a, vS, 1.08), P(a, vS + 0.9, 1.08), P(b2, vS + 0.9, 1.08), P(b2, vS, 1.08), [nx, 0, nz], [0.25, 0.26, 0.28]); tris += 2; // rail panel
            }
          }
        }
      }
      u0 += len;
      if (tris > 15000) break; // hard budget per building
    }
    if (!buf.pos.length) return null;
    const geo = buf.build();
    // sanity: discard any build whose bounds escape the lot (guards against rogue beams)
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const [x, z] of rec.ring) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mnz = Math.min(mnz, z); mxz = Math.max(mxz, z); }
    const diag = Math.hypot(mxx - mnx, mxz - mnz) / 2 + 6;
    const bs = geo.boundingSphere;
    const ccx = (mnx + mxx) / 2, ccz = (mnz + mxz) / 2;
    if (bs && (Math.hypot(bs.center.x - ccx, bs.center.z - ccz) > diag || bs.radius > diag + rec.height)) {
      console.warn('hero facade rejected (rogue bounds)', rec.key, rec.style);
      geo.dispose();
      return null;
    }
    const mesh = new THREE.Mesh(geo, this.mat);
    // NO castShadow: 3-6cm trim is far below the shadow texel (10cm) — sub-texel
    // casters rain shimmering shadow dust over the facade (the "window noise" bug)
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    return mesh;
  }
}
