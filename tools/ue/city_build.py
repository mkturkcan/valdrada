#!/usr/bin/env python3
# The city build (docs/notes/ue-city-architecture.md): every cell of the city into Unreal once, by content, so a shot
# or a game session only references it. Stages, each resumable and keyed by content:
#   cells  every 128 m cell of the tile manifest's 512 m tiles (ue_cache/city/cells.txt; --region x0,z0,x1,z1 narrows it)
#   bake   the cells baked with the dresser as kit instances (bake.mjs --kitrec), one bake per GPU over a third each
#   build  the cells through the cache (render_take.py's cc_cells: pack, deduplicate), each cell checked once against
#          its partners' results (r1c_dedupe.py --check, cc/gate/<key>.json; a failing cell deduplicated once more, up to
#          twice), then the kit, the tables, the unique meshes and their materials (cc_load_kit); the city manifest
#   far    the far city's library: every chunk (L3 1 km to L6 8 km), each L6 square's water alone, every landmark, the
#          bridges in 1 km pieces, prepared once (r1c_lodprep.py's prep, unmasked) and imported once (cf_far)
#   bakes  the bakes again over the cells still unbaked until every cell is baked (the bake stage's supervisor)
#   all    the four in turn
#   run    cells' bakes in the background and the cells built as they become ready (bakes and building overlap), then far
# A shot's world is then a cut (city_cut): its near cells rounded out to whole 1 km blocks, and over the rest the far
# chunks its frames asked for, made disjoint (a chunk holding a near block gives way to its children).
#   python3 tools/ue/city_build.py <stage> [--region x0,z0,x1,z1] [--pages 6]
import argparse, json, math, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, '..', 'city'))
import pconf; pconf.apply()   # (CITY 2026-10-25: config/pipeline.json's flags as defaults; an env value that differs is logged)
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
CELLCACHE = '/data0/projectnyc_aux/cellcache'
CITY = os.environ.get('UE_CITY_DIR', '/data0/projectnyc_aux/ue_cache/city')   # (city v2: its own manifests, ue_cache/city_v2)
BAKE_NAME = os.environ.get('UE_BAKE_NAME', 'city')   # (city v2: its bakes' indexes apart from the first city's, cityv2_<i>)
CELL, BLOCK = 128.0, 1024.0
LOD_INDEX = os.path.join(CELLCACHE, 'lod16', 'index.json')   # (the far packages, all levels; decompressed once into ue_cache/plain)
PLAIN = '/data0/projectnyc_aux/ue_cache/plain'


def log(*a):
    line = f"[city {time.strftime('%T')}] " + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(os.path.join(CITY, 'build.log'), 'a') as f: f.write(line + '\n')


def block_of(k):
    cx, cz = map(int, k.split('_')); return (math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK))


