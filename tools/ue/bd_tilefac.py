#!/usr/bin/env python3
# BD40 (backdrop lane, 2026-10-11): the tiles' facade master in Unreal, /Game/R2BD/Cell/M_bd_tilefac_v<VERSION>, and its
# binding in one world. The tiles' facades (the records with userData.isFacade: the tile buildings' walls and roofs and the
# towers lane's kit walls tk:fac:<set>, both drawn by client/src/world/materials.js makeFacadeMaterial) had gone to the
# generic cell master as their vertex colour: every tower in a world's cells drew as a flat block. The master runs the
# page's own facade code (tools/ue/bd_tilefac.hlsl, ported by tools/ue/bd_tilefac_port.py) on the facade's attributes, which
# tools/ue/r1c_glbuv.py packs into UV 1-7 (aux, aux2, aux3, the vertex colour; those meshes stay out of Nanite, whose four UV
# sets would not hold them: tools/ue/r1c_cells.py). The kit's glass sets (tk:fac:glass_*) keep their own export record.
# A master is built once under its versioned name and never rebuilt in place; a new version is a new name.
#   python3 tools/ue/bd_tilefac.py --world-dest /Game/W/<key> --records <world>/mat/records.json --out <dir>
import json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
CELLCACHE = os.environ.get('CELLCACHE', '/data0/projectnyc_aux/cellcache')   # FAC42: the world's own cache (a private one too)
VERSION = int(os.environ.get('BD_TILEFAC_V', '108'))   # FAC42: a diagnostic or new master is a new version, never an in-place rebuild (FP18 107: the glass layer)
HLSL = os.environ.get('BD_TILEFAC_HLSL', 'bd_tilefac.hlsl')
# RG44: the kit's glass sets too (BD_TILEFAC_GLASS=1): in the page they are the facade shader's windows (rooms, blinds, lit
# rooms); their own export record, a smooth dark pane, mirrored the sky as bright as the wall round it at a grazing view
GLASS_ON = os.environ.get('BD_TILEFAC_GLASS', '1') == '1'   # (the default since GB43)
MASTER = f'/Game/R2BD/Cell/M_bd_tilefac_v{VERSION}'
TEXLIB = '/Game/Tex'
MPC = '/Game/Bx/MPC_r1c'
GLASS_SETS = re.compile(r'^tk:fac:glass')
# the facade's textures: the record's uniform -> the master's parameter, sRGB or linear
TEXP = (('t_wA', 'TwA', True), ('t_wB', 'TwB', True), ('t_wC', 'TwC', True), ('t_wS', 'TwS', True), ('t_wP', 'TwP', True),
        ('t_sgn', 'Tsgn', True), ('t_brN', 'TbrN', False), ('t_brR', 'TbrR', False))
INPUTS = ([(f'UV{i}', f'uv{i}') for i in range(8)] +
          [('WPA', 'wp'), ('CAM', 'campos'), ('NWS', 'nw'), ('NightV', 'mpc', 'Night'), ('WetV', 's', 0.0), ('SnowV', 's', 0.0), ('TimeF', 'time'),
           ('SunD', 'v', (0.586, 0.669, 0.458, 0)), ('SunC', 'v', (1.0, 0.867, 0.780, 0)), ('LbRoof', 's', 0.78), ('Lb14Roof', 's', 1.0),
           ('Tq32C', 'v', (-1215, 2820, 340, 520)), ('Tq32On', 's', 0.0), ('Tint', 'v', (1, 1, 1, 0)), ('EmisK', 's', 1.0)] +
          [(p, 'ts' if s else 'tl') for _, p, s in TEXP])
OUTPUTS = [('Emis', 3), ('Rough', 1), ('Metal', 1), ('Spec', 1), ('NrmW', 3)]


