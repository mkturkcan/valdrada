#!/usr/bin/env python3
"""Assemble the headless core of a ValdradaUE package: a Node runtime and the files tools/core/serve.mjs loads and reads,
laid out as in the repository so that its relative imports and the core's own paths (core/env/shim.mjs: client/public
two folders above core/env) hold unchanged.

  python3 core_bundle.py --platform linux --out <dir>/core            Linux x64 (node from the local install, or downloaded)
  python3 core_bundle.py --platform win64 --out <dir>/core            Windows x64 (node.exe downloaded from nodejs.org)
  python3 core_bundle.py --platform linux --out <dir>/core --no-tiles the tiles left out (they ship as their own archive)

Written:
  <out>/node/        the runtime: bin/node (Linux) or node.exe (Windows), with Node's LICENSE
  <out>/app/         core/, tools/core/serve.mjs, client/src/, the package.json files (ES module type), the three.js,
                     earcut and ez-tree packages, and client/public/{tiles,data,fonts}, the fleet's .glb files (the core
                     reads their dimensions) and the crowd's manifests
  <out>/app/cellcache/  index.json and lod16/index.json of the city build the package's content was cooked from
                     (the launcher sets VALDRADA_CELLCACHE to this folder)
  <out>/bundle.json  the file count and bytes per part, the Node version and the repository revision

The file list was taken from a trace of the core serving the Python examples (every module loaded and every file opened,
2026-10-17): 240 modules (180 of them client/src/city), the tiles round the spectator, models/fleet24/*.glb,
models/peds24/manifest.json and rb27/manifest.json, data/columbia_campus.json, fonts/ar33/o. Whole folders are copied
where the core reads by computed paths (all tiles, data, fonts, client/src), so any place in the city works. Standard
library only, so the Windows build machine can run it.
"""
import argparse, hashlib, json, os, shutil, subprocess, sys, tarfile, time, urllib.request, zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
NODE_VERSION = '24.19.0'      # the version the core is developed and tested on
NODE_DIST = 'https://nodejs.org/dist/v{v}/'

# (source relative to the repository, destination relative to app/, filter) ; folders are copied recursively
TREE = [
    ('core', 'core', None),
    ('tools/core/serve.mjs', 'tools/core/serve.mjs', None),
    ('package.json', 'package.json', None),
    ('client/package.json', 'client/package.json', None),
    ('client/src', 'client/src', None),
    # data/lod16 is the web client's far-field chunk bank (2.9 GB), which the core never reads (it reads the cell cache's
    # indices, below); the measured ground's products the core reads come in GROUND below, the bakes' own (terrain_mn,
    # m64, the vegetation) never
    ('client/public/data', 'client/public/data', lambda rel: not rel.startswith(('lod16/', 'terrain_', 'veg_p1/', 'm64/', 'hhp_p2/'))),
    ('client/public/fonts', 'client/public/fonts', None),
    ('client/public/models/fleet24', 'client/public/models/fleet24', lambda rel: rel.endswith('.glb') or rel.endswith('.json')),
    ('client/public/models/peds24', 'client/public/models/peds24', lambda rel: os.path.basename(rel) == 'manifest.json'),
    # three.js: the core resolves it from the repository root, client/src from client/; both are the same version
    ('node_modules/three', 'node_modules/three', lambda rel: rel == 'package.json' or rel == 'LICENSE' or rel.startswith(('build/', 'examples/jsm/'))),
    ('client/node_modules/three', 'client/node_modules/three', lambda rel: rel == 'package.json' or rel == 'LICENSE' or rel.startswith(('build/', 'examples/jsm/'))),
    ('client/node_modules/earcut', 'client/node_modules/earcut', None),
    ('client/node_modules/@dgreenheck/ez-tree', 'client/node_modules/@dgreenheck/ez-tree', lambda rel: not rel.startswith(('docs/', 'examples/', 'test/'))),
]
TILES = ('client/public/tiles', 'client/public/tiles')
# 0.7.0: the core on the city's own ground (the launcher sets TERRAIN_P1, HHP_P2 and TERRAIN_P1_CELLS when the list is in
# the bundle): the measured ground's chunks of the tiles holding a cell baked on the terrain profile (config/far/lift_cells.json,
# shipped as data/terrain_cells.json; the height authority leaves every other tile flat, as the renderer's blocks are),
# its membrane, walls, stairs and decks, the grade's stations, the anchors, the highways and the grade's cover
GROUND_CELLS = 'config/far/lift_cells.json'
GROUND = [('client/public/data/terrain_grade', None), ('client/public/data/terrain_p1a', None), ('client/public/data/hhp_p2', None),
          ('client/public/data/veg_p1', lambda rel: rel.startswith('cover/'))]
# the indices of the cells and far chunks that the renderer holds (core/api/render.mjs reads them from VALDRADA_CELLCACHE to
# send render.load); they must come from the same city build as the cooked content
CELLCACHE = '/data0/projectnyc_aux/cellcache'
CELLCACHE_FILES = ['index.json', 'lod16/index.json']
SKIP_NAMES = {'.git', '.DS_Store', '__pycache__', '.cache'}


