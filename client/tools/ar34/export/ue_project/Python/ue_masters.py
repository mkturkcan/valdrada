# UE (AR34, 2026-10-06): the master materials of the BoundlessUE project, built from code into /Game/Bx/ (generated
# content, never committed). One master per `bx` family of usd_mat.py, mirroring blender_nodes.py's node groups at a
# smaller scale: each is a Custom HLSL node fed by parameters, the world position and normal and the UV sets ue_prep.py
# packs (UV0 st, UV1-3 the per-vertex data). The web's world frame (metres, y up) is rebuilt from UE's (cm, z up: the
# USD importer swaps y and z) and the take's recentring origin (parameter Origin).
#   M_bx_pbr     pbrLib makeSurface: wall / ground world mapping or the uv frame, pattern rotation and size, two taps
#                against tiling, the tint ratio x the kit's tint (aFkTr) or the vertex colour (bxCol), the facade value
#                curve, the trims, ORM roughness / metalness / AO, the normal map in the same frame, dirt by height
#   M_bx_plain   a kit or prop colour x aFkTr / bxCol x its trim (also `untrim`)
#   M_bx_vk      the viaducts' steel: two paints, rust by the arrises' noise and the splash zone, soot, roughness
#   M_bx_ground  GP31 reduced: asphalt (two scans, the pour lottery), sidewalk flags, granite kerb, thermoplastic paint,
#                grass, by the surface kind (matId)
#   M_bx_decal   decals.js atlas: alpha-blended albedo
#   M_bx_sign    signs: albedo, the mask, the night glow
#   M_bx_lens    lamp lenses and other emitters: emissive colour x strength
#   M_bx_facade  WIN's facade bake (bxw_<shot>_fac*): the albedo atlas, roughness and glass from the data atlas, the rooms'
#                emission decoded (the atlas stores sqrt(emission / 8)) x the night's level
#   M_bx_data    the data pass (Movie Render Queue's extra post-process material): region and depth, 32-bit
#   M_bx_leaf    the tree set's leaf cards and impostors: two-sided foliage, alpha-tested at 0.5, the card's normal map
#   M_bx_paint   the cars' paint: the fleet's per-car colour as custom primitive data 0-2 (set from ue_prep's moving)
#   M_bx_hidden  the writers' hide mask (usd_mat / usd_windows 'hidden': opacity 0 at threshold 0.5): clipped everywhere, no shadow
#   M_bx_film    the web's film look in place of UE's tonemapper: three.js r185 AgX at the page's exposure, the sRGB encoding,
#                the grade (levels, S-curve contrast, highlight shoulder, warmth, green tint, saturation, shadow lift, vignette)
import os, struct, unreal

ROOT = '/Game/Bx'
mel = unreal.MaterialEditingLibrary
eal = unreal.EditorAssetLibrary
VERSION = 64         # bump to rebuild the masters (37-39: R8, ground6's matId 18 tried and withdrawn; 40-42: R9-FAC, R9-TSQ; 43: UELOOK10, the facade's rooms, water, veil, person, bronze; 44: UELOOK10, the night rooms fitted to the web's aerials; 45: MESH11, displacement; 46: MESH11, displacement through the attributes; 47: MESH11, the facade's windows inset; 48: MESH11, relief by the lens' distance, the walls' relief; 49: MESH11, the opening closed over its bars; 50: MESH11, a two-sided facade master tried; 51: MESH11, withdrawn; 52: MESH11, the inset to 30 m and the parallax past it, fades matched; 53: MESH11, the facade's derivatives on Nanite; 54: AAA11, the layered weathering; 55: MESH11, near the real opening replaces the painted one; 56: MESH11, its sides keep the bake's texels; 57: AAA11, the layers made to read at the trailer's framing; 58: UE13, the other masters' derivatives on Nanite; 59: UE13, the room pictures held on Nanite; 60: UE13, a facade normal test aid; 61: LOOK13, Bryant Park's lawn, walks and terrace, the flags' lottery; 62: UE13, pale walls keep their plaster; 63: LOOK13, the lawn's mowing passes cut to a trace; 64: LOOK13d, the pools' landing foam)

NOISE = r'''
struct BXN {
  float h1(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float vn(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(h1(i), h1(i + float2(1, 0)), f.x), lerp(h1(i + float2(0, 1)), h1(i + float2(1, 1)), f.x), f.y); }
  float fbm(float2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.01 + 3.3) + 0.125 * vn(p * 8.13 + 1.7); }
};
BXN n;
float3 P = float3(WP.x * 0.01 + Origin.x, WP.z * 0.01, WP.y * 0.01 + Origin.z);
float3 N = normalize(float3(NW.x, NW.z, NW.y));
'''

PBR = NOISE + r'''
float2 m; float3 T3 = float3(1, 0, 0), B3 = float3(0, 0, 1); bool wm = World > 0.5;
if (wm) {
  if (abs(N.y) > 0.7) { m = P.xz; T3 = float3(1, 0, 0); B3 = float3(0, 0, -1); }
  else { float2 h = normalize(float2(-N.z, N.x) + 1e-5); m = float2(dot(P.xz, h), P.y); T3 = float3(h.x, 0, h.y); B3 = float3(0, 1, 0); }
} else { m = float2(UV0.x, -UV0.y); }
// (Blender samples (x, -y) bottom-up; UE's textures run top-down, so the same texel is at (x, y))
float2 st = float2((m.x * Rot.x + m.y * Rot.z) / max(Size.x, 1e-3), (m.x * Rot.y + m.y * Rot.w) / max(Size.y, 1e-3));
// two taps against tiling: offsets per low-frequency cell (snapped to the pattern unit), blended by a soft noise
float2 c = st * 0.21 + Seed * 0.0137;
float2 ca = floor(c), cb = floor(c + 0.5);
float2 oa = float2(n.h1(ca + 3.7), n.h1(ca + 9.1)), ob = float2(n.h1(cb + 5.3), n.h1(cb + 1.9));
if (Unit.x > 0) { oa = floor(oa / Unit.xy) * Unit.xy; ob = floor(ob / Unit.xy) * Unit.xy; }
float2 sa = st + oa * 7.0, sb = st + ob * 7.0;
float4 a0 = Texture2DSample(Alb, AlbSampler, sa), a1 = Texture2DSample(Alb, AlbSampler, sb);
float4 o0a = Texture2DSample(Orm, OrmSampler, sa), o1a = Texture2DSample(Orm, OrmSampler, sb);
float3 o0 = o0a.rgb, o1 = o1a.rgb;
float w = smoothstep(Bl.x, Bl.y, n.vn(c * 2.3 + 11.0) + (o1.r - o0.r) * Bl.z);
float3 A = lerp(a0.rgb, a1.rgb, w), O = lerp(o0, o1, w);
float Oa = lerp(o0a.a, o1a.a, w);   // the set's paint mask (pbrLib: the ORM's alpha)
float3 tn = lerp(Texture2DSample(Nrm, NrmSampler, sa).rgb, Texture2DSample(Nrm, NrmSampler, sb).rgb, w) * 2.0 - 1.0;
tn.xy *= NrmK;
// R3-HQ: a detail normal (the set's own normal at 4.3x its frequency)
if (DetK > 0.0) { float3 td = Texture2DSample(Nrm, NrmSampler, sa * 4.3 + 0.37).rgb * 2.0 - 1.0; tn.xy += td.xy * DetK; }
float3 tint = Ratio.xyz;
if (FkOn > 0.5 || VcOn > 0.5) tint *= max(float3(UV1.x, UV1.y, UV2.x), 0.0);
float3 alb = A * tint;
// R4-PAINT: a painted set (pbrLib's paint family, blender_nodes lib_pbr_surf): the paint is the tint over the scan's
// luminance, pulled toward the set's reference lightness, the scan showing through the chips (the ORM's alpha x Chips),
// the scan's own colour taken off under the paint (SubK); not the scan's colour x the tint (metal_painted's green)
if (PaintOn > 0.5) {
  float pm = 1.0 - (1.0 - Oa) * Chips;
  float la = dot(A, float3(0.2126, 0.7152, 0.0722));
  float3 pc = tint * la * lerp(RefL / max(la, 0.001), 1.0, 0.55);
  float3 sub = lerp(A, max(A - Scan.xyz * (la / max(Scan.w, 0.001)) * Oa, 0.0), SubK);
  alb = lerp(sub, pc, pm);
}
if (WallK > 0) alb = pow(max(alb, 0.0), 1.22) * 0.88 * WallK;
// dirt: the splash zone and the run-off above the street, soot under the roof line (kit pieces carry their own dirt and roof)
float dirt = (FkOn > 0.5 && UV3.x >= 0.0 && UV3.y > 0.0) ? UV3.x : Dirt;
float topY = (FkOn > 0.5 && UV3.y > 0.0) ? UV3.y : TopY;
float hgt = P.y - BaseY;
float splash = (1.0 - smoothstep(0.0, 1.2, hgt)) * 0.35 * dirt;
float streak = n.fbm(float2(dot(P.xz, float2(0.71, 0.71)) * 2.2, P.y * 0.15)) * 0.25 * dirt;
float soot = (1.0 - smoothstep(0.0, 2.5, topY - P.y)) * 0.3 * dirt;
float grime = (FkOn > 0.5) ? saturate(UV2.y) * 0.4 : 0.0;
alb *= saturate(1.0 - splash - streak * (1.0 - smoothstep(0.0, 25.0, hgt)) - soot - grime) * TrimV.xyz;
// R3-HQ: a macro tone (15 m and 4 m) and the scan's cavities as grime
alb *= lerp(1.0 - MacroK, 1.0 + MacroK, n.fbm(P.xz * 0.065 + P.y * 0.045 + Seed)) * lerp(1.0, O.r, CavK);
// the street sets' blotches
if (Street > 0.5) alb *= lerp(0.88, 1.08, n.fbm(P.xz * 0.35));
Rough = saturate(O.g * RoughK);
Metal = (MetalOn > 0.5) ? MetalV : saturate(O.b);
AO = lerp(1.0, O.r, 0.7);
float3 nw;
if (wm) nw = normalize(T3 * tn.x + B3 * tn.y + N * max(tn.z, 0.05));
else { float3 tnd = float3(tn.x, -tn.y, tn.z); float3 nu = normalize(mul(tnd, Parameters.TangentToWorld)); nw = float3(nu.x, nu.z, nu.y); }
NormalOut = normalize(float3(nw.x, nw.z, nw.y));
return max(alb, 0.0);
'''

PLAIN = r'''
// the texture's UsdTransform2d (Xf: scale xy, translation zw; XfR: cos, sin of its rotation) on the USD's st (UE flipped V)
float2 s0 = float2(UV0.x, 1.0 - UV0.y) * Xf.xy;
s0 = float2(s0.x * XfR.x - s0.y * XfR.y, s0.x * XfR.y + s0.y * XfR.x) + Xf.zw;
float2 tuv = float2(s0.x, 1.0 - s0.y);
float3 c = Color.xyz;
if (FkOn > 0.5 || VcOn > 0.5) c *= max(float3(UV1.x, UV1.y, UV2.x), 0.0);
if (HasTex > 0.5) c *= Texture2DSample(Tex, TexSampler, tuv).rgb;
Glow = EmiC.xyz * EmiK * ((HasEmiTex > 0.5) ? Texture2DSample(EmiTex, EmiTexSampler, tuv).rgb : float3(1, 1, 1));
// the window kit's self-lit surfaces (bxwin roles): the base colour itself as emission (a room's unlit fill, the sheers'
// day / night glow), untrimmed, and the base's own share (0 for the unlit fill)
Glow += max(c, 0.0) * SelfK;
return max(c * Gain.xyz * BaseK, 0.0);
'''

PAINT = r'''
// R3-PAINT: the fleet's paint as fleet24.js draws it (a MeshPhysicalMaterial with a clear coat): the car's own colour,
// metalness, road-film dirt and roughness (custom primitive data 0-5, ue_mat.paint), its livery map (the USD's texture
// and transform), the film rising toward the sills and arches, streaked, never in blotches; the clear coat (see below)
float4 d0 = GetPrimitiveData(Parameters).CustomPrimitiveData[0];   // colour (linear), metalness
float4 d1 = GetPrimitiveData(Parameters).CustomPrimitiveData[1];   // dirt, roughness, seed, the kind's height (m)
float3 p = (d0.x + d0.y + d0.z > 0.0) ? d0.xyz : Color.xyz;
float2 s0 = float2(UV0.x, 1.0 - UV0.y) * Xf.xy;
s0 = float2(s0.x * XfR.x - s0.y * XfR.y, s0.x * XfR.y + s0.y * XfR.x) + Xf.zw;
if (HasTex > 0.5) p *= Texture2DSample(Tex, TexSampler, float2(s0.x, 1.0 - s0.y)).rgb;
float3 lp = LP * 0.01;   // the part's local position, metres, z up
float hy = lp.z / max(d1.w, 0.5);
float2 q = float2(lp.x * 1.7 + lp.y * 1.7, lp.z * 11.0) + d1.z * 37.0;
float2 qi = floor(q), qf = frac(q); qf = qf * qf * (3.0 - 2.0 * qf);
float4 hh = frac(sin(float4(dot(qi, float2(127.1, 311.7)), dot(qi + float2(1, 0), float2(127.1, 311.7)), dot(qi + float2(0, 1), float2(127.1, 311.7)), dot(qi + float2(1, 1), float2(127.1, 311.7)))) * 43758.55);
float nn = 0.65 + 0.35 * lerp(lerp(hh.x, hh.y, qf.x), lerp(hh.z, hh.w, qf.x), qf.y);
float rise = pow(1.0 - smoothstep(0.02, 0.5, hy), 1.6);
float film = d1.x * rise;
float3 grime = float3(0.30, 0.28, 0.25) * dot(p, float3(0.3333, 0.3333, 0.3333)) + float3(0.045, 0.040, 0.034);
p = lerp(p, grime, clamp(film * nn, 0.0, 0.7));
Rough = lerp(d1.y > 0.0 ? d1.y : RoughK, 0.7, clamp(film, 0.0, 0.8));
Metal = saturate(d0.w);
// R4-PAINT: the clear coat and its roughness (fleet24: 1 / 0.035, buses 0.6 / 0.12) through Make Material Attributes (the
// shading model's own Custom Data pins are hidden from Python)
CC = CcK; CCR = CcR;
return max(p * Gain.xyz, 0.0);
'''

VK = NOISE + r'''
float hgt = P.y - Ground;
float2 q = float2(dot(P.xz, float2(0.6, 0.8)), P.y);
float patch = smoothstep(0.45, 0.6, n.fbm(q * 0.35 + Seed));
float3 paint = lerp(Paint.xyz, Paint2.xyz, patch);
float r = n.fbm(q * 1.7 + 3.0 + Seed) * 0.6 + n.fbm(q * 9.0 + 1.0) * 0.4;
float rust = smoothstep(1.0 - RustAmt * 0.8, 1.0 - RustAmt * 0.8 + 0.18, r);
rust = max(rust, (1.0 - smoothstep(0.0, 1.5, hgt)) * RustAmt);
float3 rc = lerp(RustC.xyz, RustD.xyz, n.vn(q * 4.0));
float3 alb = lerp(paint, rc, rust);
// R3-HQ: painted steel and rust from the CC0 sets (ue_families.json hq.vk) at their real size, world-planar, as detail over
// the paint's and the rust's colours, their normals and roughness, the cavities as grime
float3 Tv = float3(1, 0, 0), Bv = float3(0, 0, -1); float2 sv = P.xz;
if (abs(N.y) < 0.7) { float2 hv = normalize(float2(-N.z, N.x) + 1e-5); sv = float2(dot(P.xz, hv), P.y); Tv = float3(hv.x, 0, hv.y); Bv = float3(0, -1, 0); }
float3 hqNv = float3(0, 0, 1); float hqRv = -1.0;
if (HqOn > 0.5) {
float2 sP = sv / HSz.x;
float2 cP = sP * 0.2; float2 cPa = floor(cP), cPb = floor(cP + 0.5);
float2 sP1 = sP + floor(float2(n.h1(cPa + 3.7), n.h1(cPa + 9.1)) * 7.0 / 0.001) * 0.001, sP2 = sP + floor(float2(n.h1(cPb + 5.3), n.h1(cPb + 1.9)) * 7.0 / 0.001) * 0.001;
float wP = smoothstep(0.3, 0.7, n.vn(cP * 2.3 + 11.0));
float3 Pa = lerp(Texture2DSample(HP, HPSampler, sP1).rgb, Texture2DSample(HP, HPSampler, sP2).rgb, wP) / max(HPm.xyz, 0.001);
float3 Pn = lerp(Texture2DSample(HPN, HPNSampler, sP1).rgb, Texture2DSample(HPN, HPNSampler, sP2).rgb, wP) * 2.0 - 1.0;
float3 Pr = lerp(Texture2DSample(HPR, HPRSampler, sP1).rgb, Texture2DSample(HPR, HPRSampler, sP2).rgb, wP);
float2 sR = sv / HSz.y;
float2 cR = sR * 0.2; float2 cRa = floor(cR), cRb = floor(cR + 0.5);
float2 sR1 = sR + floor(float2(n.h1(cRa + 3.7), n.h1(cRa + 9.1)) * 7.0 / 0.001) * 0.001, sR2 = sR + floor(float2(n.h1(cRb + 5.3), n.h1(cRb + 1.9)) * 7.0 / 0.001) * 0.001;
float wR = smoothstep(0.3, 0.7, n.vn(cR * 2.3 + 11.0));
float3 Ra = lerp(Texture2DSample(HR, HRSampler, sR1).rgb, Texture2DSample(HR, HRSampler, sR2).rgb, wR) / max(HRm.xyz, 0.001);
float3 Rn = lerp(Texture2DSample(HRN, HRNSampler, sR1).rgb, Texture2DSample(HRN, HRNSampler, sR2).rgb, wR) * 2.0 - 1.0;
float3 Rr = lerp(Texture2DSample(HRR, HRRSampler, sR1).rgb, Texture2DSample(HRR, HRRSampler, sR2).rgb, wR);
alb = lerp(paint * Pa, rc * Ra, rust) * lerp(1.0, lerp(Pr.r, Rr.r, rust), CavK) * lerp(1.0 - MacroK, 1.0 + MacroK, n.fbm(q * 0.11 + 5.0));
hqNv = lerp(Pn, Rn, rust); hqRv = lerp(Pr.g, Rr.g, rust);
}
float guano = smoothstep(0.82, 0.9, n.fbm(P.xz * 2.1 + 5.0)) * Guano * step(0.5, N.y);
alb = lerp(alb, float3(0.55, 0.53, 0.48), guano);
alb *= 1.0 - (1.0 - smoothstep(0.0, 4.0, hgt)) * 0.2;
Rough = (hqRv >= 0.0) ? saturate(hqRv) : lerp(0.55, 0.85, rust);
Metal = lerp(0.04, 0.0, rust);
float3 nwv = normalize(Tv * hqNv.x * NrmK + Bv * hqNv.y * NrmK + N * max(hqNv.z, 0.05));
NormalOut = normalize(float3(nwv.x, nwv.z, nwv.y));
return max(alb * Gain.xyz, 0.0);
'''

GROUND = NOISE + r'''
float k = UV1.x;
float isA = (abs(k - 0) < 0.5 || abs(k - 11) < 0.5 || abs(k - 12) < 0.5) ? 1 : 0;
float isW = (abs(k - 1) < 0.5 || abs(k - 16) < 0.5 || abs(k - 17) < 0.5) ? 1 : 0;
float isK = abs(k - 2) < 0.5 ? 1 : 0;
float isPW = abs(k - 3) < 0.5 ? 1 : 0, isPY = abs(k - 4) < 0.5 ? 1 : 0;
float isG = (abs(k - 5) < 0.5 || abs(k - 15) < 0.5) ? 1 : 0;
float2 g = float2(P.x * 0.8744 + P.z * 0.4853, P.x * -0.4853 + P.z * 0.8744);
// asphalt: young and weathered scans relative to their means, the pour lottery per block face
float2 lot = floor(float2(g.x / 82.0, g.y / 76.0) + n.fbm(g * 0.013) * 0.075);
float young = step(0.55, n.h1(lot + 4.1));
float2 ga = g * 0.5, gb = float2(g.x * 0.5 * 0.966 - g.y * 0.5 * 0.259, g.x * 0.5 * 0.259 + g.y * 0.5 * 0.966) + 17.3;
float wab = smoothstep(0.3, 0.7, n.vn(g * 0.11));
float3 A0 = lerp(Texture2DSample(G0, G0Sampler, ga).rgb, Texture2DSample(G0, G0Sampler, gb).rgb, wab) / float3(0.1991, 0.1991, 0.1990);
float3 A1 = lerp(Texture2DSample(G1, G1Sampler, ga).rgb, Texture2DSample(G1, G1Sampler, gb).rgb, wab) / float3(0.0591, 0.0478, 0.0384);
float3 asph = AsphC.xyz * lerp(A0, A1, young) * lerp(0.9, 1.1, n.fbm(g * 0.05));
// sidewalk flags: per-flag tone, tooled joints
float2 fq = g / 1.52; float2 fid = floor(fq); float2 ff = frac(fq);
float joint = 1.0 - (1.0 - smoothstep(0.0, 0.012, min(min(ff.x, 1 - ff.x), min(ff.y, 1 - ff.y)))) * 0.6;
float3 C2 = Texture2DSample(G2, G2Sampler, fq / 2.0 + float2(n.h1(fid + 1.7), n.h1(fid + 9.2))).rgb / float3(0.3635, 0.3154, 0.2443);
float3 walk = WalkC.xyz * C2 * joint * lerp(0.86, 1.12, n.h1(fid + 3.3));
// kerb: granite along the kerb (the face's own frame)
float2 kt = normalize(float2(-N.z, N.x) + 1e-5);
float3 C4 = Texture2DSample(G4, G4Sampler, float2(dot(P.xz, kt), P.y) / 2.17).rgb / float3(0.3848, 0.3062, 0.1717);
float3 kerb = KerbC.xyz * C4;
// R3-HQ: the CC0 sets at their real size (ue_families.json hq: the asphalt, the flags' concrete, the kerbs' granite) as detail
// over the same colours (each set over its own mean), two taps against tiling, their normals and roughness, a macro tone
// and the scans' cavities as grime
float3 hqN = float3(0, 0, 1); float hqRough = -1.0;
if (HqOn > 0.5) {
float2 sA = g / HSz.x;
float2 cA = sA * 0.2; float2 cAa = floor(cA), cAb = floor(cA + 0.5);
float2 sA1 = sA + floor(float2(n.h1(cAa + 3.7), n.h1(cAa + 9.1)) * 7.0 / 0.001) * 0.001, sA2 = sA + floor(float2(n.h1(cAb + 5.3), n.h1(cAb + 1.9)) * 7.0 / 0.001) * 0.001;
float wA = smoothstep(0.3, 0.7, n.vn(cA * 2.3 + 11.0));
float3 Aa = lerp(Texture2DSample(HA, HASampler, sA1).rgb, Texture2DSample(HA, HASampler, sA2).rgb, wA) / max(HAm.xyz, 0.001);
float3 An = lerp(Texture2DSample(HAN, HANSampler, sA1).rgb, Texture2DSample(HAN, HANSampler, sA2).rgb, wA) * 2.0 - 1.0;
float3 Ar = lerp(Texture2DSample(HAR, HARSampler, sA1).rgb, Texture2DSample(HAR, HARSampler, sA2).rgb, wA);
float2 sW = g / HSz.y + float2(n.h1(fid + 1.7), n.h1(fid + 9.2)) * 5.0;
float2 cW = sW * 0.2; float2 cWa = floor(cW), cWb = floor(cW + 0.5);
float2 sW1 = sW + floor(float2(n.h1(cWa + 3.7), n.h1(cWa + 9.1)) * 7.0 / 0.001) * 0.001, sW2 = sW + floor(float2(n.h1(cWb + 5.3), n.h1(cWb + 1.9)) * 7.0 / 0.001) * 0.001;
float wW = smoothstep(0.3, 0.7, n.vn(cW * 2.3 + 11.0));
float3 Wa = lerp(Texture2DSample(HW, HWSampler, sW1).rgb, Texture2DSample(HW, HWSampler, sW2).rgb, wW) / max(HWm.xyz, 0.001);
float3 Wn = lerp(Texture2DSample(HWN, HWNSampler, sW1).rgb, Texture2DSample(HWN, HWNSampler, sW2).rgb, wW) * 2.0 - 1.0;
float3 Wr = lerp(Texture2DSample(HWR, HWRSampler, sW1).rgb, Texture2DSample(HWR, HWRSampler, sW2).rgb, wW);
float2 sK = float2(dot(P.xz, kt), P.y) / HSz.z;
float2 cK = sK * 0.2; float2 cKa = floor(cK), cKb = floor(cK + 0.5);
float2 sK1 = sK + floor(float2(n.h1(cKa + 3.7), n.h1(cKa + 9.1)) * 7.0 / 0.001) * 0.001, sK2 = sK + floor(float2(n.h1(cKb + 5.3), n.h1(cKb + 1.9)) * 7.0 / 0.001) * 0.001;
float wK = smoothstep(0.3, 0.7, n.vn(cK * 2.3 + 11.0));
float3 Ka = lerp(Texture2DSample(HK, HKSampler, sK1).rgb, Texture2DSample(HK, HKSampler, sK2).rgb, wK) / max(HKm.xyz, 0.001);
float3 Kn = lerp(Texture2DSample(HKN, HKNSampler, sK1).rgb, Texture2DSample(HKN, HKNSampler, sK2).rgb, wK) * 2.0 - 1.0;
float3 Kr = lerp(Texture2DSample(HKR, HKRSampler, sK1).rgb, Texture2DSample(HKR, HKRSampler, sK2).rgb, wK);
float mac = lerp(1.0 - MacroK, 1.0 + MacroK, n.fbm(g * 0.07 + 3.1));
asph = AsphC.xyz * Aa * lerp(1.0, Ar.r, CavK) * mac * lerp(1.0, 0.93, young);
walk = WalkC.xyz * Wa * lerp(1.0, Wr.r, CavK) * joint * lerp(0.9, 1.08, n.h1(fid + 3.3)) * mac;
kerb = KerbC.xyz * Ka * lerp(1.0, Kr.r, CavK);
hqN = isA * An + isW * Wn + isK * Kn + (1.0 - isA - isW - isK) * float3(0, 0, 1);
hqRough = isA * Ar.g + isW * Wr.g + isK * Kr.g;
}
float3 grass = float3(0.07, 0.09, 0.035) * lerp(0.7, 1.3, n.fbm(P.xz * 0.7));
float3 paintW = lerp(float3(0.62, 0.62, 0.6), asph, smoothstep(0.55, 0.85, n.fbm(g * 3.0)) * 0.35);
float3 paintY = lerp(float3(0.62, 0.42, 0.08), asph, smoothstep(0.55, 0.85, n.fbm(g * 3.0)) * 0.35);
float rest = saturate(1.0 - isA - isW - isK - isPW - isPY - isG);
float3 alb = asph * isA + walk * isW + kerb * isK + paintW * isPW + paintY * isPY + grass * isG + walk * rest;
Rough = isA * 0.85 + isW * 0.8 + isK * 0.75 + (isPW + isPY) * 0.6 + isG * 0.95 + rest * 0.8;
if (hqRough >= 0.0) Rough = saturate(hqRough + (isPW + isPY) * 0.6 + isG * 0.95 + rest * 0.8);
// R3-HQ: the sets' normals (OpenGL) in the street grid's frame (g: T along its x, the image's up along -its y), the kerb's
// faces in their own frame
float3 Tg = float3(0.8744, 0, 0.4853), Bg = -float3(-0.4853, 0, 0.8744);
if (isK > 0.5 && abs(N.y) < 0.7) { Tg = float3(kt.x, 0, kt.y); Bg = float3(0, -1, 0); }
float3 nw = normalize(Tg * hqN.x * NrmK + Bg * hqN.y * NrmK + N * max(hqN.z, 0.05));
NormalOut = normalize(float3(nw.x, nw.z, nw.y));
return max(alb * Gain.xyz, 0.0);
'''

DECAL = r'''
// the texture's UsdTransform2d (Xf: scale xy, translation zw; XfR: cos, sin of its rotation) on the USD's st (UE flipped V)
float2 s0 = float2(UV0.x, 1.0 - UV0.y) * Xf.xy;
s0 = float2(s0.x * XfR.x - s0.y * XfR.y, s0.x * XfR.y + s0.y * XfR.x) + Xf.zw;
float2 tuv = float2(s0.x, 1.0 - s0.y);
float4 t = Texture2DSample(Tex, TexSampler, tuv);
Opacity = saturate(t.a * OpacityK);
// R5-ROOF: a stain or a paint layer is matte (the web's decals are rough, and a transparent layer must not mirror the sky)
Rough = 1.0; Spec = 0.2;
return t.rgb * Gain.xyz;
'''

SIGN = r'''
// the texture's UsdTransform2d (Xf: scale xy, translation zw; XfR: cos, sin of its rotation) on the USD's st (UE flipped V)
float2 s0 = float2(UV0.x, 1.0 - UV0.y) * Xf.xy;
s0 = float2(s0.x * XfR.x - s0.y * XfR.y, s0.x * XfR.y + s0.y * XfR.x) + Xf.zw;
float2 tuv = float2(s0.x, 1.0 - s0.y);
float4 t = Texture2DSample(Tex, TexSampler, tuv);
Mask = (MaskOn > 0.5) ? t.a : 1.0;
Glow = t.rgb * GlowK;
return t.rgb * Gain.xyz;
'''

