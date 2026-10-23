// Traffic: cars on the real street graph. IDM following, signal phases with amber,
// turn-ratio routing, U-turns at dead ends, jam-aware intersection entry.
import { spawnGuard, viewGuard } from './spawnGuard.js';
import * as THREE from 'three';
import { buildVehicleGeos, fleetColor, VH13 } from './vehicles.js';
import { signalState } from './signals.js';
import { CarLights } from './carlights.js';
import { applySnowCap, ENV } from '../world/materials.js';
import { lf39Stalls } from '../world/lotfix39.js';   // LF39 (LOTFIX): the cars in the city's parking lots
import { HA_ON, haSettle } from '../world/haAnchor.js';   // P1 TERRAIN (`?terrain=p1`)
// see world/assemble.js: `?nodatum=1` restores the pre-seam-pass datums for A/B plates
const NO_DATUM = typeof location !== 'undefined' && new URLSearchParams(location.search).get('nodatum') === '1';

// ---- VH13 (docs/notes/vehicles-r13.md; `?vh13=0` restores the round-12 fleet) ----
// `?vh13k=<x>` scales the paint albedo trim so a value can be A/B'd in one render
// session without an edit.
const VH13K = (() => {
  if (typeof location === 'undefined') return 1;
  const v = parseFloat(new URLSearchParams(location.search).get('vh13k'));
  return Number.isFinite(v) && v > 0 ? v : 1;
})();
// ALBEDO TRIM FOR THE FLEET. materials.js/applyLightTrim's own docstring is the
// argument: the sun and sky in this scene are hot by design, every custom shader
// trims its albedo to match (the ground by mix(0.30, 0.88, night), the facades by
// their value calibration), and a plain Standard/Physical material takes the raw
// light and clips. NOTHING in the vehicle path did one. Same shape as
// applyLightTrim — a diffuseColor multiply at <color_fragment> — but with its own
// day/night pair, because the fleet must NOT be brightened after dark the way the
// street-prop calibration (0.88 x 1.94) brightens a bollard: a parked car at night
// is lit by street lamps and belongs at its own albedo.
function vhTrim(mat, day, night = 1.0) {
  const prev = mat.onBeforeCompile;
  const d = (day * VH13K).toFixed(3), n = (night * VH13K).toFixed(3);
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    sh.uniforms.vhNight = ENV.night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float vhNight;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(${d}, ${n}, vhNight);`);
  };
  mat.customProgramCacheKey = () => (prev ? String(prev) : '') + '|vhtrim' + d + ',' + n;
  mat.needsUpdate = true;
  return mat;
}
// Deliberately MILD. Measured on the round-13 street plate (a parked Prius on
// 125th, docs/notes/vehicles-r13.md D15): bonnet L 113 against asphalt L 71, i.e.
// the fleet was not actually CLIPPING — what made it read as "pale blue-white
// clay" was the hue (roof B/R 2.64 on a neutral silver car) and the flatness, and
// both of those are the metalness-0.35 mirror, which is fixed directly. Dropping
// that mirror already takes ~25 % out of a shaded body's value, so the trim here
// only has to stop a high-albedo white in FULL SUN from clipping. 1.0 at night.
const PAINT_DAY = 0.82;   // bodywork / body2 / far shells
const TRIM_DAY = 0.88;    // interior, tyres, plates — already dark, barely trimmed

// VH13 — NEW YORK PLATE. The plate bucket carried a flat 0xe6dfc6 and no uv at
// all (vehicles.js strips uvs on load), so every car in the city wore a blank
// pale rectangle — called out by name in the owner's 2026-09-16 day frames.
// vehicles.js/uvPlanarPlate now projects a planar uv per plate, front and rear,
// so a texture is bindable; this is the current Excelsior issue, drawn once and
// shared by every pool. Deliberately NOT a specific real registration: a generic
// three-letter/four-digit serial in the NY format.
let _plateTex = null;
function plateTexture() {
  if (_plateTex || typeof document === 'undefined') return _plateTex;
  const W = 512, H = 256;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#dde6f1'); gr.addColorStop(0.40, '#f3f4f1'); gr.addColorStop(1, '#e9ebe6');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#1b3f7a'; x.lineWidth = 8;
  x.strokeRect(13, 13, W - 26, H - 26);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = '#1b3f7a';
  x.font = 'bold 42px Georgia, "Times New Roman", serif';
  x.fillText('NEW YORK', W / 2, 52);
  x.fillStyle = '#16294c';
  x.font = 'bold 100px "Arial Narrow", Impact, "Arial Bold", sans-serif';
  x.fillText('KLM 4207', W / 2, 143);
  x.fillStyle = '#2c528d';
  x.font = 'bold 24px Georgia, "Times New Roman", serif';
  x.fillText('EXCELSIOR', W / 2, 216);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _plateTex = t;
  return t;
}

// XW11: NYC DOT crosswalk depth, in step with XW_DEPTH in tools/pipeline/compile.mjs — the stop
// line sits 4 ft behind the crossing, so the queue position has to follow the painted depth
const XW_DEPTH = (rclass, width) => (rclass === 2 && width >= 16.5 ? 7.62 : 4.57);
const CAR_TARGET = 620; // reference streets run near-saturated (fleet caps sum 854)
const SPAWN_NEAR = typeof location !== 'undefined' && new URLSearchParams(location.search).has('spawnnear');
const SPAWN_R0 = SPAWN_NEAR ? 15 : 240, SPAWN_R1 = 720, DESPAWN_R = 950, DEAD_DESPAWN = 260;
const IDM = { a: 1.9, b: 2.6, T: 1.15, s0: 2.2, delta: 4 };
// body lengths for following gaps: a fixed 4.6 m had followers parked inside the back half of a
// bus (audit 2026-09-10: "micra d128 x bus d135", 10 same-lane pairs per 30 s)
const VLEN = { bus: 11.6, boxtruck: 7.2, sprinter: 5.9, vwvan: 4.9, van: 5.2, cybertruck: 5.7, suburban: 5.7, ambulance: 6.4, jeep: 4.7 };
// FG31: the fleet's own model lengths where fleet24 has published them (traffic.vehDims, filled in by update()). The table
// had no fire truck or minibus, which queued at a car's 4.6 m and stood inside the vehicle ahead (scratchpad qc2: a
// minibus and a fire truck 7.2 m apart centre to centre, bodies 3 m into each other, for the whole 40 s). `?fg31=0` restores.
const FG31 = typeof location === 'undefined' || new URLSearchParams(location.search).get('fg31') !== '0';
let VLEN_FLEET = null;
const vlen = (c) => (VLEN_FLEET && VLEN_FLEET[c.kind]) || VLEN[c.kind] || 4.6;
const followGap = (a, b) => (vlen(a) + vlen(b)) / 2 + 0.4;   // centre-to-centre distance at which bumpers touch (+0.4 m)
// VC36: the centre distance a lane change needs from a body in the new lane: `base` m, or the two bodies' reach + 1.5 m
const lcNeed = (o, car, base) => Math.max(base, ((o.d - car.d) * car.dir >= 0 ? followGap(o, car) : followGap(car, o)) + 1.5);

const nk = (x, z) => `${Math.round(x)}_${Math.round(z)}`;
// PY25 pedestrian yield (see _pedGap); `?py25=0` restores the straight-ahead box and the unbucketed walker check
const PY25 = typeof location === 'undefined' || new URLSearchParams(location.search).get('py25') !== '0';
// YD26 (2026-09-26): a car passes in front of or behind a walker on the carriageway only with room to spare (the walker may
// stop, held by another car, where it was predicted to walk on; a creeping car pulls away), and its predicted path runs
// where the car really is across its lane (carPath): turning cars crept into crossers standing in front of their bumpers
// at W 122nd / Lenox and W 120th / Amsterdam. `?yield26=0`: the PY25 windows and path.
const YD26 = PY25 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('yield26') !== '0');
// TW26 (owner 2026-09-26: "cars randomly change lanes by teleporting"): the wide-swing fallback built the turn from exit and
// entry points moved 1.2 m toward the road centre, so a car whose normal arc cut the kerb jumped 1.2 m sideways as its turn
// began and again as it ended (probe: every lateral jump over 1 m in a 600-step Lenox run sat at a turn's first or last
// step). The swing now bends the middle of the arc through its control points; the arc starts and ends where the car is.
// The lane itself was eased INSIDE _laneOffset (7-8 % of the gap per call, ~2 calls a step): a lane change began at up to
// 13 m/s sideways. laneF now follows the lane on a critically damped spring stepped once per frame (starts and stops
// smoothly, peaks near 1.5 m/s, done in ~3 s), the body yaws into its sideways motion, and a turn clamps laneF to the next
// street's lanes before it builds the arc, so the arc lands in a real lane. A turn's s was also the Bezier PARAMETER over an
// estimated length (chord x (1 + 0.3 bend)), so cars surged to ~30 m/s through part of every corner; turns now carry an
// arc-length table and s is metres along the curve. `?tw26=0` restores all of it.
const TW26 = typeof location === 'undefined' || new URLSearchParams(location.search).get('tw26') !== '0';
// TW27 (film 10 recorder, CAR-JUMP ~1.2 m forward, 0 sideways): a car leaves its edge up to 0.6 m short of the junction
// mouth, but its connector began AT the mouth and the car was not placed on the frame it left: it stood still for a frame
// and then jumped up to 0.6 m plus two steps; a connector under 2 m was not driven at all. The connector now starts where
// the car is, the car is placed on it at once, and a short one is driven as a straight connector (probe, 600 steps at
// 125th & Lenox: jump events 410 -> 0, traffic flow unchanged). `?tw27=0` restores the old junction entry.
const TW27 = TW26 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('tw27') !== '0');
// VT27 (owner 2026-09-26: "Vehicle turns are robotic ... vehicles moving in impossible ways, such as moving by 15 degrees
// or so in between frames non-smoothly"): the body took the heading of the path under it, which steps at every polyline
// vertex, connector end and lane change. It now follows its own motion the way a car's rear axle does: a point dragged at
// about half the wheelbase behind the body centre (a tractrix, the rear axle of the kinematic bicycle model), heading =
// rear -> centre. Turns ease in and out, the body sits a few degrees inside the tangent in a tight corner (the sideslip a
// car's centre has), and a car that is not moving cannot rotate. `?vt27=0` restores the path heading.
const VT27 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vt27') !== '0';
// DL27 (film 11 fTraffic: nothing moved at 125th & Lenox for a whole green): at a divided avenue a car whose next edge is
// the short link across the median waits at its stop bar while the FAR node shows red to the link's heading. That is right
// for a car crossing the avenue straight on from the cross street, but a car TURNING onto the link from the avenue (a
// left across the median) sees red there for the whole of its own green and its own red for the rest: it waited for ever
// and held its lane. It now goes on its own green like any unprotected left (_boxBlocked holds it while the oncoming
// carriageway is busy). `?dl27=0` restores the old wait.
const DL27 = typeof location === 'undefined' || new URLSearchParams(location.search).get('dl27') !== '0';
// BX27 (film 11 fTraffic re-shoot: a sedan drove through the rear of an SUV standing at the end of its turn, yielding to the
// walkers on the crossing): a car counted as out of the junction box 4 m before the end of its connector, whatever its
// length, and not at all once the connector had ended with its rear still in the box. A car at the stop bar now also holds
// while any crossing car's body (its oriented box, rear included, up to its half length past its connector's end) lies
// across the path it will drive through the box. `?bx27=0`: the old test only.
const BX27 = typeof location === 'undefined' || new URLSearchParams(location.search).get('bx27') !== '0';
// VT28 (owner 2026-09-27 on film 11: "vehicles are waiting at lanes at an angle unnaturally and in the queues as well ...
// I just want Carla style intelligent vehicles that smoothly and realistically turn"): the TW26 lane spring slid a car
// sideways at up to 1.5 m/s whatever its speed, a standing car included, and VT27 took the heading from a point dragged
// behind the car, which turned every sideways slide into a body angle (tens of degrees in a queue) that a stopped car then
// kept. Sideways motion now needs forward motion, as a car's does: the spring's lateral speed is capped at v tan(8 deg), so
// a standing car does not move sideways and a lane change takes ~23 m of road. The body points along its real motion (the
// lane's chord over the wheelbase, turned by atan(lateral / forward) <= 8 deg during a lane change), the dragged point is
// gone, and a kinematic yaw-rate cap (v / 4.5 m + 0.2 rad/s, nothing in a dt = 0 update) smooths the steps that remain
// (edge <-> connector hand-overs, a swung connector's handles). A connector's speed cap follows its tightest bend (2.5 m/s2
// sideways), reached by braking, not in one frame. A car straddling two lanes is a leader in both. `?vt28=0`: VT27.
const VT28 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vt28') !== '0';
// VT29 (owner 2026-09-27, after film 12: "big vehicles like trucks and buses still rotate in place non physically"): VT28
// took the heading from the path's chord around the body CENTRE and let it turn at v / 4.5 m + 0.2 rad/s, for every kind.
// So a stopped vehicle could still turn (the 0.2 rad/s), and on a turn a long body pivoted about its middle: its rear axle
// slid sideways (probe, 30 s at 125th & Lenox: p99 1.4 m/s, 9 % of moving frames over 0.3 m/s; a box truck on a 1.8 m
// connector bend turned almost on the spot). VT29 is the kinematic bicycle: the body centre follows the path and the rear
// axle, lr behind it (0.56 x the half length, 1.25-3.4 m: a sedan 1.3, a van 1.65, a box truck 2.0, a bus 3.25), is
// towed along its own heading. The heading is the direction from the rear axle to the centre, so it turns only as far as
// the body moves (never standing), a long body off-tracks inside a corner as a real one does, and the rear never slides.
// The lane-change angle comes out of the same geometry (VT28's lateral cap, v tan 8 deg, still bounds it). The path's own
// heading bounds it: a body more than 75 deg off it (a U-turn's tight end, a kink) swings back by at most a radian per
// 1.2 m travelled. `?vt29=0` restores VT28.
const VT29 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vt29') !== '0';
// VT30 (film 13's fWeather: a box truck swung its nose 20-25 deg over the first 1.2 m of a turn): VT29's towed axle is
// only as physical as the path it follows. On a centre path of radius Rc the axle runs round sqrt(Rc^2 - lr^2), and the
// connectors are drawn for a car: the tightest bend of half of those driven round 125th & Lenox is under 6 m, so a third
// to a half of the big vehicles' turns ran the rear axle round a tighter circle than a real one can steer (37 deg of
// lock on a wheelbase of 2 lr: a van's axle 4.4 m round, a box truck 6.0, a fire truck 6.3). Most of those turns join lane ends
// at unequal distances from the corner (one 20 m before it, the other 6 m past it), where the equal handles bend the
// path at the short side. A big vehicle's connector now takes handles of their own length (0.1-1.0 x the chord) and its
// controls swung up to 2 m wide if that brings its tightest bend nearer the 2.84 lr its lock can follow, both sides of
// the body on the road; the body still follows the path exactly (a steering lock on the drawn body instead let it stand
// off the path, where it weaved and, stopped, stood inside its neighbours). Probe, 30 s round 125th & Lenox: the tightest
// 5 % of big-vehicle turns 2.6 -> 3.4 m round, the median 6.0 -> 10.0 m, a body corner off the road on 6.0 -> 3.7 % of
// their turning frames; overlaps as before. `?vt30=0` restores VT29.
const VT30 = VT29 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('vt30') !== '0');
const BIGV = /^(bus|boxtruck|firetruck|ambulance|minibus|van)$/;
// VQ30 (owner 2026-09-28: "There are still cars that stay rotated in the lane when they are waiting in a queue which
// never happens in real life"): a lane change moves a car sideways only while it drives forward (VT28, v tan 8 deg),
// and the turn-lane rule started one whenever a car was more than 6 m from the junction, so a car waiting in a queue
// took its new lane and inched across it at 8 deg with every creep forward; a passing change could also be caught by a
// leader braking. Probe (scratchpad stopdev_eval.js, 30 s within 600 m of 125th & Lenox): 36 % of stopped car-frames
// stood more than 2 deg off their lane and 28 % more than 5 deg, 94 % of those mid lane change. A car now moves over
// only while rolling and into a gap (10 m of its new lane clear for a turn, 14 m to pass), and one about to stop mid
// change either finishes it more steeply, up to 14 deg, square 5 m short, or eases its sideways motion out over its last
// metres and stops parallel to the lanes, straddling. (Holding every change to 25 m of clear road left cars short of
// their turn lanes, and those that turned from the wrong lane crossed the others in the box.) `?vq30=0` restores VT30.
const VQ30 = VT29 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('vq30') !== '0');
// VQ31: VQ30 still left 5.6 % of the stopped car-frames more than 2 deg off their lane (stopdev3; VQ30 v1's 25 m rule
// had 0.65 %), nine in ten of them mid lane change. A car learnt its next turn only 34 m from the junction, inside the
// queue when the queue was longer, and then moved over between stops; and a change needs room to finish (one lane at
// 8 deg is 23 m of travel) plus room for the towed axle to straighten (a 14 deg body keeps 2 deg after 5 m). A car now
// picks its turn on entering the street (up to 160 m out); a turn-lane or passing change starts only with its own road
// and the new lane clear for the whole change plus 6 m; at a crawl it noses over more steeply, up to 15 deg below 3 m/s
// (8 deg from 8 m/s, as before), the way drivers edge over in slow traffic; and one about to stop finishes 8 m short
// (was 5) or ends its sideways motion 6 m short (was 3). A car kept out of its turn lane goes straight at the mouth, as
// before. `?vq31=0` restores VQ30.
const VQ31 = VQ30 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('vq31') !== '0');
// OV32 (owner 2026-09-29 on film 16's Lenox night swipe: "one turning vehicle clips through another during the turn. In
// general in a simulator like this we should be careful to avoid silly mistakes like this"): nothing kept two bodies apart
// in a junction box but rules for particular pairs, decided at the stop bar. A car on its connector followed only the car
// ahead in its own target lane and on its own connector; once past the stop bar it drove through anything else on its
// path. The take: a sedan waiting on the link across Lenox's median to turn left, a van turning left from the lane beside
// it and through it. Census (scratchpad ov32_eval9k.js, 300 s round the 125th St boxes, four runs): 4-14 overlap events,
// 2-7 of them 0.5-3.8 m deep, of two kinds: two cars from one arm whose connectors cross (a turn from the wrong lane; no
// rule compares cars of one arm), and a car driving into one standing on its path (at the end of its connector, on a
// short interior link).
//   The sweep: every car on a connector moves its own body (grown 0.1 m, at the heading it will have at each point, its
// rear axle towed behind; past the connector's end along the lane it enters) over the rest of its path, as far as it
// needs to stop and 3 m more, and brakes to stand short of the first other body it would touch, whatever that car is
// doing (a follower behind it excepted). At the stop bar a car does not enter the box while a standing body lies across
// its path through it.
//   Holding still for bodies alone gridlocked the boxes (junction passes 46-51 in 300 s -> 9-27 in half the runs), each
// jam a wait on a wait: a car standing on the 15 m link across a divided avenue's median, its rear in the carriageway it
// had crossed, waited by the heading rules (a)-(d) for the traffic now stopped for it; two cars on connectors into one
// lane each took the other for its leader (s compared along connectors of different lengths); a pair each on the other's
// path. So: a car that stands in the path of one in the box, or that the rules (a)-(d) alone have held for 10 s, goes as
// soon as its own way is physically clear; on two connectors into one lane the one with less connector left leads; a
// pair held in each other's way passes after 6 s where no camera sees it (sim/spawnGuard.js viewGuard) and after 20 s
// anywhere (counted: ovUnseen, ovSqueeze); and a car that has stood 40 s out of sight, neither at a red light nor behind
// another car, is recycled (ovRecycled). Three runs: passes 46, 46, 46, cars standing over 30 s at the end 0 (7-20
// before), overlap events 2-4, nearly all out of sight. `?ov32=0` restores the old junction.
const OV32 = typeof location === 'undefined' || new URLSearchParams(location.search).get('ov32') !== '0';
const OV_M = 0.1;
// CP32 (city/centralPark.js): Central Park's drives have been closed to cars since June 2018 (the transverse roads under
// the park still carry traffic), but CSCL codes East, West, Center and Terrace Drive, the entrance and exit spurs, a path
// and Bow Bridge as ordinary roadways, so cars drove the loop, parked along it and crossed the Lake on the footbridge. No
// car is spawned, routed or parked on them. `?cp32=0` restores.
const CP32T = typeof location === 'undefined' || new URLSearchParams(location.search).get('cp32') !== '0';
const cpDrive = (r) => {
  const n = r.name || '';
  if (!CP32T || !(/^(EAST|WEST|CENTER|TERRACE) DR$/i.test(n) || /^THE MALL$/i.test(n) || (/^CENTRAL PARK /i.test(n) && !/^CENTRAL PARK (W|S|N|WEST|SOUTH|NORTH)$/i.test(n)))) return false;
  const q = r.pts[r.pts.length >> 1];
  return q[0] > -960 && q[0] < 1900 && q[2] > -2000 && q[2] < 2150;
};
// kerbs; the twin had 0-2 per block face). Three causes, measured with tools/ar34/vehicles/sim/park_probe.mjs on the
// compiled tiles: (1) the occupancy hash |sin(...)| > 0.74 is not uniform (|sin| piles up near 1) and refused 283 of 588
// slots on 125th (48 %, not the 26 % its comment said); (2) the slots on the compiled `busred` were refused (76 of 588),
// and from Frederick Douglass to ACP and from Third to Second Avenue the compiled red lane lies AT the kerb, where the
// parked LOD rebucket kept the first 320 records per kind in tile-load order, so in a batch render the tiles streamed for
// earlier views took the cap and the camera's own block got none. On 125th Street (CSCL "W 125 ST" / "E 125 ST") the kerb
// first, then sedans, full-size vans, black livery cars), the compiled kerbside red taken as the kerb lane it really is,
// no car in a bus-stop zone (PROPS' surveyed stop signs and shelters, and the MTA GTFS stops, BUS125 below) or within
// 15 ft of a hydrant (PROPS' survey); each kind stands off the kerb by its own wheel track. The rebucket keeps the
// records nearest the camera, everywhere. `?pk34=0` restores all of it.
const PK34 = typeof location === 'undefined' || new URLSearchParams(location.search).get('pk34') !== '0';
// PK41 (TRAILERUE 2026-10-08, for the lead: the trailer's vehicle check found parked cars inside each other on 125th
// Street, two SUVs 0.29 m deep on Morningside, a Lincoln, a Charger and an SUV 1.3-2.0 m into the 26 ft box trucks'
// rears): PK34's packer took each slot's length from vlen(), and a tile that parks before fleet24 has published its sizes
// gets the hand table there (no suv, charger, lincoln, mercedes, mini, cargovan or boxtruck26 in it: 4.6 m), so the 9.84 m
// box truck took a 4.6 m slot. Each slot now takes the drawn model's length (fleet24's kind size, or twice its LOD0 body's
// longer reach) plus the gap, and a 125th Street tile parked before those sizes existed parks again once they do (in
// update(), at boot: a take's settle and warm-up come later). `?pk41=0` restores the old packing.
const PK41 = typeof location === 'undefined' || new URLSearchParams(location.search).get('pk41') !== '0';
// OV41 (TRAILERUE 2026-10-08): drawnOverlaps(), the recorder's CAR-OVERLAP test, skipped pairs of two parked bodies, so the
// packer's overlaps never showed in a take's log; they are tested too now (tagged "(parked)" on both sides, which
// tools/ad/record.mjs fails a take on). `?ov41=0` restores the skip.
const OV41 = typeof location === 'undefined' || new URLSearchParams(location.search).get('ov41') !== '0';
// STREET's repaint of the kerbside red (sk/skBus.js SK_BUS_ON: off with `?skbus=0` or `?sk=0`, the compiled paint): with
// the compiled paint the red stays a lane
const SKBUS = typeof location === 'undefined' || !['skbus', 'sk'].some((k) => new URLSearchParams(location.search).get(k) === '0');
const C125 = /^(W|E) 125 ST$/;
// 125th Street's parked mix (weights; a kind missing from the loaded fleet drops out)
// the NYPD's Police Interceptor Utility join it (their weights are rules too)
// (batch 1: the fleet's only SUV is CARLA's full-size Patrol, so at 34 the same body stood two and three in a row where the
// docs/notes/ar34-vehicles.md "Q53 kerb counts": 5 full-size or high-roof vans (4.5 %) and 5 box or step trucks (4.5 %);
// the mix had vans at 16 % (van 9 + cargovan 5 of 88), and the tall bodies are what hides a ground floor from across the
// street. Vans 9 -> 3, cargo vans 5 -> 2; the trucks stay)
const PARK125 = { suv: 22, charger: 9, impala: 4, mercedes: 10, mini: 4, model3: 8, lincoln: 10, van: 3, cargovan: 2, boxtruck: 1, boxtruck26: 2, taxi2: 1, police: 0, nypd: 1, auditt: 1 };
// NV34: 125th Street's moving traffic carries more working vehicles than the city's mix: a share of the spawns on its edges
// ...and its lanes carry more of the traffic than a side street: a share of all spawns picks a 125th Street edge (the
// captures show queues in every lane at midday, the twin's spawns were spread evenly over every street in reach; a rule,
// not a count). `?c125sp=0` off.
const C125_SPAWN = typeof location !== 'undefined' && new URLSearchParams(location.search).get('c125sp') === '0' ? 0 : 0.3;
const MOVE125 = { share: 0.22, bag: { cargovan: 5, stepvan: 4, boxtruck26: 3, uspsllv: 2, uspsngdv: 1, dsny: 1, schoolbus: 1, nypd: 1, taxinv200: 1 } };
const DP125 = { van: 0.2, boxtruck: 0.2, cargovan: 0.2, stepvan: 0.35, boxtruck26: 0.25, uspsllv: 0.5, uspsngdv: 0.5 };
const DPK = new Set(['vwvan', 'sprinter', 'van', 'cargovan', 'stepvan', 'boxtruck26', 'uspsllv', 'uspsngdv']);
// BUS125: the bus stops on 125th Street from MTA's Manhattan bus GTFS (feed of 2026-08-24, stops.txt / stop_times.txt;
// docs/notes/ar34-vehicles.md): [x, z, direction of travel (E/W, from the trips' direction_id and headsign), routes].
// Routes on 125th in that feed: the M60 SBS (Amsterdam to Second Avenue), the M101 (Amsterdam to Third / Lexington), the
// M125 (the whole street, 12th Avenue to First Avenue and on to The Hub; BUS40's 19:53 request) and the M100 (Amsterdam
// to St Nicholas); the Bx15 runs in the Bronx only. A stop's point lies anywhere from the centreline to the walk (2.8-8.1 m
// off it), so its kerb comes from its direction: eastbound stops on the south kerb, westbound north.
const BUS125 = [
  [963.0, -3774.6, 'E', 'M125'], [985.9, -3789.8, 'W', 'M125'], [1064.7, -3675.7, 'W', 'M125'],
  [1110.0, -3567.1, 'E', 'M125'], [1147.4, -3553.1, 'W', 'M125'], [1248.2, -3399.9, 'W', 'M125'],
  [1307.1, -3278.6, 'E', 'M100 M101 M125'], [1434.3, -3145.3, 'E', 'M101 M125'],
  [1533.5, -3101.1, 'W', 'M100 M101 M125'], [1603.7, -3047.9, 'E', 'M60'], [1634.8, -3030.7, 'E', 'M101 M125'],
  [1649.6, -3034.1, 'W', 'M60'], [1652.3, -3034.1, 'W', 'M101 M125'], [1727.5, -2979.2, 'E', 'M101 M125'],
  [1889.7, -2903.7, 'W', 'M101 M125'], [1969.4, -2845.0, 'E', 'M101 M125'], [2127.1, -2770.1, 'W', 'M101 M125'],
  [2130.2, -2770.1, 'W', 'M60'], [2202.1, -2713.2, 'E', 'M60'], [2206.2, -2713.2, 'E', 'M101 M125'],
  [2424.2, -2605.2, 'W', 'M101 M125'], [2473.7, -2567.3, 'E', 'M101 M125'], [2545.6, -2542.6, 'W', 'M101 M125'],
  [2604.9, -2493.0, 'E', 'M101 M125'], [2606.3, -2492.8, 'E', 'M60'], [2674.1, -2467.2, 'W', 'M101 M125'],
  [2676.9, -2467.2, 'W', 'M60'], [2681.5, -2448.1, 'E', 'M101'], [2742.6, -2414.3, 'E', 'M125'],
  [2818.6, -2387.6, 'W', 'M101 M125'], [2821.1, -2387.6, 'W', 'M60'], [2889.9, -2335.1, 'E', 'M60'],
  [2948.4, -2315.4, 'W', 'M101 M125'], [3014.5, -2265.4, 'E', 'M125'], [3127.9, -2213.0, 'W', 'M60'],
  [3134.8, -2211.6, 'W', 'M125'], [3145.6, -2193.5, 'E', 'M125'], [3154.1, -2188.5, 'E', 'M60'],
  [3342.1, -2077.5, 'E', 'M125'],
];
// BUS34 (AR34 VEHICLES): route buses on 125th Street. A bus is spawned on a 125th edge in the kerb lane of travel (the red
// lane; STREET repaints the compiled kerbside red one parking lane out, where the sim's kerb travel lane already runs),
// keeps that lane and keeps to 125th at every junction, pulls up with its front at each stop of its route (BUS125) and
// dwells there (SBS: all-door boarding, off-board fares; locals: front-door boarding), and leaves the corridor like any
// car at its end. Kinds per route: the MTA models when they are in the fleet (BUS60: the M60's articulated XD60; BUS40:
// the 40 ft XD40 and LFS of the locals), the fleet's minibus until then. `?bus34=0` turns it off.
const BUS34 = typeof location === 'undefined' || new URLSearchParams(location.search).get('bus34') !== '0';
// TP34 (AR34 VEHICLES): after the camera jumps (a teleport: bshot's --onepage views, a map jump) the streets around it get
// the first-20-s fill again for 20 s (cars from 25 m, weighted toward the camera, up to 30 % over the target while the cars
// left behind drive out of the despawn ring): the later views of a batch showed 125th Street's lanes nearly empty (sbs_b1
const TP34 = typeof location === 'undefined' || new URLSearchParams(location.search).get('tp34') !== '0';
// BL34 (AR34 VEHICLES, QA Q57 2026-10-02: in the teaser key t5ApolloDive_k1 about ten cars, vans and a cab stood nose to tail
// in the westbound red bus lane in front of the Apollo while the general lane beside them held three). Three causes in the
// lane choice: every car was spawned in a random lane of its direction, the red one included (half of 125th Street's
// traffic); a right turn put the car in the kerb lane from the moment it picked the turn (VQ31: up to 160 m out); and a car
// that came up behind a standing vehicle (a double-parked van, a bus at its stop) never passed it: the pass asked for a gap
// under 14 m and, with the leader standing, over the change's own room (18-30 m), both at once. Where a direction's kerb
// travel lane is a red bus lane (the surface under the lane's centre along the edge, after STREET's repaint), a vehicle
// that is not a bus now spawns in the other lanes, moves into the red lane only for a right turn at the next corner (from
// BL_RIGHT m out), leaves it otherwise and never passes into it; route buses keep it but pass a double-parked vehicle in
// the next lane and come back. Everywhere, a car closing on a double-parked vehicle or a dwelling bus standing in its lane
// moves out while it still has the room for the change (from BL_LOOK m back). `?bl34=0` restores.
const BL34 = typeof location === 'undefined' || new URLSearchParams(location.search).get('bl34') !== '0';
const BL_RIGHT = 60, BL_LOOK = 60, DP_RED = 0.33;
// VC36 (AR34 VEHICLES, owner 2026-10-02: "I also see in one of the shots a vehicle colliding into the back of a truck"). An
// audit of every pair of DRAWN bodies (tools/ar34/vehicles/sim/ov36_audit.js: each kind's LOD0 plan box with its own
// overhangs, the articulated rear body at the angle fleet24 draws, parked records; every fixed 1/30 s step of a take's
// warm-up, path and 10 s more, run as record.mjs runs it) found the drawn lengths right (every kind's model is centred on
// its pose; the MTA buses reach 0.3 m past their nominal half length) and these causes, worst first:
//   (1) spawns inside a junction's mouth: a car spawned within a mouth of the end of its edge went straight to the box
//       test, was pinned on the mouth trigger and took its connector from there, at s 0 in the very spot the car before it
//       had taken; the spawn test looks only at cars on the same edge, and those had left it. The stacked bodies each saw
//       the other as a body on its path (OV32), so the stack never moved and every spawn there joined it (Broadway /
//       125th: ten vans, a step van, a minibus and SUVs in one place for the whole t5ValleyArch take, 65 m from the lens);
//       the warm-up's fill and TP34's refill spawn from 25-40 m, so these stacks stood in the takes. Spawns now keep 9 m
//       clear of either mouth and need a clear box (the new body grown 2.5 m each end, 0.4 m each side) among every
//       body near, connectors included;
//   (2) a body already inside the car ahead was dropped as its leader (the gap had to be over -2 m) and was driven
//       through: a leader whose centre is ahead counts however deep the overlap;
//   (3) an OV32 sweep that met a body it already overlapped at its start (a stack, a spawn) waited for it for ever: a body
//       level with or behind the start is not in the way; of two level ones the lower (kind, idx) goes first;
//   (4) a car on its edge followed a turning truck by the distance along the path, so it drove into the truck's rear,
//       still across its lane in the turn (125th & Lenox: a step van turning, a Charger 2.6 m into its side): near the
//       mouth an edge car now also stands short of any other body in the lane ahead of it (its own body swept forward);
//   (5) lane changes asked 11-13 m between centres, which a bus or a long truck fills (an articulated bus and a car touch
//       at 12.1 m): the room is now the two bodies' own reach plus 1.5 m where that is more;
//   (6) parked records standing in a travel lane (Hunters Point, a skewed corner near Broadway): left out (_parkIntrudes).
// `?vc36=0` restores all of it.
const VC36 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vc36') !== '0';
// NP36 (STATIONS 2026-10-02): no parked record over the 1 train station's laid east sidewalk on Broadway (the compiled east
// kerb lane runs ~3.5 m too wide there: recompile item 16); boxes [x0, z0, x1, z1]. `?np36=0` as before
const NP36 = VC36 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('np36') !== '0');
const NOPARK36 = [[1060, -3590, 1095, -3548]];
// VN36 (the lead's safety net, 2026-10-02 09:23): whatever a rule above let through, a car's body never moves INTO another:
// before a car on its edge or on its connector is placed, its body at the new pose (mirrors aside) is tested against the
// bodies near it that lie ahead of its motion; if it would enter one, it stays where it was this frame and stops. Out of
// sight, a car held so for 6 s goes on (a jam no camera sees clears; in sight it stands). `?vn36=0` off.
const VN36 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vn36') !== '0';
// VF36 (AR34 VEHFIX, 2026-10-02; found measuring teaser 8's t8StNickDiveE, where a cab seemed to stand inside a 26 ft box truck
// at the light on 125th at St Nicholas, most likely a cab queued behind the box and hidden by it): a DEAD car (no connector out
// of a one-way edge's end, a connector refused as a routing fault, or stranded on a fragment) stayed drawn until the lens was
// 260 m away, and every body test
// skipped it (OV32's grid and sweeps, VN36, the spawn test, the recorder's check): cars drove and spawned into it. Its sim
// place was not its drawn one either: it was never placed again, while IDM crept its d on to the edge's end, so a follower
// stood at its follow gap from a point up to 5 m ahead of the body (60 s at the take's key 0: a van dead at d 107 drawn 3.7 m
// ahead of an ambulance's centre, 2.5 m deep, in view at 221 m; a dead taxi2 1.6 m into a box truck's nose at 112 m). Now a
// dead car is recycled as soon as no camera sees it (and during a recorder's warm-up, when spawning in view is allowed too),
// one in sight stands where it is drawn with its d taken from that pose, and every body test counts it. `?vf36=0` as before.
const VF36 = typeof location === 'undefined' || new URLSearchParams(location.search).get('vf36') !== '0';
const VF_REC = typeof location !== 'undefined' && new URLSearchParams(location.search).get('record') === '1';
// TN38 (owner 2026-10-04 on teaser 8's Cycles cut, t8LenoxDive at 0:25: "The red van in bottom left turns by getting on the
// central sidewalk area in the street"): the van, a cargovan in the kerb lane of Lenox's northbound carriageway, made a
// U-turn into the southbound one round the south leg's median, its wheels on the median's nose in 59 of the take's 108
// frames. A connector is one cubic from the car's place at its mouth to the next lane's entry, and nothing kept it on the
// carriageway: the surface test took six points 1.1 m inside the curve's centre line, so the body's outer side, the first
// and last eighth of the curve, the rear wheels' off-tracking and the body centre were never tested; when every candidate
// failed, the last failing one was driven anyway; VT30's wider shapes and both-sides test ran only for the kinds BIGV
// names, not for the cargovan, step van, box truck 26 or the MTA buses. A junction cluster spans both carriageways of a
// divided avenue, so a U-turn, a left onto the short link across the median from a far lane, or a continuation onto an arm
// at the cluster's far side has a median, a nose or a block corner between its ends, and the cubic cut across it. Probe
// (180 s of the take's boot at t8LenoxDive's first key, every vehicle in the sim, four staged U-turns from the van's lane):
// 96 vehicles stood with a wheel hub or their centre on a sidewalk, a median or a planting bed, 91 of them on a connector,
// up to 10 s each. Now every connector is driven in advance the way _placeCar will drive it (VT29's body from its own
// heading at the mouth: the centre on the curve, the rear axle towed lr behind, the 75 deg bound, the run-out onto the
// tangent), then lr + 1.5 m into the new lane, and every 0.4 m each wheel hub of the kind (0.12 m further out: the tyre's
// outer half) and the body centre must be off every non-road surface at the car's level. A failing shape is replaced by
// the best passing one of a family of asymmetric handles (0.15-1.25 x the chord) with the controls swung 1 m inside to 3 m
// outside the turn (3 m either way for a U-turn), the widest tightest bend up to the 2.84 lr the kind's lock can follow
// winning (1 m of extra path costing 2 cm), kept per (edge, direction, lane, next edge, size) for the next car. If none
// passes, the connector is refused: the car stays at its mouth and takes another continuation, and that continuation is
// struck from the choices of every car in that lane (a one-way arm left with no way out stands its car down as a dead car,
// as before). VT30's shapes and lock radius apply to every vehicle over 5.5 m long. Same probe after: 8 vehicles, none on a
// connector (all on one edge 930 m out whose street runs over a compiled sidewalk); 75 continuations of 3,367 connectors
// struck, 12 reshaped; the U-turn from the van's lane is refused; the sim's step time unchanged within the noise. The
// recorder's CAR-OFFROAD check and clearance.mjs's vehicle audit (offRoad below) fail a take with a vehicle's wheel or
// centre on a non-road surface in view. `?tn38=0` restores the old connectors (the check stays).
const TN38 = typeof location === 'undefined' || new URLSearchParams(location.search).get('tn38') !== '0';
// VC36 (g): OV32's last resort let a car held 20 s by a standing body drive through it, in sight too, and a car behind a
// queue standing across the junction is held that long by a body that is no deadlock at all: FILM 09:13, the owner's case
// in teaser 4 v3's t4Sheep, a Lincoln on its connector driven into the rear of a box truck standing in a queue (frames
// 35-70). A body ahead going my way is a queue and is waited for; in sight nothing is passed through.
// (else the routes' weights) stands in its kerb lane with its front at the 125th Street point nearest (x, z), on the kerb
// of that side, for good (staged again if it despawns while the camera is away). Off by default.
// `?vehat=<kind>,<x>,<z>[;<kind>,<x>,<z>...]` (stills, like busat): a vehicle of that kind stands double-parked for good in
// the kerb travel lane of the street nearest (x, z), its centre there, travelling on that side's direction (a pair whose
const VEHAT = (() => {
  if (typeof location === 'undefined') return [];
  return (new URLSearchParams(location.search).get('vehat') || '').split(';').map((t) => t.split(','))
    .filter((v) => v.length >= 3 && Number.isFinite(+v[1]) && Number.isFinite(+v[2]) && v[1] !== '')
    .map((v) => ({ kind: v[0], x: +v[1], z: +v[2], car: null }));
})();
const BUSAT = (() => {
  if (typeof location === 'undefined') return null;
  const v = (new URLSearchParams(location.search).get('busat') || '').split(',');
  return v.length >= 2 && Number.isFinite(+v[0]) && Number.isFinite(+v[1]) && v[0] !== '' ? { x: +v[0], z: +v[1], route: v[2] || null, kind: v[3] || null } : null;
})();
// route weights: the same feed's trips an hour past W 125 St / Malcolm X, E 125 St / Lexington and W 125 St / Amsterdam,
// 12:00-13:00 on 2026-10-01 (the service ids active that day only; counting every weekday calendar doubled them): M60 SBS
// 6 each way, M101 6-8, M125 7 (the M100's weight is a guess: its 125th stops were not counted). [route, weight, kinds,
// x from, x to] (the stretch of 125th it runs on, from its stops in BUS125)
// half each (one capture is one bus: the share is not measured)
// (session 2: the M101 and the M125 also on the white LFS Artic `mtalfsal` and the M125 on the SBS XD60, BUSES 00:08 / 00:13:
// LFS Artics 5821 / 5979 on the M101 at Lexington / 92nd 2019-02, LFS Artic 1207 on the Bx15 at Park Av 2020-01, XD60 6221
// kind per bus, picked evenly: the shares are not measured)
const BUS_ROUTES = [['M60', 6, ['mtalfsa', 'mtaxd60'], 1290, 3200], ['M101', 7, ['mtalfsal', 'mtaxd40', 'mtalfs'], 1290, 3000], ['M125', 7, ['mtalfsal', 'mtaxd60', 'mtalfs'], 900, 3400],
  ['M100', 2, ['mtaxd40', 'mtalfs'], 1290, 1560]];
const BUS_PER_KM = 2.0;   // per direction: ~20 buses an hour (the feed) at an assumed ~10 km/h (the speed is not measured)
// a no-standing zone per stop along the kerb, metres from the stop point against / with the flow (the bus pulls up with
// its front at the sign; an articulated bus is 18.3 m)
const STOP_ZONE = [30, 7];
// one space in PK_FREE left free on a packed kerb (Q53: the packed faces of the counted crops had a free space every 8-15
// cars, besides the stops, hydrants and the clear kerbs below; it was one in 25)
const PK_FREE = 0.08;
// the kerb, metres), kerb 'N' | 'S', source]
const NOSTAND125 = [
  // EAST 02:20: the south kerb from 118 E 125th (NMRC) to Lexington Avenue, corridor stations 2551-2610 (sk/skGeom.js LINE,
  // 8 m south): a stop with a NO STANDING ANYTIME plate in front of Popeyes and an empty kerb along the mural hoarding
  [2782.6, -2392.0, 2834.2, -2363.4, 'S', 'EAST 02:20'],
  [1761.7, -2978.0, 1782.7, -2966.3, 'N', 'Q53 2024-08 8TfYv918'],
  [2847.3, -2356.1, 2904.2, -2324.5, 'S', 'Q53 2026-08 SPzcJJuT'],
  [2916.3, -2336.1, 2964.4, -2309.4, 'N', 'Q53 2026-08 SPzcJJuT'],
  [3108.5, -2229.0, 3153.0, -2204.2, 'N', 'Q53 2026-08 yDVJtToU'],
];
// integer hash -> [0, 1) (uniform, unlike |sin|)
const hash01 = (a, b = 0, c = 0) => {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35) ^ Math.imul(c | 0, 0x27d4eb2f);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
// PROPS' surveyed hydrants on 125th (city/pk/pkData.js, read-only): loaded once, a missing or broken module costs nothing
// ...and its surveyed bus-stop signs and shelters: a GTFS stop point lies up to ~28 m from the real sign (E 125 St / 2 Av
// westbound: GTFS 3127.9 vs the sign at 3099.8), so the kerb zones and the dwell points follow the signs where there is one
let HYDRANTS = null, BUSSIGNS = [], SHELTERS = [];
const HYD_P = import('../city/pk/pkData.js')
  .then((m) => {
    const it = m.PK_ITEMS || [];
    HYDRANTS = it.filter((q) => q[0] === 'hydrant').map((q) => [q[1], q[2]]);
    BUSSIGNS = it.filter((q) => q[0] === 'busSign').map((q) => [q[1], q[2]]);
    SHELTERS = it.filter((q) => q[0] === 'shelter').map((q) => [q[1], q[2], (q[4] && q[4].len) || 4.5]);
  })
  .catch(() => { HYDRANTS = []; });
// its parts, for the A/Bs: `?vq31e=0` picks the turn 34 m out as before, `?vq31t=0` keeps the 8 deg path at a crawl
const VQ31E = VQ31 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('vq31e') !== '0');
const VQ31T = VQ31 && (typeof location === 'undefined' || new URLSearchParams(location.search).get('vq31t') !== '0');
// VQ31: the tangent of the steepest lane-change path at speed v, and the forward room a change of `lanes` lanes of width
// lw needs at it, plus the 6 m a towed axle takes to come square
const lcTan = (v) => (VQ31T ? 0.268 - (0.268 - 0.1405) * Math.max(0, Math.min(1, (v - 3) / 5)) : 0.1405);
const lcRoom = (v, lw, lanes = 1) => (Math.abs(lw) * lanes) / lcTan(v) + 6;
const CG = 10;   // car grid cell (m)
// for the offline probes (tools/ar34/vehicles/sim/): the tables the corridor rules read
export const PK34_TABLES = { VLEN, PARK125, BUS125, STOP_ZONE, hydrants: () => HYDRANTS, ready: () => HYD_P };

export class Traffic {
  constructor(scene, streamer, fleet = null) {
    this.scene = scene;
    this.streamer = streamer;
    this.edges = new Map();
    this.nodes = new Map();
    this.signals = new Map();
    this._nkGrid = new Map(); // canonical junction clustering (see _canon)
    this.cars = [];
    this.target = CAR_TARGET; // scenario-configurable
    this.time = 0;
    this.edgeIdSeq = 1;
    const geos = buildVehicleGeos();
    // vehicle material classes (vehicles.js splits the CARLA GLBs by material name):
    // clear-coated paint (per-instance colour), dark trim, and the extras below. One
    // InstancedMesh per class, all riding the same instance matrices (pool.mx).
    const PART_MATS = {
      // glass: a DIELECTRIC, not black chrome. metalness 0.92 made the windows
      // mirrored black holes with no fresnel falloff; a dark tint with clearcoat
      // gives the sky reflection on top and a dark cabin under it.
      glass: () => new THREE.MeshPhysicalMaterial({ color: 0x0b0f14, roughness: 0.045, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.03, reflectivity: 0.85, envMapIntensity: 1.9 }),
      chrome: () => new THREE.MeshStandardMaterial({ color: 0xe4e8ea, roughness: 0.16, metalness: 1.0 }),   // brightwork + hub caps
      trim: () => new THREE.MeshStandardMaterial({ color: 0x6f767c, roughness: 0.44, metalness: 0.85 }),    // structural metal (bike frames, bed rails)
      // VH13: body2 is PAINT — same trim and the same metalness-0 treatment as the
      // main body, or a VW T2's white roof blew out while its lower half did not
      body2: () => (VH13
        ? vhTrim(new THREE.MeshPhysicalMaterial({ color: 0xe7e8e3, roughness: 0.38, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05 }), PAINT_DAY)
        : new THREE.MeshPhysicalMaterial({ color: 0xe7e8e3, roughness: 0.34, metalness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.08 })),
      // VH13 LENSES. roughness 0.07 under a clearcoat made a headlamp a MIRROR, and
      // what a headlamp on a parked car mirrors is the asphalt: the Tesla's lamps
      // read as two black-green pods in the owner's frames. A real lens is a rough
      // optic over a bright reflector — it stays pale from every angle. `emissive`
      // is the lamp itself and is driven from ENV.night per pool in update(), so it
      // is OFF by day and OFF on parked cars at any hour (brief: no glow on parked
      // cars), where before both classes carried a constant emissive all day long.
      light: () => (VH13
        ? new THREE.MeshPhysicalMaterial({ color: 0xe8edf1, roughness: 0.26, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.055, emissive: 0xfff0d6, emissiveIntensity: 0 })
        : new THREE.MeshPhysicalMaterial({ color: 0xf1f4f6, roughness: 0.07, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.04, emissive: 0x202226 })),
      tail: () => (VH13
        ? new THREE.MeshPhysicalMaterial({ color: 0x7e0f0f, roughness: 0.22, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.06, emissive: 0xff2008, emissiveIntensity: 0 })
        : new THREE.MeshPhysicalMaterial({ color: 0x8f1111, roughness: 0.1, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.05, emissive: 0x350505 })),
      tire: () => (VH13
        ? vhTrim(new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.88, metalness: 0.0 }), TRIM_DAY)
        : new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95, metalness: 0.0 })),
      plate: () => (VH13
        ? vhTrim(new THREE.MeshStandardMaterial({ color: 0xffffff, map: plateTexture(), roughness: 0.42, metalness: 0.0 }), TRIM_DAY)
        : new THREE.MeshStandardMaterial({ color: 0xe6dfc6, roughness: 0.55, metalness: 0.05 })),
    };
    const mkPool = (body, dark, cap, parts = null) => {
      // VH13 PAINT. `metalness: 0.35` put a 37 % mirror over every body panel
      // (F0 = mix(0.04, base, 0.35)) on top of an already-full clearcoat, so the
      // sky won the surface and a neutral white car measured 109,141,174 —
      // B/R 1.6, the critic's "pale blue-white clay ... environment reflection
      // beating the base albedo" (critic-r13 runners-up). Solid car paint is a
      // DIELECTRIC: the flake lives in the base coat's roughness, the gloss in
      // the clear coat, and neither is metalness. Plus the albedo trim above.
      const mb = new THREE.InstancedMesh(body, VH13
        ? vhTrim(applySnowCap(new THREE.MeshPhysicalMaterial({ roughness: 0.38, metalness: 0.0, clearcoat: 1.0, clearcoatRoughness: 0.048, envMapIntensity: 0.9 })), PAINT_DAY)
        : applySnowCap(new THREE.MeshPhysicalMaterial({ roughness: 0.30, metalness: 0.35, clearcoat: 1.0, clearcoatRoughness: 0.06 })), cap);
      const md = new THREE.InstancedMesh(dark, VH13
        ? vhTrim(applySnowCap(new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.62, metalness: 0.08 })), TRIM_DAY)
        : applySnowCap(new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.62, metalness: 0.08 })), cap);
      mb.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      const mx = [];
      let lampL = null, lampT = null;   // VH13: driven from ENV.night, moving pools only
      for (const [k, g] of Object.entries(parts || {})) {
        if (!g || !PART_MATS[k]) continue;
        const mat = applySnowCap(PART_MATS[k]());
        if (k === 'light') lampL = mat; else if (k === 'tail') lampT = mat;
        const m = new THREE.InstancedMesh(g, mat, cap);
        m.name = `vehpart:${k}`;
        mx.push(m);
      }
      for (const m of [mb, md, ...mx]) { m.frustumCulled = false; m.count = 0; m.castShadow = true; scene.add(m); }
      return { mb, md, mx, cap, n: 0, lampL, lampT };
    };
    if (fleet) {
      // CARLA fleet: one pool per model; spawn picks from a weighted bag
      this.pools = {};
      this.kindBag = [];
      // VH13 — MEASURE THE FOLLOWING LENGTHS OFF THE MODELS. VLEN was hand-written
      // and then drifted from the fleet: it still said 11.6 m for a bus that has
      // been a 6.6 m Fuso Rosa since the 0.645 scale correction, and 7.2 m for a
      // 5.2 m CarlaCola. followGap() is the distance at which two bumpers touch,
      // so every bus drove with a five-metre hole in front of and behind it.
      if (VH13) {
        const bb = new THREE.Box3(), sz = new THREE.Vector3();
        for (const [k, f] of Object.entries(fleet)) {
          if (k.startsWith('__') || !f?.paint) continue;
          bb.makeEmpty();
          for (const g of [f.paint, f.dark]) {
            const pa = g?.getAttribute('position');
            if (pa && pa.count > 24) bb.union(new THREE.Box3().setFromBufferAttribute(pa));
          }
          if (bb.isEmpty()) continue;
          bb.getSize(sz);
          if (sz.z > 1.5 && sz.z < 14) VLEN[k] = +sz.z.toFixed(2);
        }
      }
      for (const [k, f] of Object.entries(fleet)) {
        if (k.startsWith('__')) continue;
        this.pools[k] = mkPool(f.paint, f.dark, f.cap, f.parts);
        // two-wheelers stay out of the moving bag until they carry riders: an upright rider-less
        // motorcycle in a travel lane reads as broken (fleet-qa.md open item 2)
        if (k !== 'bus' && !/^(harley|vespa|yamaha)$/.test(k)) for (let i = 0; i < f.w; i++) this.kindBag.push(k);
      }
    } else {
      this.pools = { sedan: mkPool(geos.sedanBody, geos.sedanDark, 270), van: mkPool(geos.vanBody, geos.vanDark, 70), bus: mkPool(geos.busBody, geos.busDark, 24) };
      this.kindBag = null;
    }
    // static parked fleet along curbs — full CARLA models inside 120m, ~2k-tri
    // CARLA collision shells beyond (measured: the six full-res parked pools at
    // cap were the frame's single largest triangle sink, ~36M tris per pass)
    this.parkedRecs = new Map(); // tileKey -> [{kind, x, z, m, color}]
    this._parkDirty = true;
    this._pbX = 1e9; this._pbZ = 1e9;
    const mkShell = (geo, cap) => {
      // VH13: the shell is the SAME CAR seen past 120 m, so it has to answer the
      // light the same way the near model does or the swap reads as a brightness
      // pop. roughness 0.55 / metalness 0.35 against the near paint's 0.38 / 0.0
      // + clearcoat made the far half of every street duller and bluer; it takes
      // the paint trim too. (The 0.82 instance-colour darkening stays: it stands
      // in for the glass and wheels the collision hull does not have.)
      const m = new THREE.InstancedMesh(geo, VH13
        ? vhTrim(applySnowCap(new THREE.MeshStandardMaterial({ roughness: 0.36, metalness: 0.0 })), PAINT_DAY)
        : applySnowCap(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.35 })), cap);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3).fill(1), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      return m;
    };
    if (fleet) {
      this.parked = {};
      this.parkedKinds = [];
      // PV2 (sim/fleet24.js): a fleet may carry its own WEIGHTED parked list (a kind repeats = its weight); one pool
      // per distinct kind either way
      for (const k of fleet.__parkedKinds || ['tesla', 'crown', 'prius', 'micra', 'jeep', 'vwvan']) {
        if (!fleet[k]) continue;
        if (!this.parked[k]) this.parked[k] = { ...mkPool(fleet[k].paint, fleet[k].dark, 320, fleet[k].parts), shell: fleet[k].shell ? mkShell(fleet[k].shell, 320) : null };
        this.parkedKinds.push(k);
      }
      // PK34: 125th Street's weighted parked bag (a kind it lists that has no parked pool yet gets one) and each kind's
      // wheel track (the hubs' |x|), so a wide body stands as far off the kerb as a car does
      this._hubX = {};
      for (const [k, f] of Object.entries(fleet)) {
        const hubs = f?.f24?.meta?.hubs;
        if (hubs && hubs.length) this._hubX[k] = Math.max(...hubs.map((q) => Math.abs(q.p[0])));
      }
      if (PK34) {
        this._bag125 = [];
        for (const [k, w] of Object.entries(PARK125)) {
          if (!fleet[k]) continue;
          if (!this.parked[k]) this.parked[k] = { ...mkPool(fleet[k].paint, fleet[k].dark, 320, fleet[k].parts), shell: fleet[k].shell ? mkShell(fleet[k].shell, 320) : null };
          for (let i = 0; i < w; i++) this._bag125.push(k);
        }
        if (!this._bag125.length) this._bag125 = null;
        this._move125 = [];
        for (const [k, w] of Object.entries(MOVE125.bag)) if (this.pools[k]) for (let i = 0; i < w; i++) this._move125.push(k);
        if (!this._move125.length) this._move125 = null;
      }
    } else {
      this.parked = { sedan: { ...mkPool(geos.sedanBody, geos.sedanDark, 5200), shell: null }, van: { ...mkPool(geos.vanBody, geos.vanDark, 800), shell: null } };
      this.parkedKinds = null;
    }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1); this._c = new THREE.Color();
    // VH13 — per-model lamp anchors (vehicles.js/lampAnchors) so the night sprites
    // land on each kind's own lenses instead of one offset shared by a 3.6 m Micra
    // and a 7.2 m box truck. `?vh13=0` hands carlights null and it falls back.
    this.lampAnchors = {};
    if (VH13 && fleet) for (const [k, f] of Object.entries(fleet)) if (f && f.lamps) this.lampAnchors[k] = f.lamps;
    // 640 covers CAR_TARGET: the 320-car sprite pool left ~300 of the 620 moving
    // cars with no night lights at all (carlights.js, VH13 note on `list`).
    this.lights = new CarLights(scene, VH13 ? 640 : 320, VH13 ? this.lampAnchors : null);
    this.tileEdges = new Map();
    this._bridgesAdded = false;
    // LAST: onTile replays the tiles already in (streamer.js), and addTile needs every field above
    streamer.onTile((key, data) => this.addTile(key, data), (key) => this.removeTile(key));
  }
  addTile(key, data) {
    const ids = [];
    for (const r of data.roads) {
      if (r.rclass >= 5 || r.noTraffic || r.pts.length < 2) continue;   // paths and pedestrianised streets carry no cars
      if (cpDrive(r)) continue;                                            // CP32: nor do Central Park's drives
      ids.push(this._addEdge(r.pts, r, key));
    }
    for (const n of data.nodes) if (n.signal) this.signals.set(this._canon(n.x, n.z), true);
    this.tileEdges.set(key, ids);
    this._compDirty = true;
    this._edgeVer = (this._edgeVer | 0) + 1;   // VC36: the parked-record lane test redoes its records
    // parked cars along curb parking lanes — stored as RECORDS; the LOD
    // rebucketer writes them into full-res or shell pools by camera distance
    this._parkTile(key, data);
    if (!this._bridgesAdded && this.streamer.bridgeRoads) {
      this._bridgesAdded = true;
      for (const br of this.streamer.bridgeRoads) {
        // decks that carry no cars: the E 103 St footbridge and the Hell Gate rail arch were
        // traffic edges, so cars climbed 18-43 m into the air over the East River (2026-09-04)
        if (br.type === 'archRail' || /FOOT ?BRIDGE|PEDESTRIAN|RAIL/i.test(br.name || '')) continue;
        this._addEdge(br.pts.map((p) => [...p]), br, '__bridges');
      }
    }
  }
  _parkTile(key, data) {
    const recs = [];
    // PK34: a 125th Street tile parks again once PROPS' hydrant table has loaded (it decides the gaps)
    if (PK34 && HYDRANTS === null && data.roads.some((r) => C125.test(r.name || ''))) {
      (this._hydWait || (this._hydWait = new Map())).set(key, data);
      if (!this._hydHooked) { this._hydHooked = true; HYD_P.then(() => { for (const [k, d] of this._hydWait) if (this.parkedRecs.has(k)) this._parkTile(k, d); this._hydWait.clear(); }); }
    }
    // PK41: a 125th Street tile packed before fleet24 published its sizes parks again once they exist (update())
    if (PK41 && PK34 && this._bag125 && !this.vehDims && data.roads.some((r) => C125.test(r.name || ''))) (this._dimWait || (this._dimWait = new Map())).set(key, data);
    for (const r of data.roads) {
      if (r.rclass > 2 || r.level > 0 || !r.park || r.pts.length < 2 || cpDrive(r)) continue;
      const e = { pts: r.pts, cum: [0] };
      for (let i = 1; i < r.pts.length; i++) e.cum.push(e.cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][2] - r.pts[i - 1][2]));
      e.len = e.cum[e.cum.length - 1];
      if (PK34 && this._bag125 && C125.test(r.name || '')) { this._park125(r, e, recs); continue; }
      const sides = r.park >= 2 ? [1, -1] : [((r.segId || 0) % 2) ? 1 : -1];
      for (const side of sides) {
        // no standing past the junction mouth (crosswalk + stop bar + hydrant zone): with
        // 3.4-4.6 m curb-return fillets a car parked at d=9 stood on the corner pavement.
        // XW11: the zone now clears the painted crossing AND its stop bar (mouth + 0.35 + XW + 1.81),
        // which the old fixed 7 m did not once the crossing became 25 ft deep.
        const nsz = XW_DEPTH(r.rclass, r.width) + 2.4;
        const d0 = Math.max(9, (r.mouthA || 0) + nsz), d1 = e.len - Math.max(9, (r.mouthB || 0) + nsz);
        for (let d = d0; d < d1; d += 7.4) {
          const h = Math.abs(Math.sin(d * 12.9898 + (r.segId || 1) * 78.233 + side * 3.7)) % 1;
          if (h > 0.74) continue; // ~74% occupancy
          const s = this.sampleEdge(e, d);
          const kind = this.parkedKinds
            ? this.parkedKinds[((h * 917.3) | 0) % this.parkedKinds.length]
            : (h > 0.62 ? 'van' : 'sedan');
          // 1.30 m from the kerb line: at 1.08 a 1.9 m car left its kerb-side tyres on the pavement wherever the
          // compiled kerb stands a few cm inside the CSCL width (blind critic, W 120th & Amsterdam, 2026-09-15)
          const off = (r.width / 2 - 1.30) * side;
          // NO PARKING ON THE GRASS. The slot is laid out from the road
          // centreline, so wherever the compiled ground under the parking lane
          // is NOT roadway the car ends up standing on something else — and,
          // because it is placed at the road datum, sunk into it. Measured over
          // four probe tiles: 12 of 1811 slots (0.66 %) land on a lawn or a
          // flag, among them (-844.8, 3293.3) — the gold sedan parked in the
          // Bryant Park turf on Fifth Avenue, 12.7 cm under the grass, which is
          // the object the critic has led with at 5th & 42nd since round 1.
          // The lawn itself is the compiler's (the park polygon swallows the
          // library parcel); refusing to park on it is mine.
          const cxp = s.x - s.dirz * off, czp = s.z + s.dirx * off;
          const si = this.streamer.surfaceInfoAt ? this.streamer.surfaceInfoAt(cxp, czp, 0.4) : null;
          if (si && !si.road) continue;
          if (si && si.kind === 'busred') continue;   // no standing in a red bus lane (critic round 5)
          // TYRES ON THE ROAD. The wheel cylinders bottom out at local y = 0
          // (radius 0.33 centred at 0.33), so the instance origin IS the contact
          // patch and `+ 0.03` parked every car 3 cm above the asphalt: four
          // little gaps under the tyres, a shadow that misses the car and an AO
          // ring under the body. 2 mm is enough to keep the tread out of the
          // road's own z-fight.
          this._v.set(cxp, s.y + (NO_DATUM ? 0.03 : 0.002), czp);
          // parked cars face the travel direction of their curb: on a one-way street BOTH curbs face
          // the one-way direction (the left-curb cars used to face oncoming — Wall St, r7 check)
          const back = (r.oneway | 0) !== 0 ? (r.oneway | 0) < 0 : side < 0;
          this._e.set(0, Math.atan2(s.dirx, s.dirz) + (back ? Math.PI : 0) + (h - 0.35) * 0.04, 0);
          this._q.setFromEuler(this._e);
          this._m.compose(this._v, this._q, this._s);
          recs.push({ kind, x: this._v.x, z: this._v.z, m: Float32Array.from(this._m.elements), color: fleetColor(() => (h * 7.13) % 1) });
        }
      }
    }
    // LF39 (LOTFIX, world/lotfix39.js; `?lf39=0` none): the stalls of the NYC Planimetric parking lots in this tile (GF38
    // paves them as roadway; empty they read as vacant lots), laid out and 72 % occupied by tools/ar34/lotfix/lf39_bake.mjs.
    // LF39b (lead 2026-10-09, OV41 on t7ArchSoffit: box trucks and vans in car stalls, 41 parked pairs inside each other):
    // a stall takes only a kind whose DRAWN plan box (fleet24 LOD0, the box drawnOverlaps tests) fits a standard stall,
    // 2.45 x 5.25 m, so the tile waits for the fleet's sizes as PK41's 125th Street kerbs do; and a body that would stand
    // within 0.15 m of one already parked (this tile's kerb cars, the lots and kerbs of the loaded tiles around) is left out.
    // No livery cabs or police cars in a residents' lot.
    const st39 = lf39Stalls(key);
    if (st39.length && this.parkedKinds && !(this.vehDims && this.fleet24 && this.fleet24.kinds)) (this._dimWait || (this._dimWait = new Map())).set(key, data);
    else if (st39.length) {
      const fit = (this.parkedKinds || ['sedan']).filter((k) => { if (!this.parked[k] || /taxi|police|nypd|cop/i.test(k)) return false; const bb = this._lf39BB(k); return bb[1] - bb[0] <= 2.45 && bb[3] - bb[2] <= 5.25; });
      const G = new Map(), cell = (x, z) => Math.floor(x / 8) * 100003 + Math.floor(z / 8);
      const body = (kind, M) => {   // plan box of a parked instance: centre, forward, half width / length (+ 0.075 m each side)
        const bb = this._lf39BB(kind), yaw = Math.atan2(M[8], M[10]), fx = Math.sin(yaw), fz = Math.cos(yaw), mx = (bb[0] + bb[1]) / 2, mz = (bb[2] + bb[3]) / 2;
        return { x: M[12] + fz * mx + fx * mz, z: M[14] - fx * mx + fz * mz, fx, fz, hw: (bb[1] - bb[0]) / 2 + 0.075, hl: (bb[3] - bb[2]) / 2 + 0.075 };
      };
      const put = (b) => { const k = cell(b.x, b.z); const L = G.get(k); if (L) L.push(b); else G.set(k, [b]); };
      const hit = (a) => {
        const gx = Math.floor(a.x / 8), gz = Math.floor(a.z / 8);
        for (let u = gx - 1; u <= gx + 1; u++) for (let w = gz - 1; w <= gz + 1; w++) for (const b of G.get(u * 100003 + w) || []) {
          const dx = b.x - a.x, dz = b.z - a.z; let sep = false;
          for (const [ux, uz] of [[a.fx, a.fz], [a.fz, -a.fx], [b.fx, b.fz], [b.fz, -b.fx]]) {
            const ra = a.hl * Math.abs(a.fx * ux + a.fz * uz) + a.hw * Math.abs(a.fz * ux - a.fx * uz);
            const rb = b.hl * Math.abs(b.fx * ux + b.fz * uz) + b.hw * Math.abs(b.fz * ux - b.fx * uz);
            if (Math.abs(dx * ux + dz * uz) >= ra + rb) { sep = true; break; }
          }
          if (!sep) return true;
        }
        return false;
      };
      const [tx, tz] = key.split('_').map(Number);
      for (const r of recs) if (this.parked[r.kind]) put(body(r.kind, r.m));
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        for (const r of this.parkedRecs.get(`${tx + dx}_${tz + dz}`) || []) if (this.parked[r.kind]) put(body(r.kind, r.m));
      }
      for (const [x, y, z, yaw, h] of st39) {
        if (!fit.length) break;
        const kind = fit[((h * 917.3) | 0) % fit.length];
        this._v.set(x, HA_ON ? haSettle(y, x, z, 0.75) : y, z);   // P1 TERRAIN: the lot's car on the lifted lot
        this._e.set(0, yaw + (h - 0.35) * 0.06, 0);
        this._q.setFromEuler(this._e);
        this._m.compose(this._v, this._q, this._s);
        const M = Float32Array.from(this._m.elements), b = body(kind, M);
        if (hit(b)) continue;
        put(b);
        recs.push({ kind, x, z, m: M, color: fleetColor(() => (h * 7.13) % 1) });
      }
    }
    this.parkedRecs.set(key, recs);
    this._parkDirty = true;
  }
  // nearest point of a polyline edge {pts, cum} to (x, z): distance along it, lateral distance, and the side (+1 = right of
  // its +d direction, the kerb whose cars face +d)
  _projEdge(e, x, z) {
    let best = null;
    for (let i = 1; i < e.pts.length; i++) {
      const A = e.pts[i - 1], B = e.pts[i], dx = B[0] - A[0], dz = B[2] - A[2], L2 = dx * dx + dz * dz;
      if (L2 < 1e-6) continue;
      const t = Math.max(0, Math.min(1, ((x - A[0]) * dx + (z - A[2]) * dz) / L2));
      const qx = A[0] + dx * t, qz = A[2] + dz * t, lat = Math.hypot(x - qx, z - qz);
      if (!best || lat < best.lat) {
        const L = Math.sqrt(L2);
        // right of (dx, dz) is (-dz, dx) in this frame (x east, z south): the side placement below uses the same sign
        best = { d: e.cum[i - 1] + t * L, lat, side: ((x - qx) * -dz + (z - qz) * dx) >= 0 ? 1 : -1, end: (i === 1 && t <= 0) || (i === e.pts.length - 1 && t >= 1) };
      }
    }
    return best;
  }
  // LF39b: a kind's drawn plan box [x0, x1, z0, z1, top] in model space (fleet24 LOD0, the box drawnOverlaps tests; shared
  // with it through _vfBB), the carHalf box before the fleet's parts exist (not cached then)
  _lf39BB(k) {
    const BB = this._vfBB || (this._vfBB = {});
    if (BB[k] !== undefined) return BB[k];
    const K = this.fleet24 && this.fleet24.kinds && this.fleet24.kinds[k];
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y1 = 0;
    for (const p of (K && K.lods && K.lods[0]) || []) {
      const g = p.geometry;
      if (!g || !g.attributes || !g.attributes.position) continue;
      if (!g.boundingBox) g.computeBoundingBox();
      const b = g.boundingBox;
      x0 = Math.min(x0, b.min.x); x1 = Math.max(x1, b.max.x); z0 = Math.min(z0, b.min.z); z1 = Math.max(z1, b.max.z); y1 = Math.max(y1, b.max.y);
    }
    if (!(x0 < x1)) { const h = this.carHalf({ kind: k }); return [-h[0], h[0], -h[1], h[1], 1.6]; }
    return (BB[k] = [x0, x1, z0, z1, y1]);
  }
  // PK41: a parked kind's slot length, the drawn model's (fleet24's kind size, or twice its LOD0 body's longer reach as
  // VLEN_FLEET takes it), the hand table only before fleet24 exists
  _parkLen(kind) {
    const d = this.vehDims && this.vehDims[kind];
    if (d && d[2] > 2) return this.fleet24 ? Math.max(d[2], 2 * this.carHalf({ kind })[1]) : d[2];
    return vlen({ kind });
  }
  _park125(r, e, recs) {
    const bag = this._bag125;
    const nsz = XW_DEPTH(r.rclass, r.width) + 2.4;
    const d0 = Math.max(9, (r.mouthA || 0) + nsz), d1 = e.len - Math.max(9, (r.mouthB || 0) + nsz);
    const back0 = (r.oneway | 0) !== 0 ? (r.oneway | 0) < 0 : null;
    for (const side of (r.park >= 2 ? [1, -1] : [((r.segId || 0) % 2) ? 1 : -1])) {
      // no-standing zones on this kerb, as [from, to] along d: bus stops (the zone runs back against the kerb's flow from the
      // stop point) and 15 ft either side of a hydrant
      const zones = [];
      const eastPlus = e.pts[e.pts.length - 1][0] > e.pts[0][0];   // +d runs east: its right (side +1) is the eastbound kerb
      for (const [sx, sz, dir] of BUS125) {
        const p = this._projEdge(e, sx, sz);
        if (!p || p.lat > 16 || ((dir === 'E') === eastPlus ? 1 : -1) !== side) continue;
        zones.push(side > 0 ? [p.d - STOP_ZONE[0], p.d + STOP_ZONE[1]] : [p.d - STOP_ZONE[1], p.d + STOP_ZONE[0]]);
      }
      for (const [hx, hz] of HYDRANTS || []) {
        const p = this._projEdge(e, hx, hz);
        if (!p || p.lat > 16 || p.side !== side) continue;
        zones.push([p.d - 4.6, p.d + 4.6]);
      }
      // PROPS' surveyed stop signs (on the walk, so their side is sure): the zone runs back against this kerb's flow
      for (const [bx, bz] of BUSSIGNS) {
        const p = this._projEdge(e, bx, bz);
        if (!p || p.lat > 16 || p.lat < 6 || p.side !== side) continue;
        zones.push(side > 0 ? [p.d - STOP_ZONE[0], p.d + STOP_ZONE[1]] : [p.d - STOP_ZONE[1], p.d + STOP_ZONE[0]]);
      }
      for (const [x0, z0, x1, z1, kerb] of NOSTAND125) {
        if (((kerb === 'S') === eastPlus ? 1 : -1) !== side) continue;
        const p0 = this._projEdge(e, x0, z0), p1 = this._projEdge(e, x1, z1);
        if (!p0 || !p1 || (p0.lat > 16 && p1.lat > 16) || (p0.end && p1.end && Math.abs(p0.d - p1.d) < 1)) continue;
        zones.push([Math.min(p0.d, p1.d), Math.max(p0.d, p1.d)]);
      }
      for (const [sx2, sz2, sl] of SHELTERS) {
        const p = this._projEdge(e, sx2, sz2);
        if (!p || p.lat > 16 || p.lat < 6 || p.side !== side) continue;
        zones.push([p.d - sl / 2 - 4, p.d + sl / 2 + 4]);
      }
      let n = 0;
      for (let d = d0 + hash01(r.segId, side, 99) * 1.2; d < d1;) {
        const h = hash01(r.segId, side, n), h2 = hash01(r.segId + 7, side, n), h3 = hash01(r.segId + 13, side, n);
        n++;
        const kind = bag[(h * bag.length) | 0];
        const L = PK41 ? this._parkLen(kind) : vlen({ kind }), gap = 0.6 + h2;   // PK41: the drawn model's length
        if (d + L > d1) break;
        if (h3 < PK_FREE) { d += 5.5 + gap; continue; }   // a free space
        let z = null;
        for (const q of zones) if (d + L > q[0] && d < q[1]) { z = q; break; }
        if (z) { d = z[1] + 0.3; continue; }
        const s = this.sampleEdge(e, d + L / 2);
        const off = (r.width / 2 - Math.max(1.30, (this._hubX[kind] || 0.85) + 0.45)) * side;
        const cxp = s.x - s.dirz * off, czp = s.z + s.dirx * off;
        const si = this.streamer.surfaceInfoAt ? this.streamer.surfaceInfoAt(cxp, czp, 0.4) : null;
        // off the roadway (a plaza, a lawn): no car; the compiled kerbside red is the parking lane STREET repaints, so with the
        // repaint on (SKBUS) a red left at the kerb is real and no standing (STREET 00:00: Third - Second Avenue's south side,
        // (`skbus=0` / `sk=0`) its kerbside red is the parking lane and parks as before
        if ((si && !si.road) || (si && si.kind === 'busred' && SKBUS)) { d += L + gap; continue; }
        this._v.set(cxp, s.y + (NO_DATUM ? 0.03 : 0.002), czp);
        const back = back0 !== null ? back0 : side < 0;
        this._e.set(0, Math.atan2(s.dirx, s.dirz) + (back ? Math.PI : 0) + (h2 - 0.5) * 0.03, 0);
        this._q.setFromEuler(this._e);
        this._m.compose(this._v, this._q, this._s);
        recs.push({ kind, x: this._v.x, z: this._v.z, m: Float32Array.from(this._m.elements), color: fleetColor(() => (h * 7.13) % 1) });
        d += L + gap;
      }
    }
  }
  // canonical junction key: CSCL arm endpoints scatter 2-16m at real
  // intersections (digitization noise, roadbed-edge endpoints, twin
  // carriageways), so exact endpoint keys shatter the graph into per-street
  // fragments (measured citywide: 45k components, largest 0.1%). Cluster
  // endpoints in a 6m hash: the first endpoint in a neighborhood becomes the
  // canonical node; later endpoints within 12m alias onto it. Cars blend
  // across the residual geometric gap at edge transitions (see update()).
  // RG44: an end aliases only onto a node within 3 m of its height (y given): a road in a cut ending under the street it
  // passes beneath, or an elevated end over one, is not that street's junction (CSCL ends both at one point)
  _canon(x, z, y = null) {
    const C = 6;
    const ci = Math.floor(x / C), cj = Math.floor(z / C);
    let best = null, bestD = 12;
    for (let j = cj - 2; j <= cj + 2; j++) for (let i = ci - 2; i <= ci + 2; i++) {
      const arr = this._nkGrid.get(`${i}_${j}`);
      if (!arr) continue;
      for (const p of arr) {
        const d = Math.hypot(p.x - x, p.z - z);
        if (y !== null && p.y !== null && Math.abs(p.y - y) > 3) continue;
        if (d < bestD) { bestD = d; best = p; }
      }
    }
    if (best) return best.k;
    const k = nk(x, z);
    const key = `${ci}_${cj}`;
    let arr = this._nkGrid.get(key);
    if (!arr) this._nkGrid.set(key, (arr = []));
    // (a node at another height on the same quantized point keeps its own key)
    const kk = y !== null && arr.some((p) => p.k === k) ? `${k}_${Math.round(y)}` : k;
    arr.push({ x, z, y, k: kk });
    return kk;
  }
  _addEdge(pts, r, tile) {
    const id = this.edgeIdSeq++;
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]));
    const e = {
      // lanes capped by what the roadway can hold: CSCL's number_travel_lanes put 3 lanes on a
      // 9 m one-way street, so lane centres sat 2.1 m apart and side-by-side cars overlapped
      // (traffic-law audit 2026-09-10: 128 collision pairs in 30 s, many "d12 l0 x d12 l1 dist 1.2")
      id, pts, cum, len: cum[cum.length - 1], width: r.width,
      lanes: Math.max(1, Math.min(r.lanes || 1, Math.floor((r.width - ((r.park | 0) >= 2 ? 4.6 : (r.park | 0) ? 2.3 : 0) - 0.6) / 2.9))),
      oneway: r.oneway | 0, speed: Math.max(6, (r.speed || 25) * 0.44704), rclass: r.rclass, tile,
      a: this._canon(pts[0][0], pts[0][2], pts[0][1]), b: this._canon(pts[pts.length - 1][0], pts[pts.length - 1][2], pts[pts.length - 1][1]),
      park: r.park | 0, segId: r.segId | 0,
      mouthA: r.mouthA || 0, mouthB: r.mouthB || 0, // junction boundary per end (0 = plain edge end)
      cars: new Set(),
    };
    if (e.len < 4) return id;
    if (e.a === e.b && e.len < 14) return id; // degenerate junction-interior loop
    // BUS34: a 125th Street edge, and its bus stops: { d (the stop point along the edge), dir (the travel direction that
    // serves it), routes }
    if ((BUS34 || PK34) && C125.test(r.name || '')) e.c125 = true;
    if (BUS34 && e.c125) {
      e.stops = [];
      const eastPlus = pts[pts.length - 1][0] > pts[0][0];
      for (const [sx, sz, dr, routes] of BUS125) {
        const p = this._projEdge(e, sx, sz);
        if (p && p.lat <= 16 && !p.end) e.stops.push({ d: p.d, dir: (dr === 'E') === eastPlus ? 1 : -1, routes, x: sx, z: sz });
      }
    }
    this.edges.set(id, e);
    for (const [dir, node] of [[1, e.a], [-1, e.b]]) {
      let n = this.nodes.get(node);
      if (!n) this.nodes.set(node, (n = { out: [] }));
      n.out.push({ id, dir });
    }
    return id;
  }
  removeTile(key) {
    // parked cars: drop this tile's records; next rebucket rebuilds buffers
    this.parkedRecs.delete(key);
    this._parkDirty = true;
    const ids = this.tileEdges.get(key) || [];
    for (const id of ids) {
      const e = this.edges.get(id);
      if (!e) continue;
      for (const car of e.cars) car.dead = true;
      for (const node of [e.a, e.b]) {
        const n = this.nodes.get(node);
        if (n) { n.out = n.out.filter((o) => o.id !== id); if (!n.out.length) this.nodes.delete(node); }
      }
      this.edges.delete(id);
    }
    this.tileEdges.delete(key);
    this._compDirty = true;
    this._edgeVer = (this._edgeVer | 0) + 1;
  }
  sampleEdge(e, d) {
    d = Math.max(0, Math.min(e.len, d));
    let i = 1;
    while (i < e.cum.length - 1 && e.cum[i] < d) i++;
    const t = (d - e.cum[i - 1]) / Math.max(0.001, e.cum[i] - e.cum[i - 1]);
    const A = e.pts[i - 1], B = e.pts[i];
    const dx = B[0] - A[0], dz = B[2] - A[2];
    const L = Math.hypot(dx, dz) || 1;
    return { x: A[0] + dx * t, y: A[1] + (B[1] - A[1]) * t, z: A[2] + dz * t, dirx: dx / L, dirz: dz / L };
  }
  stateFor(nodeKey, dirx, dirz) {
    if (!this.signals.has(nodeKey)) return 'G';
    return signalState(this.time, Math.abs(dirx) > Math.abs(dirz));
  }
  dirAt(e, d, dir) {
    const s = this.sampleEdge(e, d);
    return [s.dirx * dir, s.dirz * dir];
  }
  // label connected components over the loaded edge graph and flag every edge
  // outside the largest one as minor. Fragments (endpoints that never joined
  // the street network) otherwise collect cars that can only circle their own
  // segment — spawns are restricted to the giant component so vehicles always
  // have the whole city to route through.
  _relabelComponents() {
    this._compDirty = false;
    // TWO union-finds, deliberately. One structure used to serve both the 22 m junction
    // clustering and the connected-component labelling below; `uni(e.a, e.b)` for every edge
    // then merged every node of the street network into ONE "junction", `_pickNext` offered a
    // car leaving any junction every edge in the loaded city, and the turn connector drove it
    // there along a 200-1700 m Bezier — across blocks, sidewalks and buildings. That was the
    // "vehicles going through buildings" of the 2026-09-04 review (audit: every off-street car
    // was mid-TURN with len 255-1731 m).
    const mkUF = () => {
      const parent = new Map();
      const find = (k) => {
        let r = k;
        while (parent.get(r) !== r) r = parent.get(r);
        let c = k;
        while (parent.get(c) !== c) { const n = parent.get(c); parent.set(c, r); c = n; }
        return r;
      };
      const uni = (a, b) => {
        if (!parent.has(a)) parent.set(a, a);
        if (!parent.has(b)) parent.set(b, b);
        parent.set(find(a), find(b));
      };
      return { find, uni, has: (k) => parent.has(k) };
    };
    const J = mkUF();      // junction clusters (endpoints within 22 m)
    const Cc = mkUF();     // connected components (edge endpoints)
    const uni = J.uni;
    // junction clustering: canonical endpoints within 15m are arms of the
    // same physical intersection (first-come 12m aliasing in _canon still
    // splits wide-avenue junctions whose arm scatter exceeds one seed) —
    // union them AND merge their out-lists so cars route across
    const live = [];
    for (const arr of this._nkGrid.values()) for (const p of arr) if (this.nodes.has(p.k)) live.push(p);
    const C = 6;
    const cellOf = new Map();
    for (const p of live) {
      const key = `${Math.floor(p.x / C)}_${Math.floor(p.z / C)}`;
      let a = cellOf.get(key); if (!a) cellOf.set(key, (a = []));
      a.push(p);
    }
    for (const p of live) {
      const ci = Math.floor(p.x / C), cj = Math.floor(p.z / C);
      for (let j = cj - 4; j <= cj + 4; j++) for (let i = ci - 4; i <= ci + 4; i++) {
        const arr = cellOf.get(`${i}_${j}`);
        if (!arr) continue;
        // 22m: a side street ends at the far curb line of a 4-lane avenue —
        // still under NYC's shortest block spacing, so distinct junctions
        // never chain
        for (const q of arr) if (q !== p && Math.hypot(q.x - p.x, q.z - p.z) < 22) uni(p.k, q.k);
      }
    }
    // merged routing nodes per junction cluster (cars exiting ANY arm see the
    // whole cluster's continuations; oneway direction filters still apply).
    // Built from the 22 m clustering ONLY — never from edge connectivity.
    this.junction = new Map();
    const groups = new Map();
    for (const p of live) {
      const r = J.has(p.k) ? J.find(p.k) : p.k;
      let g = groups.get(r); if (!g) groups.set(r, (g = { out: [], keys: [] }));
      const n = this.nodes.get(p.k);
      if (n) g.out.push(...n.out);
      g.keys.push(p.k);
    }
    for (const g of groups.values()) {
      if (g.keys.length < 2) continue; // solo nodes route through this.nodes as before
      for (const k of g.keys) this.junction.set(k, g);
    }
    // connected components over edge endpoints (+ the junction clusters, so arms that only
    // touch through a cluster count as connected): everything outside the giant one is minor
    for (const e of this.edges.values()) Cc.uni(e.a, e.b);
    for (const g of groups.values()) for (let i = 1; i < g.keys.length; i++) Cc.uni(g.keys[0], g.keys[i]);
    const lenOf = new Map();
    for (const e of this.edges.values()) {
      const r = Cc.find(e.a);
      lenOf.set(r, (lenOf.get(r) || 0) + e.len);
    }
    let giant = null, giantLen = -1;
    for (const [r, L] of lenOf) if (L > giantLen) { giantLen = L; giant = r; }
    for (const e of this.edges.values()) e.minor = Cc.find(e.a) !== giant;
  }
  spawnCar(px, pz) {
    if (this._compDirty) this._relabelComponents();
    const keys = [...this.edges.keys()];
    // C125_SPAWN: the 125th Street edges within the spawn ring, listed again every 5 s or after a 100 m move (none away from
    // 125th Street, so nothing changes elsewhere)
    if (PK34 && (this._c125T === undefined || this.time - this._c125T > 5 || Math.hypot(px - this._c125X, pz - this._c125Z) > 100)) {
      this._c125T = this.time; this._c125X = px; this._c125Z = pz;
      this._c125ids = [];
      for (const [id, e] of this.edges) {
        if (!e.c125 || e.minor || e.len < 25) continue;
        const q = e.pts[e.pts.length >> 1];
        if (Math.hypot(q[0] - px, q[2] - pz) < SPAWN_R1) this._c125ids.push(id);
      }
    }
    for (let tries = 0; tries < 14; tries++) {
      const c125 = PK34 && C125_SPAWN > 0 && this._c125ids && this._c125ids.length && Math.random() < C125_SPAWN;
      const e = this.edges.get(c125 ? this._c125ids[(Math.random() * this._c125ids.length) | 0] : keys[(Math.random() * keys.length) | 0]);
      if (!e || e.len < 25 || e.minor) continue;
      const d = e.len * Math.random();
      const s = this.sampleEdge(e, d);
      const dist = Math.hypot(s.x - px, s.z - pz);
      // INITIAL FILL (PV2): spawning only 240-720 m out left the camera's own blocks nearly empty for the first minutes
      // (the first frames are the ones a capture takes); for the first 20 s, while under 75 % of the target, cars may
      // appear from 25 m, after which the out-of-sight ring takes over again
      const filling = !spawnGuard.on && ((this.time < 20 && this.cars.length < this.target * 0.75) || (TP34 && this.time < (this._refill || 0)));
      // (TP34's refill after a jump starts 40 m out: a car spawned at 25 m often stood right in front of a street-level
      const r0 = filling ? Math.min(SPAWN_R0, this.time < 20 ? 25 : 40) : SPAWN_R0;
      if (dist < r0 || dist > SPAWN_R1) continue;
      // ...weighted toward the camera (half acceptance at 150 m), so the first frames look like a street, not a ring road
      if (filling && Math.random() > 1 / (1 + (dist / 150) ** 2)) continue;
      // recording (spawnGuard): a car may not appear inside the frame, however far (a 4.5 m car is ~50 px at 240 m in 1440p)
      if (spawnGuard.on && spawnGuard.inView(s.x, s.y + 1, s.z, 3)) continue;
      // PY25: nor on top of a walker on the carriageway (the crossers peds.js publishes)
      if (PY25 && this._crossers && this._crossers.length) {
        let near = false;
        for (let k = 0; k + 1 < this._crossers.length && !near; k += 2) near = (this._crossers[k] - s.x) ** 2 + (this._crossers[k + 1] - s.z) ** 2 < 64;
        if (near) continue;
      }
      const dir = e.oneway !== 0 ? e.oneway : Math.random() < 0.5 ? 1 : -1;
      const r = Math.random();
      let kind = this.kindBag
        ? (this.pools.bus && ((e.rclass === 3 && r < 0.1) || r < 0.03) ? 'bus' : this.kindBag[(Math.random() * this.kindBag.length) | 0])
        : (e.rclass === 3 && r < 0.1 ? 'bus' : r < 0.13 ? 'van' : r < 0.155 ? 'bus' : 'sedan');
      if (PK34 && e.c125 && this._move125 && Math.random() < MOVE125.share) kind = this._move125[(Math.random() * this._move125.length) | 0];
      const pool = this.pools[kind];
      if (pool.n >= pool.cap) continue;
      let clash = false;
      // (VC36: or nearer than the two bodies' own reach plus 2.5 m: a school bus and a 26 ft box truck touch at 11.0 m)
      for (const o of e.cars) if (o.dir === dir && Math.abs(o.d - d) < (VC36 ? Math.max(10, Math.max(followGap(o, { kind }), followGap({ kind }, o)) + 2.5) : 10)) { clash = true; break; }
      if (clash) continue;
      const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
      // taxi yellow only on taxi-type bodies (crown / prius / tesla / the placeholder sedan):
      // yellow Cybertrucks and Harleys were in the film (fleet-qa.md open item 3)
      let color = fleetColor(Math.random);
      if (color === 0xf7b500 && !/^(crown|prius|tesla|sedan)$/.test(kind)) color = fleetColor(() => 0.17 + Math.random() * 0.83);
      // BL34: not in a red bus lane (a double-parking van still takes the kerb lane below)
      const blS = BL34 && kind !== 'bus' && lanesDir > 1 && this._busLane(e, dir);
      const lane0 = (Math.random() * (blS ? lanesDir - 1 : lanesDir)) | 0;
      // VC36: out of the junction mouths and clear of every body near (the lane a double-parker takes is tested too)
      if (VC36 && (!this._spawnClear(e, d, dir, lane0, kind) || (lane0 !== lanesDir - 1 && (PK34 && e.c125 ? DP125[kind] : DPK.has(kind)) && !this._spawnClear(e, d, dir, lanesDir - 1, kind)))) continue;
      const car = { e, d, dir, lane: lane0, v: 4, kind, color, idx: pool.n++,
        laneF: undefined, _lfv: 0, _cp: undefined, _cpF: undefined, _hsx: undefined, _hcz: undefined, _pg: undefined, _pgS: undefined, _pk: undefined, _pkF: undefined, _pyHold: undefined };
      car.laneF = car.lane;
      // lane 0 is the LEFT lane of travel (next to the centreline on a two-way street); the curb
      // lane is lanesDir - 1 — double-parked vans used to sit in the middle of two-way streets
      // ...and never within 18 m of a junction, where the curb lane is the turning cars' entry
      // PK34: on 125th Street delivery vans and box trucks double-park in the kerb travel lane (the red lane) far more often
      // is a rule, not a count
      // (BL34: a third of that where the kerb lane is a red bus lane: the census of session 2 counted 3-5 vans standing in the
      // red lanes within 220 m of the Apollo at once (lane_eval.js, s2_q57a), the twelve counted crops show about one per
      // three to four crops (a UPS truck at 1656, a van at 2694), none on the Apollo's block)
      const dp = (PK34 && e.c125 ? DP125[kind] || 0 : DPK.has(kind) ? 0.06 : 0) * (blS ? DP_RED : 1);
      if (dp > 0 && Math.random() < dp && d > 18 && d < e.len - 18) { car._parkT = 25 + Math.random() * 35; car.lane = lanesDir - 1; car.laneF = car.lane; }
      e.cars.add(car);
      this.cars.push(car);
      this._c.set(car.color);
      pool.mb.setColorAt(car.idx, this._c);
      pool.mb.instanceColor.needsUpdate = true;
      pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
      for (const m of pool.mx) m.count = pool.mb.count;
      return;
    }
  }
  // BUS34: keep about BUS_PER_KM route buses per direction on the 125th Street edges within reach of the camera (spawned
  // the way spawnCar spawns: outside the near ring and out of frame once the first 20 s of fill are over)
  _spawnBus(px, pz) {
    if (this._compDirty) this._relabelComponents();
    // (only with the point inside the despawn ring: a bus staged out there was despawned and staged again every 0.8 s)
    if (BUSAT && Math.hypot(BUSAT.x - px, BUSAT.z - pz) < DESPAWN_R * 0.8 && !(this._busAt && this.cars.includes(this._busAt))) this._stageBus();
    for (const V of VEHAT) if (Math.hypot(V.x - px, V.z - pz) < DESPAWN_R * 0.8 && !(V.car && this.cars.includes(V.car))) this._stageVeh(V);
    const near = [];
    let len = 0, have = 0;
    for (const e of this.edges.values()) {
      if (!e.c125 || e.minor) continue;
      const s = this.sampleEdge(e, e.len / 2);
      if (Math.hypot(s.x - px, s.z - pz) > SPAWN_R1) continue;
      near.push(e); len += e.len;
    }
    for (const c of this.cars) if (c.route) have++;
    const want = Math.round((len / 1000) * BUS_PER_KM * 2);
    if (have >= want || !near.length) return;
    const filling = !spawnGuard.on && (this.time < 20 || (TP34 && this.time < (this._refill || 0)));
    for (let tries = 0; tries < 10; tries++) {
      const e = near[(Math.random() * near.length) | 0];
      if (e.len < 30) continue;
      const d = 8 + (e.len - 16) * Math.random();
      const s = this.sampleEdge(e, d);
      const dist = Math.hypot(s.x - px, s.z - pz);
      if (dist < (filling ? 25 : SPAWN_R0) || dist > SPAWN_R1) continue;
      if (spawnGuard.on && spawnGuard.inView(s.x, s.y + 1.5, s.z, 7)) continue;
      const dir = e.oneway !== 0 ? e.oneway : Math.random() < 0.5 ? 1 : -1;
      // route by weight among the routes that run on 125th at this point (west of Amsterdam only the M125)
      const here = BUS_ROUTES.filter((q) => s.x >= q[3] && s.x <= q[4]);
      if (!here.length) continue;
      let r = Math.random() * here.reduce((a, q) => a + q[1], 0), route = here[0];
      for (const q of here) { if (r < q[1]) { route = q; break; } r -= q[1]; }
      const kinds = route[2].filter((k) => this.pools[k]);
      const kind = kinds.length ? kinds[(Math.random() * kinds.length) | 0] : (this.pools.minibus ? 'minibus' : null);
      if (!kind) return;
      const pool = this.pools[kind];
      if (pool.n >= pool.cap) continue;
      const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
      const lane = lanesDir - 1;
      let clash = false;
      for (const o of e.cars) if (o.dir === dir && Math.abs(o.d - d) < (VC36 ? Math.max(16, Math.max(followGap(o, { kind }), followGap({ kind }, o)) + 2.5) : 16)) { clash = true; break; }
      if (clash) continue;
      if (VC36 && !this._spawnClear(e, d, dir, lane, kind)) continue;   // VC36
      const car = { e, d, dir, lane, v: 4, kind, color: 0xffffff, idx: pool.n++, route: route[0],
        laneF: lane, _lfv: 0, _cp: undefined, _cpF: undefined, _hsx: undefined, _hcz: undefined, _pg: undefined, _pgS: undefined, _pk: undefined, _pkF: undefined, _pyHold: undefined };
      e.cars.add(car);
      this.cars.push(car);
      this._c.set(car.color);
      pool.mb.setColorAt(car.idx, this._c);
      pool.mb.instanceColor.needsUpdate = true;
      pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
      for (const m of pool.mx) m.count = pool.mb.count;
      return;
    }
  }
  // BUSAT: the staged bus (see BUSAT), placed once the 125th Street edge under the point has streamed in
  _stageBus() {
    let best = null;
    for (const e of this.edges.values()) {
      if (!e.c125 || e.minor) continue;
      const p = this._projEdge(e, BUSAT.x, BUSAT.z);
      if (p && !p.end && (!best || p.lat < best.p.lat)) best = { e, p };
    }
    if (!best || best.p.lat > 14) return;
    const { e, p } = best;
    const dir = e.oneway !== 0 ? e.oneway : p.side;
    const here = BUS_ROUTES.filter((q) => (BUSAT.route ? q[0] === BUSAT.route : BUSAT.x >= q[3] && BUSAT.x <= q[4]));
    const route = here[0] || BUS_ROUTES[0];
    const kinds = BUSAT.kind && this.pools[BUSAT.kind] ? [BUSAT.kind] : route[2].filter((k) => this.pools[k]);
    const kind = kinds.length ? kinds[(Math.random() * kinds.length) | 0] : null;
    if (!kind || this.pools[kind].n >= this.pools[kind].cap) return;
    const pool = this.pools[kind];
    const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
    const d = Math.max(1, Math.min(e.len - 1, p.d - dir * vlen({ kind }) / 2));
    const car = { e, d, dir, lane: lanesDir - 1, v: 0, kind, color: 0xffffff, idx: pool.n++, route: route[0], _dwell: 1e9,
      laneF: lanesDir - 1, _lfv: 0, _cp: undefined, _cpF: undefined, _hsx: undefined, _hcz: undefined, _pg: undefined, _pgS: undefined, _pk: undefined, _pkF: undefined, _pyHold: undefined };
    this._busAt = car;
    e.cars.add(car);
    this.cars.push(car);
    this._c.set(car.color);
    pool.mb.setColorAt(car.idx, this._c);
    pool.mb.instanceColor.needsUpdate = true;
    pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
    for (const m of pool.mx) m.count = pool.mb.count;
    console.log('[bus34] staged', route[0], kind, 'at', BUSAT.x, BUSAT.z, 'edge', e.segId ?? '', 'd', d.toFixed(1), 'dir', dir);
  }
  // VEHAT: one staged vehicle (see VEHAT)
  _stageVeh(V) {
    const pool = this.pools[V.kind];
    if (!pool || pool.n >= pool.cap) return;
    let best = null;
    for (const e of this.edges.values()) {
      if (e.minor) continue;
      const p = this._projEdge(e, V.x, V.z);
      if (p && !p.end && (!best || p.lat < best.p.lat)) best = { e, p };
    }
    if (!best || best.p.lat > 14) return;
    const { e, p } = best;
    const dir = e.oneway !== 0 ? e.oneway : p.side;
    const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
    const car = { e, d: Math.max(1, Math.min(e.len - 1, p.d)), dir, lane: lanesDir - 1, v: 0, kind: V.kind, color: fleetColor(() => 0.45), idx: pool.n++, _parkT: 1e9,
      laneF: lanesDir - 1, _lfv: 0, _cp: undefined, _cpF: undefined, _hsx: undefined, _hcz: undefined, _pg: undefined, _pgS: undefined, _pk: undefined, _pkF: undefined, _pyHold: undefined };
    V.car = car;
    e.cars.add(car);
    this.cars.push(car);
    this._c.set(car.color);
    pool.mb.setColorAt(car.idx, this._c);
    pool.mb.instanceColor.needsUpdate = true;
    pool.mb.count = pool.md.count = Math.max(pool.mb.count, pool.n);
    for (const m of pool.mx) m.count = pool.mb.count;
    console.log('[vehat] staged', V.kind, 'at', V.x, V.z, 'edge', e.segId ?? '', 'd', car.d.toFixed(1), 'dir', dir);
  }
  _pickNext(car, nodeKey, exitDirx, exitDirz, straightOnly = false, accept = null) {   // accept(turn): VQ31's lane-kept fallback
    // merged junction cluster when one exists (scattered CSCL arms), else the
    // plain canonical node
    const n = this.junction?.get(nodeKey) ?? this.nodes.get(nodeKey);
    if (!n) return null;
    // where this car leaves its edge: the junction mouth at its end of travel
    const ce = car.e, cm = car.dir > 0 ? (ce.mouthB || 0) : (ce.mouthA || 0);
    const exitPos = this.sampleEdge(ce, car.dir > 0 ? Math.max(0.2, ce.len - cm) : Math.min(ce.len - 0.2, cm));
    const opts = [];
    for (const o of n.out) {
      const ne = this.edges.get(o.id);
      if (!ne || ne === car.e) continue;
      if (ne.oneway !== 0 && o.dir !== ne.oneway) continue;
      if (TN38 && this._tnBad(car, ne, o.dir)) continue;   // TN38: no connector from this lane keeps the body on the carriageway
      // a merged junction cluster spans a divided avenue (arms up to 22 m apart, entries up to
      // 60 m from the exit): only continue onto arms whose entry is within one junction's reach,
      // so the crossing goes exit -> short link piece -> far carriageway instead of one arc over
      // the median and its planting (audit 2026-09-09: cars "on grass / sidewalk" mid-turn)
      { const en = this.sampleEdge(ne, o.dir > 0 ? Math.min((ne.mouthA || 0) + 1, ne.len * 0.5) : Math.max(ne.len - (ne.mouthB || 0) - 1, ne.len * 0.5)); if (Math.hypot(en.x - exitPos.x, en.z - exitPos.z) > 32) continue; }
      // entry blocked? (car within 8m of the entry)
      let blocked = false;
      const entryD = o.dir > 0 ? 0 : ne.len;
      for (const oc of ne.cars) if (oc.dir === o.dir && Math.abs(oc.d - entryD) < 8) { blocked = true; break; }
      const [ndx, ndz] = this.dirAt(ne, o.dir > 0 ? 1 : ne.len - 1, o.dir);
      const dot = ndx * exitDirx + ndz * exitDirz;
      const ang = Math.acos(Math.max(-1, Math.min(1, dot)));
      if (straightOnly && ang >= 0.5) continue;   // a car stuck in the wrong lane for its turn goes straight instead
      const w = (ang < 0.5 ? 0.62 : ang < 2.0 ? 0.33 : 0.05) * (blocked ? 0.05 : 1);
      const turn = ang < 0.5 ? 'straight' : ang >= 2.0 ? 'uturn' : (exitDirx * ndz - exitDirz * ndx > 0 ? 'right' : 'left');
      if (accept && !accept(turn)) continue;
      opts.push({ o, ne, w, turn });
    }
    if (!opts.length) return null;
    // BUS34: a route bus stays on 125th Street (straight on, through a divided avenue's median link)
    if (car.route && car.e && (car.e.c125 || car.e.len < 26)) {
      const keep = opts.filter((q) => q.ne.c125 && q.turn === 'straight').sort((a, b) => b.w - a.w)[0]
        || opts.filter((q) => q.turn === 'straight' && q.ne.len < 26).sort((a, b) => b.w - a.w)[0];
      if (keep) return keep;
    }
    // external API route plan (vehicle.set_autopilot(route=[...])): take the planned turn when this junction has it
    if (car.routePlan && car.routePlan.length) {
      const want = car.routePlan[0];
      const hit = opts.filter((q) => q.turn === want).sort((a, b) => b.w - a.w)[0];
      if (hit) { car.routePlan.shift(); return hit; }
      // the planned turn is not offered here: straight on (the plan waits for the next junction), else the random choice
      const st = opts.filter((q) => q.turn === 'straight').sort((a, b) => b.w - a.w)[0];
      if (st) return st;
    }
    let sum = 0;
    for (const o of opts) sum += o.w;
    let r = Math.random() * sum;
    for (const o of opts) { r -= o.w; if (r <= 0) return o; }
    return opts[opts.length - 1];
  }
  // ---- PEDESTRIAN YIELD (PY25, owner 2026-09-25: "pedestrians should never clip into vehicles"). The walkers on the
  // carriageway are published by peds.js as this._crossers = [x, z, ...] with their velocities in this._crossV (the API
  // bridge appends its own walkers to _crossers, without velocities). A car yields to a walker who is in, or will step
  // into, the corridor its body sweeps along its REAL path ahead (lane, turn connector, next edge), not a box straight
  // ahead of its current heading: a turning car used to see the walker on the crosswalk of the street it turned into only
  // once its nose pointed at them, too late to stop, and drove through them. Both sides are bucketed (no walker x car
  // loop): cars in 10 m cells (this._carGrid, also what peds.js asks "which cars could reach me here?"), and each
  // walker tests only the cars near it. `?py25=0` restores the straight-ahead box.
  // distance a car may still travel before it must stop for a pedestrian (1e9: none in its way)
  _pedGap(car) {
    if (!PY25) return this._pedGapBox(car);
    return car._pgS === this._pgStamp ? car._pg : 1e9;
  }
  _pedGapBox(car) {
    const X = this._crossers;
    if (!X || !X.length || !car._pose) return 1e9;
    const cx = car._pose[0], cz = car._pose[2], yaw = car._pose[3];
    const fx = Math.sin(yaw), fz = Math.cos(yaw), half = vlen(car) / 2;
    let best = 1e9;
    for (let k = 0; k < X.length; k += 2) {
      const rx = X[k] - cx, rz = X[k + 1] - cz;
      const along = rx * fx + rz * fz;
      if (along < half - 0.8 || along > half + 14) continue;
      if (Math.abs(rx * fz - rz * fx) > 1.75) continue;
      best = Math.min(best, along - half - 1.6);
    }
    return best;
  }
  // cars by position, rebuilt at the end of every update (so the walkers, who update after the cars, see this frame's)
  _buildCarGrid() {
    const G = this._carGrid || (this._carGrid = new Map());
    if (((this._cgN = (this._cgN || 0) + 1) & 511) === 0) G.clear();   // drop the cells no car drives any more
    else for (const L of G.values()) L.length = 0;
    for (const c of this.cars) {
      const q = c._pose;
      if (!q) continue;
      const k = (Math.floor(q[0] / CG) + 32768) * 65536 + (Math.floor(q[2] / CG) + 32768);
      let L = G.get(k);
      if (!L) G.set(k, (L = []));
      L.push(c);
      c._hsx = Math.sin(q[3]); c._hcz = Math.cos(q[3]);   // heading, for the next update's _pedPass (the pose holds till then)
    }
  }
  // every car whose position is within the square of half-size r around (x, z)
  carsNear(x, z, r, fn) {
    const G = this._carGrid;
    if (!G) return;
    const a = Math.floor((x - r) / CG), b = Math.floor((x + r) / CG), c0 = Math.floor((z - r) / CG), c1 = Math.floor((z + r) / CG);
    for (let gx = a; gx <= b; gx++) for (let gz = c0; gz <= c1; gz++) {
      const L = G.get((gx + 32768) * 65536 + (gz + 32768));
      if (L) for (let i = 0; i < L.length; i++) fn(L[i]);
    }
  }
  // half width (x) and half length (z) of a car's body: the model's plan bounds, mirrors and all (fleet24 LOD0), never
  // less than the nominal dims (a box truck's mirrors stand 0.14 m outside its vehDims box: walkers stopped short of the
  // box stood in the mirror)
  carHalf(car) {
    const cache = this._halfK || (this._halfK = {});
    let h = cache[car.kind];
    if (!h) {
      const K = this.fleet24 && this.fleet24.kinds && this.fleet24.kinds[car.kind];
      let x = 0, z = 0;
      if (K && K.lods && K.lods[0]) for (const part of K.lods[0]) {
        const g = part.geometry;
        if (!g || !g.attributes || !g.attributes.position) continue;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox;
        x = Math.max(x, -b.min.x, b.max.x); z = Math.max(z, -b.min.z, b.max.z);
      }
      const dm = this.vehDims && this.vehDims[car.kind];
      h = [Math.max(x, dm ? dm[0] / 2 : 0.97), Math.max(z, dm ? dm[2] / 2 : vlen(car) / 2)];
      if (this.fleet24 || !dm) cache[car.kind] = h;   // before fleet24 is installed, do not cache the fallback
    }
    return h;
  }
  // VC36: does a parked record's body stand in a travel lane? Hunters Point's streets put a school bus, a step van and SUVs
  // 0.6-1.6 m into parked vans and cars for whole takes (t6GantryArc, in view), a skewed corner near Broadway a parked Mini
  // 2.1 m into a queue on 125th: the parked slots are laid out from the road's width and the lanes from the edge's, and a
  // cross street's kerb runs on into the junction. A record is dropped when its body (its own plan box, mirrors included,
  // turned to the street) comes more than 0.5 m into a 2.5 m wide body on the centre of any lane of a street within 20 m at
  // its level (a mirror over the next lane is left: a 10 m street with both kerbs parked has 0.2 m of that).
  _parkIntrudes(rec) {
    if (NP36 && NOPARK36.some((b) => rec.x > b[0] && rec.x < b[2] && rec.z > b[1] && rec.z < b[3])) return true;   // NP36
    const G = this._vcEdgeGrid();
    const m = rec.m, yaw = Math.atan2(m[8], m[10]), h = this.carHalf({ kind: rec.kind }), y = m[13];
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    const seen = new Set();
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const L = G.get((Math.floor(rec.x / 40) + i) * 100003 + (Math.floor(rec.z / 40) + j));
      if (!L) continue;
      for (const e of L) {
        if (seen.has(e) || !this.edges.has(e.id)) continue;
        seen.add(e);
        const p = this._projEdge(e, rec.x, rec.z);
        if (!p || p.end || p.lat > 20) continue;
        const s = this.sampleEdge(e, p.d);
        if (Math.abs(s.y - y) > 3) continue;   // a deck over the street, a street under the deck
        const cA = Math.abs(fx * s.dirx + fz * s.dirz), sA = Math.sqrt(Math.max(0, 1 - cA * cA));
        const hwP = h[0] * cA + h[1] * sA, latR = p.side * p.lat;
        const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
        for (const dir of e.oneway !== 0 ? [e.oneway] : [1, -1]) for (let lane = 0; lane < lanesDir; lane++) {
          if (Math.abs(latR - dir * this._laneOffsetAt(e, { dir, lane }, lane)) < hwP + 1.25 - 0.5) return true;
        }
      }
    }
    return false;
  }
  // VC36: the edges by 40 m cell (bounding box grown 20 m), rebuilt when tiles come or go
  _vcEdgeGrid() {
    if (this._vcG && this._vcGv === this._edgeVer) return this._vcG;
    const G = new Map();
    for (const e of this.edges.values()) {
      if (e.minor) continue;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const q of e.pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[2] < z0) z0 = q[2]; if (q[2] > z1) z1 = q[2]; }
      for (let i = Math.floor((x0 - 20) / 40); i <= Math.floor((x1 + 20) / 40); i++) for (let j = Math.floor((z0 - 20) / 40); j <= Math.floor((z1 + 20) / 40); j++) {
        const k = i * 100003 + j;
        let L = G.get(k);
        if (!L) G.set(k, (L = []));
        L.push(e);
      }
    }
    this._vcG = G; this._vcGv = this._edgeVer;
    return G;
  }
  // VC36: room for a new `kind` body at d in lane `lane` of e, travelling dir: 9 m clear of either junction mouth (a car
  // spawned in a mouth was pinned on its trigger and took its connector where the car before it had), and its box, grown
  // 2.5 m each end and 0.4 m each side, clear of every body near it (cars on connectors included: they have left the edge)
  _spawnClear(e, d, dir, lane, kind) {
    const h = this.carHalf({ kind }), mA = Math.max(0, e.mouthA || 0), mB = Math.max(0, e.mouthB || 0);
    if (d - h[1] < mA + 9 || d + h[1] > e.len - mB - 9) return false;
    const s = this.sampleEdge(e, d), off = this._laneOffsetAt(e, { dir, lane }, lane);
    const x = s.x - s.dirz * dir * off, z = s.z + s.dirx * dir * off, yaw = Math.atan2(s.dirx * dir, s.dirz * dir);
    const hw = h[0] + 0.4, hl = h[1] + 2.5;
    for (const oc of this._ovNear(x, z, hl + 14)) if ((!oc.dead || VF36) && oc._pose && this._ovHit(x, z, yaw, hw, hl, oc)) return false;
    for (const oc of e.cars) if (oc._pose && this._ovHit(x, z, yaw, hw, hl, oc)) return false;
    return true;
  }
  // VN36: would `car`'s body at (x, z, yaw) enter another body lying ahead of its motion? (its own box less 0.2 m each side for
  // the mirrors, the other's whole plan box). Held 6 s out of sight of every camera, it may (counted: vnUnseen)
  _vnBlocked(car, x, z, yaw, dt) {
    const q = car._pose, mx = x - q[0], mz = z - q[2];
    if (mx * mx + mz * mz < 1e-8) return false;
    const h = this.carHalf(car), hw = Math.max(0.5, h[0] - 0.2), hl = h[1];
    for (const oc of this._ovNear(x, z, hl + 12)) {
      if (oc === car || (oc.dead && !VF36) || !oc._pose) continue;   // VF36: a dead car is a body too
      if ((oc._pose[0] - q[0]) * mx + (oc._pose[2] - q[2]) * mz <= 0) continue;   // not ahead of my motion
      if (!this._ovHit(x, z, yaw, hw, hl, oc)) continue;
      if (car._vnBy === oc && (car._vnT || 0) > 6 && !this._ovSeen(car) && !this._ovSeen(oc)) { this.vnUnseen = (this.vnUnseen || 0) + 1; continue; }
      car._vnT = car._vnBy === oc ? (car._vnT || 0) + dt : dt;
      car._vnBy = oc;
      this.vnHeld = (this.vnHeld || 0) + 1;
      return true;
    }
    // parked bodies: one the car would run into is dropped during a warm-up (nothing is filmed; a kerb slot in a turning
    // path: 12th Avenue's corner of 125th Street, FILM 09:13), in a take the car stands
    const PG = this._vnPG;
    if (PG) {
      const r = hl + 6;
      for (let i = Math.floor((x - r) / 16); i <= Math.floor((x + r) / 16); i++) for (let j = Math.floor((z - r) / 16); j <= Math.floor((z + r) / 16); j++) {
        const L = PG.get(i * 100003 + j);
        if (!L) continue;
        for (const rec of L) {
          if (rec._vcHit) continue;
          const m = rec.m, po = rec._ovp || (rec._ovp = { kind: rec.kind, _pose: [m[12], m[13], m[14], Math.atan2(m[8], m[10])] });
          if (Math.abs(po._pose[1] - (q[1] || 0)) > 3 || (po._pose[0] - q[0]) * mx + (po._pose[2] - q[2]) * mz <= 0) continue;
          if (!this._ovHit(x, z, yaw, hw, hl, po)) continue;
          if (!spawnGuard.on) { rec._vcHit = true; this._parkDirty = true; this.vnParkDropped = (this.vnParkDropped || 0) + 1; continue; }
          // in a take a car stands only for a parked body in front of it (its own box 0.5 m narrower each side): one it
          // brushes in passing (a mirror over the lane line) held whole lanes still (junction passes -15 %)
          if (!this._ovHit(x, z, yaw, Math.max(0.4, hw - 0.3), hl, po)) continue;
          car._vnT = car._vnBy === po ? (car._vnT || 0) + dt : dt;
          car._vnBy = po;
          this.vnHeld = (this.vnHeld || 0) + 1;
          return true;
        }
      }
    }
    car._vnT = 0; car._vnBy = null;
    return false;
  }
  // VC36: of two bodies level with each other (a stack), which goes first: the lower (kind, idx)
  _vcFirst(a, b) { return (a.kind || '') < (b.kind || '') || ((a.kind || '') === (b.kind || '') && (a.idx ?? 0) < (b.idx ?? 0)); }
  // VC36: how far `car`, on its edge, can drive on in its lane before its body (swept straight along the lane, mirrors
  // aside) touches another body that is not its own lane's queue (IDM keeps that one): a turning truck's rear still across
  // the lane, a body across the mouth. Up to its stopping distance + 3 m and no further than 1 m past the mouth.
  _ovSweepEdge(car, e, endD, mEnd) {
    const q0 = car._pose;
    if (!q0) return 1e9;
    const run = Math.min((car.v * car.v) / (2 * IDM.b) + 3, Math.max(0, endD - Math.max(0, mEnd || 0)) + 1);
    if (run < 0.3) return 1e9;
    const h = this.carHalf(car), hw = Math.max(0.6, h[0] - 0.15), hl = h[1] + OV_M;
    const s = this.sampleEdge(e, car.d), ux = s.dirx * car.dir, uz = s.dirz * car.dir, yaw = q0[3];
    const cx = q0[0] + (ux * run) / 2, cz = q0[2] + (uz * run) / 2;
    let best = 1e9;
    for (const oc of this._ovNear(cx, cz, run / 2 + hl + 10)) {
      if (oc === car || (oc.dead && !VF36) || !oc._pose) continue;   // VF36: a dead car is a body too
      // a body settled in a lane of my own edge: my lane's queue is IDM's, the others are beside me, not in my way (a box
      // truck's mirrors reach 0.2 m over a 3 m lane line; VT29's rule keeps a body crossing the line my leader)
      if (oc.e === e && !oc.turn && Math.abs((oc.laneF ?? oc.lane) - oc.lane) < 0.15) continue;
      const rx = oc._pose[0] - q0[0], rz = oc._pose[2] - q0[2], al = rx * ux + rz * uz;
      if (al < 0.3 && !(al > -0.3 && this._vcFirst(oc, car))) continue;   // level with or behind me (a stack: one goes first)
      if (!this._ovHit(cx, cz, yaw, hw, hl + run / 2, oc)) continue;
      for (let ds = 0; ds <= run; ds += 0.5) if (this._ovHit(q0[0] + ux * ds, q0[2] + uz * ds, yaw, hw, hl, oc)) { best = Math.min(best, ds - 0.5); car._vcBy = oc; break; }
    }
    return best;
  }
  // BL34: is the kerb travel lane of this edge's `dir` side a red bus lane? The surface under the lane's centre, sampled
  // once per edge and side every ~8 m between the junction mouths (red under 40 % of it or more); a side whose surface is
  // not all in yet answers from what is in and is sampled again 3 s later
  _busLane(e, dir) {
    if (!BL34 || !this.streamer || !this.streamer.surfaceInfoAt) return false;
    const k = dir > 0 ? '_blP' : '_blN', v = e[k];
    if (v === true || v === false) return v;
    if (v !== undefined && this.time < v[0]) return v[1];
    const lanesDir = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
    if (lanesDir < 2) return (e[k] = false);
    const off = this._laneOffsetAt(e, { dir }, lanesDir - 1);
    const a = Math.max(3, e.mouthA || 0), b = e.len - Math.max(3, e.mouthB || 0);
    if (b - a < 4) return (e[k] = false);
    const N = Math.max(2, Math.min(32, Math.round((b - a) / 8)));
    let n = 0, red = 0;
    for (let i = 0; i < N; i++) {
      const s = this.sampleEdge(e, a + ((i + 0.5) / N) * (b - a));
      const si = this.streamer.surfaceInfoAt(s.x - s.dirz * dir * off, s.z + s.dirx * dir * off, 0.3);
      if (!si) continue;
      n++;
      if (si.kind === 'busred') red++;
    }
    const isBus = n > 0 && red / n >= 0.4;
    if (n < N) { e[k] = [this.time + 3, isBus]; return isBus; }
    return (e[k] = isBus);
  }
  // BL34: the double-parked vehicle standing in lane `kl` of this edge nearest ahead of the car, from BL_LOOK m ahead until
  // the car's tail is past it: { o, g (the gap to its rear, negative once alongside) } or null
  _dpAhead(car, e, kl) {
    let best = null;
    for (const o of e.cars) {
      if (o === car || o.dir !== car.dir || o.lane !== kl || !(o._parkT > 0) || o.turn) continue;
      const fg = followGap(o, car), g = (o.d - car.d) * car.dir - fg;
      if (g < BL_LOOK && g > -2 * fg - 2 && (!best || g < best.g)) best = { o, g };
    }
    return best;
  }
  // BL34: no body in lane nl (or still in it) alongside the car, bumper to bumper plus 2 m
  _sideClear(car, e, nl) {
    for (const o of e.cars) {
      if (o === car || o.dir !== car.dir) continue;
      if (o.lane !== nl && !(Math.abs((o.laneF ?? o.lane) - nl) < 0.6)) continue;
      if (Math.abs(o.d - car.d) < followGap(o, car) + 2) return false;
    }
    return true;
  }
  // VQ30: how far lane nl of edge e is clear ahead of the car (to the nearest body in or still across that lane, less
  // its follow gap); 1e9 when nothing is ahead on this edge
  // (VQ31 slowOnly: bodies still doing 3 m/s or more beyond 11 m are no limit; the 11 m test beside the call covers the near ones)
  _freeAhead(car, e, nl, slowOnly = false) {
    let best = 1e9;
    for (const o of e.cars) {
      if (o === car || o.dir !== car.dir) continue;
      if (o.lane !== nl && !(Math.abs((o.laneF ?? o.lane) - nl) < 0.6)) continue;
      const g = (o.d - car.d) * car.dir;
      if (slowOnly && (o.v || 0) >= 3 && g > 11) continue;
      if (g > -1 && g - followGap(o, car) < best) best = g - followGap(o, car);
    }
    return best;
  }
  // VT29: half the body's extent ACROSS its lane: the half width, and what its angle to the lane adds (a car keeps the
  // angle of a lane change it stopped in)
  _latHalf(c) {
    const h = this.carHalf(c);
    if (c._yawL === undefined || c._hdg === undefined) return h[0];
    let a = c._yawL - c._hdg;
    a -= Math.round(a / (2 * Math.PI)) * 2 * Math.PI;
    return h[0] * Math.abs(Math.cos(a)) + h[1] * Math.abs(Math.sin(a));
  }
  // THE PATH A CAR WILL DRIVE: points from its centre forward (s = distance along the path) over the braking horizon,
  // through its lane, the turn connector it is on or will take (car.next is chosen 34 m out; VQ31: on entering the street, up to 160 m), and the next edge.
  // Cached per frame; the connector of a turn not yet begun is the same k = 0.36 cubic update() builds.
  carPath(car) {
    if (car._cpF === this._frame && car._cp) return car._cp;
    const P = car._cp || (car._cp = { n: 0, x: new Float32Array(64), z: new Float32Array(64), s: new Float32Array(64) });
    car._cpF = this._frame;
    P.n = 0;
    const q = car._pose;
    if (!q || !car.e) return P;
    const v = car.v || 0, half = this.carHalf(car)[1];
    const Lmax = half + Math.min(44, 8 + v * 1.1 + (v * v) / (2 * 2.4));
    const push = (x, z) => {
      if (P.n >= 64) return false;
      if (P.n) {
        const dx = x - P.x[P.n - 1], dz = z - P.z[P.n - 1], d = Math.hypot(dx, dz);
        if (d < 0.5) return P.s[P.n - 1] < Lmax;
        P.s[P.n] = P.s[P.n - 1] + d;
      } else P.s[0] = 0;
      P.x[P.n] = x; P.z[P.n] = z; P.n++;
      return P.s[P.n - 1] < Lmax;
    };
    const bez = (T, s) => {
      const t = TW26 && T.lut ? this._turnT(T, s) : Math.max(0, Math.min(1, s / T.len)), u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
      return push(a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0], a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2]);
    };
    // along edge e from d in direction dir (lane of `car`, travelling `dir`), up to dStop (the exit mouth) or Lmax
    // YD26: the edge the car is on at the lateral place it is really at (laneF: it eases over after a lane change and after a
    // turn whose lane was clamped), not its lane index: right after a turn the predicted path ran up to a lane beside the
    // car, and the car crept into a crosser standing in front of it (W 122nd / Lenox, W 120th / Amsterdam)
    const edge = (e, d, dir, dStop, lf) => {
      if (dir > 0 ? d > dStop : d < dStop) return true;   // already past this stretch (at the mouth)
      const lp = { dir, lane: car.lane };
      const off = this._laneOffsetAt(e, lp, lf !== undefined ? lf : Math.min(car.lane, Math.max(0, (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2))) - 1)));
      for (let dd = d; dir > 0 ? dd <= dStop : dd >= dStop; dd += dir * 3) {   // lanes: a point every 3 m (connectors: 1.5 m)
        const s = this.sampleEdge(e, dd), hx = s.dirx * dir, hz = s.dirz * dir;
        if (!push(s.x - hz * off, s.z + hx * off)) return false;
      }
      const s = this.sampleEdge(e, dStop), hx = s.dirx * dir, hz = s.dirz * dir;
      return push(s.x - hz * off, s.z + hx * off);
    };
    push(q[0], q[2]);
    if (car.turn) {
      const T = car.turn;
      let ok = true;
      for (let s = T.s + 1.5; s < T.len && ok; s += 1.5) ok = bez(T, s);
      if (ok && bez(T, T.len)) edge(car.e, car.d + car.dir * 1.5, car.dir, car.dir > 0 ? car.e.len - (car.e.mouthB || 0) : (car.e.mouthA || 0), YD26 && car.laneF !== undefined ? car.laneF : undefined);
      return P;
    }
    const e = car.e, dir = car.dir, mEnd = dir > 0 ? e.mouthB : e.mouthA;
    const exitD = Math.max(0.2, Math.min(e.len - 0.2, dir > 0 ? e.len - (mEnd || 0) : (mEnd || 0)));
    if (!edge(e, car.d + dir * 3, dir, exitD, YD26 && car.laneF !== undefined ? car.laneF : undefined)) return P;
    const nx = car.next;
    if (!nx || !this.edges.has(nx.ne.id)) return P;
    // the connector this car will build at the mouth (update(): mk(0.36 chord)), then the next edge
    const ne = nx.ne, nd = nx.o.dir, mN = nd > 0 ? ne.mouthA : ne.mouthB;
    const entryD = nd > 0 ? Math.min(mN + 1.0, ne.len * 0.5) : Math.max(ne.len - mN - 1.0, ne.len * 0.5);
    const ex = this.sampleEdge(e, exitD), en = this.sampleEdge(ne, entryD);
    const lanesN = ne.oneway !== 0 ? ne.lanes : Math.max(1, Math.floor(ne.lanes / 2));
    const offA = this._laneOffsetAt(e, { dir, lane: car.lane }, YD26 && car.laneF !== undefined ? car.laneF : car.lane), offB = this._laneOffsetAt(ne, { dir: nd }, Math.min(car.lane, lanesN - 1));
    const hA = [ex.dirx * dir, ex.dirz * dir], hB = [en.dirx * nd, en.dirz * nd];
    const p0 = [ex.x - hA[1] * offA, 0, ex.z + hA[0] * offA], p2 = [en.x - hB[1] * offB, 0, en.z + hB[0] * offB];
    const chord = Math.hypot(p2[0] - p0[0], p2[2] - p0[2]);
    if (chord > 60) return P;
    const k = 0.36 * chord;
    const T = { p0, c1: [p0[0] + hA[0] * k, 0, p0[2] + hA[1] * k], c2: [p2[0] - hB[0] * k, 0, p2[2] - hB[1] * k], p2, len: Math.max(1, chord * 1.1) };
    let ok = true;
    for (let s = 1.5; s < T.len && ok; s += 1.5) ok = bez(T, s);
    if (ok && bez(T, T.len)) edge(ne, entryD + nd * 1.5, nd, nd > 0 ? ne.len - (ne.mouthB || 0) : (ne.mouthA || 0));
    return P;
  }
  // Where must `car` stop for the walker at (wx, wz) moving at (vx, vz)? Returns the gap from its front bumper to that
  // stop point, 1e9 if the walker is not and will not be in its way. The walker's lateral offset from the car's path and
  // its speed across it give the time window it spends inside the corridor (car half width + 0.25 m body + 0.35 m); the
  // car's front and back give the window the car spends at that point. Overlapping windows = yield, stopping 1.25 m short
  // of the walker (IDM keeps its own 2.2 m on top). A walker beside or behind the front bumper is not in front of the
  // car: stepping into a car's flank is the walker's to avoid (peds.js), a stop there would not help.
  _walkerGap(car, wx, wz, vx, vz, margin = 0.35) {
    const P = this.carPath(car);
    if (P.n < 2) return 1e9;
    const [hw, half] = this.carHalf(car);
    // quick out: nowhere near the path's box (grown by the corridor and 7 m of walking)
    if (P.bbF !== car._cpF) {
      let a = 1e9, b = 1e9, e = -1e9, f = -1e9;
      for (let i = 0; i < P.n; i++) { if (P.x[i] < a) a = P.x[i]; if (P.x[i] > e) e = P.x[i]; if (P.z[i] < b) b = P.z[i]; if (P.z[i] > f) f = P.z[i]; }
      P.bx0 = a; P.bz0 = b; P.bx1 = e; P.bz1 = f; P.bbF = car._cpF;
    }
    const grow = hw + 0.25 + margin + 7;
    if (wx < P.bx0 - grow || wx > P.bx1 + grow || wz < P.bz0 - grow || wz > P.bz1 + grow) return 1e9;
    let bd = 1e18, bs = 0, bl = 0, bnx = 0, bnz = 0;
    for (let i = 1; i < P.n; i++) {
      const ax = P.x[i - 1], az = P.z[i - 1], ex = P.x[i] - ax, ez = P.z[i] - az, L2 = ex * ex + ez * ez || 1e-9;
      const t = Math.max(0, Math.min(1, ((wx - ax) * ex + (wz - az) * ez) / L2));
      const dx = wx - ax - ex * t, dz = wz - az - ez * t, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; bs = P.s[i - 1] + (P.s[i] - P.s[i - 1]) * t; const L = Math.sqrt(L2); bnx = -ez / L; bnz = ex / L; bl = dx * bnx + dz * bnz; }
    }
    if (bs < half - 0.4 || bs >= P.s[P.n - 1] - 0.05 && Math.sqrt(bd) > hw + 0.25 + margin) return 1e9;
    const W = hw + 0.25 + margin, lat = Math.abs(bl);
    if (lat > W + (YD26 ? 7.5 : 7)) return 1e9;
    const uLat = -(vx * bnx + vz * bnz) * Math.sign(bl || 1);   // > 0: walking toward the car's path
    const v = Math.max(car.v || 0, 0.8);
    const tF = Math.max(0, bs - half) / v, tB = tF + (2 * half + 0.6) / v;
    let hit;
    if (YD26 && margin >= 0.35) {
      // YD26 (crossers, turning cars): the corridor 0.25 m wider (0.45 m in a turn: the front corner swings out of the
      // path of the centre); the car reaches the point no later than at 3 m/s (a creeping car pulls away); the walker must
      // be out of the corridor 1 s before the car arrives, or reach it 1 s after the car has gone
      const W2 = W + (car.turn ? 0.45 : 0.25), dF = Math.max(0, bs - half);
      const tFf = dF / Math.max(car.v || 0, 3), tBs = (dF + 2 * half + 0.6) / Math.max(0.8, car.v || 0);
      if (lat < W2) hit = !(uLat < -0.3 && (W2 - lat) / -uLat + 1.0 < tFf);
      else if (uLat > 0.15) {
        const tIn = (lat - W2) / uLat, tOut = (lat + W2) / uLat;
        hit = tIn < 6 && tIn < tBs + 1.0 && tOut > tFf - 1.0;
      } else hit = false;
    } else if (lat < W) {
      // in the corridor now: yield, unless walking out of it well before the car gets there
      hit = !(uLat < -0.15 && (W - lat) / -uLat + 0.7 < tF);
    } else if (uLat > 0.15) {
      const tIn = (lat - W) / uLat, tOut = (lat + W) / uLat;
      hit = tIn < 6 && tIn < tB + 0.6 && tOut > tF - 0.7;
    } else hit = false;
    return hit ? Math.max(0, bs - half - 1.25) : 1e9;
  }
  // once per update, BEFORE the cars move: every published walker marks the cars that must stop for it (car._pg)
  _pedPass(dt = 1 / 60) {
    this._pgStamp = (this._pgStamp || 0) + 1;
    const stamp = this._pgStamp;
    // Every car also looks for ANY walker along its path in peds.js's 2 m walker hash, not only the crossers: a turning
    // car's body sweeps the corner pavement on a tight curb return (W 122nd audit: turning cars through people walking and
    // waiting on the corner), and where a lane lies over the paving a car drove down the sidewalk into walkers (5th Ave
    // audit). Body margin 0.1 m for people on the pavement: they are not stepping into the lane. A 16 m occupancy grid of
    // the walkers skips every car with nobody near its path (most of the fleet: walkers live within 330 m of the camera).
    const H = this._walkerHash;
    if (H && this._carGrid) {
      // walkers in 8 m cells (from peds.js's 2 m hash) and a 64 m occupancy for the per-car cut
      const W8 = this._pgW8 || (this._pgW8 = new Map()), occ = this._pgOcc || (this._pgOcc = new Set());
      if (((this._pgN = (this._pgN || 0) + 1) & 255) === 0) W8.clear(); else for (const L of W8.values()) L.length = 0;
      occ.clear();
      for (const A of H.values()) for (const w of A) {
        if (w._x === undefined || w.cross) continue;   // crossers come from _crossers below
        if (this._walkerKerb && !w._kerb) continue;    // (peds.js LN25) well in from the kerb: never in a car's corridor
        const k = (Math.floor(w._x / 8) + 32768) * 65536 + (Math.floor(w._z / 8) + 32768);
        let L = W8.get(k);
        if (!L) W8.set(k, (L = []));
        L.push(w);
        occ.add((Math.floor(w._x / 64) + 4096) * 8192 + (Math.floor(w._z / 64) + 4096));
      }
      const par = this._frame & 1;
      for (let ci = 0; ci < this.cars.length; ci++) {
        const c = this.cars[ci];
        if (c.manual || !c._pose || !occ.size) continue;
        // half the fleet per frame: the other half carries last frame's gap, less what it drove since
        if ((ci & 1) !== par) {
          if (c._pkF === this._frame - 1 && c._pk < 1e8) { const g = c._pk - (c.v || 0) * dt; c._pk = g; c._pkF = this._frame; c._pgS = stamp; c._pg = Math.min(1e9, g); }
          continue;
        }
        c._pkF = this._frame; c._pk = 1e9;
        const q = c._pose, gx0 = Math.floor(q[0] / 64), gz0 = Math.floor(q[2] / 64);
        let any = false;
        for (let gx = gx0 - 1; gx <= gx0 + 1 && !any; gx++) for (let gz = gz0 - 1; gz <= gz0 + 1 && !any; gz++) any = occ.has((gx + 4096) * 8192 + (gz + 4096));
        if (!any) continue;
        const [hw, hl] = this.carHalf(c), rr = hw + (c.turn ? 0.35 : 0.1) + 0.25 + 1.8;   // corridor + 1.8 m of walking
        // a car going straight, not near its junction: its path is its lane ahead, so a walker nowhere near the ray ahead
        // of it (within rr + 1.5 of that ray) cannot be in its corridor: skip building the path at all
        const e = c.e, endD = e ? (c.dir > 0 ? e.len - c.d : c.d) : 0;
        if (!c.turn && endD > 40) {
          const fx = Math.sin(q[3]), fz = Math.cos(q[3]), v = c.v || 0, H = hl + Math.min(44, 8 + v * 1.1 + (v * v) / 4.8);
          const R = rr + 1.5, r2 = R * R, ax = q[0] + fx * (hl - 1), az = q[2] + fz * (hl - 1), L = H - hl + 1;
          const bx = ax + fx * L, bz = az + fz * L;
          let near = false;
          for (let gx = Math.floor((Math.min(ax, bx) - R) / 8); gx <= Math.floor((Math.max(ax, bx) + R) / 8) && !near; gx++)
            for (let gz = Math.floor((Math.min(az, bz) - R) / 8); gz <= Math.floor((Math.max(az, bz) + R) / 8) && !near; gz++) {
              const A = W8.get((gx + 32768) * 65536 + (gz + 32768));
              if (A) for (const w of A) {
                const t = Math.max(0, Math.min(L, (w._x - ax) * fx + (w._z - az) * fz));
                const ex = w._x - ax - fx * t, ez = w._z - az - fz * t;
                if (ex * ex + ez * ez < r2) { near = true; break; }
              }
            }
          if (!near) continue;
        }
        const P = this.carPath(c);
        if (P.n < 2) continue;
        const ctag = (this._pgTag = (this._pgTag || 0) + 1);   // one tag per car per frame: each walker is tested once per car
        // every other path point (3 m) and the last; each with the 8 m cells within rr of it
        const SX = this._psx || (this._psx = new Float64Array(72)), SZ = this._psz || (this._psz = new Float64Array(72)), SG = this._psg || (this._psg = new Int32Array(288));
        let ns = 0, gxA = 1e9, gxB = -1e9, gzA = 1e9, gzB = -1e9;
        for (let i = 0; i < P.n; i = i + 2 < P.n || i === P.n - 1 ? i + 2 : P.n - 1) {
          const x = P.x[i], z = P.z[i], a = Math.floor((x - rr) / 8), b = Math.floor((x + rr) / 8), c0 = Math.floor((z - rr) / 8), c1 = Math.floor((z + rr) / 8);
          SX[ns] = x; SZ[ns] = z; SG[ns * 4] = a; SG[ns * 4 + 1] = b; SG[ns * 4 + 2] = c0; SG[ns * 4 + 3] = c1; ns++;
          if (a < gxA) gxA = a; if (b > gxB) gxB = b; if (c0 < gzA) gzA = c0; if (c1 > gzB) gzB = c1;
        }
        const r15 = (rr + 1.5) * (rr + 1.5);
        for (let gx = gxA; gx <= gxB; gx++)
          for (let gz = gzA; gz <= gzB; gz++) {
              const A = W8.get((gx + 32768) * 65536 + (gz + 32768));
              if (!A) continue;
              for (const w of A) {
                if (w._pgT === ctag) continue;
                // within the corridor + 1.8 m of walking of a scanned point whose cells hold this one (3 m apart, +1.5)
                let near = false;
                for (let j = 0; j < ns && !near; j++) {
                  if (gx < SG[j * 4] || gx > SG[j * 4 + 1] || gz < SG[j * 4 + 2] || gz > SG[j * 4 + 3]) continue;
                  const x = SX[j], z = SZ[j];
                  near = (w._x - x) * (w._x - x) + (w._z - z) * (w._z - z) <= r15;
                }
                if (!near) continue;
                w._pgT = ctag;
                // 0.1 m for a car going straight; a TURNING car's inner rear corner tracks up to ~0.4 m inside the path of its centre
                const g = this._walkerGap(c, w._x, w._z, w._vx || 0, w._vz || 0, c.turn ? 0.35 : 0.1);
                if (c._pgS !== stamp) { c._pgS = stamp; c._pg = 1e9; }
                if (g < c._pg) c._pg = g;
                if (g < c._pk) c._pk = g;
              }
            }
      }
    }
    const X = this._crossers, V = this._crossV;
    if (!X || !X.length || !this._carGrid) return;
    const G = this._carGrid;
    for (let k = 0; k + 1 < X.length; k += 2) {
      const wx = X[k], wz = X[k + 1];
      const vx = V && k + 1 < V.length ? V[k] : 0, vz = V && k + 1 < V.length ? V[k + 1] : 0;
      // the cars within 46 m (the car grid's cells, as carsNear)
      const ga = Math.floor((wx - 46) / CG), gb = Math.floor((wx + 46) / CG), gc = Math.floor((wz - 46) / CG), gd = Math.floor((wz + 46) / CG);
      for (let gx = ga; gx <= gb; gx++) for (let gz = gc; gz <= gd; gz++) {
        const L = G.get((gx + 32768) * 65536 + (gz + 32768));
        if (!L) continue;
        for (let i = 0; i < L.length; i++) {
          const c = L[i];
          if (c.manual || !c._pose) continue;
          // only cars heading this way can reach the walker: a quick cut before the path test
          const q = c._pose, dx = wx - q[0], dz = wz - q[2];
          if (dx * c._hsx + dz * c._hcz < -3 && !c.turn) continue;
          // beyond all the path the car could have (arc <= Lmax + 6) plus its corridor and 10.5 m: no yield (see above)
          const hh = this.carHalf(c), v = c.v || 0, R = hh[1] + Math.min(44, 8 + v * 1.1 + (v * v) / (2 * 2.4)) + 6 + hh[0] + 0.6 + 10.5;
          if (dx * dx + dz * dz > R * R) continue;
          const g = this._walkerGap(c, wx, wz, vx, vz, 0.35);
          if (c._pgS !== stamp) { c._pgS = stamp; c._pg = 1e9; }
          if (g < c._pg) c._pg = g;
        }
      }
    }
  }
  update(dt, px, pz) {
    this.time += dt;
    dt = Math.min(dt, 0.05);
    if (FG31 && this.vehDims && this._vdSeen !== this.vehDims) {   // FG31: the lengths the follow gap uses, once per fleet
      this._vdSeen = this.vehDims;
      // (VC36: or twice the drawn body's longer reach from its pose: the MTA buses' fronts reach 0.3 m past half their length)
      VLEN_FLEET = Object.fromEntries(Object.entries(this.vehDims).filter(([, d]) => d && d[2] > 2).map(([k, d]) => [k, VC36 && this.fleet24 ? Math.max(d[2], 2 * this.carHalf({ kind: k })[1]) : d[2]]));
    }
    // PK41: the 125th Street tiles packed before fleet24's sizes existed park again with them
    if (PK41 && this.vehDims && this._dimWait && this._dimWait.size) { const wait = this._dimWait; this._dimWait = null; for (const [k, d] of wait) if (this.parkedRecs.has(k)) this._parkTile(k, d); }
    this._frame = (this._frame || 0) + 1;
    if (PY25) this._pedPass(dt);
    if (this._compDirty) this._relabelComponents();
    { // parked LOD: rebucket when tiles changed or the camera moved 24m
      // FP37 (core/engine.js, the film policy): while recording, once per take, by the take's nearest approach to each car
      const fp = typeof window !== 'undefined' && window.__FP37 && window.__FP37.pts ? window.__FP37 : null;
      if (fp) { if (this._parkDirty || this._pbV !== fp.v) { this._pbV = fp.v; this._rebucketParked(px, pz, fp); } }
      else {
        this._pbV = -1;
        const mx = px - this._pbX, mz = pz - this._pbZ;
        if (this._parkDirty || mx * mx + mz * mz > 576) this._rebucketParked(px, pz);
      }
    }
    // TP34: a camera jump of more than 150 m between updates opens a 20 s refill window
    if (TP34 && this._lpx !== undefined && Math.hypot(px - this._lpx, pz - this._lpz) > 150) this._refill = this.time + 20;
    this._lpx = px; this._lpz = pz;
    const tgt = this.target * (TP34 && this.time < (this._refill || 0) ? 1.3 : 1);
    // cars spawned through the external API (src/api/bridge.js, car.api) are extra, never part of the ambient target
    if (this.cars.length - (this.apiCount || 0) < tgt && this.edges.size > 30) for (let i = 0; i < 8; i++) this.spawnCar(px, pz);
    if (BUS34 && this.edges.size > 30 && (this._busT = (this._busT || 0) - dt) <= 0) { this._busT = this.time < 20 ? 0.1 : 0.8; this._spawnBus(px, pz); }
    if (OV32) this._ovGrid();
    for (let ci = this.cars.length - 1; ci >= 0; ci--) {
      const car = this.cars[ci];
      if (car.manual) continue;   // an API car under apply_control(): src/api/bridge.js moves and places it
      // OV32 watchdog: a car that has stood 40 s where no camera sees it, not for a red light nor behind another car, heads a
      // jam the rules above could not untie (a pair each held by the other's body since a spawn put one inside the other):
      // it is recycled, and the ambient target puts a car back somewhere else
      if (OV32 && !car.api) {
        car._standT = (car.v || 0) < 0.1 ? (car._standT || 0) + dt : 0;
        // (only the head of a jam: a car in a queue waits for the one ahead, and one at a red light for the light)
        if (car._standT > 40 && (car.turn || !/^(signal|link red|queue)$/.test(car._why || '')) && !this._ovSeen(car)) { this.ovRecycled = (this.ovRecycled || 0) + 1; this._remove(ci); continue; }
      }
      const e = car.e;
      if (e.minor) car.dead = true; // stranded on a fragment: recycle onto the network
      // VF36: a dead car is recycled once no camera can see it (and in a recorder's warm-up, when spawning in view is allowed
      // too); in sight it stands where it is drawn (its d from that pose, once) and the body tests count it
      if (VF36 && car.dead && !car.api) {
        if (!this._ovSeen(car) || (VF_REC && !spawnGuard.on)) { this.vfRecycled = (this.vfRecycled || 0) + 1; this._remove(ci); continue; }
        if (!e.minor && car._pose) {
          const q = car._pose;
          if (!car._vfHeld) { car._vfHeld = true; const p = this._projEdge(e, q[0], q[2]); if (p) car.d = Math.max(0.1, Math.min(e.len - 0.1, p.d)); this.vfHeld = (this.vfHeld || 0) + 1; }
          car.v = 0;
          this._placeCar(car, q[0], q[1], q[2], q[3], dt);
          continue;
        }
      }
      // ---- curved intersection turn in progress
      if (car.turn) {
        const T = car.turn;
        // follow through the box: the nearest car ahead on the entry lane (or further along the
        // same connector) sets the speed — turning cars used to run at >= 3.5 m/s into a queue
        let gapT = 1e9;
        const ne = car.e, entryD = car.d;
        for (const oc of ne.cars) {
          if (oc === car || oc.dir !== car.dir || oc.lane !== car.lane) continue;
          if (oc.turn) {
            if (oc.turnNode !== car.turnNode) continue;
            // OV32: on two connectors into this lane the one with less of its connector left leads (s is metres along each
            // car's own connector: a car 1.3 m into a 26.7 m one took the lead over one standing at the start of an 18.9 m
            // one, which then waited for it while the first was held by its body)
            // (VC36: of two level, a stack on one connector, the one second follows the one first)
            if (OV32) { const rO = oc.turn.len - oc.turn.s, rM = T.len - T.s; if (rO < rM || (VC36 && Math.abs(rO - rM) < 0.3 && this._vcFirst(oc, car))) gapT = Math.min(gapT, rM - rO - followGap(oc, car)); }
            else if (oc.turn.s > T.s) gapT = Math.min(gapT, oc.turn.s - T.s - followGap(oc, car));
            continue;
          }
          const ahead = (oc.d - entryD) * car.dir;
          if (ahead > -1) gapT = Math.min(gapT, (T.len - T.s) + ahead - followGap(oc, car));
        }
        // with a leader: comfortable stop within the gap (no speed floor — the old 3.5 m/s floor
        // drove followers into the car ahead on 10 m connectors); without: the old behaviour
        const pgT = this._pedGap(car);
        if (pgT < gapT) { gapT = pgT; car._pyHold = true; }
        // OV32: stand short of any other body on the rest of the path
        if (OV32) {
          const gB = this._ovSweepTurn(car, T);   // car._ovBy: the body it met this frame (null: none)
          if (gB < gapT) { gapT = gB; car._ovT = car._ovBy === car._ovPrev ? (car._ovT || 0) + dt : dt; car._ovPrev = car._ovBy; }
          else { car._ovT = 0; car._ovPrev = null; }
        }
        // VT28: the connector's cap is met braking at up to 4.5 m/s2 (a tight bend used to cut the speed in one frame)
        const capT = VT28 ? Math.max(T.vCap, car.v - 4.5 * dt) : T.vCap;
        if (gapT < 1e8) car.v = gapT < 0.6 ? 0 : Math.min(car.v + IDM.a * dt, capT, Math.sqrt(Math.max(0, gapT - 0.6) * IDM.b));
        // PY25: a car that slowed in the box for a walker pulls away (IDM a), it does not jump back to 3.5 m/s in one frame
        else if (car._pyHold && car.v < 3.5) car.v = Math.min(capT, car.v + IDM.a * dt);
        else { car._pyHold = false; car.v = Math.max(VT28 ? Math.min(3.5, T.vCap) : 3.5, Math.min(car.v, capT)); }
        const sS = T.s;   // VN36
        T.s = Math.min(T.len, T.s + car.v * dt);
        const t = TW26 && T.lut ? this._turnT(T, T.s) : T.s / T.len;
        const omt = 1 - t;
        // cubic Bezier p0 -> c1 -> c2 -> p2 (see the connector construction below)
        const a0 = omt * omt * omt, a1 = 3 * omt * omt * t, a2 = 3 * omt * t * t, a3 = t * t * t;
        const bx = a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0];
        const by = a0 * T.p0[1] + a1 * T.c1[1] + a2 * T.c2[1] + a3 * T.p2[1];
        const bz = a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2];
        const d0 = 3 * omt * omt, d1 = 6 * omt * t, d2 = 3 * t * t;
        let tx2 = d0 * (T.c1[0] - T.p0[0]) + d1 * (T.c2[0] - T.c1[0]) + d2 * (T.p2[0] - T.c2[0]);
        let tz2 = d0 * (T.c1[2] - T.p0[2]) + d1 * (T.c2[2] - T.c1[2]) + d2 * (T.p2[2] - T.c2[2]);
        if (Math.abs(tx2) + Math.abs(tz2) < 1e-6) { tx2 = T.p2[0] - T.p0[0]; tz2 = T.p2[2] - T.p0[2]; } // degenerate (straight chord, k = 0) endpoints
        const yaw = Math.atan2(tx2, tz2);
        // VN36: never into another body
        if (VN36 && dt > 0 && car._pose && this._vnBlocked(car, bx, bz, yaw, dt)) { T.s = sS; car.v = 0; const q = car._pose; this._placeCar(car, q[0], q[1], q[2], q[3], dt); continue; }
        this._placeCar(car, bx, by, bz, yaw, dt);
        if (T.s >= T.len) { car.turn = null; if (BX27) car._tail = this.carHalf(car)[1] + 0.6; car._ovT = 0; car._ovBy = car._ovPrev = car._ovForcedBy = null; }   // BX27: its rear is still in the box
        continue;
      }
      const s = this.sampleEdge(e, car.d);
      const dist = Math.hypot(s.x - px, s.z - pz);
      if (!car.api && (dist > DESPAWN_R || (car.dead && dist > DEAD_DESPAWN))) { this._remove(ci); continue; }
      const endD = car.dir > 0 ? e.len - car.d : car.d;         // distance to node center
      const nodeKey = car.dir > 0 ? e.b : e.a;
      const mEnd = car.dir > 0 ? e.mouthB : e.mouthA;           // junction boundary
      // stop point: car center such that the bumper sits on the painted stop bar. XW11: the bar is
      // at mouth + 0.35 + XW_DEPTH + 1.2, so the old fixed mouth+5.3 (tuned for a 4.6 m crossing)
      // would have parked the queue ON the deeper NYC crossing.
      const stopD = mEnd > 0 ? Math.min(mEnd + XW_DEPTH(e.rclass, e.width) + 0.7, Math.max(2, e.len * 0.45)) : 5.5;
      // ---- route early so we can see queues, signal phase and yield conflicts
      if (car.next && !this.edges.has(car.next.ne.id)) car.next = null;
      if (endD < (VQ31E ? Math.max(34, Math.min(160, e.len)) : 34) && !car.next) {   // VQ31: on entering the street
        const ex = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
        car.next = this._pickNext(car, nodeKey, ex[0], ex[1]) || null;
        car.nextNone = !car.next;
        // turn-lane discipline: a right turn is made from the curb lane, a left turn from the
        // inner lane (lane 0 is the leftmost lane of travel). Cars used to turn from any lane,
        // cutting across the neighbours - the main source of the side collisions in the audit.
        car.turnLaneWant = -1;
        if (car.next) {
          const ne2 = car.next.ne, nd = car.next.o.dir;
          const mN = nd > 0 ? ne2.mouthA : ne2.mouthB;
          const hB2 = this.dirAt(ne2, nd > 0 ? Math.min(mN + 1, ne2.len * 0.5) : Math.max(ne2.len - mN - 1, ne2.len * 0.5), nd);
          const cr = ex[0] * hB2[1] - ex[1] * hB2[0];
          const lanesHere = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
          if (cr > 0.4) car.turnLaneWant = lanesHere - 1; else if (cr < -0.4) car.turnLaneWant = 0;
        }
      }
      // PY25: the wish is bounded by THIS edge's lanes (it was computed on the previous one, which may have had four)
      if (PY25 && car.turnLaneWant >= 0) car.turnLaneWant = Math.min(car.turnLaneWant, Math.max(0, (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2))) - 1));
      if (PY25 && car.lane > Math.max(0, (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2))) - 1)) car.lane = Math.max(0, (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2))) - 1);
      // VQ30: a car moves over for its turn only while rolling and into a gap (10 m of its new lane clear ahead); one
      // standing in a queue waits for the queue to move
      // BL34: the red bus lane is the buses': a vehicle that is not one takes it only for a right turn at the next corner,
      // from BL_RIGHT m out, and otherwise moves out of it (a double-parked van standing in it excepted)
      let tlw = car.turnLaneWant, blOut = false;
      if (BL34 && !car.route && car.kind !== 'bus' && !(car._parkT > 0)) {
        const kl = (e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2))) - 1;
        if (kl > 0 && (tlw === kl ? endD > BL_RIGHT : car.lane === kl) && this._busLane(e, car.dir)) { blOut = tlw !== kl; tlw = kl - 1; }
      }
      if (tlw >= 0 && car.lane !== tlw && !car._lcT && endD > 6 && !car._dwell
          && (!VQ30 || car.v > 0.5)) {
        const nl = car.lane + (tlw > car.lane ? 1 : -1);
        // VQ31: the new lane free of slow bodies for the whole change, my own road too when my leader is slow, and the
        // change done before the junction's mouth (stopdev5: the cars still stopped at a steep angle all stood in its last 10 m)
        const room = VQ31 ? lcRoom(car.v, this._laneOffsetAt(e, car, car.lane + 1) - this._laneOffsetAt(e, car, car.lane) || 3.2) : 0;
        let clear = !VQ30 || (VQ31 ? endD - (mEnd || 0) > room && this._freeAhead(car, e, nl, true) > room && ((car._leadQ ?? 99) >= 3 || (car._gapQ ?? 1e9) > room) : this._freeAhead(car, e, nl) > 10);
        for (const o of e.cars) {
          if (o === car || o.dir !== car.dir) continue;
          if (o.lane !== nl && !(VT29 && Math.abs((o.laneF ?? o.lane) - nl) < 0.6)) continue;   // VT29: or still in it
          if (Math.abs(o.d - car.d) < (VC36 ? lcNeed(o, car, 11) : 11)) { clear = false; break; }
        }
        if (clear) { car.lane = nl; car._lcT = 1.2; }
        else if (endD < 16 && !blOut) car.v = Math.min(car.v, 2.5);   // could not get over: creep and wait for a gap
      }
      // ---- IDM longitudinal control: leader on my edge/lane
      let v0 = e.speed * (0.85 + ((car.idx * 37) % 10) / 40);
      // VT27: a car slows for the turn ahead the way a driver does: its desired speed follows a 2.2 m/s2 braking curve down
      // to the connector's cap at the mouth (6 m/s round a corner, 3.2 for a U-turn); it used to meet the cap in one frame
      if (VT27 && car.next && car.next.turn && car.next.turn !== 'straight') {
        const vTurn = car.next.turn === 'uturn' ? 3.2 : 6.0, dM = Math.max(0, endD - Math.max(0, mEnd || 0));
        v0 = Math.min(v0, Math.sqrt(vTurn * vTurn + 4.4 * dM));
      }
      let gap = 1e9, leadV = v0, leadC = null;   // leadC: the car the gap is to (read by the census / probes only)
      const myLf = VT28 && car.laneF !== undefined ? car.laneF : car.lane;
      // VT29: a body across my lane is my leader when the two bodies' spans across the lane meet: their half widths plus
      // what their angle to the lane adds (a car stops mid lane change at that angle, and a box truck at 8 deg reaches 0.54 m
      // further each side than its width). A fixed share of a lane cannot hold both: 0.62 missed a car stopped at 0.65 of the
      // way over, and 0.8 missed a box truck stopped at 0.85 whose rear corner stood half a metre into the lane it had left
      // (a box truck drove into it and stood there 27 s: col_ab9, 125th St east of Lenox).
      const lwE = VT29 ? (Math.abs(this._laneOffsetAt(e, car, myLf + 1) - this._laneOffsetAt(e, car, myLf)) || 3) : 0;
      const myW = VT29 ? this._latHalf(car) : 0;
      for (const o of e.cars) {
        if (o === car || o.dir !== car.dir) continue;
        // VT28: my lane, or a body across it (a lane change under way on either side)
        if (o.lane !== car.lane) {
          if (!VT28) continue;
          const dl = Math.abs((o.laneF ?? o.lane) - myLf);
          if (VT29 ? dl * lwE > myW + this._latHalf(o) + 0.25 : dl >= 0.62) continue;
        }
        const g = (o.d - car.d) * car.dir - followGap(o, car);
        // VC36: a body already inside the one ahead is still following it (a centre ahead, or of two level the one second)
        const ahC = (o.d - car.d) * car.dir;
        if ((g > -2 || (VC36 && (ahC > 0.3 || (ahC > -0.3 && this._vcFirst(o, car))))) && g < gap) { gap = Math.max(0.05, g); leadV = o.v; leadC = o; }
      }
      // the car that just left my lane through the mouth is still my leader while it is on its
      // connector (audit: followers bumped the tail of a car 1 m into its turn)
      if (endD < 40) {
        for (const oc of this.cars) {
          if (!oc.turn || oc.turnFrom !== e || oc.turnFromDir !== car.dir || oc.turnFromLane !== car.lane) continue;
          const g = (endD - mEnd) + oc.turn.s - followGap(oc, car);
          if ((g > -2 || VC36) && g < gap)   // VC36: it left my lane through the mouth: ahead of me however near
             { gap = Math.max(0.05, g); leadV = oc.v; leadC = oc; }
        }
      }
      // queue look-ahead across the junction: nearest car on the chosen next edge
      if (car.next && endD < 30) {
        const ne = car.next.ne, ndir = car.next.o.dir;
        const entry0 = ndir > 0 ? 0 : ne.len;
        for (const oc of ne.cars) {
          if (oc.dir !== ndir) continue;
          const g2 = (oc.d - entry0) * ndir;
          if (g2 < -1) continue;
          const g = endD + g2 - followGap(oc, car);
          if (g > -2 && g < gap) { gap = Math.max(0.05, g); leadV = oc.v; leadC = oc; }
        }
      }
      // VC36: near the mouth, any other body in the lane ahead (a turning truck's rear still across it, a body over the mouth)
      if (VC36 && OV32 && endD - Math.max(0, mEnd || 0) < 30 && Math.abs((car.laneF ?? car.lane) - car.lane) < 0.15) {
        car._vcBy = null;
        const gB = this._ovSweepEdge(car, e, endD, mEnd);
        if (gB < gap) { gap = Math.max(0.05, gB); leadV = 0; leadC = car._vcBy; }
      }
      car._leadCar = leadC;
      // ---- lane change: a blocked car slides to a clear adjacent lane
      const lanesDirNow = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
      // VQ30: and only into a gap it can finish in (14 m of the new lane clear ahead)
      // BUS34: a route bus keeps its red lane on 125th Street
      // (BL34: but passes a double-parked vehicle standing in it: out into the next lane while it has the room for the
      // change, back once its tail is past it and the red lane beside it is clear)
      if (car.route && e.c125) {
        const kl = lanesDirNow - 1, dpA = BL34 && kl > 0 && !car.turn ? this._dpAhead(car, e, kl) : null;
        if (!dpA) { if (car.lane !== kl && !car.turn && (!BL34 || this._sideClear(car, e, kl))) car.lane = kl; }
        else if (car.lane === kl && !car._lcT && car.v > 0.5 && !(car._dwell > 0)) {
          const room = VQ31 ? lcRoom(car.v, this._laneOffsetAt(e, car, kl) - this._laneOffsetAt(e, car, kl - 1) || 3.2) : 0;
          if (dpA.g > room && endD - (mEnd || 0) > room + 2 && this._freeAhead(car, e, kl - 1, true) > room + 2 && this._sideClear(car, e, kl - 1)) { car.lane = kl - 1; car._lcT = 1.2; }
        }
      }
      // BL34: a car closing on a double-parked vehicle or a dwelling bus standing in its lane moves out from BL_LOOK m back,
      // while it still has the room for the change
      else if (lanesDirNow > 1 && !car._lcT && ((gap < 14 && leadV < car.v * 0.65 && car.v > 2)
          || (BL34 && gap < BL_LOOK && car.v > 0.5 && leadC && leadC.e === e && !leadC.turn && leadC.lane === car.lane && (leadC._parkT > 0 || leadC._dwell > 0) && (leadC.v || 0) < 0.3))) {
        const blK = BL34 && !car.route && car.kind !== 'bus' && this._busLane(e, car.dir);
        for (const dl of [1, -1]) {
          const nl = car.lane + dl;
          if (nl < 0 || nl >= lanesDirNow) continue;
          if (blK && nl === lanesDirNow - 1) continue;   // BL34: never into the red bus lane to pass
          // VQ31: room for the whole change in the new lane and before the junction's mouth, and a leader still rolling or
          // far enough to finish behind
          const room = VQ31 ? lcRoom(car.v, this._laneOffsetAt(e, car, car.lane + 1) - this._laneOffsetAt(e, car, car.lane) || 3.2) : 0;
          let clear = !VQ30 || (VQ31 ? endD - (mEnd || 0) > room + 2 && this._freeAhead(car, e, nl, true) > room + 2 && (leadV > 1 || gap > room) : this._freeAhead(car, e, nl) > 14);
          for (const o of e.cars) {
            if (o === car || o.dir !== car.dir) continue;
            if (o.lane !== nl && !(VT29 && Math.abs((o.laneF ?? o.lane) - nl) < 0.6)) continue;   // VT29: or still in it
            if (Math.abs(o.d - car.d) < (VC36 ? lcNeed(o, car, 13) : 13)) { clear = false; break; }
          }
          if (clear) { car.lane = nl; car._lcT = 1.2; break; }
        }
      }
      if (car._lcT) { car._lcT -= dt; if (car._lcT <= 0) car._lcT = 0; }
      // ---- bus stops: buses pull over at the curb lane periodically
      if (car.kind === 'bus') {
        car._busT = (car._busT ?? (12 + Math.random() * 25)) - dt;
        if (car._busT <= 0 && !car._dwell && endD > 25 && car.lane === lanesDirNow - 1) {   // curb lane (lane 0 is the left lane)
          car._dwell = 7 + Math.random() * 4;
          car._busT = 28 + Math.random() * 30;
        }
        if (car._dwell) {
          car._dwell -= dt;
          if (car._dwell <= 0) car._dwell = 0;
          else { gap = Math.min(gap, 0.1); leadV = 0; } // doors open, hold
        }
      }
      // ---- BUS34: a route bus pulls up with its front at each of its route's stops on this edge and dwells
      if (car.route && ((e.stops && e.stops.length) || car._dwell > 0)) {
        if (car._dwell > 0) {
          car._dwell -= dt;
          if (car._dwell <= 0) { car._dwell = 0; car._served = car._stopAt; }
          else { gap = Math.min(gap, 0.1); leadV = 0; }
        } else {
          const hl = vlen(car) / 2;
          let best = null, bestA = 1e9;
          for (const st of e.stops) {
            if (st.dir !== car.dir || st === car._served || !st.routes.includes(car.route)) continue;
            if (st.snap === undefined && HYDRANTS !== null) {
              // the surveyed sign on this kerb nearest the GTFS point (within 40 m along the street) is where the bus pulls up
              st.snap = null;
              let bd = 40;
              for (const [bx, bz] of BUSSIGNS) {
                const p = this._projEdge(e, bx, bz);
                if (!p || p.lat > 16 || p.lat < 6 || p.side !== st.dir || Math.abs(p.d - st.d) >= bd) continue;
                bd = Math.abs(p.d - st.d); st.snap = p.d;
              }
              if (st.snap !== null) st.d = st.snap;
            }
            const a = (st.d - car.dir * hl - car.d) * car.dir;   // metres until the front stands at the stop point
            if (a > -1.5 && a < bestA) { bestA = a; best = st; }
          }
          if (best && bestA < 70) {
            if (bestA < 1.2 && car.v < 0.5) {
              car._stopAt = best;
              // SBS (off-board fares, all-door boarding) dwells shorter than a local
              car._dwell = car.route === 'M60' ? 9 + Math.random() * 12 : 14 + Math.random() * 22;
              gap = Math.min(gap, 0.1); leadV = 0;
            } else if (bestA + IDM.s0 - 0.3 < gap) { gap = Math.max(0.05, bestA + IDM.s0 - 0.3); leadV = 0; }   // IDM stands s0 short of a standing leader
          }
        }
      }
      // ---- double-parked delivery: a few vans stop in the curb lane and sit
      if (car._parkT) {
        car._parkT -= dt;
        if (car._parkT <= 0) car._parkT = 0;
        else { gap = Math.min(gap, 0.1); leadV = 0; }
      }
      // ---- signal / yield: virtual standing leader at the stop bar
      const st = this.stateFor(nodeKey, s.dirx * car.dir, s.dirz * car.dir);
      const brakeDist = (car.v * car.v) / (2 * IDM.b);
      let hold = st === 'R' || (st === 'A' && endD - stopD > brakeDist * 0.7);
      let why = hold ? 'signal' : '';   // OV32: why the car stands (read by the census / probes only)
      if (!hold && mEnd > 0 && endD < stopD + Math.max(7, brakeDist)) {
        hold = this._mustYield(car, nodeKey, s, st);
        if (hold) why = 'yield';
      }
      // divided avenues: the 14 m link between the twin nodes is junction INTERIOR. A car never
      // stops on it (its stop point would be inside the box: audit "tesla d7 v0 x turning charger"),
      // and instead waits at THIS stop line while the far node shows red for the continuation
      if (e.len < 26 && mEnd > 0) { hold = false; why = ''; }
      // junction-box occupancy decided AT THE STOP BAR: a car that waited at the mouth instead had
      // its nose 2 m inside the box, where the other arms' connectors sweep (audit: "tesla d6 v0
      // end6 m5" x turning car, 25 pairs per 30 s)
      if (!hold && car.next && mEnd > 0 && endD < stopD + 8 && endD > mEnd + 0.7 && this._boxBlocked(car, e, nodeKey, car.next)) {
        hold = true; why = car._bxBy ? 'box body' : 'box rule';
        if (endD < stopD) car.v = 0;   // already past the stop bar when the box filled: stop where it is, short of the mouth
      }
      // VT29 (f): brake for the stop bar while the lane I turn into has no room for me past the turn (only while a
      // comfortable stop short of the bar is still possible; never on a divided avenue's interior link)
      if (VT29 && !hold && car.next && mEnd > 0 && e.len >= 26 && endD > stopD && endD - stopD < 30 && endD - stopD > brakeDist * 0.6
          && this._exitFull(car, car.next)) { hold = true; why = 'exit full'; }
      if (!hold && car.next && car.next.ne.len < 26) {
        const ne2 = car.next.ne, nd2 = car.next.o.dir;
        const hd = this.dirAt(ne2, nd2 > 0 ? ne2.len - 0.5 : 0.5, nd2);
        const onto = DL27 && Math.abs(s.dirx * car.dir * hd[1] - s.dirz * car.dir * hd[0]) > 0.5;   // DL27: turning onto the link
        if (!onto && this.stateFor(nd2 > 0 ? ne2.b : ne2.a, hd[0], hd[1]) === 'R') { hold = true; why = 'link red'; }
      }
      if (hold && endD - stopD < gap) { gap = Math.max(0.1, endD - stopD); leadV = 0; }
      { const pg = this._pedGap(car); if (pg < gap) { gap = Math.max(0.05, pg); leadV = 0; why = 'walker'; } }
      car._why = why || (gap < 1e8 && leadV < 0.5 ? 'queue' : '');
      car._gapQ = gap; car._leadQ = leadV;   // VQ30: what the lane-change spring below has left before the car stops
      const dv = car.v - leadV;
      const sStar = IDM.s0 + Math.max(0, car.v * IDM.T + (car.v * dv) / (2 * Math.sqrt(IDM.a * IDM.b)));
      const acc = IDM.a * (1 - Math.pow(car.v / Math.max(1, v0), IDM.delta) - (gap < 1e8 ? (sStar / Math.max(0.5, gap)) ** 2 : 0));
      car.v = Math.max(0, car.v + acc * dt);
      const dS = car.d, lfS = car.laneF, lfvS = car._lfv;   // VN36
      car.d += car.v * dt * car.dir;
      if (car._tail > 0) car._tail -= car.v * dt;
      // ---- transition at the junction boundary (mouth), not the node center
      if (endD <= (mEnd > 0 ? mEnd + 0.6 : 0.12) || car.d >= e.len - 0.05 || car.d <= 0.05) {
        let pick = car.next && this.edges.has(car.next.ne.id) ? car.next : (() => {
          const ex = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
          return this._pickNext(car, nodeKey, ex[0], ex[1]);
        })();
        if (TW27 && pick && car._badNe !== undefined && pick.ne.id === car._badNe) {
          const exB = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
          for (let k = 0; k < 4 && pick && pick.ne.id === car._badNe; k++) pick = this._pickNext(car, nodeKey, exB[0], exB[1]) || pick;
        }
        // could not reach the turn lane in time (traffic beside it): do not cut across the
        // neighbours — take the straight continuation when there is one
        if (pick && car.turnLaneWant >= 0 && car.lane !== car.turnLaneWant && Math.abs(this._turnCross(car, e, pick)) > 0.4) {
          const exH = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
          let alt = this._pickNext(car, nodeKey, exH[0], exH[1], true);
          // VQ31: no straight on (a T): the turn the car's own lane makes (left from the inner lane, right from the curb
          // lane) rather than across the others (the mouth cap leaves more cars short of their turn lane)
          if (!alt && VQ31) {
            const lnH = e.oneway !== 0 ? e.lanes : Math.max(1, Math.floor(e.lanes / 2));
            alt = this._pickNext(car, nodeKey, exH[0], exH[1], false, (t) => (t === 'left' && car.lane === 0) || (t === 'right' && car.lane === lnH - 1));
          }
          if (alt) pick = alt;
        }
        // ---- junction box occupancy (traffic-law audit 2026-09-10: 128 collision pairs in 30 s,
        // most of them two cars mid-turn into the same lane, or crossing arms entering together).
        // Wait at the mouth while (a) another car is turning into the SAME entry lane and has not
        // cleared the box, or (b) a car from a NON-PARALLEL arm is still in the first 60 % of its
        // connector (crossing paths). Same-arm followers queue through IDM as before.
        // the same test also ran at the stop bar (IDM hold below); this is the fallback for a car
        // that had already crept past it when the box filled. Interior links (< 26 m) never wait.
        const myCr = pick ? this._turnCross(car, e, pick) : 0;
        if (pick && mEnd > 0) {
          const blocked = this._boxBlocked(car, e, nodeKey, pick);
          if (blocked) {
            // hold at the mouth: pin the car ON the trigger (re-evaluated every frame, no back-jump) with zero speed
            car.d = car.dir > 0 ? Math.max(0.1, e.len - mEnd - 0.58) : Math.min(e.len - 0.1, mEnd + 0.58);
            car.v = 0; car._why = car._bxBy ? 'mouth body' : 'mouth rule';
            const sH = this.sampleEdge(e, car.d); const offH = this._laneOffset(e, car);
            this._placeCar(car, sH.x - sH.dirz * car.dir * offH, sH.y + (NO_DATUM ? 0.03 : 0.002), sH.z + sH.dirx * car.dir * offH, Math.atan2(sH.dirx * car.dir, sH.dirz * car.dir), dt);
            continue;
          }
        }
        car.next = null;
        car._bxPass = null; car._ruleF = undefined;   // OV32: a pass granted at this edge's stop bar ends with it
        if (PY25) car.turnLaneWant = -1;   // the next edge picks its own turn lane (34 m before ITS junction; VQ31: on entering it)
        e.cars.delete(car);
        if (!pick) {
          if (e.oneway === 0) this._uTurn(car, e, mEnd);
          else { car.dead = true; car.v = 0; e.cars.add(car); car.d = Math.max(0.1, Math.min(e.len - 0.1, car.d)); }
          continue;
        }
        // curved connector: junction-boundary exit -> next edge's mouth entry
        const exitD = Math.max(0.2, Math.min(e.len - 0.2, TW27 ? car.d : car.dir > 0 ? e.len - mEnd : mEnd));
        const exitPos = this.sampleEdge(e, exitD);
        const hA = [exitPos.dirx * car.dir, exitPos.dirz * car.dir];
        const exOff = this._laneOffset(e, car);
        const exLane = car.lane;   // lane on the edge being left (car.lane is re-clamped to the next edge below)
        const dir0 = car.dir;   // heading on the edge being left (car.dir flips to the next edge's below)
        const p0 = [exitPos.x - exitPos.dirz * car.dir * exOff, exitPos.y, exitPos.z + exitPos.dirx * car.dir * exOff];
        const ne = pick.ne;
        const mNext = pick.o.dir > 0 ? ne.mouthA : ne.mouthB;
        const entryD = pick.o.dir > 0 ? Math.min(mNext + 1.0, ne.len * 0.5) : Math.max(ne.len - mNext - 1.0, ne.len * 0.5);
        const en = this.sampleEdge(ne, entryD);
        car.e = ne;
        car.dir = pick.o.dir;
        const lanesDir = ne.oneway !== 0 ? ne.lanes : Math.max(1, Math.floor(ne.lanes / 2));
        car.lane = Math.min(car.lane, Math.max(0, lanesDir - 1));
        const lf0 = car.laneF, lfv0 = car._lfv;   // TW27: kept for a refused connector (the car stays on its edge and lane)
        if (TW26 && car.laneF !== undefined) { car.laneF = Math.min(car.laneF, Math.max(0, lanesDir - 1)); car._lfv = 0; }
        car.d = entryD;
        ne.cars.add(car);
        const enOff = this._laneOffset(ne, car);
        const p2 = [en.x - en.dirz * car.dir * enOff, en.y, en.z + en.dirx * car.dir * enOff];
        const hB = [en.dirx * car.dir, en.dirz * car.dir];
        const chord = Math.hypot(p2[0] - p0[0], p2[2] - p0[2]);
        const bend = Math.abs(hA[0] * hB[1] - hA[1] * hB[0]); // |sin| of turn angle
        // a junction connector is 5-40 m; anything longer means the continuation is not at this
        // junction (a routing fault) — recycle the car rather than fly it across the city
        if (chord > 60) {
          ne.cars.delete(car); car.dead = true; car.v = 0; e.cars.add(car); car.e = e; car.d = Math.max(0.1, Math.min(e.len - 0.1, exitD));
          // VF36: back on the edge it is drawn on, in its own direction and lane (it kept the next edge's: followers on this
          // edge took it for a car going the other way)
          if (VF36) { car.dir = dir0; car.lane = exLane; car.laneF = lf0; car._lfv = lfv0; }
          continue;
        }
        if (chord > 2) {
          // cubic arc with tangent-aligned controls (k = 0.36 chord approximates a circular arc).
          // The old quadratic put its control point at the lane-line intersection, which sits
          // INSIDE the corner, so every right turn bowed over the curb return and the audit
          // caught cars "on sidewalk" mid-turn. Each candidate arc is checked against the
          // rendered ground at five points; if one lands off the roadway the arc tightens,
          // then straightens to the chord.
          const mk = (k, q0 = p0, q2 = p2) => ({ p0: q0, c1: [q0[0] + hA[0] * k, q0[1], q0[2] + hA[1] * k], c2: [q2[0] - hB[0] * k, q2[1], q2[2] - hB[1] * k], p2: q2 });
          // wide swing for tight corners: exit and entry 1.2 m nearer the road centre (drivers do)
          const sw = (o) => o - Math.sign(o) * Math.min(1.2, Math.abs(o));
          const p0w = [exitPos.x - exitPos.dirz * dir0 * sw(exOff), exitPos.y, exitPos.z + exitPos.dirx * dir0 * sw(exOff)];
          const p2w = [en.x - en.dirz * car.dir * sw(enOff), en.y, en.z + en.dirx * car.dir * sw(enOff)];
          // the chord between two mouths passes ~0.3 m from the corner point, INSIDE the curb
          // return: straighter is worse here. Longer controls bow the arc toward the junction
          // centre, away from the corner. Test the car's INNER edge (0.9 m toward the inside of
          // the turn), not its centre, so the body clears the fillet too.
          const inner = hA[0] * hB[1] - hA[1] * hB[0] > 0 ? 1 : -1;
          const offRoad = (T) => {
            const S = this.streamer; if (!S || !S.surfaceInfoAt) return false;
            for (const t of [0.12, 0.28, 0.42, 0.56, 0.7, 0.86]) {
              const u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
              const x = a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0];
              const z = a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2];
              let tx = 3 * u * u * (T.c1[0] - T.p0[0]) + 6 * u * t * (T.c2[0] - T.c1[0]) + 3 * t * t * (T.p2[0] - T.c2[0]);
              let tz = 3 * u * u * (T.c1[2] - T.p0[2]) + 6 * u * t * (T.c2[2] - T.c1[2]) + 3 * t * t * (T.p2[2] - T.c2[2]);
              const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
              const info = S.surfaceInfoAt(x + inner * -tz * 1.1, z + inner * tx * 1.1, 0.6);
              if (info && !info.road) return true;
            }
            return false;
          };
          let T = mk(0.36 * chord);
          if (offRoad(T)) {
            let best = null;
            for (const kf of [0.5, 0.64, 0.8]) { const Tk = mk(kf * chord); if (!offRoad(Tk)) { best = Tk; break; } }
            // TW26: the swing moves the controls, not the ends (a Bezier passes 3/4 of a control offset at its middle, so 1.33x)
            const mkW = (k) => { const T0 = mk(k), s0 = [(p0w[0] - p0[0]) * 1.33, (p0w[2] - p0[2]) * 1.33], s2 = [(p2w[0] - p2[0]) * 1.33, (p2w[2] - p2[2]) * 1.33];
              T0.c1 = [T0.c1[0] + s0[0], T0.c1[1], T0.c1[2] + s0[1]]; T0.c2 = [T0.c2[0] + s2[0], T0.c2[1], T0.c2[2] + s2[1]]; return T0; };
            if (!best) for (const kf of [0.36, 0.5, 0.64]) { const Tk = TW26 ? mkW(kf * chord) : mk(kf * chord, p0w, p2w); if (!offRoad(Tk)) { best = Tk; break; } }
            T = best || (TW26 ? mkW(0.5 * chord) : mk(0.5 * chord, p0w, p2w));
          }
          // VT29: a connector with a bend under 3 m made everything on it turn almost on the spot (40 s census at 125th &
          // Lenox: 50 of 1,592 connectors under 1 m, 108 more under 3 m; 90 deg turns whose 0.36-chord handles overshoot the
          // corner, TW27 having started the turn from where the car stands). Candidates with each handle clamped short of
          // the point where the exit and entry lines cross, and a sweep of k: the one that stays on the road with the widest
          // tightest bend wins.
          if (VT29) {
            const rOf = (C) => this._turnLUT({ ...C }).rMin ?? 1e9;
            let r0 = rOf(T);
            if (r0 < 3) {
              const det = hA[0] * hB[1] - hA[1] * hB[0], bx = p2[0] - p0[0], bz = p2[2] - p0[2];
              const tA = Math.abs(det) > 0.05 ? (bx * hB[1] - bz * hB[0]) / det : -1;   // p0 + tA hA = p2 - uB hB
              const uB = Math.abs(det) > 0.05 ? (hA[0] * bz - hA[1] * bx) / det : -1;
              const mkA = (k0, k2) => ({ p0, c1: [p0[0] + hA[0] * k0, p0[1], p0[2] + hA[1] * k0], c2: [p2[0] - hB[0] * k2, p2[1], p2[2] - hB[1] * k2], p2 });
              for (const kf of [0.22, 0.28, 0.36, 0.45, 0.55]) {
                const k = kf * chord, cands = [mkA(k, k)];
                if (tA > 0.3 && uB > 0.3) cands.push(mkA(Math.min(k, 0.85 * tA), Math.min(k, 0.85 * uB)));
                for (const C of cands) { const rC = rOf(C); if (rC > r0 + 0.2 && !offRoad(C)) { T = C; r0 = rC; } }
              }
            }
            // VT30: a big vehicle's connector, if its tightest bend is under the 2.84 lr its lock can follow: handles of
            // their own length and the controls swung up to 2 m to the outside of the turn; of the shapes that keep both
            // sides of the body on the road the widest bend (up to what is wanted) wins, 1 m of extra path costing 2 cm
            if (VT30 && (BIGV.test(car.kind) || (TN38 && this.carHalf(car)[1] > 2.75))) {   // TN38: every vehicle over 5.5 m
              const lrC = car._lr || (car._lr = Math.max(1.25, Math.min(3.4, 0.56 * this.carHalf(car)[1])));
              const want = 2.84 * lrC;
              if (r0 < want) {
                const inn = hA[0] * hB[1] - hA[1] * hB[0] > 0 ? 1 : -1, hwB = this.carHalf(car)[0] + 0.1;
                const n0 = [-hA[1] * inn, hA[0] * inn], n2 = [-hB[1] * inn, hB[0] * inn];
                const mkS = (k0, k2, sw) => ({ p0, c1: [p0[0] + hA[0] * k0 - n0[0] * sw, p0[1], p0[2] + hA[1] * k0 - n0[1] * sw],
                  c2: [p2[0] - hB[0] * k2 - n2[0] * sw, p2[1], p2[2] - hB[1] * k2 - n2[1] * sw], p2 });
                const offBody = (C) => {
                  const S = this.streamer; if (!S || !S.surfaceInfoAt) return false;
                  for (const t of [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92]) {
                    const u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
                    const x = a0 * C.p0[0] + a1 * C.c1[0] + a2 * C.c2[0] + a3 * C.p2[0], z = a0 * C.p0[2] + a1 * C.c1[2] + a2 * C.c2[2] + a3 * C.p2[2];
                    let tx = 3 * u * u * (C.c1[0] - C.p0[0]) + 6 * u * t * (C.c2[0] - C.c1[0]) + 3 * t * t * (C.p2[0] - C.c2[0]);
                    let tz = 3 * u * u * (C.c1[2] - C.p0[2]) + 6 * u * t * (C.c2[2] - C.c1[2]) + 3 * t * t * (C.p2[2] - C.c2[2]);
                    const L = Math.hypot(tx, tz) || 1; tx /= L; tz /= L;
                    for (const sd of [hwB, -hwB]) { const info = S.surfaceInfoAt(x - tz * sd, z + tx * sd, 0.6); if (info && !info.road) return true; }
                  }
                  return false;
                };
                const len0 = this._turnLUT({ ...T }).len, cands = [];
                for (const f0 of [0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.85, 1.0]) for (const f2 of [0.1, 0.2, 0.3, 0.45, 0.55, 0.7, 0.85, 1.0]) for (const sw of [0, 1, 2]) {
                  const C = mkS(f0 * chord, f2 * chord, sw), L = this._turnLUT({ ...C }), r = L.rMin ?? 1e9;
                  if (r > r0 + 0.2) cands.push({ C, r, s: Math.min(r, want) - 0.02 * Math.max(0, L.len - len0) });
                }
                cands.sort((a, b) => b.s - a.s);
                for (let i = 0; i < cands.length && i < 16; i++) if (!offBody(cands[i].C)) { T = cands[i].C; r0 = cands[i].r; break; }
              }
            }
            // still a hook (a bend under 1.2 m: the exit and entry lines cross behind the car or past the entry, so it has
            // already driven by the lane it wants): take another continuation, as TW27 does for a cusp; after 3 refusals at
            // one junction the hook is driven (a one-way arm with no other way out must not strand the car)
            if (r0 < 1.2 && (car._hookN | 0) < 3) {
              car._hookN = (car._hookN | 0) + 1;
              ne.cars.delete(car); car.e = e; car.dir = dir0; car.lane = exLane; car.laneF = lf0; car._lfv = lfv0; car.d = exitD; e.cars.add(car);
              car._badNe = ne.id; car.next = null; car.v = Math.min(car.v, 2); continue;
            }
            car._hookN = 0;
          }
          // TN38: the connector driven in advance; a shape with a wheel or the body centre off the carriageway is replaced, and
          // with no shape that keeps the body on it the continuation is refused (the car stays at its mouth, as for a hook)
          if (TN38 && this.streamer && this.streamer.surfaceInfoAt) {
            const F = this._tnFit(car, T, p0, p2, hA, hB, chord, `${e.id}:${dir0}:${exLane}>${ne.id}:${car.dir}`);
            if (!F) {
              ne.cars.delete(car); car.e = e; car.dir = dir0; car.lane = exLane; car.laneF = lf0; car._lfv = lfv0; car.d = exitD; e.cars.add(car);
              car._badNe = ne.id; car.next = null; car.v = Math.min(car.v, 2); this.tnRefused = (this.tnRefused || 0) + 1; continue;
            }
            T = F;
          }
          // TW27: a connector that doubles back (its end behind its start, or handles pointing apart: a cusp) drove the car
          // out, reversed it along the curve and brought it back, the body spinning (yaw probe: up to 149 deg in a frame).
          // The car stays on its edge instead: a two-way edge U-turns there properly, a one-way edge picks another
          // continuation on the next frame (a stopped, recycled car would hold the lane behind it).
          if (TW27 && this._turnCusp(T)) {
            ne.cars.delete(car); car.e = e; car.dir = dir0; car.lane = exLane; car.laneF = lf0; car._lfv = lfv0; car.d = exitD; e.cars.add(car);
            if (e.oneway === 0) { this._uTurn(car, e, mEnd); continue; }
            car._badNe = ne.id; car.next = null; car.v = Math.min(car.v, 2); continue;
          }
          car._badNe = undefined;
          car.turn = { ...T, len: chord * (1 + bend * 0.3), s: 0, vCap: bend > 0.4 ? 6.0 : 12 };
          if (TW26) this._turnLUT(car.turn);
          car.turnNode = this.junction?.get(nodeKey) || nodeKey; car.turnLane = car.lane; car.turnHead = hA; car.turnCr = myCr;   // for the junction-box occupancy test
          car.turnFrom = e; car.turnFromDir = dir0; car.turnFromLane = exLane;                                                  // for the followers left behind
          if (TW27) this._placeCar(car, car.turn.p0[0], car.turn.p0[1], car.turn.p0[2], Math.atan2(hA[0], hA[1]), dt);   // TW27: on its connector this frame
        } else if (TW27 && chord > 0.05) {
          // TW27: a connector under 2 m is driven too, as a straight one (it used to be skipped: the car snapped across it,
          // sideways too where the lanes do not line up)
          const q = (f) => [p0[0] + (p2[0] - p0[0]) * f, p0[1] + (p2[1] - p0[1]) * f, p0[2] + (p2[2] - p0[2]) * f];
          car.turn = { p0, c1: q(1 / 3), c2: q(2 / 3), p2, len: chord, s: 0, vCap: 12 };
          this._turnLUT(car.turn);
          car.turnNode = this.junction?.get(nodeKey) || nodeKey; car.turnLane = car.lane; car.turnHead = hA; car.turnCr = myCr;
          car.turnFrom = e; car.turnFromDir = dir0; car.turnFromLane = exLane;
          this._placeCar(car, p0[0], p0[1], p0[2], Math.atan2(hA[0], hA[1]), dt);
        }
        continue;
      }
      // ---- place instance: heading from a short chord (smooths polyline kinks),
      // lane offset from the smoothed right vector
      const sA = this.sampleEdge(e, car.d - 1.7);
      const sB = this.sampleEdge(e, car.d + 1.7);
      let hx = (sB.x - sA.x) * car.dir, hz = (sB.z - sA.z) * car.dir;
      const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
      let yawT = Math.atan2(hx, hz);
      car._hdg = yawT;   // VT29: the lane's own heading here (_latHalf: the body's angle to its lane)
      if (TW26 && car.laneF !== undefined) {
        // critically damped spring (k 1.6, c 2 sqrt k): from rest it peaks near 0.47 lanes/s and settles in ~3 s
        const gap = car.lane - car.laneF;
        if (Math.abs(gap) < 0.002 && Math.abs(car._lfv) < 0.002) { car.laneF = car.lane; car._lfv = 0; }
        else {
          car._lfv += (1.6 * gap - 2.53 * car._lfv) * dt;
          const lw = this._laneOffsetAt(e, car, car.laneF + 1) - this._laneOffsetAt(e, car, car.laneF);
          if (VT28) {
            // sideways only while going forward: lateral <= v tan(8 deg)
            let tanA = VQ31 ? lcTan(car.v || 0) : 0.1405;   // VQ31: steeper at a crawl
            // VQ30: a car about to stop mid lane change (its leader or the stop bar near) either finishes it more steeply,
            // up to 14 deg, square 5 m short of the stop, or, when that is too steep, eases the sideways motion out over
            // its last metres and stops parallel to the lanes (straddling, a leader in both: VT28) instead of at an angle;
            // the towed axle straightens over the 3 m it still rolls
            if (VQ30 && Math.abs(gap) > 0.01 && (car._leadQ ?? 99) < 3) {
              // (VQ31: square 8 m short, or the sideways motion over 6 m short, so the towed axle comes straight before the stop)
              const dAv = Math.max(0, (car._gapQ ?? 1e9) - IDM.s0), need = (Math.abs(gap) * Math.abs(lw)) / Math.max(0.5, dAv - (VQ31 ? 8 : 5));
              if (need <= (VQ31 ? 0.268 : 0.2493)) tanA = Math.max(tanA, need);
              else tanA *= Math.max(0, Math.min(1, (dAv - (VQ31 ? 6 : 3)) / 6));
            }
            const vf = Math.max(0, car.v || 0), cap = (vf * tanA) / Math.max(0.5, Math.abs(lw));
            if (car._lfv > cap) car._lfv = cap; else if (car._lfv < -cap) car._lfv = -cap;
          }
          car.laneF += car._lfv * dt;
          // the body points along its path: lateral m/s over forward m/s
          const lat = car._lfv * lw, fw = VT28 ? Math.max(car.v || 0, 0.05) : Math.max(car.v || 0, 1.5);
          yawT = Math.atan2(hx * fw - hz * lat, hz * fw + hx * lat);
        }
      }
      const off = this._laneOffset(e, car);
      // VN36: never into another body (the car keeps its pose and its place this frame, and stops)
      if (VN36 && dt > 0 && car._pose && this._vnBlocked(car, s.x - hz * off, s.z + hx * off, yawT, dt)) {
        car.d = dS; car.laneF = lfS; car._lfv = lfvS; car.v = 0;
        const q = car._pose;
        this._placeCar(car, q[0], q[1], q[2], q[3], dt);
        continue;
      }
      this._placeCar(car, s.x - hz * off, s.y + (NO_DATUM ? 0.03 : 0.002), s.z + hx * off, yawT, dt);   // see the parked-car note: origin = contact patch
    }
    if (PY25) this._buildCarGrid();
    if (this.camera) this.lights.update(this.cars, this.camera);
    // VH13 — LAMP LENSES ON AFTER DUSK, AND ONLY ON MOVING CARS. The light/tail
    // materials used to carry a constant emissive (0x202226 / 0x350505) at every
    // hour, on every pool, so the lenses were faintly lit at noon and no brighter
    // at midnight — the only thing glowing after dark was the billboard sprite,
    // which is why headlamps read as sprites pasted near a car rather than as the
    // car's own lamps. The PARKED pools are never driven, so a standing car stays
    // dark (brief: no glow on parked cars).
    if (VH13) {
      const nv = ENV.night.value ?? 0;
      if (nv !== this._lampNight) {
        this._lampNight = nv;
        for (const p of Object.values(this.pools)) {
          if (p.lampL) p.lampL.emissiveIntensity = nv * 1.8;
          if (p.lampT) p.lampT.emissiveIntensity = nv * 0.85;
        }
      }
    }
    for (const p of Object.values(this.pools)) {
      p.mb.instanceMatrix.needsUpdate = true;
      p.md.instanceMatrix.needsUpdate = true;
      for (const m of p.mx) m.instanceMatrix.needsUpdate = true;
    }
  }
  // Parked-car LOD: full CARLA model inside 120m, collision-shell impostor
  // beyond. Rewrites all parked instance buffers from records — cheap, and
  // preserves the old 320-per-kind population cap (first-streamed tiles win;
  // PK34: the records nearest the camera win).
  _rebucketParked(px, pz, fp = null) {
    this._parkDirty = false;
    // the squared distance a parked car is placed by: from the lens, or (FP37) the take's nearest approach to it
    const near2 = (rec) => {
      if (!fp) return (rec.x - px) ** 2 + (rec.z - pz) ** 2;
      let q = Infinity;
      for (let j = 0; j < fp.pts.length; j += 3) { const ax = rec.x - fp.pts[j], az = rec.z - fp.pts[j + 2]; q = Math.min(q, ax * ax + az * az); }
      return q;
    };
    const PG = this._vnPG = new Map();   // VN36: the parked bodies drawn within 250 m, by 16 m cell
    this._pbX = px; this._pbZ = pz;
    const R2 = 120 * 120;
    for (const k of Object.keys(this.parked)) { const P = this.parked[k]; P._n = 0; P._f = 0; P._t = 0; }
    let lists = this.parkedRecs.values();
    if (PK34) {
      const all = [];
      for (const recs of this.parkedRecs.values()) for (const rec of recs) { rec._d2 = near2(rec); all.push(rec); }
      all.sort((a, b) => a._d2 - b._d2);
      lists = [all];
    }
    for (const recs of lists) {
      for (const rec of recs) {
        const P = this.parked[rec.kind];
        if (!P || P._t >= P.cap) continue; // same population cap as the old claim path
        const dd = PK34 ? rec._d2 : near2(rec), dx = Math.sqrt(dd), dz = 0;
        // VC36: no parked body in a travel lane (tested within 400 m, again whenever the streets near change), nor one a moving
        // body has run into (VN36: dropped during a warm-up)
        if (VC36 && dx * dx + dz * dz < 160000) {
          if (rec._vcHit) continue;
          if (rec._vcV !== this._edgeVer) { rec._vc = this._parkIntrudes(rec); rec._vcV = this._edgeVer; }
          if (rec._vc) continue;
          if (VN36 && dx * dx + dz * dz < 62500) {
            const k = Math.floor(rec.x / 16) * 100003 + Math.floor(rec.z / 16);
            let L = PG.get(k);
            if (!L) PG.set(k, (L = []));
            L.push(rec);
          }
        }
        if (!P.shell || dx * dx + dz * dz < R2) {
          const i = P._n++;
          P.mb.instanceMatrix.array.set(rec.m, i * 16);
          P.md.instanceMatrix.array.set(rec.m, i * 16);
          for (const m of P.mx) m.instanceMatrix.array.set(rec.m, i * 16);
          this._c.set(rec.color);
          P.mb.setColorAt(i, this._c);
        } else {
          const i = P._f++;
          P.shell.instanceMatrix.array.set(rec.m, i * 16);
          this._c.set(rec.color).multiplyScalar(0.82); // fake glass/wheel darkening
          P.shell.setColorAt(i, this._c);
        }
        P._t++;
      }
    }
    for (const k of Object.keys(this.parked)) {
      const P = this.parked[k];
      P.n = P._n;
      P.mb.count = P.md.count = P._n;
      P.mb.instanceMatrix.needsUpdate = P.md.instanceMatrix.needsUpdate = true;
      for (const m of P.mx) { m.count = P._n; m.instanceMatrix.needsUpdate = true; }
      if (P.mb.instanceColor) P.mb.instanceColor.needsUpdate = true;
      if (P.shell) {
        P.shell.count = P._f;
        P.shell.instanceMatrix.needsUpdate = true;
        P.shell.instanceColor.needsUpdate = true;
      }
    }
  }

  // Should this car wait at the stop bar? Covers: next-edge entry occupied
  // (hard gate — no more teleporting into a jammed entry), unprotected-left
  // yield to oncoming, and unsignalized minor-road priority (wider road wins,
  // equal widths yield to the right).
  // signed turn measure of the chosen continuation: > 0 right turn, < 0 left turn, ~0 straight
  _turnCross(car, e, pick) {
    const hx0 = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
    const neP = pick.ne, ndP = pick.o.dir, mNP = ndP > 0 ? neP.mouthA : neP.mouthB;
    const hBP = this.dirAt(neP, ndP > 0 ? Math.min(mNP + 1, neP.len * 0.5) : Math.max(neP.len - mNP - 1, neP.len * 0.5), ndP);
    return hx0[0] * hBP[1] - hx0[1] * hBP[0];
  }
  // junction-box occupancy + yields for the continuation `pick` (traffic-law audit 2026-09-10).
  // true = wait at the stop bar: (a) a car is turning into my target lane and is still on its
  // connector; (b) a crossing arm's car is in the first 60 % of its connector, or merges onto my
  // target edge; (c) I turn left and an oncoming car is in the box or approaching within 28 m on
  // any arm of this box (divided avenues' twin one-ways included); (d) an oncoming car is mid-left
  // turn across my path; (e) a through car on my target lane is about to pass the entry point.
  _boxBlocked(car, e, nodeKey, pick) {
    // OV32: this car stands in the path of a car in the box (flagged by that car's sweep in the last two frames): it
    // moves on as soon as its own way is physically clear; the rules (a)-(d) do not hold it (its sweep keeps it off the
    // car that turns into its lane ahead of it)
    // ... and so does one that the rules (a)-(d) alone have held for 10 s (a wait on a wait: one of them has to go first)
    const clearBox = OV32 && ((car._ovBlk !== undefined && this._frame - car._ovBlk <= 2) || (car._ruleF !== undefined && this._frame - car._ruleF > 300));
    const prevBx = car._bxBy;
    car._bxBy = null; car._bxRule = '';
    const hx0 = this.dirAt(e, car.dir > 0 ? e.len - 0.5 : 0.5, car.dir);
    const neP = pick.ne, ndP = pick.o.dir, mNP = ndP > 0 ? neP.mouthA : neP.mouthB;
    const hBP = this.dirAt(neP, ndP > 0 ? Math.min(mNP + 1, neP.len * 0.5) : Math.max(neP.len - mNP - 1, neP.len * 0.5), ndP);
    const myCr = hx0[0] * hBP[1] - hx0[1] * hBP[0];
    const laneP = Math.min(car.lane, Math.max(0, (neP.oneway !== 0 ? neP.lanes : Math.max(1, Math.floor(neP.lanes / 2))) - 1));
    const jg = this.junction?.get(nodeKey) || nodeKey;   // cluster identity: divided-avenue twin nodes share one box
    let BP = null;   // BX27: the path this car will drive through the box, built at the first crossing car met
    for (const oc of this.cars) {
      if (oc === car || oc.turnNode !== jg) continue;
      const tail = BX27 && !oc.turn && oc._tail > 0;
      if (!oc.turn && !tail) continue;
      const cross = Math.abs(hx0[0] * oc.turnHead[1] - hx0[1] * oc.turnHead[0]);
      if (BX27 && cross > 0.5) {
        if (!BP) BP = this._boxPath(car, e, neP, ndP, laneP);
        if (this._bodyOnPath(BP, car, oc) && this._bxHold(car, oc, prevBx)) return true;   // BX27: its body lies across my path
      }
      if (tail) continue;
      if (clearBox) continue;                                                      // OV32: the path checks only
      if (oc.e === neP && oc.turnLane === laneP) { car._bxRule = 'a'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }   // (a)
      if (oc.turn.s >= oc.turn.len - 4) continue;                                  // cleared the box
      const dot = hx0[0] * oc.turnHead[0] + hx0[1] * oc.turnHead[1];
      if (cross > 0.5 && (oc.turn.s < oc.turn.len * 0.6 || oc.e === neP)) { car._bxRule = 'b'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }   // (b)
      if (myCr < -0.4 && dot < -0.5) { car._bxRule = 'c box'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }       // (c) oncoming in the box
      if (dot < -0.5 && (oc.turnCr || 0) < -0.4 && myCr > -0.4) { car._bxRule = 'd'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }   // (d)
    }
    if (OV32) {
      // OV32: a standing body across my path through the box, whatever it is doing (an edge car waiting on a divided
      // avenue's link, a car stopped at the end of its connector with any heading); my own approach's cars are my queue
      if (!BP) BP = this._boxPath(car, e, neP, ndP, laneP);
      const q0 = car._pose;
      if (q0) for (const oc of this._ovNear(q0[0], q0[2], 45)) {
        if (oc === car || (oc.v || 0) > 1.0 || (oc.e === e && !oc.turn)) continue;
        if (this._bodyOnPath(BP, car, oc) && this._bxHold(car, oc, prevBx)) return true;
      }
    }
    if (myCr < -0.4 && !clearBox) {                                                // (c) oncoming approaching
      for (const oc of this.cars) {
        if (oc === car || oc.turn || !oc.e) continue;
        const oe = oc.e;
        const oKey = oc.dir > 0 ? oe.b : oe.a;
        if (oKey !== nodeKey && (this.junction?.get(oKey) || oKey) !== jg) continue;
        const endO = oc.dir > 0 ? oe.len - oc.d : oc.d;
        if (endO > 28 || oc.v <= 1.0) continue;
        const ho = this.dirAt(oe, oc.dir > 0 ? oe.len - 0.5 : 0.5, oc.dir);
        if (hx0[0] * ho[0] + hx0[1] * ho[1] < -0.5) { car._bxRule = 'c approach'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }
      }
    }
    const entry0 = ndP > 0 ? Math.min(mNP + 1.0, neP.len * 0.5) : Math.max(neP.len - mNP - 1.0, neP.len * 0.5);
    for (const oc of neP.cars) {                                                   // (e)
      if (oc === car || oc.turn || oc.dir !== ndP || oc.lane !== laneP) continue;
      const behind = (entry0 - oc.d) * ndP;     // > 0: has not reached the entry point yet
      if (behind > -2 && behind < 6 + oc.v * 2.0) { car._bxRule = 'e'; if (car._ruleF === undefined) car._ruleF = this._frame; return true; }
    }
    car._ruleF = undefined;
    return false;
  }
  // VT29 (f), don't block the box: is the lane I turn into too full to take my whole body, my rear axle and 2 m past the
  // connector's end behind its slow cars? A car that stopped just past the turn stood angled (its rear axle still in the
  // curve, as a real one would) and held the box. Asked only while the car can still brake for the stop bar (update()):
  // inside _boxBlocked it also ran at the mouth, whose hold pins the car at zero speed in one frame, and the car behind
  // drove into it (overlap probe: stopped pairs overlapping for 20-40 s).
  _exitFull(car, pick) {
    const neP = pick.ne, ndP = pick.o.dir, mNP = ndP > 0 ? neP.mouthA : neP.mouthB;
    const entry0 = ndP > 0 ? Math.min(mNP + 1.0, neP.len * 0.5) : Math.max(neP.len - mNP - 1.0, neP.len * 0.5);
    const laneP = Math.min(car.lane, Math.max(0, (neP.oneway !== 0 ? neP.lanes : Math.max(1, Math.floor(neP.lanes / 2))) - 1));
    const need = 2 * this.carHalf(car)[1] + (car._lr || 1.5) + 2;
    for (const oc of neP.cars) {
      if (oc === car || oc.turn || oc.dir !== ndP || (oc.v || 0) > 2.5 || Math.abs((oc.laneF ?? oc.lane) - laneP) > 0.6) continue;
      const ahead = (oc.d - entry0) * ndP - this.carHalf(oc)[1];   // its rear bumper past the entry point
      if (ahead > -2 && ahead < need) return true;
    }
    return false;
  }
  // BX27: points (x, z pairs) along the path `car` will drive from where it is through the box: its lane to the mouth, then
  // the connector update() builds there (k = 0.36 chord cubic), 1.5 m apart
  _boxPath(car, e, neP, ndP, laneP) {
    const P = [], dir = car.dir, mE = dir > 0 ? e.mouthB : e.mouthA;
    const exitD = Math.max(0.2, Math.min(e.len - 0.2, dir > 0 ? e.len - (mE || 0) : (mE || 0)));
    const offA = this._laneOffset(e, car);
    for (let dd = car.d; dir > 0 ? dd < exitD : dd > exitD; dd += dir * 1.5) {
      const q = this.sampleEdge(e, dd);
      P.push(q.x - q.dirz * dir * offA, q.z + q.dirx * dir * offA);
    }
    const ex = this.sampleEdge(e, exitD), mN = ndP > 0 ? neP.mouthA : neP.mouthB;
    const en = this.sampleEdge(neP, ndP > 0 ? Math.min(mN + 1.0, neP.len * 0.5) : Math.max(neP.len - mN - 1.0, neP.len * 0.5));
    const offB = this._laneOffsetAt(neP, { dir: ndP }, laneP);
    const ax = ex.dirx * dir, az = ex.dirz * dir, bx = en.dirx * ndP, bz = en.dirz * ndP;
    const p0x = ex.x - az * offA, p0z = ex.z + ax * offA, p2x = en.x - bz * offB, p2z = en.z + bx * offB;
    const ch = Math.hypot(p2x - p0x, p2z - p0z), k = 0.36 * ch, n = Math.max(2, Math.min(40, Math.ceil(ch / 1.5)));
    const c1x = p0x + ax * k, c1z = p0z + az * k, c2x = p2x - bx * k, c2z = p2z - bz * k;
    for (let i = 0; i <= n; i++) {
      const t = i / n, u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
      P.push(a0 * p0x + a1 * c1x + a2 * c2x + a3 * p2x, a0 * p0z + a1 * c1z + a2 * c2z + a3 * p2z);
    }
    return P;
  }
  // BX27: does the body of `oc` (its oriented box grown by car's half width + 0.3 m) cover a point of path P?
  _bodyOnPath(P, car, oc) {
    const q = oc._pose;
    if (!q) return false;
    const hwA = this.carHalf(car)[0] + 0.3, hB = this.carHalf(oc), fx = Math.sin(q[3]), fz = Math.cos(q[3]);
    const LX = hB[1] + hwA, LY = hB[0] + hwA;
    for (let i = 0; i < P.length; i += 2) {
      const dx = P[i] - q[0], dz = P[i + 1] - q[2];
      if (Math.abs(dx * fx + dz * fz) < LX && Math.abs(dx * fz - dz * fx) < LY) return true;
    }
    return false;
  }
  _mustYield(car, nodeKey, s, st) {
    const n = this.nodes.get(nodeKey);
    if (!n || !car.next) return false;
    const e = car.e;
    const ne = car.next.ne, ndir = car.next.o.dir;
    // entry gate: someone standing in the next edge's mouth zone
    const entry0 = ndir > 0 ? 0 : ne.len;
    const mNext = ndir > 0 ? ne.mouthA : ne.mouthB;
    for (const oc of ne.cars) {
      if (oc.dir !== ndir) continue;
      const g2 = (oc.d - entry0) * ndir;
      if (g2 > -0.5 && g2 < mNext + 6.5 && oc.v < 2) return true;
    }
    const hx = s.dirx * car.dir, hz = s.dirz * car.dir;
    const en = this.dirAt(ne, ndir > 0 ? Math.min(2, ne.len - 0.5) : Math.max(ne.len - 2, 0.5), ndir);
    const dot = hx * en[0] + hz * en[1];
    const crossT = hx * en[1] - hz * en[0]; // right vector is (-hz,hx): >0 right turn, <0 left turn
    const leftTurn = dot < 0.87 && crossT < -0.15;
    const signalized = this.signals.has(nodeKey);
    if (signalized && !leftTurn) return false; // green + straight/right: go
    for (const o of n.out) {
      if (o.id === e.id || o.id === ne.id) continue;
      const oe = this.edges.get(o.id);
      if (!oe) continue;
      for (const oc of oe.cars) {
        if (oc.dir !== -o.dir || oc.v < 0.8 || oc.turn) continue;
        const dToNode = o.dir > 0 ? oc.d : oe.len - oc.d;
        if (dToNode > Math.max(15, oc.v * 2.6)) continue;
        const oh = this.dirAt(oe, o.dir > 0 ? Math.min(1, oe.len - 0.1) : Math.max(oe.len - 1, 0.1), -o.dir);
        const oncoming = hx * oh[0] + hz * oh[1] < -0.7;
        if (leftTurn && oncoming) return true; // unprotected left yields
        if (!signalized && !oncoming) {
          if (oe.width > e.width + 1.5) return true; // minor road yields to the avenue
          if (Math.abs(oe.width - e.width) <= 1.5 && (oh[0] * hz - oh[1] * hx) > 0.5) return true; // yield to the right
        }
      }
    }
    return false;
  }
  // smooth 3-point-ish turnabout at dead ends instead of an instant flip
  _uTurn(car, e, mEnd) {
    const exitD = Math.max(0.3, Math.min(e.len - 0.3, car.dir > 0 ? e.len - Math.max(mEnd, 1.5) : Math.max(mEnd, 1.5)));
    const sP = this.sampleEdge(e, exitD);
    const oldHx = sP.dirx * car.dir, oldHz = sP.dirz * car.dir;
    const off0 = this._laneOffset(e, car);
    const p0 = [sP.x - sP.dirz * car.dir * off0, sP.y, sP.z + sP.dirx * car.dir * off0];
    car.dir = -car.dir;
    car.d = exitD;
    const off2 = this._laneOffset(e, car);
    const p2 = [sP.x - sP.dirz * car.dir * off2, sP.y, sP.z + sP.dirx * car.dir * off2];
    const p1 = [(p0[0] + p2[0]) / 2 + oldHx * 4.5, (p0[1] + p2[1]) / 2, (p0[2] + p2[2]) / 2 + oldHz * 4.5];
    e.cars.add(car);
    const len = Math.hypot(p2[0] - p0[0], p2[2] - p0[2]) + 7;
    // the turn integrator is cubic now: degree-elevate the quadratic control point
    const c1 = [p0[0] + (2 / 3) * (p1[0] - p0[0]), p0[1], p0[2] + (2 / 3) * (p1[2] - p0[2])];
    const c2 = [p2[0] + (2 / 3) * (p1[0] - p2[0]), p2[1], p2[2] + (2 / 3) * (p1[2] - p2[2])];
    car.turn = { p0, c1, c2, p2, len, s: 0, vCap: 3.2 };
    if (TW26) this._turnLUT(car.turn);
    // TN38: a U-turn whose body would leave the carriageway (a street too narrow to turn in one sweep) is not driven: the
    // car stands down where it is, as a dead car (VF36 recycles it where no camera sees it)
    if (TN38 && this.streamer && this.streamer.surfaceInfoAt && this._tnSweep(car, car.turn, [-oldHx, -oldHz])) {
      car.turn = null; car.dir = -car.dir; car.dead = true; car.v = 0; this.tnStood = (this.tnStood || 0) + 1;
    }
  }
  // TW27: does this cubic double back? Consecutive tangents more than 100 deg apart (a cusp), or the tangent turning more
  // than 200 deg in all (a loop). A clean corner turns by its bend angle, a few degrees per sample.
  _turnCusp(T) {
    let px = 0, pz = 0, tot = 0;
    for (let i = 0; i <= 24; i++) {
      const t = 0.02 + (0.96 * i) / 24, u = 1 - t;
      const tx = 3 * u * u * (T.c1[0] - T.p0[0]) + 6 * u * t * (T.c2[0] - T.c1[0]) + 3 * t * t * (T.p2[0] - T.c2[0]);
      const tz = 3 * u * u * (T.c1[2] - T.p0[2]) + 6 * u * t * (T.c2[2] - T.c1[2]) + 3 * t * t * (T.p2[2] - T.c2[2]);
      const L = Math.hypot(tx, tz);
      if (L < 1e-6) return true;
      const x = tx / L, z = tz / L;
      if (i > 0) { const d = Math.max(-1, Math.min(1, x * px + z * pz)); if (d < -0.17) return true; tot += Math.acos(d); }
      px = x; pz = z;
    }
    return tot > 3.5;
  }
  // TW26: an arc-length table for a turn's cubic (17 samples), so its s runs in metres along the curve
  _turnLUT(T) {
    const L = new Float32Array(17);
    let px = T.p0[0], pz = T.p0[2], acc = 0;
    for (let i = 1; i <= 16; i++) {
      const t = i / 16, u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
      const x = a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0], z = a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2];
      acc += Math.hypot(x - px, z - pz); L[i] = acc; px = x; pz = z;
    }
    T.lut = L; T.len = Math.max(acc, 0.5);
    if (VT28) {
      // VT28: the tightest bend (tangent turn between neighbouring 1/16 pieces over their mean length) sets the speed cap
      let rMin = 1e9, pa = null;
      for (let i = 0; i < 16; i++) {
        const t0 = i / 16, t1 = (i + 1) / 16, pt = (t) => { const u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t; return [a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0], a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2]]; };
        const A = pt(t0), B = pt(t1), ang = Math.atan2(B[0] - A[0], B[1] - A[1]), sl = Math.hypot(B[0] - A[0], B[1] - A[1]);
        if (pa && sl > 0.02) { let da = ang - pa.ang; da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI; if (Math.abs(da) > 1e-4) rMin = Math.min(rMin, (0.5 * (sl + pa.sl)) / Math.abs(da)); }
        if (sl > 0.02) pa = { ang, sl };
      }
      T.rMin = rMin;
      T.vCap = Math.min(T.vCap ?? 12, Math.max(1.8, Math.sqrt(2.5 * rMin)));
    }
    return T;
  }
  // TN38: the footprint a vehicle stands on, in its own frame: its kind's four wheel hubs (fleet24, FL FR RL RR), else four
  // points from carHalf
  _tnFoot(car) {
    const C = this._tnFootK || (this._tnFootK = {});
    let f = C[car.kind];
    if (!f) {
      const K = this.fleet24 && this.fleet24.kinds && this.fleet24.kinds[car.kind];
      const H = K && K.meta && K.meta.hubs ? K.meta.hubs.filter((h) => h.id >= 1 && h.id <= 4).sort((a, b) => a.id - b.id) : [];
      const lab = ['front left wheel', 'front right wheel', 'rear left wheel', 'rear right wheel'];
      if (H.length === 4) f = H.map((h, i) => [h.p[0], h.p[2], lab[i]]);
      else { const [hw, hl] = this.carHalf(car), a = Math.max(0.3, hw - 0.25), b = hl * 0.6; f = [[a, b, lab[0]], [-a, b, lab[1]], [a, -b, lab[2]], [-a, -b, lab[3]]]; }
      if (this.fleet24) C[car.kind] = f;
    }
    return f;
  }
  // TN38: the non-road surface (sidewalk, median, planting bed, plaza ...) under (x, z) at the level y, or null (a road, no
  // tile there, or a surface on another level: a street under a deck, a deck over a street)
  _tnOff(x, z, y) {
    const s = this.streamer.surfaceInfoAt(x, z, 0);
    return s && !s.road && Math.abs(s.y - y) < 1.5 ? s.kind : null;
  }
  // TN38: drive cubic C the way the car will (_placeCar's VT29 body: the centre on the curve, the rear axle towed lr behind,
  // the 75 deg bound, the run-out onto the tangent over the last 2.2 lr + 1 m), then lr + 1.5 m on along hB into the new
  // lane; the number of samples (every 0.4 m) with a wheel (its hub 0.12 m further out: the tyre's outer half) or the body
  // centre on a non-road surface, counting up to `stop`
  _tnSweep(car, C, hB, stop = 1) {
    const foot = this._tnFoot(car).map(([a, b]) => [a + Math.sign(a) * 0.12, b]), lr = car._lr || (car._lr = Math.max(1.25, Math.min(3.4, 0.56 * this.carHalf(car)[1])));
    const N = 72, P = new Float64Array((N + 1) * 4);   // x, z, tangent yaw, and the level the car is drawn at (a grade)
    let Ltot = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N, u = 1 - t, a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
      const x = a0 * C.p0[0] + a1 * C.c1[0] + a2 * C.c2[0] + a3 * C.p2[0], z = a0 * C.p0[2] + a1 * C.c1[2] + a2 * C.c2[2] + a3 * C.p2[2];
      const tx = 3 * u * u * (C.c1[0] - C.p0[0]) + 6 * u * t * (C.c2[0] - C.c1[0]) + 3 * t * t * (C.p2[0] - C.c2[0]);
      const tz = 3 * u * u * (C.c1[2] - C.p0[2]) + 6 * u * t * (C.c2[2] - C.c1[2]) + 3 * t * t * (C.p2[2] - C.c2[2]);
      P[i * 4] = x; P[i * 4 + 1] = z; P[i * 4 + 2] = tx * tx + tz * tz > 1e-12 ? Math.atan2(tx, tz) : (i ? P[i * 4 - 2] : Math.atan2(C.c1[0] - C.p0[0], C.c1[2] - C.p0[2]));
      P[i * 4 + 3] = a0 * C.p0[1] + a1 * C.c1[1] + a2 * C.c2[1] + a3 * C.p2[1];
      if (i) Ltot += Math.hypot(x - P[i * 4 - 4], z - P[i * 4 - 3]);
    }
    const wrap = (a) => a - Math.round(a / (2 * Math.PI)) * 2 * Math.PI, Le = 2.2 * lr + 1;
    // the body as it stands at the mouth (a car off a short link or a lane change is not yet square to its lane)
    const q0 = car._pose, own = q0 && car._yawL !== undefined && Math.hypot(q0[0] - C.p0[0], q0[2] - C.p0[2]) < 1.5;
    let yawL = own ? car._yawL : P[2], rx = C.p0[0] - Math.sin(yawL) * lr, rz = C.p0[2] - Math.cos(yawL) * lr, qx = C.p0[0], qz = C.p0[2], s = 0, acc = 0.4, bad = 0;
    const step = (x, z, yawT, inTurn, y) => {
      const ds = Math.hypot(x - qx, z - qz);
      if (ds < 1e-6) return false;
      s += ds;
      let yN = Math.atan2(x - rx, z - rz);
      if (Math.abs(wrap(yN - yawT)) > 1.31) { const dy = wrap(yawT - yawL), m = ds / 1.2; yN = yawL + (dy > m ? m : dy < -m ? -m : dy); }
      if (inTurn) { const rem = Ltot - s; if (rem < Le) yN += wrap(yawT - yN) * Math.min(1, ds / (Math.max(0, rem) + ds)); }
      yawL = yN; rx = x - Math.sin(yN) * lr; rz = z - Math.cos(yN) * lr; qx = x; qz = z;
      acc += ds;
      if (acc < 0.4) return false;
      acc = 0;
      const fx = Math.sin(yN), fz = Math.cos(yN);
      if (this._tnOff(x, z, y)) return true;
      for (const [a, b] of foot) if (this._tnOff(x + fz * a + fx * b, z - fx * a + fz * b, y)) return true;
      return false;
    };
    for (let i = 1; i <= N; i++) if (step(P[i * 4], P[i * 4 + 1], P[i * 4 + 2], true, P[i * 4 + 3]) && ++bad >= stop) return bad;
    const yB = Math.atan2(hB[0], hB[1]), run = lr + 1.5;
    for (let d = 0.25; d <= run; d += 0.25) if (step(C.p2[0] + hB[0] * d, C.p2[2] + hB[1] * d, yB, false, C.p2[1]) && ++bad >= stop) return bad;
    return bad;
  }
  // TN38: the connector this car drives from p0 (heading hA) to p2 (heading hB): T when it keeps the body on the carriageway,
  // else the best shape that does (kept per `key` for the next car), else null (the continuation is refused, and struck from
  // the choices of this lane's cars)
  _tnFit(car, T, p0, p2, hA, hB, chord, key) {
    const M = this._tnMemo || (this._tnMemo = new Map());
    if (M.size > 20000) M.clear();   // edges get new ids as tiles stream in again
    const k = key + (this.carHalf(car)[1] > 2.75 ? 'B' : 'c');
    const m = M.get(k);
    if (m === 'bad') return null;
    if (!this._tnSweep(car, T, hB)) return T;
    const inn = hA[0] * hB[1] - hA[1] * hB[0] > 0 ? 1 : -1;
    const n0 = [-hA[1] * inn, hA[0] * inn], n2 = [-hB[1] * inn, hB[0] * inn];
    const mkS = (f0, f2, sw) => ({ p0, c1: [p0[0] + hA[0] * f0 * chord - n0[0] * sw, p0[1], p0[2] + hA[1] * f0 * chord - n0[1] * sw],
      c2: [p2[0] - hB[0] * f2 * chord - n2[0] * sw, p2[1], p2[2] - hB[1] * f2 * chord - n2[1] * sw], p2 });
    if (m) { const C = mkS(m[0], m[1], m[2]); if (!this._turnCusp(C) && !this._tnSweep(car, C, hB)) { this.tnKept = (this.tnKept || 0) + 1; return C; } }
    const lr = car._lr || (car._lr = Math.max(1.25, Math.min(3.4, 0.56 * this.carHalf(car)[1]))), want = 2.84 * lr;
    const len0 = this._turnLUT({ ...T }).len, cands = [];
    const FS = [0.15, 0.3, 0.45, 0.6, 0.8, 1.0, 1.25], SW = Math.abs(hA[0] * hB[0] + hA[1] * hB[1]) > 0.7 ? [-3, -2, -1, 0, 1, 2, 3] : [-1, 0, 1, 2, 3];
    for (const f0 of FS) for (const f2 of FS) for (const sw of SW) {
      const C = mkS(f0, f2, sw), L = this._turnLUT({ ...C }), r = L.rMin ?? 1e9;
      if (r < 1.2) continue;
      cands.push({ C, f: [f0, f2, sw], s: Math.min(r, want) - 0.02 * Math.max(0, L.len - len0) });
    }
    cands.sort((a, b) => b.s - a.s);
    let tried = 0;
    for (const q of cands) {
      if (this._turnCusp(q.C)) continue;
      if (++tried > 40) break;
      if (!this._tnSweep(car, q.C, hB)) { M.set(k, q.f); this.tnShaped = (this.tnShaped || 0) + 1; return q.C; }
    }
    M.set(k, 'bad');
    return null;
  }
  // TN38: has this lane's continuation onto (ne, odir) been refused (no shape keeps the body on the carriageway)?
  _tnBad(car, ne, odir) {
    const M = this._tnMemo;
    if (!M || !car.e) return false;
    const lanesDir = car.e.oneway !== 0 ? car.e.lanes : Math.max(1, Math.floor(car.e.lanes / 2));
    return M.get(`${car.e.id}:${car.dir}:${Math.min(car.lane, lanesDir - 1)}>${ne.id}:${odir}${this.carHalf(car)[1] > 2.75 ? 'B' : 'c'}`) === 'bad';
  }
  // TN38: the recorder's CAR-OFFROAD check (main.js __CAR_OFFROAD) and clearance.mjs's vehicle audit: every moving vehicle (a
  // dead one too) with a wheel hub or its body centre on a non-road surface at its own level, with whether it is in the frame
  // (its centre or an offending point projects inside it); `all` lists those out of the frame too
  offRoad(all = false) {
    const S = this.streamer, cam = this.camera;
    if (!S || !S.surfaceInfoAt) return null;
    let onScreen = () => false, cx = 0, cz = 0;
    if (cam) {
      cam.updateMatrixWorld();
      const m = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements;
      cx = cam.position.x; cz = cam.position.z;
      onScreen = (x, y, z) => {
        const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = m[2] * x + m[6] * y + m[10] * z + m[14];
        if (vz > -0.3) return false;
        const qx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12], qy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13], qw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
        return Math.abs(qx / qw) < 1 && Math.abs(qy / qw) < 1;
      };
    }
    const out = [];
    for (const car of this.cars) {
      const q = car._pose;
      if (!q || car.manual) continue;
      const fx = Math.sin(q[3]), fz = Math.cos(q[3]), hits = [], pts = [];
      const k0 = this._tnOff(q[0], q[2], q[1]);
      if (k0) { hits.push('centre on ' + k0); pts.push([q[0], q[2]]); }
      for (const [a, b, l] of this._tnFoot(car)) {
        const x = q[0] + fz * a + fx * b, z = q[2] - fx * a + fz * b, k = this._tnOff(x, z, q[1]);
        if (k) { hits.push(l + ' on ' + k); pts.push([x, z]); }
      }
      if (!hits.length) continue;
      const vis = onScreen(q[0], q[1] + 0.8, q[2]) || pts.some((p) => onScreen(p[0], q[1] + 0.2, p[1]));
      if (!vis && !all) continue;
      out.push({ id: `${car.kind}#${car.idx}`, kind: car.kind, turn: !!car.turn, dead: !!car.dead, hits, vis, x: +q[0].toFixed(1), z: +q[2].toFixed(1), y: +q[1].toFixed(2),
        dist: +Math.hypot(q[0] - cx, q[2] - cz).toFixed(0), v: +(car.v || 0).toFixed(1), e: car.e ? car.e.id : null, from: car.turn && car.turnFrom ? car.turnFrom.id : null });
    }
    return out;
  }
  // OV32 last resort: car has been held by oc's standing body for 8 s while oc is held by car's (two sweeps: each on the
  // other's path; or an edge car pinned at its mouth that car's body keeps from its own path): neither can move without
  // the other. Between two turning cars the one first in line (the lower index) goes; against an edge car the one in the
  // box goes. Each such pass is counted.
  _ovYield(car, oc) {
    if (car._ovForcedBy === oc) return true;   // once granted, for the rest of this connector
    if (VC36) {
      const q = car._pose, p = oc._pose;
      if (q && p && (p[0] - q[0]) * Math.sin(q[3]) + (p[2] - q[2]) * Math.cos(q[3]) > 0 && Math.cos(p[3] - q[3]) > 0.5) return false;   // a queue
      if (this._ovSeen(car) || this._ovSeen(oc)) return false;   // in sight: no pass through a body
    }
    if (car._ovPrev !== oc || (oc.v || 0) > 0.2) return false;
    // out of sight: held 6 s by a standing body, pass the old way (a jam no camera sees dissolves); in sight, only after
    // 20 s (a jam that has not cleared by then is a deadlock the rules cannot see: the car squeezes by, counted)
    if ((car._ovT || 0) >= 6 && !this._ovSeen(car) && !this._ovSeen(oc)) { car._ovForcedBy = oc; this.ovUnseen = (this.ovUnseen || 0) + 1; return true; }
    if ((car._ovT || 0) >= 20) { car._ovForcedBy = oc; this.ovSqueeze = (this.ovSqueeze || 0) + 1; return true; }
    if ((car._ovT || 0) < 8) return false;
    let go = false;
    if (oc.turn) go = oc._ovPrev === car && (oc._ovT || 0) >= 8 && ((car.idx ?? 0) < (oc.idx ?? 0) || (car.idx === oc.idx && (car.kind || '') < (oc.kind || '')));
    else go = oc._bxBy === car;
    if (!go) return false;
    if (car._ovForcedBy !== oc) { car._ovForcedBy = oc; this.ovForced = (this.ovForced || 0) + 1; }   // counted (census)
    return true;
  }
  // OV32: hold at the stop bar or mouth for oc's body on my path; out of sight, not for more than 6 s (see _ovYield)
  _bxHold(car, oc, prevBx) {
    if (car._bxPass === oc) return false;   // granted below: for as long as the car is on this edge
    if (oc !== prevBx || car._bxF === undefined) car._bxF = this._frame;
    else if (OV32 && this._frame - car._bxF > 180 && !this._ovSeen(car) && !this._ovSeen(oc)) { car._bxPass = oc; this.ovUnseen = (this.ovUnseen || 0) + 1; return false; }
    else if (OV32 && this._frame - car._bxF > 600) { car._bxPass = oc; this.ovSqueeze = (this.ovSqueeze || 0) + 1; return false; }
    car._bxBy = oc;
    return true;
  }
  _ovSeen(c) { const q = c._pose; return !q || viewGuard.seen(q[0], q[1] + 1, q[2], this.carHalf(c)[1] + 1); }
  // VF36: the recorder's CAR-OVERLAP check (main.js __CAR_OVERLAPS) on the bodies as DRAWN: every instance of the moving pools
  // (a dead car included, and a slot no live car owns), the parked instances within 150 m of the lens, each the plan box of
  // its kind's LOD0 parts (asymmetric overhangs, mirrors, plates), an articulated bus's rear body at its drawn bend. A pair
  // counts when the bodies overlap by `min` m or more (separating axes, plan; a deck 3 m over a street is another level) and
  // the middle of the overlap projects inside the frame. The old test took the live cars' carHalf boxes on their poses and
  // skipped the dead ones, which stood drawn in the lanes (60 s at t8StNickDiveE's key 0: a van 2.5 m inside a dead one, unseen)
  drawnOverlaps(min = 0.1) {
    const F = this.fleet24, cam = this.camera;
    if (!F || !F.kinds || !cam) return null;
    const BB = this._vfBB || (this._vfBB = {});
    const bbOf = (k) => {
      if (BB[k] !== undefined) return BB[k];
      const K = F.kinds[k];
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y1 = 0;
      for (const p of (K && K.lods && K.lods[0]) || []) {
        const g = p.geometry;
        if (!g || !g.attributes || !g.attributes.position) continue;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox;
        x0 = Math.min(x0, b.min.x); x1 = Math.max(x1, b.max.x); z0 = Math.min(z0, b.min.z); z1 = Math.max(z1, b.max.z); y1 = Math.max(y1, b.max.y);
      }
      if (!(x0 < x1)) { const h = this.carHalf({ kind: k }); x0 = -h[0]; x1 = h[0]; z0 = -h[1]; z1 = h[1]; y1 = 1.6; }
      return (BB[k] = [x0, x1, z0, z1, y1]);
    };
    const L = [];
    const add = (x, y, z, yaw, k, bb, tag, car) => {
      const fx = Math.sin(yaw), fz = Math.cos(yaw), mx = (bb[0] + bb[1]) / 2, mz = (bb[2] + bb[3]) / 2;
      L.push({ x: x + fz * mx + fx * mz, z: z - fx * mx + fz * mz, y, fx, fz, hw: (bb[1] - bb[0]) / 2, hl: (bb[3] - bb[2]) / 2, top: bb[4], k, tag, car });
    };
    const byIdx = new Map();
    for (const c of this.cars) byIdx.set(c.kind + ':' + c.idx, c);
    const cx = cam.position.x, cz = cam.position.z;
    for (const [pools, moving] of [[this.pools || {}, true], [this.parked || {}, false]]) for (const [k, P] of Object.entries(pools)) {
      if (!P || !P.mb || !P.mb.instanceMatrix) continue;
      const A = P.mb.instanceMatrix.array, n = P.mb.count, bb = bbOf(k);
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        if (A[o] === 0 && A[o + 5] === 0 && A[o + 10] === 0) continue;
        const x = A[o + 12], y = A[o + 13], z = A[o + 14];
        if (!moving && (Math.abs(x - cx) > 150 || Math.abs(z - cz) > 150)) continue;
        const car = moving ? byIdx.get(k + ':' + i) || null : null;
        const tag = moving ? (car ? (car.dead ? ' (dead)' : car.turn ? ' (turning)' : '') : ' (no live car)') : ' (parked)';
        add(x, y, z, Math.atan2(A[o + 8], A[o + 10]), k, bb, tag, car);
        if (car && car.route && VC36) {
          const rb = this._rearBody(car);
          if (rb) { const fx = Math.sin(rb.yaw), fz = Math.cos(rb.yaw); L.push({ x: rb.x, z: rb.z, y, fx, fz, hw: rb.hw, hl: rb.hl, top: bb[4], k, tag: tag + ' (rear body)', car }); }
        }
      }
    }
    cam.updateMatrixWorld();
    const m = cam.matrixWorldInverse.elements, pr = cam.projectionMatrix.elements;
    const onScreen = (x, y, z) => {
      const vx = m[0] * x + m[4] * y + m[8] * z + m[12], vy = m[1] * x + m[5] * y + m[9] * z + m[13], vz = m[2] * x + m[6] * y + m[10] * z + m[14];
      if (vz > -0.3) return false;
      const qx = pr[0] * vx + pr[4] * vy + pr[8] * vz + pr[12], qy = pr[1] * vx + pr[5] * vy + pr[9] * vz + pr[13], qw = pr[3] * vx + pr[7] * vy + pr[11] * vz + pr[15];
      return Math.abs(qx / qw) < 1 && Math.abs(qy / qw) < 1;
    };
    const G = new Map();
    for (let i = 0; i < L.length; i++) { const k = Math.floor(L[i].x / 16) * 100003 + Math.floor(L[i].z / 16); const a = G.get(k); if (a) a.push(i); else G.set(k, [i]); }
    const out = [];
    for (let i = 0; i < L.length; i++) {
      const a = L[i], gx = Math.floor(a.x / 16), gz = Math.floor(a.z / 16);
      for (let u = gx - 1; u <= gx + 1; u++) for (let w = gz - 1; w <= gz + 1; w++) for (const j of G.get(u * 100003 + w) || []) {
        if (j <= i) continue;
        const b = L[j];
        if (a.car && a.car === b.car) continue;   // a bus's own two bodies
        if (!OV41 && !a.car && !b.car && a.tag === ' (parked)' && b.tag === ' (parked)') continue;   // OV41: parked pairs too
        if (Math.abs(a.y - b.y) > 3) continue;
        const dx = b.x - a.x, dz = b.z - a.z;
        let dep = 1e9;
        for (const [ux, uz] of [[a.fx, a.fz], [a.fz, -a.fx], [b.fx, b.fz], [b.fz, -b.fx]]) {
          const ra = a.hl * Math.abs(a.fx * ux + a.fz * uz) + a.hw * Math.abs(a.fz * ux - a.fx * uz);
          const rb = b.hl * Math.abs(b.fx * ux + b.fz * uz) + b.hw * Math.abs(b.fz * ux - b.fx * uz);
          dep = Math.min(dep, ra + rb - Math.abs(dx * ux + dz * uz));
          if (dep < min) break;
        }
        if (dep < min) continue;
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2, my = Math.max(a.y, b.y) + 0.5 * Math.min(a.top, b.top);
        if (!onScreen(mx, my, mz)) continue;
        out.push(`${a.k}${a.tag} x ${b.k}${b.tag} ${dep.toFixed(2)} m deep ${Math.hypot(mx - cx, mz - cz).toFixed(0)} m away`);
      }
    }
    return out.length ? out : null;
  }
  // OV32: the cars' bodies in 12 m cells, once a frame (their poses are read live; a car moves under 0.5 m a frame)
  _ovGrid() {
    const G = this._ovG || (this._ovG = new Map());
    for (const a of G.values()) a.length = 0;
    for (const c of this.cars) {
      const q = c._pose;
      if (!q || (c.dead && !VF36)) continue;   // VF36: a dead car stands drawn: a body like any other
      const k = Math.floor(q[0] / 12) * 65536 + Math.floor(q[2] / 12);
      let a = G.get(k);
      if (!a) G.set(k, (a = []));
      a.push(c);
    }
  }
  _ovNear(x, z, r) {
    const G = this._ovG, out = this._ovOut || (this._ovOut = []);
    out.length = 0;
    if (!G) return out;
    const i0 = Math.floor((x - r) / 12), i1 = Math.floor((x + r) / 12), j0 = Math.floor((z - r) / 12), j1 = Math.floor((z + r) / 12);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const a = G.get(i * 65536 + j);
      if (a) for (const c of a) out.push(c);
    }
    return out;
  }
  // OV32: do a box at (x, z) heading yaw with half extents (hw, hl) and the body of `oc` overlap? (separating axes)
  _ovHit(x, z, yaw, hw, hl, oc) {
    const q = oc._pose;
    if (!q) return false;
    const hB = this.carHalf(oc);
    if (this._ovBox(x, z, yaw, hw, hl, q[0], q[2], q[3], hB[0], hB[1])) return true;
    // VC36: an articulated bus's rear body, turned at its articulation (it stood across the next lanes after a turn, 125th &
    // Broadway: a Lincoln drove into it; the front body's box alone missed it)
    if (VC36 && oc.route) { const rb = this._rearBody(oc); if (rb && this._ovBox(x, z, yaw, hw, hl, rb.x, rb.z, rb.yaw, rb.hw, rb.hl)) return true; }
    return false;
  }
  // VC36: an articulated bus's rear body as fleet24 draws it (its moving group's tow state), once a frame: { x, z, yaw, hw, hl }
  _rearBody(oc) {
    if (oc._rbF === this._frame) return oc._rb;
    oc._rbF = this._frame; oc._rb = null;
    const F = this.fleet24, K = F && F.kinds && F.kinds[oc.kind], q = oc._pose;
    if (!K || !K.rear || !q) return null;
    const RB = this._rbK || (this._rbK = {});
    let b = RB[oc.kind];
    if (b === undefined) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const part of K.rear.lods[0] || []) {
        const g = part.geometry;
        if (!g || !g.attributes || !g.attributes.position) continue;
        if (!g.boundingBox) g.computeBoundingBox();
        x0 = Math.min(x0, g.boundingBox.min.x); x1 = Math.max(x1, g.boundingBox.max.x); z0 = Math.min(z0, g.boundingBox.min.z); z1 = Math.max(z1, g.boundingBox.max.z);
      }
      b = RB[oc.kind] = x0 < x1 ? [x0, x1, z0, z1] : null;
    }
    if (!b) return null;
    const G = (this._rbG || (this._rbG = Object.fromEntries((F.groups || []).filter((g) => g.moving).map((g) => [g.kind, g]))))[oc.kind];
    const S = G && G.state, i = oc.idx, piv = K.rear.pivot, fx = Math.sin(q[3]), fz = Math.cos(q[3]);
    let art = 0;
    if (S && i < S.cap && S.ok[i]) {
      let da = Math.atan2(q[0] + fx * piv[2] - S.rx[i], q[2] + fz * piv[2] - S.rz[i]) - q[3];
      da -= Math.round(da / (2 * Math.PI)) * 2 * Math.PI;
      art = Math.max(-0.75, Math.min(0.75, da));
    }
    const px = piv[0] || 0, mx = (b[0] + b[1]) / 2 - px, mz = (b[2] + b[3]) / 2 - piv[2], c = Math.cos(art), sn = Math.sin(art);
    const rx = px + c * mx + sn * mz, rz = piv[2] - sn * mx + c * mz;
    oc._rb = { x: q[0] + fz * rx + fx * rz, z: q[2] - fx * rx + fz * rz, yaw: q[3] + art, hw: (b[1] - b[0]) / 2, hl: (b[3] - b[2]) / 2 };
    return oc._rb;
  }
  // the separating-axis test of two plan boxes: (x, z, yaw, hw, hl) and (X, Z, YAW, HW, HL)
  _ovBox(x, z, yaw, hw, hl, X, Z, YAW, HW, HL) {
    const fx = Math.sin(yaw), fz = Math.cos(yaw), gx = Math.sin(YAW), gz = Math.cos(YAW);
    const dx = X - x, dz = Z - z;
    if (dx * dx + dz * dz > (hl + HL + hw + HW) ** 2) return false;
    // the four axes: my forward and side, its forward and side (no allocation: this runs ~10^4 times a frame)
    const cfg = Math.abs(fx * gx + fz * gz), csg = Math.abs(fz * gx - fx * gz);   // |cos|, |sin| of the heading difference
    if (Math.abs(dx * fx + dz * fz) > hl + HL * cfg + HW * csg) return false;
    if (Math.abs(dx * fz - dz * fx) > hw + HL * csg + HW * cfg) return false;
    if (Math.abs(dx * gx + dz * gz) > HL + hl * cfg + hw * csg) return false;
    if (Math.abs(dx * gz - dz * gx) > HW + hl * csg + hw * cfg) return false;
    return true;
  }
  // OV32: how far `car` can drive along the rest of its connector (and on into its new lane past its end) before its body,
  // grown by OV_M (a big vehicle 0.1 m more), touches another; 1e9 when nothing is in the way within its stopping distance + 3 m.
  // A body it already touches that is behind it (a follower's nose) is not in its way; one in front stops it where it is.
  _ovSweepTurn(car, T) {
    car._ovBy = null;
    const q0 = car._pose;
    if (!q0) return 1e9;
    const h = this.carHalf(car), hw = h[0] + OV_M + (BIGV.test(car.kind || '') ? 0.1 : 0), hl = h[1] + OV_M;
    const look = Math.max(3, (car.v * car.v) / (2 * IDM.b) + 3);
    const near = this._ovNear(q0[0], q0[2], look + hl + 9);
    const cand = this._ovCand || (this._ovCand = []);
    cand.length = 0;
    const fx0 = Math.sin(q0[3]), fz0 = Math.cos(q0[3]);
    for (const oc of near) {
      if (oc === car || (oc.dead && !VF36) || !oc._pose) continue;   // VF36: a dead car is a body too
      // a follower (behind, heading within 60 deg of mine) is not in my way: only my rear swinging round could reach it,
      // and it held a car turning out of a queue for the car queued behind it, which waited for it in turn
      // (VC36: of two bodies level with each other, a stack, the one second waits for the one first)
      { const rx = oc._pose[0] - q0[0], rz = oc._pose[2] - q0[2], al = rx * fx0 + rz * fz0; if (al < 0 && Math.cos(oc._pose[3] - q0[3]) > 0.5 && !(VC36 && al > -0.3 && this._vcFirst(oc, car))) continue; }
      if (this._ovYield(car, oc)) continue;   // the last resort: this pair is deadlocked and car goes first
      if (this._ovHit(q0[0], q0[2], q0[3], hw, hl, oc)) {
        const rx = oc._pose[0] - q0[0], rz = oc._pose[2] - q0[2];
        if (rx * fx0 + rz * fz0 <= 0 && !(VC36 && rx * fx0 + rz * fz0 > -0.3 && this._vcFirst(oc, car))) continue;   // touching from behind: not in the way (VC36: a level one first)
        car._ovBy = oc; oc._ovBlk = this._frame;
        return 0;
      }
      cand.push(oc);
    }
    if (!cand.length) return 1e9;
    // the path's centre at arc length sv: the connector, then the lane it enters (car.e / car.d / car.dir are already the
    // new edge's)
    const pAt = (sv, out) => {
      if (sv > T.len && car.e) {
        const eN = car.e, dd = Math.max(0.05, Math.min(eN.len - 0.05, car.d + car.dir * (sv - T.len)));
        const qE = this.sampleEdge(eN, dd), off = this._laneOffsetAt(eN, car, car.laneF ?? car.lane);
        out[0] = qE.x - qE.dirz * car.dir * off; out[1] = qE.z + qE.dirx * car.dir * off;
        return out;
      }
      const sE = Math.max(0, Math.min(sv, T.len)), t = TW26 && T.lut ? this._turnT(T, sE) : sE / T.len, u = 1 - t;
      const a0 = u * u * u, a1 = 3 * u * u * t, a2 = 3 * u * t * t, a3 = t * t * t;
      out[0] = a0 * T.p0[0] + a1 * T.c1[0] + a2 * T.c2[0] + a3 * T.p2[0];
      out[1] = a0 * T.p0[2] + a1 * T.c1[2] + a2 * T.c2[2] + a3 * T.p2[2];
      return out;
    };
    // the body's heading at each point is the one the car will have there (VT29: from its rear axle, towed lr behind, to its
    // centre): the chord from the path lr back, or from where the rear axle is now while that point is behind the car. A
    // long body off-tracks in a turn by up to a metre at its ends; the path's tangent missed that, and the wide margin that
    // covered it held cars for others in the next lane.
    const lr = car._lr || Math.max(1.25, Math.min(3.4, 0.56 * h[1])), rear0 = car._rear;
    const C = [0, 0], Rr = [0, 0];
    for (let ds = 0.4; ds <= look; ds += 0.4) {
      const s2 = T.s + ds;
      pAt(s2, C);
      if (s2 - lr >= T.s || !rear0) pAt(s2 - lr, Rr); else { Rr[0] = rear0[0]; Rr[1] = rear0[1]; }
      const yaw = Math.atan2(C[0] - Rr[0], C[1] - Rr[1]);
      for (const oc of cand) if (this._ovHit(C[0], C[1], yaw, hw, hl, oc)) { car._ovBy = oc; oc._ovBlk = this._frame; return ds - 0.4; }
    }
    return 1e9;
  }
  _turnT(T, s) {
    const L = T.lut, tg = Math.min(Math.max(s, 0), T.len);
    let i = 1;
    while (i < 16 && L[i] < tg) i++;
    const a = L[i - 1], b = L[i];
    return ((i - 1) + (b > a ? (tg - a) / (b - a) : 0)) / 16;
  }
  _laneOffset(e, car) {
    if (car && car.laneF !== undefined) { if (!TW26) car.laneF += (car.lane - car.laneF) * 0.04; return this._laneOffsetAt(e, car, car.laneF); }
    return this._laneOffsetAt(e, car, car ? car.lane : 0);
  }
  _laneOffsetAt(e, car, lane) {
    const usable = Math.max(3, e.width - (e.park >= 2 ? 4.6 : e.park ? 2.3 : 0) - 0.6);
    const laneW = Math.min(3.4, usable / Math.max(1, e.lanes));
    let off = e.oneway !== 0 ? (lane - (e.lanes - 1) / 2) * laneW : (0.5 + lane) * laneW;
    if ((e.park | 0) === 1) {
      // single-side parking: shift the driving band away from the parked curb
      const side = ((e.segId || 0) % 2) ? 1 : -1; // world side, matches parked placement
      off -= side * (car.dir ?? 1) * 1.15;
    }
    return off;
  }
  _placeCar(car, x, y, z, yaw, dt) {
    // HIGHWAYS P2 (city/hhp.js, `?hhp=1`): on the parkway a car stands on its paving (the road line is the carriageway's
    // centre line; the lanes lie off it across the cross slope)
    if (globalThis.__hhpSurf) { const ys = globalThis.__hhpSurf(x, z, y); if (ys !== null) y = ys + 0.002; }
    // VT27: the heading from the dragged rear point (see VT27); a jump of more than three drag lengths (a spawn, a
    // recycled car) starts it again behind the car along the path heading
    if (VT29 && !car.api) {
      // VT29: the rear axle towed along its heading; a placement 3 m or more from the last (a spawn, a recycled car) starts
      // it again behind the body along the path's heading; a dt = 0 update (a settle, a redraw) turns nothing
      const lr = car._lr || (car._lr = Math.max(1.25, Math.min(3.4, 0.56 * this.carHalf(car)[1])));
      const q = car._pose;
      let r = car._rear;
      if (!r || !q || car._yawL === undefined || Math.hypot(x - q[0], z - q[2]) >= 3) {
        r = car._rear = [x - Math.sin(yaw) * lr, z - Math.cos(yaw) * lr];
        car._yawL = yaw;
      } else if (dt > 0) {
        const dx = x - r[0], dz = z - r[1];
        let yN = dx * dx + dz * dz > 1e-8 ? Math.atan2(dx, dz) : car._yawL;
        // the path's own heading is the sanity bound: a body that has lost it by more than 75 deg (the tight end of a
        // U-turn, a kink the axle cannot follow) swings back toward it by at most a radian per 1.2 m it travels
        let dP = yN - yaw;
        dP -= Math.round(dP / (2 * Math.PI)) * 2 * Math.PI;
        if (Math.abs(dP) > 1.31) {
          let dy = yaw - car._yawL;
          dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
          const m = Math.hypot(x - q[0], z - q[2]) / 1.2;
          yN = car._yawL + (dy > m ? m : dy < -m ? -m : dy);
        }
        // the turn's run-out: over a connector's last 2.2 lr + 1 m the body straightens onto the connector's own tangent
        // (the lane it enters), the share of the rest covered this step, as a driver unwinds the wheel; a car that stops
        // just past a turn then stands square (the pure towed axle kept the corner's off-tracking lag, 15-20 deg)
        const T = car.turn;
        if (T && T.len > 0) {
          const rem = T.len - T.s, Le = 2.2 * lr + 1, ds = Math.hypot(x - q[0], z - q[2]);
          if (rem < Le && ds > 0) {
            let dq = yaw - yN;
            dq -= Math.round(dq / (2 * Math.PI)) * 2 * Math.PI;
            yN += dq * Math.min(1, ds / (rem + ds));
          }
        }
        car._yawL = yN;
        r[0] = x - Math.sin(yN) * lr; r[1] = z - Math.cos(yN) * lr;
      }
      yaw = car._yawL;
    } else if (VT28 && !car.api) {
      // VT28: the heading given (lane chord + lane-change angle, or the connector's tangent), at most v / 4.5 m + 0.2 rad/s
      // of turn; a placement 3 m or more from the last one (a spawn, a recycled car) starts again
      const q = car._pose;
      if (q && car._yawL !== undefined && Math.hypot(x - q[0], z - q[2]) < 3) {
        let dy = yaw - car._yawL;
        dy -= Math.round(dy / (2 * Math.PI)) * 2 * Math.PI;
        const m = ((car.v || 0) / 4.5 + 0.2) * Math.max(0, dt || 0);   // no turning in a dt = 0 update (a settle, a redraw)
        yaw = car._yawL + (dy > m ? m : dy < -m ? -m : dy);
      }
      car._yawL = yaw;
    } else if (VT27 && !car.api) {
      const Lb = car._wb2 || (car._wb2 = Math.max(1.2, Math.min(3.2, this.carHalf(car)[1] * 0.6)));
      let r = car._rear;
      if (!r || Math.hypot(x - r[0], z - r[1]) > Lb * 3) r = car._rear = [x - Math.sin(yaw) * Lb, z - Math.cos(yaw) * Lb];
      else if (dt > 0) {
        const dx = x - r[0], dz = z - r[1], d = Math.hypot(dx, dz);
        if (d > Lb) { r[0] = x - (dx / d) * Lb; r[1] = z - (dz / d) * Lb; }   // pulled along, never pushed
      }
      yaw = Math.atan2(x - r[0], z - r[1]);
    }
    // GTA-style body dynamics: pitch under accel/brake, roll in corners
    const dv = (car.v - (car._pv ?? car.v)) / Math.max(dt, 1e-3);
    // VH13 — BRAKE LIGHTS. carlights.js tested `(car._pv ?? car.v) - car.v > 0.02`,
    // but this function has always written `car._pv = car.v` a few lines down and
    // it runs BEFORE CarLights.update in the same frame, so that term was
    // identically zero and brake lamps only ever lit on a fully stopped car.
    // Publish a brake flag off the acceleration this function already computes,
    // LATCHED for 0.35 s. IDM's acceleration is noisy frame to frame, so a
    // bare `acc < -0.9` test would chatter the brake lamps on and off at frame
    // rate on any car hovering near the threshold — a flicker source in exactly
    // the kind of moving night shot tflick exists to catch.
    if (dv < -0.9) car._brakeT = 0.35;
    else if (car._brakeT > 0) car._brakeT = Math.max(0, car._brakeT - dt);
    let dy = yaw - (car._py ?? yaw);
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    const yawRate = dy / Math.max(dt, 1e-3);
    const pitchT = THREE.MathUtils.clamp(-dv * 0.006, -0.05, 0.065);
    const rollT = THREE.MathUtils.clamp(-yawRate * car.v * 0.0032, -0.09, 0.09);
    car._pitch = (car._pitch ?? 0) + (pitchT - (car._pitch ?? 0)) * Math.min(1, dt * 7);
    car._roll = (car._roll ?? 0) + (rollT - (car._roll ?? 0)) * Math.min(1, dt * 7);
    car._pv = car.v; car._py = yaw;
    car._pose = [x, y, z, yaw];
    const pool = this.pools[car.kind];
    this._e.set(car._pitch, yaw, car._roll, 'YXZ');
    this._q.setFromEuler(this._e);
    this._m.compose(this._v.set(x, y, z), this._q, this._s);
    pool.mb.setMatrixAt(car.idx, this._m);
    pool.md.setMatrixAt(car.idx, this._m);
    for (const m of pool.mx) m.setMatrixAt(car.idx, this._m);
  }
  _remove(ci) {
    const car = this.cars[ci];
    car.e.cars.delete(car);
    const pool = this.pools[car.kind];
    const lastIdx = --pool.n;
    pool.mb.count = pool.md.count = Math.max(0, pool.n);
    for (const m of pool.mx) m.count = pool.mb.count;
    if (car.idx !== lastIdx) {
      const swapped = this.cars.find((c) => c.kind === car.kind && c.idx === lastIdx);
      if (swapped) {
        swapped.idx = car.idx;
        // SB31: the moved car's pose goes with it. Its slot held the removed car's matrix until its next placement, and
        // when the moved car had been placed already this update (half the time: the loop runs backwards over this.cars)
        // it was drawn one frame at the removed car's place, 400 m out: a car near the lens blinked out for a frame
        for (const m of [pool.mb, pool.md, ...pool.mx]) m.instanceMatrix.array.copyWithin(swapped.idx * 16, lastIdx * 16, lastIdx * 16 + 16);
        this._c.set(swapped.color);
        pool.mb.setColorAt(swapped.idx, this._c);
        pool.mb.instanceColor.needsUpdate = true;
      }
    }
    this.cars.splice(ci, 1);
  }
}
