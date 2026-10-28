#!/usr/bin/env python3
# WINFAR (2026-10-24): rebind the material library's instances of the PBR sets that r1c_cellmat2.py now aliases (sets with
# neither an HQ set nor a page preview, bound before as a flat colour), without a city build: their records from the cell
# cache's block packages (the glTF JSON only, the ground flag from the nodes), r1c_bind.py --records on their folders,
# the facade master left alone (BD_TILEFAC=0).
#   python3 tools/ue/rebind_pbr.py --out <dir>
import argparse, glob, json, os, re, struct, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import matlib as ML
import render_take as R
import r1c_cellmat2 as CM

san = lambda s: re.sub(r'[^A-Za-z0-9]', '_', s or '')
PB = re.compile(r'^pbr_(.+)_[0-9a-f]{16}$')


def aliased(name):
    if name in CM.PBR_ALIAS: return True
    return any(name.startswith(p) for p, _ in CM.PBR_ALIAS_PREFIX)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--out', required=True); a = ap.parse_args()
    import asset_guard; asset_guard.require('rebind_pbr', ['/Game/MatLib'])   # (a whole-library rebind: `city bind rebind_pbr` only)
    os.makedirs(a.out, exist_ok=True)
    ix = ML.load_index()
    prev = os.path.join(HERE, '..', '..', 'client', 'public', 'textures', 'pbr')
    want = {k for k in ix if PB.match(k)}   # (every PBR set; bound below only the aliased ones and the kit's tinted cladding)
    rec = {}
    for g in glob.glob(os.path.join(R.CC, 'blk', '*.glb')):
        try:
            with open(g, 'rb') as fh:
                h = fh.read(20); L = struct.unpack('<I', h[12:16])[0]; J = json.loads(fh.read(L))
        except Exception:
            continue
        ground = set()
        for n in J.get('nodes', []):
            if (n.get('extras') or {}).get('class') == -1 and 'mesh' in n:
                ground |= {p.get('material') for p in J['meshes'][n['mesh']]['primitives']}
        for mi, m in enumerate(J.get('materials', [])):
            k = san(m.get('name'))
            if k in want:
                r0 = dict((m.get('extras') or {}).get('three') or {})
                pn = PB.match(k).group(1)
                alias_ = aliased(pn) and not os.path.exists(os.path.join(prev, pn, 'preview.jpg'))
                if not (alias_ or pn.startswith('glass_') or 'aFkTr' in (r0.get('obcAttrs') or [])): continue
                r = rec.setdefault(k, r0)
                if mi in ground: r['_kind'] = 'ground'
    folders = sorted({ix[k]['path'].rsplit('/', 1)[0] for k in rec})
    rp = os.path.join(a.out, 'records_in.json'); json.dump(rec, open(rp, 'w'))
    env = dict(os.environ, BD_TILEFAC='0')
    code = subprocess.call(['python3', os.path.join(HERE, 'r1c_bind.py'), '--world-dest', ','.join(folders), '--cells', a.out, '--out', a.out, '--records', rp],
                           env=env, stdout=open(os.path.join(a.out, 'rebind.log'), 'w'), stderr=subprocess.STDOUT)
    res = {}
    try: res = json.load(open(os.path.join(a.out, 'cellmat2.json')))
    except Exception: pass
    print(json.dumps({'exit': code, 'keys': len(want), 'records': len(rec), 'folders': len(folders),
                      'alias_bound': res.get('pbr_alias') if isinstance(res, dict) else None}))
    sys.exit(code)


if __name__ == '__main__':
    main()
