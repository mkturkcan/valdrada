#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the cells' materials, version 2, independent of which takes are imported:
#   - every cell material is bound to lane A's own textures by content hash (the cell's three.js record: map, normalMap,
#     emissiveMap, roughnessMap, alphaMap; `file` = tex/<hash>.png in the cellcache's texture store), each texture
#     imported once into a shared library /Game/Tex/T_<hash> (sRGB) or T_<hash>_lin (data) and reused by every world;
#   - through one generic master (M_bx_r1ccell): colour x map x vertex colour, normal map, roughness, metalness,
#     emissive x emissive map, opacity (the instance's blend mode overridden to masked or translucent, two-sided as the
#     record says), unlit materials (MeshBasicMaterial) as emissive; the PBR library's sets (`userData.pbr.name`) with
#     the HQ CC0 set the export maps them to (ue_families.json hq.pbr, hq.json), box-mapped in world space at the set's
#     real size, tinted by the set's options;
#   - the families our masters draw better than a generic material (the ground with its surface kinds and kerbs, the
#     water, the shrubs' leaves) from a frozen family library (/Game/Lib/Fam_v1: instances copied once from resolved
#     takes, their textures duplicated beside them), never from live take assets.
#   python3 tools/ue/r1c_cellmat2.py --world-dest /Game/W/<key> --cells <dir of the world's cell glbs> --out <dir>
#       [--hide-generated-alpha] [--hide name,...] [--lib-from /Game/Takes/x=<prep json>,...] (the family library's sources,
#       used only when the library is missing)
import hashlib, json, math, os, re, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
CELLCACHE = '/data0/projectnyc_aux/cellcache'
VERSION = 8   # (8: S125, the dresser's roof decks too; 7: S125, the anti-tiling, tone and weathering; 6: GB43 KIT, the kit instances' custom data; 2: the facade kit's per-vertex tint, FkOn; 3: the vertex colour as RGB; 4: the vertex alpha as opacity, UseVCA;
# 5: the take's night (MPC_r1c.Night, keyed in the take's sequence by r1c_actors.py) for what three.js switches by ENV.night:
# night-only parts, the room fills' night dimming, the kit interiors' light share and their own light by day and night, the
# kit's window glass (its vertex colour is its reflection, dirt and opacity, not a colour), the kit shops' atlas; and the
# sign kit's masters: faces (mask or colour), their shade quads, halos and lit letters)
SIGN_VERSION = 1
LIB = '/Game/Lib/Fam_v1'
TEXLIB = '/Game/Tex'
MPC = '/Game/Bx/MPC_r1c'
FAMILY_NAMES = ('cp32l:water', 'vg37:leaf', 'cp32b:', 'cpr33:', 'cp33:bark', 'fw26:veil')   # (name prefixes the library draws)
# WATER3 (2026-10-15, the re-shoot): the park's open water (cpLand.js's bodies, cp32l:water:<body>) on M_bx_water3, the wind
# sea on single layer water shading (ue_masters.py WATER3), in place of the family library's M_bx_water: a light breeze over
# each body's own fetch (the Reservoir's 800 m, the Lake's and the Meer's ~300 m, the small ponds' 120 m), the waves running
# north-east, physical amplitudes; a pond's colour from its absorption and scattering per metre (algae and silt: the blue
# absorbed most, green-brown kept, more turbid than the harbour). The fountains' pools and basins keep their family.
WATER3_MASTER = '/Game/Bx/M_bx_water3'
WATER3_BODIES = {'reservoir': (1.5, 800.0, 1.0), 'lake': (1.5, 300.0, 1.0), 'meer': (1.5, 300.0, 1.0), '': (1.5, 120.0, 1.0)}
WATER3_POND = {'Rng': (0.02, 0.0004, 0.02, 0.0), 'Abs': (0.9, 0.35, 0.95, 0.0), 'Sct': (0.004, 0.006, 0.003, 0.0), 'Pg': 0.6, 'BehK': 1.0}
# (the look pass, 2026-10-15: the first values lit the Lake bright green with a chop; a calm golden evening and a tenth of
# the scattering keep the old mirror-dark water)

