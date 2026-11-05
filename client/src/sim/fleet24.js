// FLEET24 — the CARLA 0.10 (2024) vehicle set (CC-BY 4.0, see DATA_SOURCES.md) for the traffic sim.
// docs/notes/peds-veh-v2.md. `?fleet24=0` restores the legacy 0.9.15 fleet (sim/vehicles.js + sim/vehicleCull.js).
//
// Assets come from tools/assets/build_vehicle.mjs: one GLB per kind in public/models/fleet24/ with three LOD nodes
// (LOD0 ~140k tris, LOD1 = CARLA's parked mesh ~10k, LOD2 ~3k), KTX2 textures, meshopt geometry, and per-vertex
// `_wheel` (1..4 = FL FR RL RR) and `_lamp` (role, ROLE below) attributes. Model frame: +Z forward, +Y up, origin at
// the ground centre, left side at +X.
//
// Rendering follows sim/vehicleCull.js: traffic.js keeps writing matrices/colours into its pool meshes, which are
// invisible STORAGE here. Each frame the visible vehicles are compacted into per-(kind, pool, LOD) render sets — one
// InstancedMesh per material part, all parts of a set SHARING one instance-matrix attribute and one per-instance data
// attribute pair — plus shadow-only sets inside the near shadow box. Per-car state that the storage does not carry
// (wheel spin, steering, brake, indicators) is derived from each slot's motion between frames.
import * as THREE from 'three';
import { ENV, applySnowCap, applySpecAA } from '../world/materials.js';
import { Instancer } from '../city/instancer.js';
import { csVehicles } from '../city/contactShadow.js';
import { sweepOut } from '../core/shadowSweep.js';   // SV29

const QS = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const BASE = 'models/fleet24/';
const LODD = (QS.get('f24lod') || '24,75').split(',').map(Number);   // LOD0 < 24 m, LOD1 < 75 m, LOD2 beyond
// FP37 (core/engine.js, the film policy): while recording, a vehicle's level changes only far out (LOD0 within 120 m, LOD1
// within 300 m at least; the film's f24lod=60,180 switched a car's body and its shadow at 60 m)
if (QS.get('record') === '1' && QS.get('fp37') !== '0') { LODD[0] = Math.max(LODD[0], 120); LODD[1] = Math.max(LODD[1], 300); }
const LOD0_2 = LODD[0] * LODD[0], LOD1_2 = LODD[1] * LODD[1];
const PAD_MAIN = 3, PAD_SHADOW = 12;
// `?vclear=<m>` leaves out any vehicle, parked or moving, whose body comes within <m> metres of the lens (and whose roof
const VCLEAR = Math.max(0, +(QS.get('vclear') || 0)) || 0;
// straight ahead of the lens (1.6 m either side of the view line) within <m> metres: the camera car's own following gap,
const VAHEAD = Math.max(0, +(QS.get('vahead') || 0)) || 0;
// `?f24art=<deg>` (look-dev, e.g. with the showroom): every articulated bus drawn at that articulation angle
const ART_FORCE = QS.get('f24art') !== null && Number.isFinite(+QS.get('f24art')) ? (+QS.get('f24art') * Math.PI) / 180 : null;

// NV34 (AR34 VEHICLES): New York's own vehicle kinds below; `?nv34=0` drops them and restores the bag they share
const NV34 = QS.get('nv34') !== '0';
// VH36 (AR34 vehicle models; owner 2026-10-02 ~12:05 on teaser 7's t7ArchTrack frame_00080: "The truck on the left ... is
// too low poly for our simulator and too basic for us to include in teasers; we need more detailed higher quality
// vehicles"): no kind below the bar of the CARLA 0.10 bodies (docs/notes/ar34-vehmodels.md has the judgement per kind).
// A kind upgraded to the bar draws its VH36 model (VH36_FILE: its own GLB; VH36_BASE: an at-the-bar body it is derived
// from, deriveKind as taxi2 is); a kind with no model at the bar yet is left out (VH36_OUT), its spawn share falling to the
// kinds that remain (traffic.js skips a bag entry whose kind is not loaded). The kind names and the sim's body sizes stay
// one: traffic.js takes every size from the drawn model (vehDims, carHalf), so VC36 / VN36 follow the new bodies.
// `?vh36=0`: the fleet as it was.
const VH36 = QS.get('vh36') !== '0';
const VH36_FILE = VH36 ? { boxtruck26: 'boxtruck26_vh36' } : {};
// (stepvan on the Sprinter too, and nypd on the Charger police car with its NYPD livery: 125th Street's delivery-van and
// NYPD shares in traffic.js's MOVE125 / PARK125 bags stay where they were instead of falling to the box trucks)
const VH36_BASE = VH36 ? { cargovan: 'van', stepvan: 'van', nypd: 'police' } : {};
// (the NV34 kinds built from scratch, and the older CARLA cars of 15-21k triangles: judged on 125th Street at 3 and 10 m
// against the 2024 bodies, client/shots/ar34/vehmodels/judge/)
const VH36_OUT = new Set(VH36 ? ['uspsllv', 'uspsngdv', 'dsny', 'schoolbus', 'foodtruck', 'icecream', 'impala', 'model3', 'auditt', 'mustang'] : []);
// kind table. w: share of the MOVING spawn bag (of ~100), pw: parked share, cap: moving storage slots
export const KIND24 = {
  // the Crown Victoria cab (retired from NYC ~2018): out of the moving and parked bags since 2026-11-04 (its body carries
  // its source asset's trunk lettering, legible behind it); the API's vehicle.taxi still spawns it
  taxi: { w: 0, pw: 0, cap: 30, palette: 'taxi' },
  // TODAY'S CAB: most NYC yellow cabs are Toyota Camry / RAV4 / Sienna hybrids in the TLC "T" livery
  // (refs/pv2/c_New_York_City_yellow_taxicabs*.jpg). No CC-BY Toyota exists; the 2024 Lincoln MKZ body is a Camry-sized
  // sedan (4.89 m, 2.87 m wheelbase vs 4.88 / 2.83), so taxi2 = that body + taxi yellow + TLC livery + a roof light.
  // NV34: the NV200 cab (taxinv200, w 3) takes 3 of taxi2's 13, so the yellow cabs' share of the bag stays where it was
  taxi2: { w: NV34 ? 10 : 13, pw: 3, cap: 120, palette: 'taxi', base: 'lincoln' },
  lincoln: { w: 12, pw: 4, cap: 100, palette: 'black' },
  suv: { w: 21, pw: 7, cap: 150, palette: 'car' },
  charger: { w: 8, pw: 3, cap: 80, palette: 'car' },
  impala: { w: 6, pw: 3, cap: 60, palette: 'car' },       // PV2 variety: the older CARLA sedans (build_vehicle.mjs); the 16k-tri
                                                          // Impala reads dated inside ~8 m, so it stays a minority
  mercedes: { w: 6, pw: 3, cap: 60, palette: 'car' },
  mini: { w: 5, pw: 3, cap: 50, palette: 'car' },
  van: { w: 14, pw: 3, cap: 110, palette: 'van' },
  boxtruck: { w: 8, pw: 1, cap: 70, palette: 'truck' },
  // NV34: the NYPD's Police Interceptor Utility (nypd, w 2) takes 2 of the Charger's 3 (the FPIU is the common patrol car)
  police: { w: NV34 ? 1 : 3, pw: 1, cap: 30, palette: 'livery' },
  ambulance: { w: 1, pw: 0, cap: 12, palette: 'livery' },
  minibus: { w: 1, pw: 0, cap: 12, palette: 'truck' },    // a Japanese Fuso Rosa: rare shuttle duty only
  firetruck: { w: 1, pw: 0, cap: 8, palette: 'livery' },
  // FLEET27 (2026-09-26): older CARLA cars from the same 0.10 package (15-21k tris, the Impala's generation; built by
  // tools/assets/build_vehicle.mjs). `?fleet27=0` drops them (f27 'qa' would hold a kind back unless `?fleet27=all`).
  // The Tesla Model 3 is one of the most common NYC ride-hail and private cars; the Audi TT is a rare coupe; the 1966
  // Mustang convertible only stands parked (a classic). Their pw count in half units of a second copy of the parked list
  // (loadFleet24), so the parked cars of the older kinds mostly keep the kinds they had.
  // Left out after QA: the BMW Gran Tourer (cartoon proportions, 10 % too wide, solid wheel discs), the 2017 MKZ (the
  // lincoln / taxi2 silhouette again), the VW T2 and the two-wheelers.
  model3: { w: 6, pw: 2, cap: 60, palette: 'car', f27: true },
  auditt: { w: 1, pw: 0.5, cap: 12, palette: 'car', f27: true },
  mustang: { w: 0, pw: 0.5, cap: 4, palette: 'car', f27: true },
  // NV34 (AR34 VEHICLES, 2026-10-01): New York's own vehicles, built from scratch by the AR34 modelling tracks
  // (docs/notes/ar34-veh-*.md; first passes, refined under the same names). `?nv34=0` drops them all. pw stays 0 here:
  // a new entry in the city's parked list would reshuffle every parked car's kind; they park through 125th Street's own
  // mix (traffic.js PARK125) instead. MTA buses (w 0) run only as route buses (traffic.js BUS34: the M60 SBS on the
  // articulated LFS or XD60, the M101 / M125 / M100 locals on the XD40 and the LFS). The moving shares are rules, not counts.
  mtaxd60: { w: 0, pw: 0, cap: 12, palette: 'livery', nv34: true },
  mtalfsa: { w: 0, pw: 0, cap: 12, palette: 'livery', nv34: true },
  mtalfsal: { w: 0, pw: 0, cap: 12, palette: 'livery', nv34: true },  // the same in the white local livery (BUSES 00:08: M101 / M125 artics)
  mtaxd40: { w: 0, pw: 0, cap: 12, palette: 'livery', nv34: true },
  mtalfs: { w: 0, pw: 0, cap: 12, palette: 'livery', nv34: true },
  taxinv200: { w: 3, pw: 0, cap: 30, palette: 'livery', nv34: true },   // the NV200 TLC cab
  nypd: { w: 2, pw: 0, cap: 20, palette: 'livery', nv34: true },        // Ford Police Interceptor Utility, NYPD livery
  uspsllv: { w: 1, pw: 0, cap: 12, palette: 'livery', nv34: true },
  uspsngdv: { w: 1, pw: 0, cap: 12, palette: 'livery', nv34: true },
  dsny: { w: 1, pw: 0, cap: 8, palette: 'livery', nv34: true },
  schoolbus: { w: 1, pw: 0, cap: 8, palette: 'livery', nv34: true },
  stepvan: { w: 2, pw: 0, cap: 20, palette: 'truck', nv34: true },
  cargovan: { w: 3, pw: 0, cap: 30, palette: 'van', nv34: true },
  boxtruck26: { w: 2, pw: 0, cap: 20, palette: 'truck', nv34: true },
  foodtruck: { w: 0, pw: 0, cap: 4, palette: 'livery', nv34: true },
  icecream: { w: 0, pw: 0, cap: 4, palette: 'livery', nv34: true },
};
const F27 = QS.get('fleet27');
// ==== R1D (CORE, docs/notes/arch-r1-d.md): the kind selection loadFleet24 applies, shared with the headless core
// (core/sim/fleet.mjs builds the same trafficFleet from the GLBs' metadata, with no mesh), and the per-vehicle seed and
// paint the renderer derives (core/tracks writes them into a take's actor tracks)
export const R1D_FLEET_SEL = { F27, NV34, VH36_OUT, VH36_BASE, VH36_FILE, BASE };
export const R1D_FLEET_FNS = { hash, paintFor };
// ==== R1D end
// RG32 (owner 2026-09-29: "a bug of tops of vehicles disappearing/looking broken sometimes", a red Model 3 from above,
// its seats showing through the roof): the Model 3's roof and the MKZ's (lincoln, taxi2) are GLASS, 59-60 % of what each
// shows from above, and glass cast no shadow, so the sun lit the seats through a pane 62 % opaque. Now the panes that
// face up (roof, windscreen, rear screen) cast the cabin's shadow, from a copy 3 cm inside the cabin so the pane does not
// shadow itself, and the roof panes are tinted like the real ones (93 % opaque where they face up; the MKZ's curved roof
// has 20 % of its glass at a normal of 0.85-0.90).
// `?rg32=0`: the old glass.
const RG32 = QS.get('rg32') !== '0';
// scene.environmentIntensity mirrored per frame: vehicle materials carry their OWN envMap (so their specular
// reflection runs at full strength) but their env DIFFUSE is scaled back to what the rest of the scene gets
const F24ENV = { value: 0.22 };
export const ROLE = { head: 1, fbl: 2, fbr: 3, tail: 4, rbl: 5, rbr: 6, rev: 7, sirenR: 8, sirenB: 9 };
// lamp mask bits (per instance)
const L_HEAD = 1, L_TAIL = 2, L_BRAKE = 4, L_BLINKL = 8, L_BLINKR = 16, L_SIREN = 32;

