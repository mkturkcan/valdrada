#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): materials for lane B's far city in Unreal (docs/specs/cell-package.md section 12): the shells'
# master M_r1c_shell (the wall albedo from the vertex colour, times the FW14 window grid on TEXCOORD_0; at night a window,
# 70 x 65 % of each 3 m x 3.8 m bay, lit where a per-bay hash is under the vertex's lit chance x 0.28, colour (1, 0.82,
# 0.5) x 1.1 x WinK; the chance from TEXCOORD_1.x, packed by r1c_lodprep.py) and the far ground's M_r1c_farground; the
# imported far-city instances re-parented to them.
#   python3 tools/ue/r1c_lodmat.py --dest /Game/R1C/Far_cplake --fw14 <png> --night 0|1 [--wink 3] --out <dir>
# BD40 (backdrop lane, 2026-10-11): its own far masters under private, versioned names (/Game/R2BD/Far/M_bd_shell_v<n>,
# M_bd_ground_v<n>), bound only to the worlds this file binds (--bd 0 keeps a world on the shared masters), never the shared
# /Game/R1C/Far assets (they stay VERSION 1): M_bd_shell is the far city's look in three.js (client/src/lod/shellMaterial.js
# on world/materials.js makeFarMaterial): the window grid drawn from TEXCOORD_0 (along each facade from the world origin and
# up the wall, 4 bays by 4 floors a unit, each building's own floor height and bay width when its chunk gives them),
# box-filtered so a far facade averages to its wall and glass; dark glass at a low roughness, the far shader's glass test;
# the albedo is the near facades' own (the distance haze is the atmosphere's: render_take_cine_bd.json matches it to the
# page's); at night three.js's own stipple (hash12 on the same
# window cells, 2^k bays at a time where a bay is under 2 px). M_bd_ground is the backdrop's ground: the chunk's own
# texture, the skirts' shade, rock on steep slopes, its night map's street lights after dark.
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
MPC = '/Game/Bx/MPC_r1c'   # (the take's night, keyed in its sequence by r1c_actors.py)
VERSION = 2   # (2, GB43: Night from MPC_r1c, keyed per take, not set at bind time: one world for day and night)

SHELL = r'''
float3 t = Texture2DSample(Tex, TexSampler, UV0).rgb;
float2 b = UV0 * 4.0;
float2 c = floor(b), fr = frac(b);
float inWin = step(0.15, fr.x) * step(fr.x, 0.85) * step(0.175, fr.y) * step(fr.y, 0.825);
float h = frac(sin(dot(c, float2(12.9898, 78.233))) * 43758.5453);
float lit = step(h, UV1.x * 0.28) * inWin * Night;
Emis = float3(1.0, 0.82, 0.5) * 1.1 * WinK * lit;
return VC * t;
'''