CELL = r"""
// S125 (2026-10-16, the owner: repetitive, basic tiled textures): the PBR sets were box-mapped at their real size
// and repeated edge to edge over 40 m roofs and walls. Roofs (up-facing, world-mapped) now sample their set three times on a
// hexagonal lattice, each tap offset at random, blended by the lattice's barycentric weights, so no tile repeats; roofs and
// walls take a tone and roughness that wander over 6 to 25 m, walls rain streaks along their height, roofs stains and
// patched membrane. Off with S125K = 0.
struct S125N {
  float h(float2 p) { float3 p3 = frac(float3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return frac((p3.x + p3.y) * p3.z); }
  float n(float2 p) { float2 i = floor(p), f = frac(p); f = f * f * (3.0 - 2.0 * f); return lerp(lerp(h(i), h(i + float2(1, 0)), f.x), lerp(h(i + float2(0, 1)), h(i + float2(1, 1)), f.x), f.y); }
  float f(float2 p) { return n(p) * 0.55 + n(p * 2.3 + 17.0) * 0.3 + n(p * 5.1 + 41.0) * 0.15; }
};
S125N N;
float nl = saturate(NightV);
float non = nl > 0.5 ? 1.0 : 0.0;
float2 uv = (Chan > 0.5 ? UV1 : UV0) * UVT.xy + UVT.zw;
float3 nW = normalize(NW);
if (World > 0.5) {
    float3 p = WP * 0.01 / max(Size, 0.05);
    float3 an = abs(nW);
    uv = an.z > max(an.x, an.y) ? p.xy : (an.x > an.y ? p.yz : p.xz);
}
float roofS = (S125K > 0.5 && (World > 0.5 || RoofDeck > 0.5) && nW.z > 0.7 && Glass < 0.5 && Unlit < 0.5) ? 1.0 : 0.0;   // (v8: and the dresser's roof decks)
float2 atO0 = float2(0, 0), atO1 = float2(0, 0), atO2 = float2(0, 0); float atW0 = 1.0, atW1 = 0.0, atW2 = 0.0;
if (roofS > 0.5) {
    float2 st = uv * (3.4641016 / 1.7);   // (a lattice cell about 1.7 tiles across)
    float2 sk = float2(st.x - 0.57735027 * st.y, 1.15470054 * st.y);
    float2 bId = floor(sk);
    float3 tq = float3(frac(sk), 0.0); tq.z = 1.0 - tq.x - tq.y;
    float sg = step(0.0, -tq.z), s2 = 2.0 * sg - 1.0;
    float w1 = -tq.z * s2, w2 = sg - tq.y * s2, w3 = sg - tq.x * s2;
    float2 v1 = bId + float2(sg, sg), v2 = bId + float2(sg, 1.0 - sg), v3 = bId + float2(1.0 - sg, sg);
    atO0 = float2(N.h(v1), N.h(v1 + 19.19)) * 7.0; atO1 = float2(N.h(v2), N.h(v2 + 19.19)) * 7.0; atO2 = float2(N.h(v3), N.h(v3 + 19.19)) * 7.0;
    float3 wp3 = pow(max(float3(w1, w2, w3), 0.0), 3.0); wp3 /= max(wp3.x + wp3.y + wp3.z, 1e-5);
    atW0 = wp3.x; atW1 = wp3.y; atW2 = wp3.z;
}
float2 dUx = ddx(uv), dUy = ddy(uv);
// GB43 KIT: an instance of the kit (a unit box or a part) carries what the merged path baked per vertex
// (world/nycDress.js _kitBox): its tint, grime and base height, its cornice shadow's height, its texture offset and size
float kit = KitOn > 0.5 ? 1.0 : 0.0;
float yM = WP.z * 0.01;   // (metres up: three's y)
if (kit > 0.5 && KTile > 0.0) {
    // batcher.js addMerged's planar map in Unreal's axes (three x, y, z = Unreal x, z, y): the top faces by x and y, the
    // sides by their horizontal run and the height; then the per-placement offset in whole bricks and courses
    float3 an = abs(nW); float2 q;
    float3 w = WP * 0.01;
    if (an.z >= an.x && an.z >= an.y) q = float2(w.x, w.y);
    else if (an.x >= an.y) q = float2(w.y * sign(nW.x), w.z);
    else q = float2(-w.x * sign(nW.y), w.z);
    uv = (q + float2(KU, KV)) / KTile;
    uv.y = -uv.y;   // (three's v up, the import's flip)
}
float4 c4 = float4(1, 1, 1, 1);
if (ShopRows > 0.5) {   // the kit's shop atlas (kitMats.js levelBase): the tile at aFkTr.yz, the face's uv wrapped into it
    float2 sc = float2(0.25, 1.0 / ShopRows);
    float2 fr = clamp(UV0 - floor(UV0 * 0.99999), 0.004, 0.996);
    c4 = Texture2DSampleGrad(Map, MapSampler, float2(UV1.y, UV2.x) + fr * sc, ddx(UV0) * sc, ddy(UV0) * sc);
} else if (HasMap > 0.5) {
    if (roofS > 0.5) c4 = Texture2DSampleGrad(Map, MapSampler, uv + atO0, dUx, dUy) * atW0 + Texture2DSampleGrad(Map, MapSampler, uv + atO1, dUx, dUy) * atW1
                        + Texture2DSampleGrad(Map, MapSampler, uv + atO2, dUx, dUy) * atW2;
    else c4 = Texture2DSample(Map, MapSampler, uv);
    // (v8: the dresser's roof decks, roofSilver / roofBlack / roofGravel: their maps' brush strokes and grain, laid along
    // the building, read as planks under a low sun: the map at 40 % of its contrast about its own mean)
    if (RoofDeck > 0.5) c4.rgb = lerp((float3)(dot(c4.rgb, float3(0.3333, 0.3333, 0.3333))), c4.rgb, 0.4);
}
float3 vcol = VC.rgb;
float vcNone = (vcol.r + vcol.g + vcol.b) < 0.01 ? 1.0 : 0.0;
float3 vc = (UseVC > 0.5 && Glass < 0.5) ? vcol : float3(1, 1, 1);   // (the kit glass's vertex colour is not a colour)
float3 albedo = Color.rgb * c4.rgb * vc;
if (kit > 0.5) {
    albedo = Color.rgb * c4.rgb * vc * float3(KR, KG, KB);   // (a part's own vertex colours times its instance's tint, as the pools did)
    float tg = saturate((yM - KBase) / 1.6);   // (nycDress.js DressBatcher: the grime ramp from the building's ground, E10)
    float fk = (1.0 - KGrime) + KGrime * (tg * tg * (3.0 - 2.0 * tg));
    float da = KAo - yM;   // (batcher.js: darker within 1.2 m under the cornice)
    if (KAo > 0.0 && da >= 0.0 && da < 1.2) fk *= 0.78 + 0.22 * (da / 1.2);
    albedo *= fk;
}
if (FkOn > 0.5) albedo *= max(float3(UV1.x, UV1.y, UV2.x), 0.0);   // (the facade kit's tint per vertex: aFkTr in UV 1-2, r1c_glbuv.py)
// S125: the tone over metres (roofs and walls of the buildings: the world-mapped sets and the kit's boxes)
float3 wm = WP * 0.01;
float wallS = (S125K > 0.5 && (World > 0.5 || kit > 0.5) && abs(nW.z) < 0.5 && Glass < 0.5 && Unlit < 0.5 && SelfLv < 0.5) ? 1.0 : 0.0;
float roughAdd = 0.0;
if (roofS > 0.5) {
    float mv = N.f(wm.xy * 0.045 + 3.1), mv2 = N.f(wm.xy * 0.17 + 9.7);
    albedo *= 1.0 + 0.20 * (mv - 0.5) + 0.10 * (mv2 - 0.5);
    float stain = N.f(wm.xy * 0.11 + 23.0);
    albedo *= 1.0 - 0.30 * smoothstep(0.60, 0.80, stain);   // (stains, ponding, soot)
    float patch_ = N.n(floor(wm.xy / 4.0) * 0.731 + 5.3);
    albedo *= patch_ > 0.82 ? 1.14 : 1.0;   // (a patched run of newer membrane)
    roughAdd = 0.12 * (mv - 0.5) - 0.10 * smoothstep(0.60, 0.80, stain);
}
if (wallS > 0.5) {
    float2 q = float2(dot(wm.xy, float2(-nW.y, nW.x)), wm.z);   // (along the wall, up)
    albedo *= 1.0 + 0.12 * (N.f(q * float2(0.05, 0.03) + 7.0) - 0.5);
    float sk_ = N.n(float2(q.x * 0.9, q.y * 0.045 + 11.0)) * N.f(float2(q.x * 0.07, q.y * 0.02) + 31.0);
    albedo *= 1.0 - 0.16 * smoothstep(0.30, 0.62, sk_);   // (rain run-off down the wall)
    roughAdd = 0.06 * smoothstep(0.30, 0.62, sk_);
}
float a = Opac * c4.a * (HasAlpha > 0.5 ? Texture2DSample(AlphaMap, AlphaMapSampler, uv).g : 1.0) * (UseVCA > 0.5 ? VCA : 1.0);
float3 n = float3(0, 0, 1);
if (HasNrm > 0.5) {
    float3 nt = roofS > 0.5 ? Texture2DSampleGrad(Nrm, NrmSampler, uv + atO0, dUx, dUy).rgb * atW0 + Texture2DSampleGrad(Nrm, NrmSampler, uv + atO1, dUx, dUy).rgb * atW1
                              + Texture2DSampleGrad(Nrm, NrmSampler, uv + atO2, dUx, dUy).rgb * atW2 : Texture2DSample(Nrm, NrmSampler, uv).rgb;
    n = nt * 2.0 - 1.0; n = normalize(float3(n.xy * NrmK * (RoofDeck > 0.5 ? 0.4 : 1.0), max(n.z, 0.1)));
}
NormalOut = n;
float3 orm = HasOrm > 0.5 ? (roofS > 0.5 ? Texture2DSampleGrad(Orm, OrmSampler, uv + atO0, dUx, dUy).rgb * atW0 + Texture2DSampleGrad(Orm, OrmSampler, uv + atO1, dUx, dUy).rgb * atW1
                                         + Texture2DSampleGrad(Orm, OrmSampler, uv + atO2, dUx, dUy).rgb * atW2 : Texture2DSample(Orm, OrmSampler, uv).rgb) : float3(1, 1, 1);
Rough = saturate(RoughK * (HasOrm > 0.5 ? orm.g : 1.0) + roughAdd);
Metal = saturate(MetalK * (HasOrm > 0.5 ? orm.b : 1.0));
AO = HasOrm > 0.5 && OrmAO > 0.5 ? orm.r : 1.0;
// emission: the record's, its intensity from day to night; a self-lit interior's own albedo at its day or night level
float3 em = Emis.rgb * (HasEmis > 0.5 ? Texture2DSample(EmisMap, EmisMapSampler, uv).rgb : float3(1, 1, 1)) * lerp(EmisK, EmisKN, nl);
em += albedo * (SelfLv > 0.5 ? max(UV1.x, 0.0) : 1.0) * lerp(SelfDay, SelfNight, nl);
float3 base = albedo * Inside;   // (an interior takes a share of the light outdoors: kitMats.js inside())
if (Glass > 0.5) {
    // the kit's window glass (kitMats.js winGlass): its vertex colour is (reflection, dirt, opacity); a dark pane over the
    // room, the street or the sky mirrored at its Fresnel, premultiplied (the instance is alpha-composite)
    float useK = (UseVC > 0.5 && vcNone < 0.5) ? 1.0 : 0.0;
    float kR = useK > 0.5 ? vcol.r : 1.0, kD = useK > 0.5 ? vcol.g : 1.0, kO = useK > 0.5 ? vcol.b : 1.0;
    float3 Vd = normalize(V);
    float3 Nn = dot(nW, Vd) > 0.0 ? -nW : nW;
    float cosT = saturate(dot(-Vd, Nn));
    float fr = GlassF0 + (1.0 - GlassF0) * pow(1.0 - cosT, 5.0);
    float ga = clamp(Opac * (1.0 + (1.0 - kO) * 1.4) + GlassDirt * kD * 0.07, 0.0, 0.95);
    a = ga + (1.0 - ga) * fr;
    base = Color.rgb * GlassBaseK * ga;
    em = lerp(GlassReflDay.rgb, GlassReflNight.rgb, nl) * fr * kR;
}
float uk = lerp(UnlitDay, UnlitNight, non);
Glow = Unlit > 0.5 ? albedo * uk : em;
if (NightOnly > 0.5) { a *= non; Glow *= non; }
Opacity = saturate(a);
Mask = a;
return Unlit > 0.5 ? float3(0, 0, 0) : base;
"""
CELL_IN = [('UV0', 'uv0'), ('UV1', 'uv1'), ('UV2', 'uv2'), ('FkOn', 's', 0.0), ('WP', 'wp'), ('NW', 'nw'), ('VC', 'vc'), ('V', 'cam'), ('NightV', 'mpc', 'Night'),
           ('UVT', 'v', (1, 1, 0, 0)), ('Chan', 's', 0.0),
           ('World', 's', 0.0), ('Size', 's', 2.0), ('Color', 'v', (1, 1, 1, 0)), ('UseVC', 's', 0.0), ('Map', 'ts', 'white'), ('HasMap', 's', 0.0),
           ('AlphaMap', 'tl', 'white'), ('HasAlpha', 's', 0.0), ('Opac', 's', 1.0), ('Nrm', 'tl', 'flat'), ('HasNrm', 's', 0.0), ('NrmK', 's', 1.0),
           ('Orm', 'tl', 'orm'), ('HasOrm', 's', 0.0), ('OrmAO', 's', 0.0), ('RoughK', 's', 0.8), ('MetalK', 's', 0.0),
           ('Emis', 'v', (0, 0, 0, 0)), ('EmisMap', 'ts', 'white'), ('HasEmis', 's', 0.0), ('EmisK', 's', 1.0), ('EmisKN', 's', 1.0), ('Unlit', 's', 0.0),
           ('UnlitDay', 's', 1.0), ('UnlitNight', 's', 1.0), ('UseVCA', 's', 0.0), ('Inside', 's', 1.0), ('SelfDay', 's', 0.0), ('SelfNight', 's', 0.0),
           ('SelfLv', 's', 0.0), ('ShopRows', 's', 0.0), ('NightOnly', 's', 0.0), ('Glass', 's', 0.0), ('GlassF0', 's', 0.2), ('GlassDirt', 's', 0.3),
           ('GlassReflDay', 'v', (0.32, 0.34, 0.37, 0)), ('GlassReflNight', 'v', (0.012, 0.013, 0.016, 0)), ('GlassBaseK', 's', 0.04),
           # GB43 KIT: the instance's custom data (r1c_cells.py): tint, grime, base, cornice shadow, texture offset, size, on
           ('KR', 'pcd', 0, 1.0), ('KG', 'pcd', 1, 1.0), ('KB', 'pcd', 2, 1.0), ('KGrime', 'pcd', 3, 0.0), ('KBase', 'pcd', 4, 0.0),
           ('KAo', 'pcd', 5, 0.0), ('KU', 'pcd', 6, 0.0), ('KV', 'pcd', 7, 0.0), ('KTile', 'pcd', 8, 0.0), ('KitOn', 'pcd', 9, 0.0),
           ('S125K', 's', 1.0), ('RoofDeck', 's', 0.0)]
CELL_OUT = [('Opacity', 1), ('Mask', 1), ('NormalOut', 3), ('Rough', 1), ('Metal', 1), ('AO', 1), ('Glow', 3)]

# the sign kit (client/src/city/fk/signKit.js), its terms per material (r1c_glbuv.py splits the faces by their terms)
SAT = 'float sm_ = c_.r + c_.g + c_.b; float sat_ = 1.0 - SatK * smoothstep(0.5, 0.9, sm_ > 1e-4 ? c_.r / sm_ : 0.0);'
SIGN = r"""
float on = smoothstep(0.12, 0.55, saturate(NightV));
float2 fu = UV1;
float fall = 1.0;
if (F.x > 0.0) {
    float ex = min(fu.x, 1.0 - fu.x) * F.y, ey = min(fu.y, 1.0 - fu.y);
    float e = smoothstep(0.0, 0.3, min(ex, ey));
    float rows = 0.5 + 0.5 * cos((fu.y * F.z - 0.5) * 6.2832);
    fall = lerp(1.0, (0.58 + 0.42 * e) * (0.86 + 0.14 * rows) * 1.12, F.x);
}
float3 col; float3 E; float al;
if (IsMask > 0.5) {
    float cov = Texture2DSample(MapL, MapLSampler, UV0).r;
    float3 sc = lerp(Bg.rgb, Fg.rgb, cov);
    col = sc * (1.0 - P.y * (smoothstep(0.3, 0.0, fu.y) * 0.8 + smoothstep(0.86, 1.0, fu.y) * 0.45));
    float3 c_ = lerp(Fg.rgb, sc, P.x); """ + SAT + r"""
    E = lerp(Fg.rgb * cov, sc, P.x) * Lamp.rgb * max(on, P.z) * fall * sat_;
    al = cov;
} else {
    float4 t = Texture2DSample(MapS, MapSSampler, UV0);
    col = t.rgb;
    float3 c_ = t.rgb; """ + SAT + r"""
    E = t.rgb * Lamp.rgb * t.a * max(on, P.z) * fall * sat_;
    al = t.a;
}
Rough = saturate(P.w);
Metal = saturate(F.w);
Glow = E;
Opacity = Decal > 0.5 ? saturate(al) : 1.0;
Mask = Decal > 0.5 ? al : 1.0;
return col;
"""
SIGN_IN = [('UV0', 'uv0'), ('UV1', 'uv1'), ('NightV', 'mpc', 'Night'), ('MapL', 'tl', 'white'), ('MapS', 'ts', 'white'), ('IsMask', 's', 0.0), ('Decal', 's', 0.0),
           ('Bg', 'v', (0, 0, 0, 0)), ('Fg', 'v', (1, 1, 1, 0)), ('Lamp', 'v', (0, 0, 0, 0)), ('P', 'v', (0, 0, 0, 0.32)), ('F', 'v', (0, 1, 1, 0)), ('SatK', 's', 0.75)]
