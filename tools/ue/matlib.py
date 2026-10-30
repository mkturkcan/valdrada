#!/usr/bin/env python3
# City v2 (docs/notes/ue-city-architecture.md, "The city build, version 2"): the shared material library. A cell's
# material is a record (its glb material's extras.three) under a name that carries its content key (name#hash, sanitised
# by Unreal's import into the mesh's slot name). Each key becomes ONE material instance, /Game/MatLib/b<batch>/<key>,
# created and bound once by the cells' own binding (r1c_bind.py: the families, the generic cell master, the tile facade
# master); a cell's meshes are imported without materials (an Interchange pipeline that imports none) and their slots
# pointed at the library by name (r1c_cells.py, C['matlib']). Before: every cell imported ~32 material instances of its
# own and bound them in an editor of its own, ~1.8 million instances over the city for ~25,000 distinct keys.
#   python3 tools/ue/matlib.py ensure --cells <dir of cell glbs>     (every key of those cells in the library, bound)
# The index, ue_cache/matlib/index.json: {key: {'path': asset path, 'mat': the binding tools' signature}}; a key whose
# signature is not today's is bound again (its batch folder), so a change to a master or a binding rule rebinds the
# library, never the cells.
import argparse, contextlib, fcntl, json, os, re, struct, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
LIB_ROOT = '/Game/MatLib'
DIR = '/data0/projectnyc_aux/ue_cache/matlib'
INDEX = os.path.join(DIR, 'index.json')


def san(s):
    return re.sub(r'[^A-Za-z0-9]', '_', s or '')


def keys_of(glb):
    """the sanitised material names of a cell glb (the slot names its meshes import with)"""
    b = open(glb, 'rb').read(); L = struct.unpack('<I', b[12:16])[0]; J = json.loads(b[20:20 + L])
    return {san(m.get('name')) for m in J.get('materials', []) if m.get('name')}


def load_index():
    try: return json.load(open(INDEX))
    except Exception: return {}


def save_index(ix):
    os.makedirs(DIR, exist_ok=True)
    tmp = INDEX + f'.{os.getpid()}'; json.dump(ix, open(tmp, 'w')); os.replace(tmp, INDEX)


CREATE = r'''
import unreal, json, os
C = json.load(open(os.environ['MATLIB_CFG']))
eal = unreal.EditorAssetLibrary; at = unreal.AssetToolsHelpers.get_asset_tools()
parent = eal.load_asset(C['parent'])
made = 0
for k in C['keys']:
    ap = C['folder'] + '/' + k
    if eal.does_asset_exist(ap): continue
    mi = at.create_asset(k, C['folder'], unreal.MaterialInstanceConstant, unreal.MaterialInstanceConstantFactoryNew())
    if mi is None: continue
    unreal.MaterialEditingLibrary.set_material_instance_parent(mi, parent)
    made += 1
eal.save_directory(C['folder'], only_if_is_dirty=True, recursive=True)
open(C['out'], 'w').write(json.dumps({'made': made}))
'''


def _bound_with(m, msig, facade):
    """a key bound with today's tools: the cell material tools for every key, and for a facade the master it is bound to
    (bindfac_all stamps only that: the facade code's own hashes are in its stamp, and a non-facade key does not depend on
    them; 2026-10-29: comparing the whole signature made every lane's import refuse the library after each facade bind)"""
    a, b = dict(m or {}), dict(msig)
    for d in (a, b):
        d.pop('bd_tilefac.py', None); d.pop('bd_tilefac.hlsl', None)
        if not facade: d.pop('bd_tilefac_master', None)
    return a == b


