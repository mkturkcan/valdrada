// Valdrada GPU screenshot + perf harness (Playwright Chromium on the real
// GPU via ANGLE/D3D11 — the client/tools/shot.mjs harness uses SwiftShader,
// which is fine for pixels but useless for frame times).
//
//   node tools/bshot.mjs --views harlem125,columbia --time day --out client/shots/nyc
//   node tools/bshot.mjs --views harlem125 --bench            (prints fps/calls/tris JSON)
//   node tools/bshot.mjs ... --nodress                        (A/B without the NYC dresser)
//
// Starts `vite` in client/ on a random port unless --port is given (then
// it expects a running dev server there).
import { chromium } from 'playwright';
import { acquireGpu } from './gpulock.mjs';
import { installGuard, watchPage } from './harness_guard.mjs';
import { spawn, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bdir = path.join(root, 'client');
const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : '1') : def;
};

// mirror of client/src/shared/geo.js project()
const LAT0 = 40.7831, LON0 = -73.9712;
const M_LAT = 111132.0, M_LON = 111320.0 * Math.cos((LAT0 * Math.PI) / 180);
const project = (lon, lat) => [(lon - LON0) * M_LON, -(lat - LAT0) * M_LAT];
const P = (lon, lat, y, yaw, pitch) => { const [x, z] = project(lon, lat); return { x, y, z, yaw, pitch }; };
// L(camera x,z,alt, target x,z) in world metres: yaw = atan2(-dx, -dz) (main.js controller convention)
const unproject = (x, z) => [x / M_LON + LON0, -z / M_LAT + LAT0];
const L = (cx, cz, alt, tx, tz, pitch = -0.1) => { const [lon, lat] = unproject(cx, cz); return P(lon, lat, alt, Math.atan2(-(tx - cx), -(tz - cz)), pitch); };
const PRESETS = {
  // 2026-09-04 review close-ups (125th & Lenox): bus-lane legend + lane-use arrows, a bike rack, parked cars
  markings125: L(2128, -2765, 2.0, 2158, -2749, -0.14),   // ESE along the 125th eastbound bus lane toward Lenox
  rack125:     L(2139.7, -2748.5, 1.6, 2144, -2746, -0.16),  // north sidewalk of 125th, 5 m from a bike rack
  cars125:     L(2127, -2699, 1.5, 2134, -2694, -0.06),     // Lenox north of 125th, 8 m from the parked tesla / vw van
  traffic125:  L(2150, -2700, 22, 2168, -2742, -0.62),      // 125th & Lenox from 22 m, steep oblique: queues, lanes, turns
  lenoxRef:    L(2094, -2609, 150, 2167, -2740, -0.78),    // high oblique N along Lenox over 125th (matches ref_lenox.png)
  lenoxTop:    L(2167, -2740, 260, 2167, -2741, -1.55),    // plan view of 125th & Lenox, north up
  // round 9 (docs/notes/roofs-r9.md): 100 W 125th St, the 2017 big-box retail block on
  // the SW corner of 125th & Lenox (STYLE.RETAIL_MODERN). 26 m out in the 125th St
  // roadway, looking WSW along the frontage: glazed base, signage band, panel facade.
  retail125:   L(2132.5, -2773.8, 1.8, 2112, -2748, -0.02),
  rowCam:      L(2047, -2431, 1.8, 2062, -2424, -0.05),     // the ad's mBrownstone first key (W 121st, 6 m S of centreline)
  stoopClose:  L(2056, -2428.4, 1.7, 2063, -2424.6, -0.02),   // W 121st south sidewalk, close on a brownstone stoop and its parlour door (owner 2026-09-11: stairs must meet doors)
  // ---- LD13 (docs/notes/lod-r13.md): the three KEYS of the ad's mBrownstone path,
  // as stills, so a plate is literally a frame of the take the owner complained about
  // (tools/ad/shots.json mBrownstone; p alt 3 m, look alt 4 m -> pitch +0.053).
  // ld13b is the middle key = shots/adbugs/mBrownstone_frame_00080.jpg.
  ld13a:       L(2049.1, -2431.8, 3.0, 2067.2, -2437.7, 0.053),
  ld13b:       L(2058.6, -2426.4, 3.0, 2076.7, -2432.3, 0.053),
  ld13c:       L(2068.2, -2421.0, 3.0, 2086.3, -2426.9, 0.053),
  // ---- FLEET SHOWROOM (?fleet=1, src/sim/fleetShowroom.js): the row stands on
  // the Great Lawn at (396, 215) facing -Z; heading comes from &fleetyaw=<deg>
  // (210 front-3/4, 270 side, 30 rear-3/4) and &fleetonly=<kinds> picks the shot.
  // slots run 6.5 m apart along -X in SPECS order: tesla crown charger prius
  // micra | jeep cybertruck bus sprinter boxtruck | vwvan ambulance harley
  // vespa yamaha (screen-left to screen-right). A/B/C each frame five of them.
  fleetA:      L(428.5, 199, 1.7, 428.5, 215, -0.035),      // tesla..micra
  fleetB:      L(396, 199, 1.7, 396, 215, -0.035),           // jeep..boxtruck
  fleetC:      L(363.5, 199, 1.7, 363.5, 215, -0.035),       // vwvan..yamaha
  fleetNear:   L(396, 207, 1.7, 396, 215, -0.03),           // 8 m: two or three kinds, full res
  // CROWD SHOWROOM (?crowdshow=1, src/sim/crowd.js): every walker variant in a row on the Great Lawn at z 215
  crowdNear:   L(396, 211.4, 1.55, 396, 215, -0.02),        // 3.6 m: three people, face/cloth detail
  crowdHands:  L(397.4, 213.2, 1.1, 396, 215, -0.12),       // 2.3 m, 3/4 from the right at hand height: wrist roll / finger pose of the middle walker
  crowdBack:   L(394.6, 219.0, 1.5, 396.4, 215, -0.02),     // 4.4 m behind the row, a little to the side: backpacks and shoulder bags
  crowdBackC:  L(396, 217.6, 1.35, 396, 215, -0.05),        // 2.6 m straight behind the middle walker (props fit check)
  crowdBackRow: L(396, 233, 1.7, 396, 215, -0.03),         // 18 m behind the row: every variant's back at once (film 7 pack-fit sweep)
  crowdMid:    L(396, 206, 1.65, 396, 215, -0.04),          // 9 m: eight people, street-plate scale
  crowdFar:    L(396, 192, 1.7, 396, 215, -0.02),           // 23 m: the whole row, LOD1/LOD2
  // ---- PV2 SIDE-BY-SIDES (tools/refs/sidebyside.mjs vs refs/pv2): street-level people at 125th & Lenox
  pvCross:     L(2143, -2752, 1.55, 2156, -2742, -0.02),    // eye level on the sigPair corner; with crowdshowat=2150.1,-2746.5,232.4 one walker comes at the lens from 9 m (fov=24 ~ the "Man crossing" portrait)
  pvCorner:    L(2143, -2752, 1.6, 2156, -2742, 0.02),      // the sigPair corner at eye level (fov=50 ~ a phone's main camera): sidewalk crowd + crossing
  pvSidewalk:  L(2132.5, -2773.8, 1.6, 2112, -2748, 0.0),   // across 125th at the north sidewalk crowd (fov=30: a short telephoto)
  fleetRow:    L(396, 194, 2.6, 396, 215, -0.06),           // 21 m: six or seven kinds
  fleetOblq:   L(408, 203.5, 2.0, 396, 215, -0.05),         // 17 m from the right: 3/4 on a whole group
  fleetHigh:   L(396, 184, 15, 396, 217, -0.43),            // 33 m out, 15 m up: the whole lineup
  fleetTop:    L(396, 207, 7.5, 396, 215, -0.80),           // 8 m out, 7.5 m up, 46 deg down: roofs (RG32 roof glass)
  // nadir plates: up-axis, heading, spacing and RELATIVE SCALE in one frame, and
  // the only framing that survives a loaded machine (one tile under the camera,
  // no horizon to stream). A/B/C cover the 15 slots in three overlapping thirds.
  fleetTop:    L(396, 214.5, 26, 396, 215, -1.54),          // cybertruck..ambulance
  fleetTopA:   L(428.5, 214.5, 26, 428.5, 215, -1.54),      // tesla..jeep
  fleetTopC:   L(363.5, 214.5, 26, 363.5, 215, -1.54),      // boxtruck..yamaha
  fleetLod:    L(396, 85, 3.0, 396, 215, -0.02),            // 130 m: the far-LOD collision shells
  nycha:       L(1871, -3100, 70, 1871, -3156, -0.75),      // St Nicholas Houses campus from 70 m: are cars driving the NV walkways?
  columbia:    P(-73.96225, 40.80753, 3, -2.1, 0.12),
  harlem125:   P(-73.94510, 40.80770, 4, 2.15, 0.10),
  harlemRow:   L(2084, -2501, 2.0, 2128, -2478, 0.03),   // W 122nd St south sidewalk east of Lenox, looking ESE at the stoop rows (re-aimed 2026-09-17: the old point stood ON the Lenox Ave planted median — the critic's "grass verge" was the median lawn, which is real)
  harlemAir:   P(-73.94600, 40.80700, 55, 2.0, -0.35),
  stjohn:      P(-73.96140, 40.80410, 22, 0.9, 0.02),
  midtown:     P(-73.97730, 40.75200, 60, 0.35, 0.18),
  streetlevel: P(-73.98565, 40.74980, 3, -0.6, 0.2),
  canyon5th:   P(-73.98103, 40.75341, 3, 2.635, 0.22),      // 5th Ave & W 42nd, on the Street View pano position, looking downtown along the avenue (old point stood inside a footprint)
  timessq:     P(-73.98590, 40.75730, 3, -0.35, 0.2),
  esbAir:      P(-73.98000, 40.74400, 380, 0.35, -0.3),
  // NYC street pass: intersections (crosswalks, curb ramps, signal masts)
  xwalk125:    P(-73.94530, 40.80790, 1.8, 2.5, -0.08),    // 125th & Lenox, SE corner looking NW across
  xwalkAir:    P(-73.94500, 40.80800, 16, 2.4, -0.75),     // same intersection from 16 m up
  xwalkCol:    P(-73.96390, 40.80790, 1.8, -0.9, -0.06),   // Broadway & 116th
  xwalkRow:    P(-73.947749, 40.805388, 1.7, 1.078, -0.05), // W 122nd at Mt Morris Park W, on the Street View pano position looking WNW (the old point stood inside a footprint)
  // SG13 signal close-ups (docs/notes/signals-r13.md). The 125th & Lenox node is
  // at (2167, -2740); the compiler stands masts on the curb returns at
  // (2150.6, -2738.8) and (2162.1, -2759.5). These stand in the roadway a bus
  // lane away and crane up at a head: one lit lens, dark glass, visors.
  sigMast:     L(2148, -2745, 1.7, 2150.6, -2738.8, 0.36),  // 6.7 m from the W 125th mast, eye level
  sigMast2:    L(2168, -2764, 1.7, 2162.1, -2759.5, 0.40),  // 7.5 m from the Lenox Ave mast, the other approach
  sigPair:     L(2143, -2752, 2.0, 2156, -2742, 0.16),      // 16 m: mast + pole face + ped head + the crossing
  // the ad montage's mLenoxEye key 2 as a still (tools/ad/shots.mjs on125(39, 22)
  // -> brg(LENOX, ST_E, 28)): the framing of shots/adbugs/mLenoxEye_frame_00090.jpg
  mLenoxEye:   L(2140.9, -2755.7, 2.6, 2210.2, -2742.5, 0.062),

  // ---- TRAILER: landmark 1:1 hero framings (tools/trailer, docs/notes/trailer.md)
  // Each is aimed at the real landmark's mid-height from a compass bearing that
  // matches the postcard view. Shoot with --flags hud=0 (clean plate) and
  // --time golden / night; add lm3d=1 to the flags for NYC-3D-model massing.
  esbHero:       P(-73.98331, 40.74498, 200, 0.49, 0.12),   // Empire State, tower-dominant, 430 m SSE (200 m up: a glass tower blocks it lower)
  esbSkyline:    P(-73.98167, 40.74310, 140, 0.52, 0.11),   // Empire State over the Midtown skyline, 680 m
  esbStreet:     P(-73.98532, 40.74704, 2.5, 0.21, 0.69),   // 5th Ave & 34th, craning up
  chryslerHero:  P(-73.97057, 40.75260, 170, 1.83, 0.18),   // Chrysler crown from the ENE
  chryslerCrown: P(-73.97246, 40.75119, 235, 1.40, 0.19),   // tight on the steel crown
  // flatironHero / flatironSt removed: the Flatiron footprint carries no
  // landmark massing in the current tile set, so every framing of that block
  // shows generic neighbours, not the prow.
  wtcHero:       P(-74.00582, 40.71673, 185, 2.18, 0.13),   // One WTC from the NE
  bkbridgeDeck:  P(-74.00127, 40.71017, 22, -2.41, 0.17),   // Brooklyn Bridge, Manhattan tower
  grandCentral:  L(-656, 3622, 9, -575, 3470, 0.22),       // on the PARK AVE west carriageway south of 40th (tile road piece), looking north at the viaduct + MetLife (critic r5: wedged between facades)
  timessqNorth:  L(-1233, 2834, 4, -1290, 2978, 0.20),     // on the 7 AVE centreline between 45th and 46th (tile road piece), looking SSW at One Times Square (critic r5: the lon/lat points sat inside footprints)
  columbiaLow:   P(-73.96208, 40.80732, 3, -0.02, 0.16),    // College Walk to Low Library
  amst120Ref:    P(-73.96044, 40.80754, 150, -0.506, -0.78),   // high oblique NNE up Amsterdam over W 120th (owner 2026-09-15)
  amst120NE:     P(-73.95930, 40.80925, 1.7, -1.291, 0.05),   // SW corner (Mudd) looking NE across the intersection at Whittier Hall
  amst120W:      P(-73.95870, 40.80985, 1.7, 1.850, 0.06),    // NE corner looking WSW along W 120th at Teachers College and the campus edge
  amst120N:      P(-73.95945, 40.80890, 1.7, -0.506, 0.03),   // Amsterdam at W 119th looking N through the intersection
  amst120SW:     L(993, -2858, 1.7, 962, -2882, 0.08),           // east sidewalk at W 119th looking WNW at the campus frontage south of Mudd (diagnostic 2026-09-15)
  // named storefronts (src/city/namedShops.js, 2026-09-24): the Street View camera positions of refs/streetview/amst120
  // (2.45 m lens), aimed as tools/refs/pano_view.mjs crops them — render with --flags fov=40 (66° across at 16:9) and crop
  // the panorama with --fov 65.8 at the same heading / pitch for a side-by-side
  hartleyRef:    L(1003.6, -2903.9, 2.45, 1016.5, -2888.6, 0.07),    // S-arm pano 2024-07, heading 140: Hartley Chemist / Pharmacy / Sliced
  appletreeRef:  L(1024.6, -2937.2, 2.45, 1044.3, -2933.7, 0.14),    // centre pano 2023-03, heading 100: the Appletree Market pediment
  appletreeSE:   L(1024.6, -2937.2, 2.45, 1034.6, -2919.9, 0.1),     // centre pano 2023-03, heading 150: DELI / CATERING / ATM, APPLETREE DELI
  dunkinRef:     L(1037.7, -2961.3, 2.45, 1057.6, -2963.0, 0.17),    // N-arm pano 2023-03, heading 95: Dunkin', Spa & Salon
  whittierRef:   L(1003.6, -2903.9, 2.45, 993.6, -2921.2, 0.44),     // S-arm pano 2024-07, heading 330, pitch 25: Whittier Hall's base and water table
  amst120Walk:   L(1043, -2952, 12, 1010, -2917, -0.36),             // 12 m over the NE corner looking SW: walkers across the pavements and crosswalks
  whittierTop:   L(1030, -2893, 26, 1000, -2965, 0.12),              // 26 m over the SE corner looking NNW at Whittier Hall's roofline (gables, turrets)
  whittierRoof:  L(1075, -2930, 75, 999, -2975, -0.62),          // close oblique from the ESE onto Whittier Hall roof (decorate landmark check, 2026-09-15)
  // ---- COURTYARDS (docs/notes/courtyards-r12.md, brief B). Enclosed light courts are
  // only visible from above, so these are the framings that can tell a courted pre-war
  // block from the solid slab it used to extrude as. Court centres come from
  // `node client/tools/probe_courts.mjs <tilesDir> <x> <z> <radius>`.
  courtBlock:    L(2140, -5940, 130, 2205, -6015, -0.95),        // Harlem's densest courtyard cluster (24 courts inside 160 m, ~25 m parapets) from the SW
  courtTop:      L(2199, -6009, 230, 2199, -6010, -1.54),        // the same block in plan: the unambiguous before/after
  amst120Court:  L(1060, -2800, 110, 1120, -2865, -0.90),        // the courted block SE of 120th & Amsterdam: 6 courts on 5 buildings
  // ---- WILLIAMSBURG (owner focus area; refs/streetview/williamsburg) — 2026-09-15 lead baseline
  wbBedfordN7:   L(1197, 7303, 1.8, 1244, 7341, 0.03),          // N 7th St toward Bedford Ave (L station corner), on the compiled centreline
  wbBedfordN8:   L(1206, 7312, 1.8, 1189, 7274, 0.03),        // WB14: Bedford Ave looking NW toward N 8th — the dev29 tiles put FRAME_HOUSE (1192,7276) and CONDO_NEW (1187,7271) records on this block face
  wbBroadwayEl:  L(560, 8083, 1.8, 735, 8124, 0.05),           // Broadway near Kent Ave looking ENE under the JMZ elevated
  wbMarcy:       L(1185, 8165, 1.8, 1166, 8204, 0.04),          // Marcy Ave looking SSW toward Broadway (Marcy Av station)
  wbAir:         L(1100, 7450, 120, 1190, 7310, -0.70),        // oblique over Bedford Ave / N 7th
  wbS1st:        L(960, 7765, 1.8, 1038, 7803, 0.04),           // S 1st St toward Bedford (Grand St refs)
  // ---- REFERENCE <-> TWIN SWIPES (owner 2026-09-16): the reference camera pose (target, 320 m, heading 29, tilt 62, fov 35)
  amst120Swipe:  L(873, -2670, 153.7, 1009.9, -2917.1, -0.470),   // render with fov=35 (the reference lens is 35 deg VERTICAL, critic r13)
  lenoxSwipe:    L(2030, -2493, 153.6, 2167, -2740, -0.470),      // render with fov=35 (the reference lens is 35 deg VERTICAL, critic r13)
  // ---- COLUMBIA ROOFS (owner 2026-09-24: "Columbia buildings' roofs are missing"): the reference poses
  // (target 40.807576,-73.96171 = world (800,-2720), 500 m, tilt 55; render fov=35)
  colObliqueN:     L(601.4, -2361.8, 290.3, 800, -2720, -0.611),   // heading 29: up the campus from over 114th St
  colObliqueE:     L(1158.2, -2521.4, 290.3, 800, -2720, -0.611),  // heading 299: across the campus from over Amsterdam Ave
  colObliqueW:     L(441.8, -2918.6, 290.3, 800, -2720, -0.611),   // heading 119: across the campus from over Broadway
  colTop:        L(800, -2720, 700, 800.05, -2720.09, -1.55),     // plan view, avenues up the frame (heading 29, tilt 0, 700 m)
  colHalls:      L(700, -2560, 70, 760, -2660, -0.5),             // 70 m over 114th & Broadway looking NNE at the Furnald / Journalism / Lewisohn roofs
  colDorms:      L(700, -2630, 28, 800, -2620, -0.12),            // 28 m over South Lawn looking E at the Hamilton / Hartley mansards and dormers
  colEarl:       L(745, -2772, 22, 716, -2835, -0.10),            // 22 m over the lawn west of Low looking NNW at Earl Hall's dome
  wbBedford:  L(1043, 7571, 153.6, 1180, 7324, -0.470),      // Williamsburg: Bedford Ave & N 7th at the swipe pose; fov=35 (vertical)
  wbBroadway: L(870, 8492, 153.6, 1007, 8245, -0.470),       // Williamsburg: Broadway & Havemeyer (compiled node 1007,8245 = 40.70891,-73.95925) under the JMZ el; fov=35 (vertical). The 09-16 first aim (1197,8213) was the BQE at Rodney.
  wbUnderEl:     L(1003, 8251, 1.7, 1046, 8210, 0.06),           // EL14: under the J/M/Z el on Broadway at Havemeyer, looking NE toward Marcy (refs/streetview Broadway & Havemeyer)
  rock30:        P(-73.97589, 40.75800, 6, 1.17, 0.47),     // 30 Rock down the Channel Gardens
  midtownSky:    P(-73.98039, 40.74077, 330, -0.05, -0.10), // Midtown skyline from 1.7 km south
  wallSt:        L(-3300, 8466, 2.2, -3170, 8566, 0.22),   // ON Wall St between Broad and William, looking east down the canyon (the lon/lat point stood 80 m south, inside the block — critic r5 "no street")

  // ---- SKYSCRAPER pass (docs/notes/skyscrapers.md). The two skyline framings
  // are the AD FILM's own cameras (tools/ad/shots.mjs mMidtownSky / fSkyline,
  // middle key of each path) so a bshot frame is the film frame.
  skyMidtown:    P(-73.980290, 40.741880, 321, -0.0513, -0.0986), // = mMidtownSky: Midtown from 1.63 km south at 321 m
  skyFidi:       P(-73.979000, 40.756500, 552,  2.6825, -0.0818), // = fSkyline: 552 m over Midtown, down the island to FiDi
  towerCrowns:   L(-1011, 3938, 210, -1011, 3278, 0.055),         // Bryant Park / 6th Ave crowns from 660 m S at 210 m (near-LoD towers)
  // AM30 (the scanned Alma Mater, city/campus.js): her group stands at (764.39, -2748.12) facing yaw -0.484 (campus south)
  almaFront:     L(761.13, -2741.92, 2.2, 764.39, -2748.12, 0.057),   // 7 m in front at 2.2 m
  almaThreeQ:    L(755.90, -2745.14, 2.6, 764.39, -2748.12, -0.022),  // 9 m out, 43 deg to her left
  almaFar:       L(746.22, -2721.78, 6.0, 764.39, -2748.12, -0.124),  // 32 m down the steps at 6 m (the fColumbia range)
  // TF31 (the Times Square plaza's furniture, city/tsqPlaza.js): the t2Plaza lens between 43rd and 44th, and 25 m over it
  tsqPlaza:      L(-1253.23, 2937.56, 4.2, -1219.35, 2827.28, 0.069),
  tsqPlazaHigh:  L(-1262, 2962, 25, -1226, 2852, -0.22),
  esbCrown:      L(-779, 4301, 250, -1222, 3856, 0.157),          // Empire State + W 34th crowns from 630 m SE at 250 m
  parkAveTops:   L(-68, 3816, 190, -506, 3378, 0.097),            // Grand Central / One Vanderbilt / Chrysler from 620 m SE at 190 m
  crownClose:    L(-1011, 3470, 170, -1011, 3120, 0.06),          // 350 m N up 6th Ave at 170 m: crown geometry at ~0.35 m/px
  fidiRiver:     P(-73.99984, 40.70467, 55, 0.91, 0.11),    // FiDi + bridge from the harbour
};

