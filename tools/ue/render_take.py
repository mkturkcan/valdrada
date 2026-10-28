#!/usr/bin/env python3
# R1C (lane C, 2026-10-11): the Unreal render of a take from its name, for the build graph (render:ue:<shot>).
#
#   tools/ue/render_take.sh <shot> [--frames a-b] [--out <root>] [--gpu-pci 01] [--rebuild-world] [--rebuild-take] [--keep-raw]
#
# Everything comes from the shot's name:
#   - the take: /data0/projectnyc_aux/cellcache/takes/<shot>/ (lane D: usd/, harvest/, loadset.json), its usd/ and harvest/
#     resolved to the build they point at (takes/<shot>/v<stamp>/), so a rebuild beside the render changes nothing it reads;
#   - the city: the load set's grid of cells (union.cells and union.cellsMissing, each at its current hash in lane A's
#     cellcache/index.json, from lane A's plain copies when one carries that hash, else decompressed here), the chunks the
#     load set draws on the take's frames and its landmarks (lane B's packages, union.files), masked under the cells.
# The persistent world is keyed by a hash of its inputs (every cell, chunk and landmark package hash, the tools that build
# it): /Game/W/<world key>/ (four cell levels, the far city's level), built once and reused by every take that needs the
# same city (a second render of a region costs only its take and its render). A take is keyed by the world, its build of
# lane D's layers and the tools: /Game/T level with the world's levels, the take's actors and light in a sublevel, reused
# by later renders of the same take (only the render runs).
# Frames: <root>/<frames tag>/clips/<shot>/frame_%05d.jpg (root client/shots/valdrada/ue; tag `all` or `f<a>-<b>`, b
# exclusive as tools/valdrada.mjs counts it), with take_ue.json beside them (keys, reuse, seconds per stage, s/frame).
# Exit codes: 0 frames written; 2 inputs missing (no take folder, no load set, no cell); 3 the world failed; 4 the take
# failed; 5 the render failed (after one retry); 6 the frames' conversion failed or frames are missing; 7 the frames are
# written but the cross-renderer gate failed (tools/ue/r1c_xgate.py against the three.js take's frames: a sign whose letters
# do not match; the report and its crops in the run folder, the take_ue.json `xgate`).
import argparse, contextlib, fcntl, glob, hashlib, json, os, re, shutil, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'city'))
import pconf; pconf.apply()   # (CITY 2026-10-25: config/pipeline.json's flags as defaults; an env value that differs is logged)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
EXPORT = os.path.join(ROOT, 'client', 'tools', 'ar34', 'export')
PROJECT = os.path.join(EXPORT, 'ue_project', 'BoundlessUE.uproject')
SAVED = os.path.join(EXPORT, 'ue_project', 'Saved')
UE_ROOT = os.environ.get('UE_ROOT', '/data0/projectnyc_aux/ue/UE_5.8')
CELLCACHE = os.environ.get('CELLCACHE', '/data0/projectnyc_aux/cellcache')
UECACHE = os.environ.get('R1C_UECACHE', '/data0/projectnyc_aux/ue_cache')
BATCHES = int(os.environ.get('UE_BATCHES', '8'))   # (GB43, 2026-10-13: 8, the editors' start and save are ~100 s each whatever they import; an idle editor imports a cell in ~3.5 s, and 28 at once ran 15 times slower)
_BATCHES_WAS = 24   # (GB43: the imports in parallel editors; 128 cores, 1 TB: 4 took 18 min for 435 cells)
TREES_FROM = '/Game/Takes/r1c_scLakeGolden,/Game/Takes/r1c_scBowGolden,/Game/Takes/r1c_tuApolloSweep'   # (the opaque tree prototypes)
WORLD_TOOLS = ('r1c_glbuv.py', 'r1c_dedupe.py', 'r1c_dupgate.py', 'r1c_lodprep.py', 'r1c_cells.py', 'r1c_decomp.mjs')   # (what the world's imports depend on)
# GB43 (2026-10-12): the tiles' facade master and the kit's glass on it are the default since UV 0 reaches Unreal (5b742f0);
# BD_TILEFAC=0 or BD_TILEFAC_GLASS=0 for the old records (the subprocesses read the same environment)
os.environ.setdefault('BD_TILEFAC', '1'); os.environ.setdefault('BD_TILEFAC_GLASS', '1')
MAT_TOOLS = ('r1c_cellmat2.py', 'r1c_lodmat.py', 'r1c_bind.py') + (('bd_tilefac.py', 'bd_tilefac.hlsl') if os.environ.get('BD_TILEFAC') == '1' else ())   # (a change re-binds the world's materials, no import; BD40: the tiles' facade master, opt-in)
TAKE_TOOLS = ('r1c_actors.py', 'render_take.json')
EXPORT_TOOLS = ('ue_prep.py', 'ue_mat.py', 'ue_light.py', 'ue_take.py', 'ue_trees.py')


def mat_sig():
    """the material tools' hashes, and the tile facade master's version and source (BD_TILEFAC_V, BD_TILEFAC_HLSL): a
    different master is a rebind too (RG44: an env-selected diagnostic master was not bound)"""
    sig = {n: fsha(os.path.join(HERE, n)) for n in MAT_TOOLS}
    if os.environ.get('BD_TILEFAC') == '1':
        h = os.environ.get('BD_TILEFAC_HLSL', 'bd_tilefac.hlsl')
        sig['bd_tilefac_master'] = f"{os.environ.get('BD_TILEFAC_V', '108')}|glass{os.environ.get('BD_TILEFAC_GLASS', '1')}|{h}|{fsha(os.path.join(HERE, h)) if os.path.exists(os.path.join(HERE, h)) else 'missing'}"
    return sig


def log(*a):
    print(time.strftime('[render_take %H:%M:%S]'), *a, flush=True)


def sha(obj):
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


def fsha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()[:16] if os.path.exists(path) else None


def run(cmd, logf, env=None, timeout=None):
    t = time.time()
    with open(logf, 'a') as lf:
        lf.write(f"### {time.strftime('%F %T')} {' '.join(cmd)}\n"); lf.flush()
        try: code = subprocess.call(cmd, stdout=lf, stderr=subprocess.STDOUT, env=env, timeout=timeout, cwd=ROOT)
        except subprocess.TimeoutExpired: code = 124
    return code, round(time.time() - t, 1)


def ue_env():
    e = dict(os.environ)
    e.update({'UE-LocalDataCachePath': os.environ.get('BXUE_DDC', '/data0/projectnyc_aux/ue/ddc'), 'UE-SharedDataCachePath': 'None',
              'UE_PYTHONPATH': os.pathsep.join([EXPORT, os.path.join(EXPORT, 'ue_project', 'Python'), HERE])})
    if os.path.exists('/usr/share/vulkan/icd.d/nvidia_icd.json'): e.setdefault('VK_ICD_FILENAMES', '/usr/share/vulkan/icd.d/nvidia_icd.json')
    return e


def uvpy(*mods):
    out = ['uv', 'run', '--no-project']
    for m in mods: out += ['--with', m]
    return out + ['python']


def plain_index():
    """{package hash: lane A plain copy} over cellcache/plain/*/index.json"""
    P = {}
    for ix in glob.glob(os.path.join(CELLCACHE, 'plain', '*', 'index.json')):
        if '.prev-' in os.path.basename(os.path.dirname(ix)): continue   # (an export's set moved aside: RG44, an old copy won)
        try: d = json.load(open(ix))
        except Exception: continue
        for k, c in (d.get('cells') or {}).items():
            f = os.path.join(os.path.dirname(ix), c.get('glb') or f'{k}.glb')
            if c.get('hash') and os.path.exists(f) and (c['hash'] not in P or os.path.getmtime(f) > os.path.getmtime(P[c['hash']])): P[c['hash']] = f   # (the newest copy)
    return P


def inputs(shot):
    tk = os.path.join(CELLCACHE, 'takes', shot)
    lsp = os.path.join(tk, 'loadset.json')
    if not os.path.isdir(tk) or not os.path.exists(lsp): return None, f'no take folder or load set under {tk}'
    usd, harvest = os.path.realpath(os.path.join(tk, 'usd')), os.path.realpath(os.path.join(tk, 'harvest'))
    if not os.path.exists(os.path.join(usd, f'{shot}.usda')): return None, f'no take root {usd}/{shot}.usda'
    LS = json.load(open(lsp))
    # (a cell's package: its current one in lane A's indexes (the global index, then each region's, the take's own region
    # last; test regions skipped), else the one the load set names (union.files); a package must exist in the cache)
    # (lane A's test bakes, e.g. dettest and parkdet, are regions too: skipped; the newest region index wins a cell, the take's
    # own region over all; the global index only for a cell no region lists)
    gix = {}
    regs = [f for f in glob.glob(os.path.join(CELLCACHE, 'index', '*.json')) if not re.search(r'(test|det)', os.path.basename(f))]
    regs.sort(key=os.path.getmtime)
    own = [f for f in regs if os.path.basename(f) == f'{shot}.json']
    for ix in [os.path.join(CELLCACHE, 'index.json')] + [f for f in regs if f not in own] + own:
        try:
            for k, c in (json.load(open(ix)).get('cells') or {}).items():
                if c.get('hash') and os.path.exists(os.path.join(CELLCACHE, c['hash'], 'cell.glb')): gix[k] = c['hash']
        except Exception: pass
    grid = sorted(set(LS['union'].get('cells') or []) | set(LS['union'].get('cellsMissing') or []))
    fcells = (LS['union'].get('files') or {}).get('cells') or {}
    cells = {}
    for k in grid:
        h = gix.get(k) or (fcells[k].split('/')[0] if k in fcells else None)
        if h and os.path.exists(os.path.join(CELLCACHE, h, 'cell.glb')): cells[k] = h
    if not cells: return None, 'no baked cell in the load set\'s grid'
    files = LS['union'].get('files') or {}
    drawn = sorted({k for f in LS['frames'] for k in f['chunks']})
    chunks = {k: files['chunks'][k] for k in drawn if k in (files.get('chunks') or {})}
    lms = {k: files['landmarks'][k] for k in (LS['union'].get('landmarks') or []) if k in (files.get('landmarks') or {})}
    # ==== R2B (2026-10-11): the far level's water (cell-package.md sections 7 and 12: a `water` node in every L6 chunk) is
    # drawn whole whichever level draws a chunk's square: the L6 packages the load set does not draw give their water
    # alone (r1c_lodprep.py --water-src). R2B_LOD16 (a private export folder) stands in for the shared lod16 cache, its L6
    # packages over the load set's own. A lod16 export without water adds nothing (the worlds keep their keys).
    water = {}
    lroot = os.environ.get('R2B_LOD16') or os.path.join(CELLCACHE, 'lod16')
    try: lidx = json.load(open(os.path.join(lroot, 'index.json')))
    except Exception: lidx = {}
    if 'water' in (lidx.get('materials') or {}):
        l6 = {k: os.path.join(lroot, v['file']) for k, v in (lidx.get('chunks') or {}).items() if k.startswith('L6_')}
        if os.environ.get('R2B_LOD16'):
            for k in list(chunks):
                if k in l6: chunks[k] = l6[k]
        water = {k: f for k, f in l6.items() if k not in chunks}
    # ==== end R2B
    LSt = json.load(open(os.path.join(harvest, 'light_static.json'))) if os.path.exists(os.path.join(harvest, 'light_static.json')) else {}
    night = 1 if float(LSt.get('night', 1.0 if LSt.get('mode') == 'night' else 0.0) or 0) >= 0.5 else 0
    return {'shot': shot, 'take_dir': tk, 'usd': usd, 'harvest': harvest, 'loadset': lsp, 'cells': cells, 'missing': [k for k in grid if k not in cells], 'index': gix,
            'chunks': chunks, 'landmarks': lms, 'water': water, 'frames': len(LS['frames']), 'night': night}, None