def ensure(cells_dir, logf=None):
    """every material key of the glbs in cells_dir in the library and bound with today's tools; returns
    {'keys', 'new', 'rebound', 'secs'}"""
    import render_take as R
    t0 = time.time()
    keys = set()
    for f in sorted(os.listdir(cells_dir)):
        if f.endswith('.glb'): keys |= keys_of(os.path.join(cells_dir, f))
    os.makedirs(DIR, exist_ok=True)
    lock = open(os.path.join(DIR, '.lock'), 'a+'); fcntl.flock(lock, fcntl.LOCK_EX)   # (one library writer at a time)
    try:
        ix = load_index(); msig = R.mat_sig()
        new = sorted(k for k in keys if k not in ix)
        try: fac = set(json.load(open(os.path.join(DIR, 'fac_records.json'))))   # (bindfac_all's facade keys)
        except Exception: fac = None   # (unknown: every key compared as a facade)
        stale_folders = sorted({ix[k]['path'].rsplit('/', 1)[0] for k in keys if k in ix and not _bound_with(ix[k].get('mat'), msig, fac is None or k in fac)})
        S = {'keys': len(keys), 'new': len(new), 'rebound_folders': len(stale_folders)}
        folders = list(stale_folders)
        if new:
            batch = time.strftime('b%Y%m%d%H%M%S') + f'_{os.getpid()}'
            folder = f'{LIB_ROOT}/{batch}'
            cfg = os.path.join(DIR, f'{batch}.json'); out = cfg + '.out'
            json.dump({'keys': new, 'folder': folder, 'parent': '/Game/Bx/M_bx_r1ccell_v8', 'out': out}, open(cfg, 'w'))
            py = os.path.join(DIR, 'create.py'); open(py, 'w').write(CREATE)
            with R.editor_slot():
                code, _ = R.run([os.path.join(R.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), R.PROJECT, '-run=pythonscript', f'-script={py}',
                                 '-unattended', '-nosplash', '-nullrhi'], logf or os.path.join(DIR, f'{batch}.log'), env=dict(os.environ, MATLIB_CFG=cfg))
            if code or not os.path.exists(out): raise RuntimeError(f'matlib: creating {len(new)} instances failed (see {logf})')
            for k in new: ix[k] = {'path': f'{folder}/{k}', 'mat': None}
            save_index(ix); folders.append(folder)
        if folders:   # (the binding over the library's folders: the cells' records name every key)
            import asset_guard
            out = os.path.join(DIR, f'bind_{os.getpid()}')
            # (asset_guard: the shared folders open only for city update's build stage; a new batch folder is this run's own)
            stale_shared = [f for f in folders if f in stale_folders]
            if stale_shared and os.environ.get('MATLIB_SHARED') == 'asis':   # (a reader of the library, e.g. the dioramas: the shared
                # folders drawn as the city draws them today, only this run's new batch bound)
                S['shared_as_is'] = len(stale_shared); folders = [f for f in folders if f not in stale_shared]; stale_shared = []
            if folders:
                if stale_shared and not asset_guard.token():
                    raise RuntimeError(f'matlib: {len(stale_shared)} shared library folders are bound with other tools than today\'s '
                                       f'({stale_shared[:3]}); only city update\'s build stage may rebind them (tools/ue/asset_guard.py)')
                guard = asset_guard.unlocked(stale_shared, 'matlib.ensure') if stale_shared else contextlib.nullcontext()
                with guard, R.editor_slot():
                    code, _ = R.run(['python3', os.path.join(HERE, 'r1c_bind.py'), '--world-dest', ','.join(folders), '--cells', cells_dir, '--out', out],
                                    logf or os.path.join(DIR, 'bind.log'))
                if code or not os.path.exists(os.path.join(out, 'cellmat2.json')): raise RuntimeError(f'matlib: binding failed (see {logf})')
                for k in keys:
                    if ix[k]['path'].rsplit('/', 1)[0] in folders: ix[k]['mat'] = msig
                save_index(ix)
        S['secs'] = round(time.time() - t0, 1)
        return S
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close()


def rebind_all(logf=None):
    """the whole library bound again in one pass with the records of every package the city imported on it (the blocks'
    and the single cells'), every key then stamped with today's signature: after a change to a master or a binding rule
    (one round's binding reads only its own cells' records). Returns {'keys', 'folders', 'packages', 'secs'}"""
    import render_take as R, shutil
    t0 = time.time()
    md = os.path.join(R.CC, 'tmp', f'mlib_all_{os.getpid()}'); shutil.rmtree(md, ignore_errors=True); os.makedirs(md)
    n = 0
    for src, imp in (('blk', 'impb'), ('ddu', 'impv')):
        for f in sorted(os.listdir(os.path.join(R.CC, imp))):
            k = f[:-5] if f.endswith('.json') else None
            g = os.path.join(R.CC, src, f'{k}.glb') if k else None
            if g and os.path.exists(g) and not os.path.exists(os.path.join(md, f'{k}.glb')): os.symlink(g, os.path.join(md, f'{k}.glb')); n += 1
    lock = open(os.path.join(DIR, '.lock'), 'a+'); fcntl.flock(lock, fcntl.LOCK_EX)
    try:
        ix = load_index(); msig = R.mat_sig()
        folders = sorted({v['path'].rsplit('/', 1)[0] for v in ix.values()})
        out = os.path.join(DIR, f'bind_all_{os.getpid()}')
        with R.editor_slot():
            code, _ = R.run(['python3', os.path.join(HERE, 'r1c_bind.py'), '--world-dest', ','.join(folders), '--cells', md, '--out', out],
                            logf or os.path.join(DIR, 'bind_all.log'))
        if code or not os.path.exists(os.path.join(out, 'cellmat2.json')): raise RuntimeError(f'matlib: binding the library failed (see {logf})')
        for k in ix: ix[k]['mat'] = msig
        save_index(ix)
        return {'keys': len(ix), 'folders': len(folders), 'packages': n, 'bind': json.load(open(os.path.join(out, 'cellmat2.json'))), 'secs': round(time.time() - t0, 1)}
    finally:
        fcntl.flock(lock, fcntl.LOCK_UN); lock.close(); shutil.rmtree(md, ignore_errors=True)


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=('ensure', 'rebind-all')); ap.add_argument('--cells', default=None)
    a = ap.parse_args()
    print(json.dumps(ensure(a.cells) if a.stage == 'ensure' else rebind_all()))
