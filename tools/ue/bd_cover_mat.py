#!/usr/bin/env python3
# NJCOVER (2026-10-24): the backdrop ground master for the packages bd_cover.py rewrote (their ground material renamed
# lod16BdGroundCv#...): a duplicate of r1c_lodmat's private M_bd_ground_v<BDV>, its steep faces a cool grey diabase in
# vertical columns (2.6 m, jittered, a joint shade between them, horizontal breaks every ~9 m), the columns' contrast faded
# by the pixel footprint so they never alias at distance. The shared master is untouched: r1c_lodmat binds these
# instances to it first (prefix lod16BdGround), this re-parents them to the duplicate (render_take.cf_far's bind_far
# runs it after r1c_lodmat). Not a material tool of render_take's signature: a change here re-binds nothing else.
#   python3 tools/ue/bd_cover_mat.py --dest /Game/CF/<key>,... --out <dir>
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import r1c_lodmat as LM  # noqa: E402

COVV = 2   # (v2 2026-10-26: no horizontal bands)
ROCK_OLD = '''float3 rock = float3(0.105, 0.098, 0.090) * (0.65 + 0.7 * joints);
c = lerp(c, rock, steep * 0.9);'''
ROCK_NEW = '''// (NJCOVER: diabase columns: the face's horizontal direction from its normal, a hashed shade per 2.6 m column)
// (v2, NJCOVER2: no horizontal bands. The shared master's `joints` term floors WPos.z into 21 m rows of random shade, and v1's
// 9 m rows kept it: the Palisades read as strata stripes from across the river. Now one shade per column the full height,
// a smooth low-frequency variation along and up the face, the columns faded by the pixel footprint)
float2 tg = normalize(float2(-N.y, N.x) + float2(1e-4, 0.0));
float ac = dot(WPos.xy, tg) / 260.0 + 0.35 * sin(WPos.z * 0.004);
float cid = floor(ac);
float h1 = frac(sin(cid * 12.9898) * 43758.5453);
float fc = frac(ac);
float jt = smoothstep(0.0, 0.10, fc) * smoothstep(1.0, 0.90, fc);
float fw = saturate(1.0 - 1.5 * fwidth(ac));
float colv = lerp(1.0, (0.78 + 0.34 * h1) * lerp(0.62, 1.0, jt), fw);
float lv = 0.5 + 0.25 * sin(dot(WPos.xy, tg) / 3700.0 + 1.7 * sin(WPos.z / 2300.0)) + 0.25 * sin(dot(WPos.xy, tg) / 1300.0 + 2.9);
float3 rock = float3(0.078, 0.081, 0.086) * colv * (0.86 + 0.28 * lv);
c = lerp(c, rock, steep * 0.92);'''


def in_engine():
    import unreal
    C = json.load(open(os.environ['BD_COVER_MAT_CFG']))
    eal = unreal.EditorAssetLibrary; mel = unreal.MaterialEditingLibrary
    src = f'/Game/R2BD/Far/M_bd_ground_v{LM.BDV}'; dst = f'/Game/R2BD/Far/M_bd_ground_cov_v{COVV}_{LM.BDV}'
    T = {'master': dst}
    if not eal.does_asset_exist(dst):
        assert LM.BDGROUND.count(ROCK_OLD) == 1
        m = eal.duplicate_asset(src, dst)
        cu = mel.get_material_property_input_node(m, unreal.MaterialProperty.MP_BASE_COLOR)
        cu.set_editor_property('code', LM.BDGROUND.replace(ROCK_OLD, ROCK_NEW))
        mel.recompile_material(m); eal.save_loaded_asset(m); T['built'] = True
    M = eal.load_asset(dst); n = 0
    for ap in [x for d_ in C['dest'].split(',') for x in eal.list_assets(d_, recursive=True, include_folder=False)]:
        nm = ap.split('/')[-1].split('.')[0]
        if not nm.startswith('lod16BdGroundCv'): continue
        if eal.find_asset_data(ap).asset_class_path.asset_name != 'MaterialInstanceConstant': continue
        mi = eal.load_asset(ap)
        mel.set_material_instance_parent(mi, M); mel.update_material_instance(mi); n += 1
    for d_ in C['dest'].split(','): eal.save_directory(d_, only_if_is_dirty=True, recursive=True)
    T['reparented'] = n
    json.dump(T, open(C['result'], 'w'), indent=1)
    unreal.log('[bdcov] DONE ' + json.dumps(T))


def run(dest, out):
    out = os.path.abspath(out); os.makedirs(out, exist_ok=True)
    C = {'dest': dest, 'result': os.path.join(out, 'covmat.json')}
    cp = os.path.join(out, 'covmat_cfg.json'); json.dump(C, open(cp, 'w'))
    env = dict(os.environ, BD_COVER_MAT_CFG=cp, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    t0 = time.time()
    with open(os.path.join(out, 'covmat.log'), 'w') as lf:
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
        ap = argparse.ArgumentParser(); ap.add_argument('--dest', required=True); ap.add_argument('--out', required=True)
        a = ap.parse_args(); r = run(a.dest, a.out); print(json.dumps(r)); sys.exit(0 if r['exit'] == 0 and r['result'] else 1)