SIGN_OUT = [('Opacity', 1), ('Mask', 1), ('Rough', 1), ('Metal', 1), ('Glow', 3)]
# the shade quads: by day the letters' contact shadow (R), after dark their colour's spill (G); premultiplied
SHADE = r"""
float on = smoothstep(0.12, 0.55, saturate(NightV));
float4 m = Texture2DSample(MapL, MapLSampler, UV0);
Opacity = saturate(m.r * P.x * (1.0 - 0.6 * on));
return Lamp.rgb * m.g * on;
"""
SHADE_IN = [('UV0', 'uv0'), ('NightV', 'mpc', 'Night'), ('MapL', 'tl', 'white'), ('Lamp', 'v', (0, 0, 0, 0)), ('P', 'v', (0, 0, 0, 0))]
# the halos: the letters' light on the wall after dark, additive
HALO = r"""
float on = smoothstep(0.12, 0.55, saturate(NightV));
float4 m = Texture2DSample(MapS, MapSSampler, UV0);
return Color.rgb * m.rgb * m.a * Gain * on;
"""
HALO_IN = [('UV0', 'uv0'), ('NightV', 'mpc', 'Night'), ('MapS', 'ts', 'white'), ('Color', 'v', (1, 1, 1, 0)), ('Gain', 's', 1.4)]
# lit letters, neon and bulbs (glowVCMat): the colour in the vertices, the day and night terms per material
GLOWVC = r"""
float on = smoothstep(0.12, 0.55, saturate(NightV));
Glow = Lamp.rgb * max(on, P.x);
Rough = RoughK; Metal = MetalK;
return VC.rgb * lerp(1.0, P.y, on);
"""
GLOWVC_IN = [('VC', 'vc'), ('NightV', 'mpc', 'Night'), ('Lamp', 'v', (0, 0, 0, 0)), ('P', 'v', (0, 1, 0, 0)), ('RoughK', 's', 0.3), ('MetalK', 's', 0.0)]
GLOWVC_OUT = [('Rough', 1), ('Metal', 1), ('Glow', 3)]
# the facade kit's interiors (kitMats.js KIT_OWN): the share of outdoor light (inside's kInd), the light of their own
# (nightEmit: the record's emission x night; selfLit / levelBase: the albedo x level x mix(day, night)), the shops' atlas
KIT_INT = {'fk:int_dark': {'Inside': 0.28}, 'fk:int_lit': {'Inside': 0.3, 'nightEmit': 1}, 'fk:int_blind': {'Inside': 0.6},
           'fk:int_blindLit': {'Inside': 0.6, 'nightEmit': 1}, 'fk:int_slats': {'Inside': 0.6}, 'fk:int_curtain': {'Inside': 0.6},
           'fk:int_sheer': {'Inside': 1.0}, 'fk:int_sheerLit': {'Inside': 1.0}, 'fk:int_shop': {'Inside': 0.3}, 'fk:int_goods': {'Inside': 0.3},
           'fk:int_frosted': {'Inside': 1.0}, 'fk:int_shopLight': {'nightEmit': 1},
           'fk:lv:shop': {'Inside': 0.3, 'SelfLv': 1, 'SelfDay': 0.13, 'SelfNight': 1.3},
           'fk:lv:goods': {'Inside': 0.3, 'SelfLv': 1, 'SelfDay': 0.22, 'SelfNight': 1.1},
           'fk:lv:shopwall': {'Inside': 0.3, 'SelfLv': 1, 'SelfDay': 0.16, 'SelfNight': 1.25, 'ShopRows': 8},
           'fk:lv:poster': {'Inside': 0.45, 'SelfLv': 1, 'SelfDay': 0.2, 'SelfNight': 0.9}}
# S125: the tower kit's landmark glass families (client/src/city/tk/tkParams.js LM_GLASS), their albedo x tint (linear)
TW_GLASS = {'one57cobalt': (0.0144, 0.0313, 0.088), 'one57sky': (0.044, 0.0728, 0.1113), 'cptSilver': (0.0686, 0.078, 0.0867),
            'twcClear': (0.0414, 0.0568, 0.0673), 'gmBlack': (0.0134, 0.0137, 0.016), 'cpwGold': (0.0784, 0.0499, 0.0182),
            'bronzeDark': (0.0318, 0.0207, 0.0128)}
KIT_GLASS = {'fk:int_winglass': {'GlassF0': 0.2, 'GlassDirt': 0.3}, 'fk:int_shopglass': {'GlassF0': 0.07, 'GlassDirt': 0.22}}
# FP18 (2026-10-18, the owner: the towers' glass "too simple"): every tower kit glass family (the landmark families above,
# the curtain-wall families and the punched windows, which drew on the generic master as flat opaque colour) on
# M_bx_curtain2 (ue_masters.py: mirror-smooth glass over a room of its own light): per family its reflectance at normal
# incidence (a double-glazed unit's two panes about 0.07, the coated families more), the reflection's tint, the room's
# daylight level, the blinds' and the lit ceilings' shares, and the pane (width, height, the room's depth; m)
TK_GLASS2 = {'twcClear': (0.075, (0.96, 1.0, 1.04), 0.30, 0.15, 0.50), 'one57cobalt': (0.10, (0.78, 0.92, 1.14), 0.22, 0.12, 0.45),
             'one57sky': (0.09, (0.86, 0.97, 1.10), 0.24, 0.12, 0.45), 'cptSilver': (0.12, (0.97, 1.0, 1.03), 0.22, 0.15, 0.45),
             'gmBlack': (0.10, (1.0, 1.0, 1.0), 0.12, 0.10, 0.40), 'cpwGold': (0.20, (1.15, 0.95, 0.62), 0.20, 0.15, 0.45),
             'bronzeDark': (0.12, (1.08, 0.95, 0.78), 0.18, 0.15, 0.45), 'blue': (0.09, (0.82, 0.96, 1.10), 0.24, 0.15, 0.45),
             'bronze': (0.11, (1.08, 0.96, 0.80), 0.22, 0.15, 0.45), 'gold': (0.18, (1.15, 0.97, 0.66), 0.20, 0.15, 0.45),
             'silver': (0.12, (0.97, 1.0, 1.03), 0.22, 0.15, 0.45), 'grey': (0.08, (1.0, 1.0, 1.0), 0.24, 0.15, 0.45),
             'win': (0.07, (1.0, 1.0, 1.0), 0.30, 0.30, 0.30)}
TK_PANE2 = {'win': (2.4, 2.9, 4.5)}   # (the kit's punched window; the curtain walls' panes about 1.45 x 3.6 m)


def curtain2_params(tname, r):
    """FP18: a tower kit glass record's M_bx_curtain2 parameters ({name: 4 floats}), or None"""
    if not tname.startswith('tk:glass_'): return None
    fam = ((r.get('userData') or {}).get('tkGlass')) or tname[len('tk:glass_'):]
    if fam == 'window': fam = 'win'
    if fam not in TK_GLASS2: return None
    f0, rt, rk, bk, lk = TK_GLASS2[fam]
    c_ = TW_GLASS.get(fam) or list(r.get('color') or [0.06, 0.07, 0.08])[:3]
    pn = TK_PANE2.get(fam, (1.45, 3.6, 4.0))
    return {'Col': (c_[0] / 0.6, c_[1] / 0.6, c_[2] / 0.6, 0.0), 'Mul': (1000.0, 1000.0, 0.001, -500.0), 'Gl': (f0, rk, bk, lk),
            'Rt': tuple(rt) + (0.0,), 'Pane': tuple(pn) + (0.0,)}
# the dresser's room fills (unlit): main.js dims the rooms to 0.3 after dark and keeps the shops at 0.85
UNLIT_NIGHT = {'roomFill': 0.3, 'shopFill': 0.85}


def san(s):
    return re.sub(r'[^A-Za-z0-9]', '_', s or '')


def srgb2lin(c):
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c]


def is_pool(r):   # FOUNT45: a fountain's pool or basin (fountainFX.js poolRings, cpWaterMat.js cpPoolWaterMat)
    ou = r.get('obcUni') or {}
    return 'fwRR' in ou or 'cpwRing' in ou


def is_veil(r):
    return (r.get('name') or '') == 'fw26:veil'


def fount_entries(P, r):
    """FOUNT45: a fountain material's world points (one package) -> one entry per fountain (connected 1 m cells within
    3 m) and, for a veil, per tier (gaps over 0.2 m in height): centre, lip, foot, radii, with the package's own record's
    values; every entry {'c': [x, z], 'y': [foot, lip], 'rmax', 'uni'}"""
    import numpy as np
    g = np.floor(P[:, [0, 2]]).astype(np.int64)
    cells = {}
    for i, c in enumerate(map(tuple, g)): cells.setdefault(c, []).append(i)
    lab, comps = {}, []
    for c in cells:
        if c in lab: continue
        lab[c] = len(comps); q, comp = [c], [c]
        while q:
            a_ = q.pop()
            for dx in range(-3, 4):
                for dz in range(-3, 4):
                    b_ = (a_[0] + dx, a_[1] + dz)
                    if b_ in cells and b_ not in lab: lab[b_] = lab[c]; q.append(b_); comp.append(b_)
        comps.append(comp)
    ou = r.get('obcUni') or {}
    uni = {u: (v.get('vec') if isinstance(v, dict) else v) for u, v in ou.items() if u in ('fwRR', 'fwRF', 'fwB2', 'cpwRing', 'cpwFoamU', 'fwV', 'fwA', 'fwF', 'fwT0')}
    out = []
    for comp in comps:
        Q = P[[i for c in comp for i in cells[c]]]
        lo0, hi0 = Q.min(0), Q.max(0); cx, cz = (lo0[0] + hi0[0]) / 2, (lo0[2] + hi0[2]) / 2
        rq = np.hypot(Q[:, 0] - cx, Q[:, 2] - cz)
        tiers = [np.ones(len(Q), bool)]
        if is_veil(r):   # (a fountain's falls, the crown's jet over the bowl's sheet, one tier under another: connected in
            # radius and height on 0.25 m x 0.75 m cells, the lathe's rings a few tenths of a metre apart)
            gc = np.stack([np.floor(rq / 0.25), np.floor(Q[:, 1] / 0.75)], 1).astype(np.int64)
            occ = {}
            for i, c in enumerate(map(tuple, gc)): occ.setdefault(c, []).append(i)
            tl, tiers = {}, []
            for c in occ:
                if c in tl: continue
                tl[c] = len(tiers); q2, mem = [c], [c]
                while q2:
                    a_ = q2.pop()
                    for dx in (-1, 0, 1):
                        for dz in (-1, 0, 1):
                            b_ = (a_[0] + dx, a_[1] + dz)
                            if b_ in occ and b_ not in tl: tl[b_] = tl[c]; q2.append(b_); mem.append(b_)
                m_ = np.zeros(len(Q), bool); m_[[i for c2 in mem for i in occ[c2]]] = True; tiers.append(m_)
        for m_ in tiers:
            T_, rT = Q[m_], rq[m_]
            out.append({'c': [round(float(cx), 3), round(float(cz), 3)], 'y': [round(float(T_[:, 1].min()), 3), round(float(T_[:, 1].max()), 3)],
                        'rmax': round(float(rT.max()), 3), 'rmid': round(float(rT.mean()), 3), 'uni': uni})
    return out