# ==== BD40: the private masters' code (Unreal world space: Z up, centimetres)
BDV = 9   # (9, FARFACE: the glass no glossier than the presets' Lumen trace cut) # (8, GB43: Night from MPC_r1c) #   # (7: the vertex's open-sky share, UV1.y from the packages' _ao, into the AO input: indirect light only)
BDSHELL = r'''
float2 b = UV0 * 4.0;
float2 w = max(abs(ddx(b)) + abs(ddy(b)), 1e-4);
// box-filtered window pulse per cell: the share of [lo, hi] over the pixel's footprint (exact at any minification)
float2 lo = float2(0.15, 0.175), hi = float2(0.85, 0.825);
float2 xa = b - 0.5 * w, xb = b + 0.5 * w;
float2 Fa = floor(xa) * (hi - lo) + clamp(frac(xa) - lo, 0.0, hi - lo);
float2 Fb = floor(xb) * (hi - lo) + clamp(frac(xb) - lo, 0.0, hi - lo);
float2 cv = saturate((Fb - Fa) / w);
float vert = 1.0 - smoothstep(0.5, 0.8, abs(N.z));
float cov = cv.x * cv.y * vert;
float3 tint = VC * FarK;
float glassy = saturate((sqrt(max(tint.b, 0.0)) - sqrt(max(tint.r, 0.0)) * 0.9) / 0.10);
float2 lot = floor(WPos.xy / 2600.0);
float3 l3 = frac(float3(lot.xyx) * 0.1031); l3 += dot(l3, l3.yzx + 33.33);
tint *= 0.85 + 0.30 * frac((l3.x + l3.y) * l3.z);
float3 wall = tint * lerp(1.0, lerp(0.55, 0.30, glassy), glassy * 0.9 * vert);
float3 glass = lerp(float3(0.018, 0.022, 0.027), wall * 0.5, 0.2);
float3 col = lerp(wall, glass, cov * 0.95);
col *= lerp(1.0, WallAO, vert);
// (v6: no distance darkening or desaturation: the haze is the atmosphere's, matched to the page's in the preset)
// (v9, FARFACE 2026-10-22: at 0.10 the far glass traced Lumen mirror reflections, and a tower 5 km off mirrored its
// neighbours' shaded backs as sharp dark shapes that moved with the lens and read as walls gone (trBdHarbour, ue11);
// a far facade's glass is a box-filtered average of panes and mullions: rough enough (0.62) to stay under the presets'
// r.Lumen.Reflections.MaxRoughnessToTrace 0.6, its sheen from the radiance cache; tools/qa/far_faces_audit.py checks it)
Rough = lerp(0.85, 0.62, saturate(cov + glassy * 0.6 * vert));
// (v7: the chunk's per-vertex open-sky share on the indirect light; packages without one carry 0 there: open sky)
AOo = UV1.y > 0.001 ? UV1.y : 1.0;
// night: three.js's stipple (hash12 on the window cells, octaves where a bay is under 2 px)
float lodPx = max(length(w), 1e-4);
float L = max(0.0, log2(lodPx * 2.0));
float L0 = floor(L), lfr = L - L0;
float p = UV1.x * 0.28;
float sp = 0.0;
[unroll] for (int k = 0; k < 2; k++) {
  float S = exp2(L0 + k);
  float2 q = b / S, cc = floor(q), ff = frac(q);
  float win = step(0.15, ff.x) * step(ff.x, 0.85) * step(0.2, ff.y) * step(ff.y, 0.85);
  float2 hp = cc + float2(17.0 * (L0 + k), 3.0);
  float3 p3 = frac(float3(hp.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33);
  float hh = frac((p3.x + p3.y) * p3.z);
  sp += step(hh, p) * win * (k == 0 ? 1.0 - lfr : lfr);
}
Emis = float3(1.0, 0.82, 0.5) * 1.1 * WinK * sp * Night * vert;
return col;
'''
BDGROUND = r'''
float3 c = Texture2DSample(Tex, TexSampler, UV0).rgb * VC;
// steep ground (the Palisades' faces, bluffs) is rock: the top-down texture would only smear down the slope
float steep = 1.0 - smoothstep(0.42, 0.68, N.z);
float2 rq = float2(dot(WPos.xy, float2(0.7071, 0.7071)) * 0.0035, WPos.z * 0.0012);
float2 ri = floor(rq * float2(3.0, 0.4));
float3 r3 = frac(float3(ri.xyx) * 0.1031); r3 += dot(r3, r3.yzx + 33.33);
float joints = frac((r3.x + r3.y) * r3.z);
float3 rock = float3(0.105, 0.098, 0.090) * (0.65 + 0.7 * joints);
c = lerp(c, rock, steep * 0.9);
float nl = Texture2DSample(NightTex, NightTexSampler, UV0).r;
float2 lp = floor(WPos.xy / 90000.0);
float3 l3 = frac(float3(lp.xyx) * 0.1031); l3 += dot(l3, l3.yzx + 33.33);
float led = frac((l3.x + l3.y) * l3.z);
float3 lampC = lerp(float3(1.0, 0.68, 0.36), float3(1.0, 0.93, 0.82), smoothstep(0.35, 0.75, led));
Emis = lampC * nl * nl * Night * 1.4 * WinK;
return c;
'''
# ==== end BD40