FILM = r'''
// three.js r185 AgXToneMapping on linear sRGB x exposure, the sRGB encoding, the web's grade (core/engine.js GradeShader).
// The scene colour arrives as radiance here (dividing it by View.PreExposure, 0.18 with the manual exposure at bias 0, put
// the sky 2.5 EV over the web's), so Expo is the page's own exposure (toneMappingExposure)
float3 c = (max(In.rgb, 0.0) + max(Bloom.rgb, 0.0)) * Expo;   // (the engine's combined bloom: the lamp heads' glare)
float3x3 to2020 = float3x3(0.6274, 0.3293, 0.0433, 0.0691, 0.9195, 0.0113, 0.0164, 0.0880, 0.8956);
float3x3 inset = float3x3(0.856627153315983, 0.0951212405381588, 0.0482516061458583, 0.137318972929847, 0.761241990602591, 0.101439036467562, 0.11189821299995, 0.0767994186031903, 0.811302368396859);
float3x3 outset = float3x3(1.1271005818144368, -0.11060664309660323, -0.016493938717834573, -0.1413297634984383, 1.157823702216272, -0.016493938717834257, -0.14132976349843826, -0.11060664309660294, 1.2519364065950405);
float3x3 to709 = float3x3(1.6605, -0.5876, -0.0728, -0.1246, 1.1329, -0.0083, -0.0182, -0.1006, 1.1187);
c = mul(to2020, c); c = mul(inset, c);
float lo = -12.47393, hi = 4.026069;
c = saturate((log2(max(c, 1e-10)) - lo) / (hi - lo));
c = ((((((15.5 * c - 40.14) * c + 31.96) * c - 6.868) * c + 0.4298) * c + 0.1191) * c - 0.00232);
c = mul(outset, c);
c = pow(max(c, 0.0), 2.2);
c = saturate(mul(to709, c));
c = lerp(c * 12.92, 1.055 * pow(max(c, 1e-9), 1.0 / 2.4) - 0.055, step(0.0031308, c));
if (Blk > 1e-5 || abs(Wht - 1.0) > 1e-5) { float sl = 1.0 / max(Wht - Blk, 0.5); c = saturate(c * sl - Blk * sl); }
c = c + (c * c * (3.0 - 2.0 * c) - c) * Con;
c = c + smoothstep(0.55, 1.0, c) * (1.0 - c) * 4.0 * Hi;
float l0 = dot(c, float3(0.2126, 0.7152, 0.0722));
c += (1.0 - smoothstep(0.10, 0.72, l0)) * Warm * float3(1.0, 0.45, -0.6);
c += (l0 * 0.65 + 0.35) * TintG * float3(-0.55, 1.0, -0.4);
float l = dot(c, float3(0.2126, 0.7152, 0.0722));
c = (c - l) * Sat + l;
c += (1.0 - l) * float3(0.005, 0.006, 0.01);
float2 q = UV - 0.5;
c *= 1.0 - Vig * smoothstep(0.35, 0.95, dot(q, q) * 2.6);
// R4-CINE: film grain (the cinematic preset's; 0 in the takes): a per-pixel, per-frame hash, lighter in the highlights
float gr = frac(sin(dot(UV * float2(1913.3, 1171.9) + frac(Time * 0.731) * 113.0, float2(12.9898, 78.233))) * 43758.5453);
c += (gr - 0.5) * Grain * (1.0 - 0.5 * saturate(l));
// the engine encodes this pass's output to sRGB itself: hand it linear (an encoded output came out encoded twice: 2.5 EV
// too bright, the grade's warmth 2.7x as strong)
c = saturate(c);
return lerp(c / 12.92, pow((c + 0.055) / 1.055, 2.4), step(0.04045, c));
'''

FACADE = r'''
struct BXN {
  float h1(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float vn(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(h1(i), h1(i + float2(1, 0)), f.x), lerp(h1(i + float2(0, 1)), h1(i + float2(1, 1)), f.x), f.y); }
  float fbm(float2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.01 + 3.3) + 0.125 * vn(p * 8.13 + 1.7); }
};
BXN n;
// R9-FAC: a world displacement in the wall's plane (metres) to the atlas, through the pixel's own footprint
struct BXA { float3 px, py; float2 ax, ay; float g11, g12, g22, det;
  float2 at(float3 w) { float b1 = dot(px, w), b2 = dot(py, w); return (ax * (g22 * b1 - g12 * b2) + ay * (g11 * b2 - g12 * b1)) / det; }
};
// (the bake's meshes carry fst (facade metres) and st (the atlas): UE's UV sets sort by name, so st is UV 1)
float4 a = Texture2DSample(Alb, AlbSampler, UV1);
float3 e = Texture2DSample(Emi, EmiSampler, UV1).rgb;
float3 d = Texture2DSample(Dat, DatSampler, UV1).rgb;
// R9-FAC (UE track, 2026-10-08): the windows recessed RecD behind the wall plane by parallax on the bake's pane mask (G):
// through the opening the view ray meets the pane plane (the bake's pane at that point), else the opening's reveal (the
// wall's colour in the recess' shade, its face across the ray's way out); a frame FrW wide round each pane, a sill SillH
// deep under each opening. The plane's frame comes from the pixel's own footprint: no recess where a pixel quad spans a
// corner or an atlas seam, toward grazing views, or in ray-traced hits (no derivatives there)
float rv = 0.0, frw = 0.0, sl = 0.0;
float3 rvA = float3(0, 0, 0), rvN = float3(0, 0, 1), slN = float3(0, 0, 1);
if (RecD > 0.001) {
  BXA A;
  A.px = ddx(WP) * 0.01; A.py = ddy(WP) * 0.01; A.ax = ddx(UV1); A.ay = ddy(UV1);
  A.g11 = dot(A.px, A.px); A.g12 = dot(A.px, A.py); A.g22 = dot(A.py, A.py);
  A.det = A.g11 * A.g22 - A.g12 * A.g12;
  float3 Ng = normalize(NW), Vn = normalize(V);
  float3 Nc = cross(A.px, A.py); float lc = length(Nc);
  float vn = dot(Vn, Ng);
  if (A.det > 1e-18 && lc > 1e-12 && abs(dot(Nc, Ng)) > 0.97 * lc && vn > 0.08) {
    float3 up = float3(0, 0, 1) - Ng * Ng.z; float lu = length(up);
    up = (lu > 0.2) ? up / lu : float3(0, 0, 0);   // (a roof or a soffit has no up in its plane)
    float3 sd = cross(up, Ng);
    float3 wv = RecD * (Ng - Vn / max(vn, 0.25));
    float lw = length(wv); if (lw > 0.45) wv *= 0.45 / lw;
    float fade = smoothstep(0.08, 0.2, vn);
    float2 o1 = A.at(wv) * fade;
    float mA = Texture2DSampleGrad(Dat, DatSampler, UV1 + o1 * 0.5, A.ax, A.ay).g;
    float mB = Texture2DSampleGrad(Dat, DatSampler, UV1 + o1, A.ax, A.ay).g;
    float win = smoothstep(0.35, 0.65, d.g);
    float pane = smoothstep(0.35, 0.65, mA) * smoothstep(0.35, 0.65, mB);
    float2 uvP = UV1 + o1;
    float wP = win * pane;
    a = lerp(a, Texture2DSampleGrad(Alb, AlbSampler, uvP, A.ax, A.ay), wP);
    e = lerp(e, Texture2DSampleGrad(Emi, EmiSampler, uvP, A.ax, A.ay).rgb, wP);
    d = lerp(d, Texture2DSampleGrad(Dat, DatSampler, uvP, A.ax, A.ay).rgb, wP);
    rv = win * (1.0 - pane) * fade;
    rvA = Texture2DSampleGrad(Alb, AlbSampler, UV1 + o1 * ((mA < 0.5) ? 0.5 : 1.0), A.ax, A.ay).rgb * 0.45;
    float cu = dot(wv, up), cs = dot(wv, sd);
    float tU = 1.0 - smoothstep(0.35, 0.65, Texture2DSampleGrad(Dat, DatSampler, UV1 + A.at(up * cu) * fade, A.ax, A.ay).g);
    float3 nR = normalize(lerp(-sd * (cs >= 0.0 ? 1.0 : -1.0), -up * (cu >= 0.0 ? 1.0 : -1.0), tU) + Ng * 0.05);
    rvN = mul(Parameters.TangentToWorld, nR);
    float2 fs = A.at(sd * FrW), fu = A.at(up * FrW);
    float mf = min(min(Texture2DSampleGrad(Dat, DatSampler, uvP + fs, A.ax, A.ay).g, Texture2DSampleGrad(Dat, DatSampler, uvP - fs, A.ax, A.ay).g),
                   min(Texture2DSampleGrad(Dat, DatSampler, uvP + fu, A.ax, A.ay).g, Texture2DSampleGrad(Dat, DatSampler, uvP - fu, A.ax, A.ay).g));
    frw = wP * (1.0 - smoothstep(0.35, 0.65, mf));
    sl = (1.0 - win) * smoothstep(0.35, 0.65, Texture2DSampleGrad(Dat, DatSampler, UV1 + A.at(up * SillH), A.ax, A.ay).g) * step(0.5, lu);
    slN = mul(Parameters.TangentToWorld, normalize(Ng + up * 0.6));
  }
}
// R9-FAC end
Rough = saturate(lerp(d.r, 0.08, d.g));
// the web's glass shows the environment (its IBL), not the street behind the lens: the panes' Fresnel x the sky's mean
float fr = 0.04 + 0.96 * pow(1.0 - saturate(abs(dot(normalize(V), normalize(NW)))), 5.0);
// the lit rooms behind the panes (the bake's B: room lit), as blender_windows' room glow: room albedo x 1.6 x the bulb's
// warm tint, mix(0.22, 1, night)
Glow = e * e * 8.0 * EmitK + d.g * fr * SkyC.xyz * ReflK + d.g * d.b * RoomC.xyz * RoomK * lerp(0.22 * RoomT, 1.0, EmitK);
// R3-PHYS: every room's day ambience behind its pane (blender_windows: (1 - night) x (0.08 + 0.26 x a per-room hash) x the
// room photographs' albedo, RoomA), so the unlit rooms are not black beside the lit ones by day (a cell of 1.6 x 3.2 m of
// the facade's metres stands for a room)
float2 rc = floor(UV0 / float2(1.6, 3.2));
float rh = frac(sin(dot(rc, float2(127.1, 311.7))) * 43758.55);
// (by day the rooms are seen through the pane and its film: RoomT, the share that reaches the camera; Cycles' glass)
Glow += d.g * (1.0 - EmitK) * (0.08 + 0.26 * rh) * RoomA * RoomT * float3(1.0, 0.97, 0.92);
// R3-HQ: the walls by class from the bake's colour (brick: red over green; stone: light and warm; plaster: the rest), each
// class's CC0 set at its real size on the facade's metres (UV 0), as detail over the bake's own colour, its normal and
// roughness; the panes (the bake's G) keep the bake
Glow *= 1.0 - saturate(rv + frw);   // (R9-FAC: no pane on the reveal and the frame)
float3 alb = a.rgb;
float3 tnF = float3(0, 0, 1);
if (HqOn > 0.5) {
  float lum = dot(a.rgb, float3(0.2126, 0.7152, 0.0722));
  float wb = saturate((a.r / max(a.g, 0.002) - 1.25) * 3.0);
  // (stone: light and warm, not the near-white of a painted or stucco wall, which takes the third class's plaster)
  float ws = (1.0 - wb) * saturate((lum - 0.16) * 6.0) * saturate((a.r / max(a.b, 0.002) - 1.0) * 3.0) * (1.0 - smoothstep(0.32, 0.45, lum));
  float wc = saturate(1.0 - wb - ws);
  float2 sB = UV0 / HSz.x;
  float2 cB = sB * 0.2; float2 cBa = floor(cB), cBb = floor(cB + 0.5);
  float2 sB1 = sB + floor(float2(n.h1(cBa + 3.7), n.h1(cBa + 9.1)) * 7.0 / HUn.x) * HUn.x, sB2 = sB + floor(float2(n.h1(cBb + 5.3), n.h1(cBb + 1.9)) * 7.0 / HUn.x) * HUn.x;
  float wB = smoothstep(0.3, 0.7, n.vn(cB * 2.3 + 11.0));
  float3 Ba = lerp(Texture2DSample(HB, HBSampler, sB1).rgb, Texture2DSample(HB, HBSampler, sB2).rgb, wB) / max(HBm.xyz, 0.001);
  float3 Bn = lerp(Texture2DSample(HBN, HBNSampler, sB1).rgb, Texture2DSample(HBN, HBNSampler, sB2).rgb, wB) * 2.0 - 1.0;
  float3 Br = lerp(Texture2DSample(HBR, HBRSampler, sB1).rgb, Texture2DSample(HBR, HBRSampler, sB2).rgb, wB);
  float2 sS = UV0 / HSz.y;
  float2 cS = sS * 0.2; float2 cSa = floor(cS), cSb = floor(cS + 0.5);
  float2 sS1 = sS + floor(float2(n.h1(cSa + 3.7), n.h1(cSa + 9.1)) * 7.0 / HUn.y) * HUn.y, sS2 = sS + floor(float2(n.h1(cSb + 5.3), n.h1(cSb + 1.9)) * 7.0 / HUn.y) * HUn.y;
  float wS = smoothstep(0.3, 0.7, n.vn(cS * 2.3 + 11.0));
  float3 Sa = lerp(Texture2DSample(HS, HSSampler, sS1).rgb, Texture2DSample(HS, HSSampler, sS2).rgb, wS) / max(HSm.xyz, 0.001);
  float3 Sn = lerp(Texture2DSample(HSN, HSNSampler, sS1).rgb, Texture2DSample(HSN, HSNSampler, sS2).rgb, wS) * 2.0 - 1.0;
  float3 Sr = lerp(Texture2DSample(HSR, HSRSampler, sS1).rgb, Texture2DSample(HSR, HSRSampler, sS2).rgb, wS);
  float2 sC = UV0 / HSz.z;
  float2 cC = sC * 0.2; float2 cCa = floor(cC), cCb = floor(cC + 0.5);
  float2 sC1 = sC + floor(float2(n.h1(cCa + 3.7), n.h1(cCa + 9.1)) * 7.0 / HUn.z) * HUn.z, sC2 = sC + floor(float2(n.h1(cCb + 5.3), n.h1(cCb + 1.9)) * 7.0 / HUn.z) * HUn.z;
  float wC = smoothstep(0.3, 0.7, n.vn(cC * 2.3 + 11.0));
  float3 Ca = lerp(Texture2DSample(HC, HCSampler, sC1).rgb, Texture2DSample(HC, HCSampler, sC2).rgb, wC) / max(HCm.xyz, 0.001);
  float3 Cn = lerp(Texture2DSample(HCN, HCNSampler, sC1).rgb, Texture2DSample(HCN, HCNSampler, sC2).rgb, wC) * 2.0 - 1.0;
  float3 Cr = lerp(Texture2DSample(HCR, HCRSampler, sC1).rgb, Texture2DSample(HCR, HCRSampler, sC2).rgb, wC);
  float3 det = Ba * wb + Sa * ws + Ca * wc;
  float3 arm = Br * wb + Sr * ws + Cr * wc;
  float wall = 1.0 - d.g;
  alb = a.rgb * lerp(float3(1, 1, 1), det * lerp(1.0, arm.r, CavK) * lerp(1.0 - MacroK, 1.0 + MacroK, n.fbm(UV0 * 0.09 + 1.3)), wall);
  float3 nf = Bn * wb + Sn * ws + Cn * wc;
  tnF = lerp(float3(0, 0, 1), float3(nf.x * NrmK, -nf.y * NrmK, max(nf.z, 0.05)), wall);
  Rough = saturate(lerp(arm.g, 0.08, d.g));
}
// R9-FAC: the reveal, the frame and the sill
alb = lerp(alb, rvA, rv);
alb = lerp(alb, FrC.xyz, frw);
alb = lerp(alb, min(alb * 1.35 + 0.03, 0.8), sl);
tnF = lerp(lerp(lerp(normalize(tnF), rvN, rv), float3(0, 0, 1), frw), slN, sl * 0.8);
Rough = lerp(lerp(lerp(Rough, 0.85, rv), 0.45, frw), 0.8, sl);
NormalTS = normalize(tnF);
return alb * Gain.xyz;
'''

DATA = r'''
// the take's data pass: the region (custom stencil, set per component from ue_families.json regions) and the planar depth
// in metres, 32-bit, for ue_check.py's regions and bx_leafcheck.py's reprojection
return float3(Stencil.r, Depth.r * 0.01, 1.0);
'''

LEAF = r'''
float4 t = Texture2DSample(Tex, TexSampler, UV0);
Mask = t.a;
float3 n = Texture2DSample(Nrm, NrmSampler, UV0).rgb * 2.0 - 1.0;
NormalTS = normalize(float3(n.x, -n.y, max(n.z, 0.15)));   // (the cards' maps are OpenGL; UE's tangent frame is DirectX)
float3 c = t.rgb * Tint.xyz;
Sss = c * Trans;
return c;
'''

HIDDEN = r'''
Mask = 0.0;
return float3(0, 0, 0);
'''

LENS = r'''
return Color.xyz * Strength;
'''

WALKER = r'''
// R4-PEDS: the crowd's walkers as blender_peds.py draws them (crowd.js PL31): a garment's colour is its walker's tint for
// that part (TA, TB, TC: top, bottom, shoes, rgba, on the walker's own instance; the part from the vertex colour's R) at the
// texture's own value against its local mean (the layer's mip-6 map), mixed in by the tint's alpha; skin, cloth and eyes
// take their roughness ranges; the day trim mix(0.9, 1, night)
float4 t = Texture2DSample(Alb, AlbSampler, UV0);
float3 alb = t.rgb;
if (Cls > 0.5 && Cls < 1.5) {
  float part = (VC.r < 0.05) ? 0.0 : ((VC.r < 0.42) ? 1.0 : ((VC.r < 0.82) ? 2.0 : 3.0));   // (ue_prep's levels, sRGB or not)
  float4 tt = float4(0, 0, 0, 0);
  // (the tints are the instance's parameters, not custom primitive data: reading that in the ray-traced hit shaders of
  // 634 skinned walkers hung the GPU under the cinematic preset's temporal samples, Xid 109)
  if (part > 0.5 && part < 1.5) tt = TA;
  else if (part > 1.5 && part < 2.5) tt = TB;
  else if (part > 2.5 && part < 3.5) tt = TC;
  float3 Y = float3(0.2126, 0.7152, 0.0722);
  float lum = dot(alb, Y), mlum = max(dot(Texture2DSample(Mean, MeanSampler, UV0).rgb, Y), 0.02);
  float3 rec = min(tt.rgb * clamp(lum / mlum, 0.25, 2.2), 0.85);
  alb = lerp(alb, rec, saturate(tt.a));
}
float3 o = Texture2DSample(Orm, OrmSampler, UV0).rgb;
Rough = (Cls < 0.5) ? 0.5 + 0.18 * o.g : ((Cls < 1.5) ? 0.62 + 0.38 * o.g : ((Cls < 2.5) ? 0.08 : o.g));
float3 nn = Texture2DSample(Nrm, NrmSampler, UV0).rgb * 2.0 - 1.0;
NormalTS = normalize(float3(nn.x, -nn.y, max(nn.z, 0.1)));   // (the crowd's maps are OpenGL)
return alb * Trim;
'''

GLASS = r'''
// R3-REFL: the window kit's thin glass (blender_windows.build_kitglass, fk/kitMats.js winGlass), lit and premultiplied:
// the pane's dirt film (its opacity (op + film x 0.14) x 0.55, a dark diffuse) over the room behind, the reflection the
// engine's own (glass's f0 0.04, the pane's roughness; Lumen's front-layer reflections), straight transmission for the rest
float film = 0.5 * Dirt;
float a = saturate((Op + film * 0.14) * 0.55);
Opacity = a;
Rough = Rgh;
return (0.04 + film * 0.3) * Col.xyz * a;
'''

# (name, hlsl, inputs, extra outputs, settings)
#   input kinds: s scalar, v vector, ts texture sRGB, tl texture linear, wp world position, nw vertex normal, uv0-uv3, cam (camera vector)
COMMON = [('WP', 'wp'), ('NW', 'nw'), ('Origin', 'v', (0, 0, 0, 0))]
MASTERS = {
    'pbr': (PBR, COMMON + [('UV0', 'uv0'), ('UV1', 'uv1'), ('UV2', 'uv2'), ('UV3', 'uv3'),
                           ('Alb', 'ts', 'white'), ('Nrm', 'tl', 'flat'), ('Orm', 'tl', 'orm'),
                           ('Size', 'v', (1, 1, 0, 0)), ('Rot', 'v', (1, 0, 0, 1)), ('Seed', 's', 0.0), ('Unit', 'v', (0, 0, 0, 0)),
                           ('World', 's', 0.0), ('Ratio', 'v', (1, 1, 1, 0)), ('FkOn', 's', 0.0), ('VcOn', 's', 0.0),
                           ('Bl', 'v', (0.25, 0.75, 0.5, 0)), ('NrmK', 's', 1.0), ('WallK', 's', 0.0), ('TrimV', 'v', (1, 1, 1, 0)),
                           ('Dirt', 's', 0.3), ('BaseY', 's', 0.0), ('TopY', 's', 1e5), ('Street', 's', 0.0), ('RoughK', 's', 1.0),
                           ('MetalOn', 's', 0.0), ('MetalV', 's', 0.0), ('MacroK', 's', 0.0), ('DetK', 's', 0.0), ('CavK', 's', 0.0),   # R3-HQ
                           ('PaintOn', 's', 0.0), ('Chips', 's', 1.0), ('RefL', 's', 0.25), ('Scan', 'v', (0, 0, 0, 1)), ('SubK', 's', 0.0)],   # R4-PAINT
            [('Rough', 1), ('Metal', 1), ('AO', 1), ('NormalOut', 3)], {'normal_ws': True}),
    'plain': (PLAIN, [('UV0', 'uv0'), ('UV1', 'uv1'), ('UV2', 'uv2'), ('Color', 'v', (0.5, 0.5, 0.5, 1)), ('FkOn', 's', 0.0),
                      ('VcOn', 's', 0.0), ('Gain', 'v', (1, 1, 1, 0)), ('HasTex', 's', 0.0), ('Tex', 'ts', 'white'),
                      ('EmiC', 'v', (0, 0, 0, 0)), ('EmiK', 's', 0.0), ('HasEmiTex', 's', 0.0), ('EmiTex', 'ts', 'white'),
                      ('Xf', 'v', (1, 1, 0, 0)), ('XfR', 'v', (1, 0, 0, 0)), ('SelfK', 's', 0.0), ('BaseK', 's', 1.0)],
              [('Glow', 3)], {'plain_pbr': True}),
    'paint': (PAINT, [('UV0', 'uv0'), ('LP', 'lp'), ('Color', 'v', (0.8, 0.8, 0.8, 0)), ('Gain', 'v', (1, 1, 1, 0)), ('HasTex', 's', 0.0), ('Tex', 'ts', 'white'),
                      ('Xf', 'v', (1, 1, 0, 0)), ('XfR', 'v', (1, 0, 0, 0)), ('RoughK', 's', 0.35), ('CcK', 's', 1.0), ('CcR', 's', 0.035)],
              [('Rough', 1), ('Metal', 1), ('CC', 1), ('CCR', 1)], {'cpd': True, 'clearcoat': True, 'attrs': True}),   # R3-PAINT, R4-PAINT
    'vk': (VK, COMMON + [('Paint', 'v', (0.03, 0.07, 0.07, 0)), ('Paint2', 'v', (0.02, 0.06, 0.07, 0)), ('RustC', 'v', (0.15, 0.06, 0.03, 0)),
                         ('RustD', 'v', (0.06, 0.03, 0.014, 0)), ('RustAmt', 's', 0.3), ('Ground', 's', 3.4), ('Seed', 's', 0.0),
                         ('Guano', 's', 0.3), ('Gain', 'v', (1, 1, 1, 0)), ('HqOn', 's', 0.0), ('HSz', 'v', (1, 2.2, 1, 0)), ('MacroK', 's', 0.08),
                         ('CavK', 's', 0.5), ('NrmK', 's', 1.0)] + [('HP', 'ts', 'white'), ('HPN', 'tl', 'flat'), ('HPR', 'tl', 'orm'), ('HPm', 'v', (0.5, 0.5, 0.5, 0)), ('HR', 'ts', 'white'), ('HRN', 'tl', 'flat'), ('HRR', 'tl', 'orm'), ('HRm', 'v', (0.5, 0.5, 0.5, 0))],
           [('Rough', 1), ('Metal', 1), ('NormalOut', 3)], {'normal_ws': True}),   # R3-HQ
    'ground': (GROUND, COMMON + [('UV1', 'uv1'), ('G0', 'ts', 'white'), ('G1', 'ts', 'white'), ('G2', 'ts', 'white'), ('G4', 'ts', 'white'),
                                 ('AsphC', 'v', (0.2, 0.2, 0.2, 0)), ('WalkC', 'v', (0.42, 0.38, 0.3, 0)), ('KerbC', 'v', (0.38, 0.31, 0.2, 0)),
                                 ('Gain', 'v', (1, 1, 1, 0)), ('HqOn', 's', 0.0), ('HSz', 'v', (3, 1.8, 1.9, 0)), ('MacroK', 's', 0.08),
                                 ('CavK', 's', 0.5), ('NrmK', 's', 1.0)] + [('HA', 'ts', 'white'), ('HAN', 'tl', 'flat'), ('HAR', 'tl', 'orm'), ('HAm', 'v', (0.5, 0.5, 0.5, 0)), ('HW', 'ts', 'white'), ('HWN', 'tl', 'flat'), ('HWR', 'tl', 'orm'), ('HWm', 'v', (0.5, 0.5, 0.5, 0)), ('HK', 'ts', 'white'), ('HKN', 'tl', 'flat'), ('HKR', 'tl', 'orm'), ('HKm', 'v', (0.5, 0.5, 0.5, 0))],
               [('Rough', 1), ('NormalOut', 3)], {'no_shadow_hint': True, 'normal_ws': True}),   # R3-HQ
    'decal': (DECAL, [('UV0', 'uv0'), ('Tex', 'ts', 'white'), ('OpacityK', 's', 1.0), ('Gain', 'v', (1, 1, 1, 0)), ('Xf', 'v', (1, 1, 0, 0)), ('XfR', 'v', (1, 0, 0, 0))],
              [('Opacity', 1), ('Rough', 1), ('Spec', 1)], {'blend': 'translucent', 'no_front_layer': True}),   # R5-ROOF: Rough, Spec, no front layer
    'sign': (SIGN, [('UV0', 'uv0'), ('Tex', 'ts', 'white'), ('MaskOn', 's', 0.0), ('GlowK', 's', 0.0), ('Gain', 'v', (1, 1, 1, 0)), ('Xf', 'v', (1, 1, 0, 0)), ('XfR', 'v', (1, 0, 0, 0))],
             [('Mask', 1), ('Glow', 3)], {'blend': 'masked'}),
    'lens': (LENS, [('Color', 'v', (1, 1, 1, 0)), ('Strength', 's', 1.0)], [], {'unlit': True}),
    'walker': (WALKER, [('UV0', 'uv0'), ('VC', 'vc'), ('Alb', 'ts', 'white'), ('Mean', 'ts', 'white'), ('Nrm', 'tl', 'flat'), ('Orm', 'tl', 'orm'),
                        ('Cls', 's', 1.0), ('Trim', 's', 1.0), ('TA', 'v', (0, 0, 0, 0)), ('TB', 'v', (0, 0, 0, 0)), ('TC', 'v', (0, 0, 0, 0))],
               [('Rough', 1), ('NormalTS', 3)], {}),   # R4-PEDS
    'glass': (GLASS, [('Op', 's', 0.36), ('Dirt', 's', 0.3), ('Col', 'v', (0.89, 0.92, 0.92, 0)), ('Rgh', 's', 0.03)],
              [('Opacity', 1), ('Rough', 1)], {'blend': 'composite', 'two_sided': True, 'forward': True}),   # R3-REFL
    'hidden': (HIDDEN, [], [('Mask', 1)], {'blend': 'masked'}),
    'leaf': (LEAF, [('UV0', 'uv0'), ('Tex', 'ts', 'white'), ('Nrm', 'tl', 'flat'), ('Tint', 'v', (1, 1, 1, 0)), ('Trans', 's', 0.6)],
             [('Mask', 1), ('NormalTS', 3), ('Sss', 3)], {'blend': 'masked', 'two_sided': True, 'foliage': True, 'rough_param': True}),
    'data': (DATA, [('Stencil', 'stencil'), ('Depth', 'depth')], [], {'post_after': True}),
    'facade': (FACADE, [('UV1', 'uv1'), ('V', 'cam'), ('NW', 'nw'), ('Alb', 'ts', 'white'), ('Emi', 'tl', 'black'), ('Dat', 'tl', 'orm'),
                        ('EmitK', 's', 0.0), ('Gain', 'v', (1, 1, 1, 0)), ('SkyC', 'v', (0.6, 0.7, 0.9, 0)), ('ReflK', 's', 1.0),
                        ('RoomC', 'v', (1.0, 0.8, 0.45, 0)), ('RoomK', 's', 0.96), ('UV0', 'uv0'), ('RoomA', 's', 0.6), ('RoomT', 's', 0.45), ('HqOn', 's', 0.0), ('HSz', 'v', (1.4, 3.0, 2.71, 0)),
                        ('HUn', 'v', (1, 1, 0.001, 0)), ('MacroK', 's', 0.06), ('CavK', 's', 0.5), ('NrmK', 's', 1.0),
                        ('WP', 'wp'), ('RecD', 's', 0.2), ('FrW', 's', 0.06), ('FrC', 'v', (0.045, 0.045, 0.05, 0)), ('SillH', 's', 0.07)] + [('HB', 'ts', 'white'), ('HBN', 'tl', 'flat'), ('HBR', 'tl', 'orm'), ('HBm', 'v', (0.5, 0.5, 0.5, 0)), ('HS', 'ts', 'white'), ('HSN', 'tl', 'flat'), ('HSR', 'tl', 'orm'), ('HSm', 'v', (0.5, 0.5, 0.5, 0)), ('HC', 'ts', 'white'), ('HCN', 'tl', 'flat'), ('HCR', 'tl', 'orm'), ('HCm', 'v', (0.5, 0.5, 0.5, 0))],
               [('Rough', 1), ('Glow', 3), ('NormalTS', 3)], {}),   # R3-HQ
    'film': (FILM, [('In', 'scene'), ('Bloom', 'bloom'), ('UV', 'sceneuv'), ('Expo', 's', 1.0), ('Sat', 's', 1.0), ('Con', 's', 0.0), ('Blk', 's', 0.0),
                    ('Wht', 's', 1.0), ('Hi', 's', 0.0), ('Warm', 's', 0.0), ('TintG', 's', 0.0), ('Vig', 's', 0.0),
                    ('Grain', 's', 0.0), ('Time', 'time')], [], {'post': True}),   # R4-CINE: Grain, Time
}