def group_world(I, shots):
    """GB43: the world of a group of shots: the union of their cells, chunks, landmarks and water, and one load set merging
    theirs (the far city is masked under every cell any of them draws), so the group's shots share one import; the take,
    the frames and the light stay the shot's own"""
    if I['shot'] not in shots: shots = [I['shot']] + shots
    cells, chunks, lms, water, missing = {}, {}, {}, {}, set()
    LSm = {'frames': [], 'union': {'cells': set(), 'cellsMissing': set(), 'landmarks': set(), 'files': {}}}
    for s in shots:
        J, err = inputs(s) if s != I['shot'] else (I, None)
        if err: log('group: skipping', s, err); continue
        cells.update(J['cells']); chunks.update(J['chunks']); lms.update(J['landmarks']); water.update(J.get('water') or {}); missing |= set(J['missing'])
        L = json.load(open(J['loadset']))
        LSm['frames'] += [{'chunks': f.get('chunks') or [], 'cells': f.get('cells') or []} for f in L['frames']]
        U = L['union']
        for k in ('cells', 'cellsMissing', 'landmarks'): LSm['union'][k] |= set(U.get(k) or [])
        for kind, d in (U.get('files') or {}).items(): LSm['union']['files'].setdefault(kind, {}).update(d)
    water = {k: f for k, f in water.items() if k not in chunks}
    for k in ('cells', 'cellsMissing', 'landmarks'): LSm['union'][k] = sorted(LSm['union'][k])
    gk = sha({'shots': sorted(shots), 'cells': cells, 'chunks': chunks})[:16]
    gdir = os.path.join(UECACHE, 'groups'); os.makedirs(gdir, exist_ok=True)
    lsp = os.path.join(gdir, f'{gk}_loadset.json'); json.dump(LSm, open(lsp, 'w'))
    log('group', gk, len(shots), 'shots:', len(cells), 'cells,', len(chunks), 'chunks,', len(lms), 'landmarks')
    return {**I, 'cells': cells, 'chunks': chunks, 'landmarks': lms, 'water': water, 'missing': sorted(missing - set(cells)), 'loadset': lsp}


CC = os.path.join(UECACHE, 'cc')   # GB43: the Unreal cell cache (pack/, dd/, imp/: by content key)
CC_ROOT = '/Game/CC'
CC_ON = os.environ.get('UE_CC', '1') == '1'


def cc_ptool():
    """the packer's tools in a package's key (GB43: the decompressor too, it inlines the prototypes)"""
    return sha({'glbuv': fsha(os.path.join(HERE, 'r1c_glbuv.py')), 'tilefac': os.environ.get('BD_TILEFAC', '1'),
                'decomp': fsha(os.path.join(HERE, 'r1c_decomp.mjs'))})[:12]


