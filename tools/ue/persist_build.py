#!/usr/bin/env python3
# The persistent city level (docs/notes/ue-persistent-city.md): one World Partition level, /Game/City/L_City, holding
# every built city block (the takes' /Game/CCB block levels, as level instances), the cells' kit tables (streamed cell
# actors, full near and reduced farther) and the far city as the blocks' stand-ins (hidden while their block is loaded,
# ValdradaWorld's swap). Built once and kept: a run diffs the city manifests (UE_CITY_DIR) against the level's record
# (ue_cache/persist/state.json) and touches only the actors whose block, table or far package changed.
#   python3 tools/ue/persist_build.py [--region x0,z0,x1,z1 (m)] [--dry] [--li-chunk 120] [--cell-chunk 20000]
import argparse, collections, json, math, os, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_take as RT

CITY = os.environ.get('UE_CITY_DIR', '/data0/projectnyc_aux/ue_cache/city_v2')
STATE_DIR = os.path.join(RT.UECACHE, 'persist')
MAP = '/Game/City/L_City'
CONTENT = os.path.join(RT.EXPORT, 'ue_project', 'Content')
CELL, BLOCK = 128.0, 1024.0
# the runtime grids: name, cell size (cm), loading range (cm); a render may override a range
# (wp.Runtime.OverrideRuntimeLoadingRange -grid=Blocks -range=...)
GRIDS = [('Kit', 25600, 80000.0), ('KitFar', 51200, 150000.0), ('Blocks', 102400, 400000.0), ('Far', 819200, 6000000.0)]   # (the largest tier's reach; the plugin trims per tier)
# (2026-10-25: the grids load the actors (small: a streamer, a table's path) as far as the largest tier reaches; the
# plugin loads levels and builds kit by distance within them, valdrada.BlocksRangeM / KitRangeM / KitFarRangeM / FarRangeM
# per tier: the grids' ranges did not bound the blocks, a block's bounds over its 1 km cell went to a coarser cell.)
# (kit: full tables to 800 m (dressed buildings ride in the tables: 500 m dropped one at 600 m), reduced to 1.5 km, none beyond; 1.5 km of full blocks overflowed the ray tracing scene,
# 'zero-sized buffer FRayTracingScene::SceneBuffer', and 4 km of reduced tables filled the GPU scene)


def log(*a):
    line = time.strftime('[persist %H:%M:%S] ') + ' '.join(str(x) for x in a)
    print(line, flush=True)
    with open(os.path.join(STATE_DIR, 'build.log'), 'a') as f: f.write(line + '\n')


def block_of_cell(k):
    cx, cz = map(int, k.split('_')); return (math.floor(cx * CELL / BLOCK), math.floor(cz * CELL / BLOCK))