# R6-BUS (UE track, 2026-10-08): the ground with the red bus lane (matId 12, NYC DOT red, as the web's ground shader draws
# it): a thin red-oxide film multiplied on the asphalt under it (R x 1.70, G x 0.558, B x 0.550, a fifth darker with its
# chroma kept through the film), 18 % toward the product's own value, a mottled 95 % cover, matte. A master of its own
# (ue_families.json ground), so no other master is rebuilt while takes render.
BUS6 = r"""
if (abs(k - 12) < 0.5) {
float3 red = lerp(asph * float3(1.70, 0.558, 0.550), float3(0.150, 0.048, 0.040), 0.18);
float cov = 0.95 * (1.0 - smoothstep(0.52, 0.90, n.fbm(P.xz * 0.075 + 3.7)) * 0.24);
alb = lerp(alb, red, cov);
Rough = lerp(Rough, 0.88, cov);
}
// R9-TSQ (UE track, 2026-10-08): Times Square's plaza and streets polished and damp: in the zone
// GlZ (web x0, z0, x1, z1) a mottled cover GlK (the night's share) takes the roughness to 0.14-0.30 and the albedo a fifth
// darker (a wet film), so the boards mirror in the paving
if (GlK > 0.0) {
float zin = smoothstep(GlZ.x, GlZ.x + 6.0, P.x) * (1.0 - smoothstep(GlZ.z - 6.0, GlZ.z, P.x)) * smoothstep(GlZ.y, GlZ.y + 6.0, P.z) * (1.0 - smoothstep(GlZ.w - 6.0, GlZ.w, P.z));
float gcov = GlK * zin * lerp(0.55, 1.0, smoothstep(0.3, 0.7, n.fbm(P.xz * 0.09 + 9.1)));
Rough = lerp(Rough, lerp(0.14, 0.3, n.vn(P.xz * 0.8 + 2.3)), gcov);
alb *= 1.0 - 0.2 * gcov;
}
// R9-TSQ: the green bike lane (the web's matId 9, which reached UE as the flags' beige): MUTCD green rolled thin over the
// asphalt, scrubbed to bare road in patches
if (abs(k - 9) < 0.5) {
float3 bkC = lerp(float3(0.0145, 0.135, 0.039), float3(0.026, 0.210, 0.058), n.vn(P.xz * 0.9));
float bw2 = smoothstep(0.34, 0.92, n.fbm(P.xz * 0.4 + 12.0) * 0.55 + n.fbm(P.xz * 0.03 + 5.0) * 0.45) * 0.58;
alb = lerp(bkC, asph, bw2);
Rough = lerp(0.70, 0.88, bw2);
}
// R9-TSQ: Times Square's precast pavers (the web's matId 16, GP31; in UE the flags' 1.5 m concrete): 30 cm strips along
// Broadway in a running bond, smooth and speckled finishes in runs, a light-grey field, the ground's own flat normal
if (abs(k - 16) < 0.5) {
float2 pq = float2(dot(P.xz, float2(0.2646, -0.9644)), dot(P.xz, float2(0.9644, 0.2646)));
float prow = floor(pq.y / 0.30);
float2 pid = float2(floor(pq.x / 0.42 + n.h1(float2(prow, 3.3)) * 7.0), prow);
float speck = step(0.62 - 0.30 * smoothstep(0.55, 0.90, n.vn(float2(pq.x * 0.07, pq.y * 0.8) + 31.0)), n.h1(pid + 3.7));
alb = lerp(float3(0.335, 0.330, 0.303), float3(0.405, 0.398, 0.368), speck) * (0.91 + 0.16 * n.h1(pid + 9.1));
Rough = lerp(0.66, 0.52, n.vn(float2(pq.x * 0.05, pq.y * 0.35) + 7.0)) + 0.08 * speck;
NormalOut = normalize(float3(N.x, N.z, N.y));
}
"""
assert GROUND.count('return max(alb * Gain.xyz, 0.0);') == 1
MASTERS['ground6'] = (GROUND.replace('return max(alb * Gain.xyz, 0.0);', BUS6 + 'return max(alb * Gain.xyz, 0.0);'),
                      list(MASTERS['ground'][1]) + [('GlK', 's', 0.0), ('GlZ', 'v', (0, 0, 0, 0))]) + tuple(MASTERS['ground'][2:])   # (R9-TSQ: GlK, GlZ)
# R6-BUS end

# MESH11 (UE track, 2026-10-08): Nanite displacement on the ground, the pbr walls and the facade bake (build()'s 'disp'
# settings), from the HQ sets' height maps at the same coordinates as their colour, inward only (1 = the surface). The
# ground: the flags' joints on their 1.52 m grid (the ground's own pattern), the flags', kerbs' and asphalt's relief from
# their sets; the walls: the set's own relief (brick and mortar, stone joints). The fine relief follows the point's
# distance to the lens (CamP), the same on every stacked layer: whole to 10 m, gone by 25 m, its joints widened and its
# heights read from coarser levels as Nanite's 2-pixel triangles grow, so the micro-geometry neither aliases nor crawls
# as the view moves.
DISP_NOISE = r'''
struct BXD {
  float h1(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float vn(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(h1(i), h1(i + float2(1, 0)), f.x), lerp(h1(i + float2(0, 1)), h1(i + float2(1, 1)), f.x), f.y); }
};
BXD n;
float3 P = float3(WP.x * 0.01 + Origin.x, WP.z * 0.01, WP.y * 0.01 + Origin.z);
float3 N = normalize(float3(NW.x, NW.z, NW.y));
float dm = length(WP - CamP) * 0.01;            // the lens' distance (m)
float tpx = max(2.0 * dm / 1971.0, 1e-4);       // a 2-pixel triangle's size there (m; 2560 wide, 66 degrees)
float af = 1.0 - smoothstep(10.0, 25.0, dm);    // the fine relief's weight
'''
DISP_GROUND = DISP_NOISE + r'''
if (DispK <= 0.0 || af <= 0.0) return 1.0;
float k = UV1.x;
float isA = (abs(k - 0) < 0.5 || abs(k - 11) < 0.5 || abs(k - 12) < 0.5) ? 1 : 0;
float isW = abs(k - 1) < 0.5 ? 1 : 0;
float isK = abs(k - 2) < 0.5 ? 1 : 0;
float2 g = float2(P.x * 0.8744 + P.z * 0.4853, P.x * -0.4853 + P.z * 0.8744);
float2 fq = g / 1.52; float2 fid = floor(fq); float2 ff = frac(fq);
float jd = min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)) * 1.52;
float joint = 1.0 - smoothstep(0.004, 0.004 + max(0.01, 2.0 * tpx), jd);
float hA = 1.0, hW = 1.0, hK = 1.0;
if (HqOn > 0.5) {
  float3 lv = clamp(log2(tpx * 2048.0 / max(HSz.xyz, 0.01)), 2.0, 9.0);
  float2 sA = g / HSz.x; float2 cA = sA * 0.2; float2 cAa = floor(cA), cAb = floor(cA + 0.5);
  float2 sA1 = sA + floor(float2(n.h1(cAa + 3.7), n.h1(cAa + 9.1)) * 7.0 / 0.001) * 0.001, sA2 = sA + floor(float2(n.h1(cAb + 5.3), n.h1(cAb + 1.9)) * 7.0 / 0.001) * 0.001;
  float wA = smoothstep(0.3, 0.7, n.vn(cA * 2.3 + 11.0));
  hA = lerp(Texture2DSampleLevel(HAD, HADSampler, sA1, lv.x).r, Texture2DSampleLevel(HAD, HADSampler, sA2, lv.x).r, wA);
  float2 sW = g / HSz.y + float2(n.h1(fid + 1.7), n.h1(fid + 9.2)) * 5.0; float2 cW = sW * 0.2; float2 cWa = floor(cW), cWb = floor(cW + 0.5);
  float2 sW1 = sW + floor(float2(n.h1(cWa + 3.7), n.h1(cWa + 9.1)) * 7.0 / 0.001) * 0.001, sW2 = sW + floor(float2(n.h1(cWb + 5.3), n.h1(cWb + 1.9)) * 7.0 / 0.001) * 0.001;
  float wW = smoothstep(0.3, 0.7, n.vn(cW * 2.3 + 11.0));
  hW = lerp(Texture2DSampleLevel(HWD, HWDSampler, sW1, lv.y).r, Texture2DSampleLevel(HWD, HWDSampler, sW2, lv.y).r, wW);
  float2 kt = normalize(float2(-N.z, N.x) + 1e-5);
  float2 sK = float2(dot(P.xz, kt), P.y) / HSz.z; float2 cK = sK * 0.2; float2 cKa = floor(cK), cKb = floor(cK + 0.5);
  float2 sK1 = sK + floor(float2(n.h1(cKa + 3.7), n.h1(cKa + 9.1)) * 7.0 / 0.001) * 0.001, sK2 = sK + floor(float2(n.h1(cKb + 5.3), n.h1(cKb + 1.9)) * 7.0 / 0.001) * 0.001;
  float wK = smoothstep(0.3, 0.7, n.vn(cK * 2.3 + 11.0));
  hK = lerp(Texture2DSampleLevel(HKD, HKDSampler, sK1, lv.z).r, Texture2DSampleLevel(HKD, HKDSampler, sK2, lv.z).r, wK);
}
// relief as a fraction of the 2 cm magnitude: asphalt 0.25 (its aggregate and ruts), flags 0.2 plus a 0.55 joint (1.1 cm),
// kerbs 0.3
float h = 1.0 - af * (isA * 0.25 * (1.0 - hA) + isW * (0.2 * (1.0 - hW) + 0.55 * joint) + isK * 0.3 * (1.0 - hK));
return saturate(lerp(1.0, h, DispK));
'''
DISP_PBR = DISP_NOISE + r'''
if (DispK <= 0.0 || af <= 0.0) return 1.0;
float2 m; bool wm = World > 0.5;
if (wm) {
  if (abs(N.y) > 0.7) m = P.xz;
  else { float2 hh = normalize(float2(-N.z, N.x) + 1e-5); m = float2(dot(P.xz, hh), P.y); }
} else { m = float2(UV0.x, -UV0.y); }
float2 st = float2((m.x * Rot.x + m.y * Rot.z) / max(Size.x, 1e-3), (m.x * Rot.y + m.y * Rot.w) / max(Size.y, 1e-3));
float2 c = st * 0.21 + Seed * 0.0137;
float2 ca = floor(c), cb = floor(c + 0.5);
float2 oa = float2(n.h1(ca + 3.7), n.h1(ca + 9.1)), ob = float2(n.h1(cb + 5.3), n.h1(cb + 1.9));
if (Unit.x > 0) { oa = floor(oa / Unit.xy) * Unit.xy; ob = floor(ob / Unit.xy) * Unit.xy; }
float2 sa = st + oa * 7.0, sb = st + ob * 7.0;
float lv = clamp(log2(tpx * 2048.0 / max(min(Size.x, Size.y), 0.01)), 2.0, 9.0);
float o0 = Texture2DSampleLevel(Orm, OrmSampler, sa, lv).r, o1 = Texture2DSampleLevel(Orm, OrmSampler, sb, lv).r;
float w = smoothstep(Bl.x, Bl.y, n.vn(c * 2.3 + 11.0) + (o1 - o0) * Bl.z);
float h = lerp(Texture2DSampleLevel(Disp, DispSampler, sa, lv).r, Texture2DSampleLevel(Disp, DispSampler, sb, lv).r, w);
return saturate(lerp(1.0, h, DispK * 0.6 * af));   // (1.2 cm at most: brick and mortar, stone joints)
'''
MESH11_CAM = [('CamP', 'campos')]
MESH11_DISP_IN = [('HAD', 'tl', 'white'), ('HWD', 'tl', 'white'), ('HKD', 'tl', 'white'), ('DispK', 's', 0.0)]
MASTERS['ground6'] = (MASTERS['ground6'][0], list(MASTERS['ground6'][1]) + MESH11_DISP_IN + MESH11_CAM, MASTERS['ground6'][2],
                      {**MASTERS['ground6'][3], 'disp': {'code': DISP_GROUND, 'magnitude': 2.0, 'fade': [2.0, 1.0],
                       'inputs': ['WP', 'NW', 'Origin', 'UV1', 'HqOn', 'HSz', 'HAD', 'HWD', 'HKD', 'DispK', 'CamP']}})
MASTERS['pbr'] = (MASTERS['pbr'][0], list(MASTERS['pbr'][1]) + [('Disp', 'tl', 'white'), ('DispK', 's', 0.0)] + MESH11_CAM, MASTERS['pbr'][2],
                  {**MASTERS['pbr'][3], 'disp': {'code': DISP_PBR, 'magnitude': 2.0, 'fade': [2.0, 1.0],
                   'inputs': ['WP', 'NW', 'Origin', 'UV0', 'World', 'Rot', 'Size', 'Seed', 'Unit', 'Bl', 'Orm', 'Disp', 'DispK', 'CamP']}})
# (Nanite's own fade, in pixels of the whole magnitude, ends where the relief above has: 2 cm at 2 to 1 pixels is 20 to
# 40 m, the facade's 25 cm at 8 to 4 pixels 60 to 120 m; nothing is diced past it, which keeps the patches in budget)
# The facade bake's windows inset as geometry: the pane mask (the bake's G) pushes the pane RecK x 25 cm in, the mask
# read from coarser levels with the distance so a reveal's edge spans the triangles Nanite dices there; and the walls'
# own relief, WallK of the 25 cm (brick and mortar, stone joints, half for plaster), by the wall's class from the bake's
# colour as the pixel code reads it, at the facade's metres (UV 0) with the colour's two anti-tiling taps, within 25 m.
# It acts where the bake's meshes are Nanite (ue_mat MESH11, BXUE_FACNANITE; RecK and WallK follow the same switch). With
# the inset the parallax recess keeps only its frames and sills, and the opening's sides take their normal from the
# displaced triangle itself (Nanite keeps the wall's normal on displaced triangles).
DISP_FACADE = r'''
struct BXD {
  float h1(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float vn(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(h1(i), h1(i + float2(1, 0)), f.x), lerp(h1(i + float2(0, 1)), h1(i + float2(1, 1)), f.x), f.y); }
};
BXD n;
float dm = length(WP - CamP) * 0.01;
float h = 1.0;
float ik = RecK * (1.0 - smoothstep(30.0, 60.0, dm));   // (the parallax recess takes over beyond)
if (ik > 0.0) {
  // the opening: the pane mask closed over narrow bars (a gap of up to 5 texels of the 4096 atlas, about 40 cm, between
  // panes on both sides), so a many-paned window sinks whole with its bars instead of standing them out as fins
  float lm = clamp(log2(max(dm, 1.0) / 20.0), 0.0, 1.5);
  float2 tx = float2(3.0 / 4096.0, 0.0) * exp2(lm);
  float m0 = Texture2DSampleLevel(Dat, DatSampler, UV1, lm).g;
  float mx = min(Texture2DSampleLevel(Dat, DatSampler, UV1 + tx.xy, lm).g, Texture2DSampleLevel(Dat, DatSampler, UV1 - tx.xy, lm).g);
  float my = min(Texture2DSampleLevel(Dat, DatSampler, UV1 + tx.yx, lm).g, Texture2DSampleLevel(Dat, DatSampler, UV1 - tx.yx, lm).g);
  h -= smoothstep(0.35, 0.65, max(m0, max(mx, my))) * ik;
}
float af = 1.0 - smoothstep(8.0, 20.0, dm);
if (HqOn > 0.5 && WallK > 0.0 && af > 0.0) {
  float tpx = max(2.0 * dm / 1971.0, 1e-4);
  float pane = smoothstep(0.35, 0.65, Texture2DSampleLevel(Dat, DatSampler, UV1, 0.0).g);
  float3 a = Texture2DSampleLevel(Alb, AlbSampler, UV1, 1.0).rgb;
  float lum = dot(a, float3(0.2126, 0.7152, 0.0722));
  float wb = saturate((a.r / max(a.g, 0.002) - 1.25) * 3.0);
  float ws = (1.0 - wb) * saturate((lum - 0.16) * 6.0) * saturate((a.r / max(a.b, 0.002) - 1.0) * 3.0) * (1.0 - smoothstep(0.32, 0.45, lum));
  float wc = saturate(1.0 - wb - ws);
  float3 lv = clamp(log2(tpx * 2048.0 / max(HSz.xyz, 0.01)), 2.0, 9.0);
  float2 sB = UV0 / HSz.x; float2 cB = sB * 0.2; float2 cBa = floor(cB), cBb = floor(cB + 0.5);
  float2 sB1 = sB + floor(float2(n.h1(cBa + 3.7), n.h1(cBa + 9.1)) * 7.0 / HUn.x) * HUn.x, sB2 = sB + floor(float2(n.h1(cBb + 5.3), n.h1(cBb + 1.9)) * 7.0 / HUn.x) * HUn.x;
  float hB = lerp(Texture2DSampleLevel(HBD, HBDSampler, sB1, lv.x).r, Texture2DSampleLevel(HBD, HBDSampler, sB2, lv.x).r, smoothstep(0.3, 0.7, n.vn(cB * 2.3 + 11.0)));
  float2 sS = UV0 / HSz.y; float2 cS = sS * 0.2; float2 cSa = floor(cS), cSb = floor(cS + 0.5);
  float2 sS1 = sS + floor(float2(n.h1(cSa + 3.7), n.h1(cSa + 9.1)) * 7.0 / HUn.y) * HUn.y, sS2 = sS + floor(float2(n.h1(cSb + 5.3), n.h1(cSb + 1.9)) * 7.0 / HUn.y) * HUn.y;
  float hS = lerp(Texture2DSampleLevel(HSD, HSDSampler, sS1, lv.y).r, Texture2DSampleLevel(HSD, HSDSampler, sS2, lv.y).r, smoothstep(0.3, 0.7, n.vn(cS * 2.3 + 11.0)));
  float2 sC = UV0 / HSz.z; float2 cC = sC * 0.2; float2 cCa = floor(cC), cCb = floor(cC + 0.5);
  float2 sC1 = sC + floor(float2(n.h1(cCa + 3.7), n.h1(cCa + 9.1)) * 7.0 / HUn.z) * HUn.z, sC2 = sC + floor(float2(n.h1(cCb + 5.3), n.h1(cCb + 1.9)) * 7.0 / HUn.z) * HUn.z;
  float hC = lerp(Texture2DSampleLevel(HCD, HCDSampler, sC1, lv.z).r, Texture2DSampleLevel(HCD, HCDSampler, sC2, lv.z).r, smoothstep(0.3, 0.7, n.vn(cC * 2.3 + 11.0)));
  float hw = hB * wb + hS * ws + lerp(1.0, hC, 0.5) * wc;
  h -= (1.0 - pane) * af * WallK * (1.0 - hw);
}
return saturate(h);
'''
FAC_INSET = r'''
// MESH11: where the windows are inset as geometry (RecK, to 30 m, gone by 60 m) the parallax recess's reveal, frame
// and sill give way to the real opening; its sides keep the bake's own texels at the pane's edge, its frame stretched
// over them, which reads as the opening's shade (drawing them as lit wall made them read as raised frames)
float ikP = (RecK > 0.001) ? RecK * (1.0 - smoothstep(30.0, 60.0, length(WP - CamP) * 0.01)) : 0.0;
if (ikP > 0.001) {
  float kP = 1.0 - saturate(ikP / max(RecK, 1e-3));
  rv *= kP; frw *= kP; sl *= kP;
}
'''
_fm = MASTERS['facade']
assert _fm[0].count('// R9-FAC end\n') == 1 and _fm[0].count('float3 wv = RecD * (Ng - Vn / max(vn, 0.25));') == 1
MASTERS['facade'] = (_fm[0].replace('float3 wv = RecD * (Ng - Vn / max(vn, 0.25));',
                                    'float3 wv = lerp(RecD, 0.0015, (RecK > 0.001) ? 1.0 - smoothstep(30.0, 60.0, length(WP - CamP) * 0.01) : 0.0) * (Ng - Vn / max(vn, 0.25));   // (MESH11: the inset is real to 30 m)')
                           .replace('// R9-FAC end\n', FAC_INSET + '// R9-FAC end\n'),
                     list(_fm[1]) + [('RecK', 's', 0.0), ('WallK', 's', 0.0), ('HBD', 'tl', 'white'), ('HSD', 'tl', 'white'), ('HCD', 'tl', 'white')] + MESH11_CAM, _fm[2],
                     {**_fm[3], 'disp': {'code': DISP_FACADE, 'magnitude': 25.0, 'fade': [8.0, 4.0],
                                         'inputs': ['UV1', 'UV0', 'Dat', 'Alb', 'WP', 'CamP', 'RecK', 'WallK', 'HqOn', 'HSz', 'HUn', 'HBD', 'HSD', 'HCD']}}) + tuple(_fm[4:])
# MESH11 end

# TSQADS (2026-10-08): M_bx_board, the web's TA31 board shader (billboards.js ensureTA) for usd_mat's `board` family. Per
# vertex (ue_prep): UV1 = (the aspect class's first cell, its count), UV2 = (phase, duration; a ticker by a negative
# duration, its cell by the phase 0 or 1), UV3 = (an LED wall's size in metres; a printed board's width negative). The
# sim time comes from MPC_bx.SimT (the web's ENV.windT, keyed per frame by ue_take), the cell rects and mean colours from
# the table Tab (ue_prep board_tab_*.png: one column per cell, 24-bit values in RGB; rows 0-3 the rect in 1/256 atlas
# texels, three's uv from the bottom, rows 4-6 the mean linear colour x 1e6). As the web: the cell of the playlist, the
# next ad wiping in from the left over the last 0.6 s with a bright leading edge, every fetch's footprint kept inside its
# cell (a ticker's inside its row), the cell's mean colour past 48-160 atlas texels a pixel (4-14 along a ticker), the LED
# wall's cabinets, seams, diodes and off-axis falloff, a printed board floodlit from its foot at night, the pale fields
# held back and the brightest channel compressed above 1.1 at night, the LED gains x1.45 by day and x1.9 at night (the
# prints x1.25 and x1.7). An emitter (unlit); GainK scales it to the take's exposure.
BOARD = r'''
struct BXB {
  float val(Texture2D T, int i, int row) { float3 t = round(T.Load(int3(i, row, 0)).rgb * 255.0); return t.r * 65536.0 + t.g * 256.0 + t.b; }
  float4 rect(Texture2D T, int i, float2 atl) { return float4(val(T, i, 0) / atl.x, val(T, i, 1) / atl.y, val(T, i, 2) / atl.x, val(T, i, 3) / atl.y) / 256.0; }
  float3 mean(Texture2D T, int i) { return float3(val(T, i, 4), val(T, i, 5), val(T, i, 6)) * 1e-6; }
  float hash(float2 p) { return frac(sin(dot(p, float2(12.9898, 78.233))) * 43758.5453); }
  float4 fetch(Texture2D A, SamplerState AS, Texture2D T, float nc, float2 atl, float slot, float2 lc, float2 gx, float2 gy,
               float2 lo, float2 hi, float f0, float f1, bool alongX) {
    int i = int(clamp(slot + 0.5, 0.0, nc - 0.5));
    float4 r = rect(T, i, atl);
    float2 tx = r.zw * atl;
    float ml = max(length(gx * tx), length(gy * tx));
    float2 hw = 0.5 * (abs(gx) + abs(gy)) + (0.13 * ml + 1.5) / tx;
    float2 c = clamp(lc, lo + hw, hi - hw);
    c = lerp(c, 0.5 * (lo + hi), step(hi - lo, 2.0 * hw));
    float2 p = r.xy + c * r.zw, dx = gx * r.zw, dy = gy * r.zw;
    float4 t = Texture2DSampleGrad(A, AS, float2(p.x, 1.0 - p.y), float2(dx.x, -dx.y), float2(dy.x, -dy.y));
    float tpp = alongX ? max(abs(gx.x), abs(gy.x)) * tx.x : ml;
    t.rgb = lerp(t.rgb, mean(T, i), smoothstep(f0, f1, tpp));
    return t;
  }
};
BXB b;
float2 lc = float2(UV0.x, 1.0 - UV0.y);
float base = round(UV1.x), cnt = round(UV1.y), ph = UV2.x, du = UV2.y;
float2 sz = UV3, atl = Atl.xy;
float2 gx = ddx(lc), gy = ddy(lc), lcs = lc;
float slot0 = base;
float4 texel = float4(0.018, 0.022, 0.03, 1.0);
if (cnt > 0.5) {
  if (du < 0.0) {
    float tk = floor(ph + 0.5);
    slot0 = base + (tk - cnt * floor(tk / cnt));
    float s = frac(lc.x + SimT * -du) * 2.0, row = floor(s);
    lcs = float2(frac(s), (1.0 - row) * 0.5 + lc.y * 0.5);
    float r0 = (1.0 - row) * 0.5;
    texel = b.fetch(Tex, TexSampler, Tab, NC, atl, slot0, lcs, gx * float2(2.0, 0.5), gy * float2(2.0, 0.5), float2(0.0, r0), float2(1.0, r0 + 0.5), 4.0, 14.0, true);
  } else {
    float t = (SimT + ph) / du, k = floor(t), f = t - k;
    slot0 = base + (k - cnt * floor(k / cnt));
    texel = b.fetch(Tex, TexSampler, Tab, NC, atl, slot0, lc, gx, gy, float2(0.0, 0.0), float2(1.0, 1.0), 48.0, 160.0, false);
    float tw = min(0.6 / du, 0.25);
    if (f > 1.0 - tw && cnt > 1.5) {
      float p = (f - (1.0 - tw)) / tw, u = lc.x, k1 = k + 1.0;
      float4 nx = b.fetch(Tex, TexSampler, Tab, NC, atl, base + (k1 - cnt * floor(k1 / cnt)), lc, gx, gy, float2(0.0, 0.0), float2(1.0, 1.0), 48.0, 160.0, false);
      float e = smoothstep(p - 0.015, p + 0.015, u);
      texel = lerp(nx, texel, e);
      texel.rgb += 0.35 * (1.0 - smoothstep(0.0, 0.02, abs(u - p))) * step(0.02, p) * step(p, 0.98);
    }
  }
}
if (sz.x > 0.0) {
  float2 m = lc * sz;
  float mpp = max(length(ddx(m)), length(ddy(m)));
  float2 cab = floor(m / 0.96);
  float cv = 1.0 - smoothstep(0.12, 0.32, mpp);
  texel.rgb *= 1.0 + (b.hash(cab + base) - 0.5) * 0.05 * cv;
  float2 sd = abs(frac(m / 0.96) - 0.5) * 0.96;
  float seam = 1.0 - smoothstep(0.0, 0.004 + mpp * 0.5, 0.48 - max(sd.x, sd.y));
  texel.rgb *= 1.0 - 0.4 * seam * (1.0 - smoothstep(0.004, 0.012, mpp));
  float4 rr = b.rect(Tab, int(clamp(slot0 + 0.5, 0.0, NC - 0.5)), atl);
  float2 tc = (rr.xy + lcs * rr.zw) * atl;
  float tpp = max(length(ddx(tc)), length(ddy(tc)));
  float2 dq = abs(frac(tc) - 0.5);
  float dots = smoothstep(0.5, 0.3, max(dq.x, dq.y));
  texel.rgb *= lerp(1.0, 0.4 + 0.7 * dots, (1.0 - smoothstep(0.1, 0.2, tpp)) * 0.6);
  float3 fn = cross(ddx(WP), ddy(WP));
  float3 Nn = dot(fn, fn) > 1e-12 ? normalize(fn) : normalize(NW);
  float ca = abs(dot(Nn, normalize(V)));
  texel.rgb *= lerp(0.45, 1.0, smoothstep(0.05, 0.55, ca));
} else {
  texel.rgb *= lerp(1.0, 0.45 + 0.7 * (1.0 - lc.y) * (1.0 - lc.y) + 0.25, Night);
}
float3 col = texel.rgb;
float L = dot(col, float3(0.2126, 0.7152, 0.0722));
col *= 1.0 - Night * 0.5 * smoothstep(0.3, 0.9, L);
col *= (sz.x > 0.0) ? lerp(1.45, 1.9, Night) : lerp(1.25, 1.7, Night);
float kmx = max(col.r, max(col.g, col.b)), kex = max(kmx - 1.1, 0.0);
col *= lerp(1.0, min(1.0, (1.1 + kex / (1.0 + kex * 1.5)) / max(kmx, 1e-4)), Night);
return max(col * GainK, 0.0);
'''
MASTERS['board'] = (BOARD, [('UV0', 'uv0'), ('UV1', 'uv1'), ('UV2', 'uv2'), ('UV3', 'uv3'), ('Tex', 'ts', 'white'), ('Tab', 'tl', 'black'),
                            ('Night', 's', 1.0), ('GainK', 's', 1.0), ('Atl', 'v', (4096, 2048, 0, 0)), ('NC', 's', 27.0),
                            ('SimT', 'mpc', 'SimT'), ('WP', 'wp'), ('NW', 'nw'), ('V', 'cam')],
                    [], {'unlit': True})