def in_engine():
    import unreal
    C = json.load(open(os.environ['R1C_LODMAT_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    T = {}
    root = '/Game/R1C/Far'
    # the window grid texture
    tex_p = f'{root}/T_fw14'
    if not eal.does_asset_exist(tex_p):
        task = unreal.AssetImportTask()
        for k, v in (('filename', C['fw14']), ('destination_path', root), ('destination_name', 'T_fw14'), ('automated', True), ('replace_existing', True), ('save', True)):
            task.set_editor_property(k, v)
        atools.import_asset_tasks([task])
    tex = eal.load_asset(tex_p)
    # the masters (built once per VERSION)
    vf = os.path.join(unreal.Paths.convert_relative_path_to_full(unreal.Paths.project_content_dir()), 'R1C', 'Far', f'.lodmat_v{VERSION}')
    sh_p, gr_p = (f'{root}/M_r1c_shell', f'{root}/M_r1c_farground') if VERSION < 2 else (f'{root}/M_r1c_shell_v{VERSION}', f'{root}/M_r1c_farground_v{VERSION}')   # (GB43: versioned names, never an in-place rebuild)
    if not os.path.exists(vf) or not eal.does_asset_exist(sh_p):
        for p_ in (sh_p, gr_p):
            if eal.does_asset_exist(p_): eal.delete_asset(p_)
        m = atools.create_asset(sh_p.split('/')[-1], root, unreal.Material, unreal.MaterialFactoryNew())
        cu = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -500, 0)
        cu.set_editor_property('code', SHELL)
        cu.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
        ins = []
        for nm in ('VC', 'UV0', 'UV1', 'Tex', 'Night', 'WinK'):
            ci = unreal.CustomInput(); ci.set_editor_property('input_name', nm); ins.append(ci)
        cu.set_editor_property('inputs', ins)
        co = unreal.CustomOutput(); co.set_editor_property('output_name', 'Emis'); co.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
        cu.set_editor_property('additional_outputs', [co])
        vc = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -900, -300)
        mel.connect_material_expressions(vc, '', cu, 'VC')
        for i, nm in ((0, 'UV0'), (1, 'UV1')):
            uv = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -900, -200 + 100 * i)
            uv.set_editor_property('coordinate_index', i)
            mel.connect_material_expressions(uv, '', cu, nm)
        tx = mel.create_material_expression(m, unreal.MaterialExpressionTextureObjectParameter, -900, 0)
        tx.set_editor_property('parameter_name', 'Tex'); tx.set_editor_property('texture', tex)
        mel.connect_material_expressions(tx, '', cu, 'Tex')
        for y, (nm, dv) in enumerate((('Night', 0.0), ('WinK', 3.0))):
            if nm == 'Night':   # (GB43: the take's night, MPC_r1c.Night keyed in its sequence)
                sc = mel.create_material_expression(m, unreal.MaterialExpressionCollectionParameter, -900, 150 + 80 * y)
                sc.set_editor_property('collection', eal.load_asset(MPC)); sc.set_editor_property('parameter_name', 'Night')
            else:
                sc = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -900, 150 + 80 * y)
                sc.set_editor_property('parameter_name', nm); sc.set_editor_property('default_value', dv)
            mel.connect_material_expressions(sc, '', cu, nm)
        MP = unreal.MaterialProperty
        mel.connect_material_property(cu, '', MP.MP_BASE_COLOR)
        mel.connect_material_property(cu, 'Emis', MP.MP_EMISSIVE_COLOR)
        r = mel.create_material_expression(m, unreal.MaterialExpressionConstant, -300, 300); r.set_editor_property('r', 0.85)
        mel.connect_material_property(r, '', MP.MP_ROUGHNESS)
        for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH'):
            try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
            except Exception: pass
        mel.recompile_material(m); eal.save_loaded_asset(m)
        g = atools.create_asset(gr_p.split('/')[-1], root, unreal.Material, unreal.MaterialFactoryNew())
        col = mel.create_material_expression(g, unreal.MaterialExpressionVectorParameter, -400, 0)
        col.set_editor_property('parameter_name', 'Color'); col.set_editor_property('default_value', unreal.LinearColor(0.16, 0.17, 0.14, 1))
        mel.connect_material_property(col, '', MP.MP_BASE_COLOR)
        r2 = mel.create_material_expression(g, unreal.MaterialExpressionConstant, -300, 300); r2.set_editor_property('r', 0.95)
        mel.connect_material_property(r2, '', MP.MP_ROUGHNESS)
        try: mel.set_material_usage(g, unreal.MaterialUsage.MATUSAGE_NANITE)
        except Exception: pass
        mel.recompile_material(g); eal.save_loaded_asset(g)
        os.makedirs(os.path.dirname(vf), exist_ok=True); open(vf, 'w').write('1')
        T['built'] = True
    sh, gr = eal.load_asset(sh_p), eal.load_asset(gr_p)
    # ==== BD40: the backdrop lane's private, versioned masters (never the shared /Game/R1C/Far assets), built once per BDV
    bdsh = bdgr = None
    if True:   # (the backdrop's ground has no shared master: both private masters are built; the shells bind theirs only with --bd 1)
        broot = '/Game/R2BD/Far'
        bsh_p, bgr_p = f'{broot}/M_bd_shell_v{BDV}', f'{broot}/M_bd_ground_v{BDV}'
        MP = unreal.MaterialProperty

        def custom(m, code, ins_, outs_):
            cu = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -500, 0)
            cu.set_editor_property('code', code)
            cu.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
            ins = []
            for nm in ins_:
                ci = unreal.CustomInput(); ci.set_editor_property('input_name', nm); ins.append(ci)
            cu.set_editor_property('inputs', ins)
            outs = []
            for nm, ty in outs_:
                co = unreal.CustomOutput(); co.set_editor_property('output_name', nm); co.set_editor_property('output_type', ty); outs.append(co)
            cu.set_editor_property('additional_outputs', outs)
            return cu

        def scalar(m, cu, nm, dv, y):
            if nm == 'Night':   # (GB43: the take's night from MPC_r1c, as the cells' masters read it)
                sc = mel.create_material_expression(m, unreal.MaterialExpressionCollectionParameter, -900, y)
                sc.set_editor_property('collection', eal.load_asset(MPC)); sc.set_editor_property('parameter_name', 'Night')
            else:
                sc = mel.create_material_expression(m, unreal.MaterialExpressionScalarParameter, -900, y)
                sc.set_editor_property('parameter_name', nm); sc.set_editor_property('default_value', dv)
            mel.connect_material_expressions(sc, '', cu, nm)

        def common(m, cu, uvs, normal=True, cam=False):
            vc = mel.create_material_expression(m, unreal.MaterialExpressionVertexColor, -900, -300)
            mel.connect_material_expressions(vc, '', cu, 'VC')
            for i in uvs:
                uv = mel.create_material_expression(m, unreal.MaterialExpressionTextureCoordinate, -900, -200 + 100 * i)
                uv.set_editor_property('coordinate_index', i)
                mel.connect_material_expressions(uv, '', cu, f'UV{i}')
            wp = mel.create_material_expression(m, unreal.MaterialExpressionWorldPosition, -900, 400)
            mel.connect_material_expressions(wp, '', cu, 'WPos')
            if normal:
                nn = mel.create_material_expression(m, unreal.MaterialExpressionVertexNormalWS, -900, 500)
                mel.connect_material_expressions(nn, '', cu, 'N')
            if cam:
                cp = mel.create_material_expression(m, unreal.MaterialExpressionCameraPositionWS, -900, 600)
                mel.connect_material_expressions(cp, '', cu, 'Cam')

        def usage(m):
            for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH'):
                try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
                except Exception: pass

        if not eal.does_asset_exist(bsh_p):
            m = atools.create_asset(bsh_p.split('/')[-1], broot, unreal.Material, unreal.MaterialFactoryNew())
            cu = custom(m, BDSHELL, ('VC', 'UV0', 'UV1', 'WPos', 'N', 'Cam', 'Night', 'WinK', 'WallAO', 'FarK'),
                        (('Emis', unreal.CustomMaterialOutputType.CMOT_FLOAT3), ('Rough', unreal.CustomMaterialOutputType.CMOT_FLOAT1),
                         ('AOo', unreal.CustomMaterialOutputType.CMOT_FLOAT1)))
            common(m, cu, (0, 1), normal=True, cam=True)
            for y, (nm, dv) in enumerate((('Night', 0.0), ('WinK', 3.0), ('WallAO', 1.0), ('FarK', 1.0))):
                scalar(m, cu, nm, dv, 150 + 80 * y)
            mel.connect_material_property(cu, '', MP.MP_BASE_COLOR)
            mel.connect_material_property(cu, 'Emis', MP.MP_EMISSIVE_COLOR)
            mel.connect_material_property(cu, 'Rough', MP.MP_ROUGHNESS)
            mel.connect_material_property(cu, 'AOo', MP.MP_AMBIENT_OCCLUSION)
            usage(m); mel.recompile_material(m); eal.save_loaded_asset(m)
            T['bd_shell_built'] = bsh_p
        if not eal.does_asset_exist(bgr_p):
            bg = atools.create_asset(bgr_p.split('/')[-1], broot, unreal.Material, unreal.MaterialFactoryNew())
            cu2 = custom(bg, BDGROUND, ('VC', 'UV0', 'WPos', 'N', 'Tex', 'NightTex', 'Night', 'WinK'), (('Emis', unreal.CustomMaterialOutputType.CMOT_FLOAT3),))
            common(bg, cu2, (0,), normal=True)
            for y, nm in enumerate(('Tex', 'NightTex')):
                tx = mel.create_material_expression(bg, unreal.MaterialExpressionTextureObjectParameter, -900, 700 + 120 * y)
                tx.set_editor_property('parameter_name', nm); tx.set_editor_property('texture', tex)
                mel.connect_material_expressions(tx, '', cu2, nm)
            for y, (nm, dv) in enumerate((('Night', 0.0), ('WinK', 3.0))):
                scalar(bg, cu2, nm, dv, 150 + 80 * y)
            mel.connect_material_property(cu2, '', MP.MP_BASE_COLOR)
            mel.connect_material_property(cu2, 'Emis', MP.MP_EMISSIVE_COLOR)
            r3 = mel.create_material_expression(bg, unreal.MaterialExpressionConstant, -300, 300); r3.set_editor_property('r', 0.92)
            mel.connect_material_property(r3, '', MP.MP_ROUGHNESS)
            usage(bg); mel.recompile_material(bg); eal.save_loaded_asset(bg)
            T['bd_ground_built'] = bgr_p
        bdsh, bdgr = eal.load_asset(bsh_p), eal.load_asset(bgr_p)
        if not int(C.get('bd', 0)): bdsh = None   # (the shells on the shared master unless this lane's worlds ask: v6/v7 await review)
    # ==== end BD40
    # ==== R2B (2026-10-11): the far level's water (lod16Water: one quad per L6 chunk) takes the rivers' and the harbour's own
    # instance of the Lake's water master (M_bx_water through the family library's MI_cp32l_water_lake, whose other values
    # it keeps): the body blue-grey like the East River's from the air and three.js's tidal water (the Lake keeps its
    # olive-brown), the ripple trains a little longer and the wind patches larger for open water. One asset per version.
    # (v1 (0.040, 0.080, 0.092) read as a pale sky-blue sheet with a hard deck shadow on it: water's body barely scatters,
    # so the albedo is low; the trains are longer and the wind patches larger so open water keeps a texture from the air)
    # (GB43, 2026-10-14: v3 on M_bx_water2, whose wind patches are gradient noise: M_bx_water's lattice of value noise read
    # from the air as a checkerboard of 125 m squares on the whole harbour; the Lake instance's other values copied)
    # (WATER3, 2026-10-15, the re-shoot: v4 on M_bx_water3, a JONSWAP wind sea on single layer water shading (ue_masters.py
    # WATER3): the harbour's and the rivers' wind 6 m/s over an 8 km fetch, the waves travelling north-east (the prevailing
    # south-westerly), the long trains x 1.6; the colour from an estuary's absorption and scattering per metre (the
    # Hudson's sediment and dissolved organic matter: red and blue absorbed, green kept), never an albedo)
    RIVER = {'v': 4, 'master': '/Game/Bx/M_bx_water3', 'mname': 'water3',
             'vec': {'Wind': (6.0, -45.0, 8000.0, 1.6), 'Rng': (0.03, 0.0004, 0.02, 0.0), 'Abs': (0.45, 0.14, 0.16, 0.0), 'Sct': (0.008, 0.012, 0.009, 0.0)},
             'sc': {'Pg': 0.8, 'BehK': 1.0}}   # (the look pass, 2026-10-15: scattering 0.11-0.13 lit the body olive; a tenth of it keeps it dark under its reflections)
    wl_p, wr_p = '/Game/Lib/Fam_v1/MI_cp32l_water_lake', f"/Game/R1C/Far/MI_r2b_river_v{RIVER['v']}"
    wl = None
    if eal.does_asset_exist(wl_p):
        if not eal.does_asset_exist(wr_p):
            if not eal.does_asset_exist(RIVER['master']):   # (the one master built, as r1c_cellmat2.py builds its own)
                if os.path.join(EXPORT, 'ue_project', 'Python') not in sys.path: sys.path.insert(0, os.path.join(EXPORT, 'ue_project', 'Python'))
                import ue_masters
                ue_masters.build(RIVER.get('mname', 'water2'), ue_masters.MASTERS[RIVER.get('mname', 'water2')], ue_masters.defaults())
                m2 = eal.load_asset(RIVER['master'])
                for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
                    try: mel.set_material_usage(m2, getattr(unreal.MaterialUsage, u))
                    except Exception: pass
                mel.recompile_material(m2); eal.save_loaded_asset(m2); T[f"{RIVER.get('mname', 'water2')}_built"] = RIVER['master']
            lake = eal.load_asset(wl_p)
            wr = atools.create_asset(wr_p.split('/')[-1], '/Game/R1C/Far', unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
            mel.set_material_instance_parent(wr, eal.load_asset(RIVER['master']))
            for nm_, v_ in (RIVER.get('vec') or {}).items(): mel.set_material_instance_vector_parameter_value(wr, nm_, unreal.LinearColor(*v_))
            for nm_, v_ in (RIVER.get('sc') or {}).items(): mel.set_material_instance_scalar_parameter_value(wr, nm_, float(v_))
            if 'Col' in RIVER:   # (v1-v3: M_bx_water's values)
                for nm_ in ('Rgh', 'RMin'): mel.set_material_instance_scalar_parameter_value(wr, nm_, mel.get_material_instance_scalar_parameter_value(lake, nm_))
                mel.set_material_instance_vector_parameter_value(wr, 'Slow', mel.get_material_instance_vector_parameter_value(lake, 'Slow'))
                mel.set_material_instance_vector_parameter_value(wr, 'Col', unreal.LinearColor(*RIVER['Col'], 0.0))
                mel.set_material_instance_scalar_parameter_value(wr, 'Lam', RIVER['Lam'])
                mel.set_material_instance_scalar_parameter_value(wr, 'Amp', RIVER['Amp'])
                mel.set_material_instance_vector_parameter_value(wr, 'Pat', unreal.LinearColor(*RIVER['Pat'], 0.0, 0.0))
            mel.update_material_instance(wr); eal.save_loaded_asset(wr)
            T['river_built'] = wr_p
        wl = eal.load_asset(wr_p)
    # ==== end R2B
    n = {'shell': 0, 'ground': 0, 'water': 0, 'bdground': 0}
    for ap in [x for d_ in C['dest'].split(',') for x in eal.list_assets(d_, recursive=True, include_folder=False)]:   # (GB43: a list of folders, the far cache's new chunks)
        if eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
        nm = ap.split('/')[-1].split('.')[0]
        mi = eal.load_asset(ap)
        if nm.startswith('lod16Shell'):
            mel.set_material_instance_parent(mi, bdsh if bdsh is not None else sh)   # (BD40: the private master in this lane's worlds)
            if bdsh is None: mel.set_material_instance_texture_parameter_value(mi, 'Tex', tex)
            mel.set_material_instance_scalar_parameter_value(mi, 'WinK', float(C['wink']))
            n['shell'] += 1
        elif nm.startswith('lod16BdGround') and bdgr is not None:   # (BD40: the backdrop's ground, its own textures from the import)
            texs = {}
            for tp in (mi.get_editor_property('texture_parameter_values') or []):
                pn = str(tp.get_editor_property('parameter_info').get_editor_property('name'))
                texs[pn] = tp.get_editor_property('parameter_value')
            base = next((t for k, t in texs.items() if 'base' in k.lower() or 'diffuse' in k.lower() or 'albedo' in k.lower()), None)
            emis = next((t for k, t in texs.items() if 'emis' in k.lower()), None)
            mel.set_material_instance_parent(mi, bdgr)
            if base is not None: mel.set_material_instance_texture_parameter_value(mi, 'Tex', base)
            if emis is not None: mel.set_material_instance_texture_parameter_value(mi, 'NightTex', emis)
            mel.set_material_instance_scalar_parameter_value(mi, 'WinK', float(C['wink']))
            n['bdground'] += 1
        elif nm.startswith('lod16Ground'):
            mel.set_material_instance_parent(mi, gr); n['ground'] += 1
        elif nm.startswith('lod16Water') and wl is not None:   # (R2B: the rivers' water, its own parameters, none of the import's)
            mel.clear_all_material_instance_parameters(mi)
            mel.set_material_instance_parent(mi, wl); n['water'] += 1
        else: continue
        mel.update_material_instance(mi)
    for d_ in C['dest'].split(','): eal.save_directory(d_, only_if_is_dirty=True, recursive=True)
    T['assigned'] = n
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[r1c] LODMAT_DONE ' + json.dumps(T))


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--dest', required=True); ap.add_argument('--fw14', required=True); ap.add_argument('--night', default='0')
    ap.add_argument('--wink', default='3'); ap.add_argument('--out', required=True)
    # (GB43, 2026-10-14: 1 by default: the shared shell master is matte, the buildings' tint times the atlas, so a glass
    # tower 7 km off in its pale grey-blue tint read through the haze as the sky behind it, a see-through grid; the
    # backdrop's master draws the windows as dark glossy glass and tints the walls)
    ap.add_argument('--bd', default=os.environ.get('BD_FAR', '1'), help='BD40: 1 (default; env BD_FAR) binds the backdrop lane\'s shell master (/Game/R2BD/Far), glass-aware; 0 the shared matte one; the backdrop ground always takes its own')
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'dest': a.dest, 'fw14': a.fw14, 'night': float(a.night), 'wink': float(a.wink), 'bd': int(a.bd), 'result': os.path.join(out, 'lodmat.json')}
    cp = os.path.join(out, 'lodmat_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    env = dict(os.environ, R1C_LODMAT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    t0 = time.time()
    with open(os.path.join(out, 'lodmat.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    try: r = json.load(open(C['result']))
    except Exception: r = None
    print(json.dumps({'process_s': round(time.time() - t0, 1), 'exit': code, 'result': r}))


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