def _fount_points(f, L, J, want):
    """{material index: world points} of the non-instanced meshes bound to the materials in `want` (a glb's bytes)"""
    import numpy as np
    o = 20 + L; bl = struct.unpack('<I', f[o:o + 4])[0]; B = f[o + 8:o + 8 + bl]
    root = J['nodes'][J['scenes'][0]['nodes'][0]]; t = np.array(root.get('translation') or [0, 0, 0], np.float64)
    pts = {}
    for ni in root.get('children', []):
        n = J['nodes'][ni]
        if 'mesh' not in n or (n.get('extensions') or {}).get('EXT_mesh_gpu_instancing') or n.get('matrix') or n.get('rotation') or n.get('scale'): continue
        nt = np.array(n.get('translation') or [0, 0, 0], np.float64)
        for pr in J['meshes'][n['mesh']]['primitives']:
            if pr.get('material') not in want: continue
            a = J['accessors'][pr['attributes']['POSITION']]; bv = J['bufferViews'][a['bufferView']]
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0); st = bv.get('byteStride') or 12
            X = np.frombuffer(B, np.float32, a['count'] * 3, off).reshape(-1, 3) if st == 12 else \
                np.stack([np.frombuffer(B, np.float32, 3, off + i * st) for i in range(a['count'])])
            pts.setdefault(pr['material'], []).append(X.astype(np.float64) + t + nt)
    return {k: np.concatenate(v) for k, v in pts.items()}


# BOARD45 (2026-10-15): the TA31 atlas's cells (client/src/city/billboards.js taLayout: the shelves packed left to right,
# one range per class, big cells first; each cell inset 2 px, v from the bottom) and their mean colours, as ue_prep's
# board_table writes M_bx_board's Tab (7 rows x cells, 24-bit integers in RGB): beside the atlas in the texture store
TA_SHELVES = [(544, [('W2', 1136), ('W2', 1136), ('W2', 1136), ('S', 600)]),
              (544, [('W2', 1136), ('W1', 816), ('W1', 816), ('T1', 436), ('T1', 436), ('T1', 436)]),
              (460, [('W3', 1380), ('W3', 1380), ('W1', 690), ('S', 506)]),
              (260, [('R', 1536), ('R', 1536), ('W3', 780)]),
              (240, [('W2', 504), ('W2', 504), ('W2', 504), ('W2', 504), ('W1', 360), ('W1', 360), ('W1', 360), ('W1', 360), ('S', 264), ('S', 264)])]
TA_CLASSES = ['T1', 'S', 'W1', 'W2', 'W3', 'R']


def ta31_table(atlas_png, W_=4096.0, H_=2048.0):
    """the board table PNG for an atlas (cached beside it, <atlas>.ta31tab.png); returns (path, cells)"""
    out = atlas_png[:-4] + '.ta31tab.png'
    raw, y = [], 0
    for h, row in TA_SHELVES:
        x = 0
        for cls, w in row: raw.append((cls, x, y, w, h)); x += w
        y += h
    cells = [r for cls in TA_CLASSES for r in sorted([r for r in raw if r[0] == cls], key=lambda r: -r[3] * r[4])]
    if os.path.exists(out): return out, len(cells)
    import numpy as np
    from PIL import Image
    R = np.array([((x + 2) / W_, 1 - (y + h - 2) / H_, (w - 4) / W_, (h - 4) / H_) for _, x, y, w, h in cells])
    im = np.asarray(Image.open(atlas_png).convert('RGB').resize((512, 256), Image.BILINEAR), np.float64) / 255.0
    lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
    M = np.array([lin[int(np.floor((1 - y - h) * 256)):int(np.ceil((1 - y) * 256)), int(np.floor(x * 512)):int(np.ceil((x + w) * 512))].reshape(-1, 3).mean(0) for x, y, w, h in R])
    q = lambda v, k: np.clip(np.round(np.asarray(v) * k), 0, 2 ** 24 - 1).astype(np.int64)
    rows = [q(R[:, 0] * W_, 256), q(R[:, 1] * H_, 256), q(R[:, 2] * W_, 256), q(R[:, 3] * H_, 256), q(M[:, 0], 1e6), q(M[:, 1], 1e6), q(M[:, 2], 1e6)]
    img = np.full((len(rows), len(R), 4), 255, np.uint8)
    for r_, v in enumerate(rows):
        img[r_, :, 0] = (v >> 16) & 255; img[r_, :, 1] = (v >> 8) & 255; img[r_, :, 2] = v & 255
    tmp = out + f'.{os.getpid()}.png'; Image.fromarray(img, 'RGBA').save(tmp); os.replace(tmp, out)
    return out, len(cells)


def cell_records(cells):
    """{sanitised material name: three record (+ _kind ground, + _fount: FOUNT45's fountains)} over the world's cell glbs"""
    R = {}
    for fn in sorted(os.listdir(cells)):
        if not fn.endswith('.glb'): continue
        f = open(os.path.join(cells, fn), 'rb').read()
        L = struct.unpack('<I', f[12:16])[0]
        J = json.loads(f[20:20 + L])
        ground = set()
        for n in J.get('nodes', []):
            if (n.get('extras') or {}).get('class') == -1 and 'mesh' in n:
                ground |= {pr.get('material') for pr in J['meshes'][n['mesh']]['primitives']}
        fount = {}
        for mi, m in enumerate(J.get('materials', [])):
            r = dict((m.get('extras') or {}).get('three') or {})
            k = san(m.get('name'))
            R.setdefault(k, r)
            if mi in ground: R[k]['_kind'] = 'ground'   # (ground in any cell: the same key is the same material)
            if is_pool(r) or is_veil(r): fount[mi] = (k, r)
            if 'taAtlas' in (r.get('obcUni') or {}) and '_tab' not in R[k]:   # BOARD45
                ap_ = tex_path((r.get('textures') or {}).get('map'))
                if ap_:
                    try: R[k]['_tab'], R[k]['_nc'] = ta31_table(ap_)
                    except Exception as ex: print(f'[cellmat2] board table of {k}: {type(ex).__name__}: {ex}', flush=True)
        if fount:
            try:
                for mi, P in _fount_points(f, L, J, set(fount)).items():
                    k, r = fount[mi]
                    for e in fount_entries(P, r):   # (one fountain drawn by two packages: its parts merge by centre and tier)
                        F = R[k].setdefault('_fount', [])
                        m_ = next((x for x in F if abs(x['c'][0] - e['c'][0]) < 1.0 and abs(x['c'][1] - e['c'][1]) < 1.0 and min(x['y'][1], e['y'][1]) - max(x['y'][0], e['y'][0]) > -0.1), None)
                        if m_ is not None and is_veil(r) and abs(m_.get('rmid', 0) - e.get('rmid', 0)) > 0.4: m_ = None
                        if m_ is None: F.append(e)
                        else: m_['y'] = [min(m_['y'][0], e['y'][0]), max(m_['y'][1], e['y'][1])]; m_['rmax'] = max(m_['rmax'], e['rmax'])
            except Exception as ex:
                print(f'[cellmat2] fountains of {fn}: {type(ex).__name__}: {ex}', flush=True)
    return R


def tex_path(rec):
    f = (rec or {}).get('file')
    if f and os.path.exists(os.path.join(CELLCACHE, f)): return os.path.join(CELLCACHE, f)
    return None