// --cams <file.json>: more views without editing this file, { name: [cx, cz, alt, tx, tz, pitch] } in world metres (the
// L convention above) or { name: { x, y, z, yaw, pitch } }; a name there overrides a preset of the same name. A view may
// carry its own lens: a 7th number (array form) or `hfov` (object form), the HORIZONTAL fov in degrees the way
// it is set as the vertical fov for this render's aspect and wins over fov=
if (opt('cams')) {
  const J = JSON.parse(await fs.readFile(path.resolve(opt('cams')), 'utf8'));
  for (const [k, v] of Object.entries(J)) {
    if (k.startsWith('_')) continue;
    if (!Array.isArray(v)) { PRESETS[k] = v; continue; }
    const o = L(...v.slice(0, 6));
    if (v.length >= 7 && Number.isFinite(+v[6]) && +v[6] > 0) o.hfov = +v[6];
    PRESETS[k] = o;
  }
}
const views = (opt('views', 'harlem125')).split(',');
// --onepage: every view after the first in the same page, the camera teleported there (window.__TELEPORT) and the frame
// taken once the tiles under it and the dresser are in: one boot for the whole list instead of one per view (a view
// costs ~40 s instead of ~2 min). The sims run on between views; each view keeps its own log.
// Perf numbers in a long batch are not comparable: the streamer keeps the tiles of earlier views, so a later view can
// draw 2.5-5x the triangles and calls of the same view first in a fresh page (BID4 / QA, 2026-10-01: qc_second 88.2 M as
// a batch's 36th view, 16.5 M first). Compare a view with itself in the same slot, or the first views of fresh pages.
const onepage = opt('onepage') === '1';
let sharedPage = null;
const cur = { logs: [], errors: [] };
const time = opt('time', 'day');
const outDir = path.resolve(root, opt('out', 'client/shots/nyc'));
const bench = opt('bench') === '1';
const nodress = opt('nodress') === '1';
const extraQ = opt('flags', '');            // extra query flags, e.g. "ao=0&gi=0"
const waitS = Number(opt('wait', '0'));     // fixed settle time (s) instead of waiting for READY
const label = opt('label', '');
const probe = opt('probe') === '1';          // in-page layer probe (window.__LAYERS)
const passes = opt('passes') === '1';
const nodeSnap = opt('node');                // 'dx,dz,dy,pitch': snap camera to nearest junction after load
const ab = opt('ab') === '1';
const evalFile = opt('evalfile');            // like --eval but the expression is read from a file (no shell quoting)
const evalExpr = evalFile ? (await fs.readFile(evalFile, 'utf8')) : opt('eval');   // print the result of a page expression after load                // in-session A/B of sort order / sky order
const who = opt('who');                      // list anonymous meshes of a material type
const fpsLayers = opt('fps');                // comma list of layers to hide cumulatively while sampling fps (Node-driven)
const trisProbe = opt('tris') === '1';       // deterministic per-layer tris/calls + pool census        // per-pass GPU/CPU profile + triangle census
const [W, H] = (opt('size', '1760x990')).split('x').map(Number);
// take the GPU lock BEFORE spawning Vite (a queued shot must not hold a dev server
// and a Chromium while it waits — four queued jobs doing that paged the machine)
// --nolock: skip the GPU lock for a quick verification still while another renderer holds it
// (frames come out slower and fps numbers are meaningless; never use it for recordings or benches)
// 2026-10-01 guardrails (tools/harness_guard.mjs): a deadline for the run (a boot and ~4 min a view, more with --onepage's
// shared boot; HARNESS_MAX_MIN overrides), the Vite server and the browser killed on any way out, a hung page ends the run
try { installGuard({ name: 'bshot ' + views.slice(0, 3).join(','), maxMin: 15 + 4 * views.length }); } catch (e) { console.log('[bshot] guard not installed:', e?.message || e); }
const releaseGpu = opt('nolock') === '1' ? (() => {}) : await acquireGpu(process.argv.slice(2).join(" ").slice(0, 60)); // one renderer at a time
let port = opt('port');
let server = null;
if (!port) {
  port = String(5400 + Math.floor(Math.random() * 3000));
  const viteBin = path.join(bdir, 'node_modules', 'vite', 'bin', 'vite.js');
  server = spawn(process.execPath, [viteBin, '--port', port, '--strictPort', '--host', '127.0.0.1'], { cwd: bdir, stdio: 'ignore', env: { ...process.env, NYC_NOHMR: '1' } });   // no HMR reloads mid-capture (vite.config.js)
  await new Promise((r) => setTimeout(r, 2500));
}