def part_of(dst):
    """The row of bundle.json a destination counts under: client/public/<x>, client/node_modules/<x>, client/src, core ..."""
    p = dst.split('/')
    return '/'.join(p[:3] if p[0] == 'client' and p[1] in ('public', 'node_modules') else p[:2] if p[0] in ('client', 'tools') else p[:1])


def copy_tree(src, dst, flt, stats, part):
    if os.path.isfile(src):
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        stats[part] = stats.get(part, [0, 0]); stats[part][0] += 1; stats[part][1] += os.path.getsize(dst)
        return
    if not os.path.isdir(src):
        sys.exit(f'missing: {src}')
    for dp, dn, fn in os.walk(src, followlinks=True):
        dn[:] = sorted(d for d in dn if d not in SKIP_NAMES)
        for f in sorted(fn):
            p = os.path.join(dp, f)
            rel = os.path.relpath(p, src).replace(os.sep, '/')
            if flt and not flt(rel):
                continue
            q = os.path.join(dst, rel)
            os.makedirs(os.path.dirname(q), exist_ok=True)
            shutil.copy2(p, q)
            s = stats.setdefault(part, [0, 0]); s[0] += 1; s[1] += os.path.getsize(q)


def fetch(url, dest):
    with urllib.request.urlopen(url, timeout=120) as r, open(dest + '.tmp', 'wb') as f:
        shutil.copyfileobj(r, f, 1 << 20)
    os.replace(dest + '.tmp', dest)


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def node_runtime(platform, out, cache, version, local):
    """Put the Node runtime in out/node: bin/node on Linux, node.exe on Windows (checked against SHASUMS256.txt)."""
    os.makedirs(out, exist_ok=True)
    name = {'linux': f'node-v{version}-linux-x64.tar.xz', 'win64': f'node-v{version}-win-x64.zip'}[platform]
    if platform == 'linux' and local:
        src = os.path.join(local, 'bin', 'node')
        os.makedirs(os.path.join(out, 'bin'), exist_ok=True)
        shutil.copy2(src, os.path.join(out, 'bin', 'node'))
        shutil.copy2(os.path.join(local, 'LICENSE'), os.path.join(out, 'LICENSE'))
        return f'local {local}'
    os.makedirs(cache, exist_ok=True)
    arc = os.path.join(cache, name)
    sums = os.path.join(cache, f'SHASUMS256-{version}.txt')
    if not os.path.exists(sums):
        fetch(NODE_DIST.format(v=version) + 'SHASUMS256.txt', sums)
    want = [l.split()[0] for l in open(sums) if l.strip().endswith(' ' + name)]
    if not want:
        sys.exit(f'{name} is not listed in SHASUMS256.txt of Node {version}')
    if not os.path.exists(arc) or sha256(arc) != want[0]:
        print(f'  downloading {name}')
        fetch(NODE_DIST.format(v=version) + name, arc)
    if sha256(arc) != want[0]:
        sys.exit(f'{name}: SHA256 does not match SHASUMS256.txt')
    top = name.rsplit('.tar.xz', 1)[0].rsplit('.zip', 1)[0]
    if platform == 'linux':
        with tarfile.open(arc) as t:
            for m, dst in ((f'{top}/bin/node', 'bin/node'), (f'{top}/LICENSE', 'LICENSE')):
                f = t.extractfile(m)
                os.makedirs(os.path.dirname(os.path.join(out, dst)) or out, exist_ok=True)
                with open(os.path.join(out, dst), 'wb') as g:
                    shutil.copyfileobj(f, g)
        os.chmod(os.path.join(out, 'bin', 'node'), 0o755)
    else:
        with zipfile.ZipFile(arc) as z:
            for m, dst in ((f'{top}/node.exe', 'node.exe'), (f'{top}/LICENSE', 'LICENSE')):
                with z.open(m) as f, open(os.path.join(out, dst), 'wb') as g:
                    shutil.copyfileobj(f, g)
    return f'nodejs.org {name} sha256 {want[0][:16]}'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--platform', choices=['linux', 'win64'], required=True)
    ap.add_argument('--out', required=True, help='the core folder to write (replaced)')
    ap.add_argument('--repo', default=REPO, help='the repository checkout to take the files from')
    ap.add_argument('--tiles', default=None, help='the compiled tiles folder (default: <repo>/client/public/tiles)')
    ap.add_argument('--no-tiles', action='store_true', help='leave the tiles out (shipped as their own archive)')
    ap.add_argument('--cellcache', default=CELLCACHE, help='the city build whose cell and chunk indices to ship (default: %(default)s)')
    ap.add_argument('--node-version', default=NODE_VERSION)
    ap.add_argument('--node-local', default=None, help='Linux: an extracted node-v<version>-linux-x64 folder to copy instead of downloading')
    ap.add_argument('--cache', default=os.path.join(HERE, 'out', 'cache'), help='where the Node archives are kept')
    ap.add_argument('--no-tile-cache', action='store_true', help='leave out the laid-tile cache of the measured ground (the core lays those tiles as it loads them)')
    ap.add_argument('--tile-cache-jobs', type=int, default=32, help='processes that lay the tile cache')
    a = ap.parse_args()

    t0 = time.time()
    out = os.path.abspath(a.out)
    if os.path.exists(out):
        shutil.rmtree(out)
    app = os.path.join(out, 'app')
    stats = {}
    for src, dst, flt in TREE:
        part = part_of(dst)
        copy_tree(os.path.join(a.repo, src), os.path.join(app, dst), flt, stats, part)
    for f in CELLCACHE_FILES:
        copy_tree(os.path.join(a.cellcache, f), os.path.join(app, 'cellcache', f), None, stats, 'cellcache')
    cells_f = os.path.join(a.repo, GROUND_CELLS)
    if os.path.exists(cells_f) and os.path.isdir(os.path.join(a.repo, 'client/public/data/terrain_p1')):
        cells = json.load(open(cells_f))
        tiles_g = {f'{int(k.split("_")[0]) // 4}_{int(k.split("_")[1]) // 4}' for k in cells}
        keep = lambda rel: not rel.startswith('t_') or rel[2:].rsplit('.', 1)[0] in tiles_g
        copy_tree(os.path.join(a.repo, 'client/public/data/terrain_p1'), os.path.join(app, 'client/public/data/terrain_p1'), keep, stats, 'client/public/data')
        for src, flt in GROUND:
            if os.path.isdir(os.path.join(a.repo, src)):
                copy_tree(os.path.join(a.repo, src), os.path.join(app, src), flt, stats, 'client/public/data')
        with open(os.path.join(app, 'client/public/data/terrain_cells.json'), 'w') as f:
            json.dump(cells, f)
        print(f'ground: {len(cells)} terrain cells in {len(tiles_g)} tiles', flush=True)
        # the tiles on the measured ground laid once, by this tree's code (tools/core/tile_cache.mjs): the core reads them
        # instead of laying each again (15 to 45 s a tile)
        if not a.no_tile_cache:
            cdir = os.path.join(app, 'cache', 'tiles')
            env = dict(os.environ, TERRAIN_P1='1', HHP_P2='1', TERRAIN_P1_CELLS=os.path.join(app, 'client/public/data/terrain_cells.json'),
                       VALDRADA_TILES=a.tiles or os.path.join(a.repo, TILES[0]))
            node_bin = shutil.which('node') or 'node'
            r = subprocess.run([node_bin, os.path.join(a.repo, 'tools', 'core', 'tile_cache.mjs'), cdir, '--jobs', str(a.tile_cache_jobs)], cwd=a.repo, env=env)
            if r.returncode != 0:
                sys.exit('tile cache: some tiles failed (see above)')
            nb = sum(os.path.getsize(os.path.join(cdir, f)) for f in os.listdir(cdir))
            stats['cache'] = [len(os.listdir(cdir)), nb]
    else:
        print('ground: no terrain cell list or no measured ground in the repository: the core stays flat', flush=True)
    if not a.no_tiles:
        tiles = a.tiles or os.path.join(a.repo, TILES[0])
        copy_tree(tiles, os.path.join(app, TILES[1]), None, stats, 'client/public/tiles')
    node = node_runtime(a.platform, os.path.join(out, 'node'), a.cache, a.node_version, a.node_local)
    nb = sum(os.path.getsize(os.path.join(dp, f)) for dp, _, fn in os.walk(os.path.join(out, 'node')) for f in fn)
    stats['node'] = [sum(len(fn) for _, _, fn in os.walk(os.path.join(out, 'node'))), nb]
    try:
        rev = subprocess.run(['git', '-C', a.repo, 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    except OSError:
        rev = ''
    total = [sum(v[0] for v in stats.values()), sum(v[1] for v in stats.values())]
    info = {'platform': a.platform, 'node': a.node_version, 'node_source': node, 'repo_revision': rev,
            'tiles': not a.no_tiles, 'parts': {k: {'files': v[0], 'bytes': v[1]} for k, v in sorted(stats.items())},
            'total': {'files': total[0], 'bytes': total[1]}, 'seconds': round(time.time() - t0, 1)}
    with open(os.path.join(out, 'bundle.json'), 'w') as f:
        json.dump(info, f, indent=1)
    for k, v in sorted(stats.items(), key=lambda kv: -kv[1][1]):
        print(f'  {k:42s} {v[0]:6d} files {v[1] / 1e6:9.1f} MB')
    print(f'core bundle ({a.platform}): {total[0]} files, {total[1] / 1e6:.1f} MB in {time.time() - t0:.0f} s -> {out}')


if __name__ == '__main__':
    main()