def cc_cells(I, logf, S):
    """GB43: the world's cells through the cell cache, each step once per content key: a package packed once
    (r1c_glbuv.py), deduplicated once per neighbourhood (r1c_dedupe.py over its 3x3 cells, both passes, the centre kept),
    imported once into its own level /Game/CC/<key>/L (r1c_cells.py --per-cell) and bound once (r1c_cellmat2.py,
    bd_tilefac.py on its folder; again when the material tools change). Returns {cell: key}."""
    from concurrent.futures import ThreadPoolExecutor
    for d in ('pack', 'dd', 'imp', 'tmp'): os.makedirs(os.path.join(CC, d), exist_ok=True)
    gix = I.get('index') or {}
    want = dict(I['cells'])
    def nbrs(k, r=2):   # (GB43: two rings; a long building dressed in its anchor cell reaches two cells over)
        cx, cz = map(int, k.split('_')); return [(dx, dz, f'{cx + dx}_{cz + dz}') for dz in range(-r, r + 1) for dx in range(-r, r + 1) if dx or dz]
    allc = dict(want)
    for k in want:
        for _, _, n in nbrs(k):
            h = want.get(n) or gix.get(n)
            if h and os.path.exists(os.path.join(CELLCACHE, h, 'cell.glb')): allc[n] = h
    # -- 1. plain copies and packing, once per package
    t = time.time(); pl = plain_index()
    ptool = cc_ptool()
    # (GB43: by the package's bytes, not by the bake's inputs: a bake's inputs cover the whole generator, so any edit gave
    # every cell a new key and a new deduplication and import; a third of the trailer's cells came out of today's bake
    # byte for byte as before; the content's hash is kept beside the package, written once)
    def csha(h):
        f = os.path.join(CELLCACHE, h, 'content.sha')
        try: return open(f).read().strip()
        except Exception: pass
        d = hashlib.sha256(open(os.path.join(CELLCACHE, h, 'cell.glb'), 'rb').read()).hexdigest()[:32]
        try: open(f + f'.{os.getpid()}', 'w').write(d); os.replace(f + f'.{os.getpid()}', f)
        except Exception: pass
        return d
    with ThreadPoolExecutor(32) as ex_: cs = dict(zip(allc, ex_.map(csha, allc.values())))
    pkey = {k: sha([cs[k], ptool])[:20] for k in allc}
    have = lambda k: os.path.exists(os.path.join(CC, 'pack', pkey[k] + '.glb')) or os.path.exists(os.path.join(CC, 'pack', pkey[k] + '.empty'))
    need = {k: h for k, h in allc.items() if not have(k)}
    if need:
        # (GB43: in groups of ~120 packages, up to PACK_JOBS at once: one decompression and one packer over a city's
        # 50,000 packages would run for hours)
        items = sorted(need.items()); ng = max(1, min(int(os.environ.get('UE_PACK_JOBS', '32')), (len(items) + 119) // 120))
        def pack_group(g):
            part = items[g::ng]
            src = os.path.join(CC, 'tmp', f'packsrc_{os.getpid()}_{g}'); shutil.rmtree(src, ignore_errors=True); os.makedirs(src)
            jobs = []
            for k, h in part:
                f = pl.get(h) or os.path.join(UECACHE, 'plain2', f'{h}.glb')   # (GB43: plain2, the decompressor's copies with their prototypes inlined; plain/ held them without)
                if f not in pl.values() and not os.path.exists(f): jobs.append([os.path.join(CELLCACHE, h, 'cell.glb'), f])
                lk = os.path.join(src, pkey[k] + '.glb')
                if not os.path.lexists(lk): os.symlink(f, lk)
            if jobs:
                jp = os.path.join(CC, 'tmp', f'decomp_{os.getpid()}_{g}.json'); json.dump(jobs, open(jp, 'w'))
                code, _ = run(['node', os.path.join(HERE, 'r1c_decomp.mjs'), jp], logf + f'.pack{g}')
                if code: return False
            dst = src + '_out'; shutil.rmtree(dst, ignore_errors=True)
            code, _ = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_glbuv.py'), '--strip-images', '--src', src, '--dst', dst], logf + f'.pack{g}')
            if code: return False
            for f in os.listdir(dst):
                if f.endswith('.glb'): os.replace(os.path.join(dst, f), os.path.join(CC, 'pack', f))
            for k, _h in part:   # (a package with nothing to draw, open water: the packer writes nothing; cached as empty)
                if not os.path.exists(os.path.join(CC, 'pack', pkey[k] + '.glb')): open(os.path.join(CC, 'pack', pkey[k] + '.empty'), 'w').close()
            shutil.rmtree(src, ignore_errors=True); shutil.rmtree(dst, ignore_errors=True)
            return True
        with ThreadPoolExecutor(ng) as ex_: oks = list(ex_.map(pack_group, range(ng)))
        if not all(oks): raise RuntimeError('pack (see the .pack logs)')
    full = {k for k in allc if os.path.exists(os.path.join(CC, 'pack', pkey[k] + '.glb'))}
    want = {k: h for k, h in want.items() if k in full}
    pkey = {k: v for k, v in pkey.items() if k in full}
    S['cc_pack_s'] = round(time.time() - t, 1); S['cc_packed_new'] = len(need)
    # -- 2. deduplication, once per neighbourhood (the centre's result kept; the pairs decide by themselves, so two
    # neighbouring runs agree on the surfaces they share)
    t = time.time()
    dtool = sha({'dedupe': fsha(os.path.join(HERE, 'r1c_dedupe.py')), 'dupgate': fsha(os.path.join(HERE, 'r1c_dupgate.py'))})[:12]
    # (a cell's partners: the cells within two rings whose drawn extent meets its own; GB43, a dressed building anchored
    # two cells east of a tile facade it covered (515 m2) was never in that facade's 3x3 neighbourhood)
    def ext(k):
        f = os.path.join(CC, 'pack', pkey[k] + '.ext.json')
        try: return json.load(open(f))
        except Exception: pass
        b = open(os.path.join(CC, 'pack', pkey[k] + '.glb'), 'rb').read(); L = int.from_bytes(b[12:16], 'little'); J = json.loads(b[20:20 + L])
        sc = J.get('scenes') or [{}]; rt = J['nodes'][sc[0]['nodes'][0]] if sc[0].get('nodes') else {}
        o = rt.get('translation') or [0, 0, 0]; lo, hi = [1e18, 1e18], [-1e18, -1e18]
        for me in J.get('meshes', []):
            for pr in me['primitives']:
                a_ = J['accessors'][pr['attributes']['POSITION']]
                if 'min' not in a_: continue
                for i_, c_ in ((0, 0), (1, 2)): lo[i_] = min(lo[i_], a_['min'][c_] + o[c_]); hi[i_] = max(hi[i_], a_['max'][c_] + o[c_])
        e = [lo[0], lo[1], hi[0], hi[1]]; tmp = f + f'.{os.getpid()}'; json.dump(e, open(tmp, 'w')); os.replace(tmp, f)
        return e
    meets = lambda a, b: a[0] <= b[2] + 0.1 and b[0] <= a[2] + 0.1 and a[1] <= b[3] + 0.1 and b[1] <= a[3] + 0.1
    partners = {k: [n for _, _, n in nbrs(k) if n in pkey and meets(ext(k), ext(n))] for k in want}
    if V2:   # (city v2: the generator draws each building once (bakeLib.js reachesRegion), so a cell needs no partners: the
        # pass runs over the cell alone and only lifts its own coplanar layers, and no cell waits on or is rebuilt for another)
        partners = {k: [] for k in want}
    dkey = {k: sha([pkey[k], sorted((n, pkey[n]) for n in partners[k]), dtool] + (['v2p1'] if V2 else []))[:20] for k in want}
    I['_partners'] = partners   # (for the convergence round, cc_fix)
    cell_of = {d: k for k, d in dkey.items()}
    def dd(k):
        tmp = os.path.join(CC, 'tmp', f'dd_{dkey[k]}_{os.getpid()}'); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
        for n in [k] + partners[k]:
            shutil.copyfile(os.path.join(CC, 'pack', pkey[n] + '.glb'), os.path.join(tmp, n + '.glb'))
        for pass_ in ((1,) if V2 else (1, 2)):   # (city v2: the cell alone, one pass: its coplanar layers left under 0.4 m2)
            code, _ = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_dedupe.py'), '--dir', tmp, '--out', os.path.join(tmp, f'dd{pass_}.json'), f'--keep={k}.glb', '--jobs', os.environ.get('UE_DD_WORKERS', '2')],   # (= : a cell name can start with a minus)
                          os.path.join(tmp, 'dd.log'))
            if code: return k, False
        os.replace(os.path.join(tmp, k + '.glb'), os.path.join(CC, 'dd', dkey[k] + '.glb'))
        shutil.rmtree(tmp, ignore_errors=True)
        return k, True
    def dd_all(ds):
        with ThreadPoolExecutor(int(os.environ.get('UE_CC_JOBS', '48'))) as ex: list(ex.map(dd, [cell_of[d] for d in ds]))
    S['cc_dedupe_new'] = claimed(set(dkey.values()), 'dd', lambda d: os.path.exists(os.path.join(CC, 'dd', d + '.glb')), dd_all, 'dedupe')
    S['cc_dedupe_s'] = round(time.time() - t, 1)
    return dkey


CLAIMS = os.path.join(CC, 'claims')


def _alive(pid):
    try: os.kill(pid, 0); return True
    except ProcessLookupError: return False
    except PermissionError: return True


def _holder(tag):
    try: return int(open(os.path.join(CLAIMS, tag)).read() or 0)
    except Exception: return 0


def claim(tag):
    """GB43: a cache step on one key by one process at a time: claims/<tag> holds the claimant's pid, and the claim of a
    process that is gone is taken over (the global lock had six worlds wait in turn, 40 minutes each)"""
    os.makedirs(CLAIMS, exist_ok=True)
    try:
        fd = os.open(os.path.join(CLAIMS, tag), os.O_CREAT | os.O_EXCL | os.O_WRONLY); os.write(fd, str(os.getpid()).encode()); os.close(fd); return True
    except FileExistsError: pass
    pid = _holder(tag)
    if pid and pid != os.getpid() and _alive(pid): return False
    with open(os.path.join(CLAIMS, tag), 'w') as f: f.write(str(os.getpid()))
    return True


def unclaim(tag):
    if _holder(tag) == os.getpid():
        try: os.remove(os.path.join(CLAIMS, tag))
        except FileNotFoundError: pass


def claimed(keys, tag, done, work, what, wait_s=7200):
    """the keys not done: those this process claims to work(list), those another live process holds waited for until
    done (a claim whose process goes is then taken here); raises on a key of its own left undone"""
    todo = sorted({k for k in keys if not done(k)}); t0 = time.time(); n_mine = 0
    while todo:
        mine = [k for k in todo if claim(f'{tag}_{k}')]
        try:
            if mine: work(mine); n_mine += len(mine)
        finally:
            for k in mine: unclaim(f'{tag}_{k}')
        bad = [k for k in mine if not done(k)]
        if bad: raise RuntimeError(f'{what} failed for {len(bad)}, e.g. {bad[:3]}')
        while True:
            todo = [k for k in todo if not done(k)]
            if not todo or any(not (_holder(f'{tag}_{k}') and _alive(_holder(f'{tag}_{k}'))) for k in todo): break
            if time.time() - t0 > wait_s: raise RuntimeError(f'{what}: {len(todo)} keys held by other runs for {wait_s} s')
            time.sleep(5)
    return n_mine


SLOTS = '/data0/projectnyc_aux/tmp/ue_editor_slots'
IMP_CHUNK = int(os.environ.get('UE_IMP_CHUNK', '120'))   # (GB43: cells an import editor takes; see _imp_levels)
MAX_EDITORS = int(os.environ.get('UE_MAX_EDITORS', '8'))   # (GB43, 2026-10-13: 8 machine-wide; see BATCHES)


@contextlib.contextmanager
def editor_slot():
    """GB43: a machine-wide cap on the cache's Unreal editors (about 16 GB each): with the caches' lock gone, three worlds
    importing at once ran 58 editors in 916 GB, and the bakes' pages died for memory"""
    os.makedirs(SLOTS, exist_ok=True)
    while True:
        for i in range(MAX_EDITORS):
            f = open(os.path.join(SLOTS, f'{i}.lock'), 'a+')
            try: fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: f.close(); continue
            try: yield i
            finally: fcntl.flock(f, fcntl.LOCK_UN); f.close()
            return
        time.sleep(2)


def _imp_levels(keys, root, src_dir, imp_dir, tmp_dir, logf, tag, extra=()):
    """the packages' levels, root/<key>/L, in up to BATCHES editors (r1c_cells.py --per-cell), each holding an editor
    slot; a saved one recorded"""
    nb_ = max(1, min(BATCHES, len(keys))) if root == CC_ROOT else max(1, min(BATCHES, (len(keys) + 15) // 16))
    # (GB43, 2026-10-14: at most IMP_CHUNK cells an editor, the chunks dealt to nb_ editors at a time: an editor given
    # 1,100 cells grew to 126 GB and the machine ran out of memory)
    nch = max(nb_, (len(keys) + IMP_CHUNK - 1) // IMP_CHUNK)
    def one(b):
        bd = os.path.join(tmp_dir, f'imp_{os.getpid()}_{b}'); shutil.rmtree(bd, ignore_errors=True); os.makedirs(bd)
        for k in keys[b::nch]: os.symlink(os.path.join(src_dir, k + '.glb'), os.path.join(bd, k + '.glb'))
        with editor_slot():
            subprocess.call(uvpy('numpy') + [os.path.join(HERE, 'r1c_cells.py'), '--cells', bd, '--per-cell', root, *extra, '--out', bd + '_out'],
                            stdout=open(logf + f'.{tag}{b}', 'a'), stderr=subprocess.STDOUT, cwd=ROOT)
        try: R = json.load(open(os.path.join(bd + '_out', 'cells_import.json')))['cells']
        except Exception: R = {}
        for k, rec in R.items():
            if rec.get('ok') and rec.get('saved'): json.dump({**rec, 'mat': None}, open(os.path.join(imp_dir, k + '.json'), 'w'))
        if all((R.get(k) or {}).get('saved') for k in keys[b::nch]):   # (the editor's folder, ~180 MB, kept only when a cell failed)
            shutil.rmtree(bd, ignore_errors=True); shutil.rmtree(bd + '_out', ignore_errors=True)
    with ThreadPoolExecutor(nb_) as ex: list(ex.map(one, range(nch)))


def cc_load(dkey, logf, S):
    """GB43: the cell cache's import and binding of a world's deduplicated cells, once the overlap gate has passed on them
    (the gate had run after 40 minutes of import and binding, and failed); each key claimed, not the cache locked. With
    UE_KITCELLS=1 the kit's way (cc_load_kit)."""
    if KITCELLS: return cc_load_kit(dkey, logf, S)
    _load_root(sorted(set(dkey.values())), CC_ROOT, 'dd', 'imp', '', logf, S)
    return dkey


def _load_root(keys, root, src, imp, tag, logf, S):
    """the import (each key into root/<key>/L from cc/<src>/<key>.glb, recorded in cc/<imp>) and the binding of keys"""
    for d in (src, imp): os.makedirs(os.path.join(CC, d), exist_ok=True)
    # -- 3. import, once per result, each cell into its own level
    t = time.time()
    msig = mat_sig()
    def imported(d):
        j = os.path.join(CC, imp, d + '.json')
        return os.path.exists(j) and os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', root[len('/Game/'):], d, 'L.umap'))
    S[f'cc{tag}_imported_new'] = claimed(set(keys), imp, imported,
                                         lambda ks: _imp_levels(ks, root, os.path.join(CC, src), os.path.join(CC, imp), os.path.join(CC, 'tmp'), logf, 'cc' + tag,
                                                                ('--tree-from', TREES_FROM)), 'import')
    S[f'cc{tag}_import_s'] = round(time.time() - t, 1)
    # -- 4. materials, once per result and material tools
    t = time.time()
    bound = lambda d: json.load(open(os.path.join(CC, imp, d + '.json'))).get('mat') == msig
    def bind_all(unbound):
        # (the cells' families and the tiles' facade master in one editor session each, r1c_bind.py; GB43: in batches of
        # about 40 cells, up to BATCHES editors at once: one editor binding 600 cells saved its packages one by one for
        # a quarter of an hour with the machine idle. The masters exist once per version, the shared textures by content.)
        nb_ = max(1, min(BATCHES, (len(unbound) + 39) // 40))
        def bind(b):
            md = os.path.join(CC, 'tmp', f'mat{tag}_{os.getpid()}_{b}'); shutil.rmtree(md, ignore_errors=True); os.makedirs(md)
            part = unbound[b::nb_]
            for d in part: os.symlink(os.path.join(CC, src, d + '.glb'), os.path.join(md, d + '.glb'))
            with editor_slot():
                code, _ = run(['python3', os.path.join(HERE, 'r1c_bind.py'), '--world-dest', ','.join(f'{root}/{d}' for d in part), '--cells', md, '--out', md + '_mat'], logf + f'.cc{tag}mat{b}')
            if code or not os.path.exists(os.path.join(md + '_mat', 'cellmat2.json')): return
            for d in part:
                jp = os.path.join(CC, imp, d + '.json'); j = json.load(open(jp)); j['mat'] = msig; json.dump(j, open(jp, 'w'))
        if nb_ > 1: bind(0)   # (the first alone: any master it lacks is built once)
        with ThreadPoolExecutor(nb_) as ex: list(ex.map(bind, range(1 if nb_ > 1 else 0, nb_)))
    S[f'cc{tag}_bound_new'] = claimed(set(keys), 'mat' + tag, bound, bind_all, 'cell materials (see the bind logs)')
    S[f'cc{tag}_mat_s'] = round(time.time() - t, 1)


# ==== GB43 KIT (docs/notes/ue-city-architecture.md): UE_KITCELLS=1, a cell's kit sets drawn by the cell actor from its
# table (vcel_write.py, cc/tables/<key>.vcel) over the kit imported once (kit_import.py, /Game/Kit), its unique meshes
# (kit_strip.py, cc/ddu/<key>.glb) imported into /Game/CCU/<key>/L; the take places a cell actor per table
KITCELLS = os.environ.get('UE_KITCELLS') == '1'
LO_MIN = 1.5     # (m: the reduced tables' smallest instance)
LO_DIST = 600.0  # (m: a cell this far from every lens position of a shot takes its reduced table; 784 cells in full, about 4 million
                 # instances, ran the render's GPU out of memory)
CCU_ROOT = '/Game/CCU'
# city v2 (docs/notes/ue-city-architecture.md): UE_V2=1, the cells' unique meshes imported into /Game/CCV over the shared
# material library (tools/ue/matlib.py: no per-cell material instances, no per-cell binding), and no overlap pass
V2 = os.environ.get('UE_V2') == '1'
CCV_ROOT = '/Game/CCV'
V2_BLOCKS = V2 and os.environ.get('UE_V2_BLOCKS', '1') == '1'   # (the cells' unique meshes imported per 1 km block, cc_blocks)
CCB_ROOT = '/Game/CCB'
NANITE_BUDGET = int(os.environ.get('UE_NANITE_BUDGET', '50000'))   # (a city shot's cells' Nanite meshes: Nanite's root pages share a 2 GB pool with
    # its streaming pool, 57,344 of them with the cine preset's 256 MB pool (49,152 with the default 512); the kit, the far
    # city and the actors take the rest; the Queensboro aerial drew 50,715 counted meshes in the default pool)


_KIT_INDEX = None


def _cell_tables(d):
    """one cell's table, reduced table and unique meshes' glb (a worker of cc_load_kit's pool); the cell's key if the kit
    lacks a prototype of it"""
    global _KIT_INDEX
    import vcel_write, kit_strip
    if _KIT_INDEX is None: _KIT_INDEX = json.load(open('/data0/projectnyc_aux/ue_cache/kit/index.json'))
    src = os.path.join(CC, 'dd', d + '.glb')
    tp = os.path.join(CC, 'tables', d + '.vcel')
    if not os.path.exists(tp):
        r = vcel_write.write_table(src, _KIT_INDEX, tp)
        if r['missing']: os.replace(tp, tp + '.incomplete'); return d
    lp = os.path.join(CC, 'tables', d + '.lo.vcel')   # (the reduced table, for a cell far from a shot's lens: no part under 1.5 m)
    if not os.path.exists(lp): vcel_write.write_table(src, _KIT_INDEX, lp, min_size=LO_MIN)
    up = os.path.join(CC, 'ddu', d + '.glb')
    if not os.path.exists(up): kit_strip.strip(src, up)
    return None


def cc_load_kit(dkey, logf, S):
    import vcel_write, kit_strip
    keys = sorted(set(dkey.values()))
    t = time.time()
    for d in ('tables', 'ddu', 'tmp'): os.makedirs(os.path.join(CC, d), exist_ok=True)
    kd = os.path.join(CC, 'tmp', f'kit_{os.getpid()}'); shutil.rmtree(kd, ignore_errors=True); os.makedirs(kd)
    for d in keys: os.symlink(os.path.join(CC, 'dd', d + '.glb'), os.path.join(kd, d + '.glb'))
    kl = open(os.path.join(CC, '.kitlock'), 'w'); fcntl.flock(kl, fcntl.LOCK_EX)   # (one kit import at a time: a prototype is imported once)
    try: code, S['kit_s'] = run(['python3', os.path.join(HERE, 'kit_import.py'), '--cells', kd], logf + '.kit')
    finally: fcntl.flock(kl, fcntl.LOCK_UN)
    if code: raise RuntimeError('kit import (see the .kit log)')
    kit = json.load(open('/data0/projectnyc_aux/ue_cache/kit/index.json'))
    # (each cell's table, its reduced table and its unique meshes' glb, in a process pool: one at a time took 0.5 s a cell)
    todo = [d for d in keys if not all(os.path.exists(x) for x in (os.path.join(CC, 'tables', d + '.vcel'), os.path.join(CC, 'tables', d + '.lo.vcel'), os.path.join(CC, 'ddu', d + '.glb')))]
    if todo:
        from concurrent.futures import ProcessPoolExecutor
        with ProcessPoolExecutor(int(os.environ.get('UE_TABLE_JOBS', '32'))) as ex:
            miss = [m for m in ex.map(_cell_tables, todo, chunksize=8) if m]
        if miss: raise RuntimeError(f'the kit lacks prototypes of {len(miss)} cells, e.g. {miss[:3]}')
    S['kit_tables_new'] = len(todo); S['kit_tables_s'] = round(time.time() - t, 1)
    if V2_BLOCKS: pass   # (the blocks import the cells' meshes: cc_blocks)
    elif V2: _load_root_v2(keys, CCV_ROOT, 'ddu', 'impv', logf, S)
    else: _load_root(keys, CCU_ROOT, 'ddu', 'impu', 'u', logf, S)
    return dkey


def _merge_block(job):
    import block_merge
    out, origin, paths = job
    if os.path.exists(out): return None
    return block_merge.merge(paths, out, origin)


def cc_blocks(cells, logf, S):
    """city v2: each 1 km block of cells ({cell: key}, every built cell of the block) as one package (block_merge.py),
    keyed by its cells' keys, imported once over the material library into /Game/CCB/<key>/L. Returns {block: key}"""
    import city_build as CB
    from concurrent.futures import ProcessPoolExecutor
    t = time.time(); os.makedirs(os.path.join(CC, 'blk'), exist_ok=True)
    by = {}
    for k, d in cells.items(): by.setdefault(CB.block_of(k), {})[k] = d
    bkey, jobs = {}, []
    for b, cs in sorted(by.items()):
        bkey[b] = sha(sorted(cs.items()) + ['blk1', fsha(os.path.join(HERE, 'block_merge.py'))])[:20]
        out = os.path.join(CC, 'blk', bkey[b] + '.glb')
        paths = [os.path.join(CC, 'ddu', d + '.glb') for _, d in sorted(cs.items()) if os.path.exists(os.path.join(CC, 'ddu', d + '.glb'))]
        if not os.path.exists(out): jobs.append((out, (b[0] * CB.BLOCK, b[1] * CB.BLOCK), paths))
    if jobs:
        with ProcessPoolExecutor(min(16, len(jobs))) as ex: list(ex.map(_merge_block, jobs))
    S['blocks_merged_new'] = len(jobs); S['blocks_merge_s'] = round(time.time() - t, 1)
    _load_root_v2(sorted(set(bkey.values())), CCB_ROOT, 'blk', 'impb', logf, S)
    return bkey


def _load_root_v2(keys, root, src, imp, logf, S):
    """city v2: the library holds every material the cells name (created and bound once), then each cell's meshes are
    imported with no materials of their own, their slots on the library (r1c_cells.py --matlib); nothing is bound per cell"""
    import matlib
    for d in (src, imp): os.makedirs(os.path.join(CC, d), exist_ok=True)
    t = time.time()
    def imported(d):
        return os.path.exists(os.path.join(CC, imp, d + '.json')) and os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', root[len('/Game/'):], d, 'L.umap'))
    def work(ks):
        md = os.path.join(CC, 'tmp', f'mlib_{os.getpid()}'); shutil.rmtree(md, ignore_errors=True); os.makedirs(md)
        for d in ks: os.symlink(os.path.join(CC, src, d + '.glb'), os.path.join(md, d + '.glb'))
        S['matlib'] = matlib.ensure(md, logf + '.matlib')
        _imp_levels(ks, root, os.path.join(CC, src), os.path.join(CC, imp), os.path.join(CC, 'tmp'), logf, 'ccv', ('--tree-from', TREES_FROM, '--matlib', matlib.INDEX))
        shutil.rmtree(md, ignore_errors=True)
        if root == CCB_ROOT and os.environ.get('UE_NANITE_FACADES', '1') == '1': S['nanite_facades'] = nanite_facades(ks, root, logf)
    S['ccv_imported_new'] = claimed(set(keys), imp, imported, work, 'import')
    S['ccv_import_s'] = round(time.time() - t, 1)




def nanite_facades(keys, root, logf):
    """2026-10-25 (docs/notes/ue-persistent-city.md): the new blocks' tile facades on Nanite: their eight UV sets packed
    into UV 1-3 and the vertex colour, the slots on the packed master's instances (ValdradaWorldEditor's commandlet
    ValdradaNaniteFacades); a facade it cannot pack stays as imported (non-Nanite, the unpacked master)"""
    croot = os.path.join(EXPORT, 'ue_project', 'Content', root[len('/Game/'):])
    paths = []
    for k in keys:
        for f in glob.glob(os.path.join(croot, k, '*', 'StaticMeshes', 'g*.uasset')):
            rel = f[len(croot):-len('.uasset')]; paths.append(f'{root}{rel}.{os.path.basename(rel)}')
    if not paths: return {'meshes': 0}
    lst = os.path.join(CC, 'tmp', f'nanfac_{os.getpid()}.txt'); open(lst, 'w').write('\n'.join(paths) + '\n')
    out = lst[:-4] + '.json'
    with editor_slot():
        run([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), PROJECT, '-run=ValdradaNaniteFacades', f'-list={lst}', f'-out={out}',
             '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'], logf + '.nanfac', env=ue_env())
    try: R = json.load(open(out)); R.pop('hist', None); return R
    except Exception: return {'error': 'no result'}


CF_ROOT = '/Game/CF'   # GB43: the far city's cache: one level per masked package, keyed by its content


def cf_far(fard, logf, S):
    """GB43: the far city's packages (masked under this world's cells by r1c_lodprep.py) through the far cache: each by its
    content's hash imported once into /Game/CF/<key>/L and bound once (r1c_lodmat.py; again when the material tools
    change); each key claimed. Returns {package: key}."""
    for d in ('imp', 'src', 'tmp'): os.makedirs(os.path.join(CC, 'far_' + d), exist_ok=True)
    t = time.time(); msig = mat_sig()
    fkeys = {}
    done_ = lambda fk: os.path.exists(os.path.join(CC, 'far_imp', fk + '.json')) and os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', CF_ROOT[len('/Game/'):], fk, 'L.umap'))
    for fn in sorted(os.listdir(fard)):
        if not fn.endswith('.glb'): continue
        fk = hashlib.sha256(open(os.path.join(fard, fn), 'rb').read()).hexdigest()[:20]
        fkeys[fn[:-4]] = fk
        dst = os.path.join(CC, 'far_src', fk + '.glb')
        if not os.path.exists(dst) and not done_(fk):   # (2026-10-15: an import's source only while it waits to be imported; far_src is scratch)
            tmp = dst + f'.{os.getpid()}.tmp'; shutil.copyfile(os.path.join(fard, fn), tmp); os.replace(tmp, dst)
    S['cf_imported_new'] = claimed(set(fkeys.values()), 'far_imp', done_,
                                   lambda ks: _imp_levels(ks, CF_ROOT, os.path.join(CC, 'far_src'), os.path.join(CC, 'far_imp'), os.path.join(CC, 'far_tmp'), logf, 'cf'),
                                   'far import')
    S['cf_import_s'] = round(time.time() - t, 1); t = time.time()
    # (NJCOVER2: a covered package is bound when its ground instances are on the current cover master too, bd_cover_mat.COVV:
    # a new cover master re-binds the covered packages, not the rest of the far city)
    covv = None
    if os.path.exists(os.path.join(HERE, 'bd_cover_mat.py')):
        import bd_cover_mat; covv = bd_cover_mat.COVV
    def _covered(fn):
        import struct
        with open(os.path.join(fard, fn + '.glb'), 'rb') as fh:
            h = fh.read(20); return b'lod16BdGroundCv' in fh.read(struct.unpack('<I', h[12:16])[0])
    cov_fk = {fk for fn, fk in fkeys.items() if covv is not None and _covered(fn)}
    def bound(fk):
        j = json.load(open(os.path.join(CC, 'far_imp', fk + '.json')))
        return j.get('mat') == msig and (fk not in cov_fk or j.get('cov') == covv)
    def bind_far(unbound):
        out = os.path.join(CC, 'far_tmp', f'mat_{os.getpid()}'); shutil.rmtree(out, ignore_errors=True)
        with editor_slot():
            code, _ = run(['python3', os.path.join(HERE, 'r1c_lodmat.py'), '--dest', ','.join(f'{CF_ROOT}/{fk}' for fk in unbound),
                           '--fw14', os.path.join(CELLCACHE, 'tex', 'daab9257ff80ba32fbedb2bd.png'), '--night', '0', '--wink', '3', '--out', out], logf + '.cfmat')
        if code or not os.path.exists(os.path.join(out, 'lodmat.json')): return
        if os.path.exists(os.path.join(HERE, 'bd_cover_mat.py')):   # (NJCOVER: the covered backdrop ground on its own duplicate master)
            with editor_slot():
                code, _ = run(['python3', os.path.join(HERE, 'bd_cover_mat.py'), '--dest', ','.join(f'{CF_ROOT}/{fk}' for fk in unbound), '--out', out + '_cov'], logf + '.cfcov')
            if code: return
        for fk in unbound:
            jp = os.path.join(CC, 'far_imp', fk + '.json'); j = json.load(open(jp)); j['mat'] = msig
            if fk in cov_fk: j['cov'] = covv
            json.dump(j, open(jp, 'w'))
    S['cf_bound_new'] = claimed(set(fkeys.values()), 'far_mat', bound, bind_far, 'far materials (see the bind log)')
    S['cf_mat_s'] = round(time.time() - t, 1)
    return fkeys


def cc_fix(I, dkey, cells, logf, S, rnd):
    """GB43: the cells of the pairs the gate counted, deduplicated once more against their partners' deduplicated results:
    each cell's first run saw its partners as packed, so two runs could each move a side onto the other (a NYCHA wall moved
    2 mm up, into the roof its neighbour's run had left 3 mm above it). Each result under its own key (the cell's key, its
    partners' keys, the round), in place of the cell's in this world's dkey."""
    P = I.get('_partners') or {}
    def one(k):
        nb = [n for n in P.get(k, []) if n in dkey]
        key = sha([dkey[k], sorted((n, dkey[n]) for n in nb), 'fix', rnd])[:20]
        out = os.path.join(CC, 'dd', key + '.glb')
        if os.path.exists(out): return k, key
        tmp = os.path.join(CC, 'tmp', f'fix_{key}_{os.getpid()}'); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
        for n in [k] + nb: shutil.copyfile(os.path.join(CC, 'dd', dkey[n] + '.glb'), os.path.join(tmp, n + '.glb'))
        for pass_ in (1, 2):
            code, _ = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_dedupe.py'), '--dir', tmp, '--out', os.path.join(tmp, f'dd{pass_}.json'), f'--keep={k}.glb', '--jobs', '2'],
                          os.path.join(tmp, 'dd.log'))
            if code: return k, None
        os.replace(os.path.join(tmp, k + '.glb'), out); shutil.rmtree(tmp, ignore_errors=True)
        return k, key
    t = time.time(); n = 0
    with ThreadPoolExecutor(int(os.environ.get('UE_CC_JOBS', '48'))) as ex:
        for k, key in ex.map(one, sorted(cells)):
            if key and key != dkey[k]: dkey[k] = key; n += 1
    S[f'fix{rnd}_cells'] = n; S[f'fix{rnd}_s'] = round(time.time() - t, 1)
    return n


CITYMODE = os.environ.get('UE_CITY') == '1'


def city_world(I):
    """GB43: a shot's world from the built city (city_build.py): its near cells' levels and tables, rounded out to whole 1 km
    blocks, and the far library's packages its frames asked for, made disjoint (city_cut); every one imported once"""
    import city_build as CB
    cm, fm = os.path.join(CB.CITY, 'cells.json'), os.path.join(CB.CITY, 'far.json')
    if not (os.path.exists(cm) and os.path.exists(fm)): return None, 'the city is not built (python3 tools/ue/city_build.py all)'
    cells = json.load(open(cm))['cells']; far = json.load(open(fm))['keys']
    blocks = json.load(open(cm)).get('blocks') or {}
    # (city v2: a near block with a package draws it, the cells' tables as ever; a block without one, its cells' levels)
    bk_ = lambda k: '%d_%d' % CB.block_of(k)
    import collections
    ncell, bnan = collections.Counter(bk_(k) for k in cells), {}
    def nanite_of(k):   # (the cell's Nanite meshes, from its import record; city v2: its share of its block package's)
        b_ = bk_(k)
        if b_ in blocks:
            if b_ not in bnan:
                try: bnan[b_] = int(json.load(open(os.path.join(CC, 'impb', blocks[b_]['key'] + '.json'))).get('nanite') or 0)
                except Exception: bnan[b_] = None
            if bnan[b_] is not None: return bnan[b_] / max(ncell[b_], 1)
        try: return int(json.load(open(os.path.join(CC, 'impu', cells[k]['key'] + '.json'))).get('nanite') or 0)
        except Exception: return 60
    reach_ = float(os.environ.get('UE_NEAR_M', '5000')); maxc_ = int(os.environ.get('UE_MAX_CELLS', '5000')); lodi_ = json.load(open(CB.LOD_INDEX))
    while True:   # (trailer12, 2026-10-23: a world of 6,554 cells (lfBroadway125 whole) crashed the take's render at its first frames, 'Attempt to create zero-sized buffer FRayTracingScene::SceneBuffer'; ue11's ranges of up to 5,104 cells rendered: the near reach shrinks until the cut holds at most UE_MAX_CELLS cells, the rest drawn by the far city)
        cut = CB.city_cut(I['loadset'], cells, far, lodi_, budget=NANITE_BUDGET, cost=nanite_of, reach=reach_ if blocks else None)
        if not blocks or len(cut['cells']) <= maxc_ or reach_ <= 1500: break
        log(f'city cut: {len(cut["cells"])} cells at a {reach_:.0f} m reach, over {maxc_}: the reach shrinks'); reach_ -= 250
    levels = list(dict.fromkeys(blocks[bk_(k)]['level'] if bk_(k) in blocks else cells[k]['level'] for k in cut['cells'])) + [f'{CF_ROOT}/{far[n]}/L' for n in cut['far']]
    levels = list(dict.fromkeys(levels))   # (GB43: two packages of one content share a level; a level added twice stops the take's editor)
    gone = [l for l in levels if not os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', l[len('/Game/'):] + '.umap'))]
    if gone: return None, f'{len(gone)} of the cut\'s levels are not in the project, e.g. {gone[:3]}'
    LS = json.load(open(I['loadset']))
    import numpy as np
    cams = np.array([[f['cam'][0], f['cam'][2]] for f in LS['frames'] if f.get('cam')] or [[0.0, 0.0]])
    def table(k):
        cx, cz = map(int, k.split('_')); c = np.array([(cx + 0.5) * 128.0, (cz + 0.5) * 128.0])
        lo = cells[k]['table'][:-5] + '.lo.vcel'
        far_ = float(np.sqrt(((cams - c) ** 2).sum(1)).min()) > LO_DIST
        return lo if far_ and os.path.exists(lo) else cells[k]['table']
    tables = [table(k) for k in cut['cells'] if os.path.exists(cells[k]['table'])]
    return {'status': 'ok', 'key': sha({'levels': levels, 'tables': tables})[:16], 'levels': levels, 'tables': tables, 'cc': True, 'city': True,
            'far_night': 0, 'mat_tools': mat_sig(), 'cells': len(cut['cells']), 'far': len(cut['far']), 'near_blocks': cut['near_blocks'],
            'stages': {'secs': 0}}, None


def build_world_cc(I, wkey, wdir, logf):
    """GB43: a world from the cell cache: its cells' levels (each built once by cc_cells), its far city masked under them,
    imported per world (small), the gate over everything it draws"""
    t0 = time.time(); S = {}
    os.makedirs(CC, exist_ok=True)
    # (no lock over the caches: each import and binding claims its key, cc_load and cf_far; packing and deduplication
    # write their results by content, atomically)
    try: dkey = cc_cells(I, logf, S)
    except RuntimeError as e: return None, f'cell cache: {e}'
    I['_stages'] = S
    uvd = os.path.join(wdir, 'cells_uv'); shutil.rmtree(uvd, ignore_errors=True); os.makedirs(uvd)
    for k, d in dkey.items(): os.symlink(os.path.join(CC, 'dd', d + '.glb'), os.path.join(uvd, k + '.glb'))
    far_src = os.path.join(wdir, 'far_src'); shutil.rmtree(far_src, ignore_errors=True); os.makedirs(far_src)
    water_src = os.path.join(wdir, 'water_src'); shutil.rmtree(water_src, ignore_errors=True); os.makedirs(water_src)
    jobs = []
    for k, rel in list(I['chunks'].items()) + [(f'LM_{k}', v) for k, v in I['landmarks'].items()]:
        f = os.path.join(UECACHE, 'plain', f"{rel.split('/')[-2]}.glb"); jobs.append([os.path.join(CELLCACHE, rel), f]); os.symlink(f, os.path.join(far_src, f'{k}.glb'))
    for k, rel in (I.get('water') or {}).items():
        f = os.path.join(UECACHE, 'plain', f"{rel.split('/')[-2]}.glb"); jobs.append([os.path.join(CELLCACHE, rel), f]); os.symlink(f, os.path.join(water_src, f'{k}.glb'))
    jp = os.path.join(wdir, 'decomp_jobs.json'); json.dump(jobs, open(jp, 'w'))
    code, S['decomp_s'] = run(['node', os.path.join(HERE, 'r1c_decomp.mjs'), jp], logf)
    if code: return None, 'decompress'
    fard = os.path.join(wdir, 'far'); shutil.rmtree(fard, ignore_errors=True)
    code, S['far_prep_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_lodprep.py'), '--loadset', I['loadset'], '--mask-dir', uvd, '--src', far_src, '--dst', fard,
                                                 '--water-src', water_src], logf)
    if code: return None, 'far prep'
    for rnd in range(3):   # (the gate; a failing pair's cells deduplicated once more against their partners' results, up to twice)
        code, S[f'dupgate{rnd or ""}_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_dupgate.py'), '--glb-dir', uvd, '--glb-dir', fard, '--night', '--out', os.path.join(wdir, 'dupgate')], logf)
        try: D_ = json.load(open(os.path.join(wdir, 'dupgate', 'dupgate.json')))
        except Exception: D_ = {}
        S[f'dupgate{rnd or ""}'] = {k: v for k, v in D_.items() if k in ('overlap_m2', 'pairs', 'twice_m2', 'worst_pair_m2', 'pass')}
        if not code or rnd == 2: break
        bad = {x[side]['file'][:-4] for x in (D_.get('top') or []) + (D_.get('top_twice') or []) for side in ('a', 'b')} & set(dkey)
        if not bad or not cc_fix(I, dkey, bad, logf, S, rnd + 1): break
        for k in bad:
            lp = os.path.join(uvd, k + '.glb'); os.remove(lp); os.symlink(os.path.join(CC, 'dd', dkey[k] + '.glb'), lp)
    if code: return None, f'dupgate (overlapping surfaces: {os.path.join(wdir, "dupgate", "dupgate.json")})'
    try: cc_load(dkey, logf, S)
    except RuntimeError as e: return None, f'cell cache: {e}'
    G = f'/Game/W/{wkey}'
    try: fkeys = cf_far(fard, logf, S)
    except RuntimeError as e: return None, f'far cache: {e}'
    levels = [f'{CCU_ROOT if KITCELLS else CC_ROOT}/{dkey[k]}/L' for k in sorted(dkey)] + [f'{CF_ROOT}/{fk}/L' for fk in sorted(set(fkeys.values()))]
    S['secs'] = round(time.time() - t0, 1)
    return {'status': 'ok', 'key': wkey, 'levels': levels, 'far_keys': sorted(set(fkeys.values())), 'far_night': 0, 'mat_tools': mat_sig(), 'cc': True,
            **({'tables': [os.path.join(CC, 'tables', dkey[k] + '.vcel') for k in sorted(dkey)]} if KITCELLS else {}),
            'cells': len(dkey), 'chunks': len(I['chunks']), 'landmarks': len(I['landmarks']), 'stages': S, 'made': time.ctime()}, None


def build_world(I, wkey, wdir, logf):
    """the persistent world: packages decompressed, cells packed, far city masked, levels imported in parallel, materials"""
    t0 = time.time(); S = {}
    pl = plain_index()
    jobs, cells_src, far_src = [], os.path.join(wdir, 'cells_src'), os.path.join(wdir, 'far_src')
    for d in (cells_src, far_src): shutil.rmtree(d, ignore_errors=True); os.makedirs(d)
    for k, h in I['cells'].items():
        f = pl.get(h) or os.path.join(UECACHE, 'plain', f'{h}.glb')
        if f not in pl.values(): jobs.append([os.path.join(CELLCACHE, h, 'cell.glb'), f])
        os.symlink(f, os.path.join(cells_src, f'{k}.glb'))
    for k, rel in list(I['chunks'].items()) + [(f'LM_{k}', v) for k, v in I['landmarks'].items()]:
        h = rel.split('/')[-2]
        f = os.path.join(UECACHE, 'plain', f'{h}.glb')
        jobs.append([os.path.join(CELLCACHE, rel), f])
        os.symlink(f, os.path.join(far_src, f'{k}.glb'))
    # ==== R2B: the water of the L6 packages the load set does not draw
    water_src = os.path.join(wdir, 'water_src'); shutil.rmtree(water_src, ignore_errors=True); os.makedirs(water_src)
    for k, rel in (I.get('water') or {}).items():
        f = os.path.join(UECACHE, 'plain', f"{rel.split('/')[-2]}.glb")
        jobs.append([os.path.join(CELLCACHE, rel), f])
        os.symlink(f, os.path.join(water_src, f'{k}.glb'))
    # ==== end R2B
    jp = os.path.join(wdir, 'decomp_jobs.json'); json.dump(jobs, open(jp, 'w'))
    code, S['decomp_s'] = run(['node', os.path.join(HERE, 'r1c_decomp.mjs'), jp], logf)
    if code: return None, 'decompress'
    uvd = os.path.join(wdir, 'cells_uv'); shutil.rmtree(uvd, ignore_errors=True)
    code, S['pack_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_glbuv.py'), '--strip-images', '--src', cells_src, '--dst', uvd], logf)
    if code: return None, 'pack'
    # every surface once (the tile facades of buildings dressed in another cell) and none two in one plane
    # (twice: a layer moved off one surface can land on another's, and a cut piece can meet a wall the first pass did not
    # pair with it; the second pass sees the first's result)
    for pass_ in (1, 2):
        code, S[f'dedupe{pass_}_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_dedupe.py'), '--dir', uvd, '--out', os.path.join(wdir, f'dedupe{pass_}.json')], logf)
        if code: return None, 'dedupe'
    fard = os.path.join(wdir, 'far'); shutil.rmtree(fard, ignore_errors=True)
    code, S['far_prep_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_lodprep.py'), '--loadset', I['loadset'], '--mask-dir', uvd, '--src', far_src, '--dst', fard,
                                                 '--water-src', water_src], logf)   # (R2B: --water-src)
    if code: return None, 'far prep'
    # the gate: no surface drawn twice, no two in one plane, across every mesh the world will draw (night parts included)
    code, S['dupgate_s'] = run(uvpy('numpy') + [os.path.join(HERE, 'r1c_dupgate.py'), '--glb-dir', uvd, '--glb-dir', fard, '--night',
                                                '--out', os.path.join(wdir, 'dupgate')], logf)
    try: S['dupgate'] = {k: v for k, v in json.load(open(os.path.join(wdir, 'dupgate', 'dupgate.json'))).items() if k in ('overlap_m2', 'pairs', 'twice_m2', 'interior_m2', 'close_m2', 'pass')}
    except Exception: S['dupgate'] = None
    if code: return None, f'dupgate (overlapping surfaces: {os.path.join(wdir, "dupgate", "dupgate.json")})'
    keys = sorted(f for f in os.listdir(uvd) if f.endswith('.glb'))
    for b in range(BATCHES):
        bd = os.path.join(wdir, f'b{b}')
        if os.path.isdir(bd) and os.path.exists(os.path.join(wdir, f'imp_{b}', 'cells.json')): continue   # (kept with its import)
        shutil.rmtree(bd, ignore_errors=True); os.makedirs(bd)
    for i, f in enumerate(keys):
        d_ = os.path.join(wdir, f'b{i % BATCHES}', f)
        if not os.path.lexists(d_): os.symlink(os.path.join(uvd, f), d_)
    G = f'/Game/W/{wkey}'
    t = time.time(); procs = []
    def done(n, lvl, src=None):   # (an import that finished in an earlier, interrupted build is kept; the editor's exit code is not
        # the verdict: a commandlet exits 1 after any logged error, e.g. the cache server's 'insufficient storage' on a full disk)
        try:
            rp = os.path.join(wdir, n, 'cells.json')
            j = json.load(open(rp))
            cells = (j.get('import') or {}).get('cells') or {}
            # RG44: and only when it is newer than the packed cells it read (a world built again from new packages kept the
            # old imports: the facades' UV 0 restored in the packages never reached Unreal)
            if src and any(os.path.getmtime(g) > os.path.getmtime(rp) for g in glob.glob(os.path.join(src, '*.glb'))): return False
            return bool(cells) and all(c.get('ok') for c in cells.values()) and os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', lvl[len('/Game/'):] + '.umap'))
        except Exception: return False
    for b in range(BATCHES):
        if done(f'imp_{b}', f'{G}/L_cells_{b}', os.path.join(wdir, f'b{b}')): continue
        cmd = uvpy('numpy') + [os.path.join(HERE, 'r1c_cells.py'), '--cells', os.path.join(wdir, f'b{b}'), '--level', f'{G}/L_cells_{b}', '--dest', f'{G}/C{b}',
                               '--tree-from', TREES_FROM, '--out', os.path.join(wdir, f'imp_{b}')]
        procs.append(subprocess.Popen(cmd, stdout=open(logf + f'.b{b}', 'a'), stderr=subprocess.STDOUT, cwd=ROOT))
    if not done('imp_far', f'{G}/L_far', fard):
        procs.append(subprocess.Popen(uvpy('numpy') + [os.path.join(HERE, 'r1c_cells.py'), '--cells', fard, '--level', f'{G}/L_far', '--dest', f'{G}/F',
                                                       '--out', os.path.join(wdir, 'imp_far')], stdout=open(logf + '.far', 'a'), stderr=subprocess.STDOUT, cwd=ROOT))
    codes = [p.wait() for p in procs]
    S['import_s'] = round(time.time() - t, 1)
    for n, lvl in [(f'imp_{b}', f'{G}/L_cells_{b}') for b in range(BATCHES)] + [('imp_far', f'{G}/L_far')]:
        if not done(n, lvl): return None, f'import {n}'
    err = bind_materials(I['night'], G, wdir, S, logf)
    if err: return None, err
    S['secs'] = round(time.time() - t0, 1)
    W = {'status': 'ok', 'key': wkey, 'levels': [f'{G}/L_cells_{b}' for b in range(BATCHES)] + [f'{G}/L_far'], 'far_dest': f'{G}/F', 'far_night': I['night'],
         'mat_tools': mat_sig(),
         'cells': len(I['cells']), 'chunks': len(I['chunks']), 'landmarks': len(I['landmarks']), 'stages': S, 'made': time.ctime()}
    return W, None


