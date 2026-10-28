#!/usr/bin/env python3
# GB43 (lead, 2026-10-12): the cell cache's material binding in one editor session: r1c_cellmat2.py (the cells' records,
# their families) then bd_tilefac.py (the tiles' facades on their master), each tool's own in-engine code with its own
# configuration, one editor start fewer per build than running the two in turn.
#   python3 tools/ue/r1c_bind.py --world-dest <folder>[,<folder>...] --cells <dir of the cells' glbs> --out <dir>
import json, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
EXPORT = os.path.abspath(os.path.join(HERE, '..', '..', 'client', 'tools', 'ar34', 'export'))
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')


def in_engine():
    import r1c_cellmat2, importlib
    r1c_cellmat2.in_engine()
    if os.environ.get('BD_TILEFAC_CFG'):
        import bd_tilefac
        importlib.reload(bd_tilefac)
        bd_tilefac.in_engine()


def main():
    import argparse
    import r1c_cellmat2
    ap = argparse.ArgumentParser()
    ap.add_argument('--world-dest', required=True); ap.add_argument('--cells', required=True); ap.add_argument('--out', required=True); ap.add_argument('--records', default=None)
    a = ap.parse_args()
    import asset_guard; asset_guard.require('r1c_bind', a.world_dest.split(','))   # (shared library: city update's build stage only)
    out = os.path.abspath(a.out); os.makedirs(out, exist_ok=True)
    rp = os.path.join(out, 'records.json'); json.dump(json.load(open(a.records)) if a.records else r1c_cellmat2.cell_records(a.cells), open(rp, 'w'))   # (--records: a prepared set, e.g. tools/ue/rebind_pbr.sh)
    cm = {'world_dest': a.world_dest, 'records': rp, 'result': os.path.join(out, 'cellmat2.json'), 'hide': [], 'hide_generated_alpha': False, 'lib_from': []}
    cmp_ = os.path.join(out, 'cellmat2_cfg.json'); json.dump(cm, open(cmp_, 'w'), indent=1)
    env = dict(os.environ, R1C_CELLMAT2_CFG=cmp_, **{'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None'})
    tf = None
    if os.environ.get('BD_TILEFAC', '1') == '1':
        tf = {'world_dest': a.world_dest, 'records': rp, 'result': os.path.join(out, 'tilefac.json')}
        tfp = os.path.join(out, 'tilefac_cfg.json'); json.dump(tf, open(tfp, 'w'), indent=1); env['BD_TILEFAC_CFG'] = tfp
    env['UE_PYTHONPATH'] = os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])
    t0 = time.time()
    with open(os.path.join(out, 'bind.log'), 'w') as lf:
        code = subprocess.call([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=pythonscript',
                                f'-script={os.path.abspath(__file__)}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=lf, stderr=subprocess.STDOUT, env=env)
    ok = os.path.exists(cm['result']) and (tf is None or os.path.exists(tf['result']))
    print(json.dumps({'process_s': round(time.time() - t0, 1), 'exit': code, 'ok': ok}))
    sys.exit(0 if (code == 0 and ok) else 1)


if __name__ == '__main__':
    try:
        import unreal  # noqa: F401
        IN_ENGINE = True
    except ImportError:
        IN_ENGINE = False
    in_engine() if IN_ENGINE else main()