const TAXI_YELLOW = new THREE.Color(0xf2b705);

// ---------------------------------------------------------------- shader patches
// wheel spin (about +X through the hub) and front-wheel steer (about +Y), per vertex `_wheel`, per instance aVeh.xy
const WHEEL_VERT_PARS = /* glsl */ `
attribute float _wheel;
attribute vec4 aVeh;     // x spin (rad), y steer (rad), z lamp mask, w seed
attribute vec4 aPaint;   // x metallic, y dirt, z roughness, w -
attribute vec3 aCol;     // paint colour (linear)
uniform vec4 uHub[8];    // xyz hub centre, w radius (_wheel 1..4 FL FR RL RR; 5..8 a third and fourth axle, L then R)
varying vec4 vPaint;
varying vec3 vCol;
varying float vLampMask;
varying float vSeed;
varying vec3 vObjPos;
varying vec3 vObjN;
vec3 f24Wheel(vec3 p, int wi, bool isNormal) {
  vec4 hub = uHub[wi - 1];
  vec3 q = isNormal ? p : p - hub.xyz;
  float c = cos(aVeh.x), s = sin(aVeh.x);
  q = vec3(q.x, c * q.y - s * q.z, s * q.y + c * q.z);
  if (wi <= 2) { float cs = cos(aVeh.y), ss = sin(aVeh.y); q = vec3(cs * q.x + ss * q.z, q.y, -ss * q.x + cs * q.z); }
  return isNormal ? q : q + hub.xyz;
}
`;
const WHEEL_VERT_NORMAL = /* glsl */ `
#include <beginnormal_vertex>
int f24wi = int(_wheel + 0.5);
if (f24wi > 0) objectNormal = f24Wheel(objectNormal, f24wi, true);
vObjN = objectNormal;
`;
const WHEEL_VERT_POS = /* glsl */ `
#include <begin_vertex>
if (f24wi > 0) transformed = f24Wheel(transformed, f24wi, false);
vPaint = aPaint; vCol = aCol; vLampMask = aVeh.z; vSeed = aVeh.w; vObjPos = position;
`;
const FRAG_PARS = /* glsl */ `
uniform float f24Night;
uniform sampler2D f24Decal;
uniform vec4 f24DecalBox;
uniform float f24Env;
float f24h(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float f24n(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(f24h(i), f24h(i + vec3(1, 0, 0)), f.x), mix(f24h(i + vec3(0, 1, 0)), f24h(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(f24h(i + vec3(0, 0, 1)), f24h(i + vec3(1, 0, 1)), f.x), mix(f24h(i + vec3(0, 1, 1)), f24h(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
varying vec4 vPaint;
varying vec3 vCol;
varying float vLampMask;
varying float vSeed;
varying vec3 vObjPos;
varying vec3 vObjN;
`;