def bind_materials(night, G, wdir, S, logf):
    """the world's materials: the cells' bound to lane A's textures by content hash, the far city's shell master"""
    # (GB43: the cells' binding and the far city's in two editors at once: neither reads the other's assets)
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(2) as ex:
        fc = ex.submit(run, ['python3', os.path.join(HERE, 'r1c_cellmat2.py'), '--world-dest', G, '--cells', os.path.join(wdir, 'cells_uv'),
                             '--out', os.path.join(wdir, 'mat')], logf + '.mat')   # (lane A exports the crown atlases and contact decals since 04:18)
        ff = ex.submit(run, ['python3', os.path.join(HERE, 'r1c_lodmat.py'), '--dest', f'{G}/F', '--fw14', os.path.join(CELLCACHE, 'tex', 'daab9257ff80ba32fbedb2bd.png'),
                             '--night', str(night), '--wink', '3', '--out', os.path.join(wdir, 'lodmat')], logf + '.lodmat')
        (code, S['materials_s']), (code_f, S['far_mat_s']) = fc.result(), ff.result()
    if code: return 'materials'
    if code_f: return 'far materials'
    # ==== BD40 (backdrop lane): the tiles' facades on their own master (the page's facade code), after the generic binding;
    # opt-in (BD_TILEFAC=1) until it is reviewed against three.js (docs/notes/r2-backdrop.md)
    if os.environ.get('BD_TILEFAC', '1') == '1':
      code, S['tilefac_s'] = run(['python3', os.path.join(HERE, 'bd_tilefac.py'), '--world-dest', G, '--records', os.path.join(wdir, 'mat', 'records.json'),
                                '--out', os.path.join(wdir, 'tilefac')], logf)
      if code: return 'facade materials'
    # ==== end BD40
    return None