def in_engine():
    import unreal
    C = json.load(open(os.environ['BD_TILEFAC_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    atools = unreal.AssetToolsHelpers.get_asset_tools()
    T = {'bound': 0, 'skipped_glass': 0, 'textures_new': 0}
    t0 = time.time()
    code = open(os.path.join(HERE, HLSL)).read()
    # ---- the master (once per version)
    if not eal.does_asset_exist(MASTER):
        dflt = {}
        for nm in ('white', 'flat'):
            ap = f'/Game/Bx/Tex/T_default_{nm}'
            if not eal.does_asset_exist(ap):
                import ue_masters
                ue_masters.defaults()
            dflt[nm] = eal.load_asset(ap)
        m = atools.create_asset(MASTER.split('/')[-1], '/'.join(MASTER.split('/')[:-1]), unreal.Material, unreal.MaterialFactoryNew())
        m.set_editor_property('tangent_space_normal', False)
        cu = mel.create_material_expression(m, unreal.MaterialExpressionCustom, -500, 0)
        cu.set_editor_property('code', code)
        cu.set_editor_property('description', f'bd_tilefac_v{VERSION}')
        cu.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT3)
        ins = []
        for it in INPUTS:
            ci = unreal.CustomInput(); ci.set_editor_property('input_name', it[0]); ins.append(ci)
        cu.set_editor_property('inputs', ins)
        ao = []
        for on, dim in OUTPUTS:
            co = unreal.CustomOutput(); co.set_editor_property('output_name', on)
            co.set_editor_property('output_type', unreal.CustomMaterialOutputType.CMOT_FLOAT1 if dim == 1 else unreal.CustomMaterialOutputType.CMOT_FLOAT3)
            ao.append(co)
        cu.set_editor_property('additional_outputs', ao)
        mpc = eal.load_asset(MPC) if eal.does_asset_exist(MPC) else None
        y = -1600
        for it in INPUTS:
            nm, kind = it[0], it[1]
            E = lambda cls: mel.create_material_expression(m, cls, -900, y)
            if kind == 's':
                e = E(unreal.MaterialExpressionScalarParameter); e.set_editor_property('parameter_name', nm); e.set_editor_property('default_value', float(it[2]))
            elif kind == 'v':
                e = E(unreal.MaterialExpressionVectorParameter); e.set_editor_property('parameter_name', nm)
                e.set_editor_property('default_value', unreal.LinearColor(*[float(v) for v in it[2]]))
            elif kind in ('ts', 'tl'):
                e = E(unreal.MaterialExpressionTextureObjectParameter); e.set_editor_property('parameter_name', nm)
                e.set_editor_property('texture', dflt['white'])
                e.set_editor_property('sampler_type', unreal.MaterialSamplerType.SAMPLERTYPE_COLOR if kind == 'ts' else unreal.MaterialSamplerType.SAMPLERTYPE_LINEAR_COLOR)
            elif kind == 'wp':
                e = E(unreal.MaterialExpressionWorldPosition)
            elif kind == 'campos':
                e = E(unreal.MaterialExpressionCameraPositionWS)
            elif kind == 'nw':
                e = E(unreal.MaterialExpressionVertexNormalWS)
            elif kind == 'time':
                e = E(unreal.MaterialExpressionTime)
            elif kind == 'mpc':
                if mpc is not None:
                    e = E(unreal.MaterialExpressionCollectionParameter); e.set_editor_property('collection', mpc); e.set_editor_property('parameter_name', it[2])
                else:
                    e = E(unreal.MaterialExpressionScalarParameter); e.set_editor_property('parameter_name', nm); e.set_editor_property('default_value', 0.0)
            elif kind.startswith('uv'):
                e = E(unreal.MaterialExpressionTextureCoordinate); e.set_editor_property('coordinate_index', int(kind[2]))
            if not (kind == 'v' and mel.connect_material_expressions(e, 'RGBA', cu, nm)):
                mel.connect_material_expressions(e, '', cu, nm)
            y += 80
        MP = unreal.MaterialProperty
        mel.connect_material_property(cu, '', MP.MP_BASE_COLOR)
        mel.connect_material_property(cu, 'Emis', MP.MP_EMISSIVE_COLOR)
        mel.connect_material_property(cu, 'Rough', MP.MP_ROUGHNESS)
        mel.connect_material_property(cu, 'Metal', MP.MP_METALLIC)
        mel.connect_material_property(cu, 'Spec', MP.MP_SPECULAR)
        mel.connect_material_property(cu, 'NrmW', MP.MP_NORMAL)
        for u in ('MATUSAGE_STATIC_MESH', 'MATUSAGE_NANITE', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
            try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
            except Exception: pass
        mel.recompile_material(m); eal.save_loaded_asset(m)
        T['master_built'] = MASTER
    master = eal.load_asset(MASTER)
    # ---- the records: the facades', matched to the world's instances as r1c_cellmat2.py matches them
    recs = json.load(open(C['records']))
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
    # ---- the facade's textures, by content hash into the shared library (the names r1c_cellmat2.py gives)
    tdone = {}
    # FAC42: the city-wide atlases the page loads once (materials.js GTEX_DEFS) travel in no cell package; their source
    # files are the client's own textures
    GTEX_SRC = {'t_wA': 'wall_redbrick', 't_wB': 'wall_brownbrick', 't_wC': 'wall_whitebrick', 't_wS': 'wall_stone',
                't_wP': 'wall_plaster', 't_brN': 'brick_nrm', 't_brR': 'brick_rgh'}
    CLIENT_TEX = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'public', 'textures'))
    def tex(rec_u, srgb, uname=None):
        f = (rec_u or {}).get('file') if isinstance(rec_u, dict) else None
        cands = ([os.path.join(CELLCACHE, f), os.path.join('/data0/projectnyc_aux/cellcache', f)] if f else []) + \
                ([os.path.join(CLIENT_TEX, GTEX_SRC[uname] + '.jpg')] if uname in GTEX_SRC else [])
        p = next((c for c in cands if os.path.exists(c)), None)
        if p is None: T['textures_missing'] = T.get('textures_missing', 0) + 1; return None
        nm = 'T_' + os.path.splitext(os.path.basename(p))[0] + ('' if srgb else '_lin')
        ap = f'{TEXLIB}/{nm}'
        if ap in tdone: return tdone[ap]
        if not eal.does_asset_exist(ap):
            task = unreal.AssetImportTask()
            for kk, vv in (('filename', p), ('destination_path', TEXLIB), ('destination_name', nm), ('automated', True), ('replace_existing', False), ('save', False)):
                task.set_editor_property(kk, vv)
            atools.import_asset_tasks([task])
            t_ = eal.load_asset(ap)
            if t_ is not None:
                try:
                    t_.set_editor_property('srgb', bool(srgb))
                    if not srgb: t_.set_editor_property('compression_settings', unreal.TextureCompressionSettings.TC_MASKS)
                except Exception: pass
                eal.save_loaded_asset(t_); T['textures_new'] += 1
        tdone[ap] = eal.load_asset(ap)
        return tdone[ap]
    for ap in [x for d_ in C['world_dest'].split(',') for x in eal.list_assets(d_, recursive=True, include_folder=False)]:   # (GB43: a list of folders, the cell cache's new cells)
        if eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
        nm = ap.split('/')[-1].split('.')[0]
        if nm.startswith('lod16'): continue
        r = recs.get(find(nm) or '') or {}
        if not (r.get('userData') or {}).get('isFacade'): continue
        if GLASS_SETS.match(r.get('name') or '') and not GLASS_ON: T['skipped_glass'] += 1; continue
        mi = eal.load_asset(ap)
        mel.set_material_instance_parent(mi, master)
        mel.clear_all_material_instance_parameters(mi)
        sv = lambda n, v: mel.set_material_instance_scalar_parameter_value(mi, n, float(v))
        vv = lambda n, c: mel.set_material_instance_vector_parameter_value(mi, n, unreal.LinearColor(*[float(x) for x in (list(c) + [0, 0, 0, 0])[:4]]))
        ou = r.get('obcUni') or {}
        vv('Tint', list(r.get('color') or [1, 1, 1])[:3])
        sd = (ou.get('sunDirW') or {}).get('vec') if isinstance(ou.get('sunDirW'), dict) else None
        sc = (ou.get('sunColW') or {}).get('color') if isinstance(ou.get('sunColW'), dict) else None
        if sd: vv('SunD', sd)
        if sc: vv('SunC', sc)
        for k_, p_ in (('lbRoof', 'LbRoof'), ('lb14Roof', 'Lb14Roof'), ('tq32On', 'Tq32On')):
            if isinstance(ou.get(k_), (int, float)): sv(p_, ou[k_])
        tq = (ou.get('tq32C') or {}).get('vec') if isinstance(ou.get('tq32C'), dict) else None
        if tq: vv('Tq32C', tq)
        for u_, p_, s_ in TEXP:
            t_ = tex(ou.get(u_), s_, u_)
            if t_ is not None: mel.set_material_instance_texture_parameter_value(mi, p_, t_)
            else: T.setdefault('texture_missing', {}); T['texture_missing'][u_] = T['texture_missing'].get(u_, 0) + 1
        mel.update_material_instance(mi)
        T['bound'] += 1
        T.setdefault('names', {}); kn = (r.get('name') or 'tile') ; T['names'][kn] = T['names'].get(kn, 0) + 1
    for d_ in C['world_dest'].split(','): eal.save_directory(d_, only_if_is_dirty=True, recursive=True)
    T['secs'] = round(time.time() - t0, 1)
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[bd] TILEFAC_DONE ' + json.dumps(T)[:2000])


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-dest', required=True); ap.add_argument('--records', required=True); ap.add_argument('--out', required=True)
    a = ap.parse_args()
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    C = {'world_dest': a.world_dest, 'records': os.path.abspath(a.records), 'result': os.path.join(out, 'tilefac.json')}
    cp = os.path.join(out, 'tilefac_cfg.json'); json.dump(C, open(cp, 'w'), indent=1)
    if os.path.exists(C['result']): os.replace(C['result'], C['result'] + '.prev')
    env = dict(os.environ, BD_TILEFAC_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'tilefac.log'), 'w') as lf:
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