function patch(mat, kind, { paint = false, lamp = false, glass = false, roof = false, hubs = null, sizeY = 1.5, decal = null, plate = false, artic = null, signRows = 0, cabin = false } = {}) {
  const prev = mat.onBeforeCompile;
  const rowsU = signRows ? { value: signRows } : null;
  const pivU = artic ? { value: new THREE.Vector3(artic[0], artic[1], artic[2]) } : null;
  const sizeU = { value: sizeY };   // a uniform, not a literal: every kind shares its part programs (PF25 program census)
  const hubU = { value: (hubs || []).concat([0, 0, 0, 0, 0, 0, 0, 0].map(() => ({ p: [0, -100, 0], r: 0 }))).slice(0, 8).map((h) => new THREE.Vector4(h.p[0], h.p[1], h.p[2], h.r)) };
  mat.onBeforeCompile = (sh, r) => {
    sh.uniforms.uHub = hubU;
    sh.uniforms.f24SizeY = sizeU;
    sh.uniforms.f24Night = ENV.night;
    sh.uniforms.f24Time = ENV.time;
    sh.uniforms.f24Env = F24ENV;
    if (decal) { sh.uniforms.f24Decal = { value: decal.tex }; sh.uniforms.f24DecalBox = { value: decal.box }; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + WHEEL_VERT_PARS)
      .replace('#include <beginnormal_vertex>', WHEEL_VERT_NORMAL)
      .replace('#include <begin_vertex>', WHEEL_VERT_POS);
    if (artic) {
      // AR34 articulated bus: the joint (bellows) turns about the turntable pivot by the instance's articulation angle
      // (aPaint.w = sign cell * 8 + angle + 2) times its per-vertex weight `_artic` (0 at the front body's ring, 1 at the rear's)
      sh.uniforms.f24Pivot = pivU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float _artic;\nuniform vec3 f24Pivot;')
        .replace('vObjN = objectNormal;', `{ float f24a = (mod(aPaint.w, 8.0) - 2.0) * _artic, f24c = cos(f24a), f24s = sin(f24a);
          objectNormal = vec3(f24c * objectNormal.x + f24s * objectNormal.z, objectNormal.y, -f24s * objectNormal.x + f24c * objectNormal.z); }
        vObjN = objectNormal;`)
        .replace('vPaint = aPaint;', `{ float f24a = (mod(aPaint.w, 8.0) - 2.0) * _artic, f24c = cos(f24a), f24s = sin(f24a);
          vec3 f24q = transformed - f24Pivot;
          transformed = vec3(f24c * f24q.x + f24s * f24q.z, f24q.y, -f24s * f24q.x + f24c * f24q.z) + f24Pivot; }
        vPaint = aPaint;`);
    }
    // PLATE ATLAS: each car shows its own plate — a cell of the 8 x 8 atlas picked from the instance seed (cabs: the TLC
    // row, others: the 56 NY rows)
    if (plate) sh.vertexShader = sh.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
      #ifdef USE_MAP
      {
        float pid = floor(fract(aVeh.w * 13.37 + 0.123) * ${/taxi/.test(kind) ? '8.0' : '56.0'})${/taxi/.test(kind) ? ' + 56.0' : ''};
        vMapUv = (vMapUv + vec2(mod(pid, 8.0), floor(pid / 8.0))) / 8.0;
      }
      #endif`);
    if (signRows) {
      // AR34 route signs: each bus shows its own route and direction, a cell of the sign texture (rows of 1 / signRows in v,
      // the sign meshes' UVs on cell 0) picked per instance: aPaint.w = cell * 8 + articulation + 2
      sh.uniforms.f24SignRows = rowsU;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float f24SignRows;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_EMISSIVEMAP
          vEmissiveMapUv.y += floor(aPaint.w / 8.0) / f24SignRows;
        #endif
        #ifdef USE_MAP
          vMapUv.y += floor(aPaint.w / 8.0) / f24SignRows;
        #endif`);
    }
    let fs = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + FRAG_PARS + 'uniform float f24Time;\nuniform float f24SizeY;\n');
    fs = fs.replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      #ifdef USE_ENVMAP
        iblIrradiance *= f24Env / max(envMapIntensity, 1e-3);
      #endif`);
    // albedo trim: the scene's sun and sky are hot by design (traffic.js vhTrim, materials.js applyLightTrim)
    const trimDay = paint ? 0.82 : 0.88;
    fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= mix(${trimDay.toFixed(3)}, 1.0, f24Night);`);
    if (paint) {
      fs = fs.replace('#include <color_fragment>', `#include <color_fragment>
      {
        diffuseColor.rgb *= vCol;
        ${decal ? `// SIDE DECAL SHEET (NYPD livery): object-space projection on the side panels; row 0 = the car's left (+X, front at
        // the sheet's left), row 1 = its right (-X, mirrored layout), v = height over the sheet's top
        if (abs(vObjN.x) > 0.25 && vObjPos.y < f24DecalBox.z) {
          float ds = (f24DecalBox.x - vObjPos.z) / f24DecalBox.y;
          float drow = vObjN.x > 0.0 ? 0.0 : 1.0;
          // (VH36: a sheet of N designs, f24DecalBox.w > 1, stacks them in pairs of rows; each instance shows one, by its seed)
          float dN = max(f24DecalBox.w, 1.0), dk = dN > 1.5 ? floor(fract(vSeed * 7.131 + 0.37) * dN) : 0.0;
          vec2 duv = vec2(drow < 0.5 ? ds : 1.0 - ds, (dk * 2.0 + drow + clamp(vObjPos.y / f24DecalBox.z, 0.0, 0.999)) / (2.0 * dN));
          vec4 dc = texture2D(f24Decal, duv);
          diffuseColor.rgb = mix(diffuseColor.rgb, dc.rgb, dc.a * smoothstep(0.25, 0.45, abs(vObjN.x)));
        }` : ''}
        // road film: a smooth rise toward the sills and wheel arches, streaked vertically — never splotches
        // (thresholded blob noise read as dents and mud splats on the 125th St taxi)
        float h = vObjPos.y / f24SizeY;
        float n = 0.65 + 0.35 * f24n(vec3(vObjPos.x * 1.7, vObjPos.y * 11.0, vObjPos.z * 1.7) + vSeed * 37.0);
        float dirt = vPaint.y * pow(1.0 - smoothstep(0.02, 0.5, h), 1.6) * n;
        vec3 grime = vec3(0.30, 0.28, 0.25) * dot(diffuseColor.rgb, vec3(0.3333)) + vec3(0.045, 0.040, 0.034);
        diffuseColor.rgb = mix(diffuseColor.rgb, grime, clamp(dirt, 0.0, 0.7));
      }`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor = mix(vPaint.z, 0.7, clamp(vPaint.y * pow(1.0 - smoothstep(0.02, 0.5, vObjPos.y / f24SizeY), 1.6), 0.0, 0.8));`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      metalnessFactor = vPaint.x;`);
    }
    if (lamp) {
      // day: a tinted lens over a bright reflector; lit roles add emissive
      fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      {
        int role = int(vLamp + 0.5);
        int m = int(vLampMask + 0.5);
        vec3 tint = role == 4 ? vec3(0.9, 0.04, 0.03) : (role == 2 || role == 3 || role == 5 || role == 6) ? vec3(1.0, 0.45, 0.03)
          : role == 8 ? vec3(1.0, 0.05, 0.03) : role == 9 ? vec3(0.08, 0.2, 1.0) : vec3(1.0, 0.96, 0.88);
        diffuseColor.rgb *= mix(vec3(1.0), tint, 0.85);
        float blink = step(0.5, fract(f24Time * 1.5));
        float e = 0.0;
        if (role == 1) e = ((m & 1) != 0 ? 7.0 : 0.0);
        else if (role == 4) e = ((m & 4) != 0 ? 6.0 : ((m & 2) != 0 ? 1.6 : 0.0));
        else if (role == 2 || role == 5) e = ((m & 8) != 0 ? 6.0 * blink : 0.0);
        else if (role == 3 || role == 6) e = ((m & 16) != 0 ? 6.0 * blink : 0.0);
        else if (role == 8) e = ((m & 32) != 0 ? 9.0 * step(0.5, fract(f24Time * 2.3)) : 0.0);
        else if (role == 9) e = ((m & 32) != 0 ? 9.0 * (1.0 - step(0.5, fract(f24Time * 2.3))) : 0.0);
        totalEmissiveRadiance += tint * e;
      }`);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float _lamp;\nvarying float vLamp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLamp = _lamp;');
      fs = fs.replace('#include <common>', '#include <common>\nvarying float vLamp;');
    }
    if (glass) {
      // premultiplied output: the pane's reflection is NOT attenuated by its opacity (a window is a mirror at
      // grazing angles and a dark tint head-on) — blending is ONE, ONE_MINUS_SRC_ALPHA (see mkGlass)
      fs = fs.replace('#include <opaque_fragment>', `${roof ? `
      // RG32: a pane facing straight up is roof glass, tinted as the real ones are
      diffuseColor.a = mix( diffuseColor.a, 0.93, smoothstep( 0.86, 0.96, dot( normal, normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz ) ) ) );` : ''}
      vec3 f24Dif = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
      vec3 f24Spec = reflectedLight.directSpecular + reflectedLight.indirectSpecular;
      gl_FragColor = vec4(f24Dif * diffuseColor.a + f24Spec + totalEmissiveRadiance, diffuseColor.a);`);
    }
    // AR34 `cabin` (BUSES 00:23): a bus's ceiling, ceiling strips and upper linings glow after dusk only
    if (cabin) fs = fs.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance *= f24Night;`);
    sh.fragmentShader = fs;
    prev?.call(mat, sh, r);
  };
  const tag = `f24|${paint ? 'p' : ''}${lamp ? 'l' : ''}${glass ? 'g' : ''}${roof ? 'r' : ''}${decal ? 'd' : ''}${plate ? (/taxi/.test(kind) ? 'P' : 'q') : ''}${artic ? 'a' : ''}${signRows ? 's' : ''}${cabin ? 'c' : ''}`;
  const prevKey = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => tag + (prevKey ? '|' + prevKey() : '');
  mat.needsUpdate = true;
  return mat;
}

function mkGlass(tint, opacity, rough = 0.03) {
  const m = new THREE.MeshPhysicalMaterial({ color: tint, roughness: rough, metalness: 0, transparent: true, opacity, depthWrite: false, envMapIntensity: 1.25 });
  m.blending = THREE.CustomBlending;
  m.blendSrc = THREE.OneFactor;
  m.blendDst = THREE.OneMinusSrcAlphaFactor;
  return m;
}

// NYPD LIVERY (PV2): CARLA's cop livery ("POLICE 911" black/white) maps as blotches on the 2024 Charger and is not New
// York's. Police cars paint white and carry the classic NYPD side livery (refs/pv2/c_125_St_green_light.jpg): navy
// pinstripes under the beltline and along the doors, "NYPD" on the front doors, the red / blue chevron mark on the rear
// doors, the unit number on the rear quarter. Positions are the 2024 Charger's (hubs at z +1.50 / -1.54, front door
// +0.85..-0.30, rear door -0.30..-1.33, beltline from its side glass).
const DECALS = new Map();
// TLC LIVERY (taxi2): on each front door the black "T" roundel with "NYC" behind it (toward the rear), the medallion
// number on the rear quarter under the window line, a thin rate-card block on the rear door (refs/pv2 taxi photos).
function tlcDecal(meta) {
  if (typeof document === 'undefined') return null;
  const key = 'tlc|' + (meta.size || []).join(',');
  if (DECALS.has(key)) return DECALS.get(key);
  const L = meta.size?.[2] || 4.9, zF = L / 2, TOP = 1.2, W = 2048, H = 1024;
  const hubs = meta.hubs || [];
  const zfh = hubs[0]?.p?.[2] ?? 1.48, zrh = hubs[2]?.p?.[2] ?? -1.39;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (z, row) => (row === 0 ? (zF - z) / L : 1 - (zF - z) / L) * W;
  const Y = (y, row) => H * (1 - (row + Math.min(y, TOP) / TOP) * 0.5);
  const hs = W / L, vs = H / 2 / TOP;
  const text = (str, z, y, capH, font, col, row) => {
    g.save(); g.translate(X(z, row), Y(y, row)); g.scale(hs / vs, 1);
    g.font = font + ' ' + (capH * vs) / 0.72 + 'px Arial, Helvetica, sans-serif'; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(str, 0, 0); g.restore();
  };
  const med = ['7J42', '8H57', '5C81', '3L16', '9D24'][Math.floor(((meta.size?.[0] || 2) * 997) % 5)];
  const zDoor = zfh - 1.0, zNyc = zDoor - 0.24, zMed = zrh + 0.05;
  for (const row of [0, 1]) {
    // "T" roundel: black disc, taxi-yellow T
    g.save(); g.translate(X(zDoor, row), Y(0.74, row)); g.scale(hs / vs, 1);
    g.fillStyle = '#111'; g.beginPath(); g.arc(0, 0, 0.085 * vs, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f2b705'; g.font = 'bold ' + (0.12 * vs) / 0.72 + 'px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('T', 0, 0.008 * vs);
    g.restore();
    text('NYC', zNyc, 0.74, 0.05, 'bold', '#111', row);
    text(med, zMed, 0.86, 0.075, 'bold', '#111', row);
    // rate card: a few fine black lines on the rear door
    g.fillStyle = 'rgba(17,17,17,0.85)';
    for (let k = 0; k < 4; k++) { const y = 0.9 - k * 0.022, a = X(zrh + 0.62, row), b = X(zrh + 0.9, row); g.fillRect(Math.min(a, b), Y(y, row), Math.abs(b - a) * (k === 0 ? 1 : 0.8), 0.008 * vs); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const out = { tex, box: new THREE.Vector4(zF, L, TOP, 0) };
  DECALS.set(key, out);
  return out;
}

// boxes), so a street shows a mix. Laid out on the box's sides only (meta.box: its front and rear z), both sides reading
// front to rear as the TLC sheet does.
function boxDecal(meta) {
  if (typeof document === 'undefined' || !meta.box) return null;
  const key = 'box|' + (meta.size || []).join(',');
  if (DECALS.has(key)) return DECALS.get(key);
  // (`?vh36boxk=<2..4>`, look-dev: every box shows that design)
  const FK = QS.get('vh36boxk') !== null ? Math.max(0, Math.min(4, +QS.get('vh36boxk') | 0)) : -1;
  const N = FK >= 0 ? 1 : 5, L = meta.size?.[2] || 9.84, zF = L / 2, TOP = meta.box.top || 3.85, W = 2048, H = FK >= 0 ? 1024 : 4096;
  const zb0 = meta.box.y0, zb1 = meta.box.y1, zc = (zb0 + zb1) / 2, BL = zb0 - zb1;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (z, row) => (row % 2 === 0 ? (zF - z) / L : 1 - (zF - z) / L) * W;
  const Y = (y, row) => H * (1 - (row + Math.min(y, TOP) / TOP) / (2 * N));
  const hs = W / L, vs = H / (2 * N) / TOP;
  const text = (str, z, y, capH, font, col, row, maxLen) => {
    g.save(); g.translate(X(z, row), Y(y, row)); g.scale(hs / vs, 1);
    g.font = font + ' ' + (capH * vs) / 0.72 + 'px Arial, Helvetica, sans-serif'; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'middle';
    if (maxLen) { const w = g.measureText(str).width; if (w > maxLen * vs) g.scale((maxLen * vs) / w, 1); }
    g.fillText(str, 0, 0); g.restore();
  };
  const band = (z0, z1, y0, y1, col, row) => { g.fillStyle = col; const a = X(z0, row), b = X(z1, row); g.fillRect(Math.min(a, b), Y(y1, row), Math.abs(b - a), Y(y0, row) - Y(y1, row)); };
  for (let k = FK >= 0 ? FK : 2; k < (FK >= 0 ? FK + 1 : N); k++) for (const side of [0, 1]) {
    const row = (FK >= 0 ? 0 : k * 2) + side;
    if (k < 2) continue;  // the blank designs
    if (k === 2) {        // a moving company: navy name, red band, phone
      band(zb0 - 0.15, zb1 + 0.15, 1.42, 1.56, '#b3202a', row);
      text('HALVORSEN', zc, 2.86, 0.42, '900', '#1d2f5e', row, BL * 0.8);
      text('MOVING & STORAGE', zc, 2.3, 0.2, 'bold', '#1d2f5e', row, BL * 0.7);
      text('(212) 555-0147', zc, 1.85, 0.14, 'bold', '#1d2f5e', row);
    } else if (k === 3) { // a produce wholesaler: green
      band(zb0 - 0.15, zb1 + 0.15, 1.38, 1.62, '#2f7d32', row);
      text('MARIGOLD PRODUCE', zc, 2.75, 0.34, '900', '#2f7d32', row, BL * 0.85);
      text('WHOLESALE FRUIT AND VEGETABLES', zc, 2.25, 0.13, 'bold', '#3a3a3a', row, BL * 0.8);
    } else {              // a freight carrier: black name over an orange stripe
      band(zb0 - 0.15, zb1 + 0.15, 2.18, 2.34, '#e8731c', row);
      text('CORVID FREIGHT', zc, 2.72, 0.36, '900', '#151515', row, BL * 0.8);
      text('(718) 555-0193', zc, 1.9, 0.13, 'bold', '#151515', row);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const out = { tex, box: new THREE.Vector4(zF, L, TOP, N) };
  DECALS.set(key, out);
  return out;
}

// the roof light of a NYC cab: a slim box over the roof centre, its panel faces carrying "TAXI"
function roofLight(meta, roofY, zc) {
  const w = 0.62, h = 0.13, d = 0.2;
  const parts = [new THREE.BoxGeometry(w, h, d).translate(0, roofY + 0.035 + h / 2, zc)];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.03, 0.035, 0.03).translate(sx * (w / 2 - 0.05), roofY + 0.0175, zc + sz * (d / 2 - 0.04)));
  let map = null;
  if (typeof document !== 'undefined') {
    const cvs = document.createElement('canvas');
    cvs.width = 512; cvs.height = 128;
    const g = cvs.getContext('2d');
    g.fillStyle = '#f4efd9'; g.fillRect(0, 0, 512, 128);
    g.fillStyle = '#222'; g.fillRect(0, 0, 512, 10); g.fillRect(0, 118, 512, 10);
    g.font = 'bold 78px Arial, Helvetica, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('TAXI', 256, 66);
    map = new THREE.CanvasTexture(cvs); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4;
  }
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.35, metalness: 0 });
  patch(applySnowCap(mat), 'taxi2', { hubs: meta.hubs, sizeY: meta.size?.[1] || 1.5 });
  mat.envMapIntensity = 0.7;
  mat.name = 'f24:taxi2:rooflight';
  mat.userData.cls = 'detail';
  const pos = [], nrm = [], uv = [];
  for (const x0 of parts) { const x = x0.toNonIndexed(); pos.push(...x.attributes.position.array); nrm.push(...x.attributes.normal.array); uv.push(...x.attributes.uv.array); }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return { geometry: out, material: mat, cls: 'detail', tris: pos.length / 9 };
}

// NY PLATE QUADS: 12 x 6 in (0.305 x 0.152 m), placed 6 mm proud of the rearmost / frontmost body surface on the centre
// line at plate height (probed on the LOD0 parts, glass excluded). Texture: the Empire Gold design drawn at runtime (the
// same design tools/assets/livery_plate.mjs bakes for CARLA's shared plate sheet); cabs carry a TLC "T...C" medallion
// plate with the TAXI legend.
// 8 x 8 cells of 256 px laid out like CARLA's plate sheet (the plate in the band v 0.289-0.758, u 0.016-0.984; UV v runs
// down, flipY off), so CARLA's own plate meshes and the procedural quads both index it. Rows 0-6: NY Empire Gold plates
// "ABC-1234"; row 7: TLC cab plates "T123456C" with the TAXI legend.
let PLATE_ATLAS = null;
function plateAtlas() {
  if (PLATE_ATLAS || typeof document === 'undefined') return PLATE_ATLAS;
  const C = 256, c = document.createElement('canvas'); c.width = C * 8; c.height = C * 8;
  const g = c.getContext('2d');
  const NAVY = '#10295e';
  let seed = 20260923;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const LET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  for (let k = 0; k < 64; k++) {
    const x0 = (k % 8) * C, y0 = Math.floor(k / 8) * C, taxi = k >= 56;
    g.fillStyle = '#2b2b2e'; g.fillRect(x0, y0, C, C);
    const px = x0 + 4, py = y0 + 74, pw = C - 8, ph = 120;
    g.fillStyle = '#f2c14e'; g.fillRect(px, py, pw, ph);
    g.strokeStyle = NAVY; g.lineWidth = 3; g.strokeRect(px + 2, py + 2, pw - 4, ph - 4);
    g.fillStyle = NAVY; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = 'bold 18px Arial, Helvetica, sans-serif'; g.fillText('NEW YORK', px + pw / 2, py + 19);
    const text = taxi ? 'T' + String(700000 + Math.floor(rnd() * 99999)) + 'C'
      : LET[Math.floor(rnd() * 23)] + LET[Math.floor(rnd() * 23)] + LET[Math.floor(rnd() * 23)] + '-' + String(1000 + Math.floor(rnd() * 8999));
    g.save(); g.translate(px + pw / 2, py + 66); g.scale(0.78, 1);
    g.font = 'bold ' + (taxi ? 50 : 62) + 'px Arial Narrow, Arial, Helvetica, sans-serif'; g.fillText(text, 0, 0); g.restore();
    g.font = '13px Arial, Helvetica, sans-serif'; g.fillText(taxi ? 'TAXI' : 'THE EMPIRE STATE', px + pw / 2, py + 108);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.flipY = false;
  PLATE_ATLAS = t;
  return t;
}
function plateMaterial(kind, meta) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: plateAtlas(), roughness: 0.45, metalness: 0.1, side: THREE.DoubleSide });
  patch(applySnowCap(mat), kind, { hubs: meta.hubs, sizeY: meta.size?.[1] || 1.5, plate: true });
  mat.envMapIntensity = 0.7;
  mat.name = 'f24:' + kind + ':plate';
  mat.userData.cls = 'detail';
  return mat;
}
function plateParts(kind, parts, meta) {
  const W = 0.305, H = 0.152;
  const probe = (sign, y0, y1) => {
    let best = sign > 0 ? -1e9 : 1e9;
    for (const p of parts) {
      if (p.cls === 'glass' || p.cls === 'lens') continue;
      const a = p.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const x = a.getX(i), y = a.getY(i), z = a.getZ(i);
        if (Math.abs(x) > 0.16 || y < y0 || y > y1) continue;
        best = sign > 0 ? Math.max(best, z) : Math.min(best, z);
      }
    }
    return Number.isFinite(best) && Math.abs(best) < 4 ? best : null;
  };
  const zr = probe(-1, 0.42, 0.62), zf = probe(1, 0.3, 0.5);
  const quads = [];
  if (zr != null) quads.push([zr - 0.006, 0.52, -1]);
  if (zf != null) quads.push([zf + 0.006, 0.4, 1]);
  if (!quads.length) return null;
  const pos = [], nrm = [], uv = [], idx = [];
  for (const [z, y, dir] of quads) {
    const b = pos.length / 3;
    // facing +Z (front) or -Z (rear); u runs left-to-right as seen by a viewer facing the plate
    // viewer facing the front plate has +X on the right (u from -X); facing the rear plate, -X on the right. Both
    // orders wind counter-clockwise toward their own normal
    const xs = dir > 0 ? [-W / 2, W / 2] : [W / 2, -W / 2];
    pos.push(xs[0], y - H / 2, z, xs[1], y - H / 2, z, xs[1], y + H / 2, z, xs[0], y + H / 2, z);
    for (let k = 0; k < 4; k++) nrm.push(0, 0, dir);
    const u0 = 4 / 256, u1 = 252 / 256, vT = 74 / 256, vB = 194 / 256;
    uv.push(u0, vB, u1, vB, u1, vT, u0, vT);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return { geometry: geo, material: plateMaterial(kind, meta), cls: 'detail', tris: idx.length / 3 };
}

// a kind that shares another kind's geometry and non-paint materials (no extra GPU memory), with its own paint
function deriveKind(kind, base) {
  const meta = { ...base.meta };
  const pp = base.lods[0].find((p) => p.cls === 'paint');
  const paint = pp?.gm ? runtimeMaterial(kind, pp.gm, meta) : null;
  // roof height and centre from ALL of the base's LOD0 parts over the centre line (the MKZ's roof is black panoramic
  // GLASS, so the highest paint was its rear deck and the light landed over the trunk): the roof is the highest band,
  // the light goes over the middle of it
  let roofY = 0, zs = 0;
  const cl = [];
  for (const p of base.lods[0]) {
    const a = p.geometry.attributes.position;
    for (let i = 0; i < a.count; i++) if (Math.abs(a.getX(i)) < 0.25) { cl.push(a.getY(i), a.getZ(i)); roofY = Math.max(roofY, a.getY(i)); }
  }
  // lower a cut until the band above it spans 0.6 m along the car: an antenna fin or a spoiler tip is higher than the
  // roof but short
  for (let cut = roofY - 0.01; cut > roofY - 0.25; cut -= 0.01) {
    let z0 = 1e9, z1 = -1e9;
    for (let i = 0; i < cl.length; i += 2) if (cl[i] > cut) { z0 = Math.min(z0, cl[i + 1]); z1 = Math.max(z1, cl[i + 1]); }
    if (z1 - z0 >= 0.6) { roofY = cut + 0.01; zs = (z0 + z1) / 2; break; }
  }
  const sign = kind === 'taxi2' && roofY > 0.8 ? roofLight(meta, roofY - 0.005, zs) : null;
  const plate = /taxi/.test(kind) ? plateParts(kind, base.lods[0].filter((p) => !/:plate$/.test(p.material?.name || '')), meta) : null;
  const lods = base.lods.map((parts) => {
    const out = parts.map((p) => (p.cls === 'paint' && paint ? { ...p, material: paint } : p)).filter((p) => !(plate && /:plate$/.test(p.material?.name || '')));
    if (plate) out.splice(1, 0, plate);
    if (sign) out.splice(1, 0, sign);
    return out;
  });
  const size = [...base.size];
  if (sign) size[1] = Math.max(size[1], roofY + 0.2);
  return { ...base, kind, meta, lods, size, radius: Math.hypot(size[0], size[1], size[2]) / 2 + 0.3 };
}

function nypdDecal(meta) {
  if (typeof document === 'undefined') return null;
  const key = 'nypd|' + (meta.size || []).join(',');
  if (DECALS.has(key)) return DECALS.get(key);
  const L = meta.size?.[2] || 5.24, zF = L / 2, TOP = 1.2, W = 2048, H = 1024;
  const belt = meta.beltline || 0.9;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const X = (z, row) => (row === 0 ? (zF - z) / L : 1 - (zF - z) / L) * W;
  const Y = (y, row) => H * (1 - (row + Math.min(y, TOP) / TOP) * 0.5);
  const box = (z0, z1, y0, y1, row, col) => { g.fillStyle = col; const a = X(z0, row), b = X(z1, row); g.fillRect(Math.min(a, b), Y(y1, row), Math.abs(b - a), Y(y0, row) - Y(y1, row)); };
  const hs = W / L, vs = H / 2 / TOP;   // px per metre along / up the car
  const text = (str, z, y, capH, weight, col, row) => {
    const px = capH * vs / 0.72;
    g.save(); g.translate(X(z, row), Y(y, row)); g.scale(hs / vs, 1);
    g.font = `${weight} ${px}px Arial, Helvetica, sans-serif`; g.fillStyle = col; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.fillText(str, 0, 0); g.restore();
  };
  const NAVY = '#1c3a8c', RED = '#c8202c';
  for (const row of [0, 1]) {
    box(2.2, -2.35, belt - 0.085, belt - 0.05, row, NAVY);          // beltline pinstripe, fender to quarter
    box(0.85, -1.33, 0.4, 0.43, row, NAVY);                          // door pinstripe
    text('NYPD', 0.28, 0.5, 0.2, 'italic 900', NAVY, row);           // front door
    for (let k = 0; k < 3; k++) {                                     // rear door chevron: three speed lines with a red lead
      const y = 0.54 + k * 0.06, zc = -0.8, dir = row === 0 ? 1 : -1;
      box(zc + 0.2, zc - 0.2, y, y + 0.03, row, NAVY);
      g.fillStyle = RED; g.beginPath();
      const xa = X(zc + 0.2, row), xb = X(zc + 0.3, row), yy0 = Y(y - 0.005, row), yy1 = Y(y + 0.035, row);
      g.moveTo(xa, yy0); g.lineTo(xb, (yy0 + yy1) / 2); g.lineTo(xa, yy1); g.closePath(); g.fill();
      void dir;
    }
    text(String(1000 + ((meta.size?.[0] || 2) * 1000 | 0) % 9000), -2.25, 0.6, 0.07, 'bold', '#111', row);   // unit number, behind the rear arch
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
  const out = { tex, box: new THREE.Vector4(zF, L, TOP, 0) };
  DECALS.set(key, out);
  return out;
}

// runtime material for a glTF part material
function runtimeMaterial(kind, gm, meta, artic = null) {
  const cls = gm.userData?.cls || 'detail';
  const hubs = meta.hubs, sizeY = meta.size?.[1] || 1.5;
  let m;
  if (/licenseplate/i.test(gm.name || '')) {
    m = plateMaterial(kind, meta);
    m.name = `f24:${kind}:${gm.name}`;
    return m;
  }
  if (cls === 'paint') {
    // (VH36: the nypd kind drawn on the police car's body takes its NYPD livery too)
    const nypd = kind === 'police' || (kind === 'nypd' && VH36_BASE.nypd) ? nypdDecal(meta) : kind === 'taxi2' ? tlcDecal(meta)
      : kind === 'boxtruck26' && VH36_FILE.boxtruck26 && QS.get('vh36box') !== '0' ? boxDecal(meta) : null;   // VH36 (`?vh36box=0`: plain boxes)
    // (AR34, BUSES 00:08: a bus's paint reads semi-gloss in the photographs; at clearcoat 1 / 0.035 the black window band
    // and the blue roof band mirrored the sky grey-blue along a bus's side)
    const busP = /^mta/.test(kind);
    m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, map: nypd ? null : gm.map || null, roughness: 0.35, metalness: 0, clearcoat: busP ? 0.6 : 1, clearcoatRoughness: busP ? 0.12 : 0.035, envMapIntensity: 1.0 });
    if (m.map) m.map.anisotropy = 8;
    // the cop body's AO sheet maps through the same broken UVs as its livery (jagged grey patches on white paint)
    if (gm.aoMap && !nypd) { m.aoMap = gm.aoMap; m.aoMapIntensity = 0.8; }
    patch(applySnowCap(m), kind, { paint: true, hubs, sizeY, decal: nypd, artic });
    applySpecAA(m, { sigma2: 0.25, kappa: 0.2, clearcoat: true });
  } else if (cls === 'glass') {
    // (AR34, BUSES 00:23: a bus's tinted side and windscreen glass reads near black by day in the photographs; the shared
    // pane showed its cabin bright)
    m = patch(/^mta/.test(kind) ? mkGlass(0x07090b, 0.76) : mkGlass(0x0a0d10, 0.62), kind, { glass: true, roof: RG32, hubs, sizeY, artic });
  } else if (cls === 'lens') {
    m = patch(mkGlass(0xdfe4e8, 0.10, 0.02), kind, { glass: true, hubs, sizeY, artic });
  } else if (cls === 'lamp' || cls === 'siren') {
    m = new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.18, metalness: 0.55, emissive: 0x000000, envMapIntensity: 1.0 });
    patch(m, kind, { lamp: true, hubs, sizeY, artic });
  } else if (cls === 'sign') {
    // AR34: an LED destination / route sign (a bus's front, side and rear signs): its own texture, lit day and night
    m = new THREE.MeshStandardMaterial({ color: 0x060606, roughness: 0.32, metalness: 0, emissive: 0xffffff, emissiveMap: gm.emissiveMap || gm.map || null, emissiveIntensity: 1.6 });
    if (m.emissiveMap) m.emissiveMap.anisotropy = 8;
    patch(m, kind, { hubs, sizeY, artic, signRows: meta.signs?.cells ? meta.signs.rows || 8 : 0 });
  } else if (cls === 'cabin') {
    // AR34 (BUSES 00:23): a bus's ceiling, ceiling strips and upper linings: the glTF surface by day, lit white-blue after dusk
    // (a real bus's cabin glows at night: Commons "Night Bus (50089247341).jpg"); the GLB tags them with extras cls 'cabin'
    m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: gm.map || null, roughness: 0.6, metalness: 0, emissive: 0xdde6ff, emissiveMap: gm.map || null, emissiveIntensity: 1.2 });
    patch(m, kind, { hubs, sizeY, artic, cabin: true });
  } else if (cls === 'lampInner') {
    m = new THREE.MeshStandardMaterial({ color: 0x0a0a0b, roughness: 0.22, metalness: 0.3 });
    patch(m, kind, { hubs, sizeY, artic });
  } else {
    m = gm.clone();
    m.color?.set?.(0xffffff);
    m.envMapIntensity = 1.0;
    if (m.map) m.map.anisotropy = 8;
    if (m.aoMap) m.aoMapIntensity = 0.85;
    // UE's masked blend with Opacity = 1 is an opaque surface: never alpha-test the (zero) basecolor alpha
    m.transparent = false; m.alphaTest = 0; m.alphaMap = null;
    patch(applySnowCap(m), kind, { hubs, sizeY, artic });
    applySpecAA(m, { sigma2: 0.25, kappa: 0.2 });
  }
  m.envMapIntensity = { paint: 0.9, glass: 1.0, lens: 1.0, lamp: 1.0, siren: 1.0, lampInner: 0.8, sign: 0.3 }[cls] ?? 0.7;
  m.name = `f24:${kind}:${gm.name || cls}`;
  m.userData.cls = cls;
  return m;
}

// ---------------------------------------------------------------- loading
function toFloat(attr) {
  if (!attr || (attr.array instanceof Float32Array && !attr.normalized)) return attr;
  const out = new Float32Array(attr.count * attr.itemSize);
  for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
  return new THREE.BufferAttribute(out, attr.itemSize);
}

function buildKind(kind, gltf) {
  gltf.scene.updateMatrixWorld(true);
  // the vehicle node carries the build metadata (the glTF SCENE shares the kind's name, so search by content)
  let root = null;
  gltf.scene.traverse((o) => { if (!root && o.userData && o.userData.hubs) root = o; });
  root = root || gltf.scene;
  const meta = root.userData || {};
  // three r185's GLTFLoader reads a node's extras `pivot` as GLTFExporter's pivot container: it moves the node by -pivot,
  // zeroes its first child's translation (an LOD's dequantisation offset) and drops the key (BUSES, 2026-10-01 23:57: the
  // XD60 drawn shifted with its wheels in the windows). On a vehicle root it is an articulated bus's turntable, data: put
  // the glTF transforms back and keep the value. Files from 23:55 name it `turntable`.
  if (root.pivot) {
    meta.turntable = meta.turntable || root.pivot.toArray();
    root.pivot = null;
    const nodes = gltf.parser?.json?.nodes || [], assoc = gltf.parser?.associations;
    for (const o of [root, ...root.children]) {
      const a = assoc && assoc.get(o), nd = a && a.nodes !== undefined ? nodes[a.nodes] : null;
      if (!nd) continue;
      if (nd.matrix) new THREE.Matrix4().fromArray(nd.matrix).decompose(o.position, o.quaternion, o.scale);
      else { o.position.fromArray(nd.translation || [0, 0, 0]); o.quaternion.fromArray(nd.rotation || [0, 0, 0, 1]); o.scale.fromArray(nd.scale || [1, 1, 1]); }
    }
    gltf.scene.updateMatrixWorld(true);
    console.warn('[fleet24]', kind + ': extras `pivot` undone (GLTFLoader pivot container); please name it `turntable`');
  }
  const PIV = meta.turntable || meta.pivot || null;
  // beltline = the bottom of the side glass (side decal sheets hang their stripes under it)
  if (meta.beltline == null) {
    let yb = 1e9;
    const v = new THREE.Vector3(), w = new THREE.Vector3();
    root.getObjectByName('LOD0')?.traverse((o) => {
      if (!o.isMesh || o.material?.userData?.cls !== 'glass' || !o.geometry.attributes.normal) return;
      const p = o.geometry.attributes.position, n = o.geometry.attributes.normal;
      for (let i = 0; i < p.count; i++) {
        w.fromBufferAttribute(n, i).transformDirection(o.matrixWorld);
        if (Math.abs(w.x) < 0.6) continue;
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
        yb = Math.min(yb, v.y);
      }
    });
    if (yb > 0.5 && yb < 1.6) meta.beltline = yb;
  }
  const matCache = new Map();
  const lods = [];
  for (let li = 0; li < 3; li++) {
    const node = root.getObjectByName('LOD' + li);
    const parts = [];
    // AR34 articulated bus (BUS60's mtaxd60): the LOD node holds LOD<n>_front, LOD<n>_rear and LOD<n>_joint (the bellows,
    // weighted by `_artic`); a separate REAR_LOD<n> node is read as the rear body too
    const rearNode = root.getObjectByName('REAR_LOD' + li);
    // (GLTFLoader suffixes a node name its mesh already took, 'LOD0_rear' -> 'LOD0_rear_1': the glTF name is in userData.name)
    const bodyOf = (o) => {
      for (let q = o; q && q !== root; q = q.parent) {
        for (const nm of [q.userData?.name, q.name]) {
          const m = /^LOD\d_(front|rear|joint)(_\d+)?$/.exec(nm || '');
          if (m) return m[1];
          if (/^REAR_LOD\d(_\d+)?$/.test(nm || '')) return 'rear';
        }
      }
      return 'front';
    };
    for (const nd of [node, rearNode]) if (nd) nd.traverse((o) => {
      if (!o.isMesh) return;
      // meshopt QUANTIZE put a dequantisation transform on the node: bake it (float attributes first)
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(o.geometry.attributes)) g.setAttribute(k, toFloat(a));
      g.setIndex(o.geometry.index);
      g.applyMatrix4(o.matrixWorld);
      g.computeBoundingSphere();
      const gm = o.material;
      const body = bodyOf(o);
      // the bellows bend by `_artic` about the pivot: their own copy of the material, patched for it
      const joint = body === 'joint' && PIV && g.attributes._artic;
      const key = (gm.name || gm.uuid) + (joint ? '|joint' : '');
      if (!matCache.has(key)) matCache.set(key, runtimeMaterial(kind, gm, meta, joint ? PIV : null));
      const mat = matCache.get(key);
      parts.push({ geometry: g, material: mat, cls: mat.userData.cls, gm, body, tris: (g.index ? g.index.count : g.attributes.position.count) / 3 });
    });
    // opaque first, glass last (transparent sort within a set is by object, and every part shares the origin)
    const order = { paint: 0, detail: 1, sign: 1, lampInner: 2, lamp: 3, siren: 3, lens: 4, glass: 5 };
    parts.sort((a, b) => (order[a.cls] ?? 1) - (order[b.cls] ?? 1));
    lods.push(parts);
  }
  // NY plates on kinds that ship without plate geometry (the 2024 Lincoln / Charger / Patrol / Ford cab): the plate
  // material of the older kinds is named *LicensePlate*; everything else gets front + rear plate quads on its centre line
  const hasPlate = lods[0].some((p) => /plate/i.test(p.gm?.name || '') || /plate/i.test(p.material?.name || ''));
  // (USPS's LLV and NGDV carry no plates: their vehicle number is painted on, CITYTRUCKS' hand-over 2026-10-01)
  if (!hasPlate && !/firetruck|boxtruck|minibus|usps/.test(kind)) {
    const plate = plateParts(kind, lods[0], meta);
    if (plate) for (const parts of lods) parts.splice(1, 0, plate);
  }
  const size = meta.size || [2, 1.5, 4.6];
  // lamp anchors for carlights.js (night glow sprites): per role and side from the LOD0 lamp vertices (an articulated
  // bus's tail lamps are on its rear body: taken in the straight pose)
  const lamps = lampAnchors(lods[0]);
  // the articulated bus's rear body: its own instanced sets (fleet24 tows it about the pivot), out of the front's
  let rear = null;
  if (PIV && lods[0].some((p) => p.body === 'rear')) {
    const hz = (meta.hubs || []).filter((h) => h.id >= 5).map((h) => h.p[2]);
    const axle = hz.length ? Math.min(...hz) : -(size[2] / 2 - 2.5);
    rear = { lods: lods.map((parts) => parts.filter((p) => p.body === 'rear')), pivot: PIV, tow: Math.max(1, PIV[2] - axle) };
    for (let li = 0; li < lods.length; li++) lods[li] = lods[li].filter((p) => p.body !== 'rear');
  }
  return { kind, meta, size, lods, lamps, rear, radius: Math.hypot(size[0], size[1], size[2]) / 2 + 0.3 };
}

function lampAnchors(parts) {
  const acc = {};
  for (const p of parts) {
    if (p.cls !== 'lamp') continue;
    const pos = p.geometry.attributes.position, role = p.geometry.attributes._lamp;
    if (!role) continue;
    for (let i = 0; i < pos.count; i++) {
      const r = role.getX(i);
      const end = r === ROLE.head ? 'front' : r === ROLE.tail ? 'rear' : null;
      if (!end) continue;
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const k = end + (x > 0 ? 'L' : 'R');
      const a = acc[k] || (acc[k] = { n: 0, x: 0, y: 0, z: end === 'front' ? -1e9 : 1e9, x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9 });
      a.n++; a.x += x; a.y += y;
      a.z = end === 'front' ? Math.max(a.z, z) : Math.min(a.z, z);
      a.x0 = Math.min(a.x0, x); a.x1 = Math.max(a.x1, x); a.y0 = Math.min(a.y0, y); a.y1 = Math.max(a.y1, y);
    }
  }
  const mk = (a, dir) => (a ? [a.x / a.n, a.y / a.n, a.z + dir * 0.01, Math.min(0.42, Math.max(0.055, (a.x1 - a.x0) / 2)), Math.min(0.32, Math.max(0.045, (a.y1 - a.y0) / 2))] : null);
  const fL = mk(acc.frontL, 1), fR = mk(acc.frontR, 1), rL = mk(acc.rearL, -1), rR = mk(acc.rearR, -1);
  if (!(fL || fR) && !(rL || rR)) return null;
  return { front: fL || fR ? [fL || fR, fR || fL] : null, rear: rL || rR ? [rL || rR, rR || rL] : null };
}

export async function loadFleet24(renderer) {
  const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'), import('three/addons/loaders/KTX2Loader.js'), import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const ktx2 = (await import('../city/mat/ktx2.js')).ktx2Loader(renderer);   // the app's one KTX2 loader (MATS 06:15)
  const loader = new GLTFLoader().setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  const only = QS.get('f24only') ? QS.get('f24only').split(',') : null;
  const kinds = {};
  const t0 = performance.now();
  const wanted = Object.keys(KIND24).filter((k) => (!only || only.includes(k)) && !(KIND24[k].f27 && (F27 === '0' || (KIND24[k].f27 === 'qa' && F27 !== 'all'))) && !(KIND24[k].nv34 && !NV34) && !VH36_OUT.has(k));
  const baseOf = (k) => VH36_BASE[k] || KIND24[k].base || null;   // VH36: a kind drawn on another kind's body
  const bases = new Set(wanted.map((k) => baseOf(k) || k));
  await Promise.all([...bases].map(async (k) => {
    try { kinds[k] = buildKind(k, await loader.loadAsync(BASE + (VH36_FILE[k] || k) + '.glb')); }
    catch (e) { console.warn('[fleet24] unavailable:', k, e?.message || e); }
  }));
  // every texture of the fleet is transcoded by now: free the transcoder's workers and leave three's count of active KTX2
  // loaders (it warns once per loader started while another is active; the lead's verify log had five such lines). One
  // loader for the whole app is asked of MATS (ar34-req/MATS.md 2026-10-02).
  // (the shared loader of city/mat/ktx2.js stays for the app's other .ktx2: never disposed here)
  for (const k of wanted) if (baseOf(k) && kinds[baseOf(k)]) kinds[k] = deriveKind(k, kinds[baseOf(k)]);
  // a base loaded only for a derived kind (f24only=taxi2) is not itself in traffic
  for (const k of Object.keys(kinds)) if (!wanted.includes(k)) delete kinds[k];
  const names = Object.keys(KIND24).filter((k) => kinds[k]);
  if (!names.length) return null;
  for (const k of names) {
    const K = kinds[k];
    console.log(`[fleet24] ${k}: ${K.size.map((v) => v.toFixed(2)).join('x')} m, LOD tris ${K.lods.map((l) => l.reduce((s, p) => s + p.tris, 0)).join('/')}, parts ${K.lods[0].map((p) => p.cls).join(',')}`);
  }
  console.log(`[fleet24] ${names.length} kinds in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  // traffic.js's fleet contract: paint/dark geometries only size the storage (a box of the model's envelope)
  const trafficFleet = {};
  for (const k of names) {
    const K = kinds[k];
    const box = new THREE.BoxGeometry(K.size[0], K.size[1], K.size[2]).translate(0, K.size[1] / 2, 0);
    trafficFleet[k] = { paint: box, dark: box, parts: {}, shell: null, cap: KIND24[k].cap, w: KIND24[k].w, lamps: K.lamps, f24: K };
  }
  // weighted parked kinds (traffic.js picks uniformly from this list; repeats = weight)
  const parked = names.filter((k) => !KIND24[k].f27).flatMap((k) => Array(KIND24[k].pw).fill(k));
  // FLEET27 kinds (half-unit pw) go into a SECOND copy of that list: traffic.js picks index (hash % length), and with
  // the length doubled (hash % 2n) % n is the old pick, so every parked record keeps the kind it had before FLEET27
  // except those landing on the copy slots the new kinds take. The slots are taken in proportion to each old kind's
  // weight (largest remaining quota first), so the old kinds keep their ratios as closely as whole slots allow.
  const extra = names.filter((k) => KIND24[k].f27).flatMap((k) => Array(Math.round(KIND24[k].pw * 2)).fill(k));
  if (extra.length && extra.length >= parked.length) {
    // too few old kinds left to share slots with (f24only look-dev): plain half-unit weights
    parked.splice(0, parked.length, ...names.flatMap((k) => Array(Math.round(KIND24[k].pw * 2)).fill(k)));
  } else if (extra.length) {
    const copy = parked.slice(), n = new Map();
    for (const k of copy) n.set(k, (n.get(k) || 0) + 1);
    const quota = new Map([...n].map(([k, c]) => [k, (extra.length * c) / copy.length]));
    for (const k of extra) {
      const top = [...quota].filter(([q]) => n.get(q) > 0).sort((a, b) => b[1] - a[1])[0][0];
      copy[copy.lastIndexOf(top)] = k;
      quota.set(top, quota.get(top) - 1);
      n.set(top, n.get(top) - 1);
    }
    parked.push(...copy);
  }
  trafficFleet.__parkedKinds = parked;
  trafficFleet.__fleet24 = true;
  return { kinds, trafficFleet, install: (traffic, engine) => installFleet24(traffic, engine, kinds) };
}