def _tables_json(W, tdir):
    p = os.path.join(tdir, 'cell_tables.json'); json.dump(W['tables'], open(p, 'w')); return p


def take_no_peds(shot):
    f = os.path.join(UECACHE, 'takes_no_peds.txt')
    return os.path.exists(f) and shot in open(f).read().split()


TAKE_RANGE = None   # (speed, 2026-10-19: 'a-b' of the render: the take's pre-roll warms up before a, not before frame 0)


def build_take(I, W, tkey, tdir, settings, logf):
    """the take in one editor session: its level (a new map holding the world's levels), lane D's actor layers through
    ue_prep into a sublevel, their materials, the sequence with the pre-roll, the take's light pass, the manifest"""
    t0 = time.time(); S = {}
    shot = I['shot']; tag = f'_{tkey[:8]}'
    level = f'/Game/T/{shot}{tag}/L_take'
    usd = I['usd']
    # (S125, 2026-10-16: a shot named in ue_cache/takes_no_peds.txt is taken without its walkers: lfBroadway125's 15,000
    # walkers over 3,750 frames held its take's import over an hour for each of its frame ranges)
    peds = not take_no_peds(shot)
    layers = ','.join(os.path.join(usd, n) for n in (f'cam_{shot}.usda', f'mov_{shot}.usdc', f'peds_{shot}.usdc' if peds else '-', 'looks.usdc', 'geo.usdc') if os.path.exists(os.path.join(usd, n)))
    act = os.path.join(tdir, 'act')
    code, S['actors_light_s'] = run(uvpy('usd-core', 'numpy') + [os.path.join(HERE, 'r1c_actors.py'), '--norender', '--world-level', level, '--shot', shot, '--tag', tag,
                                                                '--new-level-with', ','.join(W['levels']), '--light-harvest', I['harvest'],
                                                                *(['--cell-tables', _tables_json(W, tdir)] if W.get('tables') else []),
                                                                '--template', os.path.join(usd, f'{shot}.usda'), '--layers', layers, '--run', settings, '--out', act,
                                                                *(['--frames', TAKE_RANGE] if TAKE_RANGE else [])], logf)
    side = os.path.join(act, 'prep', f'ue_{shot}.json')
    try: imp = json.load(open(os.path.join(act, 'act_import.json')))
    except Exception: imp = None
    if not imp or not os.path.exists(side) or imp.get('light_error'): return None, 'actors and light'
    try: S['prep_s'] = json.load(open(os.path.join(act, 'actors.json'))).get('prep_s')
    except Exception: pass
    for k_ in ('import_s', 'mat_s', 'seq_s', 'light_s', 'save_s', 'secs'): S['in_editor_' + k_] = imp.get(k_)
    man = os.path.join(SAVED, imp['mrq']['manifest'])
    keep = os.path.join(tdir, 'manifest.utxt'); shutil.copyfile(man, keep)
    S['secs'] = round(time.time() - t0, 1)
    return {'status': 'ok', 'key': tkey, 'level': level, 'manifest': keep, 'side': side, 'night': I['night'], 'stages': S, 'made': time.ctime()}, None