BOARD_VERSION = 1    # bump to rebuild M_bx_board alone (board_refresh), never the other masters


def board_mpc():
    """the take's parameter collection /Game/Bx/MPC_bx with the scalar SimT (the web's sim time, keyed per frame)."""
    ap = f'{ROOT}/MPC_bx'
    if eal.does_asset_exist(ap): return eal.load_asset(ap)
    mpc = unreal.AssetToolsHelpers.get_asset_tools().create_asset('MPC_bx', ROOT, unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    sp_ = unreal.CollectionScalarParameter()
    sp_.set_editor_property('parameter_name', 'SimT'); sp_.set_editor_property('default_value', 0.0)
    mpc.set_editor_property('scalar_parameters', [sp_])
    eal.save_loaded_asset(mpc)
    return mpc


def board_refresh():
    """M_bx_board built when missing or older than BOARD_VERSION (its own marker), so the other masters stay as they are."""
    vf = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir()), 'Bx', f'.board_v{BOARD_VERSION}')
    ap = f'{ROOT}/M_bx_board'
    if os.path.exists(vf) and eal.does_asset_exist(ap): return False
    board_mpc()
    build('board', MASTERS['board'], defaults())
    os.makedirs(os.path.dirname(vf), exist_ok=True)
    open(vf, 'w').write('ok')
    return True
# TSQADS end
# UELOOK10 (2026-10-08): the park's water and the fountains' falling water.
# M_bx_water: cpWaterMat.js (CP32L) on UE's lit surface: the body's colour as the albedo, capillary-gravity ripples (ten
# trains from Lam down x 0.66 a train in golden-angle directions, each on its own dispersion, in drifting wind patches)
# that fade once a train is under ~2.5 px and hand their slope variance to the roughness (so nothing repeats and nothing
# sparkles at range), water's f0 0.02. The sun's glint and the mirror are the engine's (Lumen reflections) on the rippled
# normal: a glitter path instead of the sun's disc in a mirror.
WATER = r'''
float3 P = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);   // the USD's frame (metres, y up)
float fp = max(max(length(ddx(P.xz)), length(ddy(P.xz))), 1e-4);
float t = Tm * Slow.x;
struct BXW {
  float hs(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float h(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(hs(i), hs(i + float2(1, 0)), f.x), lerp(hs(i + float2(0, 1)), hs(i + float2(1, 1)), f.x), f.y); }
};
BXW w;
float pa = 0.35 + 0.95 * smoothstep(0.25, 0.85, w.h(P.xz * Pat.x + float2(t * 0.011, -t * 0.007)) )
         * (0.6 + 0.4 * w.h(P.xz * Pat.y - float2(t * 0.02, t * 0.013)));
float2 s = float2(0, 0); float lost = 0.0;
[unroll] for (int i = 0; i < 10; i++) {   // (a fixed count, unrolled)
  float fi = (float)i;
  float a = fi * 2.3999632 + 0.7;
  float2 d = float2(cos(a), sin(a));
  float lam = Lam * pow(0.66, fi);
  float k = 6.2831853 / lam;
  float om = sqrt(9.81 * k + 7.3e-5 * k * k * k) * 0.55;
  float sa = Amp * pa * (0.55 + 0.45 * frac(fi * 0.618034)) * lerp(1.0, 0.6, fi / 9.0);
  float aa = 1.0 - smoothstep(0.9, 2.4, k * fp);
  s += d * (sa * aa * cos(k * dot(d, P.xz) - om * Tm + fi * 1.93));
  lost += sa * sa * (1.0 - aa) * 0.5;
}
float r0 = Rgh;
Rough = clamp(pow(r0 * r0 * r0 * r0 + 2.0 * lost, 0.25), RMin, 0.45);
float3 nw = normalize(float3(-s.x, 1.0, -s.y));
NormalOut = float3(nw.x, nw.z, nw.y);
Spec = 0.25;
return max(Col.xyz, 0.0);
'''
# M_bx_veil: fountainFX.js veilMat (FW26 / FW27 / CP33) as a lit premultiplied sheet: the water's travel time since the lip
# (falls d = v0 t + g t^2 / 2) drives the pattern, which rides the flow (a feature is a parcel of water: it falls at the
# water's own speed and stretches as the sheet accelerates); the sheet tears into ropes and drop-sized holes past tear0 of
# the fall, aerates white towards the bottom, keeps its reflection at full strength (the specular through the holes' mask
# only) while the clear body lets the scene through, and glows towards the sun when the lens looks into it (the forward
# lobe). The lip, the speed, the fall time and the pattern per veil come from ue_prep (the bound meshes' bounds and the web's
# arguments by mesh name).
VEIL = r'''
float3 P = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);   // the USD's frame (metres, y up), as ue_prep's lip and centre
struct BXV {
  float h3(float3 p) { p = frac(p * 0.3183099 + 0.1); p *= 17.0; return frac(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float n3(float3 x) { float3 i = floor(x), f = frac(x); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(lerp(h3(i), h3(i + float3(1, 0, 0)), f.x), lerp(h3(i + float3(0, 1, 0)), h3(i + float3(1, 1, 0)), f.x), f.y),
                lerp(lerp(h3(i + float3(0, 0, 1)), h3(i + float3(1, 0, 1)), f.x), lerp(h3(i + float3(0, 1, 1)), h3(i + float3(1, 1, 1)), f.x), f.y), f.z); }
  float fbm(float3 p) { return 0.55 * n3(p) + 0.3 * n3(p * 2.03 + 7.1) + 0.15 * n3(p * 4.1 + 3.3); }
};
BXV v;
float fd = max(V0.x - P.y, 0.0);
float tf = (-V0.y + sqrt(V0.y * V0.y + 19.62 * fd)) / 9.81;
float u = saturate(tf / max(V0.z, 1e-3));
float al = Tm - tf;
float2 lq = P.xz - Cen.xy;
float n = v.fbm(float3(lq * Fq, al * 9.0));
float n2 = v.n3(float3(lq * Fq * 3.1, al * 16.0));
float n4 = v.n3(float3(lq * Fq * 7.3 + 2.1, al * 34.0));
n = lerp(n, n4, 0.3);
float thr = Aer.z * smoothstep(V0.w, 1.0, u);
float cov = smoothstep(thr - 0.07, thr + 0.05, n);
float edge = (1.0 - smoothstep(0.0, 0.14, n - thr)) * step(0.015, thr);
float aer = saturate(smoothstep(Aer.x, Aer.y, u) * (0.5 + 0.65 * n2) + edge * 0.65);
float3 col = lerp(float3(0.012, 0.024, 0.026), float3(0.88, 0.91, 0.92), aer);
Rough = lerp(0.035, 0.5, aer);
float body = lerp(Aer.w, 0.42 + 0.42 * n2, aer);
float op = cov * body;
Opacity = op;
// the facing normal (a thin two-sided sheet), capillary bands across it near the lip, rope relief across the flow below
float3 vw = normalize(float3(V.x, V.z, V.y));
float3 N0 = normalize(float3(NW.x, NW.z, NW.y));
if (dot(N0, vw) > 0.0) N0 = -N0;
float3 up = float3(0, 1, 0);
float3 ac = cross(up, N0); float acl = length(ac); ac = acl > 1e-4 ? ac / acl : float3(0, 0, 0);
float band = sin(al * 47.0 + n * 6.0) * (1.0 - u) * 0.3 + (n4 - 0.5) * 0.45 * u;
float rope = ((n2 - 0.5) * (0.25 + 0.55 * u) + (n - 0.5) * 0.5) * 0.6;
float3 nn = normalize(N0 + up * band + ac * rope);
NormalOut = float3(nn.x, nn.z, nn.y);
Spec = 0.25 * cov;
// looking into the sun through it: the forward lobe (premultiplied by the body's opacity, as the web's straight alpha)
float fwd = pow(saturate(dot(vw, normalize(SunD.xyz))), 5.0) * (1.0 - Night);
Glow = SunC.xyz * SunK * fwd * (0.2 + 0.8 * aer) * 0.5 * op;
return col * op;
'''
MASTERS['water'] = (WATER, [('WP', 'wp'), ('Tm', 'time'), ('Col', 'v', (0.034, 0.042, 0.021, 0)),
                            ('Amp', 's', 0.012), ('Lam', 's', 1.4), ('Rgh', 's', 0.05), ('RMin', 's', 0.04), ('Slow', 'v', (1, 0, 0, 0)),
                            ('Pat', 'v', (0.018, 0.07, 0, 0))],
                    [('Rough', 1), ('Spec', 1), ('NormalOut', 3)], {'normal_ws': True})
# GB43 (2026-10-14): M_bx_water2, M_bx_water with its wind patches from gradient noise: one octave of value noise on the
# lattice, sharpened by smoothstep(0.25, 0.85), read from the air as a checkerboard of squares (125 m for the harbour's
# Pat 0.008) on every open water; here two octaves of gradient noise with a quintic fade, the domain turned off the
# axes, and a softer ramp. The ripples are as they were.
_PA1 = """float pa = 0.35 + 0.95 * smoothstep(0.25, 0.85, w.h(P.xz * Pat.x + float2(t * 0.011, -t * 0.007)) )
         * (0.6 + 0.4 * w.h(P.xz * Pat.y - float2(t * 0.02, t * 0.013)));"""
_PA2 = """float2 q1 = float2(0.8 * P.x - 0.6 * P.z, 0.6 * P.x + 0.8 * P.z), q2 = float2(0.28 * P.x + 0.96 * P.z, -0.96 * P.x + 0.28 * P.z);
float pn = 0.62 * w2.g(q1 * Pat.x + float2(t * 0.011, -t * 0.007)) + 0.38 * w2.g(q2 * Pat.x * 2.13 - float2(t * 0.006, t * 0.009));
float pa = 0.35 + 0.95 * smoothstep(0.1, 0.9, pn) * (0.6 + 0.4 * w2.g(q2 * Pat.y - float2(t * 0.02, t * 0.013)));"""
_NZ2 = """struct BXW2 {
  float hs(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float2 gr(float2 i) { float a = hs(i) * 6.2831853; return float2(cos(a), sin(a)); }
  float g(float2 p) { float2 i = floor(p), f = frac(p); float2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = dot(gr(i), f), b = dot(gr(i + float2(1, 0)), f - float2(1, 0));
    float c = dot(gr(i + float2(0, 1)), f - float2(0, 1)), d = dot(gr(i + float2(1, 1)), f - float2(1, 1));
    return saturate(0.5 + 0.75 * lerp(lerp(a, b, u.x), lerp(c, d, u.x), u.y)); }
};
BXW2 w2;
struct BXW {"""
assert WATER.count(_PA1) == 1 and WATER.count("struct BXW {") == 1
WATER2 = WATER.replace("struct BXW {", _NZ2).replace(_PA1, _PA2)
assert WATER2 != WATER
MASTERS['water2'] = (WATER2,) + MASTERS['water'][1:]
MASTERS['veil'] = (VEIL, [('WP', 'wp'), ('NW', 'nw'), ('V', 'cam'), ('Tm', 'time'),
                          ('V0', 'v', (0, 0.3, 0.6, 0.22)), ('Aer', 'v', (0.3, 0.95, 0.45, 0.2)), ('Fq', 's', 7.0), ('Cen', 'v', (0, 0, 0, 0)),
                          ('SunD', 'v', (0, 1, 0, 0)), ('SunC', 'v', (1, 1, 1, 0)), ('SunK', 's', 1.0), ('Night', 's', 0.0)],
                   [('Opacity', 1), ('Rough', 1), ('Spec', 1), ('NormalOut', 3), ('Glow', 3)],
                   {'blend': 'composite', 'two_sided': True, 'forward': True, 'normal_ws': True})
# UELOOK10 end
# WATER3 (2026-10-15, the re-shoot: the owner's "a proper detailed water shader with waves, non-tiled, depth ... rather than
# the most basic UE5 water"): M_bx_water3, open water as a wind sea on UE's single layer water shading. The waves are a sum
# of 224 trains sampled from a JONSWAP spectrum (Hasselmann et al. 1973) for the body's wind speed and fetch (Wind.x m/s,
# Wind.z m), log-spaced in wavenumber from a quarter of the peak's to the shortest wavelength (Rng.x m), each jittered in
# its bin and turned off the wind (Wind.y deg, the direction the waves travel) by a spread that widens from the peak to
# the tail; amplitudes sqrt(2 S(k) dk), deep-water phase speeds with capillarity. No lattice of wave vectors, so nothing
# tiles at any scale. Wind.w lifts the long trains only (the owner's "deliberately larger than physical" for impact,
# faded to 1 by 16 x the peak's wavenumber), so the short scales, and with them the roughness at range, stay physical. Each
# train fades out as its wavelength nears the pixel's footprint and hands its slope variance a^2 k^2 / 2 to the
# roughness (Bruneton, Neyret and Holzschuch 2010: seamless transitions from geometry to BRDF), with the unresolved
# capillaries as the remainder of Cox and Munk's (1954) total slope variance 0.003 + 0.00512 U: distant water turns into
# the right glossy lobe, never glitter. The colour is the body's inherent optical properties, absorption Abs and
# scattering Sct per metre with the phase function's g (Pg), never an albedo; f0 0.02. Reflections are the renderer's
# (ray traced with hit lighting in the cine presets), the clouds' shadows the sun's.
WATER3 = r"""
float3 P = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);   // the USD's frame (metres, y up)
float2 X = P.xz;
float fp = max(max(length(ddx(X)), length(ddy(X))), 1e-4);
const float g = 9.81;
float U = max(Wind.x, 0.5), F = max(Wind.z, 50.0), wd = Wind.y * 0.01745329;
float wpk = 22.0 * pow(g * g / (U * F), 1.0 / 3.0);
float alp = 0.076 * pow(U * U / (F * g), 0.22);
float kp = wpk * wpk / g;
float lk0 = log(kp * 0.25), dl = (log(6.2831853 / max(Rng.x, 0.005)) - lk0) / 224.0;
float2 s = float2(0, 0); float lost = 0.0, tot = 0.0;
[loop] for (int i = 0; i < 224; i++) {
  float fi = (float)i;
  float h1 = frac(sin(fi * 12.9898 + 4.1) * 43758.5453), h2 = frac(sin(fi * 78.233 + 1.7) * 24634.6345);
  float h3 = frac(sin(fi * 39.425 + 9.2) * 31718.927), h4 = frac(sin(fi * 93.989 + 2.3) * 17143.191);
  float k = exp(lk0 + (fi + h1) * dl);
  float om = sqrt(g * k);
  float sg = om <= wpk ? 0.07 : 0.09;
  float rr = exp(-(om - wpk) * (om - wpk) / (2.0 * sg * sg * wpk * wpk));
  float Sw = alp * g * g * pow(om, -5.0) * exp(-1.25 * pow(wpk / om, 4.0)) * pow(3.3, rr);
  float a = sqrt(Sw * g / om * k * dl) * lerp(Wind.w, 1.0, smoothstep(2.0 * kp, 16.0 * kp, k));
  float sp = lerp(0.55, 1.35, saturate(log2(k / kp) * 0.2));
  float th = wd + sp * (h2 + h3 - 1.0);
  float2 d = float2(cos(th), sin(th));
  float omc = sqrt(g * k + 7.3e-5 * k * k * k);
  float ph = k * dot(d, X) - omc * Tm + h4 * 6.2831853;
  float w = 1.0 - smoothstep(0.7, 1.8, k * fp);
  float v = 0.5 * a * a * k * k;
  s -= d * (a * k * w * sin(ph));
  lost += v * (1.0 - w * w); tot += v;
}
float fo = 0.0, foK = 0.0;
if (RgN > 0.5) {   // a fountain pool: the landing ring's trains and the plunge's foam (fountainFX.js poolRings, FW25-FW27)
  struct BXF {
    float h3(float3 p) { p = frac(p * 0.3183099 + 0.1); p *= 17.0; return frac(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float n3(float3 x) { float3 i = floor(x), f = frac(x); f = f * f * (3.0 - 2.0 * f);
      return lerp(lerp(lerp(h3(i), h3(i + float3(1, 0, 0)), f.x), lerp(h3(i + float3(0, 1, 0)), h3(i + float3(1, 1, 0)), f.x), f.y),
                  lerp(lerp(h3(i + float3(0, 0, 1)), h3(i + float3(1, 0, 1)), f.x), lerp(h3(i + float3(0, 1, 1)), h3(i + float3(1, 1, 1)), f.x), f.y), f.z); }
    float fbm(float3 p) { return 0.55 * n3(p) + 0.3 * n3(p * 2.03 + 7.1) + 0.15 * n3(p * 4.1 + 3.3); }
  };
  BXF q;
  float2 cc = RgC0.xy; float dd = length(X - cc);
  if (RgN > 1.5 && length(X - RgC0.zw) < dd) { dd = length(X - RgC0.zw); cc = RgC0.zw; }
  if (RgN > 2.5 && length(X - RgC1.xy) < dd) { dd = length(X - RgC1.xy); cc = RgC1.xy; }
  if (RgN > 3.5 && length(X - RgC1.zw) < dd) { dd = length(X - RgC1.zw); cc = RgC1.zw; }
  float2 dv = X - cc; float rr = max(length(dv), 1e-4); float2 dirR = dv / rr;
  float x = rr - Rg.x;
  if (Fm.x > 0.0) {
    float fx = x - (q.n3(float3(dv * 1.9, Tm * 0.45)) - 0.5) * 0.55 - (q.n3(float3(dv * 6.0, Tm * 1.1)) - 0.5) * 0.18;
    float band = smoothstep(-Fm.y, -0.04, fx) * exp(-max(fx, 0.0) * Fm.z);
    float2 fa = dv - dirR * Tm * 0.32;
    float fn = q.fbm(float3(fa * 3.3, Tm * 0.55)), fc = q.n3(float3(fa * 12.0, Tm * 1.7));
    fo = Fm.x * band * smoothstep(0.62 - 0.42 * band, 0.86 - 0.2 * band, fn * 0.72 + fc * 0.38);
    float cz = (fx + 0.02) / 0.24; float core = exp(-cz * cz);
    float clot = q.fbm(float3(fa * 6.5, Tm * 1.3)) * 0.75 + q.n3(float3(fa * 21.0, Tm * 2.6)) * 0.35;
    fo = saturate(max(fo, Fm.x * smoothstep(0.52, 0.78, core * (0.35 + clot))));
    foK = 0.62 + 0.3 * fn + 0.2 * fc;
  }
  float jit = q.n3(float3(dv * 1.7 + 11.0, Tm * 0.3)) * 6.0;
  float str = 0.35 + 1.1 * q.n3(float3(dv * 2.3, Tm * 0.7));
  float s1 = cos(Rg.z * x - Tm * 7.5 + jit) * exp(-abs(x) * 1.7) * str;
  float s2 = cos(Rg.z * 1.7 * x + Tm * 6.1 + 1.3 - jit * 0.6) * exp(-abs(x) * 3.0) * 0.6 * str;
  float jet = cos(22.0 * rr - Tm * 9.0 + jit) * exp(-rr * 1.6) * 0.5;
  s += dirR * ((s1 + s2 + jet) * Rg.y * (1.0 - 0.75 * fo));
  lost += 0.0025 * 1.8 * exp(-abs(x) * 1.6) * Rg.w;   // (choppier round the landing ring)
}
float res = max(0.003 + 0.00512 * U - tot, 0.0) + Rng.y;
Rough = lerp(clamp(pow(res + lost, 0.25), Rng.z, 0.62), 0.55, fo);
float3 nw = normalize(float3(-s.x, 1.0, -s.y));
NormalOut = float3(nw.x, nw.z, nw.y);
Spec = 0.25;
Scat = max(Sct.xyz, 0.0);
Absorb = max(Abs.xyz, 0.0);
PhaseG = Pg;
Behind = BehK;
Opacity = fo;
return float3(0.86, 0.89, 0.9) * max(foK, 0.62);
"""
MASTERS['water3'] = (WATER3, [('WP', 'wp'), ('Tm', 'time'), ('Wind', 'v', (6.0, 45.0, 8000.0, 1.6)), ('Rng', 'v', (0.03, 0.0004, 0.02, 0)),
                              ('Abs', 'v', (0.55, 0.20, 0.42, 0)), ('Sct', 'v', (0.11, 0.13, 0.10, 0)), ('Pg', 's', 0.6), ('BehK', 's', 1.0),
                              ('RgN', 's', 0.0), ('RgC0', 'v', (0, 0, 0, 0)), ('RgC1', 'v', (0, 0, 0, 0)), ('Rg', 'v', (2.4, 0.08, 17.0, 1.0)), ('Fm', 'v', (0, 0.55, 1.3, 0))],
                     [('Rough', 1), ('Spec', 1), ('NormalOut', 3), ('Scat', 3), ('Absorb', 3), ('PhaseG', 1), ('Behind', 1), ('Opacity', 1)],
                     {'normal_ws': True, 'slw': True})
# WATER3F (2026-10-25): M_bx_water3f, M_bx_water3 for the far level's rivers with a fetch map: FetchT (linear, R) over
# the world rect FetchR (x0, z0, 1/w, 1/h, metres; z 0 off) is a channel's t (tools/ue/water_fetch.py: 1 on open water,
# under 1 on channels 90-210 m wide); the sea's fetch goes from Wind.z to FetchN.x and the long trains' lift from Wind.w
# to 1 as t falls. Where t is 1 the code takes Wind.z and Wind.w themselves, so open water is M_bx_water3's to the bit.
WATER3F = WATER3.replace(
    "float U = max(Wind.x, 0.5), F = max(Wind.z, 50.0), wd = Wind.y * 0.01745329;",
    "float tF = FetchR.z > 0.0 ? saturate(Texture2DSampleLevel(FetchT, FetchTSampler, (X - FetchR.xy) * FetchR.zw, 0).r) : 1.0;\n"
    "float U = max(Wind.x, 0.5), F = max(tF >= 1.0 ? Wind.z : lerp(FetchN.x, Wind.z, tF), 50.0), wd = Wind.y * 0.01745329;\n"
    "float lift = tF >= 1.0 ? Wind.w : lerp(1.0, Wind.w, tF);").replace(
    "lerp(Wind.w, 1.0, smoothstep(2.0 * kp, 16.0 * kp, k))", "lerp(lift, 1.0, smoothstep(2.0 * kp, 16.0 * kp, k))")
MASTERS['water3f'] = (WATER3F, MASTERS['water3'][1] + [('FetchT', 'tl', 'orm'), ('FetchR', 'v', (0, 0, 0, 0)), ('FetchN', 'v', (800.0, 0, 0, 0))],
                      MASTERS['water3'][2], MASTERS['water3'][3])
# VEIL2 (2026-10-15, the owner: the fountains' water in the city's cells "isn't proper UE5 water but some low-quality
# textured water"): M_bx_veil2, M_bx_veil for the cells. Every fountain's falling water shares one library key
# (fw26:veil#..., the key's hash leaves the web's uniforms out), so the instance carries a table of up to eight veils
# (r1c_cellmat2.py from the packages' geometry: each veil's centre, lip and foot, the web's own v0, aeration, holes, body,
# frequency and tear, the fall time from v0 and the height as ue_prep's look13d) and each pixel takes the veil whose ring
# (centre, mean radius) is nearest among those whose fall spans its height; the sun for the forward lobe from the sky
# atmosphere's light.
VEIL2 = r"""
{
  float3 Pv = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);
  float4 VT[8] = { VT0, VT1, VT2, VT3, VT4, VT5, VT6, VT7 };
  float4 VA[8] = { VA0, VA1, VA2, VA3, VA4, VA5, VA6, VA7 };
  float4 VB[8] = { VB0, VB1, VB2, VB3, VB4, VB5, VB6, VB7 };
  float4 VR[2] = { VR0, VR1 };
  float best = 1e9; int bi = 0;
  [unroll] for (int i = 0; i < 8; i++) {
    if ((float)i < VN) {
      float sc = abs(length(Pv.xz - VT[i].xy) - VR[i / 4][i % 4]) + 20.0 * max(max(VT[i].w - 0.3 - Pv.y, Pv.y - VT[i].z - 0.3), 0.0);
      if (sc < best) { best = sc; bi = i; }
    }
  }
  V0 = float4(VT[bi].z, VA[bi].x, VA[bi].y, VA[bi].z); Aer = VB[bi]; Fq = VA[bi].w; Cen = float4(VT[bi].xy, 0, 0);
  SunD = float4(AtS.x, AtS.z, AtS.y, 0);
}
""" + VEIL
MASTERS['veil2'] = (VEIL2, [i for i in MASTERS['veil'][1] if i[0] not in ('SunD',)] + [('SunD', 'v', (0, 1, 0, 0)), ('AtS', 'atmsun'), ('VN', 's', 0.0)]
                    + [(f'V{t}{j}', 'v', (0, 0, 0, 0)) for t in 'TAB' for j in range(8)] + [('VR0', 'v', (0, 0, 0, 0)), ('VR1', 'v', (0, 0, 0, 0))],
                    MASTERS['veil'][2], MASTERS['veil'][3])
# VEIL2 end
# CURTAIN45 (2026-10-15): M_bx_curtain, a glass tower the web draws as a plain prism with its painted sky reflection (the
# landmark towers' shells, 30 Hudson Yards: an untextured material with uRefl and uSunD), which Unreal drew as a dark slab
# without a window: a curtain wall in world space on the face's own axes: vertical mullions every Mul.x m (Mul.z wide),
# a spandrel band at every floor (Mul.y m, Mul.w tall), dielectric glass (f0 0.04, near mirror) tinted by the record's
# colour, each pane tilted a fraction of a degree by its hash so the ray-traced reflections break as real glazing does
CURTAIN = r"""
float3 P = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);   // metres, y up
float3 N = normalize(float3(NW.x, NW.z, NW.y));
float3 up = float3(0, 1, 0);
float3 T = cross(up, N); float tl = length(T);
float side = step(0.35, tl);   // (walls; roofs and soffits stay plain)
T = tl > 1e-4 ? T / tl : float3(1, 0, 0);
float u = dot(P, T), v = P.y;
float fu = frac(u / Mul.x), fv = frac(v / Mul.y);
float2 cell = float2(floor(u / Mul.x), floor(v / Mul.y));
float mw = Mul.z / Mul.x;
float mull = (1.0 - smoothstep(0.0, mw, fu)) + smoothstep(1.0 - mw, 1.0, fu);
float span = 1.0 - smoothstep(Mul.w / Mul.y, Mul.w / Mul.y + 0.02, fv);
float frame = saturate(max(mull, span)) * side;
float h = frac(sin(dot(cell, float2(12.9898, 78.233)) + floor(dot(N, float3(3.1, 0.0, 7.7)))) * 43758.5453);
float h2 = frac(h * 91.37 + 0.31);
float3 tilt = (T * (h - 0.5) + up * (h2 - 0.5)) * 0.012 * side * (1.0 - frame);
float3 n = normalize(N + tilt);
NormalOut = float3(n.x, n.z, n.y);
float3 glass = Col.xyz * Tint.x;
float3 fcol = lerp(float3(0.42, 0.43, 0.45), Col.xyz * 0.55, span);
Rough = lerp(0.035 + 0.02 * h, lerp(0.38, 0.3, span), frame);
Metal = lerp(0.0, lerp(0.85, 0.35, span), frame);
Spec = 0.5;
return lerp(glass, fcol, frame);
"""
MASTERS['curtain'] = (CURTAIN, [('WP', 'wp'), ('NW', 'nw'), ('Col', 'v', (0.21, 0.31, 0.39, 0)), ('Tint', 'v', (0.6, 0, 0, 0)),
                                ('Mul', 'v', (1.52, 4.1, 0.15, 1.3))],   # (the first test, 0.35 / 0.07 m / 0.95 m, read as a uniform dark slab at 1.5 km)
                      [('Rough', 1), ('Metal', 1), ('Spec', 1), ('NormalOut', 3)], {'normal_ws': True})