def spec(region=None):
    """every actor of the level: label -> {kind, level|table, grid, tags[, bounds]}"""
    cm = json.load(open(os.path.join(CITY, 'cells.json'))); cells, blocks = cm['cells'], cm.get('blocks') or {}
    far = json.load(open(os.path.join(CITY, 'far.json')))['keys']
    lodi = json.load(open(os.path.join(RT.CELLCACHE, 'lod16', 'index.json')))
    have = set(lodi.get('chunks') or {})
    cityb = collections.Counter(block_of_cell(k) for k in cells)
    def inreg_b(b):
        if not region: return True
        x0, z0 = b[0] * BLOCK, b[1] * BLOCK
        return x0 < region[2] and x0 + BLOCK > region[0] and z0 < region[3] and z0 + BLOCK > region[1]
    S = {}
    farlvl = lambda n: f'{RT.CF_ROOT}/{far[n]}/L'
    # (the block's far stand-in: its own L3 chunk, else its L4 cut to it, its ground, its bridge pieces; for every block)
    # near: the blocks, their edge packages (a block partly in the city) and the bridge kit's edge pieces
    for b in sorted(cityb):
        bk = '%d_%d' % b; key = f'B_{bk}'
        stand = [f'L3_{bk}'] if f'L3_{bk}' in have and f'L3_{bk}' in far else ([f'B_{bk}'] if f'B_{bk}' in far else [])
        stand += [n for n in (f'GB_{bk}',) if n in far] + [n for n in far if n.startswith('LMB_') and n.endswith('_' + bk)]
        for n in stand: S[f'far_{n}'] = {'kind': 'li', 'level': farlvl(n), 'grid': 'Far', 'tags': ['vf', key]}
        if not inreg_b(b): continue
        if bk in blocks: S[f'blk_{bk}'] = {'kind': 'li', 'level': blocks[bk]['level'], 'grid': 'Blocks', 'tags': ['vn', key]}
        else:
            for k in cells:
                if block_of_cell(k) == b: S[f'cel_{k}'] = {'kind': 'li', 'level': cells[k]['level'], 'grid': 'Blocks', 'tags': ['vn', key]}
        if cityb[b] < 64 and f'R_{bk}' in far: S[f'edge_R_{bk}'] = {'kind': 'li', 'level': farlvl(f'R_{bk}'), 'grid': 'Blocks', 'tags': ['vn', key]}
        for n in far:
            if n.startswith('LMBR_') and n.endswith('_' + bk): S[f'edge_{n}'] = {'kind': 'li', 'level': farlvl(n), 'grid': 'Blocks', 'tags': ['vn', key]}
    # the cells' kit tables, merged per 256 m quad (one instanced component per mesh and flags; per cell, 2,261 reduced
    # cells round one lens made 122,143 components): the full tables near (grid Kit, 500 m), the reduced ones to 1.5 km
    # (grid KitFar, out of the ray tracing scene), none beyond (their instances filled the GPU scene's buffers, 8 GB)
    kt = collections.defaultdict(lambda: [[], []])
    for k, c in sorted(cells.items()):
        if not inreg_b(block_of_cell(k)) or not c.get('table') or not os.path.exists(c['table']): continue
        cx, cz = map(int, k.split('_')); q = (math.floor(cx / 2), math.floor(cz / 2)); kt[q][0].append(c['table'])
        lo = c['table'][:-5] + '.lo.vcel'
        if os.path.exists(lo): kt[q][1].append(lo)
    Q = 2 * CELL * 100
    for q, (full, lo) in sorted(kt.items()):
        qk = '%d_%d' % q
        bounds = [q[0] * Q - 2000, q[1] * Q - 2000, -20000, (q[0] + 1) * Q + 2000, (q[1] + 1) * Q + 2000, 60000]
        S[f'kit_{qk}'] = {'kind': 'cell', 'tables': full, 'grid': 'Kit', 'tags': ['vn', f'Q_{qk}'], 'bounds': bounds, 'rt': True}
        if lo: S[f'klo_{qk}'] = {'kind': 'cell', 'tables': lo, 'grid': 'KitFar', 'tags': ['vf', f'Q_{qk}'], 'bounds': bounds, 'rt': False}
    # landmarks: the stand-in of the city block at their centre; elsewhere always drawn
    for k, e in sorted((lodi.get('landmarks') or {}).items()):
        b_ = e.get('bounds'); n = f'LM_{k}'
        if not b_ or n not in far or e.get('kind') == 'bridge' or e.get('drawnBy') == 'bridgeKit': continue
        cb = (math.floor((b_[0] + b_[3]) / 2 / BLOCK), math.floor((b_[2] + b_[5]) / 2 / BLOCK))
        S[f'far_{n}'] = {'kind': 'li', 'level': farlvl(n), 'grid': 'Far', 'tags': ['vf', 'B_%d_%d' % cb] if cityb.get(cb) else ['vf', 'always']}
    # the far city beyond the city's blocks: the chunk tree with every city block near, coarser with distance from the city
    if True:   # (the far city whatever the region: a region narrows the near blocks only)
        def ring(b):
            d = min(max(abs(b[0] - c[0]), abs(b[1] - c[1])) for c in cityb)
            return 3 if d <= 2 else 4 if d <= 6 else 5 if d <= 14 else 6
        allb = set()
        for ck in have:
            L, i, j = ck.split('_'); L = int(L[1:]); i, j = int(i), int(j); s = 2 ** (L - 3)
            allb |= {(bx, bz) for bx in range(i * s, (i + 1) * s) for bz in range(j * s, (j + 1) * s)}
        cityset = set(cityb)
        desired = {b: ring(b) for b in allb - cityset}
        out, l6_whole = [], set()
        def cut(L, i, j):
            s = 2 ** (L - 3)
            bs = [(bx, bz) for bx in range(i * s, (i + 1) * s) for bz in range(j * s, (j + 1) * s)]
            wanted = [b for b in bs if b in desired]
            if not wanted: return False
            if f'L{L}_{i}_{j}' in have and not any(b in cityset for b in bs) and min(desired[b] for b in wanted) >= L:
                out.append(f'L{L}_{i}_{j}')
                if L == 6: l6_whole.update(bs)
                return True
            if L == 3: return False
            for di in (0, 1):
                for dj in (0, 1): cut(L - 1, 2 * i + di, 2 * j + dj)
            return False
        for i, j in sorted({(math.floor(bx / 8), math.floor(bz / 8)) for bx, bz in allb}):
            if not cut(6, i, j) and f'W_L6_{i}_{j}' in far: out.append(f'W_L6_{i}_{j}')
        for n in sorted(set(out)):
            if n in far: S[f'far_{n}'] = {'kind': 'li', 'level': farlvl(n), 'grid': 'Far', 'tags': ['vf', 'always']}
    for l, e in S.items():
        if e['kind'] == 'li': e['bounds'] = li_bounds(l, e, lodi)
    return S