// ---------------------------------------------------------------- rendering
const _pl = new Float32Array(24), _pl2 = new Float32Array(24);
const _fr = new THREE.Frustum(), _pv = new THREE.Matrix4();
function planesFrom(camera, out) {
  _pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  _fr.setFromProjectionMatrix(_pv);
  for (let i = 0; i < 6; i++) { const p = _fr.planes[i]; out[i * 4] = p.normal.x; out[i * 4 + 1] = p.normal.y; out[i * 4 + 2] = p.normal.z; out[i * 4 + 3] = p.constant; }
}

// RG32: a glass part's shadow caster: its upward-facing panes (both skins; the side windows let the sun in), each vertex
// pulled 3 cm toward the middle of the glass (the cabin), position only (the shadow pass draws the default depth material)
function glassCaster(g) {
  const P = g.attributes.position, I = g.index, cnt = I ? I.count : P.count;
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3());
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), t = new THREE.Vector3();
  const out = [];
  for (let k = 0; k < cnt; k += 3) {
    for (let j = 0; j < 3; j++) v[j].fromBufferAttribute(P, I ? I.getX(k + j) : k + j);
    e1.subVectors(v[1], v[0]); e2.subVectors(v[2], v[0]); e1.cross(e2);
    const l = e1.length();
    if (l < 1e-10 || Math.abs(e1.y / l) < 0.45) continue;
    for (const p of v) { t.subVectors(p, c); const d = t.length() || 1; out.push(p.x - (t.x / d) * 0.03, p.y - (t.y / d) * 0.03, p.z - (t.z / d) * 0.03); }
  }
  const G = new THREE.BufferGeometry();
  G.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  G.computeBoundingSphere();
  return G;
}