const gpuState = () => { try { const r = spawnSync('nvidia-smi', ['--query-gpu=temperature.gpu,clocks.sm,power.draw', '--format=csv,noheader'], { encoding: 'utf8' }); return (r.stdout || '').trim(); } catch { return 'n/a'; } };
const headed = opt('headed') === '1';   // headed Chromium lands on the discrete GPU on this laptop
const browser = await chromium.launch({
  headless: !headed,
  args: [(process.platform === 'win32' ? '--use-angle=d3d11' : '--use-angle=vulkan'), ...(process.platform === 'win32' ? [] : ['--js-flags=--max-old-space-size=16384']), '--enable-gpu', '--ignore-gpu-blocklist', '--force_high_performance_gpu', '--disable-gpu-vsync', '--disable-frame-rate-limit', `--window-size=${W},${H}`],
});
await fs.mkdir(outDir, { recursive: true });
try {
  for (const name of views) {
    const p = PRESETS[name];
    if (!p) { console.log('unknown preset', name); continue; }
    const reuse = onepage && !!sharedPage;
    const page = reuse ? sharedPage : await browser.newPage({ viewport: { width: W, height: H } });
    if (!reuse) { try { page.__guardW = watchPage(page, { label: `bshot ${name}` }); } catch {} }
    const errors = [], logs = [];
    cur.logs = logs; cur.errors = errors;
    if (!reuse) {
      page.on('console', (m) => { const t = `[${m.type()}] ${m.text().slice(0, 400)}`; cur.logs.push(t); if (m.type() === 'error') cur.errors.push(m.text().slice(0, 300)); });
      page.on('pageerror', (e) => { cur.errors.push('PAGEERROR ' + String(e).slice(0, 400)); cur.logs.push('PAGEERROR ' + String(e)); });
      // 2026-10-01: Vite's client forwards some page errors over its HMR socket, which NYC_NOHMR turns off, so the logs
      // kept only "Failed to send error to Vite server": log every window error and unhandled rejection here first
      await page.addInitScript(() => {
        addEventListener('error', (e) => console.warn('[pageerr] ' + (e.error && e.error.stack ? e.error.stack : e.message) + (e.filename ? ' @ ' + e.filename + ':' + e.lineno : '')));
        addEventListener('unhandledrejection', (e) => { const r = e.reason; console.warn('[pagerej] ' + (r && r.stack ? r.stack : String(r))); });
      }).catch(() => {});
    }
    if (onepage) sharedPage = page;
    // lmwait=150: a harness render must not assemble tiles before the landmarks module lands (decorate landmarks such as
    // Whittier Hall were missing from the final_v17 oblique when Vite served the module after main.js's 30 s boot cap)
    const lmq = /(^|&)lmwait=/.test(extraQ) ? '' : '&lmwait=150';
    const vfov = p.hfov ? (2 * Math.atan(Math.tan((p.hfov * Math.PI) / 360) / (W / H)) * 180) / Math.PI : null;
    const fovq = vfov && !/(^|&)fov=/.test(extraQ) ? `&fov=${vfov.toFixed(2)}` : '';
    const url = `http://127.0.0.1:${port}/?shot=1&rel=1&x=${p.x}&y=${p.y}&z=${p.z}&yaw=${p.yaw}&pitch=${p.pitch}&time=${time}${nodress ? '&nodress=1' : ''}${extraQ ? '&' + extraQ : ''}${lmq}${fovq}`;
    const tag = `${name}_${time}${nodress ? '_nodress' : ''}${label ? '_' + label : ''}`;
    const logFile = path.join(outDir, `${tag}.log`);
    const writeLog = () => fs.writeFile(logFile, logs.join('\n')).catch(() => {});
    try {
      if (reuse) {
        // over the view high first, so the tiles under it come in, then down to its height over the ground there (rel=1:
        // the preset's y is over the terrain, as main.js FlyCam takes it, the park's own ground inside its rectangle)
        await page.evaluate(([x, y, z, yaw, pitch]) => window.__TELEPORT(x, y + 80, z, yaw, pitch), [p.x, p.y, p.z, p.yaw, p.pitch]);
        await new Promise((s) => setTimeout(s, 1500));
        try { await page.waitForFunction('(function(){ const s = window.__STREAMER; return !!(s && s.readyUnder && s.readyUnder()); })()', undefined, { timeout: 120000 }); } catch { console.log(name, ': tiles under the view not ready after 120 s'); }
        const yAbs = await page.evaluate(([x, y, z, yaw, pitch]) => {
          const S = window.__STREAMER, g0 = S && S.terrainAt ? S.terrainAt(x, z) : null;
          const qx = x - 447.2, qz = z - 82.2, park = Math.abs(qx * 0.4848 - qz * 0.8746) < 2084 && Math.abs(qx * 0.8746 + qz * 0.4848) < 451;
          // RS34: the section under the lens where the terrain grid dips below it (as main.js FlyCam does)
          const si = !park && g0 !== null && S.surfaceInfoAt ? S.surfaceInfoAt(x, z, 0.5) : null;
          // RS35 (QA Q60): only a section within 3 m of the grid counts; a deck over the street is left to the view's height
          // (as the film's PathCam stands keys over terrainAt); `rs35=0` in --flags lets decks count again
          const sy = si && isFinite(si.y) ? si.y - (si.road ? 0.145 : 0.28) : null;
          const g = sy !== null && (sy - g0 <= 3 || /[?&]rs35=0/.test(location.search)) ? Math.max(g0, sy) : g0;
          const yy = (g === null || !isFinite(g) ? 0 : park ? g : Math.max(g, 0.5)) + y;
          window.__TELEPORT(x, yy, z, yaw, pitch);
          return yy;
        }, [p.x, p.y, p.z, p.yaw, p.pitch]);
        console.log(`  onepage: ${name} at y ${Number(yAbs).toFixed(2)}`);
        await new Promise((s) => setTimeout(s, waitS > 0 ? waitS * 1000 : 3000));
      } else {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });   // Vite cold start with the public/ tile index can exceed 60 s
      if (waitS > 0) {
        await new Promise((s) => setTimeout(s, waitS * 1000));
      } else {
        try {
          await page.waitForFunction('window.__READY === true', undefined, { timeout: 90000 });
        } catch { console.log(name, ': READY timeout — capturing anyway'); }
      }
      }
      // the WORLD must exist before the frame is trusted: READY and the dresser can
      // both fire on an empty scene (critic round 2: 35 % of frames were open water
      // or the splash screen). Invalid frames get an _INVALID suffix.
      let worldOk = true;
      try { await page.waitForFunction('(function(){ const s = window.__STREAMER; if (!s || !s.tiles) return false; if (typeof s.readyUnder === "function" && s.readyUnder()) return true; let n = 0; for (const t of s.tiles.values()) if (t && t.state === "ready") n++; return n >= 6; })()', undefined, { timeout: 180000 }); }
      catch { worldOk = false; console.log(name, ': INVALID FRAME — no tiles loaded after 180 s, re-run it'); }
      // the view's own lens (cams hfov): set after the teleport too, so --onepage views each keep theirs
      if (vfov) {
        await page.evaluate((f) => { const c = window.__ENGINE && window.__ENGINE.camera; if (c) { c.fov = f; c.updateProjectionMatrix(); } }, vfov).catch(() => null);
        console.log(`  lens: hfov ${p.hfov} -> vertical fov ${vfov.toFixed(2)}`);
      }
      if (nodeSnap) {
        // give the sims up to 30 s to come up so the snap can use the traffic junction graph
        try { await page.waitForFunction('!!(window.__gtRefs && window.__gtRefs.traffic && window.__gtRefs.traffic._nkGrid && window.__gtRefs.traffic._nkGrid.size > 0)', undefined, { timeout: 30000 }); } catch {}
        const [dx, dz, dy, pitch] = nodeSnap.split(',').map(Number);
        const r = await page.evaluate(([a, b2, c, d]) => window.__GOTO_NODE(a, b2, c, d), [dx, dz, dy, pitch]).catch((e) => String(e));
        console.log('  node snap:', JSON.stringify(r));
        await new Promise((s) => setTimeout(s, 4000));
      }
      // let the dresser drain its queue (budgeted builds, a few ms per frame)
      try {
        await page.waitForFunction('!window.__DRESS || (function(){ const d = window.__DRESS(); return typeof d !== "object" || (d.queued === 0 && d.active > 0); })()', undefined, { timeout: 40000 });
      } catch { console.log(name, ': dresser queue did not drain'); }
      // TW (towers lane): and the tower kit (world/towerKit.js) its build queue
      try {
        await page.waitForFunction('!window.__TW || (function(){ const d = window.__TW(); return !d || (d.ready && d.queued === 0); })()', undefined, { timeout: 90000 });
      } catch { console.log(name, ': tower kit queue did not drain'); }
      { const tw = await page.evaluate(() => window.__TW ? window.__TW() : null).catch(() => null); if (tw) console.log('  towers:', JSON.stringify(tw)); }
      await new Promise((s) => setTimeout(s, 1500));
      // steady-state profile: reset after loading/dressing, sample 4 s
      await page.evaluate(() => window.__PROF_RESET && window.__PROF_RESET()).catch(() => null);
      await new Promise((s) => setTimeout(s, 4000));
      console.log('  gpu state (temp C, sm MHz, W):', gpuState());
      const perf = await page.evaluate(() => window.__PERF ? window.__PERF() : null).catch(() => null);
      const dress = await page.evaluate(() => window.__DRESS ? window.__DRESS() : null).catch(() => null);
      const prof = await page.evaluate(() => window.__PROF ? window.__PROF() : null).catch(() => null);
      if (prof && typeof prof === 'object') console.log('  prof:', JSON.stringify(prof));
      if (trisProbe) {
        const t = await page.evaluate(() => window.__TRIS()).catch((e) => String(e));
        console.log('  tris:', JSON.stringify(t));
        const pl = await page.evaluate(() => window.__POOLS(25)).catch((e) => String(e));
        console.log('  pools:', JSON.stringify(pl));
      }
      if (evalExpr) {
        // async-aware: an expression that evaluates to a promise (e.g. a sampling audit that awaits
        // between frames) is awaited before stringifying, instead of printing "{}"
        const ev = await page.evaluate(async (x) => { try { let v = eval(x); if (v && typeof v.then === 'function') v = await v; return JSON.stringify(v); } catch (e) { return 'ERR ' + e.message; } }, evalExpr).catch((e) => String(e));
        console.log('  eval:', ev);
      }
      if (ab) {
        const sampleFps = async (ms) => {
          await new Promise((s) => setTimeout(s, 700));
          const a = await page.evaluate(() => window.__FRAMES());
          await new Promise((s) => setTimeout(s, ms));
          const b2 = await page.evaluate(() => window.__FRAMES());
          return +(((b2.frames - a.frames) * 1000) / (b2.t - a.t)).toFixed(1);
        };
        const r = {};
        r.base1 = await sampleFps(3000);
        await page.evaluate(() => window.__SORT(false)); r.threeSort = await sampleFps(3000); await page.evaluate(() => window.__SORT(true));
        await page.evaluate(() => window.__SKYORDER(0)); r.skyFirst = await sampleFps(3000); await page.evaluate(() => window.__SKYORDER(1));
        await page.evaluate(() => { window.__SORT(false); window.__SKYORDER(0); }); r.bothOff = await sampleFps(3000); await page.evaluate(() => { window.__SORT(true); window.__SKYORDER(1); });
        r.base2 = await sampleFps(3000);
        const sd = await page.evaluate(() => window.__SHADOWDBG()).catch((e) => String(e));
        console.log('  ab:', JSON.stringify(r));
        console.log('  shadowdbg:', JSON.stringify(sd));
      }
      if (fpsLayers) {
        const sampleFps = async (ms) => {
          await new Promise((s) => setTimeout(s, 700));
          const a = await page.evaluate(() => window.__FRAMES());
          await new Promise((s) => setTimeout(s, ms));
          const b = await page.evaluate(() => window.__FRAMES());
          return +(((b.frames - a.frames) * 1000) / (b.t - a.t)).toFixed(1);
        };
        const res = { base: await sampleFps(3000) };
        await page.evaluate(() => window.__FREEZE_SHADOW(true));
        res.frozenShadow = await sampleFps(3000);
        await page.evaluate(() => window.__FREEZE_SHADOW(false));
        if (await page.evaluate(() => typeof window.__SHADOWSETS === 'function')) {
          await page.evaluate(() => window.__SHADOWSETS(false));
          res.noShadowSets = await sampleFps(3000);
          await page.evaluate(() => window.__SHADOWSETS(true));
        }
        for (const L of fpsLayers.split(',')) {
          const n = await page.evaluate((l) => window.__LAYER(l, false), L);
          res['no_' + L] = await sampleFps(3000) + ' (' + n + ')';
        }
        const rest = await page.evaluate(() => window.__REST(40)).catch((e) => String(e));
        for (const L of fpsLayers.split(',')) await page.evaluate((l) => window.__LAYER(l, true), L);
        res.restored = await sampleFps(2500);
        console.log('  fps layers:', JSON.stringify(res));
        console.log('  rest:', JSON.stringify(rest));
      }
      if (who) {
        for (const mt of who.split(',')) { const w = await page.evaluate((m) => window.__WHO(m, 6), mt).catch((e) => String(e)); console.log('  who ' + mt + ':', JSON.stringify(w)); }
      }
      if (passes) {
        const a = await page.evaluate(() => window.__PASSES(90, false)).catch((e) => String(e));
        console.log('  passes:', JSON.stringify(a));
        const b = await page.evaluate(() => window.__PASSES(90, true)).catch((e) => String(e));
        console.log('  passes(frozen shadow):', JSON.stringify(b));
        const c = await page.evaluate(() => window.__SCENE ? window.__SCENE(30) : null).catch((e) => String(e));
        console.log('  census:', JSON.stringify(c));
      }
      if (probe) {
        const pr = await page.evaluate(() => window.__LAYERS(3000)).catch((e) => String(e));
        console.log('  probe:', JSON.stringify(pr));
      }
      // LENS CLEAR (2026-09-28): a walker within 0.65 m of a standing lens is cut open by the 0.4 m near plane (the crowd
      // worker's st42 finding: eyeballs, teeth and the inside of the hair where a face was); the walkers ignore a lens that is
      // not recording, so wait (up to 12 s) for the sidewalk to move on
      for (let k = 0; k < 30; k++) {
        const hit = await page.evaluate(() => (typeof window.__LENS_HIT === 'function' ? window.__LENS_HIT() : null)).catch(() => null);
        if (!hit) break;
        if (k === 0) console.log('  lens hit, waiting:', JSON.stringify(hit));
        await new Promise((s) => setTimeout(s, 400));
      }
      const gpu = await page.evaluate(() => { try { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'n/a'; } catch { return 'n/a'; } });
      let file = path.join(outDir, `${tag}${worldOk ? '' : '_INVALID'}.png`);
      // IN-PAGE CAPTURE (2026-09-17): page.screenshot races the compositor — at heavy poses (wbBroadway, 30 M tris,
      // fps 0.4) it returned a frame whose right 59 % was the clear colour, twice, and one of them reached a critic as
      // "pair 4". engine.capture (main.js window.__capture) reads the canvas right after composer.render, the same path
      // the film recorder switched to in ff0be1d. Falls back to the screenshot when the page has no __capture.
      let captured = false;
      try {
        const dataUrl = await page.evaluate(() => (typeof window.__capture === 'function' ? window.__capture('image/png') : null));
        if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,') && dataUrl.length > 20000) {
          await fs.writeFile(file, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
          captured = true;
        }
      } catch (e) { console.log('  in-page capture failed, screenshot fallback:', String(e).split('\n')[0]); }
      if (!captured) await page.screenshot({ path: file, timeout: 120000 });
      { const st = await fs.stat(file).catch(() => null); if (st && st.size === 290614 && !file.endsWith("_INVALID.png")) { const bad = file.replace(/.png$/, "_INVALID.png"); await fs.rename(file, bad).catch(() => {}); console.log("INVALID FRAME: splash plate (290614 bytes = HMR reload mid-shot) ->", bad); } }
      // EMPTY-FRAME FLOOR (round 10): a plate that is only sky and water, or a near-black frame, compresses to a fraction of a
      // city frame; the world-ready test passed such plates and flagged good ones. Under ~350 KB at 1760x990 is not a city.
      { const st = await fs.stat(file).catch(() => null); if (st && st.size < 350000 && !file.endsWith("_INVALID.png")) { const bad = file.replace(/.png$/, "_INVALID.png"); await fs.rename(file, bad).catch(() => {}); console.log(`INVALID FRAME: ${(st.size / 1024).toFixed(0)} KB — sky/water or black plate ->`, bad); } }
      // rgb(11,15,22) — the screenshot fired before the canvas had finished — at 1.4 MB, above the size floor and without the
      // suffix, and a critic spent a pair on it. A city frame always carries structure at both edges: if the luma span of the
      // outermost 160 px columns on EITHER side is under 40, the capture is truncated and gets the suffix.
      if (!file.endsWith('_INVALID.png')) {
        try {
          const { PNG } = await import(pathToFileURL(path.join(bdir, 'node_modules', 'pngjs', 'lib', 'png.js')).href);   // pngjs lives in client/
          const png = PNG.sync.read(await fs.readFile(file));
          const span = (x0, x1) => { let lo = 255, hi = 0; for (let y = 0; y < png.height; y += 2) for (let x = x0; x < x1; x += 2) { const o = (y * png.width + x) * 4; const L = 0.2126 * png.data[o] + 0.7152 * png.data[o + 1] + 0.0722 * png.data[o + 2]; if (L < lo) lo = L; if (L > hi) hi = L; } return hi - lo; };
          const cols = Math.min(160, png.width >> 2);
          const sL = span(0, cols), sR = span(png.width - cols, png.width);
          if (sL < 40 || sR < 40) { const bad = file.replace(/.png$/, '_INVALID.png'); await fs.rename(file, bad); file = bad; console.log(name, `: INVALID FRAME — truncated capture (edge luma span L ${sL.toFixed(0)} R ${sR.toFixed(0)}), re-run it`); }
        } catch (e) { console.log('  edge-span check skipped:', String(e).split('\n')[0]); }
      }
      // --jpg (2026-09-30, the disk had 7.8 GB left with a dozen workers rendering): a valid plate is re-encoded to JPEG q90
      // (about a fifth of the PNG) and the PNG removed; an _INVALID plate stays a PNG
      if (opt('jpg') === '1' && !file.endsWith('_INVALID.png')) {
        try {
          const { createRequire } = await import('node:module');
          const sharp = createRequire(path.join(root, 'tools', 'assets', 'package.json'))('sharp');
          const jf = file.replace(/\.png$/, '.jpg');
          await sharp(file).jpeg({ quality: 90, mozjpeg: true }).toFile(jf);
          await fs.unlink(file); file = jf;
        } catch (e) { console.log('  jpg re-encode failed, PNG kept:', String(e).split('\n')[0]); }
      }
      const uniq = [...new Set(errors)];
      console.log(`shot ${path.relative(root, file)}  ${perf ? `fps=${perf.fps} calls=${perf.calls} tris=${(perf.tris / 1e6).toFixed(1)}M progs=${perf.progs}` : ''}  gpu=${String(gpu).slice(0, 60)}`);
      if (dress) console.log('  dress:', JSON.stringify(dress));
      if (uniq.length) console.log('  errs:\n  ' + uniq.slice(0, 10).join('\n  '));
    } catch (e) {
      console.log(`FAILED ${tag}: ${String(e).split('\n')[0]}`);
      console.log('  last log lines:\n  ' + logs.slice(-12).join('\n  '));
    }
    await writeLog();
    if (bench) {
      // sample fps for 5 s after everything has settled
      await new Promise((s) => setTimeout(s, 5000));
      const p2 = await page.evaluate(() => window.__PERF ? window.__PERF() : null).catch(() => null);
      console.log(JSON.stringify({ view: name, time, nodress, ...p2 }));
    }
    if (!onepage) { page.__guardW?.stop(); await page.close(); }
  }
  if (sharedPage) { sharedPage.__guardW?.stop(); await sharedPage.close(); }
} finally {
  await browser.close();
  releaseGpu();
  if (server) server.kill();
}