def cells_stage(region, priority=None):
    m = json.load(open(os.path.join(ROOT, 'client', 'public', 'tiles', 'manifest.json')))
    T = m['tile']; per = int(T // CELL)
    out = []
    for tk in m['tiles']:
        tx, tz = map(int, tk.split('_'))
        for i in range(per):
            for j in range(per):
                cx, cz = tx * per + i, tz * per + j
                if region and not (region[0] <= cx * CELL < region[2] and region[1] <= cz * CELL < region[3]): continue
                out.append((cx, cz))
    out.sort(key=lambda c: (c[0] // 8, c[1] // 8, c))   # (by 1 km block: a bake's batches stay together)
    if priority:   # (the blocks some shots need, and a ring of blocks round them, first: those shots render while the rest builds)
        pb = set()
        for shot in priority:
            lp = os.path.join(CELLCACHE, 'takes', shot, 'loadset.json')
            if not os.path.exists(lp): continue
            u = json.load(open(lp))['union']
            for k in set(u.get('cells') or []) | set(u.get('cellsMissing') or []):
                bx, bz = block_of(k); pb |= {(bx + dx, bz + dz) for dx in (-1, 0, 1) for dz in (-1, 0, 1)}
        out.sort(key=lambda c: (0 if (c[0] // 8, c[1] // 8) in pb else 1, c[0] // 8, c[1] // 8, c))
        log('priority:', len(priority), 'shots,', len(pb), 'blocks,', sum(1 for c in out if (c[0] // 8, c[1] // 8) in pb), 'cells first')
    os.makedirs(CITY, exist_ok=True)
    open(os.path.join(CITY, 'cells.txt'), 'w').write('\n'.join(f'{a}_{b}' for a, b in out))
    log('cells:', len(out), 'of', len(m['tiles']), 'tiles')
    return [f'{a}_{b}' for a, b in out]


def bake_start(pages, cells=None):
    cells = cells or open(os.path.join(CITY, 'cells.txt')).read().split()
    n = 3
    chunks = [cells[j:j + 64] for j in range(0, len(cells), 64)]   # (the order dealt out in 64-cell chunks: each bake starts at the front)
    procs = []
    for i in range(n):
        part = [k for ch in chunks[i::n] for k in ch]
        pf = os.path.join(CITY, f'bake_{i}.txt'); open(pf, 'w').write('\n'.join(part))
        # (GB43, 2026-10-14: the GPU lock's guard ends its command at its own deadline, 100 minutes unless HARNESS_MAX_MIN
        # says otherwise, and so ended two bakes a fifth of the way through; a page the build's load kept from answering
        # for 4 minutes ended the third)
        env = dict(os.environ, GPU_LANE=str(21 + i), HARNESS_MAX_MIN='1440', GPU_MAX_HOLD_MIN='1440', PAGE_STALL_S='600')
        procs.append(subprocess.Popen(['node', 'tools/withgpu.mjs', f'{BAKE_NAME} bake {i}', '--', 'node', 'tools/cells/bake.mjs', '--cells', '@' + pf, '--name', f'{BAKE_NAME}_{i}',
                                       '--kitrec', '--pages', str(pages), '--maxmin', '1440'], cwd=ROOT, env=env,
                                      stdout=open(os.path.join(CITY, f'bake_{i}.log'), 'a'), stderr=subprocess.STDOUT))
    return procs


def bake_stage(pages, tries=12):
    """the bakes until every cell of cells.txt is baked: a bake that ends early is started again over the cells still
    unbaked (each cell's package is kept as it is written, so nothing is baked twice); gives up after three tries in a row
    that bake nothing"""
    cells = open(os.path.join(CITY, 'cells.txt')).read().split()
    idle = 0
    for t in range(tries):
        ix = city_index(); left = [k for k in cells if k not in ix]
        if not left: log('bakes: every cell is baked'); return True
        log(f'bakes: try {t + 1}, {len(left)} of {len(cells)} cells to bake')
        codes = [p.wait() for p in bake_start(pages, left)]
        ix = city_index(); n = sum(1 for k in left if k in ix)
        log('bake exits', codes, f'{n} cells baked')
        idle = 0 if n else idle + 1
        if idle >= 3: break
    return False


def city_index():
    """every baked city cell and its package (CITY 2026-10-25: from the cell registry, tools/city/registry.py, the one source
    of truth: the bakes' receipts are published into it by `city update` / `city registry publish`, and what an old-style
    driver still writes into baked.json or the cityv2_N receipts is absorbed on read; CITY_REGISTRY=0 reads the old files
    as before: GB43, baked.json with the bakes' indexes merged into it, later files winning (the rebake index trap))"""
    import registry as REG
    if REG.enabled():
        ix = REG.current_index()
        return {k: h for k, h in ix.items() if os.path.exists(os.path.join(CELLCACHE, h, 'cell.glb'))}
    bp = os.path.join(CITY, 'baked.json')
    try: ix = json.load(open(bp))
    except Exception: ix = {}
    was = dict(ix)
    for i in range(3):
        p = os.path.join(CELLCACHE, 'index', f'{BAKE_NAME}_{i}.json')
        try: ix.update({k: c['hash'] for k, c in json.load(open(p))['cells'].items()})
        except Exception: pass
    ix = {k: h for k, h in ix.items() if os.path.exists(os.path.join(CELLCACHE, h, 'cell.glb'))}
    if ix != was:
        tmp = bp + f'.{os.getpid()}'; json.dump(ix, open(tmp, 'w')); os.replace(tmp, bp)
    return ix


def built_cells(idx, M=None):
    """the manifest's cells built from their current package with the current packer (GB43, 2026-10-14: a cell built
    before a generator or packer change is built again: the first 976 cells were packed before the decompressor inlined
    the prototypes, so their deduplication never saw the dressed walls drawn from the kit, and kept tile facades under
    them)"""
    import render_take as R
    pt = R.cc_ptool(); M = M or manifest()
    return {k: e for k, e in M['cells'].items() if e.get('hash') == idx.get(k) and e.get('ptool') == pt}


def check_cells(R, I, dkey, full, logf, S, rnd):
    """each cell of dkey checked against its partners' results (full: every built cell's key; cc/gate/<key>.json, once per
    key); the failing cells"""
    import shutil
    from concurrent.futures import ThreadPoolExecutor
    gd = os.path.join(R.CC, 'gate'); os.makedirs(gd, exist_ok=True)
    P = I.get('_partners') or {}
    def one(k):
        out = os.path.join(gd, dkey[k] + '.json')
        if not os.path.exists(out):
            tmp = os.path.join(R.CC, 'tmp', f'chk_{dkey[k]}_{os.getpid()}'); shutil.rmtree(tmp, ignore_errors=True); os.makedirs(tmp)
            for n in [k] + [n for n in P.get(k, []) if n in full]: os.symlink(os.path.join(R.CC, 'dd', full[n] + '.glb'), os.path.join(tmp, n + '.glb'))
            code, _ = R.run(R.uvpy('numpy') + [os.path.join(HERE, 'r1c_dedupe.py'), '--dir', tmp, f'--keep={k}.glb', '--check', '--jobs', '1', '--out', out + '.tmp'],
                            os.path.join(tmp, 'chk.log'))
            lg = open(os.path.join(tmp, 'chk.log')).read()
            if code == 0 and not os.path.exists(out + '.tmp') and ('"keep": "empty"' in lg or '{"dropped": 0}' in lg):
                json.dump({'check': True, 'empty': True, 'cop_m2': 0.0, 'twice_m2': 0.0, 'worst_pair_m2': 0.0}, open(out + '.tmp', 'w'))   # (nothing of its own to check: a park, open water)
            if code or not os.path.exists(out + '.tmp'): return k, None
            os.replace(out + '.tmp', out); shutil.rmtree(tmp, ignore_errors=True)
        return k, json.load(open(out))
    t = time.time(); bad = set(); tot = 0.0
    with ThreadPoolExecutor(int(os.environ.get('UE_CC_JOBS', '96'))) as ex:
        for k, r in ex.map(one, sorted(dkey)):
            if r is None: bad.add(k); continue
            tot += r.get('cop_m2', 0) + r.get('twice_m2', 0)
            if r.get('worst_pair_m2', 0) > 5.0 or r.get('cop_m2', 0) + r.get('twice_m2', 0) > 2.0: bad.add(k)
    S[f'check{rnd}_s'] = round(time.time() - t, 1); S[f'check{rnd}_failing'] = len(bad); S[f'check{rnd}_m2'] = round(tot, 1)
    log(f'check {rnd}: {len(dkey)} cells, {len(bad)} failing, {tot:.1f} m2 in all, {S[f"check{rnd}_s"]} s')
    return bad


def manifest():
    p = os.path.join(CITY, 'cells.json')
    return json.load(open(p)) if os.path.exists(p) else {'cells': {}, 'rounds': []}


def build_cells(subset, index, force_blocks=None):
    """the cells of subset (cell -> package hash) through the cache, checked, tabled and imported; merged into the manifest"""
    os.environ.setdefault('UE_KITCELLS', '1')
    os.environ.setdefault('UE_DD_WORKERS', '1'); os.environ.setdefault('UE_CC_JOBS', '96')
    import render_take as R
    M = manifest()
    full = {k: c['key'] for k, c in M['cells'].items()}
    cur = built_cells(index, M)
    # (GB43, 2026-10-14: and the built cells within two rings of them: a cell built before a neighbour was baked was
    # deduplicated without it, and a cell's deduplication can change only its own surfaces, so a building the late
    # neighbour dressed stayed drawn twice under the earlier cell's tile facade (58 cells, 5,800 m2). Their key covers
    # their partners' packages, so only those a new partner reaches are deduplicated, checked and imported again.)
    ring2 = lambda k: [f'{int(k.split("_")[0]) + dx}_{int(k.split("_")[1]) + dz}' for dx in range(-2, 3) for dz in range(-2, 3) if dx or dz]
    extra = {} if R.V2 else {n: index[n] for k in subset for n in ring2(k) if n in cur and n not in subset}   # (city v2: no cell depends on another)
    I = {'cells': {**subset, **extra}, 'index': index}
    logf = os.path.join(CITY, 'build_render_take.log'); S = {}
    t0 = time.time()
    log('build:', len(subset), 'cells and', len(extra), 'built neighbours')
    dkey = R.cc_cells(I, logf, S) if I['cells'] else {}
    full.update(dkey)
    log('packed and deduplicated', {k: v for k, v in S.items()})
    for rnd in range(0 if R.V2 else 3):   # (city v2: no overlap pass, nothing to check against)
        bad = check_cells(R, I, dkey, full, logf, S, rnd)
        if not bad or rnd == 2: break
        R.cc_fix(I, full, bad, logf, S, rnd + 1)
        for k in dkey: dkey[k] = full[k]
    R.cc_load_kit(dkey, logf, S)
    if R.V2_BLOCKS:   # (city v2: every block these cells touch, with all its built cells, merged and imported once)
        M0 = manifest(); allk = {k: c['key'] for k, c in M0['cells'].items()}; allk.update(dkey)
        blocks = {block_of(k) for k in dkey} | {tuple(b) for b in (force_blocks or ())}
        # (2026-10-29: a block is merged from its cells' unique-mesh packages (cc/ddu); one cleared from the cache was
        # skipped without a word, and 7,085 built cells were missing from 202 blocks (Brooklyn behind the Brooklyn Bridge
        # a void). A built cell with something drawn whose package is gone is made again from its baked package first)
        import registry as REG
        gone = {k: index[k] for k, d in allk.items() if block_of(k) in blocks and k not in dkey and k in index
                and not os.path.exists(os.path.join(R.CC, 'ddu', d + '.glb')) and ((REG.meta_of(index[k]) or {}).get('stats') or {}).get('tris', 1) > 0}
        if gone:
            log('build: remaking', len(gone), 'built cells of these blocks whose packages were cleared')
            dk2 = R.cc_cells({'cells': gone, 'index': index}, logf, S); R.cc_load_kit(dk2, logf, S)
            allk.update(dk2); dkey.update(dk2); I['cells'].update(gone); S['remade'] = len(dk2)
        miss = [k for k, d in allk.items() if block_of(k) in blocks and k in gone and not os.path.exists(os.path.join(R.CC, 'ddu', d + '.glb'))]
        if miss: raise RuntimeError(f'build: {len(miss)} cells of these blocks have no package after remaking, e.g. {miss[:3]}')
        bk = R.cc_blocks({k: d for k, d in allk.items() if block_of(k) in blocks}, logf, S, force={'%d_%d' % b for b in (force_blocks or ())})
    S['secs'] = round(time.time() - t0, 1)
    import registry as REG
    with REG.file_lock(os.path.join(CITY, 'cells.json.lock')):   # (CITY: two builds merging at once lost each other's cells)
        _merge_manifest(dkey, extra, I, S, bk if R.V2_BLOCKS else None, R)
    log('build done', len(dkey), 'cells,', json.dumps(S))


def _merge_manifest(dkey, extra, I, S, bk, R):
    M = manifest()   # (read again: merged, never overwritten)
    if bk is not None:
        for b, d in bk.items(): M.setdefault('blocks', {})[f'{b[0]}_{b[1]}'] = {'key': d, 'level': f'{R.CCB_ROOT}/{d}/L'}
    S['rebuilt'] = sum(1 for k in extra if M['cells'][k]['key'] != dkey.get(k))
    for k, d in dkey.items():
        gp = os.path.join(R.CC, 'gate', d + '.json')
        r = json.load(open(gp)) if os.path.exists(gp) else {}
        M['cells'][k] = {'key': d, 'level': f'{R.CCV_ROOT if R.V2 else R.CCU_ROOT}/{d}/L', 'table': os.path.join(R.CC, 'tables', d + '.vcel'),
                         'hash': I['cells'][k], 'ptool': R.cc_ptool(),
                         'check': {x: r.get(x) for x in ('cop_m2', 'twice_m2', 'worst_pair_m2')}}
    M.setdefault('rounds', []).append({'made': time.ctime(), 'cells': len(dkey), 'stages': S}); M['made'] = time.ctime()
    tmp = os.path.join(CITY, f'cells.json.{os.getpid()}.tmp'); json.dump(M, open(tmp, 'w')); os.replace(tmp, os.path.join(CITY, 'cells.json'))


def build_stage():
    cells = city_index()
    built = set(built_cells(cells))
    todo = {k: h for k, h in cells.items() if k not in built}
    if todo: build_cells(todo, cells)
    else: log('build: every baked cell is built')


def R_V2():
    return os.environ.get('UE_V2') == '1'


def run_stage(pages, batch=400, cap=3000):
    """the bakes in the background and the cells built as they become ready: a cell whose two rings of neighbours are all
    baked (or outside the city) is deduplicated with every partner it will have, so the bakes (GPUs) and the building
    (CPUs, editors) overlap. A round takes at most `cap` cells, in cells.txt's order (the priority shots' blocks first)."""
    cells = open(os.path.join(CITY, 'cells.txt')).read().split()
    citys = set(cells); order = {k: i for i, k in enumerate(cells)}
    # (the bakes' supervisor, its own process; then this one's niceness raised so the deduplication and the editors it
    # starts yield to the bakes' pages, which a loaded machine kept from answering)
    # (a supervisor already running, from a run stopped between its rounds, is kept: a second would bake beside it)
    sup = None
    for d in os.listdir('/proc'):
        try: cl = open(f'/proc/{d}/cmdline', 'rb').read().split(b'\0')
        except Exception: continue
        if d.isdigit() and int(d) != os.getpid() and any(x.endswith(b'city_build.py') for x in cl) and b'bakes' in cl: sup = int(d)
    if sup: log('run: the bakes\' supervisor', sup, 'is running; kept')
    else:
        sup = subprocess.Popen([sys.executable, os.path.abspath(__file__), 'bakes', '--pages', str(pages)], cwd=ROOT,
                               stdout=open(os.path.join(CITY, 'bakes.log'), 'a'), stderr=subprocess.STDOUT).pid
    def alive(pid):
        try: os.waitpid(pid, os.WNOHANG)
        except ChildProcessError: pass
        try: os.kill(pid, 0); return open(f'/proc/{pid}/stat').read().split()[2] != 'Z'
        except Exception: return False
    os.nice(8)
    ring = lambda k: [f'{int(k.split("_")[0]) + dx}_{int(k.split("_")[1]) + dz}' for dx in range(-2, 3) for dz in range(-2, 3) if dx or dz]
    while True:
        baking = alive(sup)
        idx = city_index(); built = set(built_cells(idx)) | empty_cells(idx)   # (an empty cell is done: the run spun on 237 of them, 2026-10-15)
        ready = {k: h for k, h in idx.items() if k not in built and (not baking or all(n not in citys or n in idx for n in ring(k)))}
        if R_V2() and baking:   # (city v2: no partners, so a block is ready when all of its city cells are baked)
            byb = {}
            for k in cells: byb.setdefault(block_of(k), []).append(k)
            ready = {k: h for k, h in idx.items() if k not in built and all(n in idx for n in byb.get(block_of(k), []))}
        if ready and (len(ready) >= batch or not baking):
            build_cells(dict(sorted(ready.items(), key=lambda kv: order.get(kv[0], len(order)))[:cap]), idx); continue
        if not baking:
            log('run: the bakes are done and every baked cell is built'); return
        time.sleep(120)


def empty_cells(idx):
    """the baked cells whose pack holds nothing to draw (pack/<key>.empty): done, never built"""
    import render_take as R
    ptool, out = R.cc_ptool(), set()
    for k, h in idx.items():
        try: cs = open(os.path.join(CELLCACHE, h, 'content.sha')).read().strip()
        except Exception: continue
        if os.path.exists(os.path.join(R.CC, 'pack', R.sha([cs, ptool])[:20] + '.empty')): out.add(k)
    return out


# NJCOVER2 (2026-10-26): the far library records the UE_FAR_* flags each package was prepared with (farlib/prep_flags.json),
# and a package prepared with other flags is prepared again. far_stage had prepared only missing files, so a driver that
# re-prepared the library without a flag (FARMK, 2026-10-24 20:56, without UE_FAR_COVER) left the city on those packages
# for good: 244 covered L3/L4 and edge packages, the Palisades among them, went back to their bare precover form.
FAR_FLAGS = 'prep_flags.json'


def far_flags():
    """the flags a far package's preparation reads (r1c_lodprep.prep, bd_cover): every UE_FAR_* value, and its sha"""
    import hashlib
    # (a file flag by its content: the same config from another worktree is the same flag, an edited table is a new one)
    fv = lambda v: 'file:' + hashlib.sha256(open(v, 'rb').read()).hexdigest()[:16] if os.path.isfile(v) else v
    f = {k: fv(v) for k, v in sorted(os.environ.items()) if k.startswith('UE_FAR_')}
    if f.get('UE_FAR_COVER') == '1':   # (bd_cover's own version: a change to the cover prepares the library again)
        import bd_cover; f['bd_cover'] = str(bd_cover.VERSION)
    return f, hashlib.sha256(json.dumps(f, sort_keys=True).encode()).hexdigest()[:16]


def _glb_json(path):
    import struct
    with open(path, 'rb') as fh:
        h = fh.read(20); return json.loads(fh.read(struct.unpack('<I', h[12:16])[0]))


def _cover_missing(path):
    """an unrecorded package (before the record existed) that bd_cover would cover but that holds no cover"""
    import bd_cover
    J = _glb_json(path)
    if any(m.get('name', '').startswith('lod16BdGroundCv') for m in J.get('materials') or []): return False
    root = J['nodes'][J['scenes'][0]['nodes'][0]]; org = root.get('translation') or [0, 0, 0]
    for i in root.get('children') or []:
        n = J['nodes'][i]
        if n.get('name') != 'bdGround' or 'mesh' not in n or not (n.get('extras') or {}).get('backdrop'): continue
        if int((n.get('extras') or {}).get('level') or 0) not in bd_cover.LV: return False
        a = J['accessors'][J['meshes'][n['mesh']]['primitives'][0]['attributes']['POSITION']]
        if 'min' not in a: return True
        return bool(bd_cover.covered([a['min'][0] + org[0], a['max'][0] + org[0], a['min'][2] + org[2], a['max'][2] + org[2]]))
    return False


FAR_FLAGS_META = 'prep_flags_meta.json'   # (sha -> {flags, commit}: which flags a record means and the commit that prepared with them)


def _head():
    try: return subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=ROOT, capture_output=True, text=True).stdout.strip() or None
    except Exception: return None


def _is_ancestor(a, b):
    r = subprocess.run(['git', 'merge-base', '--is-ancestor', a, b], cwd=ROOT, capture_output=True)
    return r.returncode == 0


def far_stale(lib=None):
    """the far packages prepared with other flags than the current ones: (names, record, sha). Direction-safe (2026-10-26:
    a lane seven commits behind integration, without UE_FAR_SHORE, took every shoreline package for stale and deleted
    them): a package recorded with flags this tree's config lacks, or prepared at a commit this tree does not contain, is
    newer than this run, so the run refuses (merge integration first) instead of preparing it again. 'pending' marks a
    package a far stage began to replace: always stale."""
    lib = lib or os.path.join(CITY, 'farlib')
    rec = json.load(open(os.path.join(lib, FAR_FLAGS))) if os.path.exists(os.path.join(lib, FAR_FLAGS)) else {}
    meta = json.load(open(os.path.join(lib, FAR_FLAGS_META))) if os.path.exists(os.path.join(lib, FAR_FLAGS_META)) else {}
    flags, sha = far_flags(); stale = []; newer = {}
    head = _head()
    for fn in sorted(os.listdir(lib)) if os.path.isdir(lib) else []:
        if not fn.endswith('.glb'): continue
        n = fn[:-4]; r = rec.get(n)
        if r is None:   # (prepared before the record: the cover is the one flag a package shows; the others are taken as current)
            if flags.get('UE_FAR_COVER') == '1' and _cover_missing(os.path.join(lib, fn)): stale.append(n)
            else: rec[n] = sha
        elif r == 'pending': stale.append(n)
        elif r != sha:
            m = meta.get(r)
            if m:
                lacks = sorted(set(m.get('flags') or {}) - set(flags))
                behind = m.get('commit') and head and not _is_ancestor(m['commit'], head)
                if lacks or behind: newer.setdefault(r, (lacks, m.get('commit'), 0)); newer[r] = (lacks, m.get('commit'), newer[r][2] + 1); continue
            stale.append(n)
    if newer:
        raise RuntimeError('far library: packages were prepared by a newer config than this tree\'s (' + '; '.join(
            f"{c} packages: flags {l or '(same keys)'} at commit {str(cm)[:9]}" for _, (l, cm, c) in newer.items()) +
            f'); this tree ({str(head)[:9]}) would undo them. Merge integration into it first.')
    return stale, rec, sha


def _save_far_record(lib, rec, sha=None, flags=None):
    tmp = os.path.join(lib, FAR_FLAGS + f'.{os.getpid()}'); json.dump(rec, open(tmp, 'w'), indent=0, sort_keys=True); os.replace(tmp, os.path.join(lib, FAR_FLAGS))
    if sha:
        mp = os.path.join(lib, FAR_FLAGS_META); meta = json.load(open(mp)) if os.path.exists(mp) else {}
        meta.setdefault(sha, {'flags': flags, 'commit': _head()})
        json.dump(meta, open(mp + f'.{os.getpid()}', 'w'), indent=1, sort_keys=True); os.replace(mp + f'.{os.getpid()}', mp)


def far_stage():
    import render_take as R
    from r1c_lodprep import prep
    ix = json.load(open(LOD_INDEX))
    lib = os.path.join(CITY, 'farlib'); os.makedirs(lib, exist_ok=True)
    stale, rec, sha = far_stale(lib)
    flags = far_flags()[0]
    if stale:
        log('far library:', len(stale), 'packages prepared with other UE_FAR_* flags, prepared again, e.g.', stale[:6])
        # (marked pending in the record before any file goes: a stage stopped half way leaves them stale, never current)
        for n in stale: rec[n] = 'pending'
        _save_far_record(lib, rec)
        for n in stale:
            os.remove(os.path.join(lib, n + '.glb')); rec.pop(n, None)
            if os.path.exists(os.path.join(lib, n + '.glb.empty')): os.remove(os.path.join(lib, n + '.glb.empty'))
    # (every package decompressed once, by its hash, as the worlds' far city was: r1c_decomp.mjs)
    srcs = {k: e['file'] for k, e in ix['chunks'].items()}
    srcs.update({f'LM_{k}': e['file'] for k, e in (ix.get('landmarks') or {}).items() if e.get('file')})
    plain = {k: os.path.join(PLAIN, f"{f.split('/')[0]}.glb") for k, f in srcs.items()}
    jobs = [[os.path.join(CELLCACHE, 'lod16', f), plain[k]] for k, f in srcs.items() if not os.path.exists(plain[k])]
    if jobs:
        jp = os.path.join(CITY, 'far_decomp.json'); json.dump(jobs, open(jp, 'w'))
        subprocess.check_call(['node', os.path.join(HERE, 'r1c_decomp.mjs'), jp], stdout=subprocess.DEVNULL)
    made = 0
    for k in sorted(ix['chunks']):
        src, dst = plain[k], os.path.join(lib, f'{k}.glb')
        if os.path.exists(src) and not os.path.exists(dst): prep(src, dst, None); made += 1
        if k.startswith('L6_') and os.path.exists(src) and not os.path.exists(os.path.join(lib, f'W_{k}.glb')):
            prep(src, os.path.join(lib, f'W_{k}.glb'), None, only={'water'})
    for k, e in sorted((ix.get('landmarks') or {}).items()):
        src = plain.get(f'LM_{k}')
        if not src or not os.path.exists(src): continue
        b = e.get('bounds')
        if (e.get('kind') == 'bridge' or e.get('drawnBy') == 'bridgeKit') and b:
            # (a bridge in 1 km pieces: a piece holds the triangles whose centroid lies in its block)
            cx0, cx1 = math.floor(b[0] / CELL), math.floor(b[3] / CELL); cz0, cz1 = math.floor(b[2] / CELL), math.floor(b[5] / CELL)
            allc = {(cx, cz) for cx in range(cx0, cx1 + 1) for cz in range(cz0, cz1 + 1)}
            blocks = {(math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK)) for cx, cz in allc}
            for bx, bz in sorted(blocks):
                dst = os.path.join(lib, f'LMB_{k}_{bx}_{bz}.glb')
                if os.path.exists(dst): continue
                mask = {cx * 100000 + cz for cx, cz in allc if (math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK)) != (bx, bz)}
                r = prep(src, dst, mask)
                if not r or not r.get('tris_out'):
                    if os.path.exists(dst): os.replace(dst, dst + '.empty')
        else:
            dst = os.path.join(lib, f'LM_{k}.glb')
            if not os.path.exists(dst): prep(src, dst, None)
    made += edge_packages(ix, lib)
    made += block_packages(ix, lib)
    made += ground_packages(ix, lib)
    log('far library prepared,', made, 'new chunks;', len([f for f in os.listdir(lib) if f.endswith('.glb')]), 'packages')
    rec.update({fn[:-4]: sha for fn in os.listdir(lib) if fn.endswith('.glb') and rec.get(fn[:-4]) in (None, 'pending')})   # (made now, with these flags)
    _save_far_record(lib, rec, sha, flags)
    S = {}; logf = os.path.join(CITY, 'far_render_take.log')
    fkeys = R.cf_far(lib, logf, S)
    json.dump({'made': time.ctime(), 'stages': S, 'keys': fkeys}, open(os.path.join(CITY, 'far.json'), 'w'), indent=1)
    log('far done', json.dumps(S))


def ground_packages(ix, lib):
    """the city's far ground per block (GB_<bx>_<bz>; 2026-10-15): only the L6 chunks carry the city's ground, so a far block
    drawn by a finer chunk (L3-L5, B_) had its buildings over nothing, the streets and yards between them and the shore
    strips holes to the atmosphere's ground; the block's L6 ground cut to the block, drawn under every far city block an L6
    chunk does not draw whole"""
    from r1c_lodprep import prep
    import collections
    cityb = collections.Counter(block_of(k) for k in open(os.path.join(CITY, 'cells.txt')).read().split())
    n = 0
    for bx, bz in sorted(cityb):
        ck = f'L6_{bx // 8}_{bz // 8}'
        if ck not in ix['chunks']: continue
        src = os.path.join(PLAIN, f"{ix['chunks'][ck]['file'].split('/')[0]}.glb")
        dst = os.path.join(lib, f'GB_{bx}_{bz}.glb')
        if not os.path.exists(src) or os.path.exists(dst) or os.path.exists(dst + '.empty'): continue
        mine = {cx * 100000 + cz for cx in range(bx * 8, bx * 8 + 8) for cz in range(bz * 8, bz * 8 + 8)}
        r = prep(src, dst, None, {'ground'}, mask_backdrop=True, keep=mine)
        if not r or not r.get('tris_out'): os.replace(dst, dst + '.empty')
        else: n += 1
    return n


def block_packages(ix, lib):
    """the far blocks with no L3 of their own, each as its L4 chunk cut to the block (B_<bx>_<bz>; 2026-10-15): city_cut
    refines a far square that overlaps the near blocks down to its children, and where a block had no L3 it drew nothing,
    a hole through to the atmosphere's ground along the Harlem River and the South Bronx in the long aerial; every block of
    an L4 chunk that touches the city, prepared once and imported once with the far library"""
    from r1c_lodprep import prep
    import collections
    cityb = collections.Counter(block_of(k) for k in open(os.path.join(CITY, 'cells.txt')).read().split())
    l4 = {(bx // 2, bz // 2) for bx, bz in cityb}
    n = 0
    for i4, j4 in sorted(l4):
        ck = f'L4_{i4}_{j4}'
        if ck not in ix['chunks']: continue
        src = os.path.join(PLAIN, f"{ix['chunks'][ck]['file'].split('/')[0]}.glb")
        if not os.path.exists(src): continue
        for bx in (2 * i4, 2 * i4 + 1):
            for bz in (2 * j4, 2 * j4 + 1):
                if f'L3_{bx}_{bz}' in ix['chunks']: continue
                dst = os.path.join(lib, f'B_{bx}_{bz}.glb')
                if os.path.exists(dst) or os.path.exists(dst + '.empty'): continue
                mine = {cx * 100000 + cz for cx in range(bx * 8, bx * 8 + 8) for cz in range(bz * 8, bz * 8 + 8)}
                r = prep(src, dst, None, None, mask_backdrop=True, keep=mine)
                if not r or not r.get('tris_out'): os.replace(dst, dst + '.empty')
                else: n += 1
    return n


def edge_packages(ix, lib):
    """the city's edge blocks, each as one package (GB43, 2026-10-14): a 1 km block only partly in the city (the New Jersey
    shore, open water: 191 of 975) drawn by cells left a hole where the city has no cells, the far chunk it replaced
    gone. R_<bx>_<bz>: the block's finest far chunk less the city's cells and less all outside the block (its water
    too, the L6 squares' water is drawn whole), prepared once and imported once with the far library"""
    from r1c_lodprep import prep
    import collections
    per = collections.defaultdict(set)
    for k in open(os.path.join(CITY, 'cells.txt')).read().split():
        cx, cz = map(int, k.split('_')); per[block_of(k)].add(cx * 100000 + cz)
    # (the landing cells, ue_cache/city/landing.txt: cells outside the city added for a bridge's landing (the George
    # Washington Bridge's in New Jersey); they hold the bridge and its landing patches, not the ground, so the edge
    # package keeps the backdrop under them)
    lp = os.path.join(CITY, 'landing.txt')
    land = {int(k.split('_')[0]) * 100000 + int(k.split('_')[1]) for k in (open(lp).read().split() if os.path.exists(lp) else [])}
    n = 0
    for (bx, bz), ks in sorted(per.items()):
        if len(ks) >= 64: continue
        dst = os.path.join(lib, f'R_{bx}_{bz}.glb')
        if os.path.exists(dst) or os.path.exists(dst + '.empty'): continue
        for L in (3, 4, 5, 6):
            s_ = 2 ** (L - 3); ck = f'L{L}_{bx // s_}_{bz // s_}'
            if ck in ix['chunks']: break
        else: continue
        src = os.path.join(PLAIN, f"{ix['chunks'][ck]['file'].split('/')[0]}.glb")
        if not os.path.exists(src): continue
        x0, z0 = (bx // s_) * s_ * 8, (bz // s_) * s_ * 8
        allc = {cx * 100000 + cz for cx in range(x0, x0 + s_ * 8) for cz in range(z0, z0 + s_ * 8)}
        mine = {cx * 100000 + cz for cx in range(bx * 8, bx * 8 + 8) for cz in range(bz * 8, bz * 8 + 8)} - (ks - land)
        only = None
        if L == 6:   # (the L6 square's water is drawn whole as W_L6_*)
            import struct
            b = open(src, 'rb').read(); J = json.loads(b[20:20 + struct.unpack('<I', b[12:16])[0]])
            rt = J['nodes'][J['scenes'][0]['nodes'][0]]
            only = {J['nodes'][i].get('name') for i in rt.get('children', [])} - {'water'}
        r = prep(src, dst, None, only, mask_backdrop=True, keep=mine)   # (only the block's cells outside the city: a mask of the chunk's
        # square left triangles whose centre lay outside it in two blocks' packages alike)
        if not r or not r.get('tris_out'): os.replace(dst, dst + '.empty')
        else: n += 1
    # (and each bridge over an edge block, LMBR_<landmark>_<bx>_<bz>: its part over the block's cells outside the city;
    # the George Washington Bridge's span ended mid-river where its block was near and the cells hold Manhattan's half)
    for k, e in sorted((ix.get('landmarks') or {}).items()):
        b = e.get('bounds')
        if not b or not (e.get('kind') == 'bridge' or e.get('drawnBy') == 'bridgeKit') or not e.get('file'): continue
        src = os.path.join(PLAIN, f"{e['file'].split('/')[0]}.glb")
        if not os.path.exists(src): continue
        cx0, cx1 = math.floor(b[0] / CELL), math.floor(b[3] / CELL); cz0, cz1 = math.floor(b[2] / CELL), math.floor(b[5] / CELL)
        allc = {cx * 100000 + cz for cx in range(cx0, cx1 + 1) for cz in range(cz0, cz1 + 1)}
        for (bx, bz) in sorted({(math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK)) for cx in range(cx0, cx1 + 1) for cz in range(cz0, cz1 + 1)}):
            ks = per.get((bx, bz), set())
            if not ks or len(ks) >= 64: continue
            dst = os.path.join(lib, f'LMBR_{k}_{bx}_{bz}.glb')
            if os.path.exists(dst) or os.path.exists(dst + '.empty'): continue
            mine = {cx * 100000 + cz for cx in range(bx * 8, bx * 8 + 8) for cz in range(bz * 8, bz * 8 + 8)} - ks
            r = prep(src, dst, None, keep=mine)
            if not r or not r.get('tris_out'): os.replace(dst, dst + '.empty')
            else: n += 1
    return n


def city_cut(loadset, cells_man, far_man, lod_index, budget=None, cost=None, reach=None):
    """a shot's world from the city: its near cells (the load set's, rounded out to whole 1 km blocks, with the blocks under
    a landmark that touches them), and over the rest the far chunks its frames drew, made disjoint, with each L6 square's
    water where its L6 chunk is not drawn. Returns {'cells': [cell], 'far': [package names]}"""
    LS = json.load(open(loadset))
    want = set(LS['union'].get('cells') or []) | set(LS['union'].get('cellsMissing') or [])
    near = {block_of(k) for k in want}
    # (GB43, 2026-10-14: a block with no city cells (New Jersey, open water) stays far; a block partly in the city adds
    # its edge package, R_<bx>_<bz>, for the part the cells do not draw)
    import collections
    cityb = collections.Counter(block_of(k) for k in open(os.path.join(CITY, 'cells.txt')).read().split())
    near0 = set(near); near = {b for b in near if cityb.get(b)}
    if reach:   # (city v2, the re-shoot: every city block within `reach` m of a lens is near (render_take.py: UE_NEAR_M, 5 km), so an aerial draws whole blocks
        # to its horizon where the load set's cells stop at the page's own streaming radius; the budget below trims the farthest)
        import numpy as np
        cams_ = np.array([[f['cam'][0], f['cam'][2]] for f in LS['frames'] if f.get('cam')] or [[0.0, 0.0]])
        for b in cityb:
            x0, z0 = b[0] * BLOCK, b[1] * BLOCK
            dx = np.maximum(0, np.maximum(x0 - cams_[:, 0], cams_[:, 0] - (x0 + BLOCK)))
            dz = np.maximum(0, np.maximum(z0 - cams_[:, 1], cams_[:, 1] - (z0 + BLOCK)))
            if float(np.sqrt(dx * dx + dz * dz).min()) < reach: near.add(b)
    # (GB43, 2026-10-14: with a budget, the near blocks farthest from every lens position given to the far chunks until the
    # cells' Nanite meshes (cost) fit it: Unreal's Nanite root pages are capped (49,152 in a 2 GB pool on this hardware)
    # and the Midtown aerial's 896 cells held 60,111 meshes; never a block within 300 m of a lens)
    dropped = set()
    if budget and cost:
        import numpy as np
        cams = np.array([[f['cam'][0], f['cam'][2]] for f in LS['frames'] if f.get('cam')] or [[0.0, 0.0]])
        bc = collections.Counter()
        for k in cells_man:
            if block_of(k) in near: bc[block_of(k)] += cost(k)
        def dist(b):
            x0, z0 = b[0] * BLOCK, b[1] * BLOCK
            dx = np.maximum(0, np.maximum(x0 - cams[:, 0], cams[:, 0] - (x0 + BLOCK)))
            dz = np.maximum(0, np.maximum(z0 - cams[:, 1], cams[:, 1] - (z0 + BLOCK)))
            return float(np.sqrt(dx * dx + dz * dz).min())
        tot = sum(bc.values())
        for b in sorted(near, key=dist, reverse=True):
            if tot <= budget or dist(b) < 300: break
            near.discard(b); dropped.add(b); tot -= bc[b]
    lms = (lod_index.get('landmarks') or {})
    lm_draw = []
    for k, e in sorted(lms.items()):   # (every landmark: the persistent tier draws them all, the near cells those over them)
        b = e.get('bounds')
        if not b: continue
        if e.get('kind') == 'bridge' or e.get('drawnBy') == 'bridgeKit': continue
        bl = {(math.floor(x / BLOCK), math.floor(z / BLOCK)) for x in (b[0], b[3]) for z in (b[2], b[5])}
        cb = (math.floor((b[0] + b[3]) / 2 / BLOCK), math.floor((b[2] + b[5]) / 2 / BLOCK))
        if bl & near: near |= {b for b in bl if cityb.get(b)}   # (a landmark touching the near blocks: its blocks are near, the cells draw it)
        elif cb not in near: lm_draw.append(f'LM_{k}')
    edges = [f'R_{bx}_{bz}' for bx, bz in sorted(near) if cityb[(bx, bz)] < 64]
    edges += [n for n in far_man if n.startswith('LMBR_') and (int(n.split('_')[-2]), int(n.split('_')[-1])) in near]
    cells = sorted(k for k in cells_man if block_of(k) in near)
    # the desired level per 1 km block: the finest chunk any frame drew over it
    desired = {}
    for f in LS['frames']:
        for ck in f['chunks']:
            L, i, j = ck.split('_'); L = int(L[1:]); i, j = int(i), int(j); s = 2 ** (L - 3)
            for bx in range(i * s, (i + 1) * s):
                for bz in range(j * s, (j + 1) * s):
                    if desired.get((bx, bz), 9) > L: desired[(bx, bz)] = L
    have = set(lod_index.get('chunks') or {})
    for b in dropped | (near0 - near):   # (a block the cells do not draw: its finest chunk, whether or not a frame asked for one)
        for L in (3, 4, 5, 6):
            s_ = 2 ** (L - 3)
            if f'L{L}_{b[0] // s_}_{b[1] // s_}' in have: desired[b] = min(desired.get(b, 9), L); break
    far = []; l6_whole = set()
    def cut(L, i, j):
        s = 2 ** (L - 3)
        bs = [(bx, bz) for bx in range(i * s, (i + 1) * s) for bz in range(j * s, (j + 1) * s)]
        wanted = [b for b in bs if b in desired and b not in near]
        if not wanted: return False
        if f'L{L}_{i}_{j}' in have and not any(b in near for b in bs) and min(desired[b] for b in wanted) >= L:
            far.append(f'L{L}_{i}_{j}')
            if L == 6: l6_whole.update(bs)
            return True
        if L == 3:   # (no L3 of this block, its parent overlapping near blocks: the block's L4 cut to it, B_<bx>_<bz>)
            if f'B_{i}_{j}' in far_man: far.append(f'B_{i}_{j}')
            return False
        for di in (0, 1):
            for dj in (0, 1): cut(L - 1, 2 * i + di, 2 * j + dj)
        return False
    roots = sorted({(math.floor(bx / 8), math.floor(bz / 8)) for bx, bz in desired})   # (an L6 square is 8 x 8 blocks)
    for i, j in roots:
        whole = cut(6, i, j)
        if not whole and f'W_L6_{i}_{j}' in far_man: far.append(f'W_L6_{i}_{j}')
    # (GB_: the city's ground under every far city block no whole L6 chunk draws: only L6 carries it)
    for b in sorted(set(desired) - near - l6_whole):
        if cityb.get(b) and f'GB_{b[0]}_{b[1]}' in far_man: far.append(f'GB_{b[0]}_{b[1]}')
    # bridges: their pieces over the blocks that are not near
    for name in far_man:
        if name.startswith('LMB_'):
            parts = name.split('_'); bx, bz = int(parts[-2]), int(parts[-1])
            if (bx, bz) not in near: far.append(name)
    far += [x for x in lm_draw if x in far_man] + edges
    return {'cells': cells, 'far': sorted(set(x for x in far if x in far_man)), 'near_blocks': len(near), 'dropped_blocks': len(dropped)}


def main():
    # (no core dumps from anything this starts: a crashing Unreal editor wrote a 143 GB core to the root drive and filled
    # it, 2026-10-14; the hard limit too, or the editor raises its own)
    import resource; resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    ap = argparse.ArgumentParser()
    ap.add_argument('stage', choices=('cells', 'bake', 'bakes', 'build', 'far', 'run', 'all'))
    ap.add_argument('--region', default=None); ap.add_argument('--pages', type=int, default=6)
    ap.add_argument('--priority', default=None, help='a,b,c: shots whose blocks are built first (cells stage)')
    a = ap.parse_args()
    os.makedirs(CITY, exist_ok=True)
    region = [float(v) for v in a.region.split(',')] if a.region else None
    if a.stage in ('cells', 'all'): cells_stage(region, [x for x in (a.priority or '').split(',') if x])
    if a.stage in ('bake', 'bakes', 'all') and not bake_stage(a.pages): sys.exit(3)
    if a.stage in ('build', 'all'): build_stage()
    if a.stage in ('far', 'all'): far_stage()
    if a.stage == 'run': run_stage(a.pages); far_stage()


if __name__ == '__main__':
    main()