def li_bounds(label, e, lodi):
    """a level instance's streaming box (cm, Unreal axes): its block's or chunk's square, a landmark's own bounds"""
    n = label.split('_', 1)[1]
    if label.startswith('far_LM_') and not label.startswith('far_LMB'):
        b = (lodi.get('landmarks') or {}).get(n[3:], {}).get('bounds')
        if b: return [b[0] * 100, b[2] * 100, b[1] * 100 - 5000, b[3] * 100, b[5] * 100, b[4] * 100 + 5000]
    parts = n.split('_')
    i, j = int(parts[-2]), int(parts[-1])
    s = BLOCK
    if parts[0] in ('L3', 'L4', 'L5', 'L6'): s = BLOCK * 2 ** (int(parts[0][1:]) - 3)
    elif parts[0] == 'W': s = BLOCK * 8
    m = 20000.0   # (dressed buildings and bridge pieces reach past their square)
    return [i * s * 100 - m, j * s * 100 - m, -50000.0, (i + 1) * s * 100 + m, (j + 1) * s * 100 + m, 60000.0]


def sig(e):
    return json.dumps(e, sort_keys=True)


def main():
    import resource; resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    ap = argparse.ArgumentParser()
    ap.add_argument('--region', default=None, help='x0,z0,x1,z1 in metres: only the blocks meeting it (no removals)')
    ap.add_argument('--dry', action='store_true'); ap.add_argument('--li-chunk', type=int, default=1000); ap.add_argument('--cell-chunk', type=int, default=2000)
    ap.add_argument('--max-editors', type=int, default=0, help='stop after this many editor runs (0: all)')
    a = ap.parse_args()
    os.makedirs(STATE_DIR, exist_ok=True)
    region = [float(v) for v in a.region.split(',')] if a.region else None
    sp = os.path.join(STATE_DIR, 'state.json')
    state = json.load(open(sp)) if os.path.exists(sp) else {'map': None, 'actors': {}}
    S = spec(region)
    missing = [l for l, e in S.items() if e['kind'] == 'li' and not os.path.exists(os.path.join(CONTENT, e['level'][len('/Game/'):] + '.umap'))]
    for l in missing: S.pop(l)
    have = state['actors']
    adds = [l for l in S if l not in have]
    upds = [l for l in S if l in have and have[l] != sig(S[l])]
    rems = [l for l in have if l not in S] if not region else []   # (a region run removes nothing)
    log(f'spec {len(S)} actors ({sum(1 for e in S.values() if e["kind"] == "li")} level instances), {len(missing)} levels missing; '
        f'add {len(adds)} update {len(upds)} remove {len(rems)}; map {"exists" if state.get("map") else "new"}')
    if a.dry: return
    ops = [('rem', l) for l in rems] + [('upd', l) for l in upds] + [('add', l) for l in adds]
    li = [o for o in ops if o[0] == 'rem' or S[o[1]]['kind'] == 'li']
    ce = [o for o in ops if o[0] != 'rem' and S[o[1]]['kind'] == 'cell']
    jobs = [li[i:i + a.li_chunk] for i in range(0, len(li), a.li_chunk)] + [ce[i:i + a.cell_chunk] for i in range(0, len(ce), a.cell_chunk)]
    if state.get('map') and state.get('grids') != GRIDS: jobs = [[]] + jobs   # (grids changed: set on the first editor)
    if not state.get('map') and not jobs: jobs = [[]]
    for n, job in enumerate(jobs):
        if a.max_editors and n >= a.max_editors: break
        jp = os.path.join(STATE_DIR, f'job_{n}.json'); rp = os.path.join(STATE_DIR, f'job_{n}.result.json')
        if os.path.exists(rp): os.remove(rp)
        json.dump({'map': MAP, 'create': not state.get('map'), 'grids': GRIDS, 'set_grids': state.get('grids') != GRIDS, 'result': rp,
                   'ops': [{'op': o, 'label': l, **({} if o == 'rem' else S[l])} for o, l in job]}, open(jp, 'w'))
        t = time.time()
        env = RT.ue_env(); env['PERSIST_JOB'] = jp
        lf = os.path.join(STATE_DIR, f'job_{n}.log')
        code = subprocess.call([os.path.join(RT.UE_ROOT, 'Engine', 'Binaries', 'Linux', 'UnrealEditor-Cmd'), RT.PROJECT, '-run=pythonscript',
                                f'-script={os.path.join(HERE, "persist_editor.py")}', '-unattended', '-nosplash', '-nullrhi', '-stdout', '-FullStdOutLogOutput'],
                               stdout=open(lf, 'w'), stderr=subprocess.STDOUT, env=env)
        R = json.load(open(rp)) if os.path.exists(rp) else {}
        if R.get('map_ok'): state['map'] = MAP; state['grids'] = GRIDS
        for l in R.get('done') or []:
            if l in S: have[l] = sig(S[l])
            else: have.pop(l, None)
        json.dump(state, open(sp + '.tmp', 'w')); os.replace(sp + '.tmp', sp)
        log(f'editor {n + 1}/{len(jobs)}: exit {code}, {len(R.get("done") or [])} of {len(job)} done, {time.time() - t:.0f} s, errors {len(R.get("errors") or [])}'
            + (f' e.g. {R["errors"][:2]}' if R.get('errors') else '') + f' (log {lf})')
        if not R.get('map_ok'): log('stopping: the editor did not save the map'); sys.exit(3)


if __name__ == '__main__':
    main()