# CURTAIN45 end
# FP18 (2026-10-18, the owner: the towers' glass "too simple"): M_bx_curtain2, M_bx_curtain as glass over a room. The pane
# (the kit's own quad, UV 0 over it, or a cell of the world-space grid on a prism, as M_bx_curtain) is a mirror-smooth
# dielectric at its family's reflectance and reflection tint (above Unreal's 0.08 specular ceiling partly metallic, as the
# facade master's coated glass), its base colour the glass's own dirt; through it the room as light of its own (an open
# floor three panes wide and Pane.z deep: ceiling, floor, core wall; daylight falling off from the glass, brighter on the
# sun side, ceiling lights on in a share of the panes, roller blinds at the glass in another), filtered by the glass's
# tint and its transmission (1 - Fresnel). A kit pane's identity is its own normal (tkBuild.js paneQ tilts every pane by
# its seed), the grid's its cell; each grid pane tilted by its hash, every pane bowed a little where it spans pixels. The
# sky atmosphere's sun sets the daylight (none below the horizon) and the side. Gl: F0, the room's daylight level, the
# blinds' share, the lit share; Rt: the reflection's tint; Pane: the kit pane's width, height (m) and the room's depth.
CURTAIN2 = r"""
float3 P = WP * 0.01;
float3 N0 = normalize(NW);
float3 Vd = normalize(V);
float sgn = dot(N0, Vd) > 0.0 ? -1.0 : 1.0;
float3 Ng = N0 * sgn;
float3 up = float3(0.0, 0.0, 1.0);
float3 T0 = cross(up, N0); float tlen = length(T0);
float wall = step(0.35, tlen);
T0 = tlen > 1e-4 ? T0 / tlen : float3(1.0, 0.0, 0.0);
float3 B0 = cross(N0, T0);
float grid = Mul.x < 500.0 ? 1.0 : 0.0;
float uu = dot(P, T0), vv = P.z;
float2 f, cell, pw;
if (grid > 0.5) {
  float2 g2 = float2(uu / Mul.x, vv / Mul.y);
  cell = floor(g2); f = frac(g2); pw = Mul.xy;
  cell += floor(dot(N0, float3(3.1, 7.7, 0.0))) * 131.0;
} else {
  f = saturate(UV0); pw = Pane.xy;
  float3 nq = floor(N0 * 4096.0 + 0.5);
  cell = float2(nq.x * 1.37 + nq.z * 0.71, nq.y * 1.13 - nq.z * 0.53);
}
float3 p3 = frac(float3(cell.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33);
float h1 = frac((p3.x + p3.y) * p3.z);
float h2 = frac(h1 * 91.37 + 0.31), h3 = frac(h1 * 57.13 + 0.71), h4 = frac(h2 * 33.71 + 0.19), h5 = frac(h3 * 71.93 + 0.43), h6 = frac(h4 * 19.31 + 0.87);
float mw = Mul.z / Mul.x;
float mull = (1.0 - smoothstep(0.0, mw, f.x)) + smoothstep(1.0 - mw, 1.0, f.x);
float span = 1.0 - smoothstep(Mul.w / Mul.y, Mul.w / Mul.y + 0.02, f.y);
float frame = saturate(max(mull, span)) * wall * grid;
// the room behind the pane, in the pane's frame (x along the wall, y up, z into the building), metres
float3 Tv = cross(up, Ng); Tv = length(Tv) > 1e-4 ? normalize(Tv) : float3(1.0, 0.0, 0.0);
float3 Bv = cross(Ng, Tv);
float3 rd = float3(dot(Vd, Tv), dot(Vd, Bv), max(dot(Vd, -Ng), 0.03));
float W = max(pw.x, 0.3), Hh = max(pw.y, 0.5), D = max(Pane.z, 1.0);
float fxs = sgn > 0.0 ? f.x : 1.0 - f.x;
float3 o = float3(fxs * W, f.y * Hh, 0.0);
float tx = rd.x > 0.0 ? (2.0 * W - o.x) / max(rd.x, 1e-4) : (o.x + W) / max(-rd.x, 1e-4);
float ty = rd.y > 0.0 ? (Hh - o.y) / max(rd.y, 1e-4) : (o.y + 0.08 * Hh) / max(-rd.y, 1e-4);
float tz = D / rd.z;
float t = min(tx, min(ty, tz));
float3 q = o + rd * t;
float3 sunW = normalize(AtS.xyz);
float day = smoothstep(-0.03, 0.10, sunW.z);
float sunIn = saturate(dot(Ng, sunW));
float lit = step(1.0 - Gl.w, h3);
float3 room; float ceilF = 0.0;
if (t == tz) room = lerp(float3(0.46, 0.45, 0.42), float3(0.60, 0.58, 0.54), h4);
else if (t == ty && rd.y > 0.0) { room = float3(0.78, 0.77, 0.74); ceilF = 1.0; }
else if (t == ty) room = lerp(float3(0.17, 0.16, 0.15), float3(0.30, 0.25, 0.20), h5);
else room = float3(0.55, 0.54, 0.51);
float fall = 1.0 / (1.0 + q.z * 0.35);
float3 roomL = room * Gl.y * day * (0.55 + 0.75 * sunIn) * fall;
float3 lampC = lerp(float3(1.0, 0.93, 0.82), float3(0.92, 0.96, 1.0), h6);
roomL += room * lampC * lit * (ceilF * 0.10 + 0.035) * (0.45 + 0.55 * (1.0 - day)) * (1.0 / (1.0 + q.z * 0.12));
// a roller blind at the glass, its hem at its own height
float blind = step(h5, Gl.z) * step(1.0 - lerp(0.12, 0.92, h2), f.y);
float3 blindL = lerp(float3(0.62, 0.60, 0.56), float3(0.46, 0.47, 0.46), h4) * Gl.y * (day * (0.45 + 0.55 * sunIn) + lit * 0.05) * (0.8 + 0.2 * f.y);
roomL = lerp(roomL, blindL, blind);
// the glass: its tint and transmission
float lumC = max(dot(Col.rgb, float3(0.2126, 0.7152, 0.0722)), 1e-4);
float3 tintT = saturate(Col.rgb / lumC * 0.62);
float cosV = saturate(dot(-Vd, Ng));
float F = Gl.x + (1.0 - Gl.x) * pow(1.0 - cosV, 5.0);
float3 em = roomL * tintT * (1.0 - F) * wall * (1.0 - frame);
// the surface: the pane bowed where it spans pixels, a grid pane tilted by its hash
float fw = max(fwidth(f.x), fwidth(f.y));
float bowK = smoothstep(0.08, 0.02, fw);
float2 tl = (f - 0.5) * 0.016 * bowK + (float2(h1, h2) - 0.5) * 0.024 * grid;
float3 n = normalize(N0 + (T0 * tl.x + B0 * tl.y) * (1.0 - frame));
NormalOut = n;
float3 f3 = Gl.x * Rt.rgb;
float fl = dot(f3, float3(0.2126, 0.7152, 0.0722));
float3 gbase = Col.rgb * Tint.x * 0.18;
float gmet = 0.0, gspec = saturate(fl / 0.08);
if (fl > 0.08) {
  float d = max(dot(gbase, float3(0.2126, 0.7152, 0.0722)), 1e-4);
  float x = clamp(((d + fl) - sqrt(max((d + fl) * (d + fl) - 0.16 * d, 0.0))) / 0.08, 0.05, 1.0);
  gmet = 1.0 - x; gspec = 0.5;
  gbase = gmet > 1e-3 ? max((f3 - 0.04 * x) / gmet, 0.0) : gbase;
}
float3 fcol = lerp(float3(0.42, 0.43, 0.45), Col.xyz * 0.55, span);
Rough = lerp(0.02 + 0.012 * h4, lerp(0.38, 0.3, span), frame);
Metal = lerp(gmet, lerp(0.85, 0.35, span), frame);
Spec = lerp(gspec, 0.5, frame);
Glow = em;
return lerp(gbase, fcol, frame);
"""
MASTERS['curtain2'] = (CURTAIN2, [('WP', 'wp'), ('NW', 'nw'), ('V', 'cam'), ('UV0', 'uv0'), ('AtS', 'atmsun'), ('Col', 'v', (0.21, 0.31, 0.39, 0)),
                                  ('Tint', 'v', (0.6, 0, 0, 0)), ('Mul', 'v', (1.52, 4.1, 0.15, 1.3)), ('Gl', 'v', (0.06, 0.05, 0.4, 0.45)),
                                  ('Rt', 'v', (1, 1, 1, 0)), ('Pane', 'v', (1.5, 3.6, 4.0, 0))],
                       [('Rough', 1), ('Metal', 1), ('Spec', 1), ('NormalOut', 3), ('Glow', 3)], {'normal_ws': True})
# FP18 end
# WATER3 end
# UELOOK10 (2026-10-08): M_bx_facade's panes show the rooms behind the glass as blender_windows.py (BX-WIN) draws them in
# Cycles, in place of the flat lit glow (t3Drop's white checkerboard: UE's lit panes flat cream at L* 38, Cycles' rooms
# 27). The generic grid's cell from ue_prep's per-face data (UV 2: floorH, winW; UV 3: the bays' side margin, the style),
# the opening per style (makeFacadeMaterial's pick; the bake's pane mask still places the pane), the view ray in the
# wall's frame (the tangent of the facade metres, up, into the wall), the room box (2-3 bays wide, the opening's height,
# 1.55 / 2.4 x that + 1.2 m deep) entered at the glass plane REC behind the wall and ray-marched to its far face, the
# from the room's eye and yawed per room, the web's light per room (day ambience, the lit share's glow with its bulb's
# tint, the depth falloff), side curtains, roller shades (residential, WL11's per-flat presence and crooked hems) and
# venetians (office, the slats averaged once they are under a pixel), the glass tint and the dirt film. The pane's
# albedo is the room seen through the film; its emission the lit room's (x RoomEK), the bake's own window glow removed
# from the panes as Cycles does. The hashes are BX-WIN's (hash12, WL11's wlh) on a per-wall seed in place of the
# building's colour variant, which the UV sets have no room for.
FAC_ROOMS = r'''
// UELOOK10: the rooms behind the panes (blender_windows.py BX-WIN)
struct BXR {
  float h12(float x, float y) { float a = frac(x * 0.1031), b = frac(y * 0.1031);
    float dd = a * (b + 33.33) + b * (a + 33.33) + a * (a + 33.33); float ad = a + dd, bd = b + dd; return frac((ad + bd) * ad); }
  float wlh(float a, float b) { float s = fmod(a * 127.0 + b * 311.0 + 7.0, 4093.0); s = fmod(s * s + 1153.0, 4093.0);
    s = fmod(s * 137.0 + 59.0, 4093.0); s = fmod(s * s + 2411.0, 4093.0); return s / 4093.0; }
};
BXR r;
float3 rmA = float3(0, 0, 0), rmE = float3(0, 0, 0), rmD = float3(0, 0, 0); float rmOn = 0.0;
Spec = 0.5; Metal = 0.0;
if (RoomOn > 0.5 && UV2.x > 0.4) {
  float fH = max(UV2.x, 0.5), wW = max(UV2.y, 0.3), sM = UV3.x, sty = UV3.y;
  float u = UV0.x, vv = 1.0 - UV0.y;   // the facade metres (UE flips the v of fst; ue_prep pre-flips its own sets)
  float glS = max(step(2.5, sty) * step(sty, 3.5), step(10.5, sty) * step(sty, 11.5));
  float loS = step(5.5, sty) * step(sty, 7.5), siS = step(13.5, sty) * step(sty, 14.5), coS = step(14.5, sty) * step(sty, 15.5);
  float resi = max(step(sty, 2.5), max(step(4.5, sty) * step(sty, 5.5), step(11.5, sty)));
  float3 Nw = normalize(NW);
  // a per-wall seed (the wall's plane and its grid) for the building's colour variant and wall seed
  float pl = dot(Nw, WP * 0.01);
  float ws = r.h12(floor(pl * 2.0) + floor(atan2(Nw.y, Nw.x) * 40.0) * 17.0, sM * 97.0 + fH * 13.0 + wW * 29.0);
  float cvr = floor(ws * 1024.0 + 0.5) / 1024.0, cvI = floor(ws * 1024.0 + 0.5), wsd = frac(ws * 7.31);
  float cuC = (u - sM) / wW, cvC = vv / fH;
  float fx = frac(cuC), fy = frac(cvC), cU = floor(cuC), cV = floor(cvC);
  float cUS = cU + wsd * 37.0;
  float x0 = 0.2 + glS * (0.05 - 0.2) + loS * (0.1 - 0.2) + siS * (0.30 - 0.2) + coS * (0.10 - 0.2);
  float x1 = 0.8 + glS * (0.95 - 0.8) + loS * (0.9 - 0.8) + siS * (0.70 - 0.8) + coS * (0.90 - 0.8);
  float y0 = 0.3 + glS * (0.08 - 0.3) + loS * (0.14 - 0.3) + siS * (0.28 - 0.3) + coS * (0.16 - 0.3);
  float y1 = 0.88 + glS * (0.96 - 0.88) + loS * (0.92 - 0.88) + siS * (0.80 - 0.88) + coS * (0.94 - 0.88);
  // the view ray in the wall's frame
  float3 Tw = normalize(Parameters.TangentToWorld[0]);
  float3 rd = normalize(V);
  float rdx = dot(rd, Tw), rdy = rd.z, rdz = max(-dot(rd, Nw), 0.04);
  float REC = lerp(0.15, 0.045, glS);
  float kk = REC / max(rdz, 0.2);
  float parX = clamp(rdx * kk, -0.5, 0.5), parY = clamp(rdy * kk, -0.5, 0.5);
  float Wp = max((x1 - x0) * wW, 1e-3), Hp = max((y1 - y0) * fH, 1e-3);
  float pu = (fx - x0) * wW + parX, pv = (fy - y0) * fH + parY;
  // the room (PR #33906 interior mapping)
  float span = 2.0 + step(0.55, r.h12(floor(cUS / 2.0), cV + cvr * 7.0));
  float roomI = floor(cU / span), roomK = roomI + wsd * 53.0;
  float RW = span * wW, RH = max((y1 - y0) * fH, 0.3), RD = lerp(2.4, 1.55, resi) * RH + 1.2;
  float rx = saturate((cuC + parX / wW - roomI * span) / span) * RW;
  float ry = saturate((fy + parY / fH - y0) / max(y1 - y0, 1e-3)) * RH;
  float tx = rdx > 0.0 ? (RW - rx) / max(rdx, 1e-4) : rx / max(-rdx, 1e-4);
  float ty = rdy > 0.0 ? (RH - ry) / max(rdy, 1e-4) : ry / max(-rdy, 1e-4);
  float tz = RD / rdz;
  float t = min(tx, min(ty, tz));
  float hx = rx + rdx * t, hy = ry + rdy * t, hz = rdz * t;
  float qz = saturate(hz / RD);
  float id_ = r.h12(roomK + cvr * 511.0, cV * 1.7);
  float id2 = r.h12(cV * 3.7 + cvr * 131.0, roomK * 1.3);
  float id3 = r.h12(roomK * 7.9, cV * 5.1 + cvr * 57.0);
  float dx = hx - RW * 0.5, dy = hy - RH * 0.45, dz = hz - RD * 0.5;
  float dl = max(sqrt(dx * dx + dy * dy + dz * dz), 1e-4);
  float yaw = r.h12(roomK * 2.3, cV * 0.7 + cvr * 13.0);
  float pu_ = frac(atan2(dx, dz) / 6.2831853 + yaw);
  float pv_ = 0.5 + asin(clamp(dy / dl, -1.0, 1.0)) / 3.14159265;
  float shh = r.h12(roomK * 5.3, cV * 2.9 + cvr * 3.0);
  float slot = lerp(5.0 + min(floor(shh * 3.0), 2.0), min(floor(shh * 5.0), 4.0), resi);
  float col = fmod(slot, 2.0), row = floor(slot / 2.0);
  float2 ruv = float2((col + clamp(pu_, 0.002, 0.998)) / 2.0, (row + 1.0 - clamp(pv_, 0.004, 0.996)) / 4.0);
  float fpm = max(length(ddx(WP)), length(ddy(WP))) * 0.01;
  float lod = clamp(log2(max(fpm * 110.0, 1e-3)), 0.0, 7.0);
  float3 photo = Texture2DSampleLevel(Rooms, RoomsSampler, ruv, lod).rgb;
  float gn = slot < 0.5 ? RG0.x : slot < 1.5 ? RG0.y : slot < 2.5 ? RG0.z : slot < 3.5 ? RG0.w : slot < 4.5 ? RG1.x : slot < 5.5 ? RG1.y : slot < 6.5 ? RG1.z : RG1.w;
  photo *= gn;
  float NIGHT = saturate(EmitK);
  // a window under a few pixels: the room, its light and its dressing settle to their means (no per-pixel lottery)
  float far = 1.0 - smoothstep(3.0, 8.0, wW / max(fpm, 1e-4));
  photo = lerp(photo, float3(0.42, 0.41, 0.39), far);
  float lit = lerp(step(0.5, d.b), saturate(d.b), far);
  float3 lightA = lerp(float3(1.0, 0.72, 0.27), float3(1.0, 0.89, 0.61), r.h12(cU, cV + 9.0));
  float3 lightB = lerp(float3(0.87, 0.91, 1.0), float3(0.62, 0.71, 1.0), r.h12(cV, cU + 4.0));
  float3 lightCol = lerp(lerp(lightB, lightA, step(id2, 0.88)), float3(0.98, 0.8, 0.47), far);
  lightCol = lerp(lightCol, float3(1.0, 0.74, 0.42), WarmK * NIGHT);   // (UELOOK10 follow-up 3: the web's warmer rooms at night)
  float dayAmb = (1.0 - NIGHT) * (0.08 + 0.26 * lerp(id_, 0.5, far));
  float roomGlow = lit * lerp(0.22, 1.0, NIGHT);
  float lev = (dayAmb + roomGlow * 1.6 + 0.02) * lerp(1.0, 0.45, qz);
  float3 room = photo * lev;
  room = lerp(room, room * lightCol, lit * lerp(0.25, 0.85, NIGHT));
  // side curtains (rarely drawn), at the glass plane
  float fxn = saturate(pu / Wp), fyn = saturate(pv / Hp);
  float cwid = id2 * id2 * 0.42;
  float curtM = saturate(smoothstep(cwid + 0.01, cwid - 0.01, fxn) + smoothstep(1.0 - cwid - 0.01, 1.0 - cwid + 0.01, fxn)) * (1.0 - far);
  float fabK = dayAmb * 1.6 + roomGlow * 0.2 + 0.02;
  room = lerp(room, lerp(float3(0.72, 0.68, 0.6), float3(0.5, 0.55, 0.52), id3) * fabK, curtM);
  // WL11's dressing: per-flat presence and height, a per-window deviation, crooked hems
  float rb = fmod(floor(cU / 2.0), 64.0) + fmod(cV, 64.0) * 64.0 + 1.0;
  float bkv = fmod(cU, 64.0) + fmod(cV, 64.0) * 64.0 + 1.0;
  float dressR = r.wlh(cvI + 1013.0, rb) * 0.72 + r.wlh(cvI + 1117.0, bkv) * 0.28;
  float hRoom = r.wlh(cvI + 1229.0, rb), hFloor = r.wlh(cvI + 1321.0, fmod(cV, 64.0) + 1.0), hPane = r.wlh(cvI + 1433.0, bkv);
  float fynS = saturate(fyn + (fxn - 0.5) * (r.wlh(cvI + 1553.0, bkv) * 2.0 - 1.0) * 0.07);
  float shH = clamp(lerp(0.12, 0.97, hRoom * 0.74 + hPane * 0.26), 0.05, 0.99);
  float shM = smoothstep(1.0 - shH - 0.01, 1.0 - shH + 0.01, fynS) * resi * step(dressR, 0.42) * (1.0 - far);
  float3 shC = lerp(float3(0.80, 0.76, 0.68), float3(0.60, 0.59, 0.55), id2);
  room = lerp(room, shC * (dayAmb * 1.9 + roomGlow * 0.55 + 0.02) * (0.93 + 0.07 * sin(fxn * 19.0)), shM);
  float blH = clamp(lerp(0.18, 1.0, hFloor * 0.62 + hRoom * 0.24 + hPane * 0.14), 0.05, 1.0);
  float blM = smoothstep(1.0 - blH - 0.01, 1.0 - blH + 0.01, fynS) * (1.0 - resi) * step(dressR, 0.6) * (1.0 - far);
  float slat = lerp(step(frac(fyn * 16.0), 0.72), 0.72, saturate(fpm / Hp * 16.0 * 2.0 - 0.5));
  room = lerp(room, float3(0.72, 0.73, 0.71) * (0.55 + 0.45 * slat) * (dayAmb * 1.7 + roomGlow * 0.4 + 0.02), blM);
  // the glass: tints, the dirt film, the lintel's soft occlusion
  float mottle = n.vn(float2(u * 0.3, vv * 0.3 + cvr * 19.0));
  float dust = saturate(n.vn(float2(u * 0.3, vv * 0.06 + cvr * 5.0)) * 1.6 - 0.3) * 0.3;
  float pooled = smoothstep(0.32, 0.0, (fy - y0) / max(y1 - y0, 1e-3)) * 0.4;
  float grime = clamp(0.3 + dust + pooled, 0.0, 0.9);
  float3 dirty = lerp(float3(0.05, 0.06, 0.068), float3(0.105, 0.12, 0.128), mottle);
  float tintR = r.h12(cUS * 7.7 + cvr * 43.0, cV * 3.1);
  float3 tsel = lerp(lerp(float3(0.70, 0.74, 0.77), float3(0.75, 0.78, 0.69), step(tintR, 0.66)), float3(0.64, 0.73, 0.78), step(tintR, 0.33));
  float3 roomG = room * lerp(float3(0.71, 0.78, 0.75), tsel, 0.55) * 0.86;
  rmA = lerp(roomG, dirty, grime * (1.0 - lit * 0.35));
  rmE = roomG * roomGlow * 2.2 * (1.0 - grime * 0.6);
  // (follow-up 3) the web's own brightness per lit room, the bake's window glow at the pane: fewer rooms at full light
  float bk = dot(e * e * 8.0, float3(0.2126, 0.7152, 0.0722));
  float dn = NIGHT * smoothstep(0.0, 0.35, -rd.z);   // (seen from above at night: the web's aerial look; from the street Cycles' levels hold)
  rmE *= lerp(1.0, saturate(bk / LitRef), DimK * dn) * lerp(1.0, LitK, dn);
  rmE *= lerp(float3(1, 1, 1), float3(1.12, 0.96, 0.74), WarmK * NIGHT);
  // (follow-up 3) the dark rooms not black where the glass is seen from above: the lit street below in the pane (the web's
  // warm curtain walls in the aerials; a vertical pane's reflection keeps the view's downward slope, so from the street
  // the glass mirrors the dark sky and stays as Cycles draws it), warm, varied per room, more toward grazing views
  rmD = (1.0 - lit) * dn * DarkK * float3(1.0, 0.66, 0.4) * (0.55 + 0.9 * id3) * (0.7 + 0.6 * (1.0 - rdz));
  float recess = 1.0 - 0.24 * smoothstep(0.62, 0.98, saturate(pv / Hp));
  rmA *= recess; rmE *= lerp(1.0, recess, 0.4);
  // the glass's own reflectance (BX-WIN: punched panes f0 0.075, the curtain-wall families' 0.10-0.30) x the film's and the
  // pane-to-pane weight, as UE's specular (f0 / 0.08, at most 1)
  float famR = r.h12(floor(cvr * 233.0), 31.7);
  float f0 = lerp(0.075, lerp(lerp(lerp(0.30, 0.10, step(famR, 0.84)), 0.15, step(famR, 0.62)), 0.26, step(famR, 0.30)), glS);
  float gW = (1.0 - grime * 0.7) * (0.55 + 0.9 * r.h12(cUS * 5.3, cV * 8.9 + cvr * 17.0));
  Spec = lerp(0.5, saturate(f0 * gW / 0.08), saturate(d.g));
  // (follow-up 3) the curtain walls' coated glass at BX-WIN's f0 (up to 0.30) and family tint, beyond UE's specular range
  // (f0 0.08): a metallic pane whose colour is that reflectance, the lit room's light its emission; the dark rooms show
  // the lit city in their glass instead of black
  float3 rt = lerp(lerp(lerp(float3(1.10, 0.98, 0.74), float3(0.97, 0.99, 1.02), step(famR, 0.84)), float3(0.82, 0.98, 1.02), step(famR, 0.62)), float3(1.06, 0.95, 0.80), step(famR, 0.30));
  float mt = glS * saturate(d.g) * MetalK;
  Metal = mt;
  rmA = lerp(rmA, saturate(rt * f0 * gW * F0K), mt);
  rmOn = 1.0;
}
// UELOOK10 end
'''
FAC_ROOMS_GLOW = r'''
// UELOOK10: the panes show the rooms: the lit room's emission in place of the flat lit glow, the day ambience and the
// bake's own window glow (Cycles: the bake's emission x (1 - the pane mask x 1.5))
if (rmOn > 0.5) Glow = e * e * 8.0 * EmitK * (1.0 - saturate(d.g * 1.5)) + d.g * fr * SkyC.xyz * ReflK + d.g * (rmE * RoomEK + rmD);
'''
FAC_ROOMS_ALB = r'''
// UELOOK10: the pane's albedo is the room seen through its film
if (rmOn > 0.5) alb = lerp(alb, rmA, saturate(d.g));
'''
_fa = MASTERS['facade']
assert _fa[0].count('// R9-FAC end\n') == 1 and _fa[0].count('Glow *= 1.0 - saturate(rv + frw);') == 1 and _fa[0].count('// R9-FAC: the reveal, the frame and the sill\n') == 1
MASTERS['facade'] = (_fa[0].replace('// R9-FAC end\n', '// R9-FAC end\n' + FAC_ROOMS)
                           .replace('Glow *= 1.0 - saturate(rv + frw);', FAC_ROOMS_GLOW + 'Glow *= 1.0 - saturate(rv + frw);')
                           .replace('// R9-FAC: the reveal, the frame and the sill\n', FAC_ROOMS_ALB + '// R9-FAC: the reveal, the frame and the sill\n'),
                     list(_fa[1]) + [('UV2', 'uv2'), ('UV3', 'uv3'), ('Rooms', 'ts', 'white'), ('RG0', 'v', (1.704, 1.573, 1.714, 2.326)),
                                     ('RG1', 'v', (1.734, 1.65, 1.441, 1.85)), ('RoomOn', 's', 0.0), ('RoomEK', 's', 1.0),
                                     ('WarmK', 's', 1.0), ('DimK', 's', 0.5), ('LitRef', 's', 0.25), ('MetalK', 's', 0.0), ('F0K', 's', 1.0), ('LitK', 's', 0.85), ('DarkK', 's', 0.07)],
                     list(_fa[2]) + [('Spec', 1), ('Metal', 1)]) + tuple(_fa[3:])