def in_engine():
    import unreal
    for p in (EXPORT, os.path.join(EXPORT, 'ue_project', 'Python')):
        if p not in sys.path: sys.path.insert(0, p)
    import ue_masters
    C = json.load(open(os.environ['R1C_CELLMAT2_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    T = {'generic': 0, 'family': 0, 'pbr_hq': 0, 'hidden': 0, 'textures_new': 0, 'textures_reused': 0, 'unbound_white': {}}
    t0 = time.time()
    # ---- the take's night: a parameter collection the masters read (r1c_actors.py keys MPC_r1c.Night in the take's sequence)
    if eal.does_asset_exist(MPC): mpc = eal.load_asset(MPC)
    else: mpc = atools.create_asset(MPC.split('/')[-1], '/'.join(MPC.split('/')[:-1]), unreal.MaterialParameterCollection, unreal.MaterialParameterCollectionFactoryNew())
    if 'Night' not in [str(p_.get_editor_property('parameter_name')) for p_ in mpc.get_editor_property('scalar_parameters')]:
        sp_ = unreal.CollectionScalarParameter(); sp_.set_editor_property('parameter_name', 'Night'); sp_.set_editor_property('default_value', 0.0)
        mpc.set_editor_property('scalar_parameters', list(mpc.get_editor_property('scalar_parameters')) + [sp_]); eal.save_loaded_asset(mpc)
    ue_masters.board_mpc = lambda: mpc   # (the masters' 'mpc' inputs read MPC_r1c, not the take boards' MPC_bx)
    content = unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir())
    def master(name, spec, post=None):
        """a master built once per name (each name carries its version: a rebuilt master never orphans another world's instances)"""
        ap_ = f'/Game/Bx/M_bx_{name}'
        vf = os.path.join(content, 'Bx', f'.{name}')
        if os.path.exists(vf) and eal.does_asset_exist(ap_): return eal.load_asset(ap_)
        ue_masters.build(name, spec, ue_masters.defaults())
        m = eal.load_asset(ap_)
        if post: post(m)
        for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
            try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
            except Exception: pass
        mel.recompile_material(m); eal.save_loaded_asset(m)
        os.makedirs(os.path.dirname(vf), exist_ok=True); open(vf, 'w').write('1')
        T.setdefault('masters_built', []).append(name)
        return m
    def add_vca(m):   # (the vertex colour's alpha as one more input of the Custom node: the contact decals' strength)
        cu = next((e for e in mel.get_material_expressions(m) if isinstance(e, unreal.MaterialExpressionCustom)), None) \
            if hasattr(mel, 'get_material_expressions') else None
        if cu is not None:
            ins = list(cu.get_editor_property('inputs')); ci = unreal.CustomInput(); ci.set_editor_property('input_name', 'VCA'); ins.append(ci)
            cu.set_editor_property('inputs', ins)
            vca = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -1200, 600)
            T['vca_connected'] = bool(mel.connect_material_expressions(vca, 'A', cu, 'VCA'))
    def additive(m):
        m.set_editor_property('blend_mode', unreal.BlendMode.BLEND_ADDITIVE)
    master_ = master(f'r1ccell_v{VERSION}', (CELL, CELL_IN, CELL_OUT, {}), add_vca)
    # ==== R2B (2026-10-11): the bridges' cables and hangers (three name br:cable:*) on the generic master plus a world
    # position offset that pushes each vertex out along its normal by CablePx x its distance from the lens, as the client's
    # cable material does (client/src/city/br/mats.js cable(): about half a pixel), so a 7 cm hanger still draws at 500 m
    # instead of falling under the pixel and vanishing in the temporal resolve
    def add_wpo(m):
        E = lambda cls, x, y: mel.create_material_expression(m, cls, x, y)
        nrm = E(unreal.MaterialExpressionVertexNormalWS, -900, 900)
        wp = E(unreal.MaterialExpressionWorldPosition, -1100, 1000)
        cam = E(unreal.MaterialExpressionCameraPositionWS, -1100, 1100)
        dist = E(unreal.MaterialExpressionDistance, -900, 1050)
        mel.connect_material_expressions(wp, '', dist, 'A'); mel.connect_material_expressions(cam, '', dist, 'B')
        px = E(unreal.MaterialExpressionScalarParameter, -900, 1150)
        px.set_editor_property('parameter_name', 'CablePx'); px.set_editor_property('default_value', 0.0)
        m1 = E(unreal.MaterialExpressionMultiply, -700, 1000); mel.connect_material_expressions(dist, '', m1, 'A'); mel.connect_material_expressions(px, '', m1, 'B')
        m2 = E(unreal.MaterialExpressionMultiply, -500, 950); mel.connect_material_expressions(nrm, '', m2, 'A'); mel.connect_material_expressions(m1, '', m2, 'B')
        T['cable_wpo'] = bool(mel.connect_material_property(m2, '', unreal.MaterialProperty.MP_WORLD_POSITION_OFFSET))
    M_CABLE = master('r2bcable_v1', (CELL, CELL_IN, CELL_OUT, {}), lambda m: (add_vca(m), add_wpo(m)))
    # ==== end R2B
    M_SIGN = master(f'r1csign_v{SIGN_VERSION}', (SIGN, SIGN_IN, SIGN_OUT, {}))
    M_SHADE = master(f'r1cshade_v{SIGN_VERSION}', (SHADE, SHADE_IN, [('Opacity', 1)], {'blend': 'composite', 'unlit': True}))
    M_HALO = master(f'r1chalo_v{SIGN_VERSION}', (HALO, HALO_IN, [], {'unlit': True}), additive)
    M_GLOW = master(f'r1cglow_v{SIGN_VERSION}', (GLOWVC, GLOWVC_IN, GLOWVC_OUT, {}))
    master = master_
    # ---- the HQ sets for the PBR library
    HQ = json.load(open(os.path.join(EXPORT, 'ue_families.json'))).get('hq') or {}
    try: HQM = json.load(open(HQ.get('manifest') or '/data0/projectnyc_aux/assets/hq/hq.json'))
    except Exception: HQM = {}
    # ---- the frozen family library (built once, from resolved takes' instances, their textures duplicated beside them)
    lib = {}
    if eal.does_directory_exist(LIB):
        for ap in eal.list_assets(LIB, recursive=False, include_folder=False):
            nm = ap.split('/')[-1].split('.')[0]
            if nm.startswith('MI_'): lib[nm[3:]] = ap.split('.')[0]
    if not lib and C.get('lib_from'):
        import ue_mat
        names = {}
        for tk in C['lib_from']:
            tags = json.load(open(tk['side'])).get('materials') or {}
            for ap in eal.list_assets(tk['dest'], recursive=True, include_folder=False):
                if '/BxTex/' in ap or eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
                mi = eal.load_asset(ap)
                nm = ap.split('/')[-1].split('.')[0]
                for pn in (ue_mat.prim_names(mi) or [nm[3:] if nm.startswith('MI_') else nm]):
                    tg = tags.get(pn) or {}
                    key = '#ground' if tg.get('kind') == 'ground' else (tg.get('name') or '')
                    if key and (key == '#ground' or key.startswith(FAMILY_NAMES)) and key not in names: names[key] = ap.split('.')[0]
        tdone = {}
        for key, src in names.items():
            dst = f'{LIB}/MI_{san(key)}'
            if not eal.does_asset_exist(dst): eal.duplicate_asset(src, dst)
            mi = eal.load_asset(dst)
            tps = list(mi.get_editor_property('texture_parameter_values'))
            for tp in tps:
                t_ = tp.get_editor_property('parameter_value')
                if t_ is None: continue
                tpath = t_.get_path_name().split('.')[0]
                if tpath.startswith(LIB) or tpath.startswith('/Game/Bx/'): continue
                if tpath not in tdone:
                    nd = f'{LIB}/Tex/{tpath.split("/")[-1]}_{hashlib.sha1(tpath.encode()).hexdigest()[:8]}'
                    if not eal.does_asset_exist(nd): eal.duplicate_asset(tpath, nd)
                    tdone[tpath] = eal.load_asset(nd)
                mel.set_material_instance_texture_parameter_value(mi, tp.get_editor_property('parameter_info').get_editor_property('name'), tdone[tpath])
            mel.update_material_instance(mi)
            lib[san(key)] = dst
        eal.save_directory(LIB, only_if_is_dirty=True, recursive=True)
        T['lib_built'] = len(lib)
    T['lib'] = len(lib)
    # ---- the texture library: every texture the world's materials name, imported once by content hash
    recs = json.load(open(C['records']))
    want, hcache = {}, {}
    def need(path, srgb):
        if not path: return None
        if path not in hcache:   # (one content hash per file: the HQ sets serve hundreds of materials)
            hcache[path] = os.path.splitext(os.path.basename(path))[0] if '/cellcache/tex/' in path else hashlib.sha256(open(path, 'rb').read()).hexdigest()[:24]
        h = hcache[path]
        nm = f'T_{h}' + ('' if srgb else '_lin')
        want[nm] = (path, srgb)
        return f'{TEXLIB}/{nm}'
    plan = {}
    for k, r in recs.items():
        tx = r.get('textures') or {}
        # (the sign kit's coverage and shade pages are data: read linear; its colour faces and halos sRGB, as their records say)
        lin_map = (r.get('name') or '').startswith('ar33sign') and (tx.get('map') or {}).get('colorSpace') != 'srgb'
        P = {'map': need(tex_path(tx.get('map')), not lin_map), 'nrm': need(tex_path(tx.get('normalMap')), False),
             'emis': need(tex_path(tx.get('emissiveMap')), True), 'alpha': need(tex_path(tx.get('alphaMap')), False),
             'orm': need(tex_path(tx.get('roughnessMap') or tx.get('metalnessMap')), False)}
        pb = ((r.get('userData') or {}).get('pbr') or {})
        sid = (HQ.get('pbr') or {}).get(pb.get('name')) if pb else None
        if sid and sid in HQM:
            f = HQM[sid].get('files') or {}
            P['map'] = need(f.get('alb'), True); P['nrm'] = need(f.get('nrm'), False); P['orm'] = need(f.get('arm'), False)
            P['world'] = float((HQM[sid].get('size_m') or [2.0])[0]); P['hq'] = sid
        elif pb and pb.get('name'):
            prev = os.path.join(EXPORT, '..', '..', '..', 'public', 'textures', 'pbr', pb['name'], 'preview.jpg')
            if os.path.exists(prev): P['map'] = need(os.path.abspath(prev), True); P['world'] = 2.0
        if 'vkPaint' in (r.get('obcUni') or {}):   # VK45: the viaduct's paint and rust sets (ue_families.json hq.vk: P, R)
            vh = {}
            for slot, sid in ((HQ.get('vk') or {}).items()):
                m_ = HQM.get(sid) or {}; f_ = m_.get('files') or {}
                if slot.startswith('_') or not all(f_.get(x) and os.path.exists(f_[x]) for x in ('alb', 'nrm', 'arm')): continue
                vh[slot] = {'alb': need(f_['alb'], True), 'nrm': need(f_['nrm'], False), 'arm': need(f_['arm'], False),
                            'size': float((m_.get('size_m') or [2.0])[0]), 'mean': list((m_.get('albedo_mean') or [0.5, 0.5, 0.5])[:3])}
            P['vk'] = vh
        plan[k] = P
    tasks, made = [], []
    for nm, (path, srgb) in sorted(want.items()):
        if eal.does_asset_exist(f'{TEXLIB}/{nm}'): T['textures_reused'] += 1; continue
        task = unreal.AssetImportTask()
        for kk, vv in (('filename', path), ('destination_path', TEXLIB), ('destination_name', nm), ('automated', True), ('replace_existing', True), ('save', False)):
            task.set_editor_property(kk, vv)
        tasks.append(task); made.append((nm, srgb))
    for i in range(0, len(tasks), 64):
        atools.import_asset_tasks(tasks[i:i + 64])
    for nm, srgb in made:
        t_ = eal.load_asset(f'{TEXLIB}/{nm}')
        if t_ is None: continue
        try:
            t_.set_editor_property('srgb', bool(srgb))
            if nm.endswith('_lin'): t_.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
        except Exception: pass
        T['textures_new'] += 1
    if made: eal.save_directory(TEXLIB, only_if_is_dirty=True, recursive=True)
    T['textures_s'] = round(time.time() - t0, 1)
    # ---- every material instance of the world
    # (matching an instance to its record: Interchange renames materials ('vk:ballast#9ea6...' -> 'vk-ballast_9ea6...',
    # 'X#216468de1213c883@4_-5' -> 'X_216468de1213c883_4_'), so by the key's 16-hex hash, then the longest common prefix of
    # the names with every non-alphanumeric dropped)
    norm = lambda x: re.sub(r'[^a-z0-9]', '', x.lower())
    byhash = {}
    for k_ in recs:
        for h_ in re.findall(r'(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])', k_): byhash.setdefault(h_, []).append(k_)
    def find(nm_):
        cands = [c for h_ in re.findall(r'(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])', nm_) for c in byhash.get(h_, [])]
        if not cands: return None
        n_ = norm(nm_)
        def lcp(c):
            a_, i = norm(c), 0
            while i < min(len(a_), len(n_)) and a_[i] == n_[i]: i += 1
            return i
        return max(cands, key=lcp)
    hide = set(C.get('hide') or [])
    hm = eal.load_asset('/Game/Bx/M_bx_hidden')
    for ap in [x for d_ in C['world_dest'].split(',') for x in eal.list_assets(d_, recursive=True, include_folder=False)]:   # (GB43: a list of folders, the cell cache's new cells)
        if eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
        nm = ap.split('/')[-1].split('.')[0]
        if nm.startswith('lod16'): continue   # (lane B's far city: r1c_lodmat.py's masters)
        k = find(nm)
        r = recs.get(k) or {}
        if not r:
            T['no_record'] = T.get('no_record', 0) + 1
            # (city v2: the material library's folders hold every round's keys and a round's binding reads only its own
            # cells' records; an instance with none here keeps its binding, never the generic master's defaults)
            if ap.startswith('/Game/MatLib/'): continue
        tname = r.get('name') or ''
        tx = r.get('textures') or {}
        mi = eal.load_asset(ap)
        gen_alpha = (not tname) and float(r.get('alphaTest') or 0) > 0 and any((t or {}).get('generated') and not tex_path(t) for t in tx.values())
        if tname in hide or (gen_alpha and C.get('hide_generated_alpha')) or (r.get('type') == 'ShaderMaterial' and not tx):
            if hm is not None:
                mel.set_material_instance_parent(mi, hm); mel.update_material_instance(mi); T['hidden'] += 1
            continue
        c2_ = curtain2_params(tname, r)
        if c2_:
            # FP18: the kit's glass on M_bx_curtain2 (TK_GLASS2 above; S125's M_bx_curtain for the landmark families below)
            cm2 = eal.load_asset('/Game/Bx/M_bx_curtain2')
            if cm2 is None:
                if os.path.join(EXPORT, 'ue_project', 'Python') not in sys.path: sys.path.insert(0, os.path.join(EXPORT, 'ue_project', 'Python'))
                import ue_masters
                ue_masters.build('curtain2', ue_masters.MASTERS['curtain2'], ue_masters.defaults())
                cm2 = eal.load_asset('/Game/Bx/M_bx_curtain2')
                for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
                    try: mel.set_material_usage(cm2, getattr(unreal.MaterialUsage, u))
                    except Exception: pass
                mel.recompile_material(cm2); eal.save_loaded_asset(cm2)
            mel.set_material_instance_parent(mi, cm2); mel.clear_all_material_instance_parameters(mi)
            for pn_, pv_ in c2_.items(): mel.set_material_instance_vector_parameter_value(mi, pn_, unreal.LinearColor(*[float(x) for x in pv_]))
            mel.update_material_instance(mi); T['tk_glass2'] = T.get('tk_glass2', 0) + 1
            continue
        if tname.startswith('tk:glass_') and tname[len('tk:glass_'):] in TW_GLASS:
            # S125 (2026-10-16, the owner: the towers the aerial passes "too basic", their tiling distracting): the tower kit's
            # landmark curtain walls (tkParams.js LM_GLASS) drew on the rooms family as opaque beige panes in golden light
            # (111 West 57th's first stills); on M_bx_curtain they are near-mirror glass over a dark interior in the family's
            # colour, each pane the kit's own quad with its own tilt; the kit draws the mullions and spandrels, so the
            # master's are off (cells a kilometre wide, the spandrel band below zero)
            cm_ = eal.load_asset('/Game/Bx/M_bx_curtain')
            if cm_ is not None:
                mel.set_material_instance_parent(mi, cm_); mel.clear_all_material_instance_parameters(mi)
                c_ = TW_GLASS[tname[len('tk:glass_'):]]
                mel.set_material_instance_vector_parameter_value(mi, 'Col', unreal.LinearColor(c_[0] / 0.6, c_[1] / 0.6, c_[2] / 0.6, 0.0))
                mel.set_material_instance_vector_parameter_value(mi, 'Mul', unreal.LinearColor(1000.0, 1000.0, 0.001, -500.0))
                mel.update_material_instance(mi); T['tw_glass'] = T.get('tw_glass', 0) + 1
                continue
        fam = lib.get('_ground') if r.get('_kind') == 'ground' else next((lib[san(n)] for n in [tname] if n and san(n) in lib), None)
        if fam is None and tname:
            fam = next((v for kk, v in lib.items() if tname.startswith(FAMILY_NAMES) and san(tname).startswith(kk)), None)
        ouv = r.get('obcUni') or {}
        if ('uRefl' in ouv and 'uSunD' in ouv and not tx and r.get('type') == 'MeshStandardMaterial' and not (r.get('obcAttrs') or [])
                and 0.2 <= float(r.get('metalness') or 0) <= 0.35 and float(r.get('roughness') or 1) <= 0.4 and 'uSmP' not in ouv):   # (not the metal crowns and spires)
            # CURTAIN45 (2026-10-15): a glass tower the web draws as a prism with its painted sky reflection (30 Hudson Yards
            # drew as a dark slab without a window): M_bx_curtain, mullions, spandrels and dielectric glass in its colour
            cm_ = eal.load_asset('/Game/Bx/M_bx_curtain')
            if cm_ is None:
                if os.path.join(EXPORT, 'ue_project', 'Python') not in sys.path: sys.path.insert(0, os.path.join(EXPORT, 'ue_project', 'Python'))
                import ue_masters
                ue_masters.build('curtain', ue_masters.MASTERS['curtain'], ue_masters.defaults())
                cm_ = eal.load_asset('/Game/Bx/M_bx_curtain')
                for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
                    try: mel.set_material_usage(cm_, getattr(unreal.MaterialUsage, u))
                    except Exception: pass
                mel.recompile_material(cm_); eal.save_loaded_asset(cm_)
            mel.set_material_instance_parent(mi, cm_); mel.clear_all_material_instance_parameters(mi)
            c_ = list(r.get('color') or [0.2, 0.3, 0.4])[:3]
            mel.set_material_instance_vector_parameter_value(mi, 'Col', unreal.LinearColor(float(c_[0]), float(c_[1]), float(c_[2]), 0.0))
            mel.update_material_instance(mi); T['curtain'] = T.get('curtain', 0) + 1
            continue
        if 'taAtlas' in ouv and r.get('_tab') and (plan.get(k) or {}).get('map') and eal.does_asset_exist('/Game/Bx/M_bx_board'):
            # BOARD45 (2026-10-15, the owner: the Times Square billboards' textures broken): the TA31 boards on M_bx_board as
            # the takes bind them (ue_mat.board_take): the atlas (BC7), the cell table (uncompressed, unfiltered), the board's
            # playlist from UV 1-3 (r1c_cells.py board_uvs); the city's sim time is MPC_bx.SimT (0 unless a take keys it).
            # Before, the generic master drew the whole atlas on every board.
            import ue_masters
            tp_ = r['_tab']; tn_ = 'T_' + re.sub(r'[^A-Za-z0-9_]', '_', os.path.basename(tp_)[:-4])
            tab = eal.load_asset(f'{TEXLIB}/{tn_}') if eal.does_asset_exist(f'{TEXLIB}/{tn_}') else None
            if tab is None:
                tab = ue_masters.import_texture(tp_, TEXLIB, tn_, False)
                tab.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_VECTOR_DISPLACEMENTMAP)
                tab.set_editor_property('mip_gen_settings', unreal.TextureMipGenSettings.TMGS_NO_MIPMAPS)
                tab.set_editor_property('filter', unreal.TextureFilter.TF_NEAREST)
                tab.set_editor_property('srgb', False); eal.save_loaded_asset(tab)
            atl = eal.load_asset(plan[k]['map'])
            if atl.get_editor_property('compression_settings') != unreal.TextureCompressionSettings.TC_BC7:
                atl.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_BC7); eal.save_loaded_asset(atl)
            mel.set_material_instance_parent(mi, eal.load_asset('/Game/Bx/M_bx_board')); mel.clear_all_material_instance_parameters(mi)
            mel.set_material_instance_texture_parameter_value(mi, 'Tex', atl); mel.set_material_instance_texture_parameter_value(mi, 'Tab', tab)
            av_ = (ouv.get('taAtlas') or {}).get('vec') or [4096, 2048]
            mel.set_material_instance_vector_parameter_value(mi, 'Atl', unreal.LinearColor(float(av_[0]), float(av_[1]), 0.0, 0.0))
            mel.set_material_instance_scalar_parameter_value(mi, 'NC', float(r.get('_nc') or 29))
            mel.update_material_instance(mi); T['boards'] = T.get('boards', 0) + 1
            continue
        if 'vkPaint' in ouv:
            # VK45 (2026-10-15, the owner: "the PBR material/texture of the viaduct seems to have been lost", t7ArchTrack):
            # the elevated lines' steel (city/vk/vkMats.js) on M_bx_vk as the takes bind it (ue_families.json families.vk):
            # the record's paint, rust, ground and guano uniforms, the CC0 painted steel and rust sets at their real sizes,
            # world-planar; the cells sit at their world positions, so no origin. Before, the cells' generic master drew the
            # record's flat colour.
            vm = eal.load_asset('/Game/Bx/M_bx_vk')
            if vm is not None:
                uv_ = lambda n_, d_: (ouv.get(n_) or {}).get('vec', d_) if isinstance(ouv.get(n_), dict) else d_
                us_ = lambda n_, d_: float(ouv.get(n_)) if isinstance(ouv.get(n_), (int, float)) else d_
                mel.set_material_instance_parent(mi, vm); mel.clear_all_material_instance_parameters(mi)
                for pn, un, d_ in (('Paint', 'vkPaint', [0.03, 0.07, 0.07]), ('Paint2', 'vkPaint2', [0.02, 0.06, 0.07]),
                                   ('RustC', 'vkRustC', [0.15, 0.06, 0.03]), ('RustD', 'vkRustD', [0.06, 0.03, 0.014])):
                    c_ = list(uv_(un, d_))[:3]; mel.set_material_instance_vector_parameter_value(mi, pn, unreal.LinearColor(float(c_[0]), float(c_[1]), float(c_[2]), 0.0))
                for pn, un, d_ in (('RustAmt', 'vkRustAmt', 0.3), ('Ground', 'vkGround', 3.4), ('Seed', 'vkSeed', 0.0), ('Guano', 'vkGuanoAmt', 0.3)):
                    mel.set_material_instance_scalar_parameter_value(mi, pn, us_(un, d_))
                vh = (plan.get(k) or {}).get('vk') or {}
                if all(sl in vh and all(eal.does_asset_exist(vh[sl][x]) for x in ('alb', 'nrm', 'arm')) for sl in ('P', 'R')):
                    mel.set_material_instance_scalar_parameter_value(mi, 'HqOn', 1.0)
                    mel.set_material_instance_vector_parameter_value(mi, 'HSz', unreal.LinearColor(vh['P']['size'], vh['R']['size'], 1.0, 0.0))
                    for sl, (pa, pn_, pr_, pm_) in (('P', ('HP', 'HPN', 'HPR', 'HPm')), ('R', ('HR', 'HRN', 'HRR', 'HRm'))):
                        mel.set_material_instance_texture_parameter_value(mi, pa, eal.load_asset(vh[sl]['alb']))
                        mel.set_material_instance_texture_parameter_value(mi, pn_, eal.load_asset(vh[sl]['nrm']))
                        mel.set_material_instance_texture_parameter_value(mi, pr_, eal.load_asset(vh[sl]['arm']))
                        mn = vh[sl]['mean']; mel.set_material_instance_vector_parameter_value(mi, pm_, unreal.LinearColor(mn[0], mn[1], mn[2], 0.0))
                mel.update_material_instance(mi); T['vk'] = T.get('vk', 0) + 1
                continue
        if r.get('_fount') and (is_pool(r) or is_veil(r)):
            # FOUNT45 (2026-10-15, the owner: the fountains' water "isn't proper UE5 water but some low-quality textured
            # water"; Bryant Park's and Columbia's pools had no name, so the generic master drew the web's ripple map): a
            # pool or basin on M_bx_water3, clear water over its basin with the landing rings and the plunge's foam round
            # each fountain's centre (the web's ring radius, amplitude, wavenumber, chop and foam); a veil on M_bx_veil2 with
            # each fall's table row. One library key serves several fountains, so the values are per fountain in the instance.
            F_ = r['_fount']; u_ = (F_[0].get('uni') or {})
            mname = 'water3' if is_pool(r) else 'veil2'
            fm = eal.load_asset(f'/Game/Bx/M_bx_{mname}')
            if fm is None:
                if os.path.join(EXPORT, 'ue_project', 'Python') not in sys.path: sys.path.insert(0, os.path.join(EXPORT, 'ue_project', 'Python'))
                import ue_masters
                ue_masters.build(mname, ue_masters.MASTERS[mname], ue_masters.defaults())
                fm = eal.load_asset(f'/Game/Bx/M_bx_{mname}')
                for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
                    try: mel.set_material_usage(fm, getattr(unreal.MaterialUsage, u))
                    except Exception: pass
                mel.recompile_material(fm); eal.save_loaded_asset(fm)
            mel.set_material_instance_parent(mi, fm); mel.clear_all_material_instance_parameters(mi)
            V4 = lambda n_, v_: mel.set_material_instance_vector_parameter_value(mi, n_, unreal.LinearColor(*[float(x) for x in (list(v_) + [0, 0, 0, 0])[:4]]))
            S1 = lambda n_, v_: mel.set_material_instance_scalar_parameter_value(mi, n_, float(v_))
            if is_pool(r):
                cs = []
                for e in sorted(F_, key=lambda e: -e['rmax']):
                    if not any(abs(c[0] - e['c'][0]) < 1.0 and abs(c[1] - e['c'][1]) < 1.0 for c in cs): cs.append(e['c'])
                cs = cs[:4]
                rr_ = u_.get('fwRR') or (u_.get('cpwRing') or [2.4, 0.08, 17.0])[:3]
                chop = (u_.get('fwB2') or [0, 0, 0, 1.0])[3] if 'fwRR' in u_ else (u_.get('cpwRing') or [0, 0, 0, 0.8])[3]
                fo_ = u_.get('fwRF') or (u_.get('cpwFoamU') or [0, 0.55, 1.3])[:3]
                # (look pass 1, Bryant Park at cine2e: clear water read as a cyan swimming pool with foam over all of it; the
                # basins' water darker and neutral, a third of the web's foam strength, the basin behind at 0.6)
                V4('Wind', (2.0, -45.0, 15.0, 1.0)); V4('Rng', (0.008, 0.0004, 0.02, 0.0))
                V4('Abs', (0.65, 0.5, 0.42)); V4('Sct', (0.004, 0.005, 0.005)); S1('Pg', 0.8); S1('BehK', 0.6)
                S1('RgN', len(cs)); V4('RgC0', [v for c in cs[:2] for v in c]); V4('RgC1', [v for c in cs[2:4] for v in c])
                V4('Rg', (rr_[0], rr_[1], rr_[2], chop)); V4('Fm', (fo_[0] * 0.35, fo_[1], fo_[2]))
            else:
                rows = sorted(F_, key=lambda e: -(e['y'][1] - e['y'][0]) * e['rmax'])[:8]
                for j, e in enumerate(rows):
                    ue_ = e.get('uni') or {}
                    fv = ue_.get('fwV') or [0, 1, 0.35, 0.6]; fa = ue_.get('fwA') or [0.3, 0.95, 0.45, 0.2]
                    v0 = float(fv[2]); H = max(e['y'][1] - e['y'][0], 0.05)
                    tmax = (-v0 + math.sqrt(v0 * v0 + 19.62 * H)) / 9.81
                    V4(f'VT{j}', (e['c'][0], e['c'][1], e['y'][1], e['y'][0]))
                    # (look pass 1: the Lowell veil drew as a heavy lit curtain; torn into strands from the lip, the clear body low)
                    V4(f'VA{j}', (v0, tmax, 0.0, float(ue_.get('fwF', 7.0) or 7.0)))
                    V4(f'VB{j}', (fa[0], fa[1], max(float(fa[2]), 0.8), min(float(fa[3]), 0.12)))
                rm = [e['rmid'] for e in rows] + [0.0] * 8
                S1('VN', len(rows)); V4('VR0', rm[0:4]); V4('VR1', rm[4:8])
                V4('SunC', (1.0, 0.93, 0.82)); S1('SunK', 1.0)
            mel.update_material_instance(mi); T['fountain'] = T.get('fountain', 0) + 1
            continue
        if tname.startswith('cp32l:water:'):   # WATER3
            w3m = eal.load_asset(WATER3_MASTER)
            if w3m is None:
                if os.path.join(EXPORT, 'ue_project', 'Python') not in sys.path: sys.path.insert(0, os.path.join(EXPORT, 'ue_project', 'Python'))
                import ue_masters
                ue_masters.build('water3', ue_masters.MASTERS['water3'], ue_masters.defaults())
                w3m = eal.load_asset(WATER3_MASTER)
                for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
                    try: mel.set_material_usage(w3m, getattr(unreal.MaterialUsage, u))
                    except Exception: pass
                mel.recompile_material(w3m); eal.save_loaded_asset(w3m)
            body = next((v for kk, v in WATER3_BODIES.items() if kk and kk in tname.lower()), WATER3_BODIES[''])
            mel.set_material_instance_parent(mi, w3m); mel.clear_all_material_instance_parameters(mi)
            mel.set_material_instance_vector_parameter_value(mi, 'Wind', unreal.LinearColor(body[0], -45.0, body[1], body[2]))
            for nm_, v_ in WATER3_POND.items():
                if isinstance(v_, tuple): mel.set_material_instance_vector_parameter_value(mi, nm_, unreal.LinearColor(*v_))
                else: mel.set_material_instance_scalar_parameter_value(mi, nm_, float(v_))
            mel.update_material_instance(mi); T['water3'] = T.get('water3', 0) + 1
            continue
        if fam is not None:
            src = eal.load_asset(fam)
            mel.set_material_instance_parent(mi, src.get_editor_property('parent'))
            for prop in ('scalar_parameter_values', 'vector_parameter_values', 'texture_parameter_values'):
                mi.set_editor_property(prop, src.get_editor_property(prop))
            try: mi.set_editor_property('base_property_overrides', src.get_editor_property('base_property_overrides'))
            except Exception: pass
            mel.update_material_instance(mi); T['family'] += 1
            continue
        # the web's crown cards (an unnamed alpha-tested two-sided card on lane A's crown atlas): the leaf master, as ue_mat's
        # leafcard family (the atlas x the material's colour, cut by its alpha, transmission)
        P = plan.get(k) or {}
        if not tname and float(r.get('alphaTest') or 0) > 0 and int(r.get('side') or 0) == 2 and P.get('map') and eal.does_asset_exist(P['map']):
            lm = eal.load_asset('/Game/Bx/M_bx_leaf')
            if lm is not None:
                mel.set_material_instance_parent(mi, lm); mel.clear_all_material_instance_parameters(mi)
                mel.set_material_instance_texture_parameter_value(mi, 'Tex', eal.load_asset(P['map']))
                c_ = list(r.get('color') or [1, 1, 1])[:3]
                mel.set_material_instance_vector_parameter_value(mi, 'Tint', unreal.LinearColor(float(c_[0]), float(c_[1]), float(c_[2]), 0.0))
                mel.set_material_instance_scalar_parameter_value(mi, 'Trans', 0.6)
                mel.set_material_instance_scalar_parameter_value(mi, 'Rough', float(r.get('roughness') or 0.6))
                mel.update_material_instance(mi); T['leafcards'] = T.get('leafcards', 0) + 1
                continue
        # the sign kit: faces (a coverage mask on its field and ink, or a colour face), their shade quads, halos, lit letters
        if tname.startswith('ar33sign:'):
            ud_ = r.get('userData') or {}; terms = r.get('sgTerms') or {}
            kind_ = ('face' if ud_.get('sgFace') in ('mask', 'face') else 'shade' if ud_.get('sgShadeQ') else
                     'halo' if tname.startswith('ar33sign:halo') else 'glowvc' if tname.startswith('ar33sign:glowvc') else None)
            if kind_ is not None:
                mel.set_material_instance_parent(mi, {'face': M_SIGN, 'shade': M_SHADE, 'halo': M_HALO, 'glowvc': M_GLOW}[kind_])
                mel.clear_all_material_instance_parameters(mi)
                sv = lambda n, v: mel.set_material_instance_scalar_parameter_value(mi, n, float(v))
                v4 = lambda n, c: mel.set_material_instance_vector_parameter_value(mi, n, unreal.LinearColor(*[float(x) for x in (list(c) + [0, 0, 0, 0])[:4]]))
                tp_ = P.get('map'); tex_ = eal.load_asset(tp_) if tp_ and eal.does_asset_exist(tp_) else None
                if kind_ == 'face':
                    ism = ud_.get('sgFace') == 'mask'
                    sv('IsMask', 1 if ism else 0)
                    if tex_ is not None: mel.set_material_instance_texture_parameter_value(mi, 'MapL' if ism else 'MapS', tex_)
                    for pn_, k_, d_ in (('Bg', 'bg', [0, 0, 0]), ('Fg', 'fg', [1, 1, 1]), ('Lamp', 'lamp', [0, 0, 0]), ('P', 'p', [0, 0, 0, 0.32]), ('F', 'f', [0, 1, 1, 0])):
                        v4(pn_, terms.get(k_) or d_)
                    if r.get('transparent'): sv('Decal', 1)
                elif kind_ == 'shade':
                    if tex_ is not None: mel.set_material_instance_texture_parameter_value(mi, 'MapL', tex_)
                    v4('Lamp', terms.get('lamp') or [0, 0, 0]); v4('P', terms.get('p') or [0, 0, 0, 0])
                elif kind_ == 'halo':
                    if tex_ is not None: mel.set_material_instance_texture_parameter_value(mi, 'MapS', tex_)
                    v4('Color', list(r.get('color') or [1, 1, 1])[:3]); sv('Gain', ((r.get('obcUni') or {}).get('sgGain')) or 1.4)
                else:
                    v4('Lamp', terms.get('lamp') or [0, 0, 0]); v4('P', terms.get('p') or [0, 1, 0, 0])
                    sv('RoughK', r.get('roughness') if r.get('roughness') is not None else 0.3); sv('MetalK', r.get('metalness') or 0.0)
                bo = mi.get_editor_property('base_property_overrides')
                try:
                    if kind_ == 'face' and r.get('transparent'):
                        bo.set_editor_property('override_blend_mode', True); bo.set_editor_property('blend_mode', unreal.BlendMode.BLEND_TRANSLUCENT)
                    if int(r.get('side') or 0) == 2:
                        bo.set_editor_property('override_two_sided', True); bo.set_editor_property('two_sided', True)
                    mi.set_editor_property('base_property_overrides', bo)
                except Exception as e:
                    T.setdefault('override_errors', str(e)[:160])
                mel.update_material_instance(mi)
                T.setdefault('signs', {}); T['signs'][kind_] = T['signs'].get(kind_, 0) + 1
                if tex_ is None and kind_ in ('face', 'shade', 'halo'): T['signs']['no_texture'] = T['signs'].get('no_texture', 0) + 1
                continue
        # the generic master on the record's own textures (R2B: a bridge's cables on the cable master, its push from the record)
        cab_ = tname.startswith('br:cable:')
        mel.set_material_instance_parent(mi, M_CABLE if cab_ else master)
        mel.clear_all_material_instance_parameters(mi)
        sv = lambda n, v: mel.set_material_instance_scalar_parameter_value(mi, n, float(v))
        if cab_: sv('CablePx', float((r.get('userData') or {}).get('brPx') or 0.0002)); T['cables'] = T.get('cables', 0) + 1
        vv = lambda n, c: mel.set_material_instance_vector_parameter_value(mi, n, unreal.LinearColor(float(c[0]), float(c[1]), float(c[2]), 0.0))
        col = list(r.get('color') or [1, 1, 1])[:3]
        ud = r.get('userData') or {}
        if ud.get('fkBaseHex') and not tx.get('map'):
            h = ud['fkBaseHex'].lstrip('#'); col = srgb2lin([int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4)])
        tint = (((ud.get('pbr') or {}).get('opts') or {}).get('tint'))
        if isinstance(tint, str) and tint.startswith('#') and len(tint) == 7:
            col = srgb2lin([int(tint[1 + i:3 + i], 16) / 255.0 for i in (0, 2, 4)])
        pbn = ((ud.get('pbr') or {}).get('name')) or ''
        if pbn and not P.get('map') and min(col) > 0.9:   # (a PBR set with no texture of its own here: its kind's albedo)
            g = 0.06 if 'epdm' in pbn or 'black' in pbn or 'tar' in pbn else 0.55 if 'membrane' in pbn or 'white' in pbn else 0.35
            col = [g, g, g]
        vv('Color', col)
        if r.get('vertexColors'): sv('UseVC', 1)
        if tname in ('roofSilver', 'roofBlack', 'roofGravel'): sv('RoofDeck', 1)   # (S125 v8)
        # (the kit's tint per vertex is aFkTr on its shared sets only; the kit's levels (fk:lv:*) carry (level, atlas tile) in it,
        # and its interiors and glass have none: their vertex colour is theirs)
        if 'aFkTr' in (r.get('obcAttrs') or []) and not tname.startswith('fk:lv:'): sv('FkOn', 1)
        ou = r.get('obcUni') or {}
        fam_ = KIT_INT.get(tname) or {}
        for k_ in ('Inside', 'SelfLv', 'SelfDay', 'SelfNight', 'ShopRows'):
            if k_ in fam_: sv(k_, fam_[k_])
        lv_ = (ou.get('fkLv') or {}).get('vec') if isinstance(ou.get('fkLv'), dict) else None
        if lv_ and 'SelfDay' not in fam_: sv('SelfDay', lv_[0]); sv('SelfNight', lv_[1])   # (selfLit: the material's own day and night levels)
        m0 = tx.get('map') or {}
        rep, off = m0.get('repeat') or [1, 1], m0.get('offset') or [0, 0]
        mel.set_material_instance_vector_parameter_value(mi, 'UVT', unreal.LinearColor(float(rep[0]), float(rep[1]), float(off[0]), float(off[1])))
        if int(m0.get('channel') or 0) == 1: sv('Chan', 1)
        for key_, pname, flag in (('map', 'Map', 'HasMap'), ('nrm', 'Nrm', 'HasNrm'), ('emis', 'EmisMap', 'HasEmis'), ('alpha', 'AlphaMap', 'HasAlpha'), ('orm', 'Orm', 'HasOrm')):
            if P.get(key_) and eal.does_asset_exist(P[key_]):
                mel.set_material_instance_texture_parameter_value(mi, pname, eal.load_asset(P[key_])); sv(flag, 1)
        if P.get('world'): sv('World', 1); sv('Size', P['world']); T['pbr_hq'] += 1
        if P.get('hq'): sv('OrmAO', 1)
        sv('RoughK', r.get('roughness', 0.8) if r.get('roughness') is not None else 0.8)
        sv('MetalK', r.get('metalness', 0.0) or 0.0)
        em = r.get('emissive') or [0, 0, 0]
        if any(em) or tx.get('emissiveMap'):
            ek = float(r.get('emissiveIntensity') or 1.0)
            vv('Emis', em if any(em) else [1, 1, 1])
            lit_ = ud.get('lit') if isinstance(ud.get('lit'), list) and len(ud.get('lit')) == 2 else None
            if fam_.get('nightEmit'): sv('EmisK', 0.0); sv('EmisKN', ek)   # (nightEmit: the emission x the night)
            elif lit_: sv('EmisK', lit_[0]); sv('EmisKN', lit_[1])         # (a named shop's sign: its day and night intensities)
            else: sv('EmisK', ek); sv('EmisKN', ek)
        if r.get('type') == 'MeshBasicMaterial':
            sv('Unlit', 1)
            if tname in UNLIT_NIGHT: sv('UnlitNight', UNLIT_NIGHT[tname])   # (main.js: the rooms dimmed after dark, the shops kept lit)
        if r.get('nightOnly'): sv('NightOnly', 1)   # (r1c_glbuv.py's night copy: drawn only after dark)
        glass_ = KIT_GLASS.get(tname) or ({'GlassF0': 0.04, 'GlassDirt': 0.0, 'GlassBaseK': 1.0, 'UseVC': 0} if tname == 'glass' else None)
        if glass_:   # (the kit's window glass, and the dresser's: a pane over the room, its reflection at its Fresnel, premultiplied)
            sv('Glass', 1)
            for k_, v_ in glass_.items(): sv(k_, v_)
        if r.get('transparent') and r.get('vertexColors'): sv('UseVCA', 1)   # (the contact decals: their strength in the vertex alpha)
        op = float(r.get('opacity') if r.get('opacity') is not None else 1.0)
        sv('Opac', op)
        bo = mi.get_editor_property('base_property_overrides')
        at = float(r.get('alphaTest') or 0)
        try:
            if glass_:
                bo.set_editor_property('override_blend_mode', True); bo.set_editor_property('blend_mode', unreal.BlendMode.BLEND_ALPHA_COMPOSITE)
            elif r.get('transparent') and (op < 0.999 or tx.get('alphaMap') or (tx.get('map') and not (tx.get('map') or {}).get('opaque', True))):
                bo.set_editor_property('override_blend_mode', True); bo.set_editor_property('blend_mode', unreal.BlendMode.BLEND_TRANSLUCENT)
            elif r.get('nightOnly') and not r.get('transparent'):
                bo.set_editor_property('override_blend_mode', True); bo.set_editor_property('blend_mode', unreal.BlendMode.BLEND_MASKED)
                bo.set_editor_property('override_opacity_mask_clip_value', True); bo.set_editor_property('opacity_mask_clip_value', 0.5)
            elif at > 0:
                bo.set_editor_property('override_blend_mode', True); bo.set_editor_property('blend_mode', unreal.BlendMode.BLEND_MASKED)
                bo.set_editor_property('override_opacity_mask_clip_value', True); bo.set_editor_property('opacity_mask_clip_value', at)
            if int(r.get('side') or 0) == 2:
                bo.set_editor_property('override_two_sided', True); bo.set_editor_property('two_sided', True)
            mi.set_editor_property('base_property_overrides', bo)
        except Exception as e:
            T.setdefault('override_errors', str(e)[:160])
        mel.update_material_instance(mi)
        T['generic'] += 1
        if not tx.get('map') and not P.get('map') and min(col) > 0.9 and not r.get('vertexColors') and r.get('type') != 'MeshBasicMaterial' \
                and not (ud.get('fkShared') or tname.startswith('fk:')):
            T['unbound_white'][tname or '(unnamed)'] = T['unbound_white'].get(tname or '(unnamed)', 0) + 1
    t = time.time()
    for d_ in C['world_dest'].split(','): eal.save_directory(d_, only_if_is_dirty=True, recursive=True)
    T['save_s'] = round(time.time() - t, 1)
    T['secs'] = round(time.time() - t0, 1)
    T['unbound_white'] = dict(sorted(T['unbound_white'].items(), key=lambda kv: -kv[1])[:30])
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] CELLMAT2_DONE ' + json.dumps({k: v for k, v in T.items() if k != 'unbound_white'}))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-dest', required=True); ap.add_argument('--cells', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--hide', default=''); ap.add_argument('--hide-generated-alpha', action='store_true')
    ap.add_argument('--lib-from', default='', help='comma-separated /Game/Takes/<t>=<prep json>: the family library\'s sources when it is missing')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    rp = os.path.join(out, 'records.json'); json.dump(cell_records(a.cells), open(rp, 'w'))
    C = {'world_dest': a.world_dest, 'records': rp, 'result': os.path.join(out, 'cellmat2.json'), 'hide': [x for x in a.hide.split(',') if x],
         'hide_generated_alpha': a.hide_generated_alpha, 'lib_from': [{'dest': t.split('=')[0], 'side': t.split('=')[1]} for t in a.lib_from.split(',') if '=' in t]}
    cp = os.path.join(out, 'cellmat2_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_CELLMAT2_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'cellmat2.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    try: r = json.load(open(C['result']))
    except Exception: r = None
    print(json.dumps({'process_s': round(time.time() - t0, 1), 'exit': code, 'result': r})[:2500])
    sys.exit(0 if (code == 0 and r) else 1)


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