def patch_manifest(src, dst, rawdir, a, b, cvars=None):
    """the take's manifest for one render: its output folder and frame range (a..b inclusive), and the settings' cvars
    on the job (set or added: the take's key leaves them out)"""
    J = json.load(open(src))
    hit = 0
    def walk(o):
        nonlocal hit
        if isinstance(o, dict):
            if cvars and isinstance(o.get('CVars'), dict) and isinstance(o['CVars'].get('__Value'), list):
                L = o['CVars']['__Value']; have = {e['Name']['__Value']: e for e in L if isinstance(e, dict) and 'Name' in e}
                for k, v in cvars.items():
                    if k in have: have[k]['Value']['__Value'] = float(v); have[k]['bIsEnabled']['__Value'] = 1
                    else: L.append({'Name': {'__Type': 'StrProperty', '__Value': k}, 'Value': {'__Type': 'FloatProperty', '__Value': float(v)}, 'bIsEnabled': {'__Type': 'BoolProperty', '__Value': 1}})
            if 'OutputDirectory' in o and 'CustomEndFrame' in o:
                o['OutputDirectory']['__Value']['Path']['__Value'] = rawdir
                o['CustomEndFrame']['__Value'] = int(b) + 1
                o['CustomStartFrame'] = {'__Type': 'IntProperty', '__Value': int(a)}
                o['bUseCustomPlaybackRange'] = {'__Type': 'BoolProperty', '__Value': 1}
                hit += 1
            for v in o.values(): walk(v)
        elif isinstance(o, list):
            for v in o: walk(v)
    walk(J)
    json.dump(J, open(dst, 'w'), indent='\t')
    return hit