# UELOOK10 end
# UELOOK10 (2026-10-08): M_bx_person, the Lake's people (cpLakeside.js CP33L persons) in place of the importer's white: a
# seated figure dressed by its height in its own bounds (the head's skin over 80 %, a shirt over 42 %, trousers under,
# shoes at the floor), the shirt, the trousers, the skin and the hair from small palettes by the person's seed (custom
# primitive data 0, ue_mat.persons: the same seed on a person's hair and body)
PERSON = r'''
float sd = GetPrimitiveData(Parameters).CustomPrimitiveData[0].x;
float3 bmin = GetPrimitiveData(Parameters).LocalObjectBoundsMin, bmax = GetPrimitiveData(Parameters).LocalObjectBoundsMax;
float hz = saturate((LP.z - bmin.z) / max(bmax.z - bmin.z, 1.0));
float h1 = frac(sin(sd * 91.7 + 0.31) * 43758.55), h2 = frac(sin(sd * 37.3 + 1.7) * 43758.55);
float h3 = frac(sin(sd * 53.9 + 4.1) * 43758.55), h4 = frac(sin(sd * 17.1 + 8.3) * 43758.55);
float3 SH[8] = { float3(0.62, 0.62, 0.6), float3(0.05, 0.07, 0.15), float3(0.42, 0.06, 0.05), float3(0.33, 0.43, 0.58),
                 float3(0.2, 0.22, 0.12), float3(0.6, 0.45, 0.1), float3(0.22, 0.22, 0.23), float3(0.58, 0.3, 0.35) };
float3 TR[4] = { float3(0.07, 0.1, 0.17), float3(0.34, 0.29, 0.2), float3(0.03, 0.03, 0.03), float3(0.15, 0.15, 0.16) };
float3 SK[4] = { float3(0.45, 0.3, 0.22), float3(0.3, 0.18, 0.12), float3(0.6, 0.43, 0.33), float3(0.17, 0.1, 0.07) };
float3 HA[4] = { float3(0.03, 0.02, 0.015), float3(0.12, 0.07, 0.03), float3(0.26, 0.18, 0.09), float3(0.05, 0.04, 0.035) };
float3 c = hz > 0.8 ? SK[min((int)(h3 * 4.0), 3)] : (hz > 0.42 ? SH[min((int)(h1 * 8.0), 7)] : TR[min((int)(h2 * 4.0), 3)]);
if (hz < 0.05) c = float3(0.05, 0.045, 0.04);
if (Hair > 0.5) c = HA[min((int)(h4 * 4.0), 3)];
Rough = Hair > 0.5 ? 0.5 : 0.75;
return c;
'''
MASTERS['person'] = (PERSON, [('LP', 'lp'), ('Hair', 's', 0.0)], [('Rough', 1)], {'two_sided': True})
# UELOOK10 end
# UELOOK10 (2026-10-08): M_bx_bronze, cpBethesdaKit.js patinaBronze: a dark brown metal where the rain washes it, a
# green-grey verdigris (a mineral: rougher, no metallic reflection) in the recesses (the scan's cavity map where there is
# one, else the hollows of a world-space noise) and in streaks drawn down from the upward faces
BRONZE = r'''
float3 P = float3(WP.x * 0.01, WP.z * 0.01, WP.y * 0.01);
float3 Nn = normalize(float3(NW.x, NW.z, NW.y));
struct BXB {
  float h(float3 p) { return frac(sin(dot(p, float3(127.1, 311.7, 74.7))) * 43758.5453); }
  float n3(float3 p) { float3 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(lerp(h(i), h(i + float3(1, 0, 0)), f.x), lerp(h(i + float3(0, 1, 0)), h(i + float3(1, 1, 0)), f.x), f.y),
                lerp(lerp(h(i + float3(0, 0, 1)), h(i + float3(1, 0, 1)), f.x), lerp(h(i + float3(0, 1, 1)), h(i + float3(1, 1, 1)), f.x), f.y), f.z); }
};
BXB b;
float cav = HasCav > 0.5 ? smoothstep(0.16, 0.72, Texture2DSample(Cav, CavSampler, UV0).r) : 0.3 + 0.7 * (0.65 * b.n3(P * 7.0) + 0.35 * b.n3(P * 23.0));
float streak = b.n3(float3(P.x * 16.0, P.y * 0.9, P.z * 16.0));
float pat = smoothstep(0.1, 0.85, saturate((1.0 - cav) * 1.05 + saturate(Nn.y) * 0.3 + (streak - 0.5) * 0.55) * Amt * 1.4);
Rough = lerp(0.34, 0.8, pat);
Metal = lerp(0.62, 0.06, pat);
return lerp(Base.xyz, Verd.xyz, pat) * (0.86 + 0.28 * b.n3(P * 61.0));
'''
MASTERS['bronze'] = (BRONZE, [('WP', 'wp'), ('NW', 'nw'), ('UV0', 'uv0'), ('Base', 'v', (0.051, 0.033, 0.023, 0)), ('Verd', 'v', (0.122, 0.223, 0.159, 0)),
                              ('Amt', 's', 0.55), ('HasCav', 's', 0.0), ('Cav', 'tl', 'white')],
                     [('Rough', 1), ('Metal', 1)], {})
# UELOOK10 end
# UELOOK10 (2026-10-08): the plain master with the web's alpha (usd_write writes it as the web draws it: the map's alpha,
# or the alphaMap's red, x the opacity, only for alphaTest or transparent materials): M_bx_plain_mask, cut at the
# material's alphaTest (the instance's clip value), and M_bx_plain_blend, alpha-blended (ue_mat.web_alpha)
PLAIN_ALPHA = r'''
// UELOOK10: the web's alpha: the opacity texture's alpha (OpCh 0) or red (OpCh 1, an alphaMap), x the opacity
float4 ot = Texture2DSample(OpTex, OpTexSampler, tuv);
float al = ((HasOp > 0.5) ? lerp(ot.a, ot.r, OpCh) : 1.0) * OpK;
'''
_PL_END = 'return max(c * Gain.xyz * BaseK, 0.0);'
assert MASTERS['plain'][0].count(_PL_END) == 1
_PL_IN = list(MASTERS['plain'][1]) + [('OpTex', 'ts', 'white'), ('HasOp', 's', 0.0), ('OpCh', 's', 0.0), ('OpK', 's', 1.0)]
MASTERS['plain_mask'] = (MASTERS['plain'][0].replace(_PL_END, PLAIN_ALPHA + 'Mask = al;\n' + _PL_END), _PL_IN,
                         list(MASTERS['plain'][2]) + [('Mask', 1)], dict(MASTERS['plain'][3], blend='masked'))
MASTERS['plain_blend'] = (MASTERS['plain'][0].replace(_PL_END, PLAIN_ALPHA + 'Opacity = al;\n' + _PL_END), _PL_IN,
                          list(MASTERS['plain'][2]) + [('Opacity', 1)], dict(MASTERS['plain'][3], blend='translucent', forward=True))
# and M_bx_plain_add for the web's additive ones (AdditiveBlending: the glow sprites): unlit, the colour x its alpha added to
# what is behind (premultiplied with no coverage)
MASTERS['plain_add'] = (MASTERS['plain'][0].replace(_PL_END, PLAIN_ALPHA + 'Opacity = 0.0;\nreturn max(c * Gain.xyz * BaseK + Glow, 0.0) * al;'), _PL_IN,
                        list(MASTERS['plain'][2]) + [('Opacity', 1)], dict(MASTERS['plain'][3], blend='composite', unlit=True))
# UELOOK10 end



# AAA11 (2026-10-08): layered weathering over the HQ CC0 sets, every layer a mask in the surface's own frame (no decal,
# no added object) and deterministic (world position, the facade's metres, a building's grid; no time), each feature
# faded to its mean before it shrinks under a few pixels, so the frames hold still:
# - the facade bake (M_bx_facade): a building's own tone and roughness (a lottery on its grid and style, a 20-30 m
#   drift), grime rising from the street with a ragged top and the contact line at the sidewalk, streaks under the
#   openings and from their corners (the bake's window mask above the pixel, sampled at the wall's own texel scale from
#   the pixel's footprint), soot over the window heads, cavity darkening round every opening, dust and soot on the roofs
#   and ledges, the CC0 class normals again at 4.3x their frequency at close range (gone past 4 cm a pixel);
# - the ground (M_bx_ground6, M_bx_ground): the web's GP31 street wear laid out from the kerbs (ue_prep's kerb frame,
#   UV 2-3): tyre tracks two per lane, polished and darker, the oil line between them and the parked cars' drips, saw-cut
#   utility patches, a crack net on the old pours, dust at the kerb, cracked flags and gum (GP31's discs), kerb grime and
#   the gutter wet at night (AaN, the take's night);
# - the viaducts' steel (M_bx_vk): rust runs below the rust field, the paint blistered round each spot, water stains and
#   weathering streaks;
# - the pbr sets (kit and landmark walls): a tone per material, roughness drift, rain streaks below the ledges, dust on
#   the upward faces;
# - stone on M_bx_plain (the web's limestone, granite, marble, Bethesda's and the park's stone: ue_families.json aaa11,
#   AaW > 0 only there): weathering streaks, stains, dust on the upward faces.
AAA_FAC = r'''
// AAA11: the facade's weathering (see ue_masters.py AAA11)
if (AaOn > 0.5) {
  float aaV = 1.0 - UV0.y, aaU = UV0.x;   // height above the building's base, metres along the wall (fst; UE flipped v)
  float3 aaNw = normalize(NW);
  float aaWin = smoothstep(0.35, 0.65, d.g);
  float aaWall = (1.0 - aaWin) * (1.0 - frw);
  float aaVert = 1.0 - smoothstep(0.55, 0.8, abs(aaNw.z));
  float2 aaD0x = ddx(UV0), aaD0y = ddy(UV0), aaGx = ddx(UV1), aaGy = ddy(UV1);
  float aaFw = max(length(aaD0x), length(aaD0y));   // metres a pixel
  // the atlas' scale (uv a metre) from the footprint: one value inside a chart; clamped where a pixel quad spans a seam
  float aaUpm = clamp((length(aaGx) + length(aaGy)) / max(length(aaD0x) + length(aaD0y), 1e-6), 0.0003, 0.006);
  float aaSeed = frac(UV2.x * 7.31 + UV2.y * 3.17 + UV3.y * 0.618);   // the building's grid and style
  // 1. the building's own tone and roughness
  float aaTn = 1.0 + (n.h1(float2(aaSeed * 97.0, 3.1)) - 0.5) * 2.0 * AaTone;
  aaTn *= lerp(1.0 - AaDrift, 1.0 + AaDrift, n.fbm(float2(aaU, aaV) * 0.045 + aaSeed * 41.0));
  alb *= lerp(1.0, aaTn, aaWall);
  Rough = saturate(Rough + (n.fbm(float2(aaU, aaV) * 0.35 + aaSeed * 13.0) - 0.5) * AaRvar * aaWall);
  // 2. grime rising from the street (a ragged top, 1.4-2.6 m) and the contact line at the sidewalk
  float aaGt = AaGrimeH + (n.fbm(float2(aaU * 0.55, aaSeed * 9.0)) - 0.5) * 1.2;
  float aaGr = (1.0 - smoothstep(-0.2, aaGt, aaV)) * aaVert;
  float aaCt = (1.0 - smoothstep(-0.05, 0.22, aaV)) * aaVert;
  // 3. streaks under the openings and from their corners: the window mask above, down a striated run; soot over the
  //    window heads; the cavity round every opening (the mask blurred against itself)
  float aaStk = 0.0, aaHd = 0.0, aaCv = 0.0;
  if (aaVert > 0.01) {
    float2 aaUp = float2(0.0, -aaUpm), aaSd = float2(aaUpm, 0.0);
    float aaM1 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 0.30, aaGx * 2.0, aaGy * 2.0).g;
    float aaM2 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 0.85, aaGx * 3.0, aaGy * 3.0).g;
    float aaM3 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 1.60, aaGx * 4.0, aaGy * 4.0).g;
    float aaRun = max(max(smoothstep(0.2, 0.6, aaM1), smoothstep(0.2, 0.6, aaM2) * 0.7), smoothstep(0.2, 0.6, aaM3) * 0.42);
    float aaL1 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 0.6 - aaSd * 0.16, aaGx * 2.0, aaGy * 2.0).g;
    float aaR1 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 0.6 + aaSd * 0.16, aaGx * 2.0, aaGy * 2.0).g;
    float aaL2 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 1.8 - aaSd * 0.16, aaGx * 3.0, aaGy * 3.0).g;
    float aaR2 = Texture2DSampleGrad(Dat, DatSampler, UV1 + aaUp * 1.8 + aaSd * 0.16, aaGx * 3.0, aaGy * 3.0).g;
    float aaCor = max(abs(smoothstep(0.2, 0.6, aaL1) - smoothstep(0.2, 0.6, aaR1)), abs(smoothstep(0.2, 0.6, aaL2) - smoothstep(0.2, 0.6, aaR2)) * 0.6);
    // thin runs (a fifth of the width under an opening; their mean once under ~3 pixels a run), so the wall between the
    // windows keeps its tone and the windows their contrast at range
    float aaS1 = lerp(0.28, smoothstep(0.45, 0.80, n.vn(float2(aaU * 7.0, aaV * 0.45) + aaSeed * 17.0)), saturate(1.0 - aaFw * 14.0));
    float aaS2 = lerp(0.3, smoothstep(0.45, 0.8, n.vn(float2(aaU * 3.1, aaV * 0.25) + aaSeed * 5.0 + 9.0)), saturate(1.0 - aaFw * 6.0));
    aaStk = (aaRun * (0.18 + 0.82 * aaS1) + aaCor * aaS2 * 0.9) * (1.0 - aaWin);
    // (the soot over the heads and the cavity's halo are close-range terms: a halo a few pixels round a window that is a
    // few pixels itself softens it, so both fade out by 10-17 cm a pixel; the halo's width is 0.25 m on the wall)
    float aaB = Texture2DSampleGrad(Dat, DatSampler, UV1 - aaUp * 0.22, aaGx * 2.0, aaGy * 2.0).g;
    aaHd = smoothstep(0.2, 0.6, aaB) * (1.0 - aaWin) * saturate(1.0 - aaFw * 6.0);
    float aaBk = clamp(0.25 / max(aaFw, 1e-4), 1.0, 32.0);
    float aaBl = Texture2DSampleGrad(Dat, DatSampler, UV1, aaGx * aaBk, aaGy * aaBk).g;
    aaCv = saturate((aaBl - aaWin) * 1.6) * saturate(1.0 - aaFw * 8.0);
  }
  alb = lerp(alb, alb * float3(0.44, 0.41, 0.37), saturate(aaGr * AaGrime + aaCt * 0.5) * aaWall);
  alb *= 1.0 - saturate(aaStk * AaStreak) * aaWall;
  alb *= 1.0 - aaHd * AaSoot * aaWall;
  alb *= 1.0 - aaCv * AaCav * aaWall;
  Rough = saturate(Rough + (aaGr * 0.08 + aaStk * 0.05) * aaWall);
  // 4. the roofs and ledges: settled dust and soot in blotches; the sills' tops a little darker
  float aaUpF = smoothstep(0.6, 0.85, aaNw.z);
  float aaDu = smoothstep(0.35, 0.75, n.fbm(UV0 * 0.6 + aaSeed * 7.0));
  alb = lerp(alb, alb * 0.72 + float3(0.022, 0.020, 0.017), aaUpF * (0.35 + 0.4 * aaDu) * AaDust);
  alb = lerp(alb, alb * 0.85, sl * 0.5 * AaDust);
  // 5. the CC0 class normals (brick, stone, plaster: the HQ block's classes) at 4.3x their frequency at close range
  if (HqOn > 0.5 && AaDet > 0.0) {
    float aaLm = dot(a.rgb, float3(0.2126, 0.7152, 0.0722));
    float aaWb = saturate((a.r / max(a.g, 0.002) - 1.25) * 3.0);
    float aaWs = (1.0 - aaWb) * saturate((aaLm - 0.16) * 6.0) * saturate((a.r / max(a.b, 0.002) - 1.0) * 3.0) * (1.0 - smoothstep(0.32, 0.45, aaLm));
    float aaWc = saturate(1.0 - aaWb - aaWs);
    float3 aaDn = Texture2DSample(HBN, HBNSampler, UV0 * (4.3 / HSz.x) + 0.37).rgb * aaWb
                + Texture2DSample(HSN, HSNSampler, UV0 * (4.3 / HSz.y) + 0.37).rgb * aaWs
                + Texture2DSample(HCN, HCNSampler, UV0 * (4.3 / HSz.z) + 0.37).rgb * aaWc;
    aaDn = aaDn * 2.0 - 1.0;
    float aaDk = AaDet * saturate(1.0 - aaFw * 25.0) * aaWall;
    tnF = normalize(tnF);
    tnF.xy += float2(aaDn.x, -aaDn.y) * aaDk;
  }
}
'''
AAA_GND = r'''
// AAA11: the street's wear from the kerbs (the web's GP31; see ue_masters.py AAA11)
if (AaOn > 0.5) {
  float aaFw = max(abs(ddx(P.x)) + abs(ddy(P.x)), abs(ddx(P.z)) + abs(ddy(P.z)));   // the web's gFw: metres a pixel
  float aaHh = max(aaFw * 0.5, 0.0006);
  bool aaOk = UV1.y > 0.5;
  float aaKQ = UV2.x, aaKD = UV2.y, aaKW = UV3.x, aaKA = UV3.y;
  bool aaOk2 = aaOk && aaKW > 0.005;
  float2 aaKn = float2(cos(aaKA), sin(aaKA)), aaKt = float2(-aaKn.y, aaKn.x);
  float aaQx = g.x;
  if (aaOk) {
    aaQx = dot(P.xz, aaKt);
    float aaCa = dot(aaKt, float2(0.8744, 0.4853)), aaCb = dot(aaKt, float2(-0.4853, 0.8744));
    if (abs(aaCa) > 0.99756) aaQx = g.x * sign(aaCa);
    else if (abs(aaCb) > 0.99756) aaQx = g.y * sign(aaCb);
  }
  float aaLv = smoothstep(1.4, 0.35, aaFw);
  // tyre tracks: two per travel lane 0.85 m either side of its centre, an 8 ft parking lane each side; the oil line
  // between the tracks, the parked cars' drips in the parking lane; tracks that come and go along the street
  float aaTrk = 0.0, aaDrip = 0.0, aaLane = 0.0, aaOil = 0.0, aaDust = 0.0;
  if (aaOk) {
    float aaW = aaOk2 ? aaKW : 40.0;
    float aaNL = max(1.0, floor((aaW - 4.8) / 3.2 + 0.35));
    float aaLw = max((aaW - 4.8) / aaNL, 2.8);
    float aaLc = (aaKQ - 2.4) / aaLw;
    float aaDl = abs(frac(aaLc) - 0.5) * aaLw;
    float aaInL = smoothstep(2.2, 2.6, aaKD);
    aaLane = floor(aaLc);
    aaTrk = aaInL * smoothstep(0.62, 0.28, abs(aaDl - 0.85));
    aaDrip = aaInL * smoothstep(0.36, 0.10, aaDl);
    float aaSide = step(aaW * 0.5, aaKQ) * (aaOk2 ? 1.0 : 0.0);
    float aaPc = aaQx / 6.3 + aaSide * 0.37;
    float2 aaPid = float2(floor(aaPc), aaSide);
    if (n.h1(aaPid + 3.1) < 0.55) {
      float2 aaPd = float2((frac(aaPc) - 0.25 - 0.5 * n.h1(aaPid + 7.7)) * 6.3, aaKD - 1.1 - 0.5 * n.h1(aaPid + 1.9));
      aaOil = smoothstep(0.42, 0.12, length(aaPd * float2(0.7, 1.0))) * (1.0 - aaInL) * 0.8 * aaLv;
    }
    aaDust = smoothstep(1.3, 0.35, aaKD);
  } else {
    float aaL2 = g.y / 3.35 + n.h1(lot + 61.3);
    float aaDl = abs(frac(aaL2) - 0.5) * 3.35;
    aaLane = floor(aaL2);
    aaTrk = smoothstep(0.62, 0.28, abs(aaDl - 0.85));
    aaDrip = smoothstep(0.36, 0.10, aaDl);
  }
  aaTrk *= smoothstep(0.22, 0.62, n.vn(float2(aaQx * 0.035, aaLane * 3.1 + 5.0))) * (0.45 + 0.55 * n.h1(float2(aaLane, lot.x + 3.0 * lot.y)));
  aaDrip *= smoothstep(0.35, 0.78, n.vn(float2(aaQx * 0.09, aaLane * 7.3 + 1.0)));
  float aaWh = aaTrk * aaLv;
  aaOil = max(aaOil, aaDrip * aaLv * 0.55);
  // utility cuts: saw-cut rectangles 1-3 m across, a few levels off the road (a new one far darker), behind a dark kerf
  float aaCut = 0.0, aaKerf = 0.0, aaFresh = 0.5, aaSeal = 0.0;
  {
    float2 aaCs = float2(13.0, 8.0), aaCc = floor(g / aaCs), aaCf = frac(g / aaCs);
    float aaCr = n.h1(aaCc + 17.9);
    if (aaCr < 0.26 * lerp(1.0, 0.45, young)) {
      float2 aaP0 = float2(n.h1(aaCc + 3.1), n.h1(aaCc + 5.7)) * 0.52 + 0.08;
      float2 aaSz = (aaCr < 0.13) ? float2(0.075 + n.h1(aaCc + 9.3) * 0.085, 0.175 + n.h1(aaCc + 11.1) * 0.2)
                                  : float2(0.135 + n.h1(aaCc + 9.3) * 0.15, 0.08 + n.h1(aaCc + 11.1) * 0.09);
      float2 aaPq = aaCf * aaCs, aaLo = aaP0 * aaCs, aaHi = (aaP0 + aaSz) * aaCs;
      float2 aaDq = max(aaLo - aaPq, aaPq - aaHi);
      float aaSdf = length(max(aaDq, 0.0)) + min(max(aaDq.x, aaDq.y), 0.0);
      aaCut = saturate(0.5 - aaSdf / (2.0 * aaHh));
      aaFresh = n.h1(aaCc + 23.0);
      float aaKw = 0.010 + 0.008 * n.vn(aaPq * 9.0 + aaCc);
      aaKerf = saturate((aaKw - abs(aaSdf)) / aaHh + 0.5) * saturate(aaKw / aaHh);
      // a sealant overband (3.5-5.5 cm, smooth and dark) on a third of the cuts
      if (n.h1(aaCc + 31.7) < 0.6) { float aaOw = 0.03 + 0.015 * n.h1(aaCc + 2.9); aaSeal = saturate((aaOw - abs(aaSdf)) / aaHh + 0.5) * saturate(aaOw / aaHh); }
    }
  }
  // the crack net of an old pour: the borders of a warped 2.4-3.4 m cell grid, 1.5-6.5 mm wide (box-filtered)
  float aaCrk = 0.0;
  {
    float2 aaWp = g + (float2(n.vn(g * 0.42), n.vn(g * 0.42 + 7.7)) - 0.5) * 0.9 + (float2(n.vn(g * 3.3 + 1.3), n.vn(g * 3.3 + 4.1)) - 0.5) * 0.12;
    float aaCz = lerp(3.4, 2.4, n.h1(lot + 8.8));
    float2 aaCq = aaWp / aaCz, aaCi = floor(aaCq), aaCfr = frac(aaCq);
    float aaDx = min(aaCfr.x, 1.0 - aaCfr.x), aaDy = min(aaCfr.y, 1.0 - aaCfr.y);
    float2 aaBid = (aaDx < aaDy) ? float2(aaCi.x + step(0.5, aaCfr.x), aaCi.y * 0.37 + 101.0) : float2(aaCi.x * 0.37 + 211.0, aaCi.y + step(0.5, aaCfr.y));
    float aaBd = min(aaDx, aaDy) * aaCz;
    float aaCon = step(n.h1(aaBid + 5.5), lerp(0.55, 0.15, young));
    float aaCw = (0.0015 + 0.005 * n.vn(float2(dot(aaWp, float2(0.7071, 0.7071)) * 1.3, aaBid.x * 0.1 + aaBid.y))) * aaCon;
    aaCrk = saturate((aaCw - aaBd) / aaHh + 0.5) * saturate(aaCw / aaHh);
    // sealed runs ("tar snakes"): a third of the old pour's cracked borders under a 2-3.5 cm smooth band of sealant
    float aaSw = (0.014 + 0.010 * n.vn(float2(dot(aaWp, float2(0.7071, -0.7071)) * 0.9, aaBid.y * 0.1 + aaBid.x))) * aaCon * step(n.h1(aaBid + 9.1), 0.55);
    aaSeal = max(aaSeal, saturate((aaSw - aaBd) / aaHh + 0.5) * saturate(aaSw / aaHh));
    // the cold joint where two pours meet (the lot lottery's borders), opened as a crack
    float2 aaLq = abs(frac(float2(g.x / 82.0, g.y / 76.0) + n.fbm(g * 0.013) * 0.075) - 0.5);
    float aaJd = min((0.5 - aaLq.x) * 82.0, (0.5 - aaLq.y) * 76.0);
    float aaJw = 0.003 + 0.004 * n.vn(g * 0.7 + 3.0);
    aaCrk = max(aaCrk, saturate((aaJw - aaJd) / aaHh + 0.5) * saturate(aaJw / aaHh));
  }
  // the flags: a crack across one flag in six; gum (GP31's discs 1-3 cm, thicker where people wait), their mean past
  // resolution; the splash band along the kerb
  float aaW1 = (abs(k - 1) < 0.5 || abs(k - 17) < 0.5) ? 1.0 : 0.0;
  float aaFc = 0.0;
  if (n.h1(fid + 41.3) < 0.18) {
    float aaAn = n.h1(fid + 7.9) * 3.14159;
    float2 aaFp = ff * 1.52 - (float2(n.h1(fid + 2.2), n.h1(fid + 3.3)) * 0.8 + 0.36);
    float aaFd = dot(aaFp, float2(cos(aaAn), sin(aaAn))) + (n.vn(ff * 9.0 + fid) - 0.5) * 0.05;
    float aaFcw = 0.0012 + 0.0018 * n.vn(ff * 4.0 + fid * 1.3);
    aaFc = saturate((aaFcw - abs(aaFd)) / aaHh + 0.5) * saturate(aaFcw / aaHh);
  }
  float aaGum = 0.0; float3 aaGumC = float3(0.05, 0.05, 0.05);
  float aaDens = 0.18 + 0.40 * smoothstep(0.3, 0.8, n.vn(g * 0.035 + 7.0));
  float aaGv = smoothstep(0.016, 0.005, aaFw);
  {
    float2 aaMc = g / 0.15, aaMid = floor(aaMc);
    float aaMh = n.h1(aaMid + 91.7);
    if (aaMh < aaDens) {
      float2 aaMp = (frac(aaMc) - float2(n.h1(aaMid + 4.7), n.h1(aaMid + 12.1)) * 0.7 - 0.15) * 0.15;
      float aaR = 0.005 + 0.010 * frac(aaMh * 53.0);
      float aaDd = length(aaMp * float2(1.0, 0.8 + 0.4 * frac(aaMh * 17.0))) / aaR;
      float aaAw = clamp(0.7 * aaFw / aaR, 0.28, 1.0);
      aaGum = smoothstep(1.0 + 0.5 * aaAw, 1.0 - aaAw, aaDd) * aaGv;
      aaGumC = lerp(float3(0.030, 0.029, 0.028), float3(0.110, 0.106, 0.100), frac(aaMh * 7.0));
    }
  }
  // the gutter at night: a wet film within ~0.8 m of the kerb on the road side, in patches along the street
  float aaWet = 0.0;
  if (AaN > 0.0 && aaOk) aaWet = AaN * AaWet * smoothstep(1.2, 0.3, aaKD) * smoothstep(0.28, 0.62, n.fbm(float2(aaQx * 0.12, aaKD * 0.8) + 3.7));
  float aaAs = isA;
  float aaPt = isPW + isPY;
  float3 aaFill = alb * ((aaFresh < 0.18) ? 0.40 + 0.9 * aaFresh : 0.66 + 0.58 * (aaFresh - 0.18) / 0.82);
  alb = lerp(alb, aaFill, aaCut * aaAs);
  Rough = lerp(Rough, 0.90 + 0.05 * aaFresh, aaCut * aaAs);
  alb *= 1.0 - aaKerf * 0.75 * (aaAs + aaPt);
  alb *= 1.0 - aaCrk * 0.8 * (aaAs + aaPt) * (1.0 - aaCut);
  alb = lerp(alb, alb * 0.35, aaSeal * (aaAs + aaPt));
  Rough = lerp(Rough, 0.28, aaSeal * (aaAs + aaPt));
  alb *= 1.0 - aaWh * 0.24 * (aaAs + 0.6 * aaPt);
  Rough -= aaWh * 0.34 * (aaAs + aaPt);
  alb = lerp(alb, alb * 0.5, aaOil * aaAs);
  Rough = lerp(Rough, 0.62, aaOil * aaAs);
  alb = lerp(alb, float3(0.16, 0.15, 0.13), aaDust * 0.40 * aaAs * (1.0 - aaWet));
  alb *= 1.0 - aaFc * 0.6 * aaW1;
  // the flags' stains (one in four, a broad blotch 20-38 % darker and warmer) and the grit packed in their joints
  float aaFs = step(n.h1(fid + 63.1), 0.25) * smoothstep(0.42, 0.75, n.fbm(ff * 2.2 + fid * 0.37));
  alb = lerp(alb, alb * float3(0.66, 0.62, 0.56), aaFs * lerp(0.6, 1.0, n.h1(fid + 5.1)) * aaW1);
  float aaJd = min(min(ff.x, 1.0 - ff.x), min(ff.y, 1.0 - ff.y)) * 1.52;
  float aaJw = 0.006;
  alb *= 1.0 - 0.35 * saturate((aaJw - aaJd) / aaHh + 0.5) * saturate(aaJw / aaHh) * aaW1;
  alb = lerp(alb, aaGumC, aaGum * 0.92 * isW);
  Rough = lerp(Rough, 0.55, aaGum * 0.6 * isW);
  alb *= 1.0 - (1.0 - aaGv) * aaDens * 0.012 * isW;
  alb *= 1.0 - 0.20 * smoothstep(0.6, 0.05, aaKD) * aaW1 * (aaOk ? 1.0 : 0.0);
  // the kerb: grime blotches, darker on the face toward the gutter
  float aaKg = smoothstep(0.35, 0.75, n.fbm(float2(dot(P.xz, kt) * 0.8, P.y * 5.0) + 2.9));
  alb *= 1.0 - isK * (0.18 + 0.22 * aaKg) * (abs(N.y) < 0.7 ? 1.0 : 0.6);
  alb *= 1.0 - 0.4 * aaWet;
  Rough = saturate(lerp(Rough, 0.06, aaWet));
}
'''
AAA_VK = r'''
// AAA11: the steel's weathering (see ue_masters.py AAA11)
if (AaOn > 0.5) {
  float aaFw = max(length(ddx(P)), length(ddy(P)));
  float aaVrt = 1.0 - smoothstep(0.5, 0.8, abs(N.y));
  // rust runs: the rust field 0.2-2 m above, down a striated run
  float aaRun = 0.0;
  float2 aaQ1 = q + float2(0.0, 0.22), aaQ2 = q + float2(0.0, 0.88), aaQ3 = q + float2(0.0, 1.98);
  float aaE0 = 1.0 - RustAmt * 0.8;
  float aaE1 = aaE0 - 0.12;   // (runs start from spots a little short of the rust's own threshold too)
  aaRun = max(aaRun, smoothstep(aaE1, aaE1 + 0.2, n.fbm(aaQ1 * 1.7 + 3.0 + Seed) * 0.6 + n.fbm(aaQ1 * 9.0 + 1.0) * 0.4) * 1.0);
  aaRun = max(aaRun, smoothstep(aaE1, aaE1 + 0.2, n.fbm(aaQ2 * 1.7 + 3.0 + Seed) * 0.6 + n.fbm(aaQ2 * 9.0 + 1.0) * 0.4) * 0.75);
  aaRun = max(aaRun, smoothstep(aaE1, aaE1 + 0.2, n.fbm(aaQ3 * 1.7 + 3.0 + Seed) * 0.6 + n.fbm(aaQ3 * 9.0 + 1.0) * 0.4) * 0.4);
  float aaS1 = lerp(0.45, smoothstep(0.35, 0.75, n.vn(float2(q.x * 6.0, q.y * 0.5) + Seed * 3.0)), saturate(1.0 - aaFw * 12.0));
  aaRun *= aaS1 * aaVrt * (1.0 - rust);
  // the paint blistered and lifted round each rust spot
  float aaHalo = saturate(smoothstep(aaE0 - 0.10, aaE0, r) - rust);
  // water stains and weathering streaks (low frequency, the streaks striated)
  float aaSt = smoothstep(0.5, 0.85, n.fbm(float2(q.x * 0.35, q.y * 0.9) + Seed * 7.0 + 4.0));
  float aaS2 = lerp(0.5, smoothstep(0.35, 0.8, n.vn(float2(q.x * 4.0, q.y * 0.3) + 13.0)), saturate(1.0 - aaFw * 8.0));
  float aaWs = smoothstep(0.5, 0.8, n.fbm(float2(q.x * 0.6, q.y * 0.1) + Seed + 21.0)) * aaS2 * aaVrt;
  float3 aaRc = lerp(RustC.xyz, RustD.xyz, 0.4);
  alb = lerp(alb, alb * 0.3 + aaRc * 0.9, saturate(aaRun * AaRun));   // (rust-brown runs, not just darker paint)
  alb = lerp(alb, alb * 1.18 + float3(0.022, 0.013, 0.004), aaHalo * AaBloom);
  alb *= 1.0 - aaSt * AaStain - aaWs * AaWs;
  Rough = saturate(Rough + aaRun * 0.1 + aaSt * 0.05);
}
'''
AAA_PBR = r'''
// AAA11: the pbr walls' weathering (see ue_masters.py AAA11)
if (AaOn > 0.5) {
  float aaFw = max(length(ddx(P)), length(ddy(P)));
  float aaVrt = 1.0 - smoothstep(0.55, 0.8, abs(N.y));
  float2 aaH2 = normalize(float2(-N.z, N.x) + 1e-5);
  float aaAl = dot(P.xz, aaH2);
  float aaD = saturate(dirt * 2.0 + 0.4);   // the material's own dirt, at least two fifths
  alb *= (1.0 + (n.h1(float2(Seed * 0.731 + 3.3, 1.7)) - 0.5) * 2.0 * AaTone) * lerp(1.0 - AaTone, 1.0 + AaTone, n.fbm(P.xz * 0.04 + P.y * 0.03 + Seed * 0.1 + 2.0));
  Rough = saturate(Rough + (n.fbm(P.xz * 0.3 + P.y * 0.2 + Seed) - 0.5) * AaRvar);
  float aaS1 = lerp(0.5, smoothstep(0.35, 0.8, n.vn(float2(aaAl * 7.0, P.y * 0.4) + Seed)), saturate(1.0 - aaFw * 14.0));
  float aaS2 = smoothstep(0.40, 0.75, n.fbm(float2(aaAl * 0.5, P.y * 0.09) + 7.0 + Seed));
  float aaS3 = lerp(0.5, smoothstep(0.3, 0.75, n.vn(float2(aaAl * 1.6, P.y * 0.12) + Seed + 9.0)), saturate(1.0 - aaFw * 3.0));   // wider runs that hold at range
  alb *= 1.0 - (aaS1 * 0.5 + aaS3 * 0.5) * aaS2 * aaVrt * AaStreak * aaD;
  // the kit's own streak mask (aGrime: the quads under each sill and the soot under the top, facadeKit.js) drawn as the
  // web's pbrLib does, through the fall-line noise, so the runs line up under the openings; soot in patches over the wall
  // (pbrLib's AR34 w2 smudges, wider than tall) and under the roof line (the kit's topY or the material's)
  float aaSk = n.vn(float2(aaAl * 2.6 + Seed * 5.3, P.y * 0.11)) * 0.65 + n.vn(float2(aaAl * 7.9 - Seed, P.y * 0.35)) * 0.35;
  float aaKg = (FkOn > 0.5) ? saturate(UV2.y) : 0.0;
  alb *= 1.0 - aaKg * lerp(0.45, 1.0, smoothstep(0.35, 0.8, aaSk)) * AaKit * aaVrt;
  float aaPt = smoothstep(0.5, 0.82, n.fbm(float2(aaAl * 0.42, P.y * 0.85) + Seed * 4.7)) * (0.55 + 0.45 * n.vn(float2(aaAl * 3.1, P.y * 2.3) - Seed));
  alb *= 1.0 - aaPt * AaSootP * aaVrt * aaD;
  float aaTop = (FkOn > 0.5 && UV3.y > 0.0) ? UV3.y : TopY;
  float aaRs = smoothstep(aaTop - 3.5, aaTop - 0.25, P.y + (n.fbm(float2(aaAl * 1.9, P.y * 1.3) + Seed * 3.1) - 0.5) * 1.2) * step(P.y, aaTop + 0.5);
  alb *= 1.0 - aaRs * 0.3 * aaVrt * aaD;
  // grime rising from the street (BaseY, as the splash zone above; a ragged 1.6-3 m top)
  float aaHg = P.y - BaseY;
  float aaGt = 1.9 + (n.fbm(float2(aaAl * 0.5, 3.7) + Seed) - 0.5) * 1.2;
  alb = lerp(alb, alb * float3(0.45, 0.42, 0.38), (1.0 - smoothstep(-0.2, aaGt, aaHg)) * step(-0.5, aaHg) * aaVrt * AaGrime);
  float aaUp = smoothstep(0.6, 0.85, N.y);
  alb = lerp(alb, alb * 0.78 + float3(0.02, 0.018, 0.016), aaUp * AaDust * smoothstep(0.3, 0.7, n.fbm(P.xz * 0.5 + Seed)));
}
'''
AAA_PL_N = r'''
struct AAN {
  float h1(float2 p) { p = frac(p * float2(123.34, 456.21)); p += dot(p, p + 45.32); return frac(p.x * p.y); }
  float vn(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f);
    return lerp(lerp(h1(i), h1(i + float2(1, 0)), f.x), lerp(h1(i + float2(0, 1)), h1(i + float2(1, 1)), f.x), f.y); }
  float fbm(float2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.01 + 3.3) + 0.125 * vn(p * 8.13 + 1.7); }
};
AAN aan;
'''
AAA_PL = r'''
// AAA11: stone weathering (AaW > 0: ue_families.json aaa11's stone materials; see ue_masters.py AAA11)
if (AaW > 0.0) {
  float3 aaP = WP * 0.01; float3 aaN = normalize(NW);   // (UE's axes: z up)
  float2 aaH2 = normalize(float2(-aaN.y, aaN.x) + 1e-5);
  float aaAl = dot(aaP.xy, aaH2);
  float aaFw = max(length(ddx(aaP)), length(ddy(aaP)));
  float aaVrt = 1.0 - smoothstep(0.5, 0.8, abs(aaN.z));
  float aaS1 = lerp(0.5, smoothstep(0.35, 0.8, aan.vn(float2(aaAl * 6.0, aaP.z * 0.35))), saturate(1.0 - aaFw * 12.0));
  float aaS2 = smoothstep(0.3, 0.7, aan.fbm(float2(aaAl * 0.35, aaP.z * 0.08) + 2.0));
  float aaS3 = lerp(0.5, smoothstep(0.3, 0.75, aan.vn(float2(aaAl * 1.6, aaP.z * 0.12) + 9.0)), saturate(1.0 - aaFw * 3.0));   // wider runs that hold at range
  float aaSt = smoothstep(0.45, 0.85, aan.fbm(float2(aaAl, aaP.z) * 0.45 + 5.0));
  float aaUp = smoothstep(0.6, 0.85, aaN.z);
  c *= 1.0 - AaW * ((aaS1 * 0.5 + aaS3 * 0.5) * aaS2 * aaVrt * 0.68 + aaSt * 0.30);
  c = lerp(c, c * float3(0.90, 0.87, 0.82), AaW * aaSt * 0.6);
  c = lerp(c, c * 0.70 + float3(0.020, 0.018, 0.015), AaW * aaUp * 0.5);
}
'''
AAA11_STATS = {}


