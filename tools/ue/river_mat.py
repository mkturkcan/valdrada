#!/usr/bin/env python3
# WATER3F (2026-10-25): the far level's river water on the fetch map. M_bx_water3's sea is the open harbour's (8 km of
# fetch, the long trains lifted x 1.6); on a channel 100-200 m wide (the Harlem River, Spuyten Duyvil, the Bronx Kill, the
# creeks) its crests stood across the channel as dark parallel stripes at a grazing view under a wooded bank. This builds
# M_bx_water3f (ue_masters.py: M_bx_water3 plus the fetch map of tools/ue/water_fetch.py) and MI_r2b_river_f<FV>, a new
# instance with MI_r2b_river_v4's values plus the map, and re-parents the far packages' water instances (lod16Water*, bound
# to v4 by r1c_lodmat.py) to it. Where the map is 1 (the Hudson, the East River, the harbour, the bays) the code takes v4's
# values themselves, so open water is v4's to the bit; v4 and the shared masters are untouched. Not a material tool of
# render_take's signature: a change here re-binds nothing else.
#   python3 tools/ue/river_mat.py [--dest /Game/CF] --out <dir>
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r1c_lodmat as LM  # noqa: E402

FV = 2   # (2: the map's ramp 140-200 m, the Harlem River (raster width ~128 m) fully narrow; 1 ramped 90-210 m and left it at t 0.3-0.5)
FETCH = os.path.join(os.environ.get('CELLCACHE', '/data0/projectnyc_aux/cellcache'), 'tex', f'water_fetch_v{FV}')
SRC_MI, DST_MI = '/Game/R1C/Far/MI_r2b_river_v4', f'/Game/R1C/Far/MI_r2b_river_f{FV}'
MASTER, TEX = '/Game/Bx/M_bx_water3f', f'/Game/R1C/Far/T_r2b_fetch_v{FV}'
FETCH_N = (800.0, 0.0, 0.0, 0.0)   # (a narrow channel's fetch, m)


def in_engine():
    import unreal
    C = json.load(open(os.environ['RIVER_MAT_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    py = os.path.join(LM.EXPORT, 'ue_project', 'Python')
    if py not in sys.path: sys.path.insert(0, py)
    import ue_masters
    T = {'mi': DST_MI}
    if not eal.does_asset_exist(MASTER):
        ue_masters.build('water3f', ue_masters.MASTERS['water3f'], ue_masters.defaults())
        m = eal.load_asset(MASTER)
        for u in ('MATUSAGE_NANITE', 'MATUSAGE_STATIC_MESH', 'MATUSAGE_INSTANCED_STATIC_MESHES'):
            try: mel.set_material_usage(m, getattr(unreal.MaterialUsage, u))
            except Exception: pass
        mel.recompile_material(m); eal.save_loaded_asset(m); T['master_built'] = MASTER
    if not eal.does_asset_exist(DST_MI):
        tx = eal.load_asset(TEX) if eal.does_asset_exist(TEX) else ue_masters.import_texture(FETCH + '.png', TEX.rsplit('/', 1)[0], TEX.rsplit('/', 1)[1], False)
        eal.save_loaded_asset(tx)
        src = eal.load_asset(SRC_MI)
        mi = unreal.AssetToolsHelpers.get_asset_tools().create_asset(DST_MI.rsplit('/', 1)[1], DST_MI.rsplit('/', 1)[0], unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
        mel.set_material_instance_parent(mi, eal.load_asset(MASTER))
        for nm in ('Wind', 'Rng', 'Abs', 'Sct'):
            mel.set_material_instance_vector_parameter_value(mi, nm, mel.get_material_instance_vector_parameter_value(src, nm))
        for nm in ('Pg', 'BehK'):
            mel.set_material_instance_scalar_parameter_value(mi, nm, mel.get_material_instance_scalar_parameter_value(src, nm))
        mel.set_material_instance_vector_parameter_value(mi, 'FetchR', unreal.LinearColor(*json.load(open(FETCH + '.json'))['rect']))
        mel.set_material_instance_vector_parameter_value(mi, 'FetchN', unreal.LinearColor(*FETCH_N))
        mel.set_material_instance_texture_parameter_value(mi, 'FetchT', tx)
        mel.update_material_instance(mi); eal.save_loaded_asset(mi); T['mi_built'] = True
    R = eal.load_asset(DST_MI)
    ar = unreal.AssetRegistryHelpers.get_asset_registry()
    flt = unreal.ARFilter(package_paths=C['dest'].split(','), recursive_paths=True,
                          class_paths=[unreal.TopLevelAssetPath('/Script/Engine', 'MaterialInstanceConstant')])
    n = 0; dirty = set()
    for ad in ar.get_assets(flt):
        if not str(ad.asset_name).startswith('lod16Water'): continue
        mi = ad.get_asset()
        par = mi.get_editor_property('parent')
        if par is None or not (par.get_path_name().split('.')[0] == SRC_MI or par.get_path_name().split('.')[0].startswith('/Game/R1C/Far/MI_r2b_river_f')): continue   # (v4, or an earlier f)
        mel.set_material_instance_parent(mi, R); mel.update_material_instance(mi)
        eal.save_loaded_asset(mi); n += 1
    T['reparented'] = n
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[river] DONE ' + json.dumps(T))


def run(dest, out):
    out = os.path.abspath(out); os.makedirs(out, exist_ok=True)
    C = {'dest': dest, 'result': os.path.join(out, 'rivermat.json')}
    cp = os.path.join(out, 'rivermat_cfg.json'); json.dump(C, open(cp, 'w'))
    env = dict(os.environ, RIVER_MAT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    t0 = time.time()
    with open(os.path.join(out, 'rivermat.log'), 'w') as lf:
        code = subprocess.call([os.path.join(LM.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), LM.PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    try: r = json.load(open(C['result']))
    except Exception: r = None
    return {'process_s': round(time.time() - t0, 1), 'exit': code, 'result': r}


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    if IN_ENGINE: in_engine()
    else:
        import argparse
        ap = argparse.ArgumentParser(); ap.add_argument('--dest', default='/Game/CF'); ap.add_argument('--out', required=True)
        a = ap.parse_args(); r = run(a.dest, a.out); print(json.dumps(r)); sys.exit(0 if r['exit'] == 0 and r['result'] else 1)