def main():
    # (no core dumps from anything this starts: a crashing Unreal editor wrote a 143 GB core to the root drive and filled
    # it, 2026-10-14; the hard limit too, or the editor raises its own)
    import resource; resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    ap = argparse.ArgumentParser(description='render a take in Unreal from its shot name (lane C)')
    ap.add_argument('shot'); ap.add_argument('--frames', default=None, help='a-b: frames a to b-1 (as tools/valdrada.mjs counts)')
    ap.add_argument('--out', default=os.path.join(ROOT, 'client', 'shots', 'valdrada', 'ue')); ap.add_argument('--gpu-pci', default='01')
    ap.add_argument('--rebuild-world', action='store_true'); ap.add_argument('--rebuild-take', action='store_true'); ap.add_argument('--keep-raw', action='store_true')
    ap.add_argument('--no-xgate', action='store_true', help='skip the cross-renderer gate')
    ap.add_argument('--settings', default=os.path.join(HERE, 'render_take.json'))
    ap.add_argument('--preset', default='', choices=('', 'cine', 'cine2', 'cine2c', 'cine2d', 'cine2e', 'cine2f', 'cine2g', 'cine2h', 'cine2t', 'pt'), help='cine: the trailer\'s cinematic settings (render_take_cine.json); pt: path traced (render_take_pt.json)')
    ap.add_argument('--group', default='', help='shots a,b,c whose load sets make one world (the union of their cells, chunks and landmarks): built once, every shot of the group renders in it')
    ap.add_argument('--prebuild', default='', help='GB43: shots a,b,c (the shot argument is ignored): the union of their cells through the cell cache in one pass (pack, dedupe, import, bind; up to BATCHES editors on large batches), so their renders find every cell built; nothing rendered')
    a = ap.parse_args()
    if a.prebuild:
        U, G = {}, {}
        for s_ in [x for x in a.prebuild.split(',') if x]:
            I_, err_ = inputs(s_)
            if err_: log('prebuild: skipped', s_, err_); continue
            U.update(I_['cells']); G.update(I_.get('index') or {})
        os.makedirs(os.path.join(UECACHE, 'runs'), exist_ok=True)
        rdir = os.path.join(UECACHE, 'runs', 'prebuild_' + time.strftime('%Y%m%d-%H%M%S')); os.makedirs(rdir); logf = os.path.join(rdir, 'render_take.log')
        S = {}; t0 = time.time(); log('prebuild:', len(U), 'cells of', len(a.prebuild.split(',')), 'shots')
        try:
            dkey = cc_cells({'cells': U, 'index': G}, logf, S); log('prebuild: deduplicated', S)
            cc_load(dkey, logf, S)
        except RuntimeError as e: log('prebuild failed:', e, '(log', logf + ')'); sys.exit(3)
        S['secs'] = round(time.time() - t0, 1); log('prebuild done', json.dumps(S)); json.dump(S, open(os.path.join(rdir, 'prebuild.json'), 'w'), indent=1)
        sys.exit(0)
    # the presets: their settings, their own frames root (client/shots/valdrada/ue_<preset>), their own takes (below)
    if a.preset:
        if a.settings == os.path.join(HERE, 'render_take.json'): a.settings = os.path.join(HERE, f'render_take_{a.preset}.json')
        if a.out == os.path.join(ROOT, 'client', 'shots', 'valdrada', 'ue'): a.out = os.path.join(ROOT, 'client', 'shots', 'valdrada', f'ue_{a.preset}')
    T0 = time.time()
    rec = {'shot': a.shot, 'started': time.ctime()}
    I, err = inputs(a.shot)
    if err: log('inputs:', err); sys.exit(2)
    if a.group: I = group_world(I, [x for x in a.group.split(',') if x])
    if a.frames:
        fa, fb = [int(x) for x in a.frames.split('-')]; fb = min(fb, I['frames']); tag = f'f{fa}-{fb}'
        globals()['TAKE_RANGE'] = f'{fa}-{fb - 1}'   # (speed: the take's pre-roll before this range)
    else:
        fa, fb, tag = 0, I['frames'], 'all'
    if fb <= fa: log('inputs: empty frame range'); sys.exit(2)
    outdir = os.path.join(a.out, tag, 'clips', a.shot)
    for d in ('worlds', 'takes', 'runs', 'plain', 'locks'): os.makedirs(os.path.join(UECACHE, d), exist_ok=True)
    # (S125, 2026-10-16: a range of frames is its own job, so one long shot renders in parts on several GPUs at once)
    lock = open(os.path.join(UECACHE, 'locks', f'{a.shot}.lock' if tag == 'all' else f'{a.shot}_{tag}.lock'), 'w'); fcntl.flock(lock, fcntl.LOCK_EX)
    runid = time.strftime('%Y%m%d-%H%M%S'); rdir = os.path.join(UECACHE, 'runs', f'{a.shot}_{runid}' if tag == 'all' else f'{a.shot}_{tag}_{runid}'); os.makedirs(rdir)
    logf = os.path.join(rdir, 'render_take.log')
    if CITYMODE and tag != 'all' and os.environ.get('UE_RANGE_WORLD', 'own') != 'shot':   # (a part's world is cut from its own frames: the near blocks and far chunks they draw; trailer12, 2026-10-22: UE_RANGE_WORLD=shot draws every range with the whole shot's world, no brightness seams at range boundaries)
        LS_ = json.load(open(I['loadset'])); fr_ = LS_['frames'][fa:fb]
        LS_['frames'] = fr_; u_ = set(c for f in fr_ for c in (f.get('cells') or []))
        LS_['union']['cells'] = sorted(u_); LS_['union']['cellsMissing'] = sorted(set(LS_['union'].get('cellsMissing') or []) & u_)
        I['loadset'] = os.path.join(rdir, 'loadset.json'); json.dump(LS_, open(I['loadset'], 'w'))
    if CITYMODE:   # (GB43: the shot's world is a cut of the built city, tools/ue/city_build.py: nothing packed, gated, masked or imported here)
        W, err = city_world(I)
        if err: log('city:', err); sys.exit(3)
        wkey = W['key']; rec.update(world_key=wkey, world='city', cells=W['cells'], far=W['far'], chunks=0, landmarks=0)
        wdir = os.path.join(UECACHE, 'worlds', wkey); os.makedirs(wdir, exist_ok=True); wj = os.path.join(wdir, 'world.json'); json.dump(W, open(wj, 'w'), indent=1)
        log('world', wkey, 'from the city:', W['cells'], 'cells,', W['far'], 'far packages')
    else:
        tools = {n: fsha(os.path.join(HERE, n)) for n in WORLD_TOOLS}
        wkey = sha({'cells': I['cells'], 'chunks': I['chunks'], 'landmarks': I['landmarks'], **({'water': I['water']} if I.get('water') else {}), 'tools': tools, 'trees': TREES_FROM, 'batches': BATCHES, **({'tilefac': 1} if os.environ.get('BD_TILEFAC') == '1' else {}), **({'kitcells': 1} if KITCELLS else {})})[:16]   # (R2B: the water)
        wdir = os.path.join(UECACHE, 'worlds', wkey); os.makedirs(wdir, exist_ok=True)
        rec.update(world_key=wkey, cells=len(I['cells']), cells_unbaked=len(I['missing']), chunks=len(I['chunks']), landmarks=len(I['landmarks']))
        wlock = open(os.path.join(UECACHE, 'locks', f'world_{wkey}.lock'), 'w'); fcntl.flock(wlock, fcntl.LOCK_EX)
        wj = os.path.join(wdir, 'world.json')
        W = json.load(open(wj)) if os.path.exists(wj) and not a.rebuild_world else None
        if W and W.get('status') == 'ok' and all(os.path.exists(os.path.join(EXPORT, 'ue_project', 'Content', l[len('/Game/'):] + '.umap')) for l in W['levels']):
            rec['world'] = 'reused'; log('world', wkey, 'reused')
            mt = mat_sig()
            if W.get('mat_tools') != mt:   # (the material tools changed: the world's materials are bound again, nothing re-imported)
                S_ = {}
                if W.get('cc'):   # (GB43: the cell cache binds the cells whose binding is older than the tools; the far city as before)
                    # (the world's own cell levels, not the keys the cache would make now: a newer dedupe makes others)
                    own = {l.split('/')[-2]: l.split('/')[-2] for l in W['levels'] if l.startswith(CC_ROOT + '/')}
                    try: cc_load(own, logf, S_); err = None
                    except RuntimeError as e: err = f'cell cache: {e}'
                    if not err:
                        try: cf_far(os.path.join(wdir, 'far'), logf, S_)
                        except RuntimeError as e: err = f'far cache: {e}'
                else: err = bind_materials(W.get('far_night', I['night']), f'/Game/W/{wkey}', wdir, S_, logf)
                if err: log('world materials failed at', err); sys.exit(3)
                W['mat_tools'] = mt; W.setdefault('stages', {})['rebind'] = S_; json.dump(W, open(wj, 'w'), indent=1); rec['world'] = 'reused, materials bound again'
        else:
            log('world', wkey, 'building:', len(I['cells']), 'cells,', len(I['chunks']), 'chunks,', len(I['landmarks']), 'landmarks')
            W, err = (build_world_cc if CC_ON else build_world)(I, wkey, wdir, logf)
            if err: log('world failed at', err, '(log', logf + ')'); json.dump({'status': 'failed', 'at': err, 'stages': I.get('_stages')}, open(wj, 'w')); sys.exit(3)
            json.dump(W, open(wj, 'w'), indent=1); rec['world'] = 'built'; rec['world_s'] = W['stages']['secs']
        fcntl.flock(wlock, fcntl.LOCK_UN)
    # the take
    usd_list = sorted((n, os.path.getsize(os.path.join(I['usd'], n))) for n in os.listdir(I['usd']) if os.path.isfile(os.path.join(I['usd'], n)))
    # a settings file other than render_take.json (a preset): the shot's exposure from its ev_shot, the settings written
    # once by content and in the take's key, so each preset's take (its manifest, its light) is its own
    xkey = {}
    if a.settings != os.path.join(HERE, 'render_take.json'):
        S_ = json.load(open(a.settings))
        if (S_.get('ev_shot') or {}).get(a.shot) is not None: S_['ev'] = float(S_['ev_shot'][a.shot])
        sk_ = sha(S_)[:16]
        os.makedirs(os.path.join(UECACHE, 'settings'), exist_ok=True)
        sp_ = os.path.join(UECACHE, 'settings', f'{sk_}.json')
        if not os.path.exists(sp_): json.dump(S_, open(sp_, 'w'), indent=1)
        # (FP18, 2026-10-22: the console variables and the notes are left out of the take's key: patch_manifest sets the
        # settings' cvars on the render's job, so a cvar-only variant reuses its preset's take, ~10 min an A/B, not ~45)
        a.settings = sp_; xkey = {'settings': sha({k: v for k, v in S_.items() if k not in ('cvars', 'cvars_shot') and not k.startswith('_')})[:16]}
    if take_no_peds(a.shot): xkey['nopeds'] = 1
    tkey = sha({**xkey, 'world': wkey, 'usd': I['usd'], 'usd_files': usd_list, 'harvest': I['harvest'], 'light': fsha(os.path.join(I['harvest'], 'light_static.json')),
                'tools': {n: fsha(os.path.join(HERE, n)) for n in TAKE_TOOLS}, 'export': {n: fsha(os.path.join(EXPORT, n)) for n in EXPORT_TOOLS}})[:16]
    tdir = os.path.join(UECACHE, 'takes', tkey); os.makedirs(tdir, exist_ok=True)
    tj = os.path.join(tdir, 'take.json')
    TK = json.load(open(tj)) if os.path.exists(tj) and not a.rebuild_take else None
    rec['take_key'] = tkey
    tlock = open(os.path.join(UECACHE, 'locks', f'take_{tkey}.lock'), 'w'); fcntl.flock(tlock, fcntl.LOCK_EX)   # (S125: parts of one shot)
    if not TK and os.path.exists(tj): TK = json.load(open(tj))
    cv_now = json.load(open(a.settings)).get('cvars') or {}
    # (a take built by a variant with a cvar this run's settings lack would carry it in its manifest: built again)
    # (stream06, 2026-10-26: a take's sequence reaches back only its warm-up before the first frame of the range it was
    # built for (TAKE_RANGE). render_c2 of mnFdrSchurz reused a take built for frames 60-60, so frame 0 had 4 warm-up
    # frames of camera-cut data instead of 64: Movie Render Queue warmed up 4 frames, captured while the world's
    # sublevels and meshes were still loading, and the towers drew in over the shot (window grids, roof slabs, no walls).
    # A take is reused only when the range it was built for starts at or before this render's first frame.)
    def take_start(T_):
        if 'range_start' in T_: return T_['range_start']
        try: return int((json.load(open(os.path.join(tdir, 'act', 'act_cfg.json'))).get('frames') or [0])[0])
        except Exception: return 0
    if TK and TK.get('status') == 'ok' and take_start(TK) > fa:
        log('take', tkey, f'was built for frames from {take_start(TK)}: its pre-roll does not reach frame {fa}; built again'); TK = None
    if TK and TK.get('status') == 'ok' and os.path.exists(TK['manifest']) and set(TK.get('cvars_built') or {}) <= set(cv_now):
        rec['take'] = 'reused'; log('take', tkey, 'reused')
    else:
        log('take', tkey, 'building (actors and light from', I['usd'] + ')')
        TK, err = build_take(I, W, tkey, tdir, a.settings, logf)
        if err: log('take failed at', err, '(log', logf + ')'); json.dump({'status': 'failed', 'at': err}, open(tj, 'w')); sys.exit(4)
        TK['cvars_built'] = cv_now; TK['range_start'] = int(TAKE_RANGE.split('-')[0]) if TAKE_RANGE else 0
        json.dump(TK, open(tj, 'w'), indent=1); rec['take'] = 'built'; rec['take_s'] = TK['stages']['secs']
    fcntl.flock(tlock, fcntl.LOCK_UN)
    # the far city's night windows follow the take (the world is shared by times of day); a cache world's far masters read
    # MPC_r1c.Night, which the take keys, so nothing is bound again for it
    if not W.get('cc') and W.get('far_night') != TK['night']:
        code, s_ = run(['python3', os.path.join(HERE, 'r1c_lodmat.py'), '--dest', W['far_dest'], '--fw14', os.path.join(CELLCACHE, 'tex', 'daab9257ff80ba32fbedb2bd.png'),
                        '--night', str(TK['night']), '--wink', '3', '--out', os.path.join(rdir, 'lodmat')], logf)
        if code == 0: W['far_night'] = TK['night']; json.dump(W, open(wj, 'w'), indent=1); rec['far_night_s'] = s_
    # the render
    raw = os.path.join(rdir, 'raw'); os.makedirs(raw)
    rel = f'MovieRenderPipeline/rt_{a.shot}_{runid}.utxt' if tag == 'all' else f'MovieRenderPipeline/rt_{a.shot}_{tag}_{runid}.utxt'
    # (stream06, 2026-10-26: a preset's cvars_shot, per-shot cvars over its cvars, e.g. pLibGold's Nanite detail; cvars
    # only, so the take is shared with the preset's other renders)
    S_cv = json.load(open(a.settings)); cv_ = dict(S_cv.get('cvars') or {}); cv_.update((S_cv.get('cvars_shot') or {}).get(a.shot) or {})
    if (S_cv.get('cvars_shot') or {}).get(a.shot): log('cvars for', a.shot + ':', json.dumps(S_cv['cvars_shot'][a.shot]))
    if not patch_manifest(TK['manifest'], os.path.join(SAVED, rel), raw, fa, fb - 1, cv_): log('render: the manifest has no output setting'); sys.exit(5)
    env = ue_env(); env['DRI_PRIME'] = f'pci-0000_{a.gpu_pci}_00_0'
    W_, H_ = json.load(open(a.settings)).get('res', '2560x1440').split('x')
    gl = open(os.path.join('/data0/projectnyc_aux/tmp/ue_gpu_locks', f'pci-0000_{a.gpu_pci}_00_0.lock'), 'a+')
    tw = time.time(); fcntl.flock(gl, fcntl.LOCK_EX); rec['gpu_wait_s'] = round(time.time() - tw, 1)
    gl.seek(0); gl.truncate(); gl.write(f'pid {os.getpid()} {time.ctime()} render_take {a.shot}'); gl.flush()
    # (GB43, 2026-10-14: the cvars sizing pools Unreal makes at start, given on the command line too: the Movie Render
    # Queue sets its cvars once the level is loaded, after Nanite's root pages were sized)
    startup_cvars = [f'-dpcvars={k}={cv_[k]}' for k in ('r.Nanite.Streaming.StreamingPoolSize',) if k in cv_]
    for attempt in (1, 2):
        for f in os.listdir(raw): os.remove(os.path.join(raw, f))
        t1 = time.time()
        code, secs = run([os.path.join(UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor'), PROJECT, 'MoviePipelineEntryMap', '-game', f'-MoviePipelineConfig={rel}',
                          '-RenderOffscreen', '-Unattended', '-NoSplash', '-NoLoadingScreen', '-nosound', '-windowed', f'-resx={W_}', f'-resy={H_}', '-graphicsadapter=0',
                          '-log', '-stdout', '-FullStdOutLogOutput', '-NoTextureStreaming', *startup_cvars], os.path.join(rdir, f'render_{attempt}.log'), env=env)
        for f in os.listdir(raw):   # (the path tracer's pass writes <frame>_PathTracer: the frames' converter reads FinalImage)
            if '_PathTracer' in f: os.replace(os.path.join(raw, f), os.path.join(raw, f.replace('_PathTracer', '_FinalImage')))
        fs = sorted(f for f in os.listdir(raw) if f.endswith('_FinalImage.png'))
        if code == 0 and len(fs) >= fb - fa: break
        log(f'render attempt {attempt} failed (exit {code}, {len(fs)} frames)')
    fcntl.flock(gl, fcntl.LOCK_UN); gl.close()
    rec['render_s'] = secs; rec['render_attempts'] = attempt
    try:   # (stream06: the warm-up Movie Render Queue actually ran; fewer than the preset's means a short pre-roll, see take_start)
        import re as re_
        m_ = re_.search(r'having (\d+) warm up frames', open(os.path.join(rdir, f'render_{attempt}.log'), errors='replace').read())
        if m_:
            rec['warmup_frames'] = int(m_.group(1)); want_ = int(json.load(open(a.settings)).get('warmup') or 0)
            if want_ and rec['warmup_frames'] < want_: log(f'WARNING: {rec["warmup_frames"]} warm-up frames, the preset asks {want_}: streaming may draw in during the shot')
    except Exception: pass
    ts = [os.path.getmtime(os.path.join(raw, f)) for f in fs]
    if len(fs) < fb - fa: log('render failed:', len(fs), 'of', fb - fa, 'frames'); json.dump(rec, open(os.path.join(rdir, 'take_ue.json'), 'w'), indent=1); sys.exit(5)
    dts = sorted(y - x for x, y in zip(ts, ts[1:]))
    rec.update(frames=len(fs), first_frame_s=round(ts[0] - t1, 1), mean_frame_s=round((ts[-1] - ts[0]) / max(len(ts) - 1, 1), 3), median_frame_s=round(dts[len(dts) // 2], 3) if dts else None)
    # the frames
    if os.path.isdir(outdir) and any(f.startswith('frame_') for f in os.listdir(outdir)):   # (a clip there before: moved aside, not overwritten)
        os.rename(outdir, f'{outdir}.prev-{runid}'); rec['prev_clip'] = f'{outdir}.prev-{runid}'
    os.makedirs(outdir, exist_ok=True)
    code, rec['frames_s'] = run(uvpy('numpy', 'pillow', 'OpenEXR') + [os.path.join(EXPORT, 'ue_frames.py'), '--raw', raw, '--out', outdir, '--side', TK['side'],
                                                                      '--res', f'{W_}x{H_}', '--quality', '95', '--t0', str(t1), '--json', os.path.join(rdir, 'frames.json')], logf)
    missing = [f for f in range(fa, fb) if not os.path.exists(os.path.join(outdir, f'frame_{f:05d}.jpg'))]
    # the cross-renderer gate: the same take's frames from three.js, compared on structure; the signs' letters must match
    # (r1c_xgate.py: the world's sign faces projected through the take's camera, kept where Unreal's depth sees them)
    xfail = False
    tclip = os.path.join(ROOT, 'client', 'shots', 'valdrada', 'three', tag, 'clips', a.shot)
    cam = os.path.join(I['harvest'], f'cam_{a.shot}.json')
    if not missing and os.path.isdir(tclip) and os.path.exists(cam) and not a.no_xgate:
        code_x, rec['xgate_s'] = run(uvpy('numpy', 'pillow') + [os.path.join(HERE, 'r1c_xgate.py'), '--three', tclip, '--ue', outdir, '--out', os.path.join(rdir, 'xgate'),
                                                                '--world', wdir, '--cam', cam], logf)
        try: rec['xgate'] = dict({k: v for k, v in json.load(open(os.path.join(rdir, 'xgate', 'xgate.json'))).items() if k in ('pass', 'failing', 'sign_tiles', 'sign_ncc_median')}, report=os.path.join(rdir, 'xgate'))
        except Exception: rec['xgate'] = {'error': f'exit {code_x}'}
        xfail = code_x == 3
    rec['missing'] = missing[:20]; rec['total_s'] = round(time.time() - T0, 1); rec['log'] = logf
    json.dump(rec, open(os.path.join(outdir, 'take_ue.json'), 'w'), indent=1); json.dump(rec, open(os.path.join(rdir, 'take_ue.json'), 'w'), indent=1)
    if not a.keep_raw: shutil.rmtree(raw, ignore_errors=True)
    print('RENDER_TAKE ' + json.dumps({k: v for k, v in rec.items() if k != 'missing'}), flush=True)
    if code or missing: log('frames failed:', len(missing), 'missing'); sys.exit(6)
    if xfail: log('cross-renderer gate failed: signs that do not match the three.js take (', os.path.join(rdir, 'xgate'), ')'); sys.exit(7)
    log('done:', len(fs), 'frames in', outdir)


if __name__ == '__main__':
    main()