def _aaa11(name, anchor, code, inputs, prefix=''):
    """a master's AAA11 layer: its code before the anchor (once), its inputs added where missing; a master whose anchor is
    gone (another track rewrote it) is left as it is and named in AAA11_STATS."""
    m = MASTERS.get(name)
    cnt = 0 if m is None else m[0].count(anchor)
    if cnt != 1:
        AAA11_STATS[name] = f'skipped: anchor x{cnt}'
        print(f'[bxue] AAA11: M_bx_{name} skipped (anchor {anchor[:40]!r} found {cnt} times)')
        return
    have = {i[0] for i in m[1]}
    MASTERS[name] = (prefix + m[0].replace(anchor, code + anchor), list(m[1]) + [i for i in inputs if i[0] not in have]) + tuple(m[2:])
    AAA11_STATS[name] = 'on'


_aaa11('facade', 'NormalTS = normalize(tnF);\nreturn alb * Gain.xyz;', AAA_FAC,
       [('UV0', 'uv0'), ('UV2', 'uv2'), ('UV3', 'uv3'), ('AaOn', 's', 1.0), ('AaTone', 's', 0.12), ('AaDrift', 's', 0.09),
        ('AaRvar', 's', 0.15), ('AaGrime', 's', 1.0), ('AaGrimeH', 's', 1.9), ('AaStreak', 's', 0.85), ('AaSoot', 's', 0.35),
        ('AaCav', 's', 0.4), ('AaDust', 's', 1.0), ('AaDet', 's', 0.5)])
for _g in ('ground', 'ground6'):
    _aaa11(_g, 'return max(alb * Gain.xyz, 0.0);', AAA_GND,
           [('UV2', 'uv2'), ('UV3', 'uv3'), ('AaOn', 's', 1.0), ('AaN', 's', 0.0), ('AaWet', 's', 1.0)])
_aaa11('vk', 'return max(alb * Gain.xyz, 0.0);', AAA_VK,
       [('AaOn', 's', 1.0), ('AaRun', 's', 1.25), ('AaBloom', 's', 1.0), ('AaStain', 's', 0.24), ('AaWs', 's', 0.28)])
_aaa11('pbr', 'return max(alb, 0.0);', AAA_PBR,
       [('AaOn', 's', 1.0), ('AaTone', 's', 0.08), ('AaRvar', 's', 0.12), ('AaStreak', 's', 0.85), ('AaDust', 's', 0.5), ('AaGrime', 's', 0.9),
        ('AaKit', 's', 0.35), ('AaSootP', 's', 0.28)])
_aaa11('plain', 'return max(c * Gain.xyz * BaseK, 0.0);', AAA_PL, [('WP', 'wp'), ('NW', 'nw'), ('AaW', 's', 0.0)], prefix=AAA_PL_N)
# AAA11 end
# MESH11 (UE track, 2026-10-09): screen derivatives that hold on the Nanite facade bake. Nanite shades without hardware
# pixel quads, so the facade code's ddx/ddy of the world position and the atlas found no footprint on the Nanite bake:
# the parallax recess (its reveals, frames and sills) skipped, the rooms' level and the weathering's scale fell back.
# Nanite hands the same derivatives to the material analytically. Every ddx/ddy of WP, UV0 and UV1 in the facade code
# reads those where they exist and the hardware's elsewhere (the raster path leaves them 0); ray-traced hits keep none,
# as before. (Applied last, after every other track's facade code is in.)
FAC_DERIV = r'''
float3 bxWdx = 0, bxWdy = 0; float2 bxU0dx = 0, bxU0dy = 0, bxU1dx = 0, bxU1dy = 0;
#if !RAYTRACINGSHADER
bxWdx = Parameters.WorldPosition_DDX; bxWdy = Parameters.WorldPosition_DDY;
#if NUM_TEX_COORD_INTERPOLATORS > 1
bxU0dx = Parameters.TexCoords_DDX[0]; bxU0dy = Parameters.TexCoords_DDY[0];
bxU1dx = Parameters.TexCoords_DDX[1]; bxU1dy = Parameters.TexCoords_DDY[1];
#endif
if (dot(bxWdx, bxWdx) + dot(bxWdy, bxWdy) <= 0.0) {
  bxWdx = ddx(WP); bxWdy = ddy(WP); bxU0dx = ddx(UV0); bxU0dy = ddy(UV0); bxU1dx = ddx(UV1); bxU1dy = ddy(UV1);
}
#endif
'''
_fd = MASTERS['facade']
_fc = _fd[0]
MESH11_DERIV = {}
for a_, b_ in (('ddx(WP)', 'bxWdx'), ('ddy(WP)', 'bxWdy'), ('ddx(UV0)', 'bxU0dx'), ('ddy(UV0)', 'bxU0dy'), ('ddx(UV1)', 'bxU1dx'), ('ddy(UV1)', 'bxU1dy')):
    if _fc.count(a_): MESH11_DERIV[a_] = _fc.count(a_)
    _fc = _fc.replace(a_, b_)
MASTERS['facade'] = (FAC_DERIV + _fc,) + tuple(_fd[1:])
# MESH11 end
# UE13 (UE track, 2026-10-09): the same derivatives for the other masters drawn on Nanite meshes. Each reads ddx/ddy only
# for a footprint (the weathering's metres a pixel, the water's blur, the boards' texture gradients and face normal), of
# the world position or of the first UV set through a linear map; those become the analytic derivatives where Nanite
# hands them over and the hardware's elsewhere, the map applied. A master whose code no longer holds the expected
# expressions (another track rewrote it) is left as it is and named in UE13_DERIV.
DERIV_HEAD = r'''
float3 bxWdx = 0, bxWdy = 0; float2 bxU0dx = 0, bxU0dy = 0;
#if !RAYTRACINGSHADER
bxWdx = Parameters.WorldPosition_DDX; bxWdy = Parameters.WorldPosition_DDY;
#if NUM_TEX_COORD_INTERPOLATORS > 0
bxU0dx = Parameters.TexCoords_DDX[0]; bxU0dy = Parameters.TexCoords_DDY[0];
#endif
if (dot(bxWdx, bxWdx) + dot(bxWdy, bxWdy) <= 0.0) {
  bxWdx = ddx(WP); bxWdy = ddy(WP);
  BXUE13_UVFALLBACK
}
#endif
'''
_P3 = ('(float3({d}.x, {d}.z, {d}.y) * 0.01)')
UE13_RULES = {
    'pbr': [('ddx(P)', _P3.format(d='bxWdx')), ('ddy(P)', _P3.format(d='bxWdy'))],
    'vk': [('ddx(P)', _P3.format(d='bxWdx')), ('ddy(P)', _P3.format(d='bxWdy'))],
    'ground': [('ddx(P.x)', '(bxWdx.x * 0.01)'), ('ddy(P.x)', '(bxWdy.x * 0.01)'), ('ddx(P.z)', '(bxWdx.y * 0.01)'), ('ddy(P.z)', '(bxWdy.y * 0.01)')],
    'ground6': [('ddx(P.x)', '(bxWdx.x * 0.01)'), ('ddy(P.x)', '(bxWdy.x * 0.01)'), ('ddx(P.z)', '(bxWdx.y * 0.01)'), ('ddy(P.z)', '(bxWdy.y * 0.01)')],
    'water': [('ddx(P.xz)', '(bxWdx.xy * 0.01)'), ('ddy(P.xz)', '(bxWdy.xy * 0.01)')],
    'plain': [('ddx(aaP)', '(bxWdx * 0.01)'), ('ddy(aaP)', '(bxWdy * 0.01)')],
    'board': [('ddx(WP)', 'bxWdx'), ('ddy(WP)', 'bxWdy'), ('ddx(lc)', 'float2(bxU0dx.x, -bxU0dx.y)'), ('ddy(lc)', 'float2(bxU0dy.x, -bxU0dy.y)'),
              ('ddx(m)', '(float2(bxU0dx.x, -bxU0dx.y) * sz)'), ('ddy(m)', '(float2(bxU0dy.x, -bxU0dy.y) * sz)'),
              ('ddx(tc)', '(float2(bxU0dx.x, -bxU0dx.y) * rr.zw * atl)'), ('ddy(tc)', '(float2(bxU0dy.x, -bxU0dy.y) * rr.zw * atl)')],
}
UE13_DERIV = {}
for _k, _rules in UE13_RULES.items():
    try:
        _m = MASTERS[_k]; _c = _m[0]; _names = [i[0] for i in _m[1]]
        if any(_c.count(a_) != 1 for a_, b_ in _rules) or 'WP' not in _names or (_k == 'board' and 'UV0' not in _names):
            UE13_DERIV[_k] = 'skipped: ' + ', '.join(f'{a_} x{_c.count(a_)}' for a_, b_ in _rules if _c.count(a_) != 1); continue
        for a_, b_ in _rules: _c = _c.replace(a_, b_)
        _uvf = 'bxU0dx = ddx(UV0); bxU0dy = ddy(UV0);' if 'UV0' in _names else ''
        MASTERS[_k] = (DERIV_HEAD.replace('BXUE13_UVFALLBACK', _uvf) + _c,) + tuple(_m[1:])
        UE13_DERIV[_k] = 'on'
    except Exception as e_:
        UE13_DERIV[_k] = f'error: {e_}'[:120]
# UE13 end
# UE13 (UE track, 2026-10-09): the room pictures held on the Nanite bake. A wall's seed hashed its plane (from the vertex
# normal) and its grid (the floor height, window width and side margin from UV 2 and 3); Nanite keeps 14 mantissa bits
# of a UV and 8 bits of a normal, so the hash's inputs moved by 1e-4 and its plane term by metres (the normal's error
# times the world position's 3 km), and another room showed behind each pane. The grid values are rounded to the
# centimetre before they are hashed (the window grid itself still reads the exact values), the plane goes in 8 m bins
# (ue_mat MESH11 also gives the bake 15-bit normals), and the weathering's building seed rounds its inputs likewise
UE13_ROOMS = [
    ('float ws = r.h12(floor(pl * 2.0) + floor(atan2(Nw.y, Nw.x) * 40.0) * 17.0, sM * 97.0 + fH * 13.0 + wW * 29.0);',
     'float ws = r.h12(floor(pl * 0.125) + floor(atan2(Nw.y, Nw.x) * 40.0) * 17.0, round(sM * 100.0) * 0.97 + round(fH * 100.0) * 0.13 + round(wW * 100.0) * 0.29);   // (UE13: held on Nanite)'),
    ('float aaSeed = frac(UV2.x * 7.31 + UV2.y * 3.17 + UV3.y * 0.618);',
     'float aaSeed = frac(round(UV2.x * 100.0) * 0.0731 + round(UV2.y * 100.0) * 0.0317 + round(UV3.y) * 0.618);   // (UE13: held on Nanite)'),
]
_fr = MASTERS['facade']; _frc = _fr[0]
for a_, b_ in UE13_ROOMS:
    if _frc.count(a_) == 1: _frc = _frc.replace(a_, b_); UE13_DERIV['facade_' + a_.split(' = ')[0].split()[-1]] = 'on'
    else: UE13_DERIV['facade_' + a_.split(' = ')[0].split()[-1]] = f'skipped: x{_frc.count(a_)}'
MASTERS['facade'] = (_frc,) + tuple(_fr[1:])
# UE13 end
# UE13 (UE track, 2026-10-09): a test aid for the golden shade gap, BxFlipN 1 mirrors the facade's shading normal through
# its wall (ue_families.json facade row BxFlipN, BXUE_FLIPN=1); 0 by default, the shader as before
_fq = MASTERS['facade']
if _fq[0].count('NormalTS = normalize(tnF);') == 1:
    MASTERS['facade'] = (_fq[0].replace('NormalTS = normalize(tnF);', 'NormalTS = normalize(tnF);\nif (BxFlipN > 0.5) NormalTS = float3(NormalTS.x, NormalTS.y, -NormalTS.z);   // (UE13 test aid)', 1),
                         list(_fq[1]) + [('BxFlipN', 's', 0.0)]) + tuple(_fq[2:])
    UE13_DERIV['facade_flipn'] = 'on'
# UE13 end
# UE13 (UE track, 2026-10-09): pale walls keep their plaster. The wall classes from the bake's colour put near-white
# plaster and stucco (linear luminance 0.3 to 0.45: the bake's pale walls) into the sandstone class, and a pale pink one
# could take brick: t7ArchTrack's shaded low building, a smooth white wall in Cycles, was drawn as grey-green block
# masonry. Stone now needs a warmer tint (red over blue 1.12, was 1.0) and ends at luminance 0.22 to 0.32 (was 0.32 to
# 0.45); brick ends at 0.25 to 0.38; the rest is plaster, in the pixel code and the displacement alike. And the
# weathering may not take a pale wall below 0.85 of the bake's own colour (the bake already shows the wall's dirt); the
# reveals, frames and panes keep their shade
UE13_CLASS = [
    ('float wb = saturate((a.r / max(a.g, 0.002) - 1.25) * 3.0);',
     'float wb = saturate((a.r / max(a.g, 0.002) - 1.25) * 3.0) * (1.0 - smoothstep(0.25, 0.38, lum));   // (UE13: pale walls are not brick)'),
    ('float ws = (1.0 - wb) * saturate((lum - 0.16) * 6.0) * saturate((a.r / max(a.b, 0.002) - 1.0) * 3.0) * (1.0 - smoothstep(0.32, 0.45, lum));',
     'float ws = (1.0 - wb) * saturate((lum - 0.16) * 6.0) * saturate((a.r / max(a.b, 0.002) - 1.12) * 4.0) * (1.0 - smoothstep(0.22, 0.32, lum));   // (UE13: pale walls are plaster)'),
]
_fp = MASTERS['facade']; _fpc = _fp[0]; _fd = dict(_fp[3]); _dd = dict(_fd.get('disp') or {}); _ddc = _dd.get('code', '')
_ok = all(_fpc.count(a_) == 1 and _ddc.count(a_) == 1 for a_, b_ in UE13_CLASS) and _fpc.count('NormalTS = normalize(tnF);') == 1
if _ok:
    for a_, b_ in UE13_CLASS: _fpc = _fpc.replace(a_, b_); _ddc = _ddc.replace(a_, b_)
    _fpc = _fpc.replace('NormalTS = normalize(tnF);', 'if (HqOn > 0.5) {   // (UE13: the weathering stops at 0.85 of a pale wall\'s bake)\n'
                        '  float lumB = dot(a.rgb, float3(0.2126, 0.7152, 0.0722));\n'
                        '  alb = lerp(alb, max(alb, a.rgb * 0.85), smoothstep(0.18, 0.32, lumB) * (1.0 - saturate(d.g)) * (1.0 - saturate(rv)) * (1.0 - saturate(frw)));\n'
                        '}\nNormalTS = normalize(tnF);', 1)
    _dd['code'] = _ddc; _fd['disp'] = _dd
    MASTERS['facade'] = (_fpc, _fp[1], _fp[2], _fd) + tuple(_fp[4:])
    UE13_DERIV['facade_classes'] = 'on'
else:
    UE13_DERIV['facade_classes'] = 'skipped'
# UE13 end