// one render set: every part of one LOD of one kind, sharing instance attributes
class RenderSet {
  constructor(scene, parts, name, shadow) {
    this.name = name;
    this.shadow = shadow;
    this.cap = 0;
    this.meshes = [];
    this.parts = shadow ? parts.filter((p) => p.cls === 'paint' || p.cls === 'detail' || p.cls === 'lampInner' || (RG32 && p.cls === 'glass'))
      .map((p) => (p.cls === 'glass' ? (p.caster ||= { ...p, geometry: glassCaster(p.geometry) }) : p)) : parts;
    this._alloc(32);
    for (const p of this.parts) {
      const g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(p.geometry.attributes)) g.setAttribute(k, a);
      g.setIndex(p.geometry.index);
      g.boundingSphere = p.geometry.boundingSphere;
      const m = new THREE.InstancedMesh(g, p.material, this.cap);
      m.instanceMatrix = this.im;
      g.setAttribute('aVeh', this.aVeh); g.setAttribute('aPaint', this.aPaint); g.setAttribute('aCol', this.aCol);
      m.name = `${shadow ? 'vehS' : 'veh'}:${name}:${p.cls}`;
      m.count = 0;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.castShadow = shadow;
      m.receiveShadow = !shadow;
      m.visible = false;
      m.userData.f24part = p;
      if (shadow) p.material.shadowSide = THREE.DoubleSide;   // see vehicleCull.js mkRender: a car is a closed shell
      scene.add(m);
      this.meshes.push(m);
    }
    this.k = 0;
  }
  _alloc(cap) {
    const grow = (old, size) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size);
      a.setUsage(THREE.DynamicDrawUsage);
      if (old) a.array.set(old.array.subarray(0, Math.min(old.array.length, a.array.length)));
      return a;
    };
    this.im = grow(this.im, 16);
    this.aVeh = grow(this.aVeh, 4);
    this.aPaint = grow(this.aPaint, 4);
    this.aCol = grow(this.aCol, 3);
    this.ic = this.ic ? grow(this.ic, 3) : null;
    this.cap = cap;
    for (const m of this.meshes || []) {
      m.instanceMatrix = this.im;
      m.geometry.setAttribute('aVeh', this.aVeh); m.geometry.setAttribute('aPaint', this.aPaint); m.geometry.setAttribute('aCol', this.aCol);
      if (m.instanceColor) m.instanceColor = this.ic;
    }
  }
  begin() { this.k = 0; }
  push(A, o, veh, paint, col, idCol) {
    if (this.k >= this.cap) this._alloc(this.cap * 2);
    const k = this.k++;
    this.im.array.set(A.subarray(o, o + 16), k * 16);
    this.aVeh.array.set(veh, k * 4);
    this.aPaint.array.set(paint, k * 4);
    this.aCol.array.set(col, k * 3);
    if (idCol) {
      if (!this.ic) { this.ic = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3).fill(1), 3); this.ic.setUsage(THREE.DynamicDrawUsage); }
      this.ic.array.set(idCol, k * 3);
    }
  }
  finish(idMode, idMat) {
    const k = this.k;
    for (const a of [this.im, this.aVeh, this.aPaint, this.aCol]) { a.clearUpdateRanges(); a.addUpdateRange(0, k * a.itemSize); a.needsUpdate = true; }
    if (idMode && this.ic) { this.ic.clearUpdateRanges(); this.ic.addUpdateRange(0, k * 3); this.ic.needsUpdate = true; }
    for (const m of this.meshes) {
      m.count = k;
      m.visible = !this.shadow && k > 0;
      // ground-truth mode (world/gt.js swapped the STORAGE material): every part draws the id material with the
      // storage instance colours; back to the part materials when it is restored
      if (idMode) { if (m.material !== idMat) m.material = idMat; if (m.instanceColor !== this.ic) m.instanceColor = this.ic; }
      else if (m.userData.__f24id) { m.material = m.userData.f24part.material; m.instanceColor = null; }
      m.userData.__f24id = idMode;
    }
  }
}

