#!/usr/bin/env python3
# STORE12 (2026-10-24): every facade MI of the material library onto one facade master, its folders and records derived
# from the library itself, not from a fixed folder list. fp18/bindfac.sh bound the 25 folders of a 10-17 records
# snapshot, so the facades of every MatLib batch made after it (16 folders, 201 MIs: the terrain city's new tiles) kept
# master v108 through the v119 window fix and drew their shop bands as static (lf1Portal, Broadway at 121st St).
# The records: the last full rebind's facade records, completed from the cell cache's block packages (their glTF JSON
# only); cached in matlib/fac_records.json. After a clean bind every facade key's index entry carries the bound master.
#   BD_TILEFAC_V=<n> [BD_TILEFAC_HLSL=bd_tilefac.hlsl] python3 tools/ue/bindfac_all.py --out <dir>
import argparse, fcntl, glob, json, os, re, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import matlib as ML
import render_take as R

san = lambda s: re.sub(r'[^A-Za-z0-9]', '_', s or '')


def facade_records(ix):
    cache = os.path.join(ML.DIR, 'fac_records.json')
    rec = {}
    try: rec = json.load(open(cache))
    except Exception: pass
    if not rec:
        snaps = sorted(glob.glob(os.path.join(ML.DIR, 'bind_all_*', 'records.json')), key=os.path.getmtime)
        if snaps:
            rec = {k: r for k, r in json.load(open(snaps[-1])).items() if (r.get('userData') or {}).get('isFacade')}
    want = {k for k in ix if k not in rec}
    if want:
        for g in glob.glob(os.path.join(R.CC, 'blk', '*.glb')):
            try:
                with open(g, 'rb') as fh:
                    h = fh.read(20); L = struct.unpack('<I', h[12:16])[0]; J = json.loads(fh.read(L))
            except Exception:
                continue
            for m in J.get('materials', []):
                k = san(m.get('name'))
                if k in want:
                    r = (m.get('extras') or {}).get('three') or {}
                    if (r.get('userData') or {}).get('isFacade'): rec[k] = r
                    want.discard(k)
        tmp = cache + f'.{os.getpid()}'; json.dump(rec, open(tmp, 'w')); os.replace(tmp, cache)
    return {k: r for k, r in rec.items() if k in ix}


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    import asset_guard; asset_guard.require('bindfac_all', ['/Game/MatLib'])   # (a whole-library rebind: `city bind bindfac_all` only)
    V = os.environ.get('BD_TILEFAC_V'); H = os.environ.get('BD_TILEFAC_HLSL', 'bd_tilefac.hlsl')
    if not V: sys.exit('BD_TILEFAC_V must name the master version')
    os.makedirs(a.out, exist_ok=True)
    lock = open(os.path.join(ML.DIR, '.lock'), 'a+'); fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        ix = ML.load_index()
        rec = facade_records(ix)
        folders = sorted({ix[k]['path'].rsplit('/', 1)[0] for k in rec})
        rp = os.path.join(a.out, 'records.json'); json.dump(rec, open(rp, 'w'))
        code = subprocess.call(['python3', os.path.join(HERE, 'bd_tilefac.py'), '--world-dest', ','.join(folders), '--records', rp, '--out', a.out],
                               stdout=open(os.path.join(a.out, 'bind.log'), 'w'), stderr=subprocess.STDOUT)
        res = {}
        try: res = json.load(open(os.path.join(a.out, 'tilefac.json')))
        except Exception: pass
        if code == 0:
            stamp = f"{V}|glass{os.environ.get('BD_TILEFAC_GLASS', '1')}|{H}|{R.fsha(os.path.join(HERE, H))}"
            ix = ML.load_index()
            for k in rec:
                if k in ix:
                    m = dict(ix[k].get('mat') or {}); m['bd_tilefac_master'] = stamp; ix[k]['mat'] = m
            ML.save_index(ix)
        print(json.dumps({'exit': code, 'version': V, 'folders': len(folders), 'facade_keys': len(rec),
                          'bound': (res.get('result') or res).get('bound') if isinstance(res, dict) else None}))
        sys.exit(code)
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close()


if __name__ == '__main__':
    main()