# LOOK13 (2026-10-09): Bryant Park's lawn and walks from their CC0 sets in the ground master (M_bx_ground6, M_bx_ground),
# as the web draws them (materials.js: the lawn matId 5 and the campus underlay 15, GP31's crushed-stone walks matId 17):
# - the lawn: Grass004 at its real 1.4 m, two taps against tiling, over the web's hue drift (0.08-0.15 / 0.15-0.24 /
#   0.05-0.08) and its worn patches, mowing passes 1.6 m wide along the street grid (the blades laid toward and away: a
#   lighter and a darker pass, the normal tilted with them), the set's normal, cavities and roughness;
# - the walks: gravel_floor at its 2.25 m, two taps, the web's warm-grey drifts, loose stone lighter, damp patches
#   darker, the set's normal (the stones' relief) and roughness. Unreal drew the lawn as one procedural green and the
#   walks as the sidewalk's concrete flags.
# The six textures use the shared wrap sampler (the build wrapper below): the ground master's own samplers are 13 of 16.
LK13_GND = r'''
// LOOK13: the lawn and the gravel walks from their CC0 sets (see ue_masters.py LOOK13)
if (LkOn > 0.5) {
  float lkFw = max(abs(ddx(P.x)) + abs(ddy(P.x)), abs(ddx(P.z)) + abs(ddy(P.z)));   // metres a pixel
  if (isG > 0.5) {
    float2 lkS = g / max(HGs.x, 0.1);
    float2 lkC = lkS * 0.2; float2 lkCa = floor(lkC), lkCb = floor(lkC + 0.5);
    float2 lkS1 = lkS + float2(n.h1(lkCa + 3.7), n.h1(lkCa + 9.1)) * 7.0, lkS2 = lkS + float2(n.h1(lkCb + 5.3), n.h1(lkCb + 1.9)) * 7.0;
    float lkW = smoothstep(0.3, 0.7, n.vn(lkC * 2.3 + 11.0));
    float3 lkA = lerp(Texture2DSample(HG, HGSampler, lkS1).rgb, Texture2DSample(HG, HGSampler, lkS2).rgb, lkW) / max(HGm.xyz, 0.001);
    float3 lkN = lerp(Texture2DSample(HGN, HGNSampler, lkS1).rgb, Texture2DSample(HGN, HGNSampler, lkS2).rgb, lkW) * 2.0 - 1.0;
    float3 lkR = lerp(Texture2DSample(HGR, HGRSampler, lkS1).rgb, Texture2DSample(HGR, HGRSampler, lkS2).rgb, lkW);
    float lkN1 = n.fbm(P.xz * 0.11 + 4.0);
    // (the web's lawn tones scaled to a lawn's physical albedo, about 0.6 of them, a shade warmer: at the web's own values
    // the lawn read mint under Unreal's sky; lush and dry patches at two scales, the worn ones toward straw)
    float3 lkB = lerp(float3(0.050, 0.088, 0.026), float3(0.098, 0.142, 0.040), lkN1);
    lkB *= lerp(0.80, 1.12, n.fbm(P.xz * 0.021 + 5.3));
    lkB = lerp(lkB, float3(0.135, 0.125, 0.060), smoothstep(0.58, 0.82, n.fbm(P.xz * 0.055 + 17.0)) * 0.55);
    // mowing passes along the grid's x, 2.4 m wide, their edges soft, coming and going over the lawn (a 30 m field), their
    // contrast faded past 0.4 m a pixel
    float lkM = abs(frac(g.y / 4.8) - 0.5) * 2.0;
    float lkSt = (smoothstep(0.40, 0.60, lkM) - 0.5) * saturate(1.0 - lkFw * 2.5) * LkMow * smoothstep(0.35, 0.75, n.fbm(P.xz * 0.033 + 41.0));
    alb = lkB * lkA * (1.0 + 0.06 * lkSt) * lerp(1.0, lkR.r, 0.5);
    alb *= float3(1.0 - 0.02 * lkSt, 1.0, 1.0 + 0.03 * lkSt);
    Rough = saturate(0.95 - (lkR.g - 0.26) * 0.15);   // (Grass004's roughness map reads 0.26 at its mean: a lawn is matte)
    lkN.y += lkSt * 0.12;
    float3 lkNw = normalize(Tg * lkN.x * LkNrm + Bg * lkN.y * LkNrm + N * max(lkN.z, 0.05));
    NormalOut = normalize(float3(lkNw.x, lkNw.z, lkNw.y));
  }
  // the walks (GP31's crushed stone, 17), the park paths (6, compacted stone dust) and the plates (13, 14: Bryant Park's
  // fountain terrace), the gravel set's stones and relief under each kind's own tone
  if (abs(k - 17) < 0.5 || abs(k - 6) < 0.5 || abs(k - 13) < 0.5 || abs(k - 14) < 0.5) {
    float2 lvS = g / max(HVs.x, 0.1);
    float2 lvC = lvS * 0.2; float2 lvCa = floor(lvC), lvCb = floor(lvC + 0.5);
    float2 lvS1 = lvS + float2(n.h1(lvCa + 3.7), n.h1(lvCa + 9.1)) * 7.0, lvS2 = lvS + float2(n.h1(lvCb + 5.3), n.h1(lvCb + 1.9)) * 7.0;
    float lvW = smoothstep(0.3, 0.7, n.vn(lvC * 2.3 + 11.0));
    float3 lvA = lerp(Texture2DSample(HV, HVSampler, lvS1).rgb, Texture2DSample(HV, HVSampler, lvS2).rgb, lvW) / max(HVm.xyz, 0.001);
    float3 lvN = lerp(Texture2DSample(HVN, HVNSampler, lvS1).rgb, Texture2DSample(HVN, HVNSampler, lvS2).rgb, lvW) * 2.0 - 1.0;
    float3 lvR = lerp(Texture2DSample(HVR, HVRSampler, lvS1).rgb, Texture2DSample(HVR, HVRSampler, lvS2).rgb, lvW);
    float lvGw = n.fbm(P.xz * 0.45 + 29.0), lvGd = n.fbm(P.xz * 0.075 + 3.0), lvGc = n.fbm(P.xz * 0.21 + 41.0);
    float3 lvB = lerp(float3(0.165, 0.150, 0.121), float3(0.203, 0.184, 0.149), lvGw * 0.6 + n.fbm(P.xz * 0.11 + 4.0) * 0.4);
    if (abs(k - 6) < 0.5) {   // the web's park path: warm grey stone dust, darker drifts
      lvB = lerp(float3(0.162, 0.150, 0.130), float3(0.238, 0.220, 0.190), n.fbm(P.xz * 0.6 + 13.0) * 0.55 + n.fbm(P.xz * 0.11 + 4.0) * 0.45);
      lvB *= 1.0 - smoothstep(0.55, 0.92, n.fbm(P.xz * 0.07 + 8.0)) * 0.22;
    }
    if (abs(k - 13) < 0.5 || abs(k - 14) < 0.5) {   // the web's plates: Bryant Park's fountain terrace (14, grey) and the red ones (13)
      lvB = ((abs(k - 13) < 0.5) ? float3(0.235, 0.085, 0.062) : float3(0.190, 0.185, 0.175)) * (0.86 + 0.14 * n.fbm(P.xz * 0.11 + 4.0));
    }
    lvB *= 1.0 + 0.10 * (smoothstep(0.55, 0.85, lvGc) - 0.3);
    float lvDamp = smoothstep(0.58, 0.86, lvGd);
    alb = lvB * lvA * lerp(1.0, lvR.r, 0.6) * (1.0 - 0.24 * lvDamp);
    Rough = saturate(lerp(0.93, 0.80, lvDamp) + (lvR.g - 0.5) * 0.15);
    float3 lvNw = normalize(Tg * lvN.x * LkNrm * 1.2 + Bg * lvN.y * LkNrm * 1.2 + N * max(lvN.z, 0.05));
    NormalOut = normalize(float3(lvNw.x, lvNw.z, lvNw.y));
  }
  // the sidewalk flags (1): a wider tone lottery per flag (the web's GP31 sets, an old flag walked down to its aggregate:
  // one in seven darker and coarser) and a broad drift, so a plaza of flags is not one pale sheet at range
  if (abs(k - 1) < 0.5) {
    float lfH = n.h1(fid + 77.7), lfO = step(lfH, 0.14);
    alb *= lerp(0.90, 1.08, n.h1(fid + 19.3)) * lerp(1.0, 0.80, lfO) * (1.0 - 0.10 * smoothstep(0.5, 0.85, n.fbm(P.xz * 0.16 + 23.0)));
    Rough = saturate(Rough + 0.05 * lfO);
  }
  // the terrain and the far carpet (7, 8: the filler between the sidewalks and the building lines, yards and lots): the
  // web's weathered pavement (0.16-0.24 grey, damp patches 30 % darker) with the flags' concrete set as its grain and
  // relief, without the flags' joints
  if (abs(k - 7) < 0.5 || abs(k - 8) < 0.5) {
    float2 ltS = g / max(HSz.y, 0.1) + 31.0;
    float2 ltC = ltS * 0.2; float2 ltCa = floor(ltC), ltCb = floor(ltC + 0.5);
    float2 ltS1 = ltS + float2(n.h1(ltCa + 3.7), n.h1(ltCa + 9.1)) * 7.0, ltS2 = ltS + float2(n.h1(ltCb + 5.3), n.h1(ltCb + 1.9)) * 7.0;
    float ltW = smoothstep(0.3, 0.7, n.vn(ltC * 2.3 + 11.0));
    float3 ltA = lerp(Texture2DSample(HW, HWSampler, ltS1).rgb, Texture2DSample(HW, HWSampler, ltS2).rgb, ltW) / max(HWm.xyz, 0.001);
    float3 ltN = lerp(Texture2DSample(HWN, HWNSampler, ltS1).rgb, Texture2DSample(HWN, HWNSampler, ltS2).rgb, ltW) * 2.0 - 1.0;
    float3 ltB = lerp(float3(0.158, 0.152, 0.140), float3(0.235, 0.228, 0.212), n.fbm(P.xz * 0.11 + 4.0));
    ltB *= 1.0 - smoothstep(0.5, 0.9, n.fbm(P.xz * 0.06 + 19.0)) * 0.30;
    if (abs(k - 8) < 0.5) ltB = lerp(ltB, float3(0.118, 0.116, 0.112), 0.55);
    alb = ltB * lerp(float3(1, 1, 1), ltA, 0.8);
    Rough = 0.93;
    float3 ltNw = normalize(Tg * ltN.x * LkNrm + Bg * ltN.y * LkNrm + N * max(ltN.z, 0.05));
    NormalOut = normalize(float3(ltNw.x, ltNw.z, ltNw.y));
  }
}
'''
LK13_STATS = {}
LK13_IN = [('LkOn', 's', 0.0), ('LkMow', 's', 1.0), ('LkNrm', 's', 1.0),
           ('HG', 'ts', 'white'), ('HGN', 'tl', 'flat'), ('HGR', 'tl', 'orm'), ('HGm', 'v', (0.1217, 0.1558, 0.0319, 0)), ('HGs', 'v', (1.4, 1.4, 0, 0)),
           ('HV', 'ts', 'white'), ('HVN', 'tl', 'flat'), ('HVR', 'tl', 'orm'), ('HVm', 'v', (0.3685, 0.2435, 0.1358, 0)), ('HVs', 'v', (2.25, 2.25, 0, 0))]
for _g in ('ground', 'ground6'):
    _m = MASTERS.get(_g)
    _an = 'return max(alb * Gain.xyz, 0.0);'
    if _m is None or _m[0].count(_an) != 1:
        LK13_STATS[_g] = 'skipped'; print(f'[bxue] LOOK13: M_bx_{_g} skipped'); continue
    _have = {i[0] for i in _m[1]}
    MASTERS[_g] = (_m[0].replace(_an, LK13_GND + _an), list(_m[1]) + [i for i in LK13_IN if i[0] not in _have]) + tuple(_m[2:])
    LK13_STATS[_g] = 'on'
# LOOK13 end


# LOOK13b (2026-10-09): M_bx_reed, the Lake's reeds as the web's reedMat cuts them (cpLand.js): each crossed quad (u, v in
# UV 0, the importer's flipped v) cut into seven tapering, curving blades by its seed (UV 2.y), the clump's colour from its
# vertex colour (UV 1, UV 2.x), the bases in their own shade. A blade is never drawn under half a pixel wide (the web
# dithers there; here the coverage stays put, so a far clump does not crawl); masked, two-sided, lit from above (the
# quads' normals point up, as the web's)
REED = r'''
float u = UV0.x, v = 1.0 - UV0.y, sd = UV2.y;
float fw = abs(ddx(u)) + abs(ddy(u)) + 1e-4;
float cov = 0.0;
[unroll] for (int i = 0; i < 7; i++) {
  float fi = (float)i;
  float r1 = frac(sin((fi + sd * 13.1) * 91.3458) * 47453.5453);
  float r2 = frac(sin((fi * 1.7 + sd * 7.3) * 91.3458) * 47453.5453);
  float r3 = frac(sin((fi * 2.3 + sd * 3.9) * 91.3458) * 47453.5453);
  float top = 0.55 + 0.45 * r3;
  float c = (fi + 0.5) / 7.0 + (r1 - 0.5) * 0.12 + (r2 - 0.5) * 0.5 * (v / top) * (v / top);
  float w = max(0.032 * (1.0 - v / top) + 0.004, fw * 0.5);
  float ci = 1.0 - smoothstep(w - fw, w + fw, abs(u - c));
  cov = max(cov, (v <= top) ? ci : 0.0);
}
Mask = cov;
float3 col = max(float3(UV1.x, UV1.y, UV2.x), 0.0) * lerp(0.45, 1.0, smoothstep(0.0, 0.5, v));
return col * Gain.xyz;
'''
MASTERS['reed'] = (REED, [('UV0', 'uv0'), ('UV1', 'uv1'), ('UV2', 'uv2'), ('Gain', 'v', (1, 1, 1, 0))], [('Mask', 1)],
                   {'blend': 'masked', 'two_sided': True, 'rough_param': True})
# LOOK13b end


# LOOK13d (2026-10-09): M_bx_water's landing foam (fountainFX.js poolRings FW26 foam, FW27 churn): where a veil lands
# (FoamC: centre x, z in the USD's metres, the ring's radius, the strength; 0 everywhere else) the pool churns white in a
# band from FoamW.x inside the ring decaying outward at FoamW.y a metre, broken and drifting (two noise fields on the water's
# clock), its ripples choppier in the band (the slope x 3.5 at the ring)
LK13D_A = 'float r0 = Rgh;'
LK13D_B = 'return max(Col.xyz, 0.0);'
LK13D_FOAM = r'''
float lkFoam = 0.0;
if (FoamC.w > 0.0) {
  float fr = length(P.xz - FoamC.xy) - FoamC.z;
  float bnd = smoothstep(-FoamW.x, -0.05, fr) * exp(-max(fr, 0.0) * FoamW.y);
  float2 fq = (P.xz - FoamC.xy) * 5.0;
  float ch = w.h(fq + float2(t * 1.1, -t * 0.8)) * 0.6 + w.h(fq * 2.9 - float2(t * 2.3, t * 1.7)) * 0.4;
  lkFoam = saturate(FoamC.w * bnd * smoothstep(0.30, 0.70, ch + bnd * 0.25));
  s *= 1.0 + 2.5 * bnd * FoamC.w;
}
'''
LK13D_RET = r'''
if (FoamC.w > 0.0) {
  Rough = lerp(Rough, 0.55, lkFoam);
  NormalOut = normalize(lerp(NormalOut, float3(0, 0, 1), lkFoam * 0.6));
  Spec = lerp(0.25, 0.4, lkFoam);
  return max(lerp(Col.xyz, float3(0.72, 0.75, 0.75), lkFoam), 0.0);
}
'''
_w = MASTERS.get('water')
if _w is not None and _w[0].count(LK13D_A) == 1 and _w[0].count(LK13D_B) == 1:
    MASTERS['water'] = (_w[0].replace(LK13D_A, LK13D_FOAM + LK13D_A).replace(LK13D_B, LK13D_RET + LK13D_B),
                        list(_w[1]) + [i for i in [('FoamC', 'v', (0, 0, 0, 0)), ('FoamW', 'v', (0.4, 2.6, 0, 0))] if i[0] not in {j[0] for j in _w[1]}]) + tuple(_w[2:])
else:
    print('[bxue] LOOK13d: M_bx_water left as it is (anchors)')
# LOOK13d end


def _tga(path, rgba):
    w = h = 4
    hdr = struct.pack('<BBBHHBHHHHBB', 0, 0, 2, 0, 0, 0, 0, 0, w, h, 32, 8)
    px = bytes([rgba[2], rgba[1], rgba[0], rgba[3]]) * (w * h)
    with open(path, 'wb') as f: f.write(hdr + px)


def import_texture(path, dest, name, srgb, hdr=False):
    """a texture file as a Texture2D (sRGB colour or linear data, no normal-map compression: the masters decode it)."""
    task = unreal.AssetImportTask()
    task.set_editor_property('filename', path)
    task.set_editor_property('destination_path', dest)
    task.set_editor_property('destination_name', name)
    task.set_editor_property('automated', True)
    task.set_editor_property('replace_existing', True)
    task.set_editor_property('save', False)
    unreal.AssetToolsHelpers.get_asset_tools().import_asset_tasks([task])
    paths = task.get_editor_property('imported_object_paths')
    if not paths: return None
    tex = unreal.load_asset(paths[0])
    if isinstance(tex, unreal.Texture2D):
        tex.set_editor_property('srgb', bool(srgb))
        tex.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_HDR if hdr else (unreal.TextureCompressionSettings.TC_DEFAULT if srgb else unreal.TextureCompressionSettings.TC_BC7))
        tex.set_editor_property('never_stream', True)
    return tex


def defaults():
    """4x4 default textures (white, flat normal, ORM, black), so each texture parameter has a texture of its own kind."""
    d = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_intermediate_dir()), 'bx_defaults')
    os.makedirs(d, exist_ok=True)
    out = {}
    for name, rgba, srgb in (('white', (255, 255, 255, 255), True), ('flat', (128, 128, 255, 255), False),
                             ('orm', (255, 204, 0, 255), False), ('black', (0, 0, 0, 255), False)):
        ap = f'{ROOT}/Tex/T_default_{name}'
        if eal.does_asset_exist(ap):
            out[name] = eal.load_asset(ap); continue
        p = os.path.join(d, f'T_default_{name}.tga'); _tga(p, rgba)
        out[name] = import_texture(p, f'{ROOT}/Tex', f'T_default_{name}', srgb)
        eal.save_loaded_asset(out[name])
    return out


def build(name, spec, tex):
    code, inputs, outs, sett = spec
    ap = f'{ROOT}/M_bx_{name}'
    if eal.does_asset_exist(ap): eal.delete_asset(ap)
    m = unreal.AssetToolsHelpers.get_asset_tools().create_asset(f'M_bx_{name}', ROOT, unreal.Material, unreal.MaterialFactoryNew())
    if sett.get('blend') == 'translucent':
        m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_TRANSLUCENT)
        m.set_editor_property('translucency_lighting_mode', unreal.TranslucencyLightingMode.TLM_SURFACE)
    elif sett.get('blend') == 'composite':   # premultiplied: the colour over the scene x (1 - opacity)
        m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_ALPHA_COMPOSITE)
    elif sett.get('blend') == 'masked':
        m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_MASKED)
    if sett.get('unlit'): m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_UNLIT)
    if sett.get('clearcoat'): m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_CLEAR_COAT)   # R3-PAINT
    if sett.get('forward'): m.set_editor_property('translucency_lighting_mode', unreal.TranslucencyLightingMode.TLM_SURFACE_PER_PIXEL_LIGHTING)   # R3-REFL
    if sett.get('no_front_layer'):   # R5-ROOF: a translucent layer that takes no front-layer (mirror) reflection
        try: m.set_editor_property('allow_front_layer_translucency', False)
        except Exception as e: unreal.log_warning(f'[bxue] {name}: allow_front_layer_translucency: {e}')
    if sett.get('post') or sett.get('post_after'):
        m.set_editor_property('material_domain', unreal.MaterialDomain.MD_POST_PROCESS)
        m.set_editor_property('blendable_location', unreal.BlendableLocation.BL_REPLACING_TONEMAPPER if sett.get('post') else unreal.BlendableLocation.BL_SCENE_COLOR_AFTER_TONEMAPPING)
    if sett.get('two_sided'): m.set_editor_property('two_sided', True)
    if sett.get('foliage'): m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_TWO_SIDED_FOLIAGE)
    if sett.get('blend') == 'masked': m.set_editor_property('opacity_mask_clip_value', 0.5)
    if sett.get('normal_ws'): m.set_editor_property('tangent_space_normal', False)
    if sett.get('slw'): m.set_editor_property('shading_model', unreal.MaterialShadingModel.MSM_SINGLE_LAYER_WATER)   # WATER3
    cu = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -500, 0)
    cu.set_editor_property('code', code)
    cu.set_editor_property('description', f'bx_{name}')
    cu.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
    ins = []
    for it in inputs:
        ci = unreal.CustomInput(); ci.set_editor_property('input_name', it[0]); ins.append(ci)
    cu.set_editor_property('inputs', ins)
    if outs:
        ao = []
        for on, dim in outs:
            co = unreal.CustomOutput(); co.set_editor_property('output_name', on)
            co.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT1 if dim == 1 else unreal.CustomMaterialOutputType.CMOT_FLOAT3)
            ao.append(co)
        cu.set_editor_property('additional_outputs', ao)
    y = -1200
    exprs = {}   # MESH11: each input's expression by name (the displacement node reads some of them)
    for it in inputs:
        nm, kind = it[0], it[1]
        if kind == 's':
            e = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -900, y)
            e.set_editor_property('parameter_name', nm); e.set_editor_property('default_value', float(it[2]))
        elif kind == 'v':
            e = mel.create_material_expression(m, unreal.MaterialExpressionVectorParameter, -900, y)
            e.set_editor_property('parameter_name', nm); e.set_editor_property('default_value', unreal.LinearColor(*[float(v) for v in it[2]]))
        elif kind in ('ts', 'tl'):
            e = mel.create_material_expression(m, unreal.MaterialExpressionTextureObjectParameter, -900, y)
            e.set_editor_property('parameter_name', nm)
            e.set_editor_property('texture', tex[it[2]])
            e.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if kind == 'ts' else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
        elif kind == 'wp':
            e = mel.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -900, y)
        elif kind == 'nw':
            e = mel.create_material_expression(m, unreal.MaterialExpressionVertexNormalWS, -900, y)
        elif kind == 'cam':
            e = mel.create_material_expression(m, unreal.MaterialExpressionCameraVectorWS, -900, y)
            e2 = mel.create_material_expression(m, unreal.MaterialExpressionMultiply, -700, y)
            mel.connect_material_expressions(e, '', e2, 'A'); e2.set_editor_property('const_b', -1.0); e = e2
        elif kind in ('scene', 'bloom', 'stencil', 'depth'):
            e = mel.create_material_expression(m, unreal.MaterialExpressionSceneTexture, -900, y)
            e.set_editor_property('scene_texture_id', {'scene': unreal.SceneTextureId.PPI_POST_PROCESS_INPUT0, 'bloom': unreal.SceneTextureId.PPI_POST_PROCESS_INPUT2,
                                                       'stencil': unreal.SceneTextureId.PPI_CUSTOM_STENCIL,
                                                       'depth': unreal.SceneTextureId.PPI_SCENE_DEPTH}[kind])
        elif kind == 'vc':   # R4-PEDS: the vertex colour
            e = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -900, y)
        elif kind == 'pcd':   # GB43 KIT: one float of the instance's custom data (index it[2]; it[3] where none is set)
            e = mel.create_material_expression(m, unreal.MaterialExpressionPerInstanceCustomData, -900, y)
            e.set_editor_property('data_index', int(it[2])); e.set_editor_property('const_default_value', float(it[3]))
        elif kind == 'atmsun':   # VEIL2: the sky atmosphere's sun (light 0) direction, world space
            e = mel.create_material_expression(m, unreal.MaterialExpressionSkyAtmosphereLightDirection, -900, y)
        elif kind == 'time':   # R4-CINE: the game time (Movie Render Queue steps it per frame)
            e = mel.create_material_expression(m, unreal.MaterialExpressionTime, -900, y)
        elif kind == 'mpc':   # TSQADS: a scalar of the parameter collection MPC_bx (ue_take keys it per frame in LS_<shot>)
            e = mel.create_material_expression(m, unreal.MaterialExpressionCollectionParameter, -900, y)
            e.set_editor_property('collection', board_mpc()); e.set_editor_property('parameter_name', it[2] if len(it) > 2 else nm)
        elif kind == 'campos':   # MESH11: the lens' world position (cm), for the displacement's distance
            e = mel.create_material_expression(m, unreal.MaterialExpressionCameraPositionWS, -900, y)
        elif kind == 'lp':   # R3-PAINT: the local position (cm)
            e = mel.create_material_expression(m, unreal.MaterialExpressionLocalPosition, -900, y)
        elif kind == 'sceneuv':
            e = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -900, y)
        elif kind.startswith('uv'):
            e = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -900, y)
            e.set_editor_property('coordinate_index', int(kind[2]))
        # a vector parameter's first output is its RGB; the masters read four components (Rot, Bl ...): its RGBA output
        if not (kind == 'v' and mel.connect_material_expressions(e, 'RGBA', cu, nm)):
            mel.connect_material_expressions(e, '', cu, nm)
        exprs[nm] = e   # MESH11
        y += 90
    MP = unreal.MaterialProperty
    if sett.get('attrs'):
        # R4-PAINT: the outputs through Make Material Attributes, which reaches the pins the property enum hides (the clear coat)
        m.set_editor_property('use_material_attributes', True)
        ma = mel.create_material_expression(m, unreal.MaterialExpressionMakeMaterialAttributes, -250, 0)
        mel.connect_material_expressions(cu, '', ma, 'BaseColor')
        for on, pin in (('Rough', 'Roughness'), ('Metal', 'Metallic'), ('CC', 'ClearCoat'), ('CCR', 'ClearCoatRoughness'), ('Glow', 'EmissiveColor')):
            if on in [o[0] for o in outs]: mel.connect_material_expressions(cu, on, ma, pin)
        mel.connect_material_property(ma, '', MP.MP_MATERIAL_ATTRIBUTES)
    elif sett.get('unlit') or sett.get('post') or sett.get('post_after'):
        mel.connect_material_property(cu, '', MP.MP_EMISSIVE_COLOR)
        if 'Opacity' in [o[0] for o in outs]: mel.connect_material_property(cu, 'Opacity', MP.MP_OPACITY)
    else:
        mel.connect_material_property(cu, '', MP.MP_BASE_COLOR)
        names = [o[0] for o in outs]
        if 'Rough' in names: mel.connect_material_property(cu, 'Rough', MP.MP_ROUGHNESS)
        if 'Spec' in names: mel.connect_material_property(cu, 'Spec', MP.MP_SPECULAR)   # R5-ROOF
        if 'Metal' in names: mel.connect_material_property(cu, 'Metal', MP.MP_METALLIC)
        if 'AO' in names: mel.connect_material_property(cu, 'AO', MP.MP_AMBIENT_OCCLUSION)
        if 'NormalOut' in names: mel.connect_material_property(cu, 'NormalOut', MP.MP_NORMAL)
        if 'Opacity' in names: mel.connect_material_property(cu, 'Opacity', MP.MP_OPACITY)
        if 'Mask' in names: mel.connect_material_property(cu, 'Mask', MP.MP_OPACITY_MASK)
        if 'Glow' in names: mel.connect_material_property(cu, 'Glow', MP.MP_EMISSIVE_COLOR)
        if 'NormalTS' in names: mel.connect_material_property(cu, 'NormalTS', MP.MP_NORMAL)
        if 'Sss' in names: mel.connect_material_property(cu, 'Sss', MP.MP_SUBSURFACE_COLOR)
        if sett.get('slw'):   # WATER3: the body's optical properties on the single layer water output
            wo = mel.create_material_expression(m, unreal.MaterialExpressionSingleLayerWaterMaterialOutput, -250, 400)
            for on, pins in (('Scat', ('ScatteringCoefficients', 'Scattering Coefficients')), ('Absorb', ('AbsorptionCoefficients', 'Absorption Coefficients')),
                             ('PhaseG', ('PhaseG', 'Phase G')), ('Behind', ('ColorScaleBehindWater', 'Color Scale Behind Water'))):
                if on in names and not any(mel.connect_material_expressions(cu, on, wo, pin) for pin in pins):
                    unreal.log_warning(f'[bxue] {name}: the water output has no pin for {on}')
    # MESH11 (UE track, 2026-10-08): Nanite tessellation displacement. A master whose settings carry 'disp' gets a second
    # Custom node (vertex-safe: explicit texture levels, no derivatives) on the Displacement pin, from the inputs it names;
    # the scaling's centre is 1, so a height of 1 is the surface and lower heights go inward only (silhouettes and contact
    # stay where the mesh puts them), faded out below a few pixels of projected relief (no swimming far off, no cost there)
    D_ = sett.get('disp')
    if D_ and not os.environ.get('BXUE_NODISP'):
        try:
            cd = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -500, 700)
            cd.set_editor_property('code', D_['code']); cd.set_editor_property('description', f'bx_{name}_disp')
            cd.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT1)
            cis = []
            for nm_ in D_['inputs']:
                ci = unreal.CustomInput(); ci.set_editor_property('input_name', nm_); cis.append(ci)
            cd.set_editor_property('inputs', cis)
            for nm_ in D_['inputs']:
                e_ = exprs.get(nm_)
                if e_ is None: continue
                if not (isinstance(e_, unreal.MaterialExpressionVectorParameter) and mel.connect_material_expressions(e_, 'RGBA', cd, nm_)):
                    mel.connect_material_expressions(e_, '', cd, nm_)
            # (the Displacement pin is hidden from the property enum: the outputs go through Make Material Attributes, which
            # has it, as R4-PAINT's clear coat does)
            ma_ = mel.create_material_expression(m, unreal.MaterialExpressionMakeMaterialAttributes, -250, 300)
            mel.connect_material_expressions(cu, '', ma_, 'BaseColor')
            onames = [o[0] for o in outs]
            for on, pin in (('Rough', 'Roughness'), ('Metal', 'Metallic'), ('AO', 'AmbientOcclusion'), ('NormalOut', 'Normal'),
                            ('NormalTS', 'Normal'), ('Glow', 'EmissiveColor'), ('Spec', 'Specular'), ('Mask', 'OpacityMask'), ('Opacity', 'Opacity')):
                if on in onames: mel.connect_material_expressions(cu, on, ma_, pin)
            mel.connect_material_expressions(cd, '', ma_, 'Displacement')
            m.set_editor_property('use_material_attributes', True)
            mel.connect_material_property(ma_, '', MP.MP_MATERIAL_ATTRIBUTES)
            m.set_editor_property('enable_tessellation', True)
            ds = unreal.DisplacementScaling(); ds.set_editor_property('magnitude', float(D_['magnitude'])); ds.set_editor_property('center', 1.0)
            m.set_editor_property('displacement_scaling', ds)
            fr = unreal.DisplacementFadeRange()
            fr.set_editor_property('start_size_pixels', float(D_.get('fade', [6.0, 2.0])[0])); fr.set_editor_property('end_size_pixels', float(D_.get('fade', [6.0, 2.0])[1]))
            m.set_editor_property('enable_displacement_fade', True); m.set_editor_property('displacement_fade_range', fr)
        except Exception as e:
            unreal.log_warning(f'[bxue] {name}: displacement: {e}')
    # MESH11 end
    if sett.get('plain_pbr') or sett.get('rough_param'):
        # plain, leaf: roughness and metalness straight from parameters
        for i, (pn, prop) in enumerate((('Rough', MP.MP_ROUGHNESS), ('Metal', MP.MP_METALLIC))):
            e = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -300, 300 + 90 * i)
            e.set_editor_property('parameter_name', pn); e.set_editor_property('default_value', 0.8 if pn == 'Rough' else 0.0)
            mel.connect_material_property(e, '', prop)
    # the usages a -game render cannot add itself (it falls back to the default material, and a Nanite mesh to its coarse
    # fallback mesh): Nanite, instanced static meshes (the instancers), skeletal meshes (walkers)
    if not (sett.get('post') or sett.get('post_after')):
        for u in ('MATUSAGE_NANITE', 'MATUSAGE_INSTANCED_STATIC_MESHES', 'MATUSAGE_SKELETAL_MESH', 'MATUSAGE_GEOMETRY_CACHE'):
            try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
            except Exception as e: unreal.log_warning(f'[bxue] {name}: usage {u}: {e}')
    mel.recompile_material(m)
    eal.save_loaded_asset(m)
    return ap


# LOOK13 (2026-10-09): a master whose inputs name LK13_SHARED textures (the ground's lawn and gravel sets) builds them on
# the shared wrap sampler (SamplerSource "Shared: Wrap"): with them the ground master would need 19 of the 16 samplers a
# pixel shader may bind. build() is called through this wrapper; it hands build a proxy of the material library that marks
# those texture parameters just before the material compiles
LK13_SHARED = {'HG', 'HGN', 'HGR', 'HV', 'HVN', 'HVR'}


class _Lk13Mel:
    def __init__(self, real): self._r, self._made = real, []
    def __getattr__(self, k): return getattr(self._r, k)
    def create_material_expression(self, m, cls, *a):
        e = self._r.create_material_expression(m, cls, *a)
        if cls == unreal.MaterialExpressionTextureObjectParameter: self._made.append(e)
        return e
    def recompile_material(self, m):
        for e in self._made:
            try:
                if str(e.get_editor_property('parameter_name')) in LK13_SHARED:
                    e.set_editor_property('sampler_source', unreal.SamplerSourceMode.SSM_WRAP_WORLD_GROUP_SETTINGS)
            except Exception as ex:
                unreal.log_warning(f'[bxue] LOOK13 shared sampler: {ex}')
        return self._r.recompile_material(m)


_lk13_build = build


def build(name, spec, tex):
    global mel
    if not any(i[0] in LK13_SHARED for i in spec[1]): return _lk13_build(name, spec, tex)
    real = mel; mel = _Lk13Mel(real)
    try: return _lk13_build(name, spec, tex)
    finally: mel = real
# LOOK13 end


def ensure(force=False):
    """build the masters when missing or older than VERSION. -> {name: asset path, 'built': [...]}"""
    vf = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir()), 'Bx', f'.masters_v{VERSION}')
    out = {'built': []}
    tex = defaults()
    for name, spec in MASTERS.items():
        ap = f'{ROOT}/M_bx_{name}'
        if force or not os.path.exists(vf) or not eal.does_asset_exist(ap):
            build(name, spec, tex); out['built'].append(name)
        out[name] = ap
    os.makedirs(os.path.dirname(vf), exist_ok=True)
    open(vf, 'w').write('ok')
    return out