// per-slot motion state for a moving pool
class SlotState {
  constructor(cap) {
    const f = () => new Float32Array(cap);
    this.x = f(); this.z = f(); this.yaw = f(); this.spin = f(); this.v = f(); this.steer = f(); this.brake = f(); this.blinkL = f(); this.blinkR = f();
    this.rx = f(); this.rz = f();   // an articulated bus's rear axle (world x, z), towed by the turntable pivot
    this.ok = new Uint8Array(cap);
    this.cap = cap;
  }
}

function hash(a, b = 0) {
  let h = Math.imul((a | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return ((h >>> 0) % 10007) / 10007;
}

// paint from the storage colour (traffic.js fleetColor, stable per car / parked record) + a stable seed
const _c = new THREE.Color();
// NYC PAINT MIX (street counts of US registrations, skewed to the city's dark/neutral fleet): each entry is a LINEAR
// base colour and whether it is a metallic finish. The storage colour only seeds the pick (it is stable per car / per
// parked record), so the palette is the fleet's own, not traffic.js's placeholder one (whose bronze read as taxi gold).
const NYC_PAINTS = [
  [22, [0.73, 0.73, 0.72], 0], [4, [0.62, 0.62, 0.60], 0.25],                 // white solid / pearl
  [15, [0.010, 0.010, 0.011], 0], [7, [0.012, 0.013, 0.015], 0.3],            // black solid / metallic
  [12, [0.16, 0.165, 0.17], 0.35], [5, [0.07, 0.072, 0.075], 0.35],           // grey / dark grey metallic
  [13, [0.36, 0.37, 0.38], 0.35],                                              // silver
  [4, [0.030, 0.050, 0.110], 0.35], [3, [0.012, 0.022, 0.060], 0.3],          // blue / navy
  [5, [0.30, 0.018, 0.020], 0.2], [2, [0.13, 0.010, 0.012], 0.3],             // red / burgundy
  [2, [0.20, 0.17, 0.12], 0.35], [2, [0.030, 0.050, 0.035], 0.3],             // champagne / dark green
  [1, [0.40, 0.20, 0.035], 0.3],                                               // orange-brown (rare)
];
const PAINT_BAG = NYC_PAINTS.flatMap((p, i) => Array(p[0]).fill(i));
function paintFor(palette, r, g, b, seed, outCol, outPaint) {
  let metal = 0;
  if (palette === 'taxi') { outCol[0] = TAXI_YELLOW.r; outCol[1] = TAXI_YELLOW.g; outCol[2] = TAXI_YELLOW.b; }
  else if (palette === 'livery') { outCol[0] = outCol[1] = outCol[2] = 1; }
  else {
    const h = (Math.abs(Math.sin((r * 12.9898 + g * 78.233 + b * 37.719) * 43.1 + seed * 91.7)) * 43758.5453) % 1;
    let p = NYC_PAINTS[PAINT_BAG[Math.floor(h * PAINT_BAG.length)]];
    // vans and trucks run mostly white fleet paint; the Lincoln is the black-car service
    if ((palette === 'van' && seed < 0.62) || (palette === 'truck' && seed < 0.78)) p = NYC_PAINTS[0];
    else if (palette === 'black' && seed < 0.72) p = seed < 0.4 ? NYC_PAINTS[2] : NYC_PAINTS[3];
    outCol[0] = p[1][0]; outCol[1] = p[1][1]; outCol[2] = p[1][2];
    metal = p[2];
  }
  outPaint[0] = metal;
  outPaint[1] = palette === 'truck' || palette === 'van' ? 0.25 + 0.5 * ((seed * 7.31) % 1) : 0.05 + 0.45 * ((seed * 13.7) % 1) ** 2;   // grime
  outPaint[2] = metal > 0 ? 0.40 : 0.32;
  outPaint[3] = 0;
}

// ---------------------------------------------------------------- city reflection probe
// A clear coat or a window reflects the STREET, not an empty sky: the scene's own environment is a sun-free sky
// PMREM with nothing below the horizon, which turned every side panel into a mirror of bright sky. This probe
// renders the real surroundings (ground, buildings, trees, sky) into a small cube near the camera, ONE FACE PER
// FRAME so the cost is spread, PMREM-filters it when the sixth face lands, and hands it to the fleet materials.
// `?f24probe=0` falls back to scene.environment.
const RP37 = QS.get('rp37') !== '0';
class ReflectionProbe {
  constructor(engine, groundAt, size = 128, period = 1.2) {
    this.engine = engine;
    this.groundAt = groundAt;
    this.rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
    this.cam = new THREE.CubeCamera(0.3, 600, this.rt);
    this.pmrem = new THREE.PMREMGenerator(engine.renderer);
    this.env = null;          // PMREM render target currently in use
    this.face = -1;           // face being captured (-1 = idle)
    this.wait = 0.2;
    this.period = period;
    this.hide = [];           // meshes hidden during a face render (the fleet itself)
  }
  // street-level anchor under the camera: aerial views still get a street environment
  place() {
    const cam = this.engine.camera;
    const gy = this.groundAt ? this.groundAt(cam.position.x, cam.position.z) : null;
    const y = gy != null && Number.isFinite(gy) ? Math.min(cam.position.y, gy + 2.2) : cam.position.y;
    this.cam.position.set(cam.position.x, y, cam.position.z);
    this.cam.updateMatrixWorld(true);
  }
  renderFace(face, hideList) {
    const e = this.engine, r = e.renderer;
    const prevRT = r.getRenderTarget(), prevXr = r.xr.enabled, auto = r.shadowMap.autoUpdate;
    r.xr.enabled = false;
    r.shadowMap.autoUpdate = false;
    for (const m of hideList) { if (m.visible) { m.visible = false; this.hide.push(m); } }
    r.setRenderTarget(this.rt, face);
    r.render(e.scene, this.cam.children[face]);
    for (const m of this.hide) m.visible = true;
    this.hide.length = 0;
    r.setRenderTarget(prevRT);
    r.xr.enabled = prevXr;
    r.shadowMap.autoUpdate = auto;
  }
  filter() {
    this.captures = (this.captures || 0) + 1;   // QA37 events (main.js __REC_FRAME `f24`)
    const next = this.pmrem.fromCubemap(this.rt.texture);
    const old = this.env;
    this.env = next;
    if (old) old.dispose();
    return next.texture;
  }
  update(dt, hideList) {
    const e = this.engine;
    // RP37 (the Central Park explainer, 2026-10-03): while recording, a stepped frame that is drawn captures all six faces
    // and filters them at once, so the cars' reflections follow the lens frame by frame instead of stepping every 1.2 s
    // (36 frames); the accumulation samples (dt = 0) and the warm-up's undrawn steps keep the last. `?rp37=0` restores.
    if (RP37 && e.recordMode) {
      if (!(dt > 0) || e.skipDraw || e.holdDraw) return null;
      this.face = -1;
      this.place();
      for (let f = 0; f < 6; f++) this.renderFace(f, hideList);
      return this.filter();
    }
    if (this.face < 0) {
      this.wait -= dt;
      if (this.wait > 0) return null;
      this.place();
      this.face = 0;
    }
    this.renderFace(this.face, hideList);
    this.face++;
    if (this.face < 6) return null;
    this.face = -1;
    this.wait = this.period;
    return this.filter();
  }
}

export function installFleet24(traffic, engine, kinds) {
  const scene = engine.scene;
  const groups = [];   // { kind, K, P, moving, tag, sets: [main LOD0..2], shadow: [LOD1, LOD2], state }
  const add = (pools, moving) => {
    for (const [k, P] of Object.entries(pools || {})) {
      const K = kinds[k];
      if (!K || !P.mb) continue;
      const tag = `${moving ? 'm' : 'p'}:${k}`;
      const sets = K.lods.map((parts, li) => new RenderSet(scene, parts, `${tag}:lod${li}`, false));
      // shadow casters use the SAME LOD the car is drawn with: a coarser caster pokes through the drawn surface and
      // self-shadows it in speckles (seen on the 125th St plates, docs/notes/peds-veh-v2.md)
      const shadow = K.lods.map((parts, li) => new RenderSet(scene, parts, `${tag}:lod${li}`, true));
      // AR34: an articulated bus's rear body, its own sets (instance matrices towed about the pivot)
      const rsets = K.rear ? K.rear.lods.map((parts, li) => new RenderSet(scene, parts, `${tag}:rear${li}`, false)) : [];
      const rshadow = K.rear ? K.rear.lods.map((parts, li) => new RenderSet(scene, parts, `${tag}:rear${li}`, true)) : [];
      for (const s of [P.mb, P.md, ...(P.mx || []), P.shell]) if (s) { s.visible = false; s.castShadow = false; }
      const cells = moving && K.meta.signs && K.meta.signs.cells ? K.meta.signs.cells : null;
      groups.push({ kind: k, K, P, moving, tag, sets, shadow, rsets, rshadow, state: moving ? new SlotState(P.cap) : null, storeMat: P.mb.material, palette: KIND24[k]?.palette || 'car',
        cells, cell: cells ? new Float32Array(P.cap) : null });
    }
  };
  add(traffic.pools, true);
  add(traffic.parked, false);
  const _rm = () => { const o = []; for (const G of groups) for (const s2 of [...G.sets, ...G.shadow, ...G.rsets, ...G.rshadow]) o.push(...s2.meshes); return o; };
  // contact-shadow blobs (city/contactShadow.js csVehicles): pseudo-groups per LOD main set
  const csGroups = [];
  for (const G of groups) for (const s of G.sets) {
    const box = new THREE.BoxGeometry(G.K.size[0], G.K.size[1], G.K.size[2]).translate(0, G.K.size[1] / 2, 0);
    box.computeBoundingBox();
    csGroups.push({ srcs: [{ geometry: box }], main: [s.meshes[0] || { count: 0 }], lodMain: null, _set: s });
  }
  const camPos = new THREE.Vector3(1e9, 1e9, 1e9), camQ = new THREE.Quaternion();
  const sunT = new THREE.Vector3(1e9, 0, 1e9), sunD = new THREE.Vector3(), v = new THREE.Vector3();
  let shBoxV = -1;
  const stats = { main: 0, shadow: 0, ms: 0, lod: [0, 0, 0] };
  const veh = new Float32Array(4), paint = new Float32Array(4), col = new Float32Array(3), idc = new Float32Array(3);
  const RM = new Float32Array(16);   // an articulated bus's rear-body matrix
  let clock = 0;
  const allMats = new Set();
  for (const K of Object.values(kinds)) for (const parts of K.lods) for (const p of parts) allMats.add(p.material);
  let lastEnv;
  const probe = QS.get('f24probe') !== '0' ? new ReflectionProbe(engine, traffic.streamer?.surfaceAt ? (x, z) => traffic.streamer.surfaceAt(x, z) : null) : null;
  if (typeof window !== 'undefined') window.__F24PROBE = probe;
  const renderMeshes = _rm();
  const signGroups = {};
  for (const G of groups) if (G.cell) signGroups[G.kind] = G;
  const cull = (dt) => {
    const t0 = performance.now();
    // RECORD MODE renders many dt = 0 frames between fixed sim steps (settling, the re-render before each capture): the
    // world has not moved, so the motion state must HOLD. Treated as 16 ms with zero motion it decayed every car's speed
    // to 0 before the capture and lit every brake light in the film.
    const still = !(dt > 0);
    dt = still ? 0 : Math.min(0.1, Math.max(1e-3, dt));
    clock += dt;
    // own envMap on every fleet material (three substitutes scene.environmentIntensity for envMapIntensity
    // when a material falls back to scene.environment — 0.22 by day, which left the clear coat flat)
    const probed = probe ? probe.update(dt, renderMeshes) : null;
    const want = probed || (probe && probe.env ? probe.env.texture : scene.environment);
    if (want !== lastEnv) { lastEnv = want; for (const m of allMats) m.envMap = lastEnv || null; }
    F24ENV.value = scene.environmentIntensity ?? 1;
    const cam = engine.camera;
    cam.updateMatrixWorld();
    if (cam.position.distanceToSquared(camPos) > 0.25 || 1 - Math.abs(cam.quaternion.dot(camQ)) > 2e-5) {
      camPos.copy(cam.position); camQ.copy(cam.quaternion); planesFrom(cam, _pl);
    }
    const sun = engine.sun;
    let shadowOn = false;
    if (sun && sun.castShadow) {
      shadowOn = true;
      sun.updateMatrixWorld(); sun.target.updateMatrixWorld();
      v.subVectors(sun.position, sun.target.position).normalize();
      const bv = engine.shadowBoxV || 0;
      if (sun.target.position.distanceToSquared(sunT) > 64 || v.dot(sunD) < 0.99995 || bv !== shBoxV) {
        shBoxV = bv; sunT.copy(sun.target.position); sunD.copy(v);
        sun.shadow.updateMatrices(sun);
        planesFrom(sun.shadow.camera, _pl2);
      }
    }
    const night = ENV.night.value;
    const cx = cam.position.x, cz = cam.position.z, cy = cam.position.y;
    let afx = 0, afz = 0;
    if (VAHEAD > 0) { const e = cam.matrixWorld.elements, l = Math.hypot(e[8], e[10]) || 1; afx = -e[8] / l; afz = -e[10] / l; }
    // AR34: each route bus's sign cell, from its route and its direction of travel (extras signs.cells: BUSES 23:57)
    for (const G of groups) if (G.cell) G.cell.fill(0);
    for (const c of traffic.cars) {
      if (!c.route || !c._pose) continue;
      const G = signGroups[c.kind];
      if (!G || c.idx >= G.cell.length) continue;
      G.cell[c.idx] = G.cells[c.route + ' ' + (Math.sin(c._pose[3]) >= 0 ? 'E' : 'W')] ?? 0;
    }
    let nMain = 0, nSh = 0;
    stats.lod[0] = stats.lod[1] = stats.lod[2] = 0;
    for (const G of groups) {
      const P = G.P, src = P.mb;
      const idMode = src.material !== G.storeMat;
      const idMat = idMode ? src.material : null;
      const n = src.count, A = src.instanceMatrix.array, C = src.instanceColor ? src.instanceColor.array : null;
      const S = G.state, K = G.K, hubR = K.meta.hubs?.[0]?.r || 0.34, wb = K.meta.wheelbase || 2.8;
      for (const s of G.sets) s.begin();
      for (const s of G.shadow) s.begin();
      for (const s of G.rsets) s.begin();
      for (const s of G.rshadow) s.begin();
      const R = K.rear;
      const rMain = K.radius + PAD_MAIN, rSh = K.radius + PAD_SHADOW;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        if (A[o] === 0 && A[o + 5] === 0 && A[o + 10] === 0) continue;
        const x = A[o + 12], y = A[o + 13], z = A[o + 14];
        if (VAHEAD > 0) {
          // the view line's lane: along the camera's horizontal forward, 1.6 m either side, from the lens to VAHEAD m
          const ex = x - cx, ez = z - cz, al = ex * afx + ez * afz, lat = Math.abs(ex * afz - ez * afx);
          const r = Math.max(K.size[0], K.size[2]) / 2;
          if (al > -r && al < VAHEAD + r && lat < 1.6 + K.size[0] / 2 && cy < y + K.size[1] + 2) continue;
        }
        if (VCLEAR > 0) {
          const ex = x - cx, ez = z - cz;
          if (Math.abs(ex) < 14 && Math.abs(ez) < 14 && cy < y + K.size[1] + VCLEAR) {
            const fl = Math.hypot(A[o + 8], A[o + 10]) || 1, fx = A[o + 8] / fl, fz = A[o + 10] / fl;
            if (Math.abs(ex * fz - ez * fx) < K.size[0] / 2 + VCLEAR && Math.abs(ex * fx + ez * fz) < K.size[2] / 2 + VCLEAR) continue;
          }
        }
        // motion state (moving pools): spin from distance, steer from yaw rate, brake from deceleration / standstill
        let lampMask = 0, art = 0;
        // ==== R1D (CORE, docs/notes/arch-r1-d.md): ?replay (src/replay/coreReplay.js) gives a moving pool the take's own seed
        // per vehicle (P.r1d); without it the slot's hash, as before
        const r1d = G.P.r1d && G.P.r1d.on[i] ? G.P.r1d : null;
        const seed = r1d ? r1d.seed[i] : G.moving ? hash(i, G.kind.length * 131 + 7) : hash(Math.round(x * 10), Math.round(z * 10));
        // ==== R1D end
        if (S && i < S.cap) {
          const yaw = Math.atan2(A[o + 8], A[o + 10]);
          if (still && S.ok[i]) { /* dt = 0 frame: keep spin / steer / brake / blinkers exactly as they were */ }
          else if (S.ok[i]) {
            const d = Math.hypot(x - S.x[i], z - S.z[i]);
            if (d > 4) { S.ok[i] = 0; }
            else {
              S.spin[i] = (S.spin[i] + d / hubR) % (Math.PI * 2);
              const vNow = d / dt;
              const acc = (vNow - S.v[i]) / dt;
              S.v[i] += (vNow - S.v[i]) * Math.min(1, dt * 6);
              let dy = yaw - S.yaw[i];
              if (dy > Math.PI) dy -= Math.PI * 2; else if (dy < -Math.PI) dy += Math.PI * 2;
              const target = S.v[i] > 0.5 ? Math.max(-0.6, Math.min(0.6, Math.atan(wb * (dy / dt) / S.v[i]))) : S.steer[i];
              S.steer[i] += (target - S.steer[i]) * Math.min(1, dt * 5);
              S.brake[i] = acc < -1.4 || S.v[i] < 0.4 ? 0.5 : Math.max(0, S.brake[i] - dt);
              if (S.steer[i] > 0.12) S.blinkL[i] = 1.2; else S.blinkL[i] = Math.max(0, S.blinkL[i] - dt);
              if (S.steer[i] < -0.12) S.blinkR[i] = 1.2; else S.blinkR[i] = Math.max(0, S.blinkR[i] - dt);
            }
          }
          let fresh = false;
          if (!S.ok[i]) { S.ok[i] = 1; S.v[i] = 0; S.steer[i] = 0; S.brake[i] = 0; S.blinkL[i] = S.blinkR[i] = 0; S.spin[i] = seed * 6.28; fresh = true; }
          S.x[i] = x; S.z[i] = z; S.yaw[i] = yaw;
          if (R) {
            // the rear axle is towed by the pivot like a trailer's (pulled along, never pushed); the articulation angle is
            // its heading against the front body's, at most 0.75 rad (~43 deg)
            const fl = Math.hypot(A[o + 8], A[o + 10]) || 1, fx = A[o + 8] / fl, fz = A[o + 10] / fl;
            const hx = x + fx * R.pivot[2], hz = z + fz * R.pivot[2];
            if (fresh) { S.rx[i] = hx - fx * R.tow; S.rz[i] = hz - fz * R.tow; }
            else if (!still) {
              const ddx = hx - S.rx[i], ddz = hz - S.rz[i], dd = Math.hypot(ddx, ddz);
              if (dd > 1e-6) { S.rx[i] = hx - (ddx / dd) * R.tow; S.rz[i] = hz - (ddz / dd) * R.tow; }
            }
            let da = Math.atan2(hx - S.rx[i], hz - S.rz[i]) - yaw;
            da -= Math.round(da / (Math.PI * 2)) * Math.PI * 2;
            art = Math.max(-0.75, Math.min(0.75, da));
            if (Math.abs(da) > 0.75) { S.rx[i] = hx - Math.sin(yaw + art) * R.tow; S.rz[i] = hz - Math.cos(yaw + art) * R.tow; }
          }
          if (night > 0.35) lampMask |= L_HEAD | L_TAIL;
          if (S.brake[i] > 0) lampMask |= L_BRAKE;
          if (S.blinkL[i] > 0) lampMask |= L_BLINKL;
          if (S.blinkR[i] > 0) lampMask |= L_BLINKR;
          if ((G.kind === 'police' || G.kind === 'nypd' || G.kind === 'ambulance' || G.kind === 'firetruck') && seed < 0.18) lampMask |= L_SIREN;
          veh[0] = S.spin[i]; veh[1] = S.steer[i];
        } else { veh[0] = seed * 6.28; veh[1] = 0; }
        veh[2] = lampMask; veh[3] = seed;
        // ==== R1D (CORE): ?replay: the take's wheel spin, steering, lamps and articulation for this vehicle
        if (r1d) { veh[0] = r1d.spin[i]; veh[1] = r1d.steer[i]; veh[2] = r1d.lamps[i]; if (R) art = Math.max(-0.75, Math.min(0.75, r1d.bend[i])); }
        // ==== R1D end
        const r = C ? C[i * 3] : 0.5, g = C ? C[i * 3 + 1] : 0.5, b = C ? C[i * 3 + 2] : 0.5;
        paintFor(G.palette, r, g, b, seed, col, paint);
        if (R && ART_FORCE !== null) art = Math.max(-0.75, Math.min(0.75, ART_FORCE));
        paint[3] = (G.cell && i < G.cell.length ? G.cell[i] * 8 : 0) + art + 2;   // sign cell * 8 + the bellows' bend + 2 (patch)
        if (idMode) { idc[0] = r; idc[1] = g; idc[2] = b; }
        if (R) {
          // rear body = front matrix x T(pivot) Ry(art) T(-pivot)
          const c = Math.cos(art), sn = Math.sin(art), pz = R.pivot[2], px = R.pivot[0];
          for (let q = 0; q < 3; q++) {
            const c0 = A[o + q], c2 = A[o + 8 + q];
            RM[q] = c * c0 - sn * c2; RM[4 + q] = A[o + 4 + q]; RM[8 + q] = sn * c0 + c * c2;
            RM[12 + q] = A[o + 12 + q] + c0 * (px - c * px - sn * pz) + c2 * (pz + sn * px - c * pz);
          }
          RM[3] = RM[7] = RM[11] = 0; RM[15] = 1;
        }
        const dx = x - cx, dz = z - cz, d2 = dx * dx + dz * dz;
        // main view
        let inMain = true;
        for (let q = 0; q < 24; q += 4) if (_pl[q] * x + _pl[q + 1] * y + _pl[q + 2] * z + _pl[q + 3] < -rMain) { inMain = false; break; }
        if (inMain) {
          const li = d2 < LOD0_2 ? 0 : d2 < LOD1_2 ? 1 : 2;
          G.sets[li].push(A, o, veh, paint, col, idMode ? idc : null);
          if (R) G.rsets[li].push(RM, 0, veh, paint, col, idMode ? idc : null);
          stats.lod[li]++;
          nMain++;
        }
        if (shadowOn) {
          let inSh = true;
          for (let q = 0; q < 24; q += 4) if (_pl2[q] * x + _pl2[q + 1] * y + _pl2[q + 2] * z + _pl2[q + 3] < -rSh) { inSh = false; break; }
          if (inSh && sweepOut(x, y, z, K.radius + 1)) inSh = false;   // SV29: its shadow cannot reach the view
          if (inSh) {
            const ls = d2 < LOD0_2 ? 0 : d2 < LOD1_2 ? 1 : 2;
            G.shadow[ls].push(A, o, veh, paint, col, null);
            if (R) G.rshadow[ls].push(RM, 0, veh, paint, col, null);
            nSh++;
          }
        }
      }
      for (const s of G.sets) s.finish(idMode, idMat);
      for (const s of G.shadow) s.finish(false, null);
      for (const s of G.rsets) s.finish(idMode, idMat);
      for (const s of G.rshadow) s.finish(false, null);
    }
    for (const cg of csGroups) cg.main[0] = cg._set.meshes[0] || { count: 0 };
    csVehicles(scene, csGroups);
    stats.main = nMain; stats.shadow = nSh; stats.ms = performance.now() - t0;
  };
  const orig = traffic.update.bind(traffic);
  traffic.update = (dt, px, pz) => { orig(dt, px, pz); cull(dt); };
  const shadowMeshes = [];
  for (const G of groups) for (const s of [...G.shadow, ...G.rshadow]) shadowMeshes.push(...s.meshes);
  engine.addShadowListener?.((phase) => {
    if (phase === 'nearBegin') { const on = Instancer.shadowSets; for (const m of shadowMeshes) m.visible = on && m.count > 0; }
    else if (phase === 'nearEnd') { for (const m of shadowMeshes) m.visible = false; }
  });
  traffic.cullStats = stats;
  traffic.fleet24 = { kinds, groups, stats };
  // perception: per-kind nominal dims for segRender / gt boxes
  traffic.vehDims = Object.fromEntries(Object.entries(kinds).map(([k, K]) => [k, [+K.size[0].toFixed(2), +K.size[1].toFixed(2), +K.size[2].toFixed(2)]]));
  return stats;
}
